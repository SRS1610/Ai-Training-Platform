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

Prerequisites: Python 3.12+, Node 20.11+ (22 recommended) with pnpm 10 (`corepack enable`), PostgreSQL 16 with the `pgvector` extension, and Redis 7.

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
* A one-off **db-bootstrap** task (master credentials in their own secret `praxis-<env>/db-admin`) that creates the
  `vector` and `pg_trgm` extensions and the non-superuser `praxis` role the app and migrations connect as

### Deploy with the script (recommended)

`scripts/deploy-aws.sh` performs a complete deployment from your workstation and is also how you upgrade: run it
again after committing. Every step is idempotent.

Prerequisites: AWS CLI v2 signed in to the target account (`aws configure`, `AWS_PROFILE` or SSO), Terraform 1.6+,
Docker with buildx (images are built for `linux/amd64`), `jq`, `git` and `curl`. The deploying identity needs
permission to manage the services listed above plus IAM roles, ACM, ECR, DynamoDB and (optionally) Route 53.

```bash
# Staging, with demo data, certificate and DNS handled in a Route 53 zone you own:
DOMAIN=staging.example.com HOSTED_ZONE_ID=Z0123456789 scripts/deploy-aws.sh staging --seed-demo

# Production with an AI provider and Stripe:
DOMAIN=app.example.com HOSTED_ZONE_ID=Z0123456789 OPENAI_API_KEY=sk-... \
STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... scripts/deploy-aws.sh production

# Preview the infrastructure changes only:
DOMAIN=app.example.com scripts/deploy-aws.sh production --plan-only
```

What it does:

1. Checks the tools and your AWS identity, prints the plan and asks for confirmation (production requires typing
   `production`, or `--yes` for unattended runs).
2. Creates the Terraform state bucket (`praxis-tfstate-<account>-<region>`, versioned and encrypted), the lock
   table and the `praxis-api` / `praxis-web` ECR repositories if they don't exist.
3. Finds or requests the ACM certificate for `DOMAIN`. With `HOSTED_ZONE_ID` it writes the validation record
   itself; otherwise it prints the CNAME to create and waits until the certificate is issued.
4. Builds and pushes both images, tagged with the git commit (`-dirty-<time>` when there are uncommitted changes).
5. Runs `terraform plan` and, after confirmation, `terraform apply`. The first run takes 15–25 minutes.
6. Stores any keys you exported (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET`, `SENTRY_DSN`) in `praxis-<env>/app` without printing them.
   Generated values (database URL, Redis URL, `AUTH_SECRET`, `ENCRYPTION_KEY`) are created by Terraform.
7. Runs the db-bootstrap task, then the migrations. If either fails, its log lines are printed and the running
   services are left untouched.
8. Optionally seeds demo data (`--seed-demo`, refused for production), then moves the api, worker and web services
   to the new images and waits until they are stable. A failed rollout rolls back automatically.
9. Creates the Route 53 alias for `DOMAIN` (or prints the CNAME to create) and checks `/api/v1/health`.

To use Groq (or another OpenAI-compatible service) instead of OpenAI, export `GROQ_API_KEY` (it is stored as
`OPENAI_API_KEY` with Groq's endpoint and the `llama-3.3-70b-versatile` model), or set `OPENAI_API_KEY`,
`AI_BASE_URL` and `AI_MODEL` yourself. Groq has no embeddings API, so knowledge-base search then uses the built-in
offline embeddings: retrieval keeps working, with lower recall than OpenAI embeddings.

Other options: `AWS_REGION` (default `ap-southeast-2`), `ACM_CERTIFICATE_ARN`, `IMAGE_TAG`, `--skip-build`,
`AI_PROVIDER` (`openai`, `anthropic` or `offline`; chosen from the exported keys by default), `EMAIL_FROM`
(default `Praxis <no-reply@DOMAIN>`) and `TRUSTED_PROXY_HOPS` (`1` for the ALB alone, `2` with Cloudflare in front).
Run `scripts/deploy-aws.sh --help` for the full list.

On the very first deployment the services start while the migrations are still running, so the API answers with
errors for a minute or two; later deployments only move the services after migrations succeed.

After the first deployment:

1. Verify the SES sending identity for `EMAIL_FROM` and request production access (leave the SES sandbox), or
   invitations and password resets will not be delivered.
2. Configure the Stripe webhook endpoint `https://<domain>/api/v1/billing/webhook` if you take payments.
3. Sign in and create the first organisation. `--seed-demo` instead loads the demo accounts listed in the README.

### Running Terraform by hand

```bash
cd infrastructure/terraform
terraform init -backend-config=environments/staging.backend.hcl
terraform plan  -var-file=environments/staging.tfvars -var domain_name=... -var acm_certificate_arn=... \
                -var api_image=... -var web_image=...
terraform apply -var-file=environments/staging.tfvars ...
```

The services ignore task-definition changes made by Terraform, so after an apply run the `db-bootstrap` and
`migrate` task definitions (outputs `task_definitions`, `private_subnet_ids`, `app_security_group_id`) and then
`aws ecs update-service` for `api`, `worker` and `web`, as the script and the CI deploy action do.

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
