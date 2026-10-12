output "alb_dns_name" { value = aws_lb.main.dns_name }
output "files_bucket" { value = aws_s3_bucket.files.bucket }
output "db_endpoint" { value = aws_db_instance.main.address }
output "ecs_cluster" { value = aws_ecs_cluster.main.name }
output "app_secret_arn" { value = aws_secretsmanager_secret.app.arn }
