"""SQLModel schemas for AOS."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlmodel import Column, Field, SQLModel
from sqlalchemy.dialects.postgresql import JSONB


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class LogEntry(SQLModel, table=True):
    """Structured log entry from OpenCode or other sources."""

    __tablename__ = "log_entries"

    id: int | None = Field(default=None, primary_key=True)
    received_at: datetime = Field(default_factory=_utc_now, nullable=False)
    timestamp: datetime | None = Field(default=None, nullable=True)

    # Trace context
    trace_id: str | None = Field(default=None, nullable=True, index=True)
    span_id: str | None = Field(default=None, nullable=True)
    parent_span_id: str | None = Field(default=None, nullable=True)

    # Event metadata
    event_type: str | None = Field(default=None, nullable=True, index=True)

    # JSONB fields
    tags: list[str] | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    dimensions: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    attributes: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB, nullable=True))


class WisdomItem(SQLModel, table=True):
    """Long-term memory item distilled from logs."""

    __tablename__ = "wisdom_items"

    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=_utc_now, nullable=False)
    updated_at: datetime = Field(default_factory=_utc_now, nullable=False)

    # Source trace
    source_trace_id: str | None = Field(default=None, nullable=True, index=True)

    # Content
    title: str = Field(nullable=False)
    content: str = Field(nullable=False)
    summary: str | None = Field(default=None, nullable=True)

    # Metadata
    tags: list[str] | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
    extra_data: dict[str, Any] | None = Field(default=None, sa_column=Column(JSONB, nullable=True))

    # Vector embedding (for future semantic search)
    embedding: list[float] | None = Field(default=None, sa_column=Column(JSONB, nullable=True))
