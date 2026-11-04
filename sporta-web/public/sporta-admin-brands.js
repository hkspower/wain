/* Several add-ons for the compiled live admin live in this file, because this is
 * the only admin script the live index.html loads (a new file name would not
 * be loaded without editing that page, whose source is not in the repo):
 *   1. the Brands screen: a "Remove" button, a product count and a "View on
 *      site" link on each brand, and a "Tag products with a brand" panel
 *      (below);
 *   2. Merchant ID / Terminal ID card in Payments > KNET editor (second block,
 *      after the brands one);
 *   3. Merchant Server IP 1 / 2 card in Payments > T-Pay editor (third block);
 *   4. the sign-in screen's session line, which still says 8 hours (fourth block);
 *   then two later blocks with their own comments: the Save bar on every
 *   screen, and "6. Photos", the bulk product-photo uploader (last block).
 *
 * 1. Brands (add-on for the compiled live admin bundle, whose source is not in
 * the repo; the Remove button also exists in src/admin/Brands.jsx for the next
 * real build).
 *
 * Only runs on /backends. It watches for the Brands screen (a <ul> of cards,
 * each with a "Shown/Hidden" checkbox, an Edit button and the brand's web
 * address in monospace — "/brand/<slug>" on the live admin), and reads two
 * admin routes: r=brands (id, slug, names, products = every product tagged
 * with it, products_active = the listed ones) and r=brand_products (slug,
 * names, brand_slug, active, category for every product, shown or hidden).
 *
 *  - Remove: confirms, then POSTs brand_delete — the server refuses while any
 *    product still uses the brand and the message is shown. The card is HIDDEN
 *    on success, not removed: React owns that <li>, and pulling a node React
 *    owns out of the page is how its next re-render throws.
 *    FIXED 2026-11-02: the slug was read verbatim from the monospace line,
 *    which on the live admin says "/brand/vanquish" — so the id lookup (keyed
 *    by "vanquish") never matched and every Remove answered "Could not find
 *    this brand". Both spellings are accepted now.
 *  - Under the web address: "{n} products · {m} shown" and a link to the
 *    brand's real page, /shop?brand=<slug> (/brand/<slug> is a 404 on the
 *    storefront). A SHOWN brand with nothing listed (m = 0) says so in rose:
 *    that is a home page tile that opens an empty shop page. A hidden brand
 *    has no tile, so it gets the counts without the warning.
 *  - Above the list, ONE panel. Suggestions: every untagged product whose
 *    name or web name contains a brand's name as a whole word ("Vanquish
 *    T-Shirt — White" → Vanquish), pre-ticked; a brand whose word is in more
 *    than 80% of all products is skipped, so the house brand cannot claim the
 *    whole catalogue. And a manual tagger: a brand, a filter, a ticked list.
 *    Both POST brand_assign {brand_slug, products} (grouped by brand, at most
 *    200 per request), then re-read both routes and redraw in place. Untagging,
 *    or replacing a product's other brand, asks first. Enter on any input in
 *    the panel is stopped, so it can never submit a form around the screen.
 *  - Both routes are read again whenever the screen is entered (tags may have
 *    changed in the Catalogue editor) and when a card shows a slug the last
 *    answer did not have (a brand just added or renamed) — once per set of
 *    unknown slugs, so a slug the server does not know cannot loop.
 *
 * External file on purpose: the CSP allows scripts from 'self' only. Every
 * request carries the admin session cookie and the X-Sporta-Admin header,
 * exactly like the admin's own calls. DOM is built with textContent only.
 */
(function () {
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  var API = '/api/admin.php'
  var MARK = 'data-sporta-remove'
  var STATS = 'data-sporta-brand-stats'
  var PANEL = 'data-sporta-brand-tagger'
  var brands = null        // admin r=brands rows
  var products = null      // admin r=brand_products rows
  var productsErr = ''     // why the product list could not be read
  var tried = false        // first load started (never re-asked on every mutation)
  var onScreen = false     // the Brands screen was on the page at the last scan
  var askedFor = ''        // the unknown card slugs the last reload was asked for
  var pending = null
  var version = 0          // bumped on every load; cards and panel redraw when it moves
  var panel = null         // built once; React may drop it and it is put back as it was

  function call(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, body: j } })
    }).catch(function () { return { ok: false, status: 0, body: null } })
  }
  function rowsOf(j) {
    if (Array.isArray(j)) return j
    if (j && Array.isArray(j.data)) return j.data
    if (j && Array.isArray(j.products)) return j.products
    return null
  }
  function errCode(r) { return (r.body && r.body.error) || (r.status ? 'HTTP ' + r.status : 'network') }

  function load() {
    tried = true
    if (pending) return pending
    pending = Promise.all([call('brands'), call('brand_products')]).then(function (rs) {
      var b = rowsOf(rs[0].body), p = rowsOf(rs[1].body)
      if (b) brands = b
      if (p) { products = p; productsErr = '' } else if (!products) productsErr = errCode(rs[1])
      version++
      pending = null
      schedule()
    })
    return pending
  }
  /** Load again AFTER any request already in flight: that one may predate a write. */
  function reload() { return (pending || Promise.resolve()).then(function () { return load() }) }
  function brand(slug) {
    for (var i = 0; brands && i < brands.length; i++) if (brands[i] && brands[i].slug === slug) return brands[i]
    return null
  }
  function brandName(slug) { var b = brand(slug); return b ? String(b.name_en || b.slug) : slug }
  function count(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0 }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many) }

  /** The brand's slug from its card: "/brand/vanquish" (live admin) or "vanquish". */
  function slugOf(li) {
    var el = li.querySelector('p.font-mono')
    var t = el ? String(el.textContent || '').trim() : ''
    return t.replace(/^\/?brands?\//i, '').replace(/^\/+|\/+$/g, '')
  }
  function editButton(li) {
    var btns = li.querySelectorAll('button')
    for (var j = 0; j < btns.length; j++) if (btns[j].textContent.trim() === 'Edit') return btns[j]
    return null
  }
  /** The brand cards on screen: a checkbox, a monospace web address and an Edit button. */
  function cards() {
    var out = [], items = document.querySelectorAll('main li')
    for (var i = 0; i < items.length; i++) {
      var li = items[i]
      if (li.closest('[' + PANEL + ']') || li.hasAttribute('data-sporta-removed')) continue
      if (!li.querySelector('input[type=checkbox]') || !li.querySelector('p.font-mono')) continue
      var edit = editButton(li)
      if (edit) out.push({ li: li, edit: edit })
    }
    return out
  }
  function el(tag, className, text, css) {
    var n = document.createElement(tag)
    if (className) n.className = className
    if (css) n.style.cssText = css
    if (text != null) n.textContent = text
    return n
  }

  // ------------------------------------------------------------------ Remove
  var MSG_REMOVE = {
    brand_in_use: 'Products still use this brand. Untag them under “Tag by hand” (choose “No brand”), or hide the brand instead.',
    brand_not_found: 'That brand no longer exists. Refresh the page.',
    not_signed_in: 'Your session ended. Sign in again.'
  }
  function idFor(slug) {
    var b = brand(slug)
    if (b) return Promise.resolve(b.id)
    return reload().then(function () { var c = brand(slug); return c ? c.id : null })
  }
  function onRemove(li) {
    var slug = slugOf(li)            // read now: an Edit may have renamed it since the button was added
    var nameEl = li.querySelector('p.font-bold')
    var name = nameEl ? nameEl.textContent.trim() : slug
    if (!window.confirm('Remove "' + name + '" permanently? This cannot be undone.')) return
    idFor(slug).then(function (id) {
      if (!id) { window.alert('Could not find this brand. Refresh the page and try again.'); return }
      return call('brand_delete', { id: id }).then(function (r) {
        var err = r.body && r.body.error
        if (r.ok && r.body && (r.body.deleted || (r.body.data && r.body.data.deleted))) {
          li.setAttribute('data-sporta-removed', '')
          li.style.display = 'none'
          reload()
        } else {
          window.alert(MSG_REMOVE[err] || ('Could not remove the brand' + (err ? ' (' + err + ')' : '') + '.'))
        }
      })
    })
  }
  function addRemove(c) {
    var li = c.li, edit = c.edit
    if (li.querySelector('[data-sporta-remove-btn]')) return
    li.setAttribute(MARK, '1')
    var rm = document.createElement('button')
    rm.type = 'button'
    rm.textContent = 'Remove'
    rm.setAttribute('data-sporta-remove-btn', '')
    rm.className = edit.className.replace(/text-indigo-\d+/g, 'text-red-600')
    rm.addEventListener('click', function () { onRemove(li) })
    // The Shown checkbox decides which warning the count line gives, and
    // ticking it changes no node the observer sees: redraw on its change.
    li.addEventListener('change', function () { schedule() })
    edit.parentNode.insertBefore(rm, edit.nextSibling)
    if (edit.parentNode.style) edit.parentNode.style.gap = edit.parentNode.style.gap || '0.75rem'
  }

  // ------------------------------------------- counts + "View on site" per card
  function addStats(c) {
    var li = c.li
    if (!brands && pending) return                 // first answer still on its way: no flash of half a line
    var slug = slugOf(li)
    var b = brand(slug)
    // Shown in the shop: the card's own checkbox is the live answer (it may
    // have been ticked since the last read); the row's `active` otherwise.
    var sw = li.querySelector('input[type=checkbox]')
    var shown = sw ? !!sw.checked : !(b && Number(b.active) === 0)
    var key = version + '|' + slug + '|' + (shown ? 1 : 0)
    var box = li.querySelector('[' + STATS + ']')
    var mono = li.querySelector('p.font-mono')
    if (!box) {
      box = el('div', '', null, 'display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;margin-top:4px;font-size:12px;line-height:18px')
      box.setAttribute('dir', 'ltr')
      box.setAttribute('lang', 'en')
    }
    if (box.getAttribute(STATS) !== key) {
      box.setAttribute(STATS, key)
      while (box.firstChild) box.removeChild(box.firstChild)
      if (b && b.products !== undefined) {
        var n = count(b.products), m = count(b.products_active)
        var CALM = 'color:#64748b', WARN = 'color:#be123c;font-weight:600'
        // A SHOWN brand has a home-page tile, and with nothing listed under it
        // that tile opens an empty page: say so, in rose. A hidden brand has
        // no tile and nobody can reach its page, so it only gets the facts.
        var line = n === 0 ? 'No products tagged' : plural(n, 'product', 'products') + ' · ' + m + ' shown'
        var warn = shown && m === 0
        box.appendChild(el('span', '', line + (warn ? ' — this brand opens an empty page' : ''), warn ? WARN : CALM))
      }
      var a = el('a', '', 'View on site ↗', 'color:var(--admin-action, #9a452c);font-weight:700;text-decoration:none;white-space:nowrap')
      a.href = '/shop?brand=' + encodeURIComponent(slug)
      a.target = '_blank'
      a.rel = 'noopener'
      box.appendChild(a)
    }
    if (mono && box.previousElementSibling !== mono) mono.parentNode.insertBefore(box, mono.nextSibling)
  }

  // ------------------------------------------------------------ the tagger panel
  var MSG_TAG = {
    unknown_brand: 'That brand no longer exists. Refresh the page.',
    bad_request: 'The request was not accepted. Refresh the page and try again.',
    not_signed_in: 'Your session ended. Sign in again.',
    brand_slug_too_long: 'This brand’s web name is too long to tag products with. Shorten it with Edit first.'
  }
  function tagError(r) { var e = r.body && r.body.error; return MSG_TAG[e] || ('Could not save (' + errCode(r) + ').') }

  /** Lower-case words, separated by single spaces and padded: " vanquish t shirt white ". */
  function words(s) { return ' ' + String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim() + ' ' }
  function phrases(b) {
    var out = []
    ;[b.name_en, b.slug].forEach(function (x) { var w = words(x).trim(); if (w.length >= 2 && out.indexOf(w) < 0) out.push(w) })
    return out
  }
  function longestMatch(p, list) {
    var hay = words(p.name_en) + words(p.slug), best = 0
    for (var i = 0; i < list.length; i++) if (list[i].length > best && hay.indexOf(' ' + list[i] + ' ') >= 0) best = list[i].length
    return best
  }
  function tagged(p) { return p.brand_slug != null && String(p.brand_slug) !== '' }
  /** [{product, brand}] for untagged products that name a brand, as a whole word. */
  function suggestions() {
    var all = products || [], cand = [], out = []
    ;(brands || []).forEach(function (b) {
      if (!b || !b.slug) return
      var list = phrases(b), hits = 0
      if (!list.length) return
      all.forEach(function (p) { if (longestMatch(p, list)) hits++ })
      // A word in nearly every product name is not a brand signal (the house
      // brand); below five products the share means nothing, so it is not applied.
      if (all.length >= 5 && hits > 0.8 * all.length) return
      cand.push({ b: b, list: list })
    })
    all.forEach(function (p) {
      if (!p || !p.slug || tagged(p)) return
      var best = null, len = 0
      cand.forEach(function (c) { var l = longestMatch(p, c.list); if (l > len) { len = l; best = c.b } })
      if (best) out.push({ p: p, b: best })
    })
    return out
  }

  function borrow() {
    var main = document.querySelector('main') || document.body
    var btns = main.querySelectorAll('button'), add = null
    for (var i = 0; i < btns.length; i++) if (/^add a brand$/i.test(btns[i].textContent.trim())) { add = btns[i]; break }
    var box = main.querySelector('li input[type=checkbox]')
    var input = main.querySelector('input[type=text],input[type=search]')
    var pick = function (node, fallback) { return (node && typeof node.className === 'string' && node.className.trim()) || fallback }
    var edit = cards()[0]
    return {
      button: pick(add, 'min-h-11 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50'),
      link: pick(edit && edit.edit, 'text-xs font-bold text-indigo-600 hover:underline'),
      checkbox: pick(box, 'h-4 w-4 accent-indigo-600'),
      input: pick(input, 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100')
    }
  }

  function buildPanel() {
    var c = borrow()
    var ui = {}
    var picked = {}        // manual tagger: product slug -> true
    var unticked = {}      // suggestions the operator unticked: "product|brand" -> true
    var busy = false

    var root = el('section', 'rounded-2xl border border-slate-200 bg-white', null,
      'box-sizing:border-box;margin:16px 0;padding:16px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;color:#0f172a')
    root.setAttribute(PANEL, '')
    // The admin is English. The page's <html dir> follows the storefront's
    // language choice (Arabic by default), so say it here rather than inherit
    // a right-to-left that would turn "→ Vanquish" around.
    root.setAttribute('dir', 'ltr')
    root.setAttribute('lang', 'en')
    root.setAttribute('aria-labelledby', 'sporta-brand-tagger-title')
    var title = el('h3', 'text-sm font-bold text-slate-900', 'Tag products with a brand', 'margin:0;font-size:15px;font-weight:700;color:#0f172a')
    title.id = 'sporta-brand-tagger-title'
    root.appendChild(title)
    ui.summary = el('p', 'mt-0.5 text-xs text-slate-500', 'Loading products…', 'margin:2px 0 0;font-size:13px;color:#64748b')
    ui.summary.setAttribute('data-sporta-tag-summary', '')
    root.appendChild(ui.summary)

    var SUB = 'margin:0;font-size:13px;font-weight:700;color:#0f172a'
    var NOTE = 'margin:2px 0 8px;font-size:12px;color:#64748b'
    var LIST = 'display:flex;flex-direction:column;gap:2px;max-height:280px;overflow:auto;padding:4px;border:1px solid #e2e8f0;border-radius:12px;background:#fff'
    var ROW = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:10px'
    var STATUS = 'margin:0;font-size:13px;color:#64748b'

    // Suggestions
    ui.sugBox = el('div', '', null, 'margin-top:16px')
    ui.sugBox.appendChild(el('p', '', 'Suggestions', SUB))
    ui.sugBox.appendChild(el('p', '', 'Untagged products that carry a brand’s name. A name found in almost every product (the house brand) is left out — tag those by hand below. Untick any that are wrong.', NOTE))
    ui.sugList = el('div', '', null, LIST)
    ui.sugList.setAttribute('data-sporta-tag-suggestions', '')
    ui.sugBox.appendChild(ui.sugList)
    ui.sugNone = el('p', '', 'No suggestions. Tag the rest by hand below.', STATUS)
    ui.sugBox.appendChild(ui.sugNone)
    var sugRow = el('div', '', null, ROW)
    ui.apply = el('button', c.button, 'Apply selected')
    ui.apply.type = 'button'
    ui.apply.setAttribute('data-sporta-tag-apply', '')
    sugRow.appendChild(ui.apply)
    ui.sugStatus = el('p', '', '', STATUS)
    ui.sugStatus.setAttribute('role', 'status')
    sugRow.appendChild(ui.sugStatus)
    ui.sugBox.appendChild(sugRow)
    root.appendChild(ui.sugBox)

    // Manual tagger
    var man = el('div', '', null, 'margin-top:16px;padding-top:16px;border-top:1px solid #f1f5f9')
    man.appendChild(el('p', '', 'Tag by hand', SUB))
    man.appendChild(el('p', '', 'Pick a brand, tick the products, then Tag selected. Products with no brand are listed first.', NOTE))
    var grid = el('div', '', null, 'display:flex;flex-wrap:wrap;gap:12px')
    var lb = el('label', '', null, 'display:block;flex:1 1 200px;min-width:0;font-size:12px;font-weight:700;color:#475569')
    lb.appendChild(document.createTextNode('Brand'))
    ui.select = el('select', c.input)
    ui.select.setAttribute('data-sporta-tag-brand', '')
    lb.appendChild(ui.select)
    grid.appendChild(lb)
    var lf = el('label', '', null, 'display:block;flex:2 1 240px;min-width:0;font-size:12px;font-weight:700;color:#475569')
    lf.appendChild(document.createTextNode('Filter'))
    ui.filter = el('input', c.input)
    ui.filter.type = 'search'
    ui.filter.placeholder = 'Name, web name, category or brand'
    ui.filter.autocomplete = 'off'
    ui.filter.spellcheck = false
    ui.filter.setAttribute('data-sporta-tag-filter', '')
    lf.appendChild(ui.filter)
    grid.appendChild(lf)
    man.appendChild(grid)
    ui.manList = el('div', '', null, LIST + ';margin-top:10px;max-height:320px')
    ui.manList.setAttribute('data-sporta-tag-products', '')
    man.appendChild(ui.manList)
    var manRow = el('div', '', null, ROW)
    ui.all = el('button', c.link, 'Tick all in this list', 'min-height:44px;padding:0 4px;background:none;border:0;cursor:pointer')
    ui.all.type = 'button'
    ui.all.setAttribute('data-sporta-tag-all', '')
    manRow.appendChild(ui.all)
    ui.picked = el('span', '', '0 selected', 'font-size:13px;color:#64748b')
    manRow.appendChild(ui.picked)
    ui.tag = el('button', c.button, 'Tag selected')
    ui.tag.type = 'button'
    ui.tag.setAttribute('data-sporta-tag-go', '')
    manRow.appendChild(ui.tag)
    man.appendChild(manRow)
    ui.manStatus = el('p', '', '', STATUS + ';margin-top:8px')
    ui.manStatus.setAttribute('role', 'status')
    man.appendChild(ui.manStatus)
    root.appendChild(man)

    function say(node, text, tone) {
      node.textContent = text
      node.style.color = tone === 'error' ? '#be123c' : tone === 'ok' ? 'var(--admin-action, #9a452c)' : '#64748b'
      node.style.fontWeight = tone ? '600' : ''
    }
    function setBusy(on) {
      busy = on
      ;[ui.apply, ui.tag, ui.all].forEach(function (b) { b.disabled = on; b.style.opacity = on ? '.5' : ''; b.style.cursor = on ? 'wait' : '' })
    }
    function row(box, meta, metaCss) {
      var l = el('label', '', null, 'display:flex;align-items:center;gap:10px;min-height:36px;padding:4px 8px;border-radius:8px;cursor:pointer;font-size:14px;color:#1e293b')
      var name = el('span', '', null, 'flex:1 1 auto;min-width:0;overflow-wrap:anywhere')
      l.appendChild(box)
      l.appendChild(name)
      l.appendChild(el('span', '', meta, 'flex:none;font-size:12px;' + (metaCss || 'color:#64748b')))
      return { label: l, name: name }
    }
    function checkbox() {
      var b = el('input', c.checkbox, null, 'width:16px;height:16px;flex:none;accent-color:var(--admin-action, #9a452c);margin:0')
      b.type = 'checkbox'
      return b
    }
    function updatePicked() {
      var n = Object.keys(picked).length
      ui.picked.textContent = n + ' selected'
    }
    function applyFilter() {
      var q = ui.filter.value.trim().toLowerCase()
      var rows = ui.manList.children
      for (var i = 0; i < rows.length; i++) {
        var hay = rows[i].getAttribute('data-hay') || ''
        rows[i].style.display = !q || hay.indexOf(q) >= 0 ? 'flex' : 'none'    // 'flex': the row's own layout, not '' (which drops it)
      }
    }

    function render() {
      root.setAttribute('data-v', String(version))
      if (!products) {
        say(ui.summary, productsErr ? 'Could not load the product list (' + productsErr + ').' : 'Loading products…', productsErr ? 'error' : '')
        ui.sugBox.style.display = 'none'
        man.style.display = 'none'
        return
      }
      ui.sugBox.style.display = ''
      man.style.display = ''
      var total = products.length, untagged = 0
      products.forEach(function (p) { if (p && !tagged(p)) untagged++ })
      say(ui.summary, untagged === 0
        ? (total === 1 ? 'The only product has a brand.' : 'All ' + total + ' products have a brand.')
        : untagged + ' of ' + total + ' products ' + (untagged === 1 ? 'has' : 'have') + ' no brand.', '')

      // Suggestions
      while (ui.sugList.firstChild) ui.sugList.removeChild(ui.sugList.firstChild)
      var sug = suggestions()
      sug.forEach(function (s) {
        var key = s.p.slug + '|' + s.b.slug
        var box = checkbox()
        box.checked = !unticked[key]
        box.setAttribute('data-product', s.p.slug)
        box.setAttribute('data-brand', s.b.slug)
        box.addEventListener('change', function () { if (box.checked) delete unticked[key]; else unticked[key] = true })
        var r = row(box, '→ ' + String(s.b.name_en || s.b.slug), 'color:var(--admin-action, #9a452c);font-weight:600')
        r.name.textContent = String(s.p.name_en || s.p.slug)
        r.label.setAttribute('data-sporta-suggestion', s.p.slug)
        ui.sugList.appendChild(r.label)
      })
      ui.sugList.style.display = sug.length ? 'flex' : 'none'
      ui.apply.style.display = sug.length ? '' : 'none'
      ui.sugNone.style.display = sug.length ? 'none' : ''
      ui.sugNone.textContent = untagged === 0 ? 'No suggestions: every product has a brand.' : 'No suggestions. Tag the rest by hand below.'

      // Brand select, keeping the operator's choice across redraws
      var keep = ui.select.value
      while (ui.select.firstChild) ui.select.removeChild(ui.select.firstChild)
      var o0 = el('option', '', 'Choose a brand…')
      o0.value = ''
      ui.select.appendChild(o0)
      ;(brands || []).forEach(function (b) {
        if (!b || !b.slug) return
        var o = el('option', '', String(b.name_en || b.slug) + (Number(b.active) === 0 ? ' (hidden)' : ''))
        o.value = b.slug
        ui.select.appendChild(o)
      })
      var on = el('option', '', 'No brand (remove the tag)')
      on.value = '__none__'
      ui.select.appendChild(on)
      ui.select.value = keep
      if (ui.select.value !== keep) ui.select.value = ''

      // Products: untagged first, then the server's order (name_en)
      while (ui.manList.firstChild) ui.manList.removeChild(ui.manList.firstChild)
      var known = {}
      var list = products.filter(function (p) { return p && p.slug })
      list = list.filter(function (p) { return !tagged(p) }).concat(list.filter(tagged))
      list.forEach(function (p) {
        known[p.slug] = true
        var box = checkbox()
        box.checked = !!picked[p.slug]
        box.setAttribute('data-product', p.slug)
        box.addEventListener('change', function () { if (box.checked) picked[p.slug] = true; else delete picked[p.slug]; updatePicked() })
        var meta = (tagged(p) ? brandName(String(p.brand_slug)) : 'No brand') + (Number(p.active) === 0 ? ' · hidden' : '')
        var r = row(box, meta, tagged(p) ? 'color:#475569;font-weight:600' : 'color:#94a3b8')
        r.name.textContent = String(p.name_en || p.slug)
        r.label.setAttribute('data-hay', [p.name_en, p.name_ar, p.slug, p.category, tagged(p) ? brandName(String(p.brand_slug)) : 'no brand'].join(' ').toLowerCase())
        ui.manList.appendChild(r.label)
      })
      Object.keys(picked).forEach(function (s) { if (!known[s]) delete picked[s] })
      updatePicked()
      applyFilter()
    }

    /** POST one brand's list, 200 at a time. Resolves {ok, n} or {ok:false, r}. */
    function assign(brandSlug, slugs) {
      var done = 0, i = 0
      function next() {
        if (i >= slugs.length) return Promise.resolve({ ok: true, n: done })
        var part = slugs.slice(i, i + 200)
        i += 200
        return call('brand_assign', { brand_slug: brandSlug, products: part }).then(function (r) {
          if (!r.ok || !r.body || r.body.error) return { ok: false, r: r }
          done += part.length - count(r.body.skipped)
          return next()
        })
      }
      return next()
    }
    function done(brandSlug, n) {
      return brandSlug === null
        ? 'Removed the brand from ' + plural(n, 'product', 'products') + '.'
        : 'Tagged ' + plural(n, 'product', 'products') + ' with ' + brandName(brandSlug) + '.'
    }

    ui.apply.addEventListener('click', function () {
      if (busy) return
      var groups = {}, order = []
      var boxes = ui.sugList.querySelectorAll('input[type=checkbox]')
      for (var i = 0; i < boxes.length; i++) {
        if (!boxes[i].checked) continue
        var b = boxes[i].getAttribute('data-brand')
        if (!groups[b]) { groups[b] = []; order.push(b) }
        groups[b].push(boxes[i].getAttribute('data-product'))
      }
      if (!order.length) { say(ui.sugStatus, 'Tick at least one suggestion.', 'error'); return }
      setBusy(true)
      say(ui.sugStatus, 'Saving…', '')
      var msgs = []
      var chain = Promise.resolve(true)
      order.forEach(function (b) {
        chain = chain.then(function (go) {
          if (!go) return false
          return assign(b, groups[b]).then(function (res) {
            if (res.ok) { msgs.push(done(b, res.n)); return true }
            msgs.push(tagError(res.r))
            return false
          })
        })
      })
      chain.then(function (allOk) {
        return reload().then(function () {
          setBusy(false)
          say(ui.sugStatus, msgs.join(' '), allOk ? 'ok' : 'error')
        })
      })
    })

    ui.all.addEventListener('click', function () {
      if (busy) return
      var rows = ui.manList.children
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].style.display === 'none') continue
        var box = rows[i].querySelector('input[type=checkbox]')
        if (box) { box.checked = true; picked[box.getAttribute('data-product')] = true }
      }
      updatePicked()
    })
    ui.filter.addEventListener('input', applyFilter)
    // Enter on ANY input in the panel — the filter, and every checkbox, which
    // Chromium also treats as implicit submission — must never submit a form
    // the admin may have wrapped around this screen (that form would save
    // whatever it holds). Buttons are type=button and <select> does not submit.
    root.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target && ev.target.tagName === 'INPUT') { ev.preventDefault(); ev.stopPropagation() }
    })
    ui.select.addEventListener('change', function () { say(ui.manStatus, '', '') })

    ui.tag.addEventListener('click', function () {
      if (busy) return
      var v = ui.select.value
      if (!v) { say(ui.manStatus, 'Choose a brand first.', 'error'); return }
      var slugs = Object.keys(picked)
      if (!slugs.length) { say(ui.manStatus, 'Tick at least one product.', 'error'); return }
      var target = v === '__none__' ? null : v
      // Untagging, or re-branding a product that already has ANOTHER brand,
      // throws away a tag nobody can get back from this screen: ask first,
      // the way Remove does. Tagging untagged products needs no question.
      var byS = {}
      ;(products || []).forEach(function (p) { if (p && p.slug) byS[p.slug] = p })
      var change = slugs.filter(function (s) {
        var p = byS[s]
        return p && tagged(p) && (target === null || String(p.brand_slug) !== String(target))
      }).length
      if (change > 0) {
        var q = target === null
          ? 'Remove the brand from ' + plural(change, 'product', 'products') + '?'
          : change + ' of these already ' + (change === 1 ? 'has' : 'have') + ' another brand. Replace it with ' + brandName(target) + '?'
        if (!window.confirm(q)) { say(ui.manStatus, 'Nothing was changed.', ''); return }
      }
      setBusy(true)
      say(ui.manStatus, 'Saving…', '')
      assign(target, slugs).then(function (res) {
        if (res.ok) picked = {}
        return reload().then(function () {
          setBusy(false)
          if (res.ok) say(ui.manStatus, done(target, res.n), 'ok')
          else say(ui.manStatus, tagError(res.r), 'error')
        })
      })
    })

    root.sportaRender = render
    return root
  }

  function scan() {
    var cs = cards()
    if (!cs.length) {
      // Left the Brands screen: if React kept the parent, take the panel away.
      onScreen = false
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel)
      return
    }
    // Read again (a) every time the screen is ENTERED — products may have been
    // tagged in the Catalogue editor meanwhile — and (b) when a card appears
    // whose slug the last answer did not have: a brand just added with the
    // compiled "Add a brand", or renamed with Edit. askedFor remembers the set
    // of unknown slugs a reload was asked for, so a slug the server really
    // does not know is asked about once, not on every mutation.
    var entering = !onScreen
    onScreen = true
    var miss = []
    if (brands) for (var k = 0; k < cs.length; k++) { var ms = slugOf(cs[k].li); if (ms && !brand(ms)) miss.push(ms) }
    miss = miss.join(',')
    if (!tried) load()
    else if (!pending && (entering || (miss && miss !== askedFor))) { askedFor = miss; reload() }
    for (var i = 0; i < cs.length; i++) {
      try { addRemove(cs[i]) } catch (e) {}
      try { addStats(cs[i]) } catch (e) {}
    }
    var list = cs[0].li.parentNode
    if (!list || !list.parentNode) return
    if (!panel) panel = buildPanel()
    if (panel.nextElementSibling !== list) list.parentNode.insertBefore(panel, list)
    if (panel.getAttribute('data-v') !== String(version)) panel.sportaRender()
  }

  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; try { scan() } catch (e) {} })
  }
  function start() { schedule(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }) }
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
    viaBox.style.cssText = 'width:1.5rem;height:1.5rem;flex:none;accent-color:var(--admin-action,#9a452c);cursor:pointer'
    via.appendChild(viaText)
    via.appendChild(viaBox)
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
    // The checkbox applies the moment it is ticked (there is no save button for it), so it
    // must not sit INSIDE the Merchant Server IP panel, under that panel's "Save IPs": it read
    // as part of that save. It is its own card, between the credentials and the IP panel.
    // The panel keeps the marker, which is what scan() looks for to build only once.
    var frag = document.createDocumentFragment()
    frag.appendChild(via)
    frag.appendChild(card)
    return frag
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

/* 4. The sign-in screen's session line (2026-11-02).
 *
 * The compiled login says "Sessions expire after 8 hours idle." The owner
 * asked for a long sign-in, and the server now keeps an admin signed in on a
 * browser for 30 days and signs them out after 7 days without use
 * (STORE_ADMIN_ABSOLUTE_SECONDS / STORE_ADMIN_IDLE_SECONDS in store.php) — so
 * the line is reworded in place to say what is true.
 *
 * The TEXT NODE React rendered is edited, never replaced or moved: React
 * compares the next render against its own props, not against the DOM, so it
 * leaves the new words alone, and the node it owns is still the node it owns.
 * Exact match only: if a later build words the line differently, nothing here
 * touches it.
 */
;(function () {   // leading ; — the block above ends in `)()` with no semicolon
  if (location.pathname.indexOf('/backends') !== 0) return
  var OLD = 'Sessions expire after 8 hours idle.'
  var NEW = 'You stay signed in on this browser for 30 days. 7 days without use signs you out.'
  function scan() {
    var ps = document.querySelectorAll('.admin-login p')
    for (var i = 0; i < ps.length; i++) {
      var n = ps[i].firstChild
      if (n && n.nodeType === 3 && ps[i].childNodes.length === 1 && n.nodeValue.trim() === OLD) n.nodeValue = NEW
    }
  }
  var queued = false
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; scan() }) }
  // characterData too: a re-render that only resets the text is a change to
  // the text node, not to the child list.
  function start() { scan(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true }) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()

/* ===== ADMIN SAVE BAR - begin ===========================================
 * 5. Save bar (owner request 2026-11-03: "add save buttons every page
 * backends").
 *
 * Every /backends screen where something is edited already HAS a Save; the
 * trouble is reach. Order and Support drawers keep it 600-800 px down, the
 * Slides and Discounts modals scroll it away, Topbar and Inventory are one long
 * page, and on a phone the sticky Save row of the Catalogue and Brands editors
 * sits UNDER the fixed bottom tab bar. This block adds no save logic of its own.
 * It watches for the screen's real Save and, ONLY while that button is out of
 * view (or covered), shows one slim bar with the same words that calls the real
 * button's click(), so the screen's own validation, request and busy/disabled
 * behaviour run exactly as if the owner had pressed the real one.
 *
 * What counts as a Save (finder, not a guess at all the text on the page):
 *   - any button whose label starts with Save / Saved / Saving, whatever its
 *     type (the Orders drawer saves are type=button with an onClick, no form);
 *   - a <button type=submit> (or an <input type=submit>) of a <form> that has
 *     editable fields, whatever it says (Create contact, Add note, Send customer
 *     reply, Save product...); a typeless <button> in a form only when it starts
 *     with Create / Add note / Send / Update / Publish;
 *   - never Cancel / Delete / Remove / Reset / Close / Clear / Search / Filter /
 *     Apply / Sign in / Back / Next / Block / Export ... (the label is checked
 *     from its first word), never the sidebar, the tab bar, a role=search form,
 *     or the bar itself.
 * Which Save: the top-most open overlay (a big position:fixed box: drawer,
 * modal, the phone menu) owns the screen, so a page behind it is ignored; with
 * several Saves in it the one nearest in the tree to the field last touched
 * wins (else the first enabled one). A Save that is not in an overlay needs 3+
 * fields in its form, or a field touched in it, so a tiny inline "Add contact"
 * form is not chased down the page.
 *
 * Out of view = less than 90% of the button inside every clipping/scrolling
 * ancestor and the window, or something else (the tab bar) on top of its
 * centre. The bar sits at the bottom of that scrolling frame (the drawer, the
 * modal's form, or the window), above env(safe-area-inset-bottom) and above any
 * fixed bar at the bottom of the screen; a Save inside an overlay gets a bar
 * one z-index above the overlay. While it shows, the scroll container gets
 * extra padding-bottom (put back exactly afterwards) so the last field can be
 * scrolled clear of it. It mirrors the real button's label, disabled
 * (aria-disabled, so keyboard focus survives) and aria-busy, ignores clicks
 * while the real one is disabled or busy and for half a second after a press.
 *
 * One debounced (rAF) MutationObserver on <body>; it is disconnected around the
 * block's own writes. Nothing runs off /backends: if the page is not /backends
 * the block only waits for a navigation (Navigation API, popstate) and starts
 * then; leaving /backends stops it. Evaluated twice, the second does nothing.
 * Styles are created from here (a <style>), colours follow the colour of the
 * frame behind the bar so it reads in light and dark.
 */
;(function () {
  if (window.__sportaSaveBar) return
  var api = { version: 1, ticks: 0 }
  try { Object.defineProperty(window, '__sportaSaveBar', { value: api, enumerable: false, configurable: false }) } catch (e) { return }

  var BAR = 'data-sporta-savebar'
  var GAP = 8                         // air between the last field and the bar
  var MAXW = 720                      // widest the bar gets on a desktop
  // The first word of a label that is never a save (checked after any leading icon/symbol).
  var NOT = /^(cancel|delete|remove|reset|close|discard|clear|search|filter|apply|find|go|show|load|view|open|sign|log|login|logout|signin|signout|back|next|prev|refresh|export|download|block|unblock|revoke|disconnect|unlink|archive|copy|print|edit|add (photo|image|size|row|variant|item))\b/i
  var SAVE = /^(save|saved|saving)\b/i
  // The ONLY labels, other than Save, that may be mirrored from a form's submit button. An allowlist on purpose: any
  // other submit ("Approve refund", "Ship order", "Charge card", "Void payment" ...) is an action, not a Save, and must
  // never sit in the thumb zone looking like one.
  var SENDLIKE = /^(create|add note|send|update|publish|set (a |the )?(new )?password|change (the |your )?password)\b/i
  var SIDE = 'nav, [role=navigation], .admin-sidebar, .m-tabbar, .m-header'

  var bar = null, btn = null, styleEl = null
  var running = false, obs = null, frame = 0, trail = 0
  var domDirty = true, cands = [], field = null
  var cur = null                      // the real Save the bar mirrors
  var pad = null                      // { el, v, p, had, base } while padding is added
  var locked = false
  var navHooked = false

  function onAdmin() { return location.pathname.indexOf('/backends') === 0 }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }
  function labelOf(b) {
    var t = clean(b.tagName === 'INPUT' ? b.value : b.textContent)
    return t || clean(b.getAttribute('aria-label') || b.getAttribute('title'))
  }
  function isFieldEl(e) {
    if (!e || e.nodeType !== 1 || !/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName)) return false
    return !/^(hidden|search|button|submit|reset|image)$/i.test(e.type || '')
  }
  function fieldsIn(scope) {
    var n = 0, list = scope.querySelectorAll('input, select, textarea')
    for (var i = 0; i < list.length && n < 6; i++) if (isFieldEl(list[i]) && list[i].getClientRects().length) n++
    return n
  }
  function isSave(b) {
    if (bar && bar.contains(b)) return false
    if (b.tagName === 'INPUT' && String(b.type).toLowerCase() !== 'submit') return false
    var label = labelOf(b)
    if (!label || label.length > 60) return false
    var lead = label.replace(/^[^A-Za-z؀-ۿ]+/, '')
    if (!lead) return false
    var type = (b.getAttribute('type') || '').toLowerCase()
    if (type === 'reset') return false
    if (b.closest(SIDE)) return false
    var save = SAVE.test(lead)
    if (!save && NOT.test(lead)) return false
    if (save) return true
    var form = b.form
    if (!form || String(form.getAttribute('role')).toLowerCase() === 'search') return false
    if (!SENDLIKE.test(lead)) return false
    if (type && type !== 'submit') return false
    return fieldsIn(form) > 0
  }
  function findCandidates() {
    var out = [], list = document.querySelectorAll('button, input[type=submit]')
    for (var i = 0; i < list.length; i++) {
      var b = list[i]
      if (!b.isConnected) continue
      var t = b.tagName === 'INPUT' ? b.value : b.textContent
      if (t && t.length > 120) continue
      if (!isSave(b)) continue
      out.push(b)
    }
    return out
  }
  function rendered(b) {
    if (!b.isConnected || !b.getClientRects().length) return false
    var cs = getComputedStyle(b)
    return cs.visibility !== 'hidden' && cs.display !== 'none'
  }

  // A big position:fixed box (drawer, modal, backdrop, the phone menu): the nearest one at or above e.
  function bigFixed(e) {
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight
    for (var n = e; n && n.nodeType === 1 && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (bar && n === bar) return null
      if (getComputedStyle(n).position !== 'fixed') continue
      var r = n.getBoundingClientRect()
      if (r.width >= vw * 0.3 && r.height >= vh * 0.6 && !n.querySelector('.admin-sidebar, .m-tabbar')) return n
    }
    return null
  }
  // The top-most overlay on screen, sampled at the centre and either side of it.
  function topOverlay() {
    var vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight
    var pts = [[0.5, 0.5], [0.88, 0.5], [0.12, 0.5]]
    for (var p = 0; p < pts.length; p++) {
      var list = document.elementsFromPoint(Math.round(vw * pts[p][0]), Math.round(vh * pts[p][1]))
      for (var i = 0; i < list.length; i++) {
        if (bar && bar.contains(list[i])) continue
        var o = bigFixed(list[i])
        if (o) return o
        break
      }
    }
    return null
  }

  function depthOf(n) { var d = 0; for (; n && n.parentElement; n = n.parentElement) d++; return d }
  function lca(a, b) {
    var seen = [], n
    for (n = a; n; n = n.parentElement) seen.push(n)
    for (n = b; n; n = n.parentElement) if (seen.indexOf(n) >= 0) return n
    return null
  }
  function isOff(b) { return b.disabled || b.getAttribute('aria-disabled') === 'true' }
  function isBusy(b) { return b.getAttribute('aria-busy') === 'true' }
  function choose(list) {
    var f = field && field.isConnected ? field : null
    var best = null, bs = -1
    for (var i = 0; i < list.length; i++) {
      var c = list[i], s = 0
      if (f) { var a = lca(f, c); s = (a ? depthOf(a) : 0) * 8 }
      if (!isOff(c)) s += 4
      if ((c.getAttribute('type') || '').toLowerCase() === 'submit') s += 2
      s += (list.length - i) / (list.length + 1)       // earlier in the page wins a tie
      if (s > bs) { bs = s; best = c }
    }
    return best
  }
  function blockOf(c) { return c.form || c.closest('section, fieldset, aside') || c.parentElement }
  function qualifies(c, ov) {
    if (ov) return true
    var blk = blockOf(c)
    if (!blk) return false
    if (field && field.isConnected && blk.contains(field)) return true
    return fieldsIn(blk) >= 3
  }

  // Where the real Save is: the part of its box inside every clipping ancestor and the window, and which
  // ancestor scrolls (null = the window).
  function reach(b) {
    var de = document.documentElement
    var vis = { l: 0, t: 0, r: de.clientWidth, b: de.clientHeight }
    var scroller = null
    for (var a = b.parentElement; a && a !== document.body && a !== de; a = a.parentElement) {
      var cs = getComputedStyle(a)
      if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') {
        var ar = a.getBoundingClientRect()
        if (cs.overflowX !== 'visible') { vis.l = Math.max(vis.l, ar.left); vis.r = Math.min(vis.r, ar.right) }
        if (cs.overflowY !== 'visible') {
          vis.t = Math.max(vis.t, ar.top); vis.b = Math.min(vis.b, ar.bottom)
          if (!scroller && /^(auto|scroll|overlay)$/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1) scroller = a
        }
      }
      if (cs.position === 'fixed') break
    }
    var r = b.getBoundingClientRect()
    var ix = Math.max(0, Math.min(r.right, vis.r) - Math.max(r.left, vis.l))
    var iy = Math.max(0, Math.min(r.bottom, vis.b) - Math.max(r.top, vis.t))
    var area = r.width * r.height
    var frac = area > 0 ? (ix * iy) / area : 0
    var seen = frac >= 0.9
    if (seen) {
      var top = document.elementFromPoint(Math.round(Math.max(r.left, vis.l) + ix / 2), Math.round(Math.max(r.top, vis.t) + iy / 2))
      if (top && top !== b && !b.contains(top)) seen = false      // something (the tab bar, our bar) is on top of it
    }
    return { seen: seen, vis: vis, scroller: scroller }
  }

  // Fixed or sticky strip at the very bottom of the screen that sits above the overlay/page: its height.
  function lift(ov, real) {
    var de = document.documentElement, vw = de.clientWidth, vh = de.clientHeight, best = 0
    var xs = [0.25, 0.5, 0.75]
    for (var k = 0; k < xs.length; k++) {
      var list = document.elementsFromPoint(Math.round(vw * xs[k]), vh - 2)
      for (var i = 0; i < list.length; i++) {
        var e = list[i]
        if (bar && bar.contains(e)) continue
        if (ov && ov.contains(e)) break                          // everything below is behind the overlay
        for (var f = e; f && f !== document.body && f !== de; f = f.parentElement) {
          var pos = getComputedStyle(f).position
          if (pos !== 'fixed' && pos !== 'sticky') continue
          var r = f.getBoundingClientRect()
          if (r.bottom >= vh - 2 && r.height <= 160 && r.width >= vw * 0.4 && !f.contains(real)) best = Math.max(best, vh - r.top)
          break
        }
      }
    }
    return best
  }

  function effectiveBg(from) {
    for (var n = from; n && n.nodeType === 1; n = n.parentElement) {
      var m = /^rgba?\(([^)]+)\)$/.exec(getComputedStyle(n).backgroundColor)
      if (!m) continue
      var p = m[1].split(',').map(parseFloat)
      if (p.length < 4 || p[3] > 0.6) return p.slice(0, 3)
    }
    return null
  }
  function luminance(c) {
    var v = c.map(function (x) { x = x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) })
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
  }

  function css() {
    return '[' + BAR + ']{position:fixed;z-index:35;box-sizing:border-box;padding:8px 12px;border-top:1px solid #e2e8f0;background:#fff;box-shadow:0 -6px 18px rgba(15,23,42,.12);font-family:inherit}' +
      '[' + BAR + '][hidden]{display:none}' +
      '[' + BAR + '] button{appearance:none;display:block;box-sizing:border-box;width:100%;min-height:44px;margin:0;padding:10px 16px;border:0;border-radius:12px;background:#4f46e5;color:#fff;font:inherit;font-size:15px;font-weight:700;line-height:1.25;cursor:pointer;text-align:center}' +
      '[' + BAR + '] button:hover{background:#4338ca}' +
      '[' + BAR + '] button:focus-visible{outline:3px solid #312e81;outline-offset:2px}' +
      '[' + BAR + '] button[aria-disabled=true]{background:#e2e8f0;color:#475569;cursor:not-allowed}' +
      '[' + BAR + '] button[aria-busy=true]{cursor:progress}' +
      '[' + BAR + '][data-tone=dark]{border-top-color:rgba(148,163,184,.35);box-shadow:0 -6px 18px rgba(0,0,0,.45)}' +
      '[' + BAR + '][data-tone=dark] button{background:#818cf8;color:#0f172a}' +
      '[' + BAR + '][data-tone=dark] button:hover{background:#a5b4fc}' +
      '[' + BAR + '][data-tone=dark] button:focus-visible{outline-color:#c7d2fe}' +
      '[' + BAR + '][data-tone=dark] button[aria-disabled=true]{background:#334155;color:#e2e8f0}' +
      '@media (prefers-reduced-motion:no-preference){[' + BAR + ']:not([hidden]){animation:sporta-savebar-in .16s ease-out}}' +
      '@keyframes sporta-savebar-in{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}'
  }
  function ensureBar() {
    if (bar && bar.isConnected) return
    if (!styleEl || !styleEl.isConnected) {
      styleEl = document.createElement('style')
      styleEl.setAttribute('data-sporta-savebar-css', '1')
      styleEl.textContent = css()
      document.head.appendChild(styleEl)
    }
    bar = document.createElement('div')
    bar.setAttribute(BAR, '1')
    bar.setAttribute('role', 'group')
    bar.setAttribute('aria-label', 'Save changes')
    bar.hidden = true
    btn = document.createElement('button')
    btn.type = 'button'
    btn.addEventListener('click', press)
    bar.appendChild(btn)
    document.body.appendChild(bar)
  }

  function press(ev) {
    ev.preventDefault()
    var real = cur
    if (locked || !real || !real.isConnected || isOff(real) || isBusy(real)) return
    locked = true
    setTimeout(function () { locked = false }, 500)
    real.click()
    schedule(false)
  }

  function setAttr(el, n, v) { if (v === null) { if (el.hasAttribute(n)) el.removeAttribute(n) } else if (el.getAttribute(n) !== v) el.setAttribute(n, v) }

  // Keep the last field clear of the bar: the scroll container's bottom padding grows to the height the bar
  // (and any tab bar under it) takes from the bottom of the container, and goes back when the bar goes.
  function holdPad(el, reserve) {
    if (pad && pad.el !== el) releasePad(true)
    var base = pad ? pad.base : (parseFloat(getComputedStyle(el).paddingBottom) || 0)
    var want = Math.max(base, reserve + GAP)
    if (want <= base + 0.5) { releasePad(false); return }
    if (!pad) pad = { el: el, v: el.style.getPropertyValue('padding-bottom'), p: el.style.getPropertyPriority('padding-bottom'), had: el.hasAttribute('style'), base: base, cur: base }
    var css = want + 'px'
    if (el.style.getPropertyValue('padding-bottom') !== css) el.style.setProperty('padding-bottom', css)
    pad.cur = want
  }
  // Scrolled into the extra padding: taking it away now would shorten the page under the reader and jerk the
  // content, so it stays until the scroll position is back inside the page proper.
  function inPadZone() {
    if (!pad || !pad.el.isConnected) return false
    var e = pad.el === document.documentElement ? (document.scrollingElement || pad.el) : pad.el
    return e.scrollTop + e.clientHeight > e.scrollHeight - (pad.cur - pad.base) + 1
  }
  function releasePad(force) {
    if (!pad) return
    var el = pad.el
    if (!force && inPadZone()) return
    if (el.isConnected) {
      if (pad.v) el.style.setProperty('padding-bottom', pad.v, pad.p); else el.style.removeProperty('padding-bottom')
      if (!pad.had && el.getAttribute('style') === '') el.removeAttribute('style')
    }
    pad = null
  }

  function hideBar(force) {
    cur = null
    if (!bar || !bar.isConnected) { releasePad(true); return }
    if (!bar.hidden) {
      var real = null
      if (bar.contains(document.activeElement)) real = lastReal
      bar.hidden = true
      if (real && real.isConnected && rendered(real)) { try { real.focus({ preventScroll: true }) } catch (e) {} }
    }
    releasePad(!!force)
  }
  var lastReal = null

  function show(real, info, ov) {
    ensureBar()
    cur = lastReal = real
    var label = labelOf(real)
    var off = isOff(real), busy = isBusy(real)
    if (btn.textContent !== label) btn.textContent = label
    setAttr(btn, 'aria-label', label)
    setAttr(btn, 'aria-disabled', off || busy ? 'true' : null)
    setAttr(btn, 'aria-busy', busy ? 'true' : null)
    // Frame: across the form (or the scrolling box), inside what is visible of it.
    var host = real.form && (!ov || ov.contains(real.form)) ? real.form : (info.scroller || ov || real.parentElement)
    var hr = host.getBoundingClientRect()
    var l = Math.max(info.vis.l, hr.left), r = Math.min(info.vis.r, hr.right)
    if (r - l < 200) { l = info.vis.l; r = info.vis.r }
    var w = Math.min(r - l, MAXW)
    var left = l + (r - l - w) / 2
    var lf = lift(ov, real)
    var de = document.documentElement
    var bottomEdge = Math.min(info.vis.b, de.clientHeight - lf)
    var fromBottom = Math.max(0, de.clientHeight - bottomEdge)
    var z = 35
    if (ov) { var oz = parseInt(getComputedStyle(ov).zIndex, 10); z = (isFinite(oz) ? Math.max(oz, 40) : 40) + 1 }
    var bg = effectiveBg(host)
    var dark
    if (bg) dark = luminance(bg) < 0.4
    else {
      // Nothing painted behind it (the browser's own canvas): light text means a dark page.
      var fg = /^rgba?\(([^)]+)\)$/.exec(getComputedStyle(host).color)
      dark = fg ? luminance(fg[1].split(',').slice(0, 3).map(parseFloat)) > 0.5 : false
    }
    var rgb = bg ? 'rgb(' + bg.map(Math.round).join(',') + ')' : (dark ? '#0f172a' : '#fff')
    var st = bar.style
    st.left = Math.round(left) + 'px'
    st.width = Math.round(w) + 'px'
    // The safe area is the phone's own bottom edge; it only matters when the bar is on it.
    st.bottom = fromBottom === 0 ? 'env(safe-area-inset-bottom, 0px)' : Math.round(fromBottom) + 'px'
    st.zIndex = String(z)
    st.background = rgb
    st.borderRadius = w < r - l ? '14px 14px 0 0' : '0'
    setAttr(bar, 'data-tone', dark ? 'dark' : 'light')
    bar.hidden = false
    var sc = info.scroller || (de.scrollHeight > de.clientHeight ? de : null)
    if (sc) holdPad(sc, Math.max(0, (info.scroller ? Math.min(sc.getBoundingClientRect().bottom, de.clientHeight) : de.clientHeight) - bar.offsetTop))
    else releasePad()
  }

  function run() {
    if (!onAdmin()) { stop(); return }
    if (domDirty) { cands = findCandidates(); domDirty = false }
    var live = []
    for (var i = 0; i < cands.length; i++) if (rendered(cands[i])) live.push(cands[i])
    if (!live.length) { hideBar(); return }
    var ov = topOverlay()
    if (ov) live = live.filter(function (b) { return ov.contains(b) })
    else live = live.filter(function (b) { return !bigFixed(b) })
    if (!live.length) { hideBar(); return }
    var real = choose(live)
    if (!real || !qualifies(real, ov)) { hideBar(); return }
    // Judge by the page as the app lays it out, never as our own bar and padding change it. The bar is made
    // click-through for the measurement (elementFromPoint then sees what is under it), and when the Save looks
    // in reach only because of our padding, the padding is taken off and the Save is looked at again: a sticky
    // Save row (the Catalogue and Brands editors) moves up out from under the tab bar when its container gets
    // padding, which would hide the bar, which takes the padding away, which covers the row again...
    var up = bar && !bar.hidden
    if (up) bar.style.pointerEvents = 'none'
    var info = reach(real)
    if (info.seen && pad && !inPadZone()) { releasePad(true); info = reach(real) }
    if (up) bar.style.pointerEvents = ''
    if (info.seen) { hideBar(); return }
    show(real, info, ov)
  }

  function tick() {
    frame = 0
    api.ticks++
    if (obs) { if (obs.takeRecords().length) domDirty = true; obs.disconnect() }
    try { run() } catch (e) { try { hideBar() } catch (e2) {} }
    if (running && obs) obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-busy', 'aria-disabled', 'hidden', 'class', 'style'] })
  }
  function schedule(dom, settled) {
    if (dom) domDirty = true
    if (!settled) {
      // Panels slide in and settle after the mutation: look once more when the burst is over (once; this look does not re-arm itself).
      clearTimeout(trail)
      trail = setTimeout(function () { schedule(false, true) }, 320)
    }
    if (frame) return
    frame = requestAnimationFrame(tick)
  }
  function onMut() { schedule(true) }
  function onGeom() { schedule(false) }
  function onField(e) {
    if (isFieldEl(e.target) && !(bar && bar.contains(e.target))) field = e.target
    schedule(false)
  }

  function start() {
    if (running || !document.body) return
    running = true
    obs = new MutationObserver(onMut)
    document.addEventListener('scroll', onGeom, { capture: true, passive: true })
    window.addEventListener('resize', onGeom)
    document.addEventListener('transitionend', onGeom, true)
    document.addEventListener('animationend', onGeom, true)
    document.addEventListener('focusin', onField, true)
    document.addEventListener('input', onField, true)
    document.addEventListener('change', onField, true)
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', onGeom); window.visualViewport.addEventListener('scroll', onGeom) }
    domDirty = true
    tick()
  }
  function stop() {
    if (!running) return
    running = false
    if (obs) { obs.disconnect(); obs = null }
    document.removeEventListener('scroll', onGeom, true)
    window.removeEventListener('resize', onGeom)
    document.removeEventListener('transitionend', onGeom, true)
    document.removeEventListener('animationend', onGeom, true)
    document.removeEventListener('focusin', onField, true)
    document.removeEventListener('input', onField, true)
    document.removeEventListener('change', onField, true)
    if (window.visualViewport) { window.visualViewport.removeEventListener('resize', onGeom); window.visualViewport.removeEventListener('scroll', onGeom) }
    cancelAnimationFrame(frame); frame = 0
    clearTimeout(trail)
    hideBar(true)
    field = null; cands = []
  }
  // The admin is a single-page app: /backends can be entered or left without a page load.
  function check() { if (onAdmin()) start(); else stop() }
  function boot() {
    check()
    if (navHooked) return
    navHooked = true
    window.addEventListener('popstate', function () { setTimeout(check, 0) })
    if (window.navigation && window.navigation.addEventListener) { window.navigation.addEventListener('navigatesuccess', function () { setTimeout(check, 0) }); window.navigation.addEventListener('currententrychange', function () { setTimeout(check, 0) }) }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot()
})()
/* ===== ADMIN SAVE BAR - end ============================================== */

/* ===== ADMIN PHOTO UPLOADER - begin =====================================
 * 6. Photos (owner request 2026-11-03: "make images uploader").
 *
 * The biggest gap on the shop is real product photographs, and the compiled
 * product editor takes ONE per product. This adds a "Photos" panel to the
 * Catalogue screen, above the list of products, that takes MANY files at once
 * (drag and drop, or the file chooser, which is what a phone uses), matches
 * each to a product by its file name, shows what it understood, and uploads
 * them one after another.
 *
 * NOTHING NEW ON THE SERVER. Three routes that already exist on the live
 * admin.php are used, with the headers the admin's own calls carry
 * (session cookie, X-Sporta-Admin: 1, application/json for writes):
 *   GET  products_all           every product, to match names and to read the
 *                               row again right before it is saved;
 *   POST product_image_upload   {name, data: "data:image/<png|jpeg|webp>;base64,..."}
 *                               -> {path, width, height, bytes, mime}. The route
 *                               writes the ORIGINAL bytes (owner decision
 *                               2026-11-03: photos are lossless). Here too: the
 *                               browser reads the file, never draws or resizes
 *                               it, and sends its own bytes;
 *   POST product_save           the full row, with the new path in image/images.
 * Nothing is ever deleted, and no photograph is ever removed from a product by
 * this panel: a photo that REPLACES the main one (file name ending -1) leaves
 * the old path in the log, which lists every path written and what the product
 * had before, so any step can be undone by hand.
 *
 * FILE NAME -> PRODUCT. The name without its extension, lower-cased and with
 * every run of other characters turned into one dash, is looked up as (1) the
 * product's web name (slug), (2) its English or Arabic name written the same
 * way, (3) either with the dashes left out. If nothing matches and the name
 * ends in -N (also "_N", " N", "(N)", ".N"), the name without it is looked up
 * the same way and N is the position: 1 = the main photo, 2 = the next, ...
 * A name that matches as a whole always wins over a split (a product called
 * "air-max-90" is not "air-max", position 90). No suffix = "auto": the main
 * photo if the product has none, else added at the end. A name that matches
 * two products is NOT guessed: it is shown as "choose a product".
 *
 * WHAT IT SAVES. After each upload the product row is read again (products_all)
 * and saved whole with product_save, every field exactly as read (price and
 * sale price as the strings the database gave, sale dates, featured, featured
 * order, brand, category, descriptions, active), except:
 *   - position 1, or a product with no main photo: image = the new path (the
 *     first photo of a product with none becomes its main one). A main photo the
 *     product already has is NOT dropped: it moves to the FRONT of images (so it
 *     becomes photo 2), the row warns about it before the upload, and the result
 *     line says so. Without that, -1 would have replaced the main photo and left it
 *     in neither field;
 *   - otherwise the path is appended to images (comma-separated list), in
 *     position order within the run. -2, -3 ... therefore mean "after the photos the
 *     product has", NOT "put in slot 2". A path already on the product is not added twice.
 * product_save cuts a description at 280 characters (store_opt), so saving a
 * product whose description is longer would silently shorten it. Such a
 * product is HELD BACK: its photos are not uploaded from here at all (no
 * orphan file), and the panel says why. Same for every row product_save would refuse,
 * mirrored from admin.php: a slug that is not in its normal form, an empty or over-160
 * name, a price or sale price it would reject, sale dates that run backwards (only
 * checked with a sale price, as the server does), a photo address it would reject. An unknown
 * brand cannot be checked without a fourth route, and brand_delete refuses while a
 * product uses the brand, so it is only possible after a hand edit of the database; if
 * it ever happens the file ends as "Uploaded, not added" with the reason and a Retry.
 * A row with sale dates but no sale price gets a warning: product_save empties both dates
 * when there is no sale price, so a photo save clears them (the product editor does too).
 *
 * THE PRODUCT LIST ON THE PAGE GOES STALE. The compiled Catalogue table was read before
 * the photos were added and this panel does not redraw it: Edit + Save in that list
 * would send the old image / images back. After the first save the panel shows a
 * standing notice with a Reload the page button, and the end-of-run line says it too.
 *
 * KNOWN, NOT CLOSED: products_all is read and product_save sent within milliseconds, but
 * the API has no version check, so another admin tab saving the same product in that
 * window would be overwritten. Making that impossible needs a server change.
 *
 * A file this page has already written is never written twice: removed or cleared and
 * added again, it keeps its path and is only added to the product (kept until reload).
 * A JPEG's EXIF turn (orientation 5-8) swaps the pixel size before the 4:5 check.
 *
 * ONE AT A TIME. A single request is in flight at any moment: upload, then the
 * read, then the save, then the next file. HTTP 429 is waited out (Retry-After
 * when the server sends it, else 1, 2, 4 ... seconds, at most 6 tries) with the
 * wait shown. 401 stops the run cleanly (the rest stay waiting; sign in and press
 * Upload again). Anything else marks that file Failed with the reason and a
 * Retry button; a file that was uploaded but could not be added to its product
 * is retried WITHOUT uploading it again.
 *
 * Shown on the Catalogue screen only: the screen is found by its product table
 * (headers Product / Web name / Price / On sale) or its heading "Every product
 * in the database", the panel is inserted before the table and taken out when
 * the screen goes. React's own nodes are never touched or moved.
 * Colours: the admin's dark theme is html[data-theme=dark] / html.dark (a stored
 * choice outranks the device), so the dark palette follows THAT switch, like the
 * rest of this file's admin CSS, and not prefers-color-scheme alone.
 * Language: the panel follows the nearest lang attribute (Arabic -> Arabic,
 * right-to-left, Arabic-Indic digits; anything else English).
 * Tuning hook for tests: window.SPORTA_PHOTOS = {paceMs, backoffMs}.
 */
;(function () {   // leading ; — the block above ends in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaPhotos) return
  try { Object.defineProperty(window, '__sportaPhotos', { value: { version: 1 }, enumerable: false, configurable: false }) } catch (e) { return }

  var API = '/api/admin.php'
  var MAX_BYTES = 10 * 1024 * 1024        // the route's cap
  var MIN_LONG = 1200                     // px on the long side
  var RATIO = 0.8, RATIO_TOL = 0.03       // the shop frames photos 4:5 (w/h = 0.8)
  var MAX_FILES = 200, MAX_TRIES = 6, DESC_MAX = 280, NAME_MAX = 160
  var LOG_KEY = 'sporta_photo_log'
  var FORMATS = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP' }

  // ------------------------------------------------------------------ strings
  var STR = {
    en: {
      title: 'Photos',
      intro: 'Add many product photos at once. Name each file after the product’s web name. Add -1 for the main photo, or -2, -3 … to add more after the photos the product already has.',
      exMain: 'main photo (a main photo the product has moves to second place)', exSecond: 'added after the photos the product already has (if it has none, it becomes the main photo)', exAuto: 'main photo if the product has none, otherwise added at the end',
      limits: 'PNG, JPEG or WebP, up to 10 MB each. The shop frames photos 4:5; at least 1200 px on the long side is best. Files are uploaded exactly as they are.',
      choose: 'Choose photos', drop: 'or drop photos here',
      dropAria: 'Drop zone for product photos',
      prodLoading: 'Loading products…', prodCount: '{n} products loaded.', prodFail: 'Could not load the products ({e}). Photos cannot be matched until they load.',
      reload: 'Reload products',
      upload: 'Upload {n} photos', upload1: 'Upload 1 photo', uploadNone: 'Upload photos',
      stop: 'Stop after this photo', retryAll: 'Retry failed ({n})', clear: 'Clear list',
      added: '{n} files added.', skippedDup: '{n} already in the list.', tooMany: 'The list holds {n} files at most; the rest were left out.',
      needProduct: '{n} need a product.', readyN: '{n} ready.',
      running: 'Uploading {i} of {n}: {name}', waiting: 'Waiting {s} s (too many requests) before trying again.', stopping: 'Stopping after this photo…',
      halted: 'Your session ended. Sign in again, then press Upload to continue. Nothing was lost.',
      stopped: 'Stopped. {n} photos are still waiting.',
      sumTitle: 'Summary', sumLine: '{u} uploaded, {a} added to products, {f} failed.', sumDone: 'Finished.',
      overall: '{d} of {n}', overallLabel: 'Overall progress',
      logTitle: 'Files written ({n})', logHint: 'Every file this panel put on the server, with what each product had before. Nothing is deleted by this panel.', logCopy: 'Copy list', logSave: 'Download list', logCopied: 'Copied.', logEmpty: 'Nothing yet.',
      product: 'Product', change: 'Change', choosePro: 'Choose a product', position: 'Position', auto: 'Auto',
      search: 'Search products', results: '{n} products found.', noResults: 'No product matches.', more: '{n} more — type to narrow the list.', close: 'Close',
      retry: 'Retry', remove: 'Remove', hidden: '(hidden)',
      st_checking: 'Checking…', st_ready: 'Ready', st_needs: 'Choose a product', st_queued: 'Waiting', st_uploading: 'Uploading', st_attaching: 'Adding to the product',
      st_done: 'Done', st_failed: 'Failed', st_unattached: 'Uploaded, not added', st_refused: 'Not accepted', st_toolarge: 'Too large', st_held: 'Held back',
      r_format: 'Only PNG, JPEG and WebP photos are accepted.', r_svg: 'SVG is not accepted: it can carry script.', r_empty: 'The file is empty.',
      r_large: 'Over 10 MB: the server would refuse it. Nothing was shrunk; reduce it and add it again.',
      r_desc: 'This product’s description is over 280 characters and saving the product from here would cut it. Add the photo in the product editor instead.',
      r_slug: 'This product’s web name is not in its normal form, so it cannot be saved from here. Use the product editor.',
      r_price: 'This product’s price or sale price would be refused when saved. Fix it in the product editor first.',
      r_link: 'A photo already on this product has an address the server would refuse when saving. Fix it in the product editor first.',
      r_name: 'This product’s name is empty or over 160 characters, so the server would refuse to save it. Fix it in the product editor first.',
      r_dates: 'The sale on this product ends before it starts, so the server would refuse to save it. Fix the dates in the product editor first.',
      w_small: 'Only {w}×{h} px: under 1200 px on the long side.', w_aspect: 'Not 4:5 ({w}×{h}): the shop will crop it to fit.',
      w_dup: 'Another file in the list is for the same position of this product.', w_hidden: 'This product is hidden from the shop.', w_main: 'This becomes the main photo. The product’s current main photo moves to second place; nothing is deleted.',
      w_again: 'This file was already uploaded in this session. It is not uploaded again; the same address is added to the product.',
      w_dates: 'This product has sale dates but no sale price. Saving it clears the dates, as the product editor does.', w_ambig: 'The name matches more than one product.', w_dims: 'Size in pixels could not be read.',
      e_not_signed_in: 'Your session ended.', e_image_too_large: 'The server says the file is too large.', e_image_bad_format: 'The server did not accept the format.', e_image_not_an_image: 'The server could not read it as an image.',
      e_image_storage_unavailable: 'The server has no place to store photos.', e_image_write_failed: 'The server could not write the file.', e_request_too_large: 'The request was too large for the server.',
      e_too_many: 'Too many requests; gave up after several tries.', e_network: 'No answer from the server.', e_read: 'The browser could not read the file.',
      e_read_products: 'Could not read the product again before saving.', e_gone: 'The product no longer exists.', e_save: 'Could not save the product',
      e_unknown_brand: 'The product points to a brand that no longer exists. Fix it in the product editor.', e_sale_dates_backwards: 'The sale on this product ends before it starts. Fix the dates in the product editor.',
      path: 'Written to {p}', attachedOk: 'Added to {n} as {w}.', asMain: 'main photo', asExtra: 'photo {k}', movedMain: 'The previous main photo is now photo 2.',
      staleNote: 'The product list on this page still shows the old photos. Reload the page before you edit a product in it: saving from the old list would put the old photos back.', staleReload: 'Reload the page', staleShort: 'Reload the page before editing products.',
      bytes: '{n} B', kb: '{n} KB', mb: '{n} MB', unit: 'px'
    },
    ar: {
      title: 'الصور',
      intro: 'أضف صور المنتجات دفعة واحدة. سمِّ كل ملف باسم المنتج المختصر على الموقع. أضف في آخره شرطة ثم الرقم ١ للصورة الرئيسية، أو ٢ و٣ وهكذا لإضافة صور بعد صور المنتج الحالية.',
      exMain: 'الصورة الرئيسية، وتنتقل الصورة الرئيسية الحالية إلى المركز الثاني', exSecond: 'تُضاف بعد صور المنتج الحالية، وإن لم يكن للمنتج صور تصبح الصورة الرئيسية', exAuto: 'الصورة الرئيسية إن لم يكن للمنتج صورة، وإلا تُضاف في النهاية',
      limits: 'الصيغ المقبولة PNG وJPEG وWebP، بحجم أقصاه ١٠ ميغابايت للملف. يعرض المتجر الصور بنسبة ٤:٥، ويُفضَّل ألا يقل الضلع الأطول عن ١٢٠٠ بكسل. تُرفع الملفات كما هي تمامًا.',
      choose: 'اختيار الصور', drop: 'أو أفلت الصور هنا',
      dropAria: 'منطقة إفلات صور المنتجات',
      prodLoading: 'جارٍ تحميل المنتجات…', prodCount: 'تم تحميل {n|لا منتجات|منتج واحد|منتجين|# منتجات|# منتجًا}.', prodFail: 'تعذّر تحميل المنتجات ({e}). لا يمكن مطابقة الصور قبل تحميلها.',
      reload: 'إعادة تحميل المنتجات',
      upload: 'رفع {n|لا صور|صورة واحدة|صورتين|# صور|# صورة}', upload1: 'رفع صورة واحدة', uploadNone: 'رفع الصور',
      stop: 'إيقاف بعد هذه الصورة', retryAll: 'إعادة محاولة الفاشلة ({n})', clear: 'مسح القائمة',
      added: 'تمت إضافة {n|لا ملفات|ملف واحد|ملفين|# ملفات|# ملفًا}.', skippedDup: '{n|لا ملف|ملف واحد موجود|ملفان موجودان|# ملفات موجودة|# ملفًا موجودًا} في القائمة أصلًا.', tooMany: 'تتسع القائمة لـ {n|لا ملفات|ملف واحد|ملفين|# ملفات|# ملفًا} على الأكثر، وتُركت البقية.',
      needProduct: '{n|لا ملف|ملف واحد يحتاج|ملفان يحتاجان|# ملفات تحتاج|# ملفًا يحتاج} إلى منتج.', readyN: '{n|لا ملف|ملف واحد جاهز|ملفان جاهزان|# ملفات جاهزة|# ملفًا جاهزًا}.',
      running: 'جارٍ رفع {i} من {n}: {name}', waiting: 'الانتظار {s|لا ثوانٍ|ثانية واحدة|ثانيتين|# ثوانٍ|# ثانية} (طلبات كثيرة) قبل المحاولة مجددًا.', stopping: 'سيتم الإيقاف بعد هذه الصورة…',
      halted: 'انتهت جلستك. سجّل الدخول مجددًا ثم اضغط رفع للمتابعة. لم يضع شيء.',
      stopped: 'تم الإيقاف. {n|لا صور|ما زالت صورة واحدة|ما زالت صورتان|ما زالت # صور|ما زالت # صورة} بانتظار الرفع.',
      sumTitle: 'الملخص', sumLine: '{u|لم تُرفع أي صورة|رُفعت صورة واحدة|رُفعت صورتان|رُفعت # صور|رُفعت # صورة}، و{a|لم تُضف أي صورة إلى المنتجات|أُضيفت صورة واحدة إلى المنتجات|أُضيفت صورتان إلى المنتجات|أُضيفت # صور إلى المنتجات|أُضيفت # صورة إلى المنتجات}، و{f|لم تفشل أي صورة|فشلت صورة واحدة|فشلت صورتان|فشلت # صور|فشلت # صورة}.', sumDone: 'اكتمل.',
      overall: '{d} من {n}', overallLabel: 'التقدم الكلي',
      logTitle: 'الملفات المكتوبة ({n})', logHint: 'كل ملف وضعته هذه اللوحة على الخادم، مع ما كان لدى كل منتج قبله. لا تحذف هذه اللوحة أي شيء.', logCopy: 'نسخ القائمة', logSave: 'تنزيل القائمة', logCopied: 'تم النسخ.', logEmpty: 'لا شيء بعد.',
      product: 'المنتج', change: 'تغيير', choosePro: 'اختر منتجًا', position: 'الترتيب', auto: 'تلقائي',
      search: 'ابحث في المنتجات', results: 'عدد المنتجات المطابقة {n}.', noResults: 'لا يوجد منتج مطابق.', more: 'و{n|لا منتجات أخرى|منتج آخر|منتجان آخران|# منتجات أخرى|# منتجًا آخر}، اكتب لتضييق القائمة.', close: 'إغلاق',
      retry: 'إعادة المحاولة', remove: 'إزالة', hidden: '(مخفي)',
      st_checking: 'جارٍ الفحص…', st_ready: 'جاهزة', st_needs: 'اختر منتجًا', st_queued: 'بالانتظار', st_uploading: 'جارٍ الرفع', st_attaching: 'تُضاف إلى المنتج',
      st_done: 'تم', st_failed: 'فشلت', st_unattached: 'رُفعت ولم تُضف', st_refused: 'غير مقبولة', st_toolarge: 'كبيرة جدًا', st_held: 'محجوزة',
      r_format: 'الصيغ المقبولة هي PNG وJPEG وWebP فقط.', r_svg: 'صيغة SVG غير مقبولة لأنها قد تحمل شيفرة برمجية.', r_empty: 'الملف فارغ.',
      r_large: 'يتجاوز ١٠ ميغابايت فسيرفضه الخادم. لم يُصغَّر شيء؛ قلّل حجمه ثم أضفه مجددًا.',
      r_desc: 'وصف هذا المنتج يزيد على ٢٨٠ حرفًا، وحفظ المنتج من هنا سيقصّه. أضف الصورة من محرر المنتج بدلًا من ذلك.',
      r_slug: 'الاسم المختصر لهذا المنتج ليس بصيغته المعتادة، فلا يمكن حفظه من هنا. استخدم محرر المنتج.',
      r_price: 'سعر هذا المنتج أو سعر التخفيض سيُرفض عند الحفظ. صحّحه في محرر المنتج أولًا.',
      r_link: 'عنوان إحدى الصور الموجودة على هذا المنتج سيرفضه الخادم عند الحفظ. صحّحه في محرر المنتج أولًا.',
      r_name: 'اسم هذا المنتج فارغ أو يزيد على ١٦٠ حرفًا، فسيرفض الخادم حفظه. صحّحه في محرر المنتج أولًا.',
      r_dates: 'ينتهي التخفيض على هذا المنتج قبل أن يبدأ، فسيرفض الخادم حفظه. صحّح التاريخين في محرر المنتج أولًا.',
      w_small: 'الأبعاد {w}×{h} بكسل فقط، أي أقل من ١٢٠٠ بكسل في الضلع الأطول.', w_aspect: 'النسبة ليست ٤:٥ ({w}×{h})، وسيقصّ المتجر الصورة لتناسب الإطار.',
      w_dup: 'ملف آخر في القائمة لنفس الترتيب من هذا المنتج.', w_hidden: 'هذا المنتج مخفي عن المتجر.', w_main: 'ستصبح هذه الصورة الرئيسية، وتنتقل الصورة الرئيسية الحالية للمنتج إلى المركز الثاني. لا يُحذف شيء.',
      w_again: 'رُفع هذا الملف من قبل في هذه الجلسة. لن يُرفع مرة أخرى، وإنما يُضاف العنوان نفسه إلى المنتج.',
      w_dates: 'لهذا المنتج تاريخان للتخفيض بلا سعر تخفيض. سيمسح الحفظ التاريخين، كما يفعل محرر المنتج.', w_ambig: 'الاسم يطابق أكثر من منتج.', w_dims: 'تعذّرت قراءة الأبعاد بالبكسل.',
      e_not_signed_in: 'انتهت جلستك.', e_image_too_large: 'يقول الخادم إن الملف كبير جدًا.', e_image_bad_format: 'لم يقبل الخادم هذه الصيغة.', e_image_not_an_image: 'تعذّرت قراءة الملف كصورة على الخادم.',
      e_image_storage_unavailable: 'لا يوجد مكان لحفظ الصور على الخادم.', e_image_write_failed: 'تعذّرت كتابة الملف على الخادم.', e_request_too_large: 'الطلب أكبر مما يقبله الخادم.',
      e_too_many: 'طلبات كثيرة جدًا، وتوقفت المحاولة بعد عدة مرات.', e_network: 'لا رد من الخادم.', e_read: 'تعذّرت قراءة الملف في المتصفح.',
      e_read_products: 'تعذّرت إعادة قراءة المنتج قبل الحفظ.', e_gone: 'لم يعد المنتج موجودًا.', e_save: 'تعذّر حفظ المنتج',
      e_unknown_brand: 'المنتج مرتبط بعلامة تجارية لم تعد موجودة. صحّحه في محرر المنتج.', e_sale_dates_backwards: 'ينتهي التخفيض على هذا المنتج قبل أن يبدأ. صحّح التاريخين في محرر المنتج.',
      path: 'كُتب في {p}', attachedOk: 'أُضيفت إلى {n} بوصفها {w}.', asMain: 'الصورة الرئيسية', asExtra: 'الصورة {k}', movedMain: 'أصبحت الصورة الرئيسية السابقة الصورة ٢.',
      staleNote: 'قائمة المنتجات في هذه الصفحة ما زالت تعرض الصور القديمة. أعد تحميل الصفحة قبل تعديل أي منتج فيها، فالحفظ من القائمة القديمة يعيد الصور القديمة.', staleReload: 'إعادة تحميل الصفحة', staleShort: 'أعد تحميل الصفحة قبل تعديل المنتجات.',
      bytes: '{n} بايت', kb: '{n} ك.ب', mb: '{n} م.ب', unit: 'بكسل'
    }
  }

  // ------------------------------------------------------------------- state
  var lang = 'en'
  var products = null          // products_all rows (plain objects)
  var productsErr = ''
  var loadingProducts = false
  var items = []               // the file list
  var nextId = 1
  var running = false, stopReq = false, halted = false
  var run = { total: 0, done: 0, uploaded: 0, attached: 0, failed: 0, current: '' }
  var showSummary = false
  var staleList = false        // a product was saved from here: the compiled product list on this page is now out of date
  var written = {}             // file signature -> {path} of files this page already put on the server (never uploaded twice)
  var log = []                 // [{t, file, slug, pos, path, attached, note, prevImage, prevImages}]
  var statusText = ''
  var panel = null, refs = null, styleEl = null
  var onScreen = false
  var index = null

  function cfg(key, dflt) {
    var c = window.SPORTA_PHOTOS, v = c ? Number(c[key]) : NaN
    return isFinite(v) && v >= 0 ? v : dflt
  }
  /** Arabic counts the noun, it does not just put a digit in front of the singular. A token
   *  {k|zero|one|two|few|many} in a string is replaced by the form the number needs, '#' standing for the digits:
   *  0 -> zero, 1 -> one (the noun carries the count), 2 -> two (the dual), 3-10 (and x03-x10) -> few (plural), anything else
   *  -> many (back to the singular). The same five cases as arabicCount() in src/i18n/translations.js, which this file
   *  cannot import. A token with other than five forms is left as written, so a typo shows rather than hides. */
  function plural(s, vars) {
    return s.replace(/\{([a-z]+)\|([^{}]*)\}/g, function (all, key, body) {
      var f = body.split('|')
      if (f.length !== 5 || !vars) return all
      var n = Math.abs(Number(vars[key]) || 0), m = n % 100
      var form = n === 0 ? f[0] : n === 1 ? f[1] : n === 2 ? f[2] : (m >= 3 && m <= 10) ? f[3] : f[4]
      return form.split('#').join(num(n))
    })
  }
  function t(key, vars) {
    var s = (STR[lang] && STR[lang][key] != null) ? STR[lang][key] : (STR.en[key] != null ? STR.en[key] : key)
    s = plural(s, vars)
    if (vars) for (var k in vars) if (Object.prototype.hasOwnProperty.call(vars, k)) {
      var v = vars[k]
      s = s.split('{' + k + '}').join(typeof v === 'number' ? num(v) : String(v))
    }
    return s
  }
  /** Digits in the page's language: Arabic-Indic in Arabic, plain otherwise. */
  function num(n) {
    var s = String(n)
    return lang === 'ar' ? s.replace(/[0-9]/g, function (d) { return String.fromCharCode(0x0660 + Number(d)) }).replace('.', '٫') : s
  }
  function langOf(node) {
    var h = (node && node.closest && node.closest('[lang]')) || document.documentElement
    return /^ar/i.test(h.getAttribute('lang') || '') ? 'ar' : 'en'
  }
  function el(tag, className, text) {
    var n = document.createElement(tag)
    if (className) n.className = className
    if (text != null) n.textContent = text
    return n
  }
  function fmtSize(b) {
    if (b < 1024) return t('bytes', { n: b })
    if (b < 1024 * 1024) return t('kb', { n: Math.round(b / 1024) })
    var m = Math.round(b / 104857.6) / 10
    return t('mb', { n: m })
  }
  function sleep(ms) {
    return new Promise(function (res) {
      var end = Date.now() + ms
      ;(function tick() {
        if (stopReq || halted || Date.now() >= end) return res()
        setTimeout(tick, Math.min(200, Math.max(1, end - Date.now())))
      })()
    })
  }

  // ----------------------------------------------------------- admin requests
  function parse(r) { return r.json().catch(function () { return null }) }
  function call(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return parse(r).then(function (j) { return { ok: r.ok, status: r.status, body: j, retryAfter: r.headers.get('Retry-After') } })
    }).catch(function () { return { ok: false, status: 0, body: null, retryAfter: null } })
  }
  /** The upload goes by XMLHttpRequest only to get byte progress; headers are the same. */
  function postUpload(body, onProgress) {
    return new Promise(function (resolve) {
      var x = new XMLHttpRequest()
      x.open('POST', API + '?r=product_image_upload')
      x.withCredentials = true
      x.timeout = 180000
      x.setRequestHeader('X-Sporta-Admin', '1')
      x.setRequestHeader('Content-Type', 'application/json')
      if (x.upload) x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total) }
      x.onload = function () {
        var j = null
        try { j = JSON.parse(x.responseText) } catch (e) { /* not JSON */ }
        resolve({ ok: x.status >= 200 && x.status < 300, status: x.status, body: j, retryAfter: x.getResponseHeader('Retry-After') })
      }
      x.onerror = x.ontimeout = x.onabort = function () { resolve({ ok: false, status: 0, body: null, retryAfter: null }) }
      x.send(JSON.stringify(body))
    })
  }
  function rowsOf(j) {
    if (Array.isArray(j)) return j
    if (j && Array.isArray(j.data)) return j.data
    if (j && Array.isArray(j.products)) return j.products
    return null
  }
  function errCode(r) { return (r.body && r.body.error) || (r.status ? 'HTTP ' + r.status : 'network') }

  /** Repeat a request while the server answers 429, waiting as it asks. */
  async function patient(send, item) {
    var r = null
    for (var attempt = 0; attempt < MAX_TRIES; attempt++) {
      r = await send()
      if (r.status !== 429) return r
      var ra = Number(r.retryAfter)
      var wait = isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60000) : Math.min(cfg('backoffMs', 1000) * Math.pow(2, attempt), 20000)
      if (attempt === MAX_TRIES - 1) break
      for (var left = Math.ceil(wait / 1000); left > 0 && !stopReq && !halted; left--) {
        setStatus(t('waiting', { s: left }))
        await sleep(Math.min(1000, wait))
        wait -= 1000
      }
      if (stopReq || halted) break
    }
    return r
  }

  // ---------------------------------------------------------------- matching
  function norm(s) {
    var x = String(s == null ? '' : s)
    try { x = x.normalize('NFKC') } catch (e) { /* old engine */ }
    return x.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-+|-+$/g, '')
  }
  function compact(s) { return norm(s).replace(/-/g, '') }
  function stemOf(name) { return String(name).replace(/\.[^.\\/]*$/, '') }

  function addKey(map, key, p) {
    if (!key) return
    if (!map[key]) map[key] = [p]
    else if (map[key].indexOf(p) < 0) map[key].push(p)
  }
  function buildIndex() {
    index = { slug: {}, name: {}, cslug: {}, cname: {} }
    var list = products || []
    for (var i = 0; i < list.length; i++) {
      var p = list[i]
      addKey(index.slug, norm(p.slug), p)
      addKey(index.name, norm(p.name_en), p)
      addKey(index.name, norm(p.name_ar), p)
      addKey(index.cslug, compact(p.slug), p)
      addKey(index.cname, compact(p.name_en), p)
      addKey(index.cname, compact(p.name_ar), p)
    }
  }
  /** {p} one product, {ambiguous:true} several at the first tier that hits, or null. */
  function lookup(base) {
    if (!base) return null
    var tiers = [[index.slug, norm(base)], [index.name, norm(base)], [index.cslug, compact(base)], [index.cname, compact(base)]]
    for (var i = 0; i < tiers.length; i++) {
      var hit = tiers[i][0][tiers[i][1]]
      if (!hit) continue
      return hit.length === 1 ? { p: hit[0], tier: i } : { ambiguous: true }
    }
    return null
  }
  /** What a file name says: {product, pos, ambiguous}. A whole-name match beats a split. */
  function matchName(fileName) {
    if (!index) buildIndex()
    var stem = norm(stemOf(fileName))
    if (!stem) return { product: null, pos: null }
    var r = lookup(stem)
    if (r) return r.ambiguous ? { product: null, pos: null, ambiguous: true } : { product: r.p, pos: null }
    var m = /^(.+)-(\d{1,2})$/.exec(stem)
    if (m && Number(m[2]) >= 1) {
      r = lookup(m[1])
      if (r) return r.ambiguous ? { product: null, pos: null, ambiguous: true } : { product: r.p, pos: Number(m[2]) }
    }
    return { product: null, pos: null }
  }
  function productById(id) {
    for (var i = 0; products && i < products.length; i++) if (Number(products[i].id) === Number(id)) return products[i]
    return null
  }
  function productName(p) {
    if (!p) return ''
    return lang === 'ar' ? String(p.name_ar || p.name_en || p.slug) : String(p.name_en || p.name_ar || p.slug)
  }
  function isHidden(p) { return p && !Number(p.active) }

  // ------------------------------------------------------------ file analysis
  function sniff(b) {
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
    return ''
  }
  function looksSvg(b) {
    var s = ''
    for (var i = 0; i < Math.min(b.length, 512); i++) s += String.fromCharCode(b[i])
    return /<svg[\s>]|^\s*<\?xml/i.test(s)
  }
  /** Pixel size from the file header, as the server's getimagesize reports it. */
  function headerDims(b, mime) {
    try {
      if (mime === 'image/png') {
        if (b.length < 24) return null
        return { w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 }
      }
      if (mime === 'image/webp') {
        var tag = String.fromCharCode(b[12], b[13], b[14], b[15])
        if (tag === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
        if (tag === 'VP8L') return { w: 1 + (((b[22] & 0x3f) << 8) | b[21]), h: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) }
        if (tag === 'VP8 ') return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff }
        return null
      }
      if (mime === 'image/jpeg') {
        var i = 2, orient = 1
        while (i + 9 < b.length) {
          if (b[i] !== 0xff) { i++; continue }
          var mk = b[i + 1]
          if (mk === 0xff) { i++; continue }
          if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
            var jw = (b[i + 7] << 8) | b[i + 8], jh = (b[i + 5] << 8) | b[i + 6]
            // A phone photo is stored sideways with an EXIF turn; browsers (and so the shop) show it turned. Orientations 5-8
            // swap width and height, so the 4:5 check is made on the picture as it is seen.
            return orient >= 5 && orient <= 8 ? { w: jh, h: jw } : { w: jw, h: jh }
          }
          if (mk === 0xe1) orient = exifOrientation(b, i + 4, ((b[i + 2] << 8) | b[i + 3]) - 2) || orient
          if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue }
          i += 2 + ((b[i + 2] << 8) | b[i + 3])
        }
      }
    } catch (e) { /* fall through */ }
    return null
  }
  /** The EXIF Orientation (1-8) of an APP1 segment that starts at `at` and is `len` bytes long, or 0 when there is none. */
  function exifOrientation(b, at, len) {
    try {
      if (len < 14 || at + len > b.length) return 0
      if (String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]) !== 'Exif' || b[at + 4] !== 0 || b[at + 5] !== 0) return 0
      var tiff = at + 6, le = b[tiff] === 0x49 && b[tiff + 1] === 0x49
      if (!le && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return 0
      var r16 = function (o) { return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1] }
      var r32 = function (o) { return le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0 }
      var ifd = tiff + r32(tiff + 4), n = r16(ifd)
      if (ifd + 2 + 12 * n > at + len) return 0
      for (var k = 0; k < n; k++) {
        var e = ifd + 2 + 12 * k
        if (r16(e) === 0x0112) { var v = r16(e + 8); return v >= 1 && v <= 8 ? v : 0 }
      }
    } catch (x) { /* unreadable: treat as upright */ }
    return 0
  }
  function readBuffer(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader()
      fr.onload = function () { resolve(new Uint8Array(fr.result)) }
      fr.onerror = function () { reject(fr.error) }
      fr.readAsArrayBuffer(blob)
    })
  }
  /** Fallback when the header could not be read: let the browser decode it. createImageBitmap, not an
   *  <img src=blob:>, because the site's CSP allows img-src 'self' data: only. */
  function decodeDims(file) {
    if (!window.createImageBitmap) return Promise.resolve(null)
    return createImageBitmap(file).then(function (bmp) {
      var d = { w: bmp.width, h: bmp.height }
      if (bmp.close) bmp.close()
      return d
    }).catch(function () { return null })
  }
  /** A small preview (never uploaded): the browser decodes it at reduced size. */
  function makeThumb(file) {
    if (!window.createImageBitmap) return Promise.resolve('')
    return createImageBitmap(file, { resizeWidth: 144, resizeQuality: 'low' }).then(function (bmp) {
      var c = document.createElement('canvas')
      c.width = bmp.width; c.height = bmp.height
      var g = c.getContext('2d')
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
      g.drawImage(bmp, 0, 0)
      if (bmp.close) bmp.close()
      return c.toDataURL('image/jpeg', 0.7)
    }).catch(function () { return '' })
  }

  var chain = Promise.resolve()
  function analyse(item) {
    chain = chain.then(function () { return analyseOne(item) }).catch(function () {}).then(function () { item.checked = true; refreshRow(item); refreshAll() })
  }
  async function analyseOne(item) {
    var f = item.file
    if (f.size === 0) { item.block = 'empty'; return }
    var head
    try { head = await readBuffer(f.slice(0, 1048576)) } catch (e) { item.block = 'read'; return }
    var mime = sniff(head)
    if (!mime) { item.block = looksSvg(head) ? 'svg' : 'format'; return }
    item.mime = mime
    if (f.size > MAX_BYTES) { item.block = 'large'; return }
    var d = headerDims(head, mime) || await decodeDims(f)
    if (d && d.w > 0 && d.h > 0) { item.w = d.w; item.h = d.h }
    item.thumb = await makeThumb(f)
  }

  // ---------------------------------------------------------- list handling
  function sig(f) { return [f.name, f.size, f.lastModified].join('|') }
  function addFiles(fileList) {
    var list = Array.prototype.slice.call(fileList || []), added = 0, dup = 0, over = 0
    list.sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) })
    for (var i = 0; i < list.length; i++) {
      var f = list[i], same = false
      for (var j = 0; j < items.length; j++) if (items[j].sig === sig(f)) { same = true; break }
      if (same) { dup++; continue }
      if (items.length >= MAX_FILES) { over++; continue }
      var it = { id: nextId++, file: f, sig: sig(f), name: f.name, size: f.size, mime: '', w: 0, h: 0, thumb: '', block: '', checked: false,
        productId: null, pos: null, manual: false, ambiguous: false, phase: 'idle', error: '', errorCode: '', path: '', progress: 0, note: '', picker: false, node: null }
      // A file this page already wrote (removed or cleared from the list, then added again) is not written a second time:
      // the same path is added to the product instead. The page remembers only until it is reloaded; the saved log is paths.
      if (written[it.sig]) it.path = written[it.sig].path
      applyMatch(it)
      items.push(it)
      added++
      analyse(it)
    }
    showSummary = false
    var msg = []
    if (added) msg.push(t('added', { n: added }))
    if (dup) msg.push(t('skippedDup', { n: dup }))
    if (over) msg.push(t('tooMany', { n: MAX_FILES }))
    if (msg.length) setStatus(msg.join(' '))
    rebuildList()
    refreshAll()
  }
  function applyMatch(it) {
    if (it.manual) return
    var m = matchName(it.name)
    it.productId = m.product ? Number(m.product.id) : null
    it.pos = m.pos
    it.ambiguous = !!m.ambiguous
  }
  function rematchAll() {
    buildIndex()
    for (var i = 0; i < items.length; i++) if (items[i].phase === 'idle' || items[i].phase === 'failed') applyMatch(items[i])
  }
  /** Why the product cannot be saved from here, or ''. product_save cuts descriptions at 280 and refuses odd rows. */
  function holdCode(p) {
    if (!p) return ''
    function chars(s) { return s == null ? 0 : Array.from(String(s)).length }
    if (chars(p.desc_en) > DESC_MAX || chars(p.desc_ar) > DESC_MAX) return 'desc'
    // store_text(): control characters dropped, spaces trimmed, then 1..160 characters, for both names.
    function nameLen(v) { return chars(String(v == null ? '' : v).replace(/[\x00-\x1f\x7f]/g, '').replace(/^ +| +$/g, '')) }
    if (nameLen(p.name_en) < 1 || nameLen(p.name_en) > NAME_MAX || nameLen(p.name_ar) < 1 || nameLen(p.name_ar) > NAME_MAX) return 'name'
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(p.slug)) || String(p.slug).length > 80) return 'slug'
    var money = /^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,3})?$/
    if (!money.test(String(p.price)) || !(Number(p.price) > 0)) return 'price'
    var href = /^\/(?![\/\\])[A-Za-z0-9\/_\-?=&%.#]{0,180}$/
    var paths = splitImages(p.images)
    if (p.image != null && String(p.image).trim() !== '') paths.push(String(p.image).trim())
    for (var q = 0; q < paths.length; q++) if (!href.test(paths[q])) return 'link'
    if (hasSalePrice(p)) {
      if (!money.test(String(p.sale_price)) || !(Number(p.sale_price) > 0) || Number(p.sale_price) >= Number(p.price)) return 'price'
      // store_datetime(): 'YYYY-MM-DD hh:mm[:ss]' (a T for the space is fine), then start must not be after end.
      var d1 = saleDate(p.sale_starts_at), d2 = saleDate(p.sale_ends_at)
      if (d1 === false || d2 === false || (d1 && d2 && d1 > d2)) return 'dates'
    }
    return ''
  }
  function hasSalePrice(p) { return p.sale_price != null && p.sale_price !== '' }
  /** A sale date as the server reads it: '' / null -> null, a well-formed one -> 'YYYY-MM-DD hh:mm:ss', anything else -> false. */
  function saleDate(v) {
    var x = v == null ? '' : String(v).replace(/^\s+|\s+$/g, '')
    if (x === '') return null
    x = x.replace('T', ' ')
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(x)) return false
    return x.length === 16 ? x + ':00' : x
  }
  /** What the list shows for a file: its state key and the reason lines. */
  function view(it) {
    var warns = []
    var p = it.productId != null ? productById(it.productId) : null
    var st
    if (it.phase === 'done') st = 'done'
    else if (it.phase === 'uploading' || it.phase === 'attaching' || it.phase === 'queued') st = it.phase
    else if (it.phase === 'unattached') st = 'unattached'
    else if (it.phase === 'failed') st = 'failed'
    else if (!it.checked) st = 'checking'
    else if (it.block === 'large') st = 'toolarge'
    else if (it.block) st = 'refused'
    else if (!p) st = 'needs'
    else if (holdCode(p)) st = 'held'
    else st = 'ready'
    if (it.block && it.block !== 'read') warns.push({ level: 'block', text: t(it.block === 'svg' ? 'r_svg' : it.block === 'empty' ? 'r_empty' : it.block === 'large' ? 'r_large' : 'r_format') })
    if (it.block === 'read') warns.push({ level: 'block', text: t('e_read') })
    if (st === 'held') warns.push({ level: 'block', text: t('r_' + holdCode(p)) })
    if (it.ambiguous && !p) warns.push({ level: 'warn', text: t('w_ambig') })
    if (!it.block && it.checked) {
      if (it.w && it.h) {
        if (Math.max(it.w, it.h) < MIN_LONG) warns.push({ level: 'warn', text: t('w_small', { w: it.w, h: it.h }) })
        if (Math.abs(it.w / it.h - RATIO) / RATIO > RATIO_TOL) warns.push({ level: 'warn', text: t('w_aspect', { w: it.w, h: it.h }) })
      } else warns.push({ level: 'warn', text: t('w_dims') })
    }
    if (p && isHidden(p) && st !== 'done') warns.push({ level: 'warn', text: t('w_hidden') })
    // Position 1 takes the main place. The product's current main photo is not lost: it moves to the front of the
    // other photos (attachPlan). The owner is told BEFORE the upload, not after.
    if (p && st !== 'done' && it.pos === 1 && p.image != null && String(p.image).trim() !== '') warns.push({ level: 'warn', text: t('w_main') })
    // product_save empties both sale dates when there is no sale price, whatever was sent: say so before a photo does it.
    if (p && st !== 'done' && !hasSalePrice(p) && ((p.sale_starts_at != null && p.sale_starts_at !== '') || (p.sale_ends_at != null && p.sale_ends_at !== ''))) warns.push({ level: 'warn', text: t('w_dates') })
    if (it.path && st !== 'done' && it.phase === 'idle') warns.push({ level: 'warn', text: t('w_again') })
    if (p && it.pos != null && st !== 'done') {
      for (var i = 0; i < items.length; i++) {
        var o = items[i]
        if (o !== it && o.productId === it.productId && o.pos === it.pos && !o.block && o.phase !== 'done' && o.id < it.id) { warns.push({ level: 'warn', text: t('w_dup') }); break }
      }
    }
    return { state: st, warns: warns, product: p }
  }

  // ----------------------------------------------------------------- attaching
  function splitImages(v) {
    return String(v == null ? '' : v).split(',').map(function (s) { return s.trim() }).filter(Boolean)
  }
  /** Where the new path goes on the row as read just now. Pure: nothing is sent here. */
  function attachPlan(row, path, pos) {
    var main = row.image == null ? '' : String(row.image).trim()
    var extras = splitImages(row.images)
    if (main === path) return { already: true, role: 'main' }
    if (extras.indexOf(path) >= 0) return { already: true, role: 'extra', k: extras.indexOf(path) + 2 }
    var image = main, images = extras.slice(), role, k, moved = false
    if (pos === 1 || !main) {
      image = path; role = 'main'; k = 1
      // A main photo that is already there is not dropped: it goes to the front of the other photos.
      if (main) { images = [main].concat(images.filter(function (x) { return x !== main })); moved = true }
    } else { images.push(path); role = 'extra'; k = images.length + 1 }
    return { already: false, image: image, images: images, role: role, k: k, moved: moved, prevImage: main, prevImages: extras.join(',') }
  }
  /** The whole row, every field as read; only image and images differ. */
  function saveBody(row, plan) {
    function money(v) { return typeof v === 'number' ? v : String(v) }
    return {
      id: Number(row.id), slug: row.slug, name_en: row.name_en, name_ar: row.name_ar,
      desc_en: row.desc_en == null ? null : row.desc_en, desc_ar: row.desc_ar == null ? null : row.desc_ar,
      price: money(row.price),
      sale_price: row.sale_price == null || row.sale_price === '' ? null : money(row.sale_price),
      sale_starts_at: row.sale_starts_at || null, sale_ends_at: row.sale_ends_at || null,
      featured: !!Number(row.featured), featured_sort: Number(row.featured_sort) || 0,
      category: row.category == null ? null : row.category, brand_slug: row.brand_slug == null ? '' : row.brand_slug,
      image: plan.image || null, images: plan.images.join(','), active: !!Number(row.active)
    }
  }

  // -------------------------------------------------------------------- queue
  function queueOrder(list) {
    var first = {}, has1 = {}
    list.forEach(function (it, i) { if (first[it.productId] == null) first[it.productId] = i; if (it.pos === 1) has1[it.productId] = true })
    function eff(it) { return it.pos == null ? (has1[it.productId] ? 1.5 : 1) : it.pos }
    return list.map(function (it, i) { return { it: it, i: i } }).sort(function (a, b) {
      var fa = first[a.it.productId], fb = first[b.it.productId]
      return fa - fb || eff(a.it) - eff(b.it) || a.i - b.i
    }).map(function (x) { return x.it })
  }
  function toDataUrl(file, mime) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader()
      fr.onload = function () {
        var s = String(fr.result), at = s.indexOf(',')
        // The payload is the file's own base64. Only the label is replaced: a file whose
        // type the browser guessed wrongly must still carry the type its bytes have.
        resolve('data:' + mime + ';base64,' + s.slice(at + 1))
      }
      fr.onerror = function () { reject(fr.error) }
      fr.readAsDataURL(file)
    })
  }
  function signedOut(r) { return r.status === 401 || (r.body && r.body.error === 'not_signed_in') }
  function reason(r, fallbackKey) {
    var code = r.status === 429 ? 'too_many' : r.status === 0 ? 'network' : (r.body && r.body.error) || ('HTTP ' + r.status)
    var known = STR.en['e_' + code] != null
    return { code: code, text: known ? t('e_' + code) : t(fallbackKey || 'e_save') + ' (' + code + ').' }
  }
  function fail(item, phase, r, fallbackKey) {
    var why = reason(r, fallbackKey)
    item.phase = phase; item.error = why.text; item.errorCode = why.code
    run.failed++
  }
  function persistLog() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-500))) } catch (e) { /* private window: the in-page list still works */ }
  }
  function loadLog() {
    try { var j = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); if (Array.isArray(j)) log = j } catch (e) { log = [] }
  }

  async function processItem(item) {
    var entry = null
    run.current = item.name
    if (!item.path) {
      item.phase = 'uploading'; item.progress = 0; item.error = ''; item.errorCode = ''
      refreshRow(item)
      setStatus(t('running', { i: run.done + 1, n: run.total, name: item.name }))
      var dataUrl
      try { dataUrl = await toDataUrl(item.file, item.mime) } catch (e) { fail(item, 'failed', { status: 0, body: { error: 'read' } }); return }
      var up = await patient(function () {
        item.progress = 0
        return postUpload({ name: item.name, data: dataUrl }, function (f) { item.progress = f; refreshProgress(item) })
      }, item)
      dataUrl = null
      if (signedOut(up)) { halted = true; item.phase = 'idle'; item.progress = 0; return }
      if (!up.ok || !up.body || typeof up.body.path !== 'string') { fail(item, 'failed', up, 'e_save'); return }
      item.path = up.body.path; item.progress = 1
      written[item.sig] = { path: item.path }
      run.uploaded++
      var p0 = productById(item.productId)
      entry = { t: new Date().toISOString(), file: item.name, slug: p0 ? p0.slug : '', pos: item.pos, path: item.path, bytes: up.body.bytes, attached: false, prevImage: '', prevImages: '' }
      log.push(entry); item.entry = entry; persistLog()
    } else {
      entry = item.entry || null
      if (!entry) {
        // The path is one this page wrote earlier (the same file added to the list again): nothing is uploaded, but
        // the product it is added to still gets its own log line, flagged so the "files written" count stays true.
        var p1 = productById(item.productId)
        entry = { t: new Date().toISOString(), file: item.name, slug: p1 ? p1.slug : '', pos: item.pos, path: item.path, bytes: item.size, attached: false, again: true, prevImage: '', prevImages: '' }
        log.push(entry); item.entry = entry; persistLog()
      }
    }

    // Attach: read the row again right now, then save it whole.
    item.phase = 'attaching'; item.error = ''; item.errorCode = ''
    refreshRow(item)
    var rd = await patient(function () { return call('products_all') }, item)
    if (signedOut(rd)) { halted = true; item.phase = 'unattached'; return }
    var rows = rowsOf(rd.body)
    if (!rd.ok || !rows) { fail(item, 'unattached', { status: rd.status, body: { error: 'read_products' } }); return }
    products = rows; buildIndex()
    var row = productById(item.productId)
    if (!row) { fail(item, 'unattached', { status: 0, body: { error: 'gone' } }); return }
    var hold = holdCode(row)
    if (hold) { item.phase = 'unattached'; item.error = t('r_' + hold); item.errorCode = hold; run.failed++; return }
    var plan = attachPlan(row, item.path, item.pos)
    if (plan.already) {
      item.phase = 'done'; run.attached++; if (entry) { entry.attached = true; persistLog() }
      item.note = t('attachedOk', { n: productName(row), w: plan.role === 'main' ? t('asMain') : t('asExtra', { k: plan.k }) })
      return
    }
    var sv = await patient(function () { return call('product_save', saveBody(row, plan)) }, item)
    if (signedOut(sv)) { halted = true; item.phase = 'unattached'; return }
    if (!sv.ok || !sv.body || sv.body.error) { fail(item, 'unattached', sv, 'e_save'); return }
    if (sv.body.id != null) for (var i = 0; i < products.length; i++) if (Number(products[i].id) === Number(sv.body.id)) products[i] = sv.body
    item.phase = 'done'; run.attached++
    staleList = true
    item.note = t('attachedOk', { n: productName(row), w: plan.role === 'main' ? t('asMain') : t('asExtra', { k: plan.k }) }) + (plan.moved ? ' ' + t('movedMain') : '')
    if (entry) { entry.attached = true; entry.prevImage = plan.prevImage; entry.prevImages = plan.prevImages; persistLog() }
  }

  async function runQueue() {
    if (running) return
    running = true; stopReq = false; halted = false; showSummary = false
    var order = queueOrder(items.filter(function (it) { return it.phase === 'queued' }))
    run = { total: order.length, done: 0, uploaded: 0, attached: 0, failed: 0, current: '' }
    refreshAll()
    try {
      for (var i = 0; i < order.length; i++) {
        var it = order[i]
        if (stopReq || halted) break
        if (it.phase !== 'queued') continue
        await processItem(it)
        refreshRow(it)
        run.done++
        refreshAll()
        if (halted) break
        if (i < order.length - 1 && !stopReq) await sleep(cfg('paceMs', 250))
      }
    } finally {
      var left = 0
      items.forEach(function (it) { if (it.phase === 'queued') { it.phase = it.path ? 'unattached' : 'idle'; left++; refreshRow(it) } })
      running = false
      showSummary = true
      if (halted) setStatus(t('halted'))
      else if (stopReq && left) setStatus(t('stopped', { n: left }))
      else setStatus(t('sumDone') + ' ' + t('sumLine', { u: run.uploaded, a: run.attached, f: run.failed }) + (staleList ? ' ' + t('staleShort') : ''))
      stopReq = false
      refreshAll()
    }
  }
  function enqueue(list) {
    list.forEach(function (it) { it.phase = 'queued'; it.error = ''; it.errorCode = ''; refreshRow(it) })
    if (list.length) runQueue()
  }
  function readyItems() { return items.filter(function (it) { return view(it).state === 'ready' }) }
  function failedItems() { return items.filter(function (it) { return it.phase === 'failed' || it.phase === 'unattached' }) }

  window.addEventListener('beforeunload', function (e) {
    if (!running) return undefined
    e.preventDefault(); e.returnValue = ''
    return ''
  })

  // ------------------------------------------------------------------- styles
  var CSS = [
    '.sph{--sph-bg:#fff;--sph-soft:#f7f8fa;--sph-line:#d9dfe5;--sph-edge:#7d8799;--sph-text:#18212a;--sph-muted:#556274;--sph-action:#9a452c;--sph-action-hover:#813a25;--sph-on-action:#fff;--sph-ok:#166534;--sph-warn:#8a4b00;--sph-err:#be123c;--sph-focus:#9a452c;--sph-over:#f8ece6;',
    'container-type:inline-size;box-sizing:border-box;margin:0 0 1.25rem;padding:1rem;border:1px solid var(--sph-line);border-radius:1rem;background:var(--sph-bg);color:var(--sph-text);font:400 .875rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:start}',
    ':is(html.dark,html[data-theme="dark"]) .sph{--sph-bg:#151b21;--sph-soft:#1a2128;--sph-line:#303942;--sph-edge:#7a8896;--sph-text:#eef2f5;--sph-muted:#a7b3be;--sph-action:#ff7b17;--sph-action-hover:#ff9a4d;--sph-on-action:#171a1e;--sph-ok:#6ee7a3;--sph-warn:#fbbf24;--sph-err:#fda4af;--sph-focus:#ff7b17;--sph-over:#37251e}',
    '.sph *,.sph *::before,.sph *::after{box-sizing:border-box}',
    '.sph-title{margin:0;font-size:1.125rem;font-weight:700;color:var(--sph-text)}',
    '.sph p{margin:.375rem 0 0;color:var(--sph-text)}',
    '.sph .sph-muted{color:var(--sph-muted)}',
    '.sph code{font:600 .8125rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--sph-text);background:var(--sph-soft);border:1px solid var(--sph-line);border-radius:.375rem;padding:0 .3rem;unicode-bidi:isolate;direction:ltr}',
    '.sph ul{margin:0;padding:0;list-style:none}',
    '.sph-ex{margin-top:.5rem!important;display:grid;gap:.25rem}',
    '.sph-drop{margin-top:.875rem;display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;padding:1rem;border:2px dashed var(--sph-edge);border-radius:.875rem;background:var(--sph-soft)}',
    '.sph-drop[data-over="1"]{background:var(--sph-over);border-color:var(--sph-action)}',
    '.sph-drop p{margin:0}',
    '.sph-file{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}',
    '.sph button,.sph select,.sph input[type="search"]{font:inherit;color:var(--sph-text);min-height:2.75rem;border-radius:.75rem}',
    // The admin add-on stylesheet paints EVERY field with an !important ink (#18212a, for the white admin). In
    // the dark theme that is dark ink on a dark field, so the panel's fields say their colours with !important too.
    '.sph :is(select,input[type="search"]){color:var(--sph-text)!important;background-color:var(--sph-bg)!important}',
    '.sph input::placeholder{color:var(--sph-muted)!important;opacity:1!important}',
    '.sph .sph-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:.5rem 1rem;border:1px solid var(--sph-edge);background:var(--sph-bg);color:var(--sph-text);font-weight:600;cursor:pointer;text-align:center}',
    '.sph .sph-btn:hover:not(:disabled){background:var(--sph-soft);border-color:var(--sph-text)}',
    '.sph .sph-btn--primary{background:var(--sph-action);border-color:transparent;color:var(--sph-on-action);font-weight:700}',
    '.sph .sph-btn--primary:hover:not(:disabled){background:var(--sph-action-hover);border-color:transparent}',
    '.sph .sph-btn:disabled{cursor:not-allowed;background:var(--sph-soft);border-color:var(--sph-line);color:var(--sph-muted)}',
    '.sph .sph-btn--small{min-height:2.75rem;padding:.25rem .75rem;font-size:.8125rem}',
    '.sph :is(button,select,input,summary):focus-visible,.sph .sph-drop:focus-visible{outline:2px solid var(--sph-focus);outline-offset:2px}',
    '.sph select,.sph input[type="search"]{border:1px solid var(--sph-edge);background:var(--sph-bg);padding:.25rem .5rem}',
    '.sph input[type="search"]{width:100%}',
    '.sph-bar{margin-top:.875rem;display:flex;flex-wrap:wrap;gap:.5rem}',
    '.sph-bar>.sph-btn{flex:1 1 auto}',
    '@container (min-width:560px){.sph-bar>.sph-btn{flex:0 0 auto}}',
    '.sph-prod{margin-top:.75rem!important}',
    '.sph-overall{margin-top:.75rem;display:flex;align-items:center;gap:.75rem}',
    '.sph progress{appearance:none;-webkit-appearance:none;height:.5rem;border:0;border-radius:.25rem;background:var(--sph-line);accent-color:var(--sph-action);overflow:hidden}',
    '.sph progress::-webkit-progress-bar{background:var(--sph-line);border-radius:.25rem}',
    '.sph progress::-webkit-progress-value{background:var(--sph-action);border-radius:.25rem}',
    '.sph progress::-moz-progress-bar{background:var(--sph-action);border-radius:.25rem}',
    '.sph-overall progress{flex:1 1 auto;min-width:0}',
    '.sph-status{min-height:1.5rem;font-weight:600}',
    '.sph-list{margin-top:.875rem!important;display:grid;gap:.625rem}',
    '.sph-row{display:grid;grid-template-columns:3.5rem minmax(0,1fr);gap:.5rem .75rem;padding:.75rem;border:1px solid var(--sph-line);border-radius:.875rem;background:var(--sph-bg)}',
    '.sph-row[data-state="done"]{background:var(--sph-soft)}',
    '.sph-thumb{width:3.5rem;height:4.375rem;border-radius:.5rem;border:1px solid var(--sph-line);background:var(--sph-soft);object-fit:cover;display:block}',
    '.sph-thumb--none{display:flex;align-items:center;justify-content:center;color:var(--sph-muted);font-size:.6875rem;font-weight:600}',
    '.sph-main{min-width:0}',
    '.sph-name{margin:0!important;font-weight:700;overflow-wrap:anywhere;unicode-bidi:plaintext}',
    '.sph-meta{margin:.125rem 0 0!important;color:var(--sph-muted)!important}',
    '.sph-match{margin-top:.5rem;display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .75rem}',
    '.sph-match label{display:inline-flex;align-items:center;gap:.4rem;color:var(--sph-muted);font-weight:600}',
    '.sph-who{display:inline-flex;flex-wrap:wrap;align-items:center;gap:.25rem .5rem;min-width:0;font-weight:600}',
    '.sph-warns{margin-top:.5rem!important;display:grid;gap:.25rem}',
    '.sph-warns li{color:var(--sph-warn);font-weight:600}',
    '.sph-warns li[data-level="block"]{color:var(--sph-err)}',
    '.sph-side{grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .75rem}',
    '.sph-badge{display:inline-block;padding:.125rem .625rem;border:1px solid currentColor;border-radius:999px;background:var(--sph-bg);font-size:.8125rem;font-weight:700;color:var(--sph-muted)}',
    '.sph-row[data-state="done"] .sph-badge{color:var(--sph-ok)}',
    '.sph-row:is([data-state="failed"],[data-state="unattached"],[data-state="toolarge"],[data-state="refused"],[data-state="held"]) .sph-badge{color:var(--sph-err)}',
    '.sph-row[data-state="needs"] .sph-badge{color:var(--sph-warn)}',
    '.sph-row[data-state="ready"] .sph-badge{color:var(--sph-text)}',
    '.sph-rowbar{width:6rem}',
    '.sph-detail{margin:0!important;flex:1 1 12rem;min-width:0;overflow-wrap:anywhere}',
    '.sph-detail[data-bad="1"]{color:var(--sph-err)}',
    '.sph-picker{margin-top:.5rem;padding:.625rem;border:1px solid var(--sph-line);border-radius:.75rem;background:var(--sph-soft)}',
    '.sph-results{margin-top:.5rem!important;display:grid;gap:.25rem}',
    '.sph-results .sph-btn{width:100%;justify-content:flex-start;flex-wrap:wrap;text-align:start}',
    '.sph-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}',
    '.sph-sum{margin-top:.875rem;padding:.75rem;border:1px solid var(--sph-line);border-radius:.75rem;background:var(--sph-soft)}',
    '.sph-sum h4{margin:0;font-size:.9375rem;font-weight:700;color:var(--sph-text)}',
    '.sph-stale{margin-top:.875rem;padding:.75rem;border:1px solid var(--sph-warn);border-radius:.75rem;background:var(--sph-soft);display:grid;gap:.5rem;justify-items:start}',
    '.sph-stale[hidden]{display:none}',
    '.sph-stale p{margin:0;font-weight:600;color:var(--sph-text)}',
    '.sph-log{margin-top:.875rem}',
    '.sph-log summary{cursor:pointer;min-height:2.75rem;display:flex;align-items:center;font-weight:700;border-radius:.5rem}',
    '.sph-log ol{margin:.5rem 0 0;padding:0 1.25rem;display:grid;gap:.25rem}',
    '.sph-log li{overflow-wrap:anywhere}',
    '@container (min-width:600px){.sph-row{grid-template-columns:4.5rem minmax(0,1fr) minmax(11rem,16rem)}.sph-thumb{width:4.5rem;height:5.625rem}.sph-side{grid-column:auto;flex-direction:column;align-items:flex-start}.sph-detail{flex:0 1 auto}.sph-rowbar{width:100%}}',
    '@media (prefers-reduced-motion:no-preference){.sph-row{transition:background-color .15s ease}.sph .sph-btn{transition:background-color .15s ease,border-color .15s ease}}'
  ].join('\n')
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return
    styleEl = document.createElement('style')
    styleEl.setAttribute('data-sporta-photos-style', '')
    styleEl.textContent = CSS
    document.head.appendChild(styleEl)
  }

  // ----------------------------------------------------------------- the panel
  function button(cls, label, k, onClick) {
    var b = el('button', 'sph-btn' + (cls ? ' ' + cls : ''), label)
    b.type = 'button'
    if (k) b.setAttribute('data-k', k)
    if (onClick) b.addEventListener('click', onClick)
    return b
  }
  function setStatus(msg) {
    statusText = msg
    if (refs && refs.status && refs.status.textContent !== msg) refs.status.textContent = msg
  }

  function buildPanel() {
    ensureStyle()
    var root = el('section', 'sph')
    root.setAttribute('data-sporta-photos', '')
    root.setAttribute('lang', lang)
    root.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
    root.setAttribute('aria-labelledby', 'sph-title')
    var head = el('h3', 'sph-title', t('title')); head.id = 'sph-title'
    root.appendChild(head)
    root.appendChild(el('p', '', t('intro')))
    var ex = el('ul', 'sph-ex')
    ;[['tee-white-1.jpg', 'exMain'], ['tee-white-2.jpg', 'exSecond'], ['tee-white.jpg', 'exAuto']].forEach(function (e) {
      var li = el('li'); li.appendChild(el('code', '', e[0])); li.appendChild(document.createTextNode(' → ' + t(e[1]))); ex.appendChild(li)
    })
    root.appendChild(ex)
    root.appendChild(el('p', 'sph-muted', t('limits')))

    var drop = el('div', 'sph-drop')
    drop.setAttribute('role', 'group'); drop.setAttribute('aria-label', t('dropAria'))
    var input = el('input', 'sph-file')
    input.type = 'file'; input.multiple = true; input.accept = 'image/png,image/jpeg,image/webp'
    input.setAttribute('data-sph', 'input'); input.tabIndex = -1; input.setAttribute('aria-hidden', 'true')
    var choose = button('sph-btn--primary', t('choose'), 'choose', function () { input.click() })
    input.addEventListener('change', function () { addFiles(input.files); input.value = '' })
    drop.appendChild(choose); drop.appendChild(el('p', 'sph-muted', t('drop'))); drop.appendChild(input)
    ;['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.setAttribute('data-over', '1') }) })
    drop.addEventListener('dragleave', function (e) { if (!drop.contains(e.relatedTarget)) drop.removeAttribute('data-over') })
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.removeAttribute('data-over'); if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files) })
    root.appendChild(drop)

    var prod = el('p', 'sph-prod sph-muted'); prod.setAttribute('role', 'status')
    var reload = button('sph-btn--small', t('reload'), 'reload', function () { loadProducts(true) })
    root.appendChild(prod)

    var bar = el('div', 'sph-bar')
    var start = button('sph-btn--primary', t('uploadNone'), 'start', function () { enqueue(readyItems()) })
    var stop = button('', t('stop'), 'stop', function () { stopReq = true; setStatus(t('stopping')); refreshAll() })
    var retry = button('', '', 'retryall', function () { enqueue(failedItems()) })
    var clear = button('', t('clear'), 'clear', function () {
      items = items.filter(function (it) { return it.phase === 'uploading' || it.phase === 'attaching' || it.phase === 'queued' })
      showSummary = false; rebuildList(); refreshAll()
    })
    ;[start, stop, retry, clear].forEach(function (b) { bar.appendChild(b) })
    root.appendChild(bar)
    var hint2 = el('p', 'sph-muted sph-hint')
    root.appendChild(hint2)

    var overall = el('div', 'sph-overall'); overall.hidden = true
    var bar2 = document.createElement('progress'); bar2.max = 1; bar2.value = 0; bar2.setAttribute('aria-label', t('overallLabel'))
    var overallText = el('span', 'sph-muted')
    overall.appendChild(bar2); overall.appendChild(overallText)
    root.appendChild(overall)

    var status = el('p', 'sph-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('data-sph', 'status')
    root.appendChild(status)
    var list = el('ul', 'sph-list'); list.setAttribute('data-sph', 'list')
    root.appendChild(list)
    var sum = el('div', 'sph-sum'); sum.hidden = true; sum.setAttribute('data-sph', 'summary')
    root.appendChild(sum)
    // The product list the compiled screen drew was read BEFORE the photos were added and is not redrawn by this panel.
    // Editing a product in it and pressing Save would send its old image / images back. Said in words, with the way out.
    var stale = el('div', 'sph-stale'); stale.hidden = true; stale.setAttribute('data-sph', 'stale'); stale.setAttribute('role', 'alert')
    stale.appendChild(el('p', '', t('staleNote')))
    stale.appendChild(button('sph-btn--primary sph-btn--small', t('staleReload'), 'reloadpage', function () { location.reload() }))
    root.appendChild(stale)

    var det = document.createElement('details'); det.className = 'sph-log'
    var summ = el('summary', '', ''); det.appendChild(summ)
    var hint = el('p', 'sph-muted', t('logHint'))
    var ol = el('ol'); ol.setAttribute('data-sph', 'log')
    var acts = el('div', 'sph-bar')
    var copy = button('sph-btn--small', t('logCopy'), 'logcopy', function () { copyLog() })
    var save = button('sph-btn--small', t('logSave'), 'logsave', function () { downloadLog() })
    acts.appendChild(copy); acts.appendChild(save)
    det.appendChild(hint); det.appendChild(ol); det.appendChild(acts)
    root.appendChild(det)

    refs = { root: root, drop: drop, input: input, prod: prod, reload: reload, start: start, stop: stop, retry: retry, clear: clear, overall: overall, bar: bar2, overallText: overallText,
      status: status, hint: hint2, list: list, sum: sum, stale: stale, logSummary: summ, logList: ol, logDet: det }
    panel = root
    status.textContent = statusText
    return root
  }

  function logLine(e) {
    return [e.t, e.slug || '?', 'pos ' + (e.pos == null ? 'auto' : e.pos), e.path, e.attached ? 'attached' : 'NOT attached',
      'was image=' + (e.prevImage || '-') + ' images=' + (e.prevImages || '-'), e.file].concat(e.again ? ['same file, not written again'] : []).join(' | ')
  }
  function logText() { return log.map(logLine).join('\n') + (log.length ? '\n' : '') }
  function copyLog() {
    var text = logText()
    function done() { setStatus(t('logCopied')) }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done) })
    else fallbackCopy(text, done)
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea')
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy'); done() } catch (e) { /* the list is on screen to copy by hand */ }
    document.body.removeChild(ta)
  }
  function downloadLog() {
    var url = URL.createObjectURL(new Blob([logText()], { type: 'text/plain;charset=utf-8' }))
    var a = document.createElement('a')
    a.href = url; a.download = 'sporta-photos-written.txt'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(function () { URL.revokeObjectURL(url) }, 2000)
  }

  // --------------------------------------------------------------- the rows
  function keepFocus(root, fn) {
    var a = document.activeElement, k = a && root.contains(a) ? a.getAttribute('data-k') : null
    var picked = k === 'psearch' && a ? a.value : null
    fn()
    if (k) {
      var n = root.querySelector('[data-k="' + k + '"]')
      if (n && !n.disabled && !n.hidden) { n.focus(); if (picked != null && n.setSelectionRange) try { n.setSelectionRange(picked.length, picked.length) } catch (e) { /* not a text field */ } }
    }
  }
  function rebuildList() {
    if (!refs) return
    while (refs.list.firstChild) refs.list.removeChild(refs.list.firstChild)
    items.forEach(function (it) {
      var li = el('li', 'sph-row'); li.setAttribute('data-id', String(it.id))
      it.node = li
      refs.list.appendChild(li)
      renderRow(it)
    })
  }
  function refreshRow(it) {
    if (!it.node || !it.node.isConnected) return
    keepFocus(it.node, function () { renderRow(it) })
  }
  function refreshProgress(it) {
    var p = it.node && it.node.querySelector('progress')
    if (p) p.value = it.progress
  }
  function editable(it) { return it.phase === 'idle' || it.phase === 'failed' || it.phase === 'unattached' || it.phase === 'queued' }

  function renderRow(it) {
    var li = it.node, v = view(it)
    while (li.firstChild) li.removeChild(li.firstChild)
    li.setAttribute('data-state', v.state)
    // thumbnail (decorative: the name is next to it)
    if (it.thumb) { var img = el('img', 'sph-thumb'); img.alt = ''; img.src = it.thumb; li.appendChild(img) }
    else li.appendChild(el('div', 'sph-thumb sph-thumb--none', it.mime ? FORMATS[it.mime] : ''))
    var main = el('div', 'sph-main')
    var nm = el('p', 'sph-name', it.name); nm.setAttribute('dir', 'ltr'); main.appendChild(nm)
    var meta = [fmtSize(it.size)]
    if (it.w && it.h) meta.push(num(it.w) + '×' + num(it.h) + ' ' + t('unit'))
    if (it.mime) meta.push(FORMATS[it.mime])
    var mp = el('p', 'sph-meta', meta.join(' · ')); main.appendChild(mp)

    if (!it.block) {
      var match = el('div', 'sph-match')
      var who = el('span', 'sph-who')
      var lab = el('span', 'sph-muted', t('product') + ':')
      who.appendChild(lab)
      if (v.product) {
        who.appendChild(document.createTextNode(productName(v.product)))
        who.appendChild(el('code', '', String(v.product.slug)))
        if (isHidden(v.product)) who.appendChild(el('span', 'sph-muted', t('hidden')))
      } else who.appendChild(document.createTextNode(t('choosePro')))
      match.appendChild(who)
      if (editable(it)) {
        var ch = button('sph-btn--small', t('change'), 'change', function () { it.picker = !it.picker; if (!it.picker) it.pickerNode = null; refreshRow(it); if (it.picker) { var s = it.node.querySelector('[data-k="psearch"]'); if (s) s.focus() } })
        ch.setAttribute('aria-expanded', it.picker ? 'true' : 'false')
        match.appendChild(ch)
        var pl = el('label'); pl.appendChild(el('span', 'sph-lbl', t('position')))
        var sel = document.createElement('select'); sel.setAttribute('data-k', 'pos')
        var opt0 = el('option', '', t('auto')); opt0.value = ''; sel.appendChild(opt0)
        // 1..12, and the number the file name asked for when it is higher (air-max-15.jpg): never a blank select.
        for (var n = 1; n <= Math.max(12, it.pos || 0); n++) { var o = el('option', '', num(n)); o.value = String(n); sel.appendChild(o) }
        sel.value = it.pos == null ? '' : String(it.pos)
        sel.addEventListener('change', function () { it.pos = sel.value === '' ? null : Number(sel.value); it.manual = true; items.forEach(refreshRow); refreshAll() })
        pl.appendChild(sel)
        match.appendChild(pl)
      } else if (it.pos != null) {
        match.appendChild(el('span', 'sph-muted', t('position') + ': ' + num(it.pos)))
      }
      main.appendChild(match)
      if (it.picker && editable(it)) main.appendChild(pickerFor(it))
    }
    if (v.warns.length) {
      var wl = el('ul', 'sph-warns')
      v.warns.forEach(function (w) { var wi = el('li', '', (w.level === 'block' ? '✕ ' : '▲ ') + w.text); wi.setAttribute('data-level', w.level); wl.appendChild(wi) })
      main.appendChild(wl)
    }
    li.appendChild(main)

    var side = el('div', 'sph-side')
    side.appendChild(el('span', 'sph-badge', t('st_' + v.state)))
    if (it.phase === 'uploading' || it.phase === 'attaching') {
      var pr = document.createElement('progress'); pr.className = 'sph-rowbar'; pr.max = 1
      pr.setAttribute('aria-label', t('st_' + v.state) + ': ' + it.name)
      if (it.phase === 'uploading') pr.value = it.progress
      side.appendChild(pr)
    }
    var detail = ''
    if (it.error) detail = it.error
    else if (it.note) detail = it.note
    if (detail) { var d = el('p', 'sph-detail', detail); if (it.error) d.setAttribute('data-bad', '1'); side.appendChild(d) }
    if (it.path) { var pp = el('p', 'sph-detail sph-muted'); pp.appendChild(document.createTextNode(t('path', { p: '' }))); pp.appendChild(el('code', '', it.path)); side.appendChild(pp) }
    if (it.phase === 'failed' || it.phase === 'unattached') side.appendChild(button('sph-btn--small', t('retry'), 'retry', function () { enqueue([it]) }))
    if (it.phase !== 'uploading' && it.phase !== 'attaching' && it.phase !== 'queued') {
      side.appendChild(button('sph-btn--small', t('remove'), 'remove', function () {
        items = items.filter(function (x) { return x !== it }); if (it.node && it.node.parentNode) it.node.parentNode.removeChild(it.node); refreshAll()
      }))
    }
    li.appendChild(side)
  }

  /** The searchable product list for one file. Built once per opening so typing is never interrupted by a refresh. */
  function pickerFor(it) {
    if (it.pickerNode) return it.pickerNode
    var box = el('div', 'sph-picker')
    var input = el('input'); input.type = 'search'; input.setAttribute('data-k', 'psearch'); input.setAttribute('aria-label', t('search')); input.placeholder = t('search'); input.autocomplete = 'off'
    var live = el('p', 'sph-sr'); live.setAttribute('role', 'status')
    var ul = el('ul', 'sph-results')
    var more = el('p', 'sph-muted')
    function fill() {
      var q = norm(input.value).split('-').filter(Boolean)
      var hits = (products || []).filter(function (p) {
        var hay = ' ' + String(p.slug).toLowerCase() + ' ' + String(p.name_en || '').toLowerCase() + ' ' + String(p.name_ar || '').toLowerCase()
        hay = hay.replace(/[^a-z0-9؀-ۿ]+/g, ' ')
        return q.every(function (w) { return hay.indexOf(w) >= 0 })
      })
      while (ul.firstChild) ul.removeChild(ul.firstChild)
      hits.slice(0, 8).forEach(function (p, i) {
        var li = el('li')
        var b = button('', '', 'pick' + i, function () {
          it.productId = Number(p.id); it.manual = true; it.ambiguous = false; it.picker = false; it.pickerNode = null
          refreshRow(it); refreshAll()
          var c = it.node.querySelector('[data-k="change"]'); if (c) c.focus()
        })
        b.appendChild(document.createTextNode(productName(p))); b.appendChild(el('code', '', String(p.slug)))
        if (isHidden(p)) b.appendChild(el('span', 'sph-muted', t('hidden')))
        li.appendChild(b); ul.appendChild(li)
      })
      more.textContent = hits.length > 8 ? t('more', { n: hits.length - 8 }) : (hits.length ? '' : t('noResults'))
      live.textContent = t('results', { n: hits.length })
    }
    input.addEventListener('input', fill)
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); it.picker = false; it.pickerNode = null; refreshRow(it); var c = it.node.querySelector('[data-k="change"]'); if (c) c.focus() }
      if (e.key === 'Enter' && e.target === input) e.preventDefault()
    })
    box.appendChild(input); box.appendChild(live); box.appendChild(ul); box.appendChild(more)
    fill()
    it.pickerNode = box
    return box
  }

  // ------------------------------------------------------- panel-level refresh
  function refreshAll() {
    if (!refs) return
    var ready = 0, needs = 0, held = 0
    items.forEach(function (it) { var s = view(it).state; if (s === 'ready') ready++; else if (s === 'needs') needs++; else if (s === 'held') held++ })
    var failed = failedItems().length
    refs.prod.textContent = ''
    if (loadingProducts) refs.prod.textContent = t('prodLoading')
    else if (productsErr) {
      refs.prod.appendChild(document.createTextNode(t('prodFail', { e: productsErr }) + ' '))
      refs.prod.appendChild(refs.reload)
    } else if (products) refs.prod.textContent = t('prodCount', { n: products.length })
    refs.start.textContent = ready === 1 ? t('upload1') : ready > 1 ? t('upload', { n: ready }) : t('uploadNone')
    refs.start.disabled = running || ready === 0
    refs.stop.hidden = !running
    refs.stop.disabled = stopReq
    refs.retry.hidden = running || failed === 0
    refs.retry.textContent = t('retryAll', { n: failed })
    refs.clear.disabled = running && items.every(function (it) { return it.phase === 'queued' || it.phase === 'uploading' || it.phase === 'attaching' })
    refs.clear.hidden = items.length === 0
    refs.overall.hidden = !(running || (showSummary && run.total))
    refs.bar.max = Math.max(1, run.total); refs.bar.value = run.done
    refs.overallText.textContent = t('overall', { d: run.done, n: run.total })
    // idle hints: how many are ready / waiting for a product, as the list is built
    var parts = []
    if (ready) parts.push(t('readyN', { n: ready }))
    if (needs) parts.push(t('needProduct', { n: needs }))
    refs.hint.textContent = parts.join(' ')
    if (showSummary && run.total) {
      refs.sum.hidden = false
      while (refs.sum.firstChild) refs.sum.removeChild(refs.sum.firstChild)
      refs.sum.appendChild(el('h4', '', t('sumTitle')))
      refs.sum.appendChild(el('p', '', t('sumLine', { u: run.uploaded, a: run.attached, f: run.failed })))
    } else refs.sum.hidden = true
    refs.stale.hidden = !staleList
    refs.logSummary.textContent = t('logTitle', { n: log.filter(function (e) { return !e.again }).length })
    while (refs.logList.firstChild) refs.logList.removeChild(refs.logList.firstChild)
    if (!log.length) refs.logList.appendChild(el('li', 'sph-muted', t('logEmpty')))
    log.slice(-200).forEach(function (e) { var li = el('li'); li.setAttribute('dir', 'ltr'); li.textContent = logLine(e); refs.logList.appendChild(li) })
    refs.root.setAttribute('aria-busy', running ? 'true' : 'false')
  }

  async function loadProducts(force) {
    if (loadingProducts || (running && !force)) return
    loadingProducts = true; productsErr = ''
    refreshAll()
    var r = await call('products_all')
    loadingProducts = false
    var rows = rowsOf(r.body)
    if (r.ok && rows) { products = rows; productsErr = ''; rematchAll() }
    else if (!products) productsErr = r.status === 401 ? 'not_signed_in' : errCode(r)
    rebuildList(); refreshAll()
  }

  // -------------------------------------------------------- finding the screen
  function cellText(n) { return String(n.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() }
  /** A header cell that IS the word or starts with it ("Price", "Price (KWD)"), never one that merely contains it: the
   *  Comparison table above the list has "Site price", and the panel must not anchor there. */
  function head(ths, word) {
    for (var i = 0; i < ths.length; i++) if (ths[i] === word || ths[i].indexOf(word + ' ') === 0 || ths[i].indexOf(word + '(') === 0) return true
    return false
  }
  /** The Catalogue's product list: a table headed Product / Web name / Price / On sale. */
  function findTable() {
    var tables = document.querySelectorAll('main table, .admin-content table')
    for (var i = 0; i < tables.length; i++) {
      var tb = tables[i]
      if (panel && panel.contains(tb)) continue
      var ths = Array.prototype.map.call(tb.querySelectorAll('thead th'), cellText)
      if (head(ths, 'product') && head(ths, 'price') && (head(ths, 'web name') || head(ths, 'on sale'))) return tb
    }
    var hs = document.querySelectorAll('main h2, main h3, .admin-content h2, .admin-content h3')
    for (var j = 0; j < hs.length; j++) {
      if (/every product in the database/i.test(hs[j].textContent || '')) {
        var sec = hs[j].closest('section') || hs[j].parentElement
        var t2 = sec && sec.querySelector('table')
        if (t2) return t2
      }
    }
    return null
  }
  function scan() {
    var tb = findTable()
    if (!tb) {
      onScreen = false
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel)
      return
    }
    var host = tb, main = tb.closest('main') || document.body
    while (host.parentElement && host.parentElement !== main && host.parentElement.children.length === 1) host = host.parentElement
    var L = langOf(host)
    if (!panel) { lang = L; buildPanel(); rebuildList(); refreshAll() }
    else if (L !== lang) {
      lang = L
      items.forEach(function (it) { it.pickerNode = null })
      var old = panel
      buildPanel()
      if (old.parentNode) old.parentNode.replaceChild(panel, old)
      rebuildList(); refreshAll()
    }
    var entering = !onScreen
    onScreen = true
    if (!host.parentNode) return
    if (panel.parentNode !== host.parentNode || panel.nextElementSibling !== host) host.parentNode.insertBefore(panel, host)
    if (entering && !running && !loadingProducts) loadProducts()
  }

  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; try { scan() } catch (e) { /* never break the admin */ } })
  }
  function start() {
    loadLog()
    schedule()
    // Our own redraws (progress ticks, rows) are not news: only changes elsewhere matter.
    new MutationObserver(function (muts) {
      if (panel) {
        var outside = false
        for (var i = 0; i < muts.length; i++) if (!panel.contains(muts[i].target)) { outside = true; break }
        if (!outside) return
      }
      schedule()
    }).observe(document.body, { childList: true, subtree: true })
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN PHOTO UPLOADER - end ======================================== */

/* ===== ADMIN ABANDONED ORDERS - begin ====================================
 * 7. Abandoned orders (owner request 2026-11-04: "make abandon order list").
 *
 * An "Abandoned orders" entry in the compiled live admin: the orders a shopper
 * started and did not finish, so the owner can phone or WhatsApp them. All the
 * rules (what counts as abandoned, what counts as recovered) live on the SERVER
 * in dropin/php-store/abandoned.php; this block draws what it answers and never
 * decides anything. Two routes, both with the admin session cookie and the
 * X-Sporta-Admin header, exactly like the admin's own calls:
 *   GET  abandoned_orders   ?reason= &from= &to= &q= &include_recovered= &page=
 *                           -> {settings, filters, summary, orders[], page, has_more}
 *   POST abandoned_followup {order_id, state, note} -> {followup}
 * Nothing is sent to a customer by this page or by the server: the WhatsApp and
 * Call buttons are plain links (wa.me/<phone>?text=..., tel:+<phone>) built here
 * from the phone, and the person presses send in their own WhatsApp.
 *
 * WHEN THE SERVER DOES NOT HAVE THE ROUTE (this file can be deployed before the
 * API release, or the API rolled back): ONE probe goes out when the signed-in
 * shell first appears, GET abandoned_orders for a single day in the year 2000
 * (from=2000-01-01&to=2000-01-01). A route that exists answers 200 with no rows
 * (an indexed date range: no personal data, nothing in the console); the live
 * admin.php, which does not know the route, answers 404 not_found. On a 404 this
 * block adds NOTHING to the page and sends nothing else for the rest of the
 * visit. Any other answer (401, 429, 5xx, no network) keeps the entry, and
 * opening it shows the real state with a Retry button. If the route disappears
 * later (a 404 while the panel is open) the panel says it is not available until
 * the next update.
 *
 * THE ENTRY. The admin is a tabbed single page whose tab list is compiled in,
 * so a new tab cannot be registered. This block adds a nav button next to
 * "Orders" (sidebar) and a tile in the phone's "More" menu, and its own
 * <section class="admin-page"> at the end of <main>. React owns every node of the
 * shell, so nothing of React's is removed, moved, re-classed or re-texted:
 *   - our nodes are only ADDED (a button in the nav, a tile in the menu grid,
 *     a second <strong> in the phone header, the section in <main>), each carrying
 *     a data-sporta-ab* marker and rebuilt if the shell is rebuilt;
 *   - while the panel is open the tab React considers current is hidden by CSS
 *     keyed on <body data-sporta-ab="open"> (display:none on the other sections,
 *     the header title swapped, the sidebar button drawn as inactive), and its
 *     aria-current is taken off and put back by a marker when the panel closes;
 *   - any click on one of React's own nav buttons closes the panel BEFORE React
 *     handles the click (capture phase), so React then does exactly what it would
 *     have done; a click on the tab React already shows works too.
 *   History: opening pushes ?tab=abandoned, so the phone's Back button returns to
 *   the previous screen; a page loaded with ?tab=abandoned opens the panel.
 *
 * THE PANEL. Summary tiles (still lost / recovered / recovery rate, then one tile
 * per reason with count, KD and recovered; a tile applies that reason as the
 * filter), filters (reason, dates, search, show recovered), the list, a Load more
 * button, CSV export of the rows on screen, and a "WhatsApp message text" editor.
 * The list is a real <table> that turns into stacked cards when the panel is
 * narrower than 720px (container query: it is the panel's own width that
 * matters, a tablet with the sidebar open is narrow too). Each row: order, when,
 * amount, customer, phone, area, items, the reason with a plain-words
 * explanation, whether stock and discount were released, recovered or not, and
 * the follow-up: four state buttons (optimistic: shown at once, rolled back with a
 * message if the server refuses), a note of up to 280 characters, Clear.
 *   - CSV: the rows loaded and filtered on screen, UTF-8 with a byte order mark
 *     (Excel reads Arabic), every cell quoted, a cell that starts with = + - @ or a
 *     tab/CR/LF gets a leading ' so a spreadsheet never runs it.
 *   - WhatsApp text: Arabic or English by the customer's language (Arabic when
 *     unknown), neutral wording the owner can edit; {name} and {order} are
 *     replaced. THE ONLY THING THIS BLOCK WRITES TO WEB STORAGE is that wording
 *     (localStorage "sporta_ab_msg": on/off, Arabic, English). Names, phones,
 *     notes and the list itself are never stored.
 *   - Customer text (name, area, items, notes) is untrusted: every node is built
 *     with createElement + textContent, never as markup, and shown dir="auto".
 *   - Orders still inside the waiting time show no contact buttons: the shopper
 *     may be paying right now.
 * The list never changes an order or its stock. The only write is the follow-up.
 *
 * Colours: the admin's own accent (--admin-action, the terracotta the build gives
 * the compiled "indigo" classes) and the dark palette keyed on html.dark /
 * html[data-theme=dark], like the Photos panel. English, left to right.
 */
;(function () {   // leading ; - the block above ends in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaAbandoned) return
  try { Object.defineProperty(window, '__sportaAbandoned', { value: { version: 1 }, enumerable: false, configurable: false }) } catch (e) { return }

  var API = '/api/admin.php'
  var TAB = 'abandoned'
  var PAGE = 'data-sporta-abandoned'        // the section
  var NAVMARK = 'data-sporta-ab-nav'        // our nav button / menu tile
  var CURMARK = 'data-sporta-ab-cur'        // React's current tab, while ours is open
  var OPEN = 'data-sporta-ab'               // on <body>: "open"
  var MSG_KEY = 'sporta_ab_msg'
  var REASONS = ['unpaid', 'expired', 'declined', 'cod_expired']
  var LABEL = { unpaid: 'Unpaid', expired: 'Expired', declined: 'Declined', cod_expired: 'Cash not confirmed', waiting: 'Waiting', cancelled: 'Cancelled by shop' }
  var WHY = {
    unpaid: 'Left the bank page without paying.',
    expired: 'Not paid within the hold time; the stock goes (or went) back on the shelf.',
    declined: 'The bank refused it, or the shopper backed out.',
    cod_expired: 'Cash order nobody confirmed in time.',
    waiting: 'Started recently. The shopper may still be paying.',
    cancelled: 'Cancelled by the shop before its hold ran out.'
  }
  var STATES = [['contacted', 'Contacted'], ['not_interested', 'Not interested'], ['wrong_number', 'Wrong number'], ['recovered_manually', 'Recovered by me']]
  var STATE_LABEL = {}
  STATES.forEach(function (s) { STATE_LABEL[s[0]] = s[1] })
  var METHOD = { knet: 'KNET', tpay: 'T-Pay', cod: 'Cash' }
  var NOT_YET = 'Abandoned orders is not available until the next update of the shop server. Nothing is wrong with your account.'
  var DEFAULT_MSG = {
    on: true,
    ar: 'مرحبًا {name}، معكم سبورتا. لاحظنا أن طلبكم رقم {order} لم يكتمل. إن احتجتم أي مساعدة في إتمامه فنحن بخدمتكم.',
    en: 'Hello {name}, this is Sporta. We noticed your order {order} was not completed. If you need any help finishing it, we are happy to help.'
  }

  // ------------------------------------------------------------------- state
  var S = {
    open: false,
    filters: { reason: 'all', from: '', to: '', q: '', rec: false },
    rows: [],              // row objects (see buildRow)
    ids: {},               // order id -> true, for the rows on screen
    page: 0, hasMore: false,
    summary: null, settings: null,
    loading: false, loadingMore: false, loaded: false,
    error: null            // {text, kind, wait}
  }
  var probeState = 'unknown'     // unknown | present | absent
  var probing = false
  var wantOpen = false, autoOpened = false
  var prevUrl = ''
  var panel = null, refs = null, styleEl = null
  var seq = 0, sumSeq = 0, ctl = null
  var msg = loadMsg()
  var queued = false
  var searchTimer = 0, countTimer = 0

  // ----------------------------------------------------------------- helpers
  function onAdmin() { return location.pathname.indexOf('/backends') === 0 }
  function el(tag, className, text) {
    var n = document.createElement(tag)
    if (className) n.className = className
    if (text != null) n.textContent = text
    return n
  }
  function svgIcon(size) {
    var NS = 'http://www.w3.org/2000/svg'
    var s = document.createElementNS(NS, 'svg')
    s.setAttribute('xmlns', NS); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('viewBox', '0 0 24 24')
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.75')
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round')
    s.setAttribute('class', 'sporta-icon inline-block shrink-0 align-middle'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false')
    ;['M3 4h2l2.4 11h10.2L20 7H6.2', 'M10.5 9.5l4 4m0-4l-4 4'].forEach(function (d) {
      var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p)
    })
    ;[[9, 19.5], [17, 19.5]].forEach(function (c) {
      var k = document.createElementNS(NS, 'circle'); k.setAttribute('cx', c[0]); k.setAttribute('cy', c[1]); k.setAttribute('r', '1.4'); s.appendChild(k)
    })
    return s
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many) }
  function kd(v) { var n = Number(v); return (isFinite(n) ? n : 0).toFixed(3) + ' KD' }
  function whole(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0 }
  function clean(s, max) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200)
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  /** "2026-11-04 06:21:07" -> "04 Nov 2026, 06:21". The server's own clock: no time zone is guessed here. */
  function when(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''))
    if (!m || +m[2] < 1 || +m[2] > 12) return clean(s, 40)
    return m[3] + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] + ', ' + m[4] + ':' + m[5]
  }
  function ago(min) {
    var n = Number(min)
    if (!isFinite(n) || n < 0) return ''
    n = Math.floor(n)
    if (n < 1) return 'just now'
    if (n < 60) return n + ' min ago'
    if (n < 2880) { var h = Math.floor(n / 60), r = n % 60; return h + ' h' + (r ? ' ' + r + ' min' : '') + ' ago' }
    return Math.floor(n / 1440) + ' days ago'
  }
  /** 96555501003 -> +965 5550 1003; anything else as it was stored. */
  function phoneShow(p) {
    var s = clean(p, 40)
    var m = /^965(\d{4})(\d{4})$/.exec(s)
    return m ? '+965 ' + m[1] + ' ' + m[2] : s
  }
  function telUrl(p) {
    var s = String(p || '').replace(/[^0-9+]/g, '')
    if (/^965[0-9]{8}$/.test(s)) s = '+' + s
    return /^\+?[0-9]{6,15}$/.test(s) ? 'tel:' + s : ''
  }
  function methodName(m) { return METHOD[m] || clean(m, 12) }
  function itemLine(it) {
    var name = clean(it && (it.name_en || it.name_ar), 120) || 'Item'
    var extra = [clean(it && it.size, 20), clean(it && it.fit, 20)].filter(Boolean)
    return whole(it && it.qty) + ' \u00d7 ' + name + (extra.length ? ' \u00b7 ' + extra.join(' \u00b7 ') : '')
  }
  function itemsText(d) {
    var lines = (Array.isArray(d.items) ? d.items : []).map(itemLine)
    if (whole(d.items_more)) lines.push('+' + whole(d.items_more) + ' more')
    return lines.join('; ')
  }
  /** A note the way the server keeps it: control characters become spaces, trimmed, 280 characters. */
  function noteClean(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 280) }
  function token(b) { var e = b && b.error; return typeof e === 'string' && /^[a-z_]{1,40}$/.test(e) ? e : '' }

  // --------------------------------------------------------- browser storage
  /** The owner's WhatsApp wording is the ONLY thing kept in web storage by this block. */
  function loadMsg() {
    var out = { on: DEFAULT_MSG.on, ar: DEFAULT_MSG.ar, en: DEFAULT_MSG.en }
    try {
      var j = JSON.parse(localStorage.getItem(MSG_KEY) || 'null')
      if (j && typeof j === 'object') {
        if (typeof j.on === 'boolean') out.on = j.on
        if (typeof j.ar === 'string') out.ar = j.ar.slice(0, 600)
        if (typeof j.en === 'string') out.en = j.en.slice(0, 600)
      }
    } catch (e) { /* blocked or corrupt: the suggested wording stands */ }
    return out
  }
  function saveMsg() {
    try { localStorage.setItem(MSG_KEY, JSON.stringify({ on: msg.on, ar: msg.ar, en: msg.en })) } catch (e) { /* kept for this visit only */ }
  }

  // ------------------------------------------------------------ admin requests
  function request(route, params, body, signal) {
    var qs = ''
    if (params) {
      var parts = []
      Object.keys(params).forEach(function (k) {
        var v = params[k]
        if (v === '' || v == null || v === false) return
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v === true ? '1' : String(v)))
      })
      if (parts.length) qs = '&' + parts.join('&')
    }
    return fetch(API + '?r=' + route + qs, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: signal || undefined,
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, body: j, retryAfter: r.headers.get('Retry-After') } })
    }).catch(function () { return { ok: false, status: 0, body: null, retryAfter: null } })
  }
  function waitOf(r) {
    var n = Number(r.retryAfter || (r.body && r.body.retry_after))
    return isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 3600) : 0
  }
  function failText(r) {
    var code = token(r.body)
    if (r.status === 0) return 'Could not reach the server. Check the connection and try again.'
    if (r.status === 401) return 'Your sign-in has ended. Sign in again, then reopen this list.'
    if (r.status === 404 && r.route === 'list') return NOT_YET
    if (r.status === 404) return 'That order could not be found. Refresh the list.'
    if (r.status === 429) { var w = waitOf(r); return 'Too many requests. ' + (w ? 'Wait ' + plural(w, 'second', 'seconds') + ', then try again.' : 'Wait a moment, then try again.') }
    if (r.status === 503 && code === 'no_table') return 'The follow-up table has not been created on the server yet. Ask your developer to apply the abandoned-orders database update.'
    if (code === 'invalid_filter') return 'That filter was not accepted. Change it and try again.'
    if (code === 'not_abandoned') return 'This order is no longer on the list (it was paid or is under review). Refresh the list.'
    if (code === 'note_too_long') return 'The note is too long (280 characters at most).'
    return 'The server could not do that (' + (code || 'HTTP ' + r.status) + ').'
  }

  // ------------------------------------------------------------------- probe
  function probe() {
    if (probeState !== 'unknown' || probing) return
    probing = true
    request('abandoned_orders', { from: '2000-01-01', to: '2000-01-01' }).then(function (r) {
      probing = false
      var absent = r.status === 404 || r.status === 405 || r.status === 501 || (r.ok && !(r.body && typeof r.body === 'object'))
      probeState = absent ? 'absent' : 'present'
      schedule()
    })
  }

  // ------------------------------------------------------------- list loading
  function listParams(page) {
    var f = S.filters
    return { reason: f.reason === 'all' ? '' : f.reason, from: f.from, to: f.to, q: f.q, include_recovered: f.rec, page: page > 1 ? page : '' }
  }
  function datesBad() { return !!(S.filters.from && S.filters.to && S.filters.from > S.filters.to) }
  function stopCount() { if (countTimer) { clearInterval(countTimer); countTimer = 0 } }
  function setError(r) {
    var wait = r.status === 429 ? waitOf(r) : 0
    S.error = { text: failText(Object.assign({ route: 'list' }, r)), kind: r.status === 404 ? 'absent' : r.status === 429 ? 'rate' : 'other', wait: wait }
    stopCount()
    if (wait) {
      countTimer = setInterval(function () {
        if (!S.error || S.error.kind !== 'rate') { stopCount(); return }
        S.error.wait--
        if (S.error.wait <= 0) { S.error.wait = 0; S.error.text = 'You can try again now.'; stopCount() }
        else S.error.text = 'Too many requests. Wait ' + plural(S.error.wait, 'second', 'seconds') + ', then try again.'
        drawAll()
      }, 1000)
    }
  }
  /** keep: refresh the same filters and leave the rows on screen until the answer comes. */
  function load(keep) {
    if (!S.open) return
    var my = ++seq
    if (ctl) { try { ctl.abort() } catch (e) { /* already done */ } }
    ctl = typeof AbortController === 'function' ? new AbortController() : null
    var timer = ctl ? setTimeout(function () { try { ctl.abort() } catch (e) { /* done */ } }, 30000) : 0
    if (!keep) { S.rows = []; S.ids = {}; S.page = 0; S.hasMore = false }
    S.loading = true; S.loadingMore = false; S.error = null; stopCount()
    drawAll()
    if (datesBad()) { S.loading = false; S.error = { text: 'The "From" date is after the "To" date.', kind: 'other', wait: 0 }; drawAll(); return }
    request('abandoned_orders', listParams(1), null, ctl && ctl.signal).then(function (r) {
      if (timer) clearTimeout(timer)
      if (my !== seq) return
      S.loading = false
      if (r.ok && r.body && Array.isArray(r.body.orders)) {
        S.settings = r.body.settings || S.settings
        S.summary = r.body.summary || null
        S.rows = []; S.ids = {}
        addRows(r.body.orders)
        S.page = 1; S.hasMore = !!r.body.has_more; S.loaded = true; S.error = null
      } else setError(r)
      drawAll()
    })
  }
  function loadMore() {
    if (S.loadingMore || S.loading || !S.hasMore) return
    var my = ++seq, page = S.page + 1
    S.loadingMore = true; S.error = null
    drawAll()
    request('abandoned_orders', listParams(page)).then(function (r) {
      if (my !== seq) return
      S.loadingMore = false
      if (r.ok && r.body && Array.isArray(r.body.orders)) {
        addRows(r.body.orders)
        S.page = page; S.hasMore = !!r.body.has_more; S.error = null
        if (r.body.summary) S.summary = r.body.summary
      } else setError(r)
      drawAll()
    })
  }
  /** After a follow-up that changed what counts as recovered: only the counts are read again. */
  function refreshSummary() {
    var my = ++sumSeq
    request('abandoned_orders', listParams(1)).then(function (r) {
      if (my !== sumSeq || !(r.ok && r.body && r.body.summary)) return
      S.summary = r.body.summary; S.settings = r.body.settings || S.settings
      drawSummary()
    })
  }
  function addRows(list) {
    list.forEach(function (d) {
      if (!d || typeof d !== 'object' || S.ids[d.id]) return
      S.ids[d.id] = true
      S.rows.push(buildRow(d))
    })
  }

  // ----------------------------------------------------------------- WhatsApp
  function messageFor(d) {
    var tpl = d.customer_lang === 'en' ? msg.en : msg.ar
    var name = clean(d.customer_name, 40)
    var text = String(tpl || '').replace(/\{name\}/g, name).replace(/\{order\}/g, clean(d.track_id, 24))
    return text.replace(/[ \t]+([,،.!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim().slice(0, 900)
  }
  function waUrl(d) {
    var p = String(d.whatsapp_phone || '')
    if (!/^[0-9]{8,15}$/.test(p)) return ''
    var url = 'https://wa.me/' + p
    if (msg.on) { var t = messageFor(d); if (t) url += '?text=' + encodeURIComponent(t) }
    return url
  }
  function refreshWa() {
    S.rows.forEach(function (ro) {
      if (!ro.n.wa) return
      var url = waUrl(ro.d)
      if (url) ro.n.wa.href = url
    })
    if (refs) refs.waHint.textContent = msg.on
      ? 'WhatsApp opens with the message text below typed in. Nothing is sent until you press send in WhatsApp.'
      : 'WhatsApp opens an empty chat (the message text is turned off below).'
  }

  // --------------------------------------------------------------------- rows
  function chip(cls, text) { return el('span', 'sab-chip sab-chip--' + cls, text) }
  function cell(row, label, cls) {
    var td = el('td', cls || '')
    td.setAttribute('role', 'cell'); td.setAttribute('data-label', label)
    row.appendChild(td)
    return td
  }
  function btn(cls, text, onClick) {
    var b = el('button', 'sab-btn' + (cls ? ' ' + cls : ''), text)
    b.type = 'button'
    if (onClick) b.addEventListener('click', onClick)
    return b
  }
  function link(cls, text, label, blank) {
    var a = el('a', 'sab-btn' + (cls ? ' ' + cls : ''), text)
    if (blank) { a.target = '_blank'; a.rel = 'noopener noreferrer' }
    if (label) a.setAttribute('aria-label', label)
    return a
  }
  function buildRow(d) {
    var ro = { d: d, busy: false, msg: '', bad: false, n: {} }
    var n = ro.n
    var tr = el('tr', 'sab-row')
    tr.setAttribute('role', 'row'); tr.setAttribute('data-id', String(d.id)); tr.setAttribute('data-reason', String(d.reason || ''))
    ro.tr = tr

    var c1 = cell(tr, 'Order')
    var tid = el('strong', 'sab-track', clean(d.track_id, 24)); tid.setAttribute('dir', 'ltr')
    c1.appendChild(tid)
    c1.appendChild(el('span', 'sab-sub', when(d.created_at)))
    c1.appendChild(el('span', 'sab-sub', ago(d.minutes_ago)))
    c1.appendChild(el('span', 'sab-amt', kd(d.amount)))
    c1.appendChild(el('span', 'sab-sub', methodName(d.payment_method) + ' \u00b7 ' + clean(d.payment_status, 16)))

    var c2 = cell(tr, 'Customer')
    var nm = el('strong', 'sab-name', clean(d.customer_name, 80) || 'No name'); nm.setAttribute('dir', 'auto')
    c2.appendChild(nm)
    var ph = el('span', 'sab-phone', phoneShow(d.customer_phone)); ph.setAttribute('dir', 'ltr')
    c2.appendChild(ph)
    var where = [clean(d.customer_area, 60), clean(d.customer_governorate, 40)].filter(Boolean).join(', ')
    if (where) { var w = el('span', 'sab-sub', where); w.setAttribute('dir', 'auto'); c2.appendChild(w) }
    if (d.customer_lang === 'ar' || d.customer_lang === 'en') c2.appendChild(el('span', 'sab-sub', d.customer_lang === 'ar' ? 'Arabic' : 'English'))
    if (d.reason === 'waiting') {
      c2.appendChild(el('span', 'sab-sub sab-hold', 'Not contacted yet: the shopper may still be paying.'))
    } else {
      var acts = el('div', 'sab-acts')
      var telurl = telUrl(d.customer_phone)
      var waurl = waUrl(d)
      if (waurl) {
        var wa = link('sab-btn--wa', 'WhatsApp', 'WhatsApp ' + (clean(d.customer_name, 40) || 'customer'), true)
        wa.href = waurl
        n.wa = wa; acts.appendChild(wa)
      }
      if (telurl) {
        var call = link('', 'Call', 'Call ' + (clean(d.customer_name, 40) || 'customer'), false)
        call.href = telurl
        n.call = call; acts.appendChild(call)
      }
      if (acts.childNodes.length) c2.appendChild(acts)
    }

    var c3 = cell(tr, 'Items')
    var count = whole(d.item_count)
    c3.appendChild(el('span', 'sab-sub', count ? plural(count, 'piece', 'pieces') : 'No item lines on this order'))
    var ul = el('ul', 'sab-items')
    ;(Array.isArray(d.items) ? d.items : []).forEach(function (it) { var li = el('li', '', itemLine(it)); li.setAttribute('dir', 'auto'); ul.appendChild(li) })
    if (whole(d.items_more)) ul.appendChild(el('li', 'sab-sub', '+' + whole(d.items_more) + ' more'))
    if (ul.childNodes.length) c3.appendChild(ul)

    var c4 = cell(tr, 'Why')
    var rs = String(d.reason || '')
    c4.appendChild(chip(rs, LABEL[rs] || rs))
    c4.appendChild(el('span', 'sab-sub', WHY[rs] || ''))
    var flags = []
    if (d.stock_released) flags.push('Stock released'); else if (rs !== 'cancelled') flags.push('Stock still held')
    if (d.discount_released) flags.push('Discount released')
    c4.appendChild(el('span', 'sab-sub', flags.join(' \u00b7 ')))
    n.rec = el('span', 'sab-rec')
    c4.appendChild(n.rec)

    var c5 = cell(tr, 'Follow-up')
    var grp = el('div', 'sab-states'); grp.setAttribute('role', 'group'); grp.setAttribute('aria-label', 'Follow-up status')
    n.state = {}
    STATES.forEach(function (s) {
      var b = btn('sab-state', s[1], function () { setFollow(ro, s[0]) })
      b.setAttribute('aria-pressed', 'false')
      n.state[s[0]] = b; grp.appendChild(b)
    })
    c5.appendChild(grp)
    n.who = el('span', 'sab-sub')
    c5.appendChild(n.who)
    var nf = el('div', 'sab-notebox')
    var inp = el('input', 'sab-note'); inp.type = 'text'; inp.maxLength = 280; inp.setAttribute('dir', 'auto')
    inp.setAttribute('aria-label', 'Note for ' + (clean(d.track_id, 24) || 'this order')); inp.placeholder = 'Note (pick a status first)'
    inp.autocomplete = 'off'
    n.note = inp
    n.upd = btn('sab-btn--small', 'Update note', function () { if (d.followup) setFollow(ro, d.followup.state) })
    inp.addEventListener('input', function () { syncRow(ro) })
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (!n.upd.disabled) n.upd.click() } })
    nf.appendChild(inp); nf.appendChild(n.upd)
    c5.appendChild(nf)
    n.clear = btn('sab-btn--small sab-btn--quiet', 'Clear follow-up', function () { setFollow(ro, 'none') })
    c5.appendChild(n.clear)
    n.msg = el('p', 'sab-rowmsg'); n.msg.setAttribute('role', 'status'); n.msg.setAttribute('aria-live', 'polite')
    c5.appendChild(n.msg)
    syncRow(ro, true)
    return ro
  }
  /** Bring the row's controls in line with its data. fresh: also load the note into the field. */
  function syncRow(ro, fresh) {
    var d = ro.d, n = ro.n, f = d.followup
    STATES.forEach(function (s) {
      var on = !!f && f.state === s[0]
      n.state[s[0]].setAttribute('aria-pressed', on ? 'true' : 'false')
      n.state[s[0]].disabled = ro.busy
    })
    if (fresh) n.note.value = f && f.note ? f.note : ''
    n.note.disabled = !f || ro.busy
    n.note.placeholder = f ? 'Note (up to 280 characters)' : 'Note (pick a status first)'
    var typed = noteClean(n.note.value)
    n.upd.disabled = !f || ro.busy || typed === (f && f.note ? f.note : '')
    n.clear.hidden = !f
    n.clear.disabled = ro.busy
    n.who.textContent = ro.busy ? 'Saving...' : f && f.by ? 'Marked by ' + clean(f.by, 80) + (f.at ? ', ' + when(f.at) : '') : ''
    n.rec.textContent = ''
    if (d.recovered) n.rec.appendChild(chip('ok', d.recovered_by === 'manual' ? 'Recovered: marked by you' : 'Recovered: a later order succeeded'))
    n.msg.textContent = ro.msg
    n.msg.setAttribute('data-bad', ro.bad ? '1' : '0')
    ro.tr.setAttribute('aria-busy', ro.busy ? 'true' : 'false')
  }
  function setFollow(ro, state) {
    if (ro.busy) return
    var d = ro.d, n = ro.n
    var note = noteClean(n.note.value)
    var prev = { f: d.followup, rec: d.recovered, by: d.recovered_by, note: n.note.value }
    if (state === 'none' && !d.followup) return
    if (d.followup && d.followup.state === state && (d.followup.note || '') === note) return
    // shown at once; the server's answer replaces it, a refusal puts it all back
    d.followup = state === 'none' ? null : { state: state, note: note, by: '', at: '' }
    var wasManual = d.recovered_by === 'manual'
    if (state === 'recovered_manually') { d.recovered = true; d.recovered_by = d.recovered_by || 'manual' }
    else if (wasManual) { d.recovered = false; d.recovered_by = null }
    ro.busy = true; ro.msg = ''; ro.bad = false
    syncRow(ro, state === 'none')
    request('abandoned_followup', null, { order_id: d.id, state: state, note: note }).then(function (r) {
      ro.busy = false
      if (r.ok && r.body && Object.prototype.hasOwnProperty.call(r.body, 'followup')) {
        var f = r.body.followup
        d.followup = f ? { state: String(f.state), note: f.note == null ? '' : String(f.note), by: f.by == null ? '' : String(f.by), at: f.at == null ? '' : String(f.at) } : null
        ro.msg = state === 'none' ? 'Follow-up cleared.' : 'Saved.'
        ro.bad = false
        syncRow(ro, true)
        if (prev.rec !== d.recovered) refreshSummary()
      } else {
        d.followup = prev.f; d.recovered = prev.rec; d.recovered_by = prev.by
        n.note.value = prev.note
        ro.msg = 'Not saved. ' + failText(Object.assign({ route: 'write' }, r)) + ' Nothing was changed.'
        ro.bad = true
        syncRow(ro)
      }
    })
  }

  // ------------------------------------------------------------------ drawing
  function drawAll() {
    if (!refs) return
    drawSummary(); drawStatus(); drawList(); drawFilters()
  }
  function tile(label, big, small, extra) {
    var t = el('div', 'sab-tile')
    t.appendChild(el('span', 'sab-tile-label', label))
    t.appendChild(el('strong', 'sab-tile-big', big))
    if (small) t.appendChild(el('span', 'sab-sub', small))
    if (extra) t.appendChild(el('span', 'sab-sub', extra))
    return t
  }
  function drawSummary() {
    var box = refs.summary
    box.textContent = ''
    var s = S.summary
    if (!s || !s.abandoned) { box.hidden = true; return }
    box.hidden = false
    var a = s.abandoned
    var tot = el('div', 'sab-tiles sab-tiles--totals')
    tot.appendChild(tile('Still lost', plural(whole(a.count), 'order', 'orders'), kd(a.value)))
    tot.appendChild(tile('Recovered', plural(whole(a.recovered_count), 'order', 'orders'), kd(a.recovered_value)))
    tot.appendChild(tile('Recovery rate', a.recovery_rate == null ? '-' : Number(a.recovery_rate).toFixed(1) + '%', a.recovery_rate == null ? 'Nothing abandoned yet' : 'of ' + plural(whole(a.count) + whole(a.recovered_count), 'abandoned order', 'abandoned orders')))
    box.appendChild(tot)
    var rs = el('div', 'sab-tiles sab-tiles--reasons')
    REASONS.forEach(function (r) {
      var x = (s.by_reason && s.by_reason[r]) || {}
      var b = el('button', 'sab-tile sab-tile--btn')
      b.type = 'button'
      b.setAttribute('data-reason', r)
      b.setAttribute('aria-pressed', S.filters.reason === r ? 'true' : 'false')
      b.setAttribute('aria-label', LABEL[r] + ': ' + plural(whole(x.count), 'order', 'orders') + ', ' + kd(x.value) + '. Show only these.')
      b.appendChild(el('span', 'sab-tile-label', LABEL[r]))
      b.appendChild(el('strong', 'sab-tile-big', String(whole(x.count))))
      b.appendChild(el('span', 'sab-sub', kd(x.value)))
      b.appendChild(el('span', 'sab-sub', whole(x.recovered_count) + ' recovered (' + kd(x.recovered_value) + ')'))
      b.addEventListener('click', function () { S.filters.reason = S.filters.reason === r ? 'all' : r; syncFilters(); load() })
      rs.appendChild(b)
    })
    box.appendChild(rs)
    var oth = el('div', 'sab-sub sab-other')
    var w = s.waiting || {}, c = s.cancelled_by_shop || {}
    oth.appendChild(el('span', '', 'Not counted as abandoned:'))
    var b1 = btn('sab-linkbtn', plural(whole(w.count), 'order', 'orders') + ' still waiting (' + kd(w.value) + ')', function () { S.filters.reason = 'waiting'; syncFilters(); load() })
    var b2 = btn('sab-linkbtn', plural(whole(c.count), 'order', 'orders') + ' cancelled by the shop (' + kd(c.value) + ')', function () { S.filters.reason = 'cancelled'; syncFilters(); load() })
    oth.appendChild(b1); oth.appendChild(b2)
    box.appendChild(oth)
    var st = S.settings
    if (st) {
      var rules = 'Rules in force: a card order counts as abandoned ' + plural(whole(st.abandoned_after_minutes), 'minute', 'minutes') + ' after it was started; stock is held ' + plural(whole(st.hold_minutes), 'minute', 'minutes') + '; ' +
        (whole(st.cod_hold_hours) ? 'a cash order expires after ' + plural(whole(st.cod_hold_hours), 'hour', 'hours') + '.' : 'cash orders never expire.')
      box.appendChild(el('p', 'sab-sub', rules + ' The counts follow the dates and the search below.'))
    }
  }
  function drawStatus() {
    var t = ''
    if (S.loading && !S.rows.length) t = 'Loading...'
    else if (S.loading) t = 'Refreshing...'
    else if (S.loaded && !S.error) t = S.rows.length ? 'Showing ' + plural(S.rows.length, 'order', 'orders') + (S.hasMore ? ', more available' : '') + '.' : 'No orders match.'
    if (refs.status.textContent !== t) refs.status.textContent = t
    refs.root.setAttribute('aria-busy', S.loading ? 'true' : 'false')
    refs.refresh.disabled = S.loading
    refs.csv.disabled = !S.rows.length
    refs.csv.textContent = S.rows.length ? 'Export CSV (' + S.rows.length + ')' : 'Export CSV'
  }
  function drawFilters() {
    var f = S.filters
    var changed = f.reason !== 'all' || f.from || f.to || f.q || f.rec
    refs.clearAll.hidden = !changed
  }
  function syncFilters() {
    var f = S.filters
    refs.reason.value = f.reason; refs.from.value = f.from; refs.to.value = f.to; refs.q.value = f.q; refs.rec.checked = f.rec
  }
  function message(kind, text, retry) {
    var b = el('div', 'sab-box sab-box--' + kind)
    b.setAttribute('role', kind === 'error' ? 'alert' : 'status')
    b.appendChild(el('p', '', text))
    if (retry) {
      var r = btn('sab-btn--primary', 'Try again', function () { load(true) })
      if (S.error && S.error.kind === 'rate' && S.error.wait > 0) r.disabled = true
      b.appendChild(r)
    }
    return b
  }
  var tableEl = null, tbody = null
  function drawList() {
    var host = refs.list
    var rows = S.rows
    var showTable = rows.length > 0
    if (!showTable) {
      tableEl = null; tbody = null
      host.textContent = ''
      if (S.loading) host.appendChild(message('info', 'Loading...'))
      else if (S.error) host.appendChild(message(S.error.kind === 'absent' ? 'info' : 'error', S.error.text, S.error.kind !== 'absent'))
      else if (S.loaded) {
        var f = S.filters
        host.appendChild(message('info', f.reason !== 'all' || f.from || f.to || f.q || f.rec
          ? 'No orders match these filters. Widen the dates, clear the search, or show another reason.'
          : 'No abandoned orders. Every order that was started has been paid, is still in progress, or was cancelled by the shop.'))
      }
      refs.more.hidden = true
      return
    }
    if (!tableEl || !tableEl.isConnected || tableEl.parentNode !== host) {
      host.textContent = ''
      tableEl = el('table', 'sab-table'); tableEl.setAttribute('role', 'table'); tableEl.setAttribute('aria-label', 'Abandoned orders')
      var thead = el('thead'), htr = el('tr'); htr.setAttribute('role', 'row')
      ;['Order', 'Customer', 'Items', 'Why', 'Follow-up'].forEach(function (h) {
        var th = el('th', '', h); th.setAttribute('role', 'columnheader'); th.scope = 'col'; htr.appendChild(th)
      })
      thead.appendChild(htr); tableEl.appendChild(thead)
      tbody = el('tbody'); tbody.setAttribute('role', 'rowgroup'); tableEl.appendChild(tbody)
      host.appendChild(tableEl)
    }
    // keep the rows that are still wanted where they are (focus stays), drop the others, add the new ones in order
    var keepSet = new Set()
    rows.forEach(function (ro) { keepSet.add(ro.tr) })
    Array.prototype.slice.call(tbody.children).forEach(function (tr) { if (!keepSet.has(tr)) tbody.removeChild(tr) })
    var cur = tbody.firstChild
    rows.forEach(function (ro) { if (cur === ro.tr) cur = cur.nextSibling; else tbody.insertBefore(ro.tr, cur) })
    var tail = host.querySelector('.sab-box')
    if (tail && tail.parentNode === host) host.removeChild(tail)
    if (S.error) host.appendChild(message(S.error.kind === 'absent' ? 'info' : 'error', S.error.text, S.error.kind !== 'absent'))
    refs.more.hidden = !S.hasMore
    refs.more.disabled = S.loadingMore
    refs.more.textContent = S.loadingMore ? 'Loading...' : 'Load more'
  }

  // --------------------------------------------------------------------- CSV
  var CSV = [
    ['Track ID', function (d) { return d.track_id }],
    ['Placed', function (d) { return d.created_at }],
    ['Minutes ago', function (d) { return d.minutes_ago }],
    ['Reason', function (d) { return LABEL[d.reason] || d.reason }],
    ['Payment method', function (d) { return methodName(d.payment_method) }],
    ['Payment status', function (d) { return d.payment_status }],
    ['Amount (KD)', function (d) { var n = Number(d.amount); return (isFinite(n) ? n : 0).toFixed(3) }],
    ['Pieces', function (d) { return d.item_count }],
    ['Items', itemsText],
    ['Customer', function (d) { return clean(d.customer_name, 80) }],
    ['Phone', function (d) { return d.customer_phone }],
    ['Governorate', function (d) { return d.customer_governorate }],
    ['Area', function (d) { return d.customer_area }],
    ['Language', function (d) { return d.customer_lang }],
    ['Stock released', function (d) { return d.stock_released ? 'yes' : 'no' }],
    ['Discount released', function (d) { return d.discount_released ? 'yes' : 'no' }],
    ['Recovered', function (d) { return d.recovered ? (d.recovered_by === 'manual' ? 'yes (by you)' : 'yes (later order)') : 'no' }],
    ['Follow-up', function (d) { return d.followup ? STATE_LABEL[d.followup.state] || d.followup.state : '' }],
    ['Follow-up note', function (d) { return d.followup ? d.followup.note : '' }],
    ['Follow-up by', function (d) { return d.followup ? d.followup.by : '' }],
    ['Follow-up at', function (d) { return d.followup ? d.followup.at : '' }]
  ]
  /** Every cell quoted; one that starts with = + - @ (or a tab, CR, LF) gets a leading ' so a spreadsheet reads it as text. */
  function csvCell(v) {
    var s = v == null ? '' : String(v)
    if (/^[=+\-@\t\r\n]/.test(s)) s = "'" + s
    return '"' + s.replace(/"/g, '""') + '"'
  }
  function csvText() {
    var lines = [CSV.map(function (c) { return csvCell(c[0]) }).join(',')]
    S.rows.forEach(function (ro) { lines.push(CSV.map(function (c) { return csvCell(c[1](ro.d)) }).join(',')) })
    return lines.join('\r\n') + '\r\n'
  }
  function exportCsv() {
    if (!S.rows.length) return
    var blob = new Blob(['\uFEFF', csvText()], { type: 'text/csv;charset=utf-8' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    var now = new Date()
    var day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
    a.href = url; a.download = 'abandoned-orders-' + day + '.csv'; a.style.display = 'none'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(function () { URL.revokeObjectURL(url) }, 5000)
    refs.status.textContent = 'Exported ' + plural(S.rows.length, 'order', 'orders') + (S.hasMore ? '. More orders are available: press Load more first to include them.' : '.')
  }

  // ------------------------------------------------------------------- panel
  var CSS = [
    '.sab{--sab-bg:#fff;--sab-soft:#f7f8fa;--sab-line:#d9dfe5;--sab-edge:#7d8799;--sab-text:#18212a;--sab-muted:#556274;--sab-action:var(--admin-action,#9a452c);--sab-on-action:#fff;--sab-pick:#f8ece6;--sab-warn:#8a4b00;--sab-warn-bg:#fdf0d9;--sab-err:#be123c;--sab-err-bg:#fde8ee;--sab-ok:#166534;--sab-ok-bg:#e3f5e9;--sab-info:#0b5394;--sab-info-bg:#e5f0fa;--sab-mute:#475569;--sab-mute-bg:#eef1f4;',
    'container-type:inline-size;box-sizing:border-box;margin:0;padding:1rem;border:1px solid var(--sab-line);border-radius:1rem;background:var(--sab-bg);color:var(--sab-text);font:400 .875rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:start}',
    '@media (max-width:420px){.sab{padding:.625rem}.sab-table tr{padding:.375rem .75rem!important}}',
    ':is(html.dark,html[data-theme="dark"]) .sab{color-scheme:dark;--sab-bg:#151b21;--sab-soft:#1a2128;--sab-line:#303942;--sab-edge:#7a8896;--sab-text:#eef2f5;--sab-muted:#a7b3be;--sab-action:var(--brand-bright,#ff7b17);--sab-on-action:#171a1e;--sab-pick:#37251e;--sab-warn:#fbbf24;--sab-warn-bg:#3a2a0a;--sab-err:#fda4af;--sab-err-bg:#3d1520;--sab-ok:#6ee7a3;--sab-ok-bg:#0f2f1f;--sab-info:#8cc8ff;--sab-info-bg:#11273d;--sab-mute:#cbd5e1;--sab-mute-bg:#26303a}',
    '.sab[hidden]{display:none!important}',
    '.sab *,.sab *::before,.sab *::after{box-sizing:border-box}',
    '.sab-wrap{display:grid;gap:1rem;min-width:0}',
    '.sab-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:.75rem}',
    '.sab-title{margin:0;font-size:1.5rem;font-weight:700;line-height:1.25;color:var(--sab-text)}',
    '.sab-title:focus,.sab-title:focus-visible{outline:none}',
    '.sab-lead{margin:.25rem 0 0;color:var(--sab-muted)}',
    '.sab-tools{display:flex;flex-wrap:wrap;gap:.5rem;width:100%}',
    '@container (min-width:560px){.sab-tools{width:auto}}',
    '.sab-sub{display:block;color:var(--sab-muted);font-size:.8125rem;overflow-wrap:anywhere}',
    '.sab p{margin:0}',
    '.sab :is(button,input,select,textarea,a.sab-btn){font:inherit}',
    '.sab .sab-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.75rem;padding:.5rem 1rem;border:1px solid var(--sab-edge);border-radius:.75rem;background:var(--sab-bg);color:var(--sab-text);font-weight:600;text-align:center;text-decoration:none;cursor:pointer;line-height:1.25}',
    '.sab .sab-btn:hover:not(:disabled){background:var(--sab-soft);border-color:var(--sab-text)}',
    '.sab .sab-btn--primary{background:var(--sab-action);border-color:transparent;color:var(--sab-on-action);font-weight:700}',
    '.sab .sab-btn--primary:hover:not(:disabled){background:var(--sab-action);border-color:transparent;filter:brightness(.9)}',
    '.sab .sab-btn--small{padding:.25rem .75rem;font-size:.8125rem}',
    '.sab .sab-btn--quiet{border-color:var(--sab-line);color:var(--sab-muted)}',
    '.sab .sab-btn:disabled{cursor:not-allowed;background:var(--sab-soft);border-color:var(--sab-line);color:var(--sab-muted)}',
    '.sab .sab-btn[hidden]{display:none}',
    '.sab :is(button,input,select,textarea,summary,a):focus-visible{outline:2px solid var(--sab-action);outline-offset:2px}',
    '.sab-other{display:flex;flex-wrap:wrap;align-items:center;gap:0 .5rem}',
    '.sab-linkbtn{display:inline-flex;align-items:center;min-height:2.75rem;padding:0 .125rem;border:0;background:none;color:var(--sab-action);font:inherit;font-weight:700;text-decoration:underline;cursor:pointer;text-align:start}',
    '.sab-tiles{display:grid;gap:.625rem;grid-template-columns:repeat(2,minmax(0,1fr))}',
    '.sab-tiles--totals{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '.sab-tiles--totals .sab-tile:last-child{grid-column:1 / -1}',
    '@container (min-width:560px){.sab-tiles--totals{grid-template-columns:repeat(3,minmax(0,1fr))}.sab-tiles--totals .sab-tile:last-child{grid-column:auto}.sab-tiles--reasons{grid-template-columns:repeat(4,minmax(0,1fr))}}',
    '.sab-summary{display:grid;gap:.625rem}',
    '.sab-tile{display:flex;flex-direction:column;gap:.125rem;min-width:0;padding:.75rem;border:1px solid var(--sab-line);border-radius:.875rem;background:var(--sab-soft);color:var(--sab-text);text-align:start}',
    '.sab-tile-label{font-size:.75rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--sab-muted)}',
    '.sab-tile-big{font-size:1.375rem;font-weight:800;line-height:1.2;font-variant-numeric:tabular-nums;color:var(--sab-text)}',
    '.sab-tile--btn{min-height:2.75rem;cursor:pointer;font:inherit}',
    '.sab-tile--btn:hover{background:var(--sab-soft);border-color:var(--sab-edge)}',
    '.sab-tile--btn[aria-pressed="true"]{border:2px solid var(--sab-action);background:var(--sab-pick);padding:calc(.75rem - 1px)}',
    '.sab-filters{display:grid;gap:.625rem;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));align-items:end;padding:.75rem;border:1px solid var(--sab-line);border-radius:.875rem;background:var(--sab-soft)}',
    '.sab-field{display:grid;gap:.25rem;min-width:0}',
    // a class on the label text keeps the admin sheet's "class-less label span" rule (13px, #334155, !important) off it
    '.sab-field>.sab-lab{font-size:.8125rem;font-weight:700;color:var(--sab-muted)}',
    '.sab-field--wide{grid-column:1 / -1}',
    '@container (min-width:720px){.sab-field--wide{grid-column:span 2}}',
    '.sab :is(select,input[type="date"],input[type="search"],input[type="text"],textarea){width:100%;min-height:2.75rem;padding:.25rem .625rem;border:1px solid var(--sab-edge);border-radius:.75rem;color:var(--sab-text)!important;background-color:var(--sab-bg)!important;box-shadow:none}',
    '.sab textarea{min-height:5rem;padding:.5rem .625rem;resize:vertical;line-height:1.5}',
    '.sab input::placeholder,.sab textarea::placeholder{color:var(--sab-muted)!important;opacity:1!important}',
    '.sab-check{display:flex;align-items:center;gap:.5rem;min-height:2.75rem;font-weight:600;color:var(--sab-text)}',
    '.sab-check input{width:1.25rem;height:1.25rem;min-height:0;accent-color:var(--sab-action)}',
    '.sab-msg{border:1px solid var(--sab-line);border-radius:.875rem;background:var(--sab-bg)}',
    '.sab-msg>summary{display:flex;align-items:center;min-height:2.75rem;padding:0 .875rem;font-weight:700;cursor:pointer;border-radius:.875rem}',
    '.sab-msg-body{display:grid;gap:.75rem;padding:0 .875rem .875rem}',
    '.sab-hint{color:var(--sab-muted)}',
    '.sab-box{display:grid;justify-items:start;gap:.625rem;padding:1rem;border:1px solid var(--sab-line);border-radius:.875rem;background:var(--sab-soft);color:var(--sab-text)}',
    '.sab-box--error{border-color:var(--sab-err);color:var(--sab-err);background:var(--sab-err-bg)}',
    '.sab-box--error p{font-weight:600}',
    '.sab-table{display:block;width:100%;border-collapse:separate;border-spacing:0}',
    '.sab-table thead{display:none}',
    '.sab-table tbody{display:grid;gap:.625rem}',
    '.sab-table tr{display:block;padding:.5rem .875rem;border:1px solid var(--sab-line);border-radius:.875rem;background:var(--sab-bg)}',
    '.sab-table td{display:block;min-width:0;padding:.5rem 0;border-top:1px solid var(--sab-line)}',
    '.sab-table td:first-child{border-top:0}',
    '.sab-table td::before{content:attr(data-label);display:block;margin-bottom:.125rem;font-size:.75rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--sab-muted)}',
    '.sab-track{display:block;font:700 .9375rem/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--sab-text)}',
    '.sab-name{display:block;font-weight:700;overflow-wrap:anywhere;unicode-bidi:plaintext}',
    '.sab-phone{display:block;font-variant-numeric:tabular-nums;unicode-bidi:isolate}',
    '.sab-amt{display:block;font-weight:800;font-variant-numeric:tabular-nums}',
    '.sab-hold{margin-top:.25rem;font-weight:600}',
    '.sab-acts{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem}',
    '.sab-acts .sab-btn{flex:1 1 7rem}',
    '.sab-items{margin:.25rem 0 0;padding:0;list-style:none;display:grid;gap:.25rem}',
    '.sab-items li{overflow-wrap:anywhere;unicode-bidi:plaintext}',
    '.sab-chip{display:inline-block;margin-bottom:.25rem;padding:.125rem .625rem;border:1px solid currentColor;border-radius:999px;font-size:.8125rem;font-weight:700;line-height:1.4}',
    '.sab-chip--unpaid,.sab-chip--cod_expired{color:var(--sab-warn);background:var(--sab-warn-bg)}',
    '.sab-chip--declined{color:var(--sab-err);background:var(--sab-err-bg)}',
    '.sab-chip--expired,.sab-chip--cancelled{color:var(--sab-mute);background:var(--sab-mute-bg)}',
    '.sab-chip--waiting{color:var(--sab-info);background:var(--sab-info-bg)}',
    '.sab-chip--ok{color:var(--sab-ok);background:var(--sab-ok-bg)}',
    '.sab-rec{display:block;margin-top:.375rem}',
    '.sab-states{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.375rem}',
    '.sab .sab-state{min-height:2.75rem;padding:.25rem .5rem;font-size:.8125rem}',
    '.sab .sab-state[aria-pressed="true"]{border:2px solid var(--sab-action);background:var(--sab-pick);color:var(--sab-text);font-weight:700;padding:calc(.25rem - 1px) calc(.5rem - 1px)}',
    '.sab .sab-state[aria-pressed="true"]::before{content:"\\2713";font-weight:800}',
    '.sab-notebox{display:flex;flex-wrap:wrap;gap:.375rem;margin-top:.5rem}',
    '.sab-notebox .sab-note{flex:1 1 9rem;width:auto}',
    '.sab-rowmsg{margin-top:.375rem!important;min-height:1.25rem;font-size:.8125rem;font-weight:600;color:var(--sab-muted);overflow-wrap:anywhere}',
    '.sab-rowmsg[data-bad="1"]{color:var(--sab-err)}',
    '.sab-more{display:flex;justify-content:center}',
    '.sab-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}',
    '.sab-status{min-height:1.25rem;font-weight:600;color:var(--sab-muted)}',
    '@container (min-width:720px){',
    '.sab-table{display:table}',
    '.sab-table thead{display:table-header-group}',
    '.sab-table tbody{display:table-row-group}',
    '.sab-table tr{display:table-row;padding:0;border:0;border-radius:0;background:none}',
    '.sab-table th{padding:.625rem .625rem;border-bottom:2px solid var(--sab-line);font-size:.75rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;text-align:start;color:var(--sab-muted)}',
    '.sab-table td{display:table-cell;padding:.75rem .625rem;border-top:0;border-bottom:1px solid var(--sab-line);vertical-align:top}',
    '.sab-table td::before{display:none}',
    '.sab-table th:nth-child(1){width:15%}.sab-table th:nth-child(2){width:23%}.sab-table th:nth-child(3){width:19%}.sab-table th:nth-child(4){width:17%}.sab-table th:nth-child(5){width:26%}',
    '.sab-acts .sab-btn{flex:0 1 auto}',
    '.sab-states{grid-template-columns:repeat(2,minmax(0,1fr))}',
    '}',
    // React's own nav stays in the page: while ours is open its current tab is drawn as the others, and its section is not shown.
    'body[' + OPEN + '="open"] main.admin-content>section.admin-page:not([' + PAGE + ']){display:none!important}',
    'body[' + OPEN + '="open"] .admin-sidebar .admin-nav-item[' + CURMARK + ']{background-color:var(--sab-nav-bg,transparent)!important;color:var(--sab-nav-ink,inherit)!important;border:var(--sab-nav-border,0 none)!important;box-shadow:var(--sab-nav-shadow,none)!important}',
    '.m-header__title>strong[data-sporta-ab-title]{display:none}',
    'body[' + OPEN + '="open"] .m-header__title>strong[data-sporta-ab-title]{display:block}',
    'body[' + OPEN + '="open"] .m-header__title>strong:not([data-sporta-ab-title]){display:none}',
    '@media (prefers-reduced-motion:no-preference){.sab .sab-btn,.sab-tile--btn{transition:background-color .15s ease,border-color .15s ease}}'
  ].join('\n')
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return
    styleEl = document.createElement('style')
    styleEl.setAttribute('data-sporta-ab-style', '')
    styleEl.textContent = CSS
    document.head.appendChild(styleEl)
  }
  function field(label, control, cls) {
    var l = el('label', 'sab-field' + (cls ? ' ' + cls : ''))
    l.appendChild(el('span', 'sab-lab', label)); l.appendChild(control)
    return l
  }
  function buildPanel() {
    var root = el('section', 'admin-page sab')
    root.setAttribute(PAGE, ''); root.hidden = true
    root.setAttribute('aria-labelledby', 'sab-title')
    var wrap = el('div', 'sab-wrap admin-page-layout')
    root.appendChild(wrap)
    refs = { root: root }

    var head = el('header', 'sab-head')
    var hl = el('div')
    var h1 = el('h1', 'sab-title', 'Abandoned orders'); h1.id = 'sab-title'; h1.tabIndex = -1
    hl.appendChild(h1)
    hl.appendChild(el('p', 'sab-lead', 'Orders that were started and not completed. Phone or WhatsApp the customer, then mark what happened.'))
    head.appendChild(hl)
    var tools = el('div', 'sab-tools')
    refs.refresh = btn('', 'Refresh', function () { load(true) })
    refs.csv = btn('sab-btn--primary', 'Export CSV', exportCsv)
    tools.appendChild(refs.refresh); tools.appendChild(refs.csv)
    head.appendChild(tools)
    wrap.appendChild(head)

    refs.status = el('p', 'sab-status'); refs.status.setAttribute('role', 'status'); refs.status.setAttribute('aria-live', 'polite')
    wrap.appendChild(refs.status)

    refs.summary = el('div', 'sab-summary'); refs.summary.hidden = true
    wrap.appendChild(refs.summary)

    // filters
    var fl = el('div', 'sab-filters'); fl.setAttribute('role', 'group'); fl.setAttribute('aria-label', 'Filters')
    refs.reason = el('select')
    ;[['all', 'All abandoned']].concat(REASONS.map(function (r) { return [r, LABEL[r]] })).concat([['waiting', 'Waiting (not abandoned yet)'], ['cancelled', 'Cancelled by shop']]).forEach(function (o) {
      var op = el('option', '', o[1]); op.value = o[0]; refs.reason.appendChild(op)
    })
    refs.reason.addEventListener('change', function () { S.filters.reason = refs.reason.value; load() })
    fl.appendChild(field('Reason', refs.reason))
    refs.from = el('input'); refs.from.type = 'date'
    refs.from.addEventListener('change', function () { S.filters.from = refs.from.value; load() })
    fl.appendChild(field('From', refs.from))
    refs.to = el('input'); refs.to.type = 'date'
    refs.to.addEventListener('change', function () { S.filters.to = refs.to.value; load() })
    fl.appendChild(field('To', refs.to))
    refs.q = el('input'); refs.q.type = 'search'; refs.q.maxLength = 80; refs.q.placeholder = 'Track ID, name or phone'
    refs.q.setAttribute('inputmode', 'search'); refs.q.setAttribute('enterkeyhint', 'search'); refs.q.autocomplete = 'off'
    refs.q.addEventListener('input', function () {
      if (searchTimer) clearTimeout(searchTimer)
      searchTimer = setTimeout(function () { searchTimer = 0; var v = clean(refs.q.value, 80); if (v !== S.filters.q) { S.filters.q = v; load() } }, 450)
    })
    refs.q.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (searchTimer) { clearTimeout(searchTimer); searchTimer = 0 }
      S.filters.q = clean(refs.q.value, 80); load()
    })
    fl.appendChild(field('Search', refs.q, 'sab-field--wide'))
    var recLabel = el('label', 'sab-check')
    refs.rec = el('input'); refs.rec.type = 'checkbox'
    refs.rec.addEventListener('change', function () { S.filters.rec = refs.rec.checked; load() })
    recLabel.appendChild(refs.rec); recLabel.appendChild(document.createTextNode('Show recovered orders'))
    fl.appendChild(recLabel)
    refs.clearAll = btn('sab-btn--quiet', 'Clear filters', function () {
      S.filters = { reason: 'all', from: '', to: '', q: '', rec: false }
      syncFilters(); load()
    })
    refs.clearAll.hidden = true
    fl.appendChild(refs.clearAll)
    wrap.appendChild(fl)

    // WhatsApp wording
    var det = el('details', 'sab-msg')
    det.appendChild(el('summary', '', 'WhatsApp message text'))
    var body = el('div', 'sab-msg-body')
    body.appendChild(el('p', 'sab-hint', 'The WhatsApp button opens a chat with this text typed in, in the customer\u2019s language (Arabic when it is not known). You read it and press send yourself. Use {name} and {order}. Saved in this browser only.'))
    var onLabel = el('label', 'sab-check')
    refs.msgOn = el('input'); refs.msgOn.type = 'checkbox'; refs.msgOn.checked = msg.on
    refs.msgOn.addEventListener('change', function () { msg.on = refs.msgOn.checked; saveMsg(); refreshWa() })
    onLabel.appendChild(refs.msgOn); onLabel.appendChild(document.createTextNode('Type this message into WhatsApp'))
    body.appendChild(onLabel)
    refs.msgAr = el('textarea'); refs.msgAr.value = msg.ar; refs.msgAr.maxLength = 600; refs.msgAr.setAttribute('dir', 'rtl'); refs.msgAr.lang = 'ar'
    refs.msgAr.addEventListener('input', function () { msg.ar = refs.msgAr.value; saveMsg(); refreshWa() })
    body.appendChild(field('Arabic', refs.msgAr))
    refs.msgEn = el('textarea'); refs.msgEn.value = msg.en; refs.msgEn.maxLength = 600; refs.msgEn.setAttribute('dir', 'ltr'); refs.msgEn.lang = 'en'
    refs.msgEn.addEventListener('input', function () { msg.en = refs.msgEn.value; saveMsg(); refreshWa() })
    body.appendChild(field('English', refs.msgEn))
    body.appendChild(btn('sab-btn--small', 'Reset to the suggested wording', function () {
      msg.on = DEFAULT_MSG.on; msg.ar = DEFAULT_MSG.ar; msg.en = DEFAULT_MSG.en
      refs.msgOn.checked = msg.on; refs.msgAr.value = msg.ar; refs.msgEn.value = msg.en; saveMsg(); refreshWa()
    }))
    det.appendChild(body)
    wrap.appendChild(det)

    refs.waHint = el('p', 'sab-sub')
    wrap.appendChild(refs.waHint)
    refs.list = el('div', 'sab-list')
    wrap.appendChild(refs.list)
    var more = el('div', 'sab-more')
    refs.more = btn('', 'Load more', loadMore); refs.more.hidden = true
    more.appendChild(refs.more)
    wrap.appendChild(more)
    refreshWa()
    syncFilters()
    return root
  }

  // -------------------------------------------------- the entry in the shell
  function reactNavButtons() {
    return document.querySelectorAll('.admin-sidebar .admin-nav-item, .m-tabbar__item, .m-menu-item')
  }
  /** Take React's current-tab mark off (and write it down) while ours is open; idempotent. */
  function neutralise() {
    var list = reactNavButtons()
    for (var i = 0; i < list.length; i++) {
      var b = list[i]
      if (b.hasAttribute(NAVMARK)) continue
      if (b.getAttribute('aria-current')) { b.removeAttribute('aria-current'); b.setAttribute(CURMARK, '1') }
    }
    // React's current button is drawn by its CLASSES (and the admin sheet's rules on them), which stay: so it is painted like a
    // sibling that is not current, with the sibling's own computed colour, background, border and shadow
    var inactive = document.querySelector('.admin-sidebar .admin-nav-item:not([' + CURMARK + ']):not([' + NAVMARK + '])')
    if (inactive) {
      try {
        var c = getComputedStyle(inactive), st = document.body.style
        st.setProperty('--sab-nav-ink', c.color); st.setProperty('--sab-nav-bg', c.backgroundColor)
        st.setProperty('--sab-nav-border', c.borderTopWidth + ' ' + c.borderTopStyle + ' ' + c.borderTopColor); st.setProperty('--sab-nav-shadow', c.boxShadow)
      } catch (e) { /* the fallbacks in the rule below */ }
    }
    var ours = document.querySelectorAll('[' + NAVMARK + ']')
    for (var j = 0; j < ours.length; j++) {
      ours[j].setAttribute('aria-current', 'page')
      if (ours[j].classList.contains('admin-nav-item')) setNavLook(ours[j], true)
    }
  }
  function restore() {
    var list = document.querySelectorAll('[' + CURMARK + ']')
    for (var i = 0; i < list.length; i++) {
      var b = list[i], box = b.parentNode
      b.removeAttribute(CURMARK)
      // only if React has not already moved the mark to another button of the same group (a Back press it handled first)
      var moved = false, sib = box ? box.children : []
      for (var k = 0; k < sib.length; k++) if (sib[k] !== b && !sib[k].hasAttribute(NAVMARK) && sib[k].getAttribute('aria-current')) moved = true
      if (!moved && !b.getAttribute('aria-current')) b.setAttribute('aria-current', 'page')
    }
    var ours = document.querySelectorAll('[' + NAVMARK + ']')
    for (var j = 0; j < ours.length; j++) {
      ours[j].removeAttribute('aria-current')
      if (ours[j].classList.contains('admin-nav-item')) setNavLook(ours[j], false)
    }
    try { ;['--sab-nav-ink', '--sab-nav-bg', '--sab-nav-border', '--sab-nav-shadow'].forEach(function (k) { document.body.style.removeProperty(k) }) } catch (e) { /* none set */ }
  }
  function setNavLook(b, active) {
    var on = ['bg-indigo-50', 'text-indigo-600'], off = ['text-slate-600', 'hover:bg-slate-50']
    ;(active ? off : on).forEach(function (c) { b.classList.remove(c) })
    ;(active ? on : off).forEach(function (c) { b.classList.add(c) })
  }
  function ensureNavButton(nav) {
    if (nav.querySelector('[' + NAVMARK + ']')) return
    var b = el('button', 'admin-nav-item rounded-lg px-3 py-2 text-start text-sm font-semibold text-slate-600 hover:bg-slate-50')
    b.type = 'button'
    b.setAttribute(NAVMARK, '1')
    var span = el('span', 'flex items-center gap-2.5')
    span.appendChild(svgIcon(17)); span.appendChild(document.createTextNode('Abandoned orders'))
    b.appendChild(span)
    b.addEventListener('click', function () { openPanel(false) })
    var anchor = null, kids = nav.children
    for (var i = 0; i < kids.length; i++) if (/^\s*Orders\s*$/.test(kids[i].textContent || '')) { anchor = kids[i]; break }
    if (anchor && anchor.nextSibling) nav.insertBefore(b, anchor.nextSibling); else nav.appendChild(b)
    if (S.open) neutralise()
  }
  function ensureMenuTile() {
    var grid = document.querySelector('.m-menu-grid')
    if (!grid || grid.querySelector('[' + NAVMARK + ']')) return
    var b = el('button', 'm-menu-item')
    b.type = 'button'; b.setAttribute(NAVMARK, '1')
    var ic = el('span', 'm-menu-item__icon'); ic.appendChild(svgIcon(20))
    b.appendChild(ic); b.appendChild(el('span', '', 'Abandoned'))
    b.addEventListener('click', function () {
      var close = document.querySelector('.m-menu-close')
      if (close) close.click()
      openPanel(false)
    })
    var anchor = null, kids = grid.children
    for (var i = 0; i < kids.length; i++) if (/^\s*Orders\s*$/.test(kids[i].textContent || '')) { anchor = kids[i]; break }
    if (anchor && anchor.nextSibling) grid.insertBefore(b, anchor.nextSibling); else grid.appendChild(b)
    if (S.open) neutralise()
  }
  function ensureHeaderTitle() {
    var t = document.querySelector('.m-header__title')
    if (!t || t.querySelector('[data-sporta-ab-title]')) return
    var s = el('strong', '', 'Abandoned orders')
    s.setAttribute('data-sporta-ab-title', '')
    t.insertBefore(s, t.firstChild)
  }
  function ensurePanel(main) {
    if (!panel) { panel = buildPanel() }
    if (panel.parentNode !== main) main.appendChild(panel)
  }

  // ------------------------------------------------------------- open / close
  function tabParam() { try { return new URLSearchParams(location.search).get('tab') } catch (e) { return null } }
  function urlWithTab(tab) {
    var u = new URL(location.href)
    u.searchParams.set('tab', tab)
    return u.pathname + u.search + u.hash
  }
  function openPanel(fromHistory) {
    if (!panel || !onAdmin()) return
    if (S.open) return
    if (!fromHistory) {
      prevUrl = location.href
      try { history.pushState({ sportaTab: TAB }, '', urlWithTab(TAB)) } catch (e) { /* the panel still opens */ }
    }
    S.open = true
    document.body.setAttribute(OPEN, 'open')
    panel.hidden = false
    neutralise()
    try { window.scrollTo(0, 0) } catch (e) { /* no scrolling */ }
    var h = document.getElementById('sab-title')
    if (h) { try { h.focus({ preventScroll: true }) } catch (e) { /* no focus */ } }
    load(S.loaded)
  }
  function closePanel(why) {
    if (!S.open) return
    S.open = false
    seq++; sumSeq++
    if (ctl) { try { ctl.abort() } catch (e) { /* done */ } }
    S.loading = false; S.loadingMore = false
    stopCount()
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = 0 }
    document.body.removeAttribute(OPEN)
    if (panel) panel.hidden = true
    restore()
    if (why === 'nav') {
      // React ignores a click on the tab it already shows, so the address would keep saying ?tab=abandoned
      setTimeout(function () {
        if (tabParam() !== TAB) return
        var back = prevUrl
        if (!back) { var u = new URL(location.href); u.searchParams.delete('tab'); back = u.pathname + u.search + u.hash }
        try { history.replaceState(history.state, '', back) } catch (e) { /* leave it */ }
      }, 0)
    }
  }
  document.addEventListener('click', function (e) {
    if (!S.open) return
    var t = e.target && e.target.closest ? e.target.closest('.admin-nav-item, .m-menu-item, .m-tabbar__item') : null
    if (!t || t.hasAttribute(NAVMARK)) return
    if (t.classList.contains('m-tabbar__item') && t.hasAttribute('aria-haspopup')) return   // "More" opens the menu, it is not a tab
    closePanel('nav')
  }, true)
  window.addEventListener('popstate', function () {
    if (probeState === 'absent') return
    var want = tabParam() === TAB
    if (want && !S.open) { if (panel) openPanel(true); else { wantOpen = true; autoOpened = false } }
    else if (!want && S.open) closePanel('history')
  })

  // -------------------------------------------------------------- finding the shell
  function scan() {
    if (!onAdmin()) return
    var nav = document.querySelector('nav.admin-sidebar__nav') || document.querySelector('.admin-sidebar nav')
    var main = document.querySelector('main.admin-content')
    if (!nav || !main) {
      // sign-in screen, or the shell was torn down (sign-out): nothing of ours stays open, and no customer data stays in memory
      if (S.open) closePanel('gone')
      if (panel) wipe()
      return
    }
    if (probeState === 'unknown') { probe(); return }
    if (probeState === 'absent') return
    ensureStyle()
    ensurePanel(main)
    ensureNavButton(nav)
    ensureMenuTile()
    ensureHeaderTitle()
    if (wantOpen && !autoOpened) { autoOpened = true; openPanel(true) }
    if (S.open) neutralise()
  }
  /** Forget everything that was loaded (sign-out): rows, counts, filters and the panel itself. */
  function wipe() {
    seq++; sumSeq++
    if (ctl) { try { ctl.abort() } catch (e) { /* done */ } }
    stopCount()
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = 0 }
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel)
    panel = null; refs = null; tableEl = null; tbody = null
    S.rows = []; S.ids = {}; S.page = 0; S.hasMore = false; S.summary = null; S.settings = null
    S.loading = false; S.loadingMore = false; S.loaded = false; S.error = null
    S.filters = { reason: 'all', from: '', to: '', q: '', rec: false }
  }
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; try { scan() } catch (e) { /* never break the admin */ } })
  }
  function start() {
    wantOpen = tabParam() === TAB
    schedule()
    new MutationObserver(function (muts) {
      if (panel) {
        var outside = false
        for (var i = 0; i < muts.length; i++) if (!panel.contains(muts[i].target)) { outside = true; break }
        if (!outside) return
      }
      schedule()
    }).observe(document.body, { childList: true, subtree: true })
    new MutationObserver(function () { if (S.open) schedule() }).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN ABANDONED ORDERS - end ======================================= */
