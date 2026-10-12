"""Enterprise SSO connections (OIDC implemented end-to-end; SAML metadata stored for the SAML adapter).

Security notes:
* Client secrets are encrypted at rest (Fernet) and never returned.
* Email domains drive SSO discovery and enforcement at login, so an organisation must prove ownership of a
  domain (DNS TXT record, or its verified custom domain) before it becomes active. Unverified domains are
  kept in ``config.pending_domains``; consumer mail domains can never be claimed.
"""

from __future__ import annotations

import uuid
from typing import Any

import httpx
from sqlalchemy import select

from app.auth.deps import Ctx
from app.core import security
from app.core.config import settings
from app.core.errors import BadRequest, Conflict, NotFound
from app.models.tenancy import Role, SSOConnection
from app.modules.billing import plans
from app.modules.organisations import domains
from app.modules.sso.schemas import (
    DomainVerification,
    OIDCConfigIn,
    SAMLConfigIn,
    SSOCreate,
    SSOOut,
    SSOTestResult,
    SSOUpdate,
)

PUBLIC_EMAIL_DOMAINS = {
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "yahoo.com",
    "yahoo.com.au",
    "icloud.com",
    "me.com",
    "mac.com",
    "aol.com",
    "proton.me",
    "protonmail.com",
    "gmx.com",
    "gmx.de",
    "mail.com",
    "yandex.com",
    "zoho.com",
    "bigpond.com",
    "optusnet.com.au",
    "fastmail.com",
    "hey.com",
}


def ensure_enabled(ctx: Ctx) -> None:
    plans.require_feature(ctx.org, "sso")


def _check_url(url: str) -> str:
    url = str(url).rstrip("/")
    if settings.is_production and not url.startswith("https://"):
        raise BadRequest("Identity provider URLs must use HTTPS", code="insecure_url")
    return url


def _validate_cert(pem: str) -> str:
    from cryptography import x509

    text = pem.strip()
    if "BEGIN CERTIFICATE" not in text:  # accept bare base64 bodies as exported by many IdPs
        text = f"-----BEGIN CERTIFICATE-----\n{text}\n-----END CERTIFICATE-----"
    try:
        x509.load_pem_x509_certificate(text.encode())
    except ValueError as exc:
        raise BadRequest("x509_cert is not a valid PEM certificate", code="invalid_certificate") from exc
    return text


def _oidc_config(existing: dict[str, Any], cfg: OIDCConfigIn) -> dict[str, Any]:
    out = {
        "issuer": _check_url(str(cfg.issuer)),
        "client_id": cfg.client_id.strip(),
        "scopes": cfg.scopes.strip(),
    }
    if cfg.client_secret:
        out["client_secret_encrypted"] = security.encrypt_str(cfg.client_secret)
    elif existing.get("client_secret_encrypted"):
        out["client_secret_encrypted"] = existing["client_secret_encrypted"]
    else:
        raise BadRequest("client_secret is required for OIDC connections", code="client_secret_required")
    return out


def _saml_config(cfg: SAMLConfigIn) -> dict[str, Any]:
    return {
        "idp_entity_id": cfg.idp_entity_id.strip(),
        "sso_url": _check_url(str(cfg.sso_url)),
        "x509_cert": _validate_cert(cfg.x509_cert),
        "requires_saml_adapter": True,
    }


async def _validate_role(ctx: Ctx, key: str) -> None:
    if key == "org_admin":
        raise BadRequest(
            "SSO users cannot be auto-provisioned as organisation admins", code="invalid_default_role"
        )
    if not await ctx.db.scalar(select(Role.id).where(Role.organisation_id == ctx.org_id, Role.key == key)):
        raise BadRequest(f"Unknown role: {key}", code="unknown_role")


def _auto_verified(ctx: Ctx, domain: str) -> bool:
    org = ctx.org
    if ctx.principal.is_superadmin:
        return True
    cd = org.custom_domain
    return bool(
        cd
        and org.custom_domain_verified_at
        and (domain == cd or cd.endswith("." + domain) or domain.endswith("." + cd))
    )


async def _split_domains(
    ctx: Ctx, conn: SSOConnection | None, requested: list[str]
) -> tuple[list[str], list[str]]:
    """Return (verified, pending) for the requested domain list."""
    normalised: list[str] = []
    for raw in requested:
        d = domains.normalise_domain(raw)
        if d in PUBLIC_EMAIL_DOMAINS:
            raise BadRequest(
                f"{d} is a public email provider and cannot be used for SSO", code="public_domain"
            )
        if d not in normalised:
            normalised.append(d)
    others = (
        (await ctx.db.execute(select(SSOConnection).where(SSOConnection.organisation_id != ctx.org_id)))
        .scalars()
        .all()
    )
    claimed = {d for c in others for d in (c.email_domains or [])}
    taken = [d for d in normalised if d in claimed]
    if taken:
        raise Conflict(
            "Domain already linked to another organisation's SSO",
            code="domain_taken",
            details={"domains": taken},
        )
    previously_verified = set(conn.email_domains or []) if conn else set()
    verified = [d for d in normalised if d in previously_verified or _auto_verified(ctx, d)]
    pending = [d for d in normalised if d not in verified]
    return verified, pending


def to_out(conn: SSOConnection) -> SSOOut:
    cfg = dict(conn.config or {})
    pending = list(cfg.pop("pending_domains", []) or [])
    has_secret = bool(cfg.pop("client_secret_encrypted", None))
    safe = {k: v for k, v in cfg.items() if k != "requires_saml_adapter"}
    if conn.protocol == "oidc":
        safe["has_client_secret"] = has_secret
    dom = [DomainVerification(domain=d, verified=True) for d in conn.email_domains or []]
    for d in pending:
        dom.append(
            DomainVerification(
                domain=d,
                verified=False,
                record_name=domains.record_name(d),
                record_value=domains.record_value(conn.organisation_id, d),
            )
        )
    oidc = conn.protocol == "oidc"
    return SSOOut(
        id=conn.id,
        protocol=conn.protocol,
        name=conn.name,
        email_domains=list(conn.email_domains or []),
        pending_domains=pending,
        domains=dom,
        enforce_sso=conn.enforce_sso,
        default_role_key=conn.default_role_key,
        enabled=conn.enabled,
        config=safe,
        requires_saml_adapter=conn.protocol == "saml",
        login_url=f"{settings.API_PREFIX}/auth/oauth/sso-{conn.id}/authorize" if oidc else None,
        callback_url=f"{settings.PUBLIC_WEB_URL}/api/v1/auth/oauth/sso-{conn.id}/callback" if oidc else None,
        created_at=conn.created_at,
        updated_at=conn.updated_at,
    )


async def get_connection(ctx: Ctx, conn_id: uuid.UUID) -> SSOConnection:
    conn = await ctx.db.scalar(
        select(SSOConnection).where(SSOConnection.id == conn_id, SSOConnection.organisation_id == ctx.org_id)
    )
    if conn is None:
        raise NotFound("SSO connection not found")
    return conn


async def list_connections(ctx: Ctx) -> list[SSOConnection]:
    ensure_enabled(ctx)
    return list(
        (
            await ctx.db.execute(
                select(SSOConnection)
                .where(SSOConnection.organisation_id == ctx.org_id)
                .order_by(SSOConnection.created_at)
            )
        )
        .scalars()
        .all()
    )


async def create_connection(ctx: Ctx, body: SSOCreate) -> SSOConnection:
    ensure_enabled(ctx)
    if body.protocol == "oidc":
        if not body.oidc:
            raise BadRequest("OIDC settings are required", code="oidc_required")
        config = _oidc_config({}, body.oidc)
    else:
        if not body.saml:
            raise BadRequest("SAML settings are required", code="saml_required")
        config = _saml_config(body.saml)
    await _validate_role(ctx, body.default_role_key)
    verified, pending = await _split_domains(ctx, None, body.email_domains)
    config["pending_domains"] = pending
    conn = SSOConnection(
        organisation_id=ctx.org_id,
        protocol=body.protocol,
        name=body.name.strip(),
        email_domains=verified,
        config=config,
        default_role_key=body.default_role_key,
        enforce_sso=body.enforce_sso,
        enabled=body.enabled,
    )
    ctx.db.add(conn)
    await ctx.db.flush()
    await ctx.db.refresh(conn)
    await ctx.audit(
        "sso.connection_created",
        "sso_connection",
        conn.id,
        protocol=conn.protocol,
        name=conn.name,
        domains=verified,
        pending_domains=pending,
        enforce_sso=conn.enforce_sso,
    )
    return conn


async def update_connection(ctx: Ctx, conn_id: uuid.UUID, body: SSOUpdate) -> SSOConnection:
    ensure_enabled(ctx)
    conn = await get_connection(ctx, conn_id)
    data = body.model_dump(exclude_unset=True)
    config = dict(conn.config or {})
    changed: list[str] = []
    if body.oidc is not None:
        if conn.protocol != "oidc":
            raise BadRequest("This is not an OIDC connection", code="protocol_mismatch")
        config.update(_oidc_config(config, body.oidc))
        changed.append("oidc" + ("+secret" if body.oidc.client_secret else ""))
    if body.saml is not None:
        if conn.protocol != "saml":
            raise BadRequest("This is not a SAML connection", code="protocol_mismatch")
        config.update(_saml_config(body.saml))
        changed.append("saml")
    if data.get("email_domains") is not None:
        verified, pending = await _split_domains(ctx, conn, data["email_domains"])
        conn.email_domains = verified
        config["pending_domains"] = pending
        changed.append("email_domains")
    if data.get("default_role_key") is not None:
        await _validate_role(ctx, data["default_role_key"])
        conn.default_role_key = data["default_role_key"]
        changed.append("default_role_key")
    for field in ("name", "enforce_sso", "enabled"):
        if data.get(field) is not None:
            setattr(conn, field, data[field])
            changed.append(field)
    conn.config = config
    await ctx.db.flush()
    await ctx.db.refresh(conn)
    if changed:
        await ctx.audit(
            "sso.connection_updated",
            "sso_connection",
            conn.id,
            fields=changed,
            enforce_sso=conn.enforce_sso,
            enabled=conn.enabled,
        )
    return conn


async def delete_connection(ctx: Ctx, conn_id: uuid.UUID) -> None:
    ensure_enabled(ctx)
    conn = await get_connection(ctx, conn_id)
    await ctx.audit("sso.connection_deleted", "sso_connection", conn.id, name=conn.name)
    await ctx.db.delete(conn)
    await ctx.db.flush()


async def verify_domains(ctx: Ctx, conn_id: uuid.UUID) -> SSOConnection:
    ensure_enabled(ctx)
    conn = await get_connection(ctx, conn_id)
    config = dict(conn.config or {})
    pending = list(config.get("pending_domains") or [])
    newly: list[str] = []
    for d in pending:
        if await domains.check(ctx.org_id, d) == "verified":
            newly.append(d)
    if newly:
        others = (
            (await ctx.db.execute(select(SSOConnection).where(SSOConnection.organisation_id != ctx.org_id)))
            .scalars()
            .all()
        )
        claimed = {d for c in others for d in (c.email_domains or [])}
        newly = [d for d in newly if d not in claimed]
        conn.email_domains = [*(conn.email_domains or []), *newly]
        config["pending_domains"] = [d for d in pending if d not in newly]
        conn.config = config
        await ctx.db.flush()
        await ctx.db.refresh(conn)
        await ctx.audit("sso.domains_verified", "sso_connection", conn.id, domains=newly)
    return conn


async def fetch_discovery(issuer: str) -> tuple[int, dict[str, Any]]:
    """Fetch the OIDC discovery document (module-level so it can be stubbed in tests)."""
    async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
        resp = await client.get(f"{issuer.rstrip('/')}/.well-known/openid-configuration")
        try:
            body = resp.json()
        except ValueError:
            body = {}
        return resp.status_code, body if isinstance(body, dict) else {}


async def test_connection(ctx: Ctx, conn_id: uuid.UUID) -> SSOTestResult:
    ensure_enabled(ctx)
    conn = await get_connection(ctx, conn_id)
    cfg = conn.config or {}
    if conn.protocol == "saml":
        try:
            _validate_cert(cfg.get("x509_cert", ""))
        except BadRequest as exc:
            return SSOTestResult(ok=False, protocol="saml", message=exc.message)
        return SSOTestResult(
            ok=True,
            protocol="saml",
            message="SAML configuration is well-formed. SAML sign-in requires the SAML adapter "
            "(python3-saml/xmlsec) to be enabled for this deployment.",
            details={"requires_saml_adapter": True, "sso_url": cfg.get("sso_url")},
        )
    issuer = str(cfg.get("issuer", "")).rstrip("/")
    try:
        status, doc = await fetch_discovery(issuer)
    except httpx.HTTPError as exc:
        return SSOTestResult(
            ok=False,
            protocol="oidc",
            message=f"Could not reach the identity provider: {type(exc).__name__}",
            details={"issuer": issuer},
        )
    if status != 200:
        return SSOTestResult(
            ok=False,
            protocol="oidc",
            message=f"Discovery document returned HTTP {status}",
            details={"issuer": issuer},
        )
    required = ("authorization_endpoint", "token_endpoint", "userinfo_endpoint")
    missing = [k for k in required if not doc.get(k)]
    problems = []
    if missing:
        problems.append(f"missing {', '.join(missing)}")
    if str(doc.get("issuer", "")).rstrip("/") != issuer:
        problems.append("issuer in discovery document does not match the configured issuer")
    if not cfg.get("client_secret_encrypted"):
        problems.append("client secret is not set")
    details = {
        "issuer": issuer,
        **{k: doc.get(k) for k in required},
        "scopes_supported": doc.get("scopes_supported"),
    }
    if problems:
        return SSOTestResult(
            ok=False, protocol="oidc", message="; ".join(problems).capitalize(), details=details
        )
    await ctx.audit("sso.connection_tested", "sso_connection", conn.id, ok=True)
    return SSOTestResult(ok=True, protocol="oidc", message="Discovery document is valid", details=details)
