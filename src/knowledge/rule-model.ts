import type {
  EntryKind,
  KnowledgeHit,
  LocalRule,
  LocalRuleMatch,
  OwnerKind,
  RuleCandidate,
  RuleRole,
  RuleScope,
  RuleSource,
  RevivalMechanism,
  ScanEntry,
  Verdict,
} from "../core/types";
import { redactForCloud } from "../diagnose/redact";

export const RULE_TRUST: Record<RuleSource, number> = {
  builtin: 1,
  custom: 2,
  ai_candidate: 3,
  cloud_cache: 4,
  heuristic: 5,
};

export const VERDICT_SEVERITY: Record<Verdict, number> = {
  safe_delete: 0,
  needs_review: 1,
  keep_locked: 2,
};

export const ROLE_LABEL: Record<RuleRole, string> = {
  rebuildable_cache: "可重建缓存",
  configuration: "配置",
  log: "日志",
  update_residue: "更新残留",
  user_data: "用户数据",
  protected_data: "受保护数据",
};

const PROTECTED_SEGMENTS = new Set([
  "windows", "system32", "syswow64", "winsxs", "boot", "recovery", "efi",
  "$recycle.bin", "system volume information", "documents", "desktop", "pictures",
  "photos", "videos", "music", "文档", "桌面", "图片", "照片", "视频", "音乐",
  ".ssh", ".gnupg", "user data", "local storage", "cookies", "login data",
]);

export interface RuleValidationSample {
  path: string;
  name: string;
  markers: string[];
  siblings: string[];
}

export const PROTECTION_SAMPLES: RuleValidationSample[] = [
  { path: "Windows/System32", name: "System32", markers: [], siblings: [] },
  { path: "Documents/毕业论文", name: "毕业论文", markers: ["final.docx"], siblings: [] },
  { path: "Pictures/旅行", name: "旅行", markers: ["海边.jpg"], siblings: [] },
  { path: "Projects/app", name: "app", markers: ["package.json", "src"], siblings: [] },
  { path: "AppData/Roaming/Chrome/User Data/Default", name: "Default", markers: ["Local Storage", "Login Data"], siblings: [] },
];

export function strongerVerdict(a: Verdict, b: Verdict): Verdict {
  return VERDICT_SEVERITY[a] >= VERDICT_SEVERITY[b] ? a : b;
}

export function sourceTrust(source: RuleSource): number {
  return RULE_TRUST[source];
}

export function provenanceLabel(source: RuleSource): string {
  switch (source) {
    case "builtin": return "人工审查的内置规则";
    case "custom": return "用户明确创建的本地规则";
    case "ai_candidate": return "AI 辅助推断，待人工核对";
    case "cloud_cache": return "云端共享缓存，仅减少重复请求";
    case "heuristic": return "本地弱启发式";
  }
}

/** 合并两条命中时先取更保守结论；同结论时取信任层级更高者。 */
export function mergeKnowledgeHits(local: KnowledgeHit | null, incoming: KnowledgeHit | null): KnowledgeHit | null {
  if (!local) return incoming;
  if (!incoming) return local;
  const verdict = strongerVerdict(local.verdict, incoming.verdict);
  let chosen = local;
  if (VERDICT_SEVERITY[incoming.verdict] > VERDICT_SEVERITY[local.verdict]) chosen = incoming;
  else if (VERDICT_SEVERITY[incoming.verdict] === VERDICT_SEVERITY[local.verdict]
    && incoming.trustLevel < local.trustLevel) chosen = incoming;
  const evidence = [...new Set([...local.evidence, ...incoming.evidence])].slice(0, 8);
  return {
    ...chosen,
    verdict: verdict === "safe_delete" && chosen.source !== "builtin" && chosen.source !== "custom"
      ? "needs_review" : verdict,
    evidence,
    originDescription: local.verdict === incoming.verdict
      ? chosen.originDescription
      : `${chosen.originDescription}；与另一来源冲突，已采用更保守结论`,
  };
}

export function validMarkers(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = redactForCloud(value).replace(/[\\/]/g, "").trim().slice(0, 80);
    if (!clean || clean === "<user-path>" || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
    if (out.length >= 6) break;
  }
  return out;
}

export function localRuleMatch(rule: Pick<LocalRule, "match">, entry: Pick<ScanEntry, "name" | "path">,
  childNames: readonly string[], siblingNames: readonly string[]): boolean {
  if (rule.match.name && rule.match.name.toLowerCase() !== entry.name.toLowerCase()) return false;
  if (rule.match.markers.length > 0 && !rule.match.markers.every((marker) =>
    childNames.some((name) => name.toLowerCase() === marker.toLowerCase()))) return false;
  if (rule.match.siblings.length > 0 && !rule.match.siblings.every((sibling) =>
    siblingNames.some((name) => name.toLowerCase() === sibling.toLowerCase()))) return false;
  return true;
}

export function independentEvidenceCount(match: LocalRuleMatch): number {
  return (match.name ? 1 : 0) + (match.markers.length > 0 ? 1 : 0) + (match.siblings.length > 0 ? 1 : 0);
}

export function validateLocalRule(rule: LocalRule): void {
  if (rule.schemaVersion !== 1) throw new Error("自定义规则 schema 版本不受支持。");
  if (rule.source !== "custom") throw new Error("只有用户明确创建的规则才能进入自定义规则库。");
  if (!/^custom_[A-Za-z0-9_-]{8,100}$/.test(rule.id)) throw new Error("自定义规则 id 非法。");
  if (!rule.match.name && rule.match.markers.length === 0 && rule.match.siblings.length === 0) {
    throw new Error("自定义规则至少需要一个名称、标志文件或同级结构条件。");
  }
  if (rule.ruleScope === "software_fingerprint" && independentEvidenceCount(rule.match) < 2) {
    throw new Error("通用软件规则必须至少有两类独立结构证据（例如目录名＋标志文件）。");
  }
  if (rule.ruleScope === "software_fingerprint" && rule.match.markers.length === 0 && rule.match.siblings.length === 0
    && rule.verdict === "safe_delete") {
    throw new Error("只有名称匹配的通用规则不得成为推荐隔离。");
  }
  if (rule.ruleScope === "exact_path" && !rule.matchPath) throw new Error("精确目录规则缺少路径。");
  const segments = rule.matchPath.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
  if (segments.some((segment) => segment === ".." || segment.includes("*") || segment.includes("?"))) {
    throw new Error("规则路径包含通配符或回溯段，拒绝保存。");
  }
  if (rule.verdict !== "keep_locked" && segments.some((segment) => PROTECTED_SEGMENTS.has(segment))) {
    throw new Error("规则命中系统保护或用户数据目录，拒绝发布。");
  }
  for (const sample of PROTECTION_SAMPLES) {
    const relative = rule.matchPath.replace(/^\/+/, "");
    const exactHit = rule.ruleScope === "exact_path"
      && (relative === sample.path || relative === `${sample.path}/${rule.match.name}`);
    const genericHit = rule.ruleScope === "software_fingerprint"
      && localRuleMatch(rule, { name: sample.name, path: sample.path }, sample.markers, sample.siblings);
    if ((exactHit || genericHit) && rule.verdict !== "keep_locked") {
      throw new Error(`规则命中保护回归样本「${sample.path}」，拒绝发布。`);
    }
  }
  if (rule.verdict === "safe_delete" && rule.role !== "rebuildable_cache" && rule.role !== "update_residue" && rule.role !== "log") {
    throw new Error("只有可重建缓存、更新残留或日志类规则可以给出推荐隔离。");
  }
}

export interface CandidateInput {
  entry: ScanEntry;
  childNames: string[];
  siblingNames: string[];
  rootHash: string;
  judgment: {
    owner: string;
    ownerKind: OwnerKind;
    purpose: string;
    verdict: Verdict;
    confidence: number;
    rebuildable: boolean;
    reason: string;
    consequence: string;
    revival: RevivalMechanism[];
    evidence: string[];
  };
  origin: "ai" | "cache";
  model: string | null;
  searchUsed?: boolean;
  sources?: string[];
}

function roleFor(purpose: string, verdict: Verdict): RuleRole {
  if (verdict === "keep_locked") return "protected_data";
  if (/日志|log/i.test(purpose)) return "log";
  if (/配置|config/i.test(purpose)) return "configuration";
  if (/更新|update/i.test(purpose)) return "update_residue";
  if (/用户|文档|照片|聊天记录/.test(purpose)) return "user_data";
  return "rebuildable_cache";
}

export function candidateFromAi(input: CandidateInput): RuleCandidate {
  const now = Date.now();
  const childNames = validMarkers(input.childNames).slice(0, 6);
  const evidence = [
    ...input.judgment.evidence.map((item) => redactForCloud(item)),
    ...childNames.slice(0, 3).map((name) => `本地扫描发现标志性条目「${name}」`),
  ].map((item) => item.slice(0, 160)).filter(Boolean);
  return {
    schemaVersion: 1,
    id: `cand_${now.toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`,
    status: "pending",
    source: "ai_candidate",
    rootHash: input.rootHash,
    scanPath: input.entry.path,
    scanName: input.entry.name,
    kind: input.entry.kind,
    size: input.entry.size,
    fileCount: input.entry.fileCount,
    childNames,
    siblingNames: validMarkers(input.siblingNames).slice(0, 6),
    software: redactForCloud(input.judgment.owner).slice(0, 80) || "未识别软件",
    vendor: "未确认",
    ownerKind: input.judgment.ownerKind,
    purpose: redactForCloud(input.judgment.purpose).slice(0, 160),
    role: roleFor(input.judgment.purpose, input.judgment.verdict),
    reason: redactForCloud(input.judgment.reason).slice(0, 240),
    consequence: redactForCloud(input.judgment.consequence).slice(0, 240),
    confidence: Math.min(1, Math.max(0, input.judgment.confidence)),
    aiVerdict: input.judgment.verdict,
    revival: input.judgment.revival,
    evidence: [...new Set(evidence)].slice(0, 8),
    suggestedScope: "exact_path",
    genericReady: Boolean(input.entry.name) && childNames.length > 0,
    searchUsed: input.searchUsed === true,
    sources: input.sources ?? [],
    model: input.model,
    createdAt: now,
    updatedAt: now,
  };
}

export function localRuleFromCandidate(
  candidate: RuleCandidate,
  scope: RuleScope,
  verdict: Verdict = "needs_review",
  rootHash = candidate.rootHash,
): LocalRule {
  const markers = scope === "software_fingerprint" ? candidate.childNames.slice(0, 4) : [];
  const match: LocalRuleMatch = {
    name: candidate.scanName,
    markers,
    siblings: [],
  };
  const rule: LocalRule = {
    schemaVersion: 1,
    id: `custom_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`,
    source: "custom",
    enabled: true,
    ruleScope: scope,
    rootHash,
    matchPath: candidate.scanPath,
    kind: candidate.kind,
    software: candidate.software,
    vendor: candidate.vendor,
    owner: candidate.software,
    ownerKind: candidate.ownerKind,
    purpose: candidate.purpose,
    role: candidate.role,
    verdict,
    confidence: Math.max(0.5, Math.min(0.95, candidate.confidence)),
    rebuildable: candidate.role === "rebuildable_cache",
    reason: candidate.reason,
    consequence: candidate.consequence,
    revival: candidate.revival,
    evidence: candidate.evidence,
    match,
    ruleVersion: "1",
    verifiedAt: new Date().toISOString().slice(0, 10),
    originDescription: `由用户审核 AI候选后创建；来源候选 ${candidate.id}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  validateLocalRule(rule);
  return rule;
}

export function candidateMatchesEntry(candidate: RuleCandidate, entry: ScanEntry): boolean {
  return candidate.status === "pending"
    && candidate.scanPath === entry.path
    && candidate.kind === entry.kind;
}
