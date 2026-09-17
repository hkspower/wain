/**
 * The website panel's order-detail drawer: a link to the archived PDF invoice.
 *
 * WHY AN OVERLAY. The website's /backends is a prebuilt bundle with no source
 * in this repository, and it is a DIFFERENT PROGRAM from the app's /backends
 * (which got its own "Invoice (PDF)" button in src/app/backends/order/[id].tsx
 * in the same change). Same pattern as rules.js, panel-settings.js and
 * brand-logos.js: add to the screen it belongs to, touch nothing that exists.
 *
 * WHAT WAS ALREADY THERE, SERVER-SIDE. api/invoice-pdf.php draws a bilingual
 * PDF per order, api/cron-invoice.php sweeps every fifteen minutes to keep one
 * on disk for every order, and api/invoice-file.php hands the bytes to a
 * signed-in admin — building it on demand if the sweep has not reached it
 * yet. None of it needed building. What was missing was a way to REACH it:
 * grep across both panels found not one reference to invoice-file.php in
 * either bundle. The document has existed since the font was fixed; nobody
 * could open it without typing the URL from memory.
 *
 * NEEDS NO CREDENTIAL OF ITS OWN. invoice-file.php is gated by
 * store_session_admin() — the session COOKIE alone, deliberately, because its
 * own comment explains a download is a plain navigation and a navigation
 * cannot carry the X-Sporta-Admin header the rest of admin.php insists on. So
 * this is a plain <a>, not a fetch: opening it in a new tab already carries
 * everything the route asks for.
 *
 * THE DIALOG IS FOUND BY ITS aria-label, NOT BY A CLASS NAME. The order-detail
 * drawer has no id or class of its own beyond ordinary Tailwind utilities, but
 * it declares `role="dialog" aria-label="Order ${track_id}"` — which the
 * track id is then read straight out of, rather than re-fetched, since it is
 * already sitting in the attribute the accessibility tree needs anyway.
 *
 * MARKED so re-rendering the drawer (closing and reopening it, or the
 * observer's own churn) does not insert the link twice, and the href is kept
 * in step with the track id rather than assumed constant, in case a future
 * build reuses one drawer instance across orders.
 */
;(function () {
  'use strict'

  var MARK = 'data-sporta-invoice-link'

  function trackFromDialog(dialog) {
    var label = dialog.getAttribute('aria-label') || ''
    var m = label.match(/^Order (.+)$/)
    return m ? m[1] : null
  }

  function style() {
    if (document.getElementById('spi-css')) return
    var s = document.createElement('style')
    s.id = 'spi-css'
    s.textContent =
      '.spi-link{display:inline-flex;align-items:center;gap:4px;margin-top:6px;'
      + 'font-size:12px;font-weight:600;color:#4f46e5;text-decoration:none}'
      + '.spi-link:hover{text-decoration:underline}'
    document.head.appendChild(s)
  }

  function place() {
    var dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
    for (var i = 0; i < dialogs.length; i++) {
      var dialog = dialogs[i]
      var track = trackFromDialog(dialog)
      if (!track) continue

      var header = dialog.querySelector('header')
      var titleBox = header && header.firstElementChild
      if (!titleBox) continue

      var link = titleBox.querySelector('[' + MARK + ']')
      var href = '/api/invoice-file.php?id=' + encodeURIComponent(track)
      if (link) {
        if (link.getAttribute('href') !== href) link.setAttribute('href', href)
        continue
      }

      style()
      link = document.createElement('a')
      link.setAttribute(MARK, '1')
      link.className = 'spi-link'
      link.href = href
      link.target = '_blank'
      link.rel = 'noopener'
      link.textContent = 'Invoice (PDF)'
      titleBox.appendChild(link)
    }
  }

  var timer = null
  new MutationObserver(function () {
    clearTimeout(timer)
    timer = setTimeout(place, 120)
  }).observe(document.body, { childList: true, subtree: true })
  place()
})()
