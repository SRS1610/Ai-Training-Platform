from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, field_validator

HEX_COLOUR = r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"


class Branding(BaseModel):
    """Organisation branding. Colours must be hex (#rgb or #rrggbb)."""

    model_config = ConfigDict(extra="forbid")

    primary_color: str | None = Field(default=None, pattern=HEX_COLOUR)
    secondary_color: str | None = Field(default=None, pattern=HEX_COLOUR)
    accent_color: str | None = Field(default=None, pattern=HEX_COLOUR)
    background_color: str | None = Field(default=None, pattern=HEX_COLOUR)
    text_color: str | None = Field(default=None, pattern=HEX_COLOUR)
    font_family: str | None = Field(default=None, max_length=100, pattern=r"^[\w \-,'\"]+$")
    certificate_text: str | None = Field(default=None, max_length=1000)
    login_message: str | None = Field(default=None, max_length=500)
    email_footer: str | None = Field(default=None, max_length=500)
    favicon_url: AnyHttpUrl | None = None


class OrgSettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gamification_enabled: bool | None = None
    require_mfa: bool | None = None
    retention_days: int | None = Field(default=None, ge=30, le=3650)
    default_locale: str | None = Field(default=None, pattern=r"^[a-z]{2}(?:-[A-Z]{2})?$")


class OrgSettingsOut(BaseModel):
    gamification_enabled: bool = True
    require_mfa: bool = False
    retention_days: int = 2555
    default_locale: str = "en-AU"


class OrgUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    logo_url: AnyHttpUrl | None = None
    branding: Branding | None = None
    settings: OrgSettingsIn | None = None

    @field_validator("logo_url")
    @classmethod
    def _length(cls, v: AnyHttpUrl | None) -> AnyHttpUrl | None:
        if v is not None and len(str(v)) > 1024:
            raise ValueError("URL too long")
        return v


class OrgOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    kind: str
    status: str
    logo_url: str | None
    branding: dict
    custom_domain: str | None
    custom_domain_verified: bool
    custom_domain_verified_at: datetime | None
    plan_code: str
    settings: OrgSettingsOut
    features: dict[str, bool]
    created_at: datetime


class OrgCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["business", "education", "training_provider"] = "business"


class DomainIn(BaseModel):
    domain: str = Field(min_length=4, max_length=253)


class DomainStatus(BaseModel):
    domain: str | None
    verified: bool
    verified_at: datetime | None
    status: Literal["none", "pending", "verified", "unavailable"]
    record_type: str | None = None
    record_name: str | None = None
    record_value: str | None = None
    instructions: str | None = None
