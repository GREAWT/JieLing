import { Archive, ShieldCheck, TriangleAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { QUARANTINE_TTL_DAYS } from "@/src/core/constants";
import type { JudgedEntry } from "@/src/core/types";
import { SizeValue, VerdictBadge } from "./shared";

export interface ConfirmQuarantineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: JudgedEntry[];
  onConfirm: () => void;
  busy?: boolean;
  /** 隔离进行中的真实进度文案，如「隔离中 2/5」 */
  busyLabel?: string | null;
}

export function ConfirmQuarantineDialog({
  open,
  onOpenChange,
  entries,
  onConfirm,
  busy = false,
  busyLabel = null,
}: ConfirmQuarantineDialogProps) {
  const totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
  const revivalCount = entries.filter((entry) => entry.hit && entry.hit.revival.length > 0).length;

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="dc-panel dc-brackets dc-tone-safe gap-4 rounded-xl sm:max-w-lg">
        <DialogHeader className="gap-2">
          <span className="dc-label dc-tone-text flex items-center gap-2">
            <Archive aria-hidden className="size-3.5" />
            QUARANTINE · 可撤回操作
          </span>
          <DialogTitle className="dc-display text-lg tracking-wide">移入隔离区</DialogTitle>
          <DialogDescription className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span>共 <span className="dc-num font-semibold text-foreground">{entries.length}</span> 项</span>
            <span aria-hidden className="text-hairline">/</span>
            <SizeValue bytes={totalBytes} />
            <span className="w-full text-xs">
              文件不会被直接删除，{QUARANTINE_TTL_DAYS} 天内可随时还原到原位置。
            </span>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-64 rounded-lg border border-hairline">
          <ul className="divide-y divide-hairline">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{entry.name}</span>
                    <VerdictBadge verdict={entry.verdict} compact />
                  </p>
                  <p className="dc-path truncate text-muted-foreground">{entry.path}</p>
                </div>
                <SizeValue bytes={entry.size} className="shrink-0" />
              </li>
            ))}
          </ul>
        </ScrollArea>

        {revivalCount > 0 && (
          <p className="dc-tone-review dc-tone-bg dc-tone-border dc-tone-text flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            其中 {revivalCount} 项删了可能被重建，建议先到「复活诊断」断掉源头，再回来隔离。
          </p>
        )}

        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Undo2 aria-hidden className="dc-tone-safe dc-tone-text mt-0.5 size-3.5 shrink-0" />
          隔离区独立于回收站，不占用回收站空间；到期后仍需你确认才会彻底删除。
        </p>
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck aria-hidden className="dc-tone-info dc-tone-text mt-0.5 size-3.5 shrink-0" />
          沙箱会在开始前预检剩余空间，不足时禁止开始；真实磁盘浏览器读不到剩余空间，
          因此一律先复制并校验、再移除原文件，空间不足或校验失败时原文件保留并报告原因。
        </p>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={busy || entries.length === 0}>
            {busy ? <Spinner /> : <ShieldCheck aria-hidden />}
            {busy ? (busyLabel ?? "隔离中…") : "确认移入隔离区"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}