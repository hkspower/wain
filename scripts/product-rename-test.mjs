/**
 * Renaming a product carries EVERYTHING that hangs off its slug — and nothing is left under the old one.
 *
 *   bash scripts/sandbox.sh            # MariaDB must be up; the rig copies the sandbox, never writes it
 *   node scripts/product-rename-test.mjs
 *
 * WHAT BROKE. product_save lets the owner edit a product's slug, and every table keyed on the slug has
 * to be moved with it, because none of them has a foreign key that would. The move list was three
 * tables (photos, sizes, size advice) and its comment called that "the list information_schema gives
 * for a slug column". By 2026-10-08 the schema had four more: colour and fits (product_attrs), the
 * product's own search title and description (product_seo), the stock history (stock_log), and the
 * home banner's product (home_banner.product) — plus the sitemap's excluded products, a list of slugs
 * inside the `crawl` settings row. Rename a product and all of those stayed behind, unreachable.
 *
 * WHAT THIS HOLDS, against a SCRATCH COPY of the shop (scripts/scratch-shop.mjs): the move touches two
 * singleton owner rows (home_banner, settings.crawl) that a rig must not borrow on the shared sandbox,
 * and the mutations below are written into a COPY of admin.php that only the scratch server serves.
 *
 *   A. A fixture product built through the real panel routes — product_save, product_attrs_save,
 *      variant_save (which writes the stock_log line), seo_product_save, settings_save(crawl) — plus SQL
 *      for the three things no route writes on its own (a photo row, a size-advice row, the banner),
 *      and a LEFTOVER product_seo and product_attrs row already sitting under the new slug. Renamed
 *      through product_save; then every piece is required under the new slug with its values intact
 *      (the leftover replaced, not adopted), the SKUs unchanged, and NOTHING under the old slug in any
 *      slug-shaped column the generated schema manifest knows of.
 *   B. THE LIST CANNOT GO STALE QUIETLY. Every column a fully-migrated install has whose name is `slug`,
 *      ends in `_slug`, or is `product` (read from the GENERATED manifest in
 *      scripts/live/live-schema-full.php, so a table added tomorrow is seen the day it lands) must be in
 *      admin_product_slug_refs() or in NOT_A_PRODUCT_SLUG below. The parse is asserted to find the list.
 *   C. A missing optional table does not break a rename: with product_seo moved aside, a rename still
 *      lands and carries everything else.
 *   D. A slug too long for a column a row must move into is refused BY NAME, and nothing moves.
 *   E. MUTATIONS, each in the copy of admin.php, each required to make a named check fail:
 *      every entry of the move list dropped in turn (seven), the crawl move removed, the leftover
 *      delete removed, the missing-table guard removed, the case guard on the leftover delete removed.
 *   F. A case-only rename (`ABC` -> `abc`; the columns are _ci, so the two are equal) keeps the
 *      product's own one-row-per-product rows instead of deleting them as "leftovers".
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { scratchShop, adminClient, schemaManifest } from './scratch-shop.mjs'

const ADMIN_PHP_REPO = new URL('../sporta-site/public_html/api/admin.php', import.meta.url).pathname

// Slug-shaped columns that hold something OTHER than a product's own slug. A rename must not touch them.
const NOT_A_PRODUCT_SLUG = new Set([
  'brands.slug',          // a brand's own slug
  'products.slug',        // the product row itself — product_save's own update moves it
  'products.brand_slug',  // which brand made it: points at brands.slug
])

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? ' — ' + extra : ''}`)
}

function parseRefs(src) {
  const m = src.match(/function admin_product_slug_refs\(\): array \{([\s\S]*?)\n\}/)
  if (!m) return []
  return [...m[1].matchAll(/\['(\w+)',\s*'(\w+)',\s*(true|false)\]/g)].map((x) => ({ table: x[1], col: x[2], one: x[3] === 'true' }))
}

function slugShapedColumns() {
  const out = []
  for (const [t, def] of Object.entries(schemaManifest())) {
    for (const c of Object.keys(def.cols || {})) {
      if (c === 'slug' || c.endsWith('_slug') || c === 'product' || c === 'product_slug') out.push(`${t}.${c}`)
    }
  }
  return out
}

const shop = await scratchShop('rename')
const q = (s) => s.replace(/'/g, "''")
const one = (sql) => shop.sql(sql).trim().split('\n')[0] ?? ''
const count = (table, col, slug) => Number(one(`select count(*) from \`${table}\` where \`${col}\` = '${q(slug)}'`))

/**
 * Builds a fixture under OLD, renames it to NEW, and returns the checks as [{name, ok, extra}] without
 * printing them — the main run prints them, a mutation run asks which ones failed.
 */
async function scenario(call, tag) {
  const out = []
  const c = (ok, name, extra = '') => out.push({ ok: !!ok, name, extra })
  const OLD = `aaa-rename-rig-${tag}-old`
  const NEW = `aaa-rename-rig-${tag}-new`
  const other = one(`select slug from products where slug not like 'aaa-rename-rig-%' order by id limit 1`)

  const made = await call('product_save', { id: 0, slug: OLD, name_en: 'Rename rig', name_ar: 'اختبار إعادة التسمية', price: 5, active: 0 })
  const id = made.body?.id
  c(made.status === 200 && id, 'fixture product created through product_save', made.text.slice(0, 160))
  const attrs = await call('product_attrs_save', { slug: OLD, colour: 'black', fits: ['slim'], sizes: ['M', 'L'] })
  c(attrs.status === 200, 'colour, fits and two sizes saved through product_attrs_save', attrs.text.slice(0, 160))
  const stock = await call('variant_save', { slug: OLD, size: 'M', stock: 7 })
  c(stock.status === 200, 'stock saved through variant_save (which writes the stock_log line)', stock.text.slice(0, 160))
  const seo = await call('seo_product_save', { slug: OLD, title_en: 'Rig title', title_ar: 'عنوان', desc_en: 'Rig desc', desc_ar: 'وصف' })
  c(seo.status === 200, 'search text saved through seo_product_save', seo.text.slice(0, 160))
  const crawl = await call('settings_save', { name: 'crawl', value: {
    sections: { pages: true, categories: true, products: true }, custom: [], exclude: [OLD, other], block: [], disallow: [] } })
  c(crawl.status === 200, 'the product excluded from the sitemap through settings_save(crawl)', crawl.text.slice(0, 160))
  shop.sql(`insert into product_images (slug, sort, image, image_hash) values ('${OLD}', 0, 'data:image/png;base64,iVBORw0KGgo=', sha2('${OLD}', 256))`)
  shop.sql(`insert into size_advice_log (slug, size, confidence) values ('${OLD}', 'M', 'high')`)
  shop.sql(`insert into home_banner (id, enabled, product) values (1, 0, '${OLD}') on duplicate key update product = values(product), enabled = 0`)
  // Leftovers under the NEW slug, which no product owns: the product's own rows must replace them.
  shop.sql(`insert into product_seo (slug, title_en) values ('${NEW}', 'LEFTOVER')`)
  shop.sql(`insert into product_attrs (slug, colour) values ('${NEW}', 'red')`)

  const skusBefore = shop.sql(`select sku from product_variants where slug = '${OLD}' order by sku`).trim()
  const before = {
    product_images: count('product_images', 'slug', OLD), product_variants: count('product_variants', 'slug', OLD),
    size_advice_log: count('size_advice_log', 'slug', OLD), stock_log: count('stock_log', 'slug', OLD),
    product_attrs: count('product_attrs', 'slug', OLD), product_seo: count('product_seo', 'slug', OLD),
    home_banner: count('home_banner', 'product', OLD),
  }
  c(Object.values(before).every((n) => n > 0), 'every fixture landed under the old slug before the rename', JSON.stringify(before))

  const ren = await call('product_save', { id, slug: NEW, name_en: 'Rename rig', name_ar: 'اختبار إعادة التسمية', price: 5, active: 0 })
  c(ren.status === 200 && ren.body?.slug === NEW, 'the rename answers 200 with the new slug', ren.text.slice(0, 200))

  const cols = { product_images: 'slug', product_variants: 'slug', size_advice_log: 'slug', stock_log: 'slug',
    product_attrs: 'slug', product_seo: 'slug', home_banner: 'product' }
  for (const [t, col] of Object.entries(cols)) {
    const left = count(t, col, OLD)
    const moved = count(t, col, NEW)
    c(left === 0 && moved === before[t], `${t}: everything moved to the new slug, nothing left under the old`,
      `old=${left} new=${moved} expected=${before[t]}`)
  }
  const a = shop.rows(`select colour, fits from product_attrs where slug = '${NEW}'`)[0]
  c(a && a.colour === 'black' && a.fits === 'slim', 'product_attrs: the product\'s own colour and fits, not the leftover', JSON.stringify(a))
  const s = shop.rows(`select title_en, desc_ar from product_seo where slug = '${NEW}'`)[0]
  c(s && s.title_en === 'Rig title' && s.desc_ar === 'وصف', 'product_seo: the product\'s own search text, not the leftover', JSON.stringify(s))
  const st = shop.rows(`select size, stock from product_variants where slug = '${NEW}' and size = 'M'`)[0]
  c(st && st.stock === '7', 'product_variants: the stock count travelled with the size', JSON.stringify(st))
  const skusAfter = shop.sql(`select sku from product_variants where slug = '${NEW}' order by sku`).trim()
  c(skusBefore !== '' && skusAfter === skusBefore, 'the SKUs did NOT change (labels, suppliers and purchase orders find a size by it)', `${skusBefore} -> ${skusAfter}`)
  const ex = JSON.parse(one(`select value from settings where name = 'crawl'`) || '{}').exclude || []
  c(ex.includes(NEW) && !ex.includes(OLD) && ex.includes(other) && ex.length === 2,
    'settings.crawl: the sitemap exclusion follows the product, and the other excluded product is untouched', JSON.stringify(ex))
  const api = await call('product_attrs')
  c(api.body?.rows?.[NEW]?.colour === 'black' && !api.body?.rows?.[OLD], 'the panel\'s own product_attrs read finds the colour under the new slug', JSON.stringify(api.body?.rows?.[NEW]))

  // Nothing under the old slug in ANY slug-shaped column the schema has — not only the ones listed.
  const leftovers = []
  for (const tc of slugShapedColumns()) {
    if (NOT_A_PRODUCT_SLUG.has(tc)) continue
    const [t, col] = tc.split('.')
    let n = 0
    try { n = count(t, col, OLD) } catch { continue }   // a table this sandbox does not have
    if (n) leftovers.push(`${tc}=${n}`)
  }
  c(leftovers.length === 0, 'no slug-shaped column anywhere in the schema still holds the old slug', leftovers.join(' '))
  return { out, OLD, NEW, id }
}

async function cleanupFixture(OLD, NEW) {
  for (const s of [OLD, NEW]) {
    shop.sql(`delete from product_images where slug = '${s}'; delete from product_variants where slug = '${s}';
      delete from size_advice_log where slug = '${s}'; delete from stock_log where slug = '${s}';
      delete from product_attrs where slug = '${s}'; delete from product_seo where slug = '${s}';
      delete from home_banner where product = '${s}'; delete from products where slug = '${s}'`)
  }
}

const original = readFileSync(shop.apiDir + '/admin.php', 'utf8')
function mutateCopy(from, to) {
  const src = readFileSync(shop.apiDir + '/admin.php', 'utf8')
  if (typeof from === 'string' ? !src.includes(from) : !from.test(src)) return false
  writeFileSync(shop.apiDir + '/admin.php', src.replace(from, to))
  return true
}
const restoreCopy = () => writeFileSync(shop.apiDir + '/admin.php', original)

try {
  shop.sql('delete from rate_limit; delete from rate_bucket')
  const call = await adminClient(shop.base)

  /* ---------------------------------------------------------------- A */
  const main = await scenario(call, 'a')
  for (const r of main.out) check(r.ok, 'A ' + r.name, r.extra)
  await cleanupFixture(main.OLD, main.NEW)

  /* ---------------------------------------------------------------- B */
  const refs = parseRefs(readFileSync(ADMIN_PHP_REPO, 'utf8'))
  check(refs.length >= 7, 'B the move list parses out of admin.php (admin_product_slug_refs)', `found ${refs.length}`)
  const listed = new Set(refs.map((r) => `${r.table}.${r.col}`))
  const shaped = slugShapedColumns()
  check(shaped.length >= 8, 'B the schema manifest yields the slug-shaped columns', `found ${shaped.length}`)
  const undecided = shaped.filter((tc) => !listed.has(tc) && !NOT_A_PRODUCT_SLUG.has(tc))
  check(undecided.length === 0, 'B every slug-shaped column in the schema is either moved on rename or declared not a product slug', undecided.join(' '))
  const stale = [...listed].filter((tc) => !shaped.includes(tc))
  check(stale.length === 0, 'B every entry of the move list exists in the schema', stale.join(' '))
  for (const r of refs) {
    const pk = shop.sql(`select group_concat(column_name) from information_schema.columns where table_schema = database() and table_name = '${r.table}' and column_key = 'PRI'`).trim()
    check(r.one === (pk === r.col), `B ${r.table}: "one row per product" is true exactly when the slug is the whole primary key`, `pk=${pk} one=${r.one}`)
  }

  /* ---------------------------------------------------------------- C */
  {
    shop.sql('rename table product_seo to product_seo_aside_rig')
    try {
      const made = await call('product_save', { id: 0, slug: 'aaa-rename-rig-c-old', name_en: 'Rig C', name_ar: 'ج', price: 5, active: 0 })
      await call('product_attrs_save', { slug: 'aaa-rename-rig-c-old', colour: 'navy', fits: [], sizes: ['S'] })
      const ren = await call('product_save', { id: made.body?.id, slug: 'aaa-rename-rig-c-new', name_en: 'Rig C', name_ar: 'ج', price: 5, active: 0 })
      check(ren.status === 200 && ren.body?.slug === 'aaa-rename-rig-c-new', 'C with product_seo missing, a rename still lands', ren.text.slice(0, 160))
      check(count('product_attrs', 'slug', 'aaa-rename-rig-c-new') === 1 && count('product_variants', 'slug', 'aaa-rename-rig-c-new') === 1,
        'C and still carries the tables that do exist', `attrs=${count('product_attrs', 'slug', 'aaa-rename-rig-c-new')} variants=${count('product_variants', 'slug', 'aaa-rename-rig-c-new')}`)
    } finally {
      shop.sql('rename table product_seo_aside_rig to product_seo')
      await cleanupFixture('aaa-rename-rig-c-old', 'aaa-rename-rig-c-new')
    }
  }

  /* ---------------------------------------------------------------- D */
  // 77 characters: fits products.slug (80), not product_seo.slug (64).
  async function tooLong(tag) {
    const OLD = `aaa-rename-rig-${tag}-old`
    const LONG = `aaa-rename-rig-${tag}-` + 'x'.repeat(77 - `aaa-rename-rig-${tag}-`.length)
    const made = await call('product_save', { id: 0, slug: OLD, name_en: 'Rig D', name_ar: 'د', price: 5, active: 0 })
    await call('seo_product_save', { slug: OLD, title_en: 'D title', title_ar: '', desc_en: '', desc_ar: '' })
    const ren = await call('product_save', { id: made.body?.id, slug: LONG, name_en: 'Rig D', name_ar: 'د', price: 5, active: 0 })
    const res = { refused: ren.status === 400 && ren.body?.error === 'slug_too_long', text: ren.text.slice(0, 160),
      untouched: count('products', 'slug', OLD) === 1 && count('product_seo', 'slug', OLD) === 1 }
    await cleanupFixture(OLD, LONG)
    return res
  }
  {
    const d = await tooLong('d')
    check(d.refused, 'D a slug too long for product_seo.slug is refused by name', d.text)
    check(d.untouched, 'D and nothing moved: the product and its search text are still under the old slug')
  }

  /* ---------------------------------------------------------------- F */
  // A CASE-ONLY RENAME. Every slug column is utf8mb4_unicode_ci, so `ABC` = `abc`. A product whose slug
  // was hand-edited in uppercase and then saved through the panel (store_slug lowercases it) is a rename
  // to a slug that MATCHES its own rows — and the leftover delete for the one-row-per-product tables
  // removed the product's own colour and search text before moving nothing. Measured before the fix:
  // attrs 0, seo 0. Fixture written by SQL because no route can store an uppercase slug.
  async function caseOnly(tag) {
    const UP = `AAA-RENAME-RIG-${tag}`.toUpperCase()
    const low = UP.toLowerCase()
    shop.sql(`insert into products (slug, name_en, name_ar, price, active) values ('${UP}', 'Rig F', 'و', 5, 0)`)
    const id = Number(one(`select id from products where slug = '${UP}' collate utf8mb4_bin`))
    shop.sql(`insert into product_attrs (slug, colour, fits) values ('${UP}', 'navy', 'slim')`)
    shop.sql(`insert into product_seo (slug, title_en) values ('${UP}', 'Rig F title')`)
    const ren = await call('product_save', { id, slug: low, name_en: 'Rig F', name_ar: 'و', price: 5, active: 0 })
    const bin = (t) => one(`select count(*) from \`${t}\` where slug = '${low}' collate utf8mb4_bin`)
    const res = { ok200: ren.status === 200 && ren.body?.slug === low, text: ren.text.slice(0, 160),
      attrs: one(`select colour from product_attrs where slug = '${low}' collate utf8mb4_bin`), seo: one(`select title_en from product_seo where slug = '${low}' collate utf8mb4_bin`),
      lower: bin('product_attrs') === '1' && bin('product_seo') === '1' }
    await cleanupFixture(UP, low)
    return res
  }
  {
    const f = await caseOnly('f')
    check(f.ok200, 'F a case-only rename (ABC -> abc) answers 200', f.text)
    check(f.attrs === 'navy' && f.seo === 'Rig F title' && f.lower,
      'F and keeps the product\'s own colour and search text, now under the lowercase slug', JSON.stringify(f))
  }

  /* ---------------------------------------------------------------- E */
  const refsCopy = parseRefs(original)
  for (const [i, r] of refsCopy.entries()) {
    const line = new RegExp(`\\n\\s*\\['${r.table}',\\s*'${r.col}',\\s*(true|false)\\],[^\\n]*`)
    if (!mutateCopy(line, '')) { check(false, `E mutation fixture found: ${r.table}`); continue }
    try {
      const m = await scenario(call, 'm' + i)
      const failed = m.out.filter((x) => !x.ok).map((x) => x.name)
      check(failed.some((n) => n.startsWith(`${r.table}:`)),
        `E MUTATION CAUGHT: dropping ${r.table}.${r.col} from the move list fails "${r.table}: everything moved…"`, failed.join(' | ') || 'no check failed')
      const guard = parseRefs(readFileSync(shop.apiDir + '/admin.php', 'utf8'))
      const shapedNow = slugShapedColumns().filter((tc) => !new Set(guard.map((g) => `${g.table}.${g.col}`)).has(tc) && !NOT_A_PRODUCT_SLUG.has(tc))
      check(shapedNow.includes(`${r.table}.${r.col}`), `E and the schema guard names ${r.table}.${r.col} as undecided`, shapedNow.join(' '))
      await cleanupFixture(m.OLD, m.NEW)
    } finally { restoreCopy() }
  }

  const more = [
    ['the crawl move', "store_setting_save($db, 'crawl', $crawl);", '/* MUTATED */', (f) => f.some((n) => n.startsWith('settings.crawl'))],
    ['the leftover delete', '$db->prepare("delete from `$t` where `$c` = ? and `$c` <> ?")->execute([$slug, $oldSlug]);', '/* MUTATED */', (f) => f.some((n) => n.startsWith('the rename answers 200'))],
  ]
  for (const [label, from, to, caught] of more) {
    if (!mutateCopy(from, to)) { check(false, `E mutation fixture found: ${label}`); continue }
    try {
      const m = await scenario(call, 'x' + label.length)
      const failed = m.out.filter((x) => !x.ok).map((x) => x.name)
      check(caught(failed), `E MUTATION CAUGHT: without ${label}`, failed.join(' | ') || 'no check failed')
      await cleanupFixture(m.OLD, m.NEW)
    } finally { restoreCopy() }
  }
  if (!mutateCopy("if ($has->fetchColumn()) store_fail('slug_too_long');", '/* MUTATED */')) check(false, 'E mutation fixture found: slug width check')
  else {
    try {
      const d = await tooLong('e2')
      check(!d.refused, 'E MUTATION CAUGHT: without the width check the too-long slug is no longer refused by name', d.text)
    } finally { restoreCopy() }
  }
  {
    // The missing-table guard: without it, a shop lacking product_seo cannot rename anything.
    if (!mutateCopy('if (!isset($widths["$t.$c"])) continue;', '/* MUTATED */')) check(false, 'E mutation fixture found: missing-table guard')
    else {
      shop.sql('rename table product_seo to product_seo_aside_rig')
      try {
        const made = await call('product_save', { id: 0, slug: 'aaa-rename-rig-e-old', name_en: 'Rig E', name_ar: 'هـ', price: 5, active: 0 })
        const ren = await call('product_save', { id: made.body?.id, slug: 'aaa-rename-rig-e-new', name_en: 'Rig E', name_ar: 'هـ', price: 5, active: 0 })
        check(ren.status !== 200, 'E MUTATION CAUGHT: without the missing-table guard a shop lacking product_seo cannot rename', `${ren.status} ${ren.text.slice(0, 120)}`)
      } finally {
        restoreCopy()
        shop.sql('rename table product_seo_aside_rig to product_seo')
        await cleanupFixture('aaa-rename-rig-e-old', 'aaa-rename-rig-e-new')
      }
    }
  }
  {
    // The case guard: a bare delete of the new slug removes the product's own row on a case-only rename.
    if (!mutateCopy('where `$c` = ? and `$c` <> ?")->execute([$slug, $oldSlug]);', 'where `$c` = ?")->execute([$slug]);')) check(false, 'E mutation fixture found: case guard')
    else {
      try {
        const f = await caseOnly('e3')
        check(!(f.attrs === 'navy' && f.seo === 'Rig F title'), 'E MUTATION CAUGHT: without the case guard a case-only rename deletes the product\'s own colour and search text', JSON.stringify(f))
      } finally { restoreCopy() }
    }
  }
} finally {
  restoreCopy()
  await shop.stop()
}

console.log(fails === 0
  ? '\nall ok — a renamed product takes its photos, sizes, stock history, colour, search text, banner and sitemap exclusion with it, and the list cannot go stale unnoticed'
  : `\n${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
