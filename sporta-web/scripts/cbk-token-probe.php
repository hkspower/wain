<?php
// Used by tpay-test.mjs: is a cached CBK Authenticate key reused only for the
// gateway + ClientId it was issued to? The gateway here is unreachable on
// purpose, so "reused" prints the cached key and "not reused" prints NEW
// (cbk_get_access_token tried the network and failed).
declare(strict_types=1);
require dirname(__DIR__) . '/dropin/php-cbk/cbk.php';
[$_, $file, $env, $clientId] = $argv;
$base = $argv[4] ?? 'http://127.0.0.1:1';
$cfg = ['env' => $env, 'test_base' => $base, 'production_base' => 'http://127.0.0.2:1',
        'client_id' => $clientId, 'client_secret' => 's', 'encrp_key' => 'k', 'token_cache_file' => $file];
try { echo cbk_get_access_token($cfg); } catch (Throwable $e) { echo isset($argv[4]) ? 'ERR ' . $e->getMessage() : 'NEW'; }
