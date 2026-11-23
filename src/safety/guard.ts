import { HARD_LOCK_PATTERNS, SYSTEM_CRITICAL_NAMES } from "../core/constants";
import type { GuardDecision, JudgedEntry } from "../core/types";

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
  const decision = evaluatePath(entry.path, entry.name);
  if (!decision.allowed || entry.locked) {
    throw new Error(`「${entry.name}」被安全护栏锁定：${decision.reason}`);
  }
  if (entry.verdict === "keep_locked") {
    throw new Error(`「${entry.name}」判定为建议保留，不允许进入删除/隔离流程。`);
  }
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