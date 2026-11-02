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
  var ENVS = [['test', 'Test'], ['production', 'Production']]

  function call(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, body: j } }) })
  }


  // Borrow the compiled editor's OWN classes, read from the form at run time,
  // so these fields sit in the same two columns, at the same size, as the
  // form's fields above them (and follow a future rebuild of the admin). The
  // literal strings are the live admin's classes on 2026-11-02, used only if
  // the form has no field to copy from.
  function borrow(form) {
    var grid = form.querySelector(':scope > .grid')
    var lab = grid && grid.querySelector('label')
    var span = lab && lab.querySelector('span')
    var input = lab && lab.querySelector('input:not([type=checkbox])')
    var btns = form.querySelectorAll('button')
    var save = null
    for (var i = btns.length - 1; i >= 0; i--) { if (!btns[i].closest('[data-sporta-knet-ids],[data-sporta-tpay-ips]') && /save/i.test(btns[i].textContent)) { save = btns[i]; break } }
    var pick = function (node, fallback) { return (node && typeof node.className === 'string' && node.className.trim()) || fallback }
    return {
      grid: pick(grid, 'mt-5 grid gap-4 md:grid-cols-2'),
      label: pick(lab, 'block'),
      span: pick(span, 'payment-secret-field__label flex items-center justify-between gap-3 text-xs font-bold text-slate-600'),
      input: pick(input, 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'),
      button: pick(save, 'min-h-11 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50 sm:w-auto')
    }
  }
  function cls(tag, className, text) {
    var n = document.createElement(tag)
    if (className) n.className = className
    if (text != null) n.textContent = text
    return n
  }
  // The section frame, heading and save row use the classes of the editor's
  // own save row and toggle copy (border-t / pt-4 / text-sm font-bold ...).
  var SECTION = 'mt-5 border-t border-slate-100 pt-4'
  var TITLE = 'text-sm font-bold text-slate-900'
  var NOTE = 'mt-0.5 text-xs text-slate-500'
  var ROW = 'mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between'
  var STATUS = 'text-xs text-slate-500'

  function build(form) {
    var c = borrow(form)
    var card = cls('div', SECTION)
    card.setAttribute(MARK, '1')
    card.appendChild(cls('p', TITLE, 'Merchant ID and Terminal ID'))
    card.appendChild(cls('p', NOTE, 'Identifiers from the bank, kept with this configuration. KNET takes payment with the Tranportal ID above; these are for your records and the bank’s paperwork. They follow the Test / Production switch.'))

    var inputs = {}
    var badges = { test: [], production: [] }
    var grid = cls('div', c.grid)
    ENVS.forEach(function (e) {
      FIELDS.forEach(function (f) {
        var label = cls('label', c.label)
        var head = cls('span', c.span, e[1] + ' ' + f[1])
        var badge = cls('span', 'payment-secret-field__state', 'Active')
        badge.style.color = '#4338ca'
        badge.style.display = 'none'
        badges[e[0]].push(badge)
        head.appendChild(badge)
        label.appendChild(head)
        var input = cls('input', c.input)
        input.type = 'text'
        input.maxLength = 40
        input.autocomplete = 'off'
        input.spellcheck = false
        input.setAttribute('autocapitalize', 'none')
        input.setAttribute('dir', 'ltr')
        input.placeholder = 'Not set'
        input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); save.click() } })
        input.addEventListener('input', function () { status.textContent = ''; status.style.color = '' })
        inputs[e[0] + '_' + f[0]] = input
        label.appendChild(input)
        grid.appendChild(label)
      })
    })
    card.appendChild(grid)

    var row = cls('div', ROW)
    var status = cls('p', STATUS, 'Loading…')
    var save = cls('button', c.button, 'Save IDs')
    save.type = 'button'
    row.appendChild(status)
    row.appendChild(save)
    card.appendChild(row)

    function show(body) {
      ENVS.forEach(function (e) {
        FIELDS.forEach(function (f) { inputs[e[0] + '_' + f[0]].value = (body[e[0]] && body[e[0]][f[0]]) || '' })
        badges[e[0]].forEach(function (b) { b.style.display = body.env === e[0] ? '' : 'none' })
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
      status.style.color = ''
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
      grid.parentNode.insertBefore(build(form), grid.nextSibling)
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
    tpay_credentials_required: 'Save the T-Pay Client ID, Client Secret and Encrypted Account Key first.',
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

  // Borrow the compiled editor's OWN classes, read from the form at run time,
  // so these fields sit in the same two columns, at the same size, as the
  // form's fields above them (and follow a future rebuild of the admin). The
  // literal strings are the live admin's classes on 2026-11-02, used only if
  // the form has no field to copy from.
  function borrow(form) {
    var grid = form.querySelector(':scope > .grid')
    var lab = grid && grid.querySelector('label')
    var span = lab && lab.querySelector('span')
    var input = lab && lab.querySelector('input:not([type=checkbox])')
    var btns = form.querySelectorAll('button')
    var save = null
    for (var i = btns.length - 1; i >= 0; i--) { if (!btns[i].closest('[data-sporta-knet-ids],[data-sporta-tpay-ips]') && /save/i.test(btns[i].textContent)) { save = btns[i]; break } }
    var pick = function (node, fallback) { return (node && typeof node.className === 'string' && node.className.trim()) || fallback }
    return {
      grid: pick(grid, 'mt-5 grid gap-4 md:grid-cols-2'),
      label: pick(lab, 'block'),
      span: pick(span, 'payment-secret-field__label flex items-center justify-between gap-3 text-xs font-bold text-slate-600'),
      input: pick(input, 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'),
      button: pick(save, 'min-h-11 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50 sm:w-auto')
    }
  }
  function cls(tag, className, text) {
    var n = document.createElement(tag)
    if (className) n.className = className
    if (text != null) n.textContent = text
    return n
  }
  // The section frame, heading and save row use the classes of the editor's
  // own save row and toggle copy (border-t / pt-4 / text-sm font-bold ...).
  var SECTION = 'mt-5 border-t border-slate-100 pt-4'
  var TITLE = 'text-sm font-bold text-slate-900'
  var NOTE = 'mt-0.5 text-xs text-slate-500'
  var ROW = 'mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between'
  var STATUS = 'text-xs text-slate-500'

  // The KNET editor's on/off row, without its marker class (the KNET scan
  // finds its editor by that class, so it must not appear in T-Pay's).
  function toggleRowClass() {
    var row = document.querySelector('.payment-knet-toggle-row')
    var c = row && typeof row.className === 'string' ? row.className.replace(/\bpayment-knet-toggle-row\b/, '').replace(/\s+/g, ' ').trim() : ''
    return c || 'mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 border-slate-200 bg-slate-50'
  }

  function build(form) {
    var c = borrow(form)
    var card = cls('div', SECTION)
    card.setAttribute(MARK, '1')
    card.appendChild(cls('p', TITLE, 'Merchant Server IP 1 and 2'))
    card.appendChild(cls('p', NOTE, 'The server addresses registered with CBK during onboarding. They are an allowlist on CBK’s side and are not sent in payment requests; they are kept here as a record.'))

    var inputs = {}
    var grid = cls('div', c.grid)
    ;[['server_ip_1', 'Merchant Server IP 1'], ['server_ip_2', 'Merchant Server IP 2']].forEach(function (f) {
      var label = cls('label', c.label)
      label.appendChild(cls('span', c.span, f[1]))
      var input = cls('input', c.input)
      input.type = 'text'
      input.maxLength = 45
      input.autocomplete = 'off'
      input.spellcheck = false
      input.setAttribute('inputmode', 'decimal')
      input.setAttribute('dir', 'ltr')
      input.placeholder = 'Not set'
      input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); save.click() } })
      input.addEventListener('input', function () { status.textContent = ''; status.style.color = '' })
      inputs[f[0]] = input
      label.appendChild(input)
      grid.appendChild(label)
    })
    card.appendChild(grid)

    var row = cls('div', ROW)
    var status = cls('p', STATUS, 'Loading…')
    var save = cls('button', c.button, 'Save IPs')
    save.type = 'button'
    row.appendChild(status)
    row.appendChild(save)
    card.appendChild(row)

    // KNET through this CBK setup: laid out like the KNET editor's on/off row.
    var via = cls('label', toggleRowClass())
    via.style.cursor = 'pointer'
    var viaText = cls('div', 'min-w-0')
    viaText.style.flex = '1 1 16rem'
    viaText.appendChild(cls('p', TITLE, 'Take KNET payments through this CBK setup'))
    viaText.appendChild(cls('p', NOTE, 'One setup for both: KNET and T-Pay use the same Client ID, Client Secret and Encrypted Account Key, and KNET orders are sent to CBK’s page as KNET only. The separate Tranportal ID, password and resource key are not used while this is on. Needs the T-Pay credentials above to be saved first.'))
    var viaStatus = cls('p', 'mt-0.5 text-xs', '')
    viaText.appendChild(viaStatus)
    var viaBox = document.createElement('input')
    viaBox.type = 'checkbox'
    viaBox.disabled = true
    viaBox.style.cssText = 'width:1.5rem;height:1.5rem;flex:none;accent-color:#4f46e5;cursor:pointer'
    via.appendChild(viaText)
    via.appendChild(viaBox)
    card.appendChild(via)
    call('payment_knet_via_cbk').then(function (r) {
      if (r.ok && r.body && 'enabled' in r.body) { viaBox.checked = !!r.body.enabled; viaBox.disabled = false } else { viaStatus.textContent = MSG[r.body && r.body.error] || 'Could not read this setting.' }
    })
    viaBox.addEventListener('change', function () {
      var want = viaBox.checked
      viaBox.disabled = true
      viaStatus.style.color = '#64748b'
      viaStatus.textContent = 'Saving…'
      call('payment_knet_via_cbk', { enabled: want }).then(function (r) {
        viaBox.disabled = false
        if (r.ok && r.body && 'enabled' in r.body) {
          viaBox.checked = !!r.body.enabled
          viaStatus.style.color = '#c2410c'
          viaStatus.textContent = r.body.enabled ? 'On: KNET orders now pay through CBK.' : 'Off: KNET uses its own Tranportal setup.'
        } else {
          viaBox.checked = !want
          viaStatus.style.color = '#be123c'
          viaStatus.textContent = MSG[r.body && r.body.error] || 'Could not save.'
        }
      })
    })

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
      status.style.color = ''
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
      grid.parentNode.insertBefore(build(form), grid.nextSibling)
    }
  }

  var queued = false
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; scan() }) }
  function start() { scan(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
