from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    full_name: str = Field(min_length=1, max_length=200)
    organisation_name: str | None = Field(default=None, max_length=200)
    accept_terms: bool = True
    marketing_opt_in: bool = False
    include_refresh_token: bool = False


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    include_refresh_token: bool = False
    device_label: str | None = Field(default=None, max_length=200)


class MFAVerifyIn(BaseModel):
    mfa_token: str
    code: str | None = None
    recovery_code: str | None = None
    include_refresh_token: bool = False


class RefreshIn(BaseModel):
    refresh_token: str | None = None
    include_refresh_token: bool = False


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    refresh_token: str | None = None
    csrf_token: str
    user_id: uuid.UUID


class LoginOut(BaseModel):
    mfa_required: bool = False
    mfa_token: str | None = None
    tokens: TokenOut | None = None


class EmailIn(BaseModel):
    email: EmailStr


class TokenIn(BaseModel):
    token: str


class PasswordResetIn(BaseModel):
    token: str
    password: str = Field(min_length=1, max_length=256)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=1, max_length=256)


class MFASetupOut(BaseModel):
    secret: str
    otpauth_uri: str
    qr_svg: str


class MFAEnableIn(BaseModel):
    code: str


class MFAEnableOut(BaseModel):
    recovery_codes: list[str]


class MFADisableIn(BaseModel):
    password: str
    code: str


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_agent: str | None
    ip_address: str | None
    device_label: str | None
    auth_method: str
    mfa_verified: bool
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime
    revoked_at: datetime | None
    current: bool = False


class ProvidersOut(BaseModel):
    password: bool = True
    google: bool
    microsoft: bool
    sso: bool = True


class SSODiscoverOut(BaseModel):
    sso_available: bool
    connection_id: uuid.UUID | None = None
    name: str | None = None
    enforce_sso: bool = False
