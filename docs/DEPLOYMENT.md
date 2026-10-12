# Deployment

Praxis runs as four containers: **web** (Next.js), **api** (FastAPI), **worker** (Celery) and **beat** (Celery scheduler).
The **migrate** one-off task applies Alembic migrations.

| Environment | Where | How |
|---|---|---|
| Development | Laptop | `docker compose up --build`, or run the processes natively (below) |
| Staging | AWS (ECS Fargate, RDS, ElastiCache, S3) | Automatic on merge to `main` after all checks pass |
| Production | AWS (Multi-AZ RDS, 2-node Redis, autoscaling API) | Same pipeline, gated by a manual approval on the `production` GitHub environment |

## 1. Development

### Option A: Docker Compose (everything)

```bash
cp .env.example .env            # optional: add OPENAI_API_KEY / STRIPE keys
docker compose up --build       # web :3000, api :8000 (/api/docs), MailHog :8025, MinIO console :9001
```

The `migrate` service runs `alembic upgrade head` and seeds the demo data (`python -m app.seed`).
`docker compose --profile full up` also starts ClamAV for malware scanning of uploads.

### Option B: Native processes

Prerequisites: Python 3.12+, Node 22 + pnpm 9, PostgreSQL 16 with the `pgvector` extension, and Redis 7.

```bash
./scripts/dev-db-setup.sh                       # role "praxis" (non-superuser → RLS enforced) + databases
python -m venv .venv && source .venv/bin/activate
pip install -e packages/ai -e packages/simulation-engine -e "apps/api[dev]"
cd apps/api && alembic upgrade head && python -m app.seed && cd ../..
uvicorn app.main:app --reload --app-dir apps/api                    # API  → http://localhost:8000
CELERY_TASK_ALWAYS_EAGER=true ...                                   # (or run a worker:)
celery -A app.workers.celery_app worker -l info --workdir apps/api   # background jobs
pnpm install && pnpm --filter web dev                               # Web  → http://localhost:3000
```

Demo accounts created by the seeder are listed in [README.md](../README.md#demo-accounts).

## 2. AWS infrastructure (Terraform)

`infrastructure/terraform` provisions:

* VPC with public subnets (ALB, NAT) and private subnets (tasks, data) across two AZs
* **RDS PostgreSQL 16**: encrypted, forced TLS, Performance Insights, automated backups (30 days in prod), deletion protection in prod, Multi-AZ in prod
* **ElastiCache Redis 7**: encryption in transit and at rest, failover in prod
* **S3** files bucket: private, SSE, versioned
* **ECS Fargate** services (api, worker + beat, web) plus a migrate task definition, with CPU autoscaling for the API
* **ALB** with TLS 1.3 policy, HTTP→HTTPS redirect, `/api/*` routed to the API, and `/api/v1/metrics` blocked publicly
* **AWS WAF** managed common rule set
* **Secrets Manager** secret `praxis-<env>/app`, injected into containers as environment variables
* CloudWatch log group with 90-day retention and Container Insights

```bash
cd infrastructure/terraform
terraform init -backend-config=environments/staging.backend.hcl
terraform plan  -var-file=environments/staging.tfvars
terraform apply -var-file=environments/staging.tfvars
```

After the first apply:

1. Create the database role used by the app (RLS requires a non-superuser), then enable the extensions as the RDS master user:
   ```sql
   CREATE ROLE praxis LOGIN PASSWORD '<from secret>' NOSUPERUSER NOBYPASSRLS;
   GRANT ALL ON DATABASE praxis TO praxis; ALTER SCHEMA public OWNER TO praxis;
   CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```
2. Add the remaining secrets to `praxis-<env>/app`: `ENCRYPTION_KEY` (Fernet), `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, OAuth client secrets and `SENTRY_DSN`.
3. Verify an SES sending identity for the email domain.
4. Point DNS at the ALB (or put CloudFront in front of it for static asset caching).
5. Configure the Stripe webhook endpoint `https://<domain>/api/v1/billing/webhook`.

## 3. CI/CD (GitHub Actions: `.github/workflows/ci-cd.yml`)

```
push / PR ─► api-tests ─┐   (ruff, alembic upgrade/downgrade/check, pytest with coverage ≥ 80%)
             web-checks ┼─► e2e (Playwright against a seeded stack)
             security ──┘   (bandit, pip-audit, pnpm audit, gitleaks, Trivy fs + IaC, terraform validate)
main only ─► build (API + web images → ECR, tagged with the commit SHA)
          ─► deploy-staging   (migrate task → roll api/worker/web → wait for stability)
          ─► deploy-production (requires approval: GitHub environment "production" with required reviewers)
```

Repository configuration:

* Secret `AWS_DEPLOY_ROLE_ARN`: an IAM role trusted via GitHub OIDC, allowed to push to ECR, register task definitions, run tasks and update services.
* Environments `staging` and `production`. Give `production` required reviewers to create the approval gate.

Rollbacks: ECS deployment circuit breakers roll back failed deployments automatically. For a manual rollback, re-run `deploy-*` from an earlier successful workflow run (same image tag). Migrations are written to be backwards compatible with the previous release (expand → migrate → contract).

## 4. Operations

* **Health**: `GET /api/v1/health` (ALB target health) and the admin **System health** dashboard (`/app/platform`), which shows DB/Redis latency, queue depth, p50/p95/p99 latency, error rates, AI usage and storage.
* **Logs**: structured JSON (`LOG_JSON=true`) with request ids, in CloudWatch.
* **Errors**: Sentry (`SENTRY_DSN`).
* **Tracing**: `OTEL_EXPORTER_OTLP_ENDPOINT` reserved for an OpenTelemetry collector sidecar.
* **Backups**: RDS automated snapshots plus point-in-time recovery. The S3 bucket is versioned.
* **Scaling**: API autoscaling on CPU, workers scale by queue depth (add a step-scaling policy on the Redis `LLEN default` CloudWatch metric), and RDS read replicas can serve analytics queries when needed.
