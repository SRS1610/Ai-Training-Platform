"""Simulations: versioned scenario definitions, sessions, action log and state history."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDelete, StrEnum, TenantScoped, Timestamps, UUIDPk


class Simulation(UUIDPk, Timestamps, SoftDelete, TenantScoped, Base):
    __tablename__ = "simulations"

    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    industry: Mapped[str] = mapped_column(String(64), default="it")  # it | cybersecurity | business | ...
    environment_type: Mapped[str] = mapped_column(String(64), default="helpdesk")
    difficulty: Mapped[str] = mapped_column(String(16), default="intermediate")
    estimated_minutes: Mapped[int] = mapped_column(Integer, default=20)
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("courses.id", ondelete="SET NULL"), index=True
    )
    status: Mapped[str] = mapped_column(String(16), default="draft")
    is_graded: Mapped[bool] = mapped_column(Boolean, default=True)
    max_attempts: Mapped[int | None] = mapped_column(Integer)
    current_scenario_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("simulation_scenarios.id", ondelete="SET NULL", use_alter=True)
    )
    skill_ids: Mapped[list[Any]] = mapped_column(default=list)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    ai_generated: Mapped[bool] = mapped_column(Boolean, default=False)


class SimulationScenario(UUIDPk, Timestamps, TenantScoped, Base):
    """A version of a simulation's declarative definition (see packages/simulation-engine)."""

    __tablename__ = "simulation_scenarios"
    __table_args__ = (UniqueConstraint("simulation_id", "version"),)

    simulation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("simulations.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict[str, Any]] = mapped_column()
    builder_graph: Mapped[dict[str, Any]] = mapped_column(default=dict)  # node/flow editor layout
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft | published | superseded
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class SimulationSessionStatus(StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"
    ABANDONED = "abandoned"
    EXPIRED = "expired"


class SimulationSession(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "simulation_sessions"
    __table_args__ = (Index("ix_sim_sessions_org_user", "organisation_id", "user_id"),)

    simulation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("simulations.id", ondelete="CASCADE"), index=True
    )
    scenario_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("simulation_scenarios.id", ondelete="RESTRICT"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    enrolment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("enrolments.id", ondelete="SET NULL"))
    attempt_number: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(16), default=SimulationSessionStatus.ACTIVE)
    seed: Mapped[int] = mapped_column(Integer, default=0)  # scenario variation seed
    phase: Mapped[str] = mapped_column(String(64))
    state: Mapped[dict[str, Any]] = mapped_column(default=dict)  # full engine state (server side only)
    action_count: Mapped[int] = mapped_column(Integer, default=0)
    sim_minutes_elapsed: Mapped[float] = mapped_column(Float, default=0.0)
    dimension_scores: Mapped[dict[str, Any]] = mapped_column(default=dict)
    total_score: Mapped[float | None] = mapped_column(Float)
    band: Mapped[str | None] = mapped_column(String(32))
    passed: Mapped[bool | None] = mapped_column(Boolean)
    feedback: Mapped[dict[str, Any]] = mapped_column(default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SimulationAction(UUIDPk, Timestamps, TenantScoped, Base):
    __tablename__ = "simulation_actions"
    __table_args__ = (UniqueConstraint("session_id", "seq"),)

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("simulation_sessions.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(Integer)
    action_id: Mapped[str] = mapped_column(String(128))
    tool: Mapped[str | None] = mapped_column(String(64))
    input: Mapped[dict[str, Any]] = mapped_column(default=dict)
    outcome: Mapped[dict[str, Any]] = mapped_column(default=dict)  # messages, outputs, events, feedback
    phase_before: Mapped[str] = mapped_column(String(64))
    phase_after: Mapped[str] = mapped_column(String(64))
    score_deltas: Mapped[dict[str, Any]] = mapped_column(default=dict)
    classification: Mapped[str | None] = mapped_column(String(16))  # correct | neutral | incorrect | critical
    ai_generated_reply: Mapped[str | None] = mapped_column(Text)


class SimulationStateSnapshot(UUIDPk, Timestamps, TenantScoped, Base):
    """State history (one row per transition) for replay and behaviour analysis."""

    __tablename__ = "simulation_states"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("simulation_sessions.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(Integer)
    phase: Mapped[str] = mapped_column(String(64))
    variables: Mapped[dict[str, Any]] = mapped_column(default=dict)
    reason: Mapped[str | None] = mapped_column(String(255))
