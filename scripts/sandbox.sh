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

# The two bank dropins need a config.php each, and neither is committed —
# they hold live credentials. For the SANDBOX a fake one is written instead,
# with obviously invalid CBK values and the local database, so the dropins'
# own refusals (unknown order, already paid, an amount named in the URL) can
# be exercised without ever being able to reach a bank. If a real config.php
# is present it is left exactly as it is.
for gw in pay knet; do
  cfg="$ROOT/sporta-site/public_html/$gw/config.php"
  [ -f "$cfg" ] && continue
  cat > "$cfg" <<PHP
<?php
// SANDBOX ONLY — written by scripts/sandbox.sh, git-ignored, never deployed.
// The credentials are deliberately invalid: this exists so the dropin can be
// tested up to the point where it would call the bank, and no further.
return [
    'env'             => 'test',
    'test_base'       => 'https://pgtest.cbk.com',
    'production_base' => 'https://pg.cbk.com',
    'client_id'       => 'SANDBOX_NOT_A_REAL_CLIENT',
    'client_secret'   => 'SANDBOX_NOT_A_REAL_SECRET',
    'encrp_key'       => 'SANDBOX_NOT_A_REAL_KEY',
    'tranportal_id'       => 'SANDBOX',
    'tranportal_password' => 'SANDBOX',
    'terminal_resource_key' => 'SANDBOX',
    'return_url'      => 'http://127.0.0.1:4300/$gw/callback.php',
    'result_page_url' => 'http://127.0.0.1:4300/order',
    'lang'            => 'ar',
    'pay_type'        => '',
    'log_file'        => '/tmp/sandbox-$gw-payments.log',
    'token_cache_file'=> '/tmp/sandbox-$gw-token.json',
    // NO mysql_* here on purpose. Left out, the dropin inherits the orders
    // database from api/config.php — which is the path a real install uses
    // and the one worth exercising, rather than a second copy of the same
    // four values that can drift from it.
];
PHP
  echo "up   $gw/config.php written (sandbox credentials, cannot reach a bank)"
done

cd "$ROOT/sporta-site/public_html"
# dev-router.php mirrors the one .htaccess rewrite the scans exercise — see
# its header. Everything else falls through to the built-in server untouched.
up php 'http://127.0.0.1:4300/api/api.php?r=products' 200 \
  php -d error_reporting=E_ALL -d log_errors=1 -d error_log=/tmp/php-strict.log \
      -S 127.0.0.1:4300 -t . "$ROOT/scripts/dev-router.php"
# RESTOCK. The rigs place real orders against this database and real orders
# take real stock, so a suite that passed this morning fails this afternoon
# with out_of_stock and looks like a broken checkout. Nothing here is precious
# — it is seed data — so every size goes back to 20 on each run.
#
# Sandbox only, and it refuses to touch anything that is not the local seed
# database, because the one thing worse than a rig that runs out of stock is a
# rig that rewrites a real shop's.
if [ "${SANDBOX_DB_NAME:-sporta}" = "sporta" ] && [ -z "${SANDBOX_NO_RESTOCK:-}" ]; then
  # The order endpoint is throttled per IP, correctly — it is an
  # unauthenticated route that writes. A suite placing a dozen orders from one
  # machine is exactly the shape that throttle exists to stop, so the counter
  # is cleared here rather than the throttle being weakened in the shop.
  if mariadb -u sporta -plocaldev sporta -e "
       update product_variants set stock = 20 where stock < 20;
       delete from rate_limit;" 2>/dev/null; then
    echo "ok   stock topped up to 20 a size, throttle counters cleared"
  else
    echo "--   could not restock (not fatal; rigs may hit out_of_stock or 429)"
  fi
fi

# AN ADMIN ACCOUNT, so admin-live-test.mjs can sign in to the REAL admin.php.
# Idempotent: the insert keeps an existing row's password. The hash is minted
# by PHP itself, because password_hash() output is what password_verify()
# expects and nothing else needs to know its shape. Sandbox database only,
# same guard as the restock above.
if [ "${SANDBOX_DB_NAME:-sporta}" = "sporta" ]; then
  HASH=$(php -r 'echo password_hash("correct horse", PASSWORD_DEFAULT);')
  if mariadb -u sporta -plocaldev sporta -e "
       insert into admin_users (email, password_hash)
       values ('manager@sporta.com.kw', '$HASH')
       on duplicate key update email = email;
       update admin_users set failed_attempts = 0, locked_until = null
        where email = 'manager@sporta.com.kw';" 2>/dev/null; then
    echo "ok   admin account seeded (manager@sporta.com.kw)"
  else
    echo "--   could not seed admin (admin-live-test will fail to sign in)"
  fi
fi

cd "$ROOT"
# 401 is the right answer from the mock with no token — it means it is awake.
up mock-admin 'http://127.0.0.1:8899/admin.php?r=today' 401 python3 scripts/mock-admin.py 8899
up dist 'http://127.0.0.1:4173/shop' 200 python3 scripts/serve-dist.py 4173
