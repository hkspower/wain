#!/usr/bin/env bash
# The local test rig, in one command. Safe to re-run: anything already up is
# left alone, anything missing is started.
#
#   bash scripts/sandbox.sh          (from sporta-web/)
#
# What it brings up, and which suites need it:
#   MariaDB, database `sporta`      native, knet, tpay, assistant, install-sql
#     loaded from install.mysql.sql + every additive *.mysql.sql
#   :8095  php -S dropin/php-store  native, knet, tpay, assistant
#   :8096  router-native (dist+api) arabic, native-e2e
#   :8188  router-native (dist+api) seo, legal, mobile audits
#   :4173  vite preview (dist)      contrast
#   :8097  fake KNET bank           knet
#   :8098  php -S dropin/php-knet   knet
#   :8099  fake CBK gateway         tpay
#   :8100  php -S dropin/php-cbk    tpay
#
# The three config.php files it writes are TEST configs (fake gateways, a
# local DB user, throwaway keys the fakes expect). They are git-ignored, and
# they are never the server's: the real ones live only on Hostinger and are
# in publish's never-touch list. Nothing here can reach the live site.
set -u
cd "$(dirname "$0")/.."
ROOT=$PWD
LOGS=/tmp/sporta-sandbox
mkdir -p "$LOGS"

say() { printf '%s\n' "$*"; }
up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
wait_port() { for _ in $(seq 1 50); do up "$1" && return 0; sleep 0.2; done; say "!! :$1 did not come up — see $LOGS"; return 1; }

# ------------------------------------------------------------------ MariaDB
if ! command -v mariadbd >/dev/null; then
  say '-- installing MariaDB'
  (apt-get install -y -q mariadb-server >/dev/null 2>&1 ||
   (apt-get update -q >/dev/null 2>&1 && apt-get install -y -q mariadb-server >/dev/null 2>&1)) ||
   { say '!! could not install MariaDB'; exit 1; }
fi
if ! mariadb -e 'select 1' >/dev/null 2>&1; then
  say '-- starting MariaDB'
  mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld 2>/dev/null
  [ -d /var/lib/mysql/mysql ] || mariadb-install-db --user=mysql >/dev/null 2>&1
  nohup mariadbd --user=mysql >"$LOGS/mariadb.log" 2>&1 &
  for _ in $(seq 1 50); do mariadb -e 'select 1' >/dev/null 2>&1 && break; sleep 0.2; done
  mariadb -e 'select 1' >/dev/null 2>&1 || { say "!! MariaDB did not start — $LOGS/mariadb.log"; exit 1; }
fi
mariadb -e "create database if not exists sporta character set utf8mb4 collate utf8mb4_unicode_ci;
  create user if not exists 'sporta'@'localhost' identified by 'test-pass';
  create user if not exists 'sporta'@'127.0.0.1' identified by 'test-pass';
  grant all on sporta.* to 'sporta'@'localhost'; grant all on sporta.* to 'sporta'@'127.0.0.1';
  grant all on \`sqlinst%\`.* to 'sporta'@'localhost';"
SQL=dropin/php-store
mariadb sporta < "$SQL/install.mysql.sql" || { say '!! install.mysql.sql failed'; exit 1; }
for f in "$SQL"/*.mysql.sql; do
  case "$(basename "$f")" in install.mysql.sql|schema.mysql.sql|seed.mysql.sql|brands.mysql.sql|promo.mysql.sql) continue;; esac
  mariadb sporta < "$f" || say "!! $(basename "$f") failed"
done
# The admin the suites sign in as. Only inserted when missing, so a re-run
# does not reset anything a suite is in the middle of proving.
HASH=$(php -r 'echo password_hash("correct-horse-battery-kw", PASSWORD_DEFAULT);')
mariadb sporta -e "insert ignore into admin_users (email, password_hash) values ('cs@sporta.com.kw', '$HASH')"

# ---------------------------------------------------------------- test configs
if [ ! -f "$SQL/config.php" ]; then
  # Hand-written and minimal on purpose: test:assistant splices a fake voice
  # in before the closing `];` and refuses to run if tts_ keys are already
  # there, so this must NOT be a copy of config.example.php.
  cat > "$SQL/config.php" <<'PHP'
<?php
return [
    'db_host'  => 'localhost',
    'db_name'  => 'sporta',
    'db_user'  => 'sporta',
    'db_pass'  => 'test-pass',
    'cron_key' => 'sandbox-cron-key-0123456789',
];
PHP
fi
if [ ! -f dropin/php-knet/config.php ]; then
  php -r '
    $c = require "dropin/php-knet/config.example.php";
    $c["env"] = "test";
    $c["test_url"] = "http://127.0.0.1:8097/fake-knet-bank.php";
    $c["tranportal_id"] = "TESTID001"; $c["tranportal_password"] = "testpass";
    $c["resource_key"] = "abcdef0123456789";
    $c["response_url"] = "http://127.0.0.1:8098/callback.php";
    $c["error_url"]    = "http://127.0.0.1:8098/callback.php";
    $c["result_page_url"] = "https://www.sporta.com.kw/payment/result";
    $c["log_file"] = "/tmp/knet-test.log";
    $c["mysql_host"] = "127.0.0.1"; $c["mysql_name"] = "sporta";
    $c["mysql_user"] = "sporta";    $c["mysql_pass"] = "test-pass";
    file_put_contents("dropin/php-knet/config.php", "<?php\nreturn " . var_export($c, true) . ";\n");'
fi
if [ ! -f dropin/php-cbk/config.php ]; then
  php -r '
    $c = require "dropin/php-cbk/config.example.php";
    $c["env"] = "test";
    $c["test_base"] = "http://127.0.0.1:8099";
    $c["client_id"] = "TESTCLIENT"; $c["client_secret"] = "testsecret"; $c["encrp_key"] = "TESTENCRP";
    $c["return_url"] = "http://127.0.0.1:8100/callback.php";
    $c["result_page_url"] = "https://www.sporta.com.kw/payment/result";
    $c["log_file"] = "/tmp/cbk-test.log";
    $c["token_cache_file"] = "/tmp/.cbk_token_test.json";
    $c["mysql_host"] = "127.0.0.1"; $c["mysql_name"] = "sporta";
    $c["mysql_user"] = "sporta";    $c["mysql_pass"] = "test-pass";
    file_put_contents("dropin/php-cbk/config.php", "<?php\nreturn " . var_export($c, true) . ";\n");'
fi

# ---------------------------------------------------------------------- build
# The browser suites test what ships, so they test dist/. Rebuilt when any
# source is newer than the last build.
if [ ! -f dist/index.html ] || [ -n "$(find src public index.html -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  say '-- building dist/'
  VITE_PHP_API_URL= VITE_PAY_BASE_URL= VITE_CBK_BASE_URL= npx vite build >"$LOGS/build.log" 2>&1 ||
    { say "!! build failed — $LOGS/build.log"; exit 1; }
fi

# -------------------------------------------------------------------- servers
serve() { # port, log name, args...
  local port=$1 name=$2; shift 2
  up "$port" && return 0
  nohup "$@" >"$LOGS/$name.log" 2>&1 &
  wait_port "$port"
}
serve 8095 store  php -S 127.0.0.1:8095 -t dropin/php-store
serve 8096 site   php -S 127.0.0.1:8096 scripts/router-native.php
serve 8188 seo    php -S 127.0.0.1:8188 scripts/router-native.php
serve 8097 bank   php -S 127.0.0.1:8097 -t scripts
serve 8098 knet   php -S 127.0.0.1:8098 -t dropin/php-knet
serve 8099 cbkgw  php -S 127.0.0.1:8099 -t scripts scripts/fake-cbk-gateway.php
serve 8100 cbk    php -S 127.0.0.1:8100 -t dropin/php-cbk
serve 4173 preview npx vite preview --host localhost --port 4173 --strictPort

say "sandbox up — logs in $LOGS"
