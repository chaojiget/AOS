# AgentOS（AOS）最小核 · Agent Kernel v0

> 本文为历史草稿，记录 v0 最小核的设计思路与术语。最终需求基线请参见《[需求全景规划（最终基线）](../需求全景规划.md)》，若存在冲突以最新基线为准。

### 导读（读者对象 / 适用范围）

- **读者对象**：产品/架构/前端/后端一人团队或小团队；目标是在最少文件与依赖下跑通可回放的 Agent 闭环。
- **适用范围**：只包含 Agent 内核、事件总线、Episode(JSONL) 与 Replay；首阶段仅提供 **Chat + LogFlow** 单页。

### 非目标与边界（Out of Scope；前置原 §7）

- 暂不实现：Workflows 调度、Pages 部署、Scores 报表、Config 面板、Workspace 文件编辑、语音、审批弹窗、多 Provider 路由、预算护栏。
- 运行边界：单机/单进程/单租户；本地或内网；不做真实对外写操作（除非手动导出）。

### 术语表（关键名词）

- **Episode**：一次运行的**追加写 JSONL** 事件集（可版本化），用于审计与回放。
- **Trace**：一次会话/运行的全局标识；Episode 目录以此命名。
- **Span**：任务或子步骤的节点（可嵌套），以 `span_id/parent_span_id` 串起分支。
- **Msg**：聊天主链上的消息节点，`origin_msg_id` 用于锚定分支的来源。
- **RunLoop**：`perceive → plan → act → review → final` 的最小流程。
- **MCP**：能力提供协议；所有工具/记忆尽量以 MCP 暴露，内核仅做编排与回放。

### 阅读地图与验收锚点（DoD · 摘要，完整见原 §8）

- `pnpm run dev` 启动单进程：暴露 `/api/run` 与单页 UI（Chat + LogFlow）。
- 示例用例：CSV → 统计 → Markdown；全流程事件可见，**Episode 落盘**。
- `pnpm run replay <trace_id>` 可离线复现同产物；事件时序一致。
- 最少单元测试：`runLoop`、`EpisodeLogger`、`Replay` 三处。
- 阅读顺序建议：§1 原则 → §2 MVP → **（本 DoD 摘要）** → §3 代码骨架 → §10 事件总线 → §16 索引与分支 → §17 Chat/LogFlow。

---

> 目标：**只保留最核心的 Agent 能力与可回放日志**，其余页面/编排/评分等机制全部延后，由“运行日志→改进器”逐步长出来。

---

## 1) 设计原则（Slim-First）

- **User-Centric 改进**：仅基于运行日志改进**提示词/测试策略/MCP 配置**，**第一阶段不自动改 Agent 代码**。
- **可回退**：所有策略/MCP/提示词均纳入版本目录（vNNN），支持 `checkout` 回退；升级默认需要**显式用户同意**（第一阶段可关闭此流程，仅保留手动切换）。
- **Agent-Centric**：围绕一个 `AgentKernel` 把感知→计划→行动→评审→产出打通。
- **少即是多**：单仓、单服务、单页面；10 个以内源码文件跑通 MVP。
- **可回放**：所有外部调用落成 **JSONL Episode 日志**，`replay` 必须得到同产物。
- **日志驱动自我改进**：改进来源只看运行日志；改进器（Improver）是旁路进程，**不影响内核稳定性**。
- **TypeScript 一体化**：前后端/CLI 统一 TS；可无痛切到 Python，但契约不变。

---

## 2) MVP 只做五件事

1. **Perceive**：吸收 SRS/上下文/文件
2. **Plan**：产出可执行 Plan（JSON）
3. **Act**：按 Plan 调用 LLM/工具
4. **Review**：规则评分，决定是否通过
5. **Log/Replay**：写 Episode（JSONL），可离线重放

> **无计划兜底**：若 `plan()` 返回空/失败，则直接生成**文本答复**返回前端（标注“未生成 Plan”），并落盘原因与上下文。 UI 只要一个 **Chat × RunLoop 折叠卡**；后续 Episodes/Workflows/Scores 页面全部延后。

---

## 3) 代码骨架（≤ 10 源码文件，根配置不计）

```
/aos
  /core
    agent.ts         # AgentKernel 接口与 runLoop（感知/计划/执行/评审/产出）
  /runtime
    events.ts        # 进程内事件总线 + WS 转发（可选）
    episode.ts       # EpisodeLogger：append-only JSONL + （批量）写索引
    replay.ts        # 重放引擎：读 JSONL → 产出复现
  /adapters
    core.ts          # 合并 LLM + Tools 适配（/chat.completions 兼容；内置 echo/http.get/file.read）
  /server
    http.ts          # POST /api/run；GET /api/episodes/{id}；WS /agent/events；LogFlow 只读接口
  /ui
    index.html       # 单页：聊天输入 + RunLoop/LogFlow 折叠卡
  cli.ts            # 命令：run / replay / inspect / index
  package.json      # 最小依赖与脚本（见下）
  tsconfig.json     # TS 最小配置
  config.example.json
  mcp.registry.json # MCP 端点登记（可选）
```

**命名与依赖约定（白名单）**

- 目录固定为：`core / runtime / adapters / server / ui / cli`；文件名使用 _kebab-case_；公共类型从 `core/*` 导出；默认导出一个主入口。
- 依赖白名单：Node 内置模块（`node:http` 等）、`ws`（可选，用于 WS）、`better-sqlite3`（可选，用于本地索引）、`ulid`（可选，ID 生成）。其余三方依赖默认禁止。
- 若文件数逼近上限，可将 `server/http.ts` 的非核心路由内联到 `cli.ts` 的开发模式中。

**pnpm scripts（最小集）**

```json
{
  "scripts": {
    "dev": "tsx server/http.ts",
    "build": "tsc -p .",
    "test": "vitest run",
    "replay": "tsx cli.ts replay",
    "index": "tsx cli.ts index rebuild",
    "format": "prettier -w .",
    "lint": "eslint ."
  }
}
```

**最小 Tool I/O 契约与错误语义（片段，放入 \*\***\`\`\***\*）**

```ts
export type ToolError = { ok: false; code: string; message: string; retryable?: boolean };
export type ToolOk<T = any> = { ok: true; data: T; latency_ms?: number; cost?: number };
export type ToolResult<T = any> = ToolOk<T> | ToolError;
export interface ToolCall<TArgs = any> {
  name: string;
  args: TArgs;
}
export type ToolInvoker = (
  call: ToolCall,
  ctx: { trace_id: string; span_id?: string },
) => Promise<ToolResult>;
// 约定：
// - 所有工具失败都返回 {ok:false,code,message,retryable}，不得 throw；
// - LLM 调用包装为工具 `llm.chat`，与普通工具同构，便于回放与降级。
```

---

## 4) 核心接口（TypeScript 草案）

```ts
// core/agent.ts
export type Step = "perceive" | "plan" | "act" | "review" | "final";
export type Event =
  | { type: "progress"; step: Step; pct: number; note?: string }
  | { type: "io"; dir: "in" | "out"; name: string; mime?: string; bytes?: number }
  | { type: "tool"; name: string; args: any; result?: any; cost?: number; latency_ms?: number }
  | { type: "score"; value: number; passed: boolean; notes?: string[] }
  | { type: "final"; outputs: any };

export interface AgentKernel {
  perceive(ctx: any): Promise<void>;
  plan(): Promise<{ steps: Array<{ id: string; op: string; args: any }> }>;
  act(plan: any): Promise<any>; // 执行工具/LLM
  review(outputs: any): Promise<{ score: number; passed: boolean; notes?: string[] }>;
  renderFinal(outputs: any): Promise<any>; // 产出用户可见结果（如 Markdown）
}

export async function runLoop(kernel: AgentKernel, emit: (e: Event) => void) {
  /*最小实现*/
}
```

**Episode（JSONL）**

```json
{"ts":"2025-09-16T12:00:00Z","type":"progress","step":"perceive","pct":0.2}
{"ts":"2025-09-16T12:00:01Z","type":"tool","name":"http.get","args":{"url":"…"},"latency_ms":312}
{"ts":"2025-09-16T12:00:02Z","type":"score","value":0.86,"passed":true}
{"ts":"2025-09-16T12:00:02Z","type":"final","outputs":{"markdown":"…"}}
```

---

### 4.1 RunLoop 执行语义（while 计划→行动→评审）

**目标**：与你补充的流程一致——用户提出需求 → Agent 进入 **while 循环**：`plan` 产生下一批动作 → `act` 执行这些动作；当 Agent 认为**已满足目标或需要向用户澄清**时，跳出循环，分别输出最终回答或发起提问；用户补充后进入下一轮，继续同一 `trace`。

**执行规则（最小版）**

```ts
while (!budget.exceeded && !timeout && !halted) {
  const plan = await kernel.plan();
  emit({ type: "plan.begin", data: { steps: plan?.steps?.length ?? 0 } });

  if (!plan || !plan.steps?.length) {
    // 无计划兜底：直接答复
    const reply = await kernel.renderFinal(await kernel.act({ op: "llm.reply", args: {} }));
    emit({ type: "final", data: { reply, reason: "no-plan" } });
    break;
  }

  // for each planned step → act
  for (const step of plan.steps) {
    emit({ type: "act.begin", data: { step } });
    const r = await kernel.act(step);
    emit({ type: "tool", data: { name: step.op, args: step.args, result: summarize(r) } });
    emit({ type: "act.end", data: { step, ok: !r?.error } });

    if (r?.ask) {
      // 需要用户澄清
      emit({ type: "ask", data: { question: r.ask, origin_step: step.id } });
      state = "await_user";
      break; // 跳出 while，等待用户输入
    }
  }

  if (state === "await_user") break;

  const review = await kernel.review(outputs);
  emit({ type: "score", data: { value: review.score, passed: review.passed } });
  if (review.passed || kernel.thinksDone?.()) {
    const finalOut = await kernel.renderFinal(outputs);
    emit({ type: "final", data: { outputs: finalOut } });
    break; // 认为完成，跳出 plan 循环
  }
}
```

**Plan 可更新（基于新资料）**

- **触发条件**：
  1. `tool` 结果产生新的关键证据/文件；
  2. 用户在 `ask` 后补充信息（新的 `chat.msg` 到达且携带当前 `trace_id`）；
  3. 记忆/资源变更（`mcp-memory.snapshot` 或资源版本切换）。

- **行为**：Agent 可在同一轮内发布 `plan.update {rev++, patch}`，对**尚未执行**的步骤进行插入/替换/删除；已开始的步骤保持完成或以 `act.end{ok:false, reason:'cancelled'}` 收束。
- **事件**：`plan.update` 必须包含 `rev`、`reason` 与**最小 diff**（如 `{add:[...], remove:[...], replace:[...]}`），同时落盘到 Episode；UI 按 diff 更新计划清单。

**前端渲染契约（每个动作都要可见）**

- `plan.begin`/`plan.end`：渲染**本轮计划清单**（可折叠）
- `plan.update`：显示**计划 diff**（新增/删除/替换）与 `rev` 号；对被取消的未执行步骤加删除线并标注“已取消”
- `act.begin`：在 LogFlow 侧渲染“执行卡”进入 **运行态**；`tool` 到达后显示入参/要点/耗时/成本；`act.end` 收口
- `ask`：在聊天区生成**Agent 问询气泡**并高亮输入框；用户回复后携带 `trace_id` 继续同一轮次
- `score`：在该轮结尾渲染评分徽标；
- `final`：把本轮其余卡片折叠，仅保留最终回答展开

> 规则：除 `final/ask` 外，所有事件都同时流入 Episode 和 UI；**每个 Agent 的每个动作**都必须产生对应事件，前端据此渲染。

---

## 5) 公共契约（仅两类）

- **启动运行**：`POST /api/run { srs_text|srs_path, inputs?, budget? } → { trace_id }`
- **事件流/日志**：`WS /agent/events?trace_id=`（可选）或 `GET /api/episodes/{trace_id}` 直接读 JSONL

> 其他接口（Workflows/Pages/Scores/Config）全部移出 MVP。

---

## 6) 日志 → 改进（旁路，不影响最小核）

- **Improver**（可后补）：读取 `episodes/*.jsonl`，统计失败码/超时/低分用例 → 生成 `patch_proposals/*.md`：
  - 规则增强（review 规则/边界值）
  - Plan 模板修订（常见步骤短路/兜底）
  - 工具提示词/重试策略

- **人审为先**：改进只以 PR 或配置补丁形式合入；禁止在线自我改代码。

---

## 7) 删减/延后清单（从文档中移除）

- Workflows 调度、Pages 部署、Scores 报表、Config 面板、Workspace 文件编辑、语音、审批弹窗、多 Provider 路由、预算护栏。
- 这些都可从 Episode 指标长出来：先有“可回放日志”，再做“可视化/编排/治理”。

---

## 8) DoD（T0 最小可用）

- `pnpm run dev` 启动单进程：提供 `/api/run` 和单页 UI。
- 示例用例：输入 CSV → 统计 → 生成 Markdown，**全流程事件可见**。
- 产出 `episodes/<trace_id>.jsonl`；`pnpm run replay <trace_id>` 复现同产物。
- 单元：`runLoop`、`EpisodeLogger`、`Replay` 三处必须有测试。

---

## 9) 逐步长大（从这里开始）

1. **加一个工具**：file.write / csv.aggregate / md.render
2. **加一个护栏**：调用超时与最多重试=2
3. **加一个改进器度量**：低分样本 Top-N 的失败原因表

> 以上三步都只基于日志，不改内核结构。

---

## 10) 事件总线 × 全量日志（多 Agent 就绪）

#### 10.0 JSON Schema 与有序/背压/清理（新增）

- **Envelope JSON Schema（含 ln/byte_offset）**：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Envelope",
  "type": "object",
  "required": ["id", "ts", "type", "version", "data"],
  "properties": {
    "id": { "type": "string" },
    "ts": { "type": "string", "format": "date-time" },
    "type": { "type": "string" },
    "version": { "type": "integer" },
    "trace_id": { "type": "string" },
    "span_id": { "type": "string" },
    "parent_span_id": { "type": "string" },
    "topic": { "type": "string" },
    "level": { "enum": ["debug", "info", "warn", "error"] },
    "from": { "$ref": "#/$defs/addr" },
    "to": {
      "oneOf": [
        { "$ref": "#/$defs/addr" },
        { "type": "array", "items": { "$ref": "#/$defs/addr" } }
      ]
    },
    "tags": { "type": "array", "items": { "type": "string" } },
    "data": {},
    "ln": { "type": "integer", "minimum": 1 },
    "byte_offset": { "type": "integer", "minimum": 0 }
  },
  "$defs": {
    "addr": {
      "type": "object",
      "properties": {
        "agent_id": { "type": "string" },
        "role": { "type": "string" },
        "instance": { "type": "string" }
      },
      "required": ["agent_id"]
    }
  }
}
```

- **有序性**：**单 Run 内全序**，以 `(ts, id)` 作为合并键；Logger 入盘时补写 `ln`（全局单调递增）与 `byte_offset`，订阅端按该键恢复顺序。
- **背压策略**：Bus 采用有界队列（`queue_max`），每主题可设 `qos: critical|normal|best_effort`：
  - `critical`：**阻塞**生产（带 `publish_timeout_ms`），超时写入 `bus.block.timeout`；
  - `normal`：阻塞≤`publish_timeout_ms`，超时 **丢弃最旧** 并写 `bus.drop.oldest`（累计计数）；
  - `best_effort`：直接 **丢弃最新** 并写 `bus.drop.latest`； 订阅端支持背压通知 `bus.backpressure`，用于动态降载。

- **DeadLetter 重放/清理**：订阅失败或处理异常的事件写入 `episodes/<trace_id>/<version>/deadletter.jsonl`；
  - `aos bus dlq ls|replay|purge --older-than=7d`；
  - 重放时保持原 `ts/id/ln`，新增 `replayed_at` 字段；
  - 清理策略默认保留 7 天或 128MB，先到先清。

- **落盘滚动与清理**：`events.jsonl` 按 **大小（默认 128MB）或天** 滚动为 `events-YYYYMMDD-0001.jsonl` 片段；
  - `manifest.json` 记录 `segments:[{file,start_ln,end_ln,bytes}]`；
  - `ln` 在滚动后 **连续递增**（不重置）；
  - 索引持久化 `ln` 与 `byte_offset`，用于 `tail from_ln` 的**快速区间查询与断点续传**。

### 10.1 事件信封（Envelope）

```ts
// runtime/events.ts（同文件内含 Bus + Mailbox，不增文件数）
export type AgentAddr = { agent_id: string; role?: string; instance?: string };
export type Level = "debug" | "info" | "warn" | "error";

export interface Envelope<T = any> {
  id: string; // ULID（去重/幂等）
  ts: string; // ISO8601
  type: string; // progress|plan.*|act.*|io|score|ask|final|task.*|dm|metric|error|system.*
  level?: Level;
  trace_id?: string; // 贯穿一次 Run（多 Agent 共用）
  span_id?: string; // 子步骤/工具调用
  parent_span_id?: string;
  topic?: string; // 主题（如 task.offer/capability.news）
  from?: AgentAddr; // 发送者
  to?: AgentAddr | AgentAddr[]; // 直达（DM）或留空=广播
  tags?: string[]; // 查询/统计标签
  data: T; // 业务负载
  version: number; // 信封版本（回放用）
}

export interface EventBus {
  publish<T>(e: Envelope<T>): void;
  subscribe(match: (e: Envelope) => boolean, on: (e: Envelope) => void): () => void;
}
```

### 10.2 总线落地与持久化

- **InProcBus（默认）**：进程内发布/订阅（O(1)）→ 订阅者包含：
  1. **EpisodeLogger**（把所有 Envelope 追加为 JSONL）
  2. **WsBroadcaster**（把可见事件推给前端折叠卡）
  3. **MetricsAgg**（把度量事件聚合为计数/直方图）
  4. **DeadLetter**（订阅 error 级别并落盘告警）

- **可替换适配**：保持 `EventBus` 接口不变，可切到 Redis/NATS（多进程/多机），但 **MVP 不引入外部依赖**。
- **语义**：At-least-once；靠 `Envelope.id` 做幂等去重；订阅顺序以 `ts,id` 合并保证**单 Run 内有序**。

### 10.3 JSONL 日志结构（版本化）

```
/episodes/<trace_id>/
  manifest.json         # 运行元数据：schema_version, kernel_version, agents[], base_version, parent, tags
  v001/events.jsonl     # 只追加，不可修改
  v001/summary.json     # 产物摘要、指标
  v002/...              # 每次“改经/回退”形成新版本（copy-on-write + 指针）
  latest -> v002        # 符号指针（或 manifest 中 latest_version）
```

- **回放**：`replay --trace <id> --version v001` 精确复现历史；默认 `latest`。
- **回退**：`episodes checkout <id> v001` 仅移动指针，不改历史；事件不可删除。

---

## 11) 多 Agent 交互（基于事件总线）

### 11.1 角色与寻址

- **Coordinator（可选）**：调度/拆解任务、做任务分派与汇总
- **Worker**：声明能力（capabilities）并被分派子任务
- **Improver**：离线遍历 Episode，生成补丁建议
- **寻址**：`AgentAddr {agent_id, role, instance}`，支持 **广播/主题/直达 DM** 三种模式

### 11.2 协议原语（最小集）

- `system.hello {agent_id,caps}`：Agent 启动自我宣布
- `task.offer {trace_id, span_id?, need_caps, payload}`：协作任务广播
- `task.claim {agent_id, reason}`：Worker 抢单（可带置信度）
- `task.assign {to:agent_id}`：调度者指派
- `task.report {status, outputs, metrics}`：Worker 报告进度/结果
- `dm {to, text|payload}`：Agent-2-Agent 私聊（用于澄清/纠错）

> 上述全是 Envelope 的 `type`/`topic` 组合，无需新增文件或接口。

### 11.3 示例时序（两 Agent 协同）

1. Coordinator 接到 `/api/run` → 发布 `task.offer(caps:['csv.aggregate'])`
2. Worker-A `task.claim`；Coordinator `task.assign`
3. Worker-A 执行工具 → 期间发 `progress/tool/io` 事件
4. 完成后 `task.report(outputs)`；Coordinator 汇总 → 发 `final`

> 全程 **EpisodeLogger** 把所有 Envelope 落盘，可回放/审计。

---

## 12) 迭代与自我改进（日志驱动）

### 12.1 改进器（Improver Agent）

- 订阅 `metric|error|score` 事件或离线扫 `episodes/*/latest/summary.json`
- 产出 `patch_proposals/*.md`：
  - 规则补丁：提高 `review` 的边界与覆盖
  - 计划补丁：常见 Plan 片段模板化，异常分支兜底
  - 工具策略：超时/重试/退避，或替换等价工具

- **用户同意门**：策略/MCP/提示词的版本切换需用户显式确认；第一阶段默认**关闭自动提案与合入**，仅手动应用。
- **人审并入**：只生成 PR 或配置差异，不直接改内核

### 12.2 版本化“经”与对比实验 版本化“经”与对比实验

- 每次合入补丁 → 新的 `kernel_version` 或 `plan_template_version`
- 运行同一基准用例：
  - `A/B`: v_old vs v_new → 以 Episode 指标对比（通过率/延迟/成本）
  - `promote`: 通过阈值则提升为默认，失败则 `checkout` 回旧版

### 12.3 指标最小集（埋点即事件）

- `metric.counter {name:'runs_total', by:{agent,model}}`
- `metric.hist {name:'latency_ms', value, by:{step}}`
- `metric.gauge {name:'cost_cny', value}`
- `score {value, passed, rubric_id}`

---

## 13) CLI 与 API 扩展（仍保持最小表面）

- **CLI**：
  - `aos run -f srs.md`
  - `aos replay <trace_id> [--version vNNN]`
  - `aos episodes ls|show <trace_id>`
  - `aos episodes checkout <trace_id> <vNNN>`

- **API（保持两类）**：仍只保留 `POST /api/run` 与 `GET /api/episodes/{trace_id}`；事件通过同一总线同步到前端。

---

## 14) DoD（补充，多 Agent/总线）

- 事件总线可支撑 **≥3 类订阅者**（Logger/WS/Metrics）且单 Run 内有序
- 至少 2 个 Agent 能通过 `task.offer/claim/assign/report` 完成一次协同
- 所有 Envelope 都进入 `events.jsonl`，并可 `replay` 得到同样的跨 Agent 结果
- `episodes latest` 可在 v001↔v002 间切换，回放结果一致（除了刻意变更处）

---

## 15) MCP-First 架构（核心功能即 MCP）

#### 15.0 信任边界与权限模型（新增）

- **最小权限（caps）**：每个 MCP 工具需显式声明 `caps`（如 `fs.read`/`fs.write`/`net.fetch`/`secrets.read`）。默认禁用未声明的能力；按 _最小授权_ 与 _按调用授予_ 两级校验，并在 Episode 中记录 `caps_used`。
- **跨进程/远端治理**：对远端/跨进程的 Server 统一配置**限流/超时/重试/熔断**：`rate=QPS`, `timeout_ms`, `retry<=2`, `backoff=exponential`, `circuit_breaker=half_open`；命中限流或熔断时生成 `mcp.throttle`/`mcp.open` 事件并降级。
- **记忆快照保留策略**：`mcp-memory` 采用**版本与容量双阈值**：默认最多 **N=20** 个版本 **或** 总容量 **M=256MB**（可配置，超限时按 _最旧优先_ 淘汰），保留 `latest` 与带标签版本；快照操作写入审计。
- \`\`\*\* URI 规范\*\*：`mem://<version>/<path>`，其中 `<version>` 为 `latest` 或 `vNNN`；方案名小写，`version` 大小写不敏感，`path` 区分大小写；所有非 ASCII 字符与特殊字符使用 **RFC 3986** 百分号转义；解析优先级：**精确版本 > latest > 默认**。
- **失败回退顺序**：调用失败时按顺序回退：**内置 **\`\`**（使用录制结果） → 降级跳过该步骤**（写入 `audit`/`degrade` 事件并在 Review 阶段计入扣分）。

> 共识：**所有能力尽量通过 MCP 暴露**；Agent 只是编排与决策，内核仅依赖“事件总线 + MCP 客户端”。**记忆**也作为一个随启动默认加载的 MCP Server。

### 15.1 定位与关系

- **AgentKernel = MCP 客户端/协调器**：
  - 通过 `mcp.invoke(server, tool, args)` 调用一切能力；
  - 通过 `mcp.resources(server)` 读取上下文（记忆/资料/配置）。

- **MCP Server = 能力提供者**：工具（tools）+ 资源（resources）对外暴露，既可本地进程，也可远端。
- **EventBus = 横切观测**：所有 MCP 请求/响应都转成 Envelope 事件写入 Episode，回放时由 `mcp-replayer` 提供确定性结果。

### 15.2 组件最小集

```
/adapters/mcp.ts        # MCP 客户端（连接、发现、调用、资源读取、回放适配）
/runtime/mcp-replay.ts  # 回放钩子：根据 events.jsonl 命中“录制结果”
/servers/mcp-memory.ts  # 记忆 Server：tools + resources（可内嵌到进程，不增加依赖）
/servers/mcp-core.ts    # 核心工具：file.read/write、http.get、csv.aggregate、md.render
# （其余保持前文 ≤10 文件目标；如需严控文件数，可把两个 servers 合并为一个文件）
```

### 15.3 启动流程（Boot）

1. 读取 `mcp.registry.json`：声明需要接入的 MCP 端点（transport: stdio|ws|http）。
2. 启动内置 Server：`mcp-memory`、`mcp-core`（均为本地 stdio/内建适配）。
3. 与外部 Server 建立连接并 `list_tools / list_resources` 做能力登记（写入 `caps`）。
4. **Agent perceive 阶段**：从 `mcp-memory` 读取默认上下文（如最近 Episodes 的摘要、长期事实库）。
5. RunLoop 期间所有 MCP 调用 → EventBus → EpisodeLogger（带 `server/tool/args/latency/tokens`）。

### 15.4 记忆即 MCP（mcp-memory）

- **Tools**：
  - `memory.put {key, value, tags?, scope: 'run'|'global'}`
  - `memory.get {key}`
  - `memory.search {query, top_k?, filter_tags?}`（BM25/向量任选其一，先 BM25）
  - `memory.snapshot {}` → 返回当前快照 `mem_vNNN.json`
  - `memory.checkout {version}` → 移动快照指针（仅影响后续读取）

- **Resources**：
  - `mem://latest/`（列表）
  - `mem://latest/facts.json`、`mem://latest/run-hints.json` 等

- **版本/回退**：快照采用 `v001/v002` 目录结构；与 Episodes 的 `latest` 指针风格一致。

### 15.5 MCP × 事件总线 映射

- 每次 `mcp.invoke` → 产生两条 Envelope：
  - `type:'mcp.call'  data:{server, tool, args_hash}`
  - `type:'mcp.result' data:{server, tool, ok, bytes?, latency_ms, cost?, tokens?}`

- 回放模式：`adapters/mcp.ts` 根据 `trace_id+args_hash` 命中 `mcp.result` 的录制负载，直接返回，**不触网**。

### 15.6 多 Agent 与 MCP 的协作

- **Agent 也可作为 MCP Server**：对外暴露 `task.claim/assign/report` 等工具；
- **Coordinator（客户端）**：广播 `task.offer`（普通 Envelope）；Worker 以 MCP 工具形式被调用或自举连接后 `claim`；
- **私聊（DM）**：提供 `agent.dm.send {to, payload}` 工具，底层仍是 EventBus 事件。

### 15.7 兼容与降级

- 若某能力没有可用的 MCP Server：
  - 首选使用 `mcp-core` 内置工具（本地实现）；
  - 或由 `mcp-replay` 在回放模式返回录制结果；
  - 无结果时，Agent 决策降级（例如跳过昂贵步骤）。

### 15.8 配置示例（mcp.registry.json）

```json
{
  "servers": [
    { "id": "mcp-memory", "transport": "stdio", "cmd": "node", "args": ["servers/memory.js"] },
    { "id": "mcp-core", "transport": "inproc" },
    { "id": "mcp-external-search", "transport": "ws", "url": "wss://example.com/mcp" }
  ]
}
```

### 15.9 TypeScript 契约（客户端片段）

```ts
export interface MCPClient {
  tools(server?: string): Promise<{ name: string; schema: any }[]>;
  resources(server?: string): Promise<{ uri: string; mime: string }[]>;
  invoke<T = any>(
    server: string,
    tool: string,
    args: any,
    opts?: { trace_id?: string },
  ): Promise<T>;
}
```

### 15.10 DoD（MCP 就绪）

- Agent 的 **Plan/Act/Review** 所需能力均可通过 MCP 调用完成（或使用内置 `mcp-core` 降级）。
- `mcp-memory` 随进程启动并在 **perceive** 阶段可读到默认上下文；支持 `snapshot/checkout` 回退。
- Episode 中存在成对的 `mcp.call/mcp.result` 事件，回放模式下产生**一致产物**。
- 断开外部 MCP（离线）后，示例用例仍能跑通（依赖本地 `mcp-core` + 回放）。

---

## 16) 日志索引与分支模型（主链=Chat，分支=Task/Task-Chain）

> 注：已将 §17“Chat + LogFlow（第一阶段）”前置至本节之后（阅读顺序：模型 → 索引 → 页面）；本节 SQL 已精简为“典型查询 + 字段说明表”，新增增量读取契约 `GET /api/logflow/tail?trace_id=&from_ln=`，索引新增持久化 `byte_offset` 并明确 `ln` 在切分文件后的连续策略。 目标：在**不改变 JSONL 追加写**的前提下，建立轻量索引以支撑主链/分支的快速查询与 UI 显示；索引可重建、可版本化、与事件解耦。

### 16.1 事件图（DAG）最小约定

- **ID 体系**：
  - `trace_id`：一次顶层会话/运行（Chat 的主链挂在同一 trace 下）
  - `msg_id`：聊天消息（主链节点），ULID
  - `span_id`：任务或子步骤（分支根/子节点），ULID
  - `parent_span_id`：分支的父节点
  - `origin_msg_id`：某个分支由哪条聊天消息触发（把分支锚到主链）

- **事件类型扩展**（Envelope.type）：
  - `chat.msg`：{ msg_id, role, text, reply_to? }
  - `task.start`：{ span_id, origin_msg_id, title, caps }
  - `task.progress`：{ span_id, pct, note }
  - `task.end`：{ span_id, status:'ok'|'fail', outputs }
  - 其余沿用 `progress|tool|io|score|final|metric|error|mcp.*` 等

### 16.2 物理落盘（不变）

- 仍是：`/episodes/<trace_id>/vNNN/events.jsonl` 追加写；每行一个 Envelope。

### 16.3 侧边索引（Sidecar，可重建）

- **索引介质**：单个 `episodes/index.lite.db`（SQLite） + 每个 trace 的 `.idx.json`（可选，存行号/偏移）。
- **建表（DDL）**：

```sql
CREATE TABLE IF NOT EXISTS events (
  trace_id TEXT, version TEXT, ln INTEGER, ts TEXT, type TEXT,
  span_id TEXT, parent_span_id TEXT, msg_id TEXT, origin_msg_id TEXT,
  role TEXT, level TEXT, topic TEXT, tags_json TEXT,
  PRIMARY KEY (trace_id, version, ln)
);
CREATE INDEX IF NOT EXISTS idx_events_trace_ts ON events(trace_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_span ON events(trace_id, span_id);
CREATE INDEX IF NOT EXISTS idx_events_msg ON events(trace_id, msg_id);
CREATE TABLE IF NOT EXISTS spans (
  trace_id TEXT, span_id TEXT, parent_span_id TEXT, title TEXT, kind TEXT,
  origin_msg_id TEXT, started_ts TEXT, ended_ts TEXT, status TEXT,
  PRIMARY KEY (trace_id, span_id)
);
CREATE TABLE IF NOT EXISTS messages (
  trace_id TEXT, msg_id TEXT, role TEXT, ts TEXT, reply_to TEXT,
  text_sha TEXT, PRIMARY KEY (trace_id, msg_id)
);
```

- **填充与维护**：
  - EpisodeLogger 追加一行后，异步把该行的基本键入库（或批量刷新，崩溃可重建）。
  - **重建命令**：`aos index rebuild <trace_id> [--version vNNN]` 全量扫描 JSONL → 填表。

### 16.4 常用查询（供 UI / API 使用）

- **主链（Chat 时间线）**：

  ```sql
  SELECT * FROM messages WHERE trace_id=? ORDER BY ts;
  ```

- **某条消息触发的分支（任务树）**：

  ```sql
  SELECT * FROM spans WHERE trace_id=? AND origin_msg_id=? ORDER BY started_ts;
  ```

- **某个任务的事件流（折叠卡明细）**：

  ```sql
  SELECT * FROM events WHERE trace_id=? AND span_id=? ORDER BY ln;
  ```

- **整条分支的 DAG**（含孙级）：

  ```sql
  WITH RECURSIVE t AS (
    SELECT span_id,parent_span_id,title,started_ts FROM spans
     WHERE trace_id=? AND span_id=?
    UNION ALL
    SELECT s.span_id,s.parent_span_id,s.title,s.started_ts
      FROM spans s JOIN t ON s.parent_span_id=t.span_id
      WHERE s.trace_id=?
  ) SELECT * FROM t ORDER BY started_ts;
  ```

### 16.5 分支与版本

- 分支（task chain）只用 `span_id/parent_span_id` 表达；**版本切换**发生在目录级 `vNNN/`，索引表 `events.version` 字段随之记录。
- 回放/回退时：
  - `replay --trace X --version v001` 仅读取对应 `events.jsonl`；
  - `episodes checkout X v001` 仅移动 `latest` 指针；
  - `index switch <trace_id> v001` 把该版本的行指针写入/更新索引（或动态带上 version 过滤）。

---

## 17) 第一阶段范围收敛：Chat + LogFlow（仅两屏，一页内）

### 17.1 页面与布局（其他全部延后）

- **唯一页面：/（Chat + LogFlow）**
  - 左侧：**Chat 主链**（`chat.msg` 时间线）
  - 右侧抽屉：**LogFlow 分支视图**（选中一条消息时显示其任务树与每个任务的折叠卡）
  - 顶部：最小状态条（trace_id、latency、cost）

### 17.2 交互与事件映射（与 while 循环一致）

- 用户发送消息 → 产生日志 `chat.msg`，生成新的或沿用当前 `trace_id`
- Agent 进入 **while 计划→行动→评审**：
  - `plan.begin/end`：展示本轮**计划清单**（每个 step 可点开查看说明）
  - 执行中若收集到新资料：发 `plan.update{rev++,patch}`，在左侧计划清单显示**diff**，并在右侧对被取消的卡标注“已取消”；
  - 对每个 step：`act.begin → tool → act.end`，在 LogFlow 显示**执行卡**（状态/耗时/成本/产物）；
  - 需要澄清时：发 `ask`，聊天区出现**问询气泡**；用户回复后携带 `trace_id` 继续下一轮；
  - 通过评审或 Agent 判断完成：发 `final`，收束本轮，其余卡折叠，仅保留最终回答展开

### 17.3 LogFlow 视图（右侧） LogFlow 视图（右侧） LogFlow 视图（右侧） LogFlow 视图（右侧）

- 顶部：该消息触发的所有 **分支列表**（task cards，显示状态/耗时/得分）
- 展开某卡：展示该 `span_id` 的事件流（按 ln 排序）、关键产物链接、复制日志、回放该分支
- 继续展开：显示子 `span`（递归树）

### 17.4 API 与索引契约（仅 3 个）

- `POST /api/chat.send { text } → { msg_id, trace_id }`（内部也会发 `chat.msg` Envelope）
- `GET  /api/logflow/mainline?trace_id=` → 返回主链消息（使用 messages 表）
- `GET  /api/logflow/branch?trace_id=&origin_msg_id=` → 返回任务树与每个 span 的汇总（spans 表 + events 聚合）

> 事件仍通过 WS 推送；HTTP 仅用于**首次加载**与**历史补全**。

### 17.5 DoD（Chat/LogFlow）

- 输入一条消息并触发至少一个任务分支；
- 左侧主链实时显示消息，右侧展示该消息下的任务树；
- 每个任务卡可展开查看事件明细与产物；
- 刷新页面后通过索引快速恢复视图（<200ms 返回主链，<300ms 返回该消息的分支列表）。

---

## 18) 工程落地补充（仍保持 ≤10 文件）

- 不新增新文件：把 **索引维护** 合并进 `runtime/episode.ts`（Logger 在 Flush 批次里顺手写 SQLite）；
- `server/http.ts` 补 2 个只读接口：`/api/logflow/mainline`、`/api/logflow/branch`；
- `ui/index.html` 增加右侧 LogFlow 抽屉与三类请求（首屏拉取/WS 增量/点击展开）。

> 若后续文件数压力大：把 `adapters/llm.ts` 和 `adapters/tools.ts` 合并为 `adapters/core.ts`，继续维持 ≤10。
