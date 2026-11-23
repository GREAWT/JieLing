import type { ScanEntry, ScanOptions, ScanProgress } from "../core/types";

export type ScanWorkerMessage =
  | { type: "batch"; entries: ScanEntry[]; progress: ScanProgress }
  | { type: "done"; progress: ScanProgress }
  | { type: "cancelled" }
  | { type: "error"; message: string };

interface DirAggregate {
  size: number;
  fileCount: number;
  lastModified: number;
  childIds: string[];
  rawChildCount: number;
}

class ScanCancelledError extends Error {
  constructor() {
    super("扫描已取消");
    this.name = "AbortError";
  }
}

const BATCH_SIZE = 200;

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

  const progress = (phase: ScanProgress["phase"]): ScanProgress => ({
    phase,
    visited: visitedCount,
    bytes,
    currentPath,
    truncated,
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
    const agg: DirAggregate = { size: 0, fileCount: 0, lastModified: 0, childIds: [], rawChildCount: 0 };
    for await (const handle of dirHandle.values()) {
      checkCancelled();
      if (visitedCount >= options.maxEntries) {
        truncated = true;
        break;
      }
      agg.rawChildCount++;
      const name = handle.name;
      if (handle.kind === "directory" && skipDirs.has(name)) continue;
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
      };

      if (handle.kind === "file") {
        if (options.collectSizes) {
          const file = await (handle as FileSystemFileHandle).getFile();
          entry.size = file.size;
          entry.lastModified = file.lastModified;
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
        // 深度截断：只探一个子项判断是否非空，避免误报 isEmptyDir
        const first = await subDir.values().next();
        childAgg = { size: 0, fileCount: 0, lastModified: 0, childIds: [], rawChildCount: first.done ? 0 : 1 };
        if (!first.done) truncated = true;
      }
      entry.size = childAgg.size;
      entry.fileCount = childAgg.fileCount;
      entry.lastModified = childAgg.lastModified;
      entry.childIds = childAgg.childIds;
      entry.isEmptyDir = childAgg.rawChildCount === 0;
      // 递归返回后再次检查上限，避免回溯途中继续压入祖先目录导致超出 maxEntries
      if (visitedCount >= options.maxEntries) {
        truncated = true;
        break;
      }
      agg.size += entry.size;
      agg.fileCount += entry.fileCount;
      agg.lastModified = Math.max(agg.lastModified, entry.lastModified);
      agg.childIds.push(path);
      pushEntry(entry);
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
      emit({ type: "cancelled" });
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