/**
 * A full backup of the shop's own data, downloadable and restorable from the
 * WEBSITE's /backends Settings screen.
 *
 * WHAT THIS IS. Everything a restore needs — the catalogue, orders, customers,
 * blocked numbers, reviews, discounts, hero slides, the nine "rules" settings,
 * admin accounts and the taught assistant answers — as ONE downloadable JSON
 * file the owner can store anywhere and hand back later. See admin.php's own
 * comment above `const BACKUP_TABLES` for exactly what is in it, what is
 * deliberately never in it (config.php, KNET/CBK credentials, Wallet certs —
 * none of them database rows, so this route cannot leak them even by
 * accident — and the second-factor secret, which is dropped on export so a
 * copy of this file can never be used to sign in as the owner), and why a
 * restore REPLACES rather than merges.
 *
 * WHY AN OVERLAY. Same reasoning as rules.js and crm.js beside it: the
 * website's /backends is a prebuilt bundle with no source in this repository,
 * a different program from the app's own panel, and the pattern is add a
 * card, touch nothing that exists, do nothing outside the screen it belongs
 * to.
 *
 * PREVIEW BEFORE ANYTHING WRITES. Choosing a file only ever calls
 * ?r=backup_preview, which runs selects and nothing else — admin.php's own
 * comment on that route says so and this file relies on it being true.
 * Nothing is written until "Restore now" is pressed, and that button stays
 * disabled until a preview has come back AND the owner has ticked the box
 * saying they understand this REPLACES the shop's data. That is the "second,
 * explicit, hard-to-misclick action" this feature was built to have: not one
 * button doing two things, but a checkbox that has to be ticked before a
 * second, separately-labelled button becomes pressable at all.
 *
 * "SAVE" NEVER APPEARS ON EITHER BUTTON. panel-save-bar.js finds a card by any
 * button whose label starts with "save" and presses it on the owner's behalf
 * whenever something on the Settings screen was touched. Restoring the whole
 * shop is not something a bar that also nudges "Save colours" should ever be
 * able to trigger as a side effect of an unrelated edit, so neither button
 * here is named that way and the bar's own discovery never finds this card.
 *
 * THE TOKEN IS NOT SECRECY, IT IS SEQUENCING. admin.php's backup_import route
 * requires the exact sha256 backup_preview computed over the same file, and
 * that check exists purely to force "preview, then restore" as a shape the
 * SERVER enforces — see backup_token()'s own comment in admin.php for why no
 * server-side session state was available to do this instead.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var card = null
  var state = {
    busy: false,
    exporting: false,
    fileName: '',
    data: null,        // the parsed backup file, kept only in memory
    preview: null,      // the last backup_preview response
    understood: false,
    note: '',
    result: null,       // the last backup_import response
  }

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

  var TABLE_NAMES = {
    brands: 'Brands', products: 'Products', product_variants: 'Sizes in stock',
    product_images: 'Product photos', customers: 'Customer accounts',
    orders: 'Orders', order_items: 'Order items', reviews: 'Reviews',
    discounts: 'Discount codes', blocked_customers: 'Blocked numbers',
    hero_slides: 'Hero slides', settings: 'Site settings & rules',
    admin_users: 'Admin accounts', assistant_qa: 'Taught assistant answers',
  }

  function explain(err) {
    var s = String(err || '')
    if (s === 'bad_backup_file') return 'That is not a Sporta backup file — it has no readable table data.'
    if (s === 'confirm_required') return 'Tick the box confirming you understand this replaces the shop’s data.'
    if (s === 'stale_or_missing_preview') {
      return 'That preview is out of date. Choose the file again to preview it fresh, then restore.'
    }
    if (s === 'restore_failed') return 'The restore failed partway through and was rolled back. Nothing was changed.'
    if (s === 'not_signed_in') return 'Your session has ended. Sign in again.'
    return s
  }

  /* ---------------------------------------------------------------- export - */

  function doExport() {
    if (state.exporting) return
    state.exporting = true
    render()
    ask('backup_export').then(function (res) {
      state.exporting = false
      if (!res || res.error) {
        state.note = explain(res && res.error)
        render()
        return
      }
      var blob = new Blob([JSON.stringify(res)], { type: 'application/json' })
      var url = URL.createObjectURL(blob)
      var a = document.createElement('a')
      var stamp = (res.exported_at || new Date().toISOString()).slice(0, 10)
      a.href = url
      a.download = 'sporta-backup-' + stamp + '.json'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Freed on the next tick — Safari has been seen to cancel a download
      // started from a URL revoked in the same turn.
      setTimeout(function () { URL.revokeObjectURL(url) }, 4000)
      state.note = 'Backup downloaded.'
      render()
    }).catch(function () {
      state.exporting = false
      state.note = 'The export did not reach the shop. Check the connection and try again.'
      render()
    })
  }

  /* -------------------------------------------------------- choose a file - */

  function onFile(file) {
    state.data = null
    state.preview = null
    state.result = null
    state.understood = false
    state.fileName = file.name
    state.note = 'Reading…'
    render()

    var reader = new FileReader()
    reader.onload = function () {
      var parsed
      try { parsed = JSON.parse(String(reader.result)) } catch (e) { parsed = null }
      if (!parsed || typeof parsed !== 'object' || !parsed.tables) {
        state.note = 'That file is not readable as a Sporta backup.'
        render()
        return
      }
      state.data = parsed
      state.note = 'Previewing — nothing is written yet…'
      state.busy = true
      render()
      ask('backup_preview', { data: parsed }).then(function (res) {
        state.busy = false
        if (!res || res.error) {
          state.note = explain(res && res.error)
          state.data = null
          render()
          return
        }
        state.preview = res
        state.note = ''
        render()
      }).catch(function () {
        state.busy = false
        state.note = 'The preview did not reach the shop. Check the connection and try again.'
        state.data = null
        render()
      })
    }
    reader.onerror = function () {
      state.note = 'Could not read that file.'
      render()
    }
    reader.readAsText(file)
  }

  /* --------------------------------------------------------------- restore - */

  function doRestore() {
    if (state.busy || !state.data || !state.preview || !state.understood) return
    state.busy = true
    state.note = ''
    render()
    ask('backup_import', { data: state.data, confirm: true, token: state.preview.token }).then(function (res) {
      state.busy = false
      if (!res || res.error) {
        state.note = explain(res && res.error)
        render()
        return
      }
      state.result = res
      // A restored file must be previewed again before it can be restored a
      // second time — this is what stops a double click, or a lingering tab,
      // from restoring the same file twice in a row on stale state.
      state.data = null
      state.preview = null
      state.understood = false
      state.note = 'Restored. This screen may show the shop’s OLD numbers until it is reopened.'
      render()
    }).catch(function () {
      state.busy = false
      state.note = 'The restore did not reach the shop. Nothing here confirms it happened — check the shop before trying again.'
      render()
    })
  }

  /* ----------------------------------------------------------------- draw - */

  function diffRow(table, d) {
    var row = el('div', 'bkp-row')
    row.appendChild(el('span', 'bkp-row-name', TABLE_NAMES[table] || table))
    var counts = el('span', 'bkp-row-counts')
    if (d.added) counts.appendChild(el('span', 'bkp-add', '+' + d.added))
    if (d.changed) counts.appendChild(el('span', 'bkp-chg', '~' + d.changed))
    if (d.removed) counts.appendChild(el('span', 'bkp-rem', '−' + d.removed))
    if (!d.added && !d.changed && !d.removed) counts.appendChild(el('span', 'bkp-same', 'no change'))
    row.appendChild(counts)
    return row
  }

  function render() {
    if (!card) return
    card.textContent = ''

    card.appendChild(el('h3', 'bkp-h', 'Backup'))
    card.appendChild(el('p', 'bkp-sub',
      'Download everything the shop stores, or restore from a file you already downloaded.'))

    var exportRow = el('div', 'bkp-foot')
    var exportBtn = el('button', 'bkp-btn', state.exporting ? 'Preparing…' : 'Download backup')
    exportBtn.type = 'button'
    exportBtn.disabled = state.exporting
    exportBtn.addEventListener('click', doExport)
    exportRow.appendChild(exportBtn)
    card.appendChild(exportRow)

    card.appendChild(el('div', 'bkp-divider'))

    var warn = el('p', 'bkp-warn',
      'Restoring REPLACES the shop’s current data with what is in the file, table by '
      + 'table — anything added or changed since the file was made is lost, exactly like '
      + 'the file was made. It does not merge the two.')
    card.appendChild(warn)

    var pick = el('label', 'bkp-pick')
    pick.appendChild(el('span', null, state.fileName || 'Choose a backup file…'))
    var input = el('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.style.display = 'none'
    input.disabled = state.busy
    input.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) onFile(e.target.files[0])
    })
    pick.appendChild(input)
    var pickBtn = el('button', 'bkp-btn bkp-btn-outline', 'Choose file')
    pickBtn.type = 'button'
    pickBtn.disabled = state.busy
    pickBtn.addEventListener('click', function () { input.click() })
    var pickWrap = el('div', 'bkp-foot')
    pickWrap.appendChild(pickBtn)
    pickWrap.appendChild(pick.firstChild)
    card.appendChild(pickWrap)

    if (state.preview) {
      var box = el('div', 'bkp-preview')
      box.appendChild(el('p', 'bkp-preview-h', 'What restoring this file would do:'))
      if (state.preview.unknown_tables && state.preview.unknown_tables.length) {
        box.appendChild(el('p', 'bkp-warn',
          'This file also names tables this shop’s schema does not have — '
          + state.preview.unknown_tables.join(', ') + ' — and those would be skipped.'))
      }
      var tables = state.preview.tables || {}
      Object.keys(tables).forEach(function (t) {
        box.appendChild(diffRow(t, tables[t]))
      })
      card.appendChild(box)

      var confirm = el('label', 'bkp-confirm')
      var cb = el('input')
      cb.type = 'checkbox'
      cb.checked = state.understood
      cb.disabled = state.busy
      cb.addEventListener('change', function (e) {
        state.understood = e.target.checked
        render()
      })
      confirm.appendChild(cb)
      confirm.appendChild(el('span', null,
        'I understand this replaces the shop’s current data with this file.'))
      card.appendChild(confirm)

      var restoreBtn = el('button', 'bkp-btn bkp-btn-danger',
        state.busy ? 'Restoring…' : 'Restore now')
      restoreBtn.type = 'button'
      restoreBtn.disabled = state.busy || !state.understood
      restoreBtn.addEventListener('click', doRestore)
      var restoreRow = el('div', 'bkp-foot')
      restoreRow.appendChild(restoreBtn)
      card.appendChild(restoreRow)
    }

    if (state.result) {
      var doneBox = el('div', 'bkp-preview')
      doneBox.appendChild(el('p', 'bkp-preview-h', 'Restored:'))
      var rt = state.result.tables || {}
      Object.keys(rt).forEach(function (t) {
        doneBox.appendChild(diffRow(t, { added: rt[t].written, changed: 0, removed: 0 }))
      })
      card.appendChild(doneBox)
    }

    if (state.note) card.appendChild(el('p', 'bkp-note', state.note))
  }

  /* --------------------------------------------------------------- chrome - */

  var CSS = ''
    + '.bkp{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;'
    + 'background:var(--card,rgba(255,255,255,.03))}'
    + '.bkp-h{margin:0 0 4px;font-size:16px}'
    + '.bkp-sub{margin:0 0 14px;opacity:.7;font-size:13px}'
    + '.bkp-divider{height:1px;background:var(--border,#2a2d31);margin:16px 0}'
    + '.bkp-warn{font-size:13px;line-height:1.5;color:#e0561c;margin:0 0 12px}'
    + '.bkp-foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center}'
    + '.bkp-btn{padding:9px 16px;border-radius:8px;border:0;cursor:pointer;'
    + 'background:var(--brand,#e0561c);color:#fff;font:inherit;font-weight:600}'
    + '.bkp-btn[disabled]{opacity:.5;cursor:default}'
    + '.bkp-btn-outline{background:transparent;color:inherit;border:1px solid var(--border,#2a2d31)}'
    + '.bkp-btn-danger{background:#b3261e}'
    + '.bkp-pick{display:none}'
    + '.bkp-preview{margin-top:16px;border-top:1px solid var(--border,#2a2d31);padding-top:12px}'
    + '.bkp-preview-h{margin:0 0 8px;font-size:13px;font-weight:600}'
    + '.bkp-row{display:flex;justify-content:space-between;gap:10px;font-size:13px;padding:3px 0}'
    + '.bkp-row-name{opacity:.85}'
    + '.bkp-row-counts{display:flex;gap:8px;font-variant-numeric:tabular-nums}'
    + '.bkp-add{color:#3ba55d}.bkp-chg{color:#d9a441}.bkp-rem{color:#e05656}.bkp-same{opacity:.5}'
    + '.bkp-confirm{display:flex;align-items:flex-start;gap:8px;margin-top:14px;font-size:13px;line-height:1.5;cursor:pointer}'
    + '.bkp-note{margin:12px 0 0;font-size:13px;line-height:1.5}'

  function style() {
    if (document.getElementById('bkp-css')) return
    var s = document.createElement('style')
    s.id = 'bkp-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  /** The Settings screen, and only it — same anchor rules.js uses. */
  function settingsHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
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
        busy = false
      }
      return
    }
    if (card && card.parentNode) return

    busy = true
    style()
    card = el('div', 'bkp')
    var anchor = head.parentNode
    anchor.parentNode.insertBefore(card, anchor.nextSibling)
    render()
    busy = false
  }

  function boot() {
    place()
    new MutationObserver(place).observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
