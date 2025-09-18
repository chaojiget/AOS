# 2025-02-18 adapters/cli lint+type remediation

## Summary

- Eliminated prettier and tsc violations across adapters/core, adapters/mcp, CLI handlers, and supporting UI state.
- Reworked Nest API e2e coverage to avoid forbidden network bindings by calling controllers/services directly.
- Added stub declaration files for express, better-sqlite3, and supertest to satisfy strict type checking without external @types packages.
- Ensured run loop telemetry continues to publish terminal events before stream completion.
- Replaced the Next.js `/api/run` handler with a thin proxy to the standalone Nest API, avoiding on-demand bootstrapping and native module crashes when `better-sqlite3` binaries mismatch.
- Added an in-memory fallback path for `DatabaseService`, allowing tests to run without native SQLite bindings while preserving event persistence semantics.
- Added targeted tests for the Next.js `/api/run` route covering both remote proxying and local fallback execution, preventing regressions for the 502 scenario.
- Introduced `/api/runs/:id`, `/api/runs/:id/events`, `/api/runs/:id/stream` Next.js handlers that proxy the standalone API or fall back to the embedded Nest app, eliminating 404s in dev-only setups and enabling SSE streaming without the external service.

## Follow-ups

- Evaluate replacing handwritten type shims with upstream @types packages once dependency installation policies allow.
- Consider centralising replay-store hydration logic to cut duplication between client and registry utilities.
- Monitor Nest service stream completion to guarantee consumers always observe terminal events without polling.
