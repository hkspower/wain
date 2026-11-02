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

// Called wherever payment_status reaches a settled state — the callback and
// the admin's mark-cash-paid. Mirrors trg_queue_fulfilment_payment.
function store_payment_settled(PDO $db, int $orderId, string $newStatus): void {
    if (in_array($newStatus, ['paid', 'failed'], true)) {
        store_queue_fulfilment($db, $orderId, 'payment');
    }
    // The customer hears from us only when the money is actually in. 'failed'
    // deliberately sends nothing: a shopper whose card was declined is already
    // looking at the failure on screen, and a WhatsApp message about it would
    // arrive minutes later, out of context, about an order they may have
    // already re-placed successfully.
    if ($newStatus === 'paid') {
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
// hosting where none of those exist. Most callers use the client IP; admin
// authentication also uses a separately hashed, normalised account identity
// so rotating IP addresses cannot turn one account into an email target.
//
// It counts only FAILED lookups. A customer with a real code who re-checks
// their basket four times is not attacking anything, and throttling them would
// break the feature to protect it.
function store_normalize_ip(mixed $value): string {
    if (!is_string($value)) return '';
    $value = trim($value);
    if (filter_var($value, FILTER_VALIDATE_IP) === false) return '';
    $packed = @inet_pton($value);
    return $packed === false ? '' : (string)inet_ntop($packed);
}

function store_ip_matches_rule(string $ip, mixed $rule): bool {
    if (!is_string($rule) || $rule === '') return false;
    $rule = trim($rule);
    if (!str_contains($rule, '/')) return hash_equals(store_normalize_ip($rule), $ip);
    [$network, $rawBits] = array_pad(explode('/', $rule, 2), 2, '');
    $network = store_normalize_ip($network);
    if ($network === '' || !preg_match('/^(?:0|[1-9][0-9]{0,2})$/D', $rawBits)) return false;
    $packedIp = @inet_pton($ip);
    $packedNetwork = @inet_pton($network);
    if ($packedIp === false || $packedNetwork === false || strlen($packedIp) !== strlen($packedNetwork)) return false;
    $bits = (int)$rawBits;
    $maxBits = strlen($packedIp) * 8;
    if ($bits < 0 || $bits > $maxBits) return false;
    $whole = intdiv($bits, 8);
    $partial = $bits % 8;
    if ($whole > 0 && substr($packedIp, 0, $whole) !== substr($packedNetwork, 0, $whole)) return false;
    if ($partial === 0) return true;
    $mask = (0xff << (8 - $partial)) & 0xff;
    return (ord($packedIp[$whole]) & $mask) === (ord($packedNetwork[$whole]) & $mask);
}

function store_trusted_proxy_rules(): array {
    $raw = store_config()['trusted_proxy_ips'] ?? [];
    if (is_string($raw)) $raw = preg_split('/\s*,\s*/', trim($raw), -1, PREG_SPLIT_NO_EMPTY);
    return is_array($raw) ? array_values(array_filter($raw, 'is_string')) : [];
}

function store_ip_is_trusted_proxy(string $ip, array $rules): bool {
    if ($ip === '') return false;
    foreach ($rules as $rule) {
        if (store_ip_matches_rule($ip, $rule)) return true;
    }
    return false;
}

// Never trust X-Forwarded-For merely because it exists: a browser can send
// that header too. Only a REMOTE_ADDR explicitly listed in the server-only
// config may introduce a forwarded chain. Walk from the trusted ingress back
// towards the client and take the first untrusted hop; prepended spoof values
// therefore never win. With no usable address we deliberately return one
// shared sentinel instead of disabling the limiter.
function store_client_ip(): string {
    $remote = store_normalize_ip($_SERVER['REMOTE_ADDR'] ?? '');
    if ($remote === '') return 'unknown';
    $trusted = store_trusted_proxy_rules();
    if (!store_ip_is_trusted_proxy($remote, $trusted)) return $remote;

    $raw = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if (!is_string($raw) || $raw === '' || strlen($raw) > 2048) return $remote;
    $chain = [];
    foreach (explode(',', $raw) as $part) {
        $ip = store_normalize_ip($part);
        if ($ip !== '') $chain[] = $ip;
    }
    $chain[] = $remote;
    for ($i = count($chain) - 1; $i >= 0; $i--) {
        if (!store_ip_is_trusted_proxy($chain[$i], $trusted)) return $chain[$i];
    }
    return $remote;
}

function store_rate_limit_key(string $bucket, string $identity): string {
    $cfg = store_config();
    $secret = (string)($cfg['rate_limit_secret'] ?? '');
    if ($secret === '') {
        // Existing installations need no emergency config change. Their DB
        // credential material is already server-only and gives the HMAC a
        // non-public fallback; the actual value is never stored or returned.
        $secret = hash('sha256', implode('|', [
            (string)($cfg['db_name'] ?? ''),
            (string)($cfg['db_user'] ?? ''),
            (string)($cfg['db_pass'] ?? ''),
        ]));
    }
    return substr(hash_hmac('sha256', $bucket . '|' . $identity, $secret), 0, 32);
}

/** @return array{allowed:bool,hits:int,retry_after:int,key:string,window_start:int} */
function store_rate_limit_hit(PDO $db, string $bucket, string $identity, int $max, int $windowSec): array {
    $max = max(1, $max);
    $windowSec = max(1, $windowSec);
    $key = store_rate_limit_key($bucket, $identity === '' ? 'unknown' : $identity);
    $now = time();
    $windowStart = $now - ($now % $windowSec);

    $db->prepare(
        'insert into rate_limit (bucket_key, window_start, hits) values (?, ?, 1)
         on duplicate key update hits = hits + 1'
    )->execute([$key, $windowStart]);

    $q = $db->prepare('select hits from rate_limit where bucket_key = ? and window_start = ?');
    $q->execute([$key, $windowStart]);
    $hits = (int)$q->fetchColumn();

    // Opportunistic sweep, ~1 request in 50, so the table cannot grow without
    // bound on a shop that never runs a cron for it.
    //
    // SCOPED TO THIS BUCKET, and that is the whole point. It used to be
    // `where window_start < ?` with no bucket at all, while the cutoff was
    // computed from the CALLING bucket's window — so a short-window counter
    // swept away long-window ones that were still live. Measured: the 60-second
    // admin bucket deletes anything older than four minutes, which is exactly
    // what a 900-second login_fail window looks like fifteen minutes in. Half a
    // sixty-attempt password spray vanished from the table mid-run, and the
    // throttle that should have stopped it never fired.
    //
    // A rate limiter that quietly forgets is worse than none: it reports
    // success while the counter it is defending resets under it, and nothing
    // logs the difference.
    if (random_int(1, 50) === 1) {
        $db->prepare('delete from rate_limit where bucket_key = ? and window_start < ?')
           ->execute([$key, $windowStart - ($windowSec * 4)]);
        // And a global sweep for buckets nobody visits any more — scoped
        // sweeping alone would leave those forever. A day is far longer than
        // the longest window in $STORE_LIMITS, so this can never reach a live
        // counter no matter which bucket triggers it.
        $db->prepare('delete from rate_limit where window_start < ?')
           ->execute([$now - 86400]);
    }

    return [
        'allowed' => $hits <= $max,
        'hits' => $hits,
        'retry_after' => max(1, ($windowStart + $windowSec) - $now),
        'key' => $key,
        'window_start' => $windowStart,
    ];
}

function store_rate_limit_clear(PDO $db, string $bucket, string $identity): void {
    $db->prepare('delete from rate_limit where bucket_key = ?')
       ->execute([store_rate_limit_key($bucket, $identity === '' ? 'unknown' : $identity)]);
}

function store_rate_limit_fail(int $retryAfter, string $token = 'too_many_attempts'): never {
    $retryAfter = max(1, $retryAfter);
    header('Retry-After: ' . $retryAfter);
    store_out(['error' => $token, 'retry_after' => $retryAfter], 429);
}

function store_throttle(PDO $db, string $bucket, int $max, int $windowSec): void {
    $state = store_rate_limit_hit($db, $bucket, store_client_ip(), $max, $windowSec);
    if (!$state['allowed']) store_rate_limit_fail($state['retry_after']);
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
// The cookie itself is a session cookie, so closing the browser ends it — but
// a desktop browser is not closed for weeks, and until now nothing else ended
// it either. These two are the ordinary pair: idle expiry for a machine walked
// away from, absolute expiry so a session cannot live indefinitely by being
// touched. Generous on purpose; this is a shop, not a bank, and a re-login
// every hour would only teach the owner to leave the password in a browser.
const STORE_ADMIN_IDLE_SECONDS     = 8 * 3600;
const STORE_ADMIN_ABSOLUTE_SECONDS = 7 * 86400;

function store_session_start(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    // Reject attacker-supplied session ids, use cookies only, and never leak
    // an id through a URL. Regeneration after login remains the privilege
    // boundary; these settings make the pre-login side strict as well.
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
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
        'lifetime' => 0,            // session cookie: closes with the browser
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,         // no script access — this cookie IS the admin
        'samesite' => 'Strict',     // the CSRF defence: no cross-site request carries it
    ]);
    session_start();
}

// Ends the session and the cookie together. Unsetting $_SESSION alone leaves
// the browser holding an id that still resolves, which is how a "signed out"
// admin turns out not to be.
function store_session_end(): void {
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
    session_destroy();
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
// one. Two clocks, both ours — idle, and absolute.
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
    store_session_start();
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
    store_session_start();
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

function store_admin_hash_password(string $password): string {
    $hash = password_hash(hash('sha256', $password), store_admin_password_algorithm());
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
        store_admin_password_algorithm()
    );
}

function store_admin_dummy_hash(): string {
    if (defined('PASSWORD_ARGON2ID')) {
        return STORE_ADMIN_PASSWORD_PREFIX
            . '$argon2id$v=19$m=65536,t=4,p=1$WkhQeUVUSTR2WVFUeGx6VA$jmcHEnrjp/hGzLDs77Byt//mDuZD8/UaO2PUQvAclWw';
    }
    return STORE_ADMIN_PASSWORD_PREFIX
        . '$2y$10$vNk3QOHYO.g/y1k6SJzYL.YjGRlwOp9P1TIeCDX.K6s9gFgNI8Bpe';
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
    store_admin_event($db, $user, 'login');
}

function store_login_identity(string $email): string {
    $normal = mb_strtolower(trim($email));
    // All syntactically valid identities — existing or not — take the exact
    // same path. Collapse malformed input into one bucket so changing junk on
    // every request cannot bypass the per-IP guard with unlimited DB work.
    return strlen($normal) <= 254 && filter_var($normal, FILTER_VALIDATE_EMAIL)
        ? $normal : '__invalid_email__';
}

/** @return array{ip:array,identity:array,identity_value:string} */
function store_login_rate_start(PDO $db, string $email): array {
    // Both counters are incremented before either can reject the request. A
    // blocked client therefore cannot freeze one bucket while continuing to
    // rotate identities through the other one.
    $identity = store_login_identity($email);
    $ip = store_rate_limit_hit($db, 'admin_login_ip', store_client_ip(), 20, 900);
    $account = store_rate_limit_hit($db, 'admin_login_identity', $identity, 5, 900);
    if (!$ip['allowed'] || !$account['allowed']) {
        store_rate_limit_fail(max($ip['retry_after'], $account['retry_after']));
    }
    return ['ip' => $ip, 'identity' => $account, 'identity_value' => $identity];
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
// 5-per-identity window before password hashing. Five failures also lock a
// real account for fifteen minutes; a correct password clears only the
// identity window and the account lock releases itself.
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
        if ($u && (int)$u['is_locked'] !== 1) {
            // Let MySQL set and compare the lock clock. Mixing PHP's timezone
            // with the database session timezone can turn fifteen minutes into
            // an already-expired lock or one that lasts hours on another host.
            // Both changes happen in one statement, so concurrent attempts
            // cannot overwrite one another with the same stale counter value.
            $db->prepare(
                'update admin_users
                    set locked_until = if(failed_attempts + 1 >= 5, date_add(now(), interval 15 minute), null),
                        failed_attempts = failed_attempts + 1
                  where id = ?'
            )->execute([$u['id']]);
        }

        // The threshold response is deliberately identical for a real and an
        // unknown email. The known row is locked at the same point, but that
        // fact is not an account-existence oracle for somebody guessing.
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
    if ((int)$u['is_locked'] === 1) {
        $lock = store_admin_lock_state($db, (int)$u['id']);
        store_rate_limit_fail($lock['retry_after'], 'locked');
    }

    // A correct password clears only this identity's failure window. Never
    // clear the client bucket: otherwise one known password could be used to
    // reset an IP spray limiter between guesses at other accounts.
    store_rate_limit_clear($db, 'admin_login_identity', $rate['identity_value']);

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
    store_session_start();
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
    if (!store_totp_claim($db, $id, (string)$user['totp_secret'], $code)
        && !store_recovery_claim($db, $id, $code)) {
        $db->prepare(
            'update admin_users
                set locked_until = if(failed_attempts + 1 >= 5, date_add(now(), interval 15 minute), null),
                    failed_attempts = failed_attempts + 1
              where id = ?'
        )->execute([$id]);
        $lock = store_admin_lock_state($db, $id);
        if ($lock['locked']) {
            unset($_SESSION['pending_admin_id'], $_SESSION['pending_at'], $_SESSION['pending_auth_fingerprint']);
            store_rate_limit_fail($lock['retry_after'], 'locked');
        }
        store_fail('bad_code', 401);
    }

    store_admin_grant($db, $user);
    return ['id' => (int)$user['id'], 'email' => $user['email']];
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
    'checkout'  => ['delivery_fee_fils' => 1000, 'knet' => true, 'tpay' => true, 'cod' => true,
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
    $enabled = array_values(array_filter(STORE_PAY_METHODS, fn ($m) => !empty($c[$m])));
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
            if (trim($value) === '' || $value !== trim($value)
                || preg_match('/^(YOUR_|PASTE_|CHANGE_ME|PROVIDED_BY_)/i', $value)) return false;
        }
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

function store_gateway_ready(string $method, ?string $configPath = null): bool {
    if ($method === 'cod') return true;
    $folder = store_gateway_directory($method);
    if ($folder === null) return false;
    $path = $configPath ?? sporta_config_path($method, $folder . '/config.php');
    if (!is_file($path) || !is_readable($path)) return false;
    try {
        // Do not call gateway loaders: they intentionally exit on absent
        // configuration. Suppress incidental whitespace/BOM from private
        // config files so it cannot contaminate the API's JSON response.
        ob_start();
        try { $cfg = @require $path; }
        finally { ob_end_clean(); }
        return is_array($cfg) && store_payment_config_ready($method, $cfg);
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
    $setting['methods'] = array_values(array_filter(STORE_PAY_METHODS, fn ($method) => !empty($saved[$method])));
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
// Returns ['short' => null, 'claimed' => n] when every tracked line was taken,
// or ['short' => [...]] naming the line that could not be — with what is
// actually left, because "out of stock" on a page showing eight items is not
// something a shopper can act on.
//
// `claimed` is counted rather than inferred from the cart, because "the order
// named a size" and "the order took stock" are different questions and reading
// one as the other is what put a false stock_claimed flag on accessory orders.
function store_stock_claim(PDO $db, array $lines): array {
    $take = $db->prepare(
        'update product_variants
            set stock = stock - ?, inventory_version = inventory_version + 1
          where slug = ? and size = ? and stock >= ?'
    );
    $left = $db->prepare('select stock from product_variants where slug = ? and size = ?');
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
    foreach ($lines as $l) {
        if ($l['size'] === null) continue;
        if (!array_key_exists($l['slug'], $known)) {
            $tracked->execute([$l['slug']]);
            $known[$l['slug']] = (bool)$tracked->fetchColumn();
        }
        if (!$known[$l['slug']]) continue;
        $take->execute([$l['qty'], $l['slug'], $l['size'], $l['qty']]);
        if ($take->rowCount() === 1) { $claimed++; continue; }
        // Either the shelf is short or there is no such variant at all. Both
        // are "you cannot have this", and both are reported with the number
        // the shopper needs — zero in the second case.
        $left->execute([$l['slug'], $l['size']]);
        $have = $left->fetchColumn();
        return ['short' => ['slug' => $l['slug'], 'size' => $l['size'],
                            'want' => $l['qty'], 'have' => $have === false ? 0 : (int)$have],
                'claimed' => $claimed];
    }
    return ['short' => null, 'claimed' => $claimed];
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
function store_stock_release(PDO $db, int $orderId, int $holdMinutes = 120): bool {
    $ownsTransaction = !$db->inTransaction();
    if ($ownsTransaction) $db->beginTransaction();
    try {
        // The sweeper's earlier candidate list is only a hint. Payment
        // callbacks lock this same row, so whichever commits first determines
        // whether the order can still release stock.
        $q = $db->prepare(
            'select stock_claimed, stock_released, payment_status, payment_method,
                    fulfilment_status,
                    (created_at < (now() - interval ? minute)) as hold_expired
               from orders where id = ? for update'
        );
        $q->execute([max(15, $holdMinutes), $orderId]);
        $order = $q->fetch();
        $eligible = $order && (int)$order['stock_claimed'] === 1
            && (int)$order['stock_released'] === 0
            && !in_array($order['payment_status'], ['paid', 'review'], true)
            && ($order['payment_status'] === 'failed'
                || $order['fulfilment_status'] === 'cancelled'
                || ($order['payment_status'] === 'pending'
                    && in_array($order['payment_method'], ['knet', 'tpay'], true)
                    && (int)$order['hold_expired'] === 1));
        if (!$eligible) {
            if ($ownsTransaction && !$db->commit()) throw new RuntimeException('Stock release commit failed');
            return false;
        }

        // Aggregate sizes: two fits of one garment can be separate order
        // lines, while a joined UPDATE only updates each variant once.
        $put = $db->prepare(
            'update product_variants v
               join products p on p.slug = v.slug
               join (select product_id, size, sum(qty) as qty
                       from order_items where order_id = ? and size is not null
                       group by product_id, size) i
                 on i.product_id = p.id and i.size = v.size
                set v.stock = v.stock + i.qty,
                    v.inventory_version = v.inventory_version + 1'
        );
        $put->execute([$orderId]);
        $db->prepare('update orders set stock_released = 1 where id = ?')->execute([$orderId]);
        if ($ownsTransaction && !$db->commit()) throw new RuntimeException('Stock release commit failed');
        return true;
    } catch (Throwable $e) {
        if ($ownsTransaction && $db->inTransaction()) $db->rollBack();
        throw $e;
    }
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
