"""Provider interface and shared HTTP plumbing (timeouts, retries with backoff, error mapping)."""

from __future__ import annotations

import asyncio
import random
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Sequence
from typing import Any

import httpx

from praxis_ai.results import (
    ChatMessage,
    ChatResult,
    EmbeddingResult,
    ProviderAuthError,
    ProviderError,
    ProviderNotSupported,
)

RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504, 529}


class AIProvider(ABC):
    """Provider-agnostic interface used by the AI gateway.

    Subclasses implement ``chat`` (and ``embed`` when supported). ``stream_chat`` has a default
    implementation that yields the full answer in word-sized pieces, so every provider can back an SSE
    endpoint; providers with native streaming may override it.
    """

    name: str = "base"
    default_model: str = ""
    default_embedding_model: str | None = None
    supports_embeddings: bool = True

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = 60.0,
        max_retries: int = 2,
        retry_backoff: float = 0.5,
        embedding_dim: int = 1536,
        transport: httpx.AsyncBaseTransport | None = None,
        **options: Any,
    ) -> None:
        self.api_key = api_key
        self.base_url = (base_url or "").rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_backoff = retry_backoff
        self.embedding_dim = embedding_dim
        self.transport = transport
        self.options = options

    # ------------------------------------------------------------------ interface

    @abstractmethod
    async def chat(
        self,
        messages: Sequence[ChatMessage | dict[str, Any]],
        *,
        model: str | None = None,
        temperature: float | None = 0.3,
        max_tokens: int | None = 1024,
        json_mode: bool = False,
    ) -> ChatResult: ...

    async def embed(self, texts: list[str], *, model: str | None = None) -> EmbeddingResult:
        raise ProviderNotSupported(f"{self.name} does not provide embeddings", provider=self.name)

    async def stream_chat(
        self,
        messages: Sequence[ChatMessage | dict[str, Any]],
        *,
        model: str | None = None,
        temperature: float | None = 0.3,
        max_tokens: int | None = 1024,
    ) -> AsyncIterator[str]:
        result = await self.chat(messages, model=model, temperature=temperature, max_tokens=max_tokens)
        words = result.text.split(" ")
        for i, w in enumerate(words):
            yield w + (" " if i < len(words) - 1 else "")

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def coerce(messages: Sequence[ChatMessage | dict[str, Any]]) -> list[ChatMessage]:
        return [ChatMessage.coerce(m) for m in messages]

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=httpx.Timeout(self.timeout, connect=min(10.0, self.timeout)), transport=self.transport
        )

    async def _post_json(
        self, url: str, *, headers: dict[str, str], body: dict[str, Any], params: dict[str, str] | None = None
    ) -> dict[str, Any]:
        last: Exception | None = None
        async with self._client() as client:
            for attempt in range(self.max_retries + 1):
                try:
                    resp = await client.post(url, headers=headers, json=body, params=params)
                except httpx.TimeoutException as exc:
                    last = ProviderError(f"{self.name} request timed out", provider=self.name, retryable=True)
                    last.__cause__ = exc
                except httpx.TransportError as exc:
                    last = ProviderError(
                        f"{self.name} connection error: {exc}", provider=self.name, retryable=True
                    )
                    last.__cause__ = exc
                else:
                    if resp.status_code < 400:
                        try:
                            return resp.json()
                        except ValueError as exc:
                            raise ProviderError(
                                f"{self.name} returned invalid JSON",
                                provider=self.name,
                                status=resp.status_code,
                            ) from exc
                    message = _error_message(resp)
                    if resp.status_code in (401, 403):
                        raise ProviderAuthError(
                            f"{self.name} rejected credentials: {message}",
                            provider=self.name,
                            status=resp.status_code,
                        )
                    retryable = resp.status_code in RETRYABLE_STATUS
                    last = ProviderError(
                        f"{self.name} error {resp.status_code}: {message}",
                        provider=self.name,
                        status=resp.status_code,
                        retryable=retryable,
                    )
                    if not retryable:
                        raise last
                    retry_after = resp.headers.get("retry-after")
                    if retry_after and attempt < self.max_retries:
                        try:
                            await asyncio.sleep(min(10.0, float(retry_after)))
                            continue
                        except ValueError:
                            pass
                if attempt < self.max_retries:
                    await asyncio.sleep(self.retry_backoff * (2**attempt) * (1 + random.random() * 0.25))
        assert last is not None
        raise last


def _error_message(resp: httpx.Response) -> str:
    try:
        data = resp.json()
    except ValueError:
        return resp.text[:300]
    err = data.get("error") if isinstance(data, dict) else None
    if isinstance(err, dict):
        return str(err.get("message") or err.get("type") or err)[:300]
    if isinstance(err, str):
        return err[:300]
    return str(data)[:300]


JSON_INSTRUCTION = "Respond with a single valid JSON object only — no prose, no markdown code fences."
