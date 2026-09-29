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
            for (var q in h) if (q.toLowerCase() !== 'accept') return null
            continue
          }
          if (p === 'method' && String(init.method).toUpperCase() === 'GET') continue
          return null
        }
      }
      if (typeof input !== 'string' && !(input instanceof URL)) return null
      var u = new URL(String(input), location.href)
      if (u.origin !== location.origin || !/\/api\/api\.php$/.test(u.pathname)) return null
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
