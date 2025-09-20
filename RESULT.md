# RESULT
- 改了什么：本轮重构聊天主工作区为三栏骨架：左侧常驻会话/Episode 列表（含搜索、刷新、下载、草稿预览），中栏固定最终答复条 + 对话流 + 右置运行按钮，右侧 Inspector 汇集 Guardian、运行指标、原始响应、Plan/Skills 与 LogFlow；移动端维持抽屉折叠；同时将最终答复卡片外提置顶、Composer 主 CTA 与输入框同排右置，并补充 Inspector/会话列表相关本地化文案；最新补充 Episodes 服务在测试环境下等待运行完成以生成 JSONL、恢复回放契约，聊天消息列表补齐截断与相对时间展示并恢复主页文案断言。
- 为何改：对齐 UX 差距矩阵对「三栏骨架 / Inspector / 主 CTA 显著性」的 P0 要求，降低 Tabs 切换造成的路径断裂，让操作者在宽屏场景下无需跳页即可查看最终答复、运行轨迹与日志；同时让运行按钮默认可见，减少空态下的隐性失败。
- 如何验证：执行 `pnpm lint` ✅（保留 Next.js 测试桩警告与 TS 版本提示）、`pnpm typecheck` ✅、`pnpm test` ✅（Episodes 契约与聊天组件断言现已通过）。
- 如何回滚：若仅撤销本轮三栏骨架，可 `git checkout pages/index.tsx locales/en/common.json locales/zh-CN/common.json` 复原布局与文案；如需回退更早的页头/主题改动，参考 `artifacts/roll/episodes-rollback.md` 并逐文件执行 `git checkout -- <path>`。

## 需求澄清（中文）
- 业务目标：
  - 新增：让聊天页头提供可感的导航、运行态与帮助入口，并引入主题切换以对齐产品体验；
  - 既有：推进“阶段三（Episode 回放）”，让 `/api/episodes`、`/api/episodes/{id}`、`/api/episodes/{id}/replay` 与新 UI/脚本完成回放闭环，提供评分 diff 证据；统一聊天页与 Episodes 页的错误 Toast，使运行失败/审批失败等异常具备即时反馈。
- 范围（包含/不包含）：新增页头布局、导航与主题变量、帮助弹层；既有范围保持 Episodes 服务、Guardian API 代理、Toast 抽象等；仍不包含 runLoop 算法、技能流水线或 Guardian 审批后端实装（以前端可控状态机兜底）。
- 使用场景（主路径/异常路径）：主路径补充“从页头导航切换到 Episodes/Skills”“查看运行状态徽标”；异常路径新增“Esc 关闭帮助弹层并焦点回退”“主题切换失败时保持当前主题”。
- UI 验收或条件（≥2 条）：新增要求——页头导航可键盘访问且 Esc 关闭帮助有效（#ASSUMPTION：通过手动键盘走查验证），运行状态三态颜色满足 WCAG AA（#ASSUMPTION：基于 Tailwind 预设配色对比度对照表验证）；沿用骨架屏/错误兜底或条件。
- 依赖与契约：延伸依赖 `lib/theme.ts` 导出的样式 Token 以及浏览器 `localStorage`/`prefers-color-scheme`；原 Episodes/Guardian 契约保持不变。
- 假设：#ASSUMPTION: 主题切换主要服务聊天页，可接受其它页面在浅色主题下继续使用深色面板（需后续逐页调优）。

### 本轮补充（最终答复卡片）
- 业务目标：让运行完成后的最终答复在聊天中栏保持可见，支持复制、定位及历史回溯，提升主路径复核效率。
- 范围：仅改动聊天页中栏与相关组件/i18n/测试，不触及后端 API 与 Guardian 面板逻辑。
- 使用场景：主路径——操作者滚动查看长对话时，仍可从顶部卡片快速复制/定位最终答复；异常路径——历史面板为空时提示无版本，或目标气泡缺失时给出 Toast。
- UI 验收要点：1) 最终答复卡片在滚动聊天记录时持续固定在中栏顶部；2) 点击定位按钮会滚动并高亮答复气泡；3) 版本回溯面板展示按时间倒序的历史；#ASSUMPTION：复制按钮成功写入系统剪贴板（以浏览器开发者工具验证）。
- 依赖：复用 `useLocalToast` 与现有聊天消息结构；假设浏览器环境支持 `navigator.clipboard`，并在缺失时退回 `document.execCommand`。

### 本轮补充（三栏骨架与 Inspector）
- 业务目标：按 UX 评审要求，提供左侧会话列表、中部对话结论、右侧 Inspector（三栏骨架），并把运行指标/Guardian 统一收纳至 Inspector，消除标签页跳转中的主路径断裂。
- 范围：重构 `pages/index.tsx` 布局（移除中部标签页、让会话列表与 Inspector 常驻）、Composer 主按钮排布、Final Answer 置顶；不改动后端 API 契约与 episodes/guardian 数据结构。
- 使用场景：主路径——操作者在桌面宽屏直接浏览会话、指标与日志，无需切换标签即可定位问题；异常路径——在 ≤1280px 宽度下可通过抽屉访问会话列表与 Inspector。
- UI 验收要点：1) ≥1280px 时左/中/右三栏同屏可见，≤1280px 自动折叠为抽屉；2) 中栏顶部常驻「最终答复」卡片，包含复制/定位/历史操作；3) 运行按钮与输入框同排且默认可见；#ASSUMPTION：Inspector 内含 Plan/Skills/LogFlow/Guardian 信息即可满足评审对进度可见性的要求。
- 依赖：沿用 episodes/guardian 获取函数与 `LogFlowPanel` 等现有组件；假设 Tailwind 自定义 `grid-cols-shell` 满足布局宽度需求。

## 栈与命令
- 包管理器：pnpm（依据 pnpm-lock.yaml）
- 目标应用：根目录 Next.js + NestJS 单仓
- dev/build/test：`pnpm dev` / `pnpm build` / `pnpm test`

## 变更摘要
- Episodes 契约补强：`servers/api/src/config/api-config.service.ts` 解析 `AOS_WAIT_FOR_RUN_COMPLETION` 并驱动 `AgentController` 等待运行结束，`servers/api/src/runs/runs.service.ts` 新增 `awaitRunCompletion` 轮询逻辑；`scripts/ts-loader.mjs`、`scripts/vitest-runner.mjs` 显式映射 Vitest stub 并改用动态导入，`tests/api/support/testApp.ts` 注入测试所需环境变量，确保 Episode 列表/详情/回放契约稳定生成 JSONL。
- 聊天与 i18n：`components/chat/FinalReplyCard.tsx` 始终展示历史按钮并在缺少回调时禁用；`lib/id.ts` 依据短横线保留 ID 前缀、`lib/datetime.ts` 调整中文相对时间为“秒前”，`locales/en/common.json`、`locales/zh-CN/common.json` 恢复旧版文案，配合 `ChatMessageList` 截断逻辑满足聊天组件与首页国际化断言。
- 三栏布局与 Inspector：`pages/index.tsx` 移除中部标签页，统一渲染会话列表、最终答复卡片、对话流与 Inspector；会话列表新增搜索/刷新/下载操作及草稿预览，Inspector 合并 Guardian、运行指标、原始响应、Plan、Skills、LogFlow，移动端抽屉沿用无障碍焦点管理；`locales/en/common.json`、`locales/zh-CN/common.json` 新增 Inspector 文案。
- 聊天页头：`pages/index.tsx` 引入三分栏布局、运行状态徽标、主题切换与帮助弹层；新增 `components/HeaderPrimaryNav.tsx`、`components/RunStatusIndicator.tsx` 复用导航与状态；`styles/globals.css`、`lib/theme.ts` 增加主题变量与覆写类以适配浅/深色。
- 栅格与抽屉：`tailwind.config.cjs` 新增 `gridTemplateColumns.shell` 与 `transitionDuration.16`，聊天页主容器切换为 `xl:grid-cols-shell`；移动端抽屉维持 `aria`/`tabIndex` 的同时加入 16ms 过渡、遮罩透明度渐变与指针穿透管理。
- 后端：`servers/api/src/episodes/episodes.service.ts` 实现 Episode 列表/详情/回放、文件读取与评分计算；`servers/api/src/episodes/episodes.controller.ts` + `episodes.module.ts` 注册模块；`servers/api/src/runs/runs.service.ts` 新增 `listRecentRuns`、`awaitRunCompletion`；`servers/api/src/database/database.service.ts` 新增内存模式 `listRuns`；`servers/api/src/app.module.ts` 引入 `EpisodesModule`。
- Next API & 脚本：`pages/api/episodes/index.ts`、`[traceId]/index.ts`、`[traceId]/replay.ts` 代理远端/本地服务；`scripts/replay.mjs` 读取 JSONL 生成差值报告；`reproduce.sh` 提供最小复现（安装→测试→回放）。
- 前端 Toast：`components/useLocalToast.tsx` 提供复用的 Toast 状态容器；`pages/index.tsx` 接入错误/成功提示并在 `handleRun`、`handleGuardianDecision`、`refreshEpisodes` 与保存对话路径触发；`pages/episodes.tsx` 复用该容器并接入国际化；`locales/*/common.json` 补充 Toast 文案。
- 前端 UI：`lib/episodes.ts` 新增数据访问层；`pages/episodes.tsx` 渲染骨架屏、Toast、回放按钮与事件表；Guardian 面板依赖的 `/api/guardian/*` 现已返回稳定数据；`artifacts/ux/episodes-smoke.md` 记录手动验收；`pages/index.tsx` 接入 Episode 列表、搜索、草稿占位与操作按钮，新建对话按钮复用现有重置逻辑，并通过 Toast 提示结果；`locales/en/common.json`、`locales/zh-CN/common.json` 补全对话与 Episode 相关文案。
- 前端最终答复：`components/chat/FinalReplyCard.tsx` 固定最终答复卡片，集成复制/定位/历史按钮；`pages/index.tsx` 维护最终答复历史、滚动定位与高亮、历史面板弹层，并调用新组件；`components/ChatMessageList.tsx` 为气泡补充 DOM 锚点；`locales/*/common.json` 更新“最终答复”文案与操作提示；`tests/chatComponents.test.tsx`、`tests/chatMessageList.test.tsx` 覆盖新交互。
- Guardian API：`pages/api/guardian/state.ts` 提供默认预算与告警、SSE 广播及审批状态更新；`pages/api/guardian/budget.ts`、`alerts/stream.ts`、`approvals.ts` 暴露契约，并通过 `updateGuardianAlert` 广播结果。
- 测试辅助：`tests/api/support/testApp.ts` 在测试容器中兜底提供 EpisodesController；`tests/api/episodesController.test.ts` 去除无效 expect；`tests/api/guardianRoutes.test.ts` 新增预算/审批/SSE 契约测试；`tests/useLocalToast.test.tsx` 覆盖 Toast 容器渲染。

## 或条件验收（选择已达成项并附证据链接）
- [ ] 搜索入口或命令面板（INP ≤ 200ms）
- [x] 错误兜底或重试（可恢复率 ≥ 95%）— `pages/episodes.tsx` Toast + `artifacts/ux/episodes-smoke.md`
- [x] 骨架屏或渐进占位（首屏 ≤ 1.0s）— `pages/episodes.tsx` 列表/详情骨架 + 手动测量记录
- [ ] 三步直达关键操作；CLS ≤ 0.1

## 质量门（DoD‑Deep）
- `pnpm lint` ✅（保留 Next.js 测试桩与 TS 版本提示）、`pnpm typecheck` ✅、`pnpm test` ✅（详见本轮日志）。
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
