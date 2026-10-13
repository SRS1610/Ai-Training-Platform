"""Billing service: subscription view, Stripe Checkout / Portal, seats, cancel/resume, AI usage pricing and
webhook synchronisation (Subscription, Payment, organisation plan + seats)."""

from __future__ import annotations

import json
import math
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import stripe
import structlog
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import bind_tenant
from app.core.errors import BadRequest, Conflict, ServiceUnavailable
from app.models.ai import AIConfiguration, AIUsage
from app.models.platform import Payment, StripeEvent, Subscription, SubscriptionStatus
from app.models.tenancy import (
    MembershipStatus,
    Organisation,
    OrganisationUser,
    membership_roles,
    role_permissions,
)
from app.modules.billing import gateway
from app.modules.billing.plans import (
    PLANS,
    SELF_SERVE_PLANS,
    TRIAL_DAYS,
    _current_count,
    get_plan,
    plan_for_price_id,
    public_catalogue,
    recorded_seats,
    resource_limit,
    stripe_price_id,
)

log = structlog.get_logger(__name__)

LIVE_STATUSES = {SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE}
STATUS_MAP = {"incomplete_expired": "canceled", "paused": "past_due"}
MAX_TRIAL_DAYS = 30


def _now() -> datetime:
    return datetime.now(UTC)


def _ts(value: Any) -> datetime | None:
    if value in (None, "", 0):
        return None
    return datetime.fromtimestamp(int(value), tz=UTC)


def _catalogue_item(code: str) -> dict[str, Any]:
    return next(p for p in public_catalogue() if p["code"] == get_plan(code).code)


# ----------------------------------------------------------------------------- subscription


async def current_subscription(db: AsyncSession, org_id: uuid.UUID) -> Subscription | None:
    return await db.scalar(
        select(Subscription)
        .where(Subscription.organisation_id == org_id)
        .order_by(Subscription.created_at.desc(), Subscription.id.desc())
        .limit(1)
    )


async def ensure_subscription(db: AsyncSession, org: Organisation) -> Subscription:
    sub = await current_subscription(db, org.id)
    if sub is None:
        sub = Subscription(
            organisation_id=org.id,
            plan_code=org.plan_code,
            status=SubscriptionStatus.ACTIVE,
            seats=int((org.settings or {}).get("seats") or 1),
        )
        db.add(sub)
        await db.flush()
    return sub


async def seats_used(db: AsyncSession, org_id: uuid.UUID) -> int:
    return await _current_count(db, org_id, "max_users")


async def subscription_view(db: AsyncSession, org: Organisation) -> dict[str, Any]:
    sub = await current_subscription(db, org.id)
    plan = get_plan(org.plan_code)
    used = await seats_used(db, org.id)
    # Seats purchased: the recorded count, else (self-serve seat plans) the subscription's quantity.
    # A sales-led agreement with no recorded seat number has no purchased count and no enforced
    # limit (null = unlimited).
    purchased: int | None = recorded_seats(org)
    if purchased is None and plan.code in SELF_SERVE_PLANS and plan.seat_based:
        purchased = (sub.seats if sub else None) or 1
    seat_limit = resource_limit(org, "max_users")
    trial_ends = sub.trial_ends_at if sub else None
    trialing = bool(sub and sub.status == SubscriptionStatus.TRIALING and trial_ends and trial_ends > _now())
    remaining = math.ceil((trial_ends - _now()).total_seconds() / 86400) if trialing and trial_ends else 0
    return {
        "plan": _catalogue_item(plan.code),
        "status": sub.status if sub else SubscriptionStatus.ACTIVE,
        "billing_interval": sub.billing_interval if sub else "month",
        "seats_purchased": purchased,
        "seats_used": used,
        "seat_limit": seat_limit,
        "trial_ends_at": trial_ends,
        "is_trialing": trialing,
        "trial_days_remaining": remaining,
        "current_period_start": sub.current_period_start if sub else None,
        "current_period_end": sub.current_period_end if sub else None,
        "cancel_at_period_end": bool(sub and sub.cancel_at_period_end),
        "canceled_at": sub.canceled_at if sub else None,
        "coupon_code": sub.coupon_code if sub else None,
        "has_billing_account": bool(sub and sub.stripe_customer_id),
        "billing_configured": gateway.is_configured(),
        "stripe_publishable_key": settings.STRIPE_PUBLISHABLE_KEY,
    }


# ----------------------------------------------------------------------------- checkout & portal


def _web(path: str) -> str:
    return f"{settings.PUBLIC_WEB_URL.rstrip('/')}{path}"


async def _ensure_customer(sub: Subscription, org: Organisation, email: str) -> str:
    if sub.stripe_customer_id:
        return sub.stripe_customer_id
    customer = await gateway.create_customer(
        email=email, name=org.name, metadata={"organisation_id": str(org.id)}
    )
    sub.stripe_customer_id = customer["id"]
    return customer["id"]


async def start_checkout(
    db: AsyncSession,
    org: Organisation,
    *,
    email: str,
    plan_code: str,
    interval: str,
    seats: int,
    coupon: str | None,
    promotion_code: str | None,
    trial_days: int | None,
) -> dict[str, Any]:
    gateway.require_configured()
    if plan_code not in SELF_SERVE_PLANS:
        raise BadRequest("This plan cannot be purchased online. Contact sales for Enterprise.")
    plan = PLANS[plan_code]
    price = stripe_price_id(plan_code, interval)
    if not price:
        raise ServiceUnavailable(
            f"No Stripe price is configured for {plan.name} ({interval}ly)", code="billing_price_missing"
        )
    sub = await ensure_subscription(db, org)
    if sub.stripe_subscription_id and sub.status in LIVE_STATUSES and sub.plan_code != "free":
        raise Conflict(
            "Organisation already has an active subscription. Use the billing portal to change plans."
        )
    used = await seats_used(db, org.id)
    quantity = max(seats, used, 1) if plan.seat_based else 1  # never fewer seats than current members
    customer_id = await _ensure_customer(sub, org, email)

    metadata = {
        "organisation_id": str(org.id),
        "plan_code": plan_code,
        "interval": interval,
        "seats": str(quantity),
    }
    line_items: list[dict[str, Any]] = [{"price": price, "quantity": quantity}]
    metered = gateway.billing_settings().STRIPE_PRICE_AI_METERED
    if metered:
        line_items.append({"price": metered})
    subscription_data: dict[str, Any] = {"metadata": metadata}
    default_trial = TRIAL_DAYS.get(plan_code, 0)
    trial_used = bool((org.settings or {}).get("trial_used")) or sub.trial_ends_at is not None
    if default_trial and not trial_used:
        days = default_trial if trial_days is None else min(max(trial_days, 0), MAX_TRIAL_DAYS)
        if days:
            subscription_data["trial_period_days"] = days
    params: dict[str, Any] = {
        "mode": "subscription",
        "customer": customer_id,
        "client_reference_id": str(org.id),
        "line_items": line_items,
        "subscription_data": subscription_data,
        "metadata": metadata,
        "success_url": _web("/app/admin/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}"),
        "cancel_url": _web("/app/admin/billing?checkout=cancelled"),
    }
    if coupon:
        params["discounts"] = [{"coupon": coupon}]
    elif promotion_code:
        promo_id = await gateway.find_promotion_code(promotion_code)
        if not promo_id:
            raise BadRequest("Promotion code is invalid or expired", code="invalid_promotion_code")
        params["discounts"] = [{"promotion_code": promo_id}]
    else:
        params["allow_promotion_codes"] = True
    session = await gateway.create_checkout_session(**params)
    sub.coupon_code = coupon or promotion_code or sub.coupon_code
    await db.flush()
    return {
        "session_id": session["id"],
        "url": session["url"],
        "trial_days": subscription_data.get("trial_period_days", 0),
        "seats": quantity,
    }


async def portal_url(db: AsyncSession, org: Organisation) -> str:
    gateway.require_configured()
    sub = await current_subscription(db, org.id)
    if not sub or not sub.stripe_customer_id:
        raise BadRequest("No billing account yet. Start a subscription first.", code="no_billing_account")
    session = await gateway.create_portal_session(
        customer=sub.stripe_customer_id, return_url=_web("/app/admin/billing")
    )
    return session["url"]


async def _live_stripe_sub(db: AsyncSession, org: Organisation) -> Subscription:
    gateway.require_configured()
    sub = await current_subscription(db, org.id)
    if not sub or not sub.stripe_subscription_id:
        raise BadRequest("There is no paid subscription to change", code="no_subscription")
    return sub


def _seat_item(stripe_sub: dict[str, Any]) -> dict[str, Any] | None:
    metered = gateway.billing_settings().STRIPE_PRICE_AI_METERED
    for item in (stripe_sub.get("items") or {}).get("data") or []:
        price = item.get("price") or {}
        if price.get("id") == metered or (price.get("recurring") or {}).get("usage_type") == "metered":
            continue
        return item
    return None


async def change_seats(db: AsyncSession, org: Organisation, seats: int) -> Subscription:
    sub = await _live_stripe_sub(db, org)
    if not get_plan(sub.plan_code).seat_based:
        raise BadRequest("Your plan is not billed per seat")
    used = await seats_used(db, org.id)
    if seats < used:
        raise BadRequest(
            f"You have {used} members and pending invitations; remove some before reducing seats.",
            details={"seats_used": used},
        )
    stripe_sub = await gateway.retrieve_subscription(sub.stripe_subscription_id)  # type: ignore[arg-type]
    item = _seat_item(stripe_sub)
    if item is None:
        raise ServiceUnavailable("Could not find the seat line item on the Stripe subscription")
    await gateway.modify_subscription(
        sub.stripe_subscription_id,  # type: ignore[arg-type]
        items=[{"id": item["id"], "quantity": seats}],
        proration_behavior="create_prorations",
    )
    sub.seats = seats
    org.settings = {**(org.settings or {}), "seats": seats}
    await db.flush()
    return sub


async def set_cancel_at_period_end(db: AsyncSession, org: Organisation, cancel: bool) -> Subscription:
    sub = await _live_stripe_sub(db, org)
    if sub.status == SubscriptionStatus.CANCELED:
        raise BadRequest("The subscription has already ended")
    result = await gateway.modify_subscription(
        sub.stripe_subscription_id,  # type: ignore[arg-type]
        cancel_at_period_end=cancel,
    )
    sub.cancel_at_period_end = bool(result.get("cancel_at_period_end", cancel))
    await db.flush()
    return sub


# ----------------------------------------------------------------------------- AI usage pricing


def _period_bounds(sub: Subscription | None, now: datetime | None = None) -> tuple[datetime, datetime]:
    now = now or _now()
    if (
        sub
        and sub.current_period_start
        and sub.current_period_end
        and sub.current_period_start <= now < sub.current_period_end
    ):
        return sub.current_period_start, sub.current_period_end
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = (start + timedelta(days=32)).replace(day=1)
    return start, end


async def ai_usage_summary(db: AsyncSession, org: Organisation) -> dict[str, Any]:
    sub = await current_subscription(db, org.id)
    start, end = _period_bounds(sub)
    window = (AIUsage.organisation_id == org.id, AIUsage.created_at >= start, AIUsage.created_at < end)
    totals = (
        await db.execute(
            select(
                func.coalesce(func.sum(AIUsage.cost_usd), 0),
                func.count(),
                func.coalesce(func.sum(AIUsage.tokens_in), 0),
                func.coalesce(func.sum(AIUsage.tokens_out), 0),
            ).where(*window)
        )
    ).one()
    by_feature = (
        await db.execute(
            select(AIUsage.feature, func.sum(AIUsage.cost_usd), func.count())
            .where(*window)
            .group_by(AIUsage.feature)
            .order_by(func.sum(AIUsage.cost_usd).desc())
        )
    ).all()
    by_day = (
        await db.execute(
            select(func.date_trunc("day", AIUsage.created_at).label("d"), func.sum(AIUsage.cost_usd))
            .where(*window)
            .group_by("d")
            .order_by("d")
        )
    ).all()
    plan = get_plan(org.plan_code)
    included = plan.limits.get("ai_monthly_budget_usd")
    cfg_budget = await db.scalar(
        select(AIConfiguration.monthly_budget_usd).where(AIConfiguration.organisation_id == org.id)
    )
    budget = (
        float(cfg_budget) if cfg_budget is not None else (float(included) if included is not None else None)
    )
    spend = float(totals[0] or Decimal(0))
    overage = max(0.0, spend - float(included)) if included is not None else 0.0
    markup = gateway.billing_settings().AI_OVERAGE_MARKUP
    reported = int(((org.settings or {}).get("billing_ai_reported") or {}).get(start.strftime("%Y-%m-%d"), 0))
    return {
        "period_start": start,
        "period_end": end,
        "spend_usd": round(spend, 4),
        "requests": int(totals[1]),
        "tokens_in": int(totals[2]),
        "tokens_out": int(totals[3]),
        "included_usd": float(included) if included is not None else None,
        "budget_usd": budget,
        "budget_source": "ai_configuration" if cfg_budget is not None else "plan",
        "remaining_usd": round(max(0.0, budget - spend), 4) if budget is not None else None,
        "pct_used": round(100 * spend / budget, 1) if budget else None,
        "overage_usd": round(overage, 4),
        "overage_markup": markup,
        "overage_cost_usd": round(overage * markup, 2),
        "metered_billing_enabled": bool(
            gateway.is_configured() and gateway.billing_settings().STRIPE_PRICE_AI_METERED
        ),
        "reported_overage_cents": reported,
        "by_feature": [
            {"feature": f, "cost_usd": round(float(c or 0), 4), "requests": int(n)} for f, c, n in by_feature
        ],
        "by_day": [{"date": d.date(), "cost_usd": round(float(c or 0), 4)} for d, c in by_day],
    }


async def report_ai_usage(db: AsyncSession, org: Organisation) -> dict[str, Any]:
    """Report this period's AI overage (in cents, cumulative → delta) to a Stripe Billing Meter."""
    bs = gateway.billing_settings()
    if not gateway.is_configured() or not bs.STRIPE_PRICE_AI_METERED:
        return {"reported": False, "reason": "metered_billing_not_configured"}
    sub = await current_subscription(db, org.id)
    if not sub or not sub.stripe_customer_id or sub.status not in LIVE_STATUSES:
        return {"reported": False, "reason": "no_active_subscription"}
    usage = await ai_usage_summary(db, org)
    period_key = usage["period_start"].strftime("%Y-%m-%d")
    cents = int(round(usage["overage_cost_usd"] * 100))
    reported_map = dict((org.settings or {}).get("billing_ai_reported") or {})
    delta = cents - int(reported_map.get(period_key, 0))
    if delta <= 0:
        return {"reported": False, "reason": "nothing_new", "total_cents": cents}
    await gateway.report_meter_event(
        event_name=bs.STRIPE_AI_METER_EVENT_NAME,
        customer_id=sub.stripe_customer_id,
        value=delta,
        identifier=f"{org.id}:{period_key}:{cents}",
    )
    reported_map[period_key] = cents
    org.settings = {**(org.settings or {}), "billing_ai_reported": reported_map}
    await db.flush()
    return {"reported": True, "delta_cents": delta, "total_cents": cents}


# ----------------------------------------------------------------------------- webhooks


async def billing_admin_ids(db: AsyncSession, org_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await db.execute(
        select(OrganisationUser.user_id)
        .distinct()
        .join(membership_roles, membership_roles.c.membership_id == OrganisationUser.id)
        .join(role_permissions, role_permissions.c.role_id == membership_roles.c.role_id)
        .where(
            OrganisationUser.organisation_id == org_id,
            OrganisationUser.status == MembershipStatus.ACTIVE,
            role_permissions.c.permission_code == "billing.manage",
        )
    )
    return list(rows.scalars())


async def _notify_admins(
    db: AsyncSession, org_id: uuid.UUID, title: str, body: str, data: dict[str, Any]
) -> None:
    from app.modules.notifications.service import send_notification

    for uid in await billing_admin_ids(db, org_id):
        await send_notification(
            db,
            organisation_id=org_id,
            user_id=uid,
            type="billing_alert",
            title=title,
            body=body,
            link="/app/admin/billing",
            data=data,
        )


async def _audit(
    db: AsyncSession, org_id: uuid.UUID, action: str, entity_id: Any = None, **meta: Any
) -> None:
    await write_audit(
        db,
        action=action,
        organisation_id=org_id,
        actor_type="system",
        actor_label="stripe",
        entity_type="subscription",
        entity_id=entity_id,
        meta=meta or None,
    )


async def _resolve_org(db: AsyncSession, obj: dict[str, Any]) -> Organisation | None:
    candidates = [
        (obj.get("metadata") or {}).get("organisation_id"),
        obj.get("client_reference_id"),
        ((obj.get("subscription_details") or {}).get("metadata") or {}).get("organisation_id"),
    ]
    for raw in candidates:
        try:
            org = await db.get(Organisation, uuid.UUID(str(raw))) if raw else None
        except ValueError:
            org = None
        if org is not None:
            return org
    sub_id = obj.get("subscription") if obj.get("object") != "subscription" else obj.get("id")
    if isinstance(sub_id, dict):
        sub_id = sub_id.get("id")
    lookups = []
    if sub_id:
        lookups.append(Subscription.stripe_subscription_id == sub_id)
    if obj.get("customer"):
        lookups.append(Subscription.stripe_customer_id == obj["customer"])
    for cond in lookups:
        org_id = await db.scalar(select(Subscription.organisation_id).where(cond).limit(1))
        if org_id:
            return await db.get(Organisation, org_id)
    return None


async def _sub_for(db: AsyncSession, org: Organisation, stripe_sub_id: str | None) -> Subscription:
    sub = None
    if stripe_sub_id:
        sub = await db.scalar(
            select(Subscription).where(
                Subscription.organisation_id == org.id, Subscription.stripe_subscription_id == stripe_sub_id
            )
        )
    return sub or await ensure_subscription(db, org)


def _apply_org_plan(org: Organisation, plan_code: str, status: str, seats: int) -> None:
    s = dict(org.settings or {})
    if status in LIVE_STATUSES:
        org.plan_code = plan_code
        if get_plan(plan_code).seat_based:
            s["seats"] = seats
        else:
            s.pop("seats", None)
    elif status in (SubscriptionStatus.CANCELED, SubscriptionStatus.UNPAID):
        org.plan_code = "free"
        s.pop("seats", None)
    org.settings = s


async def _on_checkout_completed(db: AsyncSession, org: Organisation, obj: dict[str, Any]) -> None:
    meta = obj.get("metadata") or {}
    sub = await ensure_subscription(db, org)
    if obj.get("customer"):
        sub.stripe_customer_id = obj["customer"]
    stripe_sub_id = obj.get("subscription")
    if isinstance(stripe_sub_id, dict):
        stripe_sub_id = stripe_sub_id.get("id")
    if stripe_sub_id:
        sub.stripe_subscription_id = stripe_sub_id
    plan_code = meta.get("plan_code") if meta.get("plan_code") in PLANS else sub.plan_code
    seats = int(meta.get("seats") or sub.seats or 1)
    sub.plan_code, sub.seats = plan_code, seats
    sub.billing_interval = meta.get("interval") or sub.billing_interval
    if sub.status not in LIVE_STATUSES or sub.plan_code == "free":
        sub.status = SubscriptionStatus.ACTIVE
    _apply_org_plan(org, plan_code, sub.status, seats)
    await db.flush()
    await _audit(db, org.id, "billing.checkout_completed", sub.id, plan_code=plan_code, seats=seats)


async def _on_subscription_changed(
    db: AsyncSession, org: Organisation, obj: dict[str, Any], *, deleted: bool
) -> None:
    sub = await _sub_for(db, org, obj.get("id"))
    items = (obj.get("items") or {}).get("data") or []
    seat_item = _seat_item(obj) or (items[0] if items else {})
    price = (seat_item or {}).get("price") or {}
    from_price = plan_for_price_id(price.get("id"))
    meta = obj.get("metadata") or {}
    plan_code = (
        meta.get("plan_code")
        if meta.get("plan_code") in PLANS
        else (from_price[0] if from_price else sub.plan_code)
    )
    interval = (price.get("recurring") or {}).get("interval") or (from_price[1] if from_price else None)
    status = STATUS_MAP.get(obj.get("status", ""), obj.get("status") or sub.status)
    if deleted:
        status = SubscriptionStatus.CANCELED
    seats = int((seat_item or {}).get("quantity") or sub.seats or 1)

    sub.stripe_subscription_id = obj.get("id") or sub.stripe_subscription_id
    if obj.get("customer"):
        sub.stripe_customer_id = obj["customer"]
    sub.plan_code, sub.status, sub.seats = plan_code, status, seats
    if interval in ("month", "year"):
        sub.billing_interval = interval
    sub.trial_ends_at = _ts(obj.get("trial_end")) or sub.trial_ends_at
    sub.current_period_start = (
        _ts(obj.get("current_period_start") or (seat_item or {}).get("current_period_start"))
        or sub.current_period_start
    )
    sub.current_period_end = (
        _ts(obj.get("current_period_end") or (seat_item or {}).get("current_period_end"))
        or sub.current_period_end
    )
    sub.cancel_at_period_end = bool(obj.get("cancel_at_period_end"))
    sub.canceled_at = _ts(obj.get("canceled_at") or obj.get("ended_at")) or (_now() if deleted else None)
    if sub.trial_ends_at:
        org.settings = {**(org.settings or {}), "trial_used": True}
    _apply_org_plan(org, plan_code, status, seats)
    await db.flush()
    await _audit(
        db,
        org.id,
        "billing.subscription_deleted" if deleted else "billing.subscription_updated",
        sub.id,
        plan_code=plan_code,
        status=status,
        seats=seats,
    )
    if deleted:
        await _notify_admins(
            db,
            org.id,
            "Subscription ended",
            "Your subscription has ended and the organisation is now on the Free plan.",
            {"subscription_id": obj.get("id")},
        )


async def _on_invoice(db: AsyncSession, org: Organisation, obj: dict[str, Any], event_type: str) -> None:
    invoice_id = obj.get("id")
    payment = (
        await db.scalar(select(Payment).where(Payment.stripe_invoice_id == invoice_id))
        if invoice_id
        else None
    )
    if payment is None:
        payment = Payment(
            organisation_id=org.id, stripe_invoice_id=invoice_id, amount_cents=0, status="draft"
        )
        db.add(payment)
    status = obj.get("status") or payment.status
    if event_type == "invoice.paid":
        status = "paid"
    lines = (obj.get("lines") or {}).get("data") or []
    first = lines[0] if lines else {}
    payment.status = status
    payment.amount_cents = int((obj.get("amount_paid") if status == "paid" else obj.get("amount_due")) or 0)
    payment.currency = (obj.get("currency") or gateway.billing_settings().BILLING_CURRENCY)[:3]
    payment.description = (
        obj.get("description")
        or first.get("description")
        or (f"Invoice {obj['number']}" if obj.get("number") else None)
    )
    payment.hosted_invoice_url = obj.get("hosted_invoice_url") or payment.hosted_invoice_url
    payment.invoice_pdf_url = obj.get("invoice_pdf") or payment.invoice_pdf_url
    period = first.get("period") or {}
    payment.period_start = _ts(period.get("start") or obj.get("period_start"))
    payment.period_end = _ts(period.get("end") or obj.get("period_end"))
    paid_at = (obj.get("status_transitions") or {}).get("paid_at")
    if status == "paid":
        payment.paid_at = _ts(paid_at) or payment.paid_at or _now()
    await db.flush()

    stripe_sub_id = obj.get("subscription") or (
        (obj.get("parent") or {}).get("subscription_details") or {}
    ).get("subscription")
    sub = await current_subscription(db, org.id)
    if event_type == "invoice.payment_failed":
        if sub and (not stripe_sub_id or sub.stripe_subscription_id == stripe_sub_id):
            sub.status = SubscriptionStatus.PAST_DUE
        amount = f"{payment.amount_cents / 100:.2f} {payment.currency.upper()}"
        await _notify_admins(
            db,
            org.id,
            "Payment failed",
            f"We couldn't collect payment of {amount}. "
            "Please update your payment method to avoid interruption.",
            {"invoice_id": invoice_id, "amount_cents": payment.amount_cents},
        )
        await _audit(
            db,
            org.id,
            "billing.payment_failed",
            payment.id,
            invoice_id=invoice_id,
            amount_cents=payment.amount_cents,
        )
    elif event_type == "invoice.paid":
        if sub and sub.status == SubscriptionStatus.PAST_DUE:
            sub.status = SubscriptionStatus.ACTIVE
        await _audit(
            db,
            org.id,
            "billing.invoice_paid",
            payment.id,
            invoice_id=invoice_id,
            amount_cents=payment.amount_cents,
        )
    await db.flush()


HANDLED_EVENTS = {
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
    "invoice.finalized",
}


async def handle_webhook(db: AsyncSession, payload: bytes, signature: str | None) -> dict[str, Any]:
    secret = settings.STRIPE_WEBHOOK_SECRET
    if not secret:
        raise ServiceUnavailable("Billing webhooks are not configured", code="billing_not_configured")
    try:
        gateway.verify_signature(payload, signature, secret)
    except stripe.SignatureVerificationError as exc:
        raise BadRequest("Invalid Stripe signature", code="invalid_signature") from exc
    try:
        event = json.loads(payload)
        event_id, event_type = str(event["id"]), str(event["type"])
        obj = event["data"]["object"]
    except (ValueError, KeyError, TypeError) as exc:
        raise BadRequest("Malformed event payload") from exc

    await bind_tenant(db, None, bypass=True)  # tenant unknown until the event is resolved to an organisation
    inserted = (
        await db.execute(
            pg_insert(StripeEvent)
            .values(id=event_id[:64], type=event_type[:64])
            .on_conflict_do_nothing(index_elements=["id"])
            .returning(StripeEvent.id)
        )
    ).scalar()
    if inserted is None:
        return {"received": True, "duplicate": True, "type": event_type}
    if event_type not in HANDLED_EVENTS:
        return {"received": True, "handled": False, "type": event_type}
    org = await _resolve_org(db, obj)
    if org is None:
        log.warning("billing.webhook_unresolved", event_id=event_id, type=event_type)
        return {"received": True, "handled": False, "type": event_type, "reason": "organisation_not_found"}
    await bind_tenant(db, org.id)
    if event_type == "checkout.session.completed":
        await _on_checkout_completed(db, org, obj)
    elif event_type.startswith("customer.subscription."):
        await _on_subscription_changed(db, org, obj, deleted=event_type.endswith(".deleted"))
    else:
        await _on_invoice(db, org, obj, event_type)
    return {"received": True, "handled": True, "type": event_type, "organisation_id": str(org.id)}
