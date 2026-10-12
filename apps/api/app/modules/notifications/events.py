"""Domain-event subscribers that turn learning events into user notifications."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import subscribe
from app.models.assessment import Assessment
from app.models.assignment import Assignment
from app.models.content import Course
from app.models.simulation import Simulation
from app.modules.notifications.service import safe_handler, send_notification


async def _title(db: AsyncSession, model: Any, entity_id: Any, default: str) -> str:
    if not entity_id:
        return default
    title = await db.scalar(select(model.title).where(model.id == uuid.UUID(str(entity_id))))
    return title or default


def _fmt_score(value: Any) -> str:
    try:
        return f"{float(value):.0f}%"
    except (TypeError, ValueError):
        return "—"


@subscribe("enrolment.created")
@safe_handler
async def on_enrolment_created(db: AsyncSession, p: dict[str, Any]) -> None:
    if not p.get("assigned_by"):
        return
    if str(p["assigned_by"]) == str(p["user_id"]):
        return  # self-assigned
    course = await _title(db, Course, p.get("course_id"), "a course")
    due = p.get("due_date")
    body = f'You have been assigned "{course}".' + (f" It is due on {due}." if due else "")
    await send_notification(
        db,
        organisation_id=p["organisation_id"],
        user_id=p["user_id"],
        type="training_assigned",
        title=f"New training assigned: {course}",
        body=body,
        link=f"/app/learn/{p['course_id']}",
        data={
            "course_id": str(p["course_id"]),
            "enrolment_id": str(p.get("enrolment_id")),
            "due_date": str(due) if due else None,
        },
    )


@subscribe("course.completed")
@safe_handler
async def on_course_completed(db: AsyncSession, p: dict[str, Any]) -> None:
    course = await _title(db, Course, p.get("course_id"), "your course")
    score = p.get("final_score")
    body = f'Congratulations on completing "{course}".' + (
        f" Final score: {_fmt_score(score)}." if score is not None else ""
    )
    await send_notification(
        db,
        organisation_id=p["organisation_id"],
        user_id=p["user_id"],
        type="course_completed",
        title=f"Course completed: {course}",
        body=body,
        link=f"/app/learn/{p['course_id']}",
        data={"course_id": str(p["course_id"]), "final_score": score},
    )


@subscribe("assessment.attempt_graded")
@safe_handler
async def on_attempt_graded(db: AsyncSession, p: dict[str, Any]) -> None:
    title = await _title(db, Assessment, p.get("assessment_id"), "your assessment")
    passed = bool(p.get("passed"))
    pct = _fmt_score(p.get("percentage"))
    if passed:
        n_title, body = f"Passed: {title}", f'You scored {pct} on "{title}". Well done!'
    else:
        n_title, body = (
            f"Not passed yet: {title}",
            (f'You scored {pct} on "{title}". Review the feedback and try again.'),
        )
    await send_notification(
        db,
        organisation_id=p["organisation_id"],
        user_id=p["user_id"],
        type="assessment_passed" if passed else "assessment_failed",
        title=n_title,
        body=body,
        link=f"/app/quiz/{p['assessment_id']}",
        data={
            "attempt_id": str(p.get("attempt_id")),
            "assessment_id": str(p.get("assessment_id")),
            "percentage": p.get("percentage"),
            "passed": passed,
        },
    )


@subscribe("certificate.issued")
@safe_handler
async def on_certificate_issued(db: AsyncSession, p: dict[str, Any]) -> None:
    course = await _title(db, Course, p.get("course_id"), "your course")
    number = p.get("certificate_number")
    await send_notification(
        db,
        organisation_id=p["organisation_id"],
        user_id=p["user_id"],
        type="certificate_issued",
        title=f"Certificate issued: {course}",
        body=f'Your certificate for "{course}" is ready' + (f" (#{number})." if number else "."),
        link="/app/certificates",
        data={"certificate_id": str(p.get("certificate_id")), "certificate_number": number},
    )


@subscribe("submission.graded")
@safe_handler
async def on_submission_graded(db: AsyncSession, p: dict[str, Any]) -> None:
    title = await _title(db, Assignment, p.get("assignment_id"), "your assignment")
    passed = p.get("passed")
    outcome = "passed" if passed else ("needs more work" if passed is False else "graded")
    await send_notification(
        db,
        organisation_id=p["organisation_id"],
        user_id=p["user_id"],
        type="instructor_feedback",
        title=f"Feedback ready: {title}",
        body=f'Your submission for "{title}" has been graded ({_fmt_score(p.get("final_score"))}, {outcome}).',
        link=f"/app/assignments/{p['assignment_id']}",
        data={
            "submission_id": str(p.get("submission_id")),
            "assignment_id": str(p.get("assignment_id")),
            "final_score": p.get("final_score"),
            "passed": passed,
        },
    )


@subscribe("simulation.completed")
@safe_handler
async def on_simulation_completed(db: AsyncSession, p: dict[str, Any]) -> None:
    title = await _title(db, Simulation, p.get("simulation_id"), "your simulation")
    band = p.get("band")
    body = f'You finished "{title}" with a score of {_fmt_score(p.get("total_score"))}' + (
        f" ({str(band).title()})." if band else "."
    )
    await send_notification(
        db,
        organisation_id=p["organisation_id"],
        user_id=p["user_id"],
        type="simulation_completed",
        title=f"Simulation results: {title}",
        body=body,
        link=f"/app/simulations/session/{p['session_id']}",
        data={
            "session_id": str(p.get("session_id")),
            "simulation_id": str(p.get("simulation_id")),
            "total_score": p.get("total_score"),
            "band": band,
            "passed": p.get("passed"),
        },
    )
