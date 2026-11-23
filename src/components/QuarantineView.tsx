import { useEffect, useState } from "react";
import { Archive, Check, RotateCcw, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { QUARANTINE_TTL_DAYS } from "@/src/core/constants";
import type { QuarantineRecord } from "@/src/core/types";
import { EmptyState } from "./States";
import { Meter, SizeValue, formatDateTime } from "./shared";

export interface QuarantineViewProps {
  records: QuarantineRecord[];
  onRestore: (record: QuarantineRecord) => void;
  onDelete: (record: QuarantineRecord) => void;
  onClearAll: () => void;
  busyId?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = QUARANTINE_TTL_DAYS * DAY_MS;

function recordName(record: QuarantineRecord): string {
  return record.originalPath.split(/[\\/]/).filter(Boolean).pop() ?? record.originalPath;
}

export function QuarantineView({
  records,
  onRestore,
  onDelete,
  onClearAll,
  busyId = null,
}: QuarantineViewProps) {
  const [deleteTarget, setDeleteTarget] = useState<QuarantineRecord | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // 保留期倒计时是活的：每 30 秒走一格，不需要用户刷新
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const active = records.filter((record) => !record.restored);
  const expired = active.filter((record) => record.expiresAt <= now);
  const restored = records.filter((record) => record.restored);
  const activeBytes = active.reduce((total, record) => total + record.size, 0);

  return (
    <section aria-label="隔离区" className="grid gap-3">
      <div className="dc-panel dc-brackets dc-tone-safe flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="dc-display flex items-center gap-2 text-base font-semibold tracking-wide">
            <Archive aria-hidden className="dc-tone-text size-4" />
            隔离区
            <span className="dc-label text-muted-foreground">QUARANTINE</span>
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            独立于 Windows 回收站，文件原样保存，{QUARANTINE_TTL_DAYS} 天后到期。
            到期后需你确认才会彻底删除，期间随时可以还原到原位置。
          </p>
        </div>

        <dl className="flex items-center gap-4">
          <div className="grid">
            <dt className="dc-label text-muted-foreground">在保</dt>
            <dd className="dc-num text-lg font-semibold">{active.length - expired.length}</dd>
          </div>
          <div className="grid">
            <dt className="dc-label text-muted-foreground">已到期</dt>
            <dd className={cn("dc-num text-lg font-semibold", expired.length > 0 && "dc-tone-danger dc-tone-text")}>
              {expired.length}
            </dd>
          </div>
          <div className="grid">
            <dt className="dc-label text-muted-foreground">占用</dt>
            <dd><SizeValue bytes={activeBytes} /></dd>
          </div>
        </dl>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setClearOpen(true)}
          disabled={active.length === 0}
          className="dc-tone-danger dc-tone-text hover:dc-tone-bg"
        >
          <Trash2 aria-hidden />
          清空隔离区
        </Button>
      </div>

      {records.length === 0 ? (
        <EmptyState
          icon={<Archive aria-hidden />}
          title="隔离区是空的"
          description="在审核台勾选条目后点「移入隔离区」，文件会先搬到这里，确认没问题后再彻底清理。"
        />
      ) : (
        <ul className="grid gap-2">
          {records.map((record, index) => {
            const msLeft = record.expiresAt - now;
            const daysLeft = Math.ceil(msLeft / DAY_MS);
            const busy = busyId === record.id;
            const isExpired = !record.restored && msLeft <= 0;
            const tone = record.restored
              ? "dc-tone-locked"
              : isExpired ? "dc-tone-danger" : daysLeft <= 2 ? "dc-tone-review" : "dc-tone-safe";
            const stateLabel = record.restored
              ? "已还原"
              : isExpired ? "已到期 · 待你确认" : `${daysLeft} 天后到期`;

            return (
              <li
                key={record.id}
                className={cn(
                  "dc-panel dc-rail dc-lift dc-rise flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-xl px-4 py-3",
                  tone,
                  record.restored && "opacity-70",
                )}
                style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="max-w-full truncate text-sm font-medium">{recordName(record)}</span>
                    <span className="text-xs text-muted-foreground">{record.owner}</span>
                    <span className={cn(
                      "dc-tone-bg dc-tone-text dc-tone-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                      tone,
                    )}>
                      {record.restored && <Check aria-hidden className="size-3" />}
                      {stateLabel}
                    </span>
                  </div>
                  <p className="dc-path mt-1 truncate text-muted-foreground" title={record.originalPath}>
                    {record.originalPath}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    隔离于 {formatDateTime(record.quarantinedAt)}
                  </p>
                  {!record.restored && (
                    <Meter
                      className="mt-2 max-w-64"
                      tone={tone}
                      value={Math.max(0, Math.min(1, msLeft / TTL_MS))}
                      label={`${recordName(record)} 剩余保留期`}
                    />
                  )}
                </div>

                <SizeValue bytes={record.size} className="shrink-0" />

                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRestore(record)}
                    disabled={record.restored || busy}
                  >
                    {busy ? <Spinner /> : <RotateCcw aria-hidden />}
                    还原
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="dc-tone-danger dc-tone-text"
                    onClick={() => setDeleteTarget(record)}
                    disabled={record.restored || busy}
                  >
                    <Trash2 aria-hidden />
                    彻底删除
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {restored.length > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          已还原 {restored.length} 项：文件已回到原位置，这里只留一条审计记录。
        </p>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <AlertDialogContent className="dc-panel dc-tone-danger rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="dc-display tracking-wide">
              彻底删除「{deleteTarget ? recordName(deleteTarget) : ""}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              将从隔离区永久移除，无法再还原。确定不需要了再删。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) onDelete(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              彻底删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent className="dc-panel dc-tone-danger rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="dc-display tracking-wide">清空隔离区？</AlertDialogTitle>
            <AlertDialogDescription>
              {active.length} 项、共 <SizeValue bytes={activeBytes} /> 将被永久删除，无法还原。
              运维手册与文件夹名录作为审计历史保留，不会随之抹掉。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { onClearAll(); setClearOpen(false); }}
            >
              全部彻底删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}