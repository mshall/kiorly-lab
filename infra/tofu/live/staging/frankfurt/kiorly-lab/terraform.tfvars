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
  # Kiorex Passport staff sign-in (INTEGRATION.md "Staff sign-in with Kiorex Passport"). Config only: the client is registered from
  # kiorex-account/config/idp.json (clients kiorly-lab-web, kiorly); nothing secret here. The session HS256 key comes from the JWT_SECRET runtime secret.
  AUTH_MODE                    = "oidc"
  KIOREX_OIDC_ISSUER           = "https://account.staging.kiorex.com"
  OIDC_WEB_CLIENT_ID           = "kiorly-lab-web" # NEEDS_HUMAN S6: replace with the Cognito app client id (identity stack output client_ids) when the IdP is applied
  OIDC_SESSION_MAX_AGE_SECONDS = "3600"           # fallback re-validation: a Passport web session never outlives this (60..28800), even if a back-channel logout is missed
  PUBLIC_BASE_URL              = "https://lab.staging.kiorly.com"
}

domain             = ""
zone_name          = ""
waf_enabled        = false
use_cmk            = true
log_retention_days = 30
alarm_emails       = [] # NEEDS_HUMAN

enable_demo_seed           = true # Q10: staging demo data (non-production only; seeded by hand via scripts/seed-staging.sh)
seed_ensure_demo_passwords = true # explicit opt-in: this staging stack IS a demo stack (published demo password on demo accounts); default false everywhere else

# ADR-040 front door: EMPTY container /kiorly-lab/staging/kiorex-lead-signing. Founder steps (docs: kiorex-platform Docs/NEEDS_HUMAN.md "Partner lead signing secret"):
#   1. tofu apply (creates the container)  2. kiorex-platform/scripts/setup-partner-lead-secret.sh staging  3. set lead_signing_secret_inject = true and apply.
lead_signing_secret        = true
lead_signing_secret_inject = false
