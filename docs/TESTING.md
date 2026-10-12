# Testing

| Layer | Tooling | Location | Runs in CI |
|---|---|---|---|
| Unit: pure domain logic | pytest | `packages/simulation-engine/tests`, `packages/ai/tests`, `apps/api/tests/test_assessments_grading.py` | ✓ |
| Integration: API + PostgreSQL + RLS | pytest, httpx ASGI client, real Postgres 16 + pgvector | `apps/api/tests` | ✓ |
| Migrations | Alembic upgrade → downgrade → upgrade + `alembic check` (model drift) | `apps/api/alembic` | ✓ |
| End-to-end | Playwright (Chromium) against a seeded stack | `tests/e2e` | ✓ |
| Static analysis | ruff, TypeScript strict, ESLint | — | ✓ |
| Security | Bandit, pip-audit, pnpm audit, gitleaks, Trivy (fs + IaC) | `.github/workflows/ci-cd.yml` | ✓ |

## Running the backend suite

```bash
./scripts/dev-db-setup.sh                        # creates role "praxis" (NOSUPERUSER NOBYPASSRLS) + praxis_test
source .venv/bin/activate                        # or /home/user/venv in the cloud dev container
cd apps/api
pytest -q tests ../../packages/ai/tests ../../packages/simulation-engine/tests
pytest -q --cov --cov-report=term-missing:skip-covered tests ../../packages/*/tests   # with coverage
TEST_DATABASE_URL=postgresql+asyncpg://praxis:praxis@localhost:5432/other_db pytest -q   # alternate DB
```

Important properties of the harness (`apps/api/tests/conftest.py`):

* Tests run against **real PostgreSQL as a non-superuser role**, so row-level security is enforced exactly as in production. Mocking the database would hide RLS bugs.
* The schema is built from the models, and RLS policies, audit triggers and sequences are applied from the same SQL the migration uses (`app/core/rls.py`).
* Background tasks run eagerly. Tasks enqueued with `db=` dispatch only after the transaction commits, matching production.
* Factories (`tests/factories.py`): `signup()` registers an org admin through the public API, `add_member(org_id, "learner")` creates a member with given roles, and `set_plan(org_id, "business")` unlocks plan features.
* Tests are isolated by unique organisations and emails instead of truncation. The audit log is append-only even in tests.

## What is covered

| Area | Highlights |
|---|---|
| Authentication | Registration, login, lockout, refresh rotation and **reuse detection**, logout revocation, MFA enrol / verify / recovery codes, password reset (no enumeration), email verification, CSRF on cookie auth, session listing |
| Tenant isolation | RLS blocks cross-tenant reads, `WITH CHECK` blocks cross-tenant writes, fails closed without a tenant, org header requires membership, `404` for other orgs' rows across modules |
| RBAC | Permission denials per role across every module, last-admin protection, no escalation beyond the granter's permissions, API-key scopes |
| Audit | Append-only (UPDATE/DELETE blocked), hash-chain verification |
| Courses | Authoring, drag-and-drop structure, publish → immutable snapshots, enrolled learners keep their version, diffs, catalog visibility |
| Progress | Heartbeats, streaks, sequential locking, event-driven completion from quizzes, assignments and simulations, `course.completed` |
| Assessments | Grading for all 14 question types (partial credit, negative marking floor), random pools with deterministic seeds, timers and expiry, attempt limits, answer keys never sent to learners, manual / AI review |
| Assignments | Versioned drafts, evidence validation, similarity signals, AI recommendation vs human final grade, override reason enforcement |
| Certificates | Auto-issue on completion, PDF + QR, public verification, tamper detection (HMAC), revocation |
| Simulations | Engine (~98% coverage): optimal paths reach Expert, poor paths fail, DSL safety (no eval), validation, variations, graph round-trip. API: hidden facts never reach the learner (JSON scan), idempotent actions, attempt limits, AI builder fallback |
| AI | Providers via `httpx.MockTransport` (OpenAI, Anthropic, Azure, Gemini, local), offline provider behaviour, budgets and limits, usage ledger, prompt-injection flagging, knowledge ingestion + retrieval relevance, SSRF blocking, tutor hint mode + leak screening, generation → approve → apply (draft only), grading tasks against the real contracts, recommendations |
| Billing | Checkout / portal (Stripe mocked), signed webhook verification + idempotency, plan / seat sync |
| Notifications, gamification, search, analytics, reports | Event handlers, preferences, points / badges / streaks, permission-aware search, analytics figures on seeded rows, PDF / XLSX / CSV outputs parse back |
| Workers | Tasks enqueued with `db=` run only after commit and never after rollback |

Coverage target: **≥ 80%** for backend business logic, enforced in CI with `--cov-fail-under=80`. Coverage is configured for greenlet concurrency so async SQLAlchemy code is measured correctly.

## End-to-end (Playwright)

```bash
# with the API (seeded) on :8000 — see DEPLOYMENT.md
pnpm --filter web build && pnpm test:e2e        # starts `next start` on :3000 automatically
```

Specs in `tests/e2e/` cover the critical journeys: registration, login (incl. MFA), dashboard, enrolment, lesson completion, quiz, assignment submission, simulation play-through, grading, certificate and verification.

## Frontend checks

```bash
pnpm typecheck && pnpm lint && pnpm --filter web build
```

## Manual QA checklist (per release)

Run through the success criteria in the product brief (§59) on staging with a fresh organisation: create the org → departments → invite employees → create a course → AI-generate content → review and approve → assign → complete lessons → tutor → quiz → assignment → simulation → AI feedback → instructor review → final assessment → certificate → analytics.
