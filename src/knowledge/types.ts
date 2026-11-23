export interface RawRule {
  id: string;
  name?: string[];
  glob?: string[];
  pathContains?: string[];
  pathRegex?: string[];
  kind?: string;
  empty?: boolean;
  markers?: string[];
  requireMarkers?: boolean;
  siblings?: string[];
  requireSiblings?: boolean;
  owner: string;
  ownerKind: string;
  purpose: string;
  verdict: string;
  confidence: number;
  rebuildable: boolean;
  reason: string;
  consequence: string;
  revival: string[];
}

export interface RuleBundle {
  version: number;
  rules: RawRule[];
}

export interface DiagnosisFindingDraft {
  mechanism: string;
  subject: string;
  detail: string;
  registryPath?: string;
  serviceName?: string;
  taskName?: string;
  clsid?: string;
  uninstallString?: string;
  confidence: number;
}

export interface DiagnosisCleanupStep {
  step: number;
  mechanism: string;
  action: string;
  danger: "low" | "medium" | "high";
  reversible: boolean;
  reason: string;
}

export interface DiagnosisAiResult {
  findings: DiagnosisFindingDraft[];
  officialUninstaller: string | null;
  cleanupOrder: DiagnosisCleanupStep[];
  summary: string;
}