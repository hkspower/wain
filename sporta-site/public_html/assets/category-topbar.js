/**
 * Sporta — the two pieces of the app's topbar that need JavaScript on
 * category.php's server-rendered pages: the ticking Kuwait clock and the
 * cart-count badge. Everything else in that header (promo text, the
 * language toggle, the logo, the sub-nav links) is plain HTML that already
 * works with this file never loading.
 *
 * EXTERNAL RATHER THAN INLINE, on purpose. `.htaccess`'s CSP allows inline
 * scripts only by sha256 hash — CLAUDE.md records at length that an inline
 * script edited without updating its hash is silently REFUSED by the live
 * server. `script-src 'self'` already covers a same-origin file with no
 * hash to keep in step, which is the whole reason contact.js, footer.js and
 * every other small script on this site is its own file rather than a
 * `<script>` tag in the page.
 *
 * NO CART STATE IS EVER WRITTEN HERE. The badge reads localStorage's
 * `sporta_cart` — the same key the app's CartProvider owns — and never
 * calls setItem. A read-only mirror cannot desync the real cart even if
 * this file and the app disagree about anything else.
 */
(function () {
  'use strict'

  var digital = document.querySelector('[data-clock-digital]')
  var hourHand = document.querySelector('.clock [data-hand="hour"]')
  var minuteHand = document.querySelector('.clock [data-hand="minute"]')
  var secondHand = document.querySelector('.clock [data-hand="second"]')

  function tickClock() {
    var now = new Date()
    var parts
    try {
      parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kuwait', hour: '2-digit', minute: '2-digit',
        second: '2-digit', hour12: false,
      }).formatToParts(now)
    } catch (e) {
      return // an Intl-less browser gets a static face rather than a wrong one
    }
    var h = 0, m = 0, s = 0
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === 'hour') h = Number(parts[i].value) % 24
      if (parts[i].type === 'minute') m = Number(parts[i].value)
      if (parts[i].type === 'second') s = Number(parts[i].value)
    }
    if (digital) {
      digital.textContent =
        String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
    }
    var hourDeg = ((h % 12) + m / 60) * 30
    var minuteDeg = (m + s / 60) * 6
    var secondDeg = s * 6
    if (hourHand) hourHand.setAttribute('transform', 'rotate(' + hourDeg + ' 24 24)')
    if (minuteHand) minuteHand.setAttribute('transform', 'rotate(' + minuteDeg + ' 24 24)')
    if (secondHand) secondHand.setAttribute('transform', 'rotate(' + secondDeg + ' 24 24)')
  }

  if (digital || hourHand) {
    tickClock()
    setInterval(tickClock, 1000)
  }

  var badge = document.querySelector('[data-cart-badge]')
  if (badge) {
    try {
      var items = JSON.parse(window.localStorage.getItem('sporta_cart') || '[]')
      var count = 0
      for (var j = 0; j < items.length; j++) {
        count += Number(items[j] && items[j].qty) || 1
      }
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count)
        badge.style.display = 'flex'
      }
    } catch (e) {
      // localStorage blocked or unreadable — the icon still works as a plain
      // link to /cart, it just carries no number.
    }
  }
})()
