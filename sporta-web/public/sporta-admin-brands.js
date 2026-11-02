/* TWO add-ons for the compiled live admin live in this file, because this is
 * the only admin script the live index.html loads (a new file name would not
 * be loaded without editing that page, whose source is not in the repo):
 *   1. "Remove" button on each brand (below);
 *   2. Merchant ID / Terminal ID card in Payments > KNET editor (second block,
 *      after the brands one);
 *   3. Merchant Server IP 1 / 2 card in Payments > T-Pay editor (third block).
 *
 * Sporta — "Remove" button on each brand in the admin (add-on for the compiled
 * live admin bundle, whose source is not in the repo; the same button exists
 * in the repo's src/admin/Brands.jsx for the next real build).
 *
 * Only runs on /backends. It watches for the Brands screen (a <ul> of cards,
 * each with a "Shown/Hidden" checkbox, an Edit button and the brand's web name
 * in monospace), asks the API for the brand list to learn each brand's id,
 * and adds a red Remove button next to Edit. Clicking it confirms, then POSTs
 * brand_delete — the server refuses while any product still uses the brand and
 * the message is shown. External file on purpose: the CSP allows scripts from
 * 'self' only. The request carries the admin session cookie and the
 * X-Sporta-Admin header, exactly like the admin's own calls.
 */
(function () {
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  var API = '/api/admin.php'
  var MARK = 'data-sporta-remove'
  var ids = null          // slug -> id, filled from r=brands
  var loading = false

  function call(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, body: j } }) })
  }

  function loadIds() {
    if (loading) return
    loading = true
    return call('brands').then(function (r) {
      loading = false
      var rows = r.body && (r.body.data || r.body)
      if (!Array.isArray(rows)) return
      ids = {}
      rows.forEach(function (b) { ids[b.slug] = b.id })
    })
  }

  var MSG = {
    brand_in_use: 'Products still use this brand. Move or remove them first, or hide the brand instead.',
    brand_not_found: 'That brand no longer exists. Refresh the page.'
  }

  function onRemove(li, slug, name) {
    if (!window.confirm('Remove "' + name + '" permanently? This cannot be undone.')) return
    var id = ids && ids[slug]
    if (!id) { window.alert('Could not find this brand. Refresh the page and try again.'); return }
    call('brand_delete', { id: id }).then(function (r) {
      var err = r.body && r.body.error
      if (r.ok && r.body && (r.body.deleted || (r.body.data && r.body.data.deleted))) {
        delete ids[slug]
        li.remove()
      } else {
        window.alert(MSG[err] || ('Could not remove the brand' + (err ? ' (' + err + ')' : '') + '.'))
      }
    })
  }

  function scan() {
    var items = document.querySelectorAll('main li')
    for (var i = 0; i < items.length; i++) {
      var li = items[i]
      if (li.hasAttribute(MARK)) continue
      var box = li.querySelector('input[type=checkbox]')
      var slugEl = li.querySelector('p.font-mono')
      var edit = null
      var btns = li.querySelectorAll('button')
      for (var j = 0; j < btns.length; j++) if (btns[j].textContent.trim() === 'Edit') edit = btns[j]
      if (!box || !slugEl || !edit) continue          // not a brand card
      li.setAttribute(MARK, '1')
      var slug = slugEl.textContent.trim()
      var nameEl = li.querySelector('p.font-bold')
      var name = nameEl ? nameEl.textContent.trim() : slug
      var rm = document.createElement('button')
      rm.type = 'button'
      rm.textContent = 'Remove'
      rm.className = edit.className.replace(/text-indigo-\d+/g, 'text-red-600')
      rm.addEventListener('click', (function (l, s, n) { return function () { onRemove(l, s, n) } })(li, slug, name))
      edit.parentNode.insertBefore(rm, edit.nextSibling)
      if (edit.parentNode.style) edit.parentNode.style.gap = edit.parentNode.style.gap || '0.75rem'
      if (!ids) loadIds()
    }
  }

  var queued = false
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; scan() }) }
  function start() { scan(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()


/* ---------------------------------------------------------------------------
 * 2. Payments > KNET editor: Merchant ID and Terminal ID.
 *
 * The compiled editor has the Test/Production switch, the KNET on/off switch
 * and the Tranportal ID / password / resource key per environment, but no
 * place for the bank's Merchant ID and Terminal ID. This adds a small card
 * inside the KNET editor (after its field grid) with the pair for each
 * environment, saved on its own through admin.php?r=payment_identifiers, so the
 * editor's secret form — which re-sends everything it holds — is never
 * involved. The active pair follows the environment on the server.
 *
 * Plain DOM, textContent only (nothing from the server is parsed as HTML),
 * inline styles (the CSP allows them; the compiled stylesheet has no rules for
 * classes this file would invent). Enter inside these inputs must not submit
 * the editor's own form, which would save the secrets form too.
 * ------------------------------------------------------------------------ */
;(function () {   // the leading ; matters: the block above ends in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  var API = '/api/admin.php'
  var MARK = 'data-sporta-knet-ids'
  var MSG = {
    invalid_identifier: 'Use letters, digits, dot, dash or underscore only (up to 40 characters, no spaces).',
    config_missing: 'The KNET configuration file is missing on the server.',
    not_signed_in: 'Your session ended. Sign in again.',
    config_not_writable: 'The server could not write the configuration file.'
  }
  var FIELDS = [['merchant_id', 'Merchant ID'], ['terminal_id', 'Terminal ID']]
  var ENVS = [['test', 'Test'], ['production', 'Live']]

  function call(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, body: j } }) })
  }

  function el(tag, css, text) {
    var n = document.createElement(tag)
    if (css) n.style.cssText = css
    if (text != null) n.textContent = text
    return n
  }

  function build() {
    var card = el('div', 'margin-top:1.25rem;border:1px solid #cbd5e1;border-radius:1rem;padding:1rem 1.1rem;background:#f8fafc')
    card.setAttribute(MARK, '1')
    card.appendChild(el('p', 'font-size:.875rem;font-weight:700;color:#0f172a;margin:0', 'Merchant ID and Terminal ID'))
    card.appendChild(el('p', 'font-size:.75rem;color:#64748b;margin:.25rem 0 .75rem', 'Identifiers from the bank, kept with this configuration. KNET takes payment with the Tranportal ID above; these are for your records and the bank’s paperwork. They follow the Test / Production switch.'))

    var inputs = {}
    var grid = el('div', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem')
    var badges = {}
    ENVS.forEach(function (e) {
      var col = el('div', 'min-width:0')
      var h = el('p', 'font-size:.75rem;font-weight:700;color:#475569;margin:0 0 .4rem;display:flex;align-items:center;gap:.5rem', e[1] + ' mode')
      var badge = el('span', 'display:none;border-radius:9999px;background:#e0e7ff;color:#3730a3;padding:.05rem .5rem;font-size:.65rem;font-weight:700', 'Active')
      badges[e[0]] = badge
      h.appendChild(badge)
      col.appendChild(h)
      FIELDS.forEach(function (f) {
        var label = el('label', 'display:block;margin-bottom:.6rem')
        label.appendChild(el('span', 'display:block;font-size:.7rem;font-weight:700;color:#475569;margin-bottom:.2rem', e[1] + ' ' + f[1]))
        var input = el('input', 'width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:.75rem;background:#fff;padding:.6rem .75rem;font-family:ui-monospace,monospace;font-size:.8rem')
        input.type = 'text'
        input.maxLength = 40
        input.autocomplete = 'off'
        input.spellcheck = false
        input.setAttribute('autocapitalize', 'none')
        input.placeholder = 'Not set'
        input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); save.click() } })
        input.addEventListener('input', function () { status.textContent = ''; status.style.color = '#64748b' })
        inputs[e[0] + '_' + f[0]] = input
        label.appendChild(input)
        col.appendChild(label)
      })
      grid.appendChild(col)
    })
    card.appendChild(grid)

    var row = el('div', 'display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin-top:.25rem')
    var save = el('button', 'min-height:2.75rem;border:0;border-radius:.75rem;background:#4f46e5;color:#fff;font-weight:700;font-size:.8rem;padding:.5rem 1rem;cursor:pointer', 'Save IDs')
    save.type = 'button'
    var status = el('span', 'font-size:.75rem;color:#64748b', 'Loading…')
    row.appendChild(save)
    row.appendChild(status)
    card.appendChild(row)

    function show(body) {
      ENVS.forEach(function (e) {
        FIELDS.forEach(function (f) { inputs[e[0] + '_' + f[0]].value = (body[e[0]] && body[e[0]][f[0]]) || '' })
        badges[e[0]].style.display = body.env === e[0] ? 'inline-block' : 'none'
      })
    }
    function fail(r) {
      var err = r.body && r.body.error
      status.style.color = '#be123c'
      status.textContent = MSG[err] || ('Could not save' + (err ? ' (' + err + ')' : '') + '.')
    }

    call('payment_identifiers').then(function (r) {
      if (r.ok && r.body && r.body.test) { show(r.body); status.textContent = '' } else { fail(r) }
    })
    save.addEventListener('click', function () {
      var body = {}
      Object.keys(inputs).forEach(function (k) { body[k] = inputs[k].value.trim() })
      save.disabled = true
      status.style.color = '#64748b'
      status.textContent = 'Saving…'
      call('payment_identifiers', body).then(function (r) {
        save.disabled = false
        if (r.ok && r.body && r.body.test) { show(r.body); status.style.color = '#c2410c'; status.textContent = 'Saved.' } else { fail(r) }
      })
    })
    return card
  }

  function scan() {
    var forms = document.querySelectorAll('form.payment-gateway-editor')
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i]
      if (!form.querySelector('.payment-knet-toggle-row')) continue       // T-Pay's editor
      if (form.querySelector('[' + MARK + ']')) continue
      var grid = form.querySelector(':scope > .grid')
      if (!grid) continue
      grid.parentNode.insertBefore(build(), grid.nextSibling)
    }
  }

  var queued = false
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; scan() }) }
  function start() { scan(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()


/* ---------------------------------------------------------------------------
 * 3. Payments > T-Pay editor: Merchant Server IP 1 and 2.
 *
 * CBK registers two server addresses per merchant and checks the caller
 * against them; no request carries them, so the compiled editor says they are
 * "intentionally not stored here". This adds a card after its field grid that
 * stores them (admin.php?r=payment_server_ips) so the operator can see what is
 * registered. Same rules as the KNET card above: textContent only, inline
 * styles, saved on its own, Enter does not submit the editor's own form.
 * ------------------------------------------------------------------------ */
;(function () {
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  var API = '/api/admin.php'
  var MARK = 'data-sporta-tpay-ips'
  var MSG = {
    invalid_server_ip: 'That is not a valid IP address. Use an IPv4 like 203.0.113.10 or an IPv6 address, or leave the box empty.',
    config_missing: 'The T-Pay configuration file is missing on the server.',
    not_signed_in: 'Your session ended. Sign in again.',
    config_not_writable: 'The server could not write the configuration file.'
  }

  function call(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, body: j } }) })
  }
  function el(tag, css, text) {
    var n = document.createElement(tag)
    if (css) n.style.cssText = css
    if (text != null) n.textContent = text
    return n
  }

  function build() {
    var card = el('div', 'margin-top:1.25rem;border:1px solid #cbd5e1;border-radius:1rem;padding:1rem 1.1rem;background:#f8fafc')
    card.setAttribute(MARK, '1')
    card.appendChild(el('p', 'font-size:.875rem;font-weight:700;color:#0f172a;margin:0', 'Merchant Server IP 1 and 2'))
    card.appendChild(el('p', 'font-size:.75rem;color:#64748b;margin:.25rem 0 .75rem', 'The server addresses registered with CBK during onboarding. They are an allowlist on CBK’s side and are not sent in payment requests; they are kept here as a record.'))

    var inputs = {}
    var grid = el('div', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem')
    ;[['server_ip_1', 'Merchant Server IP 1'], ['server_ip_2', 'Merchant Server IP 2']].forEach(function (f) {
      var label = el('label', 'display:block')
      label.appendChild(el('span', 'display:block;font-size:.7rem;font-weight:700;color:#475569;margin-bottom:.2rem', f[1]))
      var input = el('input', 'width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:.75rem;background:#fff;padding:.6rem .75rem;font-family:ui-monospace,monospace;font-size:.8rem')
      input.type = 'text'
      input.maxLength = 45
      input.autocomplete = 'off'
      input.spellcheck = false
      input.setAttribute('inputmode', 'decimal')
      input.placeholder = 'Not set'
      input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); save.click() } })
      input.addEventListener('input', function () { status.textContent = ''; status.style.color = '#64748b' })
      inputs[f[0]] = input
      label.appendChild(input)
      grid.appendChild(label)
    })
    card.appendChild(grid)

    var row = el('div', 'display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin-top:.75rem')
    var save = el('button', 'min-height:2.75rem;border:0;border-radius:.75rem;background:#4f46e5;color:#fff;font-weight:700;font-size:.8rem;padding:.5rem 1rem;cursor:pointer', 'Save IPs')
    save.type = 'button'
    var status = el('span', 'font-size:.75rem;color:#64748b', 'Loading…')
    row.appendChild(save)
    row.appendChild(status)
    card.appendChild(row)

    function show(b) { Object.keys(inputs).forEach(function (k) { inputs[k].value = b[k] || '' }) }
    function fail(r) {
      var err = r.body && r.body.error
      status.style.color = '#be123c'
      status.textContent = MSG[err] || ('Could not save' + (err ? ' (' + err + ')' : '') + '.')
    }
    call('payment_server_ips').then(function (r) {
      if (r.ok && r.body && 'server_ip_1' in r.body) { show(r.body); status.textContent = '' } else { fail(r) }
    })
    save.addEventListener('click', function () {
      var body = {}
      Object.keys(inputs).forEach(function (k) { body[k] = inputs[k].value.trim() })
      save.disabled = true
      status.style.color = '#64748b'
      status.textContent = 'Saving…'
      call('payment_server_ips', body).then(function (r) {
        save.disabled = false
        if (r.ok && r.body && 'server_ip_1' in r.body) { show(r.body); status.style.color = '#c2410c'; status.textContent = 'Saved.' } else { fail(r) }
      })
    })
    return card
  }

  function scan() {
    var forms = document.querySelectorAll('form.payment-gateway-editor')
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i]
      if (form.querySelector('.payment-knet-toggle-row')) continue        // KNET's editor
      if (form.querySelector('[' + MARK + ']')) continue
      var grid = form.querySelector(':scope > .grid')
      if (!grid) continue
      grid.parentNode.insertBefore(build(), grid.nextSibling)
    }
  }

  var queued = false
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; scan() }) }
  function start() { scan(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
