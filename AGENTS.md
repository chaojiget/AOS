# AGENTS.md — Coding Agents Operating Guide (UI‑First, Trigger‑Driven)

> **统一指代**：本文一律以“你”指代**AI 编码工具**（如 Codex、Claude Code、Copilot、Cursor 等）。
>
> **文件目的**：为“编码代理”提供可执行的**作业契约**与**交付规范**。
>
> **重要边界**：本文件**不描述**本项目要实现的“Agent 产品/特性”；仅规定**如何写代码、如何验证、如何提交**。

---

## 0. 需求澄清与启动（一次性问全）

* **一次性问全**：开始前，你必须在仓库根创建/更新 `RESULT.md` 的\*\*「需求澄清」\*\*小节（中文），收集并写清：

  1. 业务目标与可量化指标；
  2. 范围边界（包含/不包含）；
  3. 目标用户与使用场景（主路径/异常路径）；
  4. UI 验收的\*\*「要有…或是…」\*\*条目（≥2 条，见 §4.1）；
  5. 依赖与契约（上/下游、数据/接口）。
* **缺信息的处理**：无法获得的信息，用 `# ASSUMPTION:` 明示假设，并附最小复现场景；**不要停工等待**。
* **迭代节奏**：启动后，除非触发 §10 的事件，**不要再追加澄清对话**；**一直实现直到 UI 门通过**，再开始新的迭代（敏捷式：以「单个 UI 可感能力点」为单位）。

## 1. 工作模式（无时间盒｜触发驱动）

* 你以**证据（Proof‑of‑Progress, PoP）**与**触发事件**推进，不以时间切片推进。
* 任何进展必须落为**凭证**（脚本、测试、录屏、报告、链接）；**无凭证 = 无进展**。
* 触发事件包括：**完成触发 / 红线触发 / 偏差触发 / 依赖触发 / 风险触发**（详见 §10）。

---

## 2. 仓库自检与命令推断（必须执行）

在任何修改前，**读取并解析**下列文件，推断开发栈与命令：

1. 包管理器优先级：`pnpm-lock.yaml` > `yarn.lock` > `package-lock.json`。
2. 工作区：`package.json` 的 `workspaces` 或 `pnpm-workspace.yaml`。
3. 脚本命令：优先读取根与目标 app 的 `package.json`：`dev`/`build`/`test`/`lint`/`e2e`。
4. 环境与配置：`.env*`、`tsconfig*.json`、`next.config.js`/`vite.config.*` 等。

> **输出要求**：在 `RESULT.md` 开头写明**判定结果**与**最终采用的命令**，例如：
>
> ```md
> 包管理器：pnpm（依据 pnpm-lock.yaml）
> 目标应用：apps/web
> 开发：pnpm --filter @app/web dev
> 构建：pnpm --filter @app/web build
> 测试：pnpm test
> ```

---

## 3. 交付物与 PoP（Proof‑of‑Progress）

你每个阶段必须生成至少一种 PoP，并把链接/路径写入 `RESULT.md`：

* **PoP‑UX**：UI 录屏 + Web‑Vitals（LCP/INP/CLS）报表或截图。
* **PoP‑REP**：`reproduce.sh` 最小复现场景（见 §12.2 模板）。
* **PoP‑API**：契约测试（OpenAPI/错误码表/状态码）通过报告。
* **PoP‑OBS**：观测与告警面板链接/截图（关键指标与阈值）。
* **PoP‑ROLL**：回滚脚本 + 演练记录（触发条件与步骤）。

---

## 4. UI‑First（你的验收以“UI 体验”为准）

* 你只围绕**可感体验**交付：**操作路径是否顺畅、交互是否可达、性能体感是否达标**。
* 任何非 UI 产出（如后端/脚手架/脚本），都必须**映射到可感场景或指标**。

### 4.1 或条件验收（只绑体验，不绑实现）

在 `RESULT.md` 中写明你满足的**或条件**（至少 2 条）：

* 要有 **全局搜索入口** **或是** **⌘K 命令面板**；`INP ≤ 200ms`；证据：录屏 + 埋点。
* 要有 **错误兜底页** **或是** **Toast + 一键重试**；**可恢复率 ≥ 95%**。
* 要有 **Loading 骨架屏** **或是** **渐进内容占位**；**首屏可感等待 ≤ 1.0s**。
* 关键操作 **≤ 3 次点击**可达；**布局稳定（CLS ≤ 0.1）**。

> 参见 §12.1 获取 Web‑Vitals 埋点与录屏脚本片段。

---

## 5. 变更边界与禁区（默认约束）

* **小步提交，控制影响半径**：优先在目标 app 内变更，避免跨包全局性重构。
* **不要硬编码密钥/账号**；使用 `.env.local`，并更新 `.env.example`（见 §11）。
* **禁止**越权改动：CD/Infra/账号权限、计费相关代码、数据清洗/脱敏策略。
* **公共接口/契约**变更必须新增/更新**契约测试**并在 PR 中说明影响范围。

---

## 6. 代码与风格（TypeScript 首选）

* TS `strict: true`；ESLint + Prettier；路径别名需在 `tsconfig.json` 与打包器配置中一致。
* 禁止大范围“格式化型”提交；提交粒度 **≤ 200 行差异/次**（可拆 PR）。
* 组件要求：无副作用、可测试、可无障碍（基本 ARIA），状态尽量上移或使用稳定状态管理。

---

## 7. 测试与质量门（DoD‑Deep）

* **单测**：关键路径单测覆盖 ≥ 80%。
* **契约测试**：OpenAPI/错误码/状态码一键校验通过。
* **E2E**：核心三条任务路径 Playwright 通过（含错误可恢复）。
* **UI 门**：P0 体验缺陷 = 0；P1 ≤ 2 且有绕行；达成 §4 的或条件项。
* **回滚**：提供脚本 + 演练记录；任何失败可一键回退。
* **观测**：关键日志与指标、阈值、告警规则可用。

> 通过上述 6 项，才可把状态标记为**完成触发**（见 §10）。

---

## 8. 提交流程（分支｜提交｜PR）

* **语言要求**：所有与人交互的信息（对话、`RESULT.md`、PR 描述、代码注释）**必须使用中文**；必要英文术语可括注。
* 分支：`feat/<scope>-<slug>`、`fix/<scope>-<slug>`。
* 提交：**Conventional Commits**；每次提交附**中文**“动机一句话”。
* PR：

  * 标题：`feat(scope): what & why`（可中英混排，含中文要点）。
  * 描述字段（中文）：**变更摘要**、**影响范围**、**验证步骤**、**或条件验收**、**PoP 链接**、**回滚方案**。
  * 体量：差异 ≤ 400 行；超过请拆分。

## 9. 结果产出（RESULT.md 必填） 结果产出（RESULT.md 必填）

每次执行在仓库根创建或更新 `RESULT.md`，包含：

1. 栈与命令判定结果（§2）；
2. 本次改动摘要与变更文件列表；
3. 你满足的**或条件**条目（§4.1）；
4. 通过的**质量门**勾选（§7）；
5. PoP 链接；
6. 回滚命令与验证步骤。

---

## 10. 触发式对齐（触发事件与动作）

* **完成触发**：§7 全部通过 → 产出 PR + RESULT.md + PoP 链接。
* **红线触发**（立即停止并输出 `BLOCKERS.md`）：

  1. 需要修改对外 API 契约且无可证明收益；
  2. 触及安全/合规/敏感数据；
  3. 无法在 **两次尝试**内产出任何 PoP；
  4. 发布无法回滚；
  5. 依赖方或数据模式突变未获确认。
* **偏差触发**：关键 UX 指标连续两次不达标 → 启动“性能改造”子任务，给出三案并陈（成本/收益/风险）。
* **依赖触发**：跨包/跨服务接口或数据依赖变化 → 生成 `DEPENDENCIES.md` 片段并在 PR 说明。
* **风险触发**：风险预算超限（开放 P1、可恢复率、LCP/INP/CLS 等）→ 记录与缓解。

---

### 附：LangGraph 替换计划（JS/TS，最小改动）

- 目标：以 LangGraph.js 替换自研 ChatKernel，保持 API/事件/前端无感。
- 依赖：pnpm add @langchain/langgraph @langchain/core @langchain/openai。
- 接入点：
  - core/agent.ts：保留 AgentKernel 与 runLoop 契约不变。
  - adapters/core.ts：新增 createLangGraphKernel(options) 实现 AgentKernel（包装 LangGraph createReactAgent 或 StateGraph）。
  - servers/api/src/runs/run-kernel.factory.ts、cli.ts：当 AOS_AGENT=langgraph 时走 createLangGraphKernel；默认保持现状。
- 实施步骤：
  1) 安装依赖；
  2) 在 adapters/core.ts 实现 LangGraphKernel：使用 createReactAgent + MemorySaver，以 options.traceId 作为 thread_id；先支持对话路径，阶段性不启用工具；
  3) Phase 2 绑定工具：将现有 ToolInvoker 映射为 LangGraph ToolNode，逐步接入 MCP 工具；
  4) 回归：pnpm test、pnpm test:ui，手测 /api/runs 流事件（需有 chat/final/run.finished）。
- 回滚：仅切换环境变量 AOS_AGENT=core 即可。
- 风险与缓解：成本上升（加 budget 限制）、事件终止性（兜底发 run.finished）、开关可控（默认 core）。

## 11. 安全与密钥

* 新增/调整 `.env.example`；不得提交真实密钥。
* 读取顺序：`.env.local` > `.env`；必须校验缺失键并给出友好报错。
* 任何外部请求都应具备**超时/重试/熔断**与**最小权限**。

---

## 12. 附录：可复用片段与模板

### 12.1 Web‑Vitals 与录屏（片段）

```ts
// ux/vitals.ts — 采集 LCP/INP/CLS 到 /api/ux
import { onLCP, onINP, onCLS } from 'web-vitals/attribution';
function post(metric:any){ fetch('/api/ux', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metric)}).catch(()=>{}); }
onLCP(post); onINP(post); onCLS(post);
```

> 录屏：首选浏览器内置录屏或 Playwright `page.video()`，生成 `artifacts/ux/*.webm`。

### 12.2 `reproduce.sh`（最小复现）

```bash
#!/usr/bin/env bash
set -euo pipefail
# 0) 安装
if command -v pnpm >/dev/null; then PM=pnpm; elif command -v yarn >/dev/null; then PM=yarn; else PM=npm; fi
$PM install
# 1) 启动目标应用（按需修改路径）
$PM --filter @app/web dev & PID=$!
# 2) 复现场景（示例：调用本地 API 并断言返回码）
curl -sS http://localhost:3000/api/health | grep 'ok'
kill $PID
```

### 12.3 Playwright 样例（E2E 主路径）

```ts
import { test, expect } from '@playwright/test';
test('核心路径可达且稳定', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '搜索' }).click();
  await page.keyboard.press('Control+K');
  await expect(page.getByPlaceholder('搜索…')).toBeVisible();
});
```

### 12.4 RESULT.md 模板

````md
# RESULT
## 需求澄清（中文）
- 业务目标：
- 范围（包含/不包含）：
- 使用场景（主路径/异常路径）：
- UI 验收或条件（≥2 条）：
- 依赖与契约：
- 假设（若有，带到期条件）：

## 栈与命令
- 包管理器：
- 目标应用：
- dev/build/test：

## 变更摘要
- …

## 或条件验收（选择已达成项并附证据链接）
- [ ] 搜索入口或命令面板（INP ≤ 200ms）
- [ ] 错误兜底或重试（可恢复率 ≥ 95%）
- [ ] 骨架屏或渐进占位（首屏 ≤ 1.0s）
- [ ] 三步直达关键操作；CLS ≤ 0.1

## 质量门（DoD‑Deep）
- 单测≥80% / 契约测试 / E2E 通过 / UI 门通过 / 回滚可用 / 观测可用

## PoP 链接
- UX：
- REP：
- API：
- OBS：
- ROLL：

## 回滚
- 命令：
- 验证步骤：
```md
# RESULT
## 栈与命令
- 包管理器：
- 目标应用：
- dev/build/test：

## 变更摘要
- …

## 或条件验收（选择已达成项并附证据链接）
- [ ] 搜索入口或命令面板（INP ≤ 200ms）
- [ ] 错误兜底或重试（可恢复率 ≥ 95%）
- [ ] 骨架屏或渐进占位（首屏 ≤ 1.0s）
- [ ] 三步直达关键操作；CLS ≤ 0.1

## 质量门（DoD‑Deep）
- 单测≥80% / 契约测试 / E2E 通过 / UI 门通过 / 回滚可用 / 观测可用

## PoP 链接
- UX：
- REP：
- API：
- OBS：
- ROLL：

## 回滚
- 命令：
- 验证步骤：
````

### 12.5 `.env.example` 模板

```dotenv
# 服务端
API_BASE_URL=
API_TIMEOUT_MS=8000
# 客户端
NEXT_PUBLIC_APP_NAME=
```

---

## 13. 你的行为总则（面向编码代理）

1. **中文优先**：与人交流、PR/RESULT.md、代码注释统一使用中文；必要英文术语可括注。
2. **先问清再启动**：在 `RESULT.md` 完成**一次性需求澄清**；缺失信息用 `# ASSUMPTION:` 明示并可验证。
3. **持续实现到 UI 门通过**：启动后不插播追加问题，除非触发 §10；**通过 UI 门**后才进入下一迭代。
4. **结论先行**：在 `RESULT.md` 顶部直给“改了什么、为何改、如何验证、如何回滚”。
5. **敢于假设**：把不确定变成可验证假设与脚本，优先可运行。
6. **小步快跑**：一次只引入必要依赖，优先复用；避免大改与广域格式化。
7. **以终为始**：所有代码改动服务于 §4 的**或条件验证**。
8. **留痕可追**：脚本/录屏/报告入 `artifacts/` 或 `docs/` 并在 PR/RESULT.md 引用。
