<?php
// KNET response handler. KNET posts the encrypted trandata here after payment.
// Decrypts, verifies CAPTURED + amount, updates the order, redirects the
// customer to the React result page.
//
// Register THIS URL with your bank/KNET as responseURL and errorURL.

declare(strict_types=1);
require __DIR__ . '/knet.php';
knet_require_https();
$cfg = knet_config();

$return   = $cfg['result_page_url'];
$in       = $_POST + $_GET;
$trandata = (string)($in['trandata'] ?? '');

if ($trandata === '') {
    knet_send_customer_onward($cfg, $return . '?status=error&reason=missing_data');
    exit;
}

// THE THROTTLE GOES ON THE FAILURES, NOT ON THE CALLBACK.
//
// A trandata that decrypts under the resource key is proof the bank sent it —
// nobody else holds that key — so a successful decrypt is authenticated and
// must never be refused. Throttling those is how a captured payment goes
// unrecorded, which is the one outcome worse than any abuse this could stop.
//
// A decrypt FAILURE is the opposite: it is a caller who does not hold the key,
// and there is no legitimate source of one. Thirty in ten minutes per IP, and
// the counter is only touched after a failure, so a shop taking payments all
// day never increments it once.
try {
    $fields = knet_parse_response(knet_decrypt($trandata, $cfg['resource_key']));
} catch (Throwable $e) {
    $reason = knet_over_limit($cfg, 'knet_cb_bad', 30, 600) ? 'throttled' : 'decrypt_failed';
    knet_log($cfg, 'callback.decrypt_failed', ['reason' => $reason]);
    knet_send_customer_onward($cfg, $return . '?status=error&reason=' . $reason);
    exit;
}

$result    = strtoupper((string)($fields['result'] ?? ''));
$paid      = ($result === 'CAPTURED' || $result === 'APPROVED');
// What the bank echoes back is the reference we SENT, which on a retry carries
// an attempt suffix. Resolve it to the order's own track id immediately, before
// anything else touches it: every lookup and the settling UPDATE below key on
// `track_id`, and an unresolved reference would match no row at all — the bank
// having captured the money while the order stayed pending.
$trackid   = knet_resolve_track($cfg, (string)($fields['trackid'] ?? ''));
$paymentid = (string)($fields['paymentid'] ?? '');
$ref       = (string)($fields['ref'] ?? '');
$paidAmt   = (string)($fields['amt'] ?? ($fields['Amt'] ?? ''));

$haveDb = knet_db_configured($cfg) && $trackid !== '';

knet_log($cfg, 'callback.received', [
    'trackid' => $trackid, 'result' => $result, 'amt' => $paidAmt, 'payid' => $paymentid,
]);

// ---------------------------------------------------------------------------
// Amount verification — FAIL CLOSED.
//
// Previously an unverifiable amount (database down, order missing, or KNET not
// echoing 'amt') skipped the comparison entirely and the order was still
// marked PAID. Now anything we cannot positively verify is held for review
// instead of being trusted.
// ---------------------------------------------------------------------------
$review = false;
if ($paid && $haveDb) {
    $lookup = knet_order_lookup($cfg, $trackid);
    if ($lookup['state'] !== 'found' || $paidAmt === '') {
        $paid = false;
        $review = true;
        $result = 'UNVERIFIED_' . strtoupper($lookup['state']);
        knet_log($cfg, 'callback.unverified', ['trackid' => $trackid, 'state' => $lookup['state']]);
    } elseif (abs((float) $lookup['amount'] - (float) $paidAmt) >= 0.001) {
        $paid = false;
        $result = 'AMOUNT_MISMATCH';
        knet_log($cfg, 'callback.amount_mismatch', [
            'trackid' => $trackid, 'expected' => $lookup['amount'], 'paid' => $paidAmt,
        ]);
    }
}

if ($haveDb) {
    $ok = knet_update_order($cfg, $trackid, $paid, $result, $fields, $review);
    if (!$ok) {
        // The bank may well have taken the money; if we cannot record it the
        // order must never be lost silently.
        knet_log($cfg, 'callback.db_write_failed', [
            'trackid' => $trackid, 'result' => $result, 'paid' => $paid, 'payid' => $paymentid,
        ]);
    }
}

$status = $paid
    ? 'success'
    : ($review ? 'review' : (($result === 'CANCELED' || $result === 'CANCELLED') ? 'cancelled' : 'failed'));
$q = http_build_query(['status' => $status, 'trackid' => $trackid, 'payid' => $paymentid, 'ref' => $ref]);
knet_send_customer_onward($cfg, $return . '?' . $q);
exit;

// ---------------------------------------------------------------------------
// Getting the customer back to the shop — the step KNET integrations lose
// people on.
//
// KPG has TWO deployment styles and they need opposite answers:
//
//   * The gateway REDIRECTS THE BROWSER here. An HTTP 302 works; HTML works.
//   * The gateway calls this URL SERVER TO SERVER and reads the reply looking
//     for the token `REDIRECT=<url>`, then sends the browser there itself. A
//     302 is useless in this mode: KNET's client does not render it, so the
//     shopper is left on a blank bank page with their money taken.
//
// Which one a given Tranportal ID gets is decided by the bank, not by us, and
// the wrong guess is invisible in testing until a real customer is stranded.
// So the default answers BOTH at once: HTTP 200, first line `REDIRECT=<url>`
// for the server-to-server parser, then a meta refresh, a script and a plain
// link for a browser. Set 'callback_response' => 'redirect' in config.php to
// force the plain 302 if the bank confirms the browser-redirect style.
function knet_send_customer_onward(array $cfg, string $url): void
{
    if (($cfg['callback_response'] ?? 'both') === 'redirect') {
        header('Location: ' . $url, true, 302);
        return;
    }
    // Order matters: KNET scans from the start of the body, so REDIRECT= comes
    // before any markup that might contain an '=' of its own.
    header('Content-Type: text/html; charset=utf-8');
    $safe = htmlspecialchars($url, ENT_QUOTES, 'UTF-8');
    echo 'REDIRECT=' . $url . "\n";
    // NO SCRIPT. There used to be a location.replace() here as a third way
    // home, behind the meta refresh and ahead of the link. It has been
    // removed rather than kept and blocked: knet/.htaccess now sets
    // script-src 'none' over this directory, so it could not run, and a line
    // that cannot run is worse than no line — the next reader takes it for the
    // mechanism that gets the customer back to the shop.
    //
    // Nothing is lost. A meta refresh with content="0;url=" is honoured by
    // every browser and is not governed by CSP at all, and the link below is
    // the answer for anyone it is not. Both were already here; the script was
    // the redundant one of the three.
    echo '<!doctype html><html><head><meta charset="utf-8">',
         '<meta http-equiv="refresh" content="0;url=', $safe, '">',
         '<title>Redirecting…</title></head><body>',
         '<p><a href="', $safe, '">Continue</a></p>',
         '</body></html>';
}

// Returns true only if the order row was actually updated. The old version
// discarded the curl result entirely, so a failed write left the customer on a
// "success" page with no paid order recorded anywhere.
function knet_update_order(array $cfg, string $trackid, bool $paid, string $result, array $fields, bool $review = false): bool
{
    // The bank's answer, written to the orders table on this same host. Every
    // rule here was learned the hard way and none of them is decoration: never
    // downgrade a paid order, never re-stamp or re-notify on a replay, and
    // report a failed write honestly so the customer is not shown success over
    // a payment nobody recorded.
    try {
        $pdo = knet_pdo($cfg);
        $pdo->beginTransaction();

        // IDEMPOTENCE. A callback can arrive twice — the bank retries, the
        // customer refreshes the return page, a proxy replays it. Without
        // this an already-paid order was re-stamped with a new paid_at AND
        // queued a SECOND "payment received" email to the warehouse, since
        // the outbox's unique index only covers the 'new' message. It also
        // untangles a PDO trap: rowCount() counts rows CHANGED, not matched,
        // so rewriting identical values returns 0 and the old code read that
        // as a failed write and logged a lost payment that was never lost.
        $cur = $pdo->prepare('select payment_status from orders where track_id = ?');
        $cur->execute([$trackid]);
        $before = $cur->fetchColumn();
        if ($before === false) {           // no such order — nothing to write
            $pdo->rollBack();
            return false;
        }
        if ($before === 'paid' && $paid) { // already settled: succeed, silently
            $pdo->rollBack();
            return true;
        }
        $after = $paid ? 'paid' : ($review ? 'review' : 'failed');
        $sql = 'update orders set payment_status = ?, cbk_status = ?, cbk_message = ?,
                  cbk_paymentid = ?, cbk_transaction = ?, cbk_reference = ?,
                  cbk_authcode = ?, cbk_receipt = ?, cbk_paytype = ?, paid_at = ?
                where track_id = ?';
        if (!$paid) $sql .= " and payment_status <> 'paid'";
        $st = $pdo->prepare($sql);
        $st->execute([
            $after,
            $result,
            (string)($fields['result'] ?? ''), (string)($fields['paymentid'] ?? ''),
            (string)($fields['tranid'] ?? ''), (string)($fields['ref'] ?? ''),
            (string)($fields['auth'] ?? ''), (string)($fields['receipt'] ?? ''),
            (string)($fields['paytype'] ?? ''),
            $paid ? gmdate('Y-m-d H:i:s') : null,
            $trackid,
        ]);
        // Matched-not-changed: the guarded UPDATE above only skips rows
        // that are already paid, and that case returned early, so reaching
        // here means the row is ours to claim. rowCount() can still be 0
        // when every column already holds these values (a replayed FAILURE
        // callback), which is a successful write, not a lost one.
        $updated = true;
        // The warehouse hears about a TRANSITION, not about a delivery.
        // Guarding on the status actually changing is what stops a replayed
        // failure callback sending a second "do not ship" — the outbox's
        // unique index only protects the 'new' message, so this guard is
        // the only thing standing between a retry and a duplicate email.
        if ($before !== $after && ($paid || !$review)) {
            // The ship-it / do-not-ship follow-up, queued in the same
            // transaction as the status it reports.
            $o = $pdo->prepare('select id from orders where track_id = ?');
            $o->execute([$trackid]);
            if ($orderId = $o->fetchColumn()) {
                // public_html layout first (knet/ and api/ are
                // siblings); repo layout second, for the test rig.
                // A MISSING store.php is a deployment error, not a data
                // one, and must never roll back the record that money was
                // taken: require_once throws inside this try, and the catch
                // below would put the order back to 'pending' with the cash
                // already captured.
                $storeLib = dirname(__DIR__) . '/api/store.php';
                if (!is_file($storeLib)) $storeLib = dirname(__DIR__) . '/php-store/store.php';
                if (is_file($storeLib)) {
                    require_once $storeLib;
                    store_queue_fulfilment($pdo, (int)$orderId, 'payment');
                    // And the books, on the same terms: store_post_to_ledger
                    // swallows its own failures for exactly the reason spelled
                    // out above — a bookkeeping problem must never roll back
                    // the record that the bank took the money. An order that
                    // is paid and unposted is listed on the Accounting screen
                    // until somebody posts it.
                    if ($paid) store_post_to_ledger($pdo, (int)$orderId);
                }
            }
        }
        $pdo->commit();
        return $updated;
    } catch (Throwable $e) {
        if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
        return false;
    }
}
