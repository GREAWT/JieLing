import { VERDICT_ORDER } from "@/src/core/constants";
import type { JudgedEntry, Verdict } from "@/src/core/types";

type EntryOrder = Pick<JudgedEntry, "verdict" | "priority">;

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
