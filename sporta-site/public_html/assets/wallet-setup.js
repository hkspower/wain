/**
 * Sporta — "Apple Wallet" card on the panel's Settings screen.
 *
 * "link my apple dev with sporta", 2026-09-26: the owner chose this card over
 * the manual Keychain-and-openssl route in WALLET.md. Three steps, and the
 * owner needs no Mac and no command line:
 *
 *   1. Create request  — the SERVER makes the key and a certificate signing
 *                        request. The key never leaves the server; only the
 *                        request is downloaded, and it holds nothing secret.
 *   2. At Apple         — upload the request under the Pass Type ID, download
 *                        the certificate Apple issues (pass.cer).
 *   3. Upload pass.cer  — the server checks it (right pass type, not expired,
 *                        belongs to the key it made, signed by Apple) and
 *                        installs it. The Team ID is read from the certificate,
 *                        so it is never typed.
 *
 * Same overlay pattern as payment.js: appears on Settings only, touches
 * nothing that exists, talks to admin.php with the session already there.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var MARK = 'data-sporta-panel'
  var APPLE_IDS = 'https://developer.apple.com/account/resources/identifiers/list/passTypeId'

  var card = null
  var statusBox = null
  var note = null
  var fileInput = null

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function call(route, body) {
    var opts = {
      headers: { 'X-Sporta-Admin': '1', Accept: 'application/json' },
      credentials: 'include',
    }
    if (body !== undefined) {
      opts.method = 'POST'
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }
    return fetch(API + route, opts).then(function (r) {
      return r.json().catch(function () { return { error: 'bad_response' } })
    })
  }

  function explain(err) {
    var s = String(err || '')
    var words = {
      cert_unreadable: 'That file is not a certificate. Upload the pass.cer file Apple gave you.',
      cert_wrong_pass_type: 'That certificate is not for Sporta Wallet cards. Make it under the Pass Type ID pass.kw.com.sporta.card, not for an app or push notifications.',
      cert_expired: 'That certificate has expired. Create a new one at Apple from a new request.',
      cert_no_team_id: 'That certificate has no Apple Team ID in it, so it cannot be a Pass Type ID certificate.',
      cert_key_mismatch: 'That certificate was made from a different request. Create a request here (step 1), upload THAT one at Apple, and upload the certificate Apple gives back for it.',
      wwdr_unavailable: 'The shop could not confirm the certificate with Apple just now. Nothing was changed. Try again in a few minutes.',
      wallet_dir_not_writable: 'The server would not let the shop save the certificate. Nothing was changed.',
      wallet_key_failed: 'The server could not create a key. Nothing was changed.',
      not_signed_in: 'Your session has ended. Sign in again.',
      bad_response: 'The shop answered with something that was not an answer.',
    }
    return words[s] || s
  }

  function say(text, good) {
    if (!note) return
    note.textContent = text || ''
    note.style.color = text ? (good ? '#15803d' : '#b91c1c') : ''
  }

  function render(st) {
    statusBox.innerHTML = ''
    if (!st || st.error) {
      statusBox.appendChild(el('p', 'spw-bad', 'Could not read the current setup.'))
      return
    }
    var line = st.ready
      ? 'Linked. Wallet cards are signed with Apple Team ID ' + st.team_id
        + (st.expires ? ', certificate valid until ' + st.expires : '') + '.'
      : st.expired
        ? 'The certificate EXPIRED on ' + st.expires + '. Wallet cards cannot be issued until a new one is uploaded.'
        : 'Not linked yet. Customers cannot add a Sporta card to Apple Wallet.'
    statusBox.appendChild(el('p', st.ready ? 'spw-ok' : 'spw-bad', line))
    if (st.request_pending && !st.ready) {
      statusBox.appendChild(el('p', 'spw-hint',
        'A request was created and is waiting for Apple’s certificate (step 3).'))
    }
  }

  function load() {
    call('wallet_setup').then(render).catch(function () { say('Could not reach the shop.', false) })
  }

  function makeRequest(btn) {
    btn.disabled = true
    say('Creating the request…', true)
    call('wallet_request', {}).then(function (res) {
      btn.disabled = false
      if (!res || res.error || !res.csr) { say(explain(res && res.error), false); return }
      var blob = new Blob([res.csr], { type: 'application/pkcs10' })
      var a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = res.filename || 'sporta-wallet.certSigningRequest'
      document.body.appendChild(a)
      a.click()
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove() }, 1000)
      say('Downloaded ' + a.download + '. Now do step 2 at Apple.', true)
      load()
    }).catch(function () { btn.disabled = false; say('Could not reach the shop.', false) })
  }

  function upload(btn) {
    var f = fileInput.files && fileInput.files[0]
    if (!f) { say('Choose the pass.cer file first.', false); return }
    if (f.size > 12000) { say(explain('cert_unreadable'), false); return }
    btn.disabled = true
    say('Checking the certificate with Apple…', true)
    var reader = new FileReader()
    reader.onload = function () {
      var bytes = new Uint8Array(reader.result)
      var bin = ''
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      call('wallet_cert', { cer: btoa(bin) }).then(function (res) {
        btn.disabled = false
        if (!res || res.error) { say(explain(res && res.error), false); return }
        fileInput.value = ''
        say('Linked. Sporta Wallet cards are now signed with your Apple account.', true)
        render(res)
      }).catch(function () { btn.disabled = false; say('Could not reach the shop.', false) })
    }
    reader.onerror = function () { btn.disabled = false; say('Could not read that file.', false) }
    reader.readAsArrayBuffer(f)
  }

  var CSS = ''
    + '.spw{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;background:var(--sp-pc-bg,#2d3034);color:var(--sp-pc-ink,#eaecee)}'
    + '.spw-h{margin:0 0 4px;font-size:16px;font-weight:700;color:var(--sp-pc-ink,#eaecee)}'
    + '.spw-sub{margin:0 0 12px;color:var(--sp-pc-muted,#a6adb5);font-size:13px;line-height:1.5}'
    + '.spw-step{margin:16px 0 0}'
    + '.spw-step h3{margin:0 0 6px;font-size:13px;font-weight:700;color:var(--sp-pc-ink,#eaecee)}'
    + '.spw-step p,.spw-step li{margin:0 0 6px;font-size:13px;line-height:1.5;color:var(--sp-pc-muted,#a6adb5)}'
    + '.spw-step ol{margin:0;padding-inline-start:20px}'
    + '.spw-step a{color:var(--sp-pc-ink,#eaecee);text-decoration:underline}'
    + '.spw-step code{font-size:12px;color:var(--sp-pc-ink,#eaecee)}'
    + '.spw-btn{padding:9px 16px;border-radius:8px;border:0;cursor:pointer;min-height:44px;'
    + 'background:#4f46e5;color:#fff;font:inherit;font-weight:700}'
    + '.spw-btn[disabled]{opacity:.5;cursor:default}'
    + '.spw-file{display:block;margin:0 0 8px;font:inherit;font-size:13px;color:var(--sp-pc-ink,#eaecee)}'
    + '.spw-note{margin:12px 0 0;font-size:13px;line-height:1.5}'
    + '.spw-ok{margin:0;font-size:13px;font-weight:600;color:#15803d}'
    + '.spw-bad{margin:0;font-size:13px;font-weight:600;color:#b91c1c}'
    + '.spw-hint{margin:6px 0 0;font-size:12px;color:var(--sp-pc-muted,#a6adb5)}'

  function style() {
    if (document.getElementById('spw-css')) return
    var s = document.createElement('style')
    s.id = 'spw-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  function build() {
    var c = el('section', 'spw')
    c.setAttribute(MARK, 'wallet')
    c.appendChild(el('h2', 'spw-h', 'Apple Wallet'))
    c.appendChild(el('p', 'spw-sub',
      'Link your Apple Developer account so customers can add their Sporta '
      + 'loyalty card to Apple Wallet. Needs an Apple Developer Program membership.'))
    statusBox = el('div')
    c.appendChild(statusBox)

    var s1 = el('div', 'spw-step')
    s1.appendChild(el('h3', null, '1. Create a request'))
    s1.appendChild(el('p', null,
      'The shop makes a private key and keeps it on the server. You download '
      + 'only the request, which holds nothing secret.'))
    var reqBtn = el('button', 'spw-btn', 'Create request')
    reqBtn.type = 'button'
    reqBtn.addEventListener('click', function () { makeRequest(reqBtn) })
    s1.appendChild(reqBtn)
    c.appendChild(s1)

    var s2 = el('div', 'spw-step')
    s2.appendChild(el('h3', null, '2. At Apple'))
    var ol = el('ol')
    var li1 = el('li')
    var a = el('a', null, 'Apple Developer → Identifiers → Pass Type IDs')
    a.href = APPLE_IDS
    a.target = '_blank'
    a.rel = 'noopener'
    li1.appendChild(a)
    ol.appendChild(li1)
    var li2 = el('li')
    li2.appendChild(document.createTextNode('Create one named '))
    li2.appendChild(el('code', null, 'pass.kw.com.sporta.card'))
    li2.appendChild(document.createTextNode(' (skip if it exists).'))
    ol.appendChild(li2)
    ol.appendChild(el('li', null,
      'Open it, choose Create Certificate, and upload the request from step 1.'))
    ol.appendChild(el('li', null, 'Download the certificate Apple gives you (pass.cer).'))
    s2.appendChild(ol)
    c.appendChild(s2)

    var s3 = el('div', 'spw-step')
    s3.appendChild(el('h3', null, '3. Upload Apple’s certificate'))
    fileInput = el('input', 'spw-file')
    fileInput.type = 'file'
    fileInput.accept = '.cer,.pem,application/x-x509-ca-cert,application/pkix-cert'
    fileInput.setAttribute('aria-label', 'Apple pass certificate (pass.cer)')
    s3.appendChild(fileInput)
    var upBtn = el('button', 'spw-btn', 'Upload and link')
    upBtn.type = 'button'
    upBtn.addEventListener('click', function () { upload(upBtn) })
    s3.appendChild(upBtn)
    c.appendChild(s3)

    note = el('p', 'spw-note', '')
    note.setAttribute('role', 'status')
    c.appendChild(note)
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
      // After the payment card when it is there, so the two setup cards that
      // need an outside account sit together; after the heading otherwise.
      var pay = document.querySelector('[' + MARK + '="payment"]')
      var anchor = pay || head.parentNode
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
