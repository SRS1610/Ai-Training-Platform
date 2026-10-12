"""Privacy tooling (GDPR / Australian Privacy Principles): consent ledger, data export, account erasure and
organisation retention policies.

* Consents are append-only: every change inserts a new row; the latest row per purpose is the current state.
* Exports are built asynchronously (task ``privacy.export``) into a zip of JSON files in object storage.
* Account deletion anonymises the user row (so foreign keys, training records, certificates and the
  immutable audit trail stay intact but are no longer linked to an identifiable person), removes
  memberships, sessions, identities and personal content such as notifications and AI conversations.
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, delete, exists, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core import security
from app.core.audit import write_audit
from app.core.db import tenant_scope
from app.core.errors import BadRequest, Conflict, NotFound
from app.core.storage import get_storage
from app.models.ai import AIMessage, AISession, AIUsage
from app.models.assessment import AssessmentAttempt, AttemptAnswer
from app.models.assignment import Grade, IntegritySignal, Submission, SubmissionVersion
from app.models.content import LearnerSkill, StoredFile
from app.models.identity import AuthSession, User, UserIdentity, UserStatus
from app.models.learning import ActivityDay, Enrolment, LessonProgress
from app.models.platform import (
    AuditLog,
    Certificate,
    Consent,
    DataRequest,
    Notification,
    NotificationPreference,
    PointsLedger,
    Recommendation,
    UserBadge,
)
from app.models.simulation import SimulationAction, SimulationSession
from app.models.tenancy import (
    Invitation,
    MembershipStatus,
    Organisation,
    OrganisationUser,
    OrgKind,
    OrgStatus,
    TeamMember,
)
from app.modules.privacy.schemas import ConsentIn, ConsentOut, ConsentsOut, DataRequestOut
from app.modules.users.service import count_active_admins, detach_membership, is_admin

REQUIRED_PURPOSES = {"terms", "privacy_policy"}
EXPORT_TTL_DAYS = 7
DEFAULT_RETENTION_DAYS = 2555
MIN_RETENTION_DAYS = 30
# Columns never included in exports: credentials, token hashes, and assessment/simulation secrets
# (answer keys and hidden scenario facts are not the learner's personal data and would break integrity).
EXCLUDED_COLUMNS = {
    "password_hash",
    "mfa_secret_encrypted",
    "mfa_recovery_codes",
    "refresh_token_hash",
    "previous_token_hash",
    "token_hash",
    "key_hash",
    "questions_snapshot",
    "settings_snapshot",
    "state",
    "verification_hash",
}


def _now() -> datetime:
    return datetime.now(UTC)


# ----------------------------------------------------------------------------- consents


async def get_consents(ctx: Ctx) -> ConsentsOut:
    rows = (
        (
            await ctx.db.execute(
                select(Consent)
                .where(Consent.user_id == ctx.user_id)
                .order_by(Consent.created_at.desc(), Consent.id.desc())
            )
        )
        .scalars()
        .all()
    )
    current: dict[str, ConsentOut] = {}
    for r in rows:
        current.setdefault(r.purpose, ConsentOut.model_validate(r))
    return ConsentsOut(current=current, history=[ConsentOut.model_validate(r) for r in rows])


async def record_consents(ctx: Ctx, items: list[ConsentIn]) -> ConsentsOut:
    for item in items:
        if item.purpose in REQUIRED_PURPOSES and not item.granted:
            raise BadRequest(
                "The terms of service and privacy policy are required to use the platform. "
                "Delete your account to withdraw them.",
                code="consent_required",
            )
    for item in items:
        ctx.db.add(
            Consent(
                user_id=ctx.user_id,
                organisation_id=ctx.org_id,
                purpose=item.purpose,
                policy_version=item.policy_version,
                granted=item.granted,
                ip_address=ctx.ip,
            )
        )
    await ctx.db.flush()
    await ctx.audit(
        "privacy.consent_updated", "user", ctx.user_id, consents={i.purpose: i.granted for i in items}
    )
    return await get_consents(ctx)


# ----------------------------------------------------------------------------- data requests


def request_out(req: DataRequest) -> DataRequestOut:
    out = DataRequestOut.model_validate(req)
    if req.kind == "export" and req.status == "completed" and req.file_storage_key:
        out.download_url = f"/api/v1/privacy/requests/{req.id}/download"
    return out


async def list_requests(ctx: Ctx) -> list[DataRequest]:
    return list(
        (
            await ctx.db.execute(
                select(DataRequest)
                .where(DataRequest.user_id == ctx.user_id)
                .order_by(DataRequest.created_at.desc())
                .limit(50)
            )
        )
        .scalars()
        .all()
    )


async def request_export(ctx: Ctx) -> DataRequest:
    """Create (or return the in-flight) export request and enqueue the export job."""
    from app.workers import enqueue

    inflight = await ctx.db.scalar(
        select(DataRequest).where(
            DataRequest.user_id == ctx.user_id,
            DataRequest.kind == "export",
            DataRequest.status.in_(("pending", "processing")),
            DataRequest.created_at > _now() - timedelta(hours=1),
        )
    )
    if inflight:
        return inflight
    req = DataRequest(user_id=ctx.user_id, kind="export", status="pending")
    ctx.db.add(req)
    await ctx.db.flush()
    await ctx.audit("privacy.export_requested", "data_request", req.id)
    await ctx.db.commit()  # the worker reads the request in its own transaction
    await enqueue("privacy.export", request_id=str(req.id))
    return req


async def download_export(ctx: Ctx, request_id: uuid.UUID) -> tuple[bytes, str]:
    req = await ctx.db.scalar(
        select(DataRequest).where(
            DataRequest.id == request_id, DataRequest.user_id == ctx.user_id, DataRequest.kind == "export"
        )
    )
    if req is None:
        raise NotFound("Export not found")
    if req.status != "completed" or not req.file_storage_key:
        raise Conflict("The export is not ready yet", code="export_not_ready")
    if req.completed_at and req.completed_at < _now() - timedelta(days=EXPORT_TTL_DAYS):
        raise NotFound("This export has expired. Request a new one.", code="export_expired")
    data = await get_storage().get(req.file_storage_key)
    await ctx.audit("privacy.export_downloaded", "data_request", req.id)
    return data, f"praxis-data-export-{req.created_at:%Y%m%d}.zip"


def _row(obj: Any) -> dict[str, Any]:
    mapper = obj.__mapper__
    return {
        attr.key: getattr(obj, attr.key) for attr in mapper.column_attrs if attr.key not in EXCLUDED_COLUMNS
    }


async def _rows(db: AsyncSession, model: Any, *where: Any, limit: int = 100_000) -> list[dict[str, Any]]:
    stmt = select(model).where(*where).limit(limit)
    if hasattr(model, "created_at"):
        stmt = stmt.order_by(model.created_at)
    return [_row(o) for o in (await db.execute(stmt)).scalars().all()]


async def collect_user_data(db: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    """Gather all personal data for ``user_id`` across tenants. ``db`` must bypass RLS."""
    user = await db.get(User, user_id)
    if user is None:
        raise NotFound("User not found")
    memberships = (
        (await db.execute(select(OrganisationUser).where(OrganisationUser.user_id == user_id)))
        .scalars()
        .all()
    )
    attempt_ids = select(AssessmentAttempt.id).where(AssessmentAttempt.user_id == user_id)
    submission_ids = select(Submission.id).where(Submission.user_id == user_id)
    sim_ids = select(SimulationSession.id).where(SimulationSession.user_id == user_id)
    ai_ids = select(AISession.id).where(AISession.user_id == user_id)
    return {
        "export": {"generated_at": _now(), "user_id": user_id, "format_version": 1},
        "profile": _row(user),
        "identities": await _rows(db, UserIdentity, UserIdentity.user_id == user_id),
        "sessions": await _rows(db, AuthSession, AuthSession.user_id == user_id),
        "memberships": [
            {**_row(m), "organisation_name": m.organisation.name, "roles": sorted(r.key for r in m.roles)}
            for m in memberships
        ],
        "team_memberships": await _rows(db, TeamMember, TeamMember.user_id == user_id),
        "consents": await _rows(db, Consent, Consent.user_id == user_id),
        "data_requests": await _rows(db, DataRequest, DataRequest.user_id == user_id),
        "enrolments": await _rows(db, Enrolment, Enrolment.user_id == user_id),
        "lesson_progress": await _rows(db, LessonProgress, LessonProgress.user_id == user_id),
        "activity_days": await _rows(db, ActivityDay, ActivityDay.user_id == user_id),
        "skills": await _rows(db, LearnerSkill, LearnerSkill.user_id == user_id),
        "assessment_attempts": await _rows(db, AssessmentAttempt, AssessmentAttempt.user_id == user_id),
        "attempt_answers": await _rows(db, AttemptAnswer, AttemptAnswer.attempt_id.in_(attempt_ids)),
        "submissions": await _rows(db, Submission, Submission.user_id == user_id),
        "submission_versions": await _rows(
            db, SubmissionVersion, SubmissionVersion.submission_id.in_(submission_ids)
        ),
        "grades": await _rows(
            db,
            Grade,
            ((Grade.target_type == "submission") & Grade.target_id.in_(submission_ids))
            | ((Grade.target_type == "attempt") & Grade.target_id.in_(attempt_ids)),
        ),
        "integrity_signals": await _rows(db, IntegritySignal, IntegritySignal.user_id == user_id),
        "simulation_sessions": await _rows(db, SimulationSession, SimulationSession.user_id == user_id),
        "simulation_actions": await _rows(db, SimulationAction, SimulationAction.session_id.in_(sim_ids)),
        "ai_sessions": await _rows(db, AISession, AISession.user_id == user_id),
        "ai_messages": await _rows(db, AIMessage, AIMessage.session_id.in_(ai_ids)),
        "ai_usage": await _rows(db, AIUsage, AIUsage.user_id == user_id),
        "certificates": await _rows(db, Certificate, Certificate.user_id == user_id),
        "notifications": await _rows(db, Notification, Notification.user_id == user_id),
        "notification_preferences": await _rows(
            db, NotificationPreference, NotificationPreference.user_id == user_id
        ),
        "points": await _rows(db, PointsLedger, PointsLedger.user_id == user_id),
        "badges": await _rows(db, UserBadge, UserBadge.user_id == user_id),
        "recommendations": await _rows(db, Recommendation, Recommendation.user_id == user_id),
        "files": await _rows(db, StoredFile, StoredFile.owner_id == user_id),
        "activity_log": await _rows(db, AuditLog, AuditLog.actor_user_id == user_id, limit=20_000),
    }


def build_zip(data: dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "README.txt",
            (
                "This archive contains the personal data held about you by the training platform.\n"
                "data.json holds everything in one document; each section is also provided as its own file.\n"
                "Timestamps are UTC (ISO 8601). Identifiers are UUIDs.\n"
            ),
        )
        zf.writestr("data.json", json.dumps(data, default=str, indent=2, sort_keys=True))
        for section, content in data.items():
            zf.writestr(
                f"sections/{section}.json", json.dumps(content, default=str, indent=2, sort_keys=True)
            )
    return buf.getvalue()


# ----------------------------------------------------------------------------- account deletion


async def delete_account(ctx: Ctx, password: str | None, confirm_email: str | None) -> None:
    """Erase (anonymise) the signed-in user's account. See module docstring for what is kept."""
    db, user = ctx.db, ctx.user
    if user.password_hash:
        if not password or not security.verify_password(password, user.password_hash):
            raise BadRequest("Password is incorrect", code="invalid_credentials")
    elif (confirm_email or "").strip().lower() != user.email.lower():
        raise BadRequest("Type your email address to confirm", code="confirmation_required")

    async with tenant_scope(db, None, bypass=True):
        memberships = list(
            (await db.execute(select(OrganisationUser).where(OrganisationUser.user_id == user.id)))
            .scalars()
            .all()
        )
        blocking: list[str] = []
        sole_member_orgs: list[Organisation] = []
        for m in memberships:
            org = m.organisation
            others = int(
                await db.scalar(
                    select(func.count())
                    .select_from(OrganisationUser)
                    .where(OrganisationUser.organisation_id == org.id, OrganisationUser.user_id != user.id)
                )
                or 0
            )
            if others == 0:
                sole_member_orgs.append(org)
            elif (
                org.kind != OrgKind.PERSONAL
                and m.status == MembershipStatus.ACTIVE
                and is_admin(m)
                and await count_active_admins(db, org.id, exclude_user_id=user.id) == 0
            ):
                blocking.append(org.name)
        if blocking:
            raise Conflict(
                "You are the only admin of organisations with other members. Make someone else an "
                "admin first.",
                code="sole_admin",
                details={"organisations": blocking},
            )

        label = f"deleted-user:{user.id}"
        for m in memberships:
            await write_audit(
                db,
                action="privacy.account_deleted",
                organisation_id=m.organisation_id,
                actor_user_id=user.id,
                actor_label=label,
                entity_type="user",
                entity_id=user.id,
                ip_address=ctx.ip,
                request_id=ctx.request_id,
            )
            await detach_membership(db, m)
        for org in sole_member_orgs:
            org.status = OrgStatus.CLOSED
            org.deleted_at = _now()
            await write_audit(
                db,
                action="organisation.closed",
                organisation_id=org.id,
                actor_user_id=user.id,
                actor_label=label,
                entity_type="organisation",
                entity_id=org.id,
                meta={"reason": "owner_account_deleted"},
            )

        # Personal content with no record-keeping value
        await db.execute(delete(Notification).where(Notification.user_id == user.id))
        await db.execute(delete(NotificationPreference).where(NotificationPreference.user_id == user.id))
        await db.execute(delete(AISession).where(AISession.user_id == user.id))  # cascades to ai_messages
        await db.execute(
            update(Invitation)
            .where(
                func.lower(Invitation.email) == user.email.lower(),
                Invitation.accepted_at.is_(None),
                Invitation.revoked_at.is_(None),
            )
            .values(revoked_at=_now())
        )
        for req in (
            await db.execute(
                select(DataRequest).where(
                    DataRequest.user_id == user.id, DataRequest.file_storage_key.is_not(None)
                )
            )
        ).scalars():
            try:
                await get_storage().delete(req.file_storage_key)
            except Exception:  # noqa: BLE001,S110 - best effort; the key is cleared regardless
                pass
            req.file_storage_key = None
        await db.execute(delete(UserIdentity).where(UserIdentity.user_id == user.id))
        await db.execute(
            update(AuthSession)
            .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=_now(), revoked_reason="account_deleted")
        )

        user.email = f"deleted-{user.id}@deleted.invalid"
        user.full_name = "Deleted user"
        user.password_hash = None
        user.avatar_url = None
        user.mfa_enabled = False
        user.mfa_secret_encrypted = None
        user.mfa_recovery_codes = None
        user.is_superadmin = False
        user.status = UserStatus.DELETED
        user.deleted_at = _now()
        user.default_organisation_id = None
        user.preferences = {}
        user.email_verified_at = None
        db.add(DataRequest(user_id=user.id, kind="deletion", status="completed", completed_at=_now()))
        await write_audit(
            db,
            action="privacy.account_deleted",
            organisation_id=None,
            actor_user_id=user.id,
            actor_label=label,
            entity_type="user",
            entity_id=user.id,
            ip_address=ctx.ip,
            request_id=ctx.request_id,
        )
        await db.flush()


# ----------------------------------------------------------------------------- retention


def retention_days(org: Organisation) -> int:
    days = int((org.settings or {}).get("retention_days") or DEFAULT_RETENTION_DAYS)
    return max(days, MIN_RETENTION_DAYS)


async def sweep_org(db: AsyncSession, org: Organisation) -> dict[str, Any]:
    """Delete notifications and AI conversation messages older than the org's retention period.
    Audit logs are never touched (they are append-only and kept for compliance)."""
    cutoff = _now() - timedelta(days=retention_days(org))
    n = await db.execute(
        delete(Notification).where(Notification.organisation_id == org.id, Notification.created_at < cutoff)
    )
    m = await db.execute(
        delete(AIMessage).where(AIMessage.organisation_id == org.id, AIMessage.created_at < cutoff)
    )
    s = await db.execute(
        delete(AISession).where(
            AISession.organisation_id == org.id,
            AISession.updated_at < cutoff,
            ~exists().where(and_(AIMessage.session_id == AISession.id)),
        )
    )
    result = {
        "notifications_deleted": int(n.rowcount or 0),
        "ai_messages_deleted": int(m.rowcount or 0),
        "ai_sessions_deleted": int(s.rowcount or 0),
        "cutoff": cutoff,
    }
    if any(v for k, v in result.items() if k != "cutoff"):
        await write_audit(
            db,
            action="privacy.retention_sweep",
            organisation_id=org.id,
            actor_type="system",
            actor_label="system:retention",
            entity_type="organisation",
            entity_id=org.id,
            meta={**{k: v for k, v in result.items() if k != "cutoff"}, "cutoff": cutoff.isoformat()},
        )
    return result
