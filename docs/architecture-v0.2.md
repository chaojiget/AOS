# AOS v0.2 Architecture: The Sisyphus Protocol

## 1. Core Philosophy: Inverse Entropy (逆熵)

The foundational concept of AOS v0.2 is "Inverse Entropy". Unlike traditional agents that accumulate infinite context until they crash or hallucinate, AOS is designed to actively fight entropy (disorder).

*   **Sisyphus (The Executor)**: Represents the "Short-Term Memory" and execution cycle. It pushes the rock (performs tasks) but periodically resets (clears context) to maintain a low-entropy state. Ideally, it self-destructs after every distinct unit of work.
*   **Odysseus (The Observer)**: Represents the "Long-Term Wisdom". It observes Sisyphus's struggle, extracts patterns/insights (Wisdom), and persists them. It survives the reset.

## 2. Technical Strategy

*   **Language**: Python 3.10+
*   **Package Management**: `uv` (Rust-based, extremely fast)
*   **Repo Structure**: Monorepo with Workspace support
*   **Observability**: OpenTelemetry (OTEL) First. Telemetry is the bloodstream of the system.
*   **Storage**: SQLModel (SQLite dev fallback, PostgreSQL default for deployment).

## 3. Directory Structure

```text
/
├── pyproject.toml         # Root workspace configuration
├── README.md              # Project entry point
├── _archive/              # Archived v0.1 code
├── docs/                  # Architecture & Design docs
├── packages/              # Reusable Python Libraries
│   ├── aos_telemetry/     # [Foundation] OTEL setup, Logger wrappers
│   ├── aos_storage/       # [Data] SQLModel Schemas, DB connection
│   ├── aos_memory/        # [Core] Sisyphus logic & Wisdom access
│   └── aos_tools/         # [Skills] MCP Clients, Hooks, Standard Tools
└── apps/                  # Deployable Applications
    ├── aos_backend/       # [Brain] FastAPI Agent Orchestrator
    └── aos_dashboard/     # [Visage] Streamlit Admin UI
```

## 4. Package Design Details

### 4.1 `packages/aos_telemetry`
*   **Role**: The "Nervous System".
*   **Responsibilities**:
    *   Configure OpenTelemetry SDK.
    *   Provide `get_logger(name)` that auto-injects `trace_id`.
    *   Export logs to Console (dev) and Database via `aos_storage` (prod).

### 4.2 `packages/aos_storage`
*   **Role**: The "Hippocampus" (Hard Drive).
*   **Tech**: SQLModel.
*   **Schema**:
    *   `LogEntry`: Structured logs (trace_id, level, attributes).
    *   `WisdomItem`: Long-term insights (content, tags, embeddings).

### 4.3 `packages/aos_memory`
*   **Role**: Sisyphus & Odysseus Logic.
*   **Modules**:
    *   `SisyphusContext`: Manages current sliding window. Calculates "Entropy/Anxiety" (Token usage, Error rate).
    *   `OdysseusRecall`: Retrieval engine for `WisdomItem`.

### 4.4 `apps/aos_dashboard`
*   **Role**: The "Consciousness Viewer".
*   **Tech**: Streamlit.
*   **Features**:
    *   **Entropy Monitor**: Real-time gauge of context pressure.
    *   **Neural Stream**: Rolling log of agent thoughts/actions.
    *   **Memory Vault**: Editor for long-term wisdom.

## 5. Execution Roadmap

1.  **Init Workspace**: `uv init --workspace`
2.  **Telemetry Foundation**: Build `aos_telemetry` & `aos_storage`.
3.  **Memory Core**: Implement `aos_memory` with reset logic.
4.  **UI Layer**: Build Streamlit Dashboard to visualize the logs.
5.  **Backend**: Connect Agent logic.
