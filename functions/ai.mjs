import { createCloudAgentsClient, ensureCloudResources, CloudAgentsError } from './cloud-agents.mjs';
import {
  CLASSIFY_SYSTEM, DIAGNOSE_SYSTEM, isMechanism,
  buildClassifyPrompt, buildDiagnosePrompt,
} from './prompts.mjs';

// Trusted server configuration. The origin is copied verbatim from
// sites.get_context runtime.cloudAgents.apiOrigin; the scope is a fixed deployment
// constant, never derived from a Host header or a visitor-supplied value.
const CLOUD_ORIGIN = 'https://api.qoder.com.cn';
const APP_SCOPE = 'dareclean-prod-cn-1';

const WAIT_BUDGET_MS = 28_000;
const POLL_MS = 1_200;
const MAX_ANSWER_CHARS = 64_000;

// A read cache only. Durable creation intent lives in the coordinator's database rows.
let modelCache = null;
let modelSelection = 'dynamic';
const MODEL_ENV = 'DASHCLEAN_MODEL_ID';

function configuredModelId() {
  try {
    const value = globalThis.Deno?.env.get(MODEL_ENV);
    return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value.trim()) ? value.trim() : null;
  } catch {
    return null;
  }
}

const SOURCE_MECHANISMS = new Set(['autostart_service', 'scheduled_task', 'run_key', 'shell_namespace']);
const VERDICTS = new Set(['safe_delete', 'needs_review', 'keep_locked']);
const OWNER_KINDS = new Set(['app', 'system', 'dev_tool', 'cache', 'unknown']);

function publicError(error, fallback = 'ai_service_unavailable') {
  if (error instanceof CloudAgentsError && typeof error.code === 'string') {
    const status = Number.isInteger(error.status) ? error.status : 503;
    return { code: error.code, status: status >= 400 && status <= 599 ? status : 503 };
  }
  return { code: fallback, status: 503 };
}

async function selectModel(client) {
  if (modelCache && Date.now() - modelCache.at < 300_000) {
    modelSelection = modelCache.selection;
    return modelCache.id;
  }
  const page = await client.request('/api/v1/cloud/models', { method: 'GET' });
  const list = Array.isArray(page?.data) ? page.data : Array.isArray(page) ? page : [];
  const enabled = list
    .filter((m) => m && typeof m.id === 'string' && m.id
      && m.enabled !== false && m.status !== 'disabled' && m.disabled !== true)
    .map((m) => m.id)
    .sort();
  if (!enabled.length) throw new CloudAgentsError('ai_not_configured', 503, 'not_sent');
  const configured = configuredModelId();
  if (configured) {
    if (!enabled.includes(configured)) throw new CloudAgentsError('ai_model_unavailable', 503, 'not_sent');
    modelSelection = 'fixed';
    modelCache = { id: configured, at: Date.now(), selection: 'fixed' };
    return configured;
  }
  // Deterministic choice keeps the Agent definition fingerprint stable across cold starts.
  const preferred = enabled.find((id) => /claude|qwen3|gpt|gemini/i.test(id));
  const id = preferred ?? enabled[0];
  modelSelection = 'dynamic';
  modelCache = { id, at: Date.now(), selection: 'dynamic' };
  return id;
}

async function binding(client, coordinator, system, name) {
  const model = await selectModel(client);
  const resources = await ensureCloudResources({
    client,
    coordinator,
    applicationScope: APP_SCOPE,
    agent: { name, model, system, tools: [], metadata: { app: 'dareclean', purpose: 'disk-verdict' } },
    environment: { name: `${name} environment`, config: { type: 'cloud' }, metadata: { app: 'dareclean' } },
  });
  return {
    resources,
    metadata: { provider: 'qoder-cloud-agents', model, selection: modelSelection },
  };
}

function textOf(event) {
  const blocks = event?.content ?? event?.message?.content ?? event?.data?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let body = text.trim();
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) body = fenced[1].trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(body.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Stops as soon as a complete, schema-valid answer exists. This deliberately does
// not depend on the upstream session-status event vocabulary: a parseable answer
// is stronger evidence of completion than any status flag.
async function runSession(client, bound, prompt, validate) {
  const session = await client.request('/api/v1/cloud/sessions', {
    method: 'POST',
    body: { ...bound, title: '洁灵目录判定', metadata: { app: 'dareclean', purpose: 'one-shot' } },
  });
  const sessionId = session?.id;
  if (typeof sessionId !== 'string' || !/^sess_[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new CloudAgentsError('ai_response_invalid', 502, 'unknown');
  }

  await client.request(`/api/v1/cloud/sessions/${sessionId}/events`, {
    method: 'POST',
    body: { events: [{ type: 'user.message', content: [{ type: 'text', text: prompt }] }] },
  });

  const deadline = Date.now() + WAIT_BUDGET_MS;
  const complete = new Map();
  const drafts = new Map();
  let terminal = null;
  let cursor;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const query = cursor
      ? `?order=asc&limit=100&after=${encodeURIComponent(cursor)}`
      : '?order=asc&limit=100';
    let page;
    try {
      page = await client.request(`/api/v1/cloud/sessions/${sessionId}/events${query}`, { method: 'GET' });
    } catch (error) {
      const mapped = publicError(error);
      // Read-side transient failures are retried within the budget; auth failures are not.
      if (mapped.code === 'ai_access_denied' || mapped.code === 'ai_not_configured') throw error;
      continue;
    }
    const events = Array.isArray(page?.data) ? page.data : [];
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      const id = typeof event.id === 'string' ? event.id : null;
      const type = typeof event.type === 'string' ? event.type : '';
      if (type === 'agent.message' && id) {
        const text = textOf(event);
        if (text) complete.set(id, text);
      } else if ((type === 'event_delta' || type === 'content_delta') && id) {
        const delta = event.delta?.content?.text ?? event.delta?.text;
        if (typeof delta === 'string') drafts.set(id, (drafts.get(id) ?? '') + delta);
      }
      const state = event.state ?? event.status ?? event.session?.state ?? null;
      if (typeof state === 'string' && ['completed', 'failed', 'interrupted'].includes(state)) terminal = state;
      if (id) cursor = id;
    }

    const parts = complete.size ? [...complete.values()] : [...drafts.values()];
    const text = parts.join('\n').slice(0, MAX_ANSWER_CHARS);
    const parsed = extractJson(text);
    if (parsed) {
      const accepted = validate(parsed);
      if (accepted) return accepted;
    }
    if (terminal === 'failed' || terminal === 'interrupted') {
      throw new CloudAgentsError('ai_generation_failed', 502, 'rejected');
    }
    if (terminal === 'completed' && !parsed) {
      throw new CloudAgentsError('ai_response_invalid', 502, 'rejected');
    }
    if (page?.has_more === false && !events.length && terminal) break;
  }
  throw new CloudAgentsError('ai_timeout', 504, 'unknown');
}

function clampString(value, max, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.replace(/[\u0000-\u001f]/g, ' ').trim();
  return trimmed.slice(0, max) || fallback;
}

function clampStringArray(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === 'string' && v.trim())
    .slice(0, maxItems)
    .map((v) => clampString(v, maxLen));
}

// Last line of defence: even a wrong or injected model answer cannot produce an
// unsafe "safe_delete" for a system directory or a self-reviving one.
export function normalizeJudgment(raw, key) {
  if (!raw || typeof raw !== 'object') return null;
  let verdict = VERDICTS.has(raw.verdict) ? raw.verdict : 'needs_review';
  let confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.3;
  confidence = Math.min(1, Math.max(0, confidence));
  const ownerKind = OWNER_KINDS.has(raw.ownerKind) ? raw.ownerKind : 'unknown';
  const revival = Array.isArray(raw.revival) ? raw.revival.filter(isMechanism) : [];

  if (ownerKind === 'system') verdict = 'keep_locked';
  if (verdict === 'safe_delete' && confidence < 0.75) verdict = 'needs_review';
  if (verdict === 'safe_delete' && revival.some((m) => SOURCE_MECHANISMS.has(m))) verdict = 'needs_review';
  if (verdict === 'safe_delete' && ownerKind === 'unknown') verdict = 'needs_review';

  return {
    key,
    owner: clampString(raw.owner, 80, '未识别'),
    ownerKind,
    purpose: clampString(raw.purpose, 160, '用途未确认'),
    verdict,
    confidence: Math.round(confidence * 100) / 100,
    rebuildable: raw.rebuildable === true,
    reason: clampString(raw.reason, 240, '模型未给出可核验的理由，按需要人工确认处理。'),
    consequence: clampString(raw.consequence, 240, '后果未确认，删除前请自行核对内容。'),
    revival,
    evidence: clampStringArray(raw.evidence, 4, 160),
  };
}

const EVIDENCE_ID_RE = /^ev_[A-Za-z0-9_-]{8,90}$/;
const EVIDENCE_KINDS = new Set([
  'service', 'task', 'run_key', 'shell_namespace', 'process',
  'uninstaller', 'startup_folder', 'target',
]);

export function normalizeDiagnosisAnswer(raw, evidence) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.findings) || raw.findings.length > 12) {
    throw new CloudAgentsError('ai_response_invalid', 502, 'rejected');
  }
  const evidenceById = new Map(evidence.map((entry) => [entry.id, entry]));
  const findings = raw.findings.map((finding) => {
    if (!finding || typeof finding !== 'object' || !isMechanism(finding.mechanism)) {
      throw new CloudAgentsError('ai_response_invalid', 502, 'rejected');
    }
    const ids = finding.evidenceIds === undefined ? [] : finding.evidenceIds;
    if (!Array.isArray(ids) || ids.length > 8 || ids.some((id) =>
      typeof id !== 'string' || !EVIDENCE_ID_RE.test(id) || !evidenceById.has(id))) {
      throw new CloudAgentsError('ai_response_invalid', 502, 'rejected');
    }
    let confidence = Number(finding.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.3;
    return {
      mechanism: finding.mechanism,
      subject: clampString(finding.subject, 120, '未指明对象'),
      detail: clampString(finding.detail, 400, ''),
      evidenceIds: [...new Set(ids)],
      confidence: Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100,
    };
  });

  let officialUninstallerEvidenceId = null;
  if (raw.officialUninstallerEvidenceId !== undefined && raw.officialUninstallerEvidenceId !== null) {
    const id = raw.officialUninstallerEvidenceId;
    const entry = typeof id === 'string' ? evidenceById.get(id) : null;
    if (typeof id !== 'string' || !EVIDENCE_ID_RE.test(id) || !entry || entry.kind !== 'uninstaller') {
      throw new CloudAgentsError('ai_response_invalid', 502, 'rejected');
    }
    officialUninstallerEvidenceId = id;
  }

  return {
    findings,
    officialUninstallerEvidenceId,
    advice: clampString(raw.advice, 400, ''),
    generatedAt: Date.now(),
  };
}

export function createAi({ coordinator }) {
  const client = createCloudAgentsClient({ origin: CLOUD_ORIGIN });
  let lastMetadata = null;

  return {
    async classify(items) {
      const bound = await binding(client, coordinator, CLASSIFY_SYSTEM, '洁灵目录判定引擎');
      lastMetadata = bound.metadata;
      const prompt = buildClassifyPrompt(items);
      const expected = new Map(items.map((item) => [item.key, item]));
      const answer = await runSession(client, bound.resources, prompt, (parsed) => {
        if (!Array.isArray(parsed.judgments) || parsed.judgments.length !== items.length) return null;
        const out = [];
        const seen = new Set();
        for (const raw of parsed.judgments) {
          const key = typeof raw?.key === 'string' ? raw.key : null;
          if (!key || !expected.has(key) || seen.has(key)) return null;
          const normalized = normalizeJudgment(raw, key);
          if (!normalized) return null;
          seen.add(key);
          out.push(normalized);
        }
        return out.length === items.length ? out : null;
      });
      return answer;
    },

    async diagnose(input) {
      const bound = await binding(client, coordinator, DIAGNOSE_SYSTEM, '洁灵顽固软件诊断引擎');
      lastMetadata = bound.metadata;
      const prompt = buildDiagnosePrompt(input);
      return runSession(client, bound.resources, prompt, (parsed) => normalizeDiagnosisAnswer(parsed, input.evidence));
    },

    metadata() {
      return lastMetadata ?? {
        provider: 'qoder-cloud-agents',
        model: null,
        selection: configuredModelId() ? 'fixed' : 'dynamic',
      };
    },
  };
}

export { publicError };