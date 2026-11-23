import type { ReactNode } from "react";
import { FolderSearch, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="dc-panel dc-brackets dc-tone-locked dc-rise grid place-items-center gap-3 rounded-xl px-6 py-10 text-center">
      <span className="dc-tone-bg dc-tone-border grid size-12 place-content-center rounded-xl border text-muted-foreground">
        {icon ?? <FolderSearch aria-hidden className="size-5" />}
      </span>
      <div className="grid gap-1.5">
        <p className="dc-display text-base font-semibold tracking-wide">{title}</p>
        {description && (
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  message: string;
  unsupported?: boolean;
  onRetry?: () => void;
  onUseSandbox?: () => void;
}

export function ErrorState({
  message,
  unsupported = false,
  onRetry,
  onUseSandbox,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "dc-panel dc-rail dc-tone-danger dc-rise flex items-start gap-3 rounded-xl px-4 py-3.5",
      )}
    >
      <TriangleAlert aria-hidden className="dc-tone-text mt-0.5 size-4 shrink-0" />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <p className="dc-display text-sm font-semibold tracking-wide">
          {unsupported ? "当前浏览器不支持读取真实目录" : "出了点问题"}
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {unsupported
            ? "真实目录扫描依赖 File System Access API，请使用桌面版 Chrome 或 Edge 打开。也可以先用样本磁盘体验完整流程。"
            : message}
        </p>
        {(onRetry || onUseSandbox) && (
          <div className="mt-1 flex flex-wrap gap-2">
            {onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>重试</Button>
            )}
            {onUseSandbox && (
              <Button size="sm" variant="ghost" onClick={onUseSandbox}>改用样本磁盘</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}