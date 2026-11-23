import { REVIVAL_LABEL, REVIVAL_ORDER } from "../core/constants";
import type {
  CleanupAction,
  DiagnosisReport,
  ResurrectionFinding,
  RevivalMechanism,
} from "../core/types";
import { escapePowerShellString, isPowerShellSafeIdentifier } from "../safety/guard";

const GUID_RE = /^\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/;
const RUN_KEY_RE = /^(HKLM|HKCU):\\SOFTWARE\\(Wow6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Run(Once)?$/;
const NS_KEY_RE = /^(HKLM|HKCU):\\SOFTWARE\\(Wow6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Explorer\\(MyComputer|Desktop)\\NameSpace\\\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/;
const MAX_FINDINGS = 200;

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
  // 控制字符会破坏后续 PowerShell 转义，解析阶段统一清洗
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ") : "";
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

export function parseDiagnosisReport(raw: string): DiagnosisReport {
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

  const findings: ResurrectionFinding[] = [];
  const push = (finding: ResurrectionFinding): void => {
    if (findings.length >= MAX_FINDINGS) return;
    const dup = findings.some(
      (f) =>
        f.mechanism === finding.mechanism &&
        f.subject === finding.subject &&
        (f.registryPath ?? "") === (finding.registryPath ?? ""),
    );
    if (!dup) findings.push(finding);
  };

  for (const item of asArray(data.services)) {
    const s = asRecord(item);
    if (!s) continue;
    const name = str(s.name);
    if (!name) continue;
    const isDriver = s.isDriver === true;
    push({
      mechanism: isDriver ? "driver_protected" : "autostart_service",
      subject: name,
      detail: `${str(s.displayName)} → ${str(s.pathName)}（启动类型 ${str(s.startMode)}，状态 ${str(s.state)}）`,
      serviceName: name,
      confidence: isDriver ? 0.9 : str(s.startMode).toLowerCase() === "auto" ? 0.9 : 0.7,
    });
  }

  for (const item of asArray(data.tasks)) {
    const t = asRecord(item);
    if (!t) continue;
    const taskName = str(t.taskName);
    if (!taskName) continue;
    push({
      mechanism: "scheduled_task",
      subject: `${str(t.taskPath)}${taskName}`,
      detail: `计划任务动作：${str(t.actions)}（状态 ${str(t.state)}）`,
      taskName: `${str(t.taskPath)}${taskName}`,
      confidence: 0.85,
    });
  }

  for (const item of asArray(data.runKeys)) {
    const r = asRecord(item);
    if (!r || r.matchesTarget !== true) continue;
    const name = str(r.name);
    const key = toPsRegistryPath(str(r.key));
    if (!name || !key) continue;
    push({
      mechanism: "run_key",
      subject: name,
      detail: `开机启动命令（${key}）：${str(r.command)}`,
      registryPath: key,
      confidence: 0.85,
    });
  }

  for (const item of asArray(data.shellNamespaces)) {
    const n = asRecord(item);
    if (!n || n.matchesTarget !== true) continue;
    const clsid = str(n.clsid);
    if (!GUID_RE.test(clsid)) continue;
    const root = toPsRegistryPath(str(n.root));
    push({
      mechanism: "shell_namespace",
      subject: str(n.displayName) || clsid,
      detail: `外壳命名空间扩展 ${clsid}，DLL：${str(n.dll) || "未解析"}。这类虚拟文件夹在磁盘上没有实体，所以资源管理器里找不到却一直显示。`,
      registryPath: `${root}\\${clsid}`,
      clsid,
      confidence: 0.85,
    });
  }

  for (const item of asArray(data.processes)) {
    const p = asRecord(item);
    if (!p) continue;
    const name = str(p.name);
    if (!name) continue;
    push({
      mechanism: "process_lock",
      subject: name,
      detail: `进程正在运行：${str(p.path)}`,
      confidence: 0.8,
    });
  }

  const targetStatus = asArray(data.targetStatus).map(asRecord);
  for (const t of targetStatus) {
    if (!t || t.lockSuspected !== true) continue;
    push({
      mechanism: "process_lock",
      subject: str(t.path),
      detail: "文件独占打开失败，疑似被进程占用，直接删除会失败或删不干净。",
      confidence: 0.6,
    });
  }

  const uninstallers = asArray(data.uninstallers).map(asRecord);
  const officialUninstaller =
    uninstallers.map((u) => (u ? str(u.uninstallString) : "")).find((s) => s.length > 0) ?? null;

  const anyTargetExists = targetStatus.some((t) => t?.exists === true);
  const hasSourceFinding = findings.some((f) =>
    f.mechanism === "autostart_service" ||
    f.mechanism === "scheduled_task" ||
    f.mechanism === "run_key" ||
    f.mechanism === "shell_namespace",
  );
  if (anyTargetExists && !officialUninstaller && hasSourceFinding) {
    push({
      mechanism: "missing_uninstaller",
      subject: asArray(data.targets).map(str).filter(Boolean).join("；"),
      detail: "目标存在且有自启源头，但注册表中找不到官方卸载器——只删文件必然复活。",
      confidence: 0.6,
    });
  }

  findings.sort((a, b) => revivalRank(a.mechanism) - revivalRank(b.mechanism));

  const generatedAt = typeof data.generatedAt === "number" ? data.generatedAt : Date.now();
  return { findings, officialUninstaller, generatedAt, raw };
}

function guidanceAction(
  id: string,
  mechanism: RevivalMechanism,
  label: string,
  description: string,
  text: string,
  danger: CleanupAction["danger"],
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
  };
}

export function planCleanupActions(report: DiagnosisReport): CleanupAction[] {
  const actions: CleanupAction[] = [];
  const ordered = [...report.findings].sort(
    (a, b) => revivalRank(a.mechanism) - revivalRank(b.mechanism),
  );

  ordered.forEach((finding, index) => {
    const id = `act-${index}-${finding.mechanism}`;
    const label = REVIVAL_LABEL[finding.mechanism] ?? finding.mechanism;

    switch (finding.mechanism) {
      case "autostart_service": {
        const name = finding.serviceName ?? "";
        if (!isPowerShellSafeIdentifier(name)) {
          actions.push(guidanceAction(id, finding.mechanism, `人工核对服务「${finding.subject}」`, finding.detail, `服务名「${name}」含非常规字符，请在 services.msc 中人工停止并禁用。`, "high"));
          break;
        }
        const q = escapePowerShellString(name);
        actions.push({
          id,
          label: `停止并禁用服务「${name}」`,
          description: `${finding.detail}。禁用后重启不会再拉起重建进程；可随时重新启用，可逆。`,
          mechanism: finding.mechanism,
          danger: "medium",
          command: `Stop-Service -Name ${q} -Force -ErrorAction SilentlyContinue; Set-Service -Name ${q} -StartupType Disabled`,
          reversible: true,
          selected: true,
        });
        break;
      }
      case "scheduled_task": {
        const full = finding.taskName ?? "";
        const cut = full.lastIndexOf("\\");
        const taskPath = cut >= 0 ? full.slice(0, cut + 1) : "\\";
        const taskName = cut >= 0 ? full.slice(cut + 1) : full;
        if (!isSafeTaskPath(taskPath) || !isPowerShellSafeIdentifier(taskName)) {
          actions.push(guidanceAction(id, finding.mechanism, `人工核对计划任务「${finding.subject}」`, finding.detail, `任务路径含非常规字符，请在 taskschd.msc 中人工禁用。`, "high"));
          break;
        }
        actions.push({
          id,
          label: `禁用计划任务「${taskName}」`,
          description: `${finding.detail}。选择禁用而非删除，保留任务定义以便恢复。`,
          mechanism: finding.mechanism,
          danger: "medium",
          command: `Disable-ScheduledTask -TaskPath ${escapePowerShellString(taskPath)} -TaskName ${escapePowerShellString(taskName)}`,
          reversible: true,
          selected: true,
        });
        break;
      }
      case "run_key": {
        const key = toPsRegistryPath(finding.registryPath ?? "");
        const valueName = finding.subject;
        if (!RUN_KEY_RE.test(key) || !isPowerShellSafeIdentifier(valueName)) {
          actions.push(guidanceAction(id, finding.mechanism, `人工核对启动项「${finding.subject}」`, finding.detail, "启动项路径或名称超出允许范围，请在 regedit 中人工核对后处理。", "high"));
          break;
        }
        actions.push({
          id,
          label: `移除启动项「${valueName}」`,
          description: `${finding.detail}。脚本会先把原值备份到用户目录的 JSON 文件，再删除这一个值；不批量清理注册表。`,
          mechanism: finding.mechanism,
          danger: "high",
          command: `Remove-ItemProperty -LiteralPath ${escapePowerShellString(key)} -Name ${escapePowerShellString(valueName)}`,
          reversible: true,
          selected: false,
        });
        break;
      }
      case "shell_namespace": {
        const key = toPsRegistryPath(finding.registryPath ?? "");
        if (!NS_KEY_RE.test(key) || !GUID_RE.test(finding.clsid ?? "")) {
          actions.push(guidanceAction(id, finding.mechanism, `人工核对外壳扩展「${finding.subject}」`, finding.detail, "外壳扩展注册表路径超出允许范围，请人工核对。", "high"));
          break;
        }
        actions.push({
          id,
          label: `摘除外壳虚拟文件夹「${finding.subject}」`,
          description: "只从 NameSpace 下摘除这一个 CLSID 注册，让虚拟文件夹从资源管理器消失；不删除磁盘文件，也不动 CLSID 本体。脚本会先备份默认值。",
          mechanism: finding.mechanism,
          danger: "high",
          command: `Remove-Item -LiteralPath ${escapePowerShellString(key)}`,
          reversible: true,
          selected: false,
        });
        break;
      }
      case "process_lock": {
        const name = finding.subject;
        if (!isPowerShellSafeIdentifier(name)) {
          actions.push(guidanceAction(id, finding.mechanism, `手动结束占用「${name}」`, finding.detail, "请先退出对应软件（含托盘图标），再执行清理。", "high"));
          break;
        }
        actions.push({
          id,
          label: `结束占用进程「${name}」`,
          description: `${finding.detail}。强制结束可能丢失未保存数据，请先尝试正常退出软件。`,
          mechanism: finding.mechanism,
          danger: "high",
          command: `Stop-Process -Name ${escapePowerShellString(name)} -Force`,
          reversible: false,
          selected: false,
        });
        break;
      }
      case "driver_protected": {
        actions.push(guidanceAction(id, finding.mechanism, `驱动级保护「${finding.subject}」：走官方卸载`, finding.detail, "检测到驱动级保护。不要手工停止或删除驱动，请使用官方卸载器（必要时进安全模式），否则可能蓝屏。", "high"));
        break;
      }
      case "missing_uninstaller": {
        actions.push(guidanceAction(id, finding.mechanism, "先找官方卸载器，再谈删文件", finding.detail, "未找到官方卸载器。请到软件设置或官网寻找专用卸载工具；确认无卸载器后，再逐项执行上面勾选的断源头操作。", "low"));
        break;
      }
    }
  });

  return actions;
}