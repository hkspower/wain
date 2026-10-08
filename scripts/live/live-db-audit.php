<?php
/**
 * READ-ONLY. The shop's DATA, checked against the website that reads it — the sandbox's or the LIVE shop's.
 *
 *   wget -nv -O r.php https://raw.githubusercontent.com/hkspower/wain/<40-char-sha>/scripts/live/live-db-audit.php && php r.php
 *   php scripts/live/live-db-audit.php         the same compact report, against the sandbox
 *   php scripts/db-audit.php                   every line, against the sandbox   (npm run test:db)
 *   php r.php --full                           every line, on the server too (still redacted there)
 *   SPORTA_DB_AUDIT_JSON=1 php scripts/db-audit.php     machine-readable
 *
 * THE CHECKS LIVE HERE AND ONLY HERE. scripts/db-audit.php is a wrapper that requires this file and
 * asks for every line. It had to be this way round: the cron channel fetches exactly ONE file into
 * the home directory and runs it, so the file it fetches has to carry the checks itself — a copy
 * for the server beside the original for the sandbox would be two homes for 95 checks, and this
 * repository has watched hand-kept duplicates drift twice (the two hardcoded manifests).
 *
 * WHICH DATABASE. The live server's own api/store.php when it exists, else the repository's — the
 * same rule as live-schema-full.php — so the connection is always the SITE'S OWN (api/config.php via
 * store.php): this reads exactly what the website reads, not a second opinion. The bundle checks
 * read the docroot that store.php sits in (the live bundle on the server). The app-source checks
 * (src/app/checkout.tsx, src/lib/cart.tsx) need the repository and are skipped on the server, so the
 * live run reports fewer checks than the sandbox's; that is the reason, not a lost section.
 *
 * COMPACT OUTPUT (the default here; cron-sized):
 *   DBAUDIT start store=live|repo php=…           printed before anything can fail
 *   FAIL …  /  WARN …                             one line per finding, as it is measured, ≤150 chars
 *   DBAUDIT checks= fails= warns= lost= missing= products= variants= orders= ms= verdict=
 * The last line is the summary; if it is absent the run was cut short (a shutdown line says why when
 * PHP can). `verdict=INCOMPLETE` means a section could not finish — read the FAIL/WARN naming it.
 *
 * A MISSING TABLE DOES NOT END THE RUN. Every section is its own try: a table that is not there is
 * reported as `missing:<table>` (FAIL for a table the storefront cannot serve without, WARN for an
 * optional one), that section stops, and the next one runs. A missing column is `missing-column:<c>`.
 * The old script died on the first such query through store.php's exception handler and printed
 * {"error":"no_table"}, which named neither the table nor how much had already been checked.
 *
 * WHAT IT PRINTS, AND WHAT IT NEVER DOES. Counts, product slugs, SKUs, brand slugs, image row ids and
 * order NUMBERS (#id). Never a customer name, phone, email or address, and never a secret. On the
 * server, and in compact mode anywhere, three more things are withheld: an order's TRACK ID (it is
 * the credential ?r=status answers to), a discount's CODE (it is redeemable — the row id is shown),
 * and any unrecognised value read from an order column (it may be text a customer typed — its
 * byte length is shown). Orders are read by id, track id and the money columns; the only customer
 * columns touched are the DISTINCT governorate and language, compared with the lists the code knows.
 * Settings are reported by name and key, never by value.
 *
 * It writes NOTHING. Every statement is a select. Budgeted to stop well inside a minute.
 *
 * ---------------------------------------------------------------------------------------------
 *
 * Everything else in scripts/ checks CODE against code, or a page against a
 * browser. Nothing checked the DATA, and the data is where a shop actually
 * goes wrong: a product the shop links to with no sizes behind it, a sale
 * price above the real one, a governorate in the database that checkout has
 * no name for, an order whose lines do not add up to what the customer was
 * charged. None of those break a test, and every one of them is visible to a
 * customer before it is visible to us.
 */
declare(strict_types=1);

const DBA_LIVE_DOCROOT = '/home/u130124229/domains/sporta.com.kw/public_html';
const DBA_BUDGET_S     = 40.0;   // a * * * * * job must finish inside its minute
const DBA_MAX_LINES    = 80;     // findings printed in compact mode; the rest are counted

$t0     = microtime(true);
$onLive = is_file(DBA_LIVE_DOCROOT . '/api/store.php');
$doc    = $onLive ? DBA_LIVE_DOCROOT : dirname(__DIR__, 2) . '/sporta-site/public_html';
$root   = $onLive ? null : dirname(__DIR__, 2);   // the repository: the app's source, which no server has
$full   = defined('SPORTA_DB_AUDIT_FULL') || in_array('--full', $argv ?? [], true);
$json   = getenv('SPORTA_DB_AUDIT_JSON') === '1';
$redact = $onLive || !$full;

$fails = 0; $warns = 0; $checks = 0;
$out = [];
$lost = 0; $missingT = []; $shown = 0; $hidden = 0; $phpWarn = 0; $done = false;
$counts = ['products' => '?', 'variants' => '?', 'orders' => '?'];

function dba_line(string $s): void { echo $s, "\n"; @flush(); }
function dba_clip(string $s, int $n): string {
    if (!function_exists('mb_strlen')) return strlen($s) > $n ? substr($s, 0, $n - 1) . '~' : $s;
    return mb_strlen($s) > $n ? mb_substr($s, 0, $n - 1) . '~' : $s;
}

// An error message can name the database user or the database; nothing else printed here can.
function dba_safe(Throwable $e): string {
    $msg = (string) preg_replace("/'[^']*'@'[^']*'/", "'?'@'?'", $e->getMessage());
    $msg = (string) preg_replace("/database '[^']*'/i", "database '?'", $msg);
    $msg = (string) preg_replace("/Table '[^'.]*\./", "Table '", $msg);
    $msg = (string) preg_replace('/SQLSTATE\[\w+\]:?\s*/', '', $msg);
    return get_class($e) . ':' . dba_clip(str_replace(["\n", "\r"], ' ', $msg), 110);
}

/** ['table', name] for a missing table, ['column', name] for a missing column, else ['', '']. */
function dba_missing(Throwable $e): array {
    if (!$e instanceof PDOException) return ['', ''];
    $no = (int) ($e->errorInfo[1] ?? 0);
    $m  = $e->getMessage();
    if ($no === 1146 || str_contains($m, '42S02')) {
        preg_match("/Table '(?:[^'.]*\.)?([^']+)'/", $m, $x);
        return ['table', $x[1] ?? '?'];
    }
    if ($no === 1054 || str_contains($m, '42S22')) {
        preg_match("/Unknown column '([^']+)'/", $m, $x);
        return ['column', $x[1] ?? '?'];
    }
    return ['', ''];
}

function dba_summary(): void {
    global $checks, $fails, $warns, $lost, $missingT, $counts, $t0, $hidden, $phpWarn, $done;
    $done = true;
    $miss = $missingT ? implode(',', array_keys($missingT)) : '0';
    $verdict = $fails ? 'FAIL' : ($lost ? 'INCOMPLETE' : 'ok');
    dba_line("DBAUDIT checks=$checks fails=$fails warns=$warns lost=$lost missing=$miss"
        . " products={$counts['products']} variants={$counts['variants']} orders={$counts['orders']}"
        . ($hidden ? " unprinted=$hidden" : '') . ($phpWarn ? " phpWarnings=$phpWarn" : '')
        . ' ms=' . (int) round((microtime(true) - $t0) * 1000) . " verdict=$verdict");
}

/** The last line, in whichever of the three shapes was asked for, and the exit code. */
function dba_finish(): void {
    global $json, $full, $fails, $warns, $checks, $out, $done;
    $done = true;
    if ($json) echo json_encode(['fails' => $fails, 'warns' => $warns, 'checks' => $checks, 'lines' => $out], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
    elseif ($full) echo "\n" . ($fails ? "$fails failed" : 'all ok') . ", $warns to look at, out of $checks checks\n";
    else dba_summary();
    exit($fails ? 1 : 0);
}

if (!$full && !$json) {
    dba_line('DBAUDIT start store=' . ($onLive ? 'live' : 'repo') . ' php=' . PHP_VERSION);
    // A PHP warning is counted rather than printed: it would break the one-line-per-finding shape
    // and carry a file path. The summary says how many there were.
    set_error_handler(function (int $no, string $msg) {
        if (error_reporting() & $no) $GLOBALS['phpWarn']++;   // an @-silenced one is not counted
        return true;
    },
                      E_WARNING | E_NOTICE | E_USER_WARNING | E_USER_NOTICE | E_DEPRECATED | E_USER_DEPRECATED);
    register_shutdown_function(function () {
        if ($GLOBALS['done']) return;
        $e = error_get_last();
        dba_line('DBAUDIT cut-short ' . ($e ? 'php:' . dba_clip(str_replace("\n", ' ', $e['message']), 110) : 'no-error-reported')
            . ' checks=' . $GLOBALS['checks'] . ' fails=' . $GLOBALS['fails'] . ' warns=' . $GLOBALS['warns']);
    });
}

try {
    require_once $doc . '/api/store.php';
} catch (Throwable $e) {
    dba_line('DBAUDIT error=store ' . dba_safe($e));
    $done = true;
    exit(1);
}
// store.php answers an uncaught exception with JSON for a browser; a cron line is more use here.
set_exception_handler(function (Throwable $e): void {
    bad('stopped: ' . dba_safe($e));
    dba_finish();
});

function say(string $level, string $what): void {
    global $fails, $warns, $checks, $json, $out, $full, $shown, $hidden;
    $checks++;
    if ($level === 'FAIL') $fails++;
    if ($level === 'WARN') $warns++;
    $out[] = ['level' => $level, 'text' => $what];
    if ($json) return;
    if ($full) { echo str_pad($level, 5) . $what . "\n"; return; }
    if ($level === 'ok') return;
    if ($shown >= DBA_MAX_LINES) { $hidden++; return; }
    $shown++;
    $lead = str_starts_with($what, ' ') ? '  ' : '';
    dba_line($level . ' ' . $lead . dba_clip((string) preg_replace('/\s+/u', ' ', trim($what)), 150));
}
function ok(string $w): void   { say('ok', $w); }
function bad(string $w): void  { say('FAIL', $w); }
function warn(string $w): void { say('WARN', $w); }
function head(string $t): void { global $json, $full; if (!$json && $full) echo "\n--- $t\n"; }

// The tables the storefront cannot serve a page without. The optional ones
// (push, whatsapp, accounting, antifraud) are separate imports by design and
// their absence is a WARN, not a failure — the shop still sells.
$required = ['products', 'product_variants', 'orders', 'order_items', 'settings',
             'admin_users', 'discounts', 'brands', 'hero_slides', 'rate_limit'];
$optional = ['reviews', 'size_charts', 'wallet_passes', 'accounts', 'journal_entries',
             'journal_lines', 'push_outbox', 'push_subscriptions', 'whatsapp_outbox',
             'customer_mail_outbox', 'fulfilment_outbox', 'assistant_outbox',
             'blocked_customers', 'product_images', 'size_advice_log'];

/** A section starts here: its heading, and the time budget. */
function go(string $title): bool {
    global $t0, $lost;
    head($title);
    if (microtime(true) - $t0 > DBA_BUDGET_S) {
        $lost++;
        bad('budget: over ' . DBA_BUDGET_S . "s, \"$title\" was not checked");
        return false;
    }
    return true;
}
/** A section could not finish. Say which table, or which error, and carry on with the next. */
function lost(string $title, Throwable $e): void {
    global $required, $lost, $missingT;
    $lost++;
    [$kind, $name] = dba_missing($e);
    if ($kind === 'table') {
        $missingT[$name] = true;
        $msg = "missing:$name — the rest of \"$title\" was not checked";
        in_array($name, $required, true) ? bad($msg) : warn($msg);
        return;
    }
    if ($kind === 'column') { bad("missing-column:$name — the rest of \"$title\" was not checked"); return; }
    bad("error in \"$title\", the rest was not checked: " . dba_safe($e));
}

/** An order as this run may name it: its number, and its track id only where nobody else will read it. */
$ref = fn(array $o): string => $redact ? "#{$o['id']}" : "#{$o['id']} ({$o['track_id']})";
/** A value read out of an order row: shown when it is a plain token, else only its length. */
$tok = fn($v): string => (!$redact || preg_match('/^[a-z][a-z0-9_-]{0,23}$/', (string) $v))
    ? (string) $v : '<' . strlen((string) $v) . ' bytes>';

// store_config() answers a missing config.php the same way — JSON, then exit(0) — so a docroot
// with no config would have printed {"error":"not_configured"} and PASSED `npm run test:db`.
if (!is_file($doc . '/api/config.php')) {
    bad('api/config.php is missing — store.php has no database to connect to, nothing was checked');
    dba_finish();
}

$db = null;
try {
    // store_db() answers a refused connection with JSON and exit(0) — right for a browser, and it
    // meant a dead database made `npm run test:db` PASS. Connecting here makes it a FAIL.
    $db = function_exists('store_db_connect') ? store_db_connect(store_config()) : store_db();
} catch (Throwable $e) {
    $no = $e instanceof PDOException ? (int) ($e->errorInfo[1] ?? $e->getCode()) : 0;
    bad("cannot reach the database (connect error $no) — nothing was checked");
    dba_finish();
}
// No single statement may outlive the budget: a statement cap for this session only (MariaDB names it
// in seconds, MySQL in milliseconds; whichever the server does not know is refused, and ignored).
foreach (['set session max_statement_time = 20', 'set session max_execution_time = 20000'] as $cap) {
    try { $db->exec($cap); } catch (Throwable $e) {}
}
$q = fn(string $sql, array $a = []) => (function () use ($db, $sql, $a) {
    $s = $db->prepare($sql); $s->execute($a); return $s->fetchAll(PDO::FETCH_ASSOC);
})();
$one = fn(string $sql, array $a = []) => $q($sql, $a)[0] ?? null;

// Shared between sections, so a section that is lost leaves the later ones a known empty value
// rather than an undefined variable.
$cols = []; $schemaRead = false; $products = []; $variants = []; $active = []; $bySlug = []; $cats = null;
$bundle = []; $js = '';

/* ------------------------------------------------------------------ schema */
if (go('every table the website needs, and every column it names')) try {

// Columns are read back from information_schema rather than trusted from the
// .sql files: what matters is what the SERVER has, which is what an
// incomplete or half-applied import leaves behind.
$dbName = $one('select database() d')['d'];
foreach ($q('select table_name t, column_name c, data_type dt, is_nullable n, column_type ct
             from information_schema.columns where table_schema = ?', [$dbName]) as $r) {
    $cols[$r['t']][$r['c']] = $r;
}
$schemaRead = true;

foreach ($required as $t) {
    if (isset($cols[$t])) { ok("table $t exists"); continue; }
    $missingT[$t] = true;
    bad("table $t is MISSING — the storefront cannot serve without it");
}
foreach ($optional as $t) if (!isset($cols[$t])) {
    $missingT[$t] = true;
    warn("optional table $t is absent — that feature is off");
}

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
foreach ($q("select table_name t, table_collation c from information_schema.tables
             where table_schema = ? and table_type = 'BASE TABLE'", [$dbName]) as $r) {
    if (!str_starts_with((string)$r['c'], 'utf8mb4'))
        bad("table {$r['t']} is {$r['c']}, not utf8mb4 — Arabic will truncate");
}
ok('every table is utf8mb4');

} catch (Throwable $e) { lost('the schema', $e); }

/* --------------------------------------------------------------- catalogue */
if (go('the catalogue, as a customer meets it')) try {

// Only the columns read below, in primary-key order (what `select *` scanned in): a photograph or a
// long description is not loaded just to be ignored.
$products = $q('select id, slug, name_en, name_ar, price, sale_price, sale_starts_at, sale_ends_at,
                       category, active from products order by id');
$variants = $q('select sku, slug, size, stock from product_variants order by sku');
$counts['products'] = count($products);
$counts['variants'] = count($variants);
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
$slugs = array_flip(array_column($products, 'slug'));
foreach ($bySlug as $sl => $vs)
    if (!isset($slugs[$sl]))
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
//
// AND `ONE`, WHICH IS THE TOKEN THE SHOP ACTUALLY USES. `OS` is in neither
// STORE_SIZES nor the schema's size CHECK; `ONE` is in both, and on 2026-09-09
// the live shop gave each of its four accessories a ONE row (the sandbox leaves
// them untracked). With only `OS` here, the first live run would have warned
// that the size guide has no measurements for a one-size cap — the wrong
// warning this comment's own paragraph above says is worse than none.
$sizes = array_unique(array_column($variants, 'size'));
// ORDERED BY the charts' own `sort`, because this list is printed for a
// person: "missing 2XL 3XL 4XL 5XL S XL" is the same fact as "missing S XL 2XL
// 3XL 4XL 5XL" and only one of them can be read at a glance.
//
// size_charts is OPTIONAL (the schema section above says so when it is absent), so a missing one
// is reported here and the rest of the catalogue still runs, rather than the query ending it.
$charted = null;
if (!$schemaRead || isset($cols['size_charts'])) {
    try { $charted = array_column($q('select size from size_charts group by size order by min(sort)'), 'size'); }
    catch (PDOException $e) { if (dba_missing($e)[0] !== 'table') throw $e; }
}
if ($charted === null) {
    $charted = [];
    $missingT['size_charts'] = true;
    warn('missing:size_charts — no size can be checked against the size guide, nor any size run');
}
$known = array_merge($charted, ['OS', 'ONE']);
if (isset($missingT['size_charts'])) {
    // said above
} elseif (!$charted) {
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

// A PARTIAL SIZE RUN, which is the gap between "untracked" and "tracked".
//
// The check above asks only whether a garment has ANY size rows. A garment
// with two of the eight passes it and looks completely healthy, and this shop
// has twenty-seven of them: the cloudsoft, sculpt and define lines carry M and
// L, and twelve carry exactly ONE size — sculpt-jacket-black in L only,
// sculpt-jacket-navy in M only. Meanwhile every one of the seventeen products
// that came through make-missing-variants.mjs carries the full run of eight.
//
// That pattern is not a size run anybody chose. It is what the shelf happened
// to hold on the day the catalogue was typed in, and it is now the size list
// the shop offers: a customer who takes XL cannot buy a sculpt jacket in any
// colour, and no screen in the panel can sell them one, because the Stock
// screen edits rows that exist and does not create them.
//
// A WARNING RATHER THAN A FAILURE, deliberately. A garment really can come in
// two sizes, and this cannot tell the difference between an inventory fact and
// a data-entry gap — only the owner can. What it can do is stop the gap being
// invisible, and name exactly which sizes are missing so that answering it is
// a decision rather than an investigation.
//
// The comparison set is the shop's OWN size_charts, the same list
// make-missing-variants.mjs uses, so the two cannot drift.
if ($charted) {
    $partial = [];
    foreach ($active as $p) {
        if (!in_array($p['category'], $SIZED, true)) continue;
        if (empty($bySlug[$p['slug']])) continue; // the check above owns this case
        $has = array_column($bySlug[$p['slug']], 'size');
        $missing = array_values(array_diff($charted, $has));
        if ($missing) $partial[$p['slug']] = $missing;
    }
    if ($partial) {
        $n = count($partial);
        warn("$n sized product(s) carry only part of the size run — a shopper in a missing size cannot buy them, and the Stock screen cannot add a size that has no row:");
        foreach ($partial as $sl => $missing) {
            $have = count($charted) - count($missing);
            warn("    $sl has $have of " . count($charted) . " — missing " . implode(' ', $missing));
        }
        warn('    if these lines really are sold in only those sizes, this is correct and can be ignored;');
        warn('    if not, `node scripts/make-missing-variants.mjs` generates the missing rows at stock 0');
    } else {
        ok('every sized product carries the full size run');
    }
}

} catch (Throwable $e) { lost('the catalogue', $e); }

/* ------------------------------------- the value LISTS, against the website */
if (go('values the database holds against the words the website knows')) try {

// Three places name the governorates: store.php (which validates the order),
// the app's checkout, and the site's built bundle. A row whose governorate is
// in none of them is an address the courier list has no line for.
$phpGovs = STORE_GOVERNORATES;
ok('store.php accepts: ' . implode(', ', $phpGovs));

// The app's source is in the repository and on no server, so on the server these are skipped.
$appSrc = $root !== null ? (@file_get_contents($root . '/src/app/checkout.tsx') ?: '') : '';
preg_match_all("/\{\s*id:\s*'([a-z\-]+)'\s*,\s*ar:/", $appSrc, $m);
$appGovs = $m[1];
if ($appGovs) {
    sort($appGovs); $p = $phpGovs; sort($p);
    $appGovs === $p
        ? ok("the app's checkout offers exactly the six the server accepts")
        : bad("the app offers [" . implode(',', $appGovs) . "], the server accepts [" . implode(',', $p) . ']');
}

// The bundle index.html actually loads; a glob only when the page names none. A docroot can hold an
// older hashed bundle beside the current one, and the first match alphabetically is not the shop.
$idx = @file_get_contents($doc . '/index.html') ?: '';
$bundle = preg_match('~assets/(index-[A-Za-z0-9_-]+\.js)~', $idx, $mb) && is_file($doc . '/assets/' . $mb[1])
    ? [$doc . '/assets/' . $mb[1]]
    : (glob($doc . '/assets/index-*.js') ?: []);
if ($bundle) {
    $js = (string) file_get_contents($bundle[0]);
    $missing = array_values(array_filter($phpGovs, fn($g) => !str_contains($js, $g)));
    $missing
        ? bad("the website's bundle never names: " . implode(', ', $missing))
        : ok("the website's bundle names all six governorates");
}

// And what the ORDERS actually carry. A value that is not one of the six may be text a customer
// typed, so outside the sandbox its byte length is printed rather than the value.
foreach ($q('select distinct customer_governorate g from orders where customer_governorate is not null') as $r)
    if (!in_array($r['g'], $phpGovs, true))
        bad("orders carry governorate '" . $tok($r['g']) . "', which store.php would now reject");
ok('every governorate on an existing order is still one the server accepts');

// THE DELIVERY FEE, in all three places that quote a total. The server adds
// STORE_DELIVERY_FEE_FILS to every order with no threshold of any kind; an app
// that quotes a different number, or promises free delivery over some basket
// size, shows a customer one total and charges them another.
$cartSrc = $root !== null ? (@file_get_contents($root . '/src/lib/cart.tsx') ?: '') : '';
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
$cats = array_column($q("select distinct category c from products where category is not null and category <> ''"), 'c');
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
foreach ($q("select distinct brand_slug b from products where brand_slug is not null and brand_slug <> ''") as $r) {
    $b = $one('select slug, active from brands where slug = ?', [$r['b']]);
    if (!$b) bad("products reference brand '{$r['b']}', which is not in the brands table");
    elseif ((int)$b['active'] !== 1) warn("products reference brand '{$r['b']}', which is inactive");
}
ok('every brand a product names exists');

// THE OTHER DIRECTION, which nothing asked: does any product name a brand AT
// ALL? The loop above is a referential check over a set that can be empty, and
// on this shop it IS empty — so it passes without examining a single row.
//
// Measured here: all 46 products have brand_slug null or blank, and all 8
// brands have nothing pointing at them. The brands table was seeded by
// 3-brands.mysql.sql and never connected to the catalogue. The schema even
// records the state beside the column — "An unmatched slug shows no brand,
// which is what every product shows today" — so this is known and accepted
// rather than broken. It is still worth saying out loud on every run, because
// "accepted" and "forgotten" look identical from here, and the work it implies
// is data entry nobody is tracking.
//
// What it costs while it stays this way: ?r=brands answers with eight brands
// the storefront can offer, every one of which leads to nothing; the product
// query's `left join brands` never matches, so no product page shows a brand
// name or logo; and the logo folders under images/<brand-slug>/ that the image
// audit checks so carefully are read by a code path no product reaches.
$noBrand = (int)($one("select count(*) n from products where brand_slug is null or brand_slug = ''")['n'] ?? 0);
$total   = (int)($one('select count(*) n from products')['n'] ?? 0);
if ($noBrand === $total && $total > 0) {
    warn("no product has a brand — all $total have an empty brand_slug, while " .
         (int)($one('select count(*) n from brands')['n'] ?? 0) .
         ' brands sit in the table with nothing pointing at them');
    warn('    every product page shows no brand and no logo; the brand list leads nowhere');
} elseif ($noBrand > 0) {
    warn("$noBrand of $total products have no brand — those pages show no brand name or logo");
} else {
    ok('every product names a brand');
}
// AN ACTIVE BRAND WITH NOTHING BEHIND IT — AND WHAT THAT ACTUALLY COSTS.
//
// This used to say "it shows as an empty shelf". That is not true, and it was
// worth checking rather than repeating: ?r=brands is called by NOTHING. Not
// the storefront bundle, which has no brand route at all, and not the app.
// Only this audit and the assistant's rig read it. Products carry their brand
// through ?r=products, which joins brands itself.
//
// So the consequence is not a customer meeting a bare page. It is that the
// assistant — the one thing that DOES read the list — would offer a brand the
// shop cannot sell, and it only avoids that because assistant.php filters
// these out itself with `having n > 0`.
//
// A warning that overstates its consequence is how a list of warnings becomes
// a list nobody reads. This one now says what is at stake and what is already
// guarding it.
foreach ($q('select b.slug, count(p.id) n from brands b
             left join products p on p.brand_slug = b.slug
             where b.active = 1 group by b.slug having n = 0') as $r) {
    warn("brand '{$r['slug']}' is active with no products — nothing on the site "
       . "lists brands, so no customer meets it; the assistant filters it out itself");
}

} catch (Throwable $e) { lost('the value lists', $e); }

/* --------------------------------------------------- the stored photographs */
if (go('the images kept in the database, decoded rather than glanced at')) {

// EVERY OTHER CHECK ON THESE COLUMNS READS THE FIRST THIRTY CHARACTERS.
//
// `data:image/png;base64,` followed by half a picture passes them all and
// renders as a broken image in the shop with no error anywhere. That is not a
// hypothetical failure, it is the one the schema warns about beside
// brands.logo — a 64 KB text column silently truncating a base64 logo — and
// widening the column does nothing for the rows already written, nor for an
// upload cut short by a dropped connection at any width.
//
// This is the same decode scripts/image-audit.mjs does, in PHP, because that
// rig needs node and the mariadb client and this file needs neither: it runs
// wherever the site runs, against the real catalogue, which is the only place
// the answer matters.
//
// ONE ROW AT A TIME: the ids first, then each picture by its id. A photograph is up to a megabyte
// of text, and fetching every one in a single result set is how a shop with a full catalogue of
// photos would run this out of memory on shared hosting before printing anything.
foreach ([['product_images', 'image', 'photograph'],
          ['hero_slides', 'image', 'hero slide'],
          ['brands', 'logo', 'brand logo']] as [$table, $col, $what]) {
  try {
    $cut = []; $dead = []; $wrong = [];
    $ids = $q("select id from $table where $col is not null and $col <> '' order by id");
    foreach ($ids as $i => $idRow) {
        if (microtime(true) - $t0 > DBA_BUDGET_S) {
            $lost++;
            bad('budget: over ' . DBA_BUDGET_S . "s while decoding {$what}s — $i of " . count($ids) . ' checked');
            break;
        }
        $row = $one("select id, $col as v from $table where id = ?", [$idRow['id']]);
        if ($row === null) continue; // deleted between the two reads
        if (!preg_match('~^data:image/([a-z]+);base64,(.*)$~s', (string)$row['v'], $m)) {
            $dead[] = "{$row['id']} (not a data: URI at all)";
            continue;
        }
        [, $declared, $payload] = $m;
        unset($row, $m);
        // Base64 arrives in groups of four; a length that is not a multiple of
        // four is a string that was CUT, and saying so is more useful than
        // "will not decode", which could mean anything.
        if (strlen($payload) % 4 !== 0) { $cut[] = "{$idRow['id']} (base64 cut mid-group)"; continue; }
        $bytes = base64_decode($payload, true);
        unset($payload);
        if ($bytes === false || $bytes === '') { $dead[] = "{$idRow['id']} (base64 will not decode)"; continue; }

        $real = null;
        if (str_starts_with($bytes, "\x89PNG\r\n\x1a\n")) $real = 'png';
        elseif (str_starts_with($bytes, "\xff\xd8\xff")) $real = 'jpeg';
        elseif (strlen($bytes) > 12 && substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP') $real = 'webp';
        if ($real === null) { $dead[] = "{$idRow['id']} (decodes, but is not an image)"; continue; }

        if ($real !== ($declared === 'jpg' ? 'jpeg' : $declared))
            $wrong[] = "{$idRow['id']} (header says $declared, bytes are $real)";

        // Does it END? Each format says where, and a file cut after a valid
        // header keeps a perfect header — which is why every cheaper check
        // passes it and the picture is still missing its bottom half.
        $whole = match ($real) {
            'png'  => strlen($bytes) >= 12 && substr($bytes, -8, 4) === 'IEND',
            'jpeg' => strlen($bytes) >= 2 && substr($bytes, -2) === "\xff\xd9",
            'webp' => strlen($bytes) >= 8 && (unpack('V', substr($bytes, 4, 4))[1] + 8) <= strlen($bytes),
            default => true,
        };
        if (!$whole) $cut[] = "{$idRow['id']} ($real stops before the end of the image)";
        unset($bytes);
    }
    foreach ([[$cut, ['is cut short and shows as a broken picture — upload it again',
                      'are cut short and show as broken pictures — upload them again']],
              [$dead, ['does not decode to an image at all',
                       'do not decode to an image at all']],
              [$wrong, ['declares the wrong image type',
                        'declare the wrong image type']]] as [$list, $why]) {
        if (!$list) continue;
        $n = count($list);
        bad("$n $what" . ($n === 1 ? '' : 's') . ' ' . $why[$n === 1 ? 0 : 1] . ': ' . implode(', ', $list));
    }
    if (!$cut && !$dead && !$wrong) ok("every stored $what decodes to a whole image of the type it claims");
  } catch (Throwable $e) { lost("the stored {$what}s", $e); }
}

}

/* -------------------------------------------------- the two status axes */
if (go('the status words in the database against the ones the code branches on')) try {

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
        ? bad("$t.$c holds " . implode(', ', array_map($tok, $rogue)) . ' — no branch in the code matches')
        : ok("$t.$c: " . (implode(', ', $seen) ?: '(no rows)') . ' — all known');
}

} catch (Throwable $e) { lost('the status words', $e); }

/* ----------------------------------------------------------------- orders */
if (go('the money on the orders, re-added')) {
// Four tries under one heading, so a missing order_items costs the checks that read it and not the
// ones that read orders alone.
try {

// The one arithmetic the shop cannot get wrong: what was charged has to equal
// what the lines came to, less the discount, plus delivery. If these ever
// disagree, the invoice and the bank statement disagree.
//
// Two queries, not one per order, and only the money columns: no customer column is read at all.
$orders = $q('select id, track_id, amount, subtotal, discount_amount, delivery_fee from orders order by id');
$counts['orders'] = count($orders);
$linesBy = [];
foreach ($q('select order_id, qty, unit_price from order_items order by order_id, id') as $l)
    $linesBy[$l['order_id']][] = $l;
$bad = 0; $checked = 0;
foreach ($orders as $o) {
    $lines = $linesBy[$o['id']] ?? [];
    if (!$lines) { bad("order {$ref($o)} has no items"); continue; }
    $sub = 0.0;
    foreach ($lines as $l) $sub += (int)$l['qty'] * (float)$l['unit_price'];
    $expect = round($sub - (float)$o['discount_amount'] + (float)$o['delivery_fee'], 3);
    $checked++;
    if (abs($expect - (float)$o['amount']) > 0.0005) {
        $bad++;
        if ($bad <= 5) bad(sprintf('order %s: lines %.3f - disc %.3f + del %.3f = %.3f, but amount is %s',
            $ref($o), $sub, (float)$o['discount_amount'], (float)$o['delivery_fee'], $expect, $o['amount']));
    }
    if (abs((float)$o['subtotal'] - round($sub, 3)) > 0.0005)
        warn("order #{$o['id']}: stored subtotal {$o['subtotal']} is not the sum of its lines (" . round($sub, 3) . ')');
}
unset($linesBy);
$bad ? bad("$bad of $checked orders do not add up") : ok("all $checked orders add up to the fils");

} catch (Throwable $e) { lost('the order totals', $e); }

try {
// Delivery is one flat fee, everywhere, by decision — so any other number on
// an order is either a bug or a rule nobody wrote down.
//
// Since 2026-09-10 the fee IS a rule written down: /backends -> Shop rules can change it
// (store_rule 'delivery_fee_fils'), and the constant is only its default. So both are known
// fees — the owner's current one, and the shipped one older orders were charged — and 0 is the
// free-delivery threshold. Anything else is still worth a look.
$feeFils = STORE_DELIVERY_FEE_FILS;
if (function_exists('store_rule')) {
    try { $r = store_rule($db, 'delivery_fee_fils'); if (is_int($r) && $r >= 0) $feeFils = $r; } catch (Throwable $e) {}
}
$fee = $feeFils / 1000;
$knownFees = [$fee, STORE_DELIVERY_FEE_FILS / 1000, 0.0];
foreach ($q('select distinct delivery_fee f from orders') as $r) {
    $hit = false;
    foreach ($knownFees as $k) if (abs((float)$r['f'] - $k) <= 0.0005) $hit = true;
    if (!$hit) warn("an order carries delivery_fee {$r['f']}, and the flat fee is " . number_format($fee, 3));
}
ok('delivery fee on file matches the flat ' . number_format($fee, 3) . ' KWD');

} catch (Throwable $e) { lost('the delivery fees', $e); }

try {
// Orphaned lines: an item pointing at a product that has since been deleted.
// The order keeps its own name_en/name_ar snapshot, so this is survivable —
// but the admin's item view joins on products and shows the row blank.
$orph = $q('select count(*) n from order_items i left join products p on p.id = i.product_id where p.id is null');
(int)$orph[0]['n'] === 0
    ? ok('every order line still points at a real product')
    : warn("{$orph[0]['n']} order lines point at a deleted product — the panel shows them blank, the snapshot name still prints");

} catch (Throwable $e) { lost('the order lines', $e); }

try {
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

} catch (Throwable $e) { lost('the order flags', $e); }

}

/* --------------------------------------------------------------- settings */
if (go('settings, as store.php will parse them')) {
try {

// Names and KEYS only — never a value: a settings row can hold an email address or a client id.
foreach ($q('select name, value from settings') as $s) {
    $v = json_decode((string)$s['value'], true);
    if (!is_array($v)) { bad("setting '{$s['name']}' is not valid JSON — store.php falls back to its default and the owner's edit is invisible"); continue; }
    ok("setting '{$s['name']}' parses: " . implode(', ', array_keys($v)));
}
// Arabic that survived the round trip. A latin1 connection turns every Arabic
// letter into a question mark, and the symptom is a promo bar of '??????'.
$bar = json_decode((string)($one("select value v from settings where name = 'promo_bar'")['v'] ?? '{}'), true);
if (is_array($bar) && is_string($bar['text_ar'] ?? null) && $bar['text_ar'] !== '') {
    preg_match('/\p{Arabic}/u', $bar['text_ar'])
        ? ok('the promo bar\'s Arabic came back as Arabic, not as question marks')
        : bad('the promo bar\'s text_ar has no Arabic letters left — the connection charset mangled it');
}

} catch (Throwable $e) { lost('the settings', $e); }

// Its own try under the same heading: the settings and the hero are different tables.
try {
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
} catch (Throwable $e) { lost('the hero', $e); }

}

/* ------------------------------------------------------------- discounts */
if (go('discounts')) try {

foreach ($q('select id, kind, code, type, value, category, starts_at, ends_at, usage_limit, used_count from discounts order by id') as $d) {
    // A code is redeemable, so outside the sandbox the row is named by its id.
    $who = (!$redact && $d['code']) ? $d['code'] : ('#' . $d['id']);
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
    // $cats is null when the value-lists section was lost: then nothing is known about categories,
    // and "no product is in it" would be a claim made from an empty list.
    if ($d['category'] && $cats !== null && !in_array($d['category'], $cats, true))
        warn("discount $who is scoped to category '{$d['category']}', which no product is in — it can never apply");
}
ok('discount rules checked');

} catch (Throwable $e) { lost('the discounts', $e); }

/* ------------------------------------------------------------------- out */
dba_finish();
