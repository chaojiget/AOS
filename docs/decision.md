# Discovery Decision — Agent OS 阶段一二方案评审

## 背景与目标

- **来源**：依据《Agent OS 自迭代系统：完整项目方案（精炼版 v1）》与《AgentOS 最小核 · Agent Kernel v0》。
- **目标**：在 6 周内交付可运行的单体 Agent OS，覆盖实时日志、SSE/WS、MCP 工具接入与技能固化流水线。
- **范围**：本地部署（Node.js 22 + TypeScript），SQLite 持久化，前端以 Next.js 提供聊天/日志/技能最小体验。

## 关键约束

- 日志契约先行，所有事件需落入 `events` 表并支持离线回放。
- 单次任务步数 ≤ 12，预算受 Guardian 控制；失败需保留完整 Episode。
- 工具调用通过 MCP 规范化，默认白名单 + 参数 schema 校验。
- 技能上线必须经过草稿→审核→灰度→评估流程，复用率与胜率需可观测。

## 方案候选

### 方案 A：NestJS + 自研 RunLoop + Next.js 前端（推荐）

- **结构**：NestJS 作为 API 层与 SSE 推送；核心循环位于 `core/agent.ts`；Drizzle + SQLite 持久化；Next.js 渲染聊天与日志；技能流水线由脚本驱动。
- **优点**：
  - 与现有代码骨架一致，可复用当前 `runsService`、`events` 持久化与 SSE 实现。
  - TypeScript 端到端统一，降低契约漂移风险。
  - 自研 RunLoop 可精准映射 Observe/Think/Act/Reflect 语义，并支持技能匹配分支。
- **风险**：RunLoop 与技能流水线需投入额外单测与回放脚本，首期复杂度较高。

### 方案 B：基于 LangGraph/LangChain Server 的托管循环

- **结构**：利用 LangGraph 的 StateGraph 构建循环，NestJS 仅作转发层；技能固化依赖外部存储与 Callback。
- **优点**：
  - 快速使用成熟调度器，降低自研引擎成本。
  - 内建工具回调机制，可简化事件派发。
- **风险/缺点**：
  - 与本地 Episode 契约耦合度低，回放难以保证；需要额外桥接层。
  - 对第三方框架版本更新敏感，违反“先自研最小图式循环”的决策建议。

### 方案 C：消息队列 + 多进程 Worker

- **结构**：API 层入队，Worker 异步执行 RunLoop，Redis/BullMQ 提供调度。
- **优点**：
  - 易于扩展并行度，为未来多租户做铺垫。
- **风险/缺点**：
  - 超出当前阶段“单进程内”边界；引入 Redis 增加部署成本。
  - 调试与回放复杂度提升，不符合第一阶段的轻量化目标。

## 决策

- **选型**：采纳 **方案 A** —— NestJS + 自研 RunLoop + Next.js。
- **理由**：满足第一、二阶段“日志契约优先、离线回放、技能固化闭环”要求；复用已有实现与类型定义；避免对外部框架的重度依赖。
- **否决**：方案 B/C 保留作为后续扩展选项，但需在核心闭环稳定后再评估。

## 架构落地要点

1. **RunLoop**：沿用 `core/agent.ts`，确保 `plan/tool/ask/score/final` 事件完整发射；加入技能匹配短路与非重试性错误终止路径。
2. **事件与存储**：使用 Drizzle schema (`runs`, `events`, `skills`, `memories`, `mcp_configs`, `evals`)；事件统一写入 SQLite，并通过 SSE 推送实时更新。
3. **技能流水线**：`packages/skills/pipeline.ts` 聚合日志 → LLM 总结模板 → 人工审核状态机 → 灰度评估脚本（`scripts/skills-eval.ts`）。
4. **前端体验**：Next.js 聊天页订阅 `/api/runs/:runId/stream`，右侧 Inspector 展示 Plan/Act/Reflect；日志页默认实时流，历史按需分页。
5. **守护与指标**：Guardian 监控步数/预算/工具失败；指标面板展示成功率、平均步数、工具命中率、延迟与成本。

## 风险与缓解

- **R1：日志/回放不一致** → 构建 Golden Logs 基线与 `pnpm replay` 校验；关键接口纳入单元与集成测试。
- **R2：技能质量不达标** → 引入滑窗 win_rate，低于阈值自动下线；灰度阶段限定流量。
- **R3：工具调用不稳定** → 实现超时/重试与降级策略，必要时回退到“无计划兜底”。
- **R4：SSE/WS 在生产环境受限** → 预留 WS 兼容层，并对长轮询提供降级方案。

## 里程碑与交付

1. **阶段一（核心闭环）**：完成事件契约、RunLoop、SSE 推送、前端最小聊天/日志；MCP 工具接入并产出 Episode。
2. **阶段二（技能固化）**：上线日志分析脚本、技能模板存储、审核面板、技能调用埋点与评估指标。
3. **验收**：`pnpm typecheck && pnpm lint && pnpm test && pnpm smoke` 全绿；提供示例 Episode 与技能启用回放报告。

## 后续行动

- 建立 `reports/intake-summary.json` 与 `docs/SRS.yaml` 联动脚本，确保需求变更可追溯。
- 与用户确认 MCP 工具名单（Playwright MCP / HTTP MCP），同步接入密钥与沙箱环境。
- 制定技能审核 SOP，明确人工审批责任人与节奏。
