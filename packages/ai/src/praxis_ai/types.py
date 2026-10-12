"""Shared value types and errors for the provider layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Role = Literal["system", "user", "assistant"]


@dataclass
class ChatMessage:
    role: Role
    content: str

    @classmethod
    def coerce(cls, value: ChatMessage | dict[str, Any]) -> ChatMessage:
        if isinstance(value, ChatMessage):
            return value
        role = value.get("role", "user")
        if role not in ("system", "user", "assistant"):
            role = "user"
        return cls(role=role, content=str(value.get("content", "")))


@dataclass
class ChatResult:
    text: str
    tokens_in: int
    tokens_out: int
    model: str
    provider: str
    finish_reason: str = "stop"
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


@dataclass
class EmbeddingResult:
    vectors: list[list[float]]
    model: str
    provider: str
    tokens_in: int = 0


class ProviderError(Exception):
    """A provider call failed. ``retryable`` marks transient failures (429 / 5xx / network)."""

    def __init__(self, message: str, *, provider: str = "", status: int | None = None,
                 retryable: bool = False) -> None:
        super().__init__(message)
        self.provider = provider
        self.status = status
        self.retryable = retryable


class ProviderAuthError(ProviderError):
    """Credentials were rejected (401/403) — never retried."""


class ProviderNotSupported(ProviderError):
    """The provider does not offer this capability (e.g. Anthropic embeddings)."""
