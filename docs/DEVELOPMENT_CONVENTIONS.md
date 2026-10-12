# Development conventions

## Backend module layout (`apps/api/app/modules/<name>/`)

```
__init__.py
router.py     # `router = APIRouter(prefix="/<resource>", tags=[...])`; optional `public_router` (no auth)
schemas.py    # Pydantic v2 request/response models (`model_config = ConfigDict(from_attributes=True)`)
service.py    # business logic; takes `ctx: Ctx` (or `db` + ids for event handlers / tasks)
events.py     # `@subscribe("event.name")` handlers (imported from router.py so they register)
tasks.py      # `@task("module.name")` async background tasks (optional)
```

Routers are auto-discovered by `app/main.py`; no central registration needed.

## Rules

* **Auth**: endpoints use `ctx: Ctx = Depends(require_permission("courses.edit"))` or `Depends(get_ctx)` for
  learner endpoints (then check `ctx.can("learning.access")`). Public endpoints go on `public_router`.
* **Tenancy**: every query on a tenant table filters `Model.organisation_id == ctx.org_id` (RLS is the
  second barrier, not the first). Load-by-id helpers must 404 when the row belongs to another org.
  Code paths without a tenant (public verify page, webhooks, invite acceptance) wrap the lookup in
  `async with tenant_scope(db, None, bypass=True)` and then bind to the row's org.
* **Audit**: state changes that matter call `await ctx.audit("course.published", "course", course.id, **meta)`.
* **Events**: emit domain events with `await emit(ctx.db, "course.completed", {...})`; see `app/core/events.py`.
* **Notifications**: `await notify(db, organisation_id=..., user_id=..., type=..., title=..., body=..., link=...)`.
* **Files**: `await store_upload(ctx, upload, purpose)` from `app/core/files.py`.
* **Background work**: `await enqueue("module.task", **json_kwargs)` from `app/workers`.
* **Errors**: raise `NotFound`, `Forbidden`, `BadRequest`, `Conflict` from `app/core/errors.py`.
* **Pagination**: `params: PageParams = Depends(page_params)`, `items, total = await paginate(...)`, return `Page[T]`.
* **Models**: shared in `app/models/*.py`. Add columns where needed; keep UUID PKs, timestamps,
  `organisation_id` on tenant tables (`TenantScoped` mixin auto-enables RLS).
* **Tests**: `apps/api/tests/test_<module>*.py`, async pytest, real Postgres. Use `tests.factories.signup`
  (org admin via API) and `add_member(org_id, "learner")`. Run:
  `TEST_DATABASE_URL=postgresql+asyncpg://praxis:praxis@localhost:5432/<db> /home/user/venv/bin/python -m pytest -q`
* **Style**: `ruff check app tests` must pass; type hints everywhere; small functions; docstrings on services.

## Frontend

See `apps/web/README.md` for the design system and conventions.
