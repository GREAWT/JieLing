import { BookOpen, ChevronDown, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { loadFingerprints } from "@/src/knowledge/match";
import { Panel, ToneDot } from "./shared";

const RULE_FILES: { file: string; label: string; purpose: string; evidence: string }[] = [
  { file: "app-caches.md", label: "应用缓存", purpose: "识别软件运行产生的缓存、日志与临时状态。", evidence: "目录名、路径特征、内部缓存标志文件。" },
  { file: "browsers.md", label: "浏览器", purpose: "区分可再生成的网页缓存与必须保留的书签、密码等用户数据。", evidence: "浏览器目录结构、Cache/Code Cache 等名称与路径。" },
  { file: "bundled-software.md", label: "捆绑软件与卸载残留", purpose: "发现卸载残留、自启来源与虚拟文件夹登记，避免只删表面文件。", evidence: "软件特征目录及服务、任务、启动项等机制标记。" },
  { file: "cloud-drives.md", label: "网盘", purpose: "识别同步缓存，同时保护尚未同步完成的本地文件。", evidence: "厂商目录名、缓存子目录与同步状态结构。" },
  { file: "dev-tools.md", label: "开发工具", purpose: "识别依赖、构建产物与编译缓存，保护源码和版本历史。", evidence: "package.json 等同级配置、锁文件、构建标志文件。" },
  { file: "system.md", label: "系统目录与空目录", purpose: "锁定系统关键位置；空目录只提示人工判断，不自动判为可删。", evidence: "系统关键路径规则与目录是否为空。" },
  { file: "user-data.md", label: "用户数据保护", purpose: "优先保护文档、照片、项目、备份等不可替代内容。", evidence: "用户目录名称、文件类型与项目结构。" },
];

const RULE_COUNT = loadFingerprints().length;

export function RulesPanel() {
  return (
    <div data-region="knowledge" className="grid gap-4">
      <Panel className="dc-tone-info dc-rail grid gap-1.5 rounded-xl px-4 py-3.5">
        <h2 className="dc-display flex items-center gap-2 text-sm font-semibold tracking-wide">
          <BookOpen aria-hidden className="dc-tone-text size-4" />
          可审查的本地判定规则
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          每条建议都先经过本地规则与系统保护检查，再按匹配证据给出高、中、低判断强度。规则可查看、可修改、可重新编译；云端模型仅作辅助，不会覆盖本地规则与系统保护。
        </p>
        <p className="dc-num text-xs text-muted-foreground">规则版本 v1 · {RULE_COUNT} 条规则 · {RULE_FILES.length} 个分类 · 本地离线运行</p>
      </Panel>

      <Panel className="grid gap-3 rounded-xl px-4 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="dc-display text-sm font-semibold tracking-wide">规则分类（{RULE_FILES.length} 类）</h3>
          <span className="text-xs text-muted-foreground">用途与命中依据面向普通用户展示</span>
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
          空目录始终需要人工判断；可重建缓存不等于删后重建风险；进程占用、卸载残留与服务/任务重建分别标注。
        </p>
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
              Markdown 是规则唯一真源，构建时编译为 fingerprints.json。请修改 Markdown 后重新编译，不要直接编辑生成文件，以免规则与产物漂移。
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
