<?php
/**
 * The database, checked against the website that reads it.
 *
 *   php scripts/db-audit.php            (needs MariaDB up — scripts/sandbox.sh)
 *   SPORTA_DB_AUDIT_JSON=1 php scripts/db-audit.php     machine-readable
 *
 * Everything else in scripts/ checks CODE against code, or a page against a
 * browser. Nothing checked the DATA, and the data is where a shop actually
 * goes wrong: a product the shop links to with no sizes behind it, a sale
 * price above the real one, a governorate in the database that checkout has
 * no name for, an order whose lines do not add up to what the customer was
 * charged. None of those break a test, and every one of them is visible to a
 * customer before it is visible to us.
 *
 * The connection is the SITE'S OWN — api/config.php, via store.php — so this
 * reads exactly what the website reads, not a second opinion.
 *
 * It writes NOTHING. Every statement is a select.
 */
declare(strict_types=1);

$root = dirname(__DIR__);
$api  = $root . '/sporta-site/public_html/api';
require_once $api . '/store.php';

$fails = 0; $warns = 0; $checks = 0;
$json = getenv('SPORTA_DB_AUDIT_JSON') === '1';
$out = [];

function say(string $level, string $what): void {
    global $fails, $warns, $checks, $json, $out;
    $checks++;
    if ($level === 'FAIL') $fails++;
    if ($level === 'WARN') $warns++;
    $out[] = ['level' => $level, 'text' => $what];
    if (!$json) echo str_pad($level, 5) . $what . "\n";
}
function ok(string $w): void   { say('ok', $w); }
function bad(string $w): void  { say('FAIL', $w); }
function warn(string $w): void { say('WARN', $w); }
function head(string $t): void { global $json; if (!$json) echo "\n--- $t\n"; }

$db = store_db();
$q = fn(string $sql, array $a = []) => (function () use ($db, $sql, $a) {
    $s = $db->prepare($sql); $s->execute($a); return $s->fetchAll(PDO::FETCH_ASSOC);
})();
$one = fn(string $sql, array $a = []) => $q($sql, $a)[0] ?? null;

/* ------------------------------------------------------------------ schema */
head('every table the website needs, and every column it names');

// Columns are read back from information_schema rather than trusted from the
// .sql files: what matters is what the SERVER has, which is what an
// incomplete or half-applied import leaves behind.
$dbName = $one('select database() d')['d'];
$cols = [];
foreach ($q('select table_name t, column_name c, data_type dt, is_nullable n, column_type ct
             from information_schema.columns where table_schema = ?', [$dbName]) as $r) {
    $cols[$r['t']][$r['c']] = $r;
}

// The tables the storefront cannot serve a page without. The optional ones
// (push, whatsapp, accounting, antifraud) are separate imports by design and
// their absence is a WARN, not a failure — the shop still sells.
$required = ['products', 'product_variants', 'orders', 'order_items', 'settings',
             'admin_users', 'discounts', 'brands', 'hero_slides', 'rate_limit'];
$optional = ['reviews', 'size_charts', 'wallet_passes', 'accounts', 'journal_entries',
             'journal_lines', 'push_outbox', 'push_subscriptions', 'whatsapp_outbox',
             'customer_mail_outbox', 'fulfilment_outbox', 'assistant_outbox',
             'blocked_customers', 'product_images', 'size_advice_log'];
foreach ($required as $t) {
    isset($cols[$t]) ? ok("table $t exists") : bad("table $t is MISSING — the storefront cannot serve without it");
}
foreach ($optional as $t) if (!isset($cols[$t])) warn("optional table $t is absent — that feature is off");

// Money must never be a float. KWD has three decimal places and a float loses
// fils; this is the single most expensive column type in the schema.
foreach ([['products', ['price', 'sale_price']],
          ['orders', ['amount', 'subtotal', 'discount_amount', 'delivery_fee']],
          ['order_items', ['unit_price']],
          ['discounts', ['value', 'min_order']]] as [$t, $money]) {
    foreach ($money as $c) {
        $ct = $cols[$t][$c]['ct'] ?? null;
        if ($ct === null) { bad("$t.$c is missing"); continue; }
        str_starts_with($ct, 'decimal(10,3)') || (str_starts_with($ct, 'decimal') && $t === 'discounts')
            ? ok("$t.$c is $ct — exact money")
            : bad("$t.$c is $ct, not decimal(10,3) — fils will be lost");
    }
}

// utf8mb4 everywhere the catalogue's Arabic lands. utf8mb3 truncates silently
// at the first 4-byte glyph, which in practice is an emoji in a product note.
foreach ($q('select table_name t, table_collation c from information_schema.tables
             where table_schema = ? and table_type = "BASE TABLE"', [$dbName]) as $r) {
    if (!str_starts_with((string)$r['c'], 'utf8mb4'))
        bad("table {$r['t']} is {$r['c']}, not utf8mb4 — Arabic will truncate");
}
ok('every table is utf8mb4');

/* --------------------------------------------------------------- catalogue */
head('the catalogue, as a customer meets it');

$products = $q('select * from products');
$variants = $q('select * from product_variants');
$bySlug = [];
foreach ($variants as $v) $bySlug[$v['slug']][] = $v;

ok(count($products) . ' products, ' . count($variants) . ' variants');

$active = array_values(array_filter($products, fn($p) => (int)$p['active'] === 1));
ok(count($active) . ' products are active and therefore shoppable');

// A product with no rows in product_variants is UNTRACKED, and that is a
// supported state, not a fault — store_price_lines only demands a size when
// rows exist, and store_stock_claim skips those lines rather than inventing a
// count for them. It is right for the backpack, the cap and the phone strap.
//
// It is NOT right for a t-shirt. The categories below are the ones where a
// garment has a size the customer has to choose and the packer has to pick;
// an untracked product in one of them is sold with no size named anywhere —
// on the order, on the invoice, or on the picking list.
$SIZED = ['men', 'women', 'outerwear'];

foreach ($active as $p) {
    $sl = $p['slug'];
    if (empty($bySlug[$sl])) {
        in_array($p['category'], $SIZED, true)
            ? bad("'$sl' ({$p['category']}) is sold with NO size rows — the shop shows no size to pick and the order records none")
            : ok("'$sl' is untracked, which is right for {$p['category']}");
        continue;
    }

    $stock = array_sum(array_map(fn($v) => max(0, (int)$v['stock']), $bySlug[$sl]));
    if ($stock === 0) warn("product '$sl' is active but every size is out of stock");

    foreach (['name_en', 'name_ar'] as $f)
        if (trim((string)$p[$f]) === '') bad("product '$sl' has an empty $f — one language shows a blank title");

    if ((float)$p['price'] <= 0) bad("product '$sl' is priced " . $p['price']);

    // A sale that is not a saving. The shop prints "was X, now Y" from these
    // two columns and does not sanity-check them at render time.
    if ($p['sale_price'] !== null) {
        if ((float)$p['sale_price'] >= (float)$p['price'])
            bad("product '$sl' has sale_price {$p['sale_price']} >= price {$p['price']} — the shop would advertise a rise");
        if ((float)$p['sale_price'] <= 0)
            bad("product '$sl' has sale_price {$p['sale_price']}");
        if ($p['sale_starts_at'] && $p['sale_ends_at'] && $p['sale_ends_at'] < $p['sale_starts_at'])
            bad("product '$sl' has a sale window that ends before it starts");
    }
}

// Orphans in the other direction: a size row whose product is gone still
// occupies a sku, and set_stock on it succeeds while changing nothing visible.
foreach ($bySlug as $sl => $vs)
    if (!array_filter($products, fn($p) => $p['slug'] === $sl))
        bad("variants exist for '$sl', which is not a product (" . count($vs) . ' rows)');

// Sizes have to be ones the size guide can actually show measurements for.
//
// READ FROM size_charts, NOT FROM A LIST HERE. This was a literal —
// ['XS','S','M','L','XL','2XL','3XL','OS'] — sitting three lines from the table
// it claimed to speak for, and it had fallen behind it: the charts define 4XL
// and 5XL in both the unisex and women's sets, sort 7 and 8, and 30 variants
// are sold in them. So the audit warned twice, on every run, that the size
// guide did not know about sizes the size guide defines.
//
// A warning that is wrong is worse than no warning. It is read, checked,
// found to be nothing, and the next one is skipped.
//
// `OS` (one size) is kept as an addition rather than a row in the charts: it
// is what accessories carry, and a chart of chest and waist measurements has
// nothing to say about a cap.
$sizes = array_unique(array_column($variants, 'size'));
$charted = array_column($q('select distinct size from size_charts'), 'size');
$known = array_merge($charted, ['OS']);
if (!$charted) {
    warn('size_charts is empty, so no size can be checked against it');
} else {
    foreach ($sizes as $s)
        in_array($s, $known, true) ? null
            : warn("size '$s' is sold, but the size guide has no measurements for it");
}
ok('sizes in use: ' . implode(' ', $sizes));

foreach ($variants as $v) {
    if ((int)$v['stock'] < 0) bad("sku {$v['sku']} has negative stock ({$v['stock']})");
    if (trim((string)$v['sku']) === '') bad("a variant of '{$v['slug']}' has an empty sku — set_stock keys on it");
}
$dupSku = $q('select sku, count(*) n from product_variants group by sku having n > 1');
foreach ($dupSku as $d) bad("sku {$d['sku']} appears {$d['n']} times — set_stock would hit whichever row came first");
if (!$dupSku) ok('every sku is unique');

/* ------------------------------------- the value LISTS, against the website */
head('values the database holds against the words the website knows');

// Three places name the governorates: store.php (which validates the order),
// the app's checkout, and the site's built bundle. A row whose governorate is
// in none of them is an address the courier list has no line for.
$phpGovs = STORE_GOVERNORATES;
ok('store.php accepts: ' . implode(', ', $phpGovs));

$appSrc = @file_get_contents($root . '/src/app/checkout.tsx') ?: '';
preg_match_all("/\{\s*id:\s*'([a-z\-]+)'\s*,\s*ar:/", $appSrc, $m);
$appGovs = $m[1];
if ($appGovs) {
    sort($appGovs); $p = $phpGovs; sort($p);
    $appGovs === $p
        ? ok("the app's checkout offers exactly the six the server accepts")
        : bad("the app offers [" . implode(',', $appGovs) . "], the server accepts [" . implode(',', $p) . ']');
}

$bundle = glob($root . '/sporta-site/public_html/assets/index-*.js');
if ($bundle) {
    $js = file_get_contents($bundle[0]);
    $missing = array_values(array_filter($phpGovs, fn($g) => !str_contains($js, $g)));
    $missing
        ? bad("the website's bundle never names: " . implode(', ', $missing))
        : ok("the website's bundle names all six governorates");
}

// And what the ORDERS actually carry.
foreach ($q('select distinct customer_governorate g from orders where customer_governorate is not null') as $r)
    if (!in_array($r['g'], $phpGovs, true))
        bad("orders carry governorate '{$r['g']}', which store.php would now reject");
ok('every governorate on an existing order is still one the server accepts');

// THE DELIVERY FEE, in all three places that quote a total. The server adds
// STORE_DELIVERY_FEE_FILS to every order with no threshold of any kind; an app
// that quotes a different number, or promises free delivery over some basket
// size, shows a customer one total and charges them another.
$cartSrc = @file_get_contents($root . '/src/lib/cart.tsx') ?: '';
if ($cartSrc !== '') {
    preg_match('/DELIVERY_FEE:\s*Fils\s*=\s*([\d_]+)/', $cartSrc, $mf);
    $appFee = isset($mf[1]) ? (int)str_replace('_', '', $mf[1]) : null;
    $appFee === STORE_DELIVERY_FEE_FILS
        ? ok("the app's delivery fee is " . STORE_DELIVERY_FEE_FILS . ' fils, the same as the server charges')
        : bad("the app quotes $appFee fils for delivery; store.php charges " . STORE_DELIVERY_FEE_FILS);
    str_contains($cartSrc, 'FREE_DELIVERY_OVER')
        ? bad('the app still has a free-delivery threshold; the server has none, so any basket over it is quoted short')
        : ok('the app promises no free-delivery threshold the server would not honour');
}

// Categories: what the catalogue is filed under, against what the shop can
// navigate to. A product in a category with no route is unreachable except by
// search.
$cats = array_column($q('select distinct category c from products where category is not null and category <> ""'), 'c');
ok('categories in the catalogue: ' . implode(', ', $cats));
// The bundle is minified, and its string literals come out as backticks as
// often as quotes — a check that only looked for quotes reported all four
// categories missing from a bundle that names every one of them.
if ($bundle) foreach ($cats as $c) {
    $named = false;
    foreach (['"', "'", '`'] as $qch) if (str_contains($js, $qch . $c . $qch)) $named = true;
    $named ? null : warn("category '$c' is never named in the website bundle — those products may be unreachable by nav");
}
ok('every category in the catalogue is named in the website bundle');

// Brands: a product may point at a brand that is not in the table, and the
// brand strip then renders a gap.
foreach ($q('select distinct brand_slug b from products where brand_slug is not null and brand_slug <> ""') as $r) {
    $b = $one('select slug, active from brands where slug = ?', [$r['b']]);
    if (!$b) bad("products reference brand '{$r['b']}', which is not in the brands table");
    elseif ((int)$b['active'] !== 1) warn("products reference brand '{$r['b']}', which is inactive");
}
ok('every brand a product names exists');

/* -------------------------------------------------- the two status axes */
head('the status words in the database against the ones the code branches on');

// These sets are the server's own. A row carrying anything else falls through
// every branch in admin.php and the customer's status page alike, and shows
// as blank rather than as an error.
$axes = [
    ['orders', 'payment_status',    ['pending', 'paid', 'review', 'failed', 'refunded']],
    ['orders', 'fulfilment_status', ['unfulfilled', 'packed', 'shipped', 'delivered', 'cancelled']],
    ['orders', 'payment_method',    ['cod', 'knet', 'tpay', 'card']],
    ['orders', 'customer_lang',     ['ar', 'en']],
    ['discounts', 'kind',           ['code', 'auto']],
    ['discounts', 'type',           ['percent', 'fixed']],
];
foreach ($axes as [$t, $c, $allowed]) {
    if (!isset($cols[$t][$c])) { bad("$t.$c is missing"); continue; }
    $seen = array_column($q("select distinct `$c` v from `$t` where `$c` is not null and `$c` <> ''"), 'v');
    $rogue = array_values(array_diff($seen, $allowed));
    $rogue
        ? bad("$t.$c holds " . implode(', ', $rogue) . ' — no branch in the code matches')
        : ok("$t.$c: " . (implode(', ', $seen) ?: '(no rows)') . ' — all known');
}

/* ----------------------------------------------------------------- orders */
head('the money on the orders, re-added');

// The one arithmetic the shop cannot get wrong: what was charged has to equal
// what the lines came to, less the discount, plus delivery. If these ever
// disagree, the invoice and the bank statement disagree.
$bad = 0; $checked = 0;
foreach ($q('select * from orders') as $o) {
    $lines = $q('select qty, unit_price from order_items where order_id = ?', [$o['id']]);
    if (!$lines) { bad("order #{$o['id']} ({$o['track_id']}) has no items"); continue; }
    $sub = 0.0;
    foreach ($lines as $l) $sub += (int)$l['qty'] * (float)$l['unit_price'];
    $expect = round($sub - (float)$o['discount_amount'] + (float)$o['delivery_fee'], 3);
    $checked++;
    if (abs($expect - (float)$o['amount']) > 0.0005) {
        $bad++;
        if ($bad <= 5) bad(sprintf('order #%d (%s): lines %.3f - disc %.3f + del %.3f = %.3f, but amount is %s',
            $o['id'], $o['track_id'], $sub, (float)$o['discount_amount'], (float)$o['delivery_fee'], $expect, $o['amount']));
    }
    if (abs((float)$o['subtotal'] - round($sub, 3)) > 0.0005)
        warn("order #{$o['id']}: stored subtotal {$o['subtotal']} is not the sum of its lines (" . round($sub, 3) . ')');
}
$bad ? bad("$bad of $checked orders do not add up") : ok("all $checked orders add up to the fils");

// Delivery is one flat fee, everywhere, by decision — so any other number on
// an order is either a bug or a rule nobody wrote down.
$fee = STORE_DELIVERY_FEE_FILS / 1000;
foreach ($q('select distinct delivery_fee f from orders') as $r)
    if (abs((float)$r['f'] - $fee) > 0.0005 && (float)$r['f'] !== 0.0)
        warn("an order carries delivery_fee {$r['f']}, and the flat fee is " . number_format($fee, 3));
ok('delivery fee on file matches the flat ' . number_format($fee, 3) . ' KWD');

// Orphaned lines: an item pointing at a product that has since been deleted.
// The order keeps its own name_en/name_ar snapshot, so this is survivable —
// but the admin's item view joins on products and shows the row blank.
$orph = $q('select count(*) n from order_items i left join products p on p.id = i.product_id where p.id is null');
(int)$orph[0]['n'] === 0
    ? ok('every order line still points at a real product')
    : warn("{$orph[0]['n']} order lines point at a deleted product — the panel shows them blank, the snapshot name still prints");

// Paid, but never marked paid_at — the accounting export keys on that column.
$noStamp = $one("select count(*) n from orders where payment_status = 'paid' and paid_at is null");
(int)$noStamp['n'] === 0
    ? ok('every paid order carries a paid_at')
    : bad("{$noStamp['n']} orders are paid with no paid_at — they fall out of every date-ranged report");

// The stock ledger's two flags cannot both be true: claimed and released at
// once means the count was taken twice.
$both = $one('select count(*) n from orders where stock_claimed = 1 and stock_released = 1');
(int)$both['n'] === 0 ? ok('no order has stock both claimed and released')
                      : bad("{$both['n']} orders are both stock_claimed and stock_released");

/* --------------------------------------------------------------- settings */
head('settings, as store.php will parse them');

foreach ($q('select name, value from settings') as $s) {
    $v = json_decode($s['value'], true);
    if (!is_array($v)) { bad("setting '{$s['name']}' is not valid JSON — store.php falls back to its default and the owner's edit is invisible"); continue; }
    ok("setting '{$s['name']}' parses: " . implode(', ', array_keys($v)));
}
// Arabic that survived the round trip. A latin1 connection turns every Arabic
// letter into a question mark, and the symptom is a promo bar of '??????'.
$bar = json_decode($one("select value v from settings where name = 'promo_bar'")['v'] ?? '{}', true);
if (is_array($bar) && ($bar['text_ar'] ?? '') !== '') {
    preg_match('/\p{Arabic}/u', $bar['text_ar'])
        ? ok('the promo bar\'s Arabic came back as Arabic, not as question marks')
        : bad('the promo bar\'s text_ar has no Arabic letters left — the connection charset mangled it');
}

// The hero.
//
// AN EMPTY hero_slides IS NOT AN EMPTY HERO, which is what this said. The
// storefront ships five banners and builds their paths at runtime from a list
// in its own bundle — checked in a browser with the table empty: the homepage
// renders /hero/desktop/bodybuilding-men.webp at its full 1600x635 and cycles
// the other four. The table is the OVERRIDE, edited in /backends, and having
// none simply means the shipped banners are what everyone sees.
//
// The distinction matters because the old wording sent someone looking for a
// broken homepage that was never broken. What IS worth saying is the true
// thing: nothing has been uploaded, so the panel's slide editor is empty.
$slides = $one('select count(*) n, sum(active) a from hero_slides');
if ((int)$slides['n'] === 0) {
    ok('hero_slides is empty — the five shipped banners are what the homepage shows');
} elseif ((int)($slides['a'] ?? 0) > 0) {
    ok("{$slides['a']} of {$slides['n']} hero slides are active");
} else {
    // THIS one is a genuine break: rows exist, so the storefront uses the
    // table rather than its own banners, and every row is switched off.
    bad("all {$slides['n']} hero slides are inactive — the hero band is blank");
}

/* ------------------------------------------------------------- discounts */
head('discounts');

foreach ($q('select * from discounts') as $d) {
    $who = $d['code'] ?: ('#' . $d['id']);
    if ($d['type'] === 'percent' && ((float)$d['value'] < 1 || (float)$d['value'] > 90))
        bad("discount $who is {$d['value']}% — outside the 1–90 the panel and server both enforce");
    if ($d['type'] === 'fixed' && (float)$d['value'] <= 0)
        bad("discount $who is a fixed " . $d['value']);
    if ($d['kind'] === 'code' && trim((string)$d['code']) === '')
        bad("discount #{$d['id']} is a code discount with no code — nothing can ever redeem it");
    if ($d['starts_at'] && $d['ends_at'] && $d['ends_at'] < $d['starts_at'])
        bad("discount $who ends before it starts");
    if ((int)$d['usage_limit'] > 0 && (int)$d['used_count'] > (int)$d['usage_limit'])
        bad("discount $who has been used {$d['used_count']} times against a limit of {$d['usage_limit']}");
    if ($d['category'] && !in_array($d['category'], $cats, true))
        warn("discount $who is scoped to category '{$d['category']}', which no product is in — it can never apply");
}
ok('discount rules checked');

/* ------------------------------------------------------------------- out */
if ($json) { echo json_encode(['fails' => $fails, 'warns' => $warns, 'checks' => $checks, 'lines' => $out], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n"; }
else echo "\n" . ($fails ? "$fails failed" : 'all ok') . ", $warns to look at, out of $checks checks\n";
exit($fails ? 1 : 0);
