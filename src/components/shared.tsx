import { useId, type ReactNode } from "react";
import {
  AppWindow,
  BookmarkCheck,
  Database,
  Fingerprint,
  HelpCircle,
  Lock,
  MonitorCog,
  Package,
  Ruler,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Wrench,
  RefreshCw,
} from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { REVIVAL_LABEL, VERDICT_LABEL, rebuildMechanisms } from "@/src/core/constants";
import type {
  OwnerKind,
  RevivalMechanism,
  ScanPhase,
  Verdict,
} from "@/src/core/types";

export function splitBytes(bytes: number): { value: string; unit: string } {
  if (!Number.isFinite(bytes) || bytes < 0) return { value: "0", unit: "B" };
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return { value: unit === 0 ? String(value) : value.toFixed(1), unit: units[unit] };
}

export function formatBytes(bytes: number): string {
  const { value, unit } = splitBytes(bytes);
  return `${value} ${unit}`;
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const PHASE_LABEL: Record<ScanPhase, string> = {
  idle: "待扫描",
  scanning: "正在扫描",
  judging: "判定中",
  ready: "扫描完成",
  error: "扫描出错",
};

export const VERDICT_TONE: Record<Verdict, string> = {
  safe_delete: "dc-tone-safe",
  needs_review: "dc-tone-review",
  keep_locked: "dc-tone-locked",
};

export const OWNER_KIND_LABEL: Record<OwnerKind, string> = {
  app: "软件",
  system: "系统",
  dev_tool: "开发工具",
  cache: "缓存",
  unknown: "未知归属",
};

const OWNER_KIND_ICON: Record<OwnerKind, typeof Package> = {
  app: AppWindow,
  system: MonitorCog,
  dev_tool: Wrench,
  cache: Database,
  unknown: HelpCircle,
};

export function OwnerKindIcon({
  kind,
  className,
}: {
  kind: OwnerKind;
  className?: string;
}) {
  const Icon = OWNER_KIND_ICON[kind];
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} />;
}

const VERDICT_ICON: Record<Verdict, typeof ShieldCheck> = {
  safe_delete: ShieldCheck,
  needs_review: TriangleAlert,
  keep_locked: Lock,
};

/** 判定徽标：文字走 ink 色（浅色档也达 4.5:1），底与边走 bright 色辉光。 */
export function VerdictBadge({
  verdict,
  className,
  compact = false,
}: {
  verdict: Verdict;
  className?: string;
  compact?: boolean;
}) {
  const Icon = VERDICT_ICON[verdict];
  return (
    <span
      className={cn(
        VERDICT_TONE[verdict],
        "dc-tone-bg dc-tone-text dc-tone-border inline-flex shrink-0 items-center gap-1 rounded-full border font-medium",
        compact ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-xs",
        className,
      )}
    >
      <Icon aria-hidden className={compact ? "size-3" : "size-3.5"} />
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

export function RevivalBadge({
  mechanisms,
  className,
  interactive = true,
}: {
  mechanisms: RevivalMechanism[];
  className?: string;
  interactive?: boolean;
}) {
  const rebuilds = rebuildMechanisms(mechanisms);
  if (rebuilds.length === 0) return null;
  const badge = (
    <span
      tabIndex={interactive ? 0 : undefined}
      title={interactive ? undefined : `删后重建风险：${rebuilds.map((m) => REVIVAL_LABEL[m] ?? m).join("、")}`}
      className={cn(
        "dc-tone-review dc-tone-bg dc-tone-text dc-tone-border inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        interactive && "cursor-help",
        className,
      )}
    >
      <TriangleAlert aria-hidden className="size-3.5" />
      删后重建风险
    </span>
  );
  if (!interactive) return badge;
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>{badge}</HoverCardTrigger>
      <HoverCardContent align="start" className="dc-panel w-72 text-sm">
        <p className="dc-display font-semibold">检测到具体重建机制</p>
        <ul className="mt-2 grid gap-1 text-muted-foreground">
          {rebuilds.map((m) => (
            <li key={m} className="flex items-center gap-2">
              <span aria-hidden className="dc-tone-review dc-tone-text size-1.5 rounded-full bg-current" />
              {REVIVAL_LABEL[m] ?? m}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          先运行顽固软件诊断核对来源，再清理文件。
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

export function EntrySemanticBadges({ mechanisms, rebuildable }: { mechanisms: RevivalMechanism[]; rebuildable: boolean }) {
  return (
    <>
      {rebuildable && (
        <span className="dc-tone-info dc-tone-bg dc-tone-text dc-tone-border inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium" title="可由对应软件或包管理器重新生成，不等于删后会复活">
          <RefreshCw aria-hidden className="size-3" />可重建缓存
        </span>
      )}
      {mechanisms.includes("process_lock") && (
        <span className="dc-tone-review dc-tone-bg dc-tone-text dc-tone-border inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium" title="正在使用，关闭相关程序后重试">
          <Lock aria-hidden className="size-3" />进程占用
        </span>
      )}
      {mechanisms.some((m) => m === "missing_uninstaller" || m === "driver_protected") && (
        <span className="dc-tone-review dc-tone-bg dc-tone-text dc-tone-border inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium" title="卸载残留或保护机制，请优先使用官方卸载器">
          <Package aria-hidden className="size-3" />卸载残留
        </span>
      )}
      {mechanisms.includes("shell_namespace") && (
        <span className="dc-tone-info dc-tone-bg dc-tone-text dc-tone-border inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium" title="资源管理器中的虚拟文件夹登记，不是磁盘文件重建">
          <MonitorCog aria-hidden className="size-3" />虚拟文件夹
        </span>
      )}
    </>
  );
}

const SOURCE_META = {
  builtin: { label: "人工内置规则", Icon: Fingerprint, tone: "dc-tone-info" },
  custom: { label: "我的规则", Icon: BookmarkCheck, tone: "dc-tone-safe" },
  ai_candidate: { label: "AI 候选", Icon: Sparkles, tone: "dc-tone-ai" },
  cloud_cache: { label: "云端缓存", Icon: Database, tone: "dc-tone-locked" },
  heuristic: { label: "弱启发式", Icon: Ruler, tone: "dc-tone-locked" },
} as const;

export function SourceTag({
  source,
  className,
}: {
  source: keyof typeof SOURCE_META;
  className?: string;
}) {
  const { label, Icon, tone } = SOURCE_META[source];
  return (
    <span className={cn(tone, "dc-tone-text inline-flex items-center gap-1 text-xs opacity-90", className)}>
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}

export function ToneDot({
  tone,
  className,
  live = false,
}: {
  tone: string;
  className?: string;
  live?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(tone, "dc-tone-text relative grid size-2 shrink-0 place-content-center", className)}
    >
      <span className={cn("size-2 rounded-full bg-current", live && "dc-pulse")} />
      {live && <span className="absolute inset-0 rounded-full bg-current opacity-30 blur-[3px]" />}
    </span>
  );
}

/** 体积读数：数字等宽突出，单位降一档，避免「0 B」这类噪声抢视线。 */
export function SizeValue({
  bytes,
  className,
  large = false,
}: {
  bytes: number;
  className?: string;
  large?: boolean;
}) {
  const { value, unit } = splitBytes(bytes);
  return (
    <span className={cn("dc-num inline-flex items-baseline gap-1 whitespace-nowrap", className)}>
      <span className={cn("font-semibold", large ? "text-2xl" : "text-sm")}>{value}</span>
      <span className="text-[0.68em] font-normal text-muted-foreground">{unit}</span>
    </span>
  );
}

export function Meter({
  value,
  tone = "dc-tone-info",
  label,
  className,
}: {
  value: number;
  tone?: string;
  label: string;
  className?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("dc-meter", tone, className)}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function MetaItem({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-0.5">
      <dt className="dc-label">{label}</dt>
      <dd className="dc-path break-all text-foreground">{children}</dd>
    </div>
  );
}

export function Panel({
  className,
  brackets = true,
  children,
}: {
  className?: string;
  brackets?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("dc-panel", brackets && "dc-brackets", className)}>
      {children}
    </div>
  );
}

/** 品牌标识：护盾 + 净化勾 + 扫描弧，全部取自当前色板。 */
export function BrandMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 40" aria-hidden className={cn("size-9 shrink-0", className)}>
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--site-accent)" />
          <stop offset="100%" stopColor="var(--info)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="38" height="38" rx="11" fill="var(--dc-raise)" stroke="var(--dc-hairline)" />
      <path
        d="M20 7.5l10 4.2v7.6c0 6.6-4.3 10.6-10 12.4-5.7-1.8-10-5.8-10-12.4v-7.6z"
        fill="none"
        stroke={`url(#g-${id})`}
        strokeWidth="1.8"
      />
      <path
        d="M14.6 19.8l3.7 3.7 7.4-7.6"
        fill="none"
        stroke="var(--safe)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 33.5h28" stroke="var(--site-accent)" strokeWidth="1" opacity="0.35" />
    </svg>
  );
}