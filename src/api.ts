import type { DiagnosisReport, OwnerKind, RevivalMechanism, ScanEntry, Verdict } from "./core/types";

const BASE = "/functions/v1/app";
const TIMEOUT_MS = 45_000;

export interface JudgeItem {
  key: string;
  name: string;
  ancestors: string[];
  childDirs: string[];
  childExts: string[];
  fileCount: number;
  dirCount: number;
  sizeBytes: number;
  isEmpty: boolean;
}

export interface AiJudgment {
  key: string;
  fingerprint?: string;
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
  origin: "cache" | "ai";
}

export type AiStatus =
  | "ok" | "quota_exhausted" | "rate_limited" | "initializing"
  | "not_configured" | "timeout" | "unavailable";

export interface JudgeResponse {
  judgments: AiJudgment[];
  unresolved: string[];
  cachedCount: number;
  aiStatus: AiStatus;
}

export interface DiagnoseResponse {
  report: DiagnosisReport | null;
  aiStatus: AiStatus;
}

export const AI_STATUS_TEXT: Record<AiStatus, string> = {
  ok: "云端 AI 判定完成",
  quota_exhausted: "今日共享 AI 额度已用尽，本地知识库判定仍然可用",
  rate_limited: "请求过于频繁，请稍后再试；本地知识库判定仍然可用",
  initializing: "云端 AI 正在首次初始化，稍后重试即可",
  not_configured: "云端 AI 尚未启用，当前使用本地知识库判定",
  timeout: "云端 AI 响应超时，已回退本地规则，这些目录保持「需要确认」",
  unavailable: "云端 AI 暂时不可用，已回退本地规则，这些目录保持「需要确认」",
};

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

const PUBLIC_TEXT: Record<string, string> = {
  invalid_input: "提交的数据不符合要求",
  payload_too_large: "提交的数据过大",
  not_found: "接口不存在",
  login_required: "需要登录后才能使用云端 AI",
  invalid_user_context: "登录状态无效，请刷新页面",
  database_not_configured: "站点数据库尚未配置",
  database_credential_rejected: "站点数据库凭据被拒绝",
};

export function apiErrorText(error: unknown): string {
  if (error instanceof ApiError) return PUBLIC_TEXT[error.code] ?? "服务暂时不可用，请稍后重试";
  if (error instanceof DOMException && error.name === "AbortError") return "请求超时，请稍后重试";
  return "网络异常，无法连接云端服务";
}

async function post<T>(path: string, body: unknown, validate: (value: unknown) => T | null): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const type = response.headers.get("content-type") ?? "";
    // A login redirect returns HTML; never render it as a business result.
    if (!type.includes("application/json")) throw new ApiError("service_unavailable", response.status);
    const payload: unknown = await response.json();
    if (!response.ok) {
      const code = (payload as { error?: { code?: string } })?.error?.code;
      throw new ApiError(typeof code === "string" ? code : "service_unavailable", response.status);
    }
    const parsed = validate(payload);
    if (parsed === null) throw new ApiError("invalid_response", response.status);
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

const VERDICTS = new Set<string>(["safe_delete", "needs_review", "keep_locked"]);
const OWNER_KINDS = new Set<string>(["app", "system", "dev_tool", "cache", "unknown"]);
const MECHANISMS = new Set<string>([
  "autostart_service", "scheduled_task", "run_key", "shell_namespace",
  "process_lock", "missing_uninstaller", "driver_protected",
]);
const AI_STATUSES = new Set<string>([
  "ok", "quota_exhausted", "rate_limited", "initializing", "not_configured", "timeout", "unavailable",
]);

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length <= max ? value : null;
const strings = (value: unknown, maxItems: number, maxLen: number): string[] | null => {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const out: string[] = [];
  for (const item of value) {
    const parsed = text(item, maxLen);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
};

function parseJudgment(value: unknown): AiJudgment | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const key = text(raw.key, 64);
  const owner = text(raw.owner, 80);
  const purpose = text(raw.purpose, 160);
  const reason = text(raw.reason, 240);
  const consequence = text(raw.consequence, 240);
  const revival = strings(raw.revival, 7, 40);
  const evidence = strings(raw.evidence, 4, 160);
  if (!key || !owner || !purpose || !reason || !consequence || !revival || !evidence) return null;
  if (typeof raw.verdict !== "string" || !VERDICTS.has(raw.verdict)) return null;
  if (typeof raw.ownerKind !== "string" || !OWNER_KINDS.has(raw.ownerKind)) return null;
  if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence)) return null;
  if (raw.origin !== "cache" && raw.origin !== "ai") return null;
  return {
    key,
    ...(typeof raw.fingerprint === "string" ? { fingerprint: raw.fingerprint } : {}),
    owner,
    ownerKind: raw.ownerKind as OwnerKind,
    purpose,
    verdict: raw.verdict as Verdict,
    confidence: Math.min(1, Math.max(0, raw.confidence)),
    rebuildable: raw.rebuildable === true,
    reason,
    consequence,
    revival: revival.filter((m) => MECHANISMS.has(m)) as RevivalMechanism[],
    evidence,
    origin: raw.origin,
  };
}

function parseStatus(value: unknown): AiStatus {
  return typeof value === "string" && AI_STATUSES.has(value) ? (value as AiStatus) : "unavailable";
}

export async function judgeDirectories(items: JudgeItem[]): Promise<JudgeResponse> {
  return post("/api/judge", { items }, (payload) => {
    if (!payload || typeof payload !== "object") return null;
    const raw = payload as Record<string, unknown>;
    if (!Array.isArray(raw.judgments) || raw.judgments.length > 24) return null;
    const judgments: AiJudgment[] = [];
    for (const entry of raw.judgments) {
      const parsed = parseJudgment(entry);
      if (!parsed) return null;
      judgments.push(parsed);
    }
    const unresolved = strings(raw.unresolved, 24, 64);
    if (!unresolved) return null;
    if (typeof raw.cachedCount !== "number" || !Number.isSafeInteger(raw.cachedCount)) return null;
    return { judgments, unresolved, cachedCount: raw.cachedCount, aiStatus: parseStatus(raw.aiStatus) };
  });
}

function parseFinding(value: unknown): DiagnosisReport["findings"][number] | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.mechanism !== "string" || !MECHANISMS.has(raw.mechanism)) return null;
  const subject = text(raw.subject, 120);
  const detail = text(raw.detail, 400);
  if (!subject || detail === null) return null;
  if (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence)) return null;
  const optional = (field: string, max: number) => {
    const parsed = text(raw[field], max);
    return parsed && parsed.trim() ? { [field]: parsed } : {};
  };
  return {
    mechanism: raw.mechanism as RevivalMechanism,
    subject,
    detail,
    ...optional("registryPath", 300),
    ...optional("serviceName", 120),
    ...optional("taskName", 200),
    ...optional("clsid", 80),
    ...optional("uninstallString", 400),
    confidence: Math.min(1, Math.max(0, raw.confidence)),
  };
}

export async function requestDiagnosis(input: {
  subject: string;
  symptoms: string;
  scriptOutput?: string | null;
}): Promise<DiagnoseResponse> {
  return post("/api/diagnose", input, (payload) => {
    if (!payload || typeof payload !== "object") return null;
    const raw = payload as Record<string, unknown>;
    const aiStatus = parseStatus(raw.aiStatus);
    if (raw.report === null || raw.report === undefined) return { report: null, aiStatus };
    if (typeof raw.report !== "object") return null;
    const report = raw.report as Record<string, unknown>;
    if (!Array.isArray(report.findings) || report.findings.length > 12) return null;
    const findings: DiagnosisReport["findings"] = [];
    for (const entry of report.findings) {
      const parsed = parseFinding(entry);
      if (!parsed) return null;
      findings.push(parsed);
    }
    const officialUninstaller = text(report.officialUninstaller, 400);
    const advice = text(report.advice, 400);
    if (officialUninstaller === null || advice === null) return null;
    return {
      report: {
        findings,
        officialUninstaller: officialUninstaller.trim() ? officialUninstaller : null,
        generatedAt: typeof report.generatedAt === "number" ? report.generatedAt : Date.now(),
        raw: "",
        ...(advice.trim() ? { advice } : {}),
      },
      aiStatus,
    };
  });
}

export async function backendReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(`${BASE}/api/health`, { credentials: "same-origin", signal: controller.signal });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) return false;
    const payload: unknown = await response.json();
    return Boolean(payload && typeof payload === "object" && (payload as { ok?: unknown }).ok === true);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// The Windows account name must never leave the browser: redact the profile
// segment client-side, before the request is built.
function redactAncestors(segments: string[]): string[] {
  return segments.map((segment, index) =>
    index > 0 && /^(Users|home|Documents and Settings)$/i.test(segments[index - 1]) ? "<user>" : segment);
}

export function toJudgeItem(entry: ScanEntry, byId: Map<string, ScanEntry>, key: string): JudgeItem {
  const segments = entry.path.split("/").filter(Boolean);
  const childDirs: string[] = [];
  const exts = new Set<string>();
  for (const childId of entry.childIds) {
    const child = byId.get(childId);
    if (!child) continue;
    if (child.kind === "directory") {
      if (childDirs.length < 12) childDirs.push(child.name.slice(0, 120));
    } else {
      const dot = child.name.lastIndexOf(".");
      if (dot > 0 && dot < child.name.length - 1) exts.add(child.name.slice(dot, dot + 16).toLowerCase());
    }
  }
  const ancestors = segments.slice(0, -1);
  const parentIsProfile = ancestors.length > 0
    && /^(Users|home|Documents and Settings)$/i.test(ancestors[ancestors.length - 1]);
  return {
    key,
    // 目录名本身可能就是 Windows 账户名（Users 下的 profile 目录）：同样脱敏
    name: parentIsProfile ? "<user>" : entry.name.slice(0, 200),
    ancestors: redactAncestors(ancestors).slice(-8).map((s) => s.slice(0, 120)),
    childDirs,
    childExts: [...exts].slice(0, 12),
    fileCount: entry.fileCount,
    dirCount: entry.childIds.length,
    sizeBytes: entry.size,
    isEmpty: entry.isEmptyDir,
  };
}