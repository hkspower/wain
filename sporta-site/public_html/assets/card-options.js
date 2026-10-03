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
 * A double tap is one add PER SIZE: the guard sits on the box that was tapped, so S
 * and then L on the same card are two adds, however quickly.
 *
 * ------------------------------------------------------------ WHAT IT COSTS A SCROLL
 *
 * Measured on /shop, iPhone 14, CPU slowed 4x (test:scroll): the page's own :has() rules
 * make EVERY frame that inserts an element restyle the whole document (body:has(...) and
 * the grid's :has() are invalidated by any insertion that carries a class attribute). So
 * the two things that cost are (a) a frame of insertions of our own, and (b) how many
 * elements every one of those whole-document restyles has to walk. The first version
 * paid both: it waited a frame after React drew a card, which made a second full restyle
 * on top of React's, and it drew ~18 elements per card.
 *   - SAME FRAME. The boxes are inserted inside the MutationObserver callback, a
 *     microtask that runs straight after React's commit and before the browser styles
 *     anything, so React's restyle is the only one.
 *   - FEW ELEMENTS. Two rows inserted straight into the caption (no wrapper); a colour is
 *     ONE <a> (the disc is its padding box, the ring a background layer); a size is ONE
 *     <button> whose only child is its text. 2 + colours + sizes elements per card.
 *   - ONE MARK PER GRID. data-cardopt-grid tells 70-card-options.css that this two-column
 *     grid holds product cards, so it can line the rows up across a row (subgrid).
 *   - ONCE PER CARD. A card already drawn is recognised by a property on the caption
 *     (the photo link's href it was built for and the nodes it holds), so scrolling past
 *     it reads two properties and writes nothing. Only three things ever write again:
 *       - the href changes (React re-used the node for another product) -> rebuilt
 *       - the rows are no longer right before the price row (React re-rendered) -> moved
 *       - the page's language changes -> labels and hrefs rewritten in place, never rebuilt
 * No layout is read anywhere in this file.
 *
 * DOM overlay on a page with no source here, same class of thing as brand-badge.js: it
 * only ADDS two rows to a card's caption and removes only what it added.
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

  /* The page's language, as the page itself says it. Never the photo link's href: the
     bundle's own cards (/shop, Best sellers, "Complete the look") carry no ?lang=en, and a
     circle that copied them sent an English shopper to an Arabic page. */
  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'ar' ? 'ar' : 'en' }
  function tr(k, l) { return T[k][l] }
  function nameOf(row, l) { return (l === 'ar' ? row.name_ar || row.name_en : row.name_en || row.name_ar) || row.slug }
  function sizeText(size, l) { return size === 'ONE' ? tr('oneSize', l) : size }
  /* A circle is a plain link, so a tap is a full page load, and a page with no ?lang= and
     no saved choice opens in Arabic. The English shopper's language goes with the link. */
  function hrefOf(slug, l) { return '/product/' + encodeURIComponent(slug) + (l === 'en' ? '?lang=en' : '') }

  function sizeLabel(row, size, inStock, l) {
    var what = size === 'ONE' ? tr('oneSize', l) : tr('sizePrefix', l) + size
    if (!inStock) return what + ' — ' + (l === 'ar' ? tr('soldOut', 'ar') : 'sold out')
    return l === 'ar'
      ? 'أضف ' + what + ' إلى الحقيبة — ' + nameOf(row, l)
      : 'Add ' + (size === 'ONE' ? what : 'size ' + size) + ' to bag — ' + nameOf(row, l)
  }

  function setAttr(el, k, v) { if (el.getAttribute(k) !== v) el.setAttribute(k, v) }

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

  /* The rows for one product: [colours?, sizes?], or [] when it has neither. */
  function build(row) {
    var l = lang()
    var out = []
    if (row.colour && row.colour.key) {
      var cg = document.createElement('div')
      cg.className = 'cardopt-colours'
      cg.setAttribute('role', 'group')
      cg.setAttribute('aria-label', tr('colours', l))
      cg.setAttribute('data-slug', row.slug)
      var sibs = siblings(row)
      for (var i = 0; i < sibs.length; i++) {
        var s = sibs[i]
        var a = document.createElement('a')
        a.className = 'cardopt-colour'
        a.href = hrefOf(s.slug, l)
        a.setAttribute('data-key', s.colour.key)
        a.setAttribute('data-slug', s.slug)
        var cn = colourName[s.colour.key] || { en: s.colour.en, ar: s.colour.ar }
        a.setAttribute('aria-label', cn[l] || cn.en || s.colour.key)
        a.setAttribute('title', cn[l] || cn.en || s.colour.key)
        if (s.slug === row.slug) a.setAttribute('aria-current', 'true')
        a.style.backgroundColor = HEX.test(s.colour.hex || '') ? s.colour.hex : '#888'
        cg.appendChild(a)
      }
      out.push(cg)
    }
    var sizes = Array.isArray(row.size_options) ? row.size_options : []
    if (sizes.length) {
      var sg = document.createElement('div')
      sg.className = 'cardopt-sizes'
      sg.setAttribute('role', 'group')
      sg.setAttribute('aria-label', tr('sizes', l))
      sg.setAttribute('data-slug', row.slug)
      for (var j = 0; j < sizes.length; j++) {
        var size = String(sizes[j].size), inStock = sizes[j].in_stock === true
        var b = document.createElement('button')
        b.type = 'button'
        b.className = 'cardopt-size'
        b.setAttribute('data-size', size)
        b.setAttribute('aria-label', sizeLabel(row, size, inStock, l))
        if (!inStock) { b.disabled = true; b.setAttribute('title', tr('soldOut', l)) }
        b.textContent = sizeText(size, l)
        sg.appendChild(b)
      }
      out.push(sg)
    }
    return out
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
      var cap = photo.nextElementSibling
      if (!cap) continue
      var co = cap.__cardopt

      if (co && co.href === href && co.price.parentNode === cap) {
        var n = co.nodes, ok = true
        for (var k = 0; k < n.length; k++) {
          if (n[k].parentNode !== cap || n[k].nextElementSibling !== (k + 1 < n.length ? n[k + 1] : co.price)) { ok = false; break }
        }
        if (ok) continue
        /* React put something between them: put the rows back right before the price row */
        if (n.length) cap.insertBefore(frag(n), co.price)
        continue
      }

      if (!/\/product\//.test(href)) continue
      var price = cap.querySelector(':scope > .price-card')
      if (!price) continue

      /* The grid is a product grid: 70-card-options.css lines the rows up across it (subgrid),
         which needs the grid's own row gap moved onto the cards. Marked from here because CSS
         cannot tell a product grid from a form's two-column grid without :has(). Once per grid. */
      var grid = art.parentNode
      if (grid && !grid.__cardoptGrid) { grid.__cardoptGrid = true; grid.setAttribute('data-cardopt-grid', '') }

      if (co) for (var r = 0; r < co.nodes.length; r++) if (co.nodes[r].parentNode === cap) cap.removeChild(co.nodes[r])
      var strays = cap.querySelectorAll(':scope > .cardopt-colours, :scope > .cardopt-sizes')
      for (var s = 0; s < strays.length; s++) cap.removeChild(strays[s])

      var row = bySlug[slugOfHref(href)]
      var nodes = row ? build(row) : []
      if (nodes.length) cap.insertBefore(frag(nodes), price)
      cap.__cardopt = { href: href, price: price, nodes: nodes }
    }
  }

  function frag(nodes) {
    if (nodes.length === 1) return nodes[0]
    var f = document.createDocumentFragment()
    for (var i = 0; i < nodes.length; i++) f.appendChild(nodes[i])
    return f
  }

  /* The language changed under cards that were not re-rendered: every label and every circle's
     href is rewritten in place, and only where it differs. Nothing is rebuilt, so focus and the
     nodes survive. */
  function relabel() {
    var l = lang()
    var groups = document.querySelectorAll('.cardopt-colours[data-slug], .cardopt-sizes[data-slug]')
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i], row = bySlug[g.getAttribute('data-slug')]
      if (!row) continue
      if (g.className === 'cardopt-colours') {
        setAttr(g, 'aria-label', tr('colours', l))
        var cs = g.children
        for (var c = 0; c < cs.length; c++) {
          var cn = colourName[cs[c].getAttribute('data-key')]
          if (cn) {
            setAttr(cs[c], 'aria-label', cn[l] || cn.en)
            setAttr(cs[c], 'title', cn[l] || cn.en)
          }
          var slug = cs[c].getAttribute('data-slug')
          if (slug) setAttr(cs[c], 'href', hrefOf(slug, l))
        }
      } else {
        setAttr(g, 'aria-label', tr('sizes', l))
        var bs = g.children
        for (var s = 0; s < bs.length; s++) {
          var b = bs[s], size = b.getAttribute('data-size')
          setAttr(b, 'aria-label', sizeLabel(row, size, !b.disabled, l))
          if (b.disabled) setAttr(b, 'title', tr('soldOut', l))
          var t = sizeText(size, l)
          if (b.textContent !== t) b.textContent = t
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
    var group = b.parentNode
    if (!group || !bySlug) return
    var now = Date.now()
    if (b.__busyUntil > now) return                           /* a double tap on THIS size is one add */
    b.__busyUntil = now + 1200
    var row = bySlug[group.getAttribute('data-slug')]
    var add = window.sportaCartAdd, fitOf = window.sportaDefaultFit
    if (!row || typeof add !== 'function' || typeof fitOf !== 'function') return
    var cap = group.parentNode, photo = cap && cap.previousElementSibling
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
    clearTimeout(b.__addedTimer)
    b.__addedTimer = setTimeout(function () { b.removeAttribute('data-cardopt-added') }, 1200)
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

      /* SYNCHRONOUS, in the observer's own microtask: it runs right after React commits a
         batch of cards and before the browser styles the frame, so the rows join React's
         restyle instead of causing one of their own a frame later (see the header).
         `href` is watched because React can re-use a card's node for another product; `lang`
         because a language switch rewrites text, not nodes. Our own writes are dropped with
         takeRecords(), or the observer would answer itself. */
      var mo = new MutationObserver(function (recs) {
        var need = false, relang = false
        for (var i = 0; i < recs.length; i++) {
          var r = recs[i]
          if (r.type === 'attributes') {
            if (r.attributeName === 'lang') relang = true
            else need = true
          } else if (r.addedNodes.length || r.removedNodes.length) {
            need = true
          }
        }
        if (relang) {
          var l = lang()
          if (l !== lastLang) { lastLang = l; relabel() }
        }
        if (need) scan()
        mo.takeRecords()
      })
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['lang', 'href'] })
    })
    .catch(function () { /* the cards stay exactly as they were */ })
})()
