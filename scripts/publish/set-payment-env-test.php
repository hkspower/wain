<?php
/**
 * Put the shop's card gateways in TEST mode — 2026-10-07, "use this as test mode" then "yes now test mode"
 * (CBK's sample request/result pages point at https://pgtest.cbk.com). Writes ONLY `env` in the `knet` settings row (the one
 * the /backends Payments card edits); every other key in that row — Tranportal ID, CBK credentials — is kept as it is. That
 * row's `env` wins over pay/config.php and knet/config.php for BOTH gateways (CBK: pgtest.cbk.com, KNET: kpaytest.com.kw).
 *
 *   wget -qO r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/set-payment-env-test.php && php r.php
 *
 * UNDO: /backends -> Payments -> Environment -> Production (or set env back to 'production' in the row).
 * IDEMPOTENT; reports STATE and never prints a credential.
 */
$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
function line(string $s): void { echo $s, "\n"; @ob_flush(); @flush(); }
$c = @include $ROOT . '/api/config.php';
if (!is_array($c)) { line('NO-CONFIG'); return; }
$db = new PDO("mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4", $c['db_user'], $c['db_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$q = $db->prepare("select value from settings where name = 'knet'"); $q->execute();
$raw = $q->fetchColumn();
$val = is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
if (!is_array($val)) { line('REFUSED knet row is not readable JSON — nothing written'); return; }
$before = (string) ($val['env'] ?? '');
if ($before !== 'test') {
    $val['env'] = 'test';
    $db->prepare("insert into settings (name, value) values ('knet', ?) on duplicate key update value = values(value)")
       ->execute([json_encode($val, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
}
$q->execute(); $after = json_decode((string) $q->fetchColumn(), true);
line('STATE knet.env=' . ($after['env'] ?? '(unset)') . ' wasBefore=' . ($before === '' ? '(unset)' : $before) . ' keysKept=' . count($after ?? []));
