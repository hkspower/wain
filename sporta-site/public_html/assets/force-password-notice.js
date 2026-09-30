/* Sporta — a banner telling the owner to replace a cron-set temporary password.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * reset-admin-password.php is the only way this shop recovers a locked-out
 * admin, and whatever password it sets travels through a cron command that
 * at least one other person — whoever ran it — can read. admin.php now marks
 * that account `must_change_password` and refuses every OTHER route with
 * HTTP 428 until a real password is chosen through ?r=account_update — see
 * store_require_admin()'s own comment for why 428 rather than 401/403 (this
 * bundle, like the app, treats both of those as "signed out").
 *
 * The panel itself has no source in this repository and cannot be taught to
 * show this on its own — same reasoning rules.js and the Google sign-in setup
 * card already give for being overlays rather than edits.
 *
 * ------------------------------------------------------------------- WHAT IT
 * ------------------------------------------------------------------- DOES NOT DO
 *
 * It does not block clicks or grey out the rest of the panel. The server
 * already refuses every other write and read with 428, so a determined click
 * elsewhere fails loudly rather than silently succeeding — this banner is the
 * explanation for that failure, not the only thing preventing it. Building a
 * click-blocking overlay on a bundle with no source is exactly the kind of
 * fragile DOM surgery this project's own notes warn against for a gain the
 * server-side gate already provides.
 *
 * ------------------------------------------------------------------ HOW IT
 * ------------------------------------------------------------------ FINDS SECURITY
 *
 * The Security screen has no id or class of its own the bundle exposes here —
 * matched by EXACT text, the same discipline contact.js and footer-payment-
 * icons.js already use, and excluded from `.admin-content` so a product or
 * order literally named "Security" is never mistaken for the nav item.
 */
;(function () {
  'use strict'

  // Loaded on every page like every other /backends-only overlay here, and
  // gated the same way admin-upload.js is gated in index.html's own comment
  // — "neither does anything on any page but /backends". Checked explicitly
  // rather than left to the DOM anchor alone: unlike rules.js's heading
  // search, this script's first act is a NETWORK REQUEST, and firing
  // admin.php?r=me from every storefront pageview would be a needless call
  // this shop already gets to skip on every other overlay.
  if (location.pathname.indexOf('/backends') !== 0) return

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')
  var MARK = 'data-sporta-force-pw-notice'
  var checked = false
  var mustChange = false

  function checkOnce(cb) {
    if (checked) { cb(mustChange); return }
    fetch(api + '/admin.php?r=me', {
      headers: { 'X-Sporta-Admin': '1', Accept: 'application/json' },
      credentials: 'include',
    })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (data) {
        checked = true
        mustChange = !!(data && data.must_change_password)
        cb(mustChange)
      })
      .catch(function () { checked = true; mustChange = false; cb(false) })
  }

  function findSecurityButton() {
    var content = document.querySelector('.admin-content')
    var candidates = document.querySelectorAll('button, a')
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i]
      if (content && content.contains(el)) continue
      if (el.textContent.trim() === 'Security') return el
    }
    return null
  }

  function build() {
    var bar = document.createElement('div')
    bar.setAttribute(MARK, '1')
    bar.setAttribute('role', 'alert')
    bar.style.cssText =
      'position:sticky;top:0;z-index:9999;display:flex;flex-wrap:wrap;align-items:center;' +
      'justify-content:center;gap:12px;padding:10px 16px;background:#7c2d12;color:#fff;' +
      'font:600 14px/1.4 system-ui,sans-serif;text-align:center;'

    var text = document.createElement('span')
    text.textContent =
      'This account is signed in with a temporary password. Set a real one now — every other screen is refused until you do.'
    bar.appendChild(text)

    var btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = 'Set a new password'
    btn.style.cssText =
      'background:#fff;color:#7c2d12;border:none;border-radius:6px;padding:6px 14px;' +
      'font:700 13px/1 system-ui,sans-serif;cursor:pointer;'
    btn.onclick = function () {
      var target = findSecurityButton()
      if (target) target.click()
    }
    bar.appendChild(btn)

    return bar
  }

  function place() {
    checkOnce(function (must) {
      var existing = document.querySelector('[' + MARK + ']')
      if (!must) {
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
        return
      }
      if (existing) return
      if (!document.body) return
      document.body.insertBefore(build(), document.body.firstChild)
    })
  }

  var queued = false
  var observer = new MutationObserver(function () {
    if (queued) return
    queued = true
    requestAnimationFrame(function () {
      queued = false
      place()
    })
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  place()
})()
