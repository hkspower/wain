<?php
// Sporta native store API — the endpoints the STOREFRONT calls.
// Place at public_html/api/. Routes:
//
//   GET  ?r=products            active catalogue (what loadProducts reads)
//   GET  ?r=slides              hero slides + slider settings + the promo bar
//   GET  ?r=slide_image&id=&v=  one slide photograph, cached for a year
//   POST ?r=discount            check a coupon code against a cart
//   GET  ?r=stock               per-size availability (never the cost column)
//   POST ?r=order               create an order — the port of create_order
//   GET  ?r=status&id=TRACK     payment status for the result/track pages
//   GET  ?r=invoice&id=TRACK    the printable invoice document
//
// No authentication on these, deliberately, and the same reasoning as the
// grants they replace: the catalogue and stock are shop-window data,
// and the ORDER NUMBER is the credential for status and invoice — ~64 bits
// from crypto.getRandomValues, exactly as get_order_status has worked since
// day one. What the invoice returns is scoped accordingly (no phone number).

declare(strict_types=1);
require __DIR__ . '/store.php';

$r = $_GET['r'] ?? '';
$db = store_db();

// ------------------------------------------------------------- rate limits
// EVERY ROUTE IS LISTED HERE, AND THE DEFAULT IS "PROTECTED".
//
// Throttling used to be opt-in: a line typed inside each route's own if
// block, by whoever remembered. Seven of the eleven routes had none, and the
// one that turned a request into outbound mail was among them for months
// while the coupon preview beside it was guarded from the day it shipped.
// That is not a routing bug, it is what opt-in security always does — the
// next route added inherits nothing, and there is nowhere to look to see
// which are covered.
//
// The usual defence for leaving GETs alone is that they are cached, and here
// it does not hold: /api/.htaccess sets Cache-Control: no-store on all of
// them, so every one runs a real query for every hit. ?r=stock is a full scan
// of product_variants.
//
// The ceilings are generous on purpose. A shopper loading the shop, then a
// product, then the cart touches products/stock/slides a handful of times a
// minute; 120 is far above that and far below useful for hammering the
// database. The two that cost real money or real mail are tighter.
//
// A null means DELIBERATELY UNLIMITED HERE, and the reason must be written
// beside it. Both of them are still throttled — just not on arrival, because
// for these two WHEN the request is counted is the whole point.
$STORE_LIMITS = [
    'products'    => [120, 60],
    'slides'      => [120, 60],
    'brands'      => [120, 60],
    'stock'       => [120, 60],
    'status'      => [60, 60],
    'invoice'     => [60, 60],
    'assistant'   => [30, 60],
    'order'       => [20, 600],   // queues mail to the warehouse — see ?r=order
    // A review link is signed, so this is not guessable — but a valid link
    // held by one person must not become a way to hammer the database, and
    // ?r=review WRITES a discount row. Generous enough that a customer who
    // mistypes, reloads and resubmits never meets it.
    'review_invite' => [30, 600],
    'review'        => [10, 600],
    'slide_image' => null,        // hashed URL, one-year immutable cache: the
                                  // browser asks once, but a page legitimately
                                  // asks for five slides at once and a cold
                                  // cache would trip any sane ceiling.
    'discount'    => null,        // counted inside the route, on FAILED lookups
                                  // only — re-checking a basket is not guessing.
    'say'         => null,        // counted inside the route, AFTER the
                                  // signature verifies, so forgeries cannot
                                  // ration a real speaker press.
];
// FAIL CLOSED. This used to read `isset($STORE_LIMITS[$r])`, and isset() is
// false for a null value — so an explicit "deliberately unlimited" entry and a
// route somebody FORGOT to add were indistinguishable, and both went through
// unthrottled. The table is complete today; the failure mode is the next route
// added, shipped uncounted, with nothing to notice it.
//
// So the default is now a limit rather than the absence of one. A route must
// opt OUT by name, with the reason written beside it, and opting out is
// something you have to do on purpose.
if (array_key_exists($r, $STORE_LIMITS)) {
    if ($STORE_LIMITS[$r] !== null) store_throttle($db, $r, ...$STORE_LIMITS[$r]);
} else {
    // Anything unlisted — a new route, or a garbage ?r= from a scanner. Both
    // cost a database connection and a PHP process, so neither should be free.
    store_throttle($db, 'default', 60, 60);
}

// ---------------------------------------------------------------- products
if ($r === 'products') {
    $rows = $db->query(
        'select slug, name_en, name_ar, desc_en, desc_ar, price, sale_price,
                sale_starts_at, sale_ends_at, featured, featured_sort, category, image,
                no_exchange
           from products where active = 1 order by name_en'
    )->fetchAll();
    foreach ($rows as &$row) {
        // `price` is what the shop CHARGES, so a sale price replaces it rather
        // than travelling beside it. The storefront strikes through
        // `list_price` when on_sale is true, and every other consumer — cart
        // totals, the wishlist, structured data — keeps reading `price` and is
        // correct without knowing promotions exist.
        //
        // The sale WINDOW is resolved here and never sent. A browser that
        // decides for itself whether a sale is live is a browser that can
        // decide it is live, and the dates are the shop's business anyway.
        $eff = store_effective_price($row);
        $row['price']      = $eff['fils'] / 1000;
        $row['list_price'] = $eff['list_fils'] / 1000;
        $row['on_sale']    = $eff['on_sale'];
        $row['featured']   = (bool)$row['featured'];
        // Women's clothing cannot be exchanged. The storefront needs this to
        // say so on the product page and to refuse the item on /returns —
        // finding out at the pickup is the worst possible moment.
        $row['no_exchange'] = (bool)$row['no_exchange'];
        unset($row['sale_price'], $row['sale_starts_at'], $row['sale_ends_at']);
    }
    unset($row);
    store_out($rows);
}

// ------------------------------------------------------------------ slides
// The home hero, plus the two settings that describe HOW it plays and the
// promo bar above it. One request: they are rendered by the same screen at the
// same moment, and three round trips to paint one header is three too many.
//
// The photographs are NOT in this response. They are the largest thing on the
// site and they change rarely, so each slide carries a URL into r=slide_image
// with a content hash, and the browser caches the bytes for a year. Inlining
// them would put ~700 kB of base64 into a JSON document that must not be
// cached at all, on every single page load.
if ($r === 'slides') {
    $rows = $db->query(
        'select id, sort, title_en, title_ar, subtitle_en, subtitle_ar,
                cta_label_en, cta_label_ar, cta_href, image_hash, image_w, image_h,
                focal_x, focal_y
           from hero_slides where active = 1 and image is not null order by sort, id'
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['id']    = (int)$row['id'];
        $row['image'] = 'api.php?r=slide_image&id=' . $row['id'] . '&v=' . substr((string)$row['image_hash'], 0, 16);
        $row['width']  = $row['image_w'] === null ? null : (int)$row['image_w'];
        $row['height'] = $row['image_h'] === null ? null : (int)$row['image_h'];
        $row['focal_x'] = (int)$row['focal_x'];
        $row['focal_y'] = (int)$row['focal_y'];
        unset($row['image_hash'], $row['image_w'], $row['image_h']);
    }
    unset($row);

    $bar = store_setting($db, 'promo_bar');
    // The schedule is resolved here for the same reason the sale window is.
    $bar['live'] = (bool)$bar['enabled'] && store_window_open($bar['starts_at'] ?? null, $bar['ends_at'] ?? null);
    unset($bar['starts_at'], $bar['ends_at']);

    store_out(['slides' => $rows, 'hero' => store_setting($db, 'hero'), 'promo_bar' => $bar]);
}

// One slide's bytes.
//
// Served from the row, decoded here, with a long immutable cache — the ?v= is
// the content hash, so a replaced photograph is a different URL and is picked
// up at once while the old one stays cacheable forever. This is what makes
// storing images in the database cost the same as storing them as files, and
// it is why nothing on this server needs write access to the web root.
if ($r === 'slide_image') {
    $q = $db->prepare('select image from hero_slides where id = ?');
    $q->execute([(int)($_GET['id'] ?? 0)]);
    $data = (string)($q->fetchColumn() ?: '');
    if ($data === '' || !preg_match('#^data:image/(png|jpeg|webp);base64,(.+)$#s', $data, $m)) {
        http_response_code(404);
        exit;
    }
    $bytes = base64_decode($m[2], true);
    if ($bytes === false) { http_response_code(404); exit; }

    header('Content-Type: image/' . $m[1]);
    header('Content-Length: ' . strlen($bytes));
    // A year, immutable — safe ONLY because the URL carries the content hash.
    header('Cache-Control: public, max-age=31536000, immutable');
    // It is an image and nothing else, whatever a browser might sniff it as.
    header('X-Content-Type-Options: nosniff');
    // .htaccess sets no-store for this whole folder, which is right for the
    // JSON endpoints and wrong for an immutable image. Replace it explicitly.
    header_remove('Pragma');
    echo $bytes;
    exit;
}

// -------------------------------------------------------------- discount check
// Check a code against a cart BEFORE the customer commits to paying.
//
// This deliberately re-prices the cart from the products table rather than
// trusting a subtotal from the browser: otherwise "is my code valid for a
// 50 KWD order" could be asked about an order that does not exist, and the
// answer would be a preview the checkout could not honour. The number this
// returns is the number create_order will compute, because it is the same code.
if ($r === 'discount' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $b = store_body();
    $items = is_array($b['items'] ?? null) ? $b['items'] : [];
    if (count($items) === 0 || count($items) > 50) store_fail('empty_cart');

    $priced = store_price_lines($db, $items);
    $sub = array_sum(array_column($priced, 'line_fils'));
    $res = store_discounts_for($db, $priced, $sub, (string)($b['code'] ?? ''));
    if ($res['error'] !== null) {
        // Only a FAILED lookup is counted, and it is counted before the answer
        // is given. A shopper re-checking a basket with a code that works is
        // not guessing; a script walking SAVE10, SAVE15, SAVE20 is, and thirty
        // wrong answers in ten minutes is far past anyone typing by hand.
        store_throttle($db, 'discount', 30, 600);
        store_fail($res['error']);
    }

    // DELIVERY IS PART OF THE QUOTE, or the quote is not what the customer
    // pays. This endpoint exists so the checkout can show a number computed by
    // the same code that will charge it; leaving the fee out here would put a
    // total on screen that is 1.000 KWD lower than the one the bank asks for,
    // which is the exact drift the shared-code rule was written to prevent.
    $previewDelivery = STORE_DELIVERY_FEE_FILS;
    store_out([
        'subtotal' => (float)store_kwd($sub),
        'discount' => (float)store_kwd($res['total_fils']),
        'delivery' => (float)store_kwd($previewDelivery),
        'total'    => (float)store_kwd($sub - $res['total_fils'] + $previewDelivery),
        'applied'  => array_map(fn ($a) => ['label' => $a['label'], 'code' => $a['code'],
                                            'amount' => (float)store_kwd($a['fils'])], $res['applied']),
    ]);
}

// ------------------------------------------------------------------ brands
// The brands the storefront may show. ACTIVE ONLY — "disabled" has to mean
// invisible to a shopper or the switch means nothing. The logo travels as the
// data URL it is stored as, so a brand needs no second request and no file.
if ($r === 'brands') {
    $rows = $db->query(
        'select slug, name_en, name_ar, logo from brands where active = 1 order by sort, name_en'
    )->fetchAll();
    store_out($rows);
}

// ------------------------------------------------------------------- stock
if ($r === 'stock') {
    // Same columns as the product_stock view — and NOT cost_aed, which is the
    // one commercially sensitive number in the schema.
    $rows = $db->query(
        'select slug, size, sku, stock, (stock > 0) as in_stock from product_variants'
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['stock'] = (int)$row['stock'];
        $row['in_stock'] = (bool)$row['in_stock'];
    }
    store_out($rows);
}

// ------------------------------------------------------------------- status
if ($r === 'status') {
    $q = $db->prepare('select payment_status, payment_method, amount from orders where track_id = ?');
    $q->execute([trim((string)($_GET['id'] ?? ''))]);
    $row = $q->fetch();
    if (!$row) store_out(null);
    $row['amount'] = (float)$row['amount'];
    store_out($row);
}

// -------------------------------------------------------------- سبورتا AI
//
// POST, because a question is not a resource to be fetched and must never end
// up in a proxy cache or a browser history. Throttled per IP: it is an
// unauthenticated endpoint that runs database queries, so the same guard the
// discount oracle has applies here.
if ($r === 'assistant' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $in = json_decode((string) file_get_contents('php://input'), true) ?: [];
    // Capped hard. Anything longer than this is not a customer question, and
    // an unbounded string reaching a paid model is somebody else's bill.
    $msg = mb_substr(trim((string) ($in['message'] ?? '')), 0, 500);
    $lang = ($in['lang'] ?? 'en') === 'ar' ? 'ar' : 'en';
    if ($msg === '') store_out(['error' => 'empty'], 400);
    require_once __DIR__ . '/assistant.php';
    store_out(assistant_answer($db, store_config(), $msg, $lang));
}

// ------------------------------------------------------- سبورتا AI, out loud
//
// GET, and the text is in the URL, because this answers with an mp3 that a
// browser <audio> element fetches and that should be cacheable.
//
// THE SIGNATURE IS THE WHOLE POINT. Without it this is a free text-to-speech
// service for the entire internet, billed to this shop: anyone could POST a
// novel and have ElevenLabs read it. `v` is an HMAC of the exact text, keyed
// on cron_key, minted by assistant_answer() when it wrote that sentence. So
// the browser can ask for the sentence the shop just said to it, and for
// nothing else. hash_equals, not ===, so the comparison is constant-time.
if ($r === 'say') {
    require_once __DIR__ . '/assistant.php';
    $cfg  = store_config();
    $text = (string) ($_GET['t'] ?? '');
    $lang = ($_GET['lang'] ?? 'en') === 'ar' ? 'ar' : 'en';
    // Bounded before it is hashed. An unbounded string would still fail the
    // signature check, but only after this process had hashed all of it.
    if ($text === '' || mb_strlen($text) > 1000) store_out(['error' => 'bad_text'], 400);
    if (!assistant_speech_available($cfg)) store_out(['error' => 'no_voice'], 404);
    if (!hash_equals(assistant_speech_sig($cfg, $text, $lang), (string) ($_GET['v'] ?? ''))) {
        store_out(['error' => 'bad_signature'], 403);
    }
    // Throttled only AFTER the signature verifies: a valid speaker press must
    // not be rationed because someone else spent the budget on forgeries.
    store_throttle($db, 'say', 30, 60);
    $mp3 = assistant_speak($cfg, $text, $lang);
    if ($mp3 === null) store_out(['error' => 'tts_failed'], 502);
    header('Content-Type: audio/mpeg');
    header('Content-Length: ' . strlen($mp3));
    // Signed, immutable, and identical for every visitor who asks the same
    // question — exactly the thing a cache is for. Private: it may quote an
    // order number back, and that is not for a shared proxy to keep.
    header('Cache-Control: private, max-age=31536000, immutable');
    echo $mp3;
    exit;
}

// ------------------------------------------------------------------ reviews
//
// Two routes, both keyed on a signed link the shop sent. `review_invite` is
// what the page loads with; `review` is the submission.
//
// The signature is checked BEFORE anything is read or written, so an unsigned
// request costs a hash and nothing else — it never reaches the orders table.
if ($r === 'review_invite') {
    $order = store_review_order(
        $db,
        trim((string)($_GET['o'] ?? '')),
        trim((string)($_GET['t'] ?? '')),
    );
    // ONE ANSWER FOR "no such order", "wrong signature" and "cancelled". They
    // are the same thing to the caller and telling them apart would turn this
    // into an oracle for which order numbers exist.
    if (!$order) store_fail('invalid_review_link', 404);

    store_out([
        'track_id'  => $order['track_id'],
        'name'      => $order['customer_name'],
        'lang'      => $order['customer_lang'] === 'en' ? 'en' : 'ar',
        // Already reviewed: the page shows the code again rather than a form
        // that cannot be submitted.
        'reviewed'  => $order['rating'] !== null,
        'rating'    => $order['rating'] === null ? null : (int)$order['rating'],
        'code'      => $order['reward_code'],
        // The offer, from the server. The page must never name its own number:
        // the percentage the customer is promised and the percentage checkout
        // applies have to be the same one.
        'reward_pct' => STORE_REVIEW_REWARD_PCT,
    ]);
}

if ($r === 'review') {
    $in = store_body();
    $order = store_review_order(
        $db,
        trim((string)($in['track_id'] ?? '')),
        trim((string)($in['token'] ?? '')),
    );
    if (!$order) store_fail('invalid_review_link', 404);

    // ANY rating is accepted and any rating is paid. Rewarding only the good
    // ones is review gating — see reviews.mysql.sql. What is refused here is a
    // number that is not a rating at all, because it would be averaged in.
    $rating = (int)($in['rating'] ?? 0);
    if ($rating < 1 || $rating > 5) store_fail('invalid_rating');

    $comment = trim((string)($in['comment'] ?? ''));
    // Cut to the column, in CHARACTERS not bytes: an Arabic comment is two to
    // three bytes a letter, and slicing on bytes would both truncate it early
    // and cut a character in half.
    if ($comment !== '') $comment = mb_substr($comment, 0, 1000);
    $lang = ($in['lang'] ?? '') === 'en' ? 'en' : 'ar';

    $res = store_review_submit($db, $order, $rating, $comment === '' ? null : $comment, $lang);
    store_out([
        'ok'         => true,
        'already'    => $res['already'],
        'code'       => $res['code'],
        'reward_pct' => STORE_REVIEW_REWARD_PCT,
    ]);
}

// ------------------------------------------------------------------ invoice
if ($r === 'invoice') {
    $q = $db->prepare('select * from orders where track_id = ?');
    $q->execute([trim((string)($_GET['id'] ?? ''))]);
    $o = $q->fetch();
    if (!$o) store_out(null);
    $it = $db->prepare(
        'select p.name_en, p.name_ar, oi.qty, oi.size, oi.fit, oi.unit_price,
                (oi.unit_price * oi.qty) as line_total
           from order_items oi join products p on p.id = oi.product_id
          where oi.order_id = ? order by p.name_en, oi.size'
    );
    $it->execute([$o['id']]);
    $items = $it->fetchAll();
    foreach ($items as &$row) {
        $row['qty'] = (int)$row['qty'];
        $row['unit_price'] = (float)$row['unit_price'];
        $row['line_total'] = (float)$row['line_total'];
    }
    // Same shape as get_order_invoice, and the same deliberate omission: the
    // phone number is not on an invoice — the customer knows their own.
    store_out([
        'track_id'       => $o['track_id'],
        'placed_at'      => $o['created_at'],
        'paid_at'        => $o['paid_at'],
        'amount'         => (float)$o['amount'],
        // The invoice has to add up. Without these an order that was given
        // 3 KWD off shows lines totalling 23 and a total of 20, and the
        // customer's reasonable conclusion is that the shop cannot count.
        // Delivery is on the invoice for exactly that reason: 4.000 of goods
        // against a 5.000 charge reads as a mistake until the fee is named.
        // Read from the ROW, never from the constant — an invoice must say
        // what that customer actually paid, even after the fee changes.
        'subtotal'        => (float)$o['subtotal'],
        'discount_amount' => (float)$o['discount_amount'],
        'delivery_fee'    => (float)$o['delivery_fee'],
        'discount_label'  => $o['discount_label'],
        'discount_code'   => $o['discount_code'],
        'payment_method' => $o['payment_method'],
        'payment_status' => $o['payment_status'],
        'customer_name'  => $o['customer_name'],
        'address'        => [
            'governorate' => $o['customer_governorate'],
            'area'        => $o['customer_area'],
            'block'       => $o['customer_block'],
            'street'      => $o['customer_street'],
            'building'    => $o['customer_building'],
            'floor'       => $o['customer_floor'],
            'flat'        => $o['customer_flat'],
        ],
        'items'          => $items,
    ]);
}

// -------------------------------------------------------------------- order
// The port of create_order — same validation, same tokens, same idempotency,
// same server-side pricing. The browser never sends a price and never will.
if ($r === 'order' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    // THE TIGHTEST LIMIT IN $STORE_LIMITS IS THIS ROUTE'S, and this is the
    // one route where the reason is not the database.
    //
    // A created order queues a row in fulfilment_outbox in the same
    // transaction, and cron-fulfilment.php turns that row into an EMAIL to
    // the logistics company — on INSERT, before payment, deliberately. So an
    // unauthenticated POST that nobody rate-limits is an unauthenticated way
    // to send mail from orders@sporta.com.kw to a third party, as fast as a
    // script can loop. That buries the real orders in the warehouse's inbox
    // and gets the shop's own domain marked as a spam source, which then
    // costs every future customer their confirmation mail. The rows and the
    // disk they take are the smaller half of it.
    //
    // 20 in ten minutes: far above any real shopper (the attempt id means
    // retries reuse one order rather than creating another) and far below
    // useful for flooding. Applied on arrival by the table at the top of this
    // file, before the body is even parsed — a throttle that runs after
    // validation is not a throttle, because the flood is exactly the traffic
    // that fails validation.
    $b = store_body();

    $track = trim((string)($b['track_id'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9]{6,30}$/', $track)) store_fail('invalid_track_id');

    $method = strtolower(trim((string)($b['payment_method'] ?? 'knet')));
    if (!in_array($method, STORE_PAY_METHODS, true)) store_fail('invalid_payment_method');

    // Idempotency FIRST: a double tap or a bank-page retry returns the pending
    // order it already created instead of a second one. The storefront's
    // attemptTrackId() keeps the id stable per attempt; this is the other half.
    $q = $db->prepare('select id, amount, payment_status from orders where track_id = ?');
    $q->execute([$track]);
    if ($existing = $q->fetch()) {
        if ($existing['payment_status'] !== 'pending') store_fail('order_not_pending');
        store_out(['order_id' => (int)$existing['id'], 'track_id' => $track,
                   'amount' => (float)$existing['amount'], 'payment_method' => $method]);
    }

    $items = $b['items'] ?? null;
    if (!is_array($items) || count($items) === 0) store_fail('empty_cart');
    if (count($items) > 50) store_fail('cart_too_large');

    $customer = is_array($b['customer'] ?? null) ? $b['customer'] : [];
    $phone = store_phone($customer['phone'] ?? null);
    if ($phone === null) store_fail('invalid_phone');
    $gov = trim((string)($customer['governorate'] ?? ''));
    if (!in_array($gov, STORE_GOVERNORATES, true)) store_fail('invalid_governorate');

    // IS THIS CUSTOMER ALLOWED TO ORDER THIS WAY? Checked here — after the
    // phone is canonical, before anything is written or any mail is queued.
    //
    // Cash on delivery is the only method that spends the shop's money before
    // anyone has paid: the courier goes out either way. One phone placed twelve
    // COD orders in seconds before this existed. See store_order_guard().
    store_order_guard($db, $phone, $method);

    $name     = store_text($customer['name'] ?? null,     'name',     2, 80);
    $area     = store_text($customer['area'] ?? null,     'area',     2, 60);
    $block    = store_text($customer['block'] ?? null,    'block',    1, 12);
    $street   = store_text($customer['street'] ?? null,   'street',   1, 40);
    $building = store_text($customer['building'] ?? null, 'building', 1, 24);

    // Validate and price every line BEFORE the transaction opens, so a bad
    // cart rejects cleanly with the token naming the problem, not a
    // rolled-back mystery. Prices come from the table; the browser named only
    // slugs, sizes and quantities.
    $lines = store_price_lines($db, $items);

    // The discount, decided here and nowhere else. The browser may send a
    // CODE; it may never send an amount. orders.amount is what /knet/pay.php
    // charges, so anything able to move it is able to move what the bank
    // collects — this is the same rule that stops the browser naming a price,
    // and it matters more here because a discount is a number the customer
    // actively wants to be larger.
    $subtotalFils = array_sum(array_column($lines, 'line_fils'));
    if ($subtotalFils <= 0) store_fail('zero_amount');
    $disc = store_discounts_for($db, $lines, $subtotalFils, (string)($b['discount_code'] ?? ''));
    if ($disc['error'] !== null) store_fail($disc['error']);
    $discountFils = $disc['total_fils'];
    // Goods after the discount, BEFORE delivery. Checked on its own because a
    // 100%-off order would otherwise still look healthy — the delivery fee
    // alone would carry the total above zero and the bank would be handed an
    // order whose goods were free. The cap in store_discounts_for should make
    // this unreachable; it is asserted anyway, because "should be unreachable"
    // is where money goes missing.
    $goodsFils = $subtotalFils - $discountFils;
    if ($goodsFils <= 0) store_fail('zero_amount');
    // Delivery last, so no discount can eat into it. See STORE_DELIVERY_FEE_FILS.
    $deliveryFils = STORE_DELIVERY_FEE_FILS;
    $amountFils   = $goodsFils + $deliveryFils;

    $db->beginTransaction();
    try {
        $db->prepare(
            'insert into orders (track_id, payment_status, payment_method,
               customer_name, customer_phone, customer_governorate, customer_area,
               customer_block, customer_street, customer_building,
               customer_floor, customer_flat, customer_note, customer_lang,
               utm_source, utm_medium, utm_campaign, referrer_host)
             values (?, \'pending\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $track, $method, $name, $phone, $gov, $area, $block, $street, $building,
            store_opt($customer['floor'] ?? null),
            store_opt($customer['flat'] ?? null),
            store_opt($customer['note'] ?? null),
            // The language the checkout was RENDERED in, not a guess from the
            // phone number or the address. It decides which WhatsApp template
            // the customer gets, and it is the only chance to know: by the time
            // the message is sent the browser is long gone. Whitelisted to the
            // two the shop speaks — this is a column that selects a template
            // name, so it does not take arbitrary input.
            in_array($b['lang'] ?? '', ['ar', 'en'], true) ? $b['lang'] : null,
            // WHICH AD PAID FOR THIS ORDER. Read from the landing URL by the
            // browser and capped again here, because everything in a query
            // string is attacker-controlled: a link with a 4 kB utm_campaign
            // must become a truncated label, never a rejected order. It is a
            // report field and touches nothing about price or fulfilment, so
            // the worst a forged value can do is make one row's reporting wrong.
            store_utm($b['attribution'] ?? null, 'utm_source', 60),
            store_utm($b['attribution'] ?? null, 'utm_medium', 60),
            store_utm($b['attribution'] ?? null, 'utm_campaign', 80),
            store_utm($b['attribution'] ?? null, 'referrer_host', 120),
        ]);
        $orderId = (int)$db->lastInsertId();

        // Money in INTEGER FILS, not floats and not bcmath. KWD has exactly
        // three decimal places, so 10.000 KWD is 10000 fils and integer
        // arithmetic is exact; bcmath would also be exact but is a compiled-in
        // extension this must not depend on — shared hosting decides what PHP
        // has, not this file.
        $ins = $db->prepare(
            'insert into order_items (order_id, product_id, qty, unit_price, size, fit)
             values (?, ?, ?, ?, ?, ?)'
        );
        foreach ($lines as $l) {
            $ins->execute([$orderId, $l['product_id'], $l['qty'], $l['unit_price'], $l['size'], $l['fit']]);
        }

        // Claim the usage slots inside THIS transaction. The guarded update
        // means two simultaneous checkouts cannot both take the last use of a
        // one-per-shop code; if the claim does not land the whole order rolls
        // back, because honouring a discount that is gone is how a code meant
        // for one customer ends up used a thousand times.
        if (!store_discounts_claim($db, $disc['applied'])) store_fail('discount_used_up', 409);

        $amount = store_kwd($amountFils);
        // discount_label is a SNAPSHOT. Renaming or deleting a discount later
        // must not rewrite what an order says it was given.
        $label = implode(' + ', array_column($disc['applied'], 'label'));
        $code  = null;
        foreach ($disc['applied'] as $a) if ($a['code'] !== null) $code = $a['code'];
        $db->prepare(
            'update orders set amount = ?, subtotal = ?, discount_amount = ?,
                    delivery_fee = ?, discount_code = ?, discount_label = ? where id = ?'
        )->execute([
            $amount, store_kwd($subtotalFils), store_kwd($discountFils),
            store_kwd($deliveryFils),
            $code, $label === '' ? null : mb_substr($label, 0, 200), $orderId,
        ]);

        // The warehouse message, in the SAME transaction as the order — the
        // whole point of the outbox. If the order exists, its message exists.
        store_queue_fulfilment($db, $orderId, 'new');

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        // A duplicate track id racing itself lands here via the unique index;
        // re-read and answer idempotently rather than failing the second tap.
        $q->execute([$track]);
        if ($row = $q->fetch()) {
            store_out(['order_id' => (int)$row['id'], 'track_id' => $track,
                       'amount' => (float)$row['amount'], 'payment_method' => $method]);
        }
        store_fail('failed', 500);
    }

    store_out(['order_id' => $orderId, 'track_id' => $track,
               'amount' => (float)$amount, 'subtotal' => (float)store_kwd($subtotalFils),
               'discount' => (float)store_kwd($discountFils),
               'delivery' => (float)store_kwd($deliveryFils), 'payment_method' => $method]);
}

store_fail('not_found', 404);
