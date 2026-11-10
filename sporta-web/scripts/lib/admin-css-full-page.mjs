// Pages for scripts/admin-css-full-test.mjs: the fixtures of scripts/fixtures/sizes-admin (13 screens, 4 editor modals) and of
// scripts/fixtures/admin-css-full (the Orders sheet, Returns, CRM, Support, Profiles, Theme, SEO), built exactly as
// lib/sizes-admin-page.mjs builds them (the markup of the real compiled admin, the real compiled rules, the 14 add-on
// stylesheets in the order the live index.html links them, the injected feature styles, the stand-in for the admin's own
// sheets), with ONE addition for a dark page: scripts/fixtures/admin-dark-rules.css - every dark rule of the live build,
// verbatim - appended LAST, where the live page appends the admin chunk's stylesheet. Without it a "dark" fixture has the
// dark rules of the storefront sheet only and says nothing about the admin's dark theme.
import { readFileSync, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'
import { ROOT, PUB, ADDON_ORDER, KNET, NAMES as SIZES_NAMES } from './sizes-admin-page.mjs'

export { KNET }
const read = (p) => readFileSync(p, 'utf8')
const FX = { sizes: join(ROOT, 'scripts/fixtures/sizes-admin'), full: join(ROOT, 'scripts/fixtures/admin-css-full') }
export const FULL_NAMES = ['orders-sheet', 'returns', 'crm', 'support', 'profiles', 'theme', 'seo']
// the states whose LAYOUT is the live layout (Tailwind utilities, which are the live rules) ...
export const MEASURED = [...SIZES_NAMES, 'orders-sheet']
// ... and the ones whose own stylesheet no capture holds: used for "the selector matches real markup" and forced colours only
export const MARKUP_ONLY = FULL_NAMES.filter((n) => n !== 'orders-sheet')
export const ALL = [...SIZES_NAMES, ...FULL_NAMES]
const dirOf = (name) => (FULL_NAMES.includes(name) ? FX.full : FX.sizes)
const HEAD = read(join(FX.sizes, 'head.css')), FEATURES = read(join(FX.sizes, 'features.css')), SHELL = read(join(FX.sizes, 'shell.css'))
const LIVE = { [FX.sizes]: read(join(FX.sizes, 'live.css')), [FX.full]: read(join(FX.full, 'live.css')) }
export const DARK_RULES = read(join(ROOT, 'scripts/fixtures/admin-dark-rules.css'))
export const knetSource = () => read(join(ROOT, 'addons-src', KNET))
export const knetServed = () => read(join(PUB, KNET))
export const addons = (knet) => Object.fromEntries(ADDON_ORDER.map((f) => [f, f === KNET ? knet : read(join(PUB, f))]))

const attrs = (o) => Object.entries(o).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('')
export const page = (name, files, { rtl = false, dark = false } = {}) => {
  const dir = dirOf(name), raw = read(join(dir, `${name}.html`))
  const html = JSON.parse(raw.match(/^<!-- html: (.*) -->$/m)[1]), body = JSON.parse(raw.match(/^<!-- body: (.*) -->$/m)[1])
  let markup = raw.split('\n').filter((l) => !/^<!-- (html|body): /.test(l)).join('\n')
  // Arabic: the app sets dir="rtl" lang="ar" on its own root (see lib/sizes-admin-page.mjs); the captured copy is English
  if (rtl) markup = markup.replace('<div dir="ltr" lang="en" class="admin-shell', '<div dir="rtl" lang="ar" class="admin-shell')
  html.lang = rtl ? 'ar' : 'en'; html.dir = rtl ? 'rtl' : 'ltr'; html['data-theme'] = dark ? 'dark' : 'light'
  const cls = new Set(String(html.class || '').split(/\s+/).filter(Boolean)); cls.delete('dark'); if (dark) cls.add('dark')
  if (cls.size) html.class = [...cls].join(' '); else delete html.class
  html.style = `color-scheme: ${dark ? 'dark' : 'light'};`
  return `<!doctype html><html${attrs(html)}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="fx-head">${HEAD}</style><style id="fx-live">${LIVE[dir]}</style>${ADDON_ORDER.map((f) => `<style data-addon="${f}">${files[f]}</style>`).join('')}<style id="fx-features">${FEATURES}</style><style id="fx-shell">${SHELL}</style>${dark ? `<style id="fx-dark">${DARK_RULES}</style>` : ''}</head><body${attrs(body)}>${markup}</body></html>`
}
const MIME = { css: 'text/css; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg' }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
// /__fx/<state>?rtl=1&dark=1 is the fixture with the add-ons in ref.current; anything else is public/ (the real fonts) or a 1x1 PNG
export const serve = (ref) => new Promise((res) => {
  const s = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x'), m = u.pathname.match(/^\/__fx\/([\w-]+)$/)
    if (m) { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return r.end(page(m[1], ref.current, { rtl: u.searchParams.get('rtl') === '1', dark: u.searchParams.get('dark') === '1' })) }
    const f = PUB + decodeURIComponent(u.pathname)
    if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) { r.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'application/octet-stream' }); return r.end(readFileSync(f)) }
    r.writeHead(200, { 'content-type': 'image/png' }); r.end(PNG)
  }).listen(0, '127.0.0.1', () => res({ server: s, base: 'http://127.0.0.1:' + s.address().port }))
})
