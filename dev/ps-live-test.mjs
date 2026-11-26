import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  optimizeDeps: { noDiscovery: true },
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

const temp = mkdtempSync(join(tmpdir(), "dareclean-ps-live-"));
try {
  const { buildReadOnlyDiagnosticScript } = await server.ssrLoadModule("/src/diagnose/ps-readonly.ts");
  const script = buildReadOnlyDiagnosticScript([root]);
  const scriptPath = join(temp, "dareclean-diagnose.ps1");
  const outputPath = join(temp, "dareclean-diagnosis.json");
  writeFileSync(scriptPath, script, "utf8");

  // 只执行只读诊断；绝不执行写操作脚本或任何清理命令。
  execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", scriptPath, "-OutFile", outputPath,
  ], { encoding: "utf8", timeout: 120_000 });
  check("Windows PowerShell 5.1 actually runs the read-only diagnostic", existsSync(outputPath), outputPath);

  const bytes = readFileSync(outputPath);
  check("live diagnosis file is UTF-8, not UTF-16", !(bytes[0] === 0xff && bytes[1] === 0xfe)
    && !(bytes[0] === 0xfe && bytes[1] === 0xff) && bytes[0] === 0x7b, [...bytes.slice(0, 4)]);

  const report = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  check("live diagnosis JSON is readable by the browser's UTF-8 decoder", report.schema === "dareclean-diagnosis-v1");
  const status = report.collectionStatus ?? {};
  const names = ["services", "tasks", "runKeys", "startupFolders", "shellNamespaces", "uninstallers", "targetStatus", "processes"];
  check("live diagnosis reports all 8 collectors independently", names.every((name) =>
    typeof status[name]?.ok === "boolean" && typeof status[name]?.count === "number"), status);
  const expectedRoot = root.replace(/\//g, "\\").replace(/\\+$/, "");
  check("live target status proves a real filesystem read", Array.isArray(report.targetStatus)
    && report.targetStatus.length === 1 && report.targetStatus[0].path === expectedRoot
    && report.targetStatus[0].exists === true, report.targetStatus);
  const failedCollectors = names.filter((name) => status[name]?.ok === false);
  console.log(`INFO  collectors ok=${names.length - failedCollectors.length}, failed=${failedCollectors.length}${failedCollectors.length ? ` (${failedCollectors.join(",")})` : ""}`);
} finally {
  await server.close();
  rmSync(temp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
