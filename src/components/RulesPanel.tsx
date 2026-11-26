import { useState } from "react";
import {
  BookOpen, Check, ChevronDown, FileDown, FileUp, History, RotateCcw,
  ShieldCheck, Sparkles, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { loadFingerprints } from "@/src/knowledge/match";
import { ROLE_LABEL } from "@/src/knowledge/rule-model";
import type { LocalRule, RuleCandidate, RuleRevision, RuleScope } from "@/src/core/types";
import { VERDICT_LABEL } from "@/src/core/constants";
import { Panel, ToneDot } from "./shared";

const RULE_FILES: { file: string; label: string; purpose: string; evidence: string }[] = [
  { file: "app-caches.md", label: "应用缓存", purpose: "识别软件运行产生的缓存、日志与临时状态。", evidence: "目录名、路径特征、内部缓存标志文件。" },
  { file: "browsers.md", label: "浏览器", purpose: "区分可再生成的网页缓存与必须保留的书签、密码等用户数据。", evidence: "浏览器目录结构、Cache/Code Cache 等名称与路径。" },
  { file: "bundled-software.md", label: "捆绑软件与卸载残留", purpose: "发现卸载残留、自启来源与虚拟文件夹登记，避免只删表面文件。", evidence: "软件特征目录及服务、任务、启动项等机制标记。" },
  { file: "cloud-drives.md", label: "网盘", purpose: "识别同步缓存，同时保护尚未同步完成的本地文件。", evidence: "厂商目录名、缓存子目录与同步状态结构。" },
  { file: "curated-software.md", label: "扩充软件样本", purpose: "JetBrains、Unreal Engine 与 Discord 等软件的正向、反向和保护样本。", evidence: "官方目录结构、标志文件、同级项目结构，以及四种回归样本。" },
  { file: "dev-tools.md", label: "开发工具", purpose: "识别依赖、构建产物与编译缓存，保护源码和版本历史。", evidence: "package.json 等同级配置、锁文件、构建标志文件。" },
  { file: "system.md", label: "系统目录与空目录", purpose: "锁定系统关键位置；空目录只提示人工判断，不自动判为可删。", evidence: "系统关键路径规则与目录是否为空。" },
  { file: "user-data.md", label: "用户数据保护", purpose: "优先保护文档、照片、项目、备份等不可替代内容。", evidence: "用户目录名称、文件类型与项目结构。" },
];

const RULE_COUNT = loadFingerprints().length;

export interface RulesPanelProps {
  customRules: LocalRule[];
  candidates: RuleCandidate[];
  revisions: RuleRevision[];
  rulesVersion: number;
  onToggleCustomRule: (rule: LocalRule, enabled: boolean) => void;
  onDeleteCustomRule: (rule: LocalRule) => void;
  onExportRules: () => void;
  onImportRules: (file: File | undefined) => void;
  onRollbackRules: () => void;
  onCandidateDecision: (candidate: RuleCandidate, decision: "session_only" | "rejected") => void;
  onCreateCandidateRule: (candidate: RuleCandidate, scope: RuleScope) => void;
}

function CandidateCard({
  candidate,
  onDecision,
  onCreateRule,
}: {
  candidate: RuleCandidate;
  onDecision: (candidate: RuleCandidate, decision: "session_only" | "rejected") => void;
  onCreateRule: (candidate: RuleCandidate, scope: RuleScope) => void;
}) {
  return (
    <li className="grid gap-2 rounded-lg border border-hairline px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="dc-tone-ai dc-tone-bg dc-tone-text dc-tone-border rounded-full border px-2 py-0.5 text-xs">
          AI 候选 · 待审核
        </span>
        <span className="text-sm font-medium">{candidate.software}</span>
        <span className="dc-path truncate text-xs text-muted-foreground">{candidate.scanPath}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{candidate.purpose}；{candidate.reason}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        建议风险：{VERDICT_LABEL[candidate.aiVerdict]}（候选展示封顶为“需要确认”） ·
        匹配条件：名称「{candidate.scanName}」{candidate.childNames.length > 0 ? ` ＋ 标志 ${candidate.childNames.slice(0, 3).join("、")}` : "（缺少结构证据）"}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        后果：{candidate.consequence}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {candidate.evidence.slice(0, 4).join("；") || "没有额外证据"}。
        {candidate.searchUsed
          ? candidate.sources.length > 0
            ? `联网检索来源：${candidate.sources.join("、")}（网页内容仅作不可信参考资料）`
            : "声称使用检索但未返回来源 URL，仍按 AI 辅助推断处理。"
          : "AI 辅助推断，未使用联网检索，也没有官方来源 URL。"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" onClick={() => onDecision(candidate, "session_only")}>
          <Check aria-hidden />仅本次采用
        </Button>
        <Button size="sm" onClick={() => onCreateRule(candidate, "exact_path")}>
          <ShieldCheck aria-hidden />创建精确目录规则
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!candidate.genericReady}
          title={candidate.genericReady ? "名称加标志文件两类独立证据" : "缺少可复用的结构证据，只能创建精确目录规则"}
          onClick={() => onCreateRule(candidate, "software_fingerprint")}
        >
          创建通用结构规则
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDecision(candidate, "rejected")}>
          <X aria-hidden />判定有误
        </Button>
      </div>
    </li>
  );
}

export function RulesPanel({
  customRules,
  candidates,
  revisions,
  rulesVersion,
  onToggleCustomRule,
  onDeleteCustomRule,
  onExportRules,
  onImportRules,
  onRollbackRules,
  onCandidateDecision,
  onCreateCandidateRule,
}: RulesPanelProps) {
  const [importOpen, setImportOpen] = useState(false);
  const pending = candidates.filter((candidate) => candidate.status === "pending");
  const decided = candidates.filter((candidate) => candidate.status !== "pending").slice(-8).reverse();

  return (
    <div data-region="knowledge" className="grid gap-4">
      <Panel className="dc-tone-info dc-rail grid gap-1.5 rounded-xl px-4 py-3.5">
        <h2 className="dc-display flex items-center gap-2 text-sm font-semibold tracking-wide">
          <BookOpen aria-hidden className="dc-tone-text size-4" />
          可审查的本地判定规则
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          内置规则、我的规则、AI 候选和云端缓存分层保存。规则冲突时取更保守结论；AI 候选与缓存不会成为正式规则，也不能直接产生推荐隔离。
        </p>
        <p className="dc-num text-xs text-muted-foreground">
          内置规则 v2 · {RULE_COUNT} 条 · {RULE_FILES.length} 个分类 · 我的规则 {customRules.length} 条 ·
          待审核候选 {pending.length} 条 · 自定义规则集 v{rulesVersion}
        </p>
      </Panel>

      <Panel className="grid gap-3 rounded-xl px-4 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="dc-display text-sm font-semibold tracking-wide">内置规则</h3>
          <span className="text-xs text-muted-foreground">人工审查、随构建只读发布，修改需改 Markdown 后重新编译</span>
        </div>
        <ul className="grid gap-2 md:grid-cols-2">
          {RULE_FILES.map(({ label, purpose, evidence }) => (
            <li key={label} className="grid gap-1.5 rounded-lg border border-hairline px-3 py-2.5">
              <h4 className="flex items-center gap-2 text-sm font-medium"><ToneDot tone="dc-tone-info" />{label}</h4>
              <p className="text-xs leading-relaxed text-muted-foreground"><span className="text-foreground">用途：</span>{purpose}</p>
              <p className="text-xs leading-relaxed text-muted-foreground"><span className="text-foreground">命中依据：</span>{evidence}</p>
            </li>
          ))}
        </ul>
        <p className="border-t border-hairline pt-3 text-xs leading-relaxed text-muted-foreground">
          空目录始终需要人工判断；弱启发式不会产生推荐隔离；可重建缓存仍需确认软件未运行。
        </p>
      </Panel>

      <Panel className="grid gap-3 rounded-xl px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="dc-display text-sm font-semibold tracking-wide">我的规则</h3>
          <span className="text-xs text-muted-foreground">保存在本机 IndexedDB，不写入内置 fingerprints.json</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={onExportRules} disabled={customRules.length === 0}>
              <FileDown aria-hidden />导出规则包
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen((open) => !open)}>
              <FileUp aria-hidden />导入
            </Button>
            <Button variant="outline" size="sm" onClick={onRollbackRules} disabled={revisions.length === 0}>
              <RotateCcw aria-hidden />回滚上一版
            </Button>
          </div>
        </div>
        {importOpen && (
          <input
            type="file"
            accept=".json,application/json"
            aria-label="导入本地规则包"
            className="block w-full rounded-lg border border-hairline px-3 py-2 text-xs"
            onChange={(event) => {
              onImportRules(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          导出包含 schema 版本、规则版本和 SHA-256 校验；含用户名路径的精确规则会被排除，不把用户目录带进共享包。
        </p>
        {customRules.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">还没有自定义规则。请在「待审核候选」中审核 AI 候选后创建。</p>
        ) : (
          <ul className="grid gap-2">
            {customRules.map((rule) => (
              <li key={rule.id} className="grid gap-1.5 rounded-lg border border-hairline px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={rule.enabled ? "dc-tone-safe dc-tone-text" : "dc-tone-locked dc-tone-text"}>{rule.enabled ? "已启用" : "已禁用"}</span>
                  <span className="text-sm font-medium">{rule.software}</span>
                  <span className="text-xs text-muted-foreground">{rule.ruleScope === "exact_path" ? "精确目录" : "软件结构"}</span>
                  <span className="text-xs text-muted-foreground">{VERDICT_LABEL[rule.verdict]}</span>
                  <div className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => onToggleCustomRule(rule, !rule.enabled)}>
                      {rule.enabled ? "禁用" : "重新启用"}
                    </Button>
                    <Button variant="ghost" size="sm" className="dc-tone-danger dc-tone-text" onClick={() => onDeleteCustomRule(rule)}>
                      <Trash2 aria-hidden />删除
                    </Button>
                  </div>
                </div>
                <p className="dc-path truncate text-xs text-muted-foreground">{rule.matchPath}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {ROLE_LABEL[rule.role]} · 版本 {rule.ruleVersion} · 验证于 {rule.verifiedAt} · {rule.originDescription}
                </p>
                {rule.match.markers.length > 0 && (
                  <p className="text-xs text-muted-foreground">结构标志：{rule.match.markers.join("、")}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="grid gap-3 rounded-xl px-4 py-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="dc-display flex items-center gap-2 text-sm font-semibold tracking-wide">
            <Sparkles aria-hidden className="dc-tone-ai dc-tone-text size-4" />
            待审核候选
          </h3>
          <span className="text-xs text-muted-foreground">默认只在本次扫描有效，重启后仍需审核；不会自动同步或写入共享知识库</span>
        </div>
        <p className="dc-tone-review dc-tone-bg dc-tone-border flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed">
          <Sparkles aria-hidden className="dc-tone-text mt-0.5 size-3.5 shrink-0" />
          当前云端 Agent 未配置联网检索工具，以下内容只能视为「AI 辅助推断」，没有来源 URL，也不会生成可执行清理动作。
        </p>
        {pending.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">暂无待审核候选。</p>
        ) : (
          <ul className="grid gap-2">
            {pending.map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} onDecision={onCandidateDecision} onCreateRule={onCreateCandidateRule} />
            ))}
          </ul>
        )}
        {decided.length > 0 && (
          <p className="text-xs text-muted-foreground">
            最近处理：{decided.map((candidate) =>
              `${candidate.software}（${candidate.status === "session_only" ? "仅本次" : candidate.status === "rejected" ? "判定有误" : "已创建规则"}）`).join("、")}
          </p>
        )}
      </Panel>

      <Panel className="grid gap-3 rounded-xl px-4 py-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="dc-display flex items-center gap-2 text-sm font-semibold tracking-wide">
            <History aria-hidden className="size-4" />
            更新记录
          </h3>
          <span className="text-xs text-muted-foreground">自定义规则变更记录；内置规则更新不会覆盖这里</span>
        </div>
        {revisions.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">暂无自定义规则变更记录。</p>
        ) : (
          <ul className="grid gap-1.5">
            {[...revisions].reverse().slice(0, 12).map((revision) => (
              <li key={`${revision.version}-${revision.at}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-xs">
                <span className="dc-num text-muted-foreground">v{revision.version}</span>
                <span>{revision.reason}</span>
                <span className="ml-auto text-muted-foreground">{new Date(revision.at).toLocaleString("zh-CN")}</span>
                <span className="dc-num text-muted-foreground">{revision.rules.length} 条</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Collapsible>
        <Panel className="overflow-hidden rounded-xl">
          <CollapsibleTrigger asChild>
            <button type="button" className="dc-press group/tech flex w-full items-center gap-2 px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <BookOpen aria-hidden className="size-4 text-muted-foreground" />
              <span className="dc-display text-sm font-semibold tracking-wide">技术实现与开发者扩展</span>
              <span className="ml-auto text-xs text-muted-foreground">规则原文、编译产物与 Skill 文档</span>
              <ChevronDown aria-hidden className="size-4 transition-transform group-data-[state=open]/tech:rotate-180" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="grid gap-3 border-t border-border px-4 py-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Markdown 是内置规则唯一真源，构建时编译为只读 fingerprints.json。自定义规则与 AI 候选存放在 IndexedDB；三条链路互不覆盖。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild><a href="/skill/SKILL.md" download="SKILL.md"><FileDown aria-hidden />Skill 方法论文档</a></Button>
              <Button variant="outline" size="sm" asChild><a href="/skill/references/fingerprints.json" download="fingerprints.json"><FileDown aria-hidden />fingerprints.json</a></Button>
            </div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {RULE_FILES.map(({ file, label }) => (
                <li key={file}>
                  <a href={`/skill/references/rules/${file}`} download={file} className="dc-row flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    <ToneDot tone="dc-tone-info" />
                    <span className="dc-path truncate">{file}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{label}</span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-xs leading-relaxed text-muted-foreground">此处仅提供文档下载，不宣称已被 Qoder 加载或可直接安装。</p>
          </CollapsibleContent>
        </Panel>
      </Collapsible>
    </div>
  );
}
