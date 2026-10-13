"""Offline provider quality checks: embeddings, tutor answers, generation, grading, plans, characters."""

from __future__ import annotations

import json
import math

import pytest

from praxis_ai import prompts
from praxis_ai.generation import GENERATION_KINDS, SCHEMAS, build_template, schema_hint, validate_output
from praxis_ai.jsonutil import parse_json_object
from praxis_ai.providers import OfflineProvider
from praxis_ai.text import cosine

P = OfflineProvider(embedding_dim=1536)

DNS_DOC = (
    "DNS translates hostnames into IP addresses. When the DNS server is unreachable or returns a wrong "
    "record, users cannot reach websites by name even though the network itself is working. Clearing the "
    "DNS cache and checking the configured resolver are common first steps."
)
PRINTER_DOC = (
    "Printer jams are cleared by opening tray two and removing crumpled paper. Toner is replaced yearly."
)


async def test_embeddings_dimension_normalised_and_semantic():
    r = await P.embed([DNS_DOC, PRINTER_DOC, "Why can't users reach websites when DNS fails?"])
    assert r.model == "offline-hash-embedding" and all(len(v) == 1536 for v in r.vectors)
    for v in r.vectors:
        assert math.isclose(math.sqrt(sum(x * x for x in v)), 1.0, rel_tol=1e-6)
    dns, printer, q = r.vectors
    assert cosine(q, dns) > cosine(q, printer) + 0.15
    again = await P.embed([DNS_DOC])
    assert again.vectors[0] == dns  # deterministic


async def test_tutor_explain_extractive_with_citations():
    system = prompts.tutor_system(mode="explain", course="Helpdesk 101")
    user = prompts.tutor_user_message(
        question="Why would DNS cause this problem?",
        passages=[
            {"title": "Printers", "content": PRINTER_DOC},
            {"title": "Networking basics", "heading": "DNS", "content": DNS_DOC},
        ],
        lesson_text=None,
        profile={"skill_gaps": ["root-cause analysis"]},
    )
    r = await P.chat([{"role": "system", "content": system}, {"role": "user", "content": user}])
    assert r.model == "offline-demo" and r.provider == "offline"
    assert "[2]" in r.text and "IP addresses" in r.text and "Toner" not in r.text
    assert r.tokens_in > 0 and r.tokens_out > 0


async def test_tutor_hint_does_not_quote_material():
    system = prompts.tutor_system(mode="hint", course="Helpdesk 101", graded=["Simulation: outage"])
    user = prompts.tutor_user_message(
        question="What is the root cause? Why would DNS cause this?",
        passages=[{"title": "Networking", "content": DNS_DOC}],
        lesson_text=None,
        profile=None,
    )
    r = await P.chat([{"role": "system", "content": system}, {"role": "user", "content": user}])
    assert "hint" in r.text.lower()
    for sentence in DNS_DOC.split(". "):
        assert sentence[:60] not in r.text


async def test_tutor_no_sources():
    system = prompts.tutor_system(mode="explain", course="X", knowledge_only=True)
    user = prompts.tutor_user_message(
        question="Explain quantum chromodynamics", passages=[], lesson_text=None, profile=None
    )
    r = await P.chat([{"role": "system", "content": system}, {"role": "user", "content": user}])
    assert "couldn't find" in r.text


@pytest.mark.parametrize("kind", GENERATION_KINDS)
async def test_generation_all_kinds_schema_valid(kind):
    inputs = {
        "subject": "Incident management",
        "audience": "IT support staff",
        "difficulty": "intermediate",
        "objectives": ["Triage incidents", "Communicate with users"],
        "weeks": 2,
        "industry": "Banking",
        "question_count": 4,
        "question_types": ["multiple_choice", "true_false", "short_answer"],
    }
    system = prompts.generation_system(kind)
    prompt = prompts.generation_prompt(kind, inputs, schema_hint(kind))
    r = await P.chat(
        [{"role": "system", "content": system}, {"role": "user", "content": prompt}], json_mode=True
    )
    data = parse_json_object(r.text)
    validated = validate_output(kind, data)
    assert validated
    if kind == "course":
        assert len(validated["modules"]) == 2 and validated["modules"][0]["week"] == 1
        assert validated["modules"][0]["title"] == "Triage incidents"
        assert validated["assignments"][0]["rubric"]["criteria"]
        q = validated["final_assessment"]["questions"][0]
        assert q["answer_key"] and q["explanation"]


async def test_generation_grounded_in_source_and_feedback():
    inputs = {"subject": "Password policy", "question_count": 3, "question_types": ["short_answer"]}
    src = (
        "Passwords must be at least fourteen characters long. Multi-factor authentication is mandatory for "
        "remote access. Passwords are never shared over email."
    )
    prompt = prompts.generation_prompt(
        "quiz", inputs, schema_hint("quiz"), feedback="Make it harder", source_text=src
    )
    r = await P.chat(
        [
            {"role": "system", "content": prompts.generation_system("quiz")},
            {"role": "user", "content": prompt},
        ]
    )
    quiz = validate_output("quiz", json.loads(r.text))
    assert any("_____" in q["prompt"] for q in quiz["questions"])
    assert "revised" in quiz["description"]


def test_schema_validation_rejects_bad_answer_keys():
    bad = build_template("quiz", {"subject": "x" * 5})
    bad["questions"][0]["answer_key"] = {"choice_ids": ["zzz"]}
    with pytest.raises(ValueError):
        SCHEMAS["quiz"].model_validate(bad)


async def test_grading_heuristic_discriminates_and_explains():
    assignment = {
        "title": "DNS outage",
        "instructions": "1. Investigate the outage\n2. Identify the root cause\n"
        "3. Propose a fix and verify it",
        "expected_output": "DNS resolver misconfigured; fix resolver setting, flush cache, verify name resolution.",
        "rubric": {
            "criteria": [
                {
                    "id": "inv",
                    "name": "Investigation",
                    "description": "Collects logs, symptoms and scope of the outage",
                    "weight": 1,
                    "levels": [{"score": 0, "label": "None"}, {"score": 4, "label": "Full"}],
                },
                {
                    "id": "rc",
                    "name": "Root cause",
                    "description": "Identifies the DNS resolver misconfiguration",
                    "weight": 2,
                    "levels": [{"score": 0, "label": "None"}, {"score": 4, "label": "Full"}],
                },
            ]
        },
        "required_evidence": [{"id": "notes", "label": "Notes", "type": "text", "required": True}],
    }
    good = (
        "I investigated the outage by collecting logs and symptoms from affected users and checked the scope: "
        "only name resolution failed. The root cause was a DNS resolver misconfiguration on the DHCP scope. "
        "I fixed the resolver setting, flushed the DNS cache and verified name resolution with nslookup. "
        "Users confirmed access was restored and I documented the change."
    )
    poor = "I restarted the computer and it was fine."
    sys = prompts.grading_system()
    rg = await P.chat(
        [
            {"role": "system", "content": sys},
            {"role": "user", "content": prompts.grading_prompt(assignment, good)},
        ]
    )
    rp = await P.chat(
        [
            {"role": "system", "content": sys},
            {"role": "user", "content": prompts.grading_prompt(assignment, poor)},
        ]
    )
    g, p = json.loads(rg.text), json.loads(rp.text)
    assert g["score"] >= 70 and p["score"] <= 40, (g["score"], p["score"])
    crit = {c["criterion_id"]: c for c in g["criteria"]}
    assert crit["rc"]["max"] == 4 and crit["rc"]["evidence"] and "resolver" in crit["rc"]["evidence"][0]
    assert p["weaknesses"] and p["improvements"] and p["missing_requirements"]
    assert 0 < g["confidence"] <= 0.5 and g["summary"]


def test_grading_heuristic_summary_matches_breakdown_score():
    """The quoted overall score, the returned score and the weighted breakdown agree, even when
    requirements are missing (they are listed, not silently deducted)."""
    from praxis_ai.grading import heuristic_grade_submission

    assignment = {
        "instructions": "1. Capture ipconfig output\n2. Escalate to the network team\n3. Notify the users",
        "rubric": {
            "criteria": [
                {"id": "rc", "name": "Root cause", "description": "DHCP scope exhausted", "weight": 70},
                {"id": "doc", "name": "Documentation", "description": "Clear timeline", "weight": 30},
            ]
        },
        "required_evidence": [{"id": "shot", "label": "Screenshot", "type": "screenshot", "required": True}],
        "provided_evidence": [],
    }
    text = (
        "The root cause was an exhausted DHCP scope, so new laptops self-assigned 169.254 addresses. I wrote "
        "a clear timeline of what happened, when, and what I changed, and extended the scope by fifty leases."
    )
    g = heuristic_grade_submission(assignment, text)
    assert g["missing_requirements"]
    acc = 0.0  # the platform recomputes the score from the breakdown with a running sum
    for c in g["criteria"]:
        acc += c["weight"] * (c["score"] / c["max"])
    expected = round(100 * acc / sum(c["weight"] for c in g["criteria"]), 1)
    assert g["score"] == expected
    assert f"({g['score']:g}/100)" in g["summary"] and "not clearly met" in g["summary"]


async def test_answer_grading():
    q = {
        "prompt": "Explain why verification matters after a fix.",
        "reference": "Verification confirms the fix resolved the issue and introduced no side effects.",
    }
    sys = prompts.answer_grading_system()
    good = await P.chat(
        [
            {"role": "system", "content": sys},
            {
                "role": "user",
                "content": prompts.answer_grading_prompt(
                    q,
                    "Verification confirms the fix actually resolved the issue for the user and that there are no side "
                    "effects elsewhere in the system, so we avoid reopening the ticket.",
                ),
            },
        ]
    )
    bad = await P.chat(
        [
            {"role": "system", "content": sys},
            {"role": "user", "content": prompts.answer_grading_prompt(q, "Because.")},
        ]
    )
    assert json.loads(good.text)["score_fraction"] > json.loads(bad.text)["score_fraction"]


async def test_plan_and_character():
    profile = {
        "weak_skills": [{"name": "Root-cause analysis", "proficiency": 40}],
        "strong_skills": [{"name": "Incident identification", "proficiency": 88}],
        "recommendations": [
            {
                "title": "Lesson: 5 whys",
                "kind": "lesson",
                "target_id": "abc",
                "skill": "Root-cause analysis",
                "reason": "weak",
            }
        ],
        "avg_score": 50,
        "attempts": 3,
    }
    r = await P.chat(
        [
            {"role": "system", "content": prompts.plan_system()},
            {"role": "user", "content": prompts.plan_prompt(profile)},
        ]
    )
    plan = json.loads(r.text)
    assert (
        "understand Incident identification but need additional practice in Root-cause analysis"
        in plan["summary"]
    )
    assert plan["difficulty_adjustment"]["direction"] == "easier"
    assert plan["steps"][0]["activities"][0]["target_id"] == "abc"

    sys = prompts.character_system("Alex", "an office worker", "stressed")
    msg = prompts.character_prompt(
        ["My screen says no internet since 9am", "Colleagues have the same issue"],
        "Do your colleagues have the same issue?",
        {"name": "Alex"},
    )
    r = await P.chat([{"role": "system", "content": sys}, {"role": "user", "content": msg}])
    assert "Colleagues have the same issue" in r.text


async def test_stream_chat_default_implementation():
    pieces = [
        p async for p in P.stream_chat([{"role": "user", "content": "Hello world. Second sentence here."}])
    ]
    assert "".join(pieces).startswith("[Offline demo]")
