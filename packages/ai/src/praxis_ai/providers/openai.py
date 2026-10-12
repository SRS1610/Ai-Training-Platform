"""OpenAI Chat Completions + Embeddings, and the OpenAI-wire-compatible Azure OpenAI and local providers."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from praxis_ai.providers.base import JSON_INSTRUCTION, AIProvider
from praxis_ai.results import ChatMessage, ChatResult, EmbeddingResult, ProviderError

_NO_SAMPLING = re.compile(r"^(o\d|gpt-5)")


class OpenAIProvider(AIProvider):
    """``POST {base}/chat/completions`` and ``POST {base}/embeddings`` (Bearer auth)."""

    name = "openai"
    default_base_url = "https://api.openai.com/v1"
    default_model = "gpt-4o-mini"
    default_embedding_model = "text-embedding-3-small"
    token_param = "max_completion_tokens"  # noqa: S105

    def __init__(self, **kw: Any) -> None:
        super().__init__(**kw)
        self.base_url = self.base_url or self.default_base_url

    # -- wire details overridable by Azure/local
    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _chat_url(self, model: str) -> str:
        return f"{self.base_url}/chat/completions"

    def _embed_url(self, model: str) -> str:
        return f"{self.base_url}/embeddings"

    def _params(self) -> dict[str, str] | None:
        return None

    def _include_model(self) -> bool:
        return True

    def _supports_temperature(self, model: str) -> bool:
        return not _NO_SAMPLING.match(model or "")

    async def chat(
        self,
        messages: Sequence[ChatMessage | dict[str, Any]],
        *,
        model: str | None = None,
        temperature: float | None = 0.3,
        max_tokens: int | None = 1024,
        json_mode: bool = False,
    ) -> ChatResult:
        model = model or self.default_model
        msgs = [{"role": m.role, "content": m.content} for m in self.coerce(messages)]
        body: dict[str, Any] = {"messages": msgs}
        if self._include_model():
            body["model"] = model
        if temperature is not None and self._supports_temperature(model):
            body["temperature"] = temperature
        if max_tokens:
            body[self.token_param] = max_tokens
        if json_mode:
            body["response_format"] = {"type": "json_object"}
            # The API requires the word "JSON" to appear in the messages when json_object is requested.
            if not any("json" in m["content"].lower() for m in msgs):
                msgs.insert(0, {"role": "system", "content": JSON_INSTRUCTION})
        data = await self._post_json(
            self._chat_url(model), headers=self._headers(), body=body, params=self._params()
        )
        try:
            choice = data["choices"][0]
            text = choice["message"].get("content") or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError(f"{self.name}: unexpected response shape", provider=self.name) from exc
        usage = data.get("usage") or {}
        finish = choice.get("finish_reason") or "stop"
        return ChatResult(
            text=text,
            tokens_in=int(usage.get("prompt_tokens") or 0),
            tokens_out=int(usage.get("completion_tokens") or 0),
            model=data.get("model") or model,
            provider=self.name,
            finish_reason=finish,
            raw=data,
        )

    async def embed(self, texts: list[str], *, model: str | None = None) -> EmbeddingResult:
        model = model or self.default_embedding_model or ""
        body: dict[str, Any] = {"input": texts}
        if self._include_model():
            body["model"] = model
        if model.startswith("text-embedding-3"):
            body["dimensions"] = self.embedding_dim
        data = await self._post_json(
            self._embed_url(model), headers=self._headers(), body=body, params=self._params()
        )
        try:
            rows = sorted(data["data"], key=lambda r: r.get("index", 0))
            vectors = [list(map(float, r["embedding"])) for r in rows]
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError(f"{self.name}: unexpected embeddings response", provider=self.name) from exc
        if len(vectors) != len(texts):
            raise ProviderError(f"{self.name}: embedding count mismatch", provider=self.name)
        usage = data.get("usage") or {}
        return EmbeddingResult(
            vectors=vectors,
            model=model,
            provider=self.name,
            tokens_in=int(usage.get("prompt_tokens") or usage.get("total_tokens") or 0),
        )


class AzureOpenAIProvider(OpenAIProvider):
    """Azure OpenAI deployments: ``POST {endpoint}/openai/deployments/{deployment}/chat/completions
    ?api-version=...`` with the ``api-key`` header. ``model`` is the deployment name."""

    name = "azure_openai"
    default_base_url = ""
    token_param = "max_tokens"  # noqa: S105

    def __init__(self, *, api_version: str = "2024-10-21", **kw: Any) -> None:
        super().__init__(**kw)
        self.api_version = api_version
        if not self.base_url:
            raise ProviderError("Azure OpenAI endpoint is not configured", provider=self.name)

    def _headers(self) -> dict[str, str]:
        return {"Content-Type": "application/json", "api-key": self.api_key or ""}

    def _chat_url(self, model: str) -> str:
        return f"{self.base_url}/openai/deployments/{model}/chat/completions"

    def _embed_url(self, model: str) -> str:
        return f"{self.base_url}/openai/deployments/{model}/embeddings"

    def _params(self) -> dict[str, str] | None:
        return {"api-version": self.api_version}

    def _include_model(self) -> bool:
        return False


class LocalModelProvider(OpenAIProvider):
    """Any OpenAI-compatible server (vLLM, Ollama ``/v1``, LM Studio, llama.cpp). API key optional."""

    name = "local"
    default_base_url = "http://localhost:11434/v1"
    default_model = "llama3.1"
    default_embedding_model = "nomic-embed-text"
    token_param = "max_tokens"  # noqa: S105
