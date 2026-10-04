/**
 * The home page's sections in the OWNER'S order, with the ones switched off hidden (2026-10-04,
 * "make all website full dynamic to edit at backend"). The order and switches are the `sections`
 * list of the `home_layout` setting, read from ?r=slides (which the page already asks for).
 *
 * NOTHING IS MOVED IN THE DOM. The hero and the category tiles are React's; moving React's nodes
 * is how a re-render throws. Instead <main> becomes a flex column (css/72-home-sections.css, only
 * while `data-home-order` is on it) and each section gets a CSS `order` — the same picture, a
 * different stacking rule. Sections the overlays add (banner, features, best sellers) are placed by
 * their own scripts relative to anchors; the `order` wins over where they were inserted.
 *
 * Empty list (the usual case) = nothing happens and the page is exactly as built.
 */
;(function () {
  'use strict'
  if (/^\/backends(\/|$)/.test(location.pathname)) return

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')
  var SEL = {
    hero: 'main > section[aria-roledescription]',
    banner: 'main > [data-sporta-home-banner]',
    categories: null,   // found by its tiles, like home-banner.js
    features: 'main > [data-sporta-trust-strip]',
    bestsellers: 'main > [data-sporta-home-products]',
  }
  var sections = null   // null = not fetched; [] = built-in order
  var asked = false

  function find(key) {
    if (key === 'categories') { var t = document.querySelector('main .cat-tile'); var s = t && t.closest('section'); return s && s.parentNode === document.querySelector('main') ? s : null }
    return document.querySelector(SEL[key])
  }
  function load(cb) {
    if (sections !== null) { cb(sections); return }
    if (asked) return
    asked = true
    fetch(api + '/api.php?r=slides', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (d) { var l = d && d.layout && d.layout.sections; sections = Array.isArray(l) ? l : []; cb(sections) })
      .catch(function () { sections = []; cb(sections) })
  }
  function apply(list) {
    var main = document.querySelector('main')
    if (!main) return
    if (!list.length || location.pathname !== '/') {
      if (main.hasAttribute('data-home-order')) {
        main.removeAttribute('data-home-order')
        main.querySelectorAll('[data-home-section]').forEach(function (n) { n.style.order = ''; n.style.display = ''; n.removeAttribute('data-home-section') })
      }
      return
    }
    main.setAttribute('data-home-order', '1')
    for (var i = 0; i < list.length; i++) {
      var el = find(list[i].key)
      if (!el) continue
      var order = String(i + 1), display = list[i].on === false ? 'none' : ''
      if (el.style.order !== order) el.style.order = order
      if (el.style.display !== display) el.style.display = display
      if (el.getAttribute('data-home-section') !== list[i].key) el.setAttribute('data-home-section', list[i].key)
    }
  }
  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; load(apply) })
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true })
  schedule()
})()
