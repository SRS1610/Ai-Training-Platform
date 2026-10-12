"""/reports: generate PDF / XLSX / CSV reports (learner progress, course, compliance, assignment, simulation,
competency, organisation)."""

from __future__ import annotations

import io
import re
import uuid
from datetime import UTC, date, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Path, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, model_validator
from sqlalchemy import select

from app.auth.deps import Ctx, get_ctx
from app.core.errors import Forbidden
from app.models.content import Course
from app.models.identity import User
from app.models.tenancy import Department
from app.modules.analytics.router import ensure_course, ensure_department, ensure_member
from app.modules.analytics.service import DateRange
from app.modules.reports.render import RENDERERS
from app.modules.reports.service import REPORT_TYPES, ReportFilters, build_report

router = APIRouter(prefix="/reports", tags=["reports"])

ReportType = Literal[
    "learner_progress", "course", "compliance", "assignment", "simulation", "competency", "organisation"
]
Format = Literal["pdf", "csv", "xlsx"]


class ReportRequest(BaseModel):
    format: Format | None = None
    course_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def _range(self) -> ReportRequest:
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError("start_date must be on or before end_date")
        return self


class ReportTypeOut(BaseModel):
    type: str
    name: str
    formats: list[str]
    requires: list[str]
    self_service: bool


@router.get("/types", response_model=list[ReportTypeOut])
async def report_types(ctx: Ctx = Depends(get_ctx)) -> list[ReportTypeOut]:
    out = []
    for key, name in REPORT_TYPES.items():
        allowed = ctx.can("reports.export") or (key == "learner_progress" and ctx.can("learning.access"))
        if allowed:
            out.append(
                ReportTypeOut(
                    type=key,
                    name=name,
                    formats=list(RENDERERS),
                    requires=["course_id"] if key == "course" else [],
                    self_service=not ctx.can("reports.export"),
                )
            )
    return out


def _authorise(ctx: Ctx, report_type: str, body: ReportRequest) -> None:
    if ctx.can("reports.export"):
        return
    if report_type == "learner_progress" and ctx.can("learning.access") and ctx.principal.user:
        if body.user_id not in (None, ctx.user_id):
            raise Forbidden("You can only export your own progress")
        body.user_id = ctx.user_id
        body.department_id = None
        return
    raise Forbidden(
        "You do not have permission to export this report", details={"required": ["reports.export"]}
    )


async def _labels(ctx: Ctx, body: ReportRequest) -> dict[str, Any]:
    labels: dict[str, Any] = {}
    if body.course_id:
        labels["Course"] = await ctx.db.scalar(select(Course.title).where(Course.id == body.course_id))
    if body.department_id:
        labels["Department"] = await ctx.db.scalar(
            select(Department.name).where(Department.id == body.department_id)
        )
    if body.user_id:
        labels["Learner"] = await ctx.db.scalar(select(User.full_name).where(User.id == body.user_id))
    labels["From"], labels["To"] = body.start_date, body.end_date
    return labels


@router.post("/{report_type}")
async def generate_report(
    body: ReportRequest | None = None,
    report_type: ReportType = Path(...),
    format: Format | None = Query(None, description="Overrides body.format"),
    ctx: Ctx = Depends(get_ctx),
) -> StreamingResponse:
    """Generate a report file. Returns it as an attachment (``Content-Disposition``)."""
    body = body or ReportRequest()
    fmt: str = format or body.format or "pdf"
    _authorise(ctx, report_type, body)
    if body.course_id:
        await ensure_course(ctx, body.course_id)
    await ensure_department(ctx, body.department_id)
    if body.user_id:
        await ensure_member(ctx, body.user_id)

    filters = ReportFilters(
        course_id=body.course_id,
        department_id=body.department_id,
        user_id=body.user_id,
        rng=DateRange(body.start_date, body.end_date),
    )
    report = await build_report(
        ctx.db,
        ctx.org,
        report_type,
        filters,
        generated_by=ctx.principal.label,
        filter_labels=await _labels(ctx, body),
    )
    render, media_type = RENDERERS[fmt]
    content = render(report)
    await ctx.audit(
        "report.generated",
        "report",
        None,
        report_type=report_type,
        format=fmt,
        rows=report.row_count,
        bytes=len(content),
        filters={k: str(v) for k, v in body.model_dump(exclude={"format"}).items() if v is not None},
    )
    slug = re.sub(r"[^a-z0-9]+", "-", (ctx.org.slug or "org").lower()).strip("-") or "org"
    filename = f"{report_type.replace('_', '-')}-{slug}-{datetime.now(UTC):%Y%m%d-%H%M}.{fmt}"
    return StreamingResponse(
        io.BytesIO(content),
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            "X-Report-Rows": str(report.row_count),
        },
    )
