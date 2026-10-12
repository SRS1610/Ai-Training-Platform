"""Finishing touches after the API-driven build: backdating, derived history and records with no API
(subscriptions, Stripe payments, historical AI usage)."""

from __future__ import annotations

import random
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from praxis_ai.pricing import estimate_cost
from sqlalchemy import insert, select, text

from app.core.db import get_sessionmaker
from app.models.ai import AIUsage
from app.models.platform import Certificate, Payment, Subscription
from app.models.tenancy import Organisation
from app.seed.timeline import Timeline

# Seconds credited per activity when rebuilding activity_days from the backdated event timestamps.
_ACTIVITY_SQL = """
WITH ev AS (
    SELECT lp.organisation_id AS org, lp.user_id AS uid, coalesce(lp.completed_at, lp.updated_at) AS at,
           greatest(lp.time_spent_seconds, 60) AS secs
      FROM lesson_progress lp WHERE lp.organisation_id = ANY(:orgs)
    UNION ALL
    SELECT a.organisation_id, a.user_id, a.started_at,
           coalesce(extract(epoch FROM a.submitted_at - a.started_at)::int, 300)
      FROM assessment_attempts a WHERE a.organisation_id = ANY(:orgs)
    UNION ALL
    SELECT s.organisation_id, s.user_id, s.started_at,
           coalesce(extract(epoch FROM s.completed_at - s.started_at)::int, 900)
      FROM simulation_sessions s WHERE s.organisation_id = ANY(:orgs)
    UNION ALL
    SELECT sb.organisation_id, sb.user_id, sb.submitted_at, 2400
      FROM submissions sb WHERE sb.organisation_id = ANY(:orgs) AND sb.submitted_at IS NOT NULL
    UNION ALL
    SELECT m.organisation_id, s.user_id, m.created_at, 120
      FROM ai_messages m JOIN ai_sessions s ON s.id = m.session_id
     WHERE m.organisation_id = ANY(:orgs) AND m.role = 'user'
)
INSERT INTO activity_days (id, organisation_id, user_id, day, events, seconds)
SELECT gen_random_uuid(), org, uid, day, count(*), least(sum(secs), 6 * 3600)
  FROM (SELECT ev.org, ev.uid, (ev.at AT TIME ZONE coalesce(u.timezone, 'UTC'))::date AS day, ev.secs
          FROM ev JOIN users u ON u.id = ev.uid WHERE ev.at IS NOT NULL) d
 GROUP BY org, uid, day
"""


async def finalise(
    timeline: Timeline, org_ids: list[uuid.UUID], user_ids: list[uuid.UUID], rng: random.Random
) -> dict[str, Any]:
    """Apply the timeline and rebuild the history derived from it."""
    from app.modules.certificates.service import compute_hash

    stats: dict[str, Any] = {}
    async with get_sessionmaker()() as db:
        db.info["rls_bypass"] = True
        await db.execute(text("SELECT set_config('app.rls_bypass', 'on', true)"))
        params = {"orgs": org_ids, "users": user_ids}
        # Realistic time on task: per-lesson time proportional to the lesson's planned duration.
        await db.execute(
            text(
                """
            UPDATE lesson_progress lp
               SET time_spent_seconds = greatest(lp.time_spent_seconds,
                   (l.duration_minutes * 60 * (0.7 + random() * 0.6))::int)
              FROM lessons l
             WHERE l.id = lp.lesson_id AND lp.status = 'completed' AND lp.organisation_id = ANY(:orgs)
            """
            ),
            params,
        )
        stats["columns_backdated"] = await timeline.apply(db, org_ids, user_ids)
        await db.execute(
            text(
                """
            UPDATE enrolments e SET time_spent_seconds = coalesce(t.secs, 0)
              FROM (SELECT enrolment_id, sum(time_spent_seconds) AS secs FROM lesson_progress
                     GROUP BY enrolment_id) t
             WHERE t.enrolment_id = e.id AND e.organisation_id = ANY(:orgs)
            """
            ),
            params,
        )
        # Derived timestamps that were computed from "now" when the API wrote them.
        await db.execute(
            text(
                """
            UPDATE assessment_attempts SET expires_at = started_at
                   + ((settings_snapshot->>'time_limit_minutes')::int * interval '1 minute')
             WHERE organisation_id = ANY(:orgs) AND expires_at IS NOT NULL
               AND settings_snapshot->>'time_limit_minutes' IS NOT NULL
            """
            ),
            params,
        )
        await db.execute(text("DELETE FROM activity_days WHERE organisation_id = ANY(:orgs)"), params)
        await db.execute(text(_ACTIVITY_SQL), params)
        await db.execute(
            text(
                """
            UPDATE users u SET email_verified_at = u.created_at + interval '7 minutes',
                   last_login_at = greatest(coalesce(a.last_day, u.created_at), u.created_at)
              FROM (SELECT user_id, max(day)::timestamptz + interval '9 hours' AS last_day
                      FROM activity_days GROUP BY user_id) a
             WHERE a.user_id = u.id AND u.id = ANY(:users)
            """
            ),
            params,
        )
        await db.execute(
            text(
                "UPDATE users SET email_verified_at = created_at + interval '7 minutes' "
                "WHERE id = ANY(:users) AND email_verified_at IS NULL"
            ),
            params,
        )
        # Older notifications have been read.
        await db.execute(
            text(
                "UPDATE notifications SET read_at = created_at + interval '3 hours' "
                "WHERE organisation_id = ANY(:orgs) AND created_at < now() - interval '4 days' "
                "AND read_at IS NULL"
            ),
            params,
        )
        # Certificates: re-sign the backdated facts; the PDF is regenerated on first download.
        certs = (
            (await db.execute(select(Certificate).where(Certificate.organisation_id.in_(org_ids))))
            .scalars()
            .all()
        )
        for c in certs:
            c.verification_hash = compute_hash(c)
            c.pdf_file_id = None
        stats["certificates"] = len(certs)
        await db.commit()
    return stats


async def billing_and_usage(
    nw: uuid.UUID,
    contoso: uuid.UUID,
    nw_users: list[uuid.UUID],
    nw_courses: list[uuid.UUID],
    rng: random.Random,
) -> dict[str, Any]:
    """Subscriptions, paid invoices and a month of historical AI usage (no API creates these)."""
    now = datetime.now(UTC)
    out: dict[str, Any] = {}
    async with get_sessionmaker()() as db:
        db.info["rls_bypass"] = True
        await db.execute(text("SELECT set_config('app.rls_bypass', 'on', true)"))
        year_start = now.replace(month=7, day=1, hour=0, minute=0, second=0, microsecond=0)
        if year_start > now:
            year_start = year_start.replace(year=now.year - 1)
        db.add(
            Subscription(
                organisation_id=nw,
                plan_code="enterprise",
                status="active",
                billing_interval="year",
                seats=60,
                stripe_customer_id="cus_demoNorthwind01",
                stripe_subscription_id="sub_demoNorthwind01",
                current_period_start=year_start,
                current_period_end=year_start.replace(year=year_start.year + 1),
            )
        )
        db.add(
            Payment(
                organisation_id=nw,
                stripe_invoice_id="in_demoNW2026A",
                amount_cents=4_320_000,
                currency="aud",
                status="paid",
                description="Praxis Enterprise – annual licence, 60 seats (FY2026/27)",
                period_start=year_start,
                period_end=year_start.replace(year=year_start.year + 1),
                paid_at=year_start + timedelta(days=12),
                hosted_invoice_url="https://example.com/praxis-demo-placeholder/invoices/in_demoNW2026A",
                created_at=year_start,
                updated_at=year_start + timedelta(days=12),
            )
        )
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        db.add(
            Subscription(
                organisation_id=contoso,
                plan_code="business",
                status="active",
                billing_interval="month",
                seats=5,
                stripe_customer_id="cus_demoContoso01",
                stripe_subscription_id="sub_demoContoso01",
                current_period_start=month_start,
                current_period_end=(month_start + timedelta(days=32)).replace(day=1),
            )
        )
        start = month_start
        for i in range(4):
            start = (start - timedelta(days=1)).replace(day=1) if i else month_start
            end = (start + timedelta(days=32)).replace(day=1)
            db.add(
                Payment(
                    organisation_id=contoso,
                    stripe_invoice_id=f"in_demoContoso{start:%Y%m}",
                    amount_cents=5 * 2900,
                    currency="aud",
                    status="paid",
                    description=f"Praxis Business – 5 seats ({start:%B %Y})",
                    period_start=start,
                    period_end=end,
                    paid_at=start + timedelta(hours=2),
                    hosted_invoice_url=f"https://example.com/praxis-demo-placeholder/invoices/contoso-{start:%Y%m}",
                    created_at=start,
                    updated_at=start + timedelta(hours=2),
                )
            )
        out["payments"] = 5

        # Historical AI usage: 45 days of realistic gpt-4o-mini traffic (weekday-heavy), bulk inserted.
        features = [  # feature, weight, tokens_in range, tokens_out range, model
            ("tutor", 0.46, (1200, 4200), (180, 700), "gpt-4o-mini"),
            ("grading", 0.16, (1800, 5200), (300, 900), "gpt-4o-mini"),
            ("content_generation", 0.04, (3000, 9000), (3000, 9000), "gpt-4o-mini"),
            ("simulation_character", 0.22, (900, 2400), (60, 220), "gpt-4o-mini"),
            ("recommendations", 0.04, (1500, 3000), (200, 600), "gpt-4o-mini"),
            ("embedding", 0.08, (400, 3000), (0, 0), "text-embedding-3-small"),
        ]
        weights = [f[1] for f in features]
        rows: list[dict[str, Any]] = []
        for day in range(45, 0, -1):
            when = now - timedelta(days=day)
            weekday = when.weekday() < 5
            ramp = 0.6 + 0.4 * (45 - day) / 45  # adoption grows over the period
            n = int((rng.randint(260, 420) if weekday else rng.randint(30, 70)) * ramp)
            for _ in range(n):
                feat, _w, tin, tout, model = rng.choices(features, weights=weights)[0]
                ti, to = rng.randint(*tin), (rng.randint(*tout) if tout[1] else 0)
                at = when.replace(
                    hour=rng.choice((22, 23, 0, 0, 1, 1, 2, 3, 3, 4, 5, 6, 7)),
                    minute=rng.randint(0, 59),
                    second=rng.randint(0, 59),
                )
                rows.append(
                    {
                        "id": uuid.uuid4(),
                        "organisation_id": nw,
                        "created_at": at,
                        "user_id": rng.choice(nw_users),
                        "course_id": rng.choice(nw_courses)
                        if feat != "embedding" and rng.random() < 0.8
                        else None,
                        "feature": feat,
                        "provider": "openai",
                        "model": model,
                        "tokens_in": ti,
                        "tokens_out": to,
                        "cost_usd": round(estimate_cost(model, ti, to), 6),
                        "latency_ms": rng.randint(450, 4200),
                        "success": rng.random() > 0.01,
                    }
                )
            for _ in range(rng.randint(4, 12) if weekday else 1):
                ti, to = rng.randint(900, 2500), rng.randint(150, 450)
                rows.append(
                    {
                        "id": uuid.uuid4(),
                        "organisation_id": contoso,
                        "created_at": when.replace(hour=rng.randint(0, 7)),
                        "user_id": None,
                        "course_id": None,
                        "feature": "tutor",
                        "provider": "openai",
                        "model": "gpt-4o-mini",
                        "tokens_in": ti,
                        "tokens_out": to,
                        "cost_usd": round(estimate_cost("gpt-4o-mini", ti, to), 6),
                        "latency_ms": 900,
                        "success": True,
                    }
                )
        await db.execute(insert(AIUsage), rows)
        rows = len(rows)  # type: ignore[assignment]
        out["ai_usage_rows"] = rows
        await db.commit()
    return out


async def mark_seeded(org_id: uuid.UUID, profile: str, summary: dict[str, Any]) -> None:
    async with get_sessionmaker()() as db:
        db.info["rls_bypass"] = True
        org = await db.get(Organisation, org_id)
        org.settings = {
            **(org.settings or {}),
            "demo_seed": {"profile": profile, "seeded_at": datetime.now(UTC).isoformat(), "version": 1},
        }
        await db.commit()


async def find_seed(org_name: str) -> dict[str, Any] | None:
    """The seed marker of the demo organisation, ``{}`` if it exists unmarked, None if absent."""
    async with get_sessionmaker()() as db:
        db.info["rls_bypass"] = True
        org = await db.scalar(
            select(Organisation).where(Organisation.name == org_name, Organisation.deleted_at.is_(None))
        )
        if org is None:
            return None
        return dict((org.settings or {}).get("demo_seed") or {})
