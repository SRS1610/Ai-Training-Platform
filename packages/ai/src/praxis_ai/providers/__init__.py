"""Provider implementations and a small factory."""

from __future__ import annotations

from typing import Any

from praxis_ai.providers.anthropic import AnthropicProvider
from praxis_ai.providers.base import AIProvider
from praxis_ai.providers.google import GoogleProvider
from praxis_ai.providers.offline import OFFLINE_EMBEDDING_MODEL, OFFLINE_MODEL, OfflineProvider
from praxis_ai.providers.openai import AzureOpenAIProvider, LocalModelProvider, OpenAIProvider

PROVIDERS: dict[str, type[AIProvider]] = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "azure_openai": AzureOpenAIProvider,
    "local": LocalModelProvider,
    "google": GoogleProvider,
    "offline": OfflineProvider,
}

PROVIDER_LABELS = {
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "azure_openai": "Azure OpenAI",
    "local": "Local (OpenAI-compatible)",
    "google": "Google Gemini",
    "offline": "Offline demo",
}


def create_provider(name: str, **kwargs: Any) -> AIProvider:
    try:
        cls = PROVIDERS[name]
    except KeyError as exc:
        raise ValueError(f"Unknown AI provider '{name}'") from exc
    return cls(**kwargs)


__all__ = [
    "AIProvider",
    "AnthropicProvider",
    "AzureOpenAIProvider",
    "GoogleProvider",
    "LocalModelProvider",
    "OFFLINE_EMBEDDING_MODEL",
    "OFFLINE_MODEL",
    "OfflineProvider",
    "OpenAIProvider",
    "PROVIDERS",
    "PROVIDER_LABELS",
    "create_provider",
]
