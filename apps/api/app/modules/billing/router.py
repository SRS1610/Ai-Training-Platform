"""/billing: plan catalogue (public), subscription, Stripe Checkout / Customer Portal, seats, cancel/resume,
invoices, AI usage pricing and the Stripe webhook (public, signature verified, idempotent)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx, require_permission
from app.core.db import DbSession
from app.core.pagination import Page, PageParams, page_params, paginate
from app.models.platform import Payment
from app.modules.billing import service
from app.modules.billing.plans import public_catalogue
from app.modules.billing.schemas import (
    CheckoutIn,
    CheckoutOut,
    PaymentOut,
    PlanOut,
    SeatsIn,
    SubscriptionOut,
    UrlOut,
    UsageOut,
)

router = APIRouter(prefix="/billing", tags=["billing"])
public_router = APIRouter(prefix="/billing", tags=["billing"])

_billing = require_permission("billing.manage")


@public_router.get("/plans", response_model=list[PlanOut])
async def list_plans() -> list[PlanOut]:
    return [PlanOut(**p) for p in public_catalogue()]


@public_router.post("/webhook", include_in_schema=False)
async def stripe_webhook(request: Request, db: AsyncSession = DbSession) -> dict:
    payload = await request.body()
    return await service.handle_webhook(db, payload, request.headers.get("stripe-signature"))


@router.get("/subscription", response_model=SubscriptionOut)
async def get_subscription(ctx: Ctx = Depends(_billing)) -> SubscriptionOut:
    return SubscriptionOut.model_validate(await service.subscription_view(ctx.db, ctx.org))


@router.post("/checkout", response_model=CheckoutOut)
async def checkout(body: CheckoutIn, ctx: Ctx = Depends(_billing)) -> CheckoutOut:
    result = await service.start_checkout(
        ctx.db,
        ctx.org,
        email=ctx.user.email,
        plan_code=body.plan_code,
        interval=body.interval,
        seats=body.seats,
        coupon=body.coupon,
        promotion_code=body.promotion_code,
        trial_days=body.trial_days,
    )
    await ctx.audit(
        "billing.checkout_started",
        "subscription",
        None,
        plan_code=body.plan_code,
        interval=body.interval,
        seats=result["seats"],
        trial_days=result["trial_days"],
    )
    return CheckoutOut(**result)


@router.post("/portal", response_model=UrlOut)
async def portal(ctx: Ctx = Depends(_billing)) -> UrlOut:
    return UrlOut(url=await service.portal_url(ctx.db, ctx.org))


@router.post("/subscription/seats", response_model=SubscriptionOut)
async def change_seats(body: SeatsIn, ctx: Ctx = Depends(_billing)) -> SubscriptionOut:
    sub = await service.change_seats(ctx.db, ctx.org, body.seats)
    await ctx.audit("billing.seats_changed", "subscription", sub.id, seats=body.seats)
    return SubscriptionOut.model_validate(await service.subscription_view(ctx.db, ctx.org))


@router.post("/subscription/cancel", response_model=SubscriptionOut)
async def cancel(ctx: Ctx = Depends(_billing)) -> SubscriptionOut:
    sub = await service.set_cancel_at_period_end(ctx.db, ctx.org, True)
    await ctx.audit("billing.subscription_cancel_requested", "subscription", sub.id)
    return SubscriptionOut.model_validate(await service.subscription_view(ctx.db, ctx.org))


@router.post("/subscription/resume", response_model=SubscriptionOut)
async def resume(ctx: Ctx = Depends(_billing)) -> SubscriptionOut:
    sub = await service.set_cancel_at_period_end(ctx.db, ctx.org, False)
    await ctx.audit("billing.subscription_resumed", "subscription", sub.id)
    return SubscriptionOut.model_validate(await service.subscription_view(ctx.db, ctx.org))


@router.get("/invoices", response_model=Page[PaymentOut])
async def invoices(
    params: PageParams = Depends(page_params), ctx: Ctx = Depends(_billing)
) -> Page[PaymentOut]:
    stmt = select(Payment).where(Payment.organisation_id == ctx.org_id).order_by(Payment.created_at.desc())
    items, total = await paginate(ctx.db, stmt, params)
    return Page(
        items=[PaymentOut.model_validate(p) for p in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.get("/usage", response_model=UsageOut)
async def usage(ctx: Ctx = Depends(_billing)) -> UsageOut:
    return UsageOut.model_validate(await service.ai_usage_summary(ctx.db, ctx.org))
