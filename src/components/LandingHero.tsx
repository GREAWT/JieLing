import { Archive, FolderSearch, HardDrive, Lock, RefreshCw, ScanSearch, ShieldCheck, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { PRODUCT_PHILOSOPHY, QUARANTINE_TTL_DAYS } from "@/src/core/constants";
import { Panel, ToneDot } from "./shared";

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
    body: "每个目录先回答三件事：这是谁的、能不能删、删了会怎样。规则命中优先，未识别的交给云端 AI。",
  },
  {
    step: "02",
    tone: "dc-tone-safe",
    Icon: Archive,
    title: "隔离而非删除",
    body: `勾选后移入独立隔离区，原位置腾空但数据还在，${QUARANTINE_TTL_DAYS} 天内一键还原。`,
  },
  {
    step: "03",
    tone: "dc-tone-review",
    Icon: ShieldCheck,
    title: "到期仍需你同意",
    body: "保留期到了也不会自动删。彻底删除、清空隔离区，都要你再点一次确认。",
  },
] as const;

const SAMPLE_ROWS = [
  { tone: "dc-tone-safe", name: "Projects/webapp", note: "node_modules · dist · .next 缓存" },
  { tone: "dc-tone-safe", name: "AppData/Local", note: "浏览器与应用缓存" },
  { tone: "dc-tone-review", name: "YunPan · Apps/SpeedSuite", note: "删了会复活的钉子户" },
  { tone: "dc-tone-review", name: "Downloads/New Folder", note: "空目录，交给你判断" },
  { tone: "dc-tone-locked", name: "Documents · Pictures/旅行", note: "用户数据，重点保护" },
  { tone: "dc-tone-locked", name: "Windows.old · pagefile.sys", note: "系统相关，默认锁定" },
] as const;

const TRUST = [
  { Icon: Lock, text: "文件内容不出浏览器" },
  { Icon: Sparkles, text: "仅未识别目录名送 AI，用户名脱敏" },
  { Icon: Undo2, text: `${QUARANTINE_TTL_DAYS} 天内可一键还原` },
  { Icon: ShieldCheck, text: "绝不自动彻底删除" },
] as const;

export function LandingHero({
  onGenerate,
  generating = false,
  progress = null,
  onPickLocal,
  localSupported = true,
}: LandingHeroProps) {
  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.created / progress.total) * 100))
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <section className="dc-rise grid gap-5 lg:col-span-7">
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
          {PRODUCT_PHILOSOPHY}。清理工具最大的风险不是删不掉，而是删错了没法回头——
          所以洁灵把每一次删除都变成一次可撤回的决策。
        </p>

        <ol className="grid gap-2.5">
          {FLOW.map(({ step, tone, Icon, title, body }, index) => (
            <li
              key={step}
              className={cn("dc-panel dc-rail dc-lift flex items-start gap-3 rounded-lg px-3.5 py-3", tone)}
              style={{ animationDelay: `${index * 70}ms` }}
            >
              <span className="dc-num dc-tone-text shrink-0 text-xs font-semibold opacity-80">{step}</span>
              <Icon aria-hidden className="dc-tone-text mt-0.5 size-4 shrink-0" />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" onClick={onGenerate} disabled={generating} className="dc-beam relative overflow-hidden">
              {generating ? <Spinner /> : <HardDrive aria-hidden />}
              {generating ? "正在生成样本磁盘" : "生成样本磁盘，试一遍"}
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={onPickLocal}
              disabled={generating}
              title={localSupported ? undefined : "当前环境不支持读取真实目录，请使用桌面版 Chrome / Edge"}
            >
              <FolderSearch aria-hidden />
              清理真实文件夹
            </Button>
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

          <p className="text-xs leading-relaxed text-muted-foreground">
            真实目录建议先选一个软件的缓存目录试手，不要直接选 C:\ 根目录。
            扫描与判定都在浏览器内完成，只有未识别目录的名称与结构会送云端 AI。
          </p>
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {TRUST.map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon aria-hidden className="dc-tone-safe dc-tone-text size-3.5" />
              {text}
            </li>
          ))}
        </ul>
      </section>

      <Panel brackets className="dc-rise grid h-fit gap-3 p-4 lg:col-span-5" >
        <div className="flex items-center gap-2">
          <ToneDot tone="dc-tone-review" live />
          <h3 className="dc-display text-sm font-semibold tracking-wide">样本磁盘里有什么</h3>
          <span className="dc-label ml-auto text-muted-foreground">SANDBOX</span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          在浏览器沙箱（OPFS）里真实生成一套目录树：可删的缓存、需确认的残留、被保护的用户数据，
          还有几个「删了又复活」的钉子户。不读取、不改动你的真实磁盘。
        </p>
        <ul className="grid gap-1.5">
          {SAMPLE_ROWS.map(({ tone, name, note }) => (
            <li key={name} className={cn("dc-tone-bg dc-tone-border flex items-center gap-2.5 rounded-md border px-2.5 py-2", tone)}>
              <ToneDot tone={tone} />
              <span className="min-w-0 flex-1">
                <span className="dc-path block truncate text-xs font-medium text-foreground">{name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{note}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <RefreshCw aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          样本可随时重置；重置会跳过仍在隔离区里的条目，不会把已隔离的东西「复活」回原位置。
        </p>
      </Panel>
    </div>
  );
}