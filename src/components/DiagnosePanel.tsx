import { Check, Copy, Download, ShieldCheck, Terminal, TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { REVIVAL_LABEL, REVIVAL_ORDER, confidenceLabel, rebuildMechanisms } from "@/src/core/constants";
import type {
  CleanupAction,
  DiagnosisCollectorName,
  DiagnosisEvidenceKind,
  DiagnosisReport,
  ResurrectionFinding,
  RevivalMechanism,
} from "@/src/core/types";
import { EmptyState } from "./States";
import { MetaItem, Panel, ToneDot } from "./shared";

export interface DiagnosePanelProps {
  report: DiagnosisReport | null;
  actions: CleanupAction[];
  onToggleAction: (action: CleanupAction, selected: boolean) => void;
  onGenerateScript: () => void;
  onDownloadScript: () => void;
  loading?: boolean;
  scriptReady?: boolean;
  reportSource?: "local" | "ai" | null;
}

const DANGER_META: Record<CleanupAction["danger"], { label: string; tone: string }> = {
  low: { label: "低风险", tone: "dc-tone-safe" },
  medium: { label: "中风险", tone: "dc-tone-review" },
  high: { label: "高危", tone: "dc-tone-danger" },
};

const COLLECTOR_LABEL: Record<DiagnosisCollectorName, string> = {
  services: "服务",
  tasks: "计划任务",
  runKeys: "启动项",
  startupFolders: "启动文件夹",
  shellNamespaces: "外壳扩展",
  uninstallers: "卸载器",
  targetStatus: "目标状态",
  processes: "进程",
};

const EVIDENCE_LABEL: Record<DiagnosisEvidenceKind, string> = {
  service: "服务",
  task: "计划任务",
  run_key: "启动项",
  shell_namespace: "外壳命名空间",
  process: "进程",
  uninstaller: "卸载器",
  startup_folder: "启动文件夹",
  target: "诊断目标",
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
  reportSource = null,
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
        description="选择问题目录，生成并运行只读脚本，再导入结果文件。本地解析会区分删后重建、进程占用与卸载问题。"
      />
    );
  }

  const sections = groupByMechanism(report.findings);
  const chosen = actions.filter((action) => action.selected);
  const rebuildCount = report.findings.filter((finding) => rebuildMechanisms([finding.mechanism]).length > 0).length;
  const aiFindingCount = report.findings.filter((finding) => finding.source !== "local").length;
  const highRiskCount = actions.filter((action) => action.danger === "high").length;
  const failedCollectors = report.collectionStatus
    ? (Object.entries(report.collectionStatus) as [DiagnosisCollectorName, { ok: boolean; error?: string }][])
      .filter(([, status]) => !status.ok)
    : [];

  return (
    <section aria-label="顽固软件诊断结果" className="grid gap-4">
      <Panel className={cn("dc-rail grid gap-1.5 rounded-xl px-4 py-3.5", reportSource === "ai" ? "dc-tone-ai" : "dc-tone-info")}>
        <h2 className="dc-display flex items-center gap-2 text-base font-semibold tracking-wide">
          <ToneDot tone={reportSource === "ai" ? "dc-tone-ai" : "dc-tone-info"} live={reportSource === "ai"} />
          顽固软件诊断报告
          <span className="dc-label text-muted-foreground">
            {reportSource === "ai"
              ? "AI 辅助分析 · 真实模型调用"
              : report.aiNotice?.includes("未请求云端")
                ? "本地解析 · 未请求云端"
                : report.aiNotice?.includes("仅本地模式")
                  ? "本地解析 · 仅本地模式"
                  : report.aiNotice
                    ? "本地解析 · 云端辅助不可用"
                    : "本地解析 · 未调用 AI"}
          </span>
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {report.summary ?? `共发现 ${report.findings.length} 处发现，其中 ${rebuildCount} 处有具体重建机制。`}
          本地发现均与采集证据关联；需要人工确认：AI 推断 {aiFindingCount} 项，高危动作 {highRiskCount} 项。
          处置处方逐项可选，高危项默认不勾选；生成的脚本默认 dry-run。
        </p>
        {reportSource === "ai" && report.aiMetadata && (
          <p className="dc-path text-xs text-muted-foreground">
            云端：{report.aiMetadata.provider} · 模型：{report.aiMetadata.model
              ?? "由云端 Agent 平台动态分配（本次响应未返回具体模型名）"}
            {report.aiMetadata.selection === "dynamic" ? " · 动态选择" : " · 固定模型"}
          </p>
        )}
      </Panel>

      {report.aiNotice && (
        <Panel className="dc-tone-review dc-rail grid gap-1 rounded-xl px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {report.aiNotice}
        </Panel>
      )}

      {failedCollectors.length > 0 && (
        <Panel className="dc-tone-review dc-rail grid gap-1 rounded-xl px-4 py-3 text-xs leading-relaxed">
          <h3 className="dc-display flex items-center gap-2 text-sm font-semibold">
            <TriangleAlert aria-hidden className="dc-tone-text size-4" />
            部分采集器失败，不能把空结果当成“没有发现”
          </h3>
          <p className="text-muted-foreground">
            {failedCollectors.map(([name, status]) =>
              `${COLLECTOR_LABEL[name]}${status.error ? `（${status.error}）` : ""}`).join("；")}
            。这些类别本次没有被完整采集；请不要据此判断系统里没有对应自启项。
          </p>
        </Panel>
      )}

      {report.evidence.length > 0 && (
        <Panel className="grid gap-2 rounded-xl px-4 py-3.5">
          <h3 className="dc-display text-sm font-semibold tracking-wide">采集到的本地证据</h3>
          <ul className="grid gap-2">
            {report.evidence.map((entry) => (
              <li key={entry.id} className="grid gap-1 border-b border-hairline pb-2 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="dc-tone-safe dc-tone-bg dc-tone-text dc-tone-border rounded-full border px-2 py-0.5">本地证据</span>
                  <span className="text-muted-foreground">{EVIDENCE_LABEL[entry.kind]}</span>
                  <span className="font-medium">{entry.subject}</span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{entry.detail}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {sections.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck aria-hidden />}
          title="未发现具体重建机制"
          description="本次结果未发现服务、计划任务或启动项重建证据；不代表可以直接删除，请结合占用、卸载与内容风险判断。"
        />
      ) : (
        <div className="grid gap-3">
          {sections.map(([mechanism, findings]) => (
            <div key={mechanism} className="grid gap-2">
              <h3 className="flex items-center gap-2 px-1">
                <span className={cn("dc-tone-bg dc-tone-text dc-tone-border inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", rebuildMechanisms([mechanism]).length > 0 ? "dc-tone-review" : "dc-tone-info")}>
                  {REVIVAL_LABEL[mechanism] ?? mechanism}
                </span>
                <span className="dc-num text-xs text-muted-foreground">{findings.length} 处</span>
                <span aria-hidden className="h-px flex-1 bg-hairline" />
              </h3>
              <ul className="grid gap-2">
                {findings.map((finding, index) => (
                  <li
                    key={`${finding.mechanism}-${finding.subject}-${index}`}
                    className={cn("dc-panel dc-rail dc-lift grid gap-2 rounded-xl px-4 py-3", rebuildMechanisms([mechanism]).length > 0 ? "dc-tone-review" : "dc-tone-info")}
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-medium">{finding.subject}</span>
                      <span className={cn(
                        "rounded-full border px-2 py-0.5 text-xs",
                        finding.source === "local"
                          ? "dc-tone-safe dc-tone-bg dc-tone-text dc-tone-border"
                          : "dc-tone-review dc-tone-bg dc-tone-text dc-tone-border",
                      )}>
                        {finding.source === "local" ? "本地证据" : "AI推断，需人工核对"}
                      </span>
                      <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                        证据强度
                        <span className="font-semibold text-foreground">
                          {confidenceLabel(finding.confidence)} · {finding.source === "local" ? "依据本条检测结果" : "依据云端辅助推断"}
                        </span>
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">{finding.detail}</p>
                    <dl className="grid gap-2">
                      {finding.registryPath && <MetaItem label="注册表路径">{finding.registryPath}</MetaItem>}
                      {finding.serviceName && <MetaItem label="服务名">{finding.serviceName}</MetaItem>}
                      {finding.taskName && <MetaItem label="计划任务">{finding.taskName}</MetaItem>}
                      {finding.clsid && <MetaItem label="CLSID">{finding.clsid}</MetaItem>}
                      {finding.uninstallString && <MetaItem label="卸载命令">{finding.uninstallString}</MetaItem>}
                      {finding.evidenceIds?.map((id) => <MetaItem key={id} label="关联证据">{id}</MetaItem>)}
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
            <h3 className="dc-display text-sm font-semibold tracking-wide">处理建议</h3>
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
                      <span className="dc-tone-safe dc-tone-bg dc-tone-text dc-tone-border rounded-full border px-2 py-0.5 text-xs">
                        基于本地证据生成
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