import type {
  EntryKind,
  KnowledgeHit,
  LocalRule,
  OwnerKind,
  RevivalMechanism,
  RuleRole,
  RuleScope,
  RuleSource,
  ScanEntry,
  Verdict,
} from "../core/types";
import type { RawRule, RuleBundle } from "./types";
import rawBundle from "./fingerprints.json" with { type: "json" };
import { RULE_TRUST, VERDICT_SEVERITY } from "./rule-model";

interface GlobPattern {
  re: RegExp;
  label: string;
}

export interface RuleSamples {
  cache: string;
  review: string;
  protect: string;
  negative: string;
}

export interface Fingerprint {
  id: string;
  name?: string[];
  glob?: GlobPattern[];
  pathContains?: string[];
  pathRegex?: RegExp[];
  kind: EntryKind | "any";
  empty: boolean;
  markers?: GlobPattern[];
  requireMarkers: boolean;
  siblings?: GlobPattern[];
  requireSiblings: boolean;
  protectMarkers?: GlobPattern[];
  protectVerdict?: "needs_review" | "keep_locked";
  owner: string;
  ownerKind: OwnerKind;
  purpose: string;
  verdict: Verdict;
  confidence: number;
  rebuildable: boolean;
  reason: string;
  consequence: string;
  revival: RevivalMechanism[];
  source: RuleSource;
  trustLevel: number;
  ruleScope: RuleScope;
  ruleVersion: string;
  verifiedAt: string;
  enabled: boolean;
  originDescription: string;
  software?: string;
  vendor?: string;
  aliases: string[];
  platforms: string[];
  role?: RuleRole;
  samples?: RuleSamples;
}

const OWNER_KINDS = new Set<string>(["app", "system", "dev_tool", "cache", "unknown"]);
const VERDICTS = new Set<string>(["safe_delete", "needs_review", "keep_locked"]);
const ROLES = new Set<string>([
  "rebuildable_cache", "configuration", "log", "update_residue", "user_data", "protected_data",
]);
const REVIVALS = new Set<string>([
  "autostart_service",
  "scheduled_task",
  "run_key",
  "shell_namespace",
  "process_lock",
  "missing_uninstaller",
  "driver_protected",
]);
const KINDS = new Set<string>(["directory", "file", "any"]);

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (const ch of pattern) {
    if (ch === "*") source += ".*";
    else if (ch === "?") source += ".";
    else source += ch.replace(/[.*+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i");
}

function compileGlobs(patterns: string[] | undefined, ruleId: string, field: string): GlobPattern[] | undefined {
  if (!patterns) return undefined;
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error(`fingerprints.json 规则 ${ruleId}: ${field} 必须是非空数组`);
  }
  return patterns.map((label) => {
    if (typeof label !== "string" || label.length === 0) {
      throw new Error(`fingerprints.json 规则 ${ruleId}: ${field} 含非法模式`);
    }
    return { re: globToRegExp(label), label };
  });
}

function requireText(value: unknown, ruleId: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`fingerprints.json 规则 ${ruleId}: 缺少字段 ${field}`);
  }
  return value;
}

function compileRule(raw: RawRule): Fingerprint {
  const id = requireText(raw.id, "<unknown>", "id");
  const ownerKind = requireText(raw.ownerKind, id, "ownerKind");
  const verdict = requireText(raw.verdict, id, "verdict");
  const kind = raw.kind ?? "directory";
  if (!OWNER_KINDS.has(ownerKind)) throw new Error(`fingerprints.json 规则 ${id}: ownerKind 非法 ${ownerKind}`);
  if (!VERDICTS.has(verdict)) throw new Error(`fingerprints.json 规则 ${id}: verdict 非法 ${verdict}`);
  if (!KINDS.has(kind)) throw new Error(`fingerprints.json 规则 ${id}: kind 非法 ${kind}`);
  if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
    throw new Error(`fingerprints.json 规则 ${id}: confidence 越界`);
  }
  if (typeof raw.rebuildable !== "boolean") {
    throw new Error(`fingerprints.json 规则 ${id}: rebuildable 必须是布尔值`);
  }
  if (!Array.isArray(raw.revival) || raw.revival.some((m) => !REVIVALS.has(m))) {
    throw new Error(`fingerprints.json 规则 ${id}: revival 含非法机制`);
  }
  const pathRegex = raw.pathRegex?.map((source) => {
    // 扫描路径相对所选根目录，没有前导斜杠。规则里写成 /... 的（macOS 绝对路径或正则定界符）
    // 必须改成路径段边界锚点，否则这些规则在真实扫描中永远不命中。
    const anchored = source.startsWith("/") ? `(?:^|/)${source.slice(1)}` : source;
    try {
      return new RegExp(anchored, "i");
    } catch {
      throw new Error(`fingerprints.json 规则 ${id}: pathRegex 非法 ${source}`);
    }
  });
  const role = raw.role ?? (
    ownerKind === "system" ? "protected_data"
      : ownerKind === "cache" ? "rebuildable_cache"
        : raw.rebuildable ? "rebuildable_cache" : "user_data"
  );
  if (!ROLES.has(role)) throw new Error(`fingerprints.json 规则 ${id}: role 非法 ${role}`);
  const sampleValues = [raw.sampleCache, raw.sampleReview, raw.sampleProtect, raw.sampleNegative];
  if (sampleValues.some(Boolean) && !sampleValues.every(Boolean)) {
    throw new Error(`fingerprints.json 规则 ${id}: 四种回归样本必须同时提供`);
  }
  return {
    id,
    name: raw.name?.map((n) => n.toLowerCase()),
    glob: compileGlobs(raw.glob, id, "glob"),
    pathContains: raw.pathContains?.map((s) => s.toLowerCase()),
    pathRegex,
    kind: kind as EntryKind | "any",
    empty: raw.empty === true,
    markers: compileGlobs(raw.markers, id, "markers"),
    requireMarkers: raw.requireMarkers === true,
    siblings: compileGlobs(raw.siblings, id, "siblings"),
    requireSiblings: raw.requireSiblings === true,
    protectMarkers: compileGlobs(raw.protectMarkers, id, "protectMarkers"),
    ...(raw.protectVerdict === "keep_locked" || raw.protectVerdict === "needs_review"
      ? { protectVerdict: raw.protectVerdict } : {}),
    owner: requireText(raw.owner, id, "owner"),
    ownerKind: ownerKind as OwnerKind,
    purpose: requireText(raw.purpose, id, "purpose"),
    verdict: verdict as Verdict,
    confidence: raw.confidence,
    rebuildable: raw.rebuildable,
    reason: requireText(raw.reason, id, "reason"),
    consequence: requireText(raw.consequence, id, "consequence"),
    revival: raw.revival as RevivalMechanism[],
    source: "builtin",
    trustLevel: RULE_TRUST.builtin,
    ruleScope: "software_fingerprint",
    ruleVersion: raw.ruleVersion ?? "2",
    verifiedAt: raw.verifiedAt ?? "2026-11-26",
    enabled: true,
    originDescription: `人工审查的内置规则 · ${raw.owner}`,
    software: raw.software ?? raw.owner,
    vendor: raw.vendor,
    aliases: raw.aliases ?? [],
    platforms: raw.platforms ?? ["windows"],
    role: role as RuleRole,
    ...(sampleValues.every(Boolean) ? {
      samples: {
        cache: raw.sampleCache!,
        review: raw.sampleReview!,
        protect: raw.sampleProtect!,
        negative: raw.sampleNegative!,
      },
    } : {}),
  };
}

let cached: Fingerprint[] | null = null;

export function loadFingerprints(): Fingerprint[] {
  if (cached) return cached;
  const bundle = rawBundle as unknown as RuleBundle;
  if (!bundle || (bundle.version !== 1 && bundle.version !== 2) || !Array.isArray(bundle.rules)) {
    throw new Error("fingerprints.json 结构非法：期望 { version: 1|2, rules: [...] }");
  }
  const seen = new Set<string>();
  cached = bundle.rules.map((raw) => {
    const fp = compileRule(raw);
    if (seen.has(fp.id)) throw new Error(`fingerprints.json 规则 id 重复: ${fp.id}`);
    seen.add(fp.id);
    return fp;
  });
  return cached;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 自定义规则与内置规则共享同一匹配器，但来源、信任层级和作用域保持独立。 */
export function compileLocalRules(rules: readonly LocalRule[], rootHash: string): Fingerprint[] {
  const compiled: Fingerprint[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.ruleScope === "exact_path" && rule.rootHash !== rootHash) continue;
    const markers = rule.match.markers.map((label) => ({ re: globToRegExp(label), label }));
    const siblings = rule.match.siblings.map((label) => ({ re: globToRegExp(label), label }));
    compiled.push({
      id: `custom:${rule.id}`,
      name: rule.match.name ? [rule.match.name.toLowerCase()] : undefined,
      ...(rule.ruleScope === "exact_path" ? {
        pathRegex: [new RegExp(`^${escapeRegExp(rule.matchPath)}$`, "i")],
      } : {}),
      kind: rule.kind,
      empty: false,
      markers: markers.length > 0 ? markers : undefined,
      requireMarkers: markers.length > 0,
      siblings: siblings.length > 0 ? siblings : undefined,
      requireSiblings: siblings.length > 0,
      owner: rule.owner,
      ownerKind: rule.ownerKind,
      purpose: rule.purpose,
      verdict: rule.verdict,
      confidence: rule.confidence,
      rebuildable: rule.rebuildable,
      reason: rule.reason,
      consequence: rule.consequence,
      revival: [...rule.revival],
      source: "custom",
      trustLevel: RULE_TRUST.custom,
      ruleScope: rule.ruleScope,
      ruleVersion: rule.ruleVersion,
      verifiedAt: rule.verifiedAt,
      enabled: rule.enabled,
      originDescription: rule.originDescription,
      software: rule.software,
      vendor: rule.vendor,
      aliases: [],
      platforms: ["windows"],
      role: rule.role,
    });
  }
  return compiled;
}

interface MatchResult {
  fp: Fingerprint;
  score: number;
  confidence: number;
  evidence: string[];
  protectedVerdict?: "needs_review" | "keep_locked";
}

function globHits(patterns: GlobPattern[], names: string[]): { label: string; name: string }[] {
  const hits: { label: string; name: string }[] = [];
  for (const pattern of patterns) {
    const name = names.find((n) => pattern.re.test(n));
    if (name !== undefined) hits.push({ label: pattern.label, name });
  }
  return hits;
}

function evaluate(
  fp: Fingerprint,
  entry: ScanEntry,
  path: string,
  childNames: string[],
  siblingNames: string[],
): MatchResult | null {
  if (fp.kind !== "any" && entry.kind !== fp.kind) return null;
  if (fp.empty && !entry.isEmptyDir) return null;

  const evidence: string[] = [];
  let score = 0;
  const lowerName = entry.name.toLowerCase();
  const lowerPath = path.toLowerCase();

  if (fp.name) {
    if (!fp.name.includes(lowerName)) return null;
    score += 4;
    evidence.push(`目录名「${entry.name}」与已知指纹一致`);
  }
  if (fp.glob) {
    const hit = fp.glob.find((g) => g.re.test(entry.name));
    if (!hit) return null;
    score += 3;
    evidence.push(`名称「${entry.name}」匹配模式 ${hit.label}`);
  }
  if (fp.pathContains) {
    const hit = fp.pathContains.find((s) => lowerPath.includes(s));
    if (!hit) return null;
    score += 2;
    evidence.push(`路径包含特征「${hit}」`);
  }
  if (fp.pathRegex) {
    if (!fp.pathRegex.every((re) => re.test(path))) return null;
    score += 3;
    evidence.push(`路径符合特征 ${fp.pathRegex.map((re) => re.source).join(" ")}`);
  }

  let markerHitCount = 0;
  if (fp.markers) {
    const hits = globHits(fp.markers, childNames);
    if (fp.requireMarkers && hits.length === 0) return null;
    markerHitCount = hits.length;
    score += hits.length * 3 + (fp.requireMarkers && hits.length > 0 ? 2 : 0);
    for (const hit of hits.slice(0, 3)) {
      evidence.push(`内部存在标志性条目「${hit.name}」（匹配 ${hit.label}）`);
    }
  }
  if (fp.siblings) {
    const hits = globHits(fp.siblings, siblingNames);
    if (fp.requireSiblings && hits.length === 0) return null;
    score += hits.length * 2 + (fp.requireSiblings && hits.length > 0 ? 2 : 0);
    for (const hit of hits.slice(0, 2)) {
      evidence.push(`同级存在「${hit.name}」，符合该指纹的项目结构特征`);
    }
  }
  if (fp.empty) {
    evidence.push("目录为空，不含任何文件");
  }
  if (evidence.length === 0) return null;

  let protectedVerdict: "needs_review" | "keep_locked" | undefined;
  if (fp.protectMarkers) {
    const protectHits = globHits(fp.protectMarkers, childNames);
    if (protectHits.length > 0) {
      protectedVerdict = fp.protectVerdict ?? "needs_review";
      for (const hit of protectHits.slice(0, 2)) {
        evidence.push(`发现保护标志「${hit.name}」，升级为${protectedVerdict === "keep_locked" ? "默认保护" : "需要确认"}`);
      }
    }
  }

  const confidence = Math.min(1, Math.max(0, fp.confidence - (fp.markers && markerHitCount === 0 ? 0.05 : 0)));
  return { fp, score, confidence, evidence: evidence.slice(0, 8), ...(protectedVerdict ? { protectedVerdict } : {}) };
}

function pickBest(results: MatchResult[]): MatchResult | null {
  let best: MatchResult | null = null;
  for (const result of results) {
    const resultVerdict = result.protectedVerdict ?? result.fp.verdict;
    if (!best) {
      best = result;
      continue;
    }
    const bestVerdict = best.protectedVerdict ?? best.fp.verdict;
    if (VERDICT_SEVERITY[resultVerdict] > VERDICT_SEVERITY[bestVerdict]) {
      best = result;
      continue;
    }
    if (VERDICT_SEVERITY[resultVerdict] < VERDICT_SEVERITY[bestVerdict]) continue;
    if (result.fp.trustLevel < best.fp.trustLevel) {
      best = result;
      continue;
    }
    if (result.fp.trustLevel === best.fp.trustLevel
      && (result.score > best.score || (result.score === best.score && result.confidence > best.confidence))) {
      best = result;
    }
  }
  return best;
}

function toHit(result: MatchResult): KnowledgeHit {
  const { fp } = result;
  return {
    fingerprintId: fp.id,
    owner: fp.owner,
    ownerKind: fp.ownerKind,
    purpose: fp.purpose,
    verdict: result.protectedVerdict ?? fp.verdict,
    confidence: result.confidence,
    rebuildable: fp.rebuildable,
    reason: fp.reason,
    consequence: fp.consequence,
    revival: [...fp.revival],
    evidence: result.evidence,
    source: fp.source,
    trustLevel: fp.trustLevel,
    ruleScope: fp.ruleScope,
    ruleVersion: fp.ruleVersion,
    verifiedAt: fp.verifiedAt,
    enabled: fp.enabled,
    originDescription: fp.originDescription,
  };
}

export function matchFingerprint(
  entry: ScanEntry,
  siblings: ScanEntry[],
  children: ScanEntry[],
  rules: readonly Fingerprint[] = loadFingerprints(),
): KnowledgeHit | null {
  const path = entry.path.replace(/\\/g, "/");
  const childNames = children.map((c) => c.name);
  const siblingNames = siblings.filter((s) => s.id !== entry.id).map((s) => s.name);
  const results: MatchResult[] = [];
  for (const fp of rules) {
    if (!fp.enabled) continue;
    const r = evaluate(fp, entry, path, childNames, siblingNames);
    if (r) results.push(r);
  }
  const best = pickBest(results);
  return best ? toHit(best) : null;
}

export function matchAll(
  entries: ScanEntry[],
  extraRules: readonly Fingerprint[] = [],
): Map<string, KnowledgeHit | null> {
  const byId = new Map<string, ScanEntry>();
  for (const entry of entries) byId.set(entry.id, entry);

  const rules = [...loadFingerprints(), ...extraRules].filter((rule) => rule.enabled);
  const nameIndex = new Map<string, Fingerprint[]>();
  const wildcard: Fingerprint[] = [];
  for (const fp of rules) {
    if (fp.name) {
      for (const name of fp.name) {
        const list = nameIndex.get(name);
        if (list) list.push(fp);
        else nameIndex.set(name, [fp]);
      }
    } else {
      wildcard.push(fp);
    }
  }

  const resolve = (ids: string[]): ScanEntry[] => {
    const out: ScanEntry[] = [];
    for (const id of ids) {
      const e = byId.get(id);
      if (e) out.push(e);
    }
    return out;
  };

  const result = new Map<string, KnowledgeHit | null>();
  for (const entry of entries) {
    const parent = entry.parentId !== null ? byId.get(entry.parentId) : undefined;
    const siblings = parent ? resolve(parent.childIds.filter((id) => id !== entry.id)) : [];
    const children = resolve(entry.childIds);
    const path = entry.path.replace(/\\/g, "/");
    const childNames = children.map((c) => c.name);
    const siblingNames = siblings.map((s) => s.name);
    const candidates = (nameIndex.get(entry.name.toLowerCase()) ?? []).concat(wildcard);
    const matches: MatchResult[] = [];
    for (const fp of candidates) {
      const r = evaluate(fp, entry, path, childNames, siblingNames);
      if (r) matches.push(r);
    }
    const best = pickBest(matches);
    result.set(entry.id, best ? toHit(best) : null);
  }
  return result;
}