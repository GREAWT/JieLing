import { getUser, UserContextError } from './auth.mjs';
import { createCoordinator } from './coordinator.mjs';
import { createAi, normalizeDiagnosisAnswer, publicError } from './ai.mjs';
import { redactAncestors } from './prompts.mjs';

const MAX_BODY = 65_536;
const MAX_ITEMS = 24;
const GLOBAL_DAILY_CAP = 400;
const ANON_WINDOW_CAP = 12;
const USER_WINDOW_CAP = 30;
const WINDOW_MS = 600_000;

const GUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}/gi;
const EVIDENCE_ID_RE = /^ev_[A-Za-z0-9_-]{8,90}$/;
const EVIDENCE_KINDS = new Set([
  'service', 'task', 'run_key', 'shell_namespace', 'process',
  'uninstaller', 'startup_folder', 'target',
]);

async function sha256(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeToken(value) {
  return value.toLowerCase().replace(GUIDISH, '<id>').trim();
}

// Identity of a folder kind, not of one user's copy: exact counts, sizes and
// GUID-named children are deliberately excluded so the shared cache actually hits.
async function fingerprintOf(item) {
  const ancestors = redactAncestors(item.ancestors);
  const parent = ancestors.length ? normalizeToken(ancestors[ancestors.length - 1]) : '';
  const dirs = [...new Set(item.childDirs.map(normalizeToken))].sort().slice(0, 10).join(',');
  const exts = [...new Set(item.childExts.map((e) => e.toLowerCase().replace(/^\./, '')))].sort().slice(0, 10).join(',');
  return sha256(`${normalizeToken(item.name)}|${parent}|${dirs}|${exts}|${item.isEmpty ? 'e' : 'f'}`);
}

export function application({ db, BackendError, ai: aiOverride }) {
  const fail = (code, status) => { throw new BackendError(code, status); };
  const rows = (result) => {
    if (result.error) fail(result.error.code, result.error.status);
    return result.data;
  };
  const coordinator = createCoordinator({ db, BackendError });
  const ai = aiOverride ?? createAi({ coordinator });

  async function input(request) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) fail('invalid_input', 400);
    const reader = request.body?.getReader();
    if (!reader) fail('invalid_input', 400);
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BODY) { await reader.cancel(); fail('payload_too_large', 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('invalid_input', 400); }
  }

  const str = (value, max, required = false) => typeof value === 'string'
    && (!required || value.trim().length > 0)
    && value.length <= max && !/[\u0000-\u001f]/.test(value);
  const int = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  const strArray = (value, maxItems, maxLen) => Array.isArray(value) && value.length <= maxItems
    && value.every((v) => str(v, maxLen));

  function validateItem(raw) {
    if (!raw || typeof raw !== 'object') fail('invalid_input', 400);
    if (!str(raw.key, 64, true) || !/^[A-Za-z0-9_-]+$/.test(raw.key)) fail('invalid_input', 400);
    if (!str(raw.name, 200, true)) fail('invalid_input', 400);
    if (!strArray(raw.ancestors, 8, 120)) fail('invalid_input', 400);
    if (!strArray(raw.childDirs, 12, 120)) fail('invalid_input', 400);
    if (!strArray(raw.childExts, 12, 16)) fail('invalid_input', 400);
    if (!int(raw.fileCount, 1e9) || !int(raw.dirCount, 1e9)) fail('invalid_input', 400);
    if (!int(raw.sizeBytes, Number.MAX_SAFE_INTEGER)) fail('invalid_input', 400);
    if (typeof raw.isEmpty !== 'boolean') fail('invalid_input', 400);
    return {
      key: raw.key, name: raw.name.trim(), ancestors: raw.ancestors,
      childDirs: raw.childDirs, childExts: raw.childExts,
      fileCount: raw.fileCount, dirCount: raw.dirCount,
      sizeBytes: raw.sizeBytes, isEmpty: raw.isEmpty,
    };
  }

  function validateEvidence(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 400) fail('invalid_input', 400);
    const seen = new Set();
    return value.map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid_input', 400);
      if (!str(raw.id, 100, true) || !EVIDENCE_ID_RE.test(raw.id) || seen.has(raw.id)) fail('invalid_input', 400);
      if (!str(raw.kind, 40, true) || !EVIDENCE_KINDS.has(raw.kind)) fail('invalid_input', 400);
      if (!str(raw.subject, 120, true)) fail('invalid_input', 400);
      seen.add(raw.id);
      return { id: raw.id, kind: raw.kind, subject: raw.subject.trim() };
    });
  }

  async function reserve(bucket, cap) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const inserted = rows(await db.from('ai_usage')
        .insertIfAbsent({ bucket, calls: 1, version: 1 }, { onConflict: 'bucket' })
        .select('calls,version'));
      if (inserted?.length) return true;
      const found = rows(await db.from('ai_usage').select('calls,version').eq('bucket', bucket).limit(1));
      if (!found?.length) return false;
      const calls = Number(found[0].calls);
      const version = Number(found[0].version);
      if (calls >= cap) return false;
      const updated = rows(await db.from('ai_usage')
        .update({ calls: calls + 1, version: version + 1 })
        .eq('bucket', bucket).eq('version', version).select('calls'));
      if (updated?.length) return true;
    }
    return false;
  }

  async function callerBucket(request, user) {
    if (user) return `win:u${await sha256(user.user_id)}:${Math.floor(Date.now() / WINDOW_MS)}`;
    const forwarded = request.headers.get('x-forwarded-for') ?? '';
    const ip = forwarded.split(',')[0].trim();
    const stable = /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : 'anon';
    return `win:a${await sha256(stable)}:${Math.floor(Date.now() / WINDOW_MS)}`;
  }

  // Returns null when the caller may proceed, or a public aiStatus code when not.
  async function checkQuota(request, user) {
    const day = new Date().toISOString().slice(0, 10);
    if (!await reserve(`day:${day}`, GLOBAL_DAILY_CAP)) return 'quota_exhausted';
    const cap = user ? USER_WINDOW_CAP : ANON_WINDOW_CAP;
    if (!await reserve(await callerBucket(request, user), cap)) return 'rate_limited';
    return null;
  }

  function identity(request) {
    try { return getUser(request); }
    catch (error) {
      if (error instanceof UserContextError) fail(error.code, error.status);
      throw error;
    }
  }

  async function readKnowledge(fingerprints) {
    const ttlMs = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const found = await Promise.all(fingerprints.map(async (fp) => {
      const result = rows(await db.from('knowledge')
        .select('fingerprint,subject,owner,owner_kind,purpose,verdict,confidence,rebuildable,reason,consequence,revival,evidence,origin,updated_at')
        .eq('fingerprint', fp).limit(1));
      return result?.length ? result[0] : null;
    }));
    const map = new Map();
    for (const row of found) {
      if (!row) continue;
      const updatedAt = Date.parse(row.updated_at ?? '');
      // 过期缓存按未命中处理并重新请求模型；缓存不是正式规则。
      if (!Number.isFinite(updatedAt) || now - updatedAt > ttlMs) continue;
      let revival = [];
      let evidence = [];
      try { revival = JSON.parse(row.revival); } catch { revival = []; }
      try { evidence = JSON.parse(row.evidence); } catch { evidence = []; }
      map.set(row.fingerprint, {
        fingerprint: row.fingerprint,
        owner: row.owner,
        ownerKind: row.owner_kind,
        purpose: row.purpose,
        verdict: row.verdict,
        confidence: Number(row.confidence) / 100,
        rebuildable: row.rebuildable === true,
        reason: row.reason,
        consequence: row.consequence,
        revival: Array.isArray(revival) ? revival : [],
        evidence: Array.isArray(evidence) ? evidence : [],
        origin: 'cache',
        verifiedAt: row.updated_at,
      });
    }
    return map;
  }

  // AI 结果只作为本次响应返回；候选规则由用户在本机审核后保存。
  // 不再把 AI 判定自动写入共享知识库，也不跨用户同步。

  function aiMetadata() {
    try {
      const value = ai.metadata?.();
      if (!value || typeof value.provider !== 'string') return null;
      return {
        provider: value.provider.slice(0, 60),
        model: typeof value.model === 'string' ? value.model.slice(0, 120) : null,
        selection: value.selection === 'fixed' ? 'fixed' : 'dynamic',
      };
    } catch {
      return null;
    }
  }

  return async (ctx) => {
    const request = ctx.request;
    const pathname = new URL(request.url).pathname;
    const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
    if (!match) fail('not_found', 404);
    const path = match[1] || '/';

    if (path === '/api/health' && request.method === 'GET') return Response.json({ ok: true });

    if (path === '/api/judge' && request.method === 'POST') {
      const user = identity(request);
      const body = await input(request);
      if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > MAX_ITEMS) fail('invalid_input', 400);
      const items = body.items.map(validateItem);
      const keys = new Set(items.map((i) => i.key));
      if (keys.size !== items.length) fail('invalid_input', 400);

      const fingerprints = await Promise.all(items.map(fingerprintOf));
      const byKey = new Map(items.map((item, index) => [item.key, { item, fp: fingerprints[index] }]));
      const cached = await readKnowledge([...new Set(fingerprints)]);

      const judgments = [];
      const misses = [];
      for (const item of items) {
        const fp = byKey.get(item.key).fp;
        const hit = cached.get(fp);
        if (hit) judgments.push({ ...hit, key: item.key });
        else misses.push(item);
      }

      let aiStatus = 'ok';
      if (misses.length) {
        const blocked = await checkQuota(request, user);
        if (blocked) aiStatus = blocked;
        else {
          try {
            const answers = await ai.classify(misses);
            for (const answer of answers) {
              const entry = byKey.get(answer.key);
              if (!entry) continue;
              judgments.push({ ...answer, fingerprint: entry.fp, origin: 'ai' });
            }
          } catch (error) {
            const mapped = publicError(error);
            aiStatus = mapped.code === 'ai_timeout' ? 'timeout'
              : mapped.code === 'ai_not_configured' ? 'not_configured'
                : mapped.code === 'ai_initialization_pending' ? 'initializing'
                  : mapped.code === 'ai_rate_limited' ? 'rate_limited'
                    : 'unavailable';
          }
        }
      }

      const answered = new Set(judgments.map((j) => j.key));
      return Response.json({
        judgments,
        unresolved: items.filter((i) => !answered.has(i.key)).map((i) => i.key),
        cachedCount: judgments.filter((j) => j.origin === 'cache').length,
        aiStatus,
      }, { headers: { 'cache-control': 'no-store' } });
    }

    if (path === '/api/diagnose' && request.method === 'POST') {
      const user = identity(request);
      const body = await input(request);
      if (!str(body?.subject, 200, true) || !str(body?.symptoms, 1200, true)) fail('invalid_input', 400);
      if (body?.scriptOutput !== undefined) fail('invalid_input', 400);
      const evidence = validateEvidence(body?.evidence);

      const blocked = await checkQuota(request, user);
      if (blocked) {
        return Response.json({ report: null, aiStatus: blocked }, { headers: { 'cache-control': 'no-store' } });
      }
      try {
        const answer = await ai.diagnose({
          subject: body.subject.trim(),
          symptoms: body.symptoms.trim(),
          evidence,
        });
        const report = normalizeDiagnosisAnswer(answer, evidence);
        const metadata = aiMetadata();
        return Response.json({
          report,
          aiStatus: 'ok',
          ...(metadata ? { aiMetadata: metadata } : {}),
        }, { headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        const mapped = publicError(error);
        const aiStatus = mapped.code === 'ai_timeout' ? 'timeout'
          : mapped.code === 'ai_not_configured' ? 'not_configured'
            : mapped.code === 'ai_initialization_pending' ? 'initializing'
              : mapped.code === 'ai_rate_limited' ? 'rate_limited'
                : 'unavailable';
        return Response.json({ report: null, aiStatus }, { headers: { 'cache-control': 'no-store' } });
      }
    }

    fail('not_found', 404);
  };
}