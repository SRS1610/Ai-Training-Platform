"""The demo seeder: organisations, people, content and ~90 days of learning activity.

Business logic always goes through real code paths: the in-process HTTP API (as the relevant user, with a
Bearer token and ``X-Organisation-Id``) or, for template installation, the simulations service. Direct model
writes are limited to what has no API: the super-admin flag, e-mail verification, backdating (see
``timeline.py``), historical AI usage, subscriptions and Stripe payments, and the seed marker.
"""

from __future__ import annotations

import io
import random
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import update

from app.core.db import get_sessionmaker, system_session
from app.models.identity import User
from app.seed import content_courses as CC
from app.seed import content_it as IT
from app.seed import people as P
from app.seed.api import Actor, Api
from app.seed.content_kb import DOCUMENTS, MINIMAL_DOCUMENTS
from app.seed.qb import api_payload, respond
from app.seed.sims import PATHS, as_request
from app.seed.timeline import Timeline, days_ago, utcnow
from app.workers import drain

OVERRIDE_REASONS = [
    "The AI under-credited the communication log: updates went to Level 3 staff and the Finance manager "
    "with times and a plain-language all-clear. Raised Stakeholder communication.",
    "The screenshot shows the 169.254 address and failed gateway ping that the AI said were missing; "
    "evidence criterion adjusted accordingly.",
    "Root cause is correct (uplink failure after the firmware update, VLAN 30 not trunked); the AI "
    "penalised wording rather than substance.",
]


@dataclass
class Lesson:
    id: str
    title: str
    kind: str  # lesson | quiz | simulation | assignment | final
    module: int
    linked: str | None = None  # assessment / simulation / assignment id
    duration: int = 10
    v2_only: bool = False


@dataclass
class Course:
    key: str
    id: str
    title: str
    lessons: list[Lesson] = field(default_factory=list)
    assessments: list[str] = field(default_factory=list)  # module quiz ids, in module order
    final_id: str | None = None
    sim_id: str | None = None
    sim_template: str | None = None
    assignment_id: str | None = None

    def lessons_for(self, version: int) -> list[Lesson]:
        return [x for x in self.lessons if version >= 2 or not x.v2_only]


@dataclass
class Learner:
    actor: Actor
    slug: str
    skill: float
    profile: str = "none"
    dept: str | None = None


class Seeder:
    def __init__(self, api: Api, profile: str = "full", log: Callable[[str], None] = print) -> None:
        self.api = api
        self.profile = profile
        self.full = profile == "full"
        self.log = log
        self.tl = Timeline()
        self.now = utcnow()
        self.today = self.now.date()
        self.rng = random.Random(20261012)
        self.questions: dict[str, dict[str, Any]] = {}  # question id → spec
        self.skills: dict[str, str] = {}
        self.courses: dict[str, Course] = {}
        self.staff: dict[str, Actor] = {}
        self.learners: dict[str, Learner] = {}
        self.depts: dict[str, str] = {}
        self.teams: dict[str, str] = {}
        self.paths: dict[str, str] = {}
        self.org_ids: list[uuid.UUID] = []
        self.user_ids: list[uuid.UUID] = []
        self.summary: dict[str, Any] = {"accounts": []}
        self._override_n = 0

    # ------------------------------------------------------------------------------------------ helpers

    def d(self, days: float, hour: int = 9, minute: int = 0) -> datetime:
        return days_ago(days, hour, minute, now=self.now)

    def due(self, days_from_today: int) -> str:
        return (self.today + timedelta(days=days_from_today)).isoformat()

    async def span(self, days: float, hour: int = 9, minutes: float = 30, minute: int = 0) -> None:
        await self.tl.begin(self.d(days, hour, minute), minutes)

    async def end_span(self) -> None:
        await self.tl.end()

    def _account(self, email: str, name: str, role: str, org: str) -> None:
        self.summary["accounts"].append({"email": email, "name": name, "role": role, "org": org})

    # ====================================================================================== orgs

    async def setup(self) -> None:
        api = self.api
        await self.span(400, 8, 60)
        sa = await api.register(P.SUPERADMIN["email"], P.PASSWORD, P.SUPERADMIN["full_name"], None)
        async with get_sessionmaker()() as s:
            s.info["rls_bypass"] = True
            await s.execute(update(User).where(User.id == sa.user_id).values(is_superadmin=True))
            await s.commit()
        self.superadmin = sa
        self.user_ids.append(sa.user_id)
        self.org_ids.append(sa.org_id)
        self._account(sa.email, sa.full_name, "super admin (platform)", "Praxis platform")

        # Northwind
        await self.span(150, 9, 90)
        email, name, _roles, _dept, title = P.STAFF["admin"]
        admin = await api.register(email, P.PASSWORD, name, P.NORTHWIND["name"])
        self.nw = admin.org_id
        self.org_ids.append(self.nw)
        self.user_ids.append(admin.user_id)
        self.staff["admin"] = admin
        await api.patch(
            f"/platform/organisations/{self.nw}/plan",
            sa,
            {"plan_code": P.NORTHWIND["plan"], "seats": P.NORTHWIND["seats"]},
        )
        await api.patch(
            "/organisations/current",
            admin,
            {"branding": P.NORTHWIND["branding"], "settings": P.NORTHWIND["settings"]},
        )
        for dname, desc in P.DEPARTMENTS:
            r = await api.post("/departments", admin, {"name": dname, "description": desc})
            self.depts[dname] = r["id"]
        self._account(admin.email, admin.full_name, "org_admin", P.NORTHWIND["name"])
        for key in ("manager", "instructor", "sme", "assessor", "auditor"):
            email, name, roles, dept, title = P.STAFF[key]
            body = {
                "email": email,
                "full_name": name,
                "roles": roles,
                "job_title": title,
                "password": P.PASSWORD,
                "send_email": False,
            }
            if dept:
                body["department_id"] = self.depts[dept]
            r = await api.post("/users", admin, body)
            self.staff[key] = Actor(
                email, name, uuid.UUID(r["user_id"] if "user_id" in r else r["id"]), "", self.nw, tuple(roles)
            )
            self._account(email, name, roles[0], P.NORTHWIND["name"])
        await api.patch(f"/users/{admin.user_id}", admin, {"job_title": P.STAFF["admin"][4]})
        await api.patch(
            f"/departments/{self.depts['IT Service Desk']}",
            admin,
            {"manager_user_id": str(self.staff["manager"].user_id)},
        )
        await self.end_span()

        # Learners join over time (most at launch, a few recent hires).
        learners = [x for x in P.LEARNERS if self.full or x[0] in P.MINIMAL_LEARNERS]
        new_hires = {"meilin.zhang", "tomas.garcia"}
        await self.span(148, 10, 60)
        await self._create_learner("alex", P.ALEX[0], P.ALEX[1], P.ALEX[2], P.ALEX[3], P.ALEX[4], "alex")
        for slug, name, dept, title, team, profile in learners:
            if slug not in new_hires:
                await self._create_learner(slug, f"{slug}@northwind.demo", name, dept, title, team, profile)
        await self.end_span()
        if any(x[0] in new_hires for x in learners):
            await self.span(9, 9, 30)
            for slug, name, dept, title, team, profile in learners:
                if slug in new_hires:
                    await self._create_learner(
                        slug, f"{slug}@northwind.demo", name, dept, title, team, profile
                    )
            await self.end_span()

        # Teams
        await self.span(147, 11, 30)
        for tname, dname, desc in P.TEAMS:
            lead = self.staff["assessor"].user_id if dname == "IT Service Desk" else None
            body: dict[str, Any] = {"name": tname, "description": desc, "department_id": self.depts[dname]}
            if lead:
                body["lead_user_id"] = str(lead)
            r = await api.post("/teams", admin, body)
            self.teams[tname] = r["id"]
            members = [
                lr.actor.user_id for lr in self.learners.values() if lr.actor.meta.get("team") == tname
            ]
            if members:
                await api.post(f"/teams/{r['id']}/members", admin, {"user_ids": [str(m) for m in members]})
        await self.end_span()

        # Sign everyone in (sessions are real "today" logins).
        for a in self.staff.values():
            if not a.token:
                logged = await api.login(a.email, P.PASSWORD, a.full_name, self.nw)
                a.token = logged.token
            self.user_ids.append(a.user_id)
        for lr in self.learners.values():
            logged = await api.login(lr.actor.email, P.PASSWORD, lr.actor.full_name, self.nw)
            lr.actor.token = logged.token
            self.user_ids.append(lr.actor.user_id)

        # Contoso Training Co (second tenant)
        await self.span(120, 10, 60)
        c = P.CONTOSO
        cadmin = await api.register(c["admin"][0], P.PASSWORD, c["admin"][1], c["name"])
        self.contoso = cadmin.org_id
        self.org_ids.append(self.contoso)
        self.user_ids.append(cadmin.user_id)
        await api.patch(
            f"/platform/organisations/{self.contoso}/plan", sa, {"plan_code": c["plan"], "seats": c["seats"]}
        )
        await api.patch("/organisations/current", cadmin, {"branding": c["branding"]})
        self.c_admin = cadmin
        self._account(cadmin.email, cadmin.full_name, "org_admin", c["name"])
        self.c_users: dict[str, Actor] = {}
        for key, role in (("trainer", "instructor"), ("learner", "learner")):
            email, name, title = c[key]
            r = await api.post(
                "/users",
                cadmin,
                {
                    "email": email,
                    "full_name": name,
                    "roles": [role],
                    "job_title": title,
                    "password": P.PASSWORD,
                    "send_email": False,
                },
            )
            self.c_users[key] = Actor(email, name, uuid.UUID(r.get("user_id") or r["id"]), "", self.contoso)
            self.user_ids.append(self.c_users[key].user_id)
            self._account(email, name, role, c["name"])
        await self.end_span()
        for a in self.c_users.values():
            a.token = (await api.login(a.email, P.PASSWORD, a.full_name, self.contoso)).token

        # Individual learner with a personal workspace
        await self.span(62, 10, 30)
        solo = await api.register(P.SOLO[0], P.PASSWORD, P.SOLO[1], None)
        self.solo = solo
        self.org_ids.append(solo.org_id)
        self.user_ids.append(solo.user_id)
        self._account(
            solo.email, solo.full_name, "individual learner (personal workspace)", "Personal workspace"
        )
        await self.end_span()
        self.log(f"  orgs and {len(self.user_ids)} users ready")

    async def _create_learner(
        self, slug: str, email: str, name: str, dept: str, title: str, team: str | None, profile: str
    ) -> None:
        admin = self.staff["admin"]
        r = await self.api.post(
            "/users",
            admin,
            {
                "email": email,
                "full_name": name,
                "roles": ["learner"],
                "department_id": self.depts[dept],
                "job_title": title,
                "password": P.PASSWORD,
                "send_email": False,
            },
        )
        uid = uuid.UUID(r.get("user_id") or r["id"])
        actor = Actor(email, name, uid, "", self.nw, ("learner",), {"team": team})
        skill = {
            "cert_v1": 0.82,
            "cert_v2": 0.8,
            "retake": 0.66,
            "progress_v1": 0.76,
            "progress_v2": 0.68,
            "overdue": 0.5,
            "not_started": 0.66,
            "none": 0.7,
            "alex": 0.72,
        }.get(profile, 0.75)
        skill += self.rng.uniform(-0.05, 0.05)
        self.learners[slug] = Learner(actor, slug, skill, profile, dept)
        if slug == "alex":
            self._account(email, name, "learner (main demo learner)", P.NORTHWIND["name"])

    # =================================================================================== content

    async def skills_and_kb(self) -> None:
        api, admin, inst = self.api, self.staff["admin"], self.staff["instructor"]
        await self.span(140, 10, 40)
        all_skills = list(IT.SKILLS)
        for spec in (CC.CYBER, CC.CUSTOMER_SERVICE, CC.WHS, CC.PRIVACY):
            all_skills += spec["skills"]
        for name, desc in all_skills:
            cat = (
                "Technical"
                if name in dict(IT.SKILLS) and name != "Customer Communication"
                else "Professional"
            )
            r = await api.post("/skills", admin, {"name": name, "category": cat, "description": desc})
            self.skills[name] = r["id"]
        await api.put("/ai/config", admin, {"monthly_budget_usd": 250, "alert_thresholds": [50, 75, 90, 100]})
        await self.end_span()

        await self.span(130, 13, 90)
        docs = DOCUMENTS if self.full else MINIMAL_DOCUMENTS
        ids = []
        for doc in docs:
            r = await api.post(
                "/knowledge/documents/text",
                inst,
                {"title": doc["title"], "text": doc["text"], "category": doc["category"]},
            )
            ids.append(r["id"])
        await drain()
        for doc_id in ids:
            await api.post(f"/knowledge/documents/{doc_id}/approve", admin)
        await self.end_span()
        self.kb_doc_ids = ids

    def _skill_ids(self, names: list[str]) -> list[str]:
        return [self.skills[n] for n in names if n in self.skills]

    async def _bank(self, actor: Actor, course_id: str, title: str, specs: list[dict[str, Any]]) -> str:
        bank = await self.api.post(
            "/question-banks",
            actor,
            {"title": title, "course_id": course_id, "description": f"Question bank for {title}."},
        )
        payload = []
        for q in specs:
            p = api_payload(q)
            p["skill_ids"] = self._skill_ids(q.get("_skills", []))
            payload.append(p)
        r = await self.api.post(f"/question-banks/{bank['id']}/import", actor, {"questions": payload})
        for qid, spec in zip(r["question_ids"], specs, strict=True):
            self.questions[str(qid)] = spec
        return bank["id"]

    async def _quiz(self, actor: Actor, course_id: str, title: str, bank_id: str, n: int, **kw: Any) -> str:
        body = {
            "title": title,
            "course_id": course_id,
            "kind": "quiz",
            "description": kw.pop(
                "description", f"{n} questions. Pass mark {kw.get('pass_percentage', 70)}%."
            ),
            "time_limit_minutes": 20,
            "max_attempts": 3,
            "pass_percentage": 70,
            "shuffle_questions": True,
            "shuffle_options": True,
            "grading_mode": "ai_assisted",
            "show_feedback": "after_submit",
            "items": [{"bank_id": bank_id, "draw_count": n, "weight": 1}],
        }
        body.update(kw)
        a = await self.api.post("/assessments", actor, body)
        await self.api.post(f"/assessments/{a['id']}/publish", actor)
        return a["id"]

    async def _install_sim(self, template: str, course_id: str, skills: list[str], actor: Actor) -> str:
        from app.modules.simulations.service import install_template

        async with system_session(self.nw) as db:
            sim = await install_template(db, self.nw, template, actor.user_id)
            sim_id = str(sim.id)
        await self.api.patch(
            f"/simulations/{sim_id}",
            actor,
            {
                "course_id": course_id,
                "max_attempts": 3,
                "is_graded": True,
                "skill_ids": self._skill_ids(skills),
            },
        )
        return sim_id

    async def _api_sim(self, template: str, course_id: str, skills: list[str], actor: Actor) -> str:
        sim = await self.api.post(
            "/simulations/from-template", actor, {"template_key": template, "course_id": course_id}
        )
        await self.api.patch(
            f"/simulations/{sim['id']}", actor, {"max_attempts": 3, "skill_ids": self._skill_ids(skills)}
        )
        await self.api.post(f"/simulations/{sim['id']}/publish", actor)
        return sim["id"]

    async def _lesson(
        self,
        actor: Actor,
        course: Course,
        module_id: str,
        mi: int,
        spec: dict[str, Any],
        links: dict[str, str | None],
        v2_only: bool = False,
    ) -> Lesson:
        kind = spec.get("kind", "lesson")
        body: dict[str, Any] = {
            k: v for k, v in spec.items() if k not in ("kind", "skills", "activities", "key", "template")
        }
        body["skill_ids"] = self._skill_ids(spec.get("skills", []))
        linked = None
        if kind in ("quiz", "final"):
            body["lesson_type"] = "quiz"
            linked = links["final"] if kind == "final" else links["quiz"]
            body["assessment_id"] = linked
            body.setdefault(
                "content",
                {
                    "body_markdown": "Check your understanding of this module. You can retake the quiz if "
                    "you don't pass first time.",
                    "instructions": "Answer every question, then submit. Your best score counts.",
                },
            )
            body.setdefault("duration_minutes", 15)
        elif kind == "simulation":
            body["lesson_type"] = "simulation"
            linked = links["sim"]
            body["simulation_id"] = linked
        elif kind == "assignment":
            body["lesson_type"] = "assignment"
            linked = links["assignment"]
            body["assignment_id"] = linked
        r = await self.api.post(f"/courses/{course.id}/modules/{module_id}/lessons", actor, body)
        for act in spec.get("activities", []):
            await self.api.post(f"/courses/{course.id}/lessons/{r['id']}/activities", actor, act)
        lesson = Lesson(
            r["id"], spec["title"], kind, mi, linked, int(body.get("duration_minutes", 10)), v2_only
        )
        course.lessons.append(lesson)
        return lesson

    async def flagship(self) -> None:
        api, inst, sme = self.api, self.staff["instructor"], self.staff["sme"]
        await self.span(125, 9, 300)
        body = dict(IT.COURSE)
        body["skill_ids"] = self._skill_ids([n for n, _ in IT.SKILLS])
        body["instructor_id"] = str(inst.user_id)
        r = await api.post("/courses", inst, body)
        course = Course("it", r["id"], r["title"])
        self.courses["it"] = course
        banks = []
        for mi, mod in enumerate(IT.MODULES):
            title, specs = mod["bank"]
            banks.append(await self._bank(sme if mi in (3, 4) else inst, course.id, title, specs))
        await self.end_span()

        await self.span(121, 10, 240)
        for mi, mod in enumerate(IT.MODULES):
            n = len(mod["bank"][1])
            course.assessments.append(
                await self._quiz(
                    inst,
                    course.id,
                    f"Module {mi + 1} Quiz: {mod['title']}",
                    banks[mi],
                    n,
                    description=f"{n} questions on {mod['title'].lower()}, including one written answer "
                    "marked by the AI assistant. Pass mark 70%, three attempts.",
                )
            )
        final = await api.post(
            "/assessments",
            inst,
            {
                "title": "IT Support Troubleshooting Fundamentals – Final Assessment",
                "course_id": course.id,
                "kind": "final",
                "description": "18 questions drawn at random from every module's question bank. "
                "45 minutes, two attempts, pass mark 75%.",
                "time_limit_minutes": 45,
                "max_attempts": 2,
                "pass_percentage": 75,
                "shuffle_questions": True,
                "shuffle_options": True,
                "grading_mode": "auto",
                "show_feedback": "after_submit",
                "high_stakes": True,
                "weight_in_course": 2,
                "items": [
                    {
                        "bank_id": b,
                        "draw_count": k,
                        "weight": 1,
                        "filters": {"question_types": IT.OBJECTIVE_TYPES},
                    }
                    for b, k in zip(banks, IT.FINAL_POOL_DRAWS, strict=True)
                ],
            },
        )
        await api.post(f"/assessments/{final['id']}/publish", inst)
        course.final_id = final["id"]
        rubric = await api.post("/rubrics", inst, IT.RUBRIC)
        asg = dict(IT.ASSIGNMENT)
        asg.update(
            {
                "course_id": course.id,
                "rubric_id": rubric["id"],
                "skill_ids": self._skill_ids(
                    ["Customer Communication", "Networking Fundamentals", "Troubleshooting Methodology"]
                ),
            }
        )
        a = await api.post("/assignments", inst, asg)
        await api.post(f"/assignments/{a['id']}/publish", inst)
        course.assignment_id = a["id"]
        course.sim_template = "it-helpdesk-network"
        course.sim_id = await self._install_sim(
            course.sim_template,
            course.id,
            ["Networking Fundamentals", "DNS", "Troubleshooting Methodology", "Customer Communication"],
            inst,
        )
        await self.end_span()

        await self.span(118, 9, 360)
        for mi, mod in enumerate(IT.MODULES):
            m = await api.post(
                f"/courses/{course.id}/modules",
                inst,
                {"title": mod["title"], "description": mod["description"]},
            )
            links = {
                "quiz": course.assessments[mi],
                "final": course.final_id,
                "sim": course.sim_id,
                "assignment": course.assignment_id,
            }
            for spec in mod["lessons"]:
                lesson = await self._lesson(inst, course, m["id"], mi, spec, links)
                if spec.get("key") == "dns_resolution":
                    self.dns_lesson = lesson
            if mi == 4:
                self.dns_module_id = m["id"]
        await self.end_span()

        await self.span(110, 14, 30)
        await api.post(
            f"/courses/{course.id}/publish",
            inst,
            {
                "changelog": "Initial release: seven modules, "
                "module quizzes, the helpdesk simulation, the practical write-up and the final assessment."
            },
        )
        await self.end_span()
        self.log(f"  flagship course: {len(course.lessons)} lessons, {len(self.questions)} questions")

    async def flagship_v2(self) -> None:
        """Instructor edits the course and publishes version 2 (learners enrolled earlier stay on v1)."""
        api, inst = self.api, self.staff["instructor"]
        course = self.courses["it"]
        await self.span(31, 10, 120)
        await api.patch(
            f"/courses/{course.id}/lessons/{self.dns_lesson.id}",
            inst,
            {"content": {"body_markdown": IT.M5_RESOLUTION_V1 + "\n" + IT.M5_RESOLUTION_V2_EXTRA}},
        )
        r = await api.post(
            f"/courses/{course.id}/modules/{self.dns_module_id}/lessons",
            inst,
            {
                **{k: v for k, v in IT.V2_NEW_LESSON.items() if k != "skills"},
                "skill_ids": self._skill_ids(IT.V2_NEW_LESSON["skills"]),
                "position": 2,
            },
        )
        new = Lesson(r["id"], r["title"], "lesson", 4, None, 10, True)
        idx = course.lessons.index(self.dns_lesson) + 2
        course.lessons.insert(idx, new)
        await api.patch(
            f"/assessments/{course.final_id}",
            inst,
            {
                "description": "18 questions drawn at random from every module's question bank. You have "
                "45 minutes from the moment you start; unanswered questions score zero. Two attempts, pass "
                "mark 75%."
            },
        )
        await self.end_span()
        await self.span(30, 9, 20)
        await api.post(f"/courses/{course.id}/publish", inst, {"changelog": IT.V2_CHANGELOG})
        await self.end_span()

    async def build_course(
        self,
        key: str,
        spec: dict[str, Any],
        actor: Actor,
        days: float,
        *,
        publish: bool = True,
        sim_via_api: bool = True,
        org: uuid.UUID | None = None,
    ) -> Course:
        api = self.api
        await self.span(days, 9, 240)
        body = dict(spec["course"])
        body.setdefault("sequential", False)
        if spec.get("skills"):
            body["skill_ids"] = self._skill_ids([n for n, _ in spec["skills"]])
        if (org or self.nw) == self.nw:
            body["instructor_id"] = str(actor.user_id)
        r = await api.post("/courses", actor, body)
        course = Course(key, r["id"], r["title"])
        self.courses[key] = course
        quiz_id = None
        if spec.get("bank"):
            title, specs = spec["bank"]
            bank = await self._bank(actor, course.id, title, specs)
            pass_pct = int(spec["course"].get("pass_threshold", 70))
            quiz_id = await self._quiz(
                actor,
                course.id,
                spec["modules"][-1]["lessons"][-1]["title"],
                bank,
                len(specs),
                pass_percentage=pass_pct,
                grading_mode="ai_assisted",
            )
            course.assessments.append(quiz_id)
        for mi, mod in enumerate(spec["modules"]):
            m = await api.post(
                f"/courses/{course.id}/modules",
                actor,
                {"title": mod["title"], "description": mod.get("description")},
            )
            for ls in mod["lessons"]:
                if ls.get("kind") == "simulation":
                    course.sim_template = ls["template"]
                    course.sim_id = await self._api_sim(
                        ls["template"], course.id, ls.get("skills", []), actor
                    )
                await self._lesson(
                    actor,
                    course,
                    m["id"],
                    mi,
                    ls,
                    {"quiz": quiz_id, "final": None, "sim": course.sim_id, "assignment": None},
                )
        await self.end_span()
        if publish:
            await self.span(days - 2, 15, 20)
            await api.post(f"/courses/{course.id}/publish", actor, {"changelog": "Initial release."})
            await self.end_span()
        return course

    async def other_content(self) -> None:
        inst = self.staff["instructor"]
        await self.build_course("cs", CC.CUSTOMER_SERVICE, inst, 100)
        if self.full:
            await self.build_course("cyber", CC.CYBER, inst, 95)
            await self.build_course("whs", CC.WHS, inst, 90)
            await self.build_course("privacy", CC.PRIVACY, inst, 88)
            # Archived legacy course (published long ago, retired this quarter)
            legacy = await self.build_course("win7", CC.ARCHIVED_WIN7, inst, 145)
            await self.span(45, 11, 10)
            await self.api.post(f"/courses/{legacy.id}/archive", self.staff["admin"])
            await self.end_span()
            # Instructor's work-in-progress draft
            await self.build_course("itil_draft", CC.DRAFT_ITIL, inst, 6, publish=False)
            # Learning paths
            await self.span(85, 10, 30)
            manager = self.staff["manager"]
            for key, title, desc, courses in (
                (
                    "onboarding",
                    "New Service Desk Analyst Onboarding",
                    "Everything a new analyst needs in their first 60 days: troubleshooting fundamentals, "
                    "customer service, workplace safety and privacy.",
                    ["it", "cs", "whs", "privacy"],
                ),
                (
                    "soc",
                    "SOC Analyst Pathway",
                    "From solid IT fundamentals to triaging and containing security incidents.",
                    ["it", "cyber", "privacy"],
                ),
            ):
                r = await self.api.post(
                    "/learning-paths",
                    manager,
                    {
                        "title": title,
                        "description": desc,
                        "status": "published",
                        "items": [{"course_id": self.courses[c].id, "is_required": True} for c in courses],
                    },
                )
                self.paths[key] = r["id"]
            await self.end_span()
            # Contoso's own course
            trainer = self.c_users["trainer"]
            await self.build_course("contoso", CC.CONTOSO_ONBOARDING, trainer, 110, org=self.contoso)
            # Solo learner's personal course
            await self.build_course("solo", CC.SOLO_COURSE, self.solo, 60, org=self.solo.org_id)
        self.log(f"  {len(self.courses)} courses built")

    # =========================================================================== learner actions

    async def assign(self, key: str, learners: list[Learner], days: float, due_in: int | None) -> None:
        await self.span(days, 8, 10)
        body: dict[str, Any] = {
            "course_id": self.courses[key].id,
            "user_ids": [str(x.actor.user_id) for x in learners],
        }
        if due_in is not None:
            body["due_date"] = self.due(due_in)
        await self.api.post("/enrolments/assign", self.staff["manager"], body)
        await self.end_span()

    async def self_enrol(self, lr: Learner, key: str, days: float) -> None:
        await self.span(days, 0, 5)
        await self.api.post("/enrolments", lr.actor, {"course_id": self.courses[key].id})
        await self.end_span()

    async def complete(self, lr: Learner, lesson: Lesson) -> None:
        await self.api.post(f"/progress/lessons/{lesson.id}/complete", lr.actor)

    async def take_quiz(
        self, lr: Learner, assessment_id: str, target: str | None, pass_pct: float = 70
    ) -> dict[str, Any]:
        """Start an attempt, answer every question and submit.

        ``target``: pass | fail | ace | None (skill-based)."""
        att = await self.api.post(f"/assessments/{assessment_id}/attempts", lr.actor, expect=(200, 201))
        qs = att["questions"]
        plan: list[bool] = []
        for q in qs:
            spec = self.questions[str(q["id"])]
            p = lr.skill - 0.15 * (spec.get("difficulty", 2) - 2)
            plan.append(self.rng.random() < p)
        difficulty = [self.questions[str(q["id"])].get("difficulty", 2) for q in qs]

        def expected(pl: list[bool]) -> float:
            got = tot = 0.0
            for q, ok in zip(qs, pl, strict=True):
                spec = self.questions[str(q["id"])]
                pts = float(q.get("points") or 1)
                tot += pts
                if spec["question_type"] == "long_answer":
                    got += pts * (0.75 if ok else 0.2)
                elif spec["question_type"] in ("multiple_select", "matching", "ordering", "fill_blank"):
                    got += pts if ok else pts * 0.5  # partial credit
                else:
                    got += pts if ok else 0.0
            return 100 * got / tot if tot else 0

        # Learners who need to pass fix their mistakes on the easier questions first, so the hard ones stay
        # the weak spots in item analysis; failing attempts lose the hard questions first.
        easy_first = sorted(range(len(qs)), key=lambda i: (difficulty[i], self.rng.random()))
        if target == "ace":
            plan = [True] * len(qs)
        elif target == "pass":
            goal = pass_pct + self.rng.uniform(1, 10)
            for i in easy_first:
                if expected(plan) >= goal:
                    break
                plan[i] = True
        elif target == "fail":
            for i in reversed(easy_first):
                if expected(plan) < pass_pct - 10:
                    break
                plan[i] = False
        for q, ok in zip(qs, plan, strict=True):
            spec = self.questions[str(q["id"])]
            await self.api.put(
                f"/attempts/{att['id']}/answers/{q['id']}",
                lr.actor,
                {"response": respond(spec, ok, self.rng)},
            )
        out = await self.api.post(f"/attempts/{att['id']}/submit", lr.actor)
        if out["status"] != "graded":
            await drain()
            out = await self.api.get(f"/attempts/{att['id']}/result", lr.actor)
        return out

    async def pass_quiz(self, lr: Learner, assessment_id: str, pass_pct: float = 70) -> dict[str, Any]:
        out = await self.take_quiz(lr, assessment_id, "pass", pass_pct)
        if not out.get("passed"):  # the AI-marked written answer scored lower than planned: retake
            out = await self.take_quiz(lr, assessment_id, "ace", pass_pct)
        return out

    async def play_sim(
        self,
        lr: Learner,
        sim_id: str,
        template: str,
        level: str,
        *,
        use_chat: bool = False,
        pause_at: int | None = None,
    ) -> dict[str, Any]:
        """Play a simulation through the action endpoints. With ``pause_at`` the session is left active after
        that many steps (resume with :meth:`resume_sim`)."""
        sess = await self.api.post(f"/simulations/{sim_id}/sessions", lr.actor, {})
        return await self.resume_sim(
            lr,
            {"session_id": sess["id"], "next": 0, "seq": 1},
            template,
            level,
            use_chat=use_chat,
            stop=pause_at,
        )

    async def resume_sim(
        self,
        lr: Learner,
        cursor: dict[str, Any],
        template: str,
        level: str,
        *,
        use_chat: bool = False,
        stop: int | None = None,
    ) -> dict[str, Any]:
        steps = PATHS[template][level]
        session_id, seq = cursor["session_id"], cursor["seq"]
        status = "active"
        i = cursor["next"]
        while i < (len(steps) if stop is None else stop):
            st = steps[i]
            if use_chat and st[0] == "chat":
                r = await self.api.post(
                    f"/simulation-sessions/{session_id}/chat",
                    lr.actor,
                    {"character_id": st[1], "message": st[2], "client_seq": seq},
                )
            else:
                r = await self.api.post(
                    f"/simulation-sessions/{session_id}/actions", lr.actor, as_request(st, seq)
                )
            seq = (
                int(r["seq"]) + 1
            )  # rejected actions (e.g. failed preconditions) don't consume a sequence number
            status = r["status"]
            i += 1
            if status != "active":
                break
        if stop is not None and status == "active":
            return {"session_id": session_id, "status": "active", "next": i, "seq": seq}
        if status == "active":
            return await self.api.post(f"/simulation-sessions/{session_id}/finish", lr.actor)
        return await self.api.get(f"/simulation-sessions/{session_id}/result", lr.actor)

    def _screenshot(self, lr: Learner) -> bytes:
        from PIL import Image, ImageDraw

        host = f"SYD-L3-{self.rng.randint(100, 999):04d}"
        last_octets = f"{self.rng.randint(1, 254)}.{self.rng.randint(1, 254)}"
        lines = [
            f"C:\\Users\\{lr.slug.split('.')[0]}> ipconfig /all",
            "",
            "Windows IP Configuration",
            f"   Host Name . . . . . . . . . . . . : {host}",
            "",
            "Ethernet adapter Ethernet:",
            "   Connection-specific DNS Suffix  . : corp.local",
            "   DHCP Enabled. . . . . . . . . . . : Yes",
            f"   Autoconfiguration IPv4 Address. . : 169.254.{last_octets}(Preferred)",
            "   Subnet Mask . . . . . . . . . . . : 255.255.0.0",
            "   Default Gateway . . . . . . . . . :",
            "",
            f"C:\\Users\\{lr.slug.split('.')[0]}> ping 10.20.30.1",
            "Request timed out.",
            "Request timed out.",
            f"Captured {self.d(self.rng.randint(1, 60)).strftime('%d %b %Y')} 08:52 by {lr.actor.full_name}",
        ]
        img = Image.new("RGB", (760, 22 + 18 * len(lines)), (12, 12, 12))
        draw = ImageDraw.Draw(img)
        for i, line in enumerate(lines):
            draw.text((12, 10 + 18 * i), line, fill=(204, 204, 204))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    async def submit_assignment(self, lr: Learner, quality: int) -> str:
        course = self.courses["it"]
        f = await self.api.post(
            "/files",
            lr.actor,
            files={"file": (f"ipconfig-{lr.slug}.png", self._screenshot(lr), "image/png")},
            data={"purpose": "submission"},
        )
        text_ = IT.REPORTS[quality].format(name=lr.actor.full_name)
        await self.api.put(
            f"/assignments/{course.assignment_id}/submission",
            lr.actor,
            {"text_content": text_, "file_ids": [f["id"]]},
        )
        r = await self.api.post(f"/assignments/{course.assignment_id}/submission/submit", lr.actor)
        await drain()  # AI recommendation
        return r["id"]

    async def grade(
        self, submission_id: str, quality: int, *, override_note: str | None = None
    ) -> dict[str, Any]:
        from app.modules.assignments import logic

        grace = self.staff["assessor"]
        detail = await self.api.get(f"/grading/submissions/{submission_id}", grace)
        crits = [c for c in detail["assignment"]["rubric"]["criteria"]]
        levels = {4: [4, 4, 4, 3, 4], 3: [3, 3, 3, 3, 3], 2: [2, 2, 3, 2, 2], 1: [1, 1, 2, 1, 1]}[quality]
        if override_note:
            levels = [min(4, x + 1) if i in (0, 2) else x for i, x in enumerate(levels)]
        comments = {
            "root_cause": "Links the APIPA addresses to the failed uplink and VLAN trunk clearly.",
            "process": "Scoping by floor and wired-only was exactly right.",
            "resolution": "Verification with users is documented.",
            "communication": "Good cadence of updates to the business.",
            "documentation": "Easy to follow timeline.",
        }
        scores = [
            {"criterion_id": c["id"], "score": s, "comment": comments.get(c["id"])}
            for c, s in zip(crits, levels, strict=True)
        ]
        pct, _, _ = logic.score_rubric(crits, scores)
        ai = detail.get("ai_recommendation")
        body: dict[str, Any] = {
            "rubric_scores": scores,
            "summary": {
                4: "Excellent, thorough resolution record.",
                3: "Solid report that meets the standard.",
                2: "The basics are there but evidence and communication need work.",
                1: "Too brief to be useful to another analyst.",
            }[quality],
            "strengths": ["Correct root cause"] if quality >= 3 else ["Identified the APIPA symptom"],
            "improvements": []
            if quality == 4
            else ["Include command output as evidence", "Add a timestamped communication log"],
        }
        breakdown = (ai or {}).get("rubric_breakdown") or []
        if quality == 4 and not override_note and len(breakdown) == len(crits):
            # The assessor agrees with the AI recommendation and confirms its criterion scores.
            body["rubric_scores"] = [
                {"criterion_id": x["criterion_id"], "score": x["score"], "comment": x.get("comment")}
                for x in breakdown
            ]
            body["summary"] = "Agree with the AI recommendation: an excellent, thorough resolution record."
            pct, _, _ = logic.score_rubric(crits, body["rubric_scores"])
        ai_pct = float(ai["score"]) / float(ai["max_score"] or 100) * 100 if ai else None
        if ai_pct is not None and abs(ai_pct - pct) > 1e-9:
            self._override_n += 1
            body["override_reason"] = (
                override_note or OVERRIDE_REASONS[self._override_n % len(OVERRIDE_REASONS)]
            )
        return await self.api.post(f"/grading/submissions/{submission_id}/grade", grace, body)

    async def tutor(
        self,
        lr: Learner,
        course_key: str | None,
        questions: list[str],
        lesson_id: str | None = None,
        title: str | None = None,
    ) -> str:
        body: dict[str, Any] = {}
        if course_key:
            body["course_id"] = self.courses[course_key].id
        if lesson_id:
            body["lesson_id"] = lesson_id
        if title:
            body["title"] = title
        s = await self.api.post("/ai/tutor/sessions", lr.actor, body)
        for q in questions:
            await self.api.post(f"/ai/tutor/sessions/{s['id']}/messages", lr.actor, {"content": q})
        return s["id"]

    # ================================================================================== journeys

    async def walk(
        self,
        lr: Learner,
        key: str,
        *,
        version: int,
        start_day: float,
        end_day: float,
        upto: int | None = None,
        quiz_fail: set[int] | frozenset[int] = frozenset(),
        sim_levels: tuple[str, ...] = ("competent",),
        assignment_quality: int = 3,
        final_fail_first: bool = False,
        override: str | None = None,
        per_session: int = 3,
    ) -> None:
        """Walk a learner through a course's lessons in order (up to ``upto`` lessons), spreading sessions
        evenly between ``start_day`` and ``end_day`` days ago."""
        course = self.courses[key]
        lessons = course.lessons_for(version)
        if upto is not None:
            lessons = lessons[:upto]
        if not lessons:
            return
        n_sessions = max(1, (len(lessons) + per_session - 1) // per_session)
        step = (start_day - end_day) / max(1, n_sessions - 1) if n_sessions > 1 else 0
        hours = [1, 3, 5, 7, 9, 10]  # UTC: 12:00–21:00 in Sydney, so local and UTC dates agree
        for si in range(n_sessions):
            day = start_day - si * step
            chunk = lessons[si * per_session : (si + 1) * per_session]
            minutes = sum(x.duration for x in chunk) + 10
            await self.span(day, self.rng.choice(hours), minutes, self.rng.randint(0, 50))
            for lesson in chunk:
                await self._do_lesson(
                    lr,
                    course,
                    lesson,
                    quiz_fail,
                    sim_levels,
                    assignment_quality,
                    final_fail_first,
                    override,
                    day,
                )
            await self.end_span()

    async def _do_lesson(
        self,
        lr: Learner,
        course: Course,
        lesson: Lesson,
        quiz_fail: Any,
        sim_levels: tuple[str, ...],
        quality: int,
        final_fail_first: bool,
        override: str | None,
        day: float,
    ) -> None:
        if lesson.kind == "lesson":
            await self.complete(lr, lesson)
        elif lesson.kind == "quiz":
            if lesson.module in quiz_fail:
                await self.take_quiz(lr, lesson.linked, "fail")
            await self.pass_quiz(lr, lesson.linked, self._pass_pct(course, lesson))
        elif lesson.kind == "final":
            if final_fail_first:
                await self.take_quiz(lr, lesson.linked, "fail", 75)
            await self.pass_quiz(lr, lesson.linked, 75)
        elif lesson.kind == "simulation":
            for level in sim_levels:
                await self.play_sim(lr, course.sim_id, course.sim_template, level)
        elif lesson.kind == "assignment":
            sub = await self.submit_assignment(lr, quality)
            await self.end_span()
            await self.span(max(day - 1.2, 0.2), 15, 20)  # assessor grades the next working day
            await self.grade(sub, quality, override_note=override)
            await self.end_span()
            await self.span(max(day - 1.3, 0.15), 18, 30)

    def _pass_pct(self, course: Course, lesson: Lesson) -> float:
        return {"whs": 80, "privacy": 80}.get(course.key, 70)

    # ------------------------------------------------------------------------------------------ stories

    async def journeys(self) -> None:
        L = self.learners
        it = "it"
        by_profile: dict[str, list[Learner]] = {}
        for lr in L.values():
            by_profile.setdefault(lr.profile, []).append(lr)

        # ---- version 1 cohort (enrolled before v2 was published) -----------------------------
        wave1 = by_profile.get("cert_v1", [])
        if wave1:
            await self.assign(it, wave1, 86, -50)
        if by_profile.get("progress_v1"):
            await self.assign(it, by_profile["progress_v1"], 85, 14)
        overdue = by_profile.get("overdue", [])
        if overdue:
            await self.assign(it, overdue, 60, -12)

        await self.flagship_v2()

        # ---- stories, v1 learners --------------------------------------------------------------
        story_v1 = {
            "sofia.martinez": dict(start_day=84, end_day=58, sim_levels=("expert",), assignment_quality=4),
            "liam.oconnor": dict(
                start_day=83,
                end_day=52,
                quiz_fail={2},
                sim_levels=("fail", "advanced"),
                assignment_quality=3,
                override="AI under-scored the root cause analysis: the report "
                "correctly ties the APIPA addresses to the VLAN trunk failure. Raised to Exemplary.",
            ),
            "rajesh.iyer": dict(
                start_day=82, end_day=49, quiz_fail={4}, sim_levels=("competent",), assignment_quality=3
            ),
        }
        for slug, kw in story_v1.items():
            if slug in L:
                await self.walk(L[slug], it, version=1, **kw)
        if "aisha.rahman" in L:
            n = len(self.courses[it].lessons_for(1))
            await self.walk(
                L["aisha.rahman"],
                it,
                version=1,
                start_day=80,
                end_day=3,
                upto=n - 7,
                sim_levels=("advanced",),
                per_session=2,
            )
        if "noah.kowalski" in L:
            await self.walk(L["noah.kowalski"], it, version=1, start_day=58, end_day=45, upto=3)
            await self.span(44, 16, 15)
            await self.take_quiz(L["noah.kowalski"], self.courses[it].assessments[0], "fail")
            await self.end_span()
        if "isabella.rossi" in L:
            await self.walk(
                L["isabella.rossi"], it, version=1, start_day=57, end_day=21, upto=11, quiz_fail={1, 2}
            )

        # ---- version 2 cohort -----------------------------------------------------------------
        cert_v2 = by_profile.get("cert_v2", [])
        if cert_v2:
            await self.assign(it, cert_v2, 28, 14)
        if "hannah.schmidt" in L:
            await self.assign(it, [L["hannah.schmidt"]], 27, 7)
        prog_v2 = [
            x
            for x in by_profile.get("progress_v2", [])
            if x.slug not in ("emma.johansson", "zara.ahmed", "jack.robinson")
        ]
        if prog_v2:
            await self.assign(it, prog_v2, 25, 20)
        if self.full:
            soc = [L[s] for s in ("emma.johansson", "zara.ahmed", "yusuf.demir") if s in L]
            await self.span(26, 9, 10)
            await self.api.post(
                f"/learning-paths/{self.paths['soc']}/enrol",
                self.staff["manager"],
                {"user_ids": [str(x.actor.user_id) for x in soc], "due_date": self.due(45)},
            )
            await self.end_span()
            await self.self_enrol(L["jack.robinson"], it, 18)
        if "alex" in L:
            await self.assign(it, [L["alex"]], 21, 5)

        for slug, kw in {
            "chloe.dubois": dict(start_day=27, end_day=12, sim_levels=("expert",), assignment_quality=4),
            "yusuf.demir": dict(
                start_day=25, end_day=11, quiz_fail={1}, sim_levels=("advanced",), assignment_quality=3
            ),
            "hannah.schmidt": dict(
                start_day=26,
                end_day=8,
                sim_levels=("needs_improvement", "competent"),
                assignment_quality=3,
                final_fail_first=True,
                quiz_fail={5},
            ),
        }.items():
            if slug in L:
                await self.walk(L[slug], it, version=2, **kw)
        for slug, upto, s0, s1, fail in (
            ("ethan.walker", 8, 24, 2, {1}),
            ("kwame.mensah", 4, 23, 15, {0}),
            ("emma.johansson", 14, 24, 4, {2}),
            ("zara.ahmed", 3, 22, 18, set()),
            ("jack.robinson", 8, 17, 6, {0}),
        ):
            if slug in L:
                levels = ("needs_improvement",) if slug == "emma.johansson" else ("competent",)
                await self.walk(
                    L[slug],
                    it,
                    version=2,
                    start_day=s0,
                    end_day=s1,
                    upto=upto,
                    quiz_fail=fail,
                    sim_levels=levels,
                )

        # Work waiting in the assessor's queue (AI recommendation ready, human grade pending).
        for slug, day, quality in (("aisha.rahman", 2, 4), ("kwame.mensah", 1, 2)):
            if slug in L:
                await self.span(day, 6, 60)
                await self.submit_assignment(L[slug], quality)
                await self.end_span()
        if self.full:
            await self.other_journeys()
        if "alex" in L:
            await self.alex()
        if self.full:
            new_hires = [L[s] for s in ("meilin.zhang", "tomas.garcia") if s in L]
            await self.span(5, 9, 10)
            await self.api.post(
                f"/learning-paths/{self.paths['onboarding']}/enrol",
                self.staff["manager"],
                {"user_ids": [str(x.actor.user_id) for x in new_hires], "due_date": self.due(21)},
            )
            await self.end_span()
            # a little tutor usage from other learners
            if "ethan.walker" in L:
                await self.span(3, 13, 10)
                await self.tutor(
                    L["ethan.walker"],
                    it,
                    [
                        "What does a 169.254 address mean?",
                        "How do I renew a DHCP lease from the command line?",
                    ],
                )
                await self.end_span()

    async def other_journeys(self) -> None:
        L = self.learners
        cs_people = [
            L[s] for s in ("olu.adeyemi", "mia.thompson", "fatima.alsayed", "ben.carter", "sofia.martinez")
        ]
        await self.assign("cs", cs_people, 70, -20)
        for slug, s0, s1, level in (
            ("olu.adeyemi", 68, 55, "expert"),
            ("mia.thompson", 66, 50, "competent"),
            ("sofia.martinez", 45, 40, "advanced"),
        ):
            await self.walk(L[slug], "cs", version=1, start_day=s0, end_day=s1, sim_levels=(level,))
        await self.walk(L["fatima.alsayed"], "cs", version=1, start_day=60, end_day=6, upto=3)
        await self.self_enrol(L["sarah.kim"], "cs", 15)
        await self.walk(L["sarah.kim"], "cs", version=1, start_day=14, end_day=9, upto=2)

        # Cyber: Yusuf (via SOC path) completes; Lucas self-enrols and completes; Emma/Zara in progress.
        await self.walk(L["yusuf.demir"], "cyber", version=1, start_day=10, end_day=4, sim_levels=("expert",))
        await self.self_enrol(L["lucas.silva"], "cyber", 40)
        await self.walk(
            L["lucas.silva"], "cyber", version=1, start_day=39, end_day=30, sim_levels=("fail", "advanced")
        )
        await self.walk(L["emma.johansson"], "cyber", version=1, start_day=6, end_day=2, upto=3)
        await self.walk(L["zara.ahmed"], "cyber", version=1, start_day=12, end_day=8, upto=1)

        # WHS: mandatory for everyone, assigned a month ago, due in 10 days.
        everyone = [lr for lr in L.values() if lr.slug != "alex"]
        await self.assign("whs", everyone, 32, 10)
        done = [
            "sofia.martinez",
            "liam.oconnor",
            "rajesh.iyer",
            "chloe.dubois",
            "yusuf.demir",
            "olu.adeyemi",
            "mia.thompson",
            "sarah.kim",
            "david.nguyen",
            "hannah.schmidt",
            "emma.johansson",
            "ben.carter",
        ]
        for i, slug in enumerate(done):
            if slug in L:
                await self.walk(
                    L[slug],
                    "whs",
                    version=1,
                    start_day=30 - i * 2,
                    end_day=29 - i * 2,
                    quiz_fail={1} if slug == "ben.carter" else set(),
                )
        for slug in ("elena.petrova", "jack.robinson", "aisha.rahman"):
            await self.walk(L[slug], "whs", version=1, start_day=12, end_day=11, upto=1)

        # Privacy: finance + customer success assigned six weeks ago, due last week.
        priv = [L[s] for s in ("sarah.kim", "david.nguyen", "elena.petrova", "fatima.alsayed", "olu.adeyemi")]
        await self.assign("privacy", priv, 44, -5)
        for slug, s0 in (
            ("sarah.kim", 40),
            ("david.nguyen", 37),
            ("fatima.alsayed", 30),
            ("olu.adeyemi", 20),
        ):
            await self.walk(L[slug], "privacy", version=1, start_day=s0, end_day=s0 - 1)
        await self.walk(L["elena.petrova"], "privacy", version=1, start_day=33, end_day=33, upto=1)
        await self.walk(L["yusuf.demir"], "privacy", version=1, start_day=3, end_day=2)

        # Contoso learner and the solo learner
        cl = Learner(self.c_users["learner"], "jordan.ellis", 0.8)
        await self.span(100, 9, 5)
        await self.api.post(
            "/enrolments/assign",
            self.c_admin,
            {
                "course_id": self.courses["contoso"].id,
                "user_ids": [str(cl.actor.user_id)],
                "due_date": self.due(10),
            },
        )
        await self.end_span()
        await self.walk(cl, "contoso", version=1, start_day=20, end_day=4, upto=2, per_session=1)
        solo = Learner(self.solo, "riley.morgan", 0.8)
        await self.self_enrol(solo, "solo", 57)
        await self.walk(solo, "solo", version=1, start_day=56, end_day=50, upto=1)

    async def alex(self) -> None:
        """Alex Chen: rich partial progress, a completed course, simulations across bands, a streak."""
        lr = self.learners["alex"]
        it = self.courses["it"]
        await self.assign("cs", [lr], 36, -14)
        await self.walk(lr, "cs", version=1, start_day=33, end_day=27, sim_levels=("advanced",))
        lessons = it.lessons_for(2)
        idx = {x.id: i for i, x in enumerate(lessons)}
        m4_sim = next(x for x in lessons if x.kind == "simulation")
        # Modules 1–3 and the start of module 4 (lessons before the simulation)
        await self.walk(lr, "it", version=2, start_day=20, end_day=12, upto=idx[m4_sim.id], quiz_fail={2})
        # Simulation attempt 1: needs improvement (11 days ago)
        await self.span(11, 5, 35)
        await self.play_sim(lr, it.sim_id, it.sim_template, "needs_improvement", use_chat=True)
        await self.end_span()
        # Attempt 2 (6 days ago): asks the tutor for help mid-simulation (hint mode), then finishes Competent.
        await self.span(6, 2, 50)
        paused = await self.play_sim(lr, it.sim_id, it.sim_template, "competent", use_chat=True, pause_at=7)
        await self.tutor(
            lr,
            "it",
            ["I've run ipconfig /all and nslookup fails for the intranet. What should I check next?"],
            lesson_id=m4_sim.id,
            title="Stuck on the laptop network ticket",
        )
        await self.resume_sim(lr, paused, it.sim_template, "competent", use_chat=True)
        m4_quiz = lessons[idx[m4_sim.id] + 1]
        await self.pass_quiz(lr, m4_quiz.linked)
        await self.end_span()
        # Module 5, one lesson a day (streak), the DNS tutor conversation, today's lesson in progress.
        m5 = [x for x in lessons if x.module == 4]
        plan = [(5, m5[0]), (4, m5[1]), (2, m5[2])]
        for day, lesson in plan:
            await self.span(day, 8, 25, 10)
            await self.complete(lr, lesson)
            await self.end_span()
        await self.span(3, 9, 20)
        await self.tutor(
            lr,
            "it",
            ["Why would DNS cause this problem?", "How do I check which DNS servers my laptop is using?"],
            lesson_id=m5[0].id,
            title="DNS and the intranet",
        )
        await self.end_span()
        await self.span(1, 8, 25)
        await self.complete(lr, m5[3])  # AI tutor practice lesson
        await self.end_span()
        await self.span(0.08, max(self.now.hour - 2, 0), 20)
        nxt = next(x for x in lessons if x.module == 5)
        await self.api.post(f"/progress/lessons/{nxt.id}/start", lr.actor)
        await self.api.post(
            f"/progress/lessons/{nxt.id}/heartbeat", lr.actor, {"seconds": 95, "position": {"scroll": 0.4}}
        )
        await self.end_span()
        if self.full:
            await self.self_enrol(lr, "cyber", 13)
            await self.walk(lr, "cyber", version=1, start_day=12, end_day=9, upto=2, per_session=1)
            await self.span(8, 7, 25)
            cy = self.courses["cyber"]
            await self.play_sim(lr, cy.sim_id, cy.sim_template, "needs_improvement")
            await self.end_span()
        await self.span(7, 4, 5)
        await self.tutor(
            lr,
            None,
            ["What's the difference between an incident and a service request?"],
            title="ITIL basics",
        )
        await self.end_span()

    # ============================================================================ AI generations

    async def generations(self) -> None:
        inst = self.staff["instructor"]
        api = self.api
        await self.span(16, 10, 30)
        g = await api.post(
            "/ai/generations",
            inst,
            {
                "kind": "course",
                "input": {
                    "subject": "Remote work security basics",
                    "audience": "All Northwind staff working from home",
                    "difficulty": "beginner",
                    "objectives": [
                        "Secure a home network",
                        "Spot phishing on personal devices",
                        "Use the VPN and MFA correctly",
                    ],
                    "weeks": 1,
                    "industry": "Technology",
                    "question_count": 5,
                    "question_types": ["multiple_choice", "true_false", "short_answer"],
                },
            },
        )
        await drain()
        await api.post(
            f"/ai/generations/{g['id']}/approve",
            inst,
            {"notes": "Good structure; tone matches our style guide."},
        )
        await api.post(f"/ai/generations/{g['id']}/apply", inst, {})
        await self.end_span()
        await self.span(2, 15, 10)
        g2 = await api.post(
            "/ai/generations",
            inst,
            {
                "kind": "course",
                "input": {
                    "subject": "Microsoft 365 administration essentials",
                    "audience": "Level 2 service desk analysts",
                    "difficulty": "intermediate",
                    "objectives": [
                        "Manage users and licences",
                        "Troubleshoot mailbox access",
                        "Use the admin centre and PowerShell safely",
                    ],
                    "weeks": 2,
                    "industry": "Technology",
                    "question_count": 6,
                    "question_types": ["multiple_choice", "multiple_select", "true_false", "long_answer"],
                },
            },
        )
        await drain()
        self.pending_generation = g2["id"]
        await self.end_span()

    # ======================================================================================= run

    async def run(self) -> dict[str, Any]:
        t0 = utcnow()
        steps: list[tuple[str, Any]] = [
            ("organisations and people", self.setup),
            ("skills, AI settings and knowledge base", self.skills_and_kb),
            ("flagship course", self.flagship),
            ("supporting courses", self.other_content),
            ("learner journeys", self.journeys),
        ]
        if self.full:
            steps.append(("AI generations", self.generations))
        for label, fn in steps:
            s = utcnow()
            await fn()
            self.log(
                f"[seed] {label}: {(utcnow() - s).total_seconds():.1f}s ({self.api.calls} API calls so far)"
            )
        await drain()
        self.summary["elapsed_build"] = (utcnow() - t0).total_seconds()
        return self.summary
