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
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;"

for f in schema admin-migration checkout-migration passcode-migration seed-products; do
  echo "  -> $f.sql"
  "${PG[@]}" -d "$DB" -f "$HERE/supabase/$f.sql" >/dev/null
done
"${PG[@]}" -d "$DB" -c "grant all on all tables in schema public to anon, authenticated, service_role;" 
echo "database '$DB' rebuilt"
