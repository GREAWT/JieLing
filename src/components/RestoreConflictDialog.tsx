import { Copy, FileQuestion, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { QuarantineRecord, RestorePolicy } from "@/src/core/types";

export interface RestoreConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: QuarantineRecord | null;
  onChoose: (policy: RestorePolicy) => void;
  busy?: boolean;
}

/** 还原遇到同名内容：跳过 / 保留两份，暂不提供替换，绝不静默覆盖 */
export function RestoreConflictDialog({
  open,
  onOpenChange,
  record,
  onChoose,
  busy = false,
}: RestoreConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="dc-panel dc-brackets dc-tone-review gap-4 rounded-xl sm:max-w-md">
        <DialogHeader className="gap-2">
          <span className="dc-label dc-tone-text flex items-center gap-2">
            <FileQuestion aria-hidden className="size-3.5" />
            RESTORE CONFLICT · 还原冲突
          </span>
          <DialogTitle className="dc-display text-lg tracking-wide">原位置已有同名内容</DialogTitle>
          <DialogDescription className="grid gap-1 text-xs leading-relaxed">
            <span className="dc-path break-all text-foreground">{record?.originalPath ?? ""}</span>
            <span>
              隔离期间原位置又出现了同名文件或目录（可能是软件重建的）。
              选择怎么处理这份冲突，洁灵不会替你静默覆盖。
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Button variant="outline" className="justify-start" disabled={busy} onClick={() => onChoose("skip")}>
            <SkipForward aria-hidden />
            跳过：保留隔离副本，原位置不动
          </Button>
          <Button variant="outline" className="justify-start" disabled={busy} onClick={() => onChoose("keep-both")}>
            <Copy aria-hidden />
            保留两份：还原为「名称（还原副本）」
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            先不还原
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}