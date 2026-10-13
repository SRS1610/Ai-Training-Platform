variable "environment" {
  type        = string
  description = "staging | production"
}
variable "region" {
  type    = string
  default = "ap-southeast-2"
}
variable "domain_name" {
  type        = string
  description = "Public hostname, e.g. app.praxis.example"
}
variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate (same region as the ALB) for domain_name"
}
variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}
variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}
variable "db_multi_az" {
  type    = bool
  default = false
}
variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}
variable "api_image" { type = string }
variable "web_image" { type = string }
variable "api_desired_count" {
  type    = number
  default = 2
}
variable "worker_desired_count" {
  type    = number
  default = 2
}
variable "web_desired_count" {
  type    = number
  default = 2
}
variable "api_cpu" {
  type    = number
  default = 512
}
variable "api_memory" {
  type    = number
  default = 1024
}
variable "ai_default_provider" {
  type        = string
  default     = "offline"
  description = "openai | anthropic | azure_openai | google | local | offline (offline needs no API key)"
}
variable "email_from" {
  type        = string
  default     = ""
  description = "Sender for transactional email; must be an SES-verified identity. Defaults to no-reply@<domain_name>."
}
variable "forwarded_trusted_hops" {
  type        = number
  default     = 1
  description = "Proxies in front of the API that append to X-Forwarded-For (1 = ALB; 2 = Cloudflare + ALB)"
}
