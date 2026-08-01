// Instant navigation, for a single-page app.
//
// The site already never re-downloads its shell — react-router changes the
// route in the browser. What it DOES download is the route's own chunk, and
// that download starts at the click. On a Kuwaiti mobile connection that is a
// visible pause between tapping "Shop" and seeing it, on every first visit to
// every route.
//
// So the chunk is fetched BEFORE the click, at the moment the visitor shows
// intent — hovering a link on a desktop, or touching it on a phone (touchstart
// fires roughly 100ms before the click, which is most of a round trip on a
// good connection and all of the parse time on a bad one).
//
// It is a plain dynamic import, not <link rel=prefetch>, for two reasons: the
// hashed chunk filename is not knowable from here, and import() populates the
// module registry, so React.lazy resolves synchronously afterwards rather than
// merely finding the bytes in the HTTP cache.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
//   * It never prefetches on a metered or slow connection, or when the visitor
//     has asked for reduced data. Spending someone's pay-as-you-go megabytes on
//     a page they have not asked for is not an optimisation.
//   * It never prefetches /backends. That chunk is 103 kB of admin nobody
//     shopping will open, and it is not linked from the storefront anyway.
//   * Each route is fetched at most once. The Set is the whole cache.

const LOADERS = {
  '/shop': () => import('../pages/Shop'),
  '/cart': () => import('../pages/Cart'),
  '/checkout': () => import('../pages/Checkout'),
  '/about': () => import('../pages/About'),
  '/contact': () => import('../pages/Contact'),
  '/wishlist': () => import('../pages/Wishlist'),
  '/track': () => import('../pages/TrackOrder'),
  '/returns': () => import('../pages/Returns'),
  '/terms': () => import('../pages/Terms'),
  '/privacy': () => import('../pages/Privacy'),
  '/product': () => import('../pages/ProductDetail'),
}

const done = new Set()

// Would prefetching cost this visitor money or time they did not offer?
function mayPrefetch() {
  const c = navigator.connection
  if (!c) return true
  if (c.saveData) return false
  return !/(^|-)2g$/.test(c.effectiveType ?? '')
}

// `/product/cloudsoft-jacket` and `/product/anything` are one chunk.
function loaderFor(path) {
  if (!path || !path.startsWith('/')) return null
  const first = `/${path.split('/')[1] ?? ''}`
  return LOADERS[first] ?? null
}

export function prefetchRoute(path) {
  const load = loaderFor(path)
  if (!load || done.has(path) || !mayPrefetch()) return
  done.add(path)
  // Swallowed: a prefetch that fails must never surface as an error, because
  // the click that follows will simply load it again for real.
  load().catch(() => done.delete(path))
}

// Attach once, to the document, rather than per link.
//
// One listener instead of one per <Link> — the shop grid alone has dozens, and
// they mount and unmount as the visitor filters. Delegation means no listener
// bookkeeping and nothing to leak.
export function watchForIntent() {
  if (typeof document === 'undefined') return () => {}
  const onIntent = (e) => {
    const a = e.target?.closest?.('a[href^="/"]')
    if (a) prefetchRoute(a.getAttribute('href'))
  }
  // `pointerenter` does not bubble; `pointerover` does.
  document.addEventListener('pointerover', onIntent, { passive: true })
  document.addEventListener('touchstart', onIntent, { passive: true })
  // Keyboard users tab to a link before pressing Enter — the same intent.
  document.addEventListener('focusin', onIntent, { passive: true })
  return () => {
    document.removeEventListener('pointerover', onIntent)
    document.removeEventListener('touchstart', onIntent)
    document.removeEventListener('focusin', onIntent)
  }
}
