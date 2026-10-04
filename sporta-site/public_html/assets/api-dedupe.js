/**
 * Sporta — one request for one answer.
 *
 * Measured 2026-09-29 on a plain phone load of the home page: the same
 * `?r=products` was requested FOUR times, `?r=slides` four times and `?r=stock`
 * twice — the storefront bundle asks, and so do several overlay scripts, each
 * unaware of the others. Every repeat is a request the shopper's phone waits on.
 *
 * WHAT THIS DOES. It wraps window.fetch so that an IDENTICAL GET for one of the
 * shop's public, cacheable read routes that is already in flight — or finished
 * less than two seconds ago — is answered from that one request (each caller
 * gets its own clone, so a body can be read more than once). Nothing else is
 * touched: not POSTs, not the cart, not `stock` (availability is deliberately
 * `no-store`, and a stale count is a sale that cannot be fulfilled), not any
 * route not listed, not anything with a custom method or a Request object.
 *
 * FAILS TOWARDS A REAL REQUEST. A rejected or non-OK answer is forgotten at
 * once, so a failure is never replayed to the next caller, and any surprise in
 * this wrapper falls back to the original fetch. Two seconds is short enough
 * that an owner's edit followed by a reload — a new page load, a new copy of
 * this script — can never see it.
 */
(function () {
  'use strict'
  if (typeof window.fetch !== 'function' || window.__sportaDedupe) return
  window.__sportaDedupe = true

  var ROUTES = /[?&]r=(products|slides|footer|theme|fonts|contact|legal|site_text)(&|$)/
  // THE PANEL'S READS TOO (2026-10-04, "faster panel"): measured on the login page, ?r=me was asked
  // NINE times and google_config/apple_config/passcode_status twice each — one per overlay, each unaware
  // of the others; the Catalogue screen asked products_all four times. These are reads (admin.php GETs
  // that write nothing), so sharing one answer for two seconds changes nothing but the request count.
  // me/stats/notifications are per-session answers, which is fine: the key below includes the path and
  // the cookie travels with every one of them.
  var ADMIN_ROUTES = /[?&]r=(me|google_config|apple_config|passcode_status|couriers|products_all|brands|orders|variants|stats|notifications|rules|revenue|products_state|settings)(&|$)/
  var HOLD = 2000
  var seen = Object.create(null)
  var native = window.fetch.bind(window)

  function keyOf(input, init) {
    try {
      if (init && init.method && String(init.method).toUpperCase() !== 'GET') return null
      if (init) {
        // Only the two shapes this shop's own code uses: {headers:{Accept}} and
        // {credentials}. Anything that could change the ANSWER (a body, a signal
        // that may abort it, a cache mode, other headers) is passed straight on.
        for (var p in init) {
          if (p === 'credentials') continue
          if (p === 'headers') {
            var h = init.headers
            if (!h || typeof h !== 'object' || Array.isArray(h) || typeof h.forEach === 'function') return null
            // Accept, and the panel's own two (a marker header and a JSON content type on a GET):
            // none of them changes what a read answers.
            for (var q in h) { var ql = q.toLowerCase(); if (ql !== 'accept' && ql !== 'x-sporta-admin' && ql !== 'content-type') return null }
            continue
          }
          if (p === 'method' && String(init.method).toUpperCase() === 'GET') continue
          if (p === 'cache' && (init.cache === 'no-store' || init.cache === 'default')) continue   // the panel passes it on reads; the answer is the same
          return null
        }
      }
      if (typeof input !== 'string' && !(input instanceof URL)) return null
      var u = new URL(String(input), location.href)
      if (u.origin !== location.origin) return null
      if (/\/api\/admin\.php$/.test(u.pathname)) return ADMIN_ROUTES.test(u.search) ? u.pathname + u.search : null
      if (!/\/api\/api\.php$/.test(u.pathname)) return null
      return ROUTES.test(u.search) ? u.pathname + u.search : null
    } catch (e) { return null }
  }

  window.fetch = function (input, init) {
    var k = keyOf(input, init)
    if (!k) return native(input, init)
    var hit = seen[k]
    if (hit && (hit.open || Date.now() - hit.t < HOLD)) {
      return hit.p.then(function (r) { return r.clone() })
    }
    var entry = { open: true, t: Date.now(), p: null }
    entry.p = native(input, init).then(function (r) {
      entry.open = false; entry.t = Date.now()
      if (!r.ok) delete seen[k]
      return r
    }, function (e) { delete seen[k]; throw e })
    seen[k] = entry
    return entry.p.then(function (r) { return r.clone() })
  }
})()
