import type { ScanCoverage, ScanEntry, ScanOptions, ScanProgress } from "../core/types";

export type ScanWorkerMessage =
  | { type: "batch"; entries: ScanEntry[]; progress: ScanProgress }
  | { type: "done"; progress: ScanProgress }
  | { type: "cancelled"; progress: ScanProgress }
  | { type: "error"; message: string };

interface DirAggregate {
  size: number;
  fileCount: number;
  lastModified: number;
  childIds: string[];
  rawChildCount: number;
  coverage: Set<ScanCoverage>;
}

class ScanCancelledError extends Error {
  constructor() {
    super("扫描已取消");
    this.name = "AbortError";
  }
}

const BATCH_SIZE = 200;

function directoryCoverage(coverage: ReadonlySet<ScanCoverage>): ScanCoverage[] {
  return coverage.size > 0 ? [...coverage] : ["complete"];
}

function mergeCoverage(target: Set<ScanCoverage>, source: readonly ScanCoverage[]): void {
  for (const reason of source) {
    if (reason !== "complete") target.add(reason);
  }
}

export async function runScan(
  root: FileSystemDirectoryHandle,
  options: ScanOptions,
  emit: (msg: ScanWorkerMessage) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const skipDirs = new Set(options.skipDirs);
  const visited = new Set<string>();
  let pending: ScanEntry[] = [];
  let visitedCount = 0;
  let bytes = 0;
  let currentPath = "";
  let truncated = false;
  let stopped = false;

  const progress = (phase: ScanProgress["phase"]): ScanProgress => ({
    phase,
    visited: visitedCount,
    bytes,
    currentPath,
    truncated,
    ...(stopped ? { stopped: true } : {}),
  });

  const flush = (): void => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    emit({ type: "batch", entries: batch, progress: progress("scanning") });
  };

  const pushEntry = (entry: ScanEntry): void => {
    pending.push(entry);
    visitedCount++;
    if (pending.length >= BATCH_SIZE) flush();
  };

  const checkCancelled = (): void => {
    if (isCancelled()) throw new ScanCancelledError();
  };

  async function scanDir(dirHandle: FileSystemDirectoryHandle, dirPath: string, childDepth: number): Promise<DirAggregate> {
    const agg: DirAggregate = {
      size: 0,
      fileCount: 0,
      lastModified: 0,
      childIds: [],
      rawChildCount: 0,
      coverage: new Set(),
    };
    try {
      for await (const handle of dirHandle.values()) {
        checkCancelled();
        if (visitedCount >= options.maxEntries) {
          truncated = true;
          agg.coverage.add("entry_limited");
          break;
        }
        agg.rawChildCount++;
        const name = handle.name;
        if (handle.kind === "directory" && skipDirs.has(name)) {
          // 被跳过的子树既没有体积也不知道内容，必须让父目录失去整体隔离资格
          agg.coverage.add("skipped_children");
          continue;
        }
        const path = dirPath ? `${dirPath}/${name}` : name;
        if (visited.has(path)) continue;
        visited.add(path);
        currentPath = path;

        const entry: ScanEntry = {
          id: path,
          path,
          name,
          kind: handle.kind,
          size: 0,
          fileCount: handle.kind === "file" ? 1 : 0,
          lastModified: 0,
          depth: childDepth,
          isEmptyDir: false,
          parentId: dirPath === "" ? null : dirPath,
          childIds: [],
          coverage: ["complete"],
        };

        if (handle.kind === "file") {
          try {
            if (options.collectSizes) {
              const file = await (handle as FileSystemFileHandle).getFile();
              entry.size = file.size;
              entry.lastModified = file.lastModified;
            }
          } catch {
            // 单个文件读不到时保留条目，但父目录不能被视为完整覆盖
            agg.coverage.add("permission_partial");
          }
          agg.size += entry.size;
          agg.fileCount += 1;
          agg.lastModified = Math.max(agg.lastModified, entry.lastModified);
          agg.childIds.push(path);
          bytes += entry.size;
          pushEntry(entry);
          continue;
        }

        const subDir = handle as FileSystemDirectoryHandle;
        let childAgg: DirAggregate;
        if (childDepth < options.maxDepth) {
          childAgg = await scanDir(subDir, path, childDepth + 1);
        } else {
          // 达到深度上限后不再枚举整棵子树；即使恰好为空也按不完整处理，避免误导。
          truncated = true;
          childAgg = {
            size: 0, fileCount: 0, lastModified: 0, childIds: [], rawChildCount: 0,
            coverage: new Set(["depth_limited"]),
          };
          try {
            const first = await subDir.values().next();
            if (!first.done) childAgg.rawChildCount = 1;
          } catch {
            childAgg.coverage.add("permission_partial");
          }
        }
        entry.size = childAgg.size;
        entry.fileCount = childAgg.fileCount;
        entry.lastModified = childAgg.lastModified;
        entry.childIds = childAgg.childIds;
        entry.isEmptyDir = childAgg.rawChildCount === 0;
        entry.coverage = directoryCoverage(childAgg.coverage);
        mergeCoverage(agg.coverage, entry.coverage);
        if (visitedCount >= options.maxEntries) {
          truncated = true;
          agg.coverage.add("entry_limited");
          entry.coverage = directoryCoverage(new Set([...entry.coverage, "entry_limited"]));
        }
        agg.size += entry.size;
        agg.fileCount += entry.fileCount;
        agg.lastModified = Math.max(agg.lastModified, entry.lastModified);
        agg.childIds.push(path);
        pushEntry(entry);
        if (visitedCount >= options.maxEntries) break;
      }
    } catch (err) {
      if (err instanceof ScanCancelledError || isCancelled()) throw err;
      // 目录枚举中途失去权限：保留已发现内容，标记部分覆盖，不把失败伪装成空目录
      agg.coverage.add("permission_partial");
    }
    return agg;
  }

  try {
    emit({ type: "batch", entries: [], progress: progress("scanning") });
    // junction/符号链接可能造出无限深的新路径，visited 去重 + maxDepth 兜底
    await scanDir(root, "", 0);
    checkCancelled();
    flush();
    emit({ type: "done", progress: progress("ready") });
  } catch (err) {
    if (err instanceof ScanCancelledError || isCancelled()) {
      stopped = true;
      emit({ type: "cancelled", progress: progress("ready") });
      return;
    }
    emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

interface WorkerScope {
  postMessage(message: ScanWorkerMessage): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

// 本模块同时被主线程 import 作为降级实现，只在 Worker 环境里挂消息监听
if (typeof window === "undefined" && typeof self !== "undefined") {
  const scope = self as unknown as WorkerScope;
  let cancelled = false;
  scope.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { root?: FileSystemDirectoryHandle; options?: ScanOptions; cancel?: boolean };
    if (data.cancel) {
      cancelled = true;
      return;
    }
    if (data.root && data.options) {
      cancelled = false;
      void runScan(data.root, data.options, (msg) => scope.postMessage(msg), () => cancelled);
    }
  });
}
