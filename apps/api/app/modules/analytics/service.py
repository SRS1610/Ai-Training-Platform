"""Analytics read models. Every metric is a set-based SQL aggregate (no per-row queries) scoped explicitly by
``organisation_id`` (RLS is the second barrier). Date ranges are inclusive ``[start, end]`` calendar days (UTC).

Range semantics: enrolment metrics use the enrolment date (``enrolments.created_at``); attempts use
``submitted_at``; submissions ``graded_at``/``submitted_at``; simulations ``completed_at``; activity uses ``day``.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.metrics import metrics
from app.modules.billing.plans import get_plan

# Normalises a simulation dimension score (number | {"pct"} | {"percentage"} | {"score","max"} | {"score"}) to 0-100.
DIM_VALUE_SQL = """
CASE jsonb_typeof(d.value)
  WHEN 'number' THEN (d.value #>> '{}')::float
  WHEN 'object' THEN COALESCE(
    (d.value->>'pct')::float, (d.value->>'percentage')::float,
    CASE WHEN (d.value->>'max')::float > 0 THEN 100.0 * (d.value->>'score')::float / (d.value->>'max')::float END,
    (d.value->>'score')::float)
END"""

OPEN_STATUSES = "('not_started','in_progress')"


@dataclass
class DateRange:
    start: date | None = None
    end: date | None = None

    @property
    def start_dt(self) -> datetime | None:
        return datetime.combine(self.start, time.min, tzinfo=UTC) if self.start else None

    @property
    def end_dt(self) -> datetime | None:
        """Exclusive upper bound (start of the day after ``end``)."""
        return datetime.combine(self.end + timedelta(days=1), time.min, tzinfo=UTC) if self.end else None

    def sql(self, column: str, prefix: str = "r") -> tuple[str, dict[str, Any]]:
        """SQL fragment ``AND col >= :r_start AND col < :r_end`` (only for bounds that are set)."""
        parts, params = [], {}
        if self.start_dt:
            parts.append(f" AND {column} >= :{prefix}_start")
            params[f"{prefix}_start"] = self.start_dt
        if self.end_dt:
            parts.append(f" AND {column} < :{prefix}_end")
            params[f"{prefix}_end"] = self.end_dt
        return "".join(parts), params

    def as_dict(self) -> dict[str, Any]:
        return {"start": self.start, "end": self.end}


def _today() -> date:
    return datetime.now(UTC).date()


def _plain(value: Any) -> Any:
    """Decimal → int (integral) / float so JSON responses carry numbers, not strings."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


async def _rows(db: AsyncSession, sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    result = await db.execute(text(sql), params)
    return [{k: _plain(v) for k, v in r.items()} for r in result.mappings().all()]


async def _row(db: AsyncSession, sql: str, params: dict[str, Any]) -> dict[str, Any]:
    rows = await _rows(db, sql, params)
    return rows[0] if rows else {}


def _f(value: Any, digits: int = 1) -> float | None:
    return round(float(value), digits) if value is not None else None


def _rate(num: Any, den: Any) -> float | None:
    return round(100.0 * float(num or 0) / float(den), 1) if den else None


# ============================================================================= learner


async def learner_analytics(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, rng: DateRange
                            ) -> dict[str, Any]:
    p: dict[str, Any] = {"org": org_id, "uid": user_id, "today": _today()}
    e_rng, e_p = rng.sql("e.created_at", "e")
    a_rng, a_p = rng.sql("at.submitted_at", "a")
    s_rng, s_p = rng.sql("COALESCE(s.graded_at, s.submitted_at)", "s")
    ss_rng, ss_p = rng.sql("ss.completed_at", "ss")
    p.update(e_p | a_p | s_p | ss_p)

    summary = await _row(db, f"""
    SELECT
      (SELECT count(*) FROM enrolments e WHERE e.organisation_id=:org AND e.user_id=:uid {e_rng}) AS enrolments,
      (SELECT count(*) FROM enrolments e WHERE e.organisation_id=:org AND e.user_id=:uid AND e.status='completed'
         {e_rng}) AS completed,
      (SELECT count(*) FROM enrolments e WHERE e.organisation_id=:org AND e.user_id=:uid AND e.status='in_progress'
         {e_rng}) AS in_progress,
      (SELECT count(*) FROM enrolments e WHERE e.organisation_id=:org AND e.user_id=:uid
         AND e.status IN {OPEN_STATUSES} AND e.due_date < :today {e_rng}) AS overdue,
      (SELECT avg(e.final_score) FROM enrolments e WHERE e.organisation_id=:org AND e.user_id=:uid
         AND e.status='completed' {e_rng}) AS avg_final_score,
      (SELECT avg(e.progress_pct) FROM enrolments e WHERE e.organisation_id=:org AND e.user_id=:uid
         AND e.status <> 'withdrawn' {e_rng}) AS avg_progress,
      (SELECT COALESCE(sum(e.time_spent_seconds),0) FROM enrolments e WHERE e.organisation_id=:org
         AND e.user_id=:uid {e_rng}) AS time_spent_seconds,
      (SELECT count(*) FROM certificates c WHERE c.organisation_id=:org AND c.user_id=:uid
         AND c.revoked_at IS NULL) AS certificates,
      (SELECT count(*) FROM assessment_attempts at WHERE at.organisation_id=:org AND at.user_id=:uid
         AND at.status='graded' {a_rng}) AS attempts,
      (SELECT avg(at.percentage) FROM assessment_attempts at WHERE at.organisation_id=:org AND at.user_id=:uid
         AND at.status='graded' {a_rng}) AS avg_attempt_pct,
      (SELECT avg(CASE WHEN at.passed THEN 100.0 ELSE 0.0 END) FROM assessment_attempts at
         WHERE at.organisation_id=:org AND at.user_id=:uid AND at.status='graded' {a_rng}) AS attempt_pass_rate,
      (SELECT count(*) FROM submissions s WHERE s.organisation_id=:org AND s.user_id=:uid
         AND s.submitted_at IS NOT NULL {s_rng}) AS assignments_submitted,
      (SELECT avg(s.final_score) FROM submissions s WHERE s.organisation_id=:org AND s.user_id=:uid
         AND s.final_score IS NOT NULL {s_rng}) AS avg_assignment_score,
      (SELECT count(*) FROM simulation_sessions ss WHERE ss.organisation_id=:org AND ss.user_id=:uid
         AND ss.status='completed' {ss_rng}) AS simulations_completed,
      (SELECT avg(ss.total_score) FROM simulation_sessions ss WHERE ss.organisation_id=:org AND ss.user_id=:uid
         AND ss.status='completed' {ss_rng}) AS avg_simulation_score,
      (SELECT count(*) FROM activity_days ad WHERE ad.organisation_id=:org AND ad.user_id=:uid
         AND ad.day > CAST(:today AS date) - 30) AS active_days_30d
    """, p)
    summary = {k: v if v is None or isinstance(v, int) else _f(v) for k, v in summary.items()}
    summary["completion_rate"] = _rate(summary["completed"], summary["enrolments"])

    courses = await _rows(db, f"""
    SELECT e.course_id, c.title, e.status, e.progress_pct, e.final_score, e.due_date, e.completed_at,
           e.time_spent_seconds, e.created_at AS enrolled_at,
           (e.status IN {OPEN_STATUSES} AND e.due_date < :today) AS overdue
    FROM enrolments e JOIN courses c ON c.id = e.course_id
    WHERE e.organisation_id=:org AND e.user_id=:uid {e_rng}
    ORDER BY e.created_at DESC""", p)

    scores = await _rows(db, f"""
    SELECT * FROM (
      SELECT at.submitted_at AS at, 'assessment' AS kind, at.assessment_id AS ref_id, a.title, at.percentage AS score,
             at.passed
      FROM assessment_attempts at JOIN assessments a ON a.id = at.assessment_id
      WHERE at.organisation_id=:org AND at.user_id=:uid AND at.status='graded' AND at.percentage IS NOT NULL {a_rng}
      UNION ALL
      SELECT COALESCE(s.graded_at, s.submitted_at), 'assignment', s.assignment_id, asg.title, s.final_score, s.passed
      FROM submissions s JOIN assignments asg ON asg.id = s.assignment_id
      WHERE s.organisation_id=:org AND s.user_id=:uid AND s.final_score IS NOT NULL {s_rng}
      UNION ALL
      SELECT ss.completed_at, 'simulation', ss.simulation_id, sim.title, ss.total_score, ss.passed
      FROM simulation_sessions ss JOIN simulations sim ON sim.id = ss.simulation_id
      WHERE ss.organisation_id=:org AND ss.user_id=:uid AND ss.status='completed' AND ss.total_score IS NOT NULL
        {ss_rng}
    ) x WHERE x.at IS NOT NULL ORDER BY x.at""", p)
    for s in scores:
        s["score"] = _f(s["score"])

    skills = await _rows(db, """
    SELECT ls.skill_id, sk.name, sk.category, ls.proficiency, ls.evidence_count, ls.last_assessed_at
    FROM learner_skills ls JOIN skills sk ON sk.id = ls.skill_id
    WHERE ls.organisation_id=:org AND ls.user_id=:uid ORDER BY ls.proficiency DESC""", p)
    for s in skills:
        s["proficiency"] = _f(s["proficiency"])

    answers_cte = f"""
    WITH ans AS (
      SELECT aa.question_id, aa.is_correct FROM attempt_answers aa
      JOIN assessment_attempts at ON at.id = aa.attempt_id
      WHERE at.organisation_id=:org AND at.user_id=:uid AND aa.is_correct IS NOT NULL {a_rng}
    )"""
    weak_tags = await _rows(db, answers_cte + """
    SELECT t.tag AS tag, count(*) AS answered, sum(CASE WHEN ans.is_correct THEN 0 ELSE 1 END) AS incorrect
    FROM ans JOIN questions q ON q.id = ans.question_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(q.tags) = 'array' THEN q.tags ELSE '[]'::jsonb END) AS t(tag)
    GROUP BY t.tag HAVING sum(CASE WHEN ans.is_correct THEN 0 ELSE 1 END) > 0
    ORDER BY sum(CASE WHEN ans.is_correct THEN 0 ELSE 1 END)::float / count(*) DESC, 3 DESC LIMIT 10""", p)
    weak_skills = await _rows(db, answers_cte + """
    SELECT sk.id AS skill_id, sk.name AS skill, count(*) AS answered,
           sum(CASE WHEN ans.is_correct THEN 0 ELSE 1 END) AS incorrect
    FROM ans JOIN questions q ON q.id = ans.question_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(q.skill_ids) = 'array' THEN q.skill_ids ELSE '[]'::jsonb END) AS sid(v)
    JOIN skills sk ON sk.id::text = sid.v AND sk.organisation_id = :org
    GROUP BY sk.id, sk.name HAVING sum(CASE WHEN ans.is_correct THEN 0 ELSE 1 END) > 0
    ORDER BY sum(CASE WHEN ans.is_correct THEN 0 ELSE 1 END)::float / count(*) DESC, 4 DESC LIMIT 10""", p)
    missed = await _rows(db, answers_cte + """
    SELECT ans.question_id, left(q.prompt, 240) AS prompt, count(*) AS answered,
           sum(CASE WHEN ans.is_correct THEN 0 ELSE 1 END) AS incorrect
    FROM ans LEFT JOIN questions q ON q.id = ans.question_id
    GROUP BY ans.question_id, q.prompt HAVING sum(CASE WHEN ans.is_correct THEN 0 ELSE 1 END) > 0
    ORDER BY 4 DESC, 3 DESC LIMIT 10""", p)
    for group in (weak_tags, weak_skills, missed):
        for w in group:
            w["error_rate"] = _rate(w["incorrect"], w["answered"])

    by_course_time = await _rows(db, f"""
    SELECT e.course_id, c.title, e.time_spent_seconds AS seconds FROM enrolments e JOIN courses c ON c.id=e.course_id
    WHERE e.organisation_id=:org AND e.user_id=:uid AND e.time_spent_seconds > 0 {e_rng}
    ORDER BY e.time_spent_seconds DESC""", p)
    daily = await _rows(db, """
    SELECT g.day::date AS date, COALESCE(ad.seconds, 0) AS seconds, COALESCE(ad.events, 0) AS events
    FROM generate_series(CAST(:today AS date) - 29, CAST(:today AS date), interval '1 day') AS g(day)
    LEFT JOIN activity_days ad ON ad.day = g.day::date AND ad.organisation_id=:org AND ad.user_id=:uid
    ORDER BY 1""", p)

    attempts = await _rows(db, f"""
    SELECT at.id AS attempt_id, at.assessment_id, a.title AS assessment_title, at.attempt_number, at.percentage,
           at.passed, at.status, at.submitted_at
    FROM assessment_attempts at JOIN assessments a ON a.id = at.assessment_id
    WHERE at.organisation_id=:org AND at.user_id=:uid AND at.status <> 'in_progress' {a_rng}
    ORDER BY at.submitted_at DESC NULLS LAST LIMIT 25""", p)

    dims = await _rows(db, f"""
    SELECT d.key AS dimension, avg({DIM_VALUE_SQL}) AS avg_score, count(*) AS sessions
    FROM simulation_sessions ss CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(ss.dimension_scores) = 'object' THEN ss.dimension_scores ELSE '{{}}'::jsonb END) d
    WHERE ss.organisation_id=:org AND ss.user_id=:uid AND ss.status='completed' {ss_rng}
    GROUP BY d.key ORDER BY 2 ASC NULLS LAST""", p)
    for d in dims:
        d["avg_score"] = _f(d["avg_score"])
    by_sim = await _rows(db, f"""
    SELECT ss.simulation_id, sim.title, count(*) AS sessions, max(ss.total_score) AS best_score,
           avg(ss.total_score) AS avg_score,
           (array_agg(ss.band ORDER BY ss.completed_at DESC))[1] AS last_band,
           bool_or(COALESCE(ss.passed, false)) AS ever_passed
    FROM simulation_sessions ss JOIN simulations sim ON sim.id = ss.simulation_id
    WHERE ss.organisation_id=:org AND ss.user_id=:uid AND ss.status='completed' {ss_rng}
    GROUP BY ss.simulation_id, sim.title ORDER BY sim.title""", p)
    for s in by_sim:
        s["best_score"], s["avg_score"] = _f(s["best_score"]), _f(s["avg_score"])

    return {
        "user_id": user_id, "range": rng.as_dict(), "summary": summary, "courses": courses,
        "scores_over_time": scores, "skills": skills,
        "weak_areas": {"by_tag": weak_tags, "by_skill": weak_skills, "most_missed_questions": missed},
        "time_spent": {"total_seconds": summary["time_spent_seconds"], "by_course": by_course_time,
                       "daily_30d": daily},
        "attempts": attempts,
        "simulations": {"by_dimension": dims, "by_simulation": by_sim},
    }


# ============================================================================= course


def _difficulty_label(p: float | None) -> str | None:
    if p is None:
        return None
    return "easy" if p >= 0.8 else ("moderate" if p >= 0.5 else "hard")


async def course_analytics(db: AsyncSession, org_id: uuid.UUID, course_id: uuid.UUID, rng: DateRange
                           ) -> dict[str, Any]:
    p: dict[str, Any] = {"org": org_id, "cid": course_id, "today": _today()}
    e_rng, e_p = rng.sql("e.created_at", "e")
    a_rng, a_p = rng.sql("at.submitted_at", "a")
    s_rng, s_p = rng.sql("COALESCE(s.graded_at, s.submitted_at)", "s")
    ss_rng, ss_p = rng.sql("ss.completed_at", "ss")
    p.update(e_p | a_p | s_p | ss_p)

    enrol = await _row(db, f"""
    SELECT count(*) AS total,
      count(*) FILTER (WHERE e.status='not_started') AS not_started,
      count(*) FILTER (WHERE e.status='in_progress') AS in_progress,
      count(*) FILTER (WHERE e.status='completed') AS completed,
      count(*) FILTER (WHERE e.status='withdrawn') AS withdrawn,
      count(*) FILTER (WHERE e.status IN {OPEN_STATUSES} AND e.due_date < :today) AS overdue,
      avg(e.progress_pct) FILTER (WHERE e.status <> 'withdrawn') AS avg_progress,
      avg(e.final_score) FILTER (WHERE e.status='completed') AS avg_final_score,
      avg(e.time_spent_seconds) AS avg_time_spent_seconds,
      avg(EXTRACT(EPOCH FROM (e.completed_at - COALESCE(e.started_at, e.created_at))) / 86400.0)
        FILTER (WHERE e.status='completed') AS avg_days_to_complete
    FROM enrolments e WHERE e.organisation_id=:org AND e.course_id=:cid {e_rng}""", p)
    for k in ("avg_progress", "avg_final_score", "avg_time_spent_seconds", "avg_days_to_complete"):
        enrol[k] = _f(enrol.get(k))
    enrol["completion_rate"] = _rate(enrol["completed"], enrol["total"] - enrol["withdrawn"])

    structure = await _rows(db, """
    SELECT m.id AS module_id, m.title AS module_title, m.position AS module_position,
           l.id AS lesson_id, l.title AS lesson_title, l.position AS lesson_position, l.lesson_type
    FROM course_modules m LEFT JOIN lessons l ON l.module_id = m.id AND l.deleted_at IS NULL
    WHERE m.organisation_id=:org AND m.course_id=:cid AND m.deleted_at IS NULL
    ORDER BY m.position, l.position""", p)
    lesson_stats = {r["lesson_id"]: r for r in await _rows(db, f"""
    SELECT lp.lesson_id, count(*) AS started, count(*) FILTER (WHERE lp.status='completed') AS completed,
           avg(lp.time_spent_seconds) AS avg_time_seconds
    FROM lesson_progress lp JOIN enrolments e ON e.id = lp.enrolment_id
    WHERE e.organisation_id=:org AND e.course_id=:cid {e_rng} GROUP BY lp.lesson_id""", p)}
    module_done = {r["module_id"]: r["learners"] for r in await _rows(db, f"""
    WITH ml AS (SELECT id AS lesson_id, module_id FROM lessons WHERE organisation_id=:org AND course_id=:cid
                AND deleted_at IS NULL),
         mc AS (SELECT module_id, count(*) AS n FROM ml GROUP BY module_id),
         done AS (SELECT lp.enrolment_id, ml.module_id, count(DISTINCT lp.lesson_id) AS n
                  FROM lesson_progress lp JOIN ml ON ml.lesson_id = lp.lesson_id
                  JOIN enrolments e ON e.id = lp.enrolment_id
                  WHERE e.organisation_id=:org AND e.course_id=:cid AND lp.status='completed' {e_rng}
                  GROUP BY lp.enrolment_id, ml.module_id)
    SELECT done.module_id, count(*) AS learners FROM done JOIN mc ON mc.module_id = done.module_id
    WHERE done.n >= mc.n GROUP BY done.module_id""", p)}
    base = (enrol["total"] or 0) - (enrol["withdrawn"] or 0)
    modules: dict[Any, dict[str, Any]] = {}
    for r in structure:
        mod = modules.setdefault(r["module_id"], {
            "module_id": r["module_id"], "title": r["module_title"], "position": r["module_position"],
            "learners_completed": module_done.get(r["module_id"], 0),
            "completion_rate": _rate(module_done.get(r["module_id"], 0), base), "lessons": []})
        if r["lesson_id"] is None:
            continue
        st = lesson_stats.get(r["lesson_id"], {})
        mod["lessons"].append({
            "lesson_id": r["lesson_id"], "title": r["lesson_title"], "position": r["lesson_position"],
            "lesson_type": r["lesson_type"], "started": st.get("started", 0), "completed": st.get("completed", 0),
            "completion_rate": _rate(st.get("completed", 0), base),
            "avg_time_seconds": _f(st.get("avg_time_seconds"))})
    for mod in modules.values():
        mod["lessons_count"] = len(mod["lessons"])

    assessments = await _rows(db, f"""
    SELECT a.id AS assessment_id, a.title, a.kind, count(at.id) AS attempts,
           count(DISTINCT at.user_id) AS learners, avg(at.percentage) AS avg_percentage,
           avg(CASE WHEN at.passed THEN 100.0 WHEN at.passed IS NOT NULL THEN 0.0 END) AS pass_rate
    FROM assessments a LEFT JOIN assessment_attempts at ON at.assessment_id = a.id AND at.status='graded' {a_rng}
    WHERE a.organisation_id=:org AND a.course_id=:cid AND a.deleted_at IS NULL
    GROUP BY a.id, a.title, a.kind ORDER BY a.title""", p)
    for a in assessments:
        a["avg_percentage"], a["pass_rate"] = _f(a["avg_percentage"]), _f(a["pass_rate"])

    questions = await _rows(db, f"""
    SELECT aa.question_id, left(q.prompt, 240) AS prompt, q.question_type, q.tags, count(*) AS responses,
           avg(CASE WHEN aa.is_correct THEN 1.0 ELSE 0.0 END) AS p_value,
           corr(CASE WHEN aa.is_correct THEN 1.0 ELSE 0.0 END, at.percentage) AS discrimination,
           sum(CASE WHEN aa.is_correct THEN 0 ELSE 1 END) AS incorrect
    FROM attempt_answers aa
    JOIN assessment_attempts at ON at.id = aa.attempt_id
    JOIN assessments a ON a.id = at.assessment_id
    LEFT JOIN questions q ON q.id = aa.question_id
    WHERE at.organisation_id=:org AND a.course_id=:cid AND at.status='graded' AND aa.is_correct IS NOT NULL {a_rng}
    GROUP BY aa.question_id, q.prompt, q.question_type, q.tags
    ORDER BY 6 ASC, 5 DESC""", p)
    for q in questions:
        q["p_value"] = _f(q["p_value"], 3)
        q["discrimination"] = _f(q["discrimination"], 3)
        q["difficulty"] = _difficulty_label(q["p_value"])
        q["needs_review"] = (q["discrimination"] is not None and q["discrimination"] < 0.2) or (
            q["p_value"] is not None and q["p_value"] < 0.3)
    most_failed = sorted([q for q in questions if q["incorrect"]], key=lambda q: (-q["incorrect"], q["p_value"]))[:10]

    assignments = await _rows(db, f"""
    SELECT asg.id AS assignment_id, asg.title, count(s.id) AS submissions,
           count(s.id) FILTER (WHERE s.final_score IS NOT NULL) AS graded,
           avg(s.final_score) AS avg_score,
           avg(CASE WHEN s.passed THEN 100.0 WHEN s.passed IS NOT NULL THEN 0.0 END) AS pass_rate,
           count(s.id) FILTER (WHERE s.final_score < 50) AS b0,
           count(s.id) FILTER (WHERE s.final_score >= 50 AND s.final_score < 60) AS b50,
           count(s.id) FILTER (WHERE s.final_score >= 60 AND s.final_score < 70) AS b60,
           count(s.id) FILTER (WHERE s.final_score >= 70 AND s.final_score < 80) AS b70,
           count(s.id) FILTER (WHERE s.final_score >= 80 AND s.final_score < 90) AS b80,
           count(s.id) FILTER (WHERE s.final_score >= 90) AS b90
    FROM assignments asg LEFT JOIN submissions s ON s.assignment_id = asg.id AND s.status <> 'draft' {s_rng}
    WHERE asg.organisation_id=:org AND asg.course_id=:cid AND asg.deleted_at IS NULL
    GROUP BY asg.id, asg.title ORDER BY asg.title""", p)
    buckets = [("0-49", "b0"), ("50-59", "b50"), ("60-69", "b60"), ("70-79", "b70"), ("80-89", "b80"),
               ("90-100", "b90")]
    for a in assignments:
        a["avg_score"], a["pass_rate"] = _f(a["avg_score"]), _f(a["pass_rate"])
        a["distribution"] = [{"bucket": label, "count": a.pop(key)} for label, key in buckets]

    simulations = await simulation_results(db, org_id, rng, course_id=course_id)
    course = await _row(db, "SELECT id, title, status FROM courses WHERE id=:cid AND organisation_id=:org", p)
    return {
        "course": course, "range": rng.as_dict(), "enrolments": enrol,
        "funnel": sorted(modules.values(), key=lambda m: m["position"]),
        "assessments": assessments, "questions": questions, "most_failed_questions": most_failed,
        "assignments": assignments, "simulations": simulations,
    }


async def simulation_results(db: AsyncSession, org_id: uuid.UUID, rng: DateRange, *,
                             course_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
    ss_rng, p = rng.sql("ss.completed_at", "ss")
    p.update({"org": org_id, "cid": course_id})
    course_filter = "AND sim.course_id = :cid" if course_id else ""
    sims = await _rows(db, f"""
    SELECT sim.id AS simulation_id, sim.title, count(ss.id) AS sessions,
           count(ss.id) FILTER (WHERE ss.status='completed') AS completed,
           count(DISTINCT ss.user_id) AS learners,
           avg(ss.total_score) FILTER (WHERE ss.status='completed') AS avg_score,
           avg(CASE WHEN ss.passed THEN 100.0 WHEN ss.passed IS NOT NULL THEN 0.0 END) AS pass_rate
    FROM simulations sim LEFT JOIN simulation_sessions ss ON ss.simulation_id = sim.id {ss_rng}
    WHERE sim.organisation_id=:org AND sim.deleted_at IS NULL {course_filter}
    GROUP BY sim.id, sim.title ORDER BY sim.title""", p)
    bands = await _rows(db, f"""
    SELECT ss.simulation_id, lower(ss.band) AS band, count(*) AS n
    FROM simulation_sessions ss JOIN simulations sim ON sim.id = ss.simulation_id
    WHERE ss.organisation_id=:org AND ss.status='completed' AND ss.band IS NOT NULL {course_filter} {ss_rng}
    GROUP BY 1, 2""", p)
    dims = await _rows(db, f"""
    SELECT ss.simulation_id, d.key AS dimension, avg({DIM_VALUE_SQL}) AS avg_score
    FROM simulation_sessions ss JOIN simulations sim ON sim.id = ss.simulation_id
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(ss.dimension_scores) = 'object' THEN ss.dimension_scores ELSE '{{}}'::jsonb END) d
    WHERE ss.organisation_id=:org AND ss.status='completed' {course_filter} {ss_rng}
    GROUP BY 1, 2 ORDER BY 3""", p)
    for s in sims:
        s["avg_score"], s["pass_rate"] = _f(s["avg_score"]), _f(s["pass_rate"])
        s["bands"] = {b["band"]: b["n"] for b in bands if b["simulation_id"] == s["simulation_id"]}
        s["dimensions"] = [{"dimension": d["dimension"], "avg_score": _f(d["avg_score"])}
                           for d in dims if d["simulation_id"] == s["simulation_id"]]
    return sims


async def courses_overview(db: AsyncSession, org_id: uuid.UUID, rng: DateRange) -> list[dict[str, Any]]:
    e_rng, p = rng.sql("e.created_at", "e")
    p.update({"org": org_id, "today": _today()})
    rows = await _rows(db, f"""
    SELECT c.id AS course_id, c.title, c.status, count(e.id) AS enrolments,
           count(e.id) FILTER (WHERE e.status='completed') AS completed,
           count(e.id) FILTER (WHERE e.status IN {OPEN_STATUSES} AND e.due_date < :today) AS overdue,
           avg(e.final_score) FILTER (WHERE e.status='completed') AS avg_final_score,
           avg(e.progress_pct) AS avg_progress
    FROM courses c LEFT JOIN enrolments e ON e.course_id = c.id AND e.status <> 'withdrawn' {e_rng}
    WHERE c.organisation_id=:org AND c.deleted_at IS NULL
    GROUP BY c.id, c.title, c.status ORDER BY count(e.id) DESC, c.title""", p)
    for r in rows:
        r["completion_rate"] = _rate(r["completed"], r["enrolments"])
        r["avg_final_score"], r["avg_progress"] = _f(r["avg_final_score"]), _f(r["avg_progress"])
    return rows


# ============================================================================= organisation


def _member_filter(department_id: uuid.UUID | None) -> str:
    return " AND ou.department_id = :dept" if department_id else ""


async def compliance(db: AsyncSession, org_id: uuid.UUID, rng: DateRange, *, department_id: uuid.UUID | None = None,
                     course_id: uuid.UUID | None = None) -> dict[str, Any]:
    e_rng, p = rng.sql("e.created_at", "e")
    p.update({"org": org_id, "today": _today(), "dept": department_id, "cid": course_id})
    where = f"""
    FROM enrolments e
    JOIN organisation_users ou ON ou.organisation_id = e.organisation_id AND ou.user_id = e.user_id
    JOIN courses c ON c.id = e.course_id
    WHERE e.organisation_id=:org AND e.due_date IS NOT NULL AND e.status <> 'withdrawn'
      AND (e.assigned_by IS NOT NULL OR e.source IN ('assigned', 'learning_path'))
      {_member_filter(department_id)} {"AND e.course_id = :cid" if course_id else ""} {e_rng}"""
    agg = """
      count(*) AS assigned,
      count(*) FILTER (WHERE e.status='completed' AND e.completed_at::date <= e.due_date) AS completed_on_time,
      count(*) FILTER (WHERE e.status='completed' AND e.completed_at::date > e.due_date) AS completed_late,
      count(*) FILTER (WHERE e.status IN ('not_started','in_progress') AND e.due_date < :today) AS overdue,
      count(*) FILTER (WHERE e.status IN ('not_started','in_progress') AND e.due_date >= :today) AS pending"""
    totals = await _row(db, f"SELECT {agg} {where}", p)
    by_course = await _rows(db, f"SELECT e.course_id, c.title, {agg} {where} GROUP BY e.course_id, c.title "
                                "ORDER BY 6 DESC, 3 DESC LIMIT 20", p)

    def finish(d: dict[str, Any]) -> dict[str, Any]:
        due_or_done = (d["completed_on_time"] or 0) + (d["completed_late"] or 0) + (d["overdue"] or 0)
        d["compliance_rate"] = _rate(d["completed_on_time"], due_or_done)
        return d

    return {**finish(totals), "by_course": [finish(r) for r in by_course]}


async def employee_performance(db: AsyncSession, org_id: uuid.UUID, rng: DateRange, *,
                               department_id: uuid.UUID | None = None, course_id: uuid.UUID | None = None,
                               user_id: uuid.UUID | None = None, limit: int = 200) -> list[dict[str, Any]]:
    e_rng, e_p = rng.sql("e.created_at", "e")
    a_rng, a_p = rng.sql("at.submitted_at", "a")
    ss_rng, ss_p = rng.sql("ss.completed_at", "ss")
    p = {"org": org_id, "today": _today(), "dept": department_id, "cid": course_id, "uid": user_id,
         "limit": limit} | e_p | a_p | ss_p
    course_e = "AND e.course_id = :cid" if course_id else ""
    rows = await _rows(db, f"""
    WITH members AS (
      SELECT ou.user_id, ou.department_id, ou.job_title FROM organisation_users ou
      WHERE ou.organisation_id=:org AND ou.status='active' {_member_filter(department_id)}
        {"AND ou.user_id = :uid" if user_id else ""}
    ), en AS (
      SELECT e.user_id, count(*) AS enrolments,
             count(*) FILTER (WHERE e.status='completed') AS completed,
             count(*) FILTER (WHERE e.status IN {OPEN_STATUSES} AND e.due_date < :today) AS overdue,
             avg(e.final_score) FILTER (WHERE e.status='completed') AS avg_final_score,
             sum(e.time_spent_seconds) AS time_spent_seconds
      FROM enrolments e WHERE e.organisation_id=:org AND e.status <> 'withdrawn' {course_e} {e_rng}
      GROUP BY e.user_id
    ), att AS (
      SELECT at.user_id, avg(at.percentage) AS avg_assessment_pct, count(*) AS attempts
      FROM assessment_attempts at JOIN assessments a ON a.id = at.assessment_id
      WHERE at.organisation_id=:org AND at.status='graded' {"AND a.course_id = :cid" if course_id else ""} {a_rng}
      GROUP BY at.user_id
    ), sims AS (
      SELECT ss.user_id, avg(ss.total_score) AS avg_simulation_score, count(*) AS simulations
      FROM simulation_sessions ss JOIN simulations sim ON sim.id = ss.simulation_id
      WHERE ss.organisation_id=:org AND ss.status='completed' {"AND sim.course_id = :cid" if course_id else ""}
        {ss_rng}
      GROUP BY ss.user_id
    )
    SELECT m.user_id, u.full_name, u.email, m.job_title, m.department_id, d.name AS department,
           COALESCE(en.enrolments, 0) AS enrolments, COALESCE(en.completed, 0) AS completed,
           COALESCE(en.overdue, 0) AS overdue, en.avg_final_score, COALESCE(en.time_spent_seconds, 0)
             AS time_spent_seconds, att.avg_assessment_pct, COALESCE(att.attempts, 0) AS attempts,
           sims.avg_simulation_score, COALESCE(sims.simulations, 0) AS simulations
    FROM members m JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
    LEFT JOIN departments d ON d.id = m.department_id
    LEFT JOIN en ON en.user_id = m.user_id LEFT JOIN att ON att.user_id = m.user_id
    LEFT JOIN sims ON sims.user_id = m.user_id
    ORDER BY COALESCE(en.completed, 0) DESC, en.avg_final_score DESC NULLS LAST, u.full_name
    LIMIT :limit""", p)
    for r in rows:
        r["completion_rate"] = _rate(r["completed"], r["enrolments"])
        for k in ("avg_final_score", "avg_assessment_pct", "avg_simulation_score"):
            r[k] = _f(r[k])
    return rows


async def skill_gaps(db: AsyncSession, org_id: uuid.UUID, *, department_id: uuid.UUID | None = None,
                     user_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
    p = {"org": org_id, "dept": department_id, "uid": user_id}
    rows = await _rows(db, f"""
    WITH req AS (
      SELECT c.id AS competency_id, c.name AS competency, (r->>'skill_id')::uuid AS skill_id,
             COALESCE((r->>'min_level')::float, 70.0) AS min_level
      FROM competencies c CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.requirements) = 'array' THEN c.requirements ELSE '[]'::jsonb END) r
      WHERE c.organisation_id=:org
        AND (r->>'skill_id') ~* '^[0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}$'
    ), members AS (
      SELECT ou.user_id FROM organisation_users ou WHERE ou.organisation_id=:org AND ou.status='active'
        {_member_filter(department_id)} {"AND ou.user_id = :uid" if user_id else ""}
    ), ls AS (
      SELECT ls.user_id, ls.skill_id, ls.proficiency FROM learner_skills ls
      JOIN members m ON m.user_id = ls.user_id WHERE ls.organisation_id=:org
    )
    SELECT req.competency_id, req.competency, req.skill_id, sk.name AS skill, req.min_level,
           (SELECT count(*) FROM members) AS learners,
           count(ls.user_id) AS assessed,
           COALESCE(avg(ls.proficiency), 0) AS avg_proficiency,
           count(ls.user_id) FILTER (WHERE ls.proficiency >= req.min_level) AS meeting
    FROM req LEFT JOIN skills sk ON sk.id = req.skill_id
    LEFT JOIN ls ON ls.skill_id = req.skill_id
    GROUP BY req.competency_id, req.competency, req.skill_id, sk.name, req.min_level
    ORDER BY req.min_level - COALESCE(avg(ls.proficiency), 0) DESC""", p)
    for r in rows:
        r["avg_proficiency"] = _f(r["avg_proficiency"])
        r["below"] = max(0, (r["learners"] or 0) - (r["meeting"] or 0))
        r["gap"] = _f(max(0.0, r["min_level"] - (r["avg_proficiency"] or 0)))
        r["coverage_rate"] = _rate(r["meeting"], r["learners"])
    return rows


async def department_breakdown(db: AsyncSession, org_id: uuid.UUID, rng: DateRange,
                               course_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
    e_rng, p = rng.sql("e.created_at", "e")
    p.update({"org": org_id, "today": _today(), "cid": course_id})
    rows = await _rows(db, f"""
    SELECT ou.department_id, COALESCE(d.name, 'Unassigned') AS department,
           count(DISTINCT ou.user_id) AS members, count(e.id) AS enrolments,
           count(e.id) FILTER (WHERE e.status='completed') AS completed,
           count(e.id) FILTER (WHERE e.status IN {OPEN_STATUSES} AND e.due_date < :today) AS overdue,
           avg(e.final_score) FILTER (WHERE e.status='completed') AS avg_final_score
    FROM organisation_users ou
    LEFT JOIN departments d ON d.id = ou.department_id
    LEFT JOIN enrolments e ON e.organisation_id = ou.organisation_id AND e.user_id = ou.user_id
      AND e.status <> 'withdrawn' {"AND e.course_id = :cid" if course_id else ""} {e_rng}
    WHERE ou.organisation_id=:org AND ou.status='active'
    GROUP BY ou.department_id, d.name ORDER BY department""", p)
    for r in rows:
        r["completion_rate"] = _rate(r["completed"], r["enrolments"])
        r["avg_final_score"] = _f(r["avg_final_score"])
    return rows


async def active_learners_trend(db: AsyncSession, org_id: uuid.UUID, *, days: int = 30,
                                department_id: uuid.UUID | None = None, end: date | None = None
                                ) -> list[dict[str, Any]]:
    p = {"org": org_id, "end": end or _today(), "days": days - 1, "dept": department_id}
    dept = ("AND ad.user_id IN (SELECT ou.user_id FROM organisation_users ou WHERE ou.organisation_id=:org "
            "AND ou.department_id=:dept)") if department_id else ""
    return await _rows(db, f"""
    SELECT g.day::date AS date, count(DISTINCT ad.user_id) AS active_learners,
           COALESCE(sum(ad.seconds), 0) AS seconds
    FROM generate_series(CAST(:end AS date) - CAST(:days AS int), CAST(:end AS date), interval '1 day') AS g(day)
    LEFT JOIN activity_days ad ON ad.day = g.day::date AND ad.organisation_id=:org {dept}
    GROUP BY g.day ORDER BY g.day""", p)


async def organisation_analytics(db: AsyncSession, org_id: uuid.UUID, rng: DateRange, *,
                                 department_id: uuid.UUID | None = None, course_id: uuid.UUID | None = None
                                 ) -> dict[str, Any]:
    e_rng, p = rng.sql("e.created_at", "e")
    c_rng, c_p = rng.sql("cert.issued_at", "c")
    p.update(c_p | {"org": org_id, "today": _today(), "dept": department_id, "cid": course_id})
    member_join = ("JOIN organisation_users ou ON ou.organisation_id = e.organisation_id AND ou.user_id = e.user_id"
                   f" AND ou.status='active' {_member_filter(department_id)}")
    course_e = "AND e.course_id = :cid" if course_id else ""
    totals = await _row(db, f"""
    SELECT
      (SELECT count(*) FROM organisation_users ou WHERE ou.organisation_id=:org AND ou.status='active'
         {_member_filter(department_id)}) AS members,
      (SELECT count(DISTINCT ad.user_id) FROM activity_days ad
         JOIN organisation_users ou ON ou.organisation_id = ad.organisation_id AND ou.user_id = ad.user_id
         WHERE ad.organisation_id=:org AND ad.day > CAST(:today AS date) - 30 {_member_filter(department_id)})
         AS active_learners_30d,
      count(e.id) AS enrolments,
      count(e.id) FILTER (WHERE e.status='completed') AS completed,
      count(e.id) FILTER (WHERE e.status='in_progress') AS in_progress,
      count(e.id) FILTER (WHERE e.status IN {OPEN_STATUSES} AND e.due_date < :today) AS overdue,
      avg(e.final_score) FILTER (WHERE e.status='completed') AS avg_final_score,
      COALESCE(sum(e.time_spent_seconds), 0) AS time_spent_seconds,
      (SELECT count(*) FROM certificates cert
         JOIN organisation_users ou ON ou.organisation_id = cert.organisation_id AND ou.user_id = cert.user_id
         WHERE cert.organisation_id=:org AND cert.revoked_at IS NULL {_member_filter(department_id)}
         {"AND cert.course_id = :cid" if course_id else ""} {c_rng}) AS certificates_issued
    FROM enrolments e {member_join}
    WHERE e.organisation_id=:org AND e.status <> 'withdrawn' {course_e} {e_rng}""", p)
    totals["avg_final_score"] = _f(totals["avg_final_score"])
    totals["completion_rate"] = _rate(totals["completed"], totals["enrolments"])
    totals["hours_learned"] = _f((totals["time_spent_seconds"] or 0) / 3600.0)
    performance = await employee_performance(db, org_id, rng, department_id=department_id, course_id=course_id,
                                             limit=50)
    return {
        "range": rng.as_dict(), "filters": {"department_id": department_id, "course_id": course_id},
        "summary": totals,
        "compliance": await compliance(db, org_id, rng, department_id=department_id, course_id=course_id),
        "employee_performance": performance,
        "top_performers": [r for r in performance if r["completed"]][:5],
        "skill_gaps": await skill_gaps(db, org_id, department_id=department_id),
        "departments": await department_breakdown(db, org_id, rng, course_id=course_id),
        "courses": await courses_overview(db, org_id, rng),
        "active_learners_trend": await active_learners_trend(db, org_id, department_id=department_id),
    }


# ============================================================================= platform (super admin)


async def platform_analytics(db: AsyncSession, rng: DateRange) -> dict[str, Any]:
    """Cross-tenant platform view. The caller must have bound the session with RLS bypass."""
    rng = DateRange(rng.start or _today() - timedelta(days=29), rng.end or _today())
    p: dict[str, Any] = {"start": rng.start_dt, "end": rng.end_dt, "today": _today()}

    orgs = await _row(db, """
    SELECT count(*) AS total, count(*) FILTER (WHERE status='active') AS active,
           count(*) FILTER (WHERE status='suspended') AS suspended,
           count(*) FILTER (WHERE created_at >= :start AND created_at < :end) AS new_in_range
    FROM organisations WHERE deleted_at IS NULL""", p)
    orgs["by_plan"] = await _rows(db, """SELECT plan_code, count(*) AS count FROM organisations
        WHERE deleted_at IS NULL GROUP BY plan_code ORDER BY 2 DESC""", p)
    orgs["by_kind"] = await _rows(db, """SELECT kind, count(*) AS count FROM organisations
        WHERE deleted_at IS NULL GROUP BY kind ORDER BY 2 DESC""", p)

    users = await _row(db, """
    SELECT count(*) AS total,
           count(*) FILTER (WHERE created_at >= :start AND created_at < :end) AS new_in_range,
           count(*) FILTER (WHERE last_login_at >= :start AND last_login_at < :end) AS logged_in_in_range,
           (SELECT count(DISTINCT user_id) FROM activity_days WHERE day > CAST(:today AS date) - 30) AS active_30d
    FROM users WHERE deleted_at IS NULL""", p)
    users["signups_by_day"] = await _rows(db, """
    SELECT g.day::date AS date, count(u.id) AS signups
    FROM generate_series(CAST(:start AS date), CAST(:end AS date) - 1, interval '1 day') g(day)
    LEFT JOIN users u ON u.created_at >= g.day AND u.created_at < g.day + interval '1 day'
    GROUP BY g.day ORDER BY g.day""", p)

    revenue = await _row(db, """
    SELECT COALESCE(sum(amount_cents) FILTER (WHERE status='paid'), 0) AS total_paid_cents,
           COALESCE(sum(amount_cents) FILTER (WHERE status='paid' AND paid_at >= :start AND paid_at < :end), 0)
             AS paid_in_range_cents,
           count(*) FILTER (WHERE status IN ('open','uncollectible')) AS outstanding_invoices
    FROM payments""", p)
    revenue["by_month"] = await _rows(db, """
    SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, currency, sum(amount_cents) AS amount_cents
    FROM payments WHERE status='paid' AND paid_at >= date_trunc('month', CAST(:today AS date)) - interval '11 months'
    GROUP BY 1, 2 ORDER BY 1""", p)
    subs = await _rows(db, """
    SELECT DISTINCT ON (organisation_id) organisation_id, plan_code, status, billing_interval, seats
    FROM subscriptions ORDER BY organisation_id, created_at DESC""", p)
    mrr = 0.0
    by_status: dict[str, int] = {}
    for s in subs:
        by_status[s["status"]] = by_status.get(s["status"], 0) + 1
        if s["status"] not in ("active", "past_due"):
            continue
        plan = get_plan(s["plan_code"])
        qty = (s["seats"] or 1) if plan.seat_based else 1
        mrr += (plan.annual_price_cents / 12.0 if s["billing_interval"] == "year" else plan.monthly_price_cents) * qty
    revenue["mrr_cents_estimate"] = int(round(mrr))
    revenue["subscriptions_by_status"] = by_status

    courses = await _row(db, """
    SELECT count(*) AS total, count(*) FILTER (WHERE status='published') AS published,
           count(*) FILTER (WHERE ai_generated) AS ai_generated
    FROM courses WHERE deleted_at IS NULL""", p)
    activity = await _row(db, """
    SELECT
      (SELECT count(*) FROM enrolments WHERE created_at >= :start AND created_at < :end) AS enrolments,
      (SELECT count(*) FROM enrolments WHERE completed_at >= :start AND completed_at < :end) AS completions,
      (SELECT count(*) FROM assessment_attempts WHERE submitted_at >= :start AND submitted_at < :end) AS attempts,
      (SELECT count(*) FROM submissions WHERE submitted_at >= :start AND submitted_at < :end) AS submissions,
      (SELECT count(*) FROM simulation_sessions WHERE started_at >= :start AND started_at < :end)
        AS simulation_sessions,
      (SELECT count(*) FROM certificates WHERE issued_at >= :start AND issued_at < :end) AS certificates,
      (SELECT count(*) FROM ai_messages WHERE created_at >= :start AND created_at < :end) AS tutor_messages""", p)

    ai_window = "FROM ai_usage WHERE created_at >= :start AND created_at < :end"
    ai = await _row(db, f"""SELECT COALESCE(sum(cost_usd), 0) AS cost_usd, count(*) AS requests,
        COALESCE(sum(tokens_in), 0) AS tokens_in, COALESCE(sum(tokens_out), 0) AS tokens_out,
        count(*) FILTER (WHERE NOT success) AS errors {ai_window}""", p)
    ai["cost_usd"] = _f(ai["cost_usd"], 4)
    ai["by_organisation"] = await _rows(db, f"""
    SELECT u.organisation_id, o.name, sum(u.cost_usd) AS cost_usd, count(*) AS requests
    FROM ai_usage u JOIN organisations o ON o.id = u.organisation_id
    WHERE u.created_at >= :start AND u.created_at < :end GROUP BY u.organisation_id, o.name
    ORDER BY 3 DESC LIMIT 20""", p)
    ai["by_feature"] = await _rows(db, f"""SELECT feature, sum(cost_usd) AS cost_usd, count(*) AS requests
        {ai_window} GROUP BY feature ORDER BY 2 DESC""", p)
    ai["by_model"] = await _rows(db, f"""SELECT provider, model, sum(cost_usd) AS cost_usd, count(*) AS requests,
        sum(tokens_in + tokens_out) AS tokens {ai_window} GROUP BY provider, model ORDER BY 3 DESC""", p)
    for group in ("by_organisation", "by_feature", "by_model"):
        for r in ai[group]:
            r["cost_usd"] = _f(r["cost_usd"], 4)

    storage = await _row(db, """SELECT COALESCE(sum(size_bytes), 0) AS total_bytes, count(*) AS files
        FROM files WHERE deleted_at IS NULL""", p)
    storage["by_organisation"] = await _rows(db, """
    SELECT f.organisation_id, o.name, sum(f.size_bytes) AS bytes, count(*) AS files
    FROM files f JOIN organisations o ON o.id = f.organisation_id WHERE f.deleted_at IS NULL
    GROUP BY f.organisation_id, o.name ORDER BY 3 DESC LIMIT 10""", p)
    storage["by_purpose"] = await _rows(db, """SELECT purpose, sum(size_bytes) AS bytes, count(*) AS files
        FROM files WHERE deleted_at IS NULL GROUP BY purpose ORDER BY 2 DESC""", p)

    return {"range": rng.as_dict(), "organisations": orgs, "users": users, "revenue": revenue,
            "courses": courses, "activity": activity, "ai_usage": ai, "storage": storage,
            "api": metrics.snapshot()}
