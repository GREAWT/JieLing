import { REVIVAL_ORDER } from "../core/constants";
import type {
  AiDiagnosisReport,
  CleanupAction,
  DiagnosisCollectorName,
  DiagnosisCollectorStatus,
  DiagnosisEvidence,
  DiagnosisEvidenceKind,
  DiagnosisReport,
  ResurrectionFinding,
  RevivalMechanism,
} from "../core/types";
import { escapePowerShellString, isPowerShellSafeIdentifier } from "../safety/guard";

const GUID_RE = /^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/;
const RUN_KEY_RE = /^(HKLM|HKCU):\\SOFTWARE\\(Wow6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Run(Once)?$/;
const NS_KEY_RE = /^(HKLM|HKCU):\\SOFTWARE\\(Wow6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Explorer\\(MyComputer|Desktop)\\NameSpace\\\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/;
const MAX_FINDINGS = 200;
const MAX_EVIDENCE = 400;

const COLLECTORS: DiagnosisCollectorName[] = [
  "services", "tasks", "runKeys", "startupFolders",
  "shellNamespaces", "uninstallers", "targetStatus", "processes",
];

function parseCollectionStatus(value: unknown): Partial<Record<DiagnosisCollectorName, DiagnosisCollectorStatus>> | undefined {
  const source = asRecord(value);
  if (!source) return undefined;
  const out: Partial<Record<DiagnosisCollectorName, DiagnosisCollectorStatus>> = {};
  for (const name of COLLECTORS) {
    const entry = asRecord(source[name]);
    if (!entry || typeof entry.ok !== "boolean") continue;
    out[name] = {
      ok: entry.ok,
      ...(typeof entry.count === "number" && Number.isFinite(entry.count) && entry.count >= 0
        ? { count: Math.floor(entry.count) } : {}),
      ...(typeof entry.error === "string" && entry.error.trim()
        ? { error: entry.error.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240) } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const EVIDENCE_RANK: Record<DiagnosisEvidenceKind, number> = {
  service: 0,
  task: 1,
  run_key: 2,
  shell_namespace: 3,
  process: 4,
  startup_folder: 5,
  target: 6,
  uninstaller: 7,
};

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === null || value === undefined ? [] : [value];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function toPsRegistryPath(path: string): string {
  return path
    .replace(/^HKEY_LOCAL_MACHINE\\/i, "HKLM:\\")
    .replace(/^HKEY_CURRENT_USER\\/i, "HKCU:\\")
    .replace(/^Microsoft\.PowerShell\.Core\\Registry::/i, "");
}

function isSafeTaskPath(path: string): boolean {
  if (!path.startsWith("\\") || !path.endsWith("\\")) return false;
  const segments = path.slice(1, -1).split("\\").filter((s) => s.length > 0);
  return segments.every(isPowerShellSafeIdentifier);
}

function revivalRank(mechanism: RevivalMechanism): number {
  const index = REVIVAL_ORDER.indexOf(mechanism);
  return index === -1 ? REVIVAL_ORDER.length : index;
}

function newCollectionId(): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "");
  return random ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function parseDiagnosisReport(
  raw: string,
  options: { collectionId?: string } = {},
): DiagnosisReport {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("回传内容中找不到 JSON，请确认上传的是诊断脚本的完整输出。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("诊断 JSON 解析失败，输出可能被截断，请重新运行脚本并完整复制。");
  }
  const data = asRecord(parsed);
  if (!data || str(data.schema) !== "dareclean-diagnosis-v1") {
    throw new Error("诊断报告格式不符（缺少 dareclean-diagnosis-v1 标识），拒绝采信。");
  }

  const collectionId = options.collectionId ?? newCollectionId();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(collectionId)) {
    throw new Error("本地证据集合标识格式非法。");
  }
  const evidence: DiagnosisEvidence[] = [];
  const evidenceByKey = new Map<string, DiagnosisEvidence>();
  let evidenceIndex = 0;
  const addEvidence = (
    kind: DiagnosisEvidenceKind,
    key: string,
    fields: Omit<DiagnosisEvidence, "id" | "kind">,
  ): DiagnosisEvidence | null => {
    const normalizedKey = `${kind}:${key.toLowerCase()}`;
    const existing = evidenceByKey.get(normalizedKey);
    if (existing) return existing;
    if (evidence.length >= MAX_EVIDENCE) return null;
    evidenceIndex += 1;
    const entry: DiagnosisEvidence = {
      id: `ev_${collectionId}_${kind}_${String(evidenceIndex).padStart(3, "0")}`,
      kind,
      ...fields,
    };
    evidence.push(entry);
    evidenceByKey.set(normalizedKey, entry);
    return entry;
  };

  const findings: ResurrectionFinding[] = [];
  const pushFinding = (
    finding: Omit<ResurrectionFinding, "source" | "evidenceIds">,
    evidenceId: string,
  ): void => {
    if (findings.length >= MAX_FINDINGS) return;
    if (findings.some((f) => f.mechanism === finding.mechanism && f.evidenceIds?.[0] === evidenceId)) return;
    findings.push({ ...finding, source: "local", evidenceIds: [evidenceId] });
  };

  for (const item of asArray(data.services)) {
    const s = asRecord(item);
    if (!s) continue;
    const name = str(s.name);
    if (!name) continue;
    const isDriver = s.isDriver === true;
    const detail = `${str(s.displayName)} → ${str(s.pathName)}（启动类型 ${str(s.startMode)}，状态 ${str(s.state)}）`;
    const entry = addEvidence("service", name, {
      subject: name,
      detail,
      serviceName: name,
      driver: isDriver,
    });
    if (!entry) continue;
    pushFinding({
      mechanism: isDriver ? "driver_protected" : "autostart_service",
      subject: name,
      detail,
      serviceName: name,
      confidence: isDriver ? 0.9 : str(s.startMode).toLowerCase() === "auto" ? 0.9 : 0.7,
    }, entry.id);
  }

  for (const item of asArray(data.tasks)) {
    const t = asRecord(item);
    if (!t) continue;
    const taskName = str(t.taskName);
    if (!taskName) continue;
    const taskPath = str(t.taskPath);
    const full = `${taskPath}${taskName}`;
    const detail = `计划任务动作：${str(t.actions)}（状态 ${str(t.state)}）`;
    const entry = addEvidence("task", full, {
      subject: full,
      detail,
      taskPath,
      taskName,
    });
    if (!entry) continue;
    pushFinding({
      mechanism: "scheduled_task",
      subject: full,
      detail,
      taskName: full,
      confidence: 0.85,
    }, entry.id);
  }

  for (const item of asArray(data.runKeys)) {
    const r = asRecord(item);
    if (!r || r.matchesTarget !== true) continue;
    const name = str(r.name);
    const key = toPsRegistryPath(str(r.key));
    if (!name || !key) continue;
    const detail = `开机启动命令（${key}）：${str(r.command)}`;
    const entry = addEvidence("run_key", `${key}\\${name}`, {
      subject: name,
      detail,
      registryPath: key,
    });
    if (!entry) continue;
    pushFinding({
      mechanism: "run_key",
      subject: name,
      detail,
      registryPath: key,
      confidence: 0.85,
    }, entry.id);
  }

  for (const item of asArray(data.startupFolders)) {
    const s = asRecord(item);
    if (!s || s.matchesTarget !== true) continue;
    const name = str(s.name);
    const path = str(s.fullName);
    if (!name || !path) continue;
    const detail = `启动文件夹中存在项目：${path}`;
    const entry = addEvidence("startup_folder", path, { subject: name, detail, path });
    if (!entry) continue;
    pushFinding({
      mechanism: "run_key",
      subject: name,
      detail,
      confidence: 0.75,
    }, entry.id);
  }

  for (const item of asArray(data.shellNamespaces)) {
    const n = asRecord(item);
    if (!n || n.matchesTarget !== true) continue;
    const clsid = str(n.clsid);
    if (!GUID_RE.test(clsid)) continue;
    const root = toPsRegistryPath(str(n.root));
    const registryPath = `${root}\\${clsid}`;
    const detail = `外壳命名空间扩展 ${clsid}，DLL：${str(n.dll) || "未解析"}。这类虚拟文件夹在磁盘上没有实体，所以资源管理器里找不到却一直显示。`;
    const entry = addEvidence("shell_namespace", registryPath, {
      subject: str(n.displayName) || clsid,
      detail,
      registryPath,
      clsid,
    });
    if (!entry) continue;
    pushFinding({
      mechanism: "shell_namespace",
      subject: entry.subject,
      detail,
      registryPath,
      clsid,
      confidence: 0.85,
    }, entry.id);
  }

  for (const item of asArray(data.processes)) {
    const p = asRecord(item);
    if (!p) continue;
    const name = str(p.name);
    if (!name) continue;
    const path = str(p.path);
    const detail = `进程正在运行：${path}`;
    const entry = addEvidence("process", `${name}\\${path}`, {
      subject: name,
      detail,
      processName: name,
      path,
    });
    if (!entry) continue;
    pushFinding({
      mechanism: "process_lock",
      subject: name,
      detail,
      confidence: 0.8,
    }, entry.id);
  }

  const targetStatus = asArray(data.targetStatus).map(asRecord);
  const targetEvidence: DiagnosisEvidence[] = [];
  for (const t of targetStatus) {
    if (!t) continue;
    const path = str(t.path);
    if (!path) continue;
    const detail = t.exists === true
      ? `目标存在${t.isDirectory === true ? "（目录）" : ""}${t.lockSuspected === true ? "，文件独占打开失败，疑似被进程占用。请关闭相关程序后重试；这不是删后重建。" : ""}`
      : "本次采集时目标不存在。";
    const entry = addEvidence("target", path, {
      subject: baseName(path),
      detail,
      path,
      lockSuspected: t.lockSuspected === true,
    });
    if (!entry) continue;
    targetEvidence.push(entry);
    if (t.lockSuspected === true) {
      pushFinding({
        mechanism: "process_lock",
        subject: entry.subject,
        detail: `${detail}。直接删除会失败或删不干净，需要先人工确认占用进程。`,
        confidence: 0.6,
      }, entry.id);
    }
  }

  const uninstallers = asArray(data.uninstallers).map(asRecord);
  let officialUninstaller: string | null = null;
  for (const u of uninstallers) {
    if (!u) continue;
    const uninstallString = str(u.uninstallString);
    const displayName = str(u.displayName);
    if (!uninstallString && !displayName) continue;
    const detail = `注册表卸载入口：${uninstallString || "未提供 UninstallString"}；安装位置：${str(u.installLocation) || "未提供"}`;
    const entry = addEvidence("uninstaller", `${displayName}\\${uninstallString}\\${str(u.registryPath)}`, {
      subject: displayName || "未命名卸载器",
      detail,
      uninstallString: uninstallString || undefined,
      displayName: displayName || undefined,
      publisher: str(u.publisher) || undefined,
      path: str(u.installLocation) || undefined,
      registryPath: str(u.registryPath) || undefined,
    });
    if (!entry) continue;
    if (!officialUninstaller && uninstallString) officialUninstaller = uninstallString;
  }

  const anyTargetExists = targetStatus.some((t) => t?.exists === true);
  const sourceEvidence = evidence.find((entry) =>
    entry.kind === "service" || entry.kind === "task"
    || entry.kind === "run_key" || entry.kind === "shell_namespace"
    || entry.kind === "startup_folder",
  );
  if (anyTargetExists && !officialUninstaller && sourceEvidence) {
    pushFinding({
      mechanism: "missing_uninstaller",
      subject: sourceEvidence.subject,
      detail: "目标存在且有自启源头，但注册表中找不到官方卸载器。只删文件可能留下重建来源，请先核对并优先寻找官方卸载入口。",
      confidence: 0.6,
    }, sourceEvidence.id);
  }

  findings.sort((a, b) => revivalRank(a.mechanism) - revivalRank(b.mechanism));
  const generatedAt = typeof data.generatedAt === "number" ? data.generatedAt : Date.now();
  const collectionStatus = parseCollectionStatus(data.collectionStatus);
  return {
    findings,
    evidence,
    collectionId,
    officialUninstaller,
    generatedAt,
    raw,
    ...(collectionStatus ? { collectionStatus } : {}),
    summary: `本地采集到 ${evidence.length} 项证据，${findings.length} 项可能与复活有关。可执行处方只使用通过校验的本地对象；AI 推断不会进入脚本。`,
  };
}

export function mergeAiDiagnosis(local: DiagnosisReport, ai: AiDiagnosisReport): DiagnosisReport {
  const evidenceById = new Map(local.evidence.map((entry) => [entry.id, entry]));
  for (const finding of ai.findings) {
    for (const id of finding.evidenceIds ?? []) {
      if (!evidenceById.has(id)) throw new Error("AI 返回了未在本地证据中出现的 ID，拒绝采信。");
    }
  }
  if (ai.officialUninstallerEvidenceId !== null) {
    const entry = evidenceById.get(ai.officialUninstallerEvidenceId);
    if (!entry || entry.kind !== "uninstaller") {
      throw new Error("AI 返回的卸载器证据 ID 未匹配本地卸载入口，拒绝采信。");
    }
  }
  const aiFindings = ai.findings.map((finding) => {
    const {
      registryPath: _registryPath,
      serviceName: _serviceName,
      taskName: _taskName,
      clsid: _clsid,
      uninstallString: _uninstallString,
      ...safe
    } = finding;
    return { ...safe, source: "ai" as const, evidenceIds: [...(finding.evidenceIds ?? [])] };
  });
  return {
    ...local,
    findings: [...local.findings, ...aiFindings],
    advice: ai.advice,
    aiStatus: "ok",
    aiNotice: undefined,
    ...(ai.aiMetadata ? { aiMetadata: ai.aiMetadata } : {}),
  };
}

export function withLocalDiagnosisNotice(
  report: DiagnosisReport,
  aiStatus: NonNullable<DiagnosisReport["aiStatus"]>,
  aiNotice: string,
): DiagnosisReport {
  return { ...report, aiStatus, aiNotice };
}

function guidanceAction(
  id: string,
  mechanism: RevivalMechanism,
  label: string,
  description: string,
  text: string,
  danger: CleanupAction["danger"],
  evidenceId: string,
): CleanupAction {
  return {
    id,
    label,
    description,
    mechanism,
    danger,
    command: `Write-Host ${escapePowerShellString(text)}`,
    reversible: true,
    selected: false,
    evidenceId,
    source: "local_evidence",
  };
}

export function planCleanupActions(report: DiagnosisReport): CleanupAction[] {
  const actions: CleanupAction[] = [];
  const ordered = [...report.evidence].sort((a, b) => EVIDENCE_RANK[a.kind] - EVIDENCE_RANK[b.kind]);

  for (const entry of ordered) {
    let mechanism: RevivalMechanism;
    switch (entry.kind) {
      case "service": mechanism = entry.driver ? "driver_protected" : "autostart_service"; break;
      case "task": mechanism = "scheduled_task"; break;
      case "run_key":
      case "startup_folder": mechanism = "run_key"; break;
      case "shell_namespace": mechanism = "shell_namespace"; break;
      case "process":
      case "target": mechanism = "process_lock"; break;
      case "uninstaller": continue;
    }
    const id = `act-${actions.length}-${mechanism}`;

    switch (entry.kind) {
      case "service": {
        const name = entry.serviceName ?? "";
        if (entry.driver) {
          actions.push(guidanceAction(id, "driver_protected", `驱动级保护「${entry.subject}」：走官方卸载`, entry.detail, "检测到驱动级保护。不要手工停止或删除驱动，请使用官方卸载器（必要时进安全模式），否则可能蓝屏。", "high", entry.id));
        } else if (!isPowerShellSafeIdentifier(name)) {
          actions.push(guidanceAction(id, mechanism, `人工核对服务「${entry.subject}」`, entry.detail, `服务名「${name}」含非常规字符，请在 services.msc 中人工停止并禁用。`, "high", entry.id));
        } else {
          const q = escapePowerShellString(name);
          actions.push({
            id,
            label: `停止并禁用服务「${name}」`,
            description: `${entry.detail}。禁用后重启不会再拉起重建进程；可随时重新启用，可逆。`,
            mechanism,
            danger: "medium",
            command: `Stop-Service -Name ${q} -Force -ErrorAction SilentlyContinue; Set-Service -Name ${q} -StartupType Disabled`,
            reversible: true,
            selected: true,
            evidenceId: entry.id,
            source: "local_evidence",
          });
        }
        break;
      }
      case "task": {
        const taskPath = entry.taskPath ?? "";
        const taskName = entry.taskName ?? "";
        if (!isSafeTaskPath(taskPath) || !isPowerShellSafeIdentifier(taskName)) {
          actions.push(guidanceAction(id, mechanism, `人工核对计划任务「${entry.subject}」`, entry.detail, "任务路径含非常规字符，请在 taskschd.msc 中人工禁用。", "high", entry.id));
        } else {
          actions.push({
            id,
            label: `禁用计划任务「${taskName}」`,
            description: `${entry.detail}。选择禁用而非删除，保留任务定义以便恢复。`,
            mechanism,
            danger: "medium",
            command: `Disable-ScheduledTask -TaskPath ${escapePowerShellString(taskPath)} -TaskName ${escapePowerShellString(taskName)}`,
            reversible: true,
            selected: true,
            evidenceId: entry.id,
            source: "local_evidence",
          });
        }
        break;
      }
      case "run_key": {
        const key = toPsRegistryPath(entry.registryPath ?? "");
        const valueName = entry.subject;
        if (!RUN_KEY_RE.test(key) || !isPowerShellSafeIdentifier(valueName)) {
          actions.push(guidanceAction(id, mechanism, `人工核对启动项「${entry.subject}」`, entry.detail, "启动项路径或名称超出允许范围，请在 regedit 中人工核对后处理。", "high", entry.id));
        } else {
          actions.push({
            id,
            label: `移除启动项「${valueName}」`,
            description: `${entry.detail}。脚本会先把原值备份到用户目录的 JSON 文件，再删除这一个值；不批量清理注册表。`,
            mechanism,
            danger: "high",
            command: `Remove-ItemProperty -LiteralPath ${escapePowerShellString(key)} -Name ${escapePowerShellString(valueName)}`,
            reversible: true,
            selected: false,
            evidenceId: entry.id,
            source: "local_evidence",
          });
        }
        break;
      }
      case "shell_namespace": {
        const key = toPsRegistryPath(entry.registryPath ?? "");
        if (!NS_KEY_RE.test(key) || !GUID_RE.test(entry.clsid ?? "")) {
          actions.push(guidanceAction(id, mechanism, `人工核对外壳扩展「${entry.subject}」`, entry.detail, "外壳扩展注册表路径超出允许范围，请人工核对。", "high", entry.id));
        } else {
          actions.push({
            id,
            label: `摘除外壳虚拟文件夹「${entry.subject}」`,
            description: "只从 NameSpace 下摘除这一个 CLSID 注册，让虚拟文件夹从资源管理器消失；不删除磁盘文件，也不动 CLSID 本体。脚本会先备份默认值。",
            mechanism,
            danger: "high",
            command: `Remove-Item -LiteralPath ${escapePowerShellString(key)}`,
            reversible: true,
            selected: false,
            evidenceId: entry.id,
            source: "local_evidence",
          });
        }
        break;
      }
      case "process": {
        const name = entry.processName ?? "";
        if (!isPowerShellSafeIdentifier(name)) {
          actions.push(guidanceAction(id, mechanism, `手动结束占用「${entry.subject}」`, entry.detail, "请先退出对应软件（含托盘图标），再执行清理。", "high", entry.id));
        } else {
          actions.push({
            id,
            label: `结束占用进程「${name}」`,
            description: `${entry.detail}。强制结束可能丢失未保存数据，请先尝试正常退出软件。`,
            mechanism,
            danger: "high",
            command: `Stop-Process -Name ${escapePowerShellString(name)} -Force`,
            reversible: false,
            selected: false,
            evidenceId: entry.id,
            source: "local_evidence",
          });
        }
        break;
      }
      case "startup_folder": {
        actions.push(guidanceAction(id, mechanism, `人工核对启动文件夹项目「${entry.subject}」`, entry.detail, "启动文件夹项目没有安全的自动处置模板。请核对文件来源与数字签名后，人工决定是否移除。", "high", entry.id));
        break;
      }
      case "target": {
        if (entry.lockSuspected) {
          actions.push(guidanceAction(id, mechanism, `手动确认占用「${entry.subject}」`, entry.detail, "请先正常退出对应软件；仅在确认没有未保存数据后，才考虑结束进程。", "high", entry.id));
        }
        break;
      }
    }
  }

  const source = report.evidence.find((entry) =>
    entry.kind === "service" || entry.kind === "task" || entry.kind === "run_key"
    || entry.kind === "shell_namespace" || entry.kind === "startup_folder",
  );
  const hasTarget = report.evidence.some((entry) => entry.kind === "target");
  if (!report.officialUninstaller && source && hasTarget) {
    const id = `act-${actions.length}-missing_uninstaller`;
    actions.push(guidanceAction(id, "missing_uninstaller", "先找官方卸载器，再谈删文件", "目标存在且有自启源头，但本地未采集到官方卸载器。", "未找到官方卸载器。请到软件设置或官网寻找专用卸载工具；确认无卸载器后，再逐项执行上面勾选的断源头操作。", "low", source.id));
  }

  return actions;
}
