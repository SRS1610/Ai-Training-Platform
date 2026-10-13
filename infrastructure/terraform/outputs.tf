output "alb_dns_name" { value = aws_lb.main.dns_name }
output "alb_zone_id" { value = aws_lb.main.zone_id }
output "files_bucket" { value = aws_s3_bucket.files.bucket }
output "db_endpoint" { value = aws_db_instance.main.address }
output "ecs_cluster" { value = aws_ecs_cluster.main.name }
output "app_secret_arn" { value = aws_secretsmanager_secret.app.arn }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "app_security_group_id" { value = aws_security_group.app.id }
output "task_definitions" {
  value = {
    api          = aws_ecs_task_definition.api.arn
    worker       = aws_ecs_task_definition.worker.arn
    web          = aws_ecs_task_definition.web.arn
    migrate      = aws_ecs_task_definition.migrate.arn
    db_bootstrap = aws_ecs_task_definition.db_bootstrap.arn
  }
}
