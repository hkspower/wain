// Page builder + measurements shared by menu-layout-test.mjs.
// Real Tailwind v4 compiles the utilities the live header uses; the live compiled rules, the add-on files the
// live index.html links (in the order a browser applies them: bundle first, then add-ons) and the CSS under
// test are layered on top, exactly like the live cascade.
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIVE_RULES, THEME, headerHtml, fontFaces } from '../fixtures/menu-layout.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const b64 = (p) => readFileSync(join(ROOT, p)).toString('base64')

export const SECTION_START = '/* ==== HEADER AND MENU LAYOUT'

// the markup classes -> real Tailwind
const probe = headerHtml('ar', 'x')
const classes = [...new Set([...probe.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))]
const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n${THEME}\n@source inline("${classes.join(' ')}");`, { from: join(ROOT, 'menu-layout-fixture.css') })).css

const FONTS = fontFaces(Object.fromEntries(['400', '600', '700'].flatMap((w) => ['arabic', 'latin'].map((s) => [`plex-${w}-${s}`, b64(`public/fonts/plex-${w}-${s}.woff2`)]))))
const LOGO = 'data:image/png;base64,' + b64('public/logo-white.png')
// add-on files that style the header's colours/shadows/clock, as linked by the live index.html
const ADDONS = ['public/sporta-brand-theme.css', 'public/sporta-ui-colours.css', 'public/sporta-shadows.css', 'public/sporta-clock.css'].map(read).join('\n')

export const page = (lang, extraCss = '') => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${FONTS}</style><style>${TW}</style><style>${LIVE_RULES}</style><style>${ADDONS}</style><style>${extraCss}</style></head><body><div class="storefront-root">${headerHtml(lang, LOGO)}<main id="main" style="height:1600px;padding:24px"><p>page</p></main></div></body></html>`

// the add-on file the section lives in, split into "everything before the section" and the section
export const sectionOf = (file) => {
  const css = readFileSync(file, 'utf8')
  const i = css.indexOf(SECTION_START)
  return i < 0 ? { before: css, section: '' } : { before: css.slice(0, i), section: css.slice(i) }
}

// ---- measurements (run inside the page) ------------------------------------------------------------------
export const measure = () => {
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)]
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom } }
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1] }
  const bgOf = (el) => { // composite the background layers from the element up to the first opaque one
    const stack = []
    for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 1) break }
    let acc = stack.length && stack[stack.length - 1][3] >= 1 ? stack.pop() : [255, 255, 255, 1]
    while (stack.length) acc = over(stack.pop(), acc)
    return acc
  }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const textColour = (el) => over(rgba(getComputedStyle(el).color), bgOf(el))
  const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); const ys = new Set([...r.getClientRects()].filter((q) => q.width > 0.5).map((q) => Math.round(q.top))); return ys.size }
  const cs = (el) => getComputedStyle(el)

  const header = $('.app-header'), top = $('.topbar'), main = $('.navbar-main'), sec = $('.navbar-secondary')
  const topSpan = top.querySelector('.truncate')
  const tabs = $$('.navbar-link')
  const logoImg = $('.navbar-logo img')
  const docW = document.documentElement.clientWidth
  const items = {
    ai: $('.navbar-ai'), lang: $('.navbar-language'), cart: $('.navbar-cart'), logo: $('.navbar-logo'),
    ...Object.fromEntries(tabs.map((t, i) => ['tab' + i, t])),
  }
  const boxes = Object.fromEntries(Object.entries(items).map(([k, el]) => [k, R(el)]))
  const clock = R($('.clock')), tools = R($('.navbar-tools')), actions = R($('.navbar-actions'))
  const brandRow = ['ai', 'clock', 'logo', 'lang', 'cart'].map((k) => [k, k === 'clock' ? clock : boxes[k]])
  const overlaps = []
  for (let i = 0; i < brandRow.length; i++) for (let j = i + 1; j < brandRow.length; j++) {
    const [ka, a] = brandRow[i], [kb, b] = brandRow[j]
    if (a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5) overlaps.push(ka + '/' + kb)
  }
  const label = $('.navbar-ai-label')
  const topC = textColour(topSpan), topBg = bgOf(top), tabC = textColour(tabs[0]), tabBg = bgOf(tabs[0])
  const ink = [23, 26, 30, 1]
  const rootCs = cs(document.documentElement)
  const brandBright = rgba(rootCs.getPropertyValue('--brand-bright').trim() || '#ff7b17'), brand = rgba(rootCs.getPropertyValue('--brand').trim() || '#e0561c')
  const ul = sec.querySelector('ul')
  return {
    vw: docW,
    h: { header: R(header).h, topbar: R(top).h, main: R(main).h, tabs: R(sec).h },
    boxes, clock, tools, actions,
    topFont: parseFloat(cs(topSpan).fontSize), topCut: topSpan.scrollWidth - topSpan.clientWidth, topLines: lines(topSpan),
    tabFont: parseFloat(cs(tabs[0]).fontSize),
    tabCut: tabs.map((t) => t.scrollWidth - t.clientWidth), tabLines: tabs.map(lines),
    tabTextW: tabs.map((t) => { const r = document.createRange(); r.selectNodeContents(t); return r.getBoundingClientRect().width }),
    aiLabel: { display: cs(label).display, lines: lines(label), w: R(label).w },
    iconSizes: $$('.app-header .navbar-main svg.sporta-icon').map((s) => [s.getAttribute('width'), R(s).w]),
    logoCentre: R(logoImg).x + R(logoImg).w / 2, viewCentre: docW / 2,
    hdrOverflow: header.scrollWidth - header.clientWidth, docOverflow: document.documentElement.scrollWidth - docW,
    ulOverflow: ul.scrollWidth - ul.clientWidth, ulOverflowX: cs(ul).overflowX, ulScrollbarWidth: cs(ul).scrollbarWidth,
    overlaps,
    contrast: { topbar: ratio(topC, topBg), tab: ratio(tabC, tabBg), brandBright: ratio(brandBright, ink), brand: ratio(brand, ink) },
    tabBoxes: tabs.map((t) => { const r = R(t); return [r.x, r.w] }),
  }
}
