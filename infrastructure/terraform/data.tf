data "aws_caller_identity" "current" {}

# RDS master password (used only by the one-off db-bootstrap task) and the application role's password.
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "random_password" "app_db" {
  length  = 32
  special = false
}

# Fernet key: 43 URL-safe characters + "=" decode to the 32 bytes Fernet requires.
resource "random_password" "encryption_key" {
  length  = 43
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "pg16" {
  name   = "${local.name}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
}

# pgvector is available on RDS PostgreSQL 16. The one-off "db-bootstrap" ECS task (master user) creates the
# extensions and the non-superuser "praxis" role (NOBYPASSRLS, so row-level security applies); migrations and
# the application then connect as "praxis".
resource "aws_db_instance" "main" {
  identifier                   = local.name
  engine                       = "postgres"
  engine_version               = "16.4"
  instance_class               = var.db_instance_class
  allocated_storage            = 50
  max_allocated_storage        = 500
  storage_encrypted            = true
  db_name                      = "praxis"
  username                     = "praxis_admin"
  password                     = random_password.db.result
  db_subnet_group_name         = aws_db_subnet_group.main.name
  vpc_security_group_ids       = [aws_security_group.data.id]
  parameter_group_name         = aws_db_parameter_group.pg16.name
  multi_az                     = var.db_multi_az
  backup_retention_period      = var.environment == "production" ? 30 : 7
  deletion_protection          = var.environment == "production"
  skip_final_snapshot          = var.environment != "production"
  final_snapshot_identifier    = "${local.name}-final"
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
  copy_tags_to_snapshot        = true
}

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = local.name
  description                = "Praxis cache, rate limits and task queue"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = var.environment == "production" ? 2 : 1
  automatic_failover_enabled = var.environment == "production"
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.data.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
}

# Bucket names are global: suffix the account id so every AWS account gets a unique name.
resource "aws_s3_bucket" "files" { bucket = "${local.name}-files-${data.aws_caller_identity.current.account_id}" }

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_versioning" "files" {
  bucket = aws_s3_bucket.files.id
  versioning_configuration { status = "Enabled" }
}

resource "random_password" "auth_secret" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "app" { name = "${local.name}/app" }

# Generated values are written once; optional keys start empty and are filled by scripts/deploy-aws.sh (or
#   aws secretsmanager put-secret-value --secret-id praxis-<env>/app --secret-string file://secrets.json).
# Every key referenced by the task definitions must exist in the JSON, or ECS cannot start the task.
resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL            = "postgresql+asyncpg://praxis:${random_password.app_db.result}@${aws_db_instance.main.address}:5432/praxis?ssl=require"
    REDIS_URL               = "rediss://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379/0?ssl_cert_reqs=required"
    AUTH_SECRET             = random_password.auth_secret.result
    ENCRYPTION_KEY          = "${random_password.encryption_key.result}="
    OPENAI_API_KEY          = ""
    ANTHROPIC_API_KEY       = ""
    STRIPE_SECRET_KEY       = ""
    STRIPE_WEBHOOK_SECRET   = ""
    GOOGLE_CLIENT_SECRET    = ""
    MICROSOFT_CLIENT_SECRET = ""
    SENTRY_DSN              = ""
  })
  lifecycle { ignore_changes = [secret_string] }
}

# Master credentials, readable only by the db-bootstrap task (not by the application tasks).
resource "aws_secretsmanager_secret" "db_admin" { name = "${local.name}/db-admin" }

resource "aws_secretsmanager_secret_version" "db_admin" {
  secret_id = aws_secretsmanager_secret.db_admin.id
  secret_string = jsonencode({
    ADMIN_DATABASE_URL = "postgresql://praxis_admin:${random_password.db.result}@${aws_db_instance.main.address}:5432/praxis?sslmode=require"
  })
}
