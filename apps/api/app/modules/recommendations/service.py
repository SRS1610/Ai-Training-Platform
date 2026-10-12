"""Personalised learning: skill proficiency updates (EWMA with history) from graded evidence, rule-based
recommendations with plain-language reasons, and an AI-written study plan with a deterministic fallback."""

from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from praxis_ai import prompts as P
from praxis_ai.planning import build_plan
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models.assessment import (
    Assessment,
    AssessmentAttempt,
    AssessmentItem,
    AttemptAnswer,
    AttemptStatus,
    Question,
)
from app.models.assignment import Assignment, Submission
from app.models.content import Course, CourseVersion, LearnerSkill, Skill, course_skills
from app.models.learning import Enrolment, EnrolmentStatus
from app.models.platform import Recommendation
from app.models.simulation import Simulation, SimulationSession
from app.modules.ai import gateway

log = structlog.get_logger(__name__)
EWMA_ALPHA = 0.35
HISTORY_LIMIT = 50
WEAK = 70.0
STRONG = 80.0
PLAN_SCHEMA = {
    "summary": "string",
    "strengths": ["string"],
    "focus_areas": ["string"],
    "difficulty_adjustment": {"direction": "easier | maintain | harder", "reason": "string"},
    "steps": [
        {
            "week": "integer",
            "focus": "string",
            "activities": [
                {"title": "string", "type": "string", "target_id": "string | null", "reason": "string"}
            ],
        }
    ],
}


# --------------------------------------------------------------------------- skill evidence


def _uuid(v: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(v))
    except (ValueError, TypeError):
        return None


async def fold_scores(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    scores: dict[uuid.UUID, float],
    *,
    source: str,
    ref_id: Any,
) -> None:
    """EWMA update: new = α·score + (1-α)·old (first evidence sets the value). History is bounded."""
    if not scores:
        return
    valid = set(
        (
            await db.scalars(
                select(Skill.id).where(Skill.organisation_id == org_id, Skill.id.in_(list(scores)))
            )
        ).all()
    )
    existing = {
        ls.skill_id: ls
        for ls in (
            await db.scalars(
                select(LearnerSkill).where(
                    LearnerSkill.organisation_id == org_id,
                    LearnerSkill.user_id == user_id,
                    LearnerSkill.skill_id.in_(list(valid)),
                )
            )
        ).all()
    }
    now = datetime.now(UTC)
    for sid, raw in scores.items():
        if sid not in valid:
            continue
        score = round(max(0.0, min(100.0, float(raw))), 2)
        entry = {"source": source, "ref_id": str(ref_id), "score": score, "at": now.isoformat()}
        ls = existing.get(sid)
        if ls is None:
            db.add(
                LearnerSkill(
                    organisation_id=org_id,
                    user_id=user_id,
                    skill_id=sid,
                    proficiency=score,
                    evidence_count=1,
                    last_assessed_at=now,
                    history=[entry],
                )
            )
        else:
            prev = float(ls.proficiency or 0.0) if (ls.evidence_count or 0) > 0 else score
            ls.proficiency = round(EWMA_ALPHA * score + (1 - EWMA_ALPHA) * prev, 2)
            ls.evidence_count = (ls.evidence_count or 0) + 1
            ls.last_assessed_at = now
            ls.history = ([*(ls.history or []), entry])[-HISTORY_LIMIT:]
    await db.flush()


async def _course_skill_ids(db: AsyncSession, course_id: Any) -> list[uuid.UUID]:
    cid = _uuid(course_id)
    if cid is None:
        return []
    return list(
        (await db.scalars(select(course_skills.c.skill_id).where(course_skills.c.course_id == cid))).all()
    )


async def evidence_from_attempt(db: AsyncSession, payload: dict[str, Any]) -> None:
    attempt = await db.get(AssessmentAttempt, _uuid(payload.get("attempt_id")))
    if attempt is None:
        return
    answers = {
        str(a.question_id): a
        for a in (await db.scalars(select(AttemptAnswer).where(AttemptAnswer.attempt_id == attempt.id))).all()
    }
    per_skill: dict[uuid.UUID, list[float]] = defaultdict(list)
    for q in attempt.questions_snapshot or []:
        if not isinstance(q, dict):
            continue
        ans = answers.get(str(q.get("id")))
        pts = float(q.get("points") or 1.0)
        if ans is None:
            frac = 0.0
        elif ans.final_score is not None and pts > 0:
            frac = max(0.0, min(1.0, float(ans.final_score) / pts))
        else:
            frac = 1.0 if ans.is_correct else 0.0
        for sid in q.get("skill_ids") or []:
            u = _uuid(sid)
            if u:
                per_skill[u].append(frac * 100)
    scores = {sid: sum(v) / len(v) for sid, v in per_skill.items()}
    if not scores and attempt.percentage is not None:
        assessment = await db.get(Assessment, attempt.assessment_id)
        for sid in await _course_skill_ids(db, assessment.course_id if assessment else None):
            scores[sid] = float(attempt.percentage)
    await fold_scores(
        db, attempt.organisation_id, attempt.user_id, scores, source="assessment", ref_id=attempt.id
    )


async def evidence_from_submission(db: AsyncSession, payload: dict[str, Any]) -> None:
    sub = await db.get(Submission, _uuid(payload.get("submission_id")))
    if sub is None:
        return
    score = payload.get("final_score", sub.final_score)
    if score is None:
        return
    assignment = await db.get(Assignment, sub.assignment_id)
    ids = [u for u in (_uuid(s) for s in (assignment.skill_ids if assignment else []) or []) if u]
    if not ids and assignment is not None:
        ids = await _course_skill_ids(db, assignment.course_id)
    await fold_scores(
        db,
        sub.organisation_id,
        sub.user_id,
        {i: float(score) for i in ids},
        source="assignment",
        ref_id=sub.id,
    )


def _dim_value(v: Any) -> float | None:
    if isinstance(v, int | float):
        return float(v)
    if isinstance(v, dict):
        s, m = v.get("score", v.get("value")), v.get("max") or v.get("max_score")
        if isinstance(s, int | float):
            return float(s) / float(m) * 100 if isinstance(m, int | float) and m else float(s)
    return None


async def evidence_from_simulation(db: AsyncSession, payload: dict[str, Any]) -> None:
    sess = await db.get(SimulationSession, _uuid(payload.get("session_id")))
    if sess is None:
        return
    sim = await db.get(Simulation, sess.simulation_id)
    total = payload.get("total_score", sess.total_score)
    scores: dict[uuid.UUID, float] = {}
    if total is not None:
        for s in (sim.skill_ids if sim else []) or []:
            u = _uuid(s)
            if u:
                scores[u] = float(total)
    dims = sess.dimension_scores or {}
    if dims:
        skills = (
            await db.execute(
                select(Skill.id, Skill.name).where(Skill.organisation_id == sess.organisation_id)
            )
        ).all()
        by_name = {name.lower().replace("-", " ").replace("_", " "): sid for sid, name in skills}
        for dim, v in dims.items():
            key = str(dim).lower().replace("-", " ").replace("_", " ")
            val = _dim_value(v)
            if key in by_name and val is not None:
                scores[by_name[key]] = val
    if not scores and total is not None and sim is not None:
        scores = {sid: float(total) for sid in await _course_skill_ids(db, sim.course_id)}
    await fold_scores(db, sess.organisation_id, sess.user_id, scores, source="simulation", ref_id=sess.id)


# --------------------------------------------------------------------------- learner analysis


async def learner_snapshot(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> dict[str, Any]:
    skills = (
        await db.execute(
            select(LearnerSkill, Skill.name)
            .join(Skill, Skill.id == LearnerSkill.skill_id)
            .where(
                LearnerSkill.organisation_id == org_id,
                LearnerSkill.user_id == user_id,
                LearnerSkill.evidence_count > 0,
            )
            .order_by(LearnerSkill.proficiency)
        )
    ).all()
    weak = [
        {
            "skill_id": ls.skill_id,
            "name": n,
            "proficiency": round(ls.proficiency, 1),
            "evidence": ls.evidence_count,
        }
        for ls, n in skills
        if ls.proficiency < WEAK
    ][:5]
    strong = [
        {"skill_id": ls.skill_id, "name": n, "proficiency": round(ls.proficiency, 1)}
        for ls, n in sorted(skills, key=lambda r: -r[0].proficiency)
        if ls.proficiency >= STRONG
    ][:3]
    enrolments = (
        await db.execute(
            select(Enrolment, CourseVersion.snapshot, Course.duration_minutes)
            .join(CourseVersion, CourseVersion.id == Enrolment.course_version_id)
            .join(Course, Course.id == Enrolment.course_id)
            .where(
                Enrolment.organisation_id == org_id,
                Enrolment.user_id == user_id,
                Enrolment.status != EnrolmentStatus.WITHDRAWN,
            )
        )
    ).all()
    since = datetime.now(UTC) - timedelta(days=90)
    attempts = (
        await db.scalars(
            select(AssessmentAttempt)
            .where(
                AssessmentAttempt.organisation_id == org_id,
                AssessmentAttempt.user_id == user_id,
                AssessmentAttempt.status == AttemptStatus.GRADED,
                AssessmentAttempt.created_at >= since,
            )
            .order_by(AssessmentAttempt.created_at.desc())
            .limit(20)
        )
    ).all()
    wrong: Counter[str] = Counter()
    prompts: dict[str, str] = {}
    for att in attempts:
        snap = {str(q.get("id")): q for q in att.questions_snapshot or [] if isinstance(q, dict)}
        rows = (
            await db.scalars(
                select(AttemptAnswer).where(
                    AttemptAnswer.attempt_id == att.id, AttemptAnswer.is_correct.is_(False)
                )
            )
        ).all()
        for a in rows:
            qid = str(a.question_id)
            wrong[qid] += 1
            if qid in snap and snap[qid].get("prompt"):
                prompts[qid] = str(snap[qid]["prompt"])[:200]
    pcts = [a.percentage for a in attempts if a.percentage is not None]
    sub_scores = list(
        (
            await db.scalars(
                select(Submission.final_score)
                .where(
                    Submission.organisation_id == org_id,
                    Submission.user_id == user_id,
                    Submission.final_score.is_not(None),
                )
                .limit(20)
            )
        ).all()
    )
    scores = pcts + [float(s) for s in sub_scores]
    # Learning speed: minutes spent per 10% progress vs the course's expected pace.
    ratios = []
    for e, _snap, duration in enrolments:
        if e.progress_pct and e.progress_pct >= 10 and duration:
            expected = duration * 60 * (e.progress_pct / 100.0)
            if expected > 0:
                ratios.append((e.time_spent_seconds or 0) / expected)
    ratio = sum(ratios) / len(ratios) if ratios else None
    pace = None if ratio is None else ("slow" if ratio > 1.5 else "fast" if ratio < 0.6 else "steady")
    return {
        "weak": weak,
        "strong": strong,
        "enrolments": enrolments,
        "failed_questions": [prompts[q] for q, _ in wrong.most_common(8) if q in prompts],
        "repeated_mistakes": [prompts[q] for q, n in wrong.most_common() if n >= 2 and q in prompts][:5],
        "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
        "attempts": len(scores),
        "pace": pace,
        "time_ratio": round(ratio, 2) if ratio is not None else None,
    }


def _reason(skill: dict[str, Any], strong: list[dict[str, Any]], what: str) -> str:
    if strong:
        return (
            f"Your performance indicates that you understand {strong[0]['name']} but need additional "
            f"practice in {skill['name']} (currently {skill['proficiency']:.0f}%). {what}"
        )
    return f"Your recent results show {skill['name']} at {skill['proficiency']:.0f}%. {what}"


async def refresh(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> list[Recommendation]:
    """Regenerate the learner's active recommendations (dismissed targets are not re-suggested)."""
    snap = await learner_snapshot(db, org_id, user_id)
    dismissed = set(
        (
            await db.scalars(
                select(Recommendation.target_id).where(
                    Recommendation.organisation_id == org_id,
                    Recommendation.user_id == user_id,
                    Recommendation.status == "dismissed",
                    Recommendation.target_id.is_not(None),
                )
            )
        ).all()
    )
    await db.execute(
        delete(Recommendation).where(
            Recommendation.organisation_id == org_id,
            Recommendation.user_id == user_id,
            Recommendation.status == "active",
        )
    )
    recs: list[Recommendation] = []
    seen: set[tuple[str, Any]] = set()
    course_ids = [e.course_id for e, _, _ in snap["enrolments"]]

    def add(
        kind: str,
        title: str,
        reason: str,
        priority: float,
        *,
        target_type: str | None = None,
        target_id: uuid.UUID | None = None,
        course_id: uuid.UUID | None = None,
        skill_id: uuid.UUID | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        if target_id is not None and (target_id in dismissed or (kind, target_id) in seen):
            return
        seen.add((kind, target_id))
        recs.append(
            Recommendation(
                organisation_id=org_id,
                user_id=user_id,
                kind=kind,
                target_type=target_type,
                target_id=target_id,
                course_id=course_id,
                title=title[:255],
                reason=reason,
                priority=round(max(0.0, min(1.0, priority)), 3),
                skill_id=skill_id,
                status="active",
                data=data or {},
            )
        )

    for skill in snap["weak"]:
        sid = skill["skill_id"]
        base = 1.0 - skill["proficiency"] / 100.0
        # 1) lessons tagged with the skill in the learner's pinned course versions
        n_lessons = 0
        for e, snapshot, _ in snap["enrolments"]:
            for m in (snapshot or {}).get("modules") or []:
                for lsn in m.get("lessons") or []:
                    if (
                        str(sid) in {str(x) for x in lsn.get("skill_ids") or []}
                        and lsn.get("lesson_type") not in ("quiz", "assignment", "simulation")
                        and n_lessons < 2
                    ):
                        lid = _uuid(lsn.get("id"))
                        add(
                            "lesson",
                            f"Review: {lsn.get('title')}",
                            _reason(skill, snap["strong"], "This lesson revisits the key ideas."),
                            base + 0.05,
                            target_type="lesson",
                            target_id=lid,
                            course_id=e.course_id,
                            skill_id=sid,
                            data={"skill": skill["name"], "link": f"/app/learn/{e.course_id}/lesson/{lid}"},
                        )
                        n_lessons += 1
        # 2) practice: published assessments containing questions tagged with the skill
        qrows = (
            await db.execute(
                select(Question.id, Question.bank_id)
                .where(
                    Question.organisation_id == org_id,
                    Question.deleted_at.is_(None),
                    Question.skill_ids.contains([str(sid)]),
                )
                .limit(200)
            )
        ).all()
        if qrows:
            qids = [r[0] for r in qrows]
            banks = {r[1] for r in qrows if r[1]}
            conds = [AssessmentItem.question_id.in_(qids)] + (
                [AssessmentItem.bank_id.in_(banks)] if banks else []
            )
            assessments = (
                await db.scalars(
                    select(Assessment)
                    .join(AssessmentItem, AssessmentItem.assessment_id == Assessment.id)
                    .where(
                        Assessment.organisation_id == org_id,
                        Assessment.status == "published",
                        Assessment.deleted_at.is_(None),
                        Assessment.high_stakes.is_(False),
                        or_(*conds),
                        or_(Assessment.course_id.in_(course_ids), Assessment.course_id.is_(None))
                        if course_ids
                        else Assessment.course_id.is_(None),
                    )
                    .distinct()
                    .limit(3)
                )
            ).all()
            for a in sorted(assessments, key=lambda a: a.kind != "practice")[:2]:
                add(
                    "practice",
                    f"Practice: {a.title}",
                    _reason(skill, snap["strong"], "Practice questions will help consolidate it."),
                    base,
                    target_type="assessment",
                    target_id=a.id,
                    course_id=a.course_id,
                    skill_id=sid,
                    data={"skill": skill["name"], "link": f"/app/quiz/{a.id}"},
                )
        # 3) simulations exercising the skill
        sims = (
            await db.scalars(
                select(Simulation)
                .where(
                    Simulation.organisation_id == org_id,
                    Simulation.status == "published",
                    Simulation.deleted_at.is_(None),
                    Simulation.skill_ids.contains([str(sid)]),
                )
                .limit(2)
            )
        ).all()
        for sim in sims:
            add(
                "simulation",
                f"Simulation: {sim.title}",
                _reason(skill, snap["strong"], "A realistic simulation lets you apply it safely."),
                base - 0.05,
                target_type="simulation",
                target_id=sim.id,
                course_id=sim.course_id,
                skill_id=sid,
                data={"skill": skill["name"], "link": f"/app/simulations/{sim.id}"},
            )
        # 4) other published courses covering the skill that the learner isn't enrolled in
        courses = (
            await db.scalars(
                select(Course)
                .join(course_skills, course_skills.c.course_id == Course.id)
                .where(
                    Course.organisation_id == org_id,
                    Course.status == "published",
                    Course.deleted_at.is_(None),
                    course_skills.c.skill_id == sid,
                    Course.id.notin_(course_ids or [uuid.uuid4()]),
                )
                .limit(1)
            )
        ).all()
        for c in courses:
            add(
                "course",
                f"Course: {c.title}",
                _reason(skill, snap["strong"], "This course covers it in more depth."),
                base - 0.1,
                target_type="course",
                target_id=c.id,
                course_id=c.id,
                skill_id=sid,
                data={"skill": skill["name"], "link": f"/app/learn/{c.id}"},
            )
    if snap["weak"] or snap["failed_questions"]:
        focus = ", ".join(s["name"] for s in snap["weak"][:3]) or "the questions you missed"
        reason = f"A short revision plan focused on {focus}."
        if snap["repeated_mistakes"]:
            n = len(snap["repeated_mistakes"])
            reason += f" You've missed {n} question(s) more than once — revisit them first."
        if snap["pace"] == "slow":
            reason += (
                " You're spending longer than expected per lesson; shorter, more frequent sessions may help."
            )
        elif snap["pace"] == "fast":
            reason += " You move quickly through lessons; slow down on the weaker topics to lock them in."
        add(
            "revision_plan",
            "Your revision plan",
            reason,
            0.9 if snap["weak"] else 0.6,
            data={
                "focus_skills": [s["name"] for s in snap["weak"]],
                "failed_questions": snap["failed_questions"],
                "repeated_mistakes": snap["repeated_mistakes"],
                "pace": snap["pace"],
                "avg_score": snap["avg_score"],
                "link": "/app/skills",
            },
        )
    for r in recs:
        db.add(r)
    await db.flush()
    log.info("recommendations.refreshed", user_id=str(user_id), count=len(recs))
    return recs


async def list_active(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> list[Recommendation]:
    return list(
        (
            await db.scalars(
                select(Recommendation)
                .where(
                    Recommendation.organisation_id == org_id,
                    Recommendation.user_id == user_id,
                    Recommendation.status == "active",
                )
                .order_by(Recommendation.priority.desc(), Recommendation.created_at)
            )
        ).all()
    )


async def skills_summary(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(LearnerSkill, Skill.name)
            .join(Skill, Skill.id == LearnerSkill.skill_id)
            .where(LearnerSkill.organisation_id == org_id, LearnerSkill.user_id == user_id)
            .order_by(Skill.name)
        )
    ).all()
    return [
        {
            "skill_id": ls.skill_id,
            "name": n,
            "proficiency": round(ls.proficiency, 1),
            "evidence_count": ls.evidence_count,
            "last_assessed_at": ls.last_assessed_at,
            "trend": [h.get("score") for h in (ls.history or [])[-8:]],
        }
        for ls, n in rows
    ]


async def personalised_plan(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> dict[str, Any]:
    snap = await learner_snapshot(db, org_id, user_id)
    recs = await list_active(db, org_id, user_id)
    if not recs and (snap["weak"] or snap["failed_questions"]):
        recs = await refresh(db, org_id, user_id)
    skill_names = {s["skill_id"]: s["name"] for s in snap["weak"]}
    profile = {
        "weak_skills": [{"name": s["name"], "proficiency": s["proficiency"]} for s in snap["weak"]],
        "strong_skills": [{"name": s["name"], "proficiency": s["proficiency"]} for s in snap["strong"]],
        "recommendations": [
            {
                "title": r.title,
                "kind": r.kind,
                "target_id": str(r.target_id) if r.target_id else None,
                "skill": skill_names.get(r.skill_id) if r.skill_id else None,
                "reason": r.reason,
            }
            for r in recs
            if r.kind != "revision_plan"
        ][:12],
        "failed_questions": snap["failed_questions"][:5],
        "repeated_mistakes": snap["repeated_mistakes"],
        "avg_score": snap["avg_score"],
        "attempts": snap["attempts"],
        "pace": snap["pace"],
    }
    generated_by, model, offline = "ai", None, False
    try:
        plan, result = await gateway.generate_json_result(
            db,
            organisation_id=org_id,
            user_id=user_id,
            feature="recommendations",
            system=P.plan_system(),
            prompt=P.plan_prompt(profile),
            schema_hint=PLAN_SCHEMA,
            fallback=lambda: build_plan(profile),
            validator=_validate_plan,
            max_tokens=1500,
        )
        if result is None:
            generated_by = "rules"
        else:
            model, offline = result.model, result.offline
    except AppError as exc:  # feature disabled / budget / daily limit → deterministic plan
        log.info("recommendations.plan_fallback", reason=exc.code)
        plan, generated_by = build_plan(profile), "rules"
    allowed = {p["target_id"] for p in profile["recommendations"] if p["target_id"]}
    for step in plan.get("steps") or []:
        for act in step.get("activities") or []:
            if act.get("target_id") not in allowed:
                act["target_id"] = None  # never link to items that weren't offered to the model
    return {
        **plan,
        "generated_by": generated_by,
        "model": model,
        "offline": offline,
        "pace": snap["pace"],
        "avg_score": snap["avg_score"],
    }


def _validate_plan(d: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(d.get("summary"), str) or not isinstance(d.get("steps"), list):
        raise ValueError("plan needs summary and steps")
    adj = d.get("difficulty_adjustment") or {}
    if adj.get("direction") not in ("easier", "maintain", "harder"):
        d["difficulty_adjustment"] = {"direction": "maintain", "reason": str(adj.get("reason") or "")}
    d.setdefault("strengths", [])
    d.setdefault("focus_areas", [])
    return d
