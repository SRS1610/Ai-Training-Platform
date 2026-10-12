"""Billing background tasks."""

from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy import select

from app.core.db import bind_tenant, system_session
from app.models.platform import Subscription
from app.models.tenancy import Organisation
from app.modules.billing import gateway, service
from app.workers import task

log = structlog.get_logger(__name__)


@task("billing.report_ai_usage")
async def report_ai_usage(**_: Any) -> dict[str, Any]:
    """Report AI overage for every org with a Stripe customer to the metered price (schedule hourly/daily)."""
    if not gateway.is_configured() or not gateway.billing_settings().STRIPE_PRICE_AI_METERED:
        return {"reported": 0, "skipped": "metered_billing_not_configured"}
    async with system_session() as db:
        org_ids = list(
            (
                await db.execute(
                    select(Subscription.organisation_id)
                    .distinct()
                    .where(Subscription.stripe_customer_id.is_not(None))
                )
            ).scalars()
        )
    reported = 0
    for org_id in org_ids:
        try:
            async with system_session() as db:
                await bind_tenant(db, org_id)
                org = await db.get(Organisation, org_id)
                if org is not None and (await service.report_ai_usage(db, org)).get("reported"):
                    reported += 1
        except Exception:
            log.exception("billing.report_ai_usage_failed", organisation_id=str(org_id))
    return {"reported": reported, "organisations": len(org_ids)}
