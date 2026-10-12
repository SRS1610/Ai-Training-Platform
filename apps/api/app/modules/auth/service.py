"""Authentication business logic."""

from __future__ import annotations

import base64
import io
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import qrcode
import qrcode.image.svg
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.bootstrap import create_organisation
from app.core import security
from app.core.audit import write_audit
from app.core.config import settings
from app.core.email import send_email
from app.core.errors import BadRequest, Conflict, Forbidden, Unauthorized
from app.models.identity import AuthSession, EmailToken, TokenPurpose, User, UserIdentity, UserStatus
from app.models.platform import Consent
from app.models.tenancy import OrgKind

MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15
MAX_MFA_ATTEMPTS = 5


@dataclass
class IssuedSession:
    access_token: str
    access_expires: datetime
    refresh_token: str
    session: AuthSession


def _now() -> datetime:
    return datetime.now(UTC)


def normalise_email(email: str) -> str:
    return email.strip().lower()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    return await db.scalar(select(User).where(User.email == normalise_email(email)))


async def issue_session(
    db: AsyncSession,
    user: User,
    *,
    mfa_verified: bool,
    auth_method: str,
    ip: str | None,
    user_agent: str | None,
    device_label: str | None = None,
) -> IssuedSession:
    refresh = security.generate_token(48)
    session = AuthSession(
        user_id=user.id,
        refresh_token_hash=security.hash_token(refresh),
        user_agent=(user_agent or "")[:512] or None,
        ip_address=ip,
        device_label=device_label or _device_label(user_agent),
        auth_method=auth_method,
        mfa_verified=mfa_verified,
        last_used_at=_now(),
        expires_at=_now() + timedelta(days=settings.REFRESH_TOKEN_TTL_DAYS),
    )
    db.add(session)
    await db.flush()
    access, expires = security.create_access_token(user_id=user.id, session_id=session.id, mfa=mfa_verified)
    user.last_login_at = _now()
    return IssuedSession(access, expires, refresh, session)


def _device_label(user_agent: str | None) -> str:
    ua = (user_agent or "").lower()
    os_name = next(
        (
            n
            for k, n in [
                ("windows", "Windows"),
                ("mac os", "macOS"),
                ("iphone", "iPhone"),
                ("android", "Android"),
                ("linux", "Linux"),
            ]
            if k in ua
        ),
        "Unknown OS",
    )
    browser = next(
        (
            n
            for k, n in [
                ("edg/", "Edge"),
                ("chrome/", "Chrome"),
                ("firefox/", "Firefox"),
                ("safari/", "Safari"),
            ]
            if k in ua
        ),
        "Unknown client",
    )
    return f"{browser} on {os_name}"


async def register(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    full_name: str,
    organisation_name: str | None,
    marketing_opt_in: bool,
    ip: str | None,
) -> User:
    email = normalise_email(email)
    problems = security.validate_password_strength(password)
    if problems:
        raise BadRequest(problems[0], details={"password": problems}, code="weak_password")
    if await get_user_by_email(db, email):
        raise Conflict("An account with this email already exists", code="email_taken")
    user = User(email=email, password_hash=security.hash_password(password), full_name=full_name.strip())
    db.add(user)
    await db.flush()
    if organisation_name:
        org = await create_organisation(
            db, name=organisation_name, owner_user_id=user.id, kind=OrgKind.BUSINESS
        )
    else:
        org = await create_organisation(
            db, name=f"{full_name.strip()}'s workspace", owner_user_id=user.id, kind=OrgKind.PERSONAL
        )
    user.default_organisation_id = org.id
    for purpose, granted in (("terms", True), ("privacy_policy", True), ("marketing", marketing_opt_in)):
        db.add(
            Consent(
                user_id=user.id,
                organisation_id=org.id,
                purpose=purpose,
                policy_version="2026-01",
                granted=granted,
                ip_address=ip,
            )
        )
    await write_audit(
        db,
        action="user.registered",
        organisation_id=org.id,
        actor_user_id=user.id,
        actor_label=email,
        entity_type="user",
        entity_id=user.id,
        ip_address=ip,
    )
    await send_verification_email(db, user)
    return user


async def _create_email_token(
    db: AsyncSession, user: User | None, purpose: str, ttl: timedelta, data: dict | None = None
) -> str:
    raw = security.generate_token(32)
    db.add(
        EmailToken(
            user_id=user.id if user else None,
            purpose=purpose,
            token_hash=security.hash_token(raw),
            expires_at=_now() + ttl,
            data=data or {},
        )
    )
    await db.flush()
    return raw


async def _consume_email_token(db: AsyncSession, raw: str, purpose: str) -> EmailToken:
    token = await db.scalar(
        select(EmailToken).where(
            EmailToken.token_hash == security.hash_token(raw), EmailToken.purpose == purpose
        )
    )
    if not token or token.used_at or token.expires_at < _now():
        raise BadRequest("This link is invalid or has expired", code="token_invalid")
    token.used_at = _now()
    return token


async def send_verification_email(db: AsyncSession, user: User) -> None:
    raw = await _create_email_token(
        db, user, TokenPurpose.VERIFY_EMAIL, timedelta(hours=settings.EMAIL_TOKEN_TTL_HOURS)
    )
    await send_email(
        user.email,
        "Verify your email address",
        [f"Hi {user.full_name},", "Please confirm your email address to secure your account."],
        f"{settings.PUBLIC_WEB_URL}/verify-email?token={raw}",
        "Verify email",
    )


async def verify_email(db: AsyncSession, raw: str) -> User:
    token = await _consume_email_token(db, raw, TokenPurpose.VERIFY_EMAIL)
    user = await db.get(User, token.user_id)
    if not user:
        raise BadRequest("This link is invalid or has expired", code="token_invalid")
    user.email_verified_at = user.email_verified_at or _now()
    return user


async def authenticate(db: AsyncSession, email: str, password: str, ip: str | None) -> User:
    user = await get_user_by_email(db, email)
    if user and user.locked_until and user.locked_until > _now():
        raise Unauthorized("Too many failed attempts. Try again later.", code="account_locked")
    if not user or not security.verify_password(password, user.password_hash):
        if user:
            user.failed_login_count += 1
            if user.failed_login_count >= MAX_FAILED_LOGINS:
                user.locked_until = _now() + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_login_count = 0
            await write_audit(
                db,
                action="auth.login_failed",
                organisation_id=None,
                actor_user_id=user.id,
                actor_label=user.email,
                ip_address=ip,
            )
            await db.commit()  # persist lockout counters even though the request fails
        raise Unauthorized("Invalid email or password", code="invalid_credentials")
    if user.status != UserStatus.ACTIVE or user.deleted_at:
        raise Forbidden("This account is not active", code="account_inactive")
    if settings.REQUIRE_EMAIL_VERIFICATION and not user.email_verified_at:
        raise Forbidden("Please verify your email address first", code="email_unverified")
    user.failed_login_count = 0
    user.locked_until = None
    if user.password_hash and security.password_needs_rehash(user.password_hash):
        user.password_hash = security.hash_password(password)
    return user


async def create_mfa_challenge(db: AsyncSession, user: User, device_label: str | None) -> str:
    return await _create_email_token(
        db,
        user,
        TokenPurpose.MFA_CHALLENGE,
        timedelta(minutes=settings.MFA_CHALLENGE_TTL_MINUTES),
        {"device_label": device_label},
    )


async def complete_mfa_challenge(
    db: AsyncSession, raw: str, code: str | None, recovery_code: str | None
) -> tuple[User, EmailToken]:
    token = await _consume_email_token(db, raw, TokenPurpose.MFA_CHALLENGE)
    user = await db.get(User, token.user_id)
    if not user or not user.mfa_enabled or not user.mfa_secret_encrypted:
        raise Unauthorized("MFA challenge is invalid")
    if code and security.verify_totp(security.decrypt_str(user.mfa_secret_encrypted), code):
        return user, token
    if recovery_code:
        remaining = list(user.mfa_recovery_codes or [])
        for i, hashed in enumerate(remaining):
            if security.verify_password(recovery_code.strip().lower(), hashed):
                remaining.pop(i)
                user.mfa_recovery_codes = remaining
                return user, token
    # Allow a few retries with the same challenge; burn it after MAX_MFA_ATTEMPTS failures.
    attempts = int((token.data or {}).get("attempts", 0)) + 1
    token.data = {**(token.data or {}), "attempts": attempts}
    if attempts < MAX_MFA_ATTEMPTS:
        token.used_at = None
    await db.commit()
    raise Unauthorized("Invalid verification code", code="mfa_invalid")


async def rotate_refresh(db: AsyncSession, raw: str) -> tuple[AuthSession, User, str]:
    hashed = security.hash_token(raw)
    session = await db.scalar(select(AuthSession).where(AuthSession.refresh_token_hash == hashed))
    if session is None:
        reused = await db.scalar(select(AuthSession).where(AuthSession.previous_token_hash == hashed))
        if reused and not reused.revoked_at:
            # Refresh token reuse => likely theft. Kill the session family.
            reused.revoked_at, reused.revoked_reason = _now(), "refresh_token_reuse"
            await write_audit(
                db,
                action="auth.refresh_reuse_detected",
                organisation_id=None,
                actor_user_id=reused.user_id,
                entity_type="auth_session",
                entity_id=reused.id,
            )
            await db.commit()
        raise Unauthorized("Invalid refresh token", code="refresh_invalid")
    if session.revoked_at or session.expires_at < _now():
        raise Unauthorized("Session expired", code="session_revoked")
    user = await db.get(User, session.user_id)
    if not user or user.status != UserStatus.ACTIVE:
        raise Unauthorized("Account is not active")
    new_raw = security.generate_token(48)
    session.previous_token_hash = hashed
    session.refresh_token_hash = security.hash_token(new_raw)
    session.last_used_at = _now()
    return session, user, new_raw


async def revoke_session(db: AsyncSession, session_id: uuid.UUID, user_id: uuid.UUID, reason: str) -> None:
    await db.execute(
        update(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=_now(), revoked_reason=reason)
    )


async def revoke_all_sessions(
    db: AsyncSession, user_id: uuid.UUID, reason: str, except_id: uuid.UUID | None = None
) -> None:
    stmt = update(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
    if except_id:
        stmt = stmt.where(AuthSession.id != except_id)
    await db.execute(stmt.values(revoked_at=_now(), revoked_reason=reason))


async def request_password_reset(db: AsyncSession, email: str) -> None:
    user = await get_user_by_email(db, email)
    if not user or user.status != UserStatus.ACTIVE:
        return  # never reveal whether an account exists
    raw = await _create_email_token(
        db, user, TokenPurpose.RESET_PASSWORD, timedelta(minutes=settings.PASSWORD_RESET_TTL_MINUTES)
    )
    await send_email(
        user.email,
        "Reset your password",
        [
            "We received a request to reset your password.",
            f"This link expires in {settings.PASSWORD_RESET_TTL_MINUTES} minutes. "
            "If you didn't request it, you can ignore this email.",
        ],
        f"{settings.PUBLIC_WEB_URL}/reset-password?token={raw}",
        "Reset password",
    )


async def reset_password(db: AsyncSession, raw: str, password: str) -> User:
    problems = security.validate_password_strength(password)
    if problems:
        raise BadRequest(problems[0], details={"password": problems}, code="weak_password")
    token = await _consume_email_token(db, raw, TokenPurpose.RESET_PASSWORD)
    user = await db.get(User, token.user_id)
    if not user:
        raise BadRequest("This link is invalid or has expired", code="token_invalid")
    user.password_hash = security.hash_password(password)
    user.failed_login_count, user.locked_until = 0, None
    user.email_verified_at = user.email_verified_at or _now()  # proved control of the mailbox
    await revoke_all_sessions(db, user.id, "password_reset")
    await write_audit(
        db,
        action="auth.password_reset",
        organisation_id=None,
        actor_user_id=user.id,
        actor_label=user.email,
        entity_type="user",
        entity_id=user.id,
    )
    return user


async def change_password(
    db: AsyncSession, user: User, current: str, new: str, keep_session: uuid.UUID | None
) -> None:
    if not security.verify_password(current, user.password_hash):
        raise BadRequest("Current password is incorrect", code="invalid_credentials")
    problems = security.validate_password_strength(new)
    if problems:
        raise BadRequest(problems[0], details={"password": problems}, code="weak_password")
    user.password_hash = security.hash_password(new)
    await revoke_all_sessions(db, user.id, "password_changed", except_id=keep_session)
    await write_audit(
        db,
        action="auth.password_changed",
        organisation_id=None,
        actor_user_id=user.id,
        actor_label=user.email,
        entity_type="user",
        entity_id=user.id,
    )


def mfa_setup(user: User) -> tuple[str, str, str]:
    secret = security.new_totp_secret()
    uri = security.totp_uri(secret, user.email)
    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    svg = "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()
    user.mfa_secret_encrypted = security.encrypt_str(secret)  # pending until enabled with a valid code
    return secret, uri, svg


async def mfa_enable(db: AsyncSession, user: User, code: str) -> list[str]:
    if not user.mfa_secret_encrypted:
        raise BadRequest("Start MFA setup first")
    if not security.verify_totp(security.decrypt_str(user.mfa_secret_encrypted), code):
        raise BadRequest("Invalid verification code", code="mfa_invalid")
    codes = security.generate_recovery_codes()
    user.mfa_recovery_codes = [security.hash_password(c) for c in codes]
    user.mfa_enabled = True
    await write_audit(
        db,
        action="auth.mfa_enabled",
        organisation_id=None,
        actor_user_id=user.id,
        actor_label=user.email,
        entity_type="user",
        entity_id=user.id,
    )
    return codes


async def mfa_disable(db: AsyncSession, user: User, password: str, code: str) -> None:
    if not security.verify_password(password, user.password_hash):
        raise BadRequest("Password is incorrect", code="invalid_credentials")
    if not user.mfa_secret_encrypted or not security.verify_totp(
        security.decrypt_str(user.mfa_secret_encrypted), code
    ):
        raise BadRequest("Invalid verification code", code="mfa_invalid")
    user.mfa_enabled = False
    user.mfa_secret_encrypted = None
    user.mfa_recovery_codes = None
    await write_audit(
        db,
        action="auth.mfa_disabled",
        organisation_id=None,
        actor_user_id=user.id,
        actor_label=user.email,
        entity_type="user",
        entity_id=user.id,
    )


async def find_or_create_federated_user(
    db: AsyncSession, *, provider: str, subject: str, email: str, email_verified: bool, full_name: str
) -> tuple[User, bool]:
    """Returns (user, created).

    Links by verified email only; never links an unverified email to an existing account."""
    identity = await db.scalar(
        select(UserIdentity).where(UserIdentity.provider == provider, UserIdentity.subject == subject)
    )
    if identity:
        user = await db.get(User, identity.user_id)
        assert user is not None
        return user, False
    email = normalise_email(email)
    user = await get_user_by_email(db, email)
    if user:
        if not email_verified:
            raise Forbidden(
                "Sign in with your password and link this provider from your profile.",
                code="identity_link_required",
            )
        db.add(UserIdentity(user_id=user.id, provider=provider, subject=subject, email=email))
        return user, False
    user = User(
        email=email,
        full_name=full_name or email.split("@")[0],
        password_hash=None,
        email_verified_at=_now() if email_verified else None,
    )
    db.add(user)
    await db.flush()
    db.add(UserIdentity(user_id=user.id, provider=provider, subject=subject, email=email))
    return user, True
