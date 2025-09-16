# Contributing to AOS

感谢你对 AOS 项目的关注！为了帮助大家顺利协作，请在开始工作前阅读并遵循以下流程与规范。

Thank you for your interest in improving **AOS**. This document summarizes how we work together so that pull requests can be reviewed and merged quickly.

## Getting started / 开始工作

1. Fork the repository and clone your fork locally. / Fork 仓库并在本地克隆您的 fork。
2. Install dependencies with [`pnpm setup`](./package.json). We target Node.js 20 or newer. / 使用 `pnpm setup` 安装依赖。需要 Node.js 20 或更新版本。
3. Use [`pnpm dev`](./package.json) to start the local development server at http://localhost:3000. / 使用 `pnpm dev` 启动本地开发服务器。
4. Keep dependencies updated via `pnpm install` and avoid committing generated assets or secrets. / 保持依赖更新，避免提交生成的资源或密钥。

## Development workflow / 开发流程

1. **Plan the change. / 了解需求**：Discuss significant features by filing an issue so we can confirm scope and acceptance criteria before implementation. / 在开始实现前通过创建 issue 讨论重要功能，确认范围和验收标准。
2. **Create a feature branch / 创建功能分支** from the default branch (`main`). Keep branches focused on a single problem to simplify review. / 从主分支创建功能分支，保持分支专注于单一问题以简化审查。
3. **Implement the change / 实现更改** following the project structure documented in [`AGENTS.md`](./AGENTS.md). Update or add automated tests whenever behaviour changes. / 按照 `AGENTS.md` 中记录的项目结构实现更改，在行为更改时更新或添加自动化测试。
4. **Validate locally / 自测清单** before opening a pull request: / 在开启 PR 前进行本地验证：
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm test`
   - `pnpm smoke`
   - 其他与任务相关的专项测试或验证 / Run `pnpm build` when the change impacts production builds.
5. **Submit a pull request / 提交 PR** that explains _why_ the change is needed and _how_ it was implemented. Link the relevant issue when available. / 在描述中说明改动背景、方案和测试结果，并链接相关 issue。
6. **Respond to review / 响应审查** feedback promptly and keep the commit history tidy by rebasing onto `main` when necessary. / 及时响应审查反馈，必要时通过 rebase 保持提交历史整洁。

## Branch strategy / 分支策略

We follow a lightweight GitFlow-inspired approach: / 我们遵循轻量级的 GitFlow 方法：

- `main` always reflects the latest stable state. Commits to `main` must pass CI. / `main` 分支始终反映最新的稳定状态，提交到 `main` 必须通过 CI。
- Feature work happens on short-lived topic branches named with the pattern `type/short-description` (for example `feat/runtime-registry` or `fix/auth-timeout`). / 功能开发在短期主题分支上进行，命名模式为 `type/short-description`（例如 `feat/runtime-registry` 或 `fix/auth-timeout`）。
- Release branches are created only when preparing a production release; they are merged back into `main` once finalized. / 发布分支仅在准备生产发布时创建，完成后合并回 `main`。
- Hotfixes branch from the latest release tag, receive focused fixes, and are merged into both the release branch (if still active) and `main`. / 热修复分支从最新发布标签分出，接收集中修复，并合并到发布分支（如果仍然活跃）和 `main`。

## Commit conventions / 提交约定

We use the [Conventional Commits](https://www.conventionalcommits.org/) standard: / 我们使用 [Conventional Commits](https://www.conventionalcommits.org/) 标准：

- Format: `<type>[optional scope]: <imperative summary>` / 格式：`<type>[可选范围]: <祈使句摘要>`
- Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert` / 常见类型：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`
- Use the imperative mood (e.g. "add agent runner") and limit the summary line to 72 characters or fewer. / 使用祈使语气（例如"add agent runner"）并将摘要行限制在 72 个字符或更少。
- Include additional context in the body and reference issues with `Fixes #123` where appropriate. / 在正文中包含额外的上下文，并在适当时引用 issue，如 `Fixes #123`。

## Pull request checklist / PR 检查清单

Before requesting review, make sure to: / 在请求审查前，确保：

- [ ] Update documentation and schema definitions when behaviour changes. / 行为更改时更新文档和模式定义。
- [ ] Add or update automated tests that cover the change. / 添加或更新覆盖更改的自动化测试。
- [ ] Ensure linting, type-checking, unit tests, and smoke tests pass locally. / 确保代码检查、类型检查、单元测试和冒烟测试在本地通过。
- [ ] Attach any relevant `episodes/` or `reports/` artefacts if they are necessary for reviewers to reproduce results. / 如果审查者需要重现结果，请附上相关的 `episodes/` 或 `reports/` 文件。
- [ ] Describe rollout or rollback considerations for risky changes. / 描述风险更改的部署或回滚考虑因素。

## Code review expectations / 代码审查期望

- Reviews focus on correctness, clarity, maintainability, and alignment with project goals. / 审查关注正确性、清晰度、可维护性和与项目目标的一致性。
- Small, focused pull requests are merged faster than large mixed changes. / 小而专注的 PR 比大而混合的更改合并更快。
- Resolving conversations is the author's responsibility; re-request review once comments are addressed. / 解决对话是作者的责任；一旦处理了评论，请重新请求审查。
- Reviewers may request additional tests or documentation before approval. / 审查者可能在批准前要求额外的测试或文档。

## Communication / 沟通

- Use GitHub issues and pull requests for asynchronous discussion. / 使用 GitHub issue 和 PR 进行异步讨论。
- For urgent production topics, escalate via the team chat channels documented internally. / 对于紧急的生产主题，通过内部记录的团队聊天频道升级。
- Respect the [Code of Conduct](./CODE_OF_CONDUCT.md) in all project spaces. / 在所有项目空间中尊重[行为准则](./CODE_OF_CONDUCT.md)。

We appreciate your contributions—thank you for helping make AOS better! / 我们感谢您的贡献——感谢您帮助让 AOS 变得更好！
