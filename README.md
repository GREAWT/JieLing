# 洁灵 · AI 磁盘清理决策助手

> 不是帮你删得更快，是让你**敢删**。

洁灵是一个跑在浏览器里的磁盘清理决策台。它先解释「这是什么 / 能不能删 / 删了会怎样」，再把决定权交回给你：清理动作一律是**移入隔离区**而不是直接删除，7 天内一键还原，到期后**仍需你明确同意**才彻底删除。

面向 2026 Qoder 高校创造力大赛 LifeHack 赛道，使用 Qoder 开发并部署于 Qoder Sites。

## 核心链路

1. **扫描并判定** — Web Worker 遍历目录（主线程兜底），先命中可审查的本地规则；演示模式默认离线，云端 AI 仅由用户主动开启；系统关键路径硬锁定，不参与勾选。
2. **解释理由与后果** — 点开任意条目进入详情抽屉：归属、构成、最后修改、判断强度与匹配证据、删除后果、重建风险，一屏读完。
3. **隔离而非删除** — 勾选后移入扫描根下的 `.dareclean-quarantine/`，写入 `manifest.json`，同时生成操作记录与恢复说明审计痕迹。
4. **一键还原** — 隔离区内随时还原到原路径；目标已存在时拒绝覆盖，绝不静默吞掉你的文件。
5. **到期仍需同意** — 7 天 TTL 到期只提示，不自动 purge；彻底删除、清空隔离区都要二次确认。清空时审计 md 保留。

## 功能

- **分类审核台**：按「归属」（npm / Chrome / 某网盘 / 未知…）聚合，支持搜索、判定筛选、排序；统计卡可点击直接筛选；父子条目自动去重。
- **条目详情抽屉**：桌面右侧 Sheet、移动底部 Drawer，`←` `→` 在条目间切换，路径一键复制。
- **隔离区**：在保 / 已到期 / 占用体积统计，剩余时间进度条，还原与彻底删除分离；已还原记录只提供「删除审计记录」，不触碰原文件与审计文档。
- **顽固软件诊断**：按「选择问题目录 → 生成并运行只读脚本 → 导入诊断结果文件 → 查看建议」操作。本地解析无需联网；只有主动调用云端模型成功时才标记 AI 辅助分析。清理脚本默认 **dry-run**，高危项默认不勾选，触及注册表或卸载前会先申请确认。
- **判定规则**：内置规则、我的规则、AI 候选、云端缓存与弱启发式分层；冲突取更保守结论。普通用户可查看分类、用途和命中依据；Markdown 编译、`fingerprints.json` 与 Skill 方法论文档位于「技术实现与开发者扩展」折叠区。`src/knowledge/rules/*.md` 是内置规则唯一真源。
- **AI 候选沉淀**：AI 结果默认只在本次扫描显示为「需要确认」，保存到本机 IndexedDB 候选区，重启后仍需审核；用户可创建精确目录规则或（具备名称＋结构双证据时）通用规则。AI 候选不会自动写入共享知识库。
- **规则包**：自定义规则支持启用、禁用、删除、导出、导入失败原子保护与上一版回滚；规则包带 schema/版本/SHA-256，排除用户名路径。
- **演示模式**：在 OPFS 沙盒生成明确标注的模拟目录，与真实目录共用扫描、判定、隔离和还原管线，不硬编码成功结果；一键重置不影响真实文件，并会跳过仍在隔离区的内容。

## 能力边界（有意为之）

- 浏览器无法访问注册表、服务、计划任务与卸载器，这不是权限问题；相关操作一律走「只读脚本 + 你本机执行」。
- **空目录不自动判为可删**：可能是软件预留工作区，也可能是卸载残壳，交人工判断。
- **捆绑软件走卸载而不是删目录**：先断来源（服务 / 计划任务 / Run 键 / 外壳扩展登记），优先官方卸载器，手改注册表是最后手段。
- 审计写入失败**不会回滚**已完成的清理。
- 云端模型未配置、网络失败、请求超时或服务返回错误会分别提示；演示模式默认只使用本地规则。

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

没有 Deno 或 Function 未启动时，前端仍可完整构建并离线运行；开启云端辅助后会显示「网络失败」或「服务返回错误」等可恢复提示。

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
public/skill/    Skill 方法论文档与规则副本
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

## 验证

`npm run verify` 依次执行：类型检查、Function 安全测试、诊断证据测试、抽屉导航与 AI 数据边界回归、隔离/还原与扫描覆盖测试、规则信任与候选沉淀测试、PowerShell 5.1 脚本解析与真实只读执行、无头浏览器演示闭环、生产构建。

云端模型可在 Function Secret 中设置 `DASHCLEAN_MODEL_ID` 固定模型；未设置时由 Qoder Cloud Agents 平台动态选择，诊断响应会返回 provider/model 元数据，界面如实标注“动态选择”，不虚构模型名。

### 真实 AI 状态与已知限制

- **真实云端模型联调尚未通过。** 当前环境没有可用的 `QODER_PAT`/Function 登录会话，未取得真实 provider、model 或成功响应；Function 测试中的 provider/model 是测试夹具，不代表真实模型调用。
- 当前 Qoder Cloud Agent 未配置联网检索工具，AI 结果只显示为“AI 辅助推断”，没有可引用的来源 URL。
- 浏览器 E2E 使用真实 Chromium 与真实 OPFS，不读取真实 Windows 用户目录；真实本地磁盘的授权、隔离与还原仍需按人工验收步骤单独执行。
- PowerShell 真实执行只覆盖只读诊断；清理脚本默认 dry-run，本轮没有执行停用服务、修改注册表或卸载软件等写操作。
- 文件大于 32 MB 时使用首尾采样哈希；目录仅校验结构与大小，不是所有文件内容的逐字节比对。

## 原创性边界

本项目基于 **Qoder Sites React starter** 初始化，并继续使用其构建脚本、工程结构与通过 npm 引入的基础组件（React、radix-ui、vaul、sonner、Tailwind CSS 及其 primitives 等）。这些脚手架与第三方基础组件不是本项目原创。

本项目自行实现的部分包括：扫描与覆盖状态传播、规则编译器与信任分层、AI 候选审核与本地规则包、隔离/还原/对账状态机、诊断证据绑定与安全脚本生成、审核交互与业务文案，以及基于上述能力构建的科幻视觉系统与样式实现。

## 设计参考来源

下列开源项目**仅作为视觉与交互设计的灵感参考**（观察其界面截图、演示与公开文档的设计手法），**未复制、移植或改写其任何源代码**。项目在 Qoder Sites React starter 与第三方基础组件之上，自行实现业务、安全与产品视觉层，详见上一节“原创性边界”。

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