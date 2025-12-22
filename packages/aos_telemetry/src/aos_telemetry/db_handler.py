import json
import logging
import traceback
from typing import Any

from opentelemetry import trace
from aos_storage.models import LogEntry
from aos_storage.db import engine
from sqlmodel import Session


class DBLogHandler(logging.Handler):
    """
    Custom logging handler that writes logs to the SQLModel database via aos_storage.
    """

    def emit(self, record: logging.LogRecord) -> None:
        try:
            # Get OTEL Context
            span = trace.get_current_span()
            span_context = span.get_span_context()

            trace_id = None
            span_id = None
            parent_span_id = None
            span_name = None

            if span_context.is_valid:
                trace_id = trace.format_trace_id(span_context.trace_id)
                span_id = trace.format_span_id(span_context.span_id)
                if hasattr(span, "parent") and span.parent is not None:
                    parent_span_id = trace.format_span_id(span.parent.span_id)
                if hasattr(span, "name"):
                    span_name = span.name

            # Format message
            msg = self.format(record)

            attributes_payload: dict[str, Any] = {
                "otel": {
                    "trace_id": trace_id,
                    "span_id": span_id,
                    "parent_span_id": parent_span_id,
                    "span_name": span_name,
                },
                "log": {
                    "pathname": record.pathname,
                    "lineno": record.lineno,
                    "funcName": record.funcName,
                    "module": record.module,
                },
            }

            if record.exc_info:
                exc_type, exc, tb = record.exc_info
                attributes_payload["exception"] = {
                    "type": getattr(exc_type, "__name__", str(exc_type)),
                    "message": str(exc),
                    "traceback": "".join(traceback.format_exception(exc_type, exc, tb)),
                }
            if record.stack_info:
                attributes_payload["stack_info"] = record.stack_info

            # Create LogEntry
            log_entry = LogEntry(
                level=record.levelname,
                logger_name=record.name,
                message=msg,
                trace_id=trace_id,
                span_id=span_id,
                parent_span_id=parent_span_id,
                span_name=span_name,
                attributes=json.dumps(attributes_payload, ensure_ascii=False, default=str),
            )

            # Write to DB
            # Note: Creating a session for every log might be heavy for high throughput,
            # but fits the "Inverse Entropy" / "Sisyphus" model for now (simplicity & durability).
            with Session(engine) as session:
                session.add(log_entry)
                session.commit()

        except Exception:
            self.handleError(record)
