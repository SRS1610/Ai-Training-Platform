"""Quality of the deterministic (offline / fallback) course generation templates."""

from __future__ import annotations

import pytest

from praxis_ai.generation import (
    GenerationInput,
    build_assignment,
    build_lesson,
    build_quiz,
    build_template,
    reading_minutes,
)

COURSE = {
    "subject": "IT incident management",
    "audience": "new service desk analysts",
    "industry": "IT",
    "weeks": 2,
    "question_count": 8,
    "question_types": ["multiple_choice", "true_false", "short_answer", "long_answer"],
}


def _prompts(quiz: dict) -> list[str]:
    return [q["prompt"] for q in quiz["questions"]]


def _wording(prompt: str) -> str:
    """The question without its topic label (so two topics cannot hide the same question)."""
    return prompt.split(" (Topic: ")[0].lower()


def test_final_assessment_questions_are_unique():
    out = build_template("course", COURSE)
    qs = out["final_assessment"]["questions"]
    assert len(qs) == 8
    assert len({_wording(p) for p in _prompts(out["final_assessment"])}) == 8
    assert {q["type"] for q in qs} == {"multiple_choice", "true_false", "short_answer", "long_answer"}
    for m in out["modules"]:
        assert len(set(map(_wording, _prompts(m["quiz"])))) == len(m["quiz"]["questions"])


@pytest.mark.parametrize(
    "types",
    [["multiple_choice"], ["true_false"], ["multiple_select", "scenario"], ["fill_blank"]],
)
def test_quiz_is_capped_at_unique_questions_instead_of_repeating(types):
    inp = GenerationInput(subject="Incident management", question_count=50, question_types=types)
    quiz = build_quiz(inp, ["Triage incidents", "Communicate with users"])
    wording = [_wording(p) for p in _prompts(quiz)]
    assert 1 <= len(wording) < 50
    assert len(wording) == len(set(wording))
    assert {q["type"] for q in quiz["questions"]} <= set(types) | {"short_answer"}


def test_choice_answer_positions_vary_and_keys_are_valid():
    inp = GenerationInput(subject="DNS", question_count=6, question_types=["multiple_choice"])
    quiz = build_template("quiz", inp.model_dump())
    keys = [q["answer_key"]["choice_ids"][0] for q in quiz["questions"]]
    assert len(set(keys)) > 1


def test_grounded_questions_come_first_and_are_unique():
    src = (
        "Passwords must be at least fourteen characters long. Multi-factor authentication is mandatory "
        "for remote access. Passwords are never shared over email."
    )
    inp = GenerationInput(
        subject="Password policy", question_count=10, question_types=["short_answer"], source_text=src
    )
    quiz = build_quiz(inp, ["Password length", "Remote access"])
    prompts = _prompts(quiz)
    assert prompts[0].startswith("Complete the statement:")
    assert len(prompts) == len(set(map(_wording, prompts)))


def test_assignment_scenario_reads_naturally():
    scenario = build_assignment(GenerationInput(**COURSE))["scenario"]
    assert scenario.startswith(
        "You are part of a team of new service desk analysts at a mid-sized organisation in the IT sector."
    )
    assert "at IT" not in scenario and "work for" not in scenario
    banking = build_assignment(GenerationInput(subject="Payments", industry="Banking"))["scenario"]
    assert "a team of professionals at a mid-sized organisation in the banking sector" in banking
    plain = build_assignment(GenerationInput(subject="Payments"))["scenario"]
    assert "a team of professionals at a mid-sized organisation." in plain


def test_lesson_titles_are_distinct_and_not_tautological():
    out = build_template("module", {"subject": "Incident management", "objectives": ["Triage incidents"]})
    titles = [lesson["title"] for lesson in out["lessons"]]
    assert titles[0] == "Triage incidents" and len(titles) == len(set(titles)) == 3
    assert all("applying it" not in t and "deeper dive" not in t for t in titles)
    bodies = [lesson["body_markdown"] for lesson in out["lessons"]]
    assert len(set(bodies)) == len(bodies)
    # acronyms survive mid-sentence use
    lesson = build_lesson(GenerationInput(subject="IT support"), "IT asset management")
    assert "**IT asset management**" in lesson["body_markdown"]


def test_lesson_duration_derives_from_word_count():
    assert reading_minutes("word " * 10) == 2  # minimum
    assert reading_minutes("word " * 1000) == 5
    assert reading_minutes("word " * 1001) == 6
    lesson = build_lesson(GenerationInput(subject="Networking"), "Subnetting")
    words = len(" ".join([lesson["body_markdown"], *lesson["examples"], *lesson["key_points"]]).split())
    assert lesson["duration_minutes"] == max(2, -(-words // 200))
    course = build_template("course", COURSE)
    assert course["duration_minutes"] == sum(
        lsn["duration_minutes"] for m in course["modules"] for lsn in m["lessons"]
    )
