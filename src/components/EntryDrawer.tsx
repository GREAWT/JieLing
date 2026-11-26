import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  File,
  Folder,
  FolderTree,
  Lock,
  ScanSearch,
  Search,
  Stethoscope,
  TriangleAlert,
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
import { QUARANTINE_TTL_DAYS, REVIVAL_LABEL, REVIVAL_ORDER, VERDICT_ACTION, VERDICT_LABEL, confidenceLabel, rebuildMechanisms } from "@/src/core/constants";
import type { JudgedEntry, ScanEntry } from "@/src/core/types";
import { entrySummary } from "./EntryRow";
import {
  Meter,
  OWNER_KIND_LABEL,
  OwnerKindIcon,
  EntrySemanticBadges,
  SizeValue,
  SourceTag,
  VerdictBadge,
  VERDICT_TONE,
  formatBytes,
  formatDateTime,
} from "./shared";

export interface EntryDrawerProps {
  entry: JudgedEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected?: boolean;
  onToggleSelect?: (entry: JudgedEntry, selected: boolean) => void;
  onQuarantine?: (entry: JudgedEntry) => void;
  onDiagnose?: (entry: JudgedEntry) => void;
  onNavigate?: (delta: number) => void;
  position?: { index: number; total: number } | null;
  busy?: boolean;
  preview?: boolean;
  defaultAction?: string;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  allEntries?: readonly ScanEntry[];
  onScanSubdirectory?: (entry: JudgedEntry) => void;
}

function purposeOf(entry: JudgedEntry): string {
  if (entry.hit?.purpose) return entry.hit.purpose;
  if (entry.isEmptyDir) return "空目录。可能是软件预留的工作区，也可能是卸载后剩下的空壳，需要人工判断是否无主。";
  if (entry.kind === "file") return "普通文件，未命中指纹库。按所在目录与扩展名启发式判断，建议先隔离观察。";
  return `未识别目录，含 ${entry.fileCount} 个文件。云端 AI 判定后会在这里说明它是什么。`;
}

function consequenceOf(entry: JudgedEntry): string {
  if (entry.hit?.revival.includes("process_lock")) return "正在使用，关闭相关程序后重试。进程占用不是删后重建。";
  if (entry.hit?.consequence) return entry.hit.consequence;
  if (entry.verdict === "keep_locked") return "删除可能导致系统或软件无法正常运行。";
  return `先移入隔离区观察 ${QUARANTINE_TTL_DAYS} 天，确认无影响后再彻底清理，期间随时可还原到原位置。`;
}

function verdictLine(entry: JudgedEntry): string {
  if (entry.verdict === "keep_locked") return `${VERDICT_LABEL.keep_locked}：已被系统规则锁定，禁止勾选，也不会被移入隔离区。`;
  if (entry.verdict === "safe_delete") return `${VERDICT_LABEL.safe_delete}：命中经过审查的本地指纹；通常可重建，仍需确认软件未运行。`;
  return `${VERDICT_LABEL.needs_review}：可能有价值或有风险，看清依据与后果再决定。`;
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

type TreeState = "complete" | "empty" | "partial";

const TREE_STATE: Record<TreeState, { label: string; tone: string; hint: string }> = {
  complete: {
    label: "完成",
    tone: "dc-tone-safe",
    hint: "扫描完成，展开只是查看已读结果，不参与勾选、隔离或删除",
  },
  empty: {
    label: "空结果",
    tone: "dc-tone-locked",
    hint: "扫描完成，但目录里没有可展开内容",
  },
  partial: {
    label: "部分结果",
    tone: "dc-tone-review",
    hint: "部分结果：覆盖不完整，可用右侧按钮只读扫描",
  },
};

function treeStateOf(root: ScanEntry): TreeState {
  const complete = root.coverage.length === 1 && root.coverage[0] === "complete";
  if (!complete) return "partial";
  return root.childIds.length === 0 ? "empty" : "complete";
}

function ReadonlyTree({ root, entries }: { root: ScanEntry; entries: readonly ScanEntry[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set([root.id]));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const MAX_CHILDREN = 300;

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderNode = (node: ScanEntry, depth: number, path: Set<string>): ReactNode => {
    const children = node.childIds.map((id) => byId.get(id)).filter((child): child is ScanEntry => Boolean(child));
    const visible = children.slice(0, MAX_CHILDREN);
    const protectedNode = typeof (node as JudgedEntry).locked === "boolean" && (node as JudgedEntry).locked;
    const incomplete = node.kind === "directory" && !(node.coverage.length === 1 && node.coverage[0] === "complete");
    const Icon = node.kind === "directory" ? Folder : File;
    const expanded = open.has(node.id);
    return (
      <li key={node.id}>
        <div
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          {node.kind === "directory" && children.length > 0 ? (
            <button
              type="button"
              className="grid size-5 shrink-0 place-content-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label={`${expanded ? "收起" : "展开"} ${node.name}`}
              onClick={() => toggle(node.id)}
            >
              <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}
          <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("min-w-0 flex-1 truncate text-xs", protectedNode && "dc-tone-locked dc-tone-text")}>
            {node.name}
          </span>
          {node.kind === "directory" && incomplete && <span className="dc-tone-review dc-tone-text text-[10px]">覆盖不完整</span>}
          {protectedNode && <Lock aria-label="默认保护" className="size-3 shrink-0 text-muted-foreground" />}
          <span className="dc-num shrink-0 text-[10px] text-muted-foreground">{formatBytes(node.size)}</span>
        </div>
        {expanded && children.length > 0 && (
          <ul>
            {visible.map((child) => path.has(child.id) ? null : renderNode(child, depth + 1, new Set([...path, child.id])))}
            {children.length > visible.length && (
              <li className="px-4 py-1 text-[10px] text-muted-foreground">其余 {children.length - visible.length} 项为避免卡顿未展开</li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const children = root.childIds.map((id) => byId.get(id)).filter((child): child is ScanEntry => Boolean(child));
  if (root.kind !== "directory") return null;
  if (children.length === 0) {
    return (
      <p className="rounded-md border border-hairline px-3 py-2 text-xs text-muted-foreground">
        {root.coverage.length === 1 && root.coverage[0] === "complete"
          ? "此目录为空，没有可展开内容。"
          : "此目录的子树未被完整扫描；可用下方“只读扫描此目录”单独递归读取。"}
      </p>
    );
  }
  return <ul data-readonly-tree className="max-h-72 overflow-auto rounded-md border border-hairline py-1">{renderNode(root, 0, new Set([root.id]))}</ul>;
}

function PreviewDrawerBody({ entry, defaultAction }: { entry: JudgedEntry; defaultAction?: string }) {
  const hit = entry.hit;
  const KindIcon = entry.kind === "directory" ? Folder : File;
  const reason = entry.hit?.reason ?? entrySummary(entry);

  return (
    <div data-region="entry-preview-drawer" className="flex min-h-0 flex-1 flex-col">
      <header className={cn("dc-rail shrink-0 border-b border-border px-4 py-3.5 pr-12", VERDICT_TONE[entry.verdict])}>
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("dc-tone-bg dc-tone-border grid size-10 shrink-0 place-content-center rounded-lg border", VERDICT_TONE[entry.verdict])}>
            <KindIcon aria-hidden className={cn("dc-tone-text size-5", VERDICT_TONE[entry.verdict])} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="dc-label">样本条目 / READ ONLY</p>
            <h2 className="dc-display mt-0.5 truncate text-lg font-semibold">{entry.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <VerdictBadge verdict={entry.verdict} />
              <span className="inline-flex items-baseline gap-1 text-xs text-muted-foreground">
                <span className="dc-label">占用</span>
                <SizeValue bytes={entry.size} />
              </span>
            </div>
          </div>
        </div>
      </header>

      <div
        data-preview-scroll
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
      >
        <div className="grid min-w-0 gap-4">
          <section className="grid min-w-0 gap-1">
            <p className="dc-label">完整路径（相对扫描根）</p>
            <p className="dc-path min-w-0 break-all text-foreground [overflow-wrap:anywhere]">{entry.path}</p>
          </section>

          <Step index="1" title="这是什么" tone="dc-tone-info">
            <p>{purposeOf(entry)}</p>
          </Step>

          <Step index="2" title="判定理由" tone={VERDICT_TONE[entry.verdict]}>
            <p>{reason}</p>
          </Step>

          <Step index="3" title="可能后果" tone="dc-tone-review">
            <p>{consequenceOf(entry)}</p>
          </Step>

          <section className="grid gap-1.5 border-t border-hairline pt-4">
            <p className="dc-label">默认处理方式</p>
            <p className="text-sm leading-relaxed">{defaultAction ?? VERDICT_ACTION[entry.verdict]}</p>
          </section>

          <section className="grid gap-3 border-t border-hairline pt-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-0.5">
              <p className="dc-label">判定置信度</p>
              <p className="dc-num text-sm font-semibold">
                {hit ? `${confidenceLabel(hit.confidence)}（依据下方匹配证据）` : "低（仅按位置与类型启发式判断）"}
              </p>
            </div>
            <div className="grid min-w-0 gap-0.5">
              <p className="dc-label">指纹编号</p>
              <p className="dc-path min-w-0 break-all text-sm">{hit?.fingerprintId ?? "未命中本地规则"}</p>
            </div>
          </section>
          {hit && hit.evidence.length > 0 && (
            <section className="grid gap-1.5 border-t border-hairline pt-4">
              <p className="dc-label">匹配证据</p>
              <ul className="grid gap-1 text-xs leading-relaxed text-muted-foreground">
                {hit.evidence.map((item) => <li key={item}>· {item}</li>)}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function DrawerBody({
  entry,
  selected = false,
  onToggleSelect,
  onQuarantine,
  onDiagnose,
  onNavigate,
  position,
  busy,
  allEntries,
  onScanSubdirectory,
}: Omit<EntryDrawerProps, "open" | "onOpenChange"> & { entry: JudgedEntry }) {
  const hit = entry.hit;
  const locked = entry.locked || entry.verdict === "keep_locked";
  const KindIcon = entry.kind === "directory" ? Folder : File;
  const treeState = entry.kind === "directory" ? treeStateOf(entry) : null;
  const treeMeta = treeState ? TREE_STATE[treeState] : null;
  const revival = hit?.revival ?? [];
  const orderedRevival = rebuildMechanisms(revival).sort(
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
              {hit && <EntrySemanticBadges mechanisms={hit.revival} rebuildable={hit.rebuildable} />}
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
            <span className="ml-auto hidden text-xs text-muted-foreground sm:block">← → 切换条目</span>
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

          {/* 抽屉本身已是卡片：内部用分隔线与间距组织，不再套描边面板 */}
          <div className="grid gap-3 border-t border-hairline pt-4">
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
            <div className="grid gap-1 border-t border-hairline pt-3">
              <p className="dc-label">完整路径（相对扫描根）</p>
              <div className="flex items-start gap-2">
                <p className="dc-path min-w-0 flex-1 break-all text-foreground">{entry.path}</p>
                <Button variant="ghost" size="icon-xs" aria-label="复制路径" onClick={() => void copyText(entry.path)}>
                  <Copy aria-hidden />
                </Button>
              </div>
            </div>
            {entry.kind === "directory" && allEntries && (
              <div className="grid gap-2 border-t border-hairline pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="dc-label flex items-center gap-1.5">
                    <FolderTree aria-hidden className="size-3.5" />
                    只读目录内容
                  </p>
                  {treeState && treeMeta && (
                    <span
                      data-readonly-tree-state={treeState}
                      className={cn(
                        "dc-tone-bg dc-tone-text dc-tone-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                        treeMeta.tone,
                      )}
                    >
                      {treeState === "complete"
                        ? <Check aria-hidden className="size-3" />
                        : treeState === "empty"
                          ? <Search aria-hidden className="size-3" />
                          : <TriangleAlert aria-hidden className="size-3" />}
                      {treeMeta.label}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {treeMeta?.hint ?? "可逐层展开，不参与勾选、隔离或删除"}
                  </span>
                  {onScanSubdirectory && (
                    <Button
                      variant="outline"
                      size="xs"
                      className="ml-auto"
                      disabled={busy}
                      onClick={() => onScanSubdirectory(entry)}
                    >
                      <ScanSearch aria-hidden />
                      只读扫描此目录
                    </Button>
                  )}
                </div>
                <ReadonlyTree root={entry} entries={allEntries} />
              </div>
            )}
            {hit && (
              <div className="grid gap-1.5 border-t border-hairline pt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="dc-label">判定置信度</p>
                  <p className="text-sm font-semibold">{confidenceLabel(hit.confidence)} · 依据已命中的名称、路径或结构条件</p>
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
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {hit.originDescription} · {hit.ruleScope === "exact_path" ? "精确目录" : "软件结构"}
                  · 版本 {hit.ruleVersion} · 验证于 {hit.verifiedAt} · 信任层级 {hit.trustLevel}
                </p>
              </div>
            )}
          </div>

          {hit && hit.evidence.length > 0 && (
            <div className="grid gap-1.5 border-t border-hairline pt-4">
              <p className="dc-label">判断依据</p>
              <ul className="grid gap-1.5">
                {hit.evidence.map((item) => (
                  <li key={item} className="dc-path flex items-start gap-2 break-all text-muted-foreground">
                    <span aria-hidden className="dc-tone-info dc-tone-text mt-1.5 size-1 shrink-0 rounded-full bg-current" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rebuildMechanisms(orderedRevival).length > 0 && onDiagnose && (
            <div className="dc-tone-review grid gap-2 border-t border-hairline pt-4">
              <p className="dc-label dc-tone-text">删后重建风险 · 先核对来源再删文件</p>
              <ol className="grid gap-1.5">
                {orderedRevival.map((m, i) => (
                  <li key={m} className="flex items-start gap-2 text-sm">
                    <span className="dc-num dc-tone-review dc-tone-text mt-0.5 text-xs">{i + 1}</span>
                    <span>{REVIVAL_LABEL[m] ?? m}</span>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted-foreground">
                服务、计划任务或启动项可能重新创建它。到「顽固软件诊断」生成只读脚本核对来源，确认后再处理。
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
              onClick={() => onToggleSelect?.(entry, !selected)}
              aria-pressed={selected}
            >
              {selected ? <Check aria-hidden /> : <Archive aria-hidden />}
              {selected ? "已勾选" : "勾选这一项"}
            </Button>
            <Button className="ml-auto" disabled={busy || !onQuarantine} onClick={() => onQuarantine?.(entry)}>
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
  preview = false,
  defaultAction,
  returnFocusRef,
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

  const handleCloseAutoFocus = useCallback((event: Event) => {
    if (!returnFocusRef?.current) return;
    event.preventDefault();
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [returnFocusRef]);

  if (!entry) return null;
  const description = purposeOf(entry);
  const title = preview ? `${entry.name} 的样本判定详情` : `${entry.name} 的清理决策详情`;
  const body = preview
    ? <PreviewDrawerBody entry={entry} defaultAction={defaultAction} />
    : <DrawerBody entry={entry} {...rest} />;

  // 首帧后再决定形态，避免 SSR/首屏宽度未知时抽屉方向闪跳
  if (!mounted) return null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} direction="bottom">
        <DrawerContent
          className="dc-drawer-bottom max-h-[88dvh] gap-0 overflow-hidden rounded-t-2xl p-0"
          onKeyDown={onKeyDown}
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <DrawerDescription className="sr-only">{description}</DrawerDescription>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="关闭详情抽屉"
            className="dc-press absolute top-2.5 right-3 z-10 grid size-7 place-content-center rounded-md border border-border bg-panel/80 text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="dc-drawer w-full gap-0 overflow-hidden p-0 sm:max-w-md"
        showCloseButton={false}
        onKeyDown={onKeyDown}
        onCloseAutoFocus={handleCloseAutoFocus}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{description}</SheetDescription>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="关闭详情抽屉"
          className="dc-press absolute top-3 right-3 z-10 grid size-7 place-content-center rounded-md border border-border bg-panel/80 text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden className="size-4" />
        </button>
        {body}
      </SheetContent>
    </Sheet>
  );
}