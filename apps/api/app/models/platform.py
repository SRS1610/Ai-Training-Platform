"""Certificates, notifications, gamification, recommendations, billing, audit and privacy."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, StrEnum, TenantScoped, Timestamps, UUIDPk

# ----------------------------------------------------------------------------- certificates


class Certificate(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "certificates"
    __table_args__ = (UniqueConstraint("organisation_id", "user_id", "course_id", "course_version_id"),)

    certificate_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)  # CERT-2026-000123
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    course_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("course_versions.id", ondelete="SET NULL")
    )
    enrolment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("enrolments.id", ondelete="SET NULL"))
    learner_name: Mapped[str] = mapped_column(String(200))
    course_title: Mapped[str] = mapped_column(String(255))
    organisation_name: Mapped[str] = mapped_column(String(200))
    instructor_name: Mapped[str | None] = mapped_column(String(200))
    score: Mapped[float | None] = mapped_column(Float)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    issued_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoke_reason: Mapped[str | None] = mapped_column(Text)
    verification_hash: Mapped[str] = mapped_column(String(64))  # HMAC over the certificate facts
    skills: Mapped[list[Any]] = mapped_column(default=list)
    pdf_file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("files.id", ondelete="SET NULL"))


# ----------------------------------------------------------------------------- notifications


class NotificationType(StrEnum):
    ASSIGNMENT_ASSIGNED = "assignment_assigned"
    ASSIGNMENT_DUE = "assignment_due"
    ASSIGNMENT_OVERDUE = "assignment_overdue"
    COURSE_COMPLETED = "course_completed"
    ASSESSMENT_PASSED = "assessment_passed"
    ASSESSMENT_FAILED = "assessment_failed"
    CERTIFICATE_ISSUED = "certificate_issued"
    INSTRUCTOR_FEEDBACK = "instructor_feedback"
    TRAINING_ASSIGNED = "training_assigned"
    AI_BUDGET_ALERT = "ai_budget_alert"
    BADGE_EARNED = "badge_earned"
    REVIEW_REQUESTED = "review_requested"
    GENERATION_READY = "generation_ready"
    SYSTEM = "system"


class Notification(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_unread", "user_id", "read_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(48))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str | None] = mapped_column(String(1024))
    data: Mapped[dict[str, Any]] = mapped_column(default=dict)
    channels: Mapped[dict[str, Any]] = mapped_column(default=dict)  # {"email": "sent", "push": "skipped"}
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NotificationPreference(UUIDPk, Timestamps, Base):
    __tablename__ = "notification_preferences"
    __table_args__ = (UniqueConstraint("user_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # {"<type>": {"email": bool, "in_app": bool, "push": bool}}
    settings: Mapped[dict[str, Any]] = mapped_column(default=dict)
    push_subscriptions: Mapped[list[Any]] = mapped_column(default=list)  # Web Push subscription objects


# ----------------------------------------------------------------------------- gamification


class PointsLedger(UUIDPk, TenantScoped, Base):
    __tablename__ = "points_ledger"
    __table_args__ = (Index("ix_points_org_user", "organisation_id", "user_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    points: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(64))
    ref_type: Mapped[str | None] = mapped_column(String(32))
    ref_id: Mapped[uuid.UUID | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Badge(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "badges"
    __table_args__ = (UniqueConstraint("organisation_id", "key"),)

    key: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(64), default="award")
    criteria: Mapped[dict[str, Any]] = mapped_column(default=dict)  # {"type": "courses_completed", "count": 1}


class UserBadge(UUIDPk, TenantScoped, Base):
    __tablename__ = "user_badges"
    __table_args__ = (UniqueConstraint("user_id", "badge_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    badge_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("badges.id", ondelete="CASCADE"))
    awarded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Recommendation(UUIDPk, Timestamps, TenantScoped, Base):
    """Personalised-learning output: recommended lessons/practice with an explanation of why."""

    __tablename__ = "recommendations"
    __table_args__ = (Index("ix_recommendations_org_user", "organisation_id", "user_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))  # lesson | practice | course | simulation | revision_plan
    target_type: Mapped[str | None] = mapped_column(String(32))
    target_id: Mapped[uuid.UUID | None] = mapped_column()
    course_id: Mapped[uuid.UUID | None] = mapped_column()
    title: Mapped[str] = mapped_column(String(255))
    reason: Mapped[str] = mapped_column(Text)
    priority: Mapped[float] = mapped_column(Float, default=0.5)
    skill_id: Mapped[uuid.UUID | None] = mapped_column()
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | dismissed | done
    data: Mapped[dict[str, Any]] = mapped_column(default=dict)


# ----------------------------------------------------------------------------- billing


class SubscriptionStatus(StrEnum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    INCOMPLETE = "incomplete"
    UNPAID = "unpaid"


class Subscription(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "subscriptions"

    plan_code: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default=SubscriptionStatus.ACTIVE)
    billing_interval: Mapped[str] = mapped_column(String(8), default="month")  # month | year
    seats: Mapped[int] = mapped_column(Integer, default=1)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(64), index=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    coupon_code: Mapped[str | None] = mapped_column(String(64))


class Payment(UUIDPk, Timestamps, TenantScoped, Base):
    """Invoices / payments mirrored from Stripe."""

    __tablename__ = "payments"

    stripe_invoice_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    amount_cents: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3), default="aud")
    status: Mapped[str] = mapped_column(String(16))  # draft | open | paid | void | uncollectible
    description: Mapped[str | None] = mapped_column(String(255))
    hosted_invoice_url: Mapped[str | None] = mapped_column(String(1024))
    invoice_pdf_url: Mapped[str | None] = mapped_column(String(1024))
    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class StripeEvent(Base):
    """Processed webhook ids for idempotency."""

    __tablename__ = "stripe_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    type: Mapped[str] = mapped_column(String(64))
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ----------------------------------------------------------------------------- audit


class AuditLog(UUIDPk, Base):
    """Immutable, hash-chained audit trail. UPDATE/DELETE are blocked by a database trigger."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_org_created", "organisation_id", "created_at"),
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    organisation_id: Mapped[uuid.UUID | None] = mapped_column(index=True)  # no FK: survives org deletion
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    actor_type: Mapped[str] = mapped_column(String(16), default="user")  # user | api_key | system
    actor_label: Mapped[str | None] = mapped_column(String(320))
    action: Mapped[str] = mapped_column(String(64), index=True)  # e.g. course.published, grade.override
    entity_type: Mapped[str | None] = mapped_column(String(48))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(512))
    request_id: Mapped[str | None] = mapped_column(String(64))
    meta: Mapped[dict[str, Any]] = mapped_column("metadata", default=dict)
    prev_hash: Mapped[str | None] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


# ----------------------------------------------------------------------------- privacy


class Consent(UUIDPk, Base):
    __tablename__ = "consents"
    __table_args__ = (Index("ix_consents_user_purpose", "user_id", "purpose"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    organisation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))
    purpose: Mapped[str] = mapped_column(String(64))  # terms | privacy_policy | marketing | ai_processing | analytics
    policy_version: Mapped[str] = mapped_column(String(32))
    granted: Mapped[bool] = mapped_column(Boolean)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DataRequest(UUIDPk, Timestamps, Base):
    """GDPR / Privacy Act data subject requests: export and erasure."""

    __tablename__ = "data_requests"

    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # export | deletion
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | processing | completed | failed
    file_storage_key: Mapped[str | None] = mapped_column(String(512))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
