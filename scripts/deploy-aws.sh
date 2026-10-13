#!/usr/bin/env bash
# Deploy Praxis to AWS (ECS Fargate, RDS PostgreSQL 16, ElastiCache Redis, S3, ALB + WAF) from a workstation.
#
#   DOMAIN=app.example.com scripts/deploy-aws.sh staging
#   DOMAIN=app.example.com HOSTED_ZONE_ID=Z123 OPENAI_API_KEY=sk-... scripts/deploy-aws.sh production
#
# What it does, in order (every step is idempotent, so re-running is safe and is also how you upgrade):
#   1. checks tools and AWS credentials, then asks for confirmation;
#   2. creates the Terraform state bucket and lock table, and the two ECR repositories, if missing;
#   3. finds or requests the TLS certificate for DOMAIN (validated automatically when HOSTED_ZONE_ID is set);
#   4. builds and pushes the API and web images (linux/amd64), tagged with the git commit;
#   5. terraform plan + apply (infrastructure/terraform, sized by environments/<env>.tfvars);
#   6. stores any API keys you exported in Secrets Manager (values are never printed);
#   7. runs the db-bootstrap task (extensions + non-superuser app role), then the migrations;
#   8. optionally seeds demo data (staging only), then moves the api/worker/web services to the new images;
#   9. points DOMAIN at the load balancer (Route 53) or prints the record to create, and smoke-tests /health.
#
# Required:   DOMAIN                       public hostname, e.g. app.example.com
# Optional:   AWS_REGION                   default ap-southeast-2 (or your AWS CLI default)
#             AWS_PROFILE                  any AWS CLI profile
#             ACM_CERTIFICATE_ARN          use an existing certificate instead of finding/requesting one
#             HOSTED_ZONE_ID               Route 53 zone for DOMAIN: validates the certificate and creates the alias
#             IMAGE_TAG                    default: short git SHA (+ -dirty-<time> for uncommitted changes)
#             AI_PROVIDER                  openai | anthropic | offline (default: openai if OPENAI_API_KEY is set,
#                                          anthropic if ANTHROPIC_API_KEY is set, otherwise offline)
#             AI_MODEL                     chat model (default gpt-4o-mini; llama-3.3-70b-versatile with Groq)
#             AI_BASE_URL                  OpenAI-compatible endpoint (default https://api.openai.com/v1)
#             GROQ_API_KEY                 use Groq: stored as the OpenAI-compatible key with Groq's endpoint
#             EMAIL_FROM                   SES-verified sender, default "Praxis <no-reply@DOMAIN>"
#             TRUSTED_PROXY_HOPS           proxies in front of the API: 1 = ALB (default), 2 = Cloudflare + ALB
#             OPENAI_API_KEY ANTHROPIC_API_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
#             GOOGLE_CLIENT_SECRET MICROSOFT_CLIENT_SECRET SENTRY_DSN     stored in Secrets Manager when set
# Flags:      --plan-only   stop after terraform plan (nothing is changed except state/ECR bootstrap)
#             --skip-build  reuse images already pushed for IMAGE_TAG
#             --seed-demo   load the demo organisations and accounts (staging only; never production)
#             --yes         do not ask for confirmation (CI); production still requires --yes explicitly
set -Eeuo pipefail

# ----------------------------------------------------------------------------------------------- helpers
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT/infrastructure/terraform"
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[33m    ! %s\033[0m\n' "$*" >&2; }
die() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }
trap 'printf "\033[31mDeployment stopped at line %s (exit %s). Fix the problem and re-run: every step is idempotent.\033[0m\n" "$LINENO" "$?" >&2' ERR

usage() { sed -n '2,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

ENVIRONMENT="" PLAN_ONLY=0 SKIP_BUILD=0 SEED_DEMO=0 ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    staging|production) ENVIRONMENT="$arg" ;;
    --plan-only) PLAN_ONLY=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --seed-demo) SEED_DEMO=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help) usage 0 ;;
    *) warn "unknown argument: $arg"; usage 2 ;;
  esac
done
[[ -n "$ENVIRONMENT" ]] || { warn "choose an environment: staging or production"; usage 2; }
[[ -n "${DOMAIN:-}" ]] || die "set DOMAIN, e.g. DOMAIN=app.example.com $0 $ENVIRONMENT"
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "DOMAIN must be a lower-case hostname"
if [[ "$SEED_DEMO" == 1 && "$ENVIRONMENT" == production ]]; then
  die "--seed-demo is refused for production: every demo account shares one published password"
fi

confirm() {  # confirm "question" — production needs the environment name typed unless --yes
  [[ "$ASSUME_YES" == 1 ]] && return 0
  [[ -t 0 ]] || die "not running interactively: pass --yes to confirm"
  if [[ "$ENVIRONMENT" == production ]]; then
    read -r -p "    $1 Type 'production' to continue: " reply
    [[ "$reply" == production ]] || die "cancelled"
  else
    read -r -p "    $1 [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || die "cancelled"
  fi
}

# --------------------------------------------------------------------------------------- 1. preflight
step "Checking tools and AWS credentials"
for tool in aws terraform docker jq git curl; do
  command -v "$tool" >/dev/null || die "$tool is not installed (see docs/DEPLOYMENT.md, 'Deploy with the script')"
done
aws --version 2>&1 | grep -q '^aws-cli/2' || die "AWS CLI v2 is required"
tf_version="$(terraform version -json | jq -r .terraform_version)"
IFS=. read -r tf_major tf_minor _ <<<"$tf_version"
(( tf_major > 1 || (tf_major == 1 && tf_minor >= 6) )) || die "Terraform >= 1.6 is required (found $tf_version)"
if [[ "$SKIP_BUILD" == 0 ]]; then
  docker info >/dev/null 2>&1 || die "Docker is not running"
  docker buildx version >/dev/null 2>&1 || die "docker buildx is required to build linux/amd64 images"
fi

export AWS_REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || true)}"
export AWS_REGION="${AWS_REGION:-ap-southeast-2}"
export AWS_DEFAULT_REGION="$AWS_REGION"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)" || die "AWS credentials are not configured (aws configure / AWS_PROFILE / SSO login)"
CALLER="$(aws sts get-caller-identity --query Arn --output text)"
REGISTRY="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
STATE_BUCKET="praxis-tfstate-$ACCOUNT_ID-$AWS_REGION"
LOCK_TABLE="praxis-terraform-locks"

if [[ -z "${IMAGE_TAG:-}" ]]; then
  IMAGE_TAG="$(git -C "$ROOT" rev-parse --short=12 HEAD)"
  [[ -z "$(git -C "$ROOT" status --porcelain)" ]] || IMAGE_TAG="$IMAGE_TAG-dirty-$(date -u +%Y%m%d%H%M%S)"
fi
if [[ -n "${GROQ_API_KEY:-}" ]]; then
  [[ -z "${OPENAI_API_KEY:-}" ]] || die "set either GROQ_API_KEY or OPENAI_API_KEY, not both"
  OPENAI_API_KEY="$GROQ_API_KEY"
  AI_BASE_URL="${AI_BASE_URL:-https://api.groq.com/openai/v1}"
  AI_MODEL="${AI_MODEL:-llama-3.3-70b-versatile}"
  AI_PROVIDER="${AI_PROVIDER:-openai}"
fi
AI_BASE_URL="${AI_BASE_URL:-https://api.openai.com/v1}"
AI_MODEL="${AI_MODEL:-gpt-4o-mini}"
if [[ -z "${AI_PROVIDER:-}" ]]; then
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then AI_PROVIDER=openai
  elif [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then AI_PROVIDER=anthropic
  else AI_PROVIDER=offline; fi
fi
EMAIL_FROM="${EMAIL_FROM:-Praxis <no-reply@$DOMAIN>}"
TRUSTED_PROXY_HOPS="${TRUSTED_PROXY_HOPS:-1}"
API_IMAGE="$REGISTRY/praxis-api:$IMAGE_TAG"
WEB_IMAGE="$REGISTRY/praxis-web:$IMAGE_TAG"

# Catch placeholder or mistyped DNS settings before anything is created.
case "$DOMAIN" in
  *yourdomain.com|*example.com|*example.org|*example.net) die "DOMAIN=$DOMAIN is a placeholder: use a domain you own" ;;
esac
if [[ -n "${HOSTED_ZONE_ID:-}" ]]; then
  HOSTED_ZONE_ID="${HOSTED_ZONE_ID#/hostedzone/}"
  zone_name="$(aws route53 get-hosted-zone --id "$HOSTED_ZONE_ID" --query HostedZone.Name --output text 2>/dev/null)" || {
    warn "no Route 53 hosted zone with ID $HOSTED_ZONE_ID in this AWS account. Your hosted zones:"
    aws route53 list-hosted-zones --query 'HostedZones[].[Id,Name]' --output text 2>/dev/null | sed 's#/hostedzone/##; s/^/      /' >&2 || true
    die "set HOSTED_ZONE_ID to the zone that contains $DOMAIN, or leave it out to add the DNS records yourself"
  }
  zone_name="${zone_name%.}"
  [[ "$DOMAIN" == "$zone_name" || "$DOMAIN" == *".$zone_name" ]] \
    || die "$DOMAIN is not inside hosted zone $HOSTED_ZONE_ID ($zone_name)"
fi

bold "Praxis deployment plan"
info "Environment   $ENVIRONMENT"
info "AWS account   $ACCOUNT_ID ($CALLER)"
info "Region        $AWS_REGION"
info "Domain        https://$DOMAIN"
info "Image tag     $IMAGE_TAG$([[ "$SKIP_BUILD" == 1 ]] && echo ' (reusing pushed images)')"
if [[ "$AI_PROVIDER" == openai ]]; then
  info "AI provider   openai-compatible: $AI_MODEL at $AI_BASE_URL"
else
  info "AI provider   $AI_PROVIDER"
fi
info "Email from    $EMAIL_FROM"
if [[ "$AI_PROVIDER" == offline ]]; then warn "no AI key exported: the AI features will use the offline provider (templated output)"; fi
if [[ "$PLAN_ONLY" == 1 ]]; then info "Mode          plan only"; fi
confirm "Deploy to $ENVIRONMENT in $ACCOUNT_ID/$AWS_REGION?"

# ------------------------------------------------------------------------- 2. state backend + registries
step "Terraform state backend"
if aws s3api head-bucket --bucket "$STATE_BUCKET" 2>/dev/null; then
  info "bucket $STATE_BUCKET exists"
else
  if [[ "$AWS_REGION" == us-east-1 ]]; then
    aws s3api create-bucket --bucket "$STATE_BUCKET" >/dev/null
  else
    aws s3api create-bucket --bucket "$STATE_BUCKET" --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
  aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" --versioning-configuration Status=Enabled
  aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  aws s3api put-public-access-block --bucket "$STATE_BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  info "created bucket $STATE_BUCKET (versioned, encrypted, private)"
fi
if aws dynamodb describe-table --table-name "$LOCK_TABLE" >/dev/null 2>&1; then
  info "lock table $LOCK_TABLE exists"
else
  aws dynamodb create-table --table-name "$LOCK_TABLE" --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=LockID,AttributeType=S --key-schema AttributeName=LockID,KeyType=HASH >/dev/null
  aws dynamodb wait table-exists --table-name "$LOCK_TABLE"
  info "created lock table $LOCK_TABLE"
fi

step "Container registries"
for repo in praxis-api praxis-web; do
  if aws ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1; then
    info "$repo exists"
  else
    aws ecr create-repository --repository-name "$repo" --image-scanning-configuration scanOnPush=true \
      --encryption-configuration encryptionType=AES256 >/dev/null
    aws ecr put-lifecycle-policy --repository-name "$repo" --lifecycle-policy-text \
      '{"rules":[{"rulePriority":1,"description":"keep the last 50 images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":50},"action":{"type":"expire"}}]}' >/dev/null
    info "created $repo (scan on push, keeps the last 50 images)"
  fi
done

# ------------------------------------------------------------------------------------ 3. certificate
step "TLS certificate for $DOMAIN"
if [[ -z "${ACM_CERTIFICATE_ARN:-}" ]]; then
  ACM_CERTIFICATE_ARN="$(aws acm list-certificates --certificate-statuses ISSUED PENDING_VALIDATION \
    --query "CertificateSummaryList[?DomainName=='$DOMAIN'] | [0].CertificateArn" --output text)"
  if [[ -z "$ACM_CERTIFICATE_ARN" || "$ACM_CERTIFICATE_ARN" == None ]]; then
    if [[ "$PLAN_ONLY" == 1 ]]; then
      ACM_CERTIFICATE_ARN="arn:aws:acm:$AWS_REGION:$ACCOUNT_ID:certificate/to-be-requested"
      info "no certificate yet; it will be requested on a real run"
    else
      ACM_CERTIFICATE_ARN="$(aws acm request-certificate --domain-name "$DOMAIN" --validation-method DNS \
        --query CertificateArn --output text)"
      info "requested $ACM_CERTIFICATE_ARN"
    fi
  else
    info "found $ACM_CERTIFICATE_ARN"
  fi
fi
if [[ "$ACM_CERTIFICATE_ARN" != *to-be-requested ]]; then
  status="$(aws acm describe-certificate --certificate-arn "$ACM_CERTIFICATE_ARN" --query Certificate.Status --output text)"
  if [[ "$status" != ISSUED ]]; then
    record=""
    for _ in $(seq 1 12); do   # the validation record appears a few seconds after the request
      record="$(aws acm describe-certificate --certificate-arn "$ACM_CERTIFICATE_ARN" \
        --query 'Certificate.DomainValidationOptions[0].ResourceRecord' --output json)"
      [[ "$record" != null ]] && break
      sleep 5
    done
    [[ "$record" != null ]] || die "ACM did not return a DNS validation record yet; re-run in a minute"
    rec_name="$(jq -r .Name <<<"$record")"; rec_value="$(jq -r .Value <<<"$record")"
    if [[ -n "${HOSTED_ZONE_ID:-}" ]]; then
      aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch "$(jq -n \
        --arg n "$rec_name" --arg v "$rec_value" \
        '{Changes:[{Action:"UPSERT",ResourceRecordSet:{Name:$n,Type:"CNAME",TTL:300,ResourceRecords:[{Value:$v}]}}]}')" >/dev/null
      info "validation record written to Route 53 zone $HOSTED_ZONE_ID"
    else
      warn "create this DNS record at your DNS provider so AWS can issue the certificate:"
      info "  CNAME  $rec_name  ->  $rec_value"
    fi
    if [[ "$PLAN_ONLY" == 0 ]]; then
      info "waiting for the certificate to be issued (usually 1-10 minutes after the record exists)..."
      aws acm wait certificate-validated --certificate-arn "$ACM_CERTIFICATE_ARN" \
        || die "certificate not issued yet; check the CNAME record above, then re-run"
      info "certificate issued"
    fi
  else
    info "certificate is issued"
  fi
fi

# ------------------------------------------------------------------------------------------ 4. images
step "Container images ($IMAGE_TAG)"
image_exists() { aws ecr describe-images --repository-name "$1" --image-ids "imageTag=$2" >/dev/null 2>&1; }
if [[ "$SKIP_BUILD" == 1 ]]; then
  if ! { image_exists praxis-api "$IMAGE_TAG" && image_exists praxis-web "$IMAGE_TAG"; }; then
    die "--skip-build: images for tag $IMAGE_TAG are not in ECR"
  fi
  info "reusing $API_IMAGE and $WEB_IMAGE"
elif [[ "$PLAN_ONLY" == 1 ]]; then
  info "plan only: images are not built"
else
  aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
  if image_exists praxis-api "$IMAGE_TAG" && image_exists praxis-web "$IMAGE_TAG"; then
    info "images for $IMAGE_TAG are already pushed"
  else
    info "building the API image (linux/amd64)..."
    docker buildx build --platform linux/amd64 -f "$ROOT/infrastructure/docker/api.Dockerfile" \
      -t "$API_IMAGE" --push "$ROOT"
    info "building the web image (linux/amd64)..."
    docker buildx build --platform linux/amd64 -f "$ROOT/infrastructure/docker/web.Dockerfile" \
      --build-arg "NEXT_PUBLIC_SITE_URL=https://$DOMAIN" -t "$WEB_IMAGE" --push "$ROOT"
    info "pushed $API_IMAGE"
    info "pushed $WEB_IMAGE"
  fi
fi

# --------------------------------------------------------------------------------------- 5. terraform
step "Infrastructure (terraform)"
cd "$TF_DIR"
terraform init -input=false -reconfigure \
  -backend-config="environments/$ENVIRONMENT.backend.hcl" \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="dynamodb_table=$LOCK_TABLE" \
  -backend-config="region=$AWS_REGION" >/dev/null
TF_VARS=(
  -var-file="environments/$ENVIRONMENT.tfvars"
  -var "environment=$ENVIRONMENT" -var "region=$AWS_REGION" -var "domain_name=$DOMAIN"
  -var "acm_certificate_arn=$ACM_CERTIFICATE_ARN" -var "api_image=$API_IMAGE" -var "web_image=$WEB_IMAGE"
  -var "ai_default_provider=$AI_PROVIDER" -var "ai_default_model=$AI_MODEL" -var "ai_openai_base_url=$AI_BASE_URL"
  -var "email_from=$EMAIL_FROM"
  -var "forwarded_trusted_hops=$TRUSTED_PROXY_HOPS"
)
PLAN_FILE="$(mktemp "${TMPDIR:-/tmp}/praxis-plan.XXXXXX")"
trap 'rm -f "$PLAN_FILE"' EXIT
terraform plan -input=false -out="$PLAN_FILE" "${TF_VARS[@]}"
if [[ "$PLAN_ONLY" == 1 ]]; then
  bold "Plan complete. Nothing was applied."
  exit 0
fi
confirm "Apply this plan?"
info "applying (the first run takes 15-25 minutes, mostly the database)..."
terraform apply -input=false "$PLAN_FILE"

tf_out() { terraform output -raw "$1"; }
CLUSTER="$(tf_out ecs_cluster)"
SECRET_ARN="$(tf_out app_secret_arn)"
ALB_DNS="$(tf_out alb_dns_name)"
ALB_ZONE="$(tf_out alb_zone_id)"
TASK_DEFS="$(terraform output -json task_definitions)"
SUBNETS="$(terraform output -json private_subnet_ids | jq -r 'join(",")')"
APP_SG="$(tf_out app_security_group_id)"
NETWORK="awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$APP_SG],assignPublicIp=DISABLED}"
td() { jq -r --arg k "$1" '.[$k]' <<<"$TASK_DEFS"; }
cd "$ROOT"

# ------------------------------------------------------------------------------------------ 6. secrets
step "Application secrets"
updates="{}"
for key in OPENAI_API_KEY ANTHROPIC_API_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET GOOGLE_CLIENT_SECRET \
  MICROSOFT_CLIENT_SECRET SENTRY_DSN; do
  if [[ -n "${!key:-}" ]]; then
    updates="$(jq --arg k "$key" --arg v "${!key}" '. + {($k): $v}' <<<"$updates")"
    info "$key: will be stored"
  fi
done
if [[ "$updates" != "{}" ]]; then
  current="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query SecretString --output text)"
  merged="$(jq -c --argjson u "$updates" '. + $u' <<<"$current")"
  aws secretsmanager put-secret-value --secret-id "$SECRET_ARN" --secret-string "$merged" >/dev/null
  info "secret updated (values not shown)"
else
  info "no keys exported; keeping the stored values"
fi
unset updates current merged

# ------------------------------------------------------------------------ 7. bootstrap + migrations
run_task() {  # run_task <label> <task-definition-arn> [overrides-json] — fails with the task's logs
  local label="$1" taskdef="$2" overrides="${3:-}" task code reason container
  local args=(--cluster "$CLUSTER" --launch-type FARGATE --task-definition "$taskdef" --network-configuration "$NETWORK"
    --query 'tasks[0].taskArn' --output text)
  if [[ -n "$overrides" ]]; then args+=(--overrides "$overrides"); fi
  task="$(aws ecs run-task "${args[@]}")"
  [[ -n "$task" && "$task" != None ]] || die "$label: ECS did not start the task"
  info "$label: running ${task##*/} ..."
  aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task" \
    || aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task"
  code="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" --query 'tasks[0].containers[0].exitCode' --output text)"
  if [[ "$code" != 0 ]]; then
    reason="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" --query 'tasks[0].stoppedReason' --output text)"
    container="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" --query 'tasks[0].containers[0].name' --output text)"
    warn "$label failed (exit $code): $reason"
    aws logs get-log-events --log-group-name "/praxis/$ENVIRONMENT" \
      --log-stream-name "$container/$container/${task##*/}" --limit 40 --query 'events[].message' --output text 2>/dev/null \
      | tr '\t' '\n' | sed 's/^/      /' >&2 || true
    die "$label failed; the services were not changed"
  fi
  info "$label: done"
}

step "Database"
run_task "db-bootstrap" "$(td db_bootstrap)"
run_task "migrations" "$(td migrate)"
if [[ "$SEED_DEMO" == 1 ]]; then
  run_task "demo seed" "$(td migrate)" \
    '{"containerOverrides":[{"name":"migrate","command":["python","-m","app.seed","--if-empty"]}]}'
fi

# -------------------------------------------------------------------------------------- 8. roll out
step "Rolling out $IMAGE_TAG"
aws ecs update-service --cluster "$CLUSTER" --service api --task-definition "$(td api)" >/dev/null
aws ecs update-service --cluster "$CLUSTER" --service worker --task-definition "$(td worker)" >/dev/null
aws ecs update-service --cluster "$CLUSTER" --service web --task-definition "$(td web)" >/dev/null
info "waiting for api, worker and web to become stable (a failed rollout rolls back automatically)..."
for attempt in 1 2 3; do
  aws ecs wait services-stable --cluster "$CLUSTER" --services api worker web && break
  [[ "$attempt" == 3 ]] && die "services did not stabilise; see the ECS console and CloudWatch logs /praxis/$ENVIRONMENT"
done
info "services are stable"

# ----------------------------------------------------------------------------------- 9. DNS + checks
step "DNS"
if [[ -n "${HOSTED_ZONE_ID:-}" ]]; then
  aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch "$(jq -n \
    --arg n "$DOMAIN" --arg d "$ALB_DNS" --arg z "$ALB_ZONE" \
    '{Changes:[{Action:"UPSERT",ResourceRecordSet:{Name:$n,Type:"A",AliasTarget:{HostedZoneId:$z,DNSName:$d,EvaluateTargetHealth:true}}}]}')" >/dev/null
  info "$DOMAIN -> $ALB_DNS (Route 53 alias)"
else
  warn "point your domain at the load balancer at your DNS provider:"
  info "  CNAME  $DOMAIN  ->  $ALB_DNS"
fi

step "Smoke test"
health=""
for _ in $(seq 1 10); do
  health="$(curl -fsS --max-time 10 "https://$DOMAIN/api/v1/health" 2>/dev/null)" && break
  health="$(curl -fsS --max-time 10 -k -H "Host: $DOMAIN" "https://$ALB_DNS/api/v1/health" 2>/dev/null)" && break
  sleep 15
done
if [[ "$(jq -r '.status // empty' <<<"$health" 2>/dev/null)" == ok ]]; then
  info "API healthy: $(jq -c .checks <<<"$health")"
else
  warn "health check did not return status ok yet: ${health:-no response} (DNS may still be propagating)"
fi

bold ""
bold "Deployed $IMAGE_TAG to $ENVIRONMENT: https://$DOMAIN"
info "Logs:     CloudWatch log group /praxis/$ENVIRONMENT (api, worker, beat, web, migrate, db-bootstrap)"
info "Upgrade:  commit, then run this script again."
if [[ "$SEED_DEMO" == 1 ]]; then info "Demo:     accounts as in README.md#demo-accounts (password Praxis-Demo-2026!)"; fi
info "Next:     verify the SES sender ($EMAIL_FROM) and leave the SES sandbox so invites and resets are delivered."
