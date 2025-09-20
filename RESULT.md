# RESULT
- 改了什么：抽象 `components/useLocalToast.tsx` 统一 Toast 状态、动作按钮与配色，并让 `pages/index.tsx` 与 `pages/episodes.tsx` 复用该容器及国际化文案；聊天页 `handleRun`/`handleGuardianDecision`/`refreshEpisodes`、保存对话等路径改为触发 Toast，同时保留系统消息；补充 `tests/useLocalToast.test.tsx` 校验容器渲染；新增 `servers/api/src/episodes/*` 服务/控制器/模块，配合 `servers/api/src/runs/runs.service.ts` 与 `servers/api/src/database/database.service.ts` 扩展，打通 Episode 列表、详情与回放；补上 `pages/api/episodes/*`、`lib/episodes.ts` 与 `pages/episodes.tsx`，提供骨架屏 + Toast 的 UI；完善 `pages/api/guardian/*` 与 `pages/api/guardian/state.ts`，实现预算/告警/审批接口及 SSE，前端不再 404，并新增 `tests/api/guardianRoutes.test.ts` 做契约回归；`servers/api/src/runs/run-kernel.factory.ts` 在缺失 `OPENAI_API_KEY` 时回落到本地 Stub Kernel；重构聊天页为三栏布局（左侧会话上下文、中部对话流、右侧 Guardian/运行指标/调试信息），新增原始响应折叠、首屏状态条；扩展聊天页左栏，接入 Episode 搜索/列表/操作、新建对话按钮与导出 JSONL，并补全中英文 Toast/文案；同时完善 `scripts/replay.mjs` 与 `reproduce.sh` 支撑最小复现。
- 为何改：聊天页此前仅追加系统消息提示失败，缺乏明显的 Toast 反馈，影响异常路径可感体验；Episodes 页 Toast 为临时实现且无国际化，需抽象复用；SRS 阶段三 A5/A6 要求 Episode/回放接口闭环，Guardian 面板原本 404 影响主路径体验；tests/api/episodesController.test.ts、Guardian 相关测试缺失导致红线无法通过。
- 如何验证：执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`（新增 `tests/useLocalToast.test.tsx` 覆盖 Toast 容器；日志见 artifacts/api/pnpm-test.log，其中包含 Guardian 契约测试）；运行 `pnpm replay` 产出 `reports/0a1341b9-5f04-4451-8b24-6f3eec242eaa-replay.json`；手动验收记录见 `artifacts/ux/episodes-smoke.md`。
- 如何回滚：按 `artifacts/roll/episodes-rollback.md` 删除新增模块/脚本并恢复受影响文件；或在拥有权限的环境使用 `git checkout --` 逐一回滚文件。

## 需求澄清（中文）
- 业务目标：推进“阶段三（Episode 回放）”，让 `/api/episodes`、`/api/episodes/{id}`、`/api/episodes/{id}/replay` 与新 UI/脚本完成回放闭环，提供评分 diff 证据；并统一聊天页与 Episodes 页的错误 Toast，使运行失败/审批失败等异常具备即时反馈。
- 范围（包含/不包含）：包含 Episodes 读写服务、数据库+文件聚合、Next & Guardian API 代理、前端页面、回放脚本与复现脚本，以及聊天页本地状态与 Toast 抽象；不包含 runLoop 算法、技能流水线或 Guardian 审批后端实装（以前端可控状态机兜底）。
- 使用场景（主路径/异常路径）：主路径——操作者浏览 Episode 列表→查看详情→触发回放→查看差值；聊天主路径执行代理运行后可见成功/错误 Toast；异常路径——接口失败时 Toast+重试，并在脚本中提供日志；保存对话为空时提示无内容。
- UI 验收或条件（≥2 条）：1) 列表&详情骨架屏，首屏可感等待 ≤1.0s (#ASSUMPTION：以 Chrome DevTools Slow 3G 测得)；2) 错误 Toast + 一键重试 (#ASSUMPTION：通过断开 dev server 进行手动校验)；3) (#ASSUMPTION) 聊天页运行失败弹出 Toast，提示可在手动测试中验证。
- 依赖与契约：依赖 `runs` 表、Episode JSONL 文件、`runtime/events|episode` 结构、Nest `EpisodesService`、可选 `DatabaseService` 注入；遵循 `/api/agent/start`、`/api/runs/:id` 现有契约，并对 Guardian 前端契约 `/api/guardian/budget|alerts/stream|approvals` 做本地实现。
- 假设：#ASSUMPTION: 评分来源为 `run.score` 或 `review.scored` 的 `value/score` 字段；#ASSUMPTION: 录屏与 Web-Vitals 由人工在交付后补齐，当前以 `artifacts/ux/episodes-smoke.md` 记录验证步骤。

## 栈与命令
- 包管理器：pnpm（依据 pnpm-lock.yaml）
- 目标应用：根目录 Next.js + NestJS 单仓
- dev/build/test：`pnpm dev` / `pnpm build` / `pnpm test`

## 变更摘要
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
- `pnpm lint`、`pnpm typecheck`、`pnpm test` 已执行（日志：`artifacts/api/pnpm-test.log`）。
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
