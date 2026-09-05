/**
 * The size rows the catalogue is missing — for garments with none, and for
 * garments with only part of the run.
 *
 *   node scripts/make-missing-variants.mjs > /tmp/missing-variants.sql
 *
 * db-audit.php reports two different faults, and they are not the same fault:
 *
 *   NO ROWS AT ALL. The server reads "no rows" as "this product is not size
 *   tracked", which is right for the backpack and the caps and wrong for a
 *   t-shirt: those are sold with no size recorded on the order, the invoice or
 *   the picking list. Accessories are excluded for exactly this reason.
 *
 *   PART OF THE RUN. The product has a size picker, but only M and L are in
 *   it. A shopper who takes an XL cannot buy the garment at all — and the
 *   Stock screen cannot help, because it edits rows and there is no row to
 *   edit. The size is not out of stock, it does not exist, and no one in the
 *   shop can make it exist without a database.
 *
 * The second is the quieter one. A product with no sizes looks broken and gets
 * noticed; a product missing 2XL looks completely normal to everyone except
 * the customer who wanted 2XL, and they simply leave.
 *
 * WHAT THIS INVENTS: nothing.
 *
 *   The SIZES come from the shop's own size_charts table — S to 5XL, the same
 *   list both the unisex and the women's chart define, and the same list the
 *   website's size picker already shows for every product.
 *
 *   The STOCK is 0 on every new row, because a stock count is a fact about a
 *   shelf in Kuwait and nothing here knows it. Zero is the only honest number
 *   and it is also the safe one: a product cannot be oversold at zero, and
 *   the owner types the real counts into the panel's Stock screen, which
 *   already reads and writes exactly these rows.
 *
 *   The COST is inherited for a partial run and left NULL otherwise. A
 *   garment's cost does not change with its size — every partial product here
 *   carries one cost across its existing rows — so copying it is a fact the
 *   table already holds. Where there are no rows there is nothing to copy.
 *
 * WHAT CHANGES FOR A CUSTOMER, and it differs by case:
 *
 *   FOR A PARTIAL RUN, nothing changes today. The sizes that were buyable stay
 *   buyable at the counts they already have; the missing ones appear in the
 *   picker as out of stock instead of being absent. This is purely additive,
 *   which is why it is safe to run on a live shop in the middle of a day.
 *
 *   FOR A PRODUCT WITH NO ROWS, it becomes unbuyable until the owner enters
 *   counts. That is the trade and it is deliberate: an order for a t-shirt in
 *   no size cannot be fulfilled, so taking the money for one is worse than not
 *   taking it. If the shop would rather hide those until it has counts, the
 *   file ends with the alternative as a commented-out UPDATE — scoped to those
 *   products only, never to the partial ones, which are selling perfectly well
 *   in the sizes they have.
 *
 * SKUs. set_stock keys on the sku, so a duplicate would be worse than a
 * missing row: it would silently move a different product's count.
 *
 *   FOR A PARTIAL RUN the prefix is READ FROM THE PRODUCT'S OWN ROWS rather
 *   than generated, because generation would not reproduce it. The existing
 *   prefixes are not a single shape — A-CSL-AR has a three-letter product code
 *   and A-SJ-NA has two — so a generated A-SCJ-NA-XL would sit in the table
 *   next to A-SJ-NA-M as though it belonged to something else. Stripping the
 *   trailing size off a sku the shop already uses is the only way to stay in
 *   the family. If a product's rows disagree about their own prefix, it is
 *   skipped and named rather than guessed at.
 *
 *   FOR A PRODUCT WITH NO ROWS there is nothing to read, so the prefix is
 *   derived from the slug — A-<PRODUCT>-<COLOUR>-<SIZE>, e.g. A-CSJ-AR-L —
 *   and widened until it collides with nothing already present.
 */
import { execFileSync } from 'node:child_process'

const sql = (q) =>
  execFileSync('mariadb', ['-uroot', 'sporta', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()

const rowsOf = (q) => sql(q).split('\n').filter(Boolean).map((l) => l.split('\t'))

const SIZES = sql("select distinct size from size_charts order by sort").split('\n').filter(Boolean)
const taken = new Set(sql('select sku from product_variants').split('\n').filter(Boolean))

// Products with nothing at all. Accessories are left out: no rows is the
// correct description of a cap.
const rows = rowsOf(`
  select p.slug, p.category from products p
  left join product_variants v on v.slug = p.slug
  where p.active = 1 and v.slug is null and p.category <> 'accessories'
  order by p.category, p.slug`)

// Products with some of the run. No accessories filter is needed here and
// none is wanted: a product that already has sized rows is a sized product,
// whatever its category says.
const partialRows = rowsOf(`
  select p.slug, p.category, count(v.sku)
  from products p join product_variants v on v.slug = p.slug
  where p.active = 1
  group by p.slug, p.category having count(v.sku) < ${SIZES.length}
  order by p.category, p.slug`)

// Every existing row, so a product's own prefix and cost can be read back.
const have = new Map()   // slug -> { sizes:Set, prefixes:Set, costs:Set }
for (const [slug, sku, size, cost] of rowsOf(
  'select slug, sku, size, ifnull(cost_aed, "") from product_variants')) {
  if (!have.has(slug)) have.set(slug, { sizes: new Set(), prefixes: new Set(), costs: new Set() })
  const h = have.get(slug)
  h.sizes.add(size)
  h.costs.add(cost)
  // The prefix is the sku with its own size taken off the end — not a fixed
  // number of segments, because the product code is two letters on some and
  // three on others.
  h.prefixes.add(sku.endsWith(`-${size}`) ? sku.slice(0, -(size.length + 1)) : '')
}

// A product whose rows disagree about their prefix has something going on that
// this script should not paper over — two ranges merged under one slug, or a
// sku typed by hand. Name it and leave it.
const skipped = []

// The slug's leading words name the product, the trailing one names the
// colour — the same split the existing skus were built on.
const code = (words, n) => words.join('').replace(/[^a-z]/gi, '').toUpperCase().slice(0, n).padEnd(n, 'X')
const skuFor = (slug, size) => {
  const parts = slug.split('-')
  const colour = parts.length > 1 ? parts.slice(-1) : ['X']
  const product = parts.length > 1 ? parts.slice(0, -1) : parts
  let base = `A-${code(product, 3)}-${code(colour, 2)}`
  let sku = `${base}-${size}`
  // Two slugs can shorten to the same code (flash-shorts-green and
  // flash-shorts-red do not, but tekno-shorts-black and tekno-shorts-royal
  // could). Widen the colour code until it is unique rather than hand-waving.
  let widen = 2
  while (taken.has(sku)) {
    widen += 1
    if (widen > 8) { sku = `${base}-${size}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`; break }
    base = `A-${code(product, 3)}-${code(colour, widen)}`
    sku = `${base}-${size}`
  }
  taken.add(sku)
  return sku
}

// --- the partial runs, first, because they are the safe half ---------------
const partialSql = []
let partialCount = 0
for (const [slug, category] of partialRows) {
  const h = have.get(slug)
  const prefixes = [...h.prefixes].filter(Boolean)
  if (prefixes.length !== 1) {
    skipped.push(`${slug} — its ${h.sizes.size} row(s) do not share one sku prefix `
      + `(${[...h.prefixes].map((p) => p || '(size not in sku)').join(', ')})`)
    continue
  }
  const prefix = prefixes[0]
  const missing = SIZES.filter((s) => !h.sizes.has(s))
  if (!missing.length) continue

  // One cost across the product's rows means the size does not change it, so
  // the new rows carry it too. Anything else and NULL is the honest answer.
  const costs = [...h.costs].filter((c) => c !== '')
  const cost = costs.length === 1 && costs[0] !== '' ? costs[0] : null

  // A prefix collision here would mean the sku already exists, in which case
  // INSERT IGNORE leaves it alone — but say so rather than emit it silently.
  const clash = missing.filter((s) => taken.has(`${prefix}-${s}`))

  partialSql.push(`-- ${slug}  (${category})  has ${[...h.sizes].join(' ')}`
    + ` — adding ${missing.join(' ')}`
    + (cost ? `, cost ${cost} from its own rows` : `, cost unknown`))
  if (clash.length) partialSql.push(`--   note: ${clash.join(' ')} already exist under this prefix; left alone.`)
  partialSql.push(`insert ignore into product_variants (sku, slug, size, stock, cost_aed) values`)
  partialSql.push(missing.map((s) =>
    `  ('${prefix}-${s}', '${slug}', '${s}', 0, ${cost ?? 'null'})`).join(',\n') + ';')
  partialSql.push(``)
  partialCount += missing.length
  for (const s of missing) taken.add(`${prefix}-${s}`)
}

// --- the ones with nothing --------------------------------------------------
const emptySql = []
for (const [slug, category] of rows) {
  emptySql.push(`-- ${slug}  (${category})`)
  emptySql.push(`insert ignore into product_variants (sku, slug, size, stock, cost_aed) values`)
  emptySql.push(SIZES.map((s) => `  ('${skuFor(slug, s)}', '${slug}', '${s}', 0, null)`).join(',\n') + ';')
  emptySql.push(``)
}

const out = []
out.push(`-- Sporta — the size rows the catalogue is missing.`)
out.push(`--`)
out.push(`-- GENERATED by scripts/make-missing-variants.mjs. Safe to re-run: every`)
out.push(`-- statement is INSERT IGNORE, so a row that already exists is left alone`)
out.push(`-- and nothing is overwritten. It does not touch orders, prices or stock`)
out.push(`-- counts that already exist.`)
out.push(`--`)
out.push(`-- STOCK IS 0 ON EVERY NEW ROW. Nothing here knows what is on the shelf, and`)
out.push(`-- a guess would be worse than a zero: at zero the shop simply says "out of`)
out.push(`-- stock" and cannot oversell. Enter the real counts in /backends -> Stock,`)
out.push(`-- which reads and writes exactly these rows.`)
out.push(`--`)
out.push(`-- Sizes: ${SIZES.join(', ')} — from this shop's own size_charts table.`)
out.push(``)
out.push(`-- PART ONE — ${partialRows.length - skipped.length} products missing part of the run,`)
out.push(`-- ${partialCount} rows. This half changes nothing a customer can see today: the`)
out.push(`-- sizes already on sale keep their counts, and the missing ones appear as out`)
out.push(`-- of stock instead of being absent. Safe to run on a live shop mid-day.`)
out.push(`--`)
out.push(`-- PART TWO — ${rows.length} products with no rows at all, ${rows.length * SIZES.length} rows.`)
out.push(`-- This half MAKES THOSE PRODUCTS UNBUYABLE until counts are entered, because`)
out.push(`-- today they sell with no size recorded on the order or the picking list.`)
out.push(`-- Read the note above part two before running it.`)
if (skipped.length) {
  out.push(`--`)
  out.push(`-- SKIPPED, needing a person rather than a script:`)
  for (const s of skipped) out.push(`--   ${s}`)
}
out.push(``)
out.push(`set names utf8mb4;`)
out.push(``)
out.push(`-- ---------------------------------------------------------------------`)
out.push(`-- PART ONE: the partial runs. Additive; nothing on sale is touched.`)
out.push(`-- ---------------------------------------------------------------------`)
out.push(``)
out.push(...partialSql)
out.push(`-- ---------------------------------------------------------------------`)
out.push(`-- PART TWO: the products with no size rows at all.`)
out.push(`--`)
out.push(`-- THIS TAKES THEM OFF SALE until the Stock screen has counts for them, and`)
out.push(`-- that is the point: an order for a t-shirt in no size cannot be picked or`)
out.push(`-- posted, so taking the money for one is worse than not taking it. If you`)
out.push(`-- would rather they stayed on sale as they are, do not run part two.`)
out.push(`-- ---------------------------------------------------------------------`)
out.push(``)
out.push(...emptySql)

out.push(`-- ---------------------------------------------------------------------`)
out.push(`-- THE ALTERNATIVE TO PART TWO, if you would rather hide those products`)
out.push(`-- until you have counts. Run this INSTEAD of part two, not as well. They`)
out.push(`-- come back by setting active = 1 again.`)
out.push(`--`)
out.push(`-- It does NOT list the partial-run products. Those are selling in the sizes`)
out.push(`-- they have and there is no reason to take them off the shelf.`)
out.push(`--`)
out.push(`-- update products set active = 0 where slug in (`)
out.push(rows.map(([s], i) => `--   '${s}'${i === rows.length - 1 ? '' : ','}`).join('\n'))
out.push(`-- );`)

console.log(out.join('\n'))
