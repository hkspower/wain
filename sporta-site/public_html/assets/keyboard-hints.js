/**
 * Phone keyboards: tell iOS and Android what each field is.
 *
 * The bundle already sets inputMode/autoComplete on most checkout fields, but
 * not the rest: an email box capitalised its first letter and underlined the
 * address as a typo, a name started in lower case, a search box showed a
 * "return" key. This only ADDS an attribute that is missing — it never
 * overrides one the page set, and changes no value, label, style or request.
 *   email      -> email keyboard, no capital, no autocorrect
 *   phone      -> number pad
 *   password / username / codes -> no capital, no autocorrect, no spellcheck
 *   name, address -> capitalise each word
 *   search     -> "Search" key
 *   one-time code -> number pad
 */
(function () {
  'use strict'
  function put(e, k, v) { if (!e.hasAttribute(k)) e.setAttribute(k, v) }
  function plain(e) { put(e, 'autocapitalize', 'none'); put(e, 'autocorrect', 'off'); put(e, 'spellcheck', 'false') }

  function hint(e) {
    if (e.type === 'hidden' || e.type === 'checkbox' || e.type === 'radio' || e.type === 'file' || e.type === 'range' || e.type === 'color') return
    var ac = (e.getAttribute('autocomplete') || '').toLowerCase()
    var id = ((e.name || '') + ' ' + (e.id || '') + ' ' + (e.getAttribute('aria-label') || '')).toLowerCase()
    if (e.tagName === 'TEXTAREA') return
    if (e.type === 'email' || ac === 'email') { put(e, 'inputmode', 'email'); plain(e); return }
    if (e.type === 'tel' || /^tel/.test(ac)) { put(e, 'inputmode', 'tel'); plain(e); return }
    if (e.type === 'password' || ac === 'username' || /password/.test(ac)) { plain(e); return }
    if (ac === 'one-time-code') { put(e, 'inputmode', 'numeric'); plain(e); return }
    if (e.type === 'search' || e.getAttribute('role') === 'searchbox' || e.closest('[role=search]')) { put(e, 'enterkeyhint', 'search'); put(e, 'autocapitalize', 'none'); return }
    if (e.type !== 'text' && e.type !== '') return
    if (ac === 'name' || /^(given|family|additional)-name$/.test(ac) || /address|street|city|area|block|name$/.test(ac)) { put(e, 'autocapitalize', 'words'); return }
    if (/(^|[^a-z])(code|otp|pin)([^a-z]|$)/.test(id)) plain(e)
  }

  function run() { document.querySelectorAll('input, select').forEach(hint) }
  var t = null
  // One pending pass at a time, NOT a debounce: the hero carousel mutates the page
  // continuously, and a debounce is reset by every change and never fires.
  new MutationObserver(function () { if (!t) t = setTimeout(function () { t = null; run() }, 150) }).observe(document.documentElement, { childList: true, subtree: true })
  run()
})()
