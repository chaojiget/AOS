# AOS (Agent Operating System) — Inverse Entropy Edition

本仓库是一个 Python `uv` workspace（monorepo），提供：

## 核心理念：逆熵记忆（Inverse Entropy）

AOS 的“记忆”不是把上下文越堆越大，而是通过 **日志 → 蒸馏 → 记忆卡片** 的闭环对抗熵增：

- **短期记忆（Sisyphus）**：只保留当前任务需要的上下文，过程全部写入可观测日志（Trace/Log）。
- **长期记忆（Odysseus）**：从同一条 `trace_id` 的日志中提炼“可复用结论”（记忆卡片 / `WisdomItem`），写入数据库供后续检索与召回。
- **目标**：让系统越跑越“聪明”，但不会因为上下文膨胀而失控。


- `apps/aos_backend`：FastAPI 后端（遥测写入/读取 + Agent/Memory/Entropy API）
- `frontend`：Next.js 14 前端（Tailwind + shadcn 风格 + lucide-react），前后端分离的遥测 UI（默认中文/可切换英文）
- `apps/aos_dashboard`：Streamlit 仪表板（legacy，可继续使用）

## 快速开始

### 0) 数据库（PostgreSQL 推荐）

AOS 默认会优先读取 `DATABASE_URL` / `AOS_DATABASE_URL`；如果未设置但提供了 `POSTGRES_HOST` 等变量，则自动拼出 `postgresql+psycopg://...`；否则回退到 SQLite。

### 0.1) 记忆闭环（逆熵）

默认使用 `deepseek:deepseek-chat` 将同一 `trace_id` 的日志蒸馏为记忆卡片（写入 `WisdomItem`）。

- 开启：`AOS_MEMORY_LLM=1`
- 模型：`AOS_MEMORY_MODEL=deepseek:deepseek-chat`
- Key：`DEEPSEEK_API_KEY=...`


示例（Docker / 本地均可）：

```bash
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=your_password
export POSTGRES_DB=aos
```

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

