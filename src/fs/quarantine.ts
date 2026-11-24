import { QUARANTINE_DIR, QUARANTINE_TTL_DAYS } from "../core/constants";
import type {
  EntryKind,
  JudgedEntry,
  QuarantineFailure,
  QuarantineOutcome,
  QuarantineRecord,
  QuarantineStatus,
  RestoreOutcome,
  RestorePolicy,
} from "../core/types";
import {
  copyDirectoryContents,
  ensureDirectoryPath,
  ensureQuarantineDir,
  entryExists,
  errorMessage,
  isNotFoundError,
  resolveHandle,
} from "./adapter";
import { JOURNAL_NAMES } from "./journal";

const MANIFEST_NAME = "manifest.json";
const DAY_MS = 24 * 60 * 60 * 1000;
/** 超过该体积的文件改用首尾采样哈希，避免整文件读入内存 */
const FULL_HASH_LIMIT = 32 * 1024 * 1024;
const SAMPLE_BYTES = 1024 * 1024;

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function quarantineName(id: string, originalPath: string): string {
  // 编码完整原路径进单段文件名，manifest 损坏时也能无损还原
  return `${id}__${encodeURIComponent(originalPath)}`;
}

function parseQuarantineName(name: string): { id: string; originalPath: string } | null {
  const sep = name.indexOf("__");
  if (sep <= 0) return null;
  try {
    return { id: name.slice(0, sep), originalPath: decodeURIComponent(name.slice(sep + 2)) };
  } catch {
    return null;
  }
}

function isValidRecord(value: unknown): value is QuarantineRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.originalPath === "string" &&
    typeof r.quarantinePath === "string" &&
    typeof r.size === "number" &&
    (r.kind === "file" || r.kind === "directory") &&
    typeof r.quarantinedAt === "number" &&
    typeof r.expiresAt === "number" &&
    typeof r.owner === "string" &&
    typeof r.reason === "string" &&
    typeof r.restored === "boolean"
  );
}

const STATUSES: QuarantineStatus[] = [
  "processing", "quarantined", "quarantine_failed", "restored", "restore_failed",
];

/** 旧版清单没有状态/校验字段：按已有信息补齐，不丢记录 */
function normalizeRecord(r: QuarantineRecord): QuarantineRecord {
  const status = STATUSES.includes(r.status) ? r.status : (r.restored ? "restored" : "quarantined");
  return {
    ...r,
    status,
    restored: status === "restored",
    modifiedAt: typeof r.modifiedAt === "number" ? r.modifiedAt : 0,
    checksum: typeof r.checksum === "string" ? r.checksum : "",
    checksumAlgo: r.checksumAlgo ?? "none",
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : r.quarantinedAt,
  };
}

async function rebuildManifest(qDir: FileSystemDirectoryHandle): Promise<QuarantineRecord[]> {
  const records: QuarantineRecord[] = [];
  const now = Date.now();
  for await (const handle of qDir.values()) {
    if (handle.name === MANIFEST_NAME || JOURNAL_NAMES.includes(handle.name)) continue;
    const parsed = parseQuarantineName(handle.name);
    records.push(normalizeRecord({
      id: parsed?.id ?? makeId(),
      originalPath: parsed?.originalPath ?? handle.name,
      quarantinePath: `${QUARANTINE_DIR}/${handle.name}`,
      size: 0,
      kind: handle.kind as EntryKind,
      quarantinedAt: now,
      expiresAt: now + QUARANTINE_TTL_DAYS * DAY_MS,
      owner: "unknown",
      reason: "manifest 损坏，已按隔离区实际内容重建（体积未知，按重建时间重新计期）",
      restored: false,
      modifiedAt: 0,
      checksum: "",
      checksumAlgo: "none",
      status: "quarantined",
      updatedAt: now,
    }));
  }
  await writeManifest(qDir, records);
  return records;
}

async function readManifest(qDir: FileSystemDirectoryHandle): Promise<QuarantineRecord[]> {
  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await qDir.getFileHandle(MANIFEST_NAME);
  } catch (err) {
    if (isNotFoundError(err)) return [];
    throw new Error(`读取隔离清单失败: ${errorMessage(err)}`, { cause: err });
  }
  const text = await (await fileHandle.getFile()).text();
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter(isValidRecord).map(normalizeRecord);
  } catch {
    // 损坏时按目录实际内容重建
  }
  return rebuildManifest(qDir);
}

async function writeManifest(qDir: FileSystemDirectoryHandle, records: QuarantineRecord[]): Promise<void> {
  const fileHandle = await qDir.getFileHandle(MANIFEST_NAME, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(JSON.stringify(records, null, 2));
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      // abort 失败不掩盖原始错误
    }
    throw new Error(`写入隔离清单失败: ${errorMessage(err)}`, { cause: err });
  }
}

function relativeToQuarantine(record: QuarantineRecord): string {
  const prefix = `${QUARANTINE_DIR}/`;
  if (!record.quarantinePath.startsWith(prefix)) {
    throw new Error(`隔离记录路径非法: ${record.quarantinePath}`);
  }
  return record.quarantinePath.slice(prefix.length);
}

// ---------- 校验 ----------

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface FileChecksum {
  checksum: string;
  algo: "sha256" | "sha256-sample";
}

async function hashFile(handle: FileSystemFileHandle): Promise<FileChecksum> {
  const file = await handle.getFile();
  if (file.size <= FULL_HASH_LIMIT) {
    return { checksum: await sha256Hex(await file.arrayBuffer()), algo: "sha256" };
  }
  const head = await file.slice(0, SAMPLE_BYTES).arrayBuffer();
  const tail = await file.slice(Math.max(0, file.size - SAMPLE_BYTES)).arrayBuffer();
  const merged = new Uint8Array(head.byteLength + tail.byteLength + 8);
  merged.set(new Uint8Array(head), 0);
  merged.set(new Uint8Array(tail), head.byteLength);
  new DataView(merged.buffer).setFloat64(head.byteLength + tail.byteLength, file.size);
  return { checksum: await sha256Hex(merged.buffer), algo: "sha256-sample" };
}

interface TreeListing {
  lines: string[];
  dirCount: number;
  bytes: number;
}

async function walkTree(dir: FileSystemDirectoryHandle, prefix = ""): Promise<TreeListing> {
  const out: TreeListing = { lines: [], dirCount: 0, bytes: 0 };
  for await (const handle of dir.values()) {
    const rel = prefix ? `${prefix}/${handle.name}` : handle.name;
    if (handle.kind === "file") {
      const size = (await (handle as FileSystemFileHandle).getFile()).size;
      out.lines.push(`${rel}\t${size}`);
      out.bytes += size;
    } else {
      out.dirCount += 1;
      const sub = await walkTree(handle as FileSystemDirectoryHandle, rel);
      out.lines.push(...sub.lines);
      out.dirCount += sub.dirCount;
      out.bytes += sub.bytes;
    }
  }
  out.lines.sort();
  return out;
}

async function treeChecksum(dir: FileSystemDirectoryHandle): Promise<string> {
  const listing = await walkTree(dir);
  const text = `dirs=${listing.dirCount}\n${listing.lines.join("\n")}`;
  return sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

/** 复制单个文件并逐字节校验：校验不过就删掉副本，原文件不动 */
async function copyFileVerified(
  src: FileSystemFileHandle,
  destParent: FileSystemDirectoryHandle,
  destName: string,
): Promise<FileChecksum> {
  const expected = await hashFile(src);
  const file = await src.getFile();
  const out = await destParent.getFileHandle(destName, { create: true });
  const writable = await out.createWritable();
  try {
    await writable.write(file);
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      // 同上
    }
    await destParent.removeEntry(destName).catch(() => undefined);
    throw new Error(`复制文件失败（原文件未动）: ${errorMessage(err)}`, { cause: err });
  }
  const copied = await destParent.getFileHandle(destName);
  const actual = await hashFile(copied);
  if (actual.checksum !== expected.checksum || actual.algo !== expected.algo) {
    await destParent.removeEntry(destName).catch(() => undefined);
    throw new Error("复制后校验不一致，已删除副本，原文件保留");
  }
  return actual;
}

function moveSupported(handle: FileSystemFileHandle): boolean {
  return typeof (handle as { move?: unknown }).move === "function";
}

interface TransferResult extends FileChecksum {
  /** move = 浏览器原生移动；copy = 复制校验后移除原文件（降级路径） */
  mode: "move" | "copy";
  note?: string;
}

/**
 * 文件转移：优先原生 move（原子），不支持或失败时降级为「复制→校验→删原」。
 * 任何一步失败都保证原文件仍在原位置。
 */
async function transferFile(
  src: FileSystemFileHandle,
  srcParent: FileSystemDirectoryHandle,
  srcName: string,
  destParent: FileSystemDirectoryHandle,
  destName: string,
): Promise<TransferResult> {
  const expected = await hashFile(src);
  if (moveSupported(src)) {
    let moved = false;
    try {
      await src.move(destParent, destName);
      moved = true;
    } catch (err) {
      // move 不可用或中途失败：回到复制校验路径，原文件此时仍在原处
      await destParent.removeEntry(destName).catch(() => undefined);
      const copied = await copyFileVerified(src, destParent, destName);
      await srcParent.removeEntry(srcName);
      return {
        ...copied,
        mode: "copy",
        note: `浏览器移动能力不可用（${errorMessage(err)}），已降级为复制校验后移除原文件`,
      };
    }
    if (moved) {
      const handle = await destParent.getFileHandle(destName);
      const actual = await hashFile(handle);
      if (actual.checksum !== expected.checksum) {
        // 校验不过就把内容移回原位置，绝不留下「原处没了、副本又坏」的状态
        try {
          await handle.move(srcParent, srcName);
          throw new Error("移动后校验不一致，已移回原位置");
        } catch (backErr) {
          throw new Error(
            `移动后校验不一致且移回失败：${errorMessage(backErr)}；内容保留在目标位置 ${destName}`,
          );
        }
      }
      return { ...actual, mode: "move" };
    }
  }
  const copied = await copyFileVerified(src, destParent, destName);
  await srcParent.removeEntry(srcName);
  return { ...copied, mode: "copy", note: "当前浏览器不支持文件移动，已使用复制校验后移除原文件" };
}

async function copyThenRemoveDirectory(
  src: FileSystemDirectoryHandle,
  srcParent: FileSystemDirectoryHandle,
  srcName: string,
  destParent: FileSystemDirectoryHandle,
  destName: string,
): Promise<{ checksum: string; bytes: number }> {
  const expected = await treeChecksum(src);
  const target = await destParent.getDirectoryHandle(destName, { create: true });
  try {
    await copyDirectoryContents(src, target);
    const actual = await treeChecksum(target);
    if (actual !== expected) throw new Error("复制后目录结构校验不一致");
  } catch (err) {
    await destParent.removeEntry(destName, { recursive: true }).catch(() => undefined);
    throw new Error(`复制目录失败（原目录未动）: ${errorMessage(err)}`, { cause: err });
  }
  const bytes = (await walkTree(target)).bytes;
  try {
    // 目录句柄没有 move()，只能复制成功后再删原处（已实测约束）
    await srcParent.removeEntry(srcName, { recursive: true });
  } catch (err) {
    await destParent.removeEntry(destName, { recursive: true }).catch(() => undefined);
    throw new Error(`删除原目录失败（已回滚副本）: ${errorMessage(err)}`, { cause: err });
  }
  return { checksum: expected, bytes };
}

// ---------- 空间检查 ----------

export interface SpaceCheck {
  /** 是否真的拿到了可用空间（仅沙箱 OPFS 可查） */
  checked: boolean;
  freeBytes: number | null;
}

/**
 * 隔离前空间检查。沙箱（OPFS）可用 navigator.storage.estimate 精确预检；
 * 真实磁盘浏览器没有剩余空间 API，不假装能查——靠「先复制校验、后删原」兜底，
 * 空间不足时复制会失败且原文件保留。
 */
export async function checkQuarantineSpace(
  root: FileSystemDirectoryHandle,
  neededBytes: number,
): Promise<SpaceCheck> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory || !navigator.storage.estimate) {
    return { checked: false, freeBytes: null };
  }
  let isSandbox = false;
  try {
    const opfs = await navigator.storage.getDirectory();
    const sandbox = await opfs.getDirectoryHandle("dareclean");
    isSandbox = await sandbox.isSameEntry(root);
  } catch {
    return { checked: false, freeBytes: null };
  }
  if (!isSandbox) return { checked: false, freeBytes: null };
  const { quota = 0, usage = 0 } = await navigator.storage.estimate();
  const free = Math.max(0, quota - usage);
  if (neededBytes > free) {
    throw new Error(
      `空间不足：本次需隔离 ${(neededBytes / 1048576).toFixed(1)} MB，沙箱剩余约 ${(free / 1048576).toFixed(1)} MB。已禁止开始，请先清理或还原部分内容。`,
    );
  }
  return { checked: true, freeBytes: free };
}

// ---------- 隔离 ----------

async function quarantineOne(
  root: FileSystemDirectoryHandle,
  qDir: FileSystemDirectoryHandle,
  entry: JudgedEntry,
  ttlDays: number,
  id: string,
): Promise<QuarantineRecord> {
  const parts = entry.path.split("/").filter((s) => s.length > 0);
  if (parts.length === 0) throw new Error("不能隔离根目录");
  const name = parts[parts.length - 1];
  const parentPath = parts.slice(0, -1).join("/");
  const parent = parentPath ? ((await resolveHandle(root, parentPath)) as FileSystemDirectoryHandle) : root;
  const src = await resolveHandle(root, entry.path);

  const qName = quarantineName(id, entry.path);
  const now = Date.now();
  const record: QuarantineRecord = {
    id,
    originalPath: entry.path,
    quarantinePath: `${QUARANTINE_DIR}/${qName}`,
    size: entry.size,
    kind: entry.kind,
    quarantinedAt: now,
    expiresAt: now + ttlDays * DAY_MS,
    owner: entry.hit?.owner ?? "unknown",
    reason: entry.hit?.reason ?? (entry.isEmptyDir ? "空文件夹" : "用户确认隔离"),
    restored: false,
    modifiedAt: entry.lastModified,
    checksum: "",
    checksumAlgo: "none",
    status: "processing",
    updatedAt: now,
  };

  if (src.kind === "file") {
    const result = await transferFile(src as FileSystemFileHandle, parent, name, qDir, qName);
    record.checksum = result.checksum;
    record.checksumAlgo = result.algo;
    if (result.note) record.note = result.note;
  } else {
    const result = await copyThenRemoveDirectory(src as FileSystemDirectoryHandle, parent, name, qDir, qName);
    record.checksum = result.checksum;
    record.checksumAlgo = "tree-sha256";
    record.size = result.bytes;
  }
  record.status = "quarantined";
  record.updatedAt = Date.now();
  return record;
}

export async function quarantineEntries(
  root: FileSystemDirectoryHandle,
  entries: JudgedEntry[],
  ttlDays: number = QUARANTINE_TTL_DAYS,
  onSkip?: (skip: QuarantineFailure) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<QuarantineOutcome> {
  const qDir = await ensureQuarantineDir(root);
  const manifest = await readManifest(qDir);
  const created: QuarantineRecord[] = [];
  const skipped: QuarantineFailure[] = [];
  const failures: QuarantineFailure[] = [];
  const selected = new Set(entries.map((e) => e.path));

  const targets = entries.filter((entry) => {
    if (entry.path === QUARANTINE_DIR || entry.path.startsWith(`${QUARANTINE_DIR}/`)) return false;
    // 祖先目录已被选中时跳过子项，避免对已移走的路径二次操作
    for (const p of selected) {
      if (p !== entry.path && entry.path.startsWith(`${p}/`)) return false;
    }
    // 隔离失败的记录原文件仍在原位置，允许重试；其余未还原记录说明内容已在隔离区
    if (manifest.some((r) => r.originalPath === entry.path && !r.restored && r.status !== "quarantine_failed")) {
      // 原位置又出现了同名内容（例如样本被重建过）：不能静默丢弃，必须让调用方告诉用户
      const skip = { path: entry.path, reason: "该路径已有未还原的隔离记录" };
      skipped.push(skip);
      onSkip?.(skip);
      return false;
    }
    return true;
  });

  // 空间预检必须在任何搬动之前：不足时直接禁止开始
  await checkQuarantineSpace(root, targets.reduce((sum, e) => sum + e.size, 0));

  let done = 0;
  for (const entry of targets) {
    const id = makeId();
    const now = Date.now();
    // 先落「处理中」清单行：中途崩溃也能看到这条操作曾经开始过
    const record: QuarantineRecord = {
      id,
      originalPath: entry.path,
      quarantinePath: `${QUARANTINE_DIR}/${quarantineName(id, entry.path)}`,
      size: entry.size,
      kind: entry.kind,
      quarantinedAt: now,
      expiresAt: now + ttlDays * DAY_MS,
      owner: entry.hit?.owner ?? "unknown",
      reason: entry.hit?.reason ?? (entry.isEmptyDir ? "空文件夹" : "用户确认隔离"),
      restored: false,
      modifiedAt: entry.lastModified,
      checksum: "",
      checksumAlgo: "none",
      status: "processing",
      updatedAt: now,
    };
    manifest.push(record);
    await writeManifest(qDir, manifest);
    try {
      const finished = await quarantineOne(root, qDir, entry, ttlDays, record.id);
      Object.assign(record, finished);
      created.push(record);
    } catch (err) {
      record.status = "quarantine_failed";
      record.note = errorMessage(err);
      record.updatedAt = Date.now();
      failures.push({ path: entry.path, reason: record.note });
      // 隔离失败时原文件必须仍在原位置：若副本已产生则清掉，避免留半成品
      await qDir.removeEntry(quarantineName(record.id, entry.path), { recursive: true }).catch(() => undefined);
    }
    await writeManifest(qDir, manifest);
    done += 1;
    onProgress?.(done, targets.length);
  }

  return { created, skipped, failures };
}

export async function listQuarantine(root: FileSystemDirectoryHandle): Promise<QuarantineRecord[]> {
  const qDir = await ensureQuarantineDir(root);
  return readManifest(qDir);
}

// ---------- 还原 ----------

/** 还原前探测同名冲突：返回原位置已存在内容的记录 */
export async function restoreConflicts(
  root: FileSystemDirectoryHandle,
  records: QuarantineRecord[],
): Promise<QuarantineRecord[]> {
  const conflicts: QuarantineRecord[] = [];
  for (const record of records) {
    if (record.restored) continue;
    const parts = record.originalPath.split("/").filter((s) => s.length > 0);
    if (parts.length === 0) continue;
    try {
      const parent = await ensureDirectoryPath(root, parts.slice(0, -1).join("/"));
      if (await entryExists(parent, parts[parts.length - 1])) conflicts.push(record);
    } catch {
      // 探测失败不算冲突，交给还原流程报真实错误
    }
  }
  return conflicts;
}

async function uniqueRestoreName(parent: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? `${base}（还原副本）${ext}` : `${base}（还原副本 ${i}）${ext}`;
    if (!(await entryExists(parent, candidate))) return candidate;
  }
  throw new Error("无法为「保留两份」找到不重名的文件名");
}

export async function restoreEntries(
  root: FileSystemDirectoryHandle,
  records: QuarantineRecord[],
  policy: RestorePolicy = "skip",
  onProgress?: (done: number, total: number) => void,
): Promise<RestoreOutcome> {
  const qDir = await ensureQuarantineDir(root);
  const manifest = await readManifest(qDir);
  const restored: QuarantineRecord[] = [];
  const failures: QuarantineFailure[] = [];
  let done = 0;

  for (const record of records) {
    const stored = manifest.find((r) => r.id === record.id);
    if (!stored || stored.restored) { done += 1; onProgress?.(done, records.length); continue; }
    stored.status = "processing";
    stored.updatedAt = Date.now();
    await writeManifest(qDir, manifest);
    try {
      const qName = relativeToQuarantine(stored);
      const src = await resolveHandle(qDir, qName);
      const parts = stored.originalPath.split("/").filter((s) => s.length > 0);
      if (parts.length === 0) throw new Error(`记录的原路径非法: ${stored.originalPath}`);
      let name = parts[parts.length - 1];
      const parent = await ensureDirectoryPath(root, parts.slice(0, -1).join("/"));
      const notes: string[] = stored.note ? [stored.note] : [];
      if (await entryExists(parent, name)) {
        if (policy === "skip") {
          stored.status = "quarantined";
          stored.updatedAt = Date.now();
          stored.note = "还原跳过：原位置已有同名内容，隔离副本保留";
          await writeManifest(qDir, manifest);
          failures.push({ path: stored.originalPath, reason: stored.note });
          done += 1;
          onProgress?.(done, records.length);
          continue;
        }
        if (policy === "keep-both") {
          name = await uniqueRestoreName(parent, name);
          notes.push(`原位置已有同名内容，按「保留两份」还原为 ${name}`);
        } else {
          await parent.removeEntry(name, { recursive: true });
          notes.push("按「替换」移除了原位置的同名内容");
        }
      }
      if (src.kind === "file") {
        const result = await transferFile(src as FileSystemFileHandle, qDir, qName, parent, name);
        if (stored.checksum && result.checksum !== stored.checksum) {
          throw new Error("还原后校验值与隔离时记录不一致");
        }
        if (result.note) notes.push(result.note);
      } else {
        const result = await copyThenRemoveDirectory(src as FileSystemDirectoryHandle, qDir, qName, parent, name);
        if (stored.checksum && result.checksum !== stored.checksum) {
          throw new Error("还原后目录结构校验与隔离时记录不一致");
        }
      }
      stored.status = "restored";
      stored.restored = true;
      stored.updatedAt = Date.now();
      stored.note = notes.join("；") || undefined;
      await writeManifest(qDir, manifest);
      restored.push(stored);
    } catch (err) {
      stored.status = "restore_failed";
      stored.note = errorMessage(err);
      stored.updatedAt = Date.now();
      await writeManifest(qDir, manifest);
      failures.push({ path: record.originalPath, reason: stored.note });
    }
    done += 1;
    onProgress?.(done, records.length);
  }

  return { restored, failures };
}

export async function purgeExpired(root: FileSystemDirectoryHandle, records: QuarantineRecord[]): Promise<QuarantineRecord[]> {
  const qDir = await ensureQuarantineDir(root);
  const manifest = await readManifest(qDir);
  const candidates = new Set(records.map((r) => r.id));
  const now = Date.now();
  const keep: QuarantineRecord[] = [];
  const errors: string[] = [];
  let changed = false;

  for (const record of manifest) {
    if (!record.restored && record.expiresAt <= now && candidates.has(record.id)) {
      try {
        await qDir.removeEntry(relativeToQuarantine(record), { recursive: true });
      } catch (err) {
        if (!isNotFoundError(err)) {
          errors.push(`${record.originalPath}: ${errorMessage(err)}`);
          keep.push(record);
          continue;
        }
      }
      changed = true;
    } else {
      keep.push(record);
    }
  }

  if (changed) await writeManifest(qDir, keep);
  if (errors.length > 0) {
    throw new Error(`部分过期条目清理失败:\n${errors.join("\n")}`);
  }
  return keep;
}

export async function deleteQuarantined(root: FileSystemDirectoryHandle, record: QuarantineRecord): Promise<void> {
  const qDir = await ensureQuarantineDir(root);
  const manifest = await readManifest(qDir);
  const stored = manifest.find((r) => r.id === record.id);
  if (!stored) return;
  await qDir.removeEntry(relativeToQuarantine(stored), { recursive: true }).catch((err) => {
    if (!isNotFoundError(err)) throw new Error(`删除隔离内容失败: ${errorMessage(err)}`, { cause: err });
  });
  // 彻底删除后必须同时移除清单行，否则会留下一条内容已不存在的幽灵记录
  await writeManifest(qDir, manifest.filter((r) => r.id !== stored.id));
}

export async function emptyQuarantine(root: FileSystemDirectoryHandle): Promise<void> {
  const qDir = await ensureQuarantineDir(root);
  const names: string[] = [];
  for await (const name of qDir.keys()) names.push(name);
  for (const name of names) {
    // 运维手册与文件夹名录是审计历史，清空隔离区时必须保留
    if (JOURNAL_NAMES.includes(name)) continue;
    try {
      await qDir.removeEntry(name, { recursive: true });
    } catch (err) {
      if (!isNotFoundError(err)) {
        throw new Error(`清空隔离区失败（${name}）: ${errorMessage(err)}`, { cause: err });
      }
    }
  }
  await writeManifest(qDir, []);
}