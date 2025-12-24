# /// script
# dependencies = [
#   "psycopg[binary]>=3.2",
#   "python-dotenv>=1.0",
# ]
# ///
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psycopg
from dotenv import load_dotenv
from psycopg.types.json import Jsonb


logger = logging.getLogger("aos_receiver")

LOGS_PATH = "/api/v1/telemetry/logs"
TABLE_NAME = "opencode_log_entries"


CREATE_TABLE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
    id BIGSERIAL PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    timestamp TIMESTAMPTZ NULL,
    trace_id TEXT NULL,
    span_id TEXT NULL,
    parent_span_id TEXT NULL,
    event_type TEXT NULL,
    tags JSONB NULL,
    dimensions JSONB NULL,
    attributes JSONB NULL
);
"""

CREATE_INDEX_TRACE_SQL = f"CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_trace_id ON {TABLE_NAME} (trace_id);"
CREATE_INDEX_TIMESTAMP_SQL = (
    f"CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_timestamp ON {TABLE_NAME} (timestamp);"
)
CREATE_INDEX_EVENT_TYPE_SQL = f"CREATE INDEX IF NOT EXISTS idx_{TABLE_NAME}_event_type ON {TABLE_NAME} (event_type);"

INSERT_SQL = f"""
INSERT INTO {TABLE_NAME} (
    timestamp,
    trace_id,
    span_id,
    parent_span_id,
    event_type,
    tags,
    dimensions,
    attributes
) VALUES (
    %(timestamp)s,
    %(trace_id)s,
    %(span_id)s,
    %(parent_span_id)s,
    %(event_type)s,
    %(tags)s,
    %(dimensions)s,
    %(attributes)s
);
"""


def _parse_iso8601(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None

    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)

    return parsed


def _conninfo_from_env() -> str:
    url = os.getenv("AOS_DATABASE_URL") or os.getenv("DATABASE_URL")
    if url:
        return url

    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "")
    dbname = os.getenv("POSTGRES_DB", "aos")

    parts = [
        f"host={host}",
        f"port={port}",
        f"user={user}",
        f"dbname={dbname}",
    ]
    if password:
        parts.append(f"password={password}")

    return " ".join(parts)


def _init_db(conn: psycopg.Connection[Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE_SQL)
        cur.execute(CREATE_INDEX_TRACE_SQL)
        cur.execute(CREATE_INDEX_TIMESTAMP_SQL)
        cur.execute(CREATE_INDEX_EVENT_TYPE_SQL)


def _insert_logs(conn: psycopg.Connection[Any], payload: list[Any]) -> int:
    rows: list[dict[str, Any]] = []

    for item in payload:
        if not isinstance(item, dict):
            continue

        tags = item.get("tags")
        dimensions = item.get("dimensions")
        attributes = item.get("attributes")

        rows.append(
            {
                "timestamp": _parse_iso8601(item.get("timestamp")),
                "trace_id": item.get("trace_id"),
                "span_id": item.get("span_id"),
                "parent_span_id": item.get("parent_span_id"),
                "event_type": item.get("event_type"),
                "tags": Jsonb(tags) if tags is not None else None,
                "dimensions": Jsonb(dimensions) if dimensions is not None else None,
                "attributes": Jsonb(attributes) if attributes is not None else None,
            }
        )

    if not rows:
        return 0

    with conn.cursor() as cur:
        cur.executemany(INSERT_SQL, rows)

    return len(rows)


class TelemetryServer(HTTPServer):
    def __init__(
        self,
        server_address: tuple[str, int],
        request_handler_class: type[BaseHTTPRequestHandler],
        db_conn: psycopg.Connection[Any],
    ) -> None:
        super().__init__(server_address, request_handler_class)
        self.db_conn = db_conn


class TelemetryHandler(BaseHTTPRequestHandler):
    server: TelemetryServer

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length) if length else b""

        if path != LOGS_PATH:
            self.send_response(404)
            self.end_headers()
            return

        try:
            payload = json.loads(raw.decode("utf-8") or "null")
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            return

        if isinstance(payload, list):
            inserted = _insert_logs(self.server.db_conn, payload)
            logger.info("[receiver] inserted=%s", inserted)
        else:
            logger.info("[receiver] non-list payload type=%s", type(payload).__name__)

        self.send_response(204)
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    load_dotenv(dotenv_path=Path(__file__).with_name(".env"), override=False)

    host = os.getenv("AOS_RECEIVER_HOST", "127.0.0.1")
    port = int(os.getenv("AOS_RECEIVER_PORT", "8080"))

    conninfo = _conninfo_from_env()
    conn = psycopg.connect(conninfo, autocommit=True)

    try:
        _init_db(conn)
        httpd = TelemetryServer((host, port), TelemetryHandler, conn)
        logger.info("[receiver] listening on http://%s:%s", host, port)
        httpd.serve_forever()
    finally:
        conn.close()


if __name__ == "__main__":
    main()
