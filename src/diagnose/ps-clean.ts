import { escapePowerShellString, isPowerShellSafeIdentifier } from "../safety/guard";
import type { CleanupAction } from "../core/types";

const MAX_ACTIONS = 64;
const ACTION_ID_RE = /^act-\d+-[a-z_]+$/;
const RUN_KEY_RE = /^(HKLM|HKCU):\\SOFTWARE\\(Wow6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Run(Once)?$/;
const NS_KEY_RE = /^(HKLM|HKCU):\\SOFTWARE\\(Wow6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Explorer\\(MyComputer|Desktop)\\NameSpace\\\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}$/;

const SERVICE_CMD_RE = /^Stop-Service -Name '([^']*)' -Force -ErrorAction SilentlyContinue; Set-Service -Name '([^']*)' -StartupType Disabled$/;
const TASK_CMD_RE = /^Disable-ScheduledTask -TaskPath '([^']*)' -TaskName '([^']*)'$/;
const RUN_VALUE_CMD_RE = /^Remove-ItemProperty -LiteralPath '([^']*)' -Name '([^']*)'$/;
const NS_KEY_CMD_RE = /^Remove-Item -LiteralPath '([^']*)'$/;
const PROCESS_CMD_RE = /^Stop-Process -Name '([^']*)' -Force$/;
const GUIDANCE_CMD_RE = /^Write-Host '((?:[^']|'')*)'$/;

interface VerifiedStep {
  needsConfirm: boolean;
  backupLines: string[];
  commandLines: string[];
}

function isSafeTaskPath(path: string): boolean {
  if (!path.startsWith("\\") || !path.endsWith("\\")) return false;
  return path
    .slice(1, -1)
    .split("\\")
    .filter((s) => s.length > 0)
    .every(isPowerShellSafeIdentifier);
}

function backupLines(id: string, payload: string): string[] {
  const file = escapePowerShellString(`dareclean-backup-${id}.json`);
  return [
    `$backupFile = Join-Path $env:USERPROFILE ${file}`,
    `${payload} | ConvertTo-Json | Set-Content -LiteralPath $backupFile -Encoding UTF8`,
    `Write-Host ('  已备份到 ' + $backupFile)`,
  ];
}

// 不信任 action.command 原文：只接受白名单模板，提取参数重新校验后再重新生成命令
function verifyAction(action: CleanupAction): VerifiedStep {
  const command = action.command;

  const service = SERVICE_CMD_RE.exec(command);
  if (service) {
    const [, a, b] = service;
    if (a !== b || !isPowerShellSafeIdentifier(a)) return reject(action);
    const q = escapePowerShellString(a);
    return {
      needsConfirm: false,
      backupLines: [],
      commandLines: [
        `Stop-Service -Name ${q} -Force -ErrorAction SilentlyContinue`,
        `Set-Service -Name ${q} -StartupType Disabled`,
      ],
    };
  }

  const task = TASK_CMD_RE.exec(command);
  if (task) {
    const [, path, name] = task;
    if (!isSafeTaskPath(path) || !isPowerShellSafeIdentifier(name)) return reject(action);
    return {
      needsConfirm: false,
      backupLines: [],
      commandLines: [
        `Disable-ScheduledTask -TaskPath ${escapePowerShellString(path)} -TaskName ${escapePowerShellString(name)}`,
      ],
    };
  }

  const runValue = RUN_VALUE_CMD_RE.exec(command);
  if (runValue) {
    const [, key, name] = runValue;
    if (!RUN_KEY_RE.test(key) || !isPowerShellSafeIdentifier(name)) return reject(action);
    const k = escapePowerShellString(key);
    const n = escapePowerShellString(name);
    return {
      needsConfirm: true,
      backupLines: [
        `$prev = Get-ItemProperty -LiteralPath ${k} -Name ${n} -ErrorAction SilentlyContinue`,
        `$prevValue = $null`,
        `if ($null -ne $prev) { $prevValue = [string]$prev.PSObject.Properties[${n}].Value }`,
        ...backupLines(
          action.id,
          `@{ kind='registry-value'; key=${k}; name=${n}; previousValue=$prevValue }`,
        ),
      ],
      commandLines: [`Remove-ItemProperty -LiteralPath ${k} -Name ${n}`],
    };
  }

  const nsKey = NS_KEY_CMD_RE.exec(command);
  if (nsKey) {
    const [, key] = nsKey;
    if (!NS_KEY_RE.test(key)) return reject(action);
    const k = escapePowerShellString(key);
    return {
      needsConfirm: true,
      backupLines: [
        `$prevDefault = [string](Get-ItemProperty -LiteralPath ${k} -ErrorAction SilentlyContinue).'(default)'`,
        ...backupLines(action.id, `@{ kind='registry-key'; key=${k}; defaultValue=$prevDefault }`),
      ],
      commandLines: [`Remove-Item -LiteralPath ${k}`],
    };
  }

  const process = PROCESS_CMD_RE.exec(command);
  if (process) {
    const [, name] = process;
    if (!isPowerShellSafeIdentifier(name)) return reject(action);
    return {
      needsConfirm: true,
      backupLines: [],
      commandLines: [`Stop-Process -Name ${escapePowerShellString(name)} -Force`],
    };
  }

  const guidance = GUIDANCE_CMD_RE.exec(command);
  if (guidance) {
    const text = guidance[1].replace(/''/g, "'");
    if (text.length > 2000) return reject(action);
    return {
      needsConfirm: false,
      backupLines: [],
      commandLines: [`Write-Host ${escapePowerShellString(text)}`],
    };
  }

  return reject(action);
}

function reject(action: CleanupAction): never {
  throw new Error(`清理项「${action.label}」的命令未通过安全白名单校验，拒绝生成脚本。`);
}

export function buildCleanupScript(actions: CleanupAction[]): string {
  const selected = actions.filter((a) => a.selected);
  if (selected.length === 0) {
    throw new Error("没有勾选任何清理项，无需生成脚本。");
  }
  if (selected.length > MAX_ACTIONS) {
    throw new Error(`一次最多执行 ${MAX_ACTIONS} 个清理项，请分批操作。`);
  }

  const steps = selected.map((action) => {
    if (!ACTION_ID_RE.test(action.id)) {
      throw new Error(`清理项 id「${action.id}」格式非法，拒绝生成脚本。`);
    }
    return { action, verified: verifyAction(action) };
  });

  const total = steps.length;
  const blocks = steps.map(({ action, verified }, index) => {
    const id = escapePowerShellString(action.id);
    const label = escapePowerShellString(`[${index + 1}/${total}] ${action.label}`);
    const shownCommand = escapePowerShellString(verified.commandLines.join("; "));
    const lines: string[] = [
      `Write-Host ''`,
      `Write-Host ${label}`,
      `Write-Host ('  将执行: ' + ${shownCommand})`,
      `if (-not $Execute) {`,
      `  Write-Host '  [dry-run] 未执行。确认无误后加 -Execute 参数重新运行。'`,
      `  $results += [ordered]@{ id=${id}; status='dry-run' }`,
      `} else {`,
      `  $proceed = $true`,
    ];
    if (verified.needsConfirm) {
      lines.push(
        `  $answer = Read-Host '  高危操作：输入 YES 确认执行，其他输入跳过'`,
        `  if ($answer -cne 'YES') { $proceed = $false }`,
      );
    }
    lines.push(
      `  if (-not $proceed) {`,
      `    Write-Host '  已跳过（未确认）'`,
      `    $results += [ordered]@{ id=${id}; status='declined' }`,
      `  } else {`,
      `    try {`,
      ...verified.backupLines.map((l) => `      ${l}`),
      ...verified.commandLines.map((l) => `      ${l}`),
      `      Write-Host '  完成'`,
      `      $results += [ordered]@{ id=${id}; status='ok' }`,
      `    } catch {`,
      `      Write-Host ('  失败: ' + [string]$_)`,
      `      $results += [ordered]@{ id=${id}; status='error'; message=[string]$_ }`,
      `    }`,
      `  }`,
      `}`,
    );
    return lines.join("\n");
  });

  // UTF-8 BOM：Windows PowerShell 5.1 会把无 BOM 文件按 ANSI 解码，中文注释可能吞掉引号
  return `\uFEFF# 洁灵 · 逐项清理脚本（dareclean-cleanup-v1）
# 默认 dry-run：只打印将要执行的操作，不做任何修改，无需管理员。
# 确认输出无误后，以管理员身份运行并加 -Execute 参数才会真正执行（UAC 提权即授权）；
# 注册表/进程类高危操作在执行前还会要求逐项输入 YES 二次确认。
# 注册表操作只处理下面列出的单个值/单个键，执行前自动备份到用户目录。
param([switch]$Execute)
$ErrorActionPreference = 'Stop'
if ($Execute) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $isAdmin = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) { throw '真实执行需要管理员权限：请右键 PowerShell「以管理员身份运行」后重试。' }
}
$results = @()
if (-not $Execute) { Write-Host '=== DRY-RUN 模式：以下操作全部不会执行 ===' }

${blocks.join("\n\n")}

Write-Host ''
@{
  schema = 'dareclean-cleanup-result-v1'
  dryRun = (-not $Execute)
  executedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  results = $results
} | ConvertTo-Json -Depth 5
`;
}