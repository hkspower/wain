// npm run test:catalog-feed — api/catalog-feed.php, the Meta / Instagram Shopping feed (2026-10-04).
//
// The expected values come from ?r=products (what the shop itself shows and charges), never from the
// feed's own code. A fresh sandbox has no photographs, and the feed rightly leaves those garments out,
// so the rig plants three real PNG photographs (marked by their hash) and removes exactly those after;
// it also puts one product on sale and switches one product's stock to zero, and restores both.
import { execFileSync } from 'node:child_process'
import zlib from 'node:zlib'

const BASE = process.env.BASE || 'http://127.0.0.1:4300'
const sql = (q) => execFileSync('mariadb', ['-uroot', 'sporta', '--default-character-set=utf8mb4', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, d = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d && !ok ? '   ' + d : ''}`) }

function png() {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1 } return ~c >>> 0 }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(10, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.concat(Array.from({ length: 10 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(24, 200)])))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
function parseCsv(t) {
  const rows = []; let row = [], cell = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const MARK = 'c'.repeat(64)
const picked = sql("select slug from products where active = 1 and slug like '%-%' order by slug limit 3").split('\n')
const [onSale, , soldOut] = picked
const hadSale = sql(`select coalesce(sale_price,'NULL') from products where slug='${onSale}'`)
const hadStock = sql(`select concat(sku,':',stock) from product_variants where slug='${soldOut}'`).split('\n').filter(Boolean)
try {
  sql(`delete from product_images where image_hash='${MARK}'`)
  const P = png()
  for (const s of picked) sql(`insert into product_images (slug, sort, image, image_hash, image_w, image_h) values ('${s}', 9999, 'data:image/png;base64,${P}', '${MARK}', 8, 10)`)
  sql(`update products set sale_price = price - 1, sale_starts_at = null, sale_ends_at = null where slug='${onSale}'`)
  sql(`update product_variants set stock = 0 where slug='${soldOut}'`)

  const api = await (await fetch(`${BASE}/api/api.php?r=products`)).json()
  const bySlug = Object.fromEntries(api.map((p) => [p.slug, p]))
  const res = await fetch(`${BASE}/api/catalog-feed.php`)
  const text = await res.text()
  check(res.status === 200 && /text\/csv/.test(res.headers.get('content-type') || ''), 'the feed answers 200 as CSV', `${res.status} ${res.headers.get('content-type')}`)
  check(!res.headers.get('set-cookie'), 'it sets no cookie')
  const rows = parseCsv(text).filter((r) => r.length > 1)
  const head = rows.shift() || []
  for (const c of ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand', 'item_group_id']) check(head.includes(c), `Meta's required column "${c}" is present`)
  const col = (r, c) => r[head.indexOf(c)]
  const ids = rows.map((r) => col(r, 'id'))
  // Every photographed active product, and only those (a fresh sandbox may have others' photos too).
  const photographed = sql("select distinct i.slug from product_images i join products p on p.slug = i.slug and p.active = 1").split('\n').filter(Boolean).sort()
  check(rows.length >= 3, 'the feed is not empty — a rig that finds nothing proves nothing', String(rows.length))
  check(JSON.stringify([...ids].sort()) === JSON.stringify(photographed), 'one row per photographed active garment, and none without a photo', `${ids.length} vs ${photographed.length}`)
  check(rows.every((r) => r.length === head.length), 'every row has every column')
  for (const r of rows) {
    const p = bySlug[col(r, 'id')]
    if (!p) { check(false, `${col(r, 'id')} is a product the shop shows`); continue }
    const list = (p.list_price ?? p.price).toFixed(3) + ' KWD'
    check(col(r, 'price') === list, `${p.slug}: price is the shop's list price`, `${col(r, 'price')} vs ${list}`)
    check(col(r, 'sale_price') === (p.on_sale ? p.price.toFixed(3) + ' KWD' : ''), `${p.slug}: sale_price is the charged price only while on sale`, col(r, 'sale_price'))
    check(/^https:\/\/www\.sporta\.com\.kw\/product\//.test(col(r, 'link')) && /^https:\/\/www\.sporta\.com\.kw\/api\/api\.php\?r=product_image&id=\d+/.test(col(r, 'image_link')), `${p.slug}: link and image are absolute public URLs`)
    check(col(r, 'title') === p.name_en, `${p.slug}: the English title is the shop's English name`, col(r, 'title'))
  }
  const sale = rows.find((r) => col(r, 'id') === onSale)
  check(sale && col(sale, 'sale_price') !== '' && col(sale, 'sale_price') !== col(sale, 'price'), 'a product on sale carries a sale_price under its price', sale && `${col(sale, 'price')} / ${col(sale, 'sale_price')}`)
  const out = rows.find((r) => col(r, 'id') === soldOut)
  check(out && col(out, 'availability') === 'out of stock', 'a garment with no stock in any size is "out of stock"', out && col(out, 'availability'))
  check(rows.filter((r) => r !== out).every((r) => ['in stock', 'out of stock'].includes(col(r, 'availability'))), 'availability is always one of Meta\'s two words')
  check(!/stock_count|cost|qty/i.test(head.join(',')), 'no count, cost or quantity column')
  const grouped = rows.find((r) => /-/.test(col(r, 'id')) && col(r, 'color'))
  check(!grouped || col(grouped, 'id').startsWith(col(grouped, 'item_group_id') + '-'), 'item_group_id is the style: the slug without its colour', grouped && `${col(grouped, 'id')} -> ${col(grouped, 'item_group_id')}`)

  const ar = parseCsv(await (await fetch(`${BASE}/api/catalog-feed.php?lang=ar`)).text()).filter((r) => r.length > 1)
  const arHead = ar.shift()
  const arRow = ar.find((r) => r[arHead.indexOf('id')] === picked[0])
  check(arRow && /[؀-ۿ]/.test(arRow[arHead.indexOf('title')]) && !/lang=en/.test(arRow[arHead.indexOf('link')]), 'the Arabic feed has Arabic titles and Arabic links', arRow && arRow[arHead.indexOf('title')])

  const tag = res.headers.get('etag')
  const again = await fetch(`${BASE}/api/catalog-feed.php`, { headers: { 'If-None-Match': `W/${tag}` } })
  check(!!tag && again.status === 304, 'it answers its own (even weakened) ETag with 304', `${tag} ${again.status}`)
} finally {
  sql(`delete from product_images where image_hash='${MARK}'`)
  sql(hadSale === 'NULL' ? `update products set sale_price = NULL where slug='${onSale}'` : `update products set sale_price = ${hadSale} where slug='${onSale}'`)
  for (const v of hadStock) { const [sku, st] = v.split(':'); sql(`update product_variants set stock = ${Number(st)} where sku = '${sku.replace(/'/g, '')}'`) }
}
console.log(fails ? `\n${fails} failed` : '\nall ok — a Meta catalogue feed that agrees with the shop')
process.exit(fails ? 1 : 0)
