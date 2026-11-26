import { Check, FlaskConical, HardDrive, OctagonX, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  AI_DIRECTORY_DATA_NOTICE, QUARANTINE_TTL_DAYS, SCAN_COVERAGE_LABEL,
} from "@/src/core/constants";
import type { ScanProgress, ScanSource } from "@/src/core/types";
import { PHASE_LABEL, SizeValue, ToneDot, formatBytes } from "./shared";

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
}

export function ScanStatusBar({
  progress, rootLabel, onCancel, preparing = null, source, localOnly = true,
  onLocalOnlyChange, aiBusy = false, aiNotice,
}: ScanStatusBarProps) {
  const { phase, visited, bytes, currentPath, truncated, stopped, coverage } = progress;
  if (phase === "idle" && !preparing) return null;
  const busy = phase === "scanning" || phase === "judging" || preparing !== null;
  const coverageReasons = (["depth_limited", "entry_limited", "skipped_children", "permission_partial", "cancelled"] as const)
    .filter((reason) => (coverage?.[reason] ?? 0) > 0)
    .map((reason) => `${SCAN_COVERAGE_LABEL[reason]} ${coverage?.[reason]}`);
  const percent = preparing && preparing.total > 0
    ? Math.min(100, Math.round((preparing.created / preparing.total) * 100))
    : null;
  const ModeIcon = source === "sandbox" ? FlaskConical : HardDrive;

  return (
    <section
      aria-label="扫描与判定状态"
      aria-live="polite"
      className={cn("dc-panel dc-brackets relative overflow-hidden px-3 py-2.5 sm:px-4", busy && "dc-beam")}
    >
      {busy && <span aria-hidden className="dc-scanline" />}
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-2">
          {busy ? <Spinner className="size-4 text-primary" /> : phase === "ready" ? <Check aria-hidden className="dc-tone-safe dc-tone-text size-4" /> : <TriangleAlert aria-hidden className="dc-tone-danger dc-tone-text size-4" />}
          <span className={cn("dc-display text-sm font-semibold", busy && "dc-blink")}>
            {preparing ? "正在生成演示数据" : PHASE_LABEL[phase]}
          </span>
        </span>

        {source && (
          <span className={cn("dc-tone-bg dc-tone-text dc-tone-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", source === "sandbox" ? "dc-tone-review" : "dc-tone-safe")}>
            <ModeIcon aria-hidden className="size-3" />
            {source === "sandbox" ? "演示模式 · 模拟数据" : "真实目录"}
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
          {aiBusy ? <Spinner className="size-3 text-ai" /> : localOnly ? <ShieldCheck aria-hidden className="dc-tone-safe dc-tone-text size-3.5" /> : <Sparkles aria-hidden className="dc-tone-ai dc-tone-text size-3.5" />}
          <span className="dc-tone-text font-medium">{localOnly ? "本地规则 · 离线可用" : aiBusy ? "云端模型判定中" : "云端辅助判定已开启"}</span>
        </span>
        <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
          {aiBusy ? AI_DIRECTORY_DATA_NOTICE : aiNotice ?? (source === "sandbox" ? "演示与真实目录共用扫描、判定、隔离和还原流程。" : `勾选后移入隔离区，${QUARANTINE_TTL_DAYS} 天内可还原，彻底删除仍需你确认。`)}
        </span>
        {onLocalOnlyChange && (
          <label htmlFor="local-only" className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch id="local-only" checked={localOnly} onCheckedChange={onLocalOnlyChange} disabled={aiBusy} />
            仅本地规则
          </label>
        )}
        {!busy && <ToneDot tone={phase === "error" ? "dc-tone-danger" : "dc-tone-safe"} />}
      </div>
      <span className="sr-only">{formatBytes(bytes)}</span>
    </section>
  );
}
