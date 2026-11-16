// The brand plate under the product photograph (src/components/BrandPlate.jsx): its layout, measured in a real browser.
//
//   npm run test:brand-plate-layout     (no sandbox: Chromium and Tailwind, the same as the other layout suites)
//
// The plate has three parts: the Sporta mark, the maker (its logo, or its name), and the AHED line (brand, collection).
// Measured at 390, 768 and 1280 px, in Arabic (RTL) and English (LTR), in three states: a maker with a logo, a maker
// with only a name, and no AHED detail (the "authentic" line).
//
// What is asserted (the NEW layout, the one in BrandPlate.jsx):
//   1. nothing is clipped: the plate, and every part of it, stays inside the plate's own box, at every width and language;
//   2. no text is cut with an ellipsis: the collection name and the maker name are shown whole (they wrap instead);
//   3. on a phone the AHED line sits on its own full-width line, so the mark and the maker keep the first row;
//   4. the markup of this harness is the markup of BrandPlate.jsx: every className in the component appears here (drift
//      guard), and the component has no ellipsis on the collection or the maker name;
//   5. MUTATION: the OLD layout (the one before this change) fails checks 1 and 2 at 390 px, so the suite can tell them apart.
import { chromium } from 'playwright'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const COMPONENT = readFileSync(join(ROOT, 'src/components/BrandPlate.jsx'), 'utf8')

let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  — ' + detail : '')) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`)

// The two layouts. Each key is one element of the plate. OLD is what BrandPlate.jsx drew before this change.
const LAYOUT = {
  old: {
    plate: 'mt-4 flex items-center justify-between gap-4 rounded-2xl border border-black/10 bg-white px-4 py-3',
    owner: 'h-7 w-auto shrink-0',
    maker: 'flex min-w-0 shrink items-center gap-2',
    makerLogo: 'h-6 w-24 max-w-full shrink-0 object-contain',
    makerName: 'truncate text-sm font-extrabold text-slate-900',
    detail: 'flex min-w-0 items-center gap-2 text-end',
    eyebrow: 'eyebrow text-accent shrink-0',
    dot: 'text-black/20',
    collection: 'truncate text-sm font-extrabold text-slate-900',
    auth: 'text-xs font-semibold text-slate-600',
  },
  new: {
    plate: 'mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-2xl border border-black/10 bg-white px-4 py-3',
    owner: 'h-7 w-auto shrink-0',
    maker: 'flex min-w-0 max-w-full items-center gap-2',
    makerLogo: 'h-6 w-24 max-w-full shrink-0 object-contain',
    makerName: 'min-w-0 break-words text-sm font-extrabold text-slate-900',
    detail: 'order-last flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-black/10 pt-2 text-start text-sm sm:order-none sm:w-auto sm:border-0 sm:pt-0 sm:text-end',
    eyebrow: 'eyebrow text-accent shrink-0',
    dot: 'text-black/20',
    collection: 'min-w-0 break-words text-sm font-extrabold text-slate-900',
    auth: 'order-last w-full border-t border-black/10 pt-2 text-start text-xs font-semibold text-slate-600 sm:order-none sm:w-auto sm:border-0 sm:pt-0 sm:text-end',
  },
}

// Drift guard: every className in the component must be one of the classes this harness renders (old or new layout).
const harnessClasses = new Set(Object.values(LAYOUT).flatMap((l) => Object.values(l).flatMap((v) => v.split(/\s+/))))
const componentClassNames = [...COMPONENT.matchAll(/className="([^"]*)"/g)].map((m) => m[1])
const drift = componentClassNames.flatMap((c) => c.split(/\s+/)).filter((c) => c && !harnessClasses.has(c))
head('0. the harness is the component')
is(componentClassNames.length >= 8, `the component has its className strings (${componentClassNames.length})`)
is(drift.length === 0, 'every class in BrandPlate.jsx is in this harness (old or new)', [...new Set(drift)].join(' '))
// Which layout the component draws: the plate's own class string tells. Every check below measures THAT layout.
const ACTIVE = componentClassNames.includes(LAYOUT.new.plate) ? 'new' : componentClassNames.includes(LAYOUT.old.plate) ? 'old' : null
is(ACTIVE !== null, `BrandPlate.jsx draws one of the two known layouts (${ACTIVE ?? 'neither'})`)

// Tailwind compiled over every class the two layouts use, so both can be drawn.
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n@source inline("${[...harnessClasses].join(' ')}");`,
  { from: join(ROOT, 'brand-plate-fixture.css') })).css
const CSS = TW + `
body{margin:0;padding:16px;font-family:system-ui,sans-serif;background:#fff;color:#171a1e}
.eyebrow{font-size:.6875rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase}
[dir="rtl"] .eyebrow{letter-spacing:0}
`

const LOGO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="24"><rect width="96" height="24" fill="#222"/></svg>')
const TEXT = {
  en: { maker: 'Vanquish Performance', collection: 'Cloudsoft Winter Training Collection', brand: 'AHED Trading', auth: 'Authentic · sold by Sporta' },
  ar: { maker: 'فانكويش بيرفورمانس', collection: 'مجموعة كلاودسوفت لتدريب الشتاء الطويلة', brand: 'أهيد للتجارة', auth: 'أصلي · بيع سبورتا' },
}
// the markup of BrandPlate.jsx for the three states
function plateHtml(l, lang, state) {
  const T = TEXT[lang], c = LAYOUT[l]
  const owner = `<img class="${c.owner}" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="132" height="41" alt="Sporta Sports Wear">`
  let maker = ''
  if (state === 'logo') maker = `<span class="${c.maker}"><img class="${c.makerLogo}" src="${LOGO}" width="96" height="24" alt="${T.maker}"></span>`
  if (state === 'name') maker = `<span class="${c.maker}"><span class="${c.makerName}">${T.maker}</span></span>`
  const detail = state === 'none' ? `<span class="${c.auth}">${T.auth}</span>`
    : `<p class="${c.detail}"><span class="${c.eyebrow}">${T.brand}</span><span class="${c.dot}" aria-hidden="true">·</span><span class="${c.collection}">${T.collection}</span></p>`
  return `<div dir="${lang === 'ar' ? 'rtl' : 'ltr'}" lang="${lang}" class="${c.plate}">${owner}${maker}${detail}</div>`
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })
const WIDTHS = [390, 768, 1280]
const LANGS = ['ar', 'en']
const STATES = ['logo', 'name', 'none']
const measured = {}

async function measure(page, l, lang, state) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${plateHtml(l, lang, state)}</body></html>`, { waitUntil: 'load' })
  return page.evaluate(() => {
    const plate = document.querySelector('div[class]')
    const pr = plate.getBoundingClientRect()
    const parts = [...plate.children].map((e) => e.getBoundingClientRect())
    const inside = parts.every((r) => r.left >= pr.left - 0.5 && r.right <= pr.right + 0.5 && r.top >= pr.top - 0.5 && r.bottom <= pr.bottom + 0.5)
    const texts = [...plate.querySelectorAll('span,p')].filter((e) => e.children.length === 0 && e.textContent.trim())
    const clipped = texts.filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === 'ellipsis').map((e) => e.textContent.trim())
    const overflowX = plate.scrollWidth > plate.clientWidth + 1
    // rows: the parts' top edges grouped by 10px (items centred on one line differ by a few px, and are one row)
    const tops = parts.map((r) => r.top).sort((a, b) => a - b)
    let rows = 0, last = -Infinity
    for (const t of tops) { if (t - last > 10) { rows++; last = t } }
    return { height: Math.round(pr.height), inside, clipped, overflowX, rows }
  })
}

try {
  const page = await browser.newPage()
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 })
    for (const lang of LANGS) for (const state of STATES) {
      for (const l of ['old', 'new']) measured[`${l}-${width}-${lang}-${state}`] = await measure(page, l, lang, state)
    }
  }
} finally {
  // printed below
}

head(`1. the layout BrandPlate.jsx draws (${ACTIVE}): nothing clipped, nothing cut, every part inside the plate`)
let worst = null
for (const width of WIDTHS) for (const lang of LANGS) for (const state of STATES) {
  const m = measured[`${ACTIVE}-${width}-${lang}-${state}`]
  const label = `${width}px ${lang} ${state}`
  is(m.inside && !m.overflowX, `${label}: every part is inside the plate (plate ${m.height}px high, ${m.rows} row${m.rows === 1 ? '' : 's'})`, JSON.stringify(m))
  is(m.clipped.length === 0, `${label}: no text is cut with an ellipsis`, m.clipped.join(' | '))
  if (state === 'logo' && (!worst || m.height > worst.height)) worst = { ...m, label }
}

head('2. on a phone the AHED line is its own full-width line')
// the active layout's check 2 is 'rows 2' only for the new layout; the old one wraps the AHED line into the maker's row
for (const lang of LANGS) {
  const m = measured[`${ACTIVE}-390-${lang}-logo`]
  is(m.rows === 2, `390px ${lang}: the mark and the maker on one row, the AHED line on the next (rows ${m.rows})`)
}
is(worst && worst.height <= 150, `the tallest plate (${worst?.label}) is at most 150px`, String(worst?.height))

head('3. MUTATION: the old layout clips the collection on a phone')
const oldClipped = ['en', 'ar'].some((lang) => measured[`old-390-${lang}-logo`].clipped.length > 0 || measured[`old-390-${lang}-logo`].overflowX || !measured[`old-390-${lang}-logo`].inside)
is(oldClipped, 'the old layout fails check 1 or 2 at 390px (so the suite can tell the two apart)', JSON.stringify(measured['old-390-en-logo']))

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
if (process.env.SHOW) console.log(JSON.stringify(measured, null, 1))
process.exit(fail ? 1 : 0)
