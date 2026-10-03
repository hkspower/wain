/* Sporta — colour circles and size boxes on every product-grid card, 2026-10-03.
 *
 * ------------------------------------------------------------ THE OWNER'S CHOICES
 *
 * Asked and answered before a line of this was written:
 *   1. SIZES   every size the product has, as small boxes; a size with no stock is
 *              greyed and crossed out, as on the product page.
 *   2. COLOURS one filled round circle per colour of the same STYLE (Cloudsoft
 *              Leggings in navy, grey, onyx black ...). The card's own colour is
 *              ringed; tapping another circle opens that colour's product page.
 *   3. WHERE   in the white caption: name, then the colours, then the sizes, then
 *              the price row (with the orange + at its right). Cards get taller.
 *   4. TAP     tapping a size box ADDS THAT SIZE TO THE BAG, in one tap; a sold-out
 *              size does nothing.
 *
 * ------------------------------------------------------------ WHERE THE DATA COMES FROM
 *
 * ?r=products, the one request every grid overlay already makes (api-dedupe.js turns
 * the repeats into one). Since this file it carries, per product:
 *   colour        {key, en, ar, hex} — product_attrs if the owner set one, else read
 *                 off the slug's ending (store_colour_from_slug), else null
 *   style_key     the slug without its colour ending; null when there is no colour,
 *                 so a product with no colour is never grouped with anything
 *   size_options  [{size, in_stock}] in the shop's own size order — a boolean per
 *                 size, never a stock count
 * The siblings of a card are the rows with the same style_key, in slug order, one per
 * colour (the card's own product wins a tie). The row shows even for a style of ONE
 * colour, as a single ringed circle: that keeps what the old "● colour" line under the
 * name told the shopper (brand-badge.js drew it; these circles replaced it).
 *
 * ------------------------------------------------------------ ADDING TO THE BAG
 *
 * Through quick-add-size.js's own path (window.sportaCartAdd), so the + chooser and
 * these boxes make ONE kind of cart row — the bundle's own add when it can be reached,
 * a write plus a repainted badge on the server-drawn category pages, and a reload when
 * neither is possible. The fit is the product page's default for that garment
 * (window.sportaDefaultFit: 'slim' for leggings and tops, none for accessories), so a
 * size added here and the same size added on the product page are the same line.
 *
 * ------------------------------------------------------------ HOW IT KEEPS UP
 *
 * WORK ONCE PER CARD. grid-name-fit.js once froze scrolling by re-measuring every name
 * on every change; this file reads no layout at all, and a card it has drawn is skipped
 * by a key: the caption remembers the photo link's href it was built for. Only three
 * things ever write again:
 *   - the href changes (React re-used the node for another product) -> rebuilt
 *   - the box is no longer right before the price row (React re-rendered) -> re-inserted
 *   - the page's language changes -> labels rewritten in place, never rebuilt
 *
 * The size boxes carry a hidden "Size " in front of the letters so that their text is
 * never a bare "L": seven rigs press `button` with text /^L$/ on the product page, where
 * "Complete the look" cards now carry boxes too.
 *
 * DOM overlay on a page with no source here, same class of thing as brand-badge.js: it
 * only ADDS one block to a card's caption and removes only what it added.
 */
;(function () {
  'use strict'

  if (/^\/backends(\/|$)/.test(location.pathname)) return

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')
  var CARDS = 'main:not(.admin-content) div.grid > article'
  var HEX = /^#[0-9a-fA-F]{6}$/

  var T = {
    colours: { en: 'Colours', ar: 'الألوان' },
    sizes: { en: 'Sizes', ar: 'المقاسات' },
    sizePrefix: { en: 'Size ', ar: 'المقاس ' },
    oneSize: { en: 'One size', ar: 'مقاس واحد' },
    soldOut: { en: 'Sold out', ar: 'نفذت الكمية' },   /* the bundle's own two strings */
  }

  var bySlug = null      /* slug -> API row */
  var byStyle = null     /* style_key -> [rows with a colour], slug order */
  var colourName = {}    /* colour key -> {en, ar} */
  var lastLang = null
  var live = null

  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'ar' ? 'ar' : 'en' }
  function tr(k, l) { return T[k][l] }
  function nameOf(row, l) { return (l === 'ar' ? row.name_ar || row.name_en : row.name_en || row.name_ar) || row.slug }
  function sizeText(size, l) { return size === 'ONE' ? tr('oneSize', l) : size }
  function srText(size, l) { return size === 'ONE' ? '' : tr('sizePrefix', l) }

  function sizeLabel(row, size, inStock, l) {
    var what = size === 'ONE' ? tr('oneSize', l) : tr('sizePrefix', l) + size
    if (!inStock) return what + ' — ' + (l === 'ar' ? tr('soldOut', 'ar') : 'sold out')
    return l === 'ar'
      ? 'أضف ' + what + ' إلى الحقيبة — ' + nameOf(row, l)
      : 'Add ' + (size === 'ONE' ? what : 'size ' + size) + ' to bag — ' + nameOf(row, l)
  }

  function setAttr(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v) }
  function setText(el, v) { if (el.textContent !== v) el.textContent = v }

  function slugOfHref(href) {
    var m = /\/product\/([^/?#]+)/.exec(href || '')
    if (!m) return null
    try { return decodeURIComponent(m[1]) } catch (e) { return m[1] }
  }

  /* The same garment in its other colours: one row per colour key, slug order, the card's
     own product kept when another row has the same colour. */
  function siblings(row) {
    var list = (row.style_key && byStyle[row.style_key]) || [row]
    var seen = {}, out = []
    for (var i = 0; i < list.length; i++) {
      var r = list[i], k = r.colour.key
      if (seen[k] === undefined) { seen[k] = out.length; out.push(r) }
      else if (r.slug === row.slug) out[seen[k]] = r
    }
    return out
  }

  function build(row, photo) {
    var l = lang()
    var hasColour = !!(row.colour && row.colour.key)
    var sizes = Array.isArray(row.size_options) ? row.size_options : []
    if (!hasColour && !sizes.length) return null

    var box = document.createElement('div')
    box.className = 'cardopt'
    box.setAttribute('data-slug', row.slug)

    if (hasColour) {
      var cg = document.createElement('div')
      cg.className = 'cardopt-colours'
      cg.setAttribute('role', 'group')
      cg.setAttribute('aria-label', tr('colours', l))
      var en = /[?&]lang=en(&|#|$)/.test(photo.getAttribute('href') || '') ? '?lang=en' : ''
      var sibs = siblings(row)
      for (var i = 0; i < sibs.length; i++) {
        var s = sibs[i]
        var a = document.createElement('a')
        a.className = 'cardopt-colour'
        a.href = '/product/' + encodeURIComponent(s.slug) + en
        a.setAttribute('data-key', s.colour.key)
        var cn = colourName[s.colour.key] || { en: s.colour.en, ar: s.colour.ar }
        a.setAttribute('aria-label', cn[l] || cn.en || s.colour.key)
        a.setAttribute('title', cn[l] || cn.en || s.colour.key)
        if (s.slug === row.slug) a.setAttribute('aria-current', 'true')
        var disc = document.createElement('span')
        disc.className = 'cardopt-colour__disc'
        disc.style.background = HEX.test(s.colour.hex || '') ? s.colour.hex : '#888'
        a.appendChild(disc)
        cg.appendChild(a)
      }
      box.appendChild(cg)
    }

    if (sizes.length) {
      var sg = document.createElement('div')
      sg.className = 'cardopt-sizes'
      sg.setAttribute('role', 'group')
      sg.setAttribute('aria-label', tr('sizes', l))
      for (var j = 0; j < sizes.length; j++) {
        var size = String(sizes[j].size), inStock = sizes[j].in_stock === true
        var b = document.createElement('button')
        b.type = 'button'
        b.className = 'cardopt-size'
        b.setAttribute('data-size', size)
        b.setAttribute('aria-label', sizeLabel(row, size, inStock, l))
        if (!inStock) { b.disabled = true; b.setAttribute('title', tr('soldOut', l)) }
        var sr = document.createElement('span')
        sr.className = 'cardopt-sr'
        sr.textContent = srText(size, l)
        var tx = document.createElement('span')
        tx.className = 'cardopt-size__t'
        tx.textContent = sizeText(size, l)
        b.appendChild(sr)
        b.appendChild(tx)
        sg.appendChild(b)
      }
      box.appendChild(sg)
    }
    return box
  }

  /* Every card on the page, once. A card React has not finished drawing (no caption, no price
     row yet) is skipped WITHOUT a mark, so the next pass picks it up. */
  function scan() {
    var arts = document.querySelectorAll(CARDS)
    for (var i = 0; i < arts.length; i++) {
      var art = arts[i]
      var photo = art.firstElementChild
      if (!photo || photo.tagName !== 'A') continue
      var href = photo.getAttribute('href') || ''
      if (!/\/product\//.test(href)) continue
      var cap = photo.nextElementSibling
      if (!cap) continue
      var price = cap.querySelector(':scope > .price-card')
      if (!price) continue

      var had = cap.__cardoptBox
      if (cap.getAttribute('data-cardopt') === href && had !== undefined && (had === null || had.parentNode === cap)) {
        if (had && had.nextElementSibling !== price) cap.insertBefore(had, price)
        continue
      }

      if (had && had.parentNode === cap) cap.removeChild(had)
      var strays = cap.querySelectorAll(':scope > .cardopt')
      for (var k = 0; k < strays.length; k++) cap.removeChild(strays[k])

      var row = bySlug[slugOfHref(href)]
      var box = row ? build(row, photo) : null
      if (box) {
        cap.insertBefore(box, price)
        setAttr(cap, 'data-cardopt-on', '')
      } else if (cap.hasAttribute('data-cardopt-on')) {
        cap.removeAttribute('data-cardopt-on')
      }
      cap.__cardoptBox = box
      setAttr(cap, 'data-cardopt', href)
    }
  }

  /* The language changed under cards that were not re-rendered: every label is rewritten in
     place, and only where it differs. Nothing is rebuilt, so focus and the nodes survive. */
  function relabel() {
    var l = lang()
    var boxes = document.querySelectorAll('.cardopt[data-slug]')
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i], row = bySlug[box.getAttribute('data-slug')]
      if (!row) continue
      var cg = box.querySelector(':scope > .cardopt-colours')
      if (cg) {
        setAttr(cg, 'aria-label', tr('colours', l))
        var cs = cg.querySelectorAll('.cardopt-colour[data-key]')
        for (var c = 0; c < cs.length; c++) {
          var cn = colourName[cs[c].getAttribute('data-key')]
          if (!cn) continue
          setAttr(cs[c], 'aria-label', cn[l] || cn.en)
          setAttr(cs[c], 'title', cn[l] || cn.en)
        }
      }
      var sg = box.querySelector(':scope > .cardopt-sizes')
      if (sg) {
        setAttr(sg, 'aria-label', tr('sizes', l))
        var bs = sg.querySelectorAll('.cardopt-size[data-size]')
        for (var s = 0; s < bs.length; s++) {
          var b = bs[s], size = b.getAttribute('data-size')
          setAttr(b, 'aria-label', sizeLabel(row, size, !b.disabled, l))
          if (b.disabled) setAttr(b, 'title', tr('soldOut', l))
          var sr = b.querySelector('.cardopt-sr'), tx = b.querySelector('.cardopt-size__t')
          if (sr) setText(sr, srText(size, l))
          if (tx) setText(tx, sizeText(size, l))
        }
      }
    }
  }

  function announce(text) {
    if (!live) {
      live = document.createElement('div')
      live.className = 'cardopt-sr cardopt-live'
      live.setAttribute('role', 'status')
      live.setAttribute('aria-live', 'polite')
      document.body.appendChild(live)
    }
    live.textContent = ''
    setTimeout(function () { live.textContent = text }, 30)
  }

  /* ONE TAP ADDS THAT SIZE. Delegated, so a rebuilt card needs no listener of its own. */
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('.cardopt-size') : null
    if (!b) return
    e.preventDefault()
    if (b.disabled) return                                   /* sold out: nothing, even for a synthetic click */
    var box = b.closest('.cardopt')
    if (!box || !bySlug) return
    var now = Date.now()
    if (box.__busyUntil > now) return                         /* a double tap is one add */
    box.__busyUntil = now + 1200
    var row = bySlug[box.getAttribute('data-slug')]
    var add = window.sportaCartAdd, fitOf = window.sportaDefaultFit
    if (!row || typeof add !== 'function' || typeof fitOf !== 'function') return
    var cap = box.parentNode, photo = cap && cap.previousElementSibling
    var img = photo ? photo.querySelector(':scope > img:not([aria-hidden="true"])') || photo.querySelector('img') : null
    var size = b.getAttribute('data-size')
    var item = {
      slug: row.slug,
      name: { en: String(row.name_en || ''), ar: String(row.name_ar || '') },
      price: Number(row.price) || 0,
      image: img ? img.currentSrc || img.src || '' : '',
    }
    var how = add(item, size, fitOf(String(row.category || ''), String(row.name_en || '')))
    if (!how) return
    b.setAttribute('data-cardopt-added', '')
    setTimeout(function () { b.removeAttribute('data-cardopt-added') }, 1200)
    var l = lang()
    announce((l === 'ar' ? 'أُضيف إلى حقيبتك: ' : 'Added to your bag: ') + nameOf(row, l) + ' · ' + sizeText(size, l))
  })

  fetch(api + '/api.php?r=products', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (rows) {
      if (!Array.isArray(rows) || !rows.length) return
      bySlug = {}
      byStyle = {}
      for (var i = 0; i < rows.length; i++) {
        var p = rows[i]
        if (!p || !p.slug) continue
        bySlug[p.slug] = p
        if (p.colour && p.colour.key) {
          colourName[p.colour.key] = { en: String(p.colour.en || ''), ar: String(p.colour.ar || '') }
          if (p.style_key) (byStyle[p.style_key] = byStyle[p.style_key] || []).push(p)
        }
      }
      for (var k in byStyle) byStyle[k].sort(function (a, b) { return a.slug.localeCompare(b.slug) })

      lastLang = lang()
      scan()

      /* One observer, throttled to a frame. `href` is watched because React can re-use a card's
         node for another product; `lang` because a language switch rewrites text, not nodes.
         Our own writes are dropped with takeRecords(), or the observer would answer itself. */
      var queued = false
      var mo = new MutationObserver(function () {
        if (queued) return
        queued = true
        requestAnimationFrame(function () {
          queued = false
          var l = lang()
          if (l !== lastLang) { lastLang = l; relabel() }
          scan()
          mo.takeRecords()
        })
      })
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['lang', 'href'] })
    })
    .catch(function () { /* the cards stay exactly as they were */ })
})()
