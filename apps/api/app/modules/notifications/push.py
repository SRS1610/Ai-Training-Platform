"""Web Push delivery behind a provider interface.

``PyWebPushProvider`` (pywebpush + VAPID) is used only when ``VAPID_PUBLIC_KEY`` and ``VAPID_PRIVATE_KEY`` are
configured; otherwise ``NullWebPushProvider`` records every delivery as ``skipped``.
"""

from __future__ import annotations

import asyncio
import json
from abc import ABC, abstractmethod
from functools import lru_cache
from typing import Any

import structlog
from pydantic_settings import BaseSettings, SettingsConfigDict

log = structlog.get_logger(__name__)


class PushSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    VAPID_PUBLIC_KEY: str | None = None
    VAPID_PRIVATE_KEY: str | None = None
    VAPID_SUBJECT: str = "mailto:support@praxis.local"
    WEB_PUSH_TTL_SECONDS: int = 86_400


@lru_cache
def push_settings() -> PushSettings:
    return PushSettings()


class WebPushProvider(ABC):
    """Sends one payload to one browser push subscription."""

    configured: bool = False

    @abstractmethod
    async def send(self, subscription: dict[str, Any], payload: dict[str, Any]) -> str:
        """Return ``sent`` | ``expired`` (subscription gone; caller should drop it) | ``failed`` | ``skipped``."""


class NullWebPushProvider(WebPushProvider):
    configured = False

    async def send(self, subscription: dict[str, Any], payload: dict[str, Any]) -> str:
        return "skipped"


class PyWebPushProvider(WebPushProvider):
    configured = True

    def __init__(self, private_key: str, subject: str, ttl: int) -> None:
        self.private_key = private_key
        self.subject = subject
        self.ttl = ttl

    async def send(self, subscription: dict[str, Any], payload: dict[str, Any]) -> str:
        from pywebpush import WebPushException, webpush

        def _send() -> str:
            try:
                webpush(
                    subscription_info={
                        "endpoint": subscription["endpoint"],
                        "keys": subscription.get("keys", {}),
                    },
                    data=json.dumps(payload),
                    vapid_private_key=self.private_key,
                    vapid_claims={"sub": self.subject},
                    ttl=self.ttl,
                    timeout=10,
                )
                return "sent"
            except WebPushException as exc:
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if status in (404, 410):
                    return "expired"
                log.warning("webpush.failed", status=status, error=str(exc)[:200])
                return "failed"
            except Exception as exc:  # network errors etc. — never raise into callers
                log.warning("webpush.error", error=str(exc)[:200])
                return "failed"

        return await asyncio.to_thread(_send)


def get_push_provider() -> WebPushProvider:
    s = push_settings()
    if s.VAPID_PUBLIC_KEY and s.VAPID_PRIVATE_KEY:
        return PyWebPushProvider(s.VAPID_PRIVATE_KEY, s.VAPID_SUBJECT, s.WEB_PUSH_TTL_SECONDS)
    return NullWebPushProvider()
