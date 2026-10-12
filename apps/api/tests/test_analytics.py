"""Analytics: numbers on a known seeded data set, permissions, tenant isolation, date ranges, platform view."""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.core.db import get_sessionmaker
from app.models.ai import AIUsage
from app.models.identity import User
from app.models.platform import Payment
from tests.factories import add_member, signup
from tests.ops_seed import seed_scenario, tenant_session, today

API = "/api/v1/analytics"


@pytest.fixture
async def scenario(client):
    admin = await signup(client, org_name="Analytics Org")
    sc = await seed_scenario(admin.org_id, admin.user_id)
    return admin, sc


async def test_learner_me(client, scenario):
    admin, sc = scenario
    l2 = sc.learners[1]
    r = await client.get(f"{API}/learner/me", headers=l2.headers)
    assert r.status_code == 200, r.text
    d = r.json()
    s = d["summary"]
    assert s["enrolments"] == 1 and s["in_progress"] == 1 and s["overdue"] == 1 and s["completed"] == 0
    assert s["completion_rate"] == 0.0 and s["time_spent_seconds"] == 1800
    assert s["attempts"] == 1 and s["avg_attempt_pct"] == pytest.approx(33.3, abs=0.1)
    assert s["attempt_pass_rate"] == 0.0 and s["simulations_completed"] == 1 and s["avg_simulation_score"] == 60.0
    assert s["avg_assignment_score"] == 45.0 and s["active_days_30d"] == 1
    assert d["courses"][0]["title"] == "Network Security 101" and d["courses"][0]["overdue"] is True
    kinds = sorted(x["kind"] for x in d["scores_over_time"])
    assert kinds == ["assessment", "assignment", "simulation"]
    assert d["skills"][0]["proficiency"] == 50.0
    weak = d["weak_areas"]
    assert weak["by_tag"] == [{"tag": "security", "answered": 2, "incorrect": 2, "error_rate": 100.0}]
    assert weak["by_skill"][0]["skill"] == "Firewall configuration" and weak["by_skill"][0]["incorrect"] == 1
    assert len(weak["most_missed_questions"]) == 2
    dims = {x["dimension"]: x["avg_score"] for x in d["simulations"]["by_dimension"]}
    assert dims == {"diagnosis": 40.0, "communication": 70.0}
    assert len(d["time_spent"]["daily_30d"]) == 30 and d["time_spent"]["daily_30d"][-1]["seconds"] == 120
    assert d["attempts"][0]["passed"] is False


async def test_learner_permissions_and_isolation(client, scenario):
    admin, sc = scenario
    l1, l2, _ = sc.learners
    assert (await client.get(f"{API}/learner/{l1.user_id}", headers=l2.headers)).status_code == 403
    r = await client.get(f"{API}/learner/{l1.user_id}", headers=admin.headers)
    assert r.status_code == 200 and r.json()["summary"]["completed"] == 1
    assert r.json()["simulations"]["by_dimension"][0]["avg_score"] in (80.0, 90.0)
    auditor = await add_member(admin.org_id, "auditor")
    assert (await client.get(f"{API}/learner/me", headers=auditor.headers)).status_code == 403
    assert (await client.get(f"{API}/organisation", headers=auditor.headers)).status_code == 200
    other = await signup(client, org_name="Other Analytics Org")
    assert (await client.get(f"{API}/learner/{l1.user_id}", headers=other.headers)).status_code == 404
    assert (await client.get(f"{API}/courses/{sc.course.id}", headers=other.headers)).status_code == 404
    org = (await client.get(f"{API}/organisation", headers=other.headers)).json()
    assert org["summary"]["enrolments"] == 0 and org["skill_gaps"] == []


async def test_course_analytics(client, scenario):
    admin, sc = scenario
    r = await client.get(f"{API}/courses/{sc.course.id}", headers=admin.headers)
    assert r.status_code == 200, r.text
    d = r.json()
    e = d["enrolments"]
    assert (e["total"], e["completed"], e["in_progress"], e["not_started"], e["overdue"]) == (3, 1, 1, 1, 1)
    assert e["completion_rate"] == pytest.approx(33.3, abs=0.1) and e["avg_final_score"] == 90.0

    m1, m2 = d["funnel"]
    assert m1["lessons_count"] == 2 and m1["learners_completed"] == 2 and m2["learners_completed"] == 1
    l3 = m2["lessons"][0]
    assert l3["started"] == 2 and l3["completed"] == 1
    assert m1["lessons"][0]["completion_rate"] == pytest.approx(66.7, abs=0.1)

    q = {x["question_id"]: x for x in d["questions"]}
    q1, q2, q3 = (str(i) for i in sc.question_ids)
    assert q[q2]["p_value"] == pytest.approx(0.333, abs=0.001) and q[q2]["difficulty"] == "hard"
    assert q[q2]["discrimination"] == pytest.approx(1.0, abs=0.001)
    assert q[q1]["p_value"] == pytest.approx(0.667, abs=0.001) and q[q1]["discrimination"] == pytest.approx(0.5, abs=0.01)
    assert d["questions"][0]["question_id"] == q2  # hardest first
    assert d["most_failed_questions"][0]["question_id"] == q2 and d["most_failed_questions"][0]["incorrect"] == 2

    a = d["assessments"][0]
    assert a["attempts"] == 3 and a["learners"] == 3 and a["pass_rate"] == pytest.approx(33.3, abs=0.1)
    asg = d["assignments"][0]
    assert asg["submissions"] == 2 and asg["avg_score"] == 65.0 and asg["pass_rate"] == 50.0
    dist = {b["bucket"]: b["count"] for b in asg["distribution"]}
    assert dist["0-49"] == 1 and dist["80-89"] == 1 and sum(dist.values()) == 2
    sim = d["simulations"][0]
    assert sim["completed"] == 2 and sim["avg_score"] == 75.0 and sim["bands"] == {"expert": 1, "developing": 1}
    assert {x["dimension"]: x["avg_score"] for x in sim["dimensions"]} == {"diagnosis": 60.0, "communication": 80.0}

    overview = (await client.get(f"{API}/courses", headers=admin.headers)).json()["items"]
    assert overview[0]["course_id"] == str(sc.course.id) and overview[0]["enrolments"] == 3


async def test_organisation_analytics(client, scenario):
    admin, sc = scenario
    r = await client.get(f"{API}/organisation", headers=admin.headers)
    assert r.status_code == 200, r.text
    d = r.json()
    s = d["summary"]
    assert s["members"] == 4 and s["enrolments"] == 3 and s["completed"] == 1 and s["overdue"] == 1
    assert s["active_learners_30d"] == 2 and s["hours_learned"] == 1.5
    c = d["compliance"]
    assert (c["assigned"], c["completed_on_time"], c["overdue"], c["pending"]) == (2, 1, 1, 0)
    assert c["compliance_rate"] == 50.0
    gaps = d["skill_gaps"]
    assert len(gaps) == 1
    g = gaps[0]
    assert g["competency"] == "Network Admin" and g["learners"] == 4 and g["assessed"] == 2
    assert g["meeting"] == 1 and g["below"] == 3 and g["avg_proficiency"] == 65.0 and g["gap"] == 5.0
    depts = {x["department"]: x for x in d["departments"]}
    assert depts["Operations"]["members"] == 2 and depts["Operations"]["completed"] == 1
    assert depts["Unassigned"]["members"] == 2
    trend = d["active_learners_trend"]
    assert len(trend) == 30 and trend[-1]["active_learners"] == 2 and trend[-2]["active_learners"] == 1
    perf = {x["full_name"]: x for x in d["employee_performance"]}
    assert perf["Learner 1"]["completed"] == 1 and perf["Learner 1"]["avg_assessment_pct"] == 100.0
    assert perf["Learner 2"]["overdue"] == 1 and perf["Learner 2"]["department"] == "Operations"
    assert d["top_performers"][0]["full_name"] == "Learner 1"

    # department filter
    r = await client.get(f"{API}/organisation", params={"department_id": str(sc.department_id)},
                         headers=admin.headers)
    d = r.json()
    assert d["summary"]["members"] == 2 and d["summary"]["enrolments"] == 2
    assert d["skill_gaps"][0]["learners"] == 2 and d["skill_gaps"][0]["meeting"] == 1

    # date range in the future excludes everything enrolment-based
    future = (today() + timedelta(days=10)).isoformat()
    r = await client.get(f"{API}/organisation", params={"start": future}, headers=admin.headers)
    assert r.json()["summary"]["enrolments"] == 0
    bad = await client.get(f"{API}/organisation", params={"start": future, "end": today().isoformat()},
                           headers=admin.headers)
    assert bad.status_code == 400
    learner = sc.learners[0]
    assert (await client.get(f"{API}/organisation", headers=learner.headers)).status_code == 403


async def test_platform_requires_superadmin(client, scenario):
    admin, sc = scenario
    assert (await client.get(f"{API}/platform", headers=admin.headers)).status_code == 403
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        user = await s.get(User, admin.user_id)
        user.is_superadmin = True
        await s.commit()
    from datetime import UTC, datetime
    from decimal import Decimal

    async with tenant_session(admin.org_id) as s:
        s.add(Payment(organisation_id=admin.org_id, stripe_invoice_id="in_platform_1", amount_cents=4900,
                      status="paid", paid_at=datetime.now(UTC)))
        s.add(AIUsage(organisation_id=admin.org_id, created_at=datetime.now(UTC), feature="tutor",
                      provider="openai", model="gpt-4o-mini", tokens_in=10, tokens_out=5, cost_usd=Decimal("1.5")))
    r = await client.get(f"{API}/platform", headers=admin.headers)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["organisations"]["total"] >= 1 and d["users"]["total"] >= 4
    assert d["revenue"]["paid_in_range_cents"] >= 4900
    assert any(o["organisation_id"] == str(admin.org_id) for o in d["ai_usage"]["by_organisation"])
    assert d["ai_usage"]["cost_usd"] >= 1.5 and "latency_ms" in d["api"]
    assert d["courses"]["total"] >= 1 and d["activity"]["attempts"] >= 3
