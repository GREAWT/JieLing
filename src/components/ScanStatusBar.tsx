import { Check, OctagonX, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ScanProgress } from "@/src/core/types";
import { PHASE_LABEL, SizeValue, ToneDot, formatBytes } from "./shared";

export interface ScanStatusBarProps {
  progress: ScanProgress;
  rootLabel?: string;
  onCancel?: () => void;
}

export function ScanStatusBar({ progress, rootLabel, onCancel }: ScanStatusBarProps) {
  const { phase, visited, bytes, currentPath, truncated, stopped } = progress;
  if (phase === "idle") return null;
  const busy = phase === "scanning" || phase === "judging";

  return (
    <section
      aria-label="扫描状态"
      aria-live="polite"
      className={cn(
        "dc-panel dc-brackets relative overflow-hidden px-4 py-3",
        busy && "dc-beam",
      )}
    >
      {busy && <span aria-hidden className="dc-scanline" />}

      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2">
          {busy ? (
            <Spinner className="size-4 text-primary" />
          ) : phase === "ready" ? (
            <Check aria-hidden className="dc-tone-safe dc-tone-text size-4" />
          ) : (
            <TriangleAlert aria-hidden className="dc-tone-danger dc-tone-text size-4" />
          )}
          <span className={cn("dc-display text-sm font-semibold", busy && "dc-blink")}>
            {PHASE_LABEL[phase]}
          </span>
        </span>

        <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
          已访问
          <span className="dc-num text-sm font-semibold text-foreground">
            {visited.toLocaleString("zh-CN")}
          </span>
          项
        </span>

        <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
          累计 <SizeValue bytes={bytes} />
        </span>

        {rootLabel && (
          <span className="dc-path max-w-52 truncate text-muted-foreground" title={rootLabel}>
            {rootLabel}
          </span>
        )}

        {truncated && (
          <span className="dc-tone-review dc-tone-bg dc-tone-text dc-tone-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
            <TriangleAlert aria-hidden className="size-3.5" />
            已达条目上限，仅覆盖部分目录
          </span>
        )}
        {stopped && !busy && (
          <span className="dc-tone-info dc-tone-bg dc-tone-text dc-tone-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
            <OctagonX aria-hidden className="size-3.5" />
            已手动停止 · 部分结果
          </span>
        )}

        {busy && onCancel && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={onCancel}>
            <OctagonX aria-hidden />
            停止扫描
          </Button>
        )}
        {!busy && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <ToneDot tone={phase === "error" ? "dc-tone-danger" : "dc-tone-safe"} />
            {phase === "error" ? "需要重试" : "结果已就绪"}
          </span>
        )}
      </div>

      {busy && (
        <div className="relative mt-2.5 grid gap-1.5">
          <div aria-hidden className="dc-indeterminate h-1 rounded-full bg-muted" />
          {currentPath && (
            <p className="dc-path truncate text-muted-foreground" title={currentPath}>
              {currentPath}
            </p>
          )}
        </div>
      )}
      {!busy && phase === "ready" && (
        <div aria-hidden className="dc-tone-safe relative mt-2.5 h-0.5 overflow-hidden rounded-full bg-muted">
          <span className="block h-full w-full bg-current opacity-70" />
        </div>
      )}
      <span className="sr-only">{formatBytes(bytes)}</span>
    </section>
  );
}