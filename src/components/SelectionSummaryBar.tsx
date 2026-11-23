import { Archive, ListChecks, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { QUARANTINE_TTL_DAYS } from "@/src/core/constants";
import { SizeValue } from "./shared";

export interface SelectionSummaryBarProps {
  selectedCount: number;
  selectedBytes: number;
  onQuarantine: () => void;
  onClear: () => void;
  busy?: boolean;
  /** 选择跨 Tab 保留：不在审核台时给一个回去核对的入口 */
  onGoReview?: () => void;
  awayFromReview?: boolean;
}

export function SelectionSummaryBar({
  selectedCount,
  selectedBytes,
  onQuarantine,
  onClear,
  busy = false,
  onGoReview,
  awayFromReview = false,
}: SelectionSummaryBarProps) {
  if (selectedCount <= 0) return null;
  return (
    <div className="dc-panel dc-brackets dc-tone-safe dc-rail mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3 shadow-[0_18px_50px_-30px_var(--dc-glow)]">
      <p className="flex items-baseline gap-1.5 text-sm">
        <span className="dc-label text-muted-foreground">已选</span>
        <span className="dc-num text-xl font-semibold text-foreground">{selectedCount}</span>
        <span className="text-muted-foreground">项</span>
        <span aria-hidden className="mx-1 text-hairline">/</span>
        <span className="dc-label text-muted-foreground">可释放</span>
        <SizeValue bytes={selectedBytes} large />
      </p>

      <p className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
        <Undo2 aria-hidden className="dc-tone-safe dc-tone-text size-3.5" />
        移入隔离区而非删除，{QUARANTINE_TTL_DAYS} 天内可一键还原
      </p>

      <div className="ml-auto flex items-center gap-1.5">
        {awayFromReview && onGoReview && (
          <Button variant="ghost" size="sm" onClick={onGoReview}>
            <ListChecks aria-hidden />
            回审核台核对
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClear} disabled={busy}>
          <X aria-hidden />
          取消选择
        </Button>
        <Button onClick={onQuarantine} disabled={busy} className="dc-tone-safe">
          {busy ? <Spinner /> : <Archive aria-hidden />}
          移入隔离区
        </Button>
      </div>
    </div>
  );
}