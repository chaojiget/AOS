from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

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
from aos_memory.odysseus import OdysseusService

# Initialize
app = FastAPI(title="AOS Backend", version="0.2.0")
entropy_service = EntropyService()
odysseus_service = OdysseusService()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
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
            log = LogEntry(
                level=event.level.upper(),
                logger_name=event.logger_name,
                message=event.message,
                trace_id=event.trace_id,
                span_id=event.span_id,
                timestamp=event.timestamp or datetime.utcnow(),
                attributes=json.dumps(event.attributes) if event.attributes else None,
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

            span_name = None
            if isinstance(last_attributes, dict):
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
def get_trace_logs(trace_id: str):
    """
    Return the full ordered log chain for a trace.
    """
    with Session(engine) as session:
        statement = (
            select(LogEntry)
            .where(LogEntry.trace_id == trace_id)
            .order_by(LogEntry.timestamp)
        )
        results = session.exec(statement).all()
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


class TaskRequest(BaseModel):
    instruction: str


class ConsolidateRequest(BaseModel):
    trace_id: str


@app.get("/api/v1/memory/recall")
def recall_memory(limit: int = 3):
    """
    Returns the most recent wisdom items to prime the agent's context.
    """
    items = odysseus_service.get_all_wisdom()
    # Simple limit for now
    return items[:limit] if items else []


@app.post("/api/v1/memory/consolidate")
def consolidate_memory(request: ConsolidateRequest):
    """
    Manually trigger distillation for a given trace.
    Outcome: A news WisdomItem in the Vault.
    """
    wisdom = odysseus_service.distill_trace(request.trace_id)
    if not wisdom:
        raise HTTPException(status_code=404, detail="Trace not found or empty")

    return wisdom


@app.post("/api/v1/agent/task")
def run_agent_task(request: TaskRequest):
    """
    Trigger the Sisyphus Agent to perform a task.
    """
    result = agent.run_task(request.instruction)
    return result


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8080)
