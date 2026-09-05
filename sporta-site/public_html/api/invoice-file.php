<?php
/**
 * Hand over one archived invoice PDF, to somebody who has signed in.
 *
 *   /api/invoice-file.php?id=SPXXXXXXXX        the file
 *   /api/invoice-file.php                      what is in the archive
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE HAS TO EXIST AT ALL
 *
 * The invoices are written OUTSIDE the web root — beside public_html, not in
 * it — so Apache cannot serve them and no URL reaches them. That is the whole
 * answer to the objection orders-print.php raises against keeping a folder of
 * them: a directory holding every customer's name and address, sitting where a
 * guessed filename is enough, is a leak waiting for somebody to notice. There
 * is no filename to guess here because there is no path that maps to the
 * folder.
 *
 * The cost of that is that something has to read the file and pass it on, and
 * this is that something. It is the only route to those bytes, and it opens
 * with a session check.
 *
 * ---------------------------------------------------------------------------
 * THE GATE
 *
 * store_session_admin(), for the reason orders-print.php gives beside the same
 * call: a download is a plain navigation — a typed URL or a clicked link — and
 * a navigation cannot carry the X-Sporta-Admin header that store_require_admin
 * insists on. The session cookie is SameSite=Strict and this file only reads,
 * so the header would buy nothing it does not already have.
 *
 * ---------------------------------------------------------------------------
 * THE PATH IS NEVER TAKEN FROM THE REQUEST
 *
 * The id is stripped to letters and digits by invoice_path() and joined to a
 * directory this file chooses. Nothing the caller sends can climb out of it:
 * "../../public_html/index.php" strips to a name with no slashes in it, which
 * resolves to a file that does not exist. The check is done in one place, in
 * invoice-pdf.php, so this file and the sweep cannot disagree about it.
 */
declare(strict_types=1);
require __DIR__ . '/store.php';
require __DIR__ . '/invoice-pdf.php';

$who = store_session_admin();
if ($who === null) {
    http_response_code(401);
    header('Content-Type: text/html; charset=utf-8');
    exit('<!doctype html><meta charset="utf-8"><p style="font:16px system-ui;padding:2rem">'
        . 'Sign in to the panel first, then open this page again.</p>');
}

$cfg = store_config();
$id = trim((string) ($_GET['id'] ?? ''));

// --- no id: say what is in the archive --------------------------------------
//
// A listing rather than a download, because the first question anybody has is
// "is the invoice for this order there", and the honest answer is on disk.
if ($id === '') {
    $dir = invoice_dir($cfg);
    $files = is_dir($dir) ? (glob($dir . '/*.pdf') ?: []) : [];
    $out = [];
    foreach ($files as $f) {
        $out[] = [
            'track' => basename($f, '.pdf'),
            'bytes' => filesize($f) ?: 0,
            'at'    => gmdate('c', filemtime($f) ?: 0),
        ];
    }
    usort($out, fn ($a, $b) => strcmp($b['at'], $a['at']));
    store_out(['directory' => $dir, 'count' => count($out), 'invoices' => $out]);
}

$path = invoice_path($cfg, $id);
if ($path === null) store_fail('bad_id', 400);

// BUILT ON DEMAND IF THE SWEEP HAS NOT REACHED IT. An admin looking for an
// invoice that was placed two minutes ago should not be told to wait for a
// cron; and having one code path that always answers is worth more than the
// few milliseconds it costs when the file is missing.
if (!is_file($path)) {
    $made = invoice_pdf_save(store_db(), $cfg, $id);
    if ($made === null) store_fail('not_found', 404);
    $path = $made;
}

$bytes = @file_get_contents($path);
if ($bytes === false) store_fail('not_found', 404);

header('Content-Type: application/pdf');
// INLINE, not attachment: an admin checking an order wants to look at it, and
// a browser's PDF viewer is a better place to do that than the downloads
// folder. The filename is still set, so saving it gives a sensible name.
header('Content-Disposition: inline; filename="' . basename($path) . '"');
header('Content-Length: ' . strlen($bytes));
header('X-Content-Type-Options: nosniff');
// Never cached by anything in between: this is a customer's name and address.
header('Cache-Control: private, no-store');
echo $bytes;
