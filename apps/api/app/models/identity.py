"""Global identity: users, external identities, sessions and one-time tokens (not tenant scoped)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDelete, StrEnum, Timestamps, UUIDPk


class UserStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DELETED = "deleted"


class User(UUIDPk, Timestamps, SoftDelete, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(200))
    avatar_url: Mapped[str | None] = mapped_column(String(1024))
    locale: Mapped[str] = mapped_column(String(16), default="en-AU")
    timezone: Mapped[str] = mapped_column(String(64), default="Australia/Sydney")
    status: Mapped[str] = mapped_column(String(16), default=UserStatus.ACTIVE)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_secret_encrypted: Mapped[str | None] = mapped_column(Text)
    mfa_recovery_codes: Mapped[list[Any] | None] = mapped_column()  # list of argon2 hashes
    is_superadmin: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_login_count: Mapped[int] = mapped_column(default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    default_organisation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organisations.id", ondelete="SET NULL", use_alter=True)
    )
    preferences: Mapped[dict[str, Any]] = mapped_column(default=dict)

    identities: Mapped[list[UserIdentity]] = relationship(back_populates="user", cascade="all, delete-orphan")


class UserIdentity(UUIDPk, Timestamps, Base):
    """Federated login identity (google, microsoft, oidc:<connection-id>, saml:<connection-id>)."""

    __tablename__ = "user_identities"
    __table_args__ = (UniqueConstraint("provider", "subject"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(64))
    subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320))

    user: Mapped[User] = relationship(back_populates="identities")


class AuthSession(UUIDPk, Timestamps, Base):
    """A refresh-token session = one signed-in device. Powers device/session history and revocation."""

    __tablename__ = "auth_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    refresh_token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    previous_token_hash: Mapped[str | None] = mapped_column(String(128), index=True)  # reuse detection
    user_agent: Mapped[str | None] = mapped_column(String(512))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    device_label: Mapped[str | None] = mapped_column(String(200))
    auth_method: Mapped[str] = mapped_column(String(32), default="password")
    mfa_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_reason: Mapped[str | None] = mapped_column(String(64))


class TokenPurpose(StrEnum):
    VERIFY_EMAIL = "verify_email"
    RESET_PASSWORD = "reset_password"
    MFA_CHALLENGE = "mfa_challenge"
    OAUTH_STATE = "oauth_state"


class EmailToken(UUIDPk, Timestamps, Base):
    """Hashed single-use tokens (email verification, password reset, MFA login challenge)."""

    __tablename__ = "email_tokens"
    __table_args__ = (Index("ix_email_tokens_user_purpose", "user_id", "purpose"),)

    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    purpose: Mapped[str] = mapped_column(String(32))
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    data: Mapped[dict[str, Any]] = mapped_column(default=dict)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
