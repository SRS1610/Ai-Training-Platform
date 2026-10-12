"""Gamification: points ledger, levels, streaks, badges (criteria-driven) and leaderboards.

Everything is gated by ``organisation.settings.gamification_enabled`` (default true) and the plan feature
``gamification``. When disabled no points or badges are awarded and read endpoints report ``enabled=false``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import and_, desc, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assessment import AssessmentAttempt
from app.models.assignment import Submission
from app.models.identity import User
from app.models.learning import ActivityDay, Enrolment, EnrolmentStatus, LessonProgress
from app.models.platform import Badge, Certificate, PointsLedger, UserBadge
from app.models.simulation import SimulationSession, SimulationSessionStatus
from app.models.tenancy import MembershipStatus, Organisation, OrganisationUser
from app.modules.billing.plans import has_feature

# ----------------------------------------------------------------------------- configuration

POINTS = {
    "lesson_completed": 10,
    "assessment_passed": 50,
    "assignment_passed": 75,
    "course_completed": 200,
    "certificate_issued": 100,
}
SIMULATION_BAND_POINTS = {
    "expert": 150,
    "advanced": 120,
    "proficient": 100,
    "competent": 75,
    "developing": 50,
    "novice": 25,
}
SIMULATION_DEFAULT_POINTS = {True: 75, False: 25}

LEVELS: list[tuple[int, str, int]] = [
    (1, "Novice", 0),
    (2, "Apprentice", 100),
    (3, "Explorer", 250),
    (4, "Practitioner", 500),
    (5, "Specialist", 1000),
    (6, "Expert", 2000),
    (7, "Master", 3500),
    (8, "Mentor", 5500),
    (9, "Champion", 8000),
    (10, "Legend", 12000),
]

CRITERIA_TYPES = {
    "points": "Total points earned",
    "lessons_completed": "Lessons completed",
    "courses_completed": "Courses completed",
    "certificates_earned": "Certificates earned",
    "assessments_passed": "Assessments passed",
    "perfect_assessments": "Assessments scored 100%",
    "assignments_passed": "Practical assignments passed",
    "simulations_completed": "Simulations completed",
    "simulation_band": "Simulations completed at a given band (criteria.band)",
    "streak_days": "Consecutive active days (longest streak)",
    "manual": "Awarded manually by an administrator",
}

DEFAULT_BADGES: list[dict[str, Any]] = [
    {
        "key": "first_steps",
        "name": "First Steps",
        "icon": "footprints",
        "description": "Complete your first lesson.",
        "criteria": {"type": "lessons_completed", "count": 1},
    },
    {
        "key": "knowledge_seeker",
        "name": "Knowledge Seeker",
        "icon": "book-open",
        "description": "Complete 25 lessons.",
        "criteria": {"type": "lessons_completed", "count": 25},
    },
    {
        "key": "course_finisher",
        "name": "Course Finisher",
        "icon": "graduation-cap",
        "description": "Complete your first course.",
        "criteria": {"type": "courses_completed", "count": 1},
    },
    {
        "key": "lifelong_learner",
        "name": "Lifelong Learner",
        "icon": "library",
        "description": "Complete 5 courses.",
        "criteria": {"type": "courses_completed", "count": 5},
    },
    {
        "key": "quiz_ace",
        "name": "Quiz Ace",
        "icon": "target",
        "description": "Score 100% on an assessment.",
        "criteria": {"type": "perfect_assessments", "count": 1},
    },
    {
        "key": "practical_pro",
        "name": "Practical Pro",
        "icon": "wrench",
        "description": "Pass 3 practical assignments.",
        "criteria": {"type": "assignments_passed", "count": 3},
    },
    {
        "key": "simulation_expert",
        "name": "Simulation Expert",
        "icon": "cpu",
        "description": "Finish a simulation in the Expert band.",
        "criteria": {"type": "simulation_band", "band": "expert", "count": 1},
    },
    {
        "key": "certified",
        "name": "Certified",
        "icon": "award",
        "description": "Earn your first certificate.",
        "criteria": {"type": "certificates_earned", "count": 1},
    },
    {
        "key": "streak_7",
        "name": "7-Day Streak",
        "icon": "flame",
        "description": "Learn 7 days in a row.",
        "criteria": {"type": "streak_days", "count": 7},
    },
    {
        "key": "streak_30",
        "name": "30-Day Streak",
        "icon": "flame",
        "description": "Learn 30 days in a row.",
        "criteria": {"type": "streak_days", "count": 30},
    },
    {
        "key": "high_achiever",
        "name": "High Achiever",
        "icon": "trophy",
        "description": "Earn 1,000 points.",
        "criteria": {"type": "points", "count": 1000},
    },
]
SEEDED_FLAG = "gamification_badges_seeded"


def is_enabled(org: Organisation) -> bool:
    return bool((org.settings or {}).get("gamification_enabled", True)) and has_feature(org, "gamification")


async def org_enabled(db: AsyncSession, org_id: uuid.UUID) -> bool:
    org = await db.get(Organisation, org_id)
    return bool(org) and is_enabled(org)  # type: ignore[arg-type]


def level_for(points: int) -> dict[str, Any]:
    current = LEVELS[0]
    for lvl in LEVELS:
        if points >= lvl[2]:
            current = lvl
    idx = LEVELS.index(current)
    nxt = LEVELS[idx + 1] if idx + 1 < len(LEVELS) else None
    if nxt:
        span = nxt[2] - current[2]
        progress = round(100.0 * (points - current[2]) / span, 1) if span else 100.0
    else:
        progress = 100.0
    return {
        "level": current[0],
        "name": current[1],
        "min_points": current[2],
        "next_level": nxt[0] if nxt else None,
        "next_level_name": nxt[1] if nxt else None,
        "next_level_points": nxt[2] if nxt else None,
        "points_to_next": (nxt[2] - points) if nxt else 0,
        "progress_pct": progress,
    }


# ----------------------------------------------------------------------------- activity & streaks


async def record_activity(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, day: date | None = None
) -> None:
    """Ensure an ``activity_days`` row exists for today (idempotent; learning module may also increment)."""
    stmt = (
        pg_insert(ActivityDay)
        .values(
            id=uuid.uuid4(),
            organisation_id=org_id,
            user_id=user_id,
            day=day or datetime.now(UTC).date(),
            events=1,
            seconds=0,
        )
        .on_conflict_do_nothing(index_elements=["organisation_id", "user_id", "day"])
    )
    await db.execute(stmt)


_STREAK_SQL = text("""
WITH d AS (
  SELECT DISTINCT day FROM activity_days WHERE organisation_id = :org AND user_id = :uid
), g AS (
  SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::int AS grp FROM d
)
SELECT max(day) AS last_day, count(*) AS len FROM g GROUP BY grp ORDER BY max(day) DESC
""")


async def streak(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, today: date | None = None
) -> dict[str, Any]:
    today = today or datetime.now(UTC).date()
    islands = (await db.execute(_STREAK_SQL, {"org": org_id, "uid": user_id})).all()
    if not islands:
        return {"current": 0, "longest": 0, "last_active_day": None, "active_today": False}
    last_day, last_len = islands[0]
    current = int(last_len) if last_day >= today - timedelta(days=1) else 0
    return {
        "current": current,
        "longest": max(int(r[1]) for r in islands),
        "last_active_day": last_day,
        "active_today": last_day == today,
    }


# ----------------------------------------------------------------------------- points


async def total_points(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> int:
    return int(
        await db.scalar(
            select(func.coalesce(func.sum(PointsLedger.points), 0)).where(
                PointsLedger.organisation_id == org_id, PointsLedger.user_id == user_id
            )
        )
        or 0
    )


async def _ref_points(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, reason: str, ref_id: Any
) -> int | None:
    return await db.scalar(
        select(func.sum(PointsLedger.points)).where(
            PointsLedger.organisation_id == org_id,
            PointsLedger.user_id == user_id,
            PointsLedger.reason == reason,
            PointsLedger.ref_id == ref_id,
        )
    )


async def award_points(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    points: int,
    reason: str,
    ref_type: str | None = None,
    ref_id: Any = None,
    *,
    once: bool = True,
) -> int:
    """Append to the ledger. With ``once`` the same (reason, ref) is only rewarded once per user."""
    if points <= 0:
        return 0
    ref_uuid = uuid.UUID(str(ref_id)) if ref_id else None
    if once and ref_uuid is not None and await _ref_points(db, org_id, user_id, reason, ref_uuid) is not None:
        return 0
    db.add(
        PointsLedger(
            organisation_id=org_id,
            user_id=user_id,
            points=int(points),
            reason=reason,
            ref_type=ref_type,
            ref_id=ref_uuid,
        )
    )
    await db.flush()
    return int(points)


async def award_top_up(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    target: int,
    reason: str,
    ref_type: str,
    ref_id: Any,
) -> int:
    """Award only the difference between ``target`` and points already earned for this ref (best-of)."""
    ref_uuid = uuid.UUID(str(ref_id))
    prior = int(await _ref_points(db, org_id, user_id, reason, ref_uuid) or 0)
    return await award_points(db, org_id, user_id, target - prior, reason, ref_type, ref_uuid, once=False)


# ----------------------------------------------------------------------------- badges


async def ensure_default_badges(db: AsyncSession, org_id: uuid.UUID) -> None:
    """Lazily seed the default badge set once per organisation."""
    org = await db.get(Organisation, org_id)
    if org is None or (org.settings or {}).get(SEEDED_FLAG):
        return
    existing = set((await db.execute(select(Badge.key).where(Badge.organisation_id == org_id))).scalars())
    for b in DEFAULT_BADGES:
        if b["key"] not in existing:
            db.add(
                Badge(
                    organisation_id=org_id,
                    key=b["key"],
                    name=b["name"],
                    description=b["description"],
                    icon=b["icon"],
                    criteria={**b["criteria"], "default": True},
                )
            )
    org.settings = {**(org.settings or {}), SEEDED_FLAG: True}
    await db.flush()


async def user_stats(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> dict[str, Any]:
    """All badge-criteria counters for one learner in a single round trip."""

    def scalar(stmt: Any) -> Any:
        return stmt.scalar_subquery()

    def org_user(m: Any) -> Any:
        return and_(m.organisation_id == org_id, m.user_id == user_id)

    row = (
        await db.execute(
            select(
                scalar(select(func.coalesce(func.sum(PointsLedger.points), 0)).where(org_user(PointsLedger))),
                scalar(
                    select(func.count())
                    .select_from(LessonProgress)
                    .where(org_user(LessonProgress), LessonProgress.status == "completed")
                ),
                scalar(
                    select(func.count())
                    .select_from(Enrolment)
                    .where(org_user(Enrolment), Enrolment.status == EnrolmentStatus.COMPLETED)
                ),
                scalar(
                    select(func.count())
                    .select_from(Certificate)
                    .where(org_user(Certificate), Certificate.revoked_at.is_(None))
                ),
                scalar(
                    select(func.count(func.distinct(AssessmentAttempt.assessment_id))).where(
                        org_user(AssessmentAttempt), AssessmentAttempt.passed.is_(True)
                    )
                ),
                scalar(
                    select(func.count())
                    .select_from(AssessmentAttempt)
                    .where(org_user(AssessmentAttempt), AssessmentAttempt.percentage >= 100)
                ),
                scalar(
                    select(func.count())
                    .select_from(Submission)
                    .where(org_user(Submission), Submission.passed.is_(True))
                ),
                scalar(
                    select(func.count())
                    .select_from(SimulationSession)
                    .where(
                        org_user(SimulationSession),
                        SimulationSession.status == SimulationSessionStatus.COMPLETED,
                    )
                ),
            )
        )
    ).one()
    bands = dict(
        (
            await db.execute(
                select(func.lower(SimulationSession.band), func.count())
                .where(
                    org_user(SimulationSession),
                    SimulationSession.status == SimulationSessionStatus.COMPLETED,
                    SimulationSession.band.is_not(None),
                )
                .group_by(func.lower(SimulationSession.band))
            )
        ).all()
    )
    s = await streak(db, org_id, user_id)
    return {
        "points": int(row[0]),
        "lessons_completed": int(row[1]),
        "courses_completed": int(row[2]),
        "certificates_earned": int(row[3]),
        "assessments_passed": int(row[4]),
        "perfect_assessments": int(row[5]),
        "assignments_passed": int(row[6]),
        "simulations_completed": int(row[7]),
        "simulation_bands": bands,
        "streak_days": max(s["longest"], s["current"]),
    }


def criteria_met(criteria: dict[str, Any], stats: dict[str, Any]) -> bool:
    ctype = criteria.get("type")
    need = int(criteria.get("count", 1) or 1)
    if ctype == "simulation_band":
        return int(stats["simulation_bands"].get(str(criteria.get("band", "expert")).lower(), 0)) >= need
    if ctype in stats and ctype != "simulation_bands":
        return int(stats[ctype]) >= need
    return False  # manual / unknown


async def grant_badge(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, badge: Badge) -> bool:
    stmt = (
        pg_insert(UserBadge)
        .values(
            id=uuid.uuid4(),
            organisation_id=org_id,
            user_id=user_id,
            badge_id=badge.id,
            awarded_at=datetime.now(UTC),
        )
        .on_conflict_do_nothing(index_elements=["user_id", "badge_id"])
        .returning(UserBadge.id)
    )
    inserted = (await db.execute(stmt)).scalar()
    if inserted is None:
        return False
    from app.modules.notifications.service import send_notification

    await send_notification(
        db,
        organisation_id=org_id,
        user_id=user_id,
        type="badge_earned",
        title=f"Badge earned: {badge.name}",
        body=badge.description or f"You earned the {badge.name} badge.",
        link="/app/dashboard",
        data={"badge_id": str(badge.id), "badge_key": badge.key, "icon": badge.icon},
    )
    return True


async def evaluate_badges(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> list[Badge]:
    """Award every not-yet-earned badge whose criteria the learner now satisfies."""
    await ensure_default_badges(db, org_id)
    earned = select(UserBadge.badge_id).where(
        UserBadge.organisation_id == org_id, UserBadge.user_id == user_id
    )
    candidates = (
        (await db.execute(select(Badge).where(Badge.organisation_id == org_id, Badge.id.not_in(earned))))
        .scalars()
        .all()
    )
    candidates = [b for b in candidates if (b.criteria or {}).get("type") not in (None, "manual")]
    if not candidates:
        return []
    stats = await user_stats(db, org_id, user_id)
    awarded = []
    for badge in candidates:
        if criteria_met(badge.criteria or {}, stats) and await grant_badge(db, org_id, user_id, badge):
            awarded.append(badge)
    return awarded


# ----------------------------------------------------------------------------- read models


async def my_summary(db: AsyncSession, org: Organisation, user_id: uuid.UUID) -> dict[str, Any]:
    enabled = is_enabled(org)
    s = await streak(db, org.id, user_id)
    if not enabled:
        return {
            "enabled": False,
            "points": 0,
            "level": level_for(0),
            "badges": [],
            "available_badges": [],
            "streak": s,
            "recent_points": [],
            "rank": None,
        }
    await ensure_default_badges(db, org.id)
    points = await total_points(db, org.id, user_id)
    rows = (
        await db.execute(
            select(Badge, UserBadge.awarded_at)
            .outerjoin(UserBadge, and_(UserBadge.badge_id == Badge.id, UserBadge.user_id == user_id))
            .where(Badge.organisation_id == org.id)
            .order_by(UserBadge.awarded_at.desc().nulls_last(), Badge.name)
        )
    ).all()
    badges, available = [], []
    for badge, awarded_at in rows:
        item = badge_dict(badge) | {"awarded_at": awarded_at, "earned": awarded_at is not None}
        (badges if awarded_at else available).append(item)
    recent = (
        (
            await db.execute(
                select(PointsLedger)
                .where(PointsLedger.organisation_id == org.id, PointsLedger.user_id == user_id)
                .order_by(PointsLedger.created_at.desc())
                .limit(10)
            )
        )
        .scalars()
        .all()
    )
    rank = await _rank_of(db, org.id, user_id, None)
    return {
        "enabled": True,
        "points": points,
        "level": level_for(points),
        "badges": badges,
        "available_badges": available,
        "streak": s,
        "rank": rank,
        "recent_points": [
            {
                "points": p.points,
                "reason": p.reason,
                "ref_type": p.ref_type,
                "ref_id": p.ref_id,
                "created_at": p.created_at,
            }
            for p in recent
        ],
    }


def badge_dict(b: Badge) -> dict[str, Any]:
    return {
        "id": b.id,
        "key": b.key,
        "name": b.name,
        "description": b.description,
        "icon": b.icon,
        "criteria": b.criteria or {},
    }


def period_start(period: str) -> datetime | None:
    now = datetime.now(UTC)
    return {"week": now - timedelta(days=7), "month": now - timedelta(days=30)}.get(period)


def _leaderboard_base(org_id: uuid.UUID, since: datetime | None, department_id: uuid.UUID | None):
    filters = [PointsLedger.organisation_id == org_id]
    if since is not None:
        filters.append(PointsLedger.created_at >= since)
    pts = func.sum(PointsLedger.points).label("points")
    stmt = (
        select(
            PointsLedger.user_id.label("user_id"),
            pts,
            func.rank().over(order_by=desc(func.sum(PointsLedger.points))).label("rank"),
        )
        .join(
            OrganisationUser,
            and_(
                OrganisationUser.organisation_id == org_id,
                OrganisationUser.user_id == PointsLedger.user_id,
                OrganisationUser.status == MembershipStatus.ACTIVE,
            ),
        )
        .join(User, User.id == PointsLedger.user_id)
        .where(
            *filters,
            User.deleted_at.is_(None),
            func.coalesce(User.preferences["leaderboard_opt_out"].astext, "false") != "true",
        )
        .group_by(PointsLedger.user_id)
        .having(func.sum(PointsLedger.points) > 0)
    )
    if department_id is not None:
        stmt = stmt.where(OrganisationUser.department_id == department_id)
    return stmt.subquery()


async def _rank_of(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    since: datetime | None,
    department_id: uuid.UUID | None = None,
) -> int | None:
    sub = _leaderboard_base(org_id, since, department_id)
    return await db.scalar(select(sub.c.rank).where(sub.c.user_id == user_id))


async def leaderboard(
    db: AsyncSession,
    org: Organisation,
    me: uuid.UUID,
    *,
    period: str,
    department_id: uuid.UUID | None,
    limit: int,
) -> dict[str, Any]:
    if not is_enabled(org):
        return {"enabled": False, "period": period, "entries": [], "me": None}
    since = period_start(period)
    sub = _leaderboard_base(org.id, since, department_id)
    rows = (
        await db.execute(
            select(sub.c.user_id, sub.c.points, sub.c.rank, User.full_name, User.avatar_url)
            .join(User, User.id == sub.c.user_id)
            .order_by(sub.c.rank, User.full_name)
            .limit(limit)
        )
    ).all()
    ids = [r.user_id for r in rows] + [me]
    totals = dict(
        (
            await db.execute(
                select(PointsLedger.user_id, func.sum(PointsLedger.points))
                .where(PointsLedger.organisation_id == org.id, PointsLedger.user_id.in_(ids))
                .group_by(PointsLedger.user_id)
            )
        ).all()
    )
    entries = [
        {
            "rank": int(r.rank),
            "user_id": r.user_id,
            "full_name": r.full_name,
            "avatar_url": r.avatar_url,
            "points": int(r.points),
            "level": level_for(int(totals.get(r.user_id, 0)))["level"],
            "is_me": r.user_id == me,
        }
        for r in rows
    ]
    my_row = (await db.execute(select(sub.c.rank, sub.c.points).where(sub.c.user_id == me))).first()
    user = await db.get(User, me)
    opted_out = bool((user.preferences or {}).get("leaderboard_opt_out")) if user else False
    return {
        "enabled": True,
        "period": period,
        "department_id": department_id,
        "entries": entries,
        "me": {
            "rank": int(my_row.rank) if my_row else None,
            "points": int(my_row.points) if my_row else 0,
            "opted_out": opted_out,
        },
    }
