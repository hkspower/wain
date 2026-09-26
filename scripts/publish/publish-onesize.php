<?php
/**
 * Give the four accessories a one-size row, so they are TRACKED.
 *
 *   php /home/<user>/publish-onesize.php
 *
 * WHY. live-scan reported `nosize=4` on 2026-09-09:
 *
 *   cagliari-calcio-backpack, cagliari-calcio-backpack-navy,
 *   denver-nuggets-cap-navy, gymshark-phone-strap
 *
 * A garment with no `product_variants` rows has no size for a shopper to pick
 * — and, more to the point, `store_stock_claim()` SKIPS a slug with no rows by
 * design, so the product is stock-UNTRACKED and nothing would stop an order
 * for a hundred of them. A one-size row at stock 0 fixes both: the shop shows
 * one size and reads out of stock, and the count is enforced from then on.
 *
 * The owner asked for stock 0 rather than a guess at what is on the shelf. The
 * real number goes in /backends, which is where stock belongs.
 *
 * 'ONE' IS NOT INVENTED. It is the last entry of STORE_SIZES in api/store.php,
 * the same constant `variant_save` validates against and the checkout uses, so
 * a row written here is editable in /backends and orderable at checkout. It is
 * three characters, which matters: `size` is varchar(4) and "One Size" would
 * not fit — the schema is why the token is what it is.
 *
 * THE SKU IS DERIVED EXACTLY AS variant_save() DERIVES IT —
 * `strtoupper(substr($slug, 0, 26) . '-' . $size)` — and that is the whole
 * reason this script can be run at all. Get it wrong and /backends would write
 * a SECOND row for the same garment and size, leaving two ladders where the
 * shop shows one.
 *
 * WHY IT IS SAFE TO FETCH AND RUN. It comes over plain HTTP from a PUBLIC
 * repository:
 *
 *   - Four slugs, hardcoded. No parameter, no input, nothing derived from a
 *     request. It cannot be pointed at another product.
 *   - It refuses a slug that is not an existing, single product.
 *   - `on duplicate key update sku = sku` — A NO-OP. Re-running it can never
 *     reset a stock count the owner has since typed in. That idiom is here
 *     because IMPORT-THIS-ONE.sql once carried `update ... stock = values(...)`
 *     and reset a hand-priced product to its seed value.
 *   - It writes no files, deletes nothing, and touches no other table.
 */

$ROOT = '/home/u130124229/domains/sporta.com.kw/public_html';

$SLUGS = [
    'cagliari-calcio-backpack',
    'cagliari-calcio-backpack-navy',
    'denver-nuggets-cap-navy',
    'gymshark-phone-strap',
];

$cfg = @include $ROOT . '/api/config.php';
if (!is_array($cfg)) { echo "ONESIZE failed=no-config\n"; exit; }

try {
    $db = new PDO(
        'mysql:host=' . $cfg['db_host'] . ';dbname=' . $cfg['db_name'] . ';charset=utf8mb4',
        (string) $cfg['db_user'], (string) $cfg['db_pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (Throwable $e) {
    echo "ONESIZE failed=no-db\n";
    exit;
}

$made = 0; $already = 0; $noProduct = [];

$exists = $db->prepare('select 1 from products where slug = ?');
$has    = $db->prepare('select 1 from product_variants where slug = ?');
$ins    = $db->prepare(
    // 'ONE' and 0 are literals, not placeholders: there is exactly one size
    // this script may write and exactly one stock count, and binding them
    // would imply otherwise. (The first version bound three and passed two,
    // which PDO rejected outright — caught on the sandbox, which is the only
    // reason it was never pointed at the live database.)
    'insert into product_variants (sku, slug, size, stock, cost_aed)
          values (?, ?, \'ONE\', 0, null)
     on duplicate key update sku = sku'          // NO-OP: never touches stock
);

foreach ($SLUGS as $slug) {
    $exists->execute([$slug]);
    if (!$exists->fetch()) { $noProduct[] = $slug; continue; }

    // Already has a ladder of any kind? Then this script has no business here:
    // the owner may have added real sizes since, and a one-size row beside
    // them would be a second, meaningless choice on the page.
    $has->execute([$slug]);
    if ($has->fetch()) { $already++; continue; }

    $sku = strtoupper(substr($slug, 0, 26) . '-ONE');
    $ins->execute([$sku, $slug]);
    $made++;
}

// Read back what is actually there, rather than trusting the counters — the
// insert reports success for a no-op too.
$left = (int) $db->query(
    'select count(*) from products p
      where p.active = 1
        and not exists (select 1 from product_variants v where v.slug = p.slug)'
)->fetchColumn();

echo 'ONESIZE made=' . $made . ' alreadyHadSizes=' . $already
   . ' noSuchProduct=' . (count($noProduct) ? implode(',', $noProduct) : '0')
   . ' productsStillWithoutSizes=' . $left . "\n";
