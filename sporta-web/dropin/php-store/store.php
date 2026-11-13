<?php
// Sporta native store backend — shared core.
//
// This is the backend: MySQL on the same Hostinger plan, PHP on
// the same host that already runs the payment endpoints. It is the model the
// owner's previous OpenCart site used, and it exists so the shop can run with
// no third-party backend at all.
//
// EVERY RULE HERE IS A PORT, NOT AN INVENTION. create_order's validation,
// server-side pricing, idempotency, the size/fit lists, the outbox — each was
// designed and argued over in the Postgres schema this shop started on, and
// this file carries the same
// decisions into PHP. When a rule looks arbitrary ("why 99?"), the reasoning
// lives in the SQL file of the same name; keep the two in step or the two
// backends will accept different orders.
//
// SECURITY POSTURE. This runs on the host that takes the money, so the rules
// that governed the payment dropins govern this too:
//   * config.php holds the DB password and the admin hash — server-only, never
//     committed, never in the zip, denied by name in .htaccess.
//   * Owner media uploads write only validated images/fonts into isolated,
//     non-executable media mounts. No request can write application code.
//   * The browser is never trusted: prices come from the products table, and
//     every admin write goes through the session guard below.

declare(strict_types=1);
// Warnings belong in the server log, never before a JSON or image response.
// A PHP warning prefix makes otherwise valid slide settings unreadable by the SPA.
ini_set('display_errors', '0');
require_once __DIR__ . '/config-path.php';

// ---------------------------------------------------------------- config + db

function store_config(): array {
    static $cfg = null;
    if ($cfg === null) {
        $path = sporta_config_path('api', __DIR__ . '/config.php');
        if (!is_file($path)) {
            store_out(['error' => 'not_configured',
                       'hint'  => 'copy config.example.php to config.php and fill in the MySQL details'], 500);
        }
        $cfg = require $path;
    }
    return $cfg;
}

function store_db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $c = store_config();
        try {
            // ERRMODE_EXCEPTION everywhere: a silent false from PDO is how a
            // half-written order happens. utf8mb4 because the catalogue is
            // Arabic.
            $pdo = new PDO(
                "mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4",
                $c['db_user'],
                $c['db_pass'],
                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    // Real prepared statements. Emulated ones interpolate, and
                    // an endpoint fed raw JSON from the internet does not.
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]
            );
        } catch (PDOException $e) {
            // FAILING TO CONNECT IS NOT THE SAME AS A QUERY FAILING, and the
            // difference is the whole point of this branch.
            //
            // Without it, a typo in config.php's db_pass came out of the
            // exception handler below as the generic 'failed', the admin had
            // no branch for that, and it fell through to the last thing on the
            // list — "Wrong email or password." So the owner retyped a correct
            // password five times and locked the account for fifteen minutes,
            // over a wrong DATABASE password. Every one of these errors means
            // "one of the four values in config.php is wrong", and MySQL says
            // WHICH, so it is passed on rather than thrown away.
            $code = (int) ($e->errorInfo[1] ?? 0);
            $which = match ($code) {
                1045    => 'db_user or db_pass',
                1044    => 'db_user has no privileges on db_name',
                1049    => 'db_name',
                2002,
                2005    => 'db_host',
                default => 'one of the four values',
            };
            store_out(['error' => 'db_unreachable', 'cause' => $which], 500);
        }
    }
    return $pdo;
}

// ---------------------------------------------------------------- error floor
//
// Any database error that is not caught locally used to escape as a PHP fatal:
// the browser got HTML instead of JSON (so the admin screen showed a blank
// panel rather than a reason), and on a host with display_errors on, the
// message itself names the database and the SQL. Neither belongs in a
// response. One handler turns both into a JSON token.
//
// The missing-table case is told apart on purpose. It is not an outage — it
// means the SQL was never imported, and it has a specific fix the admin
// screens spell out.
set_exception_handler(function (Throwable $e): void {
    // A missing COLUMN counts too, and it used to not. 1146 is "table does not
    // exist"; 1054 is "unknown column", which is what a server sees when the
    // FILES have been published but the additive SQL beside them has not been
    // imported yet — a shop upgraded rather than installed fresh. The symptom
    // was a bare 500 "failed" on the Orders screen, which names neither the
    // cause nor the fix, on the one screen the owner opens to find out what is
    // wrong. Both mean the same thing to a human — the database is behind the
    // code — and both are fixed by importing the SQL.
    $code = $e instanceof PDOException ? ($e->errorInfo[1] ?? 0) : 0;
    $isMissingSchema = $e instanceof PDOException
        && ($code === 1146 || $code === 1054
            || str_contains($e->getMessage(), '42S02')   // no such table
            || str_contains($e->getMessage(), '42S22')); // no such column
    store_out(['error' => $isMissingSchema ? 'no_table' : 'failed'], $isMissingSchema ? 503 : 500);
});

// Does this database have the column yet? For code that ships ahead of an
// additive migration and must keep working until the SQL is imported, instead
// of turning every request into "unknown column". Asked once per request per
// column, from information_schema, never by trying the query and catching it.
function store_column_exists(PDO $db, string $table, string $column): bool {
    static $known = [];
    $k = $table . '.' . $column;
    if (!array_key_exists($k, $known)) {
        $q = $db->prepare('select count(*) from information_schema.columns
                            where table_schema = database() and table_name = ? and column_name = ?');
        $q->execute([$table, $column]);
        $known[$k] = (int)$q->fetchColumn() > 0;
    }
    return $known[$k];
}

// ------------------------------------------------------------------ responses

function store_out($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    // No CORS headers on purpose. The SPA and this API live on the same origin
    // (www.sporta.com.kw), and an API nobody else may call should not invite
    // anybody else to call it. A backend hosted somewhere else needs CORS
    // precisely because it IS a different origin; this one is not.
    // Hex-escape HTML-significant characters as a defense in depth measure.
    // API replies are JSON, but this keeps them inert even if a proxy or a
    // future integration accidentally treats a response as an HTML fragment.
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    exit;
}

// ANSWER NOW, KEEP WORKING. For a request whose answer must not depend on what
// happens next — "if that address has an account, a link is on its way" —
// but whose work does: looking the address up, writing a token, handing a
// message to the mail relay. Done before answering, that work happens only for
// a REAL account, and the response time says which kind the address was.
//
// The complete response goes out first, with its length, so the browser (and
// any proxy in front) has the whole answer and stops waiting; PHP carries on
// after it. ignore_user_abort keeps a closed tab from cutting the work short.
// Compression is turned off for this response because a compressed body would
// not be the length announced. Under PHP-FPM, fastcgi_finish_request() is the
// same thing done properly.
//
// After this returns the response is gone: the caller must not send another,
// and anything that fails must go to the error log, not the browser.
function store_out_early($data, int $code = 200): void {
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    ignore_user_abort(true);
    if (function_exists('apache_setenv')) @apache_setenv('no-gzip', '1');
    @ini_set('zlib.output_compression', '0');
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Length: ' . strlen((string)$json));
    header('Connection: close');
    echo $json;
    while (ob_get_level() > 0) @ob_end_flush();
    flush();
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
}

// The same stable machine tokens create_order raises, so the storefront's
// existing error translations keep working unchanged against this backend.
function store_fail(string $token, int $code = 400): void {
    store_out(['error' => $token], $code);
}

function store_body(int $maxBytes = 16 * 1024 * 1024): array {
    // Most admin writes are tiny, but the lossless product-photo endpoint can
    // carry up to 14 MiB of encoded image. Bound the default read above that
    // ceiling; callers with smaller payloads pass a tighter explicit limit.
    // A zero or negative limit must never silently restore an unlimited read.
    $maxBytes = max(1, $maxBytes);
    $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($raw !== false && strlen($raw) > $maxBytes) {
        store_fail('request_too_large', 413);
    }
    $data = json_decode($raw === false ? '' : $raw, true);
    return is_array($data) ? $data : [];
}

// Password-reset mail uses the same authenticated Sporta sender as fulfilment
// mail, but is kept here so the unauthenticated admin endpoint does not include
// the cron script (and its warehouse side effects).  Config values are treated
// as server-only and header-injected values are rejected.
function store_admin_recovery_sender(array $cfg): string {
    // Recovery must use an existing mailbox. Older private configurations
    // still name orders@ as the fulfilment sender, although only cs@ was
    // provisioned. Prefer the dedicated recovery sender, then the verified
    // customer/reply mailbox; keep the legacy sender as the last fallback.
    foreach (['admin_mail_from', 'customer_mail_from', 'mail_reply_to', 'mail_from'] as $key) {
        $candidate = trim((string)($cfg[$key] ?? ''));
        if (filter_var($candidate, FILTER_VALIDATE_EMAIL)
            && preg_match('/@(?:www\.)?sporta\.com\.kw$/i', $candidate)
            && !preg_match('/[\r\n]/', $candidate)) {
            return $candidate;
        }
    }
    return '';
}

function store_send_admin_mail(array $cfg, string $to, string $subject, string $text, string $html, string $senderName = 'Sporta Backends'): bool {
    $from = trim((string)($cfg['mail_from'] ?? ''));
    // A legacy config may omit mail_reply_to or leave it blank. Use the
    // authenticated sender in that case; an empty Reply-To makes msmtp reject
    // an otherwise valid reset message. Explicit values are still validated
    // below, so this never permits an external or header-injected address.
    $replyTo = trim((string)($cfg['mail_reply_to'] ?? '')) ?: $from;
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)
        || !filter_var($from, FILTER_VALIDATE_EMAIL)
        || !filter_var($replyTo, FILTER_VALIDATE_EMAIL)
        || !preg_match('/@(?:www\.)?sporta\.com\.kw$/i', $from)
        || !in_array($senderName, ['Sporta', 'Sporta Backends'], true)
        || preg_match('/[\r\n]/', $to . $from . $replyTo)) {
        return false;
    }
    $boundary = 'sp' . bin2hex(random_bytes(12));
    $headers = implode("\r\n", [
        'From: ' . $senderName . ' <' . $from . '>',
        'Reply-To: ' . $replyTo,
        'MIME-Version: 1.0',
        "Content-Type: multipart/alternative; boundary=\"{$boundary}\"",
    ]);
    $body = "--{$boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{$text}\r\n"
          . "--{$boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n{$html}\r\n--{$boundary}--";
    $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    return mail($to, $encSubject, $body, $headers, '-f' . $from);
}

// ------------------------------------------------------------------ validation
// The checkout helpers, same names as the Postgres functions they replace, same
// error tokens, same limits.

const STORE_GOVERNORATES = ['capital', 'hawalli', 'farwaniya', 'mubarak-al-kabeer', 'ahmadi', 'jahra'];
const STORE_SIZES        = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE'];
const STORE_FITS         = ['normal', 'slim', 'loose', 'oversize', 'boxy', 'tank'];
const STORE_PAY_METHODS  = ['knet', 'tpay', 'cod'];
// The methods a CUSTOMER can choose at checkout. T-Pay was retired as a customer method on 2026-11-03 (owner: one
// KNET setup with both connections, then T-Pay removed): new orders are knet or cod only. 'tpay' stays in
// STORE_PAY_METHODS so the orders already placed with it, their callbacks and their retries still validate.
const STORE_CUSTOMER_PAY_METHODS = ['knet', 'cod'];

// DELIVERY IS 1 KWD, FLAT, EVERY GOVERNORATE, EVERY PAYMENT METHOD.
//
// In FILS, like every other amount in this file: KWD has exactly three decimal
// places, so 1.000 KWD is 1000 fils and integer arithmetic is exact. A float
// here would be a rounding error in the total the bank charges.
//
// It is added AFTER the discount, and that ordering is the policy: a discount
// is a reduction on the goods, not on the courier, so a 60% code takes 60% off
// the shirt and never a fil off the delivery. It also means an order can never
// total zero — the fee is always payable — which is why the zero check below
// looks at the GOODS, not at the amount the customer pays.
//
// The shop used to deliver free and said so in six places; the fee arrived
// with the change of policy, and everything that quotes a total — the
// checkout, the invoice, the warehouse email's COLLECT CASH line, and the
// Product structured data Google reads — has to agree with this one number.
const STORE_DELIVERY_FEE_FILS = 1000;

// What a review is worth. Percent off one later order, single use, 90 days.
//
// It sits here beside the delivery fee because it is the same kind of number:
// a business decision the code must not scatter. Set it to 0 and the shop asks
// for reviews without offering anything, which is the only change needed to
// turn the reward off.
//
// Well under STORE_DISCOUNT_MAX_PCT (60), so a review code still stacks with a
// live promotion instead of colliding with the cap and quietly shrinking.
const STORE_REVIEW_REWARD_PCT = 20;

// Arabic-Indic and Extended digits to ASCII — an Arabic keyboard types ٤ for 4,
// and a phone field that rejects half the country's keyboards is broken.
function store_ascii_digits(string $s): string {
    return strtr($s, [
        '٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9',
        '۰'=>'0','۱'=>'1','۲'=>'2','۳'=>'3','۴'=>'4','۵'=>'5','۶'=>'6','۷'=>'7','۸'=>'8','۹'=>'9',
    ]);
}

// A Kuwaiti mobile: 8 digits starting 5, 6 or 9, with 965 prefixes tolerated.
// Returns the 965-prefixed canonical form or null — same as normalise_kw_phone.
function store_phone(mixed $raw): ?string {
    if (!is_string($raw)) return null;
    $d = preg_replace('/\D/', '', store_ascii_digits($raw));
    if (str_starts_with($d, '00965')) $d = substr($d, 5);
    elseif (strlen($d) > 8 && str_starts_with($d, '965')) $d = substr($d, 3);
    if (!preg_match('/^[569]\d{7}$/', $d)) return null;
    return '965' . $d;
}

// checkout_text: trim, strip control characters, enforce length — raising the
// same missing_/too_long_ tokens the SQL raises so messages translate.
function store_input_string(mixed $value, string $field, int $maxBytes = 4096): string {
    if ($value === null) return '';
    if (!is_string($value)) store_fail("invalid_{$field}");
    if (strlen($value) > $maxBytes) store_fail("too_long_{$field}");
    return $value;
}

function store_text(mixed $v, string $field, int $min, int $max): string {
    $t = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', store_input_string($v, $field)) ?? '');
    if (mb_strlen($t) < $min) store_fail("missing_{$field}");
    if (mb_strlen($t) > $max) store_fail("too_long_{$field}");
    return $t;
}

function store_checkout_optional(mixed $value, string $field, int $max): ?string {
    $text = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', store_input_string($value, $field)) ?? '');
    if (mb_strlen($text) > $max) store_fail("too_long_{$field}");
    return $text === '' ? null : $text;
}

function store_product_money(mixed $value, string $field): string {
    if (!is_string($value) && !is_int($value) && !is_float($value)) store_fail("invalid_{$field}");
    $text = (string)$value;
    // products.price is DECIMAL(10,3). Do not round an extra decimal place,
    // accept an exponent, or turn a JSON array/bool into an accidental price.
    if (!preg_match('/^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,3})?$/D', $text)
        || (float)$text <= 0) store_fail("invalid_{$field}");
    return number_format((float)$text, 3, '.', '');
}

function store_opt(mixed $v): ?string {
    $t = trim(store_input_string($v, 'text'));
    return $t === '' ? null : mb_substr($t, 0, 280);
}

// ------------------------------------------------------------------ outbox

// The fulfilment snapshot, identical in shape to fulfilment_payload() in
// the Postgres trigger it replaces — render.mjs and the email tests already
// define what the warehouse reads, and this must produce the same document.
function store_fulfilment_payload(PDO $db, int $orderId): array {
    $o = $db->prepare('select * from orders where id = ?');
    $o->execute([$orderId]);
    $ord = $o->fetch();
    $it = $db->prepare(
        // The snapshot first, the catalogue as fallback — same rule as the
        // invoice. The warehouse message is usually sent within minutes, so a
        // rename rarely reaches it; but the outbox retries for days when mail
        // is failing, and a picker should be handed the name that is on the
        // customer's invoice rather than whatever the product is called by the
        // time the message finally goes out.
        'select coalesce(oi.name_en, p.name_en) as name_en,
                coalesce(oi.name_ar, p.name_ar) as name_ar,
                p.slug as sku, oi.qty, oi.size, oi.fit
           from order_items oi join products p on p.id = oi.product_id
          where oi.order_id = ? order by 1, oi.size'
    );
    $it->execute([$orderId]);
    return [
        'track_id'       => $ord['track_id'],
        'placed_at'      => $ord['created_at'],
        'amount_kwd'     => (float)$ord['amount'],
        'payment_method' => $ord['payment_method'],
        'payment_status' => $ord['payment_status'],
        'collect_cash'   => $ord['payment_method'] === 'cod' && $ord['payment_status'] !== 'paid',
        'customer'       => ['name' => $ord['customer_name'], 'phone' => $ord['customer_phone']],
        'address'        => [
            'governorate' => $ord['customer_governorate'],
            'area'        => $ord['customer_area'],
            'block'       => $ord['customer_block'],
            'street'      => $ord['customer_street'],
            'building'    => $ord['customer_building'],
            'floor'       => $ord['customer_floor'],
            'flat'        => $ord['customer_flat'],
            'note'        => $ord['customer_note'],
        ],
        'items'          => $it->fetchAll(),
    ];
}

function store_queue_fulfilment(PDO $db, int $orderId, string $kind): void {
    // One 'new' message per order, enforced by the unique index — a retry
    // cannot produce two picking lists. INSERT IGNORE is MySQL's on-conflict-
    // do-nothing.
    $payload = json_encode(store_fulfilment_payload($db, $orderId), JSON_UNESCAPED_UNICODE);
    if ($kind === 'new') {
        $db->prepare('insert ignore into fulfilment_outbox (order_id, kind, payload) values (?, ?, ?)')
           ->execute([$orderId, $kind, $payload]);
    } else {
        $db->prepare('insert into fulfilment_outbox (order_id, kind, payload) values (?, ?, ?)')
           ->execute([$orderId, $kind, $payload]);
    }
}

// ---------------------------------------------------------------- order tracking
// A customer sees the same fulfilment states as the warehouse, but never the
// internal note or operator identity. The table is additive: until its one
// migration is imported, tracking still works and falls back to the order's
// original/current timestamps.
function store_tracking_event(PDO $db, int $orderId, string $status): void {
    try {
        $db->prepare('insert into order_tracking_events (order_id, status) values (?, ?)')
           ->execute([$orderId, $status]);
    } catch (PDOException $e) {
        // Existing installations can receive the new PHP before the small
        // additive SQL file. Do not turn a fulfilment update into a 500; the
        // public endpoint synthesises the current state in that short gap.
        if ((int)($e->errorInfo[1] ?? 0) !== 1146) throw $e;
    }
}

function store_tracking_events(PDO $db, array $order): array {
    $events = [[
        'status' => 'unfulfilled',
        'occurred_at' => $order['created_at'] ?? null,
    ]];
    try {
        $q = $db->prepare('select status, created_at as occurred_at
                             from order_tracking_events
                            where order_id = ? order by id asc limit 20');
        $q->execute([(int)$order['id']]);
        foreach ($q->fetchAll() as $event) {
            $events[] = ['status' => (string)$event['status'], 'occurred_at' => $event['occurred_at']];
        }
    } catch (PDOException $e) {
        if ((int)($e->errorInfo[1] ?? 0) !== 1146) throw $e;
    }

    // A historical delivered order predates the event table. It should still
    // show a useful delivery time rather than an unexplained blank step.
    $current = (string)($order['fulfilment_status'] ?? 'unfulfilled');
    $seen = array_column($events, 'status');
    if (!in_array($current, $seen, true)) {
        $events[] = [
            'status' => $current,
            'occurred_at' => $current === 'delivered'
                ? ($order['fulfilled_at'] ?? null)
                : null,
        ];
    }
    return $events;
}

// ---------------------------------------------------------------- WhatsApp
// Queue one message to the CUSTOMER. See whatsapp.mysql.sql for why this is a
// separate queue from the warehouse's and fires at a different moment.
//
// It writes a row and nothing else — no HTTP call happens here. A checkout
// that waits on graph.facebook.com is a checkout that fails when Meta is slow,
// and the customer is standing at the bank's payment page while it does. The
// row is written in the caller's transaction so the message cannot go missing;
// cron-whatsapp.php delivers it.
function store_queue_whatsapp(PDO $db, int $orderId, string $kind): void {
    $cfg = store_config();
    // NO CREDENTIALS, NO QUEUE. Rows nobody can ever send are not a queue, they
    // are a table that grows until someone asks why. The same fail-closed rule
    // the n8n handoff follows: configure it or it does not run.
    if (($cfg['whatsapp_token'] ?? '') === '' || ($cfg['whatsapp_phone_number_id'] ?? '') === '') return;

    $q = $db->prepare('select track_id, customer_phone, customer_name, customer_lang, amount
                         from orders where id = ?');
    $q->execute([$orderId]);
    $o = $q->fetch();
    if (!$o) return;

    $to = store_wa_e164((string)($o['customer_phone'] ?? ''));
    // A cash order taken over the phone may have no usable number. Silently
    // skipping is right — there is no message to send and nothing is wrong.
    if ($to === null) return;

    // The customer's own language, defaulting to Arabic. See the column note.
    $lang = ($o['customer_lang'] ?? '') === 'en' ? 'en' : 'ar';
    $tplKey = match ($kind) {
        'shipped' => 'whatsapp_template_shipped',
        'review'  => 'whatsapp_template_review',
        default   => 'whatsapp_template_confirmed',
    };
    $template = (string)($cfg[$tplKey] ?? '');
    if ($template === '') return;   // template not configured: nothing to send

    // The variables the template's {{1}}, {{2}} … will be filled with, in
    // order. Stored rather than computed at send time so the message says what
    // the order said WHEN IT HAPPENED, even if the order is edited later.
    $vars = [
        'name'     => (string)($o['customer_name'] ?? ''),
        'track_id' => (string)($o['track_id'] ?? ''),
        'amount'   => number_format((float)$o['amount'], 3, '.', ''),
    ];
    // The review invitation carries the SIGNED link, computed here and stored
    // with the message. Computing it at send time instead would be one more
    // place the signature is built, and the two would drift the first time the
    // key rotated — leaving a queue of messages nobody could open.
    //
    // A path, not a full URL: the template's button already carries the
    // domain, and it is also the shape store_internal_href allows.
    if ($kind === 'review') {
        $vars['review_path'] = '/review?o=' . rawurlencode($vars['track_id'])
                             . '&t=' . store_review_sig($vars['track_id']);
    }
    $payload = json_encode($vars, JSON_UNESCAPED_UNICODE);

    // insert ignore: the unique index is what guarantees one message per order
    // per kind, and KNET's callback legitimately fires more than once.
    $db->prepare('insert ignore into whatsapp_outbox (order_id, kind, to_e164, template, lang, payload)
                  values (?, ?, ?, ?, ?, ?)')
       ->execute([$orderId, $kind, $to, $template, $lang, $payload]);
}

// ------------------------------------------------------- lock order and retry
//
// RACE K1-1/2/3/4 (deadlocks). InnoDB aborts one of two transactions that wait
// for each other's rows, with error 1213 (SQLSTATE 40001). Two checkouts whose
// carts name the same two sizes in opposite order, two automatic discount rules
// ranked differently by two carts, a reinstate taking the variant before the
// discount while a checkout takes the discount before the variant, a release
// that visits the rows in product-id order while a checkout visits them in cart
// order: each is a cycle, the victim answered 500 and the shopper started over
// (measured: 19 of 160 orders at natural speed, 16 at once).
//
// So there is ONE order in which this shop takes shared rows, everywhere:
//   1. discount rows, by id           (store_discounts_claim, _release, reclaim)
//   2. variant rows, by (slug, size)  (store_stock_claim, store_stock_release)
// and a transaction that still loses a wait (1213, the 1020 below, or the 1205
// lock-wait timeout) is run again, up to STORE_TX_ATTEMPTS times in all. Only a
// transaction that ROLLED BACK is ever re-run, from its first statement, so no
// step is repeated: the order insert, the claims and the outbox row are all
// inside it and go together.
//
// RACE K1-12 (found in the independent review): ERROR 1020, "Record has changed
// since last read in table ...". The VPS runs MariaDB 11.8, where
// innodb_snapshot_isolation is ON by default (since 11.6.2): in REPEATABLE READ
// a transaction that updates or locks a row another transaction COMMITTED after
// its read view was taken no longer carries on with the newer row, it fails with
// 1020 (SQLSTATE HY000) and stays open. A checkout takes its read view at its
// first plain SELECT (the idempotency lookup) and its stock claim then meets
// rows that other checkouts committed in the meantime, so two shoppers buying
// the same size within a few milliseconds of each other lose one order to a 500
// WITH NO DEADLOCK AT ALL. Measured on MariaDB 10.11 with the switch ON: 56 to 77
// of 160 concurrent orders answered 500, on the unpatched tree and on this patch
// without the 1020 line; with it and 8 attempts, 0 of 160. The failed
// transaction is rolled back completely, a fresh attempt takes a fresh read
// view, so it is re-run exactly like a deadlock victim. (The sweeper and the
// admin reinstate can meet the same error; a sweeper failure is contained to its
// order and retried at the next run, an admin sees the failure and clicks again.)
const STORE_TX_ATTEMPTS = 8;
// A lock-wait timeout (1205) is retried only while the request is younger than
// this many seconds: the database's own wait is 50 s on the VPS, and a customer
// must never be made to sit through two of them. A deadlock (1213) and a 1020
// come back at once and are always retried, within the attempt cap.
const STORE_TX_BUDGET_SECONDS = 15;

function store_variant_cmp(array $a, array $b): int {
    return strcmp((string)$a['slug'], (string)$b['slug']) ?: strcmp((string)($a['size'] ?? ''), (string)($b['size'] ?? ''));
}

function store_tx_retryable(Throwable $e, float $startedAt): bool {
    if (!($e instanceof PDOException)) return false;
    $code = (int)($e->errorInfo[1] ?? 0);
    if ($code === 1213 || $code === 1020 || (string)$e->getCode() === '40001') return true;
    return $code === 1205 && (microtime(true) - $startedAt) < STORE_TX_BUDGET_SECONDS;
}

// A short, growing, jittered pause before the next attempt, so the two
// transactions that just collided do not collide again in step. The growth stops
// at the fourth attempt: eight attempts then wait about 1.2 s in all, on average.
function store_tx_backoff(int $attempt): void {
    usleep(random_int(20, 90) * 1000 * min(4, max(1, $attempt)));
}

// ------------------------------------------------- cash-on-delivery abuse
//
// How many UNDELIVERED cash orders one phone may have at once. See
// antifraud.mysql.sql for why this exists at all; the number is a judgement:
// high enough that a real person ordering twice in a day never meets it, low
// enough that one number cannot send a courier out a hundred times.
//
// It counts orders still IN FLIGHT, never orders already delivered — so a
// customer who has bought ten times and received them all is not throttled at
// all. A rule that punishes the shop's best customers is a rule the owner
// switches off, and then there is no rule.
const STORE_COD_OPEN_MAX = 3;

// Serialize a phone's COD cap check and insertion on this database. Advisory
// locks work before a customer has any rows, unlike SELECT ... FOR UPDATE on
// a row which may not exist. The connection is nonpersistent, so a fatal/exit
// also releases the lock; shutdown covers normal validation exits explicitly.
function store_cod_lock(PDO $db, string $phone): string {
    $database = (string)$db->query('select database()')->fetchColumn();
    $name = 'sporta:cod:' . substr(hash('sha256', $database . ':' . $phone), 0, 50);
    $q = $db->prepare('select get_lock(?, 10)');
    $q->execute([$name]);
    if ((int)$q->fetchColumn() !== 1) throw new RuntimeException('COD checkout lock unavailable');
    register_shutdown_function(static function () use ($db, $name): void {
        store_cod_unlock($db, $name);
    });
    return $name;
}

function store_cod_unlock(PDO $db, string $name): void {
    try {
        $q = $db->prepare('select release_lock(?)');
        $q->execute([$name]);
    } catch (Throwable $e) {
        // Closing this nonpersistent connection releases it even if the
        // server is briefly unavailable. Never replace an order's outcome.
        error_log('Sporta COD lock release failed');
    }
}

// The one place an order is judged before it is written. Return a refusal to
// the caller so it can roll back its open transaction and release the COD lock
// before sending the error response.
//
// COD ONLY for the cap, deliberately. A card order that turns out to be fake
// costs the shop nothing — the bank never settled it, nothing shipped. Cash on
// delivery is the only method that spends money before anyone has paid, so it
// is the only one worth guarding. Rate-limiting real prepaid customers would be
// all cost and no benefit.
function store_order_guard(PDO $db, string $phone, string $method): ?array {
    // 1. The blocklist. A human decision, so it outranks everything else.
    $q = $db->prepare('select scope from blocked_customers where phone = ?');
    $q->execute([$phone]);
    $scope = $q->fetchColumn();
    if ($scope === 'all') return ['customer_blocked', 403];
    if ($scope === 'cod' && $method === 'cod') return ['cod_blocked', 403];

    if ($method !== 'cod') return null;

    // 2. The automatic cap on orders still in flight.
    //
    // 'pending' AND not delivered/cancelled is the definition of "the shop is
    // still owed money and still holds the goods". A COD order marked paid has
    // been collected; one marked delivered is finished; one cancelled is
    // closed. None of those should count against the next purchase.
    $q = $db->prepare(
        "select count(*) from orders
          where customer_phone = ? and payment_method = 'cod'
            and payment_status = 'pending'
            and fulfilment_status not in ('delivered', 'cancelled')"
    );
    $q->execute([$phone]);
    if ((int) $q->fetchColumn() >= STORE_COD_OPEN_MAX) {
        // 409, not 429: this is not "too fast", it is "settle what you have".
        // A shopper who reads the message can act on it; a rate-limit message
        // would tell them to wait, which will never help.
        return ['too_many_open_cod', 409];
    }
    return null;
}

// ------------------------------------------------------ one order a minute
//
// The owner, 2026-11-02: "make submit order one hit, then close for one minute
// after the hit". Once an order is ACCEPTED, the same client — its address,
// an IPv6 client by its /64 (store_client_identity) — and the same phone
// number are refused a NEW order for order_cooldown_seconds (default 60).
//
// Why: every accepted order reserves stock, claims discount uses and queues a
// message to the warehouse BEFORE payment (FULFILMENT.md). The route limit
// (20 in ten minutes) bounds a flood; this bounds the next order after a real
// one, which is where a double submit with a fresh attempt, a script, and a
// shopper tapping "place order" on two devices all land.
//
// What it is NOT:
//   * a block on a retry of the SAME attempt. The track id is the idempotency
//     key and is answered before this runs (and again under the lock below),
//     so a double tap or a bank-page retry gets its own order back, never 429.
//   * a block after a DECLINED card. A cooldown row remembers which order
//     started it, and an order the bank failed (payment_status 'failed') or
//     the shop cancelled does not hold the door shut: the shopper who tries a
//     second card straight away must not be told to wait.
//
// The refusal is 429 + Retry-After with the token previous_order_pending —
// the one the LIVE storefront already words, in both languages, as "An earlier
// attempt may already have created an order. Track it before starting
// another, so we do not reserve the same items twice." (measured in its
// bundle, 2026-11-02). too_many_attempts would have fallen through to its
// generic "We could not start the payment. Please try again."
//
// SLIDING, not a fixed window. Every other rate_limit user counts in aligned
// windows, where an order at :59 and the next at :01 are two windows. This
// row instead stores the accepted order's own second as window_start and the
// order's id as hits — no new table, no migration, and the two-day sweep in
// sporta_rate_limit_hit() clears it like any other row.
//
// 'order_cooldown_seconds' => 0 switches it off. The test sandbox does: the
// suites place orders back to back from one address. test:order-cooldown
// proves it on a store of its own.
const STORE_ORDER_COOLDOWN_SECONDS = 60;

function store_order_cooldown_seconds(): int {
    $v = store_config()['order_cooldown_seconds'] ?? null;
    if ($v === null || $v === '') return STORE_ORDER_COOLDOWN_SECONDS;
    return max(0, min(3600, (int)$v));
}

function store_order_cooldown_key(string $identity): string {
    return store_rate_limit_key('order_cooldown', $identity === '' ? 'unknown' : $identity);
}

// Serialises ONE client's order submissions, so two new orders sent at the
// same moment cannot both read "nothing recent" and both be accepted. Held
// through the commit; MySQL frees it when the connection closes at the latest,
// and the shutdown hook releases it explicitly. False when another submission
// from the same client held it for ten seconds — which is itself an order in
// flight, and the caller refuses.
function store_order_cooldown_lock(PDO $db, string $identity): bool {
    $database = (string)$db->query('select database()')->fetchColumn();
    $name = 'sporta:ocd:' . substr(hash('sha256', $database . ':' . $identity), 0, 50);
    $q = $db->prepare('select get_lock(?, 10)');
    $q->execute([$name]);
    if ((int)$q->fetchColumn() !== 1) return false;
    register_shutdown_function(static function () use ($db, $name): void {
        store_cod_unlock($db, $name);
    });
    return true;
}

// Seconds before this client or this phone may place a NEW order; 0 = now.
function store_order_cooldown_left(PDO $db, string $identity, string $phone, int $cooldown): int {
    if ($cooldown <= 0) return 0;
    $now = time();
    $left = 0;
    // The client: its last accepted order, remembered in rate_limit.
    $q = $db->prepare('select window_start, hits from rate_limit
                        where bucket_key = ? and window_start > ?
                        order by window_start desc limit 1');
    $q->execute([store_order_cooldown_key($identity), $now - $cooldown]);
    if ($row = $q->fetch()) {
        $o = $db->prepare('select payment_status, fulfilment_status from orders where id = ?');
        $o->execute([(int)$row['hits']]);
        $order = $o->fetch();
        // No row: the order was never committed. Failed / cancelled: see above.
        if ($order && $order['payment_status'] !== 'failed' && $order['fulfilment_status'] !== 'cancelled') {
            $left = max($left, (int)$row['window_start'] + $cooldown - $now);
        }
    }
    // The phone: straight from orders, so it holds across addresses (two
    // devices, a phone on Wi-Fi then on 4G) and for orders placed before this
    // existed. Age is computed by the database against its own clock, the
    // clock that wrote created_at.
    $q = $db->prepare("select timestampdiff(second, created_at, now()) from orders
                        where customer_phone = ?
                          and created_at > now() - interval ? second
                          and payment_status <> 'failed'
                          and fulfilment_status <> 'cancelled'
                        order by created_at desc limit 1");
    $q->execute([$phone, $cooldown]);
    $age = $q->fetchColumn();
    if ($age !== false && $age !== null) $left = max($left, $cooldown - max(0, (int)$age));
    return min($cooldown, max(0, $left));
}

// Remember the accepted order. Called INSIDE the order's transaction, so a
// rolled-back order starts no cooldown.
function store_order_cooldown_start(PDO $db, string $identity, int $orderId, int $cooldown): void {
    if ($cooldown <= 0) return;
    $db->prepare('insert into rate_limit (bucket_key, window_start, hits) values (?, ?, ?)
                  on duplicate key update hits = ?')
       ->execute([store_order_cooldown_key($identity), time(), $orderId, $orderId]);
}

// One attribution field off the order payload: trimmed, capped, or null.
//
// Never rejects. Attribution is REPORTING — it decides nothing about what is
// charged, shipped or refunded — so a malformed campaign label must cost the
// customer nothing. An order that failed because an ad platform appended
// something odd to a URL would be a sale lost to a statistic.
//
// Control characters are stripped rather than escaped: these end up in an admin
// table, and a newline in a campaign name is a row that looks broken.
function store_utm($raw, string $field, int $max): ?string {
    if (!is_array($raw)) return null;
    $v = $raw[$field] ?? null;
    if (!is_string($v)) return null;
    $v = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', $v) ?? '');
    if ($v === '') return null;
    return mb_substr($v, 0, $max);
}

// A Kuwaiti number as the Cloud API wants it: digits only, country code, no
// plus. The shop stores eight local digits ("99887766"); Meta will not accept
// that, and a malformed number fails the send with an error that reads like an
// auth problem.
function store_wa_e164(?string $raw): ?string {
    $d = preg_replace('/\D+/', '', (string)$raw);
    if ($d === '') return null;
    // Already carries the country code.
    if (str_starts_with($d, '965') && strlen($d) === 11) return $d;
    // A local Kuwaiti mobile is 8 digits and starts 5, 6 or 9.
    if (strlen($d) === 8 && preg_match('/^[569]/', $d)) return '965' . $d;
    // Anything else — a landline, a foreign number, a typo — is left alone
    // rather than guessed at. A message sent to a number the shop invented is
    // worse than one not sent.
    return null;
}

// Called wherever payment_status reaches a settled state — the admin's
// mark-cash-paid and its card-settled twin. Mirrors trg_queue_fulfilment_payment.
//
// $fulfilment is the order's fulfilment_status AS IT STANDS when the money is
// marked in. The warehouse's 'payment' row for a paid order reads "PAYMENT
// CONFIRMED — ship it", which is an instruction to dispatch. That instruction
// is wrong once the order has left the shop (shipped or delivered: the cash
// was collected on the doorstep and a second van would be a second delivery)
// and wrong for a cancelled order (its garment is back on the shelf and the
// warehouse has been told do not ship). For those the paid MARK is still kept
// — the money was collected and the books must say so — but no ship message
// is queued. Anything else (unfulfilled, packed) gets the message as before.
//
// The customer's WhatsApp "confirmed" is skipped for a cancelled order for the
// same reason: it would tell someone their cancelled order is confirmed.
function store_payment_settled(PDO $db, int $orderId, string $newStatus, string $fulfilment = 'unfulfilled'): void {
    $noShip = in_array($fulfilment, ['shipped', 'delivered', 'cancelled'], true);
    // 'failed' keeps its message whatever the state: a "PAYMENT FAILED — do
    // not ship" is never wrong, and no caller passes it today.
    if ($newStatus === 'failed' || ($newStatus === 'paid' && !$noShip)) {
        store_queue_fulfilment($db, $orderId, 'payment');
    }
    // The customer hears from us only when the money is actually in. 'failed'
    // deliberately sends nothing: a shopper whose card was declined is already
    // looking at the failure on screen, and a WhatsApp message about it would
    // arrive minutes later, out of context, about an order they may have
    // already re-placed successfully.
    if ($newStatus === 'paid' && $fulfilment !== 'cancelled') {
        store_queue_whatsapp($db, $orderId, 'confirmed');
    }
}

// A logo submitted from the admin, as a data: URL.
//
// The shop needs brand logos and the owner has no shell, so they arrive
// through the browser — but nothing here writes a file. The lesson of
// sporta-deploy.php stands: an endpoint that writes files is a way in. The
// image becomes a row instead, and this is the gate it has to pass:
//
//   * png / jpeg / webp ONLY. Never SVG — an SVG is a document that can carry
//     script, and it would be served from our own origin.
//   * the base64 must actually decode, and the DECODED bytes must begin with
//     that format's magic number, so "data:image/png;base64,<some html>" is
//     rejected rather than stored and later served as an image.
//   * a hard size cap. The admin downscales before sending; this is the floor
//     under that, because a client-side limit is a suggestion.
//
// Returns the normalised data URL, or null when there is nothing to store.
// Anything present but invalid fails the request outright — silently dropping
// a logo would look like a save that worked.
const STORE_LOGO_MAX = 160000;   // ~160 kB of base64, ~120 kB of image
// A hero photograph is a different order of magnitude from a brand logo: it
// fills the viewport, and the admin sends it downscaled to 1600px WebP. This
// is the floor under that, not the target. It is NOT inlined into the
// storefront's JSON — r=slide_image serves it as a cacheable image — so the
// size buys quality on the one image the home page is built around.
const STORE_HERO_MAX = 1200000;  // ~1.2 MB of base64, ~900 kB of image

function store_data_image(?string $raw, int $max = STORE_LOGO_MAX): ?string {
    $v = trim((string)$raw);
    if ($v === '') return null;
    if (strlen($v) > $max) store_fail('logo_too_large');
    if (!preg_match('#^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$#', $v, $m)) {
        store_fail('logo_bad_format');
    }
    $bytes = base64_decode(preg_replace('/\s+/', '', $m[2]), true);
    if ($bytes === false || strlen($bytes) < 32) store_fail('logo_bad_format');
    $magic = [
        'png'  => "\x89PNG\r\n\x1a\n",
        'jpeg' => "\xff\xd8\xff",
        'webp' => 'RIFF',
    ][$m[1]];
    if (!str_starts_with($bytes, $magic)) store_fail('logo_not_an_image');
    // webp carries RIFF....WEBP; check the second marker too.
    if ($m[1] === 'webp' && substr($bytes, 8, 4) !== 'WEBP') store_fail('logo_not_an_image');
    return 'data:image/' . $m[1] . ';base64,' . preg_replace('/\s+/', '', $m[2]);
}

// A brand slug: what the storefront will filter on, so it is url-safe or it is
// nothing. Derived from the English name when the admin does not supply one.
function store_slug(string $s): string {
    $slug = strtolower(trim($s));
    $slug = preg_replace('/[^a-z0-9]+/', '-', $slug);
    return trim((string)$slug, '-');
}

// ------------------------------------------------------------- guessing guard
//
// A public endpoint that answers "is this code real?" is an oracle, and an
// unthrottled oracle is a code generator. `?r=discount` is exactly that: no
// session, an unlimited number of tries, and a different answer for a code
// that exists. A script can walk SAVE10, SAVE15, SAVE20 … in seconds and find
// every live discount the shop has.
//
// The throttle is deliberately cheap and stateless-ish: a hashed counter in
// the same MySQL the request is already talking to, in a fixed window. No new
// table, no cache server, no per-request file writes — this runs on shared
// hosting where none of those exist. Most callers use the client (an IPv4
// address, or an IPv6 /64); sign-in, reset mail and phone codes also count a
// separately hashed, normalised ACCOUNT identity, so rotating addresses cannot
// turn one account into a target.
//
// It counts only FAILED lookups. A customer with a real code who re-checks
// their basket four times is not attacking anything, and throttling them would
// break the feature to protect it.
//
// The client, and how a counter keys on it, are ONE implementation shared with
// both payment gateways: see config-path.php. These names stay because the
// rest of the store calls them.
function store_normalize_ip(mixed $value): string {
    return sporta_normalize_ip($value);
}

function store_trusted_proxy_rules(): array {
    return sporta_trusted_proxy_rules(store_config()['trusted_proxy_ips'] ?? []);
}

// The client's own address (see sporta_client_ip for how a forwarded chain is
// walked). Use it for what is RECORDED; per-client counters key on
// store_rate_identity(store_client_ip()) instead.
function store_client_ip(): string {
    return sporta_client_ip(store_trusted_proxy_rules());
}

// What a per-client counter is keyed on: an IPv4 address as it is, an IPv6
// client by its /64. See sporta_rate_identity.
function store_rate_identity(string $ip): string {
    return sporta_rate_identity($ip);
}

function store_client_identity(): string {
    return store_rate_identity(store_client_ip());
}

function store_rate_limit_key(string $bucket, string $identity): string {
    $cfg = store_config();
    // Without rate_limit_secret the key derives from the server-only DB
    // credentials, so existing installations need no emergency config change;
    // the actual value is never stored or returned.
    return sporta_rate_limit_key($bucket, $identity, (string)($cfg['rate_limit_secret'] ?? ''), [
        (string)($cfg['db_name'] ?? ''),
        (string)($cfg['db_user'] ?? ''),
        (string)($cfg['db_pass'] ?? ''),
    ]);
}

/** @return array{allowed:bool,hits:int,retry_after:int,key:string,window_start:int} */
function store_rate_limit_hit(PDO $db, string $bucket, string $identity, int $max, int $windowSec): array {
    return sporta_rate_limit_hit($db, store_rate_limit_key($bucket, $identity === '' ? 'unknown' : $identity),
        $max, $windowSec);
}

function store_rate_limit_clear(PDO $db, string $bucket, string $identity): void {
    $db->prepare('delete from rate_limit where bucket_key = ?')
       ->execute([store_rate_limit_key($bucket, $identity === '' ? 'unknown' : $identity)]);
}

// GIVE ONE HIT BACK, for a counter that must COUNT FIRST but should only keep
// failures (a coupon lookup, a phone code, a password check).
//
// Peeking first and counting only after a failure is check-then-act: every
// request of a burst reads "under the limit" before any failure is written,
// so the bound grows with the server's worker count (measured: 40 wrong
// coupon codes evaluated against a limit of 30, with 16 workers). Counting
// first makes the bound exact; taking the hit back once the request turns out
// to have succeeded keeps successes free. Same row the hit wrote (its key and
// its window), guarded so it can never go below zero — and a window that has
// rolled over in between simply has nothing to give back.
function store_rate_limit_refund(PDO $db, array $state): void {
    if (!is_string($state['key'] ?? null) || $state['key'] === '') return;
    $db->prepare('update rate_limit set hits = hits - 1
                   where bucket_key = ? and window_start = ? and hits > 0')
       ->execute([$state['key'], (int)($state['window_start'] ?? 0)]);
}

function store_rate_limit_fail(int $retryAfter, string $token = 'too_many_attempts'): never {
    $retryAfter = max(1, $retryAfter);
    header('Retry-After: ' . $retryAfter);
    store_out(['error' => $token, 'retry_after' => $retryAfter], 429);
}

function store_throttle(PDO $db, string $bucket, int $max, int $windowSec): void {
    $state = store_rate_limit_hit($db, $bucket, store_client_identity(), $max, $windowSec);
    if (!$state['allowed']) store_rate_limit_fail($state['retry_after']);
}

// TRUE FOR EXACTLY ONE CALLER per bucket, identity and window — the claim is
// one INSERT IGNORE, so two simultaneous requests cannot both win it. Used for
// "say this once" side effects (an alert mail), where reading a counter back
// after incrementing it is not enough: two concurrent requests can both read
// the value AFTER the other's increment, and the one value that was supposed
// to trigger the mail is then seen by nobody.
function store_rate_limit_once(PDO $db, string $bucket, string $identity, int $windowSec): bool {
    $windowSec = max(1, $windowSec);
    $now = time();
    $q = $db->prepare('insert ignore into rate_limit (bucket_key, window_start, hits) values (?, ?, 1)');
    $q->execute([store_rate_limit_key($bucket, $identity === '' ? 'unknown' : $identity),
                 $now - ($now % $windowSec)]);
    return $q->rowCount() === 1;
}

// ------------------------------------------------------------------ admin auth

// Is this request really over HTTPS?
//
// Hostinger terminates TLS at a proxy, so PHP sees a PLAIN HTTP request even
// when the browser is on https:// — $_SERVER['HTTPS'] is empty and
// SERVER_PORT is 80. The payment endpoints have always known this
// (knet_require_https, cbk_require_https); the admin session did not, and the
// consequence was worse than a wrong answer: the session cookie was issued
// WITHOUT the Secure flag on the live site, so any request that ever left over
// plain HTTP would carry the admin session with it in clear text.
//
// Same three signals the gateways use, and for the same reason.
function store_is_https(): bool {
    return (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
        || ((string) ($_SERVER['SERVER_PORT'] ?? '') === '443')
        || (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https');
}

// How long a signed-in admin stays signed in, enforced on the SERVER.
//
// The owner, 2026-11-02: "make long time backends login" — and of the
// lengths offered, "30 days". So a browser that signed in stays signed in
// for 30 days (absolute), and 7 days without use signs it out (idle): long
// enough that the owner is not asked for a password and a code every
// morning, short enough that a laptop left in a drawer does not hold the shop
// open for a month. Sign-out, a password reset and a change to the
// authenticator still end every session at once (the fingerprint below).
//
// Until now the coded 8 hours idle was not what anyone got. The live PHP
// keeps session FILES for session.gc_maxlifetime = 1440 s (24 minutes, the
// php.ini default — the image loads no php.ini) and sweeps on 1 request in
// 100, in a save path every PHP session on the server shares. So an admin
// idle for half an hour was signed out by a sweep somebody else's request
// ran, whatever these constants said. store_session_start() now gives the
// admin session its own directory and a garbage-collection lifetime as long
// as the absolute one — see store_admin_session_dir().
const STORE_ADMIN_IDLE_SECONDS     = 7 * 86400;
const STORE_ADMIN_ABSOLUTE_SECONDS = 30 * 86400;

// Where admin session files live: a directory of their OWN, above the web
// root, that no other session shares — because PHP's sweep deletes every file
// in its save path older than the lifetime of whichever request ran it, and a
// customer's or a scanner's 24-minute lifetime would otherwise delete a
// 30-day admin session. In order:
//   1. 'admin_session_dir' in api/config.php, when set;
//   2. /var/lib/sporta/admin-sessions — the VPS's persistent private mount
//      (/docker/sporta/private/voice), already www-data's and already where
//      the payment logs live, and it survives the container being rebuilt;
//   3. sporta-admin-sessions in the account home, above public_html — the
//      shared-hosting layout (api/ is public_html/api, so two levels up);
//   4. sporta-admin-sessions in the system temp directory.
// Each is created 0700 when missing and used only if it is a writable
// directory that is not inside the web root. None usable: PHP's default,
// i.e. what it did before.
function store_admin_session_dir(): ?string {
    static $dir = false;
    if ($dir !== false) return $dir;
    $cfg = trim((string)(store_config()['admin_session_dir'] ?? ''));
    $docroot = realpath((string)($_SERVER['DOCUMENT_ROOT'] ?? '')) ?: null;
    $candidates = array_values(array_filter([
        $cfg !== '' ? $cfg : null,
        is_dir('/var/lib/sporta') ? '/var/lib/sporta/admin-sessions' : null,
        dirname(__DIR__, 2) . '/sporta-admin-sessions',
        rtrim(sys_get_temp_dir(), '/') . '/sporta-admin-sessions',
    ]));
    foreach ($candidates as $c) {
        if (!is_dir($c)) @mkdir($c, 0700, true);
        $real = realpath($c);
        if ($real === false || !is_dir($real) || !is_writable($real)) continue;
        // Never a directory the web server would SERVE: a session file is a
        // bearer credential.
        if ($docroot !== null && ($real === $docroot || str_starts_with($real . '/', rtrim($docroot, '/') . '/'))) continue;
        return $dir = $real;
    }
    return $dir = null;
}

// What PHP's session settings were BEFORE this file touched them: the host's
// default save path and sweep lifetime. store_session_configure() points the
// admin session at its own directory and a 30-day lifetime with ini_set(), and
// ini_set() lasts for the rest of the request. Anything else that opens a
// session in the same request (the Google sign-in flow session) must not
// inherit that: its files would land in the admin directory, where the
// callback request — which never configures the admin session — cannot find
// them, and a sweep run with the host's short lifetime over the admin directory
// would delete admin sessions. Captured on first use, i.e. before the first
// ini_set below.
function store_session_host_defaults(): array {
    static $d = null;
    if ($d === null) {
        $d = ['save_path' => (string)ini_get('session.save_path'),
              'gc_maxlifetime' => (string)ini_get('session.gc_maxlifetime')];
    }
    return $d;
}

// Everything about the admin session EXCEPT opening it.
function store_session_configure(): void {
    store_session_host_defaults();
    // Reject attacker-supplied session ids, use cookies only, and never leak
    // an id through a URL. Regeneration after login remains the privilege
    // boundary; these settings make the pre-login side strict as well.
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    // Its own directory, and a sweep that cannot end it early: see
    // STORE_ADMIN_ABSOLUTE_SECONDS and store_admin_session_dir(). The sweep in
    // THIS directory only ever runs with this lifetime, so a file is deleted
    // only once it is older than any session it could still hold.
    $sessionDir = store_admin_session_dir();
    if ($sessionDir !== null) ini_set('session.save_path', $sessionDir);
    ini_set('session.gc_maxlifetime', (string)STORE_ADMIN_ABSOLUTE_SECONDS);
    // See store_is_https(): reading $_SERVER['HTTPS'] alone left this false on
    // the live server, behind Hostinger's TLS proxy.
    $secure = store_is_https();
    // __Host- is a promise the BROWSER enforces, and it is free: a cookie with
    // that prefix is only accepted when it is Secure, Path=/ and carries no
    // Domain — which this one already is. What it buys is that no other host
    // can write it. Without the prefix, anything able to set a cookie for a
    // sibling or parent name (a subdomain on the same account, a plain-HTTP
    // page on this one) can plant a session id that this site would then read
    // back as its own. With it, the cookie belongs to exactly this origin.
    //
    // Only over HTTPS, because a browser must REJECT a __Host- cookie that is
    // not Secure — using the prefix on http would lock the admin out of a
    // local or half-configured server entirely.
    session_name($secure ? '__Host-sporta_admin' : 'sporta_admin');
    session_set_cookie_params([
        // A PERSISTENT cookie, for as long as the session may live: a session
        // cookie closed with the browser, which on a phone is every time the
        // tab is swept away. It is set when the session is created and again
        // when sign-in regenerates the id, so it runs out 30 days after
        // signing in — the same moment the server's absolute expiry does.
        'lifetime' => STORE_ADMIN_ABSOLUTE_SECONDS,
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,         // no script access — this cookie IS the admin
        'samesite' => 'Strict',     // the CSRF defence: no cross-site request carries it
    ]);
}

// Opens the admin session, CREATING one if the request has none. Only the
// places that must make a session call this: sign-in (the granted session, the
// pending-2FA and pending-password-change ones) and the routes that run
// signed in. Anything that merely LOOKS for a session uses
// store_session_resume(): a session file lives 30 days here, so one made for
// every anonymous request (a scanner on ?r=me, ?r=anything, 240 a minute per
// address) would be ~345,000 inodes a day in a host directory the payment logs
// and the voice cache share, none of them swept before the month is out.
function store_session_start(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    store_session_configure();
    session_start();
}

// Opens the admin session ONLY if the request really carries one; true when a
// session is open afterwards. No cookie: nothing is started, no file is made,
// no Set-Cookie is sent. A cookie that names no stored session (stale, forged,
// a scanner sending junk) would make session_start() mint a new id and a new
// file under strict mode, so that case is detected by what comes back — an
// EMPTY session was just created and is ended again, which deletes its file
// and expires the cookie. A session that holds anything (signed in, pending
// 2FA, pending password change, a set-up in progress) stays open.
//
// Asked once per request: after a "nothing there" answer the same question is
// not asked of the same cookie again (?r=me asks three times).
function store_session_resume(): bool {
    if (session_status() === PHP_SESSION_ACTIVE) return true;
    // Set by store_session_end() too, so a session that was found expired and
    // ended is not looked for again under the very cookie that named it.
    if (!empty($GLOBALS['store_session_none'])) return false;
    store_session_configure();
    $sent = $_COOKIE[session_name()] ?? null;
    if (!is_string($sent) || $sent === '') { $GLOBALS['store_session_none'] = true; return false; }
    session_start();
    if (empty($_SESSION)) {
        store_session_end();
        return false;
    }
    return true;
}

// Ends the session and the cookie together. Unsetting $_SESSION alone leaves
// the browser holding an id that still resolves, which is how a "signed out"
// admin turns out not to be.
function store_session_end(): void {
    $GLOBALS['store_session_none'] = true;
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 42000,
            'path'     => $p['path'],
            'secure'   => $p['secure'],
            'httponly' => $p['httponly'],
            'samesite' => $p['samesite'],
        ]);
    }
    if (session_status() === PHP_SESSION_ACTIVE) session_destroy();
}

// Who is signed in, or null — and the ONE place a session's age is judged.
//
// It has to be one place. The first version put the expiry inside
// store_require_admin(), which every data route calls; ?r=me does not, because
// it has to answer before anyone is signed in. So a session nine hours idle
// still answered "signed in", the dashboard rendered, and then every panel on
// it 401'd — an expiry that reported itself as eight broken screens. Both
// callers come through here now.
//
// Expiry is ours rather than PHP's garbage collector's, because that collector
// is shared hosting's to configure: its lifetime is whatever the host set, it
// only runs probabilistically, and it cannot tell an idle session from an old
// one. Two clocks, both ours — idle, and absolute. (The collector is now
// pointed at a directory of our own with a lifetime of our own, so it can no
// longer end a session before these do — see store_session_start().)
function store_admin_fingerprint(array $user): string {
    return hash('sha256', (string)$user['password_hash'] . "\0"
        . (int)($user['totp_enabled'] ?? 0) . "\0"
        . (string)($user['totp_secret'] ?? ''));
}

function store_admin_session_valid(?array $user, string $fingerprint): bool {
    return $user !== null && $fingerprint !== ''
        && (int)($user['must_change_password'] ?? 0) === 0
        && hash_equals(store_admin_fingerprint($user), $fingerprint);
}

// A temporary credential grants only this short-lived change-password step.
// No admin_id is put in the session, so every normal data route stays closed.
function store_pending_password_change(): ?array {
    if (!store_session_resume()) return null;
    $id = (int)($_SESSION['pending_password_change_id'] ?? 0);
    if ($id < 1) return null;
    $since = (int)($_SESSION['pending_password_change_at'] ?? 0);
    $fingerprint = (string)($_SESSION['pending_password_change_hash'] ?? '');
    if ($since < 1 || time() - $since > 900 || $fingerprint === '') {
        store_session_end();
        return null;
    }
    $q = store_db()->prepare(
        'select id, email, password_hash, must_change_password, temporary_password_used_at
           from admin_users where id = ?'
    );
    $q->execute([$id]);
    $user = $q->fetch();
    if (!$user || (int)$user['must_change_password'] !== 1
        || $user['temporary_password_used_at'] === null
        || !hash_equals(hash('sha256', (string)$user['password_hash']), $fingerprint)) {
        store_session_end();
        return null;
    }
    return $user;
}

function store_session_admin(): ?array {
    if (!store_session_resume()) return null;
    if (empty($_SESSION['admin_id'])) return null;
    $now = time();
    $started = (int) ($_SESSION['started_at'] ?? $now);
    $seen    = (int) ($_SESSION['seen_at'] ?? $now);
    if ($now - $seen > STORE_ADMIN_IDLE_SECONDS
        || $now - $started > STORE_ADMIN_ABSOLUTE_SECONDS) {
        store_session_end();
        return null;
    }
    // Resetting a password or removing an account must revoke every existing
    // browser session. Changing a TOTP enrollment revokes old sessions too;
    // otherwise disabling or replacing the phone factor would leave browsers
    // authenticated under the earlier protection level.
    $q = store_db()->prepare('select email, password_hash, totp_enabled, totp_secret, must_change_password from admin_users where id = ?');
    $q->execute([(int)$_SESSION['admin_id']]);
    $user = $q->fetch();
    $fingerprint = (string)($_SESSION['admin_auth_fingerprint'] ?? '');
    if (!store_admin_session_valid($user ?: null, $fingerprint)) {
        store_session_end();
        return null;
    }
    $_SESSION['seen_at'] = $now;
    return ['id' => (int)$_SESSION['admin_id'], 'email' => $user['email']];
}

// Every admin DATA route calls this first. 401, not a redirect: the caller is
// the React admin, and JSON is what it can act on.
function store_require_admin(): array {
    $who = store_session_admin();
    if ($who === null) store_fail('not_signed_in', 401);
    // SameSite=Strict stops the cookie travelling cross-site; this header stops
    // the residual cases (old browsers, subdomain surprises). The React admin
    // always sends it; nothing else has a reason to.
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1') store_fail('bad_request', 400);
    return $who;
}

// The October account used six-digit RFC 6238 TOTP (SHA-1, 30-second steps).
// Keep its existing enrollment usable without putting the secret in a browser
// response. A malformed or absent secret never downgrades an enrolled account
// to password-only login.
function store_totp_generate_secret(): string {
    $bytes = random_bytes(20);
    $bits = '';
    for ($i = 0; $i < strlen($bytes); $i++) {
        $bits .= str_pad(decbin(ord($bytes[$i])), 8, '0', STR_PAD_LEFT);
    }
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $secret = '';
    foreach (str_split($bits, 5) as $chunk) {
        $secret .= $alphabet[bindec(str_pad($chunk, 5, '0', STR_PAD_RIGHT))];
    }
    return $secret;
}

function store_totp_decode(string $secret): string {
    $secret = strtoupper(str_replace(' ', '', $secret));
    if ($secret === '' || !preg_match('/^[A-Z2-7]+$/D', $secret)) return '';
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $bits = '';
    for ($i = 0; $i < strlen($secret); $i++) {
        $bits .= str_pad(decbin((int)strpos($alphabet, $secret[$i])), 5, '0', STR_PAD_LEFT);
    }
    $bytes = '';
    foreach (str_split($bits, 8) as $chunk) {
        if (strlen($chunk) === 8) $bytes .= chr(bindec($chunk));
    }
    return $bytes;
}

function store_totp_hotp(string $key, int $counter): string {
    $binary = '';
    for ($i = 7; $i >= 0; $i--) $binary .= chr(($counter >> ($i * 8)) & 0xff);
    $digest = hash_hmac('sha1', $binary, $key, true);
    $offset = ord($digest[19]) & 0x0f;
    $number = ((ord($digest[$offset]) & 0x7f) << 24)
            | ((ord($digest[$offset + 1]) & 0xff) << 16)
            | ((ord($digest[$offset + 2]) & 0xff) << 8)
            | (ord($digest[$offset + 3]) & 0xff);
    return str_pad((string)($number % 1000000), 6, '0', STR_PAD_LEFT);
}

function store_totp_verify(string $secret, string $code, ?int $at = null): ?int {
    if (!preg_match('/^[0-9]{6}$/D', $code)) return null;
    $key = store_totp_decode($secret);
    if ($key === '') return null;
    $step = intdiv($at ?? time(), 30);
    for ($delta = -1; $delta <= 1; $delta++) {
        if (hash_equals(store_totp_hotp($key, $step + $delta), $code)) return $step + $delta;
    }
    return null;
}

// An atomic update burns each accepted step once, including concurrent tries.
function store_totp_claim(PDO $db, int $adminId, string $secret, string $code): bool {
    $step = store_totp_verify($secret, $code);
    if ($step === null) return false;
    $q = $db->prepare(
        'update admin_users set totp_last_step = ?
          where id = ? and totp_enabled = 1 and totp_secret = ?
            and (totp_last_step is null or totp_last_step < ?)'
    );
    $q->execute([$step, $adminId, $secret, $step]);
    return $q->rowCount() === 1;
}

// Recovery codes are independent 80-bit secrets. The browser sees them once;
// MariaDB keeps only hashes, and the atomic UPDATE consumes a code at most once.
function store_recovery_codes_generate(): array {
    $codes = [];
    for ($i = 0; $i < 8; $i++) {
        $codes[] = implode('-', str_split(strtoupper(bin2hex(random_bytes(10))), 5));
    }
    return $codes;
}

function store_recovery_normalize(string $code): ?string {
    $plain = strtoupper((string)preg_replace('/[\s-]/', '', $code));
    return preg_match('/^[A-F0-9]{20}$/D', $plain) ? $plain : null;
}

function store_recovery_replace(PDO $db, int $adminId, array $codes): void {
    $db->prepare('delete from admin_recovery_codes where admin_id = ?')->execute([$adminId]);
    $insert = $db->prepare('insert into admin_recovery_codes (admin_id, code_hash) values (?, ?)');
    foreach ($codes as $code) {
        $plain = store_recovery_normalize((string)$code);
        if ($plain === null) throw new RuntimeException('invalid_recovery_code');
        $insert->execute([$adminId, hash('sha256', $plain)]);
    }
}

function store_recovery_claim(PDO $db, int $adminId, string $code): bool {
    $plain = store_recovery_normalize($code);
    if ($plain === null) return false;
    $q = $db->prepare(
        'update admin_recovery_codes set used_at = current_timestamp
          where admin_id = ? and code_hash = ? and used_at is null'
    );
    $q->execute([$adminId, hash('sha256', $plain)]);
    return $q->rowCount() === 1;
}

// Bcrypt only considers the first 72 bytes of a password. The admin UI accepts
// passphrases up to 1024 bytes, so two long passwords that differed only after
// byte 72 could otherwise authenticate as one another on a bcrypt-only host.
// New hashes are versioned and hash a fixed-length SHA-256 digest. Legacy PHP
// hashes remain valid and are upgraded after the next successful sign-in.
const STORE_ADMIN_PASSWORD_PREFIX = '$sporta-admin-v1$';

function store_admin_password_algorithm(): string|int {
    return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
}

// THE COST OF ONE GUESS, written down instead of left to PHP's defaults.
//
// PHP's Argon2id default is 64 MiB and four passes, and the sign-in form is
// public: the per-client window lets twenty verifications run at once from one
// address, each holding its 64 MiB, and every window resets together. Across a
// worker pool that is about 9.4 GiB of memory a stranger can ask for without
// knowing anything. 19 MiB and two passes is OWASP's minimum recommendation for
// Argon2id, and it is still a slow hash for an offline attacker; the same pool
// now peaks near 2.8 GiB.
//
// A fail-fast cap on concurrent sign-ins was rejected: it would be a lever to
// refuse the OWNER's sign-in while the cap is held.
//
// The bcrypt branch (a PHP built without Argon2) names its cost for the same
// reason: PHP 8.4 raised the default from 10 to 12, so the cost an account was
// hashed at depended on which PHP happened to hash it.
//
// THE DUMMY HASH BELOW MUST USE THESE SAME PARAMETERS. An unknown email is
// verified against it so it costs exactly what a real account costs; if the two
// ever differ, the response time says whether the account exists. An existing
// hash with older parameters is upgraded at its next successful sign-in.
const STORE_ADMIN_ARGON_OPTS  = ['memory_cost' => 19456, 'time_cost' => 2, 'threads' => 1];
const STORE_ADMIN_BCRYPT_OPTS = ['cost' => 12];

function store_admin_password_options(): array {
    return defined('PASSWORD_ARGON2ID') ? STORE_ADMIN_ARGON_OPTS : STORE_ADMIN_BCRYPT_OPTS;
}

function store_admin_hash_password(string $password): string {
    $hash = password_hash(hash('sha256', $password), store_admin_password_algorithm(), store_admin_password_options());
    if (!is_string($hash) || $hash === '') throw new RuntimeException('password_hash_failed');
    return STORE_ADMIN_PASSWORD_PREFIX . $hash;
}

function store_admin_verify_password(string $password, string $stored): bool {
    if (str_starts_with($stored, STORE_ADMIN_PASSWORD_PREFIX)) {
        return password_verify(
            hash('sha256', $password),
            substr($stored, strlen(STORE_ADMIN_PASSWORD_PREFIX))
        );
    }
    return password_verify($password, $stored);
}

function store_admin_password_needs_rehash(string $stored): bool {
    if (!str_starts_with($stored, STORE_ADMIN_PASSWORD_PREFIX)) return true;
    return password_needs_rehash(
        substr($stored, strlen(STORE_ADMIN_PASSWORD_PREFIX)),
        store_admin_password_algorithm(),
        store_admin_password_options()
    );
}

// A fixed, valid hash of a random value nobody knows, at EXACTLY the
// parameters above (m=19456,t=2,p=1 / bcrypt cost 12). Never built at runtime:
// generating it per request would double the work for unknown emails.
function store_admin_dummy_hash(): string {
    if (defined('PASSWORD_ARGON2ID')) {
        return STORE_ADMIN_PASSWORD_PREFIX
            . '$argon2id$v=19$m=19456,t=2,p=1$SS5tVkxzUVptVG1VRURWaA$MOaBRmF5njo/sY86L9j9II5QveUlQKPUBecVCorGmkg';
    }
    return STORE_ADMIN_PASSWORD_PREFIX
        . '$2y$12$zacB8f/PUwkqfx0v.580qeaG8p2x1besmdNyypmLfbmjgDqIzznUO';
}

// A merchant or terminal identifier as stored in a gateway config: trimmed,
// and the example placeholder ("YOUR_...") reads as empty.
function store_clean_identifier(mixed $value): string {
    $v = trim((string)$value);
    return str_starts_with($v, 'YOUR_') ? '' : $v;
}

function store_admin_event(PDO $db, array $admin, string $action): void {
    // Keep the audit row small and non-sensitive. In particular, never persist
    // POST bodies, passwords, gateway settings, reset tokens or IP addresses.
    if (!preg_match('/^[a-z][a-z0-9_]{0,79}$/D', $action)) return;
    try {
        $db->prepare('insert into admin_activity_log (actor_admin_id, actor_email, action_key)
                      values (?, ?, ?)')->execute([(int)$admin['id'], (string)$admin['email'], $action]);
    } catch (Throwable $e) {
        // An unapplied additive migration must not lock administrators out.
        error_log('Sporta admin activity logging unavailable');
    }
}

function store_admin_grant(PDO $db, array $user): void {
    if ((int)($user['must_change_password'] ?? 0) !== 0) store_fail('password_change_required', 403);
    $db->prepare('update admin_users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = ?')
       ->execute([(int)$user['id']]);
    store_session_start();
    session_regenerate_id(true);
    unset($_SESSION['pending_admin_id'], $_SESSION['pending_at'], $_SESSION['pending_auth_fingerprint']);
    $_SESSION['admin_id'] = (int)$user['id'];
    $_SESSION['admin_email'] = $user['email'];
    $_SESSION['admin_auth_fingerprint'] = store_admin_fingerprint($user);
    $_SESSION['started_at'] = time();
    $_SESSION['seen_at'] = time();
    // AFTER session_regenerate_id(), so the session cookie is the first
    // Set-Cookie of the response and this one the second. Order is not a
    // browser concern, but a simple client that keeps "the" cookie of a login
    // response keeps the first one, and that has to be the session.
    store_admin_device_issue(store_login_identity((string)$user['email']));
    store_admin_event($db, $user, 'login');
}

// ------------------------------------------------- a browser the owner uses
//
// THE PASSWORD STEP USED TO LOCK THE ACCOUNT, and that was a lever anyone
// could pull. Five wrong passwords set admin_users.locked_until for fifteen
// minutes, and the per-address bucket refused the sixth attempt from any
// browser in the world — so a stranger who knew the shop's admin address
// (it is the shop's contact address) could keep the only owner out with
// about five requests every fifteen minutes, without ever knowing the
// password. Measured in the sandbox before this existed.
//
// So a browser that has signed in successfully keeps a long-lived cookie
// naming a random device id and an HMAC that binds it to this account. Login
// attempts from that browser are counted in THEIR OWN bucket (five per
// fifteen minutes, per account and device) instead of the account's shared
// one. A stranger can still fill the shared bucket, and that still stops
// every browser the owner has never signed in from — the accepted trade-off —
// but it no longer reaches the browsers the owner actually uses.
//
// The cookie GRANTS NOTHING. It does not skip the password or the phone
// code; it only chooses which failure counter an attempt is charged to. A
// stolen copy is therefore worth five guesses per fifteen minutes at one
// account, which is what an unknown browser already gets. The MAC is keyed
// with store_rate_limit_key(), i.e. rate_limit_secret when one is set and a
// key derived from the server-only DB credentials when it is not — stable
// either way, so cookies survive a deploy. Setting or rotating
// rate_limit_secret later only turns existing cookies back into unknown
// browsers until their next sign-in; nothing is locked out by it.
const STORE_ADMIN_DEVICE_MAX_AGE = 180 * 86400;

// The device cookie is one mechanism with two audiences: the admin ($realm
// 'admin_device', cookie sporta_dev) and the customer accounts ($realm
// 'customer_device', cookie sporta_cdev). The realm is part of the MAC, so a
// cookie minted for one audience proves nothing to the other even if the same
// address were an admin and a customer, and the two names never overwrite each
// other in a browser that is both. The admin's realm and cookie name are
// unchanged, so cookies already in the owner's browser keep working.
function store_device_cookie_name(string $base): string {
    // Same rule as the session cookie: __Host- only where Secure is possible,
    // because a browser must refuse a __Host- cookie that is not Secure.
    return store_is_https() ? '__Host-' . $base : $base;
}

function store_device_mac(string $realm, string $identity, string $device): string {
    return store_rate_limit_key($realm, $identity . '|' . $device);
}

// The device id this browser proves for $identity, or null for "unknown
// browser". A cookie minted for one account is not valid for another, and a
// value whose MAC does not verify is treated exactly like no cookie at all.
function store_device_for(string $realm, string $base, string $identity): ?string {
    if ($identity === '__invalid_email__') return null;
    $raw = $_COOKIE[store_device_cookie_name($base)] ?? null;
    if (!is_string($raw) || !preg_match('/^([a-f0-9]{32})\.([a-f0-9]{32})$/D', $raw, $m)) return null;
    return hash_equals(store_device_mac($realm, $identity, $m[1]), $m[2]) ? $m[1] : null;
}

// Issued after a successful sign-in, and only when the browser does not
// already hold a valid one for this account — so a known browser keeps its
// id (and its bucket) for the whole 180 days. Signing out does not clear it:
// it says nothing about being signed in.
function store_device_issue(string $realm, string $base, string $identity): void {
    if ($identity === '__invalid_email__' || headers_sent()) return;
    if (store_device_for($realm, $base, $identity) !== null) return;
    $device = bin2hex(random_bytes(16));
    setcookie(store_device_cookie_name($base), $device . '.' . store_device_mac($realm, $identity, $device), [
        'expires'  => time() + STORE_ADMIN_DEVICE_MAX_AGE,
        'path'     => '/',
        'secure'   => store_is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function store_admin_device_cookie_name(): string {
    return store_device_cookie_name('sporta_dev');
}

function store_admin_device_mac(string $identity, string $device): string {
    return store_device_mac('admin_device', $identity, $device);
}

function store_admin_device_for(string $identity): ?string {
    return store_device_for('admin_device', 'sporta_dev', $identity);
}

function store_admin_device_issue(string $identity): void {
    store_device_issue('admin_device', 'sporta_dev', $identity);
}

// ---------------------------------------------- a browser a CUSTOMER has used
//
// THE CUSTOMER SIDE HAD THE LEVER WITHOUT THE MITIGATION. The sign-in window
// and the reset-mail windows are counted per ADDRESS (so rotating clients does
// not buy unlimited guesses or an unlimited mail flood), which means a
// stranger who knows a customer's address can fill all of them from rotating
// clients with about fifty requests a day: password sign-in refused for
// fifteen minutes at a time AND no reset mail, so the account is unusable for
// as long as they like. Measured on the sandbox before this existed.
//
// The answer is the admin's: a browser that has registered or signed in keeps
// a long-lived MAC-bound cookie naming a random device id for that address,
// and its requests are counted in windows of their OWN (same sizes, per
// address and device) instead of the shared ones. The cookie grants nothing —
// it never skips the password or a token — it only chooses which counter an
// attempt is charged to, so a stolen copy is worth exactly what an unknown
// browser already gets. A stranger can still fill the shared windows, and
// that still holds back browsers the customer has never used (a new phone, a
// cleared cookie jar) for fifteen minutes / the hour — the accepted
// trade-off, the same as the admin's — but it no longer reaches the browser
// the customer actually uses, and that is the one a forgotten password is
// usually reset from.
function store_customer_device_for(string $identity): ?string {
    return store_device_for('customer_device', 'sporta_cdev', $identity);
}

function store_customer_device_issue(string $identity): void {
    store_device_issue('customer_device', 'sporta_cdev', $identity);
}

function store_login_identity(string $email): string {
    $normal = mb_strtolower(trim($email));
    // All syntactically valid identities — existing or not — take the exact
    // same path. Collapse malformed input into one bucket so changing junk on
    // every request cannot bypass the per-IP guard with unlimited DB work.
    return strlen($normal) <= 254 && filter_var($normal, FILTER_VALIDATE_EMAIL)
        ? $normal : '__invalid_email__';
}

/** @return array{ip:array,identity:array,identity_value:string,bucket:string,bucket_identity:string} */
function store_login_rate_start(PDO $db, string $email): array {
    // Both counters are incremented before either can reject the request. A
    // blocked client therefore cannot freeze one bucket while continuing to
    // rotate identities through the other one.
    //
    // The client bucket is ALWAYS hit. The account bucket is the account's
    // shared one for an unknown browser, and this browser's own one when it
    // carries a valid device cookie for this account (see
    // store_admin_device_for). Same five per fifteen minutes either way —
    // a known browser gets a separate counter, not a larger one.
    $identity = store_login_identity($email);
    $ip = store_rate_limit_hit($db, 'admin_login_ip', store_client_identity(), 20, 900);
    $device = store_admin_device_for($identity);
    $bucket = $device === null ? 'admin_login_identity' : 'admin_login_device';
    $bucketIdentity = $device === null ? $identity : $identity . '|' . $device;
    $account = store_rate_limit_hit($db, $bucket, $bucketIdentity, 5, 900);
    if (!$ip['allowed'] || !$account['allowed']) {
        store_rate_limit_fail(max($ip['retry_after'], $account['retry_after']));
    }
    return ['ip' => $ip, 'identity' => $account, 'identity_value' => $identity,
            'bucket' => $bucket, 'bucket_identity' => $bucketIdentity];
}

/** @return array{locked:bool,retry_after:int} */
function store_admin_lock_state(PDO $db, int $adminId): array {
    $q = $db->prepare(
        'select (locked_until is not null and locked_until > now()) as is_locked,
                greatest(1, coalesce(timestampdiff(second, now(), locked_until), 1)) as retry_after
           from admin_users where id = ?'
    );
    $q->execute([$adminId]);
    $row = $q->fetch();
    return [
        'locked' => (bool)($row && (int)$row['is_locked'] === 1),
        'retry_after' => $row ? max(1, (int)$row['retry_after']) : 1,
    ];
}

// Login limiting lives in the database, not the session — an attacker does
// not keep your session for you. Every attempt hits both a 20-per-client and a
// 5-per-account window before password hashing; the account window is this
// browser's own when it carries a valid device cookie (store_login_rate_start).
// A correct password clears only the account window it was charged to.
//
// A WRONG PASSWORD NO LONGER TOUCHES THE ACCOUNT ROW. It used to count
// failed_attempts and set locked_until at five, which let anyone who knew the
// admin address lock the owner out of every browser. The windows above cap
// password guessing on their own. failed_attempts / locked_until now belong
// to the phone-code step alone (store_login_code), which only somebody
// holding the password can reach — so the lock is still there, but pulling it
// requires the password.
function store_login(string $email, string $password): array {
    $db = store_db();

    $email = mb_strtolower(trim($email));
    $validShape = strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL)
        && $password !== '' && strlen($password) <= 1024;
    $rate = store_login_rate_start($db, $email);

    // Nobody has been created yet. Answering "wrong email or password" here is
    // technically true and completely useless: the owner types the password
    // they meant to set, is told it is wrong, and goes looking for a typo that
    // does not exist. Say what is actually missing instead.
    //
    // This leaks only that the shop has no admin yet — which an empty
    // catalogue already announces — and it cannot enumerate accounts, because
    // it can only ever fire when the table holds NONE.
    if ((int)$db->query('select count(*) from admin_users')->fetchColumn() === 0) {
        store_fail('no_admin_account', 409);
    }

    $u = false;
    if ($validShape) {
        $q = $db->prepare(
            'select id, email, password_hash, must_change_password,
                    temporary_password_expires_at, temporary_password_used_at,
                    failed_attempts, locked_until,
                    totp_secret, totp_enabled,
                    (locked_until is not null and locked_until > now()) as is_locked
               from admin_users where email = ?'
        );
        $q->execute([$email]);
        $u = $q->fetch();
    }

    // password_verify runs even for an unknown/invalid email against one fixed
    // valid hash. Generating a fresh hash here made unknown-email attempts do
    // twice the password work of a real account, leaking which case occurred
    // and giving a login spray an avoidable CPU amplifier.
    $hash = (string)($u['password_hash'] ?? store_admin_dummy_hash());
    $passwordMatches = store_admin_verify_password($password, $hash);
    if (!$u || !$passwordMatches) {
        // Nothing is written to the account row here — see the comment above
        // this function. The windows already counted this attempt.
        //
        // The threshold response is deliberately identical for a real and an
        // unknown email, so it is not an account-existence oracle for
        // somebody guessing.
        if ($rate['identity']['hits'] >= 5 || $rate['ip']['hits'] >= 20) {
            store_rate_limit_fail(max(
                $rate['identity']['retry_after'],
                $rate['ip']['retry_after']
            ));
        }
        store_fail('bad_credentials', 401);
    }

    // Only somebody who proved possession of the password may learn that this
    // particular account is locked. A wrong password receives the same answer
    // and password-hash work whether the email exists, is open, or is locked.
    // Only phone-code failures set this lock now.
    if ((int)$u['is_locked'] === 1) {
        $lock = store_admin_lock_state($db, (int)$u['id']);
        store_rate_limit_fail($lock['retry_after'], 'locked');
    }

    // A correct password clears only the account window this attempt was
    // charged to — the shared one, or this browser's own. Never clear the
    // client bucket: otherwise one known password could be used to reset an
    // IP spray limiter between guesses at other accounts. And a known
    // browser's success does NOT clear the shared window, or the owner
    // signing in would hand a stranger a fresh five guesses.
    store_rate_limit_clear($db, $rate['bucket'], $rate['bucket_identity']);

    // Upgrade an older hash after a successful login, when the plaintext is
    // legitimately available. This keeps existing accounts current without a
    // password-reset migration or storing anything reversible.
    if (store_admin_password_needs_rehash((string)$u['password_hash'])) {
        $previousHash = $u['password_hash'];
        $u['password_hash'] = store_admin_hash_password($password);
        $upgrade = $db->prepare('update admin_users set password_hash = ? where id = ? and binary password_hash = ?');
        $upgrade->execute([$u['password_hash'], $u['id'], $previousHash]);
        // A password reset may have raced the verification above. Rehashing
        // must never overwrite the newly reset credential with the old one.
        if ($upgrade->rowCount() !== 1) store_fail('bad_credentials', 401);
    }

    if ((int)$u['must_change_password'] === 1) {
        // Consume the temporary password atomically. A second browser cannot
        // start another change session after this one has been issued.
        $claim = $db->prepare(
            'update admin_users set temporary_password_used_at = now(),
                    failed_attempts = 0, locked_until = null
              where id = ? and must_change_password = 1
                and temporary_password_used_at is null
                and temporary_password_expires_at > now()
                and binary password_hash = ?'
        );
        $claim->execute([(int)$u['id'], (string)$u['password_hash']]);
        if ($claim->rowCount() !== 1) store_fail('bad_credentials', 401);
        store_session_start();
        session_regenerate_id(true);
        $_SESSION = [
            'pending_password_change_id' => (int)$u['id'],
            'pending_password_change_at' => time(),
            'pending_password_change_hash' => hash('sha256', (string)$u['password_hash']),
        ];
        return ['email' => $u['email'], 'need_password_change' => true];
    }

    if ((int)$u['totp_enabled'] === 1) {
        if (store_totp_decode((string)$u['totp_secret']) === '') store_fail('mfa_unavailable', 503);
        store_session_start();
        session_regenerate_id(true);
        unset($_SESSION['admin_id'], $_SESSION['admin_email'], $_SESSION['admin_auth_fingerprint']);
        $_SESSION['pending_admin_id'] = (int)$u['id'];
        $_SESSION['pending_at'] = time();
        $_SESSION['pending_auth_fingerprint'] = hash('sha256', (string)$u['password_hash']);
        return ['need_code' => true];
    }

    store_admin_grant($db, $u);
    return ['id' => (int)$u['id'], 'email' => $u['email']];
}

// The password stage grants no admin privilege. It only creates a five-minute
// pending challenge; this step verifies the phone code and then grants access.
function store_login_code(string $code): array {
    // No session cookie is no pending sign-in, and asking must not make one.
    if (!store_session_resume()) store_fail('code_expired', 401);
    $id = (int)($_SESSION['pending_admin_id'] ?? 0);
    $since = (int)($_SESSION['pending_at'] ?? 0);
    $fingerprint = (string)($_SESSION['pending_auth_fingerprint'] ?? '');
    if ($id < 1 || $since < 1 || time() - $since > 300 || $fingerprint === '') {
        unset($_SESSION['pending_admin_id'], $_SESSION['pending_at'], $_SESSION['pending_auth_fingerprint']);
        store_fail('code_expired', 401);
    }

    $db = store_db();
    store_throttle($db, 'totp', 10, 300);
    $q = $db->prepare(
        'select id, email, password_hash, totp_secret, totp_enabled, must_change_password, failed_attempts,
                (locked_until is not null and locked_until > now()) as is_locked
           from admin_users where id = ?'
    );
    $q->execute([$id]);
    $user = $q->fetch();
    if (!$user || (int)$user['totp_enabled'] !== 1 ||
        !hash_equals(hash('sha256', (string)$user['password_hash']), $fingerprint)) {
        unset($_SESSION['pending_admin_id'], $_SESSION['pending_at'], $_SESSION['pending_auth_fingerprint']);
        store_fail('code_expired', 401);
    }
    if ((int)$user['is_locked'] === 1) {
        $lock = store_admin_lock_state($db, $id);
        store_rate_limit_fail($lock['retry_after'], 'locked');
    }

    // A DAILY CEILING ON PHONE-CODE GUESSES, per account. The row lock below
    // allows five wrong codes per fifteen minutes, which is still ~480 a day —
    // and only somebody who already has the password gets here, so every one
    // of those is an attacker one code away from the shop. Counted BEFORE the
    // code is checked, so concurrent requests cannot all slip in under it the
    // way they can race the row lock.
    //
    // Six-digit codes only. A recovery code is an 80-bit secret, not
    // guessable, and it is how the owner gets in on the day this has tripped
    // — so it must not be blocked by it.
    if (preg_match('/^[0-9]{6}$/D', $code)) {
        $day = store_rate_limit_hit($db, 'admin_totp_account_day', (string)$id, STORE_ADMIN_TOTP_DAY_MAX, 86400);
        if (!$day['allowed']) {
            // Once per trip: exactly one request wins this claim per day.
            if (store_rate_limit_once($db, 'admin_totp_alert_day', (string)$id, 86400)) {
                store_admin_code_alert($user, 'day');
            }
            store_rate_limit_fail($day['retry_after'], 'locked');
        }
    }

    if (!store_totp_claim($db, $id, (string)$user['totp_secret'], $code)
        && !store_recovery_claim($db, $id, $code)) {
        // COUNTER FIRST, then the lock, in one statement. MariaDB and MySQL
        // evaluate a single-table SET left to right, so the second assignment
        // reads the counter the first one just wrote.
        //
        // A lock that has EXPIRED starts the count again at one. Without that,
        // the counter stayed at five after the first lock and every later
        // wrong code — including the owner's own typo the next morning —
        // re-locked the account on the spot. The expired timestamp is cleared
        // in the same step, or the "expired" test would fire again on the next
        // failure and the account could never be locked a second time.
        $db->prepare(
            'update admin_users
                set failed_attempts = if(locked_until is not null and locked_until <= now(),
                                         1, failed_attempts + 1),
                    locked_until = if(failed_attempts >= 5,
                                      date_add(now(), interval 15 minute),
                                      if(locked_until is not null and locked_until <= now(),
                                         null, locked_until))
              where id = ?'
        )->execute([$id]);
        $lock = store_admin_lock_state($db, $id);
        if ($lock['locked']) {
            // This request reached the UPDATE, and the UPDATE is only reached
            // while the account is unlocked — so the lock was set just now.
            // One mail per lock: two simultaneous fifth guesses both get here,
            // and the claim lets only one of them send it.
            if (store_rate_limit_once($db, 'admin_totp_alert_lock', (string)$id, 900)) {
                store_admin_code_alert($user, 'lock');
            }
            unset($_SESSION['pending_admin_id'], $_SESSION['pending_at'], $_SESSION['pending_auth_fingerprint']);
            store_rate_limit_fail($lock['retry_after'], 'locked');
        }
        store_fail('bad_code', 401);
    }

    store_admin_grant($db, $user);
    return ['id' => (int)$user['id'], 'email' => $user['email']];
}

// Six-digit code evaluations per account per day (UTC). Generous for a person
// — the owner signing in a few times a day uses a handful — and about a
// twenty-fourth of the ~480 a day the fifteen-minute lock alone allowed.
const STORE_ADMIN_TOTP_DAY_MAX = 20;

// "Somebody has your password." The phone-code step is reached only after the
// correct password, so wrong codes there are the one signal this system has
// that the password is known to somebody else. Sent to the account itself,
// from the same verified sender as a password reset. Never carries an IP
// address, a code, or anything that would help the person who triggered it.
function store_admin_code_alert(array $user, string $why): void {
    try {
        $cfg = store_config();
        $mailCfg = $cfg;
        $mailCfg['mail_from'] = store_admin_recovery_sender($cfg);
        // 'day' / 'lock': wrong PHONE codes after the right password.
        // 'passcode_day' / 'passcode_lock': wrong DEVICE PASSCODES, which are
        // tried from a browser that holds this account's device cookie - so
        // either the owner mistyped, or that browser (or its cookie) is not
        // only the owner's any more.
        $passcode = str_starts_with($why, 'passcode_');
        $what = match ($why) {
            'day' => 'Too many phone codes were tried today, so phone-code sign-in to this account is paused until 00:00 UTC (03:00 Kuwait time). A recovery code still works.',
            'passcode_day' => 'Too many device passcodes were tried today, so passcode sign-in to this account is paused for 24 hours. Your password still works.',
            'passcode_lock' => 'Five wrong device passcodes were entered in a row, so passcode sign-in is locked for 15 minutes. Your password still works.',
            default => 'Five wrong phone codes were entered in a row, so this account is locked for 15 minutes.',
        };
        $lead = $passcode
            ? 'Wrong device passcodes were entered for your Sporta Backends account, from a browser that has signed in to it before.'
            : 'Your Sporta Backends password was entered correctly, and then wrong phone codes were entered.';
        $advice = $passcode
            ? 'If this was not you, somebody may have that browser or its cookie. Reset your password now (open the sign-in page and choose "Forgot password"): a reset also clears the passcode.'
            : 'If this was not you, somebody knows your password. Reset it now: open the sign-in page and choose "Forgot password".';
        $subject = $passcode
            ? 'Sporta Backends: wrong device passcodes on your account'
            : 'Sporta Backends: wrong sign-in codes on your account';
        $text = $lead . "\n\n" . $what . "\n\n" . $advice . "\n";
        $esc = static fn (string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $html = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">'
              . '<h2>' . ($passcode ? 'Wrong device passcodes on your account' : 'Wrong sign-in codes on your account') . '</h2>'
              . '<p>' . $esc($lead) . '</p>'
              . '<p>' . $esc($what) . '</p>'
              . '<p><strong>' . $esc($advice) . '</strong></p>'
              . '</div>';
        if (!store_send_admin_mail($mailCfg, (string)$user['email'], $subject, $text, $html)) {
            error_log('Sporta admin code alert mail failed');
        }
    } catch (Throwable $e) {
        // An alert that cannot be sent must never turn a refusal into a 500.
        error_log('Sporta admin code alert unavailable');
    }
}

// ---------------------------------------------------------------- settings
//
// Small named pieces of configuration the owner edits without a deploy: the
// slider's speed and size, the promo bar's text. Stored as JSON in one table
// so adding a setting is an INSERT, not a migration on a live shop.
//
// Cache each named row for this request. SEO has one small row per product;
// reading the theme must not load every product's search metadata too.
function store_setting_row(PDO $db, string $name, bool $invalidate = false): array {
    static $cache = [];
    $key = spl_object_id($db) . ':' . $name;
    if ($invalidate) {
        unset($cache[$key]);
        return [];
    }
    if (!array_key_exists($key, $cache)) {
        $q = $db->prepare('select value from settings where name = ?');
        $q->execute([$name]);
        $decoded = json_decode((string)($q->fetchColumn() ?: ''), true);
        $cache[$key] = is_array($decoded) ? $decoded : [];
    }
    return $cache[$key];
}

// One setting, merged over its defaults.
//
// The defaults live in PHP as well as in the seed row, and that is deliberate:
// a shop that imported schema.mysql.sql before this feature has no row at all,
// and a home page that renders nothing because a SELECT missed is a worse
// outcome than a home page that renders the values it shipped with.
const STORE_SETTING_DEFAULTS = [
    'hero'      => ['speed_ms' => 6500, 'shuffle' => false, 'size' => 'tall', 'autoplay' => true],
    'promo_bar' => ['enabled' => false, 'text_en' => '', 'text_ar' => '', 'href' => '',
                    'starts_at' => null, 'ends_at' => null, 'tone' => 'brand',
                    'show_dot' => true, 'alignment' => 'center'],
    'checkout'  => ['delivery_fee_fils' => 1000, 'knet' => true, 'tpay' => false, 'cod' => true,
                    'default_method' => 'knet', 'notice_en' => '', 'notice_ar' => ''],
    'inventory_finance' => ['delivery_expense' => 0, 'ads_expense' => 0,
                            'fixed_expense' => 0, 'variable_expense' => 0,
                            'returns_expense' => 0, 'damage_expense' => 0],
    'theme' => ['brand' => '#c76a42', 'accent' => '#99452b', 'canvas' => '#ffffff', 'radius' => '16', 'dark' => false,
                'fonts' => ['body_en' => 'plex', 'display_en' => 'alexandria',
                            'body_ar' => 'plex', 'display_ar' => 'alexandria']],
];

function store_setting(PDO $db, string $name): array {
    return array_merge(STORE_SETTING_DEFAULTS[$name] ?? [], store_setting_row($db, $name));
}

// The announcement bar is read by both the public storefront and the private
// editor. Normalising it in one place keeps an older settings row (or a row
// edited directly in phpMyAdmin) from emitting unsupported CSS choices or
// non-string values. Reads must degrade to safe defaults rather than taking
// the whole storefront down because one JSON property is malformed.
function store_topbar_setting(PDO $db): array {
    $raw = store_setting($db, 'promo_bar');
    $flag = static function (mixed $value, bool $fallback): bool {
        if (is_bool($value)) return $value;
        if ($value === 1 || $value === '1') return true;
        if ($value === 0 || $value === '0') return false;
        return $fallback;
    };
    $text = static fn ($value): string => is_string($value)
        ? mb_substr(trim(preg_replace('/[\x00-\x1F\x7F]/u', '', $value) ?? ''), 0, 160)
        : '';
    $date = static fn ($value): ?string => is_string($value)
        && preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $value)
            ? $value : null;
    $href = is_string($raw['href'] ?? null) ? trim($raw['href']) : '';
    if (!preg_match('~^/(?![/\\\\])[A-Za-z0-9/_\-\?=&%\.#]{0,180}$~', $href)) $href = '';

    return [
        'enabled' => $flag($raw['enabled'] ?? null, false),
        'text_en' => $text($raw['text_en'] ?? ''),
        'text_ar' => $text($raw['text_ar'] ?? ''),
        'href' => $href,
        'starts_at' => $date($raw['starts_at'] ?? null),
        'ends_at' => $date($raw['ends_at'] ?? null),
        'tone' => in_array($raw['tone'] ?? null, ['brand', 'ink', 'silver'], true) ? $raw['tone'] : 'brand',
        'show_dot' => $flag($raw['show_dot'] ?? null, true),
        'alignment' => ($raw['alignment'] ?? null) === 'start' ? 'start' : 'center',
    ];
}

function store_setting_save(PDO $db, string $name, array $value): void {
    $db->prepare('insert into settings (name, value) values (?, ?)
                  on duplicate key update value = values(value)')
       ->execute([$name, json_encode($value, JSON_UNESCAPED_UNICODE)]);
    store_setting_row($db, $name, true);
}

// ------------------------------------------------------------- site content
// "Make backends full dynamic" (owner, 2026-11-10): the fixed words a shopper
// reads become editable from /backends. The live storefront is a compiled
// build with no source, so nothing here renders a page: the admin stores a
// list of "where the page says X, say Y" rules plus the shop's contact
// details, and an add-on script (public/sporta-features.js, the "site content"
// block) swaps the text of matching TEXT NODES in the browser.
//
// ONE row, settings.site_content, no migration:
//   { v, overrides: [ {page, lang, match, text} ], contact: {...} }
//
// What keeps this from being a way to deface or to lie:
//   - plain text only, both ways. Nothing here is ever parsed as markup; the
//     script writes nodeValue and the API answers JSON with <, >, & and quotes
//     hex-escaped (store_out), so "<script>" saved by an admin is the nine
//     characters "<script>" on the page.
//   - the PAGE is from a fixed list. Never /backends, and never the money path
//     (/cart, /checkout, /payment/*, /invoice/*): those pages show numbers and
//     instructions the server decides, and a reworded "Pay now" is how a
//     compromised admin login would become a phishing page.
//   - NO PRICE in either half. A rule may not match a text that carries a price
//     and may not write one: every number a shopper is charged comes from
//     store_price_lines(), and a sentence that says "5 KD" from a settings row
//     would be a second, unpriced authority. (The promo bar is where the owner
//     writes an offer; it has its own editor.)
//   - contact values are validated by type and the social links are REBUILT
//     from the handle onto the one expected host, so the stored value is never
//     an arbitrary URL.
//   - the row is settings.value, a TEXT column: 65,535 bytes. The whole
//     document is refused above STORE_CONTENT_MAX_BYTES rather than letting
//     MySQL truncate it into broken JSON (or, in strict mode, 500 the save).
const STORE_CONTENT_PAGES = [
    '*', '/', '/shop', '/product/*', '/about', '/contact', '/support', '/account',
    '/wishlist', '/track', '/returns', '/exchange', '/terms', '/privacy', '/review',
];
const STORE_CONTENT_MAX_OVERRIDES = 300;
const STORE_CONTENT_MAX_BYTES = 60000;
const STORE_CONTENT_CONTACT_KEYS = [
    'phone', 'whatsapp', 'email', 'address_en', 'address_ar', 'instagram', 'tiktok', 'snapchat', 'x',
];
// Digits (Western or Arabic-Indic) next to a Kuwaiti-dinar mark, either side.
const STORE_CONTENT_PRICE_RE = '/(?:[0-9\x{0660}-\x{0669}][0-9\x{0660}-\x{0669}.,\x{066B}\x{066C}]*[\s\x{00A0}\x{202F}]*(?:KWD|K\.?\s?D\.?|\x{062F}\.?\s?\x{0643}\.?)(?![A-Za-z\x{0600}-\x{06FF}]))|(?:(?<![A-Za-z\x{0600}-\x{06FF}])(?:KWD|K\.?\s?D\.?|\x{062F}\.?\s?\x{0643}\.?)[\s\x{00A0}\x{202F}]*[0-9\x{0660}-\x{0669}])/iu';

// The same squash the storefront script applies to a text node before it looks
// a rule up: runs of ASCII whitespace become one space, other control
// characters go, the ends are trimmed. ASCII whitespace only, on purpose: \s
// means different things to PCRE and to JavaScript (NBSP, U+2028...), and the
// two sides must agree on every character or a rule silently never matches.
function store_content_squash(mixed $value, string $field, int $min, int $max): string {
    $raw = store_input_string($value, $field, 8192);
    if (!mb_check_encoding($raw, 'UTF-8')) store_fail("invalid_{$field}");
    $t = preg_replace('/[ \t\n\r\f\x0B]+/', ' ', $raw) ?? '';
    $t = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', $t) ?? '', ' ');
    if (mb_strlen($t) < $min) store_fail("missing_{$field}");
    if (mb_strlen($t) > $max) store_fail("too_long_{$field}");
    return $t;
}

function store_content_has_price(string $text): bool {
    return preg_match(STORE_CONTENT_PRICE_RE, $text) === 1;
}

// A social link: a bare handle (with or without the leading @) or an https address
// on the network's own host. Either way what is KEPT is the address rebuilt
// from the handle, so no query string, port, credential or other host survives.
function store_content_social(mixed $value, string $network): string {
    $rules = [
        'instagram' => [['instagram.com', 'www.instagram.com'], '~^/@?([A-Za-z0-9._]{1,30})/?$~D',
                        '/^@?([A-Za-z0-9._]{1,30})$/D', 'https://www.instagram.com/%s'],
        'tiktok'    => [['tiktok.com', 'www.tiktok.com'], '~^/@([A-Za-z0-9._]{2,24})/?$~D',
                        '/^@?([A-Za-z0-9._]{2,24})$/D', 'https://www.tiktok.com/@%s'],
        'snapchat'  => [['snapchat.com', 'www.snapchat.com'], '~^/add/([A-Za-z0-9._\-]{3,15})/?$~D',
                        '/^@?([A-Za-z0-9._\-]{3,15})$/D', 'https://www.snapchat.com/add/%s'],
        'x'         => [['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'], '~^/@?([A-Za-z0-9_]{1,15})/?$~D',
                        '/^@?([A-Za-z0-9_]{1,15})$/D', 'https://x.com/%s'],
    ];
    [$hosts, $pathRe, $handleRe, $format] = $rules[$network];
    $field = "contact_{$network}";
    $v = trim(store_input_string($value, $field, 300));
    if ($v === '') return '';
    if (preg_match($handleRe, $v, $m)) return sprintf($format, $m[1]);
    // Not a handle, so it must be the whole address and nothing but.
    if (!preg_match('~^https://[^\s\x00-\x1F\x7F\\\\]+$~D', $v)) store_fail("invalid_{$field}");
    $u = parse_url($v);
    if (!is_array($u) || ($u['scheme'] ?? '') !== 'https'
        || !in_array(strtolower((string)($u['host'] ?? '')), $hosts, true)
        || isset($u['user']) || isset($u['pass']) || isset($u['port'])
        || isset($u['query']) || isset($u['fragment'])
        || !preg_match($pathRe, (string)($u['path'] ?? ''), $m)) {
        store_fail("invalid_{$field}");
    }
    return sprintf($format, $m[1]);
}

// What a caller may SEND as the contact block. Empty means "leave the page as
// it is" for that item. Unknown keys are not errors, they are simply not kept.
function store_content_contact(mixed $raw): array {
    if ($raw === null) $raw = [];
    if (!is_array($raw) || ($raw !== [] && array_is_list($raw))) store_fail('invalid_content_contact');
    $out = [];

    $phone = preg_replace('/[\s\-().]/', '', store_ascii_digits(store_input_string($raw['phone'] ?? null, 'contact_phone', 64))) ?? '';
    if ($phone !== '' && !preg_match('/^\+?[0-9]{6,15}$/D', $phone)) store_fail('invalid_contact_phone');
    $out['phone'] = $phone;

    // wa.me takes the full international number as digits, no plus.
    $wa = preg_replace('/[\s\-().]/', '', store_ascii_digits(store_input_string($raw['whatsapp'] ?? null, 'contact_whatsapp', 64))) ?? '';
    if ($wa !== '' && !preg_match('/^\+?[0-9]{8,15}$/D', $wa)) store_fail('invalid_contact_whatsapp');
    $out['whatsapp'] = ltrim($wa, '+');

    $email = trim(store_input_string($raw['email'] ?? null, 'contact_email', 254));
    // filter_var decides whether it is an address; the pattern keeps it to the
    // characters the storefront script accepts before it builds a mailto: link
    // (no ? & # %, so the address can never carry a subject or a second recipient).
    if ($email !== '' && (strlen($email) > 120
        || filter_var($email, FILTER_VALIDATE_EMAIL) === false
        || !preg_match('~^[A-Za-z0-9.!$*+/=^_{|}\~\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+$~D', $email))) {
        store_fail('invalid_contact_email');
    }
    $out['email'] = $email;

    $out['address_en'] = store_content_squash($raw['address_en'] ?? null, 'contact_address_en', 0, 200);
    $out['address_ar'] = store_content_squash($raw['address_ar'] ?? null, 'contact_address_ar', 0, 200);

    foreach (['instagram', 'tiktok', 'snapchat', 'x'] as $network) {
        $out[$network] = store_content_social($raw[$network] ?? null, $network);
    }
    return $out;
}

// The stored document, safe to hand to anyone. Reads DEGRADE: a row edited by
// hand, or written by an older version, loses whatever does not fit the
// contract instead of taking the storefront's request down with it.
function store_site_content(PDO $db): array {
    $raw = store_setting_row($db, 'site_content');
    $overrides = [];
    foreach (is_array($raw['overrides'] ?? null) ? $raw['overrides'] : [] as $o) {
        if (count($overrides) >= STORE_CONTENT_MAX_OVERRIDES) break;
        if (!is_array($o)) continue;
        $page = $o['page'] ?? null; $lang = $o['lang'] ?? null;
        $match = $o['match'] ?? null; $text = $o['text'] ?? null;
        if (!is_string($page) || !in_array($page, STORE_CONTENT_PAGES, true)) continue;
        if ($lang !== 'ar' && $lang !== 'en') continue;
        if (!is_string($match) || $match === '' || mb_strlen($match) > 400) continue;
        if (!is_string($text) || $text === '' || mb_strlen($text) > 2000) continue;
        if (store_content_has_price($match) || store_content_has_price($text)) continue;
        $overrides[] = ['page' => $page, 'lang' => $lang, 'match' => $match, 'text' => $text];
    }
    $contact = [];
    $stored = is_array($raw['contact'] ?? null) ? $raw['contact'] : [];
    foreach (STORE_CONTENT_CONTACT_KEYS as $key) {
        $value = $stored[$key] ?? '';
        $contact[$key] = is_string($value) ? mb_substr($value, 0, 300) : '';
    }
    $v = $raw['v'] ?? 0;
    return ['v' => is_int($v) && $v > 0 ? $v : 0, 'overrides' => $overrides, 'contact' => $contact];
}

// Validate a save, field by field, and store it. Returns what was stored.
// The whole document is replaced: the editor holds the full list. `v` in the
// request, when sent, must be the version the editor loaded, so a second
// browser cannot silently overwrite the first one's work.
function store_site_content_save(PDO $db, array $body): array {
    // Everything is validated BEFORE the transaction opens: store_fail() ends
    // the request, and a refusal must never be issued while a row lock is held.
    $sentV = null;
    if (array_key_exists('v', $body) && $body['v'] !== null) {
        if (!is_int($body['v']) || $body['v'] < 0) store_fail('invalid_content_version');
        $sentV = $body['v'];
    }
    $list = $body['overrides'] ?? [];
    if (!is_array($list) || !array_is_list($list)) store_fail('invalid_content_overrides');
    if (count($list) > STORE_CONTENT_MAX_OVERRIDES) store_fail('too_many_content_overrides');
    $kept = [];
    foreach ($list as $o) {
        if (!is_array($o) || ($o !== [] && array_is_list($o))) store_fail('invalid_content_override');
        $page = $o['page'] ?? null;
        if (!is_string($page) || !in_array($page, STORE_CONTENT_PAGES, true)) store_fail('invalid_content_page');
        $lang = $o['lang'] ?? null;
        if ($lang !== 'ar' && $lang !== 'en') store_fail('invalid_content_lang');
        $match = store_content_squash($o['match'] ?? null, 'content_match', 1, 400);
        $text = store_content_squash($o['text'] ?? null, 'content_text', 0, 2000);
        // A number alone ("3", "12.500") is a quantity or half of a price; it is never copy.
        if (store_content_has_price($match) || preg_match('/^[0-9\x{0660}-\x{0669}\s.,:+\-\/%]+$/u', $match)
            || preg_match('/^(?:KWD|K\.?\s?D\.?|\x{062F}\.?\s?\x{0643}\.?)$/iu', $match)) {
            store_fail('invalid_content_match');
        }
        if (store_content_has_price($text)) store_fail('price_in_content_text');
        $key = $page . "\n" . $lang . "\n" . $match;
        if ($text === '') { unset($kept[$key]); continue; }   // an empty replacement removes the rule
        $kept[$key] = ['page' => $page, 'lang' => $lang, 'match' => $match, 'text' => $text];
    }
    $value = [
        'v' => 0,
        'overrides' => array_values($kept),
        'contact' => store_content_contact($body['contact'] ?? null),
    ];
    // Measured with room for the version number, which is filled in below.
    $json = json_encode($value, JSON_UNESCAPED_UNICODE);
    if (!is_string($json) || strlen($json) + 12 > STORE_CONTENT_MAX_BYTES) store_fail('content_too_large', 413);

    $stale = false;
    $db->beginTransaction();
    try {
        // The row is created before it is locked, so two saves on a shop that
        // has never used this still queue behind one another.
        $db->prepare('insert ignore into settings (name, value) values (?, ?)')->execute(['site_content', '{}']);
        $q = $db->prepare('select value from settings where name = ? for update');
        $q->execute(['site_content']);
        $decoded = json_decode((string)($q->fetchColumn() ?: ''), true);
        $currentV = is_array($decoded) && is_int($decoded['v'] ?? null) && $decoded['v'] > 0 ? $decoded['v'] : 0;
        if ($sentV !== null && $sentV !== $currentV) {
            $stale = true;
            $db->rollBack();
        } else {
            $value['v'] = $currentV + 1;
            store_setting_save($db, 'site_content', $value);
            $db->commit();
        }
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
    if ($stale) store_fail('content_changed', 409);
    return $value;
}

// ------------------------------------------------------ returns & exchange
// "Make return and exchange fully dynamic" (owner, 2026-11-10). ONE row,
// settings.returns_policy, no migration:
//   { window_days, allow_return, allow_exchange,
//     intro_en, intro_ar, points_en[], points_ar[] }
//
// The first three are RULES and the server enforces them (returns.php):
// window_days is how long after delivery a request is `standard` rather than
// `manual_review`, and a switched-off action is refused on submit whatever the
// page offered. The rest is wording for /returns and /exchange, applied in the
// browser by sporta-features.js; an empty intro or an empty list means "the
// page's own text stays".
//
// Every value has a default here, because a shop that has never opened the
// editor has no row at all, and the defaults are exactly what the code did
// before this existed (14 days, both actions).
const STORE_RETURNS_DEFAULTS = [
    'window_days' => 14, 'allow_return' => true, 'allow_exchange' => true,
    'intro_en' => '', 'intro_ar' => '', 'points_en' => [], 'points_ar' => [],
];
const STORE_RETURNS_MAX_POINTS = 8;

// Reads degrade to the defaults, value by value: a row edited by hand must
// never switch returns off or stretch the window by accident.
function store_returns_policy(PDO $db): array {
    $raw = store_setting_row($db, 'returns_policy');
    $out = STORE_RETURNS_DEFAULTS;
    $days = $raw['window_days'] ?? null;
    if (is_int($days) && $days >= 1 && $days <= 60) $out['window_days'] = $days;
    foreach (['allow_return', 'allow_exchange'] as $key) {
        if (is_bool($raw[$key] ?? null)) $out[$key] = $raw[$key];
    }
    if (!$out['allow_return'] && !$out['allow_exchange']) {
        $out['allow_return'] = true; $out['allow_exchange'] = true;
    }
    foreach (['intro_en', 'intro_ar'] as $key) {
        $v = $raw[$key] ?? '';
        if (is_string($v) && mb_strlen($v) <= 400) $out[$key] = $v;
    }
    foreach (['points_en', 'points_ar'] as $key) {
        $list = [];
        foreach (is_array($raw[$key] ?? null) ? $raw[$key] : [] as $point) {
            if (count($list) >= STORE_RETURNS_MAX_POINTS) break;
            if (is_string($point) && $point !== '' && mb_strlen($point) <= 300) $list[] = $point;
        }
        $out[$key] = $list;
    }
    return $out;
}

// The three rules alone: what returns.php enforces and what a lookup reports.
function store_returns_rules(PDO $db): array {
    $p = store_returns_policy($db);
    return ['window_days' => $p['window_days'], 'allow_return' => $p['allow_return'],
            'allow_exchange' => $p['allow_exchange']];
}

function store_returns_policy_save(PDO $db, array $body): array {
    $days = $body['window_days'] ?? null;
    if (!is_int($days) || $days < 1 || $days > 60) store_fail('invalid_returns_window');
    $flag = static function (mixed $raw, string $field): bool {
        if (is_bool($raw)) return $raw;
        if ($raw === 1 || $raw === '1') return true;
        if ($raw === 0 || $raw === '0') return false;
        store_fail("invalid_{$field}");
    };
    $value = [
        'window_days' => $days,
        'allow_return' => $flag($body['allow_return'] ?? null, 'returns_allow_return'),
        'allow_exchange' => $flag($body['allow_exchange'] ?? null, 'returns_allow_exchange'),
    ];
    // A page that accepts neither is a page that accepts nothing: closing the
    // returns desk is a decision for the policy text and the law, not a switch.
    if (!$value['allow_return'] && !$value['allow_exchange']) store_fail('returns_action_required');
    foreach (['intro_en', 'intro_ar'] as $key) {
        $value[$key] = store_content_squash($body[$key] ?? null, "returns_{$key}", 0, 400);
    }
    foreach (['points_en', 'points_ar'] as $key) {
        $list = $body[$key] ?? [];
        if (!is_array($list) || !array_is_list($list)) store_fail("invalid_returns_{$key}");
        if (count($list) > STORE_RETURNS_MAX_POINTS) store_fail('too_many_returns_points');
        $value[$key] = array_map(
            static fn ($point) => store_content_squash($point, 'returns_point', 1, 300), $list);
    }
    store_setting_save($db, 'returns_policy', $value);
    return $value;
}

// ------------------------------------------------------------------ shipping
// "Add shipping setup at backends" (owner, 2026-11-12). ONE row,
// settings.shipping, no migration:
//   { v, free_over_fils, zones: { <governorate>: {enabled, fee_fils|null, time_en, time_ar} } }
//
// THE BASE FEE IS NOT IN THIS ROW. It stays checkout.delivery_fee_fils, the
// number the compiled admin's Checkout screen already edits; the Shipping
// editor writes that same field (store_shipping_save). Two rows each holding
// "the delivery fee" would be two authorities, and the one a screen did not
// show would be the one that silently won.
//
// Rules, all decided HERE and nowhere else (the checkout quote and the order
// both call store_shipping_quote(), so what is quoted is what is charged):
//   - a governorate's own fee, when set, replaces the base fee for it; null
//     means "the base fee";
//   - free delivery when free_over_fils > 0 and the GOODS after every discount
//     (subtotal - discount, the same figure the zero check uses) reach it:
//     at exactly the threshold delivery is free;
//   - a governorate switched off takes no new order (governorate_unavailable);
//   - the delivery-time text is wording only: plain text, no price, no
//     currency word (a sentence saying "2 KD" would be a second, unpriced
//     authority, the rule site content already holds).
//
// WITH NO ROW, NOTHING CHANGES: every governorate open, no own fee, no
// threshold, so the fee is checkout.delivery_fee_fils exactly as before. Reads
// degrade value by value to those defaults: a row edited by hand must never
// close a governorate or make delivery free by accident.
//
// NOT BUILT: express / same-day delivery with its own fee and cut-off. The
// live checkout is a compiled build whose quote request carries only the cart
// and the code and whose order carries no delivery option, so a second fee the
// shopper chooses could not be quoted and charged as one number. It waits for
// a checkout this repo builds.
const STORE_SHIPPING_FEE_MAX_FILS = 100000;      // 100 KWD, the cap store_checkout_setting() already applies
const STORE_SHIPPING_FREE_MAX_FILS = 10000000;   // 10,000 KWD
const STORE_SHIPPING_TIME_MAX = 120;
// A currency word or mark, with or without a number. Wider than
// STORE_CONTENT_PRICE_RE on purpose: delivery-time text never needs one.
const STORE_SHIPPING_MONEY_RE = '/(?:KWD|\bK\.?\s?D\b|\bdinars?\b|\bfils\b|\x{062F}\.\s?\x{0643}|\x{062F}\x{064A}\x{0646}\x{0627}\x{0631}|\x{0641}\x{0644}\x{0633}|\x{0641}\x{0644}\x{0648}\x{0633})/iu';

function store_shipping_zone_defaults(): array {
    return ['enabled' => true, 'fee_fils' => null, 'time_en' => '', 'time_ar' => ''];
}

/** The stored document, normalised. Never fails. */
function store_shipping(PDO $db): array {
    $raw = store_setting_row($db, 'shipping');
    $v = $raw['v'] ?? 0;
    $free = $raw['free_over_fils'] ?? 0;
    $out = [
        'v' => is_int($v) && $v > 0 ? $v : 0,
        'configured' => $raw !== [],
        'free_over_fils' => is_int($free) && $free > 0 && $free <= STORE_SHIPPING_FREE_MAX_FILS ? $free : 0,
        'zones' => [],
    ];
    $stored = is_array($raw['zones'] ?? null) ? $raw['zones'] : [];
    $open = 0;
    foreach (STORE_GOVERNORATES as $gov) {
        $z = store_shipping_zone_defaults();
        $s = is_array($stored[$gov] ?? null) ? $stored[$gov] : [];
        if (is_bool($s['enabled'] ?? null)) $z['enabled'] = $s['enabled'];
        $fee = $s['fee_fils'] ?? null;
        if (is_int($fee) && $fee >= 0 && $fee <= STORE_SHIPPING_FEE_MAX_FILS) $z['fee_fils'] = $fee;
        foreach (['time_en', 'time_ar'] as $k) {
            $t = $s[$k] ?? '';
            if (is_string($t) && mb_strlen($t) <= STORE_SHIPPING_TIME_MAX
                && !store_content_has_price($t) && !preg_match(STORE_SHIPPING_MONEY_RE, $t)) $z[$k] = $t;
        }
        if ($z['enabled']) $open++;
        $out['zones'][$gov] = $z;
    }
    // A row that closes every governorate is a row that closes the shop:
    // that is not a shipping setting, so it reads as all open (the save refuses it).
    if ($open === 0) foreach ($out['zones'] as &$z) $z['enabled'] = true;
    unset($z);
    return $out;
}

/**
 * The fee for one order, from a normalised shipping document and the base fee.
 * Pure, so the admin preview runs the very function the checkout does.
 * $gov null = not known yet (a quote asked without one): the base fee.
 */
function store_shipping_fee_for(array $shipping, int $baseFils, ?string $gov, int $goodsFils): array {
    $zone = $gov !== null ? ($shipping['zones'][$gov] ?? null) : null;
    $fee = $zone !== null && $zone['fee_fils'] !== null ? (int)$zone['fee_fils'] : $baseFils;
    $threshold = (int)($shipping['free_over_fils'] ?? 0);
    $free = $threshold > 0 && $goodsFils >= $threshold;
    return [
        'fee_fils' => $free ? 0 : $fee,
        'free' => $free,
        'available' => $zone === null || $zone['enabled'] === true,
        'governorate' => $zone !== null ? $gov : null,
    ];
}

function store_shipping_quote(PDO $db, ?string $gov, int $goodsFils): array {
    return store_shipping_fee_for(store_shipping($db), store_checkout_setting($db)['delivery_fee_fils'], $gov, $goodsFils);
}

/** May an order be delivered to this governorate? (Known governorates only.) */
function store_shipping_open(PDO $db, string $gov): bool {
    $z = store_shipping($db)['zones'][$gov] ?? null;
    return $z !== null && $z['enabled'] === true;
}

/** What the storefront may know: open zones, their fee and time text, the threshold. */
function store_shipping_public(PDO $db): array {
    $s = store_shipping($db);
    $base = store_checkout_setting($db)['delivery_fee_fils'];
    $zones = [];
    foreach ($s['zones'] as $gov => $z) {
        $fee = $z['fee_fils'] ?? $base;
        $zones[$gov] = ['enabled' => $z['enabled'], 'fee_fils' => $fee, 'fee' => (float)store_kwd($fee),
                        'time_en' => $z['time_en'], 'time_ar' => $z['time_ar']];
    }
    return ['base_fee_fils' => $base, 'base_fee' => (float)store_kwd($base),
            'free_over_fils' => $s['free_over_fils'], 'free_over' => (float)store_kwd($s['free_over_fils']),
            'zones' => $zones];
}

function store_shipping_int(mixed $raw, string $field, int $max, bool $nullable = false): ?int {
    if ($nullable && $raw === null) return null;
    if (!is_int($raw) || $raw < 0 || $raw > $max) store_fail("invalid_{$field}");
    return $raw;
}

/**
 * Validate a draft, field by field. Returns [shipping document without v, base fee].
 * Shared by the save and the preview, so a preview can never show a setting
 * the save would refuse.
 */
function store_shipping_validate(array $body): array {
    $base = store_shipping_int($body['flat_fee_fils'] ?? null, 'shipping_flat_fee', STORE_SHIPPING_FEE_MAX_FILS);
    $free = store_shipping_int($body['free_over_fils'] ?? 0, 'shipping_free_over', STORE_SHIPPING_FREE_MAX_FILS);
    $zonesIn = $body['zones'] ?? [];
    if (!is_array($zonesIn) || ($zonesIn !== [] && array_is_list($zonesIn))) store_fail('invalid_shipping_zones');
    foreach (array_keys($zonesIn) as $k) {
        if (!in_array($k, STORE_GOVERNORATES, true)) store_fail('invalid_shipping_zone');
    }
    $zones = [];
    $open = 0;
    foreach (STORE_GOVERNORATES as $gov) {
        $s = $zonesIn[$gov] ?? [];
        if (!is_array($s) || ($s !== [] && array_is_list($s))) store_fail('invalid_shipping_zone');
        $enabled = $s['enabled'] ?? true;
        if (!is_bool($enabled)) store_fail('invalid_shipping_enabled');
        $z = [
            'enabled' => $enabled,
            'fee_fils' => store_shipping_int($s['fee_fils'] ?? null, 'shipping_zone_fee', STORE_SHIPPING_FEE_MAX_FILS, true),
        ];
        foreach (['time_en', 'time_ar'] as $k) {
            $t = store_content_squash($s[$k] ?? null, "shipping_{$k}", 0, STORE_SHIPPING_TIME_MAX);
            if (store_content_has_price($t) || preg_match(STORE_SHIPPING_MONEY_RE, $t)) store_fail("price_in_shipping_{$k}");
            $z[$k] = $t;
        }
        if ($enabled) $open++;
        $zones[$gov] = $z;
    }
    if ($open === 0) store_fail('shipping_zone_required');
    return [['free_over_fils' => $free, 'zones' => $zones], $base];
}

/** The admin's whole view: the document, the base fee, the lists the editor needs. */
function store_shipping_admin(PDO $db): array {
    $s = store_shipping($db);
    return $s + [
        'flat_fee_fils' => store_checkout_setting($db)['delivery_fee_fils'],
        'governorates' => STORE_GOVERNORATES,
        'limits' => ['fee_fils' => STORE_SHIPPING_FEE_MAX_FILS, 'free_over_fils' => STORE_SHIPPING_FREE_MAX_FILS,
                     'time' => STORE_SHIPPING_TIME_MAX],
        'express' => false,
    ];
}

/**
 * Save: the whole document is replaced, version-guarded like content_save
 * (`v` sent = the version the editor loaded; another browser's save in
 * between is a 409 shipping_changed, never a silent overwrite). The base fee
 * goes into checkout.delivery_fee_fils in the same transaction.
 */
function store_shipping_save(PDO $db, array $body): array {
    $sentV = null;
    if (array_key_exists('v', $body) && $body['v'] !== null) {
        if (!is_int($body['v']) || $body['v'] < 0) store_fail('invalid_shipping_version');
        $sentV = $body['v'];
    }
    [$value, $base] = store_shipping_validate($body);

    $stale = false;
    $db->beginTransaction();
    try {
        $db->prepare('insert ignore into settings (name, value) values (?, ?)')->execute(['shipping', '{}']);
        $q = $db->prepare('select value from settings where name = ? for update');
        $q->execute(['shipping']);
        $decoded = json_decode((string)($q->fetchColumn() ?: ''), true);
        $currentV = is_array($decoded) && is_int($decoded['v'] ?? null) && $decoded['v'] > 0 ? $decoded['v'] : 0;
        if ($sentV !== null && $sentV !== $currentV) {
            $stale = true;
            $db->rollBack();
        } else {
            store_setting_save($db, 'shipping', ['v' => $currentV + 1] + $value);
            // The base fee: written only when it changes, merged into the
            // checkout row so its switches and notices are kept as they are.
            store_setting_row($db, 'checkout', true);
            if (store_checkout_setting($db)['delivery_fee_fils'] !== $base) {
                $checkout = store_setting_row($db, 'checkout');
                $checkout['delivery_fee_fils'] = $base;
                store_setting_save($db, 'checkout', $checkout);
            }
            $db->commit();
        }
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
    if ($stale) store_fail('shipping_changed', 409);
    store_setting_row($db, 'shipping', true);
    store_setting_row($db, 'checkout', true);
    return store_shipping_admin($db);
}

/**
 * "What a customer pays" for a DRAFT, not saved: each sample is a goods
 * amount (after discounts, fils) and a governorate. Same validation, same
 * function as the checkout.
 */
function store_shipping_preview(array $body): array {
    [$value, $base] = store_shipping_validate(is_array($body['settings'] ?? null) ? $body['settings'] : []);
    $samples = $body['samples'] ?? [];
    if (!is_array($samples) || !array_is_list($samples) || count($samples) > 24) store_fail('invalid_shipping_samples');
    $out = [];
    foreach ($samples as $s) {
        if (!is_array($s)) store_fail('invalid_shipping_samples');
        $goods = store_shipping_int($s['goods_fils'] ?? null, 'shipping_sample_goods', 100000000);
        $gov = $s['governorate'] ?? null;
        if (!is_string($gov) || !in_array($gov, STORE_GOVERNORATES, true)) store_fail('invalid_governorate');
        $q = store_shipping_fee_for($value, $base, $gov, $goods);
        $out[] = ['goods_fils' => $goods, 'governorate' => $gov, 'fee_fils' => $q['fee_fils'],
                  'total_fils' => $goods + $q['fee_fils'], 'free' => $q['free'], 'available' => $q['available']];
    }
    return ['samples' => $out];
}

// Uploaded fonts live in a separate persistent media mount, not in the
// replaceable release tree. The database stores only a small manifest and the
// theme's four choices; a font's public path is always rebuilt from its random
// ID and detected format rather than trusted from a JSON row.
const STORE_FONT_CHOICES = [
    'body_en' => 'plex', 'display_en' => 'alexandria',
    'body_ar' => 'plex', 'display_ar' => 'alexandria',
];
const STORE_FONT_MAX_BYTES = 2097152;

function store_font_directory(): string {
    return dirname(__DIR__) . '/fonts/custom';
}

function store_font_format(string $bytes): ?string {
    $size = strlen($bytes);
    if ($size < 28 || $size > STORE_FONT_MAX_BYTES) return null;
    $magic = substr($bytes, 0, 4);
    if ($magic === 'wOF2' || $magic === 'wOFF') {
        $minimum = $magic === 'wOF2' ? 48 : 44;
        if ($size < $minimum) return null;
        $headerLength = unpack('Nlength', substr($bytes, 8, 4))['length'];
        $tableCount = unpack('ntables', substr($bytes, 12, 2))['tables'];
        if ($headerLength !== $size || $tableCount < 1 || $tableCount > 128) return null;
        return $magic === 'wOF2' ? 'woff2' : 'woff';
    }
    if ($magic !== "\x00\x01\x00\x00" && $magic !== 'OTTO') return null;
    $tableCount = unpack('ntables', substr($bytes, 4, 2))['tables'];
    if ($tableCount < 1 || $tableCount > 128 || 12 + 16 * $tableCount > $size) return null;
    return $magic === 'OTTO' ? 'otf' : 'ttf';
}

function store_font_library(PDO $db, bool $lock = false): array {
    if ($lock) {
        // Create the row before locking it, including on an older database
        // where this feature has never been used. Concurrent uploads then
        // serialize rather than replacing one another's manifest.
        $db->exec("insert ignore into settings (name, value) values ('font_library', '{\"items\":[]}')");
    }
    $q = $db->prepare('select value from settings where name = ?' . ($lock ? ' for update' : ''));
    $q->execute(['font_library']);
    $raw = json_decode((string)($q->fetchColumn() ?: ''), true);
    $rows = is_array($raw['items'] ?? null) ? $raw['items'] : [];
    $fonts = [];
    foreach (array_slice($rows, 0, 24) as $row) {
        if (!is_array($row)) continue;
        $id = $row['id'] ?? null;
        $format = $row['format'] ?? null;
        $name = $row['name'] ?? null;
        $bytes = $row['bytes'] ?? null;
        if (!is_string($id) || !preg_match('/^[a-f0-9]{20}$/D', $id)
            || !in_array($format, ['woff2', 'woff', 'ttf', 'otf'], true)
            || !is_string($name) || $name === '' || mb_strlen($name) > 80
            || !is_int($bytes) || $bytes < 28 || $bytes > STORE_FONT_MAX_BYTES
            || isset($fonts[$id])) continue;
        $fonts[$id] = [
            'id' => $id, 'name' => $name,
            'path' => '/fonts/custom/' . $id . '.' . $format,
            'format' => $format, 'bytes' => $bytes,
        ];
    }
    return $fonts;
}

function store_font_library_save(PDO $db, array $fonts): void {
    store_setting_save($db, 'font_library', ['items' => array_values($fonts)]);
}

function store_font_choices(array $raw, array $library, bool $strict = false): array {
    $given = $raw['fonts'] ?? null;
    if (array_key_exists('fonts', $raw) && !is_array($raw['fonts']) && $strict) store_fail('invalid_font_choice');
    $given = is_array($given) ? $given : [];
    $choices = [];
    foreach (STORE_FONT_CHOICES as $role => $fallback) {
        $choice = $given[$role] ?? $fallback;
        $valid = is_string($choice) && (in_array($choice, ['plex', 'alexandria'], true)
            || (preg_match('/^custom:([a-f0-9]{20})$/D', $choice, $match)
                && isset($library[$match[1]])
                && is_file(store_font_directory() . '/' . $match[1] . '.' . $library[$match[1]]['format'])));
        if (!$valid && $strict) store_fail('invalid_font_choice');
        $choices[$role] = $valid ? $choice : $fallback;
    }
    return $choices;
}

function store_font_in_use(array $choices, string $id): bool {
    return in_array('custom:' . $id, $choices, true);
}

function store_theme_with_fonts(PDO $db): array {
    $theme = store_setting($db, 'theme');
    $library = store_font_library($db);
    $theme['fonts'] = store_font_choices($theme, $library);
    $assets = [];
    foreach (array_unique(array_values($theme['fonts'])) as $choice) {
        if (!str_starts_with($choice, 'custom:')) continue;
        $id = substr($choice, 7);
        $assets[$id] = ['path' => $library[$id]['path'], 'format' => $library[$id]['format']];
    }
    $theme['font_assets'] = (object)$assets;
    return $theme;
}

function store_checkout_setting(PDO $db): array {
    $c = store_setting($db, 'checkout');
    $enabled = array_values(array_filter(STORE_CUSTOMER_PAY_METHODS, fn ($m) => !empty($c[$m])));
    if (!$enabled) $enabled = ['knet'];
    $default = in_array((string)($c['default_method'] ?? ''), $enabled, true)
        ? (string)$c['default_method'] : $enabled[0];
    return [
        'delivery_fee_fils' => max(0, min(100000, (int)($c['delivery_fee_fils'] ?? STORE_DELIVERY_FEE_FILS))),
        'methods' => $enabled,
        'default_method' => $default,
        'notice_en' => mb_substr(trim((string)($c['notice_en'] ?? '')), 0, 240),
        'notice_ar' => mb_substr(trim((string)($c['notice_ar'] ?? '')), 0, 240),
    ];
}

// Private merchant readiness is separate from the owner's saved switches.
// Missing/partial configuration must remove a bank from the public checkout
// before an order is inserted, without disabling its admin setting or exposing
// which secret is missing. No authentication or bank/network call is made.
function store_gateway_directory(string $method): ?string {
    $folders = ['knet' => ['knet', 'php-knet'], 'tpay' => ['pay', 'php-cbk']];
    if (!isset($folders[$method])) return null;
    $root = dirname(__DIR__);
    foreach ($folders[$method] as $folder) {
        if (is_dir($root . '/' . $folder)) return $root . '/' . $folder;
    }
    return null;
}

// ONE placeholder rule for every gateway secret. The checkout's method list and /backends status disagreed (the list
// refused four prefixes, /backends only YOUR_), so both call this.
function store_placeholder_secret($value): bool {
    $v = trim((string)$value);
    return $v === '' || (bool)preg_match('/^(YOUR_|PASTE_|CHANGE_ME|PROVIDED_BY_)/i', $v);
}

// The gateway must write to the orders database it reads. pay.php looks the order up in its own mysql_* block (or the
// store's db_* where that block is empty, the rule both loaders follow), so a block naming another database turns every
// payment into "Unknown order" AFTER the order and its stock already exist. Host, name and user must all match.
function store_gateway_db_matches(array $cfg, array $store): bool {
    foreach (['mysql_host' => 'db_host', 'mysql_name' => 'db_name', 'mysql_user' => 'db_user'] as $gw => $own) {
        $gwv = trim((string)($cfg[$gw] ?? ''));
        $ownv = trim((string)($store[$own] ?? ''));
        if ($gwv === '') $gwv = $ownv;          // borrowed, as the loaders do
        if ($gwv === '' || $ownv === '') return false;
        // "localhost", "127.0.0.1" and "::1" reach the same local server (the rig and the VPS write them both ways);
        // any other host must match exactly, and a name or user always must.
        if ($gw === 'mysql_host' && store_db_host_is_local($gwv) && store_db_host_is_local($ownv)) continue;
        if (!hash_equals($ownv, $gwv)) return false;
    }
    return true;
}

function store_db_host_is_local(string $host): bool {
    return in_array(strtolower(trim($host, '[]')), ['localhost', '127.0.0.1', '::1'], true);
}

function store_payment_config_ready(string $method, array $cfg): bool {
    try {
        $folder = store_gateway_directory($method);
        if ($folder === null) return false;
        $library = $folder . ($method === 'knet' ? '/knet.php' : '/cbk.php');
        if (!is_file($library) || !is_readable($library)) return false;
        require_once $library; // helper definitions only; never pay.php/callback.php
        $secrets = $method === 'knet'
            ? ['tranportal_id', 'tranportal_password', 'resource_key']
            : ['client_id', 'client_secret', 'encrp_key'];
        $fields = $method === 'knet'
            ? [...$secrets, 'env', 'test_url', 'production_url', 'response_url', 'error_url', 'language']
            : [...$secrets, 'env', 'test_base', 'production_base', 'return_url', 'result_page_url', 'lang'];
        foreach ($fields as $field) {
            if (isset($cfg[$field]) && !is_string($cfg[$field]) && !is_int($cfg[$field])) return false;
        }
        foreach ($secrets as $field) {
            $value = (string)($cfg[$field] ?? '');
            if (store_placeholder_secret($value) || $value !== trim($value)) return false;
        }
        if (!store_gateway_db_matches($cfg, store_config())) return false;
        if ($method === 'knet') {
            if (!function_exists('openssl_encrypt')) return false;
            knet_assert_payment_config($cfg);
        } else {
            if (!function_exists('curl_init')) return false;
            cbk_assert_payment_config($cfg);
        }
        return true;
    } catch (Throwable $e) {
        return false;
    }
}

function store_load_gateway_config(string $path): ?array {
    if (!is_file($path) || !is_readable($path)) return null;
    // Do not call gateway loaders: they intentionally exit on absent
    // configuration. Suppress incidental whitespace/BOM from private
    // config files so it cannot contaminate the API's JSON response.
    ob_start();
    try { $cfg = @require $path; }
    finally { ob_end_clean(); }
    return is_array($cfg) ? $cfg : null;
}

function store_gateway_ready(string $method, ?string $configPath = null): bool {
    if ($method === 'cod') return true;
    $folder = store_gateway_directory($method);
    if ($folder === null) return false;
    try {
        // KNET through CBK ("one setup", admin.php payment_knet_via_cbk): pay.php hands the order to the CBK page with the
        // T-Pay credentials, so KNET is ready exactly when the CBK side is. The direct Tranportal fields are not used then.
        if ($method === 'knet') {
            $cbkFolder = store_gateway_directory('tpay');
            $cbk = $cbkFolder === null ? null : store_load_gateway_config(sporta_config_path('tpay', $cbkFolder . '/config.php'));
            if (is_array($cbk) && !empty($cbk['knet_via_cbk'])) {
                return store_payment_config_ready('tpay', $cbk);
            }
        }
        $path = $configPath ?? sporta_config_path($method, $folder . '/config.php');
        $cfg = store_load_gateway_config($path);
        return $cfg !== null && store_payment_config_ready($method, $cfg);
    } catch (Throwable $e) {
        return false;
    }
}

function store_checkout_availability(array $setting, ?callable $ready = null): array {
    $ready ??= 'store_gateway_ready';
    $setting['methods'] = array_values(array_filter($setting['methods'], $ready));
    if (!in_array($setting['default_method'], $setting['methods'], true)) {
        $setting['default_method'] = $setting['methods'][0] ?? null;
    }
    return $setting;
}

function store_public_checkout_setting(PDO $db): array {
    $setting = store_checkout_setting($db);
    $saved = store_setting($db, 'checkout');
    // Public availability never re-enables a method whose saved switch is off,
    // even if malformed legacy settings triggered the admin reader's fallback.
    $setting['methods'] = array_values(array_filter(STORE_CUSTOMER_PAY_METHODS, fn ($method) => !empty($saved[$method])));
    return store_checkout_availability($setting);
}

// Is a dated window open right now? Either end may be null, meaning "no bound".
// Everything is compared in the database's own clock via gmdate, the same
// clock paid_at and created_at are written with, so a promotion cannot appear
// to start an hour early because PHP and MySQL disagree about the timezone.
function store_window_open(?string $starts, ?string $ends, ?string $now = null): bool {
    $now = $now ?? gmdate('Y-m-d H:i:s');
    if ($starts !== null && $starts !== '' && $starts > $now) return false;
    if ($ends   !== null && $ends   !== '' && $ends   < $now) return false;
    return true;
}

// ------------------------------------------------------------------- pricing
//
// THE price of a product right now, in integer fils.
//
// A sale price only counts inside its window and only if it is actually lower.
// Both guards matter: an expired sale that still applied would be a permanent
// unannounced discount, and a "sale" above the list price would quietly
// overcharge — the kind of mistake nobody reports because the customer just
// leaves. When either is true, the list price wins.
//
// Fils, not floats. KWD has exactly three decimals, so 10.000 KWD is 10000
// fils and integer arithmetic is exact. This is the same rule create_order
// already followed for line totals; percentages make it matter more, not less.
function store_fils(string|float|null $kwd): int {
    return (int)round(((float)$kwd) * 1000);
}

function store_kwd(int $fils): string {
    return number_format($fils / 1000, 3, '.', '');
}

function store_effective_price(array $product, ?string $now = null): array {
    $list = store_fils($product['price'] ?? 0);
    $sale = isset($product['sale_price']) && $product['sale_price'] !== null
        ? store_fils($product['sale_price'])
        : null;
    $on = $sale !== null
        && $sale > 0
        && $sale < $list
        && store_window_open($product['sale_starts_at'] ?? null, $product['sale_ends_at'] ?? null, $now);
    return ['fils' => $on ? $sale : $list, 'list_fils' => $list, 'on_sale' => $on];
}

// ----------------------------------------------------------------- discounts
//
// Everything below runs on the SERVER, from rows the browser cannot touch.
// The browser may name a code; it may never name an amount. That is the same
// rule that governs product prices, and it is load-bearing in exactly the same
// way: /pay/pay.php charges orders.amount, so anything that can move
// orders.amount can move what the bank collects.
//
// Order of application, fixed and documented because "which discount wins" is
// the question every shop eventually gets asked:
//   1. every qualifying AUTOMATIC rule, best first
//   2. then at most ONE typed code
//   3. the total is capped at STORE_DISCOUNT_MAX_PCT of the subtotal
// The cap is the backstop against a stacking mistake being a free order.
const STORE_DISCOUNT_MAX_PCT = 60;

// ------------------------------------------------- guessing codes
//
// Only a FAILED code lookup is counted — a shopper re-checking a basket with a
// code that works is not guessing, and on a carrier address forty phones may
// share one bucket. But counting failures alone used to leave the limiter
// answering the question it was protecting: once a client was over the limit,
// a WRONG code got 429 and a RIGHT code still got 200, so the 429 itself told
// a script "that one was wrong" and the guessing simply continued, one
// request per guess, at full speed.
//
// So every lookup of a TYPED code is COUNTED FIRST, before the code is looked
// at, and a full bucket refuses it whatever the code is. A code that turns out
// to be good gives its hit back (store_discount_succeeded), so successes still
// cost nothing. It used to peek first and count only after a failure, and a
// burst got through that: every request read "under the limit" before any
// failure was written (measured with 16 workers: 40 wrong codes evaluated
// against a limit of 30, the overshoot growing with the server's worker
// count). Counting first, the thirty-first lookup in a window is refused
// however many arrive at once.
//
// One budget for both routes that take a code (the preview and the order
// itself), so a script cannot alternate between them for twice the guesses.
// A request WITHOUT a code is never counted and never refused here: it asks
// nothing about codes, and the live checkout cannot place any order until its
// empty-code price quote has answered.
const STORE_DISCOUNT_FAIL_MAX    = 30;
const STORE_DISCOUNT_FAIL_WINDOW = 600;

/** @return array the counter state, for store_discount_succeeded() */
function store_discount_attempt(PDO $db): array {
    $state = store_rate_limit_hit($db, 'discount', store_client_identity(),
        STORE_DISCOUNT_FAIL_MAX, STORE_DISCOUNT_FAIL_WINDOW);
    if (!$state['allowed']) store_rate_limit_fail($state['retry_after']);
    return $state;
}

function store_discount_succeeded(PDO $db, array $state): void {
    store_rate_limit_refund($db, $state);
}

// What one rule takes off, in fils. `$eligibleFils` is the part of the order
// the rule may act on — the whole subtotal, or just one category's lines.
function store_discount_amount(array $d, int $eligibleFils): int {
    if ($eligibleFils <= 0) return 0;
    $off = $d['type'] === 'percent'
        // intdiv, so a percentage of an odd number of fils rounds DOWN and the
        // shop never gives away a fil it did not mean to.
        ? intdiv($eligibleFils * (int)round((float)$d['value']), 100)
        : store_fils($d['value']);
    return max(0, min($off, $eligibleFils));
}

// Every live rule, with the typed code (if any) resolved.
//
// Returns ['applied' => [...], 'total_fils' => int, 'error' => ?string]. An
// unusable code is reported, never silently ignored: a customer who typed
// SAVE10 and was charged full price will not assume they mistyped, they will
// assume the shop cheated them.
function store_discounts_for(PDO $db, array $lines, int $subtotalFils, ?string $code): array {
    $now = gmdate('Y-m-d H:i:s');
    $applied = [];
    $error = null;

    // How much of this order sits in each category, so a category-restricted
    // rule acts on its own lines only.
    $byCategory = [];
    foreach ($lines as $l) {
        $cat = (string)($l['category'] ?? '');
        $byCategory[$cat] = ($byCategory[$cat] ?? 0) + $l['line_fils'];
    }
    $eligible = function (?string $cat) use ($subtotalFils, $byCategory): int {
        return ($cat === null || $cat === '') ? $subtotalFils : ($byCategory[$cat] ?? 0);
    };

    $usable = function (array $d) use ($now, $subtotalFils, $eligible): ?string {
        if (!(int)$d['active'])                                        return 'discount_inactive';
        if (!store_window_open($d['starts_at'], $d['ends_at'], $now))  return 'discount_expired';
        if ((int)$d['usage_limit'] > 0
            && (int)$d['used_count'] >= (int)$d['usage_limit'])        return 'discount_used_up';
        if ($subtotalFils < store_fils($d['min_order']))               return 'discount_min_order';
        if ($eligible($d['category']) <= 0)                            return 'discount_not_applicable';
        return null;
    };

    // 1. automatic rules — best first, so if two apply the customer gets the
    //    better one at the front and the cap (if it bites) trims the weaker.
    $autos = $db->query("select * from discounts where kind = 'auto' and active = 1")->fetchAll();
    $scored = [];
    foreach ($autos as $d) {
        if ($usable($d) !== null) continue;
        $off = store_discount_amount($d, $eligible($d['category']));
        if ($off > 0) $scored[] = ['d' => $d, 'off' => $off];
    }
    usort($scored, fn ($a, $b) => $b['off'] <=> $a['off']);
    foreach ($scored as $s) {
        $applied[] = ['id' => (int)$s['d']['id'], 'code' => null, 'label' => $s['d']['label'],
                      'fils' => $s['off']];
    }

    // 2. one typed code
    $code = strtoupper(trim((string)$code));
    if ($code !== '') {
        $q = $db->prepare("select * from discounts where kind = 'code' and code = ?");
        $q->execute([$code]);
        $d = $q->fetch();
        if (!$d) {
            $error = 'discount_unknown';
        } elseif (($why = $usable($d)) !== null) {
            $error = $why;
        } else {
            $off = store_discount_amount($d, $eligible($d['category']));
            if ($off <= 0) $error = 'discount_not_applicable';
            else $applied[] = ['id' => (int)$d['id'], 'code' => $d['code'], 'label' => $d['label'],
                               'fils' => $off];
        }
    }

    // 3. the cap. Trimmed from the LAST rule backwards so the first (best)
    //    discount survives intact and the customer sees the one they were
    //    promised, not two halves of two.
    $cap = intdiv($subtotalFils * STORE_DISCOUNT_MAX_PCT, 100);
    $total = array_sum(array_column($applied, 'fils'));
    for ($i = count($applied) - 1; $i >= 0 && $total > $cap; $i--) {
        $trim = min($applied[$i]['fils'], $total - $cap);
        $applied[$i]['fils'] -= $trim;
        $total -= $trim;
    }
    $applied = array_values(array_filter($applied, fn ($a) => $a['fils'] > 0));

    return ['applied' => $applied, 'total_fils' => array_sum(array_column($applied, 'fils')),
            'error' => $error];
}

// Claim the usage slots, inside the order's own transaction.
//
// The guarded UPDATE is the whole point: `used_count < usage_limit` in the
// WHERE means two simultaneous checkouts cannot both take the last use of a
// one-per-shop code. If the claim does not land, the caller must fail the
// order rather than honour a discount that is gone — a code that can be used
// twice is a code that can be used a thousand times.
function store_discounts_claim(PDO $db, array $applied): bool {
    // RACE K1-2: in id order, whatever order the cart ranked them in (best
    // first). The claim is all-or-nothing, so the order changes no outcome; it
    // only stops two carts that rank the same two rules differently from each
    // holding one row and waiting for the other.
    usort($applied, static fn (array $a, array $b): int => (int)$a['id'] <=> (int)$b['id']);
    // Prepared once, executed per rule — the same shape store_price_lines()
    // uses for the cart. Re-preparing identical SQL inside a loop is a round
    // trip per iteration for nothing.
    $st = $db->prepare(
        'update discounts set used_count = used_count + 1
          where id = ? and (usage_limit = 0 or used_count < usage_limit)'
    );
    foreach ($applied as $a) {
        $st->execute([$a['id']]);
        if ($st->rowCount() !== 1) return false;
    }
    return true;
}

// GIVE THE USES BACK — the other half of store_discounts_claim().
//
// A limited code is claimed inside the order's transaction, and until this
// existed nothing ever returned the use: an order that never happened (a
// declined card, an abandoned bank page, an expired cash order, a bot's fake
// order) spent it for good, and a few fake orders could finish a launch code
// before a real customer had it.
//
// orders.discount_ids holds every rule the order claimed — codes and automatic
// rules alike, since the claim counts a use against each. The flag
// discount_released is set FIRST, guarded, under the caller's row lock and in
// the caller's transaction, so the sweeper and a retry cannot both give the
// same use back; `used_count > 0` keeps a counter that was reset by hand from
// going negative. The caller decides WHEN (store_stock_release: failed,
// cancelled, or a card reservation released) — this only does it once.
//
// Returns how many uses were given back. Until discount-release.mysql.sql is
// imported there is nothing recorded to give back, and it returns 0.
function store_discount_release(PDO $db, int $orderId): int {
    if (!store_column_exists($db, 'orders', 'discount_ids')) return 0;
    $q = $db->prepare('select discount_ids from orders
                        where id = ? and discount_released = 0 and discount_ids is not null');
    $q->execute([$orderId]);
    $raw = $q->fetchColumn();
    if ($raw === false || $raw === null) return 0;
    $ids = json_decode((string)$raw, true);
    $ids = is_array($ids) ? array_values(array_unique(array_filter(array_map('intval', $ids), fn ($i) => $i > 0))) : [];
    sort($ids); // RACE K1-2: id order, the same as the claim
    $flag = $db->prepare('update orders set discount_released = 1 where id = ? and discount_released = 0');
    $flag->execute([$orderId]);
    if ($flag->rowCount() !== 1) return 0;
    $back = $db->prepare('update discounts set used_count = used_count - 1 where id = ? and used_count > 0');
    $n = 0;
    foreach ($ids as $id) {
        $back->execute([$id]);
        $n += $back->rowCount();
    }
    return $n;
}

// ------------------------------------------------------- claiming the garment
//
// THE SHOP COULD SELL WHAT IT DID NOT HAVE, and it was not close. Measured: a
// size with stock 0 accepted an order for FIFTY, answered 200 with a track id,
// and left the stock at 0 — so the next customer saw the same shelf and could
// do it again. The size ladder greys out sold-out sizes, but that is the READ
// path; nothing on the WRITE path ever looked at the number. Anyone posting
// straight to /api, or holding a page opened ten minutes ago, walked through.
//
// The same guarded-UPDATE shape as store_discounts_claim() above, and for the
// same reason: `stock >= ?` inside the WHERE is what makes two simultaneous
// checkouts for one last jacket resolve to one winner. Reading the stock and
// then updating it would be a race with money on it — both would read 1, both
// would write 0, and both customers would be told yes.
//
// WHAT IS DELIBERATELY NOT COUNTED. A product with no rows in product_variants
// — the backpack, the cap, the phone strap — has no stock figure anywhere, so
// there is nothing to check and nothing to decrement. Those lines pass
// through. Inventing a count for them would mean refusing orders on the
// strength of a number nobody has ever set.
//
// Returns ['short' => null, 'claimed' => n, 'units' => u] — lines and pieces
// taken — when every tracked line was taken,
// or ['short' => [...]] naming the line that could not be — with what is
// actually left, because "out of stock" on a page showing eight items is not
// something a shopper can act on.
//
// `claimed` is counted rather than inferred from the cart, because "the order
// named a size" and "the order took stock" are different questions and reading
// one as the other is what put a false stock_claimed flag on accessory orders.
function store_stock_claim(PDO $db, array $lines): array {
    // RACE K1-1: variant rows are taken in (slug, size) order, whatever order
    // the cart listed them in. A copy: the caller keeps its own order for the
    // order items it writes. The sort is stable, so two lines of one size keep
    // their relative order.
    usort($lines, 'store_variant_cmp');
    $take = $db->prepare(
        'update product_variants
            set stock = stock - ?, inventory_version = inventory_version + 1
          where slug = ? and size = ? and stock >= ?'
    );
    // RACE K1-11: the number a refused shopper is told. A plain SELECT inside
    // this REPEATABLE-READ transaction reads the snapshot taken when the order
    // began, so a cart that lost the last unit to a request that committed while
    // it waited was told "1 left" about a shelf that was empty (measured: 1 of 15
    // refusals). FOR UPDATE reads the latest committed row, and the failed UPDATE
    // above already holds that lock, so it waits for nobody.
    $left = $db->prepare('select stock from product_variants where slug = ? and size = ? for update');
    // IS THIS PRODUCT STOCK-TRACKED AT ALL — which is not the same question as
    // "did the order name a size", and reading it as such broke a working
    // checkout. A cart may carry a size for a product that has NO variant rows
    // (nothing forbids it; store_price_lines only requires a size when rows
    // exist), and the claim then tried to decrement a row that was never there,
    // found nothing, and refused the order with «0 left» for a garment that was
    // in fact freely available. Untracked means untracked: no rows, no claim.
    $tracked = $db->prepare('select 1 from product_variants where slug = ? limit 1');
    $known = [];
    $claimed = 0;
    $units = 0;
    foreach ($lines as $l) {
        if ($l['size'] === null) continue;
        if (!array_key_exists($l['slug'], $known)) {
            $tracked->execute([$l['slug']]);
            $known[$l['slug']] = (bool)$tracked->fetchColumn();
        }
        if (!$known[$l['slug']]) continue;
        $take->execute([$l['qty'], $l['slug'], $l['size'], $l['qty']]);
        if ($take->rowCount() === 1) { $claimed++; $units += (int)$l['qty']; continue; }
        // Either the shelf is short or there is no such variant at all. Both
        // are "you cannot have this", and both are reported with the number
        // the shopper needs — zero in the second case.
        $left->execute([$l['slug'], $l['size']]);
        $have = $left->fetchColumn();
        return ['short' => ['slug' => $l['slug'], 'size' => $l['size'],
                            'want' => $l['qty'], 'have' => $have === false ? 0 : (int)$have],
                'claimed' => $claimed, 'units' => $units];
    }
    return ['short' => null, 'claimed' => $claimed, 'units' => $units];
}

// How long an unconfirmed cash-on-delivery order may hold its stock, in hours.
// Config `cod_hold_hours`: ABSENT (or null, or '' — this config's spelling of
// "not set") means the default, 24, the owner's choice; an explicit 0 switches
// the expiry off, which is how this behaved before. Capped at 30 days so a
// typo cannot quietly mean "never". One reader for the setting, so the
// sweeper's candidate query and the release itself cannot disagree.
const STORE_COD_HOLD_HOURS_DEFAULT = 24;

function store_cod_hold_hours(): int {
    $raw = store_config()['cod_hold_hours'] ?? null;
    if ($raw === null || $raw === '') return STORE_COD_HOLD_HOURS_DEFAULT;
    return max(0, min(720, (int)$raw));
}

// Put it back. Called when an order is abandoned or its payment fails.
//
// STOCK IS RESERVED AT CHECKOUT, BEFORE THE BANK IS EVEN CONTACTED, because
// that is where the race is: the moment two people can both be told yes. The
// cost of reserving early is that an order nobody pays for holds the garment,
// so there has to be a way to release it — otherwise a fortnight of abandoned
// KNET redirects quietly empties the shop while the shelves are full.
//
// Idempotent by the caller's contract: it is guarded by orders.stock_released
// so a double call (a failed callback retried, then the sweeper) cannot restock
// the same order twice, which would be inventing garments.
//
// AN UNCONFIRMED CASH ORDER EXPIRES TOO (owner's decision, 2026-11-02). A COD
// order is free to place and claims real stock, so until this existed a few
// requests could hold the whole shop indefinitely: every one of them stayed
// 'pending' and 'unfulfilled' for ever, and the sweeper deliberately never
// looked at COD. Now a COD order that is STILL pending AND STILL unfulfilled
// store_cod_hold_hours() after it was placed is CANCELLED here, and its stock
// put back, in this one transaction, so it stops counting against the phone's
// STORE_COD_OPEN_MAX. Anything the shop has touched is left alone: packed,
// shipped or delivered, and anything paid. A COD order that claimed no stock
// (accessories only) is cancelled all the same; there is simply nothing to
// put back.
//
// THE WAREHOUSE MAY ALREADY HAVE BEEN TOLD TO SHIP IT. A cash order's picking
// list goes out on INSERT and says COLLECT CASH — that means ship — so being
// cancelled in the database does not stop a van. The same transaction
// therefore queues a 'cancel' message ("CANCELLED — do not ship", both
// languages); cron-fulfilment.php drops it unsent if the warehouse never heard
// of the order. cron-stock.php's JSON names what it cancelled (cod_cancelled),
// so the owner can call those customers — the run does not mail it anywhere.
// And if the owner puts the order back in
// /backends (it was real after all), store_order_reinstate() claims its stock
// and its discount uses again, or refuses — a reinstated order is never
// shipped from a shelf it gave back.
//
// A CARD ORDER THAT HOLDS ONLY DISCOUNT USES EXPIRES WITH ITS HOLD. An order
// that claimed no stock (accessories only) used to stay payable for ever, and
// so kept its uses of a limited code for ever: one such order a minute, never
// paid, used up a launch code at no cost. Once its hold has passed, a pending
// KNET / T-Pay order that still holds uses is cancelled here like one whose
// stock is released (pay.php refuses both, and a late capture of either is
// parked for review), and the uses go back. One that holds nothing is left
// alone: there is nothing to give back and no reason to make it unpayable.
//
// An order that is not happening also gives its DISCOUNT USES back here, once
// (store_discount_release) — whether or not it held stock.
//
// Returns true when it changed anything (cancelled, restocked, gave discount
// uses back, or any of those together).
function store_stock_release(PDO $db, int $orderId, int $holdMinutes = 120): bool {
    $codHours = store_cod_hold_hours();
    // Before discount-release.mysql.sql there is no record of what an order
    // claimed, so nothing can be known to hold a use.
    $holdsDiscount = store_column_exists($db, 'orders', 'discount_ids')
        ? '(discount_ids is not null and discount_released = 0)' : '0';
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) $db->beginTransaction();
    try {
        // The sweeper's earlier candidate list is only a hint. Payment
        // callbacks lock this same row, so whichever commits first determines
        // whether the order can still release stock.
        $q = $db->prepare(
            "select stock_claimed, stock_released, payment_status, payment_method,
                    fulfilment_status, {$holdsDiscount} as holds_discount,
                    (created_at < (now() - interval ? minute)) as hold_expired,
                    (created_at < (now() - interval ? hour)) as cod_hold_expired
               from orders where id = ? for update"
        );
        $q->execute([max(15, $holdMinutes), max(1, $codHours), $orderId]);
        $order = $q->fetch();

        $codExpired = $order && $codHours > 0
            && $order['payment_method'] === 'cod'
            && $order['payment_status'] === 'pending'
            && $order['fulfilment_status'] === 'unfulfilled'
            && (int)$order['cod_hold_expired'] === 1;
        $cardExpired = $order && !$codExpired
            && in_array($order['payment_method'], ['knet', 'tpay'], true)
            && $order['payment_status'] === 'pending'
            && $order['fulfilment_status'] === 'unfulfilled'
            && (int)$order['stock_claimed'] === 0
            && (int)$order['holds_discount'] === 1
            && (int)$order['hold_expired'] === 1;
        if ($codExpired || $cardExpired) {
            // Guarded by the same conditions, under the row lock taken above,
            // so a status change that committed first wins.
            $db->prepare(
                "update orders set fulfilment_status = 'cancelled'
                  where id = ? and payment_method = ? and payment_status = 'pending'
                    and fulfilment_status = 'unfulfilled'"
            )->execute([$orderId, $order['payment_method']]);
            store_tracking_event($db, $orderId, 'cancelled');
            // The "do not ship", for a picking list that said COLLECT CASH. A
            // card order's said AWAITING PAYMENT — hold, which already means
            // do not ship, and its expiry has never sent a follow-up.
            if ($codExpired) store_fulfilment_cancelled($db, $orderId);
            $order['fulfilment_status'] = 'cancelled';
        }

        // PAID is never released. REVIEW is released only once a PERSON has
        // cancelled the order. A capture parked for review (wrong amount, no
        // payment id, an unrecognised result) keeps its garments claimed on
        // purpose, because the money may be real; but the owner settles it at
        // the bank and cancels it in /backends, and that cancel was accepted
        // while every release path skipped 'review': the order stayed
        // stock_claimed=1 / stock_released=0 / discount_released=0 for ever, the
        // shelf short by its pieces and a limited code short by its spent use.
        // A review order that is NOT cancelled still holds everything. The
        // stock_released / discount_released flags, read under this row lock,
        // stop a second release.
        $reviewKept = $order && $order['payment_status'] === 'review'
            && $order['fulfilment_status'] !== 'cancelled';
        $eligible = $order && (int)$order['stock_claimed'] === 1
            && (int)$order['stock_released'] === 0
            && $order['payment_status'] !== 'paid'
            && !$reviewKept
            && ($order['payment_status'] === 'failed'
                || $order['fulfilment_status'] === 'cancelled'
                || ($order['payment_status'] === 'pending'
                    && in_array($order['payment_method'], ['knet', 'tpay'], true)
                    && (int)$order['hold_expired'] === 1));

        // The discount uses go back for the orders that can no longer be paid:
        // failed, cancelled (which includes an expired cash order, above), and
        // a card order whose reservation is being released right now — pay.php
        // refuses an order once its stock is gone, or once it is cancelled
        // (which a card order holding only uses now is, above). Never a paid
        // order; one under review only once it has been cancelled.
        $dead = $order && $order['payment_status'] !== 'paid' && !$reviewKept
            && ($order['payment_status'] === 'failed'
                || $order['fulfilment_status'] === 'cancelled'
                || $eligible);
        $gaveBack = $dead && store_discount_release($db, $orderId) > 0;

        if (!$eligible) {
            if ($ownsTransaction && !$db->commit()) throw new RuntimeException('Stock release commit failed');
            return $codExpired || $cardExpired || $gaveBack;
        }

        // Aggregate sizes: two fits of one garment can be separate order
        // lines, while a joined UPDATE only updates each variant once.
        //
        // RACE K1-4: ONE UPDATE PER VARIANT, in the claim's (slug, size) order.
        // The joined UPDATE this replaces visited the rows in product-id order
        // (the derived table is grouped by product_id), so a release and a
        // checkout for the same two sizes could each hold one row and wait for
        // the other. Same rows, same arithmetic; a variant that no longer
        // exists is skipped, exactly as the join skipped it.
        $sold = $db->prepare(
            'select p.slug, oi.size, sum(oi.qty) as qty
               from order_items oi join products p on p.id = oi.product_id
              where oi.order_id = ? and oi.size is not null
              group by p.slug, oi.size'
        );
        $sold->execute([$orderId]);
        $rows = $sold->fetchAll();
        usort($rows, 'store_variant_cmp');
        $put = $db->prepare(
            'update product_variants
                set stock = stock + ?, inventory_version = inventory_version + 1
              where slug = ? and size = ?'
        );
        foreach ($rows as $r) $put->execute([(int)$r['qty'], (string)$r['slug'], (string)$r['size']]);
        $db->prepare('update orders set stock_released = 1 where id = ?')->execute([$orderId]);
        if ($ownsTransaction && !$db->commit()) throw new RuntimeException('Stock release commit failed');
        return true;
    } catch (Throwable $e) {
        if ($ownsTransaction && $db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

// ------------------------------------------- bringing a cancelled order back
//
// A CANCELLED ORDER COULD BE PUT BACK WITHOUT ITS STOCK. Cancelling releases
// what an order held — its garments go back on the shelf (stock_released) and
// its discount uses back to the code (discount_released) — and /backends let
// the owner move the order on to packed or shipped afterwards with neither
// taken again. Measured: a cash order for 2 jackets, auto-cancelled at 24 h
// (stock 998 → 1000), re-marked packed → 200, and stock stayed 1000 — two
// jackets on the van and on sale again, and a single-use code free for a
// second customer. The 24-hour auto-cancel makes this the obvious next step
// for a real order the owner simply did not mark in time.
//
// So an order leaving 'cancelled' takes back what it gave: every stock-tracked
// line is claimed again by store_stock_claim() — the same guarded UPDATE as
// checkout, so a size that has sold since is refused with the checkout's own
// out_of_stock_<slug>_<size>_<left>, 409 — and every discount use it gave back
// is claimed again by store_discounts_claim(), refused with discount_used_up,
// 409, if the code has been used up since. Nothing half-done: the caller holds
// the order's row lock and its transaction, and rolls back on a refusal.
//
// Returns null when the order may go on, or [token, http status].
function store_order_reinstate(PDO $db, int $orderId): ?array {
    $refused = store_order_reclaim($db, $orderId);
    if ($refused !== null) return $refused;
    store_fulfilment_reinstate($db, $orderId);
    return null;
}

// The stock and the discount uses half of the above, which is also what
// settling a card order by hand needs when its reservation was released while
// it waited for the bank (stock_released = 1 on an order that was never
// cancelled): the same claims, the same refusals, nothing about the warehouse.
function store_order_reclaim(PDO $db, int $orderId): ?array {
    $hasDiscount = store_column_exists($db, 'orders', 'discount_ids');
    $q = $db->prepare('select stock_claimed, stock_released'
        . ($hasDiscount ? ', discount_ids, discount_released' : '') . ' from orders where id = ?');
    $q->execute([$orderId]);
    $o = $q->fetch();
    if (!$o) return ['order_not_found', 404];

    // RACE K1-3: the discount rows this order gave back are LOCKED FIRST, in id
    // order, because checkout takes the discount before the variant and this
    // function used to take the variant first and the discount second: a
    // reinstate and a checkout using the same code and the same size each held
    // one and waited for the other. The lock also drops the rules the owner has
    // since deleted. The claim itself stays where it was, after the stock, so
    // the refusal a caller sees first is unchanged.
    $discountIds = [];
    if ($hasDiscount && (int)$o['discount_released'] === 1) {
        $ids = json_decode((string)($o['discount_ids'] ?? ''), true);
        $ids = is_array($ids) ? array_values(array_unique(array_filter(array_map('intval', $ids), fn ($i) => $i > 0))) : [];
        if ($ids) {
            $marks = implode(',', array_fill(0, count($ids), '?'));
            $live = $db->prepare("select id from discounts where id in ({$marks}) order by id for update");
            $live->execute($ids);
            $discountIds = array_map('intval', $live->fetchAll(PDO::FETCH_COLUMN));
        }
    }

    if ((int)$o['stock_claimed'] === 1 && (int)$o['stock_released'] === 1) {
        // Summed per garment and size, exactly as store_stock_release() put
        // them back, so two lines of one size are claimed as the one shelf.
        $it = $db->prepare(
            'select p.slug, oi.size, sum(oi.qty) as qty
               from order_items oi join products p on p.id = oi.product_id
              where oi.order_id = ? and oi.size is not null
              group by p.slug, oi.size'
        );
        $it->execute([$orderId]);
        $lines = array_map(static fn (array $r): array => [
            'slug' => (string)$r['slug'], 'size' => (string)$r['size'], 'qty' => (int)$r['qty'],
        ], $it->fetchAll());
        $claim = store_stock_claim($db, $lines);
        if ($short = $claim['short']) {
            return [sprintf('out_of_stock_%s_%s_%d', $short['slug'], $short['size'], $short['have']), 409];
        }
        $db->prepare('update orders set stock_released = 0 where id = ?')->execute([$orderId]);
    }

    if ($hasDiscount && (int)$o['discount_released'] === 1) {
        // A rule the owner has since DELETED has no use to take (it was left out
        // of $discountIds when the rows were locked above); one that still
        // exists must have one free, or the order is refused.
        if (!store_discounts_claim($db, array_map(static fn (int $id): array => ['id' => $id], $discountIds))) {
            return ['discount_used_up', 409];
        }
        $db->prepare('update orders set discount_released = 0 where id = ?')->execute([$orderId]);
    }

    return null;
}

// The warehouse's side of a cancel and a reinstate: what fulfilment_outbox
// holds, and which of it may still be mailed.
//
// A row the drain does NOT mail is CLOSED: sent_at is set, with last_error
// saying why it never went. Three spellings, one definition — a closed row is
// not a message the warehouse holds:
//   'order cancelled'   the order was no longer happening when the row came up
//   'order reinstated'  the order was put back before the row went out
//   'order shipped'     the order had left the shop (shipped or delivered)
// store_outbox_heard() ignores all three, and cron-fulfilment.php closes rows
// by the same spellings. Keep them in step with that file.
const STORE_OUTBOX_CLOSED_CANCELLED  = 'order cancelled';
const STORE_OUTBOX_CLOSED_REINSTATED = 'order reinstated';
const STORE_OUTBOX_CLOSED_SHIPPED    = 'order shipped';
// NOT a closed spelling: a row the drain has decided to send and is handing to
// the mail relay right now (cron-fulfilment.php). sent_at is set while it is
// in flight, so everything that asks "has the warehouse been told?" (the admin
// routes, store_outbox_heard) answers as it will be true a moment later, and
// the order's row lock is NOT held through the network call. A run that dies
// mid-send leaves it behind; the next run turns it back into an unsent row.
const STORE_OUTBOX_SENDING           = 'sending';
// The same three, as an SQL list. The constants are fixed strings, never input.
const STORE_OUTBOX_CLOSED_SPELLINGS  = "'order cancelled', 'order reinstated', 'order shipped'";

// A cancel the owner (or the sweeper) made, told to the warehouse: one 'cancel'
// message — "CANCELLED — do not ship". cron-fulfilment.php drops it unsent when
// nothing about the order ever reached the warehouse.
function store_fulfilment_cancelled(PDO $db, int $orderId): void {
    store_queue_fulfilment($db, $orderId, 'cancel');
}

// Has the warehouse been sent anything about this order? A row counts once it
// really went out: sent_at set, and not one closed unsent (see above).
function store_outbox_heard(PDO $db, int $orderId): bool {
    $q = $db->prepare("select count(*) from fulfilment_outbox
                        where order_id = ? and sent_at is not null
                          and coalesce(last_error, '') not in (" . STORE_OUTBOX_CLOSED_SPELLINGS . ")");
    $q->execute([$orderId]);
    return (int)$q->fetchColumn() > 0;
}

// Why an unsent row must NOT be mailed, or null when it may go. The drain asks
// this for every row under the order's row lock, so the decision and the mail
// see the same order state.
//
//   * A CANCELLED order. Its picking list and its reinstate are closed: a
//     picking list after a "do not ship" is a van sent for an order the shop
//     has given up. A 'payment' or 'cancel' goes out ONLY when the warehouse has
//     already heard about the order — then it is the follow-up that corrects
//     what they hold, and dropping it would leave them with a picking list and
//     no do-not-ship. Nothing heard: the row is closed, and nothing is mailed.
//   * A SHIPPED or DELIVERED order. Nothing that tells the warehouse to dispatch
//     may go: a picking list ('new'), a payment ('payment') or a REINSTATED
//     picking list ('reinstate' — the full list, address and COLLECT CASH
//     banner, so a dispatch instruction like the first). The parcel has left
//     the shop, and a second van is a second delivery. A 'cancel' is not a
//     dispatch message and is left alone. This is also the way the owner
//     corrects a cash order the 24-hour sweep cancelled after the van had
//     gone: moving it out of 'cancelled' queues a reinstate, and recording it
//     as delivered must not send the warehouse the list again.
//   * A 'cancel' row for an order that is NOT cancelled (live, shipped or
//     delivered): the do-not-ship was withdrawn by a reinstate and is moot. The
//     reinstate closes unsent such rows itself; this is the same answer for a
//     cancel that was in flight when the reinstate happened and was then
//     repaired to unsent, including when the reinstated order has since moved
//     on to shipped or delivered.
function store_outbox_closed_reason(string $kind, string $orderStatus, bool $warehouseHeard): ?string {
    if ($orderStatus === 'cancelled') {
        if (in_array($kind, ['new', 'reinstate'], true)) return STORE_OUTBOX_CLOSED_CANCELLED;
        return $warehouseHeard ? null : STORE_OUTBOX_CLOSED_CANCELLED;
    }
    // A 'cancel' row for an order that is no longer cancelled is a do-not-ship
    // the shop has withdrawn, WHATEVER the order's status now is. This is decided
    // before the shipped/delivered branch: a cancel can only exist on a shipped
    // or delivered order through a reinstate (the admin refuses to cancel an
    // order that has left, and the sweeper cancels only unfulfilled ones), and
    // one that was in flight when the reinstate ran (step 1 of
    // store_fulfilment_reinstate() closes only unsent cancels) would otherwise be
    // mailed afterwards, leaving the warehouse with "CANCELLED - do not ship" as
    // its last word on a parcel the shop has recorded as shipped.
    if ($kind === 'cancel') return STORE_OUTBOX_CLOSED_REINSTATED;
    if (in_array($orderStatus, ['shipped', 'delivered'], true)) {
        return in_array($kind, ['new', 'payment', 'reinstate'], true) ? STORE_OUTBOX_CLOSED_SHIPPED : null;
    }
    return null;
}

// The order is on again. The warehouse has been told one of two things, and
// each has its own answer:
//   1. a "do not ship" still waiting to go is withdrawn, unsent;
//   2. a REINSTATED picking list that is still waiting already answers
//      everything, and a second one would be the same list twice: nothing more;
//   3. a "do not ship" that really went out is answered once, with the picking
//      list again, marked REINSTATED. A picking list still waiting is closed
//      as superseded by it, so the warehouse never holds two.
//      "Really went out" means a cancel sent AFTER the last REINSTATED row:
//      a cancel answered by an earlier reinstate is not owed a second one;
//   4. nothing was said to the warehouse: a picking list closed unsent BECAUSE
//      the order was cancelled, or one that failed to send five times, goes
//      out after all, with its attempts counted from zero. A CLOSED row is
//      one with sent_at SET and last_error 'order cancelled' (that is how the
//      drain and the sweeper close it), so it is matched by its spelling —
//      matching `sent_at is null` here found only the failed ones, and a live
//      order whose picking list had been closed stayed invisible to the
//      warehouse, with only a bare "ship it" to follow when its cash was
//      recorded.
function store_fulfilment_reinstate(PDO $db, int $orderId): void {
    // 1.
    $db->prepare("update fulfilment_outbox set sent_at = now(), last_error = ?
                   where order_id = ? and kind = 'cancel' and sent_at is null")
       ->execute([STORE_OUTBOX_CLOSED_REINSTATED, $orderId]);
    // 2.
    $q = $db->prepare("select count(*) from fulfilment_outbox
                        where order_id = ? and kind = 'reinstate' and sent_at is null");
    $q->execute([$orderId]);
    if ((int)$q->fetchColumn() > 0) return;
    // 3. A row's id is its place in the queue, so "after the last reinstate"
    // is "id greater than the last reinstate's id". Every reinstate row counts,
    // closed or not: a closed one still answered the cancels before it.
    $last = $db->prepare("select coalesce(max(id), 0) from fulfilment_outbox
                           where order_id = ? and kind = 'reinstate'");
    $last->execute([$orderId]);
    $lastId = (int)$last->fetchColumn();
    $q = $db->prepare("select count(*) from fulfilment_outbox
                        where order_id = ? and kind = 'cancel' and sent_at is not null and id > ?
                          and coalesce(last_error, '') not in (" . STORE_OUTBOX_CLOSED_SPELLINGS . ")");
    $q->execute([$orderId, $lastId]);
    if ((int)$q->fetchColumn() > 0) {
        $db->prepare("update fulfilment_outbox set sent_at = now(), last_error = ?
                       where order_id = ? and kind = 'new' and sent_at is null")
           ->execute([STORE_OUTBOX_CLOSED_REINSTATED, $orderId]);
        store_queue_fulfilment($db, $orderId, 'reinstate');
        return;
    }
    // 4. A picking list that failed five times is included: the owner's
    // reinstate is the one moment it is certain the order is wanted again.
    $db->prepare("update fulfilment_outbox set sent_at = null, last_error = null, attempts = 0
                   where order_id = ? and kind = 'new'
                     and ((sent_at is null and attempts >= 5) or last_error = ?)")
       ->execute([$orderId, STORE_OUTBOX_CLOSED_CANCELLED]);
}

// A fact about the shop's own machinery, for the Activity page. Written by a
// cron, so there is no administrator to name: the actor is 'system'. Logging
// is best-effort and never costs the caller its own write — the same rule as
// store_admin_event(), which needs an admin row and so cannot be reused here.
function store_system_event(PDO $db, string $action): void {
    if (!preg_match('/^[a-z][a-z0-9_]{0,79}$/D', $action)) return;
    try {
        $db->prepare("insert into admin_activity_log (actor_admin_id, actor_email, action_key)
                      values (null, 'system', ?)")->execute([$action]);
    } catch (Throwable $e) {
        error_log('Sporta system activity logging unavailable');
    }
}

// ------------------------------------------------------- how big an order is
//
// ONE ORDER COULD RESERVE THE WHOLE SHOP. Stock is claimed at checkout, before
// anyone pays (see store_stock_claim), and a cash-on-delivery order is free
// to place — so the request limit was the only bound, and it counts requests,
// not garments. Measured on a live-shaped sandbox: four COD orders from one
// address, built from the public ?r=stock feed, held all 1,236 units.
//
// The cap is on what one ORDER can claim, and it involves no IP at all, so
// shoppers who share a carrier address are untouched. 10 is the most the live
// shop stocks of any one size; 20 pieces is a very large order for a shop
// that takes about one a week. Every payment method, not only COD: a card
// order holds its stock for two hours before the sweeper gives it back,
// which is the same lever on a shorter handle.
const STORE_ORDER_MAX_UNITS       = 20;
const STORE_ORDER_MAX_PER_VARIANT = 10;

// Applied to PRICED lines (store_price_lines has already validated slugs,
// sizes and quantities). Lines are summed per product and size first, so the
// same jacket in the same size split across two lines — or across two fits —
// is one variant, which is how the stock is counted. A product with no sizes
// is its own single variant. Untracked products count towards the total too:
// the cap is on the order, not on the inventory.
//
// The refusal is cart_too_large, the token api.php already gives a cart of
// more than 50 lines, and on purpose: the LIVE storefront words it in both
// languages ("That is too many items for one order. Please split it.") and
// treats it as final, while a new token would fall through to its generic
// "We could not start the payment. Please try again." — wrong for cash on
// delivery, and an invitation to resend the same refused order.
function store_order_size_guard(array $lines, int $maxUnits = STORE_ORDER_MAX_UNITS): void {
    $total = 0;
    $perVariant = [];
    foreach ($lines as $l) {
        $qty = (int)$l['qty'];
        $total += $qty;
        $key = $l['slug'] . '|' . ($l['size'] ?? '');
        $perVariant[$key] = ($perVariant[$key] ?? 0) + $qty;
        if ($perVariant[$key] > STORE_ORDER_MAX_PER_VARIANT) store_fail('cart_too_large');
    }
    if ($total > max(1, $maxUnits)) store_fail('cart_too_large');
}

// ------------------------------------------ what one client may hold unpaid
//
// THE SIZE CAP BOUNDS ONE ORDER, NOT ONE CLIENT. Every order claims its stock
// before anybody pays, a KNET / T-Pay order keeps it for stock_hold_minutes
// (120 by default, plus up to a sweeper interval), and a cash order for
// cod_hold_hours. Measured after the size cap: one client placed six KNET
// orders of 20 pieces back to back, each with a different made-up phone, and
// held 120 units — at one order a minute (the cooldown) that is about 2,400
// units held at any moment, and the live catalogue (~1,236) is empty within an
// hour and stays empty while the script runs. The per-phone cash cap does not
// help: phone numbers cost nothing to invent.
//
// So the CLIENT (store_client_identity: an IPv4 address, an IPv6 /64) has a
// budget counted in PIECES, not requests: at most order_client_units (default
// 40) stock-tracked pieces claimed by its orders per two hours, whatever the
// payment method. Counted inside the order's own transaction, after the claim,
// so an order that rolls back (out of stock, a used-up code) gives its pieces
// back by rolling back, and a refused order counts nothing. Accessories, which
// claim no stock, are not counted.
//
// What it costs a real shopper: two 20-piece orders in two hours from one
// carrier address are still accepted, and a shop that takes about one order a
// week does not see two shoppers on one CGNAT address place forty pieces in
// two hours. What it does NOT do: stop a script that rotates addresses — the
// per-address limits never could. It bounds what one address can hold.
//
// The refusal is 429 previous_order_pending + Retry-After, the token the LIVE
// storefront already words as "an earlier attempt may already have created an
// order … so we do not reserve the same items twice" — the honest reading of
// "this connection already holds a lot of unpaid stock".
//
// 'order_client_units' => 0 switches it off. The test sandbox does: its suites
// place hundreds of pieces from one address. test:native proves it on a store
// of its own.
const STORE_ORDER_CLIENT_UNITS        = 40;
const STORE_ORDER_CLIENT_UNITS_WINDOW = 7200;

function store_order_client_units(): int {
    $v = store_config()['order_client_units'] ?? null;
    if ($v === null || $v === '') return STORE_ORDER_CLIENT_UNITS;
    return max(0, min(1000, (int)$v));
}

// Add this order's pieces to the client's window and say whether they still
// fit. MUST run inside the order's transaction: the row lock it takes on the
// window serialises two orders from one client, and the rollback of a refused
// or failed order is what takes its pieces back out.
/** @return array{allowed:bool,retry_after:int} */
function store_order_units_take(PDO $db, string $identity, int $units): array {
    $max = store_order_client_units();
    if ($max <= 0 || $units <= 0) return ['allowed' => true, 'retry_after' => 0];
    $window = STORE_ORDER_CLIENT_UNITS_WINDOW;
    $now = time();
    $start = $now - ($now % $window);
    $key = store_rate_limit_key('order_units', $identity === '' ? 'unknown' : $identity);
    $db->prepare('insert into rate_limit (bucket_key, window_start, hits) values (?, ?, ?)
                  on duplicate key update hits = hits + ?')
       ->execute([$key, $start, $units, $units]);
    $q = $db->prepare('select hits from rate_limit where bucket_key = ? and window_start = ?');
    $q->execute([$key, $start]);
    return ['allowed' => (int)$q->fetchColumn() <= $max, 'retry_after' => max(1, $start + $window - $now)];
}

// ------------------------------------------------------------- pricing a cart
//
// Turn the browser's items into priced lines. ONE implementation, used by both
// create_order and the discount preview — a preview computed by different code
// from the charge is a preview that can promise a total the checkout refuses,
// and the customer sees the shop change its price at the last step.
//
// Every line is validated before anything is written, so a bad cart is
// rejected with the token naming the problem rather than a rolled-back
// mystery. The unit price is the EFFECTIVE price (a live sale, else the list
// price), read from the table at this instant. Nothing the browser sent has
// been near it.
function store_price_lines(PDO $db, array $items): array {
    $lines = [];
    $q = $db->prepare(
        'select id, price, sale_price, sale_starts_at, sale_ends_at, category,
                name_en, name_ar
           from products where slug = ? and active = 1'
    );
    foreach ($items as $item) {
        if (!is_array($item) || array_is_list($item)) store_fail('invalid_item');
        $slug = store_input_string($item['slug'] ?? null, 'slug', 160);
        if (!preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $slug)) store_fail('invalid_slug');
        $rawQty = $item['qty'] ?? 1;
        if (!is_int($rawQty) && !(is_string($rawQty) && preg_match('/^[1-9][0-9]{0,1}$/D', $rawQty))) {
            store_fail('invalid_qty');
        }
        $qty = (int)$rawQty;
        if ($qty < 1 || $qty > 99) store_fail('invalid_qty');

        $size = strtoupper(trim(store_input_string($item['size'] ?? null, 'size', 16)));
        $fit  = strtolower(trim(store_input_string($item['fit'] ?? null, 'fit', 24)));
        // Rejected, never silently dropped — a dropped size is an order that
        // looks complete and does not say which size to pack.
        if ($size !== '' && !in_array($size, STORE_SIZES, true)) store_fail('invalid_size');
        if ($fit  !== '' && !in_array($fit,  STORE_FITS,  true)) store_fail('invalid_fit');

        $q->execute([$slug]);
        $prod = $q->fetch();
        if (!$prod) store_fail('unavailable_' . $slug);

        // A SIZE IS REQUIRED EXACTLY WHEN THE PRODUCT HAS SIZES.
        //
        // The comment four lines up says a dropped size is "an order that
        // looks complete and does not say which size to pack" — and then an
        // ABSENT size was accepted, because only an invalid one was rejected.
        // The browser's size ladder is what enforced it, which makes the rule
        // a front-end convention rather than a rule: anything posting
        // straight to /api could book a t-shirt with no size, and the
        // warehouse would get an order it cannot fill.
        //
        // Conditional on the catalogue, not hard-coded, because it has to
        // stay true for both halves of it. Nineteen active products — a
        // backpack, a cap, a phone strap — have no size rows at all and must
        // remain orderable without one. So the question asked is the only one
        // that means anything: does THIS product have sizes, and did the order
        // name one?
        if ($size === '') {
            $hasSizes = $db->prepare('select 1 from product_variants where slug = ? limit 1');
            $hasSizes->execute([$slug]);
            if ($hasSizes->fetchColumn()) store_fail('size_required_' . $slug);
        }

        $eff = store_effective_price($prod);
        $lines[] = [
            'product_id' => (int)$prod['id'],
            // Carried because product_variants is keyed on slug+size, not on
            // product_id — store_stock_claim() needs it and the id will not do.
            'slug'       => $slug,
            // THE NAME AS IT IS BEING SOLD, carried onto the order line beside
            // the price. Same rule as unit_price and discount_label: an invoice
            // records what happened, and a later rename must not rewrite it.
            'name_en'    => (string)$prod['name_en'],
            'name_ar'    => (string)$prod['name_ar'],
            'qty'        => $qty,
            'unit_price' => store_kwd($eff['fils']),
            'unit_fils'  => $eff['fils'],
            'line_fils'  => $eff['fils'] * $qty,
            'category'   => $prod['category'],
            'size'       => $size === '' ? null : $size,
            'fit'        => $fit  === '' ? null : $fit,
        ];
    }
    return $lines;
}

// A datetime from the admin's <input type="datetime-local">, or null.
//
// The browser sends "2026-08-14T18:00" with no zone. The whole system compares
// against gmdate(), so the value is stored verbatim as UTC and the admin form
// says so — the alternative is guessing a timezone, and a promotion that
// starts three hours early because the server disagreed with the browser is a
// bug nobody can see until a customer gets a price nobody meant to offer.
function store_datetime(mixed $raw): ?string {
    $v = trim(store_input_string($raw, 'date', 32));
    if ($v === '') return null;
    $v = str_replace('T', ' ', $v);
    if (!preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/', $v)) store_fail('invalid_date');
    return strlen($v) === 16 ? $v . ':00' : $v;
}

// A link the admin may point a hero button or the promo bar at.
//
// SAME ORIGIN ONLY. These are the most prominent links on the site, rendered
// inside the shop's own design, so an off-site URL here would be the brand
// lending its credibility to somewhere else — and a "javascript:" or "data:"
// one would be script execution from a form field. A path, or nothing.
function store_internal_href(mixed $raw): ?string {
    $v = trim(store_input_string($raw, 'link', 2048));
    if ($v === '') return null;
    // A LEADING DOUBLE SLASH IS NOT A PATH, IT IS A HOSTNAME. //evil.com is a
    // protocol-relative URL: the browser reads it as https://evil.com and
    // leaves the shop. It starts with / and contains only characters from the
    // list below, so the original pattern accepted it — a function whose only
    // job is "same-origin paths" handing back an off-site link.
    //
    // It takes an admin session to set one, so this is not an open door; it is
    // the difference between one compromised login and a phishing page that
    // real customers reach by clicking the hero button on sporta.com.kw. A
    // link that leaves the site should never be spellable here at all.
    //
    // Backslash was already refused by the character list, which matters more
    // than it used to: react-router treats a backslash the way browsers do
    // (CVE-2025-68470 and its bypass), so \\evil.com is the same trick in
    // different punctuation. Both are now refused explicitly.
    if (!preg_match('~^/(?![/\\\\])[A-Za-z0-9/_\-\?=&%\.#]{0,180}$~', $v)) store_fail('invalid_link');
    return $v;
}

// ============================================================ customer reviews
//
// Asking every customer what they thought, and paying 20% for the answer.
//
// WHY THE DISCOUNT IS FOR **SPORTA'S** REVIEW AND NOT FOR A GOOGLE ONE.
// Google forbids offering anything of value in exchange for a review, and it
// enforces that by deleting the reviews and, at its discretion, suspending the
// Business Profile. Buying fifty reviews and losing all fifty plus the listing
// is strictly worse than never asking. So the shop pays for its OWN review —
// an ordinary loyalty offer, nobody's policy violation — and the thank-you
// page invites Google afterwards with nothing attached. The customer who has
// just written something kind is the one most likely to write it again, and
// that invitation is allowed precisely because the code is already theirs.
//
// AND WHY ONE STAR PAYS THE SAME AS FIVE. Rewarding only good ratings is
// review gating: against Google's policy in its own right, unlawful in several
// markets, and it makes the shop's own average a number that means nothing
// because the unhappy customers were filtered out of it. A one-star review
// with a paragraph about a late delivery is the most useful row this table
// will ever hold, and the shop should pay for it gladly.

// The link a customer is sent is `/review?o=<track>&t=<sig>`, and this is the
// signature. Same construction as the assistant's speech tag and for the same
// reason: it proves the shop issued this link, so the endpoint cannot be walked
// by trying track ids. Keyed on cron_key, which never leaves the server.
//
// It is DERIVED, not stored — there is no token column and no row to create
// when an order is placed. A link is therefore valid from the moment the order
// exists, cannot be exhausted, and needs no cleanup.
function store_review_sig(string $trackId): string {
    $cfg = store_config();
    // 32 hex characters. This gates a 20% code on one order, not a bank
    // transfer; 128 bits is far past what forging it is worth.
    return substr(hash_hmac('sha256', 'review' . "\0" . $trackId,
                            (string)($cfg['cron_key'] ?? '')), 0, 32);
}

// Constant-time compare, because a byte-at-a-time strcmp on a signature is a
// timing oracle. hash_equals costs nothing and removes the question.
function store_review_token_ok(string $trackId, string $token): bool {
    $cfg = store_config();
    // NO KEY, NO REVIEWS. An empty cron_key would make every signature the HMAC
    // of an empty secret — which is to say, forgeable by anyone who reads this
    // file. Fail closed rather than issue codes to strangers.
    if (($cfg['cron_key'] ?? '') === '') return false;
    return hash_equals(store_review_sig($trackId), $token);
}

// ------------------------------------------- customer email verification
//
// customers.mysql.sql (email verification section, 2026-11-12) adds customer_accounts.email_verified_at and the
// customer_email_verifications table. Code that relies on them asks first, so
// a release that lands before the migration degrades (no verification mail,
// no birthday gift) instead of answering 500 on every registration.
function customer_verify_ready(PDO $db): bool {
    static $ready = null;
    if ($ready !== null) return $ready;
    try {
        $ready = store_column_exists($db, 'customer_accounts', 'email_verified_at')
            && store_column_exists($db, 'customer_email_verifications', 'token_hash');
    } catch (Throwable $e) {
        $ready = false;
    }
    return $ready;
}

// ------------------------------------------------------------- invoice links
//
// THE ORDER NUMBER OPENS A LIMITED INVOICE; THE FULL ONE NEEDS A SECOND THING.
// An order number travels far: the URL bar, the warehouse mail, the bank
// reference, WhatsApp, screenshots. With it alone ?r=invoice used to return the
// customer's name and full address. Now that takes one of:
//   * a signed key (?k=), issued by the server where the server hands out the
//     invoice (a new order's answer, the signed-in customer's order list);
//   * the phone captured at checkout (X-Sporta-Phone header, never the query
//     string, so it stays out of access logs) - the same proof the returns
//     page asks for;
//   * the signed-in customer who owns the order (session cookie).
// The key is "<expiry unix>.<32 hex>" and lives STORE_INVOICE_KEY_TTL seconds;
// keyed on cron_key like the review link, and an empty cron_key means no key
// verifies (fail closed: the order number still opens the limited invoice).
const STORE_INVOICE_KEY_TTL = 7 * 86400;

function store_invoice_sig(string $trackId, int $exp): string {
    $cfg = store_config();
    return substr(hash_hmac('sha256', 'invoice' . "\0" . $trackId . "\0" . $exp,
                            (string)($cfg['cron_key'] ?? '')), 0, 32);
}

function store_invoice_key(string $trackId, ?int $now = null): ?string {
    if ((string)(store_config()['cron_key'] ?? '') === '' || $trackId === '') return null;
    $exp = ($now ?? time()) + STORE_INVOICE_KEY_TTL;
    return $exp . '.' . store_invoice_sig($trackId, $exp);
}

function store_invoice_key_ok(string $trackId, mixed $key, ?int $now = null): bool {
    if (!is_string($key) || $trackId === '' || (string)(store_config()['cron_key'] ?? '') === '') return false;
    if (!preg_match('/^([0-9]{9,11})\.([a-f0-9]{32})$/D', $key, $m)) return false;
    $exp = (int)$m[1];
    if ($exp < ($now ?? time()) || $exp > ($now ?? time()) + STORE_INVOICE_KEY_TTL + 60) return false;
    return hash_equals(store_invoice_sig($trackId, $exp), $m[2]);
}

// What a caller holding only the order number may see of the buyer: the
// first letter of the name, and the governorate and area (enough to recognise
// the order, not enough to find the door). Same keys as the full answer, the
// rest null, so the compiled invoice page renders it without a change.
function store_invoice_limited_name(string $name): string {
    $name = trim($name);
    return $name === '' ? '' : mb_substr($name, 0, 1) . '.';
}

// The order a review link points at, or null. Only real, non-cancelled orders
// can be reviewed: there is nothing to say about an order that never happened,
// and a cancelled one would be a code for no purchase.
function store_review_order(PDO $db, string $trackId, string $token): ?array {
    if ($trackId === '' || !store_review_token_ok($trackId, $token)) return null;
    $q = $db->prepare('select o.id, o.track_id, o.customer_name, o.customer_lang,
                              o.fulfilment_status, o.payment_status,
                              r.rating, r.reward_code
                         from orders o
                    left join reviews r on r.order_id = o.id
                        where o.track_id = ?');
    $q->execute([$trackId]);
    $row = $q->fetch();
    if (!$row || $row['fulfilment_status'] === 'cancelled') return null;
    return $row;
}

// The code a review earns.
//
// A REAL ROW IN `discounts`, not a special case. Checkout already knows how to
// price a code, cap it, refuse an expired one and claim a single-use one inside
// the order's transaction — and every one of those rules would have to exist
// twice if reviews minted their own kind of code. The 60% stack cap and the
// 90% per-rule ceiling apply to this exactly as they apply to everything else.
function store_review_reward(PDO $db, int $orderId): ?string {
    $pct = (float) STORE_REVIEW_REWARD_PCT;
    if ($pct <= 0) return null;   // the shop can turn the reward off entirely

    // Unambiguous alphabet: no O/0, no I/1. This code is read off a phone
    // screen and typed into a box, sometimes by someone reading it aloud.
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for ($attempt = 0; $attempt < 5; $attempt++) {
        $suffix = '';
        for ($i = 0; $i < 6; $i++) $suffix .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        $code = 'SHUKRAN' . $suffix;   // شكرًا — thank you
        try {
            $db->prepare(
                'insert into discounts (kind, code, label, type, value, usage_limit, active, ends_at)
                 values (?, ?, ?, ?, ?, 1, 1, ?)'
            )->execute([
                'code', $code, 'Review thank-you', 'percent', $pct,
                // Ninety days. An open-ended code is a liability that never
                // ages off the books, and a deadline is also what makes the
                // offer worth acting on.
                gmdate('Y-m-d H:i:s', time() + 90 * 86400),
            ]);
            return $code;
        } catch (PDOException $e) {
            // 1062 = the code already exists. Astronomically unlikely at 32^6,
            // but a collision must mint a new code rather than hand back
            // somebody else's single-use one.
            if ((int)($e->errorInfo[1] ?? 0) !== 1062) throw $e;
        }
    }
    return null;
}

// Record a review and issue its code, atomically.
//
// ONE TRANSACTION, because the two halves must not be able to disagree. A
// review saved without a code is a customer who was promised 20% and got
// nothing; a code issued without a review is a code printer. The unique index
// on order_id is what makes a double submission collapse into the first one
// rather than into a second code.
function store_review_submit(PDO $db, array $order, int $rating, ?string $comment, string $lang): array {
    $db->beginTransaction();
    try {
        // Claim the order first. If this throws 1062 someone already reviewed
        // it — including the same person double-tapping the button.
        $ins = $db->prepare('insert into reviews (order_id, rating, comment, lang) values (?, ?, ?, ?)');
        try {
            $ins->execute([(int)$order['id'], $rating, $comment, $lang]);
        } catch (PDOException $e) {
            if ((int)($e->errorInfo[1] ?? 0) === 1062) {
                $db->rollBack();
                // Not an error to the customer: hand back the code they already
                // earned, so a refresh shows the same thing rather than a
                // failure they cannot act on.
                $q = $db->prepare('select rating, reward_code from reviews where order_id = ?');
                $q->execute([(int)$order['id']]);
                $prev = $q->fetch() ?: [];
                return ['already' => true, 'code' => $prev['reward_code'] ?? null,
                        'rating' => (int)($prev['rating'] ?? 0)];
            }
            throw $e;
        }
        $code = store_review_reward($db, (int)$order['id']);
        if ($code !== null) {
            $db->prepare('update reviews set reward_code = ? where order_id = ?')
               ->execute([$code, (int)$order['id']]);
        }
        $db->commit();
        return ['already' => false, 'code' => $code, 'rating' => $rating];
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}

// SEO metadata uses the same database and validation helpers, but stays in a
// small file so the order/payment core does not become a second page editor.
require_once __DIR__ . '/seo-config.php';

// ------------------------------------------------- device passcode (quick unlock)
//
// A six-digit passcode lets a browser that has signed in before come back without the
// full password. It works only where the admin device cookie for THIS account is present
// (issued at a full sign-in, after any second step), so it cannot be used from a new
// browser. Five wrong passcodes lock the passcode for fifteen minutes; the password is
// not affected. Changing the password clears the passcode.
const STORE_ADMIN_PASSCODE_MAX_WRONG = 5;
const STORE_ADMIN_PASSCODE_LOCK_MINUTES = 15;
// Passcode evaluations per account per UTC day. Wrong ones only, in effect: a
// correct passcode gives its hit back. Same ceiling as the phone code.
const STORE_ADMIN_PASSCODE_DAY_MAX = 20;

function store_admin_passcode_valid(string $passcode): bool {
    return (bool)preg_match('/^\d{6}$/D', $passcode);
}

// True only when this browser holds the admin device cookie for the account.
function store_passcode_device_ok(string $email): bool {
    return store_admin_device_for(store_login_identity($email)) !== null;
}

// What the sign-in screen may learn without a session. It says "enabled" only for a browser
// that has signed in here before; every other case answers the same, so the answer is not an
// account-existence check.
function store_passcode_public_status(PDO $db, string $email): array {
    $email = mb_strtolower(trim($email));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !store_passcode_device_ok($email)) {
        return ['enabled' => false];
    }
    // An account with phone-code (TOTP) sign-in on never gets the passcode shortcut: a device cookie plus six digits
    // would be a way around the second factor, and the session it made did not carry the second-factor fingerprint
    // anyway (it was ended on the next request). Fail closed; the owner can decide on a deliberate bypass later.
    $q = $db->prepare('select passcode_hash, totp_enabled, (passcode_locked_until is not null and passcode_locked_until > now()) as is_locked
                         from admin_users where email = ?');
    $q->execute([$email]);
    $row = $q->fetch();
    return ['enabled' => (bool)$row && $row['passcode_hash'] !== null && (int)$row['is_locked'] === 0
        && (int)$row['totp_enabled'] !== 1];
}

function store_passcode_login(string $email, string $passcode): array {
    $db = store_db();
    $email = mb_strtolower(trim($email));
    $validShape = strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL)
        && store_admin_passcode_valid($passcode);
    if (!$validShape || !store_passcode_device_ok($email)) store_fail('passcode_unavailable', 403);

    $q = $db->prepare('select id, email, password_hash, must_change_password, passcode_hash, passcode_failed, totp_enabled,
                              (passcode_locked_until is not null and passcode_locked_until > now()) as passcode_locked,
                              (locked_until is not null and locked_until > now()) as is_locked
                         from admin_users where email = ?');
    $q->execute([$email]);
    $u = $q->fetch();
    if (!$u || $u['passcode_hash'] === null || (int)$u['totp_enabled'] === 1) store_fail('passcode_unavailable', 403);
    if ((int)$u['is_locked'] === 1) store_fail('locked', 423);
    if ((int)$u['passcode_locked'] === 1) store_fail('passcode_locked', 423);

    $id = (int)$u['id'];

    // CLAIM THE ATTEMPT BEFORE THE PASSCODE IS CHECKED. The counter used to be
    // read in one statement and written in another after password_verify, so a
    // burst of parallel guesses all read "under five" and were all evaluated
    // (measured: 40 of 40). Now each attempt must win one guarded UPDATE: it
    // succeeds only while the passcode is unlocked (or its lock has expired)
    // and fewer than five attempts are open, so at most five requests can ever
    // reach the check below, however many arrive at once. A lock that has
    // expired starts the count again at one, in the same statement.
    $claim = $db->prepare('update admin_users
            set passcode_failed = last_insert_id(if(passcode_locked_until is not null and passcode_locked_until <= now(),
                                     1, passcode_failed + 1)),
                passcode_locked_until = if(passcode_locked_until is not null and passcode_locked_until <= now(),
                                           null, passcode_locked_until)
          where id = ? and passcode_hash is not null
            and (passcode_locked_until is null or passcode_locked_until <= now())
            and (passcode_failed < ' . STORE_ADMIN_PASSCODE_MAX_WRONG . '
                 or (passcode_locked_until is not null and passcode_locked_until <= now()))');
    $claim->execute([$id]);
    if ($claim->rowCount() !== 1) store_fail('passcode_locked', 423);
    // THIS request's slot number, as the UPDATE wrote it. LAST_INSERT_ID(expr)
    // is per connection, so a parallel request that claimed the next slot in
    // between cannot change what this one reads (a SELECT here could).
    $attempt = (int)$db->query('select last_insert_id()')->fetchColumn();

    // A DAILY CEILING, per account, counted for every CLAIMED attempt (so a burst
    // refused by the lock does not spend it) and before the passcode is checked - the
    // fifteen-minute lock alone still allows ~480 guesses a day at a six-digit
    // passcode (one in ~2000 a day). Same shape as the phone-code ceiling
    // (STORE_ADMIN_TOTP_DAY_MAX); a correct passcode gives its hit back below.
    $day = store_rate_limit_hit($db, 'admin_passcode_account_day', (string)$id, STORE_ADMIN_PASSCODE_DAY_MAX, 86400);
    if (!$day['allowed']) {
        // Lock the passcode as well (review finding, medium): the claim above already counted this attempt, so
        // without a lock the next guesses are refused only until the day's window moves, and every refusal
        // still counts. The same fifteen-minute lock as five wrong guesses.
        $db->prepare('update admin_users set passcode_locked_until = now() + interval ' . STORE_ADMIN_PASSCODE_LOCK_MINUTES . ' minute where id = ?')
           ->execute([$id]);
        if (store_rate_limit_once($db, 'admin_passcode_alert_day', (string)$id, 86400)) {
            store_admin_code_alert($u, 'passcode_day');
        }
        store_fail('passcode_locked', 423);
    }

    if (!store_admin_verify_password($passcode, (string)$u['passcode_hash'])) {
        if ($attempt >= STORE_ADMIN_PASSCODE_MAX_WRONG) {
            // The attempt that used up the fifth slot sets the lock and clears
            // the counter for after it. Only one request holds that slot.
            $db->prepare('update admin_users set passcode_failed = 0,
                          passcode_locked_until = now() + interval ' . STORE_ADMIN_PASSCODE_LOCK_MINUTES . ' minute
                          where id = ?')->execute([$id]);
            if (store_rate_limit_once($db, 'admin_passcode_alert_lock', (string)$id, 900)) {
                store_admin_code_alert($u, 'passcode_lock');
            }
            store_fail('passcode_locked', 423);
        }
        store_fail('wrong_passcode', 401);
    }

    // Right passcode: the attempt was the owner's, so the day's hit is given
    // back and the counter starts again.
    store_rate_limit_refund($db, $day);
    $db->prepare('update admin_users set passcode_failed = 0, passcode_locked_until = null where id = ?')
       ->execute([$id]);
    store_admin_grant($db, $u);
    return ['email' => $u['email']];
}

// Set or clear the passcode from a signed-in session. The current password is required, so a
// session left open at a shared machine cannot quietly add a way back in.
function store_passcode_change(PDO $db, array $admin, string $password, ?string $passcode): void {
    $q = $db->prepare('select password_hash from admin_users where id = ?');
    $q->execute([(int)$admin['id']]);
    $row = $q->fetch();
    if (!$row || !store_admin_verify_password($password, (string)$row['password_hash'])) {
        store_fail('wrong_password', 403);
    }
    if ($passcode === null) {
        $db->prepare('update admin_users set passcode_hash = null, passcode_failed = 0, passcode_locked_until = null where id = ?')
           ->execute([(int)$admin['id']]);
        store_admin_event($db, $admin, 'passcode_clear');
        return;
    }
    if (!store_admin_passcode_valid($passcode)) store_fail('invalid_passcode', 400);
    $db->prepare('update admin_users set passcode_hash = ?, passcode_failed = 0, passcode_locked_until = null where id = ?')
       ->execute([store_admin_hash_password($passcode), (int)$admin['id']]);
    store_admin_event($db, $admin, 'passcode_set');
}

// ---------------------------------------------------- payment environments
// KNET and the CBK connection each keep a TEST and a PRODUCTION set of
// credentials (test_* / production_*); the unprefixed keys the gateways read
// are a copy of the active set. Moving a config to another environment copies
// that environment's slots into the active keys. A config written before the
// slots existed has only the active keys: they are kept as the slot of the
// environment it was in, never copied into the other one.
function store_payment_apply_env(array $cfg, string $gateway, string $env): array {
    $previous = in_array(($cfg['env'] ?? ''), ['test', 'production'], true) ? (string)$cfg['env'] : 'test';
    $names = $gateway === 'knet'
        ? ['tranportal_id', 'tranportal_password', 'resource_key', 'merchant_id', 'terminal_id']
        : ['client_id', 'client_secret', 'encrp_key'];
    foreach (['test', 'production'] as $slot) {
        foreach ($names as $name) {
            $key = $slot . '_' . $name;
            if (!array_key_exists($key, $cfg)) $cfg[$key] = $slot === $previous ? (string)($cfg[$name] ?? '') : '';
        }
    }
    foreach ($names as $name) $cfg[$name] = (string)$cfg[$env . '_' . $name];
    $cfg['env'] = $env;
    return $cfg;
}

// ------------------------------------------- KNET values the raw wire can carry
// The same two rules knet/knet.php applies before it sends anything
// (KNET_GATEWAY_URLS, knet_raw_value_problem), held here for admin.php's
// payment_config save so a value that would be refused at checkout is refused
// when it is typed instead. Two copies of one rule, so test:knet runs the same
// lists through both (KNET-IPAYPIPE-CHECK.md D3, D6).
//
// The gateway: exactly the bare or the www. host of the environment, path
// /kpg/PaymentHTTP.htm, nothing else (no port, user, query or fragment).
function store_knet_gateway_url_ok(string $url, string $env): bool {
    $allowed = [
        'test'       => ['https://kpaytest.com.kw/kpg/PaymentHTTP.htm', 'https://www.kpaytest.com.kw/kpg/PaymentHTTP.htm'],
        'production' => ['https://kpay.com.kw/kpg/PaymentHTTP.htm', 'https://www.kpay.com.kw/kpg/PaymentHTTP.htm'],
    ];
    return isset($allowed[$env]) && in_array($url, $allowed[$env], true);
}

// A value that travels RAW inside the KNET request trandata (Tranportal ID,
// password, response and error URL): no '&', '=', '?', '#' and no control
// characters, because the bank splits on '&' and '=' and decodes nothing.
function store_knet_raw_value_ok(string $value): bool {
    return strpbrk($value, '&=?#') === false && preg_match('/[\x00-\x1F\x7F]/', $value) !== 1;
}

// Atomic write of a gateway config: a temp file beside it, 0600, rename.
function store_payment_write_config(string $path, array $cfg): void {
    $tmp = $path . '.tmp.' . bin2hex(random_bytes(6));
    $php = "<?php\n// Managed by Sporta Backends. Secrets are never returned to the browser.\nreturn "
        . var_export($cfg, true) . ";\n";
    if (file_put_contents($tmp, $php, LOCK_EX) === false) store_fail('config_not_writable', 500);
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        store_fail('config_not_writable', 500);
    }
    clearstatcache(true, $path);
    if (function_exists('opcache_invalidate')) @opcache_invalidate($path, true);
}
