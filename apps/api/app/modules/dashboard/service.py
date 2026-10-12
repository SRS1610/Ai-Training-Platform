"""Learner and instructor dashboards. Reads other modules' tables directly (read-only, batched queries)."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import case, false, func, or_, select

from app.auth.deps import Ctx
from app.models.ai import AIGeneration
from app.models.assessment import Assessment, AssessmentAttempt, AttemptStatus
from app.models.assignment import Assignment, Submission, SubmissionStatus
from app.models.content import Course, CourseStatus, CourseVersion, LearnerSkill, Lesson, Skill
from app.models.identity import User
from app.models.learning import ActivityDay, Enrolment, EnrolmentStatus, LessonProgress
from app.models.platform import Certificate, Recommendation
from app.models.simulation import Simulation, SimulationSession, SimulationSessionStatus
from app.modules.courses.snapshot import linked_ids, next_lesson
from app.modules.dashboard import schemas as s

HEATMAP_DAYS = 84
ACTIVE = (EnrolmentStatus.NOT_STARTED, EnrolmentStatus.IN_PROGRESS)
PENDING_REVIEW = (SubmissionStatus.SUBMITTED, SubmissionStatus.AI_GRADED, SubmissionStatus.UNDER_REVIEW)
OPEN_SUBMISSION = (SubmissionStatus.DRAFT, SubmissionStatus.RETURNED)
APP = "/app"


def _tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def streaks(days: set[date], today: date) -> tuple[int, int]:
    """(current streak ending today or yesterday, longest streak)."""
    current = 0
    cursor = today if today in days else today - timedelta(days=1)
    while cursor in days:
        current += 1
        cursor -= timedelta(days=1)
    longest = run = 0
    prev: date | None = None
    for d in sorted(days):
        run = run + 1 if prev is not None and d - prev == timedelta(days=1) else 1
        longest = max(longest, run)
        prev = d
    return current, longest


# ----------------------------------------------------------------------------- learner


async def learner_dashboard(ctx: Ctx) -> s.LearnerDashboard:
    db, org_id, user_id = ctx.db, ctx.org_id, ctx.user_id
    tz = _tz(ctx.user.timezone)
    now = datetime.now(UTC)
    today = now.astimezone(tz).date()

    rows = (
        await db.execute(
            select(Enrolment, CourseVersion.snapshot)
            .join(CourseVersion, CourseVersion.id == Enrolment.course_version_id)
            .join(Course, Course.id == Enrolment.course_id)
            .where(
                Enrolment.organisation_id == org_id,
                Enrolment.user_id == user_id,
                Enrolment.status != EnrolmentStatus.WITHDRAWN,
                Course.deleted_at.is_(None),
            )
            .order_by(Enrolment.last_accessed_at.desc().nulls_last(), Enrolment.created_at.desc())
        )
    ).all()
    enrolments = [e for e, _ in rows]
    snapshots = {e.id: snap or {} for e, snap in rows}
    titles = {e.course_id: ((snapshots[e.id].get("course") or {}).get("title") or "") for e in enrolments}
    active = [e for e in enrolments if e.status in ACTIVE]
    completed = [e for e in enrolments if e.status == EnrolmentStatus.COMPLETED]
    scores = [e.final_score for e in completed if e.final_score is not None]

    # certificates
    cert_rows = list(
        (
            await db.execute(
                select(Certificate)
                .where(
                    Certificate.organisation_id == org_id,
                    Certificate.user_id == user_id,
                    Certificate.revoked_at.is_(None),
                )
                .order_by(Certificate.issued_at.desc())
            )
        ).scalars()
    )

    # activity days → streaks, weekly minutes, heatmap
    day_rows = (
        await db.execute(
            select(ActivityDay.day, ActivityDay.seconds).where(
                ActivityDay.organisation_id == org_id, ActivityDay.user_id == user_id
            )
        )
    ).all()
    seconds_by_day = {d: int(sec or 0) for d, sec in day_rows}
    streak, longest = streaks(set(seconds_by_day), today)
    week_seconds = sum(v for d, v in seconds_by_day.items() if today - timedelta(days=6) <= d <= today)
    heatmap = [
        s.HeatmapDay(
            day=(today - timedelta(days=i)).isoformat(),
            seconds=seconds_by_day.get(today - timedelta(days=i), 0),
        )
        for i in range(HEATMAP_DAYS - 1, -1, -1)
    ]

    # current courses
    current = active[:6]
    done_by_enrolment: dict[uuid.UUID, set[str]] = {}
    if current:
        for eid, lid in (
            await db.execute(
                select(LessonProgress.enrolment_id, LessonProgress.lesson_id).where(
                    LessonProgress.enrolment_id.in_([e.id for e in current]),
                    LessonProgress.status == "completed",
                )
            )
        ).all():
            done_by_enrolment.setdefault(eid, set()).add(str(lid))
    current_courses = []
    for e in current:
        snap = snapshots[e.id]
        meta = snap.get("course") or {}
        nxt = next_lesson(snap, done_by_enrolment.get(e.id, set()))
        current_courses.append(
            s.CurrentCourse(
                enrolment_id=e.id,
                course_id=e.course_id,
                title=meta.get("title") or "",
                thumbnail_url=meta.get("thumbnail_url"),
                category=meta.get("category"),
                difficulty=meta.get("difficulty"),
                progress_pct=e.progress_pct,
                status=e.status,
                due_date=e.due_date,
                last_accessed_at=e.last_accessed_at,
                next_lesson=s.NextLessonRef(id=nxt["id"], title=nxt["title"], lesson_type=nxt["lesson_type"])
                if nxt
                else None,
            )
        )

    deadlines = await _deadlines(ctx, active, snapshots, titles, tz, today, now)
    simulation_results = await _simulation_results(ctx)

    skills = [
        s.SkillItem(skill_id=sk.id, name=sk.name, category=sk.category, proficiency=round(ls.proficiency, 1))
        for ls, sk in (
            await db.execute(
                select(LearnerSkill, Skill)
                .join(Skill, Skill.id == LearnerSkill.skill_id)
                .where(LearnerSkill.organisation_id == org_id, LearnerSkill.user_id == user_id)
                .order_by(LearnerSkill.proficiency.desc(), Skill.name)
                .limit(8)
            )
        ).all()
    ]

    recs = [
        s.RecommendationItem(
            id=r.id,
            kind=r.kind,
            title=r.title,
            reason=r.reason,
            target_type=r.target_type,
            target_id=r.target_id,
            course_id=r.course_id,
        )
        for r in (
            await db.execute(
                select(Recommendation)
                .where(
                    Recommendation.organisation_id == org_id,
                    Recommendation.user_id == user_id,
                    Recommendation.status == "active",
                )
                .order_by(Recommendation.priority.desc(), Recommendation.created_at.desc())
                .limit(5)
            )
        ).scalars()
    ]

    return s.LearnerDashboard(
        stats=s.LearnerStats(
            courses_in_progress=len(active),
            courses_completed=len(completed),
            certificates=len(cert_rows),
            streak_days=streak,
            longest_streak=longest,
            average_score=round(sum(scores) / len(scores), 1) if scores else None,
            learning_minutes_week=week_seconds // 60,
        ),
        current_courses=current_courses,
        upcoming_deadlines=deadlines,
        simulation_results=simulation_results,
        skills=skills,
        certificates=[
            s.CertificateItem(
                id=c.id,
                certificate_number=c.certificate_number,
                course_title=c.course_title,
                issued_at=c.issued_at,
            )
            for c in cert_rows[:5]
        ],
        recommendations=recs,
        recent_activity=await _recent_activity(ctx, enrolments, titles, cert_rows),
        activity_heatmap=heatmap,
    )


async def _deadlines(
    ctx: Ctx,
    active: list[Enrolment],
    snapshots: dict[uuid.UUID, dict[str, Any]],
    titles: dict[uuid.UUID, str],
    tz: ZoneInfo,
    today: date,
    now: datetime,
) -> list[s.Deadline]:
    out: list[s.Deadline] = []
    for e in active:
        if e.due_date:
            out.append(
                s.Deadline(
                    type="course",
                    id=e.id,
                    title=titles.get(e.course_id, ""),
                    course_id=e.course_id,
                    course_title=titles.get(e.course_id),
                    due_at=datetime.combine(e.due_date, time(23, 59, 59), tz),
                    status="overdue" if e.due_date < today else e.status,
                )
            )

    # assignments linked from active enrolments' snapshots
    wanted: dict[uuid.UUID, Enrolment] = {}
    for e in active:
        for aid in linked_ids(snapshots[e.id])["assignment_id"]:
            wanted.setdefault(uuid.UUID(aid), e)
    subs = {
        sub.assignment_id: sub
        for sub in (
            await ctx.db.execute(
                select(Submission).where(
                    Submission.organisation_id == ctx.org_id,
                    Submission.user_id == ctx.user_id,
                    or_(
                        Submission.assignment_id.in_(list(wanted)) if wanted else false(),
                        (Submission.due_at.is_not(None)) & Submission.status.in_(OPEN_SUBMISSION),
                    ),
                )
            )
        ).scalars()
    }
    assignment_ids = set(wanted) | set(subs)
    assignments = (
        {
            a.id: a
            for a in (
                await ctx.db.execute(
                    select(Assignment).where(
                        Assignment.id.in_(assignment_ids),
                        Assignment.organisation_id == ctx.org_id,
                        Assignment.deleted_at.is_(None),
                    )
                )
            ).scalars()
        }
        if assignment_ids
        else {}
    )
    for aid, a in assignments.items():
        sub = subs.get(aid)
        if sub is not None and sub.status not in OPEN_SUBMISSION:
            continue  # already submitted / graded
        e = wanted.get(aid)
        due = sub.due_at if sub is not None and sub.due_at else None
        if due is None and e is not None and a.due_days_after_enrolment:
            due = e.created_at + timedelta(days=a.due_days_after_enrolment)
        if due is None:
            continue
        course_id = e.course_id if e else a.course_id
        out.append(
            s.Deadline(
                type="assignment",
                id=aid,
                title=a.title,
                course_id=course_id,
                course_title=titles.get(course_id) if course_id else None,
                due_at=due,
                status="overdue" if due < now else (sub.status if sub else "not_started"),
            )
        )
    out.sort(key=lambda d: d.due_at)
    return out[:10]


async def _simulation_results(ctx: Ctx) -> list[s.SimulationResult]:
    rows = (
        await ctx.db.execute(
            select(SimulationSession, Simulation.title)
            .join(Simulation, Simulation.id == SimulationSession.simulation_id)
            .where(
                SimulationSession.organisation_id == ctx.org_id,
                SimulationSession.user_id == ctx.user_id,
                SimulationSession.status == SimulationSessionStatus.COMPLETED,
            )
            .order_by(SimulationSession.completed_at.desc().nulls_last())
            .limit(5)
        )
    ).all()
    return [
        s.SimulationResult(
            session_id=ss.id,
            simulation_id=ss.simulation_id,
            title=title,
            total_score=ss.total_score,
            band=ss.band,
            passed=ss.passed,
            completed_at=ss.completed_at,
        )
        for ss, title in rows
    ]


async def _recent_activity(
    ctx: Ctx, enrolments: list[Enrolment], titles: dict[uuid.UUID, str], certs: list[Certificate]
) -> list[s.ActivityItem]:
    db, org_id, user_id = ctx.db, ctx.org_id, ctx.user_id
    items: list[s.ActivityItem] = []
    lp = (
        await db.execute(
            select(LessonProgress.lesson_id, LessonProgress.completed_at)
            .where(
                LessonProgress.organisation_id == org_id,
                LessonProgress.user_id == user_id,
                LessonProgress.status == "completed",
                LessonProgress.completed_at.is_not(None),
            )
            .order_by(LessonProgress.completed_at.desc())
            .limit(10)
        )
    ).all()
    if lp:
        lessons = {
            r.id: r
            for r in (
                await db.execute(
                    select(Lesson.id, Lesson.title, Lesson.course_id).where(Lesson.id.in_([r[0] for r in lp]))
                )
            ).all()
        }
        for lid, at in lp:
            info = lessons.get(lid)
            if info:
                items.append(
                    s.ActivityItem(
                        type="lesson_completed",
                        title=info.title,
                        at=at,
                        link=f"{APP}/learn/{info.course_id}/lesson/{lid}",
                    )
                )
    for e in enrolments:
        items.append(
            s.ActivityItem(
                type="course_enrolled",
                title=titles.get(e.course_id, ""),
                at=e.created_at,
                link=f"{APP}/learn/{e.course_id}",
            )
        )
        if e.completed_at:
            items.append(
                s.ActivityItem(
                    type="course_completed",
                    title=titles.get(e.course_id, ""),
                    at=e.completed_at,
                    link=f"{APP}/learn/{e.course_id}",
                )
            )
    for c in certs[:10]:
        items.append(
            s.ActivityItem(
                type="certificate_issued", title=c.course_title, at=c.issued_at, link=f"{APP}/certificates"
            )
        )
    for att, title in (
        await db.execute(
            select(AssessmentAttempt, Assessment.title)
            .join(Assessment, Assessment.id == AssessmentAttempt.assessment_id)
            .where(
                AssessmentAttempt.organisation_id == org_id,
                AssessmentAttempt.user_id == user_id,
                AssessmentAttempt.status == AttemptStatus.GRADED,
            )
            .order_by(AssessmentAttempt.graded_at.desc().nulls_last(), AssessmentAttempt.submitted_at.desc())
            .limit(10)
        )
    ).all():
        at = att.graded_at or att.submitted_at or att.created_at
        items.append(
            s.ActivityItem(
                type="assessment_graded", title=title, at=at, link=f"{APP}/quiz/{att.assessment_id}"
            )
        )
    for sub, title in (
        await db.execute(
            select(Submission, Assignment.title)
            .join(Assignment, Assignment.id == Submission.assignment_id)
            .where(
                Submission.organisation_id == org_id,
                Submission.user_id == user_id,
                Submission.graded_at.is_not(None),
            )
            .order_by(Submission.graded_at.desc())
            .limit(10)
        )
    ).all():
        items.append(
            s.ActivityItem(
                type="submission_graded",
                title=title,
                at=sub.graded_at,
                link=f"{APP}/assignments/{sub.assignment_id}",
            )
        )
    for sim in await _simulation_results(ctx):
        if sim.completed_at:
            items.append(
                s.ActivityItem(
                    type="simulation_completed",
                    title=sim.title,
                    at=sim.completed_at,
                    link=f"{APP}/simulations/session/{sim.session_id}",
                )
            )
    items.sort(key=lambda i: i.at, reverse=True)
    return items[:10]


# ----------------------------------------------------------------------------- instructor


async def instructor_dashboard(ctx: Ctx, scope: str) -> s.InstructorDashboard:
    db, org_id = ctx.db, ctx.org_id
    stmt = select(Course).where(Course.organisation_id == org_id, Course.deleted_at.is_(None))
    if scope != "all" or not ctx.can("courses.edit"):
        stmt = stmt.where(or_(Course.created_by == ctx.user_id, Course.instructor_id == ctx.user_id))
    courses = list((await db.execute(stmt.order_by(Course.updated_at.desc()))).scalars())
    ids = [c.id for c in courses]
    stats: dict[uuid.UUID, Any] = {}
    learners = 0
    if ids:
        stats = {
            r.course_id: r
            for r in (
                await db.execute(
                    select(
                        Enrolment.course_id,
                        func.count().label("total"),
                        func.count().filter(Enrolment.status == EnrolmentStatus.COMPLETED).label("completed"),
                        func.count()
                        .filter(Enrolment.status == EnrolmentStatus.IN_PROGRESS)
                        .label("in_progress"),
                        func.avg(
                            case((Enrolment.status == EnrolmentStatus.COMPLETED, Enrolment.final_score))
                        ).label("avg_score"),
                    )
                    .where(Enrolment.course_id.in_(ids), Enrolment.status != EnrolmentStatus.WITHDRAWN)
                    .group_by(Enrolment.course_id)
                )
            ).all()
        }
        learners = int(
            await db.scalar(
                select(func.count(func.distinct(Enrolment.user_id))).where(
                    Enrolment.course_id.in_(ids), Enrolment.status != EnrolmentStatus.WITHDRAWN
                )
            )
            or 0
        )
    vnums = (
        dict(
            (
                await db.execute(
                    select(CourseVersion.id, CourseVersion.version_number).where(
                        CourseVersion.id.in_([c.current_version_id for c in courses if c.current_version_id])
                    )
                )
            ).all()
        )
        if courses
        else {}
    )
    course_items = []
    rates = []
    for c in courses:
        st = stats.get(c.id)
        total = int(st.total) if st else 0
        done = int(st.completed) if st else 0
        rate = round(100.0 * done / total, 1) if total else None
        if rate is not None:
            rates.append(rate)
        course_items.append(
            s.InstructorCourse(
                id=c.id,
                title=c.title,
                status=c.status,
                thumbnail_url=c.thumbnail_url,
                current_version_number=vnums.get(c.current_version_id),
                enrolments=total,
                in_progress=int(st.in_progress) if st else 0,
                completed=done,
                completion_rate=rate,
                average_score=round(float(st.avg_score), 1) if st and st.avg_score is not None else None,
                updated_at=c.updated_at,
            )
        )

    review_filter = [Submission.organisation_id == org_id, Submission.status.in_(PENDING_REVIEW)]
    if not ctx.can("submissions.review"):
        review_filter.append(Assignment.course_id.in_(ids) if ids else false())
    pending = int(
        await db.scalar(
            select(func.count())
            .select_from(Submission)
            .join(Assignment, Assignment.id == Submission.assignment_id)
            .where(*review_filter)
        )
        or 0
    )
    queue = [
        s.ReviewItem(
            submission_id=sub.id,
            assignment_id=sub.assignment_id,
            assignment_title=title,
            user_id=sub.user_id,
            learner_name=name,
            status=sub.status,
            submitted_at=sub.submitted_at,
        )
        for sub, title, name in (
            await db.execute(
                select(Submission, Assignment.title, User.full_name)
                .join(Assignment, Assignment.id == Submission.assignment_id)
                .join(User, User.id == Submission.user_id)
                .where(*review_filter)
                .order_by(Submission.submitted_at.asc().nulls_last())
                .limit(10)
            )
        ).all()
    ]
    gens = [
        s.GenerationItem(
            id=g.id, kind=g.kind, status=g.status, course_id=g.course_id, created_at=g.created_at
        )
        for g in (
            await db.execute(
                select(AIGeneration)
                .where(AIGeneration.organisation_id == org_id, AIGeneration.requested_by == ctx.user_id)
                .order_by(AIGeneration.created_at.desc())
                .limit(5)
            )
        ).scalars()
    ]
    return s.InstructorDashboard(
        stats=s.InstructorStats(
            courses_total=len(courses),
            courses_published=sum(1 for c in courses if c.status == CourseStatus.PUBLISHED),
            total_enrolments=sum(int(st.total) for st in stats.values()),
            total_learners=learners,
            average_completion_rate=round(sum(rates) / len(rates), 1) if rates else None,
            pending_reviews=pending,
        ),
        courses=course_items,
        pending_reviews=pending,
        review_queue=queue,
        recent_generations=gens,
    )
