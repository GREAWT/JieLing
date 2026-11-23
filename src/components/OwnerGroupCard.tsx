import { Fragment, useState, type CSSProperties } from "react";
import { ChevronDown, Lock, Sparkles, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { VERDICT_LABEL, VERDICT_ORDER } from "@/src/core/constants";
import type { JudgedEntry, OwnerGroup, Verdict } from "@/src/core/types";
import { EntryRow } from "./EntryRow";
import {
  OWNER_KIND_LABEL,
  OwnerKindIcon,
  RevivalBadge,
  SizeValue,
  ToneDot,
  VERDICT_TONE,
} from "./shared";

export interface OwnerGroupCardProps {
  group: OwnerGroup;
  selectedIds: ReadonlySet<string>;
  onToggleEntry: (entry: JudgedEntry, selected: boolean) => void;
  onToggleGroup: (group: OwnerGroup, selected: boolean) => void;
  onOpenEntry: (entry: JudgedEntry) => void;
  onDiagnose?: (group: OwnerGroup) => void;
  activeEntryId?: string | null;
  defaultOpen?: boolean;
  selectionDisabled?: boolean;
  style?: CSSProperties;
}

const ORDER: Verdict[] = ["safe_delete", "needs_review", "keep_locked"];

export function OwnerGroupCard({
  group,
  selectedIds,
  onToggleEntry,
  onToggleGroup,
  onOpenEntry,
  onDiagnose,
  activeEntryId = null,
  defaultOpen = true,
  selectionDisabled = false,
  style,
}: OwnerGroupCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const locked = selectionDisabled || group.selectableCount === 0;
  const entries = [...group.entries].sort(
    (a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || b.priority - a.priority,
  );
  const selectable = entries.filter((e) => !e.locked && e.verdict !== "keep_locked");
  const selectedCount = selectable.filter((e) => selectedIds.has(e.id)).length;
  const groupChecked: boolean | "indeterminate" =
    selectable.length > 0 && selectedCount === selectable.length
      ? true
      : selectedCount > 0
        ? "indeterminate"
        : false;

  let lastVerdict: Verdict | null = null;

  return (
    <section
      style={style}
      className={cn(
        "dc-panel dc-brackets dc-lift dc-rail dc-rise overflow-hidden",
        VERDICT_TONE[group.verdict],
        locked && "opacity-85",
      )}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-3 py-3 pr-3 pl-4 sm:pr-4 sm:pl-5">
          {locked ? (
            <Lock aria-label="建议保留，已锁定" className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <Checkbox
              checked={groupChecked}
              disabled={selectable.length === 0}
              onCheckedChange={(value) => onToggleGroup(group, value === true)}
              aria-label={`全选 ${group.owner} 的可清理项`}
            />
          )}

          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="dc-press flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <OwnerKindIcon kind={group.ownerKind} className="text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="dc-display max-w-full truncate text-base font-semibold">
                    {group.owner}
                  </span>
                  {group.revival.length > 0 && (
                    <RevivalBadge mechanisms={group.revival} interactive={false} />
                  )}
                  {group.hasAiJudgment && (
                    <span className="dc-tone-ai dc-tone-bg dc-tone-text dc-tone-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                      <Sparkles aria-hidden className="size-3" />
                      AI 判定
                    </span>
                  )}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                  <span>{OWNER_KIND_LABEL[group.ownerKind]} · {group.itemCount} 项</span>
                  {ORDER.filter((v) => group.counts[v] > 0).map((v) => (
                    <span key={v} className={cn(VERDICT_TONE[v], "dc-tone-text inline-flex items-center gap-1")}>
                      <ToneDot tone={VERDICT_TONE[v]} />
                      {VERDICT_LABEL[v]} <span className="dc-num">{group.counts[v]}</span>
                    </span>
                  ))}
                </span>
              </span>
              <ChevronDown
                aria-hidden
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                  open && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <SizeValue bytes={group.totalSize} large />
            {group.revival.length > 0 && onDiagnose && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => onDiagnose(group)}
                title="只删文件夹无效：先诊断并切断重建来源"
              >
                <Stethoscope aria-hidden />
                去诊断
              </Button>
            )}
          </div>
        </div>

        <CollapsibleContent>
          <ul className="divide-y divide-border/70 border-t border-border">
            {entries.map((entry) => {
              const header = entry.verdict !== lastVerdict;
              lastVerdict = entry.verdict;
              return (
                <Fragment key={entry.id}>
                  {header && (
                    <li
                      className={cn(
                        VERDICT_TONE[entry.verdict],
                        "dc-tone-bg dc-tone-text flex items-center gap-2 px-4 py-1.5",
                      )}
                    >
                      <span className="dc-label dc-tone-text">{VERDICT_LABEL[entry.verdict]}</span>
                      <span className="dc-num text-[11px] opacity-80">{group.counts[entry.verdict]} 项</span>
                    </li>
                  )}
                  <EntryRow
                    entry={entry}
                    selected={selectedIds.has(entry.id)}
                    onToggle={onToggleEntry}
                    onOpen={onOpenEntry}
                    active={activeEntryId === entry.id}
                    disabled={locked}
                  />
                </Fragment>
              );
            })}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}