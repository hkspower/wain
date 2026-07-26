#!/usr/bin/env bash
# Rebuilds a throwaway PostgreSQL database from supabase/*.sql in the order the
# real project must run them, then seeds the catalogue. Used by the test suites
# and by scripts/db-contract-audit.mjs.
#
#   ./scripts/db-rebuild.sh [dbname]     (default: fresh)
set -euo pipefail
DB="${1:-fresh}"
PG=(psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q)
HERE="$(cd "$(dirname "$0")/.." && pwd)"

"${PG[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
# Supabase's built-in roles, so GRANT/RLS statements behave as they will live.
"${PG[@]}" -d "$DB" -c "
  do \$\$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end \$\$;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

  -- Supabase always provides these; a bare Postgres does not. Stubbing them
  -- keeps the test rig shaped like the real thing, rather than weakening
  -- SETUP-ALL.sql to accommodate a difference that only exists here — the
  -- closing report reads auth.users, and without this every rebuild printed a
  -- confusing error on its very last line.
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
  create or replace function auth.uid() returns uuid language sql stable as \$fn\$ select null::uuid \$fn\$;"

# Apply SETUP-ALL.sql rather than a list of files kept here. The list WAS kept
# here, and it was the sixth place the migration order lived — so adding
# payment-method-migration left this script silently building a database without
# it, and the first symptom was "function create_order(...) does not exist".
# One source of order, regenerated first so it cannot be stale.
node "$HERE/scripts/generate-setup-sql.mjs" >/dev/null
echo "  -> SETUP-ALL.sql"
"${PG[@]}" -d "$DB" -f "$HERE/supabase/SETUP-ALL.sql" >/dev/null
"${PG[@]}" -d "$DB" -c "grant all on all tables in schema public to anon, authenticated, service_role;" 
echo "database '$DB' rebuilt"
