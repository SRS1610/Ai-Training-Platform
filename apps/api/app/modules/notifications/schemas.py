from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.modules.notifications.service import NOTIFICATION_TYPES


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: str
    title: str
    body: str
    link: str | None
    data: dict[str, Any]
    read_at: datetime | None
    created_at: datetime


class UnreadCountOut(BaseModel):
    count: int


class ReadAllOut(BaseModel):
    updated: int


class ChannelPrefs(BaseModel):
    email: bool | None = None
    in_app: bool | None = None
    push: bool | None = None


class PreferenceItem(BaseModel):
    type: str
    label: str
    in_app: bool
    email: bool
    push: bool


class PreferencesOut(BaseModel):
    preferences: list[PreferenceItem]
    push_enabled: bool
    vapid_public_key: str | None
    push_subscriptions: int


class PreferencesIn(BaseModel):
    preferences: dict[str, ChannelPrefs]

    @field_validator("preferences")
    @classmethod
    def _known_types(cls, v: dict[str, ChannelPrefs]) -> dict[str, ChannelPrefs]:
        unknown = sorted(set(v) - set(NOTIFICATION_TYPES))
        if unknown:
            raise ValueError(f"Unknown notification types: {', '.join(unknown)}")
        return v


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=512)
    auth: str = Field(min_length=1, max_length=256)


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2048)
    keys: PushKeys
    expiration_time: int | None = None
    user_agent: str | None = Field(default=None, max_length=512)

    @field_validator("endpoint")
    @classmethod
    def _https(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("Push endpoint must be an https URL")
        return v


class PushUnsubscribeIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2048)


class PushSubscriptionOut(BaseModel):
    subscribed: bool
    push_subscriptions: int
    push_enabled: bool
