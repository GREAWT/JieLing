export type EntryKind = "file" | "directory";

export type ScanSource = "sandbox" | "local";

/** 目录子树的扫描覆盖状态；complete 与其他状态互斥 */
export type ScanCoverage =
  | "complete"
  | "depth_limited"
  | "entry_limited"
  | "skipped_children"
  | "permission_partial"
  | "cancelled";

export type Verdict = "safe_delete" | "needs_review" | "keep_locked";

export type RuleSource = "builtin" | "custom" | "ai_candidate" | "cloud_cache" | "heuristic";

export type RuleScope = "exact_path" | "software_fingerprint";

export type RuleRole =
  | "rebuildable_cache"
  | "configuration"
  | "log"
  | "update_residue"
  | "user_data"
  | "protected_data";

export interface RuleMetadata {
  source: RuleSource;
  /** 数值越小优先级越高：保护 0 > 内置 1 > 自定义 2 > AI候选 3 > 云端缓存 4 > 启发式 5 */
  trustLevel: number;
  ruleScope: RuleScope;
  ruleVersion: string;
  evidence: string[];
  verifiedAt: string;
  enabled: boolean;
  originDescription: string;
}

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
  /** 文件为 complete；目录仅在整棵子树都扫完时才是 complete */
  coverage: ScanCoverage[];
}

export interface KnowledgeHit extends RuleMetadata {
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
}

export interface JudgedEntry extends ScanEntry {
  hit: KnowledgeHit | null;
  verdict: Verdict;
  riskScore: number;
  priority: number;
  locked: boolean;
  lockReason?: string;
  source: RuleSource;
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

/** 操作清单状态：处理中 / 已隔离 / 隔离失败 / 已还原 / 还原失败 */
export type QuarantineStatus =
  | "processing"
  | "quarantined"
  | "quarantine_failed"
  | "restored"
  | "restore_failed"
  | "needs_reconcile";

/** 还原遇到同名内容时的处理策略；替换需先备份与失败回滚，暂不提供 */
export type RestorePolicy = "skip" | "keep-both";

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
  /** 原内容最后修改时间（扫描时采集），0 表示未知 */
  modifiedAt: number;
  /** 校验值：文件为内容哈希，目录为结构哈希 */
  checksum: string;
  checksumAlgo: "sha256" | "sha256-sample" | "tree-sha256" | "none";
  status: QuarantineStatus;
  /** 最近一次状态变更时间 */
  updatedAt: number;
  /** 失败原因 / 降级说明等附加信息 */
  note?: string;
}

export interface QuarantineFailure {
  path: string;
  reason: string;
}

export interface QuarantineOutcome {
  created: QuarantineRecord[];
  skipped: QuarantineFailure[];
  failures: QuarantineFailure[];
  needsReconcile: QuarantineFailure[];
}

export interface RestoreOutcome {
  restored: QuarantineRecord[];
  failures: QuarantineFailure[];
  needsReconcile: QuarantineFailure[];
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
  /** 各覆盖原因的目录数量，用于向用户说明扫描到了哪里 */
  coverage?: Partial<Record<ScanCoverage, number>> & { incompleteDirs?: number };
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
  source?: "local" | "ai";
  evidenceIds?: string[];
}

export type DiagnosisEvidenceKind =
  | "service"
  | "task"
  | "run_key"
  | "shell_namespace"
  | "process"
  | "uninstaller"
  | "startup_folder"
  | "target";

export interface DiagnosisEvidence {
  id: string;
  kind: DiagnosisEvidenceKind;
  subject: string;
  detail: string;
  serviceName?: string;
  taskPath?: string;
  taskName?: string;
  registryPath?: string;
  clsid?: string;
  processName?: string;
  uninstallString?: string;
  displayName?: string;
  publisher?: string;
  path?: string;
  driver?: boolean;
  lockSuspected?: boolean;
}

export interface AiModelMetadata {
  provider: string;
  model: string | null;
  selection: "fixed" | "dynamic";
}

export interface AiDiagnosisReport {
  findings: ResurrectionFinding[];
  officialUninstallerEvidenceId: string | null;
  advice: string;
  generatedAt: number;
  aiMetadata?: AiModelMetadata;
}

export type DiagnosisCollectorName =
  | "services"
  | "tasks"
  | "runKeys"
  | "startupFolders"
  | "shellNamespaces"
  | "uninstallers"
  | "targetStatus"
  | "processes";

export interface DiagnosisCollectorStatus {
  ok: boolean;
  count?: number;
  error?: string;
}

export interface DiagnosisReport {
  findings: ResurrectionFinding[];
  evidence: DiagnosisEvidence[];
  collectionId: string;
  officialUninstaller: string | null;
  generatedAt: number;
  raw: string;
  summary?: string;
  advice?: string;
  aiMetadata?: AiModelMetadata;
  collectionStatus?: Partial<Record<DiagnosisCollectorName, DiagnosisCollectorStatus>>;
  aiStatus?: "ok" | "quota_exhausted" | "rate_limited" | "initializing" | "not_configured" | "timeout" | "unavailable";
  aiNotice?: string;
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
  evidenceId?: string;
  source?: "local_evidence";
}

export interface LocalRuleMatch {
  name: string;
  markers: string[];
  siblings: string[];
}

export interface LocalRule {
  schemaVersion: 1;
  id: string;
  source: "custom";
  enabled: boolean;
  ruleScope: RuleScope;
  rootHash: string;
  matchPath: string;
  kind: EntryKind;
  software: string;
  vendor: string;
  owner: string;
  ownerKind: OwnerKind;
  purpose: string;
  role: RuleRole;
  verdict: Verdict;
  confidence: number;
  rebuildable: boolean;
  reason: string;
  consequence: string;
  revival: RevivalMechanism[];
  evidence: string[];
  match: LocalRuleMatch;
  ruleVersion: string;
  verifiedAt: string;
  originDescription: string;
  createdAt: number;
  updatedAt: number;
}

export type CandidateStatus = "pending" | "session_only" | "rejected" | "approved";

export interface RuleCandidate {
  schemaVersion: 1;
  id: string;
  status: CandidateStatus;
  source: "ai_candidate";
  rootHash: string;
  scanPath: string;
  scanName: string;
  kind: EntryKind;
  size: number;
  fileCount: number;
  childNames: string[];
  siblingNames: string[];
  software: string;
  vendor: string;
  ownerKind: OwnerKind;
  purpose: string;
  role: RuleRole;
  reason: string;
  consequence: string;
  confidence: number;
  aiVerdict: Verdict;
  revival: RevivalMechanism[];
  evidence: string[];
  suggestedScope: RuleScope;
  genericReady: boolean;
  searchUsed: boolean;
  sources: string[];
  model: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RuleRevision {
  version: number;
  at: number;
  reason: string;
  rules: LocalRule[];
}

export interface RulePack {
  schemaVersion: 1;
  rulesVersion: number;
  exportedAt: number;
  checksum: string;
  rules: LocalRule[];
}