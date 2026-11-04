// Page builder, local server and in-page measurements shared by sizes-admin-test.mjs (and the fixture generator).
//
// The pages are the markup of the REAL compiled /backends admin (scripts/fixtures/sizes-admin/<state>.html, captured by
// scripts/make-sizes-admin-fixtures.mjs from the captured live build, signed in on a mock API) under the REAL compiled rules
// (live.css, dumped from the build's CSSOM, light and dark), then the 14 add-on stylesheets the live index.html links, in the order
// it links them, then the stylesheet(s) the add-on scripts inject, then shell.css - the committed STAND-IN for the admin's own
// stylesheets, which the capture lacked (its header says what it is built from). Nothing is recompiled and no script runs.
import { readFileSync, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const FX = join(ROOT, 'scripts/fixtures/sizes-admin')
export const PUB = join(ROOT, 'public')
const read = (p) => readFileSync(p, 'utf8')

// name -> [sidebar label, optional first "Add ..." button to click for the editor modal]
export const STATES = [
  ['overview', 'Overview'], ['orders', 'Orders'], ['catalogue', 'Catalogue'], ['brands', 'Brands'], ['slides', 'Slides'], ['topbar', 'Topbar'],
  ['promotions', 'Promotions'], ['discounts', 'Discounts'], ['inventory', 'Inventory'], ['payments', 'Payments'], ['checkout', 'Checkout'],
  ['settings', 'Settings'], ['activity', 'Activity'],
  ['catalogue-form', 'Catalogue', /^\s*Add a product\s*$/], ['brands-form', 'Brands', /^\s*Add\b[^\n]{0,30}$/], ['discounts-form', 'Discounts', /^\s*(Add|New)\b[^\n]{0,30}$/], ['slides-form', 'Slides', /^\s*Add a slide\s*$/],
]
export const NAMES = STATES.map((s) => s[0])

// the order the live index.html links its add-on stylesheets (the bundle's own stylesheet comes first)
export const ADDON_ORDER = ['sporta-product-fix.css', 'sporta-brand-theme.css', 'sporta-home-trim.css', 'sporta-cart-drawer.css', 'sporta-grid.css', 'sporta-bag-touch.css', 'sporta-cat-tiles.css', 'sporta-admin-knet.css', 'sporta-returns-touch.css', 'sporta-clock.css', 'sporta-ui-colours.css', 'sporta-checkout-a11y.css', 'sporta-shadows.css', 'sporta-images.css']
export const KNET = 'sporta-admin-knet.css'
export const SECTION_START = '/* ==== SIZES:'

// the contexts: phones and a touch tablet use a touch screen (pointer: coarse), the rest a mouse (pointer: fine)
export const VIEWS = [
  { id: '320', w: 320, touch: true }, { id: '360', w: 360, touch: true }, { id: '390', w: 390, touch: true },
  { id: '768t', w: 768, touch: true }, { id: '768m', w: 768, touch: false }, { id: '1280', w: 1280, touch: false },
]
export const CAL_VIEW = { id: '1366', w: 1366, touch: false }   // calibration against the 2026-11-02 live rescan (measured at 1366px)

export const sectionOf = (css) => { const i = css.indexOf(SECTION_START); return i < 0 ? { before: css, section: '' } : { before: css.slice(0, i), section: css.slice(i) } }
// the numbered blocks of the section: a comment that opens "/* [sizes-admin-3] ...", up to the next marker (or the end of the file)
export const blocksOf = (section) => {
  const out = [], marks = [...section.matchAll(/\/\* \[(sizes-admin-\d+)\]/g)]
  marks.forEach((m, i) => out.push({ id: m[1], start: m.index, end: i + 1 < marks.length ? marks[i + 1].index : section.length }))
  return out
}
export const addonFiles = () => Object.fromEntries(ADDON_ORDER.map((f) => [f, read(join(PUB, f))]))

const attrs = (o) => Object.entries(o).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('')
const HEAD = read(join(FX, 'head.css')), LIVE = read(join(FX, 'live.css')), FEATURES = read(join(FX, 'features.css')), SHELL = read(join(FX, 'shell.css'))
export const fixturePage = (name, addons, { rtl = false, dark = false } = {}) => {
  const raw = read(join(FX, `${name}.html`))
  const html = JSON.parse(raw.match(/^<!-- html: (.*) -->$/m)[1]), body = JSON.parse(raw.match(/^<!-- body: (.*) -->$/m)[1])
  let markup = raw.split('\n').filter((l) => !/^<!-- (html|body): /.test(l)).join('\n')
  // The capture was made in English, so the app's own root carries dir="ltr" lang="en" (the admin sets both on <div class="admin-shell">
  // from its language switch, and the bulk photo uploader copies them onto its section). In Arabic the app sets dir="rtl" lang="ar" on the
  // same two elements, which is what flips the sidebar to the right and the page's overflow to the left. Without this the "Arabic" runs
  // would be English layouts under an Arabic <html>.
  if (rtl) markup = markup.replace('<div dir="ltr" lang="en" class="admin-shell', '<div dir="rtl" lang="ar" class="admin-shell').replace('lang="en" dir="ltr" aria-labelledby="sph-title"', 'lang="ar" dir="rtl" aria-labelledby="sph-title"')
  // language and theme are what /boot.js sets on <html> before the first paint
  html.lang = rtl ? 'ar' : 'en'; html.dir = rtl ? 'rtl' : 'ltr'
  html['data-theme'] = dark ? 'dark' : 'light'
  const cls = new Set(String(html.class || '').split(/\s+/).filter(Boolean)); cls.delete('dark'); if (dark) cls.add('dark')
  if (cls.size) html.class = [...cls].join(' '); else delete html.class
  html.style = `color-scheme: ${dark ? 'dark' : 'light'};`
  return `<!doctype html><html${attrs(html)}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="fx-head">${HEAD}</style><style id="fx-live">${LIVE}</style>${ADDON_ORDER.map((f) => `<style data-addon="${f}">${addons[f]}</style>`).join('')}<style id="fx-features">${FEATURES}</style><style id="fx-shell">${SHELL}</style></head><body${attrs(body)}>${markup}</body></html>`
}

const MIME = { css: 'text/css; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8' }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
// A tiny server: /__fx/<state>?rtl=1&dark=1 is the fixture (add-ons as given by the caller), everything else is public/ (the real
// self-hosted fonts) or a 1x1 PNG for an image that is not on disk.
export const serve = (addonsRef) => new Promise((res) => {
  const s = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x')
    const m = u.pathname.match(/^\/__fx\/([\w-]+)$/)
    if (m) { r.writeHead(200, { 'content-type': MIME.html }); return r.end(fixturePage(m[1], addonsRef.current, { rtl: u.searchParams.get('rtl') === '1', dark: u.searchParams.get('dark') === '1' })) }
    const f = PUB + decodeURIComponent(u.pathname)
    if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) { r.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'application/octet-stream' }); return r.end(readFileSync(f)) }
    r.writeHead(200, { 'content-type': 'image/png' }); r.end(PNG)
  }).listen(0, '127.0.0.1', () => res({ server: s, base: 'http://127.0.0.1:' + s.address().port }))
})

// ---- measurements (run inside the page) ----------------------------------------------------------------------
// Every list is in document order and the DOM does not change between variants, so index i is the same element before and after.
export const measure = () => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)]
  const cs = (e) => getComputedStyle(e)
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const c = cs(e); return c.visibility !== 'hidden' && c.display !== 'none' }
  const R = (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height } }
  const cls = (e) => String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).trim().replace(/\s+/g, ' ')
  const inPreview = (e) => !!e.closest('[class*="__preview"]')
  const content = $('.admin-content')
  const out = { vw: document.documentElement.clientWidth, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, rem: parseFloat(cs(document.documentElement).fontSize) }
  const text = [], taps = []
  $$('body *').forEach((e, i) => {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return
    if (!vis(e)) return
    const c = cs(e)
    if ([...e.childNodes].some((n) => n.nodeType === 3 && n.data.trim()))
      text.push({ i, tag: e.tagName.toLowerCase(), cls: cls(e), fs: parseFloat(c.fontSize), color: c.color, bg: c.backgroundColor, inTable: !!e.closest('table'), inKpi: !!e.closest('.admin-kpi__value'), inPreview: inPreview(e), t: e.textContent.trim().slice(0, 28) })
    if (e.matches('a[href], button, summary, input:not([type=hidden]):not([type=file]), select, textarea, [role="button"]') && !e.closest('[aria-hidden="true"]')) {
      const r = R(e)
      taps.push({ i, tag: e.tagName.toLowerCase(), type: e.getAttribute('type') || '', cls: cls(e), w: r.w, h: r.h, minH: parseFloat(cs(e).minHeight) || 0, inlineMin: !!e.style.minHeight, nav: !!e.closest('.admin-sidebar'), bar: !!e.closest('.m-tabbar, .m-header'), preview: inPreview(e), t: (e.getAttribute('aria-label') || e.textContent || e.placeholder || cls(e)).trim().slice(0, 24) })
    }
  })
  out.text = text; out.taps = taps
  const sb = $('.admin-sidebar'); out.sidebarW = sb && vis(sb) ? R(sb).w : null; out.sidebarLeft = sb && vis(sb) ? sb.getBoundingClientRect().left : null   // left edge: 0 in English, vw - width in Arabic (the layout really mirrors)
  const mh = $('.m-header'); out.mHeader = mh && vis(mh) ? R(mh) : null
  const tb = $('.m-tabbar'); out.tabbar = tb && vis(tb) ? R(tb) : null
  if (content) { const c = cs(content); out.content = { padT: parseFloat(c.paddingTop), padB: parseFloat(c.paddingBottom), padS: parseFloat(c.paddingInlineStart), padE: parseFloat(c.paddingInlineEnd) } }
  const h1 = $$('h1.text-2xl', content || document).find(vis); out.h1 = h1 ? { fs: parseFloat(cs(h1).fontSize), h: R(h1).h } : null
  // bordered text fields: what the add-on sizes
  out.fields = $$('input, select', content || document).filter((e) => vis(e) && !inPreview(e) && !['checkbox', 'radio', 'hidden', 'file', 'range', 'color'].includes((e.type || '').toLowerCase()) && /(^| )border( |$)|(^| )border-slate-/.test(cls(e))).map((e) => ({ i: [...document.querySelectorAll('input, select')].indexOf(e), cls: cls(e), h: R(e).h, fs: parseFloat(cs(e).fontSize), mh11: /(^| )min-h-11( |$)/.test(cls(e)) }))
  out.primaries = $$('button', content || document).filter((e) => vis(e) && !inPreview(e) && /(^| )bg-indigo-600( |$)/.test(cls(e))).map((e) => ({ cls: cls(e), h: R(e).h, mh11: /(^| )min-h-11( |$)/.test(cls(e)), t: e.textContent.trim().slice(0, 22) }))
  out.nav = $$('.admin-nav-item').filter(vis).map((e) => R(e).h)
  // tables: every body row, header cell and cell padding; the frame that scrolls
  out.rows = $$('table.admin-table > tbody > tr', content || document).filter(vis).map((e) => R(e).h)
  out.ths = $$('table.admin-table > thead th', content || document).filter(vis).map((e) => R(e).h)
  const td = $('table.admin-table > tbody > tr > td', content || document); out.td = td && vis(td) ? { padT: parseFloat(cs(td).paddingTop), padS: parseFloat(cs(td).paddingInlineStart), fs: parseFloat(cs(td).fontSize) } : null
  out.frames = $$('table.admin-table', content || document).filter(vis).map((t) => { const f = t.closest('.overflow-x-auto, .admin-table-surface') || t.parentElement; return { over: Math.round(f.scrollWidth - f.clientWidth), fw: R(f).w, tw: R(t).w } })
  // boxes by role
  const roleOf = (e) => e.matches('section.rounded-2xl.border, form.payment-gateway-editor, form.rounded-2xl.bg-white, .theme-editor__panel, .seo-editor__panel, form.admin-editor-modal') ? 'panel' : e.matches('li.admin-brand-card, section.rounded-xl.border, .admin-product-section, .payment-gateway-editor div.rounded-2xl.border, .crm-tile, .admin-kpi, .inventory-tile, .admin-notice, div.rounded-xl.border.p-3.text-sm.font-semibold') ? 'card' : e.matches('div.rounded-xl.border.border-dashed.p-10') ? 'empty' : null
  out.boxes = $$('*', content || document).filter((e) => roleOf(e) && vis(e) && !inPreview(e)).map((e) => ({ role: roleOf(e), cls: cls(e).slice(0, 60), padT: parseFloat(cs(e).paddingTop), padS: parseFloat(cs(e).paddingInlineStart), modal: e.matches('form.admin-editor-modal') }))
  out.kpi = $$('.admin-kpi__value', content || document).filter(vis).map((e) => ({ fs: parseFloat(cs(e).fontSize) }))
  // the vertical rhythm of the page column: gaps between consecutive children of .admin-page-layout
  const lay = $('.admin-page-layout', content || document)
  out.gaps = lay ? (() => { const k = [...lay.children].filter(vis), g = []; for (let i = 1; i < k.length; i++) g.push(k[i].getBoundingClientRect().top - k[i - 1].getBoundingClientRect().bottom); return g })() : []
  out.mlist = $('.m-list', content || document) && vis($('.m-list', content || document)) ? (() => { const l = $('.m-list', content || document), rows = $$('.m-row', l); return { gap: parseFloat(cs(l).rowGap) || 0, rowPadT: rows[0] ? parseFloat(cs(rows[0]).paddingTop) : 0, rowH: rows[0] ? R(rows[0]).h : 0, n: rows.length } })() : null
  // the storefront previews of the Theme / Top bar editors: their own roots' padding, font size and radius (their width follows the panel they sit in)
  out.preview = $$('[class*="__preview"]:not([class*="__preview"] *)').filter(vis).map((e) => ({ padT: parseFloat(cs(e).paddingTop), padS: parseFloat(cs(e).paddingInlineStart), fs: parseFloat(cs(e).fontSize), r: cs(e).borderTopLeftRadius }))
  return out
}
