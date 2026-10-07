/**
 * Colour circles and size boxes on every product-grid card — assets/card-options.js and the
 * three new fields of ?r=products (colour from the slug, style_key, size_options), 2026-10-03.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/card-options-test.mjs                 (BASE=http://127.0.0.1:4310 for another server)
 *   ONLY=A,C1 node scripts/card-options-test.mjs       (sections: A, B, C1..C9)
 *   PAGES=shop,product DEVICES=phone LANGS=en ...      (narrow section B while mutation-testing)
 *
 * THE OWNER'S FOUR CHOICES, each asserted on what a shopper gets rather than on markup:
 *   1. every size the product has, as small boxes; a sold-out size greyed, struck through, inert
 *   2. one filled round circle per colour of the same style, the card's own ringed; a tap on
 *      another opens that colour's page
 *   3. name, then colours, then sizes, then the price row (the + at its right) — painted order
 *   4. one tap on a size adds THAT size to the bag
 *
 * IT MAKES ITS OWN FIXTURES. The sandbox catalogue has few variants and no sold-out size, so a
 * rig that only looked would find nothing to grey out and pass. Seven products whose slugs start
 * `aaa-cardopt-` are written (and swept before, and again in `finally`): a style of three colours
 * where one slug's colour (onyx-black) also ends in another key (black), a sold-out size, a
 * duplicate SKU row for one size, a size the shop does not offer (XS), an INACTIVE sibling that
 * must not appear, a product_attrs colour that must beat the slug, and a product with nothing.
 *
 * SINCE THE FIRST REVIEW (2026-10-03), four more things a shopper meets, each asserted here:
 *   - every size box is EXACTLY 28px tall: an older rule gave any button whose label holds
 *     "الكمية" a 36px minimum, and the Arabic "sold out" holds it, so sold-out boxes hung 8px low;
 *   - across a row of cards the name, colour, size and price rows start level, whatever the
 *     names, the number of size lines or a missing colour row (the card is a subgrid);
 *   - two DIFFERENT sizes tapped in quick succession on one card are two adds;
 *   - a circle carries the PAGE's language, so an English shopper lands on an English page
 *     from the bundle's own cards too (their links carry no ?lang=en);
 * and two about cost: each row holds nothing but its circles or boxes (no inner elements), and
 * a card /shop loads while scrolling already has its rows when the browser first styles it.
 *
 * IT REFUSES TO PASS ON NOTHING: a dead sandbox, a colour list that parsed empty (two empty lists
 * compare equal), a page with no boxes on it, or a fixture card that was never found all FAIL by
 * name. The expected values come from the API JSON and from STORE_COLOURS parsed out of store.php
 * by this file's own regex — never from card-options.js, which is the thing under test.
 */
import { chromium, devices } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean)
const want = (sec) => !ONLY.length || ONLY.some((o) => sec === o || sec.startsWith(o))
const listEnv = (k, all) => (process.env[k] ? process.env[k].split(',').map((s) => s.trim()) : all)
const ROOT = new URL('..', import.meta.url).pathname
const sql = (q) => execFileSync('mariadb', ['-uroot', '--default-character-set=utf8mb4', 'sporta', '-N', '-e', q], { encoding: 'utf8' }).trim()
let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra && !ok ? '   ' + extra : ''}`)
  return ok
}
const refuse = (why) => { console.log(`REFUSED: ${why}`); process.exit(2) }

// ── preflight ────────────────────────────────────────────────────────────────
try { sql('delete from rate_limit; delete from rate_bucket') } catch (e) { refuse('could not clear rate_limit: ' + String(e.message || e).split('\n')[0]) }
const rows0 = await fetch(`${BASE}/api/api.php?r=products`).then((r) => r.json()).catch(() => null)
if (!Array.isArray(rows0) || rows0.length < 10) refuse(`?r=products returned ${Array.isArray(rows0) ? rows0.length + ' rows' : 'nothing'} at ${BASE} — is the sandbox up? (bash scripts/sandbox.sh)`)

// STORE_COLOURS, read out of store.php by THIS file — the oracle must not be the code under test.
const storeSrc = readFileSync(ROOT + 'sporta-site/public_html/api/store.php', 'utf8')
const block = (storeSrc.match(/const STORE_COLOURS = \[([\s\S]*?)\n\];/) || [])[1] || ''
const COLOURS = {}
for (const m of block.matchAll(/'([a-z][a-z-]*)'\s*=>\s*\['([^']*)',\s*'([^']*)',\s*'(#[0-9a-fA-F]{6})'\]/g)) COLOURS[m[1]] = { en: m[2], ar: m[3], hex: m[4].toLowerCase() }
if (Object.keys(COLOURS).length < 15) refuse(`only ${Object.keys(COLOURS).length} STORE_COLOURS keys parsed out of store.php — the parse is broken, and an empty list agrees with everything`)
const LONGEST = Object.keys(COLOURS).sort((a, b) => b.length - a.length)
const suffixOf = (slug) => { for (const k of LONGEST) if (slug.length > k.length + 1 && slug.endsWith('-' + k)) return k; return null }
const rigStyle = (slug) => { const k = suffixOf(slug); return k ? slug.slice(0, -(k.length + 1)) : null }
const SIZES_ALL = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE']

// ── fixtures ─────────────────────────────────────────────────────────────────
const P = 'aaa-cardopt-'
const ONYX = P + 'tee-onyx-black', BLACK = P + 'tee-black', NAVY = P + 'tee-navy', GREY = P + 'tee-grey'
const LEGS = P + 'leggings-army-green', CAP = P + 'cap-red', PLAIN = P + 'plain'
const FIX = [
  { slug: ONYX, en: 'Aaa Cardopt Tee — Onyx Black', ar: 'تيشيرت كاردوبت — أسود عقيقي', cat: 'women', active: 1, v: [['L', 3], ['S', 0], ['XL', 0], ['XL', 2, 'X2'], ['XS', 5]] },
  { slug: BLACK, en: 'Aaa Cardopt Tee — Black', ar: 'تيشيرت كاردوبت — أسود', cat: 'women', active: 1, v: [['M', 4], ['2XL', 1]], sale: 5.25 },
  { slug: NAVY, en: 'Aaa Cardopt Tee — Navy', ar: 'تيشيرت كاردوبت — كحلي', cat: 'women', active: 1, v: [['S', 1], ['M', 1], ['L', 1], ['XL', 1], ['2XL', 1], ['3XL', 1], ['4XL', 1], ['5XL', 0]] },
  { slug: GREY, en: 'Aaa Cardopt Tee — Grey', ar: 'تيشيرت كاردوبت — رمادي', cat: 'women', active: 0, v: [['M', 1]] },
  { slug: LEGS, en: 'Aaa Cardopt Leggings — Army Green', ar: 'ليقنز كاردوبت — أخضر زيتي', cat: 'women', active: 1, v: [['M', 5], ['L', 0]] },
  { slug: CAP, en: 'Aaa Cardopt Cap — Red', ar: 'قبعة كاردوبت — أحمر', cat: 'accessories', active: 1, v: [['ONE', 2]], attr: 'white' },
  { slug: PLAIN, en: 'Aaa Cardopt Plain', ar: 'كاردوبت سادة', cat: 'women', active: 1, v: [] },
]
const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'"
const skuOf = (slug, size, alt) => (slug.slice(0, 26) + '-' + (alt || size)).toUpperCase()
const sweep = () => sql(`delete from product_variants where slug like 'aaa-cardopt-%'; delete from product_attrs where slug like 'aaa-cardopt-%'; delete from products where slug like 'aaa-cardopt-%';`)
const remaining = () => Number(sql("select (select count(*) from products where slug like 'aaa-cardopt-%') + (select count(*) from product_variants where slug like 'aaa-cardopt-%') + (select count(*) from product_attrs where slug like 'aaa-cardopt-%')"))

let browser = null
try {
  sweep()
  for (const f of FIX) {
    sql(`insert into products (slug, name_en, name_ar, price, sale_price, category, active) values (${q(f.slug)}, ${q(f.en)}, ${q(f.ar)}, 7.5, ${f.sale ? f.sale : 'NULL'}, ${q(f.cat)}, ${f.active})`)
    for (const [size, stock, alt] of f.v) sql(`insert into product_variants (sku, slug, size, stock) values (${q(skuOf(f.slug, size, alt))}, ${q(f.slug)}, ${q(size)}, ${stock})`)
    if (f.attr) sql(`insert into product_attrs (slug, colour) values (${q(f.slug)}, ${q(f.attr)})`)
  }
  check(sql(`select name_ar from products where slug=${q(ONYX)}`) === FIX[0].ar, 'fixtures written, Arabic names intact (utf8mb4 round trip)')

  const getRows = async () => (await fetch(`${BASE}/api/api.php?r=products`)).json()

  // ── A. the API ─────────────────────────────────────────────────────────────
  if (want('A')) {
    console.log('\n--- A. ?r=products')
    const rows = await getRows()
    const by = Object.fromEntries(rows.map((r) => [r.slug, r]))
    const o = by[ONYX] || {}, b = by[BLACK] || {}
    check(o.colour?.key === 'onyx-black' && o.style_key === P + 'tee' && b.colour?.key === 'black' && b.style_key === P + 'tee',
      'A1 the slug decides the colour, LONGEST key first (onyx-black, not black), and both share one style', JSON.stringify([o.colour?.key, o.style_key, b.colour?.key, b.style_key]))
    const cap = by[CAP] || {}
    check(cap.colour?.key === 'white' && cap.style_key === P + 'cap' && cap.colour?.hex === COLOURS.white.hex,
      'A2 a product_attrs colour WINS over the slug (cap-red is filed white), the style still comes from the slug', JSON.stringify([cap.colour, cap.style_key]))
    const pl = by[PLAIN]
    check(pl && pl.colour === null && pl.style_key === null && Array.isArray(pl.size_options) && pl.size_options.length === 0,
      'A3 no colour means no style (never grouped) and no variant rows means no sizes', JSON.stringify(pl && [pl.colour, pl.style_key, pl.size_options]))
    check(!by[GREY], 'A4 an inactive sibling is not in the response at all')
    check(JSON.stringify(o.size_options) === JSON.stringify([{ size: 'S', in_stock: false }, { size: 'L', in_stock: true }, { size: 'XL', in_stock: true }]),
      'A5 sizes in the shop\'s order, XS (not offered) dropped, the duplicate XL rows OR\'ed', JSON.stringify(o.size_options))
    const nv = by[NAVY]?.size_options || []
    check(nv.length === 8 && nv.map((s) => s.size).join() === 'S,M,L,XL,2XL,3XL,4XL,5XL' && nv.slice(0, 7).every((s) => s.in_stock === true) && nv[7].in_stock === false,
      'A5 tee-navy: eight sizes, 5XL sold out', JSON.stringify(nv))
    const bad = []
    const walk = (x, path) => {
      if (Array.isArray(x)) return x.forEach((v, i) => walk(v, path + '[' + i + ']'))
      if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (/stock|cost|qty/i.test(k) && k !== 'in_stock') bad.push(path + '.' + k); walk(v, path + '.' + k) }
    }
    walk(rows, '')
    const shapes = rows.flatMap((r) => r.size_options || []).filter((s) => Object.keys(s).sort().join() !== 'in_stock,size' || typeof s.in_stock !== 'boolean' || typeof s.size !== 'string')
    const nSizes = rows.flatMap((r) => r.size_options || []).length
    check(bad.length === 0 && shapes.length === 0 && nSizes >= 10,
      `A6 no stock count, cost or qty anywhere in the response; every size is exactly {size, in_stock:boolean} (${nSizes} sizes looked at)`, JSON.stringify([bad.slice(0, 5), shapes.slice(0, 3)]))
    // parity with this file's own suffix rule, for every real product the owner has not tagged
    const tagged = new Set(sql("select slug from product_attrs where colour is not null and colour <> ''").split('\n').filter(Boolean))
    const real = rows.filter((r) => !r.slug.startsWith(P) && !tagged.has(r.slug))
    const off = real.filter((r) => (r.colour?.key ?? null) !== suffixOf(r.slug) || r.style_key !== rigStyle(r.slug)
      || (r.colour && (r.colour.hex.toLowerCase() !== COLOURS[r.colour.key].hex || r.colour.en !== COLOURS[r.colour.key].en || r.colour.ar !== COLOURS[r.colour.key].ar)))
    check(real.length >= 10 && real.some((r) => r.colour) && off.length === 0,
      `A7 every untagged product's colour and style match a longest-suffix reading of its slug (${real.length} products, ${real.filter((r) => r.colour).length} coloured)`,
      JSON.stringify(off.slice(0, 4).map((r) => [r.slug, r.colour?.key, r.style_key])))
    // the ETag moves when a size crosses zero, and only then
    const tag = async (inm) => { const r = await fetch(`${BASE}/api/api.php?r=products`, inm ? { headers: { 'If-None-Match': inm } } : {}); return { status: r.status, etag: r.headers.get('etag'), body: r.status === 200 ? await r.json() : null } }
    const t1 = await tag()
    sql(`update product_variants set stock = 2 where sku = ${q(skuOf(ONYX, 'L'))}`)
    const t2 = await tag()
    sql(`update product_variants set stock = 0 where sku = ${q(skuOf(ONYX, 'L'))}`)
    const t3 = await tag()
    const L3 = (t3.body || []).find((r) => r.slug === ONYX)?.size_options?.find((s) => s.size === 'L')
    check(!!t1.etag && t1.etag === t2.etag, 'A8 a sale that leaves a size in stock (3 -> 2) does not move the ETag (no count in the body)', `${t1.etag} ${t2.etag}`)
    check(!!t3.etag && t3.etag !== t1.etag && L3 && L3.in_stock === false, 'A8 the size selling out (-> 0) moves the ETag and reads in_stock:false', `${t3.etag} ${JSON.stringify(L3)}`)
    const c1 = await tag(t1.etag), c3 = await tag(t3.etag)
    check(c1.status === 200 && c3.status === 304, 'A8 the old tag gets a fresh 200, the current tag a 304', `${c1.status} ${c3.status}`)
    sql(`update product_variants set stock = 3 where sku = ${q(skuOf(ONYX, 'L'))}`)
  }

  const rows = await getRows()
  const by = Object.fromEntries(rows.map((r) => [r.slug, r]))
  const groupOf = (r) => rigStyle(r.slug) ?? r.slug
  const expectCircles = (slug) => {
    const row = by[slug]
    if (!row || !row.colour) return 0
    return new Set(rows.filter((r) => r.colour && groupOf(r) === groupOf(row)).map((r) => r.colour.key)).size
  }
  // the home page's own rule (home-products.js): featured first, else the first 8 the API lists
  const featured = rows.filter((r) => r.featured).sort((a, b) => (a.featured_sort || 0) - (b.featured_sort || 0))
  const homeList = (featured.length ? featured : rows).slice(0, 8).map((r) => r.slug)

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  const DEV = { phone: devices['iPhone 13'], desktop: { viewport: { width: 1280, height: 900 } } }
  const withLang = (path, lang) => lang === 'en' ? path + (path.includes('?') ? '&' : '?') + 'lang=en' : path
  const open = async (dev, path, init) => {
    const ctx = await browser.newContext({ ...DEV[dev], serviceWorkers: 'block' })
    if (init) await ctx.addInitScript(init)
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    return { ctx, page, errs }
  }
  const frames = (page, n = 2) => page.evaluate((n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f) }), n)
  const cardSel = (slug) => `main div.grid > article:has(> a[href*="/product/${slug}"])`
  const cart = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('sporta_cart') || '[]'))

  // ── B. every grid, phone and desktop, Arabic and English ─────────────────────
  if (want('B')) {
    console.log('\n--- B. what each card shows')
    const lum = (c) => { const v = (c.match(/[\d.]+/g) || []).slice(0, 3).map((x) => Number(x) / 255); return v.map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4).reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i], 0) }
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
    const hexOf = (c) => '#' + (c.match(/\d+/g) || []).slice(0, 3).map((x) => Number(x).toString(16).padStart(2, '0')).join('')
    const meet = (a, b) => a.l < b.r - 0.01 && b.l < a.r - 0.01 && a.t < b.b - 0.01 && b.t < a.b - 0.01
    const WISH = ['cloudsoft-leggings-navy', 'vanquish-tank-navy']
    check(WISH.every((s) => by[s] && by[s].colour && (by[s].size_options || []).length), 'the two real products the wishlist page is fed exist, with a colour and sizes', WISH.filter((s) => !by[s]).join(' '))
    const PAGES = [
      { name: 'shop', path: '/shop?q=cardopt', expect: [ONYX, BLACK, NAVY, LEGS, CAP, PLAIN] },
      { name: 'women', path: '/women', expect: [ONYX, BLACK, NAVY, LEGS, PLAIN] },
      // The bundle's /wishlist draws only products in its OWN built-in catalogue (measured: a
      // fixture slug saved there is silently left out), so this page is fed two real ones.
      { name: 'wishlist', path: '/wishlist', expect: WISH, init: `try { localStorage.setItem('sporta_wishlist', JSON.stringify(${JSON.stringify(WISH)})) } catch (e) {}` },
      { name: 'home', path: '/', expect: homeList.filter((s) => s.startsWith(P)) },
      { name: 'product', path: '/product/vanquish-tank-navy', expect: [] },
    ].filter((p) => listEnv('PAGES', ['shop', 'women', 'wishlist', 'home', 'product']).includes(p.name))
    for (const pg of PAGES) for (const dev of listEnv('DEVICES', ['phone', 'desktop'])) for (const lang of listEnv('LANGS', ['ar', 'en'])) {
      const L = `${pg.name} ${dev} ${lang}:`
      const { ctx, page, errs } = await open(dev, withLang(pg.path, lang), pg.init)
      await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)) } scrollTo(0, 0) })
      await page.waitForTimeout(700)
      const m = await page.evaluate(() => {
        const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
        const textR = (e) => { const g = document.createRange(); g.selectNodeContents(e); const r = g.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } }
        const grids = [...document.querySelectorAll('main div.grid')]
        const cards = []
        const union = (x, y) => (x && y) ? { l: Math.min(x.l, y.l), t: Math.min(x.t, y.t), r: Math.max(x.r, y.r), b: Math.max(x.b, y.b) } : (x || y)
        for (const a of document.querySelectorAll('main div.grid > article')) {
          const photo = a.firstElementChild
          const href = (photo && photo.tagName === 'A' && photo.getAttribute('href')) || ''
          const mm = /\/product\/([^/?#]+)/.exec(href)
          if (!mm) continue
          const cap = photo.nextElementSibling
          const cg = cap && cap.querySelector(':scope > .cardopt-colours'), sg = cap && cap.querySelector(':scope > .cardopt-sizes')
          const h3 = cap && cap.querySelector('h3'), price = cap && cap.querySelector(':scope > .price-card')
          const cgR = cg && R(cg), sgR = sg && R(sg)
          cards.push({
            slug: decodeURIComponent(mm[1]), grid: grids.indexOf(a.parentElement), gridMarked: a.parentElement.hasAttribute('data-cardopt-grid'),
            dataSlugs: [cg && cg.getAttribute('data-slug'), sg && sg.getAttribute('data-slug')].filter(Boolean),
            card: R(a), h3: h3 && R(h3), name: h3 && textR(h3), price: price && R(price), priceText: price && textR(price), priceLH: price ? parseFloat(getComputedStyle(price).lineHeight) : 0, priceMid: (() => { if (!price) return null; const o = price.querySelector(':scope > s, :scope > del'); const r = (o || price).getBoundingClientRect(); return (r.top + r.bottom) / 2 })(), sale: !!(price && price.querySelector('s, del')),
            box: union(cgR, sgR), cg: cgR, sg: sgR,
            // the rows must be EXACTLY their circles and boxes: no wrapper, no inner element (every
            // element is restyled whenever this page inserts anything; see card-options.js)
            inner: (cg ? cg.querySelectorAll('*').length - cg.children.length : 0) + (sg ? sg.querySelectorAll('*').length - sg.children.length : 0),
            wrapper: cap ? cap.querySelectorAll(':scope > .cardopt').length : 0,
            groups: [cg && cg.getAttribute('aria-label'), sg && sg.getAttribute('aria-label'), cg && cg.getAttribute('role'), sg && sg.getAttribute('role')],
            colours: cg ? [...cg.querySelectorAll('.cardopt-colour')].map((c) => { const r = R(c), k = c.clientLeft, cs = getComputedStyle(c); return { href: c.getAttribute('href'), key: c.getAttribute('data-key'), current: c.getAttribute('aria-current'),
              label: c.getAttribute('aria-label'), hit: r, disc: { l: r.l + k, t: r.t + k, r: r.r - k, b: r.b - k, w: r.w - 2 * k, h: r.h - 2 * k }, bg: cs.backgroundColor, clip: cs.backgroundClip,
              radius: cs.borderTopLeftRadius, ring: cs.backgroundImage, img: c.querySelectorAll('img').length } }) : [],
            sizes: sg ? [...sg.querySelectorAll('.cardopt-size')].map((s) => { const cs = getComputedStyle(s); return {
              size: s.getAttribute('data-size'), text: s.textContent, disabled: s.disabled, title: s.getAttribute('title'), label: s.getAttribute('aria-label'),
              r: R(s), color: cs.color, bg: cs.backgroundColor, fs: parseFloat(cs.fontSize), deco: cs.textDecorationLine } }) : [],
            pluses: [...a.querySelectorAll(':scope > a > button:not([aria-pressed])')].filter((b) => b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== 'hidden').map(R),
            forbidden: (cg ? cg.querySelectorAll('h3, [aria-pressed], [data-sporta-colour], [data-ar], [data-en], .mb-8, [class*="qas-"], a img').length : 0)
              + (sg ? sg.querySelectorAll('h3, [aria-pressed], [data-sporta-colour], [data-ar], [data-en], .mb-8, [class*="qas-"], a img').length : 0),
          })
        }
        // the first button whose text is exactly "L": seven rigs press it on the product page, so it
        // must be the product's own L, which comes before the "Complete the look" cards
        const bareL = (() => { const b = [...document.querySelectorAll('button')].find((x) => /^L$/.test(x.textContent.replace(/\s+/g, ' ').trim())); return b ? !!b.closest('.cardopt-sizes') : null })()
        return { cards, boxes: document.querySelectorAll('.cardopt-colours, .cardopt-sizes').length, oldLine: document.querySelectorAll('.sporta-card-colour, [data-sporta-colour]').length, bareL }
      })
      const found = new Set(m.cards.map((c) => c.slug))
      check(m.boxes > 0, `${L} the page has cards with colour/size rows (${m.boxes})`)
      check(pg.expect.every((s) => found.has(s)), `${L} every fixture card expected here was found (${pg.expect.length})`, pg.expect.filter((s) => !found.has(s)).join(' '))
      check(m.oldLine === 0, `${L} the old "● colour" line is gone`, String(m.oldLine))
      check(m.cards.every((c) => c.dataSlugs.every((d) => d === c.slug)), `${L} every row belongs to its own card's product`, JSON.stringify(m.cards.filter((c) => c.dataSlugs.some((d) => d !== c.slug)).map((c) => [c.slug, c.dataSlugs])))
      check(m.cards.every((c) => c.forbidden === 0), `${L} no h3, aria-pressed, data-ar/en, qas- or image inside the rows (other overlays and rigs key on those)`)
      check(m.cards.every((c) => c.inner === 0 && c.wrapper === 0), `${L} each row is its circles or boxes and nothing else: no wrapper, no element inside a circle or a box`,
        JSON.stringify(m.cards.filter((c) => c.inner || c.wrapper).slice(0, 3).map((c) => [c.slug, c.inner, c.wrapper])))
      check(m.cards.length > 0 && m.cards.every((c) => c.gridMarked), `${L} every product grid is marked for the row alignment (data-cardopt-grid)`)
      const wrongCount = m.cards.filter((c) => by[c.slug] && by[c.slug].colour && c.colours.length !== expectCircles(c.slug))
      check(m.cards.some((c) => c.colours.length) && wrongCount.length === 0, `${L} each coloured card has one circle per colour of its style (grouped by this rig from the API)`,
        JSON.stringify(wrongCount.slice(0, 3).map((c) => [c.slug, c.colours.length, expectCircles(c.slug)])))
      const noRow = m.cards.filter((c) => by[c.slug] && !by[c.slug].colour && !(by[c.slug].size_options || []).length && c.box)
      check(noRow.length === 0, `${L} a product with no colour and no sizes gets no rows`, noRow.map((c) => c.slug).join(' '))

      const onyx = m.cards.find((c) => c.slug === ONYX)
      if (pg.expect.includes(ONYX)) {
        if (check(!!onyx && onyx.colours.length === 3 && onyx.sizes.length === 3, `${L} tee-onyx-black: 3 circles and 3 size boxes`, JSON.stringify(onyx && [onyx.colours.length, onyx.sizes.length]))) {
          const paths = onyx.colours.map((c) => new URL(c.href, BASE).pathname)
          check(paths.join() === [BLACK, NAVY, ONYX].map((s) => '/product/' + s).join(), `${L} circles in style order: black, navy, onyx black`, paths.join(' '))
          const cur = onyx.colours.map((c) => c.current === 'true')
          check(cur.join() === 'false,false,true' && /radial-gradient/.test(onyx.colours[2].ring) && onyx.colours.slice(0, 2).every((c) => !/gradient/.test(c.ring)),
            `${L} only the card's own colour is current and ringed`, JSON.stringify(onyx.colours.map((c) => [c.current, c.ring])))
          check(onyx.colours.map((c) => hexOf(c.bg)).join() === ['black', 'navy', 'onyx-black'].map((k) => COLOURS[k].hex).join(), `${L} each disc is its colour's STORE_COLOURS swatch`, onyx.colours.map((c) => hexOf(c.bg)).join())
          check(onyx.colours.map((c) => c.label).join() === ['black', 'navy', 'onyx-black'].map((k) => COLOURS[k][lang]).join(), `${L} each circle is named in the page's language`, onyx.colours.map((c) => c.label).join())
          const s = onyx.sizes
          check(s.map((x) => x.text).join() === 'S,L,XL', `${L} sizes read S, L, XL`, s.map((x) => x.text).join())
          check(s[0].disabled && s[0].deco.includes('line-through') && s[0].title === (lang === 'ar' ? 'نفذت الكمية' : 'Sold out') && !s[1].disabled && !s[2].disabled,
            `${L} the sold-out S is disabled, struck through and titled sold out; L and XL are not`, JSON.stringify(s.map((x) => [x.disabled, x.deco, x.title])))
          check(lang === 'en' ? /^Add size L to bag — Aaa Cardopt Tee — Onyx Black$/.test(s[1].label) : /^أضف المقاس L إلى الحقيبة — /.test(s[1].label),
            `${L} the L box says what it does, in the page's language`, s[1].label)
          check(lang === 'en' ? /^Size S — sold out$/.test(s[0].label) : /^المقاس S — نفذت الكمية$/.test(s[0].label), `${L} the sold-out box says so`, s[0].label)
          check(onyx.groups.join('|') === (lang === 'en' ? 'Colours|Sizes|group|group' : 'الألوان|المقاسات|group|group'), `${L} the two rows are named groups`, onyx.groups.join('|'))
          // painted order and one left edge
          const order = onyx.h3.b <= onyx.cg.t + 0.5 && onyx.cg.b <= onyx.sg.t + 0.5 && onyx.sg.t > onyx.cg.t && onyx.box.b <= onyx.price.t + 0.5 && onyx.sg.t < onyx.price.t
          check(order, `${L} painted order: name, colours, sizes, price`, JSON.stringify({ name: onyx.h3.b, colours: [onyx.cg.t, onyx.cg.b], sizes: [onyx.sg.t, onyx.sg.b], price: onyx.price.t }))
          const lefts = [(onyx.colours[0].disc.l - 3.4), onyx.sizes[0].r.l, onyx.name.l, onyx.priceText.l]
          check(Math.max(...lefts) - Math.min(...lefts) <= 1.5, `${L} the first colour circle (its ring: disc edge less the 3.4px of ring outside it), the first size, the name and the price start on one left edge`, lefts.map((x) => x.toFixed(1)).join(' '))
        }
      }
      const capC = m.cards.find((c) => c.slug === CAP)
      if (pg.expect.includes(CAP)) {
        check(!!capC && capC.colours.length === 1 && capC.colours[0].current === 'true' && hexOf(capC.colours[0].bg) === COLOURS.white.hex
          && capC.sizes.length === 1 && capC.sizes[0].text === (lang === 'ar' ? 'مقاس واحد' : 'One size'),
        `${L} cap: one ringed white circle (product_attrs beat the slug) and one "${lang === 'ar' ? 'مقاس واحد' : 'One size'}" box`, JSON.stringify(capC && [capC.colours.map((c) => [c.key, c.current]), capC.sizes.map((x) => x.text)]))
      }
      const plain = m.cards.find((c) => c.slug === PLAIN)
      if (pg.expect.includes(PLAIN)) check(!!plain && !plain.box, `${L} the plain card has no rows`)

      // every card with rows: order, edges, sizes, contrast, the +
      const withBox = m.cards.filter((c) => c.box)
      const orderBad = withBox.filter((c) => !(c.h3.b <= c.box.t + 0.5 && c.box.b <= c.price.t + 0.5 && (!c.cg || !c.sg || c.cg.b <= c.sg.t + 0.5)))
      check(orderBad.length === 0, `${L} on every card the rows sit between the name and the price (${withBox.length} cards)`, orderBad.map((c) => c.slug).slice(0, 4).join(' '))
      const edgeBad = withBox.filter((c) => { const xs = [c.colours[0] && c.colours[0].disc.l - 3.4, c.sizes[0] && c.sizes[0].r.l, c.name.l].filter((x) => x != null); return Math.max(...xs) - Math.min(...xs) > 1.5 })
      check(edgeBad.length === 0, `${L} on every card the rows start on the name's left edge`, edgeBad.map((c) => c.slug).slice(0, 4).join(' '))
      const circles = withBox.flatMap((c) => c.colours), boxes = withBox.flatMap((c) => c.sizes)
      // the PAGE's language, on every circle of every grid — the bundle's own cards carry no ?lang=en
      // in their links, so a circle that copied the card's link sent an English shopper to Arabic
      const langBad = circles.filter((c) => /[?&]lang=en(&|#|$)/.test(c.href) !== (lang === 'en'))
      check(circles.length > 0 && langBad.length === 0, `${L} every circle opens its page in the page's language (${lang === 'en' ? 'with' : 'without'} ?lang=en, ${circles.length} circles)`, langBad.slice(0, 3).map((c) => c.href).join(' '))
      check(circles.every((c) => c.hit.w >= 23.99 && c.hit.h >= 23.99 && Math.abs(c.disc.w - 16) <= 0.5 && Math.abs(c.disc.h - 16) <= 0.5 && c.clip.split(',').pop().trim() === 'padding-box' && c.radius === '50%' && c.img === 0),
        `${L} every circle is a 24px target with a round 16px disc (its colour clipped to the padding box, the ring layer or not) (${circles.length})`, JSON.stringify(circles.find((c) => !(c.hit.w >= 23.99 && c.hit.h >= 23.99 && Math.abs(c.disc.w - 16) <= 0.5 && c.clip.split(',').pop().trim() === 'padding-box')) || ''))
      // EXACTLY 28px tall, not "at least": a sold-out box in Arabic measured 36px beside 28px ones
      // (55-'s 36px minimum for buttons labelled "...الكمية", which the Arabic "sold out" contains)
      const offH = boxes.filter((b) => Math.abs(b.r.h - 28) > 0.5 || b.r.w < 27.99 || b.fs < 11)
      check(boxes.length > 0 && offH.length === 0, `${L} every size box is exactly 28px tall, at least 28px wide, with text of 11px or more (${boxes.length}, ${boxes.filter((b) => b.disabled).length} sold out)`,
        JSON.stringify(offH.slice(0, 3).map((b) => [b.size, b.disabled, b.r.w.toFixed(1), b.r.h.toFixed(1)])))
      const lineBad = withBox.filter((c) => { const lines = {}; for (const x of c.sizes) (lines[Math.round(x.r.t)] = lines[Math.round(x.r.t)] || []).push(x.r.b); return Object.values(lines).some((bs) => Math.max(...bs) - Math.min(...bs) > 0.5) })
      check(lineBad.length === 0, `${L} the boxes on one line of sizes end level (a sold-out box does not hang lower)`, lineBad.slice(0, 3).map((c) => c.slug + ' ' + c.sizes.map((x) => x.size + '@' + x.r.b.toFixed(1)).join(',')).join(' | '))
      const lowC = boxes.filter((b) => ratio(b.color, b.bg) < 4.5)
      check(boxes.length > 0 && (!pg.expect.includes(ONYX) || boxes.some((b) => b.disabled)) && lowC.length === 0,
        `${L} every size reads at 4.5:1 or better, sold out included (${boxes.filter((b) => b.disabled).length} sold out of ${boxes.length})`, JSON.stringify(lowC.slice(0, 2)))
      const rings = circles.filter((c) => c.current === 'true').map((c) => (c.ring.match(/rgba?\((?!0, 0, 0, 0\))[^)]*\)/) || [''])[0])
      check(rings.length > 0 && rings.every((c) => c && ratio(c, 'rgb(255, 255, 255)') >= 3), `${L} the ring around the card's own colour is 3:1 or better on white`, rings.slice(0, 3).join(' '))
      const clash = m.cards.filter((c) => c.pluses.some((p) => [...c.sizes.map((s) => s.r), ...c.colours.map((x) => x.hit)].some((r) => meet(p, r))))
      check(clash.length === 0, `${L} the + touches no size box and no circle`, clash.map((c) => c.slug).slice(0, 4).join(' '))
      // the + stays beside the price's last line: the price row sits at the foot of its track, so a
      // neighbour whose struck old price wraps to a second line does not leave this one a line above
      const plusOff = m.cards.filter((c) => c.pluses.length && c.priceText).map((c) => { const p = c.pluses.reduce((x, y) => (y.b > x.b ? y : x)); return { slug: c.slug, d: (p.t + p.b) / 2 - c.priceMid } })   // 2026-10-07: the price's text is font-size 0 (grid-price.js draws its parts), so its line is read from the struck price, or the whole price when there is none
      const plusBad = plusOff.filter((x) => Math.abs(x.d) > 6)
      check(plusOff.length > 0 && plusBad.length === 0, `${L} the + is centred on the price's last line on every card, ${m.cards.filter((c) => c.sale).length} of them on sale (within 6px)`, JSON.stringify(plusBad.slice(0, 3)))
      // a row of cards is one height, with one price line
      const rowsOf = {}
      for (const c of m.cards) { const k = c.grid + ':' + Math.round(c.card.t / 3); (rowsOf[k] = rowsOf[k] || []).push(c) }
      const uneven = Object.values(rowsOf).filter((r) => r.length > 1 && (Math.max(...r.map((c) => c.card.h)) - Math.min(...r.map((c) => c.card.h)) > 1 || Math.max(...r.map((c) => c.price.b)) - Math.min(...r.map((c) => c.price.b)) > 1))
      check(uneven.length === 0, `${L} cards in a row are one height with their prices level`, JSON.stringify(uneven.slice(0, 2).map((r) => r.map((c) => [c.slug, c.card.h.toFixed(1), c.price.b.toFixed(1)]))))
      // THE ROWS LINE UP ACROSS A ROW OF CARDS: names, colour rows, size rows and prices each start
      // level, whatever the names wrap to, however many lines the sizes take, and whether or not a
      // neighbour has a colour row at all. Measured from each card's own top, so a row of cards
      // that is itself level is what is compared.
      const spread = (xs) => xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0
      const skew = []
      let pairs = 0, mixed = 0
      for (const r of Object.values(rowsOf)) {
        if (r.length < 2) continue
        pairs++
        const at = (k) => r.filter((c) => c[k]).map((c) => c[k].t - c.card.t)
        if (r.some((c) => c.cg) && r.some((c) => !c.cg)) mixed++
        for (const [k, what] of [['h3', 'name'], ['cg', 'colours'], ['sg', 'sizes'], ['price', 'price']]) {
          // the price row is compared by its BOTTOM: it sits at the foot of its track beside the +,
          // so a neighbour's wrapped old price makes the track taller without moving it
          const d = k === 'price' ? spread(r.map((c) => c.price.b - c.card.t)) : spread(at(k))
          if (d > 1) skew.push(`${what} ${d.toFixed(1)}px apart in [${r.map((c) => c.slug).join(', ')}]`)
        }
      }
      check(pairs > 0 && skew.length === 0, `${L} across each row of cards the name, colour and size rows start level and the prices end level (${pairs} rows, ${mixed} with a colour row on one card only)`, skew.slice(0, 3).join(' | '))
      if (pg.name === 'shop' && dev === 'phone') {
        const prow = Object.values(rowsOf).find((r) => r.some((c) => c.slug === PLAIN))
        check(!!prow && prow.length === 2 && prow.some((c) => c.box), `${L} the plain card shares a row with a card that has rows (the case the equal heights are about)`, JSON.stringify(prow && prow.map((c) => c.slug)))
      }
      if (pg.name === 'product') {
        check(m.bareL === false, `${L} the first /^L$/ button is the product's own L, not a "Complete the look" card's (seven rigs press the first one)`, String(m.bareL))
      }
      check(errs.length === 0, `${L} no script errors`, errs.join(' | ').slice(0, 200))
      await ctx.close()
    }
  }

  // ── C. behaviour ─────────────────────────────────────────────────────────────
  if (want('C1')) {
    console.log('\n--- C1. one tap adds that size, on the app')
    const { ctx, page } = await open('phone', '/shop?q=cardopt&lang=en')
    await page.evaluate(() => { window.__co = 1 })
    const url0 = page.url()
    const L = page.locator(`${cardSel(ONYX)} .cardopt-size[data-size="L"]`)
    const S = page.locator(`${cardSel(ONYX)} .cardopt-size[data-size="S"]`)
    check(await L.count() === 1 && await S.count() === 1, 'C1 the onyx card has its L and S boxes')
    await L.tap()
    await L.evaluate((b) => b.click())            // a second tap inside the busy window
    await page.waitForTimeout(400)
    let c = await cart(page)
    const row = c.find((r) => r.key === `${ONYX}__L__normal`)
    check(c.length === 1 && row && row.qty === 1, 'C1 one tap: the cart holds that size once, in the bundle\'s key with the product page\'s fit (a double tap is one add)', JSON.stringify(c.map((r) => [r.key, r.qty])))
    check(row && typeof row.price === 'number' && row.price > 0 && row.name?.en === FIX[0].en && row.name?.ar === FIX[0].ar && row.size === 'L', 'C1 with its price, size and both-language name', JSON.stringify(row))
    check(await page.evaluate(() => window.__co === 1) && page.url() === url0, 'C1 no reload, no navigation (the bundle\'s own add was used)', page.url())
    const bag = await page.evaluate(() => { const a = document.querySelector('header [aria-label*="Bag"], header [aria-label*="Cart"]'); return a ? a.getAttribute('aria-label') + ' ' + a.textContent : '' })
    check(/\b1\b/.test(bag), 'C1 the bag in the header says 1', bag)
    const said = await page.evaluate(() => (document.querySelector('.cardopt-live') || {}).textContent || '')
    check(said.includes(FIX[0].en) && /\bL\b/.test(said), 'C1 a screen reader is told what was added', said)
    check(await L.evaluate((b) => b.hasAttribute('data-cardopt-added')), 'C1 the box shows it was added')
    await page.waitForTimeout(1300)
    await L.tap()
    await page.waitForTimeout(400)
    c = await cart(page)
    check(c.length === 1 && c[0].qty === 2, 'C1 a second tap after the busy window makes it 2, not a second row', JSON.stringify(c.map((r) => [r.key, r.qty])))
    await page.waitForTimeout(1300)
    await S.click({ force: true }).catch(() => {})
    await S.dispatchEvent('click')
    await page.waitForTimeout(400)
    const c2 = await cart(page)
    check(JSON.stringify(c2) === JSON.stringify(c), 'C1 a sold-out size does nothing, even forced or synthetic', JSON.stringify(c2.map((r) => [r.key, r.qty])))
    await ctx.close()
  }

  if (want('C2')) {
    console.log('\n--- C2. one tap adds that size, on a server-drawn category page')
    const { ctx, page } = await open('phone', '/women?lang=en')
    await page.evaluate(() => { window.__co = 1 })
    const M = page.locator(`${cardSel(LEGS)} .cardopt-size[data-size="M"]`)
    check(await M.count() === 1, 'C2 the leggings card has its M box')
    await M.tap()
    await page.waitForTimeout(500)
    const c = await cart(page)
    check(c.length === 1 && c[0].key === `${LEGS}__M__slim` && c[0].qty === 1, 'C2 the cart holds M with the leggings\' slim fit', JSON.stringify(c.map((r) => [r.key, r.qty])))
    check(await page.evaluate(() => (document.querySelector('[data-cart-badge]') || {}).textContent) === '1', 'C2 the page\'s bag badge shows 1 at once')
    check(await page.evaluate(() => window.__co === 1), 'C2 no reload')
    await ctx.close()
  }

  if (want('C3')) {
    console.log('\n--- C3. the card and the product page make the same cart line')
    for (const [slug, cat] of [['cloudsoft-leggings-army-green', '/women'], ['vanquish-tank-navy', '/men']]) {
      if (!by[slug]) { check(false, `C3 ${slug} is in the sandbox catalogue`); continue }
      const a = await open('desktop', `/product/${slug}?lang=en`)
      const sizeBtn = a.page.locator('main button:not([disabled])', { hasText: /^(S|M|L|XL|2XL|3XL|4XL|5XL)$/ }).first()
      const size = (await sizeBtn.textContent()).trim()
      await sizeBtn.click()
      await a.page.locator('main button', { hasText: /^Add$/ }).first().click()
      await a.page.waitForTimeout(600)
      const pk = (await cart(a.page)).map((r) => r.key)
      await a.ctx.close()
      const b = await open('phone', `${cat}?lang=en`)
      const box = b.page.locator(`${cardSel(slug)} .cardopt-size[data-size="${size}"]`)
      if (await box.count()) { await box.scrollIntoViewIfNeeded(); await box.tap(); await b.page.waitForTimeout(500) }
      const ck = (await cart(b.page)).map((r) => r.key)
      await b.ctx.close()
      check(pk.length === 1 && ck.length === 1 && pk[0] === ck[0], `C3 ${slug}: the product page and the card's ${size} box write the same line`, `page ${pk.join()} card ${ck.join()}`)
    }
  }

  if (want('C4')) {
    console.log('\n--- C4. a circle opens its colour, in the page\'s language')
    // /shop is the BUNDLE's grid: its own card links carry no ?lang=en, and the circle is a plain
    // link (a full page load), so only the circle itself can keep the shopper in English
    for (const [lang, path] of [['en', '/shop?q=cardopt&lang=en'], ['ar', '/shop?q=cardopt']]) {
      const { ctx, page } = await open('phone', path)
      const photoHref = await page.locator(`${cardSel(ONYX)} > a`).getAttribute('href')
      await page.locator(`${cardSel(ONYX)} .cardopt-colour[data-key="black"]`).tap()
      const ok = await page.waitForURL(/\/product\/aaa-cardopt-tee-black(\?|$)/, { timeout: 8000 }).then(() => true, () => false)
      await page.waitForTimeout(1200)
      const got = await page.evaluate(() => ({ lang: document.documentElement.lang, h1: (document.querySelector('main h1') || {}).textContent || '' }))
      check(ok, `C4 ${lang}: tapping the black circle opens the black tee's page`, page.url())
      check(got.lang.slice(0, 2) === lang && (lang === 'en' ? /Aaa Cardopt Tee — Black/.test(got.h1) : /تيشيرت كاردوبت — أسود/.test(got.h1)),
        `C4 ${lang}: and that page is in ${lang === 'en' ? 'English' : 'Arabic'}, like the page the circle was on (the card's own link: ${photoHref})`, JSON.stringify(got) + ' ' + page.url())
      await ctx.close()
    }
  }

  if (want('C5') || want('C6')) {
    const { ctx, page } = await open('phone', '/shop?q=cardopt')
    if (want('C5')) {
      console.log('\n--- C5. a language change relabels, never rebuilds')
      const before = await page.evaluate((sel) => { const c = document.querySelector(sel + ' .cardopt-colours'), g = document.querySelector(sel + ' .cardopt-sizes'); if (!c || !g) return null; c.__keep = 1; g.__keep = 1
        return { L: g.querySelector('.cardopt-size[data-size="L"]').getAttribute('aria-label'), href: c.querySelector('.cardopt-colour[data-key="navy"]').getAttribute('href') } }, cardSel(ONYX))
      await page.evaluate(() => { document.documentElement.lang = 'en' })
      await frames(page, 2)
      const after = await page.evaluate((sel) => { const c = document.querySelector(sel + ' .cardopt-colours'), g = document.querySelector(sel + ' .cardopt-sizes'); return c && g && { keep: c.__keep === 1 && g.__keep === 1,
        L: g.querySelector('.cardopt-size[data-size="L"]').getAttribute('aria-label'), text: g.querySelector('.cardopt-size[data-size="L"]').textContent, groups: [c.getAttribute('aria-label'), g.getAttribute('aria-label')],
        circle: c.querySelector('.cardopt-colour[data-key="navy"]').getAttribute('aria-label'), href: c.querySelector('.cardopt-colour[data-key="navy"]').getAttribute('href') } }, cardSel(ONYX))
      check(/^أضف المقاس L/.test(before?.L || '') && before.href === '/product/' + NAVY, 'C5 the page starts in Arabic, its circles without ?lang=en', JSON.stringify(before))
      check(after && after.keep, 'C5 the same nodes after the switch (relabelled, not rebuilt)')
      check(after && /^Add size L to bag/.test(after.L) && after.text === 'L' && after.groups.join() === 'Colours,Sizes' && after.circle === 'Navy' && after.href === '/product/' + NAVY + '?lang=en',
        'C5 and every label is English, and the circles now open English pages', JSON.stringify(after))
      await page.evaluate(() => { document.documentElement.lang = 'ar' })
      await frames(page, 2)
    }
    if (want('C6')) {
      console.log('\n--- C6. a node React re-uses for another product is rebuilt')
      await page.evaluate((sel) => { document.querySelector(sel + ' > a').setAttribute('href', '/product/aaa-cardopt-tee-navy') }, cardSel(ONYX))
      await frames(page, 2)
      const r = await page.evaluate(() => {
        const a = [...document.querySelectorAll('main div.grid > article')].filter((x) => x.firstElementChild.getAttribute('href') === '/product/aaa-cardopt-tee-navy')
        return a.map((x) => { const c = x.querySelector('.cardopt-colours'), g = x.querySelector('.cardopt-sizes'); return c && g && { slug: [c.getAttribute('data-slug'), g.getAttribute('data-slug')].join(), cur: (c.querySelector('[aria-current="true"]') || {}).dataset?.key, n: g.querySelectorAll('.cardopt-size').length,
          off: [...g.querySelectorAll('.cardopt-size:disabled')].map((s) => s.dataset.size).join(), rows: x.querySelectorAll('.cardopt-colours, .cardopt-sizes').length } })
      })
      check(r.length >= 2 && r.every((x) => x && x.slug === NAVY + ',' + NAVY && x.cur === 'navy' && x.n === 8 && x.off === '5XL' && x.rows === 2), 'C6 the re-pointed card shows the navy tee: navy ringed, 8 sizes, 5XL sold out, and only its two rows', JSON.stringify(r))
    }
    await ctx.close()
  }

  if (want('C7')) {
    // /shop loads more cards as it is scrolled, and each newcomer gets its rows once — that is the
    // work there is to do. What must not happen is anything MORE: a caption given rows twice, a
    // card that was already drawn touched again, or any write at all once nothing new is arriving.
    console.log('\n--- C7. scrolling does the work once per card, and then nothing')
    for (const dev of ['phone', 'desktop']) {
      const { ctx, page } = await open(dev, '/shop?lang=en')
      await page.waitForTimeout(1000)
      const watch = () => page.evaluate(() => {
        if (window.__coMo) window.__coMo.disconnect()
        const ROWS = '.cardopt-colours, .cardopt-sizes'
        window.__co7 = { pre: 0, inside: 0, removed: 0, builds: new Map(), marks: 0, total: 0 }
        document.querySelectorAll('main div.grid > article > a + div').forEach((cap) => { if (cap.querySelector(':scope > .cardopt-colours, :scope > .cardopt-sizes')) { cap.__pre = 1; window.__co7.pre++ } })
        window.__coMo = new MutationObserver((rs) => { for (const r of rs) {
          const s = window.__co7
          const t = r.target.nodeType === 1 ? r.target : r.target.parentElement
          const isRow = (n) => n.nodeType === 1 && n.matches(ROWS)
          if (t && t.closest(ROWS)) { s.inside++; s.total++ }
          for (const n of r.removedNodes) if (isRow(n) || (n.nodeType === 1 && n.querySelector && n.querySelector(ROWS))) { s.removed++; s.total++ }
          const added = [...r.addedNodes].filter(isRow).length
          if (added) { s.builds.set(r.target, (s.builds.get(r.target) || 0) + 1); s.total++ }
          if (r.type === 'attributes' && /^data-cardopt/.test(r.attributeName) && r.attributeName !== 'data-cardopt-added') { s.marks++; s.total++ }
        } })
        window.__coMo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
      })
      const read = () => page.evaluate(() => { const s = window.__co7; return { pre: s.pre, inside: s.inside, removed: s.removed, total: s.total, marks: s.marks,
        twice: [...s.builds.values()].filter((n) => n > 1).length, built: s.builds.size,
        preTouched: [...s.builds.keys()].filter((c) => c.__pre).length,
        rows: document.querySelectorAll('.cardopt-colours, .cardopt-sizes').length, arts: document.querySelectorAll('main div.grid > article').length, y: Math.round(scrollY) } })
      await watch()
      for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, 160); await page.waitForTimeout(100) }
      await page.waitForTimeout(800)
      const down = await read()
      check(down.pre > 0 && down.y > 500 && down.inside === 0 && down.removed === 0 && down.twice === 0 && down.preTouched === 0 && down.marks === 0,
        `C7 ${dev}: scrolling down, the ${down.pre} cards already drawn were not touched and each of the ${down.built} new ones got its rows once`, JSON.stringify(down))
      await watch()
      for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(80) }
      for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(80) }
      await page.waitForTimeout(600)
      const again = await read()
      // nothing new arrived (same number of cards): then there was nothing to draw and nothing may be written
      const quiet = again.arts === down.arts ? again.total === 0 : (again.inside === 0 && again.removed === 0 && again.twice === 0 && again.preTouched === 0)
      check(again.pre > 0 && quiet, `C7 ${dev}: scrolling back over ${again.pre} drawn cards writes nothing (cards ${down.arts} -> ${again.arts})`, JSON.stringify(again))
      await ctx.close()
    }
  }

  if (want('C8')) {
    // A double tap is one add PER SIZE. The first version guarded the whole card, so S and then L
    // tapped 400ms apart left only S in the bag, with no tick and no word on L.
    console.log('\n--- C8. two different sizes, one after the other, are two adds')
    for (const [dev, path, lang] of [['phone', '/shop?q=cardopt&lang=en', 'en'], ['desktop', '/shop?q=cardopt', 'ar'], ['phone', '/women?lang=en', 'en']]) {
      const { ctx, page } = await open(dev, path)
      const box = (sz) => page.locator(`${cardSel(NAVY)} .cardopt-size[data-size="${sz}"]`)
      if (!check(await box('S').count() === 1 && await box('L').count() === 1, `C8 ${dev} ${path}: the navy tee has S and L`)) { await ctx.close(); continue }
      await box('S').scrollIntoViewIfNeeded()
      if (dev === 'phone') { await box('S').tap(); await page.waitForTimeout(400); await box('L').tap() } else { await box('S').click(); await page.waitForTimeout(400); await box('L').click() }
      await page.waitForTimeout(150)
      const ticks = await page.evaluate((sel) => [...document.querySelectorAll(sel + ' .cardopt-size[data-cardopt-added]')].map((b) => b.dataset.size).join(), cardSel(NAVY))
      await page.waitForTimeout(350)
      const c = (await cart(page)).map((r) => r.key + 'x' + r.qty).sort()
      const said = await page.evaluate(() => (document.querySelector('.cardopt-live') || {}).textContent || '')
      check(c.join() === [`${NAVY}__L__normal`, `${NAVY}__S__normal`].map((k) => k + 'x1').join(), `C8 ${dev} ${lang} ${path.split('?')[0]}: S then L 400ms later puts BOTH in the bag, once each`, c.join())
      check(ticks === 'S,L' && /·\s*L$/.test(said), `C8 ${dev} ${lang}: both boxes show the tick, and the last thing said is L`, `${ticks} / ${said}`)
      await ctx.close()
    }
  }

  if (want('C9')) {
    // SAME FRAME. This page restyles the whole document whenever an element is inserted (its
    // :has() rules), so rows added a frame after React's card cost a second full restyle per
    // batch. A card /shop loads while scrolling must already have its rows when the browser first
    // styles it: an observer created before card-options.js's runs FIRST in the same microtask
    // checkpoint, and its requestAnimationFrame comes before that frame's style and layout.
    console.log('\n--- C9. a card loaded while scrolling has its rows before its first frame')
    const withRows = rows.filter((r) => r.colour || (r.size_options || []).length).map((r) => r.slug)
    for (const dev of ['phone', 'desktop']) {
      const { ctx, page } = await open(dev, '/shop?lang=en', `
        window.__co9 = { on: false, seen: 0, missing: [] }
        new MutationObserver((rs) => {
          const s = window.__co9
          if (!s.on) return
          for (const r of rs) for (const n of r.addedNodes) {
            if (n.nodeType !== 1) continue
            const arts = n.matches('main div.grid > article') ? [n] : [...n.querySelectorAll('main div.grid > article')]
            for (const a of arts) requestAnimationFrame(() => {
              const href = (a.firstElementChild && a.firstElementChild.getAttribute('href')) || ''
              const slug = decodeURIComponent((/\\/product\\/([^/?#]+)/.exec(href) || [])[1] || '')
              if (!s.want.has(slug)) return
              s.seen++
              const cap = a.firstElementChild.nextElementSibling
              if (!cap || !cap.querySelector(':scope > .cardopt-colours, :scope > .cardopt-sizes')) s.missing.push(slug)
            })
          }
        }).observe(document, { childList: true, subtree: true })`)
      const n0 = await page.evaluate((want) => { window.__co9.want = new Set(want); window.__co9.on = true; return document.querySelectorAll('main div.grid > article').length }, withRows)
      for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 200); await page.waitForTimeout(60) }
      await page.waitForTimeout(800)
      const r = await page.evaluate(() => ({ seen: window.__co9.seen, missing: window.__co9.missing, arts: document.querySelectorAll('main div.grid > article').length }))
      check(r.arts > n0 && r.seen > 0 && r.missing.length === 0, `C9 ${dev}: ${r.seen} cards loaded while scrolling (${n0} -> ${r.arts}) all had their rows at their first frame`, JSON.stringify(r))
      await ctx.close()
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {})
  try { sweep() } catch (e) { console.log('FAIL the sweep itself failed: ' + String(e.message || e).split('\n')[0]); fails++ }
}
check(remaining() === 0, 'no fixture row is left behind')
console.log(fails ? `\n${fails} FAILED` : '\nall ok — colours and sizes on every card, one tap to the bag')
process.exit(fails ? 1 : 0)
