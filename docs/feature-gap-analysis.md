# 功能现状与规划总览（2025-09-26）

> 根据《AOS v0.1｜MCP 优先总体方案》与现有代码实现整理，梳理各模块的已完成功能与待落地事项，便于后续排期讨论。

## 1. Chat Hub（`/`）
- **现状**：
  - 支持与后端聊天流式接口交互，并将响应写入本地存储，保留会话多标签。`app/page.tsx` 第 320-438 行。
  - 接入 `/api/logs` + SSE 流，读取遥测日志并转换为价值事件卡片占位。`app/page.tsx` 第 332-394 行。
  - 价值事件卡片挂载跳转入口，可打开 Projects 回放页查看运行详情。`app/page.tsx` 第 260-340 行。
- **待落地**：
  - 打通价值事件总线，按蓝图引入 `task.acceptance/task.receipt/anomaly.*` 等 Outbox 事件并去抖显示。`docs/aos-v0.1-blueprint.md` 第 64-82 行。
  - 会话上下文需要绑定 Trace/Agent 运行，联动 Projects/Telemetry 页面。`docs/aos-v0.1-blueprint.md` 第 173-202 行。

## 2. Telemetry（`/telemetry`）
- **现状**：
  - 页面已提供追踪、日志、指标的拉取与可视化骨架，依赖后端 `/api/telemetry/*`。`app/telemetry/page.tsx` 第 312-470 行。
  - 后端 Telemetry 路由打通 NATS JetStream 读取。`backend/src/routes/telemetry.ts` 第 15-198 行。
  - Trace 瀑布视图落地，展示 Span 层级、时间轴与属性摘要，并允许通过查询参数定位指定 Trace。`app/telemetry/page.tsx` 第 150-260 行，第 500-560 行。
  - Chat Hub 价值事件自动补充 Trace 快捷入口，可一键跳转遥测页查看详情。`app/page.tsx` 第 260-360 行。
- **待落地**：
  - 拓扑视角、服务依赖图与多维筛选（按 Agent/环境/状态）。`docs/aos-v0.1-blueprint.md` 第 33-55 行。

## 3. Integrations（`/integrations`）
- **现状**：
  - 已可 CRUD MCP 服务注册、配置角色白名单与限流参数。`app/integrations/page.tsx` 第 1-200 行。
  - 后端 MCP registry API/网关基本可用，含 RBAC 与审计打点。`backend/src/routes/mcp.ts` 第 1-260 行。
  - 集成健康检查、熔断与配额监控，页面展示调用成功率/延迟并可一键巡检、在线调整策略。`backend/src/mcp/monitor.ts`、`app/integrations/page.tsx`。
- **待落地**：
  - 需要 UI 告警提示失败状态，并与 Telemetry 事件联动。`docs/aos-v0.1-blueprint.md` 第 117-145 行。

## 4. Sandbox & Agents（`/sandbox`, `/agents`）
- **现状**：
  - Sandbox 页面支持虚拟环境的增删改查、变量管理并与 Token 存储打通。`app/sandbox/page.tsx` 第 1-200 行。
  - Agents 页面能管理脚本、绑定环境、查看运行记录并手动触发执行。`app/agents/page.tsx` 第 1-200 行。
  - 后端 Sandbox/MCP API 支持环境注册、脚本写入、运行日志查询。`backend/src/routes/mcp.ts` 第 82-420 行。
- **定位与职责对齐**：
  - 沙箱仍是 Agent 的运行环境，支持在界面内创建、编辑、删除不同的隔离运行态，并提供默认空白环境便于试验。
  - 沙箱封装的 MCP Server 对外暴露工具能力，供企业内外部系统调用；AOS 内的 Agent 可在自身配置页动态绑定/解绑 MCP 端点与沙箱环境，并回写运行事件。
  - Integrations 入口下新增“沙箱管理”二级页面，负责沙箱的 CRUD、变量引用、默认模板等配置；同处一级的 MCP 管理页负责注册/授权 MCP 服务，并可为沙箱绑定的 Agent 调整权限范围。
  - Agent 与沙箱的绑定关系决定了其可访问的 MCP 端点与变量范围，运行结果写入 `events/agent_runs` 并同步至 Telemetry/审计。
- **公共变量注入方案（建议）**：
  - 由 AOS 统一提供 "Runtime Env Directory" MCP 服务，用于查询平台登记的 Secrets、连接信息、调度参数的环境变量名称与作用域描述；Integrations/Settings 侧负责录入与审批。
  - 创建沙箱或运行任务时，仅写入变量引用（`ref://env/<namespace>/<key>`），执行容器在启动阶段通过 MCP 拉取具体值并注入进程环境，未显式引用的变量不会下发，支持按需注入。
  - 权限控制采用三段式策略：① 变量以命名空间划分租户/项目；② Agent 绑定沙箱时声明所需引用，由管理员审批；③ MCP 层校验调用者 Token 与租户、角色，审计所有读取行为，支持后续细粒度撤权。
- **待落地**：
  - 新增 Agent 模板与版本管理、伸缩/调度策略。`docs/aos-v0.1-blueprint.md` 第 146-171 行。
  - 打通脚本执行产物上传、运行态日志回放与 MCP 网关自动注册。`docs/aos-v0.1-blueprint.md` 第 146-171 行。
  - 引入运行健康度与告警（结合 Telemetry + 审计）。`docs/aos-v0.1-blueprint.md` 第 146-171 行。

## 5. Projects（`/projects`）
- **现状**：
  - 接入 `/api/projects` 后端，支持项目列表、运行中/排队任务、近期完成记录及 SOP 版本展示。`app/projects/page.tsx` 第 1-420 行。
  - 提供运行详情抽屉（时间线、产物、Trace ID）、重跑按钮，并写入价值事件 Outbox。`app/projects/page.tsx` 第 180-420 行，`backend/src/routes/projects.ts`。
  - 后端新增 Projects 服务层与路由，模拟任务回放数据并与 Outbox 对接。`backend/src/services/projects.ts`、`backend/src/routes/projects.ts`。
- **待落地**：
  - 接入真实任务队列/回放 API，替换内存模拟数据并串联实际工件存储。`docs/aos-v0.1-blueprint.md` 第 83-116 行。
  - 按蓝图实现 SOP 蓝图版本化、可视编辑与审批链路。`docs/aos-v0.1-blueprint.md` 第 83-116 行。

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
  - LangGraph 检查点落地 PostgreSQL，新增 `value_events` Outbox 表与触发器，支撑价值事件持久化。`backend/src/events/value-events.ts`。
  - Projects 重跑操作写入 `task.submitted/task.replay.requested` 价值事件并附带回放链接。`backend/src/routes/projects.ts`。
- **待落地**：
  - 将 Chat Hub 价值事件卡片与 Projects/Telemetry 的审批、回放入口串联，支撑端到端验收。`docs/aos-v0.1-blueprint.md` 第 69-116 行。
  - 将 Orchestrator/任务流水接入价值事件 Outbox，补齐 `task.*`、`anomaly.*` 的生成与索引回放能力。`docs/aos-v0.1-blueprint.md` 第 64-116 行。
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
