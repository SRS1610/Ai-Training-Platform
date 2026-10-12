#!/usr/bin/env bash
# Creates the application role (non-superuser, so row-level security is enforced) and the dev + test
# databases with required extensions. Run as a user that can `sudo -u postgres` / `su postgres`.
#   PSQL_SUPER="psql -U postgres -h localhost" ./scripts/dev-db-setup.sh   # override superuser psql command
set -euo pipefail
PSQL_SUPER=${PSQL_SUPER:-"su postgres -c psql"}
psql_super() { if [[ "$PSQL_SUPER" == su* ]]; then su postgres -c "psql -v ON_ERROR_STOP=1 -q $*"; else $PSQL_SUPER -v ON_ERROR_STOP=1 -q "$@"; fi; }

psql_super <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'praxis') THEN
    CREATE ROLE praxis LOGIN PASSWORD 'praxis' NOSUPERUSER NOBYPASSRLS CREATEDB;
  END IF;
END $$;
SQL

for db in praxis praxis_test "$@"; do
  echo "SELECT 'CREATE DATABASE $db OWNER praxis' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$db')\gexec" | psql_super
  psql_super -d "$db" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
done
echo "Databases ready (role: praxis)"
