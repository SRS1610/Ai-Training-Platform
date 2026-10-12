"""Anthropic Messages API (``POST /v1/messages``, ``x-api-key``, ``anthropic-version: 2023-06-01``)."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from praxis_ai.providers.base import JSON_INSTRUCTION, AIProvider
from praxis_ai.results import ChatMessage, ChatResult, ProviderError

ANTHROPIC_VERSION = "2023-06-01"
# Sampling parameters (temperature) are only accepted by older model families; newer models reject
# non-default values, so the provider omits them there.
_SAMPLING_OK = re.compile(r"^claude-(3|opus-4-[0-6]\b|opus-4-[0-6]-|opus-4$|sonnet-4|haiku-4)")


class AnthropicProvider(AIProvider):
    name = "anthropic"
    default_base_url = "https://api.anthropic.com/v1"
    default_model = "claude-sonnet-5-5"
    supports_embeddings = False  # Anthropic has no embeddings endpoint; the gateway uses another provider.

    def __init__(self, **kw: Any) -> None:
        super().__init__(**kw)
        self.base_url = self.base_url or self.default_base_url

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self.api_key or "",
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

    @staticmethod
    def _convert(messages: list[ChatMessage]) -> tuple[str, list[dict[str, Any]]]:
        system_parts = [m.content for m in messages if m.role == "system"]
        turns: list[dict[str, Any]] = []
        for m in messages:
            if m.role == "system":
                continue
            if turns and turns[-1]["role"] == m.role:
                turns[-1]["content"] += "\n\n" + m.content
            else:
                turns.append({"role": m.role, "content": m.content})
        if not turns or turns[0]["role"] != "user":
            turns.insert(0, {"role": "user", "content": "(conversation start)"})
        # The final turn must be the user's (no assistant prefill on current models).
        if turns[-1]["role"] == "assistant":
            turns.append({"role": "user", "content": "Please continue."})
        return "\n\n".join(system_parts), turns

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
        system, turns = self._convert(self.coerce(messages))
        if json_mode:
            system = f"{system}\n\n{JSON_INSTRUCTION}".strip()
        body: dict[str, Any] = {"model": model, "max_tokens": max_tokens or 1024, "messages": turns}
        if system:
            body["system"] = system
        if temperature is not None and _SAMPLING_OK.match(model):
            body["temperature"] = temperature
        data = await self._post_json(f"{self.base_url}/messages", headers=self._headers(), body=body)
        blocks = data.get("content")
        if not isinstance(blocks, list):
            raise ProviderError("anthropic: unexpected response shape", provider=self.name)
        text = "".join(b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text")
        usage = data.get("usage") or {}
        stop = data.get("stop_reason") or "end_turn"
        finish = {
            "end_turn": "stop",
            "stop_sequence": "stop",
            "max_tokens": "length",
            "refusal": "refusal",
        }.get(stop, stop)
        return ChatResult(
            text=text,
            tokens_in=int(usage.get("input_tokens") or 0)
            + int(usage.get("cache_read_input_tokens") or 0)
            + int(usage.get("cache_creation_input_tokens") or 0),
            tokens_out=int(usage.get("output_tokens") or 0),
            model=data.get("model") or model,
            provider=self.name,
            finish_reason=finish,
            raw=data,
        )
