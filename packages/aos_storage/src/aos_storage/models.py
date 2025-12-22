from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class LogEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    parent_span_id: Optional[str] = None
    span_name: Optional[str] = None

    level: str
    logger_name: str
    message: str

    # Storing attributes as a JSON string for now (portable across SQLite/Postgres)
    attributes: Optional[str] = None


class WisdomItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    source_trace_id: Optional[str] = None

    # The distilled knowledge
    title: str = Field(description="Short summary of the lesson learned")
    content: str = Field(description="Detailed explanation or context")
    tags: str = Field(
        description="Comma-separated tags, e.g., 'error-fix, python, optimization'"
    )

    # Metadata for vector search (future)
    embedding_id: Optional[str] = None
