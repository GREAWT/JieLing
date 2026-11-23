# 洁灵 · AI 磁盘清理决策助手

> 不是帮你删得更快，是让你**敢删**。

洁灵是一个跑在浏览器里的磁盘清理决策台。它先解释「这是什么 / 能不能删 / 删了会怎样」，再把决定权交回给你：清理动作一律是**移入隔离区**而不是直接删除，7 天内一键还原，到期后**仍需你明确同意**才彻底删除。

面向 2026 Qoder 高校创造力大赛 LifeHack 赛道，使用 Qoder 开发并部署于 Qoder Sites。

## 核心链路

1. **扫描并判定** — Web Worker 遍历目录（主线程兜底），命中内置 100 条文件夹指纹规则；未识别的大目录交给云端 AI 判定；系统关键路径硬锁定，不参与勾选。
2. **解释理由与后果** — 点开任意条目进入详情抽屉：归属、构成、最后修改、置信度、判断依据、删除后果、复活风险，一屏读完。
3. **隔离而非删除** — 勾选后移入扫描根下的 `.dareclean-quarantine/`，写入 `manifest.json`，同时生成 `运维手册.md` 与 `文件夹名录.md` 审计痕迹。
4. **一键还原** — 隔离区内随时还原到原路径；目标已存在时拒绝覆盖，绝不静默吞掉你的文件。
5. **到期仍需同意** — 7 天 TTL 到期只提示，不自动 purge；彻底删除、清空隔离区都要二次确认。清空时审计 md 保留。

## 功能

- **分类审核台**：按「归属」（npm / Chrome / 某网盘 / 未知…）聚合，支持搜索、判定筛选、排序；统计卡可点击直接筛选；父子条目自动去重。
- **条目详情抽屉**：桌面右侧 Sheet、移动底部 Drawer，`←` `→` 在条目间切换，路径一键复制。
- **隔离区**：在保 / 已到期 / 占用体积统计，剩余时间进度条，还原与彻底删除分离。
- **复活诊断**：浏览器读不到注册表、服务与卸载器，所以分两步——① 生成**只读**诊断脚本 `dareclean-diagnose.ps1`（只枚举与读取，不含任何删除/修改指令），由你在本机运行后把 JSON 粘回来；② AI 给出复活机制、官方卸载路径与逐项可选的清理处方。清理脚本默认 **dry-run**，高危项默认不勾选，触及注册表或卸载前会先申请确认。
- **知识库 Skill**：`src/knowledge/rules/*.md` 是唯一真源，构建时编译成 `fingerprints.json`，并同步产出可安装的 Qoder Skill（`public/skill/`，页内可直接下载）。
- **样本磁盘**：一键在 OPFS 沙盒里生成含开发缓存、浏览器缓存、网盘捆绑残留、空目录、用户照片与系统锁定项的样本盘，无需授权真实目录即可完整体验；重置需确认，且会跳过仍在隔离区的内容。

## 能力边界（有意为之）

- 浏览器无法访问注册表、服务、计划任务与卸载器，这不是权限问题；相关操作一律走「只读脚本 + 你本机执行」。
- **空目录不自动判为可删**：可能是软件预留工作区，也可能是卸载残壳，交人工判断。
- **捆绑软件走卸载而不是删目录**：先断来源（服务 / 计划任务 / Run 键 / 外壳扩展登记），优先官方卸载器，手改注册表是最后手段。
- 审计写入失败**不会回滚**已完成的清理。
- 云端 AI 不可用时自动降级到本地指纹与启发式判定，界面明确提示，不阻断主流程。

## 快速开始

需要 Node `^22.13.0 || >=24.0.0`。

```sh
npm ci
npm run dev        # http://127.0.0.1:5173
npm run build      # 编译规则 md → fingerprints.json，类型检查，产出 dist/
npm run preview    # 本地预览 dist/
```

云端 AI 由可选的 Qoder Sites Function 提供（Deno）：

```sh
npm run check:function
npm run dev:function   # 127.0.0.1:8000，dev/preview 均代理 /functions/v1/app
```

没有 Deno 或 Function 未启动时，前端仍可完整构建与运行，AI 相关入口会给出「服务暂时不可用」的可恢复提示。

## 目录

```
src/core/        类型与常量（TTL、隔离目录名、硬锁定规则）
src/fs/          File System Access 适配、扫描、沙盒、隔离区、审计日志
src/knowledge/   规则 md（唯一真源）+ 编译器 + 指纹匹配
src/diagnose/    只读诊断脚本与 dry-run 清理脚本生成
src/safety/      判定与风险约束
src/components/  审核台、抽屉、隔离区、诊断、首屏等界面
src/styles/      科幻设计系统（product.css）
functions/       Deno Function：AI 判定与诊断路由
public/skill/    可安装的 Qoder Skill 产物
```

## 设计系统：简洁科幻

- **色板**：深空蓝黑底 + 青蓝主色，语义色成对定义（`ink` 用于浅底、`bright` 用于深底），保证深/浅两套主题下同一语义都达 WCAG AA。判定色固定：安全=青绿、需确认=琥珀、危险=红、锁定=灰蓝、AI=紫。
- **按压回弹**：所有可点元素统一 `cubic-bezier(.34, 1.56, .64, 1)` 弹簧曲线，按下缩放、松开回弹，配合边框与辉光变化，反馈可见可感。
- **科幻语汇**：面板四角括号、扫描线与光束、网格 / 极光 / 颗粒三层背景、等宽数字、状态呼吸灯。
- **滚动条**：全站滚动条按主题重绘（轨道、滑块渐变、hover 提亮），不留浏览器默认样式。
- **无障碍**：`prefers-reduced-motion` 下关闭动画并直接呈现终态；抽屉 / 对话框焦点管理与 aria 标签完整；深/浅主题手动切换并持久化。

## 已实测

在内置浏览器中以 1440×900 与 390×844 两种视口实测：样本生成 → 审核 → 抽屉详情与键盘切换 → 勾选 → 隔离 → 还原 → 重置样本（跳过在保内容）→ 停止扫描保留部分结果 → 只读脚本生成与下载 → AI 不可用时的降级提示 → 知识库 9 个下载链接全部 200。深浅两主题逐元素对比度审计通过（正文与徽标 ≥ 4.5:1），无运行时错误。

## 部署

构建产物 `dist/` + `functions/` 通过 Qoder Sites 发布，站点 descriptor 为 `.洁灵.qoder.site`。

**站点当前为私有访问。** 是否改为公开（例如供评委直接点开）属于访问范围决策，需由项目负责人确认后再调整，不会擅自变更。

## 设计参考来源

下列开源项目**仅作为视觉与交互设计的灵感参考**（观察其界面截图、演示与公开文档的设计手法），**未复制、移植或改写其任何源代码**。洁灵的样式与组件均为本项目自行实现。

| 项目 | 许可 | 参考的设计手法 |
| --- | --- | --- |
| [arwes/arwes](https://github.com/arwes/arwes) | MIT | 科幻 HUD 语汇：角标括号、扫描线、分层辉光与「系统面板」的语气 |
| [GitSquared/edex-ui](https://github.com/GitSquared/edex-ui) | GPL-3.0（已归档） | 深色科幻仪表盘的排版密度、等宽数字与状态灯。**仅看界面演示，未读源码**，避免 GPL 传染 |
| [louislam/uptime-kuma](https://github.com/louislam/uptime-kuma) | MIT | 状态点 + 语义色的克制用法，长列表卡片的信息层级 |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | MIT | 组件组合方式与可访问性约定（本项目经模板以 npm 依赖形式使用其 primitives） |
| [radix-ui/primitives](https://github.com/radix-ui/primitives) | MIT | Dialog / Tabs 的焦点管理与键盘行为（作为 npm 依赖正常使用） |
| [tremorlabs/tremor](https://github.com/tremorlabs/tremor) | Apache-2.0 | 指标卡 + 细进度条的数据表达方式 |
| [magicuidesign/magicui](https://github.com/magicuidesign/magicui) | MIT | 边框光束与流光按钮的动效节奏（节奏参考，CSS 自研实现） |
| [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits) | MIT + Commons Clause（GitHub 标记 Other，非 OSI 认证） | 颗粒 / 极光背景与文字渐显的层次处理。**仅视觉参考，未使用其组件或工具** |
| [filebrowser/filebrowser](https://github.com/filebrowser/filebrowser) | Apache-2.0（已归档） | 文件行的信息密度：名称、路径、体积、时间的并置方式 |

许可与归档状态于 2026-11-23 通过 GitHub API 核对。其中 GPL-3.0 与 Commons Clause 两项尤其只作观感参考，以确保本项目代码不受其条款约束。

**以 npm 依赖形式正常使用的库**（React、radix-ui、vaul、sonner、lucide-react、Tailwind CSS、class-variance-authority、tailwind-merge 等）保留各自许可，不属于上表的「设计参考」范畴。

模板来源与 vendored 样式许可见 [PROVENANCE.md](PROVENANCE.md) 与 `vendor/`。