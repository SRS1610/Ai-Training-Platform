"""client_ip trusts only the configured number of proxies in X-Forwarded-For."""

from __future__ import annotations

import pytest
from starlette.requests import Request

from app.core import middleware
from app.core.config import settings


def _req(xff: str | None, peer: str = "10.0.0.9") -> Request:
    headers = [(b"x-forwarded-for", xff.encode())] if xff is not None else []
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


@pytest.mark.parametrize(
    ("hops", "xff", "expected"),
    [
        (1, "203.0.113.7", "203.0.113.7"),  # load balancer appended the real client
        (1, "6.6.6.6, 203.0.113.7", "203.0.113.7"),  # caller-forged entry on the left is ignored
        (2, "6.6.6.6, 203.0.113.7, 172.70.1.1", "203.0.113.7"),  # Cloudflare then the load balancer
        (2, "203.0.113.7", "203.0.113.7"),  # shorter chain than expected: leftmost
        (0, "6.6.6.6", "10.0.0.9"),  # header ignored entirely
        (1, None, "10.0.0.9"),  # no proxy: the socket peer
        (1, " , ", "10.0.0.9"),  # empty header
    ],
)
def test_client_ip(monkeypatch, hops, xff, expected):
    monkeypatch.setattr(settings, "FORWARDED_TRUSTED_HOPS", hops)
    assert middleware.client_ip(_req(xff)) == expected
