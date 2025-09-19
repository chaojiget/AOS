# 2025-09-19 pnpm dev orchestration

## Background
- 针对开发流程中需要同时启动 Next.js 前端与 NestJS API 的需求，讨论是否整合启动命令以减少手动步骤。

## Insights
- 初版 `pnpm run --parallel dev dev:api` 会把第二个脚本当成参数传给 `next dev`，导致启动失败。
- 新增 `scripts/dev-all.mjs` 使用 Node 的 `child_process.spawn` 并行拉起 `pnpm run dev` 与 `pnpm run dev:api`，并在任一进程退出时联动停止。
- `package.json` 的 `dev:all` 脚本改为执行 `node scripts/dev-all.mjs`，保持依赖简洁并可跨平台运行。
- 并行进程生命周期联动：任一进程退出会同时结束，有利于及时发现构建或运行异常。
- 脚本捕获 `SIGINT/SIGTERM` 做统一清理，避免僵尸进程。

## Next steps
- 观察团队在日常开发中使用 `pnpm dev:all` 的体验，若需要独立日志或更复杂的进程管理，再评估引入 PM2/overmind 等方案。
- 如需在 CI 或脚本中复用，可进一步编写文档说明启动顺序与退出策略。
