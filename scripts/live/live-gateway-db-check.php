<?php
// READ-ONLY. Can each payment endpoint reach the orders database? Tries the mysql_* values written in pay/config.php,
// knet/config.php and (for reference) api/config.php, and reports connect OK / the error CODE only — no host, user or password.
//   wget -qO g.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-gateway-db-check.php && php g.php
$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$try = function (string $label, array $c, string $p, string $n, string $u, string $pw) {
    $has = fn ($k) => ($c[$k] ?? '') !== '' ? 'set' : 'empty';
    $own = $has($p) . '/' . $has($n) . '/' . $has($u) . '/' . $has($pw);
    if ($has($p) === 'empty' || $has($u) === 'empty') { echo "$label own(host/name/user/pass)=$own -> inherits api/config.php\n"; return; }
    try { new PDO("mysql:host={$c[$p]};dbname={$c[$n]};charset=utf8mb4", $c[$u], $c[$pw], [PDO::ATTR_TIMEOUT => 5]); echo "$label own=$own -> connect OK\n"; }
    catch (Throwable $e) { echo "$label own=$own -> connect FAILED code=" . $e->getCode() . "\n"; }
};
$pay = @include $ROOT . '/pay/config.php'; $knet = @include $ROOT . '/knet/config.php'; $api = @include $ROOT . '/api/config.php';
if (is_array($pay)) $try('pay/config.php ', $pay, 'mysql_host', 'mysql_name', 'mysql_user', 'mysql_pass'); else echo "pay/config.php unreadable\n";
if (is_array($knet)) { $k = $knet; foreach (['host', 'name', 'user', 'pass'] as $x) if (!isset($k['mysql_' . $x]) && isset($k['db_' . $x])) $k['mysql_' . $x] = $k['db_' . $x]; $try('knet/config.php', $k, 'mysql_host', 'mysql_name', 'mysql_user', 'mysql_pass'); } else echo "knet/config.php unreadable\n";
if (is_array($api)) $try('api/config.php ', $api, 'db_host', 'db_name', 'db_user', 'db_pass'); else echo "api/config.php unreadable\n";
