// Page builder, local server and in-page measurements shared by sizes-screen-test.mjs.
//
// The pages are the LIVE storefront's rendered markup (scripts/fixtures/sizes-screen/<page>-<lang>.html, captured from the
// compiled build by scripts/make-sizes-fixtures.mjs) under the LIVE compiled rules (live.css, dumped from the build's CSSOM),
// then the 14 add-on stylesheets the live index.html links, in the order it links them, then the stylesheet the add-on
// script injects. Nothing is recompiled and no script runs: the markup already holds what sporta-features.js, the footer
// call script and the clock built, which is also how the suite proves no rule waits for those scripts.
import { readFileSync, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const FX = join(ROOT, 'scripts/fixtures/sizes-screen')
export const PUB = join(ROOT, 'public')
const read = (p) => readFileSync(p, 'utf8')

// the order the live index.html links its add-on stylesheets (the bundle's own stylesheet comes first)
export const ADDON_ORDER = ['sporta-product-fix.css', 'sporta-brand-theme.css', 'sporta-home-trim.css', 'sporta-cart-drawer.css', 'sporta-grid.css', 'sporta-bag-touch.css', 'sporta-cat-tiles.css', 'sporta-admin-knet.css', 'sporta-returns-touch.css', 'sporta-clock.css', 'sporta-ui-colours.css', 'sporta-checkout-a11y.css', 'sporta-shadows.css', 'sporta-images.css']
// the four files that carry a SIZES section
export const SIZES_FILES = ['sporta-cat-tiles.css', 'sporta-checkout-a11y.css', 'sporta-cart-drawer.css', 'sporta-returns-touch.css']
export const SECTION_START = '/* ==== SIZES:'
export const PAGES = ['home', 'about', 'terms', 'cart', 'checkout', 'drawer']
export const WIDTHS = [320, 360, 390, 768, 1280]
export const LANGS = ['ar', 'en']

export const sectionOf = (css) => { const i = css.indexOf(SECTION_START); return i < 0 ? { before: css, section: '' } : { before: css.slice(0, i), section: css.slice(i) } }
// the numbered blocks of a section: "/* [sizes-foot-1] */" up to the next marker (or the end of the file)
export const blocksOf = (section) => {
  const out = [], re = /\/\* \[(sizes-[a-z]+-\d)\] \*\//g
  const marks = [...section.matchAll(re)]
  marks.forEach((m, i) => out.push({ id: m[1], start: m.index, end: i + 1 < marks.length ? marks[i + 1].index : section.length }))
  return out
}
export const addonFiles = () => Object.fromEntries(ADDON_ORDER.map((f) => [f, read(join(PUB, f))]))

const attrs = (o) => Object.entries(o).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('')
const HEAD = read(join(FX, 'head.css')), LIVE = read(join(FX, 'live.css')), FEATURES = read(join(FX, 'features.css'))
export const fixturePage = (name, lang, addons) => {
  const raw = read(join(FX, `${name}-${lang}.html`))
  const html = JSON.parse(raw.match(/^<!-- html: (.*) -->$/m)[1]), body = JSON.parse(raw.match(/^<!-- body: (.*) -->$/m)[1])
  const markup = raw.split('\n').filter((l) => !/^<!-- (html|body): /.test(l)).join('\n')
  return `<!doctype html><html${attrs(html)}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="fx-head">${HEAD}</style><style id="fx-live">${LIVE}</style>${ADDON_ORDER.map((f) => `<style data-addon="${f}">${addons[f]}</style>`).join('')}<style id="fx-features">${FEATURES}</style></head><body${attrs(body)}>${markup}</body></html>`
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const MIME = { css: 'text/css; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8' }
// A tiny server: /__fx/<page>-<lang> is the fixture (add-ons as given by the caller), everything else is public/ (the real
// self-hosted fonts, the real category photos) or a 1x1 PNG for an image that is not on disk.
export const serve = (addonsRef) => new Promise((res) => {
  const s = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x')
    const m = u.pathname.match(/^\/__fx\/(\w+)-(ar|en)$/)
    if (m) { r.writeHead(200, { 'content-type': MIME.html }); return r.end(fixturePage(m[1], m[2], addonsRef.current)) }
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
  const BA = (s) => $$(s).map(R)
  const fs = (s) => { const e = $(s); return e ? parseFloat(getComputedStyle(e).fontSize) : null }
  const pad = (s) => { const e = $(s); if (!e) return null; const c = getComputedStyle(e); return { t: parseFloat(c.paddingTop), b: parseFloat(c.paddingBottom), mt: parseFloat(c.marginTop), mb: parseFloat(c.marginBottom) } }
  const vw = document.documentElement.clientWidth
  const text = [], taps = []
  $$('body *').forEach((e, i) => {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return
    const r = e.getBoundingClientRect(); if (!(r.width > 1 && r.height > 1)) return
    const c = getComputedStyle(e); if (c.visibility === 'hidden' || c.display === 'none') return
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim())
    if (own) text.push({ i, tag: e.tagName.toLowerCase(), fs: parseFloat(c.fontSize), color: c.color, bg: c.backgroundColor, t: e.textContent.trim().slice(0, 24) })
    if (e.matches('a[href], button, summary, input:not([type=hidden]), select, textarea, [role="button"]')) taps.push({ i, w: r.width, h: r.height, t: (e.getAttribute('aria-label') || e.textContent || e.className || '').trim().slice(0, 24) })
  })
  const clipped = (el) => el.scrollHeight - el.clientHeight
  return {
    vw, docW: document.documentElement.scrollWidth, page: document.documentElement.scrollHeight, rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    dOver: $('.campaign-cart-drawer') ? $('.campaign-cart-drawer').scrollWidth - $('.campaign-cart-drawer').clientWidth : 0,
    text, taps,
    fonts: { loaded: [...document.fonts].filter((f) => f.status === 'loaded').length },
    b: {
      header: B('.app-header'), hero: B('.campaign-home > section'),
      tiles: BA('.campaign-category'), tileCopy: BA('.campaign-category__content'), tileClip: $$('.campaign-category').map(clipped),
      brandBar: B('.campaign-brand-bar'), brandHead: B('.campaign-brand-bar__heading'), brandItems: BA('.brand-bar__item'), brandImgs: BA('.brand-bar__item img'),
      features: B('.home-features'), card: B('.product-grid-card'), cardImg: B('.catalog-card-image'),
      footer: B('footer.app-footer'), inner: B('footer.app-footer > .mx-auto'), club: B('.footer-club'), clubCopy: B('.footer-club > div'), clubBtns: BA('.footer-club .btn'),
      cols: B('.footer-columns'), brand: B('.footer-brand'), links: B('.footer-links'), linkItems: BA('.footer-links a.inline-flex'), socials: BA('.footer-brand a'), payments: B('.footer-payments'),
      drawer: B('.campaign-cart-drawer'), dHead: B('.campaign-cart-drawer > header'), dClose: B('.campaign-cart-drawer > header button'), dLines: BA('.cart-drawer__line'), dFoot: B('.campaign-cart-drawer > footer'),
      field: B('.purchase-field input'), select: B('.purchase-field select'), summary: B('.purchase-checkout-summary'), panel: B('fieldset.purchase-panel'),
      h1: B('main h1:not(.sr-only)'), faq: BA('.faq-list details'), faqSum: BA('.faq-list summary'), editorial: B('.editorial-page'),
    },
    f: {
      sectionH2: fs('.home-section-heading h2'), featuresH2: fs('#home-features-title'), tileTitle: fs('.campaign-category__title'),
      pageH1: fs('h1.page-heading'), flowH1: fs('.purchase-flow > h1'), cartH1: fs('.purchase-heading h1'),
    },
    p: { editorial: pad('.editorial-page'), flowH1: pad('.purchase-flow > h1'), details: pad('.faq-list details'), tile: pad('.campaign-category'), club: pad('.footer-club'), cols: pad('.footer-columns'), inner: pad('footer.app-footer > .mx-auto'), dHead: pad('.campaign-cart-drawer > header'), dLine: pad('.cart-drawer__line'), brandBar: pad('.campaign-brand-bar'), heroH: getComputedStyle(document.documentElement).getPropertyValue('--hero-h').trim() },
  }
}

// ---- the brand strip before the brands API answers (added in review, 2026-11-04) ----------------------------------------
// The live brands API sends logos for some brands (api/brands.json of the capture: has_logo 1 for AHED and Vanquish) and the
// compiled bundle draws each as <img class="brand-bar__logo"> in its chip, 46px tall in the 68px chip (live rule: height:100% of
// the chip's content box, capped at 3rem). The fixtures hold those chips (make-sizes-fixtures.mjs answers r=brand_logo with an
// image; with a 404 the bundle falls back to the brand's name and the fixtures would show text only).
// But the strip is first drawn from a built-in list WITHOUT logos and replaced when the API answers, i.e. after the first paint.
// textSwap turns every logo chip back into a text chip, which is that first state: the strip must have the SAME height in both,
// or the page moves when the API answers (the first version of [sizes-home-2] shortened the chip only while no logo was present:
// 126px, then 138px, a 12px layout shift on a phone). A chip made shorter for both states would draw every logo smaller instead
// (68px chip: 46px logo; 56px chip: 34px logo, measured).
export const textSwap = () => {
  document.querySelectorAll('.brand-bar__item img').forEach((i) => {
    const s = document.createElement('span'); s.dir = 'auto'; s.textContent = i.closest('a').getAttribute('aria-label') || ''
    i.replaceWith(s)
  })
}
export const stripHeight = () => document.querySelector('.campaign-brand-bar').getBoundingClientRect().height
