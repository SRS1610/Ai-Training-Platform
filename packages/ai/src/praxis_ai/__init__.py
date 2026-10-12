"""Praxis AI domain package (framework-free).

Modules:
  providers   AIProvider interface + OpenAI / Anthropic / Azure OpenAI / Google / local / offline
  pricing     model price table, cost + token estimation
  chunking    heading-aware chunker
  extract     PDF / DOCX / PPTX / HTML / text extraction
  safety      prompt-injection detection, output leak screening, moderation
  prompts     prompt templates + prompt-isolation protocol (task markers, DATA / UNTRUSTED blocks)
  generation  generation output schemas, schema hints and deterministic templates
  grading     explainable heuristic grading
  planning    deterministic personalised study plans
  jsonutil    tolerant JSON parsing/repair
  text        tokenising, overlap scoring, hashing-trick embeddings
"""

from praxis_ai.providers import PROVIDERS, AIProvider, OfflineProvider, create_provider
from praxis_ai.results import ChatMessage, ChatResult, EmbeddingResult, ProviderAuthError, ProviderError

__version__ = "0.1.0"
__all__ = [
    "PROVIDERS",
    "AIProvider",
    "ChatMessage",
    "ChatResult",
    "EmbeddingResult",
    "OfflineProvider",
    "ProviderAuthError",
    "ProviderError",
    "create_provider",
]
