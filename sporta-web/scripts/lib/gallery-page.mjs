// Page builder for the product gallery / photo viewer suites (scripts/images-viewer-test.mjs).
//
// The page is the captured LIVE product page of scripts/fixtures/sizes-product (live compiled rules + every add-on
// stylesheet the live index.html links, in its order; see sizes-product-page.mjs), with the static gallery markup the
// capture holds replaced by the LIVE gallery itself: scripts/fixtures/gallery/live-gallery.mjs is a verbatim excerpt of the
// compiled build (stage, arrows, dots, thumbnails and the full-screen lightbox), bundled here with React 19 (what the
// live build runs) so it behaves exactly as live: swipe, hover lens, keys, the lightbox's focus trap and scroll lock.
// The live rules the capture did not need (the arrows, dots and thumbnails of a several-photo gallery, the open
// lightbox) are scripts/fixtures/gallery/live-extra.css, dumped from the same live stylesheet by
// scripts/make-gallery-fixtures.mjs.
import { readFileSync, existsSync, statSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'
import { rolldown } from 'rolldown'
import * as PRD from './sizes-product-page.mjs'

export const ROOT = PRD.ROOT
export const GX = join(ROOT, 'scripts/fixtures/gallery')
const EXTRA_FILE = join(GX, 'live-extra.css')
export const extraCss = () => (existsSync(EXTRA_FILE) ? readFileSync(EXTRA_FILE, 'utf8') : '')

let HARNESS = null
export async function harness() {
  if (HARNESS) return HARNESS
  const b = await rolldown({ input: join(GX, 'harness-entry.mjs'), logLevel: 'silent', platform: 'browser', transform: { define: { 'process.env.NODE_ENV': '"production"' } } })
  const { output } = await b.generate({ format: 'iife' })
  await b.close()
  HARNESS = output[0].code
  return HARNESS
}

// the photos each scenario shows (the live build's own files for those products: denver-nuggets-cap-navy has four)
export const SETS = {
  multi: { fx: 'full', images: ['denver-nuggets-cap-navy.jpg', 'denver-nuggets-cap-navy-view-2.jpg', 'denver-nuggets-cap-navy-view-3.jpg', 'denver-nuggets-cap-navy-view-4.jpg'].map((f) => '/images/products/' + f) },
  single: { fx: 'full', images: ['/images/products/sgomma-t-shirt-navy.jpg'] },
  plate: { fx: 'one', images: ['/product-photo-unavailable.svg'] },
  broken: { fx: 'full', images: ['/images/products/define-jacket-iris-purple.png'] },   // answered 404 by the suite: the build swaps in the plate
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const MIME = { css: 'text/css; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', html: 'text/html; charset=utf-8', js: 'text/javascript' }
// /__gx/<fixture>-<lang>-<width>[-dark] = the captured page; ref.current = { addons, extra, scripts: [js strings] }
export const serve = (ref) => new Promise((res) => {
  const s = http.createServer(async (q, r) => {
    const u = new URL(q.url, 'http://x')
    const m = u.pathname.match(/^\/__gx\/([\w-]+?)-(ar|en)-(\d+)(-dark)?$/)
    if (m) {
      const cur = ref.current
      let html = PRD.fixturePage(m[1], m[2], +m[3], cur.addons, !!m[4])
      html = html.replace('<style id="fx-features">', `<style id="fx-gallery-live">${cur.extra}</style><style id="fx-features">`)
      html = html.replace('</body>', `<script>${(await harness()).replace(/<\/script/gi, '<\\/script')}</script></body>`)
      r.writeHead(200, { 'content-type': MIME.html }); return r.end(html)
    }
    const f = PRD.PUB + decodeURIComponent(u.pathname)
    if (u.pathname !== '/' && existsSync(f) && statSync(f).isFile()) { r.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'application/octet-stream' }); return r.end(readFileSync(f)) }
    r.writeHead(200, { 'content-type': 'image/png' }); r.end(PNG)
  }).listen(0, '127.0.0.1', () => res({ server: s, base: 'http://127.0.0.1:' + s.address().port }))
})
