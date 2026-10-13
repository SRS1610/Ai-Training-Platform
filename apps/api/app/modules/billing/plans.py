"""Subscription plan catalogue and plan-limit enforcement (used across modules)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import PaymentRequired


@dataclass(frozen=True)
class Plan:
    code: str
    name: str
    description: str
    monthly_price_cents: int  # per seat for seat-based plans
    annual_price_cents: int
    seat_based: bool
    limits: dict[str, Any]
    features: dict[str, bool]
    stripe_price_env: dict[str, str] = field(
        default_factory=dict
    )  # interval -> env var holding Stripe price id


PLANS: dict[str, Plan] = {
    "free": Plan(
        "free",
        "Free",
        "Get started with core learning features.",
        0,
        0,
        False,
        {"max_users": 5, "max_courses": 3, "ai_monthly_budget_usd": 5, "max_simulations": 0, "storage_gb": 1},
        {
            "ai_tutor": True,
            "simulations": False,
            "ai_generation": False,
            "analytics_advanced": False,
            "sso": False,
            "custom_branding": False,
            "api_access": False,
            "gamification": True,
        },
    ),
    "individual": Plan(
        "individual",
        "Individual",
        "Unlimited learning with AI tutor limits.",
        1900,
        19000,
        False,
        {
            "max_users": 1,
            "max_courses": None,
            "ai_monthly_budget_usd": 10,
            "max_simulations": 5,
            "storage_gb": 5,
        },
        {
            "ai_tutor": True,
            "simulations": True,
            "ai_generation": False,
            "analytics_advanced": False,
            "sso": False,
            "custom_branding": False,
            "api_access": False,
            "gamification": True,
        },
        {"month": "STRIPE_PRICE_INDIVIDUAL_MONTHLY", "year": "STRIPE_PRICE_INDIVIDUAL_ANNUAL"},
    ),
    "professional": Plan(
        "professional",
        "Professional",
        "AI tutor, AI course builder and simulations.",
        4900,
        49000,
        False,
        {
            "max_users": 10,
            "max_courses": None,
            "ai_monthly_budget_usd": 50,
            "max_simulations": None,
            "storage_gb": 25,
        },
        {
            "ai_tutor": True,
            "simulations": True,
            "ai_generation": True,
            "analytics_advanced": False,
            "sso": False,
            "custom_branding": False,
            "api_access": False,
            "gamification": True,
        },
        {"month": "STRIPE_PRICE_PROFESSIONAL_MONTHLY", "year": "STRIPE_PRICE_PROFESSIONAL_ANNUAL"},
    ),
    "business": Plan(
        "business",
        "Business",
        "Organisation users, departments and analytics.",
        2900,
        29000,
        True,
        {
            "max_users": None,
            "max_courses": None,
            "ai_monthly_budget_usd": 500,
            "max_simulations": None,
            "storage_gb": 250,
        },
        {
            "ai_tutor": True,
            "simulations": True,
            "ai_generation": True,
            "analytics_advanced": True,
            "sso": False,
            "custom_branding": True,
            "api_access": True,
            "gamification": True,
        },
        {"month": "STRIPE_PRICE_BUSINESS_MONTHLY", "year": "STRIPE_PRICE_BUSINESS_ANNUAL"},
    ),
    "enterprise": Plan(
        "enterprise",
        "Enterprise",
        "SSO, custom branding, advanced reporting, dedicated infrastructure.",
        0,
        0,
        True,
        {
            "max_users": None,
            "max_courses": None,
            "ai_monthly_budget_usd": None,
            "max_simulations": None,
            "storage_gb": None,
        },
        {
            "ai_tutor": True,
            "simulations": True,
            "ai_generation": True,
            "analytics_advanced": True,
            "sso": True,
            "custom_branding": True,
            "api_access": True,
            "gamification": True,
        },
    ),
}


# Upgrade ladder for organisations: each tier's numeric limits are >= the previous tier's (None = unlimited).
TIER_ORDER: tuple[str, ...] = ("free", "professional", "business", "enterprise")
# Personal plans sit beside the ladder: a one-person workspace (max_users is 1 by design) whose other limits
# are between Free and Professional.
PERSONAL_PLANS: tuple[str, ...] = ("individual",)


def get_plan(code: str | None) -> Plan:
    return PLANS.get(code or "free", PLANS["free"])


def has_feature(org: Any, feature: str) -> bool:
    """``org`` is an Organisation. Per-org overrides live in ``org.settings['feature_overrides']``."""
    overrides = (org.settings or {}).get("feature_overrides") or {}
    if feature in overrides:
        return bool(overrides[feature])
    return get_plan(org.plan_code).features.get(feature, False)


def require_feature(org: Any, feature: str) -> None:
    if not has_feature(org, feature):
        raise PaymentRequired(
            f"Your plan does not include {feature.replace('_', ' ')}. Upgrade to unlock it.",
            details={"feature": feature, "plan": org.plan_code},
        )


async def _current_count(db: AsyncSession, org_id: Any, resource: str) -> int:
    from app.models.content import Course
    from app.models.simulation import Simulation
    from app.models.tenancy import Invitation, MembershipStatus, OrganisationUser

    if resource == "max_users":
        members = await db.scalar(
            select(func.count())
            .select_from(OrganisationUser)
            .where(
                OrganisationUser.organisation_id == org_id,
                OrganisationUser.status != MembershipStatus.SUSPENDED,
            )
        )
        pending = await db.scalar(
            select(func.count())
            .select_from(Invitation)
            .where(
                Invitation.organisation_id == org_id,
                Invitation.accepted_at.is_(None),
                Invitation.revoked_at.is_(None),
                Invitation.expires_at > func.now(),
            )
        )
        return int(members or 0) + int(pending or 0)
    if resource == "max_courses":
        return int(
            await db.scalar(
                select(func.count())
                .select_from(Course)
                .where(Course.organisation_id == org_id, Course.deleted_at.is_(None))
            )
            or 0
        )
    if resource == "max_simulations":
        return int(
            await db.scalar(
                select(func.count())
                .select_from(Simulation)
                .where(Simulation.organisation_id == org_id, Simulation.deleted_at.is_(None))
            )
            or 0
        )
    raise ValueError(resource)


def recorded_seats(org: Any) -> int | None:
    """The seat count recorded for a seat-based plan (``org.settings['seats']``), or None when none is set."""
    if not get_plan(org.plan_code).seat_based:
        return None
    seats = (org.settings or {}).get("seats")
    return int(seats) if seats else None


def resource_limit(org: Any, resource: str) -> int | None:
    """The enforced limit for ``resource`` (None = unlimited).

    For seat-based plans ``max_users`` is the recorded seat count; without one (e.g. an Enterprise
    agreement with no seat number) the plan's own limit applies."""
    if resource == "max_users" and (seats := recorded_seats(org)) is not None:
        return seats
    limit = get_plan(org.plan_code).limits.get(resource)
    return None if limit is None else int(limit)


async def check_limit(db: AsyncSession, org: Any, resource: str, increment: int = 1) -> None:
    """Raise PaymentRequired (402) if adding ``increment`` would exceed the plan limit.

    See ``resource_limit``."""
    plan = get_plan(org.plan_code)
    limit = resource_limit(org, resource)
    if limit is None:
        return
    current = await _current_count(db, org.id, resource)
    if current + increment > limit:
        raise PaymentRequired(
            f"Your {plan.name} plan allows {limit} {resource.removeprefix('max_')}. Upgrade to add more.",
            details={"resource": resource, "limit": limit, "current": current, "plan": plan.code},
        )


# ----------------------------------------------------------------------------- Stripe catalogue helpers

TRIAL_DAYS: dict[str, int] = {"professional": 14, "business": 14}
# Enterprise is sales-led and free needs no checkout.
SELF_SERVE_PLANS = ("individual", "professional", "business")


def stripe_price_id(plan_code: str, interval: str) -> str | None:
    """Stripe price id for a plan/interval from the environment (e.g. ``STRIPE_PRICE_BUSINESS_MONTHLY``)."""
    import os

    env = get_plan(plan_code).stripe_price_env.get(interval)
    return os.environ.get(env) if env else None


def plan_for_price_id(price_id: str | None) -> tuple[str, str] | None:
    """Reverse lookup: Stripe price id -> (plan_code, interval)."""
    if not price_id:
        return None
    for code, plan in PLANS.items():
        for interval in plan.stripe_price_env:
            if stripe_price_id(code, interval) == price_id:
                return code, interval
    return None


def public_catalogue() -> list[dict[str, Any]]:
    return [
        {
            "code": p.code,
            "name": p.name,
            "description": p.description,
            "monthly_price_cents": p.monthly_price_cents,
            "annual_price_cents": p.annual_price_cents,
            "seat_based": p.seat_based,
            "limits": p.limits,
            "features": p.features,
            "trial_days": TRIAL_DAYS.get(p.code, 0),
            "self_serve": p.code in SELF_SERVE_PLANS,
            "contact_sales": p.code == "enterprise",
        }
        for p in PLANS.values()
    ]
