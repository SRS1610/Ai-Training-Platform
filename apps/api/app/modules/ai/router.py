"""/ai: AI configuration (provider, model, limits, budgets), usage reporting and provider catalogue."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.auth.deps import Ctx, require_permission
from app.modules.ai import service
from app.modules.ai.schemas import AIConfigOut, AIConfigUpdate, BudgetCheckOut, ProviderInfo, UsageOut

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/config", response_model=AIConfigOut)
async def get_config(ctx: Ctx = Depends(require_permission("ai.manage"))) -> AIConfigOut:
    """Organisation AI configuration. Provider keys are never returned — only whether the server has them."""
    return await service.config_out(ctx)


@router.put("/config", response_model=AIConfigOut)
async def put_config(body: AIConfigUpdate, ctx: Ctx = Depends(require_permission("ai.manage"))) -> AIConfigOut:
    return await service.update_config(ctx, body)


@router.get("/usage", response_model=UsageOut)
async def get_usage(ctx: Ctx = Depends(require_permission("ai.manage"))) -> UsageOut:
    return await service.usage_out(ctx)


@router.get("/providers", response_model=list[ProviderInfo])
async def get_providers(ctx: Ctx = Depends(require_permission("ai.manage"))) -> list[ProviderInfo]:
    return service.providers_out()


@router.post("/budget/check", response_model=BudgetCheckOut)
async def run_budget_check(ctx: Ctx = Depends(require_permission("ai.manage"))) -> BudgetCheckOut:
    """Evaluate budget thresholds now (also runs every 15 minutes via the ``ai.budget_check`` task)."""
    from app.modules.ai import gateway

    created = await gateway.check_budget_alerts(ctx.db, ctx.org_id)
    return BudgetCheckOut(organisation_id=ctx.org_id, new_alerts=created)
