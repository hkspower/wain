<?php
// Put back the garments held by orders that were never paid for.
//
// On the VPS, run with PHP CLI and --release from a host scheduler every
// 15 minutes. --check is read-only; HTTP schedules remain keyed by cron_key.
//
// WHY THIS HAS TO EXIST AT ALL
//
// Stock is claimed at CHECKOUT, before the bank has been contacted, because
// that is where the race lives: the instant two customers can both be told yes
// for one last jacket. Deciding later — at the callback — means both are told
// yes and one is disappointed by an email.
//
// The price of claiming early is that an order nobody completes holds the
// garment. A customer who reaches KNET and closes the tab leaves two pieces
// reserved for a shop that has them on the shelf. Without this sweeper a
// fortnight of abandoned redirects empties the catalogue while the rails are
// full, and the only symptom is sales quietly not happening.
//
// WHAT IT WILL NOT TOUCH, and this is the part worth reading twice:
//
//   * 'paid' and 'review' orders. Obvious, and stated so nobody adds them.
//   * A 'cod' order the shop has touched, at any age. Every order in this
//     shop starts life as payment_status='pending', cash on delivery
//     included — a pending COD order may be a real sale waiting for a
//     driver, and restocking garments that are on their way to a customer
//     would sell them twice. So a COD order is ONLY ever expired while it is
//     still 'pending' AND still 'unfulfilled' (never packed, shipped or
//     delivered) cod_hold_hours after it was placed — 24 by default, the
//     owner's decision of 2026-11-02, 0 to switch it off. Such an order is
//     CANCELLED and its stock put back in one transaction (see
//     store_stock_release), so it cannot later be shipped from a shelf it no
//     longer holds. Mark a real cash order 'packed' in /backends within the
//     hold and it is never touched.
//   * Orders placed before stock reservation existed. They never took stock,
//     so putting it back would invent inventory. stock_claimed = 0 on every
//     one of them, permanently, by construction.
//   * Anything already released. stock_released is the idempotence guard, so a
//     retried run and a callback cannot both restock one order.
//
// ?do= on its own reports what WOULD be released and changes nothing.

declare(strict_types=1);
require __DIR__ . '/store.php';
require_once __DIR__ . '/cron-auth.php';

$cfg = store_config();
if (!sporta_cron_authorized($cfg, PHP_SAPI, $_GET, $GLOBALS['argv'] ?? [], ['--check', '--release'])) {
    store_fail('forbidden', 403);
}

// How long a card customer has to come back from the bank. Generous on
// purpose: the cost of waiting is a garment reserved a little longer, and the
// cost of being hasty is releasing stock under someone who is still typing
// their OTP — and then overselling it to the next visitor.
$minutes = max(15, (int)($cfg['stock_hold_minutes'] ?? 120));
// Cash on delivery: see the header. One reader, shared with the release.
$codHours = store_cod_hold_hours();
$db = store_db();
$dry = PHP_SAPI === 'cli'
    ? (($GLOBALS['argv'][1] ?? '') !== '--release')
    : (($_GET['do'] ?? '') !== 'release');

// The states that mean "this order is not happening":
//   failed      the bank declined or the customer cancelled at the gateway
//   cancelled   the shop cancelled it in /backends
//   pending + card + old   the customer never came back
//   pending + cod + unfulfilled + older than cod_hold_hours   never confirmed
// The last one is listed whether or not it claimed stock: an accessories-only
// cash order holds no garments, but it still holds one of the phone's
// STORE_COD_OPEN_MAX slots, and it is cancelled all the same.
//
// A HINT, NOT THE RULE. store_stock_release() re-reads the row under a lock
// and decides again; this query only finds the rows worth asking about, so
// the two must describe the same states but cannot make each other wrong.
// AND an order that is not happening and still holds DISCOUNT USES, whether or
// not it claimed stock — an accessories-only order that failed used a code all
// the same (store_discount_release). Only once discount-release.mysql.sql is
// imported: before that there is no record of what an order claimed.
$discountClause = store_column_exists($db, 'orders', 'discount_ids')
    ? "or ( discount_ids is not null and discount_released = 0
            and payment_status not in ('paid','review')
            and (payment_status = 'failed' or fulfilment_status = 'cancelled') )"
    : '';
$sql =
  "select id, track_id, payment_status, payment_method, fulfilment_status, created_at
     from orders
    where ( stock_claimed = 1 and stock_released = 0
            and payment_status not in ('paid','review')
            and ( payment_status = 'failed'
               or fulfilment_status = 'cancelled'
               or (payment_status = 'pending'
                   and payment_method in ('knet','tpay')
                   and created_at < (now() - interval ? minute)) ) )
       or ( ? > 0
            and payment_method = 'cod'
            and payment_status = 'pending'
            and fulfilment_status = 'unfulfilled'
            and created_at < (now() - interval ? hour) )
       {$discountClause}
    order by id
    limit 500";
$q = $db->prepare($sql);
$q->execute([$minutes, $codHours, max(1, $codHours)]);
$rows = $q->fetchAll();

$done = [];
$codCancelled = [];
foreach ($rows as $r) {
    // store_stock_release() is guarded and transactional; it returns false if
    // something else got there first, which is the answer this loop wants.
    if (!$dry && store_stock_release($db, (int)$r['id'], $minutes)) {
        $done[] = $r['track_id'];
        if ($r['payment_method'] === 'cod' && $r['fulfilment_status'] === 'unfulfilled') {
            $codCancelled[] = $r['track_id'];
        }
    }
}

store_out([
    'hold_minutes'     => $minutes,
    'cod_hold_hours'   => $codHours,
    'candidates'       => count($rows),
    'released'         => $dry ? 0 : count($done),
    // The cash orders this run CANCELLED (a subset of track_ids). Named on
    // their own because cancelling is more than putting stock back: the
    // owner may want to call those customers.
    'cod_cancelled'    => $dry ? [] : $codCancelled,
    'track_ids'        => $dry ? array_column($rows, 'track_id') : $done,
    'dry_run'          => $dry,
    'note'             => $dry ? 'add &do=release to actually put the stock back' : null,
]);
