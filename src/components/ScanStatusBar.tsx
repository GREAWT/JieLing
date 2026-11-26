import { Check, FlaskConical, HardDrive, OctagonX, Search, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  AI_DIRECTORY_DATA_NOTICE, QUARANTINE_TTL_DAYS, SCAN_COVERAGE_LABEL,
} from "@/src/core/constants";
import type { ScanProgress, ScanSource } from "@/src/core/types";
import { SCAN_UI_LABEL, scanUiState } from "@/src/app/scan-state";
import { SizeValue, ToneDot, formatBytes } from "./shared";

export interface ScanStatusBarProps {
  progress: ScanProgress;
  rootLabel?: string;
  onCancel?: () => void;
  preparing?: { created: number; total: number } | null;
  source?: ScanSource | null;
  localOnly?: boolean;
  onLocalOnlyChange?: (value: boolean) => void;
  aiBusy?: boolean;
  aiNotice?: string | null;
  aiState?: "local_only" | "cloud_ready" | "cloud_calling" | "cloud_success" | "cloud_failed";
  cloudAllowed?: boolean;
  readOnly?: boolean;
}

const AI_STATE_LABEL = {
  local_only: "仅本地规则",
  cloud_ready: "已允许云端 · 尚未调用",
  cloud_calling: "云端调用中",
  cloud_success: "云端调用成功",
  cloud_failed: "云端未配置或调用失败",
} as const;

export function ScanStatusBar({
  progress, rootLabel, onCancel, preparing = null, source, localOnly = true,
  onLocalOnlyChange, aiBusy = false, aiNotice, aiState = "local_only", cloudAllowed = true,
  readOnly = false,
}: ScanStatusBarProps) {
  const { phase, visited, bytes, currentPath, truncated, stopped, coverage } = progress;
  if (phase === "idle" && !preparing) return null;
  const state = scanUiState(phase, visited, stopped);
  const busy = phase === "scanning" || phase === "judging" || preparing !== null;
  const coverageReasons = (["depth_limited", "entry_limited", "skipped_children", "permission_partial", "cancelled"] as const)
    .filter((reason) => (coverage?.[reason] ?? 0) > 0)
    .map((reason) => `${SCAN_COVERAGE_LABEL[reason]} ${coverage?.[reason]}`);
  const percent = preparing && preparing.total > 0
    ? Math.min(100, Math.round((preparing.created / preparing.total) * 100))
    : null;
  const ModeIcon = source === "sandbox" ? FlaskConical : HardDrive;
  const aiTone = aiState === "cloud_failed"
    ? "dc-tone-danger"
    : aiState === "cloud_success"
      ? "dc-tone-safe"
      : aiState === "cloud_calling" || aiState === "cloud_ready"
        ? "dc-tone-ai"
        : "dc-tone-safe";

  return (
    <section
      aria-label="扫描状态"
      aria-live="polite"
      className={cn("dc-panel dc-brackets relative overflow-hidden px-3 py-2.5 sm:px-4", busy && "dc-beam")}
    >
      {busy && <span aria-hidden className="dc-scanline" />}
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-2">
          {busy
            ? <Spinner className="size-4 text-primary" />
            : state === "complete"
              ? <Check aria-hidden className="dc-tone-safe dc-tone-text size-4" />
              : state === "empty"
                ? <Search aria-hidden className="dc-tone-info dc-tone-text size-4" />
                : state === "stopped"
                  ? <OctagonX aria-hidden className="dc-tone-info dc-tone-text size-4" />
                  : <TriangleAlert aria-hidden className="dc-tone-danger dc-tone-text size-4" />}
          <span
            data-scan-state={preparing ? "preparing" : state}
            className={cn("dc-display text-sm font-semibold", busy && "dc-blink")}
          >
            {preparing ? "正在生成演示数据" : SCAN_UI_LABEL[state]}
          </span>
        </span>

        {source && (
          <span className={cn("dc-tone-bg dc-tone-text dc-tone-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", source === "sandbox" ? "dc-tone-review" : "dc-tone-safe")}>
            <ModeIcon aria-hidden className="size-3" />
            {source === "sandbox" ? "演示模式 · 模拟数据" : "真实目录"}
          </span>
        )}
        {readOnly && (
          <span className="dc-tone-locked dc-tone-bg dc-tone-text dc-tone-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
            <ShieldCheck aria-hidden className="size-3" />
            只读扫描 · 禁止隔离
          </span>
        )}

        <span className="dc-num flex items-baseline gap-1.5 text-xs text-muted-foreground">
          {preparing ? <>{preparing.created.toLocaleString("zh-CN")} / {preparing.total.toLocaleString("zh-CN")} 个条目</> : <>已访问 <span className="text-sm font-semibold text-foreground">{visited.toLocaleString("zh-CN")}</span> 项 · <SizeValue bytes={bytes} /></>}
        </span>

        {rootLabel && <span className="dc-path hidden max-w-48 truncate text-muted-foreground sm:inline" title={rootLabel}>{rootLabel}</span>}
        {(coverage?.incompleteDirs ?? 0) > 0 && !busy && (
          <span className="dc-tone-review dc-tone-text text-xs">
            覆盖不足 {coverage?.incompleteDirs} 个目录（{coverageReasons.join("、")}）· 已禁止整体隔离
          </span>
        )}
        {truncated && (coverage?.incompleteDirs ?? 0) === 0 && <span className="dc-tone-review dc-tone-text text-xs">已达条目上限，仅覆盖部分目录</span>}
        {stopped && !busy && (coverage?.incompleteDirs ?? 0) === 0 && <span className="dc-tone-info dc-tone-text text-xs">已手动停止 · 部分结果</span>}
        {busy && onCancel && !preparing && <Button variant="outline" size="sm" className="ml-auto" onClick={onCancel}><OctagonX aria-hidden />停止扫描</Button>}
      </div>

      {busy && (
        <div className="relative mt-2 grid gap-1.5">
          {percent !== null ? <Progress value={percent} aria-label="演示数据生成进度" /> : <div aria-hidden className="dc-indeterminate h-1 rounded-full bg-muted" />}
          {preparing ? <p className="text-xs text-muted-foreground">在浏览器沙箱（OPFS）写入模拟目录树，不读取真实磁盘；完成后立即开始扫描与判定。</p> : currentPath && <p className="dc-path truncate text-muted-foreground" title={currentPath}>{currentPath}</p>}
        </div>
      )}

      <div className="relative mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-hairline pt-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {aiState === "cloud_calling"
            ? <Spinner className="size-3 text-ai" />
            : aiState === "cloud_failed"
              ? <TriangleAlert aria-hidden className="dc-tone-danger dc-tone-text size-3.5" />
              : aiState === "cloud_ready" || aiState === "cloud_success"
                ? <Sparkles aria-hidden className={cn(aiTone, "dc-tone-text size-3.5")} />
                : <ShieldCheck aria-hidden className="dc-tone-safe dc-tone-text size-3.5" />}
          <span className={cn("font-medium", aiTone, "dc-tone-text")}>{AI_STATE_LABEL[aiState]}</span>
        </span>
        <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
          {aiState === "cloud_calling"
            ? AI_DIRECTORY_DATA_NOTICE
            : aiNotice ?? (aiState === "local_only"
              ? source === "sandbox"
                ? "演示模式固定使用本地规则，不请求云端；候选和云端状态不会在这里伪装成已调用。"
                : "当前仅使用本地规则；切换到允许云端后才可能在扫描后请求辅助分析。"
              : `勾选后移入隔离区，${QUARANTINE_TTL_DAYS} 天内可还原，彻底删除仍需你确认。`)}
        </span>
        {cloudAllowed && onLocalOnlyChange && (
          <label htmlFor="local-only" className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch id="local-only" checked={localOnly} onCheckedChange={onLocalOnlyChange} disabled={aiBusy || aiState === "cloud_calling"} />
            仅本地规则
          </label>
        )}
        {!cloudAllowed && (
          <span className="ml-auto text-xs text-muted-foreground">演示模式固定本地规则</span>
        )}
        {!busy && <ToneDot tone={state === "error" ? "dc-tone-danger" : state === "complete" ? "dc-tone-safe" : "dc-tone-info"} />}
      </div>
      <span className="sr-only">{formatBytes(bytes)}</span>
    </section>
  );
}
