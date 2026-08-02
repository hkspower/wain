// Sporta service worker — offline support, written by hand.
//
// No Workbox: the whole caching policy is twelve lines of fetch handler, and a
// generated one would be another dependency to audit for a site whose entire
// security posture is "nothing runs on the server that does not have to".
//
// ============================ WHAT IS CACHED, AND WHY ======================
// Three rules, in this order:
//
//   1. NEVER TOUCHED. Anything under /knet/ or /pay/, and config.js.
//      A payment response carries order state and is marked no-store for that
//      reason; a service worker that cached one could show a stale "payment
//      successful" for an order that failed. config.js holds the live backend
//      settings and is edited in place on the server — caching it would make an
//      edit look like it did nothing, which is exactly the bug the .htaccess
//      no-cache rule exists to prevent. Both are passed straight to the network,
//      and if the network is down they fail, which is the correct answer.
//
//   2. CACHE FIRST AND NEVER RE-ASKED, for /assets/ and /fonts/ — content-hashed
//      or effectively frozen, so the filename changes when the bytes do and a
//      cached copy can never be stale.
//
//   2b. CACHE FIRST, THEN QUIETLY REFRESHED, for images with FIXED names —
//      /hero/, /cats/, the logo, the icons. These were in rule 2, and that was
//      wrong in a way nothing surfaced: a hero photograph replaced by the owner
//      kept its filename, so the cached copy was served for ever. The cache
//      version only changes when the PRECACHE list changes, and that list is
//      the JS chunks, two fonts and the shell — no images. Replacing a picture
//      therefore did not rotate the cache, the HTTP layer had it at thirty days
//      as well, and the new picture reached returning visitors on neither path.
//      Now the cached copy is still served instantly, and a background fetch
//      updates it for next time.
//
//   3. NETWORK FIRST, falling back to cache, for everything else — the HTML
//      shell above all. A deploy must be picked up on the next visit, so the
//      network always gets asked first; the cached shell is what makes the site
//      open at all on a train or in a lift.
//
// POST is never cached, and neither is any cross-origin request: API reads
// go to the network every time, because a cached stock figure or order status
// would be worse than none.
//
// ============================== ON A NEW DEPLOY =============================
// The cache name carries a version. Activating a new worker deletes every cache
// that is not the current one, so a deploy cannot leave a visitor pinned to old
// assets — and skipWaiting + clients.claim mean it happens on the first load
// after the deploy rather than after every tab has been closed.
const VERSION = 'v1'
const SHELL = `sporta-shell-${VERSION}`
const ASSETS = `sporta-assets-${VERSION}`

// The offline shell. index.html is the whole app — every route renders from it —
// so one entry covers the site. The rest are what the shell needs to look like
// itself rather than unstyled text.
const PRECACHE = ['/', '/index.html', '/logo-white.webp', '/favicon-32.png', '/site.webmanifest']

const NEVER = (url) =>
  url.pathname.startsWith('/knet/') ||
  url.pathname.startsWith('/pay/') ||
  url.pathname === '/config.js'

// Content-hashed, or frozen in practice. A hit is correct by construction.
const IMMUTABLE = (url) =>
  url.pathname.startsWith('/assets/') ||
  url.pathname.startsWith('/fonts/') ||
  /\.woff2?$/.test(url.pathname)

// Fixed names whose BYTES change — every picture the owner can replace.
const REFRESHABLE = (url) => /\.(png|jpe?g|webp|avif|svg|ico)$/.test(url.pathname)

self.addEventListener('install', (e) => {
  e.waitUntil(
    // addAll rejects the whole batch if ONE entry 404s, which would leave the
    // worker uninstalled and offline support silently absent. Added one at a
    // time so a renamed icon costs that icon and nothing else.
    caches.open(SHELL).then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})))),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== location.origin) return // the bank: always live
  if (NEVER(url)) return

  // Stale-while-revalidate, by hand. The visitor waits for nothing — the
  // cached picture is returned immediately — and the network copy replaces it
  // in the cache for the next load. waitUntil keeps the worker alive for that
  // fetch; without it the browser is free to kill it the moment the response
  // is handed over, and the refresh would never land.
  if (REFRESHABLE(url) && !IMMUTABLE(url)) {
    e.respondWith(
      caches.match(request, { ignoreVary: true }).then((hit) => {
        const fresh = fetch(request)
          .then((res) => {
            if (res.ok) caches.open(ASSETS).then((c) => c.put(request, res.clone()))
            return res
          })
          .catch(() => hit ?? Response.error())
        if (hit) e.waitUntil(fresh)
        return hit ?? fresh
      }),
    )
    return
  }

  if (IMMUTABLE(url)) {
    e.respondWith(
      // ignoreVary, and it is not optional. The server sends
      // "Vary: Accept-Encoding" on every compressible response, and
      // caches.match honours Vary — so an entry stored by cache.add() (which
      // sends its own Accept-Encoding) never matched the browser's real request
      // for the same URL. Measured: 29 entries precached, the Shop chunk among
      // them, and an offline /shop still rendered a blank page with
      // ERR_FAILED for every asset. Keying on the URL is what is wanted here:
      // the bytes are the same file whichever encoding was negotiated.
      caches.match(request, { ignoreVary: true }).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res.ok) caches.open(ASSETS).then((c) => c.put(request, res.clone()))
            return res
          }),
      ),
    )
    return
  }

  // Network first, cache as a fallback. `navigate` requests fall back to the
  // shell rather than to nothing, so a deep link opened offline still renders
  // the app, which then shows its own offline state.
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(request, res.clone()))
        return res
      })
      .catch(async () => {
        const hit = await caches.match(request, { ignoreVary: true })
        if (hit) return hit
        if (request.mode === 'navigate') {
          const shell = await caches.match('/index.html', { ignoreVary: true })
          if (shell) return shell
        }
        return new Response('', { status: 504, statusText: 'Offline' })
      }),
  )
})
