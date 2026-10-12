"""Cryptographic primitives: password hashing, JWTs, opaque tokens, field encryption, TOTP."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

_hasher = PasswordHasher()  # Argon2id with library defaults (RFC 9106 low-memory profile)
JWT_ALGORITHM = "HS256"
JWT_AUDIENCE = "praxis-api"
JWT_ISSUER = "praxis"


def utcnow() -> datetime:
    return datetime.now(UTC)


# ----------------------------------------------------------------------------- passwords


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        # Constant-ish work to avoid user-enumeration timing differences.
        _hasher.hash(password)
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


COMMON_PASSWORDS = {
    "password",
    "password1",
    "password123",
    "123456789",
    "12345678",
    "qwerty123",
    "letmein123",
    "welcome123",
    "iloveyou1",
    "admin1234",
    "passw0rd",
    "changeme1",
}


def validate_password_strength(password: str) -> list[str]:
    """NIST 800-63B aligned: length over composition rules, plus a deny-list."""
    problems: list[str] = []
    if len(password) < 10:
        problems.append("Password must be at least 10 characters long.")
    if len(password) > 256:
        problems.append("Password must be at most 256 characters long.")
    if password.lower() in COMMON_PASSWORDS:
        problems.append("Password is too common.")
    if len(set(password)) < 5:
        problems.append("Password is too repetitive.")
    return problems


# ----------------------------------------------------------------------------- opaque tokens


def generate_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    """Deterministic keyed hash for storing bearer secrets (refresh tokens, invites, API keys)."""
    return hmac.new(settings.AUTH_SECRET.encode(), token.encode(), hashlib.sha256).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def sign_payload(*parts: str) -> str:
    return hmac.new(settings.AUTH_SECRET.encode(), "|".join(parts).encode(), hashlib.sha256).hexdigest()


# ----------------------------------------------------------------------------- JWT


def create_access_token(
    *, user_id: uuid.UUID, session_id: uuid.UUID, mfa: bool, extra: dict[str, Any] | None = None
) -> tuple[str, datetime]:
    now = utcnow()
    expires = now + timedelta(minutes=settings.ACCESS_TOKEN_TTL_MINUTES)
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "mfa": mfa,
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "aud": JWT_AUDIENCE,
        "iss": JWT_ISSUER,
        "jti": uuid.uuid4().hex,
        "typ": "access",
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.AUTH_SECRET, algorithm=JWT_ALGORITHM), expires


def decode_access_token(token: str) -> dict[str, Any]:
    payload = jwt.decode(
        token,
        settings.AUTH_SECRET,
        algorithms=[JWT_ALGORITHM],
        audience=JWT_AUDIENCE,
        issuer=JWT_ISSUER,
        options={"require": ["exp", "sub", "sid", "typ"]},
    )
    if payload.get("typ") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return payload


# ----------------------------------------------------------------------------- field encryption


def _fernet() -> Fernet:
    key = settings.ENCRYPTION_KEY
    if not key:
        # Development fallback: derive a stable key from AUTH_SECRET. Production requires ENCRYPTION_KEY.
        key = base64.urlsafe_b64encode(
            hashlib.sha256(("enc:" + settings.AUTH_SECRET).encode()).digest()
        ).decode()
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt_str(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_str(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken as exc:  # pragma: no cover - indicates key rotation problem
        raise ValueError("Unable to decrypt value") from exc


# ----------------------------------------------------------------------------- TOTP MFA


def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=settings.APP_NAME)


def verify_totp(secret: str, code: str) -> bool:
    code = (code or "").strip().replace(" ", "")
    if not code.isdigit() or len(code) != 6:
        return False
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def generate_recovery_codes(n: int = 8) -> list[str]:
    return [f"{secrets.token_hex(3)}-{secrets.token_hex(3)}" for _ in range(n)]
