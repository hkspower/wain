// Page builder, local server and in-page measurements shared by sizes-product-test.mjs.
//
// The pages are the LIVE storefront's product page: the real compiled build, rendered from the captured catalogue and
// stock list, saved by scripts/make-sizes-product-fixtures.mjs as scripts/fixtures/sizes-product/<scenario>-<lang>.html (the
// product <section>, which holds the fixed buy bar). They sit under the LIVE compiled rules (live.css, dumped from the
// build's CSSOM with the page in its light and its dark state), then the 14 add-on stylesheets the live index.html links, in
// the order it links them (the repo's files, product-fix swapped for the variant under test), then the <style> the add-on
// script injects ("One size"). No script runs: the markup already holds what sporta-features.js did (the sizes a product has
// no variant for are display:none, exactly as live), which is also how the suite proves no rule waits for a script.
// The sticky header is not in the fixtures; a spacer of its measured height (meta.json) stands in for it.
import { readFileSync, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const FX = join(ROOT, 'scripts/fixtures/sizes-product')
export const PUB = join(ROOT, 'public')
const read = (p) => readFileSync(p, 'utf8')

// the order the live index.html links its add-on stylesheets (the bundle's own stylesheet comes first)
export const ADDON_ORDER = ['sporta-product-fix.css', 'sporta-brand-theme.css', 'sporta-home-trim.css', 'sporta-cart-drawer.css', 'sporta-grid.css', 'sporta-bag-touch.css', 'sporta-cat-tiles.css', 'sporta-admin-knet.css', 'sporta-returns-touch.css', 'sporta-clock.css', 'sporta-ui-colours.css', 'sporta-checkout-a11y.css', 'sporta-shadows.css', 'sporta-images.css']
export const SCENARIOS = ['full', 'full-pick', 'full-sold', 'full-add', 'three', 'two', 'one']
export const WIDTHS = [320, 360, 390, 768, 1280]
export const LANGS = ['ar', 'en']
export const META = JSON.parse(read(join(FX, 'meta.json')))

// The SIZES section of public/sporta-product-fix.css is the last thing in the file; "before" is the file cut at its marker,
// which is byte for byte the file as it was before this lane (and as the repo has shipped it to the VPS dir).
export const SECTION_START = '/* ==== SIZES:'
export const sectionOf = (css) => { const i = css.indexOf(SECTION_START); return i < 0 ? { before: css, section: '' } : { before: css.slice(0, i), section: css.slice(i) } }
// the numbered blocks of the section: "/* [sizes-prod-1] ..." up to the next marker (or the end of the file)
export const blocksOf = (section) => {
  const out = [], re = /\/\* \[(sizes-prod-\d)\]/g
  const marks = [...section.matchAll(re)]
  marks.forEach((m, i) => out.push({ id: m[1], start: m.index, end: i + 1 < marks.length ? marks[i + 1].index : section.length }))
  return out
}
export const addonFiles = () => Object.fromEntries(ADDON_ORDER.map((f) => [f, read(join(PUB, f))]))

const attrs = (o) => Object.entries(o).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('')
const HEAD = read(join(FX, 'head.css')), LIVE = read(join(FX, 'live.css')), FEATURES = read(join(FX, 'features.css'))
// dark = the page in the compiled dark theme (html[data-theme=dark] and html.dark, set the way boot.js sets them)
export const fixturePage = (name, lang, w, addons, dark = false) => {
  const raw = read(join(FX, `${name}-${lang}.html`))
  const html = JSON.parse(raw.match(new RegExp(`^<!-- ${dark ? 'html-dark' : 'html'}: (.*) -->$`, 'm'))[1]), body = JSON.parse(raw.match(/^<!-- body: (.*) -->$/m)[1])
  const section = raw.split('\n').filter((l) => !/^<!-- (html|html-dark|body): /.test(l)).join('\n')
  const hh = META.header[`${lang}|${w}`].h
  return `<!doctype html><html${attrs(html)}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="fx-head">${HEAD}</style><style id="fx-live">${LIVE}</style>${ADDON_ORDER.map((f) => `<style data-addon="${f}">${addons[f]}</style>`).join('')}<style id="fx-features">${FEATURES}</style></head><body${attrs(body)}><div id="root"><div class="storefront-root flex min-h-screen flex-col"><div id="fx-header" style="position:sticky;top:0;z-index:40;height:${hh}px;background:#171a1e"></div><main id="main" class="flex-1">${section}</main><div id="fx-footer" style="height:900px"></div></div></div></body></html>`
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const MIME = { css: 'text/css; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8' }
// A tiny server: /__fx/<scenario>-<lang>-<width>[-dark] is the fixture (add-ons as given by the caller), everything else is
// public/ (the real self-hosted fonts) or a 1x1 PNG for an image that is not on disk.
export const serve = (addonsRef) => new Promise((res) => {
  const s = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x')
    const m = u.pathname.match(/^\/__fx\/([\w-]+)-(ar|en)-(\d+)(-dark)?$/)
    if (m) { r.writeHead(200, { 'content-type': MIME.html }); return r.end(fixturePage(m[1], m[2], +m[3], addonsRef.current, !!m[4])) }
    const f = PUB + decodeURIComponent(u.pathname)
    if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) { r.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'application/octet-stream' }); return r.end(readFileSync(f)) }
    r.writeHead(200, { 'content-type': 'image/png' }); r.end(PNG)
  }).listen(0, '127.0.0.1', () => res({ server: s, base: 'http://127.0.0.1:' + s.address().port }))
})

// ---- measurements (run inside the page) ----------------------------------------------------------------------
export const measure = () => {
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)]
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + scrollY, w: r.width, h: r.height, r: r.right, b: r.bottom + scrollY } }
  const B = (s) => { const e = $(s); return e ? R(e) : null }
  const px = (v) => parseFloat(v)
  const vw = document.documentElement.clientWidth, vh = innerHeight
  const card = $('#product-size-options'), group = card && card.querySelector('[role="group"]')
  const chips = group ? [...group.querySelectorAll(':scope > button')] : []
  const shown = chips.filter((b) => getComputedStyle(b).display !== 'none')
  const chip = (b) => {
    const c = getComputedStyle(b), sp = b.querySelector('span'), sc = sp && getComputedStyle(sp)
    return {
      t: b.textContent.trim(), dis: b.disabled, on: b.getAttribute('aria-pressed') === 'true', ...R(b), fs: px(c.fontSize), fw: c.fontWeight, color: c.color, bg: c.backgroundColor,
      bs: c.borderTopStyle, bw: px(c.borderTopWidth), bc: c.borderTopColor, bsh: c.boxShadow, cur: c.cursor, pi: px(c.paddingInlineStart), minw: c.minWidth,
      td: sc ? sc.textDecorationLine : '', tdt: sc ? sc.textDecorationThickness : '', tdc: sc ? sc.textDecorationColor : '', over: Math.max(b.scrollWidth - b.clientWidth, sp ? sp.scrollWidth - sp.clientWidth : 0),
      one: b.hasAttribute('data-sporta-one'), afterTd: sp ? getComputedStyle(sp, '::after').textDecorationLine : '', afterTdt: sp ? getComputedStyle(sp, '::after').textDecorationThickness : '', col: c.gridColumnStart + '/' + c.gridColumnEnd, fam: c.fontFamily.slice(0, 40),
    }
  }
  const tops = [...new Set(shown.map((b) => Math.round(R(b).y)))].sort((a, b) => a - b)
  const sizeCards = $$('.catalog-product-options > div')
  const stock = card && [...card.children].find((e) => e.tagName === 'DIV' && e !== group && e !== card.firstElementChild)
  const alertEl = card && card.querySelector('[role="alert"]')
  const guide = card && card.querySelector('button.text-accent')
  const hint = card && [...card.children].filter((e) => e.tagName === 'P' && e.getAttribute('role') !== 'alert').pop()
  const fitGroup = sizeCards[1] && sizeCards[1].querySelector('[role="group"]')
  const row = $('.product-purchase-row'), bar = $('.action-bar')
  const addBtn = row && row.querySelector('.btn-primary'), stepper = row && row.querySelector('.catalog-product-quantity')
  const cs = (e) => (e ? getComputedStyle(e) : null)
  // gaps between NEIGHBOURS only: along each row (sorted by x), and from each row to the next
  const gapsX = [], gapsY = []
  const byRow = {}
  shown.forEach((b) => { const r = R(b); (byRow[Math.round(r.y)] ||= []).push(r) })
  const rowKeys = Object.keys(byRow).map(Number).sort((x, y) => x - y)
  rowKeys.forEach((k, i) => {
    const row = byRow[k].sort((p, q) => p.x - q.x)
    for (let j = 1; j < row.length; j++) gapsX.push(row[j].x - row[j - 1].r)
    if (i + 1 < rowKeys.length) gapsY.push(byRow[rowKeys[i + 1]][0].y - Math.max(...row.map((r) => r.b)))
  })
  return {
    vw, vh, docW: document.documentElement.scrollWidth, page: document.documentElement.scrollHeight, rem: px(cs(document.documentElement).fontSize), dir: document.documentElement.dir,
    chips: chips.map(chip), shown: shown.map(chip), hiddenN: chips.length - shown.length, rows: tops.length, ladder: group ? R(group) : null, groupDisplay: group ? cs(group).display : null,
    cols: group ? cs(group).gridTemplateColumns : null, gapCss: group ? cs(group).columnGap + ' ' + cs(group).rowGap : null,
    gapMinX: gapsX.length ? Math.min(...gapsX) : null, gapMaxX: gapsX.length ? Math.max(...gapsX) : null, gapMinY: gapsY.length ? Math.min(...gapsY) : null,
    card: card ? R(card) : null, cardCs: card ? { pt: px(cs(card).paddingTop), pb: px(cs(card).paddingBottom), pi: px(cs(card).paddingInlineStart), bw: px(cs(card).borderTopWidth), bsty: cs(card).borderTopStyle, bg: cs(card).backgroundColor, bc: cs(card).borderTopColor, contain: cs(card).contain } : null,
    head: card ? R(card.firstElementChild) : null, headMb: card ? px(cs(card.firstElementChild).marginBottom) : null,
    stock: stock ? { ...R(stock), mt: px(cs(stock).marginTop), minh: px(cs(stock).minHeight), kids: stock.children.length } : null,
    alert: alertEl ? R(alertEl) : null, hint: hint ? { ...R(hint), mt: px(cs(hint).marginTop), fs: px(cs(hint).fontSize), disp: cs(hint).display } : null,
    fit: fitGroup ? { ...R(fitGroup), chips: [...fitGroup.querySelectorAll(':scope > button')].map(R), gap: cs(fitGroup).columnGap, disp: cs(fitGroup).display } : null,
    guide: guide ? { ...R(guide), fs: px(cs(guide).fontSize) } : null,
    cards: sizeCards.map((c) => ({ ...R(c), mb: px(cs(c).marginBottom), pt: px(cs(c).paddingTop), pi: px(cs(c).paddingInlineStart), mt: px(cs(c).marginTop) })),
    opts: B('.catalog-product-options'), optsMt: $('.catalog-product-options') ? px(cs($('.catalog-product-options')).marginTop) : null,
    row: row ? { ...R(row), mt: px(cs(row).marginTop), pos: cs(row).position } : null, add: addBtn ? R(addBtn) : null, stepper: stepper ? R(stepper) : null,
    stepBtns: stepper ? [...stepper.querySelectorAll('button')].map(R) : [],
    bar: bar ? { ...R(bar), disp: cs(bar).display, pos: cs(bar).position } : null, barBtn: bar ? R(bar.querySelector('button')) : null,
    fixedBottom: bar && cs(bar).position === 'fixed' ? vh - (R(bar).y - scrollY) : 0,
    above: { gallery: B('.catalog-gallery-stage'), eyebrow: B('.catalog-eyebrow'), title: B('h1'), price: B('.catalog-product-price'), plate: B('.campaign-brand-plate') },
    below: { reassure: B('.catalog-product-reassurance'), related: B('.catalog-related') },
    swatches: $$('.catalog-colour-swatch').map(R),
    tapBad: $$('.catalog-product-options button, .catalog-product-options a, .product-purchase-row button').map((b) => ({ t: (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 14), r: R(b), shown: getComputedStyle(b).display !== 'none' })).filter((x) => x.shown && (x.r.w < 43.5 || x.r.h < 43.5)),
    fonts: [...document.fonts].filter((f) => f.status === 'loaded').length,
  }
}
