"""/invitations: org-side management (users.create) and the public lookup/accept endpoints."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx, Principal, get_optional_principal, require_permission
from app.core.db import get_db
from app.core.middleware import client_ip
from app.core.pagination import Page, PageParams, page_params
from app.modules.invitations import service
from app.modules.invitations.schemas import (
    AcceptIn,
    AcceptOut,
    BulkError,
    BulkResult,
    InvitationBulkCreate,
    InvitationCreate,
    InvitationLookup,
    InvitationOut,
)

router = APIRouter(prefix="/invitations", tags=["invitations"])
public_router = APIRouter(prefix="/invitations", tags=["invitations"])


@router.get("", response_model=Page[InvitationOut])
async def list_invitations(
    status: Literal["pending", "expired", "accepted", "revoked"] | None = None,
    q: str | None = Query(None, max_length=320),
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(require_permission("users.create")),
) -> Page[InvitationOut]:
    rows, total = await service.list_invitations(ctx, params, status, q)
    return Page(
        items=[service.to_out(r) for r in rows], total=total, page=params.page, page_size=params.page_size
    )


@router.post("", response_model=InvitationOut, status_code=201)
async def create_invitation(body: InvitationCreate, ctx: Ctx = Depends(require_permission("users.create"))):
    return service.to_out(await service.create_invitation(ctx, body))


@router.post("/bulk", response_model=BulkResult, status_code=201)
async def bulk_invite(body: InvitationBulkCreate, ctx: Ctx = Depends(require_permission("users.create"))):
    created, errors = await service.bulk_create(
        ctx, [str(e) for e in body.emails], body.roles, body.department_id
    )
    return BulkResult(
        invited=[service.to_out(i) for i in created], errors=[BulkError(email=e, error=m) for e, m in errors]
    )


@router.post("/{invitation_id}/resend", response_model=InvitationOut)
async def resend(invitation_id: uuid.UUID, ctx: Ctx = Depends(require_permission("users.create"))):
    return service.to_out(await service.resend(ctx, invitation_id))


@router.delete("/{invitation_id}", status_code=204)
async def revoke(invitation_id: uuid.UUID, ctx: Ctx = Depends(require_permission("users.create"))):
    await service.revoke(ctx, invitation_id)
    return Response(status_code=204)


# ----------------------------------------------------------------------------- public


@public_router.get("/lookup", response_model=InvitationLookup)
async def lookup(token: str = Query(..., min_length=10, max_length=200), db: AsyncSession = Depends(get_db)):
    return await service.lookup(db, token)


@public_router.post("/accept", response_model=AcceptOut)
async def accept(
    body: AcceptIn,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    principal: Principal | None = Depends(get_optional_principal),
) -> AcceptOut:
    from app.modules.auth import service as auth_service
    from app.modules.auth.router import _set_auth_cookies

    current = principal.user if principal else None
    user, org, created = await service.accept(
        db,
        body.token,
        current_user=current,
        full_name=body.full_name,
        password=body.password,
        accept_terms=body.accept_terms,
        ip=client_ip(request),
    )
    out = AcceptOut(organisation_id=org.id, user_id=user.id, account_created=created)
    if created:
        issued = await auth_service.issue_session(
            db,
            user,
            mfa_verified=False,
            auth_method="password",
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
        out.csrf_token = _set_auth_cookies(response, issued)
        out.access_token = issued.access_token
        out.expires_at = issued.access_expires
        out.refresh_token = issued.refresh_token if body.include_refresh_token else None
    return out
