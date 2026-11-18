// The storefront half of the text style editor (TEXTSTYLE-1118), in a real browser:
//   public/boot.js                 puts the saved copy's size / heading weight on <html> before the first paint
//   public/sporta-features.js      the TEXT STYLE block: reads the public ?r=text_style, keeps the copy, follows the language toggle
//   public/sporta-brand-theme.css  the TEXTSTYLE-1118 section: data-sporta-size -> root font size, data-sporta-hw -> heading weight
// The admin half is scripts/admin-text-styles-test.mjs; the server half is the TEXT STYLE section of admin-storefront-sync-test.mjs.
//
//   npm run test:text-style      (no database, no PHP: the one API route it needs is answered here)
//
// The page is a small fixture served from a fake origin under the live CSP (script-src 'self'), with the REAL boot.js, the REAL
// sporta-features.js and the REAL stylesheet. Headings carry the compiled bundle's one-class weights (.font-extrabold, .font-bold,
// .font-display) so the rule has to beat them, the way it does on the live page.
//
// MUTATION: the suite cuts the CSS section and the boot.js block and requires the checks that depend on them to fail.
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PUB = new URL('../public/', import.meta.url)
const read = (n) => readFileSync(new URL(n, PUB), 'utf8')
const BOOT = read('boot.js'), FEATURES = read('sporta-features.js'), THEME_CSS = read('sporta-brand-theme.css')
const ORIGIN = 'https://sporta.test'
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
const CHROME = process.env.CHROMIUM_PATH || undefined

let passes = 0, fails = 0
const is = (c, n, d = '') => { if (c) { passes++; console.log(`ok   ${n}${d ? `  - ${d}` : ''}`) } else { fails++; console.log(`FAIL ${n}${d ? `  - ${d}` : ''}`) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

const FIXTURE_CSS = `
html{font-size:100%}
body{margin:0;font-family:system-ui,sans-serif;font-size:1rem;font-weight:400}
.font-extrabold{font-weight:800}.font-bold{font-weight:700}.font-display{font-family:serif}
h1,h2{margin:0}
`
const page = () => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Sporta</title>
<link rel="stylesheet" href="/fixture.css"><link rel="stylesheet" href="/sporta-brand-theme.css">
<script src="/boot.js"></script><script src="/probe.js"></script></head>
<body><div class="storefront-root"><h1 class="font-extrabold">Title</h1><h2 class="font-bold">Section</h2>
<p class="font-display font-bold" id="price">KWD 10.000</p><p id="body">Some body text.</p></div>
<script src="/sporta-features.js" defer></script></body></html>`

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })

/**
 * Opens the fixture. `answer` is what ?r=text_style answers: an object (200), a number (that status) or a function(req) -> {status, body, delay}.
 * `stored` is the localStorage copy put there BEFORE the page runs. `files` swaps a served file (the mutants).
 */
async function open(path, { answer = { size_en: 100, size_ar: 100, heading_weight_en: 0, heading_weight_ar: 0 }, stored = null, files = {}, delay = 0, wait = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } })
  const requests = [], errors = []
  await ctx.addInitScript((s) => { try { if (s !== null) localStorage.setItem('sporta_text_style', s) } catch (e) {} }, stored)
  await ctx.route(ORIGIN + '/**', async (route) => {
    const u = new URL(route.request().url()), p = u.pathname
    const served = {
      '/boot.js': ['text/javascript', files['boot.js'] ?? BOOT],
      '/sporta-features.js': ['text/javascript', files['sporta-features.js'] ?? FEATURES],
      '/sporta-brand-theme.css': ['text/css', files['sporta-brand-theme.css'] ?? THEME_CSS],
      '/fixture.css': ['text/css', FIXTURE_CSS],
      // what boot.js alone has done by the time the head is parsed: the first paint cannot be earlier than this
      '/probe.js': ['text/javascript', "window.__atHead = { size: document.documentElement.getAttribute('data-sporta-size'), hw: document.documentElement.getAttribute('data-sporta-hw') }"],
    }[p]
    if (served) return route.fulfill({ status: 200, contentType: served[0], body: served[1] })
    if (p === '/api/api.php') {
      const r = u.searchParams.get('r')
      requests.push(r)
      if (r === 'text_style') {
        if (delay) await new Promise((ok) => setTimeout(ok, delay))
        if (typeof answer === 'number') return route.fulfill({ status: answer, contentType: 'application/json', body: '{"error":"x"}' })
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) })
      }
      if (r === 'brands' || r === 'stock') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      if (r === 'content') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"v":0,"overrides":[],"contact":{}}' })
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' })
    }
    if (p === '/images/products/responsive/variants.txt' || p === '/favicon.ico') return route.fulfill({ status: p.endsWith('.txt') ? 404 : 204, body: '' })
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP }, body: page() })
  })
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => errors.push(String(e.message).slice(0, 140)))
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 140)) })
  await pg.goto(ORIGIN + path, { waitUntil: wait ? 'load' : 'domcontentloaded' })
  if (wait) await pg.waitForTimeout(250)
  return { ctx, pg, requests, errors }
}
const probe = (pg) => pg.evaluate(() => {
  const d = document.documentElement, cs = (e) => getComputedStyle(document.querySelector(e))
  return {
    size: d.getAttribute('data-sporta-size'), hw: d.getAttribute('data-sporta-hw'), root: parseFloat(getComputedStyle(d).fontSize),
    h1: cs('h1').fontWeight, h2: cs('h2').fontWeight, price: cs('#price').fontWeight, bodyW: cs('#body').fontWeight, bodyPx: parseFloat(cs('#body').fontSize),
    saved: (() => { try { return localStorage.getItem('sporta_text_style') } catch (e) { return 'denied' } })(), lang: d.lang,
  }
})
const S = (o) => JSON.stringify(o)
// a stored copy or an answer compared by its values (the key order is not part of the contract)
const same = (raw, want) => { try { const a = JSON.parse(raw); return Object.keys(want).every((k) => a[k] === want[k]) && Object.keys(a).length === Object.keys(want).length } catch (e) { return false } }

// ---------------------------------------------------------------------------------------------------------------- 1
head('the designed values change nothing')
{
  const { ctx, pg, requests, errors } = await open('/?lang=en')
  const m = await probe(pg)
  is(m.size === null && m.hw === null, 'no data attribute is set when the answer equals the design', `${m.size} ${m.hw}`)
  is(m.root === 16 && m.h1 === '800' && m.h2 === '700' && m.price === '700', 'the page is what the bundle drew: 16px root, weights 800 / 700 / 700', `${m.root} ${m.h1}/${m.h2}/${m.price}`)
  is(requests.filter((r) => r === 'text_style').length === 1, 'one request for the style per page load', requests.join(','))
  is(m.saved === null || same(m.saved, { size_en: 100, size_ar: 100, heading_weight_en: 0, heading_weight_ar: 0 }), 'at most a copy of the designed values is kept', String(m.saved))
  is(errors.length === 0, 'no page error or console error (CSP included)', errors.join(' | '))
  await ctx.close()
}

// ---------------------------------------------------------------------------------------------------------------- 2
head('a first visit: the answer is applied once it arrives')
{
  const A = { size_en: 110, size_ar: 90, heading_weight_en: 900, heading_weight_ar: 600 }
  let { ctx, pg } = await open('/?lang=en', { answer: A })
  let m = await probe(pg)
  is(m.size === '110' && m.hw === '900', 'English: data-sporta-size="110" and data-sporta-hw="900" on <html>', `${m.size} ${m.hw}`)
  is(Math.abs(m.root - 17.6) < 0.01, 'the root font size is 110% of 16px', `${m.root}`)
  is(m.h1 === '900' && m.h2 === '900' && m.price === '900', 'headings and .font-display beat the bundle\'s one-class weights', `${m.h1}/${m.h2}/${m.price}`)
  is(m.bodyW === '400' && Math.abs(m.bodyPx - 17.6) < 0.01, 'body text keeps its weight and follows the size', `${m.bodyW} ${m.bodyPx}px`)
  is(same(m.saved, A), 'a copy is kept for the next visit', String(m.saved))
  await ctx.close()
  ;({ ctx, pg } = await open('/?lang=ar', { answer: A }))
  m = await probe(pg)
  is(m.lang === 'ar' && m.size === '90' && m.hw === '600' && Math.abs(m.root - 14.4) < 0.01 && m.h1 === '600', 'Arabic takes the Arabic values (90%, weight 600)', `${m.size} ${m.hw} ${m.root} ${m.h1}`)
  await pg.evaluate(() => { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr' })
  await pg.waitForTimeout(150)
  m = await probe(pg)
  is(m.size === '110' && m.hw === '900' && Math.abs(m.root - 17.6) < 0.01, 'the language toggle (<html lang> changed in place) switches to the other language\'s values', `${m.size} ${m.hw}`)
  await pg.evaluate(() => { document.documentElement.lang = 'ar' })
  await pg.waitForTimeout(150)
  m = await probe(pg)
  is(m.size === '90' && m.hw === '600', 'and back', `${m.size} ${m.hw}`)
  await ctx.close()
  for (const w of [600, 700, 800]) {
    ;({ ctx, pg } = await open('/?lang=en', { answer: { size_en: 100, size_ar: 100, heading_weight_en: w, heading_weight_ar: 0 } }))
    m = await probe(pg)
    is(m.h1 === String(w) && m.size === null && m.root === 16, `weight ${w} alone: headings ${w}, size untouched`, `${m.h1} ${m.size}`)
    await ctx.close()
  }
  for (const s of [90, 95, 105, 115, 120]) {
    ;({ ctx, pg } = await open('/?lang=en', { answer: { size_en: s, size_ar: 100, heading_weight_en: 0, heading_weight_ar: 0 } }))
    m = await probe(pg)
    is(Math.abs(m.root - 16 * s / 100) < 0.01 && m.hw === null && m.h1 === '800', `size ${s}% alone: root ${16 * s / 100}px, weights as designed`, `${m.root} ${m.h1}`)
    await ctx.close()
  }
}

// ---------------------------------------------------------------------------------------------------------------- 3
head('a returning visitor: the saved copy is applied before the first paint')
{
  const COPY = S({ size_en: 115, size_ar: 100, heading_weight_en: 700, heading_weight_ar: 0 })
  const { ctx, pg } = await open('/?lang=en', { stored: COPY, answer: { size_en: 115, size_ar: 100, heading_weight_en: 700, heading_weight_ar: 0 }, delay: 1200, wait: false })
  const early = await pg.evaluate(() => ({ head: window.__atHead, size: document.documentElement.getAttribute('data-sporta-size'), hw: document.documentElement.getAttribute('data-sporta-hw'), root: parseFloat(getComputedStyle(document.documentElement).fontSize) }))
  is(early.head && early.head.size === '115' && early.head.hw === '700', 'boot.js had set both while the head was still being parsed (before any later script, before the body and so before the first paint)', S(early.head))
  is(early.size === '115' && early.hw === '700' && Math.abs(early.root - 18.4) < 0.01, 'at DOMContentLoaded, with the API still unanswered, the root is 18.4px', S(early))
  await pg.waitForTimeout(1500)
  const m = await probe(pg)
  is(m.size === '115' && m.hw === '700', 'the answer, equal to the copy, changes nothing', `${m.size} ${m.hw}`)
  await ctx.close()
}

// ---------------------------------------------------------------------------------------------------------------- 4
head('the owner changed something: the copy is replaced and applied')
{
  const OLD = S({ size_en: 115, size_ar: 100, heading_weight_en: 700, heading_weight_ar: 0 })
  let { ctx, pg } = await open('/?lang=en', { stored: OLD, answer: { size_en: 100, size_ar: 100, heading_weight_en: 0, heading_weight_ar: 0 } })
  let m = await probe(pg)
  is(m.size === null && m.hw === null && m.root === 16 && m.h1 === '800', 'the shop went back to the design: both attributes are removed', `${m.size} ${m.hw} ${m.root}`)
  is(same(m.saved, { size_en: 100, size_ar: 100, heading_weight_en: 0, heading_weight_ar: 0 }), 'and the copy is the new answer', String(m.saved))
  await ctx.close()
  ;({ ctx, pg } = await open('/?lang=en', { stored: OLD, answer: { size_en: 105, size_ar: 100, heading_weight_en: 800, heading_weight_ar: 0 } }))
  m = await probe(pg)
  is(m.size === '105' && m.hw === '800', 'a different non-default answer replaces the copy and is applied', `${m.size} ${m.hw}`)
  await ctx.close()
}

// ---------------------------------------------------------------------------------------------------------------- 5
head('bad data is ignored')
{
  for (const [label, answer] of [['a size not on the list', { size_en: 77, size_ar: 100, heading_weight_en: 0, heading_weight_ar: 0 }],
    ['a weight not on the list', { size_en: 100, size_ar: 100, heading_weight_en: 500, heading_weight_ar: 0 }],
    ['a missing key', { size_en: 110, heading_weight_en: 0 }], ['a string where a number belongs', { size_en: '110', size_ar: 100, heading_weight_en: 0, heading_weight_ar: 0 }],
    ['an array', [1, 2, 3]], ['an HTTP 500', 500]]) {
    const { ctx, pg, errors } = await open('/?lang=en', { answer })
    const m = await probe(pg)
    is(m.size === null && m.hw === null && m.root === 16 && m.saved === null && errors.length === 0, `${label}: nothing is applied or kept, no error`, `${m.size} ${m.hw} ${m.saved} ${errors.join('|')}`)
    await ctx.close()
  }
  for (const stored of ['not json', '{"size_en":12345,"size_ar":100,"heading_weight_en":0,"heading_weight_ar":0}', 'null', '[]']) {
    const { ctx, pg, errors } = await open('/?lang=en', { stored, answer: 500 })
    const m = await probe(pg)
    is(m.size === null && m.hw === null && m.root === 16 && errors.length === 0, `a stored copy that is not valid (${stored.slice(0, 20)}): ignored, the page still runs`, `${m.size} ${m.hw} ${errors.join('|')}`)
    await ctx.close()
  }
  const { ctx, pg } = await open('/?lang=en', { stored: S({ size_en: 110, size_ar: 100, heading_weight_en: 0, heading_weight_ar: 0 }), answer: 500 })
  const m = await probe(pg)
  is(m.size === '110', 'with the server down, the last copy still applies', `${m.size}`)
  await ctx.close()
}

// ---------------------------------------------------------------------------------------------------------------- 6
head('the admin is not styled and asks for nothing')
{
  const { ctx, pg, requests } = await open('/backends', { stored: S({ size_en: 120, size_ar: 120, heading_weight_en: 900, heading_weight_ar: 900 }), answer: { size_en: 120, size_ar: 120, heading_weight_en: 900, heading_weight_ar: 900 } })
  const m = await probe(pg)
  is(m.size === null && m.hw === null && m.root === 16, '/backends: no attribute even with a saved copy', `${m.size} ${m.hw} ${m.root}`)
  is(!requests.includes('text_style'), '/backends: no request for the style', requests.join(','))
  await ctx.close()
}

// ---------------------------------------------------------------------------------------------------------------- 7
head('mutation: each part is needed')
{
  const A = { size_en: 110, size_ar: 100, heading_weight_en: 900, heading_weight_ar: 0 }
  const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('mutation anchor missing: ' + a); return src.slice(0, i) + src.slice(j + b.length) }
  const noCss = cut(THEME_CSS, '/* ==== TEXTSTYLE-1118', '/* ==== end TEXTSTYLE-1118 */')
  let { ctx, pg } = await open('/?lang=en', { answer: A, files: { 'sporta-brand-theme.css': noCss } })
  let m = await probe(pg)
  is(m.size === '110' && m.root === 16 && m.h1 === '800', 'without the CSS section the attributes are set and NOTHING changes (so the CSS is what does the work)', `${m.root} ${m.h1}`)
  await ctx.close()
  const noBoot = BOOT.replace(/if \(!backend\) \{\n\s*\/\/ its own guard[\s\S]*?\/\* no saved style: the design as it is \*\/ \}\n\s*\}\n/, '')
  if (noBoot === BOOT) throw new Error('boot mutation did not apply')
  ;({ ctx, pg } = await open('/?lang=en', { stored: S(A), answer: A, delay: 1200, wait: false, files: { 'boot.js': noBoot } }))
  const early = await pg.evaluate(() => window.__atHead)
  is(early && early.size === null && early.hw === null, 'without the boot.js block nothing is set while the head is parsed (so boot.js is what prevents the resize)', S(early))
  await ctx.close()
  const noFeat = FEATURES.replace("fetch('/api/api.php?r=text_style'", "fetch('/api/api.php?r=text_style_off'")
  if (noFeat === FEATURES) throw new Error('features mutation did not apply')
  ;({ ctx, pg } = await open('/?lang=en', { answer: A, files: { 'sporta-features.js': noFeat } }))
  m = await probe(pg)
  is(m.size === null, 'without the features.js request a first visit is the designed look (so that block is what reads the answer)', String(m.size))
  await ctx.close()
}

await browser.close()
console.log(`\n${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
