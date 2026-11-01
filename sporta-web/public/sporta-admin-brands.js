/* Sporta — "Remove" button on each brand in the admin (add-on for the compiled
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
