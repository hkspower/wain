/**
 * "Sign in with Apple" on /backends — the same overlay pattern as
 * google-signin.js, a second door beside it rather than a replacement for
 * either the password form or the Google button.
 *
 * WHY AN OVERLAY. The website's panel is a prebuilt bundle with no source in
 * this repository, so its login form cannot be edited — the same constraint
 * every overlay in this directory works around.
 *
 * IT DOES NOT REPLACE ANYTHING. Apple sign-in can fail for reasons this shop
 * cannot see or fix — an outage, a blocked script, a domain-verification
 * lapse — and a panel whose only door depends on somebody else's service is a
 * panel that can be locked. The password form and the Google button, if
 * configured, stay exactly where they are.
 *
 * WHAT IT SENDS. Apple's own script mints an ID token in the page; that token
 * goes to `admin.php?r=apple_login` and nothing here decides who anyone is —
 * the server verifies Apple's signature, checks the token was minted for this
 * shop's Services ID, and looks the address up in admin_users. This file
 * cannot grant access; it can only offer a token.
 *
 * THE SECOND FACTOR STILL APPLIES, the same way it does for Google: a
 * need_code answer reloads the page and the bundle's own code screen takes
 * over from the server's pending marker.
 *
 * ONE THING APPLE NEEDS THAT GOOGLE DOES NOT: the owner has to register a
 * "Services ID" in their Apple Developer account, add this domain as a
 * return URL, and upload Apple's domain-verification file. None of that is
 * something this file — or any script in this repository — can do for them;
 * the setup card below only stores the id once that registration exists.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var SDK = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'
  var MARK = 'data-sporta-asi'

  function onPanel() { return /^\/backends(\/|$)/.test(location.pathname) }

  function api(route, body) {
    return fetch(API + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
  }

  function findForm() {
    var pw = document.querySelector('#backends input[type="password"], input[type="password"]')
    if (!pw) return null
    return pw.closest('form') || pw.parentElement
  }

  function mount(clientId) {
    var form = findForm()
    if (!form || form.querySelector('[' + MARK + ']')) return false

    var ar = document.documentElement.lang === 'ar'
    var wrap = document.createElement('div')
    wrap.setAttribute(MARK, '1')
    wrap.style.cssText = 'margin-top:10px;display:flex;flex-direction:column;align-items:center;gap:10px'

    var btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = ar ? 'الدخول عبر Apple' : 'Sign in with Apple'
    btn.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;'
      + 'max-width:280px;padding:10px 18px;border-radius:999px;border:1px solid #000;background:#000;'
      + 'color:#fff;font-size:14px;font-weight:600;cursor:pointer'
    var msg = document.createElement('div')
    msg.style.cssText = 'font-size:13px;min-height:1.2em;text-align:center'

    wrap.appendChild(btn); wrap.appendChild(msg)
    form.appendChild(wrap)

    window.AppleID.auth.init({
      clientId: clientId,
      scope: 'email',
      redirectURI: location.origin + '/backends',
      usePopup: true,
    })

    btn.addEventListener('click', function () {
      msg.textContent = ''
      window.AppleID.auth.signIn().then(function (res) {
        var idToken = res && res.authorization && res.authorization.id_token
        if (!idToken) {
          msg.style.color = '#ff6b6b'
          msg.textContent = ar ? 'تعذّر إتمام الدخول عبر Apple.' : 'Apple did not return a usable token.'
          return
        }
        api('apple_login', { id_token: idToken }).then(function (r) {
          if (!r.ok) {
            msg.style.color = '#ff6b6b'
            msg.textContent = r.j && r.j.error === 'apple_not_configured'
              ? (ar ? 'الدخول عبر Apple غير مفعّل لهذا المتجر.' : 'Apple sign-in is not switched on for this shop.')
              : (ar ? 'لا يمكن لهذا الحساب الدخول هنا.' : 'That Apple account cannot sign in here.')
            return
          }
          // need_code or not, the bundle's own screens take it from here.
          location.reload()
        }).catch(function () {
          msg.style.color = '#ff6b6b'
          msg.textContent = ar ? 'تعذّر الوصول إلى المتجر. جرّب نموذج كلمة المرور.'
            : 'Could not reach the shop. Try the password form.'
        })
      }).catch(function () {
        // Cancelled by the shopper, or the popup was blocked — either way the
        // password form (and Google's button, if configured) is still there.
      })
    })
    return true
  }

  function loadSdk(cb) {
    if (window.AppleID && window.AppleID.auth) return cb(true)
    var s = document.createElement('script')
    s.src = SDK
    s.async = true
    s.defer = true
    s.onload = function () { cb(true) }
    s.onerror = function () { cb(false) }
    document.head.appendChild(s)
  }

  function start() {
    if (!onPanel()) return
    api('me').then(function (m) {
      if (m.ok && m.j) {
        // ALWAYS KEEP WATCHING — see google-signin.js's note. Stopping once
        // mounted is what left this card on whichever screen it first
        // landed on; now that it belongs to Security it has to come down
        // again when the panel moves on.
        var o = new MutationObserver(schedule)
        o.observe(document.body, { childList: true, subtree: true })
        schedule()
        return
      }
      signInButton()
      // THE PANEL SIGNS IN WITHOUT A RELOAD. `start()` only runs once, at
      // page load, so an admin who signs in with the PASSWORD form — the
      // overwhelmingly common path, and the only one available before this
      // feature has ever been configured — leaves this whole check believing
      // nobody is signed in for the rest of the tab's life; the setup card
      // would never appear without a manual refresh. Measured directly: after
      // a password sign-in the login form's own password input is gone and
      // nothing here had a way to notice. The password field disappearing is
      // the signal; re-running start() from scratch asks `me` again rather
      // than guessing, so this also does the right thing if a sign-in attempt
      // fails and the form comes back.
      var watchForSignIn = new MutationObserver(function () {
        if (findForm()) return
        watchForSignIn.disconnect()
        start()
      })
      watchForSignIn.observe(document.body, { childList: true, subtree: true })
    }).catch(function () { signInButton() })
  }

  function signInButton() {
    api('apple_config').then(function (r) {
      if (!r.ok || !r.j || !r.j.enabled || !r.j.client_id) return
      loadSdk(function (loaded) {
        if (!loaded) return
        if (mount(r.j.client_id)) return
        var obs = new MutationObserver(function () {
          if (mount(r.j.client_id)) { /* keep observing: it can be torn down again */ }
        })
        obs.observe(document.body, { childList: true, subtree: true })
      })
    }).catch(function () { /* not signed in, not configured, offline: no button */ })
  }

  /* ------------------------------------------------------ the setup card
     Same reasoning as google-signin.js's: without this the feature is
     unreachable, because the client id lives in a settings row no screen
     could otherwise write. Drawn only when `me` says somebody is signed in. */
  /** The Security screen, or null. Matched on that screen's own headings —
   *  the panel swaps content in place, so the nav is no help, and this
   *  card's own heading would be circular. See google-signin.js. */
  function securityScreen() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) {
      var t = hs[i].textContent.trim()
      if (t === 'Two-factor sign-in' || t === 'Your details') return hs[i]
    }
    return null
  }

  /* Debounced and flagged: this mutates the document and is called from an
     observer watching it. */
  var placing = false
  var timer = null
  function schedule() {
    clearTimeout(timer)
    timer = setTimeout(function () {
      if (placing) return
      placing = true
      try { mountSetup() } finally { placing = false }
    }, 120)
  }

  function mountSetup() {
    // ON SECURITY, AND NOWHERE ELSE. It used to append to `main` on any
    // /backends path, and the panel keeps that container across screens — so
    // "Sign in with Apple" was the second heading on every page in the panel.
    var anchor = securityScreen()
    var existing = document.querySelector('[' + MARK + '-setup]')

    if (!anchor) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
      return false
    }
    if (existing) return true

    var card = document.createElement('section')
    card.setAttribute(MARK + '-setup', '1')
    card.style.cssText = 'margin:24px auto;max-width:640px;padding:18px 20px;border:1px solid rgba(255,255,255,.14);'
      + 'border-radius:14px;font-family:inherit'
    card.innerHTML =
      '<h2 style="margin:0 0 6px;font-size:16px">Sign in with Apple</h2>'
      + '<p style="margin:0 0 14px;font-size:13px;opacity:.75;line-height:1.5">'
      + 'Paste the <b>Services ID</b> from the Apple Developer account (Certificates, '
      + 'Identifiers &amp; Profiles &rarr; Identifiers &rarr; Services IDs) — a reverse-DNS '
      + 'string such as <code>com.sporta.web.signin</code>. That Services ID must already have '
      + '<code>https://www.sporta.com.kw</code> registered as a domain and return URL, and the '
      + 'domain-verification file Apple gives you uploaded to this site — both done in Apple’s '
      + 'own dashboard, not here. Only addresses that already have an admin account here can sign '
      + 'in — this never creates one.</p>'
    var input = document.createElement('input')
    input.type = 'text'
    input.placeholder = 'com.sporta.web.signin'
    input.style.cssText = 'width:100%;padding:9px 11px;border-radius:9px;border:1px solid rgba(255,255,255,.2);'
      + 'background:transparent;color:inherit;font-size:13px;box-sizing:border-box'
    var row = document.createElement('label')
    row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:12px 0;font-size:13px'
    var tick = document.createElement('input'); tick.type = 'checkbox'
    row.appendChild(tick); row.appendChild(document.createTextNode('Show the button on the sign-in screen'))
    var save = document.createElement('button')
    save.type = 'button'; save.textContent = 'Save'
    save.style.cssText = 'padding:9px 18px;border-radius:999px;border:0;cursor:pointer;font-weight:600'
    var note = document.createElement('span')
    note.style.cssText = 'margin-inline-start:12px;font-size:13px'

    card.appendChild(input); card.appendChild(row); card.appendChild(save); card.appendChild(note)
    // Above the two-factor card, with the other ways of getting in.
    var host = anchor.parentNode
    if (host && host.parentNode) host.parentNode.insertBefore(card, host)
    else document.body.appendChild(card)

    api('apple_config').then(function (r) {
      if (r.ok && r.j) { input.value = r.j.client_id || ''; tick.checked = !!r.j.enabled }
    })

    save.addEventListener('click', function () {
      note.style.color = ''; note.textContent = 'Saving…'
      api('apple_save', { client_id: input.value.trim(), enabled: tick.checked })
        .then(function (r) {
          if (!r.ok) {
            note.style.color = '#ff6b6b'
            note.textContent = r.j && r.j.error === 'bad_client_id'
              ? 'That does not look like an Apple Services ID.'
              : 'Could not save.'
            return
          }
          input.value = r.j.client_id || ''
          tick.checked = !!r.j.enabled
          note.style.color = '#4ade80'
          note.textContent = 'Saved.'
        })
    })
    return true
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
