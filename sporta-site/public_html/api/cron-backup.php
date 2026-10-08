<?php
// A DAILY BACKUP OF THE SHOP'S DATA, written OUTSIDE the web root — 2026-10-04 ("hardening & backups").
//
// Wire it in hPanel -> Advanced -> Cron Jobs, once a day (the loopback form every other job uses):
//   wget -nv -O- --no-check-certificate --header=Host:www.sporta.com.kw "https://127.0.0.1/api/cron-backup.php?key=<cron_key>"
//
// WHAT IT WRITES: the same JSON that /backends -> Settings -> Backup downloads (backup_write() in
// backup-build.php: every table in BACKUP_TABLES — the catalogue and its colours, search text, size
// charts and stock history; slides, banner, category pictures, logo, share picture, settings and taught
// answers; customers, notes, orders, reviews, discounts and returns; the books; suppliers and purchase
// orders; admin accounts with the second factor DROPPED — and NEVER config.php or the Wallet
// certificate, which are files, nor the payment secrets the Payments screen keeps in settings, which
// are nulled), gzipped, to
//   /home/<account>/backups/sporta-YYYY-MM-DD.json.gz        (0600, in a 0700 directory)
// and keeps the newest 14. Restoring one is the Backup card's "Restore" with the file un-gzipped.
//
// STREAMED, ROW BY ROW, STRAIGHT INTO THE GZIP FILE. It used to build the whole shop as one PHP array
// and json_encode() it — every product photograph and category picture held two or three times over
// in memory on shared hosting. Now the peak is one row.
//
// WHY A FILE AND NOT AN EMAIL: the backup holds every customer's name and address; mail is copied to
// servers the shop does not control. A file under the home directory is readable by this account only.
//
// Same gate as every cron here: the cron_key, compared in constant time; no key, no run. It prints its
// STATE (how many backups exist, the newest, the bytes written), and never a row.
declare(strict_types=1);
require __DIR__ . '/store.php';
$cfg = store_config();
if (($cfg['cron_key'] ?? '') === '' || !hash_equals((string) $cfg['cron_key'], (string) ($_GET['key'] ?? ''))) {
    store_fail('forbidden', 403);
}
$dir = rtrim((string) ($cfg['backup_dir'] ?? ''), '/');
if ($dir === '') $dir = dirname(__DIR__, 3) . '/backups';   // public_html/api -> public_html -> domain -> home
$keep = max(3, min(60, (int) ($cfg['backup_keep'] ?? 14)));

if (!is_dir($dir) && !@mkdir($dir, 0700, true)) store_fail('backup_dir_not_writable', 500);
@chmod($dir, 0700);
if (!is_writable($dir)) store_fail('backup_dir_not_writable', 500);

require_once __DIR__ . '/backup-build.php';   // the same writer the Backup card uses
$db = store_db();

$name = 'sporta-' . gmdate('Y-m-d') . '.json.gz';
$path = "$dir/$name";
$old = umask(0077);   // the temp file is 0600 from its first byte, not after a chmod
$gz = @gzopen("$path.tmp", 'wb6');
$counts = null;
try {
    if ($gz === false) throw new RuntimeException('gzopen failed');
    $counts = backup_write($db, function (string $s) use ($gz) {
        if (gzwrite($gz, $s) === false) throw new RuntimeException('gzwrite failed');
    });
    $closed = gzclose($gz);
    $gz = false;
    $ok = $closed && @rename("$path.tmp", $path);
} catch (Throwable $e) {
    error_log('cron-backup: ' . $e->getMessage());
    $ok = false;
}
if ($gz !== false) @gzclose($gz);
umask($old);
// A half-written file is removed, never left where it would read as today's backup.
if (!$ok) { @unlink("$path.tmp"); store_fail($counts === null ? 'backup_encode_failed' : 'backup_write_failed', 500); }
@chmod($path, 0600);

// Retention: newest $keep by name (the date is in the name), the rest removed.
$files = glob("$dir/sporta-*.json.gz") ?: [];
rsort($files, SORT_STRING);
$removed = 0;
foreach (array_slice($files, $keep) as $f) { if (@unlink($f)) $removed++; }
$files = array_slice($files, 0, $keep);

// `absent` names the tables in BACKUP_TABLES this database does not have yet — a migration not run. Table
// names only; never a row.
store_out([
    'ok' => true, 'file' => $name, 'bytes' => filesize($path), 'tables' => count($counts), 'rows' => array_sum($counts),
    'absent' => array_values(array_diff(BACKUP_TABLES, array_keys($counts))),
    'kept' => count($files), 'removed' => $removed, 'newest' => basename($files[0] ?? ''), 'dir' => '~/' . basename($dir),
]);
