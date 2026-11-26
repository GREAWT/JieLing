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
# 本脚本只做枚举与读取：不删除、不修改、不注册任何内容；默认普通权限。
# 用法：powershell -ExecutionPolicy Bypass -File .\\dareclean-diagnose.ps1
# 结果写入当前目录 dareclean-diagnosis.json（UTF-8 无 BOM），再回到网页导入。
param([string]$OutFile = '')
$ErrorActionPreference = 'SilentlyContinue'
$targets = @(${targetLiteral})
$leafNames = @($targets | ForEach-Object { Split-Path $_ -Leaf } | Where-Object { $_.Length -ge 2 })
$collectionStatus = [ordered]@{}

function Set-CollectorStatus([string]$Name, [bool]$Ok, [int]$Count, [string]$ErrorText) {
  $entry = [ordered]@{ ok = $Ok; count = $Count }
  if (-not $Ok -and $ErrorText) { $entry.error = $ErrorText }
  $script:collectionStatus[$Name] = $entry
}

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

$services = @()
try {
  $services = @(Get-CimInstance -ClassName Win32_Service -ErrorAction Stop | ForEach-Object {
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
  Set-CollectorStatus 'services' $true $services.Count ''
} catch {
  Set-CollectorStatus 'services' $false 0 ([string]$_)
}

$tasks = @()
try {
  $tasks = @(Get-ScheduledTask -ErrorAction Stop | ForEach-Object {
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
  Set-CollectorStatus 'tasks' $true $tasks.Count ''
} catch {
  Set-CollectorStatus 'tasks' $false 0 ([string]$_)
}

$runKeyPaths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce'
)
$runKeys = @()
$runKeyErrors = @()
foreach ($k in $runKeyPaths) {
  if (-not (Test-Path -LiteralPath $k)) { continue }
  try {
    $props = Get-ItemProperty -LiteralPath $k -ErrorAction Stop
    if ($null -ne $props) {
      foreach ($p in $props.PSObject.Properties) {
        if (@('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider') -contains $p.Name) { continue }
        $v = [string]$p.Value
        $runKeys += [ordered]@{ key = $k; name = $p.Name; command = $v; matchesTarget = (Test-TargetRef $v) }
      }
    }
  } catch {
    $runKeyErrors += [string]$_
  }
}
Set-CollectorStatus 'runKeys' ($runKeyErrors.Count -eq 0) $runKeys.Count ($runKeyErrors -join '；')

$startupFolders = @()
$startupErrors = @()
foreach ($f in @([Environment]::GetFolderPath('Startup'), [Environment]::GetFolderPath('CommonStartup'))) {
  if (-not $f -or -not (Test-Path -LiteralPath $f)) { continue }
  try {
    $items = @(Get-ChildItem -LiteralPath $f -Force -ErrorAction Stop)
    foreach ($item in $items) {
      $startupFolders += [ordered]@{ folder = $f; name = [string]$item.Name; fullName = [string]$item.FullName; matchesTarget = (Test-LeafRef ([string]$item.Name)) }
    }
  } catch {
    $startupErrors += [string]$_
  }
}
Set-CollectorStatus 'startupFolders' ($startupErrors.Count -eq 0) $startupFolders.Count ($startupErrors -join '；')

$nsRoots = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\NameSpace',
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace',
  'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\NameSpace',
  'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\MyComputer\\NameSpace',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace'
)
$shellNamespaces = @()
$shellErrors = @()
foreach ($root in $nsRoots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  try {
    $children = @(Get-ChildItem -LiteralPath $root -ErrorAction Stop)
    foreach ($child in $children) {
      $clsid = [string]$child.PSChildName
      $displayName = [string](Get-ItemProperty -LiteralPath $child.PSPath -ErrorAction SilentlyContinue).'(default)'
      $dll = ''
      foreach ($hive in @('HKLM:\\SOFTWARE\\Classes\\CLSID', 'HKCU:\\SOFTWARE\\Classes\\CLSID')) {
        $clsidKey = Join-Path $hive $clsid
        if (-not $displayName) {
          $displayName = [string](Get-ItemProperty -LiteralPath $clsidKey -ErrorAction SilentlyContinue).'(default)'
        }
        $ip = Join-Path $clsidKey 'InprocServer32'
        if (-not $dll -and (Test-Path -LiteralPath $ip)) {
          $dll = [string](Get-ItemProperty -LiteralPath $ip -ErrorAction SilentlyContinue).'(default)'
        }
      }
      $shellNamespaces += [ordered]@{
        root = $root
        clsid = $clsid
        displayName = $displayName
        dll = $dll
        matchesTarget = ((Test-TargetRef $dll) -or (Test-LeafRef $displayName))
      }
    }
  } catch {
    $shellErrors += [string]$_
  }
}
Set-CollectorStatus 'shellNamespaces' ($shellErrors.Count -eq 0) $shellNamespaces.Count ($shellErrors -join '；')

$uninstallRoots = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
)
$uninstallers = @()
$uninstallerErrors = @()
foreach ($root in $uninstallRoots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  try {
    $children = @(Get-ChildItem -LiteralPath $root -ErrorAction Stop)
    foreach ($child in $children) {
      $p = Get-ItemProperty -LiteralPath $child.PSPath -ErrorAction SilentlyContinue
      $dn = [string]$p.DisplayName
      $us = [string]$p.UninstallString
      $il = [string]$p.InstallLocation
      if ((Test-TargetRef $il) -or (Test-TargetRef $us) -or (Test-LeafRef $dn)) {
        $uninstallers += [ordered]@{
          displayName = $dn
          publisher = [string]$p.Publisher
          uninstallString = $us
          quietUninstallString = [string]$p.QuietUninstallString
          installLocation = $il
          registryPath = [string]$child.Name
        }
      }
    }
  } catch {
    $uninstallerErrors += [string]$_
  }
}
Set-CollectorStatus 'uninstallers' ($uninstallerErrors.Count -eq 0) $uninstallers.Count ($uninstallerErrors -join '；')

$targetStatus = @()
$targetErrors = @()
foreach ($t in $targets) {
  try {
    $exists = Test-Path -LiteralPath $t -ErrorAction Stop
    $isDir = $false
    $childCount = 0
    $lockSuspected = $false
    if ($exists) {
      $item = Get-Item -LiteralPath $t -Force -ErrorAction Stop
      $isDir = [bool]$item.PSIsContainer
      if ($isDir) {
        $childCount = @(Get-ChildItem -LiteralPath $t -Force -ErrorAction Stop).Count
      } else {
        try {
          $fs = [System.IO.File]::Open($t, 'Open', 'Read', 'None')
          $fs.Close()
        } catch {
          $lockSuspected = $true
        }
      }
    }
    $targetStatus += [ordered]@{ path = $t; exists = $exists; isDirectory = $isDir; childCount = $childCount; lockSuspected = $lockSuspected }
  } catch {
    $targetErrors += [string]$_
  }
}
Set-CollectorStatus 'targetStatus' ($targetErrors.Count -eq 0) $targetStatus.Count ($targetErrors -join '；')

$processes = @()
try {
  $processes = @(Get-Process -ErrorAction Stop | ForEach-Object {
    $pp = ''
    try { $pp = [string]$_.Path } catch {}
    if (Test-TargetRef $pp) {
      [ordered]@{ name = [string]$_.ProcessName; id = [int]$_.Id; path = $pp }
    }
  })
  Set-CollectorStatus 'processes' $true $processes.Count ''
} catch {
  Set-CollectorStatus 'processes' $false 0 ([string]$_)
}

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
  collectionStatus = $collectionStatus
}
$json = $report | ConvertTo-Json -Depth 8
$outputPath = if ($OutFile) { [System.IO.Path]::GetFullPath($OutFile) } else { Join-Path (Get-Location).Path 'dareclean-diagnosis.json' }
try {
  # Windows PowerShell 5.1 的 > 重定向默认写 UTF-16LE；这里显式写 UTF-8 无 BOM。
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($outputPath, $json, $utf8NoBom)
  Write-Host ('诊断结果已写入（UTF-8）：' + $outputPath)
} catch {
  Write-Host ('写入诊断结果失败：' + [string]$_)
  exit 1
}
`;
}