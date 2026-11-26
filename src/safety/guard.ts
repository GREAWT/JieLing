import { HARD_LOCK_PATTERNS, SYSTEM_CRITICAL_NAMES } from "../core/constants";
import type { GuardDecision, JudgedEntry, ScanCoverage, ScanEntry } from "../core/types";

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const WILDCARD_CHARS = /[*?]/;
const CRITICAL_NAMES_LOWER = new Set(
  [...SYSTEM_CRITICAL_NAMES].map((n) => n.toLowerCase()),
);

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function evaluatePath(path: string, name: string): GuardDecision {
  const normalizedPath = normalize(path);
  const normalizedName = normalize(name);

  if (CONTROL_CHARS.test(path) || CONTROL_CHARS.test(name)) {
    return {
      allowed: false,
      locked: true,
      reason: "路径含控制字符，可能是伪造或损坏的条目，禁止操作。",
      matchedRule: "control-chars",
    };
  }
  if (WILDCARD_CHARS.test(path) || WILDCARD_CHARS.test(name)) {
    return {
      allowed: false,
      locked: true,
      reason: "路径含通配符，删除时可能波及范围外的文件，禁止操作。",
      matchedRule: "wildcard-chars",
    };
  }
  const segments = normalizedPath.split("/");
  if (segments.includes("..")) {
    return {
      allowed: false,
      locked: true,
      reason: "路径含 .. 回溯段，实际指向可能超出扫描范围，禁止操作。",
      matchedRule: "path-traversal",
    };
  }

  for (const pattern of HARD_LOCK_PATTERNS) {
    if (pattern.test(normalizedPath) || pattern.test(normalizedName)) {
      return {
        allowed: false,
        locked: true,
        reason: `命中系统硬锁规则 ${pattern.source}：属于 Windows 系统关键区域，误删会导致系统无法启动或用户配置丢失。`,
        matchedRule: pattern.source,
      };
    }
  }
  if (CRITICAL_NAMES_LOWER.has(normalizedName.toLowerCase())) {
    return {
      allowed: false,
      locked: true,
      reason: `「${name}」是系统关键对象，即使上游判断为可删也必须保留。`,
      matchedRule: "system-critical-name",
    };
  }

  return { allowed: true, locked: false, reason: "未命中硬锁规则。", matchedRule: null };
}

export function assertDeletable(entry: JudgedEntry): void {
  const decision = canQuarantineEntry(entry);
  if (!decision.allowed) {
    throw new Error(`「${entry.name}」无法进入隔离流程：${decision.reason}`);
  }
}

function untrustedSafeDelete(entry: JudgedEntry): boolean {
  return entry.verdict === "safe_delete"
    && (entry.source === "ai" || entry.source === "cache"
      || entry.hit?.source === "ai" || entry.hit?.source === "cache");
}

function incompleteCoverage(entry: JudgedEntry): boolean {
  if (entry.kind !== "directory") return false;
  return !Array.isArray(entry.coverage)
    || entry.coverage.length !== 1
    || entry.coverage[0] !== "complete";
}

/** UI 与文件操作核心层共用的隔离资格判断 */
export function canQuarantineEntry(entry: JudgedEntry): GuardDecision {
  const decision = evaluatePath(entry.path, entry.name);
  if (!decision.allowed) return decision;
  if (entry.locked) {
    return {
      allowed: false,
      locked: true,
      reason: entry.lockReason ?? "该条目已被安全规则锁定，不允许隔离。",
      matchedRule: "entry-locked",
    };
  }
  if (entry.verdict === "keep_locked") {
    return {
      allowed: false,
      locked: true,
      reason: "该条目判定为保留，不允许进入隔离流程。",
      matchedRule: "keep-locked",
    };
  }
  if (untrustedSafeDelete(entry)) {
    return {
      allowed: false,
      locked: true,
      reason: "AI 或共享缓存给出的「推荐隔离」不能作为执行依据，需人工核对本地指纹。",
      matchedRule: "untrusted-safe-delete",
    };
  }
  if (entry.verdict === "safe_delete" && (!entry.hit || entry.hit.verdict !== "safe_delete")) {
    return {
      allowed: false,
      locked: true,
      reason: "「推荐隔离」只能来自经过审查的本地指纹；缺少指纹依据时禁止执行。",
      matchedRule: "safe-delete-without-fingerprint",
    };
  }
  if (incompleteCoverage(entry)) {
    const reasons = Array.isArray(entry.coverage) && entry.coverage.length > 0
      ? entry.coverage.filter((reason) => reason !== "complete").join("、")
      : "未知";
    return {
      allowed: false,
      locked: true,
      reason: `该目录的扫描覆盖不完整（${reasons}），不能整体隔离；请重新扫描或改选已完整扫描的子项。`,
      matchedRule: "incomplete-coverage",
    };
  }
  return { allowed: true, locked: false, reason: "通过本地安全门禁。", matchedRule: null };
}

export interface CoverageSummary {
  incompleteDirs: number;
  depthLimited: number;
  entryLimited: number;
  skippedChildren: number;
  permissionPartial: number;
  cancelled: number;
}

export function summarizeCoverage(entries: readonly ScanEntry[]): CoverageSummary {
  const summary: CoverageSummary = {
    incompleteDirs: 0,
    depthLimited: 0,
    entryLimited: 0,
    skippedChildren: 0,
    permissionPartial: 0,
    cancelled: 0,
  };
  const reasonKey: Record<Exclude<ScanCoverage, "complete">, keyof Omit<CoverageSummary, "incompleteDirs">> = {
    depth_limited: "depthLimited",
    entry_limited: "entryLimited",
    skipped_children: "skippedChildren",
    permission_partial: "permissionPartial",
    cancelled: "cancelled",
  };
  for (const entry of entries) {
    if (entry.kind !== "directory") continue;
    const reasons = (entry.coverage ?? []).filter((reason) => reason !== "complete");
    if (reasons.length === 0) continue;
    summary.incompleteDirs += 1;
    for (const reason of reasons) summary[reasonKey[reason]] += 1;
  }
  return summary;
}

const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function isPowerShellSafeIdentifier(value: string): boolean {
  if (value.length === 0 || value.length > 256) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(value)) return false;
  if (value.includes("..")) return false;
  // Windows 会静默剥掉结尾的点/空格，造成「校验名」与「实际名」不一致
  if (/[. ]$/.test(value)) return false;
  if (RESERVED_DEVICE_NAMES.test(value)) return false;
  return true;
}

export function escapePowerShellString(value: string): string {
  if (CONTROL_CHARS.test(value)) {
    throw new Error("字符串含控制字符，拒绝嵌入 PowerShell 脚本。");
  }
  return `'${value.replace(/'/g, "''")}'`;
}