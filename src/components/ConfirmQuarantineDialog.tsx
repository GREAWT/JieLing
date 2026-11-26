import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Archive, GripHorizontal, ShieldCheck, TriangleAlert, Undo2 } from "lucide-react";
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
import { QUARANTINE_TTL_DAYS, rebuildMechanisms } from "@/src/core/constants";
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

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

const VIEWPORT_MARGIN = 8;

export function ConfirmQuarantineDialog({
  open,
  onOpenChange,
  entries,
  onConfirm,
  busy = false,
  busyLabel = null,
}: ConfirmQuarantineDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
  const revivalCount = entries.filter((entry) => rebuildMechanisms(entry.hit?.revival ?? []).length > 0).length;
  const occupiedCount = entries.filter((entry) => entry.hit?.revival.includes("process_lock")).length;

  const constrainOffset = useCallback((candidate: { x: number; y: number }) => {
    const node = contentRef.current;
    if (!node) return candidate;
    const maxX = Math.max(0, (window.innerWidth - node.offsetWidth) / 2 - VIEWPORT_MARGIN);
    const maxY = Math.max(0, (window.innerHeight - node.offsetHeight) / 2 - VIEWPORT_MARGIN);
    return {
      x: Math.min(maxX, Math.max(-maxX, candidate.x)),
      y: Math.min(maxY, Math.max(-maxY, candidate.y)),
    };
  }, []);

  useEffect(() => {
    if (!open) {
      dragRef.current = null;
      offsetRef.current = { x: 0, y: 0 };
      setOffset({ x: 0, y: 0 });
      setDragging(false);
      return;
    }

    offsetRef.current = { x: 0, y: 0 };
    setOffset({ x: 0, y: 0 });
    let observer: ResizeObserver | null = null;
    const keepVisible = () => {
      const next = constrainOffset(offsetRef.current);
      offsetRef.current = next;
      setOffset((current) => current.x === next.x && current.y === next.y ? current : next);
    };
    const frame = requestAnimationFrame(() => {
      const node = contentRef.current;
      if (!node) return;
      observer = new ResizeObserver(keepVisible);
      observer.observe(node);
      keepVisible();
    });
    window.addEventListener("resize", keepVisible);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", keepVisible);
    };
  }, [open, constrainOffset]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
    };
    setDragging(true);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const next = constrainOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
    offsetRef.current = next;
    setOffset(next);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent
        ref={contentRef}
        data-dragging={dragging || undefined}
        className="fixed! dc-panel dc-brackets dc-tone-safe flex! max-h-[calc(100dvh-1rem)] flex-col gap-4 overflow-hidden rounded-xl sm:max-w-lg"
        style={{ translate: `calc(-50% + ${offset.x}px) calc(-50% + ${offset.y}px)` }}
      >
        <DialogHeader
          className="group/drag-handle -mx-1 shrink-0 cursor-grab touch-none select-none gap-2 rounded-md px-1 py-1 pr-10 active:cursor-grabbing"
          data-dragging={dragging || undefined}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={() => {
            dragRef.current = null;
            setDragging(false);
          }}
          onDragStart={(event) => event.preventDefault()}
        >
          <div className="flex items-center gap-2">
            <span className="dc-label dc-tone-text flex items-center gap-2">
              <Archive aria-hidden className="size-3.5" />
              QUARANTINE · 可撤回操作
            </span>
            <span className="dc-label ml-auto inline-flex items-center gap-1 text-muted-foreground group-data-[dragging=true]/drag-handle:text-foreground">
              <GripHorizontal aria-hidden className="size-3.5" />
              拖动
            </span>
          </div>
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

        <div
          data-quarantine-scroll
          className="grid min-h-0 flex-1 gap-3 overflow-y-auto overscroll-contain pr-1"
        >
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
              其中 {revivalCount} 项存在删后重建风险，建议先到「顽固软件诊断」核对来源，再回来隔离。
            </p>
          )}

          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <Undo2 aria-hidden className="dc-tone-safe dc-tone-text mt-0.5 size-3.5 shrink-0" />
            隔离区独立于回收站，不占用回收站空间；到期后仍需你确认才会彻底删除。
          </p>
          {occupiedCount > 0 && (
            <p className="dc-tone-review dc-tone-text text-xs leading-relaxed">
              {occupiedCount} 项正在使用，请先关闭相关程序后重试；进程占用不属于删后重建。
            </p>
          )}
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck aria-hidden className="dc-tone-info dc-tone-text mt-0.5 size-3.5 shrink-0" />
            演示模式会预检沙箱剩余空间；真实磁盘浏览器读不到剩余空间，
            因此一律先复制并校验、再移除原文件。文件使用完整 SHA-256，超过 32 MB 时使用首尾采样哈希；
            目录只校验结构与大小，不声称逐字节校验全部内容。空间不足或校验失败时原文件保留并报告原因。
          </p>
        </div>

        <DialogFooter className="shrink-0 gap-2">
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