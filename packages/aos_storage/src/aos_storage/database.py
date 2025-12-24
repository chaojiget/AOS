"""Database connection and session management."""

from __future__ import annotations

import os
from collections.abc import Generator
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

from sqlalchemy import Engine
from sqlmodel import Session, SQLModel, create_engine


def _build_database_url() -> str:
    """Build database URL from environment variables."""
    url = os.getenv("AOS_DATABASE_URL") or os.getenv("DATABASE_URL")
    if url:
        return url

    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "")
    dbname = os.getenv("POSTGRES_DB", "aos")

    if password:
        return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"
    return f"postgresql://{user}@{host}:{port}/{dbname}"


def _get_dev_database_url() -> str:
    """Get SQLite URL for local development."""
    data_dir = Path.home() / ".aos" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "aos.db"
    return f"sqlite:///{db_path}"


def _is_development() -> bool:
    """Check if running in development mode."""
    dev_mode = os.getenv("AOS_DEV", "").lower()
    return dev_mode in ("1", "true", "yes")


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """Get cached SQLAlchemy engine."""
    if _is_development():
        url = _get_dev_database_url()
        return create_engine(url, echo=False)
    url = _build_database_url()
    return create_engine(url, echo=False, pool_pre_ping=True)


def init_db() -> None:
    """Create all tables."""
    from aos_storage.models import LogEntry, WisdomItem  # noqa: F401

    engine = get_engine()
    SQLModel.metadata.create_all(engine)


@contextmanager
def get_session() -> Generator[Session, None, None]:
    """Get a database session as a context manager."""
    engine = get_engine()
    with Session(engine) as session:
        yield session
