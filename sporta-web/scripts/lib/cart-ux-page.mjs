// Fixture pages for scripts/cart-ux-test.mjs: the bag page and the bag drawer as the LIVE compiled build renders them
// (scripts/fixtures/sizes-screen/{cart,drawer}-{ar,en}.html, captured by scripts/make-sizes-fixtures.mjs), under the live
// compiled rules (live.css, dumped from the build's CSSOM), then the 14 add-on stylesheets the live index.html links, in
// its order. No script of the bundle runs; the add-on script is added by the caller when a section needs it.
//
// The two files of this lane carry a section each, placed before the section another lane keeps LAST in the same file:
//   public/sporta-cart-drawer.css   "UX: BAG DRAWER"  ... up to "SIZES:" (lane B)
//   public/sporta-bag-touch.css     "UX: BAG PAGE"    ... up to "HEADER AND MENU LAYOUT" (menu lane)
// uxOf() cuts a file into before / ux / after, blocksOf() cuts the section into its numbered blocks, so the suite can
// remove the whole section or one block and require its checks to fail (the mutation check).
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PUB = join(WEB, 'public')
export const FX = join(WEB, 'scripts/fixtures/sizes-screen')
const read = (p) => readFileSync(p, 'utf8')

export const ADDON_ORDER = ['sporta-product-fix.css', 'sporta-brand-theme.css', 'sporta-home-trim.css', 'sporta-cart-drawer.css', 'sporta-grid.css', 'sporta-bag-touch.css', 'sporta-cat-tiles.css', 'sporta-admin-knet.css', 'sporta-returns-touch.css', 'sporta-clock.css', 'sporta-ui-colours.css', 'sporta-checkout-a11y.css', 'sporta-shadows.css', 'sporta-images.css']
export const MY_FILES = {
  'sporta-cart-drawer.css': { start: '/* ==== UX: BAG DRAWER', next: '/* ==== SIZES:', prefix: 'ux-drawer' },
  'sporta-bag-touch.css': { start: '/* ==== UX: BAG PAGE', next: '/* ==== HEADER AND MENU LAYOUT', prefix: 'ux-cart' },
}
export const addonFiles = () => Object.fromEntries(ADDON_ORDER.map((f) => [f, read(join(PUB, f))]))

// css -> { before, ux, after } (ux is '' when the section is missing)
export const uxOf = (file, css) => {
  const { start, next } = MY_FILES[file]
  const a = css.indexOf(start)
  if (a < 0) return { before: css, ux: '', after: '' }
  const b = css.indexOf(next, a)
  return { before: css.slice(0, a), ux: css.slice(a, b < 0 ? css.length : b), after: b < 0 ? '' : css.slice(b) }
}
// the section's blocks: the preamble (copy variables, up to the first marker) and every "/* [ux-xxx-N] */"
export const blocksOf = (file, ux) => {
  const re = new RegExp(`/\\* \\[(${MY_FILES[file].prefix}-\\d)\\]`, 'g')
  const marks = [...ux.matchAll(re)]
  const out = []
  if (marks.length) out.push({ id: 'preamble', start: ux.indexOf('*/') + 2, end: marks[0].index })
  marks.forEach((m, i) => out.push({ id: m[1], start: m.index, end: i + 1 < marks.length ? marks[i + 1].index : ux.length }))
  return out
}
export const without = (file, css, ids) => {
  const { before, ux, after } = uxOf(file, css)
  const cut = blocksOf(file, ux).filter((b) => ids === 'all' || ids.includes(b.id)).sort((p, q) => q.start - p.start)
  let u = ids === 'all' ? '' : ux
  if (ids !== 'all') for (const b of cut) u = u.slice(0, b.start) + u.slice(b.end)
  return before + u + after
}

const attrs = (o) => Object.entries(o).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('')
const HEAD = read(join(FX, 'head.css')), LIVE = read(join(FX, 'live.css')), FEATURES = read(join(FX, 'features.css'))
export const fixturePage = (name, lang, addons, script = '') => {
  const raw = read(join(FX, `${name}-${lang}.html`))
  const html = JSON.parse(raw.match(/^<!-- html: (.*) -->$/m)[1]), body = JSON.parse(raw.match(/^<!-- body: (.*) -->$/m)[1])
  const markup = raw.split('\n').filter((l) => !/^<!-- (html|body): /.test(l)).join('\n')
  return `<!doctype html><html${attrs(html)}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="fx-head">${HEAD}</style><style id="fx-live">${LIVE}</style>${ADDON_ORDER.map((f) => `<style data-addon="${f}">${addons[f]}</style>`).join('')}<style id="fx-features">${FEATURES}</style></head><body${attrs(body)}>${markup}${script ? `<script>${script}</script>` : ''}</body></html>`
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const MIME = { css: 'text/css; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8' }
// /__fx/<page>-<lang> is the fixture with the add-ons (and the optional script) the caller put in ref.current / ref.script;
// anything else is public/ (the real self-hosted fonts and photos) or a 1x1 PNG for an image that is not on disk.
export const serveFx = (ref) => new Promise((res) => {
  const s = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x')
    const m = u.pathname.match(/^\/__fx\/(\w+)-(ar|en)$/)
    if (m) { r.writeHead(200, { 'content-type': MIME.html }); return r.end(fixturePage(m[1], m[2], ref.current, u.searchParams.get('js') ? ref.script || '' : '')) }
    const f = PUB + decodeURIComponent(u.pathname)
    if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) { r.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'application/octet-stream' }); return r.end(readFileSync(f)) }
    r.writeHead(200, { 'content-type': 'image/png' }); r.end(PNG)
  }).listen(0, '127.0.0.1', () => res({ server: s, base: 'http://127.0.0.1:' + s.address().port }))
})
