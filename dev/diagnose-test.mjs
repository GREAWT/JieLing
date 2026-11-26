import { createServer } from "vite";
import { fileURLToPath } from "node:url";

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

try {
  const { parseDiagnosisReport, planCleanupActions, mergeAiDiagnosis, withLocalDiagnosisNotice } =
    await server.ssrLoadModule("/src/diagnose/report.ts");
  const { buildCloudDiagnosisPayload } = await server.ssrLoadModule("/src/diagnose/redact.ts");
  const { resolveUninstallGuidance } = await server.ssrLoadModule("/src/diagnose/uninstall.ts");
  const { buildCleanupScript } = await server.ssrLoadModule("/src/diagnose/ps-clean.ts");

  const clsid = "{12345678-1234-1234-1234-123456789abc}";
  const sample = {
    schema: "dareclean-diagnosis-v1",
    generatedAt: 123,
    targets: ["C:\\Users\\alice\\AppData\\Local\\TestApp"],
    services: [{
      name: "TestAppService", displayName: "TestApp Service", state: "Running", startMode: "Auto",
      pathName: "\"C:\\Users\\alice\\AppData\\Local\\TestApp\\svc.exe\"", isDriver: false,
    }],
    tasks: [{
      taskPath: "\\TestApp\\", taskName: "Reviver", state: "Ready",
      actions: "\"C:\\Users\\alice\\AppData\\Local\\TestApp\\revive.exe\"",
    }],
    runKeys: [{
      key: "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", name: "TestApp",
      command: "\"C:\\Users\\alice\\AppData\\Local\\TestApp\\run.exe\"", matchesTarget: true,
    }],
    startupFolders: [{
      folder: "C:\\Users\\alice\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup",
      name: "TestApp.lnk", matchesTarget: true,
      fullName: "C:\\Users\\alice\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\TestApp.lnk",
    }],
    shellNamespaces: [{
      root: "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Desktop\\NameSpace",
      clsid, displayName: "TestApp", dll: "C:\\Users\\alice\\AppData\\Local\\TestApp\\shell.dll", matchesTarget: true,
    }],
    uninstallers: [{
      displayName: "TestApp", publisher: "Test", uninstallString: "\"C:\\Users\\alice\\AppData\\Local\\TestApp\\uninstall.exe\"",
      quietUninstallString: "", installLocation: "C:\\Users\\alice\\AppData\\Local\\TestApp", registryPath: "TestApp",
    }],
    targetStatus: [{
      path: "C:\\Users\\alice\\AppData\\Local\\TestApp", exists: true, isDirectory: true, childCount: 2, lockSuspected: false,
    }],
    processes: [{ name: "TestApp", id: 123, path: "C:\\Users\\alice\\AppData\\Local\\TestApp\\app.exe" }],
    collectionStatus: {
      services: { ok: false, count: 0, error: "Access denied while reading services" },
      tasks: { ok: true, count: 1 },
      targetStatus: { ok: true, count: 1 },
    },
  };
  const raw = JSON.stringify(sample);
  const local = parseDiagnosisReport(raw, { collectionId: "testcollection" });
  const ids = new Set(local.evidence.map((entry) => entry.id));

  check("local evidence ids are stable and unique", ids.size === local.evidence.length
    && local.evidence.every((entry) => /^ev_testcollection_[a-z_]+_\d{3}$/.test(entry.id)), local.evidence.map((entry) => entry.id));
  check("local findings bind to real evidence", local.findings.length > 0
    && local.findings.every((finding) => finding.source === "local"
      && finding.evidenceIds?.length === 1 && ids.has(finding.evidenceIds[0])), local.findings);
  check("local report keeps raw evidence private", local.raw.includes("alice")
    && local.evidence.some((entry) => entry.path?.includes("alice")), local.evidence);
  check("failed collectors stay visible and are not treated as empty", local.collectionStatus?.services?.ok === false
    && local.collectionStatus.services.error?.includes("Access denied")
    && local.collectionStatus.tasks?.ok === true, local.collectionStatus);

  const actions = planCleanupActions(local);
  check("every action is bound to local evidence", actions.length > 0
    && actions.every((action) => action.source === "local_evidence" && ids.has(action.evidenceId)), actions);
  check("service action uses collected service name", actions.some((action) =>
    action.mechanism === "autostart_service" && action.command.includes("TestAppService")), actions);
  check("high risk actions default unselected", actions.filter((action) => action.danger === "high")
    .every((action) => action.selected === false), actions);

  const serviceId = local.evidence.find((entry) => entry.kind === "service").id;
  const uninstallerId = local.evidence.find((entry) => entry.kind === "uninstaller").id;
  const aiOnly = {
    findings: [{
      mechanism: "autostart_service", subject: "Ghost", detail: "AI 独有推断", evidenceIds: [],
      serviceName: "GhostService", confidence: 0.99, source: "ai",
    }],
    evidence: [], collectionId: "", officialUninstaller: null, generatedAt: 1, raw: "",
  };
  const aiOnlyActions = planCleanupActions(aiOnly);
  check("AI-only service cannot generate an action", aiOnlyActions.length === 0
    && !JSON.stringify(aiOnlyActions).includes("GhostService"), aiOnlyActions);

  const merged = mergeAiDiagnosis(local, {
    findings: [{
      mechanism: "autostart_service", subject: "TestApp", detail: "AI 解释", evidenceIds: [serviceId],
      serviceName: "OtherService", registryPath: "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", confidence: 0.9,
    }],
    officialUninstallerEvidenceId: uninstallerId,
    advice: "先走本地卸载入口",
    generatedAt: 2,
  });
  const mergedActions = planCleanupActions(merged);
  check("AI target fields cannot override local evidence", mergedActions.some((action) =>
    action.mechanism === "autostart_service" && action.command.includes("TestAppService")
    && !action.command.includes("OtherService")), mergedActions);
  check("AI inference is displayable but not scriptable", merged.findings.some((finding) => finding.source === "ai")
    && mergedActions.length === actions.length && !JSON.stringify(mergedActions).includes("OtherService"), mergedActions);

  let forgedRejected = false;
  try {
    mergeAiDiagnosis(local, {
      findings: [{ mechanism: "autostart_service", subject: "Ghost", detail: "x", evidenceIds: ["ev_testcollection_service_999"], confidence: 1 }],
      officialUninstallerEvidenceId: null, advice: "", generatedAt: 3,
    });
  } catch {
    forgedRejected = true;
  }
  check("forged evidence id fails closed", forgedRejected);

  let wrongUninstallerRejected = false;
  try {
    mergeAiDiagnosis(local, {
      findings: [], officialUninstallerEvidenceId: serviceId, advice: "", generatedAt: 4,
    });
  } catch {
    wrongUninstallerRejected = true;
  }
  check("non-uninstaller evidence cannot be used as uninstaller", wrongUninstallerRejected);

  const fallback = withLocalDiagnosisNotice(local, "timeout", "云端辅助分析不可用，以下为本地证据解析结果");
  check("cloud failure preserves local report", fallback.evidence.length === local.evidence.length
    && fallback.findings.length === local.findings.length
    && planCleanupActions(fallback).length === actions.length
    && fallback.aiNotice.includes("本地证据解析结果"), fallback);

  const payload = buildCloudDiagnosisPayload({
    subject: "TestApp alice@example.com",
    symptoms: "C:\\Users\\alice\\AppData\\Local\\TestApp；api_key=supersecret；AA:BB:CC:DD:EE:FF；ABCDE-ABCDE-ABCDE-ABCDE-ABCDE",
    evidence: local.evidence,
  });
  const sent = JSON.stringify(payload);
  check("cloud payload is minimal", Object.keys(payload).sort().join(",") === "evidence,subject,symptoms"
    && payload.evidence.every((entry) => Object.keys(entry).sort().join(",") === "id,kind,subject"), payload);
  check("cloud payload redacts sensitive data", !sent.includes("alice") && !sent.includes("alice@example.com")
    && !sent.includes("supersecret") && !sent.includes("AA:BB:CC") && !sent.includes("ABCDE-ABCDE")
    && !sent.includes("C:\\Users"), payload);
  check("redaction does not mutate local execution evidence", local.raw.includes("alice")
    && local.evidence.find((entry) => entry.kind === "service").serviceName === "TestAppService"
    && actions.some((action) => action.command.includes("TestAppService")), { raw: local.raw, actions });

  const guidance = resolveUninstallGuidance(local);
  check("official uninstaller must match local evidence", guidance.hasOfficialUninstaller
    && guidance.uninstallString?.includes("uninstall.exe"), guidance);
  const forgedUninstaller = resolveUninstallGuidance({ ...local, evidence: [] });
  check("unbound uninstaller is not executable", !forgedUninstaller.hasOfficialUninstaller
    && forgedUninstaller.uninstallString === null, forgedUninstaller);

  const script = buildCleanupScript(actions.map((action) => ({ ...action, selected: true })));
  check("dry-run remains default", script.includes("param([switch]$Execute)") && script.includes("if (-not $Execute)"), script.slice(0, 200));
  check("high risk confirmation remains", script.includes("输入 YES 确认执行"), script.match(/输入 YES[^\n]*/)?.[0]);
  check("command whitelist remains", script.includes("Stop-Service -Name 'TestAppService'")
    && script.includes("Remove-ItemProperty -LiteralPath 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'"), script);
  let badCommandRejected = false;
  try {
    buildCleanupScript([{ ...actions[0], command: "Remove-Item C:\\ -Recurse -Force" }]);
  } catch {
    badCommandRejected = true;
  }
  check("non-whitelisted command rejected", badCommandRejected);
} finally {
  await server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
