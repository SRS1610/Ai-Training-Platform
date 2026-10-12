"""Direct-to-DB seeding helpers for the notifications / gamification / analytics / reports / search tests.

Other modules' APIs are developed concurrently, so these tests arrange rows with the models directly.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import bind_tenant, get_sessionmaker
from app.core.events import emit
from app.models.assessment import Assessment, AssessmentAttempt, AttemptAnswer, Question
from app.models.assignment import Assignment, Submission
from app.models.content import Course, CourseModule, CourseVersion, Lesson
from app.models.learning import Enrolment, LessonProgress
from app.models.simulation import Simulation, SimulationScenario, SimulationSession


@asynccontextmanager
async def tenant_session(org_id: uuid.UUID) -> AsyncIterator[AsyncSession]:
    """Session bound to one tenant (RLS enforced), committed on exit."""
    async with get_sessionmaker()() as s:
        await bind_tenant(s, org_id)
        yield s
        await s.commit()


async def emit_event(org_id: uuid.UUID, event: str, payload: dict[str, Any]) -> None:
    async with tenant_session(org_id) as s:
        await emit(s, event, {"organisation_id": org_id, **payload})


def now() -> datetime:
    return datetime.now(UTC)


@dataclass
class SeededCourse:
    course: Course
    version: CourseVersion
    modules: list[CourseModule] = field(default_factory=list)
    lessons: list[Lesson] = field(default_factory=list)

    @property
    def id(self) -> uuid.UUID:
        return self.course.id


async def seed_course(
    s: AsyncSession,
    org_id: uuid.UUID,
    *,
    title: str = "Network Fundamentals",
    status: str = "published",
    modules: int = 2,
    lessons_per_module: int = 2,
    description: str = "Learn the basics",
) -> SeededCourse:
    course = Course(
        organisation_id=org_id,
        slug=f"c-{uuid.uuid4().hex[:8]}",
        title=title,
        status=status,
        description=description,
    )
    s.add(course)
    await s.flush()
    result = SeededCourse(course=course, version=None)  # type: ignore[arg-type]
    for m in range(modules):
        mod = CourseModule(organisation_id=org_id, course_id=course.id, title=f"Module {m + 1}", position=m)
        s.add(mod)
        await s.flush()
        result.modules.append(mod)
        for i in range(lessons_per_module):
            lesson = Lesson(
                organisation_id=org_id,
                course_id=course.id,
                module_id=mod.id,
                title=f"{title} lesson {m + 1}.{i + 1}",
                position=i,
            )
            s.add(lesson)
            result.lessons.append(lesson)
    await s.flush()
    version = CourseVersion(
        organisation_id=org_id, course_id=course.id, version_number=1, snapshot={}, published_at=now()
    )
    s.add(version)
    await s.flush()
    course.current_version_id = version.id
    result.version = version
    return result


async def enrol(
    s: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, course: SeededCourse, **kw: Any
) -> Enrolment:
    e = Enrolment(
        organisation_id=org_id,
        user_id=user_id,
        course_id=course.id,
        course_version_id=course.version.id,
        **kw,
    )
    s.add(e)
    await s.flush()
    return e


async def complete_lessons(
    s: AsyncSession,
    org_id: uuid.UUID,
    enrolment: Enrolment,
    lessons: list[Lesson],
    *,
    completed: bool = True,
    seconds: int = 60,
) -> None:
    for lesson in lessons:
        s.add(
            LessonProgress(
                organisation_id=org_id,
                enrolment_id=enrolment.id,
                user_id=enrolment.user_id,
                lesson_id=lesson.id,
                status="completed" if completed else "in_progress",
                time_spent_seconds=seconds,
                completed_at=now() if completed else None,
            )
        )
    await s.flush()


async def seed_assessment(
    s: AsyncSession,
    org_id: uuid.UUID,
    course_id: uuid.UUID | None,
    *,
    questions: list[dict[str, Any]],
    title: str = "Final quiz",
) -> tuple[Assessment, list[Question]]:
    a = Assessment(organisation_id=org_id, course_id=course_id, title=title, status="published")
    s.add(a)
    qs = []
    for q in questions:
        question = Question(
            organisation_id=org_id,
            question_type="multiple_choice",
            prompt=q["prompt"],
            tags=q.get("tags", []),
            skill_ids=q.get("skill_ids", []),
        )
        s.add(question)
        qs.append(question)
    await s.flush()
    return a, qs


async def seed_attempt(
    s: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    assessment: Assessment,
    answers: dict[uuid.UUID, bool],
    *,
    attempt_number: int = 1,
    when: datetime | None = None,
    pass_pct: float = 70.0,
) -> AssessmentAttempt:
    correct = sum(1 for v in answers.values() if v)
    pct = 100.0 * correct / len(answers) if answers else 0.0
    at = AssessmentAttempt(
        organisation_id=org_id,
        assessment_id=assessment.id,
        user_id=user_id,
        attempt_number=attempt_number,
        status="graded",
        started_at=when or now(),
        submitted_at=when or now(),
        graded_at=when or now(),
        score=float(correct),
        max_score=float(len(answers)),
        percentage=pct,
        passed=pct >= pass_pct,
    )
    s.add(at)
    await s.flush()
    for qid, ok in answers.items():
        s.add(
            AttemptAnswer(
                organisation_id=org_id,
                attempt_id=at.id,
                question_id=qid,
                is_correct=ok,
                final_score=1.0 if ok else 0.0,
            )
        )
    await s.flush()
    return at


async def seed_assignment(
    s: AsyncSession,
    org_id: uuid.UUID,
    course_id: uuid.UUID | None,
    *,
    title: str = "Configure a firewall",
    status: str = "published",
) -> Assignment:
    a = Assignment(
        organisation_id=org_id, course_id=course_id, title=title, status=status, instructions="Do the thing"
    )
    s.add(a)
    await s.flush()
    return a


async def seed_submission(
    s: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    assignment: Assignment,
    *,
    score: float | None = None,
    passed: bool | None = None,
    status: str = "graded",
    due_at: datetime | None = None,
) -> Submission:
    sub = Submission(
        organisation_id=org_id,
        user_id=user_id,
        assignment_id=assignment.id,
        status=status,
        final_score=score,
        passed=passed,
        due_at=due_at,
        submitted_at=now() if score is not None else None,
        graded_at=now() if score is not None else None,
    )
    s.add(sub)
    await s.flush()
    return sub


async def seed_simulation(
    s: AsyncSession,
    org_id: uuid.UUID,
    course_id: uuid.UUID | None,
    *,
    title: str = "Helpdesk: printer outage",
    status: str = "published",
) -> tuple[Simulation, SimulationScenario]:
    sim = Simulation(
        organisation_id=org_id,
        course_id=course_id,
        title=title,
        status=status,
        description="Resolve a ticket",
    )
    s.add(sim)
    await s.flush()
    sc = SimulationScenario(
        organisation_id=org_id, simulation_id=sim.id, version=1, definition={}, status="published"
    )
    s.add(sc)
    await s.flush()
    return sim, sc


async def seed_sim_session(
    s: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    sim: Simulation,
    sc: SimulationScenario,
    *,
    score: float,
    band: str,
    passed: bool,
    dimensions: dict[str, Any],
    attempt_number: int = 1,
) -> SimulationSession:
    ss = SimulationSession(
        organisation_id=org_id,
        simulation_id=sim.id,
        scenario_id=sc.id,
        user_id=user_id,
        attempt_number=attempt_number,
        status="completed",
        phase="RESOLUTION",
        total_score=score,
        band=band,
        passed=passed,
        dimension_scores=dimensions,
        started_at=now(),
        completed_at=now(),
    )
    s.add(ss)
    await s.flush()
    return ss


def today() -> date:
    return datetime.now(UTC).date()


@dataclass
class Scenario:
    """A small, fully known data set for analytics/report assertions (see ``seed_scenario``)."""

    org_id: uuid.UUID
    course: SeededCourse
    learners: list[Any]
    department_id: uuid.UUID
    skill_id: uuid.UUID
    assessment_id: uuid.UUID
    question_ids: list[uuid.UUID]
    assignment_id: uuid.UUID
    simulation_id: uuid.UUID


async def seed_scenario(org_id: uuid.UUID, admin_user_id: uuid.UUID) -> Scenario:
    """Course with 2 modules × 2 lessons and three learners (L1, L2 in department "Operations"):

    * L1 completed (final 90, assigned, due in 5 days → on time), all 4 lessons, quiz 3/3, assignment 85
      (pass),
      simulation 90 "Expert" {diagnosis: 80, communication: {score 9, max 10}}, skill 80, active
        today+yesterday.
    * L2 in progress (assigned, due yesterday → overdue), module 1 done + lesson 3 started, quiz 1/3
      (q2, q3 wrong), assignment 45 (fail), simulation 60 "Developing" {diagnosis: 40, communication: 70},
      skill 50, active today.
    * L3 not started (self enrolled, no due date), quiz 1/3 (q1, q2 wrong).
    Competency "Network Admin" requires the skill at 70.
    """
    from datetime import timedelta

    from sqlalchemy import select

    from app.models.content import Competency, LearnerSkill, Skill
    from app.models.learning import ActivityDay
    from app.models.tenancy import Department, OrganisationUser
    from tests.factories import add_member

    learners = [await add_member(org_id, "learner", full_name=f"Learner {i}") for i in (1, 2, 3)]
    l1, l2, l3 = (a.user_id for a in learners)
    async with tenant_session(org_id) as s:
        dept = Department(organisation_id=org_id, name="Operations")
        s.add(dept)
        await s.flush()
        for uid in (l1, l2):
            m = await s.scalar(
                select(OrganisationUser).where(
                    OrganisationUser.organisation_id == org_id, OrganisationUser.user_id == uid
                )
            )
            m.department_id = dept.id
        course = await seed_course(s, org_id, title="Network Security 101", modules=2, lessons_per_module=2)
        e1 = await enrol(
            s,
            org_id,
            l1,
            course,
            status="completed",
            progress_pct=100,
            final_score=90,
            assigned_by=admin_user_id,
            source="assigned",
            due_date=today() + timedelta(days=5),
            started_at=now() - timedelta(days=2),
            completed_at=now(),
            time_spent_seconds=3600,
        )
        e2 = await enrol(
            s,
            org_id,
            l2,
            course,
            status="in_progress",
            progress_pct=50,
            assigned_by=admin_user_id,
            source="assigned",
            due_date=today() - timedelta(days=1),
            time_spent_seconds=1800,
        )
        await enrol(s, org_id, l3, course)
        await complete_lessons(s, org_id, e1, course.lessons)
        await complete_lessons(s, org_id, e2, course.lessons[:2])
        await complete_lessons(s, org_id, e2, course.lessons[2:3], completed=False)

        skill = Skill(organisation_id=org_id, name="Firewall configuration")
        s.add(skill)
        await s.flush()
        s.add(
            Competency(
                organisation_id=org_id,
                name="Network Admin",
                requirements=[{"skill_id": str(skill.id), "min_level": 70}],
            )
        )
        s.add_all(
            [
                LearnerSkill(
                    organisation_id=org_id, user_id=l1, skill_id=skill.id, proficiency=80, evidence_count=3
                ),
                LearnerSkill(
                    organisation_id=org_id, user_id=l2, skill_id=skill.id, proficiency=50, evidence_count=2
                ),
            ]
        )
        assessment, qs = await seed_assessment(
            s,
            org_id,
            course.id,
            questions=[
                {"prompt": "What does a firewall do?", "tags": ["networking"]},
                {"prompt": "Which port does HTTPS use?", "tags": ["security"], "skill_ids": [str(skill.id)]},
                {"prompt": "Define least privilege", "tags": ["security"]},
            ],
        )
        q1, q2, q3 = (q.id for q in qs)
        await seed_attempt(s, org_id, l1, assessment, {q1: True, q2: True, q3: True})
        await seed_attempt(s, org_id, l2, assessment, {q1: True, q2: False, q3: False})
        await seed_attempt(s, org_id, l3, assessment, {q1: False, q2: False, q3: True})
        assignment = await seed_assignment(s, org_id, course.id)
        await seed_submission(s, org_id, l1, assignment, score=85, passed=True)
        await seed_submission(s, org_id, l2, assignment, score=45, passed=False)
        sim, sc = await seed_simulation(s, org_id, course.id)
        await seed_sim_session(
            s,
            org_id,
            l1,
            sim,
            sc,
            score=90,
            band="Expert",
            passed=True,
            dimensions={"diagnosis": 80, "communication": {"score": 9, "max": 10}},
        )
        await seed_sim_session(
            s,
            org_id,
            l2,
            sim,
            sc,
            score=60,
            band="Developing",
            passed=False,
            dimensions={"diagnosis": 40, "communication": 70},
        )
        s.add_all(
            [
                ActivityDay(organisation_id=org_id, user_id=l1, day=today(), seconds=600),
                ActivityDay(organisation_id=org_id, user_id=l1, day=today() - timedelta(days=1), seconds=300),
                ActivityDay(organisation_id=org_id, user_id=l2, day=today(), seconds=120),
            ]
        )
    return Scenario(
        org_id=org_id,
        course=course,
        learners=learners,
        department_id=dept.id,
        skill_id=skill.id,
        assessment_id=assessment.id,
        question_ids=[q1, q2, q3],
        assignment_id=assignment.id,
        simulation_id=sim.id,
    )
