"""Departments: an organisation's (optionally nested) structure. Soft-deleted; children are re-parented."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select, update

from app.auth.deps import Ctx
from app.core.errors import BadRequest, NotFound
from app.models.tenancy import Department, Invitation, OrganisationUser, Team
from app.modules.departments.schemas import DepartmentCreate, DepartmentNode, DepartmentOut, DepartmentUpdate
from app.modules.users.service import get_membership


async def get_department(ctx: Ctx, department_id: uuid.UUID) -> Department:
    d = await ctx.db.scalar(
        select(Department).where(
            Department.id == department_id,
            Department.organisation_id == ctx.org_id,
            Department.deleted_at.is_(None),
        )
    )
    if d is None:
        raise NotFound("Department not found")
    return d


async def _counts(ctx: Ctx) -> tuple[dict[uuid.UUID, int], dict[uuid.UUID, int]]:
    members = dict(
        (
            await ctx.db.execute(
                select(OrganisationUser.department_id, func.count())
                .where(
                    OrganisationUser.organisation_id == ctx.org_id,
                    OrganisationUser.department_id.is_not(None),
                )
                .group_by(OrganisationUser.department_id)
            )
        )
        .tuples()
        .all()
    )
    teams = dict(
        (
            await ctx.db.execute(
                select(Team.department_id, func.count())
                .where(
                    Team.organisation_id == ctx.org_id,
                    Team.deleted_at.is_(None),
                    Team.department_id.is_not(None),
                )
                .group_by(Team.department_id)
            )
        )
        .tuples()
        .all()
    )
    return members, teams


def _out(d: Department, members: dict[uuid.UUID, int], teams: dict[uuid.UUID, int]) -> DepartmentOut:
    return DepartmentOut(
        id=d.id,
        name=d.name,
        description=d.description,
        parent_id=d.parent_id,
        manager_user_id=d.manager_user_id,
        member_count=members.get(d.id, 0),
        team_count=teams.get(d.id, 0),
        created_at=d.created_at,
    )


async def department_out(ctx: Ctx, d: Department) -> DepartmentOut:
    members, teams = await _counts(ctx)
    return _out(d, members, teams)


async def list_departments(ctx: Ctx, q: str | None = None) -> list[DepartmentOut]:
    stmt = select(Department).where(Department.organisation_id == ctx.org_id, Department.deleted_at.is_(None))
    if q:
        stmt = stmt.where(Department.name.ilike(f"%{q.strip()}%"))
    rows = (await ctx.db.execute(stmt.order_by(Department.name))).scalars().all()
    members, teams = await _counts(ctx)
    return [_out(d, members, teams) for d in rows]


async def tree(ctx: Ctx) -> list[DepartmentNode]:
    flat = await list_departments(ctx)
    nodes = {d.id: DepartmentNode(**d.model_dump()) for d in flat}
    roots: list[DepartmentNode] = []
    for node in nodes.values():
        parent = nodes.get(node.parent_id) if node.parent_id else None
        (parent.children if parent else roots).append(node)
    return roots


async def _validate_refs(ctx: Ctx, data: dict, department_id: uuid.UUID | None = None) -> None:
    if data.get("manager_user_id"):
        await get_membership(ctx.db, ctx.org_id, data["manager_user_id"])
    parent_id = data.get("parent_id")
    if parent_id:
        if parent_id == department_id:
            raise BadRequest("A department cannot be its own parent", code="department_cycle")
        cursor = await get_department(ctx, parent_id)
        seen: set[uuid.UUID] = set()
        while cursor.parent_id and cursor.id not in seen:  # walk up to detect cycles
            seen.add(cursor.id)
            if cursor.parent_id == department_id:
                raise BadRequest("This would create a cycle in the department tree", code="department_cycle")
            parent = await ctx.db.get(Department, cursor.parent_id)
            if parent is None:
                break
            cursor = parent


async def create_department(ctx: Ctx, body: DepartmentCreate) -> DepartmentOut:
    data = body.model_dump()
    await _validate_refs(ctx, data)
    d = Department(organisation_id=ctx.org_id, **data)
    ctx.db.add(d)
    await ctx.db.flush()
    await ctx.db.refresh(d)
    await ctx.audit("department.created", "department", d.id, name=d.name)
    return await department_out(ctx, d)


async def update_department(ctx: Ctx, department_id: uuid.UUID, body: DepartmentUpdate) -> DepartmentOut:
    d = await get_department(ctx, department_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is None:
        data.pop("name")
    await _validate_refs(ctx, data, department_id)
    for k, v in data.items():
        setattr(d, k, v)
    await ctx.db.flush()
    await ctx.db.refresh(d)
    await ctx.audit("department.updated", "department", d.id, fields=sorted(data.keys()))
    return await department_out(ctx, d)


async def delete_department(ctx: Ctx, department_id: uuid.UUID) -> None:
    d = await get_department(ctx, department_id)
    org = ctx.org_id
    await ctx.db.execute(
        update(Department)
        .where(Department.organisation_id == org, Department.parent_id == d.id)
        .values(parent_id=d.parent_id)
    )
    await ctx.db.execute(
        update(OrganisationUser)
        .where(OrganisationUser.organisation_id == org, OrganisationUser.department_id == d.id)
        .values(department_id=None)
    )
    await ctx.db.execute(
        update(Team).where(Team.organisation_id == org, Team.department_id == d.id).values(department_id=None)
    )
    await ctx.db.execute(
        update(Invitation)
        .where(Invitation.organisation_id == org, Invitation.department_id == d.id)
        .values(department_id=None)
    )
    d.deleted_at = datetime.now(UTC)
    await ctx.db.flush()
    await ctx.audit("department.deleted", "department", d.id, name=d.name)
