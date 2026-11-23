import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  File,
  Folder,
  Lock,
  Stethoscope,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { QUARANTINE_TTL_DAYS, REVIVAL_LABEL, REVIVAL_ORDER, VERDICT_LABEL } from "@/src/core/constants";
import type { JudgedEntry } from "@/src/core/types";
import { entrySummary } from "./EntryRow";
import {
  Meter,
  OWNER_KIND_LABEL,
  OwnerKindIcon,
  SizeValue,
  SourceTag,
  VerdictBadge,
  VERDICT_TONE,
  formatDateTime,
} from "./shared";

export interface EntryDrawerProps {
  entry: JudgedEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: boolean;
  onToggleSelect: (entry: JudgedEntry, selected: boolean) => void;
  onQuarantine: (entry: JudgedEntry) => void;
  onDiagnose: (entry: JudgedEntry) => void;
  onNavigate?: (delta: number) => void;
  position?: { index: number; total: number } | null;
  busy?: boolean;
}

function purposeOf(entry: JudgedEntry): string {
  if (entry.hit?.purpose) return entry.hit.purpose;
  if (entry.isEmptyDir) return "空目录。可能是软件预留的工作区，也可能是卸载后剩下的空壳，需要人工判断是否无主。";
  if (entry.kind === "file") return "普通文件，未命中指纹库。按所在目录与扩展名启发式判断，建议先隔离观察。";
  return `未识别目录，含 ${entry.fileCount} 个文件。云端 AI 判定后会在这里说明它是什么。`;
}

function consequenceOf(entry: JudgedEntry): string {
  if (entry.hit?.consequence) return entry.hit.consequence;
  if (entry.verdict === "keep_locked") return "删除可能导致系统或软件无法正常运行。";
  return `先移入隔离区观察 ${QUARANTINE_TTL_DAYS} 天，确认无影响后再彻底清理，期间随时可还原到原位置。`;
}

function verdictLine(entry: JudgedEntry): string {
  if (entry.verdict === "keep_locked") return "不能删：已被系统规则锁定，不参与勾选。";
  if (entry.verdict === "safe_delete") return "可以删：缓存 / 临时 / 可重建内容，删了不影响使用。";
  return "需要你确认：可能有价值或有风险，看清理由再决定。";
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("路径已复制");
  } catch {
    toast.error("复制失败，请手动选择路径文本");
  }
}

function Step({
  index,
  title,
  tone,
  children,
}: {
  index: string;
  title: string;
  tone: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("relative grid gap-1.5 pl-6", tone)}>
      <span
        aria-hidden
        className="dc-tone-text absolute top-0.5 left-0 grid size-4 place-content-center rounded-full border border-current text-[10px]"
      >
        {index}
      </span>
      <span aria-hidden className="absolute top-5 bottom-0 left-[7px] w-px bg-border" />
      <h3 className="dc-label dc-tone-text">{title}</h3>
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function DrawerBody({
  entry,
  selected,
  onToggleSelect,
  onQuarantine,
  onDiagnose,
  onNavigate,
  position,
  busy,
}: Omit<EntryDrawerProps, "open" | "onOpenChange"> & { entry: JudgedEntry }) {
  const hit = entry.hit;
  const locked = entry.locked || entry.verdict === "keep_locked";
  const KindIcon = entry.kind === "directory" ? Folder : File;
  const revival = hit?.revival ?? [];
  const orderedRevival = [...revival].sort(
    (a, b) => REVIVAL_ORDER.indexOf(a) - REVIVAL_ORDER.indexOf(b),
  );

  return (
    <div data-region="entry-drawer" className="flex min-h-0 flex-1 flex-col">
      <header className={cn("dc-rail shrink-0 border-b border-border px-4 py-3.5", VERDICT_TONE[entry.verdict])}>
        <div className="flex items-start gap-3">
          <span className={cn("dc-tone-bg dc-tone-border grid size-10 shrink-0 place-content-center rounded-lg border", VERDICT_TONE[entry.verdict])}>
            <KindIcon aria-hidden className={cn("dc-tone-text size-5", VERDICT_TONE[entry.verdict])} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="dc-label">条目档案 / ENTRY</p>
            <h2 className="dc-display mt-0.5 truncate text-lg font-semibold">{entry.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <VerdictBadge verdict={entry.verdict} />
              <SourceTag source={entry.source} />
              <SizeValue bytes={entry.size} />
            </div>
          </div>
        </div>

        {position && position.total > 1 && (
          <div className="mt-3 flex items-center gap-2">
            <Button variant="outline" size="icon-xs" aria-label="上一项" onClick={() => onNavigate?.(-1)}>
              <ChevronLeft aria-hidden />
            </Button>
            <Button variant="outline" size="icon-xs" aria-label="下一项" onClick={() => onNavigate?.(1)}>
              <ChevronRight aria-hidden />
            </Button>
            <span className="dc-num text-xs text-muted-foreground">
              {position.index + 1} / {position.total}
            </span>
            <span className="ml-auto hidden text-[11px] text-muted-foreground sm:block">← → 切换条目</span>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid gap-4">
          <Step index="1" title="这是什么" tone="dc-tone-info">
            <p>{purposeOf(entry)}</p>
          </Step>

          <Step index="2" title="能不能删" tone={VERDICT_TONE[entry.verdict]}>
            <p className={cn("dc-tone-text font-medium", VERDICT_TONE[entry.verdict])}>{verdictLine(entry)}</p>
            <p className="mt-1 text-muted-foreground">{entrySummary(entry)}</p>
          </Step>

          <Step index="3" title="删了会怎样" tone="dc-tone-review">
            <p>{consequenceOf(entry)}</p>
            {!locked && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                洁灵的做法是移入隔离区而不是直接删除：{QUARANTINE_TTL_DAYS} 天内一键还原，到期后仍需你确认才彻底删除。
              </p>
            )}
          </Step>

          <div className="dc-panel grid gap-3 p-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-0.5">
                <p className="dc-label">归属</p>
                <p className="flex items-center gap-1.5 text-sm">
                  <OwnerKindIcon kind={hit?.ownerKind ?? "unknown"} className="text-muted-foreground" />
                  {hit?.owner ?? "未识别"}
                  <span className="text-xs text-muted-foreground">（{OWNER_KIND_LABEL[hit?.ownerKind ?? "unknown"]}）</span>
                </p>
              </div>
              <div className="grid gap-0.5">
                <p className="dc-label">构成</p>
                <p className="dc-num text-sm">
                  {entry.kind === "directory" ? `${entry.fileCount} 个文件` : "单个文件"}
                  {entry.isEmptyDir && <span className="ml-1 font-sans text-xs text-muted-foreground">· 空目录</span>}
                </p>
              </div>
              <div className="grid gap-0.5">
                <p className="dc-label">最后修改</p>
                <p className="dc-num text-sm">{entry.lastModified ? formatDateTime(entry.lastModified) : "未知"}</p>
              </div>
              <div className="grid gap-0.5">
                <p className="dc-label">层级深度</p>
                <p className="dc-num text-sm">{entry.depth}</p>
              </div>
            </div>
            <div className="grid gap-1">
              <p className="dc-label">完整路径（相对扫描根）</p>
              <div className="flex items-start gap-2">
                <p className="dc-path min-w-0 flex-1 break-all text-foreground">{entry.path}</p>
                <Button variant="ghost" size="icon-xs" aria-label="复制路径" onClick={() => void copyText(entry.path)}>
                  <Copy aria-hidden />
                </Button>
              </div>
            </div>
            {hit && (
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="dc-label">判定置信度</p>
                  <p className="dc-num text-sm font-semibold">{Math.round(hit.confidence * 100)}%</p>
                </div>
                <Meter
                  value={hit.confidence}
                  tone={hit.confidence >= 0.8 ? "dc-tone-safe" : hit.confidence >= 0.5 ? "dc-tone-review" : "dc-tone-danger"}
                  label="判定置信度"
                />
                <p className="text-xs text-muted-foreground">
                  {hit.rebuildable ? "删除后可由软件自动重建。" : "删除后不会自动重建，需要时请从隔离区还原。"}
                  {hit.fingerprintId && <span className="dc-path ml-1 opacity-70">#{hit.fingerprintId}</span>}
                </p>
              </div>
            )}
          </div>

          {hit && hit.evidence.length > 0 && (
            <div className="grid gap-1.5">
              <p className="dc-label">判断依据</p>
              <ul className="dc-panel grid gap-1 p-3">
                {hit.evidence.map((item) => (
                  <li key={item} className="dc-path flex items-start gap-2 break-all text-muted-foreground">
                    <span aria-hidden className="dc-tone-info dc-tone-text mt-1.5 size-1 shrink-0 rounded-full bg-current" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {orderedRevival.length > 0 && (
            <div className="dc-panel dc-tone-review dc-rail grid gap-2 p-3.5">
              <p className="dc-label dc-tone-text">复活风险 · 先断来源再删文件</p>
              <ol className="grid gap-1.5">
                {orderedRevival.map((m, i) => (
                  <li key={m} className="flex items-start gap-2 text-sm">
                    <span className="dc-num dc-tone-review dc-tone-text mt-0.5 text-xs">{i + 1}</span>
                    <span>{REVIVAL_LABEL[m] ?? m}</span>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted-foreground">
                只删文件夹无效：服务、计划任务或注册表会把它重建回来。到「复活诊断」生成只读脚本，切断来源后再清理。
              </p>
              <Button variant="outline" size="sm" className="w-fit" onClick={() => onDiagnose(entry)}>
                <Stethoscope aria-hidden />
                带这一项去诊断
              </Button>
            </div>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border bg-raise/60 px-4 py-3">
        {locked ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock aria-hidden className="size-4 shrink-0" />
            {VERDICT_LABEL.keep_locked}：已锁定，不参与勾选，也不会被移入隔离区。
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={selected ? "secondary" : "outline"}
              onClick={() => onToggleSelect(entry, !selected)}
              aria-pressed={selected}
            >
              {selected ? <Check aria-hidden /> : <Archive aria-hidden />}
              {selected ? "已勾选" : "勾选这一项"}
            </Button>
            <Button className="ml-auto" disabled={busy} onClick={() => onQuarantine(entry)}>
              <Archive aria-hidden />
              移入隔离区
            </Button>
          </div>
        )}
      </footer>
    </div>
  );
}

export function EntryDrawer({
  entry,
  open,
  onOpenChange,
  ...rest
}: EntryDrawerProps) {
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { onNavigate } = rest;

  // 方向键在抽屉任意位置都生效（焦点可能落在关闭按钮或底部动作上）
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!onNavigate) return;
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    if (event.key === "ArrowLeft") { event.preventDefault(); onNavigate(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); onNavigate(1); }
  }, [onNavigate]);

  if (!entry) return null;
  const description = purposeOf(entry);

  // 首帧后再决定形态，避免 SSR/首屏宽度未知时抽屉方向闪跳
  if (!mounted) return null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
        <DrawerContent
          className="dc-drawer-bottom max-h-[88dvh] gap-0 rounded-t-2xl p-0"
          onKeyDown={onKeyDown}
        >
          <DrawerTitle className="sr-only">{entry.name} 的清理决策详情</DrawerTitle>
          <DrawerDescription className="sr-only">{description}</DrawerDescription>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="关闭详情抽屉"
            className="dc-press absolute top-2.5 right-3 z-10 grid size-7 place-content-center rounded-md border border-border bg-panel/80 text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
          <DrawerBody entry={entry} {...rest} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="dc-drawer w-full gap-0 p-0 sm:max-w-md"
        showCloseButton={false}
        onKeyDown={onKeyDown}
      >
        <SheetTitle className="sr-only">{entry.name} 的清理决策详情</SheetTitle>
        <SheetDescription className="sr-only">{description}</SheetDescription>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="关闭详情抽屉"
          className="dc-press absolute top-3 right-3 z-10 grid size-7 place-content-center rounded-md border border-border bg-panel/80 text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
        </button>
        <DrawerBody entry={entry} {...rest} />
      </SheetContent>
    </Sheet>
  );
}