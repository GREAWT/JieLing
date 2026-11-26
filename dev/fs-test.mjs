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

async function rejects(label, operation, verify) {
  try {
    await operation();
    check(label, false, "did not reject");
  } catch (error) {
    check(label, verify ? verify(error) : true, { message: error instanceof Error ? error.message : String(error) });
  }
}

function notFound() {
  return new DOMException("not found", "NotFoundError");
}

function typeMismatch() {
  return new DOMException("type mismatch", "TypeMismatchError");
}

class FakeFile {
  constructor(name, bytes, lastModified) {
    this.name = name;
    this.bytes = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes));
    this.lastModified = lastModified;
  }
  get size() { return this.bytes.byteLength; }
  async arrayBuffer() { return this.bytes.slice().buffer; }
  slice(start, end) {
    const bytes = this.bytes.slice(start, end);
    return {
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }
  async text() { return new TextDecoder().decode(this.bytes); }
}

class FakeWritable {
  constructor(handle, parent) {
    this.handle = handle;
    this.parent = parent;
    this.chunks = [];
    this.closed = false;
  }
  async write(value) {
    let bytes;
    if (value instanceof Uint8Array) bytes = value.slice();
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value.slice(0));
    else if (typeof value === "string") bytes = new TextEncoder().encode(value);
    else if (value && typeof value.arrayBuffer === "function") bytes = new Uint8Array(await value.arrayBuffer());
    else throw new Error("unsupported write payload");
    if (this.parent.corruptNextWrite || this.handle.copyCorrupts) {
      this.parent.corruptNextWrite = false;
      bytes = new Uint8Array([...bytes, 0x58]);
    }
    this.chunks.push(bytes);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    const total = this.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.handle._setBytes(bytes);
  }
  async abort() {
    this.closed = true;
  }
}

class FakeFileHandle {
  constructor(name, bytes, parent, lastModified = Date.now()) {
    this.kind = "file";
    this.name = name;
    this.parent = parent;
    this._file = new FakeFile(name, bytes, lastModified);
    this.moveMode = "ok";
    this.removeFails = false;
    this.copyCorrupts = false;
    this._moveCount = 0;
  }
  _setBytes(bytes) {
    this._file = new FakeFile(this.name, bytes, Date.now());
  }
  async getFile() {
    return this._file;
  }
  async createWritable() {
    return new FakeWritable(this, this.parent);
  }
  async move(destination, name = this.name) {
    this._moveCount += 1;
    if (this.moveMode === "fail") throw new DOMException("move unsupported", "InvalidStateError");
    if (this.moveMode === "fail-back" && this._moveCount > 1) {
      throw new DOMException("move back failed", "InvalidStateError");
    }
    this.parent.children.delete(this.name);
    const moved = new FakeFileHandle(name, this._file.bytes, destination, this._file.lastModified);
    moved.moveMode = this.moveMode;
    moved._moveCount = this._moveCount;
    if (this.moveMode === "corrupt" || (this.moveMode === "fail-back" && this._moveCount === 1)) {
      moved._setBytes(new Uint8Array([...this._file.bytes, 0x59]));
    }
    destination.children.set(name, moved);
  }
}

class FakeDirHandle {
  constructor(name, parent = null) {
    this.kind = "directory";
    this.name = name;
    this.parent = parent;
    this.children = new Map();
    this.corruptNextWrite = false;
    this.corruptCopyNames = parent?.corruptCopyNames ?? null;
    this.throwAfter = null;
    this.removeFails = false;
  }
  async getFileHandle(name, options = {}) {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== "file") throw typeMismatch();
      return existing;
    }
    if (!options.create) throw notFound();
    const handle = new FakeFileHandle(name, new Uint8Array(), this);
    handle.copyCorrupts = Boolean(this.corruptCopyNames?.test(name));
    this.children.set(name, handle);
    return handle;
  }
  async getDirectoryHandle(name, options = {}) {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== "directory") throw typeMismatch();
      return existing;
    }
    if (!options.create) throw notFound();
    const handle = new FakeDirHandle(name, this);
    this.children.set(name, handle);
    return handle;
  }
  async removeEntry(name, options = {}) {
    const child = this.children.get(name);
    if (!child) throw notFound();
    if (child.removeFails) throw new DOMException("remove denied", "NoModificationAllowedError");
    if (child.kind === "directory" && child.children.size > 0 && !options.recursive) {
      throw new DOMException("directory not empty", "InvalidModificationError");
    }
    this.children.delete(name);
  }
  async isSameEntry(other) { return other === this; }
  async *values() {
    let index = 0;
    for (const child of this.children.values()) {
      if (this.throwAfter !== null && index >= this.throwAfter) {
        throw new DOMException("permission lost", "NotAllowedError");
      }
      yield child;
      index += 1;
    }
  }
  async *keys() {
    for await (const child of this.values()) yield child.name;
  }
  async *entries() {
    for await (const child of this.values()) yield [child.name, child];
  }
  [Symbol.asyncIterator]() { return this.values(); }
  addFile(path, content, lastModified) {
    const parts = path.split("/");
    let dir = this;
    for (const part of parts.slice(0, -1)) {
      let next = dir.children.get(part);
      if (!next) {
        next = new FakeDirHandle(part, dir);
        dir.children.set(part, next);
      }
      dir = next;
    }
    const name = parts.at(-1);
    const handle = new FakeFileHandle(name, content, dir, lastModified);
    dir.children.set(name, handle);
    return handle;
  }
  addDir(path) {
    const parts = path.split("/");
    let dir = this;
    for (const part of parts) {
      let next = dir.children.get(part);
      if (!next) {
        next = new FakeDirHandle(part, dir);
        dir.children.set(part, next);
      }
      dir = next;
    }
    return dir;
  }
  file(path) {
    const parts = path.split("/");
    let dir = this;
    for (const part of parts.slice(0, -1)) dir = dir.children.get(part);
    return dir?.children.get(parts.at(-1)) ?? null;
  }
  has(path) {
    const parts = path.split("/");
    let dir = this;
    for (const part of parts.slice(0, -1)) {
      dir = dir.children.get(part);
      if (!dir) return false;
    }
    return dir.children.has(parts.at(-1));
  }
  setJson(path, value) {
    const handle = this.addFile(path, JSON.stringify(value, null, 2), Date.now());
    return handle;
  }
}

function qName(id, originalPath) {
  return `${id}__${encodeURIComponent(originalPath)}`;
}

try {
  const { runScan } = await server.ssrLoadModule("/src/fs/scan.worker.ts");
  const { judgeAll } = await server.ssrLoadModule("/src/safety/risk.ts");
  const { canQuarantineEntry, summarizeCoverage } = await server.ssrLoadModule("/src/safety/guard.ts");
  const {
    quarantineEntries, restoreEntries, listQuarantine, emptyQuarantine, deleteQuarantined,
  } = await server.ssrLoadModule("/src/fs/quarantine.ts");

  async function scan(rootHandle, overrides = {}) {
    const entries = [];
    let done;
    await runScan(
      rootHandle,
      {
        maxDepth: 8,
        maxEntries: 1000,
        skipDirs: [],
        collectSizes: true,
        ...overrides,
      },
      (message) => {
        if (message.type === "batch") entries.push(...message.entries);
        if (message.type === "done") done = message.progress;
      },
      () => false,
    );
    return { entries, progress: done };
  }

  function byPath(entries, path) {
    return entries.find((entry) => entry.path === path);
  }

  function judged(entries) {
    return judgeAll(entries, new Map());
  }

  // ---------- 扫描覆盖 ----------

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("Top/Deep/file.txt", "x");
    const { entries } = await scan(rootHandle, { maxDepth: 1 });
    const deep = byPath(entries, "Top/Deep");
    const top = byPath(entries, "Top");
    check("depth limit marks the cut directory", deep?.coverage?.includes("depth_limited"), deep?.coverage);
    check("depth limit propagates to ancestors", top?.coverage?.includes("depth_limited"), top?.coverage);
    const result = judged(entries);
    check("incomplete depth subtree cannot be quarantined", result.find((e) => e.path === "Top/Deep")?.locked === true,
      result.find((e) => e.path === "Top/Deep"));
    check("incomplete depth ancestor cannot be quarantined", result.find((e) => e.path === "Top")?.locked === true);
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("Parent/Keep/a.txt", "a");
    rootHandle.addFile("Parent/Skip/b.txt", "b");
    const { entries } = await scan(rootHandle, { skipDirs: ["Skip"] });
    const parent = byPath(entries, "Parent");
    check("skipDirs marks the containing directory", parent?.coverage?.includes("skipped_children"), parent?.coverage);
    check("skipDirs result is excluded from the scan", byPath(entries, "Parent/Skip") === undefined);
    const result = judged(entries);
    check("directory with skipped children is locked", result.find((e) => e.path === "Parent")?.locked === true);
    check("skipDirs blocks direct quarantine gate", canQuarantineEntry(result.find((e) => e.path === "Parent")).allowed === false);
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("A/1.txt", "1");
    rootHandle.addFile("A/2.txt", "2");
    rootHandle.addFile("A/3.txt", "3");
    const { entries, progress } = await scan(rootHandle, { maxEntries: 2 });
    const lit = entries.filter((entry) => entry.kind === "directory" && entry.coverage?.includes("entry_limited"));
    check("entry limit marks a truncated directory", lit.length > 0, { coverage: entries.map((e) => [e.path, e.coverage]) });
    check("entry limit reports truncated progress", progress?.truncated === true, progress);
    const result = judged(entries);
    check("entry-limited directories are locked", lit.every((entry) => result.find((e) => e.id === entry.id)?.locked === true));
  }

  {
    const rootHandle = new FakeDirHandle("root");
    const parent = rootHandle.addDir("Parent");
    parent.addFile("one.txt", "1");
    parent.addFile("two.txt", "2");
    parent.throwAfter = 1;
    const { entries } = await scan(rootHandle);
    const top = byPath(entries, "Parent");
    check("partial permission failure is reported", top?.coverage?.includes("permission_partial"), top?.coverage);
    check("permission partial directory is locked", judged(entries).find((e) => e.path === "Parent")?.locked === true);
    const summary = summarizeCoverage(entries);
    check("coverage summary distinguishes reasons", summary.permissionPartial >= 1, summary);
  }

  // ---------- 保守判定 ----------

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addDir("UnknownEmpty");
    rootHandle.addFile("logs/x.log", "x");
    rootHandle.addFile("tmp.tmp", "x");
    const { entries } = await scan(rootHandle);
    const result = judged(entries);
    const empty = result.find((e) => e.path === "UnknownEmpty");
    const logs = result.find((e) => e.path === "logs");
    const tmp = result.find((e) => e.path === "tmp.tmp");
    check("unknown empty directory is needs_review", empty?.verdict === "needs_review", empty);
    check("generic logs name cannot be safe_delete without a fingerprint", logs?.verdict === "needs_review", logs);
    check("junk extension cannot be safe_delete without a fingerprint", tmp?.verdict === "needs_review", tmp);
  }

  {
    const base = {
      id: "dir", path: "Cache", name: "Cache", kind: "directory", size: 10, fileCount: 1,
      lastModified: 1, depth: 0, isEmptyDir: false, parentId: null, childIds: [],
      coverage: ["complete"],
    };
    const hit = {
      fingerprintId: "cache", owner: "App", ownerKind: "app", purpose: "cache", verdict: "safe_delete",
      confidence: 0.95, rebuildable: true, reason: "reviewed rule", consequence: "rebuild", revival: [], evidence: [],
      source: "fingerprint",
    };
    const aiHit = { ...hit, source: "ai" };
    const fingerprint = judgeAll([{ ...base, id: "fp" }], new Map([["fp", hit]]))[0];
    const ai = judgeAll([{ ...base, id: "ai" }], new Map([["ai", aiHit]]))[0];
    check("reviewed fingerprint may recommend quarantine", fingerprint.verdict === "safe_delete", fingerprint.verdict);
    check("AI judgment cannot produce safe_delete", ai.verdict === "needs_review", ai.verdict);
  }

  // ---------- 核心门禁与快照 ----------

  async function singleFileEntry(handle = new FakeFileHandle("evil.txt", "hello", new FakeDirHandle("tmp"))) {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.children.set("evil.txt", handle);
    handle.parent = rootHandle;
    const { entries } = await scan(rootHandle);
    return { rootHandle, entry: judged(entries).find((e) => e.path === "evil.txt") };
  }

  {
    const { rootHandle, entry } = await singleFileEntry();
    const protectedEntry = { ...entry, verdict: "keep_locked", locked: true };
    await rejects("core layer rejects protected entries", () =>
      quarantineEntries(rootHandle, [protectedEntry]), (error) => /锁定|保留/.test(error.message));
    check("rejected core operation leaves the original untouched", rootHandle.has("evil.txt"));
  }

  {
    const { rootHandle, entry } = await singleFileEntry();
    const aiSafe = { ...entry, verdict: "safe_delete", source: "ai" };
    check("canQuarantine rejects AI safe_delete", canQuarantineEntry(aiSafe).allowed === false);
    await rejects("core layer rejects AI safe_delete", () => quarantineEntries(rootHandle, [aiSafe]));
    const noFingerprint = { ...entry, verdict: "safe_delete", source: "fingerprint", hit: null };
    check("canQuarantine rejects safe_delete without a reviewed fingerprint",
      canQuarantineEntry(noFingerprint).allowed === false);
    await rejects("core layer rejects safe_delete without a fingerprint", () =>
      quarantineEntries(rootHandle, [noFingerprint]));
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addDir("Parent");
    const { entries } = await scan(rootHandle, { maxDepth: 0 });
    const parent = judged(entries).find((e) => e.path === "Parent");
    check("maxDepth=0 leaves the directory incomplete", parent?.coverage?.includes("depth_limited"), parent?.coverage);
    await rejects("core layer rejects incomplete directory coverage", () => quarantineEntries(rootHandle, [parent]), (error) =>
      /扫描|覆盖|重新/.test(error.message));
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/file.txt", "original", 1000);
    const { entries } = await scan(rootHandle);
    const before = judged(entries).find((e) => e.path === "data/file.txt");
    const file = rootHandle.file("data/file.txt");
    file._file = new FakeFile("file.txt", "changed-and-longer", 2000);
    await rejects("changed size/mtime stops quarantine", () => quarantineEntries(rootHandle, [before]), (error) =>
      /变化|重新扫描|不一致/.test(error.message));
    check("changed source remains in place", rootHandle.file("data/file.txt")._file.text !== undefined
      && new TextDecoder().decode(rootHandle.file("data/file.txt")._file.bytes) === "changed-and-longer");
  }

  // ---------- 隔离成功/失败/校验 ----------

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/a.txt", "a", 1000);
    rootHandle.addFile("data/b.txt", "b", 1000);
    const { entries } = await scan(rootHandle);
    const result = judged(entries);
    rootHandle.file("data/a.txt")._file = new FakeFile("a.txt", "a-changed", 2000);
    await rejects("one changed target stops the whole batch", () => quarantineEntries(rootHandle, [
      result.find((e) => e.path === "data/a.txt"),
      result.find((e) => e.path === "data/b.txt"),
    ]));
    check("batch mismatch leaves every original in place", rootHandle.has("data/a.txt") && rootHandle.has("data/b.txt"));
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/file.txt", "keep me", 1000);
    const { entries } = await scan(rootHandle);
    const entry = judged(entries).find((e) => e.path === "data/file.txt");
    const outcome = await quarantineEntries(rootHandle, [entry]);
    const quarantine = rootHandle.children.get(".dareclean-quarantine");
    check("successful move is reported once as quarantined", outcome.created.length === 1
      && outcome.created[0].status === "quarantined", outcome);
    check("successful move is not mislabeled as a failed move-back",
      !outcome.created[0].note?.includes("移回失败"), outcome.created[0].note);
    check("successful move leaves the original absent and the copy present", !rootHandle.has("data/file.txt")
      && quarantine.children.size > 1);
    const restored = await restoreEntries(rootHandle, [outcome.created[0]], "skip");
    check("restore success reports restored", restored.restored.length === 1
      && rootHandle.has("data/file.txt"), restored);
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/file.txt", "copy fallback", 1000);
    rootHandle.file("data/file.txt").moveMode = "fail";
    const { entries } = await scan(rootHandle);
    const entry = judged(entries).find((e) => e.path === "data/file.txt");
    const outcome = await quarantineEntries(rootHandle, [entry]);
    check("move failure falls back to verified copy", outcome.created.length === 1
      && outcome.created[0].status === "quarantined" && outcome.created[0].note?.includes("降级"), outcome);
    check("copy fallback leaves exactly one copy in quarantine", !rootHandle.has("data/file.txt"));
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/file.txt", "bad copy", 1000);
    rootHandle.file("data/file.txt").moveMode = "fail";
    rootHandle.corruptCopyNames = /__/;
    const { entries } = await scan(rootHandle);
    const entry = judged(entries).find((e) => e.path === "data/file.txt");
    const outcome = await quarantineEntries(rootHandle, [entry]);
    const quarantine = rootHandle.children.get(".dareclean-quarantine");
    check("checksum mismatch fails quarantine", outcome.failures.length === 1 && outcome.created.length === 0, outcome);
    check("checksum failure keeps the complete original", rootHandle.has("data/file.txt"));
    check("checksum failure removes the bad copy only", quarantine && [...quarantine.children.keys()].every((name) =>
      name === "manifest.json" || name.includes(".md")));
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/file.txt", "moveback success", 1000);
    rootHandle.file("data/file.txt").moveMode = "corrupt";
    const { entries } = await scan(rootHandle);
    const entry = judged(entries).find((e) => e.path === "data/file.txt");
    const outcome = await quarantineEntries(rootHandle, [entry]);
    const quarantine = rootHandle.children.get(".dareclean-quarantine");
    check("successful move-back is reported accurately", outcome.failures.length === 1
      && outcome.failures[0].reason.includes("已移回原位置")
      && !outcome.failures[0].reason.includes("移回失败"), outcome);
    check("successful move-back leaves no quarantine copy", quarantine
      && ![...quarantine.children.keys()].some((name) => name.includes(encodeURIComponent("data/file.txt"))));
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/file.txt", "rollback", 1000);
    rootHandle.file("data/file.txt").moveMode = "fail-back";
    const { entries } = await scan(rootHandle);
    const entry = judged(entries).find((e) => e.path === "data/file.txt");
    const outcome = await quarantineEntries(rootHandle, [entry]);
    const quarantine = rootHandle.children.get(".dareclean-quarantine");
    check("failed move-back enters reconciliation", outcome.needsReconcile.length === 1
      && outcome.created.length === 0, outcome);
    check("failed move-back never deletes the only remaining copy", quarantine
      && [...quarantine.children.keys()].some((name) => name.includes(encodeURIComponent("data/file.txt"))), outcome);
    const listed = await listQuarantine(rootHandle);
    check("failed move-back is visible as needs_reconcile", listed.some((record) => record.status === "needs_reconcile"), listed);
  }

  // ---------- 还原冲突与失败 ----------

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/file.txt", "quarantined", 1000);
    const { entries } = await scan(rootHandle);
    const entry = judged(entries).find((e) => e.path === "data/file.txt");
    const outcome = await quarantineEntries(rootHandle, [entry]);
    rootHandle.addFile("data/file.txt", "new content", 2000);
    const kept = await restoreEntries(rootHandle, [outcome.created[0]], "keep-both");
    check("keep-both never overwrites the current file",
      new TextDecoder().decode(rootHandle.file("data/file.txt")._file.bytes) === "new content");
    check("keep-both restores a separate copy", kept.restored.length === 1 && [...rootHandle.children.get("data").children.keys()]
      .some((name) => name.includes("还原副本")), kept);
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/file.txt", "quarantined", 1000);
    const { entries } = await scan(rootHandle);
    const entry = judged(entries).find((e) => e.path === "data/file.txt");
    const outcome = await quarantineEntries(rootHandle, [entry]);
    rootHandle.addFile("data/file.txt", "existing", 2000);
    const skipped = await restoreEntries(rootHandle, [outcome.created[0]], "skip");
    check("skip keeps the quarantine copy", skipped.failures.length === 1
      && [...rootHandle.children.get(".dareclean-quarantine").children.keys()]
        .some((name) => name.includes("__")), skipped);
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/file.txt", "conflict", 1000);
    const { entries } = await scan(rootHandle);
    const entry = judged(entries).find((e) => e.path === "data/file.txt");
    const outcome = await quarantineEntries(rootHandle, [entry]);
    rootHandle.addFile("data/file.txt", "existing", 2000);
    await rejects("replace policy is unavailable", () => restoreEntries(rootHandle, [outcome.created[0]], "replace"), (error) =>
      /replace|替换|策略/.test(error.message));
    check("rejected replace leaves both copies intact", rootHandle.has("data/file.txt")
      && rootHandle.children.get(".dareclean-quarantine").children.size > 1);
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/file.txt", "restore copy", 1000);
    const { entries } = await scan(rootHandle);
    const entry = judged(entries).find((e) => e.path === "data/file.txt");
    const outcome = await quarantineEntries(rootHandle, [entry]);
    const quarantine = rootHandle.children.get(".dareclean-quarantine");
    const qFile = [...quarantine.children.values()].find((child) => child.kind === "file" && child.name.includes("__"));
    qFile.moveMode = "fail";
    qFile.removeFails = true;
    const restored = await restoreEntries(rootHandle, [outcome.created[0]], "skip");
    check("failed source removal enters reconciliation", restored.needsReconcile.length === 1, restored);
    check("failed restore preserves the verified restored copy", rootHandle.has("data/file.txt"));
    check("failed restore preserves the quarantine copy", qFile.parent === quarantine);
  }

  // ---------- 删除：内容与审计分离 ----------

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/file.txt", "restored content", 1000);
    const { entries } = await scan(rootHandle);
    const entry = judged(entries).find((e) => e.path === "data/file.txt");
    const outcome = await quarantineEntries(rootHandle, [entry]);
    await restoreEntries(rootHandle, [outcome.created[0]], "skip");
    const quarantine = rootHandle.children.get(".dareclean-quarantine");
    quarantine.addFile("运维手册.md", "操作记录：原文件已还原\n");
    const restored = (await listQuarantine(rootHandle)).find((record) => record.id === outcome.created[0].id);
    const result = await deleteQuarantined(rootHandle, restored);
    check("deleting a restored record reports audit-only", result === "audit", result);
    check("audit-only deletion keeps the restored original",
      new TextDecoder().decode(rootHandle.file("data/file.txt")._file.bytes) === "restored content");
    check("audit-only deletion keeps the audit markdown",
      new TextDecoder().decode(quarantine.file("运维手册.md")._file.bytes).includes("原文件已还原"));
    check("audit-only deletion removes only the manifest row", !(await listQuarantine(rootHandle))
      .some((record) => record.id === outcome.created[0].id));
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("data/file.txt", "quarantined content", 1000);
    const { entries } = await scan(rootHandle);
    const entry = judged(entries).find((e) => e.path === "data/file.txt");
    const outcome = await quarantineEntries(rootHandle, [entry]);
    const quarantine = rootHandle.children.get(".dareclean-quarantine");
    quarantine.addFile("文件夹名录.md", "恢复说明：审计历史\n");
    const result = await deleteQuarantined(rootHandle, outcome.created[0]);
    check("deleting quarantined content reports content deletion", result === "content", result);
    check("content deletion leaves no quarantine copy", ![...quarantine.children.keys()]
      .some((name) => name.includes(encodeURIComponent("data/file.txt"))));
    check("content deletion keeps audit markdown", quarantine.has("文件夹名录.md"));
  }

  // ---------- 启动对账 ----------

  {
    const rootHandle = new FakeDirHandle("root");
    const quarantine = rootHandle.addDir(".dareclean-quarantine");
    quarantine.addFile(qName("crash", "App/data.bin"), "partial");
    quarantine.setJson("manifest.json", [{
      id: "crash", originalPath: "App/data.bin", quarantinePath: `.dareclean-quarantine/${qName("crash", "App/data.bin")}`,
      size: 7, kind: "file", quarantinedAt: 1, expiresAt: Date.now() + 1000, owner: "App", reason: "test",
      restored: false, modifiedAt: 1, checksum: "", checksumAlgo: "none", status: "processing", updatedAt: 1,
    }]);
    const listed = await listQuarantine(rootHandle);
    check("processing record becomes needs_reconcile after crash", listed.some((record) =>
      record.id === "crash" && record.status === "needs_reconcile"), listed);
    check("reconciliation does not delete the copy", quarantine.has(qName("crash", "App/data.bin")));
    await rejects("restore refuses unreconciled records", () => restoreEntries(rootHandle, [listed.find((r) => r.id === "crash")]), (error) =>
      /恢复检查|reconcile/.test(error.message));
    await rejects("empty quarantine refuses unreconciled records", () => emptyQuarantine(rootHandle), (error) =>
      /恢复检查|阻止清空/.test(error.message));
    check("blocked empty operation preserves the uncertain copy", quarantine.has(qName("crash", "App/data.bin")));
  }

  {
    const rootHandle = new FakeDirHandle("root");
    rootHandle.addFile("App/existing.bin", "original");
    const quarantine = rootHandle.addDir(".dareclean-quarantine");
    quarantine.setJson("manifest.json", [{
      id: "ghost", originalPath: "App/ghost.bin", quarantinePath: `.dareclean-quarantine/${qName("ghost", "App/ghost.bin")}`,
      size: 1, kind: "file", quarantinedAt: 1, expiresAt: Date.now() + 1000, owner: "App", reason: "test",
      restored: false, modifiedAt: 1, checksum: "", checksumAlgo: "none", status: "quarantined", updatedAt: 1,
    }]);
    const listed = await listQuarantine(rootHandle);
    check("ghost record is marked for recovery", listed.find((record) => record.id === "ghost")?.status === "needs_reconcile", listed);
    check("ghost reconciliation leaves unrelated originals untouched", rootHandle.has("App/existing.bin"));
  }

  {
    const rootHandle = new FakeDirHandle("root");
    const quarantine = rootHandle.addDir(".dareclean-quarantine");
    quarantine.addFile(qName("orphan", "Lost/file.bin"), "orphan data");
    quarantine.addFile("manifest.json", "{ definitely not json");
    const listed = await listQuarantine(rootHandle);
    check("corrupt manifest is preserved as a timestamped backup", [...quarantine.children.keys()]
      .some((name) => name.startsWith("manifest.corrupt-")));
    check("no-record copy becomes needs_reconcile, not a deletion", listed.some((record) =>
      record.status === "needs_reconcile" && record.originalPath === "Lost/file.bin"), listed);
    check("orphan copy remains untouched", quarantine.has(qName("orphan", "Lost/file.bin")));
  }

  {
    const rootHandle = new FakeDirHandle("root");
    const quarantine = rootHandle.addDir(".dareclean-quarantine");
    quarantine.addFile(qName("valid", "Good/file.bin"), "good");
    quarantine.setJson("manifest.json", [
      {
        id: "valid", originalPath: "Good/file.bin", quarantinePath: `.dareclean-quarantine/${qName("valid", "Good/file.bin")}`,
        size: 4, kind: "file", quarantinedAt: 1, expiresAt: Date.now() + 1000, owner: "Good", reason: "test",
        restored: false, modifiedAt: 1, checksum: "", checksumAlgo: "none", status: "quarantined", updatedAt: 1,
      },
      { id: "bad", originalPath: "Broken/path", status: "quarantined" },
    ]);
    const listed = await listQuarantine(rootHandle);
    check("invalid manifest entries are preserved as recovery records", listed.some((record) =>
      record.status === "needs_reconcile" && record.id === "bad"), listed);
    check("invalid manifest entries leave a raw sidecar", [...quarantine.children.keys()]
      .some((name) => name.startsWith("manifest-invalid-")));
    check("valid records survive partial manifest damage", listed.some((record) =>
      record.id === "valid" && record.status === "quarantined"), listed);
  }
} finally {
  await server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
