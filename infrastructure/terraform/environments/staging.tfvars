environment          = "staging"
domain_name          = "staging.praxis.example.com"
acm_certificate_arn  = "arn:aws:acm:ap-southeast-2:000000000000:certificate/replace-me"
api_image            = "000000000000.dkr.ecr.ap-southeast-2.amazonaws.com/praxis-api:latest"
web_image            = "000000000000.dkr.ecr.ap-southeast-2.amazonaws.com/praxis-web:latest"
api_desired_count    = 1
worker_desired_count = 1
web_desired_count    = 1
