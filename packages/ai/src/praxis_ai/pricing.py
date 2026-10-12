"""Model pricing table, token estimation and cost estimation.

Prices are USD per 1M tokens (input, output). Lookups match the exact model id first, then the longest
known prefix (so dated/suffixed deployments resolve), then a conservative default so unknown models are
never treated as free.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ModelPrice:
    input_per_m: float
    output_per_m: float


PRICES: dict[str, ModelPrice] = {
    # OpenAI chat
    "gpt-4o-mini": ModelPrice(0.15, 0.60),
    "gpt-4o": ModelPrice(2.50, 10.00),
    "gpt-4.1-nano": ModelPrice(0.10, 0.40),
    "gpt-4.1-mini": ModelPrice(0.40, 1.60),
    "gpt-4.1": ModelPrice(2.00, 8.00),
    "gpt-5-nano": ModelPrice(0.05, 0.40),
    "gpt-5-mini": ModelPrice(0.25, 2.00),
    "gpt-5": ModelPrice(1.25, 10.00),
    "o4-mini": ModelPrice(1.10, 4.40),
    # OpenAI embeddings (input only)
    "text-embedding-3-small": ModelPrice(0.02, 0.0),
    "text-embedding-3-large": ModelPrice(0.13, 0.0),
    "text-embedding-ada-002": ModelPrice(0.10, 0.0),
    "omni-moderation-latest": ModelPrice(0.0, 0.0),
    # Anthropic (first-party API rates)
    "claude-fable-5-1": ModelPrice(10.00, 50.00),
    "claude-fable-5": ModelPrice(10.00, 50.00),
    "claude-opus-5-5": ModelPrice(4.00, 20.00),
    "claude-opus-5": ModelPrice(5.00, 25.00),
    "claude-opus-4-8": ModelPrice(5.00, 25.00),
    "claude-opus-4-7": ModelPrice(5.00, 25.00),
    "claude-opus-4-6": ModelPrice(5.00, 25.00),
    "claude-sonnet-5-5": ModelPrice(2.00, 10.00),
    "claude-sonnet-5": ModelPrice(2.00, 10.00),
    "claude-sonnet-4-6": ModelPrice(3.00, 15.00),
    "claude-haiku-5-5": ModelPrice(0.10, 0.50),
    "claude-haiku-4-5": ModelPrice(1.00, 5.00),
    # Google Gemini
    "gemini-2.5-pro": ModelPrice(1.25, 10.00),
    "gemini-2.5-flash": ModelPrice(0.30, 2.50),
    "gemini-2.0-flash": ModelPrice(0.10, 0.40),
    "text-embedding-004": ModelPrice(0.0, 0.0),
    "gemini-embedding-001": ModelPrice(0.15, 0.0),
    # Offline / local models are free to run (infrastructure cost is outside the ledger)
    "offline-demo": ModelPrice(0.0, 0.0),
    "offline-hash-embedding": ModelPrice(0.0, 0.0),
}

DEFAULT_PRICE = ModelPrice(3.00, 15.00)
FREE_PROVIDERS = {"offline", "local"}


def price_for(model: str, provider: str | None = None) -> ModelPrice:
    if provider in FREE_PROVIDERS:
        return ModelPrice(0.0, 0.0)
    key = (model or "").lower().strip()
    if key in PRICES:
        return PRICES[key]
    candidates = [k for k in PRICES if key.startswith(k)]
    if candidates:
        return PRICES[max(candidates, key=len)]
    return DEFAULT_PRICE


def estimate_cost(model: str, tokens_in: int, tokens_out: int, provider: str | None = None) -> float:
    """USD cost for a call, rounded to 6 decimals (the ledger's precision)."""
    p = price_for(model, provider)
    return round((tokens_in * p.input_per_m + tokens_out * p.output_per_m) / 1_000_000, 6)


_WORD = re.compile(r"\w+|[^\w\s]", re.UNICODE)


def estimate_tokens(text: str) -> int:
    """Provider-agnostic token estimate (≈ BPE token counts for English prose and code).

    Uses the larger of a character heuristic (≈4 chars/token) and a word heuristic (≈1.3 tokens per word
    piece) so both dense code and short words are not underestimated."""
    if not text:
        return 0
    by_chars = len(text) / 4.0
    by_words = len(_WORD.findall(text)) * 0.75 + text.count("\n") * 0.25
    return max(1, int(math.ceil(max(by_chars, by_words))))


def estimate_messages_tokens(messages: list[dict] | list) -> int:
    total = 0
    for m in messages:
        content = m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")
        total += estimate_tokens(str(content)) + 4  # per-message framing overhead
    return total + 2
