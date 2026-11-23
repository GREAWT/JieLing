import { useMemo, useState } from "react";
import {
  ChevronDown,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { VERDICT_LABEL } from "@/src/core/constants";
import type { JudgedEntry, OwnerGroup, ScanSource, Verdict } from "@/src/core/types";
import { OwnerGroupCard } from "./OwnerGroupCard";
import { EmptyState } from "./States";
import { SizeValue, ToneDot, VERDICT_TONE, formatBytes } from "./shared";

export interface ReviewBoardProps {
  groups: OwnerGroup[];
  selectedIds: ReadonlySet<string>;
  onToggleEntry: (entry: JudgedEntry, selected: boolean) => void;
  onToggleGroup: (group: OwnerGroup, selected: boolean) => void;
  onOpenEntry: (entry: JudgedEntry, visible: JudgedEntry[]) => void;
  onDiagnose?: (group: OwnerGroup) => void;
  activeEntryId?: string | null;
  loading?: boolean;
  scannedCount?: number;
  truncated?: boolean;
  stopped?: boolean;
  source?: ScanSource;
  onResetSandbox?: () => void;
  resetting?: boolean;
}

type SortKey = "priority" | "size" | "name";
type Filter = "all" | Verdict;

const SORT_LABEL: Record<SortKey, string> = {
  priority: "按决策优先级",
  size: "按体积从大到小",
  name: "按名称 A→Z",
};

const FILTER_HINT: Record<Filter, string> = {
  all: "全部待决策条目",
  safe_delete: "只看安全可删",
  needs_review: "只看需要你确认",
  keep_locked: "只看已保护项",
};

export function ReviewBoard({
  groups,
  selectedIds,
  onToggleEntry,
  onToggleGroup,
  onOpenEntry,
  onDiagnose,
  activeEntryId = null,
  loading = false,
  scannedCount = 0,
  truncated = false,
  stopped = false,
  source,
  onResetSandbox,
  resetting = false,
}: ReviewBoardProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("priority");
  const [onlyRevival, setOnlyRevival] = useState(false);
  const [lockedOpen, setLockedOpen] = useState(false);

  const totals = useMemo(() => {
    const acc = {
      safe_delete: { size: 0, count: 0 },
      needs_review: { size: 0, count: 0 },
      keep_locked: { size: 0, count: 0 },
    };
    let revivalGroups = 0;
    for (const g of groups) {
      for (const v of ["safe_delete", "needs_review", "keep_locked"] as Verdict[]) {
        acc[v].size += g.sizes[v];
        acc[v].count += g.counts[v];
      }
      if (g.revival.length > 0) revivalGroups += 1;
    }
    return { ...acc, revivalGroups };
  }, [groups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: OwnerGroup[] = [];
    for (const g of groups) {
      let entries = g.entries;
      if (filter !== "all") entries = entries.filter((e) => e.verdict === filter);
      if (onlyRevival) entries = entries.filter((e) => (e.hit?.revival.length ?? 0) > 0);
      if (q) {
        entries = entries.filter((e) =>
          e.name.toLowerCase().includes(q)
          || e.path.toLowerCase().includes(q)
          || g.owner.toLowerCase().includes(q)
          || (e.hit?.purpose ?? "").toLowerCase().includes(q));
      }
      if (entries.length === 0) continue;
      out.push({ ...g, entries, itemCount: entries.length });
    }
    out.sort((a, b) => {
      if (sort === "size") return b.totalSize - a.totalSize;
      if (sort === "name") return a.owner.localeCompare(b.owner, "zh-CN");
      const aLocked = a.selectableCount === 0 ? 1 : 0;
      const bLocked = b.selectableCount === 0 ? 1 : 0;
      if (aLocked !== bLocked) return aLocked - bLocked;
      return b.maxPriority - a.maxPriority || b.totalSize - a.totalSize;
    });
    return out;
  }, [groups, query, filter, onlyRevival, sort]);

  const actionable = filtered.filter((g) => g.selectableCount > 0);
  const protectedGroups = filtered.filter((g) => g.selectableCount === 0);
  const showProtectedInline = filter === "keep_locked";
  const visibleEntries = useMemo(
    () => [...actionable, ...(showProtectedInline ? [] : protectedGroups)].flatMap((g) => g.entries),
    [actionable, protectedGroups, showProtectedInline],
  );
  const filtering = filter !== "all" || onlyRevival || query.trim().length > 0;
  const listedCount = visibleEntries.length;

  if (loading) {
    return (
      <div aria-label="正在加载审核结果" className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        title="没有可审核的内容"
        description="扫描完成后，这里会按归属软件列出清理建议，并说明每一项为什么能删、删了会怎样。"
      />
    );
  }

  const tiles: {
    key: string;
    label: string;
    tone: string;
    value: number;
    unit: string;
    sub: string;
    active: boolean;
    onClick: () => void;
  }[] = [
    {
      key: "safe",
      label: VERDICT_LABEL.safe_delete,
      tone: VERDICT_TONE.safe_delete,
      value: totals.safe_delete.size,
      unit: "",
      sub: `${totals.safe_delete.count} 项 · 删了不影响使用`,
      active: filter === "safe_delete",
      onClick: () => setFilter((f) => (f === "safe_delete" ? "all" : "safe_delete")),
    },
    {
      key: "review",
      label: VERDICT_LABEL.needs_review,
      tone: VERDICT_TONE.needs_review,
      value: totals.needs_review.size,
      unit: "",
      sub: `${totals.needs_review.count} 项 · 看清理由再决定`,
      active: filter === "needs_review",
      onClick: () => setFilter((f) => (f === "needs_review" ? "all" : "needs_review")),
    },
    {
      key: "locked",
      label: VERDICT_LABEL.keep_locked,
      tone: VERDICT_TONE.keep_locked,
      value: totals.keep_locked.size,
      unit: "",
      sub: `${totals.keep_locked.count} 项 · 已锁定，不参与勾选`,
      active: filter === "keep_locked",
      onClick: () => setFilter((f) => (f === "keep_locked" ? "all" : "keep_locked")),
    },
    {
      key: "revival",
      label: "会复活",
      tone: "dc-tone-ai",
      value: totals.revivalGroups,
      unit: "个软件",
      sub: "删了会被重建 · 需先断来源",
      active: onlyRevival,
      onClick: () => setOnlyRevival((v) => !v),
    },
  ];

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <button
            key={t.key}
            type="button"
            onClick={t.onClick}
            aria-pressed={t.active}
            style={{ animationDelay: `${i * 45}ms` }}
            className={cn(
              "dc-panel dc-brackets dc-lift dc-rail dc-rise dc-press cursor-pointer px-4 py-3 text-left outline-none",
              "focus-visible:ring-[3px] focus-visible:ring-ring/50",
              t.tone,
              t.active && "ring-2 ring-inset ring-current/40",
            )}
          >
            <span className="flex items-center gap-2">
              <ToneDot tone={t.tone} live={t.key === "revival" && t.value > 0} />
              <span className="dc-label">{t.label}</span>
              {t.active && <span className="dc-label ml-auto text-current">筛选中</span>}
            </span>
            <span className="mt-1.5 flex items-baseline gap-1.5">
              {t.unit ? (
                <span className="dc-num text-2xl font-semibold">{t.value}</span>
              ) : (
                <SizeValue bytes={t.value} large />
              )}
              {t.unit && <span className="text-xs text-muted-foreground">{t.unit}</span>}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{t.sub}</span>
          </button>
        ))}
      </div>

      <div className="dc-panel flex flex-wrap items-center gap-2 px-3 py-2.5">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称、路径或用途…"
            aria-label="搜索条目"
            className="h-8 pr-8 pl-8"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="清除搜索"
              className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-content-center rounded text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          )}
        </div>

        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger size="sm" aria-label="排序方式" className="w-44">
            <SlidersHorizontal aria-hidden className="size-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <SelectItem key={k} value={k}>{SORT_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant={onlyRevival ? "secondary" : "outline"}
          size="sm"
          aria-pressed={onlyRevival}
          onClick={() => setOnlyRevival((v) => !v)}
        >
          <TriangleAlert aria-hidden />
          只看会复活
        </Button>

        {filtering && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFilter("all"); setOnlyRevival(false); setQuery(""); }}
          >
            <X aria-hidden />
            清除筛选
          </Button>
        )}

        {source === "sandbox" && onResetSandbox && (
          <Button variant="ghost" size="sm" onClick={onResetSandbox} disabled={resetting}>
            <RefreshCw aria-hidden className={cn(resetting && "animate-spin")} />
            重置样本
          </Button>
        )}

        <p className="dc-num ml-auto text-xs text-muted-foreground">
          {filtering ? `${listedCount} / ${groups.reduce((s, g) => s + g.itemCount, 0)} 项` : `${listedCount} 项待决策`}
          <span className="ml-2 font-sans">共扫描 {scannedCount.toLocaleString("zh-CN")} 项</span>
        </p>
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-muted-foreground">
        <span className="dc-label">{FILTER_HINT[filter]}</span>
        {filtering && <span>· 体积为该归属合计，不随筛选变化</span>}
        {truncated && <span className="dc-tone-review dc-tone-text">· 已达扫描上限，结果不完整</span>}
        {stopped && <span className="dc-tone-info dc-tone-text">· 已手动停止，这是部分结果</span>}
        <span>· 中间容器与普通文件不单独列出，点任意一行看抽屉详情</span>
      </p>

      {listedCount === 0 ? (
        <EmptyState
          icon={<Search aria-hidden />}
          title="没有匹配的条目"
          description="换个关键词，或清除筛选回到全部待决策内容。"
          action={
            <Button variant="outline" onClick={() => { setFilter("all"); setOnlyRevival(false); setQuery(""); }}>
              <X aria-hidden />
              清除筛选
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {(showProtectedInline ? filtered : actionable).map((group, i) => (
            <OwnerGroupCard
              key={group.owner}
              group={group}
              selectedIds={selectedIds}
              onToggleEntry={onToggleEntry}
              onToggleGroup={onToggleGroup}
              onOpenEntry={(entry) => onOpenEntry(entry, visibleEntries)}
              onDiagnose={onDiagnose}
              activeEntryId={activeEntryId}
              defaultOpen={showProtectedInline ? true : i < 6}
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
            />
          ))}
        </div>
      )}

      {!showProtectedInline && protectedGroups.length > 0 && (
        <Collapsible open={lockedOpen} onOpenChange={setLockedOpen}>
          <section aria-label={VERDICT_LABEL.keep_locked} className="dc-panel dc-tone-locked dc-rail overflow-hidden">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="dc-press flex w-full items-center gap-2 px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Lock aria-hidden className="size-4 text-muted-foreground" />
                <span className="dc-display text-sm font-semibold">{VERDICT_LABEL.keep_locked}</span>
                <span className="dc-num text-xs text-muted-foreground">
                  {protectedGroups.length} 组 · {formatBytes(protectedGroups.reduce((s, g) => s + g.totalSize, 0))}
                </span>
                <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                  不参与勾选
                  <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-200", lockedOpen && "rotate-180")} />
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="grid gap-3 border-t border-border p-3">
              <p className="flex items-start gap-2 px-1 text-[13px] leading-relaxed text-muted-foreground">
                <ShieldCheck aria-hidden className="dc-tone-safe dc-tone-text mt-0.5 size-4 shrink-0" />
                系统与软件关键文件。洁灵不会把它们放进勾选范围，展开只是为了让你看清「为什么别删」。
              </p>
              {protectedGroups.map((group) => (
                <OwnerGroupCard
                  key={group.owner}
                  group={group}
                  selectedIds={selectedIds}
                  onToggleEntry={onToggleEntry}
                  onToggleGroup={onToggleGroup}
                  onOpenEntry={(entry) => onOpenEntry(entry, visibleEntries)}
                  onDiagnose={onDiagnose}
                  activeEntryId={activeEntryId}
                  defaultOpen={false}
                  selectionDisabled
                />
              ))}
            </CollapsibleContent>
          </section>
        </Collapsible>
      )}
    </div>
  );
}