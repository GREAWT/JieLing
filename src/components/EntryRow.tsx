import { ChevronRight, File, Folder, Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { VERDICT_ACTION } from "@/src/core/constants";
import type { JudgedEntry } from "@/src/core/types";
import { EntrySemanticBadges, OWNER_KIND_LABEL, RevivalBadge, SizeValue, SourceTag, VerdictBadge } from "./shared";

export interface EntryRowProps {
  entry: JudgedEntry;
  selected: boolean;
  onToggle: (entry: JudgedEntry, selected: boolean) => void;
  onOpen: (entry: JudgedEntry) => void;
  active?: boolean;
  disabled?: boolean;
}

export function entrySummary(entry: JudgedEntry): string {
  if (entry.hit?.revival.includes("process_lock")) return "正在使用，关闭相关程序后重试；这不是删后重建。";
  if (entry.hit?.reason) return entry.hit.reason;
  if (entry.verdict === "keep_locked") return "位于系统关键位置，禁止清理。";
  if (entry.isEmptyDir) return "空目录：可能是软件预留工作区，也可能是卸载后的空壳，需要人工判断。";
  return "未命中本地规则，按位置与文件类型启发式判断。";
}

export function EntryRow({
  entry,
  selected,
  onToggle,
  onOpen,
  active = false,
  disabled = false,
}: EntryRowProps) {
  const locked = entry.locked || disabled;
  const KindIcon = entry.kind === "directory" ? Folder : File;
  const emptyDir = entry.isEmptyDir && entry.size === 0;

  return (
    <li
      className="dc-row"
      data-entry-id={entry.id}
      data-selected={selected || undefined}
      data-active={active || undefined}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`查看 ${entry.name}：这是什么、能不能删、删了会怎样`}
        onClick={() => onOpen(entry)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(entry);
          }
        }}
        className={cn(
          "group/row flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 outline-none transition-colors sm:px-4",
          "hover:bg-muted/45 focus-visible:ring-[3px] focus-visible:ring-ring/50",
          active && "bg-muted/55",
        )}
      >
        <span
          data-row-action
          className="mt-1 flex size-4 shrink-0 items-center justify-center"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {locked ? (
            <Lock
              aria-label="已锁定，不可选择"
              className="size-4 text-muted-foreground"
            />
          ) : (
            <Checkbox
              checked={selected}
              onCheckedChange={(value) => onToggle(entry, value === true)}
              aria-label={`选择 ${entry.name}`}
            />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <KindIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="max-w-full truncate font-medium">{entry.name}</span>
            <VerdictBadge verdict={entry.verdict} compact />
            {entry.hit && entry.hit.revival.length > 0 && (
              <RevivalBadge mechanisms={entry.hit.revival} interactive={false} />
            )}
            {entry.hit && <EntrySemanticBadges mechanisms={entry.hit.revival} rebuildable={entry.hit.rebuildable} />}
            <SourceTag source={entry.source} />
          </span>
          <span className="dc-path mt-0.5 block truncate text-muted-foreground">
            {entry.path}
          </span>
          <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">
            <span className="text-foreground">
              身份 {entry.hit?.owner ?? "未识别"}（{OWNER_KIND_LABEL[entry.hit?.ownerKind ?? "unknown"]}）
            </span>
            {" · "}
            {entrySummary(entry)}
          </span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
          {emptyDir ? (
            <span className="dc-label whitespace-nowrap">空目录</span>
          ) : (
            <SizeValue bytes={entry.size} />
          )}
          <span className="max-w-36 truncate text-xs text-muted-foreground" title={VERDICT_ACTION[entry.verdict]}>
            {VERDICT_ACTION[entry.verdict]}
          </span>
          <ChevronRight
            aria-hidden
            className={cn(
              "size-4 text-muted-foreground transition-transform duration-200",
              "group-hover/row:translate-x-0.5 group-hover/row:text-primary",
              active && "translate-x-0.5 text-primary",
            )}
          />
        </span>
      </div>
    </li>
  );
}