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
 *   - `tranportal_id` / `source` — the ONE editable field. Empty is allowed
 *     and means "go back to knet/config.php on the server"; that is the way
 *     out if a saved ID turns out to be wrong, and it must not require
 *     someone with file access at the exact moment the shop cannot take
 *     money. The server validates shape (3-32 alphanumeric) and rejects the
 *     file's own placeholders (YOUR_TRANPORTAL_ID etc) — this card surfaces
 *     both refusals by name rather than a generic "save failed".
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
  var note = null
  var sourceLine = null
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
      ? 'Using the ID saved here, in the database.'
      : 'Using the ID in knet/config.php on the server.'
    renderPay(k.pay)
  }

  function renderPay(pay) {
    payBox.innerHTML = ''
    if (pay == null) {
      payBox.appendChild(el('p', 'spp-warn',
        'pay/config.php could not be read on the server. Neither KNET nor '
        + 'T-Pay can take a payment until it exists.'))
      return
    }
    var rows = [
      ['client_id_set', 'Client ID'],
      ['client_secret_set', 'Client Secret'],
      ['encrp_key_set', 'Encrypted account key'],
    ]
    var list = el('ul', 'spp-list')
    for (var i = 0; i < rows.length; i++) {
      var ok = !!pay[rows[i][0]]
      var li = el('li', 'spp-item')
      var dot = el('span', ok ? 'spp-dot spp-dot-ok' : 'spp-dot spp-dot-bad')
      li.appendChild(dot)
      li.appendChild(el('span', null, rows[i][1] + (ok ? ': set' : ': placeholder, not set')))
      list.appendChild(li)
    }
    payBox.appendChild(list)
    payBox.appendChild(el('p', 'spp-hint',
      'These are filled in on the server, in pay/config.php — not here.'))
    var envLine = el('p', pay.ready ? 'spp-status spp-status-ok' : 'spp-status spp-status-bad',
      (pay.ready ? 'Ready to take payments' : 'NOT ready — cards will fail at the bank')
      + ' — gateway environment is "' + pay.env + '" in pay/config.php.')
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
    post('settings_save', { name: 'knet', value: { tranportal_id: idInput.value.trim() } })
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

  /* -------------------------------------------------------------- chrome --- */

  var CSS = ''
    + '.spp{border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:20px 0;background:#fff}'
    + '.spp-h{margin:0 0 4px;font-size:16px;font-weight:700;color:#0f172a}'
    + '.spp-sub{margin:0 0 14px;color:#64748b;font-size:13px;line-height:1.5}'
    + '.spp-sub2{margin:18px 0 8px;font-size:13px;font-weight:700;color:#0f172a}'
    + '.spp-field{display:flex;flex-direction:column;gap:4px;max-width:360px}'
    + '.spp-label{font-size:13px;font-weight:600;color:#0f172a}'
    + '.spp-input{padding:8px 10px;border-radius:8px;border:1px solid #cbd5e1;'
    + 'background:#fff;color:#0f172a;font:inherit}'
    + '.spp-src{margin:6px 0 0;font-size:12px;color:#64748b}'
    + '.spp-foot{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px;align-items:center}'
    + '.spp-save{padding:9px 16px;border-radius:8px;border:0;cursor:pointer;'
    + 'background:#4f46e5;color:#fff;font:inherit;font-weight:700}'
    + '.spp-save[disabled]{opacity:.5;cursor:default}'
    + '.spp-note{margin:0;font-size:13px;line-height:1.5}'
    + '.spp-list{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:6px}'
    + '.spp-item{display:flex;align-items:center;gap:8px;font-size:13px;color:#0f172a}'
    + '.spp-dot{width:9px;height:9px;border-radius:50%;flex:none}'
    + '.spp-dot-ok{background:#16a34a}'
    + '.spp-dot-bad{background:#dc2626}'
    + '.spp-hint{margin:0 0 10px;font-size:12px;color:#64748b;line-height:1.4}'
    + '.spp-warn{margin:0;font-size:13px;color:#b91c1c}'
    + '.spp-status{margin:0;font-size:13px;font-weight:600}'
    + '.spp-status-ok{color:#15803d}'
    + '.spp-status-bad{color:#b91c1c}'

  function style() {
    if (document.getElementById('spp-css')) return
    var s = document.createElement('style')
    s.id = 'spp-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  function build() {
    var c = el('section', 'spp')
    c.setAttribute(MARK, 'payment')
    c.appendChild(el('h2', 'spp-h', 'Payment setup'))
    c.appendChild(el('p', 'spp-sub',
      'KNET and T-Pay both go through the same CBK hosted gateway. This is '
      + 'where the shop takes a customer’s card, and it does not work '
      + 'until every line below is set.'))

    var field = el('div', 'spp-field')
    field.appendChild(el('label', 'spp-label', 'KNET Tranportal ID'))
    idInput = el('input', 'spp-input')
    idInput.type = 'text'
    idInput.autocomplete = 'off'
    field.appendChild(idInput)
    sourceLine = el('p', 'spp-src', '')
    field.appendChild(sourceLine)
    c.appendChild(field)

    var foot = el('div', 'spp-foot')
    var saveBtn = el('button', 'spp-save', 'Save Tranportal ID')
    saveBtn.type = 'button'
    saveBtn.addEventListener('click', function () { save(saveBtn) })
    note = el('p', 'spp-note', '')
    foot.appendChild(saveBtn)
    foot.appendChild(note)
    c.appendChild(foot)

    c.appendChild(el('h3', 'spp-sub2', 'CBK gateway (pay/config.php)'))
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
