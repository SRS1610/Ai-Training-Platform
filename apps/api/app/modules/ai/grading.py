"""AI grading of practical submissions and open-ended assessment answers (explainable, rubric based).

Results are stored as append-only ``Grade`` rows (source="ai") and handed to the owning modules through
their contract functions:

* ``app.modules.assignments.service.apply_grade`` — final only for ``grading_mode == "ai_assisted"`` and
  not ``high_stakes`` (high-stakes AI grades are recommendations awaiting a human final grade);
* ``app.modules.assessments.service.finalize_attempt`` — skipped for high-stakes / human-final
  assessments, which are left in ``needs_review``.
"""

from __future__ import annotations

import inspect
import uuid
from typing import Any

import structlog
from praxis_ai import prompts as P
from praxis_ai.extract import ExtractionError, extract_text, kind_from_name
from praxis_ai.grading import heuristic_grade_answer, heuristic_grade_submission
from praxis_ai.safety import detect_injection, screen_output
from praxis_ai.text import normalise, sentences
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assessment import (
    AUTO_GRADED_TYPES,
    Assessment,
    AssessmentAttempt,
    AttemptAnswer,
    AttemptStatus,
)
from app.models.assignment import Assignment, Grade, Rubric, Submission, SubmissionStatus, SubmissionVersion
from app.models.content import StoredFile
from app.modules.ai import gateway

log = structlog.get_logger(__name__)

SUBMISSION_SCHEMA = {
    "criteria": [
        {
            "criterion_id": "string",
            "name": "string",
            "score": "number",
            "max": "number",
            "evidence": ["verbatim quote"],
            "comment": "string",
        }
    ],
    "strengths": ["string"],
    "weaknesses": ["string"],
    "missing_requirements": ["string"],
    "improvements": ["string"],
    "summary": "string",
    "confidence": "number 0..1",
}
ANSWER_SCHEMA = {
    "score_fraction": "number 0..1",
    "feedback": "string",
    "strengths": ["string"],
    "improvements": ["string"],
    "evidence": ["string"],
    "confidence": "number 0..1",
}
EXTRACTABLE = {"pdf", "docx", "pptx", "txt", "md", "html"}
TEXT_LIKE_EXT = {".txt", ".md", ".log", ".csv", ".json", ".py", ".js", ".ts", ".sql"}


async def call_contract(fn: Any, **available: Any) -> Any:
    """Call a contract function supplying arguments by parameter name (robust to signature details)."""
    sig = inspect.signature(fn)
    args: list[Any] = []
    kwargs: dict[str, Any] = {}
    for name, p in sig.parameters.items():
        if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        if name in available:
            if p.kind == p.POSITIONAL_ONLY:
                args.append(available[name])
            else:
                kwargs[name] = available[name]
        elif p.default is p.empty:
            raise TypeError(f"Cannot supply required parameter '{name}' to {fn.__qualname__}")
    result = fn(*args, **kwargs)
    if inspect.isawaitable(result):
        result = await result
    return result


# --------------------------------------------------------------------------- helpers


def _flatten(value: Any, limit: int = 20000) -> str:
    parts: list[str] = []

    def walk(v: Any, label: str | None = None) -> None:
        if isinstance(v, str):
            if v.strip():
                parts.append(f"{label}: {v}" if label else v)
        elif isinstance(v, dict):
            for k, val in v.items():
                walk(val, str(k))
        elif isinstance(v, list):
            for item in v:
                walk(item, label)
        elif v is not None and not isinstance(v, bool):
            parts.append(f"{label}: {v}" if label else str(v))

    walk(value)
    return "\n".join(parts)[:limit]


async def _file_texts(
    db: AsyncSession, organisation_id: uuid.UUID, file_ids: list[Any]
) -> tuple[str, list[str]]:
    from app.core.storage import get_storage

    ids = []
    for f in file_ids or []:
        try:
            ids.append(uuid.UUID(str(f.get("id") if isinstance(f, dict) else f)))
        except (ValueError, AttributeError):
            continue
    if not ids:
        return "", []
    files = (
        await db.scalars(
            select(StoredFile).where(StoredFile.id.in_(ids), StoredFile.organisation_id == organisation_id)
        )
    ).all()
    texts: list[str] = []
    names: list[str] = []
    budget = 20000
    for f in files:
        names.append(f.filename)
        kind = kind_from_name(f.filename, f.content_type)
        ext = "." + f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
        if kind not in EXTRACTABLE and ext not in TEXT_LIKE_EXT or f.scan_status == "infected" or budget <= 0:
            texts.append(f"[Attached file: {f.filename} ({f.content_type}) — not machine-readable]")
            continue
        try:
            data = await get_storage().get(f.storage_key)
            doc = extract_text(data, kind if kind in EXTRACTABLE else "txt")
            snippet = doc.text[: min(8000, budget)]
            budget -= len(snippet)
            texts.append(f"[Attached file: {f.filename}]\n{snippet}")
        except (ExtractionError, OSError) as exc:
            texts.append(f"[Attached file: {f.filename} — could not be read: {exc}]")
    return "\n\n".join(texts), names


def _quotes_in(evidence: list[Any], source: str) -> list[str]:
    """Keep only evidence quotes that actually occur in the submission (guards against invented quotes)."""
    src = normalise(source)
    out = []
    for q in evidence or []:
        q = str(q).strip().strip('"“”')
        if len(q) >= 4 and normalise(q) and normalise(q) in src:
            out.append(q[:300])
    return out[:3]


def _protected_sentences(text: str | None) -> list[str]:
    if not text:
        return []
    return [s for s in sentences(text) if len(s) > 25] or ([text] if len(text) > 12 else [])


def _redact(items: list[Any], protected: list[str]) -> list[str]:
    out = []
    for it in items or []:
        s = str(it)
        res = screen_output(s, protected)
        out.append(res.redacted if res.leaked else s)
    return out


def normalise_submission_grade(
    data: dict[str, Any], rubric_criteria: list[dict[str, Any]], submission_text: str, protected: list[str]
) -> dict[str, Any]:
    """Align AI output with the rubric: one row per criterion, clamped scores, verified quotes,
    weighted 0-100 score."""
    if not isinstance(data.get("criteria"), list):
        raise ValueError("criteria list missing")
    by_id = {
        str(c.get("criterion_id") or c.get("id") or "").lower(): c
        for c in data["criteria"]
        if isinstance(c, dict)
    }
    by_name = {str(c.get("name") or "").lower(): c for c in data["criteria"] if isinstance(c, dict)}
    rows: list[dict[str, Any]] = []
    total_w = 0.0
    acc = 0.0
    crits = rubric_criteria or [
        {
            "id": c.get("criterion_id") or c.get("name"),
            "name": c.get("name"),
            "weight": 1.0,
            "max": c.get("max"),
        }
        for c in data["criteria"]
        if isinstance(c, dict)
    ]
    if not crits:
        raise ValueError("no criteria")
    from praxis_ai.grading import _criterion_max

    for c in crits:
        cid = str(c.get("id") or c.get("name"))
        got = by_id.get(cid.lower()) or by_name.get(str(c.get("name") or "").lower()) or {}
        cmax = float(c.get("max") or 0) or _criterion_max(c)
        try:
            raw = float(got.get("score", 0) or 0)
        except (TypeError, ValueError):
            raw = 0.0
        model_max = float(got.get("max") or cmax) if isinstance(got.get("max"), int | float) else cmax
        score = raw if model_max == cmax or model_max <= 0 else raw / model_max * cmax
        score = round(min(max(score, 0.0), cmax), 2)
        weight = float(c.get("weight") or 1.0)
        evidence = got.get("evidence")
        evidence = evidence if isinstance(evidence, list) else ([evidence] if evidence else [])
        rows.append(
            {
                "criterion_id": cid,
                "name": str(c.get("name") or cid),
                "score": score,
                "max": cmax,
                "weight": weight,
                "evidence": _quotes_in(evidence, submission_text),
                "comment": _redact([got.get("comment") or ""], protected)[0],
            }
        )
        total_w += weight
        acc += weight * (score / cmax if cmax else 0)
    pct = round(100.0 * acc / total_w, 1) if total_w else 0.0
    try:
        confidence = float(data.get("confidence", 0.6))
    except (TypeError, ValueError):
        confidence = 0.6
    return {
        "criteria": rows,
        "score": pct,
        "strengths": _redact(data.get("strengths") or [], protected)[:8],
        "weaknesses": _redact(data.get("weaknesses") or [], protected)[:8],
        "missing_requirements": _redact(data.get("missing_requirements") or [], protected)[:8],
        "improvements": _redact(data.get("improvements") or [], protected)[:8],
        "summary": _redact([data.get("summary") or ""], protected)[0][:2000],
        "confidence": round(min(max(confidence, 0.0), 1.0), 2),
    }


# --------------------------------------------------------------------------- submissions


async def grade_submission(
    db: AsyncSession, submission_id: uuid.UUID, organisation_id: uuid.UUID
) -> Grade | None:
    sub = await db.get(Submission, submission_id)
    if sub is None or sub.organisation_id != organisation_id:
        log.warning("ai.grade_submission.not_found", submission_id=str(submission_id))
        return None
    assignment = await db.get(Assignment, sub.assignment_id)
    if assignment is None:
        return None
    version = await db.scalar(
        select(SubmissionVersion)
        .where(SubmissionVersion.submission_id == sub.id)
        .order_by(SubmissionVersion.is_final.desc(), SubmissionVersion.version_number.desc())
        .limit(1)
    )
    rubric = await db.get(Rubric, assignment.rubric_id) if assignment.rubric_id else None
    criteria = list(rubric.criteria or []) if rubric else []
    labels = {
        str(f.get("id")): f.get("label") or f.get("id")
        for f in assignment.structured_fields or []
        if isinstance(f, dict)
    }
    parts: list[str] = []
    if version is not None:
        if version.text_content:
            parts.append(version.text_content)
        if version.code_content:
            parts.append(f"Code:\n{version.code_content}")
        for k, v in (version.structured_answers or {}).items():
            parts.append(f"{labels.get(str(k), k)}: {_flatten(v, 4000)}")
    file_text, file_names = await _file_texts(db, organisation_id, version.file_ids if version else [])
    if file_text:
        parts.append(file_text)
    text = "\n\n".join(parts).strip()
    provided: list[str] = []
    for ev in assignment.required_evidence or []:
        if not isinstance(ev, dict):
            continue
        etype = ev.get("type") or "text"
        has = (
            bool(version and version.text_content)
            if etype == "text"
            else bool(version and version.code_content)
            if etype == "code"
            else bool(version and version.structured_answers)
            if etype == "structured"
            else bool(file_names)
        )
        if has:
            provided.append(str(ev.get("id")))
    prior = (
        await db.execute(
            select(func.count(), func.avg(Submission.final_score)).where(
                Submission.organisation_id == organisation_id,
                Submission.user_id == sub.user_id,
                Submission.final_score.is_not(None),
                Submission.id != sub.id,
            )
        )
    ).one()
    history = {
        "previous_graded_submissions": int(prior[0] or 0),
        "average_score": round(float(prior[1]), 1) if prior[1] is not None else None,
        "attempt_number": sub.submit_count or 1,
    }
    a_dict = {
        "title": assignment.title,
        "scenario": assignment.scenario,
        "objective": assignment.objective,
        "instructions": assignment.instructions,
        "evaluation_criteria": assignment.evaluation_criteria,
        "expected_output": assignment.expected_output or "",
        "passing_score": assignment.passing_score,
        "rubric": {"criteria": criteria},
        "required_evidence": assignment.required_evidence or [],
        "provided_evidence": provided,
    }
    protected = _protected_sentences(assignment.expected_output)
    injection = detect_injection(text)

    def fallback() -> dict[str, Any]:
        return heuristic_grade_submission(a_dict, text)

    def validator(d: dict[str, Any]) -> dict[str, Any]:
        return normalise_submission_grade(d, criteria, text, protected)

    if not text:
        data, result = fallback(), None
        data = validator(data)
    else:
        data, result = await gateway.generate_json_result(
            db,
            organisation_id=organisation_id,
            user_id=None,
            feature="grading",
            system=P.grading_system(),
            prompt=P.grading_prompt(a_dict, text, history),
            schema_hint=SUBMISSION_SCHEMA,
            fallback=fallback,
            course_id=assignment.course_id,
            validator=validator,
            max_tokens=2500,
        )
        if result is None:  # fallback output still needs normalising
            data = validator(data)
    missing = list(data["missing_requirements"])
    for ev in assignment.required_evidence or []:
        if isinstance(ev, dict) and ev.get("required") and str(ev.get("id")) not in provided:
            msg = f"Missing required evidence: {ev.get('label') or ev.get('id')}"
            if msg not in missing:
                missing.append(msg)
    summary = data["summary"]
    confidence = data["confidence"] if result is not None else min(data["confidence"], 0.5)
    if injection.flagged:
        confidence = min(confidence, 0.3)
        summary += (
            " Note: the submission contains text resembling instructions to the grader; it has been "
            "flagged for human review."
        )
    score = float(data["score"])
    grade = Grade(
        organisation_id=organisation_id,
        target_type="submission",
        target_id=sub.id,
        submission_version=version.version_number if version else None,
        source="ai",
        score=score,
        max_score=100.0,
        passed=score >= float(assignment.passing_score or 70),
        rubric_breakdown=data["criteria"],
        strengths=data["strengths"],
        weaknesses=data["weaknesses"],
        missing_requirements=missing,
        improvements=data["improvements"],
        summary=summary.strip(),
        ai_model=result.model if result else "heuristic-fallback",
        confidence=confidence,
        is_final=False,
    )
    db.add(grade)
    await db.flush()
    make_final = (
        assignment.grading_mode == "ai_assisted" and not assignment.high_stakes and not injection.flagged
    )
    try:
        from app.modules.assignments.service import apply_grade
    except ImportError:
        apply_grade = None
    if apply_grade is not None:
        await call_contract(
            apply_grade,
            db=db,
            session=db,
            submission=sub,
            submission_id=sub.id,
            grade=grade,
            grade_id=grade.id,
            make_final=make_final,
            final=make_final,
            is_final=make_final,
            organisation_id=organisation_id,
            org_id=organisation_id,
            actor_id=None,
            grader_id=None,
            source="ai",
        )
    else:  # pragma: no cover - assignments module absent
        log.warning("ai.apply_grade_missing")
        sub.ai_score = score
        sub.status = SubmissionStatus.AI_GRADED
    log.info(
        "ai.submission_graded", submission_id=str(sub.id), score=score, final=make_final, model=grade.ai_model
    )
    return grade


# --------------------------------------------------------------------------- assessment answers


def _q_get(q: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for k in keys:
        if q.get(k) is not None:
            return q[k]
    return default


def _answer_text(response: dict[str, Any] | None) -> str:
    if not response:
        return ""
    for key in ("text", "value", "answer", "code"):
        if isinstance(response.get(key), str):
            return response[key]
    return _flatten(response, 12000)


async def grade_attempt_answers(
    db: AsyncSession, attempt_id: uuid.UUID, organisation_id: uuid.UUID
) -> list[Grade]:
    attempt = await db.get(AssessmentAttempt, attempt_id)
    if attempt is None or attempt.organisation_id != organisation_id:
        return []
    assessment = await db.get(Assessment, attempt.assessment_id)
    if assessment is None:
        return []
    snapshot = {
        str(_q_get(q, "id", "question_id")): q
        for q in attempt.questions_snapshot or []
        if isinstance(q, dict)
    }
    answers = (await db.scalars(select(AttemptAnswer).where(AttemptAnswer.attempt_id == attempt.id))).all()
    auto_types = {str(t) for t in AUTO_GRADED_TYPES}
    grades: list[Grade] = []
    graded_any = False
    for ans in answers:
        q = snapshot.get(str(ans.question_id))
        if q is None:
            continue
        qtype = str(_q_get(q, "question_type", "type", default=""))
        if qtype in auto_types or ans.manual_score is not None or ans.ai_score is not None:
            continue
        points = float(_q_get(q, "points", default=1.0) or 1.0)
        key = q.get("answer_key") or {}
        criteria: list[dict[str, Any]] = []
        rubric_id = q.get("rubric_id")
        if rubric_id:
            try:
                rubric = await db.get(Rubric, uuid.UUID(str(rubric_id)))
            except ValueError:
                rubric = None
            criteria = list(rubric.criteria or []) if rubric else []
        qd = {
            "prompt": _q_get(q, "prompt", "text", default=""),
            "points": points,
            "reference": _flatten(
                {
                    k: v
                    for k, v in key.items()
                    if k in ("model_answer", "expected", "sample_answer", "guidance", "keywords", "value")
                },
                4000,
            )
            if isinstance(key, dict)
            else str(key),
            "accepted": key.get("accepted") if isinstance(key, dict) else None,
            "explanation": q.get("explanation") or "",
            "criteria": criteria,
        }
        text = _answer_text(ans.response)

        def fallback(qd: dict[str, Any] = qd, text: str = text) -> dict[str, Any]:
            return heuristic_grade_answer(qd, text)

        def validator(d: dict[str, Any]) -> dict[str, Any]:
            frac = float(d.get("score_fraction", d.get("score", 0)) or 0)
            if frac > 1.0:
                frac = frac / 100.0 if frac <= 100 else 1.0
            d["score_fraction"] = round(min(max(frac, 0.0), 1.0), 3)
            return d

        if not text.strip():
            data, result = fallback(), None
        else:
            data, result = await gateway.generate_json_result(
                db,
                organisation_id=organisation_id,
                user_id=None,
                feature="grading",
                system=P.answer_grading_system(),
                prompt=P.answer_grading_prompt(qd, text),
                schema_hint=ANSWER_SCHEMA,
                fallback=fallback,
                course_id=assessment.course_id,
                validator=validator,
                max_tokens=800,
            )
        data = validator(dict(data))
        protected = _protected_sentences(qd["reference"])
        feedback = _redact([data.get("feedback") or ""], protected)[0]
        injection = detect_injection(text)
        confidence = (
            float(data.get("confidence") or 0.5) if result else min(float(data.get("confidence") or 0.4), 0.5)
        )
        if injection.flagged:
            confidence = min(confidence, 0.3)
        ai_score = round(data["score_fraction"] * points, 2)
        ans.ai_score = ai_score
        ans.ai_feedback = {
            "score": ai_score,
            "max": points,
            "feedback": feedback,
            "strengths": _redact(data.get("strengths") or [], protected),
            "improvements": _redact(data.get("improvements") or [], protected),
            "evidence": _quotes_in(data.get("evidence") or [], text),
            "confidence": confidence,
            "model": result.model if result else "heuristic-fallback",
            "injection_flagged": injection.flagged,
        }
        g = Grade(
            organisation_id=organisation_id,
            target_type="attempt_answer",
            target_id=ans.id,
            source="ai",
            score=ai_score,
            max_score=points,
            passed=None,
            rubric_breakdown=[
                {
                    "criterion_id": "answer",
                    "name": "Answer quality",
                    "score": ai_score,
                    "max": points,
                    "evidence": ans.ai_feedback["evidence"],
                    "comment": feedback,
                }
            ],
            strengths=ans.ai_feedback["strengths"],
            improvements=ans.ai_feedback["improvements"],
            summary=feedback,
            ai_model=ans.ai_feedback["model"],
            confidence=confidence,
            is_final=False,
        )
        db.add(g)
        grades.append(g)
        graded_any = True
    await db.flush()
    human_final = bool(assessment.high_stakes) or assessment.grading_mode == "ai_recommend_human_final"
    if human_final:
        if attempt.status not in (AttemptStatus.GRADED,):
            attempt.status = AttemptStatus.NEEDS_REVIEW
        await db.flush()
        return grades
    if graded_any:
        for ans in answers:
            if ans.ai_score is not None and ans.manual_score is None and ans.final_score is None:
                q = snapshot.get(str(ans.question_id)) or {}
                pts = float(_q_get(q, "points", default=1.0) or 1.0)
                ans.final_score = ans.ai_score
                ans.is_correct = (ans.ai_score / pts) >= 0.5 if pts else None
        await db.flush()
    try:
        from app.modules.assessments.service import finalize_attempt
    except ImportError:
        finalize_attempt = None
    if finalize_attempt is not None:
        await call_contract(
            finalize_attempt,
            db=db,
            session=db,
            attempt=attempt,
            attempt_id=attempt.id,
            organisation_id=organisation_id,
            org_id=organisation_id,
            assessment=assessment,
            actor_id=None,
            graded_by=None,
        )
    else:  # pragma: no cover
        log.warning("ai.finalize_attempt_missing")
    return grades


