"""Real provider wire formats, exercised with httpx.MockTransport (no network)."""

from __future__ import annotations

import json

import httpx
import pytest

from praxis_ai.providers import (
    AnthropicProvider,
    AzureOpenAIProvider,
    GoogleProvider,
    LocalModelProvider,
    OpenAIProvider,
    create_provider,
)
from praxis_ai.results import ProviderAuthError, ProviderError, ProviderNotSupported
from praxis_ai.safety import moderate_openai

MSGS = [{"role": "system", "content": "Be brief."}, {"role": "user", "content": "Hi"}]


class Recorder:
    def __init__(self, *responses: httpx.Response) -> None:
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]

    @property
    def body(self) -> dict:
        return json.loads(self.requests[-1].content)


def transport(rec: Recorder) -> httpx.MockTransport:
    return httpx.MockTransport(rec)


OPENAI_CHAT = {
    "id": "x",
    "model": "gpt-4o-mini-2024-07-18",
    "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello!"}, "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15},
}


async def test_openai_chat_wire_format():
    rec = Recorder(httpx.Response(200, json=OPENAI_CHAT))
    p = OpenAIProvider(api_key="sk-test", transport=transport(rec))
    r = await p.chat(MSGS, model="gpt-4o-mini", temperature=0.2, max_tokens=50, json_mode=True)
    req = rec.requests[0]
    assert str(req.url) == "https://api.openai.com/v1/chat/completions"
    assert req.headers["authorization"] == "Bearer sk-test"
    body = rec.body
    assert body["model"] == "gpt-4o-mini" and body["temperature"] == 0.2
    assert body["max_completion_tokens"] == 50
    assert body["response_format"] == {"type": "json_object"}
    assert any("JSON" in m["content"] for m in body["messages"])  # API requires the word JSON
    assert (r.text, r.tokens_in, r.tokens_out, r.provider, r.finish_reason) == (
        "Hello!",
        12,
        3,
        "openai",
        "stop",
    )


async def test_openai_reasoning_models_omit_temperature():
    rec = Recorder(httpx.Response(200, json=OPENAI_CHAT))
    await OpenAIProvider(api_key="k", transport=transport(rec)).chat(
        MSGS, model="gpt-5-mini", temperature=0.7
    )
    assert "temperature" not in rec.body


async def test_openai_embeddings_sorted_and_dimensions():
    data = {
        "data": [{"index": 1, "embedding": [0.0, 1.0]}, {"index": 0, "embedding": [1.0, 0.0]}],
        "model": "text-embedding-3-small",
        "usage": {"prompt_tokens": 7, "total_tokens": 7},
    }
    rec = Recorder(httpx.Response(200, json=data))
    p = OpenAIProvider(api_key="k", transport=transport(rec), embedding_dim=2)
    r = await p.embed(["a", "b"], model="text-embedding-3-small")
    assert str(rec.requests[0].url).endswith("/embeddings")
    assert rec.body == {"input": ["a", "b"], "model": "text-embedding-3-small", "dimensions": 2}
    assert r.vectors == [[1.0, 0.0], [0.0, 1.0]] and r.tokens_in == 7


async def test_retry_on_429_then_success():
    rec = Recorder(
        httpx.Response(429, json={"error": {"message": "slow down"}}), httpx.Response(200, json=OPENAI_CHAT)
    )
    p = OpenAIProvider(api_key="k", transport=transport(rec), retry_backoff=0.001)
    r = await p.chat(MSGS)
    assert r.text == "Hello!" and len(rec.requests) == 2


async def test_auth_error_not_retried_and_400_raises():
    rec = Recorder(httpx.Response(401, json={"error": {"message": "bad key"}}))
    with pytest.raises(ProviderAuthError):
        await OpenAIProvider(api_key="k", transport=transport(rec), retry_backoff=0).chat(MSGS)
    assert len(rec.requests) == 1
    rec = Recorder(httpx.Response(400, json={"error": {"message": "bad request"}}))
    with pytest.raises(ProviderError) as ei:
        await OpenAIProvider(api_key="k", transport=transport(rec), retry_backoff=0).chat(MSGS)
    assert ei.value.status == 400 and not ei.value.retryable and "bad request" in str(ei.value)


async def test_persistent_5xx_exhausts_retries():
    rec = Recorder(httpx.Response(503, text="unavailable"))
    with pytest.raises(ProviderError) as ei:
        await OpenAIProvider(api_key="k", transport=transport(rec), retry_backoff=0.001, max_retries=2).chat(
            MSGS
        )
    assert ei.value.retryable and len(rec.requests) == 3


async def test_network_error_maps_to_provider_error():
    def boom(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(ProviderError):
        await OpenAIProvider(api_key="k", transport=httpx.MockTransport(boom), retry_backoff=0.001).chat(MSGS)


ANTHROPIC_RESP = {
    "id": "msg_1",
    "type": "message",
    "role": "assistant",
    "model": "claude-sonnet-5-5",
    "content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": "Hi there"}],
    "stop_reason": "end_turn",
    "usage": {"input_tokens": 20, "output_tokens": 4},
}


async def test_anthropic_messages_wire_format():
    rec = Recorder(httpx.Response(200, json=ANTHROPIC_RESP))
    p = AnthropicProvider(api_key="ak", transport=transport(rec))
    msgs = MSGS + [{"role": "user", "content": "More"}, {"role": "assistant", "content": "ok"}]
    r = await p.chat(msgs, model="claude-sonnet-5-5", temperature=0.4, max_tokens=300, json_mode=True)
    req = rec.requests[0]
    assert str(req.url) == "https://api.anthropic.com/v1/messages"
    assert req.headers["x-api-key"] == "ak" and req.headers["anthropic-version"] == "2023-06-01"
    body = rec.body
    assert body["model"] == "claude-sonnet-5-5" and body["max_tokens"] == 300
    assert body["system"].startswith("Be brief.") and "JSON" in body["system"]
    assert "temperature" not in body  # current models reject non-default sampling params
    # system removed from messages, consecutive user turns merged, conversation ends on a user turn
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user"]
    assert body["messages"][0]["content"] == "Hi\n\nMore"
    assert (r.text, r.tokens_in, r.tokens_out, r.finish_reason) == ("Hi there", 20, 4, "stop")


async def test_anthropic_older_models_get_temperature_and_refusal_maps():
    resp = dict(ANTHROPIC_RESP, stop_reason="refusal", content=[])
    rec = Recorder(httpx.Response(200, json=resp))
    r = await AnthropicProvider(api_key="ak", transport=transport(rec)).chat(
        MSGS, model="claude-haiku-4-5", temperature=0.1
    )
    assert rec.body["temperature"] == 0.1
    assert r.finish_reason == "refusal" and r.text == ""


async def test_anthropic_has_no_embeddings():
    with pytest.raises(ProviderNotSupported):
        await AnthropicProvider(api_key="k").embed(["x"])


async def test_azure_deployment_url_and_headers():
    rec = Recorder(httpx.Response(200, json=OPENAI_CHAT))
    p = AzureOpenAIProvider(
        api_key="az",
        base_url="https://acme.openai.azure.com/",
        api_version="2024-10-21",
        transport=transport(rec),
    )
    await p.chat(MSGS, model="my-gpt4o", max_tokens=10)
    req = rec.requests[0]
    assert req.url.path == "/openai/deployments/my-gpt4o/chat/completions"
    assert req.url.params["api-version"] == "2024-10-21"
    assert req.headers["api-key"] == "az" and "authorization" not in req.headers
    assert "model" not in rec.body and rec.body["max_tokens"] == 10


async def test_azure_requires_endpoint():
    with pytest.raises(ProviderError):
        AzureOpenAIProvider(api_key="az")


async def test_local_openai_compatible_without_key():
    rec = Recorder(httpx.Response(200, json=OPENAI_CHAT))
    p = LocalModelProvider(base_url="http://vllm:8000/v1", transport=transport(rec))
    await p.chat(MSGS, model="llama3.1", max_tokens=5)
    assert str(rec.requests[0].url) == "http://vllm:8000/v1/chat/completions"
    assert "authorization" not in rec.requests[0].headers and rec.body["max_tokens"] == 5


async def test_google_generate_content_and_embeddings():
    resp = {
        "candidates": [
            {"content": {"role": "model", "parts": [{"text": '{"a": 1}'}]}, "finishReason": "STOP"}
        ],
        "usageMetadata": {"promptTokenCount": 9, "candidatesTokenCount": 5},
        "modelVersion": "gemini-2.0-flash",
    }
    rec = Recorder(httpx.Response(200, json=resp))
    p = GoogleProvider(api_key="gk", transport=transport(rec))
    r = await p.chat(
        MSGS + [{"role": "assistant", "content": "a"}, {"role": "user", "content": "b"}],
        model="gemini-2.0-flash",
        temperature=0.2,
        max_tokens=64,
        json_mode=True,
    )
    req = rec.requests[0]
    assert req.url.path == "/v1beta/models/gemini-2.0-flash:generateContent"
    assert req.headers["x-goog-api-key"] == "gk"
    body = rec.body
    assert body["systemInstruction"] == {"parts": [{"text": "Be brief."}]}
    assert [c["role"] for c in body["contents"]] == ["user", "model", "user"]
    assert body["generationConfig"] == {
        "temperature": 0.2,
        "maxOutputTokens": 64,
        "responseMimeType": "application/json",
    }
    assert (r.text, r.tokens_in, r.tokens_out) == ('{"a": 1}', 9, 5)

    rec = Recorder(httpx.Response(200, json={"embeddings": [{"values": [0.1, 0.2]}, {"values": [0.3, 0.4]}]}))
    e = await GoogleProvider(api_key="gk", transport=transport(rec), embedding_dim=2).embed(["x", "y"])
    assert rec.requests[0].url.path.endswith("models/text-embedding-004:batchEmbedContents")
    assert rec.body["requests"][0]["outputDimensionality"] == 2
    assert e.vectors == [[0.1, 0.2], [0.3, 0.4]]


async def test_google_safety_block():
    rec = Recorder(httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}}))
    r = await GoogleProvider(api_key="gk", transport=transport(rec)).chat(MSGS)
    assert r.finish_reason == "content_filter"


async def test_openai_moderation_endpoint_and_fallback():
    rec = Recorder(
        httpx.Response(
            200, json={"results": [{"flagged": True, "categories": {"violence": True, "hate": False}}]}
        )
    )
    m = await moderate_openai("text", api_key="k", transport=transport(rec))
    assert m.flagged and m.categories == ["violence"] and m.source == "openai"
    assert rec.body["model"] == "omni-moderation-latest"
    rec = Recorder(httpx.Response(500, text="x"))
    m = await moderate_openai("I want to kill myself", api_key="k", transport=transport(rec))
    assert m.flagged and m.source == "keywords"


def test_factory():
    assert create_provider("offline").name == "offline"
    with pytest.raises(ValueError):
        create_provider("nope")
