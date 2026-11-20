#!/usr/bin/env bash
# Non-interactive migration generator: diffs prisma/migrations against schema.prisma using a throwaway shadow DB, writes a timestamped migration folder, applies it to the dev DB.
# Usage: scripts/new-migration.sh <name>
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="$1"
PGBIN="${PGBIN:-/Users/postgres/bin}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
SHADOW=kiorly_lab_shadow
"$PGBIN/psql" -h 127.0.0.1 -p 5433 -U postgres -qc "DROP DATABASE IF EXISTS $SHADOW" -c "CREATE DATABASE $SHADOW" >/dev/null
TS=$(date -u +%Y%m%d%H%M%S)
DIR="prisma/migrations/${TS}_${NAME}"
mkdir -p "$DIR"
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://postgres:postgres@127.0.0.1:5433/$SHADOW" --script > "$DIR/migration.sql"
"$PGBIN/psql" -h 127.0.0.1 -p 5433 -U postgres -qc "DROP DATABASE IF EXISTS $SHADOW" >/dev/null
if [ -n "${EXTRA_SQL_FILE:-}" ]; then cat "$EXTRA_SQL_FILE" >> "$DIR/migration.sql"; fi
wc -l "$DIR/migration.sql"
npx prisma migrate deploy 2>&1 | tail -3
