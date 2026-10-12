"""AI configuration and usage reporting services."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Integer, case, cast, func, select

from app.auth.deps import Ctx
from app.models.ai import AIBudgetAlert, AIConfiguration, AIUsage
from app.models.content import Course
from app.models.identity import User
from app.modules.ai import gateway
from app.modules.ai.schemas import (
    AIConfigOut,
    AIConfigUpdate,
    AlertOut,
    BudgetOut,
    DailyPoint,
    ProviderInfo,
    UsageBucket,
    UsageOut,
    UsageTotals,
)

PROVIDER_MODELS: dict[str, list[str]] = {
    "openai": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "gpt-5-mini", "gpt-5"],
    "anthropic": ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-haiku-4-5"],
    "azure_openai": ["<your deployment name>"],
    "google": ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
    "local": ["llama3.1", "mistral", "qwen2.5"],
    "offline": ["offline-demo"],
}


async def get_or_create_config(ctx: Ctx) -> AIConfiguration:
    cfg = await ctx.db.scalar(select(AIConfiguration).where(AIConfiguration.organisation_id == ctx.org_id))
    if cfg is None:
        from app.core.config import settings

        cfg = AIConfiguration(organisation_id=ctx.org_id, provider=settings.AI_DEFAULT_PROVIDER, model="",
                              embedding_model="", temperature=0.3, max_output_tokens=1500,
                              features=dict(gateway.DEFAULT_FEATURES), hard_limit=True,
                              alert_thresholds=[50, 75, 90, 100], per_user_daily_requests=200, tutor_behaviour={},
                              grading_mode="ai_assisted", knowledge_only=False)
        ctx.db.add(cfg)
        await ctx.db.flush()
    return cfg


async def config_out(ctx: Ctx) -> AIConfigOut:
    from app.modules.billing.plans import get_plan

    r = await gateway.resolve(ctx.db, ctx.org_id)
    cfg = r.config
    plan = get_plan(ctx.org.plan_code)
    return AIConfigOut(
        provider=r.configured_provider, effective_provider=r.provider, offline=r.offline,
        model=(cfg.model if cfg else "") or "", effective_model=r.model,
        embedding_model=(cfg.embedding_model if cfg else "") or "",
        temperature=r.temperature, max_output_tokens=r.max_output_tokens, features=r.features,
        monthly_budget_usd=float(cfg.monthly_budget_usd) if cfg and cfg.monthly_budget_usd is not None else None,
        plan_budget_usd=gateway.plan_budget(ctx.org), effective_budget_usd=r.budget_usd, hard_limit=r.hard_limit,
        alert_thresholds=r.alert_thresholds, per_user_daily_requests=r.per_user_daily_requests,
        tutor_behaviour=r.tutor_behaviour, grading_mode=r.grading_mode, knowledge_only=r.knowledge_only,
        server_keys=gateway.server_keys(),
        plan_features={k: v for k, v in plan.features.items() if k in ("ai_tutor", "ai_generation")},
        updated_at=cfg.updated_at if cfg else None,
    )


async def update_config(ctx: Ctx, body: AIConfigUpdate) -> AIConfigOut:
    cfg = await get_or_create_config(ctx)
    changes: dict[str, Any] = {}
    data = body.model_dump(exclude_unset=True, exclude={"clear_budget"})
    for key, value in data.items():
        if key == "features" and value is not None:
            value = {**gateway.DEFAULT_FEATURES, **(cfg.features or {}), **value}
        if key == "monthly_budget_usd" and value is None:
            continue
        if value is None and key not in ("per_user_daily_requests",):
            continue
        if getattr(cfg, key) != value:
            changes[key] = value
            setattr(cfg, key, value)
    if body.clear_budget and cfg.monthly_budget_usd is not None:
        cfg.monthly_budget_usd = None
        changes["monthly_budget_usd"] = None
    cfg.updated_by = ctx.user_id
    await ctx.db.flush()
    if changes:
        # Values only (no secrets are ever stored in AI configuration).
        await ctx.audit("ai.config.updated", "ai_configuration", cfg.id,
                        changes={k: (float(v) if isinstance(v, int | float) and not isinstance(v, bool) else v)
                                 for k, v in changes.items()})
    return await config_out(ctx)


def providers_out() -> list[ProviderInfo]:
    from praxis_ai.providers import PROVIDER_LABELS

    keys = gateway.server_keys()
    notes = {
        "anthropic": "No embeddings API — knowledge-base embeddings use OpenAI when configured, otherwise offline.",
        "azure_openai": "Set the model to your chat deployment name and embedding_model to your embedding deployment.",
        "offline": "Deterministic demo provider — no network, no cost; answers are extractive/template based.",
        "google": "Requires GOOGLE_API_KEY (or GEMINI_API_KEY) in the server environment.",
        "local": "Any OpenAI-compatible endpoint configured via LOCAL_MODEL_BASE_URL.",
    }
    return [ProviderInfo(id=p, name=PROVIDER_LABELS.get(p, p), configured=keys.get(p, False),
                         default_model=gateway.default_model_for(p), models=PROVIDER_MODELS.get(p, []),
                         supports_embeddings=p != "anthropic", notes=notes.get(p))
            for p in gateway.PROVIDER_NAMES]


def _bucket(rows: list[Any], labels: dict[Any, str] | None = None) -> list[UsageBucket]:
    return [UsageBucket(key=str(r[0]) if r[0] is not None else None,
                        label=(labels or {}).get(r[0]) if labels else (str(r[0]) if r[0] is not None else None),
                        requests=int(r[1] or 0), tokens_in=int(r[2] or 0), tokens_out=int(r[3] or 0),
                        cost_usd=round(float(r[4] or 0), 6)) for r in rows]


async def usage_out(ctx: Ctx) -> UsageOut:
    db = ctx.db
    start = gateway.month_start()
    base = [AIUsage.organisation_id == ctx.org_id, AIUsage.created_at >= start]
    agg = (func.count(), func.sum(AIUsage.tokens_in), func.sum(AIUsage.tokens_out), func.sum(AIUsage.cost_usd))
    tot = (await db.execute(select(*agg, func.sum(cast(case((AIUsage.success.is_(False), 1), else_=0), Integer)))
                            .where(*base))).one()
    totals = UsageTotals(requests=int(tot[0] or 0), tokens_in=int(tot[1] or 0), tokens_out=int(tot[2] or 0),
                         cost_usd=round(float(tot[3] or 0), 6), failures=int(tot[4] or 0))

    async def grouped(col: Any, limit: int | None = None) -> list[Any]:
        stmt = select(col, *agg).where(*base).group_by(col).order_by(func.sum(AIUsage.cost_usd).desc(),
                                                                       func.count().desc())
        if limit:
            stmt = stmt.limit(limit)
        return list((await db.execute(stmt)).all())

    by_feature = _bucket(await grouped(AIUsage.feature))
    by_model = _bucket(await grouped(AIUsage.model))
    user_rows = [r for r in await grouped(AIUsage.user_id, 11) if r[0] is not None][:10]
    users = {u.id: f"{u.full_name} <{u.email}>" for u in (await db.scalars(
        select(User).where(User.id.in_([r[0] for r in user_rows])))).all()} if user_rows else {}
    course_rows = [r for r in await grouped(AIUsage.course_id, 11) if r[0] is not None][:10]
    courses = {c.id: c.title for c in (await db.scalars(
        select(Course).where(Course.id.in_([r[0] for r in course_rows]), Course.organisation_id == ctx.org_id)
    )).all()} if course_rows else {}
    day = func.date_trunc("day", AIUsage.created_at).label("day")
    daily_rows = (await db.execute(select(day, func.count(), func.sum(AIUsage.cost_usd),
                                          func.sum(AIUsage.tokens_in + AIUsage.tokens_out))
                                   .where(*base).group_by(day).order_by(day))).all()
    by_day = {r[0].date(): r for r in daily_rows}
    today = datetime.now(UTC).date()
    daily: list[DailyPoint] = []
    d = start.date()
    while d <= today:
        r = by_day.get(d)
        daily.append(DailyPoint(date=d, requests=int(r[1]) if r else 0, cost_usd=round(float(r[2] or 0), 6) if r else 0,
                                tokens=int(r[3] or 0) if r else 0))
        d += timedelta(days=1)
    resolved = await gateway.resolve(db, ctx.org_id)
    spent = totals.cost_usd
    budget = resolved.budget_usd
    alerts = (await db.scalars(select(AIBudgetAlert).where(AIBudgetAlert.organisation_id == ctx.org_id)
                               .order_by(AIBudgetAlert.created_at.desc()).limit(24))).all()
    return UsageOut(
        period=start.strftime("%Y-%m"), period_start=start, totals=totals, by_feature=by_feature, by_model=by_model,
        by_user=_bucket(user_rows, users), by_course=_bucket(course_rows, courses), daily=daily,
        budget=BudgetOut(budget_usd=budget, spent_usd=round(spent, 6),
                         pct_used=round(100 * spent / budget, 2) if budget else None, hard_limit=resolved.hard_limit,
                         alert_thresholds=resolved.alert_thresholds,
                         remaining_usd=round(max(0.0, budget - spent), 6) if budget is not None else None),
        alerts=[AlertOut(period=a.period, threshold=a.threshold, spend_usd=float(a.spend_usd),
                         created_at=a.created_at) for a in alerts],
        offline=resolved.offline,
    )
