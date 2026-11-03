// The shop page without its title block, product count and category chips, proven on the live markup:
//
//   npm run test:shop-header      (no rig: fixtures + the real public/sporta-grid.css, headless Chromium)
//
// Owner request 2026-11-03 ("remove inside blue lines": the breadcrumb/headline/intro + divider, the
// "٤ منتج" count, the category chips). Asserted at 320, 390, 768 and 1280 wide, Arabic (RTL, the default)
// and English (LTR), on /shop, /shop?brand=<slug>, ?category=, ?q= search (with and without results):
//   - eyebrow, intro, count and chips have no box; the divider and the heading's spacing are gone, so the
//     heading block is 0px tall (no empty band);
//   - the page's only h1 is still there: not display:none, a 1px clipped box, in the accessibility tree
//     (getByRole heading level 1 and the ARIA snapshot), single;
//   - the sort label and select are visible, inside the window width, as tall as without the section
//     (min-h-11), and the distance from the header to the sort row is under 120px (recorded);
//   - the product grid sits about 1rem under the sort row (recorded) and nothing overflows sideways;
//   - brand page: the banner is still visible, between the sort row and the grid (that is where
//     sporta-features.js inserts it: just before .catalog-filters, which comes AFTER the toolbar);
//   - the footer stays below the fold while the grid is empty (the .catalog-page min-height rule);
//   - the wishlist, which reuses .catalog-heading, is untouched;
//   - mutation: with the new section cut out of the file this same suite must fail.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shop, wishlist } from './fixtures/shop-header.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CSS = readFileSync(process.env.GRID_CSS_FILE || join(ROOT, 'public/sporta-grid.css'), 'utf8')

// The section starts at its own banner comment; everything above it (gutters, .catalog-page min-height) stays.
const MARK = '/* ------------------------------------------------------------------------------------------------\n * Shop page without its title block'
const at = CSS.indexOf(MARK)
if (at < 0) { console.log('FAIL sporta-grid.css has no "Shop page without its title block" section'); process.exit(1) }
const WITHOUT = CSS.slice(0, at)
if (!/\.catalog-page\s*\{\s*min-height/.test(WITHOUT)) { console.log('FAIL the .catalog-page min-height rule is missing above the section'); process.exit(1) }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

let pass = 0, fail = 0, quiet = false
const is = (ok, msg, detail = '') => {
  if (ok) pass++; else fail++
  if (!quiet || !ok) { if (!quiet) console.log((ok ? 'ok   ' : 'FAIL ') + msg + (!ok && detail ? '  - ' + detail : '')) }
}
const head = (t) => { if (!quiet) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 66 - t.length))}`) }
const notes = []
const BASE = new Map()
const page = async () => (await browser.newContext()).newPage()

const measure = () => {
  const box = (sel) => {
    const e = document.querySelector(sel)
    if (!e) return null
    const cs = getComputedStyle(e), r = e.getBoundingClientRect()
    return { display: cs.display, visibility: cs.visibility, w: r.width, h: r.height, top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, clip: cs.clipPath, pos: cs.position, bb: cs.borderBottomWidth, bt: cs.borderTopWidth, overflow: cs.overflow }
  }
  const hs = document.querySelector('.catalog-heading')
  const hcs = hs ? getComputedStyle(hs) : null
  return {
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    iw: innerWidth, ih: innerHeight, over: document.documentElement.scrollWidth - innerWidth,
    h1count: document.querySelectorAll('h1').length,
    header: box('.app-header'), heading: box('.catalog-heading'), headingPad: hcs && [hcs.paddingTop, hcs.paddingBottom, hcs.marginTop, hcs.marginBottom, hcs.borderBottomWidth].join(' '),
    eyebrow: box('.catalog-eyebrow'), lead: box('.catalog-heading-copy > p'), h1: box('h1'), toolbar: box('.catalog-toolbar'),
    count: box('.catalog-result-count'), chips: box('.catalog-filters'), sortLabel: box('.catalog-sort'), select: box('.catalog-sort-select'),
    banner: box('#sporta-brand-banner'), grid: box('.product-grid'), firstCard: box('.catalog-card'), empty: box('.catalog-empty'), footer: box('footer'),
    page: box('.catalog-page'),
  }
}
const gone = (b) => !b || b.display === 'none' || b.h === 0 || b.w === 0

const SIZES = [[320, 568], [390, 844], [768, 1024], [1280, 800]]
const VARIANTS = [
  { variant: 'shop', label: 'shop' },
  { variant: 'brand', label: 'brand banner' },
  { variant: 'category', label: 'category' },
  { variant: 'search', label: 'search' },
  { variant: 'search', state: 'noresults', label: 'search, no results' },
]

async function suite(css, tag) {
  // One page for the whole run (a fresh browser context per case made the suite take half an hour);
  // the baseline (the file without the section) does not depend on `css`, so it is measured once.
  const pg = await page()
  const open = async (w, h, html) => {
    await pg.setViewportSize({ width: w, height: h })
    await pg.setContent(html, { waitUntil: 'domcontentloaded' })
    return { pg, ctx: { close: async () => {} } }
  }
  const baseOf = async (key, w, h, html) => {
    if (!BASE.has(key)) { await open(w, h, html); BASE.set(key, await pg.evaluate(measure)) }
    return BASE.get(key)
  }
  for (const lang of ['ar', 'en']) {
    for (const [w, h] of SIZES) {
      const hdr = w < 768 ? 96 : 145
      for (const v of VARIANTS) {
        head(`${tag} ${lang} ${w}x${h} ${v.label}`)
        const opts = { lang, variant: v.variant, state: v.state || 'loaded', hdr }
        const base = await baseOf(`${lang}|${w}|${v.variant}|${opts.state}`, w, h, shop(WITHOUT, opts))
        const a = await open(w, h, shop(css, opts))
        const m = await a.pg.evaluate(measure)

        // --- what is removed ---
        is(gone(m.eyebrow), 'the eyebrow (سبورتا / المجموعة) has no box', m.eyebrow && `${m.eyebrow.display} ${m.eyebrow.h}px`)
        is(gone(m.lead), 'the intro paragraph has no box', m.lead && `${m.lead.display} ${m.lead.h}px`)
        is(gone(m.count), 'the product count has no box', m.count && `${m.count.display} ${m.count.h}px`)
        is(gone(m.chips), 'the category chips row has no box', m.chips && `${m.chips.display} ${m.chips.h}px`)
        is(m.heading.bb === '0px' && m.headingPad === '0px 0px 0px 0px 0px', 'the divider, padding and margin of the title block are gone', `${m.heading.bb} / ${m.headingPad}`)
        is(m.heading.h === 0, 'the title block is 0px tall: no empty band', `${m.heading.h}px`)

        // --- the h1 stays, for screen readers and search engines ---
        is(m.h1count === 1, 'exactly one h1 on the page', String(m.h1count))
        is(m.h1.display !== 'none' && m.h1.visibility === 'visible', 'the h1 is not display:none', `${m.h1.display} ${m.h1.visibility}`)
        is(m.h1.pos === 'absolute' && Math.round(m.h1.w) === 1 && Math.round(m.h1.h) === 1 && /inset\(50%\)/.test(m.h1.clip) && m.h1.overflow === 'hidden', 'the h1 is a 1px clipped box, out of the flow', `${m.h1.pos} ${m.h1.w}x${m.h1.h} ${m.h1.clip}`)
        const hd = a.pg.getByRole('heading', { level: 1 })
        is((await hd.count()) === 1, 'the accessibility tree has the h1 (getByRole heading level 1)')
        const snap = await a.pg.locator('main').ariaSnapshot()
        is(/heading "[^"]+" \[level=1\]/.test(snap), 'the ARIA snapshot lists the level-1 heading', snap.split('\n').find((l) => /heading/.test(l)) || '')
        is((await hd.textContent()).length > 10, 'the h1 still carries its text')
        const sibs = await a.pg.evaluate(() => { const r = document.querySelector('h1').getBoundingClientRect(); return { l: r.left, r: r.right, iw: innerWidth } })
        is(sibs.l >= -2 && sibs.r <= sibs.iw + 2, 'the clipped h1 does not widen the page', `${sibs.l}..${sibs.r}`)

        // --- what stays: the sort row ---
        is(m.sortLabel.display !== 'none' && m.sortLabel.h > 0 && m.select.h > 0 && m.select.visibility === 'visible', 'the sort label and select are visible')
        is(m.select.left >= -0.5 && m.select.right <= m.iw + 0.5 && m.sortLabel.left >= -0.5 && m.sortLabel.right <= m.iw + 0.5, 'the sort row is inside the window width', `${Math.round(m.select.left)}..${Math.round(m.select.right)} of ${m.iw}`)
        is(Math.abs(m.select.h - base.select.h) < 0.5 && m.select.h >= 43, 'the select keeps its min-h-11 target (unchanged by the section)', `${m.select.h.toFixed(1)}px vs ${base.select.h.toFixed(1)}px`)
        is(await a.pg.getByRole('combobox').isVisible(), 'the sort select is operable (visible combobox)')
        if (v.state !== 'noresults') {
          await a.pg.getByRole('combobox').selectOption({ index: 1 })
          is((await a.pg.getByRole('combobox').inputValue()) !== '', 'the sort select can be changed')
        }

        // --- spacing ---
        const toSort = m.toolbar.top - m.header.bottom
        const baseToSort = base.toolbar.top - base.header.bottom
        is(toSort < 120, 'header to sort row is under 120px', `${toSort.toFixed(1)}px (was ${baseToSort.toFixed(1)}px)`)
        is(toSort < baseToSort - 20, 'the sort row moved up by the title block', `${toSort.toFixed(1)} vs ${baseToSort.toFixed(1)}`)
        const padTop = parseFloat(w >= 768 ? '2.5' : '1.5') * m.root
        is(Math.abs(toSort - padTop) < 1, 'only the page gutter (section top padding) is left above the sort row', `${toSort.toFixed(1)}px vs ${padTop.toFixed(1)}px`)
        if (v.variant === 'brand') {
          is(m.banner && m.banner.h > 0 && m.banner.display !== 'none' && m.banner.visibility === 'visible', 'the brand banner is visible', m.banner && `${m.banner.h}px`)
          is(m.banner.left >= -0.5 && m.banner.right <= m.iw + 0.5, 'the brand banner fits the window width')
          is(m.toolbar.bottom <= m.banner.top + 0.5 && m.banner.bottom <= m.grid.top + 0.5, 'order: sort row, then banner, then the grid (where sporta-features.js inserts it)')
          is(m.banner.top - m.toolbar.bottom <= 17, 'the banner sits right under the sort row (16px)', `${(m.banner.top - m.toolbar.bottom).toFixed(1)}px`)
          is(m.grid.top - m.banner.bottom <= 17, 'the grid sits right under the banner (16px)', `${(m.grid.top - m.banner.bottom).toFixed(1)}px`)
          if (tag === 'with section' && lang === 'ar') notes.push(`brand ${w}: header to banner ${(m.banner.top - m.header.bottom).toFixed(0)}px, header to sort row ${toSort.toFixed(0)}px`)
        } else if (v.state !== 'noresults') {
          const gap = m.grid.top - m.toolbar.bottom
          is(Math.abs(gap - m.root) < 1.5, 'the grid sits about 1rem under the sort row', `${gap.toFixed(1)}px vs ${m.root.toFixed(1)}px`)
          if (tag === 'with section' && lang === 'ar' && v.variant === 'shop') notes.push(`shop ${w}: header to sort row ${toSort.toFixed(0)}px (was ${baseToSort.toFixed(0)}), sort row to grid ${gap.toFixed(0)}px (was ${(base.grid.top - base.toolbar.bottom).toFixed(0)})`)
        } else {
          const gap = m.empty.top - m.toolbar.bottom
          is(Math.abs(gap - m.root) < 1.5, 'the "no results" panel sits about 1rem under the sort row', `${gap.toFixed(1)}px vs ${m.root.toFixed(1)}px`)
        }
        is(m.over <= 0, 'nothing overflows sideways', `${m.over}px`)
        await a.ctx.close()
      }

      // --- CLS rule: first paint (empty grid), the footer starts at or below the fold ---
      head(`${tag} ${lang} ${w}x${h} first paint`)
      for (const variant of ['shop', 'brand']) {
        const a = await open(w, h, shop(css, { lang, variant, state: 'shell', hdr }))
        const m = await a.pg.evaluate(measure)
        const secMin = h - 6 * m.root
        is(m.footer.top >= m.ih - 0.5, `${variant}, grid still empty: the footer starts at or below the fold`, `footer ${Math.round(m.footer.top)}px, window ${m.ih}px`)
        is(m.page.h >= secMin - 1, `${variant}, grid still empty: the section keeps its window-minus-6rem height`, `${Math.round(m.page.h)}px vs ${Math.round(secMin)}px`)
        is(m.over <= 0, `${variant}, first paint: nothing overflows sideways`, `${m.over}px`)
        await a.ctx.close()
      }
    }
  }

  // --- the wishlist reuses .catalog-heading: untouched ---
  for (const lang of ['ar', 'en']) {
    for (const w of [390, 1280]) {
      head(`${tag} ${lang} wishlist ${w}`)
      const base = await baseOf(`${lang}|${w}|wishlist`, w, 800, wishlist(WITHOUT, { lang }))
      const a = await open(w, 800, wishlist(css, { lang }))
      const m = await a.pg.evaluate(measure)
      is(m.eyebrow.display !== 'none' && m.lead.display !== 'none' && m.h1.h > 20, 'wishlist keeps its eyebrow, intro and a full-size title')
      is(Math.abs(m.heading.h - base.heading.h) < 0.5 && m.heading.bb === base.heading.bb, 'wishlist title block is the same height, with its divider', `${m.heading.h} vs ${base.heading.h}`)
      await a.ctx.close()
    }
  }
}

await suite(CSS, 'with section')
const realPass = pass, realFail = fail
console.log(`\nnotes (Arabic, recorded): ${notes.join(' | ')}`)

// --- mutation: the same suite against the file with the new section cut out must fail ---
quiet = true; pass = 0; fail = 0
await suite(WITHOUT, 'without section')
const mutFail = fail
quiet = false
await browser.close()

console.log(`\nwith the section:    ${realPass} passed, ${realFail} failed`)
console.log(`mutation (section removed): ${mutFail} checks fail, ${pass} still pass`)
const mutOk = mutFail >= 100
console.log(mutOk ? 'ok   the suite fails without the section (mutation caught)' : 'FAIL the suite does not notice the section being removed')
process.exit(realFail || !mutOk ? 1 : 0)
