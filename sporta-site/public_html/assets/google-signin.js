/**
 * "Sign in with Google" on /backends.
 *
 * WHY AN OVERLAY. The website's panel is a prebuilt bundle with no source in
 * this repository, so its login form cannot be edited — the same constraint
 * that produced contact.js, footer.js, theme.js and rules.js. This adds a
 * button beside the form, touches nothing that exists, and does nothing on any
 * other screen.
 *
 * IT DOES NOT REPLACE THE PASSWORD FORM, and must not. Google sign-in can fail
 * for reasons the shop cannot fix or even see — a Google outage, a blocked
 * third-party script, a corporate policy, an owner signed into the wrong
 * account — and an admin panel whose only door depends on somebody else's
 * service is a panel that can be locked. The password form stays exactly where
 * it is; this is a second door, not a new lock.
 *
 * WHAT IT SENDS. Google's own script mints an ID token in the page and hands it
 * back through the callback. That token goes to `admin.php?r=google_login` and
 * NOTHING here decides who anyone is: the server verifies Google's signature,
 * checks the token was minted for this shop's client id, and looks the address
 * up in admin_users. This file cannot grant access; it can only offer a token.
 *
 * THE SECOND FACTOR STILL APPLIES. If the answer says need_code, the bundle's
 * own code screen is what must appear next — so the page is reloaded and the
 * server's pending marker drives it, rather than this overlay growing a second
 * implementation of a screen that already exists.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var GSI = 'https://accounts.google.com/gsi/client'
  var MARK = 'data-sporta-gsi'

  /* Only on the panel. `/backends` and anything under it, and nowhere else —
     a login form is not the only form on this shop. */
  function onPanel() { return /^\/backends(\/|$)/.test(location.pathname) }

  function api(route, body) {
    return fetch(API + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
  }

  /* The password form, found by its PASSWORD INPUT rather than by a class.
     The bundle's class names are compiled and change with every build; a field
     of type=password on the panel is the login form by definition. */
  function findForm() {
    var pw = document.querySelector('#backends input[type="password"], input[type="password"]')
    if (!pw) return null
    return pw.closest('form') || pw.parentElement
  }

  function mount(clientId) {
    var form = findForm()
    if (!form || form.querySelector('[' + MARK + ']')) return false

    var wrap = document.createElement('div')
    wrap.setAttribute(MARK, '1')
    wrap.style.cssText = 'margin-top:14px;display:flex;flex-direction:column;align-items:center;gap:10px'

    var or = document.createElement('div')
    or.textContent = document.documentElement.lang === 'ar' ? 'أو' : 'or'
    or.style.cssText = 'font-size:12px;opacity:.6;letter-spacing:.04em'

    var host = document.createElement('div')
    var msg = document.createElement('div')
    msg.style.cssText = 'font-size:13px;min-height:1.2em;text-align:center'

    wrap.appendChild(or); wrap.appendChild(host); wrap.appendChild(msg)
    form.appendChild(wrap)

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: function (res) {
        msg.textContent = ''
        api('google_login', { credential: res.credential }).then(function (r) {
          if (!r.ok) {
            // The server says one thing for every bad token on purpose, so
            // there is nothing more specific to report than this.
            msg.style.color = '#ff6b6b'
            msg.textContent = r.j && r.j.error === 'google_not_configured'
              ? 'Google sign-in is not switched on for this shop.'
              : 'That Google account cannot sign in here.'
            return
          }
          // need_code or not, the bundle's own screens take it from here: the
          // session cookie (or the pending marker) is already set server-side.
          location.reload()
        }).catch(function () {
          msg.style.color = '#ff6b6b'
          msg.textContent = 'Could not reach the shop. Try the password form.'
        })
      },
    })
    window.google.accounts.id.renderButton(host, {
      type: 'standard', theme: 'filled_black', size: 'large',
      text: 'signin_with', shape: 'pill',
      locale: document.documentElement.lang === 'ar' ? 'ar' : 'en',
    })
    return true
  }

  function loadGsi(cb) {
    if (window.google && window.google.accounts && window.google.accounts.id) return cb(true)
    var s = document.createElement('script')
    s.src = GSI
    s.async = true
    s.defer = true
    // A FAILURE HERE IS SILENT ON PURPOSE. If Google's script is blocked the
    // password form is still on screen and still works; an error banner would
    // only tell the owner about a door they were not trying to use.
    s.onload = function () { cb(true) }
    s.onerror = function () { cb(false) }
    document.head.appendChild(s)
  }

  function start() {
    if (!onPanel()) return
    // SIGNED IN OR NOT decides which half of this file is wanted. `me` answers
    // null for a signed-out browser, which is the login screen; an account
    // means the panel, where the setup card belongs and the button must not.
    api('me').then(function (m) {
      if (m.ok && m.j) {
        if (mountSetup()) return
        var o = new MutationObserver(function () { mountSetup() })
        o.observe(document.body, { childList: true, subtree: true })
        return
      }
      signInButton()
    }).catch(function () { signInButton() })
  }

  function signInButton() {
    api('google_config').then(function (r) {
      if (!r.ok || !r.j || !r.j.enabled || !r.j.client_id) return
      loadGsi(function (loaded) {
        if (!loaded) return
        if (mount(r.j.client_id)) return
        // THE FORM ARRIVES LATE AND IS RE-RENDERED. The bundle mounts after
        // this script runs and re-renders the login screen on a failed attempt
        // and on a language change — a one-shot mount would be undone by
        // either, with nothing reporting it. The observer re-applies; the
        // data attribute makes re-applying free.
        var obs = new MutationObserver(function () {
          if (mount(r.j.client_id)) { /* keep observing: it can be torn down again */ }
        })
        obs.observe(document.body, { childList: true, subtree: true })
      })
    }).catch(function () { /* not signed in, not configured, offline: no button */ })
  }

  /* ------------------------------------------------------ the setup card
     WITHOUT THIS THE FEATURE IS UNREACHABLE. The client id lives in a settings
     row and no screen in either panel could write it, so switching Google
     sign-in on would have meant phpMyAdmin — which is not a thing to ask of
     the person this panel exists for.

     It lives in THIS file rather than a thirteenth overlay because it belongs
     to the same feature and shares its one cache rule; and it is drawn only
     when `me` says somebody is signed in, so it cannot appear on the login
     screen it configures. */
  function mountSetup() {
    if (document.querySelector('[' + MARK + '-setup]')) return true
    var main = document.querySelector('#backends') || document.querySelector('main') || document.body
    if (!main) return false

    var card = document.createElement('section')
    card.setAttribute(MARK + '-setup', '1')
    card.style.cssText = 'margin:24px auto;max-width:640px;padding:18px 20px;border:1px solid rgba(255,255,255,.14);'
      + 'border-radius:14px;font-family:inherit'
    card.innerHTML =
      '<h2 style="margin:0 0 6px;font-size:16px">Sign in with Google</h2>'
      + '<p style="margin:0 0 14px;font-size:13px;opacity:.75;line-height:1.5">'
      + 'Paste the OAuth <b>client ID</b> from Google Cloud Console (APIs &amp; Services '
      + '&rarr; Credentials &rarr; Web application). Add <code>https://www.sporta.com.kw</code> '
      + 'as an authorised JavaScript origin. Only addresses that already have an admin '
      + 'account here can sign in — this never creates one.</p>'
    var input = document.createElement('input')
    input.type = 'text'
    input.placeholder = '1234567890-abc.apps.googleusercontent.com'
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
    main.appendChild(card)

    api('google_config').then(function (r) {
      if (r.ok && r.j) { input.value = r.j.client_id || ''; tick.checked = !!r.j.enabled }
    })

    save.addEventListener('click', function () {
      note.style.color = ''; note.textContent = 'Saving…'
      api('google_save', { client_id: input.value.trim(), enabled: tick.checked })
        .then(function (r) {
          if (!r.ok) {
            note.style.color = '#ff6b6b'
            note.textContent = r.j && r.j.error === 'bad_client_id'
              ? 'That does not look like a Google client ID.'
              : 'Could not save.'
            return
          }
          // READ BACK FROM THE ANSWER, not from what was typed: an empty id
          // cannot be enabled, and the server is what decides that.
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
