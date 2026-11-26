import type { ScanCoverage, ScanOptions, Verdict } from "./types";

export const PRODUCT_NAME = "洁灵";
export const PRODUCT_TAGLINE = "AI 磁盘清理决策助手";
export const PRODUCT_PHILOSOPHY = "隔离而非入侵，安全审核优先于暴力删除";

export const QUARANTINE_DIR = ".dareclean-quarantine";
export const QUARANTINE_TTL_DAYS = 7;

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  maxDepth: 8,
  maxEntries: 20000,
  skipDirs: [
    "$Recycle.Bin",
    "System Volume Information",
    "Windows",
    "WinSxS",
    "Program Files",
    "Program Files (x86)",
    "ProgramData",
    ".git",
    QUARANTINE_DIR,
  ],
  collectSizes: true,
};

export const HARD_LOCK_PATTERNS: RegExp[] = [
  /(^|\/)Windows(\/|$)/i,
  /(^|\/)System32(\/|$)/i,
  /(^|\/)SysWOW64(\/|$)/i,
  /(^|\/)WinSxS(\/|$)/i,
  /(^|\/)Boot(\/|$)/i,
  /(^|\/)Recovery(\/|$)/i,
  /(^|\/)\$Recycle\.Bin(\/|$)/i,
  /(^|\/)System Volume Information(\/|$)/i,
  /(^|\/)pagefile\.sys$/i,
  /(^|\/)hiberfil\.sys$/i,
  /(^|\/)swapfile\.sys$/i,
  /(^|\/)ntuser\.dat$/i,
  /(^|\/)NTUSER\.DAT$/i,
  /(^|\/)bootmgr$/i,
  /(^|\/)EFI(\/|$)/i,
];

export const SYSTEM_CRITICAL_NAMES = new Set([
  "Windows",
  "System32",
  "SysWOW64",
  "WinSxS",
  "Boot",
  "Recovery",
  "EFI",
  "$Recycle.Bin",
  "System Volume Information",
  "pagefile.sys",
  "hiberfil.sys",
  "swapfile.sys",
  "bootmgr",
  "ntuser.dat",
]);

/** 这些目录可以作为只读扫描根查看，但扫描结果始终保持保护、不可隔离。 */
export const READ_ONLY_ROOT_NAMES = new Set([
  ...SYSTEM_CRITICAL_NAMES,
  "Program Files",
  "Program Files (x86)",
  "ProgramData",
]);

export function isReadOnlyRootName(name: string): boolean {
  return READ_ONLY_ROOT_NAMES.has(name.trim());
}

export const VERDICT_ORDER: Record<Verdict, number> = {
  safe_delete: 0,
  needs_review: 1,
  keep_locked: 2,
};

export const SCAN_COVERAGE_LABEL: Record<ScanCoverage, string> = {
  complete: "完整扫描",
  depth_limited: "达到深度上限",
  entry_limited: "达到条目上限",
  skipped_children: "含被跳过子目录",
  permission_partial: "权限不足或读取失败",
  cancelled: "扫描被手动停止",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  safe_delete: "推荐隔离",
  needs_review: "需要确认",
  keep_locked: "默认保护",
};

/** 每个风险等级对应的建议动作，工作台列表与抽屉共用 */
export const VERDICT_ACTION: Record<Verdict, string> = {
  safe_delete: "勾选后移入隔离区",
  needs_review: "展开依据，确认后再勾选",
  keep_locked: "保留，不参与勾选",
};

/** AI 判定低于该置信度时，「推荐隔离」一律降档为「需要确认」 */
export const AI_SAFE_CONFIDENCE = 0.8;

export const AI_DIRECTORY_DATA_NOTICE = "仅发送脱敏后的目录名称、层级、扩展名和统计信息，不发送文件内容。";

export const REVIVAL_LABEL: Record<string, string> = {
  autostart_service: "服务自启重建",
  scheduled_task: "计划任务重建",
  run_key: "启动项重建",
  shell_namespace: "外壳虚拟文件夹",
  process_lock: "进程占用",
  missing_uninstaller: "卸载器缺失",
  driver_protected: "驱动级保护",
};

export const REVIVAL_ORDER: string[] = [
  "shell_namespace",
  "autostart_service",
  "scheduled_task",
  "run_key",
  "process_lock",
  "missing_uninstaller",
  "driver_protected",
];

export const REBUILD_MECHANISMS: ReadonlySet<string> = new Set([
  "autostart_service", "scheduled_task", "run_key",
]);

export function rebuildMechanisms(mechanisms: readonly string[]): string[] {
  return mechanisms.filter((mechanism) => REBUILD_MECHANISMS.has(mechanism));
}

export function confidenceLabel(value: number): "高" | "中" | "低" {
  return value >= 0.8 ? "高" : value >= 0.5 ? "中" : "低";
}