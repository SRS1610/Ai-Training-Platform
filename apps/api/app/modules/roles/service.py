"""Organisation roles: system roles (copied templates) and custom roles with an explicit permission set."""

from __future__ import annotations

import re
import uuid

from sqlalchemy import func, select

from app.auth.deps import Ctx
from app.auth.rbac import ORG_CODES
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound
from app.models.tenancy import OrganisationUser, Permission, Role, membership_roles
from app.modules.roles.schemas import RoleCreate, RoleOut, RoleUpdate


async def _member_counts(ctx: Ctx) -> dict[uuid.UUID, int]:
    rows = await ctx.db.execute(
        select(membership_roles.c.role_id, func.count())
        .join(OrganisationUser, OrganisationUser.id == membership_roles.c.membership_id)
        .where(OrganisationUser.organisation_id == ctx.org_id)
        .group_by(membership_roles.c.role_id))
    return dict(rows.tuples().all())


def _out(role: Role, count: int = 0) -> RoleOut:
    return RoleOut(id=role.id, key=role.key, name=role.name, description=role.description, is_system=role.is_system,
                   permissions=sorted(p.code for p in role.permissions), member_count=count,
                   created_at=role.created_at, updated_at=role.updated_at)


async def list_roles(ctx: Ctx) -> list[RoleOut]:
    roles = (await ctx.db.execute(select(Role).where(Role.organisation_id == ctx.org_id)
                                  .order_by(Role.is_system.desc(), Role.name))).scalars().all()
    counts = await _member_counts(ctx)
    return [_out(r, counts.get(r.id, 0)) for r in roles]


async def catalogue(ctx: Ctx) -> list[Permission]:
    rows = (await ctx.db.execute(select(Permission).where(Permission.code.in_(ORG_CODES))
                                 .order_by(Permission.category, Permission.code))).scalars().all()
    return list(rows)


async def get_role(ctx: Ctx, role_id: uuid.UUID) -> Role:
    role = await ctx.db.scalar(select(Role).where(Role.id == role_id, Role.organisation_id == ctx.org_id))
    if role is None:
        raise NotFound("Role not found")
    return role


async def role_out(ctx: Ctx, role: Role) -> RoleOut:
    return _out(role, (await _member_counts(ctx)).get(role.id, 0))


async def _permissions(ctx: Ctx, codes: list[str]) -> list[Permission]:
    codes = sorted(set(codes))
    invalid = [c for c in codes if c not in ORG_CODES]
    if invalid:
        raise BadRequest("Unknown or non-assignable permission(s)", code="invalid_permission",
                         details={"permissions": invalid})
    if not ctx.principal.is_superadmin:
        excess = [c for c in codes if c not in ctx.permissions]
        if excess:
            raise Forbidden("You cannot grant permissions you do not have", code="privilege_escalation",
                            details={"permissions": excess})
    if not codes:
        return []
    return list((await ctx.db.execute(select(Permission).where(Permission.code.in_(codes)))).scalars().all())


def _key_from_name(name: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    if not key or not key[0].isalpha():
        key = f"role_{key}".rstrip("_")
    return key[:64]


async def create_role(ctx: Ctx, body: RoleCreate) -> RoleOut:
    key = body.key or _key_from_name(body.name)
    if await ctx.db.scalar(select(Role.id).where(Role.organisation_id == ctx.org_id, Role.key == key)):
        raise Conflict("A role with this key already exists", code="role_exists")
    role = Role(organisation_id=ctx.org_id, key=key, name=body.name.strip(), description=body.description,
                is_system=False, permissions=await _permissions(ctx, body.permissions))
    ctx.db.add(role)
    await ctx.db.flush()
    await ctx.db.refresh(role)
    await ctx.audit("role.created", "role", role.id, key=key, permissions=sorted(p.code for p in role.permissions))
    return _out(role)


async def update_role(ctx: Ctx, role_id: uuid.UUID, body: RoleUpdate) -> RoleOut:
    role = await get_role(ctx, role_id)
    data = body.model_dump(exclude_unset=True)
    changes: dict[str, object] = {}
    if "permissions" in data and data["permissions"] is not None:
        if role.is_system and not ctx.principal.is_superadmin:
            raise Forbidden("Permissions of system roles cannot be changed", code="system_role")
        before = sorted(p.code for p in role.permissions)
        perms = await _permissions(ctx, data["permissions"])
        after = sorted(p.code for p in perms)
        if before != after:
            role.permissions = perms
            changes["permissions"] = {"before": before, "after": after}
    for field in ("name", "description"):
        if field in data and data[field] is not None and getattr(role, field) != data[field]:
            changes[field] = data[field]
            setattr(role, field, data[field])
    await ctx.db.flush()
    await ctx.db.refresh(role)
    if changes:
        await ctx.audit("role.updated", "role", role.id, key=role.key, changes=changes)
    return await role_out(ctx, role)


async def delete_role(ctx: Ctx, role_id: uuid.UUID) -> None:
    role = await get_role(ctx, role_id)
    if role.is_system:
        raise Forbidden("System roles cannot be deleted", code="system_role")
    in_use = await ctx.db.scalar(select(func.count()).select_from(membership_roles)
                                 .where(membership_roles.c.role_id == role.id))
    if in_use:
        raise Conflict(f"This role is assigned to {in_use} member(s). Reassign them first.", code="role_in_use",
                       details={"member_count": int(in_use)})
    await ctx.audit("role.deleted", "role", role.id, key=role.key)
    await ctx.db.delete(role)
    await ctx.db.flush()
