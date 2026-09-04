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
    // EXACTLY SIXTEEN BYTES, because KNET's trandata is AES-128-CBC and
    // knet_assert_key() refuses anything else. It is here so payments-test.mjs
    // can ENCRYPT a callback the way the bank does and exercise the amount
    // check behind it — which is the code that decides whether the shop was
    // paid, and which no rig could reach while this was empty: every forged
    // callback bounced off `missing_data` long before it, and three assertions
    // about it passed while proving nothing.
    //
    // It is not a real key and cannot be: it is written by this script into a
    // git-ignored file, and package-check.mjs FAILS if a config carrying
    // SANDBOX_NOT_A_REAL ever appears in an upload package.
    'resource_key'    => 'SANDBOX_NOT_REAL',
    'return_url'      => 'http://127.0.0.1:4300/$gw/callback.php',
    'result_page_url' => 'http://127.0.0.1:4300/order',
    'lang'            => 'ar',
    'pay_type'        => '',
    // ---- THE KNET HALF OF THE TEMPLATE ----
    //
    // ONE TEMPLATE IS WRITTEN FOR BOTH GATEWAYS, and until now it carried only
    // CBK's keys plus three of KNET's. So /knet/pay.php had every key it needs
    // to REFUSE a bad request and none of the keys it needs to build a good
    // one: past the order lookup it warned seven times and then died with
    //
    //   Fatal error: knet_gateway_url(): Return value must be of type string,
    //   null returned
    //
    // Nothing noticed, because no rig had ever driven that page with a track id
    // that resolves — payments-test.mjs asks it for an unknown order, a
    // malformed id and no id at all, and all three are answered before this
    // code is reached. The successful path of one of the shop's two card
    // gateways was untested, and untestable, on a config that could not run it.
    'test_url'        => 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm',
    'production_url'  => 'https://kpay.com.kw/kpg/PaymentHTTP.htm',
    'response_url'    => 'http://127.0.0.1:4300/knet/callback.php',
    'error_url'       => 'http://127.0.0.1:4300/knet/callback.php',
    'action'          => '1',
    'currency_code'   => '414',
    'lang_en'         => 'ENG',
    'lang_ar'         => 'ARA',
    'language'        => 'ENG',
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

# api/config.php is hand-made and git-ignored, and it ships with an empty
# cron_key. Several things fail CLOSED without one rather than falling back to
# an empty secret — review links (store_review_token_ok) and the admin's
# emailed sign-in code (store_email_otp_hash) both refuse outright — which is
# right, and which means their rigs cannot run against a sandbox that has none.
#
# So one is filled in if and only if the field is empty. A real key is never
# overwritten, and this file is git-ignored, so nothing here can travel.
CFG="$ROOT/sporta-site/public_html/api/config.php"
if [ -f "$CFG" ] && grep -q "'cron_key' => ''" "$CFG"; then
  sed -i "s/'cron_key' => ''/'cron_key' => 'SANDBOX_NOT_A_REAL_CRON_KEY'/" "$CFG"
  echo "ok   api/config.php given a sandbox cron_key (it was empty)"
fi

cd "$ROOT/sporta-site/public_html"
# dev-router.php mirrors the one .htaccess rewrite the scans exercise — see
# its header. Everything else falls through to the built-in server untouched.
# opcache.revalidate_freq=0 IS NOT A TUNING KNOB HERE — it is the difference
# between a payments rig that means something and one that lies.
#
# The default is 2 seconds: a file already compiled into opcache is re-stat'ed
# at most that often, so a rewrite followed by a request inside that window is
# answered from the STALE copy. knet-test.mjs rewrites knet/config.php and hits
# /knet/pay.php in the same breath — microseconds — to check that blanking the
# Tranportal block moves the shop to the official CBK integration.
#
# It did not move. Five checks failed, deterministically, but ONLY when
# test:payments had run first: that rig drives enough traffic to compile the
# config into opcache with the Tranportal values still in it, and knet-test's
# rewrite then landed inside the revalidation window. Run alone the rig passed,
# which is the worst shape a failure can have — it looks like flakiness and gets
# re-run rather than read. Proved by restarting ONLY the php server between the
# two rigs: same files, same database, all ok.
#
# What that cost: five FAILs against the code that decides which gateway takes
# a customer's card, none of them real. The shop was correct the whole time —
# verified directly, 302 to Tranportal when configured and 303 to the official
# page when blanked.
#
# 0 keeps opcache ON (production runs it, so the sandbox should) and only makes
# it check the timestamp on every request. Not validate_timestamps=0, which
# would freeze the opposite way, and not disabling opcache, which would stop the
# sandbox resembling the server it stands in for.
up php 'http://127.0.0.1:4300/api/api.php?r=products' 200 \
  php -d error_reporting=E_ALL -d log_errors=1 -d error_log=/tmp/php-strict.log \
      -d opcache.revalidate_freq=0 -d opcache.validate_timestamps=1 \
      -S 127.0.0.1:4300 -t . "$ROOT/scripts/dev-router.php"
# THE SCHEMA, BEFORE ANYTHING READS IT.
#
# This step did not exist, and the gap only showed when a table was added: the
# sandbox database was whatever a previous run had left behind, so a migration
# written today reached the rigs only if somebody remembered to import it by
# hand. assistant_qa was created that way and would have vanished with the
# container, taking the qa routes' 200s with it and leaving a suite that fails
# for a reason nothing in the repository explains.
#
# IMPORT-THIS-ONE.sql is the same file the owner imports into the live shop, and
# it is built to be safe to re-run — CREATE TABLE IF NOT EXISTS, ADD COLUMN IF
# NOT EXISTS, INSERT ... ON DUPLICATE KEY UPDATE. Importing it on every start
# means the sandbox is always a FRESH INSTALL plus whatever the rigs have done
# to it, which is the thing the rigs should be testing against.
#
# It runs before the restock on purpose: the seed sets stock figures, so
# repairing the catalogue and then topping it up is the order that leaves 20 a
# size. The other way round tops up and then overwrites it.
#
# Sandbox database only, the same guard the two steps below use.
if [ "${SANDBOX_DB_NAME:-sporta}" = "sporta" ]; then
  if mariadb --default-character-set=utf8mb4 -u sporta -plocaldev sporta \
       < "$ROOT/sporta-site/database-sql/IMPORT-THIS-ONE.sql" 2>/tmp/sandbox-import.log; then
    echo "ok   schema imported (safe to re-run; repairs anything missing)"
  else
    echo "--   schema import failed — see /tmp/sandbox-import.log"
  fi
fi

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
