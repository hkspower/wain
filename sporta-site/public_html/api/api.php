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
    'brand_logo'  => null,        // hashed URL, one-year immutable cache — the
                                  // browser asks once per logo, ever.
    'stock'       => [120, 60],
    'status'      => [60, 60],
    'invoice'     => [60, 60],
    'assistant'   => [30, 60],
    // The size adviser WRITES a log row per answer, so it is bounded like the
    // other writing routes rather than like a read. A real shopper answers a
    // handful of questions once, changes their mind twice, and is done.
    'size_advice' => [30, 300],
    'size_chart'  => [120, 60],
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
    'product_image' => null,      // same, and more so: the shop grid opens with
                                  // a photograph per card and a product page
                                  // asks for the whole shoot at once. A limit
                                  // here would throttle a first-time visitor
                                  // scrolling the catalogue — the one visitor
                                  // who must never see a broken image.
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

    // ------------------------------------------------- uploaded photographs
    //
    // ONE query for the whole catalogue, not one per product: 46 products is
    // 46 round trips to MySQL to build a list the storefront reads in a single
    // pass, and this endpoint is `no-store`, so it is paid on every visit.
    //
    // THE BYTES ARE NOT HERE, for the same reason the brand logo and the hero
    // photograph are not: a product page's shoot is megabytes, and inlining it
    // into a JSON document that must never be cached would re-download every
    // photograph in the shop on every navigation. Each row contributes a URL
    // into ?r=product_image carrying the content hash, which the browser then
    // caches for a year.
    //
    // Only the hash's first 12 characters travel, which is what the slide and
    // brand endpoints already send: it is a cache key, not a checksum, and a
    // full sha256 per photograph is 52 wasted bytes each on a document that is
    // fetched cold every time.
    $shots = [];
    foreach ($db->query(
        'select slug, id, image_hash from product_images order by slug, sort, id'
    )->fetchAll() as $s) {
        $shots[$s['slug']][] = 'api.php?r=product_image&id=' . (int)$s['id']
                             . '&v=' . substr((string)$s['image_hash'], 0, 12);
    }

    foreach ($rows as &$row) {
        $mine = $shots[$row['slug']] ?? [];
        if (!$mine) continue;
        // `image` is a path the owner typed, pointing at a file they put on
        // the server by hand. Where one exists it is an explicit choice and
        // stays the main photograph; the uploads extend the gallery behind it.
        // Where it does not — which is every product in this catalogue today —
        // the first upload BECOMES the main image, because ProductCard renders
        // `product.image` directly and an empty string there is the grey box
        // this feature exists to remove.
        $extra = trim((string)($row['images'] ?? ''));
        if (trim((string)($row['image'] ?? '')) === '') {
            $row['image'] = array_shift($mine);
        }
        // Kept as the comma-separated string the column already speaks, so
        // productImages() needs no new case: it splits a string, dedupes, and
        // has done since before uploads existed.
        $row['images'] = implode(',', array_filter(array_merge(
            $extra === '' ? [] : array_map('trim', explode(',', $extra)),
            $mine,
        )));
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
    // ACTIVE IS READ HERE TOO, not just in ?r=slides. The list endpoint has
    // filtered on it since the day it was written; this one selected by id
    // alone, and the ids are a small auto-increment — so a slide switched off,
    // or built ahead of the day it goes live, was one guessed integer away
    // from anybody. That is exactly where an unannounced sale sits the week
    // before it starts. `?r=brand_logo` has carried `and active = 1` all
    // along and has a test for it; this is the same rule, missing.
    $q = $db->prepare('select image, active from hero_slides where id = ?');
    $q->execute([(int)($_GET['id'] ?? 0)]);
    $row = $q->fetch();
    $data = (string)($row['image'] ?? '');
    if ($data === '' || !preg_match('#^data:image/(png|jpeg|webp);base64,(.+)$#s', $data, $m)) {
        http_response_code(404);
        exit;
    }

    // The admin lists EVERY slide, live or not, and points its thumbnails at
    // this same URL rather than shipping a megabyte of base64 per row. So a
    // flat 404 on inactive would blank the screen the owner uses to decide
    // whether to publish. A signed-in admin sees it; nobody else does.
    //
    // The session is only consulted when the row is inactive, so the public
    // path — every hero image on every cold visit — still starts no session
    // and touches no cookie.
    $live = (bool)($row['active'] ?? 0);
    if (!$live && store_session_admin() === null) {
        http_response_code(404);
        exit;
    }

    $bytes = base64_decode($m[2], true);
    if ($bytes === false) { http_response_code(404); exit; }

    header('Content-Type: image/' . $m[1]);
    header('Content-Length: ' . strlen($bytes));
    // A year, immutable — safe ONLY because the URL carries the content hash.
    //
    // NOT for the admin's view of an unpublished slide: that response exists
    // because of who asked, and `public` would invite any shared cache between
    // here and the office to keep a copy and hand it to the next person who
    // asks for the same URL — reopening by cache exactly what the check above
    // just closed.
    header($live
        ? 'Cache-Control: public, max-age=31536000, immutable'
        : 'Cache-Control: private, no-store');
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

// -------------------------------------------------------- product photograph
//
// The third copy of the same idea, and the last: bytes from a row, behind a
// URL carrying the content hash, cached for a year. See ?r=slide_image for why
// the database holds them at all.
//
// The ACTIVE JOIN is the part worth reading. ?r=products only ever lists
// active garments, so without this a product taken off sale — discontinued,
// mispriced, not launched yet — kept serving its whole shoot to anyone
// walking the id sequence. That is the hole ?r=slide_image had, found and
// closed a few hours before this endpoint was written; it is not being
// reintroduced one route further down the same file.
if ($r === 'product_image') {
    $q = $db->prepare(
        'select i.image, p.active
           from product_images i
           -- INNER, on the slug: a photograph whose product was deleted has
           -- nothing to belong to and is not served. There is no foreign key
           -- (deleting a product must not fail because a picture points at
           -- it), so this join is what enforces it on the way out.
           join products p on p.slug = i.slug
          where i.id = ?'
    );
    $q->execute([(int)($_GET['id'] ?? 0)]);
    $row = $q->fetch();
    $data = (string)($row['image'] ?? '');
    if ($data === '' || !preg_match('#^data:image/(png|jpeg|webp);base64,(.+)$#s', $data, $m)) {
        http_response_code(404);
        exit;
    }

    // The admin edits products that are switched off — that is most of what
    // "switched off" is for — so a flat 404 would blank the screen where the
    // photographs are managed. Signed in, it is served; to everyone else the
    // garment does not exist. The session is consulted ONLY when the product
    // is inactive, so the public path starts no session and touches no cookie.
    $live = (bool)($row['active'] ?? 0);
    if (!$live && store_session_admin() === null) {
        http_response_code(404);
        exit;
    }

    $bytes = base64_decode($m[2], true);
    if ($bytes === false) { http_response_code(404); exit; }

    header('Content-Type: image/' . $m[1]);
    header('Content-Length: ' . strlen($bytes));
    // A year for the public copy — the URL carries the content hash. Never for
    // the admin's view of a hidden product: `public` would invite any shared
    // cache in between to keep it and hand it to the next person who asks.
    header($live
        ? 'Cache-Control: public, max-age=31536000, immutable'
        : 'Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
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
        // `logo` is deliberately NOT selected. It is a data: URI up to 160 kB
        // and eight of them would be a megabyte of base64 on a no-store
        // endpoint that a product page now calls. `has_logo` says whether to
        // ask for the bytes; ?r=brand_logo serves them, cached for a year.
        // `logo_v` is the content hash that makes that cache safe.
        'select slug, name_en, name_ar, logo is not null and logo <> \'\' as has_logo,
                substr(sha2(coalesce(logo, \'\'), 256), 1, 12) as logo_v
           from brands where active = 1 order by sort, name_en'
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
// ---------------------------------------------------------------- size advice
//
// "What size am I?" — answered from the shop's own charts and its own stock,
// by arithmetic. See store_size_advice() for why this is not a prompt.
//
// PUBLIC, because it is asked BEFORE anyone buys anything: a shopper who
// cannot find out their size does not create an account to ask, they leave.
if ($r === 'size_advice' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $b = store_body();
    $num = function ($v, int $lo, int $hi): ?int {
        if ($v === null || $v === '') return null;
        $n = (int) round((float) $v);
        return ($n >= $lo && $n <= $hi) ? $n : null;
    };
    // Bounds that refuse nonsense without refusing real people. 220cm and
    // 250kg are past any customer this shop will have; the point is to keep a
    // typo (1750 for 175) out of the arithmetic and out of the log.
    $in = [
        'slug'       => trim((string) ($b['slug'] ?? '')) ?: null,
        'lang'       => ($b['lang'] ?? '') === 'en' ? 'en' : 'ar',
        'height_cm'  => $num($b['height_cm'] ?? null, 120, 220),
        'weight_kg'  => $num($b['weight_kg'] ?? null, 35, 250),
        'chest_cm'   => $num($b['chest_cm'] ?? null, 50, 200),
        'waist_cm'   => $num($b['waist_cm'] ?? null, 40, 200),
        'hip_cm'     => $num($b['hip_cm'] ?? null, 50, 200),
        'usual_size' => in_array(strtoupper(trim((string) ($b['usual_size'] ?? ''))),
                          ['S','M','L','XL','2XL','3XL','4XL','5XL','XXL','XXXL'], true)
                          ? strtoupper(trim((string) $b['usual_size'])) : null,
        'prefers'    => in_array($b['prefers'] ?? '', ['tight', 'regular', 'loose'], true)
                          ? $b['prefers'] : 'regular',
    ];

    $out = store_size_advice($db, $in);
    if (isset($out['error'])) store_fail($out['error'], 422);

    // Women's clothing CANNOT BE EXCHANGED — the returns policy says so, and it
    // is the single most important thing a size adviser on this shop can tell
    // a customer. Getting it wrong on a women's piece is not a swap, it is a
    // lost sale and an unhappy customer, so the answer carries the warning
    // rather than leaving it on a policy page nobody opens mid-purchase.
    $out['no_exchange'] = false;
    if ($in['slug'] !== null) {
        $q = $db->prepare('select category from products where slug = ?');
        $q->execute([$in['slug']]);
        $out['no_exchange'] = ((string) $q->fetchColumn()) === 'women';
    }

    // Logged, so the chart can be improved rather than merely edited. Guarded:
    // a shop that has not imported sizeadvice.mysql.sql still gets its answer.
    try {
        $db->prepare(
            'insert into size_advice_log (slug, lang, height_cm, weight_kg, chest_cm,
               waist_cm, hip_cm, usual_size, prefers, size, fit, confidence)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$in['slug'], $in['lang'], $in['height_cm'], $in['weight_kg'],
                    $in['chest_cm'], $in['waist_cm'], $in['hip_cm'], $in['usual_size'],
                    $in['prefers'], $out['size'], $out['fit'], $out['confidence']]);
    } catch (Throwable $e) { /* the answer matters more than the record of it */ }

    store_out($out);
}

// The chart itself, for the size guide on the product page. It was four
// hard-coded rows ending at XL while the shop sells to 5XL.
if ($r === 'size_chart') {
    [$chart, $rows] = store_size_chart_for($db, trim((string) ($_GET['slug'] ?? '')) ?: null);
    store_out(['chart' => $chart, 'rows' => $rows]);
}

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
    $q = $db->prepare('select id, amount, payment_status, payment_method from orders where track_id = ?');
    $q->execute([$track]);
    if ($existing = $q->fetch()) {
        if ($existing['payment_status'] !== 'pending') store_fail('order_not_pending');
        // THE STORED METHOD, NOT THE REQUESTED ONE. This echoed `$method` back,
        // so a retry that named a different method was answered as though the
        // order had changed to it while the row kept the original. The order
        // matters: a knet order re-posted as `cod` answered "cod", the shopper
        // was shown "pay the courier", and the row still said knet — so the
        // admin's collect_cash flag stayed false and nobody would be sent to
        // collect. Nothing here writes, so the row is the truth; say the truth.
        store_out(['order_id' => (int)$existing['id'], 'track_id' => $track,
                   'amount' => (float)$existing['amount'],
                   'payment_method' => (string)$existing['payment_method']]);
    }

    $items = $b['items'] ?? null;
    if (!is_array($items) || count($items) === 0) store_fail('empty_cart');
    if (count($items) > 50) store_fail('cart_too_large');

    $customer = is_array($b['customer'] ?? null) ? $b['customer'] : [];
    $phone = store_phone($customer['phone'] ?? null);
    if ($phone === null) store_fail('invalid_phone');
    // REQUIRED, and refused here rather than shrugged off. The checkout asks
    // for it and every order from now on carries the customer's own copy of
    // what they bought; an order that slipped through without one would be a
    // silent hole in that promise, discovered only by the shopper who never
    // received anything.
    $email = store_email($customer['email'] ?? null);
    if ($email === null) store_fail('invalid_email');
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
               customer_name, customer_phone, customer_email,
               customer_governorate, customer_area,
               customer_block, customer_street, customer_building,
               customer_floor, customer_flat, customer_note, customer_lang,
               utm_source, utm_medium, utm_campaign, referrer_host)
             values (?, \'pending\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $track, $method, $name, $phone, $email, $gov, $area, $block, $street, $building,
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
        if (!store_discounts_claim($db, $disc['applied'])) store_fail('discount_used_up', 409);

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
            $db->rollBack();
            // The token names the item, the size AND what is left, because
            // "out of stock" on a page showing eight things is not something
            // a shopper can act on. 409, not 400: nothing they typed is wrong.
            store_fail(sprintf('out_of_stock_%s_%s_%d', $short['slug'], $short['size'], $short['have']), 409);
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
        // ...and the owner's own phone, same transaction, same reason.
        store_queue_push($db, $orderId, 'new');

        // ...and the CUSTOMER's own copy. Same transaction again, and the same
        // argument each time: a message that has to survive the order is
        // written with the order or it is written on hope.
        store_queue_customer_mail($db, $orderId, 'received');

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
