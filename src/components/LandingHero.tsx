import { useMemo, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  File,
  FlaskConical,
  Folder,
  FolderSearch,
  HardDrive,
  Lock,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { PRODUCT_PHILOSOPHY, QUARANTINE_TTL_DAYS, VERDICT_ACTION } from "@/src/core/constants";
import type { JudgedEntry } from "@/src/core/types";
import { sandboxPreviewTree } from "@/src/fs";
import { matchAll } from "@/src/knowledge/match";
import { judgeAll } from "@/src/safety/risk";
import { Panel, RevivalBadge, SizeValue, VerdictBadge } from "./shared";

export interface LandingHeroProps {
  onGenerate: () => void;
  generating?: boolean;
  progress?: { created: number; total: number } | null;
  onPickLocal: () => void;
  localSupported?: boolean;
}

const FLOW = [
  {
    step: "01",
    tone: "dc-tone-info",
    Icon: ScanSearch,
    title: "扫描并判定",
    body: "这是谁的、能不能删、删了会怎样。规则优先，未识别的交云端 AI。",
  },
  {
    step: "02",
    tone: "dc-tone-safe",
    Icon: Archive,
    title: "隔离而非删除",
    body: `移入独立隔离区，原位置腾空但数据还在，${QUARANTINE_TTL_DAYS} 天内一键还原。`,
  },
  {
    step: "03",
    tone: "dc-tone-review",
    Icon: ShieldCheck,
    title: "到期仍需你同意",
    body: "保留期到了也不自动删。彻底删除与清空隔离区都要再确认一次。",
  },
] as const;

/** 预览行取真实样本路径，体积与判定由同一套指纹/护栏管线算出，不写死宣传数字。 */
const PREVIEW: { path: string; label: string }[] = [
  { path: "Projects/webapp/node_modules", label: "Projects/webapp/node_modules" },
  { path: "AppData/Local/Google/Chrome/User Data/Default/Cache", label: "Chrome/User Data/Default/Cache" },
  { path: "Apps/SpeedSuite", label: "Apps/SpeedSuite（极速全家桶）" },
  { path: "Downloads/New Folder", label: "Downloads/New Folder" },
  { path: "Pictures/旅行", label: "Pictures/旅行" },
  { path: "pagefile.sys", label: "pagefile.sys" },
];

const TRUST = [
  { Icon: Lock, text: "文件内容不出浏览器" },
  { Icon: Sparkles, text: "仅目录名送 AI，用户名脱敏" },
  { Icon: Undo2, text: `${QUARANTINE_TTL_DAYS} 天内可一键还原` },
  { Icon: ShieldCheck, text: "绝不自动彻底删除" },
] as const;

function defaultActionOf(entry: JudgedEntry): string {
  if (entry.locked || entry.verdict === "keep_locked") return "保留，不参与勾选";
  if ((entry.hit?.revival.length ?? 0) > 0) return "先诊断断来源，再清理";
  if (entry.isEmptyDir) return "空目录，人工判断后再决定";
  return VERDICT_ACTION[entry.verdict];
}

function reasonOf(entry: JudgedEntry): { purpose: string; reason: string; consequence: string } {
  if (entry.hit) {
    return {
      purpose: entry.hit.purpose,
      reason: entry.hit.reason,
      consequence: entry.hit.consequence,
    };
  }
  if (entry.isEmptyDir) {
    return {
      purpose: "空目录，不含任何文件。",
      reason: "可能是软件预留的工作区，也可能是卸载后剩下的空壳，规则不足以判定归属。",
      consequence: "删错会让软件下次启动时找不到工作目录；建议先确认归属再决定。",
    };
  }
  return {
    purpose: "未命中指纹库的普通条目。",
    reason: "按所在目录、名称与扩展名启发式判断，置信度低于规则命中。",
    consequence: `先移入隔离区观察 ${QUARANTINE_TTL_DAYS} 天，确认无影响后再彻底清理。`,
  };
}

export function LandingHero({
  onGenerate,
  generating = false,
  progress = null,
  onPickLocal,
  localSupported = true,
}: LandingHeroProps) {
  const [openReason, setOpenReason] = useState<string | null>(null);

  const rows = useMemo(() => {
    const tree = sandboxPreviewTree();
    const judged = judgeAll(tree, matchAll(tree));
    const byPath = new Map(judged.map((e) => [e.path, e]));
    return PREVIEW.map(({ path, label }) => {
      const entry = byPath.get(path);
      return entry ? { entry, label } : null;
    }).filter((r): r is { entry: JudgedEntry; label: string } => r !== null);
  }, []);

  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.created / progress.total) * 100))
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
      <section className="dc-rise grid content-start gap-3.5 lg:col-span-7">
        <p className="dc-label flex items-center gap-2 text-primary">
          <span aria-hidden className="h-px w-8 bg-gradient-to-r from-transparent to-primary" />
          DARECLEAN · 磁盘清理决策台
        </p>

        <h2 className="dc-display text-3xl leading-[1.15] font-semibold tracking-tight sm:text-4xl">
          不是帮你删得更快，
          <br />
          <span className="bg-gradient-to-r from-primary via-info to-ai bg-clip-text text-transparent">
            是让你敢删。
          </span>
        </h2>

        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          {PRODUCT_PHILOSOPHY}。清理工具最大的风险不是删不掉，而是删错了没法回头。
        </p>

        <ol className="grid gap-2.5 sm:grid-cols-3 sm:gap-0">
          {FLOW.map(({ step, tone, Icon, title, body }, index) => (
            <li
              key={step}
              className={cn(
                "flex items-start gap-2.5",
                tone,
                index > 0 && "sm:border-l sm:border-hairline sm:pl-4",
                index < FLOW.length - 1 && "sm:pr-4",
              )}
            >
              <span className="dc-num dc-tone-text mt-0.5 shrink-0 text-xs font-semibold">{step}</span>
              <span className="grid min-w-0 gap-1">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon aria-hidden className="dc-tone-text size-4 shrink-0" />
                  {title}
                  {index < FLOW.length - 1 && (
                    <ChevronRight aria-hidden className="ml-auto hidden size-4 shrink-0 text-muted-foreground sm:block" />
                  )}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button size="lg" onClick={onGenerate} disabled={generating} className="dc-beam relative overflow-hidden">
              {generating ? <Spinner /> : <HardDrive aria-hidden />}
              {generating ? "正在进入工作台" : "体验样本清理"}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={onPickLocal}
              disabled={generating}
              title={localSupported ? undefined : "当前环境不支持读取真实目录，请使用桌面版 Chrome / Edge"}
            >
              <FolderSearch aria-hidden />
              扫描真实文件夹
            </Button>
            <p className="dc-tone-safe dc-tone-text flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheck aria-hidden className="size-4 shrink-0" />
              只扫描，不修改；确认后才会隔离
            </p>
          </div>

          {generating && (
            <div className="grid gap-1.5" role="status">
              {percent !== null ? (
                <>
                  <Progress value={percent} aria-label="样本生成进度" />
                  <p className="dc-num text-xs text-muted-foreground">
                    {progress?.created.toLocaleString("zh-CN")} / {progress?.total.toLocaleString("zh-CN")} 个条目
                  </p>
                </>
              ) : (
                <div aria-hidden className="dc-indeterminate h-1 rounded-full bg-muted" />
              )}
            </div>
          )}
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-hairline pt-3">
          {TRUST.map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon aria-hidden className="dc-tone-safe dc-tone-text size-4 shrink-0" />
              {text}
            </li>
          ))}
        </ul>
      </section>

      <Panel brackets className="dc-rise grid h-fit content-start gap-2.5 p-4 lg:col-span-5">
        <div className="flex items-center gap-2">
          <FlaskConical aria-hidden className="dc-tone-info dc-tone-text size-4 shrink-0" />
          <h3 className="dc-display text-sm font-semibold tracking-wide">样本磁盘预览</h3>
          <span className="dc-label ml-auto text-muted-foreground">SANDBOX</span>
        </div>

        <p className="dc-tone-info dc-tone-text flex items-start gap-1.5 text-xs leading-relaxed">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          以下为浏览器沙箱数据，不读取真实磁盘
        </p>

        <ul className="divide-y divide-hairline">
          {rows.map(({ entry, label }) => {
            const open = openReason === entry.path;
            const KindIcon = entry.kind === "directory" ? Folder : File;
            const reason = reasonOf(entry);
            const panelId = `preview-reason-${entry.path.replace(/[^a-zA-Z0-9]/g, "-")}`;
            return (
              <li key={entry.path} className="py-2.5 first:pt-1 last:pb-1">
                <div className="flex items-start gap-2.5">
                  <KindIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="dc-path min-w-0 flex-1 truncate font-medium text-foreground" title={entry.path}>
                        {label}
                      </span>
                      {entry.isEmptyDir ? (
                        <span className="dc-label shrink-0">空目录</span>
                      ) : (
                        <SizeValue bytes={entry.size} className="shrink-0" />
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <VerdictBadge verdict={entry.verdict} compact />
                      {(entry.hit?.revival.length ?? 0) > 0 && (
                        <RevivalBadge mechanisms={entry.hit!.revival} interactive={false} />
                      )}
                      <span className="text-xs text-muted-foreground">{defaultActionOf(entry)}</span>
                      <button
                        type="button"
                        onClick={() => setOpenReason(open ? null : entry.path)}
                        aria-expanded={open}
                        aria-controls={panelId}
                        className="dc-press ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary outline-none hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        判定理由
                        <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
                      </button>
                    </div>
                  </div>
                </div>

                {open && (
                  <div id={panelId} className="dc-tone-info mt-2 grid gap-1.5 border-l-2 border-current/40 pl-3 text-xs leading-relaxed">
                    <p className="text-foreground/90">{reason.purpose}</p>
                    <p className="text-muted-foreground">
                      <span className="dc-label mr-1.5">理由</span>
                      {reason.reason}
                    </p>
                    <p className="text-muted-foreground">
                      <span className="dc-label mr-1.5">后果</span>
                      {reason.consequence}
                    </p>
                    {entry.hit && (
                      <p className="dc-num text-muted-foreground">
                        置信度 {Math.round(entry.hit.confidence * 100)}% · #{entry.hit.fingerprintId}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <p className="flex items-start gap-1.5 border-t border-hairline pt-2.5 text-xs leading-relaxed text-muted-foreground">
          <RefreshCw aria-hidden className="mt-0.5 size-4 shrink-0" />
          样本可随时重置；重置会跳过仍在隔离区里的条目，不会把已隔离的内容放回原位置。
        </p>
      </Panel>
    </div>
  );
}