"""Deterministic personalised study-plan builder (Offline provider + fallback for the AI-written plan)."""

from __future__ import annotations

from typing import Any


def difficulty_adjustment(avg_score: float | None, pace: str | None, attempts: int = 0) -> dict[str, str]:
    if avg_score is None or attempts == 0:
        return {
            "direction": "maintain",
            "reason": "Not enough results yet — keep going at the current level.",
        }
    if avg_score >= 85 and pace != "slow":
        return {
            "direction": "harder",
            "reason": f"You are averaging {avg_score:.0f}% — you're ready for more "
            "challenging material and advanced scenarios.",
        }
    if avg_score < 55:
        return {
            "direction": "easier",
            "reason": f"You are averaging {avg_score:.0f}% — revisiting foundations "
            "and practice questions before moving on will help.",
        }
    return {
        "direction": "maintain",
        "reason": f"You are averaging {avg_score:.0f}% — steady progress; keep the "
        "current difficulty and target your weaker areas.",
    }


def build_plan(profile: dict[str, Any]) -> dict[str, Any]:
    weak = profile.get("weak_skills") or []
    strong = profile.get("strong_skills") or []
    recs = profile.get("recommendations") or []
    adj = difficulty_adjustment(
        profile.get("avg_score"), profile.get("pace"), int(profile.get("attempts") or 0)
    )
    focus = [w.get("name", "") for w in weak if w.get("name")]
    strengths = [s.get("name", "") for s in strong if s.get("name")]
    steps: list[dict[str, Any]] = []
    by_skill: dict[str, list[dict[str, Any]]] = {}
    for r in recs:
        by_skill.setdefault(r.get("skill") or "General", []).append(r)
    week = 1
    for skill in focus + [k for k in by_skill if k not in focus]:
        items = by_skill.get(skill) or []
        if not items and skill not in focus:
            continue
        acts = [
            {
                "title": r.get("title", ""),
                "type": r.get("kind", "lesson"),
                "target_id": r.get("target_id"),
                "reason": r.get("reason", ""),
            }
            for r in items[:4]
        ]
        if not acts:
            acts = [
                {
                    "title": f"Review your notes on {skill}",
                    "type": "revision",
                    "target_id": None,
                    "reason": f"{skill} is one of your weaker areas.",
                }
            ]
        steps.append({"week": week, "focus": skill, "activities": acts})
        week += 1
        if week > 6:
            break
    failed = profile.get("failed_questions") or []
    if failed:
        steps.append(
            {
                "week": week,
                "focus": "Revisit mistakes",
                "activities": [
                    {
                        "title": f"Re-attempt: {q[:80]}",
                        "type": "practice",
                        "target_id": None,
                        "reason": "You answered this incorrectly before.",
                    }
                    for q in failed[:4]
                ],
            }
        )
    if not steps:
        steps.append(
            {
                "week": 1,
                "focus": "Keep progressing",
                "activities": [
                    {
                        "title": "Continue your current course",
                        "type": "course",
                        "target_id": None,
                        "reason": "No weak areas detected yet.",
                    }
                ],
            }
        )
    if focus and strengths:
        summary = (
            f"Your performance indicates that you understand {', '.join(strengths[:2])} but need additional "
            f"practice in {', '.join(focus[:2])}. This plan focuses on those areas first."
        )
    elif focus:
        summary = f"Focus on {', '.join(focus[:3])} first — these are where extra practice will help most."
    elif strengths:
        summary = f"Great work — you're strong in {', '.join(strengths[:3])}. Keep stretching yourself."
    else:
        summary = "Complete a few lessons and quizzes so we can personalise your plan."
    return {
        "summary": summary,
        "strengths": strengths,
        "focus_areas": focus,
        "difficulty_adjustment": adj,
        "steps": steps,
    }
