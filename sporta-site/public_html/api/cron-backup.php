<?php
// A DAILY BACKUP OF THE SHOP'S DATA, written OUTSIDE the web root — 2026-10-04 ("hardening & backups").
//
// Wire it in hPanel -> Advanced -> Cron Jobs, once a day (the loopback form every other job uses):
//   wget -nv -O- --no-check-certificate --header=Host:www.sporta.com.kw "https://127.0.0.1/api/cron-backup.php?key=<cron_key>"
//
// WHAT IT WRITES: the same JSON that /backends -> Settings -> Backup downloads (backup_build() in
// admin.php: catalogue, orders, customers, reviews, discounts, slides, settings, admin accounts with the
// second-factor secret DROPPED, taught answers — and NEVER config.php, the KNET/CBK credentials or the
// Wallet certificate, which are not database rows), gzipped, to
//   /home/<account>/backups/sporta-YYYY-MM-DD.json.gz        (0600, in a 0700 directory)
// and keeps the newest 14. Restoring one is the Backup card's "Restore" with the file un-gzipped.
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

require_once __DIR__ . '/backup-build.php';   // the same builder the Backup card uses
$db = store_db();
$data = backup_build($db);
$json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if ($json === false) store_fail('backup_encode_failed', 500);

$name = 'sporta-' . gmdate('Y-m-d') . '.json.gz';
$path = "$dir/$name";
$old = umask(0077);
$ok = @file_put_contents("$path.tmp", (string) gzencode($json, 6)) !== false && @rename("$path.tmp", $path);
umask($old);
if (!$ok) { @unlink("$path.tmp"); store_fail('backup_write_failed', 500); }
@chmod($path, 0600);

// Retention: newest $keep by name (the date is in the name), the rest removed.
$files = glob("$dir/sporta-*.json.gz") ?: [];
rsort($files, SORT_STRING);
$removed = 0;
foreach (array_slice($files, $keep) as $f) { if (@unlink($f)) $removed++; }
$files = array_slice($files, 0, $keep);

$tables = 0; $rows = 0;
foreach ($data['tables'] ?? [] as $t => $r) { $tables++; $rows += is_array($r) ? count($r) : 0; }
store_out([
    'ok' => true, 'file' => $name, 'bytes' => filesize($path), 'tables' => $tables, 'rows' => $rows,
    'kept' => count($files), 'removed' => $removed, 'newest' => basename($files[0] ?? ''), 'dir' => '~/' . basename($dir),
]);
