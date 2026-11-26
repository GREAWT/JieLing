import { QUARANTINE_DIR, QUARANTINE_TTL_DAYS, REVIVAL_LABEL, VERDICT_LABEL, confidenceLabel, rebuildMechanisms } from "../core/constants";
import type { EntryKind, JudgedEntry, QuarantineRecord, RevivalMechanism, Verdict } from "../core/types";
import { ensureQuarantineDir, errorMessage, isNotFoundError, readTextFile, writeTextFile } from "./adapter";

export const OPS_MANUAL_NAME = "运维手册.md";
export const FOLDER_DICTIONARY_NAME = "文件夹名录.md";

// 这两个文件是审计痕迹，不是隔离内容：重建清单和清空隔离区都必须跳过它们，
// 否则清空一次就把全部历史抹掉，或者把 md 当成待还原的垃圾条目。
export const JOURNAL_NAMES: readonly string[] = [OPS_MANUAL_NAME, FOLDER_DICTIONARY_NAME];

export type JournalOperation = "quarantine" | "restore" | "delete" | "delete_audit" | "purge" | "clear";

const OPERATION_LABEL: Record<JournalOperation, string> = {
  quarantine: "移入隔离区",
  restore: "还原到原位置",
  delete: "彻底删除单项",
  delete_audit: "删除审计记录",
  purge: "清理到期项",
  clear: "清空隔离区",
};

const OPERATION_RISK: Record<JournalOperation, string> = {
  quarantine: "可逆。内容只是搬进隔离区，原位置腾空，随时可以还原。",
  restore: "可逆操作的反向：内容已回到原路径，隔离区不再持有副本。",
  delete: "不可逆。该项已从隔离区彻底移除，无法再还原。",
  delete_audit: "仅移除隔离清单中的历史记录；原文件与操作记录、恢复说明不受影响。",
  purge: "不可逆。到期项已彻底移除，无法再还原。",
  clear: "不可逆。隔离区全部内容已彻底移除，无法再还原。",
};

export interface OpsItem {
  path: string;
  size: number;
  kind: EntryKind;
  owner: string;
  verdict: Verdict | null;
  reason: string;
  consequence: string | null;
  revival: RevivalMechanism[];
}

export interface OpsEvent {
  operation: JournalOperation;
  at: number;
  items: OpsItem[];
  note?: string;
}

function timestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

// md 表格单元格里不能出现裸竖线或换行，否则整张表会错位。
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim() || "—";
}

export function itemsFromEntries(entries: JudgedEntry[]): OpsItem[] {
  return entries.map((entry) => ({
    path: entry.path,
    size: entry.size,
    kind: entry.kind,
    owner: entry.hit?.owner ?? "未识别",
    verdict: entry.verdict,
    reason: entry.hit?.reason ?? (entry.isEmptyDir ? "空目录，需人工判断是否无主" : "用户确认隔离"),
    consequence: entry.hit?.consequence ?? null,
    revival: entry.hit?.revival ?? [],
  }));
}

export function itemsFromRecords(records: QuarantineRecord[]): OpsItem[] {
  return records.map((record) => ({
    path: record.originalPath,
    size: record.size,
    kind: record.kind,
    owner: record.owner === "unknown" ? "未识别" : record.owner,
    verdict: null,
    reason: record.reason,
    consequence: null,
    revival: [],
  }));
}

function manualHeader(): string {
  return [
    "# 洁灵 · 操作记录",
    "",
    "> 本文件由洁灵在每次清理操作后自动追加，记录「做了什么、为什么、怎么撤回」。",
    `> 位置：所选根目录下的 \`${QUARANTINE_DIR}/${OPS_MANUAL_NAME}\`。`,
    "> 核心理念：隔离而非入侵，安全审核优先于暴力删除。",
    "",
    "## 怎么用这份手册",
    "",
    `- **想撤回**：在「隔离区」标签页点「还原」，内容会回到原路径；若原路径已被占用，会先问你「跳过 / 保留两份」，不会静默覆盖。`,
    `- **手动撤回**：隔离区里的条目名为 \`<id>__<URL编码的原路径>\`，解码后即可知道它该回哪里。`,
    `- **到期规则**：隔离内容保留 ${QUARANTINE_TTL_DAYS} 天，到期后仍需你确认才会彻底删除，不会自动清理。`,
    "- **删后重建风险**：仅服务、计划任务或启动项等具体重建机制会列入下表；进程占用不属于重建。",
    "  请到「顽固软件诊断」生成只读脚本核对来源，确认后再清理。",
    "- **浏览器能力边界**：洁灵运行在网页里，无法访问注册表、服务与正规卸载器。",
    "  这部分通过你在本机 PowerShell 运行只读脚本来完成；默认使用普通权限，只有你主动选择时才需要以管理员身份运行。",
    "",
    "## 操作记录",
    "",
  ].join("\n");
}

function renderEvent(event: OpsEvent): string {
  const total = event.items.reduce((sum, item) => sum + item.size, 0);
  const lines: string[] = [
    `### ${timestamp(event.at)} · ${OPERATION_LABEL[event.operation]}（${event.items.length} 项，${bytes(total)}）`,
    "",
    `- **可逆性**：${OPERATION_RISK[event.operation]}`,
  ];
  if (event.note) lines.push(`- **备注**：${event.note}`);
  lines.push("");

  if (event.items.length > 0) {
    lines.push(
      "| 原路径 | 类型 | 归属 | 判定 | 体积 | 为什么 | 删了会怎样 | 删后重建风险 |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const item of event.items) {
      lines.push(
        `| ${cell(item.path)} | ${item.kind === "directory" ? "目录" : "文件"} | ${cell(item.owner)} | ${item.verdict ? VERDICT_LABEL[item.verdict] : "—"} | ${bytes(item.size)} | ${cell(item.reason)} | ${cell(item.consequence ?? "—")} | ${cell(rebuildMechanisms(item.revival).map((m) => REVIVAL_LABEL[m] ?? m).join("、"))} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function readOptional(root: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    return await readTextFile(root, name);
  } catch (err) {
    if (isNotFoundError(err)) return null;
    // 路径存在但不是文件等异常也按「无历史」处理，避免审计写入阻断清理主流程
    return null;
  }
}

export async function appendOpsManual(root: FileSystemDirectoryHandle, event: OpsEvent): Promise<void> {
  const qDir = await ensureQuarantineDir(root);
  const existing = await readOptional(qDir, OPS_MANUAL_NAME);
  const body = existing?.trim() ? `${existing.replace(/\s+$/, "")}\n\n${renderEvent(event)}` : `${manualHeader()}${renderEvent(event)}`;
  await writeTextFile(qDir, OPS_MANUAL_NAME, body);
}

interface DictionaryRow {
  name: string;
  kind: string;
  owner: string;
  purpose: string;
  verdict: string;
  confidence: string;
  note: string;
}

const DICTIONARY_HEADER = [
  "# 洁灵 · 恢复说明",
  "",
  "> 每个文件夹名称后面标注它是什么、归属谁、能不能删。由洁灵在每次扫描与清理后自动更新。",
  `> 位置：所选根目录下的 \`${QUARANTINE_DIR}/${FOLDER_DICTIONARY_NAME}\`。`,
  "> 判定来源：可审查的本地规则 → 启发式判断；只有真实调用模型时才标记 AI 辅助分析，共享缓存单独标注。",
  "> 「需要你确认」不等于可删；「建议保留」已被锁定，不参与勾选。",
  "",
  "| 文件夹名 | 类型 | 归属 | 这是什么 | 判定 | 置信度 | 备注 |",
  "| --- | --- | --- | --- | --- | --- | --- |",
];

function parseDictionary(text: string | null): Map<string, DictionaryRow> {
  const rows = new Map<string, DictionaryRow>();
  if (!text) return rows;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 7) continue;
    const name = cells[0].replace(/\\\|/g, "|");
    if (!name || name === "文件夹名" || /^-+$/.test(name.replace(/\s/g, ""))) continue;
    rows.set(name, {
      name,
      kind: cells[1],
      owner: cells[2],
      purpose: cells[3],
      verdict: cells[4],
      confidence: cells[5],
      note: cells[6],
    });
  }
  return rows;
}

function describeUnknown(entry: JudgedEntry): string {
  if (entry.isEmptyDir) return "空目录。可能是软件预留的工作区，也可能是卸载后剩下的空壳";
  if (entry.kind === "file") return `普通文件（${bytes(entry.size)}），未命中本地规则`;
  return `未识别目录，含 ${entry.fileCount} 个文件`;
}

export async function syncFolderDictionary(
  root: FileSystemDirectoryHandle,
  judged: JudgedEntry[],
  quarantinedPaths: ReadonlySet<string>,
): Promise<void> {
  const qDir = await ensureQuarantineDir(root);
  const rows = parseDictionary(await readOptional(qDir, FOLDER_DICTIONARY_NAME));

  for (const entry of judged) {
    if (entry.kind !== "directory") continue;
    const hit = entry.hit;
    const previous = rows.get(entry.name);
    const notes: string[] = [];
    if (entry.isEmptyDir) notes.push("空目录");
    if (hit?.rebuildable) notes.push("删后软件会自动重建");
    const rebuilds = rebuildMechanisms(hit?.revival ?? []);
    if (rebuilds.length) notes.push(`删后重建风险：${rebuilds.map((m) => REVIVAL_LABEL[m] ?? m).join("、")}`);
    if (hit?.revival.includes("process_lock")) notes.push("正在使用，关闭相关程序后重试");
    if (entry.locked) notes.push("已锁定，不可勾选");
    // 同名文件夹在不同位置含义可能不同：保留最新一次扫描的判定，但把历史依据附在备注里
    if (previous && previous.purpose !== (hit?.purpose ?? describeUnknown(entry))) {
      notes.push(`此前记录：${previous.purpose}`);
    }
    rows.set(entry.name, {
      name: entry.name,
      kind: "目录",
      owner: hit?.owner ?? "未识别",
      purpose: hit?.purpose ?? describeUnknown(entry),
      verdict: VERDICT_LABEL[entry.verdict],
      confidence: hit ? confidenceLabel(hit.confidence) : "—",
      note: notes.join("；") || "—",
    });
  }

  // 还原或清空后，被移走的条目已不在 judged 里，循环碰不到它；
  // 按名字统一校正隔离状态，否则名录会一直挂着过期的「本次已移入隔离区」。
  const quarantinedNames = new Set([...quarantinedPaths].map((p) => p.split("/").pop() ?? p));
  for (const row of rows.values()) {
    const parts = row.note.split("；").filter((s) => s && s !== "—" && s !== "本次已移入隔离区");
    if (quarantinedNames.has(row.name)) parts.push("本次已移入隔离区");
    row.note = parts.join("；") || "—";
  }

  const sorted = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const body = [
    ...DICTIONARY_HEADER,
    ...sorted.map((row) =>
      `| ${cell(row.name)} | ${cell(row.kind)} | ${cell(row.owner)} | ${cell(row.purpose)} | ${cell(row.verdict)} | ${cell(row.confidence)} | ${cell(row.note)} |`),
    "",
    `_共 ${sorted.length} 个文件夹名 · 更新于 ${timestamp(Date.now())}_`,
    "",
  ].join("\n");
  await writeTextFile(qDir, FOLDER_DICTIONARY_NAME, body);
}

export async function readJournal(root: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  const qDir = await ensureQuarantineDir(root);
  return readOptional(qDir, name);
}

export function journalError(err: unknown): string {
  return errorMessage(err);
}