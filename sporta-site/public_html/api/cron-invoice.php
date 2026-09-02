<?php
// Write the PDF invoice for every order that has not got one.
//
// Wire it in hPanel -> Advanced -> Cron Jobs, every 15 minutes:
//   wget -qO- "https://www.sporta.com.kw/api/cron-invoice.php?key=<cron_key>"
//
// WHY A SWEEP AND NOT A HOOK AT CHECKOUT
//
// The obvious place to write the invoice is the moment the order is placed.
// It is also the worst place. Building a PDF means reading a 62 KB font,
// parsing its tables and compressing it into the file — tens of milliseconds
// that a customer would wait for, in the one request where waiting costs a
// sale, and in exchange for a file nobody will look at for hours.
//
// Worse, it puts a new way to fail inside order creation. An unwritable
// directory, a moved font, a malformed name — any of them would throw where
// the shop is taking money, and the customer would see the order fail for a
// document that has nothing to do with whether they bought anything.
//
// So the invoice is written afterwards, by a sweep that asks one question:
// which orders have no file? That makes it SELF-HEALING in a way a hook is
// not. A failed write is retried on the next run rather than lost. Orders
// placed before this existed get invoices on the first run. If the folder is
// ever emptied, the next run rebuilds every file in it. There is no queue to
// drain, no outbox table to keep in step with the orders table, and no state
// that can disagree with the truth — the truth is simply whether the file is
// on disk.
//
// WHAT IT WILL NOT DO
//
// It does not rewrite a file that already exists. An invoice is a record of
// what a customer was charged on a day, and regenerating it silently after a
// price change or a name correction would rewrite history and present it as
// the original. If a document genuinely has to be reissued, delete the file
// and let the sweep build it again — a deliberate act, by a person, that
// leaves the decision where it belongs.
//
// It also stops after a bounded number per run, for the same reason
// acc_post_unposted does: a call that writes nine hundred files and returns
// one number is a call nobody can check, and this runs behind a web request
// with a time limit.
declare(strict_types=1);
require __DIR__ . '/store.php';
require __DIR__ . '/invoice-pdf.php';

$cfg = store_config();
if (($cfg['cron_key'] ?? '') === '' || !hash_equals($cfg['cron_key'], (string)($_GET['key'] ?? ''))) {
    store_fail('forbidden', 403);
}

$db = store_db();

// Newest first: the invoice somebody asks for is almost always a recent one,
// so a run that is cut short has still done the useful half.
$limit = max(1, min(500, (int)($_GET['limit'] ?? 200)));
$rows = $db->query('select track_id from orders order by id desc limit 2000')->fetchAll();

$made = [];
$failed = [];
$already = 0;

foreach ($rows as $row) {
    $track = (string) $row['track_id'];
    $path = invoice_path($cfg, $track);
    if ($path === null) { $failed[] = ['track' => $track, 'why' => 'bad_track_id']; continue; }
    if (is_file($path)) { $already++; continue; }
    if (count($made) >= $limit) break;

    try {
        $out = invoice_pdf_save($db, $cfg, $track);
        if ($out === null) $failed[] = ['track' => $track, 'why' => 'could_not_write'];
        else $made[] = ['track' => $track, 'bytes' => filesize($out)];
    } catch (Throwable $e) {
        // One bad order must not stop the rest, and the reason goes to the log
        // rather than the response — see acc_post_unposted in admin.php for
        // why a driver's own text does not belong in an answer.
        error_log('cron-invoice ' . $track . ': ' . $e->getMessage());
        $failed[] = ['track' => $track, 'why' => 'error'];
    }
}

store_out([
    'written'   => count($made),
    'already'   => $already,
    'failed'    => $failed,
    'directory' => invoice_dir($cfg),
    'orders'    => count($rows),
]);
