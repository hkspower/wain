// Full-site audit of the packaged build.
//
// Crawls every public route in both languages, both themes and two viewports,
// and reports what is actually wrong rather than what was intended. Written to
// find things, not to produce a green tick: the whole history of this project
// is failures that looked fine.
//
// Needs dist/ (or the unpacked package) served on :8188 with SPA routing, plus
// the PostgREST shim on :8130 for the pages that read the database.
import { chromium } from 'playwright'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ORIGIN = 'http://www.sporta.com.kw'
const ROOT = '/tmp/site'

const PRODUCTS = (() => {
  const w = {}
  new Function('window', readFileSync('/home/user/wain/sporta-html5/assets/products.js', 'utf8'))(w)
  return w.SPORTA_PRODUCTS
})()

const ROUTES = [
  { path: '/', name: 'Home' },
  { path: '/shop', name: 'Shop' },
  { path: '/about', name: 'About' },
  { path: '/contact', name: 'Contact' },
  { path: '/returns', name: 'Returns' },
  { path: '/track', name: 'Track order' },
  { path: '/cart', name: 'Cart' },
  { path: '/checkout', name: 'Checkout' },
  { path: '/wishlist', name: 'Wishlist' },
  { path: `/product/${PRODUCTS[0].slug}`, name: 'Product' },
  { path: '/payment/result?status=success&trackid=AUDIT1', name: 'Payment result' },
]

const findings = []
const add = (sev, area, what, where = '') => findings.push({ sev, area, what, where })

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--host-resolver-rules=MAP www.sporta.com.kw 127.0.0.1:8188', '--no-proxy-server'],
})

const CART = [{
  slug: PRODUCTS[0].slug, qty: 2, price: PRODUCTS[0].price,
  name: PRODUCTS[0].name,
  // The real artwork. Seeding image:'' made every page report a broken image —
  // an empty src is complete with naturalWidth 0, and the cart drawer is always
  // in the DOM. That was the audit lying about the site, which is the exact
  // failure mode it exists to catch.
  image: PRODUCTS[0].image,
}]

async function visit(path, { lang = 'en', theme = null, mobile = false } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 393, height: 852 } : { width: 1440, height: 1000 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1,
  })
  await ctx.addInitScript(
    ({ l, th, cart }) => {
      localStorage.setItem('lang', l)
      if (th) localStorage.setItem('sporta_theme', th)
      localStorage.setItem('sporta_cart', JSON.stringify(cart))
    },
    { l: lang, th: theme, cart: CART },
  )
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('JS: ' + e.message.slice(0, 120)))
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !/ERR_CERT|favicon|fonts\.googleapis/.test(t)) errors.push('console: ' + t.slice(0, 120))
    if (/Content Security Policy|Refused to/.test(t)) errors.push('CSP: ' + t.slice(0, 120))
  })
  const resp = await page.goto(ORIGIN + path, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(250)
  return { ctx, page, errors, status: resp?.status() ?? 0 }
}

// ---------------------------------------------------------------- 1. routes
console.log('crawling routes…')
const meta = new Map()
for (const r of ROUTES) {
  for (const lang of ['en', 'ar']) {
    const { ctx, page, errors, status } = await visit(r.path, { lang })
    const info = await page.evaluate(() => {
      const q = (s) => document.querySelector(s)
      return {
        title: document.title,
        desc: q('meta[name=description]')?.content ?? '',
        canonical: q('link[rel=canonical]')?.href ?? '',
        robots: q('meta[name=robots]')?.content ?? '',
        dir: document.documentElement.dir,
        htmlLang: document.documentElement.lang,
        h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        imgsNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
        imgsBroken: [...document.querySelectorAll('img')]
          .filter((i) => (i.getAttribute('src') || '').trim() !== '')
          .filter((i) => i.complete && i.naturalWidth === 0)
          .map((i) => (i.getAttribute('src') || '').slice(0, 60)),
        inputsNoLabel: [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]), select, textarea')]
          .filter((el) => !el.labels?.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')).length,
        dupIds: (() => {
          const seen = new Set(), dup = new Set()
          document.querySelectorAll('[id]').forEach((e) => (seen.has(e.id) ? dup.add(e.id) : seen.add(e.id)))
          return [...dup]
        })(),
        links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
      }
    })
    const key = `${r.name} (${lang})`
    if (lang === 'en') meta.set(r.name, info)

    if (status !== 200) add('HIGH', 'routing', `HTTP ${status}`, key)
    if (info.h1.length === 0) add('HIGH', 'a11y/seo', 'no <h1>', key)
    if (info.h1.length > 1) add('MED', 'a11y/seo', `${info.h1.length} <h1> elements`, key)
    if (info.scrollW > info.clientW + 1) add('HIGH', 'layout', `horizontal scroll (${info.scrollW} > ${info.clientW})`, key)
    if (info.imgsNoAlt) add('MED', 'a11y', `${info.imgsNoAlt} image(s) without alt`, key)
    for (const src of info.imgsBroken) add('HIGH', 'content', `broken image: ${src}`, key)
    if (info.inputsNoLabel) add('MED', 'a11y', `${info.inputsNoLabel} form field(s) with no label`, key)
    if (info.dupIds.length) add('MED', 'html', `duplicate id: ${info.dupIds.join(', ')}`, key)
    if (lang === 'ar' && info.dir !== 'rtl') add('HIGH', 'i18n', `dir is "${info.dir}", expected rtl`, key)
    if (lang === 'ar' && info.htmlLang !== 'ar') add('MED', 'i18n', `html lang is "${info.htmlLang}"`, key)
    for (const e of errors) add('HIGH', 'runtime', e, key)
    await ctx.close()
  }
  process.stdout.write('.')
}
console.log()

// ------------------------------------------------------- 2. SEO uniqueness
const titles = new Map(), descs = new Map()
for (const [name, m] of meta) {
  if (!m.title) add('HIGH', 'seo', 'empty <title>', name)
  if (!m.desc) add('MED', 'seo', 'no meta description', name)
  // Only judge a canonical that exists. Checking the origin of an empty string
  // reported every noindex page as "off-origin", which is nonsense.
  const noindex = /noindex/.test(m.robots)
  if (!m.canonical) {
    if (!noindex) add('MED', 'seo', 'no canonical', name)
  } else if (!m.canonical.startsWith('https://www.sporta.com.kw')) {
    add('HIGH', 'seo', `canonical off-origin: ${m.canonical}`, name)
  }
  titles.set(m.title, [...(titles.get(m.title) ?? []), name])
  descs.set(m.desc, [...(descs.get(m.desc) ?? []), name])
}
// Duplicates only matter on pages search engines actually index.
const indexable = (n) => !/noindex/.test(meta.get(n)?.robots ?? '')
for (const [t, pages] of titles) {
  const idx = pages.filter(indexable)
  if (idx.length > 1 && t) add('MED', 'seo', `duplicate <title> "${t.slice(0, 40)}…"`, idx.join(', '))
}
for (const [d, pages] of descs) {
  const idx = pages.filter(indexable)
  if (idx.length > 1 && d) add('MED', 'seo', 'duplicate meta description', idx.join(', '))
}

// --------------------------------------------------- 3. internal link check
console.log('checking internal links…')
const allLinks = new Set()
for (const [, m] of meta) for (const h of m.links) if (h?.startsWith('/')) allLinks.add(h.split('#')[0])
const linkTargets = new Map()
for (const href of allLinks) {
  const r = await fetch(`http://127.0.0.1:8188${href}`, { redirect: 'manual' })
  linkTargets.set(href, r.status)
  if (r.status >= 400) add('HIGH', 'links', `internal link ${href} -> HTTP ${r.status}`)
}

// Links that resolve but land somewhere unrelated to their label are worse
// than 404s: nothing reports them and the visitor just gets the wrong page.
const { ctx: fctx, page: fpage } = await visit('/', { lang: 'en' })
const footer = await fpage.evaluate(() =>
  [...document.querySelectorAll('footer a[href^="/"]')].map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })))
await fctx.close()
const mislabelled = footer.filter((l) => {
  const t = l.text.toLowerCase()
  if (/terms|privacy|shipping|why/.test(t) && l.href === '/about') return true
  if (/track/.test(t) && l.href !== '/track') return true
  return false
})
for (const l of mislabelled) add('MED', 'links', `"${l.text}" points at ${l.href} — no such page exists`, 'Footer')

// ------------------------------------------------- 4. themes and viewports
console.log('themes and viewports…')
for (const theme of [null, 'dark']) {
  for (const mobile of [false, true]) {
    for (const path of ['/', '/shop', '/checkout']) {
      const { ctx, page, errors } = await visit(path, { theme, mobile })
      const r = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
      }))
      const tag = `${path} ${theme ?? 'light'}/${mobile ? 'mobile' : 'desktop'}`
      if (r.sw > r.cw + 1) add('HIGH', 'layout', `horizontal scroll (${r.sw} > ${r.cw})`, tag)
      for (const e of errors) add('HIGH', 'runtime', e, tag)
      await ctx.close()
    }
  }
}

// ---------------------------------------------------------- 5. 404 handling
{
  const r = await fetch(`http://127.0.0.1:8188/definitely-not-a-page-xyz`)
  if (r.status !== 404) add('HIGH', 'routing', `unknown URL returns HTTP ${r.status}, expected 404 (soft 404 hurts SEO)`)
}

// ------------------------------------------------------------ 6. asset size
const assetDir = join(ROOT, 'assets')
let total = 0
const big = []
for (const f of readdirSync(assetDir)) {
  const s = statSync(join(assetDir, f)).size
  total += s
  if (/\.js$/.test(f) && s > 300_000) big.push(`${f} ${(s / 1024).toFixed(0)}kB`)
}
for (const b of big) add('LOW', 'perf', `large bundle: ${b}`)

await browser.close()

// ------------------------------------------------------------------ report
const order = { HIGH: 0, MED: 1, LOW: 2 }
findings.sort((a, b) => order[a.sev] - order[b.sev])
console.log(`\n${'='.repeat(72)}`)
console.log(`FULL SITE AUDIT — ${ROUTES.length} routes x 2 languages, 2 themes, 2 viewports`)
console.log(`total asset weight: ${(total / 1024).toFixed(0)} kB`)
console.log('='.repeat(72))
if (!findings.length) {
  console.log('\nNo problems found.')
} else {
  let last = ''
  for (const f of findings) {
    if (f.sev !== last) { console.log(`\n--- ${f.sev} ---`); last = f.sev }
    console.log(`  [${f.area}] ${f.what}${f.where ? `   (${f.where})` : ''}`)
  }
}
console.log(`\n${findings.filter((f) => f.sev === 'HIGH').length} high, ` +
            `${findings.filter((f) => f.sev === 'MED').length} medium, ` +
            `${findings.filter((f) => f.sev === 'LOW').length} low`)
