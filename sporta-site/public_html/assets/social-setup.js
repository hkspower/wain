/**
 * The website panel's SOCIAL MEDIA card (2026-10-01): where the owner sets the profile links the
 * footer icons point at — Instagram, Snapchat, YouTube, TikTok and WhatsApp Business.
 *
 * An overlay for the same reason as panel-settings.js and rules.js: /backends is a prebuilt bundle
 * with no source here, so this adds a card to the Settings screen and touches nothing else. It
 * needs no credential of its own — it runs on the shop's origin inside the panel, so the session
 * cookie is already there.
 *
 * READ FROM THE PUBLIC ROUTE, WRITTEN THROUGH settings_save: api.php?r=social is the one place the
 * footer and this card read the links from, so what the owner sees here cannot disagree with what
 * a customer sees. The server normalises what is typed (a handle becomes the full https link, a
 * link to some other site is refused by name), so after a save the boxes are refilled from the
 * server's answer and show what was actually kept.
 *
 * The typed text survives a refusal: the inputs ARE the state, and a refusal only sets the note.
 */
(function () {
  'use strict'

  var MARK = 'data-sporta-panel'
  var API = '/api/api.php?r='
  var ADMIN = '/api/admin.php?r='

  var NETWORKS = [
    ['instagram', 'Instagram', 'Link or handle'],
    ['snapchat', 'Snapchat', 'Link or username'],
    ['youtube', 'YouTube', 'Link or @handle'],
    ['tiktok', 'TikTok', 'Link or handle'],
    ['whatsapp', 'WhatsApp Business', 'wa.me link or number'],
  ]

  var card = null, note = null, fields = {}, loaded = null

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function post(route, body) {
    return fetch(ADMIN + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().catch(function () { return { error: 'bad_response' } }) })
  }

  function explain(err) {
    var s = String(err || '')
    var m = /^invalid_(instagram|snapchat|youtube|tiktok|whatsapp)$/.exec(s)
    if (m) {
      var name = { instagram: 'Instagram', snapchat: 'Snapchat', youtube: 'YouTube', tiktok: 'TikTok', whatsapp: 'WhatsApp' }[m[1]]
      return m[1] === 'whatsapp'
        ? 'That WhatsApp link or number could not be read. Use a wa.me or wa.link address, or the number with its country code (96522091914).'
        : 'That is not a ' + name + ' link. Paste the profile address from ' + name + ' itself, or just the handle — a link to any other site is refused so the footer icon can never lead somewhere else.'
    }
    if (s === 'not_signed_in') return 'Your session has ended. Sign in again.'
    if (s === 'bad_request') return 'The panel sent something the shop did not understand.'
    return s
  }

  function say(text, good) {
    if (!note) return
    note.textContent = text || ''
    note.style.color = text ? (good ? '#15803d' : '#b91c1c') : ''
  }

  function fill(c) {
    NETWORKS.forEach(function (n) { if (fields[n[0]]) fields[n[0]].value = c && c[n[0]] ? String(c[n[0]]) : '' })
  }

  function values() {
    var o = {}
    NETWORKS.forEach(function (n) { o[n[0]] = fields[n[0]] ? fields[n[0]].value.trim() : '' })
    return o
  }

  function fetchSocial(quiet) {
    fetch(API + 'social', { headers: { Accept: 'application/json' }, credentials: 'include', cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (c) { if (c && typeof c === 'object') { loaded = c; fill(c); if (!quiet) say('', true) } })
      .catch(function () { if (!quiet) say('Could not read the current links.', false) })
  }

  function save(btn) {
    say('Saving…', true)
    btn.disabled = true
    post('settings_save', { name: 'social', value: values() }).then(function (res) {
      btn.disabled = false
      if (res && res.error) { say(explain(res.error), false); return }
      fetchSocial(true)
      say('Saved. The footer icons update on the next page load.', true)
    }).catch(function () {
      btn.disabled = false
      say('The save did not reach the shop. Check the connection and try again.', false)
    })
  }

  var CSS = ''
    + '.ssu{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;background:var(--sp-pc-bg,#2d3034);color:var(--sp-pc-ink,#eaecee)}'
    + '.ssu-h{margin:0 0 4px;font-size:16px;font-weight:700;color:var(--sp-pc-ink,#eaecee)}'
    + '.ssu-sub{margin:0 0 14px;color:var(--sp-pc-muted,#a6adb5);font-size:13px;line-height:1.5}'
    + '.ssu-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}'
    + '.ssu-field{display:flex;flex-direction:column;gap:4px}'
    + '.ssu-label{font-size:13px;font-weight:600;color:var(--sp-pc-ink,#eaecee)}'
    + '.ssu-hint{font-size:12px;color:var(--sp-pc-muted,#a6adb5);line-height:1.4}'
    + '.ssu-input{padding:8px 10px;min-height:40px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);'
    + 'background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font:inherit}'
    + '.ssu-foot{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;align-items:center}'
    + '.ssu-save{padding:9px 16px;min-height:44px;border-radius:8px;border:0;cursor:pointer;background:#4f46e5;color:#fff;font:inherit;font-weight:700}'
    + '.ssu-save[disabled]{opacity:.5;cursor:default}'
    + '.ssu-undo{padding:9px 16px;min-height:44px;border-radius:8px;cursor:pointer;font:inherit;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee)}'
    + '.ssu-note{margin:0;font-size:13px;line-height:1.5}'

  function style() {
    if (document.getElementById('ssu-css')) return
    var s = document.createElement('style')
    s.id = 'ssu-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  function build() {
    var c = el('section', 'ssu')
    c.setAttribute(MARK, 'social')
    c.appendChild(el('h2', 'ssu-h', 'Social media'))
    c.appendChild(el('p', 'ssu-sub',
      'The footer icons.'))
    var grid = el('div', 'ssu-grid')
    fields = {}
    NETWORKS.forEach(function (n) {
      var w = el('div', 'ssu-field')
      var id = 'ssu-' + n[0]
      var l = el('label', 'ssu-label', n[1]); l.htmlFor = id
      var i = el('input', 'ssu-input'); i.id = id; i.type = 'text'; i.autocomplete = 'off'; i.setAttribute('inputmode', 'url'); i.spellcheck = false
      i.setAttribute('dir', 'ltr')
      fields[n[0]] = i
      w.appendChild(l); w.appendChild(i); w.appendChild(el('p', 'ssu-hint', n[2]))
      grid.appendChild(w)
    })
    c.appendChild(grid)
    var foot = el('div', 'ssu-foot')
    var saveBtn = el('button', 'ssu-save', 'Save social media links'); saveBtn.type = 'button'
    saveBtn.addEventListener('click', function () { save(saveBtn) })
    var undo = el('button', 'ssu-undo', 'Undo my edits'); undo.type = 'button'
    undo.addEventListener('click', function () { if (loaded) { fill(loaded); say('Back to what is saved.', true) } })
    note = el('p', 'ssu-note', '')
    foot.appendChild(saveBtn); foot.appendChild(undo); foot.appendChild(note)
    c.appendChild(foot)
    return c
  }

  function settingsHeading() {
    var hs = document.querySelectorAll('h1, h2')
    for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim() === 'Settings') return hs[i]
    return null
  }

  var busy = false
  function place() {
    if (busy) return
    if (!/^\/backends(\/|$)/.test(location.pathname)) return
    var head = settingsHeading()
    if (!head) {
      if (card && card.parentNode) { busy = true; card.parentNode.removeChild(card); card = null; note = null; busy = false }
      return
    }
    busy = true
    if (!card || !card.parentNode) {
      style()
      card = build()
      // after the Contact details card when there is one, else straight under the heading
      var contact = document.querySelector('[' + MARK + '="contact"]')
      var anchor = contact || head.parentNode
      anchor.parentNode.insertBefore(card, anchor.nextSibling)
      loaded = null
      fetchSocial(false)
    }
    busy = false
  }

  var timer = null
  new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(place, 120) })
    .observe(document.body, { childList: true, subtree: true })
  place()
})()
