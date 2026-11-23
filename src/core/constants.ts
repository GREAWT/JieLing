import type { ScanOptions, Verdict } from "./types";

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

export const VERDICT_ORDER: Record<Verdict, number> = {
  safe_delete: 0,
  needs_review: 1,
  keep_locked: 2,
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  safe_delete: "安全可删",
  needs_review: "需要你确认",
  keep_locked: "建议保留",
};

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