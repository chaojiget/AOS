"""Structured logging with automatic trace context injection."""

from __future__ import annotations

import structlog
from opentelemetry import trace


def _add_trace_context(
    logger: structlog.types.WrappedLogger,
    method_name: str,
    event_dict: dict[str, object],
) -> dict[str, object]:
    """Inject trace_id and span_id into log events."""
    span = trace.get_current_span()
    ctx = span.get_span_context()

    if ctx.is_valid:
        event_dict["trace_id"] = format(ctx.trace_id, "032x")
        event_dict["span_id"] = format(ctx.span_id, "016x")

    return event_dict


def configure_logging(json_output: bool = False) -> None:
    """Configure structlog with trace context injection."""
    processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        _add_trace_context,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if json_output:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=True))

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(0),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Get a structured logger with the given name."""
    return structlog.get_logger(name)
