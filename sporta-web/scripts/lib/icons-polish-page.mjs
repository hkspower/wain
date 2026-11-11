// Page builder + measurements shared by icons-polish-test.mjs.
// Real Tailwind v4 compiles the utilities the live markup uses; the live compiled rules, the add-on files the live
// index.html links (in the order a browser applies them: bundle first, then add-ons) and the CSS under test are
// layered on top, exactly like the live cascade.
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOKENS, THEME, LIVE_ICON_RULES, LIVE_CARD_RULES, HOME_CSS, KINDS, body, classesOf } from '../fixtures/icons-polish.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const b64 = (p) => readFileSync(join(ROOT, p)).toString('base64')

// The sections this lane adds, each at the END of its file, each starting at its own marker.
export const MARK = '/* ==== ICONS'
export const FILES = ['public/sporta-shadows.css', 'public/sporta-clock.css']
// The add-ons the live index.html links for the storefront, in the order it links them (CLAUDE.md, item 5).
const LINKED = ['product-fix', 'brand-theme', 'home-trim', 'cart-drawer', 'grid', 'bag-touch', 'cat-tiles', 'returns-touch', 'clock', 'ui-colours', 'checkout-a11y', 'shadows', 'images']
export const addonPath = (n) => `public/sporta-${n}.css`

const TW = (await postcss([tailwind({ base: ROOT, optimize: false })]).process(
  `@import "tailwindcss" source(none);\n${THEME}\n@source inline("${classesOf().join(' ')}");`, { from: join(ROOT, 'icons-polish-fixture.css') })).css

const FONTS = [400, 600, 700].map((w) => `
@font-face{font-family:"Sporta Plex Arabic Local";font-weight:${w};src:url(data:font/woff2;base64,${b64(`public/fonts/plex-${w}-arabic.woff2`)}) format("woff2");unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC}
@font-face{font-family:"Sporta Plex Arabic Local";font-weight:${w};src:url(data:font/woff2;base64,${b64(`public/fonts/plex-${w}-latin.woff2`)}) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`).join('\n')

// cut(file, text) -> the file without its Icons section (the mutation / "before" state)
export const cut = (text) => { const i = text.indexOf(MARK); return i < 0 ? text : text.slice(0, i) }
export const sectionOf = (text) => { const i = text.indexOf(MARK); return i < 0 ? '' : text.slice(i) }

// overrides: { 'public/sporta-shadows.css': '<css>' } replaces the file text (the test passes the cut version)
export const page = (kind, lang, overrides = {}) => {
  const addons = LINKED.map((n) => { const p = addonPath(n); return `/* ${n} */\n` + (p in overrides ? overrides[p] : read(p)) }).join('\n')
  return `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><base href="https://fixture.test/"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${FONTS}</style><style>${TW}</style><style>${TOKENS}</style><style>${LIVE_ICON_RULES}\n${LIVE_CARD_RULES}</style>${kind === 'home' ? `<style>${HOME_CSS}</style>` : ''}<style>${addons}</style></head><body>${body(kind, lang)}</body></html>`
}

// ---- measurements (run inside the page) ------------------------------------------------------------------
export const measure = () => {
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const rgba = (c) => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1] }
  const bgOf = (el) => {
    const stack = []
    for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 1) break }
    let acc = stack.length && stack[stack.length - 1][3] >= 1 ? stack.pop() : [255, 255, 255, 1]
    while (stack.length) acc = over(stack.pop(), acc)
    return acc
  }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const R = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom })
  const flip = (el) => { // net horizontal mirroring of an element and its ancestors up to the container
    let s = 1
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n), t = cs.transform
      if (t && t !== 'none') { const m = new DOMMatrix(t); if (m.a < 0) s *= -1 }
      if (cs.scale && cs.scale !== 'none' && parseFloat(cs.scale) < 0) s *= -1
    }
    return s < 0
  }
  const out = {}
  for (const el of document.querySelectorAll('[data-ic]')) {
    const id = el.getAttribute('data-ic'), cs = getComputedStyle(el), r = el.getBoundingClientRect()
    const box = el.closest('button, a, [role="img"], .cart-drawer__mark, .campaign-category__arrow, .footer-payment, li, p') || el.parentElement
    const bcs = getComputedStyle(box), br = box.getBoundingClientRect()
    const rec = { id, tag: el.tagName, rect: R(r), box: R(br), boxTag: box.tagName, boxClass: box.className, vis: cs.visibility, display: cs.display }
    if (el.tagName.toLowerCase() === 'svg') {
      const path = el.querySelector('path, circle, rect')
      const sw = parseFloat(cs.strokeWidth), scale = parseFloat(el.getAttribute('width')) ? r.width / 24 : 1
      const ve = path ? getComputedStyle(path).vectorEffect : 'none'
      rec.attrW = parseFloat(el.getAttribute('width')); rec.sw = sw; rec.ve = ve
      rec.stroke = ve === 'non-scaling-stroke' ? sw : sw * scale
      rec.opacity = parseFloat(cs.opacity)
      rec.flipped = flip(el)
      // the ground starts at the parent: the ICON SET section paints the glyph AS the svg's own (masked) background
      const ground = bgOf(el.parentElement)
      const fg = over(rgba(cs.color).map((v, i) => (i === 3 ? v * rec.opacity : v)), ground)
      rec.fg = fg.slice(0, 3).map(Math.round); rec.bg = ground.slice(0, 3).map(Math.round)
      rec.contrast = ratio(fg, ground)
      rec.dx = r.left + r.width / 2 - (br.left + br.width / 2); rec.dy = r.top + r.height / 2 - (br.top + br.height / 2)
      rec.offL = r.left - br.left; rec.offT = r.top - br.top
    } else if (el.tagName === 'IMG') {
      rec.natural = [el.naturalWidth, el.naturalHeight]; rec.fit = cs.objectFit; rec.view = cs.objectViewBox
    } else {
      rec.bgColor = cs.backgroundColor; rec.opacity = parseFloat(cs.opacity)
      const fg = over(rgba(cs.backgroundColor).map((v, i) => (i === 3 ? v * rec.opacity : v)), bgOf(el.parentElement || el))
      rec.contrast = ratio(fg, bgOf(el.parentElement || el))
    }
    // the label next to the icon: text nodes of the container (outside the svg) and [data-label]
    const rg = document.createRange(); let have = false, u = null; const tops = new Set()
    const walk = (n) => {
      if (n.nodeType === 3 && n.textContent.trim()) { rg.selectNodeContents(n); for (const q of rg.getClientRects()) { if (q.width < 0.5) continue; u = u ? { l: Math.min(u.l, q.left), t: Math.min(u.t, q.top), r: Math.max(u.r, q.right), b: Math.max(u.b, q.bottom) } : { l: q.left, t: q.top, r: q.right, b: q.bottom }; tops.add(Math.round(q.top / 4)); have = true } }
      else if (n.nodeType === 1 && n !== el && n.tagName.toLowerCase() !== 'svg' && !n.matches('.absolute, .purchase-count')) n.childNodes.forEach(walk)
    }
    box.childNodes.forEach(walk)
    if (have) rec.label = { x: u.l, y: u.t, w: u.r - u.l, h: u.b - u.t, r: u.r, b: u.b, cy: (u.t + u.b) / 2, lines: tops.size }
    out[id] = rec
  }
  const face = document.querySelector('.clock__face')
  if (face) { const hb = bgOf(face.closest('.app-header')), st = over(rgba(getComputedStyle(face).stroke), hb); out.__clock = { stroke: getComputedStyle(face).stroke, contrast: ratio(st, hb) } }
  out.__page = { iw: innerWidth, over: document.documentElement.scrollWidth - innerWidth, root: parseFloat(getComputedStyle(document.documentElement).fontSize), dir: getComputedStyle(document.documentElement).direction }
  return out
}

// ---- ink centre of a label (needs a page opened at a high deviceScaleFactor) ---------------------------------
import { png } from './png.mjs'
// The vertical centre of mass of the pixels that differ from the background inside the label's rectangle, in CSS px.
// Icons are hidden first so only the text is measured. clip = the label rect padded by 3px above and below.
export const inkCentre = async (pg, label, dpr) => {
  const clip = { x: Math.max(0, label.x - 1), y: Math.max(0, label.y - 3), width: label.w + 2, height: label.h + 6 }
  await pg.addStyleTag({ content: '.sporta-icon{visibility:hidden!important} *{text-decoration:none!important}' }).catch(() => {})
  const P = png(await pg.screenshot({ clip, fullPage: true }))
  const bg = P.at(0, 0)
  let sum = 0, wy = 0, top = -1, bot = -1
  for (let y = 0; y < P.h; y++) {
    let row = 0
    for (let x = 0; x < P.w; x++) { const p = P.at(x, y); row += Math.max(Math.abs(p.r - bg.r), Math.abs(p.g - bg.g), Math.abs(p.b - bg.b)) / 255 }
    if (row > 0.4) { if (top < 0) top = y; bot = y }
    sum += row; wy += row * y
  }
  if (!sum) return null
  const s = 1 / dpr
  return { centroid: clip.y + (wy / sum + 0.5) * s, box: clip.y + ((top + bot + 1) / 2) * s, top: clip.y + top * s, bottom: clip.y + (bot + 1) * s }
}
