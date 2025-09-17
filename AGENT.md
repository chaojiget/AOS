# 使用中文交互

# AGENTS.md — AOS 项目给 AI 编码代理的操作手册（标准版 v0.1）

> 读者：AI 编码代理（Claude Code / Cursor / Roo Code / Windsurf / Copilot Chat 等）与协作者人类。
> 目的：让代理在**最少对话**下正确搭建、开发、测试与交付；所有命令与约束以本文件为准。
> 运行优先级：**质量 > 成本 > 延迟**（可配置）。默认**离线/本地技能优先**。

## 如何使用本手册

- **章节标签说明**：
  - `[Agent]` — 直接约束 AI 代理的执行动作、命令、交付契约。
  - `[Project]` — 面向项目治理与协作流程的人类指引；代理通常只需理解产物要求。
  - `[Agent|Project]` — 同时包含代理硬约束与治理背景，内含提示块说明各自适用的内容。
- **代理即时执行**请按顺序阅读所有 `[Agent]` 标记章节（§0-§15）完成环境准备、实现与验证。
- **项目蓝图/治理信息**（Stage-Gate、RACI、Intake 等）在 `[Project]` 或 `[Agent|Project]` 章节及 `docs/PROJECT.md` 中展开；需要补齐治理产物时再查阅。

若需快速了解代码结构，可先浏览 §1 的项目地图；执行具体任务时，请遵守 §0 总原则与对应章节的操作指引。

### TL;DR 操作速览

- 安装：`pnpm setup`
- 本地启动：`pnpm dev`（http://localhost:3000）
- 最小闭环：`pnpm smoke` → 生成 `episodes/*` 与 `reports/*`
- 回放：`pnpm replay`
- 提交前一键：`pnpm typecheck && pnpm lint && pnpm test && pnpm smoke`

---

## [Agent] 0. 总原则（Agents MUST）

1. **先读后做**：读取本文件、`/package.json`、`/docs/*`、`/apps/*`、`/skills/*`、`/kernel/*`。
2. **只用允许的能力**（见 §7 守护与权限）。
3. **任何计划必须结构化输出**为 `plan.json`（见 §4.2 计划 Schema），经批准后再执行。
4. **所有动作可回放**：每个动作都要产生日志事件，写入 `episodes/<trace_id>.json`，最终产物写入 `reports/*`。
5. **失败一次可修补一次**（Reviser），仍不达标则停机并生成改进建议。

---

## [Agent] 1. 项目地图（AOS v0.1）

- **形态**：前台单 Agent（聊天/控制台），后台微内核 + 可替换的 Planner/Executor/Critic/Reviser。
- **最小可信闭环**：Perceive → Plan → Execute → Review → Patch(once) → Log → Replay。
- **前端 v1 页面**：`/run`、`/episodes`、`/scores`；v2：`/chat`、`/workflows`、`/config`、`/workspace`。

目录骨架（MVP）：

```
/kernel      # 事件总线 | 内存 | 守护 | 度量
/plugins     # perceiver | planner | executor | critic | reviser
/packages    # providers/router | agents/registry | prompts | schemas
/apps        # server(Next.js/Express任选其一) | console(可选)
/skills      # csv.clean | stats.aggregate | md.render
/tests       # unit | integration | replay
/episodes    # 事件轨迹（*.json）
/reports     # 交付结果（*.md / *.html）
```

---

## [Agent] 2. 运行环境与工具

- **Node**：≥ 20.x（推荐 LTS）。
- **包管理器**：`pnpm`（优先）或 `npm`。代理必须检测并使用 `pnpm`，不存在时再降级。
- **前端**：Next.js + TypeScript + Tailwind（或等效栈）。
- **测试**：Vitest / Playwright。
- **可选**：`uv`/Python **暂不默认启用**；若需 CLI 评测，请在 PR 说明中显式申请。

> 代理不得创建或提交 `.env` 到仓库；密钥用本地 `.env.local` 或 CI 的 Secret。

---

## [Agent] 3. 一键命令（统一入口）

> 代理需优先使用以下脚本，禁止自定义临时命令（除非在 PR 中更新本节）。

在 `package.json` 中维护：

```jsonc
{
  "engines": { "node": ">=20" },
  "scripts": {
    "setup": "pnpm i",
    "dev": "next dev", // 或 express tsx watch
    "build": "next build && next export",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:ui": "playwright test",
    "smoke": "node scripts/smoke.mjs", // 触发最小闭环模拟
    "replay": "node scripts/replay.mjs", // 回放最近一次 episodes
    "score": "node scripts/score.mjs", // 统计成功率/延迟/成本
  },
}
```

常用命令：

```bash
pnpm setup     # 安装依赖
pnpm dev       # 本地运行（http://localhost:3000）
pnpm test      # 单元测试
pnpm smoke     # 端到端冒烟（Plan→Act→Review→Log→Replay）
pnpm replay    # 用最近的 trace 回放（离线）
pnpm score     # 生成 scoreboard.csv
```

---

## [Agent] 4. 产物与数据契约

### 4.1 Episodes（事件轨迹）

- 位置：`/episodes/<trace_id>.json`
- 结构：append-only 数组，带 Header：`provider/model/cost/latency/version`。

### 4.2 计划 Schema（`plan.json`）

```json
{
  "goal": "string",
  "constraints": ["string"],
  "budget": { "currency": "CNY", "limit": 1.0 },
  "acceptance": [{ "id": "A1", "given": "...", "when": "...", "then": "..." }],
  "steps": [{ "id": "S1", "action": "tool|skill|llm", "input": {}, "expect": "..." }],
  "risks": ["string"],
  "rollback": ["string"]
}
```

### 4.3 报告（最终交付）

- 位置：`/reports/*.md|*.html`（含图表可链接到 `public/`）。

### 4.4 Scoreboard（评测）

- SQLite/CSV：`scores.sqlite` / `scores.csv`；字段：`model, provider, pass, score, p50, p95, cost`。

---

## [Agent] 5. 页面与 API（v1）

### 5.1 页面

- **/run**：SRS/CSV/输出路径、角色选择、LLM 参数、预算/超时；提交返回 `trace_id`。
- **/episodes**：列表与详情（展开事件、回放/复跑）。
- **/scores**：成功率/延迟/成本图表，支持导出。

### 5.2 API 契约

```
POST /api/run              # body: srs_path, data_path, out, planner, executor, critic, reviser
GET  /api/episodes?limit=50
GET  /api/episodes/{trace_id}
GET  /api/scores?group_by=model&since=...&until=...&topN=10
```

---

## [Agent] 6. 验收与指标（Definition of Done）

- **质量**：通过所有 `acceptance` 条款，且 `score ≥ 0.8`；评审意见（reasons）无高危项。
- **性能**：示例数据 **p95 < 2s**（端到端 `pnpm smoke` 统计）；关键接口 p95 < 300ms。
- **成本**：默认 0（不调用付费 API）；如需使用必须在 PR 中列明成本与原因。
- **可回放**：同一 `trace_id` 在 `pnpm replay` 下产物字节级一致（忽略时间戳）。
- **前端体验**：
  - 首屏可交互（/run）本地 TTI < 2.5s；
  - **包体预算**：/run 初始 JS ≤ **220KB gzip**；/episodes ≤ **180KB gzip**；
  - **无障碍**：关键操作（提交/展开/回放）具备 aria 属性且可键盘操作（通过最小 a11y 检查脚本）。
- **兼容性**：Chromium 与 WebKit 本地验证通过（Playwright smoke）。
- **可观察性**：每次运行至少包含 `sense|plan|exec|review` 四类事件，写入 `/episodes/*`；`/reports` 存在最终交付文件。

---

## [Agent] 7. 守护与权限（Guardian）

- **预算**：每任务 `CNY≤1`（默认 0）。越线 → 暂停 → 人工确认三选：继续/降级/中止。
- **SLA**：延迟上限（p95≤8s）。
- **权限白名单（caps）**：
  - `fs:read`（受白名单路径约束：`/episodes`, `/reports`, `/public`, `/apps`, `/packages`, `/kernel`, `/skills`）
  - `fs:write.safe`（仅 `/episodes`, `/reports`, `/public`）
  - `net:http.get.public`（仅公开无鉴权接口；禁止外泄私密数据）
  - `exec:node`（`pnpm` 脚本）
  - **禁止**：修改 Git 历史、提交 `.env`、任意外网 POST、对 `/kernel` 结构性破坏。
- **必须升级到人**：预算越线、连续超 SLA、Schema 重大变更/PII 风险、`delta_score>0.5` 连续≥3、影响面≥20% 的版本切换。

---

## [Agent] 8. 工作流（代理执行剧本）

### 8.1 需求 → 计划（Plan）

1. 解析需求为 RUE SRS：`goal/constraints/acceptance/risks`。
2. 生成 `plan.json` 与 `episodes` 的 `plan.generated` 事件。
3. 待人类确认后继续。

### 8.2 执行（Act）

- 选择最便宜且可离线的技能（在 `/skills`），无法满足再调用 LLM。
- 每步落盘事件：`exec.start` → `exec.output` → `exec.finish`。

### 8.3 评审（Review）与修补（Patch）

- `Critic.review()` 输出 `{pass, score, reasons[]}`。
- 若 `score<0.8`，允许一次 `Reviser.revise()`，仍不通过则停机并产出建议。

---

## [Agent] 9. 前端实现约束（样式/交互）

- **技术**：Next.js + TS + Tailwind；组件库可选 shadcn/ui。
- **UI 规范**：网格布局；2xl 圆角；卡片软阴影；足够内边距；可折叠步骤；完成后默认折叠仅保留最终输出。
- **可观察性**：每个步骤以“Action 卡片”渲染（状态：pending/running/done/failed），支持展开日志。

---

## [Agent] 10. 常见任务剧本（Recipes）

### 10.1 新增页面 `/scores`

- 修改：`apps/server/pages/scores.tsx`（或等效路由）。
- 接口：`GET /api/scores`，图表：分组统计 + 趋势。
- 提交前：`pnpm typecheck && pnpm lint && pnpm test && pnpm smoke`。

### 10.2 新增技能 `stats.aggregate`

- 位置：`/skills/stats.aggregate.ts`，导出 `run(input): { table, summary }`。
- 注册：`/packages/agents/registry.ts`。
- 单测：`/tests/unit/skills.stats.aggregate.test.ts`。

### 10.3 修复 Bug 的最小提交

- 复现 → 加最小失败用例 → 修复 → 通过 → PR 附 `episodes` 片段（截图/JSON）。

---

## [Agent] 11. 代码规范与提交

- **语言**：TypeScript，严格模式；ESLint + Prettier。
- **提交信息**：Conventional Commits（`feat|fix|docs|refactor|test|chore`）。
- **分支**：`main` 受保护；功能分支 `feat/*`；修复分支 `fix/*`。

PR 清单：

- [ ] 通过 `typecheck/lint/test/smoke`；
- [ ] 附带 `episodes` 与 `reports` 截图/链接；
- [ ] 变更了契约/命令则同步本文件；
- [ ] 若使用了付费 API，附成本明细与原因。

---

## [Agent|Project] 12. 兼容性与别名

- 某些工具只识别 `AGENT.md`（单数）。为最大兼容，请在仓库根目录保留本文件的**同内容副本** `AGENT.md`（或软链）。
- 建议在 `README.md` 顶部提示：`For AI agents, read AGENTS.md first.` 以指导工具自动定位。

---

## [Agent|Project] 13. CI（GitHub Actions 示例）

> 用于在 PR 触发 `typecheck/lint/test/build/smoke`，并上传 `episodes/` 与 `reports/` 作为构建产物。

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "pnpm"
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - run: pnpm setup
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
      - run: pnpm smoke
      - uses: actions/upload-artifact@v4
        with:
          name: episodes
          path: episodes/**
      - uses: actions/upload-artifact@v4
        with:
          name: reports
          path: reports/**
```

---

## [Agent|Project] 14. 安全与隐私规范（细化）

- **日志脱敏**：默认对邮箱/手机号/身份证号等 PII 做中间 50% 马赛克（`abc****xyz`）。
- **外部网络**：仅允许 `net:http.get.public`；禁止向外 POST 私有数据；下载内容需校验 `content-type` 与大小上限（10MB）。
- **密钥**：不得提交 `.env*`；本地使用 `.env.local`，CI 通过 Secret 注入；代码中只引用 `process.env.*`。
- **权限变更**：涉及 `/kernel` 或协议变更需附设计说明与回放样例；默认进入 HiTL 审批。

---

## [Agent] 15. 排查与开发测试策略（Playbooks）

## [Agent|Project] 16. Stage-Gate 开发流程（以“能跑通”为中心）

> ⚠️ 面向自研 Agent 的注意事项：本节的门禁/产物对 AI 代理属于硬约束；治理背景与角色职责供人类协作参考，可在 `docs/PROJECT.md` 获取详解。

- **Intake（需求收集）**
  - 目标：澄清目标与边界，形成 RUE SRS。
  - 输入：用户诉求/素材。
  - 产物：`docs/SRS.yaml`（`goal/constraints/acceptance/risks` 必填）。
- **Discovery（探索与方案）**
  - 目标：在离线优先、最小成本的前提下选定方案。
  - 产物：`docs/decision.md`（方案对比/权衡矩阵，包含回退策略）。
- **Plan（计划）**
  - 目标：生成 `plan.json`（Schema 见 §4.2），并在 episodes 中记录 `plan.generated` 事件。
  - 门禁：Plan 必须经 Reviewer/TL 批准（评论或签名记录）。
- **Implement（实现）**
  - 目标：按最小纵切交付代码与单测，先冒烟再美化。
  - 门禁：`pnpm typecheck && pnpm test` 通过，相关产物入库。
- **Review（评审）**
  - 目标：运行 `Critic.review()` 输出 `{pass, score, reasons[]}`。
  - 门禁：`score ≥ 0.8`；`review.scored` 事件落盘。
- **Patch-Once（一次修补）**
  - 目标：仅一次 `Reviser.revise()`；同步差异说明。
  - 门禁：若仍未达标 → 停机并生成改进建议。
- **Stabilize（稳定/冒烟）**
  - 目标：完成端到端冒烟 `pnpm smoke`。
  - 门禁：产出 `episodes/*`、`reports/*`，并通过 `pnpm replay` 验证一致性。
- **Release（发布）**
  - 目标：准备合并/打标签，补充 `CHANGELOG.md` 与构建产物。
  - 门禁：CI 全绿（参见 §13）。
- **Observe（观察）**
  - 目标：收集 `p50/p95/成功率/成本`。
  - 产物：`scores.csv|sqlite`；门禁：指标不低于基线。
- **Learn（沉淀）**
  - 目标：将经验回写至 `AGENTS.md`、`recipes/*` 或脚本，强化护栏。

> 💡 治理视角补充（人类协作者重点）：角色职责与 RACI/阶段角色矩阵详见 `docs/PROJECT.md` §5-§6；Solo 模式需在 PR 中声明角色切换并附回放证据。

### 15.1 通用 8 步

1. 明确定义失败（期望 vs 实际，复现命令）。
2. **最小化复现**（最少输入/最短步骤）。
3. 查看 **日志与事件**：`episodes/*` 中 `error|warn`，前端 Console/Network。
4. 建立假设 → 做一次可证伪改动（或加打印/断言）。
5. 检查 **预算/SLA/权限** 是否触发 Guardian。
6. 回放：`pnpm replay`（冻结 provider、温度 0、固定 seed）。
7. 修复后补一个 **回归用例**（单测或冒烟步骤）。
8. 记录在 `recipes/troubleshooting.md`，防复发。

### 15.2 前端（UI/交互）

- **首查**：DevTools Console/Network/覆盖率；React 错误边界与 hydration 警告。
- **类型**：`pnpm typecheck`；确保 `zod/io-ts` 接口契约与 API 返回匹配。
- **性能**：首屏 TTI、包体大小；使用动态导入与 RSC/SSR 兜底；避免瀑布请求。
- **可获取性**：关键操作带 `aria-*` 与键盘操作路径；Playwright 检查通过。

### 15.3 API/服务

- **健康检查**：`GET /api/health`（若无请实现）。
- **契约**：为 `/api/run|episodes|scores` 写 **契约测试**（针对输入/输出 Schema）。
- **错误**：统一错误格式 `{code,message,trace}`；后端 4xx/5xx 加入 `trace_id` 以便回放定位。

### 15.4 Agent/LLM 特有

- **去随机**：`temperature=0`、设置 `seed`、固定 provider 版本。
- **Prompt 漂移**：把系统/工具提示与用户输入写入 `episodes`；对比差异。
- **评分波动**：启用 **双重评审**（同模型两次/或交叉模型）+ 置信区间阈值。
- **成本保护**：先跑本地 `skills/*`；越线触发 HiTL。

### 15.5 常见故障速查

| 症状              | 可能原因                | 立即动作                                               |
| ----------------- | ----------------------- | ------------------------------------------------------ |
| `/run` 白屏       | 包体过大/SSR 失败       | 动态拆包、检查 `next build` 报警、降回最近可用提交回放 |
| `episodes` 无事件 | 事件未落盘/路径权限     | 检查 `kernel/bus` 写路径与权限白名单                   |
| `pnpm smoke` 失败 | 依赖/环境差异           | 清缓存 `pnpm store prune`，锁定 Node 20，重装          |
| 评分低于 0.8      | 接受条件不全/提示词偏移 | 精化 `acceptance`、冻结 prompt、启用 Patch-Once        |
| 成本超标          | 走了外部 LLM            | 降级到本地 `skills` 或缩小输入                         |

---

## 16. 质量门禁（PR Gate）

合并前必须满足：

- ✅ `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm smoke`
- ✅ 附 `episodes/` 与 `reports/` 的最近一次产物（或 CI Artifact 链接）
- ✅ 如改动协议/结构：附 **迁移/回滚方案** 与回放样例
- ✅ 若触及 Guardian：附预算评估与审批记录

---

更多项目治理信息（Stage-Gate、RACI、Intake 等）请参阅 `docs/PROJECT.md`。
