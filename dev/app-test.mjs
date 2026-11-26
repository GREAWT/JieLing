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
  }

  const { AI_DIRECTORY_DATA_NOTICE } = await server.ssrLoadModule("/src/core/constants.ts");
  check("AI boundary copy names every transmitted field",
    typeof AI_DIRECTORY_DATA_NOTICE === "string"
      && ["脱敏", "目录名称", "层级", "扩展名", "统计信息", "不发送文件内容"]
        .every((word) => AI_DIRECTORY_DATA_NOTICE.includes(word))
      && !AI_DIRECTORY_DATA_NOTICE.includes("仅目录名送 AI"), AI_DIRECTORY_DATA_NOTICE);
} finally {
  await server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
