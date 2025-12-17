# AOS Backend

The REST API that hosts the Sisyphus Agent.

## usage

```bash
uv run uvicorn aos_backend.main:app --reload --port 8080
```

## OpenCode telemetry (optional)

This repo includes `.opencode/plugin/aos_connector.js`, which forwards key OpenCode events into AOS via `POST /api/v1/telemetry/logs`.

- Default target: `http://localhost:8080/api/v1/telemetry/logs`
- Override with env vars:
  - `AOS_BACKEND_URL` (e.g. `http://localhost:8080`)
  - or `AOS_TELEMETRY_URL`
  - Disable: `AOS_OPENCODE_TELEMETRY=0`
