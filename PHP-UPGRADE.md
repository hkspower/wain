# The storefront on PHP 8.5

## What could be checked here, and what could not

PHP 8.5 **could not be installed** in this container: the packages come from
`ppa.launchpadcontent.net`, which the network policy refuses (403 on every
`.deb`). So nothing below is "it runs on 8.5" — it is everything short of that,
run for real rather than read.

What was done instead:

- **MariaDB 10.11 installed and the real schema imported** —
  `database-sql/IMPORT-THIS-ONE.sql`, 24 tables, 46 products, 42 stock rows.
- **The site served by PHP 8.4.19** with `error_reporting=E_ALL`, every notice
  and deprecation logged.
- **Every PHP file linted**: 28 files, all parse.
- **Every reachable route exercised**: 24 authenticated admin routes, the
  storefront's catalogue, stock, brands, slides, sitemap and preflight, and a
  real order written to the database.

## The result

**Zero** deprecations, warnings or notices, across all of it. The log file was
empty at the end of every sweep.

That matters more than it sounds: today's deprecations are tomorrow's removals,
so a codebase that is silent under `E_ALL` on 8.4 is a codebase with nothing
queued to break. `scripts/php-deprecations.php` also scans for the constructs
PHP has already deprecated or removed — `strftime`, `utf8_encode`, `${}`
interpolation, implicitly nullable parameters, `each()`, `create_function()`,
ext/mysql — and finds none.

That scanner's first run reported 53 issues and every one was wrong: it matched
`mysql_` inside config KEYS named `mysql_host`, and flagged parameters that were
already `?string`. Both rules were fixed before anything was reported. A scanner
that cries wolf is worse than no scanner.

## What is still untested

- **8.5 itself.** The only honest way to close this is to switch PHP in hPanel
  (Advanced → PHP Configuration) on a staging domain and re-run
  `api/preflight.php`, which checks the database, the extensions and the
  writable paths and prints what is wrong.
- **The payment drop-ins.** `knet/` and `pay/` need live bank credentials;
  `knet/selftest.php` answers without them and returns 200, but the signing and
  callback paths were not exercised.
- **The cron scripts.** They refuse to run without the shared secret from
  `config.php`, which is correct behaviour and means they were not run.

## Reproducing this

```
apt-get install -y mariadb-server && mariadbd --user=mysql &
mysql -uroot -e "create database sporta; ..."
mysql -uroot sporta < sporta-site/database-sql/IMPORT-THIS-ONE.sql
cp sporta-site/public_html/api/config.example.php sporta-site/public_html/api/config.php   # fill in
cd sporta-site/public_html && php -d error_reporting=E_ALL -d log_errors=1 \
  -d error_log=/tmp/php.log -S 127.0.0.1:4300 -t . &
npm run scan:php
npm run test:live
```

`api/config.php` is git-ignored, as it is on the server.
