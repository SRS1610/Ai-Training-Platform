"""Thin async wrapper over the Stripe SDK (all network calls go through here so tests can monkeypatch
them)."""

from __future__ import annotations

import asyncio
from functools import lru_cache
from typing import Any

import stripe
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import settings
from app.core.errors import ServiceUnavailable


class BillingSettings(BaseSettings):
    """Billing settings not in the core config. Plan price ids are read per plan from
    ``STRIPE_PRICE_<PLAN>_MONTHLY`` / ``STRIPE_PRICE_<PLAN>_ANNUAL`` (see ``plans.Plan.stripe_price_env``)."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    STRIPE_PRICE_AI_METERED: str | None = None  # metered price attached to subscriptions for AI overage
    STRIPE_AI_METER_EVENT_NAME: str = "praxis_ai_overage"  # Stripe Billing Meter event name (value = cents)
    AI_OVERAGE_MARKUP: float = 1.25  # overage price = provider cost × markup
    BILLING_CURRENCY: str = "aud"


@lru_cache
def billing_settings() -> BillingSettings:
    return BillingSettings()


def is_configured() -> bool:
    return bool(settings.STRIPE_SECRET_KEY)


def require_configured() -> None:
    if not is_configured():
        raise ServiceUnavailable("Billing is not configured", code="billing_not_configured")


def as_dict(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    to_dict = getattr(obj, "to_dict", None)
    return to_dict() if callable(to_dict) else dict(obj)


async def _call(fn: Any, **params: Any) -> dict[str, Any]:
    result = await asyncio.to_thread(fn, api_key=settings.STRIPE_SECRET_KEY, **params)
    return as_dict(result)


async def create_customer(*, email: str, name: str, metadata: dict[str, str]) -> dict[str, Any]:
    return await _call(stripe.Customer.create, email=email, name=name, metadata=metadata)


async def create_checkout_session(**params: Any) -> dict[str, Any]:
    return await _call(stripe.checkout.Session.create, **params)


async def create_portal_session(*, customer: str, return_url: str) -> dict[str, Any]:
    return await _call(stripe.billing_portal.Session.create, customer=customer, return_url=return_url)


async def retrieve_subscription(subscription_id: str) -> dict[str, Any]:
    return await _call(stripe.Subscription.retrieve, id=subscription_id)


async def modify_subscription(subscription_id: str, **params: Any) -> dict[str, Any]:
    return await asyncio.to_thread(
        lambda: as_dict(
            stripe.Subscription.modify(subscription_id, api_key=settings.STRIPE_SECRET_KEY, **params)
        )
    )


async def find_promotion_code(code: str) -> str | None:
    result = await _call(stripe.PromotionCode.list, code=code, active=True, limit=1)
    data = result.get("data") or []
    return as_dict(data[0]).get("id") if data else None


async def report_meter_event(
    *, event_name: str, customer_id: str, value: int, identifier: str
) -> dict[str, Any]:
    return await _call(
        stripe.billing.MeterEvent.create,
        event_name=event_name,
        payload={"stripe_customer_id": customer_id, "value": str(value)},
        identifier=identifier,
    )


def verify_signature(payload: bytes, sig_header: str | None, secret: str, tolerance: int = 300) -> None:
    """Raises ``stripe.SignatureVerificationError`` when the ``Stripe-Signature`` header does not match."""
    stripe.WebhookSignature.verify_header(payload.decode("utf-8"), sig_header, secret, tolerance)
