<?php
/**
 * The driver's page — 2026-10-04 ("create live tracking order": driver on a map).
 *
 *   GET  /api/driver.php?o=<track_id>&t=<sig>          a phone page: "Share my location" / stop
 *   POST /api/driver.php?o=<track_id>&t=<sig>  {lat,lng,acc}   one position; {stop:1} removes it
 *
 * THE LINK IS THE KEY. /backends mints it per order (admin.php?r=driver_link): an HMAC of the order
 * number keyed on cron_key, the same shape as the review link. Whoever holds it can report a position
 * for THAT order and nothing else — it reads no order data, cannot change a status, and stops working
 * the moment the order is delivered or cancelled (the position row is deleted then too). The driver
 * needs no account: the owner sends them the link on WhatsApp.
 *
 * Positions are kept ONE PER ORDER, overwritten each time, and /track shows one only while the order is
 * 'shipped' and the position is under 30 minutes old (api.php ?r=status). Nothing is logged: this is a
 * "where is the van now", not a route history.
 *
 * NO INLINE SCRIPT: the shop's CSP names its inline scripts by hash, so the page's logic is
 * assets/driver.js. Throttled per IP like every other unauthenticated write.
 */
declare(strict_types=1);
require __DIR__ . '/store.php';

$track = trim((string) ($_GET['o'] ?? ''));
$sig   = (string) ($_GET['t'] ?? '');
$ok    = preg_match('/^[A-Za-z0-9]{6,30}$/', $track) && store_sig_ok(store_driver_sig($track), $sig);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    if (!$ok) store_out(['error' => 'bad_link'], 403);
    $db = store_db();
    store_throttle($db, 'driver', 40, 60);
    $q = $db->prepare('select id, fulfilment_status from orders where track_id = ?');
    $q->execute([$track]);
    $o = $q->fetch();
    if (!$o) store_out(['error' => 'order_not_found'], 404);
    if (!in_array($o['fulfilment_status'], ['packed', 'shipped'], true)) {
        // Delivered or cancelled: the link is spent. Any leftover position goes with it.
        $db->prepare('delete from order_location where order_id = ?')->execute([(int) $o['id']]);
        store_out(['error' => 'order_closed', 'status' => $o['fulfilment_status']], 410);
    }
    $in = json_decode((string) file_get_contents('php://input'), true) ?: [];
    if (!empty($in['stop'])) {
        $db->prepare('delete from order_location where order_id = ?')->execute([(int) $o['id']]);
        store_out(['ok' => true, 'sharing' => false]);
    }
    $lat = (float) ($in['lat'] ?? 0); $lng = (float) ($in['lng'] ?? 0);
    if (!is_finite($lat) || !is_finite($lng) || abs($lat) > 90 || abs($lng) > 180 || ($lat == 0 && $lng == 0)) {
        store_out(['error' => 'bad_position'], 400);
    }
    $acc = isset($in['acc']) && is_numeric($in['acc']) ? max(0, min(100000, (int) $in['acc'])) : null;
    $db->prepare('insert into order_location (order_id, lat, lng, accuracy_m) values (?, ?, ?, ?)
                  on duplicate key update lat = values(lat), lng = values(lng), accuracy_m = values(accuracy_m), updated_at = current_timestamp')
       ->execute([(int) $o['id'], round($lat, 6), round($lng, 6), $acc]);
    store_out(['ok' => true, 'sharing' => true, 'status' => $o['fulfilment_status']]);
}

// ---- GET: the page. No order data on it beyond the order number the link already carries.
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
$e = fn (string $s): string => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
?>
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>سبورتا — مشاركة موقع التوصيل</title>
<link rel="icon" href="/favicon.ico">
<link rel="stylesheet" href="/assets/sporta-ui.css">
<link rel="stylesheet" href="/assets/driver.css">
</head>
<body class="drv" data-track="<?= $e($track) ?>" data-valid="<?= $ok ? '1' : '0' ?>">
<main class="drv-main">
  <img class="drv-logo" src="/logo-white.png" alt="Sporta" width="140" height="40">
  <h1 class="drv-title" data-i18n="title">مشاركة موقع التوصيل</h1>
  <p class="drv-order"><span data-i18n="order">الطلب</span> <b dir="ltr"><?= $e($track) ?></b></p>
  <?php if (!$ok): ?>
  <p class="drv-bad" data-i18n="bad">هذا الرابط غير صالح. اطلب رابطًا جديدًا من المتجر.</p>
  <?php else: ?>
  <p class="drv-help" data-i18n="help">اضغط «ابدأ المشاركة» واترك هذه الصفحة مفتوحة أثناء التوصيل. يرى العميل موقعك على الخريطة فقط ما دام الطلب في الطريق.</p>
  <button class="drv-btn drv-start" type="button" data-i18n="start">ابدأ المشاركة</button>
  <button class="drv-btn drv-stop" type="button" hidden data-i18n="stop">إيقاف المشاركة</button>
  <p class="drv-status" aria-live="polite"></p>
  <button class="drv-lang" type="button">English</button>
  <?php endif; ?>
</main>
<script src="/assets/driver.js" defer></script>
</body>
</html>
