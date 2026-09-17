/**
 * The WEBSITE panel's Settings screen: an editor for Privacy, Terms and
 * Returns, which had none.
 *
 * WHY AN OVERLAY. Same pattern as panel-settings.js, rules.js and
 * custom-css.js on this same screen: add a card, touch nothing that exists.
 * It needs no credential of its own — it runs on the shop's origin inside
 * the panel, so the session cookie is already there.
 *
 * WHAT IT EDITS. One `legal` settings row, six fields — privacy/terms/
 * returns, each in English and Arabic — read back from ?r=legal (public,
 * cacheable, the same route legal-pages.js reads) and saved through
 * admin.php's settings_save. Privacy and Terms are PLAIN PARAGRAPH TEXT,
 * split on blank lines by legal-pages.js; Returns is a single paragraph, so
 * its two boxes are single-line inputs rather than a textarea — typing a
 * blank line into it would do nothing, since there is nowhere for a second
 * paragraph to go on that page.
 *
 * EMPTY MEANS "USE THE SHOP'S BUILT-IN TEXT", the same rule contact and
 * footer already follow on this screen. Clearing a box is not a mistake to
 * warn about; it is the way back from an edit that turned out wrong.
 *
 * "Open the page in a new tab to see it" — same note custom-css.js already
 * gives, and for the same reason: this card writes the setting, it does not
 * preview it, and a screen that tried to render Arabic and English body
 * copy inline would be a second copy of legal-pages.js's own logic.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var PUB = '/api/api.php?r='
  var MARK = 'data-sporta-legal-panel'

  var card = null
  var note = null
  var fields = {}
  var loaded = null

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function post(route, body) {
    return fetch(API + route, {
      method: 'POST',
      headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return { error: 'bad_response' } })
    })
  }

  function explain(err) {
    var s = String(err || '')
    if (/_too_long$/.test(s)) return 'That field is too long — twenty thousand characters is the limit, well past a full page of text.'
    if (/_has_markup$/.test(s)) return 'That field contains "</" — not allowed, so nothing typed here can ever close a tag on the page.'
    if (/_has_nul$/.test(s)) return 'That field contains a character the shop refuses to store.'
    if (s === 'not_signed_in') return 'Your session has ended. Sign in again.'
    if (s === 'bad_request') return 'The panel sent something the shop did not understand.'
    if (s === 'bad_response') return 'The shop answered with something that was not an answer.'
    return s
  }

  // key, label, hint, textarea?
  var FIELDS = [
    ['privacy_en', 'Privacy — English',
      'Replaces everything below "Last updated" on /privacy. Paragraphs: leave a blank line between them.', true],
    ['privacy_ar', 'Privacy — Arabic', '', true],
    ['terms_en', 'Terms & conditions — English',
      'Replaces everything below "Last updated" on /terms. Paragraphs: leave a blank line between them.', true],
    ['terms_ar', 'Terms & conditions — Arabic', '', true],
    ['returns_en', 'Returns — English',
      'The one paragraph above the order-lookup box on /returns. A single line — the rest of that page (order lookup, sizes) is not text and stays as it is.', false],
    ['returns_ar', 'Returns — Arabic', '', false],
  ]

  function say(text, good) {
    if (!note) return
    note.textContent = text || ''
    note.style.color = text ? (good ? '#15803d' : '#b91c1c') : ''
  }

  function values() {
    var out = {}
    for (var i = 0; i < FIELDS.length; i++) {
      var k = FIELDS[i][0]
      out[k] = fields[k] ? fields[k].value.trim() : ''
    }
    return out
  }

  function save(btn) {
    say('Saving…', true)
    btn.disabled = true
    post('settings_save', { name: 'legal', value: values() }).then(function (res) {
      btn.disabled = false
      if (res && res.error) { say(explain(res.error), false); return }
      loaded = res
      fill(res)
      say('Saved. Open /privacy, /terms or /returns in a new tab to see it — this page does not apply it.', true)
    }).catch(function () {
      btn.disabled = false
      say('The save did not reach the shop. Check the connection and try again.', false)
    })
  }

  function fill(t) {
    for (var i = 0; i < FIELDS.length; i++) {
      var k = FIELDS[i][0]
      if (fields[k]) fields[k].value = t && t[k] != null ? String(t[k]) : ''
    }
  }

  function fetchLegal(quiet) {
    fetch(PUB + 'legal', { headers: { Accept: 'application/json' }, credentials: 'include' })
      .then(function (r) { return r.json() })
      .then(function (t) {
        if (!t || typeof t !== 'object') return
        loaded = t
        fill(t)
        if (!quiet) say('', true)
      })
      .catch(function () { if (!quiet) say('Could not read the current text.', false) })
  }

  /* -------------------------------------------------------------- chrome --- */

  var CSS = ''
    + '.sle{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;background:var(--sp-pc-bg,#2d3034);color:var(--sp-pc-ink,#eaecee)}'
    + '.sle-h{margin:0 0 4px;font-size:16px;font-weight:700;color:var(--sp-pc-ink,#eaecee)}'
    + '.sle-sub{margin:0 0 14px;color:var(--sp-pc-muted,#a6adb5);font-size:13px;line-height:1.5}'
    + '.sle-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}'
    + '.sle-field{display:flex;flex-direction:column;gap:4px}'
    + '.sle-label{font-size:13px;font-weight:600;color:var(--sp-pc-ink,#eaecee)}'
    + '.sle-hint{font-size:12px;color:var(--sp-pc-muted,#a6adb5);line-height:1.4}'
    + '.sle-input,.sle-area{padding:8px 10px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);'
    + 'background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font:inherit}'
    + '.sle-area{min-height:120px;resize:vertical;font-family:inherit}'
    + '.sle-foot{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;align-items:center}'
    + '.sle-save{padding:9px 16px;border-radius:8px;border:0;cursor:pointer;'
    + 'background:#4f46e5;color:#fff;font:inherit;font-weight:700}'
    + '.sle-save[disabled]{opacity:.5;cursor:default}'
    + '.sle-undo{padding:9px 16px;border-radius:8px;cursor:pointer;font:inherit;'
    + 'border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee)}'
    + '.sle-note{margin:0;font-size:13px;line-height:1.5}'

  function style() {
    if (document.getElementById('sle-css')) return
    var s = document.createElement('style')
    s.id = 'sle-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  function build() {
    var c = el('section', 'sle')
    c.setAttribute(MARK, '1')
    c.appendChild(el('h2', 'sle-h', 'Policy pages'))
    c.appendChild(el('p', 'sle-sub',
      'Privacy, Terms & conditions and Returns. Leave a field empty to keep '
      + 'the shop’s built-in text — nothing here reaches a customer’s record.'))

    var grid = el('div', 'sle-grid')
    fields = {}
    for (var i = 0; i < FIELDS.length; i++) {
      var k = FIELDS[i][0]
      var isArea = FIELDS[i][3]
      var wrap = el('div', 'sle-field')
      wrap.appendChild(el('label', 'sle-label', FIELDS[i][1]))
      var input = el(isArea ? 'textarea' : 'input', isArea ? 'sle-area' : 'sle-input')
      if (!isArea) input.type = 'text'
      input.autocomplete = 'off'
      if (/_ar$/.test(k)) input.dir = 'rtl'
      fields[k] = input
      wrap.appendChild(input)
      if (FIELDS[i][2]) wrap.appendChild(el('p', 'sle-hint', FIELDS[i][2]))
      grid.appendChild(wrap)
    }
    c.appendChild(grid)

    var foot = el('div', 'sle-foot')
    var saveBtn = el('button', 'sle-save', 'Save policy pages')
    saveBtn.type = 'button'
    saveBtn.addEventListener('click', function () { save(saveBtn) })
    var undo = el('button', 'sle-undo', 'Undo my edits')
    undo.type = 'button'
    undo.addEventListener('click', function () {
      if (loaded) { fill(loaded); say('Back to what is saved.', true) }
    })
    note = el('p', 'sle-note', '')
    foot.appendChild(saveBtn)
    foot.appendChild(undo)
    foot.appendChild(note)
    c.appendChild(foot)
    return c
  }

  /* --------------------------------------------------------------- mount --- */

  function settingsHeading() {
    var hs = document.querySelectorAll('h1, h2')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Settings') return hs[i]
    }
    return null
  }

  var busy = false
  function place() {
    if (busy) return
    var head = settingsHeading()

    if (!head) {
      if (card && card.parentNode) {
        busy = true
        card.parentNode.removeChild(card)
        card = null
        note = null
        busy = false
      }
      return
    }

    busy = true
    if (!card || !card.parentNode) {
      style()
      card = build()
      var anchor = head.parentNode
      anchor.parentNode.insertBefore(card, anchor.nextSibling)
      loaded = null
      fetchLegal(false)
    }
    busy = false
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
  observer.observe(document.body, { childList: true, subtree: true })
  place()
})()
