FROM python:3.13-slim

WORKDIR /app

# Keep images smaller and logs unbuffered
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install uv
RUN pip install --no-cache-dir uv

# Make dependency downloads more resilient
ENV UV_HTTP_TIMEOUT=120

# Copy workspace metadata first for better caching
COPY pyproject.toml uv.lock README.md ./

# Copy only backend + its workspace deps
COPY apps/aos_backend ./apps/aos_backend
COPY packages/aos_storage ./packages/aos_storage
COPY packages/aos_telemetry ./packages/aos_telemetry
COPY packages/aos_memory ./packages/aos_memory

# Sync backend runtime deps only (faster + less flaky)
ENV UV_LINK_MODE=copy
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --package aos_backend --no-dev

EXPOSE 8080

CMD ["uv", "run", "--package", "aos_backend", "--no-dev", "uvicorn", "aos_backend.main:app", "--host", "0.0.0.0", "--port", "8080"]
