# Agent OS 自迭代系统：完整项目方案（精炼版 v1）

> 本文保留阶段性方案推演与决策上下文。关于最新、可实施的需求，请优先查阅《[需求全景规划（最终基线）](../需求全景规划.md)》与 `docs/SRS.yaml`。

> 版本：v1 · 更新：2025-09-18  · 面向：自研核心 + 三方集成  · 基线环境：Node.js 22 + TypeScript · 本地 SQLite + SSE/WS

---

## 0. 执行摘要（Executive Summary）

**目标**：构建可“自感知—自反思—自改进”的单体 Agent OS，最小可跑通样例以**本地 SQLite** 持久化、**SSE/WS** 实时日志、**MCP 工具**调用为核心；第二阶段实现**工具日志→技能固化→Agent 改进**闭环。

**关键赌注**：

* 先立**日志契约**与**运行回路**，后接 UI 与多 Agent；
* 以**离线回放**作为回归与评测基石；
* 技能固化遵循**高复用/高收益优先**。

**成功标准**（MVP 验收）：

* 可在聊天页提交任务，Agent 通过 MCP 工具完成 1 次外部行动，**实时可视化**过程，并产生**FINAL\_ANSWER**；
* 产生规范化 LogEvent 序列，支持**离线回放**复现；
* 从最近 N 次任务自动提取≥1 个可复用**Skill**并在后续任务中被调用。

---

## 1. 目标与非目标

### 1.1 目标（6 周内达成）

1. 建立稳定的 **Observe → Think → Act → Reflect** 循环与停止条件；
2. 统一 **日志/事件契约**，支持实时（SSE/WS）+ 离线回放；
3. 集成 ≥1 个 **MCP 工具**（建议：Playwright MCP/HTTP MCP）；
4. 上线 **技能固化**流水线（从日志→模板→审核→落库→灰度使用）；
5. 提供 **最小 UX**（聊天页 + 日志/流程图 + 技能面板）；
6. 建立基础 **评测指标**（成功率、循环步数、工具命中率、延迟、成本）。

### 1.2 非目标（当前版本不做）

* 不做复杂多 Agent 编排与大规模并行；
* 不做云端多租户与账号体系；
* 不做在线学习/权重更新，仅**基于日志/提示词/技能**的结构性改进。

---

## 2. 原则（First Principles）

1. **最少可行闭环**：任何新增能力必须可被日志追溯与回放；
2. **可解释**：每一步都有事件、输入/输出与理由（reflection）；
3. **可控**：硬停止条件 + 预算/步数上限 + 审核阈值（人机共驾）；
4. **增量式自进化**：优先把“重复高”的动作提炼为 Skill；
5. **前后端解耦**：事件驱动，前端仅渲染 LogEvent/Plan 图谱。

---

## 3. 架构总览

* **API 层（NestJS）**：REST + SSE/WS；统一鉴权、限流；
* **Agent 引擎**：最小图式循环（节点：Observe/Think/Act/Reflect/Stop）；
* **MCP 适配层**：标准化工具调用（schema 校验、超时与重试）；
* **Skill Registry**：技能模板（输入约束/执行器/评估策略）；
* **Log/Trace 层**：Pino + OpenTelemetry（可选）统一打点；
* **存储**：Drizzle ORM + SQLite（chats / runs / events / skills / memories / mcp\_configs / evals）；
* **前端**：Next.js（SSR）聊天 + 流程/日志 + 技能面板；首次只订阅**实时 SSE**，历史**按需分页**。

> 说明：BullMQ（Redis）作为可选队列；本地可直接异步任务池替代，降低复杂度。

---

## 4. 运行模型（Loop）

### 4.1 状态机

```
START → Observe → Think → (Use Skill?) → Act (MCP/Skill) → Reflect (局部) →
  ↳ 若满足完成条件 → Stop(FINAL_ANSWER)
  ↳ 否则回到 Think（步数+1，受上限/预算约束）
```

### 4.2 停止条件

* 命中模型输出标记：`FINAL_ANSWER`/`DONE`；
* 步数上限（默认 12）或预算上限（token/cost）；
* 任务时限（如 60s 无进展）。

### 4.3 保护栏（Guardrails）

* 工具白名单 + 参数 schema 校验；
* 幂等工具（优先 GET/模拟写）；
* 行动前后 **Reflect**（理由、置信、风险）；
* 敏感操作需要 **用户确认**（前端弹窗）。

---

## 5. 模块与接口

### 5.1 REST / SSE API（建议初版）

* `POST /api/agent/start`  启动任务 → `{ runId }`
* `GET  /api/runs/:runId`  运行摘要
* `GET  /api/runs/:runId/events?since=ts`  历史分页
* `GET  /api/runs/:runId/stream`  **SSE** 实时事件
* `POST /api/skills/analyze`  触发日志分析与技能候选生成
* `GET  /api/skills`  列表；`POST /api/skills/:id/enable`
* `POST /api/mcp/register`  注册 MCP 服务配置

### 5.2 事件类型（SSE `event:`）

* `run.started` / `run.updated` / `run.finished`
* `plan.updated`（Plan JSON/Graph 变更）
* `tool.started` / `tool.succeeded` / `tool.failed`
* `reflect.note`（思考与理由）
* `skill.used` / `skill.candidate`
* `user.confirm.request`（需要前端确认）

---

## 6. 数据模型与契约（Drizzle/SQLite）

> 字段命名统一使用 **snake\_case**；关键表如下。

### 6.1 表概览

* **runs**：`id, task, status, started_at, finished_at, step_count, budget_tokens, budget_usd`
* **events**：`id, run_id, ts, type, status, title, payload_json, token_input, token_output, cost_usd, duration_ms`
* **skills**：`id, name, version, template_json, enabled, created_at, used_count, win_rate`
* **memories**：`id, scope(user|global), key, value_json, updated_at`
* **mcp\_configs**：`id, name, base_url, auth_json, created_at, enabled`
* **evals**：`id, run_id, label(success|fail|partial), notes, checker, created_at`
* **ab\_tests**：`id, run_id, variant, notes`

### 6.2 事件契约（LogEvent 最小集）

```json
{
  "id": "uuid",
  "run_id": "uuid",
  "ts": "RFC3339",
  "type": "plan.updated|reflect.note|tool.started|tool.succeeded|tool.failed|run.finished",
  "status": "info|success|error",
  "title": "string",
  "payload": {"free": "object"},
  "token_input": 0,
  "token_output": 0,
  "cost_usd": 0.0,
  "duration_ms": 0
}
```

### 6.3 计划与技能模板

**PlanStep**

```json
{ "id": "step-1", "desc": "抓取页面", "tool": "mcp.playwright.goto", "args": {"url": "..."} }
```

**SkillTemplate**（最小）

```json
{
  "name": "WebExtractSkill",
  "match": {"intent": ["抽取", "抓取", "解析表格"]},
  "inputs": {"url": "string", "selectors": "string[]"},
  "execute": {"tool": "mcp.playwright.extract", "args_map": {"url": "$.url", "selectors": "$.selectors"}},
  "success_criteria": ["返回 JSON 且包含字段 X"]
}
```

---

## 7. 技能固化流水线（第二阶段）

1. **采集**：从 `events` 聚合重复高的工具调用序列；
2. **总结**：LLM 从样本生成 SkillTemplate 草稿（含输入约束、成功标准）；
3. **审核**：人审 + 小样本回放评测（win\_rate ≥ 60% 启用）；
4. **投放**：在 Think 阶段优先匹配 `match.intent`，命中则**跳过规划**直达执行；
5. **持续评估**：`used_count / win_rate` 动态排名，坏技能自动下线。

---

## 8. 反思与改进（Reflect / Improve）

* **局部反思（在线）**：每次 Act 后记录 `reflect.note`（为何行动、下步假设）。
* **全局反思（离线/定期）**：定时任务扫描最近 runs，生成：

  * Prompt 改写候选（保存在 `memories`）；
  * 技能候选；
  * 失败用例聚类（用于回归数据集）。
* **A/B 实验**：`ab_tests` 记录不同提示/图结构的差异，统计成功率与成本。

---

## 9. UX 规范（聊天 / 日志 / 流程图）

* **聊天页**：

  * 同轮仅常显“总结/答案”，中间步骤折叠；
  * 右上角“最终回复条”可定位与复制；
  * Inspector 侧栏展示 Plan / Act / Trace；
  * 默认仅订阅**实时 SSE**，历史**点击加载**；
  * 关键字过滤（type/status/title/payload.key）。
* **日志页（Logflow）**：

  * 首屏仅实时流；“查看更多”分页历史；
  * Meta 区域显示 token/cost/latency 聚合；
  * 多层折叠：工具组 → 单步 → 详情；
  * 允许按 `run_id`、时间、类型过滤。

---

## 10. 测试与回放

* **Golden Logs**：固定输入→固定事件序列校验；
* **离线回放**：读取 `events` 按时间驱动 UI 与引擎（不调用外部）；
* **故障注入**：工具超时/失败重试/断网；
* **基准**：单任务 95p 时延、平均步数、成本上限。

---

## 11. 安全与隐私

* 本地优先，默认不开云端；
* Secrets 管理（.env + 进程注入，UI 不落盘）；
* 敏感域前置用户确认；
* 数据保留策略：runs/events 默认 30 天（可配置）。

---

## 12. 指标（KPIs & 健康度）

* 任务成功率（成功/全部）
* 平均循环步数 / 工具命中率 / 工具成功率
* 平均延迟（分位数）
* 成本（USD/任务、Token/任务）
* 技能**复用率**与**胜率**

---

## 13. 决策建议（明确立场）

1. **先自研最小图式循环**（可替代 LangGraph），接口保持兼容，避免早期过度依赖；
2. **队列暂缓**：单机内异步即可，待 I/O 增长再引入 BullMQ；
3. **只接 1 个 MCP 优先级最高工具**（Playwright MCP 或 HTTP MCP），先跑通技能固化链路；
4. **日志先行**：未签事件契约前不写 UI/引擎细节。

---

## 14. 里程碑与工期（6 周建议）

* **W1**：签事件契约与 API；建表；打印最小事件流
* **W2**：跑通单任务 Loop + SSE；前端最小聊天页
* **W3**：接入 1 个 MCP 工具；完成 `tool.*` 事件
* **W4**：日志分析与技能候选生成（离线）；前端技能面板
* **W5**：技能启用 + 回放框架；A/B 最小闭环
* **W6**：指标面板 + 稳定性（故障注入/超时/重试）

**每周验收**：可演示、可回放、可度量。

---

## 15. 配置与样例

**.env（示例）**

```
OPENAI_API_KEY=***
MCP_PLAYWRIGHT_BASE_URL=http://localhost:8080
RUN_STEP_LIMIT=12
RUN_BUDGET_TOKENS=20000
```

**错误码（建议）**

* `AOS-TOOL-001` 工具超时
* `AOS-PLAN-002` 计划生成失败
* `AOS-RUN-003` 超过步数/预算

**命名约束**：资源小写下划线；事件 `type` 使用 `.` 分层。

---

## 16. 附录：时序与伪代码

**时序（文字版）**

1. POST /agent/start → `run.created` → `plan.updated`
2. `tool.started`（MCP 调用）→ `tool.succeeded`/`tool.failed`
3. `reflect.note` → 决策（Stop 或下一步）
4. `run.finished(FINAL_ANSWER)`

**引擎伪代码（缩略）**

```ts
for step in range(LIMIT):
  observe()
  thought = think()
  if skill := match_skill(thought):
    emit('skill.used', skill)
    result = execute_skill(skill)
  else:
    emit('tool.started')
    result = call_mcp(thought)
  emit('reflect.note', rationale(result))
  if done(result): break
emit('run.finished', FINAL_ANSWER)
```

---

## 17. 风险与缓解

* **无限循环**：硬上限 + 反思阈值；
* **工具脆弱**：超时/重试/断路器；
* **技能退化**：滑窗评估 + 自动下线；
* **成本失控**：预算/任务 + 历史分布告警。

---

## 18. 下一步所需输入（从你处）

* 优先 MCP 工具名单（1–2 个即可）；
* 是否启用成本度量（token/cost）与阈值；
* UI 主题与折叠策略的最终取舍（默认按本方案）。

— 以上，供评审与落地使用。
