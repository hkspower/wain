/**
 * Sporta — the Edit product window, improved (2026-10-15, "improve product editor").
 *
 * The window is the bundle's own React form, which has no source here, so this adds to it from
 * outside and never moves or removes one of React's nodes. The owner chose all four:
 *
 *   1. DESCRIPTIONS AND A SALE. English and Arabic description boxes, a sale price, and the
 *      sale's first and last day. The bundle's form had none of them, so the website panel could
 *      not edit a description or a sale at all. They reach the server by being MERGED INTO the
 *      form's own product_save request (a fetch wrapper), so there is still one Save and one
 *      request, and the form's own validation, busy state and error banner all still apply.
 *      Values are read fresh from products_all when the window opens.
 *   2. CLEAR LABELS. The "On sale" tick is products.active — whether the product is SHOWN in the
 *      shop — and sat in a form that now has a real sale, so it reads "Shown in the shop" (and
 *      the catalogue table's column reads "In the shop", "Shown" / "Hidden"). Category is a
 *      fixed list (men, women, accessories, outerwear): it is free text in the bundle, and a
 *      typo such as "Women" quietly lost the women's no-exchange rule. A value outside the list
 *      that a product already has is kept as its own option, so nothing is lost by opening it.
 *   3. PHOTO PATHS UNDER "ADVANCED". The raw Image URL and More photos boxes are hidden behind
 *      one button; the photo drop zone below is the way in.
 *   4. ON A PHONE, Cancel / Save product stay pinned to the bottom of the window.
 *
 * A dated sale: the first day starts at 00:00 and the last day ends at 23:59:59, so "ends on
 * the 31st" includes the 31st.
 */
(function () {
  'use strict'

  if (!/^\/backends/.test(location.pathname)) return

  var MARK = 'data-spep'
  var API = '/api/admin.php?r='
  var CATS = [['men', 'Men'], ['women', 'Women'], ['accessories', 'Accessories'], ['outerwear', 'Outerwear']]
  var open = null   // { modal, id, fields: {desc_en, desc_ar, sale, from, to}, note }

  function el(tag, attrs, text) {
    var n = document.createElement(tag)
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k])
    if (text != null) n.textContent = text
    return n
  }

  /* ---------------------------------------------------------------- style */
  var css = el('style', { 'data-spep-style': '' })
  css.textContent = ''
    + '[data-spep-box]{grid-column:1/-1;display:grid;gap:12px;margin:4px 0 0}'
    + '@media (min-width:640px){[data-spep-sale]{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}}'
    + '[data-spep-sale]{display:grid;gap:12px}'
    + '[data-spep-box] label>span{display:block;margin-bottom:6px;font-size:12px;font-weight:700;color:#475569}'
    + '[data-spep-box] textarea,[data-spep-box] input,[data-spep-cat]{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;'
    + 'border-radius:12px;padding:10px 12px;font:inherit;font-size:16px;color:#0f172a;background:#fff;min-height:44px}'
    + '[data-spep-box] textarea{min-height:88px;resize:vertical;line-height:1.5}'
    + '[data-spep-box] textarea:focus,[data-spep-box] input:focus,[data-spep-cat]:focus{outline:2px solid #6366f1;outline-offset:1px}'
    + '[data-spep-hint]{font-size:12px;color:#64748b;margin:0}'
    + '[data-spep-note]{font-size:13px;font-weight:600;color:#b91c1c;margin:0}'
    + '[data-spep-note]:empty{display:none}'
    + '[data-spep-hidden]{display:none!important}'
    + '[data-spep-adv]{grid-column:1/-1;justify-self:start;border:0;background:none;padding:6px 0;min-height:36px;'
    + 'font:inherit;font-size:13px;font-weight:600;color:#4338ca;cursor:pointer;text-decoration:underline}'
    + '@media (max-width:639.98px){[data-spep-foot]{position:sticky;bottom:-20px;z-index:2;margin:20px -20px -20px !important;'
    + 'padding:12px 20px 16px;background:var(--spep-bg,#fff);box-shadow:0 -1px 0 rgba(15,23,42,.12)}}'
  document.head.appendChild(css)

  /* ------------------------------------------------------------- helpers */
  function labelled(modal, text) {
    var spans = modal.querySelectorAll('label > span')
    for (var i = 0; i < spans.length; i++) {
      var t = (spans[i].firstChild && spans[i].firstChild.nodeValue || spans[i].textContent).trim()
      if (t === text) return spans[i].parentElement
    }
    return null
  }
  function setReact(input, value) {
    var proto = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function digits(s) {
    return String(s || '').replace(/[٠-٩]/g, function (d) { return d.charCodeAt(0) - 0x660 })
      .replace(/[۰-۹]/g, function (d) { return d.charCodeAt(0) - 0x6f0 }).trim()
  }
  function field(label, node) {
    var l = el('label')
    l.appendChild(el('span', null, label))
    l.appendChild(node)
    return l
  }

  /* ------------------------------------------------- 1 + 2 + 3 + 4: dress */
  function dress(modal, h) {
    modal.setAttribute(MARK, '1')
    var isNew = h.textContent.trim() === 'Add a product'
    var slugLabel = labelled(modal, 'Web name')
    var slug = slugLabel ? slugLabel.querySelector('input').value.trim() : ''
    var st = { modal: modal, id: 0, isNew: isNew, ready: isNew }
    open = st

    // 2. "On sale" means shown in the shop.
    relabel(modal)

    // 2. Category from a fixed list.
    var catLabel = labelled(modal, 'Category')
    if (catLabel) {
      var input = catLabel.querySelector('input')
      var sel = el('select', { 'data-spep-cat': '', 'aria-label': 'Category' })
      var cur = (input.value || '').trim()
      var norm = cur.toLowerCase()
      sel.appendChild(el('option', { value: '' }, '— choose —'))
      CATS.forEach(function (c) { sel.appendChild(el('option', { value: c[0] }, c[1])) })
      if (norm && !CATS.some(function (c) { return c[0] === norm })) sel.appendChild(el('option', { value: cur }, cur))
      sel.value = CATS.some(function (c) { return c[0] === norm }) ? norm : cur
      if (cur && sel.value !== cur) setReact(input, sel.value)
      input.setAttribute('data-spep-hidden', '')
      input.setAttribute('tabindex', '-1')
      input.insertAdjacentElement('afterend', sel)
      sel.addEventListener('change', function () { setReact(input, sel.value) })
    }

    // 3. Photo paths behind one button.
    var img = labelled(modal, 'Image URL')
    var more = labelled(modal, 'More photos')
    if (img && more) {
      var set = [img, more].filter(function (l) { return (l.querySelector('input').value || '').trim() }).length
      var adv = el('button', { type: 'button', 'data-spep-adv': '', 'aria-expanded': 'false' },
        'Photo paths (advanced)' + (set ? ' · ' + set + ' set' : ''))
      img.setAttribute('data-spep-hidden', '')
      more.setAttribute('data-spep-hidden', '')
      img.insertAdjacentElement('beforebegin', adv)
      adv.addEventListener('click', function () {
        var show = adv.getAttribute('aria-expanded') !== 'true'
        adv.setAttribute('aria-expanded', show ? 'true' : 'false')
        ;[img, more].forEach(function (l) { show ? l.removeAttribute('data-spep-hidden') : l.setAttribute('data-spep-hidden', '') })
      })
    }

    // 1. Descriptions and a sale.
    var box = el('div', { 'data-spep-box': '' })
    var dEn = el('textarea', { maxlength: '2000', dir: 'ltr', 'data-spep-f': 'desc_en' })
    var dAr = el('textarea', { maxlength: '2000', dir: 'rtl', lang: 'ar', 'data-spep-f': 'desc_ar' })
    var sale = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'No sale', 'data-spep-f': 'sale_price' })
    var from = el('input', { type: 'date', 'data-spep-f': 'sale_starts_at' })
    var to = el('input', { type: 'date', 'data-spep-f': 'sale_ends_at' })
    box.appendChild(field('Description (English)', dEn))
    box.appendChild(field('Description (Arabic)', dAr))
    var row = el('div', { 'data-spep-sale': '' })
    row.appendChild(field('Sale price (KWD)', sale))
    row.appendChild(field('Sale starts', from))
    row.appendChild(field('Sale ends (last day)', to))
    box.appendChild(row)
    box.appendChild(el('p', { 'data-spep-hint': '' }, 'Leave the sale price empty for no sale. It must be below the price. Dates are optional.'))
    var note = el('p', { 'data-spep-note': '', role: 'alert' })
    box.appendChild(note)
    st.f = { desc_en: dEn, desc_ar: dAr, sale: sale, from: from, to: to }
    st.note = note
    var anchor = modal.querySelector('[data-spep-adv]') || img
    if (anchor) anchor.insertAdjacentElement('beforebegin', box)
    else (catLabel ? catLabel.parentElement : modal).appendChild(box)

    // 4. A pinned Save bar on phones.
    var saveBtn = [].slice.call(modal.querySelectorAll('button')).filter(function (b) { return b.textContent.trim() === 'Save product' })[0]
    if (saveBtn) {
      saveBtn.parentElement.setAttribute('data-spep-foot', '')
      modal.style.setProperty('--spep-bg', getComputedStyle(modal).backgroundColor)
    }

    if (!isNew && slug) {
      [dEn, dAr, sale, from, to].forEach(function (n) { n.disabled = true })
      fetch(API + 'products_all', { credentials: 'include', headers: { 'X-Sporta-Admin': '1' } })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (rows) {
          if (open !== st) return
          var p = (rows || []).filter(function (x) { return x.slug === slug })[0]
          ;[dEn, dAr, sale, from, to].forEach(function (n) { n.disabled = false })
          if (!p) { st.ready = false; note.textContent = 'Could not read this product’s description and sale; saving leaves them as they are.'; return }
          st.id = +p.id
          dEn.value = p.desc_en || ''
          dAr.value = p.desc_ar || ''
          sale.value = p.sale_price != null && p.sale_price !== '' ? Number(p.sale_price).toFixed(3) : ''
          from.value = (p.sale_starts_at || '').slice(0, 10)
          to.value = (p.sale_ends_at || '').slice(0, 10)
          st.ready = true
        })
        .catch(function () {
          if (open !== st) return
          ;[dEn, dAr, sale, from, to].forEach(function (n) { n.disabled = false })
          note.textContent = 'Could not read this product’s description and sale; saving leaves them as they are.'
        })
    }
  }

  function relabel(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    var t, edits = []
    while ((t = w.nextNode())) {
      var v = t.nodeValue.trim()
      if (v !== 'On sale' && v !== 'Off sale') continue
      var p = t.parentElement
      if (p && p.tagName === 'TH') { edits.push([t, 'In the shop']); continue }
      var lab = p && p.closest('label')
      if (!lab || !lab.querySelector('input[type=checkbox]')) continue
      var inModal = !!lab.closest('[' + MARK + ']')
      edits.push([t, inModal ? 'Shown in the shop' : (v === 'On sale' ? 'Shown' : 'Hidden')])
    }
    edits.forEach(function (e) { if (e[0].nodeValue !== e[1]) e[0].nodeValue = e[1] })
  }

  /* -------------------------------------------------------- the save merge */
  var saleRe = /^\d{1,7}(\.\d{1,3})?$/
  var base = window.fetch
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || ''
    var st = open
    if (!st || !st.ready || !st.modal.isConnected || url.indexOf('r=product_save') < 0 || !init || typeof init.body !== 'string') {
      return base.apply(this, arguments)
    }
    var body
    try { body = JSON.parse(init.body) } catch (e) { return base.apply(this, arguments) }
    if (st.isNew ? body.id : (+body.id !== st.id)) return base.apply(this, arguments)

    var f = st.f
    var sp = digits(f.sale.value)
    st.note.textContent = ''
    if (sp !== '' && !saleRe.test(sp)) {
      st.note.textContent = 'Sale price: type a number such as 6.500.'
      f.sale.focus()
      return Promise.resolve(new Response(JSON.stringify({ error: 'invalid_sale_price' }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    }
    if (sp !== '' && Number(sp) >= Number(body.price)) {
      st.note.textContent = 'The sale price must be below the price (' + Number(body.price).toFixed(3) + ' KWD).'
      f.sale.focus()
      return Promise.resolve(new Response(JSON.stringify({ error: 'sale_not_lower' }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    }
    if (sp !== '' && f.from.value && f.to.value && f.from.value > f.to.value) {
      st.note.textContent = 'The sale ends before it starts.'
      f.to.focus()
      return Promise.resolve(new Response(JSON.stringify({ error: 'sale_dates_backwards' }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    }
    body.desc_en = f.desc_en.value.trim()
    body.desc_ar = f.desc_ar.value.trim()
    body.sale_price = sp
    body.sale_starts_at = sp !== '' && f.from.value ? f.from.value + ' 00:00:00' : ''
    body.sale_ends_at = sp !== '' && f.to.value ? f.to.value + ' 23:59:59' : ''
    var next = {}
    for (var k in init) next[k] = init[k]
    next.body = JSON.stringify(body)
    return base.call(this, input, next).then(function (res) {
      if (!res.ok) {
        res.clone().json().then(function (j) {
          var why = { sale_not_lower: 'The sale price must be below the price.', invalid_sale_price: 'Sale price: type a number such as 6.500.',
            sale_dates_backwards: 'The sale ends before it starts.', invalid_date: 'A sale date could not be read.' }[j && j.error]
          if (why) st.note.textContent = why
        }).catch(function () {})
      }
      return res
    })
  }

  /* --------------------------------------------------------------- watch */
  function scan() {
    var hs = document.querySelectorAll('header > h3')
    for (var i = 0; i < hs.length; i++) {
      var t = hs[i].textContent.trim()
      if (t !== 'Edit product' && t !== 'Add a product') continue
      var modal = hs[i].closest('.overflow-y-auto') || hs[i].parentElement.parentElement
      if (modal && !modal.hasAttribute(MARK)) dress(modal, hs[i])
    }
    if (open && !open.modal.isConnected) open = null
    // The catalogue table only: its column header is the cheap thing to find first.
    var ths = document.querySelectorAll('.admin-content th')
    for (var j = 0; j < ths.length; j++) {
      var tx = ths[j].textContent.trim()
      if (tx === 'On sale' || tx === 'In the shop') relabel(ths[j].closest('table'))
    }
  }
  var queued = false
  new MutationObserver(function () {
    if (queued) return
    queued = true
    Promise.resolve().then(function () { queued = false; scan() })
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  scan()
})()
