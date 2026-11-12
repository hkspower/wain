#!/bin/sh
# KNET setup on the VPS: store the bank's TEST or PRODUCTION Tranportal credentials in the private
# knet-config.php and choose which one the shop uses. Run it as root in the hPanel VPS browser terminal
# (Hostinger -> VPS -> Browser terminal). No secret is ever typed into a chat, a compose file or a log.
#
#   sh set-knet.sh test          ask for the TEST credentials, save them, switch the shop to the test gateway
#   sh set-knet.sh production    ask for the PRODUCTION credentials, save them, switch to the real gateway
#   sh set-knet.sh switch test|production
#                                switch to credentials saved earlier (no typing); refused if that set is incomplete
#   sh set-knet.sh status        show which sets are saved and which is active (never a value)
#   sh set-knet.sh tidy          remove keys the KNET code never reads (prints their NAMES only; backup first).
#                                Kept: what dropin/php-knet reads (env, test_url, production_url, tranportal_id,
#                                tranportal_password, resource_key, response_url, error_url, result_page_url, language,
#                                log_file, callback_response, mysql_host/name/user/pass, trusted_proxy_ips,
#                                rate_limit_secret), the Merchant ID / Terminal ID keys /backends saves, and the
#                                test_* / production_* credential slots (the same slot names /backends uses).
#
# What it does: backs up knet-config.php next to itself (knet-config.php.bak-<UTC time>), keeps every other key
# (database block, URLs, log file), writes test_* / production_* slots plus the active tranportal_id /
# tranportal_password / resource_key and env, keeps the file's owner and mode, and checks the result
# parses as PHP before replacing the old file. The values are read with echo off and handed to a throw-away
# php:8.4-cli container through environment variables; the container is removed at once.
# Checks: Tranportal ID letters/digits (1-30, as KPay shows it); resource key exactly 16 characters (AES-128); password not empty.
# Afterwards: ask Claude to re-run the read-only KNET scan (`vps-deploy.mjs --scan knet`).
set -eu

# THE FILE THE SHOP READS (measured 2026-11-12): the apache-sporta container mounts /docker/sporta/private/config at
# /run/sporta-config (SPORTA_PRIVATE_CONFIG_DIR, apache-service.override.yml) and config-path.php reads knet-config.php there.
# /docker/sporta/private/knet-config.php (one level up) is a STRAY copy from the retired compose file that nothing reads:
# writing it changed nothing live while still printing "ok". The script refuses that path.
DIR=/docker/sporta/private/config
F="$DIR/knet-config.php"
IMG=php:8.4-cli

[ "$(id -u)" = 0 ] || { echo "Run as root (hPanel browser terminal)."; exit 1; }
[ -f "$F" ] || { echo "Not found: $F (the live KNET config). Is this the Sporta VPS?"; exit 1; }
grep -q '/docker/sporta/private/config:/run/sporta-config' /docker/sporta/apache-service.override.yml 2>/dev/null \
  || { echo "Refused: /docker/sporta/apache-service.override.yml no longer mounts $DIR as /run/sporta-config. Ask Claude to re-check where the shop reads its KNET config."; exit 1; }
command -v docker >/dev/null || { echo "docker not found"; exit 1; }

ACTION="${1:-}"
TARGET="${2:-}"
case "$ACTION" in
  test|production) MODE="$ACTION" ;;
  switch) case "$TARGET" in test|production) MODE="$TARGET" ;; *) echo "usage: sh set-knet.sh switch test|production"; exit 1 ;; esac ;;
  status|tidy) MODE="" ;;
  *) echo "usage: sh set-knet.sh test | production | switch test|production | status | tidy"; exit 1 ;;
esac

KNET_ID=""; KNET_PW=""; KNET_KEY=""
if [ "$ACTION" = test ] || [ "$ACTION" = production ]; then
  printf 'KNET %s Tranportal ID (exactly as KPay shows it): ' "$MODE"; read -r KNET_ID
  printf 'KNET %s Tranportal password (hidden): ' "$MODE"; stty -echo; read -r KNET_PW; stty echo; echo
  printf 'KNET %s resource key, 16 characters (hidden): ' "$MODE"; stty -echo; read -r KNET_KEY; stty echo; echo
  # KNET's own manual (K-063 doc p.10-11) shows Tranportal IDs such as "tran89000" and "01062017": letters and digits,
  # a leading zero kept. Copy it exactly from KPay -> My Accounts -> Accounts (terminal row, Tranportal ID column).
  case "$KNET_ID" in ''|*[!A-Za-z0-9]*) echo "Refused: the Tranportal ID is letters and digits only (copy it exactly from KPay)."; exit 1 ;; esac
  [ "$(printf '%s' "$KNET_ID" | wc -c)" -le 30 ] || { echo "Refused: the Tranportal ID is longer than 30 characters."; exit 1; }
  [ -n "$KNET_PW" ] || { echo "Refused: empty password."; exit 1; }
  [ "$(printf '%s' "$KNET_KEY" | wc -c)" -eq 16 ] || { echo "Refused: the resource key must be exactly 16 characters."; exit 1; }
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
if [ "$ACTION" != status ]; then cp -p "$F" "$F.bak-$STAMP"; echo "backup: $F.bak-$STAMP"; fi

export KNET_ACTION="$ACTION" KNET_MODE="$MODE" KNET_ID KNET_PW KNET_KEY
RC=0
docker run --rm -i -e KNET_ACTION -e KNET_MODE -e KNET_ID -e KNET_PW -e KNET_KEY -v "$DIR:/p" "$IMG" php <<'PHP' || RC=$?
<?php
$f = '/p/knet-config.php';
$cfg = require $f;
if (!is_array($cfg)) { fwrite(STDERR, "knet-config.php does not return an array\n"); exit(1); }
$a = getenv('KNET_ACTION'); $m = getenv('KNET_MODE');
$set = fn($v) => is_string($v) && trim($v) !== '' && !str_starts_with(trim($v), 'YOUR_');
$slot = function ($s) use (&$cfg, $set) {
    return ['id' => $set($cfg[$s . '_tranportal_id'] ?? null), 'pw' => $set($cfg[$s . '_tranportal_password'] ?? null),
            'key' => strlen((string) ($cfg[$s . '_resource_key'] ?? '')) === 16];
};
if ($a === 'status') {
    foreach (['test', 'production'] as $s) { $x = $slot($s); echo "$s set: id=" . ($x['id'] ? 'yes' : 'no') . ' password=' . ($x['pw'] ? 'yes' : 'no') . ' key=' . ($x['key'] ? 'yes' : 'no') . "\n"; }
    echo 'active env: ' . ($cfg['env'] ?? '?') . '; active credentials real: ' . ($set($cfg['tranportal_id'] ?? null) && strlen((string) ($cfg['resource_key'] ?? '')) === 16 ? 'yes' : 'no') . "\n";
    exit(0);
}
if ($a === 'tidy') {
    $keep = ['env', 'test_url', 'production_url', 'tranportal_id', 'tranportal_password', 'resource_key', 'response_url',
             'error_url', 'result_page_url', 'language', 'log_file', 'callback_response', 'mysql_host', 'mysql_name',
             'mysql_user', 'mysql_pass', 'trusted_proxy_ips', 'rate_limit_secret',
             // written by /backends -> Payments (admin.php payment_config): the bank's Merchant ID / Terminal ID, kept for
             // the owner's records (the live file has all six, measured 2026-11-12)
             'merchant_id', 'terminal_id'];
    foreach (['test', 'production'] as $s) foreach (['tranportal_id', 'tranportal_password', 'resource_key', 'merchant_id', 'terminal_id'] as $k) $keep[] = $s . '_' . $k;
    $gone = array_values(array_diff(array_keys($cfg), $keep));
    if (!$gone) { echo "nothing to remove\n"; exit(3); }
    foreach ($gone as $k) unset($cfg[$k]);
    echo 'removing: ' . implode(', ', $gone) . "\n";
    $m = (string) ($cfg['env'] ?? 'test');
    $php = "<?php\n// Written by ops/knet/set-knet.sh tidy (" . gmdate('c') . "). Private: never commit, never serve.\nreturn " . var_export($cfg, true) . ";\n";
    file_put_contents($f . '.tmp', $php, LOCK_EX);
    $check = require $f . '.tmp';
    if (!is_array($check)) { unlink($f . '.tmp'); fwrite(STDERR, "Refused: did not read back\n"); exit(1); }
    echo "ok: kept " . count($check) . " keys\n";
    exit(0);
}
if ($a === 'test' || $a === 'production') {
    $cfg[$m . '_tranportal_id'] = getenv('KNET_ID');
    $cfg[$m . '_tranportal_password'] = getenv('KNET_PW');
    $cfg[$m . '_resource_key'] = getenv('KNET_KEY');
}
$x = $slot($m);
if (!$x['id'] || !$x['pw'] || !$x['key']) { fwrite(STDERR, "Refused: no complete $m credentials saved yet. Run: sh set-knet.sh $m\n"); exit(1); }
$cfg['tranportal_id'] = $cfg[$m . '_tranportal_id'];
$cfg['tranportal_password'] = $cfg[$m . '_tranportal_password'];
$cfg['resource_key'] = $cfg[$m . '_resource_key'];
$cfg['env'] = $m;
$cfg['test_url'] = $cfg['test_url'] ?? 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm';
$cfg['production_url'] = $cfg['production_url'] ?? 'https://kpay.com.kw/kpg/PaymentHTTP.htm';
$php = "<?php\n// Written by ops/knet/set-knet.sh (" . gmdate('c') . "). Private: never commit, never serve.\nreturn " . var_export($cfg, true) . ";\n";
$tmp = $f . '.tmp';
file_put_contents($tmp, $php, LOCK_EX);
$check = require $tmp;
if (!is_array($check) || ($check['env'] ?? '') !== $m) { unlink($tmp); fwrite(STDERR, "Refused: the new file did not read back correctly\n"); exit(1); }
echo "ok: env=$m, $m credentials active\n";
PHP
if [ "$RC" = 3 ]; then rm -f "$F.bak-$STAMP"; echo "unchanged."; exit 0; fi
if [ "$RC" != 0 ]; then rm -f "$F.tmp"; exit "$RC"; fi

if [ "$ACTION" != status ]; then
  chown --reference="$F" "$F.tmp"; chmod --reference="$F" "$F.tmp"; mv "$F.tmp" "$F"
  echo "done. Mode $(stat -c %a "$F"), owner $(stat -c %U "$F"). Ask Claude to re-run the KNET scan."
fi
