from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, RootModel
from sqlalchemy import case, func
from sqlmodel import Session, select

# AOS Imports
from aos_backend.agent import SisyphusAgent
from aos_storage.db import engine, init_db
from aos_storage.models import LogEntry
from aos_memory.entropy import EntropyService
from aos_memory.llm_config import configure_openai_from_openrouter_env, resolve_model
from aos_memory.odysseus import OdysseusService
from pydantic_ai import Agent
from pydantic_ai.ag_ui import handle_ag_ui_request
from starlette.requests import Request
from starlette.responses import Response

# Initialize
app = FastAPI(title="AOS Backend", version="0.2.0")
entropy_service = EntropyService()
odysseus_service = OdysseusService()

allow_origin_regex = os.getenv("AOS_CORS_ALLOW_ORIGIN_REGEX")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_origin_regex=allow_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Models ---
class TelemetryEvent(BaseModel):
    level: str
    logger_name: str
    message: str
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    parent_span_id: Optional[str] = None
    span_name: Optional[str] = None
    timestamp: Optional[datetime] = None
    attributes: Optional[dict[str, Any]] = None


class EntropyRequest(BaseModel):
    text: str
    trace_id: Optional[str] = None


def _maybe_json(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def _serialize_log(log: LogEntry) -> dict[str, Any]:
    return {
        "id": log.id,
        "timestamp": log.timestamp,
        "trace_id": log.trace_id,
        "span_id": log.span_id,
        "parent_span_id": log.parent_span_id,
        "span_name": log.span_name,
        "level": log.level,
        "logger_name": log.logger_name,
        "message": log.message,
        "attributes": _maybe_json(log.attributes),
    }


# --- Startup ---
@app.on_event("startup")
def on_startup():
    init_db()


# --- Routes ---


@app.get("/")
def read_root():
    return {"system": "AOS v0.2", "status": "online"}


class TelemetryIngestRequest(RootModel[list[TelemetryEvent]]):
    pass


@app.post("/api/v1/telemetry/logs")
def ingest_logs(request: TelemetryIngestRequest):
    """
    Ingest logs from external sources (e.g. OpenCode Plugin)
    """
    events = request.root

    count = 0
    with Session(engine) as session:
        for event in events:
            attributes = dict(event.attributes or {})

            if event.trace_id and "otel" not in attributes:
                attributes["otel"] = {
                    "trace_id": event.trace_id,
                    "span_id": event.span_id,
                    "parent_span_id": event.parent_span_id,
                    "span_name": event.span_name,
                }

            log = LogEntry(
                level=event.level.upper(),
                logger_name=event.logger_name,
                message=event.message,
                trace_id=event.trace_id,
                span_id=event.span_id,
                parent_span_id=event.parent_span_id,
                span_name=event.span_name,
                timestamp=event.timestamp or datetime.utcnow(),
                attributes=json.dumps(attributes) if attributes else None,
            )
            session.add(log)
            count += 1
        session.commit()

    return {"status": "success", "ingested": count}


@app.get("/api/v1/telemetry/logs")
def list_logs(
    limit: int = 100,
    search: str | None = None,
    levels: str | None = None,
    trace_id: str | None = None,
):
    """
    Query recent logs for dashboards.
    """
    requested_levels = None
    if levels:
        requested_levels = {
            level.strip().upper() for level in levels.split(",") if level.strip()
        }

    normalized_search = search.strip().lower() if search else None

    with Session(engine) as session:
        statement = select(LogEntry).order_by(LogEntry.timestamp.desc()).limit(limit)
        if trace_id:
            statement = statement.where(LogEntry.trace_id == trace_id)
        results = session.exec(statement).all()

    filtered: list[dict[str, Any]] = []
    for log in results:
        if requested_levels and log.level.upper() not in requested_levels:
            continue

        if normalized_search:
            haystack = " ".join(
                [
                    (log.message or ""),
                    (log.trace_id or ""),
                    (log.span_id or ""),
                    (log.parent_span_id or ""),
                    (log.span_name or ""),
                    (log.logger_name or ""),
                    (log.attributes or ""),
                ]
            ).lower()
            if normalized_search not in haystack:
                continue

        filtered.append(_serialize_log(log))

    return filtered


@app.get("/api/v1/telemetry/traces")
def list_traces(limit: int = 80):
    """
    List recent trace IDs with basic stats for dashboards.
    """
    with Session(engine) as session:
        summary_stmt = (
            select(
                LogEntry.trace_id,
                func.count(LogEntry.id).label("entries"),
                func.sum(case((LogEntry.level == "ERROR", 1), else_=0)).label("errors"),
                func.max(LogEntry.timestamp).label("last_time"),
            )
            .where(LogEntry.trace_id.is_not(None))
            .group_by(LogEntry.trace_id)
            .order_by(func.max(LogEntry.timestamp).desc())
            .limit(limit)
        )
        summary_rows = session.exec(summary_stmt).all()

        traces: list[dict[str, Any]] = []
        for trace_value, entries, errors, last_time in summary_rows:
            trace_id = str(trace_value)
            last_stmt = (
                select(LogEntry)
                .where(LogEntry.trace_id == trace_id)
                .order_by(LogEntry.timestamp.desc())
                .limit(1)
            )
            last_log = session.exec(last_stmt).first()
            last_attributes = _maybe_json(last_log.attributes if last_log else None)

            span_name = last_log.span_name if last_log else None
            if span_name is None and isinstance(last_attributes, dict):
                otel = last_attributes.get("otel")
                if isinstance(otel, dict):
                    span_name = otel.get("span_name")

            traces.append(
                {
                    "trace_id": trace_id,
                    "entries": int(entries or 0),
                    "errors": int(errors or 0),
                    "last_time": last_time,
                    "last_logger_name": last_log.logger_name if last_log else None,
                    "last_message": last_log.message if last_log else None,
                    "span_id": last_log.span_id if last_log else None,
                    "span_name": span_name,
                }
            )

        return traces


@app.get("/api/v1/telemetry/traces/{trace_id}/logs")
def get_trace_logs(
    trace_id: str,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int | None = None,
    order: Literal["asc", "desc"] = "asc",
):
    """
    Return ordered logs for a trace (supports time window + limit).
    """
    with Session(engine) as session:
        statement = select(LogEntry).where(LogEntry.trace_id == trace_id)
        if start is not None:
            statement = statement.where(LogEntry.timestamp >= start)
        if end is not None:
            statement = statement.where(LogEntry.timestamp < end)

        if order == "desc":
            statement = statement.order_by(
                LogEntry.timestamp.desc(), LogEntry.id.desc()
            )
        else:
            statement = statement.order_by(LogEntry.timestamp, LogEntry.id)

        if limit is not None:
            statement = statement.limit(limit)
        results = session.exec(statement).all()

    if order == "desc":
        results = list(reversed(results))

    return [_serialize_log(log) for log in results]


@app.post("/api/v1/entropy/analyze")
def analyze_entropy(request: EntropyRequest):
    """
    Analyze text entropy and return Sisyphus status.
    """
    tokens = entropy_service.count_tokens(request.text)

    # Check simple reset condition based on tokens only for now
    # (Full anxiety check requires querying history)
    should_reset = False
    if tokens > entropy_service.MAX_TOKENS * 0.9:
        should_reset = True

    return {
        "tokens": tokens,
        "max_tokens": entropy_service.MAX_TOKENS,
        "pressure": tokens / entropy_service.MAX_TOKENS,
        "should_reset": should_reset,
    }


agent = SisyphusAgent()


def _build_agui_agent() -> Agent[None, str]:
    """A lightweight AG-UI wrapper around our internal SisyphusAgent.

    CopilotKit/AG-UI clients will stream events from this endpoint.
    """

    configure_openai_from_openrouter_env()

    ui_model = resolve_model(
        explicit=os.getenv("AOS_UI_MODEL"),
        env_fallbacks=("AOS_AGENT_MODEL", "LLM_MODEL"),
        default="deepseek:deepseek-chat",
    )

    agui_agent: Agent[None, str] = Agent(
        ui_model,
        output_type=str,
        system_prompt=(
            "You are the UI-facing wrapper for Sisyphus. "
            "You must call the tool `run_task` to execute work. "
            "Return the tool result as plain text, plus a short next step."
        ),
        defer_model_check=True,
    )

    @agui_agent.tool_plain
    def run_task(instruction: str) -> str:
        result = agent.run_task(instruction)
        if result.get("status") == "error":
            return f"ERROR: {result.get('error')}"
        answer = result.get("answer") or result.get("summary") or ""
        trace_id = result.get("trace_id")
        return "\n".join(
            [
                answer,
                "",
                f"trace_id: {trace_id}",
                "tip: open /telemetry/trace-chain?traceId=<trace_id>",
            ]
        ).strip()

    return agui_agent


agui_agent = _build_agui_agent()


class TaskRequest(BaseModel):
    instruction: str
    consolidate: bool = True


class ConsolidateRequest(BaseModel):
    trace_id: str
    overwrite: bool = False


@app.get("/api/v1/memory/recall")
def recall_memory(limit: int = 3, query: str | None = None):
    """Query memory cards (wisdom items).

    - If `query` is provided, do keyword search.
    - Otherwise return most recent items.
    """
    if query:
        return odysseus_service.search_wisdom(query, limit=limit)
    return odysseus_service.get_all_wisdom(limit=limit)


@app.post("/api/v1/memory/consolidate")
def consolidate_memory(request: ConsolidateRequest):
    """
    Manually trigger distillation for a given trace.
    Outcome: A new WisdomItem in the Vault.
    """
    wisdom = odysseus_service.distill_trace(
        request.trace_id, overwrite=request.overwrite
    )
    if not wisdom:
        raise HTTPException(status_code=404, detail="Trace not found or empty")

    return wisdom


@app.post("/api/v1/ag-ui")
async def ag_ui_endpoint(request: Request) -> Response:
    return await handle_ag_ui_request(agui_agent, request)


@app.post("/api/v1/agent/task")
def run_agent_task(request: TaskRequest):
    """
    Trigger the Sisyphus Agent to perform a task.

    If `consolidate` is true, auto-distill this trace into the Memory Vault.
    """
    result = agent.run_task(request.instruction)

    if request.consolidate:
        trace_id = result.get("trace_id")
        if isinstance(trace_id, str) and trace_id.strip():
            odysseus_service.distill_trace(trace_id)

    return result


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080)
