"""AI Gateway — the single entry point for every AI call in the platform.

Pipeline per call: resolve org AI configuration → feature + plan gate → per-user daily limit → monthly
budget hard limit → prompt isolation (wrap untrusted content, injection flagging) → provider call (with
timeout) → usage ledger (``ai_usage``, also for failures) + metrics → budget-threshold alerts.

CONTRACT (used by other modules — keep signatures stable):

* ``AIResult`` / ``AIUnavailable`` / ``RetrievedChunk``
* ``generate_text(db, *, organisation_id, user_id, feature, system, messages, course_id=None,
  max_tokens=None, temperature=None) -> AIResult``
* ``generate_json(db, *, organisation_id, user_id, feature, system, prompt, schema_hint, fallback=None,
  course_id=None) -> dict``
* ``embed(db, *, organisation_id, texts) -> list[list[float]]``
* ``retrieve(db, *, organisation_id, query, course_id=None, k=5, approved_only=True) -> list[RetrievedChunk]``
* ``semantic_search(db, *, organisation_id, query, k=10) -> list[dict]``

Message dicts passed to ``generate_text`` are ``{"role", "content"}``. User messages are treated as
untrusted and wrapped in delimiters unless they are already wrapped (see ``untrusted()``) or carry
``"trusted": True``. ``generate_json``'s ``prompt`` is trusted caller-built text: wrap any learner or
document content inside it with ``untrusted(source, text)``.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import structlog
from praxis_ai import prompts as P
from praxis_ai.jsonutil import parse_json_object
from praxis_ai.pricing import estimate_cost, estimate_messages_tokens, estimate_tokens
from praxis_ai.providers import OFFLINE_EMBEDDING_MODEL, OFFLINE_MODEL, AIProvider, create_provider
from praxis_ai.results import ProviderError
from praxis_ai.safety import detect_injection
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, Forbidden, PaymentRequired, TooManyRequests
from app.core.metrics import metrics
from app.models.ai import AIBudgetAlert, AIConfiguration, AIUsage, KnowledgeChunk, KnowledgeDocument
from app.models.tenancy import Organisation

log = structlog.get_logger(__name__)

# --------------------------------------------------------------------------- public types


class AIResult(BaseModel):
    text: str
    model: str
    provider: str
    tokens_in: int
    tokens_out: int
    cost_usd: float
    offline: bool
    finish_reason: str = "stop"
    flags: dict[str, Any] = Field(default_factory=dict)  # e.g. {"injection": {...}}


class AIUnavailable(AppError):
    status_code = 503
    code = "ai_unavailable"


class RetrievedChunk(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    title: str
    heading: str | None = None
    snippet: str
    content: str
    score: float
    course_id: uuid.UUID | None = None
    source: str = "vector"  # vector | keyword

    def citation(self) -> dict[str, Any]:
        return {
            "document_id": str(self.document_id),
            "title": self.title,
            "chunk_id": str(self.chunk_id),
            "snippet": self.snippet,
            "heading": self.heading,
        }


def untrusted(source: str, text: str) -> str:
    """Wrap learner/document content for inclusion in a prompt (delimited, delimiter-neutralised)."""
    return P.wrap_untrusted(source, text)


# --------------------------------------------------------------------------- configuration resolution

PROVIDER_NAMES = ("openai", "anthropic", "azure_openai", "google", "local", "offline")
DEFAULT_FEATURES = {
    "tutor": True,
    "content_generation": True,
    "grading": True,
    "simulation_ai": True,
    "recommendations": True,
}
# feature name used by callers → (AIConfiguration.features key, plan feature flag)
FEATURE_MAP: dict[str, tuple[str | None, str | None]] = {
    "tutor": ("tutor", "ai_tutor"),
    "content_generation": ("content_generation", "ai_generation"),
    "generation": ("content_generation", "ai_generation"),
    "simulation_builder": ("content_generation", "ai_generation"),
    "grading": ("grading", None),
    "simulation": ("simulation_ai", None),
    "simulation_character": ("simulation_ai", None),
    "simulation_ai": ("simulation_ai", None),
    "recommendations": ("recommendations", None),
    "embedding": (None, None),
    "knowledge": (None, None),
    "search": (None, None),
}
NON_COUNTED_FEATURES = {"embedding", "knowledge", "search"}  # not counted against per-user daily limits


def google_api_key() -> str | None:
    # app.core.config has no Gemini key setting yet; read the conventional env vars.
    return settings.GOOGLE_API_KEY or os.environ.get("GEMINI_API_KEY")


def server_keys() -> dict[str, bool]:
    """Which providers have server-side credentials configured (keys themselves are never exposed)."""
    return {
        "openai": bool(settings.OPENAI_API_KEY),
        "anthropic": bool(settings.ANTHROPIC_API_KEY),
        "azure_openai": bool(settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_ENDPOINT),
        "google": bool(google_api_key()),
        "local": bool(settings.LOCAL_MODEL_BASE_URL),
        "offline": True,
    }


def default_model_for(provider: str) -> str:
    return {
        "openai": settings.AI_DEFAULT_MODEL,
        "anthropic": settings.ANTHROPIC_MODEL,
        "azure_openai": settings.AI_DEFAULT_MODEL,
        "google": "gemini-2.0-flash",
        "local": "llama3.1",
        "offline": OFFLINE_MODEL,
    }.get(provider, OFFLINE_MODEL)


def build_provider(name: str) -> AIProvider:
    """Instantiate a provider with server credentials. Tests monkeypatch this to inject fakes."""
    common: dict[str, Any] = {
        "timeout": settings.AI_REQUEST_TIMEOUT_SECONDS,
        "embedding_dim": settings.AI_EMBEDDING_DIM,
    }
    if name == "openai":
        return create_provider(
            "openai", api_key=settings.OPENAI_API_KEY, base_url=settings.OPENAI_BASE_URL, **common
        )
    if name == "anthropic":
        return create_provider("anthropic", api_key=settings.ANTHROPIC_API_KEY, **common)
    if name == "azure_openai":
        return create_provider(
            "azure_openai",
            api_key=settings.AZURE_OPENAI_API_KEY,
            base_url=settings.AZURE_OPENAI_ENDPOINT,
            api_version=settings.AZURE_OPENAI_API_VERSION,
            **common,
        )
    if name == "google":
        return create_provider("google", api_key=google_api_key(), **common)
    if name == "local":
        return create_provider(
            "local",
            base_url=settings.LOCAL_MODEL_BASE_URL,
            api_key=os.environ.get("LOCAL_MODEL_API_KEY"),
            **common,
        )
    return create_provider("offline", **common)


@dataclass
class Resolved:
    org: Organisation
    config: AIConfiguration | None
    configured_provider: str
    provider: str  # effective provider (offline when the configured one has no credentials)
    model: str
    embedding_model: str | None
    temperature: float
    max_output_tokens: int
    features: dict[str, bool]
    budget_usd: float | None
    hard_limit: bool
    alert_thresholds: list[int]
    per_user_daily_requests: int | None
    knowledge_only: bool
    tutor_behaviour: dict[str, Any] = field(default_factory=dict)
    grading_mode: str = "ai_assisted"

    @property
    def offline(self) -> bool:
        return self.provider == "offline"


def plan_budget(org: Organisation) -> float | None:
    from app.modules.billing.plans import get_plan

    value = get_plan(org.plan_code).limits.get("ai_monthly_budget_usd")
    return float(value) if value is not None else None


async def resolve(db: AsyncSession, organisation_id: uuid.UUID) -> Resolved:
    org = await db.get(Organisation, organisation_id)
    if org is None:
        raise AIUnavailable("Organisation not found for AI request")
    cfg = await db.scalar(select(AIConfiguration).where(AIConfiguration.organisation_id == organisation_id))
    configured = (cfg.provider if cfg and cfg.provider else settings.AI_DEFAULT_PROVIDER) or "offline"
    if configured not in PROVIDER_NAMES:
        configured = "offline"
    effective = configured if server_keys().get(configured) else "offline"
    model = (cfg.model if cfg and cfg.model else "") or default_model_for(configured)
    if effective == "offline":
        model = OFFLINE_MODEL
    budget = float(cfg.monthly_budget_usd) if cfg and cfg.monthly_budget_usd is not None else plan_budget(org)
    return Resolved(
        org=org,
        config=cfg,
        configured_provider=configured,
        provider=effective,
        model=model,
        embedding_model=(cfg.embedding_model or None) if cfg else None,
        temperature=float(cfg.temperature) if cfg and cfg.temperature is not None else 0.3,
        max_output_tokens=int(cfg.max_output_tokens) if cfg and cfg.max_output_tokens else 1500,
        features={**DEFAULT_FEATURES, **((cfg.features or {}) if cfg else {})},
        budget_usd=budget,
        hard_limit=bool(cfg.hard_limit) if cfg else True,
        alert_thresholds=sorted(
            {int(t) for t in ((cfg.alert_thresholds if cfg else None) or [50, 75, 90, 100])}
        ),
        per_user_daily_requests=(cfg.per_user_daily_requests if cfg else 200),
        knowledge_only=bool(cfg.knowledge_only) if cfg else False,
        tutor_behaviour=dict(cfg.tutor_behaviour or {}) if cfg else {},
        grading_mode=(cfg.grading_mode if cfg else None) or "ai_assisted",
    )


# --------------------------------------------------------------------------- gates


def check_feature(r: Resolved, feature: str) -> None:
    from app.modules.billing.plans import has_feature

    cfg_key, plan_flag = FEATURE_MAP.get(feature, (feature, None))
    if cfg_key and not r.features.get(cfg_key, True):
        raise Forbidden(
            f"The AI feature '{cfg_key.replace('_', ' ')}' is disabled for your organisation",
            code="ai_feature_disabled",
            details={"feature": cfg_key},
        )
    if plan_flag and not has_feature(r.org, plan_flag):
        raise PaymentRequired(
            f"Your plan does not include {plan_flag.replace('_', ' ')}. Upgrade to unlock it.",
            details={"feature": plan_flag, "plan": r.org.plan_code},
        )


def month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(UTC)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def month_spend(db: AsyncSession, organisation_id: uuid.UUID) -> float:
    total = await db.scalar(
        select(func.coalesce(func.sum(AIUsage.cost_usd), 0)).where(
            AIUsage.organisation_id == organisation_id, AIUsage.created_at >= month_start()
        )
    )
    return float(total or 0)


async def check_limits(db: AsyncSession, r: Resolved, user_id: uuid.UUID | None, feature: str) -> float:
    """Raise when the per-user daily limit or the monthly budget hard limit is hit. Returns month spend."""
    if user_id and r.per_user_daily_requests and feature not in NON_COUNTED_FEATURES:
        day = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        used = await db.scalar(
            select(func.count())
            .select_from(AIUsage)
            .where(
                AIUsage.organisation_id == r.org.id,
                AIUsage.user_id == user_id,
                AIUsage.created_at >= day,
                AIUsage.feature.notin_(NON_COUNTED_FEATURES),
            )
        )
        if int(used or 0) >= r.per_user_daily_requests:
            raise TooManyRequests(
                "You have reached your daily AI request limit. Try again tomorrow.",
                code="ai_daily_limit",
                retry_after=3600,
                details={"limit": r.per_user_daily_requests},
            )
    spend = await month_spend(db, r.org.id)
    if r.budget_usd is not None and r.hard_limit and spend >= r.budget_usd:
        raise PaymentRequired(
            "Your organisation's monthly AI budget has been reached.",
            code="ai_budget_exceeded",
            details={"budget_usd": r.budget_usd, "spent_usd": round(spend, 4)},
        )
    return spend


# --------------------------------------------------------------------------- ledger + alerts


async def record_usage(
    db: AsyncSession,
    *,
    organisation_id: uuid.UUID,
    user_id: uuid.UUID | None,
    course_id: uuid.UUID | None,
    feature: str,
    provider: str,
    model: str,
    tokens_in: int,
    tokens_out: int,
    cost_usd: float,
    latency_ms: int | None,
    success: bool,
    separate: bool = False,
) -> None:
    row = AIUsage(
        organisation_id=organisation_id,
        created_at=datetime.now(UTC),
        user_id=user_id,
        course_id=course_id,
        feature=feature[:48],
        provider=provider,
        model=model[:100],
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=cost_usd,
        latency_ms=latency_ms,
        success=success,
    )
    metrics.observe_ai(feature, success)
    if not separate:
        db.add(row)
        await db.flush()
        return
    # Failures are recorded in their own transaction so the ledger survives the caller's rollback.
    from app.core.db import system_session

    try:
        async with system_session(organisation_id) as s:
            s.add(row)
    except Exception:  # noqa: BLE001 - ledger write is best effort on the failure path
        log.warning("ai.usage_record_failed", organisation_id=str(organisation_id), feature=feature)


async def check_budget_alerts(
    db: AsyncSession, organisation_id: uuid.UUID, *, resolved: Resolved | None = None
) -> list[int]:
    """Create AIBudgetAlert rows (deduplicated per period/threshold) for crossed thresholds and notify org
    admins (members holding ``ai.manage``). Returns newly alerted thresholds."""
    r = resolved or await resolve(db, organisation_id)
    if not r.budget_usd:
        return []
    spend = await month_spend(db, organisation_id)
    pct = 100.0 * spend / r.budget_usd
    crossed = [t for t in r.alert_thresholds if pct >= t]
    if not crossed:
        return []
    period = datetime.now(UTC).strftime("%Y-%m")
    existing = set(
        (
            await db.scalars(
                select(AIBudgetAlert.threshold).where(
                    AIBudgetAlert.organisation_id == organisation_id, AIBudgetAlert.period == period
                )
            )
        ).all()
    )
    new = [t for t in crossed if t not in existing]
    created: list[int] = []
    for t in new:
        try:
            async with db.begin_nested():
                db.add(
                    AIBudgetAlert(
                        organisation_id=organisation_id,
                        period=period,
                        threshold=t,
                        spend_usd=round(spend, 2),
                        created_at=datetime.now(UTC),
                    )
                )
            created.append(t)
        except IntegrityError:
            continue  # another worker alerted concurrently
    if created:
        top = max(created)
        await _notify_admins(db, organisation_id, top, spend, r.budget_usd)
        log.info("ai.budget_alert", organisation_id=str(organisation_id), thresholds=created, spend=spend)
    return created


async def _notify_admins(
    db: AsyncSession, organisation_id: uuid.UUID, threshold: int, spend: float, budget: float
) -> None:
    from app.core.notify import notify
    from app.models.tenancy import MembershipStatus, OrganisationUser

    members = (
        await db.scalars(
            select(OrganisationUser).where(
                OrganisationUser.organisation_id == organisation_id,
                OrganisationUser.status == MembershipStatus.ACTIVE,
            )
        )
    ).all()
    admins = [
        m.user_id for m in members if any(p.code == "ai.manage" for role in m.roles for p in role.permissions)
    ]
    title = f"AI budget {threshold}% used" if threshold < 100 else "AI budget reached"
    body = (
        f"Your organisation has used ${spend:,.2f} of its ${budget:,.2f} monthly AI budget ({threshold}%)."
        + (
            " New AI requests are blocked until next month or the budget is raised."
            if threshold >= 100
            else ""
        )
    )
    for uid in admins:
        await notify(
            db,
            organisation_id=organisation_id,
            user_id=uid,
            type="ai_budget_alert",
            title=title,
            body=body,
            link="/app/admin/ai",
            data={"threshold": threshold, "spend_usd": round(spend, 2), "budget_usd": budget},
        )


# --------------------------------------------------------------------------- text / json generation


_INJECTION_SCAN_SOURCES = {"learner_message", "user_input", "submission", "answer", "reviewer_feedback"}


def _prepare_messages(
    system: str, messages: list[dict[str, Any]]
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    flags: dict[str, Any] = {}
    out: list[dict[str, str]] = [{"role": "system", "content": P.with_isolation(system or "")}]
    scans = []
    for m in messages:
        role = m.get("role", "user")
        content = str(m.get("content", ""))
        if role == "system":
            out.append({"role": "system", "content": content})
            continue
        if role == "user":
            trusted = bool(m.get("trusted")) or P.is_wrapped(content)
            if not trusted:
                scans.append(content)
                content = P.wrap_untrusted("user_input", content)
            else:
                for src, body in P.UNTRUSTED_RE.findall(content):
                    if src in _INJECTION_SCAN_SOURCES:
                        scans.append(body)
        out.append({"role": "assistant" if role == "assistant" else "user", "content": content})
    hits = [detect_injection(t) for t in scans]
    flagged = [h for h in hits if h.flagged]
    if flagged:
        flags["injection"] = {
            "flagged": True,
            "score": max(h.score for h in flagged),
            "matches": sorted({mm for h in flagged for mm in h.matches}),
        }
    return out, flags


async def _call(
    db: AsyncSession,
    *,
    organisation_id: uuid.UUID,
    user_id: uuid.UUID | None,
    feature: str,
    system: str,
    messages: list[dict[str, Any]],
    course_id: uuid.UUID | None,
    max_tokens: int | None,
    temperature: float | None,
    json_mode: bool,
    resolved: Resolved | None = None,
) -> AIResult:
    r = resolved or await resolve(db, organisation_id)
    check_feature(r, feature)
    spend = await check_limits(db, r, user_id, feature)
    prepared, flags = _prepare_messages(system, messages)
    if flags.get("injection"):
        log.warning(
            "ai.injection_flagged",
            organisation_id=str(organisation_id),
            feature=feature,
            matches=flags["injection"]["matches"],
        )
    provider = build_provider(r.provider)
    started = time.monotonic()
    try:
        res = await asyncio.wait_for(
            provider.chat(
                prepared,
                model=r.model,
                json_mode=json_mode,
                temperature=r.temperature if temperature is None else temperature,
                max_tokens=max_tokens or r.max_output_tokens,
            ),
            timeout=settings.AI_REQUEST_TIMEOUT_SECONDS + 5,
        )
    except (ProviderError, TimeoutError, OSError, ValueError) as exc:
        latency = int((time.monotonic() - started) * 1000)
        await record_usage(
            db,
            organisation_id=organisation_id,
            user_id=user_id,
            course_id=course_id,
            feature=feature,
            provider=r.provider,
            model=r.model,
            tokens_in=estimate_messages_tokens(prepared),
            tokens_out=0,
            cost_usd=0.0,
            latency_ms=latency,
            success=False,
            separate=True,
        )
        log.warning("ai.provider_failed", provider=r.provider, error=str(exc)[:300], feature=feature)
        raise AIUnavailable(
            "The AI service is temporarily unavailable. Please try again shortly.",
            details={"provider": r.provider},
        ) from exc
    latency = int((time.monotonic() - started) * 1000)
    tokens_in = res.tokens_in or estimate_messages_tokens(prepared)
    tokens_out = res.tokens_out or estimate_tokens(res.text)
    cost = estimate_cost(res.model or r.model, tokens_in, tokens_out, provider=r.provider)
    await record_usage(
        db,
        organisation_id=organisation_id,
        user_id=user_id,
        course_id=course_id,
        feature=feature,
        provider=r.provider,
        model=res.model or r.model,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=cost,
        latency_ms=latency,
        success=True,
    )
    if (
        r.budget_usd
        and cost > 0
        and any(100.0 * (spend + cost) / r.budget_usd >= t for t in r.alert_thresholds)
    ):
        await check_budget_alerts(db, organisation_id, resolved=r)
    return AIResult(
        text=res.text,
        model=res.model or r.model,
        provider=r.provider,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=cost,
        offline=r.offline,
        finish_reason=res.finish_reason,
        flags=flags,
    )


async def generate_text(
    db: AsyncSession,
    *,
    organisation_id: uuid.UUID,
    user_id: uuid.UUID | None,
    feature: str,
    system: str,
    messages: list[dict[str, Any]],
    course_id: uuid.UUID | None = None,
    max_tokens: int | None = None,
    temperature: float | None = None,
) -> AIResult:
    """Chat completion through the org's configured provider. Raises AIUnavailable (503) on provider
    failure, Forbidden (ai_feature_disabled), PaymentRequired (plan / ai_budget_exceeded),
    TooManyRequests (ai_daily_limit)."""
    return await _call(
        db,
        organisation_id=organisation_id,
        user_id=user_id,
        feature=feature,
        system=system,
        messages=messages,
        course_id=course_id,
        max_tokens=max_tokens,
        temperature=temperature,
        json_mode=False,
    )


async def generate_json_result(
    db: AsyncSession,
    *,
    organisation_id: uuid.UUID,
    user_id: uuid.UUID | None,
    feature: str,
    system: str,
    prompt: str,
    schema_hint: dict[str, Any],
    fallback: Callable[[], dict[str, Any]] | None = None,
    course_id: uuid.UUID | None = None,
    max_tokens: int | None = None,
    validator: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], AIResult | None]:
    """Like ``generate_json`` but also returns the AIResult (None when the fallback was used).

    ``validator`` (optional) normalises/validates the parsed object and raises ValueError when invalid; one
    repair round-trip is attempted before falling back."""
    r = await resolve(db, organisation_id)
    if P.parse_task(system) is None and r.offline and fallback is not None:
        # The offline provider only understands platform prompt types; for other prompts the caller's
        # deterministic fallback is the better offline answer. Still ledgered (zero cost).
        check_feature(r, feature)
        await check_limits(db, r, user_id, feature)
        await record_usage(
            db,
            organisation_id=organisation_id,
            user_id=user_id,
            course_id=course_id,
            feature=feature,
            provider="offline",
            model=OFFLINE_MODEL,
            tokens_in=estimate_tokens(system + prompt),
            tokens_out=0,
            cost_usd=0.0,
            latency_ms=0,
            success=True,
        )
        return fallback(), None
    full_system = system
    if "JSON" not in system or "schema" not in system.lower():
        full_system = (
            f"{system}\n\nReturn ONLY a JSON object matching this schema hint (no prose, no code "
            f"fences):\n{json.dumps(schema_hint, ensure_ascii=False)}"
        )
    messages: list[dict[str, Any]] = [{"role": "user", "content": prompt, "trusted": True}]
    last_error = ""
    result: AIResult | None = None
    for attempt in range(2):
        try:
            result = await _call(
                db,
                organisation_id=organisation_id,
                user_id=user_id,
                feature=feature,
                system=full_system,
                messages=messages,
                course_id=course_id,
                max_tokens=max_tokens,
                temperature=None,
                json_mode=True,
                resolved=r,
            )
        except AIUnavailable:
            if fallback is not None:
                return fallback(), None
            raise
        try:
            data = parse_json_object(result.text)
            if validator is not None:
                data = validator(data)
            return data, result
        except ValueError as exc:  # includes pydantic.ValidationError
            last_error = str(exc)[:800]
            if attempt == 0:
                messages = messages + [
                    {"role": "assistant", "content": result.text[:6000]},
                    {
                        "role": "user",
                        "trusted": True,
                        "content": "Your previous reply was not valid for the schema "
                        f"({last_error}). Return ONLY the corrected JSON object.",
                    },
                ]
    if fallback is not None:
        return fallback(), None
    raise AIUnavailable("The AI service returned an invalid response.", details={"error": last_error})


async def generate_json(
    db: AsyncSession,
    *,
    organisation_id: uuid.UUID,
    user_id: uuid.UUID | None,
    feature: str,
    system: str,
    prompt: str,
    schema_hint: dict[str, Any],
    fallback: Callable[[], dict[str, Any]] | None = None,
    course_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Structured generation. Parses/repairs JSON (one repair round-trip); on provider failure or invalid
    output uses ``fallback()`` when given, otherwise raises AIUnavailable. Gate errors (feature disabled,
    plan, budget, daily limit) always propagate."""
    data, _ = await generate_json_result(
        db,
        organisation_id=organisation_id,
        user_id=user_id,
        feature=feature,
        system=system,
        prompt=prompt,
        schema_hint=schema_hint,
        fallback=fallback,
        course_id=course_id,
    )
    return data


# --------------------------------------------------------------------------- embeddings


@dataclass
class Embedded:
    vectors: list[list[float]]
    model: str
    provider: str


def _embedding_provider(r: Resolved) -> tuple[str, str | None]:
    keys = server_keys()
    p = r.provider
    if p == "anthropic":  # no embeddings API — use OpenAI when available
        return ("openai", settings.AI_EMBEDDING_MODEL) if keys["openai"] else ("offline", None)
    if p == "azure_openai":
        return ("azure_openai", r.embedding_model) if r.embedding_model else ("offline", None)
    if p in ("openai", "google", "local"):
        return p, r.embedding_model or (settings.AI_EMBEDDING_MODEL if p == "openai" else None)
    return "offline", None


def _fit(vec: list[float], dim: int) -> list[float]:
    if len(vec) == dim:
        return vec
    return (vec + [0.0] * dim)[:dim]


async def embed_texts(
    db: AsyncSession, *, organisation_id: uuid.UUID, texts: list[str], resolved: Resolved | None = None
) -> Embedded:
    """Embed with the org's embedding provider (offline hashing embeddings when no provider is available or
    the budget is exhausted — retrieval keeps working). Records a usage row per call."""
    if not texts:
        return Embedded([], OFFLINE_EMBEDDING_MODEL, "offline")
    r = resolved or await resolve(db, organisation_id)
    pname, model = _embedding_provider(r)
    if pname != "offline" and r.budget_usd is not None and r.hard_limit:
        if await month_spend(db, organisation_id) >= r.budget_usd:
            pname, model = "offline", None
    dim = settings.AI_EMBEDDING_DIM
    started = time.monotonic()
    vectors: list[list[float]] = []
    used_model = OFFLINE_EMBEDDING_MODEL
    tokens = 0
    if pname != "offline":
        provider = build_provider(pname)
        try:
            for i in range(0, len(texts), 64):
                res = await provider.embed([t[:24000] for t in texts[i : i + 64]], model=model)
                vectors.extend(_fit(v, dim) for v in res.vectors)
                used_model = res.model
                tokens += res.tokens_in or sum(estimate_tokens(t) for t in texts[i : i + 64])
        except (ProviderError, OSError, ValueError) as exc:
            log.warning("ai.embedding_failed_fallback_offline", provider=pname, error=str(exc)[:200])
            await record_usage(
                db,
                organisation_id=organisation_id,
                user_id=None,
                course_id=None,
                feature="embedding",
                provider=pname,
                model=model or "",
                tokens_in=0,
                tokens_out=0,
                cost_usd=0.0,
                latency_ms=int((time.monotonic() - started) * 1000),
                success=False,
                separate=True,
            )
            pname, vectors, tokens = "offline", [], 0
    if pname == "offline":
        res = await build_provider("offline").embed(texts)
        vectors, used_model, tokens = [_fit(v, dim) for v in res.vectors], res.model, res.tokens_in
    cost = estimate_cost(used_model, tokens, 0, provider=pname)
    await record_usage(
        db,
        organisation_id=organisation_id,
        user_id=None,
        course_id=None,
        feature="embedding",
        provider=pname,
        model=used_model,
        tokens_in=tokens,
        tokens_out=0,
        cost_usd=cost,
        latency_ms=int((time.monotonic() - started) * 1000),
        success=True,
    )
    return Embedded(vectors, used_model, pname)


async def embed(db: AsyncSession, *, organisation_id: uuid.UUID, texts: list[str]) -> list[list[float]]:
    return (await embed_texts(db, organisation_id=organisation_id, texts=texts)).vectors


# --------------------------------------------------------------------------- retrieval


def _snippet(text: str, query: str, size: int = 280) -> str:
    from praxis_ai.text import overlap, sentences

    ss = sentences(text)
    if not ss:
        return text[:size]
    best = max(range(len(ss)), key=lambda i: overlap(query, ss[i]))
    snip = ss[best]
    j = best + 1
    while len(snip) < size // 2 and j < len(ss):
        snip += " " + ss[j]
        j += 1
    return snip[:size]


def _tsquery_terms(query: str) -> str:
    from praxis_ai.text import STOPWORDS

    words = [w for w in re.findall(r"[a-z0-9]+", query.lower()) if w not in STOPWORDS and len(w) > 1]
    return " | ".join(dict.fromkeys(words[:12]))


async def retrieve(
    db: AsyncSession,
    *,
    organisation_id: uuid.UUID,
    query: str,
    course_id: uuid.UUID | None = None,
    k: int = 5,
    approved_only: bool = True,
) -> list[RetrievedChunk]:
    """Hybrid retrieval over knowledge_chunks: pgvector cosine (``<=>``) restricted to chunks embedded with
    the current embedding model, course-scoped chunks boosted over org-wide ones, plus a PostgreSQL
    full-text keyword fallback when vector hits are few or weak."""
    query = (query or "").strip()
    if not query:
        return []
    emb = await embed_texts(db, organisation_id=organisation_id, texts=[query])
    qvec = emb.vectors[0]
    base = [
        KnowledgeChunk.organisation_id == organisation_id,
        KnowledgeDocument.deleted_at.is_(None),
        KnowledgeDocument.status == "ready",
    ]
    if approved_only:
        base.append(KnowledgeDocument.approved.is_(True))
    if course_id is not None:
        base.append(or_(KnowledgeChunk.course_id == course_id, KnowledgeChunk.course_id.is_(None)))
    dist = KnowledgeChunk.embedding.cosine_distance(qvec).label("dist")
    stmt = (
        select(KnowledgeChunk, KnowledgeDocument.title, dist)
        .join(KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id)
        .where(
            and_(*base), KnowledgeChunk.embedding.is_not(None), KnowledgeChunk.embedding_model == emb.model
        )
        .order_by(dist)
        .limit(max(k * 3, 10))
    )
    results: dict[uuid.UUID, RetrievedChunk] = {}
    for chunk, title, d in (await db.execute(stmt)).all():
        score = 1.0 - float(d)
        if course_id is not None and chunk.course_id == course_id:
            score += 0.05
        if score < 0.1:
            continue
        results[chunk.id] = RetrievedChunk(
            chunk_id=chunk.id,
            document_id=chunk.document_id,
            title=title,
            heading=chunk.heading,
            snippet=_snippet(chunk.content, query),
            content=chunk.content,
            score=round(score, 4),
            course_id=chunk.course_id,
        )
    ranked = sorted(results.values(), key=lambda c: -c.score)
    if len(ranked) < k or (ranked and ranked[0].score < 0.3):
        terms = _tsquery_terms(query)
        if terms:
            tsv = func.to_tsvector("english", KnowledgeChunk.content)
            tsq = func.to_tsquery("english", terms)
            rank = func.ts_rank_cd(tsv, tsq).label("rank")
            kstmt = (
                select(KnowledgeChunk, KnowledgeDocument.title, rank)
                .join(KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id)
                .where(and_(*base), tsv.op("@@")(tsq))
                .order_by(rank.desc())
                .limit(k * 2)
            )
            for chunk, title, rk in (await db.execute(kstmt)).all():
                if chunk.id in results:
                    continue
                score = min(0.6, 0.2 + float(rk))
                if course_id is not None and chunk.course_id == course_id:
                    score += 0.05
                results[chunk.id] = RetrievedChunk(
                    chunk_id=chunk.id,
                    document_id=chunk.document_id,
                    title=title,
                    heading=chunk.heading,
                    snippet=_snippet(chunk.content, query),
                    content=chunk.content,
                    score=round(score, 4),
                    course_id=chunk.course_id,
                    source="keyword",
                )
        ranked = sorted(results.values(), key=lambda c: -c.score)
    return ranked[:k]


async def semantic_search(
    db: AsyncSession, *, organisation_id: uuid.UUID, query: str, k: int = 10, approved_only: bool = True
) -> list[dict]:
    """Knowledge-base search for global search: best chunk per document. Only approved documents by
    default, because global search is visible to learners (pass ``approved_only=False`` for staff views)."""
    chunks = await retrieve(
        db, organisation_id=organisation_id, query=query, k=k * 3, approved_only=approved_only
    )
    out: list[dict] = []
    seen: set[uuid.UUID] = set()
    for c in chunks:
        if c.document_id in seen:
            continue
        seen.add(c.document_id)
        out.append(
            {
                "type": "knowledge",
                "id": str(c.chunk_id),
                "title": c.title,
                "snippet": c.snippet,
                "document_id": str(c.document_id),
                "course_id": str(c.course_id) if c.course_id else None,
                "score": c.score,
                "link": f"/app/instructor/knowledge?document={c.document_id}",
            }
        )
        if len(out) >= k:
            break
    return out
