import { QUARANTINE_DIR } from "../core/constants";

// TS 5.9 的 lib.dom 尚未收录 move()/remove()/showDirectoryPicker()/目录异步迭代器，
// 以下声明对应 Chrome 150 已实测存在的运行时能力。
declare global {
  interface Window {
    showDirectoryPicker(options?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: FileSystemHandle | "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
    }): Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemFileHandle {
    move(name: string): Promise<void>;
    move(destination: FileSystemDirectoryHandle, name?: string): Promise<void>;
  }

  interface FileSystemHandle {
    remove(options?: FileSystemRemoveOptions): Promise<void>;
  }

  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    keys(): AsyncIterableIterator<string>;
    values(): AsyncIterableIterator<FileSystemHandle>;
    [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export function isNotFoundError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}

function isTypeMismatchError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TypeMismatchError";
}

// 浏览器抛出的 DOMException 自带英文文案，直接展示会让用户看不懂；
// 在唯一出口统一译成中文，括号里保留错误码便于排查。
const DOM_EXCEPTION_TEXT: Record<string, string> = {
  AbortError: "操作已取消：没有选择任何目录，或中途关闭了选择窗口。",
  SecurityError: "浏览器拦截了这次目录选择：它必须由一次真实点击直接触发，且页面处于 https 或 localhost。请再点一次按钮重试。",
  NotAllowedError: "没有获得该目录的访问权限：请在浏览器弹窗中允许读取，或换一个你有权限的目录重试。",
  NoModificationAllowedError: "没有修改该目录的权限：请换一个你有读写权限的目录。",
  NotFoundError: "目标目录已不存在或已被移动，请重新选择。",
  TypeMismatchError: "所选对象不是文件夹，请重新选择一个目录。",
  InvalidStateError: "浏览器当前状态不允许这次文件操作，请刷新页面后重试。",
  QuotaExceededError: "浏览器存储空间不足，无法写入沙盒或隔离区，请先腾出一些空间。",
};

export function errorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    const translated = DOM_EXCEPTION_TEXT[err.name];
    if (translated) return `${translated}（${err.name}）`;
  }
  return err instanceof Error ? err.message : String(err);
}

function splitPath(path: string): string[] {
  const parts = path.split("/").filter((s) => s.length > 0 && s !== ".");
  if (parts.some((s) => s === "..")) {
    throw new Error(`非法路径（不允许 ".."）: ${path}`);
  }
  return parts;
}

export async function openSandboxRoot(): Promise<FileSystemDirectoryHandle> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
    throw new Error("当前浏览器不支持 OPFS（navigator.storage.getDirectory），无法创建沙盒");
  }
  try {
    const opfs = await navigator.storage.getDirectory();
    return await opfs.getDirectoryHandle("dareclean", { create: true });
  } catch (err) {
    throw new Error(`打开沙盒根目录失败: ${errorMessage(err)}`, { cause: err });
  }
}

export async function openLocalRoot(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error("当前浏览器不支持 File System Access API（showDirectoryPicker），请使用 Chrome / Edge");
  }
  // 必须由真实用户手势触发，否则抛 SecurityError（已实测）
  // 扫描阶段只申请读取；写入授权在用户确认隔离/还原时再单独申请。
  return window.showDirectoryPicker({ id: "dareclean-local", mode: "read" });
}

export async function ensureQuarantineDir(root: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  try {
    return await root.getDirectoryHandle(QUARANTINE_DIR, { create: true });
  } catch (err) {
    throw new Error(`创建隔离区目录 ${QUARANTINE_DIR} 失败: ${errorMessage(err)}`, { cause: err });
  }
}

export async function ensureDirectoryPath(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const part of splitPath(path)) {
    try {
      dir = await dir.getDirectoryHandle(part, { create: true });
    } catch (err) {
      throw new Error(`创建目录失败: ${path}（段 ${part}）: ${errorMessage(err)}`, { cause: err });
    }
  }
  return dir;
}

export async function resolveHandle(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemHandle> {
  const parts = splitPath(path);
  if (parts.length === 0) return root;
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(parts[i]);
    } catch (err) {
      if (isNotFoundError(err)) throw new Error(`路径不存在: ${path}（缺少目录 ${parts[i]}）`);
      throw new Error(`访问目录失败: ${path}（段 ${parts[i]}）: ${errorMessage(err)}`, { cause: err });
    }
  }
  const name = parts[parts.length - 1];
  try {
    return await dir.getFileHandle(name);
  } catch (err) {
    // 目标是目录时 Chrome 抛 TypeMismatchError，需继续尝试目录句柄
    if (!isNotFoundError(err) && !isTypeMismatchError(err)) throw err;
  }
  try {
    return await dir.getDirectoryHandle(name);
  } catch (err) {
    if (isNotFoundError(err)) throw new Error(`路径不存在: ${path}`);
    throw new Error(`访问失败: ${path}: ${errorMessage(err)}`, { cause: err });
  }
}

export async function removeByPath(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parts = splitPath(path);
  if (parts.length === 0) throw new Error("拒绝删除根目录本身");
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    try {
      dir = await dir.getDirectoryHandle(parts[i]);
    } catch (err) {
      if (isNotFoundError(err)) return;
      throw err;
    }
  }
  try {
    await dir.removeEntry(parts[parts.length - 1], { recursive: true });
  } catch (err) {
    if (isNotFoundError(err)) return;
    throw new Error(`删除失败: ${path}: ${errorMessage(err)}`, { cause: err });
  }
}

export async function readTextFile(root: FileSystemDirectoryHandle, path: string): Promise<string> {
  const handle = await resolveHandle(root, path);
  if (handle.kind !== "file") throw new Error(`不是文件，无法按文本读取: ${path}`);
  const file = await (handle as FileSystemFileHandle).getFile();
  return file.text();
}

export async function writeTextFile(root: FileSystemDirectoryHandle, path: string, text: string): Promise<void> {
  const parts = splitPath(path);
  if (parts.length === 0) throw new Error("写入路径不能为空");
  const name = parts[parts.length - 1];
  const parent = await ensureDirectoryPath(root, parts.slice(0, -1).join("/"));
  const fileHandle = await parent.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      // abort 失败不掩盖原始写入错误
    }
    throw new Error(`写入文件失败: ${path}: ${errorMessage(err)}`, { cause: err });
  }
}

export async function copyDirectoryContents(src: FileSystemDirectoryHandle, dest: FileSystemDirectoryHandle): Promise<void> {
  for await (const handle of src.values()) {
    if (handle.kind === "file") {
      const file = await (handle as FileSystemFileHandle).getFile();
      const out = await dest.getFileHandle(handle.name, { create: true });
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
        throw new Error(`复制文件失败: ${handle.name}: ${errorMessage(err)}`, { cause: err });
      }
    } else {
      const sub = await dest.getDirectoryHandle(handle.name, { create: true });
      await copyDirectoryContents(handle as FileSystemDirectoryHandle, sub);
    }
  }
}

export async function entryExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (err) {
    if (!isNotFoundError(err) && !isTypeMismatchError(err)) throw err;
  }
  try {
    await dir.getDirectoryHandle(name);
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}