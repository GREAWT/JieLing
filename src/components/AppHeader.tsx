import { useEffect, useRef, useState } from "react";
import { FlaskConical, HardDrive, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/src/core/constants";
import type { ScanSource } from "@/src/core/types";
import { useTheme } from "@/src/hooks/useTheme";
import { BrandMark } from "./shared";

export interface AppHeaderProps {
  source: ScanSource | null;
  rootLabel?: string;
  localSupported?: boolean;
  onUseSandbox?: () => void;
  onPickLocal?: () => void;
  localPicking?: boolean;
}

const SOURCE_META = {
  sandbox: { label: "演示模式", tone: "dc-tone-review", Icon: FlaskConical },
  local: { label: "真实目录", tone: "dc-tone-safe", Icon: HardDrive },
} as const;

export function AppHeader({
  source,
  rootLabel,
  localSupported = true,
  onUseSandbox,
  onPickLocal,
  localPicking = false,
}: AppHeaderProps) {
  const { theme, toggle } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const read = (): void => {
      rafRef.current = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      setScrolled(window.scrollY > 4);
      setProgress(max > 8 ? Math.min(1, window.scrollY / max) : 0);
    };
    const onScroll = (): void => {
      if (rafRef.current) return;
      rafRef.current = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const meta = source ? SOURCE_META[source] : null;

  return (
    <header
      className={cn(
        "sticky top-0 z-30 -mx-4 border-b border-hairline px-4 backdrop-blur-xl transition-shadow sm:-mx-6 sm:px-6",
        scrolled ? "bg-panel/85 shadow-[0_10px_30px_-24px_var(--dc-glow)]" : "bg-panel/55",
      )}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2.5">
          <BrandMark className="size-8 shrink-0 sm:size-9" />
          <span className="min-w-0 leading-tight">
            <span className="dc-display block truncate text-base font-semibold tracking-wide sm:text-lg">
              {PRODUCT_NAME}
            </span>
            <span className="hidden truncate text-xs text-muted-foreground sm:block">
              {PRODUCT_TAGLINE}
            </span>
          </span>
        </span>

        {meta && (
          <span
            className={cn(
              "dc-tone-bg dc-tone-text dc-tone-border hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs sm:inline-flex",
              meta.tone,
            )}
          >
            <meta.Icon aria-hidden className="size-3.5" />
            {meta.label}
          </span>
        )}
        {rootLabel && (
          <span className="dc-path hidden max-w-44 truncate text-muted-foreground lg:inline" title={rootLabel}>
            {rootLabel}
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1">
          {source !== null && (
            <nav aria-label="切换数据源" className="flex items-center gap-1">
              <Button
                variant={source === "sandbox" ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={source === "sandbox"}
                onClick={onUseSandbox}
                disabled={!onUseSandbox}
                className="px-2 sm:px-3"
              >
                <FlaskConical aria-hidden />
                <span className="hidden sm:inline">演示模式</span>
                <span className="sr-only sm:hidden">切换到演示模式</span>
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={source === "local" ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={source === "local"}
                    onClick={onPickLocal}
                    disabled={!onPickLocal || localPicking}
                    className="px-2 sm:px-3"
                    title={localSupported
                      ? (localPicking ? "请在系统窗口中选择文件夹" : "系统目录或敏感位置可能被浏览器原生选择器拒绝")
                      : "当前浏览器不支持读取真实目录，请使用桌面版 Chrome / Edge"}
                  >
                    {localPicking ? <Spinner aria-hidden className="size-4" /> : <HardDrive aria-hidden />}
                    <span className="hidden sm:inline">{localPicking ? "选择中…" : "真实目录"}</span>
                    <span className="sr-only sm:hidden">{localPicking ? "正在等待选择目录" : "选择真实目录"}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {localSupported ? "重新选择本地文件夹；部分系统目录可能被浏览器直接拒绝" : "需要桌面版 Chrome / Edge"}
                </TooltipContent>
              </Tooltip>
            </nav>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggle}
                aria-label={theme === "dark" ? "切换到浅色界面" : "切换到深空界面"}
                aria-pressed={theme === "light"}
              >
                {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {theme === "dark" ? "浅色界面" : "深空界面"}
            </TooltipContent>
          </Tooltip>
        </span>
      </div>

      <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-hairline">
        <span
          className="block h-full bg-gradient-to-r from-primary via-info to-ai transition-[width] duration-150"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </span>
    </header>
  );
}