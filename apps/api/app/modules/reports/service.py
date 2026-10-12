"""Report data builders. Each report type turns analytics aggregates and row-level detail into a
``ReportData``
(KPIs + tables) which the renderers output as PDF, XLSX or CSV."""

# SQL below is assembled only from static fragments; every value is a bound parameter.
# ruff: noqa: S608

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BadRequest
from app.models.tenancy import Organisation
from app.modules.analytics import service as an
from app.modules.analytics.service import DateRange
from app.modules.reports.render import ReportData, ReportTable, brand

REPORT_TYPES: dict[str, str] = {
    "learner_progress": "Learner progress",
    "course": "Course report",
    "compliance": "Compliance report",
    "assignment": "Assignment results",
    "simulation": "Simulation results",
    "competency": "Competency & skills",
    "organisation": "Organisation overview",
}


@dataclass
class ReportFilters:
    course_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    rng: DateRange = field(default_factory=DateRange)

    def sql(
        self,
        *,
        user_col: str,
        course_col: str | None,
        date_col: str | None,
        dept_col: str = "ou.department_id",
    ) -> tuple[str, dict[str, Any]]:
        parts, params = [], {}
        if self.user_id:
            parts.append(f" AND {user_col} = :f_user")
            params["f_user"] = self.user_id
        if self.course_id and course_col:
            parts.append(f" AND {course_col} = :f_course")
            params["f_course"] = self.course_id
        if self.department_id:
            parts.append(f" AND {dept_col} = :f_dept")
            params["f_dept"] = self.department_id
        if date_col:
            frag, p = self.rng.sql(date_col, "f")
            parts.append(frag)
            params.update(p)
        return "".join(parts), params


def _status(s: str | None) -> str:
    return (s or "").replace("_", " ").capitalize()


def _minutes(seconds: Any) -> int:
    return int(round((seconds or 0) / 60))


def _pct(v: Any) -> str:
    return "—" if v is None else f"{float(v):.1f}%"


MEMBER_JOIN = """LEFT JOIN organisation_users ou
  ON ou.organisation_id = {t}.organisation_id AND ou.user_id = {t}.user_id
LEFT JOIN departments d ON d.id = ou.department_id"""


# ----------------------------------------------------------------------------- builders


async def learner_progress(db: AsyncSession, org_id: uuid.UUID, f: ReportFilters) -> dict[str, Any]:
    frag, params = f.sql(user_col="e.user_id", course_col="e.course_id", date_col="e.created_at")
    rows = await an._rows(
        db,
        f"""
    SELECT u.full_name, u.email, d.name AS department, c.title AS course, e.status, e.progress_pct,
      e.final_score,
           e.created_at AS enrolled_at, e.due_date, e.completed_at, e.time_spent_seconds,
           (e.status IN {an.OPEN_STATUSES} AND e.due_date < :today) AS overdue
    FROM enrolments e JOIN users u ON u.id = e.user_id JOIN courses c ON c.id = e.course_id
    {MEMBER_JOIN.format(t="e")}
    WHERE e.organisation_id = :org AND e.status <> 'withdrawn' {frag}
    ORDER BY u.full_name, c.title""",
        {"org": org_id, "today": an._today(), **params},
    )
    learners = {r["email"] for r in rows}
    completed = [r for r in rows if r["status"] == "completed"]
    scores = [r["final_score"] for r in completed if r["final_score"] is not None]
    kpis = [
        ("Learners", len(learners)),
        ("Enrolments", len(rows)),
        ("Completed", len(completed)),
        ("Completion rate", _pct(an._rate(len(completed), len(rows)))),
        ("Average final score", _pct(sum(scores) / len(scores) if scores else None)),
        ("Overdue", sum(1 for r in rows if r["overdue"])),
        ("Hours learned", round(sum(r["time_spent_seconds"] or 0 for r in rows) / 3600, 1)),
    ]
    table = ReportTable(
        "Learner progress",
        [
            "Learner",
            "Email",
            "Department",
            "Course",
            "Status",
            "Progress %",
            "Final score",
            "Enrolled",
            "Due date",
            "Completed",
            "Time (min)",
            "Overdue",
        ],
        [
            [
                r["full_name"],
                r["email"],
                r["department"],
                r["course"],
                _status(r["status"]),
                r["progress_pct"],
                r["final_score"],
                r["enrolled_at"],
                r["due_date"],
                r["completed_at"],
                _minutes(r["time_spent_seconds"]),
                r["overdue"],
            ]
            for r in rows
        ],
    )
    return {"kpis": kpis, "tables": [table]}


async def course_report(db: AsyncSession, org_id: uuid.UUID, f: ReportFilters) -> dict[str, Any]:
    if not f.course_id:
        raise BadRequest("course_id is required for the course report")
    d = await an.course_analytics(db, org_id, f.course_id, f.rng)
    e = d["enrolments"]
    kpis = [
        ("Course", d["course"].get("title")),
        ("Enrolments", e["total"]),
        ("Completed", e["completed"]),
        ("Completion rate", _pct(e["completion_rate"])),
        ("Average final score", _pct(e["avg_final_score"])),
        ("Overdue", e["overdue"]),
        ("Average progress", _pct(e["avg_progress"])),
        ("Avg days to complete", e["avg_days_to_complete"] if e["avg_days_to_complete"] is not None else "—"),
    ]
    funnel = ReportTable(
        "Completion funnel",
        ["Module", "Lesson", "Type", "Started", "Completed", "Completion %", "Avg time (min)"],
        [],
    )
    for m in d["funnel"]:
        funnel.rows.append(
            [m["title"], "(module total)", "", "", m["learners_completed"], m["completion_rate"], ""]
        )
        for lesson in m["lessons"]:
            funnel.rows.append(
                [
                    m["title"],
                    lesson["title"],
                    lesson["lesson_type"],
                    lesson["started"],
                    lesson["completed"],
                    lesson["completion_rate"],
                    _minutes(lesson["avg_time_seconds"]),
                ]
            )
    assessments = ReportTable(
        "Assessments",
        ["Assessment", "Kind", "Attempts", "Learners", "Avg %", "Pass rate %"],
        [
            [a["title"], a["kind"], a["attempts"], a["learners"], a["avg_percentage"], a["pass_rate"]]
            for a in d["assessments"]
        ],
    )
    questions = ReportTable(
        "Question analysis",
        ["Question", "Type", "Responses", "% correct (p)", "Discrimination", "Difficulty", "Needs review"],
        [
            [
                q["prompt"] or str(q["question_id"]),
                q["question_type"],
                q["responses"],
                round(q["p_value"] * 100, 1) if q["p_value"] is not None else None,
                q["discrimination"],
                q["difficulty"],
                q["needs_review"],
            ]
            for q in d["questions"]
        ],
    )
    assignments = ReportTable(
        "Assignments",
        [
            "Assignment",
            "Submissions",
            "Graded",
            "Avg score",
            "Pass rate %",
            "0-49",
            "50-59",
            "60-69",
            "70-79",
            "80-89",
            "90-100",
        ],
        [
            [
                a["title"],
                a["submissions"],
                a["graded"],
                a["avg_score"],
                a["pass_rate"],
                *[b["count"] for b in a["distribution"]],
            ]
            for a in d["assignments"]
        ],
    )
    sims = _simulation_summary_table(d["simulations"])
    return {
        "kpis": kpis,
        "tables": [funnel, assessments, questions, assignments, sims],
        "subtitle_extra": d["course"].get("title"),
    }


async def compliance_report(db: AsyncSession, org_id: uuid.UUID, f: ReportFilters) -> dict[str, Any]:
    frag, params = f.sql(user_col="e.user_id", course_col="e.course_id", date_col="e.created_at")
    rows = await an._rows(
        db,
        f"""
    SELECT u.full_name, u.email, d.name AS department, c.title AS course, a.full_name AS assigned_by,
           e.created_at AS assigned_at, e.due_date, e.completed_at, e.status, e.progress_pct,
           CASE WHEN e.status = 'completed' AND e.completed_at::date <= e.due_date THEN 'On time'
                WHEN e.status = 'completed' THEN 'Late'
                WHEN e.due_date < :today THEN 'Overdue' ELSE 'Pending' END AS compliance,
           CASE WHEN e.status <> 'completed' AND e.due_date < :today THEN (CAST(:today AS date) -
             e.due_date) END AS days_overdue
    FROM enrolments e JOIN users u ON u.id = e.user_id JOIN courses c ON c.id = e.course_id
    LEFT JOIN users a ON a.id = e.assigned_by
    {MEMBER_JOIN.format(t="e")}
    WHERE e.organisation_id = :org AND e.due_date IS NOT NULL AND e.status <> 'withdrawn'
      AND (e.assigned_by IS NOT NULL OR e.source IN ('assigned', 'learning_path')) {frag}
    ORDER BY CASE WHEN e.status <> 'completed' AND e.due_date < :today THEN 0 ELSE 1 END, e.due_date,
      u.full_name""",
        {"org": org_id, "today": an._today(), **params},
    )
    c = await an.compliance(db, org_id, f.rng, department_id=f.department_id, course_id=f.course_id)
    if f.user_id:  # recompute KPIs from the filtered rows
        c = {
            "assigned": len(rows),
            "completed_on_time": sum(r["compliance"] == "On time" for r in rows),
            "completed_late": sum(r["compliance"] == "Late" for r in rows),
            "overdue": sum(r["compliance"] == "Overdue" for r in rows),
            "pending": sum(r["compliance"] == "Pending" for r in rows),
            "by_course": [],
        }
        due_or_done = c["completed_on_time"] + c["completed_late"] + c["overdue"]
        c["compliance_rate"] = an._rate(c["completed_on_time"], due_or_done)
    kpis = [
        ("Assigned training", c["assigned"]),
        ("Completed on time", c["completed_on_time"]),
        ("Completed late", c["completed_late"]),
        ("Overdue", c["overdue"]),
        ("Pending", c["pending"]),
        ("Compliance rate", _pct(c["compliance_rate"])),
    ]
    detail = ReportTable(
        "Assigned training",
        [
            "Learner",
            "Email",
            "Department",
            "Course",
            "Assigned by",
            "Assigned",
            "Due date",
            "Completed",
            "Status",
            "Progress %",
            "Compliance",
            "Days overdue",
        ],
        [
            [
                r["full_name"],
                r["email"],
                r["department"],
                r["course"],
                r["assigned_by"],
                r["assigned_at"],
                r["due_date"],
                r["completed_at"],
                _status(r["status"]),
                r["progress_pct"],
                r["compliance"],
                r["days_overdue"],
            ]
            for r in rows
        ],
    )
    by_course = ReportTable(
        "By course",
        ["Course", "Assigned", "On time", "Late", "Overdue", "Pending", "Compliance %"],
        [
            [
                r["title"],
                r["assigned"],
                r["completed_on_time"],
                r["completed_late"],
                r["overdue"],
                r["pending"],
                r["compliance_rate"],
            ]
            for r in c.get("by_course", [])
        ],
    )
    return {"kpis": kpis, "tables": [detail, by_course]}


async def assignment_report(db: AsyncSession, org_id: uuid.UUID, f: ReportFilters) -> dict[str, Any]:
    frag, params = f.sql(
        user_col="s.user_id", course_col="asg.course_id", date_col="COALESCE(s.graded_at, s.submitted_at)"
    )
    rows = await an._rows(
        db,
        f"""
    SELECT u.full_name, u.email, d.name AS department, asg.title AS assignment, c.title AS course, s.status,
           s.submit_count, s.submitted_at, s.ai_score, s.human_score, s.final_score, s.passed, s.graded_at,
           g.full_name AS graded_by
    FROM submissions s JOIN assignments asg ON asg.id = s.assignment_id JOIN users u ON u.id = s.user_id
    LEFT JOIN courses c ON c.id = asg.course_id LEFT JOIN users g ON g.id = s.graded_by
    {MEMBER_JOIN.format(t="s")}
    WHERE s.organisation_id = :org AND s.status <> 'draft' {frag}
    ORDER BY asg.title, u.full_name""",
        {"org": org_id, **params},
    )
    graded = [r for r in rows if r["final_score"] is not None]
    passed = [r for r in graded if r["passed"]]
    kpis = [
        ("Submissions", len(rows)),
        ("Graded", len(graded)),
        ("Awaiting grading", len(rows) - len(graded)),
        ("Average score", _pct(sum(r["final_score"] for r in graded) / len(graded) if graded else None)),
        ("Pass rate", _pct(an._rate(len(passed), len(graded)))),
    ]
    table = ReportTable(
        "Assignment submissions",
        [
            "Learner",
            "Email",
            "Department",
            "Assignment",
            "Course",
            "Status",
            "Submissions",
            "Submitted",
            "AI score",
            "Human score",
            "Final score",
            "Passed",
            "Graded",
            "Graded by",
        ],
        [
            [
                r["full_name"],
                r["email"],
                r["department"],
                r["assignment"],
                r["course"],
                _status(r["status"]),
                r["submit_count"],
                r["submitted_at"],
                r["ai_score"],
                r["human_score"],
                r["final_score"],
                r["passed"] if r["final_score"] is not None else None,
                r["graded_at"],
                r["graded_by"],
            ]
            for r in rows
        ],
    )
    return {"kpis": kpis, "tables": [table]}


def _simulation_summary_table(sims: list[dict[str, Any]]) -> ReportTable:
    return ReportTable(
        "Simulations",
        [
            "Simulation",
            "Sessions",
            "Completed",
            "Learners",
            "Avg score",
            "Pass rate %",
            "Bands",
            "Dimension averages",
        ],
        [
            [
                s["title"],
                s["sessions"],
                s["completed"],
                s["learners"],
                s["avg_score"],
                s["pass_rate"],
                ", ".join(f"{k}: {v}" for k, v in sorted(s["bands"].items())),
                ", ".join(f"{x['dimension']}: {x['avg_score']}" for x in s["dimensions"]),
            ]
            for s in sims
        ],
    )


async def simulation_report(db: AsyncSession, org_id: uuid.UUID, f: ReportFilters) -> dict[str, Any]:
    frag, params = f.sql(user_col="ss.user_id", course_col="sim.course_id", date_col="ss.started_at")
    rows = await an._rows(
        db,
        f"""
    SELECT u.full_name, u.email, d.name AS department, sim.title AS simulation, ss.attempt_number, ss.status,
           ss.total_score, ss.band, ss.passed, ss.action_count, ss.started_at, ss.completed_at,
           ss.dimension_scores
    FROM simulation_sessions ss JOIN simulations sim ON sim.id = ss.simulation_id JOIN users u ON u.id =
      ss.user_id
    {MEMBER_JOIN.format(t="ss")}
    WHERE ss.organisation_id = :org {frag}
    ORDER BY sim.title, u.full_name, ss.attempt_number""",
        {"org": org_id, **params},
    )
    done = [r for r in rows if r["status"] == "completed"]
    scored = [r["total_score"] for r in done if r["total_score"] is not None]
    kpis = [
        ("Sessions", len(rows)),
        ("Completed", len(done)),
        ("Average score", _pct(sum(scored) / len(scored) if scored else None)),
        ("Pass rate", _pct(an._rate(sum(1 for r in done if r["passed"]), len(done)))),
    ]

    def dims(v: Any) -> str:
        if not isinstance(v, dict):
            return ""
        out = []
        for k, val in v.items():
            if isinstance(val, dict):
                val = val.get("pct", val.get("percentage", val.get("score")))
            out.append(f"{k}: {val}")
        return ", ".join(out)

    detail = ReportTable(
        "Simulation sessions",
        [
            "Learner",
            "Email",
            "Department",
            "Simulation",
            "Attempt",
            "Status",
            "Score",
            "Band",
            "Passed",
            "Actions",
            "Started",
            "Completed",
            "Dimensions",
        ],
        [
            [
                r["full_name"],
                r["email"],
                r["department"],
                r["simulation"],
                r["attempt_number"],
                _status(r["status"]),
                r["total_score"],
                r["band"],
                r["passed"],
                r["action_count"],
                r["started_at"],
                r["completed_at"],
                dims(r["dimension_scores"]),
            ]
            for r in rows
        ],
    )
    summary = _simulation_summary_table(await an.simulation_results(db, org_id, f.rng, course_id=f.course_id))
    return {"kpis": kpis, "tables": [detail, summary]}


async def competency_report(db: AsyncSession, org_id: uuid.UUID, f: ReportFilters) -> dict[str, Any]:
    gaps = await an.skill_gaps(db, org_id, department_id=f.department_id, user_id=f.user_id)
    frag, params = f.sql(user_col="ls.user_id", course_col=None, date_col=None)
    rows = await an._rows(
        db,
        f"""
    SELECT u.full_name, u.email, d.name AS department, sk.name AS skill, sk.category, ls.proficiency,
           ls.evidence_count, ls.last_assessed_at,
           (SELECT max(COALESCE((r->>'min_level')::float, 70.0)) FROM competencies c
              CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(c.requirements) = 'array' THEN c.requirements ELSE '[]'::jsonb END) r
              WHERE c.organisation_id = :org AND r->>'skill_id' = ls.skill_id::text) AS required_level
    FROM learner_skills ls JOIN skills sk ON sk.id = ls.skill_id JOIN users u ON u.id = ls.user_id
    {MEMBER_JOIN.format(t="ls")}
    WHERE ls.organisation_id = :org AND ou.status = 'active' {frag}
    ORDER BY u.full_name, sk.name""",
        {"org": org_id, **params},
    )
    kpis = [
        ("Competency requirements", len(gaps)),
        ("Requirements with gaps", sum(1 for g in gaps if g["below"])),
        ("Learner skill records", len(rows)),
        ("Average proficiency", _pct(sum(r["proficiency"] for r in rows) / len(rows) if rows else None)),
    ]
    gap_table = ReportTable(
        "Skill gaps by competency",
        [
            "Competency",
            "Skill",
            "Required level",
            "Learners",
            "Assessed",
            "Meeting",
            "Below",
            "Avg proficiency",
            "Gap",
            "Coverage %",
        ],
        [
            [
                g["competency"],
                g["skill"],
                g["min_level"],
                g["learners"],
                g["assessed"],
                g["meeting"],
                g["below"],
                g["avg_proficiency"],
                g["gap"],
                g["coverage_rate"],
            ]
            for g in gaps
        ],
    )
    learner_table = ReportTable(
        "Learner skills",
        [
            "Learner",
            "Email",
            "Department",
            "Skill",
            "Category",
            "Proficiency",
            "Required",
            "Meets requirement",
            "Evidence",
            "Last assessed",
        ],
        [
            [
                r["full_name"],
                r["email"],
                r["department"],
                r["skill"],
                r["category"],
                r["proficiency"],
                r["required_level"],
                (r["proficiency"] >= r["required_level"]) if r["required_level"] is not None else None,
                r["evidence_count"],
                r["last_assessed_at"],
            ]
            for r in rows
        ],
    )
    return {"kpis": kpis, "tables": [gap_table, learner_table]}


async def organisation_report(db: AsyncSession, org_id: uuid.UUID, f: ReportFilters) -> dict[str, Any]:
    d = await an.organisation_analytics(
        db, org_id, f.rng, department_id=f.department_id, course_id=f.course_id
    )
    s, c = d["summary"], d["compliance"]
    kpis = [
        ("Active members", s["members"]),
        ("Active learners (30d)", s["active_learners_30d"]),
        ("Enrolments", s["enrolments"]),
        ("Completion rate", _pct(s["completion_rate"])),
        ("Average final score", _pct(s["avg_final_score"])),
        ("Overdue", s["overdue"]),
        ("Compliance rate", _pct(c["compliance_rate"])),
        ("Certificates issued", s["certificates_issued"]),
        ("Hours learned", s["hours_learned"]),
    ]
    perf = ReportTable(
        "Employee performance",
        [
            "Employee",
            "Email",
            "Department",
            "Job title",
            "Enrolments",
            "Completed",
            "Completion %",
            "Overdue",
            "Avg final score",
            "Avg assessment %",
            "Avg simulation score",
            "Time (min)",
        ],
        [
            [
                r["full_name"],
                r["email"],
                r["department"],
                r["job_title"],
                r["enrolments"],
                r["completed"],
                r["completion_rate"],
                r["overdue"],
                r["avg_final_score"],
                r["avg_assessment_pct"],
                r["avg_simulation_score"],
                _minutes(r["time_spent_seconds"]),
            ]
            for r in d["employee_performance"]
        ],
    )
    depts = ReportTable(
        "Departments",
        ["Department", "Members", "Enrolments", "Completed", "Completion %", "Overdue", "Avg final score"],
        [
            [
                r["department"],
                r["members"],
                r["enrolments"],
                r["completed"],
                r["completion_rate"],
                r["overdue"],
                r["avg_final_score"],
            ]
            for r in d["departments"]
        ],
    )
    courses = ReportTable(
        "Courses",
        ["Course", "Status", "Enrolments", "Completed", "Completion %", "Overdue", "Avg final score"],
        [
            [
                r["title"],
                r["status"],
                r["enrolments"],
                r["completed"],
                r["completion_rate"],
                r["overdue"],
                r["avg_final_score"],
            ]
            for r in d["courses"]
        ],
    )
    gaps = ReportTable(
        "Skill gaps",
        ["Competency", "Skill", "Required", "Avg proficiency", "Below", "Gap"],
        [
            [g["competency"], g["skill"], g["min_level"], g["avg_proficiency"], g["below"], g["gap"]]
            for g in d["skill_gaps"]
        ],
    )
    trend = ReportTable(
        "Active learners (30 days)",
        ["Date", "Active learners", "Minutes"],
        [[t["date"], t["active_learners"], _minutes(t["seconds"])] for t in d["active_learners_trend"]],
    )
    return {"kpis": kpis, "tables": [perf, depts, courses, gaps, trend]}


BUILDERS: dict[str, Callable[[AsyncSession, uuid.UUID, ReportFilters], Awaitable[dict[str, Any]]]] = {
    "learner_progress": learner_progress,
    "course": course_report,
    "compliance": compliance_report,
    "assignment": assignment_report,
    "simulation": simulation_report,
    "competency": competency_report,
    "organisation": organisation_report,
}


async def build_report(
    db: AsyncSession,
    org: Organisation,
    report_type: str,
    f: ReportFilters,
    *,
    generated_by: str | None,
    filter_labels: dict[str, Any],
) -> ReportData:
    built = await BUILDERS[report_type](db, org.id, f)
    rng = f.rng
    period = f"{rng.start or 'beginning'} to {rng.end or 'today'}" if (rng.start or rng.end) else "All time"
    subtitle = f"{REPORT_TYPES[report_type]} · {period}"
    if built.get("subtitle_extra"):
        subtitle = f"{built['subtitle_extra']} · {subtitle}"
    return ReportData(
        title=REPORT_TYPES[report_type],
        subtitle=subtitle,
        organisation_name=org.name,
        brand_color=brand((org.branding or {}).get("primary_color")),
        kpis=built["kpis"],
        tables=built["tables"],
        filters=filter_labels,
        generated_at=datetime.now(UTC),
        generated_by=generated_by,
    )
