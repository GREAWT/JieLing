import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { "@": root } },
  appType: "custom",
  cacheDir: fileURLToPath(new URL("../.vite-rules", import.meta.url)),
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

function entry(path, options = {}) {
  const parts = path.split("/").filter(Boolean);
  return {
    id: path,
    path,
    name: parts.at(-1),
    kind: "directory",
    size: options.size ?? 1024,
    fileCount: options.fileCount ?? 1,
    lastModified: 1,
    depth: Math.max(0, parts.length - 1),
    isEmptyDir: false,
    parentId: parts.length > 1 ? parts.slice(0, -1).join("/") : null,
    childIds: [],
    coverage: ["complete"],
    ...options,
  };
}

function hitFor(entryValue, overrides = {}) {
  return {
    fingerprintId: "test-rule",
    owner: "TestApp",
    ownerKind: "app",
    purpose: "测试缓存",
    verdict: "needs_review",
    confidence: 0.8,
    rebuildable: true,
    reason: "测试理由，仅用于规则来源与冲突测试。",
    consequence: "测试后果，仅用于规则来源与冲突测试。",
    revival: [],
    evidence: ["测试证据"],
    source: "builtin",
    trustLevel: 1,
    ruleScope: "software_fingerprint",
    ruleVersion: "4",
    verifiedAt: "2026-11-26",
    enabled: true,
    originDescription: "测试内置规则",
    ...overrides,
  };
}

try {
  const { loadFingerprints, matchFingerprint, matchAll, compileLocalRules } =
    await server.ssrLoadModule("/src/knowledge/match.ts");
  const model = await server.ssrLoadModule("/src/knowledge/rule-model.ts");
  const store = await server.ssrLoadModule("/src/knowledge/local-store.ts");
  const { judgeAll } = await server.ssrLoadModule("/src/safety/risk.ts");

  const fingerprints = loadFingerprints();
  check("builtin bundle exceeds previous 100 rules", fingerprints.length >= 109, fingerprints.length);
  check("builtin hits carry trust metadata", fingerprints.every((rule) =>
    rule.source === "builtin" && rule.trustLevel === 1 && rule.ruleVersion
    && rule.verifiedAt && rule.originDescription && rule.enabled));

  const curated = fingerprints.filter((rule) => rule.samples);
  check("curated software rules carry four regression samples", curated.length >= 3
    && curated.every((rule) => rule.samples.cache && rule.samples.review && rule.samples.protect && rule.samples.negative),
  curated.map((rule) => [rule.id, rule.samples]));
  check("curated software rules describe software identity and role", curated.every((rule) =>
    rule.software && rule.vendor && rule.platforms.length > 0 && rule.role), curated);

  for (const rule of curated) {
    const evalPath = (path) => matchFingerprint(entry(path), [], [], [rule]);
    const cache = evalPath(rule.samples.cache);
    const negative = evalPath(rule.samples.negative);
    const allReview = matchFingerprint(entry(rule.samples.review), [], [], fingerprints);
    const allProtect = matchFingerprint(entry(rule.samples.protect), [], [], fingerprints);
    check(`${rule.software}: cache sample matches safe rule`, cache?.verdict === "safe_delete", cache);
    check(`${rule.software}: review sample resolves to needs_review or stronger`, allReview?.verdict === "needs_review" || allReview?.verdict === "keep_locked", allReview);
    check(`${rule.software}: protect sample resolves to keep_locked`, allProtect?.verdict === "keep_locked", allProtect);
    check(`${rule.software}: reverse sample does not match the cache rule`, negative === null, negative);
  }

  const key = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const repo = store.createMemoryRuleRepository(key);
  const rootHash = await store.hashRootLabel("D:\\TestRoot");
  const sourceEntry = entry("Unknown/VendorData/MyCacheLabel", { childIds: ["Unknown/VendorData/MyCacheLabel/marker.bin"] });
  const candidate = model.candidateFromAi({
    entry: sourceEntry,
    childNames: ["marker.bin", "index.dat"],
    siblingNames: ["settings.json"],
    rootHash,
    judgment: {
      owner: "UnknownApp",
      ownerKind: "app",
      purpose: "可重建缓存目录",
      verdict: "safe_delete",
      confidence: 0.91,
      rebuildable: true,
      reason: "目录结构符合可重建缓存特征，但仍需人工核对。",
      consequence: "重新启动应用后会重建。",
      revival: [],
      evidence: ["目录名与标志文件符合缓存结构"],
    },
    origin: "ai",
    model: null,
  });

  await repo.saveCandidates([candidate]);
  check("saving an AI candidate does not create a formal rule", (await repo.listCustom()).length === 0);
  const restarted = store.createMemoryRuleRepository(key);
  const pending = await restarted.listCandidates();
  check("AI candidates survive restart and remain pending review", pending.length === 1 && pending[0].status === "pending", pending);
  check("pending candidate is not compiled into matching rules", compileLocalRules(await restarted.listCustom(), rootHash).length === 0);
  await restarted.updateCandidate(candidate.id, "session_only");
  check("session-only decision persists without creating a rule", (await restarted.listCandidates())[0].status === "session_only"
    && (await restarted.listCustom()).length === 0);
  await restarted.updateCandidate(candidate.id, "pending");

  const exactRule = model.localRuleFromCandidate(candidate, "exact_path", "needs_review", rootHash);
  await restarted.addCustom(exactRule, "test exact rule");
  const currentRoot = store.createMemoryRuleRepository(key);
  const customRules = await currentRoot.listCustom();
  const compiled = compileLocalRules(customRules, rootHash);
  const exactHit = matchAll([{ ...sourceEntry, childIds: [] }], compiled).get(sourceEntry.id);
  check("exact custom rule is reused on the next scan", exactHit?.source === "custom" && exactHit.verdict === "needs_review", exactHit);
  const safeCustom = model.localRuleFromCandidate(candidate, "exact_path", "safe_delete", rootHash);
  check("explicit user-created exact cache rule may recommend isolation", safeCustom.verdict === "safe_delete" && safeCustom.source === "custom");
  const otherScan = matchAll([entry("Other/VendorData/MyCacheLabel")], compiled).get("Other/VendorData/MyCacheLabel");
  check("exact custom rule does not apply to a different path", otherScan === null, otherScan);

  const genericRule = model.localRuleFromCandidate(candidate, "software_fingerprint", "needs_review", rootHash);
  await currentRoot.addCustom(genericRule, "test generic rule");
  const customSnapshot = JSON.stringify(await currentRoot.listCustom());
  const builtinSnapshot = loadFingerprints();
  check("builtin recompilation is isolated from custom rules",
    JSON.stringify(await currentRoot.listCustom()) === customSnapshot
    && !builtinSnapshot.some((rule) => rule.id.startsWith("custom:")), builtinSnapshot.length);
  const genericCompiled = compileLocalRules(await currentRoot.listCustom(), rootHash);
  const positive = entry("Vendor/NewPlace/MyCacheLabel", { childIds: ["Vendor/NewPlace/MyCacheLabel/marker.bin"] });
  const markerChild = entry("Vendor/NewPlace/MyCacheLabel/marker.bin", { kind: "file", fileCount: 1 });
  const positiveHit = matchFingerprint(positive, [], [markerChild], genericCompiled);
  const wrongStructure = entry("Vendor/NewPlace/MyCacheLabel");
  const negativeHit = matchFingerprint(wrongStructure, [], [], genericCompiled);
  check("generic custom rule requires its structural marker", positiveHit?.source === "custom" && negativeHit === null, { positiveHit, negativeHit });

  let nameOnlyRejected = false;
  try {
    const bad = { ...genericRule, id: `custom_${Date.now().toString(36)}_badname`, match: { ...genericRule.match, markers: [], siblings: [] }, verdict: "safe_delete" };
    model.validateLocalRule(bad);
  } catch {
    nameOnlyRejected = true;
  }
  check("name-only generic safe_delete is rejected", nameOnlyRejected);

  let protectedRejected = false;
  try {
    model.validateLocalRule({
      ...exactRule,
      id: `custom_${Date.now().toString(36)}_protected`,
      matchPath: "Documents/毕业论文",
      match: { ...exactRule.match, name: "毕业论文" },
    });
  } catch {
    protectedRejected = true;
  }
  check("custom rule cannot override user-data protection", protectedRejected);

  const builtinKeep = hitFor(sourceEntry, { source: "builtin", trustLevel: 1, verdict: "keep_locked" });
  const customSafe = hitFor(sourceEntry, { source: "custom", trustLevel: 2, verdict: "safe_delete" });
  const conservative = model.mergeKnowledgeHits(builtinKeep, customSafe);
  check("rule conflicts choose the more conservative result", conservative?.verdict === "keep_locked" && conservative.source === "builtin", conservative);

  const aiSafeHit = hitFor(sourceEntry, { source: "ai_candidate", trustLevel: 3, verdict: "safe_delete" });
  const aiJudged = judgeAll([sourceEntry], new Map([[sourceEntry.id, aiSafeHit]]));
  check("AI candidate cannot produce safe_delete", aiJudged[0].verdict === "needs_review" && aiJudged[0].source === "ai_candidate", aiJudged[0]);

  const builtinMetadata = matchFingerprint(
    entry("AppData/Local/JetBrains/IntelliJIdea2025.2/caches"),
    [], [], fingerprints,
  );
  check("real match carries source and trust fields", builtinMetadata?.source === "builtin"
    && builtinMetadata.trustLevel === 1 && builtinMetadata.ruleScope === "software_fingerprint"
    && builtinMetadata.ruleVersion === "4" && builtinMetadata.verifiedAt === "2026-11-26"
    && builtinMetadata.enabled === true, builtinMetadata);

  const pack = await currentRoot.exportPack();
  check("rule pack has schema, version and checksum", pack.schemaVersion === 1
    && pack.rulesVersion > 0 && /^[a-f0-9]{64}$/.test(pack.checksum) && pack.rules.length >= 2, pack);
  check("rule pack contains no absolute path or username", !JSON.stringify(pack).includes("D:\\")
    && !JSON.stringify(pack).includes("Users/"), pack);

  const leakRepo = store.createMemoryRuleRepository(`${key}_leak`);
  const leakRule = model.localRuleFromCandidate(
    { ...candidate, scanPath: "Users/alice/AppData/Local/SecretCache", scanName: "SecretCache" },
    "exact_path",
    "needs_review",
    rootHash,
  );
  await leakRepo.addCustom(leakRule, "test export privacy");
  const leakPack = await leakRepo.exportPack();
  check("rule pack omits rules whose path contains a username", leakPack.rules.length === 0
    && !JSON.stringify(leakPack).includes("alice"), leakPack);

  const importKey = `${key}_import`;
  const importer = store.createMemoryRuleRepository(importKey);
  const imported = await importer.importPack(JSON.stringify(pack));
  check("valid rule pack imports atomically", imported.imported >= 2 && (await importer.listCustom()).length >= 2, imported);
  const beforeBadImport = (await importer.listCustom()).length;
  const tampered = { ...pack, checksum: "0".repeat(64) };
  let badImportRejected = false;
  try { await importer.importPack(JSON.stringify(tampered)); } catch { badImportRejected = true; }
  check("bad rule pack is rejected without changing existing rules", badImportRejected
    && (await importer.listCustom()).length === beforeBadImport);

  const disabled = await currentRoot.updateCustom(genericRule.id, { enabled: false }, "test disable");
  check("custom rule can be disabled", disabled.find((rule) => rule.id === genericRule.id)?.enabled === false);
  const enabledAgain = await currentRoot.updateCustom(genericRule.id, { enabled: true }, "test enable");
  check("custom rule can be re-enabled", enabledAgain.find((rule) => rule.id === genericRule.id)?.enabled === true);
  const afterDelete = await currentRoot.removeCustom(exactRule.id, "test delete");
  check("custom rule can be deleted", !afterDelete.some((rule) => rule.id === exactRule.id));
  const rolled = await currentRoot.rollback();
  check("custom rule set can roll back to previous version", rolled.some((rule) => rule.id === exactRule.id), rolled);
} finally {
  await server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
