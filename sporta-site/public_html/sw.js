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
//   2. CACHE FIRST AND NEVER RE-ASKED, for HASHED files in /assets/ and for
//      /fonts/ — the filename changes when the bytes do, so a cached copy can
//      never be stale.
//
//      THE HASH IS THE WHOLE JUSTIFICATION, and this rule used to be written as
//      "anything under /assets/", which is not the same set. Seven files live
//      there with FIXED names: sporta-ui.css, sporta-dark.css, contact.js,
//      card.js, returns-link.js, returns-request.js and track-guard.js. Their
//      names never change, so "a hit is correct by construction" was false for
//      every one of them, and cache-first-never-re-asked meant a returning
//      visitor was pinned to whatever copy they first cached — for ever. The
//      cache only rotates when VERSION changes, and VERSION had not changed
//      since those files were written.
//
//      That is exactly the fault 2b already records for images, one directory
//      up and unnoticed: a file whose bytes change under a fixed name cannot be
//      cached by name. The site's own .htaccess names all seven and marks them
//      `no-cache, must-revalidate` — the HTTP layer was saying "always ask" and
//      the worker was never asking, and the worker wins, because it does not
//      make the request at all.
//
//      So the test is now the hash itself, not the folder. Un-hashed files fall
//      through to rule 3, network-first, which is what their header asked for.
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
// BUMPED WITH THE RULE ABOVE, and it has to be. Fixing IMMUTABLE stops the
// worker pinning those seven files from now on, but every visitor already
// carrying a stale sporta-ui.css has it in a cache this worker would happily
// keep using. Activating a new version deletes every cache that is not the
// current one, so the bump is what actually frees them — the fix alone would
// leave the people it was written for exactly where they were.
const VERSION = 'v7-brand1'
const SHELL = `sporta-shell-${VERSION}`
const ASSETS = `sporta-assets-${VERSION}`

// The offline shell. index.html is the whole app — every route renders from it —
// so one entry covers the site. The rest are what the shell needs to look like
// itself rather than unstyled text.
const PRECACHE = [
  "/",
  "/index.html",
  "/logo-white.webp",
  "/favicon-32.png",
  "/site.webmanifest",
  "/fonts/alexandria-var-latin.woff2",
  "/fonts/alexandria-var-arabic.woff2",
  "/assets/About-7p00QsGK.js",
  "/assets/AssistantPanel-Dx280GRS.js",
  "/assets/Cart-B71Jo6gk.js",
  "/assets/Checkout-Dk5_ETdy.js",
  "/assets/CheckoutSteps-BfD7s0hA.js",
  "/assets/Contact-HoZaOGvS.js",
  "/assets/Invoice-BRGavJXu.js",
  "/assets/LegalPage-AcD8bbsz.js",
  "/assets/NotFound-DEvLDlGt.js",
  "/assets/OptionBox-QdtaBX6i.js",
  "/assets/PaymentResult-EPQCKPl1.js",
  "/assets/Privacy-DHSjoBJx.js",
  "/assets/ProductDetail-uh71XAH8.js",
  "/assets/Returns-BlLemmCZ.js",
  "/assets/Review-DZ-PH_xP.js",
  "/assets/Shop-BYKJiDn8.js",
  "/assets/Terms-Be905VBP.js",
  "/assets/TrackOrder-Ceilajwu.js",
  "/assets/Wishlist-L8me8CrG.js",
  "/assets/bidi-aEAFfM9w.js",
  "/assets/checkout-CJW4l7Oz.js",
  "/assets/index-5HbquisI.js",
  "/assets/index-TIUCmnwm.css",
  "/assets/react-vendor-CMgvnOJB.js",
  "/assets/rolldown-runtime-QTnfLwEv.js",
]

// Never touched — passed straight to the network, never stored, never served
// from a cache. Three of these are the money path and the runtime config; the
// fourth is the API, and it is the one that was missing.
//
// /api answers with `Cache-Control: no-store` and means it: it carries the
// admin's session state (`?r=me`), the orders list, customer addresses and
// every figure on the dashboard. CacheStorage does NOT honour Cache-Control —
// a cache.put() stores a no-store response as happily as any other — so the
// header alone was never the guard it reads like. Without this line the
// network-first branch below was free to write an admin JSON response into the
// shell cache, where it would outlive the session that produced it: a signed
// -out `?r=me` replayed over a valid session bounces the owner back to the
// password box, and a cached `?r=orders` leaves customer data in the browser
// after sign-out.
//
// The cost is that /api has no offline fallback, which is correct — a stale
// order list is worse than no order list, and the admin says so itself.
const NEVER = (url) =>
  url.pathname.startsWith('/api/') ||
  url.pathname.startsWith('/knet/') ||
  url.pathname.startsWith('/pay/') ||
  url.pathname === '/config.js'

// The build's content hash: `-` then at least eight of the base64url alphabet,
// immediately before .js or .css — Shop-BYKJiDn8.js, index-TIUCmnwm.css. The
// hand-written overlays in the same folder have no such suffix, which is the
// only thing that separates them and the only thing that may be tested for.
const HASHED = /-[A-Za-z0-9_-]{8,}\.(js|css)$/

// Content-hashed, or frozen in practice. A hit is correct by construction —
// and now that is true of the set rather than asserted about it.
const IMMUTABLE = (url) =>
  (url.pathname.startsWith('/assets/') && HASHED.test(url.pathname)) ||
  url.pathname.startsWith('/fonts/') ||
  /\.woff2?$/.test(url.pathname)

// Fixed names whose BYTES change — every picture the owner can replace.
const REFRESHABLE = (url) => /\.(png|jpe?g|webp|avif|svg|ico)$/.test(url.pathname)

// A 200 is NOT proof the body is what was asked for, and caching on res.ok
// alone is how a site breaks in a way a refresh cannot fix.
//
// Observed on this site: Hostinger's CDN bot-check answered a request for
// /assets/index-*.js with its "Checking your browser" HTML — and served it as
// HTTP 200, with content-type: application/x-javascript and the real file's
// cache-control: max-age=31536000, immutable. Every guard downstream believed
// it. A browser that hits that once stores an HTML page under the bundle's URL
// for a year; the app then dies on `Unexpected token '<'` on every subsequent
// load, hard refresh included, because immutable means the browser will not
// even revalidate.
//
// So: refuse to cache an HTML body under a URL that is not asking for HTML.
// That is the shape of a challenge page, a login interstitial and a captive
// portal alike, and none of them should ever be persisted as a script.
const CACHEABLE = (request, res) => {
  if (!res.ok) return false
  // An opaque cross-origin response has no readable headers; NEVER()/origin
  // checks already excluded those, so anything here should be same-origin.
  if (res.type === 'opaque') return false
  const asked = new URL(request.url).pathname
  const isHtml = (res.headers.get('content-type') || '').toLowerCase().includes('text/html')
  if (!isHtml) return true
  // HTML is legitimate ONLY for a navigation or an actual .html path.
  return request.mode === 'navigate' || asked === '/' || asked.endsWith('.html')
}

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
  // THE ASSET HOST COUNTS AS OURS.
  //
  // static.sporta.com.kw is the cookie-free origin the CSS, the bundle and the
  // fonts are served from. It is a different ORIGIN but the same document root
  // and the same files, so everything below — the content-hash test, the
  // immutable rule, the stale-while-revalidate for fixed-name pictures — is
  // exactly as correct there as here; the tests key on url.pathname, which is
  // identical on both hosts.
  //
  // Without this line the bailout on the next line would skip every one of
  // them: no precache, no offline shell, no cache-first for a year on files
  // whose names carry their own hash. Moving assets to a second origin would
  // have quietly traded the whole service worker for a cookie header that
  // measured zero bytes.
  const OURS = url.origin === location.origin || url.host === 'static.sporta.com.kw'
  if (!OURS) return // the bank, and anything else: always live
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
            if (CACHEABLE(request, res)) caches.open(ASSETS).then((c) => c.put(request, res.clone()))
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
            // The immutable path is where a poisoned entry does the most
            // damage — it is never revalidated — so the guard matters most here.
            if (CACHEABLE(request, res)) caches.open(ASSETS).then((c) => c.put(request, res.clone()))
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
        if (CACHEABLE(request, res)) caches.open(SHELL).then((c) => c.put(request, res.clone()))
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

// ---------------------------------------------------------------- Web Push
//
// An order alert for the OWNER. Nothing a shopper does reaches this code: a
// subscription only exists on a device that signed in to /backends and asked
// for one, and the push itself is signed with a VAPID key only the server has.
//
// ON iOS THIS RUNS ONLY WHEN THE SITE IS ON THE HOME SCREEN. Safari has
// supported Web Push since 16.4, but exclusively for an installed PWA — in a
// browser tab, Notification.requestPermission() does not even exist. The
// /backends screen says so; there is nothing this file can do about it.
self.addEventListener('push', (e) => {
  // A push with no payload, or one this worker cannot parse, still has to show
  // SOMETHING: iOS revokes push permission from an app that receives a push
  // and displays no notification. A wrong-looking alert is recoverable; a
  // silently revoked permission is the failure that looks like nothing.
  let d = { title: 'سبورتا', body: 'طلب جديد', url: '/backends', tag: 'sporta' }
  try {
    d = { ...d, ...(e.data ? e.data.json() : {}) }
  } catch {
    /* keep the defaults */
  }

  // Same-origin only. The payload is signed, so this is defence in depth
  // rather than a live worry — but a notification that can be made to open an
  // arbitrary URL is one phishing message away from being worth having.
  const url = typeof d.url === 'string' && d.url.startsWith('/') && !d.url.startsWith('//')
    ? d.url
    : '/backends'

  e.waitUntil(
    self.registration.showNotification(d.title, {
      body: d.body,
      // The S mark, not the wordmark: iOS renders this at about 24px.
      icon: '/favicon.png',
      badge: '/favicon.png',
      // Collapses repeats about one order into one entry rather than stacking.
      tag: typeof d.tag === 'string' ? d.tag : 'sporta',
      // ...but still buzz for a re-send, because the state in the alert may
      // have changed (awaiting payment -> paid) and a silent replace would
      // leave the owner reading the old one.
      renotify: true,
      dir: 'rtl',
      lang: 'ar',
      data: { url },
    }),
  )
})

// Tapping it. Focus the admin tab if one is already open — opening a second
// window on a phone leaves the owner with two, and the one they were reading
// is the one behind.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/backends'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).pathname.startsWith('/backends') && 'focus' in w) {
          if ('navigate' in w) w.navigate(url)
          return w.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
