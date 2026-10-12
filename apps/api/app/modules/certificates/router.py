"""Certificates (authenticated) and public verification (``/verify/{number}``, no auth)."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx, get_ctx, require_permission
from app.core.db import get_db
from app.core.pagination import Page, PageParams, page_params, paginate
from app.models.platform import Certificate
from app.modules.certificates import events as _events  # noqa: F401  (registers the course.completed handler)
from app.modules.certificates import service
from app.modules.certificates.schemas import CertificateOut, IssueIn, RevokeIn, VerificationOut

router = APIRouter(prefix="/certificates", tags=["certificates"])
public_router = APIRouter(prefix="/verify", tags=["public"])

STAFF = require_permission("certificates.issue", "analytics.view", any_of=True)
ISSUE = require_permission("certificates.issue")


@router.get("/me", response_model=list[CertificateOut])
async def my_certificates(ctx: Ctx = Depends(get_ctx)) -> list[dict]:
    stmt = service.list_stmt(ctx, user_id=ctx.user_id, course_id=None, status=None, q=None)
    return [service.out(c) for c in (await ctx.db.execute(stmt)).scalars()]


@router.get("", response_model=Page[CertificateOut])
async def list_certificates(
    user_id: uuid.UUID | None = None,
    course_id: uuid.UUID | None = None,
    status: Literal["valid", "revoked", "expired"] | None = None,
    q: str | None = Query(None, max_length=200),
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(STAFF),
) -> Page[CertificateOut]:
    stmt = service.list_stmt(ctx, user_id=user_id, course_id=course_id, status=status, q=q)
    items, total = await paginate(ctx.db, stmt, params)
    return Page(
        items=[CertificateOut(**service.out(c)) for c in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.post("/issue", response_model=CertificateOut, status_code=201)
async def issue(body: IssueIn, ctx: Ctx = Depends(ISSUE)) -> dict:
    return service.out(
        await service.manual_issue(ctx, body.user_id, body.course_id, body.score, body.expires_at)
    )


@router.get("/{certificate_id}", response_model=CertificateOut)
async def get_certificate(certificate_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> dict:
    return service.out(await service.get_certificate(ctx, certificate_id))


@router.get("/{certificate_id}/pdf", response_class=Response)
async def certificate_pdf(certificate_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> Response:
    cert: Certificate = await service.get_certificate(ctx, certificate_id)
    data = await service.pdf_bytes(ctx.db, cert)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{cert.certificate_number}.pdf"',
            "Cache-Control": "private, max-age=300",
        },
    )


@router.post("/{certificate_id}/revoke", response_model=CertificateOut)
async def revoke(certificate_id: uuid.UUID, body: RevokeIn, ctx: Ctx = Depends(ISSUE)) -> dict:
    cert = await service.get_certificate(ctx, certificate_id)
    return service.out(await service.revoke(ctx, cert, body.reason))


@public_router.get("/{certificate_number}", response_model=VerificationOut)
async def verify(certificate_number: str, db: AsyncSession = Depends(get_db)) -> dict:
    """Public certificate verification. Recomputes the HMAC so edited records report ``invalid``."""
    return await service.verify(db, certificate_number)
