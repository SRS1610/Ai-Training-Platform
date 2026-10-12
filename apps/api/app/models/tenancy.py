"""Organisations, membership, RBAC, org structure, invitations, API keys and SSO connections."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, SoftDelete, StrEnum, TenantScoped, Timestamps, UUIDPk


class OrgStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    CLOSED = "closed"


class OrgKind(StrEnum):
    PERSONAL = "personal"  # individual learner's personal workspace
    BUSINESS = "business"
    EDUCATION = "education"
    TRAINING_PROVIDER = "training_provider"


class Organisation(UUIDPk, Timestamps, SoftDelete, Base):
    __tablename__ = "organisations"

    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    kind: Mapped[str] = mapped_column(String(32), default=OrgKind.BUSINESS)
    status: Mapped[str] = mapped_column(String(16), default=OrgStatus.ACTIVE)
    logo_url: Mapped[str | None] = mapped_column(String(1024))
    branding: Mapped[dict[str, Any]] = mapped_column(default=dict)  # colours, fonts, certificate text
    custom_domain: Mapped[str | None] = mapped_column(String(255), unique=True)
    custom_domain_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    plan_code: Mapped[str] = mapped_column(String(32), default="free")
    # Feature flags & policies: gamification_enabled, retention_days, require_mfa, default_locale ...
    settings: Mapped[dict[str, Any]] = mapped_column(default=dict)


class Permission(Base):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    description: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(64))


role_permissions = Table(
    "role_permissions",
    Base.metadata,
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    Column("permission_code", ForeignKey("permissions.code", ondelete="CASCADE"), primary_key=True),
)


class Role(UUIDPk, Timestamps, Base):
    """Organisation role. ``organisation_id`` NULL = system template copied into new organisations."""

    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("organisation_id", "key"),)

    organisation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organisations.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)

    permissions: Mapped[list[Permission]] = relationship(secondary=role_permissions, lazy="selectin")


membership_roles = Table(
    "membership_roles",
    Base.metadata,
    Column("membership_id", ForeignKey("organisation_users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)


class MembershipStatus(StrEnum):
    INVITED = "invited"
    ACTIVE = "active"
    SUSPENDED = "suspended"


class OrganisationUser(UUIDPk, Timestamps, Base):
    __tablename__ = "organisation_users"
    __table_args__ = (UniqueConstraint("organisation_id", "user_id"),)

    organisation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organisations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default=MembershipStatus.ACTIVE)
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    job_title: Mapped[str | None] = mapped_column(String(200))
    employee_id: Mapped[str | None] = mapped_column(String(100))
    manager_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    invited_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    roles: Mapped[list[Role]] = relationship(secondary=membership_roles, lazy="selectin")
    organisation: Mapped[Organisation] = relationship(lazy="joined")
    user = relationship("User", foreign_keys=[user_id], lazy="joined")


class Department(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "departments"

    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    manager_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Team(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "teams"

    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    lead_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class TeamMember(TenantScoped, Base):
    __tablename__ = "team_members"

    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class Invitation(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "invitations"
    __table_args__ = (Index("ix_invitations_org_email", "organisation_id", "email"),)

    email: Mapped[str] = mapped_column(String(320))
    role_keys: Mapped[list[Any]] = mapped_column(default=list)
    department_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    invited_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApiKey(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "api_keys"

    name: Mapped[str] = mapped_column(String(120))
    prefix: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    key_hash: Mapped[str] = mapped_column(String(128))
    scopes: Mapped[list[Any]] = mapped_column(default=list)  # permission codes
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SSOConnection(UUIDPk, Timestamps, Base):
    """Enterprise SSO configuration per organisation (OIDC implemented; SAML stored for the SAML adapter)."""

    __tablename__ = "sso_connections"

    organisation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organisations.id", ondelete="CASCADE"), index=True
    )
    protocol: Mapped[str] = mapped_column(String(16))  # oidc | saml
    name: Mapped[str] = mapped_column(String(120))
    email_domains: Mapped[list[Any]] = mapped_column(default=list)
    # OIDC: issuer, client_id, client_secret_encrypted, scopes. SAML: idp_entity_id, sso_url, x509_cert.
    config: Mapped[dict[str, Any]] = mapped_column(default=dict)
    default_role_key: Mapped[str] = mapped_column(String(64), default="learner")
    enforce_sso: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
