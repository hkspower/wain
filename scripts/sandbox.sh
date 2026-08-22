#!/usr/bin/env bash
# Brings up everything the test rigs need, and is safe to run again at any
# time — each service is only started if it is not already answering.
#
#   bash scripts/sandbox.sh
#
# The four are: MariaDB, the PHP site on 4300 (with E_ALL, so a deprecation
# shows up as a log line rather than as a surprise on PHP 8.5), the mock admin
# API on 8899, and the exported app on 4173.
#
# It exists because these processes do not survive this container going idle,
# and a suite that fails with ERR_FAILED on every page looks exactly like a
# broken app until you notice nothing is listening.
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)

up() {  # up <name> <url> <expected-code> <command...>
  local name=$1 url=$2 want=$3; shift 3
  local code
  code=$(curl -s -o /dev/null -m 2 -w '%{http_code}' "$url" 2>/dev/null || echo 000)
  if [ "$code" = "$want" ]; then echo "ok   $name already up ($code)"; return; fi
  ( setsid nohup "$@" >"/tmp/sandbox-$name.log" 2>&1 </dev/null & )
  for _ in $(seq 20); do
    sleep 1
    code=$(curl -s -o /dev/null -m 2 -w '%{http_code}' "$url" 2>/dev/null || echo 000)
    [ "$code" = "$want" ] && { echo "up   $name ($code)"; return; }
  done
  echo "FAIL $name — last code $code, see /tmp/sandbox-$name.log"
}

# MariaDB has no HTTP port of its own; the PHP site answering 200 is the proof
# it is up, so it is started first and checked through that.
if ! pgrep -x mariadbd >/dev/null; then
  ( setsid nohup mariadbd --user=mysql --skip-networking=0 --bind-address=127.0.0.1 \
      >/tmp/sandbox-mariadb.log 2>&1 </dev/null & )
  sleep 6
fi

cd "$ROOT/sporta-site/public_html"
up php 'http://127.0.0.1:4300/api/api.php?r=products' 200 \
  php -d error_reporting=E_ALL -d log_errors=1 -d error_log=/tmp/php-strict.log \
      -S 127.0.0.1:4300 -t .
cd "$ROOT"
# 401 is the right answer from the mock with no token — it means it is awake.
up mock-admin 'http://127.0.0.1:8899/admin.php?r=today' 401 python3 scripts/mock-admin.py 8899
up dist 'http://127.0.0.1:4173/shop' 200 python3 scripts/serve-dist.py 4173
