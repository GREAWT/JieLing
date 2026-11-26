import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { "@": root } },
  appType: "custom",
  cacheDir: fileURLToPath(new URL("../.vite-fs", import.meta.url)),
  server: { middlewareMode: true },
});

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${detail === undefined ? "" : ` :: ${JSON.stringify(detail)}`}`);
  }
}

function parsePowerShell(path) {
  const escaped = path.replace(/'/g, "''");
  const command = [
    "$tokens = $null; $errors = $null;",
    `[System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$tokens, [ref]$errors) | Out-Null;`,
    "if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Host $_.Message }; exit 1 }",
    "Write-Host 'PARSE_OK'",
  ].join(" ");
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    timeout: 30_000,
  }).trim();
}

const temp = mkdtempSync(join(tmpdir(), "dareclean-ps-"));
try {
  const { buildReadOnlyDiagnosticScript } = await server.ssrLoadModule("/src/diagnose/ps-readonly.ts");
  const { buildCleanupScript } = await server.ssrLoadModule("/src/diagnose/ps-clean.ts");

  const diagnostic = buildReadOnlyDiagnosticScript(["C:\\Users\\alice\\AppData\\Local\\TestApp"]);
  check("read-only script writes UTF-8 without BOM", diagnostic.includes("WriteAllText")
    && diagnostic.includes("UTF8Encoding($false)")
    && diagnostic.includes("dareclean-diagnosis.json"), diagnostic.slice(-700));
  check("read-only script has independent collector status", diagnostic.includes("collectionStatus")
    && diagnostic.includes("Set-CollectorStatus 'services'")
    && diagnostic.includes("Set-CollectorStatus 'targetStatus'")
    && diagnostic.includes("collectionStatus = $collectionStatus"));
  check("read-only script does not rely on PowerShell 5.1 > redirection", !diagnostic.includes("> diagnosis.json")
    && !diagnostic.includes(">diagnosis.json"));
  check("read-only script makes no automatic elevation promise", !diagnostic.includes("UAC")
    && diagnostic.includes("默认普通权限"));

  const diagPath = join(temp, "dareclean-diagnose.ps1");
  writeFileSync(diagPath, diagnostic, "utf8");
  check("read-only PowerShell 5.1 syntax parses", parsePowerShell(diagPath).includes("PARSE_OK"));

  const cleanup = buildCleanupScript([{
    id: "act-0-service",
    label: "停止并禁用服务「TestAppService」",
    description: "test",
    mechanism: "autostart_service",
    danger: "medium",
    command: "Stop-Service -Name 'TestAppService' -Force -ErrorAction SilentlyContinue; Set-Service -Name 'TestAppService' -StartupType Disabled",
    reversible: true,
    selected: true,
  }]);
  check("cleanup script keeps dry-run default", cleanup.includes("param([switch]$Execute)") && cleanup.includes("if (-not $Execute)"));
  check("cleanup script makes no automatic UAC promise", !cleanup.includes("UAC 提权即授权"));
  const cleanPath = join(temp, "dareclean-cleanup.ps1");
  writeFileSync(cleanPath, cleanup, "utf8");
  check("cleanup PowerShell 5.1 syntax parses", parsePowerShell(cleanPath).includes("PARSE_OK"));
} finally {
  await server.close();
  rmSync(temp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
