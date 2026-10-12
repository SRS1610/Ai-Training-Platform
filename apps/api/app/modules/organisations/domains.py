"""Domain ownership verification via a DNS TXT record (used for custom domains and SSO email domains).

The expected token is derived (HMAC) from the organisation id and domain, so nothing has to be stored and a
token for one organisation can never verify a domain for another.
"""

from __future__ import annotations

import re
import uuid

import structlog

from app.core import security
from app.core.errors import BadRequest

log = structlog.get_logger(__name__)

RECORD_PREFIX = "_praxis-verification"
DOMAIN_RE = re.compile(r"^(?=.{4,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$")


def normalise_domain(value: str) -> str:
    domain = (value or "").strip().lower().rstrip(".")
    domain = re.sub(r"^https?://", "", domain).split("/")[0]
    if not DOMAIN_RE.match(domain):
        raise BadRequest(f"'{value}' is not a valid domain name", code="invalid_domain")
    return domain


def verification_token(org_id: uuid.UUID, domain: str) -> str:
    return security.sign_payload("domain-verification", str(org_id), domain)[:40]


def record_name(domain: str) -> str:
    return f"{RECORD_PREFIX}.{domain}"


def record_value(org_id: uuid.UUID, domain: str) -> str:
    return f"praxis-verification={verification_token(org_id, domain)}"


def instructions(org_id: uuid.UUID, domain: str) -> dict[str, str]:
    return {
        "record_type": "TXT",
        "record_name": record_name(domain),
        "record_value": record_value(org_id, domain),
        "instructions": (
            f"Add a DNS TXT record named '{record_name(domain)}' with the value "
            f"'{record_value(org_id, domain)}', then click Verify. DNS changes can take up to "
            "48 hours to propagate."
        ),
    }


async def lookup_txt(name: str) -> list[str] | None:
    """TXT strings at ``name``; [] when the name has no TXT records; None when DNS is unavailable."""
    try:
        import dns.asyncresolver
        import dns.exception
        import dns.resolver
    except ImportError:  # pragma: no cover - dnspython is a declared dependency
        return None
    try:
        answer = await dns.asyncresolver.resolve(name, "TXT", lifetime=5.0)
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return []
    except dns.exception.DNSException as exc:
        log.warning("dns.lookup_failed", name=name, error=str(exc))
        return None
    values: list[str] = []
    for rdata in answer:
        values.append(b"".join(rdata.strings).decode(errors="replace"))
    return values


async def check(org_id: uuid.UUID, domain: str) -> str:
    """Return ``verified`` | ``pending`` (record missing/mismatched) | ``unavailable`` (DNS error)."""
    records = await lookup_txt(record_name(domain))
    if records is None:
        return "unavailable"
    expected = record_value(org_id, domain)
    return "verified" if any(r.strip() == expected for r in records) else "pending"
