import { useMemo, useRef, useState } from "react";
import {
  Archive,
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
import {
  AI_DIRECTORY_DATA_NOTICE, PRODUCT_PHILOSOPHY, QUARANTINE_TTL_DAYS, VERDICT_ACTION, rebuildMechanisms,
} from "@/src/core/constants";
import type { JudgedEntry } from "@/src/core/types";
import { sandboxPreviewTree } from "@/src/fs";
import { matchAll } from "@/src/knowledge/match";
import { judgeAll } from "@/src/safety/risk";
import { Panel, RevivalBadge, SizeValue, VerdictBadge } from "./shared";
import { EntryDrawer } from "./EntryDrawer";

export interface LandingHeroProps {
  onGenerate: () => void;
  generating?: boolean;
  progress?: { created: number; total: number } | null;
  onPickLocal: () => void;
  localSupported?: boolean;
  picking?: boolean;
}

const FLOW = [
  {
    step: "01",
    tone: "dc-tone-info",
    Icon: ScanSearch,
    title: "扫描并判定",
    body: "这是谁的、能不能删、删了会怎样。默认本地规则，云端辅助需你开启。",
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
  { Icon: Sparkles, text: AI_DIRECTORY_DATA_NOTICE },
  { Icon: Undo2, text: `${QUARANTINE_TTL_DAYS} 天内可一键还原` },
  { Icon: ShieldCheck, text: "绝不自动彻底删除" },
] as const;

function defaultActionOf(entry: JudgedEntry): string {
  if (entry.locked || entry.verdict === "keep_locked") return "保留，不参与勾选";
  if ((entry.hit?.revival.includes("process_lock"))) return "正在使用，关闭相关程序后重试";
  if (rebuildMechanisms(entry.hit?.revival ?? []).length > 0) return "先核对重建来源，再清理";
  if (entry.isEmptyDir) return "空目录，人工判断后再决定";
  return VERDICT_ACTION[entry.verdict];
}

export function LandingHero({
  onGenerate,
  generating = false,
  progress = null,
  onPickLocal,
  localSupported = true,
  picking = false,
}: LandingHeroProps) {
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const activeReasonButtonRef = useRef<HTMLButtonElement | null>(null);

  const rows = useMemo(() => {
    const tree = sandboxPreviewTree();
    const judged = judgeAll(tree, matchAll(tree));
    const byPath = new Map(judged.map((e) => [e.path, e]));
    return PREVIEW.map(({ path, label }) => {
      const entry = byPath.get(path);
      return entry ? { entry, label } : null;
    }).filter((r): r is { entry: JudgedEntry; label: string } => r !== null);
  }, []);

  const previewEntry = rows.find(({ entry }) => entry.path === previewPath)?.entry ?? null;

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
              {generating ? "正在进入工作台" : "进入演示模式"}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={onPickLocal}
              disabled={generating || picking}
              title={localSupported ? undefined : "当前环境不支持读取真实目录，请使用桌面版 Chrome / Edge"}
            >
              {picking ? <Spinner /> : <FolderSearch aria-hidden />}
              {picking ? "等待选择目录…" : "扫描真实文件夹"}
            </Button>
            <p className="dc-tone-safe dc-tone-text flex items-center gap-1.5 text-xs font-medium">
              <ShieldCheck aria-hidden className="size-4 shrink-0" />
              只扫描，不修改；确认后才会隔离
            </p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            真实目录入口受浏览器原生选择器限制：部分系统目录、包含系统文件的目录或敏感位置可能被直接拒绝；
            AppData、Program Files、Recovery 等不保证可以选择。洁灵不会绕过该限制。
          </p>

          {generating && (
            <div className="grid gap-1.5" role="status">
              {percent !== null ? (
                <>
                  <Progress value={percent} aria-label="演示数据生成进度" />
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
          <h3 className="dc-display text-sm font-semibold tracking-wide">演示模式预览</h3>
          <span className="dc-label ml-auto text-muted-foreground">SIMULATED</span>
        </div>

        <p className="dc-tone-info dc-tone-text flex items-start gap-1.5 text-xs leading-relaxed">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
          以下为模拟内容，来自浏览器沙箱，不读取真实磁盘；判定走真实规则管线
        </p>

        <ul className="divide-y divide-hairline">
          {rows.map(({ entry, label }) => {
            const KindIcon = entry.kind === "directory" ? Folder : File;
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
                        onClick={(event) => {
                          activeReasonButtonRef.current = event.currentTarget;
                          setPreviewPath(entry.path);
                          setPreviewOpen(true);
                        }}
                        aria-haspopup="dialog"
                        aria-expanded={previewOpen && previewPath === entry.path}
                        data-preview-path={entry.path}
                        className="dc-press ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary outline-none hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        判定理由
                        <ChevronRight aria-hidden className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="flex items-start gap-1.5 border-t border-hairline pt-2.5 text-xs leading-relaxed text-muted-foreground">
          <RefreshCw aria-hidden className="mt-0.5 size-4 shrink-0" />
          演示数据可一键重置，不会影响真实文件；重置会跳过仍在隔离区里的条目，不把已隔离内容放回原位置。
        </p>
      </Panel>

      <EntryDrawer
        entry={previewEntry}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        preview
        defaultAction={previewEntry ? defaultActionOf(previewEntry) : undefined}
        returnFocusRef={activeReasonButtonRef}
      />
    </div>
  );
}