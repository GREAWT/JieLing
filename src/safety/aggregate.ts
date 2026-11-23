import { VERDICT_ORDER } from "../core/constants";
import type { JudgedEntry, OwnerGroup, RevivalMechanism, Verdict } from "../core/types";

function ownerLabel(entry: JudgedEntry): string {
  if (entry.hit) return entry.hit.owner;
  const top = entry.path.split("/").filter((s) => s.length > 0)[0] ?? entry.name;
  return `${top}（未识别）`;
}

// 只有值得用户决策的条目才进审核板：命中知识库、空目录、启发式判定可删，
// 以及一级目录（保留磁盘顶层结构）。中间容器与普通文件不占前排位置。
function isDecisionCandidate(entry: JudgedEntry): boolean {
  if (entry.hit) return true;
  if (entry.isEmptyDir) return true;
  if (entry.verdict === "safe_delete") return true;
  return entry.kind === "directory" && entry.depth <= 1;
}

function nearestKeptAncestor(
  entry: JudgedEntry,
  byId: Map<string, JudgedEntry>,
  keptIds: ReadonlySet<string>,
): JudgedEntry | null {
  let cursor = entry.parentId;
  while (cursor) {
    if (keptIds.has(cursor)) return byId.get(cursor) ?? null;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return null;
}

// 祖先能否把后代收进自己的整体隔离里。
function absorbs(ancestor: JudgedEntry, entry: JudgedEntry): boolean {
  // 锁定项永远单独可见，否则「保留」的警示会被容器埋掉
  if (entry.locked) return false;
  // 祖先比后代更保守时不能吸收：needs_review 的容器不该吞掉里面 safe_delete 的缓存
  if (VERDICT_ORDER[ancestor.verdict] > VERDICT_ORDER[entry.verdict]) return false;
  if (ancestor.hit) return true;
  // 未识别但判定可删的祖先（如 logs 目录）吸收同样未识别的后代，避免逐个文件刷屏
  return !entry.hit && ancestor.verdict === "safe_delete";
}

export function groupByOwner(entries: JudgedEntry[]): OwnerGroup[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const ordered = [...entries].sort((a, b) => a.depth - b.depth);

  let kept: JudgedEntry[] = [];
  const keptIds = new Set<string>();
  for (const entry of ordered) {
    if (!isDecisionCandidate(entry)) continue;
    const ancestor = nearestKeptAncestor(entry, byId, keptIds);
    if (ancestor && absorbs(ancestor, entry)) continue;
    kept.push(entry);
    keptIds.add(entry.id);
  }

  // 未识别的可删祖先若已有被识别的后代，让位给更精确的后代（.gradle → .gradle/caches）
  const identifiedAncestors = new Set<string>();
  for (const entry of kept) {
    if (!entry.hit) continue;
    let cursor = entry.parentId;
    while (cursor) {
      if (keptIds.has(cursor)) identifiedAncestors.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
  kept = kept.filter(
    (e) => !(e.hit === null && e.verdict === "safe_delete" && identifiedAncestors.has(e.id)),
  );

  const finalIds = new Set(kept.map((e) => e.id));
  const childSizeSum = new Map<string, number>();
  for (const entry of kept) {
    const ancestor = nearestKeptAncestor(entry, byId, finalIds);
    if (ancestor) childSizeSum.set(ancestor.id, (childSizeSum.get(ancestor.id) ?? 0) + entry.size);
  }

  const buckets = new Map<string, { owner: string; entries: JudgedEntry[] }>();
  for (const entry of kept) {
    const owner = ownerLabel(entry);
    // 按归属软件聚合：同一个软件的缓存、残留、锁定项必须落在一张卡里，
    // 否则「这个软件到底能不能删」被判定分档撕成两半，卸载处方也无从聚合。
    const bucket = buckets.get(owner);
    if (bucket) bucket.entries.push(entry);
    else buckets.set(owner, { owner, entries: [entry] });
  }

  const groups: OwnerGroup[] = [];
  for (const { owner, entries: groupEntries } of buckets.values()) {
    const firstHit = groupEntries.find((e) => e.hit)?.hit ?? null;

    let maxPriority = 0;
    const revival = new Set<RevivalMechanism>();
    let totalSize = 0;
    const counts: Record<Verdict, number> = { safe_delete: 0, needs_review: 0, keep_locked: 0 };
    const sizes: Record<Verdict, number> = { safe_delete: 0, needs_review: 0, keep_locked: 0 };
    let selectableCount = 0;
    for (const entry of groupEntries) {
      if (entry.priority > maxPriority) maxPriority = entry.priority;
      for (const mechanism of entry.hit?.revival ?? []) revival.add(mechanism);
      // 扣掉已单独列出的后代体积，跨组父子不再重复累加
      const own = Math.max(0, entry.size - (childSizeSum.get(entry.id) ?? 0));
      totalSize += own;
      counts[entry.verdict] += 1;
      sizes[entry.verdict] += own;
      if (!entry.locked && entry.verdict !== "keep_locked") selectableCount += 1;
    }

    const verdict: Verdict = counts.needs_review > 0
      ? "needs_review"
      : counts.safe_delete > 0
        ? "safe_delete"
        : "keep_locked";

    groups.push({
      owner,
      ownerKind: firstHit?.ownerKind ?? "unknown",
      entries: groupEntries,
      totalSize,
      itemCount: groupEntries.length,
      verdict,
      counts,
      sizes,
      selectableCount,
      maxPriority,
      revival: [...revival],
      hasAiJudgment: groupEntries.some((e) => e.source === "ai"),
    });
  }
  return groups;
}

export function sortGroups(groups: OwnerGroup[]): OwnerGroup[] {
  return [...groups].sort((a, b) => {
    // 全锁定的组沉底：它们不参与决策，不该占据前排
    const aLocked = a.selectableCount === 0 ? 1 : 0;
    const bLocked = b.selectableCount === 0 ? 1 : 0;
    if (aLocked !== bLocked) return aLocked - bLocked;
    if (a.maxPriority !== b.maxPriority) return b.maxPriority - a.maxPriority;
    return b.totalSize - a.totalSize;
  });
}