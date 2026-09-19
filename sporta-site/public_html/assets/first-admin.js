/* Sporta — a working "create the first admin account" form on the website's
 * /backends login screen, replacing instructions that point at a dead page.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * A shop with an empty admin_users table shows a screen headed "No sign-in
 * has been created yet" and tells the owner to open
 * `https://www.sporta.com.kw/api/setup-admin.php` — a file that has never
 * existed in this repository and does not exist on the live server either.
 * CLAUDE.md records exactly this gap: "There is no web page that makes the
 * first account", found the day the KNET setup needed one and blocked on it.
 *
 * The FIX already exists, on the SERVER: `?r=register` creates the first
 * account and signs it in, in one call — the app's own /backends already
 * calls it (src/lib/session.tsx's signUp). The website's bundle was simply
 * never taught to. Read out of the bundle rather than guessed:
 * `admin.php?r=register`, X-Sporta-Admin: 1, credentials: include, and it can
 * only ever fire once — the server itself refuses with 409 already_set_up
 * the moment one account exists, so nothing here needs to enforce that.
 *
 * ------------------------------------------------------------ WHERE IT GOES
 *
 * The screen has no id or class distinguishing it from any other card, so it
 * is matched by the EXACT heading text the bundle renders for this one
 * state — the same discipline contact.js and footer-payment-icons.js already
 * use for exact-string matches, chosen because a substring match risks
 * catching a heading that merely mentions "sign-in" somewhere else.
 *
 * THE WRONG STEPS ARE HIDDEN, NOT LEFT VISIBLE NEXT TO A WORKING FORM. This
 * is the one place this project's "add, never touch what exists" overlay
 * rule bends: those three steps are not neutral — they send the owner to a
 * URL that answers 404, and leaving them next to a form that actually works
 * would read as two contradictory sets of instructions. Nothing is DELETED —
 * the `<ol>` is toggled to `display:none`, so a bundle rebuild that changes
 * this screen loses nothing this script cannot already tolerate losing.
 *
 * ------------------------------------------------------------------- FRAGILITY
 *
 * DOM surgery on a page with no source here, same class of thing as every
 * other overlay in this directory. If the heading cannot be found, nothing is
 * inserted and nothing is hidden — a bundle rebuild that changes this screen's
 * wording leaves the (wrong) instructions exactly as they were, not worse.
 */
;(function () {
  'use strict'

  if (location.pathname.indexOf('/backends') !== 0) return

  var HEADING = 'No sign-in has been created yet'
  var MARK = 'data-sporta-first-admin'
  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')

  function findHeading() {
    var hs = document.querySelectorAll('h1, h2')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === HEADING) return hs[i]
    }
    return null
  }

  function hideWrongSteps(card) {
    var ol = card.querySelector('ol')
    if (ol && ol.style.display !== 'none') ol.style.display = 'none'
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function register(email, password, onDone) {
    fetch(api + '/admin.php?r=register', {
      method: 'POST',
      headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: email, password: password }),
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data } }) })
      .then(function (res) { onDone(null, res) })
      .catch(function (e) { onDone(e, null) })
  }

  var MESSAGES = {
    bad_email: 'Enter a valid email address.',
    password_too_short: 'The password must be at least twelve characters.',
    password_too_common: 'That password is too easy to guess — choose something less predictable.',
    already_set_up: 'Somebody already created the first account. Reload the page and sign in.',
    busy: 'The server is busy setting this up — wait a moment and try again.',
  }

  function build(card) {
    var wrap = el('div', null)
    wrap.setAttribute(MARK, '1')
    wrap.style.cssText = 'margin-top:20px;padding-top:20px;border-top:1px solid #e2e8f0;'

    var lead = el('p', null,
      'This can be done from here instead — it only works while no account exists, and it can never make a second one.')
    lead.style.cssText = 'font-size:13px;color:#475569;margin:0 0 14px;'
    wrap.appendChild(lead)

    var emailInput = el('input')
    emailInput.type = 'email'
    emailInput.placeholder = 'Email'
    emailInput.autocomplete = 'email'

    var passInput = el('input')
    passInput.type = 'password'
    passInput.placeholder = 'Password (at least 12 characters)'
    passInput.autocomplete = 'new-password'

    var pass2Input = el('input')
    pass2Input.type = 'password'
    pass2Input.placeholder = 'Password, again'
    pass2Input.autocomplete = 'new-password'

    var fieldCss = 'display:block;width:100%;box-sizing:border-box;margin-bottom:10px;padding:10px 12px;' +
      'border:1px solid #cbd5e1;border-radius:8px;font-size:14px;'
    emailInput.style.cssText = fieldCss
    passInput.style.cssText = fieldCss
    pass2Input.style.cssText = fieldCss
    wrap.appendChild(emailInput)
    wrap.appendChild(passInput)
    wrap.appendChild(pass2Input)

    var msg = el('p', null, '')
    msg.style.cssText = 'font-size:13px;color:#b91c1c;min-height:16px;margin:0 0 10px;'
    wrap.appendChild(msg)

    var btn = el('button', null, 'Create the first account')
    btn.type = 'button'
    btn.style.cssText = 'width:100%;padding:10px 14px;border:none;border-radius:8px;background:#4f46e5;' +
      'color:#fff;font-weight:700;font-size:14px;cursor:pointer;'
    wrap.appendChild(btn)

    btn.onclick = function () {
      msg.textContent = ''
      var email = emailInput.value.trim()
      var pw = passInput.value
      var pw2 = pass2Input.value
      if (pw.length < 12) { msg.textContent = MESSAGES.password_too_short; return }
      if (pw !== pw2) { msg.textContent = 'The two passwords do not match.'; return }
      btn.disabled = true
      btn.textContent = 'Creating…'
      register(email, pw, function (err, res) {
        btn.disabled = false
        btn.textContent = 'Create the first account'
        if (err) { msg.textContent = 'Could not reach the server. Try again.'; return }
        if (res.ok) {
          msg.style.color = '#15803d'
          msg.textContent = 'Account created. Loading the panel…'
          // register() grants the session in the same call, per admin.php's
          // own comment — a reload is enough to land signed in, and it is
          // safer than trying to mimic the SPA's own post-login state here.
          setTimeout(function () { location.reload() }, 600)
          return
        }
        var code = res.data && res.data.error
        msg.style.color = '#b91c1c'
        msg.textContent = MESSAGES[code] || (code ? ('Could not create the account: ' + code) : 'Could not create the account.')
      })
    }

    card.appendChild(wrap)
  }

  function place() {
    var heading = findHeading()
    var existing = document.querySelector('[' + MARK + ']')
    if (!heading) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
      return
    }
    var card = heading.parentNode
    if (!card) return
    hideWrongSteps(card)
    if (existing) return
    build(card)
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
  observer.observe(document.documentElement, { childList: true, subtree: true })
  place()
})()
