#!/usr/bin/env bash
# Creates the local kiorly_lab (and kiorly_lab_test) databases on the workspace Postgres (:5433) if missing. No-op when they exist.
set -euo pipefail
PGBIN="${PGBIN:-/Users/postgres/bin}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
for db in kiorly_lab kiorly_lab_test; do
  if "$PGBIN/psql" -h 127.0.0.1 -p 5433 -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    echo "db $db: exists"
  else
    "$PGBIN/createdb" -h 127.0.0.1 -p 5433 -U postgres "$db"
    echo "db $db: created"
  fi
done
