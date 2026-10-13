"""AI Simulation Builder helpers: prompt, deterministic fallback generator and starter definitions.

The fallback is deliberately capable: IT/network requests adapt the flagship helpdesk template, security and
hospitality requests adapt their templates, and anything else gets a complete, playable fault-diagnosis
skeleton with clearly marked ``[Instructor: …]`` placeholders. Every result is repaired and validated by the
engine and saved as a draft for instructor review: nothing generated is ever auto-published.
"""

from __future__ import annotations

import json
import re
from typing import Any

from simulation_engine import load_template

HELPDESK_WORDS = (
    "dns",
    "network",
    "wifi",
    "wi-fi",
    "internet",
    "connect",
    "helpdesk",
    "help desk",
    "service desk",
    "it support",
    "vpn",
    "intranet",
    "laptop",
    "ip address",
    "ipconfig",
)
SECURITY_WORDS = (
    "phish",
    "soc ",
    "soc analyst",
    "siem",
    "spoof",
    "malicious email",
    "suspicious email",
    "credential harvest",
    "security analyst",
    "email security",
)
HOSPITALITY_WORDS = (
    "restaurant",
    "food safety",
    "allergen",
    "allergy",
    "guest",
    "hospitality",
    "kitchen",
    "waiter",
    "hotel",
    "front of house",
)

STAKEHOLDERS = {
    "healthcare": ("Patient", "Sam Rivera", "Patient"),
    "hospitality": ("Guest", "Daniel Okafor", "Guest"),
    "finance": ("Client", "Morgan Lee", "Client"),
    "retail": ("Customer", "Jordan Blake", "Customer"),
    "cybersecurity": ("Reporter", "Alex Kim", "Staff member"),
    "it": ("Requester", "Alex Morgan", "Employee"),
}

SYSTEM_PROMPT = """[task:simulation_builder]
You design realistic, interactive workplace training simulations as JSON for a deterministic engine.
Rules:
- Follow the schema hint exactly: same top-level keys, ids are snake_case, every reference must exist.
- Hidden ground truth (the root cause) goes ONLY in a variable with "visibility": "secret" and must never be
  interpolated into panels, outputs, messages or facts.
- Characters reveal facts only via actions (effects.reveal) or matching intents. Never put the answer in
  the briefing.
- Include correct, neutral, incorrect and at least one critical action with consequences (time cost, score
  deltas, character reactions) and feedback text.
- Scoring dimension weights must sum to 100.
Return only the JSON object."""


def _contains(text: str, words: tuple[str, ...]) -> bool:
    return any(w in text for w in words)


def detect_difficulty(text: str, default: str = "intermediate") -> str:
    t = text.lower()
    if re.search(r"\b(level 1|l1|beginner|entry[- ]level|basic)\b", t):
        return "beginner"
    if re.search(r"\b(level 3|l3|advanced|senior)\b", t):
        return "advanced"
    if re.search(r"\b(expert|level 4)\b", t):
        return "expert"
    if re.search(r"\b(level 2|l2|intermediate)\b", t):
        return "intermediate"
    return default


_TITLE_VERBS = (
    r"diagnose|resolve|fix|handle|investigate|troubleshoot|respond to|manage|de-escalate|triage|negotiate|"
    r"deal with|contain|recover|escalate|mitigate|debug|configure|secure|deliver|explain|prioriti[sz]e|"
    r"onboard|audit|assess|review|calm|reassure|identify|spot|detect|report|close|run|lead|coach|pitch"
)
# A title stops at the first subordinate clause or punctuation break.
_CLAUSE_BREAK = re.compile(
    r"\s+(?:where|while|whilst|who|whose|which|that|because|so that|when|after|before|until|using|without|"
    r"and then|in order to)\b|[,;:()]|\s[-\u2013\u2014]\s",
    re.I,
)
_TRAILING_WORDS = {
    "a", "an", "the", "of", "to", "with", "and", "or", "for", "in", "on", "at", "from", "by", "as",
    "their", "his", "her", "its", "our", "your", "this", "that",
}  # fmt: skip
_TITLE_MAX_WORDS = 9
_TITLE_MAX_LEN = 70


def _tidy_title(phrase: str) -> str:
    """First clause, at most ~9 words / 70 chars on a word boundary, no dangling articles/prepositions,
    first letter capitalised."""
    phrase = _CLAUSE_BREAK.split(phrase, maxsplit=1)[0].strip(" .!?'\"")
    words = phrase.split()[:_TITLE_MAX_WORDS]
    while words and len(" ".join(words)) > _TITLE_MAX_LEN:
        words.pop()
    while words and words[-1].lower() in _TRAILING_WORDS:
        words.pop()
    title = " ".join(words)
    return title[:1].upper() + title[1:]


def derive_title(description: str, fallback: str) -> str:
    """A short, human title from a free-text brief (used when the author gives none):
    'Create a Level 2 IT helpdesk simulation where the learner must diagnose a DNS problem' → 'Diagnose a DNS
    problem'; 'A phishing awareness exercise for finance staff receiving fake invoices' → 'Phishing awareness
    exercise'. Never the whole description."""
    text = " ".join(description.split())
    m = re.search(
        rf"\b(?:must|has to|have to|needs to|need to|should|will|to|learners?)\s+"
        rf"({_TITLE_VERBS})\s+(.{{3,}})",
        text,
        re.I,
    )
    if m:
        title = _tidy_title(f"{m.group(1)} {m.group(2)}")
        if len(title.split()) >= 2:
            return title
    first = re.split(r"(?<=[a-z0-9)])[.!?](?:\s|$)", text, maxsplit=1)[0].strip()
    first = re.sub(
        r"^(?:please\s+)?(?:create|build|make|generate|design|write|i want|we need)\s+", "", first, flags=re.I
    )
    first = re.sub(r"^(?:an?|the|some)\s+", "", first, flags=re.I)
    kind = re.match(r"(.{3,60}?)\s+(simulation|scenario|exercise|role-?play|drill)\b", first, re.I)
    if kind:
        return _tidy_title(f"{kind.group(1)} {kind.group(2).lower()}")
    return _tidy_title(first) or fallback


def _subject(description: str) -> str:
    m = re.search(
        r"\b(diagnose|resolve|fix|handle|investigate|troubleshoot|respond to|triage)\s+(?:an?\s+|the\s+)?"
        r"([^.;,]{3,60})",
        description,
        re.I,
    )
    return m.group(2).strip() if m else "the reported problem"


def _adapt(
    template_key: str,
    description: str,
    *,
    title: str | None,
    difficulty: str | None,
    learner_role: str | None,
) -> dict[str, Any]:
    d = load_template(template_key)
    d["key"] = None
    meta = d["meta"]
    meta["title"] = title or derive_title(description, meta["title"])
    meta["description"] = description.strip()
    meta["difficulty"] = difficulty or detect_difficulty(description, meta.get("difficulty", "intermediate"))
    if learner_role:
        meta["learner_role"] = learner_role
    elif template_key == "it-helpdesk-network":
        level = {"beginner": "Level 1", "advanced": "Level 3"}.get(meta["difficulty"], "Level 2")
        meta["learner_role"] = f"{level} Service Desk Analyst"
    meta["tags"] = sorted(set(meta.get("tags", [])) | {"ai_draft", "needs_review"} - {"flagship"})
    return d


def generic_definition(
    description: str,
    *,
    industry: str | None = None,
    difficulty: str | None = None,
    learner_role: str | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    """A complete, playable fault-diagnosis skeleton for any domain."""
    industry = (industry or "general").lower()
    who_label, who_name, who_role = STAKEHOLDERS.get(industry, ("Requester", "Alex Morgan", "Requester"))
    subject = _subject(description)
    v = lambda n: {"var": n}  # noqa: E731
    fixed = v("fixed")

    def ask(
        aid: str, label: str, intent: str, fact: str, msg: str, score: dict[str, float], **extra: Any
    ) -> dict[str, Any]:
        a = {
            "id": aid,
            "tool": "chat",
            "label": label,
            "kind": "ask",
            "character": "stakeholder",
            "input": {"type": "free_text", "intents": [intent]},
            "classification": "correct",
            "effects": [{"reveal": [fact]}] if fact else [],
            "score": score,
            "time_cost": 1,
            "messages": [{"character": "stakeholder", "text": msg}],
        }
        a.update(extra)
        return a

    def evidence(aid: str, label: str, flag: str, text: str, score: dict[str, float]) -> dict[str, Any]:
        return {
            "id": aid,
            "tool": "evidence",
            "label": label,
            "kind": "inspect",
            "classification": "correct",
            "effects": [{"set": {flag: True}}],
            "score": score,
            "time_cost": 2,
            "outputs": [{"text": text, "format": "markdown"}],
        }

    actions = [
        {
            "id": "review_case",
            "tool": "case",
            "label": "Review the case details",
            "kind": "inspect",
            "classification": "correct",
            "score": {"troubleshooting_process": 3},
            "time_cost": 1,
            "outputs": [{"text": f"Case summary: {description.strip()[:400]}", "format": "text"}],
        },
        ask(
            "greet",
            f"Greet the {who_label.lower()}",
            "greeting",
            "",
            "Hi, thanks for helping me with this.",
            {"communication": 2},
            time_cost=0.5,
        ),
        ask(
            "ask_symptoms",
            "Ask what exactly is happening",
            "symptoms",
            "f_symptoms",
            "[Instructor: describe the visible symptoms in the character's own words.]",
            {"communication": 2, "troubleshooting_process": 2, "technical_accuracy": 2},
        ),
        ask(
            "ask_timeline",
            "Ask when it started",
            "timeline",
            "f_timeline",
            "[Instructor: when did it start and what happened just before?]",
            {"communication": 2, "troubleshooting_process": 2, "technical_accuracy": 1},
        ),
        ask(
            "ask_scope",
            "Ask who or what else is affected",
            "scope",
            "f_scope",
            "[Instructor: is anyone/anything else affected?]",
            {"communication": 1, "troubleshooting_process": 2, "technical_accuracy": 2},
        ),
        ask(
            "ask_changes",
            "Ask about recent changes",
            "changes",
            "f_changes",
            "[Instructor: the recent change that is the key clue.]",
            {"communication": 1, "troubleshooting_process": 2, "technical_accuracy": 2},
        ),
        evidence(
            "check_logs",
            "Review the logs / records",
            "evidence_logs",
            "[Instructor: log or record excerpt that points towards the root cause.]",
            {"technical_accuracy": 4, "troubleshooting_process": 2},
        ),
        evidence(
            "check_configuration",
            "Inspect the configuration / settings",
            "evidence_config",
            "[Instructor: configuration detail showing the misconfiguration.]",
            {"technical_accuracy": 4, "troubleshooting_process": 2},
        ),
        evidence(
            "check_history",
            "Check the recent change history",
            "evidence_history",
            "[Instructor: change history entry that correlates with the start of the problem.]",
            {"technical_accuracy": 3, "troubleshooting_process": 2},
        ),
        {
            "id": "read_procedure",
            "tool": "kb",
            "label": "Read the relevant procedure",
            "kind": "inspect",
            "classification": "correct",
            "score": {"troubleshooting_process": 2},
            "time_cost": 1.5,
            "outputs": [
                {"text": "[Instructor: summary of the standard operating procedure.]", "format": "markdown"}
            ],
        },
        {
            "id": "record_diagnosis",
            "tool": "case",
            "label": "Record the root cause",
            "kind": "select",
            "time_cost": 1,
            "input": {
                "type": "choice",
                "choices": [
                    {"id": "cause_a", "label": "[Instructor: correct root cause]"},
                    {"id": "cause_b", "label": "[Instructor: plausible distractor]"},
                    {"id": "cause_c", "label": "[Instructor: common misconception]"},
                ],
            },
            "branches": [
                {
                    "id": "correct",
                    "when": {"==": [v("$input.choice"), "cause_a"]},
                    "classification": "correct",
                    "effects": [{"set": {"diagnosed": True}}],
                    "score": {"technical_accuracy": 6, "decision_making": 6},
                    "feedback": "Correct diagnosis.",
                },
                {
                    "id": "wrong",
                    "when": True,
                    "classification": "incorrect",
                    "score": {"technical_accuracy": -3, "decision_making": -4},
                    "feedback": "[Instructor: explain why the evidence does not support this cause.]",
                },
            ],
        },
        {
            "id": "apply_fix",
            "tool": "case",
            "label": "Apply the targeted fix",
            "kind": "command",
            "listed": True,
            "time_cost": 2,
            "effects": [{"set": {"fixed": True}}],
            "branches": [
                {"id": "already", "when": fixed, "classification": "neutral", "score": {}},
                {
                    "id": "diagnosed",
                    "when": {"or": [v("diagnosed"), {"and": [v("evidence_logs"), v("evidence_config")]}]},
                    "classification": "correct",
                    "score": {"technical_accuracy": 8, "decision_making": 5, "troubleshooting_process": 2},
                },
                {
                    "id": "guessed",
                    "when": True,
                    "classification": "correct",
                    "score": {"technical_accuracy": 4, "troubleshooting_process": -3},
                    "feedback": "Right fix, but applied before confirming the cause.",
                },
            ],
            "outputs": [
                {"text": "[Instructor: system response after the fix is applied.]", "format": "text"}
            ],
        },
        {
            "id": "apply_wrong_fix",
            "tool": "case",
            "label": "Apply a broad reset / replacement",
            "kind": "command",
            "listed": True,
            "time_cost": 15,
            "classification": "incorrect",
            "effects": [{"inc": {"stakeholder_patience": -20}}],
            "score": {"decision_making": -6, "technical_accuracy": -2},
            "messages": [{"character": "stakeholder", "text": "That took ages and it still isn't fixed!"}],
            "feedback": "A broad, disruptive change that doesn't address the root cause.",
        },
        {
            "id": "verify_fix",
            "tool": "evidence",
            "label": "Verify the fix",
            "kind": "inspect",
            "time_cost": 1,
            "branches": [
                {
                    "id": "ok",
                    "when": fixed,
                    "classification": "correct",
                    "effects": [{"set": {"verified": True}}],
                    "score": {"technical_accuracy": 4, "troubleshooting_process": 3},
                    "outputs": [
                        {"text": "[Instructor: evidence the problem is resolved.]", "format": "text"}
                    ],
                },
                {
                    "id": "not_yet",
                    "when": True,
                    "classification": "neutral",
                    "outputs": [{"text": "The problem is still present.", "format": "text"}],
                },
            ],
        },
        ask(
            "ask_confirm",
            f"Ask the {who_label.lower()} to confirm",
            "confirm",
            "",
            "Yes, that's working now. Thank you!",
            {"communication": 3, "troubleshooting_process": 3},
            effects=[{"set": {"confirmed": True}}],
            preconditions=fixed,
            precondition_message="No, it's still not working for me.",
        ),
        ask(
            "explain",
            "Explain the cause and fix",
            "explain",
            "",
            "Thanks for explaining, that makes sense.",
            {"communication": 3},
            preconditions=fixed,
            precondition_message="Sorry, I'm not sure what you mean.",
        ),
        {
            "id": "document",
            "tool": "case",
            "label": "Document the resolution",
            "kind": "document",
            "time_cost": 3,
            "input": {"type": "free_text", "min_length": 30, "placeholder": "Cause, fix and verification…"},
            "branches": [
                {
                    "id": "good",
                    "classification": "correct",
                    "when": {
                        ">=": [
                            {
                                "count_keywords": [
                                    v("$input.text"),
                                    [
                                        ["cause", "root"],
                                        ["fix", "fixed", "resolved"],
                                        ["verified", "confirmed", "tested"],
                                    ],
                                ]
                            },
                            2,
                        ]
                    },
                    "effects": [{"set": {"documented": True}}],
                    "score": {"communication": 4, "troubleshooting_process": 2},
                },
                {
                    "id": "thin",
                    "when": True,
                    "classification": "neutral",
                    "effects": [{"set": {"documented": True}}],
                    "score": {"communication": 1},
                    "feedback": "Record the cause, the fix and how you verified it.",
                },
            ],
            "outputs": [{"text": "Notes saved.", "format": "text"}],
        },
        {
            "id": "escalate",
            "tool": "case",
            "label": "Escalate to the specialist team",
            "kind": "escalate",
            "time_cost": 1,
            "branches": [
                {
                    "id": "too_early",
                    "when": {"<": [v("$minutes"), 10]},
                    "classification": "incorrect",
                    "effects": [
                        {"set": {"escalated": True}},
                        {"transition": "ESCALATED"},
                        {"complete": "escalated"},
                    ],
                    "score": {"decision_making": -8},
                    "feedback": "Escalated before gathering any evidence.",
                },
                {
                    "id": "late",
                    "when": True,
                    "classification": "incorrect",
                    "effects": [
                        {"set": {"escalated": True}},
                        {"transition": "ESCALATED"},
                        {"complete": "escalated"},
                    ],
                    "score": {"decision_making": -3},
                    "feedback": "This was solvable at your level.",
                },
            ],
        },
        {
            "id": "close_case",
            "tool": "case",
            "label": "Resolve and close",
            "kind": "submit",
            "time_cost": 0.5,
            "branches": [
                {
                    "id": "not_fixed",
                    "when": {"!": fixed},
                    "classification": "critical",
                    "effects": [{"complete": "failure"}],
                    "score": {"decision_making": -5},
                    "feedback": "Closed without fixing the problem.",
                },
                {
                    "id": "unverified",
                    "when": {"!": {"or": [v("verified"), v("confirmed")]}},
                    "classification": "critical",
                    "effects": [{"complete": "failure"}],
                    "feedback": "Closed without validating the fix.",
                },
                {
                    "id": "ok",
                    "when": True,
                    "classification": "correct",
                    "effects": [{"transition": "RESOLUTION"}, {"complete": "success"}],
                    "score": {"decision_making": 4, "troubleshooting_process": 2, "communication": 1},
                },
            ],
        },
    ]
    intents = [
        {"id": "greeting", "patterns": ["hello", "good morning", "my name", "introduce"]},
        {
            "id": "symptoms",
            "patterns": ["what happen", "what see", "symptom", "describe", "error", "problem"],
        },
        {"id": "timeline", "patterns": ["when start", "how long", "since when", "when notice"]},
        {
            "id": "scope",
            "patterns": ["anyone other", "other affected", "only you", "other people", "affected"],
        },
        {"id": "changes", "patterns": ["change", "anything different", "recently"]},
        {"id": "confirm", "patterns": ["try now", "test", "work now", "confirm", "check now"]},
        {"id": "explain", "patterns": ["explain", "caused", "root cause", "fixed", "resolved"]},
    ]
    facts = [
        {"id": f, "text": t}
        for f, t in (
            ("f_symptoms", "[Instructor: symptoms]"),
            ("f_timeline", "[Instructor: timeline]"),
            ("f_scope", "[Instructor: scope / impact]"),
            ("f_changes", "[Instructor: recent change]"),
        )
    ]
    flags = [
        "evidence_logs",
        "evidence_config",
        "evidence_history",
        "diagnosed",
        "fixed",
        "verified",
        "confirmed",
        "documented",
        "escalated",
    ]
    definition: dict[str, Any] = {
        "schema_version": "1.0",
        "meta": {
            "title": title or derive_title(description, "AI-generated simulation"),
            "description": description.strip(),
            "industry": industry,
            "environment_type": "case_work",
            "difficulty": difficulty or detect_difficulty(description),
            "estimated_minutes": 20,
            "learner_role": learner_role or "Analyst",
            "briefing": f"A {who_role.lower()} needs your help with {subject}. Gather information, "
            "investigate the evidence, identify the root cause, fix it, verify the result and document "
            "the case.",
            "objectives": [
                "Gather information",
                "Investigate evidence",
                "Identify the root cause",
                "Apply and verify the fix",
                "Document and close",
            ],
            "tags": ["ai_draft", "needs_review", "fault_diagnosis"],
        },
        "environment": {
            "panels": [
                {
                    "id": "case",
                    "type": "case_file",
                    "title": "Case",
                    "data": {"summary": description.strip()[:1000], "status": "{{case_status}}"},
                },
                {"id": "chat", "type": "chat", "title": f"Chat: {who_name}", "data": {}},
                {"id": "evidence", "type": "log_viewer", "title": "Evidence", "data": {"entries": []}},
                {"id": "kb", "type": "knowledge_base", "title": "Procedures", "data": {"articles": []}},
            ]
        },
        "tools": [
            {"id": "case", "name": "Case", "panel": "case"},
            {"id": "chat", "name": f"Chat with {who_name}", "panel": "chat"},
            {"id": "evidence", "name": "Evidence", "panel": "evidence"},
            {"id": "kb", "name": "Procedures", "panel": "kb"},
        ],
        "characters": [
            {
                "id": "stakeholder",
                "name": who_name,
                "role": who_role,
                "persona": f"[Instructor: personality of the {who_role.lower()}]",
                "facts": facts,
                "fallback_reply": "Sorry, I don't follow. What do you need from me?",
                "patience_var": "stakeholder_patience",
                "patience_decay_per_minute": 0.5,
            }
        ],
        "intents": intents,
        "phases": [
            {
                "id": "INITIAL",
                "name": "Initial",
                "transitions": ["INVESTIGATION", "ESCALATED"],
                "auto_advance": [{"to": "INVESTIGATION", "when": {">=": [v("$actions_count"), 1]}}],
            },
            {
                "id": "INVESTIGATION",
                "name": "Investigation",
                "transitions": ["DIAGNOSIS", "REMEDIATION", "ESCALATED"],
                "auto_advance": [
                    {"to": "DIAGNOSIS", "when": {"and": [v("evidence_logs"), v("evidence_config")]}},
                    {"to": "REMEDIATION", "when": {"or": [fixed, v("diagnosed")]}},
                ],
            },
            {
                "id": "DIAGNOSIS",
                "name": "Diagnosis",
                "transitions": ["REMEDIATION", "ESCALATED"],
                "auto_advance": [{"to": "REMEDIATION", "when": {"or": [v("diagnosed"), fixed]}}],
            },
            {
                "id": "REMEDIATION",
                "name": "Remediation",
                "transitions": ["VALIDATION", "ESCALATED"],
                "auto_advance": [{"to": "VALIDATION", "when": fixed}],
            },
            {
                "id": "VALIDATION",
                "name": "Validation",
                "transitions": ["RESOLUTION"],
                "auto_advance": [{"to": "RESOLUTION", "when": {"and": [v("verified"), v("confirmed")]}}],
            },
            {"id": "RESOLUTION", "name": "Resolution", "terminal": True},
            {"id": "ESCALATED", "name": "Escalated", "terminal": True},
        ],
        "variables": {
            "root_cause": {
                "type": "str",
                "initial": "[Instructor: define the root cause]",
                "visibility": "secret",
            },
            "case_status": {"type": "str", "initial": "Open", "visibility": "public", "label": "Case status"},
            "stakeholder_patience": {
                "type": "float",
                "initial": 100,
                "min": 0,
                "max": 100,
                "visibility": "public",
                "label": f"{who_label} patience",
            },
            **{f: {"type": "bool", "initial": False} for f in flags},
        },
        "opening_messages": [{"character": "stakeholder", "text": f"Hi, I need help with {subject}."}],
        "actions": actions,
        "events": [
            {
                "id": "stakeholder_escalates",
                "title": f"{who_label} loses patience",
                "classification": "incorrect",
                "trigger": {"type": "condition", "condition": {"<=": [v("stakeholder_patience"), 0]}},
                "score": {"communication": -5},
                "messages": [
                    {"character": "stakeholder", "text": "This is taking far too long. I'm escalating."}
                ],
                "notify": f"The {who_label.lower()} escalated the case.",
            }
        ],
        "scoring": {
            "dimensions": [
                {"id": "technical_accuracy", "name": "Technical accuracy", "weight": 35, "max_points": 30},
                {
                    "id": "troubleshooting_process",
                    "name": "Troubleshooting process",
                    "weight": 25,
                    "max_points": 26,
                },
                {"id": "communication", "name": "Communication", "weight": 15, "max_points": 15},
                {"id": "decision_making", "name": "Decision making", "weight": 15, "max_points": 13},
                {"id": "efficiency", "name": "Efficiency", "weight": 10, "max_points": 10},
            ],
            "efficiency": {"dimension": "efficiency", "target_minutes": 25, "max_minutes": 70},
            "process": {"dimension": "troubleshooting_process"},
        },
        "completion": {"success": {"action_taken": "close_case"}, "max_sim_minutes": 120},
        "feedback_rules": [
            {
                "id": "s_info",
                "type": "strength",
                "when": {"and": [{"action_taken": "ask_symptoms"}, {"action_taken": "ask_changes"}]},
                "text": "You gathered symptoms and recent changes before acting.",
            },
            {
                "id": "s_evidence",
                "type": "strength",
                "when": {"and": [v("evidence_logs"), v("evidence_config")]},
                "text": "You based your diagnosis on evidence.",
            },
            {
                "id": "i_wrong_fix",
                "type": "improvement",
                "when": {"action_taken": "apply_wrong_fix"},
                "text": "Avoid broad, disruptive fixes. Target the root cause.",
            },
            {
                "id": "m_verify",
                "type": "missed_step",
                "when": {"!": v("verified")},
                "text": "Verify the fix before closing.",
            },
            {
                "id": "m_document",
                "type": "missed_step",
                "when": {"!": v("documented")},
                "text": "Document the cause, fix and verification.",
            },
        ],
    }
    return definition


def fallback_definition(
    description: str,
    *,
    industry: str | None = None,
    difficulty: str | None = None,
    learner_role: str | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    """Deterministic generator used when no AI provider is available (or its output is unusable)."""
    text = f" {description.lower()} "
    ind = (industry or "").lower()
    kw = {"title": title, "difficulty": difficulty, "learner_role": learner_role}
    if ind in ("cybersecurity", "security") or _contains(text, SECURITY_WORDS):
        return _adapt("phishing-email-investigation", description, **kw)
    if ind in ("it", "") and _contains(text, HELPDESK_WORDS):
        return _adapt("it-helpdesk-network", description, **kw)
    if ind == "hospitality" or _contains(text, HOSPITALITY_WORDS):
        return _adapt("restaurant-food-safety-complaint", description, **kw)
    return generic_definition(description, industry=industry, **kw)


def starter_definition(
    title: str, *, industry: str = "general", difficulty: str = "intermediate", description: str = ""
) -> dict[str, Any]:
    """Blank-but-valid starting point for a simulation created from scratch in the builder."""
    d = generic_definition(
        description or f"{title}: describe the scenario here.",
        industry=industry,
        difficulty=difficulty,
        title=title,
    )
    d["meta"]["tags"] = ["draft"]
    return d


def build_prompt(
    description: str, industry: str | None, difficulty: str | None, learner_role: str | None
) -> str:
    return json.dumps(
        {
            "request": description,
            "industry": industry,
            "difficulty": difficulty,
            "learner_role": learner_role,
        },
        ensure_ascii=False,
    )
