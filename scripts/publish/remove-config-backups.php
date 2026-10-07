<?php
/**
 * Delete the dated backups fix-gateway-db.php left beside pay/config.php and knet/config.php (2026-10-07, owner's choice:
 * "Delete the two old config backups"). They hold the old, now unused, database password.
 *
 *   wget -qO b.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/publish/remove-config-backups.php && php b.php
 *
 * Touches ONLY files named exactly config.php.bak-YYYYmmdd-HHMMSS in pay/ and knet/. The live config.php files are not
 * opened for writing, and the script refuses to run if either is missing. Prints STATE (counts), never a value.
 */
$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
foreach (['pay', 'knet'] as $d) {
    if (!is_file("$ROOT/$d/config.php")) { echo "REFUSED $d/config.php is missing — nothing deleted\n"; return; }
}
$gone = 0; $left = 0;
foreach (['pay', 'knet'] as $d) {
    foreach (glob("$ROOT/$d/config.php.bak-*") ?: [] as $f) {
        if (!preg_match('/\/config\.php\.bak-\d{8}-\d{6}$/', $f) || !is_file($f) || is_link($f)) { $left++; continue; }
        if (@unlink($f)) $gone++; else $left++;
    }
}
$remain = count(glob("$ROOT/pay/config.php.bak-*") ?: []) + count(glob("$ROOT/knet/config.php.bak-*") ?: []);
echo "STATE backupsRemaining=$remain deletedThisRun=$gone notDeleted=$left liveConfigs=" . (is_file("$ROOT/pay/config.php") && is_file("$ROOT/knet/config.php") ? 'both-present' : 'MISSING') . "\n";
