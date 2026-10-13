"""Billing: plans, subscription view, Stripe Checkout/Portal/seats/cancel (Stripe mocked), signed + idempotent
webhooks syncing Subscription / Payment / organisation plan, AI usage pricing and metered reporting."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.core.db import get_sessionmaker
from app.models.ai import AIUsage
from app.models.platform import AuditLog, Notification, Payment, StripeEvent, Subscription
from app.models.tenancy import Organisation
from app.modules.billing import gateway, service
from tests.factories import add_member, set_plan, signup
from tests.ops_seed import tenant_session

API = "/api/v1/billing"
WHSEC = "whsec_test_secret"


@pytest.fixture
def stripe_on(monkeypatch):
    """Configure Stripe keys/prices and capture outbound Stripe calls."""
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", WHSEC)
    monkeypatch.setenv("STRIPE_PRICE_BUSINESS_MONTHLY", "price_bus_m")
    monkeypatch.setenv("STRIPE_PRICE_BUSINESS_ANNUAL", "price_bus_y")
    monkeypatch.setenv("STRIPE_PRICE_PROFESSIONAL_MONTHLY", "price_pro_m")
    calls: dict[str, list] = {"customer": [], "checkout": [], "portal": [], "modify": [], "meter": []}

    async def create_customer(**kw):
        calls["customer"].append(kw)
        return {"id": "cus_123"}

    async def create_checkout_session(**kw):
        calls["checkout"].append(kw)
        return {"id": "cs_test_1", "url": "https://checkout.stripe.com/c/pay/cs_test_1"}

    async def create_portal_session(**kw):
        calls["portal"].append(kw)
        return {"url": "https://billing.stripe.com/p/session/x"}

    async def retrieve_subscription(sub_id):
        return {
            "id": sub_id,
            "items": {
                "data": [
                    {
                        "id": "si_seat",
                        "quantity": 5,
                        "price": {"id": "price_bus_m", "recurring": {"interval": "month"}},
                    }
                ]
            },
        }

    async def modify_subscription(sub_id, **kw):
        calls["modify"].append((sub_id, kw))
        return {"id": sub_id, **kw}

    async def find_promotion_code(code):
        return "promo_abc" if code == "WELCOME20" else None

    async def report_meter_event(**kw):
        calls["meter"].append(kw)
        return {}

    for name, fn in list(locals().items()):
        if name in {
            "create_customer",
            "create_checkout_session",
            "create_portal_session",
            "retrieve_subscription",
            "modify_subscription",
            "find_promotion_code",
            "report_meter_event",
        }:
            monkeypatch.setattr(gateway, name, fn)
    gateway.billing_settings.cache_clear()
    yield calls
    gateway.billing_settings.cache_clear()


def signed(payload: dict, secret: str = WHSEC, ts: int | None = None) -> tuple[bytes, dict[str, str]]:
    body = json.dumps(payload).encode()
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return body, {"Stripe-Signature": f"t={ts},v1={sig}", "Content-Type": "application/json"}


def event(type_: str, obj: dict, event_id: str | None = None) -> dict:
    return {
        "id": event_id or f"evt_{uuid.uuid4().hex[:16]}",
        "object": "event",
        "type": type_,
        "data": {"object": obj},
    }


async def _org(org_id) -> Organisation:
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        return await s.get(Organisation, org_id)


async def _sub(org_id) -> Subscription:
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        return await s.scalar(
            select(Subscription)
            .where(Subscription.organisation_id == org_id)
            .order_by(Subscription.created_at.desc())
            .limit(1)
        )


async def test_plans_public_and_subscription_view(client):
    r = await client.get(f"{API}/plans")
    assert r.status_code == 200
    plans = {p["code"]: p for p in r.json()}
    assert set(plans) == {"free", "individual", "professional", "business", "enterprise"}
    assert plans["business"]["trial_days"] == 14 and plans["business"]["seat_based"] is True
    assert plans["enterprise"]["contact_sales"] is True

    admin = await signup(client)
    r = await client.get(f"{API}/subscription", headers=admin.headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["plan"]["code"] == "free" and body["seats_used"] == 1 and body["seat_limit"] == 5
    assert body["billing_configured"] is False

    learner = await add_member(admin.org_id, "learner")
    for method, path in [
        ("get", "/subscription"),
        ("post", "/checkout"),
        ("post", "/portal"),
        ("get", "/invoices"),
        ("get", "/usage"),
        ("post", "/subscription/cancel"),
    ]:
        r = await client.request(
            method.upper(),
            f"{API}{path}",
            headers=learner.headers,
            json={"plan_code": "business"} if path == "/checkout" else None,
        )
        assert r.status_code == 403, (path, r.status_code)


async def test_seat_limit_mirrors_enforcement_for_agreements(client):
    """Enterprise with no recorded seat number: no purchased count and no limit (null), matching check_limit."""
    admin = await signup(client)
    await set_plan(admin.org_id, "enterprise")
    body = (await client.get(f"{API}/subscription", headers=admin.headers)).json()
    assert body["plan"]["code"] == "enterprise"
    assert body["seat_limit"] is None and body["seats_purchased"] is None and body["seats_used"] == 1
    r = await client.post(
        f"{API}/invitations", headers=admin.headers, json={"invitations": [{"email": "a@ent.test", "roles": ["learner"]}]}
    )
    assert r.status_code in (200, 201), r.text  # not blocked by a phantom 1-seat limit

    await set_plan(admin.org_id, "enterprise", seats=40)
    body = (await client.get(f"{API}/subscription", headers=admin.headers)).json()
    assert body["seat_limit"] == 40 and body["seats_purchased"] == 40


async def test_mutations_unavailable_without_stripe(client, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", None)
    admin = await signup(client)
    r = await client.post(f"{API}/checkout", headers=admin.headers, json={"plan_code": "business"})
    assert r.status_code == 503 and r.json()["error"]["message"] == "Billing is not configured"
    assert (await client.post(f"{API}/portal", headers=admin.headers)).status_code == 503
    assert (
        await client.post(f"{API}/subscription/seats", headers=admin.headers, json={"seats": 3})
    ).status_code == 503
    assert (await client.get(f"{API}/invoices", headers=admin.headers)).status_code == 200
    assert (await client.get(f"{API}/usage", headers=admin.headers)).status_code == 200


async def test_checkout_session_with_trial_and_promo(client, stripe_on):
    admin = await signup(client)
    await add_member(admin.org_id, "learner")
    r = await client.post(
        f"{API}/checkout",
        headers=admin.headers,
        json={"plan_code": "business", "interval": "month", "seats": 1, "promotion_code": "WELCOME20"},
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["url"].startswith("https://checkout.stripe.com") and out["trial_days"] == 14
    assert out["seats"] == 2  # never fewer seats than current members
    params = stripe_on["checkout"][-1]
    assert params["mode"] == "subscription" and params["customer"] == "cus_123"
    assert params["line_items"] == [{"price": "price_bus_m", "quantity": 2}]
    assert params["subscription_data"]["trial_period_days"] == 14
    assert params["subscription_data"]["metadata"]["organisation_id"] == str(admin.org_id)
    assert params["discounts"] == [{"promotion_code": "promo_abc"}]
    assert (await _sub(admin.org_id)).stripe_customer_id == "cus_123"

    r = await client.post(
        f"{API}/checkout", headers=admin.headers, json={"plan_code": "business", "promotion_code": "BOGUS"}
    )
    assert r.status_code == 400
    r = await client.post(
        f"{API}/checkout", headers=admin.headers, json={"plan_code": "professional", "interval": "year"}
    )
    assert r.status_code == 503  # no annual price configured for professional
    r = await client.post(f"{API}/checkout", headers=admin.headers, json={"plan_code": "enterprise"})
    assert r.status_code == 422
    r = await client.post(f"{API}/portal", headers=admin.headers)
    assert r.status_code == 200 and r.json()["url"].startswith("https://billing.stripe.com")
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        actions = await s.execute(select(AuditLog.action).where(AuditLog.organisation_id == admin.org_id))
        assert "billing.checkout_started" in actions.scalars().all()


async def test_webhook_signature_and_idempotency(client, stripe_on):
    admin = await signup(client)
    obj = {
        "id": "cs_1",
        "object": "checkout.session",
        "customer": "cus_W1",
        "subscription": "sub_W1",
        "client_reference_id": str(admin.org_id),
        "metadata": {
            "organisation_id": str(admin.org_id),
            "plan_code": "business",
            "interval": "month",
            "seats": "10",
        },
    }
    evt = event("checkout.session.completed", obj, "evt_checkout_1")
    body, headers = signed(evt, secret="whsec_wrong")
    assert (await client.post(f"{API}/webhook", content=body, headers=headers)).status_code == 400
    body, headers = signed(evt, ts=int(time.time()) - 3600)  # outside tolerance
    assert (await client.post(f"{API}/webhook", content=body, headers=headers)).status_code == 400
    assert (await client.post(f"{API}/webhook", content=json.dumps(evt).encode())).status_code == 400

    body, headers = signed(evt)
    r = await client.post(f"{API}/webhook", content=body, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["handled"] is True
    org = await _org(admin.org_id)
    assert org.plan_code == "business" and org.settings["seats"] == 10
    sub = await _sub(admin.org_id)
    assert sub.stripe_subscription_id == "sub_W1" and sub.stripe_customer_id == "cus_W1" and sub.seats == 10

    r = await client.post(f"{API}/webhook", content=body, headers=headers)
    assert r.status_code == 200 and r.json()["duplicate"] is True
    async with get_sessionmaker()() as s:
        assert (
            await s.scalar(
                select(func.count()).select_from(StripeEvent).where(StripeEvent.id == "evt_checkout_1")
            )
            == 1
        )


async def test_webhook_subscription_lifecycle_and_invoices(client, stripe_on):
    admin = await signup(client)
    org_id = admin.org_id
    now = int(time.time())
    sub_obj = {
        "id": "sub_L1",
        "object": "subscription",
        "customer": "cus_L1",
        "status": "trialing",
        "metadata": {"organisation_id": str(org_id)},
        "cancel_at_period_end": False,
        "trial_end": now + 14 * 86400,
        "canceled_at": None,
        "items": {
            "data": [
                {
                    "id": "si_1",
                    "quantity": 7,
                    "current_period_start": now,
                    "current_period_end": now + 30 * 86400,
                    "price": {"id": "price_bus_y", "recurring": {"interval": "year"}},
                }
            ]
        },
    }
    for evt in (event("customer.subscription.created", sub_obj),):
        body, headers = signed(evt)
        assert (await client.post(f"{API}/webhook", content=body, headers=headers)).status_code == 200
    org = await _org(org_id)
    sub = await _sub(org_id)
    assert org.plan_code == "business" and org.settings["seats"] == 7 and org.settings["trial_used"] is True
    assert sub.status == "trialing" and sub.billing_interval == "year" and sub.trial_ends_at is not None
    view = (await client.get(f"{API}/subscription", headers=admin.headers)).json()
    assert view["is_trialing"] is True and view["trial_days_remaining"] == 14 and view["seats_purchased"] == 7

    # invoice finalized then paid -> payments table
    inv = {
        "id": "in_1",
        "object": "invoice",
        "customer": "cus_L1",
        "subscription": "sub_L1",
        "status": "open",
        "amount_due": 20300,
        "amount_paid": 0,
        "currency": "aud",
        "number": "PRX-0001",
        "hosted_invoice_url": "https://invoice.stripe.com/i/x",
        "invoice_pdf": "https://pay.stripe.com/x.pdf",
        "lines": {
            "data": [{"description": "7 × Business", "period": {"start": now, "end": now + 86400 * 30}}]
        },
        "status_transitions": {"paid_at": None},
    }
    for evt in (
        event("invoice.finalized", inv),
        event(
            "invoice.paid",
            {**inv, "status": "paid", "amount_paid": 20300, "status_transitions": {"paid_at": now}},
        ),
    ):
        body, headers = signed(evt)
        assert (await client.post(f"{API}/webhook", content=body, headers=headers)).status_code == 200
    r = await client.get(f"{API}/invoices", headers=admin.headers)
    assert r.json()["total"] == 1
    p = r.json()["items"][0]
    assert p["status"] == "paid" and p["amount_cents"] == 20300 and p["description"] == "7 × Business"
    assert p["paid_at"] is not None

    # payment failure -> past_due + admin notification
    body, headers = signed(event("invoice.payment_failed", {**inv, "id": "in_2", "amount_due": 999}))
    assert (await client.post(f"{API}/webhook", content=body, headers=headers)).status_code == 200
    assert (await _sub(org_id)).status == "past_due"
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        notes = (
            (
                await s.execute(
                    select(Notification).where(
                        Notification.user_id == admin.user_id, Notification.type == "billing_alert"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert any(n.title == "Payment failed" for n in notes)

    # seats / cancel / resume through the API
    r = await client.post(f"{API}/subscription/seats", headers=admin.headers, json={"seats": 12})
    assert r.status_code == 200, r.text
    assert stripe_on["modify"][-1] == (
        "sub_L1",
        {"items": [{"id": "si_seat", "quantity": 12}], "proration_behavior": "create_prorations"},
    )
    assert r.json()["seats_purchased"] == 12
    r = await client.post(f"{API}/subscription/cancel", headers=admin.headers)
    assert r.json()["cancel_at_period_end"] is True
    r = await client.post(f"{API}/subscription/resume", headers=admin.headers)
    assert r.json()["cancel_at_period_end"] is False
    # Cannot start a second checkout while subscribed
    assert (
        await client.post(f"{API}/checkout", headers=admin.headers, json={"plan_code": "business"})
    ).status_code == 409

    # deletion -> back to free
    body, headers = signed(
        event("customer.subscription.deleted", {**sub_obj, "status": "canceled", "ended_at": now})
    )
    assert (await client.post(f"{API}/webhook", content=body, headers=headers)).status_code == 200
    org = await _org(org_id)
    assert org.plan_code == "free" and "seats" not in org.settings
    assert (await _sub(org_id)).status == "canceled"


async def test_webhook_unknown_org_and_unhandled_types(client, stripe_on):
    body, headers = signed(event("invoice.paid", {"id": "in_x", "customer": "cus_nobody", "status": "paid"}))
    r = await client.post(f"{API}/webhook", content=body, headers=headers)
    assert r.status_code == 200 and r.json()["handled"] is False
    body, headers = signed(event("charge.refunded", {"id": "ch_1"}))
    assert (await client.post(f"{API}/webhook", content=body, headers=headers)).json()["handled"] is False


async def test_ai_usage_and_metered_reporting(client, stripe_on, monkeypatch):
    admin = await signup(client)
    await set_plan(admin.org_id, "professional")
    org_id = admin.org_id
    now = datetime.now(UTC)
    async with tenant_session(org_id) as s:
        from app.models.ai import AIConfiguration

        cfg = await s.scalar(select(AIConfiguration).where(AIConfiguration.organisation_id == org_id))
        cfg.monthly_budget_usd = None
        for feature, cost in [("tutor", "30.00"), ("generation", "25.00"), ("tutor", "5.00")]:
            s.add(
                AIUsage(
                    organisation_id=org_id,
                    created_at=now,
                    feature=feature,
                    provider="openai",
                    model="gpt-4o-mini",
                    tokens_in=100,
                    tokens_out=50,
                    cost_usd=Decimal(cost),
                )
            )
        s.add(
            AIUsage(
                organisation_id=org_id,
                created_at=now - timedelta(days=70),
                feature="tutor",
                provider="openai",
                model="gpt-4o-mini",
                cost_usd=Decimal("100"),
            )
        )
    r = await client.get(f"{API}/usage", headers=admin.headers)
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["spend_usd"] == 60.0 and u["included_usd"] == 50.0 and u["budget_source"] == "plan"
    assert u["overage_usd"] == 10.0 and u["overage_cost_usd"] == 12.5 and u["pct_used"] == 120.0
    assert u["by_feature"][0] == {"feature": "tutor", "cost_usd": 35.0, "requests": 2}

    # metered reporting: not configured -> no-op; configured -> delta reported once
    async with tenant_session(org_id) as s:
        org = await s.get(Organisation, org_id)
        assert (await service.report_ai_usage(s, org))["reported"] is False
    monkeypatch.setenv("STRIPE_PRICE_AI_METERED", "price_ai_metered")
    gateway.billing_settings.cache_clear()
    async with tenant_session(org_id) as s:
        sub = await service.current_subscription(s, org_id)
        sub.stripe_customer_id, sub.status = "cus_M1", "active"
    async with tenant_session(org_id) as s:
        org = await s.get(Organisation, org_id)
        res = await service.report_ai_usage(s, org)
        assert res == {"reported": True, "delta_cents": 1250, "total_cents": 1250}
    async with tenant_session(org_id) as s:
        org = await s.get(Organisation, org_id)
        assert (await service.report_ai_usage(s, org))["reason"] == "nothing_new"
    assert len(stripe_on["meter"]) == 1 and stripe_on["meter"][0]["value"] == 1250


async def test_payments_tenant_isolated(client, stripe_on):
    a = await signup(client, org_name="Bill A")
    b = await signup(client, org_name="Bill B")
    async with tenant_session(a.org_id) as s:
        s.add(
            Payment(
                organisation_id=a.org_id,
                stripe_invoice_id=f"in_{uuid.uuid4().hex[:8]}",
                amount_cents=100,
                status="paid",
            )
        )
    assert (await client.get(f"{API}/invoices", headers=a.headers)).json()["total"] == 1
    assert (await client.get(f"{API}/invoices", headers=b.headers)).json()["total"] == 0
