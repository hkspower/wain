/**
 * The product banner's editor in /backends — 2026-10-01.
 *
 * Asked for as a bar editor "upper the categories, product image design"; out of
 * three rendered options the owner chose ONE PRODUCT BANNER, drawn on the home
 * page above "Shop by category" by assets/home-banner.js. This card is where it
 * is set: switch it on or off, pick the product (its photograph and price are
 * used), or upload a picture of your own, write the words in both languages, and
 * choose where the button goes.
 *
 * WHERE. On the panel's "Home slides" screen, between the hero slides and the
 * category pictures — the order the three appear on the home page. An overlay in
 * the shape of category-art.js: it adds one card, touches nothing that exists,
 * and removes itself when the panel swaps the "Home slides" heading out.
 *
 * THE PREVIEW IS THE SHOP'S OWN DRAWING (window.sportaHomeBanner.preview, from
 * home-banner.js), in English and in Arabic, so what is on screen before Save is
 * what a visitor gets after it. A chosen picture is read as a data: URL, never a
 * blob: one — the shop's Content-Security-Policy allows `data:` for images and
 * not `blob:` (category-art.js found that out the hard way).
 *
 * EVERY FIELD IS SENT ON EVERY SAVE. home_banner_save writes the whole row, so a
 * save that left a field out would blank it — the brand_save trap.
 *
 * NOTHING IS SENT UNTIL Save IS PRESSED, and the button is a save button by name
 * so panel-save-bar.js's one "Save changes" bar finds this card like any other.
 */
;(function () {
  'use strict'

  var U = window.sportaUpload
  if (!U || !U.call || !U.shrink) return   // half-published set: the card is absent, not broken

  var MARK = 'data-sporta-home-banner-editor'
  var LONGEST = 1600                       // px; a 900 kB cap on the server, ~825 kB from shrink()

  var ERR = {
    banner_unknown_product: 'that product is not on sale any more — choose another',
    banner_text_too_long: 'one of the lines is too long',
    banner_bad_link: 'the link must be a page in this shop, starting with /',
    banner_bad_format: 'that file is not a picture the shop can use',
    banner_not_an_image: 'that file is not a picture the shop can use',
    banner_too_large: 'the picture is too large — try a smaller one',
    banner_wrong_size: 'the picture must be between 200 and 3000 pixels on each side',
    banner_needs_content: 'choose a product, write a headline or upload a picture before switching it on',
    home_banner_not_ready: 'the shop is not set up for this yet',
  }
  function errText(e) {
    var code = e && e.message
    return ERR[code] || String(code || 'unknown error')
  }

  var CSS = ''
    + '.hbe{padding:16px;border-radius:12px;border:1px solid var(--border,#2a2d31)}'
    + '.hbe h3{margin:0 0 6px;font-size:18px}'
    + '.hbe-intro{margin:0 0 14px;font-size:13px;line-height:1.5;opacity:.8}'
    + '.hbe-section{display:flex;flex-direction:column;gap:10px;margin:0 0 16px}'
    + '.hbe-switch{display:flex;align-items:center;gap:10px;min-height:44px;font-weight:600;cursor:pointer}'
    + '.hbe-switch input{width:20px;height:20px;accent-color:var(--brand,#e0561c)}'
    + '.hbe-field{display:flex;flex-direction:column;gap:4px;font-size:13px;min-width:0}'
    + '.hbe-field>span{font-weight:600}'
    + '.hbe-field small{opacity:.7;font-size:12px}'
    + '.hbe input[type=text],.hbe select{width:100%;min-height:44px;padding:8px 10px;border-radius:8px;'
    + 'border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font:inherit;box-sizing:border-box}'
    + '.hbe select option{color:#171a1e}'
    + '.hbe-pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px}'
    + '.hbe-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}'
    + '.hbe-btn{min-height:44px;padding:9px 14px;border-radius:8px;border:1px solid var(--border,#2a2d31);'
    + 'background:transparent;color:inherit;font:inherit;cursor:pointer}'
    + '.hbe-btn.primary{background:var(--brand,#e0561c);border-color:transparent;color:#fff;font-weight:600}'
    + '.hbe-btn[disabled]{opacity:.5;cursor:default}'
    + '.hbe-pic{font-size:13px;opacity:.8}'
    + '.hbe-previews{display:flex;flex-direction:column;gap:12px}'
    + '.hbe-preview{max-width:760px}'
    + '.hbe-preview .sporta-home-banner{padding:0;margin:0;max-width:none}'
    + '.hbe-preview figcaption{font-size:11px;opacity:.7;margin-top:4px}'
    + '.hbe-note{margin:8px 0 0;font-size:13px;line-height:1.4}'

  function style() {
    if (document.getElementById('hbe-css')) return
    var s = document.createElement('style')
    s.id = 'hbe-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  // ---- state ---------------------------------------------------------------
  var card = null
  var state = null
  function fresh() {
    return {
      loaded: false,
      ready: true,
      max: { kicker: 60, title: 90, button: 30 },
      products: [],
      savedImage: null,          // the uploaded picture already in the row, as a URL
      form: blankForm(),
      pending: null,             // a newly chosen picture: { dataUri, width, height }
      removeImage: false,
      busy: false,
      note: '',
    }
  }
  function blankForm() {
    return {
      enabled: false, product: '', href: '',
      kicker: { en: '', ar: '' }, title: { en: '', ar: '' }, button: { en: '', ar: '' },
    }
  }

  function productBySlug(slug) {
    for (var i = 0; i < state.products.length; i++) if (state.products[i].slug === slug) return state.products[i]
    return null
  }

  /* The banner as the shop would draw it from what is on the form now. The
     server makes the same choices in store_home_banner_public(): an empty
     headline is the product's name, one empty language borrows the other, and
     an uploaded picture wins over the product's photograph. */
  function previewData() {
    var f = state.form
    var p = productBySlug(f.product)
    var title = {
      en: f.title.en.trim() || (p ? p.name_en : ''),
      ar: f.title.ar.trim() || (p ? p.name_ar : ''),
    }
    if (!title.en) title.en = title.ar
    if (!title.ar) title.ar = title.en
    var image = state.pending ? state.pending.dataUri
      : (!state.removeImage && state.savedImage) ? state.savedImage
      : (p && p.image) || null
    return {
      kicker: { en: f.kicker.en.trim(), ar: f.kicker.ar.trim() },
      title: title,
      button: { en: f.button.en.trim(), ar: f.button.ar.trim() },
      href: '#',
      image: image,
      price: p ? p.price : null,
      list_price: p ? p.list_price : null,
      on_sale: !!(p && p.on_sale),
    }
  }

  // ---- rendering -----------------------------------------------------------
  function render() {
    if (!card) return
    var keepFocus = document.activeElement && card.contains(document.activeElement)
      ? document.activeElement.getAttribute('data-hbe') : null
    card.textContent = ''
    card.appendChild(el('h3', '', 'Product banner'))
    card.appendChild(el('p', 'hbe-intro',
      'A banner on the home page, above “Shop by category”: a product’s photograph on one side, your headline and a button on the other. '
      + 'Leave the headline empty to use the product’s name.'))
    if (!state.loaded) { card.appendChild(el('p', 'hbe-note', 'Loading…')); return }
    if (!state.ready) {
      card.appendChild(el('p', 'hbe-note', 'This shop has not been set up for the banner yet (the table is missing).'))
      return
    }

    var f = state.form

    // on / off
    var sw = el('label', 'hbe-switch')
    var on = el('input')
    on.type = 'checkbox'
    on.checked = !!f.enabled
    on.setAttribute('data-hbe', 'enabled')
    on.addEventListener('change', function () { f.enabled = on.checked; state.note = ''; render() })
    sw.appendChild(on)
    sw.appendChild(el('span', '', 'Show the banner on the home page'))
    card.appendChild(sw)

    // product
    var sec1 = el('div', 'hbe-section')
    var pf = el('label', 'hbe-field')
    pf.appendChild(el('span', '', 'Product'))
    var sel = el('select')
    sel.setAttribute('data-hbe', 'product')
    var none = el('option', '', '— No product (headline and picture only) —')
    none.value = ''
    sel.appendChild(none)
    var found = false
    state.products.forEach(function (p) {
      var o = el('option', '', p.name_en + ' — KWD ' + Number(p.price).toFixed(3) + (p.on_sale ? ' (on sale)' : ''))
      o.value = p.slug
      if (p.slug === f.product) found = true
      sel.appendChild(o)
    })
    if (f.product && !found) {
      // Saved, but no longer on sale: the shop draws no product for it. Say so
      // rather than silently showing a different choice in the box.
      var gone = el('option', '', f.product + ' (not on sale — the banner shows no product)')
      gone.value = f.product
      sel.appendChild(gone)
    }
    sel.value = f.product
    sel.addEventListener('change', function () { f.product = sel.value; state.note = ''; render() })
    pf.appendChild(sel)
    pf.appendChild(el('small', '', 'Its photograph, price and page are used. The price always follows the product, sales included.'))
    sec1.appendChild(pf)

    // picture
    var pic = el('div', 'hbe-field')
    pic.appendChild(el('span', '', 'Picture'))
    var p = productBySlug(f.product)
    var status = state.pending ? 'Your new picture (' + state.pending.width + '×' + state.pending.height + ') — press Save to use it.'
      : (!state.removeImage && state.savedImage) ? 'Your uploaded picture.'
      : p && p.image ? 'The product’s photograph.'
      : p ? 'This product has no photograph yet — upload a picture, or the banner shows “photo coming soon”.'
      : 'No picture — upload one, or choose a product.'
    pic.appendChild(el('div', 'hbe-pic', status))
    var file = el('input')
    file.type = 'file'
    file.accept = 'image/*'
    file.hidden = true
    file.setAttribute('data-hbe-file', '1')
    file.addEventListener('change', function () { pick(file.files && file.files[0]) })
    pic.appendChild(file)
    var prow = el('div', 'hbe-row')
    var up = el('button', 'hbe-btn', 'Upload picture…')
    up.type = 'button'
    up.addEventListener('click', function () { file.click() })
    prow.appendChild(up)
    if (state.pending || (!state.removeImage && state.savedImage)) {
      var useProduct = el('button', 'hbe-btn', 'Use the product’s photograph')
      useProduct.type = 'button'
      useProduct.addEventListener('click', function () {
        state.pending = null
        state.removeImage = !!state.savedImage
        state.note = ''
        render()
      })
      prow.appendChild(useProduct)
    }
    pic.appendChild(prow)
    pic.appendChild(el('small', '', 'Any shape works: the picture fills its half of the banner, cropped to fit, keeping the top in view.'))
    sec1.appendChild(pic)
    card.appendChild(sec1)

    // words
    var sec2 = el('div', 'hbe-section')
    sec2.appendChild(pair('kicker', 'Small line above the headline', 'NEW SEASON', 'موسم جديد'))
    sec2.appendChild(pair('title', 'Headline', p ? p.name_en : 'Train in comfort', p ? p.name_ar : 'تمرّن براحة'))
    sec2.appendChild(pair('button', 'Button', 'Shop now', 'تسوّق الآن'))
    var lf = el('label', 'hbe-field')
    lf.appendChild(el('span', '', 'Link'))
    var link = el('input')
    link.type = 'text'
    link.value = f.href
    link.maxLength = 200
    link.dir = 'ltr'
    link.spellcheck = false
    link.setAttribute('autocapitalize', 'off')
    link.setAttribute('data-hbe', 'href')
    link.placeholder = p ? '/product/' + p.slug : '/shop'
    link.addEventListener('input', function () { f.href = link.value })
    lf.appendChild(link)
    lf.appendChild(el('small', '', 'A page in this shop, starting with / — for example /shop or /women. Leave it empty for the product’s own page.'))
    sec2.appendChild(lf)
    card.appendChild(sec2)

    // preview, in the shop's own drawing
    if (window.sportaHomeBanner && window.sportaHomeBanner.preview) {
      var sec3 = el('div', 'hbe-section')
      sec3.appendChild(el('div', 'hbe-field')).appendChild(el('span', '', 'Preview'))
      previewHost = el('div', 'hbe-previews')
      previewHost.setAttribute('data-hbe-preview', '1')
      sec3.appendChild(previewHost)
      card.appendChild(sec3)
      renderPreview()
    } else {
      previewHost = null
    }

    // save
    var row = el('div', 'hbe-row')
    var save = el('button', 'hbe-btn primary', 'Save banner')
    save.type = 'button'
    save.disabled = state.busy
    save.addEventListener('click', doSave)
    row.appendChild(save)
    card.appendChild(row)
    if (state.note) {
      var note = el('p', 'hbe-note', state.note)
      note.setAttribute('role', 'status')
      card.appendChild(note)
    }

    if (keepFocus) {
      var back = card.querySelector('[data-hbe="' + keepFocus + '"]')
      if (back) back.focus()
    }
  }

  var previewHost = null
  function renderPreview() {
    var host = previewHost
    if (!host || !window.sportaHomeBanner) return
    host.textContent = ''
    var data = previewData()
    if (data.title.en) {
      ;[['en', 'ltr', 'English'], ['ar', 'rtl', 'العربية']].forEach(function (x) {
        var fig = el('figure', 'hbe-preview')
        fig.style.margin = '0'
        var wrap = el('div')
        wrap.dir = x[1]
        wrap.lang = x[0]
        wrap.inert = true        // a picture of the banner, not a second way to leave the panel
        wrap.addEventListener('click', function (e) { e.preventDefault() }, true)
        wrap.appendChild(window.sportaHomeBanner.preview(data, x[0]))
        fig.appendChild(wrap)
        fig.appendChild(el('figcaption', '', x[2]))
        host.appendChild(fig)
      })
    } else {
      host.appendChild(el('p', 'hbe-pic', 'Choose a product or write a headline to see the banner.'))
    }
    if (!state.form.enabled) {
      host.appendChild(el('p', 'hbe-pic', 'Switched off: the home page does not show it until you tick the box above and save.'))
    }
  }
  var previewTimer = null
  function schedulePreview() {
    clearTimeout(previewTimer)
    previewTimer = setTimeout(renderPreview, 120)
  }

  /* An English and an Arabic box for one line. Typing updates the form and the
     preview only — rebuilding the card under a text box would take the caret
     (and a Tab in flight) with it. */
  function pair(key, label, phEn, phAr) {
    var f = state.form
    var box = el('div', 'hbe-field')
    box.appendChild(el('span', '', label))
    var grid = el('div', 'hbe-pair')
    ;[['en', 'English', 'ltr', phEn], ['ar', 'Arabic', 'rtl', phAr]].forEach(function (x) {
      var input = el('input')
      input.type = 'text'
      input.value = f[key][x[0]]
      input.maxLength = state.max[key] || 90
      input.dir = x[2]
      input.lang = x[0]
      input.placeholder = x[3] || ''
      input.setAttribute('aria-label', label + ' (' + x[1] + ')')
      input.setAttribute('data-hbe', key + '-' + x[0])
      input.addEventListener('input', function () { f[key][x[0]] = input.value; schedulePreview() })
      grid.appendChild(input)
    })
    box.appendChild(grid)
    return box
  }

  // ---- actions -------------------------------------------------------------
  function pick(file) {
    if (!file) return
    state.note = 'Preparing the picture…'
    render()
    U.shrink(file, { longest: LONGEST, qualities: [0.86, 0.78, 0.7, 0.6, 0.5] }).then(function (r) {
      if (r.width < 200 || r.height < 200) { state.note = 'That picture is too small — it needs at least 200 pixels on each side.'; render(); return }
      state.pending = r
      state.removeImage = false
      state.note = ''
      render()
    }, function (e) {
      state.note = 'Could not use that file: ' + ((e && e.message) || 'not a picture')
      render()
    })
  }

  function doSave() {
    if (state.busy) return
    var f = state.form
    var body = {
      enabled: !!f.enabled,
      product: f.product,
      kicker: { en: f.kicker.en, ar: f.kicker.ar },
      title: { en: f.title.en, ar: f.title.ar },
      button: { en: f.button.en, ar: f.button.ar },
      href: f.href.trim(),
      remove_image: !!state.removeImage,
    }
    if (state.pending) body.image = state.pending.dataUri
    state.busy = true
    state.note = 'Saving…'
    render()
    U.call('home_banner_save', 'POST', body).then(function () {
      state.busy = false
      state.pending = null
      state.removeImage = false
      return load(f.enabled ? 'Saved — the home page shows it on the next load.' : 'Saved. The banner is switched off, so the home page does not show it.')
    }, function (e) {
      state.busy = false
      state.note = 'Could not save: ' + errText(e)
      render()
    })
  }

  function load(note) {
    var products = fetch('/api/api.php?r=products', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : [] })
      .catch(function () { return [] })
    return Promise.all([U.call('home_banner_get', 'GET'), products]).then(function (res) {
      var d = res[0] || {}
      state.loaded = true
      state.ready = d.ready !== false
      if (d.max) state.max = d.max
      state.products = (Array.isArray(res[1]) ? res[1] : []).slice().sort(function (a, b) {
        return String(a.name_en).localeCompare(String(b.name_en))
      })
      var b = d.banner
      state.form = blankForm()
      state.savedImage = null
      if (b) {
        state.form.enabled = !!b.enabled
        state.form.product = b.product || ''
        state.form.href = b.href || ''
        ;['kicker', 'title', 'button'].forEach(function (k) {
          state.form[k] = { en: (b[k] && b[k].en) || '', ar: (b[k] && b[k].ar) || '' }
        })
        state.savedImage = b.image ? '/api/' + b.image : null
      }
      state.note = note || ''
      render()
    }, function (e) {
      state.loaded = true
      state.note = 'Could not load the banner: ' + errText(e)
      render()
    })
  }

  // ---- mounting, like category-art.js ---------------------------------------
  function slidesHeading() {
    var hs = document.querySelectorAll('.admin-content h1')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Home slides') return hs[i]
    }
    return null
  }

  function screenOf(head) {
    var host = document.querySelector('.admin-content')
    var n = head
    while (n && n.parentNode !== host) n = n.parentNode
    return n
  }

  var mounting = false
  function place() {
    if (mounting) return
    var head = slidesHeading()
    if (!head) {
      if (card && card.parentNode) { mounting = true; card.parentNode.removeChild(card); card = null; mounting = false }
      return
    }
    var screen = screenOf(head)
    if (!screen) return
    // Above the category pictures when that card is there (the home page's order);
    // moved there if it arrived after this one.
    var cats = screen.querySelector('[data-sporta-category-art]')
    if (card && card.parentNode === screen) {
      if (cats && card.nextElementSibling !== cats) { mounting = true; screen.insertBefore(card, cats); mounting = false }
      return
    }
    mounting = true
    style()
    card = el('div', 'hbe')
    card.setAttribute(MARK, '1')
    if (cats) screen.insertBefore(card, cats)
    else screen.appendChild(card)
    mounting = false
    state = fresh()
    render()
    load()
  }

  var timer = null
  new MutationObserver(function () {
    clearTimeout(timer)
    timer = setTimeout(place, 150)
  }).observe(document.body, { childList: true, subtree: true })
  place()
})()
