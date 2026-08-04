#!/usr/bin/env bash
# Bring up the local test rigs. Idempotent, quiet, and it NEVER fails.
#
#   ./scripts/dev-rigs.sh          start whatever is not already running
#   ./scripts/dev-rigs.sh status   just report
#   ./scripts/dev-rigs.sh stop     stop the ones this script started
#
# WHY THIS EXISTS
# Every suite in this repo talks to a real thing rather than a mock — a real
# MariaDB, a real PHP server per drop-in, a real fake bank speaking the real
# Tranportal protocol. That is the point of them, and it is why they catch
# things a mock never would.
#
# The cost is six servers and a database, and the failure mode when one is down
# is not "rig missing" — it is `TypeError: fetch failed` with an ECONNREFUSED
# buried four frames deep, or `ERROR 2002 ... mysqld.sock`. Both read as a
# broken test suite. In one session that misdirection cost a dozen turns and
# two wrong diagnoses.
#
# Ports, and which suite dies without each:
#   8095  dropin/php-store           native, assistant, knet, tpay
#   8096  scripts/router-native.php  arabic (the browser half)
#   8097  scripts/ (fake KNET bank)  knet
#   8098  dropin/php-knet            knet
#   8099  fake-cbk-gateway.php       tpay
#   8100  dropin/php-cbk             tpay
#
# 8101 (fake-voice) is deliberately NOT here: assistant-test.mjs spawns and
# kills it itself, and a second one on the port would make that suite fail.
#
# NEVER EXITS NON-ZERO. This runs from a SessionStart hook, and a hook that
# fails is a hook that greets you with a wall of red before you have typed
# anything. If a rig cannot start, that is reported and the session continues.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 0
WEB="$PWD"
LOGS="${TMPDIR:-/tmp}/sporta-rigs"
mkdir -p "$LOGS" 2>/dev/null

up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# php -S <port> [-t docroot] [router]
serve() {
  local port=$1 what=$2; shift 2
  if up "$port"; then echo "  :$port already up   ($what)"; return; fi
  if ! command -v php >/dev/null 2>&1; then echo "  :$port SKIP no php  ($what)"; return; fi
  nohup php -S "127.0.0.1:$port" "$@" >"$LOGS/$port.log" 2>&1 &
  for _ in $(seq 20); do up "$port" && break; sleep 0.2; done
  if up "$port"; then echo "  :$port started      ($what)"
  else echo "  :$port FAILED       ($what) — see $LOGS/$port.log"; fi
}

case "${1:-start}" in
status)
  for p in 8095 8096 8097 8098 8099 8100; do
    up "$p" && echo "  :$p up" || echo "  :$p down"
  done
  mariadb -e 'select 1' >/dev/null 2>&1 && echo "  mariadb up" || echo "  mariadb down"
  exit 0
  ;;
stop)
  # Only PHP dev servers on our ports; MariaDB is left alone because it may
  # well have been running before this script ever ran.
  pkill -f 'php -S 127.0.0.1:809[5-9]' 2>/dev/null
  pkill -f 'php -S 127.0.0.1:8100' 2>/dev/null
  echo "rigs stopped (mariadb left running)"
  exit 0
  ;;
esac

echo "sporta rigs:"

# ---- the database -----------------------------------------------------------
# Started only if it is not already answering. The start command differs per
# machine — Homebrew on the owner's Mac, a bare daemon in a container — so both
# are tried and neither is required.
if ! mariadb -e 'select 1' >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1 && brew services list 2>/dev/null | grep -q '^mariadb'; then
    brew services start mariadb >/dev/null 2>&1
  elif command -v mariadbd >/dev/null 2>&1; then
    nohup mariadbd --user=root >"$LOGS/mariadb.log" 2>&1 &
  elif command -v mysqld >/dev/null 2>&1; then
    nohup mysqld --user=root >"$LOGS/mariadb.log" 2>&1 &
  fi
  for _ in $(seq 30); do mariadb -e 'select 1' >/dev/null 2>&1 && break; sleep 1; done
fi

if mariadb -e 'select 1' >/dev/null 2>&1; then
  # The schema, if the database is empty. install.mysql.sql is generated and
  # safe to re-run — every statement is CREATE TABLE IF NOT EXISTS or an insert
  # that ignores duplicates — so this repairs a half-set-up database and does
  # nothing to a good one. It does NOT touch orders.
  if ! mariadb sporta -e 'select 1 from products limit 1' >/dev/null 2>&1; then
    mariadb -e 'create database if not exists sporta' 2>/dev/null
    if mariadb sporta < dropin/php-store/install.mysql.sql >/dev/null 2>&1; then
      echo "  mariadb started + schema imported"
    else
      echo "  mariadb up, but the schema import failed — try it by hand"
    fi
  else
    echo "  mariadb ready"
  fi
else
  echo "  mariadb DOWN — every backend suite will fail with ERROR 2002"
fi

# ---- the servers ------------------------------------------------------------
serve 8095 "php-store API"      -t dropin/php-store
serve 8096 "the site (arabic)"  scripts/router-native.php
serve 8097 "fake KNET bank"     -t scripts
serve 8098 "php-knet"           -t dropin/php-knet
serve 8099 "fake CBK gateway"   -t scripts scripts/fake-cbk-gateway.php
serve 8100 "php-cbk"            -t dropin/php-cbk

# dist/ is what :8096 serves. Not built here — a build is slow enough that
# nobody wants it on every session start — but said, because otherwise the
# arabic browser checks fail against an empty directory for no visible reason.
[ -f dist/index.html ] || echo "  note: dist/ is not built — 'npm run build' before test:arabic"

exit 0
