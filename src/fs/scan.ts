import type { ScanCoverage, ScanEntry, ScanOptions, ScanProgress, ScanResult, ScanSource } from "../core/types";
import { summarizeCoverage } from "../safety/guard";
import { runScan, type ScanWorkerMessage } from "./scan.worker";

export interface Scanner {
  start(
    root: FileSystemDirectoryHandle,
    options: ScanOptions,
    source: ScanSource,
    rootLabel: string,
    onProgress: (p: ScanProgress) => void,
    onBatch: (entries: ScanEntry[]) => void,
  ): Promise<ScanResult>;
  cancel(): void;
}

function markGlobalCoverage(entries: ScanEntry[], reasons: ScanCoverage[]): void {
  if (reasons.length === 0) return;
  for (const entry of entries) {
    if (entry.kind !== "directory") continue;
    const current = new Set(entry.coverage ?? ["complete"]);
    current.delete("complete");
    for (const reason of reasons) current.add(reason);
    entry.coverage = [...current];
  }
}

function finalizeProgress(progress: ScanProgress, entries: ScanEntry[]): ScanProgress {
  return { ...progress, coverage: summarizeCoverage(entries) };
}

export function createScanner(): Scanner {
  let worker: Worker | null = null;
  let cancelled = false;
  let running = false;

  return {
    start(root, options, source, rootLabel, onProgress, onBatch): Promise<ScanResult> {
      if (running) return Promise.reject(new Error("扫描器已在运行中，请先 cancel 或等待完成"));
      running = true;
      cancelled = false;
      const entries: ScanEntry[] = [];

      return new Promise<ScanResult>((resolve, reject) => {
        const cleanup = (): void => {
          running = false;
          if (worker) {
            worker.terminate();
            worker = null;
          }
        };

        const handle = (msg: ScanWorkerMessage): void => {
          switch (msg.type) {
            case "batch":
              if (msg.entries.length > 0) {
                for (const entry of msg.entries) entries.push(entry);
                onBatch(msg.entries);
              }
              onProgress(msg.progress);
              break;
            case "done":
              cleanup();
              if (msg.progress.truncated) markGlobalCoverage(entries, ["entry_limited"]);
              resolve({ entries, progress: finalizeProgress(msg.progress, entries), rootLabel, source });
              break;
            case "cancelled":
              cleanup();
              markGlobalCoverage(entries, ["cancelled"]);
              if (msg.progress.truncated) markGlobalCoverage(entries, ["entry_limited"]);
              onProgress(msg.progress);
              resolve({
                entries,
                progress: finalizeProgress({ ...msg.progress, phase: "ready", stopped: true }, entries),
                rootLabel,
                source,
              });
              break;
            case "error":
              cleanup();
              reject(new Error(`扫描失败: ${msg.message}`));
              break;
          }
        };

        const startFallback = (): void => {
          void runScan(root, options, handle, () => cancelled).catch((err: unknown) => {
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
          });
        };

        let w: Worker;
        try {
          w = new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });
        } catch {
          startFallback();
          return;
        }
        worker = w;
        w.onmessage = (ev: MessageEvent<ScanWorkerMessage>) => handle(ev.data);
        w.onerror = (ev: ErrorEvent) => {
          cleanup();
          reject(new Error(`扫描 Worker 运行失败: ${ev.message || "未知错误"}`));
        };
        try {
          // FileSystemDirectoryHandle 可结构化克隆，直接传给 Worker
          w.postMessage({ root, options });
        } catch {
          // 个别浏览器不支持克隆句柄，降级为主线程扫描
          w.terminate();
          worker = null;
          startFallback();
        }
      });
    },

    cancel(): void {
      cancelled = true;
      worker?.postMessage({ cancel: true });
    },
  };
}