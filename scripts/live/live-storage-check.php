<?php
/**
 * What is actually using space on the live server.
 *
 *   php /home/<user>/live-storage-check.php
 *
 * READ-ONLY. It measures and prints sizes. It deletes nothing, writes nothing,
 * and prints no configuration VALUE — the same rule live-cron-check.php
 * follows, and for the same reason: it is fetched over plain HTTP from a public
 * repository by a cron job.
 *
 * WHY IT EXISTS. "Storage" had never been measured on this server, only
 * reasoned about. storage-scan.mjs names the things that grow — five outbox
 * tables that keep their sent rows, photographs held as base64 inside MySQL,
 * payment logs opened with FILE_APPEND and never rotated, invoice PDFs written
 * and never deleted — but it runs against the SANDBOX. None of those numbers
 * are the live shop's, and a figure from the sandbox says nothing about
 * production: 608 seed orders there against 0 here.
 *
 * NOT EVERYTHING THAT GROWS IS A FAULT. Invoice PDFs are financial records and
 * are supposed to accumulate; the rate_limit table sweeps itself twice over.
 * This reports sizes and leaves the judging to whoever reads it, because the
 * useful output is a number, not a verdict.
 *
 * ONE LINE, because cron returns only the last one.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
$HOME = '/home/u130124229';

/** Bytes under a directory, and how many files. Depth-limited: this runs on a
 *  payment server and a runaway walk is a real cost, not a hypothetical. */
function dir_size(string $dir, int $maxFiles = 20000): array {
    if (!is_dir($dir)) return [0, 0];
    $bytes = 0; $files = 0;
    try {
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($it as $f) {
            if (!$f->isFile()) continue;
            $bytes += $f->getSize();
            if (++$files >= $maxFiles) break;
        }
    } catch (Throwable $e) { /* unreadable subtree: report what was counted */ }
    return [$bytes, $files];
}

$mb = static fn (int $b): string => number_format($b / 1048576, 1);

[$rootB, $rootN] = dir_size($ROOT);
[$homeB, $homeN] = dir_size($HOME);

// The two on-disk stores that only ever grow, named in storage-scan.mjs.
$cfg = @include $ROOT . '/api/config.php';
$invDir = is_array($cfg) ? trim((string) ($cfg['invoice_dir'] ?? '')) : '';
if ($invDir === '') $invDir = dirname($ROOT) . '/invoices';
[$invB, $invN] = dir_size($invDir);

$ttsDir = is_array($cfg) ? trim((string) ($cfg['tts_cache_dir'] ?? '')) : '';
if ($ttsDir === '') $ttsDir = sys_get_temp_dir() . '/sporta-voice';
[$ttsB, $ttsN] = dir_size($ttsDir);

// The database, and the tables that keep their rows on purpose.
$dbLine = 'db=?';
if (is_array($cfg)) {
    try {
        $db = new PDO(
            'mysql:host=' . $cfg['db_host'] . ';dbname=' . $cfg['db_name'] . ';charset=utf8mb4',
            (string) $cfg['db_user'], (string) $cfg['db_pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        $q = $db->prepare(
            'select round(sum(data_length + index_length) / 1048576, 1) mb, count(*) t
               from information_schema.tables where table_schema = ?'
        );
        $q->execute([$cfg['db_name']]);
        $tot = $q->fetch();

        // The biggest three, named. A total alone does not say what to look at.
        $top = $db->prepare(
            'select table_name n, round((data_length + index_length) / 1048576, 1) mb, table_rows r
               from information_schema.tables where table_schema = ?
              order by (data_length + index_length) desc limit 3'
        );
        $top->execute([$cfg['db_name']]);
        $bits = [];
        foreach ($top->fetchAll() as $t) $bits[] = $t['n'] . ':' . $t['mb'] . 'MB/' . (int) $t['r'] . 'r';

        $rl = (int) $db->query('select count(*) from rate_limit')->fetchColumn();

        $dbLine = 'db=' . $tot['mb'] . 'MB/' . (int) $tot['t'] . 'tables'
                . ' top=' . implode(',', $bits)
                . ' rateLimitRows=' . $rl;
    } catch (Throwable $e) {
        $dbLine = 'db=unreadable';
    }
}

echo 'STORAGE docroot=' . $mb($rootB) . 'MB/' . $rootN . 'f'
   . ' home=' . $mb($homeB) . 'MB/' . $homeN . 'f'
   . ' invoices=' . $mb($invB) . 'MB/' . $invN . 'f'
   . ' voiceCache=' . $mb($ttsB) . 'MB/' . $ttsN . 'f'
   . ' ' . $dbLine . "\n";
