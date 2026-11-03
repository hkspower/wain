/* FOUR add-ons for the compiled live admin live in this file, because this is
 * the only admin script the live index.html loads (a new file name would not
 * be loaded without editing that page, whose source is not in the repo):
 *   1. the Brands screen: a "Remove" button, a product count and a "View on
 *      site" link on each brand, and a "Tag products with a brand" panel
 *      (below);
 *   2. Merchant ID / Terminal ID card in Payments > KNET editor (second block,
 *      after the brands one);
 *   3. Merchant Server IP 1 / 2 card in Payments > T-Pay editor (third block);
 *   4. the sign-in screen's session line, which still says 8 hours (last block).
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
