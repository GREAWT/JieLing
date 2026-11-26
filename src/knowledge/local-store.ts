import type { LocalRule, RuleCandidate, RulePack, RuleRevision } from "../core/types";
import { validateLocalRule } from "./rule-model";

interface RuleState {
  schemaVersion: 1;
  version: number;
  custom: LocalRule[];
  candidates: RuleCandidate[];
  revisions: RuleRevision[];
  updatedAt: number;
}

export interface RuleRepository {
  listCustom(): Promise<LocalRule[]>;
  listCandidates(): Promise<RuleCandidate[]>;
  listRevisions(): Promise<RuleRevision[]>;
  version(): Promise<number>;
  saveCandidates(candidates: RuleCandidate[]): Promise<void>;
  updateCandidate(id: string, status: RuleCandidate["status"]): Promise<RuleCandidate[]>;
  addCustom(rule: LocalRule, reason: string): Promise<LocalRule[]>;
  updateCustom(id: string, patch: Partial<Pick<LocalRule, "enabled" | "verdict" | "originDescription">>, reason: string): Promise<LocalRule[]>;
  removeCustom(id: string, reason: string): Promise<LocalRule[]>;
  exportPack(): Promise<RulePack>;
  importPack(raw: string): Promise<{ rules: LocalRule[]; imported: number }>;
  rollback(): Promise<LocalRule[]>;
}

const DB_NAME = "dareclean.rule-library.v1";
const STORE_NAME = "state";
const STATE_KEY = "current";
const MAX_REVISIONS = 30;
const MAX_CANDIDATES = 200;

function emptyState(): RuleState {
  return { schemaVersion: 1, version: 0, custom: [], candidates: [], revisions: [], updatedAt: Date.now() };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashRootLabel(label: string): Promise<string> {
  return (await sha256(`dareclean-root:${label}`)).slice(0, 32);
}

export function normalizeRuleForPack(rule: LocalRule): LocalRule {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = clone(rule);
  return { ...rest, createdAt: 0, updatedAt: 0 };
}

function shareSafePath(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => /^[A-Za-z]:$/.test(segment) || segment === "..")) return false;
  for (let index = 1; index < segments.length; index += 1) {
    if (/^(Users|home|Documents and Settings)$/i.test(segments[index - 1])) return false;
  }
  return true;
}

async function packChecksum(pack: Pick<RulePack, "schemaVersion" | "rulesVersion" | "rules">): Promise<string> {
  return sha256(canonical({
    schemaVersion: pack.schemaVersion,
    rulesVersion: pack.rulesVersion,
    rules: pack.rules.map(normalizeRuleForPack).sort((a, b) => a.id.localeCompare(b.id)),
  }));
}

function snapshot(state: RuleState, reason: string): void {
  state.revisions.push({
    version: state.version,
    at: Date.now(),
    reason,
    rules: clone(state.custom),
  });
  if (state.revisions.length > MAX_REVISIONS) state.revisions.splice(0, state.revisions.length - MAX_REVISIONS);
  state.version += 1;
  state.updatedAt = Date.now();
}

function upsertCandidates(state: RuleState, candidates: RuleCandidate[]): void {
  for (const candidate of candidates) {
    const duplicate = state.candidates.find((item) =>
      item.status === "pending" && item.rootHash === candidate.rootHash
      && item.scanPath === candidate.scanPath && item.software === candidate.software);
    if (duplicate) {
      Object.assign(duplicate, candidate, { id: duplicate.id, createdAt: duplicate.createdAt });
      continue;
    }
    state.candidates.push(candidate);
  }
  const pending = state.candidates.filter((candidate) => candidate.status === "pending");
  if (pending.length > MAX_CANDIDATES) {
    const drop = new Set(pending.slice(0, pending.length - MAX_CANDIDATES).map((candidate) => candidate.id));
    state.candidates = state.candidates.filter((candidate) => !drop.has(candidate.id));
  }
  state.updatedAt = Date.now();
}

function validateImportedRule(rule: LocalRule): void {
  validateLocalRule(rule);
}

abstract class BaseRepository implements RuleRepository {
  protected abstract read(): Promise<RuleState>;
  protected abstract write(state: RuleState): Promise<void>;

  async listCustom(): Promise<LocalRule[]> {
    return clone((await this.read()).custom);
  }
  async listCandidates(): Promise<RuleCandidate[]> {
    return clone((await this.read()).candidates);
  }
  async listRevisions(): Promise<RuleRevision[]> {
    return clone((await this.read()).revisions);
  }
  async version(): Promise<number> {
    return (await this.read()).version;
  }
  async saveCandidates(candidates: RuleCandidate[]): Promise<void> {
    const state = await this.read();
    upsertCandidates(state, candidates);
    await this.write(state);
  }
  async updateCandidate(id: string, status: RuleCandidate["status"]): Promise<RuleCandidate[]> {
    const state = await this.read();
    const candidate = state.candidates.find((item) => item.id === id);
    if (!candidate) throw new Error("候选规则不存在。");
    candidate.status = status;
    candidate.updatedAt = Date.now();
    state.updatedAt = Date.now();
    await this.write(state);
    return clone(state.candidates);
  }
  async addCustom(rule: LocalRule, reason: string): Promise<LocalRule[]> {
    validateLocalRule(rule);
    const state = await this.read();
    if (state.custom.some((item) => item.id === rule.id)) throw new Error("自定义规则 id 已存在。");
    snapshot(state, reason);
    state.custom.push(clone(rule));
    await this.write(state);
    return clone(state.custom);
  }
  async updateCustom(id: string, patch: Partial<Pick<LocalRule, "enabled" | "verdict" | "originDescription">>, reason: string): Promise<LocalRule[]> {
    const state = await this.read();
    const rule = state.custom.find((item) => item.id === id);
    if (!rule) throw new Error("自定义规则不存在。");
    const next = { ...rule, ...patch, updatedAt: Date.now() };
    validateLocalRule(next);
    snapshot(state, reason);
    Object.assign(rule, next);
    await this.write(state);
    return clone(state.custom);
  }
  async removeCustom(id: string, reason: string): Promise<LocalRule[]> {
    const state = await this.read();
    if (!state.custom.some((rule) => rule.id === id)) throw new Error("自定义规则不存在。");
    snapshot(state, reason);
    state.custom = state.custom.filter((rule) => rule.id !== id);
    await this.write(state);
    return clone(state.custom);
  }
  async exportPack(): Promise<RulePack> {
    const state = await this.read();
    const rules = clone(state.custom)
      .filter((rule) => shareSafePath(rule.matchPath))
      .map(normalizeRuleForPack)
      .sort((a, b) => a.id.localeCompare(b.id));
    const base = { schemaVersion: 1 as const, rulesVersion: state.version, rules };
    return { ...base, exportedAt: Date.now(), checksum: await packChecksum(base) };
  }
  async importPack(raw: string): Promise<{ rules: LocalRule[]; imported: number }> {
    let pack: unknown;
    try { pack = JSON.parse(raw); } catch { throw new Error("规则包不是有效 JSON。"); }
    if (!pack || typeof pack !== "object") throw new Error("规则包结构非法。");
    const value = pack as Record<string, unknown>;
    if (value.schemaVersion !== 1 || typeof value.rulesVersion !== "number"
      || typeof value.checksum !== "string" || !Array.isArray(value.rules)) {
      throw new Error("规则包缺少 schemaVersion / rulesVersion / checksum / rules。");
    }
    const rules = value.rules as LocalRule[];
    for (const rule of rules) validateImportedRule(rule);
    const expected = await packChecksum({ schemaVersion: 1, rulesVersion: value.rulesVersion, rules });
    if (expected !== value.checksum) throw new Error("规则包校验和不匹配，拒绝导入。");

    const state = await this.read();
    const existing = new Set(state.custom.map((rule) => rule.id));
    const incoming = rules.filter((rule) => {
      if (existing.has(rule.id)) return false;
      existing.add(rule.id);
      return true;
    });
    if (incoming.length === 0) return { rules: clone(state.custom), imported: 0 };
    snapshot(state, `导入规则包（${incoming.length} 条）`);
    state.custom.push(...clone(incoming));
    await this.write(state);
    return { rules: clone(state.custom), imported: incoming.length };
  }
  async rollback(): Promise<LocalRule[]> {
    const state = await this.read();
    const previous = state.revisions.pop();
    if (!previous) throw new Error("没有可回滚的上一版自定义规则集。");
    state.custom = clone(previous.rules);
    state.version += 1;
    state.updatedAt = Date.now();
    await this.write(state);
    return clone(state.custom);
  }
}

const memoryStates = new Map<string, RuleState>();

class MemoryRepository extends BaseRepository {
  constructor(private readonly key: string) {
    super();
  }
  protected async read(): Promise<RuleState> {
    return clone(memoryStates.get(this.key) ?? emptyState());
  }
  protected async write(state: RuleState): Promise<void> {
    memoryStates.set(this.key, clone(state));
  }
}

class IndexedDbRepository extends BaseRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("打开规则 IndexedDB 失败。"));
    });
    return this.dbPromise;
  }

  protected async read(): Promise<RuleState> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result ? clone(request.result) : emptyState());
      request.onerror = () => reject(request.error ?? new Error("读取规则 IndexedDB 失败。"));
    });
  }

  protected async write(state: RuleState): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(clone(state), STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("写入规则 IndexedDB 失败。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("规则 IndexedDB 事务已中止。"));
    });
  }
}

export function createRuleRepository(): RuleRepository {
  if (typeof indexedDB === "undefined") return new MemoryRepository("runtime");
  return new IndexedDbRepository();
}

export function createMemoryRuleRepository(key = "test"): RuleRepository {
  return new MemoryRepository(key);
}
