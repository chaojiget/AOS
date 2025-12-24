"""OpenTelemetry tracing setup."""

from __future__ import annotations

import os
from functools import lru_cache

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter


def init_tracing(
    service_name: str = "aos",
    console_export: bool = False,
) -> TracerProvider:
    """Initialize OpenTelemetry tracing."""
    resource = Resource.create(
        {
            "service.name": service_name,
            "service.version": os.getenv("AOS_VERSION", "0.2.0"),
        }
    )

    provider = TracerProvider(resource=resource)

    if console_export:
        processor = BatchSpanProcessor(ConsoleSpanExporter())
        provider.add_span_processor(processor)

    trace.set_tracer_provider(provider)
    return provider


@lru_cache(maxsize=8)
def get_tracer(name: str) -> trace.Tracer:
    """Get a tracer instance."""
    return trace.get_tracer(name)
