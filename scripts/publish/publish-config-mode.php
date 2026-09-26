<?php
/**
 * Take the three credential files off world-read. Three chmods, and the log.
 *
 * WHAT IS WRONG. `api/config.php` (the database password), `knet/config.php`
 * (the Tranportal password and resource key) and `pay/config.php` (the CBK
 * client secret and encrypted account key) were all measured at **0644** by
 * live-permissions-check.php on 2026-09-17 — world-readable on SHARED
 * HOSTING, where "world" is every other account on the machine. This is the
 * same fault `storage/deploy.secret` was found to have on 2026-09-11, on
 * three files that between them hold every credential this shop has.
 *
 * WHY THIS IS SAFE TO DO WITHOUT ASKING, for the same reason the deploy
 * secret's own fix already gave: chmod 0600 only REMOVES access, and only
 * from everyone except the account PHP runs as — which is the only reader
 * any of these three files has ever needed. There is no configuration in
 * which 0644 works and 0600 does not, and it cannot break a shop that is
 * already reading these files correctly.
 *
 * ROTATION IS A SEPARATE QUESTION, NOT DONE HERE. These files have been
 * world-readable for an unknown length of time; tightening the mode does
 * not un-expose whatever was already read. Whether to rotate the database
 * password, the KNET credentials or the CBK secrets is the owner's call —
 * this script only closes the door, it does not decide whether anything
 * already walked through it.
 *
 * NEVER READS, PRINTS OR WRITES ANY FILE'S CONTENT. Only chmod() and
 * fileperms() are called — the values inside these three files are never
 * touched, so this is safe to publish from a public repository.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$FILES = [
    'api/config.php',
    'knet/config.php',
    'pay/config.php',
];

$report = [];
foreach ($FILES as $rel) {
    $path = $ROOT . '/' . $rel;
    if (!is_file($path)) { $report[] = "$rel=MISSING"; continue; }
    $before = substr(sprintf('%o', fileperms($path)), -4);
    // Only touched if it is not already 0600 — an idempotent script is one
    // that can be run twice by accident (this cron channel's own per-minute
    // retries) without that being a second, unnecessary write.
    if ($before !== '0600') {
        @chmod($path, 0600);
    }
    clearstatcache(true, $path);
    $after = substr(sprintf('%o', fileperms($path)), -4);
    $report[] = "$rel: $before -> $after";
}

// VERIFY THE SHOP STILL WORKS. Tightening a mode the OWNING account reads is
// safe in theory; this confirms it in practice, on the actual site, in the
// same run as the change — a home page that still answers and an admin
// route that still requires its header are the two paths that would break
// first and loudest if PHP could no longer read its own configuration.
$fetch = static function (string $path): array {
    $ch = curl_init('https://127.0.0.1' . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_SSL_VERIFYPEER => false, CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HTTPHEADER => ['Host: www.sporta.com.kw'], CURLOPT_TIMEOUT => 25,
    ]);
    $out = (string) curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, strlen($out)];
};
[$hc, $hn] = $fetch('/');
[$pc, $pn] = $fetch('/api/api.php?r=products');

echo 'CONFIGMODE ' . implode(' | ', $report)
   . ' | home=' . $hc . '/' . $hn
   . ' products=' . $pc . '/' . $pn
   . "\n";
