/* Sporta — the footer's link columns, from /backends (2026-10-02).
 *
 * The built footer has two link columns, compiled into a bundle with no source here. React owns
 * those nodes, so they are NEVER edited or removed: when the owner has saved columns, the built
 * grid is only HIDDEN and a grid of our own is inserted beside it, built from the built one's own
 * class names so it looks the same. With no saved columns nothing at all happens — the state
 * every shop starts in, and the way back (clear the card).
 *
 * The footer re-renders on navigation and on a language switch, so a MutationObserver puts our
 * grid back if it is gone and rebuilds it when the language changes. Our own edits are flagged
 * so the observer does not answer itself.
 */
;(function () {
  'use strict'
  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')
  var MARK = 'data-sporta-footer-links'
  var columns = null, lang = '', ours = false, queued = false

  function isAr() { return (document.documentElement.getAttribute('lang') || 'ar').slice(0, 2) !== 'en' }
  function pick(en, ar) { var a = isAr(); return (a ? ar || en : en || ar) || '' }

  function builtGrid(footer) {
    var h = footer.querySelector('h2')
    while (h && h.parentNode && h.parentNode !== footer) {
      var g = h.parentNode.parentNode
      if (g && g !== footer && g.querySelectorAll('h2').length >= 1 && !g.hasAttribute(MARK)) {
        // the grid is the element whose children are the columns (each has an h2 and a ul)
        var col = h.parentNode
        if (col.querySelector('ul') && g.parentNode) return { col: col, grid: g }
      }
      h = h.parentNode
    }
    return null
  }

  function render() {
    var footer = document.querySelector('footer')
    if (!footer || !columns || !columns.length) return
    var built = builtGrid(footer)
    if (!built) return
    var grid = built.grid
    var sample = built.col
    var h2 = sample.querySelector('h2'), ul = sample.querySelector('ul'), li = ul && ul.querySelector('li'), a = li && li.querySelector('a')
    if (!h2 || !ul || !li || !a) return
    var key = (isAr() ? 'ar' : 'en') + JSON.stringify(columns)
    var mine = footer.querySelector('[' + MARK + ']')
    if (mine && mine.getAttribute('data-key') === key && mine.previousSibling === grid) return
    if (mine) mine.parentNode.removeChild(mine)

    var out = document.createElement('div')
    out.className = grid.className
    out.setAttribute(MARK, '1')
    out.setAttribute('data-key', key)
    columns.forEach(function (c) {
      var col = document.createElement('div')
      var t = document.createElement('h2'); t.className = h2.className; t.textContent = pick(c.title_en, c.title_ar)
      var list = document.createElement('ul'); list.className = ul.className
      ;(c.links || []).forEach(function (l) {
        var item = document.createElement('li'); if (li.className) item.className = li.className
        var link = document.createElement('a'); link.className = a.className
        link.textContent = pick(l.label_en, l.label_ar)
        link.setAttribute('href', l.href)
        if (/^https:/.test(l.href)) { link.setAttribute('target', '_blank'); link.setAttribute('rel', 'noopener noreferrer') }
        item.appendChild(link); list.appendChild(item)
      })
      col.appendChild(t); col.appendChild(list); out.appendChild(col)
    })
    grid.style.display = 'none'
    grid.setAttribute('data-sporta-footer-hidden', '1')
    grid.parentNode.insertBefore(out, grid.nextSibling)
  }

  function run() {
    if (ours) return
    ours = true
    try { render() } finally { ours = false }
  }

  fetch(api + '/api.php?r=footer_links', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (f) {
      if (!f || !f.columns || !f.columns.length) return
      columns = f.columns
      run()
      var mo = new MutationObserver(function () {
        if (ours || queued) return
        queued = true
        requestAnimationFrame(function () { queued = false; run() })
      })
      mo.observe(document.body, { childList: true, subtree: true })
      // The language lives on <html>, which is OUTSIDE body: watched on its own, or a switch is only
      // noticed when something else in the page happens to change.
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    })
    .catch(function () { /* the built-in footer stays */ })
})()
