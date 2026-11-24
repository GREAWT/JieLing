import { Check, Copy, Download, Package, ShieldCheck, Terminal, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { REVIVAL_LABEL, REVIVAL_ORDER } from "@/src/core/constants";
import type {
  CleanupAction,
  DiagnosisReport,
  ResurrectionFinding,
  RevivalMechanism,
} from "@/src/core/types";
import { EmptyState } from "./States";
import { Meter, MetaItem, Panel, ToneDot } from "./shared";

export interface DiagnosePanelProps {
  report: DiagnosisReport | null;
  actions: CleanupAction[];
  onToggleAction: (action: CleanupAction, selected: boolean) => void;
  onGenerateScript: () => void;
  onDownloadScript: () => void;
  loading?: boolean;
  scriptReady?: boolean;
}

const DANGER_META: Record<CleanupAction["danger"], { label: string; tone: string }> = {
  low: { label: "低风险", tone: "dc-tone-safe" },
  medium: { label: "中风险", tone: "dc-tone-review" },
  high: { label: "高危", tone: "dc-tone-danger" },
};

function groupByMechanism(findings: ResurrectionFinding[]): [RevivalMechanism, ResurrectionFinding[]][] {
  const map = new Map<RevivalMechanism, ResurrectionFinding[]>();
  for (const finding of findings) {
    const list = map.get(finding.mechanism) ?? [];
    list.push(finding);
    map.set(finding.mechanism, list);
  }
  const order = REVIVAL_ORDER as RevivalMechanism[];
  return [...map.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
}

function CommandBlock({ command, label }: { command: string; label: string }) {
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      toast.success(`已复制${label}`);
    } catch {
      toast.error("复制失败，请手动选中文本复制");
    }
  };
  return (
    <div className="group/cmd relative">
      <code className="dc-path block break-all rounded-md border border-hairline bg-void/60 px-2.5 py-2 pr-9 text-xs text-foreground">
        {command}
      </code>
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-1 right-1 opacity-60 group-hover/cmd:opacity-100"
        onClick={() => void copy()}
        aria-label={`复制${label}`}
      >
        <Copy aria-hidden />
      </Button>
    </div>
  );
}

export function DiagnosePanel({
  report,
  actions,
  onToggleAction,
  onGenerateScript,
  onDownloadScript,
  loading = false,
  scriptReady = false,
}: DiagnosePanelProps) {
  if (loading) {
    return (
      <div aria-label="正在诊断" className="grid gap-3">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }

  if (!report) {
    return (
      <EmptyState
        icon={<Terminal aria-hidden />}
        title="还没有诊断结果"
        description="对标记「会复活」的分组运行诊断，找出是哪个服务、计划任务或注册表项在重建它。先断源头，再删文件。"
      />
    );
  }

  const sections = groupByMechanism(report.findings);
  const chosen = actions.filter((action) => action.selected);

  return (
    <section aria-label="复活诊断结果" className="grid gap-4">
      <Panel className="dc-tone-ai dc-rail grid gap-1.5 rounded-xl px-4 py-3.5">
        <h2 className="dc-display flex items-center gap-2 text-base font-semibold tracking-wide">
          <ToneDot tone="dc-tone-ai" live />
          复活诊断报告
          <span className="dc-label text-muted-foreground">DIAGNOSIS</span>
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          共发现 {report.findings.length} 处可能的重建源头，按机制归类。
          处置处方逐项可选，高危项默认不勾选；生成的脚本默认 dry-run。
        </p>
      </Panel>

      {report.officialUninstaller && (
        <Panel className="dc-tone-safe dc-rail grid gap-2 rounded-xl px-4 py-3.5">
          <h3 className="dc-display flex items-center gap-2 text-sm font-semibold tracking-wide">
            <Package aria-hidden className="dc-tone-text size-4" />
            优先走官方卸载器
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            先用官方卸载器移除软件本体，再清理残留，能避免大部分复活。手改注册表是最后手段。
          </p>
          <CommandBlock command={report.officialUninstaller} label="卸载命令" />
        </Panel>
      )}

      {sections.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck aria-hidden />}
          title="未发现复活源头"
          description="没有检测到会重建这些文件夹的服务、任务或注册表项，可以直接清理。"
        />
      ) : (
        <div className="grid gap-3">
          {sections.map(([mechanism, findings]) => (
            <div key={mechanism} className="grid gap-2">
              <h3 className="flex items-center gap-2 px-1">
                <span className="dc-tone-review dc-tone-bg dc-tone-text dc-tone-border inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium">
                  {REVIVAL_LABEL[mechanism] ?? mechanism}
                </span>
                <span className="dc-num text-xs text-muted-foreground">{findings.length} 处</span>
                <span aria-hidden className="h-px flex-1 bg-hairline" />
              </h3>
              <ul className="grid gap-2">
                {findings.map((finding, index) => (
                  <li
                    key={`${finding.mechanism}-${finding.subject}-${index}`}
                    className="dc-panel dc-rail dc-tone-review dc-lift grid gap-2 rounded-xl px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-medium">{finding.subject}</span>
                      <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                        置信度
                        <span className="dc-num font-semibold text-foreground">
                          {Math.round(finding.confidence * 100)}%
                        </span>
                      </span>
                    </div>
                    <Meter
                      className="max-w-40"
                      tone="dc-tone-review"
                      value={finding.confidence}
                      label={`${finding.subject} 置信度`}
                    />
                    <p className="text-sm leading-relaxed text-muted-foreground">{finding.detail}</p>
                    <dl className="grid gap-2">
                      {finding.registryPath && <MetaItem label="注册表路径">{finding.registryPath}</MetaItem>}
                      {finding.serviceName && <MetaItem label="服务名">{finding.serviceName}</MetaItem>}
                      {finding.taskName && <MetaItem label="计划任务">{finding.taskName}</MetaItem>}
                      {finding.clsid && <MetaItem label="CLSID">{finding.clsid}</MetaItem>}
                      {finding.uninstallString && <MetaItem label="卸载命令">{finding.uninstallString}</MetaItem>}
                    </dl>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {actions.length > 0 && (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2 px-1">
            <h3 className="dc-display text-sm font-semibold tracking-wide">处置处方</h3>
            <span className="text-xs text-muted-foreground">
              勾选要执行的操作，高危项默认不选，看清后果再勾。
            </span>
            <span className="dc-num ml-auto text-xs text-muted-foreground">
              已选 {chosen.length} / {actions.length}
            </span>
          </div>
          <ul className="grid gap-2">
            {actions.map((action) => {
              const danger = DANGER_META[action.danger];
              return (
                <li
                  key={action.id}
                  data-selected={action.selected || undefined}
                  className={cn(
                    "dc-panel dc-row dc-rail flex items-start gap-3 rounded-xl px-4 py-3",
                    danger.tone,
                  )}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={action.selected}
                    onCheckedChange={(value) => onToggleAction(action, value === true)}
                    aria-label={`选择操作：${action.label}`}
                  />
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">{action.label}</span>
                      <span className={cn("dc-tone-bg dc-tone-text dc-tone-border rounded-full border px-2 py-0.5 text-xs", danger.tone)}>
                        {danger.label}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-xs text-muted-foreground">
                        {action.reversible ? <Undo2 aria-hidden className="size-3" /> : <Check aria-hidden className="size-3" />}
                        {action.reversible ? "可撤销" : "不可撤销"}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{action.description}</p>
                    <CommandBlock command={action.command} label="命令" />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Panel className="dc-tone-info dc-rail grid gap-3 rounded-xl px-4 py-3.5">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck aria-hidden className="dc-tone-info dc-tone-text mt-0.5 size-3.5 shrink-0" />
          先 dry-run，再执行：脚本默认只打印将要执行的操作，不改动系统。确认输出符合预期后，再正式执行。
          触及注册表或卸载前，脚本会先向你申请确认。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onGenerateScript} disabled={actions.length === 0}>
            <Terminal aria-hidden />
            生成脚本{chosen.length > 0 ? `（${chosen.length} 项）` : ""}
          </Button>
          <Button variant="outline" onClick={onDownloadScript} disabled={!scriptReady}>
            <Download aria-hidden />
            下载 dareclean-cleanup.ps1
          </Button>
        </div>
      </Panel>
    </section>
  );
}