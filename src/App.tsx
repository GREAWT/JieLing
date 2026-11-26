import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Archive, BookOpen, ChevronDown, FileDown, FileUp, FolderSearch, ListChecks, RefreshCw,
  ShieldCheck, Sparkles, Stethoscope, TriangleAlert,
} from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AppHeader, ScanStatusBar, ReviewBoard, SelectionSummaryBar, QuarantineView,
  DiagnosePanel, LandingHero, EmptyState, ErrorState, ConfirmQuarantineDialog,
  RestoreConflictDialog, EntryDrawer, RulesPanel, RevivalSummary, formatBytes,
} from "@/src/components";
import { Panel, ToneDot } from "@/src/components/shared";
import type {
  CleanupAction, DiagnosisReport, JudgedEntry, KnowledgeHit, OwnerGroup,
  QuarantineRecord, RestorePolicy, RevivalMechanism, ScanEntry, ScanPhase, ScanProgress, ScanSource,
} from "@/src/core/types";
import {
  DEFAULT_SCAN_OPTIONS, PRODUCT_NAME, PRODUCT_PHILOSOPHY,
  QUARANTINE_TTL_DAYS, REVIVAL_LABEL, rebuildMechanisms,
} from "@/src/core/constants";
import {
  createScanner, errorMessage, isFileSystemAccessSupported, openLocalRoot, openSandboxRoot,
  listQuarantine, purgeExpired, quarantineEntries, restoreEntries, restoreConflicts,
  emptyQuarantine, deleteQuarantined,
  SANDBOX_LABEL, generateSandbox, clearSandbox, sandboxReady, type Scanner,
  appendOpsManual, syncFolderDictionary, readJournal, itemsFromEntries, itemsFromRecords,
  journalError, OPS_MANUAL_NAME, FOLDER_DICTIONARY_NAME, type OpsEvent,
} from "@/src/fs";
import { judgeAll } from "@/src/safety/risk";
import { canQuarantineEntry } from "@/src/safety/guard";
import { groupByOwner, sortGroups } from "@/src/safety/aggregate";
import { createDrawerNavigation } from "@/src/app/review";
import { matchAll } from "@/src/knowledge/match";
import { buildReadOnlyDiagnosticScript } from "@/src/diagnose/ps-readonly";
import { buildCleanupScript } from "@/src/diagnose/ps-clean";
import {
  mergeAiDiagnosis, parseDiagnosisReport, planCleanupActions, withLocalDiagnosisNotice,
} from "@/src/diagnose/report";
import { buildCloudDiagnosisPayload } from "@/src/diagnose/redact";
import { resolveUninstallGuidance } from "@/src/diagnose/uninstall";
import {
  AI_STATUS_TEXT, DIAGNOSE_AI_STATUS_TEXT, apiErrorText, judgeDirectories, requestDiagnosis, toJudgeItem,
} from "@/src/api";

const IDLE_PROGRESS: ScanProgress = {
  phase: "idle", visited: 0, bytes: 0, currentPath: "", truncated: false,
};

const TAB_CLASS = "gap-1.5 rounded-lg border border-transparent px-3 py-1.5 text-sm data-[state=active]:border-primary/40 data-[state=active]:bg-primary/12 data-[state=active]:text-primary";

type PermissionCapable = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: { mode?: string }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: string }) => Promise<PermissionState>;
};

// Permission prompts need user activation, which a Worker never has. Every write
// path therefore re-checks on the main thread inside the click handler.
async function ensureWritePermission(root: FileSystemDirectoryHandle): Promise<void> {
  const handle = root as PermissionCapable;
  if (typeof handle.queryPermission === "function"
    && await handle.queryPermission({ mode: "readwrite" }) === "granted") return;
  if (typeof handle.requestPermission === "function") {
    if (await handle.requestPermission({ mode: "readwrite" }) !== "granted") {
      throw new Error("未获得写入授权，无法移入隔离区。");
    }
    return;
  }
  throw new Error("当前浏览器无法确认写入授权，已停止操作。");
}

function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function joinAbsolute(rootAbsPath: string, relative: string): string | null {
  const root = rootAbsPath.trim().replace(/\//g, "\\").replace(/\\+$/, "");
  if (!/^[A-Za-z]:\\?/.test(root)) return null;
  const rel = relative.split("/").filter(Boolean).join("\\");
  return rel ? `${root}\\${rel}` : root;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export default function App() {
  const [source, setSource] = useState<ScanSource | null>(null);
  const [rootLabel, setRootLabel] = useState("");
  const [progress, setProgress] = useState<ScanProgress>(IDLE_PROGRESS);
  const [groups, setGroups] = useState<OwnerGroup[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [records, setRecords] = useState<QuarantineRecord[]>([]);
  const [view, setView] = useState("review");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [sandboxProgress, setSandboxProgress] = useState<{ created: number; total: number } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  // 「仅使用本地规则」：不向云端发送任何目录特征
  const [localOnly, setLocalOnly] = useState(() => localStorage.getItem("dareclean.localOnly") !== "0");
  const localOnlyRef = useRef(localOnly);
  const [quarantineProgress, setQuarantineProgress] = useState<{ done: number; total: number } | null>(null);
  const [restoreConflict, setRestoreConflict] = useState<QuarantineRecord | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);

  // 抽屉：详情只有一处，列表里点开，←/→ 在当前可见条目间移动
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerIds, setDrawerIds] = useState<string[]>([]);
  const [drawerIndex, setDrawerIndex] = useState(0);

  const [rootAbsPath, setRootAbsPath] = useState("");
  const [diagnoseTarget, setDiagnoseTarget] = useState("");
  /** 从审核台/重建风险提示带过来的相对路径：填好根目录后自动换算成绝对目标 */
  const [diagnoseRelative, setDiagnoseRelative] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [scriptOutput, setScriptOutput] = useState("");
  const [report, setReport] = useState<DiagnosisReport | null>(null);
  const [reportSource, setReportSource] = useState<"local" | "ai" | null>(null);
  const [actions, setActions] = useState<CleanupAction[]>([]);
  const [script, setScript] = useState<string | null>(null);
  const [readonlyScript, setReadonlyScript] = useState<string | null>(null);
  const [diagnoseBusy, setDiagnoseBusy] = useState(false);
  const [diagnoseError, setDiagnoseError] = useState<string | null>(null);
  const [cloudPayloadPreview, setCloudPayloadPreview] = useState<string | null>(null);

  const rootRef = useRef<FileSystemDirectoryHandle | null>(null);
  const scannerRef = useRef<Scanner | null>(null);
  const bufferRef = useRef<ScanEntry[]>([]);
  const entriesRef = useRef<ScanEntry[]>([]);
  const judgedRef = useRef<JudgedEntry[]>([]);
  const hitsRef = useRef<Map<string, KnowledgeHit | null>>(new Map());
  const aiIdsRef = useRef<Set<string>>(new Set());
  const cachedIdsRef = useRef<Set<string>>(new Set());
  // 「重试」必须重跑刚才失败的那个动作，而不是不分来源一律回沙盒
  const retryRef = useRef<() => void>(() => {});
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [dockHeight, setDockHeight] = useState(0);

  const localSupported = useMemo(() => isFileSystemAccessSupported(), []);

  useEffect(() => {
    const saved = localStorage.getItem("dareclean.rootAbsPath");
    if (saved) setRootAbsPath(saved);
  }, []);

  useEffect(() => {
    localOnlyRef.current = localOnly;
    localStorage.setItem("dareclean.localOnly", localOnly ? "1" : "0");
  }, [localOnly]);

  // 底部选择条的高度是动态的：写进内边距，最后一行永远不会被挡住
  const measureDock = useCallback(() => {
    const el = dockRef.current;
    if (el) setDockHeight(Math.ceil(el.getBoundingClientRect().height));
  }, []);

  useEffect(() => {
    const el = dockRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureDock);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureDock]);

  const applyJudgment = useCallback((
    list: ScanEntry[],
    hits: Map<string, KnowledgeHit | null>,
    aiIds: Set<string>,
  ): JudgedEntry[] => {
    const judged = judgeAll(list, hits).map((entry) =>
      aiIds.has(entry.id) ? { ...entry, source: "ai" as const }
        : cachedIdsRef.current.has(entry.id) ? { ...entry, source: "cache" as const } : entry);
    judgedRef.current = judged;
    entriesRef.current = list;
    hitsRef.current = hits;
    setGroups(sortGroups(groupByOwner(judged)));
    const selectable = new Set(
      judged.filter((e) => canQuarantineEntry(e).allowed).map((e) => e.id),
    );
    setSelectedIds((prev) => new Set([...prev].filter((id) => selectable.has(id))));
    return judged;
  }, []);

  const refreshQuarantine = useCallback(async (root: FileSystemDirectoryHandle): Promise<QuarantineRecord[]> => {
    try {
      const list = await listQuarantine(root);
      setRecords(list);
      return list;
    } catch (err) {
      toast.error(`读取隔离区失败：${errorMessage(err)}`);
      return [];
    }
  }, []);

  // 审计写入失败绝不能回滚或阻断已经完成的清理，只提示用户。
  const writeJournal = useCallback(async (
    root: FileSystemDirectoryHandle,
    event: OpsEvent | null,
    quarantinedPaths: ReadonlySet<string>,
  ) => {
    try {
      if (event) await appendOpsManual(root, event);
      await syncFolderDictionary(root, judgedRef.current, quarantinedPaths);
    } catch (err) {
      toast.warning(`清理已完成，但操作记录/恢复说明写入失败：${journalError(err)}`);
    }
  }, []);

  // Unknown directories are the only ones worth a cloud call. Biggest first, so the
  // limited batch covers the space that actually matters instead of trivial folders.
  const enrichWithAi = useCallback(async (judged: JudgedEntry[]) => {
    const candidates = judged
      .filter((e) => e.kind === "directory" && !e.locked && e.verdict !== "keep_locked" && e.hit === null)
      .sort((a, b) => b.size - a.size)
      .slice(0, 24);
    if (!candidates.length) {
      setAiNotice(null);
      return;
    }
    const byId = new Map(entriesRef.current.map((e) => [e.id, e]));
    const keyToEntry = new Map<string, JudgedEntry>();
    const items = candidates.map((entry, index) => {
      const key = `e${index}`;
      keyToEntry.set(key, entry);
      return toJudgeItem(entry, byId, key);
    });
    setAiBusy(true);
    try {
      const response = await judgeDirectories(items);
      const nextHits = new Map(hitsRef.current);
      const nextAiIds = new Set(aiIdsRef.current);
      const nextCachedIds = new Set(cachedIdsRef.current);
      let downgraded = 0;
      for (const judgment of response.judgments) {
        const entry = keyToEntry.get(judgment.key);
        if (!entry) continue;
        // 低置信度的「推荐隔离」一律降档：AI 说了不算，够确信才敢推荐
        let verdict = judgment.verdict;
        let reason = judgment.reason;
        if (verdict === "safe_delete") {
          verdict = "needs_review";
          reason = `${reason}（云端判定不能直接作为推荐隔离依据，已降为需要确认）`;
          downgraded += 1;
        }
        nextHits.set(entry.id, {
          fingerprintId: judgment.fingerprint ?? `ai:${judgment.key}`,
          owner: judgment.owner,
          ownerKind: judgment.ownerKind,
          purpose: judgment.purpose,
          verdict,
          confidence: judgment.confidence,
          rebuildable: judgment.rebuildable,
          reason,
          consequence: judgment.consequence,
          revival: judgment.revival,
          evidence: judgment.evidence,
          source: judgment.origin === "ai" ? "ai" : "cache",
        });
        if (judgment.origin === "ai") nextAiIds.add(entry.id);
        else nextCachedIds.add(entry.id);
      }
      cachedIdsRef.current = nextCachedIds;
      aiIdsRef.current = nextAiIds;
      applyJudgment(entriesRef.current, nextHits, nextAiIds);
      const downgradeNote = downgraded > 0 ? `；其中 ${downgraded} 项因置信度不足降为「需要确认」` : "";
      if (response.aiStatus !== "ok") setAiNotice(AI_STATUS_TEXT[response.aiStatus] + downgradeNote);
      else if (response.judgments.length) {
        setAiNotice((response.cachedCount > 0
          ? `共享知识库命中 ${response.cachedCount} 条，其余 ${response.judgments.length - response.cachedCount} 条由云端 AI 判定`
          : `云端 AI 判定了 ${response.judgments.length} 个未识别目录`) + downgradeNote);
      } else setAiNotice(null);
    } catch (err) {
      setAiNotice(`${apiErrorText(err)}；已回退本地规则，这些目录保持「需要确认」，不会被自动删除。`);
    } finally {
      setAiBusy(false);
    }
  }, [applyJudgment]);

  const runScan = useCallback(async (
    root: FileSystemDirectoryHandle,
    nextSource: ScanSource,
    label: string,
  ) => {
    rootRef.current = root;
    aiIdsRef.current = new Set();
    cachedIdsRef.current = new Set();
    bufferRef.current = [];
    entriesRef.current = [];
    judgedRef.current = [];
    setSource(nextSource);
    setRootLabel(label);
    setError(null);
    setAiNotice(null);
    setGroups([]);
    setSelectedIds(new Set());
    setDrawerOpen(false);
    setDrawerIds([]);
    setReport(null);
    setReportSource(null);
    setActions([]);
    setScript(null);
    setReadonlyScript(null);
    setProgress({ ...IDLE_PROGRESS, phase: "scanning" });
    setView("review");

    const scanner = createScanner();
    scannerRef.current = scanner;
    try {
      const result = await scanner.start(
        root, DEFAULT_SCAN_OPTIONS, nextSource, label,
        (p) => setProgress(p),
        (batch) => { bufferRef.current.push(...batch); },
      );
      const all = result.entries;
      setProgress({ ...result.progress, phase: "judging" });
      const hits = matchAll(all);
      const judged = applyJudgment(all, hits, new Set());
      setProgress({ ...result.progress, phase: "ready" });
      const list = await refreshQuarantine(root);
      if (result.progress.stopped) {
        toast.info(`已停止扫描，保留已发现的 ${all.length} 项结果；不完整目录已禁止整体隔离`);
      }
      if (localOnlyRef.current) {
        setAiNotice(null);
      } else {
        await enrichWithAi(judged);
      }
      // 扫描后即建立/更新文件夹名录，清理后再追加运维手册
      await writeJournal(root, null, new Set(list.filter((r) => !r.restored).map((r) => r.originalPath)));
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // 兼容不支持取消消息的旧浏览器：已扫到的部分照常判定，并明确标注结果不完整
        const partial = bufferRef.current;
        if (partial.length > 0) {
          const hits = matchAll(partial);
          applyJudgment(partial, hits, new Set());
          setProgress((prev) => ({ ...prev, phase: "ready", stopped: true }));
          void refreshQuarantine(root);
          toast.info(`已停止扫描，保留已发现的 ${partial.length} 项结果；不完整目录已禁止整体隔离`);
        } else {
          setProgress({ ...IDLE_PROGRESS, phase: "ready", stopped: true });
          toast.info("已停止扫描，尚未发现条目");
        }
        return;
      }
      setError(errorMessage(err));
      setProgress((prev) => ({ ...prev, phase: "error" }));
      retryRef.current = () => void runScan(root, nextSource, label);
    } finally {
      scannerRef.current = null;
    }
  }, [applyJudgment, enrichWithAi, refreshQuarantine, writeJournal]);

  const handleCancelScan = useCallback(() => {
    scannerRef.current?.cancel();
  }, []);

  // 演示数据已生成过就只重扫：重建会把已隔离的条目放回原位置，导致还原失败
  const handleSandbox = useCallback(async () => {
    setSandboxBusy(true);
    setSandboxProgress(null);
    setError(null);
    try {
      const root = await openSandboxRoot();
      if (!await sandboxReady(root)) {
        // 生成期间就切进结果工作台：首屏宣传到此为止，进度与骨架都在产品界面里显示
        rootRef.current = root;
        setSource("sandbox");
        setRootLabel(SANDBOX_LABEL);
        setGroups([]);
        setSelectedIds(new Set());
        setDrawerOpen(false);
        setDrawerIds([]);
        setView("review");
        setProgress({ ...IDLE_PROGRESS, phase: "scanning" });
        await generateSandbox(root, (created, total) => setSandboxProgress({ created, total }));
      }
      await runScan(root, "sandbox", SANDBOX_LABEL);
    } catch (err) {
      setError(errorMessage(err));
      setProgress((prev) => ({ ...prev, phase: "error" }));
      retryRef.current = () => void handleSandbox();
    } finally {
      setSandboxBusy(false);
      setSandboxProgress(null);
    }
  }, [runScan]);

  // showDirectoryPicker must run inside the gesture; no await before it.
  const handlePickLocal = useCallback(() => {
    if (!localSupported) {
      setError("当前浏览器不支持 File System Access API，请使用 Chrome 或 Edge，或先用演示模式体验完整流程。");
      retryRef.current = handlePickLocal;
      return;
    }
    void (async () => {
      try {
        const root = await openLocalRoot();
        await runScan(root, "local", root.name);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(errorMessage(err));
        setProgress((prev) => ({ ...prev, phase: "error" }));
        retryRef.current = handlePickLocal;
      }
    })();
  }, [localSupported, runScan]);

  const handleResetSandbox = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    setResetOpen(false);
    setSandboxBusy(true);
    setSandboxProgress(null);
    try {
      const skipPaths = new Set(records.filter((r) => !r.restored).map((r) => r.originalPath));
      await clearSandbox(root);
      await generateSandbox(
        root,
        (created, total) => setSandboxProgress({ created, total }),
        skipPaths,
      );
      await runScan(root, "sandbox", SANDBOX_LABEL);
      toast.success(skipPaths.size > 0
        ? `演示数据已重置，跳过 ${skipPaths.size} 项仍在隔离区的内容；真实文件不受影响`
        : "演示数据已重置，未影响任何真实文件");
    } catch (err) {
      toast.error(`重置失败：${errorMessage(err)}`);
    } finally {
      setSandboxBusy(false);
      setSandboxProgress(null);
    }
  }, [records, runScan]);

  const selectedEntries = useMemo(() => {
    const all = judgedRef.current;
    const byId = new Map(all.map((e) => [e.id, e]));
    const picked = all.filter(
      (e) => selectedIds.has(e.id) && canQuarantineEntry(e).allowed,
    );
    const pickedIds = new Set(picked.map((e) => e.id));
    // 父子同时勾选时只保留最上层：体积不重复累加，隔离也不会把同一份数据搬两次
    return picked.filter((e) => {
      let cursor = e.parentId;
      while (cursor) {
        if (pickedIds.has(cursor)) return false;
        cursor = byId.get(cursor)?.parentId ?? null;
      }
      return true;
    });
  }, [selectedIds, groups]);
  const selectedBytes = useMemo(
    () => selectedEntries.reduce((sum, e) => sum + e.size, 0),
    [selectedEntries],
  );

  // 选择条出现或换行时立刻重量一次，不依赖 ResizeObserver 的帧投递
  useEffect(() => { measureDock(); }, [measureDock, selectedEntries.length, busy, view]);

  const drawerEntry = useMemo(() => {
    const id = drawerIds[drawerIndex];
    if (!id) return null;
    return judgedRef.current.find((e) => e.id === id) ?? null;
  }, [drawerIds, drawerIndex, groups]);

  const openEntry = useCallback((entry: JudgedEntry, visible: JudgedEntry[]) => {
    const navigation = createDrawerNavigation(entry.id, visible);
    setDrawerIds(navigation.ids);
    setDrawerIndex(navigation.index);
    setDrawerOpen(true);
  }, []);

  const navigateDrawer = useCallback((delta: number) => {
    setDrawerIndex((prev) => clamp(prev + delta, 0, Math.max(0, drawerIds.length - 1)));
  }, [drawerIds.length]);

  const handleDownloadJournal = useCallback(async (name: string) => {
    const root = rootRef.current;
    if (!root) return;
    try {
      const text = await readJournal(root, name);
      if (!text) {
        toast.warning(`${name} 尚未生成，先完成一次扫描或清理。`);
        return;
      }
      downloadText(name, text);
    } catch (err) {
      toast.error(`读取 ${name} 失败：${errorMessage(err)}`);
    }
  }, []);

  const toggleEntry = useCallback((entry: JudgedEntry, selected: boolean) => {
    if (!canQuarantineEntry(entry).allowed) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(entry.id); else next.delete(entry.id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((group: OwnerGroup, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const entry of group.entries) {
        if (!canQuarantineEntry(entry).allowed) continue;
        if (selected) next.add(entry.id); else next.delete(entry.id);
      }
      return next;
    });
  }, []);

  const activeRecordCount = useMemo(
    () => records.filter((r) => !r.restored).length,
    [records],
  );
  const expiredRecords = useMemo(
    () => records.filter((r) => !r.restored && r.expiresAt <= Date.now()),
    [records],
  );

  const handleQuarantine = useCallback(async () => {
    const root = rootRef.current;
    // 扫描未完成（或正在操作）时不提供隔离：门禁在 handler 与按钮两侧都生效
    if (!root || !selectedEntries.length || busy || progress.phase !== "ready") return;
    setBusy(true);
    setQuarantineProgress(null);
    try {
      await ensureWritePermission(root);
      const outcome = await quarantineEntries(
        root, selectedEntries, QUARANTINE_TTL_DAYS,
        undefined,
        (done, total) => setQuarantineProgress({ done, total }),
      );
      const { created, skipped, failures, needsReconcile } = outcome;
      if (created.length === 0) {
        setConfirmOpen(false);
        toast.warning(skipped.length > 0
          ? `没有隔离任何内容：${skipped.length} 项已有未还原的隔离记录，原位置却又出现了同名内容。先到隔离区处理旧记录，再回来重试。`
          : needsReconcile.length > 0
            ? `隔离状态无法确认：${needsReconcile[0].reason}。已保留副本并标记「需要恢复检查」。`
            : failures.length > 0
              ? `隔离失败（原文件保留）：${failures[0].reason}`
              : "没有可隔离的条目。");
        return;
      }
      const moved = new Set(created.map((r) => r.originalPath));
      // 先写审计：此时 judgedRef 仍含被移走的条目，名录才能标注「本次已移入隔离区」
      await writeJournal(root, {
        operation: "quarantine",
        at: Date.now(),
        items: itemsFromEntries(selectedEntries.filter((e) => moved.has(e.path))),
        note: `保留 ${QUARANTINE_TTL_DAYS} 天，到期后仍需用户确认才会彻底删除。`,
      }, moved);
      const remaining = entriesRef.current.filter((e) =>
        !moved.has(e.path) && ![...moved].some((p) => e.path.startsWith(`${p}/`)));
      applyJudgment(remaining, hitsRef.current, aiIdsRef.current);
      setSelectedIds(new Set());
      setConfirmOpen(false);
      setDrawerOpen(false);
      await refreshQuarantine(root);
      toast.success(`已隔离 ${created.length} 项（${formatBytes(created.reduce((s, r) => s + r.size, 0))}），${QUARANTINE_TTL_DAYS} 天内可一键还原`);
      if (skipped.length > 0) {
        toast.warning(`${skipped.length} 项被跳过：${skipped[0].reason}`);
      }
      if (failures.length > 0) {
        toast.error(`${failures.length} 项隔离失败，原文件保留：${failures[0].reason}`);
      }
      if (needsReconcile.length > 0) {
        toast.error(`${needsReconcile.length} 项状态无法确认，已标记「需要恢复检查」并保留隔离副本：${needsReconcile[0].reason}`);
      }
      setView("quarantine");
    } catch (err) {
      toast.error(`隔离失败：${errorMessage(err)}`);
    } finally {
      setBusy(false);
      setQuarantineProgress(null);
    }
  }, [selectedEntries, busy, progress.phase, applyJudgment, refreshQuarantine, writeJournal]);

  const handleQuarantineOne = useCallback((entry: JudgedEntry) => {
    if (progress.phase !== "ready") return;
    setSelectedIds(new Set([entry.id]));
    setConfirmOpen(true);
  }, [progress.phase]);

  const doRestore = useCallback(async (record: QuarantineRecord, policy: RestorePolicy) => {
    const root = rootRef.current;
    if (!root || busyId) return;
    setBusyId(record.id);
    setRestoreBusy(true);
    try {
      await ensureWritePermission(root);
      const outcome = await restoreEntries(root, [record], policy);
      const list = await refreshQuarantine(root);
      if (outcome.restored.length > 0) {
        await writeJournal(root, {
          operation: "restore",
          at: Date.now(),
          items: itemsFromRecords(outcome.restored),
        }, new Set(list.filter((r) => !r.restored).map((r) => r.originalPath)));
        toast.success(`已还原到原位置：${record.originalPath}`);
      }
      if (outcome.failures.length > 0) {
        toast.error(`还原失败：${outcome.failures[0].reason}`);
      }
      if (outcome.needsReconcile.length > 0) {
        toast.error(`还原状态无法确认：${outcome.needsReconcile[0].reason}，已标记「需要恢复检查」`);
      }
    } catch (err) {
      toast.error(`还原失败：${errorMessage(err)}`);
    } finally {
      setBusyId(null);
      setRestoreBusy(false);
    }
  }, [busyId, refreshQuarantine, writeJournal]);

  const handleRestore = useCallback(async (record: QuarantineRecord) => {
    const root = rootRef.current;
    if (!root || busy || busyId) return;
    try {
      // 同名冲突必须先问用户：跳过 / 保留两份，不静默覆盖
      const conflicts = await restoreConflicts(root, [record]);
      if (conflicts.length > 0) {
        setRestoreConflict(record);
        return;
      }
      await doRestore(record, "skip");
    } catch (err) {
      toast.error(`还原失败：${errorMessage(err)}`);
    }
  }, [busy, busyId, doRestore]);

  const handleDeleteRecord = useCallback(async (record: QuarantineRecord) => {
    const root = rootRef.current;
    if (!root || busy || busyId) return;
    setBusyId(record.id);
    try {
      await ensureWritePermission(root);
      const result = await deleteQuarantined(root, record);
      if (result === "missing") {
        toast.info("这条记录已不存在，无需再删除");
        return;
      }
      const auditOnly = result === "audit";
      const list = await refreshQuarantine(root);
      const items = itemsFromRecords([record]);
      await writeJournal(root, {
        operation: auditOnly ? "delete_audit" : "delete",
        at: Date.now(),
        items: auditOnly ? items.map((item) => ({ ...item, size: 0 })) : items,
        note: auditOnly
          ? "已还原记录只移除审计行；原文件与审计文档保留。"
          : "用户主动彻底删除单项，已不可还原。",
      }, new Set(list.filter((r) => !r.restored).map((r) => r.originalPath)));
      toast.success(auditOnly ? "已删除审计记录；原文件与审计文档保留" : "已彻底删除该项");
    } catch (err) {
      toast.error(`删除失败：${errorMessage(err)}`);
    } finally {
      setBusyId(null);
    }
  }, [busy, busyId, refreshQuarantine, writeJournal]);

  const handleClearQuarantine = useCallback(async () => {
    const root = rootRef.current;
    if (!root || busy) return;
    setBusy(true);
    try {
      const active = records.filter((r) => !r.restored);
      await ensureWritePermission(root);
      await emptyQuarantine(root);
      const list = await refreshQuarantine(root);
      await writeJournal(root, {
        operation: "clear",
        at: Date.now(),
        items: itemsFromRecords(active),
        note: "操作记录与恢复说明作为审计历史保留，未随隔离区清空。",
      }, new Set(list.filter((r) => !r.restored).map((r) => r.originalPath)));
      toast.success("隔离区已清空");
    } catch (err) {
      toast.error(`清空失败：${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }, [records, busy, refreshQuarantine, writeJournal]);

  const handlePurgeExpired = useCallback(async () => {
    const root = rootRef.current;
    if (!root || !expiredRecords.length || busy) return;
    setPurgeOpen(false);
    setBusy(true);
    try {
      await ensureWritePermission(root);
      const remaining = await purgeExpired(root, records);
      const keptIds = new Set(remaining.map((r) => r.id));
      const purged = records.filter((r) => !keptIds.has(r.id));
      setRecords(remaining);
      await writeJournal(root, {
        operation: "purge",
        at: Date.now(),
        items: itemsFromRecords(purged),
        note: "超过保留期并经用户确认执行，已不可还原。",
      }, new Set(remaining.filter((r) => !r.restored).map((r) => r.originalPath)));
      toast.success(`已清理 ${purged.length} 项到期隔离内容`);
    } catch (err) {
      toast.error(`清理到期项失败：${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }, [expiredRecords.length, records, busy, writeJournal]);

  const diagnosisTargets = useMemo(() => {
    const targets: string[] = [];
    const direct = diagnoseTarget.trim();
    if (/^[A-Za-z]:[\\/]/.test(direct)) targets.push(direct);
    if (rootAbsPath.trim()) {
      if (!direct && diagnoseRelative) {
        const fromBoard = joinAbsolute(rootAbsPath, diagnoseRelative);
        if (fromBoard) targets.push(fromBoard);
      }
      for (const entry of selectedEntries.slice(0, 8)) {
        const absolute = joinAbsolute(rootAbsPath, entry.path);
        if (absolute) targets.push(absolute);
      }
    }
    return [...new Set(targets)].slice(0, 32);
  }, [diagnoseTarget, diagnoseRelative, rootAbsPath, selectedEntries]);

  const diagnosisSubject = useMemo(() => {
    const direct = diagnoseTarget.trim();
    if (direct) return direct.split(/[\\/]/).filter(Boolean).pop() ?? "";
    return selectedEntries[0]?.name
      ?? diagnoseRelative.split("/").filter(Boolean).pop()
      ?? "";
  }, [diagnoseTarget, diagnoseRelative, selectedEntries]);

  const localDiagnosis = useMemo(() => {
    if (!scriptOutput.trim()) return { report: null, error: null };
    try {
      return { report: parseDiagnosisReport(scriptOutput), error: null };
    } catch (err) {
      return { report: null, error: errorMessage(err) };
    }
  }, [scriptOutput]);

  useEffect(() => setCloudPayloadPreview(null), [diagnosisSubject, symptoms, scriptOutput]);

  // 复活提示必须能一键跳到诊断，并把目标与症状预填好，而不是让用户自己再找一遍
  const openDiagnoseFor = useCallback((
    name: string,
    path: string,
    revival: RevivalMechanism[],
  ) => {
    const absolute = joinAbsolute(rootAbsPath, path);
    if (absolute) setDiagnoseTarget(absolute);
    setDiagnoseRelative(path);
    const mechanisms = [...new Set(revival)].map((m) => REVIVAL_LABEL[m] ?? m).join("、");
    setSymptoms((prev) => prev.trim() ? prev : `「${name}」删后重建或无法卸载${mechanisms ? `，检测到${mechanisms}` : ""}。`);
    setDrawerOpen(false);
    setDiagnoseError(null);
    setView("diagnose");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [rootAbsPath]);

  const handleDiagnoseGroup = useCallback((group: OwnerGroup) => {
    const target = group.entries.find((e) => (e.hit?.revival.length ?? 0) > 0) ?? group.entries[0];
    if (!target) return;
    openDiagnoseFor(target.name, target.path, group.revival);
  }, [openDiagnoseFor]);

  const handleDiagnoseEntry = useCallback((entry: JudgedEntry) => {
    openDiagnoseFor(entry.name, entry.path, entry.hit?.revival ?? []);
  }, [openDiagnoseFor]);

  const handleReadonlyScript = useCallback(() => {
    setDiagnoseError(null);
    if (!diagnosisTargets.length) {
      setDiagnoseError("请先填写问题文件夹的完整路径（例如 C:\\Program Files\\SomeApp）。浏览器出于隐私保护不会告诉我们完整路径，需要你从资源管理器地址栏复制。");
      return;
    }
    try {
      setReadonlyScript(buildReadOnlyDiagnosticScript(diagnosisTargets));
    } catch (err) {
      setDiagnoseError(errorMessage(err));
    }
  }, [diagnosisTargets]);

  const importLocalReport = useCallback((raw: string) => {
    try {
      const parsed = parseDiagnosisReport(raw);
      setReport(parsed);
      setReportSource("local");
      setActions(planCleanupActions(parsed));
      setDiagnoseError(null);
      setScript(null);
      toast.success(`已解析本地诊断结果：${parsed.findings.length} 处发现`);
      return true;
    } catch (err) {
      setDiagnoseError(errorMessage(err));
      return false;
    }
  }, []);

  const handleImportFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setDiagnoseError("诊断结果文件过大，请选择脚本直接输出的 diagnosis.json。");
      return;
    }
    try {
      const raw = await file.text();
      setScriptOutput(raw);
      importLocalReport(raw);
    } catch {
      setDiagnoseError("读取诊断结果文件失败，请重新选择。");
    }
  }, [importLocalReport]);

  const handleDiagnose = useCallback(async () => {
    if (!diagnosisSubject) {
      setDiagnoseError("请先填写问题文件夹路径，或在审核台勾选至少一项。");
      return;
    }
    if (!symptoms.trim()) {
      setDiagnoseError("请描述症状，例如「删掉后又出现在 C 盘」「资源管理器里找不到」「提示在别处打开」。");
      return;
    }
    if (localDiagnosis.error) {
      setDiagnoseError(localDiagnosis.error);
      return;
    }

    const localReport = localDiagnosis.report;
    setDiagnoseError(null);
    setScript(null);
    setReportSource(localReport ? "local" : null);
    if (localReport) {
      setReport(localReport);
      setActions(planCleanupActions(localReport));
    } else {
      setReport(null);
      setActions([]);
    }

    if (localOnly || source === "sandbox") {
      if (localReport) {
        const notice = source === "sandbox"
          ? "演示模式默认使用本地证据解析，未请求云端。"
          : "当前为仅本地模式，以下为本地证据解析结果。";
        setReport(withLocalDiagnosisNotice(localReport, "not_configured", notice));
      } else {
        setDiagnoseError("当前为本地模式，请粘贴只读诊断 JSON 后再生成建议。");
      }
      return;
    }

    setDiagnoseBusy(true);
    try {
      const response = await requestDiagnosis({
        subject: diagnosisSubject,
        symptoms: symptoms.trim(),
        evidence: localReport?.evidence ?? [],
      });
      if (response.report && localReport) {
        const merged = mergeAiDiagnosis(localReport, response.report);
        setReport(merged);
        setReportSource("ai");
        setActions(planCleanupActions(merged));
      } else if (response.report) {
        setReport({
          findings: response.report.findings,
          evidence: [],
          collectionId: "",
          officialUninstaller: null,
          generatedAt: response.report.generatedAt,
          raw: "",
          advice: response.report.advice,
          aiStatus: "ok",
          ...(response.report.aiMetadata ? { aiMetadata: response.report.aiMetadata } : {}),
          summary: "没有本地诊断证据，以下仅为 AI 推断；不会生成可执行处方。",
        });
        setReportSource("ai");
        setActions([]);
      } else if (localReport) {
        setReport(withLocalDiagnosisNotice(localReport, response.aiStatus, DIAGNOSE_AI_STATUS_TEXT[response.aiStatus]));
        setReportSource("local");
        setActions(planCleanupActions(localReport));
      } else {
        setReportSource(null);
        setDiagnoseError(DIAGNOSE_AI_STATUS_TEXT[response.aiStatus]);
      }
    } catch (err) {
      if (localReport) {
        setReport(withLocalDiagnosisNotice(localReport, "unavailable", "云端辅助分析不可用，以下为本地证据解析结果"));
        setReportSource("local");
        setActions(planCleanupActions(localReport));
      } else {
        setReportSource(null);
        setDiagnoseError(apiErrorText(err));
      }
    } finally {
      setDiagnoseBusy(false);
    }
  }, [diagnosisSubject, localDiagnosis, localOnly, source, symptoms]);

  const handlePreviewCloudData = useCallback(() => {
    if (localDiagnosis.error) {
      setDiagnoseError(localDiagnosis.error);
      return;
    }
    try {
      const payload = buildCloudDiagnosisPayload({
        subject: diagnosisSubject,
        symptoms: symptoms.trim(),
        evidence: localDiagnosis.report?.evidence ?? [],
      });
      setCloudPayloadPreview(JSON.stringify(payload, null, 2));
    } catch (err) {
      setDiagnoseError(errorMessage(err));
    }
  }, [diagnosisSubject, localDiagnosis.report, symptoms]);

  const toggleAction = useCallback((action: CleanupAction, selected: boolean) => {
    setActions((prev) => prev.map((a) => a.id === action.id ? { ...a, selected } : a));
    setScript(null);
  }, []);

  const handleGenerateScript = useCallback(() => {
    const chosen = actions.filter((a) => a.selected);
    if (!chosen.length) {
      toast.warning("请至少勾选一项清理动作。高危项默认不勾选。");
      return;
    }
    try {
      setScript(buildCleanupScript(chosen));
      toast.success("脚本已生成，建议先 dry-run 查看将要执行的操作");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, [actions]);

  const uninstallGuidance = useMemo(
    () => (report ? resolveUninstallGuidance(report) : null),
    [report],
  );

  const phase: ScanPhase = progress.phase;
  const scanning = phase === "scanning" || phase === "judging";
  const boardItemCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.itemCount, 0),
    [groups],
  );
  const revivalGroups = useMemo(
    () => groups.filter((g) => rebuildMechanisms(g.revival).length > 0),
    [groups],
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative min-h-dvh text-foreground">
        <div aria-hidden className="dc-space" />
        <div aria-hidden className="dc-grain" />

        <div
          className="relative z-10 mx-auto w-full max-w-6xl px-4 sm:px-6"
          style={{ paddingBottom: dockHeight + 24 }}
        >
          <AppHeader
            source={source}
            rootLabel={rootLabel}
            localSupported={localSupported}
            onUseSandbox={() => void handleSandbox()}
            onPickLocal={handlePickLocal}
          />

          <main className="grid gap-4 pt-4">
            {source === null ? (
              <>
                <LandingHero
                  onGenerate={() => void handleSandbox()}
                  generating={sandboxBusy}
                  progress={sandboxProgress}
                  onPickLocal={handlePickLocal}
                  localSupported={localSupported}
                />
                {!localSupported && (
                  <ErrorState
                    unsupported
                    message="当前浏览器不支持访问本地磁盘（需要 Chrome / Edge 的 File System Access API）。你仍然可以用演示模式完整体验扫描、分类审核、隔离与还原。"
                    onUseSandbox={() => void handleSandbox()}
                  />
                )}
                {error && (
                  <ErrorState
                    message={error}
                    onRetry={() => retryRef.current()}
                    onUseSandbox={() => void handleSandbox()}
                  />
                )}
                <Panel className="dc-tone-info dc-rail rounded-xl px-4 py-3">
                  <Collapsible>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="dc-display flex items-center gap-2 text-sm font-semibold tracking-wide">
                        <ShieldCheck aria-hidden className="dc-tone-text size-4" />
                        能力边界，先说清楚
                      </h2>
                      <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                        浏览器读不到注册表与卸载器；顽固软件靠「只读诊断脚本 + 本地结果解析」处理，AI 建议需另行开启，动注册表前必先征得你同意。
                      </p>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="xs" className="group/boundary ml-auto shrink-0 text-muted-foreground">
                          详细说明
                          <ChevronDown aria-hidden className="transition-transform duration-200 group-data-[state=open]/boundary:rotate-180" />
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <p className="mt-2 border-t border-hairline pt-2.5 text-xs leading-relaxed text-muted-foreground">
                        这是能力边界而不是权限问题：网页无法枚举服务、计划任务与卸载器。
                        顽固软件诊断分四步：选择问题目录、生成并运行<strong className="text-foreground">只读</strong>脚本、
                        导入结果文件、查看本地诊断建议。需要时可再请求云端 AI 辅助分析，结果来源会明确标注。
                        任何触及注册表或卸载的动作，都会先向你申请确认；优先走官方卸载器，手改注册表是最后手段。
                      </p>
                    </CollapsibleContent>
                  </Collapsible>
                </Panel>
              </>
            ) : (
              <>
                <div data-region="scan-bar">
                  <ScanStatusBar
                    progress={progress}
                    rootLabel={rootLabel}
                    preparing={sandboxProgress}
                    onCancel={handleCancelScan}
                    source={source}
                    localOnly={localOnly}
                    onLocalOnlyChange={setLocalOnly}
                    aiBusy={aiBusy}
                    aiNotice={aiNotice}
                  />
                </div>

                <Tabs value={view} onValueChange={setView}>
                  <TabsList className="dc-panel h-auto w-full flex-wrap justify-start gap-1 rounded-xl p-1.5">
                    <TabsTrigger value="review" className={TAB_CLASS}>
                      <ListChecks aria-hidden />
                      分类审核台
                      {boardItemCount > 0 && <span className="dc-num text-xs opacity-70">{boardItemCount}</span>}
                    </TabsTrigger>
                    <TabsTrigger value="quarantine" className={TAB_CLASS}>
                      <Archive aria-hidden />
                      隔离区
                      {activeRecordCount > 0 && <span className="dc-num text-xs opacity-70">{activeRecordCount}</span>}
                    </TabsTrigger>
                    <TabsTrigger value="diagnose" className={TAB_CLASS}>
                      <Stethoscope aria-hidden />
                      顽固软件诊断
                      {revivalGroups.length > 0 && <span className="dc-num text-xs opacity-70">{revivalGroups.length}</span>}
                    </TabsTrigger>
                    <TabsTrigger value="knowledge" className={TAB_CLASS}>
                      <BookOpen aria-hidden />
                      判定规则
                    </TabsTrigger>
                  </TabsList>

                  {error && (
                    <ErrorState
                      message={error}
                      onRetry={() => { const root = rootRef.current; if (root) void runScan(root, source, rootLabel); }}
                      onUseSandbox={source === "local" ? () => void handleSandbox() : undefined}
                    />
                  )}

                  <TabsContent value="review" className="mt-4">
                    <div data-region="review-board" className="grid gap-3">
                      <RevivalSummary groups={revivalGroups} onDiagnose={handleDiagnoseGroup} />
                      {groups.length === 0 && scanning ? (
                        <ReviewBoard
                          groups={groups}
                          selectedIds={selectedIds}
                          onToggleEntry={toggleEntry}
                          onToggleGroup={toggleGroup}
                          onOpenEntry={openEntry}
                          loading
                        />
                      ) : groups.length === 0 ? (
                        <EmptyState
                          title={progress.stopped ? "已停止扫描，没有发现条目" : "这个目录下没有可清理的内容"}
                          description={progress.stopped
                            ? "扫描被手动停止且尚未发现条目。可以重新扫描，或换一个目录。"
                            : "没有发现缓存、临时文件或残留目录。可以换一个目录，或重置演示数据（不影响真实文件）。"}
                          action={source === "sandbox"
                            ? <Button variant="outline" onClick={() => setResetOpen(true)} disabled={sandboxBusy}>
                                <RefreshCw aria-hidden />重置演示数据
                              </Button>
                            : <Button variant="outline" onClick={handlePickLocal}>
                                <FolderSearch aria-hidden />换一个文件夹
                              </Button>}
                        />
                      ) : (
                        <ReviewBoard
                          groups={groups}
                          selectedIds={selectedIds}
                          onToggleEntry={toggleEntry}
                          onToggleGroup={toggleGroup}
                          onOpenEntry={openEntry}
                          onDiagnose={handleDiagnoseGroup}
                          activeEntryId={drawerOpen ? drawerEntry?.id ?? null : null}
                          loading={scanning}
                          scannedCount={judgedRef.current.length}
                          totalBytes={progress.bytes}
                          truncated={progress.truncated}
                          stopped={progress.stopped}
                          coverage={progress.coverage}
                          source={source}
                          onResetSandbox={() => setResetOpen(true)}
                          resetting={sandboxBusy}
                        />
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="quarantine" className="mt-4">
                    <div data-region="quarantine" className="grid gap-3">
                      {expiredRecords.length > 0 && (
                        <div className="dc-panel dc-rail dc-tone-danger flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
                          <TriangleAlert aria-hidden className="dc-tone-text size-4 shrink-0" />
                          <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                            <strong className="dc-tone-text text-sm">
                              {expiredRecords.length} 项已超过 {QUARANTINE_TTL_DAYS} 天保留期。
                            </strong>
                            到期清理会彻底删除这些内容，不可还原，需要你确认后执行。
                          </p>
                          <Button size="sm" variant="destructive" onClick={() => setPurgeOpen(true)} disabled={busy}>
                            {busy ? <Spinner /> : <TriangleAlert aria-hidden />}
                            清理到期项
                          </Button>
                        </div>
                      )}

                      <QuarantineView
                        records={records}
                        onRestore={(record) => void handleRestore(record)}
                        onDelete={(record) => void handleDeleteRecord(record)}
                        onClearAll={() => void handleClearQuarantine()}
                        busyId={busyId}
                        busy={busy}
                        source={source}
                      />

                      <Panel className="grid gap-2.5 rounded-xl px-4 py-3.5">
                        <h2 className="dc-display flex items-center gap-2 text-sm font-semibold tracking-wide">
                          <FileDown aria-hidden className="size-4 text-muted-foreground" />
                          操作记录与恢复说明
                        </h2>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          每次扫描与清理后，{PRODUCT_NAME}会在隔离区目录内自动写入两份审计文件：操作记录保存做了什么、为什么、怎么撤回；恢复说明标注每个文件夹是什么、归属谁、能不能删。清空隔离区不会抹掉这两份审计历史。
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => void handleDownloadJournal(OPS_MANUAL_NAME)}>
                            <FileDown aria-hidden />下载操作记录
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => void handleDownloadJournal(FOLDER_DICTIONARY_NAME)}>
                            <FileDown aria-hidden />下载恢复说明
                          </Button>
                        </div>
                      </Panel>
                    </div>
                  </TabsContent>

                  <TabsContent value="diagnose" className="mt-4">
                    <div data-region="diagnose" className="grid gap-4">
                      <RevivalSummary groups={revivalGroups} onDiagnose={handleDiagnoseGroup} />
                      <Panel className="dc-tone-info dc-rail grid gap-2 rounded-xl px-4 py-3.5">
                        <h2 className="dc-display flex items-center gap-2 text-sm font-semibold tracking-wide">
                          <ShieldCheck aria-hidden className="dc-tone-text size-4" />
                          顽固软件诊断：查找删后重建、无法卸载的原因
                        </h2>
                        <ol className="grid gap-2 text-xs leading-relaxed text-muted-foreground sm:grid-cols-4">
                          {["选择问题目录", "生成并运行只读脚本", "导入诊断结果文件", "查看本地建议"].map((step, index) => (
                            <li key={step} className="flex items-start gap-2"><span className="dc-num dc-tone-text font-semibold">{index + 1}</span>{step}</li>
                          ))}
                        </ol>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          浏览器无法访问注册表、服务与卸载器——这是能力边界，不是权限问题。所以这里分两步：
                          ① 生成<strong className="text-foreground">只读</strong>诊断脚本，由你在本机以普通权限运行，结果写入 UTF-8 文件后再导入；
                          ② 先在本地解析证据，再可选请求云端辅助解释。只有你主动选择提升权限时才以管理员身份运行；AI 负责辅助解释，处置脚本由本地安全模板生成，默认 dry-run，高危项默认不勾选。
                        </p>
                      </Panel>

                      <Panel className="grid gap-3.5 rounded-xl px-4 py-4">
                        <div className="grid gap-1.5">
                          <Label htmlFor="root-abs" className="dc-label text-muted-foreground">
                            扫描根目录的完整路径（可选）
                          </Label>
                          <Input
                            id="root-abs"
                            value={rootAbsPath}
                            placeholder="C:\Users\你的用户名\AppData\Local"
                            className="dc-path"
                            onChange={(event) => {
                              setRootAbsPath(event.target.value);
                              localStorage.setItem("dareclean.rootAbsPath", event.target.value);
                            }}
                          />
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            填写后，审核台勾选的条目会自动换算成绝对路径作为诊断目标。浏览器出于隐私不返回完整路径，需要你从资源管理器地址栏复制。
                          </p>
                        </div>
                        {diagnoseRelative && (
                          <p className="dc-tone-info dc-tone-bg dc-tone-border flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs">
                            <ToneDot tone="dc-tone-info" />
                            <span className="dc-tone-text font-medium">来自审核台的诊断目标</span>
                            <code className="dc-path text-muted-foreground">{diagnoseRelative}</code>
                            <span className="w-full text-muted-foreground">
                              {diagnosisTargets.length > 0
                                ? `已换算为 ${diagnosisTargets[0]}`
                                : "填写上方「扫描根目录的完整路径」后，即可换算成绝对路径并生成只读脚本。"}
                            </span>
                          </p>
                        )}
                        <div className="grid gap-1.5">
                          <Label htmlFor="diagnose-target" className="dc-label text-muted-foreground">
                            1 · 选择问题目录完整路径
                          </Label>
                          <Input
                            id="diagnose-target"
                            value={diagnoseTarget}
                            placeholder="C:\Program Files\SomeCloudDrive"
                            className="dc-path"
                            onChange={(event) => setDiagnoseTarget(event.target.value)}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor="symptoms" className="dc-label text-muted-foreground">症状描述</Label>
                          <Textarea
                            id="symptoms"
                            value={symptoms}
                            rows={3}
                            placeholder="删掉后又出现在 C 盘；资源管理器里找不到这个文件夹；一直提示「在别处打开」；卸载入口找不到。"
                            onChange={(event) => setSymptoms(event.target.value)}
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={handleReadonlyScript} disabled={diagnoseBusy}>
                            <FileDown aria-hidden />
                            生成只读诊断脚本
                          </Button>
                          {readonlyScript && (
                            <Button
                              variant="outline"
                              onClick={() => downloadText("dareclean-diagnose.ps1", readonlyScript)}
                            >
                              <FileDown aria-hidden />
                              下载 dareclean-diagnose.ps1
                            </Button>
                          )}
                          <Button variant="outline" asChild>
                            <label htmlFor="diagnosis-file" className="cursor-pointer">
                              <FileUp aria-hidden />3 · 选择诊断结果文件
                            </label>
                          </Button>
                          <input
                            id="diagnosis-file"
                            type="file"
                            accept=".json,application/json"
                            className="sr-only"
                            onChange={async (event) => {
                              const input = event.currentTarget;
                              const file = input.files?.[0];
                              if (file) await handleImportFile(file);
                              input.value = "";
                            }}
                          />
                          <Button onClick={() => importLocalReport(scriptOutput)} disabled={diagnoseBusy || !scriptOutput.trim()}>
                            <ListChecks aria-hidden />查看本地建议
                          </Button>
                          <Button variant="outline" onClick={handlePreviewCloudData} disabled={diagnoseBusy}>
                            查看将发送的数据
                          </Button>
                          <Button onClick={() => void handleDiagnose()} disabled={diagnoseBusy} title="本地优先生成建议；仅本地或演示模式不会请求云端">
                            {diagnoseBusy ? <Spinner /> : <Sparkles aria-hidden />}
                            {diagnoseBusy ? "生成建议中…" : "生成诊断建议"}
                          </Button>
                        </div>
                        {readonlyScript && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            在本机 PowerShell 以普通权限运行：
                            <code className="dc-path mx-1 rounded bg-muted px-1 py-0.5">
                              powershell -ExecutionPolicy Bypass -File .\dareclean-diagnose.ps1
                            </code>
                            2 · 脚本只枚举与读取，不删除、不修改任何内容；结果写入当前目录的 <code className="dc-path">dareclean-diagnosis.json</code>（UTF-8 无 BOM），再回到这里导入。
                          </p>
                        )}
                        <Collapsible>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="group/advanced w-fit">
                              高级选项：粘贴 JSON
                              <ChevronDown aria-hidden className="transition-transform group-data-[state=open]/advanced:rotate-180" />
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="grid gap-1.5 pt-2">
                            <Label htmlFor="script-output" className="dc-label text-muted-foreground">只读脚本输出（可选，粘贴 diagnosis.json 内容）</Label>
                            <Textarea
                              id="script-output"
                              value={scriptOutput}
                              rows={5}
                              className="dc-path"
                              placeholder="不粘贴也可以请求云端辅助分析，但不会生成可执行处方；AI 只能凭症状推断。"
                              onChange={(event) => setScriptOutput(event.target.value)}
                            />
                          </CollapsibleContent>
                        </Collapsible>
                        {localOnly && <p className="text-xs text-muted-foreground">当前仅本地规则：云端建议已停用，导入文件后仍可完整查看本地诊断与处理建议。</p>}
                        {diagnoseError && (
                          <p role="alert" className="dc-tone-danger dc-tone-bg dc-tone-border dc-tone-text rounded-lg border px-3 py-2 text-xs leading-relaxed">
                            {diagnoseError}
                          </p>
                        )}
                        {cloudPayloadPreview && (
                          <div className="dc-tone-info dc-tone-bg dc-tone-border grid gap-2 rounded-lg border px-3 py-2">
                            <p className="dc-tone-info dc-tone-text text-xs font-medium">
                              将发送到云端的脱敏数据（不含完整诊断 JSON、用户路径或可执行目标）
                            </p>
                            <pre className="dc-path max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
                              {cloudPayloadPreview}
                            </pre>
                          </div>
                        )}
                      </Panel>

                      {uninstallGuidance && (
                        <Panel className="dc-tone-safe dc-rail grid gap-2 rounded-xl px-4 py-3.5">
                          <h3 className="dc-display flex items-center gap-2 text-sm font-semibold tracking-wide">
                            <ShieldCheck aria-hidden className="dc-tone-text size-4" />
                            {uninstallGuidance.preferOfficial ? "优先走官方卸载器" : "未找到可信的官方卸载器"}
                          </h3>
                          <ol className="ml-4 grid list-decimal gap-1 text-xs leading-relaxed text-muted-foreground">
                            {uninstallGuidance.steps.map((step, index) => <li key={index}>{step}</li>)}
                          </ol>
                          {uninstallGuidance.preferOfficial && uninstallGuidance.uninstallString && (
                            <code className="dc-path block break-all rounded-md border border-hairline bg-void/60 px-2.5 py-2 text-xs text-foreground">
                              {uninstallGuidance.uninstallString}
                            </code>
                          )}
                          {uninstallGuidance.warning && (
                            <p className="dc-tone-danger dc-tone-text text-xs leading-relaxed">
                              {uninstallGuidance.warning}
                            </p>
                          )}
                        </Panel>
                      )}

                      {report?.advice && reportSource === "ai" && (
                        <Panel className="dc-tone-ai dc-rail grid gap-1.5 rounded-xl px-4 py-3.5">
                          <h3 className="dc-display flex items-center gap-2 text-sm font-semibold tracking-wide">
                            <Sparkles aria-hidden className="dc-tone-text size-4" />
                            云端辅助建议
                          </h3>
                          <p className="text-xs leading-relaxed text-muted-foreground">{report.advice}</p>
                        </Panel>
                      )}

                      <DiagnosePanel
                        report={report}
                        actions={actions}
                        onToggleAction={toggleAction}
                        onGenerateScript={handleGenerateScript}
                        onDownloadScript={() => { if (script) downloadText("dareclean-cleanup.ps1", script); }}
                        loading={diagnoseBusy && !report}
                        scriptReady={Boolean(script)}
                        reportSource={reportSource}
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="knowledge" className="mt-4">
                    <RulesPanel />
                  </TabsContent>
                </Tabs>
              </>
            )}

            <footer className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline pt-3 text-xs text-muted-foreground">
              <span className="dc-display tracking-wide">{PRODUCT_NAME}</span>
              <span aria-hidden className="text-hairline">/</span>
              <span>{PRODUCT_PHILOSOPHY}</span>
              <span className="ml-auto">扫描与判定在浏览器内完成 · 隔离 {QUARANTINE_TTL_DAYS} 天 · 彻底删除始终需要你确认</span>
            </footer>
          </main>
        </div>

        <div ref={dockRef} className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 sm:px-6">
          <div data-region="selection-summary">
            <SelectionSummaryBar
              selectedCount={selectedEntries.length}
              selectedBytes={selectedBytes}
              onQuarantine={() => setConfirmOpen(true)}
              onClear={() => setSelectedIds(new Set())}
              busy={busy}
              disabled={phase !== "ready"}
              busyLabel={quarantineProgress ? `隔离中 ${quarantineProgress.done}/${quarantineProgress.total}` : null}
              awayFromReview={view !== "review"}
              onGoReview={() => setView("review")}
            />
          </div>
        </div>

        <EntryDrawer
          entry={drawerEntry}
          open={drawerOpen && drawerEntry !== null}
          onOpenChange={setDrawerOpen}
          selected={drawerEntry ? selectedIds.has(drawerEntry.id) : false}
          onToggleSelect={toggleEntry}
          onQuarantine={handleQuarantineOne}
          onDiagnose={handleDiagnoseEntry}
          onNavigate={navigateDrawer}
          position={drawerEntry ? { index: drawerIndex, total: drawerIds.length } : null}
          busy={busy || phase !== "ready"}
        />

        <ConfirmQuarantineDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          entries={selectedEntries}
          onConfirm={() => void handleQuarantine()}
          busy={busy}
          busyLabel={quarantineProgress ? `隔离中 ${quarantineProgress.done}/${quarantineProgress.total}` : null}
        />

        <RestoreConflictDialog
          open={restoreConflict !== null}
          onOpenChange={(open) => { if (!open) setRestoreConflict(null); }}
          record={restoreConflict}
          busy={restoreBusy}
          onChoose={(policy) => {
            const record = restoreConflict;
            setRestoreConflict(null);
            if (record) void doRestore(record, policy);
          }}
        />

        <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
          <AlertDialogContent className="dc-panel dc-tone-danger rounded-xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="dc-display tracking-wide">
                彻底删除 {expiredRecords.length} 项到期内容？
              </AlertDialogTitle>
              <AlertDialogDescription>
                这些条目已超过 {QUARANTINE_TTL_DAYS} 天保留期。执行后将从隔离区永久移除，无法再还原；
                操作记录与恢复说明作为审计历史保留。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void handlePurgeExpired()}>
                确认彻底删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialogContent className="dc-panel dc-tone-review rounded-xl">
            <AlertDialogHeader>
              <AlertDialogTitle className="dc-display tracking-wide">重置演示数据？</AlertDialogTitle>
              <AlertDialogDescription>
                会清空浏览器沙箱里的模拟目录并重新生成一套，不会影响任何真实文件。
                {activeRecordCount > 0
                  ? `仍在隔离区的 ${activeRecordCount} 项会被跳过，不会重新出现在原位置，你的隔离与还原记录保持有效。`
                  : "当前隔离区为空，重置不会影响任何真实数据。"}
                真实磁盘不受影响。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleResetSandbox()}>
                <RefreshCw aria-hidden />
                确认重置
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Toaster />
      </div>
    </TooltipProvider>
  );
}