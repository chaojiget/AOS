# AOS (Agent Operating System) — Inverse Entropy Edition

本仓库是一个 Python `uv` workspace（monorepo），提供：

- `apps/aos_backend`：FastAPI 后端（遥测写入/读取 + Agent/Memory/Entropy API）
- `frontend`：Next.js 14 前端（Tailwind + shadcn 风格 + lucide-react），前后端分离的遥测 UI（默认中文/可切换英文）
- `apps/aos_dashboard`：Streamlit 仪表板（legacy，可继续使用）

## 快速开始

### 1) 安装依赖

```bash
uv sync
```

### 2) 启动后端（FastAPI）

```bash
uv run uvicorn aos_backend.main:app --reload --port 8080
```

### 3) 启动前端（Next.js 14）

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

访问：
- `http://localhost:3000` 主页
- `http://localhost:3000/telemetry/neural-stream` 神经流
- `http://localhost:3000/telemetry/trace-chain` Trace Chain（Trace ID 列表 + Span Tree）

> 前端通过 `NEXT_PUBLIC_AOS_BACKEND_URL` 连接后端（默认 `http://localhost:8080`）。

### 4)（可选）启动 Streamlit 仪表板

```bash
uv run streamlit run apps/aos_dashboard/app.py
```

## 开发检查

```bash
uv run ruff format .
uv run ruff check .
uv run mypy .
uv run pytest
```

