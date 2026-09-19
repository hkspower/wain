/**
 * One save button for the Settings screen, always within reach.
 *
 * WHAT IS WRONG WITHOUT IT, measured in a browser at 1280x900 rather than
 * argued: the Settings screen is 5,753px tall — six and a half screenfuls —
 * and carries EIGHT separate save buttons, one at the foot of each card:
 *
 *     Payment setup        h2 at  442     Save                at  944
 *     Contact details      h2 at 1250     Save contact details at 1619
 *     Site wording         h3 at 2305     Save wording         at 2491
 *     Buttons and bars     h3 at 2628     Save colours         at 3509
 *     More emails          h3 at 3646     Save emails          at 3888
 *     Shop rules           h3 at 4013     Save rules           at 4649
 *     Policy pages         h2 at 5189     Save policy pages    at 5611
 *
 * "Buttons and bars" is the one that shows it: its heading and its save button
 * are 881px apart, so the control that commits a colour is a whole screenful
 * below the colour you just picked, with four other save buttons between here
 * and there that are not the one you want. That is not a matter of taste — it
 * is a control you cannot see from the thing it acts on.
 *
 * IT SAVES ONLY WHAT YOU TOUCHED, and that is the rule the whole design hangs
 * on rather than a nicety. CLAUDE.md records why the rules card READS through
 * `admin.php?r=rules` instead of saving an empty body: "reading by writing
 * would mean opening the settings screen rewrites the row, so a panel opened
 * and closed would look in any audit like a deliberate change." A bar that
 * pressed all eight saves would do exactly that, eight rows at a time, and
 * activity-log.js would faithfully record every one of them as an edit. So a
 * card is saved only after something inside it was actually typed, picked or
 * ticked.
 *
 * IT PRESSES EACH CARD'S OWN BUTTON. It has no save code of its own, sends no
 * request and knows no route. Every card's validation, its refusal messages,
 * its busy state and its note all go on being that card's — this only clicks
 * what the owner would have clicked. This repository has already shipped a
 * SECOND checkbox beside a working one and had to delete it; a second save
 * path would be that mistake with money attached, because two ways to write a
 * settings row is two ways for them to disagree.
 *
 * IT FINDS THE CARDS BY THEIR BUTTONS, not by a marker. Only two of the seven
 * cards set a `data-sporta-*` attribute — checked, not assumed — so keying off
 * one would have covered two cards and silently ignored five. A card here is
 * the smallest ancestor of a save button that contains no OTHER save button,
 * which is a property of the page rather than a list this file has to be told.
 *
 * ADMIN-ONLY AND SETTINGS-ONLY. It is mounted from the Settings heading, the
 * same anchor every other card on this screen uses, and removed the moment the
 * panel swaps that heading out — including on the sign-in screen, where a bar
 * offering to save anything would be absurd.
 */
(function () {
  'use strict'

  var MARK = 'data-sporta-savebar'
  var bar = null
  var cards = []          // [{ root, button, title }]
  var dirty = []          // roots, in the order they were first touched
  var saving = false

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  /** The Settings screen, and only it. The panel swaps its content in place,
   *  so this has to be answered again after every render — hence the observer.
   *  Same shape as contact-emails.js, deliberately: one way to ask. */
  function settingsHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Settings') return hs[i]
    }
    return null
  }

  /** A save button is one whose label STARTS with "save" — "Saved." is a note
   *  a card writes into its own button after a successful write, and treating
   *  that as a control would leave the bar pressing a button that has already
   *  done its work. Our own is excluded by its attribute rather than by its
   *  label, so renaming it cannot make the bar find itself. */
  function isSaveButton(b) {
    if (b.hasAttribute(MARK)) return false
    if (b.offsetParent === null) return false        // hidden cards do not count
    var t = b.textContent.trim().toLowerCase()
    return t.indexOf('save') === 0 && t.indexOf('saved') !== 0
  }

  /** The smallest ancestor of $btn holding no other save button. Climbing
   *  stops at .admin-content, which holds all of them and is therefore never
   *  a card. */
  function cardOf(btn, all) {
    var node = btn.parentNode
    var best = btn.parentNode
    while (node && node !== document.body && !/(^|\s)admin-content(\s|$)/.test(node.className || '')) {
      var others = 0
      for (var i = 0; i < all.length; i++) {
        if (all[i] !== btn && node.contains(all[i])) others++
      }
      if (others > 0) break
      best = node
      node = node.parentNode
    }
    return best
  }

  /** What to call the card in the bar. Its own heading if it has one — the
   *  owner is looking at that word — and the button's label if it does not. */
  function titleOf(root, btn) {
    var h = root.querySelector('h2, h3')
    if (h && h.textContent.trim()) return h.textContent.trim()
    return btn.textContent.trim()
  }

  function discover() {
    var host = document.querySelector('.admin-content')
    if (!host) { cards = []; return }
    var all = []
    var buttons = host.querySelectorAll('button')
    for (var i = 0; i < buttons.length; i++) {
      if (isSaveButton(buttons[i])) all.push(buttons[i])
    }
    var found = []
    for (var j = 0; j < all.length; j++) {
      found.push({ root: cardOf(all[j], all), button: all[j], title: titleOf(cardOf(all[j], all), all[j]) })
    }
    cards = found
    // A card that has gone (the panel re-rendered) must not stay on the dirty
    // list holding a detached button the bar would click into nothing.
    dirty = dirty.filter(function (root) { return document.contains(root) })
  }

  function cardFor(node) {
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].root.contains(node)) return cards[i]
    }
    return null
  }

  function entryFor(root) {
    for (var i = 0; i < cards.length; i++) if (cards[i].root === root) return cards[i]
    return null
  }

  function markDirty(node) {
    var c = cardFor(node)
    if (!c) return
    if (dirty.indexOf(c.root) === -1) dirty.push(c.root)
    render()
  }

  function markClean(root) {
    var i = dirty.indexOf(root)
    if (i !== -1) dirty.splice(i, 1)
    render()
  }

  /* ------------------------------------------------------------ the bar */

  var CSS = ''
    + '.spsb{position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;align-items:center;'
    + 'gap:12px;flex-wrap:wrap;padding:12px 16px;box-sizing:border-box;'
    + 'background:var(--sp-pc-bg,#1b1d20);color:inherit;'
    + 'border-top:1px solid var(--sp-pc-border,#494e54);'
    + 'box-shadow:0 -6px 24px rgba(0,0,0,.28)}'
    + '.spsb[hidden]{display:none}'
    + '.spsb-what{flex:1 1 auto;min-width:160px;font-size:13px;line-height:1.5}'
    + '.spsb-what b{font-weight:700}'
    + '.spsb-go{padding:11px 18px;min-height:44px;border-radius:8px;border:0;cursor:pointer;'
    + 'background:var(--brand,#e0561c);color:#fff;font:inherit;font-weight:700}'
    + '.spsb-go[disabled]{opacity:.5;cursor:default}'
    // The screen must be able to scroll far enough that the last card's own
    // save button is not left underneath the bar — a fixed bar that covers the
    // control it duplicates would have made the original fault worse at the
    // bottom of the page while fixing it everywhere else.
    + '.admin-content.spsb-room{padding-bottom:96px}'

  function style() {
    if (document.getElementById('spsb-css')) return
    var s = el('style')
    s.id = 'spsb-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  function build() {
    var b = el('div', 'spsb')
    b.setAttribute(MARK, '1')
    b.setAttribute('role', 'region')
    b.setAttribute('aria-label', 'Unsaved changes')
    var what = el('p', 'spsb-what')
    var go = el('button', 'spsb-go', 'Save changes')
    go.type = 'button'
    go.setAttribute(MARK, '1')
    go.addEventListener('click', saveAll)
    b.appendChild(what)
    b.appendChild(go)
    b._what = what
    b._go = go
    return b
  }

  function render() {
    if (!bar) return
    var n = dirty.length
    bar.hidden = n === 0 && !saving
    document.querySelector('.admin-content') &&
      document.querySelector('.admin-content').classList.toggle('spsb-room', !bar.hidden)
    if (bar.hidden) return
    if (saving) return                       // saveAll writes its own progress
    var names = []
    for (var i = 0; i < dirty.length; i++) {
      var e = entryFor(dirty[i])
      if (e) names.push(e.title)
    }
    bar._what.textContent = n === 1
      ? 'Unsaved changes in ' + names[0] + '.'
      : 'Unsaved changes in ' + n + ' cards: ' + names.join(', ') + '.'
    bar._go.disabled = false
    bar._go.textContent = n === 1 ? 'Save changes' : 'Save all ' + n
  }

  /** Press each dirty card's OWN button, one at a time.
   *
   *  ONE AT A TIME because every one of these is an admin write and admin.php
   *  rations writes per IP — firing seven at once is the shape this repository
   *  has twice mistaken for a broken feature when it was the limiter answering.
   *  The gap is generous for the same reason. */
  function saveAll() {
    if (saving || !dirty.length) return
    saving = true
    var queue = dirty.slice()
    var total = queue.length
    var done = 0
    bar._go.disabled = true

    function step() {
      if (!queue.length) {
        saving = false
        bar._what.textContent = 'Saved ' + total + (total === 1 ? ' card.' : ' cards.')
        bar._go.disabled = false
        // Held for a moment so the owner sees it, then the bar goes away —
        // unless they have started editing again, which render() decides.
        setTimeout(function () { if (!saving) render() }, 2500)
        return
      }
      var root = queue.shift()
      var entry = entryFor(root)
      markClean(root)
      done++
      if (entry && document.contains(entry.button)) {
        bar._what.textContent = 'Saving ' + done + ' of ' + total + ' — ' + entry.title + '…'
        entry.button.click()
      }
      setTimeout(step, 700)
    }
    step()
  }

  /* -------------------------------------------------------- mount / watch */

  var placing = false
  function place() {
    if (placing) return
    placing = true
    try {
      var head = settingsHeading()
      if (!head) {
        if (bar && bar.parentNode) bar.parentNode.removeChild(bar)
        bar = null
        cards = []
        dirty = []
        var host = document.querySelector('.admin-content')
        if (host) host.classList.remove('spsb-room')
        return
      }
      style()
      if (!bar || !document.contains(bar)) {
        bar = build()
        bar.hidden = true
        document.body.appendChild(bar)
      }
      discover()
      render()
    } finally {
      placing = false
    }
  }

  var timer = null
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(place, 150)
  }

  function start() {
    // Capture phase, on the document, so a card that stops propagation inside
    // itself cannot hide an edit from the bar.
    document.addEventListener('input', function (e) { markDirty(e.target) }, true)
    document.addEventListener('change', function (e) { markDirty(e.target) }, true)
    // Pressing a card's own button is still the ordinary way to save one card,
    // and it must clear that card here or the bar would go on offering to save
    // something already saved.
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button') : null
      if (!b || b.hasAttribute(MARK)) return
      for (var i = 0; i < cards.length; i++) {
        if (cards[i].button === b) { markClean(cards[i].root); return }
      }
    }, true)

    place()
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
