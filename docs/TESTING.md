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
# with the seeded API on :8000 and the web app on :3000 (see DEPLOYMENT.md)
pnpm test:e2e --project=chromium                    # reuses a running web server, else starts `next start`
E2E_BASE_URL=http://localhost:3000 pnpm test:e2e --project=chromium   # point at an existing server / deployment
pnpm test:e2e --project=chromium tests/e2e/quiz.spec.ts               # a single journey
```

Configuration (`tests/e2e/playwright.config.ts`): Chromium from `PLAYWRIGHT_BROWSERS_PATH` (never `playwright install`), one worker (`E2E_WORKERS` to change), one retry, traces and screenshots kept on failure. `E2E_API_URL` (default `http://localhost:8000`) is used for test-data setup; `E2E_DEMO_PASSWORD` overrides the demo password. Every spec passes on its own without the retry.

**Data isolation.** Setup goes straight to the API (`tests/e2e/support/api.ts`); the journey under test is driven through the UI with accessible roles and labels. Any spec that changes state registers a brand-new organisation (the platform super admin sets its plan) and creates its own members, so the suite can be re-run against the same seeded database. Seeded accounts are only used read-only (analytics, report export, platform health, tenant isolation); seeded learners' progress and simulation attempts are never touched. The API should run with `RATE_LIMIT_ENABLED=false` (as in local dev), since the suite signs in many times a minute.

| Spec | Journey |
|---|---|
| `auth.spec.ts` | Unauthenticated redirect; register → dashboard → sign out → sign in; register → enrol MFA (TOTP computed from the setup key shown in the UI, RFC 6238) → sign in with a second factor; wrong-password error |
| `catalog-enrolment.spec.ts` | Learner searches the catalog, opens a course, enrols and starts learning; enrolment shows under My learning |
| `lesson-player.spec.ts` | Learner opens a lesson in the player, marks it complete; outline and course progress update and persist |
| `quiz.spec.ts` | Learner starts a quiz attempt, answers every question, confirms submit and sees a passing 100% result |
| `assignment-grading.spec.ts` | Learner drafts and saves (version 1), uploads screenshot evidence, submits; assessor sees the AI recommendation, changes a rubric level, is required to give an override reason, submits the final grade; the learner sees feedback |
| `simulation.spec.ts` | “Corporate Laptop Cannot Connect to Network” played in the workspace along the optimal path (ticket, Teams chat, PowerShell, KB, system info, diagnosis, fix, validation, notes, close) to an Expert/Advanced band |
| `ai-tutor.spec.ts` | From the lesson player the learner asks the AI tutor “Why would DNS cause this problem?” and gets an answer citing the approved knowledge-base article |
| `certificate.spec.ts` | Completing a course issues a certificate; the learner downloads the PDF; the public `/verify/{number}` page (signed out) shows it verified; unknown numbers show “No certificate found” |
| `instructor-course.spec.ts` | Instructor creates a course, adds a module and a text lesson in the builder, and publishes version 1 |
| `ai-course-builder.spec.ts` | Instructor generates a full course with the AI builder, approves it and applies it as an unpublished draft course |
| `admin-invite-assign.spec.ts` | Org admin invites a new person (pending invitation listed) and assigns a published course to an existing member from their profile |
| `admin-analytics-reports.spec.ts` | Org admin (Northwind demo) sees organisation analytics and exports the Organisation overview report as CSV |
| `platform-health.spec.ts` | Super admin sees platform totals and the System health tab (overall status, database check) |
| `tenant-isolation.spec.ts` | A Contoso user opening a Northwind course URL gets “not in the catalog” / “not enrolled” in the UI and a 404 from the API, with no course details leaked |

## Frontend checks

```bash
pnpm typecheck && pnpm lint && pnpm --filter web build
```

## Manual QA checklist (per release)

Run through the success criteria in the product brief (§59) on staging with a fresh organisation: create the org → departments → invite employees → create a course → AI-generate content → review and approve → assign → complete lessons → tutor → quiz → assignment → simulation → AI feedback → instructor review → final assessment → certificate → analytics.
