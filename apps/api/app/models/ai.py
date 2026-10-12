"""AI: configuration, tutor sessions/messages, generations (approval workflow), usage ledger, knowledge base."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.config import settings
from app.models.base import Base, SoftDelete, StrEnum, TenantScoped, Timestamps, UUIDPk


class AIConfiguration(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "ai_configurations"
    __table_args__ = (UniqueConstraint("organisation_id"),)

    provider: Mapped[str] = mapped_column(String(32), default="offline")
    model: Mapped[str] = mapped_column(String(100), default="")
    embedding_model: Mapped[str] = mapped_column(String(100), default="")
    temperature: Mapped[float] = mapped_column(Float, default=0.3)
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=1500)
    # {"tutor": true, "content_generation": true, "grading": true, "simulation_ai": true, "recommendations": true}
    features: Mapped[dict[str, Any]] = mapped_column(default=dict)
    monthly_budget_usd: Mapped[float | None] = mapped_column(Numeric(12, 2))
    hard_limit: Mapped[bool] = mapped_column(Boolean, default=True)
    alert_thresholds: Mapped[list[Any]] = mapped_column(default=lambda: [50, 75, 90, 100])
    per_user_daily_requests: Mapped[int | None] = mapped_column(Integer, default=200)
    tutor_behaviour: Mapped[dict[str, Any]] = mapped_column(default=dict)  # tone, socratic, citations, language
    grading_mode: Mapped[str] = mapped_column(String(32), default="ai_assisted")
    knowledge_only: Mapped[bool] = mapped_column(Boolean, default=False)  # answer only from approved sources
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class AISessionKind(StrEnum):
    TUTOR = "tutor"
    SIMULATION_CHARACTER = "simulation_character"
    BUILDER = "builder"


class AISession(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "ai_sessions"
    __table_args__ = (Index("ix_ai_sessions_org_user", "organisation_id", "user_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32), default=AISessionKind.TUTOR)
    title: Mapped[str | None] = mapped_column(String(255))
    course_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"))
    lesson_id: Mapped[uuid.UUID | None] = mapped_column()
    context: Mapped[dict[str, Any]] = mapped_column(default=dict)


class AIMessage(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "ai_messages"

    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_sessions.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # user | assistant | system
    content: Mapped[str] = mapped_column(Text)
    mode: Mapped[str | None] = mapped_column(String(16))  # explain | hint (graded context) | refuse
    citations: Mapped[list[Any]] = mapped_column(default=list)
    safety: Mapped[dict[str, Any]] = mapped_column(default=dict)  # moderation / injection flags
    model: Mapped[str | None] = mapped_column(String(100))
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    feedback_rating: Mapped[int | None] = mapped_column(Integer)  # learner thumbs up/down


class GenerationStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"  # awaiting human review
    FAILED = "failed"
    APPROVED = "approved"
    REJECTED = "rejected"
    APPLIED = "applied"  # written into draft entities


class AIGeneration(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "ai_generations"
    __table_args__ = (Index("ix_ai_generations_org_status", "organisation_id", "status"),)

    kind: Mapped[str] = mapped_column(String(48))  # course | lesson | quiz | assignment | simulation | rubric | ...
    status: Mapped[str] = mapped_column(String(16), default=GenerationStatus.PENDING)
    input: Mapped[dict[str, Any]] = mapped_column(default=dict)
    output: Mapped[dict[str, Any] | None] = mapped_column()
    edited_output: Mapped[dict[str, Any] | None] = mapped_column()  # instructor edits before apply
    error: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer, default=1)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ai_generations.id", ondelete="SET NULL"))
    course_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"))
    requested_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_notes: Mapped[str | None] = mapped_column(Text)
    applied_entity_type: Mapped[str | None] = mapped_column(String(32))
    applied_entity_id: Mapped[uuid.UUID | None] = mapped_column()
    provider: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(100))
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    safety: Mapped[dict[str, Any]] = mapped_column(default=dict)


class AIUsage(UUIDPk, TenantScoped, Base):
    """Append-only usage ledger used for cost tracking, budgets and billing."""

    __tablename__ = "ai_usage"
    __table_args__ = (Index("ix_ai_usage_org_created", "organisation_id", "created_at"),)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    course_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"))
    feature: Mapped[str] = mapped_column(String(48))  # tutor | generation | grading | simulation | embedding ...
    provider: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(100))
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(12, 6), default=0)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    success: Mapped[bool] = mapped_column(Boolean, default=True)


class AIBudgetAlert(UUIDPk, TenantScoped, Base):
    __tablename__ = "ai_budget_alerts"
    __table_args__ = (UniqueConstraint("organisation_id", "period", "threshold"),)

    period: Mapped[str] = mapped_column(String(7))  # YYYY-MM
    threshold: Mapped[int] = mapped_column(Integer)
    spend_usd: Mapped[float] = mapped_column(Numeric(12, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class KnowledgeDocument(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "knowledge_documents"

    title: Mapped[str] = mapped_column(String(255))
    course_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), index=True)
    source_type: Mapped[str] = mapped_column(String(16))  # pdf | docx | pptx | url | text | markdown
    source_url: Mapped[str | None] = mapped_column(String(2048))
    file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("files.id", ondelete="SET NULL"))
    category: Mapped[str | None] = mapped_column(String(64))  # policy | sop | manual | training ...
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | processing | ready | failed
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    char_count: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class KnowledgeChunk(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        Index(
            "ix_knowledge_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="CASCADE"), index=True
    )
    course_id: Mapped[uuid.UUID | None] = mapped_column(index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    heading: Mapped[str | None] = mapped_column(String(512))
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    embedding = mapped_column(Vector(settings.AI_EMBEDDING_DIM), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(100))
    meta: Mapped[dict[str, Any]] = mapped_column("metadata", default=dict)
