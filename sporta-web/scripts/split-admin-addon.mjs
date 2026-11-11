#!/usr/bin/env node
// Splits the admin add-on off the shopper's path. Runs after `vite build` (the `postbuild` hook), on dist/ only.
//
//   node scripts/split-admin-addon.mjs [distDir]
//
// WHY. The live index.html links /sporta-admin-brands.js on every STOREFRONT page, and the file is admin-only code:
// every block in it starts with `if (location.pathname.indexOf('/backends') !== 0) return`, or waits for the admin
// screen to appear. It is now 557 kB raw / 159 kB gzip. Measured on the live site 2026-11-11 (phone 390px, 4x CPU,
// 1.6 Mbit/s, scripts/live-perf-probe.mjs): it is the heaviest request on every page, 2.9 to 5.4 s on the wire while the
// hero photo (the LCP element) waits behind it, and 13-22% of a page's bytes (720 of 1232 kB on the Arabic home page).
// The idea sat in PERFORMANCE.md as "lane D" since 2026-11-04 and was never built.
//
// WHAT. The real code moves, byte for byte, to /sporta-admin-brands.full.js. /sporta-admin-brands.js, the name the live
// index.html links (and that cannot change: its source is not in this repo), becomes a ~1 kB loader that adds the real
// file only when the page is /backends. A script that another script requests need not be linked by index.html, and
// the CSP is `script-src 'self'`, so a same-origin file is allowed.
//
// WHY A BUILD STEP AND NOT TWO FILES IN public/. public/sporta-admin-brands.js stays the one readable source that
// thirty-odd suites and fixtures load into a page, so none of them changes; only what ships is split. The same
// shape as csp-hashes.mjs (also a postbuild transform of dist/).
//
// EQUIVALENCE. Before: the file ran on every page and each block decided for itself. After: the loader runs the real
// file at the same moment (a page that LOADS at /backends) or when the SPA moves to /backends later (history.pushState
// / replaceState / popstate), which is what the blocks that re-check `onAdmin()` on every change already coped with.
// The same query string (`?v=1`) is passed on, so a version bump still busts both files. Both names are no-cache,
// must-revalidate in .htaccess.
//
// IDEMPOTENT and REFUSING: it will not run on a file that is already a loader, and it will not write a loader when the
// real file is missing or empty (the admin would lose all its add-ons without a word).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LOADER_MARK = 'sporta-admin-loader'
export const FULL_NAME = 'sporta-admin-brands.full.js'

// ES5 on purpose (it runs on every shopper page, on every old phone). No `$` is needed, and none is used.
export const LOADER = `/* ${LOADER_MARK}: the admin add-ons, loaded only on /backends. The code is in /${FULL_NAME}
 * (scripts/split-admin-addon.mjs makes this file at build time; the readable source is public/sporta-admin-brands.js).
 * A shopper's page never downloads the admin code. */
;(function () {
  var done = false
  var q = ''
  try { q = new URL(document.currentScript.src, location.href).search } catch (e) {}
  function load() {
    if (done || location.pathname.indexOf('/backends') !== 0) return
    done = true
    var s = document.createElement('script')
    s.src = '/${FULL_NAME}' + q
    ;(document.head || document.documentElement).appendChild(s)
  }
  load()
  if (done) return
  ;['pushState', 'replaceState'].forEach(function (k) {
    var orig = history[k]
    if (typeof orig !== 'function') return
    history[k] = function () { var r = orig.apply(this, arguments); load(); return r }
  })
  addEventListener('popstate', load)
})()
`

export function split(dist) {
  const src = join(dist, 'sporta-admin-brands.js')
  if (!existsSync(src)) throw new Error('dist/sporta-admin-brands.js is missing: run after vite build')
  const buf = readFileSync(src)
  if (buf.includes(LOADER_MARK)) return { skipped: 'already a loader', loader: buf.length }
  if (buf.length < 20000 || !buf.includes("location.pathname.indexOf('/backends')")) {
    throw new Error('dist/sporta-admin-brands.js does not look like the admin add-on (size ' + buf.length + '): refusing to replace it with a loader')
  }
  writeFileSync(join(dist, FULL_NAME), buf)
  writeFileSync(src, LOADER)
  return { full: buf.length, loader: Buffer.byteLength(LOADER) }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const r = split(process.argv[2] ?? join(root, 'dist'))
  console.log(r.skipped
    ? `admin split: ${r.skipped}`
    : `admin split: sporta-admin-brands.js -> ${r.loader} B loader, real code ${r.full} B in ${FULL_NAME}`)
}
