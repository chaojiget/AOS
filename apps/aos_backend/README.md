# AOS Backend

The REST API that hosts the Sisyphus Agent.

## usage

```bash
uv run uvicorn aos_backend.main:app --reload --port 8080
```

## telemetry read APIs (for dashboards)

- `GET /api/v1/telemetry/logs` (Neural Stream)
  - params: `limit`, `search`, `levels`, `trace_id`
- `GET /api/v1/telemetry/traces` (Trace ID list)
  - params: `limit`
- `GET /api/v1/telemetry/traces/{trace_id}/logs` (Trace Chain)

> CORS: 默认允许 `http://localhost:3000`（Next 前端）。

## OpenCode telemetry (optional)

This repo includes `.opencode/plugin/aos_connector.js`, which forwards key OpenCode events into AOS via `POST /api/v1/telemetry/logs`.

- Default target: `http://localhost:8080/api/v1/telemetry/logs`
- Override with env vars:
  - `AOS_BACKEND_URL` (e.g. `http://localhost:8080`)
  - or `AOS_TELEMETRY_URL`
  - Disable: `AOS_OPENCODE_TELEMETRY=0`
