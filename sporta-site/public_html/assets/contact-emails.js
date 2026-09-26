/**
 * Four more email addresses, kept from the WEBSITE's /backends panel.
 *
 * WHAT THIS IS. An alternative email, an orders email, a B2B email and a
 * customers email — asked for as places to record addresses, on top of the
 * one public email the `contact` card already manages. This is the card that
 * edits them.
 *
 * ADMIN-ONLY, AND NOTHING ELSE READS IT. Unlike contact.js and footer.js,
 * which swap a value into the STOREFRONT, these four never appear on the
 * shop and never change what a system email is sent from or to — they are
 * stored and shown back here, and nowhere else.
 *
 * WHY AN OVERLAY. The website's /backends is a prebuilt bundle with no
 * source in this repository — CLAUDE.md records the trap of a feature that
 * only ever reached the app's panel. So this follows the pattern rules.js and
 * brand-logos.js already use: add a card, touch nothing that exists, do
 * nothing outside the screen it belongs to.
 *
 * IT NEEDS NO CREDENTIAL OF ITS OWN. It runs on the shop's own origin inside
 * the panel, so the session cookie is already there: /api/admin.php?r=,
 * X-Sporta-Admin: 1, credentials: include.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var card = null
  var state = { emails: null, note: '', busy: false }

  var FIELDS = [
    ['alternative', 'Alternative email'],
    ['orders', 'Orders email'],
    ['b2b', 'B2B email'],
    ['customers', 'Customers email'],
  ]

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function ask(route, body) {
    return fetch(API + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return { error: 'bad_response' } })
    })
  }

  function explain(err) {
    var s = String(err || '')
    if (s.indexOf('invalid_email:') === 0) {
      var key = s.slice('invalid_email:'.length)
      var label = key
      FIELDS.forEach(function (f) { if (f[0] === key) label = f[1] })
      return label + ' does not look like a real address.'
    }
    if (s === 'not_signed_in') return 'Your session has ended. Sign in again.'
    return s
  }

  function render() {
    if (!card) return
    card.textContent = ''

    card.appendChild(el('h3', 'sce-h', 'More emails'))
    card.appendChild(el('p', 'sce-sub',
      'Kept here for the owner’s own record. None of these appear on the shop.'))

    if (!state.emails) {
      card.appendChild(el('p', 'sce-note', 'Loading…'))
      return
    }

    var form = el('div', 'sce-grid')
    FIELDS.forEach(function (f) {
      var wrap = el('label', 'sce-field')
      wrap.appendChild(el('span', 'sce-label', f[1]))
      var i = el('input')
      i.type = 'email'
      i.value = state.emails[f[0]] || ''
      i.dataset.email = f[0]
      i.className = 'sce-input'
      wrap.appendChild(i)
      form.appendChild(wrap)
    })
    card.appendChild(form)

    var foot = el('div', 'sce-foot')
    var save = el('button', 'sce-save', state.busy ? 'Saving…' : 'Save emails')
    save.type = 'button'
    save.disabled = !!state.busy
    save.addEventListener('click', submit)
    foot.appendChild(save)
    card.appendChild(foot)

    if (state.note) card.appendChild(el('p', 'sce-note', state.note))
  }

  function collect() {
    var out = {}
    card.querySelectorAll('input[data-email]').forEach(function (i) {
      out[i.dataset.email] = i.value.trim()
    })
    return out
  }

  function submit() {
    if (state.busy) return

    /* COLLECT BEFORE RENDER, AND THE ORDER IS THE WHOLE BUG.
     *
     * This used to call render() to show "Saving…" and then collect() as an
     * argument on the next line. render() rebuilds every input from
     * state.emails — the values as the server last returned them — so by the
     * time collect() read the DOM, whatever had just been typed was gone. The
     * card posted the OLD addresses and reported "Saved.", and an owner
     * editing an address watched it save successfully and change nothing.
     *
     * Reading the DOM first makes the typed values the only thing that is ever
     * sent, and gives us something to put back if the save is refused. */
    var typed = collect()

    state.busy = true
    state.note = ''
    render()

    ask('settings_save', { name: 'contact_emails', value: typed }).then(function (res) {
      state.busy = false
      if (res && res.error) {
        /* THE TYPED VALUES SURVIVE A REFUSAL. render() rebuilds from
         * state.emails, so leaving it at the last saved copy would wipe every
         * edit and leave the message explaining why one of them was rejected
         * sitting over an unchanged form — the exact bug CLAUDE.md records
         * against rules.js, whose own comment claimed the opposite. One bad
         * address must not cost the three good ones typed beside it. */
        state.emails = typed
        state.note = explain(res.error)
      } else {
        state.emails = res
        state.note = 'Saved.'
      }
      render()
    }).catch(function () {
      state.busy = false
      /* A network failure is not a refusal: nothing was judged, so nothing
       * should be discarded. Keeping the draft is what makes "try again"
       * mean pressing the button rather than retyping the form. */
      state.emails = typed
      state.note = 'The save did not reach the shop. Check the connection and try again.'
      render()
    })
  }

  function load() {
    ask('contact_emails').then(function (res) {
      if (!res || res.error) {
        state.note = explain(res && res.error)
        render()
        return
      }
      state.emails = res
      render()
    })
  }

  /** The Settings screen, and only it. The panel swaps its content in place,
   *  so this has to be answered again after every render — hence the observer. */
  function settingsHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Settings') return hs[i]
    }
    return null
  }

  var CSS = ''
    + '.sce{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;'
    + 'background:var(--card,rgba(255,255,255,.03))}'
    + '.sce-h{margin:0 0 4px;font-size:16px}'
    + '.sce-sub{margin:0 0 14px;opacity:.7;font-size:13px}'
    + '.sce-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}'
    + '.sce-field{display:flex;flex-direction:column;gap:4px}'
    + '.sce-label{font-size:13px;font-weight:600}'
    + '.sce-input{padding:8px 10px;border-radius:8px;'
    + 'border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font:inherit}'
    + '.sce-foot{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}'
    + '.sce-save{padding:9px 16px;border-radius:8px;border:0;cursor:pointer;'
    + 'background:var(--brand,#e0561c);color:#fff;font:inherit;font-weight:600}'
    + '.sce-save[disabled]{opacity:.5;cursor:default}'
    + '.sce-note{margin:12px 0 0;font-size:13px;line-height:1.5}'

  function style() {
    if (document.getElementById('sce-css')) return
    var s = document.createElement('style')
    s.id = 'sce-css'
    s.textContent = CSS
    document.head.appendChild(s)
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
        busy = false
      }
      return
    }
    if (card && card.parentNode) return

    busy = true
    style()
    card = el('div', 'sce')
    var anchor = head.parentNode
    anchor.parentNode.insertBefore(card, anchor.nextSibling)
    busy = false

    state.emails = null
    state.note = ''
    state.busy = false
    render()
    load()
  }

  var timer = null
  var observer = new MutationObserver(function () {
    clearTimeout(timer)
    timer = setTimeout(place, 120)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  place()
})()
