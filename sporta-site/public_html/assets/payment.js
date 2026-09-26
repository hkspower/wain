/**
 * The WEBSITE panel's payment setup card — the KNET Tranportal ID editor and
 * the CBK hosted gateway's own readiness (pay/config.php), on the Settings
 * screen the owner actually opens.
 *
 * WHY AN OVERLAY. The website's /backends is a prebuilt bundle with no source
 * in this repository, and it is a DIFFERENT PROGRAM from the app's /backends.
 * Same pattern as rules.js, panel-settings.js, brand-logos.js and
 * google-signin.js: add to the screen it belongs to, touch nothing that
 * exists, and do nothing anywhere else. It needs no credential — it runs on
 * the shop's origin inside the panel, so the session cookie is already there.
 *
 * THIS WAS APP-ONLY, and CLAUDE.md records that drift four times over already
 * — the KNET editor itself was one of the four. The app's Settings screen
 * (src/app/backends/settings.tsx) has had this since the KNET/CBK readiness
 * route (admin.php?r=knet) was built; the panel the owner actually opens in a
 * browser had nothing. A feature whose configuration is unreachable from the
 * panel that is actually used is not finished.
 *
 * ONE ROUTE, TWO THINGS, because admin.php's ?r=knet answers both:
 *
 *   - `tranportal_id` / `source` — editable, and always sent on save. Empty
 *     is allowed and means "go back to knet/config.php on the server"; that
 *     is the way out if a saved ID turns out to be wrong, and it must not
 *     require someone with file access at the exact moment the shop cannot
 *     take money. The server validates shape (3-32 alphanumeric) and rejects
 *     the file's own placeholders (YOUR_TRANPORTAL_ID etc) — this card
 *     surfaces both refusals by name rather than a generic "save failed".
 *
 *   - `tranportal_password` / `resource_key`, editable since 2026-09-18 on
 *     the owner's explicit request, KNOWING the cost named in CLAUDE.md: both
 *     are bearer credentials, and putting them in the database rather than
 *     leaving them file-only means an SQL injection anywhere in the shop
 *     hands over a working, signing gateway. NEVER PRE-FILLED — the server
 *     never sends the value back, only `_set`/`_source` booleans, so these two
 *     boxes are always blank on load. A blank box on SAVE means "no change",
 *     not "clear it" — only sent to the server when the owner actually typed
 *     something — and each has its own "Clear" action that explicitly sends
 *     an empty string, separate from the main Save button, so clearing a
 *     secret is never a side effect of saving the ID.
 *
 *   - `pay` — pay/config.php's readiness for BOTH KNET and T-Pay, which go
 *     through the same CBK hosted gateway and the same three credentials.
 *     READ-ONLY, and NEVER THE VALUES: client_id_set / client_secret_set /
 *     encrp_key_set are booleans only, because those are bearer credentials.
 *     They are "filled in on the server, in pay/config.php" — this panel
 *     cannot write them and does not pretend to. `pay` can be null (the file
 *     is missing or unreadable), which is a different fault from every flag
 *     being false, and is shown as its own state rather than folded into
 *     "not ready".
 *
 * IT READS admin.php?r=knet, NOT api.php. Both the Tranportal ID and the pay
 * readiness are withheld from the public ?r=slides route on purpose — see
 * CLAUDE.md, "Six of the nine are public; three are not" and the KNET.md
 * table — so this is an admin route behind the same session and the same
 * X-Sporta-Admin gate as everything else in this file.
 *
 * A REFUSAL KEEPS THE TYPING. panel-settings.js already fixed rules.js's
 * version of this bug — a comment claiming the form "keeps what the owner
 * typed" while render() rebuilt every field from state, so a rejected edit
 * vanished under the message explaining the rejection. Here the input is the
 * state: nothing re-reads it from the server except an explicit reload or a
 * successful save, and a refusal only sets the note.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var MARK = 'data-sporta-panel'

  var card = null
  var idInput = null
  var pwInput = null
  var keyInput = null
  var note = null
  var sourceLine = null
  var pwLine = null
  var keyLine = null
  var payBox = null

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function get(route) {
    return fetch(API + route, {
      headers: { 'X-Sporta-Admin': '1', Accept: 'application/json' },
      credentials: 'include',
    }).then(function (r) { return r.json().catch(function () { return null }) })
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

  /* ------------------------------------------------------------- wording --- */

  function explain(err) {
    var s = String(err || '')
    if (s === 'invalid_tranportal_id') {
      return 'That is not a Tranportal ID this shop can use. KNET issues 3 to '
           + '32 letters and digits — nothing else, no spaces or punctuation.'
    }
    if (s === 'placeholder_tranportal_id') {
      return 'That is the placeholder the file ships with, not a real '
           + 'Tranportal ID. Saving it would pin the shop to an ID that '
           + 'cannot take a payment, which is worse than leaving this blank.'
    }
    if (s === 'tranportal_password_too_long') {
      return 'That password is too long to be a real Tranportal password.'
    }
    if (s === 'placeholder_tranportal_password') {
      return 'That is the placeholder the file ships with, not a real password.'
    }
    if (s === 'resource_key_wrong_length') {
      return 'The Terminal Resource Key must be exactly 16 bytes — AES-128 '
           + 'cannot use a key of any other length. Check for a trailing '
           + 'space or a newline from copy/paste.'
    }
    if (s === 'placeholder_resource_key') {
      return 'That is the placeholder the file ships with, not a real key.'
    }
    if (s === 'not_signed_in') return 'Your session has ended. Sign in again.'
    if (s === 'bad_request') return 'The panel sent something the shop did not understand.'
    if (s === 'bad_response') return 'The shop answered with something that was not an answer.'
    return s
  }

  function say(text, good) {
    if (!note) return
    note.textContent = text || ''
    note.style.color = text ? (good ? '#15803d' : '#b91c1c') : ''
  }

  /* -------------------------------------------------------------- fetch --- */

  function fill(k) {
    if (!k) return
    idInput.value = k.tranportal_id == null ? '' : String(k.tranportal_id)
    sourceLine.textContent = k.source === 'database'
      ? 'Using the ID saved here.'
      : 'Using knet/config.php on the server.'
    // NEVER PRE-FILLED — the server does not send the value back, only
    // whether one is saved. Left blank on every load, including right after
    // a successful save of a new one.
    pwInput.value = ''
    pwLine.textContent = k.tranportal_password_set
      ? 'A password is saved here. Leave blank to keep it.'
      : 'Using the password in knet/config.php on the server.'
    keyInput.value = ''
    keyLine.textContent = k.resource_key_set
      ? 'A resource key is saved here. Leave blank to keep it.'
      : 'Using the resource key in knet/config.php on the server.'
    renderPay(k.pay)
  }

  function renderPay(pay) {
    payBox.innerHTML = ''
    if (pay == null) {
      payBox.appendChild(el('p', 'spk-warn',
        'pay/config.php could not be read — no card payment can work.'))
      return
    }
    var rows = [
      ['client_id_set', 'Client ID'],
      ['client_secret_set', 'Client Secret'],
      ['encrp_key_set', 'Encrypted account key'],
    ]
    var list = el('ul', 'spk-list')
    for (var i = 0; i < rows.length; i++) {
      var ok = !!pay[rows[i][0]]
      var li = el('li', 'spk-item')
      var dot = el('span', ok ? 'spk-dot spk-dot-ok' : 'spk-dot spk-dot-bad')
      li.appendChild(dot)
      li.appendChild(el('span', null, rows[i][1] + (ok ? ': set' : ': placeholder, not set')))
      list.appendChild(li)
    }
    payBox.appendChild(list)
    payBox.appendChild(el('p', 'spk-hint',
      'Set on the server, in pay/config.php — not here.'))
    var envLine = el('p', pay.ready ? 'spk-status spk-status-ok' : 'spk-status spk-status-bad',
      (pay.ready ? 'Ready to take payments' : 'NOT ready — cards will fail')
      + ' · environment: ' + pay.env)
    payBox.appendChild(envLine)
  }

  function load() {
    get('knet').then(function (k) {
      if (!k || typeof k !== 'object') { say('Could not read the current setup.', false); return }
      fill(k)
    }).catch(function () { say('Could not reach the shop.', false) })
  }

  function save(btn) {
    say('Saving…', true)
    btn.disabled = true
    // tranportal_id is always sent — it is a plain field, always shown filled
    // in, so "unchanged" and "blank on purpose" look the same either way.
    // The two secrets are OMITTED unless the owner actually typed something:
    // they are never pre-filled, so an empty box on save must mean "no
    // change", not "clear this credential".
    var value = { tranportal_id: idInput.value.trim() }
    if (pwInput.value !== '') value.tranportal_password = pwInput.value
    if (keyInput.value !== '') value.resource_key = keyInput.value
    post('settings_save', { name: 'knet', value: value })
      .then(function (res) {
        btn.disabled = false
        if (res && res.error) { say(explain(res.error), false); return }
        load()
        say('Saved.', true)
      }).catch(function () {
        btn.disabled = false
        say('The save did not reach the shop. Check the connection and try again.', false)
      })
  }

  /** Explicit and separate from Save: sends {[field]: ''} on its own, so
   *  clearing a secret back to the file is never a side effect of saving a
   *  change to the Tranportal ID or to the OTHER secret. */
  function clearField(field, label, btn) {
    if (!window.confirm('Clear the saved ' + label + '? The shop will use knet/config.php on the server instead.')) return
    say('Clearing…', true)
    btn.disabled = true
    var value = {}
    value[field] = ''
    post('settings_save', { name: 'knet', value: value })
      .then(function (res) {
        btn.disabled = false
        if (res && res.error) { say(explain(res.error), false); return }
        load()
        say('Cleared.', true)
      }).catch(function () {
        btn.disabled = false
        say('The request did not reach the shop. Check the connection and try again.', false)
      })
  }

  /* -------------------------------------------------------------- chrome --- */

  var CSS = ''
    + '.spk{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;background:var(--sp-pc-bg,#2d3034);color:var(--sp-pc-ink,#eaecee)}'
    + '.spk-h{margin:0 0 4px;font-size:16px;font-weight:700;color:var(--sp-pc-ink,#eaecee)}'
    + '.spk-sub{margin:0 0 14px;color:var(--sp-pc-muted,#a6adb5);font-size:13px;line-height:1.5}'
    + '.spk-sub2{margin:18px 0 8px;font-size:13px;font-weight:700;color:var(--sp-pc-ink,#eaecee)}'
    + '.spk-field{display:flex;flex-direction:column;gap:4px;max-width:360px}'
    + '.spk-label{font-size:13px;font-weight:600;color:var(--sp-pc-ink,#eaecee)}'
    + '.spk-input{padding:8px 10px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);'
    + 'background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font:inherit}'
    + '.spk-src{margin:6px 0 0;font-size:12px;color:var(--sp-pc-muted,#a6adb5)}'
    + '.spk-field-secret{margin-top:14px}'
    + '.spk-clear{align-self:flex-start;margin-top:6px;padding:5px 12px;border-radius:999px;'
    + 'border:1px solid var(--sp-pc-field-border,#565c63);background:transparent;'
    + 'color:var(--sp-pc-ink,#eaecee);font:inherit;font-size:12px;cursor:pointer}'
    + '.spk-foot{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;align-items:center}'
    + '.spk-save{padding:9px 16px;border-radius:8px;border:0;cursor:pointer;'
    + 'background:#4f46e5;color:#fff;font:inherit;font-weight:700}'
    + '.spk-save[disabled]{opacity:.5;cursor:default}'
    + '.spk-note{margin:0;font-size:13px;line-height:1.5}'
    + '.spk-list{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:6px}'
    + '.spk-item{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--sp-pc-ink,#eaecee)}'
    + '.spk-dot{width:9px;height:9px;border-radius:50%;flex:none}'
    + '.spk-dot-ok{background:#16a34a}'
    + '.spk-dot-bad{background:#dc2626}'
    + '.spk-hint{margin:0 0 10px;font-size:12px;color:var(--sp-pc-muted,#a6adb5);line-height:1.4}'
    + '.spk-warn{margin:0;font-size:13px;color:#b91c1c}'
    + '.spk-status{margin:0;font-size:13px;font-weight:600}'
    + '.spk-status-ok{color:#15803d}'
    + '.spk-status-bad{color:#b91c1c}'

  function style() {
    if (document.getElementById('spk-css')) return
    var s = document.createElement('style')
    s.id = 'spk-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  function build() {
    var c = el('section', 'spk')
    c.setAttribute(MARK, 'payment')
    c.appendChild(el('h2', 'spk-h', 'Payment setup'))
    c.appendChild(el('p', 'spk-sub',
      'KNET and T-Pay share one CBK gateway. Cards fail until every line '
      + 'below is set.'))

    var field = el('div', 'spk-field')
    field.appendChild(el('label', 'spk-label', 'KNET Tranportal ID'))
    idInput = el('input', 'spk-input')
    idInput.type = 'text'
    idInput.autocomplete = 'off'
    field.appendChild(idInput)
    sourceLine = el('p', 'spk-src', '')
    field.appendChild(sourceLine)
    c.appendChild(field)

    /** A secret field: a password input, a status line, and its own Clear
     *  button — built once so the password and the resource key stay in
     *  step with each other rather than two hand-written copies drifting. */
    function secretField(labelText, placeholder) {
      var wrap = el('div', 'spk-field spk-field-secret')
      wrap.appendChild(el('label', 'spk-label', labelText))
      var input = el('input', 'spk-input')
      input.type = 'password'
      input.autocomplete = 'new-password'
      input.placeholder = placeholder
      wrap.appendChild(input)
      var line = el('p', 'spk-src', '')
      wrap.appendChild(line)
      var clear = el('button', 'spk-clear', 'Clear')
      clear.type = 'button'
      wrap.appendChild(clear)
      c.appendChild(wrap)
      return { input: input, line: line, clear: clear }
    }

    var pw = secretField('Tranportal password', 'Leave blank to keep the current one')
    pwInput = pw.input
    pwLine = pw.line
    pw.clear.addEventListener('click', function () { clearField('tranportal_password', 'Tranportal password', pw.clear) })

    var key = secretField('Terminal Resource Key', 'Leave blank to keep the current one — exactly 16 characters')
    keyInput = key.input
    keyLine = key.line
    key.clear.addEventListener('click', function () { clearField('resource_key', 'Terminal Resource Key', key.clear) })

    var foot = el('div', 'spk-foot')
    var saveBtn = el('button', 'spk-save', 'Save')
    saveBtn.type = 'button'
    saveBtn.addEventListener('click', function () { save(saveBtn) })
    note = el('p', 'spk-note', '')
    foot.appendChild(saveBtn)
    foot.appendChild(note)
    c.appendChild(foot)

    c.appendChild(el('h3', 'spk-sub2', 'CBK gateway (pay/config.php)'))
    payBox = el('div')
    c.appendChild(payBox)

    return c
  }

  /* --------------------------------------------------------------- mount --- */

  /** The Settings screen, and only it. The panel swaps its content in place, so
   *  this has to be answered again after every render — hence the observer. */
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
      load()
    }
    busy = false
  }

  var timer = null
  var observer = new MutationObserver(function () {
    clearTimeout(timer)
    timer = setTimeout(place, 120)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  place()
})()
