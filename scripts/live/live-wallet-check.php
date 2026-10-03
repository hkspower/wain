<?php
// READ-ONLY: is Apple Wallet ready on the live shop? Prints wallet_status() (file presence and the
// team id; never a key) plus how many loyalty passes exist. 2026-10-03.
declare(strict_types=1);
$live = '/home/u130124229/domains/sporta.com.kw/public_html/api/';
$dir = is_dir($live) ? $live : __DIR__ . '/../../sporta-site/public_html/api/';
require $dir . 'store.php';
require $dir . 'wallet-setup.php';
$cfg = store_config();
$st = wallet_status($cfg);
foreach ($st as $k => $v) if (is_string($v) && preg_match('/key|pass(word)?$/i', $k)) $st[$k] = $v === '' ? '' : 'set';
echo 'WALLET ' . json_encode($st, JSON_UNESCAPED_SLASHES) . "\n";
try { echo 'PASSES ' . store_db()->query('select count(*) from wallet_passes')->fetchColumn() . "\n"; }
catch (Throwable $e) { echo "PASSES table=missing\n"; }
