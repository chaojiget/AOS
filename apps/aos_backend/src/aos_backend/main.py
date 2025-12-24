"""FastAPI application entry point."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.middleware import SlowAPIMiddleware

from aos_storage import init_db
from aos_telemetry.logger import configure_logging
from aos_telemetry.tracing import init_tracing

from aos_backend.routers import logs, health


limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan handler."""
    env_path = Path(__file__).parents[4] / ".env"
    load_dotenv(dotenv_path=env_path, override=False)

    json_logs = os.getenv("AOS_JSON_LOGS", "0").lower() in ("1", "true", "yes")
    configure_logging(json_output=json_logs)
    init_tracing(service_name="aos-backend")

    init_db()

    yield


def _get_allowed_origins() -> list[str]:
    """Get allowed CORS origins from environment."""
    origins = os.getenv("AOS_CORS_ORIGINS", "").strip()
    if origins:
        return [o.strip() for o in origins.split(",")]
    return ["http://localhost:3000", "http://localhost:8080"]


app = FastAPI(
    title="AOS Backend",
    description="Agent Operating System - Telemetry & Memory API",
    version="0.2.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next: Response) -> Response:
    """Apply rate limiting to requests."""
    response = await call_next(request)
    return response


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next: Response) -> Response:
    """Add security headers to responses."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


app.include_router(health.router)
app.include_router(logs.router, prefix="/api/v1/telemetry")


def main() -> None:
    """Run the application with uvicorn."""
    import uvicorn

    host = os.getenv("AOS_HOST", "0.0.0.0")
    port = int(os.getenv("AOS_PORT", "8080"))

    uvicorn.run(
        "aos_backend.main:app",
        host=host,
        port=port,
        reload=os.getenv("AOS_RELOAD", "0").lower() in ("1", "true", "yes"),
    )


if __name__ == "__main__":
    main()
