/**
 * The WEBSITE panel's Settings screen: the contact details it could not edit,
 * and two instructions on it that are not true.
 *
 * WHY AN OVERLAY. The website's /backends is a prebuilt bundle with no source
 * in this repository, and it is a DIFFERENT PROGRAM from the app's /backends.
 * Same pattern as rules.js, brand-logos.js and google-signin.js: add to the
 * screen it belongs to, touch nothing that exists, and do nothing anywhere
 * else. It needs no credential — it runs on the shop's origin inside the panel,
 * so the session cookie is already there.
 *
 * ============================================================== 1. CONTACT
 *
 * The server has held a `contact` settings row all along — phone, WhatsApp,
 * email, address and opening hours in both languages, and an Instagram handle —
 * validated by admin.php and read by the storefront's contact.js, which swaps
 * those values into seven built pages and every invoice. NOTHING IN THIS PANEL
 * COULD WRITE IT. Only the APP's Settings screen has the editor, so on the
 * panel the owner actually opens, changing the shop's phone number meant
 * phpMyAdmin.
 *
 * CLAUDE.md records this exact drift four times over — the KNET editor, the
 * footer editor, the theme editor and the brand-logo uploader all began
 * app-only — and states the rule it breaks: a feature whose configuration is
 * unreachable is not finished.
 *
 * IT READS FROM api.php?r=contact, NOT FROM AN ADMIN ROUTE. There is no
 * `settings` read route, and that is deliberate: api.php says so in its own
 * words about the footer — "the panel reads it back from here rather than from
 * an admin route… the panel's idea of the footer and the shop's must come from
 * one place, or they can disagree without anybody noticing until a customer
 * sees the difference." The same applies here, and it is also a READ rather
 * than a save with an empty body, so opening this screen never rewrites the row.
 *
 * `phone_e164` IS DERIVED AND IS NOT SENT BACK. api.php builds it from `phone`
 * so that three consumers do not each strip the spaces their own way. Echoing
 * it into the save would store a computed field as if the owner had typed it,
 * and the next read would compute it from itself.
 *
 * AND THE TYPED VALUES SURVIVE A REFUSAL. rules.js carried a comment claiming
 * its form "keeps what the owner typed" while render() rebuilt every field from
 * state, so the edit vanished under the message explaining why it was refused.
 * Here the inputs are the state: nothing re-reads them from the server except
 * an explicit reload, and a refusal only sets the note.
 *
 * ======================================================== 2. TWO UNTRUTHS
 *
 * Both are printed on this screen by the bundle, and both send the owner
 * somewhere that cannot work:
 *
 *   - "run api/setup-admin.php again" to change the password. That file is on
 *     live-file-check.php's $MUSTNOT list — the repository GUARANTEES it is not
 *     on the server, and the live check confirms `mustNotBeHere=0`. It is a
 *     dead end presented as the procedure, and the moment you need it is the
 *     moment you are locked out. The real way in exists and is better: empty
 *     `admin_users` and the sign-in screen offers to create the first account
 *     (admin.php's `register`, which refuses forever after).
 *
 *   - "Upload new [product photos] into public_html/cats/ in hPanel File
 *     Manager". Product photos are data: URIs in MySQL, added on the Catalogue
 *     tab with product_image_add. The same paragraph then says "nothing on this
 *     server may write files", which contradicts its own instruction.
 *
 * THE MATCH IS A LITERAL, NOT A PATTERN — contact.js's rule, for its reason. A
 * paragraph is rewritten only when it contains a <code> element whose text is
 * exactly one of two strings. A regular expression for "a paragraph about
 * photos" would one day catch a paragraph somebody else wrote.
 *
 * Each rewrite is marked, so re-applying is free and the panel re-rendering the
 * screen cannot double it.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var PUB = '/api/api.php?r='
  var MARK = 'data-sporta-panel'

  var card = null
  var note = null
  var fields = {}
  var loaded = null            // what the server last gave us, for Undo

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

  /* ------------------------------------------------------------- wording --- */

  function explain(err) {
    var s = String(err || '')
    if (s === 'invalid_email') {
      return 'That email address is not one the shop can send to. A mistyped '
           + 'address on the contact page is a customer writing to nobody, and '
           + 'nothing would ever report it — so the save was refused instead.'
    }
    if (s === 'invalid_whatsapp') {
      return 'That WhatsApp number could not be read. It needs the country '
           + 'code — 96522091914, or +965 2209 1914. wa.me refuses anything '
           + 'else, and a link that opens on an error looks exactly like the '
           + 'shop having no WhatsApp at all.'
    }
    if (s === 'not_signed_in') return 'Your session has ended. Sign in again.'
    if (s === 'bad_request') return 'The panel sent something the shop did not understand.'
    if (s === 'bad_response') return 'The shop answered with something that was not an answer.'
    return s
  }

  /* -------------------------------------------------------------- fields --- */
  // key, label, hint. The order is the order a person looks for them in.
  var FIELDS = [
    ['phone', 'Phone, as it should be printed',
      'Exactly as you want it to read. Spaces are kept on purpose — the dialable link is built from the digits.'],
    ['whatsapp', 'WhatsApp number',
      'With the country code. Stored in the one spelling the rest of the shop uses.'],
    ['email', 'Email', 'Where the contact page and the invoice tell customers to write.'],
    ['instagram', 'Instagram handle', 'Without the @, and not a full address — the link is built from it.'],
    ['address_ar', 'Address — Arabic', ''],
    ['address_en', 'Address — English', ''],
    ['hours_ar', 'Opening hours — Arabic', ''],
    ['hours_en', 'Opening hours — English', ''],
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
    post('settings_save', { name: 'contact', value: values() }).then(function (res) {
      btn.disabled = false
      if (res && res.error) { say(explain(res.error), false); return }
      // The server normalises — the WhatsApp number and the Instagram handle
      // come back in the spelling it stored, so the box must show what was
      // actually kept rather than what was typed at it.
      fetchContact(true)
      say('Saved. The shop shows this on its next page load.', true)
    }).catch(function () {
      btn.disabled = false
      say('The save did not reach the shop. Check the connection and try again.', false)
    })
  }

  function fill(c) {
    for (var i = 0; i < FIELDS.length; i++) {
      var k = FIELDS[i][0]
      if (fields[k]) fields[k].value = c[k] == null ? '' : String(c[k])
    }
  }

  function fetchContact(quiet) {
    fetch(PUB + 'contact', { headers: { Accept: 'application/json' }, credentials: 'include' })
      .then(function (r) { return r.json() })
      .then(function (c) {
        if (!c || typeof c !== 'object') return
        // phone_e164 is computed by api.php from `phone`; it is not a field and
        // must never travel back in a save.
        delete c.phone_e164
        loaded = c
        fill(c)
        if (!quiet) say('', true)
      })
      .catch(function () { if (!quiet) say('Could not read the current details.', false) })
  }

  /* -------------------------------------------------------------- chrome --- */

  var CSS = ''
    + '.spc{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;background:var(--sp-pc-bg,#2d3034);color:var(--sp-pc-ink,#eaecee)}'
    + '.spc-h{margin:0 0 4px;font-size:16px;font-weight:700;color:var(--sp-pc-ink,#eaecee)}'
    + '.spc-sub{margin:0 0 14px;color:var(--sp-pc-muted,#a6adb5);font-size:13px;line-height:1.5}'
    + '.spc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}'
    + '.spc-field{display:flex;flex-direction:column;gap:4px}'
    + '.spc-label{font-size:13px;font-weight:600;color:var(--sp-pc-ink,#eaecee)}'
    + '.spc-hint{font-size:12px;color:var(--sp-pc-muted,#a6adb5);line-height:1.4}'
    + '.spc-input{padding:8px 10px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);'
    + 'background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font:inherit}'
    + '.spc-foot{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px;align-items:center}'
    + '.spc-save{padding:9px 16px;border-radius:8px;border:0;cursor:pointer;'
    + 'background:#4f46e5;color:#fff;font:inherit;font-weight:700}'
    + '.spc-save[disabled]{opacity:.5;cursor:default}'
    + '.spc-undo{padding:9px 16px;border-radius:8px;cursor:pointer;font:inherit;'
    + 'border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee)}'
    + '.spc-note{margin:0;font-size:13px;line-height:1.5}'

  function style() {
    if (document.getElementById('spc-css')) return
    var s = document.createElement('style')
    s.id = 'spc-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  function build() {
    var c = el('section', 'spc')
    c.setAttribute(MARK, 'contact')
    c.appendChild(el('h2', 'spc-h', 'Contact details'))
    c.appendChild(el('p', 'spc-sub',
      'Shown on the contact, about, terms, privacy and returns pages, and on '
      + 'every invoice. Leave a field empty to hide it. These are the shop’s own '
      + 'details — nothing here reaches a customer’s record.'))

    var grid = el('div', 'spc-grid')
    fields = {}
    for (var i = 0; i < FIELDS.length; i++) {
      var k = FIELDS[i][0]
      var wrap = el('div', 'spc-field')
      wrap.appendChild(el('label', 'spc-label', FIELDS[i][1]))
      var input = el('input', 'spc-input')
      input.type = k === 'email' ? 'email' : 'text'
      input.autocomplete = 'off'
      if (/_ar$/.test(k)) input.dir = 'rtl'
      fields[k] = input
      wrap.appendChild(input)
      if (FIELDS[i][2]) wrap.appendChild(el('p', 'spc-hint', FIELDS[i][2]))
      grid.appendChild(wrap)
    }
    c.appendChild(grid)

    var foot = el('div', 'spc-foot')
    var saveBtn = el('button', 'spc-save', 'Save contact details')
    saveBtn.type = 'button'
    saveBtn.addEventListener('click', function () { save(saveBtn) })
    var undo = el('button', 'spc-undo', 'Undo my edits')
    undo.type = 'button'
    undo.addEventListener('click', function () {
      if (loaded) { fill(loaded); say('Back to what is saved.', true) }
    })
    note = el('p', 'spc-note', '')
    foot.appendChild(saveBtn)
    foot.appendChild(undo)
    foot.appendChild(note)
    c.appendChild(foot)
    return c
  }

  /* ------------------------------------------- 2. the two untrue paragraphs */

  // code text => the replacement paragraph, built rather than parsed so no
  // markup from here can ever be injected.
  function repairText() {
    var ps = document.querySelectorAll('p')
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i]
      if (p.hasAttribute(MARK)) continue
      var codes = p.querySelectorAll('code')
      var names = []
      for (var j = 0; j < codes.length; j++) names.push(codes[j].textContent.trim())

      if (names.indexOf('api/setup-admin.php') >= 0) {
        p.setAttribute(MARK, 'password')
        p.textContent =
          'Email and password, created on the server. To change the password, '
          + 'clear the admin_users table in phpMyAdmin and reload this panel — '
          + 'the sign-in screen then offers to create the first account, and it '
          + 'refuses once one exists. (The old instruction here named '
          + 'api/setup-admin.php, which is deliberately not on this server.) '
          + 'Five wrong passwords lock the account for fifteen minutes.'
      } else if (names.indexOf('public_html/cats/') >= 0) {
        p.setAttribute(MARK, 'photos')
        p.textContent =
          'Product photos live in the database, not in a folder. Upload them on '
          + 'the Catalogue tab, on the product they belong to. Nothing on this '
          + 'server may write files, so there is nothing to put in File Manager '
          + '— which is what the rest of this paragraph used to say while '
          + 'telling you to use it. Brand logos work the same way, on the '
          + 'Brands tab.'
      }
    }
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
    repairText()
    if (!card || !card.parentNode) {
      style()
      card = build()
      var anchor = head.parentNode
      anchor.parentNode.insertBefore(card, anchor.nextSibling)
      loaded = null
      fetchContact(false)
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
