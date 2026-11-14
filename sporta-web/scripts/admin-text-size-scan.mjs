// Admin text size, measured on every /backends fixture screen (ALL in scripts/lib/admin-css-full-page.mjs): English and
// Arabic, at 1280px and 390px, light theme. Read-only: it serves the fixtures with the add-ons of addons-src/ and reads the
// computed font size of every visible text node. Nothing is asserted; the report is the answer:
//
//   - the size histogram (computed px, rounded to 0.5) per width,
//   - how many text nodes are under 12px, under 13px and under 14px, per screen,
//   - the distinct small (under 14px) sizes, with the classes and text that carry them.
//
// Storefront previews (a mock of the shop inside the Theme and Top bar editors, class *__preview*) are counted apart: their
// size is the shop's, not the admin's. Visually hidden text (sr-only) is not on screen and is skipped.
//
//   node scripts/admin-text-size-scan.mjs             (prints the report)
//   TEXT_SIZE_JSON=1 node scripts/admin-text-size-scan.mjs    (also writes the raw rows as JSON to stdout's end)
import { chromium } from 'playwright'
import { ALL, addons, serve, knetSource } from './lib/admin-css-full-page.mjs'

const ref = { current: addons(knetSource()) }
const { server, base } = await serve(ref)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const WIDTHS = [1280, 390]
const LANGS = [{ rtl: 0, name: 'en' }, { rtl: 1, name: 'ar' }]

const rows = []   // { screen, width, lang, px, cls, text, table, preview, bold }

for (const name of ALL) for (const w of WIDTHS) for (const l of LANGS) {
  const pg = await browser.newPage({ viewport: { width: w, height: 900 } })
  await pg.goto(`${base}/__fx/${name}?rtl=${l.rtl}&dark=0`, { waitUntil: 'load' })
  const got = await pg.evaluate(() => {
    const out = []
    for (const e of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(e)
      const box = e.getBoundingClientRect()
      if (cs.display === 'none' || cs.visibility === 'hidden' || box.width <= 1 || box.height <= 1) continue
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ')
      if (!own) continue
      const cls = String(e.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      out.push({
        px: parseFloat(cs.fontSize), bold: parseInt(cs.fontWeight, 10) >= 600,
        cls: e.tagName.toLowerCase() + (cls ? '.' + cls : ''), text: own.slice(0, 40),
        table: !!e.closest('table'), preview: !!e.closest('[class*="__preview"]'),
      })
    }
    return out
  })
  await pg.close()
  for (const r of got) rows.push({ screen: name, width: w, lang: l.name, ...r })
}

await browser.close(); server.close()

// ---- report
const halves = (x) => Math.round(x * 2) / 2
const main = rows.filter((r) => !r.preview)
const shop = rows.filter((r) => r.preview)
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) : '0.0') + '%'

console.log(`Text nodes measured: ${rows.length} (admin ${main.length}, storefront previews ${shop.length}) over ${ALL.length} screens x ${WIDTHS.length} widths x ${LANGS.length} languages, light theme.\n`)

for (const w of WIDTHS) {
  const set = main.filter((r) => r.width === w)
  const hist = new Map()
  for (const r of set) hist.set(halves(r.px), (hist.get(halves(r.px)) || 0) + 1)
  console.log(`== ${w}px  (${set.length} admin text nodes)`)
  console.log('   size: ' + [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([px, n]) => `${px}px ${n}`).join('  '))
  const u12 = set.filter((r) => r.px < 12), u13 = set.filter((r) => r.px < 13), u14 = set.filter((r) => r.px < 14)
  const t13 = set.filter((r) => r.table && r.px < 13), n14 = set.filter((r) => !r.table && r.px < 14)
  console.log(`   under 12px: ${u12.length} (${pct(u12.length, set.length)})   under 13px: ${u13.length}   under 14px outside tables: ${n14.length}   under 13px in tables: ${t13.length}`)
  // the distinct small sizes, with where they come from
  const small = new Map()
  for (const r of set.filter((x) => x.px < 14 && !(x.table && x.px >= 13))) {
    const k = `${r.px}px ${r.cls}`
    const s = small.get(k) || { n: 0, screens: new Set(), sample: r.text, bold: r.bold }
    s.n++; s.screens.add(r.screen); small.set(k, s)
  }
  const top = [...small.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25)
  if (top.length) {
    console.log('   small text (under 14px, outside tables), most frequent first:')
    for (const [k, s] of top) console.log(`     ${k.padEnd(60).slice(0, 60)} x${String(s.n).padEnd(4)} on ${String(s.screens.size).padStart(2)} screens  e.g. "${s.sample}"`)
  }
  console.log('')
}

// the same for the storefront previews, once, so they are not mistaken for admin text
const shopHist = new Map()
for (const r of shop) shopHist.set(halves(r.px), (shopHist.get(halves(r.px)) || 0) + 1)
console.log(`Storefront previews (not the admin's text): ${shop.length} nodes; sizes ${[...shopHist.entries()].sort((a, b) => a[0] - b[0]).map(([px, n]) => `${px}px ${n}`).join('  ')}`)

if (process.env.TEXT_SIZE_JSON) console.log('\n' + JSON.stringify(rows))
