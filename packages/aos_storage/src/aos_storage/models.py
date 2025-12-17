from typing import Optional
from datetime import datetime
from sqlmodel import Field, SQLModel, JSON
from sqlalchemy import Column

class LogEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    trace_id: str = Field(index=True)
    span_id: Optional[str] = None
    level: str
    message: str
    attributes: str = Field(default="{}") # Stored as JSON string
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class WisdomItem(SQLModel, table=True):
    """
    Long-term memory (Odysseus).
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    content: str
    tags: str = Field(default="[]") # JSON list of tags
    embedding: Optional[str] = None # Placeholder for when we add vectors
    entropy_score: float = Field(default=0.0)
    created_at: datetime = Field(default_factory=datetime.utcnow)
