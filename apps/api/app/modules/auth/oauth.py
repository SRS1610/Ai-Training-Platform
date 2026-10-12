"""OAuth2 / OpenID Connect login: Google, Microsoft and per-organisation enterprise OIDC SSO.

Authorization-code flow with PKCE and a server-side, single-use ``state`` record. Identity claims are
read from the provider's userinfo endpoint using the access token obtained directly (TLS + client
authentication) from the token endpoint.

SAML 2.0: connection metadata is stored in ``sso_connections`` (protocol = "saml"); the assertion
consumer requires an XML-signature library (python3-saml / xmlsec) and is provided as an adapter
extension point — see docs/SECURITY.md. It is intentionally not enabled without that dependency.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.errors import BadRequest, NotFound
from app.models.identity import EmailToken, TokenPurpose
from app.models.tenancy import SSOConnection


@dataclass
class ProviderConfig:
    name: str
    authorize_url: str
    token_url: str
    userinfo_url: str
    client_id: str
    client_secret: str
    scopes: str = "openid email profile"


def builtin_provider(name: str) -> ProviderConfig:
    if name == "google" and settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET:
        return ProviderConfig(
            "google",
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://oauth2.googleapis.com/token",
            "https://openidconnect.googleapis.com/v1/userinfo",
            settings.GOOGLE_CLIENT_ID,
            settings.GOOGLE_CLIENT_SECRET,
        )
    if name == "microsoft" and settings.MICROSOFT_CLIENT_ID and settings.MICROSOFT_CLIENT_SECRET:
        base = f"https://login.microsoftonline.com/{settings.MICROSOFT_TENANT}/oauth2/v2.0"
        return ProviderConfig(
            "microsoft",
            f"{base}/authorize",
            f"{base}/token",
            "https://graph.microsoft.com/oidc/userinfo",
            settings.MICROSOFT_CLIENT_ID,
            settings.MICROSOFT_CLIENT_SECRET,
        )
    raise NotFound(f"Login provider '{name}' is not configured")


async def oidc_connection_provider(conn: SSOConnection) -> ProviderConfig:
    if conn.protocol != "oidc":
        raise BadRequest(
            "SAML connections require the SAML adapter (see docs/SECURITY.md)", code="saml_adapter"
        )
    cfg = conn.config or {}
    issuer = cfg.get("issuer", "").rstrip("/")
    async with httpx.AsyncClient(timeout=10) as client:
        discovery = (await client.get(f"{issuer}/.well-known/openid-configuration")).json()
    secret = (
        security.decrypt_str(cfg["client_secret_encrypted"]) if cfg.get("client_secret_encrypted") else ""
    )
    return ProviderConfig(
        f"oidc:{conn.id}",
        discovery["authorization_endpoint"],
        discovery["token_endpoint"],
        discovery["userinfo_endpoint"],
        cfg.get("client_id", ""),
        secret,
        cfg.get("scopes", "openid email profile"),
    )


def callback_url(provider_key: str) -> str:
    return f"{settings.PUBLIC_WEB_URL}/api/v1/auth/oauth/{provider_key}/callback"


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


async def build_authorize_redirect(
    db: AsyncSession,
    provider: ProviderConfig,
    provider_key: str,
    *,
    connection_id: uuid.UUID | None,
    return_to: str | None,
) -> str:
    state = secrets.token_urlsafe(32)
    verifier, challenge = _pkce_pair()
    nonce = secrets.token_urlsafe(16)
    db.add(
        EmailToken(
            user_id=None,
            purpose=TokenPurpose.OAUTH_STATE,
            token_hash=security.hash_token(state),
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
            data={
                "verifier": verifier,
                "provider": provider_key,
                "connection_id": str(connection_id or ""),
                "return_to": return_to if (return_to or "").startswith("/") else "/app/dashboard",
            },
        )
    )
    await db.flush()
    params = {
        "client_id": provider.client_id,
        "response_type": "code",
        "redirect_uri": callback_url(provider_key),
        "scope": provider.scopes,
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    return f"{provider.authorize_url}?{urlencode(params)}"


async def consume_state(db: AsyncSession, state: str) -> EmailToken:
    token = await db.scalar(
        select(EmailToken).where(
            EmailToken.token_hash == security.hash_token(state),
            EmailToken.purpose == TokenPurpose.OAUTH_STATE,
        )
    )
    if not token or token.used_at or token.expires_at < datetime.now(UTC):
        raise BadRequest("Login session expired, please try again", code="oauth_state_invalid")
    token.used_at = datetime.now(UTC)
    return token


async def exchange_code(provider: ProviderConfig, provider_key: str, code: str, verifier: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            provider.token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": callback_url(provider_key),
                "client_id": provider.client_id,
                "client_secret": provider.client_secret,
                "code_verifier": verifier,
            },
        )
        if token_resp.status_code != 200:
            raise BadRequest(
                "Could not complete sign-in with the identity provider", code="oauth_exchange_failed"
            )
        access = token_resp.json().get("access_token")
        info = await client.get(provider.userinfo_url, headers={"Authorization": f"Bearer {access}"})
        if info.status_code != 200:
            raise BadRequest(
                "Could not read your profile from the identity provider", code="oauth_userinfo_failed"
            )
        claims = info.json()
    if not claims.get("sub") or not claims.get("email"):
        raise BadRequest("The identity provider did not return an email address", code="oauth_no_email")
    return claims
