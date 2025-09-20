# Run Stream EventSource 修复（2025-02-19）

## 背景

- Web 客户端在执行任务后，一直停留在“生成中”，未收到 `run.finished` 等事件。
- 调试发现 Next 前端仅使用 `EventSource.onmessage` 处理 SSE，自定义事件类型（如 `run.finished`）未被捕获。

## 处置

- 在 `startStream` 中为常见事件类型注册监听，复用统一处理逻辑，确保所有流式事件均进入 `handleStreamEvent`。
- 为回调增加数据类型保护，避免非字符串 payload 触发解析错误。
- 通过 `pnpm lint` 与 `pnpm typecheck` 验证改动。

## 遗留与风险

- 新增的事件类型列表需在未来支持更多自定义事件时及时更新。
- 依赖浏览器原生 EventSource，若需兼容自定义 polyfill，需再次验证监听策略。
