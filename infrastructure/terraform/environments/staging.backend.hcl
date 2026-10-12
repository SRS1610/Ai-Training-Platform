bucket         = "praxis-terraform-state"
key            = "staging/terraform.tfstate"
region         = "ap-southeast-2"
dynamodb_table = "praxis-terraform-locks"
encrypt        = true
