import type {
  EntryKind,
  KnowledgeHit,
  OwnerKind,
  RevivalMechanism,
  ScanEntry,
  Verdict,
} from "../core/types";
import type { RawRule, RuleBundle } from "./types";
import rawBundle from "./fingerprints.json" with { type: "json" };

interface GlobPattern {
  re: RegExp;
  label: string;
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
  owner: string;
  ownerKind: OwnerKind;
  purpose: string;
  verdict: Verdict;
  confidence: number;
  rebuildable: boolean;
  reason: string;
  consequence: string;
  revival: RevivalMechanism[];
}

const OWNER_KINDS = new Set<string>(["app", "system", "dev_tool", "cache", "unknown"]);
const VERDICTS = new Set<string>(["safe_delete", "needs_review", "keep_locked"]);
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
    owner: requireText(raw.owner, id, "owner"),
    ownerKind: ownerKind as OwnerKind,
    purpose: requireText(raw.purpose, id, "purpose"),
    verdict: verdict as Verdict,
    confidence: raw.confidence,
    rebuildable: raw.rebuildable,
    reason: requireText(raw.reason, id, "reason"),
    consequence: requireText(raw.consequence, id, "consequence"),
    revival: raw.revival as RevivalMechanism[],
  };
}

let cached: Fingerprint[] | null = null;

export function loadFingerprints(): Fingerprint[] {
  if (cached) return cached;
  const bundle = rawBundle as unknown as RuleBundle;
  if (!bundle || bundle.version !== 1 || !Array.isArray(bundle.rules)) {
    throw new Error("fingerprints.json 结构非法：期望 { version: 1, rules: [...] }");
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

interface MatchResult {
  fp: Fingerprint;
  score: number;
  confidence: number;
  evidence: string[];
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

  const confidence = Math.min(1, Math.max(0, fp.confidence - (fp.markers && markerHitCount === 0 ? 0.05 : 0)));
  return { fp, score, confidence, evidence: evidence.slice(0, 8) };
}

function pickBest(results: MatchResult[]): MatchResult | null {
  let best: MatchResult | null = null;
  for (const r of results) {
    if (!best || r.score > best.score || (r.score === best.score && r.confidence > best.confidence)) {
      best = r;
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
    verdict: fp.verdict,
    confidence: result.confidence,
    rebuildable: fp.rebuildable,
    reason: fp.reason,
    consequence: fp.consequence,
    revival: [...fp.revival],
    evidence: result.evidence,
  };
}

export function matchFingerprint(
  entry: ScanEntry,
  siblings: ScanEntry[],
  children: ScanEntry[],
): KnowledgeHit | null {
  const path = entry.path.replace(/\\/g, "/");
  const childNames = children.map((c) => c.name);
  const siblingNames = siblings.filter((s) => s.id !== entry.id).map((s) => s.name);
  const results: MatchResult[] = [];
  for (const fp of loadFingerprints()) {
    const r = evaluate(fp, entry, path, childNames, siblingNames);
    if (r) results.push(r);
  }
  const best = pickBest(results);
  return best ? toHit(best) : null;
}

export function matchAll(entries: ScanEntry[]): Map<string, KnowledgeHit | null> {
  const byId = new Map<string, ScanEntry>();
  for (const entry of entries) byId.set(entry.id, entry);

  const nameIndex = new Map<string, Fingerprint[]>();
  const wildcard: Fingerprint[] = [];
  for (const fp of loadFingerprints()) {
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