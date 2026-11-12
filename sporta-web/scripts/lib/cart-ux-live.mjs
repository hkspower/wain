// Static server for the CAPTURED live storefront (the real compiled client, minified React, with the live /api JSON), used by
// scripts/cart-ux-test.mjs to prove the bag page and the bag drawer on the REAL app, not only on markup fixtures.
//
// What it serves, in this order, for a path:
//   1. an add-on file the caller passed in `css` / `js` (a string, or null to serve an empty file): this is how the suite runs
//      the page WITH an add-on, WITHOUT it (empty), and with one mutated block
//   2. an add-on file of this repo (public/<name>), for the 14 stylesheets and the 6 scripts the live index.html links
//   3. the capture (index.html, assets/*.js and *.css, config.js, boot.js, /api JSON), then public/ for fonts, logos and photos
//   4. the capture's index.html for any other route without a file extension (the SPA fallback), like the real host
// /api/api.php?r=<route> answers from <capture>/api/<route>.json (404 when the capture has none). A POST goes to `onPost`
// (the suite records the body and answers); with no handler it is aborted with 404 so nothing can reach a real server.
//
// The capture is NOT in the repo (it is a copy of what the live server answered, taken 2026-11-03). Its place:
//   SPORTA_LIVE_CAPTURE=<dir>   (default: the session scratchpad's scan-words/live)
// liveDir() returns null when it is absent; the suite then says so and skips the real-app sections (the fixture sections run
// anyway), instead of failing for a file that only exists on the machine that took the capture.
import { readFileSync, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PUB = join(WEB, 'public')
const DEFAULT_CAPTURE = '/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/scan-words/live'

export const ADDON_CSS = ['sporta-product-fix.css', 'sporta-brand-theme.css', 'sporta-home-trim.css', 'sporta-cart-drawer.css', 'sporta-grid.css', 'sporta-bag-touch.css', 'sporta-cat-tiles.css', 'sporta-admin-knet.css', 'sporta-returns-touch.css', 'sporta-clock.css', 'sporta-ui-colours.css', 'sporta-checkout-a11y.css', 'sporta-shadows.css', 'sporta-images.css']
export const ADDON_JS = ['boot.js', 'config.js', 'birthday.js', 'sporta-features.js', 'sporta-admin-brands.js', 'sporta-footer-call.js', 'sporta-gov-autopick.js', 'sporta-clock.js', 'sporta-checkout-a11y.js']

export const liveDir = () => {
  const d = process.env.SPORTA_LIVE_CAPTURE || DEFAULT_CAPTURE
  return existsSync(join(d, 'index.html')) && existsSync(join(d, 'assets')) ? d : null
}

const MIME = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', woff2: 'font/woff2', woff: 'font/woff', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', ico: 'image/x-icon', webmanifest: 'application/manifest+json', txt: 'text/plain', html: 'text/html; charset=utf-8' }
const isFile = (f) => existsSync(f) && statSync(f).isFile()

// `api` answers a GET route the capture has no file for ({ invoice: {...} } -> /api/api.php?r=invoice&id=...); a suite's own
// made-up data, never a real order.
export const serveLive = ({ css = {}, js = {}, onPost = null, headers = {}, api = {} } = {}) => new Promise((resolve, reject) => {
  const L = liveDir()
  if (!L) return reject(new Error('no live capture (set SPORTA_LIVE_CAPTURE)'))
  const send = (r, status, type, body) => { r.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers }); r.end(body) }
  const server = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x')
    const name = decodeURIComponent(u.pathname).replace(/^\//, '')
    if (q.method === 'POST') {
      if (onPost) return onPost(q, r, u)
      return send(r, 404, 'application/json', '{"error":"not_found"}')
    }
    if (u.pathname === '/api/api.php') {
      const route = u.searchParams.get('r')
      const f = join(L, 'api', `${route}.json`)
      if (route in api) return send(r, 200, 'application/json', JSON.stringify(api[route]))
      if (route === 'slide_image') return send(r, 200, 'image/png', readFileSync(join(PUB, 'og-image.png')))
      if (/^\w+$/.test(route || '') && isFile(f)) return send(r, 200, 'application/json', readFileSync(f))
      return send(r, 404, 'application/json', '{"error":"not_found"}')
    }
    if (name in css) return send(r, 200, MIME.css, css[name] ?? '')
    if (name in js) return send(r, 200, MIME.js, js[name] ?? '')
    if (ADDON_CSS.includes(name) || ADDON_JS.includes(name)) {
      const f = isFile(join(PUB, name)) ? join(PUB, name) : join(L, name)
      if (isFile(f)) return send(r, 200, MIME[name.split('.').pop()], readFileSync(f))
    }
    for (const root of [L, PUB]) {
      const f = join(root, name)
      if (name && !name.includes('..') && isFile(f)) return send(r, 200, MIME[f.split('.').pop()] || 'application/octet-stream', readFileSync(f))
    }
    if (/\.\w+$/.test(u.pathname)) return send(r, 404, 'text/plain', 'nf')
    send(r, 200, MIME.html, readFileSync(join(L, 'index.html')))
  }).listen(0, '127.0.0.1', () => resolve({ server, base: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((ok) => server.close(ok)) }))
})

// A bag line exactly as the compiled app stores it in localStorage "sporta_cart" (read from the bundle's cart provider:
// { key: `${slug}__${size}__${fit}`, slug, size, fit, name: {en, ar}, price, image, qty }).
export const line = (slug, size, en, ar, price, qty, fit = null) => ({ key: `${slug}__${size ?? '-'}__${fit ?? '-'}`, slug, size, fit, name: { en, ar }, price, image: '/product-photo-unavailable.svg', qty })

// Real products of the capture (api/products.json, api/stock.json): the stock of each size decides the "+" button.
export const BAG = [
  line('cloudsoft-jacket-coffee-brown', 'M', 'Cloudsoft Jacket — Coffee Brown', 'جاكيت كلاودسوفت — بني قهوة', 10, 2),   // stock 2: at the maximum
  line('sgomma-t-shirt-navy', 'XL', 'Sgomma T-Shirt — Navy', 'تيشيرت سغوما — كحلي', 5, 1),                              // stock 10
  line('cloudsoft-leggings-army-green', 'L', 'Cloudsoft Leggings — Army Green', 'ليقنز كلاودسوفت — أخضر عسكري', 8, 1),   // stock 1: at the maximum
]
