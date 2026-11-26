import { VERDICT_ORDER } from "@/src/core/constants";
import type { JudgedEntry, OwnerGroup, Verdict } from "@/src/core/types";

type EntryOrder = Pick<JudgedEntry, "verdict" | "priority">;
type SearchableEntry = Pick<JudgedEntry, "id" | "name" | "path" | "parentId"> & {
  hit?: { purpose?: string } | null;
};

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\\/g, "/");
}

function matchesSearchTokens(text: string, tokens: readonly string[]): boolean {
  const normalized = normalizeSearchText(text);
  return tokens.every((token) => normalized.includes(token));
}

function entrySearchText(entry: SearchableEntry): string {
  return `${entry.name}\n${entry.path}\n${entry.hit?.purpose ?? ""}`;
}

/**
 * 搜索必须覆盖全部扫描条目：命中的普通文件或中间目录没有独立卡片时，
 * 落到最近的可见候选目录上，避免用户搜到路径却看不到任何结果。
 */
export function searchReviewEntries<T extends SearchableEntry>(
  groups: readonly { owner: string; entries: readonly T[] }[],
  scanEntries: readonly SearchableEntry[],
  query: string,
): {
  ids: ReadonlySet<string>;
  scannedHits: number;
  /** 被吸收的内部文件命中，按最近可见条目的 id 归档，供卡片显示命中了什么 */
  hiddenMatches: ReadonlyMap<string, readonly string[]>;
} {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ids: new Set(), scannedHits: 0, hiddenMatches: new Map() };

  const byId = new Map<string, SearchableEntry>();
  for (const entry of scanEntries) byId.set(entry.id, entry);
  for (const group of groups) {
    for (const entry of group.entries) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
  }

  const displayedIds = new Set<string>();
  for (const group of groups) {
    for (const entry of group.entries) displayedIds.add(entry.id);
  }

  const nearestDisplayedId = (entry: SearchableEntry): string | null => {
    let cursor: SearchableEntry | undefined = entry;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor.id)) {
      if (displayedIds.has(cursor.id)) return cursor.id;
      visited.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return null;
  };

  const ids = new Set<string>();
  const hiddenMatches = new Map<string, string[]>();
  const scannedIds = new Set<string>();
  let scannedHits = 0;
  for (const entry of scanEntries) {
    scannedIds.add(entry.id);
    if (!matchesSearchTokens(entrySearchText(entry), tokens)) continue;
    scannedHits += 1;
    const displayedId = nearestDisplayedId(entry);
    if (!displayedId) continue;
    ids.add(displayedId);
    if (entry.id === displayedId) continue;
    const bucket = hiddenMatches.get(displayedId);
    if (bucket) {
      if (bucket.length < 6) bucket.push(entry.path);
    } else {
      hiddenMatches.set(displayedId, [entry.path]);
    }
  }

  // 兼容不完整的扫描树：可见条目本身仍应参与直接匹配。
  for (const group of groups) {
    for (const entry of group.entries) {
      if (!scannedIds.has(entry.id) && matchesSearchTokens(entrySearchText(entry), tokens)) {
        ids.add(entry.id);
      }
    }
  }

  // 归属名只在组内没有条目直接命中时兜底，避免单字母搜索把整组全部带出。
  for (const group of groups) {
    const hasDirectMatch = group.entries.some((entry) => ids.has(entry.id));
    if (!hasDirectMatch && matchesSearchTokens(group.owner, tokens)) {
      for (const entry of group.entries) ids.add(entry.id);
    }
  }

  return { ids, scannedHits, hiddenMatches };
}

/** 搜索/筛选后的分组只重算决策相关统计；体积仍保留归属合计并明确标注。 */
export function narrowReviewGroup(group: OwnerGroup, entries: JudgedEntry[]): OwnerGroup {
  let selectableCount = 0;
  let maxPriority = 0;
  let hasAiJudgment = false;
  const revival = new Set<OwnerGroup["revival"][number]>();
  const counts: Record<Verdict, number> = { safe_delete: 0, needs_review: 0, keep_locked: 0 };
  for (const entry of entries) {
    counts[entry.verdict] += 1;
    if (entry.priority > maxPriority) maxPriority = entry.priority;
    if (!entry.locked && entry.verdict !== "keep_locked") selectableCount += 1;
    if (entry.source === "ai_candidate" || entry.source === "cloud_cache") hasAiJudgment = true;
    for (const mechanism of entry.hit?.revival ?? []) revival.add(mechanism);
  }
  const verdict: Verdict = counts.needs_review > 0
    ? "needs_review"
    : counts.safe_delete > 0
      ? "safe_delete"
      : "keep_locked";
  return {
    ...group,
    entries,
    itemCount: entries.length,
    selectableCount,
    maxPriority,
    hasAiJudgment,
    revival: [...revival],
    counts,
    verdict,
  };
}

export function lockReadOnlyEntries<T extends JudgedEntry>(entries: readonly T[]): T[] {
  return entries.map((entry) => ({
    ...entry,
    locked: true,
    verdict: "keep_locked",
    riskScore: 100,
    priority: 0,
    lockReason: "这是受保护目录的只读扫描：可展开查看，但不能勾选、隔离或删除。",
  }));
}

export function orderReviewEntries<T extends EntryOrder>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || b.priority - a.priority,
  );
}

/** 抽屉序列必须与审核台实际展示的分组和行顺序一致，筛选后尤其不能漏掉纯保护分组。 */
export function reviewDrawerEntries<T extends EntryOrder>(
  groups: readonly { entries: readonly T[]; selectableCount: number }[],
  filter: "all" | Verdict,
): T[] {
  const sequence = filter === "keep_locked"
    ? groups
    : [
        ...groups.filter((group) => group.selectableCount > 0),
        ...groups.filter((group) => group.selectableCount === 0),
      ];
  return sequence.flatMap((group) => orderReviewEntries(group.entries));
}

export function createDrawerNavigation<T extends { id: string }>(
  entryId: string,
  visible: readonly T[],
): { ids: string[]; index: number } {
  const ids = visible.map((entry) => entry.id);
  const index = ids.indexOf(entryId);
  if (index >= 0) return { ids, index };
  // 列表在点击前发生变化时，只打开用户实际点中的这一条，绝不把 0 当作兜底。
  return { ids: [entryId], index: 0 };
}
