/* Several add-ons for the compiled live admin live in this file, because this is
 * the only admin script the live index.html loads (a new file name would not
 * be loaded without editing that page, whose source is not in the repo):
 *   1. the Brands screen: a "Remove" button, a product count and a "View on
 *      site" link on each brand, and a "Tag products with a brand" panel
 *      (below);
 *   2. Merchant ID / Terminal ID card in Payments > KNET editor (second block,
 *      after the brands one);
 *   3. Merchant Server IP 1 / 2 card in Payments > KNET editor, after the CBK connection card (third block);
 *   4. CBK connection card in Payments > KNET editor (the one setup), and the T-Pay editor and card hidden;
 *      then (own block, ADMIN PAYMENTS TRIM) the fixed address fields, the Merchant / Terminal IDs and the
 *      Merchant Server IPs folded into read-only summaries;
 *   the sign-in screen's session line, which still says 8 hours;
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
  if (window.__sportaBrandsTab) return   // double execution: a second copy of this file must not start a second set of observers
  try { Object.defineProperty(window, '__sportaBrandsTab', { value: 1, enumerable: false, configurable: false }) } catch (e) { return }
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
  /** The admin's language, read the way the photo uploader reads it: the nearest lang above the screen, else the page's. */
  function uiLang() {
    var host = document.querySelector('main') || document.body
    var h = (host.closest && host.closest('[lang]')) || document.documentElement
    return /^ar/i.test(h.getAttribute('lang') || '') ? 'ar' : 'en'
  }
  /** English or Arabic text, by the admin's language. */
  function tr(en, ar) { return uiLang() === 'ar' ? ar : en }
  /** Digits in the admin's language: Arabic-Indic in Arabic, plain otherwise. */
  function digits(n) {
    var s = String(n)
    return uiLang() === 'ar' ? s.replace(/[0-9]/g, function (d) { return String.fromCharCode(0x0660 + Number(d)) }) : s
  }
  /** "1 product", "3 products". In Arabic the noun carries the count: 1 منتج واحد, 2 منتجان, 3-10 منتجات, 11+ منتجًا (restarting each hundred). */
  function productCount(n) {
    if (uiLang() !== 'ar') return n + (n === 1 ? ' product' : ' products')
    var m = n % 100
    return n === 0 ? 'لا منتجات' : n === 1 ? 'منتج واحد' : n === 2 ? 'منتجان' : digits(n) + (m >= 3 && m <= 10 ? ' منتجات' : ' منتجًا')
  }

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
    en: {
      brand_in_use: 'Products still use this brand. Untag them under “Tag by hand” (choose “No brand”), or hide the brand instead.',
      brand_not_found: 'That brand no longer exists. Refresh the page.',
      not_signed_in: 'Your session ended. Sign in again.'
    },
    ar: {
      brand_in_use: 'ما زالت منتجات تستخدم هذه العلامة. أزِل وسمها من «إضافة يدويًا» (اختر «بلا علامة»)، أو أخفِ العلامة بدلًا من ذلك.',
      brand_not_found: 'لم تعد هذه العلامة موجودة. حدّث الصفحة.',
      not_signed_in: 'انتهت جلستك. سجّل الدخول مرة أخرى.'
    }
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
    if (!window.confirm(tr('Remove "' + name + '" permanently? This cannot be undone.', 'حذف "' + name + '" نهائيًا؟ لا يمكن التراجع عن ذلك.'))) return
    idFor(slug).then(function (id) {
      if (!id) { window.alert(tr('Could not find this brand. Refresh the page and try again.', 'تعذّر العثور على هذه العلامة. حدّث الصفحة وحاول مرة أخرى.')); return }
      return call('brand_delete', { id: id }).then(function (r) {
        var err = r.body && r.body.error
        if (r.ok && r.body && (r.body.deleted || (r.body.data && r.body.data.deleted))) {
          li.setAttribute('data-sporta-removed', '')
          li.style.display = 'none'
          reload()
        } else {
          window.alert(MSG_REMOVE[uiLang()][err] || tr('Could not remove the brand' + (err ? ' (' + err + ')' : '') + '.', 'تعذّر حذف العلامة' + (err ? ' (' + err + ')' : '') + '.'))
        }
      })
    })
  }
  function addRemove(c) {
    var li = c.li, edit = c.edit
    var have = li.querySelector('[data-sporta-remove-btn]')
    // Only written when the language changed: a DOM write here would be a childList change, which starts another scan.
    if (have) { var lbl = tr('Remove', 'حذف'); if (have.textContent !== lbl) have.textContent = lbl; return }
    li.setAttribute(MARK, '1')
    var rm = document.createElement('button')
    rm.type = 'button'
    rm.textContent = tr('Remove', 'حذف')
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
    var key = version + '|' + uiLang() + '|' + slug + '|' + (shown ? 1 : 0)
    var box = li.querySelector('[' + STATS + ']')
    var mono = li.querySelector('p.font-mono')
    if (!box) {
      box = el('div', '', null, 'display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 10px;margin-top:4px;font-size:12px;line-height:18px')
      box.setAttribute('dir', 'ltr')
      box.setAttribute('lang', 'en')
    }
    if (box.getAttribute(STATS) !== key) {
      box.setAttribute(STATS, key)
      box.setAttribute('dir', uiLang() === 'ar' ? 'rtl' : 'ltr')
      box.setAttribute('lang', uiLang())
      while (box.firstChild) box.removeChild(box.firstChild)
      if (b && b.products !== undefined) {
        var n = count(b.products), m = count(b.products_active)
        var CALM = 'color:#64748b', WARN = 'color:#be123c;font-weight:600'
        // A SHOWN brand has a home-page tile, and with nothing listed under it
        // that tile opens an empty page: say so, in rose. A hidden brand has
        // no tile and nobody can reach its page, so it only gets the facts.
        var line = n === 0 ? tr('No products tagged', 'لا منتجات بعلامة تجارية') : productCount(n) + ' · ' + digits(m) + ' ' + tr('shown', 'معروضة')
        var warn = shown && m === 0
        box.appendChild(el('span', '', line + (warn ? tr(' — this brand opens an empty page', ' — هذه العلامة تفتح صفحة فارغة') : ''), warn ? WARN : CALM))
      }
      var a = el('a', '', tr('View on site ↗', 'عرض في الموقع ↗'), 'color:var(--admin-action, #9a452c);font-weight:700;text-decoration:none;white-space:nowrap')
      a.href = '/shop?brand=' + encodeURIComponent(slug)
      a.target = '_blank'
      a.rel = 'noopener'
      box.appendChild(a)
    }
    if (mono && box.previousElementSibling !== mono) mono.parentNode.insertBefore(box, mono.nextSibling)
  }

  // ------------------------------------------------------------ the tagger panel
  var MSG_TAG = {
    en: {
      unknown_brand: 'That brand no longer exists. Refresh the page.',
      bad_request: 'The request was not accepted. Refresh the page and try again.',
      not_signed_in: 'Your session ended. Sign in again.',
      brand_slug_too_long: 'This brand’s web name is too long to tag products with. Shorten it with Edit first.'
    },
    ar: {
      unknown_brand: 'لم تعد هذه العلامة موجودة. حدّث الصفحة.',
      bad_request: 'لم يُقبل الطلب. حدّث الصفحة وحاول مرة أخرى.',
      not_signed_in: 'انتهت جلستك. سجّل الدخول مرة أخرى.',
      brand_slug_too_long: 'اسم هذه العلامة على الموقع طويل جدًا لوسم المنتجات. اختصره من زر «Edit» أولًا.'
    }
  }
  function tagError(r) { var e = r.body && r.body.error; return MSG_TAG[uiLang()][e] || tr('Could not save (' + errCode(r) + ').', 'تعذّر الحفظ (' + errCode(r) + ').') }

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
    // The panel follows the admin's language, as the photo uploader does (it was
    // forced to English). scan() rebuilds it when the language changes.
    var L = uiLang()
    root.setAttribute('data-lang', L)
    root.setAttribute('dir', L === 'ar' ? 'rtl' : 'ltr')
    root.setAttribute('lang', L)
    root.setAttribute('aria-labelledby', 'sporta-brand-tagger-title')
    var title = el('h3', 'text-sm font-bold text-slate-900', tr('Tag products with a brand', 'إضافة علامة تجارية للمنتجات'), 'margin:0;font-size:15px;font-weight:700;color:#0f172a')
    title.id = 'sporta-brand-tagger-title'
    root.appendChild(title)
    ui.summary = el('p', 'mt-0.5 text-xs text-slate-500', tr('Loading products…', 'جارٍ تحميل المنتجات…'), 'margin:2px 0 0;font-size:13px;color:#64748b')
    ui.summary.setAttribute('data-sporta-tag-summary', '')
    root.appendChild(ui.summary)

    var SUB = 'margin:0;font-size:13px;font-weight:700;color:#0f172a'
    var NOTE = 'margin:2px 0 8px;font-size:12px;color:#64748b'
    var LIST = 'display:flex;flex-direction:column;gap:2px;max-height:280px;overflow:auto;padding:4px;border:1px solid #e2e8f0;border-radius:12px;background:#fff'
    var ROW = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:10px'
    var STATUS = 'margin:0;font-size:13px;color:#64748b'

    // Suggestions
    ui.sugBox = el('div', '', null, 'margin-top:16px')
    ui.sugBox.appendChild(el('p', '', tr('Suggestions', 'اقتراحات'), SUB))
    ui.sugBox.appendChild(el('p', '', tr('Untagged products that carry a brand’s name. A name found in almost every product (the house brand) is left out — tag those by hand below. Untick any that are wrong.', 'منتجات بلا علامة تجارية تحمل اسم علامة. الاسم الذي يرد في معظم المنتجات (علامة المتجر) يُستثنى، فأضفه يدويًا أدناه. ألغِ تحديد أي اقتراح خاطئ.'), NOTE))
    ui.sugList = el('div', '', null, LIST)
    ui.sugList.setAttribute('data-sporta-tag-suggestions', '')
    ui.sugBox.appendChild(ui.sugList)
    ui.sugNone = el('p', '', tr('No suggestions. Tag the rest by hand below.', 'لا توجد اقتراحات. أضف الباقي يدويًا أدناه.'), STATUS)
    ui.sugBox.appendChild(ui.sugNone)
    var sugRow = el('div', '', null, ROW)
    ui.apply = el('button', c.button, tr('Apply selected', 'تطبيق المحدد'))
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
    man.appendChild(el('p', '', tr('Tag by hand', 'إضافة يدويًا'), SUB))
    man.appendChild(el('p', '', tr('Pick a brand, tick the products, then Tag selected. Products with no brand are listed first.', 'اختر علامة، ثم حدّد المنتجات، ثم اضغط «إضافة المحدد». تظهر المنتجات بلا علامة أولًا.'), NOTE))
    var grid = el('div', '', null, 'display:flex;flex-wrap:wrap;gap:12px')
    var lb = el('label', '', null, 'display:block;flex:1 1 200px;min-width:0;font-size:12px;font-weight:700;color:#475569')
    lb.appendChild(document.createTextNode(tr('Brand', 'العلامة')))
    ui.select = el('select', c.input)
    ui.select.setAttribute('data-sporta-tag-brand', '')
    lb.appendChild(ui.select)
    grid.appendChild(lb)
    var lf = el('label', '', null, 'display:block;flex:2 1 240px;min-width:0;font-size:12px;font-weight:700;color:#475569')
    lf.appendChild(document.createTextNode(tr('Filter', 'تصفية')))
    ui.filter = el('input', c.input)
    ui.filter.type = 'search'
    ui.filter.placeholder = tr('Name, web name, category or brand', 'الاسم أو اسم الموقع أو الفئة أو العلامة')
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
    ui.all = el('button', c.link, tr('Tick all in this list', 'تحديد كل ما في هذه القائمة'), 'min-height:44px;padding:0 4px;background:none;border:0;cursor:pointer')
    ui.all.type = 'button'
    ui.all.setAttribute('data-sporta-tag-all', '')
    manRow.appendChild(ui.all)
    ui.picked = el('span', '', tr('0 selected', '٠ محدد'), 'font-size:13px;color:#64748b')
    manRow.appendChild(ui.picked)
    ui.tag = el('button', c.button, tr('Tag selected', 'إضافة المحدد'))
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
      var mt = el('span', '', meta, 'flex:none;font-size:12px;' + (metaCss || 'color:#64748b'))
      mt.setAttribute('dir', 'auto')    // "→ Vanquish" keeps its arrow on the left inside the Arabic panel
      l.appendChild(mt)
      return { label: l, name: name }
    }
    function checkbox() {
      var b = el('input', c.checkbox, null, 'width:16px;height:16px;flex:none;accent-color:var(--admin-action, #9a452c);margin:0')
      b.type = 'checkbox'
      return b
    }
    function updatePicked() {
      var n = Object.keys(picked).length
      ui.picked.textContent = tr(n + ' selected', digits(n) + ' محدد')
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
        say(ui.summary, productsErr ? tr('Could not load the product list (' + productsErr + ').', 'تعذّر تحميل قائمة المنتجات (' + productsErr + ').') : tr('Loading products…', 'جارٍ تحميل المنتجات…'), productsErr ? 'error' : '')
        ui.sugBox.style.display = 'none'
        man.style.display = 'none'
        return
      }
      ui.sugBox.style.display = ''
      man.style.display = ''
      var total = products.length, untagged = 0
      products.forEach(function (p) { if (p && !tagged(p)) untagged++ })
      say(ui.summary, untagged === 0
        ? (total === 1 ? tr('The only product has a brand.', 'المنتج الوحيد لديه علامة تجارية.') : tr('All ' + total + ' products have a brand.', 'جميع المنتجات (' + digits(total) + ') لها علامة تجارية.'))
        : tr(untagged + ' of ' + total + ' products ' + (untagged === 1 ? 'has' : 'have') + ' no brand.', productCount(untagged) + ' بلا علامة تجارية من أصل ' + digits(total) + '.'), '')

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
      ui.sugNone.textContent = untagged === 0 ? tr('No suggestions: every product has a brand.', 'لا اقتراحات: لكل المنتجات علامة تجارية.') : tr('No suggestions. Tag the rest by hand below.', 'لا توجد اقتراحات. أضف الباقي يدويًا أدناه.')

      // Brand select, keeping the operator's choice across redraws
      var keep = ui.select.value
      while (ui.select.firstChild) ui.select.removeChild(ui.select.firstChild)
      var o0 = el('option', '', tr('Choose a brand…', 'اختر علامة…'))
      o0.value = ''
      ui.select.appendChild(o0)
      ;(brands || []).forEach(function (b) {
        if (!b || !b.slug) return
        var o = el('option', '', String(b.name_en || b.slug) + (Number(b.active) === 0 ? tr(' (hidden)', ' (مخفية)') : ''))
        o.value = b.slug
        ui.select.appendChild(o)
      })
      var on = el('option', '', tr('No brand (remove the tag)', 'بلا علامة (إزالة الوسم)'))
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
        var meta = (tagged(p) ? brandName(String(p.brand_slug)) : tr('No brand', 'بلا علامة')) + (Number(p.active) === 0 ? tr(' · hidden', ' · مخفية') : '')
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
        ? tr('Removed the brand from ' + productCount(n) + '.', 'أُزيلت العلامة من ' + productCount(n) + '.')
        : tr('Tagged ' + productCount(n) + ' with ' + brandName(brandSlug) + '.', 'أُضيفت العلامة ' + brandName(brandSlug) + ' إلى ' + productCount(n) + '.')
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
      if (!order.length) { say(ui.sugStatus, tr('Tick at least one suggestion.', 'حدّد اقتراحًا واحدًا على الأقل.'), 'error'); return }
      setBusy(true)
      say(ui.sugStatus, tr('Saving…', 'جارٍ الحفظ…'), '')
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
      if (!v) { say(ui.manStatus, tr('Choose a brand first.', 'اختر علامة أولًا.'), 'error'); return }
      var slugs = Object.keys(picked)
      if (!slugs.length) { say(ui.manStatus, tr('Tick at least one product.', 'حدّد منتجًا واحدًا على الأقل.'), 'error'); return }
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
          ? tr('Remove the brand from ' + productCount(change) + '?', 'إزالة العلامة من ' + productCount(change) + '؟')
          : tr(change + ' of these already ' + (change === 1 ? 'has' : 'have') + ' another brand. Replace it with ' + brandName(target) + '?', (change === 1 ? 'منتج واحد لديه علامة أخرى' : digits(change) + ' من هذه المنتجات لديها علامة أخرى') + '. هل تستبدلها بـ' + brandName(target) + '؟')
        if (!window.confirm(q)) { say(ui.manStatus, tr('Nothing was changed.', 'لم يتغير شيء.'), ''); return }
      }
      setBusy(true)
      say(ui.manStatus, tr('Saving…', 'جارٍ الحفظ…'), '')
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
    // Rebuilt when the admin's language changes: its labels are written in the language it was built in.
    if (panel && panel.getAttribute('data-lang') !== uiLang()) { if (panel.parentNode) panel.parentNode.removeChild(panel); panel = null }
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
  if (window.__sportaKnetIds) return   // double execution: a second copy of this file must not start a second set of observers
  try { Object.defineProperty(window, '__sportaKnetIds', { value: 1, enumerable: false, configurable: false }) } catch (e) { return }
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
      .catch(function () { return { ok: false, body: null } })   // a dropped request still answers, so the card can say so and re-enable Save
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
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
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
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; try { scan() } catch (e) { /* a failed pass must not be a console error on every DOM change */ } }) }
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
  if (window.__sportaTpayIps) return   // double execution: a second copy of this file must not start a second set of observers
  try { Object.defineProperty(window, '__sportaTpayIps', { value: 1, enumerable: false, configurable: false }) } catch (e) { return }
  var API = '/api/admin.php'
  var MARK = 'data-sporta-tpay-ips'
  var MSG = {
    invalid_server_ip: 'That is not a valid IP address. Use an IPv4 like 203.0.113.10 or an IPv6 address, or leave the box empty.',
    tpay_credentials_required: 'Save the CBK Client ID, Client Secret and Encrypted Account Key first.',
    config_missing: 'The CBK configuration file is missing on the server.',
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
      .catch(function () { return { ok: false, body: null } })   // a dropped request still answers, so the card can say so and re-enable its controls
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
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
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
    viaText.appendChild(cls('p', NOTE, 'One setup: KNET orders are sent to CBK’s page as KNET only, with the CBK credentials above. The Tranportal ID, password and resource key are not used while this is on. Needs the CBK credentials above to be saved first.'))
    var viaStatus = cls('p', 'mt-0.5 text-xs', '')
    viaStatus.setAttribute('role', 'status')
    viaStatus.setAttribute('aria-live', 'polite')
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

  // One setup (owner, 2026-11-03): the CBK connection is part of the KNET editor now. The T-Pay editor is hidden by the
  // "CBK connection" block at the end of this file, so these cards go in the KNET editor, after that block's card.
  function scan() {
    var forms = document.querySelectorAll('form.payment-gateway-editor')
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i]
      if (!form.querySelector('.payment-knet-toggle-row')) continue        // KNET's editor only
      if (form.querySelector('[' + MARK + ']')) continue
      var cbk = form.querySelector('[data-sporta-cbk]')
      if (!cbk) continue                                                  // the CBK connection card is built first
      cbk.parentNode.insertBefore(build(form), cbk.nextSibling)
    }
  }

  var queued = false
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; try { scan() } catch (e) { /* a failed pass must not be a console error on every DOM change */ } }) }
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
  if (window.__sportaSessionLine) return   // double execution: a second copy of this file must not start a second set of observers
  try { Object.defineProperty(window, '__sportaSessionLine', { value: 1, enumerable: false, configurable: false }) } catch (e) { return }
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
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; try { scan() } catch (e) { /* a failed pass must not be a console error on every DOM change */ } }) }
  // characterData too: a re-render that only resets the text is a change to
  // the text node, not to the child list.
  function start() { scan(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true }) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()

/* ===== ADMIN LOGIN KEYBOARD - begin =====================================
 * 4b. The sign-in screens on a phone (2026-11-12, owner: "make login backends
 * full mobile"). Styling is the LOGINLIGHT section of sporta-admin-knet.css;
 * this block does the two things CSS cannot.
 *
 * 1. The on-screen keyboard must not cover the button that submits the form.
 *    iOS Safari and Chrome on Android (since 108) shrink the VISUAL viewport for
 *    the keyboard and leave the layout viewport, so a form centred in a
 *    100svh page keeps its submit button under the keys and the page has
 *    nothing to scroll. While a field of a .admin-login form has focus and the
 *    visual viewport is shorter than the window, the keyboard's height goes into
 *    --sporta-login-kb on .admin-login (the CSS adds it to the bottom padding),
 *    then the page scrolls just enough that the submit button clears the top of
 *    the keyboard by 12px - never so far that the focused field leaves the top
 *    of the visible area. No smooth scrolling (reduced effects), one pass per
 *    frame, a second pass 320ms later because the keyboard animates in.
 * 2. Attributes the build left out are filled in (when a field of the screen
 *    takes focus), never changed: the code and
 *    password fields get autocapitalize="none", autocorrect="off" and
 *    spellcheck="false" (a revealed password is type=text, and a phone would
 *    capitalise or "correct" it), the code field enterkeyhint="done". React
 *    only writes the attributes it renders, so an attribute it never set stays.
 *
 * The style property is set on the .admin-login element React rendered; it has
 * no style prop, so React never rewrites that attribute. Nothing outside
 * .admin-login is touched, and on a desktop (no visual viewport change) nothing
 * happens at all.
 */
;(function () {
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaLoginKeyboard) return   // a second copy of this file must not add a second set of listeners
  try { Object.defineProperty(window, '__sportaLoginKeyboard', { value: 1, enumerable: false, configurable: false }) } catch (e) { return }
  var GAP = 12, queued = false, late = 0
  function submitOf(form) {
    var bs = form.querySelectorAll('button')
    for (var i = 0; i < bs.length; i++) { var t = (bs[i].getAttribute('type') || 'submit').toLowerCase(); if (t === 'submit') return bs[i] }
    return null
  }
  function fill(root) {
    var ins = root.querySelectorAll('input[type="password"], input[autocomplete="new-password"], input[autocomplete="current-password"], #admin-auth-code')
    for (var i = 0; i < ins.length; i++) {
      var el = ins[i]
      if (!el.hasAttribute('autocapitalize')) el.setAttribute('autocapitalize', 'none')
      if (!el.hasAttribute('autocorrect')) el.setAttribute('autocorrect', 'off')
      if (!el.hasAttribute('spellcheck')) el.setAttribute('spellcheck', 'false')
      if (el.id === 'admin-auth-code' && !el.hasAttribute('enterkeyhint')) el.setAttribute('enterkeyhint', 'done')
    }
  }
  function pass() {
    var vv = window.visualViewport
    var root = document.querySelector('.admin-login')
    if (!root) return
    var el = document.activeElement
    var form = el && el.closest ? el.closest('.admin-login form') : null
    var kb = vv && form ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0
    if (kb < 80) kb = 0   // a toolbar or a zoom, not a keyboard
    var want = kb ? kb + 'px' : ''
    if (root.style.getPropertyValue('--sporta-login-kb') !== want) {
      if (want) root.style.setProperty('--sporta-login-kb', want); else root.style.removeProperty('--sporta-login-kb')
    }
    if (!kb) return
    var btn = submitOf(form)
    if (!btn) return
    var bottom = vv.offsetTop + vv.height, top = vv.offsetTop
    var need = btn.getBoundingClientRect().bottom + GAP - bottom
    if (need <= 1) return
    var room = el.getBoundingClientRect().top - top - GAP   // keep the field itself in view
    var by = Math.min(need, Math.max(0, room))
    if (by > 1) window.scrollBy(0, by)
  }
  function schedule() {
    if (!queued) { queued = true; requestAnimationFrame(function () { queued = false; try { pass() } catch (e) { /* never a console error per event */ } }) }
    clearTimeout(late); late = setTimeout(function () { try { pass() } catch (e) { /* as above */ } }, 320)
  }
  // fill() runs synchronously in the capture phase of focusin, before the phone builds its keyboard for the field.
  // Registered once, at the top of the block (the window flag above stops a second copy): no start() to call twice.
  function onFocusIn(e) { try { var r = e.target && e.target.closest && e.target.closest('.admin-login'); if (r) fill(r) } catch (x) { /* as above */ } schedule() }
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', schedule, true)
  var vv0 = window.visualViewport
  if (vv0 && vv0.addEventListener) { vv0.addEventListener('resize', schedule); vv0.addEventListener('scroll', schedule) }
})()
/* ===== ADMIN LOGIN KEYBOARD - end ======================================= */

/* ===== ADMIN SAVE BAR - begin ===========================================
 * 5. Save bar (owner request 2026-11-03: "add save buttons every page
 * backends").
 *
 * Every /backends screen where something is edited already HAS a Save; the
 * trouble is reach. Order and Support drawers keep it 600-800 px down, the
 * Slides and Discounts modals scroll it away, Topbar and Inventory are one long
 * page, and on a phone the sticky Save row of the Catalogue and Brands editors
 * sits UNDER the fixed bottom tab bar. This block adds no save logic of its own.
 * It watches for the screen's real Save and, whenever the screen has one, shows
 * a slim sticky bar (owner, 2026-11-11: "stick save bar yes") with the same words that calls the real
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
  function inFixed(e) {
    for (var n = e; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return true
    return false
  }
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
    // Always on while the screen has a Save (owner, 2026-11-11: "stick save bar yes"). The bar is the thumb-reach
    // copy of the real button; it is not hidden when the real one is in view, so the owner always sees it.
    // A Save inside a fixed box that is not big enough to count as an overlay (a small modal) would be covered by
    // that box: no bar for it, as before.
    if (!ov && inFixed(real)) { hideBar(); return }
    show(real, info, ov)
  }

  function tick() {
    frame = 0
    api.ticks++
    if (obs) { if (dirtying(obs.takeRecords())) domDirty = true; obs.disconnect() }
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
  // Only a change that can add, remove or hide a Save button needs the candidate search again. disabled and aria-busy
  // (the bar's own churn on the real button) cannot, so they do not count. class, style and hidden still do: a form's
  // fields decide whether a Send-like button is a candidate, and those attributes can show or hide them.
  function dirtying(recs) {
    for (var i = 0; i < recs.length; i++) if (recs[i].type !== 'attributes' || !/^(disabled|aria-disabled|aria-busy)$/.test(recs[i].attributeName)) return true
    return false
  }
  function onMut(recs) { schedule(dirtying(recs || [])) }
  // Scrolling (and resizing, and the end of a transition) fires once a frame, and each pass reads the layout (reach,
  // topOverlay, lift). One pass per 100 ms keeps the bar in step; the pass that runs reads the position as it is then,
  // and any scroll after it starts another, so the last scroll always gets a pass.
  var geomWait = 0
  function onGeom() {
    if (geomWait) return
    geomWait = setTimeout(function () { geomWait = 0; schedule(false) }, 100)
  }
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
    clearTimeout(geomWait); geomWait = 0
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
   *  -> many (back to the singular). The same five cases as arabicCount() in the app's i18n translations module, which
   *  this file cannot import. A token with other than five forms is left as written, so a typo shows rather than hides. */
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
  /** Why the product cannot be saved from here, or ''. product_save refuses odd rows and a CHANGED description over 280. This panel
   *  never changes a description and sends the stored text back unchanged, which the server passes through, so a long stored one is no reason to hold a photo. */
  function holdCode(p) {
    if (!p) return ''
    function chars(s) { return s == null ? 0 : Array.from(String(s)).length }
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
      // During a refresh the lowest id in play for this product and position is already known (dupIndex), so no list scan.
      var dup = false
      if (dupIdx) dup = dupIdx[it.productId + '|' + it.pos] != null && dupIdx[it.productId + '|' + it.pos] < it.id
      else for (var i = 0; i < items.length && !dup; i++) { var o = items[i]; dup = o !== it && o.productId === it.productId && o.pos === it.pos && !o.block && o.phase !== 'done' && o.id < it.id }
      if (dup) warns.push({ level: 'warn', text: t('w_dup') })
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
  /** A 429 that a Stop (or a sign-out) cut short is not a failure: the item goes back to the queue, and runQueue's finally sets its phase. */
  function cutShort(r) { return (stopReq || halted) && r.status === 429 }
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
      if (cutShort(up)) { item.phase = 'queued'; item.progress = 0; return }
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
    if (cutShort(rd)) { item.phase = 'queued'; return }
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
    if (cutShort(sv)) { item.phase = 'queued'; return }
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
  // A file dragged onto any part of /backends outside the photo zone would make the browser open it in place of the page,
  // and the admin's unsaved edits would go with it. Cancelling the default action here does not stop the zone's own drop
  // handler (it still runs and adds the files). Only file drags are touched: text and links dragged into a field keep
  // their normal behaviour.
  ;['dragover', 'drop'].forEach(function (n) {
    document.addEventListener(n, function (e) {
      var types = e.dataTransfer && e.dataTransfer.types ? Array.prototype.slice.call(e.dataTransfer.types) : []
      if (types.indexOf('Files') !== -1) e.preventDefault()
    }, true)
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
    '.sph-row .sph-btn[hidden]{display:none}',
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
    det.addEventListener('toggle', function () { if (det.open) refreshAll() })
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
    if (it.phase === 'failed' || it.phase === 'unattached') {
      // Retry is hidden while a run is going: enqueue() would queue the row after that run's order was fixed, and the
      // run's end would reset it to Idle with no message. refreshAll() shows it again when the run ends.
      var rt = button('sph-btn--small', t('retry'), 'retry', function () { if (!running) enqueue([it]) })
      rt.hidden = running
      side.appendChild(rt)
    }
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
  /** The lowest id still in play for each product and position: one pass per refresh, read by view() for the duplicate warning. */
  var dupIdx = null
  function dupIndex() {
    var idx = {}
    items.forEach(function (o) {
      if (o.productId == null || o.pos == null || o.block || o.phase === 'done') return
      var k = o.productId + '|' + o.pos
      if (idx[k] == null || o.id < idx[k]) idx[k] = o.id
    })
    return idx
  }
  function refreshAll() {
    if (!refs) return
    var ready = 0, needs = 0, held = 0
    dupIdx = dupIndex()
    try { items.forEach(function (it) { var s = view(it).state; if (s === 'ready') ready++; else if (s === 'needs') needs++; else if (s === 'held') held++ }) } finally { dupIdx = null }
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
    items.forEach(function (it) { var rb = it.node && it.node.querySelector('[data-k="retry"]'); if (rb) rb.hidden = running })
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
    // Up to 200 log lines are built only while their disclosure is open; the toggle handler (in buildPanel) refreshes it on open.
    if (refs.logDet.open) {
      while (refs.logList.firstChild) refs.logList.removeChild(refs.logList.firstChild)
      if (!log.length) refs.logList.appendChild(el('li', 'sph-muted', t('logEmpty')))
      log.slice(-200).forEach(function (e) { var li = el('li'); li.setAttribute('dir', 'ltr'); li.textContent = logLine(e); refs.logList.appendChild(li) })
    }
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

/* ===== ADMIN SEO HEALTH - begin ===========================================
 * 11. SEO health (owner request 2026-11-11: "add seo system backends"). The compiled
 * live admin has a basic "SEO Editor" (pick one page or product, type its Arabic and
 * English title and description, a share-image path, Save). It cannot answer the
 * questions an owner actually has: which of my 55 pages are weak, which are the same
 * as each other, which have no photo to share, and what would be a decent text? This
 * block adds ONE button, "SEO health", to the header of that screen. It opens a panel
 * (a section in <main>, the editor is hidden while it is open, "Back" closes it):
 *
 *   1. AUDIT: every page and every product, both languages, as the shopper's search
 *      result will show it. The effective title and description are worked out the way
 *      api/seo-page.php works them out (the owner's text if set, else the default;
 *      a page default gets " — Sporta", a product default is "<name> — Sporta", a product
 *      with no description gets the shop's one generic sentence). Each text is put in a
 *      band (title 30-60 characters, description 70-160 are best practice; the server
 *      refuses 120 / 320), and flagged: missing, too short, too long, over the limit,
 *      the same as another item, the generic fallback sentence, Arabic text that has no
 *      Arabic letters (or a product with no Arabic name, whose title becomes the generic
 *      "product"), no share image, no product photo, hidden product still in the sitemap,
 *      active product missing from it. Severity counts and filters.
 *   2. FIX IN PLACE: "Edit" opens the four texts and the image path under the row, with
 *      live counters. Save sends the one existing route, POST seo_save, with the exact
 *      body the server reads: {scope: "page", path} or {scope: "product", product_id},
 *      title_en, title_ar, description_en, description_ar, image. Nothing else is sent.
 *   3. PREVIEW, live as you type: the Google result in Arabic (right to left) and in
 *      English (title cut where Google cuts it, about 60 characters, description about
 *      160) and the share card.
 *   4. SUGGEST: drafts a title and a description for the products whose text is weak,
 *      from what the admin already holds (names, brand, category, own description) with
 *      fixed templates: no AI, no network, no secret, no price. A price is left out on
 *      purpose: it changes, the page's structured data already carries the live one, and
 *      a figure typed into a description would go stale. Drafts are shown old -> new and
 *      are saved only when the owner presses Apply and confirms; each is its own
 *      seo_save. Nothing is ever saved automatically.
 *   5. SITE CHECKS (read only, public GETs of this site): the sitemap (files, URLs, both
 *      languages, our host, nothing private), robots.txt (/backends closed, the sitemap
 *      named), the canonical host, the home page's canonical and hreflang, and one
 *      product page's title against the audit.
 *
 * Reads: GET seo_settings, GET products_all, GET brands (names for the drafts; optional),
 * then /sitemap.xml (and the files it lists), /robots.txt, / and one /product/<slug>.
 * Writes: POST seo_save only. Every request carries the admin session cookie and the
 * X-Sporta-Admin header, like the admin's own. Built with createElement + textContent,
 * never as markup. Nothing here decides a price, an order or a payment.
 *
 * What the SERVER would have to add (not built, listed in the panel): a sitemap built
 * from the database, a redirects table, search-console verification codes, a per-page
 * "do not index" switch.
 *
 * The entry is one button in the header of the SEO Editor, added by a half-second check
 * and removed when the screen goes (React's nodes are never removed, moved or retexted;
 * while the panel is open the editor's section is hidden by CSS and shown again by Back
 * or by any click on the menu). Starts on /backends only; idempotent.
 */
;(function () {   // leading ; - the block above ends in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaSeoHealth) return

  var API = '/api/admin.php'
  var ORIGIN = 'https://www.sporta.com.kw'
  var PAGE = 'data-sporta-seo'              // the section
  var BTN = 'data-sporta-seo-btn'           // the entry button in the SEO Editor header
  var OPEN = 'data-sporta-seo-state'        // on <body>: "open"
  var NAV = '.admin-sidebar .admin-nav-item, .m-tabbar__item, .m-menu-item, .m-header__menu'
  var LIM = { title: 120, desc: 320 }
  var BAND = { title: { min: 30, max: 60 }, desc: { min: 70, max: 160 } }
  var IMG_RE = /^\/(?!\/)[A-Za-z0-9_.\/-]+\.(?:png|jpe?g|webp|avif)$/i     // seo-config.php store_seo_image_path
  var HAS_AR = /[؀-ۿ]/
  var HAS_LAT = /[A-Za-z]/
  var DEFAULT_IMAGE = '/og-image.png'

  // The defaults the server falls back to (api/seo-page.php sporta_seo_defaults): [title ar, title en, description ar, description en].
  // test:admin-seo compares this table with the PHP file, so a change on either side that is not made on the other fails a suite.
  var PAGES = [
    { path: '/', name: 'Homepage', d: ['سبورتا | ملابس رياضية وملابس جيم في الكويت', 'Sporta | Sportswear & Gym Clothing in Kuwait',
      'ملابس رياضية فاخرة في الكويت. ملابس تمارين وهوديز وإكسسوارات — توصيل خلال ٢٤ ساعة بدينار واحد، وطرق الدفع تظهر عند إتمام الشراء.',
      'Premium sportswear in Kuwait. Activewear, gym clothing, hoodies and accessories — delivery within 24 hours for 1 KWD, with payment options shown at checkout.'] },
    { path: '/shop', name: 'Shop', d: ['المتجر', 'Shop',
      'تسوّق الملابس الرياضية في الكويت — ملابس تمارين، هوديز، ليقنز، كابات وإكسسوارات. الأسعار بالدينار الكويتي، وطرق الدفع تظهر عند إتمام الشراء، والتوصيل خلال ٢٤ ساعة.',
      'Shop sportswear in Kuwait — activewear, hoodies, leggings, caps and accessories. Prices in Kuwaiti Dinar, payment choices at checkout, delivery within 24 hours.'] },
    { path: '/about', name: 'About', d: ['عن سبورتا — ملابس رياضية في الكويت', 'About Sporta — sportswear in Kuwait',
      'سبورتا — متجر ملابس رياضية كويتي: توصيل خلال ٢٤ ساعة بدينار واحد، وطرق الدفع المتاحة تظهر عند إتمام الشراء، وإرجاع واستبدال وفق الشروط.',
      'Sporta is a Kuwaiti sportswear store — delivery within 24 hours for 1 KWD, payment choices shown at checkout, and return and exchange requests.'] },
    { path: '/contact', name: 'Contact', d: ['تواصل مع سبورتا الكويت', 'Contact Sporta Kuwait',
      'تواصل مع سبورتا عبر واتساب ‎+965 2209 1914 أو البريد cs@sporta.com.kw — نرد بالعربي والإنجليزي.',
      'Contact Sporta on WhatsApp +965 2209 1914 or cs@sporta.com.kw — we answer in Arabic and English.'] },
    { path: '/support', name: 'Support', d: ['كيف نساعدك؟', 'How can we help?',
      'افتح تذكرة للدعم بشأن التوصيل أو الطلب أو المنتجات أو الدفع أو أي استفسار آخر. احتفظ برقم التذكرة وبريدك لمتابعة الردود.',
      'Open a support ticket for delivery, an order, products, payment or anything else. Keep your ticket number and email to follow the conversation.'] },
    { path: '/track', name: 'Track orders', d: ['تتبع طلبك', 'Track your order', 'أدخل رقم الطلب من رسالة التأكيد.', 'Enter the order number from your confirmation.'] },
    { path: '/returns', name: 'Returns', d: ['الإرجاع والاستبدال', 'Returns & exchange',
      'ابدأ برقم طلب سبورتا ورقم الهاتف المستخدم عند الشراء. سنعرض المنتجات التي اشتريتها فعلًا ونحفظ طلبك لمراجعة فريقنا.',
      'Start with your Sporta order number and the phone used at checkout. We will show the items you actually purchased and save your request for our team to review.'] },
    { path: '/terms', name: 'Terms', d: ['الشروط والأحكام', 'Terms & conditions',
      'توضّح هذه الشروط آلية الطلب والدفع والتوصيل والإرجاع عند الشراء من سبورتا في الكويت. وبتقديم الطلب فإنك توافق عليها.',
      'How orders, payment, delivery and returns work when you shop with Sporta in Kuwait. Placing an order means you accept these terms.'] },
    { path: '/privacy', name: 'Privacy', d: ['سياسة الخصوصية', 'Privacy policy',
      'توضّح هذه الصفحة البيانات التي تسجّلها سبورتا عند الشراء أو التواصل معنا، وكيف نستخدمها، وخياراتك بشأنها.',
      'This explains what Sporta records when you shop or contact us, how we use it, and the choices available to you.'] }
  ]
  var GENERIC_DESC = {
    ar: 'تسوّق هذا المنتج من سبورتا في الكويت. اطّلع على المقاسات والسعر وخيارات التوصيل.',
    en: 'Shop this product at Sporta Kuwait. View sizes, price and delivery choices.'
  }
  var SUFFIX = { ar: ' — سبورتا', en: ' — Sporta' }

  // What each flag is called, in the filter and on the row. sev: the worst a row gets from it.
  var CODES = {
    title_missing: ['Title missing · العنوان فارغ', 'error'], title_short: ['Title too short · العنوان قصير', 'warn'], title_long: ['Title too long · العنوان طويل', 'warn'], title_over: ['Title over the limit · العنوان تجاوز الحد', 'error'],
    desc_missing: ['Description missing · الوصف فارغ', 'error'], desc_short: ['Description too short · الوصف قصير', 'warn'], desc_long: ['Description too long · الوصف طويل', 'warn'], desc_over: ['Description over the limit · الوصف تجاوز الحد', 'error'],
    dup_title: ['Same title as another · العنوان مكرر', 'warn'], dup_desc: ['Same description as another · الوصف مكرر', 'warn'], default_desc: ['Generic description · وصف عام', 'warn'],
    no_name: ['No name in this language · لا يوجد اسم بهذه اللغة', 'error'], not_arabic: ['Arabic text has no Arabic · النص العربي بلا حروف عربية', 'error'], not_english: ['English text has no English · النص الإنجليزي بلا حروف إنجليزية', 'warn'],
    share_default: ['Default share image · صورة المشاركة الافتراضية', 'warn'], no_photo: ['Product has no photo · المنتج بلا صورة', 'warn'],
    hidden: ['Hidden product · منتج مخفي', 'info'], hidden_in_sitemap: ['Hidden but in the sitemap · مخفي لكنه في خريطة الموقع', 'error'], missing_from_sitemap: ['Not in the sitemap · ليس في خريطة الموقع', 'warn']
  }

  // ----------------------------------------------------------------- helpers
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent }
  function clean(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim() }
  function len(s) { s = String(s == null ? '' : s); try { return Array.from(s).length } catch (e) { return s.length } }
  function cut(s, max) { try { return Array.from(String(s)).slice(0, max).join('') } catch (e) { return String(s).slice(0, max) } }
  function norm(s) { return clean(s).toLowerCase().replace(/\s+/g, ' ') }
  function truthy(v) { return v === true || v === 1 || v === '1' || v === 'true' }
  function shown(e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many) }
  // Arabic counts have five cases: 1, 2 (dual), 3-10 (plural), 11 and up (singular again), restarting each hundred.
  // forms = [one, two, few, many]. The English word comes from plural(); pb() puts both together.
  function arCount(n, forms) { n = Math.floor(Math.abs(Number(n)) || 0); var m = n % 100; return n === 1 ? forms[0] : n === 2 ? forms[1] : (m >= 3 && m <= 10) ? forms[2] : forms[3] }
  var AR_PRODUCT = ['منتج', 'منتجان', 'منتجات', 'منتجًا'], AR_ITEM = ['عنصر', 'عنصران', 'عناصر', 'عنصرًا'], AR_SECOND = ['ثانية', 'ثانيتان', 'ثوانٍ', 'ثانية']
  function pb(n, en, ar) { return n + ' ' + plural(n, en[0], en[1]) + ' · ' + arCount(n, ar) }
  function validImage(p) { p = String(p == null ? '' : p).trim(); return p !== '' && p.length <= 500 && p.indexOf('..') < 0 && IMG_RE.test(p) }
  function firstSentence(s, max) {
    s = clean(s)
    var m = s.match(/^(.+?[.!?؟])(\s|$)/)
    var out = m ? m[1] : s
    return len(out) > max ? '' : out
  }
  function wordCut(s, max) {                 // at a word boundary, with an ellipsis; never mid-word
    if (len(s) <= max) return s
    var c = cut(s, max - 1), i = c.lastIndexOf(' ')
    if (i > max * 0.5) c = c.slice(0, i)
    return c.replace(/[\s,.;:\-—|]+$/, '') + '…'
  }

  // ------------------------------------------------------- effective values
  function ovOf(r) {
    r = r || {}
    function s(k) { return typeof r[k] === 'string' ? r[k] : '' }
    return { title_en: s('title_en'), title_ar: s('title_ar'), description_en: s('description_en'), description_ar: s('description_ar'), image: s('image') }
  }
  function photoOf(it) {
    if (!it.prod) return null                          // unknown: the products list was not available
    var main = clean(it.prod.image), more = String(it.prod.images == null ? '' : it.prod.images).split(',')
    return { main: main, any: !!main || more.some(function (x) { return clean(x) !== '' }) }
  }
  // What a crawler is given for this item in this language, the way api/seo-page.php sporta_seo_meta decides it.
  function effective(it, lang, ov) {
    ov = ov || it.ov
    var ar = lang === 'ar', title, desc, tsrc = 'default', dsrc = 'default', generic = false, noName = false, descKnown = true
    if (it.kind === 'page') {
      var d = pageDefaults(it.path)
      title = d[ar ? 0 : 1]; if (it.path !== '/') title += SUFFIX[lang]
      desc = d[ar ? 2 : 3]
    } else {
      var nm = clean(ar ? it.name_ar : it.name_en)
      noName = nm === ''
      title = (nm !== '' ? nm : (ar ? 'منتج' : 'Product')) + SUFFIX[lang]
      if (!it.prod) { desc = ''; descKnown = false }
      else {
        desc = cut(clean(it.prod[ar ? 'desc_ar' : 'desc_en']), LIM.desc)
        if (desc === '') { desc = GENERIC_DESC[lang]; generic = true } else dsrc = 'product'
      }
    }
    var t = String(ov[ar ? 'title_ar' : 'title_en'] || '').trim(), dd = String(ov[ar ? 'description_ar' : 'description_en'] || '').trim()
    if (t) { title = t; tsrc = 'custom'; noName = false }
    if (dd) { desc = dd; dsrc = 'custom'; generic = false; descKnown = true }
    var img = String(ov.image || '').trim(), isrc = 'default', path = DEFAULT_IMAGE
    if (validImage(img)) { path = img; isrc = 'custom' }
    else if (it.kind === 'product' && it.prod && validImage(it.prod.image)) { path = String(it.prod.image).trim(); isrc = 'product' }
    return { title: title, desc: desc, tsrc: tsrc, dsrc: dsrc, generic: generic, noName: noName, descKnown: descKnown, image: path, isrc: isrc }
  }
  function pageDefaults(path) {
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].path === path) return PAGES[i].d
    return ['سبورتا', 'Sporta', 'متجر سبورتا للملابس الرياضية في الكويت.', 'Sporta sportswear store in Kuwait.']
  }
  function bandOf(kind, n) {
    var b = BAND[kind]
    if (n === 0) return 'missing'
    if (n > LIM[kind]) return 'over'
    if (n < b.min) return 'short'
    if (n > b.max) return 'long'
    return 'good'
  }
  function bandSev(b) { return b === 'good' ? 'ok' : (b === 'missing' || b === 'over') ? 'error' : 'warn' }

  // ------------------------------------------------------------------ audit
  // items: {key, kind, path|id+slug, name, name_en, name_ar, active, ov, prod}. Fills it.eff, it.issues, it.sev. sm: the sitemap read, or null.
  function audit(items, sm) {
    var seen = { ar: { t: {}, d: {} }, en: { t: {}, d: {} } }
    items.forEach(function (it) {
      it.eff = { ar: effective(it, 'ar'), en: effective(it, 'en') }
      if (it.kind === 'product' && !it.active) return
      ;['ar', 'en'].forEach(function (l) {
        var e = it.eff[l], kt = norm(e.title)
        ;(seen[l].t[kt] = seen[l].t[kt] || []).push(it.key)
        if (e.descKnown && !e.generic) { var kd = norm(e.desc); (seen[l].d[kd] = seen[l].d[kd] || []).push(it.key) }
      })
    })
    items.forEach(function (it) {
      var hidden = it.kind === 'product' && !it.active
      it.issues = []
      function flag(code, lang, text) {
        var sev = CODES[code][1]
        if (hidden && code !== 'hidden' && code !== 'hidden_in_sitemap') sev = 'info'    // text nobody can reach is not a fault
        it.issues.push({ code: code, sev: sev, lang: lang || '', text: text })
      }
      ;['ar', 'en'].forEach(function (l) {
        var e = it.eff[l], L = l === 'ar' ? 'Arabic' : 'English', LA = l === 'ar' ? 'العربية' : 'الإنجليزية', nT = len(e.title), nD = len(e.desc)
        var bt = bandOf('title', nT)
        if (e.noName) flag('no_name', l, L + ': this product has no ' + L + ' name, so its title is the generic word for "product". Add the name in the Catalogue. · المنتج بلا اسم ' + LA + '، فعنوانه الكلمة العامة "منتج". أضف الاسم في الكتالوج.')
        else if (bt === 'missing') flag('title_missing', l, L + ' title is empty. · عنوان ' + LA + ' فارغ.')
        else if (bt === 'over') flag('title_over', l, L + ' title is ' + nT + ' characters; the limit is ' + LIM.title + '. · عنوان ' + LA + ' طوله ' + nT + '، والحد ' + LIM.title + '.')
        else if (bt === 'short') flag('title_short', l, L + ' title is ' + nT + ' characters; ' + BAND.title.min + '-' + BAND.title.max + ' reads best in a result. · عنوان ' + LA + ' طوله ' + nT + '، والأفضل بين ' + BAND.title.min + ' و' + BAND.title.max + ' في نتائج البحث.')
        else if (bt === 'long') flag('title_long', l, L + ' title is ' + nT + ' characters; Google cuts it at about ' + BAND.title.max + '. · عنوان ' + LA + ' طوله ' + nT + '، ويقطعه Google عند نحو ' + BAND.title.max + '.')
        if (e.descKnown) {
          var bd = bandOf('desc', nD)
          if (e.generic) flag('default_desc', l, L + ': no description of its own, so the shop’s one generic sentence is used. Write one in the Catalogue or here. · ' + LA + ': لا وصف خاص به، لذلك تُستخدم جملة المتجر العامة الواحدة. اكتب وصفًا في الكتالوج أو هنا.')
          else if (bd === 'missing') flag('desc_missing', l, L + ' description is empty. · وصف ' + LA + ' فارغ.')
          else if (bd === 'over') flag('desc_over', l, L + ' description is ' + nD + ' characters; the limit is ' + LIM.desc + '. · وصف ' + LA + ' طوله ' + nD + '، والحد ' + LIM.desc + '.')
          else if (bd === 'short') flag('desc_short', l, L + ' description is ' + nD + ' characters; ' + BAND.desc.min + '-' + BAND.desc.max + ' is best. · وصف ' + LA + ' طوله ' + nD + '، والأفضل بين ' + BAND.desc.min + ' و' + BAND.desc.max + '.')
          else if (bd === 'long') flag('desc_long', l, L + ' description is ' + nD + ' characters; Google cuts it at about ' + BAND.desc.max + '. · وصف ' + LA + ' طوله ' + nD + '، ويقطعه Google عند نحو ' + BAND.desc.max + '.')
        }
        var pool = seen[l].t[norm(e.title)] || []
        if (!hidden && pool.length > 1) flag('dup_title', l, L + ' title is the same as ' + (pool.length - 1) + ' other' + (pool.length > 2 ? 's' : '') + '. Each page needs its own. · عنوان ' + LA + ' مطابق لعنوان ' + (pool.length - 1) + ' من الصفحات الأخرى. لكل صفحة عنوانها.')
        var dpool = e.descKnown && !e.generic ? (seen[l].d[norm(e.desc)] || []) : []
        if (!hidden && dpool.length > 1) flag('dup_desc', l, L + ' description is the same as ' + (dpool.length - 1) + ' other' + (dpool.length > 2 ? 's' : '') + '. · وصف ' + LA + ' مطابق لوصف ' + (dpool.length - 1) + ' من الصفحات الأخرى.')
        if (l === 'ar' && !e.noName && (!HAS_AR.test(e.title) || (e.descKnown && !HAS_AR.test(e.desc)))) flag('not_arabic', l, 'The Arabic text contains no Arabic letters. · النص العربي لا يحتوي على أي حرف عربي.')
        if (l === 'en' && (!HAS_LAT.test(e.title) || (e.descKnown && !HAS_LAT.test(e.desc)))) flag('not_english', l, 'The English text contains no English letters. · النص الإنجليزي لا يحتوي على أي حرف إنجليزي.')
      })
      if (it.kind === 'product') {
        var ph = photoOf(it)
        if (ph && !ph.any) flag('no_photo', '', 'The product has no photo, so there is nothing to share. · المنتج بلا صورة، فلا يوجد ما يُشارَك.')
        if (it.eff.en.isrc === 'default') flag('share_default', '', ph && ph.any && !ph.main ? 'No main photo is set, so shares use the shop’s default image. · لا صورة رئيسية، لذلك تُستخدم صورة المتجر الافتراضية عند المشاركة.' : 'No share image: the shop’s default image is used. · لا صورة مشاركة، وتُستخدم صورة المتجر الافتراضية.')
        if (hidden) flag('hidden', '', 'Hidden in the Catalogue: not on the shop, its page answers 404, and it is not offered to search engines. · مخفي في الكتالوج: غير ظاهر في المتجر، وصفحته تُرجع 404، ولا يُعرض على محركات البحث.')
        if (sm && sm.ok) {
          var inMap = !!sm.products[it.slug]
          if (hidden && inMap) flag('hidden_in_sitemap', '', 'The sitemap still lists this hidden product. Search engines will fetch a 404. The sitemap is rebuilt at the next release. · خريطة الموقع ما زالت تذكر هذا المنتج المخفي، وستحصل محركات البحث على 404. تُعاد بناء الخريطة مع الإصدار القادم.')
          if (!hidden && !inMap) flag('missing_from_sitemap', '', 'The sitemap does not list this product yet. It is rebuilt at a release. · خريطة الموقع لا تذكر هذا المنتج بعد، وتُعاد بناؤها مع أحد الإصدارات.')
        }
      } else if (it.eff.en.isrc === 'default') {
        it.issues.push({ code: 'share_default', sev: 'info', lang: '', text: 'Shares use the shop’s default image. · تُستخدم صورة المتجر الافتراضية عند المشاركة.' })
      }
      var worst = 'ok'
      it.issues.forEach(function (x) { if (x.sev === 'error') worst = 'error'; else if (x.sev === 'warn' && worst !== 'error') worst = 'warn' })
      it.sev = worst
    })
    return items
  }
  function counts(items) {
    var c = { all: items.length, error: 0, warn: 0, ok: 0, codes: {} }
    items.forEach(function (it) {
      c[it.sev]++
      var done = {}
      it.issues.forEach(function (x) { if (!done[x.code]) { done[x.code] = 1; c.codes[x.code] = (c.codes[x.code] || 0) + 1 } })
    })
    return c
  }

  // ---------------------------------------------------------------- suggest
  var CAT = {      // category slug -> [English phrase, Arabic phrase]; an unknown slug is used as written in English only
    men: ['men’s sportswear', 'ملابس رياضية رجالية'], women: ['women’s sportswear', 'ملابس رياضية نسائية'],
    outerwear: ['jackets and hoodies', 'جاكيتات وهوديز'], accessories: ['sports accessories', 'إكسسوارات رياضية'],
    tops: ['tops and t-shirts', 'قمصان وتيشيرتات'], shoes: ['sports shoes', 'أحذية رياضية'], caps: ['caps', 'كابات'],
    leggings: ['leggings', 'ليقنز'], hoodies: ['hoodies', 'هوديز'], bags: ['bags', 'حقائب']
  }
  function catPhrase(slug, lang) {
    var c = CAT[String(slug || '').toLowerCase()]
    if (c) return c[lang === 'ar' ? 1 : 0]
    return lang === 'ar' ? '' : String(slug || '').replace(/[-_]+/g, ' ').trim()
  }
  function hasWord(hay, needle) { return needle !== '' && norm(hay).indexOf(norm(needle)) >= 0 }
  function draftTitle(name, brand, cat, lang) {
    var ar = lang === 'ar', tail = ar ? ' | سبورتا' : ' | Sporta', max = BAND.title.max
    var by = brand && !hasWord(name, brand) ? (ar ? ' من ' : ' by ') + brand : ''
    var inK = ar ? ' في الكويت' : ' in Kuwait', gen = ar ? ' — ملابس رياضية' : ' — sportswear'
    var c = []
    if (by && cat) c.push(name + by + ' — ' + cat + tail)
    if (by) c.push(name + by + inK + tail)
    if (cat) c.push(name + ' — ' + cat + inK + tail)
    c.push(name + gen + inK + tail, name + inK + tail, name + tail)
    for (var i = 0; i < c.length; i++) if (len(c[i]) <= max) return c[i]
    var short = wordCut(name, max - len(tail)).replace(/…$/, '')
    for (var k = 0; k < 4; k++) {                    // never end on a dangling little word ("... Top in | Sporta")
      var n = short.replace(/[\s,\-—|]+(?:in|of|and|with|for|the|a|an|to|by|at|on|في|من|و|مع|لل)$/i, '')
      if (n === short) break
      short = n
    }
    return short + tail
  }
  // The same price test the footer editor uses (a currency next to a figure). A price in a search description goes stale and
  // the result keeps showing it after the price changes, so a product's own sentence that names one is never suggested.
  var AD0 = String.fromCharCode(0x660), AD9 = String.fromCharCode(0x669)
  var PRICE_CUR = '(?:KWD|K\\.?\\s?D\\.?|' + String.fromCharCode(0x62F) + '\\.?\\s?' + String.fromCharCode(0x643) + '\\.?)'
  var PRICE_DIG = '[0-9' + AD0 + '-' + AD9 + ']'
  var PRICE_LET = 'A-Za-z' + String.fromCharCode(0x600) + '-' + String.fromCharCode(0x6FF)
  var PRICE_RE = new RegExp('(?:' + PRICE_DIG + '[0-9' + AD0 + '-' + AD9 + '.,' + String.fromCharCode(0x66B, 0x66C) + ']*\\s*' + PRICE_CUR + '(?![' + PRICE_LET + ']))|(?:(?:^|[^' + PRICE_LET + '])' + PRICE_CUR + '\\s*' + PRICE_DIG + ')', 'i')
  function draftDesc(name, brand, ownText, cat, lang) {
    var ar = lang === 'ar', max = BAND.desc.max, min = BAND.desc.min
    var by = brand && !hasWord(name, brand) ? (ar ? ' من ' : ' by ') + brand : ''
    if (len(name) > 70) name = wordCut(name, 70)       // a very long name must not use up the whole description
    var lead = ar ? 'تسوّق ' + name + by + ' في سبورتا الكويت.' : 'Shop ' + name + by + ' at Sporta Kuwait.'
    var own = firstSentence(ownText, 110)
    if (len(own) < 15) own = ''                       // "Cap." says nothing a search result can use
    if (PRICE_RE.test(own)) own = ''                  // a price is never put in a search description (see PRICE_RE)
    var pieces = [own, cat ? (ar ? cat + ' مع توصيل خلال ٢٤ ساعة داخل الكويت.' : cat.charAt(0).toUpperCase() + cat.slice(1) + ' with delivery within 24 hours across Kuwait.') : (ar ? 'توصيل خلال ٢٤ ساعة داخل الكويت.' : 'Delivery within 24 hours across Kuwait.'),
      ar ? 'المقاسات وطرق الدفع عند إتمام الشراء.' : 'Sizes and payment options at checkout.']
    var out = lead
    pieces.forEach(function (p) {
      if (!p) return
      if (hasWord(out, p)) return
      if (len(out) + 1 + len(p) <= max) out += ' ' + p
    })
    if (len(out) < min) out += ' ' + pieces[2]          // still short (a very short name): the checkout sentence is always safe
    return len(out) > LIM.desc ? cut(out, LIM.desc) : out
  }
  // product: {name_en, name_ar, desc_en, desc_ar, category, brand_en, brand_ar} -> the four texts a template gives (empty where a language has no name)
  function suggest(p) {
    var out = { title_en: '', title_ar: '', description_en: '', description_ar: '' }
    var ne = clean(p.name_en), na = clean(p.name_ar)
    if (ne) {
      var be = clean(p.brand_en), ce = catPhrase(p.category, 'en')
      out.title_en = draftTitle(ne, be, ce, 'en'); out.description_en = draftDesc(ne, be, p.desc_en, ce, 'en')
    }
    if (na) {
      var ba = clean(p.brand_ar) || clean(p.brand_en), ca = catPhrase(p.category, 'ar')
      out.title_ar = draftTitle(na, ba, ca, 'ar'); out.description_ar = draftDesc(na, ba, p.desc_ar, ca, 'ar')
    }
    return out
  }

  // ---------------------------------------------------------------- requests
  function request(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, body: j, retryAfter: r.headers.get('Retry-After') } })
    }).catch(function () { return { ok: false, status: 0, body: null, retryAfter: null } })
  }
  function getPublic(path) {            // a public page of this site, as text; never throws, and gives up after 15 s
    var ac = typeof AbortController === 'function' ? new AbortController() : null
    var timer = setTimeout(function () { if (ac) ac.abort() }, 15000)   // a stalled read must not hold the checks (S.smLoading) for the whole visit
    return fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: ac ? ac.signal : undefined }).then(function (r) {
      return r.text().then(function (t) { clearTimeout(timer); return { ok: r.ok, status: r.status, text: t } })
    }).catch(function () { clearTimeout(timer); return { ok: false, status: 0, text: '' } })
  }
  var MSG = {
    invalid_seo_title: 'A title is longer than 120 characters or could not be read. · العنوان أطول من 120 حرفًا أو تعذّرت قراءته.',
    invalid_seo_description: 'A description is longer than 320 characters or could not be read. · الوصف أطول من 320 حرفًا أو تعذّرت قراءته.',
    invalid_seo_image: 'The share image must be a path on this site: it starts with one /, has only letters, digits and . _ - /, and ends in .png .jpg .jpeg .webp or .avif. · صورة المشاركة يجب أن تكون مسارًا على هذا الموقع: تبدأ بـ / واحدة، وتحتوي على حروف وأرقام ونقاط وشرطات وشرطات مائلة فقط، وتنتهي بـ .png أو .jpg أو .jpeg أو .webp أو .avif.',
    invalid_seo_path: 'That page is not one the shop lets you edit. Reload the admin. · هذه الصفحة غير قابلة للتعديل من هنا. أعد تحميل لوحة الإدارة.',
    invalid_seo_scope: 'The save was not understood. Reload the admin and try again. · لم يُفهم طلب الحفظ. أعد تحميل لوحة الإدارة وحاول مجددًا.',
    invalid_seo_product: 'That product could not be found. Refresh the list. · تعذّر العثور على هذا المنتج. حدّث القائمة.',
    product_not_found: 'That product no longer exists. Refresh the list. · لم يعد هذا المنتج موجودًا. حدّث القائمة.',
    bad_request: 'The save was refused. Reload the admin and try again. · رُفض الحفظ. أعد تحميل لوحة الإدارة وحاول مجددًا.',
    request_too_large: 'Too much text in one save. · نص كثير في حفظ واحد.'
  }
  function failText(r) {
    var code = r.body && typeof r.body.error === 'string' ? r.body.error : ''
    if (r.status === 0) return 'Could not reach the server. Check the connection and try again. · تعذّر الوصول إلى الخادم. تحقق من الاتصال وحاول مجددًا.'
    if (r.status === 401) return 'Your sign-in has ended. Sign in again, then reopen SEO health. · انتهت جلسة الدخول. سجّل الدخول مجددًا ثم أعد فتح صحة محركات البحث.'
    if (r.status === 429) {
      var w = Number(r.retryAfter || (r.body && r.body.retry_after))
      return 'Too many requests. ' + (isFinite(w) && w > 0 ? 'Wait ' + plural(Math.min(Math.ceil(w), 3600), 'second', 'seconds') + ', then try again.' : 'Wait a moment, then try again.') + ' · طلبات كثيرة. ' + (isFinite(w) && w > 0 ? 'انتظر ' + Math.min(Math.ceil(w), 3600) + ' ' + arCount(Math.min(Math.ceil(w), 3600), AR_SECOND) + ' ثم حاول مجددًا.' : 'انتظر قليلًا ثم حاول مجددًا.')
    }
    if (MSG[code]) return MSG[code]
    return 'The server could not do that (' + (code || 'HTTP ' + r.status) + '). · تعذّر الخادم من تنفيذ ذلك (' + (code || 'HTTP ' + r.status) + ').'
  }
  var NOT_YET = 'SEO health needs the SEO routes of the shop server, which this server does not have yet. Nothing is wrong with your account. · صحة محركات البحث تحتاج مسارات SEO في خادم المتجر، وهذا الخادم لا يملكها بعد. لا خطأ في حسابك.'

  // -------------------------------------------------------------- site reads
  function slugOf(loc) { var m = /\/product\/([A-Za-z0-9][A-Za-z0-9_-]*)\/?(?:[?#].*)?$/.exec(loc); return m ? m[1] : '' }
  function pathOf(loc) { try { var u = new URL(loc); return u.pathname.replace(/\/+$/, '') || '/' } catch (e) { return '' } }
  function locs(xml) { var out = [], re = /<loc>\s*([^<]*?)\s*<\/loc>/g, m; while ((m = re.exec(xml))) out.push(m[1]); return out }
  // /sitemap.xml and, when it is an index, the files it lists (this origin's paths only, at most 6)
  function readSitemap() {
    return getPublic('/sitemap.xml').then(function (r) {
      if (!r.ok || !/<(urlset|sitemapindex)\b/i.test(r.text)) return { ok: false, status: r.status, urls: [], products: {}, files: 0 }
      var files = /<sitemapindex\b/i.test(r.text) ? locs(r.text).map(pathOf).filter(function (p) { return /^\/[A-Za-z0-9_.\/-]+\.xml$/.test(p) }).slice(0, 6) : null
      var parts = files ? Promise.all(files.map(function (p) { return getPublic(p) })) : Promise.resolve([r])
      return parts.then(function (rs) {
        var out = { ok: true, status: 200, files: files ? files.length : 1, urls: [], products: Object.create(null), pages: Object.create(null), alt: 0, bad: [], priv: [] }
        rs.forEach(function (x) {
          if (!x.ok) { out.bad.push(x.status); return }
          out.alt += (x.text.match(/<xhtml:link\b/g) || []).length
          var blocks = x.text.split(/<url>/i).slice(1)
          blocks.forEach(function (b) {
            var l = locs(b)[0]; if (!l) return
            out.urls.push(l)
            var s = slugOf(l); if (s) out.products[s] = true; else out.pages[pathOf(l)] = true
            if (/\/(backends|cart|checkout|account|wishlist|api|knet|pay)(\/|\?|$)/.test(l)) out.priv.push(l)
          })
        })
        return out
      })
    })
  }
  function headOf(html) { try { return new DOMParser().parseFromString(html, 'text/html') } catch (e) { return null } }
  // The checks, each {id, status: pass|warn|fail|skip, title, detail, advice}
  function readChecks(items, sm) {
    var list = []
    function put(id, status, title, detail, advice) { list.push({ id: id, status: status, title: title, detail: detail || '', advice: advice || '' }) }
    var here = location.origin
    if (here === ORIGIN) put('host', 'pass', 'Canonical address · العنوان الأساسي', 'You are on ' + ORIGIN + ', the address every page names as its own. · أنت على ' + ORIGIN + '، وهو العنوان الذي تذكره كل صفحة كعنوانها الأساسي.')
    else put('host', 'warn', 'Canonical address · العنوان الأساسي', 'This admin is open on ' + here + ', not ' + ORIGIN + '. Every page names ' + ORIGIN + ' as canonical; the checks below read this address. · لوحة الإدارة مفتوحة على ' + here + '، لا على ' + ORIGIN + '. كل صفحة تذكر ' + ORIGIN + ' كعنوان أساسي؛ والفحوص أدناه تقرأ هذا العنوان.', 'Open the admin at ' + ORIGIN + '/backends to check the live site. · افتح لوحة الإدارة على ' + ORIGIN + '/backends لفحص الموقع المباشر.')
    return Promise.all([getPublic('/robots.txt'), getPublic('/'), Promise.resolve(sm)]).then(function (rs) {
      var rb = rs[0], home = rs[1]
      // robots.txt
      if (!rb.ok) put('robots', 'skip', 'robots.txt · ملف الروبوتات', 'Could not read /robots.txt (HTTP ' + rb.status + '). · تعذّرت قراءة /robots.txt (رمز HTTP ' + rb.status + ').', 'Open /robots.txt in a new tab and check it loads. · افتح /robots.txt في تبويب جديد وتأكد من تحميله.')
      else {
        var t = rb.text
        // Only the "User-agent: *" group counts: a Disallow in some other crawler's group does not close /backends for the rest.
        var star = t.split(/^\s*User-agent:/mi).filter(function (g) { return /^\s*\*/.test(g) }).join('\n')
        var blocksAll = /^\s*Disallow:\s*\/\s*$/mi.test(star)
        var closes = /^\s*Disallow:\s*\/backends\b/mi.test(star)
        var names = /^\s*Sitemap:\s*(\S+)/mi.exec(t)
        if (blocksAll) put('robots', 'fail', 'robots.txt · ملف الروبوتات', 'It tells every crawler to stay out of the whole site (Disallow: /). · يطلب من كل محرك بحث البقاء خارج الموقع كله (Disallow: /).', 'Remove the "Disallow: /" line for User-agent: *. Until then the shop cannot appear in search. · احذف سطر "Disallow: /" من مجموعة User-agent: *. حتى ذلك الحين لن يظهر المتجر في البحث.')
        else if (!closes) put('robots', 'fail', 'robots.txt · ملف الروبوتات', 'It does not close /backends to crawlers. · لا يمنع /backends عن محركات البحث.', 'Add "Disallow: /backends" under User-agent: *. · أضف "Disallow: /backends" تحت User-agent: *.')
        else if (!names) put('robots', 'warn', 'robots.txt · ملف الروبوتات', '/backends is closed, but no Sitemap: line names the sitemap. · /backends مغلق، لكن لا يوجد سطر Sitemap يذكر خريطة الموقع.', 'Add "Sitemap: ' + ORIGIN + '/sitemap.xml". · أضف "Sitemap: ' + ORIGIN + '/sitemap.xml".')
        else if (names[1] !== ORIGIN + '/sitemap.xml') put('robots', 'warn', 'robots.txt · ملف الروبوتات', 'The Sitemap: line points to ' + names[1] + '. · سطر Sitemap يشير إلى ' + names[1] + '.', 'It should be ' + ORIGIN + '/sitemap.xml. · يجب أن يكون ' + ORIGIN + '/sitemap.xml.')
        else put('robots', 'pass', 'robots.txt · ملف الروبوتات', '/backends is closed to crawlers, the rest is open, and the sitemap is named. · /backends مغلق أمام محركات البحث، والباقي مفتوح، وخريطة الموقع مذكورة.')
      }
      // sitemap
      if (!sm || !sm.ok) put('sitemap', 'fail', 'Sitemap · خريطة الموقع', 'Could not read /sitemap.xml' + (sm && sm.status ? ' (HTTP ' + sm.status + ')' : '') + '. · تعذّرت قراءة /sitemap.xml' + (sm && sm.status ? ' (رمز HTTP ' + sm.status + ')' : '') + '.', 'Search engines find new products through it. Check it loads in a new tab. · تكتشف محركات البحث المنتجات الجديدة من خلاله. تأكد من تحميله في تبويب جديد.')
      else {
        var prodCount = Object.keys(sm.products).length, pageCount = Object.keys(sm.pages).length
        var active = items.filter(function (x) { return x.kind === 'product' && x.active }), missing = active.filter(function (x) { return !sm.products[x.slug] })
        var hidden = items.filter(function (x) { return x.kind === 'product' && !x.active && sm.products[x.slug] })
        var foreign = sm.urls.filter(function (u) { return u.indexOf(ORIGIN + '/') !== 0 })
        var base = plural(sm.urls.length, 'address', 'addresses') + ' in ' + plural(sm.files, 'file', 'files') + ': ' + pageCount + ' page paths, ' + prodCount + ' products. · ' + sm.urls.length + ' ' + arCount(sm.urls.length, ['عنوان', 'عنوانان', 'عناوين', 'عنوانًا']) + ' في ' + sm.files + ' ' + arCount(sm.files, ['ملف', 'ملفان', 'ملفات', 'ملفًا']) + ': ' + pageCount + ' مسارًا لصفحات، و' + prodCount + ' منتجًا.'
        if (sm.priv.length) put('sitemap', 'fail', 'Sitemap · خريطة الموقع', base + ' It lists a private address: ' + sm.priv[0] + '. · تذكر عنوانًا خاصًا: ' + sm.priv[0] + '.', 'Take private pages (cart, checkout, account, admin) out of the sitemap. · أخرج الصفحات الخاصة (السلة والدفع والحساب والإدارة) من خريطة الموقع.')
        else if (foreign.length) put('sitemap', 'fail', 'Sitemap · خريطة الموقع', base + ' ' + plural(foreign.length, 'address does', 'addresses do') + ' not start with ' + ORIGIN + ' (first: ' + foreign[0] + '). · ' + arCount(foreign.length, ['عنوان لا يبدأ', 'عنوانان لا يبدآن', 'عناوين لا تبدأ', 'عنوانًا لا يبدأ']) + ' بـ ' + ORIGIN + ' (أولها: ' + foreign[0] + ').', 'Every address must use ' + ORIGIN + '. Rebuild the sitemap at the next release. · يجب أن يستخدم كل عنوان ' + ORIGIN + '. أعد بناء خريطة الموقع مع الإصدار القادم.')
        else if (sm.bad.length) put('sitemap', 'warn', 'Sitemap · خريطة الموقع', base + ' One of its files could not be read (HTTP ' + sm.bad[0] + '). · تعذّرت قراءة أحد ملفاتها (رمز HTTP ' + sm.bad[0] + ').', 'Open /sitemap.xml and each file it lists. · افتح /sitemap.xml وكل ملف يذكره.')
        else if (hidden.length || missing.length) put('sitemap', 'warn', 'Sitemap · خريطة الموقع', base + ' ' + (hidden.length ? plural(hidden.length, 'hidden product is', 'hidden products are') + ' still listed. ' : '') + (missing.length ? plural(missing.length, 'active product is', 'active products are') + ' not listed yet.' : '') + ' · ' + (hidden.length ? hidden.length + ' ' + arCount(hidden.length, ['منتج مخفي ما زال مذكورًا', 'منتجان مخفيان ما زالا مذكورين', 'منتجات مخفية ما زالت مذكورة', 'منتجًا مخفيًا ما زال مذكورًا']) + '. ' : '') + (missing.length ? missing.length + ' ' + arCount(missing.length, ['منتج نشط غير مذكور بعد', 'منتجان نشطان غير مذكورين بعد', 'منتجات نشطة غير مذكورة بعد', 'منتجًا نشطًا غير مذكور بعد']) + '.' : ''), 'The sitemap is built at release time, so it trails the Catalogue. Ask for a release when you have changed many products. · تُبنى خريطة الموقع وقت الإصدار، لذلك تتأخر عن الكتالوج. اطلب إصدارًا عند تغيير منتجات كثيرة.')
        else put('sitemap', 'pass', 'Sitemap · خريطة الموقع', base + ' It matches the active products. · تطابق المنتجات النشطة.')
        var perUrl = sm.urls.length ? sm.alt / sm.urls.length : 0
        if (sm.urls.length && perUrl < 3) put('hreflang-sitemap', 'warn', 'Sitemap: both languages · خريطة الموقع: اللغتان', 'Only ' + Math.round(sm.alt) + ' language links for ' + sm.urls.length + ' addresses. Each address should carry ar, en and x-default. · ' + Math.round(sm.alt) + ' روابط لغوية فقط لـ ' + sm.urls.length + ' عنوانًا. يجب أن يحمل كل عنوان ar وen وx-default.', 'Rebuild the sitemap at the next release. · أعد بناء خريطة الموقع مع الإصدار القادم.')
        else if (sm.urls.length) put('hreflang-sitemap', 'pass', 'Sitemap: both languages · خريطة الموقع: اللغتان', 'Each address carries ar, en and x-default alternates. · كل عنوان يحمل نسخ ar وen وx-default.')
      }
      // home page head
      if (!home.ok) put('home', 'skip', 'Home page tags · وسوم الصفحة الرئيسية', 'Could not read / (HTTP ' + home.status + '). · تعذّرت قراءة / (رمز HTTP ' + home.status + ').', '')
      else {
        var d = headOf(home.text)
        if (!d) put('home', 'skip', 'Home page tags · وسوم الصفحة الرئيسية', 'The page could not be read. · تعذّرت قراءة الصفحة.', '')
        else {
          var can = d.querySelector('link[rel="canonical"]'), canHref = can ? can.getAttribute('href') : ''
          var alts = {}; d.querySelectorAll('link[rel="alternate"][hreflang]').forEach(function (a) { alts[a.getAttribute('hreflang')] = a.getAttribute('href') })
          var wrong = []
          if (canHref !== ORIGIN + '/') wrong.push('canonical is ' + (canHref || 'missing') + ' (should be ' + ORIGIN + '/) · الرابط الأساسي ' + (canHref || 'مفقود') + ' (يجب أن يكون ' + ORIGIN + '/)')
          if (alts.ar !== ORIGIN + '/') wrong.push('hreflang ar is ' + (alts.ar || 'missing') + ' (should be ' + ORIGIN + '/) · hreflang ar ' + (alts.ar || 'مفقود') + ' (يجب أن يكون ' + ORIGIN + '/)')
          if (alts.en !== ORIGIN + '/?lang=en') wrong.push('hreflang en is ' + (alts.en || 'missing') + ' (should be ' + ORIGIN + '/?lang=en) · hreflang en ' + (alts.en || 'مفقود') + ' (يجب أن يكون ' + ORIGIN + '/?lang=en)')
          if (alts['x-default'] !== ORIGIN + '/') wrong.push('x-default is ' + (alts['x-default'] || 'missing') + ' (should be ' + ORIGIN + '/) · x-default ' + (alts['x-default'] || 'مفقود') + ' (يجب أن يكون ' + ORIGIN + '/)')
          if (wrong.length) put('home', 'fail', 'Home page: canonical and language links · الصفحة الرئيسية: الرابط الأساسي وروابط اللغات', wrong.join('; ') + '.', 'Arabic is the bare address, English is ?lang=en, and x-default is the bare address. Search engines drop a language cluster that disagrees with itself. · العربية على العنوان المجرد، والإنجليزية على ?lang=en، وx-default على العنوان المجرد. تُسقط محركات البحث مجموعة اللغات إذا تعارضت مع نفسها.')
          else put('home', 'pass', 'Home page: canonical and language links · الصفحة الرئيسية: الرابط الأساسي وروابط اللغات', 'Canonical is ' + ORIGIN + '/; ar and x-default are the bare address, en is ?lang=en. · الرابط الأساسي ' + ORIGIN + '/؛ ar وx-default على العنوان المجرد، وen على ?lang=en.')
          var title = d.querySelector('title'), md = d.querySelector('meta[name="description"]')
          if (!title || !clean(title.textContent) || !md || !clean(md.getAttribute('content'))) put('home-tags', 'warn', 'Home page: title and description · الصفحة الرئيسية: العنوان والوصف', 'The page is missing its <title> or its meta description. · الصفحة تفتقد وسم <title> أو وصف meta.', 'Fill in the Homepage text in SEO health, then reload. · املأ نص الصفحة الرئيسية في صحة محركات البحث، ثم أعد التحميل.')
        }
      }
      // one product page against the audit
      var probe = items.filter(function (x) { return x.kind === 'product' && x.active && x.eff })[0]
      if (!probe) return list
      return getPublic('/product/' + encodeURIComponent(probe.slug)).then(function (pg) {
        if (!pg.ok) { put('product-page', 'skip', 'Product page against the audit · صفحة منتج مقارنةً بالفحص', 'Could not read /product/' + probe.slug + ' (HTTP ' + pg.status + '). · تعذّرت قراءة /product/' + probe.slug + ' (رمز HTTP ' + pg.status + ').', ''); return list }
        var pd = headOf(pg.text), tt = pd && pd.querySelector('title')
        if (!tt) { put('product-page', 'skip', 'Product page against the audit · صفحة منتج مقارنةً بالفحص', 'The page has no <title> in what the server sent. · الصفحة بلا وسم <title> فيما أرسله الخادم.', 'Needs a live check in a browser. · تحتاج فحصًا مباشرًا في المتصفح.'); return list }
        var live = clean(tt.textContent), want = probe.eff.ar.title
        if (live === want) put('product-page', 'pass', 'Product page against the audit · صفحة منتج مقارنةً بالفحص', '/product/' + probe.slug + ' carries the title this audit computes, so what you edit here is what a crawler is given. · يحمل العنوان الذي يحسبه هذا الفحص، فما تعدّله هنا هو ما يراه محرك البحث.')
        else put('product-page', 'warn', 'Product page against the audit · صفحة منتج مقارنةً بالفحص', '/product/' + probe.slug + ' has the title "' + live + '", the audit expected "' + want + '". · عنوان الصفحة "' + live + '"، والفحص توقّع "' + want + '".', 'Either the page is cached, or the shop server that writes titles server-side is not live yet. Reload after a minute; if it stays, ask for a check. · إما أن الصفحة مخزّنة مؤقتًا، أو أن خادم المتجر الذي يكتب العناوين من جهة الخادم غير مفعّل بعد. أعد التحميل بعد دقيقة، وإن استمر ذلك اطلب فحصًا.')
        return list
      })
    })
  }

  // ------------------------------------------------------------------- state
  var S = {
    open: false, loading: false, loaded: false, err: '', items: [], brands: {}, hasDesc: true,
    sm: null, smLoading: false, checks: null, checksLoading: false,
    f: { kind: 'all', status: 'all', issue: 'all', q: '' }, limit: 50,
    edit: null, saving: null, stale: false, cardLang: 'ar',
    sugg: null, confirm: false, applying: false, note: '', noteBad: false
  }
  var panel = null, R = {}, styleEl = null

  function setNote(text, bad) { S.note = text || ''; S.noteBad = !!bad; if (R.status) { R.status.textContent = S.note; R.status.setAttribute('data-bad', S.noteBad ? '1' : '0') } }

  function buildItems(seo, prods) {
    var items = []
    var pages = seo && seo.pages && typeof seo.pages === 'object' ? seo.pages : {}
    PAGES.forEach(function (p) { items.push({ key: 'p:' + p.path, kind: 'page', path: p.path, name: p.name, name_en: p.name, name_ar: '', active: true, ov: ovOf(pages[p.path]), prod: null }) })
    var byId = {}, bySlug = Object.create(null)     // slugs are looked up as keys: a plain {} would answer "constructor" with Object.prototype
    ;(prods || []).forEach(function (p) { if (p) { byId[String(p.id)] = p; bySlug[p.slug] = p } })
    ;(Array.isArray(seo && seo.products) ? seo.products : []).forEach(function (sp) {
      var pr = prods ? (byId[String(sp.id)] || bySlug[sp.slug] || null) : null
      items.push({
        key: 'x:' + sp.id, kind: 'product', id: sp.id, slug: String(sp.slug), name_en: String(sp.name_en || ''), name_ar: String(sp.name_ar || ''),
        name: String(sp.name_en || sp.name_ar || sp.slug), active: truthy(sp.active), ov: ovOf(sp),
        prod: pr ? { desc_en: pr.desc_en, desc_ar: pr.desc_ar, category: pr.category, brand_slug: pr.brand_slug, image: pr.image, images: pr.images, price: pr.price } : (prods ? { desc_en: '', desc_ar: '', category: '', brand_slug: '', image: '', images: '' } : null)
      })
    })
    return items
  }

  function load() {
    if (S.loading) return
    S.loading = true; S.err = ''; setNote('Loading… · جارٍ التحميل…'); renderAll()
    Promise.all([request('seo_settings'), request('products_all'), request('brands')]).then(function (rs) {
      S.loading = false
      var a = rs[0]
      if (!a.ok || !a.body || typeof a.body !== 'object' || Array.isArray(a.body)) {
        S.loaded = false; S.err = a.status === 404 || a.status === 405 || a.status === 501 ? NOT_YET : failText(a)
        setNote('', false); renderAll(); return
      }
      var prods = rs[1].ok && Array.isArray(rs[1].body) ? rs[1].body : null
      S.brands = {}
      if (rs[2].ok && Array.isArray(rs[2].body)) rs[2].body.forEach(function (b) { if (b && b.slug) S.brands[b.slug] = { en: clean(b.name_en), ar: clean(b.name_ar) } })
      S.hasDesc = !!prods
      S.items = buildItems(a.body, prods)
      S.loaded = true; S.edit = null; S.stale = false
      audit(S.items, S.sm)
      setNote(prods ? '' : 'The product descriptions could not be read, so descriptions of products are not audited. · تعذّرت قراءة أوصاف المنتجات، لذلك لا تُفحص أوصاف المنتجات.', !prods)
      renderAll()
      loadSite()
    })
  }
  function loadSite() {
    if (S.smLoading) return
    S.smLoading = true; S.checksLoading = true; renderChecks()
    readSitemap().then(function (sm) {
      S.sm = sm; S.smLoading = false
      if (S.loaded) audit(S.items, sm)
      refreshOutside()
      return readChecks(S.items, sm)
    }).then(function (list) {
      S.checks = list; S.checksLoading = false; renderChecks()
    }).catch(function () { S.smLoading = false; S.checksLoading = false; renderChecks() })
  }
  function refreshOutside() { renderTiles(); renderFilters(); if (S.edit) S.stale = true; else renderTable() }

  // ------------------------------------------------------------------ filter
  function visibleItems() {
    var f = S.f, q = norm(f.q)
    return S.items.filter(function (it) {
      if (f.kind === 'pages' && it.kind !== 'page') return false
      if (f.kind === 'products' && !(it.kind === 'product' && it.active)) return false
      if (f.kind === 'hidden' && !(it.kind === 'product' && !it.active)) return false
      if (f.status !== 'all' && it.sev !== f.status) return false
      if (f.issue !== 'all' && !it.issues.some(function (x) { return x.code === f.issue })) return false
      if (q) {
        var hay = norm([it.name, it.name_ar, it.slug || it.path, it.eff.ar.title, it.eff.en.title].join(' '))
        if (hay.indexOf(q) < 0) return false
      }
      return true
    })
  }
  function sorted(list) {
    var rank = { error: 0, warn: 1, ok: 2 }
    return list.map(function (it, i) { return [it, i] }).sort(function (a, b) { return (rank[a[0].sev] - rank[b[0].sev]) || (a[1] - b[1]) }).map(function (x) { return x[0] })
  }

  // ----------------------------------------------------------------- counters
  var BANDWORD = { good: 'good', short: 'short', long: 'long', over: 'over the limit', missing: 'empty' }
  var BANDWORD_AR = { good: 'جيد', short: 'قصير', long: 'طويل', over: 'تجاوز الحد', missing: 'فارغ' }
  var BANDGLYPH = { good: '✓', short: '▲', long: '▲', over: '✕', missing: '✕' }
  function chip(kind, n) {
    var b = bandOf(kind, n), c = el('span', 'ssh-chip ssh-chip--' + bandSev(b), BANDGLYPH[b] + ' ' + n)
    c.setAttribute('data-band', b)
    c.setAttribute('title', (kind === 'title' ? 'Title' : 'Description') + ': ' + n + ' characters, ' + BANDWORD[b] + '. Best ' + BAND[kind].min + '-' + BAND[kind].max + ', limit ' + LIM[kind] + '. · ' + (kind === 'title' ? 'العنوان' : 'الوصف') + ': ' + n + ' حرفًا، ' + BANDWORD_AR[b] + '. الأفضل ' + BAND[kind].min + '-' + BAND[kind].max + '، والحد ' + LIM[kind] + '.')
    return c
  }
  function counterText(kind, n) {
    var b = bandOf(kind, n)
    var hint = b === 'good' ? 'good · جيد' : b === 'short' ? 'short, aim for ' + BAND[kind].min + '-' + BAND[kind].max + ' · قصير، الأفضل ' + BAND[kind].min + '-' + BAND[kind].max : b === 'long' ? 'long, may be cut at about ' + BAND[kind].max + ' · طويل، قد يُقطع عند نحو ' + BAND[kind].max : b === 'over' ? 'over the limit of ' + LIM[kind] + ' · تجاوز الحد ' + LIM[kind] : 'empty: the default is used · فارغ، يُستخدم الافتراضي'
    return BANDGLYPH[b] + ' ' + n + ' · ' + hint
  }

  // ------------------------------------------------------------------ render
  function renderAll() { renderHead(); renderTiles(); renderFilters(); renderChecks(); renderSugg(); if (S.edit) S.stale = true; else renderTable() }
  function renderHead() {
    if (!R.err) return
    R.err.hidden = !S.err
    R.err.textContent = S.err
    R.body.hidden = !S.loaded
    R.refresh.disabled = S.loading
    R.suggest.disabled = !S.loaded || S.applying
    R.status.textContent = S.note
    R.status.setAttribute('data-bad', S.noteBad ? '1' : '0')
  }
  function renderTiles() {
    if (!R.tiles) return
    R.tiles.textContent = ''
    if (!S.loaded) return
    var c = counts(S.items)
    ;[['all', 'Audited · المفحوصة', c.all, 'pages and products · الصفحات والمنتجات'], ['error', 'Errors · أخطاء', c.error, 'fix first · صحّحها أولًا'], ['warn', 'Warnings · تحذيرات', c.warn, 'worth fixing · يستحق الإصلاح'], ['ok', 'Fine · سليمة', c.ok, 'no flags · بلا ملاحظات']].forEach(function (t) {
      var b = el('button', 'ssh-tile ssh-tile--' + t[0]); b.type = 'button'
      add(b, el('span', 'ssh-tile-label', t[1]), el('span', 'ssh-tile-big', String(t[2])), el('span', 'ssh-tile-sub', t[3]))
      b.setAttribute('aria-pressed', S.f.status === t[0] || (t[0] === 'all' && S.f.status === 'all') ? 'true' : 'false')
      b.addEventListener('click', function () { S.f.status = t[0] === 'all' ? 'all' : (S.f.status === t[0] ? 'all' : t[0]); S.limit = 50; S.edit = null; renderTiles(); renderFilters(); renderTable() })
      R.tiles.appendChild(b)
    })
  }
  function renderFilters() {
    if (!R.issue) return
    var c = counts(S.items), cur = S.f.issue
    R.issue.textContent = ''
    var o = el('option', '', 'Any flag · أي ملاحظة'); o.value = 'all'; R.issue.appendChild(o)
    Object.keys(CODES).forEach(function (code) {
      if (!c.codes[code] && code !== cur) return
      var op = el('option', '', CODES[code][0] + ' (' + (c.codes[code] || 0) + ')'); op.value = code; R.issue.appendChild(op)
    })
    R.issue.value = cur
    R.kind.value = S.f.kind
    R.clear.hidden = S.f.kind === 'all' && S.f.status === 'all' && S.f.issue === 'all' && !S.f.q
  }

  function sevLabel(s) { return s === 'error' ? '✕ Errors' : s === 'warn' ? '▲ Warnings' : '✓ Fine' }
  function rowEl(it) {
    var tr = el('tr', 'ssh-row'); tr.setAttribute('data-key', it.key); tr.setAttribute('data-sev', it.sev)
    // item
    var td = el('td'); td.setAttribute('data-label', 'Item · البند')
    add(td, el('span', 'ssh-name', it.name))
    if (it.name_ar) { var na = el('span', 'ssh-name-ar', it.name_ar); na.setAttribute('dir', 'rtl'); na.setAttribute('lang', 'ar'); td.appendChild(na) }
    add(td, el('span', 'ssh-sub', it.kind === 'page' ? it.path : '/product/' + it.slug))
    add(td, el('span', 'ssh-kind', it.kind === 'page' ? 'Page · صفحة' : (it.active ? 'Product · منتج' : 'Hidden product · منتج مخفي')))
    tr.appendChild(td)
    ;['ar', 'en'].forEach(function (l) {
      var e = it.eff[l], c = el('td'); c.setAttribute('data-label', l === 'ar' ? 'Arabic · العربية' : 'English · الإنجليزية')
      var box = el('div', 'ssh-text'); box.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr'); box.setAttribute('lang', l)
      var t = el('div', 'ssh-line ssh-line--title'), d = el('div', 'ssh-line ssh-line--desc')
      add(t, el('span', 'ssh-val', e.title), chip('title', len(e.title)), e.tsrc === 'custom' ? el('span', 'ssh-src', 'custom · مخصص') : null)
      if (e.descKnown) add(d, el('span', 'ssh-val', e.desc), chip('desc', len(e.desc)), e.dsrc === 'custom' ? el('span', 'ssh-src', 'custom · مخصص') : null)
      else add(d, el('span', 'ssh-val ssh-muted', 'Description not read · الوصف غير مقروء'))
      add(box, t, d); c.appendChild(box); tr.appendChild(c)
    })
    var im = el('td'); im.setAttribute('data-label', 'Share image · صورة المشاركة')
    var e0 = it.eff.en
    var img = el('img', 'ssh-thumb'); img.alt = ''; img.width = 44; img.height = 44; img.loading = 'lazy'; img.src = e0.image
    img.addEventListener('error', function () { img.style.visibility = 'hidden' })
    add(im, img, el('span', 'ssh-imglabel', e0.isrc === 'custom' ? 'Custom · مخصص' : e0.isrc === 'product' ? 'Product photo · صورة المنتج' : 'Default · افتراضي'))
    tr.appendChild(im)
    var is = el('td'); is.setAttribute('data-label', 'Flags · الملاحظات')
    var ul = el('ul', 'ssh-flags'), seen = {}
    it.issues.forEach(function (x) {
      var k = x.code + x.lang; if (seen[k]) return; seen[k] = 1
      var li = el('li', 'ssh-flag ssh-flag--' + x.sev)
      li.setAttribute('data-code', x.code)
      li.textContent = (x.sev === 'error' ? '✕ ' : x.sev === 'warn' ? '▲ ' : 'ℹ ') + CODES[x.code][0] + (x.lang ? ' · ' + x.lang.toUpperCase() : '')
      li.title = x.text
      ul.appendChild(li)
    })
    if (!it.issues.length) ul.appendChild(el('li', 'ssh-flag ssh-flag--ok', '✓ No flags · بلا ملاحظات'))
    is.appendChild(ul); tr.appendChild(is)
    var ac = el('td'); ac.setAttribute('data-label', '')
    var b = el('button', 'ssh-btn ssh-btn--small', S.edit === it.key ? 'Close · إغلاق' : 'Edit · تعديل'); b.type = 'button'
    b.setAttribute('aria-label', (S.edit === it.key ? 'Close the editor for ' : 'Edit SEO text for ') + it.name + ' · ' + (S.edit === it.key ? 'إغلاق محرر ' : 'تعديل نص محركات البحث لـ ') + it.name)
    b.setAttribute('aria-expanded', S.edit === it.key ? 'true' : 'false')
    b.addEventListener('click', function () { S.edit = S.edit === it.key ? null : it.key; if (!S.edit) S.stale = false; renderTable(); if (S.edit) { var f = R.tbody.querySelector('.ssh-editor input'); if (f) f.focus() } })
    ac.appendChild(b); tr.appendChild(ac)
    return tr
  }
  function renderTable() {
    if (!R.tbody) return
    S.stale = false
    R.tbody.textContent = ''
    var rows = sorted(visibleItems()), part = rows.slice(0, S.limit)
    part.forEach(function (it) {
      R.tbody.appendChild(rowEl(it))
      if (S.edit === it.key) R.tbody.appendChild(editRow(it))
    })
    R.count.textContent = rows.length === S.items.length ? pb(rows.length, ['item', 'items'], AR_ITEM) : rows.length + ' of ' + S.items.length + ' items · ' + rows.length + ' من ' + S.items.length + ' عنصر'
    R.more.hidden = rows.length <= S.limit
    R.more.textContent = 'Show more (' + (rows.length - S.limit) + ' left) · عرض المزيد (' + (rows.length - S.limit) + ' متبقية)'
    R.empty.hidden = rows.length > 0
  }

  function renderChecks() {
    if (!R.checks) return
    R.checks.textContent = ''
    if (S.checksLoading && !S.checks) { R.checks.appendChild(el('p', 'ssh-muted', 'Reading the sitemap, robots.txt and the home page… · جارٍ قراءة خريطة الموقع وملف robots.txt والصفحة الرئيسية…')); return }
    if (!S.checks) return
    var ul = el('ul', 'ssh-checklist'), fails = 0, warns = 0
    S.checks.forEach(function (c) {
      if (c.status === 'fail') fails++; else if (c.status === 'warn') warns++
      var li = el('li', 'ssh-check ssh-check--' + c.status); li.setAttribute('data-check', c.id); li.setAttribute('data-status', c.status)
      add(li, el('span', 'ssh-check-mark', c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : c.status === 'warn' ? '▲' : '–'))
      var b = el('div', 'ssh-check-body')
      var hd = el('div', 'ssh-check-head'); b.appendChild(hd)
      add(hd, el('strong', '', c.title), el('span', 'ssh-check-state', c.status === 'pass' ? 'Pass · نجح' : c.status === 'fail' ? 'Fail · فشل' : c.status === 'warn' ? 'Check · للمراجعة' : 'Not read · لم يُقرأ'))
      if (c.detail) b.appendChild(el('p', 'ssh-check-detail', c.detail))
      if (c.advice) b.appendChild(el('p', 'ssh-check-advice', c.advice))
      li.appendChild(b); ul.appendChild(li)
    })
    R.checks.appendChild(ul)
    R.checksTitle.textContent = 'Site checks · فحوص الموقع · ' + (fails ? fails + ' to fix · ' + fails + ' للإصلاح' : warns ? warns + ' to look at · ' + warns + ' للمراجعة' : 'all passed · اجتازت كلها')
  }

  // ------------------------------------------------------------------ editor
  function draftOf(f) {
    function v(x) { return String(x.value).replace(/[\u0000-\u001F\u007F]/g, '').trim() }
    return { title_en: v(f.title_en), title_ar: v(f.title_ar), description_en: v(f.description_en), description_ar: v(f.description_ar), image: v(f.image) }
  }
  function problem(d) {
    if (len(d.title_en) > LIM.title || len(d.title_ar) > LIM.title) return MSG.invalid_seo_title
    if (len(d.description_en) > LIM.desc || len(d.description_ar) > LIM.desc) return MSG.invalid_seo_description
    if (d.image !== '' && !validImage(d.image)) return MSG.invalid_seo_image
    return ''
  }
  function same(a, b) { return a.title_en === b.title_en && a.title_ar === b.title_ar && a.description_en === b.description_en && a.description_ar === b.description_ar && a.image === b.image }
  function truncated(text, max) { return len(text) > max ? cut(text, max - 1).replace(/\s+$/, '') + '…' : text }

  function googleCard(l) {
    var g = el('div', 'ssh-g'); g.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr'); g.setAttribute('lang', l); g.setAttribute('data-lang', l)
    var site = el('div', 'ssh-g-site')
    var fav = el('span', 'ssh-g-fav', 'S'); fav.setAttribute('aria-hidden', 'true')
    var who = el('span', 'ssh-g-who'), url = el('span', 'ssh-g-url'); url.setAttribute('dir', 'ltr')
    add(who, el('span', 'ssh-g-name', l === 'ar' ? 'سبورتا' : 'Sporta'), url)
    add(site, fav, who)
    add(g, el('div', 'ssh-g-lang', l === 'ar' ? 'Google · Arabic · العربية' : 'Google · English · الإنجليزية'), site, el('div', 'ssh-g-title'), el('div', 'ssh-g-desc'))
    return g
  }
  function editRow(it) {
    var tr = el('tr', 'ssh-edit'), td = el('td'); td.colSpan = 6
    var ed = el('div', 'ssh-editor'); ed.setAttribute('data-key', it.key)
    var form = el('form', 'ssh-form'); form.noValidate = true
    form.addEventListener('submit', function (ev) { ev.preventDefault() })
    var F = {}, counters = {}
    var defs = { ar: effective(it, 'ar', ovOf({})), en: effective(it, 'en', ovOf({})) }
    function field(name, label, kind, lang, multi) {
      var wrap = el('label', 'ssh-field'), top = el('span', 'ssh-lab')
      var c = el('span', 'ssh-counter'); c.setAttribute('data-for', name)
      add(top, el('span', '', label), c)
      var inp = el(multi ? 'textarea' : 'input', '')
      if (!multi) inp.type = 'text'; else inp.rows = 4
      inp.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr'); inp.setAttribute('lang', lang)
      inp.name = name; inp.value = it.ov[name]
      inp.placeholder = lang === 'ar' ? defs.ar[kind === 'title' ? 'title' : 'desc'] : defs.en[kind === 'title' ? 'title' : 'desc']
      if (it.kind === 'product' && kind === 'desc' && !defs[lang].descKnown) inp.placeholder = ''
      inp.setAttribute('data-kind', kind)
      wrap.appendChild(top); wrap.appendChild(inp)
      F[name] = inp; counters[name] = c
      return wrap
    }
    var grid = el('div', 'ssh-grid')
    var colAr = el('fieldset', 'ssh-fs'), colEn = el('fieldset', 'ssh-fs')
    colAr.appendChild(el('legend', '', 'Arabic · العربية')); colEn.appendChild(el('legend', '', 'English · الإنجليزية'))
    add(colAr, field('title_ar', 'Title · العنوان', 'title', 'ar'), field('description_ar', 'Description · الوصف', 'desc', 'ar', true))
    add(colEn, field('title_en', 'Title · العنوان', 'title', 'en'), field('description_en', 'Description · الوصف', 'desc', 'en', true))
    add(grid, colAr, colEn)
    var imgWrap = el('label', 'ssh-field'), itop = el('span', 'ssh-lab')
    add(itop, el('span', '', 'Share image path · مسار صورة المشاركة'), el('span', 'ssh-counter'))
    var im = el('input', ''); im.type = 'text'; im.name = 'image'; im.setAttribute('dir', 'ltr'); im.maxLength = 500; im.value = it.ov.image
    im.placeholder = it.kind === 'product' && it.prod && validImage(it.prod.image) ? String(it.prod.image) : DEFAULT_IMAGE
    F.image = im; counters.image = itop.lastChild
    add(imgWrap, itop, im, el('small', 'ssh-help', 'A file on this site, such as /images/products/photo.webp. Leave empty to use the product photo, or the shop image. · ملف على هذا الموقع، مثل /images/products/photo.webp. اتركه فارغًا لاستخدام صورة المنتج أو صورة المتجر.'))
    var msg = el('p', 'ssh-msg'); msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite')
    var acts = el('div', 'ssh-acts')
    var save = el('button', 'ssh-btn ssh-btn--primary', 'Save SEO · حفظ SEO'); save.type = 'button'
    var defBtn = el('button', 'ssh-btn', 'Use defaults · استخدام الافتراضي'); defBtn.type = 'button'
    var fill = null
    if (it.kind === 'product') { fill = el('button', 'ssh-btn', 'Fill with a suggestion · ملء باقتراح'); fill.type = 'button' }
    var cancel = el('button', 'ssh-btn ssh-btn--quiet', 'Cancel · إلغاء'); cancel.type = 'button'
    add(acts, save, defBtn, fill, cancel)
    add(form, grid, imgWrap, el('div', 'ssh-issues-box'), acts, msg)
    // preview column
    var prev = el('aside', 'ssh-preview'); prev.setAttribute('aria-label', 'Preview · معاينة')
    var gAr = googleCard('ar'), gEn = googleCard('en')
    var share = el('div', 'ssh-share'), seg = el('div', 'ssh-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Share card language · لغة بطاقة المشاركة')
    ;['ar', 'en'].forEach(function (l) {
      var b = el('button', 'ssh-segbtn', l === 'ar' ? 'AR' : 'EN'); b.type = 'button'
      b.setAttribute('aria-pressed', S.cardLang === l ? 'true' : 'false'); b.setAttribute('data-card', l)
      b.addEventListener('click', function () { S.cardLang = l; seg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-card') === l ? 'true' : 'false') }); update() })
      seg.appendChild(b)
    })
    var card = el('div', 'ssh-card')
    var cimg = el('img', 'ssh-card-img'); cimg.alt = ''
    var cb = el('div', 'ssh-card-body')
    add(cb, el('span', 'ssh-card-host', 'www.sporta.com.kw'), el('span', 'ssh-card-title'), el('span', 'ssh-card-desc'))
    add(card, cimg, cb)
    add(share, el('div', 'ssh-g-lang', 'Share card (WhatsApp, X, Facebook) · بطاقة المشاركة (واتساب، X، فيسبوك)'), seg, card)
    add(prev, el('h3', 'ssh-h3', 'Preview · معاينة'), gAr, gEn, share)
    add(ed, form, prev); td.appendChild(ed); tr.appendChild(td)

    function update() {
      var d = draftOf(F)
      ;['title_ar', 'title_en', 'description_ar', 'description_en'].forEach(function (k) {
        var n = len(d[k]), kind = k.indexOf('title') === 0 ? 'title' : 'desc', c = counters[k]
        if (n === 0) { c.textContent = '– default is used · الافتراضي مستخدم'; c.setAttribute('data-band', 'empty'); c.className = 'ssh-counter' }
        else { c.textContent = counterText(kind, n); c.setAttribute('data-band', bandOf(kind, n)); c.className = 'ssh-counter ssh-counter--' + bandSev(bandOf(kind, n)) }
      })
      var imgOk = d.image === '' || validImage(d.image)
      counters.image.textContent = d.image === '' ? '' : imgOk ? '✓ path ok · المسار صالح' : '✕ not a valid path · المسار غير صالح'
      counters.image.className = 'ssh-counter ' + (imgOk ? 'ssh-counter--ok' : 'ssh-counter--error')
      ;['ar', 'en'].forEach(function (l) {
        var e = effective(it, l, d), g = l === 'ar' ? gAr : gEn
        var path = it.kind === 'page' ? it.path : '/product/' + it.slug
        g.querySelector('.ssh-g-url').textContent = 'www.sporta.com.kw' + (path === '/' ? '' : ' › ' + path.replace(/^\//, '').split('/').join(' › ')) + (l === 'en' ? ' (?lang=en)' : '')
        var t = g.querySelector('.ssh-g-title'), dd = g.querySelector('.ssh-g-desc')
        t.textContent = truncated(e.title, BAND.title.max); t.setAttribute('data-cut', len(e.title) > BAND.title.max ? '1' : '0')
        dd.textContent = e.descKnown ? truncated(e.desc, BAND.desc.max) : ''; dd.setAttribute('data-cut', len(e.desc) > BAND.desc.max ? '1' : '0')
      })
      var ec = effective(it, S.cardLang, d)
      card.setAttribute('dir', S.cardLang === 'ar' ? 'rtl' : 'ltr'); card.setAttribute('lang', S.cardLang)
      cb.querySelector('.ssh-card-title').textContent = truncated(ec.title, 70)
      cb.querySelector('.ssh-card-desc').textContent = ec.descKnown ? truncated(ec.desc, 120) : ''
      cimg.style.visibility = 'visible'; cimg.src = ec.image
      var box = form.querySelector('.ssh-issues-box'); box.textContent = ''
      var shownIssues = it.issues.filter(function (x) { return x.sev !== 'info' || x.code === 'hidden' })
      if (shownIssues.length) {
        var ul = el('ul', 'ssh-issues')
        shownIssues.forEach(function (x) { ul.appendChild(el('li', 'ssh-issue ssh-issue--' + x.sev, x.text)) })
        add(box, el('p', 'ssh-issues-h', 'What the audit found (before your edits) · ما وجده الفحص (قبل تعديلاتك)'), ul)
      }
      var dirty = !same(d, it.ov), bad = problem(d)
      save.disabled = !dirty || !!bad || S.saving !== null
      if (bad) setMsg(bad, true); else if (msg.getAttribute('data-bad') === '1' && msg.getAttribute('data-local') === '1') setMsg('', false)
    }
    function setMsg(t, bad, local) { msg.textContent = t; msg.setAttribute('data-bad', bad ? '1' : '0'); msg.setAttribute('data-local', local === false ? '0' : '1') }
    cimg.addEventListener('error', function () { cimg.style.visibility = 'hidden' })
    Object.keys(F).forEach(function (k) { F[k].addEventListener('input', update) })
    defBtn.addEventListener('click', function () { Object.keys(F).forEach(function (k) { F[k].value = '' }); update() })
    cancel.addEventListener('click', function () { S.edit = null; renderTable() })
    if (fill) fill.addEventListener('click', function () {
      var s = suggestFor(it), filled = 0, kept = 0
      // only an EMPTY field takes a suggestion: text the owner typed is never overwritten by this click
      ;['title_en', 'title_ar', 'description_en', 'description_ar'].forEach(function (k) {
        if (!s[k]) return
        if (String(F[k].value).trim() !== '') { kept++; return }
        F[k].value = s[k]; filled++
      })
      update()
      if (kept && filled) setMsg('Filled the empty fields. Your own words stay in the others: clear a field to take its suggestion. · ملأتُ الحقول الفارغة. كلماتك باقية في الباقي: أفرغ الحقل لأخذ اقتراحه.', false)
      else if (kept) setMsg('Nothing filled: your own words are already in those fields. Clear a field to take its suggestion. · لم يُملأ شيء: كلماتك موجودة في تلك الحقول. أفرغ الحقل لأخذ اقتراحه.', false)
      else setMsg('Suggested text filled in. Read it, change it if you like, then Save SEO. · تم ملء النص المقترح. راجعه وعدّله إن أردت، ثم اضغط حفظ SEO.', false)
    })
    save.addEventListener('click', function () {
      if (S.saving !== null) return                      // a second press while one save is in flight does nothing
      var d = draftOf(F), bad = problem(d)
      if (bad) { setMsg(bad, true); return }
      if (same(d, it.ov)) return
      S.saving = it.key; save.disabled = true; save.textContent = 'Saving… · جارٍ الحفظ…'; setMsg('', false)
      saveRecord(it, d).then(function (r) {
        S.saving = null
        if (r.ok) { it.ov = r.rec; audit(S.items, S.sm); S.edit = null; setNote('Saved: ' + it.name + '. The shop shows it from the next page load. · تم الحفظ: ' + it.name + '. يظهر للزوار من التحميل التالي للصفحة.', false); renderAll(); return }
        save.textContent = 'Save SEO · حفظ SEO'; setMsg(r.text, true, false); update()
      })
    })
    update()
    return tr
  }
  // The ONE write. Body = exactly what admin.php seo_save reads.
  function saveRecord(it, d) {
    var body = it.kind === 'page' ? { scope: 'page', path: it.path } : { scope: 'product', product_id: it.id }
    body.title_en = d.title_en; body.title_ar = d.title_ar; body.description_en = d.description_en; body.description_ar = d.description_ar; body.image = d.image
    return request('seo_save', body).then(function (r) {
      if (r.ok && r.body && typeof r.body === 'object' && !r.body.error) return { ok: true, rec: ovOf(r.body.title_en != null || r.body.image != null ? r.body : d), status: r.status }
      return { ok: false, text: failText(r), status: r.status }
    })
  }

  // ----------------------------------------------------------------- suggest
  function suggestFor(it) {
    var br = it.prod && it.prod.brand_slug ? S.brands[it.prod.brand_slug] : null
    var slugName = it.prod && it.prod.brand_slug ? String(it.prod.brand_slug).replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, function (c) { return c.toUpperCase() }) : ''
    return suggest({
      name_en: it.name_en, name_ar: it.name_ar, desc_en: it.prod ? it.prod.desc_en : '', desc_ar: it.prod ? it.prod.desc_ar : '',
      category: it.prod ? it.prod.category : '', brand_en: br ? br.en : slugName, brand_ar: br ? br.ar : ''
    })
  }
  var FIELD_FLAGS = {
    title_en: ['title_short', 'title_long', 'title_over', 'dup_title'], title_ar: ['title_short', 'title_long', 'title_over', 'dup_title'],
    description_en: ['desc_short', 'desc_long', 'desc_over', 'default_desc', 'dup_desc'], description_ar: ['desc_short', 'desc_long', 'desc_over', 'default_desc', 'dup_desc']
  }
  function startSuggest() {
    var rows = []
    // A text belongs to one product only (the audit flags dup_title and dup_desc). A draft is left out when another product already
    // shows that text, or an earlier draft in this list takes it: the first product gets the suggestion, the others keep their own.
    var owners = {}, taken = {}
    function textKey(k, e) { return norm(k.indexOf('title') === 0 ? e.title : (e.descKnown && !e.generic ? e.desc : '')) }
    S.items.forEach(function (o) {
      if (!o.eff || (o.kind === 'product' && !o.active)) return
      Object.keys(FIELD_FLAGS).forEach(function (k) {
        var t = textKey(k, o.eff[k.slice(-2)])
        if (!t) return
        var byText = owners[k] = owners[k] || {}
        ;(byText[t] = byText[t] || []).push(o.key)
      })
    })
    S.items.forEach(function (it) {
      if (it.kind !== 'product' || !it.active || !it.prod) return
      var s = suggestFor(it), picks = {}, n = 0
      Object.keys(FIELD_FLAGS).forEach(function (k) {
        var l = k.slice(-2)
        var flagged = it.issues.some(function (x) { return x.lang === l && FIELD_FLAGS[k].indexOf(x.code) >= 0 && x.sev !== 'info' })
        if (!flagged || !s[k] || s[k] === it.ov[k] || len(s[k]) > (k.indexOf('title') === 0 ? LIM.title : LIM.desc)) return
        var t = norm(s[k]), held = (owners[k] && owners[k][t]) || [], used = taken[k] = taken[k] || {}
        if (used[t] || held.some(function (key) { return key !== it.key })) return
        used[t] = true
        var e = it.eff[l]
        picks[k] = { old: k.indexOf('title') === 0 ? e.title : e.desc, neu: s[k] }; n++
      })
      // the share image: a product whose main photo is not set but has an extra photo
      var ph = photoOf(it)
      if (ph && !ph.main && it.ov.image === '') {
        var extra = String(it.prod.images || '').split(',').map(function (x) { return x.trim() }).filter(validImage)[0]
        if (extra) { picks.image = { old: it.eff.en.image, neu: extra }; n++ }
      }
      if (n) rows.push({ key: it.key, it: it, picks: picks, checked: true, error: '', done: false })
    })
    S.sugg = { rows: rows }; S.confirm = false
    renderSugg()
    if (R.sugg && R.sugg.scrollIntoView) { try { R.sugg.scrollIntoView({ block: 'nearest' }) } catch (e) { /* older browser */ } }
  }
  function fieldName(k) { return { title_en: 'English title · عنوان بالإنجليزية', title_ar: 'Arabic title · عنوان بالعربية', description_en: 'English description · وصف بالإنجليزية', description_ar: 'Arabic description · وصف بالعربية', image: 'Share image · صورة المشاركة' }[k] }
  function renderSugg() {
    if (!R.sugg) return
    R.sugg.textContent = ''
    R.sugg.hidden = !S.sugg
    if (!S.sugg) return
    var rows = S.sugg.rows, picked = rows.filter(function (r) { return r.checked && !r.done }).length
    var head = el('div', 'ssh-sugg-head')
    add(head, el('h2', 'ssh-h2', 'Suggested text · النص المقترح · ' + pb(rows.length, ['product', 'products'], AR_PRODUCT)))
    var close = el('button', 'ssh-btn ssh-btn--quiet', 'Close · إغلاق'); close.type = 'button'
    close.addEventListener('click', function () { if (S.applying) return; S.sugg = null; S.confirm = false; renderSugg() })
    head.appendChild(close)
    R.sugg.appendChild(head)
    R.sugg.appendChild(el('p', 'ssh-muted', rows.length ? 'Drafts built from each product’s names, brand, category and own description, only for the texts the audit flagged. Nothing is saved until you press Apply and confirm. Read them: a template cannot know your product. · مسودات مبنية على أسماء كل منتج وعلامته وفئته ووصفه الخاص، ولنصوص نبّه إليها الفحص فقط. لا يُحفظ شيء حتى تضغط تطبيق وتؤكد. اقرأها: القالب لا يعرف منتجك.' : 'Nothing to suggest: no product has a flagged text that a template can improve. · لا يوجد ما يُقترح: لا يوجد منتج لديه نص مُعلَّم يمكن للقالب تحسينه.'))
    if (rows.length) {
      var ul = el('ul', 'ssh-sugg-list')
      rows.forEach(function (r) {
        var li = el('li', 'ssh-sugg-item'); li.setAttribute('data-key', r.key)
        var lab = el('label', 'ssh-sugg-check'), cb = el('input'); cb.type = 'checkbox'; cb.checked = r.checked; cb.disabled = r.done || S.applying
        cb.addEventListener('change', function () { r.checked = cb.checked; S.confirm = false; renderSugg() })
        add(lab, cb, el('strong', '', r.it.name))
        li.appendChild(lab)
        Object.keys(r.picks).forEach(function (k) {
          var p = r.picks[k], rowf = el('div', 'ssh-diff'); rowf.setAttribute('data-field', k)
          var isAr = k.slice(-2) === 'ar'
          var o = el('div', 'ssh-old'), nw = el('div', 'ssh-new')
          if (isAr) { o.setAttribute('dir', 'rtl'); nw.setAttribute('dir', 'rtl') }
          add(o, el('span', 'ssh-difflab', fieldName(k) + ' now · الحالي'), el('span', 'ssh-val', p.old))
          add(nw, el('span', 'ssh-difflab', 'Suggested · المقترح' + (k === 'image' ? '' : ' (' + len(p.neu) + ' characters · ' + len(p.neu) + ' حرفًا)')), el('span', 'ssh-val', p.neu))
          add(rowf, o, nw); li.appendChild(rowf)
        })
        if (r.error) { var er = el('p', 'ssh-msg'); er.setAttribute('data-bad', '1'); er.textContent = r.error; li.appendChild(er) }
        ul.appendChild(li)
      })
      R.sugg.appendChild(ul)
      var acts = el('div', 'ssh-acts')
      var all = el('button', 'ssh-btn', 'Select all · تحديد الكل'), none = el('button', 'ssh-btn', 'Select none · إلغاء التحديد'); all.type = none.type = 'button'
      all.disabled = none.disabled = S.applying
      all.addEventListener('click', function () { rows.forEach(function (r) { if (!r.done) r.checked = true }); S.confirm = false; renderSugg() })
      none.addEventListener('click', function () { rows.forEach(function (r) { r.checked = false }); S.confirm = false; renderSugg() })
      add(acts, all, none)
      if (!S.confirm) {
        var ap = el('button', 'ssh-btn ssh-btn--primary', 'Apply selected (' + picked + ') · تطبيق المحدد (' + picked + ')'); ap.type = 'button'; ap.disabled = !picked || S.applying
        ap.setAttribute('data-sporta-seo-apply', '1')
        ap.addEventListener('click', function () { if (!picked || S.applying) return; S.confirm = true; renderSugg() })
        acts.appendChild(ap)
      } else {
        var yes = el('button', 'ssh-btn ssh-btn--primary', 'Yes, save ' + plural(picked, 'product', 'products') + ' · نعم، احفظ ' + picked + ' ' + arCount(picked, AR_PRODUCT)); yes.type = 'button'; yes.disabled = S.applying
        yes.setAttribute('data-sporta-seo-confirm', '1')
        var no = el('button', 'ssh-btn', 'Not yet · ليس بعد'); no.type = 'button'; no.disabled = S.applying
        yes.addEventListener('click', applySuggestions)
        no.addEventListener('click', function () { S.confirm = false; renderSugg() })
        acts.appendChild(el('p', 'ssh-confirm', 'This changes the search text of ' + plural(picked, 'product', 'products') + ' on the live shop. Each is saved on its own. · هذا يغيّر نص البحث لـ ' + picked + ' ' + arCount(picked, AR_PRODUCT) + ' في المتجر المباشر. يُحفظ كل منتج على حدة.'))
        add(acts, yes, no)
      }
      R.sugg.appendChild(acts)
    }
  }
  function applySuggestions() {
    if (S.applying || !S.sugg) return
    var todo = S.sugg.rows.filter(function (r) { return r.checked && !r.done })
    if (!todo.length) return
    S.applying = true; S.confirm = false; renderSugg(); renderHead()
    var ok = 0, failed = 0, stop = '', i = 0
    ;(function next() {
      if (i >= todo.length || stop) {
        S.applying = false
        audit(S.items, S.sm)
        S.sugg.rows = S.sugg.rows.filter(function (r) { return !r.done })
        setNote((ok ? 'Saved ' + plural(ok, 'product', 'products') + ' · تم حفظ ' + ok + ' ' + arCount(ok, AR_PRODUCT) + '. ' : '') + (failed ? failed + ' failed · فشل: ' + failed + '. ' : '') + (stop ? stop : ''), !!(failed || stop))
        renderAll(); return
      }
      var r = todo[i++], it = r.it
      setNote('Saving ' + i + ' of ' + todo.length + '… · جارٍ الحفظ ' + i + ' من ' + todo.length + '…')
      var d = Object.assign({}, it.ov)
      Object.keys(r.picks).forEach(function (k) { d[k] = r.picks[k].neu })
      var bad = problem(d)
      if (bad) { r.error = bad; r.checked = false; failed++; return next() }
      saveRecord(it, d).then(function (res) {
        if (res.ok) { it.ov = res.rec; r.done = true; ok++ }
        else {
          r.error = res.text; failed++
          if (res.status === 401 || res.status === 429 || res.status === 0) stop = 'Stopped · توقّف: ' + res.text
        }
        next()
      })
    })()
  }

  // --------------------------------------------------------------------- CSS
  var CSS = [
    '.ssh{--ssh-bg:#fff;--ssh-soft:#f7f8fa;--ssh-line:#d9dfe5;--ssh-edge:#7d8799;--ssh-text:#18212a;--ssh-muted:#556274;--ssh-action:var(--admin-action,#9a452c);--ssh-on-action:#fff;--ssh-pick:#f8ece6;--ssh-ok:#1b6e3c;--ssh-ok-bg:#e6f4ec;--ssh-warn:#8a4b00;--ssh-warn-bg:#fdf0d9;--ssh-err:#be123c;--ssh-err-bg:#fde8ee;--ssh-gt:#1a0dab;--ssh-gd:#4d5156;--ssh-gbg:#fff;--ssh-gline:#dfe1e5;' +
      'container-type:inline-size;box-sizing:border-box;margin:0;padding:1rem;border:1px solid var(--ssh-line);border-radius:1rem;background:var(--ssh-bg);color:var(--ssh-text);font:400 .875rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:start}',
    '@media (max-width:420px){.ssh{padding:.625rem}}',
    ':is(html.dark,html[data-theme="dark"]) .ssh{color-scheme:dark;--ssh-bg:#151b21;--ssh-soft:#1a2128;--ssh-line:#303942;--ssh-edge:#7a8896;--ssh-text:#eef2f5;--ssh-muted:#a7b3be;--ssh-action:var(--brand-bright,#ff7b17);--ssh-on-action:#171a1e;--ssh-pick:#372a24;--ssh-ok:#6ee7a3;--ssh-ok-bg:#0f2f1f;--ssh-warn:#fbbf24;--ssh-warn-bg:#3a2a0a;--ssh-err:#fda4af;--ssh-err-bg:#3d1520;--ssh-gt:#8ab4f8;--ssh-gd:#bdc1c6;--ssh-gbg:#202124;--ssh-gline:#3c4043}',
    '.ssh[hidden]{display:none!important}',
    '.ssh *,.ssh *::before,.ssh *::after{box-sizing:border-box}',
    '.ssh-wrap{display:grid;gap:1rem;min-width:0}',
    '.ssh-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:.75rem}',
    '.ssh-title{margin:0;font-size:1.5rem;font-weight:700;line-height:1.25;color:var(--ssh-text)}',
    '.ssh-title:focus,.ssh-title:focus-visible{outline:none}',
    '.ssh-lead{margin:.25rem 0 0;color:var(--ssh-muted)}',
    '.ssh-tools{display:flex;flex-wrap:wrap;gap:.5rem;width:100%}',
    '@container (min-width:640px){.ssh-tools{width:auto}}',
    '.ssh p{margin:0}',
    '.ssh :is(button,input,select,textarea){font:inherit}',
    '.ssh .ssh-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.75rem;padding:.5rem 1rem;border:1px solid var(--ssh-edge);border-radius:.75rem;background:var(--ssh-bg);color:var(--ssh-text);font-weight:600;text-align:center;cursor:pointer}',
    '.ssh .ssh-btn:hover:not(:disabled){background:var(--ssh-soft);border-color:var(--ssh-text)}',
    '.ssh .ssh-btn--primary{background:var(--ssh-action);border-color:transparent;color:var(--ssh-on-action);font-weight:700}',
    '.ssh .ssh-btn--primary:hover:not(:disabled){background:var(--ssh-action);border-color:transparent;filter:brightness(.9)}',
    '.ssh .ssh-btn--small{padding:.25rem .75rem;font-size:.8125rem}',
    '.ssh .ssh-btn--quiet{border-color:var(--ssh-line);color:var(--ssh-muted)}',
    '.ssh .ssh-btn:disabled{cursor:not-allowed;background:var(--ssh-soft);border-color:var(--ssh-line);color:var(--ssh-muted)}',
    '.ssh :is(button,input,select,textarea,summary,a):focus-visible{outline:2px solid var(--ssh-action);outline-offset:2px}',
    '.ssh-status{min-height:1.25rem;font-weight:600;color:var(--ssh-muted);overflow-wrap:anywhere}',
    '.ssh-status[data-bad="1"],.ssh-msg[data-bad="1"]{color:var(--ssh-err)}',
    '.ssh-box{padding:1rem;border:1px solid var(--ssh-err);border-radius:.875rem;background:var(--ssh-err-bg);color:var(--ssh-err);font-weight:600}',
    '.ssh-muted{color:var(--ssh-muted)}',
    '.ssh-tiles{display:grid;gap:.625rem;grid-template-columns:repeat(2,minmax(0,1fr))}',
    '@container (min-width:560px){.ssh-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}',
    '.ssh-tile{display:flex;flex-direction:column;gap:.125rem;min-width:0;min-height:2.75rem;padding:.75rem;border:1px solid var(--ssh-line);border-radius:.875rem;background:var(--ssh-soft);color:var(--ssh-text);text-align:start;cursor:pointer}',
    '.ssh-tile:hover{border-color:var(--ssh-edge)}',
    '.ssh-tile[aria-pressed="true"]{border:2px solid var(--ssh-action);background:var(--ssh-pick);padding:calc(.75rem - 1px)}',
    '.ssh-tile-label{font-size:.75rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--ssh-muted)}',
    '.ssh-tile-big{font-size:1.375rem;font-weight:800;line-height:1.2;font-variant-numeric:tabular-nums}',
    '.ssh-tile--error .ssh-tile-big{color:var(--ssh-err)}.ssh-tile--warn .ssh-tile-big{color:var(--ssh-warn)}.ssh-tile--ok .ssh-tile-big{color:var(--ssh-ok)}',
    '.ssh-tile-sub{font-size:.75rem;color:var(--ssh-muted)}',
    '.ssh-det{border:1px solid var(--ssh-line);border-radius:.875rem;background:var(--ssh-bg)}',
    '.ssh-det>summary{display:flex;align-items:center;min-height:2.75rem;padding:0 .875rem;font-weight:700;cursor:pointer;border-radius:.875rem}',
    '.ssh-det-body{display:grid;gap:.75rem;padding:0 .875rem .875rem}',
    '.ssh-checklist,.ssh-needs{margin:0;padding:0;list-style:none;display:grid;gap:.5rem}',
    '.ssh-check{display:flex;gap:.625rem;padding:.625rem .75rem;border:1px solid var(--ssh-line);border-radius:.75rem;background:var(--ssh-soft)}',
    '.ssh-check-mark{flex:none;width:1.5rem;height:1.5rem;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid currentColor;font-size:.8125rem;font-weight:800}',
    '.ssh-check--pass .ssh-check-mark{color:var(--ssh-ok)}.ssh-check--warn .ssh-check-mark{color:var(--ssh-warn)}.ssh-check--fail .ssh-check-mark{color:var(--ssh-err)}.ssh-check--skip .ssh-check-mark{color:var(--ssh-muted)}',
    '.ssh-check-body{min-width:0;display:grid;gap:.125rem}',
    '.ssh-check-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 .5rem}',
    '.ssh-check-state{font-size:.75rem;font-weight:700;color:var(--ssh-muted)}',
    '.ssh-check-detail,.ssh-check-advice{overflow-wrap:anywhere}',
    '.ssh-check-advice{color:var(--ssh-muted)}',
    '.ssh-filters{display:grid;gap:.625rem;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));align-items:end;padding:.75rem;border:1px solid var(--ssh-line);border-radius:.875rem;background:var(--ssh-soft)}',
    '.ssh-fld{display:grid;gap:.25rem;min-width:0}',
    '.ssh-fld>.ssh-flab{font-size:.8125rem;font-weight:700;color:var(--ssh-muted)}',
    '.ssh :is(select,input[type="text"],input[type="search"],textarea){width:100%;min-height:2.75rem;padding:.25rem .625rem;border:1px solid var(--ssh-edge);border-radius:.75rem;color:var(--ssh-text)!important;background-color:var(--ssh-bg)!important;box-shadow:none}',
    '.ssh textarea{min-height:5rem;padding:.5rem .625rem;resize:vertical;line-height:1.5}',
    '.ssh input::placeholder,.ssh textarea::placeholder{color:var(--ssh-muted)!important;opacity:1!important}',
    '.ssh-countline{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem;color:var(--ssh-muted);font-weight:600}',
    // the table: cards on a phone, a table once the panel is wide
    '.ssh-table{display:block;width:100%;border-collapse:separate;border-spacing:0}',
    '.ssh-table thead{display:none}',
    '.ssh-table tbody{display:grid;gap:.625rem}',
    '.ssh-table tr.ssh-row{display:block;padding:.5rem .875rem;border:1px solid var(--ssh-line);border-inline-start:4px solid var(--ssh-line);border-radius:.875rem;background:var(--ssh-bg)}',
    '.ssh-table tr.ssh-row[data-sev="error"]{border-inline-start-color:var(--ssh-err)}.ssh-table tr.ssh-row[data-sev="warn"]{border-inline-start-color:var(--ssh-warn)}.ssh-table tr.ssh-row[data-sev="ok"]{border-inline-start-color:var(--ssh-ok)}',
    '.ssh-table td{display:block;min-width:0;padding:.5rem 0;border-top:1px solid var(--ssh-line)}',
    '.ssh-table td:first-child{border-top:0}',
    '.ssh-table td::before{content:attr(data-label);display:block;margin-bottom:.125rem;font-size:.75rem;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--ssh-muted)}',
    '.ssh-table td[data-label=""]::before{display:none}',
    '.ssh-table tr.ssh-edit{display:block}.ssh-table tr.ssh-edit>td{display:block;padding:0;border:0}.ssh-table tr.ssh-edit>td::before{display:none}',
    '.ssh-name{display:block;font-weight:700;overflow-wrap:anywhere}',
    '.ssh-name-ar{display:block;color:var(--ssh-muted);overflow-wrap:anywhere}',
    '.ssh-sub{display:block;font:500 .75rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ssh-muted);overflow-wrap:anywhere}',
    '.ssh-kind{display:inline-block;margin-top:.25rem;padding:.0625rem .5rem;border:1px solid var(--ssh-line);border-radius:999px;font-size:.75rem;font-weight:700;color:var(--ssh-muted)}',
    '.ssh-text{display:grid;gap:.375rem;min-width:0}',
    '.ssh-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:.25rem .5rem;min-width:0}',
    '.ssh-line--title .ssh-val{font-weight:700}',
    '.ssh-val{min-width:0;overflow-wrap:anywhere;unicode-bidi:plaintext}',
    '.ssh-line--desc .ssh-val{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--ssh-muted)}',
    '.ssh-src{font-size:.75rem;font-weight:700;color:var(--ssh-action)}',
    '.ssh-chip{display:inline-flex;align-items:center;gap:.25rem;padding:.0625rem .5rem;border:1px solid currentColor;border-radius:999px;font-size:.75rem;font-weight:700;line-height:1.5;font-variant-numeric:tabular-nums;white-space:nowrap;direction:ltr;unicode-bidi:isolate}',
    '.ssh-chip--ok{color:var(--ssh-ok);background:var(--ssh-ok-bg)}.ssh-chip--warn{color:var(--ssh-warn);background:var(--ssh-warn-bg)}.ssh-chip--error{color:var(--ssh-err);background:var(--ssh-err-bg)}',
    '.ssh-thumb{display:block;width:2.75rem;height:2.75rem;object-fit:cover;border:1px solid var(--ssh-line);border-radius:.5rem;background:var(--ssh-soft)}',
    '.ssh-imglabel{display:block;margin-top:.25rem;font-size:.75rem;font-weight:600;color:var(--ssh-muted)}',
    '.ssh-flags{display:flex;flex-wrap:wrap;gap:.25rem;margin:0;padding:0;list-style:none}',
    '.ssh-flag{padding:.0625rem .5rem;border:1px solid currentColor;border-radius:999px;font-size:.75rem;font-weight:700;line-height:1.5}',
    '.ssh-flag--error{color:var(--ssh-err);background:var(--ssh-err-bg)}.ssh-flag--warn{color:var(--ssh-warn);background:var(--ssh-warn-bg)}.ssh-flag--ok{color:var(--ssh-ok);background:var(--ssh-ok-bg)}.ssh-flag--info{color:var(--ssh-muted);background:var(--ssh-soft)}',
    '.ssh-more{display:flex;justify-content:center}',
    '.ssh-empty{padding:1rem;text-align:center;color:var(--ssh-muted)}',
    // the editor
    '.ssh-editor{display:grid;gap:1rem;margin:.25rem 0 .5rem;padding:1rem;border:2px solid var(--ssh-action);border-radius:.875rem;background:var(--ssh-soft)}',
    '@container (min-width:900px){.ssh-editor{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}}',
    '.ssh-form{display:grid;gap:.875rem;min-width:0}',
    '.ssh-grid{display:grid;gap:.875rem}',
    '@container (min-width:640px){.ssh-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '.ssh-fs{display:grid;gap:.75rem;min-width:0;margin:0;padding:.75rem;border:1px solid var(--ssh-line);border-radius:.75rem;background:var(--ssh-bg)}',
    '.ssh-fs>legend{padding:0 .375rem;font-weight:700}',
    '.ssh-field{display:grid;gap:.25rem;min-width:0}',
    '.ssh-lab{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.25rem .5rem;font-size:.8125rem;font-weight:700;color:var(--ssh-muted)}',
    '.ssh-counter{font-weight:700;font-variant-numeric:tabular-nums;color:var(--ssh-muted)}',
    '.ssh-counter--ok{color:var(--ssh-ok)}.ssh-counter--warn{color:var(--ssh-warn)}.ssh-counter--error{color:var(--ssh-err)}',
    '.ssh-help{color:var(--ssh-muted)}',
    '.ssh-acts{display:flex;flex-wrap:wrap;gap:.5rem}',
    '.ssh-msg{min-height:1.25rem;font-weight:600;color:var(--ssh-muted);overflow-wrap:anywhere}',
    '.ssh-issues-h{font-weight:700}',
    '.ssh-issues{margin:.25rem 0 0;padding:0;list-style:none;display:grid;gap:.25rem}',
    '.ssh-issue{padding-inline-start:.625rem;border-inline-start:3px solid var(--ssh-line);overflow-wrap:anywhere}',
    '.ssh-issue--error{border-color:var(--ssh-err)}.ssh-issue--warn{border-color:var(--ssh-warn)}',
    '.ssh-preview{display:grid;gap:.75rem;align-content:start;min-width:0}',
    '.ssh-h2,.ssh-h3{margin:0;font-size:1rem;font-weight:700}',
    '.ssh-g{min-width:0;padding:.75rem .875rem;border:1px solid var(--ssh-gline);border-radius:.75rem;background:var(--ssh-gbg)}',
    '.ssh-g-lang{margin-bottom:.375rem;font-size:.75rem;font-weight:700;color:var(--ssh-muted)}',
    '.ssh-g-site{display:flex;align-items:center;gap:.5rem;min-width:0}',
    '.ssh-g-fav{flex:none;width:1.625rem;height:1.625rem;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:var(--ssh-action);color:var(--ssh-on-action);font-size:.8125rem;font-weight:800}',
    '.ssh-g-who{display:grid;min-width:0;line-height:1.3}',
    '.ssh-g-name{font-size:.8125rem;color:var(--ssh-text)}',
    '.ssh-g-url{font-size:.75rem;color:var(--ssh-gd);overflow-wrap:anywhere}',
    '.ssh-g-title{margin-top:.375rem;font-size:1.125rem;line-height:1.3;color:var(--ssh-gt);overflow-wrap:anywhere}',
    '.ssh-g-desc{margin-top:.125rem;font-size:.875rem;line-height:1.5;color:var(--ssh-gd);overflow-wrap:anywhere}',
    '.ssh-seg{display:inline-flex;margin-bottom:.5rem;border:1px solid var(--ssh-edge);border-radius:.75rem;overflow:hidden}',
    '.ssh .ssh-segbtn{min-height:2.75rem;min-width:2.75rem;padding:0 .875rem;border:0;background:var(--ssh-bg);color:var(--ssh-text);font-weight:700;cursor:pointer}',
    '.ssh .ssh-segbtn[aria-pressed="true"]{background:var(--ssh-action);color:var(--ssh-on-action)}',
    '.ssh-card{overflow:hidden;border:1px solid var(--ssh-gline);border-radius:.75rem;background:var(--ssh-gbg)}',
    '.ssh-card-img{display:block;width:100%;aspect-ratio:1.91/1;object-fit:cover;background:var(--ssh-soft)}',
    '.ssh-card-body{display:grid;gap:.125rem;padding:.625rem .75rem;border-top:1px solid var(--ssh-gline)}',
    '.ssh-card-host{font-size:.75rem;color:var(--ssh-gd);direction:ltr;text-align:start}',
    '.ssh-card-title{font-weight:700;overflow-wrap:anywhere}',
    '.ssh-card-desc{font-size:.8125rem;color:var(--ssh-gd);overflow-wrap:anywhere}',
    // suggestions
    '.ssh-sugg{display:grid;gap:.75rem;padding:1rem;border:2px solid var(--ssh-action);border-radius:.875rem;background:var(--ssh-soft)}',
    '.ssh-sugg[hidden]{display:none}',
    '.ssh-sugg-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem}',
    '.ssh-sugg-list{margin:0;padding:0;list-style:none;display:grid;gap:.625rem;max-height:32rem;overflow:auto}',
    '.ssh-sugg-item{display:grid;gap:.5rem;padding:.75rem;border:1px solid var(--ssh-line);border-radius:.75rem;background:var(--ssh-bg)}',
    '.ssh-sugg-check{display:flex;align-items:center;gap:.5rem;min-height:2.75rem}',
    '.ssh-sugg-check input{width:1.25rem;height:1.25rem;min-height:0;accent-color:var(--ssh-action)}',
    '.ssh-diff{display:grid;gap:.375rem}',
    '@container (min-width:640px){.ssh-diff{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '.ssh-old,.ssh-new{display:grid;gap:.125rem;min-width:0;padding:.5rem .625rem;border-radius:.5rem}',
    '.ssh-old{background:var(--ssh-soft)}.ssh-new{background:var(--ssh-pick);border:1px solid var(--ssh-action)}',
    '.ssh-difflab{font-size:.75rem;font-weight:700;color:var(--ssh-muted)}',
    '.ssh-confirm{flex:1 1 100%;font-weight:700}',
    '.ssh-needs li{padding:.5rem .75rem;border:1px solid var(--ssh-line);border-radius:.75rem;background:var(--ssh-soft)}',
    '.ssh-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}',
    '@container (min-width:900px){',
    '.ssh-table{display:table}',
    '.ssh-table thead{display:table-header-group}',
    '.ssh-table tbody{display:table-row-group}',
    '.ssh-table tr.ssh-row{display:table-row;padding:0;border:0;border-radius:0;background:none}',
    '.ssh-table th{padding:.625rem;border-bottom:2px solid var(--ssh-line);font-size:.75rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;text-align:start;color:var(--ssh-muted)}',
    '.ssh-table tr.ssh-row>td{display:table-cell;padding:.75rem .625rem;border-top:0;border-bottom:1px solid var(--ssh-line);vertical-align:top}',
    '.ssh-table tr.ssh-row[data-sev="error"]>td:first-child{box-shadow:inset 4px 0 0 var(--ssh-err)}.ssh-table tr.ssh-row[data-sev="warn"]>td:first-child{box-shadow:inset 4px 0 0 var(--ssh-warn)}.ssh-table tr.ssh-row[data-sev="ok"]>td:first-child{box-shadow:inset 4px 0 0 var(--ssh-ok)}',
    '[dir="rtl"] .ssh-table tr.ssh-row[data-sev="error"]>td:first-child{box-shadow:inset -4px 0 0 var(--ssh-err)}[dir="rtl"] .ssh-table tr.ssh-row[data-sev="warn"]>td:first-child{box-shadow:inset -4px 0 0 var(--ssh-warn)}[dir="rtl"] .ssh-table tr.ssh-row[data-sev="ok"]>td:first-child{box-shadow:inset -4px 0 0 var(--ssh-ok)}',
    '.ssh-table td::before{display:none}',
    '.ssh-table tr.ssh-edit{display:table-row}.ssh-table tr.ssh-edit>td{display:table-cell;padding:.25rem 0 .75rem;border:0}',
    '.ssh-table th:nth-child(1){width:17%}.ssh-table th:nth-child(2),.ssh-table th:nth-child(3){width:25%}.ssh-table th:nth-child(4){width:9%}.ssh-table th:nth-child(5){width:17%}.ssh-table th:nth-child(6){width:7%}',
    '}',
    'body[' + OPEN + '="open"] main.admin-content>section.admin-page:not([' + PAGE + ']){display:none!important}',
    // the entry button (outside the panel, in the SEO Editor's header)
    '.ssh-open{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.75rem;padding:.5rem 1rem;border:0;border-radius:.75rem;background:var(--admin-action,#9a452c);color:#fff;font:700 .875rem/1.25 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}',
    '.ssh-open:hover{filter:brightness(.92)}',
    '.ssh-open:focus-visible{outline:2px solid var(--admin-action,#9a452c);outline-offset:2px}',
    ':is(html.dark,html[data-theme="dark"]) .ssh-open{background:var(--brand-bright,#ff7b17);color:#171a1e}',
    '@media (prefers-reduced-motion:no-preference){.ssh .ssh-btn,.ssh-tile{transition:background-color .15s ease,border-color .15s ease}}'
  ].join('\n')
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return
    styleEl = document.createElement('style')
    styleEl.setAttribute('data-sporta-seo-style', '')
    styleEl.textContent = CSS
    document.head.appendChild(styleEl)
  }

  // ------------------------------------------------------------------- panel
  function fld(label, control) { var l = el('label', 'ssh-fld'); add(l, el('span', 'ssh-flab', label), control); return l }
  function build() {
    var sec = el('section', 'admin-page ssh'); sec.setAttribute(PAGE, ''); sec.setAttribute('aria-labelledby', 'ssh-title'); sec.hidden = true
    var wrap = el('div', 'ssh-wrap admin-page-layout')
    var head = el('header', 'ssh-head'), left = el('div')
    R.h1 = el('h1', 'ssh-title', 'SEO health · صحة محركات البحث'); R.h1.id = 'ssh-title'; R.h1.tabIndex = -1
    add(left, R.h1, el('p', 'ssh-lead', 'How every page and product will look in a search result, in Arabic and English. Fix a text here and press Save, or let Suggest draft the weak ones for you to review. · كيف ستظهر كل صفحة ومنتج في نتائج البحث، بالعربية والإنجليزية. عدّل النص هنا واضغط حفظ، أو دع الاقتراح يكتب المسودات الضعيفة لتراجعها.'))
    var tools = el('div', 'ssh-tools')
    R.back = el('button', 'ssh-btn', '← Back to SEO editor · العودة إلى محرر SEO'); R.back.type = 'button'
    R.suggest = el('button', 'ssh-btn ssh-btn--primary', 'Suggest text for products · اقتراح نصوص للمنتجات'); R.suggest.type = 'button'
    R.refresh = el('button', 'ssh-btn', 'Refresh · تحديث'); R.refresh.type = 'button'
    R.back.addEventListener('click', function () { closePanel(true) })
    R.suggest.addEventListener('click', function () { if (S.loaded && !S.applying) startSuggest() })
    R.refresh.addEventListener('click', function () { if (S.applying || S.saving !== null) return; S.sm = null; S.checks = null; load() })
    add(tools, R.back, R.suggest, R.refresh)
    add(head, left, tools)
    R.status = el('p', 'ssh-status'); R.status.setAttribute('role', 'status'); R.status.setAttribute('aria-live', 'polite')
    R.err = el('div', 'ssh-box'); R.err.setAttribute('role', 'alert'); R.err.hidden = true
    R.body = el('div'); R.body.style.display = 'grid'; R.body.style.gap = '1rem'; R.body.hidden = true
    R.tiles = el('div', 'ssh-tiles')
    // site checks
    var det = el('details', 'ssh-det'); det.open = true
    R.checksTitle = el('summary', '', 'Site checks · فحوص الموقع'); det.appendChild(R.checksTitle)
    R.checks = el('div', 'ssh-det-body'); det.appendChild(R.checks)
    // filters
    var fl = el('div', 'ssh-filters'); fl.setAttribute('role', 'group'); fl.setAttribute('aria-label', 'Filters · الفلاتر')
    R.kind = el('select')
    ;[['all', 'Pages and products · الصفحات والمنتجات'], ['pages', 'Pages · الصفحات'], ['products', 'Products · المنتجات'], ['hidden', 'Hidden products · المنتجات المخفية']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; R.kind.appendChild(op) })
    R.issue = el('select')
    R.q = el('input'); R.q.type = 'search'; R.q.maxLength = 80; R.q.placeholder = 'Name, address or title · الاسم أو العنوان أو الرابط'; R.q.setAttribute('autocomplete', 'off')
    R.clear = el('button', 'ssh-btn ssh-btn--quiet', 'Clear filters · مسح الفلاتر'); R.clear.type = 'button'; R.clear.hidden = true
    R.kind.addEventListener('change', function () { S.f.kind = R.kind.value; S.limit = 50; S.edit = null; renderFilters(); renderTable() })
    R.issue.addEventListener('change', function () { S.f.issue = R.issue.value; S.limit = 50; S.edit = null; renderFilters(); renderTable() })
    var qt = 0
    R.q.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { S.f.q = R.q.value; S.limit = 50; S.edit = null; renderFilters(); renderTable() }, 150) })
    R.clear.addEventListener('click', function () { S.f = { kind: 'all', status: 'all', issue: 'all', q: '' }; R.q.value = ''; S.limit = 50; S.edit = null; renderTiles(); renderFilters(); renderTable() })
    add(fl, fld('Show · عرض', R.kind), fld('Flag · الملاحظة', R.issue), fld('Search · بحث', R.q), R.clear)
    R.sugg = el('div', 'ssh-sugg'); R.sugg.hidden = true
    R.count = el('p', 'ssh-countline')
    var table = el('table', 'ssh-table')
    var thead = el('thead'), htr = el('tr')
    ;['Item · البند', 'Arabic · العربية', 'English · الإنجليزية', 'Share image · صورة المشاركة', 'Flags · الملاحظات'].forEach(function (t) { var th = el('th', '', t); th.scope = 'col'; htr.appendChild(th) })
    var tha = el('th'); tha.scope = 'col'; tha.appendChild(el('span', 'ssh-sr', 'Actions · إجراءات')); htr.appendChild(tha)
    thead.appendChild(htr); R.tbody = el('tbody'); add(table, thead, R.tbody)
    R.empty = el('p', 'ssh-empty', 'Nothing matches these filters. · لا شيء يطابق هذه الفلاتر.'); R.empty.hidden = true
    R.more = el('button', 'ssh-btn', 'Show more · عرض المزيد'); R.more.type = 'button'; R.more.hidden = true
    R.more.addEventListener('click', function () { S.limit += 50; renderTable() })
    var moreWrap = el('div', 'ssh-more'); moreWrap.appendChild(R.more)
    // what the server would have to add
    var needs = el('details', 'ssh-det'), ns = el('summary', '', 'Needs a shop-server update (not built yet) · يحتاج تحديث خادم المتجر (لم يُنجز بعد)'); needs.appendChild(ns)
    var nb = el('div', 'ssh-det-body'), nl = el('ul', 'ssh-needs')
    ;['A sitemap built from the database, so a new or hidden product is in or out of it at once (today it is rebuilt at each release). · خريطة موقع تُبنى من قاعدة البيانات، فيدخل المنتج الجديد أو المخفي إليها أو يخرج منها فورًا (اليوم تُعاد بناؤها مع كل إصدار).',
      'Redirects: when a product is renamed or deleted, send its old address to the new one with a 301. · تحويلات: عند تغيير اسم منتج أو حذفه، يُوجَّه عنوانه القديم إلى الجديد بـ 301.',
      'Search-console verification codes (Google, Bing) as a setting the page head prints. · رموز التحقق في أدوات مشرفي المواقع (Google وBing) كإعداد تطبعه رأس الصفحة.',
      'A per-page “do not index” switch. · مفتاح “عدم الفهرسة” لكل صفحة.'].forEach(function (t) { nl.appendChild(el('li', '', t)) })
    add(nb, el('p', 'ssh-muted', 'These need a change on the shop server, not in this admin. Nothing here pretends to do them. · تحتاج هذه تغييرًا في خادم المتجر، لا في لوحة الإدارة هذه. ولا تدّعي هذه الشاشة تنفيذها.'), nl); needs.appendChild(nb)
    add(R.body, R.tiles, det, fl, R.sugg, R.count, table, R.empty, moreWrap, needs)
    add(wrap, head, R.status, R.err, R.body)
    sec.appendChild(wrap)
    return sec
  }
  function mount() {
    var main = document.querySelector('main.admin-content')
    if (!main) return false
    ensureStyle()
    if (!panel) panel = build()
    if (panel.parentNode !== main) main.appendChild(panel)
    return true
  }
  function openPanel() {
    if (S.open) return
    if (!mount()) return
    S.open = true
    panel.hidden = false
    document.body.setAttribute(OPEN, 'open')
    renderAll()
    load()
    try { R.h1.focus({ preventScroll: true }) } catch (e) { /* focus is a courtesy */ }
  }
  function closePanel(focusBack) {
    if (!S.open) return
    S.open = false; S.edit = null
    if (panel) panel.hidden = true
    document.body.removeAttribute(OPEN)
    if (focusBack) { var b = document.querySelector('[' + BTN + ']'); if (b) { try { b.focus() } catch (e) { /* courtesy */ } } }
  }

  // ------------------------------------------------------------------- entry
  function ensure() {
    var ed = document.querySelector('.seo-editor')
    var head = ed ? ed.querySelector('.admin-page-header') : null
    var have = document.querySelector('[' + BTN + ']')
    if (!head) { if (have) have.remove(); if (S.open) closePanel(false); return }
    ensureStyle()
    if (have && head.contains(have)) { if (S.open && (!panel || !panel.isConnected)) { panel = null; S.open = false; document.body.removeAttribute(OPEN) } return }
    if (have) have.remove()
    var b = el('button', 'ssh-open', 'SEO health · صحة محركات البحث'); b.type = 'button'; b.setAttribute(BTN, '1')
    b.setAttribute('aria-label', 'SEO health: audit every page and product · صحة محركات البحث: فحص كل صفحة ومنتج')
    b.addEventListener('click', openPanel)
    head.appendChild(b)
  }
  // any click on the menu leaves the panel before React handles it
  document.addEventListener('click', function (ev) {
    if (!S.open) return
    var t = ev.target && ev.target.closest ? ev.target.closest(NAV) : null
    if (t) closePanel(false)
  }, true)
  // a MutationObserver on the root flips a dark/light switch into the panel's variables through CSS alone: nothing to do here

  try {
    Object.defineProperty(window, '__sportaSeoHealth', { value: { version: 1, audit: audit, effective: effective, suggest: suggest, bandOf: bandOf, validImage: validImage, IMG_RE: IMG_RE, PAGES: PAGES, GENERIC_DESC: GENERIC_DESC, LIM: LIM, BAND: BAND }, enumerable: false, configurable: false })
  } catch (e) { return }
  function start() {
    setInterval(function () { if (document.hidden) return; try { ensure() } catch (e) { /* the page keeps working without it */ } }, 500)   // a hidden tab has nobody to add a button for
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN SEO HEALTH - end ============================================= */

/* ===== ADMIN FOOTER EDITOR - begin ========================================
 * 10. Footer (owner request 2026-11-11: "make footers editors"). A full-screen editor, opened by the "Footer" button in the
 * header of the Site content screen, where the owner writes the words of the storefront's footer in Arabic and English and sees
 * the footer as a shopper will, at 320 / 390 / 768 / 1280 px, before anything is saved.
 *
 * NO NEW STORAGE AND NO NEW ROUTE. A footer text is an ordinary SITE CONTENT rule, written exactly as the block above writes one:
 *     { page: '*', lang: 'ar' | 'en', match: <the text node the build shows, squashed>, text: <the owner's words> }
 * in settings.site_content.overrides, through the same admin routes (GET content, POST content_save {v, overrides, contact})
 * and applied by the same storefront code (public/sporta-features.js, "SITE CONTENT"), on every page. An empty / original text
 * is "no rule". The call button's label is the one special case (see "THE CALL BUTTON"). Every rule the server keeps about what
 * may be stored (plain text, no price, 2000 characters, 300 rules, 60,000 bytes) is the server's; this block only draws, collects,
 * says no early to a price, and reports.
 *
 * WHAT IS EDITABLE (everything the live footer has that is TEXT): the club band's eyebrow, title, sentence, the "Message us"
 * button and the call button's words; the brand sentence; both column headings and every link label (9 links); the payment chip
 * ("Cash on delivery"); the copyright line and the operator line. Each in both languages, side by side, with the text the shop
 * shows now (the owner's rule if one is saved, else the build's own words, read from the live page), a counter, and Reset.
 * Also the two numbers the club buttons dial: the phone and WhatsApp number (contact.phone / contact.whatsapp of the same
 * document: sporta-features.js points every tel: and wa.me link of the page at them). The social profiles are shown, read only:
 * they are edited in Site content (or its Social media screen), never here.
 *
 * WHAT IT CANNOT DO TODAY (needs an API release, see the report of this change): change where a link GOES (the content layer
 * has no per-link target: the paths are shown, read only), hide an element, reorder links or columns, or scope a rule to the
 * footer. A rule is page-wide: the storefront changes EVERY text node of that exact text, so when the same words appear outside
 * the footer (a header menu item, say) the editor says so on the field, from the live page it reads.
 *
 * HOW IT KNOWS THE LIVE FOOTER. Like "Load texts" in Site content, it opens the storefront home page once per language in an
 * off-screen same-origin iframe with ?sporta_content=off (the storefront script does nothing with that, so the build's ORIGINAL
 * words show), waits until the footer's text stops changing, and reads, per field, the exact text node that a rule must match.
 * A field whose element holds several text nodes (the eyebrow "SPORTA / ...", the copyright line) is matched on the one node
 * that holds the translatable words. The footer is then COPIED (DOM nodes, never markup built from text) into a sandboxed,
 * script-less iframe with the page's own stylesheets: that is the preview, and the typed words are put into it as text nodes.
 * If the page cannot be read (the footer is missing, the request fails) the fields still work from the built-in wording
 * captured 2026-11-03 and are tagged "not checked on the live page"; there is then no preview.
 *
 * SAVING. The editor never sends a stale document: Save first reads the CURRENT document (GET content), changes only the rules of
 * the footer fields it changed (and phone / WhatsApp, if changed), and posts {v, overrides, contact} with the version it just read.
 * Every other rule, in its order, and every other contact value are sent exactly as the server gave them. 409 (someone else saved
 * in between), 401, 429, 413 and every 400 code are worded; a double press saves once.
 *
 * THE CALL BUTTON. The live footer's call button is added by sporta-footer-call.js and its text carries the number, so a rule on
 * it would also need the number. The rule is: match = the whole built-in label ("اتصل بنا 22091914" / "Call us 22091914"), text =
 * the new WORDS only ("كلمنا الآن"); sporta-footer-call.js writes "<words> <number>" (the number follows contact.phone).
 *
 * Opens like the other panels: nodes are only ADDED (one button in the Site content header, one section under <body>), React's nodes
 * are never touched. Off /backends this block does nothing. Everything shown is built with createElement + textContent.
 */
;(function () {   // leading ; - the block above may end in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaFooterEditor) return
  var HOOKS = { version: 1 }
  try { Object.defineProperty(window, '__sportaFooterEditor', { value: HOOKS, enumerable: false, configurable: false }) } catch (e) { return }

  var API = '/api/admin.php'
  var BTN = 'data-sporta-fe-btn'
  var ROOT = 'data-sporta-fe'
  var LANGS = ['ar', 'en']
  var LANG_NAME = { ar: 'Arabic · العربية', en: 'English · الإنجليزية' }
  var WIDTHS = [320, 390, 768, 1280]
  var NUMBER = '22091914'
  var DOC_LIMITS = { overrides: 300 }

  // the groups, in the order of the footer
  var GROUPS = [
    ['club', 'Join the club band · شريط النادي'],
    ['brand', 'Brand · العلامة'],
    ['col1', 'Column 1 · العمود الأول'],
    ['col2', 'Column 2 · العمود الثاني'],
    ['pay', 'Payment chip · وسيلة الدفع'],
    ['legal', 'Legal lines · السطور القانونية']
  ]
  // Every text of the live footer (captured from https://www.sporta.com.kw 2026-11-03, scripts/fixtures/sizes-screen/home-*.html).
  //   sel    where it is, inside the footer;  b  the build's own words;  part  when the element holds several text nodes, the
  //   words of the one node a rule must match;  href  where a link goes (read only);  max  the editor's own limit
  //   (the server's is 2000).
  function F(id, g, sel, max, label, ar, en, extra) {
    var o = { id: id, g: g, sel: sel, max: max, label: label, b: { ar: ar, en: en } }
    if (extra) for (var k in extra) o[k] = extra[k]
    return o
  }
  var LINKS1 = '.footer-links > div:nth-child(1) ul > li:nth-child(', LINKS2 = '.footer-links > div:nth-child(2) ul > li:nth-child('
  var CATALOG = [
    F('club.eyebrow', 'club', '.footer-eyebrow', 40, 'Eyebrow (small line above the title) · السطر الصغير', 'SPORTA / كل يوم أقوى', 'SPORTA / STRONGER EVERY DAY',
      { part: { ar: 'كل يوم أقوى', en: 'STRONGER EVERY DAY' } }),
    F('club.title', 'club', '.footer-club__title', 60, 'Title · العنوان', 'انضم لنادي سبورتا', 'Join the Sporta club'),
    F('club.sub', 'club', '.footer-club__sub', 120, 'Sentence under the title · الجملة تحت العنوان', 'العروض والإصدارات الجديدة — مباشرة على واتساب.', 'Offers and new drops — straight to WhatsApp.'),
    F('club.msg', 'club', 'a.footer-club__action:not(#sporta-footer-call)', 30, 'WhatsApp button · زر واتساب', 'راسلنا', 'Message us', { link: 'wa' }),
    F('club.call', 'club', '#sporta-footer-call', 30, 'Call button, the words (the number is added) · زر الاتصال، الكلمات فقط', 'اتصل بنا', 'Call us',
      { link: 'tel', call: true, full: { ar: 'اتصل بنا ' + NUMBER, en: 'Call us ' + NUMBER } }),
    F('brand.tagline', 'brand', '.footer-brand > p', 200, 'Sentence under the logo · الجملة تحت الشعار', 'موطن الرياضة الفاخرة في الكويت. معدات أداء من أبرز ماركات الرياضة عالميًا.', 'The home of premium sport in Kuwait. Performance gear from the world’s leading sports brands.'),
    F('col1.title', 'col1', '.footer-links > div:nth-child(1) > h2', 30, 'Heading · العنوان', 'معلومات', 'Information'),
    F('col1.l1', 'col1', LINKS1 + '1) > a', 40, 'Link 1 · الرابط 1', 'من نحن', 'About us', { href: '/about' }),
    F('col1.l2', 'col1', LINKS1 + '2) > a', 40, 'Link 2 · الرابط 2', 'لماذا سبورتا؟', 'Why Sporta?', { href: '/about#why' }),
    F('col1.l3', 'col1', LINKS1 + '3) > a', 40, 'Link 3 · الرابط 3', 'الشروط', 'Terms', { href: '/terms' }),
    F('col1.l4', 'col1', LINKS1 + '4) > a', 40, 'Link 4 · الرابط 4', 'الخصوصية', 'Privacy', { href: '/privacy' }),
    F('col2.title', 'col2', '.footer-links > div:nth-child(2) > h2', 30, 'Heading · العنوان', 'التنقل', 'Navigate'),
    F('col2.l1', 'col2', LINKS2 + '1) > a', 40, 'Link 1 · الرابط 1', 'اتصل بنا', 'Contact us', { href: '/contact' }),
    F('col2.l2', 'col2', LINKS2 + '2) > a', 40, 'Link 2 · الرابط 2', 'الشحن', 'Shipping', { href: '/terms#delivery' }),
    F('col2.l3', 'col2', LINKS2 + '3) > a', 40, 'Link 3 · الرابط 3', 'الإرجاع', 'Returns', { href: '/returns' }),
    F('col2.l4', 'col2', LINKS2 + '4) > a', 40, 'Link 4 · الرابط 4', 'تتبع الطلب', 'Track order', { href: '/track' }),
    F('col2.l5', 'col2', LINKS2 + '5) > a', 40, 'Link 5 · الرابط 5', 'حسابي', 'Account', { href: '/account' }),
    F('pay.cod', 'pay', '.footer-payment--cod', 40, 'Cash on delivery chip · وسيلة الدفع عند الاستلام', 'الدفع عند الاستلام', 'Cash on delivery'),
    F('legal.rights', 'legal', '.footer-legal > p:nth-child(1)', 120, 'Copyright line · سطر الحقوق', '© 2026 Sporta — جميع الحقوق محفوظة. · 30199/2023', '© 2026 Sporta — All rights reserved. · 30199/2023',
      { part: { ar: 'جميع الحقوق محفوظة.', en: 'All rights reserved.' }, note: 'If the shop shows this line as one piece, the year and the registration number 30199/2023 are part of it: keep them. · إن ظهر السطر قطعة واحدة فاحتفظ بالسنة ورقم التسجيل.' }),
    F('legal.operator', 'legal', '.footer-legal > p:nth-child(2)', 200, 'Operator line · سطر الشركة المشغلة', 'متجر سبورتا تحت إدارة شركة المهلب لتصميم وبرمجة البرمجيات الخاصة.', 'Sporta is operated by Al-Muhallab Co. for Designing and Programming Special Software.',
      { note: 'This names the company on the bank merchant nomination. Change it only if the company name changes. · يذكر الشركة المسجلة لدى البنك، لا تغيّره إلا إذا تغير اسمها.' })
  ]
  var BY_ID = {}
  CATALOG.forEach(function (f) { BY_ID[f.id] = f })
  var CONTACT_FIELDS = [
    ['phone', 'Phone number the call button dials · الهاتف الذي يتصل به زر الاتصال', 'tel', '+96522091914', 20],
    ['whatsapp', 'WhatsApp number (the message button and the WhatsApp icon) · رقم واتساب', 'tel', '96522091914', 20]
  ]
  var SOCIALS = [['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['snapchat', 'Snapchat'], ['x', 'X']]

  // The server's and the storefront script's rules, written once more (they cannot be imported into a closure file).
  var AD0 = String.fromCharCode(0x660), AD9 = String.fromCharCode(0x669)
  var CUR = '(?:KWD|K\\.?\\s?D\\.?|' + String.fromCharCode(0x62F) + '\\.?\\s?' + String.fromCharCode(0x643) + '\\.?)'
  var DIG = '[0-9' + AD0 + '-' + AD9 + ']'
  var LET = 'A-Za-z' + String.fromCharCode(0x600) + '-' + String.fromCharCode(0x6FF)
  var PRICE = new RegExp('(?:' + DIG + '[0-9' + AD0 + '-' + AD9 + '.,' + String.fromCharCode(0x66B, 0x66C) + ']*\\s*' + CUR + '(?![' + LET + ']))|(?:(?:^|[^' + LET + '])' + CUR + '\\s*' + DIG + ')', 'i')
  var CONTROL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']', 'g')
  var PHONE_RE = /^\+?[0-9]{6,15}$/, WA_RE = /^\+?[0-9]{8,15}$/

  var MSG = {
    not_signed_in: 'Your sign-in has ended. Sign in again, then reopen the footer editor. · انتهت الجلسة، سجّل الدخول من جديد.',
    bad_request: 'The save was refused. Reload the page and try again. · رُفض الحفظ، أعد تحميل الصفحة.',
    request_too_large: 'Too much text in one save. · النص كثير جدًا في حفظ واحد.',
    content_too_large: 'All the site content together is too large to store (about 60,000 bytes). Shorten some texts. · محتوى الموقع أكبر من المسموح.',
    content_changed: 'Site content was changed in another window while you were editing. Press "Discard changes" to load it again, then repeat your change. · تم تعديل المحتوى من نافذة أخرى، أعد التحميل.',
    too_many_content_overrides: 'There are more than 300 text changes in Site content. Remove some there first. · أكثر من 300 تغيير.',
    price_in_content_text: 'A text contains a price (a number with KD / KWD / د.ك). Prices cannot be written here. · لا يمكن كتابة سعر هنا.',
    invalid_content_match: 'The server refused one of the original texts. Reload the editor. · رُفض أحد النصوص الأصلية.',
    too_long_content_text: 'A text is longer than 2000 characters. · نص أطول من 2000 حرف.',
    invalid_contact_phone: 'The phone must be digits, with + in front for the country code. · رقم الهاتف غير صحيح.',
    invalid_contact_whatsapp: 'The WhatsApp number must be the full number with the country code, digits only (96522091914). · رقم واتساب غير صحيح.'
  }
  var NOT_YET = 'Site content is not available on this server yet. Nothing is wrong with your account. · غير متاح على الخادم بعد.'

  // ------------------------------------------------------------------- state
  var S = {
    open: false, loaded: false, loading: false, reading: false, saving: false,
    v: 0, rules: {}, contact: {}, cBase: {}, cDraft: {},
    info: { ar: {}, en: {} }, base: { ar: {}, en: {} }, draft: { ar: {}, en: {} },
    liveOk: { ar: false, en: false }, liveTried: false,
    pLang: 'ar', pW: 390, note: null
  }
  var root = null, refs = null, styleEl = null, opener = null, queued = false, saved = null
  var frames = { ar: null, en: null }, ready = { ar: false, en: false }, pdocs = { ar: null, en: null }, loaderFrames = []
  var seq = 0

  // ----------------------------------------------------------------- helpers
  function el(tag, className, text) {
    var n = document.createElement(tag)
    if (className) n.className = className
    if (text != null) n.textContent = text
    return n
  }
  function squash(s) { return String(s == null ? '' : s).replace(/[ \t\n\r\f\v]+/g, ' ').replace(CONTROL, '').replace(/^ +| +$/g, '') }
  function keyOf(lang, match) { return '*\n' + lang + '\n' + match }
  function asciiDigits(s) { return String(s).replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x0660) }) }
  /** What the server does to a phone / WhatsApp value before it tests it. */
  function cleanNumber(s) { return asciiDigits(s).replace(/[\s\-().]/g, '') }
  function numberError(key, raw) {
    var v = cleanNumber(raw)
    if (v === '') return ''
    if (key === 'phone') return PHONE_RE.test(v) ? '' : MSG.invalid_contact_phone
    return WA_RE.test(v) ? '' : MSG.invalid_contact_whatsapp
  }
  function localNumber(phone) {
    var d = asciiDigits(phone).replace(/[^0-9]/g, '')
    if (d.length === 11 && d.indexOf('965') === 0) return d.slice(3)
    return (String(phone).charAt(0) === '+' ? '+' : '') + d
  }
  function svgIcon(size, paths) {
    var NS = 'http://www.w3.org/2000/svg'
    var s = document.createElementNS(NS, 'svg')
    s.setAttribute('xmlns', NS); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('viewBox', '0 0 24 24')
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.75')
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round')
    s.setAttribute('class', 'sporta-icon inline-block shrink-0 align-middle'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false')
    paths.forEach(function (d) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p) })
    return s
  }
  var ICON = {
    footer: ['M4 4h16v16H4z', 'M4 14h16', 'M8 17.5h3'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    reset: ['M4 12a8 8 0 1 0 2.3-5.6', 'M4 4v4h4']
  }
  function button(cls, label, icon, fn) {
    var b = el('button', 'sfe-btn ' + cls)
    b.type = 'button'
    if (icon) b.appendChild(svgIcon(16, ICON[icon]))
    b.appendChild(document.createTextNode(label))
    if (fn) b.addEventListener('click', fn)
    return b
  }
  function token(b) { var e = b && b.error; return typeof e === 'string' && /^[a-z_]{1,60}$/.test(e) ? e : '' }

  // ------------------------------------------------------------ admin requests
  function request(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, body: j, retryAfter: r.headers.get('Retry-After') } })
    }).catch(function () { return { ok: false, status: 0, body: null, retryAfter: null } })
  }
  function failText(r) {
    var code = token(r.body)
    if (r.status === 0) return 'Could not reach the server. Check the connection and try again. · تعذّر الاتصال بالخادم.'
    if (r.status === 401) return MSG.not_signed_in
    if (r.status === 404) return NOT_YET
    if (r.status === 429) {
      var s = parseInt(r.retryAfter, 10)
      return 'Too many requests. Wait ' + (s > 0 && s < 3600 ? s + ' seconds' : 'a minute') + ', then try again. · طلبات كثيرة، انتظر ثم أعد المحاولة.'
    }
    if (r.status === 409) return MSG.content_changed
    if (MSG[code]) return MSG[code]
    return 'The server could not do that (' + (code || 'HTTP ' + r.status) + ').'
  }

  // ----------------------------------------------------------- field values
  function info(l, id) { return S.info[l][id] }
  function builtin(l, id) { var i = info(l, id); return i ? i.builtin : '' }
  /** The words Save would store for a field: '' means "no rule" (empty, or the build's own words). */
  function ruleText(l, id) {
    var v = squash(S.draft[l][id]), b = squash(builtin(l, id))
    return v === '' || v === b ? '' : v
  }
  function changed(l, id) { return ruleText(l, id) !== (S.base[l][id] || '') }
  function textError(l, id) {
    var v = squash(S.draft[l][id]), f = BY_ID[id]
    if (PRICE.test(v)) return MSG.price_in_content_text
    if (Array.from(v).length > f.max) return 'Longest allowed here: ' + f.max + ' characters. · الحد الأقصى ' + f.max + ' حرفًا.'
    return ''
  }
  function contactChanged(k) { return cleanNumber(S.cDraft[k] || '') !== cleanNumber(S.cBase[k] || '') }
  function dirty() {
    if (!S.loaded) return false
    for (var i = 0; i < CATALOG.length; i++) for (var j = 0; j < 2; j++) if (changed(LANGS[j], CATALOG[i].id)) return true
    return contactChanged('phone') || contactChanged('whatsapp')
  }
  function firstError() {
    for (var i = 0; i < CATALOG.length; i++) for (var j = 0; j < 2; j++) { var e = textError(LANGS[j], CATALOG[i].id); if (e) return e }
    for (var k = 0; k < CONTACT_FIELDS.length; k++) { var n = numberError(CONTACT_FIELDS[k][0], S.cDraft[CONTACT_FIELDS[k][0]] || ''); if (n) return n }
    return ''
  }

  // ------------------------------------------------ the footer, found in a document
  function footerOf(doc) { return doc.querySelector('footer.app-footer') || doc.querySelector('footer.sporta-footer') }
  function nodesOf(e) {
    var out = [], w = e.ownerDocument.createTreeWalker(e, 4, null), n
    while ((n = w.nextNode())) if (squash(n.nodeValue)) out.push(n)
    return out
  }
  /** The element of a field and the ONE text node a rule matches (or null when the footer does not have it). */
  function locate(foot, f, l) {
    var e = foot.querySelector(f.sel)
    if (!e) return null
    var nodes = nodesOf(e)
    if (!nodes.length) return null
    var pick = null, i
    if (nodes.length > 1) {
      var hint = f.part && f.part[l]
      if (hint) for (i = 0; i < nodes.length && !pick; i++) if (squash(nodes[i].nodeValue) === hint) pick = nodes[i]
      if (!pick) { pick = nodes[0]; for (i = 1; i < nodes.length; i++) if (squash(nodes[i].nodeValue).length > squash(pick.nodeValue).length) pick = nodes[i] }
    } else pick = nodes[0]
    var a = e.tagName === 'A' ? e : e.closest('a')
    return { el: e, node: pick, text: squash(pick.nodeValue), multi: nodes.length > 1, href: a ? a.getAttribute('href') || '' : '' }
  }
  /** What a rule must match for a field, and the words shown by default. `hit` is locate()'s answer, or null (page not read). */
  function describe(f, l, hit, outside) {
    var d = { verified: !!hit, multi: !!(hit && hit.multi), href: hit && hit.href ? hit.href : (f.href || ''), collide: 0 }
    if (f.call) { d.match = f.full[l]; d.builtin = f.b[l] }
    else if (hit) { d.match = hit.text; d.builtin = hit.text }
    else { d.match = squash(f.part ? f.part[l] : f.b[l]); d.builtin = d.match }
    d.collide = outside && outside[' ' + d.match] ? outside[' ' + d.match] : 0
    return d
  }
  function seedFallback() {
    LANGS.forEach(function (l) { CATALOG.forEach(function (f) { if (!S.info[l][f.id]) S.info[l][f.id] = describe(f, l, null, null) }) })
  }

  // ---------------------------------------------------- reading the live page
  function dropLoaders() {
    loaderFrames.forEach(function (f) { if (f.parentNode) f.parentNode.removeChild(f) })
    loaderFrames = []
  }
  /** Open the storefront home in a hidden frame and resolve with { doc, foot } once the footer's text has settled, or null. */
  function openLoader(l) {
    return new Promise(function (resolve) {
      var f = document.createElement('iframe')
      f.setAttribute('data-sporta-fe-frame', ''); f.setAttribute('aria-hidden', 'true'); f.setAttribute('tabindex', '-1')
      f.setAttribute('title', 'Storefront page being read')
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin')
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;border:0;visibility:hidden'
      var t0 = Date.now(), sig = '', stable = 0, finished = false
      function end(v) { if (finished) return; finished = true; clearInterval(timer); resolve(v) }
      var timer = setInterval(function () {
        try {
          var doc = f.contentDocument, foot = doc && footerOf(doc)
          if (foot && foot.querySelector('.footer-links')) {
            var now = foot.textContent + '|' + !!foot.querySelector('#sporta-footer-call')
            stable = now === sig ? stable + 1 : 0
            sig = now
            var hasCall = !!foot.querySelector('#sporta-footer-call')
            if (stable >= 3 && (hasCall || Date.now() - t0 > 3000)) return end({ doc: doc, foot: foot, frame: f })
          }
        } catch (e) { return end(null) }
        if (Date.now() - t0 > 15000) end(null)
      }, 250)
      loaderFrames.push(f)
      document.body.appendChild(f)
      f.src = '/?lang=' + l + '&sporta_content=off'
    })
  }
  /** Text nodes outside the footer (and outside scripts / styles), counted by their squashed text. */
  function outsideCounts(doc, foot) {
    var counts = {}, w = doc.createTreeWalker(doc.body, 4, null), n, seen = 0
    while ((n = w.nextNode()) && seen < 20000) {
      seen++
      var p = n.parentNode
      if (!p || foot.contains(n) || (p.closest && p.closest('script,style,noscript,template'))) continue
      var s = squash(n.nodeValue)
      if (s) counts[' ' + s] = (counts[' ' + s] || 0) + 1
    }
    return counts
  }
  function whenFrameReady(l) {
    return new Promise(function (resolve) {
      if (ready[l]) return resolve()
      var f = frames[l]
      if (!f) return resolve()
      f.addEventListener('load', function () { ready[l] = true; resolve() }, { once: true })
    })
  }
  /** Copy the live footer and the page's own stylesheets into the preview frame (DOM nodes, no markup is built from text). */
  function fillPreview(l, doc, foot) {
    return whenFrameReady(l).then(function () {
      var f = frames[l]
      if (!f) return
      var d = f.contentDocument
      if (!d || !d.body) return
      d.documentElement.setAttribute('lang', l); d.documentElement.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr')
      var cls = (doc.documentElement.getAttribute('class') || '').replace(/[^A-Za-z0-9_\- ]/g, '')
      if (cls) d.documentElement.setAttribute('class', cls)
      var waits = []
      Array.prototype.forEach.call(doc.querySelectorAll('link[rel="stylesheet"], style'), function (s) {
        if (s.tagName === 'STYLE') { var st = d.createElement('style'); st.textContent = s.textContent; d.head.appendChild(st); return }
        var u
        try { u = new URL(s.href, location.href) } catch (e) { return }
        if (u.origin !== location.origin) return
        var lk = d.createElement('link'); lk.rel = 'stylesheet'; lk.href = u.href
        waits.push(new Promise(function (ok) { lk.onload = lk.onerror = ok; setTimeout(ok, 4000) }))
        d.head.appendChild(lk)
      })
      var base = d.createElement('style')
      base.textContent = 'html,body{margin:0;background:#fff}body{pointer-events:none}footer.app-footer{margin-top:0!important}'
      d.head.appendChild(base)
      d.body.className = (doc.body.getAttribute('class') || '').replace(/[^A-Za-z0-9_\- ]/g, '')
      var wrap = d.createElement('div')
      var host = foot.closest('.storefront-root')
      wrap.className = host ? (host.getAttribute('class') || '').replace(/[^A-Za-z0-9_\- ]/g, '') : 'storefront-root'
      var copy = d.importNode(foot, true)
      Array.prototype.forEach.call(copy.querySelectorAll('script,iframe,object,embed'), function (x) { x.parentNode.removeChild(x) })
      wrap.appendChild(copy)
      d.body.appendChild(wrap)
      pdocs[l] = d
      return Promise.all(waits)
    })
  }
  function readLive() {
    if (S.liveTried) return Promise.resolve()
    S.liveTried = true
    S.reading = true
    drawAll()
    return readOne('ar').then(function () { return readOne('en') }).then(function () {
      S.reading = false
      dropLoaders()
      drawAll()
    }).catch(function () {
      // a read that throws must not leave Save and Discard disabled until reload: the hidden frames go and the note says so
      S.reading = false
      dropLoaders()
      S.note = { text: 'The shop footer could not be read, so its fields use the built-in wording. Reload the page to try again. · تعذّرت قراءة تذييل المتجر، فحقوله تستخدم النص الأصلي. أعد تحميل الصفحة للمحاولة مرة أخرى.', bad: true }
      drawAll()
    })
  }
  function readOne(l) {
    return openLoader(l).then(function (got) {
      if (!got) { S.note = { text: 'The ' + (l === 'ar' ? 'Arabic' : 'English') + ' storefront page could not be read, so its fields use the built-in wording and are not checked, and there is no preview for it. · تعذّرت قراءة الصفحة.', bad: false }; return }
      var outside = outsideCounts(got.doc, got.foot)
      CATALOG.forEach(function (f) {
        var hit = locate(got.foot, f, l)
        var prev = S.info[l][f.id] ? squash(S.info[l][f.id].builtin) : null
        // the call button is added by a script and can be absent (no phone): its rule is still the built-in label
        S.info[l][f.id] = describe(f, l, hit, outside)
        // the words shown before the page was read were the built-in fallback: an untouched box now shows what the page really says
        if (prev !== null && squash(S.draft[l][f.id]) === prev) S.draft[l][f.id] = S.info[l][f.id].builtin
      })
      S.liveOk[l] = true
      return fillPreview(l, got.doc, got.foot).then(function () { setBase(false) })
    })
  }

  // ------------------------------------------------------------ the document
  function adopt(doc) {
    S.v = typeof doc.v === 'number' ? doc.v : 0
    S.rules = {}
    ;(Array.isArray(doc.overrides) ? doc.overrides : []).forEach(function (o) {
      if (o && o.page === '*' && typeof o.lang === 'string' && typeof o.match === 'string' && typeof o.text === 'string') S.rules[keyOf(o.lang, o.match)] = o.text
    })
    S.contact = doc.contact && typeof doc.contact === 'object' ? doc.contact : {}
    S.cBase = {}; S.cDraft = {}
    CONTACT_FIELDS.forEach(function (c) { var v = typeof S.contact[c[0]] === 'string' ? S.contact[c[0]] : ''; S.cBase[c[0]] = v; S.cDraft[c[0]] = v })
    if (doc.limits && typeof doc.limits.overrides === 'number') DOC_LIMITS.overrides = doc.limits.overrides
    seedFallback()
    setBase(true)
    S.loaded = true
  }
  /** The saved rule of every field (from S.rules) and, when `all` or the field was not edited, its input text. */
  function setBase(all) {
    LANGS.forEach(function (l) {
      CATALOG.forEach(function (f) {
        var i = info(l, f.id)
        if (!i) return
        var was = S.base[l][f.id] || ''
        var rule = S.rules[keyOf(l, i.match)] || ''
        S.base[l][f.id] = rule
        var untouched = S.draft[l][f.id] === undefined || squash(S.draft[l][f.id]) === (was || squash(i.builtin)) || squash(S.draft[l][f.id]) === ''
        if (all || untouched) S.draft[l][f.id] = rule || i.builtin
      })
    })
  }

  // ------------------------------------------------------------------ preview
  function sizePreview() {
    if (!refs) return
    var d = pdocs[S.pLang], f = frames[S.pLang], box = refs.pvBox
    LANGS.forEach(function (l) { if (frames[l]) frames[l].parentNode.hidden = l !== S.pLang })
    refs.pvNone.hidden = !!d
    if (!d || !f) { box.style.height = ''; return }
    var avail = box.clientWidth || S.pW, scale = Math.min(1, avail / S.pW)
    f.style.width = S.pW + 'px'
    var h = 0
    try { h = Math.max(d.documentElement.scrollHeight, d.body.scrollHeight) } catch (e) { h = 600 }
    f.style.height = h + 'px'
    var holder = f.parentNode
    holder.style.width = Math.round(S.pW * scale) + 'px'; holder.style.height = Math.round(h * scale) + 'px'
    f.style.transform = 'scale(' + scale + ')'
    refs.pvInfo.textContent = S.pW + ' px · ' + (scale < 1 ? Math.round(scale * 100) + '% · ' : '') + (S.pLang === 'ar' ? 'Arabic, right to left · العربية' : 'English, left to right · الإنجليزية')
  }
  function effective(l, f) {
    var v = squash(S.draft[l][f.id]) || builtin(l, f.id)
    if (f.call) {
      var phone = cleanNumber(S.cDraft.phone || '')
      return v + ' ' + (PHONE_RE.test(phone) ? localNumber(phone) : NUMBER)
    }
    return v
  }
  function applyPreview(l) {
    var d = pdocs[l]
    if (!d) return
    var foot = footerOf(d)
    if (!foot) return
    CATALOG.forEach(function (f) {
      var hit = locate(foot, f, l)
      if (!hit) return
      var orig = hit.node.nodeValue
      var lead = /^[ \t\n\r\f\v]*/.exec(orig)[0], tail = /[ \t\n\r\f\v]*$/.exec(orig)[0]
      var next = lead + effective(l, f) + (lead.length === orig.length ? '' : tail)
      if (hit.node.nodeValue !== next) hit.node.nodeValue = next
    })
    // the number the buttons dial, as the storefront script will write it
    var phone = cleanNumber(S.cDraft.phone || ''), wa = cleanNumber(S.cDraft.whatsapp || '')
    Array.prototype.forEach.call(foot.querySelectorAll('a[href^="tel:"]'), function (a) { if (PHONE_RE.test(phone)) a.setAttribute('href', 'tel:' + phone) })
    Array.prototype.forEach.call(foot.querySelectorAll('a[href^="https://wa.me/"]'), function (a) { if (WA_RE.test(wa)) a.setAttribute('href', 'https://wa.me/' + wa.replace(/^\+/, '')) })
  }
  function drawPreview() {
    if (!refs) return
    LANGS.forEach(function (l) { applyPreview(l) })
    sizePreview()
    Array.prototype.forEach.call(refs.pvLang.children, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === S.pLang ? 'true' : 'false') })
    Array.prototype.forEach.call(refs.pvW.children, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === String(S.pW) ? 'true' : 'false') })
  }

  // ---------------------------------------------------------------- the panel
  function field(label, control) {
    var w = el('label', 'sfe-field')
    w.appendChild(el('span', 'sfe-lab', label))
    w.appendChild(control)
    return w
  }
  function buildCell(f, l) {
    var long = f.max > 60
    var cell = el('div', 'sfe-cell'); cell.setAttribute('data-lang', l)
    var inp = el(long ? 'textarea' : 'input')
    if (!long) inp.type = 'text'; else inp.rows = 2
    inp.id = 'sfe-' + f.id.replace('.', '-') + '-' + l
    inp.name = inp.id
    inp.setAttribute('lang', l); inp.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr'); inp.autocomplete = 'off'
    inp.setAttribute('data-id', f.id); inp.setAttribute('data-lang', l)
    inp.maxLength = f.max + 40            // typing past the limit is allowed (so a paste is not cut silently) and then flagged
    var lab = el('label', 'sfe-lab', LANG_NAME[l]); lab.setAttribute('for', inp.id)
    var meta = el('div', 'sfe-meta')
    var count = el('span', 'sfe-count'); count.setAttribute('data-role', 'count')
    var tags = el('span', 'sfe-tags'); tags.setAttribute('data-role', 'tags')
    var reset = button('sfe-btn--small', 'Reset · استعادة', 'reset', function () {
      S.draft[l][f.id] = builtin(l, f.id)
      inp.value = S.draft[l][f.id]
      drawCell(f, l); drawFoot(); drawPreview()
    })
    reset.setAttribute('data-role', 'reset'); reset.setAttribute('aria-label', 'Reset to the shop’s own text: ' + f.label.split(' · ')[0] + ' (' + (l === 'ar' ? 'Arabic' : 'English') + ')')
    var err = el('p', 'sfe-err'); err.setAttribute('role', 'alert'); err.hidden = true; err.setAttribute('data-role', 'err')
    inp.addEventListener('input', function () { S.draft[l][f.id] = inp.value; drawCell(f, l); drawFoot(); drawPreview() })
    meta.appendChild(count); meta.appendChild(reset)
    cell.appendChild(lab); cell.appendChild(inp); cell.appendChild(meta); cell.appendChild(tags); cell.appendChild(err)
    refs.cells[f.id + '|' + l] = { cell: cell, inp: inp, count: count, tags: tags, reset: reset, err: err }
    return cell
  }
  function buildField(f) {
    var row = el('div', 'sfe-row'); row.setAttribute('data-id', f.id)
    var h = el('div', 'sfe-rowhead')
    h.appendChild(el('strong', 'sfe-rowname', f.label))
    var where = el('span', 'sfe-path'); where.setAttribute('data-role', 'path')
    h.appendChild(where)
    row.appendChild(h)
    var pair = el('div', 'sfe-pair')
    LANGS.forEach(function (l) { pair.appendChild(buildCell(f, l)) })
    row.appendChild(pair)
    if (f.note) row.appendChild(el('p', 'sfe-hint', f.note))
    refs.rows[f.id] = { row: row, where: where }
    return row
  }
  function buildContactCard() {
    var c = el('div', 'sfe-sub')
    c.appendChild(el('h4', '', 'Numbers the buttons use · أرقام الأزرار'))
    c.appendChild(el('p', 'sfe-hint', 'These are the shop’s contact numbers (Site content → Contact). Every phone and WhatsApp link of the shop follows them, not only the footer. · هذه أرقام التواصل، وكل روابط الهاتف وواتساب في المتجر تتبعها.'))
    var g = el('div', 'sfe-pair')
    CONTACT_FIELDS.forEach(function (cf) {
      var inp = el('input'); inp.type = 'text'; inp.inputMode = 'tel'; inp.name = 'sfe_' + cf[0]; inp.id = 'sfe-contact-' + cf[0]; inp.maxLength = cf[4] + 20
      inp.placeholder = cf[3]; inp.setAttribute('dir', 'ltr'); inp.autocomplete = 'off'
      var err = el('p', 'sfe-err'); err.setAttribute('role', 'alert'); err.hidden = true
      inp.addEventListener('input', function () { S.cDraft[cf[0]] = inp.value; drawContact(); drawFoot(); drawPreview() })
      var w = field(cf[1], inp); w.appendChild(err)
      refs.contact[cf[0]] = { inp: inp, err: err }
      g.appendChild(w)
    })
    c.appendChild(g)
    refs.socials = el('p', 'sfe-hint')
    c.appendChild(refs.socials)
    var go = button('sfe-btn--small', 'Open Site content to change the social links · افتح محتوى الموقع لتغيير حسابات التواصل', null, function () {
      closeEditor(true)
      var nav = document.querySelector('[data-sporta-sc-nav]')
      if (nav) nav.click()
    })
    go.setAttribute('data-role', 'to-content')
    c.appendChild(go)
    return c
  }
  function buildRoot() {
    var sec = el('section', 'sfe')
    sec.setAttribute(ROOT, ''); sec.hidden = true
    sec.setAttribute('role', 'dialog'); sec.setAttribute('aria-modal', 'true'); sec.setAttribute('aria-labelledby', 'sfe-title')
    var box = el('div', 'sfe-box')
    sec.appendChild(box)
    refs = { root: sec, box: box, cells: {}, rows: {}, contact: {} }

    var head = el('header', 'sfe-head')
    var t = el('div', 'sfe-headtext')
    var h = el('h2', 'sfe-title'); h.id = 'sfe-title'; h.tabIndex = -1
    h.appendChild(svgIcon(20, ICON.footer)); h.appendChild(document.createTextNode(' Footer · التذييل'))
    t.appendChild(h)
    t.appendChild(el('p', 'sfe-lead', 'Write the words of the shop’s footer in both languages and see it before you save. Prices cannot be written here. · اكتب نصوص تذييل المتجر باللغتين وشاهدها قبل الحفظ. لا يمكن كتابة الأسعار هنا.'))
    head.appendChild(t)
    refs.close = button('sfe-btn--small', 'Close · إغلاق', 'close', function () { closeEditor(false) })
    refs.close.setAttribute('data-role', 'close')
    head.appendChild(refs.close)
    box.appendChild(head)
    refs.status = el('p', 'sfe-status'); refs.status.setAttribute('role', 'status'); refs.status.setAttribute('aria-live', 'polite')
    box.appendChild(refs.status)

    var body = el('div', 'sfe-body')
    var main = el('div', 'sfe-main')
    GROUPS.forEach(function (g) {
      var card = el('section', 'sfe-card'); card.setAttribute('data-group', g[0])
      card.appendChild(el('h3', '', g[1]))
      CATALOG.forEach(function (f) { if (f.g === g[0]) card.appendChild(buildField(f)) })
      if (g[0] === 'club') card.appendChild(buildContactCard())
      main.appendChild(card)
    })
    body.appendChild(main)

    var side = el('aside', 'sfe-side'); side.setAttribute('aria-label', 'Preview · المعاينة')
    var pv = el('section', 'sfe-card sfe-preview')
    pv.appendChild(el('h3', '', 'Preview · المعاينة'))
    var ctl = el('div', 'sfe-ctl')
    refs.pvLang = el('div', 'sfe-seg'); refs.pvLang.setAttribute('role', 'group'); refs.pvLang.setAttribute('aria-label', 'Preview language · لغة المعاينة')
    LANGS.forEach(function (l) {
      var b = button('sfe-btn--seg', l === 'ar' ? 'العربية' : 'English', null, function () { S.pLang = l; drawPreview() })
      b.setAttribute('data-v', l); refs.pvLang.appendChild(b)
    })
    refs.pvW = el('div', 'sfe-seg'); refs.pvW.setAttribute('role', 'group'); refs.pvW.setAttribute('aria-label', 'Preview width · عرض المعاينة')
    WIDTHS.forEach(function (w) {
      var b = button('sfe-btn--seg', String(w), null, function () { S.pW = w; drawPreview() })
      b.setAttribute('data-v', String(w)); b.setAttribute('aria-label', w + ' pixels wide'); refs.pvW.appendChild(b)
    })
    ctl.appendChild(refs.pvLang); ctl.appendChild(refs.pvW)
    pv.appendChild(ctl)
    refs.pvInfo = el('p', 'sfe-hint'); pv.appendChild(refs.pvInfo)
    refs.pvBox = el('div', 'sfe-pvbox')
    LANGS.forEach(function (l) {
      var holder = el('div', 'sfe-pvhold')
      var f = document.createElement('iframe')
      f.setAttribute('data-sporta-fe-pf', l); f.setAttribute('title', 'Footer preview, ' + (l === 'ar' ? 'Arabic' : 'English'))
      f.setAttribute('sandbox', 'allow-same-origin')          // no scripts at all; same-origin only so this editor can write the text nodes
      f.setAttribute('tabindex', '-1'); f.setAttribute('scrolling', 'no')
      f.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'
      f.addEventListener('load', function () { ready[l] = true })
      frames[l] = f
      holder.appendChild(f)
      refs.pvBox.appendChild(holder)
    })
    refs.pvNone = el('p', 'sfe-hint', 'There is no preview until the shop’s page has been read. · لا توجد معاينة قبل قراءة صفحة المتجر.')
    pv.appendChild(refs.pvBox); pv.appendChild(refs.pvNone)
    side.appendChild(pv)
    body.appendChild(side)
    box.appendChild(body)

    var foot = el('footer', 'sfe-foot')
    refs.save = button('sfe-btn--primary', 'Update footer · تحديث التذييل', null, function () { save() })
    refs.save.setAttribute('data-role', 'save')
    refs.discard = button('', 'Discard changes · تجاهل التغييرات', null, function () { discard() })
    refs.discard.setAttribute('data-role', 'discard')
    refs.dirty = el('span', 'sfe-dirty')
    foot.appendChild(refs.save); foot.appendChild(refs.discard); foot.appendChild(refs.dirty)
    box.appendChild(foot)
    return sec
  }

  // --------------------------------------------------------------------- draw
  function drawCell(f, l) {
    var c = refs.cells[f.id + '|' + l], i = info(l, f.id)
    if (!c || !i) return
    var v = squash(S.draft[l][f.id]), len = Array.from(v).length
    c.count.textContent = len + ' / ' + f.max
    c.count.toggleAttribute('data-over', len > f.max)
    var err = textError(l, f.id)
    c.err.textContent = err; c.err.hidden = !err
    if (err) c.inp.setAttribute('aria-invalid', 'true'); else c.inp.removeAttribute('aria-invalid')
    var edited = changed(l, f.id), has = !!(S.base[l][f.id] || ruleText(l, f.id))
    c.reset.disabled = S.saving || !(has || edited || (squash(S.draft[l][f.id]) !== squash(i.builtin)))
    c.tags.textContent = ''
    function tag(cls, text) { c.tags.appendChild(el('span', 'sfe-tag ' + cls, text)) }
    if (edited) tag('sfe-tag--new', 'Edited, not saved yet · مُعدّل ولم يُحفظ')
    else if (S.base[l][f.id]) tag('sfe-tag--new', 'Customised · مخصص')
    if (!i.verified) tag('', 'Not checked on the live page · لم يُتحقق منه')
    if (i.multi) tag('', 'Only this part of the line changes · يتغير هذا الجزء فقط')
    if (i.collide) tag('sfe-tag--warn', 'The same words also appear elsewhere on the page and will change there too · النص نفسه يظهر في مكان آخر وسيتغير هناك أيضًا')
    c.inp.disabled = S.reading || S.saving || !S.loaded
  }
  function drawRowHead(f) {
    var r = refs.rows[f.id]
    var a = info('ar', f.id), e = info('en', f.id), href = (e && e.href) || (a && a.href) || f.href || ''
    var text = ''
    if (f.call) text = 'Dials the phone number below · يتصل بالرقم أدناه'
    else if (f.link === 'wa') text = 'Opens WhatsApp (number below) · يفتح واتساب'
    else if (href) text = 'Goes to ' + href + ' (fixed: changing a link’s path needs a server update) · الوجهة ثابتة'
    r.where.textContent = text
    r.where.hidden = !text
  }
  function drawContact() {
    CONTACT_FIELDS.forEach(function (cf) {
      var c = refs.contact[cf[0]]
      if (document.activeElement !== c.inp && c.inp.value !== (S.cDraft[cf[0]] || '')) c.inp.value = S.cDraft[cf[0]] || ''
      var e = numberError(cf[0], S.cDraft[cf[0]] || '')
      c.err.textContent = e; c.err.hidden = !e
      c.inp.disabled = S.saving || !S.loaded
      if (e) c.inp.setAttribute('aria-invalid', 'true'); else c.inp.removeAttribute('aria-invalid')
    })
    var parts = SOCIALS.map(function (s) { var v = typeof S.contact[s[0]] === 'string' ? S.contact[s[0]] : ''; return s[1] + ': ' + (v ? v.replace(/^https:\/\/(www\.)?[a-z.]+\/(add\/)?/, '') : '—') })
    refs.socials.textContent = 'Social links (read only here): ' + parts.join(' · ')
  }
  function drawFoot() {
    if (!refs) return
    var d = dirty(), bad = firstError()
    refs.save.disabled = S.saving || !S.loaded || S.reading || !d || !!bad
    refs.save.textContent = S.saving ? 'Updating… · جارٍ التحديث…' : 'Update footer · تحديث التذييل'
    refs.discard.disabled = S.saving || S.loading || S.reading || !S.loaded
    refs.dirty.textContent = !S.loaded ? '' : bad ? bad : d ? 'You have changes that are not saved. · لديك تغييرات غير محفوظة.' : 'Everything is saved. · كل شيء محفوظ.'
    if (bad) refs.dirty.setAttribute('data-bad', '1'); else refs.dirty.removeAttribute('data-bad')
  }
  function drawStatus() {
    var n = S.note
    if (!n && S.reading) n = { text: 'Reading the shop’s footer… · جارٍ قراءة تذييل المتجر…', bad: false }
    if (!n && S.loading) n = { text: 'Loading… · جارٍ التحميل…', bad: false }
    refs.status.textContent = n ? n.text : ''
    if (n && n.bad) refs.status.setAttribute('data-bad', '1'); else refs.status.removeAttribute('data-bad')
  }
  function drawAll() {
    if (!refs) return
    CATALOG.forEach(function (f) {
      drawRowHead(f)
      LANGS.forEach(function (l) {
        var c = refs.cells[f.id + '|' + l]
        if (c && document.activeElement !== c.inp && c.inp.value !== (S.draft[l][f.id] || '')) c.inp.value = S.draft[l][f.id] || ''
        drawCell(f, l)
      })
    })
    drawContact(); drawStatus(); drawFoot(); drawPreview()
  }

  // --------------------------------------------------------------- load / save
  function load() {
    if (S.loading) return
    S.loading = true; S.note = null
    drawAll()
    request('content').then(function (r) {
      S.loading = false
      if (r.ok && r.body && typeof r.body === 'object' && Array.isArray(r.body.overrides)) {
        adopt(r.body); S.note = null
        drawAll()
        readLive()
      } else { S.note = { text: failText(r), bad: true }; drawAll() }
    })
  }
  function discard() {
    if (S.saving || !S.loaded) return
    S.loaded = false
    LANGS.forEach(function (l) { S.draft[l] = {} })
    load()
  }
  /** The document Save posts: the server's own current document, with only the footer's changes put into it. */
  function buildBody(fresh) {
    var rules = (Array.isArray(fresh.overrides) ? fresh.overrides : []).map(function (o) { return { page: o.page, lang: o.lang, match: o.match, text: o.text } })
    LANGS.forEach(function (l) {
      CATALOG.forEach(function (f) {
        if (!changed(l, f.id)) return
        var match = info(l, f.id).match, text = ruleText(l, f.id), at = -1
        rules.forEach(function (o, i) { if (at < 0 && o.page === '*' && o.lang === l && o.match === match) at = i })
        if (!text) { if (at >= 0) rules.splice(at, 1) }
        else if (at >= 0) rules[at].text = text
        else rules.push({ page: '*', lang: l, match: match, text: text })
      })
    })
    var contact = {}, fc = fresh.contact && typeof fresh.contact === 'object' ? fresh.contact : {}
    for (var k in fc) if (Object.prototype.hasOwnProperty.call(fc, k)) contact[k] = fc[k]
    ;['phone', 'whatsapp'].forEach(function (k2) { if (contactChanged(k2)) contact[k2] = cleanNumber(S.cDraft[k2]) })
    return { v: fresh.v, overrides: rules, contact: contact }
  }
  function save() {
    if (S.saving || !S.loaded || S.reading) return
    var bad = firstError()
    if (bad) { S.note = { text: bad, bad: true }; drawAll(); return }
    if (!dirty()) return
    S.saving = true; S.note = { text: 'Saving… · جارٍ الحفظ…', bad: false }
    drawAll()
    var fail = function (r) { S.saving = false; S.note = { text: failText(r), bad: true }; drawAll() }
    request('content').then(function (cur) {
      if (!(cur.ok && cur.body && typeof cur.body === 'object' && Array.isArray(cur.body.overrides) && typeof cur.body.v === 'number')) return fail(cur)
      var body = buildBody(cur.body)
      if (body.overrides.length > DOC_LIMITS.overrides) return fail({ status: 400, body: { error: 'too_many_content_overrides' } })
      return request('content_save', body).then(function (r) {
        if (!(r.ok && r.body && typeof r.body === 'object' && Array.isArray(r.body.overrides))) return fail(r)
        S.saving = false
        adopt(r.body)
        // the saved document is the baseline; what is in the boxes is what was saved
        LANGS.forEach(function (l) { CATALOG.forEach(function (f) { S.draft[l][f.id] = (S.base[l][f.id] || builtin(l, f.id)) }) })
        S.note = { text: 'Saved. Shoppers see it the next time they open a page. · تم الحفظ. يظهر للزوار عند فتح الصفحة التالية.', bad: false }
        drawAll()
      })
    })
  }

  // -------------------------------------------------------------- open / close
  var CSS = [
    '.sfe{--sfe-bg:#fff;--sfe-soft:#f7f5f3;--sfe-line:#ddd6d0;--sfe-edge:#857b74;--sfe-text:#1f1a17;--sfe-muted:#5d544d;--sfe-action:var(--admin-action,#9a452c);--sfe-on-action:#fff;--sfe-new:#7a3420;--sfe-new-bg:#f6e4dc;--sfe-err:#b42318;--sfe-shade:rgba(20,14,10,.45)}',
    ':is(html.dark,html[data-theme="dark"]) .sfe{color-scheme:dark;--sfe-bg:#171412;--sfe-soft:#1e1a17;--sfe-line:#37302b;--sfe-edge:#8d837b;--sfe-text:#f1ebe6;--sfe-muted:#b3a89f;--sfe-action:#e2a48e;--sfe-on-action:#1b1210;--sfe-new:#f0bba8;--sfe-new-bg:#3a241b;--sfe-err:#fda4af;--sfe-shade:rgba(0,0,0,.6)}',
    '.sfe{position:fixed;inset:0;z-index:70;display:flex;align-items:stretch;justify-content:center;background:var(--sfe-shade);font:400 .875rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--sfe-text)}',
    '.sfe[hidden]{display:none!important}',
    '.sfe *,.sfe *::before,.sfe *::after{box-sizing:border-box}',
    '.sfe-box{display:flex;flex-direction:column;width:100%;max-width:90rem;min-height:0;background:var(--sfe-bg);overflow:hidden}',
    '@media (min-width:1100px){.sfe{padding:1rem}.sfe-box{border-radius:1rem;border:1px solid var(--sfe-line)}}',
    '.sfe-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;padding:.875rem 1rem;border-bottom:1px solid var(--sfe-line)}',
    '.sfe-headtext{min-width:0;flex:1}',
    '.sfe-head>.sfe-btn{flex-shrink:0;white-space:nowrap}',
    '.sfe-title{margin:0;display:flex;align-items:center;gap:.25rem;font-size:1.25rem;font-weight:700;line-height:1.3;color:var(--sfe-text)}',
    '.sfe-title:focus,.sfe-title:focus-visible{outline:none}',
    '.sfe-lead,.sfe-hint{margin:0;color:var(--sfe-muted)}',
    '.sfe-status{margin:0;min-height:1.5rem;padding:.25rem 1rem 0;font-weight:600;color:var(--sfe-muted)}',
    '.sfe-status[data-bad="1"]{color:var(--sfe-err)}',
    '.sfe-body{flex:1;min-height:0;overflow:auto;display:grid;gap:1rem;align-content:start;padding:1rem;grid-template-columns:minmax(0,1fr)}',
    '@media (min-width:1000px){.sfe-body{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);align-items:start}.sfe-side{position:sticky;top:0}}',
    '.sfe-main{display:grid;gap:1rem;min-width:0}',
    '.sfe-card{display:grid;gap:.75rem;min-width:0;padding:.875rem;border:1px solid var(--sfe-line);border-radius:.875rem;background:var(--sfe-soft)}',
    '.sfe-card h3{margin:0;font-size:1rem;font-weight:700;color:var(--sfe-text)}',
    '.sfe-sub{display:grid;gap:.5rem;padding-top:.75rem;border-top:1px solid var(--sfe-line)}',
    '.sfe-sub h4{margin:0;font-size:.9375rem;font-weight:700}',
    '.sfe-row{display:grid;gap:.375rem;min-width:0;padding:.625rem .75rem;border:1px solid var(--sfe-line);border-radius:.75rem;background:var(--sfe-bg)}',
    '.sfe-rowhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:.25rem .75rem}',
    '.sfe-rowname{font-weight:700;overflow-wrap:anywhere}',
    '.sfe-path{font-size:.75rem;color:var(--sfe-muted);overflow-wrap:anywhere;unicode-bidi:plaintext}',
    '.sfe-pair{display:grid;gap:.625rem;grid-template-columns:minmax(0,1fr)}',
    '@container (min-width:34rem){.sfe-pair{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '.sfe-main{container-type:inline-size}',
    '.sfe-cell,.sfe-field{display:grid;gap:.25rem;min-width:0;align-content:start}',
    '.sfe-lab{font-size:.8125rem;font-weight:700;color:var(--sfe-muted)}',
    '.sfe :is(input,textarea,button){font:inherit}',
    '.sfe :is(input[type="text"],textarea){width:100%;min-height:2.75rem;padding:.375rem .625rem;border:1px solid var(--sfe-edge);border-radius:.75rem;color:var(--sfe-text);background:var(--sfe-bg);box-shadow:none;line-height:1.5}',
    '.sfe textarea{resize:vertical}',
    '.sfe :is(input,textarea)[aria-invalid="true"]{border-color:var(--sfe-err)}',
    '.sfe :is(input,textarea):disabled{background:var(--sfe-soft);color:var(--sfe-muted);cursor:not-allowed}',
    '.sfe :is(button,input,textarea):focus-visible{outline:2px solid var(--sfe-action);outline-offset:2px}',
    '.sfe-meta{display:flex;align-items:center;justify-content:space-between;gap:.5rem}',
    '.sfe-count{font-size:.75rem;color:var(--sfe-muted)}',
    '.sfe-count[data-over]{color:var(--sfe-err);font-weight:700}',
    '.sfe-tags{display:flex;flex-wrap:wrap;gap:.25rem}',
    '.sfe-tag{padding:.125rem .5rem;border-radius:999px;border:1px solid var(--sfe-line);background:var(--sfe-soft);color:var(--sfe-muted);font-size:.75rem;font-weight:600}',
    '.sfe-tag--new,.sfe-tag--warn{background:var(--sfe-new-bg);border-color:transparent;color:var(--sfe-new)}',
    '.sfe-err{margin:0;color:var(--sfe-err);font-weight:600}',
    '.sfe-btn{display:inline-flex;align-items:center;justify-content:center;gap:.375rem;min-height:2.75rem;min-width:2.75rem;padding:.5rem 1rem;border:1px solid var(--sfe-edge);border-radius:.75rem;background:var(--sfe-bg);color:var(--sfe-text);font-weight:600;line-height:1.25;text-align:center;cursor:pointer}',
    '.sfe-btn:hover:not(:disabled){border-color:var(--sfe-text)}',
    '.sfe-btn--small{padding:.25rem .75rem;font-size:.8125rem}',
    '.sfe-btn--primary{background:var(--sfe-action);border-color:transparent;color:var(--sfe-on-action);font-weight:700}',
    '.sfe-btn--primary:hover:not(:disabled){border-color:transparent;filter:brightness(.92)}',
    '.sfe-btn:disabled{cursor:not-allowed;background:var(--sfe-soft);border-color:var(--sfe-line);color:var(--sfe-muted)}',
    '.sfe-btn--seg{padding:.25rem .75rem}',
    '.sfe-btn--seg[aria-pressed="true"]{background:var(--sfe-action);border-color:transparent;color:var(--sfe-on-action)}',
    '.sfe-ctl{display:flex;flex-wrap:wrap;gap:.5rem}',
    '.sfe-seg{display:flex;flex-wrap:wrap;gap:.25rem}',
    '.sfe-pvbox{min-width:0;max-width:100%;overflow:hidden;border:1px solid var(--sfe-line);border-radius:.75rem;background:var(--sfe-bg);direction:ltr}',
    '.sfe-pvhold{overflow:hidden;margin-inline:auto}',
    '.sfe-pvhold iframe{display:block;border:0;background:#fff;transform-origin:0 0}',
    '.sfe-foot{display:flex;flex-wrap:wrap;align-items:center;gap:.625rem;padding:.75rem 1rem;border-top:1px solid var(--sfe-line);background:var(--sfe-bg)}',
    '.sfe-dirty{font-weight:600;color:var(--sfe-muted)}',
    '.sfe-dirty[data-bad="1"]{color:var(--sfe-err)}',
    '[' + BTN + ']{display:inline-flex;align-items:center;gap:.375rem;min-height:2.75rem;padding:.5rem 1rem;border:1px solid var(--ssc-edge,#857b74);border-radius:.75rem;background:var(--ssc-bg,#fff);color:var(--ssc-text,#1f1a17);font:inherit;font-weight:600;cursor:pointer}',
    '[' + BTN + ']:hover{border-color:var(--ssc-text,#1f1a17)}',
    '[' + BTN + ']:focus-visible{outline:2px solid var(--admin-action,#9a452c);outline-offset:2px}',
    'body[data-sporta-fe="open"]{overflow:hidden}'
  ].join('\n')
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return
    styleEl = document.createElement('style')
    styleEl.setAttribute('data-sporta-fe-style', '')
    styleEl.textContent = CSS
    document.head.appendChild(styleEl)
  }
  function ensureRoot() {
    if (root && root.isConnected) return
    root = buildRoot()
    document.body.appendChild(root)
  }
  function focusables() {
    return Array.prototype.filter.call(root.querySelectorAll('button,input,textarea,a[href]'), function (n) { return !n.disabled && n.offsetParent !== null })
  }
  function openEditor(from) {
    ensureStyle(); ensureRoot()
    if (S.open) return
    opener = from || document.activeElement
    S.open = true
    root.hidden = false
    document.body.setAttribute(ROOT, 'open')
    var h = document.getElementById('sfe-title')
    if (h) { try { h.focus({ preventScroll: true }) } catch (e) { /* no focus */ } }
    S.loaded = false
    LANGS.forEach(function (l) { S.draft[l] = {} })
    load()
    setTimeout(drawPreview, 0)
  }
  function closeEditor(force) {
    if (!S.open) return
    if (!force && dirty() && !window.confirm('Close without saving your footer changes? · إغلاق دون حفظ التغييرات؟')) return
    S.open = false
    root.hidden = true
    document.body.removeAttribute(ROOT)
    S.note = null
    if (opener && opener.isConnected && !force) { try { opener.focus() } catch (e) { /* gone */ } }
  }
  document.addEventListener('keydown', function (e) {
    if (!S.open || !root) return
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); return }
    if (e.key === 'Tab') {
      var list = focusables()
      if (!list.length) return
      var first = list[0], last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      else if (!root.contains(document.activeElement)) { e.preventDefault(); first.focus() }
    }
  })
  window.addEventListener('beforeunload', function (e) { if (S.open && dirty()) { e.preventDefault(); e.returnValue = '' } })
  window.addEventListener('resize', function () { if (S.open) sizePreview() })

  // ------------------------------------------------- the entry on Site content
  function scan() {
    if (location.pathname.indexOf('/backends') !== 0) return
    var head = document.querySelector('[data-sporta-content] .ssc-form > header')
    var have = document.querySelector('[' + BTN + ']')
    if (!head) { if (have && !S.open) have.remove(); return }
    if (have && have.isConnected && head.contains(have)) return
    if (have) have.remove()
    ensureStyle()
    var b = document.createElement('button')
    b.type = 'button'; b.setAttribute(BTN, '1')
    b.appendChild(svgIcon(17, ICON.footer)); b.appendChild(document.createTextNode('Footer · التذييل'))
    b.addEventListener('click', function () { openEditor(b) })
    head.appendChild(b)
  }
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; try { scan() } catch (e) { /* never break the admin */ } })
  }
  function start() {
    schedule()
    new MutationObserver(function (muts) {
      if (root) {
        var outside = false
        for (var i = 0; i < muts.length; i++) if (!root.contains(muts[i].target) && muts[i].target !== document.body) { outside = true; break }
        if (!outside) return
      }
      schedule()
    }).observe(document.body, { childList: true, subtree: true })
  }
  HOOKS.catalog = CATALOG.map(function (f) { return { id: f.id, g: f.g, sel: f.sel, max: f.max, b: f.b, part: f.part || null, full: f.full || null, call: !!f.call } })
  HOOKS.price = PRICE
  HOOKS.cleanNumber = cleanNumber
  HOOKS.numberError = numberError
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN FOOTER EDITOR - end ========================================== */

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
  var LABEL_BI = { unpaid: 'Unpaid · غير مدفوع', expired: 'Expired · منتهٍ', declined: 'Declined · مرفوض', cod_expired: 'Cash not confirmed · نقد غير مؤكد', waiting: 'Waiting · بانتظار الدفع', cancelled: 'Cancelled by shop · ألغاه المتجر' }
  var WHY = {
    unpaid: 'Left the bank page without paying. · غادر صفحة البنك دون أن يدفع.',
    expired: 'Not paid within the hold time; the stock goes (or went) back on the shelf. · لم يُدفع خلال مدة الحجز؛ يعود المخزون (أو عاد) إلى الرف.',
    declined: 'The bank refused it, or the shopper backed out. · رفض البنك العملية، أو تراجع العميل.',
    cod_expired: 'Cash order nobody confirmed in time. · طلب نقدي لم يؤكّده أحد في الوقت المحدد.',
    waiting: 'Started recently. The shopper may still be paying. · بُدئ به مؤخرًا. قد يكون العميل ما زال يدفع.',
    cancelled: 'Cancelled by the shop before its hold ran out. · ألغاه المتجر قبل انتهاء مدة الحجز.'
  }
  var STATES = [['contacted', 'Contacted'], ['not_interested', 'Not interested'], ['wrong_number', 'Wrong number'], ['recovered_manually', 'Recovered by me']]
  var STATE_AR = { contacted: 'تم التواصل', not_interested: 'غير مهتم', wrong_number: 'رقم خاطئ', recovered_manually: 'استعدته بنفسي' }
  var STATE_LABEL = {}
  STATES.forEach(function (s) { STATE_LABEL[s[0]] = s[1] })
  var METHOD = { knet: 'KNET', tpay: 'T-Pay', cod: 'Cash' }
  var NOT_YET = 'Abandoned orders is not available until the next update of the shop server. Nothing is wrong with your account. · الطلبات المتروكة غير متاحة قبل التحديث القادم لخادم المتجر. لا خطأ في حسابك.'
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
  // Arabic counts have five cases: 1, 2 (dual), 3-10 (plural), 11 and up (singular again), restarting each hundred. forms = [one, two, few, many].
  function arCount(n, forms) { n = Math.floor(Math.abs(Number(n)) || 0); var m = n % 100; return n === 1 ? forms[0] : n === 2 ? forms[1] : (m >= 3 && m <= 10) ? forms[2] : forms[3] }
  var AR_ORDER = ['طلب', 'طلبان', 'طلبات', 'طلبًا'], AR_ABANDONED = ['طلب متروك', 'طلبان متروكان', 'طلبات متروكة', 'طلبًا متروكًا']
  var AR_PIECE = ['قطعة', 'قطعتان', 'قطع', 'قطعة'], AR_MIN = ['دقيقة', 'دقيقتان', 'دقائق', 'دقيقة'], AR_HOUR = ['ساعة', 'ساعتان', 'ساعات', 'ساعة'], AR_DAY = ['يوم', 'يومان', 'أيام', 'يومًا']
  var AR_SECOND = ['ثانية', 'ثانيتان', 'ثوانٍ', 'ثانية']
  function kd(v) { var n = Number(v); return (isFinite(n) ? n : 0).toFixed(3) + ' KD' }
  function whole(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.floor(n) : 0 }
  function clean(s, max) {
    // The bidi override / embedding / isolate controls (U+202A-U+202E, U+2066-U+2069) are dropped from every customer text shown or
    // exported: a name that opens one and never closes it reverses its own cell on screen ("ok" + RLO + "gnirts 1234" reads
    // "ok4321 string") and in a spreadsheet. LRM, RLM and ALM stay: Arabic text uses them.
    // The cut is by code point, not UTF-16 unit, so an emoji at the cut point is not split into a broken character.
    return Array.from(String(s == null ? '' : s).replace(/[\u202a-\u202e\u2066-\u2069]/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, max || 200).join('')
  }
  var MONTHS = ['Jan · يناير', 'Feb · فبراير', 'Mar · مارس', 'Apr · أبريل', 'May · مايو', 'Jun · يونيو', 'Jul · يوليو', 'Aug · أغسطس', 'Sep · سبتمبر', 'Oct · أكتوبر', 'Nov · نوفمبر', 'Dec · ديسمبر']
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
    if (n < 1) return 'just now · الآن'
    if (n < 60) return n + ' min ago · منذ ' + n + ' ' + arCount(n, AR_MIN)
    if (n < 2880) { var h = Math.floor(n / 60), r = n % 60; return h + ' h' + (r ? ' ' + r + ' min' : '') + ' ago · منذ ' + h + ' ' + arCount(h, AR_HOUR) + (r ? ' و' + r + ' ' + arCount(r, AR_MIN) : '') }
    var days = Math.floor(n / 1440); return days + ' days ago · منذ ' + days + ' ' + arCount(days, AR_DAY)
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
  function methodShow(m) { return m === 'cod' ? 'Cash · نقدًا' : methodName(m) }
  function itemLine(it) {
    var name = clean(it && (it.name_en || it.name_ar), 120) || 'Item · صنف'
    var extra = [clean(it && it.size, 20), clean(it && it.fit, 20)].filter(Boolean)
    return whole(it && it.qty) + ' \u00d7 ' + name + (extra.length ? ' \u00b7 ' + extra.join(' \u00b7 ') : '')
  }
  function itemsText(d) {
    var lines = (Array.isArray(d.items) ? d.items : []).map(itemLine)
    if (whole(d.items_more)) lines.push('+' + whole(d.items_more) + ' more')
    return lines.join('; ')
  }
  /** A note the way the server keeps it: control characters become spaces, trimmed, 280 characters. */
  function noteClean(s) { return Array.from(String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()).slice(0, 280).join('') }   // code points, as clean() does
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
    if (r.status === 0) return 'Could not reach the server. Check the connection and try again. · تعذّر الوصول إلى الخادم. تحقق من الاتصال وحاول مجددًا.'
    if (r.status === 401) return 'Your sign-in has ended. Sign in again, then reopen this list. · انتهت جلسة الدخول. سجّل الدخول مجددًا ثم أعد فتح هذه القائمة.'
    if (r.status === 404 && r.route === 'list') return NOT_YET
    if (r.status === 404) return 'That order could not be found. Refresh the list. · تعذّر العثور على هذا الطلب. حدّث القائمة.'
    if (r.status === 429) { var w = waitOf(r); return 'Too many requests. ' + (w ? 'Wait ' + plural(w, 'second', 'seconds') + ', then try again.' : 'Wait a moment, then try again.') + ' · طلبات كثيرة. ' + (w ? 'انتظر ' + w + ' ' + arCount(w, AR_SECOND) + ' ثم حاول مجددًا.' : 'انتظر قليلًا ثم حاول مجددًا.') }
    if (r.status === 503 && code === 'no_table') return 'The follow-up table has not been created on the server yet. Ask your developer to apply the abandoned-orders database update. · جدول المتابعة لم يُنشأ على الخادم بعد. اطلب من المطوّر تطبيق تحديث قاعدة بيانات الطلبات المتروكة.'
    if (code === 'invalid_filter') return 'That filter was not accepted. Change it and try again. · لم يُقبل هذا الفلتر. غيّره وحاول مجددًا.'
    if (code === 'not_abandoned') return 'This order is no longer on the list (it was paid or is under review). Refresh the list. · لم يعد هذا الطلب في القائمة (دُفع أو قيد المراجعة). حدّث القائمة.'
    if (code === 'note_too_long') return 'The note is too long (280 characters at most). · الملاحظة طويلة (280 حرفًا كحد أقصى).'
    return 'The server could not do that (' + (code || 'HTTP ' + r.status) + '). · تعذّر الخادم من تنفيذ ذلك (' + (code || 'HTTP ' + r.status) + ').'
  }

  // ------------------------------------------------------------------- probe
  function probe() {
    if (probeState !== 'unknown' || probing) return
    probing = true
    // a connection that never answers must not hide the entry until reload: after 10 s the request is aborted, request() answers
    // with status 0 (not 404/405/501), so the state becomes 'present' and the list's own Retry takes over
    var ctl = typeof AbortController === 'function' ? new AbortController() : null
    var guard = ctl ? setTimeout(function () { ctl.abort() }, 10000) : 0
    request('abandoned_orders', { from: '2000-01-01', to: '2000-01-01' }, null, ctl ? ctl.signal : undefined).then(function (r) {
      clearTimeout(guard)
      probing = false
      // an aborted body read answers ok with no body, which would read as "absent": a timed-out probe is never absent
      var timedOut = !!(ctl && ctl.signal.aborted)
      var absent = !timedOut && (r.status === 404 || r.status === 405 || r.status === 501 || (r.ok && !(r.body && typeof r.body === 'object')))
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
        if (S.error.wait <= 0) { S.error.wait = 0; S.error.text = 'You can try again now. · يمكنك المحاولة الآن.'; stopCount() }
        else S.error.text = 'Too many requests. Wait ' + plural(S.error.wait, 'second', 'seconds') + ', then try again. · طلبات كثيرة. انتظر ' + S.error.wait + ' ' + arCount(S.error.wait, AR_SECOND) + ' ثم حاول مجددًا.'
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
    if (datesBad()) { S.loading = false; S.error = { text: 'The "From" date is after the "To" date. · تاريخ "من" بعد تاريخ "إلى".', kind: 'other', wait: 0 }; drawAll(); return }
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
    // Same 30 s limit as load(): a stalled page must end in an error, not leave "Loading..." on the button until the panel closes.
    var mc = typeof AbortController === 'function' ? new AbortController() : null
    var mt = mc ? setTimeout(function () { try { mc.abort() } catch (e) { /* already done */ } }, 30000) : 0
    request('abandoned_orders', listParams(page), null, mc && mc.signal).then(function (r) {
      if (mt) clearTimeout(mt)
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
    var order = clean(d.track_id, 24)
    // function replacers: a customer name such as "Sam$'s" or "A$&B" must be copied as typed (a string replacement reads $' and $& as patterns)
    var text = String(tpl || '').replace(/\{name\}/g, function () { return name }).replace(/\{order\}/g, function () { return order })
    return Array.from(text.replace(/[ \t]+([,،.!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim()).slice(0, 900).join('')
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
      ? 'WhatsApp opens with the message text below typed in. Nothing is sent until you press send in WhatsApp. · يفتح واتساب والنص أدناه مكتوب فيه. لا يُرسل شيء حتى تضغط إرسال في واتساب.'
      : 'WhatsApp opens an empty chat (the message text is turned off below). · يفتح واتساب محادثة فارغة (نص الرسالة مُعطّل أدناه).'
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

    var c1 = cell(tr, 'Order · الطلب')
    var tid = el('strong', 'sab-track', clean(d.track_id, 24)); tid.setAttribute('dir', 'ltr')
    c1.appendChild(tid)
    c1.appendChild(el('span', 'sab-sub', when(d.created_at)))
    c1.appendChild(el('span', 'sab-sub', ago(d.minutes_ago)))
    c1.appendChild(el('span', 'sab-amt', kd(d.amount)))
    c1.appendChild(el('span', 'sab-sub', methodShow(d.payment_method) + ' \u00b7 ' + clean(d.payment_status, 16)))

    var c2 = cell(tr, 'Customer · العميل')
    var nm = el('strong', 'sab-name', clean(d.customer_name, 80) || 'No name · بلا اسم'); nm.setAttribute('dir', 'auto')
    c2.appendChild(nm)
    var ph = el('span', 'sab-phone', phoneShow(d.customer_phone)); ph.setAttribute('dir', 'ltr')
    c2.appendChild(ph)
    var where = [clean(d.customer_area, 60), clean(d.customer_governorate, 40)].filter(Boolean).join(', ')
    if (where) { var w = el('span', 'sab-sub', where); w.setAttribute('dir', 'auto'); c2.appendChild(w) }
    if (d.customer_lang === 'ar' || d.customer_lang === 'en') c2.appendChild(el('span', 'sab-sub', d.customer_lang === 'ar' ? 'Arabic · العربية' : 'English · الإنجليزية'))
    if (d.reason === 'waiting') {
      c2.appendChild(el('span', 'sab-sub sab-hold', 'Not contacted yet: the shopper may still be paying. · لم يُتواصل معه بعد: قد يكون العميل ما زال يدفع.'))
    } else {
      var acts = el('div', 'sab-acts')
      var telurl = telUrl(d.customer_phone)
      var waurl = waUrl(d)
      if (waurl) {
        var wa = link('sab-btn--wa', 'WhatsApp · واتساب', 'WhatsApp · واتساب ' + (clean(d.customer_name, 40) || 'customer'), true)
        wa.href = waurl
        n.wa = wa; acts.appendChild(wa)
      }
      if (telurl) {
        var call = link('', 'Call · اتصال', 'Call · اتصال ' + (clean(d.customer_name, 40) || 'customer'), false)
        call.href = telurl
        n.call = call; acts.appendChild(call)
      }
      if (acts.childNodes.length) c2.appendChild(acts)
    }

    var c3 = cell(tr, 'Items · الأصناف')
    var count = whole(d.item_count)
    c3.appendChild(el('span', 'sab-sub', count ? plural(count, 'piece', 'pieces') + ' · ' + arCount(count, AR_PIECE) : 'No item lines on this order · لا أصناف في هذا الطلب'))
    var ul = el('ul', 'sab-items')
    ;(Array.isArray(d.items) ? d.items : []).forEach(function (it) { var li = el('li', '', itemLine(it)); li.setAttribute('dir', 'auto'); ul.appendChild(li) })
    if (whole(d.items_more)) ul.appendChild(el('li', 'sab-sub', '+' + whole(d.items_more) + ' more · +' + whole(d.items_more) + ' أخرى'))
    if (ul.childNodes.length) c3.appendChild(ul)

    var c4 = cell(tr, 'Why · السبب')
    var rs = String(d.reason || '')
    c4.appendChild(chip(rs, LABEL_BI[rs] || rs))
    c4.appendChild(el('span', 'sab-sub', WHY[rs] || ''))
    var flags = []
    if (d.stock_released) flags.push('Stock released · أُفرج عن المخزون'); else if (rs !== 'cancelled') flags.push('Stock still held · المخزون ما زال محجوزًا')
    if (d.discount_released) flags.push('Discount released · أُفرج عن الخصم')
    c4.appendChild(el('span', 'sab-sub', flags.join(' \u00b7 ')))
    n.rec = el('span', 'sab-rec')
    c4.appendChild(n.rec)

    var c5 = cell(tr, 'Follow-up · المتابعة')
    var grp = el('div', 'sab-states'); grp.setAttribute('role', 'group'); grp.setAttribute('aria-label', 'Follow-up status · حالة المتابعة')
    n.state = {}
    STATES.forEach(function (s) {
      var b = btn('sab-state', s[1] + ' · ' + STATE_AR[s[0]], function () { setFollow(ro, s[0]) })
      b.setAttribute('aria-pressed', 'false')
      n.state[s[0]] = b; grp.appendChild(b)
    })
    c5.appendChild(grp)
    n.who = el('span', 'sab-sub')
    c5.appendChild(n.who)
    var nf = el('div', 'sab-notebox')
    var inp = el('input', 'sab-note'); inp.type = 'text'; inp.maxLength = 280; inp.setAttribute('dir', 'auto')
    inp.setAttribute('aria-label', 'Note for ' + (clean(d.track_id, 24) || 'this order') + ' · ملاحظة لـ ' + (clean(d.track_id, 24) || 'هذا الطلب')); inp.placeholder = 'Note (pick a status first) · اختر الحالة أولًا'
    inp.autocomplete = 'off'
    n.note = inp
    n.upd = btn('sab-btn--small', 'Update note · تحديث الملاحظة', function () { if (d.followup) setFollow(ro, d.followup.state) })
    inp.addEventListener('input', function () { syncRow(ro) })
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (!n.upd.disabled) n.upd.click() } })
    nf.appendChild(inp); nf.appendChild(n.upd)
    c5.appendChild(nf)
    n.clear = btn('sab-btn--small sab-btn--quiet', 'Clear follow-up · مسح المتابعة', function () { setFollow(ro, 'none') })
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
    n.note.placeholder = f ? 'Note (up to 280 characters) · حتى 280 حرفًا' : 'Note (pick a status first) · اختر الحالة أولًا'
    var typed = noteClean(n.note.value)
    n.upd.disabled = !f || ro.busy || typed === (f && f.note ? f.note : '')
    n.clear.hidden = !f
    n.clear.disabled = ro.busy
    n.who.textContent = ro.busy ? 'Saving... · جارٍ الحفظ...' : f && f.by ? 'Marked by ' + clean(f.by, 80) + (f.at ? ', ' + when(f.at) : '') + ' · حدّده ' + clean(f.by, 80) + (f.at ? '، ' + when(f.at) : '') : ''
    n.rec.textContent = ''
    if (d.recovered) n.rec.appendChild(chip('ok', d.recovered_by === 'manual' ? 'Recovered: marked by you · مُستعادة: حدّدتها أنت' : 'Recovered: a later order succeeded · مُستعادة: نجح طلب لاحق'))
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
        ro.msg = state === 'none' ? 'Follow-up cleared. · تم مسح المتابعة.' : 'Saved. · تم الحفظ.'
        ro.bad = false
        syncRow(ro, true)
        if (prev.rec !== d.recovered) refreshSummary()
      } else {
        d.followup = prev.f; d.recovered = prev.rec; d.recovered_by = prev.by
        n.note.value = prev.note
        ro.msg = 'Not saved. · لم يُحفظ. ' + failText(Object.assign({ route: 'write' }, r)) + ' Nothing was changed. · لم يتغير شيء.'
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
    tot.appendChild(tile('Still lost · ما زال مفقودًا', plural(whole(a.count), 'order', 'orders') + ' · ' + arCount(whole(a.count), AR_ORDER), kd(a.value)))
    tot.appendChild(tile('Recovered · مُستعادة', plural(whole(a.recovered_count), 'order', 'orders') + ' · ' + arCount(whole(a.recovered_count), AR_ORDER), kd(a.recovered_value)))
    tot.appendChild(tile('Recovery rate · نسبة الاستعادة', a.recovery_rate == null ? '-' : Number(a.recovery_rate).toFixed(1) + '%', a.recovery_rate == null ? 'Nothing abandoned yet · لا طلبات متروكة بعد' : 'of ' + plural(whole(a.count) + whole(a.recovered_count), 'abandoned order', 'abandoned orders') + ' · من ' + (whole(a.count) + whole(a.recovered_count)) + ' ' + arCount(whole(a.count) + whole(a.recovered_count), AR_ABANDONED)))
    box.appendChild(tot)
    var rs = el('div', 'sab-tiles sab-tiles--reasons')
    REASONS.forEach(function (r) {
      var x = (s.by_reason && s.by_reason[r]) || {}
      var b = el('button', 'sab-tile sab-tile--btn')
      b.type = 'button'
      b.setAttribute('data-reason', r)
      b.setAttribute('aria-pressed', S.filters.reason === r ? 'true' : 'false')
      b.setAttribute('aria-label', LABEL[r] + ': ' + plural(whole(x.count), 'order', 'orders') + ', ' + kd(x.value) + '. Show only these. · ' + LABEL_BI[r].split(' · ')[1] + ': ' + whole(x.count) + ' ' + arCount(whole(x.count), AR_ORDER) + '، ' + kd(x.value) + '. اعرض هذه فقط.')
      b.appendChild(el('span', 'sab-tile-label', LABEL_BI[r]))
      b.appendChild(el('strong', 'sab-tile-big', String(whole(x.count))))
      b.appendChild(el('span', 'sab-sub', kd(x.value)))
      b.appendChild(el('span', 'sab-sub', whole(x.recovered_count) + ' recovered · مُستعادة (' + kd(x.recovered_value) + ')'))
      b.addEventListener('click', function () { S.filters.reason = S.filters.reason === r ? 'all' : r; syncFilters(); load() })
      rs.appendChild(b)
    })
    box.appendChild(rs)
    var oth = el('div', 'sab-sub sab-other')
    var w = s.waiting || {}, c = s.cancelled_by_shop || {}
    oth.appendChild(el('span', '', 'Not counted as abandoned: · لا تُحسب كمتروكة:'))
    var b1 = btn('sab-linkbtn', plural(whole(w.count), 'order', 'orders') + ' still waiting (' + kd(w.value) + ') · ' + arCount(whole(w.count), AR_ORDER) + ' بانتظار الدفع (' + kd(w.value) + ')', function () { S.filters.reason = 'waiting'; syncFilters(); load() })
    var b2 = btn('sab-linkbtn', plural(whole(c.count), 'order', 'orders') + ' cancelled by the shop (' + kd(c.value) + ') · ' + arCount(whole(c.count), AR_ORDER) + ' ألغاها المتجر (' + kd(c.value) + ')', function () { S.filters.reason = 'cancelled'; syncFilters(); load() })
    oth.appendChild(b1); oth.appendChild(b2)
    box.appendChild(oth)
    var st = S.settings
    if (st) {
      var rules = 'Rules in force: a card order counts as abandoned ' + plural(whole(st.abandoned_after_minutes), 'minute', 'minutes') + ' after it was started; stock is held ' + plural(whole(st.hold_minutes), 'minute', 'minutes') + '; ' +
        (whole(st.cod_hold_hours) ? 'a cash order expires after ' + plural(whole(st.cod_hold_hours), 'hour', 'hours') + '.' : 'cash orders never expire.') +
        ' · القواعد المعمول بها: يُحسب طلب البطاقة متروكًا بعد ' + whole(st.abandoned_after_minutes) + ' ' + arCount(whole(st.abandoned_after_minutes), AR_MIN) + ' من بدئه؛ يُحجز المخزون ' + whole(st.hold_minutes) + ' ' + arCount(whole(st.hold_minutes), AR_MIN) + '؛ ' +
        (whole(st.cod_hold_hours) ? 'ينتهي طلب النقد بعد ' + whole(st.cod_hold_hours) + ' ' + arCount(whole(st.cod_hold_hours), AR_HOUR) + '.' : 'طلبات النقد لا تنتهي أبدًا.')
      box.appendChild(el('p', 'sab-sub', rules + ' The counts follow the dates and the search below. · تتبع الأرقام التواريخ والبحث أدناه.'))
    }
  }
  function drawStatus() {
    var t = ''
    if (S.loading && !S.rows.length) t = 'Loading... · جارٍ التحميل...'
    else if (S.loading) t = 'Refreshing... · جارٍ التحديث...'
    else if (S.loaded && !S.error) t = S.rows.length ? 'Showing ' + plural(S.rows.length, 'order', 'orders') + (S.hasMore ? ', more available' : '') + '. · يُعرض ' + S.rows.length + ' ' + arCount(S.rows.length, AR_ORDER) + (S.hasMore ? '، ويوجد المزيد' : '') + '.' : 'No orders match. · لا توجد طلبات مطابقة.'
    if (refs.status.textContent !== t) refs.status.textContent = t
    refs.root.setAttribute('aria-busy', S.loading ? 'true' : 'false')
    refs.refresh.disabled = S.loading
    refs.csv.disabled = !S.rows.length
    refs.csv.textContent = S.rows.length ? 'Export CSV · تصدير CSV (' + S.rows.length + ')' : 'Export CSV · تصدير CSV'
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
      var r = btn('sab-btn--primary', 'Try again · حاول مرة أخرى', function () { load(true) })
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
      if (S.loading) host.appendChild(message('info', 'Loading... · جارٍ التحميل...'))
      else if (S.error) host.appendChild(message(S.error.kind === 'absent' ? 'info' : 'error', S.error.text, S.error.kind !== 'absent'))
      else if (S.loaded) {
        var f = S.filters
        host.appendChild(message('info', f.reason !== 'all' || f.from || f.to || f.q || f.rec
          ? 'No orders match these filters. Widen the dates, clear the search, or show another reason. · لا توجد طلبات تطابق هذه الفلاتر. وسّع التواريخ أو امسح البحث أو اعرض سببًا آخر.'
          : 'No abandoned orders. Every order that was started has been paid, is still in progress, or was cancelled by the shop. · لا توجد طلبات متروكة. كل طلب بُدئ به دُفع، أو ما زال قيد التنفيذ، أو ألغاه المتجر.'))
      }
      refs.more.hidden = true
      return
    }
    if (!tableEl || !tableEl.isConnected || tableEl.parentNode !== host) {
      host.textContent = ''
      tableEl = el('table', 'sab-table'); tableEl.setAttribute('role', 'table'); tableEl.setAttribute('aria-label', 'Abandoned orders · الطلبات المتروكة')
      var thead = el('thead'), htr = el('tr'); htr.setAttribute('role', 'row')
      ;['Order · الطلب', 'Customer · العميل', 'Items · الأصناف', 'Why · السبب', 'Follow-up · المتابعة'].forEach(function (h) {
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
    refs.more.textContent = S.loadingMore ? 'Loading... · جارٍ التحميل...' : 'Load more · تحميل المزيد'
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
    refs.status.textContent = 'Exported ' + plural(S.rows.length, 'order', 'orders') + (S.hasMore ? '. More orders are available: press Load more first to include them.' : '.') + ' · تم التصدير: ' + S.rows.length + ' ' + arCount(S.rows.length, AR_ORDER) + (S.hasMore ? '. توجد طلبات أخرى: اضغط تحميل المزيد أولًا لتضمينها.' : '.')
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
    var h1 = el('h1', 'sab-title', 'Abandoned orders · الطلبات المتروكة'); h1.id = 'sab-title'; h1.tabIndex = -1
    hl.appendChild(h1)
    hl.appendChild(el('p', 'sab-lead', 'Orders that were started and not completed. Phone or WhatsApp the customer, then mark what happened. · طلبات بُدئ بها ولم تكتمل. اتصل بالعميل أو راسله على واتساب، ثم سجّل ما حدث.'))
    head.appendChild(hl)
    var tools = el('div', 'sab-tools')
    refs.refresh = btn('', 'Refresh · تحديث', function () { load(true) })
    refs.csv = btn('sab-btn--primary', 'Export CSV · تصدير CSV', exportCsv)
    tools.appendChild(refs.refresh); tools.appendChild(refs.csv)
    head.appendChild(tools)
    wrap.appendChild(head)

    refs.status = el('p', 'sab-status'); refs.status.setAttribute('role', 'status'); refs.status.setAttribute('aria-live', 'polite')
    wrap.appendChild(refs.status)

    refs.summary = el('div', 'sab-summary'); refs.summary.hidden = true
    wrap.appendChild(refs.summary)

    // filters
    var fl = el('div', 'sab-filters'); fl.setAttribute('role', 'group'); fl.setAttribute('aria-label', 'Filters · الفلاتر')
    refs.reason = el('select')
    ;[['all', 'All abandoned · كل المتروكة']].concat(REASONS.map(function (r) { return [r, LABEL_BI[r]] })).concat([['waiting', 'Waiting (not abandoned yet) · بانتظار الدفع (لم تُحسب متروكة بعد)'], ['cancelled', 'Cancelled by shop · ألغاه المتجر']]).forEach(function (o) {
      var op = el('option', '', o[1]); op.value = o[0]; refs.reason.appendChild(op)
    })
    refs.reason.addEventListener('change', function () { S.filters.reason = refs.reason.value; load() })
    fl.appendChild(field('Reason · السبب', refs.reason))
    refs.from = el('input'); refs.from.type = 'date'
    refs.from.addEventListener('change', function () { S.filters.from = refs.from.value; load() })
    fl.appendChild(field('From · من', refs.from))
    refs.to = el('input'); refs.to.type = 'date'
    refs.to.addEventListener('change', function () { S.filters.to = refs.to.value; load() })
    fl.appendChild(field('To · إلى', refs.to))
    refs.q = el('input'); refs.q.type = 'search'; refs.q.maxLength = 80; refs.q.placeholder = 'Track ID, name or phone · رقم التتبع أو الاسم أو الهاتف'
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
    fl.appendChild(field('Search · بحث', refs.q, 'sab-field--wide'))
    var recLabel = el('label', 'sab-check')
    refs.rec = el('input'); refs.rec.type = 'checkbox'
    refs.rec.addEventListener('change', function () { S.filters.rec = refs.rec.checked; load() })
    recLabel.appendChild(refs.rec); recLabel.appendChild(document.createTextNode('Show recovered orders · إظهار الطلبات المُستعادة'))
    fl.appendChild(recLabel)
    refs.clearAll = btn('sab-btn--quiet', 'Clear filters · مسح الفلاتر', function () {
      S.filters = { reason: 'all', from: '', to: '', q: '', rec: false }
      syncFilters(); load()
    })
    refs.clearAll.hidden = true
    fl.appendChild(refs.clearAll)
    wrap.appendChild(fl)

    // WhatsApp wording
    var det = el('details', 'sab-msg')
    det.appendChild(el('summary', '', 'WhatsApp message text · نص رسالة واتساب'))
    var body = el('div', 'sab-msg-body')
    body.appendChild(el('p', 'sab-hint', 'The WhatsApp button opens a chat with this text typed in, in the customer\u2019s language (Arabic when it is not known). You read it and press send yourself. Use {name} and {order}. Saved in this browser only. · يفتح زر واتساب محادثة مع هذا النص مكتوبًا فيها، بلغة العميل (العربية إن لم تُعرف). تقرؤه وتضغط إرسال بنفسك. استخدم {name} و{order}. يُحفظ في هذا المتصفح فقط.'))
    var onLabel = el('label', 'sab-check')
    refs.msgOn = el('input'); refs.msgOn.type = 'checkbox'; refs.msgOn.checked = msg.on
    refs.msgOn.addEventListener('change', function () { msg.on = refs.msgOn.checked; saveMsg(); refreshWa() })
    onLabel.appendChild(refs.msgOn); onLabel.appendChild(document.createTextNode('Type this message into WhatsApp · اكتب هذه الرسالة في واتساب'))
    body.appendChild(onLabel)
    refs.msgAr = el('textarea'); refs.msgAr.value = msg.ar; refs.msgAr.maxLength = 600; refs.msgAr.setAttribute('dir', 'rtl'); refs.msgAr.lang = 'ar'
    refs.msgAr.addEventListener('input', function () { msg.ar = refs.msgAr.value; saveMsg(); refreshWa() })
    body.appendChild(field('Arabic · العربية', refs.msgAr))
    refs.msgEn = el('textarea'); refs.msgEn.value = msg.en; refs.msgEn.maxLength = 600; refs.msgEn.setAttribute('dir', 'ltr'); refs.msgEn.lang = 'en'
    refs.msgEn.addEventListener('input', function () { msg.en = refs.msgEn.value; saveMsg(); refreshWa() })
    body.appendChild(field('English · الإنجليزية', refs.msgEn))
    body.appendChild(btn('sab-btn--small', 'Reset to the suggested wording · إعادة الصياغة المقترحة', function () {
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
    refs.more = btn('', 'Load more · تحميل المزيد', loadMore); refs.more.hidden = true
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
    span.appendChild(svgIcon(17)); span.appendChild(document.createTextNode('Abandoned orders · الطلبات المتروكة'))
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
    b.appendChild(ic); b.appendChild(el('span', '', 'Abandoned · متروكة'))
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
    var s = el('strong', '', 'Abandoned orders · الطلبات المتروكة')
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
    // the compiled shell only (its nav carries this class): a page that merely looks like an admin is left alone
    var nav = document.querySelector('nav.admin-sidebar__nav')
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

/* ---------------------------------------------------------------------------
 * 4. Payments: ONE setup. The CBK connection (ClientId, ClientSecret, ENCRP_KEY,
 *    the test and production API bases, the return URLs) is part of the KNET
 *    editor, saved through admin.php?r=payment_config with gateway "tpay" (the
 *    same route the T-Pay editor used). The T-Pay editor and its gateway card
 *    are hidden: T-Pay is no longer a customer payment method (owner decision
 *    2026-11-03; the server offers knet and cod only). KNET itself is unchanged.
 *
 * The environment is the one the KNET editor shows (payment_config's env); this
 * block saves the CBK fields in that environment, so the two stay together.
 * Secrets left blank keep the saved value (the server does that, not this file).
 * Same rules as the cards above: textContent only, inline styles, its own save.
 * ------------------------------------------------------------------------ */
;(function () {
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaCbkMerge) return   // double execution: a second copy of this file must not start a second set of observers
  try { Object.defineProperty(window, '__sportaCbkMerge', { value: 1, enumerable: false, configurable: false }) } catch (e) { return }
  var API = '/api/admin.php'
  var MARK = 'data-sporta-cbk'
  // Each refusal the server can send for this card: [English, Arabic]. A code missing here shows "Could not save (code)".
  var MSG = {
    invalid_test_base: ['The test API base must be an https address on pgtest.cbk.com.', 'يجب أن يكون عنوان قاعدة واجهة الاختبار رابط https على pgtest.cbk.com.'],
    invalid_production_base: ['The production API base must be an https address on pg.cbk.com.', 'يجب أن يكون عنوان قاعدة واجهة الإنتاج رابط https على pg.cbk.com.'],
    invalid_return_url: ['The return URL must be an https address on sporta.com.kw.', 'يجب أن يكون عنوان العودة رابط https على sporta.com.kw.'],
    invalid_result_page_url: ['The result page URL must be an https address on sporta.com.kw.', 'يجب أن تكون صفحة النتيجة رابط https على sporta.com.kw.'],
    invalid_environment: ['Choose Test or Production in the KNET editor first.', 'اختر الاختبار أو الإنتاج في محرر KNET أولًا.'],
    production_same_as_test: ['The production value is the same as the test value. CBK issues a separate set for each.', 'قيمة الإنتاج هي نفسها قيمة الاختبار. تصدر CBK مجموعة منفصلة لكل منهما.'],
    cbk_production_credentials_required: ['KNET goes through CBK, so CBK production credentials are needed before switching to Production.', 'يمر KNET عبر CBK، لذلك تلزم بيانات CBK للإنتاج قبل التحويل إلى الإنتاج.'],
    knet_production_credentials_required: ['Test and Production are one switch for KNET and CBK. Save the KNET production Tranportal credentials first.', 'الاختبار والإنتاج مفتاح واحد لـ KNET وCBK. احفظ بيانات الإنتاج الخاصة بـ KNET أولًا.'],
    invalid_gateway: ['The server did not accept the CBK save.', 'لم يقبل الخادم حفظ CBK.'],
    config_missing: ['The CBK configuration file is missing on the server.', 'ملف إعدادات CBK غير موجود على الخادم.'],
    config_not_writable: ['The server could not write the configuration file.', 'تعذّر على الخادم كتابة ملف الإعدادات.'],
    not_signed_in: ['Your session ended. Sign in again.', 'انتهت الجلسة. سجّل الدخول من جديد.'],
    bad_request: ['The save was refused. Reload the page and try again.', 'رُفض الحفظ. أعد تحميل الصفحة وحاول مرة أخرى.'],
    request_too_large: ['The save is too large. Reload the page and try again.', 'الحفظ كبير جدًا. أعد تحميل الصفحة وحاول مرة أخرى.'],
    merchant_credentials_required: ['The Client ID and the Client Secret are needed. Enter both, then save.', 'معرّف العميل والكلمة السرية للعميل مطلوبان. أدخل الاثنين ثم احفظ.'],
    encrypted_account_key_required: ['The Encrypted Account Key (ENCRP_KEY) is needed.', 'مفتاح الحساب المشفّر (ENCRP_KEY) مطلوب.'],
    client_id_too_long: ['The Client ID is longer than 50 characters. Check the paste.', 'معرّف العميل أطول من 50 حرفًا. تحقق من النص الملصوق.'],
    client_secret_too_long: ['The Client Secret is longer than 100 characters. Check the paste.', 'الكلمة السرية للعميل أطول من 100 حرف. تحقق من النص الملصوق.']
  }
  // [field, the server's limit in bytes (strlen), English name, Arabic name]: the same limits admin.php applies on save.
  var LIMITS = [['client_id', 50, 'Client ID', 'معرّف العميل'], ['client_secret', 100, 'Client Secret', 'الكلمة السرية للعميل']]
  // [key, English label, type, saved-state flag, Arabic label]. The English label is kept for the trim block's matching.
  var FIELDS = [
    ['client_id', 'Client ID (ClientId)', 'text', 'has_client_id', 'معرّف العميل (ClientId)'],
    ['client_secret', 'Client Secret (ClientSecret)', 'password', 'has_client_secret', 'الكلمة السرية للعميل (ClientSecret)'],
    ['encrp_key', 'Encrypted Account Key (ENCRP_KEY)', 'password', 'has_encrp_key', 'مفتاح الحساب المشفّر (ENCRP_KEY)'],
    ['test_base', 'Test API base URL', 'url', null, 'عنوان قاعدة واجهة الاختبار'],
    ['production_base', 'Production API base URL', 'url', null, 'عنوان قاعدة واجهة الإنتاج'],
    ['return_url', 'Return URL (on sporta.com.kw)', 'url', null, 'عنوان العودة (على sporta.com.kw)'],
    ['result_page_url', 'Customer result page URL', 'url', null, 'عنوان صفحة نتيجة الدفع للعميل']
  ]

  function call(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, body: j } }) })
  }

  // The compiled editor's own classes, read from the KNET form at run time (as the cards above do).
  function borrow(form) {
    var grid = form.querySelector(':scope > .grid')
    var lab = grid && grid.querySelector('label')
    var span = lab && lab.querySelector('span')
    var input = lab && lab.querySelector('input:not([type=checkbox])')
    var btns = form.querySelectorAll('button')
    var save = null
    for (var i = btns.length - 1; i >= 0; i--) { if (!btns[i].closest('[' + MARK + ']') && /save/i.test(btns[i].textContent)) { save = btns[i]; break } }
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
  var SECTION = 'mt-5 border-t border-slate-100 pt-4'
  var TITLE = 'text-sm font-bold text-slate-900'
  var NOTE = 'mt-0.5 text-xs text-slate-500'
  var ROW = 'mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between'
  var STATUS = 'text-xs text-slate-500'
  /** The admin's language, read the way the other blocks read it: the nearest lang above the screen, else the page's. */
  function isAr() {
    var host = document.querySelector('main') || document.body
    var h = (host.closest && host.closest('[lang]')) || document.documentElement
    return /^ar/i.test(h.getAttribute('lang') || '')
  }
  /** English or Arabic text, by the admin's language. */
  function tr(en, ar) { return isAr() ? ar : en }
  function envName(env) { return tr(env === 'production' ? 'Production' : 'Test', env === 'production' ? 'الإنتاج' : 'الاختبار') }
  /** The card's note names the environment its fields and Save act on: rebuilt whenever that environment changes. */
  function noteText(env) {
    return tr('The CBK credentials for KNET through CBK. They are saved in the environment shown here: ' + envName(env) + ', the one selected for KNET above. A blank secret keeps the saved value.',
      'بيانات CBK لخدمة KNET عبر CBK. تُحفظ في البيئة المعروضة هنا: ' + envName(env) + '، وهي المختارة لـ KNET أعلاه. ترك حقل السر فارغًا يُبقي القيمة المحفوظة.')
  }
  /** Length in bytes, as PHP's strlen() counts it. */
  function bytesOf(s) {
    s = String(s == null ? '' : s)
    return typeof TextEncoder === 'function' ? new TextEncoder().encode(s).length : s.length
  }

  function build(form, cfg) {
    var c = borrow(form)
    var card = cls('div', SECTION)
    card.setAttribute(MARK, '1')
    card.appendChild(cls('p', TITLE, tr('CBK connection', 'الاتصال بـ CBK')))
    var note = cls('p', NOTE, noteText(cfg.env))
    card.appendChild(note)

    var inputs = {}
    var grid = cls('div', c.grid)
    FIELDS.forEach(function (f) {
      var label = cls('label', c.label)
      var head = cls('span', c.span, isAr() ? f[4] : f[1])
      var state = null
      if (f[3]) {
        state = cls('span', 'payment-secret-field__state', '')
        state.style.color = '#4338ca'
        head.appendChild(state)
      }
      label.appendChild(head)
      var input = cls('input', c.input)
      input.type = f[2] === 'password' ? 'password' : 'text'
      input.maxLength = f[2] === 'url' ? 300 : 200
      input.autocomplete = 'off'
      input.spellcheck = false
      input.setAttribute('autocapitalize', 'none')
      input.setAttribute('dir', 'ltr')
      if (f[3]) input.placeholder = tr('Leave blank to keep the saved value', 'اتركه فارغًا للإبقاء على القيمة المحفوظة')
      input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); save.click() } })
      input.addEventListener('input', function () { status.textContent = ''; status.style.color = '' })
      inputs[f[0]] = { el: input, state: state, has: f[3] }
      label.appendChild(input)
      grid.appendChild(label)
    })
    card.appendChild(grid)

    var row = cls('div', ROW)
    var status = cls('p', STATUS, tr('Loading…', 'جارٍ التحميل…'))
    // A save result is read out by a screen reader when it arrives (the status line itself is never replaced).
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    var save = cls('button', c.button, tr('Save CBK connection', 'حفظ اتصال CBK'))
    save.type = 'button'
    row.appendChild(status)
    row.appendChild(save)
    card.appendChild(row)

    function show(shape) {
      FIELDS.forEach(function (f) {
        var i = inputs[f[0]]
        if (!i) return
        if (!i.has) i.el.value = shape[f[0]] || ''
        else {
          i.el.value = ''
          if (i.state) i.state.textContent = shape[f[3]] ? tr('Saved', 'محفوظ') : tr('Not set', 'غير مضبوط')
        }
      })
    }
    function fail(r) {
      var err = r.body && r.body.error
      status.style.color = '#be123c'
      var m = err && Object.prototype.hasOwnProperty.call(MSG, err) ? MSG[err] : null
      status.textContent = m ? tr(m[0], m[1]) : tr('Could not save' + (err ? ' (' + err + ')' : '') + '.', 'تعذّر الحفظ' + (err ? ' (' + err + ')' : '') + '.')
    }
    show(cfg.tpay)
    status.textContent = ''
    save.addEventListener('click', function () {
      var env = cfg.env
      var body = { gateway: 'tpay', env: env }
      FIELDS.forEach(function (f) { body[f[0]] = inputs[f[0]].el.value.trim() })
      // The server refuses a ClientId over 50 bytes and a secret over 100 (admin.php, payment_config). Say so here, by field
      // and limit, before anything is sent. The field is NOT cut short by the browser: a cut secret would be saved as shown.
      var over = null
      LIMITS.forEach(function (L) { if (!over && bytesOf(body[L[0]]) > L[1]) over = L })
      if (over) {
        status.style.color = '#be123c'
        status.textContent = tr(over[2] + ' is longer than ' + over[1] + ' characters. Check the paste.', over[3] + ' أطول من ' + over[1] + ' حرفًا. تحقق من النص الملصوق.')
        return
      }
      save.disabled = true
      status.style.color = ''
      status.textContent = tr('Saving…', 'جارٍ الحفظ…')
      // The server sets the environment for BOTH gateways from this request, and `env` here was read when the card
      // was built. If the KNET editor (or another tab) has switched Test/Production since, posting the old value
      // would move the shop back, or file production credentials under Test. So: read the environment again right
      // before the save, and refuse when it is not the one this card was showing.
      call('payment_config').then(function (now) {
        var live = now && now.ok && now.body && now.body.knet ? (now.body.knet.env === 'production' ? 'production' : 'test') : null
        if (live === null) {
          save.disabled = false
          status.style.color = '#be123c'
          status.textContent = tr('Could not confirm the current environment. Nothing was saved; try again.', 'تعذّر التحقق من البيئة الحالية. لم يُحفظ شيء؛ حاول مرة أخرى.')
          return
        }
        if (live !== env) {
          save.disabled = false
          cfg.env = live
          cfg.tpay = now.body.tpay || {}
          show(cfg.tpay)
          card.setAttribute('data-sporta-cbk-env', live)
          note.textContent = noteText(live)
          status.style.color = '#be123c'
          status.textContent = tr('The environment changed to ' + envName(live) + ' since this card was opened. Nothing was saved. The fields now show the ' + envName(live) + ' values; enter your change again and save.',
            'تغيّرت البيئة إلى ' + envName(live) + ' منذ فتح هذه البطاقة. لم يُحفظ شيء. الحقول تعرض الآن قيم ' + envName(live) + '؛ أدخل تغييرك من جديد واحفظ.')
          return
        }
        call('payment_config', body).then(function (r) {
          save.disabled = false
          if (r.ok && r.body && r.body.config) {
            cfg.tpay = Object.assign({}, cfg.tpay, r.body.config)
            show(cfg.tpay)
            status.style.color = '#c2410c'
            status.textContent = tr('Saved.', 'تم الحفظ.')
          } else { fail(r) }
        }, function () { save.disabled = false; fail({}) })
      }, function () {
        save.disabled = false
        status.style.color = '#be123c'
        status.textContent = tr('Could not confirm the current environment. Nothing was saved; try again.', 'تعذّر التحقق من البيئة الحالية. لم يُحفظ شيء؛ حاول مرة أخرى.')
      })
    })
    return card
  }

  // The T-Pay editor and its gateway card: hidden, not removed (React keeps its state; nothing else depends on them).
  function retireTpay() {
    var forms = document.querySelectorAll('form.payment-gateway-editor')
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('.payment-knet-toggle-row')) continue
      if (forms[i].style.display !== 'none') forms[i].style.display = 'none'
      forms[i].setAttribute('data-sporta-tpay-retired', '1')
    }
    var cards = document.querySelectorAll('section.payment-gateway-card')
    for (var j = 0; j < cards.length; j++) {
      var head = cards[j].querySelector('.payment-gateway-card__head') || cards[j]
      if (!/^\s*T-Pay/.test(head.textContent || '')) continue      // the heading runs on: "T-PayCBK hosted ..."
      if (cards[j].style.display !== 'none') cards[j].style.display = 'none'
      cards[j].setAttribute('data-sporta-tpay-retired', '1')
    }
  }

  // The Checkout screen's T-Pay parts: the on/off row, the "Selected by default" option and the summary chip. The server
  // no longer offers T-Pay (store_checkout_setting), so each of these would do nothing when used. Hidden, not removed.
  function retireTpayCheckout() {
    var rows = document.querySelectorAll('label.checkout-method-editor')
    for (var i = 0; i < rows.length; i++) {
      var name = rows[i].querySelector('strong')
      if (!name || name.textContent.trim() !== 'CBK T-Pay') continue
      rows[i].style.display = 'none'
      rows[i].setAttribute('data-sporta-tpay-retired', '1')
    }
    var opts = document.querySelectorAll('select option[value="tpay"]')
    for (var j = 0; j < opts.length; j++) { opts[j].disabled = true; opts[j].hidden = true; opts[j].setAttribute('data-sporta-tpay-retired', '1') }
    var chips = document.querySelectorAll('div.rounded-xl')
    for (var k = 0; k < chips.length; k++) {
      if (chips[k].children.length || chips[k].textContent.trim() !== 'CBK T-Pay') continue
      chips[k].style.display = 'none'
      chips[k].setAttribute('data-sporta-tpay-retired', '1')
    }
  }


  var building = false
  function scan() {
    retireTpay()
    retireTpayCheckout()
    var forms = document.querySelectorAll('form.payment-gateway-editor')
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i]
      if (!form.querySelector('.payment-knet-toggle-row')) continue       // KNET's editor only
      if (form.querySelector('[' + MARK + ']') || building) continue
      building = true
      call('payment_config').then(function (r) {
        building = false
        if (!r.ok || !r.body || !r.body.knet) return
        // Build into the KNET form that is still on the page when the answer comes back.
        var f = document.querySelector('form.payment-gateway-editor .payment-knet-toggle-row')
        var target = f && f.closest('form.payment-gateway-editor')
        if (!target || target.querySelector('[' + MARK + ']')) return
        var ids = target.querySelector('[data-sporta-knet-ids]')
        var grid = target.querySelector(':scope > .grid')
        var anchor = ids || grid
        if (!anchor) return
        var cfg = { env: r.body.knet.env === 'production' ? 'production' : 'test', tpay: r.body.tpay || {} }
        anchor.parentNode.insertBefore(build(target, cfg), anchor.nextSibling)
      })
      break
    }
  }

  var queued = false
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; try { scan() } catch (e) { /* a failed pass must not be a console error on every DOM change */ } }) }
  function start() { scan(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()

/* ===== ADMIN PAYMENTS TRIM - begin =======================================
 * Payments > KNET editor: "remove any unneeded fields" (owner 2026-11-12). Folds into two read-only summaries, each with
 * one "Show fields" button:
 *
 *   KNET summary (right after the compiled editor's field grid)
 *     - the compiled address fields that can hold only ONE value the server accepts, when they hold it:
 *         Test gateway URL         https://kpaytest.com.kw/kpg/PaymentHTTP.htm   knet.php knet_assert_payment_config pins
 *         Production gateway URL   https://kpay.com.kw/kpg/PaymentHTTP.htm       host AND path; admin.php payment_config
 *                                                                                pins the host
 *         Response URL, Error URL  https://www.sporta.com.kw/knet/callback.php   (the one file that answers both)
 *         Customer result page     https://www.sporta.com.kw/payment/result      (the live value, read-only probe 2026-11-12)
 *     - the Merchant ID / Terminal ID card (block 2): records only, no payment request carries them; shown as saved
 *       values or "not set".
 *   CBK summary (inside the CBK connection card, after its fields)
 *     - Test API base URL (host pgtest.cbk.com), Production API base URL (host pg.cbk.com), Return URL
 *       (https://www.sporta.com.kw/pay/callback.php), Customer result page URL (https://www.sporta.com.kw/payment/result);
 *     - the Merchant Server IP 1 / 2 card (block 3): an allowlist record on CBK's side, never sent; saved values or "not set".
 *
 * SAVING IS UNTOUCHED. Everything is HIDDEN with inline display:none (a compiled <label>, the one-field wrapper around it,
 * or a whole add-on card), never removed, emptied or written to: the compiled editor keeps each field in its state and sends
 * it with every save as before; the CBK card reads its inputs at save time as before; the ID and IP cards keep their own
 * Save buttons and validation, which work as before once "Show fields" puts them back.
 * A WRONG value is never hidden: an address that is not the one the server accepts (empty, another host, another path, a
 * port, a query, spaces) stays a normal field and the summary names it with the expected value; a field once shown as wrong
 * stays shown for the visit, and a focused field is never hidden. An ID or IP card that could not load (its status shows
 * an error) or holds the focus stays on show. Idempotent: a pass that finds nothing to change writes nothing.
 * Self-contained on purpose (no variable of another block is used), so ops/release can splice this exact text into the
 * live file (scripts/make-trim-release.mjs). textContent only, inline styles and the compiled build's own classes.
 */
;(function () {   // leading ; - the block above ends in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaPayTrim) return   // double execution: a second copy of this file must not start a second set of observers
  try { Object.defineProperty(window, '__sportaPayTrim', { value: 1, enumerable: false, configurable: false }) } catch (e) { return }
  var CBK = 'data-sporta-cbk', IDS = 'data-sporta-knet-ids', IPS = 'data-sporta-tpay-ips'
  var TRIM = 'data-sporta-fixed'                 // the summary this block adds (value: the group name)
  var TRIM_HID = 'data-sporta-fixed-hidden'      // a field or card this block hid
  var TITLE = 'text-sm font-bold text-slate-900'
  var NOTE = 'mt-0.5 text-xs text-slate-500'
  var SPORTA_HOSTS = ['sporta.com.kw', 'www.sporta.com.kw']
  var KPG = '/kpg/PaymentHTTP.htm'
  var RESULT = '/payment/result'
  // [label text, allowed hosts, exact path or null, the value to show as expected]
  var FIXED = {
    knet: [
      ['Test gateway URL', ['kpaytest.com.kw'], KPG, 'https://kpaytest.com.kw' + KPG],
      ['Production gateway URL', ['kpay.com.kw'], KPG, 'https://kpay.com.kw' + KPG],
      ['Response URL', SPORTA_HOSTS, '/knet/callback.php', 'https://www.sporta.com.kw/knet/callback.php'],
      ['Error URL', SPORTA_HOSTS, '/knet/callback.php', 'https://www.sporta.com.kw/knet/callback.php'],
      ['Customer result page', SPORTA_HOSTS, RESULT, 'https://www.sporta.com.kw' + RESULT]
    ],
    // The fifth entry is the CBK card's Arabic caption (the same text as its FIELDS entry in the CBK block).
    cbk: [
      ['Test API base URL', ['pgtest.cbk.com'], null, 'https://pgtest.cbk.com', 'عنوان قاعدة واجهة الاختبار'],
      ['Production API base URL', ['pg.cbk.com'], null, 'https://pg.cbk.com', 'عنوان قاعدة واجهة الإنتاج'],
      ['Return URL (on sporta.com.kw)', SPORTA_HOSTS, '/pay/callback.php', 'https://www.sporta.com.kw/pay/callback.php', 'عنوان العودة (على sporta.com.kw)'],
      ['Customer result page URL', SPORTA_HOSTS, RESULT, 'https://www.sporta.com.kw' + RESULT, 'عنوان صفحة نتيجة الدفع للعميل']
    ]
  }
  // [English title, English note, Arabic title, Arabic note]
  var COPY = {
    knet: ['KNET addresses and IDs', 'The addresses have one correct value, set by the bank and by this shop; the Merchant ID and Terminal ID are kept for your records and are not used to take payment. None is shown as a field: use Show fields to change one. Everything is kept and sent unchanged with every save.',
      'عناوين KNET والمعرّفات', 'لكل عنوان قيمة صحيحة واحدة تحددها البنك والمتجر. معرّف التاجر ومعرّف الطرفية محفوظان للسجلات ولا يُستخدمان لتحصيل الدفع. لا يُعرض أي منها كحقل: استخدم «إظهار الحقول» لتغيير أحدها. يُحفظ كل شيء ويُرسل دون تغيير مع كل حفظ.'],
    cbk: ['CBK addresses and server IPs', 'The addresses have one correct value, set by CBK and by this shop; the server IPs are a record of what is registered with CBK and are not sent with payments. None is shown as a field: use Show fields to change one. Everything is kept and sent unchanged with every save.',
      'عناوين CBK وعناوين خوادم التاجر', 'لكل عنوان قيمة صحيحة واحدة تحددها CBK والمتجر. عناوين خوادم التاجر سجل لما هو مسجّل لدى CBK ولا تُرسل مع المدفوعات. لا يُعرض أي منها كحقل: استخدم «إظهار الحقول» لتغيير أحدها. يُحفظ كل شيء ويُرسل دون تغيير مع كل حفظ.']
  }
  var open = { knet: false, cbk: false }          // "Show fields" pressed (this visit only)
  var shownBad = typeof WeakSet === 'function' ? new WeakSet() : null
  /** The admin's language, read the way the other blocks read it: the nearest lang above the screen, else the page's. */
  function isAr() {
    var host = document.querySelector('main') || document.body
    var h = (host.closest && host.closest('[lang]')) || document.documentElement
    return /^ar/i.test(h.getAttribute('lang') || '')
  }
  /** English or Arabic text, by the admin's language. */
  function tr(en, ar) { return isAr() ? ar : en }
  /** The caption a field is shown under: the compiled English one for KNET, and the CBK card's own Arabic one when Arabic. */
  function capOf(rule) { return isAr() && rule[4] ? rule[4] : rule[0] }

  function cls(tag, className, text) {
    var n = document.createElement(tag)
    if (className) n.className = className
    if (text != null) n.textContent = text
    return n
  }
  function fixedOk(value, rule) {
    var v = String(value == null ? '' : value)
    if (!v || v !== v.trim() || /\s/.test(v)) return false
    var u
    try { u = new URL(v) } catch (e) { return false }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return false
    if (rule[1].indexOf(u.hostname.toLowerCase()) < 0) return false
    if (rule[2] !== null && u.pathname !== rule[2]) return false
    return true
  }
  // The address labels of a group, by their exact caption: the compiled KNET grid (outside every card an add-on adds) or the
  // CBK card's own grid.
  function fixedFields(scope, group) {
    var out = [], rules = FIXED[group]
    var labels = scope.querySelectorAll('label')
    for (var i = 0; i < labels.length; i++) {
      var lab = labels[i]
      if (group === 'cbk' ? !lab.closest('[' + CBK + ']') : lab.closest('[' + IDS + '],[' + IPS + '],[' + CBK + '],[' + TRIM + ']')) continue
      var span = lab.querySelector('span'), input = lab.querySelector('input')
      if (!span || !input) continue
      var caption = String(span.textContent || '').trim()
      for (var j = 0; j < rules.length; j++) if (rules[j][0] === caption || (rules[j][4] && rules[j][4] === caption)) out.push({ rule: rules[j], label: lab, input: input })
    }
    return out
  }
  // What to hide: the label, or the wrapper the compiled grid puts around a one-field cell (div.md:col-span-2 > label).
  function fixedTarget(lab) {
    var p = lab.parentElement
    if (p && p.tagName === 'DIV' && p.children.length === 1 && !p.classList.contains('grid')) return p
    return lab
  }
  function setHidden(node, hide) {
    if (hide) {
      if (node.getAttribute(TRIM_HID) !== '1') node.setAttribute(TRIM_HID, '1')
      if (node.style.display !== 'none') node.style.display = 'none'
    } else if (node.getAttribute(TRIM_HID) === '1') {
      node.removeAttribute(TRIM_HID)
      node.style.display = ''
    }
  }
  // An ID or IP card: its fields as [caption, saved value], and whether it may be folded.
  function recordCard(card) {
    if (!card) return null
    var rows = []
    var labels = card.querySelectorAll('label')
    for (var i = 0; i < labels.length; i++) {
      var head = labels[i].querySelector('span'), input = labels[i].querySelector('input')
      if (!head || !input || input.type === 'checkbox') continue
      var t = head.firstChild && head.firstChild.nodeType === 3 ? head.firstChild.nodeValue : head.textContent   // the "Active" badge is a child span
      rows.push([String(t || '').trim(), String(input.value || '').trim()])
    }
    var status = card.querySelector(':scope > div > p')
    var st = status ? String(status.textContent || '').trim() : ''
    var err = !!status && /190, 18, 60|be123c/i.test(status.style.color || '') && st !== ''
    var loading = st === 'Loading…'
    var focused = card.contains(document.activeElement)
    return { card: card, rows: rows, err: err, loading: loading, foldable: !err && !focused }
  }
  function summary(group, parent, after, list, rec) {
    var box = parent.querySelector(':scope > [' + TRIM + '="' + group + '"]')
    if (!list.length && !rec) { if (box) box.remove(); return }
    var sig = (open[group] ? 'open|' : 'shut|') + list.map(function (f) { return (f.ok ? '1' : '0') + f.rule[0] + '=' + f.input.value }).join('|') +
      '#' + (rec ? (rec.err ? 'E' : rec.loading ? 'L' : '') + rec.rows.map(function (r) { return r[0] + '=' + r[1] }).join('|') : '')
    if (!box) {
      box = cls('div', 'mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3')
      box.setAttribute(TRIM, group)
    }
    if (box.parentNode !== parent || box.previousElementSibling !== after) parent.insertBefore(box, after.nextSibling)
    if (box.getAttribute('data-sig') === sig) return
    box.setAttribute('data-sig', sig)
    while (box.firstChild) box.removeChild(box.firstChild)
    var top = cls('div', '')
    top.style.cssText = 'display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:.5rem .75rem'
    var copy = cls('div', 'min-w-0')
    copy.style.flex = '1 1 14rem'
    copy.appendChild(cls('p', TITLE, tr(COPY[group][0], COPY[group][2])))
    copy.appendChild(cls('p', NOTE, tr(COPY[group][1], COPY[group][3])))
    top.appendChild(copy)
    var btn = cls('button', 'min-h-11 rounded-xl border border-indigo-200 bg-white px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50', open[group] ? tr('Hide fields', 'إخفاء الحقول') : tr('Show fields', 'إظهار الحقول'))
    btn.type = 'button'
    btn.setAttribute('aria-expanded', open[group] ? 'true' : 'false')
    btn.addEventListener('click', function () { open[group] = !open[group]; schedule() })
    top.appendChild(btn)
    box.appendChild(top)
    var rows = cls('div', '')
    rows.style.cssText = 'margin-top:.5rem;display:grid;gap:.35rem'
    function row(caption, value, muted) {
      var r = cls('div', '')
      r.style.cssText = 'display:flex;flex-wrap:wrap;gap:.1rem .75rem;min-width:0'
      r.appendChild(cls('span', 'text-xs font-bold text-slate-600', caption))
      var v = cls('span', muted ? 'text-xs text-slate-500' : 'font-mono text-xs text-slate-600', value)
      v.setAttribute('dir', 'ltr')
      v.style.overflowWrap = 'anywhere'
      v.style.minWidth = '0'
      r.appendChild(v)
      rows.appendChild(r)
    }
    list.forEach(function (f) { if (f.ok) row(capOf(f.rule), f.input.value, false) })
    if (rec) {
      if (rec.err) {
        // role=status: the line is new when it appears, so a screen reader is told about the problem
        var e = cls('div', 'text-xs font-bold', tr('The ' + (group === 'knet' ? 'Merchant ID and Terminal ID' : 'Merchant Server IP') + ' panel could not load; it is shown below.',
          'تعذّر تحميل لوحة ' + (group === 'knet' ? 'معرّف التاجر ومعرّف الطرفية' : 'عنوان خادم التاجر') + '؛ وهي معروضة أدناه.'))
        e.setAttribute('role', 'status')
        e.style.color = '#be123c'
        rows.appendChild(e)
      } else rec.rows.forEach(function (r) { row(r[0], rec.loading ? tr('loading…', 'جارٍ التحميل…') : (r[1] || tr('not set', 'غير مضبوط')), rec.loading || !r[1]) })
    }
    list.forEach(function (f) {
      if (f.ok) return
      var val = !!f.input.value.trim()
      var msg = tr(f.rule[0] + ' is shown as a field above: it ' + (val ? 'is not' : 'is empty and should be') + ' ' + f.rule[3] + '.',
        capOf(f.rule) + ' معروض كحقل أعلاه: ' + (val ? 'القيمة ليست ' : 'الحقل فارغ ويجب أن يكون ') + f.rule[3] + '.')
      var p = cls('div', 'text-xs font-bold', msg)
      p.setAttribute('role', 'status')
      p.style.color = '#be123c'
      rows.appendChild(p)
    })
    box.appendChild(rows)
  }
  function group(name, scope, parent, after, card) {
    var list = fixedFields(scope, name)
    list.forEach(function (f) {
      f.ok = fixedOk(f.input.value, f.rule)
      if (!f.ok && shownBad && f.input.value) shownBad.add(f.input)   // an EMPTY field is not pinned: the editor may fill it a moment later
      var keep = (shownBad && shownBad.has(f.input)) || document.activeElement === f.input
      setHidden(fixedTarget(f.label), f.ok && !keep && !open[name])
    })
    var rec = recordCard(card)
    if (rec) setHidden(rec.card, rec.foldable && !open[name])
    summary(name, parent, after, list, rec)
  }
  function scan() {
    var row = document.querySelector('form.payment-gateway-editor .payment-knet-toggle-row')
    var form = row && row.closest('form.payment-gateway-editor')
    if (!form) return
    var grid = form.querySelector(':scope > .grid')
    if (grid) group('knet', form, form, grid, form.querySelector('[' + IDS + ']'))
    var cbk = form.querySelector('[' + CBK + ']')
    var cbkGrid = cbk && cbk.querySelector(':scope > .grid')
    if (cbkGrid) group('cbk', cbk, cbk, cbkGrid, form.querySelector('[' + IPS + ']'))
  }

  var queued = false
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; try { scan() } catch (e) { /* a failed pass must not be a console error on every DOM change */ } }) }
  // attributes 'value' as well: React writes the value attribute of a controlled input when its state arrives or changes,
  // which is what this block reads (a property-only change is not a mutation). The add-on cards that set .value also
  // change their status line in the same step, which is a childList mutation.
  function start() { scan(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] }) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN PAYMENTS TRIM - end ========================================= */

/* ===== ADMIN SITE CONTENT - begin ========================================
 * 8. Site content (owner request 2026-11-10: "make backends full dynamic").
 *
 * A "Site content" entry in the compiled live admin where the owner changes the
 * fixed words the storefront shows, and the shop's contact details. The
 * storefront is a compiled build with no source, so nothing is edited where it is
 * written: this screen stores RULES ("on this page, in this language, where the
 * page says X, say Y") and public/sporta-features.js (its "SITE CONTENT" block)
 * applies them to text nodes in the shopper's browser. Every rule about what may
 * be stored lives on the SERVER (store_site_content_save in
 * dropin/php-store/store.php); this block draws, collects and reports.
 *
 * Routes, with the admin session cookie and the X-Sporta-Admin header:
 *   GET  content              -> { v, overrides[], contact{}, pages[], limits{}, returns{} }
 *   POST content_save         { v, overrides[], contact{} } -> { v, overrides[], contact{} }
 *   POST returns_policy_save  { window_days, allow_return, allow_exchange, intro_en, intro_ar, points_en[], points_ar[] }
 *                             -> the same, as stored (only sent when that card was changed)
 * and one public read used only for a product page: GET /api/api.php?r=products
 * (to learn one product's address when "Product pages" is chosen).
 *
 * WHEN THE SERVER DOES NOT HAVE THE ROUTE (this file deployed before the API):
 * the first GET content answers 404 and this block adds NOTHING to the page and
 * asks nothing else for the rest of the visit. Any other answer keeps the entry.
 *
 * THE ENTRY is made exactly like "Abandoned orders" above (read its comment):
 * nodes are only ADDED (a nav button, a tile in the phone menu, a second title in
 * the phone header, one <section> in <main>), React's own nodes are never removed,
 * moved or re-texted, the tab React considers current is hidden by CSS while this
 * panel is open, and a click on any other nav button closes this panel before
 * React handles the click. The two panels close each other the same way. Opening
 * pushes ?tab=content.
 *
 * "LOAD TEXTS" opens the chosen storefront page in a same-origin iframe that is
 * off screen (path?lang=xx&sporta_content=off: the storefront script does nothing
 * with that in the address, so the page shows the build's ORIGINAL words), waits
 * until its text stops changing, and lists every text the storefront script could
 * change: text nodes only, squashed the same way, never inside a field, a script
 * or a style, never a price, a bare number or a currency mark. The iframe is
 * sandboxed (scripts and same-origin only: it cannot navigate this window, open a
 * window or submit a form) and is removed as soon as it has been read. The owner
 * types a replacement beside a line; rules already saved are listed underneath and
 * can be removed; a text that only appears after a tap (a message, a menu) can be
 * added by hand. Nothing is sent until Save.
 *
 * RETURNS & EXCHANGE (owner request 2026-11-10) is a card of the same screen: the
 * return window in days and the two switches are RULES the server enforces
 * (returns.php: the window decides standard / manual review, a switched-off
 * action is refused on submit); the intro and the points are the wording of
 * /returns and /exchange, in Arabic and English, shown by sporta-features.js.
 * Empty wording keeps the page's own text.
 *
 * Everything shown is built with createElement + textContent, never as markup.
 * Labels are in English and Arabic. The Save bar block above finds this panel's
 * Save (a submit button in a form with fields) like any other screen's.
 */
;(function () {   // leading ; - the block above may end in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaSiteContent) return
  try { Object.defineProperty(window, '__sportaSiteContent', { value: { version: 1 }, enumerable: false, configurable: false }) } catch (e) { return }

  var API = '/api/admin.php'
  var TAB = 'content'
  var PAGE = 'data-sporta-content'          // the section
  var NAVMARK = 'data-sporta-sc-nav'        // our nav button / menu tile
  var CURMARK = 'data-sporta-sc-cur'        // React's current tab, while ours is open
  var OPEN = 'data-sporta-sc'               // on <body>: "open"
  var TITLE = 'data-sporta-sc-title'
  var OTHER_NAV = 'data-sporta-ab-nav'      // the Abandoned orders entry (another add-on's node, not React's)
  var NAME = 'Site content · محتوى الموقع'
  var PAGE_NAMES = {
    '*': 'Every page · كل الصفحات', '/': 'Home · الرئيسية', '/shop': 'Shop · المتجر', '/product/*': 'Product pages · صفحات المنتجات',
    '/about': 'About · من نحن', '/contact': 'Contact · اتصل بنا', '/support': 'Support · الدعم', '/account': 'Account · الحساب',
    '/wishlist': 'Wishlist · المفضلة', '/track': 'Track order · تتبع الطلب', '/returns': 'Returns · الاسترجاع', '/exchange': 'Exchange · الاستبدال',
    '/terms': 'Terms · الشروط', '/privacy': 'Privacy · الخصوصية', '/review': 'Review · التقييم'
  }
  var LANGS = { ar: 'Arabic · العربية', en: 'English · الإنجليزية' }
  var CONTACT = [
    ['phone', 'Phone · الهاتف', 'tel', '+96522091914', 20],
    ['whatsapp', 'WhatsApp number · رقم واتساب', 'tel', '96522091914', 20],
    ['email', 'Email · البريد الإلكتروني', 'email', 'cs@sporta.com.kw', 120],
    ['address_en', 'Address (English) · العنوان بالإنجليزية', 'text', '', 200],
    ['address_ar', 'Address (Arabic) · العنوان بالعربية', 'text', '', 200],
    ['instagram', 'Instagram', 'text', '@sporta.kw', 120],
    ['tiktok', 'TikTok', 'text', '@sporta.kw', 120],
    ['snapchat', 'Snapchat', 'text', 'username', 120],
    ['x', 'X (Twitter)', 'text', 'username', 120]
  ]
  var MSG = {
    not_signed_in: 'Your sign-in has ended. Sign in again, then reopen this screen. · انتهت الجلسة، سجّل الدخول من جديد.',
    bad_request: 'The save was refused. Reload the page and try again. · رُفض الحفظ، أعد تحميل الصفحة.',
    request_too_large: 'Too much text in one save. Remove some changes. · النص كثير جدًا في حفظ واحد.',
    content_too_large: 'All the changes together are too large to store (about 60,000 bytes). Shorten or remove some. · مجموع التغييرات أكبر من المسموح.',
    content_changed: 'This was changed in another window since you opened it. Press "Reload from server", then make your change again. · تم التعديل من نافذة أخرى، أعد التحميل.',
    too_many_content_overrides: 'There are more than 300 changes. Remove some. · أكثر من 300 تغيير.',
    invalid_content_page: 'One change names a page that cannot be edited here. · صفحة غير مسموح بتعديلها.',
    invalid_content_lang: 'One change has no language. · تغيير بلا لغة.',
    invalid_content_match: 'One change targets a price or a number. Prices come from the catalogue and cannot be reworded here. · لا يمكن تعديل الأسعار أو الأرقام من هنا.',
    price_in_content_text: 'A replacement contains a price (a number with KD / KWD / د.ك). Prices come from the catalogue and the promo bar, not from here. · لا يمكن كتابة سعر في النص البديل.',
    missing_content_match: 'One change has no original text. · تغيير بلا نص أصلي.',
    too_long_content_match: 'An original text is longer than 400 characters and cannot be changed here. · النص الأصلي أطول من 400 حرف.',
    too_long_content_text: 'A replacement is longer than 2000 characters. · النص البديل أطول من 2000 حرف.',
    invalid_contact_phone: 'The phone must be digits, with + in front for the country code. · رقم الهاتف غير صحيح.',
    invalid_contact_whatsapp: 'The WhatsApp number must be the full number with the country code, digits only (96522091914). · رقم واتساب غير صحيح.',
    invalid_contact_email: 'That is not an email address. · البريد الإلكتروني غير صحيح.',
    invalid_contact_instagram: 'Instagram: type the username, or the https://www.instagram.com/... address. · اسم المستخدم في إنستغرام غير صحيح.',
    invalid_contact_tiktok: 'TikTok: type the username, or the https://www.tiktok.com/@... address. · اسم المستخدم في تيك توك غير صحيح.',
    invalid_contact_snapchat: 'Snapchat: type the username, or the https://www.snapchat.com/add/... address. · اسم المستخدم في سناب شات غير صحيح.',
    invalid_contact_x: 'X: type the username, or the https://x.com/... address. · اسم المستخدم في إكس غير صحيح.',
    too_long_contact_address_en: 'The English address is longer than 200 characters. · العنوان أطول من 200 حرف.',
    too_long_contact_address_ar: 'The Arabic address is longer than 200 characters. · العنوان أطول من 200 حرف.',
    invalid_returns_window: 'The return window must be a whole number of days from 1 to 60. · مدة الإرجاع من 1 إلى 60 يومًا.',
    returns_action_required: 'Returns and exchanges cannot both be switched off. · لا يمكن إيقاف الإرجاع والاستبدال معًا.',
    too_many_returns_points: 'At most 8 points in each language. · 8 نقاط كحد أقصى لكل لغة.',
    missing_returns_point: 'A point is empty. Remove it or type its text. · توجد نقطة فارغة.',
    too_long_returns_point: 'A point is longer than 300 characters. · نقطة أطول من 300 حرف.',
    too_long_returns_intro_en: 'The English intro is longer than 400 characters. · المقدمة أطول من 400 حرف.',
    too_long_returns_intro_ar: 'The Arabic intro is longer than 400 characters. · المقدمة أطول من 400 حرف.'
  }
  var NOT_YET = 'Site content is not available until the next update of the shop server. Nothing is wrong with your account. · المحتوى غير متاح قبل التحديث القادم لخادم المتجر. لا خطأ في حسابك.'
  var SKIP ='script,style,noscript,template,textarea,select,option,input,[contenteditable]:not([contenteditable="false"])'
  // the same three tests the storefront script applies before it will touch a text
  var AD0 = String.fromCharCode(0x660), AD9 = String.fromCharCode(0x669)
  var CUR = '(?:KWD|K\\.?\\s?D\\.?|' + String.fromCharCode(0x62F) + '\\.?\\s?' + String.fromCharCode(0x643) + '\\.?)'
  var DIG = '[0-9' + AD0 + '-' + AD9 + ']'
  var LET = 'A-Za-z' + String.fromCharCode(0x600) + '-' + String.fromCharCode(0x6FF)
  var PRICE = new RegExp('(?:' + DIG + '[0-9' + AD0 + '-' + AD9 + '.,' + String.fromCharCode(0x66B, 0x66C) + ']*\\s*' + CUR + '(?![' + LET + ']))|(?:(?:^|[^' + LET + '])' + CUR + '\\s*' + DIG + ')', 'i')
  var NUMBER_ONLY = new RegExp('^[0-9' + AD0 + '-' + AD9 + '\\s.,:+\\-\\/%]+$')
  var CUR_ONLY = new RegExp('^' + CUR + '$', 'i')
  var CONTROL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']', 'g')

  // ------------------------------------------------------------------- state
  var S = {
    open: false, loaded: false, loading: false, saving: false,
    v: 0, pages: [], limits: { overrides: 300, match: 400, text: 2000, bytes: 60000 },
    saved: {},            // key -> text, as the server holds it
    draft: {},            // key -> text, what Save would send
    contact: {}, contactSaved: {},
    ret: null, retSaved: '',   // the returns policy being edited, and the server's copy as JSON
    page: '/', lang: 'ar',
    rows: [],             // the texts read from the page: { text, visible }
    rowsFor: '',          // "page\nlang" the rows were read for
    reading: false, showHidden: false, filter: '',
    note: null            // { text, bad }
  }
  var probeState = 'unknown'     // unknown | present | absent
  var probing = false, firstDoc = null
  var wantOpen = false, autoOpened = false
  var prevUrl = ''
  var panel = null, refs = null, styleEl = null
  var queued = false, frame = null, frameSeq = 0

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
    ;['M4 20h4L19 9l-4-4L4 16v4', 'M13.5 6.5l4 4', 'M13 20h7'].forEach(function (d) {
      var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p)
    })
    return s
  }
  /** The storefront script's squash (and the server's): ASCII white space only. */
  function squash(s) {
    return String(s == null ? '' : s).replace(/[ \t\n\r\f\v]+/g, ' ').replace(CONTROL, '').replace(/^ +| +$/g, '')
  }
  function keyOf(page, lang, match) { return page + '\n' + lang + '\n' + match }
  function parts(key) { var a = key.split('\n'); return { page: a[0], lang: a[1], match: a.slice(2).join('\n') } }
  function count(o) { var n = 0; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n++; return n }
  function same(a, b) {
    var k
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k) && a[k] !== b[k]) return false
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k) && a[k] !== b[k]) return false
    return true
  }
  function contentDirty() { return !same(S.draft, S.saved) || !same(S.contact, S.contactSaved) }
  /** The size of the content document as the server measures it: json_encode (escapes "/" and U+2028/2029, UTF-8 bytes) plus the 12 bytes it reserves for the version. */
  function contentBytes(list) {
    var json = JSON.stringify({ v: 0, overrides: list, contact: S.contact }).replace(/\//g, '\\/').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    var n = 0
    for (var i = 0; i < json.length; i++) {
      var c = json.charCodeAt(i)
      if (c < 0x80) n += 1
      else if (c < 0x800) n += 2
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < json.length) { n += 4; i++ }
      else n += 3
    }
    return n + 12
  }
  /** The returns policy as Save would send it: empty point rows are not points. */
  function retBody() {
    var r = S.ret || {}
    var pts = function (a) { return (a || []).map(squash).filter(Boolean) }
    return {
      window_days: r.window_days, allow_return: !!r.allow_return, allow_exchange: !!r.allow_exchange,
      intro_en: squash(r.intro_en), intro_ar: squash(r.intro_ar), points_en: pts(r.points_en), points_ar: pts(r.points_ar)
    }
  }
  function retDirty() { return !!S.ret && JSON.stringify(retBody()) !== S.retSaved }
  function dirty() { return contentDirty() || retDirty() }
  function adoptReturns(r) {
    r = r && typeof r === 'object' ? r : {}
    var pts = function (a) { return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string' }).slice(0, 8) : [] }
    S.ret = {
      window_days: typeof r.window_days === 'number' ? r.window_days : 14,
      allow_return: r.allow_return !== false, allow_exchange: r.allow_exchange !== false,
      intro_en: typeof r.intro_en === 'string' ? r.intro_en : '', intro_ar: typeof r.intro_ar === 'string' ? r.intro_ar : '',
      points_en: pts(r.points_en), points_ar: pts(r.points_ar)
    }
    S.retSaved = JSON.stringify(retBody())
  }
  function pageName(p) { return PAGE_NAMES[p] || p }
  /** The admin's language, read the way the other blocks read it (the nearest lang above the screen, else the page's). */
  function isAr() {
    var host = document.querySelector('main') || document.body
    var h = (host.closest && host.closest('[lang]')) || document.documentElement
    return /^ar/i.test(h.getAttribute('lang') || '')
  }
  /** English or Arabic text, by the admin's language (used where a label is an accessible name only). */
  function tr(en, ar) { return isAr() ? ar : en }
  function token(b) { var e = b && b.error; return typeof e === 'string' && /^[a-z_]{1,60}$/.test(e) ? e : '' }

  // ------------------------------------------------------------ admin requests
  function request(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, body: j, retryAfter: r.headers.get('Retry-After') } })
    }).catch(function () { return { ok: false, status: 0, body: null, retryAfter: null } })
  }
  function failText(r) {
    var code = token(r.body)
    if (r.status === 0) return 'Could not reach the server. Check the connection and try again. · تعذّر الاتصال بالخادم.'
    if (r.status === 401) return MSG.not_signed_in
    if (r.status === 404) return NOT_YET
    if (r.status === 429) return 'Too many requests. Wait a minute, then try again. · طلبات كثيرة، انتظر دقيقة.'
    if (MSG[code]) return MSG[code]
    return 'The server could not do that (' + (code || 'HTTP ' + r.status) + '). · تعذّر الخادم من تنفيذ ذلك (' + (code || 'HTTP ' + r.status) + ').'
  }
  /** Take a server document (GET content or the answer to a save) as the new baseline. */
  function adopt(doc) {
    S.v = typeof doc.v === 'number' ? doc.v : 0
    if (Array.isArray(doc.pages) && doc.pages.length) S.pages = doc.pages.filter(function (p) { return typeof p === 'string' && p.length <= 40 })
    if (!S.pages.length) S.pages = Object.keys(PAGE_NAMES)
    if (doc.limits && typeof doc.limits === 'object') {
      ;['overrides', 'match', 'text', 'bytes'].forEach(function (k) { if (typeof doc.limits[k] === 'number' && doc.limits[k] > 0) S.limits[k] = doc.limits[k] })
    }
    S.saved = {}; S.draft = {}
    ;(Array.isArray(doc.overrides) ? doc.overrides : []).forEach(function (o) {
      if (!o || typeof o.page !== 'string' || typeof o.lang !== 'string' || typeof o.match !== 'string' || typeof o.text !== 'string') return
      var k = keyOf(o.page, o.lang, o.match)
      S.saved[k] = o.text; S.draft[k] = o.text
    })
    S.contact = {}; S.contactSaved = {}
    CONTACT.forEach(function (f) {
      var v = doc.contact && typeof doc.contact[f[0]] === 'string' ? doc.contact[f[0]] : ''
      S.contact[f[0]] = v; S.contactSaved[f[0]] = v
    })
    if (doc.returns !== undefined || !S.ret) adoptReturns(doc.returns)
    S.loaded = true
  }
  function probe() {
    if (probeState !== 'unknown' || probing) return
    probing = true
    request('content').then(function (r) {
      probing = false
      var absent = r.status === 404 || r.status === 405 || r.status === 501 || (r.ok && !(r.body && typeof r.body === 'object'))
      probeState = absent ? 'absent' : 'present'
      if (r.ok && r.body && typeof r.body === 'object') firstDoc = r.body
      schedule()
    })
  }
  function load() {
    if (S.loading) return
    S.loading = true; S.note = { text: 'Loading… · جارٍ التحميل…', bad: false }
    draw()
    request('content').then(function (r) {
      S.loading = false
      if (r.ok && r.body && typeof r.body === 'object') { adopt(r.body); S.note = null }
      else S.note = { text: failText(r), bad: true }
      syncContact(); syncReturns(); draw()
    })
  }
  /** The text rules as Save would send them (one entry per rule, in key order). */
  function draftList() {
    var list = []
    for (var k in S.draft) {
      if (!Object.prototype.hasOwnProperty.call(S.draft, k)) continue
      var p = parts(k)
      list.push({ page: p.page, lang: p.lang, match: p.match, text: S.draft[k] })
    }
    return list
  }
  function save() {
    if (S.saving || !S.loaded) return
    var list = draftList()
    if (list.length > S.limits.overrides) { S.note = { text: MSG.too_many_content_overrides, bad: true }; draw(); return }
    // The server refuses the whole document above its byte limit (store_site_content_save). Refuse here, before the request,
    // with the same message the server's answer would give.
    if (contentDirty() && contentBytes(list) > S.limits.bytes) { S.note = { text: MSG.content_too_large, bad: true }; draw(); return }
    var days = S.ret ? S.ret.window_days : 14
    if (retDirty() && !(typeof days === 'number' && days % 1 === 0 && days >= 1 && days <= 60)) { S.note = { text: MSG.invalid_returns_window, bad: true }; draw(); return }
    if (retDirty() && !S.ret.allow_return && !S.ret.allow_exchange) { S.note = { text: MSG.returns_action_required, bad: true }; draw(); return }
    S.saving = true; S.note = { text: 'Saving… · جارٍ الحفظ…', bad: false }
    draw()
    var DONE = 'Saved. Shoppers see it the next time they open a page. · تم الحفظ. يظهر للزوار عند فتح الصفحة التالية.'
    // two rows on the server, so two requests, one after the other; each only when its part was changed
    var first = contentDirty() ? request('content_save', { v: S.v, overrides: list, contact: S.contact }) : Promise.resolve(null)
    first.then(function (r) {
      if (r) {
        if (!(r.ok && r.body && typeof r.body === 'object' && Array.isArray(r.body.overrides))) { S.saving = false; S.note = { text: failText(r), bad: true }; draw(); return }
        adopt(r.body); syncContact()
      }
      if (!retDirty()) { S.saving = false; S.note = { text: DONE, bad: false }; draw(); return }
      request('returns_policy_save', retBody()).then(function (q) {
        S.saving = false
        if (q.ok && q.body && typeof q.body === 'object' && typeof q.body.window_days === 'number') {
          adoptReturns(q.body); syncReturns()
          S.note = { text: DONE, bad: false }
        } else S.note = { text: (r ? 'The texts were saved, but the returns settings were not: ' : '') + failText(q), bad: true }
        draw()
      })
    })
  }

  // ------------------------------------------------- reading a storefront page
  function dropFrame() {
    frameSeq++
    if (frame && frame.parentNode) frame.parentNode.removeChild(frame)
    frame = null
  }
  /** Every text of `doc` the storefront script could change, in page order, each once. */
  function collect(doc) {
    var out = [], seen = {}, win = doc.defaultView
    if (!doc.body) return out
    var w = doc.createTreeWalker(doc.body, 4, null), n
    while ((n = w.nextNode())) {
      var host = n.parentNode
      if (!host || host.nodeType !== 1 || (host.closest && host.closest(SKIP))) continue
      var s = squash(n.nodeValue)
      if (!s || s.length > S.limits.match || PRICE.test(s) || NUMBER_ONLY.test(s) || CUR_ONLY.test(s)) continue
      var up = host, split = false
      for (var i = 0; up && up.nodeType === 1 && i < 2; i++, up = up.parentNode) {
        var t = up.textContent || ''
        if (t.length > 80) break
        if (PRICE.test(squash(t))) { split = true; break }
      }
      if (split) continue
      var visible = false
      try { visible = host.getClientRects().length > 0 && win.getComputedStyle(host).visibility !== 'hidden' } catch (e) { /* counted as hidden */ }
      if (seen[' ' + s] !== undefined) { if (visible) out[seen[' ' + s]].visible = true; continue }
      seen[' ' + s] = out.length
      out.push({ text: s, visible: visible })
    }
    return out
  }
  function frameUrl(done) {
    if (S.page === '*') { done('/'); return }
    if (S.page !== '/product/*') { done(S.page); return }
    // one product page stands for all of them: the first product the shop lists
    fetch('/api/api.php?r=products', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null }).then(function (j) {
      var slug = Array.isArray(j) && j[0] && typeof j[0].slug === 'string' && /^[a-z0-9][a-z0-9\-]{0,120}$/.test(j[0].slug) ? j[0].slug : ''
      done(slug ? '/product/' + encodeURIComponent(slug) : '')
    }).catch(function () { done('') })
  }
  function readPage() {
    if (S.reading || !S.loaded) return
    var forKey = S.page + '\n' + S.lang
    S.reading = true; S.rows = []; S.rowsFor = ''
    S.note = { text: 'Opening the page and reading its text… · جارٍ فتح الصفحة وقراءة النصوص…', bad: false }
    draw()
    dropFrame()
    var my = frameSeq
    var finish = function (rows, problem) {
      if (my !== frameSeq) return
      dropFrame()
      S.reading = false
      if (problem) S.note = { text: problem, bad: true }
      else {
        S.rows = rows; S.rowsFor = forKey
        S.note = { text: rows.length + ' texts found on ' + pageName(S.page) + ' (' + LANGS[S.lang] + '). Type a replacement beside any line, then Save. · اكتب النص البديل بجانب أي سطر ثم احفظ.', bad: false }
      }
      draw()
    }
    frameUrl(function (base) {
      if (my !== frameSeq) return
      // a same-origin PATH and nothing else: one of the server's page names, or /product/<slug>
      if (!base || !/^\/(?!\/)[a-z0-9\/\-]{0,140}$/.test(base)) { finish(null, 'Could not find a page to read. · تعذّر العثور على الصفحة.'); return }
      var f = document.createElement('iframe')
      f.setAttribute('data-sporta-sc-frame', '')
      f.setAttribute('aria-hidden', 'true'); f.setAttribute('tabindex', '-1'); f.setAttribute('title', 'Storefront page being read')
      f.setAttribute('sandbox', 'allow-same-origin allow-scripts')
      // laid out (so "visible" can be measured) but off screen and inert
      f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:900px;border:0;opacity:0;pointer-events:none'
      f.src = base + '?lang=' + encodeURIComponent(S.lang === 'en' ? 'en' : 'ar') + '&sporta_content=off'
      frame = f
      var last = -1, stable = 0, ticks = 0
      var poll = function () {
        if (my !== frameSeq) return
        ticks++
        var doc = null
        try { doc = f.contentDocument } catch (e) { doc = null }
        var ready = doc && doc.body && doc.readyState === 'complete' && doc.location && doc.location.href !== 'about:blank'
        if (ready) {
          var rows = []
          try { rows = collect(doc) } catch (e) { rows = [] }
          var size = 0
          for (var i = 0; i < rows.length; i++) size += rows[i].text.length
          if (rows.length && size === last) stable++; else stable = 0
          last = size
          if (stable >= 3) { finish(rows, null); return }
          if (ticks >= 40) { finish(rows.length ? rows : null, rows.length ? null : 'The page did not show any text. Try again. · لم يظهر نص في الصفحة، حاول مرة أخرى.'); return }
        } else if (ticks >= 40) { finish(null, 'The page could not be opened here. Try again. · تعذّر فتح الصفحة، حاول مرة أخرى.'); return }
        setTimeout(poll, 400)
      }
      document.body.appendChild(f)
      setTimeout(poll, 400)
    })
  }

  // ------------------------------------------------------------------ drawing
  function btn(cls, text, onClick) {
    var b = el('button', 'ssc-btn' + (cls ? ' ' + cls : ''), text)
    b.type = 'button'
    if (onClick) b.addEventListener('click', onClick)
    return b
  }
  function field(label, control, cls) {
    var l = el('label', 'ssc-field' + (cls ? ' ' + cls : ''))
    l.appendChild(el('span', 'ssc-lab', label)); l.appendChild(control)
    return l
  }
  function setDraft(key, value) {
    var v = squash(value)
    if (v) S.draft[key] = v; else delete S.draft[key]
  }
  /** One line of the page: the build's words, and the owner's. */
  function rowFor(r) {
    var here = keyOf(S.page, S.lang, r.text), all = keyOf('*', S.lang, r.text)
    var scope = S.draft[here] !== undefined || S.page === '*' ? 'page' : S.draft[all] !== undefined ? 'all' : 'page'
    var key = function () { return scope === 'all' ? all : here }
    var li = el('li', 'ssc-row')
    var orig = el('p', 'ssc-orig', r.text); orig.setAttribute('dir', 'auto')
    li.appendChild(orig)
    if (!r.visible) li.appendChild(el('span', 'ssc-tag', 'Not on screen until opened · غير ظاهر حتى يُفتح'))
    var ta = el('textarea', 'ssc-new'); ta.rows = 2; ta.maxLength = S.limits.text; ta.setAttribute('dir', 'auto')
    ta.placeholder = 'Replacement (leave empty to keep the original) · النص البديل'
    ta.setAttribute('aria-label', tr('Replacement for: ', 'البديل عن: ') + r.text.slice(0, 80))
    ta.value = S.draft[key()] !== undefined ? S.draft[key()] : ''
    ta.addEventListener('input', function () { setDraft(key(), ta.value); drawFoot() })
    li.appendChild(ta)
    if (S.page !== '*') {
      var sel = el('select', 'ssc-scope')
      sel.setAttribute('aria-label', tr('Where this change applies', 'أين يُطبَّق هذا التغيير'))
      ;[['page', 'This page only · هذه الصفحة فقط'], ['all', 'Every page · كل الصفحات']].forEach(function (o) {
        var op = el('option', '', o[1]); op.value = o[0]; sel.appendChild(op)
      })
      sel.value = scope
      sel.addEventListener('change', function () {
        var text = S.draft[key()]
        delete S.draft[key()]
        scope = sel.value
        if (text !== undefined) S.draft[key()] = text
        drawFoot()
      })
      li.appendChild(sel)
    }
    return li
  }
  function drawRows() {
    var box = refs.rows
    box.textContent = ''
    var current = S.rowsFor === S.page + '\n' + S.lang
    refs.rowsTools.hidden = !current
    if (!current) {
      box.appendChild(el('p', 'ssc-hint', S.reading ? 'Reading… · جارٍ القراءة…' : 'Choose a page and a language, then press "Load texts". · اختر الصفحة واللغة ثم اضغط «تحميل النصوص».'))
      return
    }
    var q = S.filter.toLowerCase(), ul = el('ul', 'ssc-list'), shown = 0
    S.rows.forEach(function (r) {
      if (!r.visible && !S.showHidden) return
      if (q && r.text.toLowerCase().indexOf(q) < 0) return
      ul.appendChild(rowFor(r)); shown++
    })
    if (shown) box.appendChild(ul)
    else box.appendChild(el('p', 'ssc-hint', 'No text matches. · لا يوجد نص مطابق.'))
  }
  /** Every rule Save would send, across all pages, with Remove. */
  function drawRules() {
    var box = refs.rules
    box.textContent = ''
    var keys = Object.keys(S.draft).sort()
    refs.rulesCount.textContent = keys.length + ' / ' + S.limits.overrides
    if (!keys.length) { box.appendChild(el('p', 'ssc-hint', 'No changes yet. The shop shows its original text. · لا توجد تغييرات بعد.')); return }
    var onPage = {}, known = S.rowsFor === S.page + '\n' + S.lang
    S.rows.forEach(function (r) { onPage[' ' + r.text] = true })
    var ul = el('ul', 'ssc-list')
    keys.forEach(function (k) {
      var p = parts(k), li = el('li', 'ssc-rule')
      li.appendChild(el('span', 'ssc-where', pageName(p.page) + ' — ' + (LANGS[p.lang] || p.lang)))
      var a = el('p', 'ssc-orig', p.match); a.setAttribute('dir', 'auto'); li.appendChild(a)
      var b = el('p', 'ssc-repl', S.draft[k]); b.setAttribute('dir', 'auto'); li.appendChild(b)
      if (S.saved[k] === undefined) li.appendChild(el('span', 'ssc-tag ssc-tag--new', 'Not saved yet · لم يُحفظ بعد'))
      else if (S.saved[k] !== S.draft[k]) li.appendChild(el('span', 'ssc-tag ssc-tag--new', 'Edited, not saved yet · مُعدّل ولم يُحفظ'))
      if (known && p.lang === S.lang && (p.page === S.page || (p.page === '*' && S.page === '*')) && !onPage[' ' + p.match]) {
        li.appendChild(el('span', 'ssc-tag ssc-tag--warn', 'This text was not found on the page just read; the change may no longer apply. · لم يُعثر على هذا النص في الصفحة.'))
      }
      var rm = btn('ssc-btn--small', 'Remove · إزالة', function () { delete S.draft[k]; draw() })
      rm.setAttribute('aria-label', tr('Remove the change for: ', 'إزالة التغيير الخاص بـ: ') + p.match.slice(0, 80))
      li.appendChild(rm)
      ul.appendChild(li)
    })
    box.appendChild(ul)
  }
  function drawFoot() {
    if (!refs) return
    var d = dirty()
    refs.save.disabled = S.saving || !S.loaded || !d
    refs.save.textContent = S.saving ? 'Saving… · جارٍ الحفظ…' : 'Save site content · حفظ محتوى الموقع'
    refs.reload.disabled = S.saving || S.loading
    refs.dirty.textContent = !S.loaded ? '' : d ? 'You have changes that are not saved. · لديك تغييرات غير محفوظة.' : 'Everything is saved. · كل شيء محفوظ.'
    refs.rulesCount.textContent = count(S.draft) + ' / ' + S.limits.overrides + ' · ' + (S.loaded ? contentBytes(draftList()) : 0) + ' / ' + S.limits.bytes + ' bytes · بايت'
    refs.load.disabled = S.reading || !S.loaded
    refs.add.disabled = !S.loaded
  }
  function drawStatus() {
    refs.status.textContent = S.note ? S.note.text : ''
    if (S.note && S.note.bad) refs.status.setAttribute('data-bad', '1'); else refs.status.removeAttribute('data-bad')
  }
  function syncPickers() {
    var sel = refs.page
    if (sel.options.length !== S.pages.length) {
      sel.textContent = ''
      S.pages.forEach(function (p) { var op = el('option', '', pageName(p)); op.value = p; sel.appendChild(op) })
    }
    if (S.pages.indexOf(S.page) < 0) S.page = S.pages.indexOf('/') >= 0 ? '/' : S.pages[0]
    sel.value = S.page
    refs.lang.value = S.lang
  }
  function syncContact() {
    if (!refs) return
    CONTACT.forEach(function (f) { refs.contact[f[0]].value = S.contact[f[0]] || '' })
  }
  /** The returns card: the simple fields, then the two lists of points (rows of our own, rebuilt on add / remove). */
  function drawPoints(lang) {
    var box = refs.points[lang], key = 'points_' + lang
    box.textContent = ''
    if (!S.ret) return
    S.ret[key].forEach(function (text, i) {
      var row = el('div', 'ssc-point')
      var ta = el('textarea'); ta.rows = 2; ta.maxLength = 300; ta.value = text; ta.name = 'ssc_' + key + '_' + i
      ta.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr'); ta.lang = lang
      ta.setAttribute('aria-label', (lang === 'ar' ? tr('Arabic point ', 'النقطة العربية ') : tr('English point ', 'النقطة الإنجليزية ')) + (i + 1))
      ta.addEventListener('input', function () { S.ret[key][i] = ta.value; drawFoot() })
      row.appendChild(ta)
      var rm = btn('ssc-btn--small', 'Remove · إزالة', function () { S.ret[key].splice(i, 1); drawPoints(lang); drawFoot() })
      rm.setAttribute('aria-label', tr('Remove ', 'إزالة ') + (lang === 'ar' ? tr('Arabic point ', 'النقطة العربية ') : tr('English point ', 'النقطة الإنجليزية ')) + (i + 1))
      row.appendChild(rm)
      box.appendChild(row)
    })
    if (!S.ret[key].length) box.appendChild(el('p', 'ssc-hint', 'No points: the page shows its own. · لا توجد نقاط: تعرض الصفحة نقاطها الأصلية.'))
    refs.addPoint[lang].disabled = S.ret[key].length >= 8
  }
  function syncReturns() {
    if (!refs || !S.ret) return
    refs.days.value = String(S.ret.window_days)
    refs.allowReturn.checked = !!S.ret.allow_return
    refs.allowExchange.checked = !!S.ret.allow_exchange
    refs.introEn.value = S.ret.intro_en
    refs.introAr.value = S.ret.intro_ar
    drawPoints('ar'); drawPoints('en')
  }
  function draw() {
    if (!refs) return
    syncPickers(); drawStatus(); drawRows(); drawRules(); drawFoot()
  }

  // ------------------------------------------------------------------- panel
  var CSS = [
    '.ssc{--ssc-bg:#fff;--ssc-soft:#f7f8fa;--ssc-line:#d9dfe5;--ssc-edge:#7d8799;--ssc-text:#18212a;--ssc-muted:#556274;--ssc-action:var(--admin-action,#4f46e5);--ssc-on-action:#fff;--ssc-pick:#eef2ff;--ssc-warn:#8a4b00;--ssc-warn-bg:#fdf0d9;--ssc-err:#be123c;--ssc-new:#3730a3;--ssc-new-bg:#e0e7ff;',
    'container-type:inline-size;box-sizing:border-box;margin:0;padding:1rem;border:1px solid var(--ssc-line);border-radius:1rem;background:var(--ssc-bg);color:var(--ssc-text);font:400 .875rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:start}',
    '@media (max-width:420px){.ssc{padding:.625rem}}',
    ':is(html.dark,html[data-theme="dark"]) .ssc{color-scheme:dark;--ssc-bg:#151b21;--ssc-soft:#1a2128;--ssc-line:#303942;--ssc-edge:#7a8896;--ssc-text:#eef2f5;--ssc-muted:#a7b3be;--ssc-action:#a5b4fc;--ssc-on-action:#171a1e;--ssc-pick:#252b4a;--ssc-warn:#fbbf24;--ssc-warn-bg:#3a2a0a;--ssc-err:#fda4af;--ssc-new:#c7d2fe;--ssc-new-bg:#2a2f55}',
    '.ssc[hidden]{display:none!important}',
    '.ssc *,.ssc *::before,.ssc *::after{box-sizing:border-box}',
    '.ssc-form{display:grid;gap:1rem;min-width:0;margin:0}',
    '.ssc-title{margin:0;font-size:1.5rem;font-weight:700;line-height:1.25;color:var(--ssc-text)}',
    '.ssc-title:focus,.ssc-title:focus-visible{outline:none}',
    '.ssc h2{margin:0;font-size:1.0625rem;font-weight:700;color:var(--ssc-text)}',
    '.ssc p{margin:0}',
    '.ssc-lead,.ssc-hint{color:var(--ssc-muted)}',
    '.ssc-card{display:grid;gap:.75rem;min-width:0;padding:.875rem;border:1px solid var(--ssc-line);border-radius:.875rem;background:var(--ssc-soft)}',
    '.ssc-grid{display:grid;gap:.625rem;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));align-items:end}',
    '.ssc-field{display:grid;gap:.25rem;min-width:0}',
    '.ssc-field>.ssc-lab{font-size:.8125rem;font-weight:700;color:var(--ssc-muted)}',
    '.ssc :is(button,input,select,textarea){font:inherit}',
    '.ssc :is(select,input[type="text"],input[type="search"],input[type="tel"],input[type="email"],textarea){width:100%;min-height:2.75rem;padding:.375rem .625rem;border:1px solid var(--ssc-edge);border-radius:.75rem;color:var(--ssc-text)!important;background-color:var(--ssc-bg)!important;box-shadow:none}',
    '.ssc textarea{min-height:3.5rem;resize:vertical;line-height:1.5}',
    '.ssc input::placeholder,.ssc textarea::placeholder{color:var(--ssc-muted)!important;opacity:1!important}',
    '.ssc .ssc-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:.5rem 1rem;border:1px solid var(--ssc-edge);border-radius:.75rem;background:var(--ssc-bg);color:var(--ssc-text);font-weight:600;text-align:center;cursor:pointer;line-height:1.25}',
    '.ssc .ssc-btn:hover:not(:disabled){border-color:var(--ssc-text)}',
    '.ssc .ssc-btn--primary{background:var(--ssc-action);border-color:transparent;color:var(--ssc-on-action);font-weight:700}',
    '.ssc .ssc-btn--small{min-height:2.75rem;padding:.25rem .75rem;font-size:.8125rem}',
    '.ssc .ssc-btn:disabled{cursor:not-allowed;background:var(--ssc-soft);border-color:var(--ssc-line);color:var(--ssc-muted)}',
    '.ssc :is(button,input,select,textarea):focus-visible{outline:2px solid var(--ssc-action);outline-offset:2px}',
    '.ssc-check{display:flex;align-items:center;gap:.5rem;min-height:2.75rem;font-weight:600;color:var(--ssc-text)}',
    '.ssc-check input{width:1.25rem;height:1.25rem;min-height:0;accent-color:var(--ssc-action)}',
    '.ssc-list{margin:0;padding:0;list-style:none;display:grid;gap:.5rem}',
    '.ssc-row,.ssc-rule{display:grid;gap:.375rem;min-width:0;padding:.625rem .75rem;border:1px solid var(--ssc-line);border-radius:.75rem;background:var(--ssc-bg)}',
    '@container (min-width:760px){.ssc-row{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 13rem;align-items:start}.ssc-row>.ssc-tag{grid-column:1}.ssc-row>.ssc-orig{grid-column:1}}',
    '.ssc-orig{overflow-wrap:anywhere;unicode-bidi:plaintext;color:var(--ssc-text)}',
    '.ssc-repl{overflow-wrap:anywhere;unicode-bidi:plaintext;font-weight:700;color:var(--ssc-new)}',
    '.ssc-where{font-size:.75rem;font-weight:700;letter-spacing:.02em;color:var(--ssc-muted)}',
    '.ssc-tag{justify-self:start;padding:.125rem .5rem;border-radius:999px;background:var(--ssc-soft);border:1px solid var(--ssc-line);color:var(--ssc-muted);font-size:.75rem;font-weight:600}',
    '.ssc-tag--new{background:var(--ssc-new-bg);border-color:transparent;color:var(--ssc-new)}',
    '.ssc-tag--warn{background:var(--ssc-warn-bg);border-color:transparent;color:var(--ssc-warn)}',
    '.ssc-rule .ssc-btn{justify-self:start}',
    '.ssc-status{min-height:1.25rem;font-weight:600;color:var(--ssc-muted)}',
    '.ssc-status[data-bad="1"]{color:var(--ssc-err)}',
    '.ssc-points{display:grid;gap:.375rem;min-width:0}',
    '.ssc-points>.ssc-lab{font-size:.8125rem;font-weight:700;color:var(--ssc-muted)}',
    '.ssc-pointlist{display:grid;gap:.375rem}',
    '.ssc-point{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.375rem;align-items:start}',
    '.ssc-points>.ssc-btn{justify-self:start}',
    '.ssc-foot{display:flex;flex-wrap:wrap;align-items:center;gap:.625rem}',
    '.ssc-dirty{font-weight:600;color:var(--ssc-muted)}',
    'body[' + OPEN + '="open"] main.admin-content>section.admin-page:not([' + PAGE + ']){display:none!important}',
    'body[' + OPEN + '="open"] .admin-sidebar .admin-nav-item[' + CURMARK + ']{background-color:var(--ssc-nav-bg,transparent)!important;color:var(--ssc-nav-ink,inherit)!important;border:var(--ssc-nav-border,0 none)!important;box-shadow:var(--ssc-nav-shadow,none)!important}',
    '.m-header__title>strong[' + TITLE + ']{display:none}',
    'body[' + OPEN + '="open"] .m-header__title>strong[' + TITLE + ']{display:block}',
    'body[' + OPEN + '="open"] .m-header__title>strong:not([' + TITLE + ']){display:none}'
  ].join('\n')
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return
    styleEl = document.createElement('style')
    styleEl.setAttribute('data-sporta-sc-style', '')
    styleEl.textContent = CSS
    document.head.appendChild(styleEl)
  }
  function buildPanel() {
    var root = el('section', 'admin-page ssc')
    root.setAttribute(PAGE, ''); root.hidden = true
    root.setAttribute('aria-labelledby', 'ssc-title')
    var form = el('form', 'ssc-form admin-page-layout')
    form.noValidate = true
    form.addEventListener('submit', function (e) { e.preventDefault(); save() })
    // Enter in a one-line field must not send the whole document
    form.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') e.preventDefault() })
    root.appendChild(form)
    refs = { root: root, contact: {} }

    var head = el('header')
    var h1 = el('h1', 'ssc-title', NAME); h1.id = 'ssc-title'; h1.tabIndex = -1
    head.appendChild(h1)
    head.appendChild(el('p', 'ssc-lead', 'Change the fixed words the shop shows, and its contact details. Prices, the bag, checkout and payment pages cannot be changed here. · غيّر النصوص الثابتة في المتجر وبيانات التواصل. الأسعار وصفحات السلة والدفع لا تُعدّل من هنا.'))
    form.appendChild(head)
    refs.status = el('p', 'ssc-status'); refs.status.setAttribute('role', 'status'); refs.status.setAttribute('aria-live', 'polite')
    form.appendChild(refs.status)

    // 1. the page's texts
    var c1 = el('div', 'ssc-card')
    c1.appendChild(el('h2', '', 'Texts on a page · نصوص الصفحة'))
    var g = el('div', 'ssc-grid')
    refs.page = el('select'); refs.page.name = 'ssc_page'
    refs.page.addEventListener('change', function () { S.page = refs.page.value; draw() })
    g.appendChild(field('Page · الصفحة', refs.page))
    refs.lang = el('select'); refs.lang.name = 'ssc_lang'
    ;['ar', 'en'].forEach(function (l) { var op = el('option', '', LANGS[l]); op.value = l; refs.lang.appendChild(op) })
    refs.lang.addEventListener('change', function () { S.lang = refs.lang.value; draw() })
    g.appendChild(field('Language · اللغة', refs.lang))
    refs.load = btn('ssc-btn--primary', 'Load texts · تحميل النصوص', readPage)
    g.appendChild(refs.load)
    c1.appendChild(g)
    refs.rowsTools = el('div', 'ssc-grid'); refs.rowsTools.hidden = true
    refs.filter = el('input'); refs.filter.type = 'search'; refs.filter.maxLength = 80; refs.filter.name = 'ssc_filter'; refs.filter.autocomplete = 'off'
    refs.filter.addEventListener('input', function () { S.filter = squash(refs.filter.value); drawRows() })
    refs.rowsTools.appendChild(field('Find a text · ابحث عن نص', refs.filter))
    var hl = el('label', 'ssc-check')
    refs.hidden = el('input'); refs.hidden.type = 'checkbox'; refs.hidden.name = 'ssc_hidden'
    refs.hidden.addEventListener('change', function () { S.showHidden = refs.hidden.checked; drawRows() })
    hl.appendChild(refs.hidden); hl.appendChild(document.createTextNode('Also show text that is not on screen (menus) · أظهر النصوص غير الظاهرة'))
    refs.rowsTools.appendChild(hl)
    c1.appendChild(refs.rowsTools)
    refs.rows = el('div')
    c1.appendChild(refs.rows)
    form.appendChild(c1)

    // 2. by hand
    var c2 = el('div', 'ssc-card')
    c2.appendChild(el('h2', '', 'Add a text by hand · أضف نصًا يدويًا'))
    c2.appendChild(el('p', 'ssc-hint', 'For a text that only appears after a tap (a message, a menu). Type it exactly as the shop shows it, for the page and language chosen above. · لنص يظهر بعد الضغط فقط. اكتبه كما يظهر تمامًا.'))
    var g2 = el('div', 'ssc-grid')
    refs.handMatch = el('input'); refs.handMatch.type = 'text'; refs.handMatch.maxLength = 400; refs.handMatch.name = 'ssc_hand_match'; refs.handMatch.setAttribute('dir', 'auto'); refs.handMatch.autocomplete = 'off'
    g2.appendChild(field('The shop says · النص الحالي', refs.handMatch))
    refs.handText = el('input'); refs.handText.type = 'text'; refs.handText.maxLength = 2000; refs.handText.name = 'ssc_hand_text'; refs.handText.setAttribute('dir', 'auto'); refs.handText.autocomplete = 'off'
    g2.appendChild(field('Say instead · النص البديل', refs.handText))
    refs.add = btn('', 'Add · أضف', function () {
      var m = squash(refs.handMatch.value), t = squash(refs.handText.value)
      if (!m || !t) { S.note = { text: 'Type both the current text and the replacement. · اكتب النص الحالي والنص البديل.', bad: true }; drawStatus(); return }
      if (PRICE.test(m) || NUMBER_ONLY.test(m) || CUR_ONLY.test(m)) { S.note = { text: MSG.invalid_content_match, bad: true }; drawStatus(); return }
      if (PRICE.test(t)) { S.note = { text: MSG.price_in_content_text, bad: true }; drawStatus(); return }
      S.draft[keyOf(S.page, S.lang, m)] = t
      refs.handMatch.value = ''; refs.handText.value = ''
      S.note = { text: 'Added. Press Save to publish it. · أُضيف. اضغط حفظ للنشر.', bad: false }
      draw()
    })
    g2.appendChild(refs.add)
    c2.appendChild(g2)
    form.appendChild(c2)

    // 3. everything Save would send
    var c3 = el('div', 'ssc-card')
    var h3 = el('h2', '', 'Changes · التغييرات ')
    refs.rulesCount = el('span', 'ssc-where'); h3.appendChild(refs.rulesCount)
    c3.appendChild(h3)
    refs.rules = el('div')
    c3.appendChild(refs.rules)
    form.appendChild(c3)

    // 4. contact
    var c4 = el('div', 'ssc-card')
    c4.appendChild(el('h2', '', 'Contact details · بيانات التواصل'))
    c4.appendChild(el('p', 'ssc-hint', 'Leave a box empty to keep what the shop shows now. Links on the shop (call, email, WhatsApp, social) follow these. · اترك الخانة فارغة للإبقاء على الحالي.'))
    var g4 = el('div', 'ssc-grid')
    CONTACT.forEach(function (f) {
      var i = el('input'); i.type = f[2]; i.name = 'ssc_' + f[0]; i.maxLength = f[4]; i.placeholder = f[3]; i.autocomplete = 'off'
      i.setAttribute('dir', f[0] === 'address_ar' ? 'rtl' : f[0] === 'address_en' ? 'ltr' : 'ltr')
      i.addEventListener('input', function () { S.contact[f[0]] = i.value.trim(); drawFoot() })
      refs.contact[f[0]] = i
      g4.appendChild(field(f[1], i))
    })
    c4.appendChild(g4)
    form.appendChild(c4)

    // 5. returns & exchange
    var c5 = el('div', 'ssc-card')
    c5.setAttribute('data-sporta-sc-returns', '')
    c5.appendChild(el('h2', '', 'Returns & exchange · الإرجاع والاستبدال'))
    c5.appendChild(el('p', 'ssc-hint', 'The number of days and the two switches are rules: the shop server applies them to every request. The intro and the points are the words on the Returns page; leave them empty to keep the page\u2019s own. · عدد الأيام والخيارين قواعد يطبقها الخادم. المقدمة والنقاط هي نصوص صفحة الإرجاع؛ اتركها فارغة للإبقاء على الأصل.'))
    var g5 = el('div', 'ssc-grid')
    refs.days = el('input'); refs.days.type = 'text'; refs.days.name = 'ssc_window_days'; refs.days.maxLength = 2; refs.days.autocomplete = 'off'
    refs.days.setAttribute('inputmode', 'numeric'); refs.days.setAttribute('dir', 'ltr')
    refs.days.addEventListener('input', function () {
      if (!S.ret) return   // the policy has not loaded: nothing to change yet (Save is off too)
      var v = refs.days.value.trim()
      S.ret.window_days = /^[0-9]{1,2}$/.test(v) ? Number(v) : NaN
      drawFoot()
    })
    g5.appendChild(field('Days to ask for a return (1 to 60) · مدة طلب الإرجاع بالأيام', refs.days))
    var check = function (name, label, key) {
      var l = el('label', 'ssc-check'), i = el('input')
      i.type = 'checkbox'; i.name = name
      i.addEventListener('change', function () { if (!S.ret) return; S.ret[key] = i.checked; drawFoot() })
      l.appendChild(i); l.appendChild(document.createTextNode(label))
      g5.appendChild(l)
      return i
    }
    refs.allowReturn = check('ssc_allow_return', 'Accept returns · قبول الإرجاع', 'allow_return')
    refs.allowExchange = check('ssc_allow_exchange', 'Accept exchanges · قبول الاستبدال', 'allow_exchange')
    c5.appendChild(g5)
    var g6 = el('div', 'ssc-grid')
    var intro = function (name, label, key, dir) {
      var t = el('textarea'); t.rows = 3; t.maxLength = 400; t.name = name; t.setAttribute('dir', dir); t.lang = dir === 'rtl' ? 'ar' : 'en'
      t.addEventListener('input', function () { if (!S.ret) return; S.ret[key] = t.value; drawFoot() })
      g6.appendChild(field(label, t))
      return t
    }
    refs.introAr = intro('ssc_intro_ar', 'Intro (Arabic) · المقدمة بالعربية', 'intro_ar', 'rtl')
    refs.introEn = intro('ssc_intro_en', 'Intro (English) · المقدمة بالإنجليزية', 'intro_en', 'ltr')
    c5.appendChild(g6)
    refs.points = {}; refs.addPoint = {}
    ;[['ar', 'Policy points (Arabic) · نقاط السياسة بالعربية'], ['en', 'Policy points (English) · نقاط السياسة بالإنجليزية']].forEach(function (p) {
      var wrap = el('div', 'ssc-points')
      wrap.setAttribute('data-sporta-sc-points', p[0])
      wrap.appendChild(el('span', 'ssc-lab', p[1]))
      refs.points[p[0]] = el('div', 'ssc-pointlist')
      wrap.appendChild(refs.points[p[0]])
      refs.addPoint[p[0]] = btn('ssc-btn--small', 'Add a point · أضف نقطة', function () {
        if (!S.ret || S.ret['points_' + p[0]].length >= 8) return
        S.ret['points_' + p[0]].push('')
        drawPoints(p[0]); drawFoot()
        var all = refs.points[p[0]].querySelectorAll('textarea')
        if (all.length) all[all.length - 1].focus()
      })
      wrap.appendChild(refs.addPoint[p[0]])
      c5.appendChild(wrap)
    })
    form.appendChild(c5)

    var foot = el('div', 'ssc-foot')
    refs.save = el('button', 'ssc-btn ssc-btn--primary', 'Save site content · حفظ محتوى الموقع'); refs.save.type = 'submit'
    foot.appendChild(refs.save)
    refs.reload = btn('', 'Reload from server · إعادة التحميل', function () {
      if (dirty() && !window.confirm('Discard the changes that are not saved? · تجاهل التغييرات غير المحفوظة؟')) return
      load()
    })
    foot.appendChild(refs.reload)
    refs.dirty = el('span', 'ssc-dirty')
    foot.appendChild(refs.dirty)
    form.appendChild(foot)
    return root
  }

  // -------------------------------------------------- the entry in the shell
  function reactNavButtons() {
    return document.querySelectorAll('.admin-sidebar .admin-nav-item, .m-tabbar__item, .m-menu-item')
  }
  function mine(b) { return b.hasAttribute(NAVMARK) }
  function addon(b) { return b.hasAttribute(NAVMARK) || b.hasAttribute(OTHER_NAV) }
  function setNavLook(b, active) {
    var on = ['bg-indigo-50', 'text-indigo-600'], off = ['text-slate-600', 'hover:bg-slate-50']
    ;(active ? off : on).forEach(function (c) { b.classList.remove(c) })
    ;(active ? on : off).forEach(function (c) { b.classList.add(c) })
  }
  /** Take React's current-tab mark off (and write it down) while ours is open; idempotent. */
  function neutralise() {
    var list = reactNavButtons(), i
    for (i = 0; i < list.length; i++) {
      var b = list[i]
      if (addon(b)) continue
      if (b.getAttribute('aria-current')) { b.removeAttribute('aria-current'); b.setAttribute(CURMARK, '1') }
    }
    var inactive = document.querySelector('.admin-sidebar .admin-nav-item:not([' + CURMARK + ']):not([' + NAVMARK + ']):not([' + OTHER_NAV + '])')
    if (inactive) {
      try {
        var c = getComputedStyle(inactive), st = document.body.style
        st.setProperty('--ssc-nav-ink', c.color); st.setProperty('--ssc-nav-bg', c.backgroundColor)
        st.setProperty('--ssc-nav-border', c.borderTopWidth + ' ' + c.borderTopStyle + ' ' + c.borderTopColor); st.setProperty('--ssc-nav-shadow', c.boxShadow)
      } catch (e) { /* the fallbacks in the rule */ }
    }
    var ours = document.querySelectorAll('[' + NAVMARK + ']')
    for (i = 0; i < ours.length; i++) {
      ours[i].setAttribute('aria-current', 'page')
      if (ours[i].classList.contains('admin-nav-item')) setNavLook(ours[i], true)
    }
  }
  function restore() {
    var list = document.querySelectorAll('[' + CURMARK + ']'), i
    for (i = 0; i < list.length; i++) {
      var b = list[i], box = b.parentNode
      b.removeAttribute(CURMARK)
      // only if React has not already moved the mark to another button of the same group
      var moved = false, sib = box ? box.children : []
      for (var k = 0; k < sib.length; k++) if (sib[k] !== b && !addon(sib[k]) && sib[k].getAttribute('aria-current')) moved = true
      if (!moved && !b.getAttribute('aria-current')) b.setAttribute('aria-current', 'page')
    }
    var ours = document.querySelectorAll('[' + NAVMARK + ']')
    for (i = 0; i < ours.length; i++) {
      ours[i].removeAttribute('aria-current')
      if (ours[i].classList.contains('admin-nav-item')) setNavLook(ours[i], false)
    }
    try { ;['--ssc-nav-ink', '--ssc-nav-bg', '--ssc-nav-border', '--ssc-nav-shadow'].forEach(function (k) { document.body.style.removeProperty(k) }) } catch (e) { /* none set */ }
  }
  function ensureNavButton(nav) {
    if (nav.querySelector('[' + NAVMARK + ']')) return
    var b = el('button', 'admin-nav-item rounded-lg px-3 py-2 text-start text-sm font-semibold text-slate-600 hover:bg-slate-50')
    b.type = 'button'
    b.setAttribute(NAVMARK, '1')
    var span = el('span', 'flex items-center gap-2.5')
    span.appendChild(svgIcon(17)); span.appendChild(document.createTextNode(NAME))
    b.appendChild(span)
    b.addEventListener('click', function () { openPanel(false) })
    nav.appendChild(b)
    if (S.open) neutralise()
  }
  function ensureMenuTile() {
    var grid = document.querySelector('.m-menu-grid')
    if (!grid || grid.querySelector('[' + NAVMARK + ']')) return
    var b = el('button', 'm-menu-item')
    b.type = 'button'; b.setAttribute(NAVMARK, '1')
    var ic = el('span', 'm-menu-item__icon'); ic.appendChild(svgIcon(20))
    b.appendChild(ic); b.appendChild(el('span', '', 'Site content'))
    b.addEventListener('click', function () {
      var close = document.querySelector('.m-menu-close')
      if (close) close.click()
      openPanel(false)
    })
    grid.appendChild(b)
    if (S.open) neutralise()
  }
  function ensureHeaderTitle() {
    var t = document.querySelector('.m-header__title')
    if (!t || t.querySelector('[' + TITLE + ']')) return
    var s = el('strong', '', 'Site content')
    s.setAttribute(TITLE, '')
    t.insertBefore(s, t.firstChild)
  }
  function ensurePanel(main) {
    if (!panel) { panel = buildPanel(); syncContact(); syncReturns(); draw() }
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
    if (!panel || !onAdmin() || S.open) return
    if (!fromHistory) {
      prevUrl = tabParam() === 'abandoned' ? '' : location.href
      try { history.pushState({ sportaTab: TAB }, '', urlWithTab(TAB)) } catch (e) { /* the panel still opens */ }
    }
    S.open = true
    document.body.setAttribute(OPEN, 'open')
    panel.hidden = false
    neutralise()
    try { window.scrollTo(0, 0) } catch (e) { /* no scrolling */ }
    var h = document.getElementById('ssc-title')
    if (h) { try { h.focus({ preventScroll: true }) } catch (e) { /* no focus */ } }
    if (!S.loaded) load(); else draw()
  }
  function closePanel(why) {
    if (!S.open) return
    S.open = false
    dropFrame(); S.reading = false
    document.body.removeAttribute(OPEN)
    if (panel) panel.hidden = true
    restore()
    if (why === 'nav') {
      // React ignores a click on the tab it already shows, so the address would keep saying ?tab=content
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
    if (!t || mine(t)) return
    if (t.classList.contains('m-tabbar__item') && t.hasAttribute('aria-haspopup')) return   // "More" opens the menu, it is not a tab
    closePanel('nav')
  }, true)
  window.addEventListener('popstate', function () {
    if (probeState === 'absent') return
    var want = tabParam() === TAB
    if (want && !S.open) { if (panel) openPanel(true); else { wantOpen = true; autoOpened = false } }
    else if (!want && S.open) closePanel('history')
  })
  // a tab closed with unsaved changes asks first (the browser's own question; nothing is stored here)
  window.addEventListener('beforeunload', function (e) {
    if (S.loaded && dirty()) { e.preventDefault(); e.returnValue = '' }
  })

  // -------------------------------------------------------------- finding the shell
  function scan() {
    if (!onAdmin()) return
    var nav = document.querySelector('nav.admin-sidebar__nav')
    var main = document.querySelector('main.admin-content')
    if (!nav || !main) {
      // sign-in screen, or signed out: nothing of ours stays open and nothing unsaved is kept
      if (S.open) closePanel('gone')
      if (panel) wipe()
      return
    }
    if (probeState === 'unknown') { probe(); return }
    if (probeState === 'absent') return
    if (firstDoc && !S.loaded) { adopt(firstDoc); firstDoc = null }
    ensureStyle()
    ensurePanel(main)
    ensureNavButton(nav)
    ensureMenuTile()
    ensureHeaderTitle()
    if (wantOpen && !autoOpened) { autoOpened = true; openPanel(true) }
    if (S.open) neutralise()
  }
  function wipe() {
    dropFrame()
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel)
    panel = null; refs = null
    S.loaded = false; S.loading = false; S.saving = false; S.reading = false
    S.saved = {}; S.draft = {}; S.contact = {}; S.contactSaved = {}; S.ret = null; S.retSaved = ''; S.rows = []; S.rowsFor = ''; S.note = null; S.filter = ''; S.showHidden = false
    probeState = 'unknown'; firstDoc = null
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
        for (var i = 0; i < muts.length; i++) if (!panel.contains(muts[i].target) && muts[i].target !== frame) { outside = true; break }
        if (!outside) return
      }
      schedule()
    }).observe(document.body, { childList: true, subtree: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN SITE CONTENT - end =========================================== */

/* ===== ADMIN PROMOTIONS: "New promotion" - begin =========================
 * 9. Promotions (owner request 2026-11-11: "save new promotion"). The Promotions
 * screen has no create form of its own: a promotion (a coupon or an automatic
 * rule) is made in the Discounts screen, whose modal already has its Save
 * ("New discount"). So on Promotions this adds one "New promotion" button in the
 * page header that does exactly what the owner would do by hand: opens Discounts
 * from the menu and presses its "New discount" button. No save logic here, no
 * data sent by this block.
 *
 * Only on the Promotions screen (its visible h1 reads Promotions). The button is
 * removed as soon as the screen changes. Nothing runs before the page is up, and
 * the presses are made once per click, each waiting at most 4 s for its target.
 */
;(function () {
  // /backends only: this file is also loaded by the public storefront, where this block has nothing to do (review 2026-11-11, L1).
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaPromoNew) return
  try { Object.defineProperty(window, '__sportaPromoNew', { value: { version: 1 }, enumerable: false, configurable: false }) } catch (e) { return }
  var BTN = 'data-sporta-promo-new'
  var NAV = '.admin-sidebar .admin-nav-item, .m-tabbar__item, .m-menu-item'
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }
  function shown(e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }
  function promoScreen() {
    var hs = document.querySelectorAll('.admin-page h1')
    for (var i = 0; i < hs.length; i++) if (clean(hs[i].textContent) === 'Promotions' && shown(hs[i])) return hs[i]
    return null
  }
  function findNav(word) {
    var items = document.querySelectorAll(NAV)
    for (var i = 0; i < items.length; i++) if (clean(items[i].textContent) === word && shown(items[i])) return items[i]
    return null
  }
  function waitFor(get, ms, done) {
    var t0 = Date.now()
    ;(function poll() {
      var x = get()
      if (x) return done(x)
      if (Date.now() - t0 > ms) return done(null)
      setTimeout(poll, 100)
    })()
  }
  function openNewDiscount(note) {
    var nav = findNav('Discounts')
    function press(n) { if (n) n.click() }
    // Say so on the page when the Discounts screen does not open, so the press is never silent.
    function failed() {
      if (!note) return
      note.textContent = 'The Discounts screen did not open. Open Discounts from the menu. · لم تفتح شاشة الخصومات. افتح الخصومات من القائمة.'
      note.style.display = ''
    }
    if (nav) press(nav)
    else {
      // The phone keeps its menu closed: open it, then take Discounts from it.
      var menu = document.querySelector('.m-header__menu')
      if (menu) menu.click()
      waitFor(function () { return findNav('Discounts') }, 4000, function (n) { if (n) press(n); else failed() })
    }
    waitFor(function () {
      var bs = document.querySelectorAll('button')
      for (var i = 0; i < bs.length; i++) if (clean(bs[i].textContent).indexOf('New discount') === 0 && shown(bs[i])) return bs[i]
      return null
    }, 4000, function (b) { if (b) { if (note) note.style.display = 'none'; press(b) } else failed() })
  }
  function ensure() {
    var h = promoScreen()
    var have = document.querySelector('[' + BTN + ']')
    if (!h) { if (have) have.remove(); var oldNote = document.querySelector('[' + BTN + '-note]'); if (oldNote) oldNote.remove(); return }
    if (have && have.isConnected) return
    var head = h.closest('.admin-page-header') || h.parentElement
    if (!head) return
    var b = document.createElement('button')
    b.type = 'button'
    b.setAttribute(BTN, '1')
    b.className = 'rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700'
    b.textContent = 'New promotion · عرض ترويجي جديد'
    var note = document.createElement('p')
    note.setAttribute(BTN + '-note', '1')
    note.setAttribute('role', 'status')
    note.className = 'mt-2 text-sm font-semibold text-red-700'
    note.style.display = 'none'
    b.addEventListener('click', function () { openNewDiscount(note) })
    head.appendChild(b)
    head.appendChild(note)
  }
  function start() {
    setInterval(function () { if (document.hidden) return; try { ensure() } catch (e) { /* the page keeps working without it */ } }, 500)   // a hidden tab has nobody to add a button for
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN PROMOTIONS: "New promotion" - end ============================ */

/* ===== ADMIN NEW PRODUCT - begin =========================================
 * 11. New product (owner request 2026-11-11: "make add new product backends").
 *
 * WHAT THE COMPILED "Add a product" FORM LACKS (read from the captured live DOM, scripts/fixtures/sizes-admin/
 * catalogue-form.html, and from dropin/php-store/admin.php):
 *   - NO SIZES AND NO STOCK. product_variants is keyed on the slug and nothing but the seed ever wrote a row:
 *     set_stock / inventory_adjust answer sku_not_found for a row that is not there. A product made in the form can
 *     therefore never get sizes, and a product with no size rows is "untracked": it can be ordered with no size and its
 *     stock is unlimited (store_stock_claim skips it). Right for a cap, wrong for a t-shirt.
 *   - It goes LIVE the moment it is saved ("On sale" is ticked by default) with no photo, no sizes and no stock.
 *   - The category is free text: "Men" over the shop's "men" is only settled by the server, and a typo opens a new
 *     category without a word. The brand is a bare select.
 *   - The description boxes allow 4000 characters while product_save refuses more than 280 (too_long_desc_*).
 *   - The slug ("Web name") is not checked for a clash before Save (the server answers slug_taken).
 *   - A photo is a typed path or one upload at a time into a field; there is no preview of the shop card.
 *
 * WHAT THIS ADDS: a "New product" button in the Catalogue page header (the compiled "Add a product" stays and works
 * exactly as before) that opens ONE screen: names (ar + en), slug (from the English name, editable, checked against
 * the catalogue), brand, category (the catalogue's own spellings), price and optional sale price with dates, both
 * descriptions with a 280 counter, sizes with stock per size, photos (drop or pick many, lossless), show / feature
 * switches, live validation and a preview of the shop card. A second tab adds MANY products from a table (shared brand,
 * category and sizes, photos matched by file name = slug, a review step, then create).
 *
 * THE SEQUENCE (every call is an existing admin route except the one flagged), through the same session cookie and
 * X-Sporta-Admin header as the rest of this file:
 *   0. open:   GET brands, GET products_all (slug and category checks), GET variants_create (probe only: 405 = the
 *              route exists, 404 not_found = this server has not had the API release yet).
 *   1. photos: POST product_image_upload, one file at a time, the file's own bytes (no canvas, no resize, no
 *              re-encode: owner decision 2026-11-03). Done BEFORE the product exists, so a failed upload creates
 *              nothing: "a product is never created with a broken image list". Files already uploaded keep their
 *              path for the retry (never uploaded twice).
 *   2. save:   POST product_save {id: 0, ..., active: false, image, images}. The product exists but is HIDDEN.
 *   3. sizes:  POST variants_create {slug, sizes: [{size, stock}]}  <- the ONE new route (dropin/php-store/admin.php,
 *              ships only with an API release; all or nothing, never overwrites). Without it the product stays hidden
 *              and the screen says exactly that.
 *   4. show:   POST product_active {id, active: true}, LAST, and only when every step before it worked.
 * Any failure after step 2 leaves the product hidden and lists what is done and what is missing, with a Retry that
 * resumes (nothing is repeated that already worked; a save whose answer was lost is recognised by its slug and name).
 * The server decides every number: the form only sends what product_save accepts (price as a string with exactly
 * three decimals, description at most 280), and it never adds up money. Only on /backends, only on the Catalogue
 * screen, one press = one request chain (a double click on Save sends once). Everything is built with textContent.
 * The upload helpers are copies of the Photos block's (each block is its own closure and must not depend on another).
 * Tuning hook for tests: window.SPORTA_NEWPRODUCT = {paceMs, backoffMs}.
 */
;(function () {   // leading ; - the block above ends in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaNewProduct) return
  try { Object.defineProperty(window, '__sportaNewProduct', { value: { version: 1 }, enumerable: false, configurable: false }) } catch (e) { return }

  var API = '/api/admin.php'
  var MAX_BYTES = 10 * 1024 * 1024
  var MAX_PHOTOS = 12, MAX_ROWS = 50, MAX_TRIES = 6, DESC_MAX = 280, NAME_MAX = 160, SLUG_MAX = 80, CAT_MAX = 40
  var PRESETS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']
  var BTN = 'data-sporta-np-open'

  // ------------------------------------------------------------------ strings
  var STR = {
    en: {
      open: 'New product', title: 'New product', close: 'Close', cancel: 'Cancel', tabOne: 'One product', tabMany: 'Many products',
      secBasics: 'Names and web address', secPrice: 'Price', secDesc: 'Description', secSizes: 'Sizes and stock', secPhotos: 'Photos', secShow: 'In the shop',
      nameEn: 'Name (English)', nameAr: 'Name (Arabic)', slug: 'Web name (slug)', slugHint: 'Made from the English name. Letters, digits and dashes only.',
      slugFree: 'Free: the product will be at /product/{s}', slugTaken: 'Already used by “{n}”.', slugChecking: 'Checking the catalogue…', slugUnknown: 'Could not read the catalogue; the server checks again when you save.',
      slugAuto: 'Follow the English name',
      brand: 'Brand', noBrand: 'No brand', brandHidden: '(hidden)', brandFail: 'Could not load the brands; the product can be given one later.',
      category: 'Category', catHint: 'Pick one the shop already has, or type a new one (lower case).', catNew: 'A new category: “{c}”.', catSame: 'Saved as “{c}”, the spelling the shop already uses.',
      price: 'Price (KWD)', sale: 'Sale price (KWD, optional)', saleFrom: 'Sale starts (UTC: Kuwait time minus 3 hours)', saleTo: 'Sale ends (UTC: Kuwait time minus 3 hours)', priceHint: 'Exactly three decimals, for example 12.500.',
      descEn: 'Description (English)', descAr: 'Description (Arabic)', counter: '{n} / {m}',
      sizesYes: 'This product has sizes', sizesNo: 'No sizes (one size, stock is not counted)', sizesNoWarn: 'Without sizes the shop does not count stock for this product: it can be ordered with no size and without limit. Right for a cap or a strap, not for clothes.',
      sizesPick: 'Sizes it comes in', sizeStock: 'Pieces of {s}', custom: 'Other size', add: 'Add', customHint: 'Up to 4 letters or digits, for example 42 or 2XL.',
      sizesNeedApi: 'This server cannot create sizes yet (it needs the next API release). The product will be saved HIDDEN, and sizes can be added once the release is live.',
      photosHelp: 'Drop photos here or choose them. The first one is the main photo. PNG, JPEG or WebP, up to 10 MB each, uploaded exactly as they are.',
      choose: 'Choose photos', drop: 'or drop photos here', main: 'Main photo', up: 'Move earlier', down: 'Move later', remove: 'Remove', photoOf: 'Photo {i}: {n}',
      pxCount: '{n} of {m} photos', noPhotosNote: 'No photos yet: the shop shows a grey plate for this product.',
      show: 'Show it in the shop when everything is saved', feature: 'Feature on the home page', featureOrder: 'Featured order', hiddenNote: 'It will stay hidden until you switch it on.',
      preview: 'How the card will look', previewLang: 'Card language', noPhoto: 'No photo', hiddenBadge: 'Hidden', soldOut: 'out', kwd: 'KWD',
      save: 'Create product', saving: 'Creating…', fix: 'Fix {n} before saving', fixOne: 'Fix 1 thing before saving', ready: 'Ready to save.',
      bytes: '{n} B', kb: '{n} KB', mb: '{n} MB',
      v_name_en: 'Enter the English name.', v_name_ar: 'Enter the Arabic name.', v_name_long: 'At most 160 characters.',
      v_slug_empty: 'Enter a web name (letters and digits).', v_slug_dup: 'Another row has the same web name.', discard: 'Discard what you entered?', v_slug_long: 'At most 80 characters.', v_slug_taken: 'This web name is taken.',
      v_cat: 'Enter a category.', v_cat_long: 'At most 40 characters.', v_price: 'Enter a price above 0 with at most three decimals.', v_sale: 'The sale price needs up to three decimals, above 0.',
      v_sale_ge: 'The sale price must be lower than the price.', v_dates: 'The sale cannot end before it starts.', v_dates_nosale: 'Dates only count with a sale price.',
      v_desc_long: 'At most 280 characters; the server would refuse more.', v_sizes_none: 'Pick at least one size, or choose “No sizes”.', v_stock: 'Pieces must be a whole number from 0 to 999999.',
      v_size_bad: 'A size is 1 to 4 letters or digits.', v_size_dup: 'This size is already in the list.', v_photo_blocked: 'Remove the {n} file(s) that cannot be uploaded.', v_photos_many: 'At most 12 photos.', v_order: 'Featured order is a whole number from 0 to 100000.',
      f_empty: 'The file is empty.', f_read: 'The file could not be read.', f_svg: 'SVG is not accepted.', f_format: 'Only PNG, JPEG or WebP.', f_large: 'Over 10 MB.',
      // the run
      stUpload: 'Uploading photo {i} of {n}…', stSave: 'Saving the product (hidden)…', stSizes: 'Adding sizes and stock…', stShow: 'Showing it in the shop…', stWait: 'The server asks to wait: {s} s…',
      stepPhotos: 'Photos', stepSave: 'Product saved', stepSizes: 'Sizes and stock', stepShow: 'Shown in the shop', done: 'done', todo: 'not done', skip: 'not needed', hiddenChoice: 'left hidden as you chose',
      okLive: '“{n}” is saved and live in the shop.', okHidden: '“{n}” is saved and hidden, as you chose.',
      partial: '“{n}” is saved but HIDDEN: it is not in the shop yet.', noneMade: 'Nothing was created.', missing: 'Missing: {w}.',
      retry: 'Try again', reloadList: 'Reload the Catalogue list', another: 'Add another product', closeDone: 'Close',
      staleNote: 'The Catalogue list on this page was read before this product existed. Reload it to see the new product.',
      e_not_signed_in: 'You are signed out. Sign in again, then press Try again.', e_network: 'The connection dropped.', e_too_many: 'The server asked to slow down.',
      e_slug_taken: 'That web name is already used by another product.', e_invalid_slug: 'The web name is not valid.', e_sale_not_lower: 'The sale price must be lower than the price.',
      e_invalid_price: 'The price is not valid.', e_invalid_sale_price: 'The sale price is not valid.', e_sale_dates_backwards: 'The sale ends before it starts.', e_unknown_brand: 'The server does not know this brand.',
      e_too_long_desc_en: 'The English description is over 280 characters.', e_too_long_desc_ar: 'The Arabic description is over 280 characters.', e_missing_name_en: 'The English name is missing.', e_missing_name_ar: 'The Arabic name is missing.',
      e_too_long_category: 'The category is over 40 characters.', e_image_too_large: 'The photo is over 10 MB.', e_image_bad_format: 'The photo format is not accepted.', e_image_not_an_image: 'The file is not a real image.',
      e_size_exists: 'The product already has one of these sizes.', e_not_found: 'This server does not have the sizes route yet (API release).', e_product_not_found: 'The product could not be found.',
      e_save: 'The server refused it', e_gone: 'The product is gone.', e_read: 'The file could not be read.',
      // bulk
      bTitle: 'Many products at once', bIntro: 'One row per product. Brand, category, sizes and stock are shared. Photos are matched by file name: name each file after the web name, with -1, -2 … for more.',
      bShared: 'Shared by every product', bRows: 'Products', bPaste: 'Paste rows (one per line: English name ; Arabic name ; price ; sale price)', bPasteBtn: 'Fill the table from the pasted rows',
      bAddRow: 'Add a row', bRemoveRow: 'Remove row', bPhotos: 'Photos', bUnmatched: 'Not matched to any row (will not be uploaded):', bNone: 'none',
      bReview: 'Review', bBack: 'Back to the table', bCreate: 'Create {n} products', bCreate1: 'Create 1 product', bSummary: '{n} products, {p} photos, {s}.',
      bSizesLine: 'sizes {s}', bNoSizes: 'no sizes', bLive: 'shown in the shop at the end', bHidden: 'left hidden', bRowState: 'Row {i}', bTooMany: 'At most 50 rows.',
      bDone: 'Finished: {a} live, {b} saved hidden, {c} not created.', bRetry: 'Try the unfinished rows again', bRowOk: 'live', bRowHidden: 'saved hidden', bRowFail: 'not created', bRowWait: 'waiting',
      colName: 'Name (English)', colNameAr: 'Name (Arabic)', colSlug: 'Web name', colPrice: 'Price', colSale: 'Sale price', colPhotos: 'Photos', colState: 'State'
    },
    ar: {
      open: 'منتج جديد', title: 'منتج جديد', close: 'إغلاق', cancel: 'إلغاء', tabOne: 'منتج واحد', tabMany: 'عدة منتجات',
      secBasics: 'الاسم والعنوان', secPrice: 'السعر', secDesc: 'الوصف', secSizes: 'المقاسات والمخزون', secPhotos: 'الصور', secShow: 'في المتجر',
      nameEn: 'الاسم (إنجليزي)', nameAr: 'الاسم (عربي)', slug: 'الاسم المختصر على الموقع', slugHint: 'يُشتق من الاسم الإنجليزي. أحرف إنجليزية وأرقام وشرطات فقط.',
      slugFree: 'متاح: سيكون المنتج على /product/{s}', slugTaken: 'مستخدم لدى «{n}».', slugChecking: 'جارٍ فحص الكتالوج…', slugUnknown: 'تعذّر قراءة الكتالوج، وسيفحصه الخادم عند الحفظ.',
      slugAuto: 'اتبع الاسم الإنجليزي',
      brand: 'العلامة التجارية', noBrand: 'بلا علامة', brandHidden: '(مخفية)', brandFail: 'تعذّر تحميل العلامات، ويمكن إضافتها لاحقًا.',
      category: 'الفئة', catHint: 'اختر فئة موجودة في المتجر أو اكتب فئة جديدة (بأحرف صغيرة).', catNew: 'فئة جديدة: «{c}».', catSame: 'ستُحفظ «{c}»، وهي الكتابة المعتمدة في المتجر.',
      price: 'السعر (د.ك)', sale: 'سعر التخفيض (د.ك، اختياري)', saleFrom: 'بداية التخفيض (UTC: توقيت الكويت ناقص 3 ساعات)', saleTo: 'نهاية التخفيض (UTC: توقيت الكويت ناقص 3 ساعات)', priceHint: 'ثلاث منازل عشرية بالضبط، مثل 12.500.',
      descEn: 'الوصف (إنجليزي)', descAr: 'الوصف (عربي)', counter: '{n} / {m}',
      sizesYes: 'للمنتج مقاسات', sizesNo: 'بلا مقاسات (مقاس واحد، لا يُحسب المخزون)', sizesNoWarn: 'بلا مقاسات لا يحسب المتجر المخزون لهذا المنتج: يمكن طلبه بلا مقاس وبلا حد. يناسب القبعة أو الحزام، ولا يناسب الملابس.',
      sizesPick: 'المقاسات المتوفرة', sizeStock: 'عدد القطع من {s}', custom: 'مقاس آخر', add: 'إضافة', customHint: 'حتى ٤ أحرف أو أرقام، مثل 42 أو 2XL.',
      sizesNeedApi: 'لا يستطيع هذا الخادم إنشاء المقاسات بعد (يحتاج إصدار الواجهة البرمجية القادم). سيُحفظ المنتج مخفيًا، وتُضاف المقاسات بعد صدور الإصدار.',
      photosHelp: 'أفلت الصور هنا أو اخترها. الأولى هي الصورة الرئيسية. PNG أو JPEG أو WebP بحجم أقصاه ١٠ ميغابايت للملف، وتُرفع كما هي تمامًا.',
      choose: 'اختيار الصور', drop: 'أو أفلت الصور هنا', main: 'الصورة الرئيسية', up: 'تقديم', down: 'تأخير', remove: 'حذف', photoOf: 'الصورة {i}: {n}',
      pxCount: '{n} من {m} صورة', noPhotosNote: 'لا صور بعد: يعرض المتجر لوحة رمادية لهذا المنتج.',
      show: 'اعرضه في المتجر بعد حفظ كل شيء', feature: 'مميز في الصفحة الرئيسية', featureOrder: 'ترتيب التمييز', hiddenNote: 'سيبقى مخفيًا حتى تفعّله.',
      preview: 'شكل البطاقة في المتجر', previewLang: 'لغة البطاقة', noPhoto: 'لا صورة', hiddenBadge: 'مخفي', soldOut: 'نفد', kwd: 'د.ك',
      save: 'إنشاء المنتج', saving: 'جارٍ الإنشاء…', fix: 'صحّح {n} قبل الحفظ', fixOne: 'صحّح أمرًا واحدًا قبل الحفظ', ready: 'جاهز للحفظ.',
      bytes: '{n} بايت', kb: '{n} كيلوبايت', mb: '{n} ميغابايت',
      v_name_en: 'أدخل الاسم الإنجليزي.', v_name_ar: 'أدخل الاسم العربي.', v_name_long: '١٦٠ حرفًا على الأكثر.',
      v_slug_empty: 'أدخل اسمًا مختصرًا (أحرف إنجليزية وأرقام).', v_slug_dup: 'صف آخر له الاسم المختصر نفسه.', discard: 'هل تتجاهل ما أدخلته؟', v_slug_long: '٨٠ حرفًا على الأكثر.', v_slug_taken: 'هذا الاسم المختصر مستخدم.',
      v_cat: 'أدخل الفئة.', v_cat_long: '٤٠ حرفًا على الأكثر.', v_price: 'أدخل سعرًا أكبر من صفر بثلاث منازل عشرية على الأكثر.', v_sale: 'سعر التخفيض أكبر من صفر بثلاث منازل عشرية على الأكثر.',
      v_sale_ge: 'يجب أن يكون سعر التخفيض أقل من السعر.', v_dates: 'لا يمكن أن ينتهي التخفيض قبل أن يبدأ.', v_dates_nosale: 'التواريخ تُعتمد مع سعر التخفيض فقط.',
      v_desc_long: '٢٨٠ حرفًا على الأكثر، وسيرفض الخادم الأكثر.', v_sizes_none: 'اختر مقاسًا واحدًا على الأقل، أو اختر «بلا مقاسات».', v_stock: 'عدد القطع رقم صحيح من ٠ إلى ٩٩٩٩٩٩.',
      v_size_bad: 'المقاس من ١ إلى ٤ أحرف أو أرقام.', v_size_dup: 'هذا المقاس موجود في القائمة.', v_photo_blocked: 'احذف {n} ملف لا يمكن رفعه.', v_photos_many: '١٢ صورة على الأكثر.', v_order: 'ترتيب التمييز رقم صحيح من ٠ إلى ١٠٠٠٠٠.',
      f_empty: 'الملف فارغ.', f_read: 'تعذّرت قراءة الملف.', f_svg: 'لا يُقبل SVG.', f_format: 'PNG أو JPEG أو WebP فقط.', f_large: 'أكبر من ١٠ ميغابايت.',
      stUpload: 'جارٍ رفع الصورة {i} من {n}…', stSave: 'جارٍ حفظ المنتج (مخفيًا)…', stSizes: 'جارٍ إضافة المقاسات والمخزون…', stShow: 'جارٍ عرضه في المتجر…', stWait: 'يطلب الخادم الانتظار: {s} ث…',
      stepPhotos: 'الصور', stepSave: 'حفظ المنتج', stepSizes: 'المقاسات والمخزون', stepShow: 'العرض في المتجر', done: 'تم', todo: 'لم يتم', skip: 'غير مطلوب', hiddenChoice: 'تُرك مخفيًا كما اخترت',
      okLive: 'حُفظ «{n}» وهو معروض في المتجر.', okHidden: 'حُفظ «{n}» مخفيًا كما اخترت.',
      partial: 'حُفظ «{n}» لكنه مخفي: ليس في المتجر بعد.', noneMade: 'لم يُنشأ شيء.', missing: 'الناقص: {w}.',
      retry: 'إعادة المحاولة', reloadList: 'إعادة تحميل قائمة الكتالوج', another: 'إضافة منتج آخر', closeDone: 'إغلاق',
      staleNote: 'قائمة الكتالوج في هذه الصفحة قُرئت قبل وجود هذا المنتج. أعد تحميلها لرؤيته.',
      e_not_signed_in: 'تم تسجيل خروجك. سجّل الدخول ثم اضغط إعادة المحاولة.', e_network: 'انقطع الاتصال.', e_too_many: 'طلب الخادم التمهّل.',
      e_slug_taken: 'هذا الاسم المختصر مستخدم لدى منتج آخر.', e_invalid_slug: 'الاسم المختصر غير صالح.', e_sale_not_lower: 'يجب أن يكون سعر التخفيض أقل من السعر.',
      e_invalid_price: 'السعر غير صالح.', e_invalid_sale_price: 'سعر التخفيض غير صالح.', e_sale_dates_backwards: 'ينتهي التخفيض قبل أن يبدأ.', e_unknown_brand: 'لا يعرف الخادم هذه العلامة.',
      e_too_long_desc_en: 'الوصف الإنجليزي أطول من ٢٨٠ حرفًا.', e_too_long_desc_ar: 'الوصف العربي أطول من ٢٨٠ حرفًا.', e_missing_name_en: 'الاسم الإنجليزي ناقص.', e_missing_name_ar: 'الاسم العربي ناقص.',
      e_too_long_category: 'الفئة أطول من ٤٠ حرفًا.', e_image_too_large: 'الصورة أكبر من ١٠ ميغابايت.', e_image_bad_format: 'صيغة الصورة غير مقبولة.', e_image_not_an_image: 'الملف ليس صورة صالحة.',
      e_size_exists: 'للمنتج أحد هذه المقاسات أصلًا.', e_not_found: 'ليس لدى هذا الخادم مسار المقاسات بعد (إصدار الواجهة البرمجية).', e_product_not_found: 'تعذّر العثور على المنتج.',
      e_save: 'رفضه الخادم', e_gone: 'المنتج لم يعد موجودًا.', e_read: 'تعذّرت قراءة الملف.',
      bTitle: 'عدة منتجات دفعة واحدة', bIntro: 'صف لكل منتج. العلامة والفئة والمقاسات والمخزون مشتركة. تُطابَق الصور باسم الملف: سمِّ كل ملف باسم المنتج المختصر، وأضف -1 و-2 … لصور إضافية.',
      bShared: 'مشترك بين كل المنتجات', bRows: 'المنتجات', bPaste: 'الصق الصفوف (صف لكل سطر: الاسم الإنجليزي ; العربي ; السعر ; سعر التخفيض)', bPasteBtn: 'املأ الجدول من الصفوف الملصقة',
      bAddRow: 'إضافة صف', bRemoveRow: 'حذف الصف', bPhotos: 'الصور', bUnmatched: 'لم تُطابَق مع أي صف (لن تُرفع):', bNone: 'لا شيء',
      bReview: 'مراجعة', bBack: 'العودة إلى الجدول', bCreate: 'إنشاء {n} منتجات', bCreate1: 'إنشاء منتج واحد', bSummary: '{n} منتجات، {p} صور، {s}.',
      bSizesLine: 'المقاسات {s}', bNoSizes: 'بلا مقاسات', bLive: 'تُعرض في المتجر في النهاية', bHidden: 'تُترك مخفية', bRowState: 'الصف {i}', bTooMany: '٥٠ صفًا على الأكثر.',
      bDone: 'انتهى: {a} معروض، {b} محفوظ مخفيًا، {c} لم يُنشأ.', bRetry: 'أعد محاولة الصفوف غير المكتملة', bRowOk: 'معروض', bRowHidden: 'محفوظ مخفيًا', bRowFail: 'لم يُنشأ', bRowWait: 'في الانتظار',
      colName: 'الاسم (إنجليزي)', colNameAr: 'الاسم (عربي)', colSlug: 'الاسم المختصر', colPrice: 'السعر', colSale: 'سعر التخفيض', colPhotos: 'الصور', colState: 'الحالة'
    }
  }
  var lang = 'en'
  function t(key, vars) {
    var s = (STR[lang] && STR[lang][key] != null) ? STR[lang][key] : (STR.en[key] != null ? STR.en[key] : key)
    if (vars) for (var k in vars) if (Object.prototype.hasOwnProperty.call(vars, k)) s = s.split('{' + k + '}').join(String(vars[k]))
    return s
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
  function cfg(key, dflt) {
    var c = window.SPORTA_NEWPRODUCT, v = c ? Number(c[key]) : NaN
    return isFinite(v) && v >= 0 ? v : dflt
  }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }
  function shown(e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }
  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms) }) }
  function fmtSize(b) {
    if (b < 1024) return t('bytes', { n: b })
    if (b < 1048576) return t('kb', { n: Math.round(b / 1024) })
    return t('mb', { n: Math.round(b / 104857.6) / 10 })
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
  /** The upload goes by XMLHttpRequest only to get byte progress; headers are the same as every other admin call. */
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
  function signedOut(r) { return r.status === 401 || (r.body && r.body.error === 'not_signed_in') }
  /** Repeat a request while the server answers 429, waiting as it asks (Retry-After, else 1, 2, 4 ... seconds). */
  async function patient(send, onWait) {
    var r = null
    for (var attempt = 0; attempt < MAX_TRIES; attempt++) {
      r = await send()
      if (r.status !== 429) return r
      if (attempt === MAX_TRIES - 1) break
      var ra = Number(r.retryAfter)
      var wait = isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 60000) : Math.min(cfg('backoffMs', 1000) * Math.pow(2, attempt), 20000)
      if (onWait) onWait(Math.ceil(wait / 1000))
      await sleep(wait)
    }
    return r
  }
  /** One readable reason for a failed answer. */
  function reasonOf(r, fallback) {
    var code = r.status === 429 ? 'too_many' : r.status === 0 ? 'network' : signedOut(r) ? 'not_signed_in' : (r.body && r.body.error) || ('HTTP ' + r.status)
    var known = STR.en['e_' + code] != null
    return { code: code, text: known ? t('e_' + code) : t(fallback || 'e_save') + ' (' + code + ').' }
  }

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
  function readBuffer(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader()
      fr.onload = function () { resolve(new Uint8Array(fr.result)) }
      fr.onerror = function () { reject(fr.error) }
      fr.readAsArrayBuffer(blob)
    })
  }
  /** A small preview (never uploaded). The page's CSP allows img-src 'self' data: only, so a canvas data URL, not a blob URL. */
  function makeThumb(file) {
    if (!window.createImageBitmap) return Promise.resolve('')
    return createImageBitmap(file, { resizeWidth: 240, resizeQuality: 'low' }).then(function (bmp) {
      var c = document.createElement('canvas')
      c.width = bmp.width; c.height = bmp.height
      var g = c.getContext('2d')
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
      g.drawImage(bmp, 0, 0)
      if (bmp.close) bmp.close()
      return c.toDataURL('image/jpeg', 0.7)
    }).catch(function () { return '' })
  }
  /** The payload is the file's own base64. Only the label is replaced: a file whose type the browser guessed wrongly must
   *  still carry the type its bytes have. */
  function toDataUrl(file, mime) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader()
      fr.onload = function () { var s = String(fr.result), at = s.indexOf(','); resolve('data:' + mime + ';base64,' + s.slice(at + 1)) }
      fr.onerror = function () { reject(fr.error) }
      fr.readAsDataURL(file)
    })
  }
  var nextFileId = 1
  /** A file the form holds: analysed once (type from its bytes, size, thumbnail), `block` says why it cannot be uploaded. */
  function makeItem(file) {
    var it = { id: nextFileId++, file: file, name: file.name, size: file.size, mime: '', block: '', thumb: '', path: '', progress: 0, sig: [file.name, file.size, file.lastModified].join('|') }
    it.ready = (async function () {
      if (file.size === 0) { it.block = 'empty'; return }
      var head
      try { head = await readBuffer(file.slice(0, 1048576)) } catch (e) { it.block = 'read'; return }
      var mime = sniff(head)
      if (!mime) { it.block = looksSvg(head) ? 'svg' : 'format'; return }
      it.mime = mime
      if (file.size > MAX_BYTES) { it.block = 'large'; return }
      it.thumb = await makeThumb(file)
    })()
    return it
  }

  // --------------------------------------------------------------- the values
  function slugify(s) {
    var v = String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (v.length > SLUG_MAX) v = v.slice(0, SLUG_MAX).replace(/-+$/, '')
    return v
  }
  /** Arabic-Indic digits and the Arabic decimal mark typed into a price are read as the plain ones. */
  function plainDigits(s) {
    return String(s == null ? '' : s).replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660) }).replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06f0) }).replace(/[٫,]/g, '.').trim()
  }
  /** "12.5" -> "12.500". null when it is not a price product_save would accept (above 0, at most three decimals). */
  function money(raw) {
    // "1,250" is refused, not read as 1.250: a comma before exactly three digits is most likely a thousands separator.
    if (/^[0-9٠-٩]{1,7}[,٫][0-9٠-٩]{3}$/.test(String(raw == null ? '' : raw).trim())) return null
    var s = plainDigits(raw)
    var m = /^(0|[1-9][0-9]{0,6})(?:\.([0-9]{1,3}))?$/.exec(s)
    if (!m) return null
    var frac = ((m[2] || '') + '000').slice(0, 3)
    if (Number(m[1]) === 0 && Number(frac) === 0) return null
    return m[1] + '.' + frac
  }
  function fils(m) { var p = m.split('.'); return Number(p[0]) * 1000 + Number(p[1]) }
  function whole(raw, max) {
    var s = plainDigits(raw)
    if (!/^(0|[1-9][0-9]{0,5})$/.test(s)) return null
    var n = Number(s)
    return n <= max ? n : null
  }
  function normSize(raw) { return String(raw == null ? '' : raw).trim().toUpperCase() }
  function sizeOk(s) { return /^[A-Z0-9][A-Z0-9.]{0,3}$/.test(s) }
  function lower(s) { return String(s == null ? '' : s).toLowerCase() }

  /** The catalogue as the form knows it: slug -> name, and the category spellings. */
  var known = { loaded: false, failed: false, loading: false, slugs: {}, cats: [], brands: null, brandsFailed: false, route: 'unknown' }
  function catList(rows) {
    var seen = {}, out = []
    rows.forEach(function (p) { var c = clean(p.category); if (c && !seen[c.toLowerCase()]) { seen[c.toLowerCase()] = 1; out.push(c) } })
    return out.sort()
  }
  function readCatalogue() {
    return call('products_all').then(function (r) {
      var rows = rowsOf(r.body)
      if (!r.ok || !rows) { known.failed = true; return r }
      known.failed = false; known.loaded = true; known.slugs = {}
      rows.forEach(function (p) { known.slugs[lower(p.slug)] = { name: p.name_en || p.name_ar || p.slug, id: Number(p.id), active: Number(p.active) === 1, name_en: p.name_en } })
      known.cats = catList(rows)
      return r
    })
  }
  function loadKnown(done) {
    if (known.loading) return
    known.loading = true
    var left = 3
    function fin() { if (--left === 0) { known.loading = false; if (done) done() } }
    readCatalogue().then(fin, fin)
    call('brands').then(function (r) {
      var rows = rowsOf(r.body)
      if (r.ok && rows) { known.brands = rows; known.brandsFailed = false } else known.brandsFailed = true
    }).then(fin, fin)
    // The probe: GET on the new route. 405 = the route is there, 404 = an older server.
    call('variants_create').then(function (r) { known.route = r.status === 405 ? 'yes' : r.status === 404 ? 'no' : 'unknown' }).then(fin, fin)
  }
  function catSpelling(raw) {
    var c = clean(raw)
    if (!c) return { value: '', isNew: false, changed: false }
    var lc = c.toLowerCase()
    for (var i = 0; i < known.cats.length; i++) if (known.cats[i].toLowerCase() === lc) return { value: known.cats[i], isNew: false, changed: known.cats[i] !== c }
    return { value: lc, isNew: true, changed: false }
  }

  /** Every rule product_save has, for one product's values. Returns {field: messageKey} (empty = valid). */
  function validate(v) {
    var e = {}
    if (!clean(v.name_en)) e.name_en = 'v_name_en'; else if (clean(v.name_en).length > NAME_MAX) e.name_en = 'v_name_long'
    if (!clean(v.name_ar)) e.name_ar = 'v_name_ar'; else if (clean(v.name_ar).length > NAME_MAX) e.name_ar = 'v_name_long'
    var slug = v.slug
    if (!slug) e.slug = 'v_slug_empty'
    else if (slug.length > SLUG_MAX) e.slug = 'v_slug_long'
    else if (known.slugs[lower(slug)] && !v.adopted) e.slug = 'v_slug_taken'
    var cat = catSpelling(v.category)
    if (!cat.value) e.category = 'v_cat'; else if (cat.value.length > CAT_MAX) e.category = 'v_cat_long'
    var p = money(v.price)
    if (!p) e.price = 'v_price'
    var hasSale = clean(v.sale) !== ''
    if (hasSale) {
      var sp = money(v.sale)
      if (!sp) e.sale = 'v_sale'
      else if (p && fils(sp) >= fils(p)) e.sale = 'v_sale_ge'
      if (v.saleFrom && v.saleTo && v.saleFrom > v.saleTo) e.saleTo = 'v_dates'
    }
    if (!v.bulk) {
      if (String(v.desc_en || '').length > DESC_MAX) e.desc_en = 'v_desc_long'
      if (String(v.desc_ar || '').length > DESC_MAX) e.desc_ar = 'v_desc_long'
      // The order box is disabled unless the product is featured, and the server ignores it then: check it only when it counts.
      if (v.featured && whole(v.featuredSort === '' || v.featuredSort == null ? '0' : v.featuredSort, 100000) === null) e.featuredSort = 'v_order'
    }
    if (v.sizeMode === 'sizes') {
      if (!v.sizes.length) e.sizes = 'v_sizes_none'
      else for (var i = 0; i < v.sizes.length; i++) if (whole(v.sizes[i].stock, 999999) === null) { e.sizes = 'v_stock'; break }
    }
    var blocked = (v.photos || []).filter(function (x) { return x.block }).length
    if (blocked) e.photos = 'v_photo_blocked'
    else if ((v.photos || []).length > MAX_PHOTOS) e.photos = 'v_photos_many'
    return e
  }

  // ------------------------------------------------------------- the sequence
  /** The body product_save gets, and nothing else it does not read. `active` is ALWAYS false here: the product is shown last. */
  function saveBody(v, paths) {
    var p = money(v.price), sp = clean(v.sale) ? money(v.sale) : null
    return {
      id: 0,
      slug: v.slug,
      name_en: clean(v.name_en),
      name_ar: clean(v.name_ar),
      desc_en: String(v.desc_en || '').trim(),
      desc_ar: String(v.desc_ar || '').trim(),
      price: p,
      sale_price: sp || '',
      sale_starts_at: sp ? (v.saleFrom || '') : '',
      sale_ends_at: sp ? (v.saleTo || '') : '',
      featured: !!v.featured,
      featured_sort: v.featured ? whole(v.featuredSort === '' || v.featuredSort == null ? '0' : v.featuredSort, 100000) : 0,
      brand_slug: v.brand || '',
      category: catSpelling(v.category).value,
      image: paths[0] || '',
      images: paths.slice(1).join(','),
      active: false
    }
  }
  function sizesBody(v) {
    return { slug: v.slug, sizes: v.sizes.map(function (s) { return { size: normSize(s.size), stock: whole(s.stock, 999999) } }) }
  }
  /** A fresh run state for one product. `steps` is what the result panel lists. */
  function newCtx() { return { paths: [], id: 0, slug: '', saveSent: false, saved: false, sizesSent: false, sizesDone: false, activated: false, steps: {}, result: '' } }

  /**
   * Take one product through the sequence, resuming wherever the last try stopped. `v` is the values, `ctx` the run state
   * (kept between tries), `ui` {status(text), progress(item), signedOut()}. Returns a result:
   *   {state: 'live' | 'hidden' | 'none', error?, failedStep?, halted?}
   * 'none' = nothing was created on the server (a failed photo or a refused save); 'hidden' = the product exists and is
   * hidden (by choice, or because a step after the save failed).
   */
  async function createProduct(v, ctx, ui) {
    var items = v.photos || []
    var wait = function (s) { ui.status(t('stWait', { s: s })) }
    function stop(step, why, extra) {
      ctx.steps[step] = 'fail'
      var out = { state: ctx.saved ? 'hidden' : 'none', failedStep: step, error: why.text, code: why.code, halted: why.code === 'not_signed_in' }
      if (extra) for (var k in extra) out[k] = extra[k]
      ctx.result = out.state
      return out
    }
    // 1. photos, before anything exists
    for (var i = 0; i < items.length; i++) {
      var it = items[i]
      if (it.path) { ctx.paths[i] = it.path; continue }
      ui.status(t('stUpload', { i: i + 1, n: items.length }))
      var dataUrl
      try { dataUrl = await toDataUrl(it.file, it.mime) } catch (e) { return stop('photos', reasonOf({ status: 0, body: { error: 'read' } }), { item: it }) }
      var up = await patient(function () { it.progress = 0; return postUpload({ name: it.name, data: dataUrl }, function (f) { it.progress = f; if (ui.progress) ui.progress(it) }) }, wait)
      dataUrl = null
      if (!up.ok || !up.body || typeof up.body.path !== 'string') return stop('photos', reasonOf(up, 'e_save'), { item: it })
      it.path = up.body.path; it.progress = 1
      ctx.paths[i] = it.path
    }
    ctx.paths = ctx.paths.slice(0, items.length)
    ctx.steps.photos = 'done'
    // 2. the product, hidden
    if (!ctx.saved) {
      ui.status(t('stSave'))
      if (ctx.saveSent) {
        // The last try sent the save and its answer never came back: it may exist. Recognise it by slug and name.
        var rd = await patient(function () { return call('products_all') }, wait)
        var rows = rowsOf(rd.body)
        if (rd.ok && rows) {
          for (var k = 0; k < rows.length; k++) {
            if (lower(rows[k].slug) === lower(v.slug)) {
              // Never adopt a row by its slug or name: a lookup can match a different product. A lost answer is
              // checked by the owner in the Catalogue, so stop here and say the slug is taken.
              return stop('save', { code: 'slug_taken', text: t('e_slug_taken') })
            }
          }
        } else if (signedOut(rd)) return stop('save', reasonOf(rd))
      }
      if (!ctx.saved) {
        // A fresh look at the catalogue right before the save: the list read when the screen opened may be minutes old.
        var fresh = await patient(function () { return readCatalogue() }, wait)
        if (signedOut(fresh)) return stop('save', reasonOf(fresh))
        if (known.slugs[lower(v.slug)]) return stop('save', { code: 'slug_taken', text: t('e_slug_taken') })
        // A sized product whose sizes route is missing would be saved hidden with no way to add its sizes: refuse before saving.
        if (v.sizeMode === 'sizes' && known.route === 'no') return stop('save', { code: 'not_found', text: t('e_not_found') })
        ctx.saveSent = true
        var sv = await patient(function () { return call('product_save', saveBody(v, ctx.paths)) }, wait)
        if (!sv.ok || !sv.body || sv.body.error || sv.body.id == null) return stop('save', reasonOf(sv, 'e_save'))
        ctx.id = Number(sv.body.id); ctx.slug = String(sv.body.slug || v.slug); ctx.saved = true
        known.slugs[lower(ctx.slug)] = { name: v.name_en, id: ctx.id, active: false, name_en: v.name_en }
      }
    }
    ctx.steps.save = 'done'
    // 3. sizes and opening stock (all or nothing, one call)
    if (v.sizeMode === 'sizes' && !ctx.sizesDone) {
      ui.status(t('stSizes'))
      var body = sizesBody(v)
      body.slug = ctx.slug || body.slug
      var skip = false
      if (ctx.sizesSent) {
        // A lost answer: the rows are either all there or none. The Stock screen's own route says which.
        var vr = await patient(function () { return call('variants') }, wait)
        var vrows = rowsOf(vr.body)
        if (vr.ok && vrows) {
          var have = vrows.filter(function (x) { return lower(x.slug) === lower(body.slug) })
          if (have.length >= body.sizes.length) { ctx.sizesDone = true; skip = true }
        }
      }
      if (!skip) {
        ctx.sizesSent = true
        var sz = await patient(function () { return call('variants_create', body) }, wait)
        if (sz.status === 404 && sz.body && sz.body.error === 'not_found') { known.route = 'no'; return stop('sizes', { code: 'not_found', text: t('e_not_found') }) }
        if (!sz.ok || !sz.body || sz.body.error) return stop('sizes', reasonOf(sz, 'e_save'))
        ctx.sizesDone = true
      }
    }
    ctx.steps.sizes = v.sizeMode === 'sizes' ? 'done' : 'skip'
    // 4. shown, last
    if (v.active) {
      if (!ctx.activated) {
        ui.status(t('stShow'))
        var ac = await patient(function () { return call('product_active', { id: ctx.id, active: true }) }, wait)
        var on = ac.body && (ac.body.active === 1 || ac.body.active === true || ac.body.active === '1')
        if (!ac.ok || !ac.body || ac.body.error || !on) return stop('show', reasonOf(ac, 'e_save'))
        ctx.activated = true
        if (known.slugs[lower(ctx.slug)]) known.slugs[lower(ctx.slug)].active = true
      }
      ctx.steps.show = 'done'
    } else ctx.steps.show = 'choice'
    ctx.result = ctx.activated ? 'live' : 'hidden'
    return { state: ctx.result }
  }

  // ------------------------------------------------------------------- styles
  var CSS = [
    '.spn-root{--spn-bg:#fff;--spn-soft:#f7f8fa;--spn-line:#d9dfe5;--spn-edge:#7d8799;--spn-text:#18212a;--spn-muted:#556274;--spn-action:#9a452c;--spn-action-hover:#813a25;--spn-on-action:#fff;--spn-ok:#166534;--spn-warn:#8a4b00;--spn-err:#be123c;--spn-focus:#9a452c;--spn-over:#f8ece6;--spn-scrim:rgba(15,23,30,.55);',
    'position:fixed;inset:0;z-index:80;overflow-y:auto;overscroll-behavior:contain;background:var(--spn-scrim);display:block;padding:0;color:var(--spn-text);font:400 .875rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:start}',
    ':is(html.dark,html[data-theme="dark"]) .spn-root{--spn-bg:#151b21;--spn-soft:#1a2128;--spn-line:#303942;--spn-edge:#7a8896;--spn-text:#eef2f5;--spn-muted:#a7b3be;--spn-action:#ff7b17;--spn-action-hover:#ff9a4d;--spn-on-action:#171a1e;--spn-ok:#6ee7a3;--spn-warn:#fbbf24;--spn-err:#fda4af;--spn-focus:#ff7b17;--spn-over:#37251e;--spn-scrim:rgba(0,0,0,.7)}',
    '.spn-root *,.spn-root *::before,.spn-root *::after{box-sizing:border-box}',
    '.spn{position:relative;width:100%;max-width:70rem;min-height:100%;margin:0 auto;background:var(--spn-bg);display:flex;flex-direction:column}',
    '@media (min-width:768px){.spn{min-height:0;margin:1.5rem auto;border-radius:1rem;border:1px solid var(--spn-line)}}',
    '.spn-head{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .75rem;padding:.75rem 1rem;border-bottom:1px solid var(--spn-line)}',
    '.spn-title{margin:0;font-size:1.125rem;font-weight:700;flex:1 1 auto}',
    '.spn-tabs{display:flex;gap:.25rem;padding:.25rem;border:1px solid var(--spn-line);border-radius:.75rem;background:var(--spn-soft)}',
    '.spn-tab{min-height:2.75rem;padding:.25rem .875rem;border:0;border-radius:.5rem;background:transparent;color:var(--spn-muted);font:inherit;font-weight:600;cursor:pointer}',
    '.spn-tab[aria-selected="true"]{background:var(--spn-action);color:var(--spn-on-action);font-weight:700}',
    '.spn-x{display:inline-flex;align-items:center;justify-content:center;width:2.75rem;height:2.75rem;border:1px solid var(--spn-edge);border-radius:.75rem;background:var(--spn-bg);color:var(--spn-text);cursor:pointer}',
    '.spn-body{padding:1rem;display:grid;gap:1rem;grid-template-columns:minmax(0,1fr);flex:1 1 auto}',
    '@media (min-width:1024px){.spn-body.spn-two{grid-template-columns:minmax(0,1fr) 19rem;align-items:start}}',
    '.spn fieldset{margin:0;padding:0;border:0;min-width:0}',
    '.spn-sec{margin:0 0 1rem;padding:1rem;border:1px solid var(--spn-line);border-radius:.875rem;background:var(--spn-bg)}',
    '.spn-sec>h4{margin:0 0 .75rem;font-size:.9375rem;font-weight:700}',
    '.spn-grid{display:grid;gap:.75rem;grid-template-columns:minmax(0,1fr)}',
    '@media (min-width:640px){.spn-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.spn-grid .spn-wide{grid-column:1 / -1}}',
    '.spn-f{display:grid;gap:.25rem;align-content:start;min-width:0}',
    '.spn-f>label,.spn-lab{font-weight:700;font-size:.8125rem}',
    '.spn input[type="text"],.spn input[type="number"],.spn input[type="search"],.spn input[type="datetime-local"],.spn select,.spn textarea{width:100%;min-height:2.75rem;padding:.5rem .75rem;border:1px solid var(--spn-edge);border-radius:.75rem;background:var(--spn-bg);color:var(--spn-text);font:inherit;box-shadow:none}',
    '.spn textarea{min-height:5.5rem;resize:vertical}',
    '.spn :is(input,select,textarea):disabled{opacity:.55;cursor:not-allowed}',
    '.spn input::placeholder,.spn textarea::placeholder{color:var(--spn-muted);opacity:1}',
    '.spn [aria-invalid="true"]{border-color:var(--spn-err)!important}',
    '.spn :is(input,select,textarea,button,summary):focus-visible{outline:2px solid var(--spn-focus);outline-offset:2px}',
    '.spn-num{font-variant-numeric:tabular-nums}',
    '.spn-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;direction:ltr;text-align:start}',
    '.spn-hint{margin:0;color:var(--spn-muted);font-size:.8125rem}',
    '.spn-err{margin:0;color:var(--spn-err);font-weight:600;font-size:.8125rem}',
    '.spn-err:empty{display:none}',
    '.spn-ok{color:var(--spn-ok);font-weight:600}',
    '.spn-warn{color:var(--spn-warn);font-weight:600}',
    '.spn-count{justify-self:end;font-size:.8125rem;color:var(--spn-muted);font-variant-numeric:tabular-nums}',
    '.spn-count[data-over="1"]{color:var(--spn-err);font-weight:700}',
    '.spn-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.75rem;padding:.5rem 1rem;border:1px solid var(--spn-edge);border-radius:.75rem;background:var(--spn-bg);color:var(--spn-text);font:inherit;font-weight:600;cursor:pointer;text-align:center}',
    '.spn-btn:hover:not(:disabled){background:var(--spn-soft);border-color:var(--spn-text)}',
    '.spn-btn--primary{background:var(--spn-action);border-color:transparent;color:var(--spn-on-action);font-weight:700}',
    '.spn-btn--primary:hover:not(:disabled){background:var(--spn-action-hover);border-color:transparent}',
    '.spn-btn:disabled{cursor:not-allowed;background:var(--spn-soft);border-color:var(--spn-line);color:var(--spn-muted)}',
    '.spn-btn--small{padding:.25rem .75rem;font-size:.8125rem}',
    '.spn-chips{display:flex;flex-wrap:wrap;gap:.5rem}',
    '.spn-chip{display:inline-flex;align-items:center;min-height:2.75rem;padding:.25rem .875rem;border:1px solid var(--spn-edge);border-radius:999px;background:var(--spn-bg);color:var(--spn-text);font:inherit;font-weight:600;cursor:pointer}',
    '.spn-chip[aria-pressed="true"]{background:var(--spn-action);border-color:transparent;color:var(--spn-on-action);font-weight:700}',
    '.spn-radio,.spn-check{display:flex;align-items:center;gap:.625rem;min-height:2.75rem;font-weight:600;cursor:pointer}',
    '.spn-radio input,.spn-check input{width:1.25rem;height:1.25rem;accent-color:var(--spn-action);flex:0 0 auto}',
    '.spn-sizes{display:grid;gap:.5rem;margin-top:.5rem}',
    '.spn-sizerow{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}',
    '.spn-sizerow>label{flex:0 0 5rem;font-weight:700}',
    '.spn-sizerow input{max-width:9rem}',
    '.spn-inline{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}',
    '.spn-inline input{max-width:8rem}',
    '.spn-drop{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;padding:1rem;border:2px dashed var(--spn-edge);border-radius:.875rem;background:var(--spn-soft)}',
    '.spn-drop[data-over="1"]{background:var(--spn-over);border-color:var(--spn-action)}',
    '.spn-drop p{margin:0}',
    '.spn-file{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}',
    '.spn-photos{list-style:none;margin:.75rem 0 0;padding:0;display:grid;gap:.5rem}',
    '.spn-photo{display:grid;grid-template-columns:3.5rem minmax(0,1fr);gap:.25rem .75rem;align-items:center;padding:.5rem;border:1px solid var(--spn-line);border-radius:.75rem}',
    '.spn-photo[data-bad="1"]{border-color:var(--spn-err)}',
    '.spn-thumb{width:3.5rem;height:4.375rem;border-radius:.5rem;border:1px solid var(--spn-line);background:var(--spn-soft);object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:.6875rem;color:var(--spn-muted)}',
    '.spn-photo p{margin:0;overflow-wrap:anywhere}',
    '.spn-photo-acts{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}',
    '.spn-badge{display:inline-block;padding:.0625rem .625rem;border:1px solid var(--spn-action);border-radius:999px;font-size:.75rem;font-weight:700;color:var(--spn-action)}',
    '.spn-prev{position:sticky;top:1rem;display:grid;gap:.75rem}',
    '.spn-prev h4{margin:0;font-size:.9375rem;font-weight:700}',
    '.spn-card{border:1px solid var(--spn-line);border-radius:1rem;overflow:hidden;background:var(--spn-bg);max-width:17rem}',
    '.spn-card-img{position:relative;aspect-ratio:4/5;background:var(--spn-soft);display:flex;align-items:center;justify-content:center;color:var(--spn-muted);font-weight:600;overflow:hidden}',
    '.spn-card-img img{width:100%;height:100%;object-fit:cover;display:block}',
    '.spn-card-flag{position:absolute;top:.5rem;inset-inline-start:.5rem;padding:.125rem .625rem;border-radius:999px;background:var(--spn-action);color:var(--spn-on-action);font-size:.75rem;font-weight:700}',
    '.spn-card-flag[data-k="hidden"]{background:var(--spn-text);color:var(--spn-bg)}',
    '.spn-card-body{padding:.75rem;display:grid;gap:.25rem}',
    '.spn-card-brand{margin:0;font-size:.75rem;color:var(--spn-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;min-height:1.1em}',
    '.spn-card-name{margin:0;font-weight:700;overflow-wrap:anywhere;min-height:1.5em}',
    '.spn-card-price{margin:0;font-weight:700;font-variant-numeric:tabular-nums}',
    '.spn-card-price s{color:var(--spn-muted);font-weight:500;margin-inline-start:.5rem}',
    '.spn-card-sizes{display:flex;flex-wrap:wrap;gap:.25rem;margin-top:.25rem}',
    '.spn-card-sizes span{padding:0 .5rem;border:1px solid var(--spn-line);border-radius:.375rem;font-size:.75rem}',
    '.spn-card-sizes span[data-out="1"]{color:var(--spn-muted);text-decoration:line-through}',
    '.spn-seg{display:inline-flex;gap:.25rem}',
    '.spn-foot{position:sticky;bottom:0;display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .75rem;padding:.75rem 1rem;border-top:1px solid var(--spn-line);background:var(--spn-bg);border-radius:0 0 1rem 1rem}',
    '.spn-foot p{margin:0;flex:1 1 14rem;min-width:0;font-weight:600}',
    '.spn-result{margin:0 0 1rem;padding:1rem;border:1px solid var(--spn-line);border-radius:.875rem;background:var(--spn-soft);display:grid;gap:.5rem}',
    '.spn-result[data-k="ok"]{border-color:var(--spn-ok)}',
    '.spn-result[data-k="warn"],.spn-result[data-k="none"]{border-color:var(--spn-err)}',
    '.spn-result h4{margin:0;font-size:1rem}',
    '.spn-steps{list-style:none;margin:0;padding:0;display:grid;gap:.25rem}',
    '.spn-steps li{display:flex;gap:.5rem;align-items:baseline}',
    '.spn-steps [data-s="done"]{color:var(--spn-ok)}.spn-steps [data-s="fail"]{color:var(--spn-err);font-weight:700}',
    '.spn-bar{height:.5rem;border-radius:.25rem;background:var(--spn-line);overflow:hidden}.spn-bar>i{display:block;height:100%;background:var(--spn-action);width:0}',
    '.spn-table-wrap{overflow-x:auto;border:1px solid var(--spn-line);border-radius:.875rem}',
    '.spn-table{width:100%;border-collapse:collapse;min-width:44rem}',
    '.spn-table th{padding:.5rem;text-align:start;font-size:.75rem;color:var(--spn-muted);border-bottom:1px solid var(--spn-line)}',
    '.spn-table td{padding:.375rem .5rem;border-bottom:1px solid var(--spn-line);vertical-align:top}',
    '.spn-table tr:last-child td{border-bottom:0}',
    '.spn-table input{min-width:6rem}',
    '.spn-st{font-weight:700}.spn-st[data-s="live"]{color:var(--spn-ok)}.spn-st[data-s="hidden"],.spn-st[data-s="warn"]{color:var(--spn-warn)}.spn-st[data-s="fail"],.spn-st[data-s="bad"]{color:var(--spn-err)}',
    '.spn-review{display:grid;gap:.5rem;padding:1rem;border:1px solid var(--spn-action);border-radius:.875rem;background:var(--spn-over)}',
    '@media (prefers-reduced-motion:no-preference){.spn-btn,.spn-chip{transition:background-color .15s ease,border-color .15s ease}}',
    // the header button, in the page's own style (the Promotions button's classes), 44px to the finger
    '[' + BTN + ']{min-height:2.75rem}'
  ].join('\n')
  var styleEl = null
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return
    styleEl = document.createElement('style')
    styleEl.setAttribute('data-sporta-newproduct-style', '')
    styleEl.textContent = CSS
    document.head.appendChild(styleEl)
  }
  var SVGNS = 'http://www.w3.org/2000/svg'
  /** A small stroke glyph in the Sporta icon style (24 grid, 1.75 stroke, round). */
  function icon(kind) {
    var s = document.createElementNS(SVGNS, 'svg')
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('fill', 'none')
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.75'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true')
    var d = { close: 'M6 6 18 18M18 6 6 18', plus: 'M12 5V19M5 12H19', up: 'M6 14l6-6 6 6', down: 'M6 10l6 6 6-6', photo: 'M4 6h16v12H4zM4 16l5-5 4 4 3-3 4 4', trash: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13' }[kind]
    var p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', d); s.appendChild(p)
    return s
  }
  function btn(cls, label, onClick, data) {
    var b = el('button', 'spn-btn' + (cls ? ' ' + cls : ''), label)
    b.type = 'button'
    if (data) b.setAttribute('data-spn', data)
    if (onClick) b.addEventListener('click', onClick)
    return b
  }
  /** label + control + error line; `err` is the element the validation writes into. */
  function field(labelText, control, id, opts) {
    var f = el('div', 'spn-f' + (opts && opts.wide ? ' spn-wide' : ''))
    var l = el('label', '', labelText); l.setAttribute('for', id); control.id = id
    f.appendChild(l); f.appendChild(control)
    var hint = null
    if (opts && opts.hint) { hint = el('p', 'spn-hint', opts.hint); hint.id = id + '-hint'; f.appendChild(hint) }
    var err = el('p', 'spn-err'); err.id = id + '-err'; err.setAttribute('role', 'status')
    f.appendChild(err)
    control.setAttribute('aria-describedby', (hint ? hint.id + ' ' : '') + err.id)
    return { node: f, err: err, control: control, hint: hint, label: l }
  }
  function input(type, data, extra) {
    var i = el('input'); i.type = type; i.setAttribute('data-spn', data)
    if (extra) for (var k in extra) i.setAttribute(k, extra[k])
    return i
  }
  function setErr(f, msg) {
    if (f.err.textContent !== msg) f.err.textContent = msg
    if (msg) f.control.setAttribute('aria-invalid', 'true'); else f.control.removeAttribute('aria-invalid')
  }

  // ----------------------------------------------------- the sizes and photos
  /** Sizes and stock: a yes/no, the preset chips, an "other size" box and one stock box per chosen size. `m` = {mode, sizes:[{size, stock}]}. */
  function sizesEditor(m, onChange, uid) {
    var box = el('div')
    var radios = el('div'); radios.setAttribute('role', 'radiogroup'); radios.setAttribute('aria-label', t('secSizes'))
    function radio(value, text) {
      var lab = el('label', 'spn-radio'); var r = input('radio', 'sizes-mode-' + value); r.name = uid + '-mode'; r.value = value; r.checked = m.mode === value
      r.addEventListener('change', function () { if (r.checked) { m.mode = value; draw(); onChange() } })
      lab.appendChild(r); lab.appendChild(document.createTextNode(text)); return lab
    }
    radios.appendChild(radio('sizes', t('sizesYes'))); radios.appendChild(radio('none', t('sizesNo')))
    box.appendChild(radios)
    var body = el('div'); box.appendChild(body)
    var err = el('p', 'spn-err'); err.setAttribute('role', 'status'); box.appendChild(err)
    function has(s) { for (var i = 0; i < m.sizes.length; i++) if (normSize(m.sizes[i].size) === s) return i; return -1 }
    // A new size starts with no count: validation then asks for a number, so a product is never saved sold out by accident.
    function toggle(s) { var i = has(s); if (i >= 0) m.sizes.splice(i, 1); else m.sizes.push({ size: s, stock: '' }); draw(); onChange() }
    function draw() {
      body.textContent = ''
      if (m.mode === 'none') { body.appendChild(el('p', 'spn-hint spn-warn', t('sizesNoWarn'))); return }
      if (known.route === 'no') body.appendChild(el('p', 'spn-hint spn-warn', t('sizesNeedApi')))
      var lab = el('p', 'spn-lab', t('sizesPick')); lab.style.marginTop = '.5rem'; body.appendChild(lab)
      var chips = el('div', 'spn-chips')
      var all = PRESETS.slice()
      m.sizes.forEach(function (s) { var n = normSize(s.size); if (all.indexOf(n) < 0) all.push(n) })
      all.forEach(function (s) {
        var c = el('button', 'spn-chip', s); c.type = 'button'; c.setAttribute('data-spn', 'size-chip-' + s); c.setAttribute('aria-pressed', has(s) >= 0 ? 'true' : 'false')
        c.addEventListener('click', function () { toggle(s) }); chips.appendChild(c)
      })
      body.appendChild(chips)
      var other = el('div', 'spn-inline'); other.style.marginTop = '.5rem'
      var oi = input('text', 'size-custom', { maxlength: '4', 'aria-label': t('custom'), placeholder: t('custom'), autocomplete: 'off' })
      var ob = btn('spn-btn--small', t('add'), function () {
        var s = normSize(oi.value)
        if (!sizeOk(s)) { err.textContent = t('v_size_bad'); return }
        if (has(s) >= 0) { err.textContent = t('v_size_dup'); return }
        err.textContent = ''; m.sizes.push({ size: s, stock: '' }); draw(); onChange()
      }, 'size-add')
      oi.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ob.click() } })
      other.appendChild(oi); other.appendChild(ob); body.appendChild(other)
      body.appendChild(el('p', 'spn-hint', t('customHint')))
      var rows = el('div', 'spn-sizes')
      m.sizes.forEach(function (s, idx) {
        var r = el('div', 'spn-sizerow'); var id = uid + '-stock-' + idx
        var l = el('label', '', normSize(s.size)); l.setAttribute('for', id); r.appendChild(l)
        var inp = input('text', 'stock-' + normSize(s.size), { inputmode: 'numeric', 'aria-label': t('sizeStock', { s: normSize(s.size) }), autocomplete: 'off' }); inp.id = id; inp.value = s.stock
        inp.className = 'spn-num'
        inp.addEventListener('input', function () { s.stock = inp.value; onChange() })
        r.appendChild(inp)
        var rm = el('button', 'spn-btn spn-btn--small', ''); rm.type = 'button'; rm.setAttribute('aria-label', t('remove') + ' ' + normSize(s.size)); rm.appendChild(icon('trash')); rm.addEventListener('click', function () { m.sizes.splice(idx, 1); draw(); onChange() })
        r.appendChild(rm); rows.appendChild(r)
      })
      body.appendChild(rows)
    }
    draw()
    return { node: box, redraw: draw, setError: function (msg) { if (err.textContent !== msg && !/^v_/.test(msg)) err.textContent = msg } , err: err }
  }
  /** Add files to a list (no duplicates, at most `max`), analysing each. Returns how many were added. */
  function addFilesTo(list, fileList, max, after) {
    var added = 0
    Array.prototype.forEach.call(fileList || [], function (f) {
      // Stop at the photo limit itself: files past it would be listed and then block Save.
      if (list.length >= max) return
      var sig = [f.name, f.size, f.lastModified].join('|')
      for (var i = 0; i < list.length; i++) if (list[i].sig === sig) return
      var it = makeItem(f); list.push(it); added++
      it.ready.then(function () { if (after) after() })
    })
    if (added && after) after()
    return added
  }
  function blockText(it) { return t('f_' + it.block) }
  /** The photo list with a drop zone: reorder, remove, thumbnails. First = main. */
  function photosEditor(list, onChange) {
    var box = el('div')
    box.appendChild(el('p', 'spn-hint', t('photosHelp')))
    var drop = el('div', 'spn-drop'); drop.setAttribute('role', 'group'); drop.setAttribute('data-spn', 'drop'); drop.style.marginTop = '.5rem'
    var fi = el('input', 'spn-file'); fi.type = 'file'; fi.multiple = true; fi.accept = 'image/png,image/jpeg,image/webp'; fi.setAttribute('data-spn', 'files'); fi.setAttribute('aria-label', t('choose')); fi.tabIndex = -1
    var pick = btn('', t('choose'), function () { fi.click() }, 'choose'); pick.prepend(icon('photo'))
    drop.appendChild(fi); drop.appendChild(pick); drop.appendChild(el('p', 'spn-hint', t('drop')))
    box.appendChild(drop)
    var ul = el('ul', 'spn-photos'); ul.setAttribute('data-spn', 'photos'); box.appendChild(ul)
    var note = el('p', 'spn-hint'); box.appendChild(note)
    var err = el('p', 'spn-err'); err.setAttribute('role', 'status'); box.appendChild(err)
    function take(files) { addFilesTo(list, files, MAX_PHOTOS, function () { draw(); onChange() }) }
    fi.addEventListener('change', function () { take(fi.files); fi.value = '' })
    ;['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.setAttribute('data-over', '1') }) })
    ;['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.removeAttribute('data-over') }) })
    drop.addEventListener('drop', function (e) { take(e.dataTransfer && e.dataTransfer.files) })
    function draw() {
      ul.textContent = ''
      list.forEach(function (it, i) {
        var li = el('li', 'spn-photo'); if (it.block) li.setAttribute('data-bad', '1')
        var th
        if (it.thumb) { th = el('img', 'spn-thumb'); th.src = it.thumb; th.alt = '' } else th = el('div', 'spn-thumb', it.block ? '!' : '…')
        li.appendChild(th)
        var info = el('div')
        var nm = el('p', '', t('photoOf', { i: i + 1, n: it.name })); nm.style.fontWeight = '700'; info.appendChild(nm)
        var meta = el('p', 'spn-hint', (it.mime ? it.mime.replace('image/', '').toUpperCase() + ' · ' : '') + fmtSize(it.size)); info.appendChild(meta)
        if (it.block) info.appendChild(el('p', 'spn-err', blockText(it)))
        if (i === 0 && !it.block) { var bd = el('span', 'spn-badge', t('main')); info.appendChild(bd) }
        li.appendChild(info)
        var acts = el('div', 'spn-photo-acts')
        var up = el('button', 'spn-btn spn-btn--small', ''); up.type = 'button'; up.setAttribute('aria-label', t('up') + ': ' + it.name); up.appendChild(icon('up')); up.disabled = i === 0
        up.addEventListener('click', function () { list.splice(i - 1, 0, list.splice(i, 1)[0]); draw(); onChange() })
        var dn = el('button', 'spn-btn spn-btn--small', ''); dn.type = 'button'; dn.setAttribute('aria-label', t('down') + ': ' + it.name); dn.appendChild(icon('down')); dn.disabled = i === list.length - 1
        dn.addEventListener('click', function () { list.splice(i + 1, 0, list.splice(i, 1)[0]); draw(); onChange() })
        var rm = btn('spn-btn--small', t('remove'), function () { list.splice(i, 1); draw(); onChange() }, 'photo-remove'); rm.prepend(icon('trash'))
        acts.appendChild(up); acts.appendChild(dn); acts.appendChild(rm); li.appendChild(acts)
        ul.appendChild(li)
      })
      note.textContent = list.length ? t('pxCount', { n: list.length, m: MAX_PHOTOS }) : t('noPhotosNote')
    }
    draw()
    return { node: box, redraw: draw, err: err }
  }

  // ------------------------------------------------------- the one-product form
  function stepLine(label, state, extra) {
    var li = el('li'); li.setAttribute('data-s', state)
    var mark = state === 'done' ? '✓' : state === 'fail' ? '✗' : '–'
    li.appendChild(el('span', '', mark)); li.appendChild(el('span', '', label + (extra ? ' - ' + extra : '')))
    return li
  }
  /** The result panel for one product: what is done, what is missing, and the way on. */
  function resultPanel(v, ctx, r, h) {
    var live = r.state === 'live', none = r.state === 'none'
    var kind = live || (r.state === 'hidden' && !r.failedStep) ? 'ok' : none ? 'none' : 'warn'
    var p = el('div', 'spn-result'); p.setAttribute('data-k', kind); p.setAttribute('data-spn', 'result'); p.setAttribute('role', 'status')
    var title = live ? t('okLive', { n: clean(v.name_en) }) : kind === 'ok' ? t('okHidden', { n: clean(v.name_en) }) : none ? t('noneMade') : t('partial', { n: clean(v.name_en) })
    p.appendChild(el('h4', '', title))
    var st = ctx.steps, ul = el('ul', 'spn-steps')
    var np = (v.photos || []).length
    ul.appendChild(stepLine(t('stepPhotos'), np ? (st.photos === 'done' ? 'done' : st.photos === 'fail' ? 'fail' : 'todo') : 'skip', np ? t('pxCount', { n: (v.photos || []).filter(function (x) { return x.path }).length, m: np }) : t('skip')))
    ul.appendChild(stepLine(t('stepSave'), st.save === 'done' ? 'done' : st.save === 'fail' ? 'fail' : 'todo', st.save === 'done' ? (live ? '' : t('hiddenBadge')) : ''))
    ul.appendChild(stepLine(t('stepSizes'), v.sizeMode === 'sizes' ? (st.sizes === 'done' ? 'done' : st.sizes === 'fail' ? 'fail' : 'todo') : 'skip', v.sizeMode === 'sizes' ? '' : t('skip')))
    ul.appendChild(stepLine(t('stepShow'), v.active ? (st.show === 'done' ? 'done' : st.show === 'fail' ? 'fail' : 'todo') : 'skip', v.active ? '' : t('hiddenChoice')))
    p.appendChild(ul)
    if (r.failedStep) {
      var missing = []
      if (st.photos !== 'done' && np) missing.push(t('stepPhotos'))
      if (st.save !== 'done') missing.push(t('stepSave'))
      if (v.sizeMode === 'sizes' && st.sizes !== 'done') missing.push(t('stepSizes'))
      if (v.active && st.show !== 'done') missing.push(t('stepShow'))
      var why = el('p', 'spn-err', r.error); why.style.margin = '0'; p.appendChild(why)
      p.appendChild(el('p', '', t('missing', { w: missing.join(', ') })))
    }
    var acts = el('div', 'spn-inline')
    if (r.state === 'hidden' && r.failedStep) acts.appendChild(btn('spn-btn--primary', t('retry'), h.retry, 'retry'))
    if (!none) {
      acts.appendChild(btn('', t('reloadList'), function () { location.reload() }, 'reload'))
      acts.appendChild(btn('', t('another'), h.another, 'another'))
    }
    p.appendChild(acts)
    if (!none) p.appendChild(el('p', 'spn-hint', t('staleNote')))
    return p
  }

  function buildSingle(shell) {
    var S = { name_en: '', name_ar: '', slugText: '', slugAuto: true, brand: '', category: '', price: '', sale: '', saleFrom: '', saleTo: '', desc_en: '', desc_ar: '',
      sz: { mode: 'sizes', sizes: [] }, photos: [], active: true, featured: false, featuredSort: '0', touched: {}, submitted: false, ctx: newCtx(), busy: false, finished: false, pl: lang }
    var F = {}            // key -> field {err, control}
    var body = el('div', 'spn-body spn-two'); var main = el('div'); body.appendChild(main)
    var fs = el('fieldset'); main.appendChild(fs)
    var resultHost = el('div'); main.insertBefore(resultHost, fs)
    var foot = el('div', 'spn-foot')
    var sum = el('p', ''); sum.setAttribute('aria-live', 'polite'); sum.setAttribute('data-spn', 'summary')
    var bCancel = btn('', t('cancel'), function () { shell.close() }, 'cancel')
    var bSave = btn('spn-btn--primary', t('save'), function () { onSave() }, 'save')
    foot.appendChild(sum); foot.appendChild(bCancel); foot.appendChild(bSave)

    function values() {
      return { name_en: S.name_en, name_ar: S.name_ar, slug: slugify(S.slugText), category: S.category, brand: S.brand, price: S.price, sale: S.sale, saleFrom: S.saleFrom, saleTo: S.saleTo,
        desc_en: S.desc_en, desc_ar: S.desc_ar, sizeMode: S.sz.mode, sizes: S.sz.sizes, photos: S.photos, active: S.active, featured: S.featured, featuredSort: S.featuredSort,
        adopted: S.ctx.saved || S.ctx.saveSent }
    }
    function sec(title) { var s = el('section', 'spn-sec'); s.appendChild(el('h4', '', title)); fs.appendChild(s); return s }
    function touch(key) { S.touched[key] = true; refresh() }
    function bind(key, ctl, prop, after) {
      ctl.addEventListener('input', function () { S[prop] = ctl.value; if (after) after(); S.touched[key] = true; refresh() })
      ctl.addEventListener('blur', function () { S.touched[key] = true; refresh() })
    }

    // 1. names, slug, brand, category
    var s1 = sec(t('secBasics')); var g1 = el('div', 'spn-grid'); s1.appendChild(g1)
    var nameEn = input('text', 'name-en', { maxlength: '200', autocomplete: 'off' }); nameEn.setAttribute('dir', 'ltr')
    var nameAr = input('text', 'name-ar', { maxlength: '200', autocomplete: 'off', dir: 'rtl', lang: 'ar' })
    F.name_en = field(t('nameEn'), nameEn, 'spn-name-en'); F.name_ar = field(t('nameAr'), nameAr, 'spn-name-ar')
    g1.appendChild(F.name_en.node); g1.appendChild(F.name_ar.node)
    var slugIn = input('text', 'slug', { autocomplete: 'off', spellcheck: 'false' }); slugIn.className = 'spn-mono'
    F.slug = field(t('slug'), slugIn, 'spn-slug', { hint: t('slugHint'), wide: true })
    var slugInfo = el('p', 'spn-hint'); slugInfo.setAttribute('data-spn', 'slug-info'); slugInfo.setAttribute('role', 'status'); F.slug.node.insertBefore(slugInfo, F.slug.err)
    var autoRow = el('label', 'spn-check'); var autoBox = input('checkbox', 'slug-auto'); autoBox.checked = true; autoRow.appendChild(autoBox); autoRow.appendChild(document.createTextNode(t('slugAuto')))
    F.slug.node.insertBefore(autoRow, slugInfo)
    g1.appendChild(F.slug.node)
    var brandSel = el('select'); brandSel.setAttribute('data-spn', 'brand')
    F.brand = field(t('brand'), brandSel, 'spn-brand'); g1.appendChild(F.brand.node)
    var catIn = input('text', 'category', { maxlength: '60', autocomplete: 'off', list: 'spn-cats', autocapitalize: 'none' })
    var dl = el('datalist'); dl.id = 'spn-cats'
    F.category = field(t('category'), catIn, 'spn-category', { hint: t('catHint') }); F.category.node.appendChild(dl); g1.appendChild(F.category.node)
    var catChips = el('div', 'spn-chips'); catChips.setAttribute('data-spn', 'cat-chips'); F.category.node.insertBefore(catChips, F.category.err)
    var catInfo = el('p', 'spn-hint'); catInfo.setAttribute('data-spn', 'cat-info'); F.category.node.insertBefore(catInfo, F.category.err)

    // 2. price
    var s2 = sec(t('secPrice')); var g2 = el('div', 'spn-grid'); s2.appendChild(g2)
    var priceIn = input('text', 'price', { inputmode: 'decimal', placeholder: '10.000', autocomplete: 'off' }); priceIn.className = 'spn-num'
    var saleIn = input('text', 'sale', { inputmode: 'decimal', placeholder: '8.500', autocomplete: 'off' }); saleIn.className = 'spn-num'
    F.price = field(t('price'), priceIn, 'spn-price', { hint: t('priceHint') }); F.sale = field(t('sale'), saleIn, 'spn-sale')
    var fromIn = input('datetime-local', 'sale-from'), toIn = input('datetime-local', 'sale-to')
    F.saleFrom = field(t('saleFrom'), fromIn, 'spn-sale-from'); F.saleTo = field(t('saleTo'), toIn, 'spn-sale-to')
    g2.appendChild(F.price.node); g2.appendChild(F.sale.node); g2.appendChild(F.saleFrom.node); g2.appendChild(F.saleTo.node)

    // 3. descriptions
    var s3 = sec(t('secDesc')); var g3 = el('div', 'spn-grid'); s3.appendChild(g3)
    var dEn = el('textarea'); dEn.setAttribute('data-spn', 'desc-en'); dEn.setAttribute('dir', 'ltr')
    var dAr = el('textarea'); dAr.setAttribute('data-spn', 'desc-ar'); dAr.setAttribute('dir', 'rtl'); dAr.setAttribute('lang', 'ar')
    F.desc_en = field(t('descEn'), dEn, 'spn-desc-en', { wide: true }); F.desc_ar = field(t('descAr'), dAr, 'spn-desc-ar', { wide: true })
    var cEn = el('p', 'spn-count'); cEn.setAttribute('data-spn', 'count-en'); var cAr = el('p', 'spn-count'); cAr.setAttribute('data-spn', 'count-ar')
    F.desc_en.node.insertBefore(cEn, F.desc_en.err); F.desc_ar.node.insertBefore(cAr, F.desc_ar.err)
    g3.appendChild(F.desc_en.node); g3.appendChild(F.desc_ar.node)

    // 4. sizes
    var s4 = sec(t('secSizes'))
    var sizes = sizesEditor(S.sz, function () { S.touched.sizes = true; refresh() }, 'spn1'); s4.appendChild(sizes.node)

    // 5. photos
    var s5 = sec(t('secPhotos'))
    var photos = photosEditor(S.photos, function () { S.touched.photos = true; refresh() }); s5.appendChild(photos.node)

    // 6. in the shop
    var s6 = sec(t('secShow'))
    var showRow = el('label', 'spn-check'); var showBox = input('checkbox', 'active'); showBox.checked = true; showRow.appendChild(showBox); showRow.appendChild(document.createTextNode(t('show')))
    var showNote = el('p', 'spn-hint'); showNote.textContent = ''
    var featRow = el('label', 'spn-check'); var featBox = input('checkbox', 'featured'); featRow.appendChild(featBox); featRow.appendChild(document.createTextNode(t('feature')))
    var ordIn = input('text', 'featured-sort', { inputmode: 'numeric', autocomplete: 'off' }); ordIn.value = '0'; ordIn.className = 'spn-num'
    F.featuredSort = field(t('featureOrder'), ordIn, 'spn-fsort'); F.featuredSort.node.style.maxWidth = '10rem'
    s6.appendChild(showRow); s6.appendChild(showNote); s6.appendChild(featRow); s6.appendChild(F.featuredSort.node)

    // events
    bind('name_en', nameEn, 'name_en', function () { if (S.slugAuto) { S.slugText = slugify(S.name_en); slugIn.value = S.slugText } })
    bind('name_ar', nameAr, 'name_ar')
    slugIn.addEventListener('input', function () {
      S.slugText = slugIn.value
      if (!slugIn.value) { S.slugAuto = true; autoBox.checked = true; S.slugText = slugify(S.name_en) } else { S.slugAuto = false; autoBox.checked = false }
      S.touched.slug = true; refresh()
    })
    slugIn.addEventListener('blur', function () { var n = slugify(slugIn.value); if (n !== slugIn.value) { slugIn.value = n; S.slugText = n } S.touched.slug = true; refresh() })
    autoBox.addEventListener('change', function () { S.slugAuto = autoBox.checked; if (S.slugAuto) { S.slugText = slugify(S.name_en); slugIn.value = S.slugText } refresh() })
    brandSel.addEventListener('change', function () { S.brand = brandSel.value; refresh() })
    bind('category', catIn, 'category')
    bind('price', priceIn, 'price'); bind('sale', saleIn, 'sale')
    bind('saleFrom', fromIn, 'saleFrom'); bind('saleTo', toIn, 'saleTo')
    bind('desc_en', dEn, 'desc_en'); bind('desc_ar', dAr, 'desc_ar')
    bind('featuredSort', ordIn, 'featuredSort')
    showBox.addEventListener('change', function () { S.active = showBox.checked; refresh() })
    featBox.addEventListener('change', function () { S.featured = featBox.checked; refresh() })

    // the right column: the card as the shop draws it
    var aside = el('aside', 'spn-prev'); aside.setAttribute('aria-label', t('preview')); body.appendChild(aside)
    aside.appendChild(el('h4', '', t('preview')))
    var seg = el('div', 'spn-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', t('previewLang'))
    ;['en', 'ar'].forEach(function (l) {
      var b = el('button', 'spn-chip', l === 'ar' ? 'العربية' : 'English'); b.type = 'button'; b.setAttribute('data-spn', 'pl-' + l); b.setAttribute('aria-pressed', S.pl === l ? 'true' : 'false')
      b.addEventListener('click', function () { S.pl = l; refresh() }); seg.appendChild(b)
    })
    aside.appendChild(seg)
    var card = el('div', 'spn-card'); card.setAttribute('data-spn', 'card'); aside.appendChild(card)

    function brandName(slug) {
      if (!slug || !known.brands) return ''
      for (var i = 0; i < known.brands.length; i++) if (known.brands[i].slug === slug) return (S.pl === 'ar' ? known.brands[i].name_ar : known.brands[i].name_en) || known.brands[i].name_en || slug
      return slug
    }
    function drawCard(v, e) {
      card.textContent = ''
      card.setAttribute('dir', S.pl === 'ar' ? 'rtl' : 'ltr'); card.setAttribute('lang', S.pl)
      var img = el('div', 'spn-card-img')
      var first = null
      for (var i = 0; i < v.photos.length; i++) if (!v.photos[i].block && v.photos[i].thumb) { first = v.photos[i]; break }
      if (first) { var im = el('img'); im.src = first.thumb; im.alt = ''; img.appendChild(im) } else img.appendChild(document.createTextNode(t('noPhoto')))
      var p = money(v.price), sp = clean(v.sale) ? money(v.sale) : null
      var onSale = !!(p && sp && fils(sp) < fils(p))
      if (!v.active) { var fl = el('span', 'spn-card-flag', t('hiddenBadge')); fl.setAttribute('data-k', 'hidden'); img.appendChild(fl) }
      card.appendChild(img)
      var b = el('div', 'spn-card-body')
      b.appendChild(el('p', 'spn-card-brand', brandName(v.brand)))
      b.appendChild(el('p', 'spn-card-name', clean(S.pl === 'ar' ? v.name_ar : v.name_en) || '…'))
      var pr = el('p', 'spn-card-price')
      if (p) {
        pr.appendChild(document.createTextNode((onSale ? sp : p) + ' ' + t('kwd')))
        if (onSale) pr.appendChild(el('s', '', p))
      } else pr.textContent = '—'
      b.appendChild(pr)
      if (v.sizeMode === 'sizes' && v.sizes.length) {
        var sz = el('div', 'spn-card-sizes')
        v.sizes.forEach(function (s) { var x = el('span', '', normSize(s.size)); if (whole(s.stock, 999999) === 0) x.setAttribute('data-out', '1'); sz.appendChild(x) })
        b.appendChild(sz)
      }
      card.appendChild(b)
    }

    function msg(key, e) { return e[key] ? t(e[key], { n: (v0.photos || []).filter(function (x) { return x.block }).length }) : '' }
    var v0 = null
    function visible(key) { return S.submitted || S.touched[key] }
    function refresh() {
      var v = values(); v0 = v; var e = validate(v)
      Object.keys(F).forEach(function (k) { if (k !== 'brand' && F[k].err) setErr(F[k], visible(k) && e[k] ? msg(k, e) : '') })
      // slug status
      var slug = v.slug
      slugInfo.className = 'spn-hint'
      if (!slug) slugInfo.textContent = ''
      else if (known.loading && !known.loaded) slugInfo.textContent = t('slugChecking')
      else if (known.failed && !known.loaded) slugInfo.textContent = t('slugUnknown')
      else if (known.slugs[lower(slug)] && !v.adopted) { slugInfo.textContent = t('slugTaken', { n: known.slugs[lower(slug)].name }); slugInfo.className = 'spn-err' }
      else { slugInfo.textContent = t('slugFree', { s: slug }); slugInfo.className = 'spn-hint spn-ok' }
      if (e.slug === 'v_slug_taken') F.slug.err.textContent = ''
      // category
      var cs = catSpelling(v.category)
      catInfo.textContent = !cs.value ? '' : cs.isNew ? t('catNew', { c: cs.value }) : cs.changed ? t('catSame', { c: cs.value }) : ''
      if (catChips.getAttribute('data-for') !== known.cats.join('|')) {
        catChips.textContent = ''; catChips.setAttribute('data-for', known.cats.join('|')); dl.textContent = ''
        known.cats.forEach(function (c) {
          var b = el('button', 'spn-chip', c); b.type = 'button'; b.setAttribute('data-spn', 'cat-' + c); b.setAttribute('aria-pressed', 'false')
          b.addEventListener('click', function () { catIn.value = c; S.category = c; S.touched.category = true; refresh() }); catChips.appendChild(b)
          var o = el('option'); o.value = c; dl.appendChild(o)
        })
      }
      Array.prototype.forEach.call(catChips.children, function (b) { b.setAttribute('aria-pressed', cs.value && b.textContent === cs.value && !cs.isNew ? 'true' : 'false') })
      // brand list
      if (brandSel.getAttribute('data-for') !== (known.brands ? known.brands.length + ':' + known.brands.map(function (b) { return b.slug }).join() : known.brandsFailed ? 'x' : '')) {
        brandSel.setAttribute('data-for', known.brands ? known.brands.length + ':' + known.brands.map(function (b) { return b.slug }).join() : known.brandsFailed ? 'x' : '')
        brandSel.textContent = ''
        var o0 = el('option', '', t('noBrand')); o0.value = ''; brandSel.appendChild(o0)
        ;(known.brands || []).forEach(function (b) { var o = el('option', '', (lang === 'ar' ? (b.name_ar || b.name_en) : (b.name_en || b.name_ar)) + (Number(b.active) === 0 ? ' ' + t('brandHidden') : '')); o.value = b.slug; brandSel.appendChild(o) })
        brandSel.value = S.brand
        if (known.brandsFailed) { F.brand.err.textContent = t('brandFail') }
      }
      // sale dates only with a sale price
      fromIn.disabled = toIn.disabled = !clean(v.sale)
      // counters
      ;[['desc_en', cEn], ['desc_ar', cAr]].forEach(function (p) {
        var n = String(v[p[0]] || '').length
        p[1].textContent = t('counter', { n: n, m: DESC_MAX }); p[1].setAttribute('data-over', n > DESC_MAX ? '1' : '0')
      })
      // sizes + photos messages
      sizes.err.textContent = visible('sizes') && e.sizes ? t(e.sizes) : ''
      photos.err.textContent = visible('photos') && e.photos ? msg('photos', e) : ''
      showNote.textContent = v.active ? '' : t('hiddenNote')
      ordIn.disabled = !v.featured
      // preview
      Array.prototype.forEach.call(seg.children, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-spn') === 'pl-' + S.pl ? 'true' : 'false') })
      drawCard(v, e)
      // footer
      var n = Object.keys(e).length
      if (!S.busy) {
        sum.textContent = S.ctx.saved ? '' : n ? (n === 1 ? t('fixOne') : t('fix', { n: n })) : t('ready')
        sum.className = n ? 'spn-warn' : 'spn-ok'
      }
    }
    var ui = {
      status: function (text) { sum.textContent = text; sum.className = '' },
      progress: function () {}
    }
    function lock(on) { fs.disabled = on; bSave.disabled = on }
    function showResult(r) {
      var v = values()
      resultHost.textContent = ''
      resultHost.appendChild(resultPanel(v, S.ctx, r, { retry: function () { run() }, another: function () { shell.reset() } }))
      var rp = resultHost.firstChild; if (rp.scrollIntoView) rp.scrollIntoView({ block: 'nearest' })
      if (r.state === 'none') {
        lock(false); sum.textContent = ''
        if (r.code === 'slug_taken') { S.touched.slug = true }
        refresh()
        return
      }
      S.finished = r.state === 'live' || !r.failedStep
      bSave.hidden = true
      bCancel.textContent = t('closeDone')
      lock(true); bSave.disabled = true
      sum.textContent = ''
      var rb = resultHost.querySelector('[data-spn="retry"]'); if (rb) rb.focus()
    }
    async function run() {
      S.busy = true; lock(true); resultHost.textContent = ''; ui.status(t('saving'))
      try { await Promise.all(S.photos.map(function (p) { return p.ready })) } catch (e) { /* analysed or blocked */ }
      refresh()
      var v = values()
      var e = validate(v)
      if (Object.keys(e).length && !S.ctx.saved) { S.busy = false; lock(false); S.submitted = true; refresh(); focusFirst(e); return }
      var r
      try { r = await createProduct(v, S.ctx, ui) } catch (x) { r = { state: S.ctx.saved ? 'hidden' : 'none', failedStep: S.ctx.saved ? 'show' : 'save', error: t('e_network'), code: 'network' } }
      S.busy = false
      showResult(r)
    }
    function focusFirst(e) {
      var order = ['name_en', 'name_ar', 'slug', 'category', 'price', 'sale', 'saleTo', 'desc_en', 'desc_ar', 'featuredSort']
      for (var i = 0; i < order.length; i++) if (e[order[i]] && F[order[i]]) { F[order[i]].control.focus(); return }
      if (e.sizes) { var c = s4.querySelector('button,input'); if (c) c.focus() } else if (e.photos) { var pb = s5.querySelector('button'); if (pb) pb.focus() }
    }
    function onSave() { if (S.busy || S.finished) return; run() }

    fs.appendChild(document.createComment(''));
    loadKnown(function () { sizes.redraw(); refresh() })
    refresh()
    return {
      body: body, foot: foot,
      focus: function () { nameEn.focus() },
      // A saved product whose sizes did not get in is unfinished: closing must ask first.
      dirty: function () { return (S.ctx.saved && S.sz.mode === 'sizes' && !S.ctx.sizesDone) || (!S.ctx.saved && !!(clean(S.name_en) || clean(S.name_ar) || clean(S.price) || S.photos.length || clean(S.desc_en) || clean(S.desc_ar))) },
      busy: function () { return S.busy },
      onKnown: function () { sizes.redraw(); refresh() }
    }
  }

  // ----------------------------------------------------------- many products
  function blankRow() { return { id: nextFileId++, name_en: '', name_ar: '', slugText: '', slugAuto: true, price: '', sale: '', ctx: newCtx(), state: 'wait', msg: '' } }
  function rowBlank(r) { return !clean(r.name_en) && !clean(r.name_ar) && !clean(r.slugText) && !clean(r.price) && !clean(r.sale) }

  function buildBulk(shell) {
    var B = { rows: [blankRow(), blankRow(), blankRow()], sz: { mode: 'sizes', sizes: [] }, brand: '', category: '', active: true, files: [], stage: 'edit', busy: false, done: false }
    var body = el('div', 'spn-body'); var fs = el('fieldset'); body.appendChild(fs)
    var foot = el('div', 'spn-foot'); var sum = el('p', ''); sum.setAttribute('aria-live', 'polite'); sum.setAttribute('data-spn', 'b-summary')
    foot.appendChild(sum)
    var actions = el('div', 'spn-inline'); foot.appendChild(actions)

    var intro = el('section', 'spn-sec'); intro.appendChild(el('h4', '', t('bTitle'))); intro.appendChild(el('p', 'spn-hint', t('bIntro'))); fs.appendChild(intro)
    // shared
    var shared = el('section', 'spn-sec'); shared.appendChild(el('h4', '', t('bShared'))); fs.appendChild(shared)
    var g = el('div', 'spn-grid'); shared.appendChild(g)
    var brandSel = el('select'); brandSel.setAttribute('data-spn', 'b-brand'); var fBrand = field(t('brand'), brandSel, 'spn-b-brand'); g.appendChild(fBrand.node)
    var catIn = input('text', 'b-category', { maxlength: '60', autocomplete: 'off', list: 'spn-cats', autocapitalize: 'none' }); var fCat = field(t('category'), catIn, 'spn-b-category', { hint: t('catHint') }); g.appendChild(fCat.node)
    var dl = el('datalist'); dl.id = 'spn-cats'; fCat.node.appendChild(dl)
    var catInfo = el('p', 'spn-hint'); fCat.node.insertBefore(catInfo, fCat.err)
    var sizes = sizesEditor(B.sz, function () { refresh() }, 'spnb'); var sw = el('div', 'spn-wide'); sw.appendChild(sizes.node); g.appendChild(sw)
    var showRow = el('label', 'spn-check spn-wide'); var showBox = input('checkbox', 'b-active'); showBox.checked = true; showRow.appendChild(showBox); showRow.appendChild(document.createTextNode(t('show'))); g.appendChild(showRow)
    brandSel.addEventListener('change', function () { B.brand = brandSel.value })
    catIn.addEventListener('input', function () { B.category = catIn.value; refresh() }); catIn.addEventListener('blur', function () { B.catTouched = true; refresh() })
    showBox.addEventListener('change', function () { B.active = showBox.checked; refresh() })

    // the table
    var tableSec = el('section', 'spn-sec'); tableSec.appendChild(el('h4', '', t('bRows'))); fs.appendChild(tableSec)
    var pasteLab = el('label', 'spn-lab', t('bPaste')); pasteLab.setAttribute('for', 'spn-b-paste'); tableSec.appendChild(pasteLab)
    var paste = el('textarea'); paste.id = 'spn-b-paste'; paste.setAttribute('data-spn', 'b-paste'); paste.rows = 3; tableSec.appendChild(paste)
    var pasteBtn = btn('spn-btn--small', t('bPasteBtn'), function () {
      var lines = paste.value.split(/\r?\n/).map(function (l) { return l.trim() }).filter(Boolean)
      var made = []
      lines.forEach(function (l) {
        var sep = l.indexOf('\t') >= 0 ? '\t' : l.indexOf(';') >= 0 ? ';' : '|'
        var c = l.split(sep).map(function (x) { return x.trim() })
        var r = blankRow(); r.name_en = c[0] || ''; r.name_ar = c[1] || ''; r.price = c[2] || ''; r.sale = c[3] || ''; r.slugText = slugify(r.name_en)
        made.push(r)
      })
      if (!made.length) return
      var kept = B.rows.filter(function (r) { return !rowBlank(r) }).concat(made)
      B.rows = kept.slice(0, MAX_ROWS)
      // Rows past the limit are not kept; say so instead of dropping them silently.
      if (kept.length > MAX_ROWS) sum.textContent = t('bTooMany')
      paste.value = ''; drawRows(); refresh()
    }, 'b-paste-fill'); pasteBtn.style.marginTop = '.5rem'; tableSec.appendChild(pasteBtn)
    var wrap = el('div', 'spn-table-wrap'); wrap.style.marginTop = '.75rem'; tableSec.appendChild(wrap)
    var tbl = el('table', 'spn-table'); wrap.appendChild(tbl)
    var thead = el('thead'); var hr = el('tr'); ['#', t('colName'), t('colNameAr'), t('colSlug'), t('colPrice'), t('colSale'), t('colPhotos'), t('colState'), ''].forEach(function (h) { var th = el('th', '', h); th.scope = 'col'; hr.appendChild(th) }); thead.appendChild(hr); tbl.appendChild(thead)
    var tbody = el('tbody'); tbl.appendChild(tbody)
    var addRow = btn('', t('bAddRow'), function () { if (B.rows.length >= MAX_ROWS) { sum.textContent = t('bTooMany'); return } B.rows.push(blankRow()); drawRows(); refresh() }, 'b-add-row'); addRow.prepend(icon('plus')); addRow.style.marginTop = '.75rem'; tableSec.appendChild(addRow)

    // photos
    var phSec = el('section', 'spn-sec'); phSec.appendChild(el('h4', '', t('bPhotos'))); fs.appendChild(phSec)
    var drop = el('div', 'spn-drop'); drop.setAttribute('data-spn', 'b-drop')
    var fi = el('input', 'spn-file'); fi.type = 'file'; fi.multiple = true; fi.accept = 'image/png,image/jpeg,image/webp'; fi.setAttribute('data-spn', 'b-files'); fi.setAttribute('aria-label', t('choose')); fi.tabIndex = -1
    var pick = btn('', t('choose'), function () { fi.click() }, 'b-choose'); pick.prepend(icon('photo'))
    drop.appendChild(fi); drop.appendChild(pick); drop.appendChild(el('p', 'spn-hint', t('drop'))); phSec.appendChild(drop)
    var fileList = el('ul', 'spn-photos'); fileList.setAttribute('data-spn', 'b-filelist'); phSec.appendChild(fileList)
    function take(files) { addFilesTo(B.files, files, 400, function () { refresh() }) }
    fi.addEventListener('change', function () { take(fi.files); fi.value = '' })
    ;['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.setAttribute('data-over', '1') }) })
    ;['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.removeAttribute('data-over') }) })
    drop.addEventListener('drop', function (e) { take(e.dataTransfer && e.dataTransfer.files) })

    var review = el('div', 'spn-review'); review.hidden = true; fs.appendChild(review)
    var resultHost = el('div'); body.insertBefore(resultHost, fs)

    var cells = {}   // row id -> {slugIn, photosCell, stCell, issues}
    function drawRows() {
      tbody.textContent = ''; cells = {}
      B.rows.forEach(function (r, i) {
        var tr = el('tr'); tr.setAttribute('data-spn', 'b-row'); tr.setAttribute('data-row', String(i))
        tr.appendChild(el('td', '', String(i + 1)))
        function cell(prop, data, extra, cls) {
          var td = el('td'); var inp = input('text', data, extra); if (cls) inp.className = cls; inp.value = r[prop]
          inp.setAttribute('aria-label', data + ' ' + (i + 1))
          inp.addEventListener('input', function () {
            r[prop] = inp.value
            if (prop === 'name_en' && r.slugAuto) { r.slugText = slugify(r.name_en); cells[r.id].slugIn.value = r.slugText }
            refresh()
          })
          td.appendChild(inp); tr.appendChild(td); return inp
        }
        cell('name_en', 'b-name-en', { maxlength: '200', autocomplete: 'off', dir: 'ltr' })
        cell('name_ar', 'b-name-ar', { maxlength: '200', autocomplete: 'off', dir: 'rtl', lang: 'ar' })
        var slugIn = cell('slugText', 'b-slug', { autocomplete: 'off', spellcheck: 'false' }, 'spn-mono')
        slugIn.addEventListener('input', function () { r.slugAuto = !slugIn.value; if (r.slugAuto) { r.slugText = slugify(r.name_en); } })
        slugIn.addEventListener('blur', function () { var n = slugify(slugIn.value); if (n !== slugIn.value) { slugIn.value = n; r.slugText = n; refresh() } })
        cell('price', 'b-price', { inputmode: 'decimal', autocomplete: 'off' }, 'spn-num')
        cell('sale', 'b-sale', { inputmode: 'decimal', autocomplete: 'off' }, 'spn-num')
        var pc = el('td', 'spn-num'); tr.appendChild(pc)
        var st = el('td'); var stb = el('span', 'spn-st'); stb.setAttribute('data-spn', 'b-state'); st.appendChild(stb); var iss = el('p', 'spn-err'); st.appendChild(iss); tr.appendChild(st)
        var rmTd = el('td'); var rm = el('button', 'spn-btn spn-btn--small', ''); rm.type = 'button'; rm.setAttribute('aria-label', t('bRemoveRow') + ' ' + (i + 1)); rm.setAttribute('data-spn', 'b-remove-row'); rm.appendChild(icon('trash'))
        rm.addEventListener('click', function () { B.rows.splice(i, 1); if (!B.rows.length) B.rows.push(blankRow()); drawRows(); refresh() }); rmTd.appendChild(rm); tr.appendChild(rmTd)
        cells[r.id] = { slugIn: slugIn, pc: pc, stb: stb, iss: iss, tr: tr }
        tbody.appendChild(tr)
      })
    }

    /** File name -> row. A whole-name match wins over a "-N" split; no suffix = main photo. */
    function matching() {
      var bySlug = {}
      B.rows.forEach(function (r, i) { var s = slugify(r.slugText); if (s && bySlug[s] == null) bySlug[s] = i })
      var per = B.rows.map(function () { return [] }), loose = []
      B.files.forEach(function (it) {
        var stem = slugify(it.name.replace(/\.[^.]*$/, '')), row = bySlug[stem], pos = 1
        if (row == null) { var m = /^(.+)-([0-9]{1,2})$/.exec(stem); if (m && bySlug[m[1]] != null) { row = bySlug[m[1]]; pos = Number(m[2]) } }
        if (row == null) loose.push(it); else per[row].push({ it: it, pos: pos })
      })
      return { per: per.map(function (l) { return l.sort(function (a, b) { return a.pos - b.pos || (a.it.name < b.it.name ? -1 : 1) }).map(function (x) { return x.it }) }), loose: loose }
    }
    function rowValues(r, photos) {
      return { bulk: true, name_en: r.name_en, name_ar: r.name_ar, slug: slugify(r.slugText), category: B.category, brand: B.brand, price: r.price, sale: r.sale, saleFrom: '', saleTo: '',
        desc_en: '', desc_ar: '', sizeMode: B.sz.mode, sizes: B.sz.sizes, photos: photos, active: B.active, featured: false, featuredSort: '0', adopted: r.ctx.saved || r.ctx.saveSent }
    }
    var lastMatch = null
    function problems() {
      var m = matching(); lastMatch = m
      var seen = {}, out = []
      B.rows.forEach(function (r, i) {
        if (rowBlank(r)) { out.push(null); return }
        var e = validate(rowValues(r, m.per[i]))
        var s = slugify(r.slugText)
        if (s) { if (seen[s] != null) e.slug = 'v_slug_dup'; else seen[s] = i }
        out.push(e)
      })
      return { e: out, m: m }
    }
    function refresh() {
      var p = problems(), m = p.m
      var cs = catSpelling(B.category)
      catInfo.textContent = !cs.value ? '' : cs.isNew ? t('catNew', { c: cs.value }) : cs.changed ? t('catSame', { c: cs.value }) : ''
      var shared = validate({ name_en: 'x', name_ar: 'x', slug: 'x', category: B.category, price: '1', sizeMode: B.sz.mode, sizes: B.sz.sizes, photos: [] })
      setErr(fCat, B.catTouched && shared.category ? t(shared.category) : '')
      var sig = known.brands ? known.brands.map(function (b) { return b.slug }).join() : known.brandsFailed ? 'x' : ''
      if (brandSel.getAttribute('data-for') !== sig) {
        brandSel.setAttribute('data-for', sig); brandSel.textContent = ''
        var o0 = el('option', '', t('noBrand')); o0.value = ''; brandSel.appendChild(o0)
        ;(known.brands || []).forEach(function (b) { var o = el('option', '', (lang === 'ar' ? (b.name_ar || b.name_en) : (b.name_en || b.name_ar)) + (Number(b.active) === 0 ? ' ' + t('brandHidden') : '')); o.value = b.slug; brandSel.appendChild(o) })
        brandSel.value = B.brand
        dl.textContent = ''; known.cats.forEach(function (c) { var o = el('option'); o.value = c; dl.appendChild(o) })
      }
      var bad = 0, filled = 0, photos = 0
      B.rows.forEach(function (r, i) {
        var c = cells[r.id]; if (!c) return
        var e = p.e[i]
        c.pc.textContent = String(m.per[i].length); photos += m.per[i].length
        if (!e) { c.stb.textContent = ''; c.stb.setAttribute('data-s', ''); c.iss.textContent = ''; return }
        filled++
        var keys = Object.keys(e)
        if (r.state === 'live') { c.stb.textContent = t('bRowOk'); c.stb.setAttribute('data-s', 'live'); c.iss.textContent = '' }
        else if (r.state === 'hidden') { c.stb.textContent = t('bRowHidden'); c.stb.setAttribute('data-s', 'hidden'); c.iss.textContent = r.msg }
        else if (r.state === 'fail') { c.stb.textContent = t('bRowFail'); c.stb.setAttribute('data-s', 'fail'); c.iss.textContent = r.msg }
        else if (r.state === 'run') { c.stb.textContent = r.msg; c.stb.setAttribute('data-s', ''); c.iss.textContent = '' }
        else if (keys.length) { bad++; c.stb.textContent = ''; c.stb.setAttribute('data-s', 'bad'); c.iss.textContent = keys.map(function (k) { return t(e[k], { n: 1 }) }).join(' ') }
        else { c.stb.textContent = ''; c.stb.setAttribute('data-s', ''); c.iss.textContent = '' }
        c.slugIn.setAttribute('aria-invalid', e.slug ? 'true' : 'false'); if (!e.slug) c.slugIn.removeAttribute('aria-invalid')
      })
      if (shared.category && B.catTouched) bad++
      if (shared.sizes) bad++
      // the file list
      fileList.textContent = ''
      B.files.forEach(function (it, idx) {
        var rowIdx = -1; m.per.forEach(function (l, i) { if (l.indexOf(it) >= 0) rowIdx = i })
        var li = el('li', 'spn-photo'); if (it.block || rowIdx < 0) li.setAttribute('data-bad', '1')
        var th; if (it.thumb) { th = el('img', 'spn-thumb'); th.src = it.thumb; th.alt = '' } else th = el('div', 'spn-thumb', it.block ? '!' : '…')
        li.appendChild(th)
        var info = el('div'); var nm = el('p', '', it.name); nm.style.fontWeight = '700'; info.appendChild(nm)
        info.appendChild(el('p', it.block || rowIdx < 0 ? 'spn-err' : 'spn-hint', it.block ? blockText(it) : rowIdx < 0 ? t('bUnmatched').replace(/:$/, '') : '→ ' + t('bRowState', { i: rowIdx + 1 }) + ' (' + slugify(B.rows[rowIdx].slugText) + ')'))
        li.appendChild(info)
        var acts = el('div', 'spn-photo-acts'); var rm = btn('spn-btn--small', t('remove'), function () { B.files.splice(idx, 1); refresh() }, 'b-file-remove'); rm.prepend(icon('trash')); acts.appendChild(rm); li.appendChild(acts)
        fileList.appendChild(li)
      })
      // A photo that matches no product is not uploaded, so it blocks Review like a refused file.
      B.files.forEach(function (it) {
        var matched = m.per.some(function (l) { return l.indexOf(it) >= 0 })
        if (it.block || !matched) bad++
      })
      B.bad = bad; B.filled = filled; B.photoCount = photos
      drawActions()
    }
    var sizeSummary = function () { return B.sz.mode === 'sizes' ? t('bSizesLine', { s: B.sz.sizes.map(function (s) { return normSize(s.size) + '×' + (whole(s.stock, 999999) == null ? '?' : whole(s.stock, 999999)) }).join(' ') }) : t('bNoSizes') }
    function drawActions() {
      actions.textContent = ''
      if (B.busy) return
      if (B.stage === 'edit') {
        sum.textContent = B.filled === 0 ? '' : B.bad ? t('fix', { n: B.bad }) : t('ready')
        sum.className = B.bad ? 'spn-warn' : 'spn-ok'
        actions.appendChild(btn('', t('cancel'), function () { shell.close() }, 'b-cancel'))
        var rv = btn('spn-btn--primary', t('bReview'), function () { goReview() }, 'b-review'); rv.disabled = !B.filled || B.bad > 0; actions.appendChild(rv)
      } else if (B.stage === 'review') {
        actions.appendChild(btn('', t('bBack'), function () { B.stage = 'edit'; review.hidden = true; fs.disabled = false; refresh() }, 'b-back'))
        actions.appendChild(btn('spn-btn--primary', B.filled === 1 ? t('bCreate1') : t('bCreate', { n: B.filled }), function () { go() }, 'b-create'))
      } else if (B.stage === 'done') {
        var left = B.rows.filter(function (r) { return !rowBlank(r) && (r.state === 'fail' || (r.state === 'hidden' && B.active && !r.ctx.activated)) }).length
        if (left) actions.appendChild(btn('spn-btn--primary', t('bRetry'), function () { go() }, 'b-retry'))
        actions.appendChild(btn('', t('reloadList'), function () { location.reload() }, 'reload'))
        actions.appendChild(btn('', t('closeDone'), function () { shell.close() }, 'b-close'))
      }
    }
    function goReview() {
      var p = problems(); refresh()
      if (B.bad || !B.filled) return
      B.stage = 'review'; fs.disabled = true
      review.hidden = false; review.textContent = ''
      review.appendChild(el('h4', '', t('bReview')))
      var line = el('p', '', t('bSummary', { n: B.filled, p: B.photoCount, s: sizeSummary() }) + ' ' + (B.active ? t('bLive') : t('bHidden')) + '.'); line.setAttribute('data-spn', 'b-review-line'); review.appendChild(line)
      var ul = el('ul', 'spn-steps')
      B.rows.forEach(function (r, i) { if (rowBlank(r)) return; var li = el('li'); li.appendChild(el('span', '', String(i + 1) + '.')); li.appendChild(el('span', '', clean(r.name_en) + ' / ' + clean(r.name_ar) + ' / ' + slugify(r.slugText) + ' / ' + (money(r.price) || '') + (clean(r.sale) ? ' → ' + money(r.sale) : '') + ' / ' + (lastMatch.per[i].length + ' ' + t('bPhotos')))); ul.appendChild(li) })
      review.appendChild(ul)
      drawActions()
    }
    async function go() {
      if (B.busy) return
      B.busy = true; B.stage = 'run'; fs.disabled = true; review.hidden = true; actions.textContent = ''
      try { await Promise.all(B.files.map(function (f) { return f.ready })) } catch (e) { /* blocked */ }
      var m = matching(), halted = false, n = 0, total = B.rows.filter(function (r) { return !rowBlank(r) }).length
      for (var i = 0; i < B.rows.length && !halted; i++) {
        var r = B.rows[i]
        if (rowBlank(r) || r.state === 'live' || (r.state === 'hidden' && (!B.active || r.ctx.activated))) { if (!rowBlank(r)) n++; continue }
        n++
        r.state = 'run'; r.msg = ''; var c = cells[r.id]
        var v = rowValues(r, m.per[i])
        var res
        try {
          res = await createProduct(v, r.ctx, { status: function (s) { r.msg = s; sum.textContent = t('bRowState', { i: i + 1 }) + ' (' + n + '/' + total + '): ' + s; if (c) c.stb.textContent = s }, progress: function () {} })
        } catch (x) { res = { state: r.ctx.saved ? 'hidden' : 'none', failedStep: r.ctx.saved ? 'show' : 'save', error: t('e_network'), code: 'network' } }
        if (res.state === 'live') { r.state = 'live'; r.msg = '' }
        else if (res.state === 'hidden') { r.state = 'hidden'; r.msg = res.failedStep ? res.error + ' ' + t('missing', { w: [res.failedStep].join() }) : t('hiddenChoice') }
        else { r.state = 'fail'; r.msg = res.error }
        if (res.halted) halted = true
        refreshRowOnly()
        if (!halted) await sleep(cfg('paceMs', 250))
      }
      B.busy = false; B.stage = 'done'
      var live = B.rows.filter(function (r) { return r.state === 'live' }).length, hid = B.rows.filter(function (r) { return r.state === 'hidden' }).length, nono = B.rows.filter(function (r) { return r.state === 'fail' }).length
      sum.textContent = t('bDone', { a: live, b: hid, c: nono }); sum.className = nono || hid ? 'spn-warn' : 'spn-ok'
      refreshRowOnly(); drawActions()
    }
    function refreshRowOnly() { try { refresh() } catch (e) { /* the table is only a display */ } }

    drawRows()
    loadKnown(function () { sizes.redraw(); refresh() })
    refresh()
    return {
      body: body, foot: foot,
      focus: function () { var i = tbody.querySelector('input'); if (i) i.focus() },
      dirty: function () { return B.stage !== 'done' && (B.rows.some(function (r) { return !rowBlank(r) }) || B.files.length > 0) },
      busy: function () { return B.busy }
    }
  }

  // ------------------------------------------------------------ the modal
  var modal = null, openerBtn = null
  function closeModal() {
    if (!modal) return
    if (modal.view && modal.view.busy && modal.view.busy()) return
    if (modal.view && modal.view.dirty && modal.view.dirty() && !window.confirm(t('discard'))) return
    document.removeEventListener('keydown', modal.onKey, true)
    document.body.style.overflow = modal.prevOverflow
    if (modal.root.parentNode) modal.root.parentNode.removeChild(modal.root)
    var back = openerBtn && openerBtn.isConnected ? openerBtn : null
    modal = null
    if (back) back.focus()
  }
  function openModal() {
    if (modal) return
    ensureStyle()
    lang = langOf(document.querySelector('.admin-content') || document.body)
    var root = el('div', 'spn-root'); root.setAttribute('data-sporta-newproduct', ''); root.setAttribute('lang', lang); root.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
    var dlg = el('div', 'spn'); dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'spn-title'); root.appendChild(dlg)
    var head = el('div', 'spn-head'); var h = el('h3', 'spn-title', t('title')); h.id = 'spn-title'; head.appendChild(h)
    var tabs = el('div', 'spn-tabs'); tabs.setAttribute('role', 'tablist')
    var slot = el('div'); slot.style.display = 'contents'
    var shell = { close: closeModal, reset: function () { show('one', true) } }
    modal = { root: root, view: null, prevOverflow: document.body.style.overflow }
    function show(which, fresh) {
      if (modal.view && !fresh && modal.which === which) return
      if (modal.view && modal.view.busy && modal.view.busy()) return
      if (modal.view && modal.view.dirty && modal.view.dirty() && !fresh && !window.confirm(t('discard'))) { setTabs(modal.which); return }
      slot.textContent = ''
      var v = which === 'one' ? buildSingle(shell) : buildBulk(shell)
      slot.appendChild(v.body); slot.appendChild(v.foot)
      modal.view = v; modal.which = which; setTabs(which); v.focus()
    }
    function setTabs(which) { Array.prototype.forEach.call(tabs.children, function (b) { b.setAttribute('aria-selected', b.getAttribute('data-which') === which ? 'true' : 'false') }) }
    ;[['one', t('tabOne')], ['many', t('tabMany')]].forEach(function (x) {
      var b = el('button', 'spn-tab', x[1]); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('data-which', x[0]); b.setAttribute('data-spn', 'tab-' + x[0])
      b.addEventListener('click', function () { show(x[0]) }); tabs.appendChild(b)
    })
    head.appendChild(tabs)
    var x = el('button', 'spn-x', ''); x.type = 'button'; x.setAttribute('aria-label', t('close')); x.setAttribute('data-spn', 'close'); x.appendChild(icon('close')); x.addEventListener('click', closeModal); head.appendChild(x)
    dlg.appendChild(head); dlg.appendChild(slot)
    modal.onKey = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(); return }
      if (e.key !== 'Tab') return
      var f = Array.prototype.filter.call(dlg.querySelectorAll('button,input,select,textarea,a[href]'), function (n) { return !n.disabled && !n.hidden && n.tabIndex !== -1 && n.getClientRects().length })
      if (!f.length) return
      var first = f[0], last = f[f.length - 1], a = document.activeElement
      if (e.shiftKey && (a === first || !dlg.contains(a))) { e.preventDefault(); last.focus() } else if (!e.shiftKey && (a === last || !dlg.contains(a))) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', modal.onKey, true)
    document.body.style.overflow = 'hidden'
    document.body.appendChild(root)
    show('one', true)
  }

  // -------------------------------------------------- the entry in the Catalogue
  function catalogueHeading() {
    var hs = document.querySelectorAll('.admin-page h1')
    for (var i = 0; i < hs.length; i++) if (clean(hs[i].textContent) === 'Catalogue' && shown(hs[i])) return hs[i]
    return null
  }
  function ensure() {
    var h = catalogueHeading()
    var have = document.querySelector('[' + BTN + ']')
    if (!h) { if (have) have.remove(); return }
    if (have && have.isConnected && have.closest('.admin-page') === h.closest('.admin-page')) return
    if (have) have.remove()
    var head = h.closest('.admin-page-header') || h.parentElement
    if (!head) return
    lang = langOf(head)
    var b = document.createElement('button')
    b.type = 'button'
    b.setAttribute(BTN, '1')
    b.className = 'rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700'
    b.textContent = t('open')
    b.addEventListener('click', function () { openerBtn = b; openModal() })
    head.appendChild(b)
  }
  function start() {
    setInterval(function () { if (document.hidden) return; try { ensure() } catch (e) { /* the page keeps working without it */ } }, 500)   // a hidden tab has nobody to add a button for
  }
  window.addEventListener('beforeunload', function (e) {
    if (!modal || !modal.view || !modal.view.busy || !modal.view.busy()) return undefined
    e.preventDefault(); e.returnValue = ''
    return ''
  })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN NEW PRODUCT - end ============================================ */

/* ===== ADMIN SPORTA AI - begin ===========================================
 * 10. Sporta AI (owner request 2026-11-11: "make sporta ai setup at backends").
 *
 * A "Sporta AI" entry in the compiled live admin where the owner sets up the shop
 * assistant: on / off, the welcome (Arabic and English), AI phrasing (on / off,
 * the model, the API key), the hours after which an order counts as late, and the
 * number and e-mail the assistant gives when it hands a shopper to a person, plus
 * a Test button. Every rule lives on the SERVER (assistant.php, "the owner's
 * settings"); this block draws, collects and reports.
 *
 * Routes, with the admin session cookie and the X-Sporta-Admin header:
 *   GET  assistant_settings       -> { enabled, ai_enabled, welcome_ar, welcome_en, ai_model, late_hours, handoff_phone,
 *                                      handoff_email, ai_key_set, server{...}, ai_active, limits{} }
 *   POST assistant_settings_save  { the same fields, ai_key?, ai_key_clear? } -> the same as GET
 *   POST assistant_test           { lang } -> { question, shop_reply, reply, source, ai{status, http, ms, model}, enabled, off_reply }
 *
 * THE KEY IS WRITE-ONLY. The key box is a password field that is never filled
 * from the server (the server never sends the key): the card shows only whether a
 * key is saved, a typed key is sent once, on Save, and the box is emptied again.
 * "Remove the saved key" sends ai_key_clear.
 *
 * AN EMPTY FIELD MEANS "THE SERVER'S VALUE": each field shows that value as its
 * placeholder (server{} in the answer), so the owner sees what an empty box means.
 *
 * WHEN THE SERVER DOES NOT HAVE THE ROUTE (this file deployed before the API):
 * the first GET answers 404 and this block adds NOTHING to the page for the rest
 * of the visit, like Site content.
 *
 * THE ENTRY is made exactly like "Site content" above (read its comment): nodes
 * are only ADDED (a nav button, a tile in the phone menu, a second title in the
 * phone header, one <section> in <main>), React's own nodes are never removed,
 * moved or re-texted, the tab React considers current is hidden by CSS while this
 * panel is open, and a click on any other nav button (React's, Site content's,
 * Abandoned orders') closes this panel before that click is handled. Opening
 * pushes ?tab=assistant.
 *
 * Everything shown is built with createElement + textContent, never as markup.
 * Labels are in English and Arabic; every control is at least 44px tall.
 */
;(function () {   // leading ; - the block above ends in `)()` with no semicolon
  'use strict'
  // OWNER SWITCH (2026-11-13): the Sporta AI screen is hidden from /backends.
  // Set to false to bring the nav entry and the setup page back; nothing else in
  // this block changes. The server settings (assistant.php) are untouched.
  var SPORTA_AI_ADMIN_HIDDEN = true
  if (SPORTA_AI_ADMIN_HIDDEN) return
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaAssistantSetup) return
  try { Object.defineProperty(window, '__sportaAssistantSetup', { value: { version: 1 }, enumerable: false, configurable: false }) } catch (e) { return }

  var API = '/api/admin.php'
  var TAB = 'assistant'
  var PAGE = 'data-sporta-ai'               // the section
  var NAVMARK = 'data-sporta-ai-nav'        // our nav button / menu tile
  var CURMARK = 'data-sporta-ai-cur'        // React's current tab, while ours is open
  var OPEN = 'data-sporta-ai-open'          // on <body>: "open"
  var TITLE = 'data-sporta-ai-title'
  var OTHER_NAVS = ['data-sporta-sc-nav', 'data-sporta-ab-nav']   // the other add-on panels' entries (not React's)
  var OTHER_TABS = ['content', 'abandoned']
  var NAME = 'Sporta AI · سبورتا AI'
  var MSG = {
    not_signed_in: 'Your sign-in has ended. Sign in again, then reopen this screen. · انتهت الجلسة، سجّل الدخول من جديد.',
    bad_request: 'The save was refused. Reload the page and try again. · رُفض الحفظ، أعد تحميل الصفحة.',
    request_too_large: 'Too much text in one save. · النص كثير جدًا.',
    invalid_assistant_settings: 'The save was refused. Reload the page and try again. · رُفض الحفظ، أعد تحميل الصفحة.',
    invalid_assistant_enabled: 'The on / off switch could not be read. Reload the page. · تعذّرت قراءة مفتاح التشغيل.',
    invalid_assistant_ai_enabled: 'The AI phrasing switch could not be read. Reload the page. · تعذّرت قراءة مفتاح الصياغة.',
    invalid_assistant_ai_key_clear: 'The "remove the key" box could not be read. Reload the page. · تعذّرت قراءة خيار حذف المفتاح.',
    too_long_assistant_welcome_ar: 'The Arabic welcome is longer than 300 characters. · رسالة الترحيب بالعربية أطول من 300 حرف.',
    too_long_assistant_welcome_en: 'The English welcome is longer than 300 characters. · رسالة الترحيب بالإنجليزية أطول من 300 حرف.',
    html_in_assistant_welcome_ar: 'The Arabic welcome cannot contain < or > (no HTML). · لا يمكن استخدام < أو > في الترحيب.',
    html_in_assistant_welcome_en: 'The English welcome cannot contain < or > (no HTML). · لا يمكن استخدام < أو > في الترحيب.',
    link_in_assistant_welcome_ar: 'The Arabic welcome cannot contain a link or a web address. · لا يمكن وضع رابط في الترحيب.',
    link_in_assistant_welcome_en: 'The English welcome cannot contain a link or a web address. · لا يمكن وضع رابط في الترحيب.',
    price_in_assistant_welcome_ar: 'The Arabic welcome cannot contain a price (a number with KD / KWD / د.ك). · لا يمكن كتابة سعر في الترحيب.',
    price_in_assistant_welcome_en: 'The English welcome cannot contain a price (a number with KD / KWD / د.ك). · لا يمكن كتابة سعر في الترحيب.',
    invalid_assistant_welcome_ar: 'The Arabic welcome could not be read. · تعذّرت قراءة الترحيب بالعربية.',
    invalid_assistant_welcome_en: 'The English welcome could not be read. · تعذّرت قراءة الترحيب بالإنجليزية.',
    invalid_assistant_ai_model: 'The model name must be lower-case letters, digits, dots and hyphens, like claude-haiku-5-5. · اسم النموذج غير صحيح.',
    invalid_assistant_late_hours: 'Late after: a whole number of hours from 1 to 720 (30 days), or empty for the server value. · عدد الساعات من 1 إلى 720.',
    invalid_assistant_handoff_phone: 'The phone must be a full number, with + and the country code (+965 22091914), or 8 digits for Kuwait. · رقم الهاتف غير صحيح.',
    invalid_assistant_handoff_email: 'That is not an email address. · البريد الإلكتروني غير صحيح.',
    invalid_ai_key: 'That does not look like an API key (20 to 256 letters, digits, - and _; no spaces). The key was not saved. · المفتاح غير صحيح ولم يُحفظ.',
    ai_key_conflict: 'Either type a new key or tick "Remove the saved key", not both. · إما مفتاح جديد أو حذف المفتاح، لا الاثنين.',
    save_failed: 'The server could not store the settings. Try again. · تعذّر الحفظ، حاول مرة أخرى.'
  }
  var NOT_YET = 'Sporta AI settings are not available until the next update of the shop server. Nothing is wrong with your account.'

  // ------------------------------------------------------------------- state
  var S = { open: false, loaded: false, loading: false, saving: false, testing: false, doc: null, saved: '', note: null, test: null }
  var probeState = 'unknown'     // unknown | present | absent
  var probing = false, firstDoc = null
  var wantOpen = false, autoOpened = false
  var prevUrl = ''
  var panel = null, refs = null, styleEl = null, queued = false

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
    // a speech bubble with a plus
    ;['M4 5h16v11H9l-5 4V5', 'M12 8.5v4', 'M10 10.5h4'].forEach(function (d) {
      var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.appendChild(p)
    })
    return s
  }
  function str(v) { return typeof v === 'string' ? v : '' }
  function token(b) { var e = b && b.error; return typeof e === 'string' && /^[a-z_]{1,60}$/.test(e) ? e : '' }
  function isOther(b) { for (var i = 0; i < OTHER_NAVS.length; i++) if (b.hasAttribute(OTHER_NAVS[i])) return true; return false }

  // ------------------------------------------------------------ admin requests
  function request(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, body: j } })
    }).catch(function () { return { ok: false, status: 0, body: null } })
  }
  function failText(r) {
    var code = token(r.body)
    if (r.status === 0) return 'Could not reach the server. Check the connection and try again. · تعذّر الاتصال بالخادم.'
    if (r.status === 401) return MSG.not_signed_in
    if (r.status === 404) return NOT_YET
    if (r.status === 429) return 'Too many presses. Wait a minute, then try again. · طلبات كثيرة، انتظر دقيقة.'
    if (MSG[code]) return MSG[code]
    return 'The server could not do that (' + (code || 'HTTP ' + r.status) + ').'
  }
  function isDoc(b) { return !!(b && typeof b === 'object' && typeof b.enabled === 'boolean' && b.server && typeof b.server === 'object') }

  // ------------------------------------------------------------- form <-> state
  /** What Save would send (without the key fields). */
  function formBody() {
    if (!refs) return null
    return {
      enabled: refs.enabled.checked, ai_enabled: refs.aiEnabled.checked,
      welcome_ar: refs.welcomeAr.value.trim(), welcome_en: refs.welcomeEn.value.trim(),
      ai_model: refs.model.value.trim(), late_hours: refs.hours.value.trim(),
      handoff_phone: refs.phone.value.trim(), handoff_email: refs.email.value.trim()
    }
  }
  function docBody(d) {
    return {
      enabled: d.enabled !== false, ai_enabled: d.ai_enabled !== false,
      welcome_ar: str(d.welcome_ar), welcome_en: str(d.welcome_en), ai_model: str(d.ai_model),
      late_hours: typeof d.late_hours === 'number' && d.late_hours > 0 ? String(d.late_hours) : '',
      handoff_phone: str(d.handoff_phone), handoff_email: str(d.handoff_email)
    }
  }
  function dirty() {
    if (!refs || !S.loaded) return false
    return JSON.stringify(formBody()) !== S.saved || refs.key.value.trim() !== '' || refs.clearKey.checked
  }
  /** Take a server answer (GET or the answer to a save) as the new baseline and fill the form. */
  function adopt(d) {
    S.doc = d
    S.loaded = true
    S.saved = JSON.stringify(docBody(d))
    if (refs) fill()
  }
  function fill() {
    var d = S.doc, b = docBody(d), sv = d.server || {}
    refs.enabled.checked = b.enabled
    refs.aiEnabled.checked = b.ai_enabled
    refs.welcomeAr.value = b.welcome_ar; refs.welcomeAr.placeholder = str(sv.welcome_ar)
    refs.welcomeEn.value = b.welcome_en; refs.welcomeEn.placeholder = str(sv.welcome_en)
    refs.model.value = b.ai_model; refs.model.placeholder = str(sv.ai_model)
    refs.hours.value = b.late_hours; refs.hours.placeholder = sv.late_hours ? String(sv.late_hours) : '48'
    refs.phone.value = b.handoff_phone; refs.phone.placeholder = str(sv.handoff_phone)
    refs.email.value = b.handoff_email; refs.email.placeholder = str(sv.handoff_email)
    refs.key.value = ''
    refs.clearKey.checked = false
    var lim = d.limits && typeof d.limits.welcome === 'number' ? d.limits.welcome : 300
    refs.welcomeAr.maxLength = lim; refs.welcomeEn.maxLength = lim
    drawKey(); drawFoot()
  }
  function drawKey() {
    if (!refs || !S.doc) return
    var d = S.doc, sv = d.server || {}
    var text
    if (d.ai_key_set) text = 'A key is saved here. It is never shown; type a new one to replace it. · يوجد مفتاح محفوظ هنا (لا يُعرض).'
    else if (sv.ai_key_set) text = 'No key saved here: the key in the server configuration is used. · لا يوجد مفتاح هنا، ويُستخدم مفتاح إعدادات الخادم.'
    else text = 'No key: answers are the shop\'s own sentences, without AI phrasing. · لا يوجد مفتاح: الردود بصياغة المتجر نفسها.'
    refs.keyState.textContent = text
    refs.keyState.setAttribute('data-set', d.ai_key_set || sv.ai_key_set ? '1' : '0')
    refs.clearRow.hidden = !d.ai_key_set
    refs.active.textContent = d.ai_active
      ? 'AI phrasing is active: the model rewords greetings, thanks and search results; every fact stays the shop\'s. · الصياغة بالذكاء الاصطناعي مفعلة.'
      : 'AI phrasing is not active: every answer is the shop\'s own sentence. · الصياغة بالذكاء الاصطناعي غير مفعلة.'
  }
  function drawStatus() {
    if (!refs) return
    refs.status.textContent = S.note ? S.note.text : ''
    if (S.note && S.note.bad) refs.status.setAttribute('data-bad', '1'); else refs.status.removeAttribute('data-bad')
  }
  function drawFoot() {
    if (!refs) return
    refs.save.disabled = S.saving || !S.loaded
    refs.reload.disabled = S.saving || S.loading
    refs.test.disabled = S.testing || !S.loaded
    refs.dirty.textContent = !S.loaded ? '' : dirty() ? 'Changes not saved yet · تغييرات غير محفوظة' : 'Everything is saved · كل شيء محفوظ'
  }
  function drawTest() {
    if (!refs) return
    var box = refs.result
    while (box.firstChild) box.removeChild(box.firstChild)
    var t = S.test
    if (!t) { box.hidden = true; return }
    box.hidden = false
    var ai = t.ai || {}
    var WHAT = {
      answered: 'The AI answered, and its wording passed the shop\'s checks. · ردّ الذكاء الاصطناعي واجتاز الفحص.',
      refused: 'The AI answered, but the shop\'s checks threw its wording away; shoppers get the shop\'s own sentence. · ردّ الذكاء الاصطناعي لكن رُفضت صياغته.',
      no_answer: 'No answer from the AI service (timeout or network). Shoppers get the shop\'s own sentence. · لا رد من خدمة الذكاء الاصطناعي.',
      off: 'AI phrasing is not active (no key, or switched off). Shoppers get the shop\'s own sentences. · الصياغة غير مفعلة.'
    }
    var what = ai.status === 'http_error'
      ? (ai.http === 401 || ai.http === 403
        ? 'The AI service refused the key (HTTP ' + ai.http + '). Check the key. · رفضت الخدمة المفتاح.'
        : 'The AI service answered with an error (HTTP ' + ai.http + '). · ردّت الخدمة بخطأ.')
      : (WHAT[ai.status] || 'Unknown result.')
    var ok = ai.status === 'answered'
    var verdict = el('p', 'sai-verdict', what)
    verdict.setAttribute('data-ok', ok ? '1' : '0')
    box.appendChild(verdict)
    var dl = el('dl', 'sai-dl')
    var row = function (k, v) {
      if (v == null || v === '') return
      dl.appendChild(el('dt', '', k))
      var dd = el('dd', '', String(v)); dd.setAttribute('dir', 'auto'); dl.appendChild(dd)
    }
    row('Question · السؤال', t.question)
    row('Shop\'s answer · رد المتجر', t.shop_reply)
    if (ok) row('AI wording · صياغة الذكاء الاصطناعي', t.reply)
    if (ai.status !== 'off') row('Model · النموذج', ai.model)
    if (typeof ai.ms === 'number' && ai.status !== 'off') row('Time · الوقت', ai.ms + ' ms')
    if (t.enabled === false) row('The assistant is OFF. Shoppers are told · المساعد متوقف، يظهر للزائر', t.off_reply)
    box.appendChild(dl)
  }

  // ------------------------------------------------------------------ actions
  function probe() {
    if (probeState !== 'unknown' || probing) return
    probing = true
    request('assistant_settings').then(function (r) {
      probing = false
      var absent = r.status === 404 || r.status === 405 || r.status === 501 || (r.ok && !isDoc(r.body))
      probeState = absent ? 'absent' : 'present'
      if (r.ok && isDoc(r.body)) firstDoc = r.body
      schedule()
    })
  }
  function load() {
    if (S.loading) return
    S.loading = true; S.note = { text: 'Loading… · جارٍ التحميل…', bad: false }
    drawStatus(); drawFoot()
    request('assistant_settings').then(function (r) {
      S.loading = false
      if (r.ok && isDoc(r.body)) { adopt(r.body); S.note = null } else S.note = { text: failText(r), bad: true }
      drawStatus(); drawFoot()
    })
  }
  function save() {
    if (S.saving || !S.loaded || !refs) return
    var body = formBody()
    var h = body.late_hours
    if (h !== '' && !(/^[0-9]{1,3}$/.test(h) && Number(h) >= 1 && Number(h) <= 720)) { S.note = { text: MSG.invalid_assistant_late_hours, bad: true }; drawStatus(); refs.hours.focus(); return }
    var key = refs.key.value.trim()
    if (key && refs.clearKey.checked) { S.note = { text: MSG.ai_key_conflict, bad: true }; drawStatus(); return }
    if (key) body.ai_key = key
    if (refs.clearKey.checked) body.ai_key_clear = true
    S.saving = true; S.note = { text: 'Saving… · جارٍ الحفظ…', bad: false }
    drawStatus(); drawFoot()
    request('assistant_settings_save', body).then(function (r) {
      S.saving = false
      body = null; key = ''          // nothing here keeps the typed key once it has been sent
      if (r.ok && isDoc(r.body)) {
        adopt(r.body)
        S.note = { text: 'Saved. The assistant uses it from the next question. · تم الحفظ، ويُطبق من السؤال التالي.', bad: false }
      } else {
        // a refused key is not kept in the box either: the owner types it again
        if (refs && token(r.body) === 'invalid_ai_key') refs.key.value = ''
        S.note = { text: failText(r), bad: true }
      }
      drawStatus(); drawFoot()
    })
  }
  function runTest() {
    if (S.testing || !refs) return
    S.testing = true; S.test = null
    S.note = { text: (dirty() ? 'Testing the SAVED settings (save first to test your changes)… · يُختبر المحفوظ فقط…' : 'Testing… · جارٍ الاختبار…'), bad: false }
    drawStatus(); drawTest(); drawFoot()
    request('assistant_test', { lang: refs.testLang.value === 'en' ? 'en' : 'ar' }).then(function (r) {
      S.testing = false
      if (r.ok && r.body && typeof r.body === 'object' && r.body.ai && typeof r.body.ai.status === 'string') { S.test = r.body; S.note = null }
      else S.note = { text: failText(r), bad: true }
      drawStatus(); drawTest(); drawFoot()
    })
  }

  // ------------------------------------------------------------------- panel
  var CSS = [
    '.sai{--sai-bg:#fff;--sai-soft:#f7f8fa;--sai-line:#d9dfe5;--sai-edge:#7d8799;--sai-text:#18212a;--sai-muted:#556274;--sai-action:var(--admin-action,#4f46e5);--sai-on-action:#fff;--sai-err:#be123c;--sai-ok:#166534;--sai-ok-bg:#dcfce7;--sai-warn:#8a4b00;--sai-warn-bg:#fdf0d9;',
    'container-type:inline-size;box-sizing:border-box;margin:0;padding:1rem;border:1px solid var(--sai-line);border-radius:1rem;background:var(--sai-bg);color:var(--sai-text);font:400 .875rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:start}',
    '@media (max-width:420px){.sai{padding:.625rem}}',
    ':is(html.dark,html[data-theme="dark"]) .sai{color-scheme:dark;--sai-bg:#151b21;--sai-soft:#1a2128;--sai-line:#303942;--sai-edge:#7a8896;--sai-text:#eef2f5;--sai-muted:#a7b3be;--sai-action:#a5b4fc;--sai-on-action:#171a1e;--sai-err:#fda4af;--sai-ok:#86efac;--sai-ok-bg:#14361f;--sai-warn:#fbbf24;--sai-warn-bg:#3a2a0a}',
    '.sai[hidden],.sai [hidden]{display:none!important}',
    '.sai *,.sai *::before,.sai *::after{box-sizing:border-box}',
    '.sai-form{display:grid;gap:1rem;min-width:0;margin:0}',
    '.sai-title{margin:0;font-size:1.5rem;font-weight:700;line-height:1.25;color:var(--sai-text)}',
    '.sai-title:focus,.sai-title:focus-visible{outline:none}',
    '.sai h2{margin:0;font-size:1.0625rem;font-weight:700;color:var(--sai-text)}',
    '.sai p{margin:0}',
    '.sai-lead,.sai-hint{color:var(--sai-muted)}',
    '.sai-card{display:grid;gap:.75rem;min-width:0;padding:.875rem;border:1px solid var(--sai-line);border-radius:.875rem;background:var(--sai-soft)}',
    '.sai-grid{display:grid;gap:.625rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr));align-items:end}',
    '.sai-field{display:grid;gap:.25rem;min-width:0}',
    '.sai-field>.sai-lab{font-size:.8125rem;font-weight:700;color:var(--sai-muted)}',
    '.sai :is(button,input,select,textarea){font:inherit}',
    '.sai :is(select,input[type="text"],input[type="tel"],input[type="email"],input[type="password"],textarea){width:100%;max-width:100%;min-height:2.75rem;padding:.375rem .625rem;border:1px solid var(--sai-edge);border-radius:.75rem;color:var(--sai-text)!important;background-color:var(--sai-bg)!important;box-shadow:none}',
    '.sai textarea{min-height:4.5rem;resize:vertical;line-height:1.5}',
    '.sai input::placeholder,.sai textarea::placeholder{color:var(--sai-muted)!important;opacity:1!important}',
    '.sai .sai-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;min-width:2.75rem;padding:.5rem 1rem;border:1px solid var(--sai-edge);border-radius:.75rem;background:var(--sai-bg);color:var(--sai-text);font-weight:600;text-align:center;cursor:pointer;line-height:1.25}',
    '.sai .sai-btn:hover:not(:disabled){border-color:var(--sai-text)}',
    '.sai .sai-btn--primary{background:var(--sai-action);border-color:transparent;color:var(--sai-on-action);font-weight:700}',
    '.sai .sai-btn:disabled{cursor:not-allowed;background:var(--sai-soft);border-color:var(--sai-line);color:var(--sai-muted)}',
    '.sai :is(button,input,select,textarea):focus-visible{outline:2px solid var(--sai-action);outline-offset:2px}',
    '.sai-check{display:flex;align-items:center;gap:.625rem;min-height:2.75rem;font-weight:600;color:var(--sai-text);cursor:pointer}',
    '.sai-check input{flex:none;width:1.375rem;height:1.375rem;min-height:0;margin:0;accent-color:var(--sai-action)}',
    '.sai-pill{justify-self:start;padding:.25rem .625rem;border-radius:.625rem;background:var(--sai-warn-bg);color:var(--sai-warn);font-weight:600;overflow-wrap:anywhere}',
    '.sai-pill[data-set="1"]{background:var(--sai-ok-bg);color:var(--sai-ok)}',
    '.sai-status{min-height:1.25rem;font-weight:600;color:var(--sai-muted);overflow-wrap:anywhere}',
    '.sai-status[data-bad="1"]{color:var(--sai-err)}',
    '.sai-result{display:grid;gap:.5rem;min-width:0;padding:.75rem;border:1px solid var(--sai-line);border-radius:.75rem;background:var(--sai-bg)}',
    '.sai-verdict{font-weight:700;color:var(--sai-warn)}',
    '.sai-verdict[data-ok="1"]{color:var(--sai-ok)}',
    '.sai-dl{display:grid;gap:.25rem .75rem;margin:0}',
    '@container (min-width:640px){.sai-dl{grid-template-columns:12rem minmax(0,1fr)}}',
    '.sai-dl dt{font-size:.8125rem;font-weight:700;color:var(--sai-muted)}',
    '.sai-dl dd{margin:0;overflow-wrap:anywhere;unicode-bidi:plaintext}',
    '.sai-foot{display:flex;flex-wrap:wrap;align-items:center;gap:.625rem}',
    '.sai-dirty{font-weight:600;color:var(--sai-muted)}',
    'body[' + OPEN + '="open"] main.admin-content>section.admin-page:not([' + PAGE + ']){display:none!important}',
    'body[' + OPEN + '="open"] .admin-sidebar .admin-nav-item[' + CURMARK + ']{background-color:var(--sai-nav-bg,transparent)!important;color:var(--sai-nav-ink,inherit)!important;border:var(--sai-nav-border,0 none)!important;box-shadow:var(--sai-nav-shadow,none)!important}',
    '.m-header__title>strong[' + TITLE + ']{display:none}',
    'body[' + OPEN + '="open"] .m-header__title>strong[' + TITLE + ']{display:block}',
    'body[' + OPEN + '="open"] .m-header__title>strong:not([' + TITLE + ']){display:none}'
  ].join('\n')
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return
    styleEl = document.createElement('style')
    styleEl.setAttribute('data-sporta-ai-style', '')
    styleEl.textContent = CSS
    document.head.appendChild(styleEl)
  }
  function field(label, control) {
    var l = el('label', 'sai-field')
    l.appendChild(el('span', 'sai-lab', label)); l.appendChild(control)
    return l
  }
  function check(name, label) {
    var l = el('label', 'sai-check'), i = el('input')
    i.type = 'checkbox'; i.name = name
    l.appendChild(i); l.appendChild(document.createTextNode(label))
    return { label: l, input: i }
  }
  function input(type, name, max, dir) {
    var i = el('input'); i.type = type; i.name = name; i.maxLength = max; i.autocomplete = 'off'
    if (dir) i.setAttribute('dir', dir)
    return i
  }
  function buildPanel() {
    var root = el('section', 'admin-page sai')
    root.setAttribute(PAGE, ''); root.hidden = true
    root.setAttribute('aria-labelledby', 'sai-title')
    var form = el('form', 'sai-form admin-page-layout')
    form.noValidate = true
    form.setAttribute('autocomplete', 'off')
    form.addEventListener('submit', function (e) { e.preventDefault(); save() })
    // Enter in a one-line field saves (the browser would, but noValidate forms in some admins swallow it)
    form.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); save() } })
    form.addEventListener('input', function () { if (S.note && !S.saving && !S.testing) { S.note = null; drawStatus() } drawFoot() })
    form.addEventListener('change', function () { drawFoot() })
    root.appendChild(form)
    refs = { root: root }

    var head = el('header')
    var h1 = el('h1', 'sai-title', NAME); h1.id = 'sai-title'; h1.tabIndex = -1
    head.appendChild(h1)
    head.appendChild(el('p', 'sai-lead', 'The shop assistant shoppers chat with. Its facts (orders, stock, prices, policies) always come from the shop; AI only rewords greetings, thanks and search results. An empty box uses the server value shown in grey. · مساعد المتجر: المعلومات من المتجر دائمًا، والذكاء الاصطناعي يعيد الصياغة فقط. الخانة الفارغة تعني قيمة الخادم الظاهرة بالرمادي.'))
    form.appendChild(head)
    refs.status = el('p', 'sai-status'); refs.status.setAttribute('role', 'status'); refs.status.setAttribute('aria-live', 'polite')
    form.appendChild(refs.status)

    // 1. on / off
    var c1 = el('div', 'sai-card')
    c1.appendChild(el('h2', '', 'Assistant · المساعد'))
    var en = check('sai_enabled', 'Assistant on · المساعد يعمل')
    refs.enabled = en.input
    c1.appendChild(en.label)
    c1.appendChild(el('p', 'sai-hint', 'Off: every question is answered with one line saying the assistant is off, with the hand-off number and e-mail below. Nothing is searched, sent to AI or passed to staff. · عند الإيقاف: يرد بسطر واحد أن المساعد متوقف مع رقم التواصل.'))
    form.appendChild(c1)

    // 2. welcome
    var c2 = el('div', 'sai-card')
    c2.appendChild(el('h2', '', 'Welcome message · رسالة الترحيب'))
    c2.appendChild(el('p', 'sai-hint', 'What the assistant says to a hello. Plain text, up to 300 characters, no links and no prices. Empty keeps the shop\'s own (shown in grey). · نص عادي حتى 300 حرف، بدون روابط أو أسعار.'))
    var g2 = el('div', 'sai-grid')
    refs.welcomeAr = el('textarea'); refs.welcomeAr.name = 'sai_welcome_ar'; refs.welcomeAr.rows = 3; refs.welcomeAr.maxLength = 300; refs.welcomeAr.setAttribute('dir', 'rtl'); refs.welcomeAr.lang = 'ar'
    g2.appendChild(field('Arabic · بالعربية', refs.welcomeAr))
    refs.welcomeEn = el('textarea'); refs.welcomeEn.name = 'sai_welcome_en'; refs.welcomeEn.rows = 3; refs.welcomeEn.maxLength = 300; refs.welcomeEn.setAttribute('dir', 'ltr'); refs.welcomeEn.lang = 'en'
    g2.appendChild(field('English · بالإنجليزية', refs.welcomeEn))
    c2.appendChild(g2)
    form.appendChild(c2)

    // 3. AI phrasing
    var c3 = el('div', 'sai-card')
    c3.appendChild(el('h2', '', 'AI phrasing · الصياغة بالذكاء الاصطناعي'))
    var ai = check('sai_ai_enabled', 'Use AI to reword answers · استخدم الذكاء الاصطناعي لإعادة الصياغة')
    refs.aiEnabled = ai.input
    c3.appendChild(ai.label)
    refs.active = el('p', 'sai-hint')
    c3.appendChild(refs.active)
    var g3 = el('div', 'sai-grid')
    refs.model = input('text', 'sai_ai_model', 64, 'ltr'); refs.model.spellcheck = false
    g3.appendChild(field('Model · النموذج', refs.model))
    refs.key = input('password', 'sai_ai_key', 256, 'ltr'); refs.key.autocomplete = 'new-password'; refs.key.spellcheck = false
    refs.key.placeholder = 'Type a new key to replace · اكتب مفتاحًا جديدًا'
    g3.appendChild(field('API key (never shown) · مفتاح الخدمة (لا يُعرض)', refs.key))
    c3.appendChild(g3)
    refs.keyState = el('p', 'sai-pill'); refs.keyState.setAttribute('aria-live', 'polite')
    c3.appendChild(refs.keyState)
    var ck = check('sai_ai_key_clear', 'Remove the saved key (the server\'s key, if any, is used again) · احذف المفتاح المحفوظ')
    refs.clearKey = ck.input; refs.clearRow = ck.label
    c3.appendChild(ck.label)
    form.appendChild(c3)

    // 4. late orders + hand-off
    var c4 = el('div', 'sai-card')
    c4.appendChild(el('h2', '', 'Orders and hand-off · الطلبات والتحويل لموظف'))
    c4.appendChild(el('p', 'sai-hint', 'An order still not delivered after this many hours is called late: the assistant stops promising times and passes it to staff. The number (WhatsApp and calls) and e-mail are what the assistant gives when a person is needed. · بعد هذا العدد من الساعات يُعتبر الطلب متأخرًا. الرقم والبريد هما ما يعطيه المساعد للتواصل مع موظف.'))
    var g4 = el('div', 'sai-grid')
    refs.hours = input('text', 'sai_late_hours', 3, 'ltr'); refs.hours.setAttribute('inputmode', 'numeric')
    g4.appendChild(field('Late after (hours, 1 to 720) · متأخر بعد (ساعات)', refs.hours))
    refs.phone = input('tel', 'sai_handoff_phone', 32, 'ltr'); refs.phone.setAttribute('inputmode', 'tel')
    g4.appendChild(field('WhatsApp / phone number · رقم واتساب / الهاتف', refs.phone))
    refs.email = input('email', 'sai_handoff_email', 120, 'ltr')
    g4.appendChild(field('E-mail · البريد الإلكتروني', refs.email))
    c4.appendChild(g4)
    form.appendChild(c4)

    // 5. test
    var c5 = el('div', 'sai-card')
    c5.appendChild(el('h2', '', 'Test · اختبار'))
    c5.appendChild(el('p', 'sai-hint', 'Asks the assistant "hello" with the SAVED settings and shows whether the AI answered. Nothing is sent to staff. · يسأل المساعد «مرحبا» بالإعدادات المحفوظة ويعرض النتيجة.'))
    var g5 = el('div', 'sai-grid')
    refs.testLang = el('select'); refs.testLang.name = 'sai_test_lang'
    ;[['ar', 'Arabic · العربية'], ['en', 'English · الإنجليزية']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; refs.testLang.appendChild(op) })
    g5.appendChild(field('Language · اللغة', refs.testLang))
    refs.test = el('button', 'sai-btn', 'Test the assistant · اختبر المساعد'); refs.test.type = 'button'
    refs.test.addEventListener('click', runTest)
    g5.appendChild(refs.test)
    c5.appendChild(g5)
    refs.result = el('div', 'sai-result'); refs.result.hidden = true; refs.result.setAttribute('aria-live', 'polite')
    c5.appendChild(refs.result)
    form.appendChild(c5)

    var foot = el('div', 'sai-foot')
    refs.save = el('button', 'sai-btn sai-btn--primary', 'Save Sporta AI · حفظ إعدادات المساعد'); refs.save.type = 'submit'
    foot.appendChild(refs.save)
    refs.reload = el('button', 'sai-btn', 'Reload from server · إعادة التحميل'); refs.reload.type = 'button'
    refs.reload.addEventListener('click', function () {
      if (dirty() && !window.confirm('Discard the changes that are not saved? · تجاهل التغييرات غير المحفوظة؟')) return
      load()
    })
    foot.appendChild(refs.reload)
    refs.dirty = el('span', 'sai-dirty')
    foot.appendChild(refs.dirty)
    form.appendChild(foot)
    return root
  }

  // -------------------------------------------------- the entry in the shell
  function reactNavButtons() {
    return document.querySelectorAll('.admin-sidebar .admin-nav-item, .m-tabbar__item, .m-menu-item')
  }
  function mine(b) { return b.hasAttribute(NAVMARK) }
  function addon(b) { return mine(b) || isOther(b) }
  function setNavLook(b, active) {
    var on = ['bg-indigo-50', 'text-indigo-600'], off = ['text-slate-600', 'hover:bg-slate-50']
    ;(active ? off : on).forEach(function (c) { b.classList.remove(c) })
    ;(active ? on : off).forEach(function (c) { b.classList.add(c) })
  }
  /** Take React's current-tab mark off (and write it down) while ours is open; idempotent. */
  function neutralise() {
    var list = reactNavButtons(), i
    for (i = 0; i < list.length; i++) {
      var b = list[i]
      if (addon(b)) continue
      if (b.getAttribute('aria-current')) { b.removeAttribute('aria-current'); b.setAttribute(CURMARK, '1') }
    }
    var nots = ':not([' + CURMARK + ']):not([' + NAVMARK + '])' + OTHER_NAVS.map(function (a) { return ':not([' + a + '])' }).join('')
    var inactive = document.querySelector('.admin-sidebar .admin-nav-item' + nots)
    if (inactive) {
      try {
        var c = getComputedStyle(inactive), st = document.body.style
        st.setProperty('--sai-nav-ink', c.color); st.setProperty('--sai-nav-bg', c.backgroundColor)
        st.setProperty('--sai-nav-border', c.borderTopWidth + ' ' + c.borderTopStyle + ' ' + c.borderTopColor); st.setProperty('--sai-nav-shadow', c.boxShadow)
      } catch (e) { /* the fallbacks in the rule */ }
    }
    var ours = document.querySelectorAll('[' + NAVMARK + ']')
    for (i = 0; i < ours.length; i++) {
      ours[i].setAttribute('aria-current', 'page')
      if (ours[i].classList.contains('admin-nav-item')) setNavLook(ours[i], true)
    }
  }
  function restore() {
    var list = document.querySelectorAll('[' + CURMARK + ']'), i
    for (i = 0; i < list.length; i++) {
      var b = list[i], box = b.parentNode
      b.removeAttribute(CURMARK)
      // only if React has not already moved the mark to another button of the same group
      var moved = false, sib = box ? box.children : []
      for (var k = 0; k < sib.length; k++) if (sib[k] !== b && !addon(sib[k]) && sib[k].getAttribute('aria-current')) moved = true
      if (!moved && !b.getAttribute('aria-current')) b.setAttribute('aria-current', 'page')
    }
    var ours = document.querySelectorAll('[' + NAVMARK + ']')
    for (i = 0; i < ours.length; i++) {
      ours[i].removeAttribute('aria-current')
      if (ours[i].classList.contains('admin-nav-item')) setNavLook(ours[i], false)
    }
    try { ;['--sai-nav-ink', '--sai-nav-bg', '--sai-nav-border', '--sai-nav-shadow'].forEach(function (k) { document.body.style.removeProperty(k) }) } catch (e) { /* none set */ }
  }
  function ensureNavButton(nav) {
    if (nav.querySelector('[' + NAVMARK + ']')) return
    var b = el('button', 'admin-nav-item rounded-lg px-3 py-2 text-start text-sm font-semibold text-slate-600 hover:bg-slate-50')
    b.type = 'button'
    b.setAttribute(NAVMARK, '1')
    var span = el('span', 'flex items-center gap-2.5')
    span.appendChild(svgIcon(17)); span.appendChild(document.createTextNode(NAME))
    b.appendChild(span)
    b.addEventListener('click', function () { openPanel(false) })
    nav.appendChild(b)
    if (S.open) neutralise()
  }
  function ensureMenuTile() {
    var grid = document.querySelector('.m-menu-grid')
    if (!grid || grid.querySelector('[' + NAVMARK + ']')) return
    var b = el('button', 'm-menu-item')
    b.type = 'button'; b.setAttribute(NAVMARK, '1')
    var ic = el('span', 'm-menu-item__icon'); ic.appendChild(svgIcon(20))
    b.appendChild(ic); b.appendChild(el('span', '', 'Sporta AI'))
    b.addEventListener('click', function () {
      var close = document.querySelector('.m-menu-close')
      if (close) close.click()
      openPanel(false)
    })
    grid.appendChild(b)
    if (S.open) neutralise()
  }
  function ensureHeaderTitle() {
    var t = document.querySelector('.m-header__title')
    if (!t || t.querySelector('[' + TITLE + ']')) return
    var s = el('strong', '', 'Sporta AI')
    s.setAttribute(TITLE, '')
    t.insertBefore(s, t.firstChild)
  }
  function ensurePanel(main) {
    if (!panel) {
      panel = buildPanel()
      if (S.loaded && S.doc) fill()
      drawStatus(); drawTest(); drawFoot()
    }
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
    if (!panel || !onAdmin() || S.open) return
    if (!fromHistory) {
      prevUrl = OTHER_TABS.indexOf(tabParam()) >= 0 ? '' : location.href
      try { history.pushState({ sportaTab: TAB }, '', urlWithTab(TAB)) } catch (e) { /* the panel still opens */ }
    }
    S.open = true
    document.body.setAttribute(OPEN, 'open')
    panel.hidden = false
    neutralise()
    try { window.scrollTo(0, 0) } catch (e) { /* no scrolling */ }
    var h = document.getElementById('sai-title')
    if (h) { try { h.focus({ preventScroll: true }) } catch (e) { /* no focus */ } }
    if (!S.loaded) load(); else drawFoot()
  }
  function closePanel(why) {
    if (!S.open) return
    S.open = false
    document.body.removeAttribute(OPEN)
    if (panel) panel.hidden = true
    restore()
    if (why === 'nav') {
      // React ignores a click on the tab it already shows, so the address would keep saying ?tab=assistant
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
    if (!t || mine(t)) return
    if (t.classList.contains('m-tabbar__item') && t.hasAttribute('aria-haspopup')) return   // "More" opens the menu, it is not a tab
    closePanel('nav')
  }, true)
  window.addEventListener('popstate', function () {
    if (probeState === 'absent') return
    var want = tabParam() === TAB
    if (want && !S.open) { if (panel) openPanel(true); else { wantOpen = true; autoOpened = false } }
    else if (!want && S.open) closePanel('history')
  })
  // a tab closed with unsaved changes asks first (the browser's own question; nothing is stored here)
  window.addEventListener('beforeunload', function (e) {
    if (dirty()) { e.preventDefault(); e.returnValue = '' }
  })

  // -------------------------------------------------------------- finding the shell
  function scan() {
    if (!onAdmin()) return
    var nav = document.querySelector('nav.admin-sidebar__nav')
    var main = document.querySelector('main.admin-content')
    if (!nav || !main) {
      // sign-in screen, or signed out: nothing of ours stays open, nothing typed is kept (a key least of all)
      if (S.open) closePanel('gone')
      if (panel) wipe()
      return
    }
    if (probeState === 'unknown') { probe(); return }
    if (probeState === 'absent') return
    if (firstDoc && !S.loaded) { adopt(firstDoc); firstDoc = null }
    ensureStyle()
    ensurePanel(main)
    ensureNavButton(nav)
    ensureMenuTile()
    ensureHeaderTitle()
    if (wantOpen && !autoOpened) { autoOpened = true; openPanel(true) }
    if (S.open) neutralise()
  }
  function wipe() {
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel)
    panel = null; refs = null
    S.loaded = false; S.loading = false; S.saving = false; S.testing = false; S.doc = null; S.saved = ''; S.note = null; S.test = null
    probeState = 'unknown'; firstDoc = null
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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN SPORTA AI - end ============================================== */
/* ===== ADMIN SOCIAL CENTER - begin ========================================
 * 12. Social center (owner request 2026-11-11: "add social media center backends").
 *
 * ONE button, "Social center", in the header of the Settings screen (and of the Site content
 * panel, where the handles are kept today). It opens a panel (a section in <main>; the screen
 * behind it is hidden by CSS while it is open, "Back" or any click on the menu closes it) with
 * six tabs:
 *
 *   1. ACCOUNTS  Instagram, TikTok, Snapchat, X and the WhatsApp number: edited here, checked with
 *      THE SAME RULES as the server (store_content_social / store_content_contact in
 *      dropin/php-store/store.php: a bare handle or an https address on the network's own host,
 *      rebuilt from the handle), shown as the storefront footer will show them, with "Open" test
 *      links, a set / missing / changed status per platform, and a warning when the storefront
 *      does not apply them. Phone and e-mail are shown read-only. Saved through the ONE existing
 *      route, POST content_save, with the document as it was read: the text rules (overrides),
 *      the version v, and every contact key EXACTLY as the server returned it, except the five
 *      keys the owner changed here. Nothing else is ever sent. A stale version (409) reloads
 *      the document and keeps what was typed.
 *   2. POST STUDIO  pick a product, get a deterministic caption in Arabic and in English (fixed
 *      templates: no AI, no network): hook, key facts (delivery within 24 hours, the return
 *      window the shop's own returns settings say, cash on delivery), call to action, hashtags;
 *      editable; the product link carries utm_source / utm_medium / utm_campaign on the
 *      canonical host (Arabic: the bare path, English: ?lang=en); one variant per platform with
 *      its caption limit counted (Instagram 2200, TikTok 2200, X 280 with a link counted as 23,
 *      Snapchat 80), a WhatsApp share link, copy buttons. A price is NEVER written unless
 *      "Include the price" is ticked; then it is the product row's price with exactly three
 *      decimals, display only.
 *   3. SHARE IMAGE  a 1080x1080 post or a 1080x1920 story drawn in the browser on a canvas from
 *      the product photo, the Sporta logo, the name, an optional price, in the brand colours;
 *      preview and PNG download. Same-origin pictures only; nothing is uploaded anywhere.
 *   4. LINK BUILDER  UTM links for any storefront path, Arabic and English.
 *   5. CHECKS  read-only same-origin GETs: the home page and a product page carry og:title,
 *      og:description, og:image and twitter:card; the share picture answers and is on this
 *      site; robots.txt lets the social crawlers in; the footer links match the settings; the
 *      storefront script that applies them is there and the public answer carries them.
 *   6. NOT BUILT YET  what needs a shop-server release, with the smallest additive design
 *      (Facebook, YouTube, Telegram, Threads; a content calendar), written down, not faked.
 *
 * Reads: GET content, GET products_all, GET brands (optional); public GETs of this site: /,
 * /?lang=en, one /product/<slug>, /robots.txt, /sporta-features.js, /api/api.php?r=content, the
 * share picture, product photos, /logo.png, /logo-white.png. Writes: POST content_save ONLY.
 * Every admin request carries the session cookie and X-Sporta-Admin, like the admin's own.
 * Built with createElement + textContent, never as markup. No secret, no token, no storage,
 * no third-party script, no request to another host. Platform brand colours are not painted:
 * a platform is a neutral two-letter mark and its name.
 *
 * The entry is added by a half-second check and removed when the screen goes (React's nodes
 * are never removed, moved or retexted). Starts on /backends only; idempotent; every handler
 * is wrapped so an error here cannot stop the admin.
 */
;(function () {   // leading ; - the block above ends in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaSocial) return

  var API = '/api/admin.php'
  var ORIGIN = 'https://www.sporta.com.kw'
  var PAGE = 'data-sporta-social'            // the section
  var BTN = 'data-sporta-social-btn'         // the entry button
  var OPEN = 'data-sporta-social-state'      // on <body>: "open"
  var NAV = '.admin-sidebar .admin-nav-item, .m-tabbar__item, .m-menu-item, .m-header__menu'
  var SOCIAL_KEYS = ['instagram', 'tiktok', 'snapchat', 'x', 'whatsapp']
  var COLORS = { orange: '#E0561C', bright: '#FF7B17', ink: '#171A1E', beige: '#E2DBCE' }

  // The server's rules (store_content_social), one row per network.
  var NETS = [
    { key: 'instagram', label: 'Instagram', mono: 'IG', hosts: ['instagram.com', 'www.instagram.com'], path: /^\/@?([A-Za-z0-9._]{1,30})\/?$/, handle: /^@?([A-Za-z0-9._]{1,30})$/, fmt: 'https://www.instagram.com/', shown: function (h) { return '@' + h }, hint: 'Username, for example sporta.kw, or the https://www.instagram.com/… address.' },
    { key: 'tiktok', label: 'TikTok', mono: 'TT', hosts: ['tiktok.com', 'www.tiktok.com'], path: /^\/@([A-Za-z0-9._]{2,24})\/?$/, handle: /^@?([A-Za-z0-9._]{2,24})$/, fmt: 'https://www.tiktok.com/@', shown: function (h) { return '@' + h }, hint: 'Username (2 to 24 letters, digits, dot, underscore), or the https://www.tiktok.com/@… address.' },
    { key: 'snapchat', label: 'Snapchat', mono: 'SC', hosts: ['snapchat.com', 'www.snapchat.com'], path: /^\/add\/([A-Za-z0-9._\-]{3,15})\/?$/, handle: /^@?([A-Za-z0-9._\-]{3,15})$/, fmt: 'https://www.snapchat.com/add/', shown: function (h) { return h }, hint: 'Username (3 to 15 characters), or the https://www.snapchat.com/add/… address.' },
    { key: 'x', label: 'X (Twitter)', mono: 'X', hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'], path: /^\/@?([A-Za-z0-9_]{1,15})\/?$/, handle: /^@?([A-Za-z0-9_]{1,15})$/, fmt: 'https://x.com/', shown: function (h) { return '@' + h }, hint: 'Username (up to 15 letters, digits, underscore), or the https://x.com/… address.' }
  ]
  var MSG = {
    not_signed_in: 'Your sign-in has ended. Sign in again, then reopen this screen.',
    bad_request: 'The save was refused. Reload the page and try again.',
    request_too_large: 'Too much text in one save.',
    content_too_large: 'The site content is too large to store (about 60,000 bytes). Shorten some texts in Site content.',
    content_changed: 'The site content was changed in another window. It has been reloaded; what you typed here is kept. Press Save again.',
    invalid_contact_instagram: 'Instagram: type the username, or the https://www.instagram.com/… address.',
    invalid_contact_tiktok: 'TikTok: type the username, or the https://www.tiktok.com/@… address.',
    invalid_contact_snapchat: 'Snapchat: type the username, or the https://www.snapchat.com/add/… address.',
    invalid_contact_x: 'X: type the username, or the https://x.com/… address.',
    invalid_contact_whatsapp: 'The WhatsApp number must be the full number with the country code, digits only (96522091914).',
    invalid_contact_phone: 'The stored phone number is not valid. Fix it in Site content.',
    invalid_contact_email: 'The stored e-mail address is not valid. Fix it in Site content.'
  }
  var NOT_YET = 'Site content is not available until the next update of the shop server. Nothing is wrong with your account.'

  // ----------------------------------------------------------------- helpers
  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    if (tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'li' || cls === 'ssoc-flab' || cls === 'ssoc-acc-name') n.setAttribute('dir', 'auto')   // this panel's words are English: each line takes its own direction, so a full stop stays at its end in an Arabic (RTL) admin
    return n
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent }
  function clean(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim() }
  function len(s) { s = String(s == null ? '' : s); try { return Array.from(s).length } catch (e) { return s.length } }
  function cutTo(s, max) { try { return Array.from(String(s)).slice(0, max).join('') } catch (e) { return String(s).slice(0, max) } }
  function wordCut(s, max) {                 // at a word boundary with an ellipsis; never mid-word
    s = String(s)
    if (len(s) <= max) return s
    var c = cutTo(s, max - 1), i = c.lastIndexOf(' ')
    if (i > max * 0.5) c = c.slice(0, i)
    return c.replace(/[\s,.;:\-—|]+$/, '') + '…'
  }
  function truthy(v) { return v === true || v === 1 || v === '1' || v === 'true' }
  function shown(e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  function guard(fn) { return function () { try { return fn.apply(this, arguments) } catch (e) { try { setNote('Something went wrong in the Social center: ' + String(e && e.message || e).slice(0, 120), true) } catch (x) { /* the admin keeps working */ } } } }
  function token(b) { var e = b && b.error; return typeof e === 'string' && /^[a-z_]{1,60}$/.test(e) ? e : '' }
  function sameOriginPath(p) {               // a picture or page address this block may fetch: the site's own path, nothing else
    p = String(p == null ? '' : p).trim()
    return p.length > 0 && p.length <= 500 && /^\/(?!\/)[A-Za-z0-9_.\/%~\-]*(\?[A-Za-z0-9_.%~=&\-]*)?$/.test(p) && p.indexOf('..') < 0
  }
  function hash(s) { var h = 2166136261, i; s = String(s); for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 } return h }       // FNV-1a: its multiplier is not a multiple of 3, so `% 3` depends on every character
  function arDigits(n) { return String(n).replace(/[0-9]/g, function (d) { return String.fromCharCode(0x660 + Number(d)) }) }

  // ------------------------------------------------- validation: the server's
  /** What the server would store for a social value: { ok, value, handle } or { ok:false, error }. */
  function normSocial(netKey, raw) {
    var net = null, i, m
    for (i = 0; i < NETS.length; i++) if (NETS[i].key === netKey) net = NETS[i]
    if (!net) return { ok: false, error: 'invalid_contact_' + netKey }
    var v = String(raw == null ? '' : raw).replace(/^[\s\u0000\u000B]+|[\s\u0000\u000B]+$/g, '')
    var bad = { ok: false, error: 'invalid_contact_' + netKey }
    if (v === '') return { ok: true, value: '', handle: '' }
    if (v.length > 300) return bad
    if ((m = net.handle.exec(v))) return { ok: true, value: net.fmt + m[1], handle: m[1] }
    // not a handle: the whole address and nothing but (the server's parse_url checks)
    if (!/^https:\/\/[^\s\u0000-\u001F\u007F\\]+$/.test(v)) return bad
    var u = /^https:\/\/([^\/?#]*)([^?#]*)(.*)$/.exec(v)
    if (!u) return bad
    if (u[3] !== '' || u[1].indexOf('@') >= 0 || u[1].indexOf(':') >= 0) return bad       // query, fragment, credentials, port
    if (net.hosts.indexOf(u[1].toLowerCase()) < 0) return bad
    if (!(m = net.path.exec(u[2]))) return bad
    return { ok: true, value: net.fmt + m[1], handle: m[1] }
  }
  /** WhatsApp: the full international number, digits (Arabic-Indic accepted), no plus kept. */
  function normWhatsapp(raw) {
    var v = String(raw == null ? '' : raw)
    if (v.length > 64) return { ok: false, error: 'invalid_contact_whatsapp' }
    v = v.replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x660) }).replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 0x6F0) })
    v = v.replace(/[\s\-().]/g, '')
    if (v !== '' && !/^\+?[0-9]{8,15}$/.test(v)) return { ok: false, error: 'invalid_contact_whatsapp' }
    return { ok: true, value: v.replace(/^\++/, ''), handle: v.replace(/^\++/, '') }
  }
  function normKey(key, raw) { return key === 'whatsapp' ? normWhatsapp(raw) : normSocial(key, raw) }
  function netOf(key) { for (var i = 0; i < NETS.length; i++) if (NETS[i].key === key) return NETS[i]; return null }
  /** What the storefront footer will show for a stored value: { text, href } or null. */
  function footerShow(key, stored) {
    if (!stored) return null
    if (key === 'whatsapp') { var d = String(stored).replace(/[^0-9]/g, ''); return d ? { text: '+' + d.replace(/^(965)(\d{4})(\d{4})$/, '$1 $2 $3'), href: 'https://wa.me/' + d } : null }
    var n = normSocial(key, stored)
    return n.ok && n.value ? { text: netOf(key).shown(n.handle), href: n.value } : null
  }

  // --------------------------------------------------------------- UTM links
  var UTM = {
    source: ['instagram', 'tiktok', 'snapchat', 'x', 'whatsapp', 'facebook', 'youtube', 'telegram', 'email', 'sms', 'qr', 'influencer'],
    medium: ['social', 'bio', 'story', 'video', 'message', 'email', 'qr', 'influencer', 'paid_social'],
    campaign: ['new_arrivals', 'sale', 'ramadan', 'eid', 'summer', 'back_to_gym', 'white_friday', 'restock', 'product_spotlight', 'brand_vanquish', 'brand_gymshark', 'brand_nba']
  }
  function utmValue(s) {                      // lower case, spaces to underscores, [a-z0-9_-], 1-40 characters; '' when nothing is left
    s = String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\-]/g, '').replace(/_{2,}/g, '_').replace(/^[_\-]+/, '')
    return s.slice(0, 40).replace(/[_\-]+$/, '')
  }
  /** A path of the storefront ("/product/x", "/shop?sale=1", or a pasted canonical address) -> a clean path, or '' when it is not one. */
  function cleanPath(p) {
    p = String(p == null ? '' : p).trim()
    if (p.indexOf(ORIGIN) === 0) p = p.slice(ORIGIN.length) || '/'
    if (p === '') return '/'
    if (p.charAt(0) !== '/') return ''
    if (p.indexOf('#') >= 0 || /[\s\u0000-\u001F\u007F\\<>"']/.test(p) || p.indexOf('//') === 0 || p.indexOf('..') >= 0) return ''
    if (!/^\/[A-Za-z0-9_.\/%~\-]*(\?[A-Za-z0-9_.%~=&\-]*)?$/.test(p) || p.length > 300) return ''
    return p
  }
  /** The canonical address of `path` in `lang` (Arabic: the bare path, English: ?lang=en) with the utm parameters that are set. '' when the path is not valid. */
  function buildLink(path, lang, u) {
    var p = cleanPath(path)
    if (!p) return ''
    var q = p.indexOf('?'), base = q < 0 ? p : p.slice(0, q), keep = []
    if (q >= 0) p.slice(q + 1).split('&').forEach(function (kv) {
      var k = kv.split('=')[0]
      if (kv !== '' && k !== 'lang' && !/^utm_/.test(k)) keep.push(kv)
    })
    if (lang === 'en') keep.push('lang=en')
    u = u || {}
    ;['source', 'medium', 'campaign', 'content'].forEach(function (k) { var v = utmValue(u[k]); if (v) keep.push('utm_' + k + '=' + v) })
    return ORIGIN + base + (keep.length ? '?' + keep.join('&') : '')
  }

  // ------------------------------------------------------- products + captions
  var CATS = {       // category slug -> hashtag words [English, Arabic]
    men: [['MensWear', 'MensActivewear'], ['ملابس_رجالية']], women: [['WomensWear', 'WomensActivewear'], ['ملابس_نسائية']],
    outerwear: [['Outerwear'], ['جاكيتات']], accessories: [['SportsAccessories'], ['إكسسوارات_رياضية']]
  }
  var BRAND_FALLBACK = { vanquish: ['Vanquish', 'فانكويش'], gymshark: ['Gymshark', 'جيمشارك'], nba: ['NBA', 'إن بي إيه'] }
  var STYLES = [['Auto (by product)', -1], ['New in', 0], ['Training', 1], ['Gym ready', 2]]
  var PLATFORMS = [
    { key: 'instagram', label: 'Instagram', mono: 'IG', limit: 2200, note: 'Links in a caption are not clickable: the variant says "link in bio"; put the bio link below in your profile.' },
    { key: 'tiktok', label: 'TikTok', mono: 'TT', limit: 2200, note: 'Put the link in your bio; the caption says so.' },
    { key: 'snapchat', label: 'Snapchat', mono: 'SC', limit: 80, note: 'A Snap caption is short: only the hook is kept. Attach the link below with a link sticker.' },
    { key: 'x', label: 'X (Twitter)', mono: 'X', limit: 280, note: 'A link counts as 23 characters; the post is trimmed to fit.' }
  ]
  function priceOf(p) {            // the price the shop charges now, as the product row says it; { text, n } or null
    if (!p) return null
    var base = Number(p.price), sale = p.sale_price == null || p.sale_price === '' ? NaN : Number(p.sale_price), now = Date.now()
    function ts(x) { if (!x) return null; var t = Date.parse(String(x).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(x)) ? '' : 'Z')); return isNaN(t) ? null : t }
    var a = ts(p.sale_starts_at), b = ts(p.sale_ends_at)
    var onSale = isFinite(sale) && sale > 0 && isFinite(base) && sale < base && (a == null || a <= now) && (b == null || b >= now)
    var n = onSale ? sale : base
    if (!isFinite(n) || n <= 0) return null
    return { n: n, text: n.toFixed(3), onSale: onSale }
  }
  function photosOf(p) {           // same-origin photo paths, main first
    var out = [], seen = {}
    ;[p && p.image].concat(String(p && p.images == null ? '' : p.images).split(',')).forEach(function (x) {
      x = clean(x)
      if (x && sameOriginPath(x) && !seen[x]) { seen[x] = 1; out.push(x) }
    })
    return out
  }
  function brandOf(p, brands) {    // [English, Arabic] names of the product's brand, or ['', '']
    var s = String(p && p.brand_slug || '').toLowerCase()
    if (!s) return ['', '']
    var b = brands && brands[s]
    if (b && (b[0] || b[1])) return [b[0] || '', b[1] || '']
    return BRAND_FALLBACK[s] || [s.replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, function (c) { return c.toUpperCase() }), '']
  }
  function daysAr(n) { return n === 1 ? 'يوم واحد' : n === 2 ? 'يومين' : (n >= 3 && n <= 10) ? arDigits(n) + ' أيام' : arDigits(n) + ' يومًا' }
  function hashtags(p, brand, lang) {
    var tags = [], cat = CATS[String(p.category || '').toLowerCase()]
    function put(t) { t = String(t).replace(/[^A-Za-z0-9_؀-ۿ]/g, ''); if (t && tags.indexOf('#' + t) < 0) tags.push('#' + t) }
    var bEn = brand[0].replace(/[^A-Za-z0-9]/g, ''), bAr = brand[1].replace(/\s+/g, '_')
    if (lang === 'ar') {
      if (bAr) put(bAr); if (bEn) put(bEn)
      if (cat) cat[1].forEach(put)
      ;['الكويت', 'سبورتا', 'ملابس_رياضية', 'Kuwait'].forEach(put)
    } else {
      if (bEn) put(bEn)
      if (cat) cat[0].forEach(put)
      else if (p.category) put(String(p.category).replace(/[^A-Za-z0-9]+/g, ' ').replace(/\b[a-z]/g, function (c) { return c.toUpperCase() }).replace(/ /g, ''))
      ;['Kuwait', 'Sporta', 'Sportswear', 'الكويت', 'سبورتا'].forEach(put)
    }
    return tags
  }
  /** The master caption for a product in one language. o: { price, facts:{delivery,returns,cod}, style (-1 auto), returnDays, allowReturn, link } */
  function caption(p, brands, lang, o) {
    o = o || {}
    var ar = lang === 'ar', brand = brandOf(p, brands)
    var nameEn = clean(p.name_en), nameAr = clean(p.name_ar)
    var name = ar ? (nameAr || nameEn) : (nameEn || nameAr)
    var bn = ar ? (brand[1] || brand[0]) : (brand[0] || brand[1])
    var has = bn && name.toLowerCase().indexOf(bn.toLowerCase()) >= 0
    var by = bn && !has ? (ar ? ' من ' : ' by ') + bn : ''
    var style = typeof o.style === 'number' && o.style >= 0 ? o.style : hash(String(p.slug || p.id) + lang) % 3
    var hooks = ar ? ['جديد في سبورتا: ' + name + by, name + by + ' — لتمرينك القادم', 'تمرّن بأناقة مع ' + name + by]
      : ['New in at Sporta: ' + name + by, name + by + ' — built for your next session', 'Train in ' + name + by]
    var lines = [hooks[style % 3]]
    var pr = priceOf(p)
    if (o.price && pr) lines.push(ar ? 'السعر: ' + pr.text + ' د.ك' : 'Price: KWD ' + pr.text)
    var f = o.facts || { delivery: true, returns: true, cod: true }, facts = []
    if (f.delivery) facts.push(ar ? '• توصيل خلال ٢٤ ساعة' : '• Delivery within 24 hours')
    var days = typeof o.returnDays === 'number' && o.returnDays >= 1 ? o.returnDays : 14
    if (f.returns && o.allowReturn !== false) facts.push(ar ? '• إرجاع خلال ' + daysAr(days) : '• ' + days + '-day returns')
    if (f.cod) facts.push(ar ? '• الدفع عند الاستلام' : '• Cash on delivery')
    var out = lines.join('\n')
    if (facts.length) out += '\n\n' + facts.join('\n')
    out += '\n\n' + (ar ? 'اطلب الآن: ' : 'Shop now: ') + (o.link || '')
    var tags = hashtags(p, brand, lang)
    if (tags.length) out += '\n\n' + tags.join(' ')
    return out
  }
  var URL_RE = /https?:\/\/[^\s]+/
  function weighted(text, platform) {
    if (platform !== 'x') return len(text)
    return len(String(text).replace(/https?:\/\/[^\s]+/g, 'x'.repeat(23)))
  }
  function isTagLine(l) { return /^(?:#[^\s#]+\s*)+$/.test(l.trim()) }
  /** A platform's version of the master caption. `link` is that platform's own utm link (used where a link is clickable). */
  function variant(platform, master, lang, link) {
    var ar = lang === 'ar', lines = String(master).split('\n'), i
    var hookIdx = -1, urlIdx = -1, tagIdx = -1
    for (i = 0; i < lines.length; i++) {
      if (hookIdx < 0 && lines[i].trim() !== '') hookIdx = i
      if (urlIdx < 0 && URL_RE.test(lines[i])) urlIdx = i
      if (isTagLine(lines[i])) tagIdx = i
    }
    var hook = hookIdx < 0 ? '' : lines[hookIdx].replace(URL_RE, '').replace(/\s+/g, ' ').trim()
    if (platform === 'instagram' || platform === 'tiktok') {
      if (urlIdx < 0) return master
      var o = lines.slice(); o[urlIdx] = lines[urlIdx].replace(URL_RE, ar ? 'الرابط في البايو' : 'link in bio')
      return o.join('\n')
    }
    if (platform === 'snapchat') return wordCut(hook, 80)
    // X: priority hook, link line, price, one condensed facts line, up to three tags; shown in reading order
    var X = 280, parts = {}
    parts.hook = hook
    parts.cta = ''
    if (urlIdx >= 0) {
      var withLink = lines[urlIdx].replace(URL_RE, link || '$&').trim()
      parts.cta = urlIdx === hookIdx || weighted(withLink, 'x') > 100 ? (link || (URL_RE.exec(lines[urlIdx]) || [''])[0]) : withLink
    }
    parts.price = ''
    for (i = 0; i < lines.length; i++) if (/^(?:Price: KWD|السعر:)/.test(lines[i].trim())) parts.price = lines[i].trim()
    var facts = lines.filter(function (l) { return /^•/.test(l.trim()) }).map(function (l) { return l.replace(/^•\s*/, '').trim() })
    parts.facts = facts.slice(0, 3).join(ar ? '، ' : ' · ')
    parts.tags = tagIdx >= 0 ? lines[tagIdx].trim().split(/\s+/).slice(0, 3).join(' ') : ''
    var use = { hook: true, cta: !!parts.cta, price: false, facts: false, tags: false }
    function assemble() {
      var blocks = []
      if (use.hook && parts.hook) blocks.push(parts.hook)
      if (use.price && parts.price) blocks.push(parts.price)
      if (use.facts && parts.facts) blocks.push(parts.facts)
      if (use.cta && parts.cta) blocks.push(parts.cta)
      if (use.tags && parts.tags) blocks.push(parts.tags)
      return blocks.join('\n\n')
    }
    if (weighted(assemble(), 'x') > X) { var room = X - weighted('\n\n' + parts.cta, 'x'); parts.hook = wordCut(parts.hook, Math.max(10, room)) }
    ;['price', 'facts', 'tags'].forEach(function (k) {
      if (!parts[k]) return
      use[k] = true
      if (weighted(assemble(), 'x') > X) use[k] = false
    })
    return assemble()
  }

  // ------------------------------------------------------------------ robots.txt
  /** Whether `agent` may fetch `path` under robots.txt `text` (longest match wins, Allow wins a tie). { allowed, group } */
  function robotsAllows(text, agent, path) {
    var groups = [], cur = null, lastWasUa = false
    String(text).split(/\r?\n/).forEach(function (raw) {
      var l = raw.replace(/#.*$/, '').trim(), m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(l)
      if (!m) return
      var k = m[1].toLowerCase(), v = m[2].trim()
      if (k === 'user-agent') {
        if (!lastWasUa || !cur) { cur = { agents: [], rules: [] }; groups.push(cur) }
        cur.agents.push(v.toLowerCase()); lastWasUa = true
      } else {
        lastWasUa = false
        if (cur && (k === 'allow' || k === 'disallow')) cur.rules.push({ allow: k === 'allow', pat: v })
      }
    })
    var a = String(agent).toLowerCase(), best = null, bestLen = -1, star = null
    groups.forEach(function (g) {
      g.agents.forEach(function (t) {
        if (t === '*') { if (!star) star = g }
        else if (t && a.indexOf(t) >= 0 && t.length > bestLen) { best = g; bestLen = t.length }
      })
    })
    var g = best || star
    if (!g) return { allowed: true, group: '(none)' }
    var hit = null, hitLen = -1
    g.rules.forEach(function (r) {
      if (r.pat === '') return
      var re = new RegExp('^' + r.pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'))
      if (re.test(path) && (r.pat.length > hitLen || (r.pat.length === hitLen && r.allow))) { hit = r; hitLen = r.pat.length }
    })
    return { allowed: !hit || hit.allow, group: best ? best.agents.join(',') : '*' }
  }

  // ------------------------------------------------------------------- state
  var S = {
    open: false, tab: 'accounts', lang: 'ar',
    doc: null, docState: 'idle', docErr: '', draft: {}, saving: false, errs: {},
    prods: null, prodState: 'idle', prodErr: '', brands: {}, sel: '',
    // Delivery time and cash on delivery are off by default: the shop's own per-area times and COD switch are not read here yet.
    opt: { price: false, delivery: false, returns: true, cod: false, style: -1, source: 'instagram', medium: 'social', campaign: 'new_arrivals' },
    master: { ar: { text: '', dirty: false }, en: { text: '', dirty: false } },
    img: { fmt: 'square', theme: 'light', fit: 'fit', photo: 0, price: false, delivery: false, seq: 0 },
    lb: { path: '/', source: 'instagram', medium: 'social', campaign: 'new_arrivals', content: '' },
    apply: null, checks: null, checksBusy: false, note: '', noteBad: false
  }
  var panel = null, R = {}, styleEl = null

  function setNote(text, bad) { S.note = text || ''; S.noteBad = !!bad; if (R.status) { R.status.textContent = S.note; R.status.setAttribute('data-bad', S.noteBad ? '1' : '0') } }

  // -------------------------------------------------------- admin + site reads
  function request(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, body: j, retryAfter: r.headers.get('Retry-After') } })
    }).catch(function () { return { ok: false, status: 0, body: null, retryAfter: null } })
  }
  function failText(r) {
    var code = token(r.body)
    if (r.status === 0) return 'Could not reach the server. Check the connection and try again.'
    if (r.status === 401) return MSG.not_signed_in
    if (r.status === 404) return NOT_YET
    if (r.status === 429) return 'Too many requests. Wait ' + (r.retryAfter && /^\d{1,4}$/.test(r.retryAfter) ? r.retryAfter + ' seconds' : 'a minute') + ', then try again.'
    if (MSG[code]) return MSG[code]
    return 'The server could not do that (' + (code || 'HTTP ' + r.status) + ').'
  }
  /** A GET of this site's own files: only a path of this site is ever fetched. */
  function getSite(path) {
    if (!sameOriginPath(path)) return Promise.resolve({ ok: false, status: 0, text: '', type: '', bytes: 0 })
    return fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      var type = r.headers.get('content-type') || ''
      if (/^image\//i.test(type)) return r.blob().then(function (b) { return { ok: r.ok, status: r.status, text: '', type: type, bytes: b.size } })
      return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t, type: type, bytes: t.length } })
    }).catch(function () { return { ok: false, status: 0, text: '', type: '', bytes: 0 } })
  }

  // ---------------------------------------------------------------- accounts
  function storedOf(key) { var c = S.doc && S.doc.contact ? S.doc.contact[key] : ''; return typeof c === 'string' ? c : '' }
  function showOf(key, stored) {                 // what the input starts with: the handle (or the digits)
    if (!stored) return ''
    var n = normKey(key, stored)
    return n.ok ? n.handle : stored
  }
  function adoptDoc(body) {
    S.doc = { v: typeof body.v === 'number' ? body.v : 0, overrides: Array.isArray(body.overrides) ? body.overrides : [], contact: body.contact && typeof body.contact === 'object' ? body.contact : {}, returns: body.returns && typeof body.returns === 'object' ? body.returns : (S.doc ? S.doc.returns : null) }
    S.docState = 'ready'
  }
  function resetDraft() { SOCIAL_KEYS.forEach(function (k) { S.draft[k] = showOf(k, storedOf(k)) }) }
  function loadDoc(keepDraft) {
    if (S.docState === 'loading') return Promise.resolve()
    S.docState = 'loading'; renderAccounts()
    return request('content').then(function (r) {
      if (r.ok && r.body && typeof r.body === 'object' && Array.isArray(r.body.overrides)) {
        var prev = S.draft
        adoptDoc(r.body)
        if (keepDraft) SOCIAL_KEYS.forEach(function (k) { S.draft[k] = prev[k] }); else resetDraft()
        S.docErr = ''
      } else { S.docState = r.status === 404 ? 'absent' : 'error'; S.docErr = failText(r) }
      renderAccounts(); regenAll(false); renderStudio()
    })
  }
  function dirtyKey(k) {
    var n = normKey(k, S.draft[k])
    if (!n.ok) return true
    var st = storedOf(k), sn = normKey(k, st)
    return n.value !== (sn.ok ? sn.value : st)
  }
  function anyDirty() { return SOCIAL_KEYS.some(dirtyKey) }
  /** The request body: the document as it was read, with ONLY the changed social keys replaced. */
  function buildBody() {
    var contact = {}
    Object.keys(S.doc.contact).forEach(function (k) { contact[k] = S.doc.contact[k] })
    SOCIAL_KEYS.forEach(function (k) { if (dirtyKey(k)) contact[k] = normKey(k, S.draft[k]).value })
    return { v: S.doc.v, overrides: S.doc.overrides, contact: contact }
  }
  function saveAccounts() {
    if (S.saving || S.docState !== 'ready') return
    var bad = 0
    S.errs = {}
    SOCIAL_KEYS.forEach(function (k) { var n = normKey(k, S.draft[k]); if (!n.ok) { S.errs[k] = n.error; bad++ } })
    if (bad) { renderAccounts(); setNote('Fix the ' + (bad === 1 ? 'field' : bad + ' fields') + ' marked below. Nothing was sent.', true); return }
    if (!anyDirty()) { setNote('Nothing changed, so nothing was sent.', false); return }
    S.saving = true; setNote('Saving…', false); renderAccounts()
    var body = buildBody()
    request('content_save', body).then(function (r) {
      S.saving = false
      if (r.ok && r.body && typeof r.body === 'object' && Array.isArray(r.body.overrides)) {
        adoptDoc(r.body); resetDraft(); syncInputs(); setNote('Saved. Shoppers see it the next time they open a page.', false)
        S.apply = null; renderAccounts(); checkApply(); return
      }
      var code = token(r.body)
      if (r.status === 409 && code === 'content_changed') {
        setNote(MSG.content_changed, true); S.docState = 'idle'; loadDoc(true); return
      }
      if (/^invalid_contact_(instagram|tiktok|snapchat|x|whatsapp)$/.test(code)) S.errs[code.slice(16)] = code
      setNote(failText(r), true); renderAccounts()
    })
  }
  /** Is the storefront applying the saved values? Reads the public answer and the storefront script. */
  function checkApply() {
    if (S.docState !== 'ready') return Promise.resolve()
    S.apply = { state: 'checking' }; renderAccounts()
    return Promise.all([getSite('/api/api.php?r=content'), getSite('/sporta-features.js')]).then(function (rs) {
      var pub = null
      try { pub = JSON.parse(rs[0].text) } catch (e) { pub = null }
      var script = rs[1].ok && /planLink/.test(rs[1].text) && /instagram\.com/.test(rs[1].text)
      var out = { state: 'ok', problems: [] }
      if (!script) out.problems.push('The storefront script that applies these links (sporta-features.js) did not load or is an old version. Shoppers see the links built into the page, not the ones saved here.')
      var c = pub && pub.contact && typeof pub.contact === 'object' ? pub.contact : null
      if (!c) out.problems.push('The public settings answer could not be read, so it cannot be confirmed that shoppers receive these accounts.')
      else SOCIAL_KEYS.forEach(function (k) {
        var want = storedOf(k)
        if (want && String(c[k] || '') !== want) out.problems.push(netLabel(k) + ' is saved here but the public answer carries ' + (c[k] ? '“' + String(c[k]).slice(0, 80) + '”' : 'nothing') + '. It may be cached; reload in a minute.')
      })
      if (out.problems.length) out.state = 'warn'
      S.apply = out; renderAccounts()
    })
  }
  function netLabel(k) { return k === 'whatsapp' ? 'WhatsApp' : netOf(k).label }

  // ------------------------------------------------------------ products
  function loadProducts() {
    if (S.prodState === 'loading' || S.prodState === 'ready') return Promise.resolve()
    S.prodState = 'loading'; renderStudio()
    return Promise.all([request('products_all'), request('brands')]).then(function (rs) {
      var p = rs[0], b = rs[1]
      if (p.ok && Array.isArray(p.body)) {
        S.prods = p.body.filter(function (x) { return x && typeof x === 'object' && x.slug && truthy(x.active) })
        S.prods.sort(function (a, b2) { return String(a.name_en || a.name_ar).toLowerCase() < String(b2.name_en || b2.name_ar).toLowerCase() ? -1 : 1 })
        S.prodState = 'ready'; S.prodErr = ''
        if (b.ok && Array.isArray(b.body)) b.body.forEach(function (x) { if (x && x.slug) S.brands[String(x.slug).toLowerCase()] = [clean(x.name_en), clean(x.name_ar)] })
        if (!S.sel && S.prods.length) S.sel = String(S.prods[0].id)
      } else { S.prodState = 'error'; S.prodErr = failText(p) }
      renderProdBar(); regenAll(true); renderStudio(); renderImage()
    })
  }
  function product() {
    if (!S.prods) return null
    for (var i = 0; i < S.prods.length; i++) if (String(S.prods[i].id) === S.sel) return S.prods[i]
    return null
  }
  function productPath(p) { return '/product/' + encodeURIComponent(String(p.slug)) }
  function returnsDays() { var r = S.doc && S.doc.returns; return r && typeof r.window_days === 'number' && r.window_days >= 1 && r.window_days <= 60 ? r.window_days : 14 }
  function returnsAllowed() { var r = S.doc && S.doc.returns; return !(r && r.allow_return === false) }
  function utmFor(source) { return { source: source, medium: S.opt.medium, campaign: S.opt.campaign } }
  function capOpts(lang) {
    var p = product()
    return { price: S.opt.price, facts: { delivery: S.opt.delivery, returns: S.opt.returns, cod: S.opt.cod }, style: S.opt.style, returnDays: returnsDays(), allowReturn: returnsAllowed(), link: p ? buildLink(productPath(p), lang, utmFor(S.opt.source)) : '' }
  }
  /** Rebuild the captions. An edited caption is kept unless `force`. */
  function regenAll(force) {
    var p = product(), kept = false
    ;['ar', 'en'].forEach(function (l) {
      var m = S.master[l]
      if (!p) { m.text = ''; m.dirty = false; return }
      if (m.dirty && !force) { kept = true; return }
      m.text = caption(p, S.brands, l, capOpts(l)); m.dirty = false
    })
    if (kept && R.status) setNote('Your edited caption was kept. Press “Rebuild caption” to start again from the template.', false)
  }

  // -------------------------------------------------------------- the canvas
  var imgCache = {}
  function loadImg(src) {
    if (!sameOriginPath(src)) return Promise.resolve(null)
    if (imgCache[src] !== undefined) return Promise.resolve(imgCache[src])
    return new Promise(function (res) {
      var i = new Image()
      i.onload = function () { imgCache[src] = i; res(i) }
      i.onerror = function () { res(null) }
      i.src = src
    })
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
  }
  var THEMES = {
    light: { bg: COLORS.beige, ink: COLORS.ink, sub: '#5a5d63', panel: '#ffffff', accent: COLORS.orange, pill: COLORS.orange, pillInk: COLORS.ink, logo: '/logo.png', chip: null },
    dark: { bg: COLORS.ink, ink: '#ffffff', sub: '#b9bec6', panel: '#262c33', accent: COLORS.bright, pill: COLORS.orange, pillInk: COLORS.ink, logo: '/logo-white.png', chip: null },
    orange: { bg: COLORS.orange, ink: COLORS.ink, sub: '#2e1408', panel: COLORS.beige, accent: COLORS.ink, pill: COLORS.ink, pillInk: '#ffffff', logo: '/logo.png', chip: COLORS.beige }
  }
  var FONT = '"IBM Plex Sans Arabic","Alexandria","Segoe UI",Tahoma,system-ui,-apple-system,sans-serif'
  function wrapText(ctx, text, maxW, maxLines) {
    var words = String(text).split(/\s+/).filter(Boolean), lines = [], cur = '', i
    for (i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i]
      if (ctx.measureText(t).width <= maxW || !cur) cur = t
      else { lines.push(cur); cur = words[i] }
    }
    if (cur) lines.push(cur)
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines)
      var last = lines[maxLines - 1]
      while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1)
      lines[maxLines - 1] = last.replace(/\s+$/, '') + '…'
    }
    return lines
  }
  /** Draw the share card on `cv` (sets its size). o: { story, theme, lang, brand, name, price, delivery, fit, photo, logo } where photo / logo are loaded images or null. */
  function drawCard(cv, o) {
    var W = 1080, H = o.story ? 1920 : 1080, T = THEMES[o.theme] || THEMES.light, ar = o.lang === 'ar'
    cv.width = W; cv.height = H
    var ctx = cv.getContext('2d')
    var pad = o.story ? 72 : 64, x0 = ar ? W - pad : pad
    var panelY = o.story ? 400 : 180, panelH = o.story ? 800 : 520, logoY = o.story ? 250 : 56, logoH = o.story ? 100 : 84
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = T.accent; ctx.fillRect(0, 0, W, 14)
    ctx.direction = ar ? 'rtl' : 'ltr'; ctx.textAlign = ar ? 'right' : 'left'; ctx.textBaseline = 'alphabetic'
    // logo
    if (o.logo) {
      var lw = Math.round(o.logo.width * (logoH / o.logo.height)), lx = ar ? W - pad - lw : pad
      if (T.chip) { ctx.fillStyle = T.chip; rrect(ctx, lx - 16, logoY - 10, lw + 32, logoH + 20, 20); ctx.fill() }
      ctx.drawImage(o.logo, lx, logoY, lw, logoH)
    } else {
      ctx.fillStyle = T.ink; ctx.font = '800 56px ' + FONT; ctx.fillText('SPORTA', x0, logoY + 64)
    }
    // photo panel
    var px = pad, pw = W - pad * 2
    ctx.fillStyle = T.panel; rrect(ctx, px, panelY, pw, panelH, 28); ctx.fill()
    if (o.photo) {
      ctx.save(); rrect(ctx, px, panelY, pw, panelH, 28); ctx.clip()
      var iw = o.photo.width, ih = o.photo.height, k = o.fit === 'fill' ? Math.max(pw / iw, panelH / ih) : Math.min(pw / iw, panelH / ih)
      var dw = iw * k, dh = ih * k
      ctx.drawImage(o.photo, px + (pw - dw) / 2, panelY + (panelH - dh) / 2, dw, dh)
      ctx.restore()
    } else {
      ctx.fillStyle = T.sub; ctx.font = '600 34px ' + FONT; ctx.textAlign = 'center'
      ctx.fillText(ar ? 'الصورة غير متوفرة' : 'Photo not available', W / 2, panelY + panelH / 2); ctx.textAlign = ar ? 'right' : 'left'
    }
    // brand, name
    var y = panelY + panelH + (o.story ? 70 : 58), size = o.story ? 64 : 54
    if (o.brand) { ctx.fillStyle = T.accent; ctx.font = '800 ' + (o.story ? 34 : 30) + 'px ' + FONT; ctx.fillText(ar ? o.brand : o.brand.toUpperCase(), x0, y); y += o.story ? 20 : 14 }
    ctx.fillStyle = T.ink; ctx.font = '800 ' + size + 'px ' + FONT
    var lines = wrapText(ctx, o.name, W - pad * 2, 2)
    lines.forEach(function (l, i) { ctx.fillText(l, x0, y + size * 1.0 + i * size * 1.18) })
    y += size * 1.0 + (lines.length - 1) * size * 1.18 + (o.story ? 40 : 30)
    // price pill
    if (o.price) {
      var ptxt = ar ? o.price + ' د.ك' : 'KWD ' + o.price, ph = o.story ? 92 : 78
      ctx.font = '800 ' + (o.story ? 50 : 44) + 'px ' + FONT
      var pwid = Math.ceil(ctx.measureText(ptxt).width) + 64, pxx = ar ? W - pad - pwid : pad
      ctx.fillStyle = T.pill; rrect(ctx, pxx, y, pwid, ph, ph / 2); ctx.fill()
      ctx.fillStyle = T.pillInk; ctx.textAlign = 'center'; ctx.fillText(ptxt, pxx + pwid / 2, y + ph * 0.68); ctx.textAlign = ar ? 'right' : 'left'
      y += ph + 24
    }
    // footer
    var fy = o.story ? 1560 : H - 52
    ctx.fillStyle = T.sub; ctx.font = '600 ' + (o.story ? 32 : 28) + 'px ' + FONT
    if (o.delivery) {
      var dl = ar ? 'توصيل خلال ٢٤ ساعة  •  الدفع عند الاستلام' : 'Delivery within 24 hours  •  Cash on delivery'
      ctx.fillText(dl, x0, o.story ? fy - 48 : fy - 40)
    }
    ctx.fillStyle = T.ink; ctx.font = '800 ' + (o.story ? 36 : 30) + 'px ' + FONT; ctx.direction = 'ltr'; ctx.textAlign = ar ? 'right' : 'left'
    ctx.fillText('sporta.com.kw', x0, fy)
  }
  function renderImageDraw() {
    if (!R.canvas) return
    var p = product(), seq = ++S.img.seq
    var ph = p ? photosOf(p) : [], pick = ph[S.img.photo] || null
    var T = THEMES[S.img.theme] || THEMES.light
    Promise.all([pick && S.img.photo >= 0 ? loadImg(pick) : Promise.resolve(null), loadImg(T.logo)]).then(function (a) {
      if (seq !== S.img.seq) return
      var brand = p ? brandOf(p, S.brands) : ['', ''], ar = S.lang === 'ar'
      var pr = p && S.img.price ? priceOf(p) : null
      drawCard(R.canvas, {
        story: S.img.fmt === 'story', theme: S.img.theme, lang: S.lang, brand: p ? (ar ? (brand[1] || brand[0]) : (brand[0] || brand[1])) : '',
        name: p ? clean(ar ? (p.name_ar || p.name_en) : (p.name_en || p.name_ar)) : '', price: pr ? pr.text : '', delivery: S.img.delivery,
        fit: S.img.fit, photo: a[0], logo: a[1]
      })
      R.canvas.setAttribute('data-size', R.canvas.width + 'x' + R.canvas.height)
      R.imgInfo.textContent = (p ? '' : 'Pick a product to draw its card. ') + R.canvas.width + ' × ' + R.canvas.height + ' PNG' + (pick && !a[0] ? ' · the photo could not be loaded, a plate is drawn instead' : '') + (!pick && p ? ' · this product has no photo on this site, a plate is drawn instead' : '')
      R.dl.disabled = !p
    })
  }
  function downloadImage() {
    var p = product()
    if (!p || !R.canvas) return
    R.canvas.toBlob(function (blob) {
      if (!blob) { setNote('The picture could not be made. Try a different photo.', true); return }
      var u = URL.createObjectURL(blob), a = document.createElement('a')
      a.href = u; a.download = 'sporta-' + String(p.slug).replace(/[^a-z0-9-]/gi, '-').slice(0, 60) + '-' + S.lang + '-' + R.canvas.width + 'x' + R.canvas.height + '.png'
      a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(function () { URL.revokeObjectURL(u) }, 4000)
      setNote('Downloaded ' + a.download + '. Nothing was uploaded.', false)
    }, 'image/png')
  }

  // ------------------------------------------------------------------ checks
  function metaOf(doc, sel) { var m = doc.querySelector(sel); return m ? clean(m.getAttribute('content')) : '' }
  function readTags(text) {
    var d = new DOMParser().parseFromString(text, 'text/html')
    var can = d.querySelector('link[rel="canonical"]')
    return { title: metaOf(d, 'meta[property="og:title"]'), desc: metaOf(d, 'meta[property="og:description"]'), image: metaOf(d, 'meta[property="og:image"]'), url: metaOf(d, 'meta[property="og:url"]'), card: metaOf(d, 'meta[name="twitter:card"]'), canonical: can ? clean(can.getAttribute('href')) : '' }
  }
  function readFooter() {
    return new Promise(function (resolve) {
      var f = document.createElement('iframe'), done = false
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin'); f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:900px;border:0;visibility:hidden'
      var t0 = Date.now(), last = '', stable = 0
      function finish(v) { if (done) return; done = true; try { f.remove() } catch (e) { /* gone already */ } resolve(v) }
      function scan() {
        var d = null
        try { d = f.contentDocument } catch (e) { d = null }
        if (done) return
        var found = {}, n = 0
        if (d && d.body) {
          var as = d.querySelectorAll('footer a[href]')
          for (var i = 0; i < as.length; i++) {
            var h = as[i].getAttribute('href') || '', host = ''
            try { host = new URL(h, ORIGIN).hostname.toLowerCase() } catch (e) { host = '' }
            NETS.forEach(function (nn) { if (nn.hosts.indexOf(host) >= 0) { (found[nn.key] = found[nn.key] || []).push(h); n++ } })
            if (host === 'wa.me' || host === 'api.whatsapp.com') { (found.whatsapp = found.whatsapp || []).push(h); n++ }
          }
        }
        var sig = JSON.stringify(found)
        if (n && sig === last) stable++; else stable = 0
        last = sig
        if (stable >= 3 || Date.now() - t0 > 9000) return finish({ found: found, n: n, footer: !!(d && d.querySelector('footer')) })
        setTimeout(scan, 300)
      }
      f.addEventListener('load', function () { setTimeout(scan, 300) })
      f.src = '/?lang=en'
      document.body.appendChild(f)
      setTimeout(function () { finish({ found: {}, n: 0, footer: false, timeout: true }) }, 12000)
    })
  }
  function runChecks() {
    if (S.checksBusy) return
    S.checksBusy = true; S.checks = null; renderChecks()
    var out = []
    function put(id, state, title, detail, advice) { out.push({ id: id, state: state, title: title, detail: detail, advice: advice || '' }) }
    var ready = S.docState === 'ready' ? Promise.resolve() : loadDoc(false)
    var prodsReady = S.prodState === 'ready' ? Promise.resolve() : loadProducts()
    Promise.all([ready, prodsReady]).then(function () {
      var slug = S.prods && S.prods.length ? S.prods[0].slug : ''
      if (product()) slug = product().slug
      return Promise.all([getSite('/'), getSite('/?lang=en'), slug ? getSite('/product/' + encodeURIComponent(slug)) : Promise.resolve(null), getSite('/robots.txt'), getSite('/sporta-features.js'), getSite('/api/api.php?r=content')]).then(function (rs) {
        var pages = [['home', 'Home page (Arabic)', rs[0]], ['home-en', 'Home page (English)', rs[1]], ['product', slug ? 'Product page /product/' + slug : 'Product page', rs[2]]]
        var images = {}
        pages.forEach(function (pg) {
          var r = pg[2]
          if (!r) { put('tags-' + pg[0], 'skip', pg[1] + ': share tags', 'There is no product to check.', 'Add a product in the Catalogue, then run the checks again.'); return }
          if (!r.ok) { put('tags-' + pg[0], 'fail', pg[1] + ': share tags', 'The page answered HTTP ' + (r.status || 'nothing') + '.', 'Open the page in a browser. If it loads there, run the checks again in a minute.'); return }
          var t = readTags(r.text), missing = []
          if (!t.title) missing.push('og:title'); if (!t.desc) missing.push('og:description'); if (!t.image) missing.push('og:image'); if (!t.card) missing.push('twitter:card')
          if (missing.length) put('tags-' + pg[0], 'fail', pg[1] + ': share tags', 'Missing: ' + missing.join(', ') + '.', 'Without them a shared link shows as a bare address. Tags are written by the shop server (api/seo-page.php) and the page head; ask for a release if the page is a product.')
          else put('tags-' + pg[0], 'pass', pg[1] + ': share tags', 'og:title, og:description, og:image and twitter:card are all present (“' + wordCut(t.title, 60) + '”).')
          if (t.image) images[t.image] = pg[1]
          var host = ''
          try { host = new URL(t.canonical || t.url || '', ORIGIN).origin } catch (e) { host = '' }
          if (pg[0] === 'home' && host && host !== ORIGIN) put('canonical', 'warn', 'Canonical host', 'The page says it lives at ' + host + '.', 'Every address the shop publishes must be ' + ORIGIN + '. Shares and links on another spelling split the audience in two.')
          else if (pg[0] === 'home' && host) put('canonical', 'pass', 'Canonical host', 'The page names ' + ORIGIN + '.')
        })
        var imgKeys = Object.keys(images)
        return Promise.all(imgKeys.map(function (src) {
          var u = null
          try { u = new URL(src, ORIGIN) } catch (e) { u = null }
          if (!u || (u.origin !== ORIGIN && u.origin !== location.origin)) { put('image-' + src, 'fail', 'Share picture: ' + wordCut(src, 60), 'It is on ' + (u ? u.origin : 'an address that is not valid') + ', not on ' + ORIGIN + '.', 'Point og:image at a picture on this site. A picture on another host can be blocked or changed by its owner.'); return null }
          return getSite(u.pathname + u.search).then(function (r) {
            if (!r.ok || !/^image\//i.test(r.type) || !r.bytes) put('image-' + src, 'fail', 'Share picture: ' + u.pathname, 'The picture answered HTTP ' + r.status + (r.type ? ' (' + r.type + ')' : '') + '.', 'Upload the picture again or choose another share image in the SEO editor.')
            else if (r.bytes > 600 * 1024) put('image-' + src, 'warn', 'Share picture: ' + u.pathname, 'It loads, but it is ' + Math.round(r.bytes / 1024) + ' kB.', 'WhatsApp and Telegram can skip a share picture above about 600 kB. Use a lighter file.')
            else put('image-' + src, 'pass', 'Share picture: ' + u.pathname, 'It loads (' + Math.round(r.bytes / 1024) + ' kB, ' + r.type.split(';')[0] + ') and is on this site.')
            return null
          })
        })).then(function () {
          // robots.txt
          var rb = rs[3]
          if (!rb.ok) put('robots', 'fail', 'robots.txt', 'It answered HTTP ' + rb.status + '.', 'Without a robots.txt crawlers assume everything is allowed; if it is blocked by the server, link previews can fail.')
          else {
            var crawlers = [['facebookexternalhit', 'Facebook and Instagram'], ['Twitterbot', 'X (Twitter)'], ['WhatsApp', 'WhatsApp'], ['TelegramBot', 'Telegram'], ['LinkedInBot', 'LinkedIn'], ['Pinterestbot', 'Pinterest']]
            var bad = []
            crawlers.forEach(function (c) {
              ;['/', '/product/example', '/og-image.png', '/images/products/example.jpg'].forEach(function (pth) {
                var v = robotsAllows(rb.text, c[0], pth)
                if (!v.allowed && !bad.some(function (b) { return b.indexOf(c[1]) === 0 })) bad.push(c[1] + ' (' + pth + ')')
              })
            })
            if (bad.length) put('robots', 'fail', 'robots.txt and the social crawlers', 'These crawlers are blocked: ' + bad.join(', ') + '.', 'Remove the Disallow that covers the shop pages or the pictures for them. A blocked crawler shows a link with no title and no picture.')
            else put('robots', 'pass', 'robots.txt and the social crawlers', 'Facebook/Instagram, X, WhatsApp, Telegram, LinkedIn and Pinterest may fetch the pages and the pictures.')
          }
          // the storefront script and the public answer
          var script = rs[4].ok && /planLink/.test(rs[4].text), pub = null
          try { pub = JSON.parse(rs[5].text) } catch (e) { pub = null }
          var homeHasScript = rs[0].ok && /sporta-features\.js/.test(rs[0].text)
          if (!script) put('script', 'fail', 'Storefront script', 'sporta-features.js did not load or has no link rewriting (HTTP ' + rs[4].status + ').', 'Saved handles are applied by that file. Without it the footer keeps the links built into the page.')
          else if (!homeHasScript) put('script', 'warn', 'Storefront script', 'The file exists, but the home page does not link it.', 'The page’s index.html has to load /sporta-features.js, or the saved handles never reach the footer.')
          else put('script', 'pass', 'Storefront script', 'sporta-features.js is linked by the home page and rewrites the social links.')
          var c = pub && pub.contact
          var diffs = []
          if (c) SOCIAL_KEYS.forEach(function (k) { var want = storedOf(k); if (want && String(c[k] || '') !== want) diffs.push(netLabel(k)) })
          if (!c) put('public', 'warn', 'Public settings answer', 'The public answer could not be read.', 'Open /api/api.php?r=content in a browser; it should show the contact block.')
          else if (diffs.length) put('public', 'warn', 'Public settings answer', diffs.join(', ') + ' differ from what is saved.', 'Save again, or wait a minute for the cache.')
          else put('public', 'pass', 'Public settings answer', 'It carries the accounts saved in this panel.')
          // footer links
          return readFooter().then(function (ft) {
            var rows = [], failN = 0
            SOCIAL_KEYS.forEach(function (k) {
              var want = storedOf(k), hrefs = (ft.found[k] || [])
              if (!want) return
              if (!hrefs.length) { rows.push(netLabel(k) + ': saved, but the footer has no ' + netLabel(k) + ' link to change'); failN++; return }
              var wantHref = k === 'whatsapp' ? 'https://wa.me/' + want : want
              if (hrefs.some(function (h) { return h === wantHref })) rows.push(netLabel(k) + ': matches')
              else { rows.push(netLabel(k) + ': footer links to ' + wordCut(hrefs[0], 60) + ', saved is ' + wordCut(wantHref, 60)); failN++ }
            })
            if (!ft.footer) put('footer', 'warn', 'Footer links', 'The footer could not be read' + (ft.timeout ? ' (the page took too long)' : '') + '.', 'Open the shop and look at the footer yourself.')
            else if (!rows.length) put('footer', 'skip', 'Footer links', 'No social account is saved yet, so there is nothing to compare.', 'Add the accounts in the Accounts tab.')
            else if (failN) put('footer', 'fail', 'Footer links', rows.join('; ') + '.', 'The storefront only rewrites links the page already has. A platform the footer does not show needs a storefront release (see “Not built yet”); a different handle usually means the script has not loaded: reload the shop with a hard refresh.')
            else put('footer', 'pass', 'Footer links', rows.join('; ') + '.')
          })
        })
      })
    }).then(function () {
      var order = ['tags-home', 'tags-home-en', 'tags-product', 'canonical']
      out.sort(function (a, b) {
        function rank(x) { var i = order.indexOf(x.id); return i >= 0 ? i : (/^image-/.test(x.id) ? 10 : ({ robots: 20, footer: 30, script: 40, public: 41 }[x.id] || 50)) }
        return rank(a) - rank(b)
      })
      S.checks = out; S.checksBusy = false; renderChecks()
    }).catch(function () { S.checksBusy = false; setNote('The checks stopped on an error. Try again.', true); renderChecks() })
  }

  // ------------------------------------------------------------------- copy
  function copyText(text, b) {
    function done(ok) {
      setNote(ok ? 'Copied.' : 'Copy did not work here. Select the text and copy it by hand.', !ok)
      if (ok && b) { var was = b.getAttribute('data-label') || b.textContent; b.setAttribute('data-label', was); b.textContent = 'Copied'; setTimeout(function () { b.textContent = was }, 1200) }
    }
    function fallback() {
      var ta = document.createElement('textarea'), ok = false
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0'
      document.body.appendChild(ta); ta.select()
      try { ok = document.execCommand('copy') } catch (e) { ok = false }
      ta.remove(); done(ok)
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { done(true) }, fallback); return }
    } catch (e) { /* use the fallback */ }
    fallback()
  }

  // --------------------------------------------------------------------- CSS
  var CSS = [
    '.ssoc{--sc-bg:#fff;--sc-soft:#f7f8fa;--sc-line:#d9dfe5;--sc-edge:#7d8799;--sc-text:#18212a;--sc-muted:#556274;--sc-action:var(--admin-action,#9a452c);--sc-on-action:#fff;--sc-pick:#f8ece6;--sc-ok:#1b6e3c;--sc-ok-bg:#e6f4ec;--sc-warn:#8a4b00;--sc-warn-bg:#fdf0d9;--sc-err:#be123c;--sc-err-bg:#fde8ee;' +
      'container-type:inline-size;box-sizing:border-box;margin:0;padding:1rem;border:1px solid var(--sc-line);border-radius:1rem;background:var(--sc-bg);color:var(--sc-text);font:400 .875rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:start}',
    '@media (max-width:420px){.ssoc{padding:.625rem}}',
    ':is(html.dark,html[data-theme="dark"]) .ssoc{color-scheme:dark;--sc-bg:#151b21;--sc-soft:#1a2128;--sc-line:#303942;--sc-edge:#7a8896;--sc-text:#eef2f5;--sc-muted:#a7b3be;--sc-action:var(--brand-bright,#ff7b17);--sc-on-action:#171a1e;--sc-pick:#372a24;--sc-ok:#6ee7a3;--sc-ok-bg:#0f2f1f;--sc-warn:#fbbf24;--sc-warn-bg:#3a2a0a;--sc-err:#fda4af;--sc-err-bg:#3d1520}',
    '.ssoc[hidden]{display:none!important}',
    '.ssoc *,.ssoc *::before,.ssoc *::after{box-sizing:border-box}',
    '.ssoc-wrap{display:grid;gap:1rem;min-width:0}',
    '.ssoc-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:.75rem}','.ssoc-head>div{flex:1 1 20rem;min-width:0}',
    '.ssoc-title{margin:0;font-size:1.5rem;font-weight:700;line-height:1.25;color:var(--sc-text)}',
    '.ssoc-title:focus,.ssoc-title:focus-visible{outline:none}',
    '.ssoc-lead{margin:.25rem 0 0;color:var(--sc-muted)}',
    '.ssoc p{margin:0}',
    '.ssoc :is(button,input,select,textarea){font:inherit}',
    '.ssoc .ssoc-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.75rem;padding:.5rem 1rem;border:1px solid var(--sc-edge);border-radius:.75rem;background:var(--sc-bg);color:var(--sc-text);font-weight:600;text-align:center;text-decoration:none;cursor:pointer}',
    '.ssoc .ssoc-btn:hover:not(:disabled):not([aria-disabled="true"]){background:var(--sc-soft);border-color:var(--sc-text)}',
    '.ssoc .ssoc-btn--primary{background:var(--sc-action);border-color:transparent;color:var(--sc-on-action);font-weight:700}',
    '.ssoc .ssoc-btn--primary:hover:not(:disabled){background:var(--sc-action);border-color:transparent;filter:brightness(.9)}',
    '.ssoc .ssoc-btn--quiet{border-color:var(--sc-line);color:var(--sc-muted)}',
    '.ssoc .ssoc-btn--small{min-height:2.75rem;padding:.25rem .75rem;font-size:.8125rem}',
    '.ssoc .ssoc-btn:disabled,.ssoc .ssoc-btn[aria-disabled="true"]{cursor:not-allowed;background:var(--sc-soft);border-color:var(--sc-line);color:var(--sc-muted);pointer-events:none}',
    '.ssoc :is(button,input,select,textarea,summary,a):focus-visible{outline:2px solid var(--sc-action);outline-offset:2px}',
    '.ssoc-status{min-height:1.25rem;font-weight:600;color:var(--sc-muted);overflow-wrap:anywhere}',
    '.ssoc-status[data-bad="1"]{color:var(--sc-err)}',
    '.ssoc-tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(6.5rem,1fr));gap:.25rem;padding:.25rem;border:1px solid var(--sc-line);border-radius:.875rem;background:var(--sc-soft)}',
    '.ssoc .ssoc-tab{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:.25rem .5rem;border:0;border-radius:.625rem;background:transparent;color:var(--sc-text);font-weight:700;text-align:center;cursor:pointer}',
    '.ssoc .ssoc-tab:hover{background:var(--sc-bg)}',
    '.ssoc .ssoc-tab[aria-selected="true"]{background:var(--sc-action);color:var(--sc-on-action)}',
    '.ssoc-pane{display:grid;gap:1rem;min-width:0}',
    '.ssoc-pane[hidden]{display:none!important}',
    '.ssoc-card{display:grid;gap:.75rem;align-content:start;min-width:0;padding:.875rem;border:1px solid var(--sc-line);border-radius:.875rem;background:var(--sc-bg)}',
    '.ssoc-card--soft{background:var(--sc-soft)}',
    '.ssoc-h2{margin:0;font-size:1rem;font-weight:700}',
    '.ssoc-muted{color:var(--sc-muted)}',
    '.ssoc-grid{display:grid;gap:.75rem;grid-template-columns:minmax(0,1fr)}',
    '@container (min-width:640px){.ssoc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ssoc-grid--3{grid-template-columns:repeat(3,minmax(0,1fr))}}',
    '.ssoc-fld{display:grid;gap:.25rem;min-width:0}',
    '.ssoc-flab{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.25rem .5rem;font-size:.8125rem;font-weight:700;color:var(--sc-muted)}',
    '.ssoc :is(select,input[type="text"],input[type="search"],textarea){width:100%;min-height:2.75rem;padding:.25rem .625rem;border:1px solid var(--sc-edge);border-radius:.75rem;color:var(--sc-text)!important;background-color:var(--sc-bg)!important;box-shadow:none}',
    '.ssoc textarea{min-height:7rem;padding:.5rem .625rem;resize:vertical;line-height:1.55}',
    '.ssoc input::placeholder,.ssoc textarea::placeholder{color:var(--sc-muted)!important;opacity:1!important}',
    '.ssoc :is(input,textarea)[aria-invalid="true"]{border-color:var(--sc-err)}',
    '.ssoc .ssoc-ltr{direction:ltr;text-align:start;unicode-bidi:plaintext}',
    '.ssoc-banner{display:flex;gap:.625rem;padding:.75rem .875rem;border:1px solid var(--sc-line);border-radius:.875rem;background:var(--sc-soft);overflow-wrap:anywhere}',
    '.ssoc-banner[data-state="ok"]{border-color:var(--sc-ok);background:var(--sc-ok-bg)}',
    '.ssoc-banner[data-state="warn"]{border-color:var(--sc-warn);background:var(--sc-warn-bg)}',
    '.ssoc-banner[data-state="error"]{border-color:var(--sc-err);background:var(--sc-err-bg);color:var(--sc-err);font-weight:600}',
    '.ssoc-banner ul{margin:.25rem 0 0;padding-inline-start:1.1rem}',
    '.ssoc-banner[hidden]{display:none!important}',
    '.ssoc-acc{display:grid;gap:.5rem;min-width:0}',
    '.ssoc-acc-head{display:flex;align-items:center;gap:.625rem;min-width:0}',
    '.ssoc-mono{flex:none;width:2.25rem;height:2.25rem;display:inline-flex;align-items:center;justify-content:center;border-radius:.625rem;border:1px solid var(--sc-edge);background:var(--sc-soft);color:var(--sc-text);font-size:.75rem;font-weight:800;letter-spacing:.02em}',
    '.ssoc-acc-name{font-weight:700;flex:1 1 auto;min-width:0}',
    '.ssoc-chip{display:inline-flex;align-items:center;padding:.0625rem .5rem;border:1px solid currentColor;border-radius:999px;font-size:.75rem;font-weight:700;line-height:1.5;white-space:nowrap}',
    '.ssoc-chip--ok{color:var(--sc-ok);background:var(--sc-ok-bg)}.ssoc-chip--warn{color:var(--sc-warn);background:var(--sc-warn-bg)}.ssoc-chip--error{color:var(--sc-err);background:var(--sc-err-bg)}.ssoc-chip--info{color:var(--sc-muted);background:var(--sc-soft)}',
    '.ssoc-preview{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.375rem .625rem;min-width:0}',
    '.ssoc-preview-text{flex:1 1 14rem;min-width:0;overflow-wrap:anywhere;color:var(--sc-muted)}',
    '.ssoc-err{font-weight:600;color:var(--sc-err);overflow-wrap:anywhere}',
    '.ssoc-foot{margin:0;padding:.75rem;list-style:none;display:flex;flex-wrap:wrap;gap:.5rem;border:1px dashed var(--sc-edge);border-radius:.875rem;background:var(--sc-soft)}',
    '.ssoc-foot li{display:inline-flex;align-items:center;gap:.4rem;min-height:2.75rem;padding:0 .75rem;border:1px solid var(--sc-line);border-radius:999px;background:var(--sc-bg);font-weight:600}',
    '.ssoc-foot .ssoc-mono{width:1.75rem;height:1.75rem;border-radius:999px;font-size:.6875rem}',
    '.ssoc-acts{display:flex;flex-wrap:wrap;gap:.5rem}',
    '.ssoc-seg{display:inline-flex;border:1px solid var(--sc-edge);border-radius:.75rem;overflow:hidden}',
    '.ssoc .ssoc-segbtn{min-height:2.75rem;min-width:2.75rem;padding:0 .875rem;border:0;background:var(--sc-bg);color:var(--sc-text);font-weight:700;cursor:pointer}',
    '.ssoc .ssoc-segbtn[aria-pressed="true"]{background:var(--sc-action);color:var(--sc-on-action)}',
    '.ssoc-checks{display:flex;flex-wrap:wrap;gap:.25rem 1rem}',
    '.ssoc-check{display:inline-flex;align-items:center;gap:.5rem;min-height:2.75rem;font-weight:600;cursor:pointer}',
    '.ssoc-check input{width:1.25rem;height:1.25rem;min-height:0;margin:0;accent-color:var(--sc-action)}',
    '.ssoc-prod{display:flex;gap:.75rem;align-items:center;min-width:0}',
    '.ssoc-thumb{flex:none;width:4rem;height:4rem;object-fit:cover;border:1px solid var(--sc-line);border-radius:.625rem;background:var(--sc-soft)}',
    '.ssoc-thumb[hidden]{display:none}',
    '.ssoc-prod-info{display:grid;min-width:0;gap:.125rem}',
    '.ssoc-prod-name{font-weight:700;overflow-wrap:anywhere}',
    '.ssoc-var{display:grid;gap:.5rem;min-width:0;padding:.75rem;border:1px solid var(--sc-line);border-radius:.875rem;background:var(--sc-soft)}',
    '.ssoc-var-head{display:flex;align-items:center;gap:.625rem;flex-wrap:wrap}',
    '.ssoc-var-head .ssoc-acc-name{flex:1 1 8rem}',
    '.ssoc-count{font-weight:700;font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate}',
    '.ssoc-count--ok{color:var(--sc-ok)}.ssoc-count--warn{color:var(--sc-warn)}.ssoc-count--error{color:var(--sc-err)}',
    '.ssoc-link{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}',
    '.ssoc-link input{flex:1 1 14rem;min-width:0}',
    '.ssoc-canvas-wrap{display:grid;gap:.5rem;justify-items:center;padding:.75rem;border:1px solid var(--sc-line);border-radius:.875rem;background:var(--sc-soft)}',
    '.ssoc-canvas{display:block;width:100%;height:auto;max-width:34rem;border:1px solid var(--sc-line);border-radius:.5rem;background:#fff}',
    '.ssoc-canvas[data-size="1080x1920"]{max-width:20rem}',
    '.ssoc-checklist,.ssoc-needs{margin:0;padding:0;list-style:none;display:grid;gap:.5rem}',
    '.ssoc-item{display:flex;gap:.625rem;padding:.625rem .75rem;border:1px solid var(--sc-line);border-radius:.75rem;background:var(--sc-soft)}',
    '.ssoc-mark{flex:none;width:1.5rem;height:1.5rem;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid currentColor;font-size:.8125rem;font-weight:800}',
    '.ssoc-item--pass .ssoc-mark{color:var(--sc-ok)}.ssoc-item--warn .ssoc-mark{color:var(--sc-warn)}.ssoc-item--fail .ssoc-mark{color:var(--sc-err)}.ssoc-item--skip .ssoc-mark{color:var(--sc-muted)}',
    '.ssoc-item-body{min-width:0;display:grid;gap:.125rem;overflow-wrap:anywhere}',
    '.ssoc-item-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 .5rem;font-weight:700}',
    '.ssoc-item-state{font-size:.75rem;font-weight:700;color:var(--sc-muted)}',
    '.ssoc-item-advice{color:var(--sc-muted)}',
    '.ssoc-code{margin:0;padding:.625rem .75rem;border:1px solid var(--sc-line);border-radius:.625rem;background:var(--sc-bg);font:500 .75rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;direction:ltr;text-align:start}',
    '.ssoc-needs>li{display:grid;gap:.5rem;padding:.75rem;border:1px solid var(--sc-line);border-radius:.75rem;background:var(--sc-soft)}',
    '.ssoc-needs h3{margin:0;font-size:.9375rem;font-weight:700}',
    '.ssoc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}',
    'body[' + OPEN + '="open"] main.admin-content>section.admin-page:not([' + PAGE + ']){display:none!important}',
    '.ssoc-open{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.75rem;padding:.5rem 1rem;border:0;border-radius:.75rem;background:var(--admin-action,#9a452c);color:#fff;font:700 .875rem/1.25 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}',
    '.ssoc-open:hover{filter:brightness(.92)}',
    '.ssoc-open:focus-visible{outline:2px solid var(--admin-action,#9a452c);outline-offset:2px}',
    '.ssoc-open--below{margin-top:.5rem}',
    ':is(html.dark,html[data-theme="dark"]) .ssoc-open{background:var(--brand-bright,#ff7b17);color:#171a1e}',
    '@media (prefers-reduced-motion:no-preference){.ssoc .ssoc-btn,.ssoc .ssoc-tab{transition:background-color .15s ease,border-color .15s ease}}'
  ].join('\n')
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return
    styleEl = document.createElement('style')
    styleEl.setAttribute('data-sporta-social-style', '')
    styleEl.textContent = CSS
    document.head.appendChild(styleEl)
  }

  // ------------------------------------------------------------- UI pieces
  function btn(cls, text, fn) { var b = el('button', 'ssoc-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; if (fn) b.addEventListener('click', guard(fn)); return b }
  function fld(label, control, extra) { var l = el('label', 'ssoc-fld'), s = el('span', 'ssoc-flab'); add(s, el('span', '', label)); if (extra) s.appendChild(extra); add(l, s, control); return l }
  function chip(cls, text) { return el('span', 'ssoc-chip ssoc-chip--' + cls, text) }
  function seg(label, options, get, set) {
    var wrap = el('div', 'ssoc-seg'), bs = []
    wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', label)
    options.forEach(function (o) {
      var b = el('button', 'ssoc-segbtn', o[1]); b.type = 'button'; b.setAttribute('data-value', o[0])
      b.addEventListener('click', guard(function () { set(o[0]); bs.forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-value') === String(get()) ? 'true' : 'false') }) }))
      bs.push(b); wrap.appendChild(b)
    })
    wrap.sync = function () { bs.forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-value') === String(get()) ? 'true' : 'false') }) }
    wrap.sync()
    return wrap
  }
  function check(label, get, set) {
    var l = el('label', 'ssoc-check'), i = el('input'); i.type = 'checkbox'; i.checked = !!get()
    i.addEventListener('change', guard(function () { set(i.checked) }))
    add(l, i, el('span', '', label)); l.sync = function () { i.checked = !!get() }
    return l
  }
  function select(list, get, set, labelOf) {
    var s = el('select')
    list.forEach(function (v) { var o = el('option', '', labelOf ? labelOf(v) : v); o.value = v; s.appendChild(o) })
    s.value = get()
    s.addEventListener('change', guard(function () { set(s.value) }))
    s.sync = function () { s.value = get() }
    return s
  }
  function openLink(label, href) {
    var a = el('a', 'ssoc-btn ssoc-btn--small', label)
    a.target = '_blank'; a.rel = 'noopener noreferrer'
    if (href) a.href = href; else { a.setAttribute('aria-disabled', 'true'); a.removeAttribute('href') }
    return a
  }
  function setOpenLink(a, href) { if (href) { a.href = href; a.removeAttribute('aria-disabled') } else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true') } }
  function counter(n, limit) {
    var cls = n > limit ? 'error' : n > limit * 0.9 ? 'warn' : 'ok'
    return { text: n + ' / ' + limit, cls: cls }
  }

  // ------------------------------------------------------------ the panes
  function buildAccounts() {
    var pane = el('div', 'ssoc-pane'); pane.setAttribute('role', 'tabpanel')
    R.accBanner = el('div', 'ssoc-banner'); R.accBanner.hidden = true; R.accBanner.setAttribute('dir', 'auto')
    R.acc = {}
    var grid = el('div', 'ssoc-grid')
    SOCIAL_KEYS.forEach(function (k) {
      var net = netOf(k) || { label: 'WhatsApp', mono: 'WA' }, card = el('div', 'ssoc-card'), ref = R.acc[k] = {}
      card.setAttribute('data-net', k)
      var head = el('div', 'ssoc-acc-head')
      ref.chip = chip('info', 'Missing')
      add(head, el('span', 'ssoc-mono', k === 'whatsapp' ? 'WA' : net.mono), el('span', 'ssoc-acc-name', netLabel(k)), ref.chip)
      ref.input = el('input'); ref.input.type = 'text'; ref.input.name = 'ssoc_' + k; ref.input.maxLength = 300; ref.input.autocomplete = 'off'; ref.input.spellcheck = false
      ref.input.setAttribute('dir', 'ltr'); ref.input.placeholder = k === 'whatsapp' ? '96522091914' : k === 'instagram' || k === 'tiktok' ? '@sporta.kw' : 'username'
      ref.input.addEventListener('input', guard(function () { S.draft[k] = ref.input.value; delete S.errs[k]; renderAccounts() }))
      ref.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); guard(saveAccounts)() } })
      ref.err = el('p', 'ssoc-err'); ref.err.setAttribute('role', 'alert'); ref.err.hidden = true
      ref.text = el('p', 'ssoc-preview-text')
      ref.open = openLink('Open', '')
      var prev = el('div', 'ssoc-preview'); add(prev, ref.text, ref.open)
      var id = 'ssoc-in-' + k; ref.input.id = id
      var lab = el('label', 'ssoc-flab'); lab.setAttribute('for', id); lab.appendChild(el('span', '', k === 'whatsapp' ? 'Number with country code, digits only' : 'Username or address'))
      add(card, head, lab, ref.input, ref.err, el('p', 'ssoc-muted', k === 'whatsapp' ? 'The full international number: 965 then the 8 digits. It is what the WhatsApp links on the shop open.' : net.hint), prev)
      grid.appendChild(card)
    })
    R.foot = el('ul', 'ssoc-foot'); R.foot.setAttribute('aria-label', 'How the storefront footer will show the accounts')
    R.contact = el('div', 'ssoc-card ssoc-card--soft')
    R.contactBody = el('div', 'ssoc-grid')
    add(R.contact, el('h2', 'ssoc-h2', 'Phone and e-mail (read only)'), R.contactBody, el('p', 'ssoc-muted', 'These are kept exactly as they are. Change them in Site content.'))
    R.saveBtn = btn('ssoc-btn--primary', 'Save accounts', saveAccounts)
    R.discard = btn('', 'Discard changes', function () { resetDraft(); S.errs = {}; syncInputs(); renderAccounts(); setNote('Changes discarded.', false) })
    R.reload = btn('ssoc-btn--quiet', 'Reload from server', function () {
      // Typed handles that are not saved yet are kept only if the owner agrees to discard them.
      var typed = SOCIAL_KEYS.some(function (k) { return dirtyKey(k) })
      if (typed && !window.confirm('Discard the changes that are not saved? · تجاهل التغييرات غير المحفوظة؟')) return
      S.docState = 'idle'; S.errs = {}; S.apply = null; loadDoc(false).then(function () { syncInputs(); renderAccounts(); checkApply() })
    })
    var acts = el('div', 'ssoc-acts'); add(acts, R.saveBtn, R.discard, R.reload)
    add(pane, R.accBanner, grid, el('h2', 'ssoc-h2', 'How the storefront footer will show them'), R.foot, R.contact, acts,
      el('p', 'ssoc-muted', 'A platform the shop footer does not have yet (Facebook, YouTube, Telegram, Threads) needs a shop-server release: see “Not built yet”. Saving sends the site content exactly as it was read, with only the changed accounts replaced.'))
    return pane
  }
  function syncInputs() { SOCIAL_KEYS.forEach(function (k) { if (R.acc[k].input.value !== (S.draft[k] || '')) R.acc[k].input.value = S.draft[k] || '' }) }
  function renderAccounts() {
    if (!R.acc) return
    var ready = S.docState === 'ready'
    // banner
    var b = R.accBanner, msg = null, state = 'info'
    if (S.docState === 'loading') msg = 'Loading the current accounts…'
    else if (S.docState === 'absent') { msg = NOT_YET; state = 'error' }
    else if (S.docState === 'error') { msg = S.docErr; state = 'error' }
    else if (ready && S.apply && S.apply.state === 'checking') msg = 'Checking that the storefront applies these accounts…'
    else if (ready && S.apply && S.apply.state === 'warn') state = 'warn'
    else if (ready && S.apply && S.apply.state === 'ok') { msg = 'The storefront script is there and the public answer carries the saved accounts.'; state = 'ok' }
    b.textContent = ''
    if (S.apply && S.apply.state === 'warn' && ready) {
      var ul = el('ul'); S.apply.problems.forEach(function (t) { ul.appendChild(el('li', '', t)) })
      add(b, el('div', '', ''), ul); b.firstChild.textContent = 'The storefront may not be applying these accounts:'
      b.firstChild.style.fontWeight = '700'
    } else if (msg) b.textContent = msg
    b.setAttribute('data-state', state); b.hidden = !(msg || (S.apply && S.apply.state === 'warn' && ready))
    // cards
    SOCIAL_KEYS.forEach(function (k) {
      var ref = R.acc[k], n = normKey(k, S.draft[k]), st = storedOf(k), dirty = ready && dirtyKey(k)
      ref.input.disabled = !ready || S.saving
      var cls = 'info', label = 'Missing'
      if (!ready) { cls = 'info'; label = '…' }
      else if (!n.ok) { cls = 'error'; label = 'Not valid' }
      else if (dirty) { cls = 'warn'; label = 'Changed, not saved' }
      else if (st) { cls = 'ok'; label = 'Set' }
      else { cls = 'warn'; label = 'Missing' }
      ref.chip.className = 'ssoc-chip ssoc-chip--' + cls; ref.chip.textContent = label
      var serverErr = S.errs[k]
      var errText = !n.ok ? MSG['invalid_contact_' + k] : (serverErr ? MSG[serverErr] || '' : '')
      ref.err.textContent = errText; ref.err.hidden = !errText
      ref.input.setAttribute('aria-invalid', errText ? 'true' : 'false')
      var show = n.ok && n.value ? footerShow(k, n.value) : null
      if (show) { ref.text.textContent = 'Footer shows: ' + show.text + ' → ' + show.href; setOpenLink(ref.open, show.href) }
      else { ref.text.textContent = n.ok ? 'Not set: the footer keeps the link built into the page.' : 'Fix the value to see the link.'; setOpenLink(ref.open, '') }
    })
    // footer strip
    R.foot.textContent = ''
    var any = false
    SOCIAL_KEYS.forEach(function (k) {
      var n = normKey(k, S.draft[k]), show = n.ok && n.value ? footerShow(k, n.value) : null
      if (!show) return
      any = true
      var li = el('li'); add(li, el('span', 'ssoc-mono', k === 'whatsapp' ? 'WA' : netOf(k).mono), el('span', 'ssoc-ltr', show.text)); R.foot.appendChild(li)
    })
    if (!any) R.foot.appendChild(el('li', '', ready ? 'No account is set.' : '…'))
    // phone and e-mail
    R.contactBody.textContent = ''
    var c = S.doc && S.doc.contact || {}
    ;[['Phone', c.phone], ['E-mail', c.email]].forEach(function (x) {
      var box = el('div', 'ssoc-fld'); add(box, el('span', 'ssoc-flab', x[0]), el('p', 'ssoc-ltr', x[1] ? String(x[1]) : '(not set: the shop keeps its own)')); R.contactBody.appendChild(box)
    })
    R.saveBtn.disabled = !ready || S.saving
    R.saveBtn.textContent = S.saving ? 'Saving…' : 'Save accounts'
    R.discard.disabled = !ready || S.saving || !anyDirty()
    R.reload.disabled = S.saving || S.docState === 'loading'
  }

  // ------------------------------------------------------ product bar + studio
  function buildProdBar() {
    var bar = el('div', 'ssoc-card ssoc-card--soft')
    R.prodSel = el('select'); R.prodSel.name = 'ssoc_product'
    R.prodSel.addEventListener('change', guard(function () { S.sel = R.prodSel.value; S.img.photo = 0; regenAll(true); renderProdBar(); renderMaster(); renderVariants(); renderImage() }))
    R.prodQ = el('input'); R.prodQ.type = 'search'; R.prodQ.maxLength = 60; R.prodQ.name = 'ssoc_product_q'; R.prodQ.autocomplete = 'off'; R.prodQ.placeholder = 'Search by name'
    R.prodQ.addEventListener('input', guard(function () { fillProductSelect() }))
    R.langSeg = seg('Language', [['ar', 'العربية'], ['en', 'English']], function () { return S.lang }, function (v) { S.lang = v; renderMaster(); renderVariants(); renderImage() })
    R.prodState = el('p', 'ssoc-muted'); R.prodState.setAttribute('role', 'status')
    R.prodThumb = el('img', 'ssoc-thumb'); R.prodThumb.alt = ''; R.prodThumb.hidden = true
    R.prodThumb.addEventListener('error', function () { R.prodThumb.hidden = true })
    R.prodName = el('p', 'ssoc-prod-name'); R.prodMeta = el('p', 'ssoc-muted')
    var info = el('div', 'ssoc-prod-info'); add(info, R.prodName, R.prodMeta)
    var prod = el('div', 'ssoc-prod'); add(prod, R.prodThumb, info)
    var grid = el('div', 'ssoc-grid'); add(grid, fld('Find a product', R.prodQ), fld('Product', R.prodSel))
    var row = el('div', 'ssoc-acts'); row.style.alignItems = 'center'; add(row, el('span', 'ssoc-flab', 'Language'), R.langSeg)
    add(bar, grid, prod, R.prodState, row)
    R.prodBar = bar
    return bar
  }
  function fillProductSelect() {
    var q = clean(R.prodQ.value).toLowerCase(), list = (S.prods || []).filter(function (p) { return !q || (clean(p.name_en) + ' ' + clean(p.name_ar) + ' ' + p.slug).toLowerCase().indexOf(q) >= 0 })
    R.prodSel.textContent = ''
    list.forEach(function (p) { var o = el('option', '', clean(p.name_en || p.name_ar) + (p.name_ar && p.name_en ? ' — ' + clean(p.name_ar) : '')); o.value = String(p.id); R.prodSel.appendChild(o) })
    if (list.some(function (p) { return String(p.id) === S.sel })) R.prodSel.value = S.sel
    else if (list.length) { R.prodSel.value = String(list[0].id); if (S.sel !== R.prodSel.value) { S.sel = R.prodSel.value; S.img.photo = 0; regenAll(true); renderProdBar(); renderMaster(); renderVariants(); renderImage() } }
  }
  function renderProdBar() {
    if (!R.prodSel) return
    var st = S.prodState
    R.prodState.textContent = st === 'loading' ? 'Loading products…' : st === 'error' ? S.prodErr : st === 'ready' && !S.prods.length ? 'There are no active products yet. Add one in the Catalogue.' : ''
    fillProductSelect()
    var p = product()
    R.prodName.textContent = p ? clean(p.name_en || p.name_ar) + (p.name_ar && p.name_en ? ' · ' + clean(p.name_ar) : '') : ''
    var bits = []
    if (p) { var br = brandOf(p, S.brands); if (br[0]) bits.push(br[0]); if (p.category) bits.push(String(p.category)); var pr = priceOf(p); if (pr) bits.push('KWD ' + pr.text + (pr.onSale ? ' (sale)' : '')); bits.push(photosOf(p).length + ' photo' + (photosOf(p).length === 1 ? '' : 's')) }
    R.prodMeta.textContent = bits.join(' · ')
    var ph = p ? photosOf(p)[0] : ''
    if (ph) { R.prodThumb.hidden = false; if (R.prodThumb.getAttribute('src') !== ph) R.prodThumb.src = ph } else { R.prodThumb.hidden = true; R.prodThumb.removeAttribute('src') }
    R.langSeg.sync()
  }

  function buildStudio() {
    var pane = el('div', 'ssoc-pane'); pane.setAttribute('role', 'tabpanel')
    // options
    var opts = el('div', 'ssoc-card'); add(opts, el('h2', 'ssoc-h2', 'Caption options'))
    var g = el('div', 'ssoc-grid ssoc-grid--3')
    R.optStyle = select(STYLES.map(function (s) { return String(s[1]) }), function () { return String(S.opt.style) }, function (v) { S.opt.style = Number(v); onOpt() }, function (v) { for (var i = 0; i < STYLES.length; i++) if (String(STYLES[i][1]) === v) return STYLES[i][0]; return v })
    R.optSource = select(UTM.source, function () { return S.opt.source }, function (v) { S.opt.source = v; onOpt() })
    R.optMedium = select(UTM.medium, function () { return S.opt.medium }, function (v) { S.opt.medium = v; onOpt() })
    R.optCampaign = select(UTM.campaign, function () { return S.opt.campaign }, function (v) { S.opt.campaign = v; onOpt() })
    add(g, fld('Opening line', R.optStyle), fld('utm_source (caption link)', R.optSource), fld('utm_medium', R.optMedium), fld('utm_campaign', R.optCampaign))
    var cks = el('div', 'ssoc-checks')
    R.optPrice = check('Include the price', function () { return S.opt.price }, function (v) { S.opt.price = v; onOpt() })
    R.optDel = check('Delivery within 24 hours', function () { return S.opt.delivery }, function (v) { S.opt.delivery = v; onOpt() })
    R.optRet = check('Returns', function () { return S.opt.returns }, function (v) { S.opt.returns = v; onOpt() })
    R.optCod = check('Cash on delivery', function () { return S.opt.cod }, function (v) { S.opt.cod = v; onOpt() })
    add(cks, R.optPrice, R.optDel, R.optRet, R.optCod)
    add(opts, g, cks, el('p', 'ssoc-muted', 'No price is written unless “Include the price” is ticked. Then it is the product’s price in KWD with three decimals, taken from the product list, for display only.'))
    // master
    var master = el('div', 'ssoc-card')
    R.master = el('textarea'); R.master.name = 'ssoc_caption'; R.master.rows = 10; R.master.spellcheck = false
    R.master.addEventListener('input', guard(function () { var m = S.master[S.lang]; m.text = R.master.value; m.dirty = true; renderVariants() }))
    R.masterCount = el('span', 'ssoc-count'); R.masterDir = el('span', 'ssoc-muted', '')
    R.rebuild = btn('', 'Rebuild caption', function () { regenAll(true); renderMaster(); renderVariants(); setNote('The caption was rebuilt from the template.', false) })
    R.copyMaster = btn('ssoc-btn--primary', 'Copy caption', function () { copyText(S.master[S.lang].text, R.copyMaster) })
    var macts = el('div', 'ssoc-acts'); add(macts, R.copyMaster, R.rebuild)
    var link = el('div', 'ssoc-link'); R.linkIn = el('input'); R.linkIn.type = 'text'; R.linkIn.readOnly = true; R.linkIn.setAttribute('dir', 'ltr'); R.linkIn.name = 'ssoc_product_link'
    R.linkCopy = btn('ssoc-btn--small', 'Copy link', function () { copyText(R.linkIn.value, R.linkCopy) }); R.linkOpen = openLink('Open', '')
    add(link, R.linkIn, R.linkCopy, R.linkOpen)
    add(master, el('h2', 'ssoc-h2', 'Caption (edit it before you copy)'), fld('Caption', R.master, R.masterCount), macts, fld('Product link with UTM', link))
    // variants
    R.vars = {}
    var vcard = el('div', 'ssoc-card'); add(vcard, el('h2', 'ssoc-h2', 'One version for each platform'))
    PLATFORMS.forEach(function (pl) {
      var v = R.vars[pl.key] = {}, box = el('div', 'ssoc-var')
      v.count = el('span', 'ssoc-count'); v.ta = el('textarea'); v.ta.readOnly = true; v.ta.rows = pl.key === 'snapchat' ? 2 : 6; v.ta.name = 'ssoc_var_' + pl.key
      v.copy = btn('ssoc-btn--small', 'Copy for ' + pl.label, function () { copyText(v.ta.value, v.copy) })
      add(box, (function () { var h = el('div', 'ssoc-var-head'); add(h, el('span', 'ssoc-mono', pl.mono), el('span', 'ssoc-acc-name', pl.label), v.count); return h })(), v.ta)
      var acts = el('div', 'ssoc-acts'); acts.appendChild(v.copy)
      if (pl.key !== 'x') {
        v.link = el('input'); v.link.type = 'text'; v.link.readOnly = true; v.link.setAttribute('dir', 'ltr'); v.link.name = 'ssoc_link_' + pl.key
        v.linkCopy = btn('ssoc-btn--small', 'Copy link', function () { copyText(v.link.value, v.linkCopy) })
        var lw = el('div', 'ssoc-link'); add(lw, v.link, v.linkCopy)
        add(box, acts, fld(pl.key === 'snapchat' ? 'Link for the Snap' : 'Link for your bio', lw))
      } else add(box, acts)
      add(box, el('p', 'ssoc-muted', pl.note)); vcard.appendChild(box)
    })
    // whatsapp
    var wa = el('div', 'ssoc-card'); R.waIn = el('input'); R.waIn.type = 'text'; R.waIn.readOnly = true; R.waIn.setAttribute('dir', 'ltr'); R.waIn.name = 'ssoc_wa_link'
    R.waCopy = btn('ssoc-btn--small', 'Copy link', function () { copyText(R.waIn.value, R.waCopy) }); R.waOpen = openLink('Open in WhatsApp', '')
    var wl = el('div', 'ssoc-link'); add(wl, R.waIn, R.waCopy, R.waOpen)
    add(wa, el('h2', 'ssoc-h2', 'Share on WhatsApp'), fld('Share link (the caption, with a WhatsApp link)', wl), el('p', 'ssoc-muted', 'Opens WhatsApp with the caption ready to send to a chat or a status. Nothing is sent from here.'))
    add(pane, opts, master, vcard, wa)
    R.studioEmpty = el('p', 'ssoc-muted'); pane.insertBefore(R.studioEmpty, opts)
    return pane
  }
  function onOpt() { regenAll(false); renderMaster(); renderVariants() }
  function renderMaster() {
    if (!R.master) return
    var m = S.master[S.lang], ar = S.lang === 'ar'
    R.master.setAttribute('dir', ar ? 'rtl' : 'ltr'); R.master.setAttribute('lang', ar ? 'ar' : 'en')
    if (R.master.value !== m.text) R.master.value = m.text
    ;[R.optStyle, R.optSource, R.optMedium, R.optCampaign, R.optPrice, R.optDel, R.optRet, R.optCod].forEach(function (c) { c.sync && c.sync() })
    R.master.disabled = !product()
    R.rebuild.disabled = !product(); R.copyMaster.disabled = !product() || !m.text
  }
  function renderVariants() {
    if (!R.vars) return
    var p = product(), m = S.master[S.lang], mc = counter(len(m.text), 2200)
    R.masterCount.textContent = len(m.text) + ' characters'
    R.studioEmpty.textContent = p ? '' : (S.prodState === 'loading' ? 'Loading products…' : 'Choose a product above to build its captions.')
    var path = p ? productPath(p) : ''
    var own = p ? buildLink(path, S.lang, utmFor(S.opt.source)) : ''
    R.linkIn.value = own; setOpenLink(R.linkOpen, own); R.linkCopy.disabled = !own
    PLATFORMS.forEach(function (pl) {
      var v = R.vars[pl.key], link = p ? buildLink(path, S.lang, utmFor(pl.key)) : ''
      var text = p ? variant(pl.key, m.text, S.lang, link) : ''
      v.ta.value = text; v.ta.setAttribute('dir', S.lang === 'ar' ? 'rtl' : 'ltr')
      var c = counter(weighted(text, pl.key), pl.limit)
      v.count.textContent = c.text; v.count.className = 'ssoc-count ssoc-count--' + c.cls
      v.count.setAttribute('data-n', String(weighted(text, pl.key))); v.count.setAttribute('data-limit', String(pl.limit))
      v.copy.disabled = !text
      if (v.link) { v.link.value = link; v.linkCopy.disabled = !link }
    })
    var waLink = p ? buildLink(path, S.lang, utmFor('whatsapp')) : ''
    var waText = m.text ? (URL_RE.test(m.text) && waLink ? m.text.replace(URL_RE, waLink) : m.text) : ''
    var wa = waText ? 'https://wa.me/?text=' + encodeURIComponent(waText) : ''
    R.waIn.value = wa; setOpenLink(R.waOpen, wa); R.waCopy.disabled = !wa
  }
  function renderStudio() { renderMaster(); renderVariants() }

  // ---------------------------------------------------------------- share image
  function buildImage() {
    var pane = el('div', 'ssoc-pane'); pane.setAttribute('role', 'tabpanel')
    var opts = el('div', 'ssoc-card'); add(opts, el('h2', 'ssoc-h2', 'Share image'))
    var g = el('div', 'ssoc-grid')
    R.imgFmt = seg('Format', [['square', 'Post 1080 × 1080'], ['story', 'Story 1080 × 1920']], function () { return S.img.fmt }, function (v) { S.img.fmt = v; renderImage() })
    R.imgFit = seg('Photo fit', [['fit', 'Fit'], ['fill', 'Fill']], function () { return S.img.fit }, function (v) { S.img.fit = v; renderImage() })
    R.imgTheme = select(['light', 'dark', 'orange'], function () { return S.img.theme }, function (v) { S.img.theme = v; renderImage() }, function (v) { return { light: 'Light (beige)', dark: 'Charcoal', orange: 'Orange' }[v] })
    R.imgPhoto = select(['0'], function () { return String(S.img.photo) }, function (v) { S.img.photo = Number(v); renderImage() }, function (v) { return v === '-1' ? 'No photo' : 'Photo ' + (Number(v) + 1) })
    R.imgTheme.name = 'ssoc_img_theme'; R.imgPhoto.name = 'ssoc_img_photo'
    add(g, fld('Format', R.imgFmt), fld('Photo fit', R.imgFit), fld('Colours', R.imgTheme), fld('Photo', R.imgPhoto))
    var cks = el('div', 'ssoc-checks')
    R.imgPrice = check('Include the price', function () { return S.img.price }, function (v) { S.img.price = v; renderImage() })
    R.imgDel = check('Add the delivery line', function () { return S.img.delivery }, function (v) { S.img.delivery = v; renderImage() })
    add(cks, R.imgPrice, R.imgDel)
    add(opts, g, cks)
    var wrap = el('div', 'ssoc-canvas-wrap'); R.canvas = el('canvas', 'ssoc-canvas'); R.canvas.width = 1080; R.canvas.height = 1080
    R.canvas.setAttribute('role', 'img'); R.canvas.setAttribute('aria-label', 'Preview of the share image')
    R.imgInfo = el('p', 'ssoc-muted'); R.imgInfo.setAttribute('role', 'status')
    R.dl = btn('ssoc-btn--primary', 'Download PNG', downloadImage)
    add(wrap, R.canvas, R.imgInfo, R.dl)
    add(pane, opts, wrap, el('p', 'ssoc-muted', 'The picture is drawn in this browser from the product photo and the Sporta logo on this site. Nothing is uploaded. Photos from another address are never used.'))
    return pane
  }
  function syncPhotoSelect() {
    var p = product(), n = p ? photosOf(p).length : 0, vals = []
    for (var i = 0; i < n; i++) vals.push(String(i))
    vals.push('-1')
    R.imgPhoto.textContent = ''
    vals.forEach(function (v) { var o = el('option', '', v === '-1' ? 'No photo' : 'Photo ' + (Number(v) + 1)); o.value = v; R.imgPhoto.appendChild(o) })
    if (S.img.photo > n - 1) S.img.photo = n ? 0 : -1
    R.imgPhoto.value = String(S.img.photo)
  }
  function renderImage() { if (!R.imgPhoto) return; syncPhotoSelect(); R.imgFmt.sync(); R.imgFit.sync(); R.imgTheme.sync(); R.imgPrice.sync(); R.imgDel.sync(); renderImageDraw() }

  // ----------------------------------------------------------------- link builder
  function buildLinks() {
    var pane = el('div', 'ssoc-pane'); pane.setAttribute('role', 'tabpanel')
    var card = el('div', 'ssoc-card'); add(card, el('h2', 'ssoc-h2', 'Link builder'))
    R.lbPath = el('input'); R.lbPath.type = 'text'; R.lbPath.name = 'ssoc_lb_path'; R.lbPath.maxLength = 300; R.lbPath.value = S.lb.path; R.lbPath.setAttribute('dir', 'ltr'); R.lbPath.autocomplete = 'off'
    R.lbPath.addEventListener('input', guard(function () { S.lb.path = R.lbPath.value; renderLinks() }))
    var picks = el('div', 'ssoc-acts')
    ;[['Home', '/'], ['Shop', '/shop'], ['Sporta Outlet', '/shop?sale=1'], ['About', '/about'], ['Contact', '/contact'], ['Returns', '/returns']].forEach(function (x) {
      picks.appendChild(btn('ssoc-btn--small', x[0], function () { S.lb.path = x[1]; R.lbPath.value = x[1]; renderLinks() }))
    })
    var g = el('div', 'ssoc-grid ssoc-grid--3')
    function picker(label, list, key, ctrlKey) {
      var s = select(list.concat(['__custom__']), function () { return S.lb[ctrlKey] }, function (v) { S.lb[ctrlKey] = v; renderLinks() }, function (v) { return v === '__custom__' ? 'Other…' : v })
      var t = el('input'); t.type = 'text'; t.maxLength = 40; t.name = 'ssoc_lb_' + key + '_custom'; t.placeholder = 'letters, digits, - and _'; t.setAttribute('dir', 'ltr'); t.hidden = true
      t.addEventListener('input', guard(function () { S.lb[key + 'Custom'] = t.value; renderLinks() }))
      var wrap = el('div', 'ssoc-fld'); add(wrap, s, t); wrap.sel = s; wrap.txt = t
      return wrap
    }
    R.lbSource = picker('Source', UTM.source, 'source', 'source'); R.lbMedium = picker('Medium', UTM.medium, 'medium', 'medium'); R.lbCampaign = picker('Campaign', UTM.campaign, 'campaign', 'campaign')
    R.lbContent = el('input'); R.lbContent.type = 'text'; R.lbContent.maxLength = 40; R.lbContent.name = 'ssoc_lb_content'; R.lbContent.placeholder = 'optional, e.g. story_1'; R.lbContent.setAttribute('dir', 'ltr')
    R.lbContent.addEventListener('input', guard(function () { S.lb.content = R.lbContent.value; renderLinks() }))
    add(g, fld('utm_source', R.lbSource), fld('utm_medium', R.lbMedium), fld('utm_campaign', R.lbCampaign), fld('utm_content', R.lbContent))
    R.lbErr = el('p', 'ssoc-err'); R.lbErr.setAttribute('role', 'alert'); R.lbErr.hidden = true
    add(card, fld('Page on the shop (a path, or an address on www.sporta.com.kw)', R.lbPath), picks, g, R.lbErr)
    var out = el('div', 'ssoc-card'); add(out, el('h2', 'ssoc-h2', 'Your links'))
    R.lbOut = {}
    ;[['ar', 'Arabic (bare path)'], ['en', 'English (?lang=en)']].forEach(function (x) {
      var row = el('div', 'ssoc-link'), i = el('input'); i.type = 'text'; i.readOnly = true; i.setAttribute('dir', 'ltr'); i.name = 'ssoc_lb_out_' + x[0]
      var c = btn('ssoc-btn--small', 'Copy', function () { copyText(i.value, c) }), o = openLink('Open', '')
      add(row, i, c, o); add(out, fld(x[1], row)); R.lbOut[x[0]] = { input: i, copy: c, open: o }
    })
    add(out, el('p', 'ssoc-muted', 'Lower case, no spaces: “New Arrivals” becomes new_arrivals. A QR code is not made here (it would need a script library); paste the link into your phone’s share sheet or a QR tool.'))
    add(pane, card, out)
    return pane
  }
  function lbVal(key) { var v = S.lb[key]; return v === '__custom__' ? utmValue(S.lb[key + 'Custom']) : utmValue(v) }
  function renderLinks() {
    if (!R.lbOut) return
    ;[['source', R.lbSource], ['medium', R.lbMedium], ['campaign', R.lbCampaign]].forEach(function (x) { x[1].sel.value = S.lb[x[0]]; x[1].txt.hidden = S.lb[x[0]] !== '__custom__' })
    var path = cleanPath(S.lb.path), u = { source: lbVal('source'), medium: lbVal('medium'), campaign: lbVal('campaign'), content: S.lb.content }
    var missing = ['source', 'medium', 'campaign'].filter(function (k) { return !u[k] })
    var err = !path ? 'That is not a page of the shop. Use a path that starts with / (for example /shop?sale=1), or an address on ' + ORIGIN + '.' : missing.length ? 'utm_' + missing.join(', utm_') + ' is empty or has no usable characters.' : ''
    R.lbErr.textContent = err; R.lbErr.hidden = !err
    R.lbPath.setAttribute('aria-invalid', !path ? 'true' : 'false')
    ;['ar', 'en'].forEach(function (l) {
      var link = err ? '' : buildLink(path, l, u), o = R.lbOut[l]
      o.input.value = link; o.copy.disabled = !link; setOpenLink(o.open, link)
    })
  }

  // ----------------------------------------------------------------- checks
  function buildChecks() {
    var pane = el('div', 'ssoc-pane'); pane.setAttribute('role', 'tabpanel')
    var card = el('div', 'ssoc-card'); add(card, el('h2', 'ssoc-h2', 'Checks'))
    R.runChecks = btn('ssoc-btn--primary', 'Run the checks', runChecks)
    R.checksNote = el('p', 'ssoc-muted'); R.checksNote.setAttribute('role', 'status')
    R.checkList = el('ul', 'ssoc-checklist')
    add(card, el('p', 'ssoc-muted', 'Reads this shop’s own pages (home, one product, robots.txt, the footer) with ordinary page requests. Nothing is changed and nothing is sent anywhere else.'), (function () { var a = el('div', 'ssoc-acts'); a.appendChild(R.runChecks); return a })(), R.checksNote, R.checkList)
    pane.appendChild(card)
    return pane
  }
  function renderChecks() {
    if (!R.checkList) return
    R.runChecks.disabled = S.checksBusy
    R.runChecks.textContent = S.checksBusy ? 'Checking…' : S.checks ? 'Run again' : 'Run the checks'
    R.checkList.textContent = ''
    if (S.checksBusy) { R.checksNote.textContent = 'Checking the pages, the picture and the footer. This takes a few seconds…'; return }
    if (!S.checks) { R.checksNote.textContent = ''; return }
    var c = { pass: 0, warn: 0, fail: 0, skip: 0 }
    S.checks.forEach(function (x) { c[x.state]++ })
    R.checksNote.textContent = c.pass + ' passed, ' + c.warn + ' to look at, ' + c.fail + ' failed' + (c.skip ? ', ' + c.skip + ' skipped' : '') + '.'
    S.checks.forEach(function (x) {
      var li = el('li', 'ssoc-item ssoc-item--' + x.state); li.setAttribute('data-id', x.id); li.setAttribute('data-state', x.state)
      var body = el('div', 'ssoc-item-body'), head = el('div', 'ssoc-item-head')
      add(head, el('span', '', x.title), el('span', 'ssoc-item-state', { pass: 'Passed', warn: 'Look at this', fail: 'Failed', skip: 'Skipped' }[x.state]))
      add(body, head, el('p', '', x.detail)); if (x.advice && x.state !== 'pass') body.appendChild(el('p', 'ssoc-item-advice', x.advice))
      add(li, el('span', 'ssoc-mark', { pass: '✓', warn: '!', fail: '✕', skip: '–' }[x.state]), body); R.checkList.appendChild(li)
    })
  }

  // -------------------------------------------------------- not built yet
  function buildNeeds() {
    var pane = el('div', 'ssoc-pane'); pane.setAttribute('role', 'tabpanel')
    var card = el('div', 'ssoc-card'); add(card, el('h2', 'ssoc-h2', 'Needs a shop-server release (not built, not faked)'))
    var ul = el('ul', 'ssoc-needs')
    function item(title, text, code) { var li = el('li'); add(li, el('h3', '', title), el('p', 'ssoc-muted', text)); if (code) li.appendChild(el('pre', 'ssoc-code', code)); ul.appendChild(li) }
    item('Facebook, YouTube, Telegram, Threads accounts',
      'The server keeps nine contact keys and refuses any other (STORE_CONTENT_CONTACT_KEYS). Smallest additive change, no migration, no new route: add the four keys to that list, one row each to the $rules table of store_content_social(), the same four to the SOCIAL table of sporta-features.js and to the CONTACT list of the Site content editor, and the four footer links to the storefront build. This panel then lists them with no further change.',
      'facebook : facebook.com | www.facebook.com   /^\\/([A-Za-z0-9.]{5,50})\\/?$/        https://www.facebook.com/%s\nyoutube  : youtube.com  | www.youtube.com    /^\\/@([A-Za-z0-9._-]{3,30})\\/?$/     https://www.youtube.com/@%s\ntelegram : t.me                              /^\\/([A-Za-z0-9_]{5,32})\\/?$/        https://t.me/%s\nthreads  : threads.net  | www.threads.net    /^\\/@([A-Za-z0-9._]{1,30})\\/?$/      https://www.threads.net/@%s')
    item('Content calendar and scheduling',
      'A calendar must be shared by everyone who opens the admin, so it cannot live in this browser. It needs one settings row and two routes written like site_content (a version number, a size cap, every field whitelisted). Nothing would post by itself: it is a plan and a reminder, the posts are still published by hand.',
      'settings.social_calendar = { v, items: [ { id, date: "2026-11-20", platform: "instagram",\n  product_id: 12, lang: "ar", caption: "...", status: "planned" | "posted" } ] }   (max 200 items, 60,000 bytes)\nGET  social_calendar         -> the row\nPOST social_calendar_save    { v, items[] }  (409 content_changed on a stale v, like content_save)')
    item('Posting straight to the platforms', 'Needs an access token for each platform, kept in the server configuration and never in the browser. Not planned: the copy-and-share flow here needs nothing to be kept.')
    item('Clicks and orders per campaign', 'The UTM links in this panel are read by the shop’s analytics, not by the admin. Showing them here would need the shop server to store the utm_* values with each order.')
    item('Category links', 'The storefront has no address for a single category that is confirmed on the live build; the link builder takes any path you give it. Add quick links once the live address is known.')
    add(card, ul); pane.appendChild(card)
    return pane
  }

  // ------------------------------------------------------------------- panel
  var TABS = [['accounts', 'Accounts'], ['studio', 'Post studio'], ['image', 'Share image'], ['links', 'Link builder'], ['checks', 'Checks'], ['needs', 'Not built yet']]
  function build() {
    var sec = el('section', 'admin-page ssoc'); sec.setAttribute(PAGE, ''); sec.setAttribute('aria-labelledby', 'ssoc-title'); sec.hidden = true
    var wrap = el('div', 'ssoc-wrap admin-page-layout')
    var head = el('header', 'ssoc-head'), left = el('div')
    R.h1 = el('h1', 'ssoc-title', 'Social center'); R.h1.id = 'ssoc-title'; R.h1.tabIndex = -1
    add(left, R.h1, el('p', 'ssoc-lead', 'The shop’s social accounts, captions, share pictures and links in one place. Everything here is a draft for you to copy: nothing is posted for you.'))
    R.back = btn('', '← Back', function () { closePanel(true) })
    add(head, left, R.back)
    R.status = el('p', 'ssoc-status'); R.status.setAttribute('role', 'status'); R.status.setAttribute('aria-live', 'polite')
    R.tabs = el('div', 'ssoc-tabs'); R.tabs.setAttribute('role', 'tablist'); R.tabs.setAttribute('aria-label', 'Social center')
    R.tabBtn = {}
    TABS.forEach(function (t) {
      var b = el('button', 'ssoc-tab', t[1]); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('data-tab', t[0]); b.id = 'ssoc-tab-' + t[0]
      b.addEventListener('click', guard(function () { showTab(t[0]) }))
      b.addEventListener('keydown', function (e) {
        var i = TABS.map(function (x) { return x[0] }).indexOf(t[0]), n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        if (document.documentElement.getAttribute('dir') === 'rtl' || (document.querySelector('.admin-shell') && document.querySelector('.admin-shell').getAttribute('dir') === 'rtl')) n = -n
        if (!n) return
        e.preventDefault(); var nx = TABS[(i + n + TABS.length) % TABS.length][0]; showTab(nx); R.tabBtn[nx].focus()
      })
      R.tabBtn[t[0]] = b; R.tabs.appendChild(b)
    })
    R.panes = { accounts: buildAccounts(), studio: buildStudio(), image: buildImage(), links: buildLinks(), checks: buildChecks(), needs: buildNeeds() }
    R.prodBar = buildProdBar()
    add(wrap, head, R.status, R.tabs, R.prodBar)
    TABS.forEach(function (t) { var p = R.panes[t[0]]; p.setAttribute('aria-labelledby', 'ssoc-tab-' + t[0]); p.hidden = true; wrap.appendChild(p) })
    sec.appendChild(wrap)
    return sec
  }
  function showTab(k) {
    S.tab = k
    TABS.forEach(function (t) {
      var on = t[0] === k
      R.panes[t[0]].hidden = !on
      R.tabBtn[t[0]].setAttribute('aria-selected', on ? 'true' : 'false'); R.tabBtn[t[0]].tabIndex = on ? 0 : -1
    })
    R.prodBar.hidden = !(k === 'studio' || k === 'image')
    if (k === 'accounts') { if (S.docState === 'idle') loadDoc(false).then(function () { syncInputs(); renderAccounts(); checkApply() }); else { syncInputs(); renderAccounts() } }
    if (k === 'studio' || k === 'image') {
      if (S.docState === 'idle') loadDoc(false).then(function () { syncInputs(); renderAccounts() })
      if (S.prodState === 'idle') loadProducts(); else { renderProdBar(); renderStudio(); renderImage() }
    }
    if (k === 'links') { R.lbPath.value = S.lb.path; renderLinks() }
    if (k === 'checks') renderChecks()
  }
  function mount() {
    var main = document.querySelector('main.admin-content')
    if (!main) return false
    ensureStyle()
    if (!panel) panel = build()
    if (panel.parentNode !== main) main.appendChild(panel)
    return true
  }
  function openPanel() {
    if (S.open) return
    if (!mount()) return
    S.open = true
    panel.hidden = false
    document.body.setAttribute(OPEN, 'open')
    setNote('', false)
    showTab(S.tab)
    try { R.h1.focus({ preventScroll: true }) } catch (e) { /* focus is a courtesy */ }
  }
  function closePanel(focusBack) {
    if (!S.open) return
    S.open = false
    if (panel) panel.hidden = true
    document.body.removeAttribute(OPEN)
    if (focusBack) { var b = document.querySelector('[' + BTN + ']'); if (b) { try { b.focus() } catch (e) { /* courtesy */ } } }
  }

  // ------------------------------------------------------------------- entry
  var HEADS = ['Settings', 'الإعدادات']
  function entryHead() {
    var hs = document.querySelectorAll('main.admin-content .admin-page h1'), i
    for (i = 0; i < hs.length; i++) {
      if (HEADS.indexOf(clean(hs[i].textContent)) >= 0 && shown(hs[i])) { var h = hs[i].closest('.admin-page-header'); if (h) return { head: h, below: false } }
    }
    var sc = document.querySelector('section[data-sporta-content]:not([hidden]) form > header')
    if (sc && shown(sc)) return { head: sc, below: true }
    return null
  }
  function ensure() {
    var have = document.querySelector('[' + BTN + ']')
    if (S.open) { if (!have || !have.isConnected || !panel || !panel.isConnected) closePanel(false); return }
    var where = entryHead()
    if (!where) { if (have) have.remove(); return }
    ensureStyle()
    if (have && where.head.contains(have)) return
    if (have) have.remove()
    var b = el('button', 'ssoc-open' + (where.below ? ' ssoc-open--below' : ''), 'Social center'); b.type = 'button'; b.setAttribute(BTN, '1')
    b.setAttribute('aria-label', 'Social center: accounts, captions, share pictures and links')
    b.addEventListener('click', guard(openPanel))
    where.head.appendChild(b)
  }
  // any click on the menu leaves the panel before React handles it
  document.addEventListener('click', function (ev) {
    if (!S.open) return
    var t = ev.target && ev.target.closest ? ev.target.closest(NAV) : null
    if (t) closePanel(false)
  }, true)

  try {
    Object.defineProperty(window, '__sportaSocial', { value: { version: 1, normSocial: normSocial, normWhatsapp: normWhatsapp, buildLink: buildLink, cleanPath: cleanPath, utmValue: utmValue, caption: caption, variant: variant, weighted: weighted, priceOf: priceOf, robotsAllows: robotsAllows, footerShow: footerShow, UTM: UTM, PLATFORMS: PLATFORMS, NETS: NETS }, enumerable: false, configurable: false })
  } catch (e) { return }
  function start() {
    setInterval(function () { if (document.hidden) return; try { ensure() } catch (e) { /* the page keeps working without it */ } }, 500)   // a hidden tab has nobody to add a button for
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN SOCIAL CENTER - end ========================================== */
/* ===== ADMIN DATABASE CENTER - begin =======================================
 * 13. Database center (owner request 2026-11-11: "make backends center database").
 *
 * ONE button, "Database center", in the header of the Settings screen. It opens a read-only panel (a section in
 * <main>; the screen behind it is hidden by CSS while it is open, "Back" or any click on the menu closes it) with five
 * tabs:
 *
 *   1. OVERVIEW   tables, rows, size, migrations applied, backup, server health and integrity as seven cards, the exact
 *      counts of the tables the shop is made of, and one list of what needs attention.
 *   2. TABLES     every table of the database with an estimated row count, size (data + indexes), engine, and whether
 *      it is one of this shop's tables or something else (the old build). Filter by name; sort by name, rows or size.
 *   3. SCHEMA     every migration file of the repo and whether this database carries it (applied / partial / missing,
 *      with the names that are missing), tables the repo expects and the database lacks, tables the repo does not know.
 *      Presence only: a changed type or default is the job of scripts/db-schema-diff.mjs.
 *   4. HEALTH     the newest verified backup and its age; connections in use, statements running, slow statements,
 *      lock waits, deadlocks, the longest running statement; each judged ok / watch / problem / unknown.
 *   5. INTEGRITY  thirteen checks run on demand: order lines with no order or product, sizes with negative stock or no
 *      product, stock against the last stock movement, a paid order whose stock was put back, unpaid orders still
 *      holding stock, warehouse messages unsent or missing. Counts only; never a row.
 *
 * Reads: GET db_center, GET db_integrity (dropin/php-store/dbcenter.php). Writes to the shop's data: NOTHING, ever: this
 * block has no POST, no form, no storage and no request to another host. The server's throttle for these two reads does
 * write its own rate-limit counter (rate_limit table, a few rows), which is the only write a visit causes. Every request carries the session cookie and X-Sporta-Admin, like
 * the admin's own. The server sends counts, table and column names, sizes and a few server numbers; no host, user,
 * password, database name, file path or SQL. Built with createElement + textContent, never as markup.
 *
 * The entry is added by a half-second check (skipped while the tab is hidden) and removed when the screen goes (React's
 * nodes are never removed, moved or retexted). Starts on /backends only; idempotent; every handler is wrapped so an error
 * here cannot stop the admin. Nothing is polled while the panel is closed or shut: a screen is read when it is opened
 * and when "Refresh" is pressed.
 */
;(function () {   // leading ; - the block above ends in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaDbCenter) return

  var API = '/api/admin.php'
  var PAGE = 'data-sporta-dbc'               // the section
  var BTN = 'data-sporta-dbc-btn'            // the entry button
  var OPEN = 'data-sporta-dbc-state'         // on <body>: "open"
  var NAV = '.admin-sidebar .admin-nav-item, .m-tabbar__item, .m-menu-item, .m-header__menu'
  var HEADS = ['Settings', 'الإعدادات']
  var TABS = [['overview', 'Overview · نظرة عامة'], ['tables', 'Tables · الجداول'], ['schema', 'Schema · البنية'], ['health', 'Health · الحالة'], ['integrity', 'Integrity · السلامة']]
  var STATE_LABEL = { ok: 'OK · سليم', pass: 'OK · سليم', warn: 'Watch · للمراقبة', fail: 'Problem · مشكلة', info: 'Note · ملاحظة', unknown: 'Unknown · غير معروف', skip: 'Not checked · لم يُفحص', applied: 'Applied · مطبّق', partial: 'Partial · جزئي', missing: 'Missing · ناقص' }
  var CHIP = { ok: 'ok', pass: 'ok', applied: 'ok', warn: 'warn', partial: 'warn', fail: 'error', missing: 'error', info: 'info', unknown: 'info', skip: 'info' }
  var BACKUP_LABEL = { ok: ['ok', 'Backed up'], stale: ['warn', 'Backup is old'], failing: ['error', 'Last backup failed'], never: ['error', 'No backup yet'], not_reported: ['info', 'Not reported'] }
  var COUNT_LABEL = { orders: 'Orders', order_items: 'Order lines', products: 'Products', product_variants: 'Sizes (stock rows)', inventory_movements: 'Stock movements', customer_accounts: 'Customer accounts', fulfilment_outbox: 'Warehouse messages' }
  var MSG = {
    not_signed_in: 'Your sign-in has ended. Sign in again, then reopen this screen. · انتهت جلسة الدخول. سجّل الدخول مرة أخرى ثم أعد فتح هذه الشاشة.',
    bad_request: 'The request was refused. Reload the page and try again. · رُفض الطلب. أعد تحميل الصفحة وحاول مرة أخرى.',
    db_center_unavailable: 'The database did not answer. Try again in a minute. · لم ترد قاعدة البيانات. حاول مرة أخرى بعد دقيقة.',
    method_not_allowed: 'The server refused the request. · رفض الخادم الطلب.'
  }
  var NOT_YET = 'The Database center is not available until the next update of the shop server. Nothing is wrong with your account.'

  // ----------------------------------------------------------------- helpers
  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    if (tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'li' || cls === 'sdb-flab') n.setAttribute('dir', 'auto')   // English words: each line takes its own direction in an Arabic (RTL) admin
    return n
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild) }
  function clean(s) { return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim() }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0 }
  function intText(v) { var n = Math.round(num(v)), s = String(Math.abs(n)), out = '', i; for (i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 === 0) out += ','; out += s.charAt(i) } return (n < 0 ? '-' : '') + out }
  function bytesText(b) {
    b = num(b)
    if (b < 1024) return intText(b) + ' B'
    if (b < 1048576) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB'
    if (b < 1073741824) return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB'
    return (b / 1073741824).toFixed(2) + ' GB'
  }
  function shown(e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  function token(b) { var e = b && b.error; return typeof e === 'string' && /^[a-z_]{1,60}$/.test(e) ? e : '' }
  function stateOf(v) { return Object.prototype.hasOwnProperty.call(CHIP, v) ? v : 'unknown' }
  function when(iso) {
    var d = new Date(String(iso || ''))
    if (isNaN(d.getTime())) return ''
    try { return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' }
  }
  function guard(fn) { return function () { try { return fn.apply(this, arguments) } catch (e) { try { setNote('Something went wrong in the Database center: ' + String(e && e.message || e).slice(0, 120), true) } catch (x) { /* the admin keeps working */ } } } }

  function request(route) {
    return fetch(API + '?r=' + route, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-Sporta-Admin': '1' } }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, body: j, retryAfter: r.headers.get('Retry-After') } })
    }).catch(function () { return { ok: false, status: 0, body: null, retryAfter: null } })
  }
  function failText(r) {
    var code = token(r.body)
    if (r.status === 0) return 'Could not reach the server. Check the connection and try again.'
    if (r.status === 401) return MSG.not_signed_in
    if (r.status === 404) return NOT_YET
    if (r.status === 429) return 'Too many requests. Wait ' + (r.retryAfter && /^\d{1,4}$/.test(r.retryAfter) ? r.retryAfter + ' seconds' : 'a minute') + ', then try again.'
    if (MSG[code]) return MSG[code]
    return 'The server could not do that (' + (code || 'HTTP ' + r.status) + ').'
  }

  // ------------------------------------------------------------------- state
  var S = { open: false, tab: 'overview', db: 'idle', data: null, dbErr: '', ig: 'idle', igData: null, igErr: '', filter: '', sort: 'size', dir: -1, seq: 0, igSeq: 0 }
  var R = {}               // the panel's nodes
  var panel = null, styleEl = null

  function setNote(text, bad) {
    if (!R.status) return
    R.status.textContent = text || ''
    if (bad) R.status.setAttribute('data-bad', '1'); else R.status.removeAttribute('data-bad')
  }

  // ------------------------------------------------------------- UI pieces
  function btn(cls, text, fn) { var b = el('button', 'sdb-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; if (fn) b.addEventListener('click', guard(fn)); return b }
  function chip(state, text) { var s = stateOf(state); return el('span', 'sdb-chip sdb-chip--' + CHIP[s], text || STATE_LABEL[s]) }
  function card(title) { var c = el('section', 'sdb-card'); if (title) c.appendChild(el('h2', 'sdb-h2', title)); return c }
  function kv(label, value) { var d = el('div', 'sdb-kv'); add(d, el('span', 'sdb-kv-k', label), el('span', 'sdb-kv-v', value)); return d }
  function stat(label, value, sub, state, text) {
    var c = el('div', 'sdb-stat')
    var h = el('div', 'sdb-stat-head'); add(h, el('span', 'sdb-stat-label', label)); if (state) h.appendChild(chip(state, text))
    add(c, h, el('div', 'sdb-stat-value', value))
    if (sub) c.appendChild(el('p', 'sdb-stat-sub', sub))
    return c
  }

  // ----------------------------------------------------------------- loaders
  function loadDb(force) {
    if (S.db === 'loading') return Promise.resolve()
    if (S.db === 'ready' && !force) return Promise.resolve()
    var seq = ++S.seq
    S.db = 'loading'; S.dbErr = ''; renderAll()
    return request('db_center').then(function (r) {
      if (seq !== S.seq) return
      if (r.ok && r.body && Array.isArray(r.body.tables)) { S.data = r.body; S.db = 'ready'; S.dbErr = '' }
      else { S.db = 'error'; S.dbErr = failText(r) }
      renderAll()
    })
  }
  function loadIntegrity() {
    if (S.ig === 'loading') return Promise.resolve()
    var seq = ++S.igSeq
    S.ig = 'loading'; S.igErr = ''; renderAll()
    return request('db_integrity').then(function (r) {
      if (seq !== S.igSeq) return
      if (r.ok && r.body && Array.isArray(r.body.checks)) { S.igData = r.body; S.ig = 'ready'; S.igErr = '' }
      else { S.ig = 'error'; S.igErr = failText(r) }
      renderAll()
    })
  }

  // ------------------------------------------------------------- derivations
  function worstOf(list, key) {
    var rank = { fail: 3, warn: 2, unknown: 1, ok: 0, pass: 0, info: 0 }, w = 'ok', i, v
    for (i = 0; i < list.length; i++) { v = stateOf(list[i][key]); if ((rank[v] || 0) > (rank[w] || 0)) w = v }
    return w
  }
  function attention(d) {
    var out = [], sc = d.schema || {}, bk = d.backup || {}, hl = (d.health && d.health.indicators) || []
    ;(sc.migrations || []).forEach(function (m) {
      if (m.status === 'applied') return
      out.push({ state: m.status === 'missing' ? 'fail' : 'warn', text: 'Migration ' + clean(m.file) + ' is ' + stateOf(m.status) + ' on this database (' + intText(m.missing_count) + ' name' + (num(m.missing_count) === 1 ? '' : 's') + ' missing).', tab: 'schema' })
    })
    if ((sc.missing_tables || []).length) out.push({ state: 'fail', text: 'Tables the shop expects and the database lacks: ' + sc.missing_tables.map(clean).slice(0, 6).join(', ') + (sc.missing_tables.length > 6 ? ', …' : ''), tab: 'schema' })
    if (bk.state === 'stale') out.push({ state: 'warn', text: 'The newest verified backup is ' + intText(bk.age_hours) + ' hours old.', tab: 'health' })
    else if (bk.state === 'failing') out.push({ state: 'fail', text: 'The last backup run failed.', tab: 'health' })
    else if (bk.state === 'never') out.push({ state: 'fail', text: 'No verified backup has been reported yet.', tab: 'health' })
    else if (bk.state !== 'ok') out.push({ state: 'warn', text: 'The backup state is not reported to the shop, so it cannot be confirmed here.', tab: 'health' })
    hl.forEach(function (h) { if (h.status === 'warn' || h.status === 'fail') out.push({ state: h.status, text: clean(h.label) + ': ' + clean(h.value) + (h.unit ? ' ' + clean(h.unit) : '') + '.', tab: 'health' }) })
    if (S.igData) (S.igData.checks || []).forEach(function (c) { if (c.status === 'warn' || c.status === 'fail') out.push({ state: c.status, text: clean(c.label) + ': ' + intText(c.count) + '.', tab: 'integrity' }) })
    return out
  }

  // ------------------------------------------------------------------ panes
  function buildPane(name) { var p = el('div', 'sdb-pane'); p.setAttribute('role', 'tabpanel'); p.setAttribute('data-pane', name); return p }
  function loadingCard(pane, what) { clear(pane); var c = card(); c.appendChild(el('p', 'sdb-muted', what || 'Reading the database…')); pane.appendChild(c) }
  function errorCard(pane, text, again) {
    clear(pane)
    var c = el('div', 'sdb-banner'); c.setAttribute('data-state', 'error'); c.setAttribute('role', 'alert')
    add(c, el('p', '', text), btn('sdb-btn--small', 'Try again', again))
    pane.appendChild(c)
  }

  function renderOverview() {
    var p = R.panes.overview
    if (S.db === 'loading' && !S.data) return loadingCard(p)
    if (S.db === 'error' && !S.data) return errorCard(p, S.dbErr, function () { loadDb(true) })
    if (!S.data) return loadingCard(p)
    var d = S.data, t = d.totals || {}, sc = d.schema || {}, bk = d.backup || {}, hl = (d.health && d.health.indicators) || []
    clear(p)
    var grid = el('div', 'sdb-stats')
    var migState = sc.migrations_total ? (num(sc.migrations_applied) === num(sc.migrations_total) && !(sc.missing_tables || []).length ? 'ok' : (sc.migrations || []).some(function (m) { return m.status === 'missing' }) || (sc.missing_tables || []).length ? 'fail' : 'warn') : 'unknown'
    var b = BACKUP_LABEL[bk.state] || BACKUP_LABEL.not_reported
    add(grid,
      stat('Tables', intText(t.tables), intText(sc.repo_tables) + ' are the shop\'s own' + (num(sc.other_tables) ? ', ' + intText(sc.other_tables) + ' other' : '')),
      stat('Rows (estimate)', intText(t.rows_estimate), 'The database\'s own estimate; exact counts are below.'),
      stat('Size', bytesText(t.bytes), 'Data and indexes of every table.'),
      stat('Migrations', intText(sc.migrations_applied) + ' of ' + intText(sc.migrations_total), 'Repo migration files carried by this database.', migState),
      stat('Backup', bk.age_hours != null ? intText(bk.age_hours) + ' h' : '—', bk.age_hours != null ? 'Since the newest verified backup.' : 'The shop does not see the backup folder.', b[0] === 'ok' ? 'ok' : b[0] === 'error' ? 'fail' : b[0] === 'warn' ? 'warn' : 'unknown', b[1]),
      stat('Server health', hl.length ? String(hl.filter(function (h) { return h.status === 'ok' || h.status === 'info' }).length) + ' of ' + String(hl.length) + ' fine' : '—', hl.length ? 'Connections, slow statements, locks.' : 'The server did not report its status.', hl.length ? worstOf(hl.map(function (h) { return { s: h.status } }), 's') : 'unknown'),
      stat('Integrity', S.igData ? (S.igData.overall === 'pass' ? 'Clean' : S.igData.overall === 'unknown' ? 'Unclear' : 'Needs a look') : 'Not run', S.igData ? 'Last run ' + when(S.igData.generated_at) : 'Open the Integrity tab and press Run.', S.igData ? S.igData.overall : 'info', S.igData ? null : 'Not run'))
    p.appendChild(grid)
    var att = attention(d), c1 = card('Needs attention')
    if (!att.length) c1.appendChild(el('p', 'sdb-muted', 'Nothing needs attention in what has been read.'))
    else {
      var ul = el('ul', 'sdb-list')
      att.slice(0, 20).forEach(function (a) {
        var li = el('li', 'sdb-row'); add(li, chip(a.state), el('span', 'sdb-row-text', a.text))
        var go = btn('sdb-btn--small sdb-btn--quiet', 'Open', function () { showTab(a.tab) }); li.appendChild(go)
        ul.appendChild(li)
      })
      c1.appendChild(ul)
    }
    p.appendChild(c1)
    var c2 = card('Exact counts'), g2 = el('div', 'sdb-kvs'), counts = d.counts || {}
    Object.keys(COUNT_LABEL).forEach(function (k) { if (k in counts) g2.appendChild(kv(COUNT_LABEL[k], counts[k] == null ? 'not available' : intText(counts[k]))) })
    c2.appendChild(g2)
    var sv = d.server || {}
    c2.appendChild(el('p', 'sdb-muted', 'Server ' + (clean(sv.version) || 'unknown') + (sv.charset ? ' · ' + clean(sv.charset) : '') + ' · read ' + (when(d.generated_at) || 'just now')))
    p.appendChild(c2)
  }

  function tablesView() {
    var d = S.data, rows = ((d && d.tables) || []).slice(), f = S.filter.toLowerCase()
    if (f) rows = rows.filter(function (r) { return String(r.name).toLowerCase().indexOf(f) >= 0 })
    var key = S.sort, dir = S.dir
    rows.sort(function (a, b) {
      var x = key === 'name' ? String(a.name) : key === 'rows' ? num(a.rows_estimate) : num(a.total_bytes)
      var y = key === 'name' ? String(b.name) : key === 'rows' ? num(b.rows_estimate) : num(b.total_bytes)
      return (x < y ? -1 : x > y ? 1 : String(a.name) < String(b.name) ? -1 : 1) * dir
    })
    return rows
  }
  function renderTables() {
    var p = R.panes.tables
    if (S.db === 'loading' && !S.data) return loadingCard(p)
    if (S.db === 'error' && !S.data) return errorCard(p, S.dbErr, function () { loadDb(true) })
    if (!S.data) return loadingCard(p)
    clear(p)
    var c = card('Tables'), bar = el('div', 'sdb-bar'), inp = el('input'); inp.type = 'search'; inp.name = 'sdb_filter'; inp.placeholder = 'Filter by name'; inp.value = S.filter; inp.setAttribute('aria-label', 'Filter tables by name'); inp.autocomplete = 'off'
    inp.addEventListener('input', guard(function () { S.filter = inp.value.slice(0, 60); renderTableList() }))
    bar.appendChild(inp)
    var seg = el('div', 'sdb-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Sort tables')
    ;[['size', 'Size'], ['rows', 'Rows'], ['name', 'Name']].forEach(function (o) {
      var b = el('button', 'sdb-segbtn', o[1]); b.type = 'button'; b.setAttribute('data-sort', o[0]); b.setAttribute('aria-pressed', S.sort === o[0] ? 'true' : 'false')
      b.addEventListener('click', guard(function () {
        if (S.sort === o[0]) S.dir = -S.dir; else { S.sort = o[0]; S.dir = o[0] === 'name' ? 1 : -1 }
        Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-sort') === S.sort ? 'true' : 'false') })
        renderTableList()
      }))
      seg.appendChild(b)
    })
    bar.appendChild(seg)
    c.appendChild(bar)
    R.tableCount = el('p', 'sdb-muted'); c.appendChild(R.tableCount)
    R.tableList = el('ul', 'sdb-list'); c.appendChild(R.tableList)
    p.appendChild(c)
    renderTableList()
  }
  function renderTableList() {
    if (!R.tableList || !S.data) return
    var rows = tablesView(), max = 1, i
    ;((S.data.tables) || []).forEach(function (r) { if (num(r.total_bytes) > max) max = num(r.total_bytes) })
    clear(R.tableList)
    R.tableCount.textContent = rows.length + ' of ' + ((S.data.tables) || []).length + ' tables' + (S.data.tables && S.data.tables.length >= 500 ? ' (the first 500)' : '') + '. Row counts are estimates.'
    for (i = 0; i < rows.length; i++) {
      var r = rows[i], li = el('li', 'sdb-trow')
      var top = el('div', 'sdb-trow-top'), nm = el('span', 'sdb-mono', clean(r.name)); nm.setAttribute('dir', 'ltr')
      add(top, nm, chip(r.in_repo ? 'ok' : 'info', r.in_repo ? 'Shop table' : 'Other'))
      var meta = el('div', 'sdb-trow-meta')
      add(meta, el('span', '', '≈ ' + intText(r.rows_estimate) + ' rows'), el('span', '', bytesText(r.total_bytes)), el('span', '', 'data ' + bytesText(r.data_bytes) + ' · indexes ' + bytesText(r.index_bytes)), el('span', '', clean(r.engine) || 'engine ?'))
      var bar = el('div', 'sdb-share'), fill = el('span', 'sdb-share-fill'); fill.style.width = Math.max(1, Math.round(num(r.total_bytes) / max * 100)) + '%'; bar.appendChild(fill)
      add(li, top, meta, bar)
      R.tableList.appendChild(li)
    }
    if (!rows.length) R.tableList.appendChild(el('li', 'sdb-muted', 'No table matches.'))
  }

  function renderSchema() {
    var p = R.panes.schema
    if (S.db === 'loading' && !S.data) return loadingCard(p)
    if (S.db === 'error' && !S.data) return errorCard(p, S.dbErr, function () { loadDb(true) })
    if (!S.data) return loadingCard(p)
    var sc = S.data.schema || {}
    clear(p)
    var c1 = card('Migrations')
    if (!sc.manifest) c1.appendChild(el('p', 'sdb-muted', 'This server has no migration list to compare with.'))
    else {
      c1.appendChild(el('p', 'sdb-muted', intText(sc.migrations_applied) + ' of ' + intText(sc.migrations_total) + ' migration files are fully present. A file is "applied" when every table and column it creates exists. Types and defaults are not compared here.'))
      var ul = el('ul', 'sdb-list')
      var ms = (sc.migrations || []).slice().sort(function (a, b) { var r = { missing: 0, partial: 1, applied: 2 }; return (r[a.status] - r[b.status]) || (String(a.file) < String(b.file) ? -1 : 1) })
      ms.forEach(function (m) {
        var li = el('li', 'sdb-mig'), top = el('div', 'sdb-trow-top'), nm = el('span', 'sdb-mono', clean(m.file)); nm.setAttribute('dir', 'ltr')
        add(top, nm, chip(m.status))
        li.appendChild(top)
        if (m.status !== 'applied') {
          var names = (m.missing_tables || []).map(function (t) { return 'table ' + clean(t) }).concat((m.missing_columns || []).map(function (t) { return 'column ' + clean(t) }))
          li.appendChild(el('p', 'sdb-muted', 'Missing: ' + names.slice(0, 12).join(', ') + (num(m.missing_count) > names.length || names.length > 12 ? ' … (' + intText(m.missing_count) + ' in all)' : '') + '.'))
        } else li.appendChild(el('p', 'sdb-muted', intText(m.tables) + ' table' + (num(m.tables) === 1 ? '' : 's') + ', ' + intText(m.columns) + ' column' + (num(m.columns) === 1 ? '' : 's') + ' checked.'))
        ul.appendChild(li)
      })
      c1.appendChild(ul)
      c1.appendChild(el('p', 'sdb-muted', 'To apply a missing migration, ask for a database job: the file is in the repo\'s dropin/php-store folder and is safe to run twice. Nothing here changes the database.'))
    }
    p.appendChild(c1)
    var c2 = card('Tables the shop expects')
    if ((sc.missing_tables || []).length) { var u2 = el('ul', 'sdb-list'); sc.missing_tables.forEach(function (t) { var li = el('li', 'sdb-row'); var nm = el('span', 'sdb-mono', clean(t)); nm.setAttribute('dir', 'ltr'); add(li, chip('fail', 'Missing'), nm); u2.appendChild(li) }); c2.appendChild(u2) }
    else c2.appendChild(el('p', 'sdb-muted', 'All ' + intText(sc.repo_tables) + ' of the shop\'s tables exist.'))
    p.appendChild(c2)
    var c3 = card('Other tables (not from this repo)')
    if ((sc.other_table_names || []).length) {
      c3.appendChild(el('p', 'sdb-muted', intText(sc.other_tables) + ' table' + (num(sc.other_tables) === 1 ? '' : 's') + ' belong to the old build or something else. The shop\'s code does not read them. They are in every backup.'))
      var u3 = el('ul', 'sdb-chips'); sc.other_table_names.forEach(function (t) { var li = el('li', 'sdb-mono sdb-pill', clean(t)); li.setAttribute('dir', 'ltr'); u3.appendChild(li) }); c3.appendChild(u3)
    } else c3.appendChild(el('p', 'sdb-muted', 'None.'))
    p.appendChild(c3)
  }

  function renderHealth() {
    var p = R.panes.health
    if (S.db === 'loading' && !S.data) return loadingCard(p)
    if (S.db === 'error' && !S.data) return errorCard(p, S.dbErr, function () { loadDb(true) })
    if (!S.data) return loadingCard(p)
    var bk = S.data.backup || {}, hl = S.data.health || {}
    clear(p)
    var b = BACKUP_LABEL[bk.state] || BACKUP_LABEL.not_reported, c1 = card('Backup')
    var head = el('div', 'sdb-trow-top'); add(head, chip(b[0] === 'error' ? 'fail' : b[0] === 'ok' ? 'ok' : b[0] === 'warn' ? 'warn' : 'unknown', b[1])); c1.appendChild(head)
    c1.appendChild(el('p', '', clean(bk.note)))
    var kvs = el('div', 'sdb-kvs')
    if (bk.last_success_at) kvs.appendChild(kv('Newest verified backup', when(bk.last_success_at) + (bk.age_hours != null ? ' (' + intText(bk.age_hours) + ' h ago)' : '')))
    if (bk.file) { var f = kv('File', clean(bk.file)); f.lastChild.setAttribute('dir', 'ltr'); kvs.appendChild(f) }
    if (bk.reason) kvs.appendChild(kv('Last failure', clean(bk.reason).replace(/_/g, ' ')))
    if (kvs.children.length) c1.appendChild(kvs)
    p.appendChild(c1)
    var c2 = card('Server health')
    if (hl.error) c2.appendChild(el('p', 'sdb-muted', 'The server would not report its status (' + clean(hl.error) + ').'))
    else {
      var ul = el('ul', 'sdb-list')
      ;(hl.indicators || []).forEach(function (h) {
        var li = el('li', 'sdb-ind'), top = el('div', 'sdb-trow-top')
        add(top, el('strong', 'sdb-ind-label', clean(h.label)), chip(h.status))
        var val = el('div', 'sdb-ind-value', (h.value == null ? '—' : typeof h.value === 'number' ? intText(h.value) : clean(h.value)) + (h.unit ? ' ' + clean(h.unit) : ''))
        add(li, top, val, el('p', 'sdb-muted', clean(h.note)))
        ul.appendChild(li)
      })
      c2.appendChild(ul)
    }
    c2.appendChild(el('p', 'sdb-muted', 'Counters are totals since the database last started. This screen only reads; it never stops or changes a statement.'))
    p.appendChild(c2)
  }

  function renderIntegrity() {
    var p = R.panes.integrity
    clear(p)
    var c = card('Integrity checks')
    c.appendChild(el('p', 'sdb-muted', 'Thirteen read-only checks, run when you press the button, each limited to a few seconds. They count rows that do not fit together; they never show or change a row.'))
    var run = btn('sdb-btn--primary', S.ig === 'loading' ? 'Running…' : (S.igData ? 'Run again' : 'Run the checks'), loadIntegrity)
    if (S.ig === 'loading') { run.disabled = true; run.setAttribute('aria-busy', 'true') }
    c.appendChild(run)
    p.appendChild(c)
    if (S.ig === 'error') { var e = el('div', 'sdb-banner'); e.setAttribute('data-state', 'error'); e.setAttribute('role', 'alert'); e.appendChild(el('p', '', S.igErr)); p.appendChild(e) }
    if (!S.igData) return
    var g = S.igData, s = card(g.overall === 'pass' ? 'All clear' : g.overall === 'fail' ? 'Problems found' : g.overall === 'warn' ? 'Worth a look' : 'Some checks could not run')
    s.appendChild(el('p', 'sdb-muted', 'Last run ' + (when(g.generated_at) || 'just now') + '.'))
    var ul = el('ul', 'sdb-list')
    g.checks.forEach(function (k) {
      var st = stateOf(k.status), li = el('li', 'sdb-item sdb-item--' + (CHIP[st] === 'error' ? 'fail' : CHIP[st] === 'warn' ? 'warn' : CHIP[st] === 'ok' ? 'pass' : 'skip'))
      var mark = el('span', 'sdb-mark', st === 'pass' ? '✓' : st === 'fail' ? '✕' : st === 'warn' ? '!' : st === 'info' ? 'i' : '–'); mark.setAttribute('aria-hidden', 'true')
      var body = el('div', 'sdb-item-body'), headl = el('div', 'sdb-item-head')
      add(headl, el('span', '', clean(k.label)), chip(st, STATE_LABEL[st] + (k.count != null && st !== 'pass' && st !== 'skip' ? ': ' + intText(k.count) : '')))
      add(body, headl, el('p', 'sdb-muted', clean(k.detail)))
      add(li, mark, body); ul.appendChild(li)
    })
    s.appendChild(ul)
    p.appendChild(s)
  }

  function renderAll() {
    if (!panel) return
    try { renderOverview(); renderTablesIfNeeded(); renderSchema(); renderHealth(); renderIntegrity() } catch (e) { setNote('Something went wrong in the Database center: ' + String(e && e.message || e).slice(0, 120), true) }
    R.refresh.disabled = S.db === 'loading'
    if (S.db === 'loading') R.refresh.setAttribute('aria-busy', 'true'); else R.refresh.removeAttribute('aria-busy')
    R.refresh.textContent = S.db === 'loading' ? 'Reading…' : 'Refresh'
    setNote(S.db === 'error' && S.data ? 'Could not refresh: ' + S.dbErr : '', S.db === 'error' && !!S.data)
  }
  // the Tables pane keeps its filter box (and focus) while other things refresh: it is rebuilt only when the data changed
  var tablesFor = null
  function renderTablesIfNeeded() {
    if (tablesFor === S.data && R.tableList && R.tableList.isConnected) return
    tablesFor = S.data; renderTables()
  }

  // ------------------------------------------------------------------- CSS
  var CSS = [
    '.sdb{--sd-bg:#fff;--sd-soft:#f7f8fa;--sd-line:#d9dfe5;--sd-edge:#7d8799;--sd-text:#18212a;--sd-muted:#556274;--sd-action:var(--admin-action,#9a452c);--sd-on-action:#fff;--sd-ok:#1b6e3c;--sd-ok-bg:#e6f4ec;--sd-warn:#8a4b00;--sd-warn-bg:#fdf0d9;--sd-err:#be123c;--sd-err-bg:#fde8ee;' +
      'container-type:inline-size;box-sizing:border-box;margin:0;padding:1rem;border:1px solid var(--sd-line);border-radius:1rem;background:var(--sd-bg);color:var(--sd-text);font:400 .875rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:start}',
    '@media (max-width:420px){.sdb{padding:.625rem}}',
    ':is(html.dark,html[data-theme="dark"]) .sdb{color-scheme:dark;--sd-bg:#151b21;--sd-soft:#1a2128;--sd-line:#303942;--sd-edge:#7a8896;--sd-text:#eef2f5;--sd-muted:#a7b3be;--sd-action:var(--brand-bright,#ff7b17);--sd-on-action:#171a1e;--sd-ok:#6ee7a3;--sd-ok-bg:#0f2f1f;--sd-warn:#fbbf24;--sd-warn-bg:#3a2a0a;--sd-err:#fda4af;--sd-err-bg:#3d1520}',
    '.sdb[hidden]{display:none!important}',
    '.sdb *,.sdb *::before,.sdb *::after{box-sizing:border-box}',
    '.sdb-wrap{display:grid;gap:1rem;min-width:0}',
    '.sdb-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:.75rem}',
    '.sdb-head>div{flex:1 1 20rem;min-width:0}',
    '.sdb-head-acts{display:flex;flex-wrap:wrap;gap:.5rem;flex:0 0 auto!important}',
    '.sdb-title{margin:0;font-size:1.5rem;font-weight:700;line-height:1.25;color:var(--sd-text)}',
    '.sdb-title:focus,.sdb-title:focus-visible{outline:none}',
    '.sdb-lead{margin:.25rem 0 0;color:var(--sd-muted)}',
    '.sdb p{margin:0}',
    '.sdb :is(button,input){font:inherit}',
    '.sdb .sdb-btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.75rem;padding:.5rem 1rem;border:1px solid var(--sd-edge);border-radius:.75rem;background:var(--sd-bg);color:var(--sd-text);font-weight:600;text-align:center;cursor:pointer}',
    '.sdb .sdb-btn:hover:not(:disabled){background:var(--sd-soft);border-color:var(--sd-text)}',
    '.sdb .sdb-btn--primary{background:var(--sd-action);border-color:transparent;color:var(--sd-on-action);font-weight:700}',
    '.sdb .sdb-btn--primary:hover:not(:disabled){background:var(--sd-action);border-color:transparent;filter:brightness(.9)}',
    '.sdb .sdb-btn--quiet{border-color:var(--sd-line);color:var(--sd-muted)}',
    '.sdb .sdb-btn--small{padding:.25rem .75rem;font-size:.8125rem}',
    '.sdb .sdb-btn:disabled{cursor:not-allowed;background:var(--sd-soft);border-color:var(--sd-line);color:var(--sd-muted)}',
    '.sdb :is(button,input,a):focus-visible{outline:2px solid var(--sd-action);outline-offset:2px}',
    '.sdb-status{min-height:1.25rem;font-weight:600;color:var(--sd-muted);overflow-wrap:anywhere}',
    '.sdb-status[data-bad="1"]{color:var(--sd-err)}',
    '.sdb-tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(6rem,1fr));gap:.25rem;padding:.25rem;border:1px solid var(--sd-line);border-radius:.875rem;background:var(--sd-soft)}',
    '.sdb .sdb-tab{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:.25rem .5rem;border:0;border-radius:.625rem;background:transparent;color:var(--sd-text);font-weight:700;text-align:center;cursor:pointer}',
    '.sdb .sdb-tab:hover{background:var(--sd-bg)}',
    '.sdb .sdb-tab[aria-selected="true"]{background:var(--sd-action);color:var(--sd-on-action)}',
    '.sdb-pane{display:grid;gap:1rem;min-width:0}',
    '.sdb-pane[hidden]{display:none!important}',
    '.sdb-card{display:grid;gap:.75rem;align-content:start;min-width:0;padding:.875rem;border:1px solid var(--sd-line);border-radius:.875rem;background:var(--sd-bg)}',
    '.sdb-h2{margin:0;font-size:1rem;font-weight:700}',
    '.sdb-muted{color:var(--sd-muted)}',
    '.sdb-stats{display:grid;gap:.75rem;grid-template-columns:minmax(0,1fr)}',
    '@container (min-width:520px){.sdb-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '@container (min-width:860px){.sdb-stats{grid-template-columns:repeat(4,minmax(0,1fr))}}',
    '.sdb-stat{display:grid;gap:.25rem;align-content:start;min-width:0;padding:.75rem;border:1px solid var(--sd-line);border-radius:.875rem;background:var(--sd-soft)}',
    '.sdb-stat-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.25rem .5rem}',
    '.sdb-stat-label{font-size:.8125rem;font-weight:700;color:var(--sd-muted)}',
    '.sdb-stat-value{font-size:1.5rem;font-weight:800;line-height:1.2;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
    '.sdb-stat-sub{color:var(--sd-muted);font-size:.8125rem}',
    '.sdb-chip{display:inline-flex;align-items:center;padding:.0625rem .5rem;border:1px solid currentColor;border-radius:999px;font-size:.75rem;font-weight:700;line-height:1.5;white-space:nowrap}',
    '.sdb-chip--ok{color:var(--sd-ok);background:var(--sd-ok-bg)}.sdb-chip--warn{color:var(--sd-warn);background:var(--sd-warn-bg)}.sdb-chip--error{color:var(--sd-err);background:var(--sd-err-bg)}.sdb-chip--info{color:var(--sd-muted);background:var(--sd-soft)}',
    '.sdb-list,.sdb-chips{margin:0;padding:0;list-style:none;display:grid;gap:.5rem}',
    '.sdb-chips{display:flex;flex-wrap:wrap;gap:.375rem}',
    '.sdb-pill{padding:.125rem .625rem;border:1px solid var(--sd-line);border-radius:999px;background:var(--sd-soft);font-size:.75rem}',
    '.sdb-row{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .75rem;padding:.5rem .75rem;border:1px solid var(--sd-line);border-radius:.75rem;background:var(--sd-soft)}',
    '.sdb-row-text{flex:1 1 14rem;min-width:0;overflow-wrap:anywhere}',
    '.sdb-kvs{display:grid;gap:.375rem;grid-template-columns:minmax(0,1fr)}',
    '@container (min-width:640px){.sdb-kvs{grid-template-columns:repeat(2,minmax(0,1fr))}}',
    '.sdb-kv{display:flex;justify-content:space-between;gap:.75rem;padding:.375rem .625rem;border:1px solid var(--sd-line);border-radius:.625rem;background:var(--sd-soft)}',
    '.sdb-kv-k{color:var(--sd-muted);font-weight:600}.sdb-kv-v{font-weight:700;font-variant-numeric:tabular-nums;text-align:end;overflow-wrap:anywhere}',
    '.sdb-bar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}',
    '.sdb-bar input{flex:1 1 12rem;min-width:0;min-height:2.75rem;padding:.25rem .625rem;border:1px solid var(--sd-edge);border-radius:.75rem;color:var(--sd-text)!important;background-color:var(--sd-bg)!important;box-shadow:none}',
    '.sdb-seg{display:inline-flex;border:1px solid var(--sd-edge);border-radius:.75rem;overflow:hidden}',
    '.sdb .sdb-segbtn{min-height:2.75rem;min-width:2.75rem;padding:0 .875rem;border:0;background:var(--sd-bg);color:var(--sd-text);font-weight:700;cursor:pointer}',
    '.sdb .sdb-segbtn[aria-pressed="true"]{background:var(--sd-action);color:var(--sd-on-action)}',
    '.sdb-trow,.sdb-mig,.sdb-ind{display:grid;gap:.25rem;min-width:0;padding:.625rem .75rem;border:1px solid var(--sd-line);border-radius:.75rem;background:var(--sd-soft)}',
    '.sdb-trow-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.25rem .5rem;min-width:0}',
    '.sdb-trow-meta{display:flex;flex-wrap:wrap;gap:.125rem .875rem;color:var(--sd-muted);font-variant-numeric:tabular-nums}',
    '.sdb-mono{font:600 .8125rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;direction:ltr;unicode-bidi:isolate;overflow-wrap:anywhere}',
    '.sdb-share{height:.375rem;border-radius:999px;background:var(--sd-line);overflow:hidden}',
    '.sdb-share-fill{display:block;height:100%;background:var(--sd-action)}',
    '.sdb-ind-value{font-size:1.125rem;font-weight:800;font-variant-numeric:tabular-nums}',
    '.sdb-banner{display:flex;flex-wrap:wrap;align-items:center;gap:.625rem;padding:.75rem .875rem;border:1px solid var(--sd-line);border-radius:.875rem;background:var(--sd-soft);overflow-wrap:anywhere}',
    '.sdb-banner[data-state="error"]{border-color:var(--sd-err);background:var(--sd-err-bg);color:var(--sd-err);font-weight:600}',
    '.sdb-item{display:flex;gap:.625rem;padding:.625rem .75rem;border:1px solid var(--sd-line);border-radius:.75rem;background:var(--sd-soft)}',
    '.sdb-mark{flex:none;width:1.5rem;height:1.5rem;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;border:1px solid currentColor;font-size:.8125rem;font-weight:800}',
    '.sdb-item--pass .sdb-mark{color:var(--sd-ok)}.sdb-item--warn .sdb-mark{color:var(--sd-warn)}.sdb-item--fail .sdb-mark{color:var(--sd-err)}.sdb-item--skip .sdb-mark{color:var(--sd-muted)}',
    '.sdb-item-body{min-width:0;display:grid;gap:.125rem;overflow-wrap:anywhere}',
    '.sdb-item-head{display:flex;flex-wrap:wrap;align-items:center;gap:.25rem .5rem;font-weight:700}',
    'body[' + OPEN + '="open"] main.admin-content>section.admin-page:not([' + PAGE + ']){display:none!important}',
    '.sdb-open{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.75rem;padding:.5rem 1rem;border:0;border-radius:.75rem;background:var(--admin-action,#9a452c);color:#fff;font:700 .875rem/1.25 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}',
    '.sdb-open:hover{filter:brightness(.92)}',
    '.sdb-open:focus-visible{outline:2px solid var(--admin-action,#9a452c);outline-offset:2px}',
    '.sdb-open--below{margin-top:.5rem}',
    ':is(html.dark,html[data-theme="dark"]) .sdb-open{background:var(--brand-bright,#ff7b17);color:#171a1e}',
    '@media (prefers-reduced-motion:no-preference){.sdb .sdb-btn,.sdb .sdb-tab{transition:background-color .15s ease,border-color .15s ease}}'
  ].join('\n')
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return
    styleEl = document.createElement('style')
    styleEl.setAttribute('data-sporta-dbc-style', '')
    styleEl.textContent = CSS
    document.head.appendChild(styleEl)
  }

  // ------------------------------------------------------------------- panel
  function build() {
    var sec = el('section', 'admin-page sdb'); sec.setAttribute(PAGE, ''); sec.setAttribute('aria-labelledby', 'sdb-title'); sec.hidden = true
    var wrap = el('div', 'sdb-wrap admin-page-layout')
    var head = el('header', 'sdb-head'), left = el('div')
    R.h1 = el('h1', 'sdb-title', 'Database center'); R.h1.id = 'sdb-title'; R.h1.tabIndex = -1
    add(left, R.h1, el('p', 'sdb-lead', 'What the database holds, whether it matches the shop’s code, how it is doing and whether its data fits together. Read only: nothing here changes the shop’s data. · ما تحتويه قاعدة البيانات، وهل تطابق كود المتجر، وحالتها، وهل بياناتها متسقة. للقراءة فقط: لا شيء هنا يغيّر بيانات المتجر.'))
    var acts = el('div', 'sdb-head-acts')
    R.refresh = btn('', 'Refresh', function () { loadDb(true) })
    R.back = btn('', '← Back', function () { closePanel(true) })
    add(acts, R.refresh, R.back)
    add(head, left, acts)
    R.status = el('p', 'sdb-status'); R.status.setAttribute('role', 'status'); R.status.setAttribute('aria-live', 'polite')
    R.tabs = el('div', 'sdb-tabs'); R.tabs.setAttribute('role', 'tablist'); R.tabs.setAttribute('aria-label', 'Database center')
    R.tabBtn = {}; R.panes = {}
    TABS.forEach(function (t) {
      var b = el('button', 'sdb-tab', t[1]); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('data-tab', t[0]); b.id = 'sdb-tab-' + t[0]
      b.addEventListener('click', guard(function () { showTab(t[0]) }))
      b.addEventListener('keydown', function (e) {
        var i = TABS.map(function (x) { return x[0] }).indexOf(t[0]), n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        if (document.documentElement.getAttribute('dir') === 'rtl' || (document.querySelector('.admin-shell') && document.querySelector('.admin-shell').getAttribute('dir') === 'rtl')) n = -n
        if (!n) return
        e.preventDefault(); var nx = TABS[(i + n + TABS.length) % TABS.length][0]; showTab(nx); R.tabBtn[nx].focus()
      })
      R.tabBtn[t[0]] = b; R.tabs.appendChild(b)
      R.panes[t[0]] = buildPane(t[0]); R.panes[t[0]].setAttribute('aria-labelledby', 'sdb-tab-' + t[0]); R.panes[t[0]].hidden = true
    })
    add(wrap, head, R.status, R.tabs)
    TABS.forEach(function (t) { wrap.appendChild(R.panes[t[0]]) })
    sec.appendChild(wrap)
    return sec
  }
  function showTab(k) {
    S.tab = k
    TABS.forEach(function (t) {
      var on = t[0] === k
      R.panes[t[0]].hidden = !on
      R.tabBtn[t[0]].setAttribute('aria-selected', on ? 'true' : 'false'); R.tabBtn[t[0]].tabIndex = on ? 0 : -1
    })
  }
  function mount() {
    var main = document.querySelector('main.admin-content')
    if (!main) return false
    ensureStyle()
    if (!panel) { panel = build(); renderAll() }
    if (panel.parentNode !== main) main.appendChild(panel)
    return true
  }
  function openPanel() {
    if (S.open) return
    if (!mount()) return
    S.open = true
    panel.hidden = false
    document.body.setAttribute(OPEN, 'open')
    showTab(S.tab)
    loadDb(true)
    try { R.h1.focus({ preventScroll: true }) } catch (e) { /* focus is a courtesy */ }
  }
  function closePanel(focusBack) {
    if (!S.open) return
    S.open = false
    S.seq++; S.igSeq++                                   // an answer that arrives now is not for anyone
    if (S.db === 'loading') S.db = S.data ? 'ready' : 'idle'
    if (S.ig === 'loading') S.ig = S.igData ? 'ready' : 'idle'
    if (panel) panel.hidden = true
    document.body.removeAttribute(OPEN)
    if (focusBack) { var b = document.querySelector('[' + BTN + ']'); if (b) { try { b.focus() } catch (e) { /* courtesy */ } } }
  }

  // ------------------------------------------------------------------- entry
  function entryHead() {
    var hs = document.querySelectorAll('main.admin-content .admin-page h1'), i
    for (i = 0; i < hs.length; i++) {
      if (HEADS.indexOf(clean(hs[i].textContent)) >= 0 && shown(hs[i])) { var h = hs[i].closest('.admin-page-header'); if (h) return h }
    }
    return null
  }
  function ensure() {
    var have = document.querySelector('[' + BTN + ']')
    if (S.open) { if (!have || !have.isConnected || !panel || !panel.isConnected) closePanel(false); return }
    var head = entryHead()
    if (!head) { if (have) have.remove(); return }
    ensureStyle()
    if (have && head.contains(have)) return
    if (have) have.remove()
    var b = el('button', 'sdb-open', 'Database center'); b.type = 'button'; b.setAttribute(BTN, '1')
    b.setAttribute('aria-label', 'Database center: tables, schema, backup, health and integrity checks')
    b.addEventListener('click', guard(openPanel))
    head.appendChild(b)
  }
  // any click on the menu leaves the panel before React handles it
  document.addEventListener('click', function (ev) {
    if (!S.open) return
    var t = ev.target && ev.target.closest ? ev.target.closest(NAV) : null
    if (t) closePanel(false)
  }, true)

  try {
    Object.defineProperty(window, '__sportaDbCenter', { value: { version: 1, bytesText: bytesText, intText: intText, attention: attention }, enumerable: false, configurable: false })
  } catch (e) { return }
  function start() {
    setInterval(function () { if (document.hidden) return; try { ensure() } catch (e) { /* the page keeps working without it */ } }, 500)   // a hidden tab has nobody to add a button for
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN DATABASE CENTER - end ======================================== */

/* ===== ADMIN SHIPPING - begin ==============================================
 * 14. Shipping (owner request 2026-11-12: "add shipping setup at backends").
 *
 * ONE button, "Shipping", in the header of the Settings screen (beside Database center). It opens a panel (a section in
 * <main>; the screen behind it is hidden by CSS while it is open; "Back" or any click on the menu closes it) where the
 * owner sets:
 *   - the base delivery fee (the same number the Checkout screen edits: the server keeps it in checkout.delivery_fee_fils);
 *   - free delivery from an order value (the goods AFTER discounts; empty = never free);
 *   - per governorate (Kuwait's six): deliver there or not, its own fee (empty = the base fee), the delivery time in
 *     English and Arabic (plain text, no price, no currency word);
 * and sees "what a customer pays" for sample carts, priced by the SERVER from the draft (shipping_preview runs the
 * checkout's own function; nothing is computed here but the conversion of what the owner typed into whole fils).
 *
 * Routes, with the admin session cookie and the X-Sporta-Admin header:
 *   GET  shipping          -> { v, configured, flat_fee_fils, free_over_fils, zones{gov:{enabled, fee_fils|null, time_en, time_ar}},
 *                               governorates[], limits{}, express:false }
 *   POST shipping_save     { v, flat_fee_fils, free_over_fils, zones } -> the same as GET (409 shipping_changed: another
 *                               browser saved since this one loaded)
 *   POST shipping_preview  { settings:{...the same fields}, samples:[{goods_fils, governorate}] } -> { samples:[{fee_fils, total_fils, free, available}] }
 *
 * NOT HERE: express / same-day delivery. The live checkout is a compiled build that sends no delivery choice, so a
 * second fee could not be quoted and charged as one number; the panel says so.
 *
 * When the server does not have the route (this file deployed before the API), the first GET answers 404 and the
 * panel says the setup arrives with the next server update; nothing is sent. Built with createElement + textContent,
 * never as markup; every control is at least 44px; light and dark; the Save is a real submit button labelled "Save ..."
 * in a form, so the save bar mirrors it.
 */
;(function () {   // leading ; - the block above ends in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaShipping) return

  var API = '/api/admin.php'
  var PAGE = 'data-sporta-ship'              // the section
  var BTN = 'data-sporta-ship-btn'           // the entry button
  var OPEN = 'data-sporta-ship-state'        // on <body>: "open"
  var NAV = '.admin-sidebar .admin-nav-item, .m-tabbar__item, .m-menu-item, .m-header__menu'
  var HEADS = ['Settings', 'الإعدادات']
  var GOVS = [
    ['capital', 'Capital', 'العاصمة'], ['hawalli', 'Hawalli', 'حولي'], ['farwaniya', 'Farwaniya', 'الفروانية'],
    ['mubarak-al-kabeer', 'Mubarak Al-Kabeer', 'مبارك الكبير'], ['ahmadi', 'Ahmadi', 'الأحمدي'], ['jahra', 'Jahra', 'الجهراء']
  ]
  var MSG = {
    not_signed_in: 'Your sign-in has ended. Sign in again, then reopen this screen. · انتهت الجلسة، سجّل الدخول من جديد.',
    bad_request: 'The save was refused. Reload the page and try again. · رُفض الحفظ، أعد تحميل الصفحة.',
    request_too_large: 'Too much text in one save. · النص كثير جدًا.',
    shipping_changed: 'Someone saved Shipping in another window since you opened it. Press "Reload from server", then make your change again. · حُفظ الشحن من نافذة أخرى، أعد التحميل ثم عدّل.',
    invalid_shipping_flat_fee: 'Base fee: an amount from 0 to 100 KWD, up to three decimals (1.250). · رسوم التوصيل من 0 إلى 100 د.ك.',
    invalid_shipping_free_over: 'Free delivery from: an amount up to 10,000 KWD, or empty for never. · الحد الأدنى للتوصيل المجاني غير صحيح.',
    invalid_shipping_zone_fee: 'A governorate fee must be 0 to 100 KWD, or empty for the base fee. · رسوم المحافظة من 0 إلى 100 د.ك.',
    invalid_shipping_zones: 'The governorates could not be read. Reload the page. · تعذّرت قراءة المحافظات.',
    invalid_shipping_zone: 'The governorates could not be read. Reload the page. · تعذّرت قراءة المحافظات.',
    invalid_shipping_enabled: 'A "deliver here" switch could not be read. Reload the page. · تعذّرت قراءة مفتاح التوصيل.',
    invalid_shipping_version: 'The save was refused. Reload the page and try again. · رُفض الحفظ، أعد تحميل الصفحة.',
    shipping_zone_required: 'At least one governorate must take deliveries. · يجب تفعيل التوصيل لمحافظة واحدة على الأقل.',
    price_in_shipping_time_en: 'The English delivery time cannot contain a price or a currency (KD, KWD, dinar, fils). · لا يمكن كتابة سعر في مدة التوصيل.',
    price_in_shipping_time_ar: 'The Arabic delivery time cannot contain a price or a currency (د.ك، دينار، فلس). · لا يمكن كتابة سعر في مدة التوصيل.',
    too_long_shipping_time_en: 'The English delivery time is longer than 120 characters. · مدة التوصيل بالإنجليزية أطول من 120 حرفًا.',
    too_long_shipping_time_ar: 'The Arabic delivery time is longer than 120 characters. · مدة التوصيل بالعربية أطول من 120 حرفًا.',
    invalid_shipping_time_en: 'The English delivery time could not be read. · تعذّرت قراءة مدة التوصيل.',
    invalid_shipping_time_ar: 'The Arabic delivery time could not be read. · تعذّرت قراءة مدة التوصيل.'
  }
  var NOT_YET = 'Shipping setup is not available until the next update of the shop server. Nothing is wrong with your account. · إعداد الشحن متاح بعد تحديث الخادم القادم.'

  // ----------------------------------------------------------------- helpers
  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    if (tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'th' || tag === 'td') n.setAttribute('dir', 'auto')
    return n
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild) }
  function token(b) { var e = b && b.error; return typeof e === 'string' && /^[a-z_]{1,60}$/.test(e) ? e : '' }
  function str(v) { return typeof v === 'string' ? v : '' }
  function shown(e) { var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  function guard(fn) { return function () { try { return fn.apply(this, arguments) } catch (e) { try { setNote('Something went wrong in Shipping: ' + String(e && e.message || e).slice(0, 120), true) } catch (x) { /* the admin keeps working */ } } } }

  /** What the owner typed ("1.25", "1,250", "١٫٢٥") as whole fils, '' for an empty box, or null when it is not an amount. Text work only. */
  function toFils(text) {
    var s = String(text == null ? '' : text).replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660) })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0) }).replace(/[٫,]/g, '.').replace(/\s+/g, '')
    if (s === '') return ''
    var m = /^([0-9]{1,5})(?:\.([0-9]{0,3}))?$/.exec(s)
    if (!m) return null
    var frac = (m[2] || '') + '000'
    return parseInt(m[1], 10) * 1000 + parseInt(frac.slice(0, 3), 10)
  }
  /** Whole fils as the KWD text the admin shows (1250 -> "1.250"). */
  function kwd(fils) {
    var n = Math.max(0, Math.round(Number(fils) || 0)), f = String(n % 1000)
    while (f.length < 3) f = '0' + f
    return String(Math.floor(n / 1000)) + '.' + f
  }
  function request(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, body: j } })
    }).catch(function () { return { ok: false, status: 0, body: null } })
  }
  function failText(r) {
    var code = token(r.body)
    if (r.status === 0) return 'Could not reach the server. Check the connection and try again. · تعذّر الاتصال بالخادم.'
    if (r.status === 401) return MSG.not_signed_in
    if (r.status === 404) return NOT_YET
    if (r.status === 429) return 'Too many presses. Wait a minute, then try again. · طلبات كثيرة، انتظر دقيقة.'
    if (MSG[code]) return MSG[code]
    return 'The server could not do that (' + (code || 'HTTP ' + r.status) + ').'
  }
  function isDoc(b) { return !!(b && typeof b === 'object' && typeof b.flat_fee_fils === 'number' && b.zones && typeof b.zones === 'object') }

  // ------------------------------------------------------------------- state
  var S = { open: false, loaded: false, loading: false, saving: false, doc: null, saved: '', seq: 0, pseq: 0, ptimer: 0 }
  var R = {}
  var panel = null, styleEl = null

  function setNote(text, bad) {
    if (!R.status) return
    R.status.textContent = text || ''
    if (bad) R.status.setAttribute('data-bad', '1'); else R.status.removeAttribute('data-bad')
  }

  // ------------------------------------------------------------- form <-> state
  /** The draft as the server takes it, or { error, focus } when a box does not hold an amount. */
  function draft() {
    var base = toFils(R.base.value), free = toFils(R.free.value)
    if (base === '' || base === null || base > 100000) return { error: MSG.invalid_shipping_flat_fee, focus: R.base }
    if (free === null || (free !== '' && free > 10000000)) return { error: MSG.invalid_shipping_free_over, focus: R.free }
    var zones = {}, open = 0
    for (var i = 0; i < GOVS.length; i++) {
      var g = GOVS[i][0], z = R.zones[g], fee = toFils(z.fee.value)
      if (fee === null || (fee !== '' && fee > 100000)) return { error: MSG.invalid_shipping_zone_fee, focus: z.fee }
      zones[g] = { enabled: z.on.checked, fee_fils: fee === '' ? null : fee, time_en: z.en.value.trim(), time_ar: z.ar.value.trim() }
      if (z.on.checked) open++
    }
    if (!open) return { error: MSG.shipping_zone_required, focus: R.zones[GOVS[0][0]].on }
    return { body: { flat_fee_fils: base, free_over_fils: free === '' ? 0 : free, zones: zones } }
  }
  function docBody(d) {
    var zones = {}
    GOVS.forEach(function (g) {
      var z = (d.zones && d.zones[g[0]]) || {}
      zones[g[0]] = { enabled: z.enabled !== false, fee_fils: typeof z.fee_fils === 'number' ? z.fee_fils : null, time_en: str(z.time_en), time_ar: str(z.time_ar) }
    })
    return { flat_fee_fils: d.flat_fee_fils, free_over_fils: typeof d.free_over_fils === 'number' ? d.free_over_fils : 0, zones: zones }
  }
  function dirty() {
    if (!S.loaded || !R.base) return false
    var d = draft()
    return d.error ? true : JSON.stringify(d.body) !== S.saved
  }
  function adopt(d) {
    S.doc = d; S.loaded = true
    S.saved = JSON.stringify(docBody(d))
    if (R.base) fill()
  }
  function fill() {
    var b = docBody(S.doc)
    R.base.value = kwd(b.flat_fee_fils)
    R.free.value = b.free_over_fils > 0 ? kwd(b.free_over_fils) : ''
    GOVS.forEach(function (g) {
      var z = R.zones[g[0]], s = b.zones[g[0]]
      z.on.checked = s.enabled
      z.fee.value = s.fee_fils === null ? '' : kwd(s.fee_fils)
      z.en.value = s.time_en; z.ar.value = s.time_ar
    })
    drawZones(); drawFoot(); previewSoon(0)
  }
  function drawZones() {
    var base = toFils(R.base.value)
    GOVS.forEach(function (g) {
      var z = R.zones[g[0]]
      z.fee.placeholder = typeof base === 'number' ? 'Base · الأساسي ' + kwd(base) : 'Base fee · الرسوم الأساسية'
      z.row.setAttribute('data-off', z.on.checked ? '0' : '1')
    })
  }
  function drawFoot() {
    if (!R.save) return
    R.save.disabled = S.saving || !S.loaded
    R.reload.disabled = S.saving || S.loading
    R.dirty.textContent = !S.loaded ? '' : dirty() ? 'Changes not saved yet · تغييرات غير محفوظة' : 'Everything is saved · كل شيء محفوظ'
  }

  // ------------------------------------------------------------------ preview
  function previewSoon(ms) {
    if (S.ptimer) clearTimeout(S.ptimer)
    S.ptimer = setTimeout(guard(preview), ms == null ? 400 : ms)
  }
  function samples(d) {
    var goods = toFils(R.goods.value), out = [], i
    if (typeof goods !== 'number') goods = 10000
    for (i = 0; i < GOVS.length; i++) out.push({ goods_fils: goods, governorate: GOVS[i][0] })
    var t = d.body.free_over_fils
    if (t > 0) {
      var probe = R.zoneSel.value || GOVS[0][0]
      if (t > 1) out.push({ goods_fils: t - 1, governorate: probe })
      out.push({ goods_fils: t, governorate: probe })
    }
    return out
  }
  function preview() {
    S.ptimer = 0
    if (!S.open || !S.loaded || !R.pbody) return
    var d = draft()
    if (d.error) { drawPreview(null, d.error); return }
    var seq = ++S.pseq, list = samples(d)
    R.ptable.setAttribute('aria-busy', 'true')
    request('shipping_preview', { settings: d.body, samples: list }).then(guard(function (r) {
      if (seq !== S.pseq || !S.open) return
      R.ptable.removeAttribute('aria-busy')
      if (r.ok && r.body && Array.isArray(r.body.samples)) drawPreview(r.body.samples, '')
      else drawPreview(null, failText(r))
    }))
  }
  function govName(g) { for (var i = 0; i < GOVS.length; i++) if (GOVS[i][0] === g) return GOVS[i][1] + ' · ' + GOVS[i][2]; return String(g) }
  function drawPreview(rows, problem) {
    clear(R.pbody)
    R.pnote.textContent = problem || ''
    if (problem) R.pnote.setAttribute('data-bad', '1'); else R.pnote.removeAttribute('data-bad')
    if (!rows) return
    rows.forEach(function (s) {
      var tr = el('tr')
      tr.setAttribute('data-gov', String(s.governorate))
      add(tr, el('td', '', govName(s.governorate)), el('td', 'ssh-num', kwd(s.goods_fils)))
      if (s.available === false) {
        var no = el('td', 'ssh-off', 'No delivery · لا توصيل'); no.colSpan = 2; tr.appendChild(no)
      } else {
        add(tr, el('td', 'ssh-num', s.free ? 'Free · مجاني' : kwd(s.fee_fils)), el('td', 'ssh-num ssh-total', kwd(s.total_fils)))
      }
      R.pbody.appendChild(tr)
    })
  }

  // ------------------------------------------------------------------ actions
  function load() {
    if (S.loading) return
    S.loading = true; setNote('Loading… · جارٍ التحميل…', false); drawFoot()
    var seq = ++S.seq
    request('shipping').then(guard(function (r) {
      if (seq !== S.seq) return
      S.loading = false
      if (r.ok && isDoc(r.body)) { R.form.hidden = false; adopt(r.body); setNote('', false) }
      else { if (r.status === 404) R.form.hidden = true; setNote(failText(r), true) }
      drawFoot()
    }))
  }
  function save() {
    if (S.saving || !S.loaded) return
    var d = draft()
    if (d.error) { setNote(d.error, true); try { d.focus.focus() } catch (e) { /* focus is a courtesy */ } return }
    var body = d.body
    body.v = typeof S.doc.v === 'number' ? S.doc.v : 0
    S.saving = true; setNote('Saving… · جارٍ الحفظ…', false); drawFoot()
    request('shipping_save', body).then(guard(function (r) {
      S.saving = false
      if (r.ok && isDoc(r.body)) { adopt(r.body); setNote('Saved. New orders use it from now on. · تم الحفظ، ويُطبق على الطلبات الجديدة.', false) }
      else setNote(failText(r), true)
      drawFoot()
    }))
  }

  // ------------------------------------------------------------------- panel
  var CSS = [
    '.ssh{--ss-bg:#fff;--ss-soft:#f7f8fa;--ss-line:#d9dfe5;--ss-edge:#7d8799;--ss-text:#18212a;--ss-muted:#556274;--ss-action:var(--admin-action,#4f46e5);--ss-on-action:#fff;--ss-err:#be123c;--ss-warn:#8a4b00;--ss-warn-bg:#fdf0d9;' +
      'container-type:inline-size;box-sizing:border-box;margin:0;padding:1rem;border:1px solid var(--ss-line);border-radius:1rem;background:var(--ss-bg);color:var(--ss-text);font:400 .875rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:start}',
    '@media (max-width:420px){.ssh{padding:.625rem}}',
    ':is(html.dark,html[data-theme="dark"]) .ssh{color-scheme:dark;--ss-bg:#151b21;--ss-soft:#1a2128;--ss-line:#303942;--ss-edge:#7a8896;--ss-text:#eef2f5;--ss-muted:#a7b3be;--ss-action:#a5b4fc;--ss-on-action:#171a1e;--ss-err:#fda4af;--ss-warn:#fbbf24;--ss-warn-bg:#3a2a0a}',
    '.ssh[hidden],.ssh [hidden]{display:none!important}',
    '.ssh *,.ssh *::before,.ssh *::after{box-sizing:border-box}',
    '.ssh-wrap,.ssh-form{display:grid;gap:1rem;min-width:0;margin:0}',
    '.ssh-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:.75rem}',
    '.ssh-head>div{flex:1 1 20rem;min-width:0}',
    '.ssh-title{margin:0;font-size:1.5rem;font-weight:700;line-height:1.25;color:var(--ss-text)}',
    '.ssh-title:focus,.ssh-title:focus-visible{outline:none}',
    '.ssh h2{margin:0;font-size:1.0625rem;font-weight:700;color:var(--ss-text)}',
    '.ssh h3{margin:0;font-size:.9375rem;font-weight:700;color:var(--ss-text)}',
    '.ssh p{margin:0}',
    '.ssh-lead,.ssh-hint{color:var(--ss-muted)}',
    '.ssh-card{display:grid;gap:.75rem;min-width:0;padding:.875rem;border:1px solid var(--ss-line);border-radius:.875rem;background:var(--ss-soft)}',
    '.ssh-grid{display:grid;gap:.625rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr));align-items:end}',
    '.ssh-field{display:grid;gap:.25rem;min-width:0}',
    '.ssh-lab{font-size:.8125rem;font-weight:700;color:var(--ss-muted)}',
    '.ssh :is(button,input,select){font:inherit}',
    '.ssh :is(select,input[type="text"]){width:100%;max-width:100%;min-height:2.75rem;padding:.375rem .625rem;border:1px solid var(--ss-edge);border-radius:.75rem;color:var(--ss-text)!important;background-color:var(--ss-bg)!important;box-shadow:none}',
    '.ssh input::placeholder{color:var(--ss-muted)!important;opacity:1!important}',
    '.ssh .ssh-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;min-width:2.75rem;padding:.5rem 1rem;border:1px solid var(--ss-edge);border-radius:.75rem;background:var(--ss-bg);color:var(--ss-text);font-weight:600;text-align:center;cursor:pointer;line-height:1.25}',
    '.ssh .ssh-btn:hover:not(:disabled){border-color:var(--ss-text)}',
    '.ssh .ssh-btn--primary{background:var(--ss-action);border-color:transparent;color:var(--ss-on-action);font-weight:700}',
    '.ssh .ssh-btn:disabled{cursor:not-allowed;background:var(--ss-soft);border-color:var(--ss-line);color:var(--ss-muted)}',
    '.ssh :is(button,input,select):focus-visible{outline:2px solid var(--ss-action);outline-offset:2px}',
    '.ssh-check{display:flex;align-items:center;gap:.625rem;min-height:2.75rem;font-weight:600;color:var(--ss-text);cursor:pointer}',
    '.ssh-check input{flex:none;width:1.375rem;height:1.375rem;min-height:0;margin:0;accent-color:var(--ss-action)}',
    '.ssh-zone{display:grid;gap:.5rem;min-width:0;padding:.75rem;border:1px solid var(--ss-line);border-radius:.75rem;background:var(--ss-bg)}',
    '.ssh-zone[data-off="1"]{border-style:dashed}',
    '.ssh-zone[data-off="1"] .ssh-zone-more{opacity:.6}',
    '.ssh-zone-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.25rem .75rem}',
    '.ssh-status,.ssh-pnote{min-height:1.25rem;font-weight:600;color:var(--ss-muted);overflow-wrap:anywhere}',
    '.ssh-status[data-bad="1"],.ssh-pnote[data-bad="1"]{color:var(--ss-err)}',
    '.ssh-note{padding:.625rem .75rem;border-radius:.75rem;background:var(--ss-warn-bg);color:var(--ss-warn);font-weight:600;overflow-wrap:anywhere}',
    '.ssh-tablewrap{overflow-x:auto;min-width:0;border:1px solid var(--ss-line);border-radius:.75rem;background:var(--ss-bg)}',
    '.ssh-table{width:100%;border-collapse:collapse}',
    '.ssh-table :is(th,td){padding:.5rem .625rem;border-bottom:1px solid var(--ss-line);text-align:start;vertical-align:middle}',
    '.ssh-table th{font-size:.8125rem;color:var(--ss-muted)}',
    '.ssh-table tr:last-child td{border-bottom:0}',
    '.ssh-num{font-variant-numeric:tabular-nums;white-space:nowrap;direction:ltr;unicode-bidi:isolate}',
    '.ssh-total{font-weight:800}',
    '.ssh-off{color:var(--ss-err);font-weight:700}',
    '.ssh-foot{display:flex;flex-wrap:wrap;align-items:center;gap:.625rem}',
    '.ssh-dirty{font-weight:600;color:var(--ss-muted)}',
    'body[' + OPEN + '="open"] main.admin-content>section.admin-page:not([' + PAGE + ']){display:none!important}',
    '.ssh-open{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.75rem;padding:.5rem 1rem;border:0;border-radius:.75rem;background:var(--admin-action,#4f46e5);color:#fff;font:700 .875rem/1.25 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}',
    '.ssh-open:hover{filter:brightness(.92)}',
    '.ssh-open:focus-visible{outline:2px solid var(--admin-action,#4f46e5);outline-offset:2px}',
    ':is(html.dark,html[data-theme="dark"]) .ssh-open{background:#a5b4fc;color:#171a1e}'
  ].join('\n')
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return
    styleEl = document.createElement('style')
    styleEl.setAttribute('data-sporta-ship-style', '')
    styleEl.textContent = CSS
    document.head.appendChild(styleEl)
  }
  function field(label, control) {
    var l = el('label', 'ssh-field')
    add(l, el('span', 'ssh-lab', label), control)
    return l
  }
  function input(name, max, dir, mode) {
    var i = el('input'); i.type = 'text'; i.name = name; i.maxLength = max; i.autocomplete = 'off'
    if (dir) i.setAttribute('dir', dir)
    if (mode) i.setAttribute('inputmode', mode)
    return i
  }
  function build() {
    var sec = el('section', 'admin-page ssh'); sec.setAttribute(PAGE, ''); sec.setAttribute('aria-labelledby', 'ssh-title'); sec.hidden = true
    var wrap = el('div', 'ssh-wrap admin-page-layout')
    var head = el('header', 'ssh-head'), left = el('div')
    R.h1 = el('h1', 'ssh-title', 'Shipping · الشحن'); R.h1.id = 'ssh-title'; R.h1.tabIndex = -1
    add(left, R.h1, el('p', 'ssh-lead', 'Delivery fees, free delivery and where the shop delivers. The shop’s server decides every fee at checkout from these settings; the bank is charged that number. · رسوم التوصيل والتوصيل المجاني والمحافظات. يحسب الخادم الرسوم عند إتمام الطلب.'))
    R.back = el('button', 'ssh-btn', '← Back · رجوع'); R.back.type = 'button'
    R.back.addEventListener('click', guard(function () { closePanel(true) }))
    add(head, left, R.back)
    R.status = el('p', 'ssh-status'); R.status.setAttribute('role', 'status'); R.status.setAttribute('aria-live', 'polite')
    add(wrap, head, R.status)

    var form = el('form', 'ssh-form'); form.noValidate = true; form.setAttribute('autocomplete', 'off')
    form.addEventListener('submit', guard(function (e) { e.preventDefault(); save() }))
    form.addEventListener('input', guard(function () {
      if (!S.saving && R.status.getAttribute('data-bad')) setNote('', false)
      drawZones(); drawFoot(); previewSoon()
    }))
    form.addEventListener('change', guard(function () { drawZones(); drawFoot(); previewSoon() }))
    R.form = form

    // 1. fees
    var c1 = el('div', 'ssh-card')
    c1.appendChild(el('h2', '', 'Fees · الرسوم'))
    var g1 = el('div', 'ssh-grid')
    R.base = input('ssh_base', 12, 'ltr', 'decimal')
    g1.appendChild(field('Base delivery fee (KWD) · رسوم التوصيل الأساسية (د.ك)', R.base))
    R.free = input('ssh_free', 12, 'ltr', 'decimal'); R.free.placeholder = 'Never · أبدًا'
    g1.appendChild(field('Free delivery from (KWD, after discounts) · توصيل مجاني من (د.ك بعد الخصم)', R.free))
    c1.appendChild(g1)
    c1.appendChild(el('p', 'ssh-hint', 'The base fee is the same number as on the Checkout screen. Free delivery counts the goods after every discount; an order at exactly that amount is free. Empty means delivery is never free. · الرسوم الأساسية هي نفسها في شاشة إتمام الطلب. التوصيل المجاني يُحسب على قيمة المنتجات بعد الخصم.'))
    form.appendChild(c1)

    // 2. governorates
    var c2 = el('div', 'ssh-card')
    c2.appendChild(el('h2', '', 'Governorates · المحافظات'))
    c2.appendChild(el('p', 'ssh-hint', 'Switch delivery off and orders to that governorate are refused. An empty fee uses the base fee. The delivery time is shown to shoppers: plain text, no prices. · عند إيقاف التوصيل تُرفض الطلبات لتلك المحافظة. الرسوم الفارغة تعني الرسوم الأساسية.'))
    R.zones = {}
    GOVS.forEach(function (g) {
      var row = el('div', 'ssh-zone'); row.setAttribute('data-zone', g[0])
      var top = el('div', 'ssh-zone-top')
      var name = el('h3', '', g[1] + ' · ' + g[2])
      var chk = el('label', 'ssh-check'), on = el('input'); on.type = 'checkbox'; on.name = 'ssh_on_' + g[0]
      add(chk, on, document.createTextNode('Deliver here · التوصيل متاح'))
      add(top, name, chk)
      var more = el('div', 'ssh-grid ssh-zone-more')
      var fee = input('ssh_fee_' + g[0], 12, 'ltr', 'decimal')
      var en = input('ssh_en_' + g[0], 120, 'ltr'); en.lang = 'en'; en.placeholder = 'e.g. 1-2 days'
      var ar = input('ssh_ar_' + g[0], 120, 'rtl'); ar.lang = 'ar'; ar.placeholder = 'مثال: خلال يوم أو يومين'
      add(more, field('Fee (KWD) · الرسوم (د.ك)', fee), field('Delivery time, English · مدة التوصيل بالإنجليزية', en), field('Delivery time, Arabic · مدة التوصيل بالعربية', ar))
      add(row, top, more)
      c2.appendChild(row)
      R.zones[g[0]] = { row: row, on: on, fee: fee, en: en, ar: ar }
    })
    form.appendChild(c2)

    // 3. what a customer pays
    var c3 = el('div', 'ssh-card')
    c3.appendChild(el('h2', '', 'What a customer pays · ما يدفعه العميل'))
    c3.appendChild(el('p', 'ssh-hint', 'Worked out by the shop’s server from the settings above, before you save, with the same rule the checkout uses. · يحسبها الخادم من الإعدادات أعلاه قبل الحفظ، بالقاعدة نفسها.'))
    var g3 = el('div', 'ssh-grid')
    R.goods = input('ssh_goods', 12, 'ltr', 'decimal'); R.goods.value = '10.000'
    g3.appendChild(field('Goods after discount (KWD) · قيمة المنتجات بعد الخصم (د.ك)', R.goods))
    R.zoneSel = el('select'); R.zoneSel.name = 'ssh_probe'
    GOVS.forEach(function (g) { var o = el('option', '', g[1] + ' · ' + g[2]); o.value = g[0]; R.zoneSel.appendChild(o) })
    g3.appendChild(field('Governorate for the free-delivery rows · المحافظة لصفوف التوصيل المجاني', R.zoneSel))
    c3.appendChild(g3)
    var tw = el('div', 'ssh-tablewrap'), tb = el('table', 'ssh-table'), th = el('thead'), hr = el('tr')
    ;['Governorate · المحافظة', 'Goods · المنتجات', 'Delivery · التوصيل', 'Total · الإجمالي'].forEach(function (t) { var c = el('th', '', t); c.scope = 'col'; hr.appendChild(c) })
    th.appendChild(hr); tb.appendChild(th)
    R.pbody = el('tbody'); tb.appendChild(R.pbody); tw.appendChild(tb); c3.appendChild(tw)
    R.ptable = tb; tb.setAttribute('aria-live', 'polite')
    R.pnote = el('p', 'ssh-pnote')
    c3.appendChild(R.pnote)
    form.appendChild(c3)

    // 4. what is not here
    var c4 = el('div', 'ssh-card')
    c4.appendChild(el('h2', '', 'Express delivery · التوصيل السريع'))
    c4.appendChild(el('p', 'ssh-note', 'Not available yet: the shop’s checkout cannot offer a second delivery choice, so an express fee could not be charged safely. · غير متاح حاليًا: صفحة الدفع لا تتيح خيار توصيل ثانٍ.'))
    form.appendChild(c4)

    var foot = el('div', 'ssh-foot')
    R.save = el('button', 'ssh-btn ssh-btn--primary', 'Save shipping · حفظ الشحن'); R.save.type = 'submit'
    R.reload = el('button', 'ssh-btn', 'Reload from server · إعادة التحميل'); R.reload.type = 'button'
    R.reload.addEventListener('click', guard(function () {
      if (dirty() && !window.confirm('Discard the changes that are not saved? · تجاهل التغييرات غير المحفوظة؟')) return
      load()
    }))
    R.dirty = el('span', 'ssh-dirty')
    add(foot, R.save, R.reload, R.dirty)
    form.appendChild(foot)
    form.hidden = true
    wrap.appendChild(form)
    sec.appendChild(wrap)
    return sec
  }
  function mount() {
    var main = document.querySelector('main.admin-content')
    if (!main) return false
    ensureStyle()
    if (!panel) panel = build()
    if (panel.parentNode !== main) main.appendChild(panel)
    return true
  }
  function openPanel() {
    if (S.open) return
    if (!mount()) return
    S.open = true
    panel.hidden = false
    document.body.setAttribute(OPEN, 'open')
    try { window.scrollTo(0, 0) } catch (e) { /* no scrolling */ }
    try { R.h1.focus({ preventScroll: true }) } catch (e) { /* focus is a courtesy */ }
    if (!S.loaded) load(); else { drawFoot(); previewSoon(0) }
  }
  function closePanel(focusBack) {
    if (!S.open) return
    S.open = false
    S.pseq++
    if (S.ptimer) { clearTimeout(S.ptimer); S.ptimer = 0 }
    if (panel) panel.hidden = true
    document.body.removeAttribute(OPEN)
    if (focusBack) { var b = document.querySelector('[' + BTN + ']'); if (b) { try { b.focus() } catch (e) { /* courtesy */ } } }
  }

  // ------------------------------------------------------------------- entry
  function entryHead() {
    var hs = document.querySelectorAll('main.admin-content .admin-page h1'), i
    for (i = 0; i < hs.length; i++) {
      if (HEADS.indexOf(String(hs[i].textContent || '').replace(/\s+/g, ' ').trim()) >= 0 && shown(hs[i])) { var h = hs[i].closest('.admin-page-header'); if (h) return h }
    }
    return null
  }
  function ensure() {
    var have = document.querySelector('[' + BTN + ']')
    if (S.open) { if (!panel || !panel.isConnected) closePanel(false); return }
    if (panel && !document.querySelector('main.admin-content')) {
      // signed out: nothing typed is kept
      panel = null; R = {}; S.loaded = false; S.loading = false; S.saving = false; S.doc = null; S.saved = ''; S.seq++; S.pseq++
    }
    var head = entryHead()
    if (!head) { if (have) have.remove(); return }
    ensureStyle()
    if (have && head.contains(have)) return
    if (have) have.remove()
    var b = el('button', 'ssh-open', 'Shipping · الشحن'); b.type = 'button'; b.setAttribute(BTN, '1')
    b.setAttribute('aria-label', 'Shipping: delivery fees, free delivery and governorates · الشحن')
    b.addEventListener('click', guard(openPanel))
    head.appendChild(b)
  }
  // any click on the menu leaves the panel before React handles it
  document.addEventListener('click', function (ev) {
    if (!S.open) return
    var t = ev.target && ev.target.closest ? ev.target.closest(NAV) : null
    if (t) closePanel(false)
  }, true)
  // a tab closed with unsaved changes asks first (the browser's own question; nothing is stored here)
  window.addEventListener('beforeunload', function (e) {
    try { if (S.open && dirty()) { e.preventDefault(); e.returnValue = '' } } catch (x) { /* never block leaving */ }
  })

  try {
    Object.defineProperty(window, '__sportaShipping', { value: { version: 1, toFils: toFils, kwd: kwd }, enumerable: false, configurable: false })
  } catch (e) { return }
  function start() {
    setInterval(function () { if (document.hidden) return; try { ensure() } catch (e) { /* the page keeps working without it */ } }, 500)   // a hidden tab has nobody to add a button for
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN SHIPPING - end =============================================== */

/* ===== ADMIN KNET REFUNDS - begin ========================================
 * KNET payment records in the compiled live admin (KNET-K063-CHECK.md B1, B2, B3, B9, C2, C3; the server is
 * dropin/php-store/payment-records.php). Two places, both found by the compiled admin's own markup:
 *
 *   1. THE ORDER DRAWER (<aside role="dialog" aria-label="Order <track id>">): a "KNET payment" section at the end of its
 *      body, for a KNET order. It shows what KPay will show for the payment (Payment ID, Transaction ID, reference, auth
 *      code, the bank's result, the Merchant Track ID it was answered under and every one the order was sent under, the paid
 *      time in Kuwait time) and, for a paid or review order, the two actions the owner takes in the KPay portal and RECORDS
 *      here: a refund (KPay "Credit", all or part of it) and a void (always the whole payment). Second captures on the order
 *      (a customer charged twice) are listed with Dismiss, and are refunded through the same form with THEIR Payment ID.
 *        GET  knet_payment_record ?track_id=   -> {order, refunds[], alerts[], actions}
 *        POST knet_refund_record  {order_id, kind, payment_id, amount, kpay_reference, note, request_key}
 *        POST payment_alert_dismiss {alert_id, note}
 *   2. THE ORDERS SCREEN (its header h1 "Orders"): a panel under the header with the open second-capture alerts (each with
 *      its order number) and the daily KPay check export: a date range, a Kuwait or UTC day, Download CSV.
 *        GET  payment_alerts                  -> {ready, open, alerts[]}
 *        GET  knet_reconcile_export ?from=&to=&tz=   (text/csv)
 *
 * THE PAYMENT ID IS TYPED, never filled in: the same forcing function as the compiled "settle card payment" control (you
 * cannot type it without having found the transaction in KPay), and the server refuses one that is not the order's own or
 * an open second capture's. The amount is typed too ("Whole amount" fills in what is left). Every rule (KNET only, paid or
 * review, not more than was paid, a void is whole and never after a refund, what a whole refund does to the order) is the
 * SERVER's; this block draws what it answers and maps its refusal tokens to sentences.
 *
 * ONE SUBMISSION, ONE RECORD: the form carries a random request_key, made when the form is drawn and kept until the server
 * answers OK; the button is disabled while the request is out and a second press is ignored. A retry after a lost answer
 * sends the SAME key, and the server answers it as the replay it is (nothing recorded twice).
 *
 * WHEN THE SERVER DOES NOT HAVE THE ROUTES (this file can be deployed before the API release): the first time either place
 * appears, ONE probe goes out (GET payment_alerts). The live admin.php without payment-records.php answers 404 not_found: then
 * this block adds nothing and sends nothing else for the rest of the visit. A server that has the routes but not the
 * migration answers ready=false: the drawer says the database update is missing and offers no action.
 *
 * NO OBSERVER, NO TIMER LOOP. The drawer opens and the screen changes on a click or a key press, so a scan is scheduled on
 * those (capture phase, one animation frame, then at 120, 400 and 1200 ms while React renders) and twice after load for the
 * first screen. An idle admin changes nothing. textContent only; nothing in web storage; links are paths. English, as the
 * live admin is; each text line takes its own direction (dir=auto). Colours: the admin's accent (--admin-action), rose for
 * a refusal, amber for an alert; a dark variant keyed on html.dark / html[data-theme=dark] like the other admin panels.
 */
;(function () {   // leading ; - the block above ends in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaKnetRefund) return
  try { Object.defineProperty(window, '__sportaKnetRefund', { value: 1, enumerable: false, configurable: false }) } catch (e) { return }

  var API = '/api/admin.php'
  var SEC = 'data-sporta-knet-refund'      // the drawer section (value: the track id it shows)
  var PANEL = 'data-sporta-knet-orders'    // the Orders screen panel
  var STYLE = 'data-sporta-knet-refund-style'
  var TRACK = /^[A-Za-z0-9]{1,30}$/
  var probe = 'unknown'                    // unknown | asking | present | absent
  var queued = false
  var MSG = {
    payment_id_required: 'Type the KNET Payment ID exactly as KPay shows it.',
    payment_id_mismatch: 'That Payment ID is not this order\'s payment, nor an open second charge on it. Check the order and the Payment ID in KPay.',
    amount_required: 'Type the amount in KWD, with at most three decimals (for example 12.500).',
    refund_exceeds_payment: 'That is more than is left to refund on this payment.',
    void_must_be_full: 'A void cancels the whole payment. Type the full amount, or record a refund instead.',
    void_after_refund: 'This payment already has a refund recorded, so it cannot also have been voided. Record a refund.',
    amount_must_match_capture: 'A second charge is given back whole: type the amount KNET captured for it.',
    order_already_refunded: 'This order is already refunded or voided.',
    order_not_paid: 'Only a paid order, or one under review, can have a refund or a void recorded.',
    not_a_knet_order: 'Only KNET orders are refunded in KPay.',
    invalid_kind: 'Choose Refund or Void.',
    invalid_kpay_reference: 'The KPay reference may hold letters, digits, dot, dash and underscore only.',
    request_key_required: 'Reload the page and try again.',
    request_key_reused: 'Reload the page and try again.',
    refunds_migration_missing: 'The shop database has not been updated for refunds yet (refunds.mysql.sql). Nothing was recorded.',
    order_not_found: 'Order not found. Refresh the list.',
    alert_already_resolved: 'That alert was already closed.',
    alert_not_found: 'That alert no longer exists. Refresh the list.',
    invalid_dates: 'Choose a start and an end date, at most 92 days apart.',
    too_many_rows: 'More than 5,000 orders in that range. Choose a shorter one.',
    not_signed_in: 'Your sign-in has ended. Sign in again.',
    bad_request: 'The request was refused. Reload the page and try again.'
  }
  var STATUS = { paid: 'Paid', pending: 'Pending', failed: 'Failed', review: 'Under review', refunded: 'Refunded', voided: 'Voided' }

  // ----------------------------------------------------------------- helpers
  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    if (tag === 'p' || tag === 'h3' || tag === 'li' || tag === 'label') n.setAttribute('dir', 'auto')
    return n
  }
  function add(p) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) p.appendChild(arguments[i]); return p }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild) }
  function clean(s, max) { return String(s == null ? '' : s).replace(/[\u202a-\u202e\u2066-\u2069]/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 200) }
  function token(b) { var e = b && b.error; return typeof e === 'string' && /^[a-z_]{1,60}$/.test(e) ? e : '' }
  function kd(v) { var s = clean(v, 20); return /^\d{1,7}\.\d{3}$/.test(s) ? s + ' KWD' : (s ? s : '-') }
  function key() {
    var b = new Uint8Array(16)
    try { crypto.getRandomValues(b) } catch (e) { for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256) }
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2) }).join('')
  }
  function call(route, body) {
    return fetch(API + '?r=' + route, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: Object.assign({ 'X-Sporta-Admin': '1' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) { return { ok: r.ok, status: r.status, body: j } })
    }).catch(function () { return { ok: false, status: 0, body: null } })
  }
  function failText(r) {
    var t = token(r.body)
    if (r.status === 0) return 'Could not reach the server. Check the connection and try again.'
    if (r.status === 401) return MSG.not_signed_in
    if (r.status === 429) return 'Too many requests. Wait a minute, then try again.'
    return MSG[t] || 'The server could not do that (' + (t || 'HTTP ' + r.status) + ').'
  }
  function btn(cls, text, fn) { var b = el('button', 'skr-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b }
  function kv(dl, label, value) {
    if (value == null || value === '') return
    add(dl, el('dt', null, label), el('dd', null, value))
  }

  function style() {
    if (document.querySelector('style[' + STYLE + ']')) return
    var s = document.createElement('style')
    s.setAttribute(STYLE, '')
    s.textContent = [
      '.skr{--skr-bg:#fff;--skr-soft:#f7f8fa;--skr-line:#d9dfe5;--skr-text:#18212a;--skr-muted:#556274;--skr-action:var(--admin-action,#4f46e5);--skr-on-action:#fff;',
      '--skr-err:#be123c;--skr-err-bg:#fde8ee;--skr-warn:#8a4b00;--skr-warn-bg:#fdf0d9;--skr-ok:#166534;--skr-ok-bg:#e3f5e9;',
      'border:1px solid var(--skr-line);border-radius:12px;background:var(--skr-bg);color:var(--skr-text);padding:14px 16px;font-size:14px;line-height:1.5}',
      '.skr *{box-sizing:border-box}',
      '.skr h3{margin:0 0 8px;font-size:15px;font-weight:700}',
      '.skr h4{margin:14px 0 6px;font-size:13px;font-weight:700;color:var(--skr-muted);text-transform:uppercase;letter-spacing:.06em}',
      '.skr dl{margin:0;display:grid;grid-template-columns:minmax(0,auto) minmax(0,1fr);gap:4px 14px}',
      '.skr dt{color:var(--skr-muted)}.skr dd{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}',
      '.skr ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}',
      '.skr li{border:1px solid var(--skr-line);border-radius:8px;padding:8px 10px;background:var(--skr-soft)}',
      '.skr-alert{border-color:#f0c47a!important;background:var(--skr-warn-bg)!important;color:var(--skr-warn)}',
      '.skr-note{margin:8px 0 0;padding:8px 10px;border-radius:8px;font-size:13px}',
      '.skr-note[data-tone="bad"]{background:var(--skr-err-bg);color:var(--skr-err)}',
      '.skr-note[data-tone="ok"]{background:var(--skr-ok-bg);color:var(--skr-ok)}',
      '.skr-note[data-tone="warn"]{background:var(--skr-warn-bg);color:var(--skr-warn)}',
      '.skr-form{margin-top:10px;display:grid;gap:8px}',
      '.skr-form label{display:grid;gap:4px;font-size:13px;color:var(--skr-muted)}',
      '.skr-form input[type=text],.skr-form input[type=date],.skr-form select{min-height:44px;border:1px solid var(--skr-line);border-radius:8px;padding:8px 10px;font:inherit;color:var(--skr-text);background:var(--skr-bg)}',
      '.skr-kinds{display:flex;gap:16px;flex-wrap:wrap}.skr-kinds label{display:flex;align-items:center;gap:6px;color:var(--skr-text)}',
      '.skr-check{display:flex!important;grid-template-columns:none!important;align-items:flex-start;gap:8px!important;color:var(--skr-text)!important}',
      '.skr-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.skr-btn{min-height:44px;padding:8px 14px;border-radius:8px;border:1px solid var(--skr-line);background:var(--skr-bg);color:var(--skr-text);font:inherit;font-weight:600;cursor:pointer}',
      '.skr-btn--main{background:var(--skr-action);border-color:var(--skr-action);color:var(--skr-on-action)}',
      '.skr-btn[disabled]{opacity:.55;cursor:default}',
      '.skr-btn:focus-visible{outline:2px solid var(--skr-action);outline-offset:2px}',
      '[' + PANEL + ']{margin:0 0 4px}',
      ':is(html.dark,html[data-theme="dark"]) .skr{--skr-bg:#14171c;--skr-soft:#1b2027;--skr-line:#2f3742;--skr-text:#e7ebf0;--skr-muted:#a3adba;--skr-err-bg:#3a1520;--skr-err:#fda4b4;--skr-warn-bg:#3a2a10;--skr-warn:#f5c977;--skr-ok-bg:#12301d;--skr-ok:#86efac}'
    ].join('')
    document.head.appendChild(s)
  }

  // ------------------------------------------------------------------- probe
  // One question per visit: does this server have the routes? 404 = no (add nothing, ask nothing more).
  function ensureProbe(then) {
    if (probe === 'present') return then()
    if (probe !== 'unknown') return
    probe = 'asking'
    call('payment_alerts').then(function (r) {
      probe = r.status === 404 ? 'absent' : 'present'
      if (probe === 'present') { lastAlerts = r.ok ? r.body : null; then() }
    })
  }
  var lastAlerts = null

  // ------------------------------------------------------------ the drawer
  function drawerOf() {
    var a = document.querySelector('aside[role="dialog"][aria-label^="Order "]')
    if (!a) return null
    var track = String(a.getAttribute('aria-label') || '').slice(6).trim()
    if (!TRACK.test(track)) return null
    var body = null
    for (var i = 0; i < a.children.length; i++) if (a.children[i].tagName === 'DIV') { body = a.children[i]; break }
    return { aside: a, body: body || a, track: track }
  }

  function drawerScan() {
    var d = drawerOf()
    if (!d) return
    var sec = d.body.querySelector('[' + SEC + ']')
    if (sec && sec.getAttribute(SEC) === d.track && sec.parentNode === d.body) return
    if (sec) sec.parentNode.removeChild(sec)
    ensureProbe(function () {
      var again = drawerOf()
      if (!again || again.track !== d.track || again.body.querySelector('[' + SEC + ']')) return
      style()
      var s = el('section', 'skr')
      s.setAttribute(SEC, d.track)
      s.setAttribute('aria-label', 'KNET payment')
      s.appendChild(el('p', null, 'Loading the KNET payment…'))
      again.body.appendChild(s)
      load(s, d.track)
    })
  }

  function load(s, track) {
    call('knet_payment_record&track_id=' + encodeURIComponent(track)).then(function (r) {
      if (!s.isConnected) return
      if (!r.ok) {
        if (r.status === 404 && token(r.body) === 'not_found') { probe = 'absent'; s.parentNode.removeChild(s); return }
        clear(s)
        s.appendChild(el('h3', null, 'KNET payment'))
        s.appendChild(note(failText(r), 'bad'))
        return
      }
      render(s, r.body, null)
    })
  }

  function note(text, tone) { var p = el('p', 'skr-note', text); p.setAttribute('data-tone', tone || 'ok'); p.setAttribute('role', tone === 'bad' ? 'alert' : 'status'); return p }

  function render(s, v, flash) {
    clear(s)
    var o = v && v.order
    // Not a KNET order: the section STAYS, empty and hidden, still marked with this track id, so the next scan (every click
    // or key press while the drawer is open) finds it and asks nothing. Removing it made each scan insert "Loading..." again
    // and send another knet_payment_record: up to four requests and a flash per click on a cash order (review 3, finding 1).
    if (!o || o.payment_method !== 'knet') { s.hidden = true; s.removeAttribute('aria-label'); s.className = ''; return }
    s.hidden = false
    s.appendChild(el('h3', null, 'KNET payment'))
    if (flash) s.appendChild(note(flash[0], flash[1]))
    var dl = el('dl')
    kv(dl, 'Status', STATUS[o.payment_status] || clean(o.payment_status, 20))
    kv(dl, 'Amount', kd(o.amount))
    if (o.refunded_amount && o.refunded_amount !== '0.000') { kv(dl, 'Refunded', kd(o.refunded_amount)); kv(dl, 'Left', kd(o.remaining)) }
    kv(dl, 'Payment ID', clean(o.payment_id, 60))
    kv(dl, 'Transaction ID', clean(o.transaction_id, 60))
    kv(dl, 'Reference', clean(o.reference, 60))
    kv(dl, 'Auth code', clean(o.auth_code, 30))
    kv(dl, 'Bank result', clean(o.bank_result, 60))
    kv(dl, 'Answered under', clean(o.gateway_track_id, 30))
    kv(dl, 'Sent to KNET as', (o.attempt_refs || []).map(function (x) { return clean(x, 30) }).join(', '))
    kv(dl, 'Paid (Kuwait time)', clean(o.paid_at_kuwait, 20))
    s.appendChild(dl)

    var alerts = Array.isArray(v.alerts) ? v.alerts : []
    if (alerts.length) {
      s.appendChild(el('h4', null, 'Second charges on this order'))
      var ul = el('ul')
      alerts.forEach(function (a) {
        var li = el('li', a.resolution ? '' : 'skr-alert')
        li.appendChild(el('div', null, 'Payment ID ' + clean(a.payment_id, 60) + (a.amount ? ' · ' + kd(a.amount) : '') + ' · ' + (a.resolution ? clean(a.resolution, 12) + ' by ' + clean(a.resolved_by, 120) : 'OPEN: the customer may have been charged twice. Refund it in KPay, then record it below with this Payment ID.')))
        if (!a.resolution) {
          var row = el('div', 'skr-row')
          row.appendChild(btn('', 'Dismiss (checked in KPay: not a second charge)', function (e) {
            var b = e.currentTarget
            if (b.disabled) return
            b.disabled = true
            call('payment_alert_dismiss', { alert_id: a.id }).then(function (r) {
              if (!r.ok) { b.disabled = false; li.appendChild(note(failText(r), 'bad')); return }
              reload(s, v.order.track_id, ['Alert dismissed.', 'ok'])
            })
          }))
          li.appendChild(row)
        }
        ul.appendChild(li)
      })
      s.appendChild(ul)
    }

    var refunds = Array.isArray(v.refunds) ? v.refunds : []
    if (refunds.length) {
      s.appendChild(el('h4', null, 'Refunds and voids recorded'))
      var ul2 = el('ul')
      refunds.forEach(function (x) {
        ul2.appendChild(el('li', null, (x.kind === 'void' ? 'Void ' : 'Refund ') + kd(x.amount) + ' · Payment ID ' + clean(x.payment_id, 60)
          + (x.scope === 'duplicate' ? ' (second charge)' : '') + (x.kpay_reference ? ' · KPay ' + clean(x.kpay_reference, 60) : '')
          + ' · ' + clean(x.by, 120) + ' · ' + clean(x.at, 20) + (x.note ? ' · ' + clean(x.note, 280) : '')))
      })
      s.appendChild(ul2)
    }

    var act = v.actions || {}
    var openAlerts = alerts.filter(function (a) { return !a.resolution }).length
    if (act.refund || act.void || openAlerts) s.appendChild(form(s, v, act))
    else if (act.why && act.why !== 'not_a_knet_order') s.appendChild(el('p', 'skr-note', MSG[act.why] || ''))
  }

  function reload(s, track, flash) {
    call('knet_payment_record&track_id=' + encodeURIComponent(track)).then(function (r) {
      if (!s.isConnected) return
      if (r.ok) render(s, r.body, flash); else s.appendChild(note(failText(r), 'bad'))
    })
  }

  function form(s, v, act) {
    var o = v.order
    var f = el('div', 'skr-form')
    f.appendChild(el('h4', null, 'Record a refund or void made in KPay'))
    f.appendChild(el('p', null, 'Do it in the KPay merchant portal first (Transaction > Order List or Posted Transactions). Then record it here. A refund or void of the whole payment of an order that has not shipped also cancels the order, tells the warehouse not to ship it, and puts its items back in stock.'))
    var kinds = el('div', 'skr-kinds')
    var name = 'skr-kind-' + key().slice(0, 8)
    var rRefund = el('input'); rRefund.type = 'radio'; rRefund.name = name; rRefund.value = 'refund'; rRefund.checked = true
    var rVoid = el('input'); rVoid.type = 'radio'; rVoid.name = name; rVoid.value = 'void'
    var l1 = el('label'); add(l1, rRefund, document.createTextNode('Refund (KPay Credit)'))
    var l2 = el('label'); add(l2, rVoid, document.createTextNode('Void (whole payment)'))
    add(kinds, l1, l2)
    f.appendChild(kinds)
    var pid = el('input'); pid.type = 'text'; pid.autocomplete = 'off'; pid.spellcheck = false; pid.maxLength = 60; pid.setAttribute('inputmode', 'numeric')
    var lp = el('label', null, 'KNET Payment ID (type it from KPay)'); lp.appendChild(pid); f.appendChild(lp)
    // Nothing left of the order's own payment (refunded or voided) but an open second charge: "whole" is that charge's.
    var openDup = (Array.isArray(v.alerts) ? v.alerts : []).filter(function (a) { return !a.resolution && a.amount })[0]
    var wholeAmt = o.remaining && o.remaining !== '0.000' ? o.remaining : (openDup ? openDup.amount : o.remaining)
    var amt = el('input'); amt.type = 'text'; amt.autocomplete = 'off'; amt.maxLength = 12; amt.setAttribute('inputmode', 'decimal'); amt.placeholder = clean(wholeAmt, 12)
    var la = el('label', null, 'Amount in KWD'); la.appendChild(amt)
    var whole = btn('', 'Whole amount (' + kd(wholeAmt) + ')', function () { amt.value = clean(wholeAmt, 12); dirty() })
    var ra = el('div', 'skr-row'); add(ra, la, whole); f.appendChild(ra)
    var ref = el('input'); ref.type = 'text'; ref.autocomplete = 'off'; ref.maxLength = 60
    var lr = el('label', null, 'KPay reference of the refund (optional)'); lr.appendChild(ref); f.appendChild(lr)
    var nt = el('input'); nt.type = 'text'; nt.maxLength = 280
    var ln = el('label', null, 'Note (optional, no customer details)'); ln.appendChild(nt); f.appendChild(ln)
    var ok = el('input'); ok.type = 'checkbox'
    var lc = el('label', 'skr-check'); add(lc, ok, document.createTextNode('I have made this refund or void in the KPay portal.')); f.appendChild(lc)
    var msg = el('div')
    var submit = btn('skr-btn--main', 'Record refund', null)
    f.appendChild(submit)
    f.appendChild(msg)

    // One key per submission: made now, renewed only when the form changes after a definite answer.
    var reqKey = key(), busy = false, answered = false
    function dirty() { if (answered) { reqKey = key(); answered = false } }
    ;[pid, amt, ref, nt].forEach(function (i) { i.addEventListener('input', dirty) })
    function kindNow() { return rVoid.checked ? 'void' : 'refund' }
    function sync() { submit.textContent = kindNow() === 'void' ? 'Record void' : 'Record refund'; dirty() }
    rRefund.addEventListener('change', sync); rVoid.addEventListener('change', sync)
    if (!act.void) rVoid.disabled = true
    if (!act.refund && !act.void) { rRefund.checked = true }

    submit.addEventListener('click', function () {
      if (busy) return
      clear(msg)
      if (!ok.checked) { msg.appendChild(note('Tick the box to confirm it was done in KPay first.', 'bad')); return }
      busy = true; submit.disabled = true
      call('knet_refund_record', {
        order_id: o.id, kind: kindNow(), payment_id: pid.value.trim(), amount: amt.value.trim(),
        kpay_reference: ref.value.trim(), note: nt.value, request_key: reqKey
      }).then(function (r) {
        busy = false; submit.disabled = false
        if (r.status === 0) { msg.appendChild(note(failText(r) + ' Press again: the same submission is sent, so it cannot be recorded twice.', 'bad')); return }
        answered = true
        if (!r.ok) { msg.appendChild(note(failText(r), 'bad')); return }
        var after = r.body && r.body.order ? r.body.order : {}
        var text = r.body && r.body.replayed ? 'Already recorded.' : 'Recorded.'
        if (after.payment_status === 'refunded' || after.payment_status === 'voided') {
          text += ' The order is now ' + (STATUS[after.payment_status] || '').toLowerCase()
            + (after.fulfilment_status === 'cancelled' && !after.shipped ? ', cancelled; the warehouse is told not to ship it and its items are back in stock.' : '.')
        } else if (after.refunded_amount && after.refunded_amount !== '0.000') {
          text += ' The order stays paid; ' + kd(after.refunded_amount) + ' refunded in all.'
        }
        render(s, r.body, [text + ' Close and reopen the order to see the list updated.', 'ok'])
      })
    })
    return f
  }

  // ------------------------------------------------------- the Orders screen
  function ordersHeader() {
    var hs = document.querySelectorAll('header.admin-page-header h1')
    for (var i = 0; i < hs.length; i++) {
      if (clean(hs[i].textContent, 40) !== 'Orders') continue
      var r = hs[i].getBoundingClientRect()
      if (r.width > 0 && r.height > 0) return hs[i].closest('header')
    }
    return null
  }
  function ordersScan() {
    var h = ordersHeader()
    var mine = document.querySelector('[' + PANEL + ']')
    if (!h) return
    if (mine && mine.previousElementSibling === h) return
    if (mine) mine.parentNode.removeChild(mine)
    ensureProbe(function () {
      var h2 = ordersHeader()
      if (!h2 || document.querySelector('[' + PANEL + ']')) return
      style()
      var p = el('section', 'skr')
      p.setAttribute(PANEL, '')
      p.setAttribute('aria-label', 'KNET checks')
      h2.parentNode.insertBefore(p, h2.nextSibling)
      panel(p)
    })
  }

  function today(offsetH) { var d = new Date(Date.now() + offsetH * 3600e3); return d.toISOString().slice(0, 10) }
  function panel(p) {
    clear(p)
    p.appendChild(el('h3', null, 'KNET checks'))
    var alertsBox = el('div')
    p.appendChild(alertsBox)
    function drawAlerts(b) {
      clear(alertsBox)
      if (!b || b.ready === false) { if (b && b.ready === false) alertsBox.appendChild(note(MSG.refunds_migration_missing, 'warn')); return }
      var list = Array.isArray(b.alerts) ? b.alerts : []
      if (!list.length) { alertsBox.appendChild(el('p', null, 'No second charges are waiting.')); return }
      alertsBox.appendChild(note(list.length + (list.length === 1 ? ' order has' : ' orders have') + ' a second KNET charge. Refund it in KPay, then open the order and record it.', 'warn'))
      var ul = el('ul')
      list.forEach(function (a) {
        ul.appendChild(el('li', 'skr-alert', 'Order ' + clean(a.track_id, 30) + ' · extra Payment ID ' + clean(a.payment_id, 60) + (a.amount ? ' · ' + kd(a.amount) : '') + ' · seen ' + clean(a.created_at, 20) + ' UTC'))
      })
      alertsBox.appendChild(ul)
    }
    if (lastAlerts) { drawAlerts(lastAlerts); lastAlerts = null }
    else call('payment_alerts').then(function (r) { if (p.isConnected) { if (r.ok) drawAlerts(r.body); else alertsBox.appendChild(note(failText(r), 'bad')) } })

    p.appendChild(el('h4', null, 'Daily KPay check: export'))
    p.appendChild(el('p', null, 'Every KNET order with anything in the range (placed, paid, refunded, or a second charge), with each Merchant Track ID it was sent to KNET under. Compare it with the KPay Transaction Detail Report (KNET.md, "Daily KPay reconciliation").'))
    var f = el('div', 'skr-form')
    var from = el('input'); from.type = 'date'; from.value = today(3)
    var to = el('input'); to.type = 'date'; to.value = today(3)
    var tz = el('select')
    ;[['kuwait', 'Kuwait days'], ['utc', 'UTC days']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; tz.appendChild(op) })
    var lf = el('label', null, 'From'); lf.appendChild(from)
    var lt = el('label', null, 'To'); lt.appendChild(to)
    var lz = el('label', null, 'Days in'); lz.appendChild(tz)
    var row = el('div', 'skr-row'); add(row, lf, lt, lz); f.appendChild(row)
    var out = el('div')
    var dl = btn('skr-btn--main', 'Download CSV', null)
    var busy = false
    dl.addEventListener('click', function () {
      if (busy) return
      clear(out)
      var a = from.value, b = to.value
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) { out.appendChild(note(MSG.invalid_dates, 'bad')); return }
      busy = true; dl.disabled = true
      var route = 'knet_reconcile_export&from=' + a + '&to=' + b + '&tz=' + (tz.value === 'utc' ? 'utc' : 'kuwait')
      fetch(API + '?r=' + route, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Sporta-Admin': '1' } }).then(function (r) {
        if (!r.ok) return r.json().catch(function () { return null }).then(function (j) { throw { status: r.status, body: j } })
        return r.blob()
      }).then(function (blob) {
        var url = URL.createObjectURL(blob)
        var link = document.createElement('a')
        link.href = url; link.download = 'knet-reconcile-' + a + '-to-' + b + '.csv'; link.style.display = 'none'
        document.body.appendChild(link); link.click(); document.body.removeChild(link)
        setTimeout(function () { URL.revokeObjectURL(url) }, 5000)
        out.appendChild(note('Downloaded.', 'ok'))
      }).catch(function (e) {
        out.appendChild(note(failText({ status: e && e.status || 0, body: e && e.body }), 'bad'))
      }).then(function () { busy = false; dl.disabled = false })
    })
    f.appendChild(dl)
    f.appendChild(out)
    p.appendChild(f)
  }

  // ------------------------------------------------------------------ wiring
  function scan() {
    if (probe === 'absent' || probe === 'asking') return
    drawerScan()
    ordersScan()
  }
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; try { scan() } catch (e) {} })
  }
  function soon() { schedule(); setTimeout(schedule, 120); setTimeout(schedule, 400); setTimeout(schedule, 1200) }
  document.addEventListener('click', soon, true)
  document.addEventListener('keyup', function (e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') soon() }, true)
  window.addEventListener('popstate', soon)
  setTimeout(soon, 600)
  setTimeout(soon, 2500)
})()
/* ===== ADMIN KNET REFUNDS - end =========================================== */
