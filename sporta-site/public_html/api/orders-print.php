<?php
/**
 * Every order, as a document you can print or save as one PDF.
 *
 *   /api/orders-print.php                     the last 30 days
 *   /api/orders-print.php?from=2026-01-01&to=2026-08-31
 *   /api/orders-print.php?id=SPXXXXXXXXXX     one order
 *   /api/orders-print.php?status=paid         only paid ones
 *
 * Then File -> Print -> Save as PDF. Each order starts on its own page, so the
 * result is one PDF containing every order, and any single page can be printed
 * on its own.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BROWSER MAKES THIS PDF, AND WHERE THE OTHER ONE COMES FROM
 *
 * THIS FILE IS THE MONTH, NOT THE ORDER. It exists to put a date range in
 * front of somebody — a stack to print, a batch to file, one PDF holding
 * everything between two dates. The browser is the right tool for that: the
 * owner picks the paper, and gets one file rather than four hundred.
 *
 * A SINGLE ORDER'S INVOICE IS NOW WRITTEN BY THE SERVER — see invoice-pdf.php,
 * with cron-invoice.php sweeping for orders that have none and
 * invoice-file.php handing one over. This header used to say that could not be
 * done honestly. It gave two reasons, and both were true when they were
 * written:
 *
 *   "A PDF has no concept of right-to-left, no Arabic letter shaping, and no
 *   font unless you embed one." All still true — a PDF draws glyphs in the
 *   order given and has no opinion about language. What changed is that
 *   arabic.php now does the shaping and the ordering before the text reaches
 *   the page, and pdf.php embeds the shop's own font so the glyphs exist to
 *   draw. Verified by rendering the output and reading it, not by reasoning
 *   about it.
 *
 *   "A directory of PDFs is every customer's name and address behind a
 *   guessable filename." Also still true, which is why that folder is NOT in
 *   the web root. It sits beside public_html, so no URL resolves to it and
 *   there is no filename to guess; the only route to those bytes is
 *   invoice-file.php, which opens with a session check.
 *
 * Both files are wanted. Neither replaces the other.
 *
 * ---------------------------------------------------------------------------
 * THE GATE
 *
 * store_session_admin(), NOT store_require_admin(). The difference matters and
 * is not a weakening: the second also demands the X-Sporta-Admin header, which
 * exists because the React panel sends it and nothing else has a reason to.
 * This page is opened by typing a URL or following a link — a real navigation,
 * which cannot carry a custom header. The session cookie is SameSite=Strict
 * and this page only reads, so the header buys nothing here.
 */
declare(strict_types=1);
require __DIR__ . '/store.php';

$who = store_session_admin();
if ($who === null) {
    http_response_code(401);
    header('Content-Type: text/html; charset=utf-8');
    exit('<!doctype html><meta charset="utf-8"><p style="font:16px system-ui;padding:2rem">'
       . 'Sign in to <a href="/backends">the panel</a> first, then open this page again.</p>');
}

// Order state carries names, telephone numbers and addresses. No cache, no
// index, ever — the same headers the payment endpoints carry.
//
// PHP's session handler already sends no-store/no-cache/must-revalidate once
// session_start() has run, so most of this line is belt over braces. It stays
// written out for the reason pay/cbk.php gives beside its TLS options: a
// default is invisible, and `private` is genuinely added here — a shared proxy
// must not hold a page of customers' home addresses even for a moment.
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, private');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');

$db = store_db();

$id     = trim((string) ($_GET['id'] ?? ''));
$status = (string) ($_GET['status'] ?? '');
$from   = (string) ($_GET['from'] ?? '');
$to     = (string) ($_GET['to'] ?? '');

// A BOUND, ALWAYS. Four hundred invoices in one document is a browser that
// stops responding while it lays out the print preview, and an owner who
// thinks the page is broken. The default window is thirty days; a wider one is
// asked for explicitly and still capped.
const PRINT_MAX = 300;

$sql = 'select * from orders where 1=1';
$args = [];
if ($id !== '') {
    $sql .= ' and track_id = ?';
    $args[] = $id;
} else {
    // Dates are validated rather than trusted: they are concatenated nowhere,
    // but a malformed one silently matching everything is its own bug.
    $ok = static fn (string $d): bool => (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $d);
    $sql .= ' and created_at >= ?';
    $args[] = $ok($from) ? $from . ' 00:00:00' : gmdate('Y-m-d 00:00:00', time() - 30 * 86400);
    if ($ok($to)) { $sql .= ' and created_at <= ?'; $args[] = $to . ' 23:59:59'; }
    if (in_array($status, ['pending', 'paid', 'review', 'failed'], true)) {
        $sql .= ' and payment_status = ?';
        $args[] = $status;
    }
}
$sql .= ' order by created_at desc limit ' . PRINT_MAX;

$q = $db->prepare($sql);
$q->execute($args);
$orders = $q->fetchAll(PDO::FETCH_ASSOC);

// One query for every line, not one per order: three hundred orders would
// otherwise be three hundred and one round trips.
$lines = [];
if ($orders) {
    $ids = array_column($orders, 'id');
    $in = implode(',', array_fill(0, count($ids), '?'));
    $li = $db->prepare("select * from order_items where order_id in ($in) order by id");
    $li->execute($ids);
    foreach ($li->fetchAll(PDO::FETCH_ASSOC) as $row) $lines[(int) $row['order_id']][] = $row;
}

$h = static fn ($v): string => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
$kwd = static fn ($v): string => number_format((float) $v, 3, '.', ',') . ' KWD';
$addr = static function (array $o) use ($h): string {
    $bits = array_filter([
        $o['customer_area'], $o['customer_governorate'],
        $o['customer_block'] ? 'Block ' . $o['customer_block'] : '',
        $o['customer_street'] ? 'Street ' . $o['customer_street'] : '',
        $o['customer_building'] ? 'Building ' . $o['customer_building'] : '',
        $o['customer_floor'] ? 'Floor ' . $o['customer_floor'] : '',
        $o['customer_flat'] ? 'Flat ' . $o['customer_flat'] : '',
    ], static fn ($x) => trim((string) $x) !== '');
    return $h(implode(' · ', $bits));
};
?><!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<title>Sporta — orders</title>
<style>
  /* LTR AND LATIN-LABELLED, deliberately, the same call the admin panel makes
     for itself: this is a sheet of references, telephone numbers, sizes and
     amounts, all of which read left to right even in Arabic. The customer's
     own name and address are printed exactly as they typed them, in whichever
     language that was, and the browser shapes the Arabic correctly because it
     is a browser. */
  @page { size: A4; margin: 12mm; }
  /* THE SHOP'S OWN FACE, like the PDF invoice: Alexandria, Latin and Arabic. Declared here
     rather than relying on the browser's system font so a printed sheet and the archived PDF
     read as the same document. */
  @font-face { font-family: Alexandria; font-weight: 100 900; font-display: swap;
    src: url(/fonts/alexandria-var-latin.woff2) format('woff2');
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2212, U+2215; }
  @font-face { font-family: Alexandria; font-weight: 100 900; font-display: swap;
    src: url(/fonts/alexandria-var-arabic.woff2) format('woff2');
    unicode-range: U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 12px/1.5 Alexandria, system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif;
         color: #14161a; margin: 0; }
  .bar { position: sticky; top: 0; background: #14161a; color: #fff;
         padding: 10px 14px; display: flex; gap: 14px; align-items: center; z-index: 5; }
  .bar a, .bar button { color: #ff7b17; background: none; border: 0; font: inherit;
                        cursor: pointer; text-decoration: none; }
  /* The controls are for the screen. A printed sheet with a Print button on it
     is a sheet somebody has to explain. */
  @media print { .bar, .note { display: none } }
  .note { padding: 10px 14px; background: #fff7ed; border-bottom: 1px solid #fed7aa; }
  .order { padding: 0 0 24px; }
  /* EACH ORDER STARTS A NEW SHEET. Without this the PDF is a scroll of
     invoices cut across page boundaries, which cannot be handed to anyone. */
  .order { break-after: page; page-break-after: always; }
  .order:last-child { break-after: auto; page-break-after: auto; }
  /* the masthead: near-black with the orange rule under it, as on the PDF invoice */
  h1 { font-size: 22px; font-weight: 800; letter-spacing: .28em; margin: 0 0 16px;
       padding: 22px 20px 20px; background: #14161a; color: #fff;
       border-bottom: 4px solid #f56315; border-radius: 6px 6px 0 0; }
  h2 { font-size: 20px; font-weight: 800; margin: 0 0 12px; display: flex; align-items: center; gap: 12px; }
  .muted { color: #5b6068; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin: 10px 0 16px;
          padding: 14px 16px; background: #f4f5f7; border-radius: 10px; }
  .grid strong { display: block; font-size: 9px; letter-spacing: .12em; text-transform: uppercase;
                 color: #5b6068; font-weight: 700; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 8px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e3e5e9; }
  th { background: #14161a; border-bottom-color: #14161a; color: #fff; font-weight: 700; font-size: 9px;
       letter-spacing: .12em; text-transform: uppercase; }
  tbody tr:nth-child(even) td { background: #f9fafb; }
  td.n, th.n { text-align: right; white-space: nowrap; }
  tfoot td { border: 0 !important; padding-top: 6px; background: none !important; }
  tfoot tr:last-child td { font-weight: 800; font-size: 14px; background: #cf4a0b !important; color: #fff;
                           padding-top: 10px; padding-bottom: 10px; }
  tfoot tr:last-child td:first-child { border-radius: 8px 0 0 8px; }
  tfoot tr:last-child td:last-child { border-radius: 0 8px 8px 0; }
  .tag { display: inline-block; padding: 2px 10px; border-radius: 999px;
         font-size: 10px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
  .paid { background: #16a34a; color: #fff; }
  .pending { background: #fabf24; color: #14161a; }
  .failed, .review { background: #b91c1c; color: #fff; }
  .empty { padding: 3rem 1rem; text-align: center; }
</style>
</head>
<body>

<div class="bar">
  <strong>Sporta — orders</strong>
  <span class="muted"><?= count($orders) ?> order<?= count($orders) === 1 ? '' : 's' ?></span>
  <button onclick="window.print()">Print / Save as PDF</button>
  <a href="/backends/orders">back to the panel</a>
</div>

<?php if (count($orders) >= PRINT_MAX): ?>
  <p class="note">Showing the first <?= PRINT_MAX ?> — narrow the dates with
    <code>?from=YYYY-MM-DD&amp;to=YYYY-MM-DD</code> to reach the rest.</p>
<?php endif; ?>

<?php if (!$orders): ?>
  <p class="empty">No orders in that range.<br>
    <span class="muted">The default is the last 30 days. Try
      <code>?from=2026-01-01</code>.</span></p>
<?php endif; ?>

<?php foreach ($orders as $o): $oid = (int) $o['id']; ?>
  <section class="order">
    <h1>Sporta · سبورتا</h1>
    <h2><?= $h($o['track_id']) ?>
      <span class="tag <?= $h($o['payment_status']) ?>"><?= $h($o['payment_status']) ?></span>
    </h2>

    <div class="grid">
      <div><strong>Placed</strong> <?= $h($o['created_at']) ?></div>
      <div><strong>Payment</strong> <?= $h(strtoupper((string) $o['payment_method'])) ?>
        <?= $o['paid_at'] ? '· paid ' . $h($o['paid_at']) : '' ?></div>
      <div><strong>Customer</strong> <?= $h($o['customer_name']) ?></div>
      <div><strong>Phone</strong> <?= $h($o['customer_phone']) ?></div>
      <div style="grid-column:1/-1"><strong>Address</strong> <?= $addr($o) ?></div>
      <?php if (trim((string) $o['customer_note']) !== ''): ?>
        <div style="grid-column:1/-1"><strong>Note</strong> <?= $h($o['customer_note']) ?></div>
      <?php endif; ?>
      <div><strong>Fulfilment</strong> <?= $h($o['fulfilment_status']) ?></div>
      <?php if ($o['discount_code']): ?>
        <div><strong>Discount</strong> <?= $h($o['discount_code']) ?></div>
      <?php endif; ?>
    </div>

    <table>
      <thead>
        <tr><th>Item</th><th>Size</th><th class="n">Qty</th>
            <th class="n">Unit</th><th class="n">Line</th></tr>
      </thead>
      <tbody>
      <?php foreach ($lines[$oid] ?? [] as $l): ?>
        <tr>
          <td><?= $h($l['name_en'] ?: $l['name_ar']) ?>
            <?php if ($l['name_ar'] && $l['name_en']): ?>
              <div class="muted"><?= $h($l['name_ar']) ?></div>
            <?php endif; ?>
          </td>
          <td><?= $h($l['size'] ?: '—') ?></td>
          <td class="n"><?= (int) $l['qty'] ?></td>
          <td class="n"><?= $kwd($l['unit_price']) ?></td>
          <td class="n"><?= $kwd((float) $l['unit_price'] * (int) $l['qty']) ?></td>
        </tr>
      <?php endforeach; ?>
      <?php if (empty($lines[$oid])): ?>
        <tr><td colspan="5" class="muted">No lines recorded for this order.</td></tr>
      <?php endif; ?>
      </tbody>
      <tfoot>
        <tr><td colspan="4" class="n">Subtotal</td><td class="n"><?= $kwd($o['subtotal']) ?></td></tr>
        <?php if ((float) $o['discount_amount'] > 0): ?>
          <tr><td colspan="4" class="n">Discount<?= $o['discount_label'] ? ' · ' . $h($o['discount_label']) : '' ?></td>
              <td class="n">-<?= $kwd($o['discount_amount']) ?></td></tr>
        <?php endif; ?>
        <tr><td colspan="4" class="n">Delivery</td><td class="n"><?= $kwd($o['delivery_fee']) ?></td></tr>
        <tr><td colspan="4" class="n">Total</td><td class="n"><?= $kwd($o['amount']) ?></td></tr>
      </tfoot>
    </table>
  </section>
<?php endforeach; ?>

</body>
</html>
