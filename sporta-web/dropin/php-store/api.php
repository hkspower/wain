<?php
// Sporta native store API — the endpoints the STOREFRONT calls.
// Place at public_html/api/. Routes:
//
//   GET  ?r=products            active catalogue (what loadProducts reads)
//   GET  ?r=slides              hero slides + slider settings + the promo bar
//   GET  ?r=slide_image&id=&v=  one slide photograph, cached for a year
//   GET  ?r=content             the owner's wording overrides + contact details
//   POST ?r=discount            check a coupon code against a cart
//   GET  ?r=stock               per-size availability (never the cost column)
//   POST ?r=order               create an order — the port of create_order
//   GET  ?r=status&id=TRACK     payment and fulfilment timeline for result/track pages
//   GET  ?r=invoice&id=TRACK    the printable invoice document
//
// No authentication on these, deliberately, and the same reasoning as the
// grants they replace: the catalogue and stock are shop-window data,
// and the ORDER NUMBER is the credential for status and invoice — ~64 bits
// from crypto.getRandomValues, exactly as get_order_status has worked since
// day one. What the invoice returns is scoped accordingly (no phone number).

declare(strict_types=1);
require __DIR__ . '/store.php';
require __DIR__ . '/customer-auth.php';

$r = $_GET['r'] ?? '';

// THE ASSISTANT IS NOT FOR OTHER SITES TO DRIVE (round three, finding 13). A POST to ?r=assistant runs a database query, can
// call the paid language model and, for a cancel, a person, a payment problem or a complaint, sends the shop an email through
// n8n - the same abuse class as the return and support routes, which refuse a cross-site request. This one did not, and a
// text/plain body is a CORS "simple request" that no preflight stops: `fetch(url, {method:'POST', mode:'no-cors', body})` on
// any page with traffic fired the request from every visitor's own IP, so no per-client limit ever met one source, the shop's
// inbox was buried, and the visitors lost their own quota. Refused here, BEFORE the database is opened and before the rate
// limiter counts it (a refused cross-site request must not spend the victim's budget): a browser that says the request is
// cross-site (Sec-Fetch-Site), or a body that is not JSON. The widget sends application/json from the shop's own origin, so it
// is unaffected. X-Sporta-Customer is NOT required - the compiled widget on the live site may not send it.
if ($r === 'assistant' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
    && (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site'
        || strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json')) {
    store_fail('bad_request', 403);
}

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
    // The storefront's theme and checkout settings: read on every page and
    // every checkout, a single small settings row each, the same tier as
    // slides. Listed so the table really is complete — unlisted, they were
    // throttled only by the fallback below.
    'theme'           => [120, 60],
    'checkout_config' => [120, 60],
    // The owner's wording and contact details (settings.site_content): one
    // small row, asked for once per page load by sporta-features.js, which
    // keeps a copy in the browser. Same tier as the theme.
    'content'         => [120, 60],
    'brand_logo'  => null,        // hashed URL, one-year immutable cache — the
                                  // browser asks once per logo, ever.
    'stock'       => [120, 60],
    'status'      => [60, 60],
    'invoice'     => [60, 60],
    'return_lookup' => [12, 60], // order + checkout phone are verified before details are returned
    'return_submit' => [8, 600], // creates an operator case; bound retries and abuse
    'support_create' => [6, 600], // creates a customer-service case
    'support_lookup' => [12, 60], // reference + email are required before messages are returned
    'support_reply'  => [8, 600], // a customer response to an existing case
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
        // THE BRAND IS JOINED IN, rather than fetched separately.
        //
        // The product page used to make a second call to ?r=brands for a slug,
        // two names and a hash — one more round trip on a page whose request
        // budget has two to spare, for about sixty bytes. Joined here it costs
        // ~3 kB across the whole catalogue and no extra request anywhere.
        //
        // The LOGO itself is still not here and must not be: it is a data: URI
        // up to 160 kB, /api is no-store, and products that share a brand would
        // each carry their own copy of it. `brand_logo_v` is the content hash,
        // which is all the browser needs to build the cacheable ?r=brand_logo
        // URL for the one brand it is actually showing.
        'select p.slug, p.name_en, p.name_ar, p.desc_en, p.desc_ar, p.price, p.sale_price,
                p.sale_starts_at, p.sale_ends_at, p.featured, p.featured_sort, p.category,
                p.image, p.no_exchange, p.brand_slug, p.images,
                b.name_en as brand_name_en, b.name_ar as brand_name_ar,
                case when b.logo is null or b.logo = \'\' then 0 else 1 end as brand_has_logo,
                substr(sha2(coalesce(b.logo, \'\'), 256), 1, 12) as brand_logo_v
           from products p
           -- LEFT, and on the slug: deleting a brand must never hide a product,
           -- and an unmatched slug simply shows no brand.
           left join brands b on b.slug = p.brand_slug and b.active = 1
          where p.active = 1 order by p.name_en'
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

    $bar = store_topbar_setting($db);
    // The schedule is resolved here for the same reason the sale window is.
    $bar['live'] = (bool)$bar['enabled'] && store_window_open($bar['starts_at'] ?? null, $bar['ends_at'] ?? null);
    unset($bar['starts_at'], $bar['ends_at']);

    store_out(['slides' => $rows, 'hero' => store_setting($db, 'hero'), 'promo_bar' => $bar]);
}

if ($r === 'theme') {
    store_out(store_theme_with_fonts($db));
}

// The words the owner has changed, and the shop's contact details. Public on
// purpose: it is, by definition, text the storefront shows every visitor.
// Plain strings only; the script that applies them writes text nodes, and
// store_out() hex-escapes markup characters, so nothing here can become HTML.
if ($r === 'content') {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') store_fail('bad_request', 405);
    store_out(store_site_content($db));
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

// ------------------------------------------------------------- brand logo
//
// The same treatment a hero slide's photograph gets, for the same reason. A
// logo is stored as a data: URI in the brands row (never a file — an upload
// endpoint would write into the web root), and /api is `no-store`, so inlining
// it into the products JSON would re-download every logo on every page.
//
// Served as bytes behind a URL carrying the content hash, cached for a year and
// immutable. Change the logo and the hash changes, so the new one appears
// without anybody clearing a cache.
if ($r === 'brand_logo') {
    $q = $db->prepare('select logo from brands where slug = ? and active = 1');
    $q->execute([trim((string)($_GET['slug'] ?? ''))]);
    $data = (string)($q->fetchColumn() ?: '');
    if ($data === '' || !preg_match('#^data:image/(png|jpeg|webp);base64,(.+)$#s', $data, $m)) {
        http_response_code(404);
        exit;
    }
    $bytes = base64_decode($m[2], true);
    if ($bytes === false) { http_response_code(404); exit; }

    header('Content-Type: image/' . $m[1]);
    header('Content-Length: ' . strlen($bytes));
    header('Cache-Control: public, max-age=31536000, immutable');
    header('X-Content-Type-Options: nosniff');
    header_remove('Pragma');
    echo $bytes;
    exit;
}

// -------------------------------------------------------------- discount check
if ($r === 'checkout_config') {
    $c = store_public_checkout_setting($db);
    store_out([
        'delivery_fee' => (float)store_kwd($c['delivery_fee_fils']),
        'methods' => $c['methods'],
        'default_method' => $c['default_method'],
        'notice_en' => $c['notice_en'],
        'notice_ar' => $c['notice_ar'],
    ]);
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
    $b = store_body(32768);
    $code = store_input_string($b['code'] ?? null, 'discount_code', 80);
    // A TYPED code is counted FIRST, before it is looked at, and a client that
    // has used up its wrong guesses is refused whatever it sends now, RIGHT
    // codes included. Otherwise the 429 is itself the answer — wrong codes get
    // 429, right codes get 200 — and the limiter becomes the oracle it was
    // meant to close. A code that works gives its hit back below, so only
    // failures stay counted. See store_discount_attempt().
    //
    // NO CODE, NO COUNT. The checkout asks this route for its price quote with
    // an empty code, and the live storefront will not place ANY order until
    // that quote answers — so gating it would turn somebody else's guessing on
    // a shared carrier address into "checkout is temporarily unavailable" for
    // every shopper behind it. An empty code asks nothing about codes.
    $attempt = trim($code) !== '' ? store_discount_attempt($db) : null;
    $items = is_array($b['items'] ?? null) ? $b['items'] : [];
    if (count($items) === 0 || count($items) > 50) store_fail('empty_cart');
    if (!array_is_list($items)) store_fail('invalid_item');

    $priced = store_price_lines($db, $items);
    $sub = array_sum(array_column($priced, 'line_fils'));
    $res = store_discounts_for($db, $priced, $sub, $code);
    // Only a FAILED lookup stays counted. A shopper re-checking a basket with
    // a code that works is not guessing; a script walking SAVE10, SAVE15,
    // SAVE20 is, and thirty wrong answers in ten minutes is far past anyone
    // typing by hand.
    if ($res['error'] !== null) store_fail($res['error']);
    if ($attempt !== null) store_discount_succeeded($db, $attempt);

    // DELIVERY IS PART OF THE QUOTE, or the quote is not what the customer
    // pays. This endpoint exists so the checkout can show a number computed by
    // the same code that will charge it; leaving the fee out here would put a
    // total on screen that is 1.000 KWD lower than the one the bank asks for,
    // which is the exact drift the shared-code rule was written to prevent.
    $previewDelivery = store_checkout_setting($db)['delivery_fee_fils'];
    store_out([
        'subtotal' => (float)store_kwd($sub),
        'discount' => (float)store_kwd($res['total_fils']),
        'delivery' => (float)store_kwd($previewDelivery),
        'total'    => (float)store_kwd($sub - $res['total_fils'] + $previewDelivery),
        'total_fils' => $sub - $res['total_fils'] + $previewDelivery,
        'applied'  => array_map(fn ($a) => ['label' => $a['label'], 'code' => $a['code'],
                                            'amount' => (float)store_kwd($a['fils'])], $res['applied']),
    ]);
}

// ------------------------------------------------------------------ brands
// The brands the storefront may show. ACTIVE ONLY — "disabled" has to mean
// invisible to a shopper or the switch means nothing. The logo itself is
// served by ?r=brand_logo (see below), never inlined here.
//
// `products` is how many LISTED products carry the brand. It exists because a
// brand with nothing behind it is a dead end: the home strip linked every
// brand to /shop?brand=<slug>, and with one product tagged out of 46, six of
// seven tiles opened "No matching products". The storefront cannot know that
// without downloading the whole catalogue first, so the count travels with
// the brand and the strip can treat an empty brand differently (or not at
// all). Only ACTIVE products count, for the same reason only active brands
// are listed: a hidden product is not something a shopper can be sent to.
if ($r === 'brands') {
    $rows = $db->query(
        // `logo` is deliberately NOT selected. It is a data: URI up to 160 kB
        // and eight of them would be a megabyte of base64 on a no-store
        // endpoint that a product page now calls. `has_logo` says whether to
        // ask for the bytes; ?r=brand_logo serves them, cached for a year.
        // `logo_v` is the content hash that makes that cache safe.
        //
        // The count is ONE grouped pass over products (idx_products_brand),
        // not a count(*) per brand, which would be a query per row on an
        // endpoint the home page calls on every visit.
        //
        // A BRAND WITH NO LISTED PRODUCT IS LEFT OUT (owner's choice,
        // 2026-11-02: "hide it until tagged"). The home strip and the brand
        // pages read this list, and a tile that opens "No matching products"
        // is a dead end in the shop's front window. The admin's own r=brands
        // still lists every brand with both counts, so tagging a product is
        // what brings a brand onto the storefront — nothing else to switch.
        // Hidden products do not count: a hidden product is nowhere to send a
        // shopper. The inner join is the filter; `products` is therefore ≥ 1.
        'select b.slug, b.name_en, b.name_ar,
                b.logo is not null and b.logo <> \'\' as has_logo,
                substr(sha2(coalesce(b.logo, \'\'), 256), 1, 12) as logo_v,
                c.n as products
           from brands b
           join (select brand_slug, count(*) as n
                   from products
                  where active = 1 and brand_slug is not null
                  group by brand_slug) c on c.brand_slug = b.slug
          where b.active = 1
          order by b.sort, b.name_en'
    )->fetchAll();
    // An integer, always: a JSON "3" next to a 3 is how a `=== 0` check in a
    // storefront add-on quietly never fires.
    foreach ($rows as &$row) $row['products'] = (int)$row['products'];
    unset($row);
    store_out($rows);
}

// ------------------------------------------------------------------- stock
if ($r === 'stock') {
    // Same columns as the product_stock view — and NOT cost_aed, which is the
    // one commercially sensitive number in the schema.
    //
    // Only variants of products the shop LISTS. A product the owner switched
    // off (active = 0), or whose row is gone while its variants remain (there
    // is no foreign key from variants to products), used to be served here all
    // the same — SKU, sizes and counts of lines not on sale, to anyone who
    // asked. The storefront can never show such a product, so no visitor loses
    // anything; the admin's inventory reads its own route (admin.php?r=variants).
    // Found by scripts/json-scan.mjs: five live stock rows with no catalogue entry.
    $rows = $db->query(
        'select v.slug, v.size, v.sku, v.stock, (v.stock > 0) as in_stock
           from product_variants v
           join products p on p.slug = v.slug and p.active = 1'
    )->fetchAll();
    foreach ($rows as &$row) {
        $row['stock'] = (int)$row['stock'];
        $row['in_stock'] = (bool)$row['in_stock'];
    }
    store_out($rows);
}

// ------------------------------------------------------------------- status
if ($r === 'status') {
    $q = $db->prepare('select id, payment_status, payment_method, fulfilment_status, amount,
                              created_at, fulfilled_at from orders where track_id = ?');
    $q->execute([trim((string)($_GET['id'] ?? ''))]);
    $row = $q->fetch();
    if (!$row) store_out(null);
    $row['amount'] = (float)$row['amount'];
    $row['events'] = store_tracking_events($db, $row);
    unset($row['id'], $row['created_at'], $row['fulfilled_at']);
    store_out($row);
}

// -------------------------------------------------------- returns/exchanges
// A track ID alone cannot reveal purchased items or create an operator case.
// Both routes verify the phone captured at checkout and return the same 404
// for an unknown order and a mismatched number.
if (in_array($r, ['return_lookup', 'return_submit'], true)) {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') store_fail('method_not_allowed', 405);
    if (($_SERVER['HTTP_X_SPORTA_CUSTOMER'] ?? '') !== '1'
        || strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json'
        || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') store_fail('bad_request', 403);
    require_once __DIR__ . '/returns.php';
    $body = returns_request_body();
    if ($r === 'return_lookup') {
        $result = returns_lookup($db, $body);
        if ($result === null) store_fail('order_not_found', 404);
        store_out($result);
    }
    try { store_out(returns_submit($db, $body), 201); }
    catch (InvalidArgumentException $e) {
        $token = $e->getMessage();
        store_fail($token, $token === 'order_not_found' ? 404 :
            ($token === 'quantity_exceeded' || $token === 'duplicate_request' ? 409 : 400));
    }
}

// --------------------------------------------------------- customer support
// A support reference is not enough to read a conversation: lookup and reply
// require the email recorded on the ticket as well. Staff-only notes never
// travel through these public routes.
if (in_array($r, ['support_create', 'support_lookup', 'support_reply'], true)) {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST'
        || ($_SERVER['HTTP_X_SPORTA_CUSTOMER'] ?? '') !== '1'
        || strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json'
        || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') store_fail('bad_request', 403);
    require_once __DIR__ . '/support.php';
    $body = support_body();
    try {
        if ($r === 'support_create') store_out(['ticket' => support_create($db, $body)], 201);
        if ($r === 'support_lookup') { $ticket = support_ticket_public($db, $body); if ($ticket === null) store_fail('not_found', 404); store_out($ticket); }
        store_out(support_customer_reply($db, $body));
    } catch (InvalidArgumentException $e) {
        $token = $e->getMessage(); store_fail($token, $token === 'not_found' ? 404 : ($token === 'ticket_closed' ? 409 : 400));
    }
}

// -------------------------------------------------------------- سبورتا AI
//
// POST, because a question is not a resource to be fetched and must never end
// up in a proxy cache or a browser history. Throttled per IP: it is an
// unauthenticated endpoint that runs database queries, so the same guard the
// discount oracle has applies here.
if ($r === 'assistant' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $in = store_body(8192);
    // Capped hard. Anything longer than this is not a customer question, and
    // an unbounded string reaching a paid model is somebody else's bill.
    $msg = trim(store_input_string($in['message'] ?? null, 'message', 2048));
    if (mb_strlen($msg) > 500) store_fail('too_long_message');
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
    $audio = assistant_speak($cfg, $text, $lang);
    if ($audio === null) store_out(['error' => 'tts_failed'], 502);
    // The content type FOLLOWS THE FORMAT. It was hard-coded audio/mpeg, so
    // configuring lossless produced a WAV announced as an mp3 — which Safari
    // refuses outright and Chrome only plays by sniffing past the label.
    header('Content-Type: ' . assistant_voice_kind($cfg)['mime']);
    header('Content-Length: ' . strlen($audio));
    // Signed, immutable, and identical for every visitor who asks the same
    // question — exactly the thing a cache is for. Private: it may quote an
    // order number back, and that is not for a shared proxy to keep.
    header('Cache-Control: private, max-age=31536000, immutable');
    echo $audio;
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
    $in = store_body(8192);
    $order = store_review_order(
        $db,
        trim((string)($in['track_id'] ?? '')),
        trim((string)($in['token'] ?? '')),
    );
    if (!$order) store_fail('invalid_review_link', 404);

    // ANY rating is accepted and any rating is paid. Rewarding only the good
    // ones is review gating — see reviews.mysql.sql. What is refused here is a
    // number that is not a rating at all, because it would be averaged in.
    $rating = $in['rating'] ?? null;
    if (!is_int($rating) || $rating < 1 || $rating > 5) store_fail('invalid_rating');

    $comment = trim(store_input_string($in['comment'] ?? null, 'comment', 4096));
    // Cut to the column, in CHARACTERS not bytes: an Arabic comment is two to
    // three bytes a letter, and slicing on bytes would both truncate it early
    // and cut a character in half.
    if (mb_strlen($comment) > 1000) store_fail('too_long_comment');
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
        // COALESCE, not a plain join. The snapshot is what the customer was
        // sold; the join is the fallback for every order placed before the
        // snapshot existed, whose lines are NULL. Back-filling those from the
        // catalogue would write today's names into history and present them as
        // the originals, which is a worse lie than an old name being current.
        'select coalesce(oi.name_en, p.name_en) as name_en,
                coalesce(oi.name_ar, p.name_ar) as name_ar,
                oi.qty, oi.size, oi.fit, oi.unit_price,
                (oi.unit_price * oi.qty) as line_total
           from order_items oi join products p on p.id = oi.product_id
          where oi.order_id = ? order by 1, oi.size'
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
    if (strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])) !== 'application/json'
        || ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') store_fail('bad_request', 403);
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
    $b = store_body(65536);

    if (!is_string($b['track_id'] ?? null)) store_fail('invalid_track_id');
    $track = trim($b['track_id']);
    if (!preg_match('/^[A-Za-z0-9]{6,30}$/', $track)) store_fail('invalid_track_id');

    // A quote is an assertion about what the shopper saw, never a price source.
    // Older clients omit it; new clients can refuse a changed total before an
    // order reserves stock or sends the shopper to a bank.
    $expectedTotalFils = $b['expected_total_fils'] ?? null;
    if (array_key_exists('expected_total_fils', $b)
        && (!is_int($expectedTotalFils) || $expectedTotalFils < 0)) {
        store_fail('invalid_expected_total');
    }
    $assertQuote = static function (int $actualFils) use ($expectedTotalFils): void {
        if ($expectedTotalFils !== null && $expectedTotalFils !== $actualFils) {
            store_out(['error' => 'quote_changed', 'amount' => (float)store_kwd($actualFils),
                       'total_fils' => $actualFils], 409);
        }
    };

    $method = strtolower(trim(store_input_string($b['payment_method'] ?? 'knet', 'payment_method', 20)));
    if (!in_array($method, STORE_PAY_METHODS, true)) store_fail('invalid_payment_method');
    // New orders only for the methods a customer can choose. A stored T-Pay order is still read below (retries, callbacks).
    if (!in_array($method, STORE_CUSTOMER_PAY_METHODS, true)) store_fail('payment_method_unavailable');
    $checkoutSetting = store_public_checkout_setting($db);
    if (!in_array($method, $checkoutSetting['methods'], true)) store_fail('payment_method_unavailable');

    // Idempotency FIRST: a double tap or a bank-page retry returns the pending
    // order it already created instead of a second one. The storefront's
    // attemptTrackId() keeps the id stable per attempt; this is the other half.
    // The method is part of the idempotency key's meaning. A caller must not
    // be able to create a KNET order, repeat the same track id as T-Pay/COD,
    // and have the browser redirect that one order to a different settlement
    // path. Return only the method persisted with the order, and reject a
    // retry whose requested method disagrees with it.
    $q = $db->prepare(
        'select id, amount, payment_status, payment_method from orders where track_id = ?'
    );
    $returnExisting = static function (array $row, string $track, string $requestedMethod) use ($assertQuote): void {
        if ($row['payment_status'] !== 'pending') store_fail('order_not_pending');

        $storedMethod = strtolower(trim((string)($row['payment_method'] ?? '')));
        if (!in_array($storedMethod, STORE_PAY_METHODS, true)
            || $storedMethod !== $requestedMethod) {
            // Reuse an existing client token so current storefronts show a
            // translated checkout error instead of leaking a new raw token.
            store_fail('invalid_payment_method', 409);
        }

        $assertQuote(store_fils((string)$row['amount']));

        store_out([
            'order_id'      => (int)$row['id'],
            'track_id'      => $track,
            'amount'        => (float)$row['amount'],
            'payment_method' => $storedMethod,
        ]);
    };
    $q->execute([$track]);
    if ($existing = $q->fetch()) {
        $returnExisting($existing, $track, $method);
    }

    $items = $b['items'] ?? null;
    if (!is_array($items) || count($items) === 0) store_fail('empty_cart');
    if (count($items) > 50) store_fail('cart_too_large');
    if (!array_is_list($items)) store_fail('invalid_item');

    $customer = $b['customer'] ?? null;
    if (!is_array($customer) || array_is_list($customer)) store_fail('invalid_customer');
    $phone = store_phone($customer['phone'] ?? null);
    if ($phone === null) store_fail('invalid_phone');
    $gov = trim(store_input_string($customer['governorate'] ?? null, 'governorate', 64));
    if (!in_array($gov, STORE_GOVERNORATES, true)) store_fail('invalid_governorate');

    $name     = store_text($customer['name'] ?? null,     'name',     2, 80);
    $area     = store_text($customer['area'] ?? null,     'area',     2, 60);
    $block    = store_text($customer['block'] ?? null,    'block',    1, 12);
    $street   = store_text($customer['street'] ?? null,   'street',   1, 40);
    $building = store_text($customer['building'] ?? null, 'building', 1, 24);
    $floor    = store_checkout_optional($customer['floor'] ?? null, 'floor', 16);
    $flat     = store_checkout_optional($customer['flat'] ?? null, 'flat', 16);
    $note     = store_checkout_optional($customer['note'] ?? null, 'note', 280);

    // ONE ORDER A MINUTE, per client and per phone: see
    // store_order_cooldown_left() in store.php for what it covers and what it
    // deliberately does not (a retry of this same attempt; a declined card).
    // After every field is validated, so a typo is reported as a typo; before
    // pricing, so a refused order costs no stock or discount reads.
    $cooldown   = store_order_cooldown_seconds();
    $cooldownId = store_client_identity();
    if ($cooldown > 0) {
        if (!store_order_cooldown_lock($db, $cooldownId)) {
            store_rate_limit_fail($cooldown, 'previous_order_pending');
        }
        // Under the lock, ask the idempotency question again: a second tap of
        // THIS attempt that waited here while the first one committed must get
        // that order back, not a cooldown.
        $q->execute([$track]);
        if ($existing = $q->fetch()) $returnExisting($existing, $track, $method);
        if ($left = store_order_cooldown_left($db, $cooldownId, $phone, $cooldown)) {
            store_rate_limit_fail($left, 'previous_order_pending');
        }
    }

    // Ownership is derived only from a verified HttpOnly customer session.
    // The checkout body has no customer ID; old clients and guests remain
    // guests. A browser from another origin cannot set this custom header
    // with cookies because this API offers no CORS preflight permission.
    $customerAccountId = null;
    $contentType = strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
    if (($_SERVER['HTTP_X_SPORTA_CUSTOMER'] ?? '') === '1'
        && $contentType === 'application/json'
        && ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') !== 'cross-site') {
        $sessionUser = customer_current_user($db);
        $customerAccountId = $sessionUser === null ? null : (int)$sessionUser['id'];
        if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    }

    // Validate and price every line BEFORE the transaction opens, so a bad
    // cart rejects cleanly with the token naming the problem, not a
    // rolled-back mystery. Prices come from the table; the browser named only
    // slugs, sizes and quantities.
    $lines = store_price_lines($db, $items);
    // AND HOW MUCH OF THE SHOP ONE ORDER MAY HOLD — every payment method, see
    // store_order_size_guard(). Before the transaction, so an oversized cart
    // is refused before a single garment is claimed.
    store_order_size_guard($lines);

    // The discount, decided here and nowhere else. The browser may send a
    // CODE; it may never send an amount. orders.amount is what /knet/pay.php
    // charges, so anything able to move it is able to move what the bank
    // collects — this is the same rule that stops the browser naming a price,
    // and it matters more here because a discount is a number the customer
    // actively wants to be larger.
    $subtotalFils = array_sum(array_column($lines, 'line_fils'));
    if ($subtotalFils <= 0) store_fail('zero_amount');
    $discountCode = store_input_string($b['discount_code'] ?? null, 'discount_code', 80);
    // The order takes a code too, so it is a second way to ask "is this code
    // real?" — and it shares ?r=discount's ONE failure budget, or a script
    // could alternate between the two routes for twice the guesses. Counted
    // first, and only when a code was actually typed: an order without one is
    // not a guess, and must never be refused because of somebody else's
    // guessing. A code that works gives its hit back.
    $discountAttempt = trim($discountCode) !== '' ? store_discount_attempt($db) : null;
    $disc = store_discounts_for($db, $lines, $subtotalFils, $discountCode);
    if ($disc['error'] !== null) store_fail($disc['error']);
    if ($discountAttempt !== null) store_discount_succeeded($db, $discountAttempt);
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
    $deliveryFils = $checkoutSetting['delivery_fee_fils'];
    $amountFils   = $goodsFils + $deliveryFils;
    $assertQuote($amountFils);

    $codLock = null;
    $rejectOrder = static function (string $token, int $status) use ($db, &$codLock): void {
        if ($db->inTransaction()) $db->rollBack();
        if ($codLock !== null) { store_cod_unlock($db, $codLock); $codLock = null; }
        store_fail($token, $status);
    };
    try {
        // Hold this phone's COD lock through commit. Concurrent submissions
        // must see the order inserted by the previous holder before checking
        // the cap. The transaction begins AFTER the lock to avoid a stale
        // repeatable-read snapshot taken while waiting.
        if ($method === 'cod') $codLock = store_cod_lock($db, $phone);
        $db->beginTransaction();
        $q->execute([$track]);
        if ($existing = $q->fetch()) {
            $db->rollBack();
            if ($codLock !== null) { store_cod_unlock($db, $codLock); $codLock = null; }
            $returnExisting($existing, $track, $method);
        }
        if ($refusal = store_order_guard($db, $phone, $method)) {
            $rejectOrder($refusal[0], $refusal[1]);
        }
        // The phone again, inside the transaction: two devices on two
        // addresses are two different client locks. (A COD order holds the
        // phone's lock here too, so for cash this read is exact.)
        if ($cooldown > 0 && ($left = store_order_cooldown_left($db, $cooldownId, $phone, $cooldown))) {
            $db->rollBack();
            if ($codLock !== null) { store_cod_unlock($db, $codLock); $codLock = null; }
            store_rate_limit_fail($left, 'previous_order_pending');
        }
        $db->prepare(
            'insert into orders (track_id, customer_account_id, payment_status, payment_method,
               customer_name, customer_phone, customer_governorate, customer_area,
               customer_block, customer_street, customer_building,
               customer_floor, customer_flat, customer_note, customer_lang,
               utm_source, utm_medium, utm_campaign, referrer_host)
             values (?, ?, \'pending\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $track, $customerAccountId, $method, $name, $phone, $gov, $area, $block, $street, $building,
            $floor, $flat, $note,
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
            'insert into order_items (order_id, product_id, name_en, name_ar, qty, unit_price, size, fit)
             values (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($lines as $l) {
            $ins->execute([$orderId, $l['product_id'], $l['name_en'], $l['name_ar'],
                           $l['qty'], $l['unit_price'], $l['size'], $l['fit']]);
        }

        // Claim the usage slots inside THIS transaction. The guarded update
        // means two simultaneous checkouts cannot both take the last use of a
        // one-per-shop code; if the claim does not land the whole order rolls
        // back, because honouring a discount that is gone is how a code meant
        // for one customer ends up used a thousand times.
        if (!store_discounts_claim($db, $disc['applied'])) {
            $rejectOrder('discount_used_up', 409);
        }

        // AND CLAIM THE GARMENTS THEMSELVES, in the same transaction and for
        // exactly the same reason. Until this existed the shop would sell a
        // size it had none of — measured: stock 0, an order for fifty,
        // answered 200 — because the stock number was only ever consulted by
        // the browser drawing the size ladder.
        //
        // AFTER order_items, because the release path reads the sizes back out
        // of it, and BEFORE the commit, so a failure anywhere below puts every
        // garment back by rolling back rather than by remembering to.
        $claim = store_stock_claim($db, $lines);
        if ($short = $claim['short']) {
            // ROLLED BACK EXPLICITLY. store_fail() exits, and an exit inside an
            // open transaction is rolled back only when the connection closes —
            // true today, and far too quiet a thing to rest a stock ledger on.
            // The earlier lines of a mixed cart have already been decremented
            // by the time a later one comes up short, so leaking this
            // transaction would take garments off the shelf for an order that
            // was never placed.
            // The token names the item, the size AND what is left, because
            // "out of stock" on a page showing eight things is not something
            // a shopper can act on. 409, not 400: nothing they typed is wrong.
            $rejectOrder(sprintf('out_of_stock_%s_%s_%d', $short['slug'], $short['size'], $short['have']), 409);
        }
        // FLAGGED ONLY IF IT ACTUALLY TOOK SOMETHING — counted by the claim
        // itself, not guessed from the cart. A bag of accessories has no
        // variant rows to decrement, and a cart may even carry a size for an
        // untracked product, so "the order named a size" is not the same
        // question. Marking such an order claimed would be a lie the sweeper
        // later acts on: it would pick the row up, stamp it released, and the
        // two flags would stop describing what happened.
        if ($claim['claimed'] > 0) {
            $db->prepare('update orders set stock_claimed = 1 where id = ?')->execute([$orderId]);
        }
        // AND HOW MUCH UNPAID STOCK THIS CLIENT NOW HOLDS — see
        // store_order_units_take(). In this transaction, so the refusal below
        // rolls the claim, the pieces and the order back together.
        $units = store_order_units_take($db, $cooldownId, (int)$claim['units']);
        if (!$units['allowed']) {
            $db->rollBack();
            if ($codLock !== null) { store_cod_unlock($db, $codLock); $codLock = null; }
            store_rate_limit_fail($units['retry_after'], 'previous_order_pending');
        }

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
        // WHICH RULES THIS ORDER USED, so an order that never happens can give
        // the uses back (store_discount_release). Every applied rule, the
        // automatic ones too: store_discounts_claim() counted a use against
        // each. Skipped, not failed, on a database that has not had
        // discount-release.mysql.sql imported yet.
        if ($disc['applied'] && store_column_exists($db, 'orders', 'discount_ids')) {
            $db->prepare('update orders set discount_ids = ? where id = ?')->execute([
                json_encode(array_values(array_map('intval', array_column($disc['applied'], 'id')))),
                $orderId,
            ]);
        }

        // The cooldown starts with the order, in its transaction: a rolled
        // back order starts none.
        store_order_cooldown_start($db, $cooldownId, $orderId, $cooldown);

        // The warehouse message, in the SAME transaction as the order — the
        // whole point of the outbox. If the order exists, its message exists.
        store_queue_fulfilment($db, $orderId, 'new');

        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        if ($codLock !== null) { store_cod_unlock($db, $codLock); $codLock = null; }
        // A duplicate track id racing itself lands here via the unique index;
        // re-read and answer idempotently rather than failing the second tap.
        // Apply the exact same status and method checks as the fast path: the
        // race must not become a bypass for the gateway-binding rule above.
        $q->execute([$track]);
        if ($row = $q->fetch()) {
            $returnExisting($row, $track, $method);
        }
        store_fail('failed', 500);
    } finally {
        if ($codLock !== null) store_cod_unlock($db, $codLock);
    }

    store_out(['order_id' => $orderId, 'track_id' => $track,
               'amount' => (float)$amount, 'subtotal' => (float)store_kwd($subtotalFils),
               'discount' => (float)store_kwd($discountFils),
               'delivery' => (float)store_kwd($deliveryFils), 'payment_method' => $method]);
}

store_fail('not_found', 404);
