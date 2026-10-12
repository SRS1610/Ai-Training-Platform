"""Certificate issuing, PDF generation, revocation and public verification."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import structlog
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core import security
from app.core.audit import write_audit
from app.core.config import settings
from app.core.db import tenant_scope
from app.core.errors import Conflict, NotFound, Unprocessable
from app.core.events import emit
from app.core.files import store_bytes
from app.core.storage import get_storage
from app.models.content import Course, StoredFile
from app.models.identity import User
from app.models.learning import Enrolment
from app.models.platform import Certificate
from app.models.tenancy import MembershipStatus, Organisation, OrganisationUser
from app.modules.certificates.pdf import CertificateData, render_certificate_pdf

log = structlog.get_logger(__name__)


def utcnow() -> datetime:
    return datetime.now(UTC)


def verify_url(number: str) -> str:
    return f"{settings.PUBLIC_WEB_URL.rstrip('/')}/verify/{number}"


def _score_str(score: float | None) -> str:
    return "" if score is None else f"{float(score):.2f}"


def compute_hash(cert: Certificate) -> str:
    """HMAC over the certificate facts: number, learner, course, issue time (+ score, names, expiry so any
    edit of a displayed fact invalidates verification)."""
    issued = cert.issued_at.astimezone(UTC).isoformat()
    expires = cert.expires_at.astimezone(UTC).isoformat() if cert.expires_at else ""
    return security.sign_payload(
        cert.certificate_number,
        str(cert.user_id),
        str(cert.course_id),
        issued,
        _score_str(cert.score),
        cert.learner_name,
        cert.course_title,
        cert.organisation_name,
        expires,
    )


def hash_valid(cert: Certificate) -> bool:
    return security.constant_time_equals(compute_hash(cert), cert.verification_hash or "")


def status_of(cert: Certificate, now: datetime | None = None) -> str:
    if cert.revoked_at:
        return "revoked"
    if cert.expires_at and cert.expires_at < (now or utcnow()):
        return "expired"
    return "valid"


async def _next_number(db: AsyncSession, year: int) -> str:
    seq = await db.scalar(text("SELECT nextval('certificate_number_seq')"))
    return f"CERT-{year}-{int(seq):06d}"


# ----------------------------------------------------------------------------- PDF


async def render_and_store_pdf(db: AsyncSession, cert: Certificate) -> StoredFile:
    org = await db.get(Organisation, cert.organisation_id)
    branding = (org.branding if org else {}) or {}
    data = CertificateData(
        certificate_number=cert.certificate_number,
        learner_name=cert.learner_name,
        course_title=cert.course_title,
        organisation_name=cert.organisation_name,
        issued_at=cert.issued_at,
        verify_url=verify_url(cert.certificate_number),
        instructor_name=cert.instructor_name,
        score=cert.score,
        skills=[str(s.get("name") if isinstance(s, dict) else s) for s in (cert.skills or [])],
        expires_at=cert.expires_at,
        primary_color=branding.get("primary_color"),
        secondary_color=branding.get("secondary_color"),
        accent_color=branding.get("accent_color"),
        certificate_text=branding.get("certificate_text"),
    )
    pdf = await asyncio.to_thread(render_certificate_pdf, data)
    fake_ctx = SimpleNamespace(org_id=cert.organisation_id, db=db, principal=SimpleNamespace(user=None))
    stored = await store_bytes(
        fake_ctx,
        pdf,
        f"{cert.certificate_number}.pdf",
        "application/pdf",
        "certificate",
        owner_id=cert.user_id,
    )
    cert.pdf_file_id = stored.id
    await db.flush()
    return stored


async def pdf_bytes(db: AsyncSession, cert: Certificate) -> bytes:
    """Return the stored PDF, regenerating it if missing (e.g. storage loss or first render failed)."""
    if cert.pdf_file_id:
        f = await db.get(StoredFile, cert.pdf_file_id)
        if f is not None and f.deleted_at is None:
            try:
                return await get_storage().get(f.storage_key)
            except Exception:  # any storage failure → regenerate
                log.warning("certificate.pdf_missing", certificate_id=str(cert.id))
    stored = await render_and_store_pdf(db, cert)
    return await get_storage().get(stored.storage_key)


# ----------------------------------------------------------------------------- issuing


async def issue_certificate(
    db: AsyncSession,
    *,
    organisation_id: uuid.UUID,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    course_version_id: uuid.UUID | None,
    enrolment_id: uuid.UUID | None,
    score: float | None,
    issued_by: uuid.UUID | None = None,
    expires_at: datetime | None = None,
    actor_label: str = "system",
) -> tuple[Certificate, bool]:
    """Idempotently issue a certificate for (user, course, version). Returns (certificate, created)."""
    version_clause = (
        Certificate.course_version_id == course_version_id
        if course_version_id
        else Certificate.course_version_id.is_(None)
    )
    existing = await db.scalar(
        select(Certificate).where(
            Certificate.organisation_id == organisation_id,
            Certificate.user_id == user_id,
            Certificate.course_id == course_id,
            version_clause,
        )
    )
    if existing is not None:
        return existing, False
    course = await db.get(Course, course_id)
    org = await db.get(Organisation, organisation_id)
    user = await db.get(User, user_id)
    if course is None or org is None or user is None:
        raise NotFound("Course or learner not found")
    instructor = await db.get(User, course.instructor_id) if course.instructor_id else None
    issued_at = utcnow()
    if expires_at is None and (org.settings or {}).get("certificate_validity_days"):
        expires_at = issued_at + timedelta(days=int(org.settings["certificate_validity_days"]))
    cert = Certificate(
        organisation_id=organisation_id,
        certificate_number=await _next_number(db, issued_at.year),
        user_id=user_id,
        course_id=course_id,
        course_version_id=course_version_id,
        enrolment_id=enrolment_id,
        learner_name=user.full_name[:200],
        course_title=course.title[:255],
        organisation_name=org.name[:200],
        instructor_name=instructor.full_name[:200] if instructor else None,
        score=round(float(score), 2) if score is not None else None,
        issued_at=issued_at,
        expires_at=expires_at,
        issued_by=issued_by,
        skills=[{"id": str(s.id), "name": s.name} for s in (course.skills or [])],
        verification_hash="",
    )
    cert.verification_hash = compute_hash(cert)
    db.add(cert)
    await db.flush()
    try:
        async with db.begin_nested():
            await render_and_store_pdf(db, cert)
    except Exception:  # the PDF is regenerated on first download
        log.exception("certificate.pdf_failed", certificate_id=str(cert.id))
    await write_audit(
        db,
        action="certificate.issued",
        organisation_id=organisation_id,
        actor_user_id=issued_by,
        actor_type="user" if issued_by else "system",
        actor_label=actor_label,
        entity_type="certificate",
        entity_id=cert.id,
        meta={
            "certificate_number": cert.certificate_number,
            "user_id": str(user_id),
            "course_id": str(course_id),
            "score": cert.score,
        },
    )
    await emit(
        db,
        "certificate.issued",
        {
            "certificate_id": cert.id,
            "course_id": course_id,
            "certificate_number": cert.certificate_number,
            "organisation_id": organisation_id,
            "user_id": user_id,
        },
    )
    return cert, True


async def on_course_completed(db: AsyncSession, payload: dict[str, Any]) -> Certificate | None:
    course = await db.get(Course, payload["course_id"])
    if course is None or not course.certificate_enabled:
        return None
    score = payload.get("final_score")
    if score is not None and float(score) < float(course.pass_threshold):
        return None
    cert, _ = await issue_certificate(
        db,
        organisation_id=payload["organisation_id"],
        user_id=payload["user_id"],
        course_id=course.id,
        course_version_id=payload.get("course_version_id"),
        enrolment_id=payload.get("enrolment_id"),
        score=score,
    )
    return cert


async def manual_issue(
    ctx: Ctx, user_id: uuid.UUID, course_id: uuid.UUID, score: float | None, expires_at: datetime | None
) -> Certificate:
    member = await ctx.db.scalar(
        select(OrganisationUser).where(
            OrganisationUser.organisation_id == ctx.org_id,
            OrganisationUser.user_id == user_id,
            OrganisationUser.status == MembershipStatus.ACTIVE,
        )
    )
    if member is None:
        raise NotFound("Learner is not a member of this organisation")
    course = await ctx.db.scalar(
        select(Course).where(
            Course.id == course_id, Course.organisation_id == ctx.org_id, Course.deleted_at.is_(None)
        )
    )
    if course is None:
        raise NotFound("Course not found")
    if expires_at is not None and expires_at <= utcnow():
        raise Unprocessable("expires_at must be in the future")
    enrolment = await ctx.db.scalar(
        select(Enrolment).where(
            Enrolment.organisation_id == ctx.org_id,
            Enrolment.user_id == user_id,
            Enrolment.course_id == course_id,
        )
    )
    version_id = enrolment.course_version_id if enrolment else course.current_version_id
    if score is None and enrolment is not None:
        score = enrolment.final_score
    cert, created = await issue_certificate(
        ctx.db,
        organisation_id=ctx.org_id,
        user_id=user_id,
        course_id=course_id,
        course_version_id=version_id,
        enrolment_id=enrolment.id if enrolment else None,
        score=score,
        issued_by=ctx.user_id,
        expires_at=expires_at,
        actor_label=ctx.principal.label,
    )
    if not created:
        raise Conflict(
            "A certificate was already issued for this course",
            code="certificate_exists",
            details={"certificate_id": str(cert.id), "certificate_number": cert.certificate_number},
        )
    return cert


async def get_certificate(ctx: Ctx, cert_id: uuid.UUID) -> Certificate:
    cert = await ctx.db.scalar(
        select(Certificate).where(Certificate.id == cert_id, Certificate.organisation_id == ctx.org_id)
    )
    if cert is None:
        raise NotFound("Certificate not found")
    if cert.user_id != ctx.principal.user_id and not ctx.can_any("certificates.issue", "analytics.view"):
        raise NotFound("Certificate not found")
    return cert


async def revoke(ctx: Ctx, cert: Certificate, reason: str) -> Certificate:
    if cert.revoked_at:
        raise Conflict("Certificate is already revoked", code="already_revoked")
    cert.revoked_at = utcnow()
    cert.revoke_reason = reason
    await ctx.db.flush()
    await ctx.audit(
        "certificate.revoked",
        "certificate",
        cert.id,
        certificate_number=cert.certificate_number,
        reason=reason,
    )
    await ctx.db.refresh(cert)
    return cert


def list_stmt(
    ctx: Ctx, *, user_id: uuid.UUID | None, course_id: uuid.UUID | None, status: str | None, q: str | None
):  # noqa: ANN201
    now = utcnow()
    stmt = select(Certificate).where(Certificate.organisation_id == ctx.org_id)
    if user_id:
        stmt = stmt.where(Certificate.user_id == user_id)
    if course_id:
        stmt = stmt.where(Certificate.course_id == course_id)
    if status == "revoked":
        stmt = stmt.where(Certificate.revoked_at.is_not(None))
    elif status == "expired":
        stmt = stmt.where(Certificate.revoked_at.is_(None), Certificate.expires_at < now)
    elif status == "valid":
        stmt = stmt.where(
            Certificate.revoked_at.is_(None),
            or_(Certificate.expires_at.is_(None), Certificate.expires_at >= now),
        )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Certificate.learner_name.ilike(like),
                Certificate.certificate_number.ilike(like),
                Certificate.course_title.ilike(like),
            )
        )
    return stmt.order_by(Certificate.issued_at.desc())


def out(cert: Certificate) -> dict[str, Any]:
    return {
        "id": cert.id,
        "certificate_number": cert.certificate_number,
        "user_id": cert.user_id,
        "course_id": cert.course_id,
        "course_version_id": cert.course_version_id,
        "enrolment_id": cert.enrolment_id,
        "learner_name": cert.learner_name,
        "course_title": cert.course_title,
        "organisation_name": cert.organisation_name,
        "instructor_name": cert.instructor_name,
        "score": cert.score,
        "issued_at": cert.issued_at,
        "expires_at": cert.expires_at,
        "revoked_at": cert.revoked_at,
        "revoke_reason": cert.revoke_reason,
        "status": status_of(cert),
        "skills": cert.skills or [],
        "issued_by": cert.issued_by,
        "verification_url": verify_url(cert.certificate_number),
        "pdf_url": f"{settings.API_PREFIX}/certificates/{cert.id}/pdf",
    }


# ----------------------------------------------------------------------------- public verification


async def verify(db: AsyncSession, number: str) -> dict[str, Any]:
    normalised = (number or "").strip().upper()[:32]
    async with tenant_scope(db, None, bypass=True):
        cert = await db.scalar(select(Certificate).where(Certificate.certificate_number == normalised))
    if cert is None:
        raise NotFound("Certificate not found")
    authentic = hash_valid(cert)
    status = status_of(cert) if authentic else "invalid"
    return {
        "valid": authentic and status == "valid",
        "status": status,
        "certificate_number": cert.certificate_number,
        "learner_name": cert.learner_name,
        "course_title": cert.course_title,
        "organisation_name": cert.organisation_name,
        "issued_at": cert.issued_at,
        "expires_at": cert.expires_at,
        "score": cert.score,
        "instructor_name": cert.instructor_name,
        "skills": [s.get("name") if isinstance(s, dict) else s for s in (cert.skills or [])],
        "revoked_at": cert.revoked_at,
    }
