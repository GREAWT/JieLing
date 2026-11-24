import { useEffect, useState } from "react";
import { Archive, Check, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { QUARANTINE_TTL_DAYS } from "@/src/core/constants";
import type { QuarantineRecord, ScanSource } from "@/src/core/types";
import { EmptyState } from "./States";
import { Meter, SizeValue, formatDateTime } from "./shared";

export interface QuarantineViewProps {
  records: QuarantineRecord[];
  onRestore: (record: QuarantineRecord) => void;
  onDelete: (record: QuarantineRecord) => void;
  onClearAll: () => void;
  busyId?: string | null;
  /** 全局操作进行中：禁止重复提交 */
  busy?: boolean;
  source?: ScanSource | null;
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
  busy: globalBusy = false,
  source = null,
}: QuarantineViewProps) {
  const [deleteTarget, setDeleteTarget] = useState<QuarantineRecord | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearAck, setClearAck] = useState(false);
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
          onClick={() => { setClearAck(false); setClearOpen(true); }}
          disabled={active.length === 0 || globalBusy}
          className="dc-tone-danger dc-tone-text hover:dc-tone-bg"
        >
          <Trash2 aria-hidden />
          清空隔离区
        </Button>
      </div>

      <p className="dc-panel dc-rail dc-tone-review flex items-start gap-2 rounded-xl px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <TriangleAlert aria-hidden className="dc-tone-text mt-0.5 size-4 shrink-0" />
        <span>
          <strong className="dc-tone-text">不可恢复风险提示：</strong>
          {source === "sandbox"
            ? "样本磁盘的隔离区存放在浏览器沙箱（OPFS）里，清除浏览器数据、存储回收或换浏览器都会让隔离内容永久丢失。"
            : "真实目录的隔离区保存在所选目录内部，删除该目录、格式化磁盘或失去访问权限同样会导致无法还原。"}
          这些情况洁灵无法拦截：重要内容请及时还原，或另行备份一份。
        </span>
      </p>

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
            const processing = record.status === "processing";
            const failed = record.status === "quarantine_failed" || record.status === "restore_failed";
            const isExpired = !record.restored && !failed && msLeft <= 0;
            const tone = record.restored
              ? "dc-tone-locked"
              : failed ? "dc-tone-danger"
              : processing ? "dc-tone-info"
              : isExpired ? "dc-tone-danger" : daysLeft <= 2 ? "dc-tone-review" : "dc-tone-safe";
            const stateLabel = record.restored
              ? "已还原"
              : record.status === "quarantine_failed" ? "隔离失败"
              : record.status === "restore_failed" ? "还原失败"
              : processing ? "处理中"
              : isExpired ? "已到期 · 待你确认" : `${daysLeft} 天后到期`;
            const actionsDisabled = busy || globalBusy || processing || record.restored;

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
                      "dc-tone-bg dc-tone-text dc-tone-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                      tone,
                    )}>
                      {record.restored && <Check aria-hidden className="size-3" />}
                      {stateLabel}
                    </span>
                  </div>
                  <p className="dc-path mt-1 truncate text-muted-foreground" title={record.originalPath}>
                    {record.originalPath}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    隔离于 {formatDateTime(record.quarantinedAt)}
                    {record.modifiedAt > 0 && <> · 原修改于 {formatDateTime(record.modifiedAt)}</>}
                    {record.checksum && (
                      <> · 校验值 <span className="dc-path" title={`${record.checksumAlgo}: ${record.checksum}`}>{record.checksum.slice(0, 8)}</span></>
                    )}
                  </p>
                  {record.note && (
                    <p className="dc-tone-review dc-tone-text mt-0.5 text-xs leading-relaxed">{record.note}</p>
                  )}
                  {!record.restored && !failed && (
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
                    disabled={actionsDisabled || record.status === "quarantine_failed"}
                  >
                    {busy ? <Spinner /> : <RotateCcw aria-hidden />}
                    还原
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="dc-tone-danger dc-tone-text"
                    onClick={() => setDeleteTarget(record)}
                    disabled={busy || globalBusy || processing}
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

      <AlertDialog open={clearOpen} onOpenChange={(open) => { setClearOpen(open); if (!open) setClearAck(false); }}>
        <AlertDialogContent className="dc-panel dc-tone-danger rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="dc-display tracking-wide">清空隔离区？</AlertDialogTitle>
            <AlertDialogDescription>
              {active.length} 项、共 <SizeValue bytes={activeBytes} /> 将被永久删除，无法还原。
              运维手册与文件夹名录作为审计历史保留，不会随之抹掉。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-2 rounded-lg border border-hairline px-3 py-2 text-xs leading-relaxed">
            <Checkbox
              checked={clearAck}
              onCheckedChange={(v) => setClearAck(v === true)}
              className="mt-0.5"
            />
            我已确认这些内容不再需要，并知晓浏览器数据清除、存储回收或磁盘变动可能让隔离内容提前丢失、无法恢复。
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!clearAck}
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