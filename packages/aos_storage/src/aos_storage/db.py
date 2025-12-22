from __future__ import annotations

import os
from collections.abc import Iterator

from sqlalchemy import inspect, text
from sqlalchemy.engine import URL
from sqlmodel import SQLModel, Session, create_engine


def _env_truthy(name: str, default: str = "0") -> bool:
    value = os.getenv(name, default).strip().lower()
    return value in {"1", "true", "yes", "on"}


def _sqlite_url() -> str:
    sqlite_file_name = os.getenv("SQLITE_FILE", "aos_memory.db")
    return f"sqlite:///{sqlite_file_name}"


def _postgres_url_from_env() -> URL | None:
    host = os.getenv("POSTGRES_HOST")
    if not host:
        return None

    port_raw = os.getenv("POSTGRES_PORT", "5432")
    try:
        port = int(port_raw)
    except ValueError:
        port = 5432

    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD")
    database = os.getenv("POSTGRES_DB", "aos")

    return URL.create(
        drivername="postgresql+psycopg",
        username=user,
        password=password or None,
        host=host,
        port=port,
        database=database,
    )


def database_url() -> str:
    explicit = os.getenv("DATABASE_URL") or os.getenv("AOS_DATABASE_URL")
    if explicit and explicit.strip():
        return explicit.strip()

    postgres_url = _postgres_url_from_env()
    if postgres_url is not None:
        return str(postgres_url)

    return _sqlite_url()


engine = create_engine(
    database_url(),
    echo=_env_truthy("AOS_DB_ECHO"),
    pool_pre_ping=True,
)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)

    # Best-effort schema evolution for SQLite dev DB.
    # Postgres should be managed via migrations.
    if engine.dialect.name != "sqlite":
        return

    inspector = inspect(engine)
    if "logentry" in inspector.get_table_names():
        existing_columns = {c["name"] for c in inspector.get_columns("logentry")}
        missing = {
            "parent_span_id": "ALTER TABLE logentry ADD COLUMN parent_span_id VARCHAR",
            "span_name": "ALTER TABLE logentry ADD COLUMN span_name VARCHAR",
        }
        statements = [sql for col, sql in missing.items() if col not in existing_columns]
        if statements:
            with engine.begin() as conn:
                for stmt in statements:
                    conn.execute(text(stmt))


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
