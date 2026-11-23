import type { JudgedEntry, KnowledgeHit, ScanEntry, Verdict } from "../core/types";
import { evaluatePath } from "./guard";

const REBUILDABLE_DIR_NAMES = new Set([
  "node_modules",
  "__pycache__",
  ".cache",
  ".tmp",
  ".pytest_cache",
  ".mypy_cache",
  ".gradle",
  "cache",
  "cache_data",
  "code cache",
  "gpucache",
  "shadercache",
  "d3dscache",
  "crashpad",
  "crashdumps",
  "temp",
  "tmp",
  "logs",
  "log",
]);

const JUNK_FILE_EXTENSIONS = new Set([
  ".tmp",
  ".temp",
  ".log",
  ".cache",
  ".dmp",
  ".chk",
  ".ds_store",
]);

const JUNK_FILE_NAMES = new Set(["thumbs.db", "desktop.ini.bak", ".ds_store"]);

const USER_CONTENT_EXTENSIONS = new Set([
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf", ".txt", ".md", ".rtf",
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".raw", ".cr2", ".nef", ".psd", ".ai",
  ".mp3", ".wav", ".flac", ".mp4", ".mov", ".mkv", ".avi",
  ".zip", ".rar", ".7z", ".tar", ".gz",
  ".sql", ".db", ".sqlite", ".mdb",
  ".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".c", ".cpp", ".h", ".cs", ".go", ".rs",
  ".rb", ".php", ".swift", ".kt", ".vue", ".html", ".css", ".sln", ".csproj",
]);

const USER_DIR_NAMES = new Set([
  "documents", "desktop", "pictures", "photos", "videos", "music",
  "projects", "source", "src", "backup", "backups", "workspace",
  "文档", "照片", "图片", "视频", "音乐", "桌面", "项目", "源码", "工作", "备份",
]);

const VERDICT_RISK_BASE: Record<Verdict, number> = {
  safe_delete: 15,
  needs_review: 55,
  keep_locked: 90,
};

const SAFETY_FACTOR: Record<Verdict, number> = {
  safe_delete: 1,
  needs_review: 0.2,
  keep_locked: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

interface Heuristic {
  riskScore: number;
  confidence: number;
}

function heuristicJudge(entry: ScanEntry): Heuristic {
  const lowerName = entry.name.toLowerCase();

  if (entry.kind === "directory" && entry.isEmptyDir) {
    return { riskScore: 8, confidence: 0.9 };
  }
  if (entry.kind === "file" && (JUNK_FILE_EXTENSIONS.has(extOf(entry.name)) || JUNK_FILE_NAMES.has(lowerName))) {
    return { riskScore: 15, confidence: 0.8 };
  }
  if (entry.kind === "directory" && REBUILDABLE_DIR_NAMES.has(lowerName)) {
    return { riskScore: 22, confidence: 0.7 };
  }
  if (USER_DIR_NAMES.has(lowerName)) {
    return { riskScore: 88, confidence: 0.75 };
  }
  if (entry.kind === "file" && USER_CONTENT_EXTENSIONS.has(extOf(entry.name))) {
    return { riskScore: 85, confidence: 0.75 };
  }
  const ageDays = (Date.now() - entry.lastModified) / 86_400_000;
  if (ageDays > 180) {
    return { riskScore: 52, confidence: 0.4 };
  }
  return { riskScore: 60, confidence: 0.35 };
}

function verdictFromRisk(riskScore: number): Verdict {
  return riskScore <= 30 ? "safe_delete" : "needs_review";
}

export function judgeEntry(entry: ScanEntry, hit: KnowledgeHit | null): JudgedEntry {
  const guard = evaluatePath(entry.path, entry.name);

  if (guard.locked) {
    return {
      ...entry,
      hit,
      verdict: "keep_locked",
      riskScore: 100,
      priority: 0,
      locked: true,
      source: hit ? "fingerprint" : "heuristic",
    };
  }

  let verdict: Verdict;
  let riskScore: number;
  let confidence: number;

  if (hit) {
    verdict = hit.verdict;
    confidence = clamp(hit.confidence, 0, 1);
    // 低置信度的「可删」结论不足以支撑自动化，降档让人确认
    if (verdict === "safe_delete" && confidence < 0.5) verdict = "needs_review";
    riskScore = clamp(
      VERDICT_RISK_BASE[verdict] + (1 - confidence) * 20 - (hit.rebuildable ? 10 : 0),
      0,
      100,
    );
  } else {
    const h = heuristicJudge(entry);
    riskScore = h.riskScore;
    confidence = h.confidence;
    verdict = verdictFromRisk(riskScore);
  }

  const priority = entry.size * confidence * SAFETY_FACTOR[verdict];

  return {
    ...entry,
    hit,
    verdict,
    riskScore,
    priority,
    locked: false,
    source: hit ? "fingerprint" : "heuristic",
  };
}

export function judgeAll(
  entries: ScanEntry[],
  hits: Map<string, KnowledgeHit | null>,
): JudgedEntry[] {
  const judged = entries.map((entry) => judgeEntry(entry, hits.get(entry.id) ?? hits.get(entry.path) ?? null));

  // 整体隔离一个目录会连带移走它的整棵子树。子树里只要有不可替代的数据，
  // 祖先就必须一起锁定，否则「可删的容器」会绕过对里面关键文件的保护。
  const byId = new Map(judged.map((e) => [e.id, e]));
  for (const entry of judged) {
    if (!entry.locked && entry.verdict !== "keep_locked") continue;
    let cursor = entry.parentId;
    while (cursor) {
      const ancestor = byId.get(cursor);
      if (!ancestor) break;
      if (!ancestor.locked) {
        ancestor.locked = true;
        ancestor.verdict = "keep_locked";
        ancestor.riskScore = 100;
        ancestor.priority = 0;
      }
      cursor = ancestor.parentId;
    }
  }
  return judged;
}