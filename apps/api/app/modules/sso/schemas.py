from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import AnyHttpUrl, BaseModel, Field


class OIDCConfigIn(BaseModel):
    issuer: AnyHttpUrl
    client_id: str = Field(min_length=1, max_length=255)
    client_secret: str | None = Field(
        default=None,
        min_length=1,
        max_length=1024,
        description="Write-only; stored encrypted and never returned",
    )
    scopes: str = Field(default="openid email profile", max_length=255)


class SAMLConfigIn(BaseModel):
    idp_entity_id: str = Field(min_length=1, max_length=1024)
    sso_url: AnyHttpUrl
    x509_cert: str = Field(min_length=20, max_length=20000, description="IdP signing certificate (PEM)")


class SSOCreate(BaseModel):
    protocol: Literal["oidc", "saml"]
    name: str = Field(min_length=1, max_length=120)
    email_domains: list[str] = Field(default_factory=list, max_length=20)
    enforce_sso: bool = False
    default_role_key: str = Field(default="learner", max_length=64)
    enabled: bool = True
    oidc: OIDCConfigIn | None = None
    saml: SAMLConfigIn | None = None


class SSOUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email_domains: list[str] | None = Field(default=None, max_length=20)
    enforce_sso: bool | None = None
    default_role_key: str | None = Field(default=None, max_length=64)
    enabled: bool | None = None
    oidc: OIDCConfigIn | None = None
    saml: SAMLConfigIn | None = None


class DomainVerification(BaseModel):
    domain: str
    verified: bool
    record_type: str = "TXT"
    record_name: str | None = None
    record_value: str | None = None


class SSOOut(BaseModel):
    id: uuid.UUID
    protocol: str
    name: str
    email_domains: list[str]
    pending_domains: list[str]
    domains: list[DomainVerification]
    enforce_sso: bool
    default_role_key: str
    enabled: bool
    config: dict[str, Any]
    requires_saml_adapter: bool
    login_url: str | None
    callback_url: str | None
    created_at: datetime
    updated_at: datetime


class SSOTestResult(BaseModel):
    ok: bool
    protocol: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
