<?php
// READ-ONLY. Why cbk_config() reports env=production while the saved settings row says test: runs cbk_apply_saved's own steps
// and prints the exception text if the saved row cannot be read. Prints no credential.
$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$_SERVER['HTTPS'] = 'on';
require $ROOT . '/pay/cbk.php';
$cfg = cbk_config_file();
echo 'dbConfigured=' . (cbk_db_configured($cfg) ? 'yes' : 'no') . ' host=' . ($cfg['mysql_host'] ?? '') . ' name=' . ($cfg['mysql_name'] ?? '') . ' user=' . (($cfg['mysql_user'] ?? '') !== '' ? 'set' : 'empty') . ' pass=' . (($cfg['mysql_pass'] ?? '') !== '' ? 'set' : 'empty') . "\n";
try {
    $pdo = new PDO("mysql:host={$cfg['mysql_host']};dbname={$cfg['mysql_name']};charset=utf8mb4", $cfg['mysql_user'], $cfg['mysql_pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 5]);
    $q = $pdo->prepare('select value from settings where name = ?'); $q->execute(['knet']);
    $row = $q->fetchColumn(); $val = is_string($row) && $row !== '' ? json_decode($row, true) : null;
    echo 'row=' . (is_array($val) ? 'ok env=' . ($val['env'] ?? '(unset)') . ' keys=' . count($val) : 'unreadable') . "\n";
} catch (Throwable $e) { echo 'PDO-FAIL ' . get_class($e) . ': ' . preg_replace('/(password|pass)[^ ]*/i', '$1=…', $e->getMessage()) . "\n"; }
$after = cbk_apply_saved($cfg); echo 'applied env=' . ($after['env'] ?? '?') . ' fileEnv=' . ($cfg['env'] ?? '?') . "\n";
