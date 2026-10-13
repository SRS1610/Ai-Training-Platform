# Praxis: AI-powered training management

Praxis is a multi-tenant Training Management System built around one loop:

**Learn → Practice → Simulate → Perform → Get assessed → Improve**

Learners work through versioned courses with an AI tutor beside them. They practise with quizzes, complete
practical assignments graded against rubrics, and run realistic work simulations (a service-desk ticket, a
phishing investigation, a customer complaint) that a deterministic engine scores. Then they get a
personalised plan for what to work on next. Instructors build all of this by hand or draft it with AI. Every
AI draft and every high-stakes grade waits for a person to approve it. Admins get organisation analytics,
reports, budgets and an audit trail they can verify.

> **Status.** This repository is a working product build with a seeded demo dataset. It isn't a hosted
> service, and it doesn't hold any compliance certification (see [Security](#security)). The
> [known limitations](#known-limitations) are listed below.

---

## Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Monorepo layout](#monorepo-layout)
- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [Configuration](#configuration)
- [Testing](#testing)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Roadmap and extension points](#roadmap-and-extension-points)
- [Licence](#licence)

---

## Features

| Area | What you get |
|---|---|
| **Learning delivery** | Courses → modules → lessons with 16 lesson types (text, video, audio, PDF, slides, image, infographic, sandboxed interactive HTML, code, flashcards, branching scenario, quiz, assignment, simulation, AI-tutor conversation, mixed blocks) and 13 in-lesson activity blocks. Optional sequential unlocking. Learning paths. Learners stay on the course version they enrolled in. |
| **AI tutor** | Grounded in the course and the organisation's knowledge base, with citations. Switches to **hint-only mode** while the learner has graded work in progress (an open quiz attempt, a draft or returned assignment, an active simulation). Answer keys are redacted from its context and its replies are screened for leaks. |
| **Practice & assessment** | Question banks with **14 question types**: multiple choice, multiple select, true/false, short answer, long answer, matching, ordering, fill in the blanks, code (pattern-checked, never executed), file upload, scenario, decision tree, practical task, simulation. Fixed items or random pools, time and attempt limits, shuffling, negative marking, configurable feedback release, a high-stakes mode. |
| **Practical assignments** | Scenario briefs, required evidence (text, files, screenshots, code, structured answers), weighted rubrics, versioned drafts. AI-recommended grading with a **human final grade**, override reasons, return for resubmission, and learner review requests. |
| **Simulations** | Data-driven state machines with phases (Initial → Investigation → Diagnosis → Remediation → Validation → Resolution), in-sim tools such as a ticket, terminal and knowledge base, AI-voiced characters limited to the facts the engine has revealed, weighted scoring dimensions, bands (Expert / Advanced / Competent / Needs Improvement / Fail), a debrief and a replay. |
| **Authoring** | Drag-and-drop course builder with publish-to-immutable-version and version diffs. **AI Course Builder** (draft → review → approve → create draft entities, never auto-published). Visual **simulation builder** with templates, an AI Simulation Builder, validation and versioned publishing. A knowledge base with retrieval testing. |
| **Grading** | A review queue with SLA colouring, a split-view grading workspace, AI recommendation vs human grade, manual marking for quiz answers, and integrity signals (similarity, timing) shown as **supplementary signals, never accusations**. |
| **Credentials** | Certificates are issued automatically on completion and come with a PDF, a QR code and a public verification page at `/verify/<number>`. They can be revoked. |
| **Skills & motivation** | Skill profiles, competencies, weak areas, recommendations, points, levels, streaks, badges and an opt-out leaderboard. |
| **Organisation management** | Departments (nested) and teams, invitations (single, bulk, CSV), 7 system roles plus custom roles, branding, custom-domain ownership verification, OIDC SSO with enforced domains, org-wide MFA requirement, data retention. |
| **Insight** | Learner, instructor, course, simulation, organisation and platform analytics. PDF, Excel and CSV reports. |
| **AI governance** | Provider and model selection (OpenAI, Anthropic, Azure OpenAI, Google Gemini, local OpenAI-compatible endpoints, or the built-in **offline** provider). Per-feature switches, monthly budgets with alert thresholds and hard limits, per-user daily limits, and a usage ledger. |
| **Commercial** | Plans (Free, Individual, Professional, Business, Enterprise) with feature gating and seat limits, plus Stripe checkout, portal and webhooks **when Stripe keys are configured**. |
| **Governance & privacy** | An append-only, hash-chained audit log with integrity verification and CSV export. Consent records, self-service data export, account deletion (pseudonymisation), and a scheduled retention sweep. |
| **Platform console** | For super admins: every organisation (plan, seats, suspension, feature overrides), platform users, revenue and AI cost overview, and live system health. |

## Screenshots

All screenshots come from the seeded demo dataset at 1440 px wide. They were taken against the dev stack
using the built-in **offline AI provider**, which is why AI output is labelled "offline demo model".

| | |
|---|---|
| ![Marketing landing page](docs/images/landing.png) **Landing page**: the core loop at a glance. | ![Learner dashboard](docs/images/learner-dashboard.png) **Learner dashboard**: resume point, streak, weekly goal, deadlines and AI recommendations (Alex Chen). |
| ![Lesson player with the AI tutor panel open](docs/images/course-player-tutor.png) **Course player + AI tutor**: a grounded answer with a cited knowledge-base source. | ![Simulation workspace](docs/images/simulation-workspace.png) **Simulation workspace**: phase tracker, ticket and remote PowerShell tools, and a live chat with the caller. |
| ![Simulation debrief](docs/images/simulation-results.png) **Simulation results**: score, band, dimension breakdown, coach's debrief and action replay. | ![AI Course Builder review](docs/images/ai-course-builder-review.png) **AI Course Builder review**: every generated part can be edited; approve or reject, then create drafts. |
| ![Grading workspace](docs/images/grading-workspace.png) **Grading workspace**: the learner's submission next to the AI recommendation and the assessor's rubric. | ![Organisation analytics](docs/images/org-analytics.png) **Organisation analytics**: KPIs, active learners, compliance by course, departments, top performers. |

## Architecture

```
Browser ──► Next.js 15 web app (apps/web) ──/api/* same-origin proxy──► FastAPI (apps/api)
                                                                         │
                       PostgreSQL 16 + pgvector (row-level security) ◄───┤
                       Redis (rate limits, cache, Celery broker)     ◄───┤──► Celery worker + beat
                       S3 / MinIO / local disk (files, PDFs)         ◄───┘    (AI jobs, ingestion, reports,
                                                                               email, reminders, retention)
                       LLM providers · Stripe · SMTP/SES · OIDC IdPs · ClamAV (all optional)
```

- **API**: FastAPI with async SQLAlchemy 2. REST under `/api/v1`, with OpenAPI docs at `/api/docs`. Layered as routers → services → models.
- **Tenant isolation in two layers**: every query is scoped to the active organisation, and PostgreSQL RLS
  (`FORCE ROW LEVEL SECURITY`) is applied to tenant tables. The app connects as a `NOSUPERUSER NOBYPASSRLS` role.
- **Auth**: first-party. Argon2id passwords, 15-minute access JWTs, rotating refresh tokens with reuse
  detection, TOTP MFA, HttpOnly cookies with double-submit CSRF, Google/Microsoft/OIDC sign-in, and scoped API keys.
- **AI gateway**: one path for every AI call. It runs budget checks, moderation, prompt assembly, the provider call, output validation and the usage ledger.
- **Simulation engine**: a pure, deterministic reducer in `packages/simulation-engine`. The LLM only voices characters; it never decides correctness or scores.

The full design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), with deeper dives in the
[documentation index](#documentation).

## Monorepo layout

```
apps/
  api/                 FastAPI service: app/modules/<domain> (router, service, schemas), app/models,
                       app/seed (demo data), app/workers (Celery), alembic/ (migrations), tests/
  web/                 Next.js App Router app: app/(marketing|auth|public), app/app/** (signed-in area),
                       components/<area>, lib/ (API client, auth, nav)
packages/
  ai/                  praxis_ai: provider abstraction, prompts, chunking, extraction, grading, safety
  simulation-engine/   deterministic simulation engine, schema, validation, packaged templates
  ui/                  @praxis/ui design system (React components)
  types/               @praxis/types: TypeScript types generated from the OpenAPI schema
  config/              shared ESLint, TypeScript and Tailwind presets
infrastructure/
  docker/              API and web Dockerfiles, Postgres init SQL
  terraform/           AWS: VPC, RDS, ElastiCache, S3, ECS Fargate, ALB, WAF, Secrets Manager
tests/e2e/             Playwright end-to-end specs
scripts/               dev-db-setup.sh (role + databases), gen_docs.py
docs/                  architecture, API, database, AI, simulation, security, deployment, testing, user guides
```

## Quick start

### Option A: Docker Compose

```bash
cp .env.example .env          # optional: add OPENAI_API_KEY / ANTHROPIC_API_KEY / Stripe keys
docker compose up --build
```

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API + OpenAPI docs | http://localhost:8000/api/docs |
| MailHog (captured email) | http://localhost:8025 |
| MinIO console (S3-compatible storage) | http://localhost:9001 (`minio` / `minio12345`) |

The one-off `migrate` service runs `alembic upgrade head && python -m app.seed --if-empty`, so the demo data
is created on the first start and left alone after that. `docker compose --profile full up` also starts
ClamAV for upload scanning.

### Option B: Native processes

You need Python 3.12+, Node 20.11+ (22 recommended) with pnpm 10 (`corepack enable`), PostgreSQL 16 with
`pgvector`, and Redis 7.

```bash
./scripts/dev-db-setup.sh                 # role "praxis" (NOSUPERUSER NOBYPASSRLS) + praxis, praxis_test DBs
python -m venv .venv && source .venv/bin/activate
pip install -e packages/ai -e packages/simulation-engine -e "apps/api[dev]"

cd apps/api
alembic upgrade head
python -m app.seed                        # full demo dataset (about a minute); prints the accounts table
cd ../..

uvicorn app.main:app --reload --app-dir apps/api                       # API  → http://localhost:8000
celery -A app.workers.celery_app worker -l info --workdir apps/api      # background jobs (or set CELERY_TASK_ALWAYS_EAGER=true)
pnpm install && pnpm dev                                                # web  → http://localhost:3000 (proxies /api/* to API_URL)
```

Seeder options: `python -m app.seed --reset` (dev only: drop, migrate and reseed), `--profile minimal`
(the smaller dataset used by tests) and `--if-empty`. The seeder refuses to run when `ENVIRONMENT=production`.

## Demo accounts

Every account uses the password **`Praxis-Demo-2026!`**.

| Email | Name | Role | Organisation |
|---|---|---|---|
| `superadmin@praxis.demo` | Morgan Hayes | Super admin (platform console) | Praxis platform |
| `admin@northwind.demo` | Olivia Bennett | Org admin | Northwind Technologies (Enterprise, 60 seats) |
| `manager@northwind.demo` | Marcus Lee | Training manager | Northwind Technologies |
| `instructor@northwind.demo` | Dr. Priya Raman | Instructor | Northwind Technologies |
| `sme@northwind.demo` | Tom Fischer | Subject-matter expert | Northwind Technologies |
| `assessor@northwind.demo` | Grace Okafor | Assessor | Northwind Technologies |
| `auditor@northwind.demo` | Daniel Novak | Auditor (read-only analytics and audit) | Northwind Technologies |
| `learner@northwind.demo` | Alex Chen | Learner (main demo learner) | Northwind Technologies |
| `admin@contoso.demo` | Rebecca Shaw | Org admin | Contoso Training Co (Business, 5 seats) |
| `trainer@contoso.demo` | Samuel Osei | Instructor | Contoso Training Co |
| `learner@contoso.demo` | Jordan Ellis | Learner | Contoso Training Co |
| `solo@praxis.demo` | Riley Morgan | Individual learner | Personal workspace (Free plan) |
| `<first.last>@northwind.demo` | 24 more learners, e.g. `sofia.martinez@northwind.demo` | Learner | Northwind Technologies |

Northwind is the full showcase. It has five departments and five teams, eight courses (six published, including the
*IT Support Troubleshooting Fundamentals* flagship), three published simulations, a knowledge base,
graded submissions, certificates and several weeks of backdated learning history.

## Configuration

Settings come from environment variables (`apps/api/app/core/config.py`, 12-factor). Copy `.env.example`
to `.env`. The defaults are safe for development only.

| Variable | Default | Purpose |
|---|---|---|
| `ENVIRONMENT` | `development` | `development`, `test`, `staging` or `production`. In production the API refuses to start with a default `AUTH_SECRET`, a missing `ENCRYPTION_KEY` or `COOKIE_SECURE=false`. |
| `PUBLIC_WEB_URL` / `PUBLIC_API_URL` | `http://localhost:3000` / `:8000` | Links in emails, certificates, OAuth callbacks |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `DATABASE_URL` | `postgresql+asyncpg://praxis:praxis@localhost:5432/praxis` | Must be a non-superuser role so RLS is enforced |
| `REDIS_URL` | `redis://localhost:6379/0` | Rate limits, cache, Celery broker (`CELERY_BROKER_URL` overrides) |
| `CELERY_TASK_ALWAYS_EAGER` | `false` | Run background jobs in-process (handy without a worker) |
| `AUTH_SECRET` | dev placeholder | JWT and HMAC signing secret (≥ 32 random characters in production) |
| `ENCRYPTION_KEY` | unset | Fernet key for MFA and SSO secrets (derived from `AUTH_SECRET` in dev only) |
| `COOKIE_SECURE`, `COOKIE_DOMAIN` | `false`, unset | Cookie flags (secure is required in production) |
| `REQUIRE_EMAIL_VERIFICATION` | `false` | Block sign-in until the email address is verified |
| `RATE_LIMIT_ENABLED` | `true` | Redis rate limits (default 300/min, auth 20/min, AI 30/min) |
| `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `MICROSOFT_TENANT` | unset, `common` | Social sign-in. Enterprise OIDC is configured per organisation in the app. |
| `AI_DEFAULT_PROVIDER` | `offline` | `offline`, `openai`, `anthropic`, `azure_openai`, `google`, `local` |
| `AI_DEFAULT_MODEL`, `AI_EMBEDDING_MODEL` | `gpt-4o-mini`, `text-embedding-3-small` | Defaults; organisations can override them in AI settings |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT`, `GOOGLE_API_KEY`, `LOCAL_MODEL_BASE_URL` | unset | Provider credentials, server-side only |
| `STORAGE_BACKEND` | `local` | `local` (`LOCAL_STORAGE_PATH`) or `s3` (`AWS_*`, `AWS_S3_ENDPOINT_URL` for MinIO) |
| `MAX_UPLOAD_MB` | `50` | Upload size limit |
| `CLAMAV_HOST` / `CLAMAV_PORT` | unset / `3310` | Malware scanning. Without it, uploads are marked `skipped`. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` | unset | Online billing. Without them the Billing page explains that billing isn't connected. |
| `STRIPE_PRICE_<PLAN>_<MONTHLY\|ANNUAL>`, `STRIPE_PRICE_AI_METERED`, `STRIPE_AI_METER_EVENT_NAME`, `AI_OVERAGE_MARKUP`, `BILLING_CURRENCY` | unset, `ai_usage_cents`, `1.25`, `aud` | Stripe catalogue and usage-based AI pricing |
| `EMAIL_PROVIDER` | `console` | `console` (log), `smtp` (`SMTP_*`, `SMTP_USE_TLS`) or `ses`. `EMAIL_FROM` sets the sender. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | unset | Web push notifications (off without keys) |
| `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_JSON`, `LOG_LEVEL` | unset, unset, `false`, `INFO` | Observability |
| `API_URL` (web) | `http://localhost:8000` | Where the Next.js server proxies `/api/*` |

## Testing

```bash
# Backend: real PostgreSQL as a non-superuser role (RLS enforced), tasks run eagerly
cd apps/api
pytest -q tests ../../packages/ai/tests ../../packages/simulation-engine/tests
pytest -q --cov --cov-report=term-missing:skip-covered tests ../../packages/*/tests

# Frontend
pnpm typecheck && pnpm lint && pnpm --filter web build

# End-to-end (needs a seeded API on :8000; starts `next start` on :3000 if it's free)
pnpm test:e2e
```

[docs/TESTING.md](docs/TESTING.md) covers the harness (factories, isolation, coverage target) and the
CI pipeline.

## Deployment

The production target is AWS: ECS Fargate (web, api, worker, beat, plus a migrate task), RDS PostgreSQL 16,
ElastiCache Redis, S3, ALB and WAF, and Secrets Manager, all provisioned by `infrastructure/terraform`. The
GitHub Actions pipeline runs tests, security scans and image builds, then deploys to staging and, after a
manual approval, to production. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

> The Terraform configuration and the Docker Compose stack were **not executed in the environment these
> docs were written in** (neither the Terraform CLI nor a Docker daemon was available there). CI runs
> `terraform validate`. Check both in your own account before relying on them.

## Documentation

| Guide | For |
|---|---|
| [Admin guide](docs/ADMIN_GUIDE.md) | Org admins and super admins: onboarding, users, roles, SSO, AI budgets, billing, audit, privacy, platform console |
| [Instructor guide](docs/INSTRUCTOR_GUIDE.md) | Instructors, SMEs and assessors: course builder, AI builder, question banks, assignments, simulations, knowledge base, grading, analytics |
| [Learner guide](docs/LEARNER_GUIDE.md) | Learners: dashboard, courses, AI tutor, quizzes, assignments, simulations, certificates, skills, profile |
| [Architecture](docs/ARCHITECTURE.md) | System design, RBAC matrix, sitemap, ADRs |
| [API](docs/API.md) | REST conventions and endpoints |
| [Database](docs/DATABASE.md) | Schema and RLS |
| [AI architecture](docs/AI_ARCHITECTURE.md) | Gateway, providers, RAG, guardrails |
| [Simulation engine](docs/SIMULATION_ENGINE.md) | Definition format, engine, scoring |
| [Security](docs/SECURITY.md) | Controls and the threat model |
| [Deployment](docs/DEPLOYMENT.md) | Local, AWS, CI/CD, operations |
| [Testing](docs/TESTING.md) | Test layers and commands |
| [Development conventions](docs/DEVELOPMENT_CONVENTIONS.md) | Code style and patterns |
| [Web app README](apps/web/README.md) | Frontend structure and conventions |

## Security

Highlights: Argon2id passwords, TOTP MFA with recovery codes, rotating refresh tokens with reuse detection,
CSRF protection, two-layer tenant isolation (application scoping plus PostgreSQL RLS), granular RBAC that
blocks privilege escalation, scoped and hashed API keys, an upload validation pipeline with optional ClamAV,
SSRF-safe URL ingestion, prompt-injection flagging, hint-only tutoring during graded work, and an append-only
hash-chained audit log.

Praxis is **designed with** GDPR, the Australian Privacy Act (APPs) and SOC 2 readiness in mind. It is
**not certified or audited** against any of them. Details are in [docs/SECURITY.md](docs/SECURITY.md).
Please report vulnerabilities privately, as described there.

## Known limitations

- **SAML**: you can create and validate SAML 2.0 connections (metadata is stored), but the SAML assertion
  consumer is **not implemented**. It needs an XML-signature library. OIDC SSO works end to end.
- **Custom domains**: Praxis verifies that you own a domain (DNS TXT record), but the app does not route
  requests by host name. Serving the app on that domain (DNS, TLS certificate, load-balancer rule) is a deployment task.
- **AI in the demo**: the dev stack and seeded data use the built-in **offline provider**. It's deterministic
  and retrieval-backed, and the UI labels it as such. Configure a real provider for real generation, tutoring and grading quality.
- **Billing**: Stripe checkout, portal and webhooks only work when Stripe keys and price ids are configured.
  Super admins can also manage a plan manually from the platform console.
- **Demo audit log**: entries are append-only, so the seeder can't backdate them. Their timestamps are the
  time the seed ran, even though the rest of the demo history is spread over earlier weeks.
- **Code questions** are checked against patterns. Learner code is never executed.

## Roadmap and extension points

These seams already exist in the code and are the intended places to extend Praxis.

| Extension point | Where | Notes |
|---|---|---|
| AI providers | `packages/ai/src/praxis_ai/providers/base.py` (`AIProvider`) | Implemented: OpenAI, Anthropic, Azure OpenAI and local endpoints (OpenAI wire format), Google Gemini, offline |
| Retrieval | `apps/api/app/modules/ai/gateway.py` (`retrieve`) | pgvector cosine with a keyword fallback. A single function to swap for an external vector store. |
| File storage | `apps/api/app/core/storage.py` (`StorageBackend`) | Local disk and S3/MinIO |
| Email | `apps/api/app/core/email.py` (`EmailProvider`) | Console, SMTP, SES |
| Web push | `apps/api/app/modules/notifications/push.py` (`WebPushProvider`) | VAPID when keys are set |
| SAML SSO | `apps/api/app/modules/auth/oauth.py`, `modules/sso` | Adapter point. Assertion consumer not implemented. |
| Simulation content | `packages/simulation-engine/simulation_engine/templates/*.json` | Simulations are JSON definitions. Add templates without writing code. |
| Integrations | `/api/v1` with `X-API-Key` (scoped, org-bound) or bearer tokens | For HRIS, BI and other client apps |
| Billing | `apps/api/app/modules/billing/gateway.py` | Stripe adapter; plans in `plans.py` |

These ideas are **not implemented**: native mobile apps, SCORM/xAPI/LTI interoperability, a SAML assertion
consumer, host-based routing for custom domains, and AI-text detection (which would only ever be another
supplementary integrity signal).

## Licence

No licence has been chosen yet. Until a `LICENSE` file is added, all rights are reserved by the copyright
holder. _(Placeholder: replace it with the chosen licence.)_
