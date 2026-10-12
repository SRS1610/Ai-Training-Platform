"""/auth endpoints: registration, login (+MFA), refresh rotation, logout, email verification, password
reset/change, MFA management, session/device history, OAuth (Google, Microsoft) and enterprise SSO."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.bootstrap import create_organisation
from app.auth.deps import Principal, get_current_user, get_principal
from app.core import security
from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import get_db, tenant_scope
from app.core.errors import BadRequest, Forbidden, NotFound, Unauthorized
from app.core.middleware import ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE, client_ip
from app.models.identity import AuthSession, User
from app.models.tenancy import MembershipStatus, OrganisationUser, OrgKind, Role, SSOConnection
from app.modules.auth import oauth, service
from app.modules.auth.schemas import (
    EmailIn,
    LoginIn,
    LoginOut,
    MFADisableIn,
    MFAEnableIn,
    MFAEnableOut,
    MFASetupOut,
    MFAVerifyIn,
    PasswordChangeIn,
    PasswordResetIn,
    ProvidersOut,
    RefreshIn,
    RegisterIn,
    SessionOut,
    SSODiscoverOut,
    TokenIn,
    TokenOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])
REFRESH_PATH = f"{settings.API_PREFIX}/auth"


def _set_auth_cookies(response: Response, issued: service.IssuedSession) -> str:
    csrf = security.generate_token(24)
    common = {"secure": settings.COOKIE_SECURE, "samesite": "lax", "domain": settings.COOKIE_DOMAIN}
    response.set_cookie(ACCESS_COOKIE, issued.access_token, httponly=True, path="/",
                        max_age=settings.ACCESS_TOKEN_TTL_MINUTES * 60, **common)
    response.set_cookie(REFRESH_COOKIE, issued.refresh_token, httponly=True, path=REFRESH_PATH,
                        max_age=settings.REFRESH_TOKEN_TTL_DAYS * 86400, **common)
    response.set_cookie(CSRF_COOKIE, csrf, httponly=False, path="/",
                        max_age=settings.REFRESH_TOKEN_TTL_DAYS * 86400, **common)
    return csrf


def _clear_auth_cookies(response: Response) -> None:
    for name, path in ((ACCESS_COOKIE, "/"), (REFRESH_COOKIE, REFRESH_PATH), (CSRF_COOKIE, "/")):
        response.delete_cookie(name, path=path, domain=settings.COOKIE_DOMAIN)


def _token_out(response: Response, issued: service.IssuedSession, user: User, include_refresh: bool) -> TokenOut:
    csrf = _set_auth_cookies(response, issued)
    return TokenOut(
        access_token=issued.access_token,
        expires_at=issued.access_expires,
        refresh_token=issued.refresh_token if include_refresh else None,
        csrf_token=csrf,
        user_id=user.id,
    )


@router.get("/providers", response_model=ProvidersOut)
async def providers() -> ProvidersOut:
    return ProvidersOut(
        google=bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET),
        microsoft=bool(settings.MICROSOFT_CLIENT_ID and settings.MICROSOFT_CLIENT_SECRET),
    )


@router.post("/register", response_model=TokenOut, status_code=201)
async def register(body: RegisterIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    if not body.accept_terms:
        raise BadRequest("You must accept the terms of service", code="terms_required")
    user = await service.register(db, email=body.email, password=body.password, full_name=body.full_name,
                                  organisation_name=body.organisation_name, marketing_opt_in=body.marketing_opt_in,
                                  ip=client_ip(request))
    issued = await service.issue_session(db, user, mfa_verified=False, auth_method="password",
                                         ip=client_ip(request), user_agent=request.headers.get("user-agent"))
    return _token_out(response, issued, user, body.include_refresh_token)


@router.post("/login", response_model=LoginOut)
async def login(body: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    ip = client_ip(request)
    user = await service.authenticate(db, body.email, body.password, ip)
    if await _sso_enforced_for(db, user.email):
        raise Forbidden("Your organisation requires single sign-on", code="sso_required")
    if user.mfa_enabled:
        challenge = await service.create_mfa_challenge(db, user, body.device_label)
        return LoginOut(mfa_required=True, mfa_token=challenge)
    issued = await service.issue_session(db, user, mfa_verified=False, auth_method="password", ip=ip,
                                         user_agent=request.headers.get("user-agent"), device_label=body.device_label)
    await write_audit(db, action="auth.login", organisation_id=user.default_organisation_id, actor_user_id=user.id,
                      actor_label=user.email, entity_type="auth_session", entity_id=issued.session.id, ip_address=ip,
                      user_agent=request.headers.get("user-agent"))
    return LoginOut(tokens=_token_out(response, issued, user, body.include_refresh_token))


@router.post("/mfa/verify", response_model=TokenOut)
async def mfa_verify(body: MFAVerifyIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    user, challenge = await service.complete_mfa_challenge(db, body.mfa_token, body.code, body.recovery_code)
    ip = client_ip(request)
    issued = await service.issue_session(db, user, mfa_verified=True, auth_method="password+mfa", ip=ip,
                                         user_agent=request.headers.get("user-agent"),
                                         device_label=(challenge.data or {}).get("device_label"))
    await write_audit(db, action="auth.login", organisation_id=user.default_organisation_id, actor_user_id=user.id,
                      actor_label=user.email, entity_type="auth_session", entity_id=issued.session.id, ip_address=ip,
                      meta={"mfa": True})
    return _token_out(response, issued, user, body.include_refresh_token)


@router.post("/refresh", response_model=TokenOut)
async def refresh(request: Request, response: Response, body: RefreshIn | None = None,
                  db: AsyncSession = Depends(get_db)):
    raw = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise Unauthorized("Missing refresh token", code="refresh_invalid")
    session, user, new_raw = await service.rotate_refresh(db, raw)
    access, expires = security.create_access_token(user_id=user.id, session_id=session.id, mfa=session.mfa_verified)
    issued = service.IssuedSession(access, expires, new_raw, session)
    return _token_out(response, issued, user, bool(body and body.include_refresh_token))


@router.post("/logout", status_code=204)
async def logout(response: Response, principal: Principal = Depends(get_principal), db: AsyncSession = Depends(get_db)):
    if principal.session_id and principal.user:
        await service.revoke_session(db, principal.session_id, principal.user.id, "logout")
    _clear_auth_cookies(response)
    response.status_code = 204
    return response


@router.post("/email/verify")
async def verify_email(body: TokenIn, db: AsyncSession = Depends(get_db)) -> dict:
    user = await service.verify_email(db, body.token)
    return {"verified": True, "email": user.email}


@router.post("/email/resend", status_code=202)
async def resend_verification(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    if not user.email_verified_at:
        await service.send_verification_email(db, user)
    return {"sent": True}


@router.post("/password/forgot", status_code=202)
async def forgot_password(body: EmailIn, db: AsyncSession = Depends(get_db)) -> dict:
    await service.request_password_reset(db, body.email)
    return {"sent": True}


@router.post("/password/reset")
async def reset_password(body: PasswordResetIn, db: AsyncSession = Depends(get_db)) -> dict:
    await service.reset_password(db, body.token, body.password)
    return {"reset": True}


@router.post("/password/change", status_code=204)
async def change_password(body: PasswordChangeIn, principal: Principal = Depends(get_principal),
                          user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await service.change_password(db, user, body.current_password, body.new_password, principal.session_id)
    return Response(status_code=204)


@router.post("/mfa/setup", response_model=MFASetupOut)
async def mfa_setup(user: User = Depends(get_current_user)) -> MFASetupOut:
    if user.mfa_enabled:
        raise BadRequest("MFA is already enabled")
    secret, uri, svg = service.mfa_setup(user)
    return MFASetupOut(secret=secret, otpauth_uri=uri, qr_svg=svg)


@router.post("/mfa/enable", response_model=MFAEnableOut)
async def mfa_enable(body: MFAEnableIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return MFAEnableOut(recovery_codes=await service.mfa_enable(db, user, body.code))


@router.post("/mfa/disable", status_code=204)
async def mfa_disable(body: MFADisableIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await service.mfa_disable(db, user, body.password, body.code)
    return Response(status_code=204)


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(principal: Principal = Depends(get_principal), user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)) -> list[SessionOut]:
    rows = (await db.execute(
        select(AuthSession).where(AuthSession.user_id == user.id)
        .where(AuthSession.created_at > datetime.now(UTC) - timedelta(days=90))
        .order_by(AuthSession.last_used_at.desc().nulls_last())
    )).scalars().all()
    return [SessionOut.model_validate(r).model_copy(update={"current": r.id == principal.session_id}) for r in rows]


@router.delete("/sessions/{session_id}", status_code=204)
async def revoke_session(session_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await service.revoke_session(db, session_id, user.id, "user_revoked")
    return Response(status_code=204)


@router.post("/sessions/revoke-others", status_code=204)
async def revoke_other_sessions(principal: Principal = Depends(get_principal), user: User = Depends(get_current_user),
                                db: AsyncSession = Depends(get_db)):
    await service.revoke_all_sessions(db, user.id, "user_revoked_others", except_id=principal.session_id)
    return Response(status_code=204)


# ----------------------------------------------------------------------------- SSO / OAuth


async def _sso_connection_for_email(db: AsyncSession, email: str) -> SSOConnection | None:
    domain = email.split("@")[-1].lower()
    rows = (await db.execute(select(SSOConnection).where(SSOConnection.enabled.is_(True)))).scalars().all()
    return next((c for c in rows if domain in [d.lower() for d in (c.email_domains or [])]), None)


async def _sso_enforced_for(db: AsyncSession, email: str) -> bool:
    conn = await _sso_connection_for_email(db, email)
    return bool(conn and conn.enforce_sso)


@router.get("/sso/discover", response_model=SSODiscoverOut)
async def sso_discover(email: str = Query(..., max_length=320), db: AsyncSession = Depends(get_db)) -> SSODiscoverOut:
    conn = await _sso_connection_for_email(db, email)
    if not conn:
        return SSODiscoverOut(sso_available=False)
    return SSODiscoverOut(sso_available=True, connection_id=conn.id, name=conn.name, enforce_sso=conn.enforce_sso)


@router.get("/oauth/{provider}/authorize")
async def oauth_authorize(provider: str, return_to: str | None = None, db: AsyncSession = Depends(get_db)):
    if provider.startswith("sso-"):
        conn = await db.get(SSOConnection, uuid.UUID(provider[4:]))
        if not conn or not conn.enabled:
            raise NotFound("SSO connection not found")
        cfg = await oauth.oidc_connection_provider(conn)
        url = await oauth.build_authorize_redirect(db, cfg, provider, connection_id=conn.id, return_to=return_to)
    else:
        cfg = oauth.builtin_provider(provider)
        url = await oauth.build_authorize_redirect(db, cfg, provider, connection_id=None, return_to=return_to)
    return {"authorize_url": url}


@router.get("/oauth/{provider}/callback")
async def oauth_callback(provider: str, request: Request, code: str = Query(...), state: str = Query(...),
                         db: AsyncSession = Depends(get_db)):
    st = await oauth.consume_state(db, state)
    if st.data.get("provider") != provider:
        raise BadRequest("Provider mismatch", code="oauth_state_invalid")
    conn: SSOConnection | None = None
    if provider.startswith("sso-"):
        conn = await db.get(SSOConnection, uuid.UUID(st.data["connection_id"]))
        if not conn:
            raise NotFound("SSO connection not found")
        cfg = await oauth.oidc_connection_provider(conn)
        identity_provider = f"oidc:{conn.id}"
    else:
        cfg = oauth.builtin_provider(provider)
        identity_provider = provider
    claims = await oauth.exchange_code(cfg, provider, code, st.data["verifier"])
    email_verified = bool(claims.get("email_verified", conn is not None))
    user, created = await service.find_or_create_federated_user(
        db, provider=identity_provider, subject=str(claims["sub"]), email=claims["email"],
        email_verified=email_verified, full_name=claims.get("name", ""),
    )
    if conn is not None:
        existing = await db.scalar(select(OrganisationUser).where(
            OrganisationUser.organisation_id == conn.organisation_id, OrganisationUser.user_id == user.id))
        if existing is None:
            async with tenant_scope(db, conn.organisation_id):
                role = await db.scalar(select(Role).where(Role.organisation_id == conn.organisation_id,
                                                          Role.key == conn.default_role_key))
                db.add(OrganisationUser(organisation_id=conn.organisation_id, user_id=user.id,
                                        status=MembershipStatus.ACTIVE, joined_at=datetime.now(UTC),
                                        roles=[role] if role else []))
                await db.flush()
        user.default_organisation_id = user.default_organisation_id or conn.organisation_id
    elif created:
        org = await create_organisation(db, name=f"{user.full_name}'s workspace", owner_user_id=user.id,
                                        kind=OrgKind.PERSONAL)
        user.default_organisation_id = org.id
    issued = await service.issue_session(db, user, mfa_verified=conn is not None, auth_method=identity_provider,
                                         ip=client_ip(request), user_agent=request.headers.get("user-agent"))
    await write_audit(db, action="auth.login", organisation_id=user.default_organisation_id, actor_user_id=user.id,
                      actor_label=user.email, entity_type="auth_session", entity_id=issued.session.id,
                      ip_address=client_ip(request), meta={"method": identity_provider})
    redirect = RedirectResponse(f"{settings.PUBLIC_WEB_URL}{st.data.get('return_to') or '/app/dashboard'}", 302)
    _set_auth_cookies(redirect, issued)
    return redirect
