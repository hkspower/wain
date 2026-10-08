/**
 * The phone size chart: only for a piece with sizes to choose, only that piece's sizes, and it follows
 * the product and the language. 2026-10-08 (product-page review, P4 and P10 item c).
 *
 *   bash scripts/sandbox.sh && node scripts/size-chart-test.mjs
 *   MUTATE=orig|nofilter|emptytable|noslug|nolang|nolangobs|noempty node scripts/size-chart-test.mjs   (must FAIL)
 *
 * assets/product-mobile-layout.js adds a "Size guide" table to the phone product page from
 * ?r=size_chart — which answers the S-5XL body chart for ANY slug. So the phone strap, the cap and the
 * backpacks showed a 400px table of chest and waist sizes, and the jacket made in M and L showed eight
 * rows. Asserted, measured on the page; every expected value comes from the API (size_options on
 * ?r=products and the rows of ?r=size_chart), never from the overlay:
 *   A. The jacket (M, L), a women's piece (with its hip column) and a T-shirt in every size each show
 *      exactly the rows of the sizes the server lists for them; a SOLD-OUT size stays in the chart.
 *   B. Accessories: the sandbox's (no size rows at all) and the LIVE shape — a single ONE row, at stock 0
 *      and at stock 5, served by route — get no chart and never an empty table with headings only (what
 *      hiding rows instead of not building them produced). The sandbox one's empty size block is closed,
 *      so the buy row sits 16-40px under the price like everywhere else.
 *   C. When the product list cannot be read, the full chart is drawn, as before.
 *   D. Product to product without a reload (a colour button, "Complete the look", back): the chart is
 *      rebuilt for the product on screen — a women's chart with its hip column must not stay on a jacket.
 *   E. The header's real language toggle redraws it in the new language and direction, one chart only.
 *   F. Nothing is rewritten while the page is idle; the chart is still the column's last block; a
 *      computer gets no chart.
 *
 * MUTATE serves an edited copy of the overlay through a route (the repository file is never touched;
 * `orig` serves the committed HEAD version, i.e. the fix undone), and asserts each edit matched.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const FILE = 'sporta-site/public_html/assets/product-mobile-layout.js'
const ROOT = new URL('../', import.meta.url).pathname
const MUTATE = process.env.MUTATE || ''
const JACKET = 'cloudsoft-jacket-army-green', JACKET_RED = 'cloudsoft-jacket-cherry-red'
const WOMEN = 'cloudsoft-leggings-army-green', TEE = 'cheetahs-rugby-t-shirt'
const STRAP = 'gymshark-phone-strap', CAP = 'denver-nuggets-cap-navy'

let fails = 0, passes = 0
const check = (ok, what, d = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }

let SRC = readFileSync(ROOT + FILE, 'utf8')
const mutate = (from, to) => { if (!SRC.includes(from)) { console.log(`FAIL MUTATE=${MUTATE}: the edit matched nothing (${from.slice(0, 60)}…)`); process.exit(2) } SRC = SRC.split(from).join(to) }
if (MUTATE === 'orig') SRC = execFileSync('git', ['show', 'HEAD:' + FILE], { cwd: ROOT, encoding: 'utf8' })
if (MUTATE === 'nofilter') mutate('var shown = sizes ? rows.filter(', 'var shown = false ? rows.filter(')
if (MUTATE === 'emptytable') mutate('    if (!shown.length) return\n', '')
if (MUTATE === 'noslug') mutate('g.getAttribute(GUIDE_MARK) === slug && ', '')
if (MUTATE === 'nolang') mutate(' && g.getAttribute(GUIDE_LANG) === L) keep = g', ') keep = g')
if (MUTATE === 'nolangobs') mutate("new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })", '')
if (MUTATE === 'noempty') mutate('if (sizeFit.children.length === 0 && !sizeFit.textContent.trim()) {', 'if (false) {')
if (MUTATE) console.log(`--- MUTATE=${MUTATE}: this run must FAIL\n`)

const api = async (q) => (await fetch(`${BASE}/api/api.php?r=${q}`)).json()
const products = await api('products')
const list = Array.isArray(products) ? products : products.products
const bySlug = Object.fromEntries(list.map((p) => [p.slug, p]))
const sizesOf = (slug) => (bySlug[slug]?.size_options || []).map((o) => o.size).filter((s) => s !== 'ONE')
const chartOf = async (slug) => ((await api('size_chart&slug=' + encodeURIComponent(slug))).rows || [])
const expectRows = async (slug, sizes = sizesOf(slug)) => (await chartOf(slug)).filter((r) => sizes.includes(r.size)).map((r) => r.size)

check(sizesOf(JACKET).join() === 'M,L' && sizesOf(JACKET_RED).join() === 'L', `the fixtures have the property under test: ${JACKET} M,L and ${JACKET_RED} L`, `${sizesOf(JACKET)} / ${sizesOf(JACKET_RED)}`)
check(sizesOf(TEE).length === 8 && sizesOf(STRAP).length === 0 && bySlug[CAP], `${TEE} is made in every size, ${STRAP} in none, ${CAP} exists`)
check((await chartOf(STRAP)).length >= 8, 'and ?r=size_chart still answers a full chart for an accessory (so the overlay is what must decide)', String((await chartOf(STRAP)).length))
const womenChart = await chartOf(WOMEN)
check(womenChart.some((r) => r.hip_min != null) && !(await chartOf(JACKET)).some((r) => r.hip_min != null), `${WOMEN}'s chart has a hip column and ${JACKET}'s does not (the client-side check needs the difference)`)

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

/** A route that edits the product list and the stock answer the way the live shop's data looks. */
const liveShape = (edits) => async (ctx) => {
  await ctx.route('**/api/api.php?r=products*', async (route) => {
    const r = await route.fetch(); const j = await r.json(); const a = Array.isArray(j) ? j : j.products
    for (const p of a) if (edits.products[p.slug]) p.size_options = edits.products[p.slug]
    await route.fulfill({ response: r, body: JSON.stringify(j), headers: { ...r.headers(), 'content-type': 'application/json' } })
  })
  await ctx.route('**/api/api.php?r=stock*', async (route) => {
    const r = await route.fetch(); let a = await r.json()
    a = a.filter((v) => !edits.stockDrop || !edits.stockDrop(v)).concat(edits.stockAdd || [])
    await route.fulfill({ response: r, body: JSON.stringify(a), headers: { ...r.headers(), 'content-type': 'application/json' } })
  })
}

async function open(kind, lang, setup) {
  const ctx = await browser.newContext(kind === 'phone' ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  if (MUTATE) await ctx.route('**/assets/product-mobile-layout.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: SRC }))
  if (setup) await setup(ctx)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => check(false, 'no page error', e.message))
  return { ctx, page }
}

const state = (page) => page.evaluate(() => {
  const h1 = document.querySelector('h1.product-title')
  if (!h1) return null
  const col = h1.parentElement.parentElement
  const kids = [...col.children]
  const gs = [...document.querySelectorAll('[data-sporta-size-guide]')]
  const g = gs[0]
  const sf = kids.find((e) => e.tagName === 'DIV' && /(^|\s)space-y-3(\s|$)/.test(e.className))
  const price = kids.find((e) => e.tagName === 'P' && /items-baseline/.test(e.className))
  const buy = kids.find((e) => e.tagName === 'DIV' && /flex-wrap/.test(e.className) && e.querySelector('.btn-primary'))
  const ul = kids.find((e) => e.tagName === 'UL')
  const visibleBlocks = kids.filter((e) => e.getBoundingClientRect().height > 0)
  return {
    path: location.pathname, lang: document.documentElement.lang, count: gs.length,
    // Any chart-shaped table this file could have drawn, with or without its mark: headings and no rows is the fault.
    tables: [...col.querySelectorAll(':scope > div > table')].map((t) => ({ heads: t.querySelectorAll('th').length, rows: t.querySelectorAll('tbody tr').length })),
    slug: g && g.getAttribute('data-sporta-size-guide'), heading: g && g.querySelector('h2')?.textContent,
    heads: g ? [...g.querySelectorAll('th')].map((t) => t.textContent) : [], rows: g ? [...g.querySelectorAll('tbody tr')].map((t) => t.cells[0].textContent) : [],
    dir: g && g.querySelector('table')?.getAttribute('dir'), guideTop: g ? g.getBoundingClientRect().top + scrollY : null,
    ulBottom: ul ? ul.getBoundingClientRect().bottom + scrollY : null, lastBlock: visibleBlocks.length ? visibleBlocks.reduce((a, b) => (a.getBoundingClientRect().bottom >= b.getBoundingClientRect().bottom ? a : b)) === g : false,
    size: sf && { kids: sf.children.length, display: getComputedStyle(sf).display, marked: sf.hasAttribute('data-sporta-empty-size') },
    gap: price && buy ? buy.getBoundingClientRect().top - price.getBoundingClientRect().bottom : null,
  }
})
async function until(page, ok, ms = 6000) {
  const end = Date.now() + ms
  let s = null
  do {
    s = await state(page)
    if (s && ok(s)) { await page.waitForTimeout(450); return state(page) }
    await page.waitForTimeout(150)
  } while (Date.now() < end)
  return s
}
async function load(page, slug) {
  await page.goto(`${BASE}/product/${slug}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('h1.product-title', { timeout: 15000 })
  await page.waitForFunction(() => ['r=products', 'r=size_chart'].every((q) => performance.getEntriesByType('resource').some((e) => e.name.includes(q) && e.responseEnd > 0)), null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(700)
}
const HEAD = { en: 'Size guide', ar: 'دليل المقاسات' }, SIZE_TH = { en: 'Size', ar: 'المقاس' }

try {
  // ---------------------------------------------------------------- A. garments
  for (const lang of ['en', 'ar']) {
    console.log(`\n--- A. garments, phone, ${lang}`)
    const { ctx, page } = await open('phone', lang)
    for (const slug of [JACKET, WOMEN, TEE]) {
      await load(page, slug)
      const want = await expectRows(slug)
      const s = await until(page, (x) => x.count === 1)
      check(s && s.count === 1 && s.rows.join() === want.join(), `${lang} ${slug}: the chart lists exactly the sizes it is made in`, s ? `${s.rows.join(',')} vs ${want.join(',')}` : '')
      check(s && s.heading === HEAD[lang] && s.heads[0] === SIZE_TH[lang] && (lang === 'ar' ? s.dir === 'rtl' : s.dir !== 'rtl'), `${lang} ${slug}: in the page's language and direction`, s ? `${s.heading} | ${s.heads.join('|')} | dir=${s.dir}` : '')
      if (slug === WOMEN) check(s && s.heads.length === 4, `${lang} ${slug}: the women's chart keeps its hip column`, s ? s.heads.join('|') : '')
      check(s && s.guideTop > s.ulBottom && s.lastBlock, `${lang} ${slug}: still the column's last block, below the delivery list`)
    }
    await ctx.close()
  }
  {
    // A sold-out size is in the list (it is a size the piece is MADE in), so it stays.
    const { ctx, page } = await open('phone', 'en', liveShape({
      products: { [JACKET]: [{ size: 'M', in_stock: true }, { size: 'L', in_stock: false }] },
      stockDrop: (v) => v.slug === JACKET && v.size === 'L', stockAdd: [{ slug: JACKET, size: 'L', sku: 'CLOUDSOFT-JACKET-ARMY-GREEN-L', stock: 0, in_stock: false }],
    }))
    await load(page, JACKET)
    const s = await until(page, (x) => x.count === 1)
    check(s && s.rows.join() === 'M,L', 'en jacket with L sold out: L stays in the chart', s ? s.rows.join(',') : '')
    await ctx.close()
  }

  // ---------------------------------------------------------------- B. accessories
  console.log('\n--- B. accessories')
  for (const lang of ['en', 'ar']) {
    const { ctx, page } = await open('phone', lang)
    await load(page, STRAP)
    await page.waitForTimeout(400)
    const s = await state(page)
    check(s && s.count === 0 && s.tables.length === 0, `${lang} ${STRAP} (no size rows): no size chart at all`, s ? `${s.count} guide(s), ${s.tables.length} table(s)` : '')
    check(s && s.size && s.size.kids === 0 && s.size.display === 'none', `${lang} ${STRAP}: its empty size block is closed`, s?.size ? JSON.stringify(s.size) : '')
    check(s && s.gap >= 16 && s.gap <= 40, `${lang} ${STRAP}: the buy row sits 16-40px under the price, like on every other page`, s ? `${Math.round(s.gap)}px` : '')
    await ctx.close()
  }
  for (const [slug, stock] of [[STRAP, 0], [CAP, 5]]) {
    for (const lang of ['en', 'ar']) {
      // The live accessories carry ONE row (CLAUDE.md 2026-09-09): the bundle then draws the whole clothing size
      // row crossed out plus ONE, which is exactly what fooled a filter that read the size buttons.
      const { ctx, page } = await open('phone', lang, liveShape({
        products: { [slug]: [{ size: 'ONE', in_stock: stock > 0 }] },
        stockAdd: [{ slug, size: 'ONE', sku: slug.toUpperCase().slice(0, 26) + '-ONE', stock, in_stock: stock > 0 }],
      }))
      await load(page, slug)
      await page.waitForTimeout(400)
      const s = await state(page)
      check(s && s.size && s.size.kids > 0, `${lang} ${slug} with a ONE row at stock ${stock} (the live shape): the bundle draws its size card`, s?.size ? JSON.stringify(s.size) : '')
      check(s && s.count === 0 && s.tables.length === 0, `${lang} ${slug} with a ONE row at stock ${stock}: no chart, and no empty table with headings only`, s ? `${s.count} guide(s), tables ${JSON.stringify(s.tables)}` : '')
      check(s && s.size && s.size.display !== 'none' && !s.size.marked, `${lang} ${slug} with a ONE row: its size card is left visible`)
      await ctx.close()
    }
  }

  // ---------------------------------------------------------------- C. the list cannot be read
  console.log('\n--- C. the product list cannot be read')
  {
    const { ctx, page } = await open('phone', 'en', (c) => c.route('**/api/api.php?r=products*', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"rig"}' })))
    await page.goto(`${BASE}/product/${JACKET}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('h1.product-title', { timeout: 15000 })
    const s = await until(page, (x) => x.count === 1, 8000)
    const full = (await chartOf(JACKET)).map((r) => r.size)
    check(s && s.count === 1 && s.rows.join() === full.join(), 'with no list to narrow by, the full chart is drawn, as before', s ? s.rows.join(',') : '')
    await ctx.close()
  }

  // ---------------------------------------------------------------- D. client-side navigation
  console.log('\n--- D. product to product without a reload')
  {
    const { ctx, page } = await open('phone', 'en')
    const go = (slug) => page.evaluate((h) => { const a = [...document.querySelectorAll('main a')].find((x) => x.getAttribute('href') === h); if (a) a.click(); return !!a }, '/product/' + slug)
    await load(page, JACKET)
    let s = await until(page, (x) => x.count === 1)
    await page.evaluate(() => { window.__noReload = 1 })
    check(await go(JACKET_RED), `D the colour button for ${JACKET_RED} is on the page`)
    s = await until(page, (x) => x.path === '/product/' + JACKET_RED && x.count === 1 && x.slug === JACKET_RED, 6000)
    check(s && s.count === 1 && s.rows.join() === (await expectRows(JACKET_RED)).join(), 'D colour switch, army green -> cherry red: the chart is rebuilt for cherry red', s ? `${s.path} rows ${s.rows.join(',')} (count ${s.count})` : '')
    await page.goBack()
    s = await until(page, (x) => x.path === '/product/' + JACKET && x.slug === JACKET, 6000)
    check(s && s.count === 1 && s.rows.join() === 'M,L', 'D back: army green\'s M, L again', s ? `${s.path} rows ${s.rows.join(',')}` : '')
    check(await go(WOMEN), `D the bundle's "Complete the look" link to ${WOMEN}`)
    s = await until(page, (x) => x.path === '/product/' + WOMEN && x.slug === WOMEN, 6000)
    check(s && s.count === 1 && s.heads.length === 4 && s.rows.join() === (await expectRows(WOMEN)).join(), 'D jacket -> women\'s: the women\'s chart, with its hip column', s ? `${s.heads.join('|')} rows ${s.rows.join(',')}` : '')
    check(await go(JACKET), `D and the link back to ${JACKET}`)
    s = await until(page, (x) => x.path === '/product/' + JACKET && x.slug === JACKET, 6000)
    check(s && s.count === 1 && s.heads.length === 3 && s.rows.join() === 'M,L', 'D women\'s -> jacket: the unisex chart, no hip column left behind', s ? `${s.path} ${s.heads.join('|')} rows ${s.rows.join(',')} slug=${s.slug}` : '')
    check(await page.evaluate(() => window.__noReload === 1), 'D all without a reload')
    await ctx.close()
  }

  // ---------------------------------------------------------------- E. the language toggle
  console.log('\n--- E. the header\'s language toggle')
  {
    const { ctx, page } = await open('phone', 'en')
    await load(page, JACKET)
    await until(page, (x) => x.count === 1)
    const toggle = () => page.evaluate(() => { const b = document.querySelector('header button[aria-label="Switch language"], header button[aria-label="تغيير اللغة"]'); if (b) b.click(); return !!b })
    check(await toggle(), 'E the header has its language toggle')
    let s = await until(page, (x) => x.lang === 'ar' && x.heading === HEAD.ar, 4000)
    check(s && s.lang === 'ar' && s.count === 1 && s.heading === HEAD.ar && s.heads[0] === SIZE_TH.ar && s.dir === 'rtl' && s.rows.join() === 'M,L', 'E EN -> AR: one chart, Arabic headings, right to left, the same rows', s ? `${s.lang} ${s.heading} | ${s.heads.join('|')} | dir=${s.dir} | ${s.rows.join(',')} (count ${s.count})` : '')
    await toggle()
    s = await until(page, (x) => x.lang === 'en' && x.heading === HEAD.en, 4000)
    check(s && s.lang === 'en' && s.count === 1 && s.heading === HEAD.en && s.heads[0] === SIZE_TH.en && s.dir !== 'rtl', 'E AR -> EN: back in English, left to right', s ? `${s.lang} ${s.heading} | dir=${s.dir} (count ${s.count})` : '')
    // <html lang> ALONE. The real toggle above also happens to add and remove nodes (other overlays redraw in
    // the new language), which wakes the file's body observer whatever it watches. A language change that
    // re-renders only TEXT adds no node at all, so the attribute is changed here with nothing else, and the
    // chart must still follow it. (The bundle is left in English underneath; the attribute is put back.)
    await page.evaluate(() => { document.documentElement.lang = 'ar' })
    s = await until(page, (x) => x.heading === HEAD.ar, 2500)
    check(s && s.count === 1 && s.heading === HEAD.ar && s.dir === 'rtl', 'E <html lang> changing on its own is enough to redraw it', s ? `${s.heading} dir=${s.dir} (count ${s.count})` : '')
    await page.evaluate(() => { document.documentElement.lang = 'en' })
    await until(page, (x) => x.heading === HEAD.en, 2500)

    // ---------------------------------------------------------------- F. idle, desktop
    const writes = await page.evaluate(() => new Promise((res) => {
      const col = document.querySelector('h1.product-title').parentElement.parentElement
      let n = 0
      const mo = new MutationObserver((rs) => { for (const r of rs) n += r.addedNodes.length + r.removedNodes.length })
      mo.observe(col, { childList: true, subtree: true })
      setTimeout(() => { mo.disconnect(); res(n) }, 2000)
    }))
    check(writes === 0, 'F nothing in the column is rebuilt while the page is idle', `${writes} node(s) added or removed in 2s`)
    await ctx.close()
  }
  {
    const { ctx, page } = await open('desktop', 'en')
    await load(page, JACKET)
    let s = await state(page)
    check(s && s.count === 0, 'F a computer gets no chart (the guide is phone-only)', s ? String(s.count) : '')
    await load(page, STRAP)
    s = await state(page)
    check(s && s.size && !s.size.marked, 'F and this file leaves a computer\'s size block alone', s?.size ? JSON.stringify(s.size) : '')
    await ctx.close()
  }
} finally {
  await browser.close()
}

console.log(fails ? `\nFAILED — ${fails} of ${passes + fails}` : `\nall ok — ${passes} checks`)
process.exit(fails ? 1 : 0)
