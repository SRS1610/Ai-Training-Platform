"""Super-admin platform administration. Every state change is written to the platform audit chain
(``organisation_id = NULL``) and, when it targets an organisation, to that organisation's chain too."""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Select, func, or_, select, text

from app.auth.deps import Ctx
from app.core.audit import write_audit
from app.core.errors import BadRequest, Conflict, NotFound
from app.core.metrics import metrics
from app.core.pagination import PageParams
from app.core.redis import get_redis
from app.models.ai import AIUsage
from app.models.content import Course, StoredFile
from app.models.identity import User
from app.models.learning import Enrolment
from app.models.platform import Subscription
from app.models.tenancy import (
    MembershipStatus,
    Organisation,
    OrganisationUser,
    OrgStatus,
    Role,
    membership_roles,
)
from app.modules.billing import plans
from app.modules.platform.schemas import (
    PlanChange,
    PlatformOrgDetail,
    PlatformOrgOut,
    PlatformUserOut,
    SubscriptionSummary,
    UserRef,
)

QUEUE_NAMES = ("default", "ai")


async def _audit(
    ctx: Ctx, action: str, entity_type: str, entity_id: Any, org_id: uuid.UUID | None = None, **meta: Any
) -> None:
    for chain in [None, org_id] if org_id else [None]:
        await write_audit(
            ctx.db,
            action=action,
            organisation_id=chain,
            actor_user_id=ctx.principal.user_id,
            actor_label=ctx.principal.label,
            entity_type=entity_type,
            entity_id=entity_id,
            meta={**meta, "platform": True, **({"organisation_id": str(org_id)} if org_id else {})},
            ip_address=ctx.ip,
            user_agent=ctx.user_agent,
            request_id=ctx.request_id,
        )


def _member_count():  # noqa: ANN202
    return (
        select(func.count())
        .select_from(OrganisationUser)
        .where(OrganisationUser.organisation_id == Organisation.id)
        .scalar_subquery()
    )


def _course_count():  # noqa: ANN202
    return (
        select(func.count())
        .select_from(Course)
        .where(Course.organisation_id == Organisation.id, Course.deleted_at.is_(None))
        .scalar_subquery()
    )


def _org_out(org: Organisation, members: int, courses: int) -> PlatformOrgOut:
    return PlatformOrgOut(
        id=org.id,
        name=org.name,
        slug=org.slug,
        kind=org.kind,
        status=org.status,
        plan_code=org.plan_code,
        member_count=int(members or 0),
        course_count=int(courses or 0),
        custom_domain=org.custom_domain,
        feature_overrides=dict((org.settings or {}).get("feature_overrides") or {}),
        created_at=org.created_at,
        deleted_at=org.deleted_at,
    )


async def list_orgs(
    ctx: Ctx, params: PageParams, q: str | None, status: str | None, plan: str | None, include_deleted: bool
) -> tuple[list[PlatformOrgOut], int]:
    base: Select = select(Organisation)
    if not include_deleted:
        base = base.where(Organisation.deleted_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        base = base.where(
            or_(
                Organisation.name.ilike(like),
                Organisation.slug.ilike(like),
                Organisation.custom_domain.ilike(like),
            )
        )
    if status:
        base = base.where(Organisation.status == status)
    if plan:
        base = base.where(Organisation.plan_code == plan)
    total = int(await ctx.db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    stmt = (
        base.add_columns(_member_count().label("members"), _course_count().label("courses"))
        .order_by(Organisation.created_at.desc())
        .limit(params.page_size)
        .offset(params.offset)
    )
    rows = (await ctx.db.execute(stmt)).all()
    return [_org_out(o, m, c) for o, m, c in rows], total


async def _get_org(ctx: Ctx, org_id: uuid.UUID) -> Organisation:
    org = await ctx.db.get(Organisation, org_id)
    if org is None:
        raise NotFound("Organisation not found")
    return org


async def org_detail(ctx: Ctx, org_id: uuid.UUID) -> PlatformOrgDetail:
    org = await _get_org(ctx, org_id)
    members = await ctx.db.scalar(
        select(func.count()).select_from(OrganisationUser).where(OrganisationUser.organisation_id == org.id)
    )
    courses = await ctx.db.scalar(
        select(func.count())
        .select_from(Course)
        .where(Course.organisation_id == org.id, Course.deleted_at.is_(None))
    )
    admins = (
        (
            await ctx.db.execute(
                select(User)
                .join(OrganisationUser, OrganisationUser.user_id == User.id)
                .join(membership_roles, membership_roles.c.membership_id == OrganisationUser.id)
                .join(Role, Role.id == membership_roles.c.role_id)
                .where(
                    OrganisationUser.organisation_id == org.id,
                    Role.key == "org_admin",
                    OrganisationUser.status == MembershipStatus.ACTIVE,
                )
                .order_by(User.email)
            )
        )
        .scalars()
        .unique()
        .all()
    )
    sub = await ctx.db.scalar(
        select(Subscription)
        .where(Subscription.organisation_id == org.id)
        .order_by(Subscription.created_at.desc())
        .limit(1)
    )
    storage = await ctx.db.scalar(
        select(func.coalesce(func.sum(StoredFile.size_bytes), 0)).where(
            StoredFile.organisation_id == org.id, StoredFile.deleted_at.is_(None)
        )
    )
    ai_cost = await ctx.db.scalar(
        select(func.coalesce(func.sum(AIUsage.cost_usd), 0)).where(
            AIUsage.organisation_id == org.id, AIUsage.created_at > datetime.now(UTC) - timedelta(days=30)
        )
    )
    enrolments = await ctx.db.scalar(
        select(func.count()).select_from(Enrolment).where(Enrolment.organisation_id == org.id)
    )
    base = _org_out(org, members or 0, courses or 0)
    return PlatformOrgDetail(
        **base.model_dump(),
        settings=dict(org.settings or {}),
        admins=[UserRef(id=u.id, email=u.email, full_name=u.full_name) for u in admins],
        subscription=SubscriptionSummary(
            plan_code=sub.plan_code,
            status=sub.status,
            seats=sub.seats,
            billing_interval=sub.billing_interval,
            current_period_end=sub.current_period_end,
            cancel_at_period_end=sub.cancel_at_period_end,
        )
        if sub
        else None,
        storage_bytes=int(storage or 0),
        ai_cost_30d_usd=float(ai_cost or 0),
        enrolment_count=int(enrolments or 0),
    )


async def set_org_status(ctx: Ctx, org_id: uuid.UUID, suspend: bool, reason: str | None) -> PlatformOrgDetail:
    org = await _get_org(ctx, org_id)
    if org.deleted_at or org.status == OrgStatus.CLOSED:
        raise Conflict("Closed organisations cannot be changed", code="organisation_closed")
    target = OrgStatus.SUSPENDED if suspend else OrgStatus.ACTIVE
    if org.status != target:
        org.status = target
        await ctx.db.flush()
        await _audit(
            ctx,
            "platform.org_suspended" if suspend else "platform.org_reactivated",
            "organisation",
            org.id,
            org_id=org.id,
            reason=reason,
        )
    return await org_detail(ctx, org_id)


async def change_plan(ctx: Ctx, org_id: uuid.UUID, body: PlanChange) -> PlatformOrgDetail:
    org = await _get_org(ctx, org_id)
    changes: dict[str, Any] = {}
    settings_ = dict(org.settings or {})
    if body.plan_code is not None:
        if body.plan_code not in plans.PLANS:
            raise BadRequest(f"Unknown plan: {body.plan_code}", code="unknown_plan")
        if body.plan_code != org.plan_code:
            changes["plan_code"] = {"before": org.plan_code, "after": body.plan_code}
            org.plan_code = body.plan_code
    if body.feature_overrides is not None:
        known = set().union(*(p.features.keys() for p in plans.PLANS.values()))
        unknown = sorted(set(body.feature_overrides) - known)
        if unknown:
            raise BadRequest("Unknown feature(s)", code="unknown_feature", details={"features": unknown})
        overrides = dict(settings_.get("feature_overrides") or {})
        for k, v in body.feature_overrides.items():
            if v is None:
                overrides.pop(k, None)
            else:
                overrides[k] = bool(v)
        settings_["feature_overrides"] = overrides
        changes["feature_overrides"] = overrides
    if body.seats is not None:
        settings_["seats"] = body.seats
        changes["seats"] = body.seats
    org.settings = settings_
    await ctx.db.flush()
    if changes:
        await _audit(ctx, "platform.org_plan_changed", "organisation", org.id, org_id=org.id, changes=changes)
    return await org_detail(ctx, org_id)


async def list_users(
    ctx: Ctx, params: PageParams, q: str | None, superadmin: bool | None, status: str | None
) -> tuple[list[PlatformUserOut], int]:
    base: Select = select(User)
    if q:
        like = f"%{q.strip()}%"
        base = base.where(or_(User.email.ilike(like), User.full_name.ilike(like)))
    if superadmin is not None:
        base = base.where(User.is_superadmin.is_(superadmin))
    if status:
        base = base.where(User.status == status)
    total = int(await ctx.db.scalar(select(func.count()).select_from(base.subquery())) or 0)
    org_count = (
        select(func.count())
        .select_from(OrganisationUser)
        .where(OrganisationUser.user_id == User.id)
        .scalar_subquery()
    )
    rows = (
        await ctx.db.execute(
            base.add_columns(org_count.label("orgs"))
            .order_by(User.created_at.desc())
            .limit(params.page_size)
            .offset(params.offset)
        )
    ).all()
    return [
        PlatformUserOut(
            id=u.id,
            email=u.email,
            full_name=u.full_name,
            status=u.status,
            is_superadmin=u.is_superadmin,
            mfa_enabled=u.mfa_enabled,
            organisation_count=int(n or 0),
            created_at=u.created_at,
            last_login_at=u.last_login_at,
        )
        for u, n in rows
    ], total


async def set_superadmin(ctx: Ctx, user_id: uuid.UUID, value: bool) -> PlatformUserOut:
    user = await ctx.db.get(User, user_id)
    if user is None or user.deleted_at:
        raise NotFound("User not found")
    if not value and user.id == ctx.principal.user_id:
        raise BadRequest("You cannot revoke your own super admin access", code="self_action")
    if user.is_superadmin != value:
        user.is_superadmin = value
        await ctx.db.flush()
        await _audit(
            ctx,
            "platform.superadmin_granted" if value else "platform.superadmin_revoked",
            "user",
            user.id,
            email=user.email,
        )
    n = await ctx.db.scalar(
        select(func.count()).select_from(OrganisationUser).where(OrganisationUser.user_id == user.id)
    )
    return PlatformUserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        status=user.status,
        is_superadmin=user.is_superadmin,
        mfa_enabled=user.mfa_enabled,
        organisation_count=int(n or 0),
        created_at=user.created_at,
        last_login_at=user.last_login_at,
    )


async def health(ctx: Ctx) -> dict[str, Any]:
    status = "ok"
    t0 = time.perf_counter()
    try:
        await ctx.db.execute(text("SELECT 1"))
        database = {"status": "ok", "latency_ms": round((time.perf_counter() - t0) * 1000, 2)}
    except Exception as exc:  # pragma: no cover - the request would normally fail earlier
        database, status = {"status": "error", "error": type(exc).__name__}, "error"
    redis_info: dict[str, Any]
    queue: dict[str, Any] = {}
    try:
        r = get_redis()
        t1 = time.perf_counter()
        await r.ping()
        redis_info = {"status": "ok", "latency_ms": round((time.perf_counter() - t1) * 1000, 2)}
        for name in QUEUE_NAMES:
            queue[name] = int(await r.llen(name))
        queue["status"] = "ok"
    except Exception as exc:  # noqa: BLE001 - Redis down is reported, not raised
        redis_info = {"status": "unavailable", "error": type(exc).__name__}
        queue = {"status": "unknown"}
        status = "degraded" if status == "ok" else status
    storage_bytes = await ctx.db.scalar(
        select(func.coalesce(func.sum(StoredFile.size_bytes), 0)).where(StoredFile.deleted_at.is_(None))
    )
    file_count = await ctx.db.scalar(
        select(func.count()).select_from(StoredFile).where(StoredFile.deleted_at.is_(None))
    )
    since = datetime.now(UTC) - timedelta(hours=24)
    ai_calls = await ctx.db.scalar(
        select(func.count()).select_from(AIUsage).where(AIUsage.created_at > since)
    )
    ai_errors = await ctx.db.scalar(
        select(func.count())
        .select_from(AIUsage)
        .where(AIUsage.created_at > since, AIUsage.success.is_(False))
    )
    snap = metrics.snapshot()
    totals = {
        "organisations": int(
            await ctx.db.scalar(
                select(func.count()).select_from(Organisation).where(Organisation.deleted_at.is_(None))
            )
            or 0
        ),
        "users": int(
            await ctx.db.scalar(select(func.count()).select_from(User).where(User.deleted_at.is_(None))) or 0
        ),
    }
    return {
        "status": status,
        "database": database,
        "redis": redis_info,
        "queue": queue,
        "storage": {"bytes": int(storage_bytes or 0), "files": int(file_count or 0)},
        "ai": {
            "calls_24h": int(ai_calls or 0),
            "errors_24h": int(ai_errors or 0),
            "errors_since_start": snap.get("ai_errors", 0),
        },
        "totals": totals,
        "metrics": snap,
    }
