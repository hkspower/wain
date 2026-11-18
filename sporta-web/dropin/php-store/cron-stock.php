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
// ASK THE BANK FIRST (KNET-IPAYPIPE-CHECK.md D2), OFF unless the KNET config
// says 'inquiry_enabled' => true. See cron_knet_inquiry() below.
$inquiry = cron_knet_inquiry($dry);
foreach ($rows as $r) {
    if ($dry) continue;
    if (cron_knet_inquire_before_release($inquiry, $db, $r)) continue;
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
    // The KNET inquiry: off, or what the bank said about this run's orders.
    'knet_inquiry'     => cron_knet_inquiry_report($inquiry),
    'dry_run'          => $dry,
    'note'             => $dry ? 'add &do=release to actually put the stock back' : null,
]);

// ------------------------------------------------------------ KNET inquiry (D2)
//
// A card customer who pays and closes the tab before KNET's page sends them back
// leaves a CAPTURED payment and a PENDING order. Without this the sweeper gave
// that order's garments away two hours later and nobody was told. With
// 'inquiry_enabled' => true (and 'inquiry_action' set: there is no default) in
// the KNET config, every pending KNET order is asked about at the bank BEFORE
// its stock is released, once per reference it was sent under (attempt 1 to
// pay_attempt). A CAPTURED answer settles it through knet_settle_order, the
// callback's own function (paid on the right amount, review otherwise, nothing
// if already settled); every other answer, and no answer, leaves this file doing
// exactly what it did before. Off, nothing below runs but one config read.
//
// The settlement runs on the KNET connection (knet_pdo, the KNET config's
// database account, which already holds the callback's grants), not on this
// file's, so the sweeper's own account needs no new privilege.

/** @return array{cfg:?array,refused:?string,settled:array,review:array,asked:int,stopped:?string,enabled:bool} */
function cron_knet_inquiry(bool $dry): array {
    $state = ['cfg' => null, 'refused' => null, 'settled' => [], 'review' => [], 'asked' => 0, 'stopped' => null, 'enabled' => false];
    // Deployed beside api/ as knet/; in the repo it is dropin/php-knet.
    $dir = is_dir(dirname(__DIR__) . '/knet') ? dirname(__DIR__) . '/knet' : dirname(__DIR__) . '/php-knet';
    try {
        $path = sporta_config_path('knet', $dir . '/config.php');
        $raw = (is_file($path) && is_readable($path)) ? (require $path) : null;
    } catch (Throwable $e) {
        error_log('Sporta KNET inquiry: the KNET config could not be read (' . get_class($e) . ')');
        return $state;
    }
    if (!is_array($raw) || ($raw['inquiry_enabled'] ?? false) !== true) return $state;
    $state['enabled'] = true;
    if ($dry) return $state;   // a dry run asks nobody anything
    if (!is_file($dir . '/knet.php')) {
        $state['refused'] = 'knet_library_missing';
        error_log('Sporta KNET inquiry refused: knet_library_missing');
        return $state;
    }
    try {
        require_once $dir . '/knet.php';
        $cfg = knet_with_store_db($raw);
        $problem = knet_inquiry_config_problem($cfg);
        if ($problem === null) {
            try { knet_assert_payment_config($cfg); } catch (Throwable $e) { $problem = 'payment_config_invalid'; }
        }
        if ($problem === null && !knet_db_configured($cfg)) $problem = 'orders_database_not_configured';
    } catch (Throwable $e) {
        $problem = 'setup_failed';
        $cfg = $raw;
    }
    if ($problem !== null) {
        // Refused, loudly, and the sweeper carries on as if it were off.
        $state['refused'] = $problem;
        if (function_exists('knet_log')) knet_log($cfg, 'inquiry.refused', ['reason' => $problem]);
        error_log('Sporta KNET inquiry refused: ' . $problem);
        return $state;
    }
    $state['cfg'] = $cfg;
    return $state;
}

// true when the order needs no release any more (the bank's capture made it
// paid); false to carry on with store_stock_release() exactly as before.
function cron_knet_inquire_before_release(array &$inquiry, PDO $db, array $r): bool {
    if ($inquiry['cfg'] === null || $r['payment_method'] !== 'knet' || $r['payment_status'] !== 'pending') return false;
    try {
        // Read here, not in the candidate query, so the sweeper's SQL is the
        // same as before whenever the inquiry is off.
        $q = $db->prepare("select pay_attempt, amount from orders
                            where id = ? and payment_method = 'knet' and payment_status = 'pending'");
        $q->execute([(int)$r['id']]);
        $o = $q->fetch();
        if (!$o || (int)$o['pay_attempt'] < 1) return false;   // never sent to the bank: nothing to ask
        $inquiry['asked']++;
        $res = knet_inquire_order($inquiry['cfg'], (string)$r['track_id'], (int)$o['pay_attempt'], (string)$o['amount']);
    } catch (Throwable $e) {
        error_log('Sporta KNET inquiry failed for order #' . (int)$r['id'] . ' (' . get_class($e) . ')');
        return false;
    }
    if ($res['state'] === 'unreachable' || $res['state'] === 'refused') {
        // The bank is not answering (or cannot be asked): stop asking for this
        // run, so one outage costs one time-out, not one per order.
        $inquiry['stopped'] = (string)$res['reason'];
        $inquiry['cfg'] = null;
        error_log('Sporta KNET inquiry stopped for this run: ' . $res['reason']);
        return false;
    }
    if ($res['state'] === 'paid') {
        $inquiry['settled'][] = (string)$r['track_id'];
        return true;
    }
    // review: store_stock_release() keeps a review order's stock, as it does
    // for one the callback held. failed / not_captured: released as before.
    if ($res['state'] === 'review') $inquiry['review'][] = (string)$r['track_id'];
    return false;
}

function cron_knet_inquiry_report(array $inquiry): array {
    return [
        'enabled'  => $inquiry['enabled'],
        'refused'  => $inquiry['refused'],
        'asked'    => $inquiry['asked'],
        'settled'  => $inquiry['settled'],
        'review'   => $inquiry['review'],
        'stopped'  => $inquiry['stopped'],
    ];
}
