"""Google Gemini REST API: ``models/{model}:generateContent`` and ``models/{model}:batchEmbedContents``."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from praxis_ai.providers.base import AIProvider
from praxis_ai.results import ChatMessage, ChatResult, EmbeddingResult, ProviderError

_FINISH = {
    "STOP": "stop",
    "MAX_TOKENS": "length",
    "SAFETY": "content_filter",
    "RECITATION": "content_filter",
    "PROHIBITED_CONTENT": "content_filter",
    "BLOCKLIST": "content_filter",
}


class GoogleProvider(AIProvider):
    name = "google"
    default_base_url = "https://generativelanguage.googleapis.com/v1beta"
    default_model = "gemini-2.0-flash"
    default_embedding_model = "text-embedding-004"

    def __init__(self, **kw: Any) -> None:
        super().__init__(**kw)
        self.base_url = self.base_url or self.default_base_url

    def _headers(self) -> dict[str, str]:
        return {"x-goog-api-key": self.api_key or "", "Content-Type": "application/json"}

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
        msgs = self.coerce(messages)
        system = "\n\n".join(m.content for m in msgs if m.role == "system")
        contents: list[dict[str, Any]] = []
        for m in msgs:
            if m.role == "system":
                continue
            role = "model" if m.role == "assistant" else "user"
            if contents and contents[-1]["role"] == role:
                contents[-1]["parts"].append({"text": m.content})
            else:
                contents.append({"role": role, "parts": [{"text": m.content}]})
        if not contents:
            contents = [{"role": "user", "parts": [{"text": ""}]}]
        gen: dict[str, Any] = {}
        if temperature is not None:
            gen["temperature"] = temperature
        if max_tokens:
            gen["maxOutputTokens"] = max_tokens
        if json_mode:
            gen["responseMimeType"] = "application/json"
        body: dict[str, Any] = {"contents": contents, "generationConfig": gen}
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        data = await self._post_json(
            f"{self.base_url}/models/{model}:generateContent", headers=self._headers(), body=body
        )
        cands = data.get("candidates") or []
        if not cands:
            block = (data.get("promptFeedback") or {}).get("blockReason")
            if block:
                return ChatResult(
                    text="",
                    tokens_in=0,
                    tokens_out=0,
                    model=model,
                    provider=self.name,
                    finish_reason="content_filter",
                    raw=data,
                )
            raise ProviderError("google: response had no candidates", provider=self.name)
        parts = ((cands[0].get("content") or {}).get("parts")) or []
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))
        usage = data.get("usageMetadata") or {}
        return ChatResult(
            text=text,
            tokens_in=int(usage.get("promptTokenCount") or 0),
            tokens_out=int(usage.get("candidatesTokenCount") or 0)
            + int(usage.get("thoughtsTokenCount") or 0),
            model=data.get("modelVersion") or model,
            provider=self.name,
            finish_reason=_FINISH.get(cands[0].get("finishReason") or "STOP", "stop"),
            raw=data,
        )

    async def embed(self, texts: list[str], *, model: str | None = None) -> EmbeddingResult:
        model = model or self.default_embedding_model or "text-embedding-004"
        requests = [
            {
                "model": f"models/{model}",
                "content": {"parts": [{"text": t}]},
                "outputDimensionality": self.embedding_dim,
            }
            for t in texts
        ]
        data = await self._post_json(
            f"{self.base_url}/models/{model}:batchEmbedContents",
            headers=self._headers(),
            body={"requests": requests},
        )
        try:
            vectors = [list(map(float, e["values"])) for e in data["embeddings"]]
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("google: unexpected embeddings response", provider=self.name) from exc
        if len(vectors) != len(texts):
            raise ProviderError("google: embedding count mismatch", provider=self.name)
        return EmbeddingResult(vectors=vectors, model=model, provider=self.name)
