from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PlanOut(BaseModel):
    code: str
    name: str
    description: str
    monthly_price_cents: int
    annual_price_cents: int
    seat_based: bool
    limits: dict[str, Any]
    features: dict[str, bool]
    trial_days: int
    self_serve: bool
    contact_sales: bool


class SubscriptionOut(BaseModel):
    plan: PlanOut
    status: str
    billing_interval: str
    seats_purchased: int | None = Field(
        description="Seats bought on a seat-based plan; null when none are recorded."
    )
    seats_used: int
    seat_limit: int | None = Field(description="Enforced member + invitation limit; null means unlimited.")
    trial_ends_at: datetime | None
    is_trialing: bool
    trial_days_remaining: int
    current_period_start: datetime | None
    current_period_end: datetime | None
    cancel_at_period_end: bool
    canceled_at: datetime | None
    coupon_code: str | None
    has_billing_account: bool
    billing_configured: bool
    stripe_publishable_key: str | None


class CheckoutIn(BaseModel):
    plan_code: Literal["individual", "professional", "business"]
    interval: Literal["month", "year"] = "month"
    seats: int = Field(default=1, ge=1, le=100_000)
    coupon: str | None = Field(default=None, max_length=64)
    promotion_code: str | None = Field(default=None, max_length=64)
    trial_days: int | None = Field(default=None, ge=0, le=30, description="Override the default 14-day trial")

    @model_validator(mode="after")
    def _one_discount(self) -> CheckoutIn:
        if self.coupon and self.promotion_code:
            raise ValueError("Provide either a coupon or a promotion code, not both")
        return self


class CheckoutOut(BaseModel):
    session_id: str
    url: str
    trial_days: int
    seats: int


class UrlOut(BaseModel):
    url: str


class SeatsIn(BaseModel):
    seats: int = Field(ge=1, le=100_000)


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    stripe_invoice_id: str | None
    amount_cents: int
    currency: str
    status: str
    description: str | None
    hosted_invoice_url: str | None
    invoice_pdf_url: str | None
    period_start: datetime | None
    period_end: datetime | None
    paid_at: datetime | None
    created_at: datetime


class FeatureCost(BaseModel):
    feature: str
    cost_usd: float
    requests: int


class DayCost(BaseModel):
    date: date
    cost_usd: float


class UsageOut(BaseModel):
    period_start: datetime
    period_end: datetime
    spend_usd: float
    requests: int
    tokens_in: int
    tokens_out: int
    included_usd: float | None
    budget_usd: float | None
    budget_source: str
    remaining_usd: float | None
    pct_used: float | None
    overage_usd: float
    overage_markup: float
    overage_cost_usd: float
    metered_billing_enabled: bool
    reported_overage_cents: int
    by_feature: list[FeatureCost]
    by_day: list[DayCost]
