"""Packaged simulation templates (JSON definitions shipped with the engine)."""

from __future__ import annotations

import json
from functools import cache
from importlib import resources
from typing import Any

TEMPLATE_FILES = {
    "it-helpdesk-network": "it_helpdesk_network.json",
    "phishing-email-investigation": "phishing_email_investigation.json",
    "restaurant-food-safety-complaint": "restaurant_food_safety_complaint.json",
}


@cache
def _raw(key: str) -> str:
    if key not in TEMPLATE_FILES:
        raise KeyError(f"unknown template '{key}'")
    return resources.files(__name__).joinpath(TEMPLATE_FILES[key]).read_text(encoding="utf-8")


def load_template(key: str) -> dict[str, Any]:
    """Return a fresh (mutable) copy of a template definition."""
    return json.loads(_raw(key))


def list_templates() -> list[dict[str, Any]]:
    """Summaries for a template picker (no answers or hidden data)."""
    out = []
    for key in TEMPLATE_FILES:
        d = load_template(key)
        m = d["meta"]
        out.append(
            {
                "key": key,
                "title": m["title"],
                "description": m.get("description", ""),
                "industry": m.get("industry"),
                "environment_type": m.get("environment_type"),
                "difficulty": m.get("difficulty"),
                "estimated_minutes": m.get("estimated_minutes"),
                "learner_role": m.get("learner_role", ""),
                "tags": m.get("tags", []),
                "actions": len(d.get("actions", [])),
                "phases": [p["id"] for p in d.get("phases", [])],
            }
        )
    return out
