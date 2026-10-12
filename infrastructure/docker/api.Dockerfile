# syntax=docker/dockerfile:1.7
# Production image for the FastAPI API and Celery workers (same image, different command).
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 curl && rm -rf /var/lib/apt/lists/*
WORKDIR /srv

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*
COPY packages/ai /srv/packages/ai
COPY packages/simulation-engine /srv/packages/simulation-engine
COPY apps/api/pyproject.toml /srv/apps/api/pyproject.toml
COPY apps/api/app /srv/apps/api/app
RUN python -m venv /opt/venv && /opt/venv/bin/pip install --upgrade pip \
 && /opt/venv/bin/pip install /srv/packages/ai /srv/packages/simulation-engine /srv/apps/api

FROM base AS runtime
RUN groupadd --system app && useradd --system --gid app --home /srv app
COPY --from=build /opt/venv /opt/venv
COPY apps/api /srv/apps/api
WORKDIR /srv/apps/api
ENV PATH="/opt/venv/bin:$PATH" PORT=8000
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fsS http://localhost:${PORT}/api/v1/health || exit 1
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' --workers ${WEB_CONCURRENCY:-2}"]
