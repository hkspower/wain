// AUTO-HIDE of incomplete products (owner, 2026-11-18: "make auto hide any products without price 0 and sku and name and image").
// The rule lives in dropin/php-store/product-listable.php and every public reader of the catalogue goes through it.
//
//   npm run test:product-listing      (php CLI + an in-memory SQLite database; no MariaDB, no network)
//
// Asserted:
//   - the rule itself: a product is listed only with a name (English or Arabic), a price above zero, at least one size row with a SKU and a photo
//     (the image / images column, or a file named after the slug); each missing part is reported by name, in a fixed order; a sale price never
//     rescues a missing base price; blank, zero, negative and non-numeric prices all hide;
//   - the switches: the SKU and photo rules are ON unless the config says EXACTLY false for their key; "false", 0, null, a missing key and true
//     keep them on (a typo can never show an incomplete product); the two switches are independent; name and price have no switch;
//   - the resolver path: loaded by the sitemap or the SEO head (no store_config()), the same config file is read and honoured;
//   - the helpers: store_filter_listable() keeps order and drops hidden rows, store_listable_slugs() answers the active listed products only;
//   - the readers: the product list, the brand tiles, the public stock list, the assistant, the SEO product page and the sitemap all go
//     through the rule (checked in the source), a brand left with no listed product is not offered, and the order path refuses a nameless or
//     free product by hand while a missing photo or SKU alone does not stop an order;
//   - the admin's products_all carries `hidden_reasons` and `listed`;
//   - MUTATIONS: with the SKU clause cut, the photo clause cut, the price clause cut, or the default flipped back to OFF, the matching check goes red.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 62 - t.length))}`)
const probe = spawnSync('php', ['-r', 'echo extension_loaded("pdo_sqlite") ? "ok" : "no";'], { encoding: 'utf8' })
if (probe.error || probe.stdout !== 'ok') { console.log('SKIP php with pdo_sqlite is not available'); process.exit(0) }

const SRC = readFileSync(join(ROOT, 'dropin/php-store/product-listable.php'), 'utf8')
const read = (f) => readFileSync(join(ROOT, 'dropin/php-store', f), 'utf8')

// Runs `body` (PHP) with the rule file copied to <tmp>/api/product-listable.php, an in-memory database holding the products / variants below,
// photo files <tmp>/images/products/<name> for each of `photos`, and `$CFG` as the store config. Returns the JSON the body echoes.
function php({ src = SRC, cfg = '[]', photos = [], resolver = null, body }) {
  const d = mkdtempSync(join(tmpdir(), 'sporta-listing-'))
  try {
    mkdirSync(join(d, 'api'), { recursive: true }); mkdirSync(join(d, 'images/products'), { recursive: true })
    for (const p of photos) writeFileSync(join(d, 'images/products', p), 'x')
    writeFileSync(join(d, 'api/product-listable.php'), src)
    const prelude = resolver === null
      ? `$CFG = ${cfg}; function store_config(): array { global $CFG; return $CFG; }`
      : `function sporta_config_path(string $kind, string $fallback): string { return ${JSON.stringify(resolver)}; }`
    writeFileSync(join(d, 'run.php'), `<?php
declare(strict_types=1);
${prelude}
require __DIR__ . '/api/product-listable.php';
$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$db->exec("create table products (id integer primary key, slug text, name_en text, name_ar text, price text, image text, images text, active integer, brand_slug text)");
$db->exec("create table product_variants (sku text primary key, slug text, size text, stock integer)");
function P(PDO $db, string $slug, array $o = []): array {
    $row = array_merge(['slug' => $slug, 'name_en' => 'Name ' . $slug, 'name_ar' => '', 'price' => '5.000', 'image' => '', 'images' => '', 'active' => 1, 'brand_slug' => null], $o);
    $db->prepare('insert into products (slug, name_en, name_ar, price, image, images, active, brand_slug) values (?,?,?,?,?,?,?,?)')
       ->execute([$row['slug'], $row['name_en'], $row['name_ar'], $row['price'], $row['image'], $row['images'], $row['active'], $row['brand_slug']]);
    return $row;
}
function V(PDO $db, string $slug, string $sku, string $size = 'M'): void { $db->prepare('insert into product_variants (sku, slug, size, stock) values (?,?,?,5)')->execute([$sku, $slug, $size]); }
${body}
`)
    const o = spawnSync('php', [join(d, 'run.php')], { encoding: 'utf8' })
    if (o.status !== 0) return { error: (o.stderr || o.stdout).slice(0, 400) }
    return JSON.parse(o.stdout)
  } finally { rmSync(d, { recursive: true, force: true }) }
}
const J = JSON.stringify

// ===================================================================================================== 1. the rule
head('the rule: name, price, SKU, photo')
const RULE = `
$rows = [];
$rows['ok']        = P($db, 'ok', ['image' => '/images/products/ok.jpg']);          V($db, 'ok', 'OK-M');
$rows['file']      = P($db, 'file');                                                  V($db, 'file', 'FILE-M');   // photo is a file by the slug
$rows['views']     = P($db, 'views');                                                 V($db, 'views', 'VIEWS-M'); // <slug>-view-2.png counts
$rows['imgs']      = P($db, 'imgs', ['images' => '["/images/products/imgs.webp"]']);  V($db, 'imgs', 'IMGS-M');
$rows['ar']        = P($db, 'ar', ['name_en' => '', 'name_ar' => 'اسم', 'image' => 'x.jpg']); V($db, 'ar', 'AR-M');
$rows['noname']    = P($db, 'noname', ['name_en' => '  ', 'name_ar' => '', 'image' => 'x.jpg']); V($db, 'noname', 'NN-M');
$rows['zero']      = P($db, 'zero', ['price' => '0.000', 'image' => 'x.jpg']);        V($db, 'zero', 'ZERO-M');
$rows['blank']     = P($db, 'blank', ['price' => '', 'image' => 'x.jpg']);            V($db, 'blank', 'BLANK-M');
$rows['neg']       = P($db, 'neg', ['price' => '-3', 'image' => 'x.jpg']);            V($db, 'neg', 'NEG-M');
$rows['text']      = P($db, 'text', ['price' => 'abc', 'image' => 'x.jpg']);          V($db, 'text', 'TEXT-M');
$rows['nosku']     = P($db, 'nosku', ['image' => 'x.jpg']);                           // no size row at all
$rows['emptysku']  = P($db, 'emptysku', ['image' => 'x.jpg']);                        V($db, 'emptysku', '');
$rows['nophoto']   = P($db, 'nophoto');                                               V($db, 'nophoto', 'NP-M');
$rows['allgone']   = P($db, 'allgone', ['name_en' => '', 'price' => '0']);            // nothing at all
$rows['sale']      = P($db, 'sale', ['price' => '0', 'image' => 'x.jpg']);            V($db, 'sale', 'SALE-M'); $rows['sale']['sale_price'] = '2.500';
$rows['inactive']  = P($db, 'inactive', ['active' => 0, 'image' => 'x.jpg']);         V($db, 'inactive', 'IN-M');
$photos = store_product_photo_slugs(array_keys($rows));
$skus = store_product_sku_slugs($db, array_keys($rows));
$out = [];
foreach ($rows as $k => $r) $out[$k] = store_product_hidden_reasons($r, $photos, $skus);
echo json_encode($out);
`
const rule = php({ photos: ['file.jpg', 'views-view-2.png', 'nophoto.txt', 'emptysku.jpg'], body: RULE })
if (rule.error) is(false, 'the rule runs', rule.error)
else {
  const want = { ok: [], file: [], views: [], imgs: [], ar: [], noname: ['name'], zero: ['price'], blank: ['price'], neg: ['price'], text: ['price'], nosku: ['sku'], emptysku: ['sku'], nophoto: ['photo'], allgone: ['name', 'price'], sale: ['price'], inactive: [] }
  want.allgone = ['name', 'price', 'sku', 'photo']
  for (const [k, w] of Object.entries(want)) is(J(rule[k]) === J(w), `${k}: ${w.length ? 'hidden for ' + w.join(' + ') : 'listed'}`, J(rule[k]))
}
{
  const r = php({ photos: ['a.jpg'], body: `
$a = P($db, 'a'); V($db, 'a', 'A-M');
$b = P($db, 'b'); V($db, 'b', 'B-M');
$ph = store_product_photo_slugs(['a', 'b']); $sk = store_product_sku_slugs($db, ['a', 'b']);
echo json_encode([store_product_listable($a, $ph, $sk), store_product_listable($b, $ph, $sk), store_product_listable($b, $ph), store_product_hidden_reasons($b, $ph)]);` })
  is(J(r) === J([true, false, false, ['photo']]), 'listable = no reasons; with no SKU list given (a caller with no database) the SKU rule is skipped and the photo rule still holds', J(r))
}

// ===================================================================================================== 2. the switches
head('the switches: ON unless the config says exactly false')
const SW = `
$p = P($db, 'sw'); // no photo, no SKU
$ph = store_product_photo_slugs(['sw']); $sk = store_product_sku_slugs($db, ['sw']);
echo json_encode(store_product_hidden_reasons($p, $ph, $sk));`
for (const [cfg, want, label] of [
  ['[]', ['sku', 'photo'], 'no key at all'],
  ["['hide_products_without_photo' => true, 'hide_products_without_sku' => true]", ['sku', 'photo'], 'both true'],
  ["['hide_products_without_photo' => 'false', 'hide_products_without_sku' => 'false']", ['sku', 'photo'], 'the strings "false"'],
  ["['hide_products_without_photo' => 0, 'hide_products_without_sku' => 0]", ['sku', 'photo'], 'the number 0'],
  ["['hide_products_without_photo' => null, 'hide_products_without_sku' => null]", ['sku', 'photo'], 'null'],
  ["['hide_products_without_photo' => false]", ['sku'], 'photo => false turns only the photo rule off'],
  ["['hide_products_without_sku' => false]", ['photo'], 'sku => false turns only the SKU rule off'],
  ["['hide_products_without_photo' => false, 'hide_products_without_sku' => false]", [], 'both false: both off'],
]) { const r = php({ cfg, body: SW }); is(!r.error && J(r) === J(want), `${label}: ${want.length ? 'hidden for ' + want.join(' + ') : 'listed'}`, r.error || J(r)) }
{
  const r = php({ cfg: "['hide_products_without_photo' => false, 'hide_products_without_sku' => false]", body: `
$a = P($db, 'a', ['name_en' => '', 'name_ar' => '']); $b = P($db, 'b', ['price' => '0']);
echo json_encode([store_product_hidden_reasons($a, [], []), store_product_hidden_reasons($b, [], [])]);` })
  is(J(r) === J([['name'], ['price']]), 'name and price have no switch: they hide even with both switches off', J(r))
}

head('the resolver path (sitemap and SEO head load no store_config())')
{
  const d = mkdtempSync(join(tmpdir(), 'sporta-listing-cfg-'))
  try {
    writeFileSync(join(d, 'off.php'), "<?php return ['hide_products_without_photo' => false, 'hide_products_without_sku' => false];")
    writeFileSync(join(d, 'on.php'), "<?php return ['db_host' => 'x'];")
    const body = `$p = P($db, 'sw'); echo json_encode(store_product_hidden_reasons($p, [], store_product_sku_slugs($db, ['sw'])));`
    const off = php({ resolver: join(d, 'off.php'), body }), on = php({ resolver: join(d, 'on.php'), body }), none = php({ resolver: join(d, 'missing.php'), body })
    is(J(off) === J([]), 'the config file the resolver names is read: both switches false = listed', J(off))
    is(J(on) === J(['sku', 'photo']), 'a config with no switches = both rules on', J(on))
    is(J(none) === J(['sku', 'photo']), 'a config file that is not there = both rules on (never a shop that shows everything)', J(none))
  } finally { rmSync(d, { recursive: true, force: true }) }
}

// ===================================================================================================== 3. the helpers
head('the helpers')
{
  const r = php({ photos: ['b.jpg', 'c.jpg', 'e.jpg'], body: `
P($db, 'a'); V($db, 'a', 'A-M');                              // no photo
P($db, 'b'); V($db, 'b', 'B-M');                              // listed
P($db, 'c');                                                  // no SKU
P($db, 'd', ['active' => 0]); V($db, 'd', 'D-M');             // inactive
P($db, 'e'); V($db, 'e', 'E-M');                              // listed
$rows = $db->query('select slug, name_en, name_ar, price, image, images from products where active = 1')->fetchAll();
echo json_encode([array_column(store_filter_listable($db, $rows), 'slug'), array_keys(store_listable_slugs($db)), store_filter_listable($db, [])]);` })
  is(J(r) === J([['b', 'e'], ['b', 'e'], []]), 'store_filter_listable keeps the listed rows in order; store_listable_slugs answers active listed slugs only', J(r))
}
{
  const r = php({ cfg: "['hide_products_without_sku' => false, 'hide_products_without_photo' => false]", body: `
P($db, 'a'); P($db, 'b', ['price' => '0']);
$rows = $db->query('select slug, name_en, name_ar, price, image, images from products')->fetchAll();
echo json_encode(array_column(store_filter_listable($db, $rows), 'slug'));` })
  is(J(r) === J(['a']), 'with both switches off the helper still drops a free product and needs no variants table query', J(r))
}

// ===================================================================================================== 4. the readers
head('every public reader of the catalogue goes through the rule')
{
  const api = read('api.php'), ass = read('assistant.php'), seo = read('seo-page.php'), site = read('sitemap-products.php'), store = read('store.php'), admin = read('admin.php')
  const block = (src, start, end) => { const a = src.indexOf(start); return a < 0 ? '' : src.slice(a, src.indexOf(end, a)) }
  is(/store_filter_listable\(\$db, \$rows\)/.test(block(api, "if ($r === 'products')", "if ($r === 'slides')")), 'r=products: store_filter_listable')
  is(/store_filter_listable\(\$db,/.test(block(api, "if ($r === 'brands')", "if ($r === 'stock')")) && /\$n < 1\) continue/.test(block(api, "if ($r === 'brands')", "if ($r === 'stock')")), 'r=brands: counts only listed products and leaves a brand with none out')
  is(/store_listable_slugs\(\$db\)/.test(block(api, "if ($r === 'stock')", "if ($r === 'status')")), 'r=stock: only the variants of listed products')
  is(/store_filter_listable\(\$db, \$rows\)/.test(block(ass, 'function assistant_catalogue', 'assistant_vocab()')) && /p\.image, p\.images/.test(block(ass, 'function assistant_catalogue', 'assistant_vocab()')), 'the assistant recommends only listed products (and reads their photo columns)')
  is(/store_filter_listable\(\$db, \[\$product\]\) === \[\]/.test(seo) && /image, images, price/.test(seo), 'the SEO product head: an unlisted product is the same 404 the app shows')
  is(/store_product_sku_slugs\(\$db/.test(site) && /store_product_listable\(\$r, \$photos, \$skus\)/.test(site), 'the sitemap: the same rule, with the SKU list')
  const lines = block(store, 'function store_price_lines', '// A datetime from the admin')
  is(/trim\(\(string\)\$prod\['name_en'\]\) === '' && trim\(\(string\)\$prod\['name_ar'\]\) === ''\) store_fail\('unavailable_'/.test(lines) && /\(float\)\$prod\['price'\] <= 0\) store_fail\('unavailable_'/.test(lines), 'the order path refuses a nameless or free product named by hand (unavailable_<slug>)')
  is(!/hidden_reasons|sku_slugs|photo_slugs/.test(lines), 'a missing photo or SKU does not stop an order (display rule only)')
  is(/'hidden_reasons'\] = store_product_hidden_reasons/.test(admin) && /\['listed'\] = \(int\)\$row\['active'\] === 1/.test(admin), "the admin's products_all carries hidden_reasons and listed")
  const all = ['api.php', 'assistant.php', 'seo-page.php', 'sitemap-products.php', 'admin.php', 'store.php']
  is(all.every((f) => !/store_product_listable\(\$r, \$photoSlugs\)\)/.test(read(f))), 'no reader still calls the old two-argument rule')
}

// ===================================================================================================== 5. mutations
head('mutations: with one clause cut, the check goes red')
{
  const cut = (from, to) => { const s = SRC.replace(from, to); return s === SRC ? null : s }
  const check = (src) => php({ src, photos: [], body: `
P($db, 'a', ['image' => 'x']); // no SKU
P($db, 'b'); V($db, 'b', 'B-M');  // no photo
P($db, 'c', ['price' => '0', 'image' => 'x']); V($db, 'c', 'C-M');
echo json_encode([store_product_hidden_reasons($db->query("select * from products where slug='a'")->fetch(), [], store_product_sku_slugs($db, ['a','b','c'])),
                  store_product_hidden_reasons($db->query("select * from products where slug='b'")->fetch(), [], store_product_sku_slugs($db, ['a','b','c'])),
                  store_product_hidden_reasons($db->query("select * from products where slug='c'")->fetch(), [], store_product_sku_slugs($db, ['a','b','c']))]);` })
  const base = check(SRC)
  is(J(base) === J([['sku'], ['photo'], ['price']]), 'the unmutated file gives sku / photo / price for the three probes', J(base))
  for (const [label, text, expect] of [
    ['the SKU clause cut', cut("if ($skuSlugs !== null && store_hide_products_without_sku() && !isset($skuSlugs[(string)($row['slug'] ?? '')])) $why[] = 'sku';", ''), [[], ['photo'], ['price']]],
    ['the photo clause cut', cut("&& !isset($photoSlugs[(string)($row['slug'] ?? '')])) $why[] = 'photo';", "&& false) $why[] = 'photo';"), [['sku'], [], ['price']]],
    ['the price clause cut', cut("if (!(is_numeric($row['price'] ?? null) && (float)$row['price'] > 0)) $why[] = 'price';", ''), [['sku'], ['photo'], []]],
    ['the default flipped back to OFF', cut("return !(is_array($c) && array_key_exists($key, $c) && $c[$key] === false);", "return is_array($c) && ($c[$key] ?? false) === true;"), [[], [], ['price']]],
  ]) {
    if (text === null) { is(false, `mutation "${label}": the cut text was found`); continue }
    const got = check(text)
    is(J(got) === J(expect), `mutation "${label}": the probes change exactly as expected`, J(got))
    is(J(got) !== J(base), `mutation "${label}": so the check above goes red`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
