"""Skills catalogue, competencies (skill requirement sets) and learner skill profiles."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import Ctx
from app.core.errors import BadRequest, Conflict, NotFound
from app.models.content import Competency, LearnerSkill, Skill
from app.modules.skills import schemas as s

EWMA_ALPHA = 0.5  # weight of the newest evidence in proficiency
HISTORY_LIMIT = 50


async def list_skills(ctx: Ctx, search: str | None, category: str | None) -> list[Skill]:
    stmt = select(Skill).where(Skill.organisation_id == ctx.org_id)
    if search:
        stmt = stmt.where(Skill.name.ilike(f"%{search}%"))
    if category:
        stmt = stmt.where(Skill.category == category)
    return list((await ctx.db.execute(stmt.order_by(Skill.category.nulls_last(), Skill.name))).scalars())


async def get_skill(ctx: Ctx, skill_id: uuid.UUID) -> Skill:
    skill = await ctx.db.scalar(
        select(Skill).where(Skill.id == skill_id, Skill.organisation_id == ctx.org_id)
    )
    if skill is None:
        raise NotFound("Skill not found")
    return skill


async def _unique_name(ctx: Ctx, name: str, exclude: uuid.UUID | None = None) -> None:
    stmt = select(Skill.id).where(Skill.organisation_id == ctx.org_id, Skill.name == name)
    if exclude:
        stmt = stmt.where(Skill.id != exclude)
    if await ctx.db.scalar(stmt):
        raise Conflict("A skill with this name already exists", code="skill_exists")


async def create_skill(ctx: Ctx, body: s.SkillIn) -> Skill:
    name = body.name.strip()
    await _unique_name(ctx, name)
    skill = Skill(organisation_id=ctx.org_id, name=name, category=body.category, description=body.description)
    ctx.db.add(skill)
    try:
        await ctx.db.flush()
    except IntegrityError as exc:  # concurrent duplicate
        raise Conflict("A skill with this name already exists", code="skill_exists") from exc
    await ctx.db.refresh(skill)
    await ctx.audit("skill.created", "skill", skill.id, name=name)
    return skill


async def update_skill(ctx: Ctx, skill_id: uuid.UUID, body: s.SkillUpdate) -> Skill:
    skill = await get_skill(ctx, skill_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("name"):
        data["name"] = data["name"].strip()
        await _unique_name(ctx, data["name"], exclude=skill.id)
    for k, v in data.items():
        if k == "name" and v is None:
            continue
        setattr(skill, k, v)
    await ctx.db.flush()
    await ctx.db.refresh(skill)
    await ctx.audit("skill.updated", "skill", skill.id, fields=sorted(data))
    return skill


async def delete_skill(ctx: Ctx, skill_id: uuid.UUID) -> None:
    skill = await get_skill(ctx, skill_id)
    await ctx.db.delete(skill)
    await ctx.db.flush()
    await ctx.audit("skill.deleted", "skill", skill_id, name=skill.name)


# ----------------------------------------------------------------------------- competencies


async def _skill_names(db: AsyncSession, org_id: uuid.UUID, ids: set[uuid.UUID]) -> dict[uuid.UUID, Skill]:
    if not ids:
        return {}
    rows = (
        await db.execute(select(Skill).where(Skill.organisation_id == org_id, Skill.id.in_(ids)))
    ).scalars()
    return {sk.id: sk for sk in rows}


async def _validate_requirements(ctx: Ctx, reqs: list[s.Requirement]) -> list[dict[str, Any]]:
    ids = {r.skill_id for r in reqs}
    if len(ids) != len(reqs):
        raise BadRequest("Each skill may appear only once in a competency", code="duplicate_skill")
    found = await _skill_names(ctx.db, ctx.org_id, ids)
    missing = ids - set(found)
    if missing:
        raise BadRequest(
            "One or more skills were not found",
            code="invalid_skill",
            details={"skill_ids": [str(m) for m in missing]},
        )
    return [{"skill_id": str(r.skill_id), "min_level": r.min_level} for r in reqs]


def _req_skill_ids(comps: list[Competency]) -> set[uuid.UUID]:
    out: set[uuid.UUID] = set()
    for c in comps:
        for r in c.requirements or []:
            try:
                out.add(uuid.UUID(str(r.get("skill_id"))))
            except (ValueError, TypeError):
                continue
    return out


def _competency_out(c: Competency, skills: dict[uuid.UUID, Skill]) -> s.CompetencyOut:
    reqs = []
    for r in c.requirements or []:
        sid = uuid.UUID(str(r["skill_id"]))
        sk = skills.get(sid)
        reqs.append(
            s.RequirementOut(
                skill_id=sid, skill_name=sk.name if sk else None, min_level=float(r.get("min_level", 70))
            )
        )
    return s.CompetencyOut(
        id=c.id, name=c.name, description=c.description, requirements=reqs, created_at=c.created_at
    )


async def list_competencies(ctx: Ctx) -> list[s.CompetencyOut]:
    comps = list(
        (
            await ctx.db.execute(
                select(Competency).where(Competency.organisation_id == ctx.org_id).order_by(Competency.name)
            )
        ).scalars()
    )
    skills = await _skill_names(ctx.db, ctx.org_id, _req_skill_ids(comps))
    return [_competency_out(c, skills) for c in comps]


async def get_competency(ctx: Ctx, competency_id: uuid.UUID) -> Competency:
    c = await ctx.db.scalar(
        select(Competency).where(Competency.id == competency_id, Competency.organisation_id == ctx.org_id)
    )
    if c is None:
        raise NotFound("Competency not found")
    return c


async def competency_out(ctx: Ctx, c: Competency) -> s.CompetencyOut:
    return _competency_out(c, await _skill_names(ctx.db, ctx.org_id, _req_skill_ids([c])))


async def create_competency(ctx: Ctx, body: s.CompetencyIn) -> Competency:
    c = Competency(
        organisation_id=ctx.org_id,
        name=body.name.strip(),
        description=body.description,
        requirements=await _validate_requirements(ctx, body.requirements),
    )
    ctx.db.add(c)
    await ctx.db.flush()
    await ctx.db.refresh(c)
    await ctx.audit("competency.created", "competency", c.id, name=c.name)
    return c


async def update_competency(ctx: Ctx, competency_id: uuid.UUID, body: s.CompetencyUpdate) -> Competency:
    c = await get_competency(ctx, competency_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("name"):
        c.name = data["name"].strip()
    if "description" in data:
        c.description = data["description"]
    if body.requirements is not None:
        c.requirements = await _validate_requirements(ctx, body.requirements)
    await ctx.db.flush()
    await ctx.db.refresh(c)
    await ctx.audit("competency.updated", "competency", c.id, fields=sorted(data))
    return c


async def delete_competency(ctx: Ctx, competency_id: uuid.UUID) -> None:
    c = await get_competency(ctx, competency_id)
    await ctx.db.delete(c)
    await ctx.db.flush()
    await ctx.audit("competency.deleted", "competency", competency_id)


# ----------------------------------------------------------------------------- learner profile


async def my_skills(ctx: Ctx) -> s.MySkillsOut:
    rows = (
        await ctx.db.execute(
            select(LearnerSkill, Skill)
            .join(Skill, Skill.id == LearnerSkill.skill_id)
            .where(LearnerSkill.organisation_id == ctx.org_id, LearnerSkill.user_id == ctx.user_id)
            .order_by(LearnerSkill.proficiency.desc(), Skill.name)
        )
    ).all()
    levels = {ls.skill_id: ls.proficiency for ls, _ in rows}
    skills = [
        s.MySkill(
            skill_id=sk.id,
            name=sk.name,
            category=sk.category,
            proficiency=round(ls.proficiency, 1),
            evidence_count=ls.evidence_count,
            last_assessed_at=ls.last_assessed_at,
        )
        for ls, sk in rows
    ]
    comps = list(
        (
            await ctx.db.execute(
                select(Competency).where(Competency.organisation_id == ctx.org_id).order_by(Competency.name)
            )
        ).scalars()
    )
    names = await _skill_names(ctx.db, ctx.org_id, _req_skill_ids(comps))
    out = []
    for c in comps:
        reqs = []
        for r in c.requirements or []:
            sid = uuid.UUID(str(r["skill_id"]))
            level = float(levels.get(sid, 0.0))
            need = float(r.get("min_level", 70))
            reqs.append(
                s.RequirementProgress(
                    skill_id=sid,
                    skill_name=names[sid].name if sid in names else None,
                    min_level=need,
                    proficiency=round(level, 1),
                    met=level >= need,
                )
            )
        met = sum(1 for r in reqs if r.met)
        out.append(
            s.MyCompetency(
                id=c.id,
                name=c.name,
                description=c.description,
                attained=bool(reqs) and met == len(reqs),
                progress_pct=round(100.0 * met / len(reqs), 1) if reqs else 0.0,
                requirements=reqs,
            )
        )
    return s.MySkillsOut(skills=skills, competencies=out)


async def record_evidence(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    skill_ids: list[uuid.UUID],
    score: float,
    *,
    source: str,
    ref_id: Any,
) -> None:
    """Fold a new score (0-100) into each skill's proficiency (exponentially weighted)."""
    if not skill_ids:
        return
    existing = {
        ls.skill_id: ls
        for ls in (
            await db.execute(
                select(LearnerSkill).where(
                    LearnerSkill.organisation_id == org_id,
                    LearnerSkill.user_id == user_id,
                    LearnerSkill.skill_id.in_(skill_ids),
                )
            )
        ).scalars()
    }
    now = datetime.now(UTC)
    score = max(0.0, min(100.0, float(score)))
    entry = {"source": source, "ref_id": str(ref_id), "score": score, "at": now.isoformat()}
    for sid in skill_ids:
        ls = existing.get(sid)
        if ls is None:
            db.add(
                LearnerSkill(
                    organisation_id=org_id,
                    user_id=user_id,
                    skill_id=sid,
                    proficiency=score,
                    evidence_count=1,
                    last_assessed_at=now,
                    history=[entry],
                )
            )
        else:
            ls.proficiency = round(EWMA_ALPHA * score + (1 - EWMA_ALPHA) * (ls.proficiency or 0.0), 2)
            ls.evidence_count = (ls.evidence_count or 0) + 1
            ls.last_assessed_at = now
            ls.history = ([*(ls.history or []), entry])[-HISTORY_LIMIT:]
    await db.flush()
