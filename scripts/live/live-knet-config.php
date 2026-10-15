<?php
/**
 * READ-ONLY. Reports the KNET settings that decide where the bank sends the customer and how it expects the
 * reply: the mode, the response and error URLs, the reply style, and whether each callback file exists.
 * It prints NO secret: no key, password, resource key or Tranportal password, only whether those are set.
 *
 * Fetch from a full commit SHA and run once:  wget -nv -O r.php <raw URL> && php r.php
 */
$root = '/home/u130124229/domains/sporta.com.kw/public_html';
$cfgFile = $root . '/knet/config.php';
$cfg = is_file($cfgFile) ? (include $cfgFile) : null;
echo "knetConfig=" . (is_file($cfgFile) ? 'present' : 'MISSING') . "\n";
if (is_array($cfg)) {
    $pick = ['mode', 'env', 'test_url', 'production_url', 'response_url', 'error_url', 'callback_response', 'result_page_url'];
    foreach ($pick as $k) {
        $v = $cfg[$k] ?? null;
        echo $k . '=' . (is_scalar($v) ? (string) $v : (is_null($v) ? 'unset' : 'set')) . "\n";
    }
    foreach (['tranportal_id', 'tranportal_password', 'resource_key'] as $k) {
        $v = (string) ($cfg[$k] ?? '');
        $placeholder = $v === '' || stripos($v, 'YOUR_') === 0 || stripos($v, 'SANDBOX') !== false || stripos($v, 'PLACEHOLDER') !== false;
        echo $k . '=' . ($v === '' ? 'empty' : ($placeholder ? 'PLACEHOLDER' : 'set')) . "\n";
    }
}
foreach (['knet/callback.php', 'knet/pay.php', 'knet/knet.php', 'knet/responses.mysql.sql'] as $f) {
    echo $f . '=' . (is_file($root . '/' . $f) ? 'present' : 'MISSING') . "\n";
}
echo "done\n";
