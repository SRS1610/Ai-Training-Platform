"""Write approved generation output into DRAFT platform entities (never published, always ai_generated)."""

from __future__ import annotations

import re
import uuid
from collections import Counter
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BadRequest, NotFound
from app.models.assessment import Assessment, AssessmentItem, Question, QuestionBank
from app.models.assignment import Assignment, Rubric
from app.models.content import Activity, Course, CourseModule, CourseStatus, Lesson
from app.models.simulation import Simulation

DIFFICULTIES = {"beginner", "intermediate", "advanced", "expert"}


class Applier:
    def __init__(self, db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> None:
        self.db = db
        self.org_id = org_id
        self.user_id = user_id
        self.created: Counter[str] = Counter()

    # ------------------------------------------------------------------ helpers

    def _add(self, obj: Any, kind: str) -> Any:
        self.db.add(obj)
        self.created[kind] += 1
        return obj

    async def unique_slug(self, title: str) -> str:
        base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:140] or "course"
        slug, n = base, 1
        while await self.db.scalar(
            select(Course.id).where(Course.organisation_id == self.org_id, Course.slug == slug)
        ):
            n += 1
            slug = f"{base}-{n}"
        return slug

    async def course(self, course_id: uuid.UUID | None) -> Course:
        if course_id is None:
            raise BadRequest("A course_id is required to apply this generation", code="course_required")
        c = await self.db.scalar(
            select(Course).where(
                Course.id == course_id, Course.organisation_id == self.org_id, Course.deleted_at.is_(None)
            )
        )
        if c is None:
            raise NotFound("Course not found")
        return c

    async def module(self, course: Course, module_id: uuid.UUID | None) -> CourseModule:
        if module_id is not None:
            m = await self.db.scalar(
                select(CourseModule).where(
                    CourseModule.id == module_id,
                    CourseModule.course_id == course.id,
                    CourseModule.organisation_id == self.org_id,
                    CourseModule.deleted_at.is_(None),
                )
            )
            if m is None:
                raise NotFound("Module not found")
            return m
        m = await self.db.scalar(
            select(CourseModule)
            .where(CourseModule.course_id == course.id, CourseModule.deleted_at.is_(None))
            .order_by(CourseModule.position.desc())
            .limit(1)
        )
        if m is None:
            m = self._add(
                CourseModule(
                    organisation_id=self.org_id, course_id=course.id, title="AI generated content", position=0
                ),
                "modules",
            )
            await self.db.flush()
        return m

    async def next_module_position(self, course_id: uuid.UUID) -> int:
        v = await self.db.scalar(
            select(func.max(CourseModule.position)).where(CourseModule.course_id == course_id)
        )
        return int(v) + 1 if v is not None else 0

    async def next_lesson_position(self, module_id: uuid.UUID) -> int:
        v = await self.db.scalar(select(func.max(Lesson.position)).where(Lesson.module_id == module_id))
        return int(v) + 1 if v is not None else 0

    @staticmethod
    def _validated(lesson_type: str, content: dict[str, Any]) -> dict[str, Any]:
        try:
            from app.modules.courses.content_rules import validate_lesson_content
        except ImportError:  # pragma: no cover
            return content
        return validate_lesson_content(lesson_type, content)

    # ------------------------------------------------------------------ questions / quizzes

    @staticmethod
    def question_fields(q: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]]:
        """Map generated questions onto the assessment engine's option / answer-key formats."""
        qtype = q.get("type", "multiple_choice")
        key = q.get("answer_key") or {}
        choices = q.get("choices") or []
        if qtype == "multiple_choice":
            return qtype, {"choices": choices}, {"choice_id": (key.get("choice_ids") or [None])[0]}
        if qtype == "multiple_select":
            return (
                qtype,
                {"choices": choices},
                {"choice_ids": key.get("choice_ids") or [], "partial_credit": True},
            )
        if qtype == "true_false":
            return qtype, {}, {"value": bool(key.get("value"))}
        if qtype == "short_answer":
            return qtype, {}, {"accepted": key.get("accepted") or [], "case_sensitive": False}
        if qtype == "fill_blank":
            text = str(q.get("prompt", ""))
            text = text.replace("_____", "{{b1}}", 1) if "_____" in text else text + " {{b1}}"
            return (
                qtype,
                {"text": text, "blanks": [{"id": "b1"}]},
                {"blanks": {"b1": {"accepted": key.get("accepted") or [], "case_sensitive": False}}},
            )
        # long_answer / scenario: open-ended, graded by rubric / AI with a model answer
        return qtype, {}, {k: v for k, v in key.items() if k in ("model_answer", "guidance", "keywords")}

    async def quiz(
        self, quiz: dict[str, Any], *, course_id: uuid.UUID | None, kind: str = "quiz"
    ) -> Assessment:
        bank = self._add(
            QuestionBank(
                organisation_id=self.org_id,
                title=f"{quiz['title']} — question bank"[:255],
                description="AI generated (draft)",
                course_id=course_id,
                created_by=self.user_id,
            ),
            "question_banks",
        )
        await self.db.flush()
        open_ended = False
        assessment = self._add(
            Assessment(
                organisation_id=self.org_id,
                course_id=course_id,
                title=quiz["title"][:255],
                description=quiz.get("description") or None,
                kind=kind,
                pass_percentage=float(quiz.get("pass_percentage", 70)),
                status="draft",
                grading_mode="auto",
                created_by=self.user_id,
                shuffle_questions=kind != "final",
            ),
            "assessments",
        )
        await self.db.flush()
        for pos, q in enumerate(quiz.get("questions") or []):
            qtype, options, answer_key = self.question_fields(q)
            open_ended = open_ended or qtype in ("long_answer", "scenario")
            question = self._add(
                Question(
                    organisation_id=self.org_id,
                    bank_id=bank.id,
                    question_type=qtype,
                    prompt=q["prompt"],
                    options=options,
                    answer_key=answer_key,
                    explanation=q.get("explanation") or None,
                    points=float(q.get("points", 1.0)),
                    difficulty=int(q.get("difficulty", 2)),
                    tags=["ai-generated"],
                    status="active",
                    ai_generated=True,
                    created_by=self.user_id,
                ),
                "questions",
            )
            await self.db.flush()
            self.db.add(
                AssessmentItem(
                    organisation_id=self.org_id,
                    assessment_id=assessment.id,
                    position=pos,
                    question_id=question.id,
                    weight=1.0,
                )
            )
        if open_ended:
            assessment.grading_mode = "ai_assisted"
        await self.db.flush()
        return assessment

    async def quiz_lesson(
        self, module: CourseModule, assessment: Assessment, title: str, position: int
    ) -> Lesson:
        lesson = self._add(
            Lesson(
                organisation_id=self.org_id,
                course_id=module.course_id,
                module_id=module.id,
                title=title[:255],
                lesson_type="quiz",
                content=self._validated("quiz", {}),
                duration_minutes=10,
                position=position,
                assessment_id=assessment.id,
                ai_generated=True,
            ),
            "lessons",
        )
        await self.db.flush()
        return lesson

    # ------------------------------------------------------------------ rubric / assignment

    async def rubric(self, r: dict[str, Any]) -> Rubric:
        rubric = self._add(
            Rubric(
                organisation_id=self.org_id,
                title=r["title"][:255],
                description=r.get("description"),
                criteria=r.get("criteria") or [],
                total_points=float(r.get("total_points", 100)),
                created_by=self.user_id,
                ai_generated=True,
            ),
            "rubrics",
        )
        await self.db.flush()
        return rubric

    async def assignment(self, a: dict[str, Any], *, course_id: uuid.UUID | None) -> Assignment:
        rubric = await self.rubric(a["rubric"])
        asg = self._add(
            Assignment(
                organisation_id=self.org_id,
                course_id=course_id,
                title=a["title"][:255],
                scenario=a.get("scenario", ""),
                objective=a.get("objective", ""),
                instructions=a.get("instructions", ""),
                required_evidence=a.get("required_evidence") or [],
                expected_output=a.get("expected_output") or None,
                evaluation_criteria=a.get("evaluation_criteria") or None,
                rubric_id=rubric.id,
                passing_score=float(a.get("passing_score", 70)),
                grading_mode="ai_assisted",
                status="draft",
                created_by=self.user_id,
                ai_generated=True,
            ),
            "assignments",
        )
        await self.db.flush()
        return asg

    # ------------------------------------------------------------------ lessons

    @staticmethod
    def lesson_markdown(lesson: dict[str, Any]) -> str:
        body = str(lesson.get("body_markdown") or "")
        if lesson.get("examples"):
            body += "\n\n## Examples\n" + "\n".join(f"- {e}" for e in lesson["examples"])
        if lesson.get("key_points"):
            body += "\n\n## Key points\n" + "\n".join(f"- {p}" for p in lesson["key_points"])
        return body.strip()

    async def lesson(self, module: CourseModule, lesson: dict[str, Any], position: int) -> Lesson:
        row = self._add(
            Lesson(
                organisation_id=self.org_id,
                course_id=module.course_id,
                module_id=module.id,
                title=lesson["title"][:255],
                summary=lesson.get("summary") or None,
                lesson_type="text",
                content=self._validated("text", {"body_markdown": self.lesson_markdown(lesson)}),
                duration_minutes=int(lesson.get("duration_minutes", 10)),
                position=position,
                ai_generated=True,
            ),
            "lessons",
        )
        await self.db.flush()
        pos = 0
        cs = lesson.get("case_study")
        if cs:
            self._add(
                Activity(
                    organisation_id=self.org_id,
                    lesson_id=row.id,
                    activity_type="scenario",
                    title=cs.get("title"),
                    position=pos,
                    content=self.case_study_content(cs),
                ),
                "activities",
            )
            pos += 1
        check = lesson.get("knowledge_check") or {}
        for q in check.get("questions") or []:
            if q.get("type") not in ("multiple_choice", "multiple_select") or not q.get("choices"):
                continue
            self._add(
                Activity(
                    organisation_id=self.org_id,
                    lesson_id=row.id,
                    activity_type="check",
                    title="Check your understanding",
                    position=pos,
                    content={
                        "question": q["prompt"],
                        "options": q["choices"],
                        "answer_ids": (q.get("answer_key") or {}).get("choice_ids") or [],
                        "explanation": q.get("explanation") or "",
                    },
                ),
                "activities",
            )
            pos += 1
        await self.db.flush()
        return row

    @staticmethod
    def case_study_content(cs: dict[str, Any]) -> dict[str, Any]:
        qs = "\n".join(f"{i}. {q}" for i, q in enumerate(cs.get("questions") or [], 1))
        return {
            "scenario": f"{cs.get('context', '')}\n\n**Challenge:** {cs.get('challenge', '')}".strip(),
            "body_markdown": f"### Discussion questions\n{qs}" if qs else "",
            # instructor-only: stripped from published snapshots by the course module
            "model_answer": cs.get("model_analysis") or "",
        }

    async def flashcards_lesson(self, module: CourseModule, fc: dict[str, Any], position: int) -> Lesson:
        row = self._add(
            Lesson(
                organisation_id=self.org_id,
                course_id=module.course_id,
                module_id=module.id,
                title=fc["title"][:255],
                lesson_type="flashcards",
                content=self._validated("flashcards", {"cards": fc["cards"][:500]}),
                duration_minutes=10,
                position=position,
                ai_generated=True,
            ),
            "lessons",
        )
        await self.db.flush()
        return row

    async def notes_lesson(self, module: CourseModule, notes: dict[str, Any], position: int) -> Lesson:
        md = [f"# {notes['title']}", "", notes.get("summary", "")]
        for sec in notes.get("sections") or []:
            md += ["", f"## {sec['heading']}", *[f"- {p}" for p in sec.get("points") or []]]
        if notes.get("key_terms"):
            md += [
                "",
                "## Key terms",
                *[f"- **{t['term']}** — {t['definition']}" for t in notes["key_terms"]],
            ]
        row = self._add(
            Lesson(
                organisation_id=self.org_id,
                course_id=module.course_id,
                module_id=module.id,
                title=notes["title"][:255],
                summary=notes.get("summary"),
                lesson_type="text",
                content=self._validated("text", {"body_markdown": "\n".join(md)}),
                duration_minutes=10,
                position=position,
                ai_generated=True,
            ),
            "lessons",
        )
        await self.db.flush()
        return row

    async def case_study_lesson(self, module: CourseModule, cs: dict[str, Any], position: int) -> Lesson:
        row = self._add(
            Lesson(
                organisation_id=self.org_id,
                course_id=module.course_id,
                module_id=module.id,
                title=cs["title"][:255],
                lesson_type="scenario",
                content=self._validated("scenario", self.case_study_content(cs)),
                duration_minutes=15,
                position=position,
                ai_generated=True,
            ),
            "lessons",
        )
        await self.db.flush()
        return row

    async def module_from(self, course: Course, m: dict[str, Any], position: int) -> CourseModule:
        title = m["title"] if not m.get("week") else f"Week {m['week']}: {m['title']}"
        module = self._add(
            CourseModule(
                organisation_id=self.org_id,
                course_id=course.id,
                title=title[:255],
                description=m.get("description") or None,
                position=position,
            ),
            "modules",
        )
        await self.db.flush()
        pos = 0
        for lesson in m.get("lessons") or []:
            await self.lesson(module, lesson, pos)
            pos += 1
        if m.get("quiz"):
            a = await self.quiz(m["quiz"], course_id=course.id)
            await self.quiz_lesson(module, a, m["quiz"]["title"], pos)
        return module

    # ------------------------------------------------------------------ top-level kinds

    async def apply_course(self, data: dict[str, Any]) -> Course:
        from app.models.tenancy import Organisation
        from app.modules.billing.plans import check_limit

        org = await self.db.get(Organisation, self.org_id)
        await check_limit(self.db, org, "max_courses")
        difficulty = str(data.get("difficulty") or "beginner").lower()
        course = self._add(
            Course(
                organisation_id=self.org_id,
                slug=await self.unique_slug(data["title"]),
                title=data["title"][:255],
                subtitle=(data.get("subtitle") or None) and data["subtitle"][:255],
                description=data.get("description", ""),
                difficulty=difficulty if difficulty in DIFFICULTIES else "beginner",
                duration_minutes=int(data.get("duration_minutes") or 0),
                learning_objectives=data.get("learning_objectives") or [],
                prerequisites=data.get("prerequisites") or [],
                target_audience=data.get("audience") or None,
                tags=["ai-generated"],
                status=CourseStatus.DRAFT,
                created_by=self.user_id,
                instructor_id=self.user_id,
                ai_generated=True,
            ),
            "courses",
        )
        await self.db.flush()
        position = 0
        modules: list[CourseModule] = []
        for m in data.get("modules") or []:
            modules.append(await self.module_from(course, m, position))
            position += 1
        if data.get("assignments") and modules:
            target = modules[-1]
            pos = await self.next_lesson_position(target.id)
            for a in data["assignments"]:
                asg = await self.assignment(a, course_id=course.id)
                self._add(
                    Lesson(
                        organisation_id=self.org_id,
                        course_id=course.id,
                        module_id=target.id,
                        title=f"Practical: {a['title']}"[:255],
                        lesson_type="assignment",
                        content=self._validated("assignment", {}),
                        duration_minutes=45,
                        position=pos,
                        assignment_id=asg.id,
                        ai_generated=True,
                    ),
                    "lessons",
                )
                pos += 1
            await self.db.flush()
        if data.get("final_assessment") or data.get("flashcards") or data.get("revision_notes"):
            final = self._add(
                CourseModule(
                    organisation_id=self.org_id,
                    course_id=course.id,
                    title="Review and final assessment",
                    position=position,
                ),
                "modules",
            )
            await self.db.flush()
            pos = 0
            if data.get("revision_notes"):
                await self.notes_lesson(final, data["revision_notes"], pos)
                pos += 1
            if data.get("flashcards"):
                await self.flashcards_lesson(final, data["flashcards"], pos)
                pos += 1
            if data.get("final_assessment"):
                a = await self.quiz(data["final_assessment"], course_id=course.id, kind="final")
                await self.quiz_lesson(final, a, data["final_assessment"]["title"], pos)
        await self.db.flush()
        return course

    async def apply_scenario(self, data: dict[str, Any], course_id: uuid.UUID | None) -> Simulation:
        from app.models.tenancy import Organisation
        from app.modules.billing.plans import check_limit

        org = await self.db.get(Organisation, self.org_id)
        await check_limit(self.db, org, "max_simulations")
        if course_id is not None:
            await self.course(course_id)
        # The hidden root cause stays in the generation record (builder input), never in learner text.
        desc = "\n\n".join(
            filter(
                None,
                [
                    data.get("description"),
                    f"Learner role: {data.get('learner_role')}" if data.get("learner_role") else "",
                    "Objectives:\n" + "\n".join(f"- {o}" for o in data.get("objectives") or [])
                    if data.get("objectives")
                    else "",
                ],
            )
        )
        sim = self._add(
            Simulation(
                organisation_id=self.org_id,
                title=data["title"][:255],
                description=desc,
                industry=str(data.get("industry") or "it")[:64],
                environment_type=str(data.get("environment_type") or "helpdesk")[:64],
                course_id=course_id,
                status="draft",
                created_by=self.user_id,
                ai_generated=True,
            ),
            "simulations",
        )
        await self.db.flush()
        return sim


async def apply_output(
    db: AsyncSession,
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    kind: str,
    data: dict[str, Any],
    course_id: uuid.UUID | None,
    module_id: uuid.UUID | None,
) -> tuple[str, uuid.UUID, dict[str, int], str]:
    """Returns (entity_type, entity_id, created_counts, link)."""
    ap = Applier(db, org_id, user_id)
    if kind == "course":
        c = await ap.apply_course(data)
        return "course", c.id, dict(ap.created), f"/app/instructor/courses/{c.id}"
    if kind == "quiz":
        if course_id is not None:
            await ap.course(course_id)
        a = await ap.quiz(data, course_id=course_id)
        return "assessment", a.id, dict(ap.created), f"/app/instructor/assessments/{a.id}"
    if kind == "assignment":
        if course_id is not None:
            await ap.course(course_id)
        a = await ap.assignment(data, course_id=course_id)
        return "assignment", a.id, dict(ap.created), f"/app/instructor/assignments/{a.id}"
    if kind == "rubric":
        r = await ap.rubric(data)
        return "rubric", r.id, dict(ap.created), f"/app/instructor/rubrics/{r.id}"
    if kind == "scenario":
        s = await ap.apply_scenario(data, course_id)
        return "simulation", s.id, dict(ap.created), f"/app/instructor/simulations/{s.id}/builder"
    course = await ap.course(course_id)
    if kind == "module":
        m = await ap.module_from(course, data, await ap.next_module_position(course.id))
        return "module", m.id, dict(ap.created), f"/app/instructor/courses/{course.id}"
    module = await ap.module(course, module_id)
    pos = await ap.next_lesson_position(module.id)
    if kind == "lesson":
        row = await ap.lesson(module, data, pos)
        if data.get("knowledge_check") and any(
            q.get("type") not in ("multiple_choice", "multiple_select")
            for q in data["knowledge_check"].get("questions") or []
        ):
            a = await ap.quiz(data["knowledge_check"], course_id=course.id)
            await ap.quiz_lesson(module, a, data["knowledge_check"]["title"], pos + 1)
    elif kind == "flashcards":
        row = await ap.flashcards_lesson(module, data, pos)
    elif kind == "revision_notes":
        row = await ap.notes_lesson(module, data, pos)
    elif kind == "case_study":
        row = await ap.case_study_lesson(module, data, pos)
    else:
        raise BadRequest(f"Cannot apply generation kind '{kind}'")
    return "lesson", row.id, dict(ap.created), f"/app/instructor/courses/{course.id}"
