"""Organisation membership management: listing, profile fields, roles, suspension, removal, direct creation.

Also hosts the membership helpers (role lookup, privilege-escalation guard, last-admin protection) used by
the roles, invitations and privacy modules.
"""

from __future__ import annotations

import csv
import io
import secrets
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core import security
from app.core.config import settings
from app.core.email import send_email
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.core.events import emit
from app.core.pagination import PageParams, paginate
from app.models.identity import User, UserStatus
from app.models.learning import Enrolment
from app.models.tenancy import (
    Department,
    MembershipStatus,
    OrganisationUser,
    Role,
    Team,
    TeamMember,
    membership_roles,
)
from app.modules.billing import plans
from app.modules.users.schemas import (
    EnrolmentCounts,
    ImportResult,
    ImportRowError,
    MemberCreate,
    MemberCreated,
    MemberDetail,
    MemberOut,
    MemberUpdate,
    Ref,
)

ADMIN_ROLE = "org_admin"
MAX_IMPORT_ROWS = 1000
MAX_IMPORT_BYTES = 1024 * 1024


def _now() -> datetime:
    return datetime.now(UTC)


# ----------------------------------------------------------------------------- shared membership helpers


async def get_membership(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> OrganisationUser:
    """Load a membership of ``user_id`` in ``org_id`` or 404 (never reveals members of other orgs)."""
    m = await db.scalar(
        select(OrganisationUser).where(
            OrganisationUser.organisation_id == org_id, OrganisationUser.user_id == user_id
        )
    )
    if m is None:
        raise NotFound("Member not found")
    return m


async def roles_by_keys(db: AsyncSession, org_id: uuid.UUID, keys: list[str]) -> list[Role]:
    keys = sorted({k.strip() for k in keys if k and k.strip()})
    if not keys:
        raise BadRequest("At least one role is required", code="roles_required")
    roles = (
        (await db.execute(select(Role).where(Role.organisation_id == org_id, Role.key.in_(keys))))
        .scalars()
        .all()
    )
    missing = sorted(set(keys) - {r.key for r in roles})
    if missing:
        raise BadRequest(
            f"Unknown role(s): {', '.join(missing)}", code="unknown_role", details={"missing": missing}
        )
    return list(roles)


def ensure_can_grant(ctx: Ctx, roles: list[Role]) -> None:
    """Prevent privilege escalation: you can only hand out permissions you hold yourself."""
    if ctx.principal.is_superadmin:
        return
    granted = {p.code for r in roles for p in r.permissions}
    excess = sorted(granted - ctx.permissions)
    if excess:
        raise Forbidden(
            "You cannot grant permissions you do not have",
            code="privilege_escalation",
            details={"permissions": excess},
        )


def ensure_can_manage(ctx: Ctx, m: OrganisationUser) -> None:
    """Prevent privilege escalation by proxy: you may only suspend, remove or edit a member whose
    permissions are a subset of your own (e.g. a training manager cannot suspend an org admin)."""
    if ctx.principal.is_superadmin:
        return
    held = {p.code for r in m.roles for p in r.permissions}
    excess = sorted(held - ctx.permissions)
    if excess:
        raise Forbidden(
            "You cannot manage a member who holds permissions you do not have",
            code="insufficient_privileges",
            details={"permissions": excess},
        )


async def count_active_admins(
    db: AsyncSession, org_id: uuid.UUID, exclude_user_id: uuid.UUID | None = None
) -> int:
    stmt = (
        select(func.count(distinct(OrganisationUser.id)))
        .select_from(OrganisationUser)
        .join(membership_roles, membership_roles.c.membership_id == OrganisationUser.id)
        .join(Role, Role.id == membership_roles.c.role_id)
        .join(User, User.id == OrganisationUser.user_id)
        .where(
            OrganisationUser.organisation_id == org_id,
            OrganisationUser.status == MembershipStatus.ACTIVE,
            Role.key == ADMIN_ROLE,
            User.deleted_at.is_(None),
        )
    )
    if exclude_user_id:
        stmt = stmt.where(OrganisationUser.user_id != exclude_user_id)
    return int(await db.scalar(stmt) or 0)


def is_admin(m: OrganisationUser) -> bool:
    return any(r.key == ADMIN_ROLE for r in m.roles)


async def ensure_not_last_admin(db: AsyncSession, m: OrganisationUser) -> None:
    """Raise if ``m`` is an active org_admin and no other active org_admin would remain."""
    if m.status == MembershipStatus.ACTIVE and is_admin(m):
        if await count_active_admins(db, m.organisation_id, exclude_user_id=m.user_id) == 0:
            raise Conflict(
                "An organisation must keep at least one active organisation admin", code="last_admin"
            )


async def department_in_org(db: AsyncSession, org_id: uuid.UUID, department_id: uuid.UUID | None) -> None:
    if department_id is None:
        return
    found = await db.scalar(
        select(Department.id).where(
            Department.id == department_id,
            Department.organisation_id == org_id,
            Department.deleted_at.is_(None),
        )
    )
    if not found:
        raise BadRequest("Department not found", code="department_not_found")


# ----------------------------------------------------------------------------- serialisation


async def _department_names(db: AsyncSession, org_id: uuid.UUID, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = await db.execute(
        select(Department.id, Department.name).where(
            Department.organisation_id == org_id, Department.id.in_(ids)
        )
    )
    return dict(rows.tuples().all())


def _member_out(m: OrganisationUser, dept_names: dict[uuid.UUID, str]) -> MemberOut:
    u: User = m.user
    return MemberOut(
        user_id=u.id,
        membership_id=m.id,
        email=u.email,
        full_name=u.full_name,
        avatar_url=u.avatar_url,
        status=m.status,
        user_status=u.status,
        roles=sorted(r.key for r in m.roles),
        department_id=m.department_id,
        department_name=dept_names.get(m.department_id) if m.department_id else None,
        job_title=m.job_title,
        employee_id=m.employee_id,
        manager_user_id=m.manager_user_id,
        joined_at=m.joined_at,
        last_login_at=u.last_login_at,
        mfa_enabled=u.mfa_enabled,
        created_at=m.created_at,
    )


async def member_out(db: AsyncSession, m: OrganisationUser) -> MemberOut:
    names = await _department_names(db, m.organisation_id, {m.department_id} if m.department_id else set())
    return _member_out(m, names)


# ----------------------------------------------------------------------------- queries


async def list_members(
    ctx: Ctx,
    params: PageParams,
    *,
    q: str | None,
    role: str | None,
    department_id: uuid.UUID | None,
    team_id: uuid.UUID | None,
    status: str | None,
) -> tuple[list[MemberOut], int]:
    """Paginated, filterable member directory for the active organisation."""
    stmt = (
        select(OrganisationUser)
        .join(User, User.id == OrganisationUser.user_id)
        .where(OrganisationUser.organisation_id == ctx.org_id, User.deleted_at.is_(None))
    )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                User.email.ilike(like),
                User.full_name.ilike(like),
                OrganisationUser.employee_id.ilike(like),
                OrganisationUser.job_title.ilike(like),
            )
        )
    if role:
        stmt = stmt.where(
            OrganisationUser.id.in_(
                select(membership_roles.c.membership_id)
                .join(Role, Role.id == membership_roles.c.role_id)
                .where(Role.organisation_id == ctx.org_id, Role.key == role)
            )
        )
    if department_id:
        stmt = stmt.where(OrganisationUser.department_id == department_id)
    if team_id:
        stmt = stmt.where(
            OrganisationUser.user_id.in_(
                select(TeamMember.user_id).where(
                    TeamMember.team_id == team_id, TeamMember.organisation_id == ctx.org_id
                )
            )
        )
    if status:
        stmt = stmt.where(OrganisationUser.status == status)
    stmt = stmt.order_by(func.lower(User.full_name), User.email)
    rows, total = await paginate(ctx.db, stmt, params)
    names = await _department_names(ctx.db, ctx.org_id, {m.department_id for m in rows if m.department_id})
    return [_member_out(m, names) for m in rows], total


async def member_detail(ctx: Ctx, user_id: uuid.UUID) -> MemberDetail:
    m = await get_membership(ctx.db, ctx.org_id, user_id)
    base = await member_out(ctx.db, m)
    manager = None
    if m.manager_user_id:
        mgr = await ctx.db.get(User, m.manager_user_id)
        if mgr:
            manager = Ref(id=mgr.id, name=mgr.full_name)
    teams = (
        (
            await ctx.db.execute(
                select(Team.id, Team.name)
                .join(TeamMember, TeamMember.team_id == Team.id)
                .where(
                    TeamMember.user_id == user_id,
                    Team.organisation_id == ctx.org_id,
                    Team.deleted_at.is_(None),
                )
                .order_by(Team.name)
            )
        )
        .tuples()
        .all()
    )
    counts = EnrolmentCounts()
    for status, n in (
        await ctx.db.execute(
            select(Enrolment.status, func.count())
            .where(Enrolment.organisation_id == ctx.org_id, Enrolment.user_id == user_id)
            .group_by(Enrolment.status)
        )
    ).tuples():
        if hasattr(counts, status):
            setattr(counts, status, int(n))
        counts.total += int(n)
    return MemberDetail(
        **base.model_dump(), manager=manager, teams=[Ref(id=i, name=n) for i, n in teams], enrolments=counts
    )


# ----------------------------------------------------------------------------- commands


async def update_member(ctx: Ctx, user_id: uuid.UUID, body: MemberUpdate) -> MemberOut:
    m = await get_membership(ctx.db, ctx.org_id, user_id)
    if ctx.principal.user_id != user_id:
        ensure_can_manage(ctx, m)
    data = body.model_dump(exclude_unset=True)
    if "department_id" in data:
        await department_in_org(ctx.db, ctx.org_id, data["department_id"])
    if data.get("manager_user_id"):
        if data["manager_user_id"] == user_id:
            raise BadRequest("A member cannot be their own manager", code="invalid_manager")
        await get_membership(ctx.db, ctx.org_id, data["manager_user_id"])
    changes = {k: str(v) if isinstance(v, uuid.UUID) else v for k, v in data.items() if getattr(m, k) != v}
    for k, v in data.items():
        setattr(m, k, v)
    await ctx.db.flush()
    if changes:
        await ctx.audit("member.updated", "user", user_id, changes=changes)
    return await member_out(ctx.db, m)


async def set_roles(ctx: Ctx, user_id: uuid.UUID, role_keys: list[str]) -> MemberOut:
    m = await get_membership(ctx.db, ctx.org_id, user_id)
    roles = await roles_by_keys(ctx.db, ctx.org_id, role_keys)
    ensure_can_grant(ctx, roles)
    before = sorted(r.key for r in m.roles)
    after = sorted(r.key for r in roles)
    if ADMIN_ROLE in before and ADMIN_ROLE not in after:
        await ensure_not_last_admin(ctx.db, m)
    # Removing roles carrying permissions the caller lacks is also an escalation vector (demoting an admin).
    ensure_can_grant(ctx, [r for r in m.roles if r.key not in after])
    m.roles = roles
    await ctx.db.flush()
    if before != after:
        await ctx.audit("member.roles_changed", "user", user_id, before=before, after=after)
    return await member_out(ctx.db, m)


async def set_status(ctx: Ctx, user_id: uuid.UUID, suspend: bool) -> MemberOut:
    if ctx.principal.user_id == user_id:
        raise BadRequest("You cannot change your own membership status", code="self_action")
    m = await get_membership(ctx.db, ctx.org_id, user_id)
    ensure_can_manage(ctx, m)
    if suspend:
        if m.status == MembershipStatus.SUSPENDED:
            return await member_out(ctx.db, m)
        await ensure_not_last_admin(ctx.db, m)
        m.status = MembershipStatus.SUSPENDED
        action = "member.suspended"
    else:
        if m.status == MembershipStatus.ACTIVE:
            return await member_out(ctx.db, m)
        await plans.check_limit(ctx.db, ctx.org, "max_users")
        m.status = MembershipStatus.ACTIVE
        m.joined_at = m.joined_at or _now()
        action = "member.reactivated"
    await ctx.db.flush()
    await ctx.audit(action, "user", user_id)
    return await member_out(ctx.db, m)


async def remove_member(ctx: Ctx, user_id: uuid.UUID) -> None:
    if ctx.principal.user_id == user_id:
        raise BadRequest("You cannot remove yourself from the organisation", code="self_action")
    m = await get_membership(ctx.db, ctx.org_id, user_id)
    ensure_can_manage(ctx, m)
    await ensure_not_last_admin(ctx.db, m)
    await detach_membership(ctx.db, m)
    await ctx.audit("member.removed", "user", user_id, email=m.user.email)


async def detach_membership(db: AsyncSession, m: OrganisationUser) -> None:
    """Delete a membership and the user's org-local structure links (teams, manager references)."""
    org_id, user_id = m.organisation_id, m.user_id
    await db.execute(
        delete(TeamMember).where(TeamMember.organisation_id == org_id, TeamMember.user_id == user_id)
    )
    for other in (
        await db.execute(
            select(OrganisationUser).where(
                OrganisationUser.organisation_id == org_id, OrganisationUser.manager_user_id == user_id
            )
        )
    ).scalars():
        other.manager_user_id = None
    user = await db.get(User, user_id)
    if user and user.default_organisation_id == org_id:
        user.default_organisation_id = None
    await db.delete(m)
    await db.flush()


async def create_member(ctx: Ctx, body: MemberCreate) -> MemberCreated:
    """Create (or attach an existing) user account directly as an active member."""
    from app.modules.auth.service import get_user_by_email, normalise_email

    email = normalise_email(body.email)
    roles = await roles_by_keys(ctx.db, ctx.org_id, body.roles)
    ensure_can_grant(ctx, roles)
    await department_in_org(ctx.db, ctx.org_id, body.department_id)
    user = await get_user_by_email(ctx.db, email)
    if user and user.deleted_at:
        raise Conflict("This email address cannot be used", code="email_unavailable")
    if user and await ctx.db.scalar(
        select(OrganisationUser.id).where(
            OrganisationUser.organisation_id == ctx.org_id, OrganisationUser.user_id == user.id
        )
    ):
        raise Conflict("This user is already a member of the organisation", code="already_member")
    await plans.check_limit(ctx.db, ctx.org, "max_users")
    temp_password: str | None = None
    existing = user is not None
    if user is None:
        if body.password:
            problems = security.validate_password_strength(body.password)
            if problems:
                raise BadRequest(problems[0], details={"password": problems}, code="weak_password")
            password = body.password
        else:
            temp_password = password = f"{secrets.token_urlsafe(9)}-{secrets.token_hex(2)}"
        user = User(
            email=email,
            full_name=body.full_name.strip(),
            password_hash=security.hash_password(password),
            default_organisation_id=ctx.org_id,
            preferences={"must_change_password": True} if temp_password else {},
        )
        ctx.db.add(user)
        await ctx.db.flush()
    m = OrganisationUser(
        organisation_id=ctx.org_id,
        user_id=user.id,
        status=MembershipStatus.ACTIVE,
        joined_at=_now(),
        roles=roles,
        department_id=body.department_id,
        job_title=body.job_title,
        employee_id=body.employee_id,
        invited_by=ctx.principal.user_id,
    )
    ctx.db.add(m)
    await ctx.db.flush()
    await ctx.db.refresh(m, ["user"])
    await ctx.audit(
        "member.created",
        "user",
        user.id,
        email=email,
        roles=sorted(r.key for r in roles),
        existing_account=existing,
    )
    await emit(
        ctx.db,
        "member.joined",
        {"organisation_id": ctx.org_id, "user_id": user.id, "membership_id": m.id, "via": "direct"},
    )
    if body.send_email:
        paragraphs = [f"Hi {user.full_name},", f"You've been added to {ctx.org.name} on {settings.APP_NAME}."]
        if temp_password:
            paragraphs.append(
                "Your administrator will share a temporary password with you. "
                "Please change it after your first sign-in."
            )
        await send_email(
            email,
            f"You've been added to {ctx.org.name}",
            paragraphs,
            f"{settings.PUBLIC_WEB_URL}/login",
            "Sign in",
        )
    out = await member_out(ctx.db, m)
    return MemberCreated(**out.model_dump(), temporary_password=temp_password, existing_account=existing)


# ----------------------------------------------------------------------------- CSV import


def _parse_csv(data: bytes) -> list[dict[str, str]]:
    if len(data) > MAX_IMPORT_BYTES:
        raise BadRequest("CSV file is too large (max 1 MB)", code="import_too_large")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise BadRequest("CSV must be UTF-8 encoded", code="import_encoding") from exc
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "email" not in [f.strip().lower() for f in reader.fieldnames]:
        raise BadRequest("CSV must have a header row with an 'email' column", code="import_header")
    rows = []
    for raw in reader:
        rows.append({(k or "").strip().lower(): (v or "").strip() for k, v in raw.items() if k})
        if len(rows) > MAX_IMPORT_ROWS:
            raise BadRequest(f"CSV has more than {MAX_IMPORT_ROWS} rows", code="import_too_many_rows")
    return rows


async def import_csv(ctx: Ctx, data: bytes, default_roles: list[str]) -> ImportResult:
    """Bulk-invite members from CSV (columns: email, role|roles [; separated], department). Each valid row
    becomes an invitation; invalid rows are reported and skipped. All-or-nothing on the plan seat limit."""
    from email_validator import EmailNotValidError, validate_email

    from app.modules.invitations import service as invitations

    rows = _parse_csv(data)
    depts = {
        name.lower(): did
        for did, name in (
            await ctx.db.execute(
                select(Department.id, Department.name).where(
                    Department.organisation_id == ctx.org_id, Department.deleted_at.is_(None)
                )
            )
        ).tuples()
    }
    org_roles = {
        r.key: r
        for r in (await ctx.db.execute(select(Role).where(Role.organisation_id == ctx.org_id))).scalars()
    }
    errors: list[ImportRowError] = []
    valid: list[tuple[str, list[str], uuid.UUID | None]] = []
    seen: set[str] = set()
    for i, row in enumerate(rows, start=2):  # row 1 is the header
        email_raw = row.get("email", "")
        try:
            email = validate_email(email_raw, check_deliverability=False).normalized.lower()
        except EmailNotValidError:
            errors.append(ImportRowError(row=i, email=email_raw or None, error="Invalid email address"))
            continue
        if email in seen:
            errors.append(ImportRowError(row=i, email=email, error="Duplicate email in file"))
            continue
        seen.add(email)
        role_field = row.get("roles") or row.get("role") or ""
        keys = [k.strip() for k in role_field.replace("|", ";").replace(",", ";").split(";") if k.strip()]
        keys = keys or default_roles
        unknown = [k for k in keys if k not in org_roles]
        if unknown:
            errors.append(ImportRowError(row=i, email=email, error=f"Unknown role(s): {', '.join(unknown)}"))
            continue
        try:
            ensure_can_grant(ctx, [org_roles[k] for k in keys])
        except Forbidden:
            errors.append(ImportRowError(row=i, email=email, error="You cannot grant these roles"))
            continue
        dept_name = row.get("department", "")
        dept_id = depts.get(dept_name.lower()) if dept_name else None
        if dept_name and dept_id is None:
            errors.append(ImportRowError(row=i, email=email, error=f"Unknown department: {dept_name}"))
            continue
        problem = await invitations.invite_blocker(ctx, email)
        if problem:
            errors.append(ImportRowError(row=i, email=email, error=problem))
            continue
        valid.append((email, keys, dept_id))
    created = await invitations.create_many(ctx, valid, source="csv_import")
    await ctx.audit("member.imported", "organisation", ctx.org_id, invited=len(created), errors=len(errors))
    return ImportResult(invited=len(created), invitation_ids=[inv.id for inv in created], errors=errors)


def user_is_active(user: User) -> bool:
    return user.status == UserStatus.ACTIVE and user.deleted_at is None


def as_meta(**kw: Any) -> dict[str, Any]:
    return {k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in kw.items()}
