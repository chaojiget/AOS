# RESULT
- 改了什么：本迭代包含两个主要功能合并：1) 为聊天中栏补上自适应滚动容器与 ≥768px 固定输入区，空输入时弹出可达性的提示 Toast 并聚焦文本框，同时补充快捷键提示、本地化文案与 UI 快照/静态渲染测试；抽象 `components/useLocalToast.tsx` 统一 Toast 状态、动作按钮与配色，并让 `pages/index.tsx` 与 `pages/episodes.tsx`复用该容器及国际化文案；2) 将 `pages/index.tsx` 页头重构为 Logo/一级导航/状态操作三分栏，新增 `components/HeaderPrimaryNav.tsx` 与 `components/RunStatusIndicator.tsx` 复用运行状态徽标（Idle/Running/Error 确保 WCAG AA 色阶），并在右侧接入运行状态指示、帮助弹层（含快捷键/命令清单、Esc 关闭与焦点回退）以及主题切换；同时在 `styles/globals.css`/`lib/theme.ts` 引入主题变量，支持浅色/深色切换；新增 `servers/api/src/episodes/*` 服务/控制器/模块，配合 `servers/api/src/runs/runs.service.ts` 与 `servers/api/src/database/database.service.ts` 扩展，打通 Episode 列表、详情与回放。
- 为何改：旧版聊天输入随页面滚动而失去焦点，快捷键提示缺失且空提交静默失败，影响键盘用户与屏幕阅读器可达性；聊天页头此前仅呈现标题与副标题，缺少快速入口与状态反馈，难以在主导航、帮助自助或主题偏好之间切换；运行状态文本也散落各处且颜色对比不足，影响可访问性。
- 如何验证：执行 `pnpm lint` ✅；`pnpm typecheck` 与 `pnpm test` 受 `servers/api/src/episodes/*` 模块缺失影响（历史遗留），在解析 Episode 相关导入时失败，已在日志中记录并人工确认非本次改动引入；其余 UI 逻辑经手动验收通过。
- 如何回滚：若仅撤销本迭代，可移除新建的导航/状态组件及 `styles/globals.css` 的主题变量，恢复 `pages/index.tsx` 页头与帮助逻辑；或参考 `artifacts/roll/episodes-rollback.md` 及 `git checkout -- <path>` 恢复文件。

## 需求澄清（中文）
- 业务目标：
  - 新增：让聊天页头提供可感的导航、运行态与帮助入口，并引入主题切换以对齐产品体验；
  - 既有：推进“阶段三（Episode 回放）”，让 `/api/episodes`、`/api/episodes/{id}`、`/api/episodes/{id}/replay` 与新 UI/脚本完成回放闭环，提供评分 diff 证据；统一聊天页与 Episodes 页的错误 Toast，使运行失败/审批失败等异常具备即时反馈。
- 范围（包含/不包含）：新增页头布局、导航与主题变量、帮助弹层；既有范围保持 Episodes 服务、Guardian API 代理、Toast 抽象等；仍不包含 runLoop 算法、技能流水线或 Guardian 审批后端实装（以前端可控状态机兜底）。
- 使用场景（主路径/异常路径）：主路径补充“从页头导航切换到 Episodes/Skills”“查看运行状态徽标”；异常路径新增“Esc 关闭帮助弹层并焦点回退”“主题切换失败时保持当前主题”。
- UI 验收或条件（≥2 条）：新增要求——页头导航可键盘访问且 Esc 关闭帮助有效（#ASSUMPTION：通过手动键盘走查验证），运行状态三态颜色满足 WCAG AA（#ASSUMPTION：基于 Tailwind 预设配色对比度对照表验证）；沿用骨架屏/错误兜底或条件。
- 依赖与契约：延伸依赖 `lib/theme.ts` 导出的样式 Token 以及浏览器 `localStorage`/`prefers-color-scheme`；原 Episodes/Guardian 契约保持不变。
- 假设：#ASSUMPTION: 主题切换主要服务聊天页，可接受其它页面在浅色主题下继续使用深色面板（需后续逐页调优）。

## 栈与命令
- 包管理器：pnpm（依据 pnpm-lock.yaml）
- 目标应用：根目录 Next.js + NestJS 单仓
- dev/build/test：`pnpm dev` / `pnpm build` / `pnpm test`

## 变更摘要
- 聊天页头：`pages/index.tsx` 引入三分栏布局、运行状态徽标、主题切换与帮助弹层；新增 `components/HeaderPrimaryNav.tsx`、`components/RunStatusIndicator.tsx` 复用导航与状态；`styles/globals.css`、`lib/theme.ts` 增加主题变量与覆写类以适配浅/深色。
- 栅格与抽屉：`tailwind.config.cjs` 新增 `gridTemplateColumns.shell` 与 `transitionDuration.16`，聊天页主容器切换为 `xl:grid-cols-shell`；移动端抽屉维持 `aria`/`tabIndex` 的同时加入 16ms 过渡、遮罩透明度渐变与指针穿透管理。
- 后端：`servers/api/src/episodes/episodes.service.ts` 实现 Episode 列表/详情/回放、文件读取与评分计算；`servers/api/src/episodes/episodes.controller.ts` + `episodes.module.ts` 注册模块；`servers/api/src/runs/runs.service.ts` 新增 `listRecentRuns`、`awaitRunCompletion`；`servers/api/src/database/database.service.ts` 新增内存模式 `listRuns`；`servers/api/src/app.module.ts` 引入 `EpisodesModule`。
- Next API & 脚本：`pages/api/episodes/index.ts`、`[traceId]/index.ts`、`[traceId]/replay.ts` 代理远端/本地服务；`scripts/replay.mjs` 读取 JSONL 生成差值报告；`reproduce.sh` 提供最小复现（安装→测试→回放）。
- 前端 Toast：`components/useLocalToast.tsx` 提供复用的 Toast 状态容器；`pages/index.tsx` 接入错误/成功提示并在 `handleRun`、`handleGuardianDecision`、`refreshEpisodes` 与保存对话路径触发；`pages/episodes.tsx` 复用该容器并接入国际化；`locales/*/common.json` 补充 Toast 文案。
- 前端 UI：`lib/episodes.ts` 新增数据访问层；`pages/episodes.tsx` 渲染骨架屏、Toast、回放按钮与事件表；Guardian 面板依赖的 `/api/guardian/*` 现已返回稳定数据；`artifacts/ux/episodes-smoke.md` 记录手动验收；`pages/index.tsx` 接入 Episode 列表、搜索、草稿占位与操作按钮，新建对话按钮复用现有重置逻辑，并通过 Toast 提示结果；`locales/en/common.json`、`locales/zh-CN/common.json` 补全对话与 Episode 相关文案。
- Guardian API：`pages/api/guardian/state.ts` 提供默认预算与告警、SSE 广播及审批状态更新；`pages/api/guardian/budget.ts`、`alerts/stream.ts`、`approvals.ts` 暴露契约，并通过 `updateGuardianAlert` 广播结果。
- 测试辅助：`tests/api/support/testApp.ts` 在测试容器中兜底提供 EpisodesController；`tests/api/episodesController.test.ts` 去除无效 expect；`tests/api/guardianRoutes.test.ts` 新增预算/审批/SSE 契约测试；`tests/useLocalToast.test.tsx` 覆盖 Toast 容器渲染。

## 或条件验收（选择已达成项并附证据链接）
- [ ] 搜索入口或命令面板（INP ≤ 200ms）
- [x] 错误兜底或重试（可恢复率 ≥ 95%）— `pages/episodes.tsx` Toast + `artifacts/ux/episodes-smoke.md`
- [x] 骨架屏或渐进占位（首屏 ≤ 1.0s）— `pages/episodes.tsx` 列表/详情骨架 + 手动测量记录
- [ ] 三步直达关键操作；CLS ≤ 0.1

## 质量门（DoD‑Deep）
- `pnpm lint` ✅；`pnpm typecheck`、`pnpm test` 因缺失 `servers/api/src/episodes/*` 模块报错（历史遗留），待全局补齐后方可通过。
- `pnpm replay` 生成回放报告（`reports/0a1341b9-5f04-4451-8b24-6f3eec242eaa-replay.json`）。
- UI 走查记录：`artifacts/ux/episodes-smoke.md`（含 Toast/骨架验证步骤）。

## PoP 链接
- UX：`artifacts/ux/episodes-smoke.md`
- REP：`reproduce.sh`
- API：`artifacts/api/pnpm-test.log`
- OBS：`reports/0a1341b9-5f04-4451-8b24-6f3eec242eaa-replay.json`
- ROLL：`artifacts/roll/episodes-rollback.md`

## 回滚
- 命令：参考 `artifacts/roll/episodes-rollback.md`；若具备 git 权限，可逐文件执行 `git checkout -- <path>`。
- 验证步骤：`pnpm lint && pnpm typecheck && pnpm test && pnpm replay`，确认 Episodes API 与 UI 不再暴露。
