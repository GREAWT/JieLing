import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error("无法分配测试端口")));
    });
  });
}

const VITE_PORT = await getFreePort();
const DEBUG_PORT = await getFreePort();
const BASE_URL = `http://127.0.0.1:${VITE_PORT}/`;

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path)) ?? null;
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待 ${url} 超时`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminate(child) {
  if (!child) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
    return;
  }
  if (child.exitCode === null) child.kill("SIGTERM");
}

function terminateBrowserProfile(profile) {
  if (process.platform !== "win32") return;
  const escaped = profile.replace(/'/g, "''");
  const script = [
    `Get-CimInstance Win32_Process`,
    `| Where-Object { $_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -like '*${escaped}*' }`,
    `| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  ].join(" ");
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: "ignore",
      timeout: 15_000,
    });
  } catch {
    // Cleanup is best-effort; the throwaway profile must not mask the test result.
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(message.params.exceptionDetails?.text ?? "Runtime exception");
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        this.errors.push(message.params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" "));
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }, 20_000).unref();
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "页面脚本执行失败");
    }
    return result.result?.value;
  }
  async waitFor(expression, label, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) return;
      await delay(250);
    }
    const tail = await this.evaluate("document.body.textContent.slice(-1600)").catch(() => "");
    throw new Error(`等待页面状态超时：${label}${tail ? `；页面尾部：${tail}` : ""}`);
  }
  async mouseClick(expression, label) {
    const point = await this.evaluate(`(() => {
      const el = ${expression};
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (!point) throw new Error(`找不到可点击元素：${label}`);
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

async function main() {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error("未找到 Chrome/Edge，无法运行演示模式浏览器闭环测试。");
  const profile = await mkdtemp(join(tmpdir(), "dareclean-e2e-"));
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(VITE_PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  vite.stderr.on("data", (chunk) => process.stderr.write(chunk));
  let browser;
  let cdp;
  try {
    await waitForHttp(BASE_URL);
    browser = spawn(browserPath, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      BASE_URL,
    ], { stdio: "ignore" });

    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    let target;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = list.find((entry) => entry.type === "page" && entry.url.startsWith(BASE_URL));
      if (target) break;
      await delay(200);
    }
    if (!target?.webSocketDebuggerUrl) throw new Error("无法连接浏览器调试页");

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    cdp = new Cdp(ws);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.waitFor("document.body.textContent.includes('进入演示模式')", "首页");
    await cdp.waitFor(
      "document.body.textContent.includes('脱敏后的目录名称、层级、扩展名和统计信息，不发送文件内容')",
      "首页 AI 数据边界文案",
    );
    await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('进入演示模式'));
      if (!button) throw new Error('找不到进入演示模式按钮');
      button.click();
      return true;
    })()`);
    await cdp.waitFor("document.body.textContent.includes('扫描完成')", "演示数据扫描完成", 120_000);
    await cdp.waitFor("document.body.textContent.includes('Node.js')", "审核台出现 Node.js 分组");

    await cdp.mouseClick(
      `[...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-pressed') === 'false'
        && item.textContent.includes('已保护项目'))`,
      "已保护项目筛选卡",
    );
    const protectedTarget = await cdp.evaluate(`(() => {
      const lockIcons = [...document.querySelectorAll('svg[aria-label="建议保留，已锁定"]')];
      for (const icon of lockIcons) {
        const section = icon.closest('section');
        const button = section?.querySelector('button[aria-label^="查看 "]');
        if (!button) continue;
        const label = button.getAttribute('aria-label');
        const name = label.slice(3, label.indexOf('：'));
        button.setAttribute('data-dc-test-target', 'protected');
        return name;
      }
      return null;
    })()`);
    if (!protectedTarget) throw new Error("默认保护筛选下没有找到纯受保护分组");
    await cdp.mouseClick("document.querySelector('[data-dc-test-target=\"protected\"]')", "纯受保护条目");
    await cdp.waitFor("Boolean(document.querySelector('[data-region=\"entry-drawer\"] h2'))", "受保护条目详情抽屉");
    const openedName = await cdp.evaluate("document.querySelector('[data-region=\"entry-drawer\"] h2').textContent");
    if (openedName !== protectedTarget) {
      throw new Error(`受保护条目抽屉错位：点击「${protectedTarget}」，打开「${openedName}」`);
    }
    await cdp.evaluate(`(() => {
      const close = document.querySelector('button[aria-label="关闭详情抽屉"]');
      if (!close) throw new Error('找不到详情抽屉关闭按钮');
      close.click();
      return true;
    })()`);
    await cdp.waitFor("document.querySelector('[data-region=\"entry-drawer\"]') === null", "关闭受保护条目抽屉");
    await cdp.evaluate(`(() => {
      const clear = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '清除筛选');
      if (!clear) throw new Error('找不到清除筛选按钮');
      clear.click();
      return true;
    })()`);
    await cdp.waitFor(`(() => [...document.querySelectorAll('button')].some((item) =>
      item.getAttribute('aria-label') === '全选 Node.js 的可清理项'))()`, "恢复完整审核台");

    await cdp.mouseClick(
      "document.querySelector('[aria-label=\"全选 Node.js 的可清理项\"]')",
      "Node.js 分组选择框",
    );
    await cdp.waitFor(`(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('移入隔离区') && !item.closest('[role=dialog]'));
      return Boolean(button && !button.disabled);
    })()`, "隔离按钮可用");
    await delay(300);
    await cdp.mouseClick(
      `[...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '移入隔离区' && !item.closest('[role=dialog]'))`,
      "移入隔离区按钮",
    );
    await cdp.waitFor(`(() => [...document.querySelectorAll('button')].some((item) => item.textContent.trim() === '确认移入隔离区'))()`, "隔离确认框");
    await cdp.waitFor(`(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '确认移入隔离区');
      return Boolean(button && !button.disabled);
    })()`, "确认隔离按钮可用");

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 320, deviceScaleFactor: 1, mobile: false,
    });
    await delay(300);
    const smallDialog = await cdp.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find((node) => node.textContent.includes('确认移入隔离区'));
      if (!dialog) return { ok: false, reason: '找不到隔离确认框' };
      const title = dialog.querySelector('[data-slot="dialog-title"]');
      const confirm = [...dialog.querySelectorAll('button')]
        .find((button) => button.textContent.trim() === '确认移入隔离区');
      const scroll = dialog.querySelector('[data-quarantine-scroll]');
      if (!title || !confirm) return { ok: false, reason: '标题或底部按钮缺失' };
      if (!scroll) return { ok: false, reason: '缺少独立滚动容器' };
      const titleRect = title.getBoundingClientRect();
      const confirmRect = confirm.getBoundingClientRect();
      return {
        ok: titleRect.top >= 0 && titleRect.bottom <= innerHeight
          && confirmRect.top >= 0 && confirmRect.bottom <= innerHeight
          && getComputedStyle(scroll).overflowY === 'auto',
        title: { top: titleRect.top, bottom: titleRect.bottom },
        confirm: { top: confirmRect.top, bottom: confirmRect.bottom },
        viewport: innerHeight,
      };
    })()`);
    if (!smallDialog.ok) {
      throw new Error(`小高度隔离弹窗头尾未固定：${JSON.stringify(smallDialog)}`);
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await delay(250);
    await cdp.mouseClick(
      `[...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '确认移入隔离区')`,
      "确认移入隔离区按钮",
    );
    await cdp.waitFor(`(async () => {
      try {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('dareclean');
        const projects = await root.getDirectoryHandle('Projects');
        const webapp = await projects.getDirectoryHandle('webapp');
        await webapp.getDirectoryHandle('node_modules');
        return false;
      } catch (error) {
        return error.name === 'NotFoundError';
      }
    })()`, "原位置 node_modules 已移走", 60_000);
    await cdp.waitFor("document.body.textContent.includes('需要恢复检查') === false", "没有误报恢复检查");

    await cdp.waitFor(`(() => {
      const tab = [...document.querySelectorAll('[role=tab]')].find((item) => item.textContent.includes('隔离区'));
      return Boolean(tab);
    })()`, "隔离区标签");
    await cdp.mouseClick(
      `[...document.querySelectorAll('[role=tab]')].find((item) => item.textContent.includes('隔离区'))`,
      "隔离区标签",
    );
    await cdp.waitFor(`(() => {
      const item = [...document.querySelectorAll('li')].find((node) => node.textContent.includes('Projects/webapp/node_modules'));
      return Boolean(item && [...item.querySelectorAll('button')].some((button) => button.textContent.trim() === '还原'));
    })()`, "隔离记录出现", 30_000);
    await cdp.evaluate(`(() => {
      const item = [...document.querySelectorAll('li')].find((node) => node.textContent.includes('Projects/webapp/node_modules'));
      const button = item ? [...item.querySelectorAll('button')].find((node) => node.textContent.trim() === '还原') : null;
      if (!button || button.disabled) throw new Error('还原按钮不可用');
      button.click();
      return true;
    })()`);
    await cdp.waitFor(`(async () => {
      try {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('dareclean');
        const projects = await root.getDirectoryHandle('Projects');
        const webapp = await projects.getDirectoryHandle('webapp');
        const modules = await webapp.getDirectoryHandle('node_modules');
        const react = await modules.getDirectoryHandle('react');
        const pkg = await react.getFileHandle('package.json');
        const text = await (await pkg.getFile()).text();
        return text.includes('"react"');
      } catch {
        return false;
      }
    })()`, "原位置内容恢复并可读", 60_000);
    await cdp.waitFor(`(() => {
      const item = [...document.querySelectorAll('li')].find((node) => node.textContent.includes('Projects/webapp/node_modules'));
      return Boolean(item && item.textContent.includes('已还原'));
    })()`, "隔离记录显示已还原", 30_000);
    await cdp.waitFor(`(() => {
      const item = [...document.querySelectorAll('li')].find((node) => node.textContent.includes('Projects/webapp/node_modules'));
      const button = item ? [...item.querySelectorAll('button')].find((node) => node.textContent.trim() === '删除审计记录') : null;
      return Boolean(button && !button.disabled);
    })()`, "已还原记录显示删除审计记录且可用", 30_000);
    await cdp.evaluate(`(() => {
      const item = [...document.querySelectorAll('li')].find((node) => node.textContent.includes('Projects/webapp/node_modules'));
      const button = item ? [...item.querySelectorAll('button')].find((node) => node.textContent.trim() === '删除审计记录') : null;
      if (!button || button.disabled) throw new Error('删除审计记录按钮不可用');
      button.click();
      return button.textContent.trim();
    })()`);
    await cdp.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="alertdialog"]')]
        .find((node) => node.textContent.includes('删除审计记录'));
      return Boolean(dialog && dialog.textContent.includes('原文件') && dialog.textContent.includes('保留'));
    })()`, "审计记录删除确认文案");
    await cdp.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="alertdialog"]')]
        .find((node) => node.textContent.includes('删除审计记录'));
      const cancel = dialog ? [...dialog.querySelectorAll('button')].find((node) => node.textContent.trim() === '取消') : null;
      if (!cancel) throw new Error('找不到取消按钮');
      cancel.click();
      return true;
    })()`);
    await cdp.waitFor("document.querySelector('[role=\"alertdialog\"]') === null", "关闭审计记录确认框");
    await delay(250);

    await cdp.mouseClick(
      `[...document.querySelectorAll('[role=tab]')].find((item) => item.textContent.includes('判定规则'))`,
      "判定规则标签",
    );
    await cdp.waitFor(`(() => {
      const region = document.querySelector('[data-region="knowledge"]');
      return Boolean(region && region.textContent.includes('可审查的本地判定规则')
        && region.textContent.includes('8 个分类')
        && region.textContent.includes('我的规则')
        && region.textContent.includes('待审核候选')
        && region.textContent.includes('更新记录'));
    })()`, "规则页分层区块正常挂载");
    await cdp.mouseClick(
      `[...document.querySelectorAll('[data-region="knowledge"] button')]
        .find((item) => item.textContent.includes('技术实现与开发者扩展'))`,
      "技术实现折叠区",
    );
    await cdp.waitFor(
      "Boolean(document.querySelector('[data-region=\"knowledge\"] a[href=\"/skill/references/rules/system.md\"]'))",
      "规则页下载链接",
    );

    const candidateSeed = await cdp.evaluate(`(async () => {
      const store = await import('/src/knowledge/local-store.ts');
      const repo = store.createRuleRepository();
      const rootHash = await store.hashRootLabel('演示模式（模拟数据）');
      const now = Date.now();
      await repo.saveCandidates([{
        schemaVersion: 1,
        id: 'cand_e2e_persist_001',
        status: 'pending',
        source: 'ai_candidate',
        rootHash,
        scanPath: 'E2E/PersistentCandidate',
        scanName: 'PersistentCandidate',
        kind: 'directory',
        size: 123,
        fileCount: 1,
        childNames: ['marker.bin'],
        siblingNames: [],
        software: 'Persistent候选软件',
        vendor: '未确认',
        ownerKind: 'app',
        purpose: '端到端候选持久化测试目录',
        role: 'rebuildable_cache',
        reason: '该候选仅用于验证重启后仍需审核，不代表真实模型结论。',
        consequence: '不会产生可执行动作。',
        confidence: 0.8,
        aiVerdict: 'safe_delete',
        revival: [],
        evidence: ['候选持久化测试证据'],
        suggestedScope: 'exact_path',
        genericReady: true,
        searchUsed: false,
        sources: [],
        model: null,
        createdAt: now,
        updatedAt: now,
      }]);
      return { customRules: (await repo.listCustom()).length, candidates: (await repo.listCandidates()).length };
    })()`);
    if (candidateSeed.customRules !== 0 || candidateSeed.candidates !== 1) {
      throw new Error(`候选初始持久化状态错误：${JSON.stringify(candidateSeed)}`);
    }

    await cdp.send('Page.reload', { ignoreCache: true });
    await cdp.waitFor("document.body.textContent.includes('进入演示模式')", "重启后的首页", 60_000);
    await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('进入演示模式'));
      if (!button) throw new Error('重启后找不到进入演示模式按钮');
      button.click();
      return true;
    })()`);
    await cdp.waitFor("document.body.textContent.includes('扫描完成')", "重启后扫描完成", 120_000);
    await cdp.mouseClick(
      `[...document.querySelectorAll('[role=tab]')].find((item) => item.textContent.includes('判定规则'))`,
      "重启后的判定规则标签",
    );
    await cdp.waitFor("document.body.textContent.includes('Persistent候选软件')", "重启后候选仍需审核", 30_000);
    await cdp.mouseClick(
      `[...document.querySelectorAll('button')].find((item) => item.textContent.includes('创建精确目录规则'))`,
      "创建精确目录规则按钮",
    );
    await cdp.waitFor(`(async () => {
      const store = await import('/src/knowledge/local-store.ts');
      const repo = store.createRuleRepository();
      const rules = await repo.listCustom();
      return rules.some((rule) => rule.software === 'Persistent候选软件' && rule.ruleScope === 'exact_path');
    })()`, "用户审核后创建精确规则", 30_000);
    await cdp.waitFor("document.body.textContent.includes('我的规则') && document.body.textContent.includes('Persistent候选软件')",
      "我的规则界面显示新规则", 30_000);

    if (cdp.errors.length > 0) throw new Error(`浏览器控制台错误：${cdp.errors.join(" | ")}`);
    console.log("PASS  演示模式闭环：生成 → 扫描 → 受保护抽屉 → 勾选 → 隔离 → 原位消失 → 还原 → 审计记录");
    console.log("PASS  规则库持久化：AI候选重启后仍待审核 → 用户审核创建精确规则 → 我的规则可见");
  } finally {
    try { await cdp?.send("Browser.close"); } catch { /* ignore */ }
    cdp?.close();
    terminateBrowserProfile(profile);
    await terminate(browser);
    await terminate(vite);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

try {
  await main();
  console.log("\n1 passed, 0 failed");
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  console.log("\n0 passed, 1 failed");
  process.exitCode = 1;
}
