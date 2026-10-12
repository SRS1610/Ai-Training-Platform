"""Offline provider: deterministic, network-free implementation of every platform prompt type.

It reads the ``[praxis-task: ...]`` marker in the system prompt and the DATA / UNTRUSTED blocks produced by
``praxis_ai.prompts`` and answers with:

* ``tutor_explain`` — an extractive answer built from the supplied knowledge passages / lesson text with
  ``[n]`` citations;
* ``tutor_hint`` — guiding questions only (never quotes the material verbatim);
* ``generate:<kind>`` — schema-valid template JSON built from the generation inputs;
* ``grade_submission`` / ``grade_answer`` — rubric-coverage heuristic grading with evidence quotes;
* ``recommend_plan`` — a deterministic study plan;
* ``character_reply`` — an in-character reply using only the supplied facts;
* anything else — an extractive summary labelled as offline output.

Embeddings use the hashing trick (``praxis_ai.text.hash_embedding``), so semantically overlapping text has
high cosine similarity and pgvector retrieval works end-to-end without API keys.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import Any

from praxis_ai import prompts
from praxis_ai.generation import build_template
from praxis_ai.grading import heuristic_grade_answer, heuristic_grade_submission
from praxis_ai.planning import build_plan
from praxis_ai.pricing import estimate_messages_tokens, estimate_tokens
from praxis_ai.providers.base import AIProvider
from praxis_ai.results import ChatMessage, ChatResult, EmbeddingResult
from praxis_ai.text import cosine, hash_embedding, keywords, overlap, sentences, tokenize

OFFLINE_MODEL = "offline-demo"
OFFLINE_EMBEDDING_MODEL = "offline-hash-embedding"
_PASSAGE = re.compile(r"^\[(\d+)\]\s+(.+)$", re.M)


def parse_passages(block: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    matches = list(_PASSAGE.finditer(block))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(block)
        out.append(
            {"n": int(m.group(1)), "title": m.group(2).strip(), "content": block[m.end() : end].strip()}
        )
    return out


class OfflineProvider(AIProvider):
    name = "offline"
    default_model = OFFLINE_MODEL
    default_embedding_model = OFFLINE_EMBEDDING_MODEL

    async def chat(
        self,
        messages: Sequence[ChatMessage | dict[str, Any]],
        *,
        model: str | None = None,
        temperature: float | None = 0.3,
        max_tokens: int | None = 1024,
        json_mode: bool = False,
    ) -> ChatResult:
        msgs = self.coerce(messages)
        system = "\n\n".join(m.content for m in msgs if m.role == "system")
        users = [m.content for m in msgs if m.role == "user"]
        last = users[-1] if users else ""
        task = prompts.parse_task(system) or ""
        if task in ("tutor_explain", "tutor_hint"):
            text = self._tutor(last, hint=task == "tutor_hint")
        elif task.startswith("generate:"):
            text = json.dumps(self._generate(task.split(":", 1)[1], last))
        elif task == "grade_submission":
            assignment = prompts.read_data(last, "assignment") or {}
            sub = "\n".join(prompts.read_untrusted(last, "submission"))
            text = json.dumps(heuristic_grade_submission(assignment, sub))
        elif task == "grade_answer":
            question = prompts.read_data(last, "question") or {}
            ans = "\n".join(prompts.read_untrusted(last, "answer"))
            text = json.dumps(heuristic_grade_answer(question, ans))
        elif task == "recommend_plan":
            text = json.dumps(build_plan(prompts.read_data(last, "profile") or {}))
        elif task == "character_reply":
            text = self._character(system, last)
        else:
            text = self._generic(last, json_mode)
        if max_tokens and estimate_tokens(text) > max_tokens * 4 and not text.lstrip().startswith(("{", "[")):
            text = text[: max_tokens * 16]
        return ChatResult(
            text=text,
            tokens_in=estimate_messages_tokens([{"content": m.content} for m in msgs]),
            tokens_out=estimate_tokens(text),
            model=OFFLINE_MODEL,
            provider=self.name,
            finish_reason="stop",
        )

    async def embed(self, texts: list[str], *, model: str | None = None) -> EmbeddingResult:
        return EmbeddingResult(
            vectors=[hash_embedding(t, self.embedding_dim) for t in texts],
            model=OFFLINE_EMBEDDING_MODEL,
            provider=self.name,
            tokens_in=sum(estimate_tokens(t) for t in texts),
        )

    # ------------------------------------------------------------------ tasks

    def _tutor(self, content: str, *, hint: bool) -> str:
        questions = prompts.read_untrusted(content, "learner_message")
        question = questions[-1] if questions else prompts.strip_blocks(content)
        passages: list[dict[str, Any]] = []
        for block in prompts.read_untrusted(content, "knowledge"):
            passages.extend(parse_passages(block))
        lesson = "\n".join(prompts.read_untrusted(content, "lesson"))
        profile = prompts.read_data(content, "learner_profile") or {}
        q_terms = tokenize(question)
        q_vec = hash_embedding(question, 256)
        candidates: list[tuple[float, str, int | None, str]] = []
        for p in passages:
            for s in sentences(p["content"]):
                if len(s) < 15:
                    continue
                score = overlap(q_terms, s) + 0.5 * max(0.0, cosine(q_vec, hash_embedding(s, 256)))
                candidates.append((score, s, p["n"], p["title"]))
        for s in sentences(lesson):
            if len(s) >= 15:
                score = overlap(q_terms, s) + 0.5 * max(0.0, cosine(q_vec, hash_embedding(s, 256)))
                candidates.append((score * 0.9, s, None, "lesson"))
        candidates.sort(key=lambda c: -c[0])
        best = [c for c in candidates if c[0] >= 0.2][:3]

        if hint:
            if not best:
                return (
                    "I can't give you the answer while this graded activity is in progress, "
                    "but here's a hint: "
                    "break the problem into what you've observed, what changed recently, and what you could "
                    "check next. Which of those can you test first?"
                )
            terms = [t for t in keywords(" ".join(c[1] for c in best), 6) if t not in q_terms][
                :3
            ] or keywords(best[0][1], 3)
            cite = next(
                (f" Re-read [{c[2]}] ({c[3]})" for c in best if c[2] is not None), " Re-read the lesson"
            )
            return (
                "I can't give you the final answer while this graded activity is in progress, but here's a "
                f"hint: think about how **{', '.join(terms)}** relate to the symptoms you're seeing. What "
                f"evidence would confirm or rule that out?{cite} and compare it with what you observe."
            )

        if not best:
            return (
                "I couldn't find this in your course materials or knowledge base. (Offline demo mode answers "
                "only from your materials — try rephrasing, or ask about a topic covered in this lesson.)"
            )
        lines = []
        for _, s, n, _title in best:
            lines.append(f"{s} [{n}]" if n is not None else s)
        answer = "Here's what your course materials say:\n\n" + "\n\n".join(f"- {line}" for line in lines)
        mistakes = profile.get("previous_mistakes") or []
        related = [m for m in mistakes if overlap(q_terms, str(m)) > 0.2]
        if related:
            answer += (
                f"\n\nThis is related to a question you found tricky earlier: “{str(related[0])[:140]}”."
            )
        gaps = profile.get("skill_gaps") or []
        if gaps:
            answer += f"\n\nTip: keep practising {gaps[0]} — it's one of your growth areas."
        return answer

    def _generate(self, kind: str, content: str) -> dict[str, Any]:
        inputs = dict(prompts.read_data(content, "input") or {})
        source = prompts.read_untrusted(content, "source_material")
        if source and not inputs.get("source_text"):
            inputs["source_text"] = "\n".join(source)
        if not inputs.get("subject"):
            inputs["subject"] = "workplace skills"
        out = build_template(kind, inputs)
        feedback = prompts.read_untrusted(content, "reviewer_feedback")
        if feedback and isinstance(out, dict):
            note = f" (revised: {feedback[0][:120].strip()})"
            for key in ("description", "summary", "scenario", "context"):
                if isinstance(out.get(key), str):
                    out[key] = out[key] + note
                    break
        return out

    def _character(self, system: str, content: str) -> str:
        facts = prompts.read_data(content, "facts") or []
        character = prompts.read_data(content, "character") or {}
        msg = "\n".join(prompts.read_untrusted(content, "learner_message"))
        name = character.get("name") or (re.search(r"role-playing ([^,]+),", system) or [None, "I"])[1]
        scored = sorted(((overlap(msg, str(f)), str(f)) for f in facts), key=lambda x: -x[0])
        if scored and scored[0][0] > 0:
            fact = scored[0][1]
            return f"{fact[:1].upper()}{fact[1:]}" + ("" if fact.endswith((".", "!", "?")) else ".")
        if facts:
            return f"I'm not sure about that. All I can tell you is: {str(facts[0])}"
        return f"Sorry, I don't know anything about that — {name} can only tell you what they've seen."

    def _generic(self, content: str, json_mode: bool) -> str:
        plain = prompts.strip_blocks(content) or " ".join(prompts.read_untrusted(content))
        ss = sentences(plain)
        terms = keywords(plain, 10)
        ranked = sorted(ss, key=lambda s: -overlap(terms, s))[:3]
        summary = " ".join(ranked) if ranked else plain[:400]
        if json_mode:
            return json.dumps({"text": summary, "offline": True})
        return f"[Offline demo] {summary}".strip()
