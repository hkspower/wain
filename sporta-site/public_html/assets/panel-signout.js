/**
 * A "Sign out" button in the panel's top bar on computers (2026-10-15, "put signout at backends").
 *
 * The bundle's own Sign out is the LAST item of a 20-item sidebar, below the fold of a 900px
 * window, so on a computer it was effectively hidden. Phones already show it in their top bar.
 * This draws one fixed button to the left of the notification bell, from 768px only, while a
 * panel screen is showing — and pressing it presses the bundle's own Sign out, so there is still
 * one way to sign out and it ends the session exactly as before. If that button cannot be found it
 * falls back to the logout route and a reload.
 */
(function () {
  'use strict'
  if (!/^\/backends(\/|$)/.test(location.pathname)) return

  var MARK = 'data-sporta-signout'
  var CSS = '[' + MARK + ']{display:none}'
    + '@media (min-width:768px){[' + MARK + ']{display:inline-flex;position:fixed;top:10px;right:72px;z-index:45;align-items:center;gap:8px;'
    + 'min-height:44px;padding:0 16px;border-radius:12px;border:1px solid #cbd5e1;background:#fff;color:#334155;'
    + 'font:600 14px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.08)}'
    + '[' + MARK + ']:hover{background:#f1f5f9;color:#0f172a}'
    + '[' + MARK + ']:focus-visible{outline:2px solid #4f46e5;outline-offset:2px}'
    + 'html[data-theme="dark"] [' + MARK + ']{background:#1f2328;color:#e5e7eb;border-color:#3f444b}}'

  function ownButton() {
    var bs = document.querySelectorAll('aside button, nav button')
    for (var i = 0; i < bs.length; i++) if (bs[i].textContent.trim() === 'Sign out' && !bs[i].hasAttribute(MARK)) return bs[i]
    return null
  }
  function signOut(btn) {
    btn.disabled = true
    var own = ownButton()
    if (own) { own.click(); return }
    fetch('/api/admin.php?r=logout', { method: 'POST', credentials: 'include', headers: { 'X-Sporta-Admin': '1' } })
      .catch(function () {}).then(function () { location.reload() })
  }
  function place() {
    var signedIn = !!document.querySelector('.admin-content')
    var btn = document.querySelector('[' + MARK + ']')
    if (!signedIn) { if (btn) btn.remove(); return }
    if (btn) return
    if (!document.getElementById('spso-css')) { var s = document.createElement('style'); s.id = 'spso-css'; s.textContent = CSS; document.head.appendChild(s) }
    btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute(MARK, '')
    btn.textContent = 'Sign out'
    btn.addEventListener('click', function () { signOut(btn) })
    document.body.appendChild(btn)
  }
  var t = null
  new MutationObserver(function () { clearTimeout(t); t = setTimeout(place, 150) }).observe(document.body, { childList: true, subtree: true })
  place()
})()
