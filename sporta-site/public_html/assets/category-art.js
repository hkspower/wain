/**
 * Category pictures — the four home-page tiles, editable from /backends.
 * 2026-09-29, "make category images editor at backend".
 *
 * WHERE. A card at the foot of the panel's "Home slides" screen, under the list
 * of hero slides: the two are the home page's pictures, and the owner asked for
 * this one "at backend" beside them. The panel is a prebuilt bundle with no
 * source here, so this is an overlay, in the shape of hero-slides.js and
 * brand-logos.js: it adds one card, touches nothing that exists, and removes
 * itself when the panel swaps the "Home slides" heading out.
 *
 * WHAT THE OWNER DOES. Per tile (Men, Women, Accessories, Outlet): choose ONE
 * wide picture, nudge which part of it is kept, see the desktop and the phone
 * crop, press Save. "Restore original" puts the shipped art back.
 *
 * WHAT THIS FILE DOES, AND WHY IN THE BROWSER. The tile is drawn at two shapes
 * (1216x988 on a computer; 1080x1080 on a phone, square since 2026-10-01, one tile
 * per row) and has an Arabic composition
 * that is the English one mirrored. The picture work happens here, on a canvas,
 * so the server needs no image library: the four sizes and the mirror are made,
 * each encoded twice (webp for browsers, jpeg for the <picture> fallback), and
 * sent as eight pictures in one request. The server measures every one of them
 * again — a wrong size or a non-image is refused by name.
 *
 * THE COPY SITS ON THE READING-START SIDE. The tile's title is drawn by the
 * storefront on the left in English, so the subject belongs on the RIGHT of the
 * uploaded picture (the Arabic mirror puts it on the left). The card says so.
 *
 * NOTHING IS SENT UNTIL Save IS PRESSED, and the button is a save button by name
 * on purpose: panel-save-bar.js finds cards by their save buttons, so the one
 * "Save changes" bar works here like everywhere else.
 */
;(function () {
  'use strict'

  var U = window.sportaUpload
  if (!U || !U.call) return   // half-published set: the card is absent, not broken

  var TILES = [
    { id: 'men', en: 'Men' },
    { id: 'women', en: 'Women' },
    { id: 'accessories', en: 'Accessories' },
    { id: 'outlet', en: 'Outlet' },
  ]
  var SIZES = { desktop: [1216, 988], mobile: [1080, 1080] }   // the phone tile is square since 2026-10-01 (one per row)
  var MAX_BYTES = 400000

  var TXT = {
    title: { en: 'Category pictures' },
    intro: {
      en: 'The four tiles on the home page. Choose one wide picture per tile with the subject on the right side — the title sits on the left. It is cropped for computers and phones and mirrored for Arabic.',
    },
    original: { en: 'Original artwork' },
    replaced: { en: 'Your picture is live' },
    choose: { en: 'Choose picture…' },
    restore: { en: 'Restore original' },
    save: { en: 'Save picture' },
    cancel: { en: 'Cancel' },
    lr: { en: 'Left ↔ right' },
    tb: { en: 'Top ↕ bottom' },
    desktop: { en: 'Computer' },
    phone: { en: 'Phone' },
    saving: { en: 'Saving…' },
    saved: { en: 'Saved — the shop shows it on the next load.' },
    restored: { en: 'Original restored.' },
    notReady: { en: 'This shop has not been set up for replacing pictures yet (the table is missing).' },
    noWebp: { en: 'This browser cannot make the picture format the shop needs. Safari on iPhone and iPad cannot make WebP pictures — use Chrome or Edge on a computer or an Android phone (Chrome on an iPhone is Safari underneath).' },
    notImage: { en: 'That file is not a picture.' },
    small: { en: 'That picture is small; it may look soft on large screens.' },
    failed: { en: 'Could not save: ' },
  }
  var ERR = {
    cat_art_wrong_size: { en: 'the picture came out the wrong size' },
    cat_art_too_large: { en: 'the picture is too large — try a simpler image' },
    cat_art_not_ready: { en: 'the shop is not set up for this yet' },
    cat_art_bad_format: { en: 'unsupported picture format' },
    cat_art_not_an_image: { en: 'that is not a picture' },
  }

  /* The panel is an English screen (it is mounted only under a heading that
   reads "Settings"), whatever the document's own lang says — the page default is
   Arabic for the storefront, so reading document.lang here rendered an Arabic
   card inside an English panel. */
  function t(k) { return TXT[k].en }
  function errText(code) { var e = ERR[code]; return e ? e.en : String(code) }

  var CSS = ''
    + '.cta{padding:16px;border-radius:12px;border:1px solid var(--border,#2a2d31)}'
    + '.cta h3{margin:0 0 6px;font-size:18px}'
    + '.cta-intro{margin:0 0 14px;font-size:13px;line-height:1.5;opacity:.8}'
    + '.cta-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr));gap:14px}'
    + '.cta-tile{min-width:0;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:10px;border:1px solid var(--border,#2a2d31)}'
    + '.cta-tile.editing{grid-column:1/-1}.cta-name{font-weight:700}'
    + '.cta-status{font-size:12px;opacity:.75}'
    + '.cta-thumb{width:100%;aspect-ratio:1216/988;object-fit:cover;border-radius:8px;background:#fff;display:block}'
    + '.cta-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}'
    + '.cta-btn{min-height:44px;padding:9px 14px;border-radius:8px;border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font:inherit;cursor:pointer}'
    + '.cta-btn.primary{background:var(--brand,#e0561c);border-color:transparent;color:#fff;font-weight:600}'
    + '.cta-btn[disabled]{opacity:.5;cursor:default}'
    + '.cta-previews{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}'
    + '.cta-previews figure{margin:0;max-width:100%}'
    + '.cta-previews figcaption{font-size:11px;opacity:.7;margin-top:2px}'
    + '.cta-previews canvas{max-width:100%;display:block;border-radius:6px;border:1px solid var(--border,#2a2d31)}'
    + '.cta-field{display:flex;flex-direction:column;gap:2px;font-size:12px}'
    + '.cta-field input{width:100%}'
    + '.cta-note{margin:8px 0 0;font-size:13px;line-height:1.4}'

  function style() {
    if (document.getElementById('cta-css')) return
    var s = document.createElement('style')
    s.id = 'cta-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  // ---- picture work ------------------------------------------------------
  function drawCover(img, w, h, fx, fy, mirror) {
    var c = document.createElement('canvas')
    c.width = w
    c.height = h
    var g = c.getContext('2d')
    var s = Math.max(w / img.width, h / img.height)
    var dw = img.width * s, dh = img.height * s
    if (mirror) { g.translate(w, 0); g.scale(-1, 1) }
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, (w - dw) * fx, (h - dh) * fy, dw, dh)
    return c
  }

  function encode(canvas, type) {
    var qs = type === 'image/webp' ? [0.86, 0.78, 0.68, 0.55] : [0.88, 0.8, 0.7, 0.55]
    var url = ''
    for (var i = 0; i < qs.length; i++) {
      url = canvas.toDataURL(type, qs[i])
      if (url.indexOf('data:' + type) !== 0) return null      // the browser could not make this format
      var b64 = url.slice(url.indexOf(',') + 1)
      if (b64.length * 0.75 <= MAX_BYTES) return url
    }
    return url
  }

  function build(img, fx, fy) {
    var images = {}
    var keys = ['desktop', 'mobile']
    for (var k = 0; k < keys.length; k++) {
      var wh = SIZES[keys[k]]
      var plain = drawCover(img, wh[0], wh[1], fx, fy, false)
      var flipped = drawCover(img, wh[0], wh[1], fx, fy, true)
      var pairs = [[keys[k], plain], [keys[k] + '-rtl', flipped]]
      for (var p = 0; p < pairs.length; p++) {
        var webp = encode(pairs[p][1], 'image/webp')
        var jpg = encode(pairs[p][1], 'image/jpeg')
        if (!webp || !jpg) return null
        images[pairs[p][0]] = { webp: webp, jpg: jpg }
      }
    }
    return images
  }

  // ---- state and rendering ----------------------------------------------
  var card = null
  var state = { ready: true, tiles: {}, cb: Date.now(), pending: {}, notes: {}, busy: {} }

  function thumbSrc(id) { return '/cats/desktop/art-' + id + '.webp?cb=' + state.cb }

  function render() {
    if (!card) return
    card.textContent = ''
    card.appendChild(el('h3', '', t('title')))
    card.appendChild(el('p', 'cta-intro', t('intro')))
    if (!state.ready) card.appendChild(el('p', 'cta-note', t('notReady')))
    var grid = el('div', 'cta-grid')
    TILES.forEach(function (tile) { grid.appendChild(renderTile(tile)) })
    card.appendChild(grid)
  }

  function renderTile(tile) {
    var id = tile.id
    var info = state.tiles[id] || {}
    var pend = state.pending[id]
    var box = el('div', 'cta-tile' + (pend ? ' editing' : ''))
    box.appendChild(el('div', 'cta-name', tile.en))
    box.appendChild(el('div', 'cta-status', info.replaced ? t('replaced') : t('original')))
    var img = el('img', 'cta-thumb')
    img.alt = ''
    img.src = thumbSrc(id)
    if (!pend) box.appendChild(img)

    var file = el('input')
    file.type = 'file'
    file.accept = 'image/*'
    file.hidden = true
    file.setAttribute('data-cta-file', id)
    file.addEventListener('change', function () { pick(id, file.files && file.files[0]) })
    box.appendChild(file)

    if (pend) {
      var prev = el('div', 'cta-previews')
      var fig1 = el('figure')
      var c1 = drawCover(pend.img, SIZES.desktop[0], SIZES.desktop[1], pend.fx, pend.fy, false)
      c1.style.width = '420px'
      c1.style.height = 'auto'
      fig1.appendChild(c1)
      fig1.appendChild(el('figcaption', '', t('desktop')))
      var fig2 = el('figure')
      var c2 = drawCover(pend.img, SIZES.mobile[0], SIZES.mobile[1], pend.fx, pend.fy, false)
      c2.style.width = '220px'
      c2.style.height = 'auto'
      fig2.appendChild(c2)
      fig2.appendChild(el('figcaption', '', t('phone')))
      prev.appendChild(fig1)
      prev.appendChild(fig2)
      box.appendChild(prev)
      box.appendChild(slider(t('lr'), pend.fx, function (v) { pend.fx = v; render() }))
      box.appendChild(slider(t('tb'), pend.fy, function (v) { pend.fy = v; render() }))
      if (pend.small) box.appendChild(el('p', 'cta-note', t('small')))
      var row = el('div', 'cta-row')
      var save = el('button', 'cta-btn primary', t('save'))
      save.type = 'button'
      save.disabled = !!state.busy[id]
      save.addEventListener('click', function () { doSave(id) })
      var cancel = el('button', 'cta-btn', t('cancel'))
      cancel.type = 'button'
      cancel.addEventListener('click', function () { delete state.pending[id]; state.notes[id] = ''; render() })
      row.appendChild(save)
      row.appendChild(cancel)
      box.appendChild(row)
    } else {
      var row2 = el('div', 'cta-row')
      var choose = el('button', 'cta-btn', t('choose'))
      choose.type = 'button'
      choose.addEventListener('click', function () { file.click() })
      row2.appendChild(choose)
      if (info.replaced) {
        var rest = el('button', 'cta-btn', t('restore'))
        rest.type = 'button'
        rest.disabled = !!state.busy[id]
        rest.addEventListener('click', function () { doReset(id) })
        row2.appendChild(rest)
      }
      box.appendChild(row2)
    }
    if (state.notes[id]) box.appendChild(el('p', 'cta-note', state.notes[id]))
    return box
  }

  function slider(label, value, onchange) {
    var f = el('label', 'cta-field')
    f.appendChild(el('span', '', label))
    var r = el('input')
    r.type = 'range'
    r.min = '0'
    r.max = '100'
    r.value = String(Math.round(value * 100))
    r.addEventListener('change', function () { onchange(Number(r.value) / 100) })
    f.appendChild(r)
    return f
  }

  function pick(id, file) {
    if (!file) return
    if (!/^image\//.test(file.type)) { state.notes[id] = t('notImage'); render(); return }
    // READ THE FILE AS A data: URL, NOT URL.createObjectURL. The site's
    // Content-Security-Policy says `img-src 'self' data: https://static…` and
    // names no blob:, so on the live server an <img> pointed at a blob URL never
    // loads — every file would have been reported "not a picture". The sandbox
    // sends no CSP header at all, so nothing local could have shown it; the rig
    // now sends the shipped policy on the panel's page.
    var reader = new FileReader()
    reader.onerror = function () { state.notes[id] = t('notImage'); render() }
    reader.onload = function () {
      var img = new Image()
      img.onload = function () {
        state.pending[id] = { img: img, fx: 0.5, fy: 0.5, small: img.width < SIZES.desktop[0] * 0.8 }
        state.notes[id] = ''
        render()
      }
      img.onerror = function () { state.notes[id] = t('notImage'); render() }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  function doSave(id) {
    var pend = state.pending[id]
    if (!pend || state.busy[id]) return
    var images = build(pend.img, pend.fx, pend.fy)
    if (!images) { state.notes[id] = t('noWebp'); render(); return }
    state.busy[id] = true
    state.notes[id] = t('saving')
    render()
    U.call('cat_art_save', 'POST', { tile: id, images: images }).then(function () {
      state.busy[id] = false
      delete state.pending[id]
      state.cb = Date.now()
      state.notes[id] = t('saved')
      return load(true)
    }, function (e) {
      state.busy[id] = false
      state.notes[id] = t('failed') + errText(e && e.message)
      render()
    })
  }

  function doReset(id) {
    if (state.busy[id]) return
    state.busy[id] = true
    U.call('cat_art_reset', 'POST', { tile: id }).then(function () {
      state.busy[id] = false
      state.cb = Date.now()
      state.notes[id] = t('restored')
      return load(true)
    }, function (e) {
      state.busy[id] = false
      state.notes[id] = t('failed') + errText(e && e.message)
      render()
    })
  }

  function load(keepNotes) {
    return U.call('cat_art_list', 'GET').then(function (d) {
      state.ready = !d || d.ready !== false
      state.tiles = {}
      ;((d && d.tiles) || []).forEach(function (x) { state.tiles[x.tile] = x })
      render()
    }, function () { render() })
  }

  // ---- mounting, like hero-slides.js ------------------------------------
  function slidesHeading() {
    var hs = document.querySelectorAll('.admin-content h1')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Home slides') return hs[i]
    }
    return null
  }

  /** The screen's own wrapper: the ancestor of the heading that is a direct
   *  child of .admin-content. The card is appended to it, so it takes the
   *  screen's own vertical rhythm (space-y-8) instead of inventing one. */
  function screenOf(head) {
    var host = document.querySelector('.admin-content')
    var n = head
    while (n && n.parentNode !== host) n = n.parentNode
    return n
  }

  var busy = false
  function place() {
    if (busy) return
    var head = slidesHeading()
    if (!head) {
      if (card && card.parentNode) { busy = true; card.parentNode.removeChild(card); card = null; busy = false }
      return
    }
    if (card && card.parentNode) return
    var screen = screenOf(head)
    if (!screen) return
    busy = true
    style()
    card = el('div', 'cta')
    card.setAttribute('data-sporta-category-art', '1')
    screen.appendChild(card)
    busy = false
    state.pending = {}
    state.notes = {}
    state.busy = {}
    state.cb = Date.now()
    render()
    load()
  }

  var timer = null
  var observer = new MutationObserver(function () {
    clearTimeout(timer)
    timer = setTimeout(place, 150)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  place()
})()
