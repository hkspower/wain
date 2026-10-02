/**
 * Phone and desktop theme, on the website's /backends Settings screen.
 * Asked for 2026-10-02: a separate setup per device for the colours, the fonts
 * and the custom CSS.
 *
 * The theme row keeps the all-devices values at its top level, and two optional
 * overrides: `phone` (below 768px) and `desktop` (768px and up), the same
 * breakpoints as sporta-mobile.css and sporta-desktop.css. An EMPTY field means
 * "same as all devices". theme.js wraps each override in its @media block,
 * after the all-devices rules, so it wins on its device only.
 *
 * The save sends ONE device's object and nothing else that it could get wrong:
 * the rest of the row is resent as read, and the OTHER device is left out —
 * admin.php keeps a device it is not sent. The card is built once and never
 * re-rendered, so a refused save cannot wipe what was typed.
 */
(function () {
  'use strict'

  var DEVICES = [
    { key: 'phone', label: 'Phone' },
    { key: 'desktop', label: 'Desktop' },
  ]
  var COLOURS = [
    ['brand', 'Brand'], ['header_bg', 'Header bar'], ['tabbar_bg', 'Tab bar'],
    ['tabbar_active', 'Tab bar — current item'], ['secondary_bg', 'Secondary button'],
    ['page_bg', 'Page background'],
  ]
  var FONTS = [['font_head', 'Heading font'], ['font_body', 'Body font']]

  var card = null, loaded = null, busy = false, current = 'phone'

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }
  function hex6(v) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim())
    return m ? '#' + m[1].toLowerCase() : ''
  }
  function dev(t, k) {
    var o = t && t[k]
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  }
  function box(d, k) { return card.querySelector('[data-sdt="' + d + ':' + k + '"]') }
  function note(text, bad) {
    var n = card && card.querySelector('.sdt-note')
    if (n) { n.textContent = text || ''; n.className = 'sdt-note' + (bad ? ' sdt-bad' : '') }
  }

  function field(d, k, label, kind) {
    var w = el('label', 'sdt-row')
    w.appendChild(el('span', 'sdt-label', label))
    var c = el('span', 'sdt-controls')
    var input
    if (kind === 'css') {
      input = document.createElement('textarea')
      input.rows = 6
      input.spellcheck = false
    } else {
      input = document.createElement('input')
      input.type = 'text'
      input.autocomplete = 'off'
      input.spellcheck = false
      if (kind === 'hex') {
        input.maxLength = 7
        input.placeholder = 'Same as all devices'
        var pick = document.createElement('input')
        pick.type = 'color'
        pick.className = 'sdt-pick'
        pick.setAttribute('aria-label', label + ' colour picker')
        pick.addEventListener('input', function () { input.value = pick.value })
        input.addEventListener('input', function () { var v = hex6(input.value); if (v) pick.value = v })
        c.appendChild(pick)
      } else {
        input.maxLength = 40
        input.placeholder = 'Same as all devices'
      }
    }
    input.className = 'sdt-input'
    input.dataset.sdt = d + ':' + k
    c.appendChild(input)
    w.appendChild(c)
    return w
  }

  function build() {
    card.textContent = ''
    card.appendChild(el('h3', 'sdt-h', 'Phone and desktop'))
    card.appendChild(el('p', 'sdt-sub', 'Empty = all devices.'))
    var tabs = el('div', 'sdt-tabs')
    tabs.setAttribute('role', 'tablist')
    DEVICES.forEach(function (d) {
      var b = el('button', 'sdt-tab', d.label)
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.dataset.tab = d.key
      b.addEventListener('click', function () { show(d.key) })
      tabs.appendChild(b)
    })
    card.appendChild(tabs)
    DEVICES.forEach(function (d) {
      var p = el('div', 'sdt-pane')
      p.dataset.pane = d.key
      p.setAttribute('role', 'tabpanel')
      COLOURS.forEach(function (c) { p.appendChild(field(d.key, c[0], c[1], 'hex')) })
      FONTS.forEach(function (f) { p.appendChild(field(d.key, f[0], f[1], 'font')) })
      p.appendChild(field(d.key, 'css', d.label + ' only CSS', 'css'))
      var save = el('button', 'sdt-save', 'Save ' + d.label.toLowerCase())
      save.type = 'button'
      save.dataset.save = d.key
      save.addEventListener('click', function () { submit(d.key) })
      p.appendChild(save)
      card.appendChild(p)
    })
    card.appendChild(el('p', 'sdt-note', ''))
    show(current)
  }

  function show(k) {
    current = k
    card.querySelectorAll('[data-tab]').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === k ? 'true' : 'false')
    })
    card.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.dataset.pane !== k })
  }

  function fill() {
    DEVICES.forEach(function (d) {
      var o = dev(loaded, d.key)
      COLOURS.concat(FONTS).concat([['css']]).forEach(function (f) {
        var b = box(d.key, f[0])
        b.value = String(o[f[0]] || '')
        var pick = b.previousElementSibling
        if (pick && pick.type === 'color' && hex6(b.value)) pick.value = hex6(b.value)
      })
    })
  }

  function submit(d) {
    if (busy || !loaded) return
    var o = {}, bad = null
    COLOURS.forEach(function (c) {
      var raw = box(d, c[0]).value.trim()
      if (!raw) return
      var v = hex6(raw)
      if (!v) { bad = bad || c[1]; return }
      o[c[0]] = v
    })
    FONTS.forEach(function (f) { var v = box(d, f[0]).value.trim(); if (v) o[f[0]] = v })
    var css = box(d, 'css').value
    if (css.trim()) o.css = css
    if (bad) { note(bad + ' must be a colour like #e0561c, or empty.', true); return }

    var value = {}
    Object.keys(loaded).forEach(function (k) { value[k] = loaded[k] })
    delete value.phone
    delete value.desktop
    value[d] = o

    var save = card.querySelector('[data-save="' + d + '"]')
    busy = true
    save.disabled = true
    note('Saving…')
    fetch('/api/admin.php?r=settings_save', {
      method: 'POST',
      headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name: 'theme', value: value }),
    }).then(function (r) {
      return r.json().catch(function () { return { error: 'bad_response' } })
    }).then(function (res) {
      busy = false
      save.disabled = false
      if (res && res.error) { note(explain(res.error), true); return }
      loaded = res
      note('Saved. Reload the shop to see it.')
    }).catch(function () {
      busy = false
      save.disabled = false
      note('The save did not reach the shop. Nothing was changed.', true)
    })
  }

  function explain(err) {
    var s = String(err || '')
    var m = /^invalid_theme_(phone|desktop)_(.+)$/.exec(s)
    if (m) return 'The shop refused ' + m[2].replace(/_/g, ' ') + ' for ' + m[1] + '.'
    if (s === 'not_signed_in') return 'Your session has ended. Sign in again.'
    return s
  }

  function load() {
    fetch('/api/api.php?r=theme', { credentials: 'omit', cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (t) {
        if (!t || typeof t !== 'object') throw new Error('no theme')
        loaded = t
        fill()
      })
      .catch(function () { note('Could not read the theme, so saving is off.', true) })
  }

  function settingsHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim() === 'Settings') return hs[i]
    return null
  }

  var CSS = ''
    + '.sdt{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;background:var(--card,rgba(255,255,255,.03))}'
    + '.sdt-h{margin:0 0 4px;font-size:16px}'
    + '.sdt-sub{margin:0 0 14px;opacity:.7;font-size:13px}'
    + '.sdt-tabs{display:flex;gap:8px;margin-bottom:8px}'
    + '.sdt-tab{min-height:44px;padding:0 18px;border-radius:999px;border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font:inherit;cursor:pointer}'
    + '.sdt-tab[aria-selected=true]{background:var(--brand,#e0561c);border-color:transparent;color:#fff}'
    + '.sdt-row{display:block;padding:10px 0;border-top:1px solid var(--border,#2a2d31)}'
    + '.sdt-label{display:block;font-size:14px;font-weight:600;margin-bottom:6px}'
    + '.sdt-controls{display:flex;gap:8px;align-items:center}'
    + '.sdt-pick{width:44px;height:44px;padding:0;border:1px solid var(--border,#2a2d31);border-radius:8px;background:transparent;flex:none}'
    + '.sdt-input{min-height:44px;width:100%;max-width:320px;padding:8px 10px;border-radius:8px;font-size:16px;border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font-family:inherit;box-sizing:border-box}'
    + 'textarea.sdt-input{max-width:100%;font-family:ui-monospace,monospace}'
    + '.sdt-save{min-height:44px;margin-top:14px;padding:9px 16px;border-radius:8px;border:0;cursor:pointer;background:var(--brand,#e0561c);color:#fff;font:inherit;font-weight:600}'
    + '.sdt-save[disabled]{opacity:.5}'
    + '.sdt-note{margin:12px 0 0;font-size:13px}.sdt-bad{color:#ff8a80}'

  var placing = false
  function place() {
    if (placing) return
    var head = settingsHeading()
    if (!head) {
      if (card && card.parentNode) { placing = true; card.parentNode.removeChild(card); card = null; placing = false }
      return
    }
    if (card && card.parentNode) return
    placing = true
    if (!document.getElementById('sdt-css')) {
      var s = document.createElement('style')
      s.id = 'sdt-css'
      s.textContent = CSS
      document.head.appendChild(s)
    }
    card = el('div', 'sdt')
    // Directly under the all-devices colours when that card is there.
    var after = document.querySelector('.stc') || head.parentNode
    after.parentNode.insertBefore(card, after.nextSibling)
    placing = false
    loaded = null
    busy = false
    build()
    load()
  }

  var timer = null
  new MutationObserver(function () {
    clearTimeout(timer)
    timer = setTimeout(place, 120)
  }).observe(document.body, { childList: true, subtree: true })
  place()
})()
