"""/simulations (authoring, builder, publishing, analytics) and /simulation-sessions (learner play)."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Ctx, get_ctx, require_permission
from app.core.pagination import Page, PageParams, page_params
from app.modules.simulations import schemas as s
from app.modules.simulations import service as svc

router = APIRouter()
sims = APIRouter(prefix="/simulations", tags=["simulations"])
sessions = APIRouter(prefix="/simulation-sessions", tags=["simulation-sessions"])

manage = require_permission(svc.MANAGE)
learner = require_permission("learning.access")
viewer = require_permission(svc.MANAGE, "learning.access", any_of=True)
insight = require_permission(*svc.ANALYTICS_PERMS, any_of=True)
reviewer = require_permission(*svc.REVIEW_PERMS, any_of=True)


# ---------------------------------------------------------------------------------------------- authoring


@sims.get("/templates", response_model=list[s.TemplateOut])
async def list_templates(ctx: Ctx = Depends(manage)) -> Any:
    return svc.templates()


@sims.post("/ai-build", response_model=s.AIBuildOut, status_code=201)
async def ai_build(body: s.AIBuildIn, ctx: Ctx = Depends(manage)) -> Any:
    """Generate a DRAFT simulation from a description (AI gateway or deterministic fallback).
    Never publishes."""
    return await svc.ai_build(ctx, body)


@sims.get("", response_model=Page[s.SimulationOut])
async def list_simulations(
    status: str | None = Query(None, max_length=16),
    course_id: uuid.UUID | None = None,
    industry: str | None = Query(None, max_length=64),
    search: str | None = Query(None, max_length=200),
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(viewer),
) -> Any:
    items, total = await svc.list_simulations(
        ctx, params, status=status, course_id=course_id, industry=industry, search=search
    )
    return Page(
        items=[await svc.simulation_out(ctx, x) for x in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@sims.post("", response_model=s.SimulationOut, status_code=201)
async def create_simulation(body: s.SimulationCreate, ctx: Ctx = Depends(manage)) -> Any:
    return await svc.simulation_out(ctx, await svc.create_simulation(ctx, body))


@sims.post("/from-template", response_model=s.SimulationOut, status_code=201)
async def create_from_template(body: s.FromTemplate, ctx: Ctx = Depends(manage)) -> Any:
    sim = await svc.create_simulation(
        ctx, s.SimulationCreate(template_key=body.template_key, title=body.title, course_id=body.course_id)
    )
    return await svc.simulation_out(ctx, sim)


@sims.get("/{sim_id}", response_model=s.SimulationOut)
async def get_simulation(sim_id: uuid.UUID, ctx: Ctx = Depends(viewer)) -> Any:
    return await svc.simulation_out(ctx, await svc.get_visible_simulation(ctx, sim_id))


@sims.patch("/{sim_id}", response_model=s.SimulationOut)
async def update_simulation(sim_id: uuid.UUID, body: s.SimulationUpdate, ctx: Ctx = Depends(manage)) -> Any:
    return await svc.simulation_out(ctx, await svc.update_simulation(ctx, sim_id, body))


@sims.delete("/{sim_id}", status_code=204)
async def delete_simulation(sim_id: uuid.UUID, ctx: Ctx = Depends(manage)) -> Response:
    await svc.delete_simulation(ctx, sim_id)
    return Response(status_code=204)


@sims.get("/{sim_id}/draft", response_model=s.DraftOut)
async def get_draft(sim_id: uuid.UUID, ctx: Ctx = Depends(manage)) -> Any:
    return await svc.get_draft(ctx, sim_id)


@sims.put("/{sim_id}/draft", response_model=s.DraftOut)
async def save_draft(sim_id: uuid.UUID, body: s.DraftIn, ctx: Ctx = Depends(manage)) -> Any:
    """Save the draft definition. Structural (schema) errors are rejected with 422; semantic errors are
    allowed in drafts and returned in ``validation`` (publishing requires a valid definition)."""
    return await svc.save_draft(ctx, sim_id, body.definition)


@sims.get("/{sim_id}/graph", response_model=s.GraphOut)
async def get_graph(sim_id: uuid.UUID, ctx: Ctx = Depends(manage)) -> Any:
    return await svc.get_graph(ctx, sim_id)


@sims.put("/{sim_id}/graph", response_model=s.GraphOut)
async def save_graph(sim_id: uuid.UUID, body: s.GraphIn, ctx: Ctx = Depends(manage)) -> Any:
    return await svc.save_graph(ctx, sim_id, body.graph)


@sims.post("/{sim_id}/validate", response_model=s.ValidationOut)
async def validate_definition(
    sim_id: uuid.UUID, body: s.ValidateIn | None = None, ctx: Ctx = Depends(manage)
) -> Any:
    return await svc.validate_definition(ctx, sim_id, body.definition if body else None)


@sims.post("/{sim_id}/publish", response_model=s.PublishOut)
async def publish(sim_id: uuid.UUID, ctx: Ctx = Depends(manage)) -> Any:
    return await svc.publish(ctx, sim_id)


@sims.get("/{sim_id}/versions", response_model=list[s.VersionOut])
async def list_versions(sim_id: uuid.UUID, ctx: Ctx = Depends(manage)) -> Any:
    return await svc.list_versions(ctx, sim_id)


@sims.get("/{sim_id}/versions/{version}", response_model=s.VersionDetail)
async def get_version(sim_id: uuid.UUID, version: int, ctx: Ctx = Depends(manage)) -> Any:
    return await svc.get_version(ctx, sim_id, version)


@sims.get("/{sim_id}/analytics")
async def simulation_analytics(sim_id: uuid.UUID, ctx: Ctx = Depends(insight)) -> dict[str, Any]:
    return await svc.analytics(ctx, sim_id)


@sims.get("/{sim_id}/sessions", response_model=Page[s.SessionSummary])
async def simulation_sessions(
    sim_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(reviewer),
) -> Any:
    items, total = await svc.list_simulation_sessions(ctx, sim_id, params, user_id)
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


# ---------------------------------------------------------------------------------------------- learner


@sims.post("/{sim_id}/sessions", response_model=s.SessionOut, status_code=201)
async def start_session(
    sim_id: uuid.UUID, body: s.SessionStart | None = None, ctx: Ctx = Depends(learner)
) -> Any:
    """Start (or resume the active) attempt of a published simulation."""
    return await svc.start_session(ctx, sim_id, body or s.SessionStart())


@sessions.get("", response_model=Page[s.SessionSummary])
async def my_sessions(
    simulation_id: uuid.UUID | None = None,
    params: PageParams = Depends(page_params),
    ctx: Ctx = Depends(get_ctx),
) -> Any:
    items, total = await svc.list_my_sessions(ctx, params, simulation_id)
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@sessions.get("/{session_id}", response_model=s.SessionOut)
async def get_session(session_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> Any:
    return await svc.get_session(ctx, session_id)


@sessions.post("/{session_id}/actions", response_model=s.StepOut)
async def perform_action(session_id: uuid.UUID, body: s.ActionIn, ctx: Ctx = Depends(learner)) -> Any:
    """Idempotent by ``client_seq``: re-sending a processed seq returns the stored outcome."""
    return await svc.perform_action(ctx, session_id, body)


@sessions.post("/{session_id}/chat", response_model=s.StepOut)
async def chat(session_id: uuid.UUID, body: s.ChatIn, ctx: Ctx = Depends(learner)) -> Any:
    return await svc.chat(ctx, session_id, body)


@sessions.post("/{session_id}/finish", response_model=s.ResultOut)
async def finish_session(session_id: uuid.UUID, ctx: Ctx = Depends(learner)) -> Any:
    return await svc.finish_session(ctx, session_id)


@sessions.post("/{session_id}/abandon", response_model=s.SessionOut)
async def abandon_session(session_id: uuid.UUID, ctx: Ctx = Depends(learner)) -> Any:
    return await svc.abandon_session(ctx, session_id)


@sessions.get("/{session_id}/result", response_model=s.ResultOut)
async def get_result(session_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> Any:
    return await svc.get_result(ctx, session_id)


@sessions.get("/{session_id}/replay", response_model=s.ReplayOut)
async def replay(session_id: uuid.UUID, ctx: Ctx = Depends(get_ctx)) -> Any:
    return await svc.replay(ctx, session_id)


router.include_router(sims)
router.include_router(sessions)
