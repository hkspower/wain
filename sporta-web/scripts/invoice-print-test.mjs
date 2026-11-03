// The invoice's LAYOUT and its PRINTED page, in a real browser — rig-free.
//
//   node scripts/invoice-print-test.mjs
//
// Not `npm run test:invoice`. That suite needs the shared test rig (`vite
// preview` on :4173) and asserts direction, wording and arithmetic. This one
// starts its OWN Vite dev server on a free port, stubs the order request in the
// browser with fake orders (no database, no PHP, no customer data), and asserts
// what a person would see on a phone and on paper:
//
//   SCREEN   no sideways scroll at 360/390/768/1280; the item column is wide
//            enough to read on a phone; both product names share one edge; the
//            discount figure sits in the money column; the promo name reads in
//            the right order next to the word "Discount"; the total's label and
//            figure never touch; every piece of text clears 4.5:1 on white.
//   PRINT    emulated print media AND a real A4 PDF (page.pdf), in Arabic and
//            English, in the light AND the dark theme: the totals print once, no
//            "Skip to content" button on any page, no near-empty trailing page,
//            no charcoal anywhere on the sheet (the root's inline background, the
//            dark theme's remaps and the inline `color-scheme: dark` all leaked
//            onto paper), the Print button is gone, and the table keeps its
//            direction, its repeating header and its unbroken rows.
//
// The PDF checks use poppler (`pdftotext`, `pdftoppm`) and are SKIPPED, loudly,
// when it is not installed; every DOM check still runs.
//
//   ROOT=/path/to/another/sporta-web node scripts/invoice-print-test.mjs
//     runs the same suite against a different checkout — how a mutation check
//     proves the suite FAILS on the code before these fixes.
//   CHROMIUM_PATH=...   the browser (default /opt/pw-browsers/chromium).
//   INVOICE_TEST_PORT=  first port to try for the dev server (default 5391).
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(process.env.ROOT ?? path.join(HERE, '..'))
const tmp = mkdtempSync(path.join(tmpdir(), 'invoice-print-'))

let fails = 0
const ok = (n, d = '') => console.log(`ok   ${n}${d ? `  — ${d}` : ''}`)
const bad = (n, d = '') => {
  fails++
  console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`)
}
const is = (c, n, d) => (c ? ok(n, d) : bad(n, d))
const head = (s) => console.log(`\n== ${s}`)
// A section that THROWS (a selector the old markup does not have, a browser
// hiccup) is one failure, not a crashed run: the mutation check against the
// pre-fix code has to be able to finish and say what failed.
async function section(title, fn) {
  head(title)
  try {
    await fn()
  } catch (e) {
    bad(`${title}: the check could not run`, String(e.message).split('\n')[0])
  }
}

const HAVE_POPPLER = ['pdftotext', 'pdftoppm', 'pdfinfo'].every(
  (c) => spawnSync(c, ['-v'], { stdio: 'ignore' }).error == null,
)
if (!HAVE_POPPLER) console.log('SKIP the PDF checks: poppler (pdftotext, pdftoppm, pdfinfo) is not installed')

// --------------------------------------------------------------- fake orders
const SMALL = {
  track_id: 'SPINV0001', placed_at: '2026-07-30T21:13:02Z', paid_at: '2026-07-30T21:15:40Z',
  subtotal: 28.0, discount_amount: 3.0, discount_label: 'Launch 10% off', discount_code: 'SAVE10',
  delivery_fee: 1.0, amount: 26.0, payment_method: 'knet', payment_status: 'paid',
  customer_name: 'فاطمة الصباح',
  address: { governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5', floor: '3', flat: '7' },
  items: [
    { name_en: 'Cloudsoft Jacket — Army Green', name_ar: 'جاكيت كلاودسوفت — أخضر عسكري', qty: 2, size: 'L', fit: 'oversize', unit_price: 10.0, line_total: 20.0 },
    { name_en: 'Cheetahs Rugby T-Shirt', name_ar: 'تيشيرت تشيتاز رَغبي', qty: 1, size: 'M', fit: null, unit_price: 8.0, line_total: 8.0 },
  ],
}
// Thirty-four lines, every third one with a long name in BOTH languages, a long
// promo name, a four-digit total: the order that stresses wrapping, page breaks
// and the width of the money column all at once.
const LONG_EN = 'Sporta Pro Performance Compression Training Tights with Reflective Side Panels and Zip Ankle — Charcoal Black / Bright Orange Edition'
const LONG_AR = 'سروال تدريب ضاغط سبورتا برو للأداء العالي مع شرائط عاكسة جانبية وسحاب عند الكاحل — أسود فحمي / برتقالي ساطع إصدار خاص'
const BIG = {
  ...SMALL, track_id: 'SPINV0042', payment_method: 'cod', payment_status: 'pending', paid_at: null,
  customer_name: 'Abdulaziz Mohammad Al-Mutairi Al-Sabah Al-Salem',
  discount_label: 'Ramadan collection — buy more save more, up to 25% off selected items', discount_code: 'RAMADAN25',
  address: { governorate: 'mubarak_al_kabeer', area: 'Sabah Al-Salem', block: '10', street: '123', building: '45', floor: '12', flat: '1205' },
  items: Array.from({ length: 34 }, (_, i) => ({
    name_en: i % 3 === 0 ? LONG_EN : `Training Tee ${i + 1} — Navy`,
    name_ar: i % 3 === 0 ? LONG_AR : `تيشيرت تدريب ${i + 1} — كحلي`,
    qty: (i % 4) + 1, size: ['S', 'M', 'L', 'XL', '2XL'][i % 5], fit: i % 2 ? 'oversize' : null,
    unit_price: 9.5 + i * 0.25, line_total: (9.5 + i * 0.25) * ((i % 4) + 1),
  })),
}
BIG.subtotal = BIG.items.reduce((s, i) => s + i.line_total, 0) // 1,133.000
BIG.discount_amount = 12.375
BIG.delivery_fee = 2.0
BIG.amount = BIG.subtotal - BIG.discount_amount + BIG.delivery_fee // 1,122.625
const BIG_TOTAL = '1,122.625'

// ------------------------------------------------------------- dev server
const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.js'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: Number(process.env.INVOICE_TEST_PORT ?? 5391), strictPort: false },
})
await server.listen()
const BASE = server.resolvedUrls.local[0].replace(/\/$/, '')
console.log(`invoice-print-test: ${ROOT} served at ${BASE}`)

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
})

async function open(order, { lang, width = 1280, height = 900, scheme = 'light', theme = null }) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', colorScheme: scheme })
  await ctx.addInitScript(([l, t]) => {
    localStorage.setItem('lang', l)
    if (t) localStorage.setItem('sporta_theme', t)
  }, [lang, theme])
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('   [pageerror]', e.message))
  await page.route('**/config.js', (r) =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.SPORTA_CONFIG={};' }))
  await page.route(
    (u) => u.pathname.endsWith('/api.php') && u.searchParams.get('r') === 'invoice',
    (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(order) }),
  )
  await page.goto(`${BASE}/invoice/${order.track_id}`, { waitUntil: 'networkidle' })
  await page.locator('table').waitFor({ timeout: 20000 })
  // Fonts load on demand by unicode-range. Printing before they have arrived
  // prints the fallback face, which is a test artefact, not a page defect.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(900)
  return { ctx, page }
}

// ---- poppler helpers: a P6 PPM is a header and raw RGB, no decoder needed.
function ppm(file) {
  const b = readFileSync(file)
  const m = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(b.subarray(0, 40).toString('latin1'))
  const w = Number(m[1]), h = Number(m[2]), off = m[0].length
  const lum = (x, y) => {
    const i = off + (y * w + x) * 3
    return (0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2]) / 255
  }
  let sum = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sum += lum(x, y)
  return { w, h, mean: sum / (w * h), lum }
}
function pdfOf(page, name) {
  const file = path.join(tmp, `${name}.pdf`)
  return page.pdf({ path: file, format: 'A4', preferCSSPageSize: true }).then(() => file)
}
const pages = (f) => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f]).toString())[1])
const text = (f, first, last) =>
  execFileSync('pdftotext', ['-layout', ...(first ? ['-f', String(first), '-l', String(last ?? first)] : []), f, '-']).toString()
const raster = (f, base) => {
  execFileSync('pdftoppm', ['-r', '30', f, path.join(tmp, base)])
  return execFileSync('ls', [tmp]).toString().split('\n').filter((n) => n.startsWith(`${base}-`) && n.endsWith('.ppm'))
    .sort().map((n) => ppm(path.join(tmp, n)))
}

// ================================================================== SCREEN
await section('screen: no sideways scroll, a readable item column on a phone', async () => {
  for (const lang of ['ar', 'en']) {
    for (const width of [360, 390, 768, 1280]) {
      const { ctx, page } = await open(BIG, { lang, width, height: 800 })
      const m = await page.evaluate(() => {
        const de = document.documentElement
        const art = document.querySelector('article').getBoundingClientRect()
        const tb = document.querySelector('table').getBoundingClientRect()
        return { sw: de.scrollWidth, cw: de.clientWidth, over: Math.round(Math.max(tb.right - art.right, art.left - tb.left, 0)) }
      })
      is(m.sw <= m.cw, `${lang} ${width}px: the page does not scroll sideways (long names, a four-digit total)`, `scrollWidth ${m.sw} vs ${m.cw}`)
      is(m.over <= 1, `${lang} ${width}px: the table stays inside the invoice card`, `${m.over}px outside`)
      await ctx.close()
    }
    // The ordinary two-line order on a 390px phone: the item column used to be
    // 78-81px, one word to a line.
    const { ctx, page } = await open(SMALL, { lang, width: 390, height: 800 })
    const itemW = await page.$eval('thead th', (e) => Math.round(e.getBoundingClientRect().width))
    is(itemW >= 120, `${lang} 390px: the item column is wide enough to read`, `${itemW}px (was 78-81)`)
    await ctx.close()
  }
})

await section('screen: product names, the discount line, the total', async () => {
  for (const lang of ['ar', 'en']) {
    const { ctx, page } = await open(SMALL, { lang, width: 1000 })
    // The two names of one product share the start edge of the column. The
    // direction lives on an inline span INSIDE a block that keeps the page's
    // direction; on the block itself, `start` meant a different edge for each.
    const e = await page.evaluate(() => {
      const spans = [...document.querySelector('tbody td').querySelectorAll(':scope > span.block')]
      const edge = (s) => {
        const r = document.createRange()
        r.selectNodeContents(s)
        const b = r.getBoundingClientRect()
        return { l: b.left, r: b.right }
      }
      return { rtl: getComputedStyle(document.querySelector('tbody td')).direction === 'rtl', a: edge(spans[0]), b: edge(spans[1]) }
    })
    const gap = e.rtl ? Math.abs(e.a.r - e.b.r) : Math.abs(e.a.l - e.b.l)
    is(gap < 2, `${lang}: the two names of a product share one edge`, `${gap.toFixed(1)}px apart`)

    // The discount figure is in the money column, like the subtotal above it —
    // an LTR-forced cell is right-aligned, so in Arabic it used to sit across the
    // column from every other figure.
    const cells = await page.$$eval('tfoot tr', (rows) =>
      rows.map((r) => {
        const td = r.querySelector('td:last-child')
        const rg = document.createRange()
        rg.selectNodeContents(td)
        const b = rg.getBoundingClientRect()
        return { l: b.left, r: b.right, t: td.textContent }
      }))
    const dir = await page.$eval('table', (el) => getComputedStyle(el).direction)
    const edgeOf = (c) => (dir === 'rtl' ? c.l : c.r)
    const sub = cells[0], disc = cells[1], total = cells[3]
    is(Math.abs(edgeOf(sub) - edgeOf(disc)) < 2, `${lang}: the discount figure lines up with the subtotal`, `${edgeOf(sub).toFixed(1)} vs ${edgeOf(disc).toFixed(1)}`)
    is(Math.abs(edgeOf(sub) - edgeOf(total)) < 2, `${lang}: ...and with the total`, `${edgeOf(sub).toFixed(1)} vs ${edgeOf(total).toFixed(1)}`)
    // The minus belongs to the number: Intl writes it inside an LRM, glued to the
    // digits. Typed in front of the whole formatted amount in an Arabic cell, it
    // landed on the far side of the currency ("3.000 د.ك. −").
    is(/^[\s‎‏؜]*-\s*(KWD\s*)?3\.000/.test(disc.t) || /^[\s‎‏؜]*-3\.000/.test(disc.t),
      `${lang}: the discount is written -3.000, minus first`, JSON.stringify(disc.t))

    // "Discount · Launch 10% off": in an Arabic page the promo name is an LTR run
    // and its leading " · " used to travel with it to the far side, gluing the
    // name to the word ("Launch 10% offالخصم"). The word must be rightmost, the
    // dot between, the promo name leftmost.
    const d = await page.evaluate(() => {
      const td = document.querySelectorAll('tfoot tr')[1].querySelector('td')
      const word = document.createRange(), dot = document.createRange(), name = document.createRange()
      const spans = td.querySelectorAll('span')
      word.setStart(td.firstChild, 0); word.setEnd(td.firstChild, td.firstChild.textContent.length)
      dot.selectNodeContents(spans[0]); name.selectNodeContents(spans[1])
      const x = (r) => { const b = r.getBoundingClientRect(); return [b.left, b.right] }
      return { word: x(word), dot: x(dot), name: x(name), rtl: getComputedStyle(td).direction === 'rtl' }
    })
    const ordered = d.rtl
      ? d.word[0] >= d.dot[1] - 0.5 && d.dot[0] >= d.name[1] - 0.5
      : d.word[1] <= d.dot[0] + 0.5 && d.dot[1] <= d.name[0] + 0.5
    is(ordered, `${lang}: the discount reads word, dot, promo name in reading order, with gaps`,
      `word ${d.word.map(Math.round)} dot ${d.dot.map(Math.round)} name ${d.name.map(Math.round)}`)
    await ctx.close()
  }
  {
    // "Total1,122.625": the label cell had no padding, so a figure wide enough to
    // set the column's width (any order over 999 KWD) touched its own label.
    for (const lang of ['ar', 'en']) {
      const { ctx, page } = await open(BIG, { lang, width: 1000 })
      const g = await page.evaluate(() => {
        const row = [...document.querySelectorAll('tfoot tr')].pop()
        const [label, figure] = row.querySelectorAll('td')
        const r = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); return rg.getBoundingClientRect() }
        const L = r(label), F = r(figure)
        return { rtl: getComputedStyle(row).direction === 'rtl', gap: getComputedStyle(row).direction === 'rtl' ? L.left - F.right : F.left - L.right }
      })
      is(g.gap >= 8, `${lang}: the total's label and figure are at least 8px apart with a 1,122.625 total`, `${g.gap.toFixed(1)}px`)
      await ctx.close()
    }
  }
})

await section('screen: contrast (WCAG AA, 4.5:1 on white)', async () => {
  for (const lang of ['ar', 'en']) {
    const { ctx, page } = await open(BIG, { lang, width: 1000 })
    const low = await page.evaluate(() => {
      // Canvas parses every CSS colour syntax Chrome accepts (Tailwind v4 emits
      // oklch()), so the sRGB triple is read back from a pixel.
      const k = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
      const rgb = (c) => { k.clearRect(0, 0, 1, 1); k.fillStyle = '#fff'; k.fillStyle = c; k.fillRect(0, 0, 1, 1); return [...k.getImageData(0, 0, 1, 1).data].slice(0, 3) }
      const L = ([r, g, b]) => 0.2126 * ((r / 255) ** 2.2) + 0.7152 * ((g / 255) ** 2.2) + 0.0722 * ((b / 255) ** 2.2)
      const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
      const out = []
      for (const e of document.querySelectorAll('article *')) {
        const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
        if (!own) continue
        const cs = getComputedStyle(e)
        let bg = [255, 255, 255]
        for (let p = e; p && p !== document.body; p = p.parentElement) {
          const b = getComputedStyle(p).backgroundColor
          if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') { bg = rgb(b); break }
        }
        const r = ratio(rgb(cs.color), bg)
        if (r < 4.5) out.push(`${e.tagName.toLowerCase()} "${e.textContent.trim().slice(0, 24)}" ${r.toFixed(2)}:1`)
      }
      return out
    })
    is(low.length === 0, `${lang}: every piece of text clears 4.5:1`, low.join('; ') || 'none below')
    await ctx.close()
  }
})

await section('screen and print: the logo is always legible (black lettering on light, white on dark)', async () => {
  // logo.png has BLACK lettering; on the dark theme's charcoal card it was ~1.1:1
  // and only the orange S showed. Exactly one of the two logos is displayed, and
  // it is the one whose lettering contrasts with the card; paper always gets
  // the black one.
  const visible = (page) => page.evaluate(() =>
    [...document.querySelectorAll('article header img')]
      .filter((i) => getComputedStyle(i).display !== 'none')
      .map((i) => i.getAttribute('src')))
  for (const [scheme, want] of [['light', '/logo.png'], ['dark', '/logo-white.png']]) {
    const { ctx, page } = await open(SMALL, { lang: 'en', scheme, width: 768 })
    const v = await visible(page)
    is(v.length === 1 && v[0] === want, `${scheme} theme on screen: one logo, ${want}`, v.join(', ') || 'none')
    await ctx.close()
  }
  const { ctx, page } = await open(SMALL, { lang: 'en', scheme: 'dark' })
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
  const v = await visible(page)
  is(v.length === 1 && v[0] === '/logo.png', 'dark theme in print: the black-lettered logo, for white paper', v.join(', ') || 'none')
  await ctx.close()
})

// =================================================================== PRINT
await section('print media: what is hidden, what keeps its shape', async () => {
  for (const lang of ['ar', 'en']) {
    const { ctx, page } = await open(BIG, { lang })
    await page.emulateMedia({ media: 'print' })
    const p = await page.evaluate(() => {
      const cs = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e) : null }
      const shown = (s) => { const c = cs(s); return !!c && c.display !== 'none' }
      return {
        skip: shown('.skip-link'), drawer: shown('.cart-drawer'),
        overlays: [...document.querySelectorAll('body > .fixed')].filter((e) => getComputedStyle(e).display !== 'none').length,
        actions: shown('.no-print'), header: shown('.app-header'),
        tfoot: cs('tfoot').display, thead: cs('thead').display,
        row: cs('tbody tr').breakInside, dir: cs('table').direction,
      }
    })
    is(!p.skip, `${lang}: the skip link is not printed (it printed at the foot of every page)`)
    is(!p.drawer && p.overlays === 0, `${lang}: the cart drawer and any portalled overlay are not printed`)
    is(!p.actions && !p.header, `${lang}: the Print button and the site header are not printed`)
    is(p.tfoot !== 'table-footer-group', `${lang}: the totals are an ordinary row group, not a footer repeated on every page`, p.tfoot)
    is(p.thead === 'table-header-group', `${lang}: the column header still repeats on every page`, p.thead)
    is(p.row === 'avoid' || p.row === 'avoid-page', `${lang}: a line item is not split across a page break`, p.row)
    is(p.dir === (lang === 'ar' ? 'rtl' : 'ltr'), `${lang}: the table keeps the page's direction in print`, p.dir)
    await ctx.close()
  }
})

await section('print media: paper is white in the dark theme too', async () => {
  for (const lang of ['ar', 'en']) {
    // A visitor in the dark theme — by OS preference or by the toggle — who prints.
    const { ctx, page } = await open(SMALL, { lang, scheme: 'dark' })
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
    const p = await page.evaluate(() => {
      const cs = (s) => getComputedStyle(document.querySelector(s))
      const k = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
      const lum = (c) => { k.clearRect(0, 0, 1, 1); k.fillStyle = '#fff'; k.fillStyle = c; k.fillRect(0, 0, 1, 1); const [r, g, b] = k.getImageData(0, 0, 1, 1).data; return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 }
      return {
        theme: document.documentElement.dataset.theme,
        html: lum(cs('html').backgroundColor), body: lum(cs('body').backgroundColor), article: lum(cs('article').backgroundColor),
        scheme: cs('html').colorScheme,
        name: lum(cs('tbody td span').color), muted: lum(cs('article header p.text-xs').color),
        total: lum(cs('tfoot tr:last-child td:last-child').color),
      }
    })
    is(p.theme === 'dark', `${lang}: the fixture really is in the dark theme`, p.theme)
    is(p.html > 0.95 && p.body > 0.95 && p.article > 0.95, `${lang}: root, body and card print white`, `${p.html.toFixed(2)} ${p.body.toFixed(2)} ${p.article.toFixed(2)}`)
    is(p.scheme === 'light', `${lang}: color-scheme is light in print (dark paints the page margin charcoal)`, p.scheme)
    is(p.name < 0.35 && p.muted < 0.5, `${lang}: text is dark on the white card`, `names ${p.name.toFixed(2)}, muted ${p.muted.toFixed(2)}`)
    is(p.total < 0.5, `${lang}: the total keeps the light theme's dark orange, not the dark theme's pale one`, p.total.toFixed(2))
    await ctx.close()
  }
})

// ============================================================== A4 PDF
if (HAVE_POPPLER) {
  for (const lang of ['ar', 'en']) await section(`A4 PDF, ${lang}: pages, repeated furniture, ink`, async () => {
    // A short order is ONE page — a margin or a stray overlay pushing a few
    // lines onto a second, near-empty sheet is the failure.
    {
      const { ctx, page } = await open(SMALL, { lang })
      await page.emulateMedia({ media: 'print' })
      const f = await pdfOf(page, `small-${lang}`)
      is(pages(f) === 1, `${lang}: a two-line invoice is one A4 page`, `${pages(f)} page(s)`)
      const sheets = raster(f, `small-${lang}`)
      is(sheets[0].mean > 0.97, `${lang}: the sheet is almost all white paper`, `mean luminance ${sheets[0].mean.toFixed(3)}`)
      is(sheets[0].lum(1, 1) > 0.97 && sheets[0].lum(sheets[0].w - 2, sheets[0].h - 2) > 0.97,
        `${lang}: the page corners (the margin) are white`)
      await ctx.close()
    }
    // A long order: the totals once, no furniture on any page, no charcoal.
    {
      const { ctx, page } = await open(BIG, { lang })
      await page.emulateMedia({ media: 'print' })
      const f = await pdfOf(page, `big-${lang}`)
      const n = pages(f)
      is(n >= 3 && n <= 5, `${lang}: a 34-line invoice runs ${n} A4 pages`, `${n} (it was ${lang === 'ar' ? 6 : 5} with the totals repeated on every page)`)
      const all = text(f)
      const figures = all.split(BIG_TOTAL).length - 1
      is(figures === 1, `${lang}: the grand total (${BIG_TOTAL}) is printed once, not on every page`, `${figures} time(s)`)
      // English only: poppler returns Arabic as scrambled presentation forms, so
      // an Arabic regex here would pass on code that prints the button. The
      // Arabic page is covered by the print-media check above (display:none).
      if (lang === 'en') is(!/Skip to content/.test(all), `${lang}: no "Skip to content" button on any page`)
      is(text(f, n).includes(BIG_TOTAL), `${lang}: the total is on the LAST page, after the last line`)
      const lastWords = text(f, n).split(/\s+/).filter(Boolean).length
      is(lastWords > 25, `${lang}: the last page is not a near-empty sheet`, `${lastWords} words`)
      const sheets = raster(f, `big-${lang}`)
      const darkest = Math.min(...sheets.map((s) => s.mean))
      is(darkest > 0.95, `${lang}: no page carries a dark fill (the root background used to print under the footer)`,
        sheets.map((s) => s.mean.toFixed(3)).join(' '))
      await ctx.close()
    }
    // The dark theme, on paper. Measured before the fix: mean luminance 0.12.
    {
      const { ctx, page } = await open(SMALL, { lang, scheme: 'dark' })
      await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
      const f = await pdfOf(page, `dark-${lang}`)
      const s = raster(f, `dark-${lang}`)[0]
      is(s.mean > 0.95, `${lang}: the dark-theme sheet prints as white paper`, `mean luminance ${s.mean.toFixed(3)} (was 0.12)`)
      is(s.lum(1, 1) > 0.95 && s.lum(s.w - 2, s.h - 2) > 0.95, `${lang}: ...with white margins, not a charcoal frame`)
      await ctx.close()
    }
    // The cart open when Print is pressed: its 60% backdrop used to cover every page.
    {
      const { ctx, page } = await open(SMALL, { lang })
      await page.locator('header button.tap.relative').first().click()
      await page.waitForTimeout(500)
      await page.emulateMedia({ media: 'print' })
      const f = await pdfOf(page, `drawer-${lang}`)
      const s = raster(f, `drawer-${lang}`)[0]
      is(s.mean > 0.97, `${lang}: printing with the bag open does not print the backdrop`, `mean luminance ${s.mean.toFixed(3)} (was 0.85)`)
      await ctx.close()
    }
  })
}

await browser.close()
await server.close()
rmSync(tmp, { recursive: true, force: true })
console.log(fails ? `\n${fails} problem(s) with the invoice layout` : '\ninvoice layout: correct on screen and on paper')
process.exit(fails ? 1 : 0)
