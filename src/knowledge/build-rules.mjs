import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rulesDir = join(here, "rules");
const outFile = join(here, "fingerprints.json");

const OWNER_KINDS = new Set(["app", "system", "dev_tool", "cache", "unknown"]);
const VERDICTS = new Set(["safe_delete", "needs_review", "keep_locked"]);
const REVIVALS = new Set([
  "autostart_service",
  "scheduled_task",
  "run_key",
  "shell_namespace",
  "process_lock",
  "missing_uninstaller",
  "driver_protected",
]);
const KINDS = new Set(["directory", "file", "any"]);
const ROLES = new Set(["rebuildable_cache", "configuration", "log", "update_residue", "user_data", "protected_data"]);
const LIST_FIELDS = new Set([
  "name", "glob", "pathContains", "markers", "siblings", "protectMarkers",
  "aliases", "platforms", "installPaths", "cachePaths", "logPaths", "configPaths",
  "userDataPaths", "processNames", "uninstallSignatures", "fileTypes",
]);
const BOOL_FIELDS = new Set(["empty", "requireMarkers", "requireSiblings", "rebuildable"]);
const TEXT_FIELDS = new Set([
  "owner", "ownerKind", "purpose", "verdict", "reason", "consequence", "revival",
  "kind", "pathRegex", "confidence", "software", "vendor", "protectVerdict", "role",
  "ruleVersion", "verifiedAt", "sampleCache", "sampleReview", "sampleProtect", "sampleNegative",
]);
const KNOWN_FIELDS = new Set([...LIST_FIELDS, ...BOOL_FIELDS, ...TEXT_FIELDS]);
const REQUIRED_FIELDS = ["owner", "ownerKind", "purpose", "verdict", "confidence", "rebuildable", "reason", "consequence", "revival"];
const WEAK_NAMES = new Set(["cache", "temp", "tmp", "logs", "log", "downloads", "files", "data", "backup", "backups"]);

const errors = [];

function fail(ruleId, file, message) {
  errors.push(`[${file} :: ${ruleId ?? "?"}] ${message}`);
}

function globToRegExpSource(pattern) {
  let out = "";
  for (const ch of pattern) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(/[.*+^${}()|[\]\\]/g, "\\$&");
  }
  return `^${out}$`;
}

function parseFile(fileName) {
  const text = readFileSync(join(rulesDir, fileName), "utf8");
  const rules = [];
  let current = null;
  let lineNo = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    lineNo += 1;
    const line = rawLine.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      current = { id: heading[1].trim(), __file: fileName, __line: lineNo };
      rules.push(current);
      continue;
    }
    const field = /^-\s+([A-Za-z]+)\s*:\s*(.*)$/.exec(line);
    if (field) {
      if (!current) {
        errors.push(`[${fileName}:${lineNo}] 字段出现在任何 "## 规则id" 之前: ${field[1]}`);
        continue;
      }
      const key = field[1];
      const value = field[2].trim();
      if (!KNOWN_FIELDS.has(key)) {
        fail(current.id, fileName, `未知字段 "${key}"（第 ${lineNo} 行）`);
        continue;
      }
      if (key in current) {
        fail(current.id, fileName, `字段 "${key}" 重复定义（第 ${lineNo} 行）`);
        continue;
      }
      if (value === "") {
        fail(current.id, fileName, `字段 "${key}" 值为空（第 ${lineNo} 行）`);
        continue;
      }
      current[key] = value;
      continue;
    }
  }
  return rules;
}

function compileRule(raw) {
  const { id, __file } = raw;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    fail(id, __file, "规则 id 必须是小写字母/数字/连字符");
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in raw)) fail(id, __file, `缺少必填字段 "${field}"`);
  }

  const rule = { id };

  for (const field of LIST_FIELDS) {
    if (raw[field] === undefined) continue;
    const items = raw[field].split("|").map((s) => s.trim()).filter(Boolean);
    if (items.length === 0) {
      fail(id, __file, `字段 "${field}" 列表为空`);
      continue;
    }
    if (field === "glob" || field === "markers" || field === "siblings" || field === "protectMarkers") {
      for (const pattern of items) {
        try {
          new RegExp(globToRegExpSource(pattern), "i");
        } catch {
          fail(id, __file, `字段 "${field}" 中的通配模式非法: ${pattern}`);
        }
      }
    }
    rule[field] = items;
  }

  if (raw.pathRegex !== undefined) {
    try {
      new RegExp(raw.pathRegex, "i");
    } catch (err) {
      fail(id, __file, `pathRegex 非法: ${err.message}`);
    }
    rule.pathRegex = [raw.pathRegex];
  }

  rule.kind = raw.kind ?? "directory";
  if (!KINDS.has(rule.kind)) fail(id, __file, `kind 非法: ${rule.kind}`);

  for (const field of BOOL_FIELDS) {
    if (raw[field] === undefined) continue;
    if (raw[field] !== "true" && raw[field] !== "false") {
      fail(id, __file, `字段 "${field}" 必须是 true/false，实际: ${raw[field]}`);
      continue;
    }
    if (raw[field] === "true") rule[field] = true;
    else if (field === "rebuildable") rule[field] = false;
  }

  if (raw.ownerKind !== undefined && !OWNER_KINDS.has(raw.ownerKind)) {
    fail(id, __file, `ownerKind 非法: ${raw.ownerKind}`);
  }
  if (raw.verdict !== undefined && !VERDICTS.has(raw.verdict)) {
    fail(id, __file, `verdict 非法: ${raw.verdict}`);
  }
  if (raw.confidence !== undefined) {
    const confidence = Number(raw.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      fail(id, __file, `confidence 必须是 0..1 的数字，实际: ${raw.confidence}`);
    } else {
      rule.confidence = confidence;
    }
  }

  if (raw.revival !== undefined) {
    if (raw.revival === "none") {
      rule.revival = [];
    } else {
      const items = raw.revival.split(",").map((s) => s.trim()).filter(Boolean);
      for (const item of items) {
        if (!REVIVALS.has(item)) fail(id, __file, `revival 机制非法: ${item}`);
      }
      rule.revival = items;
    }
  }

  for (const field of ["owner", "purpose", "reason", "consequence"]) {
    if (raw[field] === undefined) continue;
    const min = field === "owner" ? 2 : field === "purpose" ? 4 : 8;
    if (raw[field].length < min) {
      fail(id, __file, `字段 "${field}" 文案过短（至少 ${min} 字），请写清楚`);
    }
    rule[field] = raw[field];
  }
  for (const field of [
    "software", "vendor", "ruleVersion", "verifiedAt", "sampleCache", "sampleReview", "sampleProtect", "sampleNegative",
  ]) {
    if (raw[field] !== undefined) rule[field] = raw[field];
  }
  if (raw.ownerKind !== undefined) rule.ownerKind = raw.ownerKind;
  if (raw.verdict !== undefined) rule.verdict = raw.verdict;

  if (raw.role !== undefined) {
    if (!ROLES.has(raw.role)) fail(id, __file, `role 非法: ${raw.role}`);
    else rule.role = raw.role;
  }
  if (raw.protectVerdict !== undefined) {
    if (raw.protectVerdict !== "needs_review" && raw.protectVerdict !== "keep_locked") {
      fail(id, __file, `protectVerdict 只能是 needs_review 或 keep_locked`);
    } else {
      rule.protectVerdict = raw.protectVerdict;
    }
  }
  if (rule.protectVerdict && !rule.protectMarkers) {
    fail(id, __file, "protectVerdict 需要同时提供 protectMarkers");
  }

  const sampleFields = ["sampleCache", "sampleReview", "sampleProtect", "sampleNegative"];
  const sampleCount = sampleFields.filter((field) => rule[field] !== undefined).length;
  if (sampleCount > 0) {
    if (sampleCount !== 4) fail(id, __file, "四种回归样本必须同时提供");
    for (const field of ["software", "vendor"]) {
      if (!rule[field]) fail(id, __file, `提供回归样本的规则必须填写 ${field}`);
    }
    if (!rule.platforms || rule.platforms.length === 0) fail(id, __file, "提供回归样本的规则必须填写 platforms");
    if (!rule.role) fail(id, __file, "提供回归样本的规则必须填写 role");
    if (rule.sampleCache === rule.sampleNegative) fail(id, __file, "正向缓存样本不能与反向样本相同");
  }

  if (rule.verdict === "safe_delete") {
    const onlyGenericName = rule.name && rule.name.some((name) => WEAK_NAMES.has(name.toLowerCase()))
      && !rule.glob && !rule.pathContains && !rule.pathRegex && !rule.empty
      && !(rule.markers && rule.requireMarkers) && !(rule.siblings && rule.requireSiblings);
    if (onlyGenericName) {
      fail(id, __file, "不得仅通过 cache/temp/logs/downloads 等通用目录名创建全局推荐隔离规则");
    }
  }

  const hasBaseMatcher =
    rule.name || rule.glob || rule.pathContains || rule.pathRegex || rule.empty === true ||
    (rule.markers && rule.requireMarkers === true) ||
    (rule.siblings && rule.requireSiblings === true);
  if (!hasBaseMatcher) {
    fail(id, __file, "缺少有效匹配条件（name/glob/pathContains/pathRegex/empty，或 requireMarkers/requireSiblings 为 true 的 markers/siblings）");
  }
  if (rule.requireMarkers === true && !rule.markers) {
    fail(id, __file, "requireMarkers 为 true 但没有 markers");
  }
  if (rule.requireSiblings === true && !rule.siblings) {
    fail(id, __file, "requireSiblings 为 true 但没有 siblings");
  }
  if (rule.empty === true && rule.kind === "file") {
    fail(id, __file, "empty 规则不能作用于文件");
  }

  return rule;
}

const files = readdirSync(rulesDir).filter((f) => f.endsWith(".md")).sort();
if (files.length === 0) {
  console.error("rules/ 目录下没有任何 .md 规则文件");
  process.exit(1);
}

const seen = new Map();
const compiled = [];
for (const file of files) {
  const rules = parseFile(file);
  for (const raw of rules) {
    if (seen.has(raw.id)) {
      fail(raw.id, file, `规则 id 与 ${seen.get(raw.id)} 中的重复`);
    } else {
      seen.set(raw.id, file);
    }
    compiled.push(compileRule(raw));
  }
  console.log(`${file}: ${rules.length} 条规则`);
}

if (errors.length > 0) {
  console.error(`\n校验失败，共 ${errors.length} 个问题，未写入产物：`);
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

compiled.sort((a, b) => a.id.localeCompare(b.id));
const bundle = {
  version: 2,
  ruleSetVersion: "2026.11.4",
  verifiedAt: "2026-11-26",
  rules: compiled,
};
writeFileSync(outFile, JSON.stringify(bundle, null, 2) + "\n", "utf8");
console.log(`\n共 ${compiled.length} 条规则，已写入 ${outFile}`);