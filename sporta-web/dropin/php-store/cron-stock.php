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
//   * 'paid' orders, and 'review' orders UNLESS a person has cancelled them. A
//     capture parked for review keeps its garments claimed, because the money
//     may be real. Once the owner has settled it at the bank and cancelled the
//     order in /backends, the order is dead like any other cancelled one and
//     its pieces and discount uses go back (they used to be held for ever).
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
// WHAT A CANCELLED COD ORDER ALSO GETS. The cancel is one transaction with a
// 'cancel' row for the warehouse ("CANCELLED — do not ship"), which
// cron-fulfilment.php mails once the picking list has gone. If that row cannot
// be written, the whole release is refused and rolled back, the order is left
// as it was, and it is listed under `failed` in this run's JSON. One failing
// order never stops the others: they are released in the same run.
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
//
// A CARD ORDER THAT CLAIMED NO STOCK is one of those too, once its hold has
// passed: an accessories-only KNET / T-Pay order the shopper abandoned at the
// bank page. It is not in the first clause (stock_claimed = 0) and not failed or
// cancelled, so without its own clause it was never a candidate and
// store_stock_release()'s card-expiry branch (which cancels it and returns the
// uses) could not be reached from here: a single-use or launch code was burned
// for good by every such order. Same states as that branch decides on.
$discountOnly = store_column_exists($db, 'orders', 'discount_ids');
$discountClause = $discountOnly
    ? "or ( discount_ids is not null and discount_released = 0
            and payment_status <> 'paid' and (payment_status <> 'review' or fulfilment_status = 'cancelled')
            and (payment_status = 'failed' or fulfilment_status = 'cancelled') )
       or ( discount_ids is not null and discount_released = 0 and stock_claimed = 0
            and payment_status = 'pending'
            and payment_method in ('knet','tpay')
            and fulfilment_status = 'unfulfilled'
            and created_at < (now() - interval ? minute) )"
    : '';
$sql =
  "select id, track_id, payment_status, payment_method, fulfilment_status, created_at
     from orders
    where ( stock_claimed = 1 and stock_released = 0
            and payment_status <> 'paid' and (payment_status <> 'review' or fulfilment_status = 'cancelled')
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
$q->execute($discountOnly ? [$minutes, $codHours, max(1, $codHours), $minutes] : [$minutes, $codHours, max(1, $codHours)]);
$rows = $q->fetchAll();

$done = [];
$codCancelled = [];
// Orders whose release threw. Reported, never silent: a failure here is the
// sweeper not doing its job for that order, and the owner must see it.
$failed = [];
foreach ($rows as $r) {
    if ($dry) continue;
    // store_stock_release() is guarded and transactional; it returns false if
    // something else got there first, which is the answer this loop wants.
    //
    // A THROW IS CONTAINED TO ITS ORDER. The release is one transaction and
    // store_stock_release() rolls it back before rethrowing, so the order is
    // untouched. Without this catch, the first order that cannot be released
    // (a constraint, a lock timeout) would end the run, and the run after it
    // would stop at the same order, so no order behind it was ever released
    // again. The candidate list is ordered by id, so that is the oldest order
    // in the shop, every run, for ever.
    try {
        if (store_stock_release($db, (int)$r['id'], $minutes)) {
            $done[] = $r['track_id'];
            if ($r['payment_method'] === 'cod' && $r['fulfilment_status'] === 'unfulfilled') {
                $codCancelled[] = $r['track_id'];
            }
        }
    } catch (Throwable $e) {
        // The order id and the exception class only: never a customer's name,
        // phone or address, which an exception message can carry.
        $failed[] = $r['track_id'];
        error_log('Sporta stock release failed for order #' . (int)$r['id'] . ' (' . get_class($e) . ')');
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
    // The orders this run released (or, in a dry run, would release).
    'track_ids'        => $dry ? array_column($rows, 'track_id') : $done,
    // Orders that could not be released this run. Empty when all is well.
    'failed'           => $failed,
    'dry_run'          => $dry,
    'note'             => $dry ? 'add &do=release to actually put the stock back' : null,
]);
