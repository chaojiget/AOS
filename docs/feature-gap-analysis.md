# 功能现状与规划总览（2025-09-26）

> 根据《AOS v0.1｜MCP 优先总体方案》与现有代码实现整理，梳理各模块的已完成功能与待落地事项，便于后续排期讨论。

## 1. Chat Hub（`/`）
- **现状**：
  - 支持与后端聊天流式接口交互，并将响应写入本地存储，保留会话多标签。`app/page.tsx` 第 320-438 行。 
  - 接入 `/api/logs` + SSE 流，读取遥测日志并转换为价值事件卡片占位。`app/page.tsx` 第 332-394 行。 
- **待落地**：
  - 打通价值事件总线，按蓝图引入 `task.acceptance/task.receipt/anomaly.*` 等 Outbox 事件并去抖显示。`docs/aos-v0.1-blueprint.md` 第 64-82 行。 
  - 事件卡片需要挂载审批/回放入口，跳转项目回放与审批流程。`docs/aos-v0.1-blueprint.md` 第 69-82 行。 
  - 会话上下文需要绑定 Trace/Agent 运行，联动 Projects/Telemetry 页面。`docs/aos-v0.1-blueprint.md` 第 173-202 行。 

## 2. Telemetry（`/telemetry`）
- **现状**：
  - 页面已提供追踪、日志、指标的拉取与可视化骨架，依赖后端 `/api/telemetry/*`。`app/telemetry/page.tsx` 第 312-470 行。 
  - 后端 Telemetry 路由打通 NATS JetStream 读取。`backend/src/routes/telemetry.ts` 第 15-198 行。 
- **待落地**：
  - 引入 Trace 瀑布图/拓扑视图与多维筛选。`docs/aos-v0.1-blueprint.md` 第 33-55 行。 
  - 支持与 Chat Hub 价值事件关联跳转，定位指定 trace。`docs/aos-v0.1-blueprint.md` 第 69-82 行。 

## 3. Integrations（`/integrations`）
- **现状**：
  - 已可 CRUD MCP 服务注册、配置角色白名单与限流参数。`app/integrations/page.tsx` 第 1-200 行。
  - 后端 MCP registry API/网关基本可用，含 RBAC 与审计打点。`backend/src/routes/mcp.ts` 第 1-260 行。
- **待落地**：
  - 接入服务健康检查、配额统计、熔断策略管理。`docs/aos-v0.1-blueprint.md` 第 117-145 行。
  - 需要 UI 告警提示失败状态，并与 Telemetry 事件联动。`docs/aos-v0.1-blueprint.md` 第 117-145 行。
  - 串联多 MCP 服务的编排入口：提供基于 SOP/Workflow 的节点配置、前置条件与变量映射，使注册的能力可以组合为端到端流程。`docs/aos-v0.1-blueprint.md` 第 83-171 行。

## 4. Sandbox & Agents（`/sandbox`, `/agents`）
- **现状**：
  - Sandbox 页面支持虚拟环境的增删改查、变量管理并与 Token 存储打通。`app/sandbox/page.tsx` 第 1-200 行。
  - Agents 页面能管理脚本、绑定环境、查看运行记录并手动触发执行。`app/agents/page.tsx` 第 1-200 行。
  - 后端 Sandbox/MCP API 支持环境注册、脚本写入、运行日志查询。`backend/src/routes/mcp.ts` 第 82-420 行。
- **待落地**：
  - 新增 Agent 模板与版本管理、伸缩/调度策略。`docs/aos-v0.1-blueprint.md` 第 146-171 行。
  - 打通脚本执行产物上传、运行态日志回放与 MCP 网关自动注册。`docs/aos-v0.1-blueprint.md` 第 146-171 行。
  - 引入运行健康度与告警（结合 Telemetry + 审计）。`docs/aos-v0.1-blueprint.md` 第 146-171 行。
  - 支持以 Workflow 方式将多个 MCP Agent 串联：在前端配置节点依赖、输入输出映射和错误回退策略，并将流程运行状态回写 Projects 与 Telemetry。`docs/aos-v0.1-blueprint.md` 第 83-171 行。

## 10. MCP Workflow 编排
- **现状**：
  - Blueprint 中规划了基于 LangGraph/SOP 的流程编排框架，尚未在现有代码中实现。`docs/aos-v0.1-blueprint.md` 第 83-171 行。
- **待落地**：
  - 设计统一的 Workflow 定义模型（节点、边、上下文变量、权限），并与 Projects/Sandbox/Integrations 共用。
  - 提供 Workflow Builder 前端：可拖拽节点、配置 MCP 服务调用、设置条件分支与并行步骤。
  - 打通执行引擎：支持计划/手动触发，串联 MCP Agent 调用并将中间结果写入 Telemetry 与审计。
  - 结合激活流程，提供 Workflow 模板示例，帮助团队快速落地标准作业流。

## 5. Projects（`/projects`）
- **现状**：
  - 页面为静态占位，展示 mock 任务与 SOP 列表，回放功能未实现。`app/projects/page.tsx` 第 1-160 行。 
- **待落地**：
  - 接入任务队列/回放 API，支撑任务列表、重跑、工件查看。`docs/aos-v0.1-blueprint.md` 第 83-116 行。 
  - 按蓝图实现 SOP 蓝图版本化、可视编辑与审批链路。`docs/aos-v0.1-blueprint.md` 第 83-116 行。 
  - 与 Chat Hub 的价值事件卡片打通，支持 trace → 回放跳转。`docs/aos-v0.1-blueprint.md` 第 69-82 行。 

## 6. Memory（`/memory`）
- **现状**：
  - 提供用户画像、变量库、记忆编辑与审计的静态骨架。`app/memory/page.tsx` 第 1-200 行。 
- **待落地**：
  - 后端需落地 `mem_embeddings` 与 `project_vars` 存储、检索 API。`docs/aos-v0.1-blueprint.md` 第 203-246 行。 
  - 前端引入检索、筛选、差异对比与审计追溯能力。`docs/aos-v0.1-blueprint.md` 第 203-246 行。 

## 7. Settings（`/settings`）
- **现状**：
  - 页面提供 LLM、OpenTelemetry、RBAC 等表单占位但未与后端交互。`app/settings/page.tsx` 第 1-200 行。 
- **待落地**：
  - 构建 `/config/system`、`/config/runtime` API 并写入 `audit_logs`。`docs/aos-v0.1-blueprint.md` 第 247-288 行。 
  - 实现敏感信息脱敏展示与二次确认流程。`docs/aos-v0.1-blueprint.md` 第 247-288 行。 

## 8. 事件总线与持久化
- **现状**：
  - Telemetry 通过 NATS JetStream 存储并可拉取。`backend/src/telemetry/nats-exporter.ts` 第 1-220 行。 
  - LangGraph 检查点落地 PostgreSQL，但 Outbox 价值事件尚未实现。`docs/aos-v0.1-blueprint.md` 第 64-82 行、`backend/src/db/index.ts` 第 1-160 行。 
- **待落地**：
  - 完成 Postgres Outbox + `LISTEN/NOTIFY` 推送价值事件，并提供回放索引。`docs/aos-v0.1-blueprint.md` 第 64-116 行。 
  - 引入 `jobs`、`agent_runs`、`audit_logs` 等表结构与 API。`docs/aos-v0.1-blueprint.md` 第 173-246 行。 
  - 规划向 NATS/Redis Streams 的升级路径与 ClickHouse OLAP。`docs/aos-v0.1-blueprint.md` 第 289-320 行。 

## 9. 安全与激活
- **现状**：
  - API Token 已支持前端广播与本地存储，部分页面可通过 Token 拉取受保护资源。`lib/authToken.ts` 第 1-120 行。 
  - `requireAuth` 中间件校验 `AOS_API_TOKENS` 并写入审计。`backend/src/auth/middleware.ts` 第 1-120 行。 
- **待落地**：
  - 落实 RBAC 资源粒度、审批流与审计查询界面。`docs/aos-v0.1-blueprint.md` 第 247-288 行。 
  - 打通“激活”流程：首次登录配置 Token、校验能力、引导完成 Integrations/Agents 初始化。`docs/aos-v0.1-blueprint.md` 第 117-171 行。 

---

以上待办可作为后续迭代的讨论基础，可优先处理 Chat Hub 价值事件闭环与 Projects 回放，以支撑端到端验收。
