<?php
// Sporta — KNET payment records: what happened to a card payment AFTER the bank
// answered. A library, included by admin.php (the /backends routes below) and by
// api.php (the shopper's receipt); it is never an endpoint of its own.
//
// KNET-K063-CHECK.md, "Match official plug-in" part 2:
//
//   B1/B2/B9  RECORD a refund or a void made in the KPay merchant portal. The
//             shop cannot refund: KPay's Credit and Void are buttons a person
//             presses in the portal (K-063 §4.1, §4.2), and the bank does not
//             tell the shop afterwards. Before this, a refunded order stayed
//             "paid" for ever (revenue, XBRL, and, when not shipped yet, on its
//             way to the customer: a paid order cannot be cancelled).
//   B3        a second CAPTURED payment on one order (php-knet/knet.php writes
//             the payment_alerts row; this file lists, resolves and refunds it).
//   C2        the daily reconciliation export (CSV) the KPay check is run
//             against (KNET.md, "Daily KPay reconciliation").
//   D1/D5     the receipt fields the result page and the invoice show to the
//             order's own shopper.
//
// THE RULES, each enforced here and tested by scripts/knet-refund-test.mjs:
//
//   * KNET orders only, 'paid' or 'review'. A pending order has no money to give
//     back; a failed one was never charged; a refunded or voided one is closed.
//   * The KNET Payment ID is REQUIRED and must be the order's own (the one the
//     callback or a manual settlement stored), or the Payment ID of an open
//     second-capture alert on this order. Anything else is refused: the forcing
//     function is the same as manual settlement's (you cannot type it without
//     having found the transaction in KPay), and it stops a refund of payment A
//     being booked against order B. A review order whose callback carried no
//     Payment ID takes the one typed.
//   * The amount is REQUIRED, in KWD with at most three decimals.
//       - VOID: the whole payment, never part of it, and never after a refund
//         (a voided transaction was never settled, so it cannot also have been
//         credited).
//       - REFUND (KPay "Credit"): the whole payment or a PART of it. Decision
//         (documented in KNET.md): PARTIAL refunds are recorded with their
//         amount. They leave the order 'paid' (the customer keeps the order and
//         the warehouse is not told anything) and only lower the revenue it
//         counts for: revenue everywhere is amount - refunded_amount. Refunds
//         that add up to the whole payment make the order 'refunded'. Nothing
//         can exceed what was paid.
//       - A REVIEW order is closed whole (a capture parked for review may be a
//         different amount from the order's, which is often why it is under
//         review): the typed amount is recorded as what KPay gave back.
//   * A refund or void that closes the WHOLE payment of an order that has not
//     left the shop (unfulfilled or packed) also: cancels it, tells the
//     warehouse "CANCELLED - do not ship" (store_fulfilment_cancelled, the same
//     'cancel' outbox kind the admin cancel and the sweeper use), puts its
//     garments and discount uses back (store_stock_release, the release path a
//     cancelled order takes), and adds the customer's tracking step. A shipped
//     or delivered order is only re-marked: its goods are with the customer,
//     and a return (returns.php, then a stock 'return' adjustment) brings them
//     back.
//   * ONE submission, one row: the browser sends a fresh 32-hex request_key per
//     submission, and a second POST with the same key (a double click, a retry
//     after a lost answer) is answered with the first row and writes nothing.
//     The order row is locked first, so two different submissions cannot both
//     pass the "not more than was paid" check.
//   * Every new record is an admin activity event ('knet_refund_record' /
//     'payment_alert_dismiss') and carries who recorded it.
//
// Nothing here talks to KNET. Nothing here changes an amount the bank charged.

declare(strict_types=1);

const PAYREC_VOID_RESULT_WORDS = ['NOT CAPTURED', 'CANCELED', 'CANCELLED', 'DENIED BY RISK', 'HOST TIMEOUT'];
const PAYREC_EXPORT_MAX_ROWS = 5000;
const PAYREC_EXPORT_MAX_DAYS = 92;
// Kuwait is UTC+3 all year (no daylight saving). Every paid_at the payment
// paths write is UTC (gmdate in the callbacks).
const PAYREC_KUWAIT_OFFSET = 3 * 3600;

// Has the database got refunds.mysql.sql? Asked once per request per name.
function payrec_ready(PDO $db): bool {
    return store_column_exists($db, 'orders', 'refunded_amount')
        && store_column_exists($db, 'orders', 'gateway_attempt_ref')
        && store_column_exists($db, 'order_refunds', 'request_key')
        && store_column_exists($db, 'payment_alerts', 'payment_id');
}

// A KWD amount typed in /backends: a string (or an integer) with at most three
// decimals, no sign, no exponent, at most 9,999,999.999 (decimal(10,3)).
// Returns fils, or null. Floats are refused: 0.1 + 0.2 is not a price.
function payrec_fils(mixed $v): ?int {
    if (is_int($v)) $v = (string) $v;
    if (!is_string($v)) return null;
    if (!preg_match('/^(0|[1-9]\d{0,6})(?:\.(\d{1,3}))?$/D', trim($v), $m)) return null;
    return (int) $m[1] * 1000 + (int) str_pad((string) ($m[2] ?? ''), 3, '0');
}

function payrec_kwd(int $fils): string {
    return intdiv($fils, 1000) . '.' . str_pad((string) ($fils % 1000), 3, '0', STR_PAD_LEFT);
}

// A decimal(10,3) the database returned, as fils, without float arithmetic.
function payrec_db_fils(mixed $v): int {
    $f = payrec_fils(is_string($v) ? $v : (string) $v);
    return $f ?? 0;
}

// "2026-11-12 10:11:12" (UTC) -> "2026-11-12 13:11" (Kuwait), or null.
function payrec_kuwait(?string $utc): ?string {
    if ($utc === null || !preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/D', $utc)) return null;
    $t = strtotime($utc . ' UTC');
    return $t === false ? null : gmdate('Y-m-d H:i', $t + PAYREC_KUWAIT_OFFSET);
}

// A bank identifier as stored: trimmed, and null when empty.
function payrec_id(mixed $v): ?string {
    $s = trim((string) ($v ?? ''));
    return $s === '' ? null : substr($s, 0, 60);
}

// The bank's own result word, only when it is one: a manual settlement keeps
// "settled in admin by <email>" in the same column, and T-Pay keeps CBK's free
// text there. Neither is a result word, and neither may reach a shopper.
function payrec_result_word(array $o): ?string {
    $status = (string) ($o['payment_status'] ?? '');
    if (in_array($status, ['paid', 'refunded', 'voided'], true)) return 'CAPTURED';
    if ($status !== 'failed' || ($o['payment_method'] ?? '') !== 'knet') return null;
    $w = strtoupper(trim((string) ($o['cbk_message'] ?? '')));
    return in_array($w, PAYREC_VOID_RESULT_WORDS, true) ? $w : null;
}

// ============================================================== the receipt
//
// What the order's own shopper may see of the bank's answer (K-063 D1/D5;
// KNET-K063-CHECK.md "Owner's UAT receipt"): result, amount, date and time of
// the payment, Payment ID, Transaction ID, the bank's reference and auth code,
// and the order (track) number. EVERY value is the order row's, written by the
// callback (or a manual settlement): nothing is taken from the request. Card
// orders only; a cash order has no bank answer.
function payrec_receipt(array $o): ?array {
    if (!in_array((string) ($o['payment_method'] ?? ''), ['knet', 'tpay'], true)) return null;
    $status = (string) ($o['payment_status'] ?? '');
    $settled = in_array($status, ['paid', 'refunded', 'voided'], true);
    $paidAt = $settled && is_string($o['paid_at'] ?? null) ? (string) $o['paid_at'] : null;
    $out = [
        'track_id'       => (string) $o['track_id'],
        'payment_status' => $status,
        'result'         => payrec_result_word($o),
        'amount'         => payrec_kwd(payrec_db_fils($o['amount'] ?? '0')),
        'paid_at'        => $paidAt,
        'paid_at_kuwait' => payrec_kuwait($paidAt),
        'payment_id'     => payrec_id($o['cbk_paymentid'] ?? null),
        'transaction_id' => payrec_id($o['cbk_transaction'] ?? null),
        'reference'      => payrec_id($o['cbk_reference'] ?? null),
        'auth_code'      => payrec_id($o['cbk_authcode'] ?? null),
        // The Merchant Track ID the bank's answer came back under (the order's
        // own number on a first attempt, <track>A<n> on a retry); before
        // refunds.mysql.sql, or for T-Pay, the order number.
        'gateway_track_id' => payrec_id($o['gateway_attempt_ref'] ?? null) ?? (string) $o['track_id'],
    ];
    if (array_key_exists('refunded_amount', $o) && payrec_db_fils($o['refunded_amount']) > 0) {
        $out['refunded_amount'] = payrec_kwd(payrec_db_fils($o['refunded_amount']));
    }
    return $out;
}

// WHO IS ASKING: the same three proofs the invoice route accepts (see
// store_invoice_key_ok in store.php). The signed invoice key (?k=, issued with
// a new order; NOT the KNET result redirect's receipt key, which this never
// accepts: see payrec_receipt_key), the phone captured at checkout
// (X-Sporta-Phone header, never the query string), or the signed-in customer
// who owns the order. The order number alone proves nothing: it travels in
// URLs, bank statements and screenshots.
function payrec_viewer_proven(PDO $db, array $o, mixed $key): bool {
    $track = (string) ($o['track_id'] ?? '');
    if ($track !== '' && store_invoice_key_ok($track, $key)) return true;
    $phone = store_phone($_SERVER['HTTP_X_SPORTA_PHONE'] ?? null);
    if ($phone !== null && is_string($o['customer_phone'] ?? null)) {
        $own = store_phone((string) $o['customer_phone']);
        if ($own !== null && hash_equals($own, $phone)) return true;
    }
    if (!empty($o['customer_account_id']) && function_exists('customer_current_user')) {
        $viewer = customer_current_user($db);
        return $viewer !== null && (int) $viewer['id'] === (int) $o['customer_account_id'];
    }
    return false;
}

// THE RECEIPT KEY: what the KNET result redirect carries (review 2, defect 1).
// It used to be the order's INVOICE key, issued on the bank's authenticated leg
// whatever the result. But that leg can be started by anyone who knows a
// pending order's track id (pay.php needs nothing else): open the bank page
// for someone else's order, press Cancel, and the callback handed over the key
// that opens the victim's full invoice (name, street address). So the redirect
// now carries a NARROWER key, in its own HMAC domain ('receipt'), that:
//   * opens ?r=status's bank fields only (payrec_status_receipt); ?r=invoice
//     never accepts it (payrec_viewer_proven does not look at it), so it never
//     shows a name, a phone or an address;
//   * is issued only for the payment that paid the order (knet_result_extras:
//     a CAPTURED trandata whose Payment ID is the one the order now records),
//     so its holder is the one whose bank session paid, and already holds what
//     it shows. A cancel, a decline, a second capture or a replay of another
//     payment gets no key.
// Same shape and lifetime as the invoice key ("<expiry>.<32 hex>", 7 days,
// keyed on cron_key; an empty cron_key means no key is issued or verifies).
function payrec_receipt_sig(string $track, int $exp): string {
    return substr(hash_hmac('sha256', 'receipt' . "\0" . $track . "\0" . $exp,
                            (string) (store_config()['cron_key'] ?? '')), 0, 32);
}

function payrec_receipt_key(string $track, ?int $now = null): ?string {
    if ((string) (store_config()['cron_key'] ?? '') === '' || $track === '') return null;
    $exp = ($now ?? time()) + STORE_INVOICE_KEY_TTL;
    return $exp . '.' . payrec_receipt_sig($track, $exp);
}

function payrec_receipt_key_ok(string $track, mixed $key, ?int $now = null): bool {
    if (!is_string($key) || $track === '' || (string) (store_config()['cron_key'] ?? '') === '') return false;
    if (!preg_match('/^([0-9]{9,11})\.([a-f0-9]{32})$/D', $key, $m)) return false;
    $exp = (int) $m[1];
    if ($exp < ($now ?? time()) || $exp > ($now ?? time()) + STORE_INVOICE_KEY_TTL + 60) return false;
    return hash_equals(payrec_receipt_sig($track, $exp), $m[2]);
}

// The receipt for ?r=status, or null. Cheap when no proof was sent (the
// compiled result and tracking pages send none): no query at all. Takes the
// receipt key (above) or any of the invoice route's three proofs.
function payrec_status_receipt(PDO $db, string $track, mixed $key): ?array {
    $cookie = store_is_https() ? '__Host-sporta_customer' : 'sporta_customer';
    if ($track === '' || ($key === null && !isset($_SERVER['HTTP_X_SPORTA_PHONE']) && !isset($_COOKIE[$cookie]))) return null;
    $q = $db->prepare('select * from orders where track_id = ?');
    $q->execute([$track]);
    $o = $q->fetch(PDO::FETCH_ASSOC);
    if (!$o) return null;
    if (!payrec_receipt_key_ok($track, $key) && !payrec_viewer_proven($db, $o, $key)) return null;
    return payrec_receipt($o);
}

// ============================================================== /backends
//
// One dispatcher, so admin.php carries one small block. Routes:
//   GET  knet_payment_record  ?track_id= | ?order_id=   the order's bank fields,
//        its refunds, its second-capture alerts, and which actions are possible
//   POST knet_refund_record   {order_id, kind, payment_id, amount, kpay_reference?,
//        note?, request_key}
//   GET  payment_alerts                                open second captures
//   POST payment_alert_dismiss {alert_id, note?}       checked, not a second charge
//   GET  knet_reconcile_export ?from=YYYY-MM-DD&to=YYYY-MM-DD[&tz=kuwait|utc]  CSV
function payrec_admin_route(PDO $db, array $admin, string $r, string $method): never {
    $post = in_array($r, ['knet_refund_record', 'payment_alert_dismiss'], true);
    if ($post && $method !== 'POST') store_fail('method_not_allowed', 405);
    if (!$post && $method !== 'GET') store_fail('method_not_allowed', 405);
    if ($r === 'payment_alerts') {
        // Answered even before the migration (the /backends block uses it as its
        // probe): an empty list and ready=false, never an error.
        store_out(payrec_ready($db) ? payrec_open_alerts($db) : ['ready' => false, 'open' => 0, 'alerts' => []]);
    }
    if (!payrec_ready($db)) store_fail('refunds_migration_missing', 503);
    if ($r === 'knet_payment_record') {
        $id = $_GET['order_id'] ?? null;
        $track = trim((string) ($_GET['track_id'] ?? ''));
        $order = payrec_order_find($db, is_string($id) && ctype_digit($id) ? (int) $id : 0, $track);
        if ($order === null) store_fail('order_not_found', 404);
        store_out(payrec_order_view($db, (int) $order['id']));
    }
    if ($r === 'knet_refund_record') store_out(payrec_record($db, $admin, store_body(8192)));
    if ($r === 'payment_alert_dismiss') store_out(payrec_alert_dismiss($db, $admin, store_body(4096)));
    if ($r === 'knet_reconcile_export') payrec_export_csv($db, $_GET);
    store_fail('not_found', 404);
}

function payrec_order_find(PDO $db, int $id, string $track): ?array {
    if ($id > 0) {
        $q = $db->prepare('select id from orders where id = ?');
        $q->execute([$id]);
    } elseif (preg_match('/^[A-Za-z0-9]{1,30}$/D', $track)) {
        $q = $db->prepare('select id from orders where track_id = ?');
        $q->execute([$track]);
    } else {
        return null;
    }
    $row = $q->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

// Every reference an order was sent to the bank under: the track id for the
// first attempt, then <track>A2 ... (php-knet/knet.php knet_attempt_ref_for,
// the order part trimmed so the reference stays 30 characters). The KPay
// "Merchant Track ID" is one of these, never anything else.
function payrec_attempt_refs(string $track, int $attempts): array {
    $out = [$track];
    for ($n = 2; $n <= min(10, $attempts); $n++) {
        $suffix = 'A' . $n;
        $out[] = substr($track, 0, max(1, 30 - strlen($suffix))) . $suffix;
    }
    return $out;
}

function payrec_order_view(PDO $db, int $orderId): array {
    $q = $db->prepare('select id, track_id, amount, refunded_amount, payment_status, payment_method, fulfilment_status,
                              cbk_status, cbk_message, cbk_paymentid, cbk_transaction, cbk_reference, cbk_authcode,
                              pay_attempt, gateway_attempt_ref, paid_at, created_at, stock_claimed, stock_released
                         from orders where id = ?');
    $q->execute([$orderId]);
    $o = $q->fetch(PDO::FETCH_ASSOC);
    if (!$o) store_fail('order_not_found', 404);
    $amount = payrec_db_fils($o['amount']);
    $refunded = payrec_db_fils($o['refunded_amount']);
    $rq = $db->prepare('select id, kind, scope, amount, payment_id, kpay_reference, note, actor_email, created_at, alert_id
                          from order_refunds where order_id = ? order by id');
    $rq->execute([$orderId]);
    $refunds = array_map(static fn (array $x): array => [
        'id' => (int) $x['id'], 'kind' => $x['kind'], 'scope' => $x['scope'],
        'amount' => payrec_kwd(payrec_db_fils($x['amount'])), 'payment_id' => $x['payment_id'],
        'kpay_reference' => $x['kpay_reference'], 'note' => $x['note'], 'by' => $x['actor_email'],
        'at' => $x['created_at'], 'alert_id' => $x['alert_id'] === null ? null : (int) $x['alert_id'],
    ], $rq->fetchAll(PDO::FETCH_ASSOC));
    $aq = $db->prepare('select * from payment_alerts where order_id = ? order by id');
    $aq->execute([$orderId]);
    $alerts = array_map('payrec_alert_out', $aq->fetchAll(PDO::FETCH_ASSOC));
    $status = (string) $o['payment_status'];
    $isKnet = $o['payment_method'] === 'knet';
    $why = !$isKnet ? 'not_a_knet_order'
        : (in_array($status, ['refunded', 'voided'], true) ? 'order_already_refunded'
        : (in_array($status, ['paid', 'review'], true) ? null : 'order_not_paid'));
    $open = array_values(array_filter($alerts, static fn (array $a): bool => $a['resolution'] === null));
    return [
        'ready' => true,
        'order' => [
            'id' => (int) $o['id'], 'track_id' => $o['track_id'],
            'payment_method' => $o['payment_method'], 'payment_status' => $status,
            'fulfilment_status' => $o['fulfilment_status'],
            'amount' => payrec_kwd($amount), 'refunded_amount' => payrec_kwd($refunded),
            'remaining' => payrec_kwd(max(0, $amount - $refunded)),
            'paid_at' => $o['paid_at'], 'paid_at_kuwait' => payrec_kuwait($o['paid_at']),
            'created_at' => $o['created_at'],
            'payment_id' => payrec_id($o['cbk_paymentid']), 'transaction_id' => payrec_id($o['cbk_transaction']),
            'reference' => payrec_id($o['cbk_reference']), 'auth_code' => payrec_id($o['cbk_authcode']),
            'bank_result' => payrec_id($o['cbk_message']), 'record' => payrec_id($o['cbk_status']),
            'attempts' => (int) $o['pay_attempt'],
            'gateway_track_id' => payrec_id($o['gateway_attempt_ref']),
            'attempt_refs' => payrec_attempt_refs((string) $o['track_id'], max(1, (int) $o['pay_attempt'])),
            'shipped' => in_array($o['fulfilment_status'], ['shipped', 'delivered'], true),
        ],
        'refunds' => $refunds,
        'alerts' => $alerts,
        'actions' => [
            // A whole close of the order's own payment, or part of it; a review
            // order is closed whole. Open second captures can always be refunded.
            // (review 1, finding 2: they could not, once the order itself was
            // refunded or voided; the record route now takes them too.)
            'refund' => ($why === null && ($status === 'review' || $refunded < $amount)) || ($isKnet && count($open) > 0),
            'partial' => $why === null && $status === 'paid',
            'void' => ($why === null && ($status === 'review' || $refunded === 0)) || ($isKnet && count($open) > 0),
            'why' => $why,
            'open_alerts' => count($open),
        ],
    ];
}

function payrec_alert_out(array $a): array {
    return [
        'id' => (int) $a['id'], 'order_id' => (int) $a['order_id'], 'kind' => $a['kind'], 'gateway' => $a['gateway'],
        'payment_id' => $a['payment_id'], 'order_payment_id' => $a['order_payment_id'],
        'amount' => $a['amount'] === null ? null : payrec_kwd(payrec_db_fils($a['amount'])),
        'transaction_id' => $a['transaction_id'], 'reference' => $a['reference'], 'attempt_ref' => $a['attempt_ref'],
        'source' => $a['source'], 'resolution' => $a['resolution'], 'resolved_by' => $a['resolved_by'],
        'resolved_at' => $a['resolved_at'], 'created_at' => $a['created_at'],
        'track_id' => $a['track_id'] ?? null,
    ];
}

function payrec_open_alerts(PDO $db): array {
    $rows = $db->query('select a.*, o.track_id from payment_alerts a join orders o on o.id = a.order_id
                         where a.resolved_at is null order by a.id desc limit 200')->fetchAll(PDO::FETCH_ASSOC);
    return ['ready' => true, 'open' => count($rows), 'alerts' => array_map('payrec_alert_out', $rows)];
}

// The note: control characters become spaces, trimmed, 280 characters.
function payrec_note(mixed $v): ?string {
    if ($v === null) return null;
    if (!is_string($v) || strlen($v) > 4096) store_fail('invalid_note');
    $t = trim(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $v) ?? '');
    if ($t === '') return null;
    return mb_substr($t, 0, 280);
}

function payrec_record(PDO $db, array $admin, array $b): array {
    $orderId = is_int($b['order_id'] ?? null) ? (int) $b['order_id']
        : (is_string($b['order_id'] ?? null) && ctype_digit($b['order_id']) ? (int) $b['order_id'] : 0);
    if ($orderId <= 0) store_fail('order_not_found', 404);
    $kind = $b['kind'] ?? null;
    if (!in_array($kind, ['refund', 'void'], true)) store_fail('invalid_kind');
    $payId = is_string($b['payment_id'] ?? null) ? trim($b['payment_id']) : '';
    if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{5,59}$/D', $payId)) store_fail('payment_id_required');
    $fils = payrec_fils($b['amount'] ?? null);
    if ($fils === null || $fils <= 0) store_fail('amount_required');
    $kpayRef = is_string($b['kpay_reference'] ?? null) ? trim($b['kpay_reference']) : '';
    if ($kpayRef !== '' && !preg_match('/^[A-Za-z0-9._-]{1,60}$/D', $kpayRef)) store_fail('invalid_kpay_reference');
    $note = payrec_note($b['note'] ?? null);
    $key = is_string($b['request_key'] ?? null) ? $b['request_key'] : '';
    if (!preg_match('/^[a-f0-9]{32}$/D', $key)) store_fail('request_key_required');

    $db->beginTransaction();
    try {
        // The order row FIRST: two submissions for one order queue here, so the
        // second one is judged against what the first one recorded.
        $q = $db->prepare('select id, track_id, amount, refunded_amount, payment_status, payment_method,
                                  fulfilment_status, cbk_paymentid
                             from orders where id = ? for update');
        $q->execute([$orderId]);
        $o = $q->fetch(PDO::FETCH_ASSOC);
        if (!$o) { $db->rollBack(); store_fail('order_not_found', 404); }

        // The same submission again: the first answer, nothing written. A
        // locking read, so a submission committed while this one waited for
        // the order lock is seen.
        $seen = $db->prepare('select id, order_id from order_refunds where request_key = ? for update');
        $seen->execute([$key]);
        $prior = $seen->fetch(PDO::FETCH_ASSOC);
        if ($prior) {
            $db->commit();
            if ((int) $prior['order_id'] !== $orderId) store_fail('request_key_reused', 409);
            return ['ok' => true, 'replayed' => true, 'refund_id' => (int) $prior['id']] + payrec_order_view($db, $orderId);
        }

        if ($o['payment_method'] !== 'knet') { $db->rollBack(); store_fail('not_a_knet_order', 409); }
        $status = (string) $o['payment_status'];

        // Whose payment is this? The order's own, or an open second capture.
        // An OPEN SECOND CAPTURE can be refunded whatever the order's own
        // status is (review 1, finding 2): it is kept on a refunded or voided
        // order too (knet_settle_order_once), and the owner may record the
        // order's own refund first. The status rules below are the ORDER's
        // payment's rules, and apply to scope 'order' only.
        $orderPay = trim((string) ($o['cbk_paymentid'] ?? ''));
        $alert = null;
        if ($orderPay !== '' && hash_equals($orderPay, $payId)) {
            $scope = 'order';
        } else {
            $aq = $db->prepare("select id, amount from payment_alerts
                                 where order_id = ? and payment_id = ? and resolved_at is null for update");
            $aq->execute([$orderId, $payId]);
            $alert = $aq->fetch(PDO::FETCH_ASSOC) ?: null;
            if ($alert !== null) {
                $scope = 'duplicate';
            } elseif ($orderPay === '' && $status === 'review') {
                // A capture parked for review with no Payment ID: the typed one
                // is the only record there will be.
                $scope = 'order';
            } elseif (in_array($status, ['paid', 'review'], true)) {
                $db->rollBack();
                store_fail('payment_id_mismatch', 409);
            } else {
                $scope = 'order';   // refused by the status rules just below
            }
        }
        if ($scope === 'order') {
            if (in_array($status, ['refunded', 'voided'], true)) { $db->rollBack(); store_fail('order_already_refunded', 409); }
            if (!in_array($status, ['paid', 'review'], true)) { $db->rollBack(); store_fail('order_not_paid', 409); }
        }

        $amount = payrec_db_fils($o['amount']);
        $refunded = payrec_db_fils($o['refunded_amount']);
        $closes = false;
        if ($scope === 'duplicate') {
            // A second charge is given back whole; its amount is the bank's when known.
            if ($alert['amount'] !== null && payrec_db_fils($alert['amount']) !== $fils) {
                $db->rollBack(); store_fail('amount_must_match_capture', 409);
            }
        } elseif ($status === 'review') {
            // Closed whole, with the amount KPay gave back; never more than the
            // order's amount (review 1, finding 4: a typo of 9999.000 on a
            // 12.000 order showed more refunded than was paid everywhere). The
            // bank charged what pay.php sent, which is the order's amount.
            if ($fils > $amount) { $db->rollBack(); store_fail('refund_exceeds_payment', 409); }
            $closes = true;
        } elseif ($kind === 'void') {
            if ($refunded > 0) { $db->rollBack(); store_fail('void_after_refund', 409); }
            if ($fils !== $amount) { $db->rollBack(); store_fail('void_must_be_full', 409); }
            $closes = true;
        } else {
            if ($fils > $amount - $refunded) { $db->rollBack(); store_fail('refund_exceeds_payment', 409); }
            $closes = ($refunded + $fils === $amount);
        }

        $db->prepare('insert into order_refunds
                        (order_id, kind, amount, scope, alert_id, payment_id, kpay_reference, note,
                         request_key, actor_admin_id, actor_email)
                      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
           ->execute([$orderId, $kind, payrec_kwd($fils), $scope, $alert === null ? null : (int) $alert['id'],
                      $payId, $kpayRef === '' ? null : $kpayRef, $note, $key,
                      (int) $admin['id'], (string) $admin['email']]);
        $refundId = (int) $db->lastInsertId();

        if ($scope === 'duplicate') {
            $db->prepare("update payment_alerts set resolution = ?, resolved_by = ?, resolved_at = now()
                           where id = ? and resolved_at is null")
               ->execute([$kind === 'void' ? 'voided' : 'refunded', (string) $admin['email'], (int) $alert['id']]);
        } else {
            $after = $closes ? ($kind === 'void' ? 'voided' : 'refunded') : $status;
            $db->prepare('update orders set refunded_amount = refunded_amount + ?, payment_status = ?,
                                  cbk_paymentid = case when coalesce(cbk_paymentid, \'\') = \'\' then ? else cbk_paymentid end
                            where id = ?')
               ->execute([payrec_kwd($fils), $after, $payId, $orderId]);
            if ($closes) payrec_stop_order($db, $orderId, (string) $o['fulfilment_status']);
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        // The same key committed by a submission that raced this one past the
        // locking read: answer as the replay it is.
        if ($e instanceof PDOException && (int) ($e->errorInfo[1] ?? 0) === 1062) {
            $again = $db->prepare('select id, order_id from order_refunds where request_key = ?');
            $again->execute([$key]);
            $row = $again->fetch(PDO::FETCH_ASSOC);
            if ($row && (int) $row['order_id'] === $orderId) {
                return ['ok' => true, 'replayed' => true, 'refund_id' => (int) $row['id']] + payrec_order_view($db, $orderId);
            }
            store_fail('request_key_reused', 409);
        }
        throw $e;
    }
    store_admin_event($db, $admin, 'knet_refund_record');
    return ['ok' => true, 'replayed' => false, 'refund_id' => $refundId] + payrec_order_view($db, $orderId);
}

// The whole payment went back: an order still in the shop stops here. Same
// three steps as an admin cancel (admin.php ?r=fulfilment): the status and the
// customer's tracking step, the warehouse's "CANCELLED - do not ship", and the
// garments and discount uses back (store_stock_release; payment_status is no
// longer 'paid', so the release path treats it as the cancelled order it is).
// Called inside the caller's transaction, with the order row locked.
function payrec_stop_order(PDO $db, int $orderId, string $fulfilment): void {
    if (in_array($fulfilment, ['shipped', 'delivered'], true)) return;
    if ($fulfilment !== 'cancelled') {
        $db->prepare("update orders set fulfilment_status = 'cancelled' where id = ?")->execute([$orderId]);
        store_tracking_event($db, $orderId, 'cancelled');
        store_fulfilment_cancelled($db, $orderId);
    }
    store_stock_release($db, $orderId);
}

function payrec_alert_dismiss(PDO $db, array $admin, array $b): array {
    $id = is_int($b['alert_id'] ?? null) ? (int) $b['alert_id'] : 0;
    if ($id <= 0) store_fail('alert_not_found', 404);
    $note = payrec_note($b['note'] ?? null);
    $st = $db->prepare("update payment_alerts set resolution = 'dismissed', resolved_by = ?, resolved_at = now()
                         where id = ? and resolved_at is null");
    $st->execute([mb_substr((string) $admin['email'] . ($note !== null ? ' — ' . $note : ''), 0, 120), $id]);
    if ($st->rowCount() !== 1) {
        $q = $db->prepare('select count(*) from payment_alerts where id = ?');
        $q->execute([$id]);
        $exists = (int) $q->fetchColumn() === 1;
        store_fail($exists ? 'alert_already_resolved' : 'alert_not_found', $exists ? 409 : 404);
    }
    store_admin_event($db, $admin, 'payment_alert_dismiss');
    return payrec_open_alerts($db);
}

// ============================================================== the export
//
// The daily KPay check (KNET.md "Daily KPay reconciliation"): every KNET order
// with anything in the window (created, paid, refunded, or a second capture
// seen), one row each, with every reference KPay can show for it. No customer
// name, phone or address: the check matches money, not people.
function payrec_export_csv(PDO $db, array $get): never {
    $from = is_string($get['from'] ?? null) ? $get['from'] : '';
    $to = is_string($get['to'] ?? null) ? $get['to'] : '';
    $tz = ($get['tz'] ?? 'kuwait') === 'utc' ? 'utc' : 'kuwait';
    $a = DateTimeImmutable::createFromFormat('!Y-m-d', $from, new DateTimeZone('UTC'));
    $z = DateTimeImmutable::createFromFormat('!Y-m-d', $to, new DateTimeZone('UTC'));
    if (!$a || !$z || $a->format('Y-m-d') !== $from || $z->format('Y-m-d') !== $to) store_fail('invalid_dates');
    $days = (int) $a->diff($z)->format('%r%a');
    if ($days < 0 || $days >= PAYREC_EXPORT_MAX_DAYS) store_fail('invalid_dates');
    // The window in UTC (what the database holds). A Kuwait day starts at
    // 21:00 UTC the day before.
    $shift = $tz === 'kuwait' ? PAYREC_KUWAIT_OFFSET : 0;
    $lo = gmdate('Y-m-d H:i:s', $a->getTimestamp() - $shift);
    $hi = gmdate('Y-m-d H:i:s', $z->getTimestamp() + 86400 - $shift);

    $q = $db->prepare("select o.id, o.track_id, o.amount, o.refunded_amount, o.payment_status, o.fulfilment_status,
                              o.cbk_status, o.cbk_message, o.cbk_paymentid, o.cbk_transaction, o.cbk_reference,
                              o.cbk_authcode, o.pay_attempt, o.gateway_attempt_ref, o.created_at, o.paid_at
                         from orders o
                        where o.payment_method = 'knet'
                          and ((o.created_at >= ? and o.created_at < ?)
                            or (o.paid_at >= ? and o.paid_at < ?)
                            or exists (select 1 from order_refunds r where r.order_id = o.id and r.created_at >= ? and r.created_at < ?)
                            or exists (select 1 from payment_alerts p where p.order_id = o.id and p.created_at >= ? and p.created_at < ?))
                        order by o.created_at, o.id
                        limit " . (PAYREC_EXPORT_MAX_ROWS + 1));
    $q->execute([$lo, $hi, $lo, $hi, $lo, $hi, $lo, $hi]);
    $orders = $q->fetchAll(PDO::FETCH_ASSOC);
    if (count($orders) > PAYREC_EXPORT_MAX_ROWS) store_fail('too_many_rows', 413);

    $ids = array_map(static fn (array $o): int => (int) $o['id'], $orders);
    $refunds = $alerts = [];
    if ($ids) {
        $in = implode(',', array_fill(0, count($ids), '?'));
        $rq = $db->prepare("select order_id, kind, scope, amount, payment_id, kpay_reference, created_at
                              from order_refunds where order_id in ($in) order by id");
        $rq->execute($ids);
        foreach ($rq->fetchAll(PDO::FETCH_ASSOC) as $x) $refunds[(int) $x['order_id']][] = $x;
        $aq = $db->prepare("select order_id, payment_id, amount, resolution from payment_alerts
                             where order_id in ($in) order by id");
        $aq->execute($ids);
        foreach ($aq->fetchAll(PDO::FETCH_ASSOC) as $x) $alerts[(int) $x['order_id']][] = $x;
    }

    $head = ['Order (track id)', 'Merchant Track IDs sent to KNET', 'Answered under', 'Payment status', 'Fulfilment', 'Amount KWD',
             'Refunded KWD', 'Net KWD', 'Bank result', 'Sporta record', 'Payment ID', 'Transaction ID', 'Reference',
             'Auth code', 'Attempts', 'Created (UTC)', 'Paid (UTC)', 'Paid (Kuwait)', 'Refunds and voids',
             'Second captures'];
    $lines = [payrec_csv_line($head)];
    foreach ($orders as $o) {
        $id = (int) $o['id'];
        $amount = payrec_db_fils($o['amount']);
        $refunded = payrec_db_fils($o['refunded_amount']);
        $ref = array_map(static fn (array $x): string => $x['kind'] . ' ' . payrec_kwd(payrec_db_fils($x['amount']))
            . ' ' . $x['payment_id'] . ($x['scope'] === 'duplicate' ? ' (second capture)' : '')
            . ($x['kpay_reference'] ? ' KPay ' . $x['kpay_reference'] : '') . ' at ' . $x['created_at'], $refunds[$id] ?? []);
        $dup = array_map(static fn (array $x): string => $x['payment_id']
            . ($x['amount'] !== null ? ' ' . payrec_kwd(payrec_db_fils($x['amount'])) : '')
            . ' ' . ($x['resolution'] ?? 'OPEN'), $alerts[$id] ?? []);
        $lines[] = payrec_csv_line([
            $o['track_id'], implode(' ', payrec_attempt_refs((string) $o['track_id'], max(1, (int) $o['pay_attempt']))),
            (string) ($o['gateway_attempt_ref'] ?? ''), $o['payment_status'], $o['fulfilment_status'], payrec_kwd($amount), payrec_kwd($refunded),
            payrec_kwd($o['payment_status'] === 'paid' ? max(0, $amount - $refunded) : 0),
            // The bank's word only: a manual settlement's note names a person.
            // MANUAL_THEN_CAPTURED: settled by hand, then the bank's capture arrived (knet_adopt_after_manual).
            $o['cbk_status'] === 'MANUAL_BANK_CONFIRMED' ? 'MANUAL'
                : ($o['cbk_status'] === 'MANUAL_THEN_CAPTURED' ? 'CAPTURED' : (string) ($o['cbk_message'] ?? '')),
            (string) ($o['cbk_status'] ?? ''), (string) ($o['cbk_paymentid'] ?? ''),
            (string) ($o['cbk_transaction'] ?? ''), (string) ($o['cbk_reference'] ?? ''),
            (string) ($o['cbk_authcode'] ?? ''), (string) (int) $o['pay_attempt'],
            (string) $o['created_at'], (string) ($o['paid_at'] ?? ''), (string) (payrec_kuwait($o['paid_at']) ?? ''),
            implode('; ', $ref), implode('; ', $dup),
        ]);
    }
    $name = 'knet-reconcile-' . $from . '-to-' . $to . '-' . $tz . '.csv';
    http_response_code(200);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('X-Content-Type-Options: nosniff');
    // A byte order mark so a spreadsheet reads it as UTF-8.
    echo "\xEF\xBB\xBF" . implode("\r\n", $lines) . "\r\n";
    exit;
}

// Every cell quoted; one that starts with = + - @ (or a tab, CR or LF) gets a
// leading ' so a spreadsheet reads it as text and never runs it (the same rule
// as the CSV exports in sporta-admin-brands.js).
function payrec_csv_line(array $cells): string {
    return implode(',', array_map(static function ($v): string {
        $s = (string) $v;
        if ($s !== '' && preg_match('/^[=+\-@\t\r\n]/', $s)) $s = "'" . $s;
        return '"' . str_replace('"', '""', $s) . '"';
    }, $cells));
}
