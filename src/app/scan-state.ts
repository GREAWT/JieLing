import type { ScanPhase } from "@/src/core/types";

export type ScanUiState = "idle" | "scanning" | "judging" | "complete" | "empty" | "stopped" | "error";

export function scanUiState(phase: ScanPhase, visited: number, stopped = false): ScanUiState {
  if (phase === "error") return "error";
  if (phase === "ready") {
    if (stopped) return "stopped";
    return visited > 0 ? "complete" : "empty";
  }
  if (phase === "judging") return "judging";
  if (phase === "scanning") return "scanning";
  return "idle";
}

export const SCAN_UI_LABEL: Record<ScanUiState, string> = {
  idle: "待扫描",
  scanning: "扫描中",
  judging: "判定中",
  complete: "完成",
  empty: "空结果",
  stopped: "已停止",
  error: "读取失败",
};
