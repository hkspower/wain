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

// ---------------------------------------------------------------- products
if ($r === 'products') {
    $rows = $db->query(
        'select slug, name_en, name_ar, desc_en, desc_ar, price, sale_price,
                sale_starts_at, sale_ends_at, featured, featured_sort, category, image
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

    store_out([
        'subtotal' => (float)store_kwd($sub),
        'discount' => (float)store_kwd($res['total_fils']),
        'total'    => (float)store_kwd($sub - $res['total_fils']),
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
    store_throttle($db, 'assistant', 30, 60);
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
        'subtotal'        => (float)$o['subtotal'],
        'discount_amount' => (float)$o['discount_amount'],
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
    $amountFils   = $subtotalFils - $discountFils;
    // A 100%-off order would be handed to the bank as 0.000 and refused there,
    // with the customer already told the order exists. The cap in
    // store_discounts_for should make this unreachable; it is asserted anyway
    // because "should be unreachable" is where money goes missing.
    if ($amountFils <= 0) store_fail('zero_amount');

    $db->beginTransaction();
    try {
        $db->prepare(
            'insert into orders (track_id, payment_status, payment_method,
               customer_name, customer_phone, customer_governorate, customer_area,
               customer_block, customer_street, customer_building,
               customer_floor, customer_flat, customer_note)
             values (?, \'pending\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $track, $method, $name, $phone, $gov, $area, $block, $street, $building,
            store_opt($customer['floor'] ?? null),
            store_opt($customer['flat'] ?? null),
            store_opt($customer['note'] ?? null),
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
                    discount_code = ?, discount_label = ? where id = ?'
        )->execute([
            $amount, store_kwd($subtotalFils), store_kwd($discountFils),
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
               'discount' => (float)store_kwd($discountFils), 'payment_method' => $method]);
}

store_fail('not_found', 404);
