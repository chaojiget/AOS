# AOS

agent os

## Continuous Integration

The repository uses the `CI` GitHub Actions workflow defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). It installs pnpm on Node.js 20 and runs `pnpm setup`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm smoke` sequentially. Successful runs produce the latest `episodes/` and `reports/` directories as downloadable artifacts.

To enforce CI as a merge gate, protect the default branch in GitHub settings and mark the `CI` workflow check as required before merging pull requests.
