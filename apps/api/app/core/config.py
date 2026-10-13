"""Application configuration loaded from environment variables (12-factor)."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- General -----------------------------------------------------------------
    APP_NAME: str = "Praxis Training Platform"
    ENVIRONMENT: Literal["development", "test", "staging", "production"] = "development"
    DEBUG: bool = False
    API_PREFIX: str = "/api/v1"
    PUBLIC_WEB_URL: str = "http://localhost:3000"
    PUBLIC_API_URL: str = "http://localhost:8000"
    # NoDecode: accept a comma-separated string (split by _split_origins) as well as a JSON list.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:3000"])
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = False

    # --- Data stores -------------------------------------------------------------
    DATABASE_URL: str = "postgresql+asyncpg://praxis:praxis@localhost:5432/praxis"
    DATABASE_POOL_SIZE: int = 10
    DATABASE_MAX_OVERFLOW: int = 20
    DATABASE_ECHO: bool = False
    # Pre-ping validates each pooled connection on checkout. With asyncpg that is three round trips
    # (BEGIN; ping; ROLLBACK) per request, so it can be disabled where connections are not dropped
    # underneath the pool (local dev, CI, seeding); stale connections are still recycled.
    DATABASE_POOL_PRE_PING: bool = True
    DATABASE_POOL_RECYCLE_SECONDS: int = 1800
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str | None = None
    CELERY_TASK_ALWAYS_EAGER: bool = False

    # --- Auth / security ---------------------------------------------------------
    AUTH_SECRET: str = "change-me-dev-only-secret-change-me-dev-only"  # noqa: S105 - rejected in production
    ENCRYPTION_KEY: str | None = None  # Fernet key; derived from AUTH_SECRET when unset (dev only)
    ACCESS_TOKEN_TTL_MINUTES: int = 15
    REFRESH_TOKEN_TTL_DAYS: int = 14
    MFA_CHALLENGE_TTL_MINUTES: int = 5
    EMAIL_TOKEN_TTL_HOURS: int = 24
    PASSWORD_RESET_TTL_MINUTES: int = 30
    INVITATION_TTL_DAYS: int = 7
    COOKIE_SECURE: bool = False
    COOKIE_DOMAIN: str | None = None
    REQUIRE_EMAIL_VERIFICATION: bool = False
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_DEFAULT_PER_MINUTE: int = 300
    RATE_LIMIT_AUTH_PER_MINUTE: int = 20
    RATE_LIMIT_AI_PER_MINUTE: int = 30

    # --- OAuth / SSO -------------------------------------------------------------
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    MICROSOFT_CLIENT_ID: str | None = None
    MICROSOFT_CLIENT_SECRET: str | None = None
    MICROSOFT_TENANT: str = "common"

    # --- AI ----------------------------------------------------------------------
    AI_DEFAULT_PROVIDER: Literal["openai", "anthropic", "azure_openai", "google", "local", "offline"] = (
        "offline"
    )
    AI_DEFAULT_MODEL: str = "gpt-4o-mini"
    AI_EMBEDDING_MODEL: str = "text-embedding-3-small"
    AI_EMBEDDING_DIM: int = 1536
    AI_REQUEST_TIMEOUT_SECONDS: float = 60.0
    OPENAI_API_KEY: str | None = None
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    ANTHROPIC_API_KEY: str | None = None
    ANTHROPIC_MODEL: str = "claude-sonnet-5-5"
    AZURE_OPENAI_API_KEY: str | None = None
    AZURE_OPENAI_ENDPOINT: str | None = None
    AZURE_OPENAI_API_VERSION: str = "2024-10-21"
    GOOGLE_API_KEY: str | None = None  # Gemini
    LOCAL_MODEL_BASE_URL: str | None = None  # any OpenAI-compatible endpoint (vLLM, Ollama, LM Studio)

    # --- Storage -----------------------------------------------------------------
    STORAGE_BACKEND: Literal["local", "s3"] = "local"
    LOCAL_STORAGE_PATH: str = "./.storage"
    AWS_ACCESS_KEY: str | None = None
    AWS_SECRET_KEY: str | None = None
    AWS_REGION: str = "ap-southeast-2"
    AWS_BUCKET: str | None = None
    AWS_S3_ENDPOINT_URL: str | None = None
    MAX_UPLOAD_MB: int = 50
    CLAMAV_HOST: str | None = None
    CLAMAV_PORT: int = 3310

    # --- Billing -----------------------------------------------------------------
    STRIPE_SECRET_KEY: str | None = None
    STRIPE_WEBHOOK_SECRET: str | None = None
    STRIPE_PUBLISHABLE_KEY: str | None = None

    # --- Email -------------------------------------------------------------------
    EMAIL_PROVIDER: Literal["console", "smtp", "ses"] = "console"
    EMAIL_FROM: str = "Praxis <no-reply@praxis.local>"
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_USE_TLS: bool = True

    # --- Observability -----------------------------------------------------------
    SENTRY_DSN: str | None = None
    OTEL_EXPORTER_OTLP_ENDPOINT: str | None = None

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            if value.lstrip().startswith("["):
                return json.loads(value)
            return [v.strip() for v in value.split(",") if v.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def celery_broker(self) -> str:
        return self.CELERY_BROKER_URL or self.REDIS_URL

    def validate_production(self) -> None:
        """Fail fast on insecure production configuration."""
        if not self.is_production:
            return
        problems = []
        if self.AUTH_SECRET.startswith("change-me") or len(self.AUTH_SECRET) < 32:
            problems.append("AUTH_SECRET must be a strong random value")
        if not self.ENCRYPTION_KEY:
            problems.append("ENCRYPTION_KEY must be set")
        if not self.COOKIE_SECURE:
            problems.append("COOKIE_SECURE must be true")
        if problems:
            raise RuntimeError("Insecure production configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
