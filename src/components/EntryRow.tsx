import { ChevronRight, File, Folder, Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { JudgedEntry } from "@/src/core/types";
import { RevivalBadge, SizeValue, SourceTag, VerdictBadge } from "./shared";

export interface EntryRowProps {
  entry: JudgedEntry;
  selected: boolean;
  onToggle: (entry: JudgedEntry, selected: boolean) => void;
  onOpen: (entry: JudgedEntry) => void;
  active?: boolean;
  disabled?: boolean;
}

export function entrySummary(entry: JudgedEntry): string {
  if (entry.hit?.reason) return entry.hit.reason;
  if (entry.verdict === "keep_locked") return "位于系统关键位置，禁止清理。";
  if (entry.isEmptyDir) return "空目录：可能是软件预留工作区，也可能是卸载后的空壳，需要人工判断。";
  return "未命中指纹库，按位置与文件类型启发式判断。";
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
      data-selected={selected || undefined}
      data-active={active || undefined}
    >
      <div className="group/row flex items-start gap-3 px-3 py-2.5 sm:px-4">
        {locked ? (
          <Lock
            aria-label="已锁定，不可选择"
            className="mt-1 size-4 shrink-0 text-muted-foreground"
          />
        ) : (
          <Checkbox
            className="mt-1"
            checked={selected}
            onCheckedChange={(value) => onToggle(entry, value === true)}
            aria-label={`选择 ${entry.name}`}
          />
        )}

        {/* 整行是一个按钮：点 anywhere 打开右侧/底部抽屉，不再有两套重复的展开详情 */}
        <button
          type="button"
          onClick={() => onOpen(entry)}
          aria-label={`查看 ${entry.name}：这是什么、能不能删、删了会怎样`}
          className="dc-press flex min-w-0 flex-1 items-start gap-3 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <KindIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="max-w-full truncate font-medium">{entry.name}</span>
              <VerdictBadge verdict={entry.verdict} compact />
              {entry.hit && entry.hit.revival.length > 0 && (
                <RevivalBadge mechanisms={entry.hit.revival} interactive={false} />
              )}
              <SourceTag source={entry.source} />
            </span>
            <span className="dc-path mt-0.5 block truncate text-muted-foreground">
              {entry.path}
            </span>
            <span className="mt-1 line-clamp-1 block text-xs text-muted-foreground">
              {entrySummary(entry)}
            </span>
          </span>

          <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
            {emptyDir ? (
              <span className="dc-label whitespace-nowrap">空目录</span>
            ) : (
              <SizeValue bytes={entry.size} />
            )}
            <ChevronRight
              aria-hidden
              className={cn(
                "size-4 text-muted-foreground transition-transform duration-200",
                "group-hover/row:translate-x-0.5 group-hover/row:text-primary",
                active && "translate-x-0.5 text-primary",
              )}
            />
          </span>
        </button>
      </div>
    </li>
  );
}