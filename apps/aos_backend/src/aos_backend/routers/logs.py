"""Telemetry logs API endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query, Response, Request, status, Header, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlmodel import select, col

from aos_storage import LogEntry, get_session
from aos_telemetry import get_logger

from aos_backend.security import verify_token

router = APIRouter(tags=["telemetry"])
logger = get_logger(__name__)

limiter = Limiter(key_func=get_remote_address)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()),
) -> dict:
    """Verify JWT Bearer token."""
    return verify_token(credentials.credentials)


async def get_api_key_user(x_api_key: str = Header(alias="X-API-Key")) -> dict:
    """Verify API Key header."""
    return {"api_key": x_api_key}


async def require_auth(
    user: dict = Depends(get_current_user),
) -> dict:
    """Require JWT authentication."""
    return user


async def require_auth_or_api_key(
    jwt_user: dict | None = Depends(HTTPBearer(auto_error=False)),
    api_key: str | None = Header(None, alias="X-API-Key"),
) -> dict:
    """Combined auth: JWT Bearer or API Key header."""
    if jwt_user:
        return verify_token(jwt_user.credentials)
    elif api_key:
        return {"api_key": api_key}
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required: Bearer token or X-API-Key header",
            headers={"WWW-Authenticate": "Bearer"},
        )


class LogEntryCreate(BaseModel):
    """Schema for creating a log entry."""

    timestamp: str | None = None
    trace_id: str | None = None
    span_id: str | None = None
    parent_span_id: str | None = None
    event_type: str | None = None
    tags: list[str] | None = None
    dimensions: dict[str, Any] | None = None
    attributes: dict[str, Any] | None = None

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v: list[str] | None) -> list[str] | None:
        if v and len(v) > 20:
            raise ValueError("Too many tags (max 20)")
        return v

    @field_validator("dimensions", "attributes")
    @classmethod
    def validate_json_size(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        if v:
            import json
            size = len(json.dumps(v))
            if size > 1024 * 100:
                raise ValueError("JSON field too large (max 100KB)")
        return v


class LogEntryResponse(BaseModel):
    """Schema for log entry response."""

    id: int
    received_at: datetime
    timestamp: datetime | None
    trace_id: str | None
    span_id: str | None
    parent_span_id: str | None
    event_type: str | None
    tags: list[str] | None
    dimensions: dict[str, Any] | None
    attributes: dict[str, Any] | None

    class Config:
        from_attributes = True


class TraceListItem(BaseModel):
    """Schema for trace list item."""

    trace_id: str
    event_count: int
    first_seen: datetime
    last_seen: datetime
    event_types: list[str]


def _parse_iso8601(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


@router.post("/logs", status_code=204)
@limiter.limit("100/minute")
async def ingest_logs(
    request: Request,
    entries: list[LogEntryCreate],
    _auth: dict = Depends(require_auth_or_api_key),
) -> Response:
    """Ingest log entries from OpenCode or other sources."""
    if not entries:
        return Response(status_code=204)

    with get_session() as session:
        for entry in entries:
            log_entry = LogEntry(
                timestamp=_parse_iso8601(entry.timestamp),
                trace_id=entry.trace_id,
                span_id=entry.span_id,
                parent_span_id=entry.parent_span_id,
                event_type=entry.event_type,
                tags=entry.tags,
                dimensions=entry.dimensions,
                attributes=entry.attributes,
            )
            session.add(log_entry)
        session.commit()

    logger.info("logs_ingested", count=len(entries))
    return Response(status_code=204)


@router.get("/logs", response_model=list[LogEntryResponse])
async def list_logs(
    _auth: dict = Depends(require_auth),
    trace_id: str | None = Query(None, description="Filter by trace ID"),
    event_type: str | None = Query(None, description="Filter by event type"),
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
) -> list[LogEntryResponse]:
    """List log entries with optional filters."""
    with get_session() as session:
        stmt = select(LogEntry)

        if trace_id:
            stmt = stmt.where(LogEntry.trace_id == trace_id)
        if event_type:
            stmt = stmt.where(LogEntry.event_type == event_type)

        stmt = stmt.order_by(col(LogEntry.id).desc()).offset(offset).limit(limit)
        results = session.exec(stmt).all()

        return [LogEntryResponse.model_validate(r) for r in results]


@router.get("/traces", response_model=list[TraceListItem])
async def list_traces(
    _auth: dict = Depends(require_auth),
    limit: int = Query(50, ge=1, le=500, description="Maximum number of traces"),
) -> list[TraceListItem]:
    """List unique traces with aggregated info."""
    with get_session() as session:
        stmt = (
            select(LogEntry)
            .where(LogEntry.trace_id.is_not(None))
            .order_by(col(LogEntry.id).desc())
            .limit(limit * 20)
        )
        results = session.exec(stmt).all()

        traces: dict[str, dict[str, Any]] = {}
        for entry in results:
            tid = entry.trace_id
            if not tid:
                continue
            if tid not in traces:
                traces[tid] = {
                    "trace_id": tid,
                    "event_count": 0,
                    "first_seen": entry.received_at,
                    "last_seen": entry.received_at,
                    "event_types": set(),
                }
            traces[tid]["event_count"] += 1
            if entry.received_at < traces[tid]["first_seen"]:
                traces[tid]["first_seen"] = entry.received_at
            if entry.received_at > traces[tid]["last_seen"]:
                traces[tid]["last_seen"] = entry.received_at
            if entry.event_type:
                traces[tid]["event_types"].add(entry.event_type)

        result = []
        for t in list(traces.values())[:limit]:
            result.append(
                TraceListItem(
                    trace_id=t["trace_id"],
                    event_count=t["event_count"],
                    first_seen=t["first_seen"],
                    last_seen=t["last_seen"],
                    event_types=sorted(t["event_types"]),
                )
            )

        return result


@router.get("/logs/{trace_id}", response_model=list[LogEntryResponse])
async def get_trace_logs(
    trace_id: str,
    _auth: dict = Depends(require_auth),
) -> list[LogEntryResponse]:
    """Get all logs for a specific trace."""
    with get_session() as session:
        stmt = (
            select(LogEntry)
            .where(LogEntry.trace_id == trace_id)
            .order_by(col(LogEntry.id).asc())
        )
        results = session.exec(stmt).all()
        return [LogEntryResponse.model_validate(r) for r in results]
