aws_account_id = "599243104052" # Kiorex account (aws-kiorex-profile), eu-central-1

# PLACEHOLDER: kiorly-lab ships with M15-M19 (KX-07) - nothing is created while enabled = false.
# To bring the stack up: set enabled = true, review the sizing below, then follow infra/tofu/README.md.
enabled = false

api = {
  cpu             = "1024"
  memory          = "2048"
  min             = 1
  max             = 4
  max_concurrency = 100
  health_path     = "/api/v1/health/live"
}

db = {
  engine_version       = "16"
  instance_class       = "db.t4g.micro"
  multi_az             = false
  backup_days          = 7
  deletion_protection  = false
  skip_final_snapshot  = true
  storage_gb           = 20
  max_storage_gb       = 50
  name                 = "lab"
  username             = "labapp"
  performance_insights = false
}

uploads = { versioning = true, kms = true } # S3 for reports/scans; analyzer bridge = on-prem agent -> HTTPS API (no inbound to lab LAN)

env_vars = {
  NODE_ENV        = "production"
  SWAGGER_ENABLED = "false"
}

domain             = ""
zone_name          = ""
waf_enabled        = false
use_cmk            = true
log_retention_days = 30
alarm_emails       = [] # NEEDS_HUMAN

enable_demo_seed = true # Q10: staging demo data (non-production only; seeded by hand via scripts/seed-staging.sh)
