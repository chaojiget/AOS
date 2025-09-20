# Episodes 功能回滚脚本

1. 后端移除 Episodes 模块：
   - 删除 `servers/api/src/episodes/` 目录。
   - 在 `servers/api/src/app.module.ts` 中移除 `EpisodesModule` 导入。
   - 在 `servers/api/src/runs/runs.service.ts` 中删除 `listRecentRuns` 新增方法。
2. Next API 代理回滚：
   - 删除 `pages/api/episodes/` 目录。
3. 前端恢复旧界面：
   - 删除 `pages/episodes.tsx` 与 `lib/episodes.ts`。
4. 脚本和脚手架：
   - 删除 `scripts/replay.mjs` 新增逻辑或改回占位。
   - 删除 `reproduce.sh`。
5. 清理构建：`pnpm lint && pnpm typecheck && pnpm test`，确认无残留引用。

> 如使用 git，可通过 `git checkout -- <path>` 恢复对应文件。
