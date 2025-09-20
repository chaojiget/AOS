# LLM Chat Timeout Handling

## 背景

- 运行日志显示代理在 `llm.chat` 工具阶段长时间无响应，导致整个 runloop 卡住且前端没有新的事件。
- 现有实现直接使用 `fetch` 调用 OpenAI 兼容接口，缺少超时与结构化错误处理，一旦下游阻塞就会卡死。

## 方案

- 引入官方 `openai` SDK 统一处理聊天补全，设置默认 30s 超时并允许通过 `OPENAI_TIMEOUT_MS` 配置。
- 将错误映射为结构化 `ToolError`，超时返回 `llm.timeout`，网络故障返回 `llm.network_error` 等，避免 runloop 静默。
- 提供测试注入工厂 `setOpenAiFactoryForTesting` 便于单元测试覆盖成功与超时分支。

## 风险 & 后续

- 依赖 `openai@5.x` 体积较大，未来可考虑懒加载或拆分为单独模块。
- 当前默认超时为 30s，若后端响应过慢可能仍然影响交互，需要观测实际运行情况并视需求调整。
- `scripts/dev-all.mjs` 仍有 Prettier 告警，后续可单独清理以保证 lint 全绿。
