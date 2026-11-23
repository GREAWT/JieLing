import { QUARANTINE_DIR, QUARANTINE_TTL_DAYS } from "../core/constants";
import type { EntryKind, JudgedEntry, QuarantineRecord } from "../core/types";
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

async function rebuildManifest(qDir: FileSystemDirectoryHandle): Promise<QuarantineRecord[]> {
  const records: QuarantineRecord[] = [];
  const now = Date.now();
  for await (const handle of qDir.values()) {
    if (handle.name === MANIFEST_NAME || JOURNAL_NAMES.includes(handle.name)) continue;
    const parsed = parseQuarantineName(handle.name);
    records.push({
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
    });
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
    if (Array.isArray(parsed)) return parsed.filter(isValidRecord);
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

async function copyThenRemoveDirectory(
  src: FileSystemDirectoryHandle,
  srcParent: FileSystemDirectoryHandle,
  srcName: string,
  destParent: FileSystemDirectoryHandle,
  destName: string,
): Promise<void> {
  const target = await destParent.getDirectoryHandle(destName, { create: true });
  try {
    await copyDirectoryContents(src, target);
  } catch (err) {
    await destParent.removeEntry(destName, { recursive: true }).catch(() => undefined);
    throw new Error(`复制目录失败（原目录未动）: ${errorMessage(err)}`, { cause: err });
  }
  try {
    // 目录句柄没有 move()，只能复制成功后再删原处（已实测约束）
    await srcParent.removeEntry(srcName, { recursive: true });
  } catch (err) {
    await destParent.removeEntry(destName, { recursive: true }).catch(() => undefined);
    throw new Error(`删除原目录失败（已回滚副本）: ${errorMessage(err)}`, { cause: err });
  }
}

async function quarantineOne(
  root: FileSystemDirectoryHandle,
  qDir: FileSystemDirectoryHandle,
  entry: JudgedEntry,
  ttlDays: number,
): Promise<QuarantineRecord> {
  const parts = entry.path.split("/").filter((s) => s.length > 0);
  if (parts.length === 0) throw new Error("不能隔离根目录");
  const name = parts[parts.length - 1];
  const parentPath = parts.slice(0, -1).join("/");
  const parent = parentPath ? ((await resolveHandle(root, parentPath)) as FileSystemDirectoryHandle) : root;
  const src = await resolveHandle(root, entry.path);

  const id = makeId();
  const qName = quarantineName(id, entry.path);

  if (src.kind === "file") {
    await (src as FileSystemFileHandle).move(qDir, qName);
  } else {
    await copyThenRemoveDirectory(src as FileSystemDirectoryHandle, parent, name, qDir, qName);
  }

  const now = Date.now();
  return {
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
  };
}

export interface QuarantineSkip {
  path: string;
  reason: string;
}

export async function quarantineEntries(
  root: FileSystemDirectoryHandle,
  entries: JudgedEntry[],
  ttlDays: number = QUARANTINE_TTL_DAYS,
  onSkip?: (skip: QuarantineSkip) => void,
): Promise<QuarantineRecord[]> {
  const qDir = await ensureQuarantineDir(root);
  const manifest = await readManifest(qDir);
  const created: QuarantineRecord[] = [];
  const errors: string[] = [];
  const selected = new Set(entries.map((e) => e.path));

  for (const entry of entries) {
    if (entry.path === QUARANTINE_DIR || entry.path.startsWith(`${QUARANTINE_DIR}/`)) continue;
    // 祖先目录已被选中时跳过子项，避免对已移走的路径二次操作
    let coveredByAncestor = false;
    for (const p of selected) {
      if (p !== entry.path && entry.path.startsWith(`${p}/`)) {
        coveredByAncestor = true;
        break;
      }
    }
    if (coveredByAncestor) continue;
    if (manifest.some((r) => r.originalPath === entry.path && !r.restored)) {
      // 原位置又出现了同名内容（例如样本被重建过）：不能静默丢弃，必须让调用方告诉用户
      onSkip?.({ path: entry.path, reason: "该路径已有未还原的隔离记录" });
      continue;
    }

    try {
      const record = await quarantineOne(root, qDir, entry, ttlDays);
      manifest.push(record);
      created.push(record);
      await writeManifest(qDir, manifest);
    } catch (err) {
      errors.push(`${entry.path}: ${errorMessage(err)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`部分条目隔离失败（成功 ${created.length} 项）:\n${errors.join("\n")}`);
  }
  return created;
}

export async function listQuarantine(root: FileSystemDirectoryHandle): Promise<QuarantineRecord[]> {
  const qDir = await ensureQuarantineDir(root);
  return readManifest(qDir);
}

export async function restoreEntries(root: FileSystemDirectoryHandle, records: QuarantineRecord[]): Promise<void> {
  const qDir = await ensureQuarantineDir(root);
  const manifest = await readManifest(qDir);
  const errors: string[] = [];

  for (const record of records) {
    const stored = manifest.find((r) => r.id === record.id);
    if (!stored || stored.restored) continue;
    try {
      const qName = relativeToQuarantine(stored);
      const src = await resolveHandle(qDir, qName);
      const parts = stored.originalPath.split("/").filter((s) => s.length > 0);
      if (parts.length === 0) throw new Error(`记录的原路径非法: ${stored.originalPath}`);
      const name = parts[parts.length - 1];
      const parent = await ensureDirectoryPath(root, parts.slice(0, -1).join("/"));
      if (await entryExists(parent, name)) {
        throw new Error(`还原目标已存在，拒绝覆盖: ${stored.originalPath}`);
      }
      if (src.kind === "file") {
        await (src as FileSystemFileHandle).move(parent, name);
      } else {
        await copyThenRemoveDirectory(src as FileSystemDirectoryHandle, qDir, qName, parent, name);
      }
      stored.restored = true;
      await writeManifest(qDir, manifest);
    } catch (err) {
      errors.push(`${record.originalPath}: ${errorMessage(err)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`部分条目还原失败:\n${errors.join("\n")}`);
  }
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