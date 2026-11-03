// The storefront header / menu layout section of public/sporta-bag-touch.css, proven on the live markup:
//
//   npm run test:menu-layout      (rig-free: the captured live header, the live compiled rules, real Tailwind,
//                                  the real self-hosted fonts and the add-on CSS; no server, no database, no dist/)
//
// The section ("HEADER AND MENU LAYOUT") answers "improve menu layout" with what a measurement shows, so the
// suite measures the header BEFORE (the file without the section) and AFTER at 320, 360, 390, 640, 768 and
// 1280 wide, in Arabic (dir=rtl, the default) and English (dir=ltr), and asserts:
//   - every interactive element of the header (AI launcher, language switch, bag, logo link, five tabs) is
//     at least 44 x 44, and no two controls of the brand row overlap;
//   - the tab labels are 14px or more, on one line, never truncated; the five tabs are evenly spaced;
//   - the announcement text is 12px or more on a phone, readable in full or wrapped (never cut by "..."
//     while a second line is free), and 4.5:1 or better on the orange; the tab text 4.5:1; the orange used
//     for hover, focus and the cart badge 3:1 against the charcoal;
//   - the logo's centre is the screen's centre (2px), nothing overflows sideways, and a tab row that ever
//     overflows scrolls (scrollbar hidden) instead of spilling;
//   - the sticky chrome (announcement + brand row + tabs) never grows and, on a phone, shrinks;
//   - from 640px nothing moves: heights, the brand row's boxes and the tab row's centre are the baseline's;
//   - keyboard focus: the same ten tab stops in the same order as before, in reading order; a ring of at
//     least 3px in the bright orange; the ring is never painted outside the header's own room (under the
//     announcement bar) and a tab's ring lies inside its box;
//   - the section is scoped to .app-header, uses logical properties only, and sits last in its file;
//   - MUTATION: cutting the whole section, and cutting each numbered block [menu-N] on its own, must make
//     the suite fail (the counts are printed).
// Env: CHROMIUM_PATH (default /opt/pw-browsers/chromium); MENU_CSS_FILE to test another copy of the file.
import { chromium } from 'playwright'
import { join } from 'node:path'
import { ROOT, page as buildPage, measure, sectionOf, SECTION_START } from './lib/menu-layout-page.mjs'

const FILE = process.env.MENU_CSS_FILE || join(ROOT, 'public/sporta-bag-touch.css')
const { before: BEFORE_CSS, section: SECTION } = sectionOf(FILE)
const WIDTHS = [320, 360, 390, 640, 768, 1280]
const LANGS = ['ar', 'en']
const TAB_STOPS = 9 // AI, logo, language, bag, five tabs

let pass = 0, fail = 0, quiet = false
const is = (ok, msg, detail = '') => {
  if (ok) pass++; else fail++
  if (!quiet) console.log((ok ? 'ok   ' : 'FAIL ') + msg + (!ok && detail ? '  - ' + detail : ''))
}
const head = (t) => { if (!quiet) console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 60 - t.length))}`) }
const near = (a, b, t) => Math.abs(a - b) <= t
const f1 = (n) => (Math.round(n * 10) / 10).toString()

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' })

// One page: measure at rest, after hovering the third tab, and while walking the keyboard focus.
const FOCUS = () => {
  const el = document.activeElement
  if (!el || el === document.body) return null
  const s = getComputedStyle(el), r = el.getBoundingClientRect()
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  cv.fillStyle = '#000'; cv.fillStyle = s.outlineColor; cv.fillRect(0, 0, 1, 1)
  const c = cv.getImageData(0, 0, 1, 1).data
  const top = document.querySelector('.topbar').getBoundingClientRect()
  return {
    id: el.getAttribute('aria-label') || el.getAttribute('href'), tab: el.classList.contains('navbar-link'),
    style: s.outlineStyle, width: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset), colour: [c[0], c[1], c[2]],
    x: r.left, y: r.top, w: r.width, h: r.height, topbarBottom: top.bottom, vw: document.documentElement.clientWidth,
  }
}
const LONG = {
  ar: { bar: 'التوصيل خلال ٢٤ ساعة داخل الكويت · الدفع عند الاستلام · استبدال مجاني خلال ١٤ يوماً · شحن سريع لكل المحافظات · عروض نهاية الموسم', tab: 'حسابي وطلباتي وعناويني' },
  en: { bar: 'Delivery within 24 hours inside Kuwait · Cash on delivery · Free exchange within 14 days · Fast shipping to every governorate · End of season offers', tab: 'Account settings and orders' },
}
// opt.early: the CSS under test is placed BEFORE the live bundle's rules; opt.stress: an admin-length announcement
// and a long last tab label (the announcement text is edited in the admin; a label can be longer than today's)
const capture = async (css, lang, w, opt = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, locale: lang === 'ar' ? 'ar-KW' : 'en-US' })
  const pg = await ctx.newPage()
  await pg.setContent(buildPage(lang, css, !!opt.early))
  await pg.evaluate(() => document.fonts.ready)
  if (opt.stress) await pg.evaluate(({ bar, tab }) => { document.querySelector('.topbar .truncate').textContent = bar; document.querySelectorAll('.navbar-link')[4].textContent = tab }, LONG[lang])
  await pg.mouse.move(w - 1, 700) // off the header, so nothing is hovered
  if (opt.stress) { const m = await pg.evaluate(measure); await ctx.close(); return { m } }
  const m = await pg.evaluate(measure)
  const tabs = await pg.$$('.navbar-link')
  await tabs[2].hover()
  const hov = await pg.evaluate(measure)
  await pg.mouse.move(w - 1, 700)
  await pg.evaluate(() => document.activeElement && document.activeElement.blur())
  const stops = []
  // the tabs carry Tailwind's `transition` (outline-color included, 150ms): read the ring once it has settled
  for (let i = 0; i < TAB_STOPS + 1; i++) { await pg.keyboard.press('Tab'); await pg.evaluate(() => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => 0)))); stops.push(await pg.evaluate(FOCUS)) }
  await ctx.close()
  return { m, hovTab: hov.contrast.tab2, stops }
}

// the baseline (no section) is measured once per page and reused by every run, mutants included
const base = {}
for (const lang of LANGS) for (const w of WIDTHS) base[lang + w] = await capture(BEFORE_CSS, lang, w)

const suite = async (css) => {
  pass = 0; fail = 0
  const rows = []
  for (const lang of LANGS) for (const w of WIDTHS) {
    head(`${lang} ${w}px`)
    const A = await capture(css, lang, w), B = base[lang + w]
    const m = A.m, b = B.m
    const phone = w <= 639
    rows.push([lang, w, b.h, m.h, b.topFont, m.topFont, b.tabFont, m.tabFont, b.topLines, m.topLines])

    // 1. tap targets and overlaps
    const small = Object.entries(m.boxes).filter(([, x]) => x.w < 43.99 || x.h < 43.99).map(([k, x]) => `${k} ${f1(x.w)}x${f1(x.h)}`)
    is(small.length === 0, 'every interactive element (AI, language, bag, logo, 5 tabs) is at least 44x44', small.join(', '))
    is(m.overlaps.length === 0, 'no two controls of the brand row overlap (AI, clock, logo, language, bag)', m.overlaps.join(', '))
    is(m.clock.h >= 43.99, 'the clock is 44px tall (it is not interactive, but it sits in the 44px row)', f1(m.clock.h))

    // 2. tabs
    is(m.tabFont >= 13.99, 'tab labels are 14px or more', `${f1(m.tabFont)}px (was ${f1(b.tabFont)}px)`)
    is(m.tabLines.every((n) => n === 1) && m.tabCut.every((c) => c <= 0.5), 'tab labels are on one line and not truncated', `lines ${m.tabLines}, cut ${m.tabCut.map(f1)}`)
    const sorted = [...m.tabBoxes].sort((p, q) => p[0] - q[0])
    const between = sorted.slice(1).map((x, i) => x[0] - (sorted[i][0] + sorted[i][1]))
    is(Math.max(...between) - Math.min(...between) <= 1, 'the five tabs are evenly spaced (equal gaps between boxes)', between.map(f1).join(' / '))
    if (phone && w >= 360) is(Math.max(...sorted.map((x) => x[1])) - Math.min(...sorted.map((x) => x[1])) <= 1, 'from 360px the five phone columns are equal width', sorted.map((x) => f1(x[1])).join(' / '))
    is(m.hdrOverflow <= 0 && m.docOverflow <= 0, 'nothing in the header overflows sideways', `header ${m.hdrOverflow}, page ${m.docOverflow}`)
    if (phone) {
      is(m.ulOverflowX === 'auto' && m.ulScrollbarWidth === 'none', 'the phone tab row scrolls sideways without a scrollbar if it ever overflows', `${m.ulOverflowX} / ${m.ulScrollbarWidth}`)
      is(m.ulOverflow <= 0.5, 'and at this width it does not need to', `${f1(m.ulOverflow)}px`)
    }

    // 3. brand row
    is(near(m.logoCentre, m.viewCentre, 2), 'the logo is centred on the screen', `${f1(m.logoCentre)} vs ${f1(m.viewCentre)}`)
    if (phone) is(m.aiLabel.display === 'none', 'the AI launcher label is hidden under 640px (no wrap, no clash with the clock)', m.aiLabel.display)
    else is(m.aiLabel.display !== 'none' && m.aiLabel.lines === 1 && m.overlaps.length === 0, 'from 640px the AI launcher label is on one line and meets nothing', `${m.aiLabel.lines} line(s)`)

    // 4. announcement bar
    if (phone) is(m.topFont >= 11.99, 'announcement text is 12px or more on a phone', `${f1(m.topFont)}px (was ${f1(b.topFont)}px)`)
    is(m.topLines <= 2 && m.topCut <= 0.5, 'announcement text is whole: at most two lines, nothing cut off', `${m.topLines} line(s), cut ${f1(m.topCut)}px (was ${f1(b.topCut)}px cut, ${b.topLines} line)`)
    is(m.contrast.topbar >= 4.5, 'announcement text is 4.5:1 or better on the orange', m.contrast.topbar.toFixed(2))
    is(m.contrast.tab >= 4.5 && A.hovTab >= 4.5, 'tab text is 4.5:1 or better at rest and on hover', `${m.contrast.tab.toFixed(2)} / ${A.hovTab.toFixed(2)}`)
    is(m.contrast.brandBright >= 3 && m.contrast.brand >= 3, 'the orange of hover / focus / badge is 3:1 or better on the charcoal', `${m.contrast.brandBright.toFixed(2)} / ${m.contrast.brand.toFixed(2)}`)

    // 5. sticky chrome
    is(m.h.header <= b.h.header + 0.5, 'the sticky chrome does not grow', `${f1(m.h.header)}px vs ${f1(b.h.header)}px`)
    if (phone && m.topLines === 1) is(m.h.header <= b.h.header - 8, 'on a phone it shrinks by 8px or more (one-line bar)', `${f1(m.h.header)}px vs ${f1(b.h.header)}px`)
    if (phone) is(m.h.tabs >= 44, 'the tab row is still 44px or more', f1(m.h.tabs))
    if (!phone) {
      is(near(m.h.header, b.h.header, 0.5) && near(m.h.topbar, b.h.topbar, 0.5) && near(m.h.main, b.h.main, 0.5) && near(m.h.tabs, b.h.tabs, 0.5), 'from 640px the three layers keep their heights', `${f1(m.h.topbar)}+${f1(m.h.main)}+${f1(m.h.tabs)} vs ${f1(b.h.topbar)}+${f1(b.h.main)}+${f1(b.h.tabs)}`)
      const moved = ['ai', 'lang', 'cart', 'logo'].filter((k) => !(near(m.boxes[k].x, b.boxes[k].x, 1) && near(m.boxes[k].y, b.boxes[k].y, 1) && near(m.boxes[k].w, b.boxes[k].w, 1)))
      is(moved.length === 0 && near(m.clock.x, b.clock.x, 1), 'from 640px the brand row does not move', moved.join(', '))
      const centre = (x) => { const s = [...x.tabBoxes].sort((p, q) => p[0] - q[0]); return (s[0][0] + s[s.length - 1][0] + s[s.length - 1][1]) / 2 }
      is(near(centre(m), centre(b), 1), 'the tab row stays centred where it was', `${f1(centre(m))} vs ${f1(centre(b))}`)
    }

    // 6. keyboard
    const ids = A.stops.slice(0, TAB_STOPS).map((s) => s && s.id), bids = B.stops.slice(0, TAB_STOPS).map((s) => s && s.id)
    is(ids.length === TAB_STOPS && ids.every(Boolean) && JSON.stringify(ids) === JSON.stringify(bids), 'the tab order is the baseline order (AI, logo, language, bag, five tabs)', ids.join(' > '))
    const first4 = A.stops.slice(0, 4).filter(Boolean), tabsX = A.stops.slice(4, 9).filter(Boolean)
    is(first4.length === 4 && first4.every((s, i) => i === 0 || s.x > first4[i - 1].x), 'focus runs left to right through the brand row (reading order)', first4.map((s) => f1(s.x)).join(' < '))
    const dir = lang === 'ar' ? -1 : 1
    is(tabsX.length === 5 && tabsX.every((s, i) => i === 0 || (s.x - tabsX[i - 1].x) * dir > 0), `focus runs ${lang === 'ar' ? 'right to left' : 'left to right'} through the tabs`, tabsX.map((s) => f1(s.x)).join(', '))
    const stops = A.stops.slice(0, TAB_STOPS).filter(Boolean)
    is(stops.length === TAB_STOPS && stops.every((s) => s.style === 'solid' && s.width >= 2.99), 'every tab stop shows a solid ring of 3px or more', stops.map((s) => `${s.style} ${s.width}`).join(', '))
    is(stops.length === TAB_STOPS && stops.every((s) => near(s.colour[0], 255, 1) && near(s.colour[1], 123, 1) && near(s.colour[2], 23, 1)), 'the ring is the bright orange (#FF7B17)', stops.map((s) => s.colour.join(',')).join(' | '))
    const reach = (s) => Math.max(0, s.offset + s.width)
    is(stops.length === TAB_STOPS && stops.filter((s) => s.tab).every((s) => reach(s) <= 0.01), 'a tab\'s ring lies inside its box (a scrolling row cannot clip it)', stops.filter((s) => s.tab).map((s) => f1(reach(s))).join(', '))
    is(stops.length === TAB_STOPS && stops.filter((s) => !s.tab).every((s) => s.y - reach(s) >= s.topbarBottom - 0.01 && s.x - reach(s) >= -0.01 && s.x + s.w + reach(s) <= s.vw + 0.01), 'a brand-row ring stays inside the room it has: not under the announcement bar, not off the screen', stops.filter((s) => !s.tab).map((s) => `top ${f1(s.y - reach(s) - s.topbarBottom)}`).join(', '))
    // 7. the order the add-on is loaded in, and text longer than today's
    if (w === 320 || w === 390) {
      const E = await capture(css, lang, w, { early: true })
      const ring = E.stops.slice(0, TAB_STOPS).filter(Boolean)
      is(near(E.m.h.header, m.h.header, 0.5) && E.m.tabFont >= 13.99 && ring.length === TAB_STOPS && ring.every((x) => x.width >= 2.99), 'the section wins whatever the load order (placed before the live bundle: same height, 14px tabs, 3px ring)', `${f1(E.m.h.header)} vs ${f1(m.h.header)}, ${f1(E.m.tabFont)}px`)
    }
    if (w === 320) {
      const S = (await capture(css, lang, w, { stress: true })).m
      // (the third line is laid out but clipped by the line clamp, so the bar's own height is what counts)
      is(S.h.topbar <= 36.5 && S.h.header <= 138.5, 'a long announcement stops at two lines (bar 36px at most) and the chrome stays within the old 138px', `bar ${f1(S.h.topbar)}px, chrome ${f1(S.h.header)}px`)
      is(S.docOverflow <= 0 && S.hdrOverflow <= 0, 'a long tab label does not push the page or the header sideways', `${S.docOverflow} / ${S.hdrOverflow}`)
      const st = [...S.tabBoxes.map((x, i) => [x[0], x[1], S.boxes['tab' + i].h])].sort((p, q) => p[0] - q[0])
      is(st.every((x) => x[1] >= 43.99 && x[2] >= 43.99) && st.slice(1).every((x, i) => x[0] >= st[i][0] + st[i][1] - 0.5), 'the tabs stay 44x44 and do not overlap each other, even then', st.map((x) => f1(x[1])).join(' / '))
      is(S.ulOverflow > 0.5 && S.ulOverflowX === 'auto' && S.ulScrollbarWidth === 'none', 'and the row scrolls sideways, without a scrollbar, to reach the rest', `scrolls ${f1(S.ulOverflow)}px, ${S.ulOverflowX}/${S.ulScrollbarWidth}`)
    }
  }
  return rows
}

// ---- the real run ---------------------------------------------------------------------------------------------
const rows = await suite(BEFORE_CSS + '\n' + SECTION)
const realPass = pass, realFail = fail
pass = 0; fail = 0

// ---- the section itself: where it is and what it may contain ---------------------------------------------------
quiet = false
head('the section')
const raw = BEFORE_CSS + SECTION // the one read of the file, so an edit during the run cannot disagree with itself
is(raw.split(SECTION_START).length === 2, 'the section exists once in the file', String(raw.split(SECTION_START).length - 1))
is(SECTION.length > 0 && raw.endsWith(SECTION), 'it is the last thing in the file')
const code = SECTION.replace(/\/\*[\s\S]*?\*\//g, '')
const codeNoAt = code.replace(/@media[^{]*\{/g, '') // the media prefixes are not selectors; their closing braces stay harmlessly
const selectors = [...codeNoAt.matchAll(/(^|[};])\s*([^{};]+)\{/g)].map((x) => x[2].trim()).filter(Boolean)
// split on top-level commas only (":is(a, button)" is one selector)
const topSplit = (sel) => { const out = []; let d = 0, cur = ''; for (const ch of sel) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = '' } else cur += ch } out.push(cur.trim()); return out }
const unscoped = selectors.flatMap(topSplit).filter((t) => !t.startsWith('.app-header'))
is(selectors.length >= 8 && unscoped.length === 0, 'every selector in the section is under .app-header', unscoped.join(' | '))
const physical = codeNoAt.match(/\b(margin|padding|border)-(left|right)\b|(^|[\s{;])(left|right)\s*:|text-align\s*:\s*(left|right)|\bwidth\s*:\s*\d+px/gi)
is(!physical, 'logical properties only (no left/right, no fixed pixel widths)', physical ? physical.join(', ') : '')
is(!/!important/.test(code), 'no !important')
is(!/@import|url\(/.test(code), 'no imports, no urls')

// ---- the table ------------------------------------------------------------------------------------------------
console.log('\n=== before -> after (sticky chrome = announcement + brand row + tabs + 1px rule) ' + '='.repeat(4))
console.log('lang  width  header(px)         bar            brand row       tabs          bar font    tab font    bar lines')
for (const [lang, w, bh, ah, bf, af, btf, atf, bl, al] of rows) {
  console.log(`${lang}    ${String(w).padStart(5)}  ${f1(bh.header).padStart(6)} -> ${f1(ah.header).padStart(6)}  ${f1(bh.topbar).padStart(5)} -> ${f1(ah.topbar).padStart(5)}  ${f1(bh.main).padStart(5)} -> ${f1(ah.main).padStart(5)}  ${f1(bh.tabs).padStart(5)} -> ${f1(ah.tabs).padStart(5)}  ${f1(bf).padStart(5)} -> ${f1(af).padStart(5)}  ${f1(btf).padStart(5)} -> ${f1(atf).padStart(5)}  ${bl} -> ${al}`)
}

// ---- mutation: cut the section, and each block of it ------------------------------------------------------------
const blocks = []
{
  const re = /\/\* \[menu-(\d)\]/g
  const marks = [...SECTION.matchAll(re)].map((x) => ({ n: x[1], at: x.index }))
  marks.forEach((mk, i) => blocks.push({ n: mk.n, text: SECTION.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : SECTION.length) }))
}
is(blocks.length === 5, 'the section has its five numbered blocks [menu-1] .. [menu-5]', String(blocks.length))
const sectionPass = pass, sectionFail = fail
quiet = true
head('mutation')
const mutants = [{ name: 'whole section cut', css: BEFORE_CSS }]
for (const bl of blocks) mutants.push({ name: `[menu-${bl.n}] cut`, css: BEFORE_CSS + '\n' + SECTION.replace(bl.text, '') })
const killed = []
for (const mu of mutants) {
  await suite(mu.css)
  killed.push([mu.name, fail])
}
quiet = false
pass = sectionPass; fail = sectionFail
console.log('\n=== mutation: cut the CSS, the suite must fail ' + '='.repeat(14))
for (const [name, n] of killed) is(n > 0, `${name}: the suite fails`, 'survived: no check noticed the cut')
for (const [name, n] of killed) console.log(`     ${name.padEnd(22)} ${n} failing checks`)

await browser.close()
console.log(`\nmeasurements: ${realPass} passed, ${realFail} failed. All: ${pass + realPass} passed, ${fail + realFail} failed.`)
process.exit(fail + realFail ? 1 : 0)
