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
//   * ANY 'cod' order, at any age. Every order in this shop starts life as
//     payment_status='pending', cash on delivery included — a pending COD
//     order is not an abandoned checkout, it is a real sale waiting for a
//     driver. Sweeping on age alone would restock garments that are on their
//     way to a customer, and the shop would then sell them twice. The
//     payment_method filter is the whole safety of this script.
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
$db = store_db();
$dry = PHP_SAPI === 'cli'
    ? (($GLOBALS['argv'][1] ?? '') !== '--release')
    : (($_GET['do'] ?? '') !== 'release');

// The three states that mean "this order is not happening":
//   failed      the bank declined or the customer cancelled at the gateway
//   cancelled   the shop cancelled it in /backends
//   pending + card + old   the customer never came back
$sql =
  "select id, track_id, payment_status, payment_method, fulfilment_status, created_at
     from orders
    where stock_claimed = 1 and stock_released = 0
      and payment_status not in ('paid','review')
      and ( payment_status = 'failed'
         or fulfilment_status = 'cancelled'
         or (payment_status = 'pending'
             and payment_method in ('knet','tpay')
             and created_at < (now() - interval ? minute)) )
    order by id
    limit 500";
$q = $db->prepare($sql);
$q->execute([$minutes]);
$rows = $q->fetchAll();

$done = [];
foreach ($rows as $r) {
    // store_stock_release() is guarded and transactional; it returns false if
    // something else got there first, which is the answer this loop wants.
    if (!$dry && store_stock_release($db, (int)$r['id'], $minutes)) $done[] = $r['track_id'];
}

store_out([
    'hold_minutes' => $minutes,
    'candidates'   => count($rows),
    'released'     => $dry ? 0 : count($done),
    'track_ids'    => $dry ? array_column($rows, 'track_id') : $done,
    'dry_run'      => $dry,
    'note'         => $dry ? 'add &do=release to actually put the stock back' : null,
]);
