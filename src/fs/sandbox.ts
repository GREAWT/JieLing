import { QUARANTINE_DIR } from "../core/constants";
import { ensureDirectoryPath, errorMessage, writeTextFile } from "./adapter";

export const SANDBOX_LABEL = "样本磁盘（沙盒）";
export const SANDBOX_MARKER = ".dareclean-sandbox.json";

interface SandboxOp {
  path: string;
  content?: string | Uint8Array<ArrayBuffer>;
}

function pseudoBytes(size: number, seed: number, header?: number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  if (header) out.set(header, 0);
  let s = seed >>> 0;
  for (let i = header ? header.length : 0; i < size; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = (s >>> 24) & 0xff;
  }
  return out;
}

const LOG_MESSAGES = [
  "sync engine started, worker pool size=4",
  "GET /api/v2/files?cursor=8f3a21 -> 200 (143ms)",
  "checkpoint written: offset=1048576 segment=000000000000001A",
  "retrying request after transient network error (attempt 2/5)",
  "cache eviction: removed 128 entries, freed 4194304 bytes",
  "WARN: certificate expires in 12 days, scheduling renewal",
  "upload task queued: report-final-v3.pdf (102400 bytes)",
  "database vacuum finished in 84ms",
  "ERROR: failed to open handle for locked file, sharing violation",
  "heartbeat ok, uptime=38211s, rss=182MB",
  "config reloaded from disk, 3 keys changed",
  "DEBUG: dispatcher flushed 42 pending events",
];

function logText(service: string, lines: number, seed: number): string {
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const levels = ["INFO", "INFO", "INFO", "DEBUG", "WARN", "ERROR"];
  const base = Date.UTC(2025, 10, 2, 8, 0, 0);
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    const t = new Date(base + i * 1700 + Math.floor(rnd() * 900)).toISOString();
    out.push(`${t} [${levels[Math.floor(rnd() * levels.length)]}] ${service}: ${LOG_MESSAGES[Math.floor(rnd() * LOG_MESSAGES.length)]}`);
  }
  return out.join("\n") + "\n";
}

function jsBundle(name: string, targetBytes: number): string {
  const verbs = ["createElement", "renderRoot", "scheduleWork", "diffChildren", "commitUpdate", "hydrateNode", "resolveDep", "flushQueue"];
  const parts: string[] = [`/* ${name} — production bundle, generated. Do not edit. */\n"use strict";\n`];
  let len = parts[0].length;
  let i = 0;
  while (len < targetBytes) {
    const fn =
      `function ${verbs[i % verbs.length]}_${i}(a, b) {\n` +
      `  const c = a == null ? 0 : a.length;\n` +
      `  if (c > ${i % 97}) { return b.map((x) => x + ${i % 13}); }\n` +
      `  return a ? a.concat(b) : [];\n` +
      `}\n`;
    parts.push(fn);
    len += fn.length;
    i++;
  }
  parts.push(`export { ${verbs[0]}_0 as default };\n`);
  return parts.join("");
}

function pkgJson(name: string, version: string, main: string, deps: Record<string, string> = {}): string {
  return JSON.stringify(
    { name, version, description: `${name} — installed dependency`, main, license: "MIT", dependencies: deps },
    null,
    2,
  ) + "\n";
}

const KB = 1024;
const MZ = [0x4d, 0x5a, 0x90, 0x00];
const PK = [0x50, 0x4b, 0x03, 0x04];
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff, 0xe0];

function buildOps(): SandboxOp[] {
  const ops: SandboxOp[] = [];
  const dir = (path: string): void => {
    ops.push({ path });
  };
  const file = (path: string, content: string | Uint8Array<ArrayBuffer>): void => {
    ops.push({ path, content });
  };

  file("pagefile.sys", pseudoBytes(256 * KB, 11));
  file("hiberfil.sys", pseudoBytes(128 * KB, 12));

  dir("Projects");
  dir("Projects/webapp");
  file("Projects/webapp/package.json", JSON.stringify({
    name: "webapp",
    private: true,
    version: "0.3.2",
    type: "module",
    scripts: { dev: "vite", build: "tsc -b && vite build", preview: "vite preview" },
    dependencies: { react: "^19.2.0", "react-dom": "^19.2.0", lodash: "^4.17.21" },
    devDependencies: { typescript: "~5.9.3", vite: "^8.0.16", esbuild: "^0.25.0" },
  }, null, 2) + "\n");
  file("Projects/webapp/vite.config.ts", `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n  build: { sourcemap: false },\n});\n`);
  file("Projects/webapp/tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", strict: true, jsx: "react-jsx", module: "ESNext", moduleResolution: "Bundler" }, include: ["src"] }, null, 2) + "\n");
  file("Projects/webapp/index.html", `<!doctype html>\n<html lang="zh-CN">\n  <head>\n    <meta charset="UTF-8" />\n    <title>webapp</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`);
  file("Projects/webapp/README.md", "# webapp\n\n内部演示项目。\n\n## 开发\n\n```bash\nnpm install\nnpm run dev\n```\n\n构建产物在 dist/，可安全删除后重新生成。\n");
  dir("Projects/webapp/src");
  file("Projects/webapp/src/main.tsx", `import { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")!).render(<App />);\n`);
  file("Projects/webapp/src/App.tsx", `import { useState } from "react";\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  return (\n    <main>\n      <h1>webapp</h1>\n      <button onClick={() => setCount(count + 1)}>点击 {count}</button>\n    </main>\n  );\n}\n`);
  file("Projects/webapp/src/styles.css", ":root { color-scheme: light dark; }\nbody { margin: 0; font-family: system-ui, sans-serif; }\nmain { max-width: 720px; margin: 0 auto; padding: 2rem; }\nbutton { padding: 0.5rem 1rem; border-radius: 8px; }\n");
  file("Projects/webapp/src/utils.ts", `export function formatBytes(n: number): string {\n  if (n < 1024) return n + " B";\n  const units = ["KB", "MB", "GB", "TB"];\n  let v = n / 1024;\n  let i = 0;\n  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }\n  return v.toFixed(1) + " " + units[i];\n}\n`);

  dir("Projects/webapp/dist");
  file("Projects/webapp/dist/index.html", `<!doctype html>\n<html lang="zh-CN">\n  <head>\n    <meta charset="UTF-8" />\n    <title>webapp</title>\n    <script type="module" crossorigin src="/assets/index-Bx3k9.js"></script>\n    <link rel="stylesheet" crossorigin href="/assets/index-D7m2.css">\n  </head>\n  <body><div id="root"></div></body>\n</html>\n`);
  dir("Projects/webapp/dist/assets");
  file("Projects/webapp/dist/assets/index-Bx3k9.js", jsBundle("webapp/assets/index", 200 * KB));
  file("Projects/webapp/dist/assets/index-D7m2.css", Array.from({ length: 400 }, (_, i) => `.c-${i}{display:flex;gap:${i % 16}px;padding:${i % 8}px;border-radius:${i % 12}px;color:hsl(${(i * 7) % 360} 40% 45%)}`).join("\n") + "\n");
  file("Projects/webapp/dist/assets/logo-Ck81.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#4f46e5" d="M12 2 2 7l10 5 10-5-10-5Zm0 12L2 9v8l10 5 10-5V9l-10 5Z"/></svg>\n`);

  dir("Projects/webapp/.next");
  dir("Projects/webapp/.next/cache");
  file("Projects/webapp/.next/cache/0.pack", pseudoBytes(250 * KB, 21));
  file("Projects/webapp/.next/cache/1.pack", pseudoBytes(200 * KB, 22));
  file("Projects/webapp/.next/cache/index.pack", pseudoBytes(40 * KB, 23));

  dir("Projects/webapp/node_modules");
  file("Projects/webapp/node_modules/.package-lock.json", JSON.stringify({ name: "webapp", lockfileVersion: 3, requires: true, packages: { "node_modules/react": { version: "19.2.0" }, "node_modules/react-dom": { version: "19.2.0" }, "node_modules/lodash": { version: "4.17.21" } } }, null, 2) + "\n");
  dir("Projects/webapp/node_modules/.bin");
  file("Projects/webapp/node_modules/.bin/vite", "#!/bin/sh\nexec node \"$(dirname \"$0\")/../vite/bin/vite.js\" \"$@\"\n");
  file("Projects/webapp/node_modules/.bin/tsc", "#!/bin/sh\nexec node \"$(dirname \"$0\")/../typescript/bin/tsc\" \"$@\"\n");

  dir("Projects/webapp/node_modules/react");
  file("Projects/webapp/node_modules/react/package.json", pkgJson("react", "19.2.0", "index.js"));
  file("Projects/webapp/node_modules/react/index.js", `'use strict';\nmodule.exports = require('./cjs/react.production.js');\n`);
  dir("Projects/webapp/node_modules/react/cjs");
  file("Projects/webapp/node_modules/react/cjs/react.production.js", jsBundle("react/cjs/react.production", 180 * KB));
  file("Projects/webapp/node_modules/react/LICENSE", "MIT License\n\nCopyright (c) Meta Platforms, Inc. and affiliates.\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software...\n");
  file("Projects/webapp/node_modules/react/README.md", "# react\n\nReact is a JavaScript library for building user interfaces.\n\nSee https://react.dev for documentation.\n");

  dir("Projects/webapp/node_modules/react-dom");
  file("Projects/webapp/node_modules/react-dom/package.json", pkgJson("react-dom", "19.2.0", "index.js", { react: "^19.2.0", scheduler: "^0.27.0" }));
  file("Projects/webapp/node_modules/react-dom/index.js", `'use strict';\nmodule.exports = require('./cjs/react-dom.production.js');\n`);
  file("Projects/webapp/node_modules/react-dom/client.js", `'use strict';\nexports.createRoot = require('./cjs/react-dom-client.production.js').createRoot;\n`);
  dir("Projects/webapp/node_modules/react-dom/cjs");
  file("Projects/webapp/node_modules/react-dom/cjs/react-dom.production.js", jsBundle("react-dom/cjs/react-dom.production", 300 * KB));
  file("Projects/webapp/node_modules/react-dom/LICENSE", "MIT License\n\nCopyright (c) Meta Platforms, Inc. and affiliates.\n");

  dir("Projects/webapp/node_modules/scheduler");
  file("Projects/webapp/node_modules/scheduler/package.json", pkgJson("scheduler", "0.27.0", "index.js"));
  file("Projects/webapp/node_modules/scheduler/index.js", jsBundle("scheduler", 16 * KB));
  file("Projects/webapp/node_modules/scheduler/LICENSE", "MIT License\n\nCopyright (c) Meta Platforms, Inc. and affiliates.\n");

  dir("Projects/webapp/node_modules/lodash");
  file("Projects/webapp/node_modules/lodash/package.json", pkgJson("lodash", "4.17.21", "lodash.js"));
  file("Projects/webapp/node_modules/lodash/lodash.js", jsBundle("lodash", 200 * KB));
  file("Projects/webapp/node_modules/lodash/LICENSE", "The MIT License (MIT)\n\nCopyright JS Foundation and other contributors <https://js.foundation/>\n");

  dir("Projects/webapp/node_modules/typescript");
  file("Projects/webapp/node_modules/typescript/package.json", pkgJson("typescript", "5.9.3", "lib/typescript.js"));
  dir("Projects/webapp/node_modules/typescript/lib");
  file("Projects/webapp/node_modules/typescript/lib/typescript.js", jsBundle("typescript/lib/typescript", 300 * KB));
  file("Projects/webapp/node_modules/typescript/lib/tsc.js", `#!/usr/bin/env node\n"use strict";\nconst ts = require("./typescript.js");\nts.executeCommandLine(ts.sys, ts.noop, ts.sys.args);\n`);
  file("Projects/webapp/node_modules/typescript/LICENSE", "Apache License 2.0\n\nCopyright (c) Microsoft Corporation. All rights reserved.\n");

  dir("Projects/webapp/node_modules/esbuild");
  file("Projects/webapp/node_modules/esbuild/package.json", pkgJson("esbuild", "0.25.0", "lib/main.js"));
  file("Projects/webapp/node_modules/esbuild/install.js", `#!/usr/bin/env node\n"use strict";\n// Validates the platform-specific binary after install.\nconst { validateBinaryVersion } = require("./lib/main.js");\nvalidateBinaryVersion(process.argv.slice(2));\n`);
  dir("Projects/webapp/node_modules/esbuild/bin");
  file("Projects/webapp/node_modules/esbuild/bin/esbuild", pseudoBytes(200 * KB, 31, MZ));
  file("Projects/webapp/node_modules/esbuild/LICENSE", "MIT License\n\nCopyright (c) 2020 Evan Wallace\n");

  dir("Projects/webapp/node_modules/vite");
  file("Projects/webapp/node_modules/vite/package.json", pkgJson("vite", "8.0.16", "dist/node/index.js", { esbuild: "^0.25.0" }));
  dir("Projects/webapp/node_modules/vite/dist");
  dir("Projects/webapp/node_modules/vite/dist/node");
  file("Projects/webapp/node_modules/vite/dist/node/index.js", jsBundle("vite/dist/node/index", 150 * KB));
  dir("Projects/webapp/node_modules/vite/dist/node/chunks");
  file("Projects/webapp/node_modules/vite/dist/node/chunks/dep-8a2b.js", jsBundle("vite/dep-8a2b", 180 * KB));
  file("Projects/webapp/node_modules/vite/LICENSE", "MIT License\n\nCopyright (c) 2019-present, VoidZero Inc. and Vite contributors\n");

  dir("Projects/ml-notes");
  file("Projects/ml-notes/train.py", `import argparse\nfrom pathlib import Path\n\n\ndef main() -> None:\n    parser = argparse.ArgumentParser(description="train a tiny classifier")\n    parser.add_argument("--epochs", type=int, default=10)\n    parser.add_argument("--data", type=Path, required=True)\n    args = parser.parse_args()\n    print(f"training on {args.data} for {args.epochs} epochs")\n\n\nif __name__ == "__main__":\n    main()\n`);
  file("Projects/ml-notes/requirements.txt", "numpy==2.1.3\npandas==2.2.3\nscikit-learn==1.5.2\n");
  file("Projects/ml-notes/notes.md", "# 实验记录\n\n- 2025-10-12: baseline acc 0.81\n- 2025-10-19: 加特征后 acc 0.84\n- 2025-11-01: 待办——清理 __pycache__ 后再打包\n");
  dir("Projects/ml-notes/__pycache__");
  file("Projects/ml-notes/__pycache__/train.cpython-312.pyc", pseudoBytes(6 * KB, 41, [0xcb, 0x0d, 0x0d, 0x0a]));
  file("Projects/ml-notes/__pycache__/utils.cpython-312.pyc", pseudoBytes(4 * KB, 42, [0xcb, 0x0d, 0x0d, 0x0a]));
  file("Projects/ml-notes/__pycache__/data.cpython-312.pyc", pseudoBytes(9 * KB, 43, [0xcb, 0x0d, 0x0d, 0x0a]));

  dir(".gradle");
  dir(".gradle/caches");
  dir(".gradle/caches/jars-9");
  dir(".gradle/caches/jars-9/a1b2c3");
  file(".gradle/caches/jars-9/a1b2c3/guava-32.1.3.jar", pseudoBytes(300 * KB, 51, PK));
  dir(".gradle/caches/8.5");
  dir(".gradle/caches/8.5/fileHashes");
  file(".gradle/caches/8.5/fileHashes/fileHashes.bin", pseudoBytes(60 * KB, 52));
  dir(".gradle/caches/8.5/executionHistory");
  file(".gradle/caches/8.5/executionHistory/executionHistory.bin", pseudoBytes(80 * KB, 53));

  dir("AppData");
  dir("AppData/Local");
  dir("AppData/Local/Temp");
  for (let i = 0; i < 28; i++) {
    const hex = ((i * 2654435761) >>> 0).toString(16).toUpperCase().padStart(8, "0").slice(0, 6);
    const size = (2 + ((i * 37) % 58)) * KB;
    const content = i % 3 === 0 ? logText("tmp-installer", Math.max(4, Math.floor(size / 110)), 100 + i) : pseudoBytes(size, 100 + i);
    file(`AppData/Local/Temp/tmp${hex}.tmp`, content);
  }
  file("AppData/Local/Temp/chrome_installer.log", logText("chrome-installer", 160, 7));
  file("AppData/Local/Temp/vscode-update.log", logText("vscode-update", 120, 8));

  dir("AppData/Local/Google");
  dir("AppData/Local/Google/Chrome");
  dir("AppData/Local/Google/Chrome/User Data");
  dir("AppData/Local/Google/Chrome/User Data/Default");
  dir("AppData/Local/Google/Chrome/User Data/Default/Cache");
  dir("AppData/Local/Google/Chrome/User Data/Default/Cache/Cache_Data");
  file("AppData/Local/Google/Chrome/User Data/Default/Cache/Cache_Data/index", pseudoBytes(200 * KB, 61));
  for (let i = 1; i <= 6; i++) {
    file(`AppData/Local/Google/Chrome/User Data/Default/Cache/Cache_Data/f_${String(i).padStart(6, "0")}`, pseudoBytes((60 + i * 15) * KB, 60 + i));
  }
  dir("AppData/Local/Google/Chrome/User Data/Default/GPUCache");
  file("AppData/Local/Google/Chrome/User Data/Default/GPUCache/index", pseudoBytes(30 * KB, 71));
  file("AppData/Local/Google/Chrome/User Data/Default/GPUCache/data_0", pseudoBytes(80 * KB, 72));
  file("AppData/Local/Google/Chrome/User Data/Default/GPUCache/data_1", pseudoBytes(150 * KB, 73));
  file("AppData/Local/Google/Chrome/User Data/Default/Preferences", JSON.stringify({ profile: { name: "Person 1", avatar_index: 3 }, download: { default_directory: "C:\\Users\\user\\Downloads" }, session: { restore_on_startup: 1 }, intl: { accept_languages: "zh-CN,zh,en" } }, null, 2) + "\n");
  file("AppData/Local/Google/Chrome/User Data/Default/History", pseudoBytes(120 * KB, 74, Array.from("SQLite format 3\0", (c) => c.charCodeAt(0))));
  dir("AppData/Local/Google/Chrome/User Data/Crashpad");
  file("AppData/Local/Google/Chrome/User Data/Crashpad/settings.dat", pseudoBytes(1 * KB, 75));
  dir("AppData/Local/Google/Chrome/User Data/Crashpad/reports");
  file("AppData/Local/Google/Chrome/User Data/Crashpad/reports/9f2e1c3a-0d4b-4e5f-9a8b-1c2d3e4f5a6b.dmp", pseudoBytes(60 * KB, 76, Array.from("MDMP", (c) => c.charCodeAt(0))));
  file("AppData/Local/Google/Chrome/User Data/Crashpad/reports/2b7d8e9f-1a2b-4c3d-8e9f-0a1b2c3d4e5f.dmp", pseudoBytes(90 * KB, 77, Array.from("MDMP", (c) => c.charCodeAt(0))));
  file("AppData/Local/Google/Chrome/User Data/Crashpad/reports/5c6d7e8f-9a0b-4c1d-2e3f-4a5b6c7d8e9f.dmp", pseudoBytes(120 * KB, 78, Array.from("MDMP", (c) => c.charCodeAt(0))));
  dir("AppData/Local/SomeApp");
  dir("AppData/Local/SomeApp/logs");

  dir("Downloads");
  file("Downloads/report-final-v3.pdf", pseudoBytes(100 * KB, 81, PDF));
  file("Downloads/installer-setup.exe", pseudoBytes(80 * KB, 82, MZ));
  dir("Downloads/New Folder");
  dir("Downloads/New Folder (2)");

  dir("Documents");
  file("Documents/简历-2025.docx", pseudoBytes(36 * KB, 83, PK));
  file("Documents/项目计划.xlsx", pseudoBytes(22 * KB, 84, PK));
  file("Documents/会议纪要-2025-11.md", "# 产品评审会 2025-11-03\n\n参会：产品 / 前端 / 后端 / 测试\n\n## 结论\n\n1. 隔离区默认保留 7 天，到期后需用户确认才彻底删除\n2. 「建议保留」组不允许一键全选删除\n3. 复活风险必须展示证据链\n\n## 待办\n\n- [ ] 前端补充还原冲突提示\n- [ ] 后端补充指纹库覆盖率统计\n");
  file("Documents/家庭预算.csv", "月份,类别,金额,备注\n2025-08,房租,3200,\n2025-08,餐饮,1450.5,\n2025-08,交通,260,地铁月票\n2025-09,房租,3200,\n2025-09,餐饮,1320,\n2025-09,数码,899,机械键盘\n2025-10,房租,3200,\n2025-10,餐饮,1580.25,\n2025-10,医疗,230,体检\n");
  file("Documents/合同扫描件.pdf", pseudoBytes(120 * KB, 85, PDF));
  dir("Documents/EmptyProject");

  dir("Pictures");
  file("Pictures/全家福-2024.jpg", pseudoBytes(160 * KB, 86, JPG));
  file("Pictures/毕业照.png", pseudoBytes(240 * KB, 87, PNG));
  dir("Pictures/旅行");
  file("Pictures/旅行/海边.jpg", pseudoBytes(100 * KB, 88, JPG));
  file("Pictures/旅行/山顶.jpg", pseudoBytes(90 * KB, 89, JPG));
  dir("Pictures/截图");
  file("Pictures/截图/screenshot-01.png", pseudoBytes(60 * KB, 90, PNG));
  file("Pictures/截图/screenshot-02.png", pseudoBytes(55 * KB, 91, PNG));

  dir("YunPan");
  file("YunPan/YunPan.exe", pseudoBytes(6 * KB, 92, MZ));
  file("YunPan/config.json", JSON.stringify({ installDir: "C:\\Program Files\\YunPan", uninstallString: "C:\\Program Files\\YunPan\\uninst.exe", autoStart: true, shellNamespace: "{679F137C-3162-45da-BE3C-2F9C3D093F64}", lastSync: "2025-11-02T18:22:10Z" }, null, 2) + "\n");
  dir("YunPan/logs");
  file("YunPan/logs/sync-2025-10-28.log", logText("yunpan-sync", 200, 93));
  file("YunPan/logs/sync-2025-11-02.log", logText("yunpan-sync", 240, 94));
  file("YunPan/logs/error-2025-11-02.log", logText("yunpan-sync", 60, 95));
  dir("YunPan/shell");
  dir("YunPan/updates");

  dir("Apps");
  dir("Apps/SpeedSuite");
  file("Apps/SpeedSuite/readme.txt", "极速全家桶 安装说明\n\n本目录包含 极速浏览器 / 极速清理 / 极速托盘 三个组件。\n注意：卸载入口已随主程序移除，手动删除目录后托盘组件可能由计划任务重建。\n");
  dir("Apps/SpeedSuite/SpeedBrowser");
  file("Apps/SpeedSuite/SpeedBrowser/browser.exe", pseudoBytes(5 * KB, 96, MZ));
  file("Apps/SpeedSuite/SpeedBrowser/engine.dll", pseudoBytes(9 * KB, 97, MZ));
  file("Apps/SpeedSuite/SpeedBrowser/debug.log", logText("speed-browser", 40, 98));
  dir("Apps/SpeedSuite/SpeedCleaner");
  file("Apps/SpeedSuite/SpeedCleaner/cleaner.exe", pseudoBytes(5 * KB, 99, MZ));
  file("Apps/SpeedSuite/SpeedCleaner/scan.dll", pseudoBytes(8 * KB, 100, MZ));
  file("Apps/SpeedSuite/SpeedCleaner/scan.log", logText("speed-cleaner", 50, 101));
  dir("Apps/SpeedSuite/SpeedTray");
  file("Apps/SpeedSuite/SpeedTray/tray.exe", pseudoBytes(4 * KB, 102, MZ));
  file("Apps/SpeedSuite/SpeedTray/autostart.ini", "[autostart]\nrun_key=HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\SpeedTray\ntask_name=\\SpeedSuite\\SpeedTrayHeartbeat\ninterval_minutes=30\n");
  file("Apps/SpeedSuite/SpeedTray/tray.log", logText("speed-tray", 30, 103));

  dir("Windows.old");
  dir("Windows.old/Users");
  dir("Windows.old/Users/OldUser");
  file("Windows.old/Users/OldUser/NTUSER.DAT", pseudoBytes(128 * KB, 104, Array.from("regf", (c) => c.charCodeAt(0))));
  dir("Windows.old/Users/OldUser/Documents");
  file("Windows.old/Users/OldUser/Documents/旧简历.docx", pseudoBytes(28 * KB, 105, PK));
  file("Windows.old/Users/OldUser/Documents/毕业论文-最终版.docx", pseudoBytes(120 * KB, 106, PK));
  dir("Windows.old/Users/OldUser/Desktop");
  file("Windows.old/Users/OldUser/Desktop/备忘.txt", "旧系统迁移备忘：\n- 毕业论文最终版在 Documents 里，先确认再清理 Windows.old\n- 桌面快捷方式指向已卸载的云盘，可删\n");

  return ops;
}

export async function generateSandbox(
  root: FileSystemDirectoryHandle,
  onProgress?: (done: number, total: number) => void,
  skipPaths?: ReadonlySet<string>,
): Promise<void> {
  const ops = buildOps();
  const total = ops.length;
  const dirCache = new Map<string, FileSystemDirectoryHandle>([["", root]]);
  let done = 0;

  // 仍在隔离区登记的路径绝不能被重新生成：否则磁盘上出现第二份同名数据，
  // 账本与实物不一致，用户点「还原」会撞上「目标已存在」。
  const blocked = [...(skipPaths ?? [])];
  const isBlocked = (path: string): boolean =>
    blocked.some((p) => path === p || path.startsWith(`${p}/`));

  for (const op of ops) {
    if (isBlocked(op.path)) {
      done++;
      onProgress?.(done, total);
      continue;
    }
    const parts = op.path.split("/");
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join("/");
    try {
      let parent = dirCache.get(parentPath);
      if (!parent) {
        parent = await ensureDirectoryPath(root, parentPath);
        dirCache.set(parentPath, parent);
      }
      if (op.content === undefined) {
        await parent.getDirectoryHandle(name, { create: true });
      } else {
        const fileHandle = await parent.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        try {
          await writable.write(op.content);
          await writable.close();
        } catch (err) {
          try {
            await writable.abort();
          } catch {
            // abort 失败不掩盖原始写入错误
          }
          throw err;
        }
      }
    } catch (err) {
      throw new Error(`生成沙盒条目失败（${done}/${total}）: ${op.path}: ${errorMessage(err)}`, { cause: err });
    }
    done++;
    onProgress?.(done, total);
  }

  await writeTextFile(root, SANDBOX_MARKER, JSON.stringify({
    product: "jieling",
    kind: "sandbox",
    generatedAt: Date.now(),
    entries: total,
  }, null, 2));
}

/** 样本磁盘是否已生成过：已生成时「样本磁盘」只重新扫描，不再重写整棵树。 */
export async function sandboxReady(root: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await root.getFileHandle(SANDBOX_MARKER);
    return true;
  } catch {
    return false;
  }
}

export async function clearSandbox(root: FileSystemDirectoryHandle): Promise<void> {
  const names: string[] = [];
  for await (const name of root.keys()) names.push(name);
  for (const name of names) {
    // 隔离区不属于样本数据，清空沙盒不能连带删掉用户待还原的文件
    if (name === QUARANTINE_DIR) continue;
    try {
      await root.removeEntry(name, { recursive: true });
    } catch (err) {
      throw new Error(`清空沙盒失败（${name}）: ${errorMessage(err)}`, { cause: err });
    }
  }
}