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
import { canQuarantineEntry } from "../safety/guard";
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

class SnapshotMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotMismatchError";
  }
}

class TransferSafetyError extends Error {
  keepDestination: boolean;
  constructor(message: string, keepDestination: boolean) {
    super(message);
    this.name = "TransferSafetyError";
    this.keepDestination = keepDestination;
  }
}

class IntegrityMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrityMismatchError";
  }
}

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
  "processing", "quarantined", "quarantine_failed", "restored", "restore_failed", "needs_reconcile",
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

function isReservedQuarantineName(name: string): boolean {
  return name === MANIFEST_NAME
    || JOURNAL_NAMES.includes(name)
    || name.startsWith("manifest.corrupt-")
    || name.startsWith("manifest-invalid-");
}

async function writeTextHandle(
  parent: FileSystemDirectoryHandle,
  name: string,
  text: string,
): Promise<void> {
  const fileHandle = await parent.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      // abort 失败不掩盖原始错误
    }
    throw err;
  }
}

async function pathState(root: FileSystemDirectoryHandle, path: string): Promise<"present" | "absent" | "unknown"> {
  const parts = path.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.length === 0 || parts.includes("..")) return "unknown";
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    try {
      dir = await dir.getDirectoryHandle(part);
    } catch (err) {
      if (isNotFoundError(err)) return "absent";
      return "unknown";
    }
  }
  const name = parts[parts.length - 1];
  try {
    await dir.getFileHandle(name);
    return "present";
  } catch (err) {
    if (!isNotFoundError(err) && !(err instanceof DOMException && err.name === "TypeMismatchError")) {
      return "unknown";
    }
  }
  try {
    await dir.getDirectoryHandle(name);
    return "present";
  } catch (err) {
    if (isNotFoundError(err)) return "absent";
    return "unknown";
  }
}

async function actualQuarantineEntries(qDir: FileSystemDirectoryHandle): Promise<Map<string, FileSystemHandle>> {
  const actual = new Map<string, FileSystemHandle>();
  for await (const handle of qDir.values()) {
    if (!isReservedQuarantineName(handle.name)) actual.set(handle.name, handle);
  }
  return actual;
}

function reconcileNote(record: QuarantineRecord, reason: string): void {
  record.status = "needs_reconcile";
  record.restored = false;
  record.note = record.note ? `${record.note}；${reason}` : reason;
  record.updatedAt = Date.now();
}

function syntheticRecordFromRaw(raw: unknown, index: number, sidecar: string): QuarantineRecord {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const now = Date.now();
  return {
    id: typeof value.id === "string" && value.id ? value.id.slice(0, 120) : `invalid-${index}-${makeId()}`,
    originalPath: typeof value.originalPath === "string" && value.originalPath
      ? value.originalPath : `(非法清单记录 ${index + 1})`,
    quarantinePath: typeof value.quarantinePath === "string" && value.quarantinePath
      ? value.quarantinePath : `${QUARANTINE_DIR}/invalid-${index}`,
    size: typeof value.size === "number" && Number.isFinite(value.size) ? value.size : 0,
    kind: value.kind === "directory" ? "directory" : "file",
    quarantinedAt: typeof value.quarantinedAt === "number" ? value.quarantinedAt : now,
    expiresAt: typeof value.expiresAt === "number" ? value.expiresAt : now + QUARANTINE_TTL_DAYS * DAY_MS,
    owner: typeof value.owner === "string" ? value.owner : "unknown",
    reason: typeof value.reason === "string" ? value.reason : "清单记录损坏，需要恢复检查",
    restored: false,
    modifiedAt: typeof value.modifiedAt === "number" ? value.modifiedAt : 0,
    checksum: typeof value.checksum === "string" ? value.checksum : "",
    checksumAlgo: "none",
    status: "needs_reconcile",
    updatedAt: now,
    note: `隔离清单中的这条记录不完整或非法，原始内容已保存到 ${sidecar}；不会自动删除任何一边。`,
  };
}

function syntheticRecordFromOrphan(name: string, handle: FileSystemHandle): QuarantineRecord {
  const parsed = parseQuarantineName(name);
  const now = Date.now();
  return {
    id: parsed?.id ?? `orphan-${makeId()}`,
    originalPath: parsed?.originalPath ?? `(无法解析的隔离副本 ${name})`,
    quarantinePath: `${QUARANTINE_DIR}/${name}`,
    size: 0,
    kind: handle.kind as EntryKind,
    quarantinedAt: now,
    expiresAt: now + QUARANTINE_TTL_DAYS * DAY_MS,
    owner: "unknown",
    reason: "隔离区存在没有清单记录的副本",
    restored: false,
    modifiedAt: 0,
    checksum: "",
    checksumAlgo: "none",
    status: "needs_reconcile",
    updatedAt: now,
    note: "隔离区存在无清单记录的副本，无法确定来源与原位置；已标记为需要恢复检查，不会自动删除。",
  };
}

async function readManifest(
  root: FileSystemDirectoryHandle,
  qDir: FileSystemDirectoryHandle,
): Promise<QuarantineRecord[]> {
  let records: QuarantineRecord[] = [];
  let changed = false;
  let fileHandle: FileSystemFileHandle | null = null;
  try {
    fileHandle = await qDir.getFileHandle(MANIFEST_NAME);
  } catch (err) {
    if (!isNotFoundError(err)) throw new Error(`读取隔离清单失败: ${errorMessage(err)}`, { cause: err });
  }

  if (fileHandle) {
    const text = await (await fileHandle.getFile()).text();
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("manifest is not an array");
      const invalid: unknown[] = [];
      for (const entry of parsed) {
        if (isValidRecord(entry)) records.push(normalizeRecord(entry));
        else invalid.push(entry);
      }
      if (invalid.length > 0) {
        const sidecar = `manifest-invalid-${Date.now()}.json`;
        await writeTextHandle(qDir, sidecar, JSON.stringify(invalid, null, 2));
        records.push(...invalid.map((entry, index) => syntheticRecordFromRaw(entry, index, sidecar)));
        changed = true;
      }
    } catch {
      // 损坏清单原样归档，绝不静默丢弃可能指向唯一副本的线索
      const backup = `manifest.corrupt-${Date.now()}.json`;
      await writeTextHandle(qDir, backup, text);
      records = [syntheticRecordFromRaw({
        id: `manifest-corrupt-${Date.now()}`,
        originalPath: "(隔离清单)",
        quarantinePath: `${QUARANTINE_DIR}/${MANIFEST_NAME}`,
        kind: "file",
        reason: "隔离清单无法解析",
        note: `原始清单已保存到 ${backup}`,
      }, 0, backup)];
      changed = true;
    }
  }

  const actual = await actualQuarantineEntries(qDir);
  const knownNames = new Set<string>();
  for (const record of records) {
    let relative = "";
    try {
      relative = relativeToQuarantine(record);
    } catch {
      reconcileNote(record, "清单中的隔离路径非法，无法核对副本位置。");
      changed = true;
      continue;
    }
    knownNames.add(relative);
    if (record.status === "needs_reconcile") continue;
    const handle = actual.get(relative);
    const original = await pathState(root, record.originalPath);

    if (record.status === "restored") {
      if (handle) {
        reconcileNote(record, "记录显示已还原，但隔离区仍存在对应副本，需要恢复检查。");
        changed = true;
      }
      continue;
    }

    if (record.status === "processing") {
      reconcileNote(record, "启动时发现上次操作停留在「处理中」，无法确定原位置与隔离副本哪一边完整。");
      changed = true;
      continue;
    }

    if (record.status === "restore_failed") {
      reconcileNote(record, "启动时发现上次还原失败，原位置与隔离副本状态需要人工核对。");
      changed = true;
      continue;
    }

    if (record.status === "quarantine_failed") {
      if (handle || original !== "present") {
        reconcileNote(record, handle
          ? "记录为隔离失败，但隔离区存在副本，需核对哪一边完整。"
          : "记录为隔离失败，但原位置也不存在，无法定位完整内容。");
        changed = true;
      }
      continue;
    }

    // quarantined：原位置出现同名内容属于可处理的还原冲突，保留记录让用户选择「跳过/保留两份」
    if (!handle) {
      reconcileNote(record, original === "present"
        ? "清单记录的隔离副本不存在，但原位置有同名内容；不能据此判断已还原。"
        : "清单记录的隔离副本不存在，原位置也没有内容，需要恢复检查。");
      changed = true;
    } else if (original === "unknown") {
      reconcileNote(record, "无法确认原位置是否为空，需要恢复检查。");
      changed = true;
    } else if (handle.kind !== record.kind) {
      reconcileNote(record, "隔离副本的类型与清单记录不一致，需要恢复检查。");
      changed = true;
    }
  }

  for (const [name, handle] of actual) {
    if (knownNames.has(name)) continue;
    records.push(syntheticRecordFromOrphan(name, handle));
    changed = true;
  }

  if (changed) await writeManifest(qDir, records);
  return records;
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
  fileCount: number;
  bytes: number;
  lastModified: number;
}

async function walkTree(dir: FileSystemDirectoryHandle, prefix = ""): Promise<TreeListing> {
  const out: TreeListing = { lines: [], dirCount: 0, fileCount: 0, bytes: 0, lastModified: 0 };
  for await (const handle of dir.values()) {
    const rel = prefix ? `${prefix}/${handle.name}` : handle.name;
    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      out.lines.push(`${rel}\t${file.size}`);
      out.bytes += file.size;
      out.fileCount += 1;
      out.lastModified = Math.max(out.lastModified, file.lastModified);
    } else {
      out.dirCount += 1;
      const sub = await walkTree(handle as FileSystemDirectoryHandle, rel);
      out.lines.push(...sub.lines);
      out.dirCount += sub.dirCount;
      out.fileCount += sub.fileCount;
      out.bytes += sub.bytes;
      out.lastModified = Math.max(out.lastModified, sub.lastModified);
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

/**
 * 移动/隔离前复核扫描快照。目录只比较类型、文件数、总大小、最大修改时间和是否为空；
 * 这能发现扫描后新增、删除、替换或覆盖，但不声称逐字节比对所有内容。
 */
export async function verifyEntrySnapshot(
  root: FileSystemDirectoryHandle,
  entry: JudgedEntry,
): Promise<void> {
  let handle: FileSystemHandle;
  try {
    handle = await resolveHandle(root, entry.path);
  } catch (err) {
    throw new SnapshotMismatchError(`扫描后无法再访问「${entry.path}」：${errorMessage(err)}。请重新扫描。`);
  }
  if (handle.kind !== entry.kind) {
    throw new SnapshotMismatchError(`「${entry.path}」的类型已从${entry.kind === "file" ? "文件" : "目录"}变化，请重新扫描。`);
  }
  if (handle.kind === "file") {
    const file = await (handle as FileSystemFileHandle).getFile();
    if (file.size !== entry.size || file.lastModified !== entry.lastModified) {
      throw new SnapshotMismatchError(`「${entry.path}」的大小或修改时间已变化，请重新扫描后再隔离。`);
    }
    return;
  }
  const listing = await walkTree(handle as FileSystemDirectoryHandle);
  const emptyChanged = entry.isEmptyDir && (listing.fileCount > 0 || listing.dirCount > 0);
  const modifiedChanged = entry.lastModified > 0 && listing.lastModified !== entry.lastModified;
  if (listing.bytes !== entry.size || listing.fileCount !== entry.fileCount || emptyChanged || modifiedChanged) {
    throw new SnapshotMismatchError(`「${entry.path}」的内容、文件数或修改时间与扫描时不一致，请重新扫描后再隔离。`);
  }
}

/** 复制单个文件并按记录的哈希算法校验；校验不过只删除副本，原文件不动 */
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
 * 原文件已在移动/复制后消失但结果不确定时，保留目标副本并要求人工对账。
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
      // move 不可用或没有发生：回到复制校验路径，原文件此时仍在原处
      await destParent.removeEntry(destName).catch(() => undefined);
      const copied = await copyFileVerified(src, destParent, destName);
      try {
        await srcParent.removeEntry(srcName);
      } catch (removeErr) {
        throw new TransferSafetyError(
          `复制已完成，但移除原文件失败：${errorMessage(removeErr)}；目标副本保留，不能据此判断哪一边完整。`,
          true,
        );
      }
      return {
        ...copied,
        mode: "copy",
        note: `浏览器移动能力不可用（${errorMessage(err)}），已降级为复制校验后移除原文件`,
      };
    }
    if (moved) {
      let actual: FileChecksum;
      try {
        const handle = await destParent.getFileHandle(destName);
        actual = await hashFile(handle);
      } catch (err) {
        throw new TransferSafetyError(
          `移动已完成但无法校验目标副本：${errorMessage(err)}；目标副本保留，原位置不再作为完整副本依赖。`,
          true,
        );
      }
      if (actual.checksum !== expected.checksum) {
        let movedBack = false;
        let backError: unknown;
        try {
          const handle = await destParent.getFileHandle(destName);
          await handle.move(srcParent, srcName);
          movedBack = true;
        } catch (err) {
          backError = err;
        }
        if (movedBack) {
          throw new TransferSafetyError("移动后校验不一致，已移回原位置。", false);
        }
        throw new TransferSafetyError(
          `移动后校验不一致且移回失败：${errorMessage(backError)}；内容保留在目标位置 ${destName}，不再自动删除。`,
          true,
        );
      }
      return { ...actual, mode: "move" };
    }
  }
  const copied = await copyFileVerified(src, destParent, destName);
  try {
    await srcParent.removeEntry(srcName);
  } catch (err) {
    throw new TransferSafetyError(
      `复制已完成，但移除原文件失败：${errorMessage(err)}；目标副本保留，不能据此判断哪一边完整。`,
      true,
    );
  }
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
    // 递归删除可能已经删了一部分：此时目标副本可能是唯一完整版本，绝不回滚删除它
    throw new TransferSafetyError(
      `复制已完成，但移除原目录失败：${errorMessage(err)}；目标副本保留，需要恢复检查。`,
      true,
    );
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
  await verifyEntrySnapshot(root, entry);
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
  const created: QuarantineRecord[] = [];
  const skipped: QuarantineFailure[] = [];
  const failures: QuarantineFailure[] = [];
  const needsReconcile: QuarantineFailure[] = [];
  if (entries.length === 0) return { created, skipped, failures, needsReconcile };

  // 核心层门禁：不信任 selectedIds、按钮状态或调用方过滤结果
  for (const entry of entries) {
    const gate = canQuarantineEntry(entry);
    if (!gate.allowed) throw new Error(`「${entry.name}」无法进入隔离流程：${gate.reason}`);
  }

  const qDir = await ensureQuarantineDir(root);
  const manifest = await readManifest(root, qDir);
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

  // 任何搬动之前先复核全部快照；有一条变化就整批停止，避免后半批基于旧扫描继续执行
  for (const entry of targets) await verifyEntrySnapshot(root, entry);

  // 空间预检必须在任何搬动之前：不足时直接禁止开始
  await checkQuarantineSpace(root, targets.reduce((sum, e) => sum + e.size, 0));

  let done = 0;
  let stoppedByMismatch: QuarantineFailure | null = null;
  for (let index = 0; index < targets.length; index += 1) {
    const entry = targets[index];
    if (stoppedByMismatch) {
      const skip = { path: entry.path, reason: `因前序条目扫描快照变化，已停止后续隔离：${stoppedByMismatch.reason}` };
      skipped.push(skip);
      onSkip?.(skip);
      done += 1;
      onProgress?.(done, targets.length);
      continue;
    }
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
      record.note = errorMessage(err);
      record.updatedAt = Date.now();
      if (err instanceof SnapshotMismatchError) {
        record.status = "quarantine_failed";
        failures.push({ path: entry.path, reason: record.note });
        stoppedByMismatch = { path: entry.path, reason: record.note };
        await qDir.removeEntry(quarantineName(record.id, entry.path), { recursive: true }).catch(() => undefined);
      } else if (err instanceof TransferSafetyError && err.keepDestination) {
        record.status = "needs_reconcile";
        record.restored = false;
        needsReconcile.push({ path: entry.path, reason: record.note });
        // 目标副本可能是唯一完整版本，绝不自动删除任何一边
      } else {
        record.status = "quarantine_failed";
        failures.push({ path: entry.path, reason: record.note });
        await qDir.removeEntry(quarantineName(record.id, entry.path), { recursive: true }).catch(() => undefined);
      }
    }
    await writeManifest(qDir, manifest);
    done += 1;
    onProgress?.(done, targets.length);
  }

  return { created, skipped, failures, needsReconcile };
}

export async function listQuarantine(root: FileSystemDirectoryHandle): Promise<QuarantineRecord[]> {
  const qDir = await ensureQuarantineDir(root);
  return readManifest(root, qDir);
}

/**
 * 扫描阶段专用：只读取已有隔离记录，不创建目录、不修复清单、不写任何文件。
 * 真实目录扫描即使此前已有写权限，也必须保持“只扫描，不修改”。
 */
export async function readQuarantineReadOnly(root: FileSystemDirectoryHandle): Promise<QuarantineRecord[]> {
  let qDir: FileSystemDirectoryHandle;
  try {
    qDir = await root.getDirectoryHandle(QUARANTINE_DIR);
  } catch (err) {
    if (isNotFoundError(err)) return [];
    throw new Error(`读取隔离区失败: ${errorMessage(err)}`, { cause: err });
  }
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
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRecord).map(normalizeRecord);
  } catch {
    return [];
  }
}

/** 扫描结束时决定是否允许写入：只有 OPFS 演示模式走可写清单 reconcile。 */
export async function loadQuarantineForScan(
  root: FileSystemDirectoryHandle,
  source: "sandbox" | "local",
): Promise<QuarantineRecord[]> {
  return source === "sandbox" ? listQuarantine(root) : readQuarantineReadOnly(root);
}

// ---------- 还原 ----------

/** 还原前探测同名冲突：无法确认时失败关闭，绝不把探测错误当成“没有冲突” */
export async function restoreConflicts(
  root: FileSystemDirectoryHandle,
  records: QuarantineRecord[],
): Promise<QuarantineRecord[]> {
  const conflicts: QuarantineRecord[] = [];
  for (const record of records) {
    if (record.restored) continue;
    const state = await pathState(root, record.originalPath);
    if (state === "present") conflicts.push(record);
    else if (state === "unknown") throw new Error(`无法确认「${record.originalPath}」是否已被占用，已停止还原。`);
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

async function verifyQuarantineCopy(qDir: FileSystemDirectoryHandle, record: QuarantineRecord): Promise<FileSystemHandle> {
  let src: FileSystemHandle;
  try {
    src = await resolveHandle(qDir, relativeToQuarantine(record));
  } catch (err) {
    throw new Error(`隔离副本不可访问，已停止还原：${errorMessage(err)}`);
  }
  if (src.kind !== record.kind) throw new Error("隔离副本类型与清单记录不一致，已停止还原。");
  if (!record.checksum || record.checksumAlgo === "none") return src;
  const actual = src.kind === "file"
    ? await hashFile(src as FileSystemFileHandle)
    : { checksum: await treeChecksum(src as FileSystemDirectoryHandle), algo: "tree-sha256" as const };
  if (actual.checksum !== record.checksum || actual.algo !== record.checksumAlgo) {
    throw new Error("隔离副本与清单记录的校验值不一致，已停止还原，不移动任何一边。");
  }
  return src;
}

export async function restoreEntries(
  root: FileSystemDirectoryHandle,
  records: QuarantineRecord[],
  policy: RestorePolicy = "skip",
  onProgress?: (done: number, total: number) => void,
): Promise<RestoreOutcome> {
  if (policy !== "skip" && policy !== "keep-both") {
    throw new Error(`不支持的还原策略「${String(policy)}」；替换需先备份并支持失败回滚，当前仅允许跳过或保留两份。`);
  }
  const qDir = await ensureQuarantineDir(root);
  const manifest = await readManifest(root, qDir);
  const restored: QuarantineRecord[] = [];
  const failures: QuarantineFailure[] = [];
  const needsReconcile: QuarantineFailure[] = [];
  let done = 0;

  // 先整体检查，任何一条需要恢复检查或正在处理，都不得开始批量还原
  const prepared = records.map((record) => manifest.find((item) => item.id === record.id) ?? null);
  for (const stored of prepared) {
    if (!stored || stored.restored) continue;
    if (stored.status === "needs_reconcile" || stored.status === "processing") {
      throw new Error(`「${stored.originalPath}」需要恢复检查，已停止还原；请先人工核对原位置与隔离副本。`);
    }
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const stored = prepared[index];
    if (!stored || stored.restored) { done += 1; onProgress?.(done, records.length); continue; }
    try {
      await verifyQuarantineCopy(qDir, stored);
      stored.status = "processing";
      stored.updatedAt = Date.now();
      await writeManifest(qDir, manifest);

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
        name = await uniqueRestoreName(parent, name);
        notes.push(`原位置已有同名内容，按「保留两份」还原为 ${name}`);
      }
      if (src.kind === "file") {
        const result = await transferFile(src as FileSystemFileHandle, qDir, qName, parent, name);
        if (stored.checksum && (result.checksum !== stored.checksum || result.algo !== stored.checksumAlgo)) {
          throw new IntegrityMismatchError("还原后校验值与隔离时记录不一致，原位置副本已保留，需要恢复检查。");
        }
        if (result.note) notes.push(result.note);
      } else {
        const result = await copyThenRemoveDirectory(src as FileSystemDirectoryHandle, qDir, qName, parent, name);
        if (stored.checksum && result.checksum !== stored.checksum) {
          throw new IntegrityMismatchError("还原后目录结构校验与隔离时记录不一致，原位置副本已保留，需要恢复检查。");
        }
      }
      stored.status = "restored";
      stored.restored = true;
      stored.updatedAt = Date.now();
      stored.note = notes.join("；") || undefined;
      await writeManifest(qDir, manifest);
      restored.push(stored);
    } catch (err) {
      const reason = errorMessage(err);
      stored.updatedAt = Date.now();
      if ((err instanceof TransferSafetyError && err.keepDestination) || err instanceof IntegrityMismatchError) {
        stored.status = "needs_reconcile";
        stored.restored = false;
        stored.note = reason;
        needsReconcile.push({ path: stored.originalPath, reason });
      } else {
        stored.status = "restore_failed";
        stored.note = reason;
        failures.push({ path: stored.originalPath, reason });
      }
      await writeManifest(qDir, manifest);
    }
    done += 1;
    onProgress?.(done, records.length);
  }

  return { restored, failures, needsReconcile };
}

export async function purgeExpired(root: FileSystemDirectoryHandle, records: QuarantineRecord[]): Promise<QuarantineRecord[]> {
  const qDir = await ensureQuarantineDir(root);
  const manifest = await readManifest(root, qDir);
  const candidates = new Set(records.map((r) => r.id));
  const now = Date.now();
  const keep: QuarantineRecord[] = [];
  const errors: string[] = [];
  let changed = false;

  for (const record of manifest) {
    // 只清理状态明确并且仍完整的隔离项；处理中、失败或待对账的一律留给人工
    if (record.status === "quarantined" && record.expiresAt <= now && candidates.has(record.id)) {
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

export type DeleteQuarantineResult = "content" | "audit" | "missing";

export async function deleteQuarantined(
  root: FileSystemDirectoryHandle,
  record: QuarantineRecord,
): Promise<DeleteQuarantineResult> {
  const qDir = await ensureQuarantineDir(root);
  const manifest = await readManifest(root, qDir);
  const stored = manifest.find((r) => r.id === record.id);
  if (!stored) return "missing";
  if (stored.status === "needs_reconcile" || stored.status === "processing") {
    throw new Error("该记录需要恢复检查，不能直接彻底删除；请先人工核对原位置与隔离副本。");
  }
  if (stored.restored) {
    // 已还原记录没有隔离副本：这里只移除历史行，不触碰原文件和审计 Markdown
    await writeManifest(qDir, manifest.filter((r) => r.id !== stored.id));
    return "audit";
  }
  await qDir.removeEntry(relativeToQuarantine(stored), { recursive: true }).catch((err) => {
    if (!isNotFoundError(err)) throw new Error(`删除隔离内容失败: ${errorMessage(err)}`, { cause: err });
  });
  // 彻底删除后必须同时移除清单行，否则会留下一条内容已不存在的幽灵记录
  await writeManifest(qDir, manifest.filter((r) => r.id !== stored.id));
  return "content";
}

export interface EmptyQuarantineOutcome {
  removed: number;
  failures: QuarantineFailure[];
}

export async function emptyQuarantine(root: FileSystemDirectoryHandle): Promise<EmptyQuarantineOutcome> {
  const qDir = await ensureQuarantineDir(root);
  const manifest = await readManifest(root, qDir);
  const uncertain = manifest.filter((record) =>
    record.status === "needs_reconcile" || record.status === "processing");
  if (uncertain.length > 0) {
    throw new Error(`存在 ${uncertain.length} 条需要恢复检查的记录，已阻止清空；请先人工核对，避免删除唯一副本。`);
  }
  const names: string[] = [];
  for await (const name of qDir.keys()) names.push(name);
  const failedNames = new Set<string>();
  const failures: QuarantineFailure[] = [];
  let removed = 0;
  for (const name of names) {
    // 操作记录、恢复说明和损坏清单备份是审计痕迹，清空隔离区时必须保留
    if (isReservedQuarantineName(name) && name !== MANIFEST_NAME) continue;
    try {
      await qDir.removeEntry(name, { recursive: true });
      removed += 1;
    } catch (err) {
      if (!isNotFoundError(err)) {
        failedNames.add(name);
        failures.push({ path: name, reason: errorMessage(err) });
      }
    }
  }
  const keep = manifest.filter((record) => {
    try {
      return failedNames.has(relativeToQuarantine(record));
    } catch {
      return true;
    }
  });
  await writeManifest(qDir, keep);
  return { removed, failures };
}