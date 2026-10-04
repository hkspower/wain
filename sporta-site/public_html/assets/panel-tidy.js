/**
 * Collapsible cards on the panel's long screens (2026-10-04, "tidy the screens").
 *
 * Settings is six screenfuls of cards. Every overlay card is a `section` with an `h2` first child
 * placed directly in `.admin-content` (the save bar and the jump bar already find them that way), so
 * this gives each one a fold: a button after the heading toggles the card's body, the choice is kept
 * per card title in localStorage (`sporta_panel_tidy`), and a small bar offers Collapse all / Expand all.
 * Default OPEN — nothing is hidden from an owner who never touches it.
 *
 * It never moves or edits a node React owns: the bundle's own cards are `div.rounded-2xl` inside its
 * screen `div`, and those are left alone. The toggle is a SIBLING of the heading, not inside it, so the
 * heading's accessible name stays the heading (the rule recorded for the save bar's "View all").
 * A collapsed card keeps its controls in the DOM (`display:none`), so panel-save-bar.js still counts the
 * card and still presses its own Save; a card with a refusal note or a focused field is re-opened.
 */
(function () {
  'use strict'
  if (!/^\/backends(\/|$)/.test(location.pathname)) return

  var KEY = 'sporta_panel_tidy'
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch (e) { return {} } }
  function save(m) { try { localStorage.setItem(KEY, JSON.stringify(m)) } catch (e) {} }

  var CSS = ''
    + '.admin-content>section.pt-card{position:relative}'
    + '.admin-content>section.pt-card>.pt-toggle{position:absolute;top:12px;inset-inline-end:12px;min-width:44px;min-height:44px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font:inherit;font-size:13px;cursor:pointer;padding:0 10px}'
    + '.admin-content>section.pt-card>h2{padding-inline-end:56px;cursor:pointer}'
    + '.admin-content>section.pt-card.pt-closed>:not(h2):not(.pt-toggle){display:none!important}'
    + '.admin-content>section.pt-card.pt-closed{padding-bottom:1rem}'
    + '.pt-bar{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin:4px 0 8px;font-size:13px}'
    + '.pt-bar button{min-height:44px;padding:6px 12px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font:inherit;cursor:pointer}'
  function style() { if (document.getElementById('pt-css')) return; var s = document.createElement('style'); s.id = 'pt-css'; s.textContent = CSS; document.head.appendChild(s) }

  function titleOf(sec) { var h = sec.querySelector(':scope > h2'); return h ? h.textContent.trim() : '' }
  function setOpen(sec, isOpen, remember) {
    sec.classList.toggle('pt-closed', !isOpen)
    var b = sec.querySelector(':scope > .pt-toggle')
    if (b) { b.setAttribute('aria-expanded', isOpen ? 'true' : 'false'); b.textContent = isOpen ? 'Hide' : 'Show' }
    if (remember) { var m = load(); var k = titleOf(sec); if (isOpen) delete m[k]; else m[k] = 1; save(m) }
  }
  function dress(sec) {
    if (sec.classList.contains('pt-card')) return
    var h = sec.querySelector(':scope > h2'); if (!h || !titleOf(sec)) return
    if (sec.closest('[data-spseo], [data-spsetup], [data-spps]')) return   // the overlay screens keep their own layout
    sec.classList.add('pt-card')
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pt-toggle'
    b.setAttribute('aria-label', 'Show or hide ' + titleOf(sec))
    b.addEventListener('click', function (e) { e.stopPropagation(); setOpen(sec, sec.classList.contains('pt-closed'), true) })
    h.addEventListener('click', function (e) { if (e.target.closest('a, button, input')) return; setOpen(sec, sec.classList.contains('pt-closed'), true) })
    h.insertAdjacentElement('afterend', b)
    setOpen(sec, !load()[titleOf(sec)], false)
    // A refusal or a note must never be behind a fold. A folded card's body is display:none, so nothing in
    // it can take focus — the thing that can still change it is a SAVE pressed from the save bar, whose
    // result is written into the card's note. Any text change inside a folded card opens it.
    new MutationObserver(function (ms) {
      if (!sec.classList.contains('pt-closed')) return
      var toggle = sec.querySelector(':scope > .pt-toggle')
      if (ms.some(function (m) { return m.target !== sec && !(toggle && toggle.contains(m.target)) })) setOpen(sec, true, false)   // the toggle's own Show/Hide label is not a note
    }).observe(sec, { childList: true, characterData: true, subtree: true })
  }
  function bar(host, cards) {
    var old = host.querySelector(':scope > .pt-bar')
    if (cards.length < 3) { if (old) old.remove(); return }
    if (old) return
    var w = document.createElement('div'); w.className = 'pt-bar'; w.setAttribute('data-pt-bar', '1')
    var all = function (isOpen) { host.querySelectorAll(':scope > section.pt-card').forEach(function (s) { setOpen(s, isOpen, true) }) }
    var c = document.createElement('button'); c.type = 'button'; c.textContent = 'Collapse all'; c.addEventListener('click', function () { all(false) })
    var o = document.createElement('button'); o.type = 'button'; o.textContent = 'Expand all'; o.addEventListener('click', function () { all(true) })
    w.appendChild(c); w.appendChild(o)
    var first = cards[0]; first.parentNode.insertBefore(w, first)
  }
  var t = null
  function pass() {
    var host = document.querySelector('.admin-content'); if (!host) return
    style()
    var cards = [].slice.call(host.querySelectorAll(':scope > section'))
    cards.forEach(dress)
    bar(host, cards.filter(function (s) { return s.classList.contains('pt-card') }))
  }
  new MutationObserver(function (ms) {
    // Only when a section arrives or leaves: a timer that restarts on every mutation starves on a busy screen.
    var relevant = ms.some(function (m) { return [].some.call(m.addedNodes, function (n) { return n.nodeType === 1 && (n.tagName === 'SECTION' || n.querySelector && n.querySelector('section')) }) || [].some.call(m.removedNodes, function (n) { return n.nodeType === 1 }) })
    if (!relevant) return
    clearTimeout(t); t = setTimeout(pass, 120)
  }).observe(document.body, { childList: true, subtree: true })
  pass()
})()
