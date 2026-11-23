import { escapePowerShellString } from "../safety/guard";

const MAX_TARGETS = 32;
const MAX_PATH_LENGTH = 1024;
// Windows 文件名非法字符 + 通配符；引号/美元符等合法字符靠单引号转义与 -LiteralPath 兜住
const ILLEGAL_PATH_CHARS = /[\u0000-\u001f\u007f"*?<>|]/;

function validateTarget(target: string): string {
  if (typeof target !== "string" || target.length === 0 || target.length > MAX_PATH_LENGTH) {
    throw new Error("诊断目标路径为空或超长，拒绝生成脚本。");
  }
  if (!/^[A-Za-z]:[\\/]/.test(target)) {
    throw new Error(`诊断目标「${target}」不是本地磁盘绝对路径，拒绝生成脚本。`);
  }
  if (ILLEGAL_PATH_CHARS.test(target)) {
    throw new Error(`诊断目标「${target}」含非法字符，拒绝生成脚本。`);
  }
  const normalized = target.replace(/\//g, "\\").replace(/\\{2,}/g, "\\");
  if (normalized.split("\\").includes("..")) {
    throw new Error(`诊断目标「${target}」含 .. 回溯段，拒绝生成脚本。`);
  }
  const trimmed = normalized.replace(/\\+$/, "");
  // 盘符根目录必须保留反斜杠，否则 C: 会变成「当前目录」语义
  return /^[A-Za-z]:$/.test(trimmed) ? normalized : trimmed;
}

export function buildReadOnlyDiagnosticScript(targets: string[]): string {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("至少需要一个诊断目标目录。");
  }
  if (targets.length > MAX_TARGETS) {
    throw new Error(`诊断目标最多 ${MAX_TARGETS} 个。`);
  }
  const validated = [...new Set(targets.map(validateTarget))];
  const targetLiteral = validated.map(escapePowerShellString).join(", ");

  // UTF-8 BOM：Windows PowerShell 5.1 会把无 BOM 文件按 ANSI 解码，中文注释可能吞掉引号
  return `\uFEFF# 洁灵 · 只读诊断脚本（dareclean-diagnosis-v1）
# 本脚本只做枚举与读取：不删除、不修改、不注册任何内容。
# 用法：powershell -ExecutionPolicy Bypass -File .\\dareclean-diagnose.ps1 > diagnosis.json
$ErrorActionPreference = 'SilentlyContinue'
$targets = @(${targetLiteral})
$leafNames = @($targets | ForEach-Object { Split-Path $_ -Leaf } | Where-Object { $_.Length -ge 2 })

function Test-TargetRef([string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return $false }
  foreach ($t in $targets) {
    if ($Text.IndexOf($t, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
  }
  return $false
}
function Test-LeafRef([string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return $false }
  foreach ($n in $leafNames) {
    if ($Text.IndexOf($n, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
  }
  return $false
}

$services = @(Get-CimInstance -ClassName Win32_Service | ForEach-Object {
  $p = [string]$_.PathName
  if (Test-TargetRef $p) {
    [ordered]@{
      name = [string]$_.Name
      displayName = [string]$_.DisplayName
      state = [string]$_.State
      startMode = [string]$_.StartMode
      pathName = $p
      isDriver = ($p -match '\\.sys(["\\s]|$)')
    }
  }
})

$tasks = @(Get-ScheduledTask | ForEach-Object {
  $exec = @($_.Actions | ForEach-Object { ([string]$_.Execute + ' ' + [string]$_.Arguments).Trim() }) -join ' | '
  if (Test-TargetRef $exec) {
    [ordered]@{
      taskPath = [string]$_.TaskPath
      taskName = [string]$_.TaskName
      state = [string]$_.State
      actions = $exec
    }
  }
})

$runKeyPaths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce'
)
$runKeys = @(foreach ($k in $runKeyPaths) {
  $props = Get-ItemProperty -LiteralPath $k
  if ($null -ne $props) {
    foreach ($p in $props.PSObject.Properties) {
      if (@('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider') -contains $p.Name) { continue }
      $v = [string]$p.Value
      [ordered]@{ key = $k; name = $p.Name; command = $v; matchesTarget = (Test-TargetRef $v) }
    }
  }
})

$startupFolders = @(foreach ($f in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
  if ($f -and (Test-Path -LiteralPath $f)) {
    Get-ChildItem -LiteralPath $f -Force | ForEach-Object {
      [ordered]@{ folder = $f; name = [string]$_.Name; fullName = [string]$_.FullName }
    }
  }
})

$nsRoots = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\NameSpace',
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace',
  'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\NameSpace',
  'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\NameSpace',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace'
)
$shellNamespaces = @(foreach ($root in $nsRoots) {
  Get-ChildItem -LiteralPath $root | ForEach-Object {
    $clsid = [string]$_.PSChildName
    $displayName = [string](Get-ItemProperty -LiteralPath $_.PSPath).'(default)'
    $dll = ''
    foreach ($hive in @('HKLM:\\SOFTWARE\\Classes\\CLSID', 'HKCU:\\SOFTWARE\\Classes\\CLSID')) {
      $clsidKey = Join-Path $hive $clsid
      if (-not $displayName) {
        $displayName = [string](Get-ItemProperty -LiteralPath $clsidKey).'(default)'
      }
      $ip = Join-Path $clsidKey 'InprocServer32'
      if (-not $dll -and (Test-Path -LiteralPath $ip)) {
        $dll = [string](Get-ItemProperty -LiteralPath $ip).'(default)'
      }
    }
    [ordered]@{
      root = $root
      clsid = $clsid
      displayName = $displayName
      dll = $dll
      matchesTarget = ((Test-TargetRef $dll) -or (Test-LeafRef $displayName))
    }
  }
})

$uninstallRoots = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
)
$uninstallers = @(foreach ($root in $uninstallRoots) {
  Get-ChildItem -LiteralPath $root | ForEach-Object {
    $p = Get-ItemProperty -LiteralPath $_.PSPath
    $dn = [string]$p.DisplayName
    $us = [string]$p.UninstallString
    $il = [string]$p.InstallLocation
    if ((Test-TargetRef $il) -or (Test-TargetRef $us) -or (Test-LeafRef $dn)) {
      [ordered]@{
        displayName = $dn
        publisher = [string]$p.Publisher
        uninstallString = $us
        quietUninstallString = [string]$p.QuietUninstallString
        installLocation = $il
        registryPath = [string]$_.Name
      }
    }
  }
})

$targetStatus = @(foreach ($t in $targets) {
  $exists = Test-Path -LiteralPath $t
  $isDir = $false
  $childCount = 0
  $lockSuspected = $false
  if ($exists) {
    $item = Get-Item -LiteralPath $t -Force
    $isDir = [bool]$item.PSIsContainer
    if ($isDir) {
      $childCount = @(Get-ChildItem -LiteralPath $t -Force).Count
    } else {
      try {
        $fs = [System.IO.File]::Open($t, 'Open', 'Read', 'None')
        $fs.Close()
      } catch {
        $lockSuspected = $true
      }
    }
  }
  [ordered]@{ path = $t; exists = $exists; isDirectory = $isDir; childCount = $childCount; lockSuspected = $lockSuspected }
})

$processes = @(Get-Process | ForEach-Object {
  $pp = ''
  try { $pp = [string]$_.Path } catch {}
  if (Test-TargetRef $pp) {
    [ordered]@{ name = [string]$_.ProcessName; id = [int]$_.Id; path = $pp }
  }
})

$report = [ordered]@{
  schema = 'dareclean-diagnosis-v1'
  generatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  targets = $targets
  services = $services
  tasks = $tasks
  runKeys = $runKeys
  startupFolders = $startupFolders
  shellNamespaces = $shellNamespaces
  uninstallers = $uninstallers
  targetStatus = $targetStatus
  processes = $processes
}
$report | ConvertTo-Json -Depth 6
`;
}