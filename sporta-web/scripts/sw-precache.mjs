// Injects the built asset filenames into dist/sw.js, after the build.
//
//   node scripts/sw-precache.mjs [distDir]
//
// WHY THIS STEP EXISTS
// Every route in this app is a lazy import, so its JavaScript is a separate
// content-hashed chunk. sw.js cannot name them — the hash changes on every
// build — so a hand-written precache list can only ever hold the shell. Measured
// with the network off: navigating to /shop returned 200 from the cached shell
// and rendered NOTHING, because Shop-Hh5cwt8S.js had never been fetched and so
// was never cached. Offline worked only for pages already visited, which is the
// least useful half of offline.
//
// WHAT IS AND IS NOT PRECACHED
// The storefront: the entry, the React vendor chunk, the stylesheet, every route
// chunk, and the two default-language fonts. Around 450 kB, which is a fair
// trade for an install that then opens instantly and works in a lift.
//
// Deliberately left out, and this is the point of doing it in a script rather
// than a glob:
//   * AdminApp — 62 kB the shop's customers will never open.
//     (A hosted-backend client used to be skipped here too, at 200 kB. The
//     backend is /api on this same origin now, so there is no such chunk.)
//   * The Arabic font subsets, unless the visitor reads Arabic — the browser
//     fetches those on demand and the service worker caches them then.
//   * Category art and product images: cached on first sight, not up front. The
//     mobile set alone is 130 kB and the shopper may never scroll to it.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const web = resolve(new URL('..', import.meta.url).pathname)
const DIST = process.argv[2] ?? join(web, 'dist')
const SW = join(DIST, 'sw.js')

if (!existsSync(SW)) {
  console.error(`no ${SW} — run the build first`)
  process.exit(2)
}

// Chunks whose weight is not worth an install. Matched on the readable part of
// the name, before the hash.
const SKIP = /^AdminApp-/

const assets = readdirSync(join(DIST, 'assets'))
  .filter((f) => /\.(js|css)$/.test(f))
  .filter((f) => !SKIP.test(f))
  .map((f) => `/assets/${f}`)
  .sort()

const fonts = ['/fonts/alexandria-var-latin.woff2', '/fonts/plex-400-latin.woff2'].filter((f) =>
  existsSync(join(DIST, f)),
)

const shell = ['/', '/index.html', '/logo-white.webp', '/favicon-32.png', '/site.webmanifest']
const list = [...shell, ...fonts, ...assets]

let sw = readFileSync(SW, 'utf8')
const marker = /const PRECACHE = \[[^\]]*\]/
if (!marker.test(sw)) {
  console.error('sw.js has no PRECACHE array to fill — did its shape change?')
  process.exit(1)
}
sw = sw.replace(
  marker,
  `const PRECACHE = [\n  ${list.map((u) => JSON.stringify(u)).join(',\n  ')},\n]`,
)

// The cache name must change whenever the precache list does, or an updated
// worker keeps serving the previous build's chunks from a cache it considers
// current. A hash of the list is exactly the right version: it changes when, and
// only when, the contents change.
const stamp = [...list.join('|')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36)
sw = sw.replace(/const VERSION = '[^']*'/, `const VERSION = 'v1-${stamp}'`)

writeFileSync(SW, sw)
const bytes = list.reduce((n, u) => {
  const p = join(DIST, u === '/' ? 'index.html' : u)
  try { return n + readFileSync(p).length } catch { return n }
}, 0)
console.log(`sw.js precache: ${list.length} entries, ~${Math.round(bytes / 1024)} kB, version v1-${stamp}`)
