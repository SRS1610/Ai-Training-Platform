bucket         = "praxis-terraform-state"
key            = "production/terraform.tfstate"
region         = "ap-southeast-2"
dynamodb_table = "praxis-terraform-locks"
encrypt        = true
