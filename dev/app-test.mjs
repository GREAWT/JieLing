import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { "@": root } },
  appType: "custom",
  cacheDir: fileURLToPath(new URL("../.vite-app", import.meta.url)),
  optimizeDeps: { noDiscovery: true },
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

try {
  const review = await server.ssrLoadModule("/src/app/review.ts").catch(() => null);
  check("review navigation helper is available", review !== null);

  if (review) {
    const entry = (id, verdict, priority) => ({ id, name: id, path: id, verdict, priority });
    const mixed = entry("mixed-locked", "keep_locked", 1);
    const pure = entry("pure-locked", "keep_locked", 9);
    const groups = [
      {
        owner: "混合分组",
        entries: [mixed],
        selectableCount: 1,
      },
      {
        owner: "纯保护分组",
        entries: [pure],
        selectableCount: 0,
      },
    ];

    const visible = review.reviewDrawerEntries(groups, "keep_locked");
    check("protected-only groups enter the drawer sequence",
      visible.some((item) => item.id === pure.id), visible.map((item) => item.id));
    const nav = review.createDrawerNavigation(pure.id, visible);
    check("drawer opens the clicked protected entry",
      nav.ids[nav.index] === pure.id && nav.ids.length === 2, nav);

    const missing = review.createDrawerNavigation("stale-entry", visible);
    check("unknown entry opens only itself instead of the first visible row",
      missing.ids.length === 1 && missing.ids[0] === "stale-entry" && missing.index === 0, missing);

    const ordered = review.reviewDrawerEntries([
      {
        owner: "排序",
        entries: [
          entry("review-high", "needs_review", 99),
          entry("safe-low", "safe_delete", 0),
        ],
        selectableCount: 1,
      },
    ], "all");
    check("drawer order matches the card order", ordered.map((item) => item.id).join(",") === "safe-low,review-high",
      ordered.map((item) => item.id));

    const nodeModules = {
      id: "node_modules", name: "node_modules", path: "Projects/webapp/node_modules", parentId: null, hit: null,
    };
    const lodash = {
      id: "lodash", name: "lodash", path: "Projects/webapp/node_modules/lodash", parentId: "node_modules", hit: null,
    };
    const lodashPkg = {
      id: "lodash-pkg", name: "package.json", path: "Projects/webapp/node_modules/lodash/package.json",
      parentId: "lodash", hit: null,
    };
    const src = { id: "src", name: "src", path: "Projects/webapp/src", parentId: null, hit: null };
    const appTsx = {
      id: "app-tsx", name: "App.tsx", path: "Projects/webapp/src/App.tsx", parentId: "src", hit: null,
    };
    const pagefile = { id: "pagefile", name: "pagefile.sys", path: "pagefile.sys", parentId: null, hit: null };
    const winOld = { id: "win-old", name: "Windows.old", path: "Windows.old", parentId: null, hit: null };
    const searchGroups = [
      { owner: "Node.js", entries: [nodeModules] },
      { owner: "src（未识别）", entries: [src] },
      { owner: "Windows（系统）", entries: [pagefile] },
      { owner: "Windows.old（未识别）", entries: [winOld] },
    ];
    const searchEntries = [nodeModules, lodash, lodashPkg, src, appTsx, pagefile, winOld];

    const deep = review.searchReviewEntries(searchGroups, searchEntries, "lodash");
    check("search maps a hidden nested file to its visible parent card",
      deep.ids.has("node_modules") && deep.ids.size === 1 && deep.scannedHits === 2, deep);
    check("hidden nested matches remain visible as card hints",
      (deep.hiddenMatches.get("node_modules") ?? []).some((path) => path.endsWith("/lodash"))
      && (deep.hiddenMatches.get("node_modules") ?? []).some((path) => path.endsWith("/package.json")),
      [...(deep.hiddenMatches.get("node_modules") ?? [])]);
    const byType = review.searchReviewEntries(searchGroups, searchEntries, "tsx");
    check("search finds ordinary files by extension inside a card",
      byType.ids.has("src") && byType.ids.size === 1, byType);
    const fallback = review.searchReviewEntries(searchGroups, searchEntries, "系统");
    check("owner-only match expands the group only when entries do not match",
      fallback.ids.has("pagefile") && fallback.scannedHits === 0, fallback);
    const exact = review.searchReviewEntries(searchGroups, searchEntries, "Windows.old");
    check("entry matches take precedence over broad owner fallback",
      exact.ids.has("win-old") && !exact.ids.has("pagefile"), exact);
    const normalized = review.searchReviewEntries(searchGroups, searchEntries, "projects\\webapp");
    check("search normalizes Windows separators and covers multiple groups",
      normalized.ids.has("node_modules") && normalized.ids.has("src"), normalized);
    const none = review.searchReviewEntries(searchGroups, searchEntries, "不存在的条目");
    check("empty search results stay empty", none.ids.size === 0 && none.scannedHits === 0, none);

    const locked = {
      id: "locked", name: "locked", path: "locked", verdict: "keep_locked", priority: 0,
      locked: true, source: "builtin", hit: null,
    };
    const safe = {
      id: "safe", name: "safe", path: "safe", verdict: "safe_delete", priority: 9,
      locked: false, source: "builtin", hit: null,
    };
    const mixedGroup = {
      owner: "混合", ownerKind: "unknown", entries: [safe, locked], totalSize: 123,
      itemCount: 2, verdict: "needs_review",
      counts: { safe_delete: 1, needs_review: 0, keep_locked: 1 },
      sizes: { safe_delete: 100, needs_review: 0, keep_locked: 23 },
      selectableCount: 1, maxPriority: 9, revival: [], hasAiJudgment: false,
    };
    const narrowed = review.narrowReviewGroup(mixedGroup, [locked]);
    check("filtered group recalculates selectable count and verdict",
      narrowed.selectableCount === 0 && narrowed.verdict === "keep_locked"
      && narrowed.counts.keep_locked === 1 && narrowed.totalSize === 123, narrowed);
  }

  const scanState = await server.ssrLoadModule("/src/app/scan-state.ts");
  check("scan state distinguishes scanning, judging and terminal results",
    scanState.scanUiState("scanning", 0) === "scanning"
    && scanState.scanUiState("judging", 10) === "judging"
    && scanState.scanUiState("ready", 10) === "complete"
    && scanState.scanUiState("ready", 0) === "empty"
    && scanState.scanUiState("ready", 10, true) === "stopped"
    && scanState.scanUiState("error", 3) === "error");
  check("scan labels use 扫描/完成/空结果/读取失败 terminology",
    scanState.SCAN_UI_LABEL.scanning === "扫描中"
    && scanState.SCAN_UI_LABEL.complete === "完成"
    && scanState.SCAN_UI_LABEL.empty === "空结果"
    && scanState.SCAN_UI_LABEL.error === "读取失败"
    && scanState.SCAN_UI_LABEL.stopped === "已停止");

  const { AI_DIRECTORY_DATA_NOTICE, isReadOnlyRootName } = await server.ssrLoadModule("/src/core/constants.ts");
  check("AI boundary copy names every transmitted field",
    typeof AI_DIRECTORY_DATA_NOTICE === "string"
      && ["脱敏", "目录名称", "层级", "扩展名", "统计信息", "不发送文件内容"]
        .every((word) => AI_DIRECTORY_DATA_NOTICE.includes(word))
      && !AI_DIRECTORY_DATA_NOTICE.includes("仅目录名送 AI"), AI_DIRECTORY_DATA_NOTICE);
  check("system protected roots are read-only but other roots are writable",
    isReadOnlyRootName("Program Files")
      && isReadOnlyRootName("Program Files (x86)")
      && isReadOnlyRootName("ProgramData")
      && isReadOnlyRootName("Windows")
      && !isReadOnlyRootName("Downloads")
      && !isReadOnlyRootName("MyProject"),
  );
  const locked = review.lockReadOnlyEntries([{
    id: "readonly", name: "readonly", path: "readonly", verdict: "safe_delete", priority: 100,
    hit: null, source: "builtin", locked: false,
  }]);
  check("read-only scan locks every entry before UI selection", locked.length === 1
    && locked[0].locked === true && locked[0].verdict === "keep_locked"
    && locked[0].priority === 0 && locked[0].lockReason.includes("只读扫描"), locked);

  let pickerOptions = null;
  globalThis.window = {
    showDirectoryPicker: async (options) => {
      pickerOptions = options;
      return { kind: "directory", name: "PickedFolder" };
    },
  };
  const adapter = await server.ssrLoadModule("/src/fs/adapter.ts");
  await adapter.openLocalRoot();
  check("real folder entry requests read permission only", pickerOptions?.mode === "read", pickerOptions);
  delete globalThis.window;
} finally {
  await server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
