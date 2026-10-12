"""Invitations: create / bulk / resend / revoke (tenant scoped) and the public lookup + accept flow.

Tokens are random, emailed once and stored only as a keyed hash. Public lookups run with RLS bypass and then
bind to the invitation's organisation.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core import security
from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import tenant_scope
from app.core.email import send_email
from app.core.errors import BadRequest, Conflict, Forbidden, NotFound, Unauthorized
from app.core.events import emit
from app.core.pagination import PageParams, paginate
from app.models.identity import User
from app.models.platform import Consent
from app.models.tenancy import Invitation, MembershipStatus, Organisation, OrganisationUser, OrgStatus, Role
from app.modules.billing import plans
from app.modules.invitations.schemas import InvitationCreate, InvitationLookup, InvitationOut
from app.modules.users.service import department_in_org, ensure_can_grant, roles_by_keys


def _now() -> datetime:
    return datetime.now(UTC)


def invitation_status(inv: Invitation) -> str:
    if inv.accepted_at:
        return "accepted"
    if inv.revoked_at:
        return "revoked"
    if inv.expires_at < _now():
        return "expired"
    return "pending"


def to_out(inv: Invitation) -> InvitationOut:
    out = InvitationOut.model_validate(inv)
    out.status = invitation_status(inv)
    return out


def accept_url(raw: str) -> str:
    return f"{settings.PUBLIC_WEB_URL}/accept-invite?token={raw}"


async def _send_invite_email(ctx: Ctx, inv: Invitation, raw: str) -> None:
    inviter = ctx.principal.user.full_name if ctx.principal.user else ctx.org.name
    await send_email(
        inv.email,
        f"You're invited to join {ctx.org.name}",
        [
            f"{inviter} has invited you to join {ctx.org.name} on {settings.APP_NAME}.",
            f"This invitation expires in {settings.INVITATION_TTL_DAYS} days.",
        ],
        accept_url(raw),
        "Accept invitation",
    )


async def invite_blocker(ctx: Ctx, email: str) -> str | None:
    """Return a reason why ``email`` cannot be invited to the active org, or None."""
    user = await ctx.db.scalar(select(User).where(User.email == email.lower()))
    if user is None:
        return None
    if user.deleted_at:
        return "This email address cannot be used"
    if await ctx.db.scalar(
        select(OrganisationUser.id).where(
            OrganisationUser.organisation_id == ctx.org_id, OrganisationUser.user_id == user.id
        )
    ):
        return "Already a member of this organisation"
    return None


async def create_many(
    ctx: Ctx, items: list[tuple[str, list[str], uuid.UUID | None]], *, source: str = "manual"
) -> list[Invitation]:
    """Create invitations for validated ``(email, role_keys, department_id)`` tuples. Any still-pending
    invitation for the same email is superseded (revoked) so only the newest link works."""
    if not items:
        return []
    emails = [e for e, _, _ in items]
    await ctx.db.execute(
        update(Invitation)
        .where(
            Invitation.organisation_id == ctx.org_id,
            Invitation.email.in_(emails),
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
        )
        .values(revoked_at=_now())
    )
    await plans.check_limit(ctx.db, ctx.org, "max_users", increment=len(items))
    created: list[tuple[Invitation, str]] = []
    for email, keys, dept in items:
        raw = security.generate_token(32)
        inv = Invitation(
            organisation_id=ctx.org_id,
            email=email,
            role_keys=sorted(set(keys)),
            department_id=dept,
            token_hash=security.hash_token(raw),
            invited_by=ctx.principal.user_id,
            expires_at=_now() + timedelta(days=settings.INVITATION_TTL_DAYS),
        )
        ctx.db.add(inv)
        created.append((inv, raw))
    await ctx.db.flush()
    for inv, raw in created:
        await ctx.audit(
            "invitation.created", "invitation", inv.id, email=inv.email, roles=inv.role_keys, source=source
        )
        await _send_invite_email(ctx, inv, raw)
    return [inv for inv, _ in created]


async def _validate_roles_dept(ctx: Ctx, keys: list[str], department_id: uuid.UUID | None) -> list[str]:
    roles = await roles_by_keys(ctx.db, ctx.org_id, keys)
    ensure_can_grant(ctx, roles)
    await department_in_org(ctx.db, ctx.org_id, department_id)
    return [r.key for r in roles]


async def create_invitation(ctx: Ctx, body: InvitationCreate) -> Invitation:
    keys = await _validate_roles_dept(ctx, body.roles, body.department_id)
    email = str(body.email).lower()
    problem = await invite_blocker(ctx, email)
    if problem:
        raise Conflict(problem, code="cannot_invite")
    return (await create_many(ctx, [(email, keys, body.department_id)]))[0]


async def bulk_create(
    ctx: Ctx, emails: list[str], role_keys: list[str], department_id: uuid.UUID | None
) -> tuple[list[Invitation], list[tuple[str, str]]]:
    keys = await _validate_roles_dept(ctx, role_keys, department_id)
    errors: list[tuple[str, str]] = []
    valid: list[tuple[str, list[str], uuid.UUID | None]] = []
    seen: set[str] = set()
    for e in emails:
        email = str(e).lower()
        if email in seen:
            continue
        seen.add(email)
        problem = await invite_blocker(ctx, email)
        if problem:
            errors.append((email, problem))
        else:
            valid.append((email, keys, department_id))
    return await create_many(ctx, valid, source="bulk"), errors


async def list_invitations(
    ctx: Ctx, params: PageParams, status: str | None, q: str | None
) -> tuple[list[Invitation], int]:
    stmt = select(Invitation).where(Invitation.organisation_id == ctx.org_id)
    now = _now()
    if status == "pending":
        stmt = stmt.where(
            Invitation.accepted_at.is_(None), Invitation.revoked_at.is_(None), Invitation.expires_at >= now
        )
    elif status == "expired":
        stmt = stmt.where(
            Invitation.accepted_at.is_(None), Invitation.revoked_at.is_(None), Invitation.expires_at < now
        )
    elif status == "accepted":
        stmt = stmt.where(Invitation.accepted_at.is_not(None))
    elif status == "revoked":
        stmt = stmt.where(Invitation.revoked_at.is_not(None))
    if q:
        stmt = stmt.where(Invitation.email.ilike(f"%{q.strip()}%"))
    return await paginate(ctx.db, stmt.order_by(Invitation.created_at.desc()), params)


async def _get(ctx: Ctx, invitation_id: uuid.UUID) -> Invitation:
    inv = await ctx.db.scalar(
        select(Invitation).where(Invitation.id == invitation_id, Invitation.organisation_id == ctx.org_id)
    )
    if inv is None:
        raise NotFound("Invitation not found")
    return inv


async def revoke(ctx: Ctx, invitation_id: uuid.UUID) -> None:
    inv = await _get(ctx, invitation_id)
    if inv.accepted_at:
        raise Conflict("Invitation has already been accepted", code="invitation_accepted")
    if not inv.revoked_at:
        inv.revoked_at = _now()
        await ctx.db.flush()
        await ctx.audit("invitation.revoked", "invitation", inv.id, email=inv.email)


async def resend(ctx: Ctx, invitation_id: uuid.UUID) -> Invitation:
    inv = await _get(ctx, invitation_id)
    if inv.accepted_at or inv.revoked_at:
        raise Conflict("Only pending invitations can be resent", code="invitation_not_pending")
    raw = security.generate_token(32)
    inv.token_hash = security.hash_token(raw)
    inv.expires_at = _now() + timedelta(days=settings.INVITATION_TTL_DAYS)
    await ctx.db.flush()
    await ctx.audit("invitation.resent", "invitation", inv.id, email=inv.email)
    await _send_invite_email(ctx, inv, raw)
    return inv


# ----------------------------------------------------------------------------- public flow


async def _find_valid(db: AsyncSession, raw: str) -> tuple[Invitation, Organisation]:
    async with tenant_scope(db, None, bypass=True):
        inv = await db.scalar(select(Invitation).where(Invitation.token_hash == security.hash_token(raw)))
    if inv is None or invitation_status(inv) != "pending":
        raise NotFound("This invitation is invalid or has expired", code="invitation_invalid")
    org = await db.get(Organisation, inv.organisation_id)
    if org is None or org.deleted_at or org.status != OrgStatus.ACTIVE:
        raise NotFound("This invitation is invalid or has expired", code="invitation_invalid")
    return inv, org


async def lookup(db: AsyncSession, raw: str) -> InvitationLookup:
    inv, org = await _find_valid(db, raw)
    inviter = await db.get(User, inv.invited_by) if inv.invited_by else None
    existing = await db.scalar(select(User.id).where(User.email == inv.email))
    return InvitationLookup(
        organisation_id=org.id,
        organisation_name=org.name,
        organisation_logo_url=org.logo_url,
        email=inv.email,
        roles=list(inv.role_keys or []),
        invited_by_name=inviter.full_name if inviter else None,
        expires_at=inv.expires_at,
        existing_account=existing is not None,
    )


async def accept(
    db: AsyncSession,
    raw: str,
    *,
    current_user: User | None,
    full_name: str | None,
    password: str | None,
    accept_terms: bool,
    ip: str | None,
) -> tuple[User, Organisation, bool]:
    """Accept an invitation. Returns (user, organisation, account_created).

    * Signed-in users: the invitation email must match their account email.
    * Anonymous callers: a new account is created (name + password required). If an account already exists
      for the email, the caller must sign in first.
    """
    from app.modules.auth.service import get_user_by_email

    inv, org = await _find_valid(db, raw)
    created = False
    if current_user is not None:
        if current_user.email.lower() != inv.email.lower():
            raise Forbidden(
                "This invitation was sent to a different email address", code="invitation_email_mismatch"
            )
        user = current_user
    else:
        if await get_user_by_email(db, inv.email):
            raise Unauthorized(
                "An account already exists for this email. Sign in to accept the invitation.",
                code="login_required",
            )
        if not full_name or not password:
            raise BadRequest(
                "Full name and password are required to create your account", code="account_details_required"
            )
        if not accept_terms:
            raise BadRequest("You must accept the terms of service", code="terms_required")
        problems = security.validate_password_strength(password)
        if problems:
            raise BadRequest(problems[0], details={"password": problems}, code="weak_password")
        user = User(
            email=inv.email.lower(),
            full_name=full_name.strip(),
            password_hash=security.hash_password(password),
            email_verified_at=_now(),  # the token proves control of the mailbox
            default_organisation_id=org.id,
        )
        db.add(user)
        await db.flush()
        created = True
        for purpose in ("terms", "privacy_policy"):
            db.add(
                Consent(
                    user_id=user.id,
                    organisation_id=org.id,
                    purpose=purpose,
                    policy_version="2026-01",
                    granted=True,
                    ip_address=ip,
                )
            )

    async with tenant_scope(db, org.id):
        existing = await db.scalar(
            select(OrganisationUser).where(
                OrganisationUser.organisation_id == org.id, OrganisationUser.user_id == user.id
            )
        )
        if existing is not None and existing.status == MembershipStatus.SUSPENDED:
            raise Forbidden("Your membership in this organisation is suspended", code="membership_inactive")
        if existing is None:
            keys = list(inv.role_keys or []) or ["learner"]
            roles = (
                (await db.execute(select(Role).where(Role.organisation_id == org.id, Role.key.in_(keys))))
                .scalars()
                .all()
            )
            if not roles:
                roles = (
                    (
                        await db.execute(
                            select(Role).where(Role.organisation_id == org.id, Role.key == "learner")
                        )
                    )
                    .scalars()
                    .all()
                )
            membership = OrganisationUser(
                organisation_id=org.id,
                user_id=user.id,
                status=MembershipStatus.ACTIVE,
                joined_at=_now(),
                roles=list(roles),
                department_id=inv.department_id,
                invited_by=inv.invited_by,
            )
            db.add(membership)
            await db.flush()
            await emit(
                db,
                "member.joined",
                {
                    "organisation_id": org.id,
                    "user_id": user.id,
                    "membership_id": membership.id,
                    "via": "invitation",
                },
            )
        elif existing.status == MembershipStatus.INVITED:
            existing.status = MembershipStatus.ACTIVE
            existing.joined_at = _now()
        inv.accepted_at = _now()
        if user.default_organisation_id is None:
            user.default_organisation_id = org.id
        await db.flush()
        await write_audit(
            db,
            action="invitation.accepted",
            organisation_id=org.id,
            actor_user_id=user.id,
            actor_label=user.email,
            entity_type="invitation",
            entity_id=inv.id,
            ip_address=ip,
            meta={"account_created": created},
        )
    # Supersede any other pending invitations to the same org for this email.
    async with tenant_scope(db, org.id):
        await db.execute(
            update(Invitation)
            .where(
                Invitation.organisation_id == org.id,
                Invitation.email == inv.email,
                Invitation.id != inv.id,
                Invitation.accepted_at.is_(None),
                Invitation.revoked_at.is_(None),
            )
            .values(revoked_at=_now())
        )
    return user, org, created
