// Local route validation without cloud credentials. Executes the REAL functions/routes.mjs
// against an in-memory adapter that mirrors the documented platform query surface
// (select/eq/order/limit/insert/insertIfAbsent/update). Run: node dev/function-test.mjs
import { application } from '../functions/routes.mjs';
import { createCoordinator } from '../functions/coordinator.mjs';
import { normalizeJudgment } from '../functions/ai.mjs';
import { buildDiagnosePrompt, redactAncestors, redactDiagnosisText } from '../functions/prompts.mjs';

class BackendError extends Error {
  constructor(code, status) { super(code); this.name = 'BackendError'; this.code = code; this.status = status; }
}

function createFakeDb() {
  const tables = new Map();
  const table = (name) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name); };
  function from(name) {
    const store = table(name);
    let columns = null; let filters = []; let ordering = []; let count = Infinity;
    let mode = 'select'; let values = null; let conflict = null;
    const matches = (row) => filters.every(([k, v]) => String(row[k]) === String(v));
    const project = (list) => {
      if (!columns || columns === '*') return list.map((r) => ({ ...r }));
      const keys = columns.split(',').map((s) => s.trim());
      return list.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));
    };
    async function run() {
      if (mode === 'insert') {
        const incoming = Array.isArray(values) ? values : [values];
        if (conflict && incoming.some((v) => store.some((r) => conflict.every((k) => String(r[k]) === String(v[k]))))) {
          return { data: [], error: null };
        }
        const added = incoming.map((v) => ({ ...v }));
        store.push(...added);
        return { data: project(added), error: null };
      }
      if (mode === 'update') {
        const hit = store.filter(matches);
        for (const row of hit) Object.assign(row, values);
        return { data: project(hit), error: null };
      }
      let hit = store.filter(matches);
      for (const [key, ascending] of [...ordering].reverse()) {
        hit = hit.slice().sort((a, b) => {
          const av = a[key]; const bv = b[key];
          const cmp = av === bv ? 0 : av > bv ? 1 : -1;
          return ascending ? cmp : -cmp;
        });
      }
      return { data: project(hit.slice(0, count)), error: null };
    }
    const query = {
      select(c) { columns = c; return query; },
      eq(k, v) { filters.push([k, v]); return query; },
      order(k, o = {}) { ordering.push([k, o.ascending !== false]); return query; },
      limit(n) { count = n; return query; },
      insert(v) { mode = 'insert'; values = v; return query; },
      insertIfAbsent(v, o) { mode = 'insert'; values = v; conflict = o.onConflict.split(','); return query; },
      update(v) { mode = 'update'; values = v; return query; },
      then(resolve, reject) { return run().then(resolve, reject); },
    };
    return query;
  }
  return { from, tables, ensure: table };
}

const errorResponse = (error, requestId) => Response.json(
  { error: { code: error?.code ?? 'internal_error' }, requestId },
  { status: Number.isInteger(error?.status) ? error.status : 500 },
);
const createSiteContext = (request) => ({ request, requestId: crypto.randomUUID() });

let aiCalls = 0;
let lastDiagnoseInput = null;
let diagnoseAnswer = {
  findings: [{ mechanism: 'shell_namespace', subject: 'TestApp', detail: '注册表虚拟文件夹', evidenceIds: [], confidence: 0.7 }],
  officialUninstallerEvidenceId: null,
  advice: '先卸载再清理残留',
};
const fakeAi = {
  async classify(items) {
    aiCalls += 1;
    return items.map((item) => ({
      key: item.key, owner: 'TestApp', ownerKind: 'app', purpose: '测试缓存目录',
      verdict: 'safe_delete', confidence: 0.92, rebuildable: true,
      reason: '由 TestApp 生成的可重建缓存。', consequence: '删除后 TestApp 会自行重建。',
      revival: [], evidence: ['子目录含 CacheStorage'],
    }));
  },
  async diagnose(input) {
    aiCalls += 1;
    lastDiagnoseInput = input;
    return structuredClone(diagnoseAnswer);
  },
  metadata() {
    return { provider: 'fixture-cloud-agents', model: 'fixture-model', selection: 'fixed' };
  },
};

function makeApp(db) {
  const handle = application({ db, BackendError, ai: fakeAi });
  return async (method, path, body, headers = {}) => {
    const request = new Request(`http://localhost/functions/v1/app${path}`, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let context;
    try { context = createSiteContext(request); return await handle(context); }
    catch (error) { return errorResponse(error, context?.requestId); }
  };
}

const item = (key, name, extra = {}) => ({
  key, name, ancestors: ['C:', 'Users', 'alice', 'AppData', 'Local', 'TestApp'],
  childDirs: ['CacheStorage', 'GPUCache'], childExts: ['.tmp', '.log'],
  fileCount: 12, dirCount: 2, sizeBytes: 4096, isEmpty: false, ...extra,
});

async function fingerprintOf(itemValue) {
  const GUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}/gi;
  const normalize = (value) => value.toLowerCase().replace(GUIDISH, '<id>').trim();
  const ancestors = redactAncestors(itemValue.ancestors);
  const parent = ancestors.length ? normalize(ancestors[ancestors.length - 1]) : '';
  const dirs = [...new Set(itemValue.childDirs.map(normalize))].sort().slice(0, 10).join(',');
  const exts = [...new Set(itemValue.childExts.map((ext) => ext.toLowerCase().replace(/^\./, '')))].sort().slice(0, 10).join(',');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    `${normalize(itemValue.name)}|${parent}|${dirs}|${exts}|${itemValue.isEmpty ? 'e' : 'f'}`,
  ));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function knowledgeRow(fingerprint, updatedAt) {
  return {
    fingerprint,
    subject: 'Cache',
    owner: 'TestApp',
    owner_kind: 'app',
    purpose: '共享缓存里的测试判定',
    verdict: 'needs_review',
    confidence: 80,
    rebuildable: true,
    reason: '该行用于测试缓存命中，不代表真实模型结果。',
    consequence: '测试缓存后果。',
    revival: '[]',
    evidence: '[]',
    origin: 'ai',
    updated_at: updatedAt,
  };
}

let passed = 0; let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed += 1; console.log(`PASS  ${label}`); }
  else { failed += 1; console.log(`FAIL  ${label}${detail ? ` :: ${JSON.stringify(detail)}` : ''}`); }
}

const db = createFakeDb();
const call = makeApp(db);

// --- health & routing ---
{
  const res = await call('GET', '/api/health');
  check('health 200', res.status === 200 && (await res.json()).ok === true);
}
{
  const res = await call('GET', '/api/nope');
  check('unknown route 404', res.status === 404);
}
{
  const res = await call('GET', '/api/judge');
  check('wrong method rejected', res.status === 404 || res.status === 405);
}

// --- input validation ---
{
  const res = await call('POST', '/api/judge', {});
  check('missing items 400', res.status === 400);
}
{
  const res = await call('POST', '/api/judge', { items: [item('k1', 'Cache', { key: 'bad key!' })] });
  check('invalid key 400', res.status === 400);
}
{
  const res = await call('POST', '/api/judge', { items: [item('k1', 'Cache', { fileCount: -5 })] });
  check('negative count 400', res.status === 400);
}
{
  const res = await call('POST', '/api/judge', { items: [item('k1', 'Cache'), item('k1', 'Other')] });
  check('duplicate keys 400', res.status === 400);
}
{
  const res = await call('POST', '/api/judge', { items: Array.from({ length: 25 }, (_, i) => item(`k${i}`, `D${i}`)) });
  check('over batch cap 400', res.status === 400);
}
{
  const res = await call('POST', '/api/judge', { items: [item('k1', 'x'.repeat(201))] });
  check('overlong name 400', res.status === 400);
}
{
  const res = await call('POST', '/api/judge', { items: [item('k1', 'Cache', { ancestors: 'not-an-array' })] });
  check('non-array ancestors 400', res.status === 400);
}

// --- judge: AI path then shared-cache path ---
{
  const before = aiCalls;
  const res = await call('POST', '/api/judge', { items: [item('a1', 'Cache'), item('a2', 'GPUCache')] });
  const body = await res.json();
  check('judge 200', res.status === 200, body);
  check('judge returns both', body.judgments?.length === 2, body);
  check('judge used AI once', aiCalls === before + 1);
  check('judge aiStatus ok', body.aiStatus === 'ok');
  check('judge unresolved empty', body.unresolved?.length === 0);
  check('AI results are not auto-written to shared knowledge', db.tables.get('knowledge').length === 0);
}
{
  const fresh = new Date().toISOString();
  const first = item('b1', 'SharedOne', { childDirs: ['CacheStorage'], childExts: ['.log'] });
  const second = item('b2', 'SharedTwo', { childDirs: ['GPUCache'], childExts: ['.tmp'] });
  db.ensure('knowledge').push(
    knowledgeRow(await fingerprintOf(first), fresh),
    knowledgeRow(await fingerprintOf(second), fresh),
  );
  const before = aiCalls;
  const res = await call('POST', '/api/judge', { items: [first, second] });
  const body = await res.json();
  check('fresh shared cache hits without AI call', body.cachedCount === 2 && aiCalls === before, body);
  check('cache origin labelled as cache', body.judgments.every((judgment) => judgment.origin === 'cache'));
}
{
  const stale = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const first = item('c1', 'StaleOne', { childDirs: ['CacheStorage'], childExts: ['.old'] });
  const second = item('c2', 'StaleTwo', { childDirs: ['GPUCache'], childExts: ['.old'] });
  db.ensure('knowledge').push(
    knowledgeRow(await fingerprintOf(first), stale),
    knowledgeRow(await fingerprintOf(second), stale),
  );
  const before = aiCalls;
  const beforeRows = db.tables.get('knowledge').length;
  const res = await call('POST', '/api/judge', { items: [first, second] });
  const body = await res.json();
  check('expired shared cache is revalidated with AI', body.cachedCount === 0 && aiCalls === before + 1, body);
  check('revalidation still does not write shared knowledge', db.tables.get('knowledge').length === beforeRows);
}

// --- conservative clamping (last line of defence) ---
{
  const low = normalizeJudgment({ verdict: 'safe_delete', confidence: 0.4, ownerKind: 'app' }, 'k');
  check('low confidence cannot be safe_delete', low.verdict === 'needs_review', low);
  const sys = normalizeJudgment({ verdict: 'safe_delete', confidence: 0.99, ownerKind: 'system' }, 'k');
  check('system forced keep_locked', sys.verdict === 'keep_locked', sys);
  const revive = normalizeJudgment({ verdict: 'safe_delete', confidence: 0.95, ownerKind: 'app', revival: ['shell_namespace'] }, 'k');
  check('self-reviving cannot be safe_delete', revive.verdict === 'needs_review', revive);
  const unknown = normalizeJudgment({ verdict: 'safe_delete', confidence: 0.95, ownerKind: 'unknown' }, 'k');
  check('unknown owner cannot be safe_delete', unknown.verdict === 'needs_review', unknown);
  const bogus = normalizeJudgment({ verdict: 'DELETE_EVERYTHING', confidence: 99, ownerKind: 'weird' }, 'k');
  check('bogus verdict falls back', bogus.verdict === 'needs_review' && bogus.confidence === 1 && bogus.ownerKind === 'unknown', bogus);
  const injected = normalizeJudgment({ verdict: 'safe_delete', confidence: 0.9, ownerKind: 'app', revival: ['not_a_mechanism'] }, 'k');
  check('unknown mechanism filtered', injected.revival.length === 0, injected);
}

// --- diagnose ---
{
  const res = await call('POST', '/api/diagnose', { subject: '某云盘', symptoms: '删了又出现，资源管理器找不到' });
  const body = await res.json();
  check('diagnose 200', res.status === 200 && body.aiStatus === 'ok', body);
  check('diagnose finding mechanism', body.report?.findings?.[0]?.mechanism === 'shell_namespace', body);
  check('diagnose reports provider/model metadata', body.aiMetadata?.provider === 'fixture-cloud-agents'
    && body.aiMetadata?.model === 'fixture-model' && body.aiMetadata?.selection === 'fixed', body.aiMetadata);
}
{
  const res = await call('POST', '/api/diagnose', { subject: '', symptoms: 'x' });
  check('diagnose empty subject 400', res.status === 400);
}
{
  const res = await call('POST', '/api/diagnose', { subject: 'TestApp', symptoms: 'x', scriptOutput: '{"secret":"raw"}' });
  check('raw scriptOutput rejected', res.status === 400);
}
{
  const evidence = [{ id: 'ev_testcollection_service_001', kind: 'service', subject: 'TestApp' }];
  const res = await call('POST', '/api/diagnose', { subject: 'TestApp', symptoms: 'x', evidence });
  const body = await res.json();
  check('minimal evidence accepted', res.status === 200 && body.aiStatus === 'ok', body);
  check('backend receives no raw scriptOutput', lastDiagnoseInput && !('scriptOutput' in lastDiagnoseInput), lastDiagnoseInput);
  check('backend receives only evidence manifest', JSON.stringify(lastDiagnoseInput?.evidence) === JSON.stringify(evidence), lastDiagnoseInput);
}
{
  const evidence = [{ id: 'ev_testcollection_service_001', kind: 'service', subject: 'TestApp' }];
  diagnoseAnswer = {
    findings: [{ mechanism: 'autostart_service', subject: 'Ghost', detail: '伪造', evidenceIds: ['ev_testcollection_service_999'], confidence: 0.99 }],
    officialUninstallerEvidenceId: null,
    advice: '',
  };
  const res = await call('POST', '/api/diagnose', { subject: 'TestApp', symptoms: 'x', evidence });
  const body = await res.json();
  check('forged evidence id fails closed', res.status === 200 && body.aiStatus === 'unavailable' && body.report === null, body);
}
{
  const evidence = [{ id: 'ev_testcollection_service_001', kind: 'service', subject: 'TestApp' }];
  diagnoseAnswer = {
    findings: [{
      mechanism: 'autostart_service', subject: 'TestApp', detail: '本地服务', evidenceIds: [evidence[0].id], confidence: 0.9,
      serviceName: 'GhostService', registryPath: 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', taskName: 'GhostTask',
    }],
    officialUninstallerEvidenceId: null,
    advice: '',
  };
  const res = await call('POST', '/api/diagnose', { subject: 'TestApp', symptoms: 'x', evidence });
  const body = await res.json();
  const finding = body.report?.findings?.[0];
  check('AI executable target fields stripped', res.status === 200 && finding
    && !('serviceName' in finding) && !('registryPath' in finding) && !('taskName' in finding), body);
}
{
  const evidence = [{ id: 'ev_testcollection_service_001', kind: 'service', subject: 'TestApp' }];
  diagnoseAnswer = {
    findings: [], officialUninstallerEvidenceId: evidence[0].id, advice: '',
  };
  const res = await call('POST', '/api/diagnose', { subject: 'TestApp', symptoms: 'x', evidence });
  const body = await res.json();
  check('non-uninstaller evidence cannot be official uninstaller', body.aiStatus === 'unavailable' && body.report === null, body);
}
{
  const evidence = [{ id: 'ev_testcollection_uninstaller_001', kind: 'uninstaller', subject: 'TestApp' }];
  diagnoseAnswer = {
    findings: [], officialUninstallerEvidenceId: evidence[0].id, advice: '',
  };
  const res = await call('POST', '/api/diagnose', { subject: 'TestApp', symptoms: 'x', evidence });
  const body = await res.json();
  check('local uninstaller evidence reference accepted', body.aiStatus === 'ok' && body.report?.officialUninstallerEvidenceId === evidence[0].id, body);
  diagnoseAnswer = {
    findings: [{ mechanism: 'shell_namespace', subject: 'TestApp', detail: '注册表虚拟文件夹', evidenceIds: [], confidence: 0.7 }],
    officialUninstallerEvidenceId: null,
    advice: '先卸载再清理残留',
  };
}

{
  const sensitive = "C:\\Users\\alice\\AppData\\Local\\TestApp alice@example.com api_key=supersecret AA:BB:CC:DD:EE:FF ABCDE-ABCDE-ABCDE-ABCDE-ABCDE";
  const redacted = redactDiagnosisText(sensitive);
  check('server redacts diagnosis text', !redacted.includes('alice') && !redacted.includes('supersecret')
    && !redacted.includes('AA:BB:CC') && !redacted.includes('ABCDE-ABCDE') && !redacted.includes('C:\\Users'), redacted);
  const prompt = buildDiagnosePrompt({
    subject: sensitive,
    symptoms: sensitive,
    evidence: [{ id: 'ev_testcollection_service_001', kind: 'service', subject: sensitive }],
  });
  check('diagnosis prompt contains no raw sensitive fields', !prompt.includes('alice') && !prompt.includes('supersecret')
    && !prompt.includes('AA:BB:CC') && !prompt.includes('ABCDE-ABCDE'), prompt);
}

// --- anonymous abuse control ---
{
  const localDb = createFakeDb();
  const localCall = makeApp(localDb);
  let last = null;
  for (let i = 0; i < 14; i += 1) {
    const res = await localCall('POST', '/api/judge', { items: [item(`q${i}`, `UniqueDir${i}`)] });
    last = await res.json();
  }
  check('anon window cap enforced', last.aiStatus === 'rate_limited', last);
  check('cap still returns 200 with unresolved', Array.isArray(last.unresolved) && last.unresolved.length === 1, last);
  const usage = localDb.tables.get('ai_usage');
  check('usage rows persisted', usage.length >= 2, usage.map((r) => r.bucket));
}

// --- coordinator: atomic claim + version fencing ---
{
  const coordDb = createFakeDb();
  const coordinator = createCoordinator({ db: coordDb, BackendError });
  let entered = 0;
  const results = await Promise.allSettled([
    coordinator.withLock('key1', async (lease) => {
      entered += 1;
      await lease.write({ state: 'creating', fingerprint: 'f' });
      await new Promise((r) => setTimeout(r, 30));
      await lease.assertHeld();
      await lease.write({ state: 'ready', id: 'agent_x', version: 1 });
      return 'ok';
    }),
    coordinator.withLock('key1', async () => { entered += 1; return 'should-not-run'; }),
  ]);
  check('only one holder enters', entered === 1, { entered, results: results.map((r) => r.status) });
  check('loser gets pending 202', results[1].status === 'rejected' && results[1].reason?.status === 202);
  const row = coordDb.tables.get('cloud_lease')[0];
  check('binding persisted', JSON.parse(row.record).state === 'ready' && JSON.parse(row.record).id === 'agent_x', row);
  check('fingerprint preserved across writes', JSON.parse(row.record).fingerprint === 'f', row);
}
{
  const coordDb = createFakeDb();
  const coordinator = createCoordinator({ db: coordDb, BackendError });
  coordDb.ensure('cloud_lease').push({
    lock_key: 'stale', holder: 'dead-owner', expires_at_ms: Date.now() - 1000, version: 7,
    record: JSON.stringify({ state: 'unknown', fingerprint: 'f' }),
  });
  let saw = null;
  await coordinator.withLock('stale', async (lease) => { saw = await lease.read(); });
  check('expired lease takeover reads prior record', saw?.state === 'unknown', saw);
  const row = coordDb.tables.get('cloud_lease')[0];
  check('takeover bumps version (fencing)', Number(row.version) === 8, row);
}
{
  const coordDb = createFakeDb();
  const coordinator = createCoordinator({ db: coordDb, BackendError });
  coordDb.ensure('cloud_lease').push({
    lock_key: 'live', holder: 'other', expires_at_ms: Date.now() + 30_000, version: 1, record: null,
  });
  const outcome = await coordinator.withLock('live', async () => 'ran').catch((e) => e);
  check('live holder blocks second instance', outcome instanceof BackendError && outcome.status === 202);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);