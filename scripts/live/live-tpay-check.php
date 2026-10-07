<?php
// READ-ONLY. T-Pay (and KNET via CBK) readiness as CHECKOUT sees it: uses the shop's own cbk_config(), so the
// /backends Payments row (which overrides pay/config.php) is applied. Prints NO credential, only set/PLACEHOLDER/MISSING.
// Also: the method switch in the rules row, config.js tpayEnabled, the return URL against CBK manual v3.02 (https, <=200,
// no query), the gateway host for the environment, and — only when all three credentials are set — one Authenticate call.
//   wget -qO t.php https://raw.githubusercontent.com/hkspower/wain/<sha>/scripts/live/live-tpay-check.php && php t.php
$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$_SERVER['HTTPS'] = 'on';
require $ROOT . '/pay/cbk.php';
$cfg = cbk_config();
$st = function ($v) { $v = (string) $v; if ($v === '') return 'MISSING'; if (preg_match('/^(YOUR_|SANDBOX_NOT_A_REAL|PLACEHOLDER)/i', $v)) return 'PLACEHOLDER'; return 'set'; };
$id = $st($cfg['client_id'] ?? ''); $sec = $st($cfg['client_secret'] ?? ''); $key = $st($cfg['encrp_key'] ?? '');
$ru = (string) ($cfg['return_url'] ?? '');
$ruOk = preg_match('#^https://[^\s?\#]{1,192}$#i', $ru) ? 'ok' : 'BAD';
$host = parse_url(cbk_base($cfg), PHP_URL_HOST);
$a = @include $ROOT . '/api/config.php';
$methods = '?';
if (is_array($a)) { try { $db = new PDO("mysql:host={$a['db_host']};dbname={$a['db_name']};charset=utf8mb4", $a['db_user'], $a['db_pass']);
  $r = $db->query("select value from settings where name='rules'")->fetchColumn(); $j = $r ? json_decode($r, true) : null;
  $methods = is_array($j['payment_methods'] ?? null) ? implode('+', $j['payment_methods']) : 'default(knet+tpay+cod)'; } catch (Throwable $e) { $methods = 'db-error'; } }
$js = @file_get_contents($ROOT . '/config.js'); $tp = preg_match('/tpayEnabled\s*:\s*(true|false)/', (string) $js, $m) ? $m[1] : '?';
$auth = 'skipped(credentials not all set)';
if ($id === 'set' && $sec === 'set' && $key === 'set') {
  try { [$s, $res] = cbk_http('POST', cbk_base($cfg) . '/ePay/api/cbk/online/pg/merchant/Authenticate', $cfg, ['ClientId' => $cfg['client_id'], 'ClientSecret' => $cfg['client_secret'], 'ENCRP_KEY' => $cfg['encrp_key']]);
    $auth = 'http=' . $s . ' Status=' . (is_array($res) ? ($res['Status'] ?? '?') : 'not-json'); } catch (Throwable $e) { $auth = 'error'; } }
$file = cbk_config_file(); $dbOn = cbk_db_configured($file) ? "yes" : "NO"; $rowEnv = "?";
if (is_array($a)) { try { $q = $db->query("select value from settings where name='knet'")->fetchColumn(); $k = $q ? json_decode($q, true) : null; $rowEnv = is_array($k) ? (string) ($k['env'] ?? '(unset)') : 'no-row'; } catch (Throwable $e) { $rowEnv = 'db-error'; } }
echo "WHY fileEnv=" . ($file['env'] ?? '?') . " savedRowEnv=$rowEnv cbkSeesDb=$dbOn\n";
echo "TPAY env=" . ($cfg['env'] ?? '?') . " gateway=$host clientId=$id clientSecret=$sec encrpKey=$key returnUrl=$ruOk payTypeDefault='" . ($cfg['pay_type'] ?? '') . "' methods=$methods configJsTpayEnabled=$tp auth=$auth\n";
