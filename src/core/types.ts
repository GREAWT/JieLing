export type EntryKind = "file" | "directory";

export type ScanSource = "sandbox" | "local";

export type Verdict = "safe_delete" | "needs_review" | "keep_locked";

export type OwnerKind = "app" | "system" | "dev_tool" | "cache" | "unknown";

export type RevivalMechanism =
  | "autostart_service"
  | "scheduled_task"
  | "run_key"
  | "shell_namespace"
  | "process_lock"
  | "missing_uninstaller"
  | "driver_protected";

export interface ScanEntry {
  id: string;
  path: string;
  name: string;
  kind: EntryKind;
  size: number;
  fileCount: number;
  lastModified: number;
  depth: number;
  isEmptyDir: boolean;
  parentId: string | null;
  childIds: string[];
}

export interface KnowledgeHit {
  fingerprintId: string;
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
}

export interface JudgedEntry extends ScanEntry {
  hit: KnowledgeHit | null;
  verdict: Verdict;
  riskScore: number;
  priority: number;
  locked: boolean;
  source: "fingerprint" | "ai" | "heuristic";
}

export interface OwnerGroup {
  owner: string;
  ownerKind: OwnerKind;
  entries: JudgedEntry[];
  totalSize: number;
  itemCount: number;
  /** 卡片色轨用的主导判定：有需确认就按需确认，否则按可删，全锁定才按保留 */
  verdict: Verdict;
  counts: Record<Verdict, number>;
  sizes: Record<Verdict, number>;
  selectableCount: number;
  maxPriority: number;
  revival: RevivalMechanism[];
  hasAiJudgment: boolean;
}

export interface QuarantineRecord {
  id: string;
  originalPath: string;
  quarantinePath: string;
  size: number;
  kind: EntryKind;
  quarantinedAt: number;
  expiresAt: number;
  owner: string;
  reason: string;
  restored: boolean;
}

export type ScanPhase = "idle" | "scanning" | "judging" | "ready" | "error";

export interface ScanProgress {
  phase: ScanPhase;
  visited: number;
  bytes: number;
  currentPath: string;
  truncated: boolean;
  /** 用户主动停止：结果是部分的，但不是出错 */
  stopped?: boolean;
}

export interface ScanOptions {
  maxDepth: number;
  maxEntries: number;
  skipDirs: string[];
  collectSizes: boolean;
}

export interface ScanResult {
  entries: ScanEntry[];
  progress: ScanProgress;
  rootLabel: string;
  source: ScanSource;
}

export interface GuardDecision {
  allowed: boolean;
  locked: boolean;
  reason: string;
  matchedRule: string | null;
}

export interface ResurrectionFinding {
  mechanism: RevivalMechanism;
  subject: string;
  detail: string;
  registryPath?: string;
  serviceName?: string;
  taskName?: string;
  clsid?: string;
  uninstallString?: string;
  confidence: number;
}

export interface DiagnosisReport {
  findings: ResurrectionFinding[];
  officialUninstaller: string | null;
  generatedAt: number;
  raw: string;
  advice?: string;
}

export interface CleanupAction {
  id: string;
  label: string;
  description: string;
  mechanism: RevivalMechanism;
  danger: "low" | "medium" | "high";
  command: string;
  reversible: boolean;
  selected: boolean;
}