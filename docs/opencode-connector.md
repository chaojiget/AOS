# OpenCode AOS Connector 架构文档

## 1. 模块概述
`.opencode/plugin/aos_connector.js` 是 OpenCode CLI 环境下的一个遥测插件。它作为 **数据采集端 (Producer)**，负责将开发过程中的非结构化交互事件（命令执行、文件编辑、LLM 对话、工具调用等）转化为结构化的可观测数据 (Trace/Log)，并实时上报给 AOS Backend。

该模块不依赖外部庞大的 SDK，而是通过原生 JavaScript 实现了轻量级的 OpenTelemetry 风格链路追踪逻辑。

## 2. 核心机制

### 2.1 链路追踪 (Trace context)
插件维护了一套内存中的会话状态机 (`sessionStates`)，用于构建完整的调用链路树：

*   **Trace ID**:
    *   **生成**: 优先使用 Web Crypto API (`randomUUID`/`getRandomValues`) 生成，降级方案为 `Math.random` 组合。
    *   **提取**: 从各类异构事件中智能提取 `sessionID` (如 `session.created`, `message.updated`) 作为主 `trace_id`。如果事件中未包含，则使用本地生成的 `localTraceId`。
*   **Span ID**: 
    *   **Session Span**: 会话启动时生成，作为根 Span。
    *   **Message Span**: 此时将 User/Assistant 的消息作为独立的 Span。
    *   **Tool Span**: 工具调用 (`tool.execute`) 被视为 Message Span 的子节点。
*   **父子关联**: 
    通过 `getOrCreateSpan` 动态管理 Span ID，自动将 Tool Execution 挂载到触发它的 Assistant Message 下，形成 `Session -> Message -> Tool` 的层级结构。

### 2.2 事件捕获与过滤 (Capture & Filter)
插件通过 `shouldCapture` 函数定义了关注的事件白名单，过滤掉无用噪音。主要捕获：

| 类别 | 事件类型示例 | 说明 |
| :--- | :--- | :--- |
| **会话生命周期** | `session.created`, `session.idle`, `session.error` | 会话状态变更 |
| **消息交互** | `message.updated`, `message.part.updated` | LLM 对话流 |
| **工具执行** | `tool.execute.before`, `tool.execute.after` | 工具调用始末 |
| **文件操作** | `file.edited`, `file.watcher.updated` | 代码变更感知 |
| **指令/环境** | `command.executed`, `tui.command.execute` | 用户指令 |

### 2.3 防抖处理 (Debouncing)
针对高频触发的事件（如流式输出 `message.part.updated`），系统引入了防抖机制：
*   **策略**: 对 `DEBOUNCED_TYPES` 列表中的事件（如 `message.part.updated`, `tui.prompt.append`），延迟 `1500ms` (`MESSAGE_PART_DEBOUNCE_MS`) 发送。
*   **效果**: 在文本流式生成过程中，只上报最终稳定状态或低频快照，大幅减少 HTTP 请求量。

## 3. 数据安全与清洗

### 3.1 敏感数据脱敏 (`sanitizeJson`)
在发送前，所有 payload 都会经过严格的清洗：
*   **正则扫描**: 匹配 `api_key`, `token`, `password`, `secret`, `authorization` 等键名。
*   **处理动作**: 对应的值会被替换为 `<redacted>`。
*   **循环引用**: 处理 JSON 对象中的循环引用，防止序列化崩溃。
*   **内容截断**: 长字符串（超过 800 字符）会被截断，防止包体过大。

### 3.2 标签与维度提取
自动为每条日志生成丰富的索引标签 (`tags`) 和维度 (`dimensions`)：
*   `opencode`: 基础标签。
*   `project:{id}` / `session:{id}`: 关联项目与会话。
*   `role:{user/assistant}` / `tool:{name}`: 细粒度分类。

## 4. 上报策略 (Transport)

采用 **异步批量上报** 模式，确保不阻塞主线程用户交互：

1.  **缓冲队列**: 维护一个 `MAX_QUEUE_SIZE = 200` 的内存队列。
2.  **触发条件**:
    *   定时器: 默认每 `750ms` (`DEFAULT_FLUSH_MS`) 触发一次 flush。
    *   队列满: 达到 200 条立即触发。
    *   会话空闲: 收到 `session.idle` 事件立即触发。
3.  **退避重试 (Backoff)**:
    *   如果 HTTP 请求失败（网络错误或非 2xx 响应），系统进入 **5秒** 冷静期 (`backoffUntil`)。
    *   冷静期内产生的新 logs 仍进入队列，但不进行网络请求，防止雪崩。

## 5. 配置清单

可以通过环境变量控制插件行为：

| 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `AOS_BACKEND_URL` | `http://localhost:8080` | 后端服务地址 |
| `AOS_OPENCODE_TELEMETRY` | `true` | 总开关 (1/true/yes 开启) |
| `AOS_OPENCODE_FLUSH_MS` | `750` | 批量上报间隔 (毫秒) |

## 6. API 契约
*   **Endpoint**: `POST /api/v1/telemetry/logs`
*   **Content-Type**: `application/json`
*   **Body**: 日志对象数组 `[ LogEntry, ... ]`
