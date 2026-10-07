/**
 * The /backends panel is LIGHT — 2026-10-07, "add brighter colors for backend layout to be comfort to view"; the owner
 * chose a light panel. The shop stays dark: this does nothing off /backends.
 *
 * HOW. The whole app (shop and panel) is one bundle whose ThemeProvider writes data-theme on <html> from
 * localStorage 'sporta_theme' after hydration. The panel's cards were written for a light page, and sporta-dark.css only
 * darkens them while data-theme is "dark" — so on /backends this sets data-theme="light" and puts it back whenever the
 * bundle writes it again. It never touches localStorage: the owner's own shop theme choice is not changed by opening
 * the panel. panel.php loads it as a blocking script in <head>, so the first frame is already light.
 *
 * A switch: the panel's mode is remembered per browser in localStorage 'sporta_panel_mode' ('dark' keeps the old
 * look). The button sits in the sidebar, under the account line.
 */
(function () {
  'use strict'
  if (!/^\/backends(\/|$)/.test(location.pathname)) return
  var KEY = 'sporta_panel_mode'
  function mode() { try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light' } catch (e) { return 'light' } }
  var root = document.documentElement
  function apply() {
    var want = mode()
    if (root.getAttribute('data-theme') !== want) root.setAttribute('data-theme', want)
  }
  apply()
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-theme'] })

  /* ---- the switch ---- */
  function button() {
    var shell = document.querySelector('.admin-shell')
    if (!shell || document.querySelector('[data-sppl-switch]')) return
    var anchor = null
    var all = shell.querySelectorAll('button, a')
    for (var i = 0; i < all.length; i++) { if (all[i].textContent.trim() === 'Sign out' && all[i].offsetParent !== null) { anchor = all[i]; break } }
    if (!anchor) return
    var b = document.createElement('button')
    b.type = 'button'; b.setAttribute('data-sppl-switch', '1')
    b.className = anchor.className
    function label() { b.textContent = mode() === 'light' ? 'Dark panel' : 'Light panel' }
    label()
    b.addEventListener('click', function () {
      try { localStorage.setItem(KEY, mode() === 'light' ? 'dark' : 'light') } catch (e) { /* private window: stays as it is */ }
      apply(); label()
    })
    // Phones: the top bar has no room for it (it ran under the bell), so the switch lives in the sidebar only.
    var st = document.createElement('style'); st.textContent = '@media (max-width:767.98px){[data-sppl-switch]{display:none!important}}'
    document.head.appendChild(st)
    anchor.parentNode.insertBefore(b, anchor)
  }
  var t = null
  new MutationObserver(function () { clearTimeout(t); t = setTimeout(button, 150) }).observe(document.body || root, { childList: true, subtree: true })
  if (document.body) button()
  else document.addEventListener('DOMContentLoaded', button)
})()
