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
//   * Nothing here writes files. The lesson of sporta-deploy.php stands: an
//     endpoint that writes files is a way in, not a bridge.
//   * The browser is never trusted: prices come from the products table, and
//     every admin write goes through the session guard below.

declare(strict_types=1);

// ---------------------------------------------------------------- config + db

function store_config(): array {
    static $cfg = null;
    if ($cfg === null) {
        $path = __DIR__ . '/config.php';
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
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// The same stable machine tokens create_order raises, so the storefront's
// existing error translations keep working unchanged against this backend.
function store_fail(string $token, int $code = 400): void {
    store_out(['error' => $token], $code);
}

function store_body(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw === false ? '' : $raw, true);
    return is_array($data) ? $data : [];
}

// ------------------------------------------------------------------ validation
// The checkout helpers, same names as the Postgres functions they replace, same
// error tokens, same limits.

const STORE_GOVERNORATES = ['capital', 'hawalli', 'farwaniya', 'mubarak-al-kabeer', 'ahmadi', 'jahra'];
const STORE_SIZES        = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE'];
const STORE_FITS         = ['normal', 'slim', 'loose', 'oversize', 'boxy', 'tank'];
const STORE_PAY_METHODS  = ['knet', 'tpay', 'cod'];

// Where a shopper is sent to pay, per method.
//
// The dropins have always been reachable from the website, which walks the
// customer to /knet/pay.php or /pay/pay.php itself after the order is written.
// The NATIVE APP cannot do that — it has no page to redirect and no knowledge
// of the site's layout — so it asked the order endpoint for a `pay_url` and
// the order endpoint never sent one. A card order in the app therefore created
// a pending row, took no money, and told the customer it was placed.
//
// Only the track id goes in the link. Both dropins look the amount up
// themselves and refuse anything the database cannot confirm, so a link that
// leaks, is shared, or is edited still cannot change what is charged.
//
//   paytype  '' the customer chooses at CBK, '1' KNET only, '2' T-Pay QR only.
//            T-Pay is the card/QR half of the same CBK gateway, so a `tpay`
//            order is pinned to 2 rather than left on the chooser — the
//            customer already chose, in this app, one screen ago.
function store_pay_url(string $method, string $track, string $lang = 'ar'): ?string
{
    $lang = $lang === 'en' ? 'en' : 'ar';
    $track = rawurlencode($track);
    return match ($method) {
        'knet' => "/knet/pay.php?trackid={$track}&lang={$lang}",
        'tpay' => "/pay/pay.php?trackid={$track}&lang={$lang}&paytype=2",
        // Cash has no page to visit. Returning null rather than an empty
        // string so a caller cannot accidentally send a customer to "/".
        default => null,
    };
}

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
// An email address, or null. Deliberately NOT a regular expression of my own:
// the grammar in RFC 5322 is famously larger than anyone's intuition, and every
// hand-written pattern in the wild refuses somebody's real address. PHP ships
// the filter; this only adds the length bound the column has and a lowercase
// fold on the domain so two spellings of one address do not read as two people.
//
// The local part keeps its case, because the RFC says it MAY be significant and
// a few real servers still treat it that way.
function store_email(?string $raw): ?string {
    $raw = trim((string) $raw);
    if ($raw === '' || strlen($raw) > 120) return null;
    // No newlines, ever. This value ends up beside a header in a mail() call,
    // and a CR or LF in an address is the classic header-injection route to
    // making the shop's own domain send somebody else's Bcc.
    if (preg_match('/[\r\n\0]/', $raw)) return null;
    $at = strrpos($raw, '@');
    if ($at === false) return null;
    $addr = substr($raw, 0, $at) . '@' . strtolower(substr($raw, $at + 1));
    return filter_var($addr, FILTER_VALIDATE_EMAIL) === false ? null : $addr;
}

function store_phone(?string $raw): ?string {
    $d = preg_replace('/\D/', '', store_ascii_digits((string)$raw));
    if (str_starts_with($d, '00965')) $d = substr($d, 5);
    elseif (strlen($d) > 8 && str_starts_with($d, '965')) $d = substr($d, 3);
    if (!preg_match('/^[569]\d{7}$/', $d)) return null;
    return '965' . $d;
}

// checkout_text: trim, strip control characters, enforce length — raising the
// same missing_/too_long_ tokens the SQL raises so messages translate.
function store_text(?string $v, string $field, int $min, int $max): string {
    $t = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', (string)$v) ?? '');
    if (mb_strlen($t) < $min) store_fail("missing_{$field}");
    if (mb_strlen($t) > $max) store_fail("too_long_{$field}");
    return $t;
}

function store_opt(?string $v): ?string {
    $t = trim((string)$v);
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


// ======================================================================
// THE SIZE AND FIT ADVISER
//
// WHY THIS IS ARITHMETIC AND NOT A PROMPT. سبورتا AI's rule is that the model
// may only reword facts already fetched and is never the source of one, and a
// size recommendation is a fact with money attached: get it wrong and the
// customer returns the garment, the shop pays the free collection, and for
// women's clothing — which cannot be exchanged at all — the sale is simply
// gone. A language model asked "what size am I?" will always answer, always
// confidently, and has no access to this shop's charts or its stock. So the
// recommendation is computed here, from a table the owner controls, and the
// assistant is allowed to read the result out loud and nothing more.
//
// WHAT IT REFUSES TO DO. It will not pretend to a precision it does not have.
// Three inputs give three different confidences, and the answer says which:
//
//   chest/waist/hip   high    — the customer used a tape measure
//   usual size        medium  — a real garment they own, but another brand's cut
//   height + weight   low     — an estimate, and labelled one every time
//
// A shop that says "you are an L" in the same tone whether it measured or
// guessed is a shop whose size advice nobody believes twice.

// Which chart a garment is cut to. Women's pieces are drafted from a different
// block — bust rather than chest, and hips that a tee does not care about — so
// answering a women's legging from the unisex chart is not a rounding error,
// it is the wrong garment's numbers.
function store_size_chart_for(PDO $db, ?string $slug): array {
    $chart = 'unisex';
    if ($slug !== null && $slug !== '') {
        $q = $db->prepare('select category from products where slug = ?');
        $q->execute([$slug]);
        $cat = (string) ($q->fetchColumn() ?: '');
        // The category IS the chart when a chart of that name exists — so an
        // owner who adds a 'leggings' chart in /backends gets it used, with no
        // code change. Falls back to women's for the women's category, then to
        // unisex.
        foreach ([$cat, $cat === 'women' ? 'women' : ''] as $try) {
            if ($try === '') continue;
            $c = $db->prepare('select count(*) from size_charts where chart = ?');
            $c->execute([$try]);
            if ((int) $c->fetchColumn() > 0) { $chart = $try; break; }
        }
    }
    $rows = $db->prepare(
        'select size, chest_min, chest_max, waist_min, waist_max, hip_min, hip_max, is_default
           from size_charts where chart = ? order by sort, id'
    );
    $rows->execute([$chart]);
    return [$chart, $rows->fetchAll()];
}

/**
 * The recommendation. Returns [size, fit, confidence, reasons[], alt, chart].
 *
 * $in: height_cm, weight_kg, chest_cm, waist_cm, hip_cm, usual_size, prefers,
 *      slug, lang.
 */
function store_size_advice(PDO $db, array $in): array {
    $lang = ($in['lang'] ?? '') === 'en' ? 'en' : 'ar';
    [$chart, $rows] = store_size_chart_for($db, $in['slug'] ?? null);
    if (!$rows) return ['error' => 'no_chart'];

    $ladder = array_column($rows, 'size');
    $idx = fn($s) => array_search($s, $ladder, true);
    $reasons = [];
    $picks = [];          // one index per measurement that spoke
    $confidence = null;

    // ---- 1. measurements, if the customer took them -----------------------
    // The LARGEST size any single measurement demands wins. A garment has to
    // clear the chest AND the waist; averaging them produces a size that fits
    // neither, and it is the widest measurement that decides whether a shirt
    // closes.
    foreach ([['chest', 'chest_min', 'chest_max'],
              ['waist', 'waist_min', 'waist_max'],
              ['hip',   'hip_min',   'hip_max']] as [$key, $lo, $hi]) {
        $v = (int) ($in[$key . '_cm'] ?? 0);
        if ($v < 40 || $v > 200) continue;                 // absent or nonsense
        if ($rows[0][$lo] === null) continue;              // chart has no hips
        $best = null;
        foreach ($rows as $i => $r) {
            // The first band whose TOP reaches the measurement. Between two
            // bands the customer goes up, never down: a garment one size too
            // big is worn, one size too small is returned.
            if ($v <= (int) $r[$hi]) { $best = $i; break; }
        }
        if ($best === null) $best = count($rows) - 1;      // past the last band
        $picks[] = $best;
        $reasons[] = [$key => $v, 'size' => $rows[$best]['size']];
    }
    if ($picks) $confidence = 'high';

    // ---- 2. the size they already wear -------------------------------------
    // Medium confidence on purpose: it is a real garment on a real body, but
    // it is another brand's cut, and "I'm a medium" means different things in
    // two shops on the same street.
    if (!$picks && ($in['usual_size'] ?? '') !== '') {
        $u = strtoupper(trim((string) $in['usual_size']));
        $u = ['XXL' => '2XL', 'XXXL' => '3XL', 'XXXXL' => '4XL', 'XXXXXL' => '5XL'][$u] ?? $u;
        $at = $idx($u);
        if ($at !== false) { $picks[] = $at; $confidence = 'medium';
                             $reasons[] = ['usual_size' => $u]; }
    }

    // ---- 3. height and weight, which is a guess and says so ----------------
    // Most shoppers have no tape measure and every shopper knows these two.
    //
    // WHAT THIS REPLACED, because the first version was visibly wrong and the
    // wrongness is instructive. It mapped BMI onto size bands directly and
    // then nudged the band by height: ±1 step for tall or short. That produced
    // 190cm/75kg → SIZE S and 160cm/75kg → 3XL. Both are absurd on sight, and
    // both came from the same mistake — treating height as a correction on top
    // of a size rather than as part of what the body IS.
    //
    // The physics is not complicated. For a given height, more weight means
    // more girth. For a given weight, more height means LESS girth, because
    // the same mass is spread over a longer frame. And two people at the same
    // BMI but different heights are not the same size at all: their
    // proportions scale with height. So chest circumference goes roughly as
    //
    //     chest ≈ k · height · sqrt(BMI / 22)
    //
    // with k fixed by one anchor — a 175cm frame at BMI 22 sits in the middle
    // of the M band (99cm) in the seeded chart, so k = 99/175.
    //
    // The estimate then goes through the SAME band matcher a measured chest
    // does, rather than having a second scale of its own. One code path, one
    // set of numbers to correct when the owner puts the real chart in.
    if (!$picks) {
        $h = (int) ($in['height_cm'] ?? 0);
        $w = (int) ($in['weight_kg'] ?? 0);
        if ($h >= 120 && $h <= 220 && $w >= 35 && $w <= 250) {
            $bmi = $w / (($h / 100) ** 2);
            $chest = (99 / 175) * $h * sqrt($bmi / 22);
            $best = null;
            foreach ($rows as $i => $r) {
                if ($chest <= (int) $r['chest_max']) { $best = $i; break; }
            }
            $picks[] = $best ?? count($rows) - 1;
            $confidence = 'low';
            $reasons[] = ['estimated_chest' => (int) round($chest)];
        }
    }

    if (!$picks) return ['error' => 'not_enough'];
    $at = max($picks);

    // ---- the fit preference, applied AFTER the body is sized ---------------
    // The chart holds BODY measurements; the ease is the garment's. Someone
    // who wants it loose is asking for more ease than the cut gives, and one
    // step up is how that is bought. Tight does NOT step down: the chart bands
    // already sit close, and a size below the body measurement does not close.
    $prefers = (string) ($in['prefers'] ?? 'regular');
    if ($prefers === 'loose') { $at = min(count($rows) - 1, $at + 1); }

    $size = $rows[$at]['size'];
    // The alternative is always the next size up where there is one — that is
    // the direction people actually wish they had gone.
    $alt = $rows[min(count($rows) - 1, $at + 1)]['size'];
    if ($alt === $size) $alt = null;

    // ---- what the shop can actually send -----------------------------------
    // Advice for a size the shop does not have is not advice. If the
    // recommended size is out of stock on THIS product, say so and name the
    // nearest size that exists rather than letting them find out at checkout.
    $inStock = null; $substitute = null;
    if (($in['slug'] ?? '') !== '') {
        $st = $db->prepare('select size, stock from product_variants where slug = ?');
        $st->execute([$in['slug']]);
        $stock = [];
        foreach ($st->fetchAll() as $r) $stock[strtoupper($r['size'])] = (int) $r['stock'];
        if ($stock) {
            $inStock = ($stock[$size] ?? 0) > 0;
            if (!$inStock) {
                // UP WINS, even when down is nearer — which is not what a
                // nearest-neighbour search does, and the first version here
                // was one. Recommended M with S and XL on the shelf, it
                // offered the S, because S is one step away and XL is two.
                // A garment one size too big is worn; one size too small is
                // returned, and this shop pays the collection.
                //
                // So: the SMALLEST stocked size at or above the recommendation,
                // and only if there is none at all, the largest below it.
                $up = null; $down = null;
                foreach ($stock as $s => $n) {
                    if ($n <= 0) continue;
                    $j = $idx($s);
                    if ($j === false) continue;
                    if ($j >= $at) { if ($up === null || $j < $up[0]) $up = [$j, $s]; }
                    else            { if ($down === null || $j > $down[0]) $down = [$j, $s]; }
                }
                $substitute = $up[1] ?? $down[1] ?? null;
            }
        }
    }

    // ---- the fit, from the garment and the preference ----------------------
    $fit = match ($prefers) {
        'loose' => 'loose',
        'tight' => 'slim',
        default => 'normal',
    };

    return [
        'size'       => $size,
        'alt'        => $alt,
        'fit'        => $fit,
        'confidence' => $confidence,
        'chart'      => $chart,
        'unconfirmed' => (int) ($rows[0]['is_default'] ?? 1) === 1,
        'in_stock'   => $inStock,
        'substitute' => $substitute,
        'reasons'    => $reasons,
    ];
}

// ---------------------------------------------------------------- outgoing mail
// One sender for every message this shop posts, warehouse and customer alike.
// It lived in cron-fulfilment.php with the recipient hard-coded to
// warehouse_email; a second copy for the customer is exactly how the two would
// drift, and the encoding here is the part nobody re-checks — an Arabic subject
// that is not =?UTF-8?B?…?= arrives as mojibake in about half of all clients.
//
// $to is validated by the CALLER. Nothing here can rescue a malformed address,
// and mail() with a bad recipient fails in a way no log records.
function store_send_mail(array $cfg, string $to, string $subject, string $text, string $html): bool {
    $boundary = 'sp' . bin2hex(random_bytes(12));
    $headers = implode("\r\n", [
        'From: Sporta <' . $cfg['mail_from'] . '>',
        'Reply-To: ' . $cfg['mail_reply_to'],
        'MIME-Version: 1.0',
        "Content-Type: multipart/alternative; boundary=\"{$boundary}\"",
    ]);
    // Plain text FIRST, HTML second — the order multipart/alternative expects.
    $body = "--{$boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{$text}\r\n"
          . "--{$boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n{$html}\r\n--{$boundary}--";
    return mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, $headers);
}

// ------------------------------------------------------- the customer's receipt
// Queue the customer's own copy of their order. Written in the order's
// transaction, like the warehouse message and the owner's push: if the order
// exists, the receipt exists.
//
// NO ADDRESS, NO ROW. Every order from today carries a validated email — the
// checkout requires one and api.php refuses without it — but orders placed
// before that column existed do not, and neither does an order created by a
// migration or by hand in phpMyAdmin. A queued message with nowhere to go would
// burn five attempts and then sit there looking like a delivery failure.
function store_queue_customer_mail(PDO $db, int $orderId, string $kind = 'received'): void {
    $q = $db->prepare('select customer_email, customer_lang from orders where id = ?');
    $q->execute([$orderId]);
    $o = $q->fetch();
    if (!$o) return;

    $to = store_email($o['customer_email'] ?? null);
    if ($to === null) return;

    try {
        // insert ignore against (order_id, kind): a double-tapped Pay button
        // posts the same order twice, and two receipts for one purchase is how
        // a shop teaches people that its mail is noise.
        $db->prepare('insert ignore into customer_mail_outbox (order_id, kind, to_email, lang)
                      values (?, ?, ?, ?)')
           ->execute([$orderId, $kind, $to, ($o['customer_lang'] ?? '') === 'en' ? 'en' : 'ar']);
    } catch (Throwable $e) {
        // Guarded for the same reason the push queue is: this runs INSIDE the
        // order's transaction on a shop that may not have imported
        // customermail.mysql.sql yet. An unguarded insert against a missing
        // table would throw, hit api.php's rollBack(), and REFUSE THE ORDER
        // over a receipt. Losing the email is a nuisance; losing the sale is not.
    }
}

// ------------------------------------------------------------------ Web Push
// Queue ONE alert for the owner's own phone. See push.mysql.sql for why this is
// a third queue rather than a flag on one of the other two.
//
// Called inside the order's transaction, like the warehouse message: if the
// order exists, the alert exists. Nothing here touches the network — a checkout
// that waits on Apple is a checkout that fails when Apple is slow, and the
// shopper is on their way to the bank's payment page while it does.
function store_queue_push(PDO $db, int $orderId, string $kind = 'new'): void {
    $cfg = store_config();
    // NO KEYS, NO QUEUE — the same fail-closed rule the WhatsApp queue follows.
    // Rows nobody can ever send are not a queue, they are a table that grows
    // until somebody asks why.
    if (($cfg['vapid_public'] ?? '') === '' || ($cfg['vapid_private'] ?? '') === '') return;

    $q = $db->prepare('select track_id, amount, payment_method, payment_status,
                              customer_area, customer_name
                         from orders where id = ?');
    $q->execute([$orderId]);
    $o = $q->fetch();
    if (!$o) return;

    $n = $db->prepare('select coalesce(sum(qty), 0) from order_items where order_id = ?');
    $n->execute([$orderId]);
    $pieces = (int) $n->fetchColumn();

    // THE PAYMENT STATE IS IN THE ALERT, not implied by it. This fires on
    // INSERT — before the bank has said anything — so an alert that just said
    // "new order" would have to be checked before it could be believed, and one
    // of those at two in the morning is worth very little. Three states, named:
    $method = (string) $o['payment_method'];
    $paid   = ($o['payment_status'] ?? '') === 'paid';
    $state  = $paid                ? 'مدفوع'
            : ($method === 'cod'   ? 'الدفع عند الاستلام'
                                   : 'بانتظار الدفع');

    // Arabic, because it is the owner's language and the shop's default. The
    // amount stays in Western digits: this is a number to be read at a glance
    // against a bank app, not prose.
    $amount = 'KWD ' . number_format((float) $o['amount'], 3, '.', '');
    $title  = 'طلب جديد · ' . $amount;
    $body   = trim(sprintf(
        '%s · %s · %s%s',
        (string) $o['track_id'],
        $state,
        store_arabic_pieces($pieces),
        ($o['customer_area'] ?? '') !== '' ? ' · ' . $o['customer_area'] : ''
    ));

    // insert ignore against the (order_id, kind) unique index: a retried
    // checkout cannot buzz the phone twice for the same order.
    //
    // AND IT IS GUARDED, which the warehouse queue is not and does not need to
    // be. This runs INSIDE the order's transaction on a shop that may not have
    // imported push.mysql.sql yet — fulfilment_outbox has existed since the
    // first schema, this table has not. An unguarded insert against a missing
    // table would throw, hit api.php's rollBack(), and REFUSE THE ORDER over a
    // notification. Losing the buzz is a nuisance; losing the sale is not.
    try {
        $db->prepare('insert ignore into push_outbox (order_id, kind, title, body, url)
                      values (?, ?, ?, ?, ?)')
           ->execute([$orderId, $kind, mb_substr($title, 0, 120), mb_substr($body, 0, 300),
                      '/backends?order=' . rawurlencode((string) $o['track_id'])]);
    } catch (Throwable $e) {
        // Nothing here helps the shopper, and the order is what matters.
    }
}

// Arabic counts in five cases, not two, and this string is read by the owner
// every single time an order arrives — "٣ قطعة" is the kind of wrong that
// makes software feel foreign. Same rule as arabicCount() in the frontend:
// 1 singular, 2 dual, 3-10 plural, 11+ back to singular, restarting each
// hundred.
function store_arabic_pieces(int $n): string {
    $mod = $n % 100;
    if ($n === 1) return 'قطعة واحدة';
    if ($n === 2) return 'قطعتان';
    if ($mod >= 3 && $mod <= 10) return $n . ' قطع';
    return $n . ' قطعة';
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

// The one place an order is judged before it is written. Raises and never
// returns when it refuses.
//
// COD ONLY for the cap, deliberately. A card order that turns out to be fake
// costs the shop nothing — the bank never settled it, nothing shipped. Cash on
// delivery is the only method that spends money before anyone has paid, so it
// is the only one worth guarding. Rate-limiting real prepaid customers would be
// all cost and no benefit.
function store_order_guard(PDO $db, string $phone, string $method): void {
    // 1. The blocklist. A human decision, so it outranks everything else.
    $q = $db->prepare('select scope from blocked_customers where phone = ?');
    $q->execute([$phone]);
    $scope = $q->fetchColumn();
    if ($scope === 'all') store_fail('customer_blocked', 403);
    if ($scope === 'cod' && $method === 'cod') store_fail('cod_blocked', 403);

    if ($method !== 'cod') return;

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
        store_fail('too_many_open_cod', 409);
    }
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
        store_post_to_ledger($db, $orderId);
    }
}

/**
 * Post a paid order to the double-entry ledger, if the shop has one.
 *
 * GUARDED, AND THE GUARD IS THE POINT. This runs inside the transaction that
 * records that money was taken, and nothing about bookkeeping is worth losing
 * that record for. A shop that has not imported accounting.mysql.sql has no
 * `accounts` table and every call here would throw; an arithmetic problem in
 * one order would otherwise roll back the payment it was describing. The
 * callback makes the same argument about a missing store.php in as many words.
 *
 * So a failure here is swallowed — and swallowing it would be indefensible if
 * nothing noticed, which is exactly why acc_unposted_orders() exists. An order
 * that is paid and unposted is listed on the Accounting screen until somebody
 * posts it. The ledger can be behind; it cannot be quietly wrong, and the
 * payment can never be lost to it.
 */
function store_post_to_ledger(PDO $db, int $orderId): void {
    try {
        $lib = __DIR__ . '/accounting.php';
        if (!is_file($lib)) return;
        require_once $lib;
        acc_post_order($db, $orderId);
    } catch (Throwable $e) {
        // Deliberately silent to the caller. See above.
        error_log('sporta: ledger posting failed for order ' . $orderId . ': ' . $e->getMessage());
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
// A garment photograph sits between the two. It is looked at closely — a
// shopper deciding on a fabric zooms in, which a hero is never asked to
// survive — but several of them load on one product page, where the hero is
// one image on the home page. The admin downscales to 1400px WebP; this is
// the floor under that, not the target.
const STORE_PRODUCT_IMAGE_MAX = 900000;  // ~900 kB of base64, ~675 kB of image
// How many photographs one garment may carry. Not a storage limit — a row is
// nothing — it is a page-weight limit, and the product gallery is the one
// screen where "just one more angle" has no natural end.
//
// RAISED FROM 12 TO 24 at the owner's request, and it is affordable because of
// how the gallery loads: only the FIRST photograph is eager (it is the LCP
// candidate), every other one and every thumbnail is lazy. So the cost of the
// 13th to the 24th is paid only by a visitor who actually swipes to them, at
// ~38 kB each after the q0.90 downscale.
//
// It is still a cap rather than none: 24 photographs is a shoot, 200 is a
// mistake nobody notices until the gallery takes a minute to page through.
//
// THE BROWSER MIRRORS THIS NUMBER in src/admin/PhotoPicker.jsx (MAX_PHOTOS),
// so the picker can grey out the zone instead of letting someone downscale ten
// photographs and then meet too_many_images on the eleventh. The two are
// asserted equal by scripts/panel-test.mjs — a client that thinks the limit is
// higher than the server does is a queue of uploads that fail one by one.
const STORE_PRODUCT_IMAGE_LIMIT = 24;

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

// ------------------------------------------------------- a brand's logo FILE
//
// public_html/images/<brand-slug>/logo.{png,webp,jpg} — the folder the owner
// drops a logo into through hPanel's File Manager, which is the only file
// upload they have.
//
// WHY A FILE AT ALL, when brands.logo already holds a data: URI. Because the
// database route requires opening the panel, choosing a file and saving, and
// the owner asked for a folder per brand they can simply drop images into.
// Both work; the panel wins where both exist, because that is somebody having
// made a deliberate choice in the shop's own tools and a file left on disk
// should not quietly override it.
//
// THE SLUG IS NOT A PATH. It arrives from ?r=brand_logo&slug= — a query string
// a stranger controls — and is pasted into a filesystem path here, so it is
// checked against a strict pattern rather than merely escaped. `../` is the
// obvious attack; a slug with a dot or a slash in it has no legitimate form,
// and store_slug() cannot produce one.
const STORE_BRAND_LOGO_NAMES = ['logo.png', 'logo.webp', 'logo.jpg'];

function store_brand_logo_file(string $slug): ?string {
    if (!preg_match('/^[a-z0-9][a-z0-9-]{0,63}$/', $slug)) return null;
    $dir = __DIR__ . '/../images/' . $slug;
    foreach (STORE_BRAND_LOGO_NAMES as $name) {
        $path = $dir . '/' . $name;
        if (is_file($path) && is_readable($path)) return $path;
    }
    return null;
}

// The cache key for that file. The logo URL is cached for a year and immutable,
// which is only safe because the address changes when the picture does — so
// this has to change when the file does. Size and mtime together do that
// without reading the bytes: hashing a 150 kB logo on every ?r=products, for
// every brand, to produce twelve characters would be real work for nothing.
function store_brand_logo_version(string $path): string {
    return substr(hash('sha256', $path . '|' . filesize($path) . '|' . filemtime($path)), 0, 12);
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
// The throttle is deliberately cheap and stateless-ish: a per-IP counter in
// the same MySQL the request is already talking to, in a fixed window. No new
// table, no cache server, no per-request file writes — this runs on shared
// hosting where none of those exist.
//
// It counts only FAILED lookups. A customer with a real code who re-checks
// their basket four times is not attacking anything, and throttling them would
// break the feature to protect it.
function store_throttle(PDO $db, string $bucket, int $max, int $windowSec): void {
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    if ($ip === '') return;
    // The IP is HASHED. This is abuse control, not a visitor log, and a table
    // of who-asked-what is a privacy liability the shop has no use for.
    $key = substr(hash('sha256', $bucket . '|' . $ip), 0, 32);
    $now = time();
    $windowStart = $now - ($now % $windowSec);

    $db->prepare(
        'insert into rate_limit (bucket_key, window_start, hits) values (?, ?, 1)
         on duplicate key update hits = hits + 1'
    )->execute([$key, $windowStart]);

    $q = $db->prepare('select hits from rate_limit where bucket_key = ? and window_start = ?');
    $q->execute([$key, $windowStart]);
    if ((int) $q->fetchColumn() > $max) {
        // 429 with no detail: telling a guesser how long to wait is telling it
        // how fast to go.
        store_fail('too_many_attempts', 429);
    }

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
    $_SESSION['seen_at'] = $now;
    return ['id' => (int)$_SESSION['admin_id'], 'email' => $_SESSION['admin_email'] ?? ''];
}

// The custom-header half of the CSRF defence, on its own so the routes ABOVE
// the session gate can use it too.
//
// A cross-site <form> can POST anywhere, but it cannot set a request header —
// that requires fetch/XHR, which requires CORS preflight, which this server
// never grants. So a request carrying this header was made by our own code.
//
// It applies to `login` as well now, and that is not theatre. Without it any
// page on the internet could POST credentials it knows to /admin.php?r=login
// in the owner's browser and silently plant OUR Set-Cookie session — login
// CSRF. The damage on a one-admin shop is small (you end up signed into an
// account the attacker controls, and everything you then do is recorded in
// THEIR session) but the fix is one line and it removes a whole class of
// "wait, why am I signed in as someone else".
function store_require_admin_header(): void {
    if (($_SERVER['HTTP_X_SPORTA_ADMIN'] ?? '') !== '1') store_fail('bad_request', 400);
}

// Every admin DATA route calls this first. 401, not a redirect: the caller is
// the React admin, and JSON is what it can act on.
function store_require_admin(): array {
    $who = store_session_admin();
    if ($who === null) store_fail('not_signed_in', 401);
    // SameSite=Strict stops the cookie travelling cross-site; this header stops
    // the residual cases (old browsers, subdomain surprises). The React admin
    // always sends it; nothing else has a reason to.
    store_require_admin_header();
    return $who;
}

// ============================================================ two-factor auth
//
// TOTP — RFC 6238, the six digits Google Authenticator shows. Written here in
// about sixty lines because the alternative is a Composer dependency, and this
// server has no shell to run Composer with.
//
// WHY THE ADMIN NEEDS IT. Sign-in is one password with no second factor, and
// behind it sits every customer's name, phone number and home address, plus
// the ability to change what the shop charges. The password can be phished,
// reused, or read over a shoulder; a code that changes every thirty seconds
// and never leaves the owner's phone cannot be any of those things.

// Base32, RFC 4648, no padding — the alphabet Authenticator apps expect.
const STORE_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function store_b32_encode(string $bytes): string {
    $bits = '';
    for ($i = 0; $i < strlen($bytes); $i++) {
        $bits .= str_pad(decbin(ord($bytes[$i])), 8, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 5) as $chunk) {
        $out .= STORE_B32[bindec(str_pad($chunk, 5, '0', STR_PAD_RIGHT))];
    }
    return $out;
}

function store_b32_decode(string $b32): string {
    // Case and spacing are the user's, not ours: the secret is shown in groups
    // of four so it can be typed by hand, and a phone keyboard will capitalise
    // or not as it pleases.
    $b32 = strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $b32));
    $bits = '';
    for ($i = 0; $i < strlen($b32); $i++) {
        $v = strpos(STORE_B32, $b32[$i]);
        if ($v === false) return '';
        $bits .= str_pad(decbin($v), 5, '0', STR_PAD_LEFT);
    }
    $out = '';
    foreach (str_split($bits, 8) as $chunk) {
        // A trailing partial byte is base32 padding, not data. Decoding it as
        // a zero byte would change the HMAC key and every code would be wrong.
        if (strlen($chunk) === 8) $out .= chr(bindec($chunk));
    }
    return $out;
}

// One HOTP value for a counter — RFC 4226 dynamic truncation.
function store_hotp(string $key, int $counter, int $digits = 6): string {
    // 64-bit big-endian counter. pack('J') needs 64-bit PHP; shared hosting is
    // 64-bit everywhere now, but building the eight bytes by hand costs two
    // lines and cannot be wrong on a 32-bit build.
    $bin = '';
    for ($i = 7; $i >= 0; $i--) { $bin .= chr(($counter >> ($i * 8)) & 0xFF); }
    $hash = hash_hmac('sha1', $bin, $key, true);
    $off = ord($hash[19]) & 0x0F;
    $num = ((ord($hash[$off]) & 0x7F) << 24)
         | ((ord($hash[$off + 1]) & 0xFF) << 16)
         | ((ord($hash[$off + 2]) & 0xFF) << 8)
         | (ord($hash[$off + 3]) & 0xFF);
    return str_pad((string)($num % (10 ** $digits)), $digits, '0', STR_PAD_LEFT);
}

// The 30-second step the code belongs to.
function store_totp_step(?int $at = null): int {
    return intdiv($at ?? time(), 30);
}

// Verify a typed code, and say WHICH step matched.
//
// ±1 step of tolerance, which is the standard allowance for a phone clock that
// has drifted and for the seconds a person spends typing. Wider is tempting and
// wrong: every extra step is another valid code at any instant.
//
// Returns the matched step, or null. The CALLER must then refuse a step it has
// already seen — see store_totp_claim(). Without that, a code stays valid for
// its whole window, and anything that can read it once (a shoulder, a shared
// screen, a phishing page relaying in real time) can replay it.
function store_totp_verify(string $secretB32, string $code, ?int $at = null): ?int {
    $code = preg_replace('/\D/', '', $code);
    if (strlen($code) !== 6) return null;
    $key = store_b32_decode($secretB32);
    if ($key === '') return null;
    $now = store_totp_step($at);
    for ($d = -1; $d <= 1; $d++) {
        // hash_equals on digits: a timing side channel on six digits is not
        // the realistic attack here, but the comparison is free to do right.
        if (hash_equals(store_hotp($key, $now + $d), $code)) return $now + $d;
    }
    return null;
}

// Verify AND burn. One code, one use, ever.
//
// admin_users.totp_last_step records the highest step accepted; anything at or
// below it is refused even if the arithmetic still says the code is valid. The
// guarded UPDATE means two simultaneous requests carrying the same code cannot
// both win — the same shape as claiming a single-use discount.
function store_totp_claim(PDO $db, int $adminId, string $secretB32, string $code, ?int $at = null): bool {
    $step = store_totp_verify($secretB32, $code, $at);
    if ($step === null) return false;
    $q = $db->prepare(
        'update admin_users set totp_last_step = ?
          where id = ? and (totp_last_step is null or totp_last_step < ?)'
    );
    $q->execute([$step, $adminId, $step]);
    return $q->rowCount() === 1;
}

// The otpauth:// URI an Authenticator app reads from a QR code.
//
// The issuer appears twice on purpose: as a label prefix for apps that only
// read the label, and as a parameter for those that read both. Without it the
// phone shows a bare email address and the owner cannot tell which of their
// codes belongs to the shop.
function store_totp_uri(string $secretB32, string $email, string $issuer = 'Sporta'): string {
    return 'otpauth://totp/' . rawurlencode($issuer) . ':' . rawurlencode($email)
         . '?secret=' . $secretB32
         . '&issuer=' . rawurlencode($issuer)
         . '&algorithm=SHA1&digits=6&period=30';
}

// A fresh secret. 20 bytes = 160 bits, the length RFC 4226 specifies for SHA-1.
function store_totp_secret(): string {
    return store_b32_encode(random_bytes(20));
}

// Login with per-account throttling kept in the database, not the session —
// an attacker does not keep your session for you. Five failures lock the
// account for fifteen minutes; the lock releases itself.
// ==================================================== a one-time code by email
//
// The second factor for an owner who will not carry an authenticator app.
// TOTP is stronger and stays the default where it is enrolled — store_login()
// checks it first and never reaches this. What this is for is the account that
// would otherwise have ONE factor, because setting up an app was too much
// trouble: one factor plus a mailbox beats one factor.
//
// The code lives ten minutes, is destroyed the moment it is used, and is
// destroyed again after five wrong guesses so that grinding one code is not
// possible — a guesser has to make the shop send another, and that is
// throttled too.

/** Ten minutes. Long enough to open a mail app, short enough that a code read
 *  over a shoulder is stale before it can be carried anywhere. */
const STORE_EMAIL_OTP_SECONDS = 600;
/** Wrong guesses against ONE code before it is thrown away. */
const STORE_EMAIL_OTP_TRIES = 5;
/** The floor between one send and the next, so "send it again" is not a way to
 *  post a thousand messages to somebody's address. */
const STORE_EMAIL_OTP_RESEND_SECONDS = 60;

/**
 * HMAC, not a bare hash, and this is the whole security of the stored row.
 *
 * Six digits is a million possibilities. sha256 over a million inputs is the
 * work of a moment, so a leaked `email_otp_hash` would hand over the live code
 * to anyone who read the database. Keyed on cron_key — which lives in
 * api/config.php and not in the database — the row is worth nothing on its own.
 *
 * NO KEY, NO CODES. An empty cron_key would key every code on the empty string,
 * which is to say on nothing at all, and that is worse than not having the
 * feature: it would look like a second factor while being a public one. Fails
 * closed, exactly as store_review_token_ok() does.
 */
function store_email_otp_hash(string $code): string {
    $cfg = store_config();
    $key = (string)($cfg['cron_key'] ?? '');
    if ($key === '') store_fail('otp_not_configured', 500);
    return hash_hmac('sha256', 'admin-otp' . "\0" . $code, $key);
}

/**
 * Make a code, store its HMAC, and send it. Returns the code ONLY so the
 * caller can hand it to a test; nothing in production reads it.
 *
 * `random_int`, not `rand`: this is the whole second factor, and a predictable
 * code is not one.
 */
function store_email_otp_issue(PDO $db, array $u): string {
    $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $db->prepare(
        'update admin_users
            set email_otp_hash = ?, email_otp_expires = ?, email_otp_sent_at = now(),
                email_otp_attempts = 0
          where id = ?'
    )->execute([
        store_email_otp_hash($code),
        date('Y-m-d H:i:s', time() + STORE_EMAIL_OTP_SECONDS),
        (int)$u['id'],
    ]);
    return $code;
}

/** The address, shown back to whoever is signing in so they know where to
 *  look — masked, because the panel shows it before anyone has proved
 *  anything beyond the password. */
function store_mask_email(string $email): string {
    $at = strpos($email, '@');
    if ($at === false || $at < 1) return '***';
    $name = substr($email, 0, $at);
    $rest = substr($email, $at);
    $keep = mb_substr($name, 0, 1);
    return $keep . str_repeat('*', max(1, mb_strlen($name) - 1)) . $rest;
}

/**
 * Send it. A FAILURE HERE IS REPORTED, NOT SWALLOWED.
 *
 * If mail is misconfigured and this quietly returned true, the owner would be
 * asked for a code that was never sent and would have no way in at all — the
 * one failure mode that turns a second factor into a locked door. The caller
 * says so plainly instead, and the code stays valid so a retry can work once
 * the mail problem is fixed.
 */
function store_email_otp_send(array $u, string $code, string $lang = 'ar'): bool {
    $cfg = store_config();
    $mins = (int)(STORE_EMAIL_OTP_SECONDS / 60);
    if ($lang === 'en') {
        $subject = 'Sporta — your sign-in code';
        $text = "Your sign-in code is {$code}.\n\n"
              . "It works once and expires in {$mins} minutes.\n"
              . "If you did not just try to sign in to the Sporta panel, change your password.";
    } else {
        $subject = 'سبورتا — رمز الدخول';
        $text = "رمز الدخول الخاص بك هو {$code}.\n\n"
              . "يُستخدم مرة واحدة وينتهي خلال {$mins} دقائق.\n"
              . "إن لم تكن أنت من حاول الدخول إلى لوحة سبورتا، غيّر كلمة المرور.";
    }
    // The code is in the plain part and the HTML part alike; no link, nothing
    // to click. A sign-in mail that carries a link is a phishing lesson.
    $html = '<p style="font:16px system-ui">' . htmlspecialchars($text, ENT_QUOTES, 'UTF-8') . '</p>';
    $html = str_replace("\n", '<br>', $html);
    return store_send_mail($cfg, (string)$u['email'], $subject, $text, $html);
}

/**
 * Check a code against the stored HMAC. Consumes it on success, and destroys it
 * after too many wrong guesses.
 *
 * hash_equals, because a byte-at-a-time comparison of a secret is a timing
 * oracle — the same reason store_review_token_ok() uses it.
 */
function store_email_otp_claim(PDO $db, int $adminId, string $code): bool {
    $q = $db->prepare('select email_otp_hash, email_otp_expires, email_otp_attempts
                         from admin_users where id = ?');
    $q->execute([$adminId]);
    $row = $q->fetch();
    if (!$row || ($row['email_otp_hash'] ?? '') === '' || $row['email_otp_hash'] === null) return false;
    if ($row['email_otp_expires'] === null || strtotime((string)$row['email_otp_expires']) < time()) {
        return false;
    }
    if ((int)$row['email_otp_attempts'] >= STORE_EMAIL_OTP_TRIES) return false;

    $given = preg_replace('/\D/', '', store_ascii_digits($code));
    if ($given !== '' && hash_equals((string)$row['email_otp_hash'], store_email_otp_hash($given))) {
        // USED ONCE. Cleared before anything is granted, so the same code
        // replayed a second later finds nothing to match.
        $db->prepare('update admin_users set email_otp_hash = null, email_otp_expires = null,
                          email_otp_attempts = 0 where id = ?')->execute([$adminId]);
        return true;
    }

    $tries = (int)$row['email_otp_attempts'] + 1;
    if ($tries >= STORE_EMAIL_OTP_TRIES) {
        // Five wrong and the code is gone. Grinding one code is out; the only
        // way on is to ask for another, which is throttled.
        $db->prepare('update admin_users set email_otp_hash = null, email_otp_expires = null,
                          email_otp_attempts = ? where id = ?')->execute([$tries, $adminId]);
    } else {
        $db->prepare('update admin_users set email_otp_attempts = ? where id = ?')
           ->execute([$tries, $adminId]);
    }
    return false;
}

function store_login(string $email, string $password): array {
    $db = store_db();

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

    $q = $db->prepare('select id, email, password_hash, failed_attempts, locked_until,
                              totp_secret, totp_enabled, email_otp_enabled
                         from admin_users where email = ?');
    $q->execute([mb_strtolower(trim($email))]);
    $u = $q->fetch();

    if ($u && $u['locked_until'] !== null && strtotime($u['locked_until']) > time()) {
        store_fail('locked', 429);
    }

    // password_verify runs even for an unknown email (against a throwaway
    // hash), so a missing account and a wrong password take the same time.
    $hash = $u['password_hash'] ?? password_hash(bin2hex(random_bytes(8)), PASSWORD_DEFAULT);
    if (!$u || !password_verify($password, $hash)) {
        if ($u) {
            $fails = (int)$u['failed_attempts'] + 1;
            $db->prepare('update admin_users set failed_attempts = ?, locked_until = ? where id = ?')
               ->execute([$fails, $fails >= 5 ? date('Y-m-d H:i:s', time() + 900) : null, $u['id']]);
        }
        // AND count it against the IP, because the lock above is per ACCOUNT.
        // Five failures freeze one email; they do nothing about one guess tried
        // against a hundred addresses, and nothing about an unknown email at
        // all — the branch above cannot even run, since there is no row to
        // lock. That is the shape of a spray, and without this it is free.
        //
        // Counted only on FAILURE, so a busy admin signing in and out is never
        // touched, and set well above the per-account ceiling: with one admin
        // account the lockout bites first and this never fires. It is here for
        // the case the lockout cannot see.
        store_throttle($db, 'login_fail', 50, 900);
        store_fail('bad_credentials', 401);
    }

    // THE PASSWORD IS ONLY THE FIRST FACTOR NOW.
    //
    // Nothing is granted here when a second one is enrolled: no session, no
    // cookie, no admin_id. What happens instead is a PENDING marker naming the
    // account and the minute it was created, and the caller is told to ask for
    // the code. Anything that stops at this point has proved it knows the
    // password and nothing more, which is exactly what a phished password is
    // worth on its own.
    //
    // failed_attempts is NOT cleared yet either. Clearing it here would let a
    // password-guesser reset their own five-attempt lockout every time they
    // guessed right but could not produce a code — turning the second factor
    // into a way to make the first one unlimited.
    $hasTotp  = (int)($u['totp_enabled'] ?? 0) === 1 && (string)($u['totp_secret'] ?? '') !== '';
    // TOTP WINS WHERE BOTH ARE ON. An authenticator holds a secret that never
    // travels; an emailed code is only as safe as the mailbox it lands in. An
    // account with both should be asked for the stronger one, and offering a
    // choice would let an attacker pick the weaker.
    $hasEmail = !$hasTotp && (int)($u['email_otp_enabled'] ?? 0) === 1;

    if ($hasTotp || $hasEmail) {
        store_session_start();
        // A fresh id here too: the pending marker is a privilege change of its
        // own, small as it is, and fixating it is the same attack.
        session_regenerate_id(true);
        unset($_SESSION['admin_id'], $_SESSION['admin_email']);
        $_SESSION['pending_admin_id'] = (int)$u['id'];
        $_SESSION['pending_at'] = time();
        $_SESSION['pending_via'] = $hasTotp ? 'totp' : 'email';

        $out = ['id' => (int)$u['id'], 'email' => $u['email'], 'need_code' => true,
                'code_via' => $hasTotp ? 'totp' : 'email'];
        if ($hasEmail) {
            // Issued and sent HERE, not on a second request: the caller has
            // proved the password, and a separate "send me a code" route would
            // post mail to any address on demand.
            $code = store_email_otp_issue($db, $u);
            $out['code_sent_to'] = store_mask_email((string)$u['email']);
            // A MAIL FAILURE IS TOLD, NOT HIDDEN. Swallowing it asks the owner
            // for a code that was never sent and leaves them no way in at all —
            // the one failure mode that turns a second factor into a locked
            // door. The code stays valid, so a retry works the moment the mail
            // problem is fixed.
            $out['code_sent'] = store_email_otp_send($u, $code);
        }
        return $out;
    }

    store_admin_grant($db, $u);
    return ['id' => (int)$u['id'], 'email' => $u['email']];
}

// The half of sign-in that actually hands over the shop. Shared by the
// one-factor path above and the code-verifying path below, so the two cannot
// drift into different ideas of what a signed-in admin looks like.
function store_admin_grant(PDO $db, array $u): void {
    $db->prepare('update admin_users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = ?')
       ->execute([$u['id']]);

    store_session_start();
    session_regenerate_id(true); // a fresh id on privilege change, always
    unset($_SESSION['pending_admin_id'], $_SESSION['pending_at']);
    $_SESSION['admin_id'] = (int)$u['id'];
    $_SESSION['admin_email'] = $u['email'];
    $_SESSION['started_at'] = time();
    $_SESSION['seen_at'] = time();
}

// Step two: the six digits.
//
// FIVE MINUTES to type them. A pending marker that never expired would sit in
// the session for as long as the browser was open, so a password typed on a
// shared machine in the morning would still be one glance at a phone away from
// a session in the afternoon.
const STORE_TOTP_PENDING_SECONDS = 300;

function store_login_code(string $code): array {
    $db = store_db();
    store_session_start();

    $id = (int)($_SESSION['pending_admin_id'] ?? 0);
    $since = (int)($_SESSION['pending_at'] ?? 0);
    $via = (string)($_SESSION['pending_via'] ?? 'totp');
    // A DIFFERENT WINDOW PER FACTOR. TOTP is already on the phone in the
    // owner's hand, so five minutes is generous. An emailed code has to cross a
    // mail server and be found in an inbox, and five minutes is how somebody
    // misses it — the code itself lives ten, and the marker must not expire
    // before the thing it is waiting for.
    $window = $via === 'email' ? STORE_EMAIL_OTP_SECONDS : STORE_TOTP_PENDING_SECONDS;
    if ($id === 0 || $since === 0 || time() - $since > $window) {
        unset($_SESSION['pending_admin_id'], $_SESSION['pending_at'], $_SESSION['pending_via']);
        store_fail('code_expired', 401);
    }

    // COUNTED PER IP, BEFORE ANYTHING IS CHECKED. Six digits is a million
    // possibilities and a ±1-step window makes three of them live at any
    // instant, so unlimited guessing is roughly a one-in-333,000 shot per try —
    // minutes of automated traffic. This is the only thing standing between a
    // stolen password and the shop.
    store_throttle($db, 'totp', 10, 300);

    $q = $db->prepare('select id, email, totp_secret, totp_enabled, email_otp_enabled, failed_attempts
                         from admin_users where id = ?');
    $q->execute([$id]);
    $u = $q->fetch();
    // THE FACTOR COMES FROM THE SESSION, never from the request. Reading it
    // from the body would let a caller who holds the password say "check my
    // email code instead" on an account that is protected by TOTP.
    $expected = $via === 'email' ? (int)($u['email_otp_enabled'] ?? 0) : (int)($u['totp_enabled'] ?? 0);
    if (!$u || $expected !== 1) store_fail('code_expired', 401);

    $ok = $via === 'email'
        ? store_email_otp_claim($db, $id, $code)
        : store_totp_claim($db, $id, (string)$u['totp_secret'], $code);
    if (!$ok) {
        // A wrong code counts against the SAME five-strike lockout the password
        // uses. Someone holding the password and guessing at codes is still an
        // attack on this account, and the account should close for a quarter of
        // an hour just as it would for password guessing.
        $fails = (int)$u['failed_attempts'] + 1;
        $db->prepare('update admin_users set failed_attempts = ?, locked_until = ? where id = ?')
           ->execute([$fails, $fails >= 5 ? date('Y-m-d H:i:s', time() + 900) : null, $id]);
        store_fail('bad_code', 401);
    }

    store_admin_grant($db, $u);
    return ['id' => (int)$u['id'], 'email' => $u['email']];
}

// A code demanded again from an ALREADY signed-in admin, before something that
// changes who can sign in: the password, the email, the phone number, or
// switching the second factor off. A session cookie is a bearer token — an
// unlocked laptop is enough — and these are the four changes that would let
// whoever is sitting at it keep the shop permanently.
function store_require_fresh_code(PDO $db, array $who, string $code): void {
    $q = $db->prepare('select email, totp_secret, totp_enabled, email_otp_enabled
                         from admin_users where id = ?');
    $q->execute([$who['id']]);
    $u = $q->fetch();
    if (!$u) return;
    $id = (int)$who['id'];

    if ((int)$u['totp_enabled'] === 1) {
        store_throttle($db, 'totp', 10, 300);
        if (!store_totp_claim($db, $id, (string)$u['totp_secret'], $code)) store_fail('bad_code', 401);
        return;
    }

    // THE EMAIL FACTOR COUNTS HERE TOO, and leaving it out was the hole this
    // closes: an account whose second factor is an emailed code would have
    // sailed past the early return below and changed its own password, email
    // or phone on the session cookie alone — which is precisely what this
    // function exists to prevent, and precisely the case where the laptop is
    // already unlocked.
    //
    // The code has to be one in flight, and the code they signed in with is
    // NOT one: it was consumed on use, which is the point of it. So the panel
    // asks admin.php?r=otp_send for a fresh one first — that route mails the
    // signed-in account's own address and nothing else, and is throttled to
    // once a minute. Saying "sign out and back in" here, as an earlier draft
    // of this comment did, would have been wrong.
    if ((int)$u['email_otp_enabled'] === 1) {
        store_throttle($db, 'totp', 10, 300);
        if (!store_email_otp_claim($db, $id, $code)) store_fail('bad_code', 401);
        return;
    }

    // Not enrolled in either: nothing to ask for.
}

// ---------------------------------------------------------------- settings
//
// Small named pieces of configuration the owner edits without a deploy: the
// slider's speed and size, the promo bar's text. Stored as JSON in one table
// so adding a setting is an INSERT, not a migration on a live shop.
//
// Reads are cached per request. api.php?r=slides asks for two of these and the
// home page asks for the same two again on the next request; there is no
// reason for either to hit the table twice.
function store_settings(PDO $db): array {
    static $all = null;
    if ($all === null) {
        $all = [];
        foreach ($db->query('select name, value from settings') as $row) {
            $decoded = json_decode((string)$row['value'], true);
            $all[$row['name']] = is_array($decoded) ? $decoded : [];
        }
    }
    return $all;
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
                    'starts_at' => null, 'ends_at' => null],
    // HOW TO REACH THE SHOP. Hard-coded into the built storefront in seven
    // places — Contact, About, Privacy, Terms, Returns, Invoice and the footer
    // — which meant changing the shop's phone number was a rebuild by whoever
    // holds the site's source, and the invoice would keep the old one until
    // they got round to it.
    //
    // THE DEFAULTS ARE THE VALUES ALREADY IN THE BUNDLE, and that is the whole
    // safety of this. Until somebody saves something in the panel, every
    // consumer reads exactly what the built pages already say, so adding this
    // changes nothing on screen. An empty default would have blanked the
    // shop's phone number on every page the first time this deployed.
    'contact'   => [
        'phone'     => '+965 2209 1914',
        'whatsapp'  => '96522091914',
        'email'     => 'cs@sporta.com.kw',
        'address_ar' => '',
        'address_en' => '',
        'hours_ar'  => '',
        'hours_en'  => '',
        'instagram' => '',
    ],
];

function store_setting(PDO $db, string $name): array {
    return array_merge(STORE_SETTING_DEFAULTS[$name] ?? [], store_settings($db)[$name] ?? []);
}

function store_setting_save(PDO $db, string $name, array $value): void {
    $db->prepare('insert into settings (name, value) values (?, ?)
                  on duplicate key update value = values(value)')
       ->execute([$name, json_encode($value, JSON_UNESCAPED_UNICODE)]);
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
        'update product_variants set stock = stock - ?
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
function store_stock_release(PDO $db, int $orderId): bool {
    $mark = $db->prepare(
        'update orders set stock_released = 1
          where id = ? and stock_claimed = 1 and stock_released = 0'
    );
    $mark->execute([$orderId]);
    if ($mark->rowCount() !== 1) return false;

    // order_items records the size that was taken; that is what goes back.
    //
    // SUMMED PER VARIANT, not joined line by line. store_stock_claim() walks
    // the cart and decrements ONCE PER LINE, and nothing merges a cart that
    // names the same slug+size twice — store_price_lines() prices whatever it
    // is handed, and a client posting two identical entries is a POST away.
    // A multi-table UPDATE joined straight onto order_items updates each
    // product_variants row AT MOST ONCE however many lines matched, so that
    // order was decremented twice and credited back once: the difference
    // vanished off the shelf permanently, with no error anywhere to find it
    // by. Aggregating first makes the release the exact mirror of the claim.
    $put = $db->prepare(
        'update product_variants v
           join (select p.slug as slug, i.size as size, sum(i.qty) as qty
                   from order_items i
                   join products p on p.id = i.product_id
                  where i.order_id = ? and i.size is not null
                  group by p.slug, i.size) s
             on s.slug = v.slug and s.size = v.size
            set v.stock = v.stock + s.qty'
    );
    $put->execute([$orderId]);
    return true;
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
        $qty = (int)($item['qty'] ?? 1);
        if ($qty < 1 || $qty > 99) store_fail('invalid_qty');

        $size = strtoupper(trim((string)($item['size'] ?? '')));
        $fit  = strtolower(trim((string)($item['fit'] ?? '')));
        // Rejected, never silently dropped — a dropped size is an order that
        // looks complete and does not say which size to pack.
        if ($size !== '' && !in_array($size, STORE_SIZES, true)) store_fail('invalid_size');
        if ($fit  !== '' && !in_array($fit,  STORE_FITS,  true)) store_fail('invalid_fit');

        $q->execute([(string)($item['slug'] ?? '')]);
        $prod = $q->fetch();
        if (!$prod) store_fail('unavailable_' . (string)($item['slug'] ?? '?'));

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
            $hasSizes->execute([(string)($item['slug'] ?? '')]);
            if ($hasSizes->fetchColumn()) store_fail('size_required_' . (string)($item['slug'] ?? '?'));
        }

        $eff = store_effective_price($prod);
        $lines[] = [
            'product_id' => (int)$prod['id'],
            // Carried because product_variants is keyed on slug+size, not on
            // product_id — store_stock_claim() needs it and the id will not do.
            'slug'       => (string)($item['slug'] ?? ''),
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
function store_datetime(?string $raw): ?string {
    $v = trim((string)$raw);
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
function store_internal_href(?string $raw): ?string {
    $v = trim((string)$raw);
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
    if (!preg_match('#^/(?![/\\\\])[A-Za-z0-9/_\-\?=&%\.]{0,180}$#', $v)) store_fail('invalid_link');
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

// ============================================================ returns
//
// The /returns page has always been policy text, an order-number box and a
// WhatsApp button. Nothing checked that the order existed, nothing knew what
// was on it, and nothing was written down — the request lived as a message in
// somebody's phone. These four functions are the missing half: look the order
// up, show the customer the lines they actually bought, and record what they
// asked for against those lines.

const STORE_RETURN_DAYS = 14;

// The reference the customer keeps and the driver reads back. Base32 without
// the characters that are argued about over a phone: no I, no O, no 0, no 1.
// 8 characters of a 32-symbol alphabet is 40 bits, which is not a secret and
// is not asked to be one — the lookup is gated on the order's phone number,
// not on this. It exists so two requests can be told apart.
function store_return_ref(): string {
    $alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    $out = '';
    for ($i = 0; $i < 8; $i++) $out .= $alphabet[random_int(0, 31)];
    return 'SPR' . $out;
}

// Is this order still inside the returns window, and from when?
//
// FROM DELIVERY, NOT FROM THE ORDER. The policy says fourteen days "من
// الاستلام" — from receipt — and an order placed on the 1st and delivered on
// the 10th has not used nine of its days sitting in a van. `fulfilled_at` is
// when the parcel was marked delivered; orders that predate that column, or
// that are marked delivered without a timestamp, fall back to created_at,
// which is the only other date the row has and is never later than delivery.
function store_return_window(array $order, ?string $now = null): array {
    $from = $order['fulfilled_at'] ?: $order['created_at'];
    $start = strtotime((string)$from);
    $deadline = $start + (STORE_RETURN_DAYS * 86400);
    $at = $now === null ? time() : strtotime($now);
    return [
        'from'      => date('Y-m-d H:i:s', $start),
        'deadline'  => date('Y-m-d H:i:s', $deadline),
        'days_left' => (int) max(0, (int) ceil(($deadline - $at) / 86400)),
        'open'      => $at <= $deadline,
    ];
}

// The order behind a reference, and the lines on it, with how much of each
// line is still available to ask about.
//
// THE PHONE IS THE GATE. `track_id` is chosen by the CLIENT at checkout and
// only has to match [A-Za-z0-9]{6,30} — a six-character order number is a
// perfectly legal one, and this route would otherwise hand a stranger a
// customer's name and shopping. Requiring the order's own phone number makes
// guessing the reference worth nothing on its own. Same call as ?r=balance.
function store_return_lookup(PDO $db, string $ref, string $phone): array {
    $q = $db->prepare(
        'select id, track_id, customer_name, customer_phone, payment_method,
                payment_status, fulfilment_status, created_at, fulfilled_at
           from orders where track_id = ?'
    );
    $q->execute([$ref]);
    $o = $q->fetch();
    // ONE ERROR FOR BOTH MISSES. "no such order" and "wrong phone for this
    // order" told apart is a way to test whether an order number exists, and
    // the difference is no use to a customer who has simply mistyped.
    if (!$o || store_phone($o['customer_phone']) !== $phone) return ['error' => 'return_not_found'];

    // Nothing to return from an order the shop never took money for, and
    // nothing to return from one that was cancelled.
    if ($o['payment_status'] !== 'paid')          return ['error' => 'return_not_paid'];
    if ($o['fulfilment_status'] === 'cancelled')  return ['error' => 'return_cancelled'];

    $window = store_return_window($o);

    $it = $db->prepare(
        // coalesce for the same reason ?r=invoice uses it: the snapshot is
        // what the customer was sold, and the join is the fallback for orders
        // placed before the snapshot existed.
        'select oi.id, oi.qty, oi.size, oi.fit, oi.unit_price,
                coalesce(oi.name_en, p.name_en) as name_en,
                coalesce(oi.name_ar, p.name_ar) as name_ar,
                p.slug, p.category, p.image
           from order_items oi join products p on p.id = oi.product_id
          where oi.order_id = ? order by oi.id'
    );
    $it->execute([(int)$o['id']]);
    $lines = $it->fetchAll();

    // How much of each line is already spoken for. A request that was rejected
    // or cancelled releases its lines — the customer may ask again, and being
    // refused once must not cost them the item for ever.
    $used = $db->prepare(
        "select ri.order_item_id, sum(ri.qty) as n
           from return_request_items ri
           join return_requests rr on rr.id = ri.request_id
          where rr.order_id = ? and rr.status not in ('rejected','cancelled')
          group by ri.order_item_id"
    );
    $used->execute([(int)$o['id']]);
    $taken = [];
    foreach ($used->fetchAll() as $row) $taken[(int)$row['order_item_id']] = (int)$row['n'];

    $items = [];
    foreach ($lines as $l) {
        $id = (int)$l['id'];
        $items[] = [
            'id'          => $id,
            'name_en'     => $l['name_en'],
            'name_ar'     => $l['name_ar'],
            'slug'        => $l['slug'],
            'image'       => $l['image'],
            'size'        => $l['size'],
            'fit'         => $l['fit'],
            'qty'         => (int)$l['qty'],
            'unit_price'  => (float)$l['unit_price'],
            'available'   => max(0, (int)$l['qty'] - ($taken[$id] ?? 0)),
            // WOMEN'S CLOTHING CANNOT BE EXCHANGED. The policy on the page says
            // so and the size adviser already warns about it mid-purchase; this
            // is the same rule at the point it actually costs something. It is
            // sent per line so the form can grey the choice rather than accept
            // it and refuse afterwards.
            'no_exchange' => ((string)$l['category']) === 'women',
        ];
    }

    // Open requests already on this order, so the page can say "you asked us
    // about this on Tuesday" instead of quietly taking a second one.
    $open = $db->prepare(
        "select ref, kind, status, created_at from return_requests
          where order_id = ? and status not in ('rejected','cancelled')
          order by created_at desc limit 10"
    );
    $open->execute([(int)$o['id']]);

    return [
        // INTERNAL, and stripped by the route before anything is sent out —
        // store_return_create() needs it and the customer has no use for it.
        'order_id'      => (int)$o['id'],
        'track_id'      => $o['track_id'],
        'customer_name' => $o['customer_name'],
        'placed_at'     => $o['created_at'],
        'delivered_at'  => $o['fulfilled_at'],
        'delivered'     => $o['fulfilment_status'] === 'delivered',
        'payment_method' => $o['payment_method'],
        'window'        => $window,
        'items'         => $items,
        'existing'      => $open->fetchAll(),
    ];
}

// Write the request. Everything it validates, it validates against the ORDER —
// never against what the browser sent about the order.
function store_return_create(PDO $db, array $in): array {
    $found = store_return_lookup($db, $in['ref'], $in['phone']);
    if (isset($found['error'])) return $found;
    if (!$found['window']['open']) return ['error' => 'return_window_closed'];

    $byId = [];
    foreach ($found['items'] as $i) $byId[$i['id']] = $i;

    $wanted = [];
    foreach ($in['items'] as $row) {
        $id  = (int)($row['id'] ?? 0);
        $qty = (int)($row['qty'] ?? 0);
        $line = $byId[$id] ?? null;
        if ($line === null) return ['error' => 'return_line_unknown'];
        if ($qty < 1 || $qty > $line['available']) return ['error' => 'return_qty'];
        $size = strtoupper(trim((string)($row['want_size'] ?? '')));
        if ($size !== '' && !in_array($size, STORE_SIZES, true)) return ['error' => 'return_size'];
        if ($in['kind'] === 'exchange' && $line['no_exchange']) return ['error' => 'return_no_exchange'];
        // A size is meaningless on a return: nothing is being sent back out.
        if ($in['kind'] === 'return') $size = '';
        $wanted[] = ['id' => $id, 'qty' => $qty, 'want_size' => $size === '' ? null : $size];
    }
    if (!$wanted) return ['error' => 'return_no_items'];

    // The reference is generated, not supplied, so a collision is the shop's
    // problem to retry rather than the customer's to see. Three attempts of a
    // 40-bit space is past any realistic collision.
    for ($attempt = 0; ; $attempt++) {
        $ref = store_return_ref();
        try {
            $db->beginTransaction();
            $db->prepare(
                'insert into return_requests (ref, order_id, kind, reason, lang, phone)
                 values (?, ?, ?, ?, ?, ?)'
            )->execute([$ref, $found['order_id'], $in['kind'], $in['reason'], $in['lang'], $in['phone']]);
            $rid = (int)$db->lastInsertId();
            $line = $db->prepare(
                'insert into return_request_items (request_id, order_item_id, qty, want_size)
                 values (?, ?, ?, ?)'
            );
            foreach ($wanted as $w) $line->execute([$rid, $w['id'], $w['qty'], $w['want_size']]);
            $db->commit();
            return ['ref' => $ref, 'kind' => $in['kind'], 'items' => count($wanted)];
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            if ($attempt >= 2) throw $e;
        }
    }
}
