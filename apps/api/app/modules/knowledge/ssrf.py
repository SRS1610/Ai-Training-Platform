"""SSRF-safe URL fetching for knowledge-base URL sources.

* http/https only, no embedded credentials, default/alt web ports only;
* every hostname is resolved and *all* resulting addresses must be public — private, loopback, link-local
  (incl. 169.254.169.254 cloud metadata), CGNAT, multicast, reserved, unspecified and IPv4-mapped/NAT64
  forms of those are rejected; well-known internal hostnames are blocked by name;
* redirects are followed manually (max 3) and every hop is re-validated;
* responses are streamed with a hard byte cap and a total timeout; only document content types are accepted.

Residual risk: a DNS answer could change between validation and connect (rebinding) when no egress proxy is
used; production deployments should route this traffic through the egress proxy / a deny-by-default
network policy as a second layer.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx

from app.core.errors import BadRequest

MAX_BYTES = 5 * 1024 * 1024
TIMEOUT_SECONDS = 15.0
MAX_REDIRECTS = 3
ALLOWED_PORTS = {None, 80, 443, 8080, 8443}
BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "metadata",
    "metadata.google.internal",
    "metadata.goog",
    "instance-data",
    "instance-data.ec2.internal",
    "kubernetes.default",
    "kubernetes.default.svc",
}
BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".svc", ".cluster.local", ".home.arpa")
ALLOWED_CONTENT_TYPES = {
    "text/html",
    "application/xhtml+xml",
    "text/plain",
    "text/markdown",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/octet-stream",
}
_EXTRA_BLOCKED = [
    ipaddress.ip_network(n)
    for n in (
        "100.64.0.0/10",
        "192.0.0.0/24",
        "198.18.0.0/15",
        "64:ff9b::/96",
        "64:ff9b:1::/48",
        "fd00:ec2::/32",
    )
]


class UnsafeURL(BadRequest):
    code = "unsafe_url"


@dataclass
class FetchResult:
    content: bytes
    content_type: str
    final_url: str


def ip_is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return ip_is_blocked(ip.ipv4_mapped)
        if ip.sixtofour is not None and ip_is_blocked(ip.sixtofour):
            return True
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or not ip.is_global
        or any(ip in n for n in _EXTRA_BLOCKED)
    )


def validate_url(url: str) -> tuple[str, int | None]:
    """Syntactic checks. Returns (hostname, port)."""
    try:
        parts = urlsplit((url or "").strip())
        port = parts.port
    except ValueError as exc:
        raise UnsafeURL("Invalid URL") from exc
    if parts.scheme not in ("http", "https"):
        raise UnsafeURL("Only http and https URLs are allowed")
    if parts.username or parts.password:
        raise UnsafeURL("URLs with embedded credentials are not allowed")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host:
        raise UnsafeURL("URL has no host")
    if port not in ALLOWED_PORTS:
        raise UnsafeURL("Only standard web ports are allowed")
    if host in BLOCKED_HOSTNAMES or host.endswith(BLOCKED_SUFFIXES):
        raise UnsafeURL("This host is not allowed")
    return host, port


async def resolve_host(host: str, port: int | None) -> list[str]:
    """DNS resolution (monkeypatched in tests)."""
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port or 443, type=socket.SOCK_STREAM)
    return sorted({info[4][0] for info in infos})


async def check_url(url: str) -> None:
    host, port = validate_url(url)
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        addresses = [str(literal)]
    else:
        try:
            addresses = await resolve_host(host, port)
        except (OSError, UnicodeError) as exc:
            raise UnsafeURL("The URL's host could not be resolved") from exc
    if not addresses:
        raise UnsafeURL("The URL's host could not be resolved")
    for a in addresses:
        try:
            ip = ipaddress.ip_address(a.split("%")[0])
        except ValueError as exc:
            raise UnsafeURL("The URL resolved to an invalid address") from exc
        if ip_is_blocked(ip):
            raise UnsafeURL("The URL points to a private or internal network address")


# Tests inject an httpx.MockTransport here.
fetch_transport: httpx.AsyncBaseTransport | None = None


async def safe_fetch(
    url: str,
    *,
    max_bytes: int = MAX_BYTES,
    timeout: float = TIMEOUT_SECONDS,  # noqa: ASYNC109
    max_redirects: int = MAX_REDIRECTS,
) -> FetchResult:
    current = url
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(timeout),
        follow_redirects=False,
        transport=fetch_transport,
        headers={
            "User-Agent": "PraxisKnowledgeBot/1.0 (+knowledge ingestion)",
            "Accept": "text/html,application/pdf,text/plain,*/*;q=0.5",
        },
    ) as client:
        for _ in range(max_redirects + 1):
            await check_url(current)
            async with asyncio.timeout(timeout):
                async with client.stream("GET", current) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308):
                        loc = resp.headers.get("location")
                        if not loc:
                            raise BadRequest("Redirect without location")
                        current = urljoin(current, loc)
                        continue
                    if resp.status_code >= 400:
                        raise BadRequest(f"The URL returned HTTP {resp.status_code}", code="fetch_failed")
                    ctype = (
                        resp.headers.get("content-type", "application/octet-stream")
                        .split(";")[0]
                        .strip()
                        .lower()
                    )
                    if ctype not in ALLOWED_CONTENT_TYPES:
                        raise BadRequest(f"Unsupported content type '{ctype}'", code="unsupported_content")
                    length = resp.headers.get("content-length")
                    if length and length.isdigit() and int(length) > max_bytes:
                        raise BadRequest("The document is too large", code="too_large")
                    buf = bytearray()
                    async for chunk in resp.aiter_bytes():
                        buf.extend(chunk)
                        if len(buf) > max_bytes:
                            raise BadRequest("The document is too large", code="too_large")
                    return FetchResult(bytes(buf), ctype, current)
    raise BadRequest("Too many redirects", code="fetch_failed")
