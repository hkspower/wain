/**
 * The product page's delivery-and-returns list: the "cannot be exchanged" line (P2) and the Arabic
 * delivery line's dash (P3). 2026-10-08.
 *
 *   bash scripts/sandbox.sh && node scripts/no-exchange-line-test.mjs
 *   MUTATE=off|once|nolang|sibling|nonative|p3 node scripts/no-exchange-line-test.mjs   (must FAIL)
 *
 * P2 — assets/no-exchange-line.js. The bundle draws its own amber 4th line only when its BUILT-IN
 * catalogue says so, and the built-in entries never do, so 0 of the 19 women's pages showed it while
 * ?r=products said `no_exchange: true` and the returns path refused the exchange. Asserted, each
 * measured on the rendered page and never read off the overlay:
 *   A. EVERY active product, phone, English: exactly one amber line when the server's `no_exchange` is
 *      true, none when it is false. The expected value is the API's field, the one store_return_lookup()
 *      computes with the same rule — a parity check, so it holds if the owner's rule changes.
 *   B. Phone and desktop, both languages: the words are the shop's own trust.noExchange in the page's
 *      language, the line is the list's LAST item, inside the list's box and below the product name
 *      (a sibling of the list gets flex order 0 on phones and paints above the name), it carries the
 *      returns icon, and its colour is not the list's grey.
 *   C. Client-side navigation (the bundle's own "Complete the look" link, no reload): women's -> jacket
 *      drops the line, back brings it back, jacket -> women's adds it.
 *   D. The header's real language toggle switches the line's language, and there is still one.
 *   E. The owner's own wording (a site_text row for trust.noExchange, served by route): one line, in the
 *      owner's words, and nothing written while the page is idle.
 *   F. A product the bundle does NOT know (served by route): the bundle draws its own amber line from
 *      the API, and this overlay steps aside, so there is exactly one.
 * P3 — the owner's wording, saved through the panel's own settings_save route (never raw SQL), the same
 *   entry scripts/publish/set-delivery-wording.php writes on the live server:
 *   G. Arabic product page and About page say "… ساعة — ١ د.ك" with no middle dot; English unchanged.
 *   The previous site_text row is put back exactly at the end (or removed, if there was none).
 *
 * MUTATE serves an edited copy of the overlay through a route (the repository file is never touched),
 * and asserts the edit matched before using it: a replacement that matches nothing is a no-op that
 * looks like success.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium, devices } = require('playwright')
const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('../sporta-site/public_html/', import.meta.url).pathname
const MUTATE = process.env.MUTATE || ''
const EN = 'This item cannot be exchanged', AR = 'هذا المنتج غير قابل للاستبدال'
const WOMEN = 'cloudsoft-leggings-army-green', JACKET = 'cloudsoft-jacket-army-green'
const EMAIL = 'manager@sporta.com.kw', PASSWORD = 'correct horse'

let fails = 0, passes = 0
const check = (ok, what, d = '') => { if (ok) passes++; else fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${d ? '   ' + d : ''}`) }
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '--raw', '-e', q], { encoding: 'utf8' }).trim()
sql('delete from rate_limit; delete from rate_bucket')

// ------------------------------------------------------------------ the overlay, or a mutant of it
let SRC = readFileSync(ROOT + 'assets/no-exchange-line.js', 'utf8')
const mutate = (from, to) => { if (!SRC.includes(from)) { console.log(`FAIL MUTATE=${MUTATE}: the edit matched nothing (${from.slice(0, 50)}…)`); process.exit(2) } SRC = SRC.split(from).join(to) }
if (MUTATE === 'off') SRC = '/* mutant: the overlay is not there */'
if (MUTATE === 'once') mutate('var s = slug()\n    var mine', 'var s = window.__noexFirst || (window.__noexFirst = slug())\n    var mine')
if (MUTATE === 'nolang') mutate("el.getAttribute('data-lang') === L && ", '')
if (MUTATE === 'sibling') { mutate('ul.appendChild(li)', 'ul.parentNode.insertBefore(li, ul.nextSibling)'); mutate('el.parentNode === ul &&', 'el.parentNode === ul.parentNode &&'); mutate('ul.lastElementChild === el', 'true') }
if (MUTATE === 'nonative') mutate('bySlug[s] === true && !native)', 'bySlug[s] === true)')
if (MUTATE) console.log(`--- MUTATE=${MUTATE}: this run must FAIL\n`)

// ------------------------------------------------------------------ static: it is wired in
{
  const index = readFileSync(ROOT + 'index.html', 'utf8')
  check(/<script src="\/assets\/no-exchange-line\.js"[^>]*\sdata-shop\b[^>]*><\/script>/.test(index), 'index.html loads the overlay as a storefront script (data-shop: the panel drops it)')
  const ht = readFileSync(ROOT + '.htaccess', 'utf8')
  const fm = ht.split('\n').find((l) => /<FilesMatch "\^\(sporta-ui\|/.test(l)) || ''
  check(/[|(]no-exchange-line[|)]/.test(fm), '.htaccess lists it with the fixed-name assets that must revalidate (its name would otherwise match the year-long hashed-asset rule)')
}

const products = await (await fetch(`${BASE}/api/api.php?r=products`)).json()
const list = Array.isArray(products) ? products : products.products
const women = list.filter((p) => p.no_exchange === true), other = list.filter((p) => p.no_exchange !== true)
check(women.length > 0 && other.length > 0, 'the catalogue has both sides of the rule (else the sweep is vacuous)', `no_exchange=true ${women.length}, false ${other.length}`)
check(list.find((p) => p.slug === WOMEN)?.no_exchange === true && list.find((p) => p.slug === JACKET)?.no_exchange === false, `the named fixtures still have the property under test (${WOMEN} true, ${JACKET} false)`)

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

async function open(kind, lang, setup) {
  const ctx = await browser.newContext(kind === 'phone' ? { ...devices['Pixel 7'] } : { viewport: { width: 1280, height: 900 } })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  if (MUTATE) await ctx.route('**/assets/no-exchange-line.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: SRC }))
  if (setup) await setup(ctx)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => check(false, 'no page error', e.message))
  return { ctx, page }
}

/** What the page shows in the list, measured from the boxes. */
const state = (page) => page.evaluate(() => {
  const h1 = document.querySelector('h1.product-title')
  if (!h1) return null
  const col = h1.parentElement && h1.parentElement.parentElement
  const ul = col && col.querySelector(':scope > ul')
  if (!ul) return null
  const ur = ul.getBoundingClientRect(), tr = h1.getBoundingClientRect()
  const amberOf = (li) => /(^|\s)text-amber-700(\s|$)/.test(li.className)
  const lines = [...document.querySelectorAll('[data-sporta-noex]'), ...[...ul.children].filter((li) => amberOf(li) && !li.hasAttribute('data-sporta-noex'))]
  const grey = ul.firstElementChild ? getComputedStyle(ul.firstElementChild).color : ''
  return {
    path: location.pathname, lang: document.documentElement.lang, items: ul.children.length,
    lines: lines.map((li) => { const r = li.getBoundingClientRect(); const svg = li.querySelector('svg')
      return { text: li.textContent.trim(), mine: li.hasAttribute('data-sporta-noex'), inList: li.parentNode === ul, last: ul.lastElementChild === li,
        top: r.top, bottom: r.bottom, inBox: r.top >= ur.top - 0.5 && r.bottom <= ur.bottom + 0.5, belowTitle: r.top > tr.bottom,
        icon: !!svg && /text-amber-700/.test(svg.getAttribute('class') || ''), colour: getComputedStyle(li).color, grey } }),
  }
})

/** Poll until `ok(state)` or the time runs out. A state that meets it is read AGAIN 450ms later and
 *  that second reading is returned: a transient moment (React replacing the list, a frame before an
 *  overlay re-adds its line) must not pass for the settled page. */
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
  // The answer the overlay waits for has arrived, and a few frames have passed since.
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /[?&]r=products(&|$)/.test(e.name) && e.responseEnd > 0), null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(600)
}

try {
  // ---------------------------------------------------------------- A. every product
  console.log('--- A. every active product, phone, English: one line exactly when no_exchange is true')
  const wrong = []
  const queue = [...list]
  await Promise.all([0, 1, 2, 3].map(async () => {
    const { ctx, page } = await open('phone', 'en')
    for (let p; (p = queue.shift());) {
      await load(page, p.slug)
      const want = p.no_exchange === true ? 1 : 0
      // Absence is read after the overlay has had its answer (load() waited for it), never polled for:
      // polling for "no line" passes on the first frame, before anything could have drawn one.
      const s = want ? await until(page, (x) => x.lines.length === want, 5000) : (await page.waitForTimeout(300), await state(page))
      const n = s ? s.lines.length : -1
      if (n !== want || (want && s.lines[0].text !== EN)) wrong.push(`${p.slug}: ${n} line(s)${want ? ' "' + (s?.lines[0]?.text ?? '') + '"' : ''}, expected ${want}`)
    }
    await ctx.close()
  }))
  check(wrong.length === 0, `the line follows the server's no_exchange on all ${list.length} products (${women.length} with it, ${other.length} without)`, wrong.slice(0, 5).join('; '))

  // ---------------------------------------------------------------- B. the line itself
  console.log('\n--- B. the words, the place and the colour')
  for (const [kind, lang] of [['phone', 'en'], ['phone', 'ar'], ['desktop', 'en'], ['desktop', 'ar']]) {
    const { ctx, page } = await open(kind, lang)
    await load(page, WOMEN)
    const s = await until(page, (x) => x.lines.length >= 1)
    const L = s && s.lines[0]
    check(s && s.lang === lang, `${kind} ${lang}: the page is in ${lang}`, s?.lang)
    check(s && s.lines.length === 1, `${kind} ${lang}: exactly one "cannot be exchanged" line`, String(s?.lines.length))
    check(L && L.text === (lang === 'ar' ? AR : EN), `${kind} ${lang}: in the shop's own words, in the page's language`, L?.text)
    check(L && L.inList && L.last && L.inBox, `${kind} ${lang}: the LAST item, inside the list's own box`, L ? `inList=${L.inList} last=${L.last} inBox=${L.inBox}` : '')
    check(L && L.belowTitle, `${kind} ${lang}: painted below the product name, not above it`, L ? `top ${Math.round(L.top)}` : '')
    check(L && L.icon && L.colour !== L.grey, `${kind} ${lang}: the returns icon, in amber, not the list's grey`, L ? `${L.colour} vs ${L.grey}` : '')
    await ctx.close()
  }

  // ---------------------------------------------------------------- C. client-side navigation
  console.log('\n--- C. product to product without a reload')
  {
    const { ctx, page } = await open('phone', 'en')
    await load(page, WOMEN)
    let s = await until(page, (x) => x.lines.length === 1)
    check(s && s.lines.length === 1, `C start: ${WOMEN} has the line`)
    await page.evaluate(() => { window.__noReload = 1 })
    const go = (slug) => page.evaluate((h) => { const a = [...document.querySelectorAll('main a')].find((x) => x.getAttribute('href') === h); if (a) a.click(); return !!a }, '/product/' + slug)
    check(await go(JACKET), `C the bundle's own link to ${JACKET} is on the page`)
    s = await until(page, (x) => x.path === '/product/' + JACKET && x.lines.length === 0, 5000)
    check(await page.evaluate(() => window.__noReload === 1), 'C it was a client-side navigation (no reload)')
    check(s && s.path === '/product/' + JACKET && s.lines.length === 0, 'C women\'s -> jacket: the line is gone (an exchangeable jacket must not say it cannot be exchanged)', s ? `${s.path} ${s.lines.length} line(s)` : '')
    await page.goBack()
    s = await until(page, (x) => x.path === '/product/' + WOMEN && x.lines.length === 1, 5000)
    check(s && s.path === '/product/' + WOMEN && s.lines.length === 1 && s.lines[0].text === EN, 'C back: the line returns', s ? `${s.path} ${s.lines.length}` : '')
    await page.goForward()
    await until(page, (x) => x.path === '/product/' + JACKET, 5000)
    check(await go(WOMEN), `C the bundle's own link back to ${WOMEN} is on the jacket page`)
    s = await until(page, (x) => x.path === '/product/' + WOMEN && x.lines.length === 1, 5000)
    check(s && s.lines.length === 1 && s.lines[0].inList && s.lines[0].last, 'C jacket -> women\'s: the line appears, last in the list', s ? `${s.path} ${s.lines.length}` : '')
    check(await page.evaluate(() => window.__noReload === 1), 'C and still no reload')
    await ctx.close()
  }

  // ---------------------------------------------------------------- D. the language toggle
  console.log('\n--- D. the header\'s language toggle')
  {
    const { ctx, page } = await open('phone', 'en')
    await load(page, WOMEN)
    await until(page, (x) => x.lines.length === 1)
    const toggle = () => page.evaluate(() => { const b = document.querySelector('header button[aria-label="Switch language"], header button[aria-label="تغيير اللغة"]'); if (b) b.click(); return !!b })
    check(await toggle(), 'D the header has its language toggle')
    let s = await until(page, (x) => x.lang === 'ar' && x.lines.length === 1 && x.lines[0].text === AR, 4000)
    check(s && s.lang === 'ar' && s.lines.length === 1 && s.lines[0].text === AR, 'D EN -> AR: one line, now in Arabic', s ? `${s.lang} ${JSON.stringify(s.lines.map((l) => l.text))}` : '')
    await toggle()
    s = await until(page, (x) => x.lang === 'en' && x.lines.length === 1 && x.lines[0].text === EN, 4000)
    check(s && s.lang === 'en' && s.lines.length === 1 && s.lines[0].text === EN, 'D AR -> EN: one line, back in English', s ? `${s.lang} ${JSON.stringify(s.lines.map((l) => l.text))}` : '')
    await ctx.close()
  }

  // ---------------------------------------------------------------- E. the owner's own wording
  console.log('\n--- E. the owner has reworded the line in Site wording')
  {
    const OWNER = 'Final sale: no exchanges'
    const { ctx, page } = await open('phone', 'en', (c) => c.route('**/api/api.php?r=site_text*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ 'trust.noExchange': { en: [EN, OWNER] } }) })))
    await load(page, WOMEN)
    const s = await until(page, (x) => x.lines.length >= 1 && x.lines[0].text === OWNER)
    check(s && s.lines.length === 1 && s.lines[0].text === OWNER, 'E one line, in the owner\'s words (site-text.js swaps it like any of the shop\'s own)', s ? JSON.stringify(s.lines.map((l) => l.text)) : '')
    const writes = await page.evaluate(() => new Promise((res) => {
      const ul = document.querySelector('h1.product-title').parentElement.parentElement.querySelector(':scope > ul')
      let n = 0
      const mo = new MutationObserver((rs) => { for (const r of rs) n += r.addedNodes.length + r.removedNodes.length + (r.type === 'characterData' ? 1 : 0) })
      mo.observe(ul, { childList: true, subtree: true, characterData: true })
      setTimeout(() => { mo.disconnect(); res(n) }, 2000)
    }))
    check(writes === 0, 'E nothing in the list is rewritten while the page is idle', `${writes} change(s) in 2s`)
    await ctx.close()
  }

  // ---------------------------------------------------------------- F. a product the bundle does not know
  console.log('\n--- F. a product the bundle does not know: it draws its own line, and this steps aside')
  {
    const SLUG = 'zz-noexline-unknown'
    const { ctx, page } = await open('phone', 'en', (c) => c.route('**/api/api.php?r=products*', async (route) => {
      const r = await route.fetch(); const j = await r.json(); const a = Array.isArray(j) ? j : j.products
      a.push({ ...a.find((p) => p.slug === WOMEN), slug: SLUG, name_en: 'Rig Unknown Leggings', name_ar: 'لقطة اختبار' })
      await route.fulfill({ response: r, body: JSON.stringify(j), headers: { ...r.headers(), 'content-type': 'application/json' } })
    }))
    await load(page, SLUG)
    const s = await until(page, (x) => x.lines.length >= 1)
    await page.waitForTimeout(500)
    const s2 = await state(page)
    check(s && s2 && s2.lines.length === 1 && s2.lines[0].mine === false, 'F exactly one line, and it is the bundle\'s own', s2 ? JSON.stringify(s2.lines.map((l) => (l.mine ? 'overlay:' : 'bundle:') + l.text)) : 'no list')
    await ctx.close()
  }

  // ---------------------------------------------------------------- G. P3, the Arabic delivery line
  console.log('\n--- G. the Arabic delivery line, saved through the panel\'s settings_save')
  {
    const ORIG_AR = 'التوصيل خلال ٢٤ ساعة · ١ د.ك', DASH_AR = 'التوصيل خلال ٢٤ ساعة — ١ د.ك', ORIG_EN = 'Delivery within 24 hours · 1 KWD'
    const bundle = readFileSync(ROOT + 'assets/' + /src="\/assets\/(index-[A-Za-z0-9_-]+\.js)"/.exec(readFileSync(ROOT + 'index.html', 'utf8'))[1], 'utf8')
    check(bundle.includes('trust:{delivery:`' + ORIG_AR + '`'), 'G the bundle\'s Arabic trust.delivery is the original this entry matches on')
    const keepRow = sql("select quote(value) from settings where name = 'site_text'") || null
    const fee = JSON.parse(sql("select value from settings where name = 'rules'") || '{}').delivery_fee_fils ?? 1000
    check(fee === 1000, 'G the sandbox fee is 1.000 KWD, the fee this wording holds at (rules-live.js rewrites it first at any other)', String(fee))
    const { ctx, page } = await open('phone', 'ar')
    const admin = (route, body) => ctx.request.post(`${BASE}/api/admin.php?r=${route}`, { headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' }, data: body, failOnStatusCode: false })
    try {
      if (MUTATE !== 'p3') {
        const lg = await admin('login', { email: EMAIL, password: PASSWORD })
        check(lg.status() === 200, 'G signed in to the panel', String(lg.status()))
        const cur = await (await fetch(`${BASE}/api/api.php?r=site_text`)).json()
        const row = Array.isArray(cur) ? {} : cur
        row['trust.delivery'] = { ...(row['trust.delivery'] || {}), ar: [ORIG_AR, DASH_AR] }
        const sv = await admin('settings_save', { name: 'site_text', value: row })
        check(sv.status() === 200, 'G settings_save accepted the whole row with the one entry changed', String(sv.status()))
      }
      const texts = async () => page.evaluate(() => { const out = []; const w = document.createTreeWalker(document.querySelector('main') || document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (/٢٤ ساعة|24 hours/.test(t)) out.push(t) } return out })
      const settleText = async (want) => { const end = Date.now() + 5000; let t = []; do { t = await texts(); if (t.length && t.every(want)) break; await page.waitForTimeout(150) } while (Date.now() < end); return t }
      await load(page, JACKET)
      let t = await settleText((x) => x.includes('—'))
      const li = t.filter((x) => x.startsWith('التوصيل'))
      check(li.length >= 1 && li.every((x) => x === DASH_AR), 'G Arabic product page: the delivery line reads "… ساعة — ١ د.ك"', JSON.stringify(li))
      check(li.length >= 1 && li.every((x) => !x.includes('·')), 'G and no middle dot sits beside ١ (it reads as ٠: ١٠ د.ك)', JSON.stringify(li))
      await page.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500)
      t = await settleText((x) => !x.startsWith('التوصيل') || x.includes('—'))
      const ab = t.filter((x) => x.startsWith('التوصيل'))
      check(ab.length >= 1 && ab.every((x) => x === DASH_AR), 'G About page: the same one entry fixes its heading (no second change)', JSON.stringify(ab))
      const en = await open('phone', 'en')
      await load(en.page, JACKET)
      const te = await en.page.evaluate(() => [...document.querySelectorAll('main li')].map((l) => l.textContent.trim()).filter((x) => /24 hours/.test(x)))
      check(te.length >= 1 && te.every((x) => x === ORIG_EN), 'G English is untouched', JSON.stringify(te))
      await en.ctx.close()
    } finally {
      if (keepRow) sql(`insert into settings (name, value) values ('site_text', ${keepRow}) on duplicate key update value = values(value)`)
      else sql("delete from settings where name = 'site_text'")
      const back = sql("select quote(value) from settings where name = 'site_text'") || null
      check(back === keepRow, 'G the sandbox\'s site_text is back exactly as it was', keepRow ? 'restored' : 'there was no row, and there is none')
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}

console.log(fails ? `\nFAILED — ${fails} of ${passes + fails}` : `\nall ok — ${passes} checks`)
process.exit(fails ? 1 : 0)
