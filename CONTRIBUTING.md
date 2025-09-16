# Contributing to AOS

Thank you for your interest in improving **AOS**. This document summarizes how we work together so that pull requests can be reviewed and merged quickly.

## Getting started

1. Fork the repository and clone your fork locally.
2. Install dependencies with [`pnpm setup`](./package.json). We target Node.js 20 or newer.
3. Use [`pnpm dev`](./package.json) to start the local development server at http://localhost:3000.
4. Keep dependencies updated via `pnpm install` and avoid committing generated assets or secrets.

## Development workflow

1. **Plan the change.** Discuss significant features by filing an issue so we can confirm scope and acceptance criteria before implementation.
2. **Create a feature branch** from the default branch (`main`). Keep branches focused on a single problem to simplify review.
3. **Implement the change** following the project structure documented in [`AGENTS.md`](./AGENTS.md). Update or add automated tests whenever behaviour changes.
4. **Validate locally** before opening a pull request:
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm test`
   - `pnpm smoke`
   - Run `pnpm build` when the change impacts production builds.
5. **Submit a pull request** that explains _why_ the change is needed and _how_ it was implemented. Link the relevant issue when available.
6. **Respond to review** feedback promptly and keep the commit history tidy by rebasing onto `main` when necessary.

## Branch strategy

We follow a lightweight GitFlow-inspired approach:

- `main` always reflects the latest stable state. Commits to `main` must pass CI.
- Feature work happens on short-lived topic branches named with the pattern `type/short-description` (for example `feat/runtime-registry` or `fix/auth-timeout`).
- Release branches are created only when preparing a production release; they are merged back into `main` once finalized.
- Hotfixes branch from the latest release tag, receive focused fixes, and are merged into both the release branch (if still active) and `main`.

## Commit conventions

We use the [Conventional Commits](https://www.conventionalcommits.org/) standard:

- Format: `<type>[optional scope]: <imperative summary>`
- Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- Use the imperative mood (e.g. "add agent runner") and limit the summary line to 72 characters or fewer.
- Include additional context in the body and reference issues with `Fixes #123` where appropriate.

## Pull request checklist

Before requesting review, make sure to:

- [ ] Update documentation and schema definitions when behaviour changes.
- [ ] Add or update automated tests that cover the change.
- [ ] Ensure linting, type-checking, unit tests, and smoke tests pass locally.
- [ ] Attach any relevant `episodes/` or `reports/` artefacts if they are necessary for reviewers to reproduce results.
- [ ] Describe rollout or rollback considerations for risky changes.

## Code review expectations

- Reviews focus on correctness, clarity, maintainability, and alignment with project goals.
- Small, focused pull requests are merged faster than large mixed changes.
- Resolving conversations is the author's responsibility; re-request review once comments are addressed.
- Reviewers may request additional tests or documentation before approval.

## Communication

- Use GitHub issues and pull requests for asynchronous discussion.
- For urgent production topics, escalate via the team chat channels documented internally.
- Respect the [Code of Conduct](./CODE_OF_CONDUCT.md) in all project spaces.

We appreciate your contributions—thank you for helping make AOS better!
