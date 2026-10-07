<?php
/**
 * The customer's own invoice, as a PDF download — 2026-10-07.
 *
 *   /api/invoice-download.php?id=SPXXXXXXXX
 *
 * invoice-file.php is the ADMIN's door (signed-in session). This is the
 * shopper's: the confirmation page offers it right after an order, and the
 * order number is the credential, exactly as it is for ?r=status and ?r=invoice
 * (about 64 bits, not guessable). The PDF carries the same facts ?r=invoice
 * already returns to that bearer — the customer's name and address, no phone.
 *
 * It draws the PDF fresh on every request (invoice_pdf_save), so a shopper who
 * orders and clicks within a minute is not told to wait for a cron, and the
 * PAID / UNPAID stamp is always today's.
 *
 * Throttled per IP like every other public route, so it cannot be used to make
 * the server draw PDFs in a loop. An unknown order and a font that cannot be
 * found answer the same plain 404: telling them apart would say which order
 * numbers exist.
 */
declare(strict_types=1);
require __DIR__ . '/store.php';
require __DIR__ . '/invoice-pdf.php';

$cfg = store_config();
$db = store_db();
store_throttle($db, 'invoice_dl', 20, 600);

$id = trim((string) ($_GET['id'] ?? ''));
$path = invoice_path($cfg, $id);
if ($path === null) store_fail('bad_id', 400);

// ALWAYS REBUILT, never read from the archive: the PDF prints PAID or UNPAID, and a copy
// the sweep drew before the bank confirmed would still say UNPAID after the shopper paid.
// Saving also refreshes the archive the panel reads.
$made = invoice_pdf_save($db, $cfg, $id);
if ($made === null) store_fail('not_found', 404);
$path = $made;
$bytes = @file_get_contents($path);
if ($bytes === false) store_fail('not_found', 404);

header('Content-Type: application/pdf');
header('Content-Disposition: attachment; filename="' . basename($path) . '"');
header('Content-Length: ' . strlen($bytes));
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex');
header('Cache-Control: private, no-store');
echo $bytes;
