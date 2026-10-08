/* Sporta — mobile product-page section order, 2026-09-20.
 *
 * ------------------------------------------------------------------- WHY
 *
 * The owner asked, verbatim, for the mobile /product/[slug] page to show 12
 * sections top to bottom: image carousel, name, price, rating, color, size,
 * sticky Add to Cart, delivery info, description, size guide, reviews,
 * related products. The page is a PREBUILT React bundle with no source in
 * this repository (see CLAUDE.md) — this file is an overlay, in the same
 * shape as tile-art.js, brand-strip.js and checkout-tap-targets.js, and it
 * never edits the bundle's own JS.
 *
 * ------------------------------------------------------------- WHAT WAS MEASURED
 *
 * A real product page was loaded at 390x844 in both languages
 * (scripts/_tmp-map-product.mjs, not committed) before writing a line of
 * this file. Findings, against the 12 items:
 *
 *  1. Image carousel        EXISTS, and is ALREADY full-width. Measured with
 *                            a screenshot before touching anything: the image
 *                            box breaks out of the page's own px-4 gutter on
 *                            its own (0-390 of a 390px viewport, while the
 *                            breadcrumb and the "Authentic" badge around it
 *                            stay inset) — the bundle already bleeds it edge
 *                            to edge. A first version of this file widened it
 *                            again on top of that with a measured negative
 *                            margin, which DOUBLE-counted the offset and
 *                            caused a real 16px horizontal overflow
 *                            (scrollWidth 406 on a 390 viewport, caught by
 *                            the test rig, not read off a screenshot). Left
 *                            alone now. ProductDetail-uh71XAH8.js also has
 *                            touch/swipe handling and an active-image index,
 *                            so multi-photo swiping is real — this sandbox's
 *                            seed data has no product with more than one
 *                            photo, so the dots never render here to look at,
 *                            but nothing needed building for this item.
 *  2. Product name           EXISTS, first in the text column (h1.product-title
 *                            — a class already in the bundle, not one we add).
 *  3. Price                  EXISTS, already right after the name (a
 *                            description paragraph sits between them today).
 *  4. Rating                 DOES NOT EXIST. Grepped ProductDetail-uh71XAH8.js
 *                            for "rating": zero matches. The API has a
 *                            per-ORDER `rating` (1-5, written by the signed
 *                            post-purchase review link, ?r=review) but no
 *                            route aggregates it per product — ?r=products
 *                            and ?r=review_invite were read in full and
 *                            neither returns a count or an average. There is
 *                            nothing here to show without inventing a number,
 *                            so nothing is shown. See "WHAT IS NOT BUILT".
 *  5. Color                  DOES NOT EXIST, at the data-model level, not just
 *                            the DOM. ?r=products' rows have no `color` key
 *                            (checked against a live response) and the only
 *                            per-line attributes anywhere in api.php are
 *                            `size` and `fit`. Swatches cannot be built from
 *                            an attribute the shop does not store. See
 *                            "WHAT IS NOT BUILT".
 *  6. Size selector          EXISTS, already positioned right after price.
 *  7. Sticky Add to Cart     EXISTS ALREADY: `.action-bar.safe-bottom`,
 *                            `md:hidden`, fixed at the foot of the mobile
 *                            viewport with its own price/Add/Buy now. This
 *                            file touches it for nothing beyond confirming
 *                            (in the test rig) that it stays pinned on
 *                            scroll and does not overlap the content below.
 *  8. Delivery information   EXISTS, already right after the in-page
 *                            add-to-cart row (the delivery/checkout/returns
 *                            <ul>).
 *  9. Description            EXISTS, but ABOVE the price today (right after
 *                            the name). Moved here, in order, below delivery.
 * 10. Size guide             PARTLY EXISTS: a "Size guide" link sits inside
 *                            the size selector already and opens the
 *                            bundle's own modal — left exactly where it is,
 *                            because it is a React-owned control and
 *                            reparenting a live React node with appendChild
 *                            breaks its event handlers on the next render
 *                            (the SAME reason this file reorders with CSS
 *                            `order`, never by moving nodes — see below).
 *                            What the spec asks for as its OWN section — a
 *                            visible size chart at this position, not a
 *                            link — did not exist, so this file adds one,
 *                            built from ?r=size_chart, the shop's own real
 *                            size-chart data (same route the size adviser
 *                            reads), not invented numbers.
 *                            NARROWED 2026-10-08, with the owner's yes: the
 *                            chart lists only the sizes THIS piece is made in
 *                            (the jacket made in M and L shows M and L, not S
 *                            to 5XL), and a product with no size to choose —
 *                            a cap, a backpack, a strap, i.e. sizes [] or only
 *                            ONE — shows no chart at all. See "THE SIZE GUIDE"
 *                            below for where the sizes come from.
 * 11. Reviews                DOES NOT EXIST as anything a shopper on this
 *                            page could see. The only review surface in the
 *                            API is the signed post-purchase link
 *                            (?r=review / ?r=review_invite); there is no
 *                            route that lists or aggregates reviews for a
 *                            product. Nothing is built here — see "WHAT IS
 *                            NOT BUILT".
 * 12. Related products       EXISTS: "Complete the look" / "أكمل إطلالتك",
 *                            already the last thing on the page.
 *
 * ------------------------------------------------------- WHAT IS NOT BUILT
 *
 * Rating and reviews both need a real number this shop does not compute
 * anywhere, and color needs an attribute this shop does not store. Adding a
 * star row, a swatch row or a "4.8 (312 reviews)" line would be inventing
 * data, not surfacing it — exactly what CLAUDE.md's "a fixture chosen at
 * random" and "an attribute is advice, the fault is what the visitor gets"
 * entries warn against doing with confidence instead of evidence. Making
 * these real needs backend work (a `product_rating` view or column, an
 * aggregate route, and, for color, an actual color attribute on variants)
 * that is out of reach of an overlay by definition — an overlay can only
 * rearrange or add to what the server already answers.
 *
 * --------------------------------------------------------- REORDER BY CSS ORDER
 *
 * The text column (name / description / price / size+fit / in-page CTA /
 * delivery) is one React-rendered <div> with no id or class of its own.
 * Moving its children with appendChild would work visually until the user
 * changes anything that re-renders that div (picks a size, changes qty) —
 * React reconciles against ITS OWN remembered child order, not the DOM's
 * current one, and a moved node is exactly the kind of surprise that
 * produces duplicated or vanished elements on the next render. So nothing
 * in this file is moved. The container is given `display:flex;
 * flex-direction:column` and each recognised child gets a `style.order`,
 * which is a paint-time hint the DOM structure never disagrees with.
 *
 * The container itself is found by walking up from h1.product-title, which
 * is a class the bundle emits for the name (confirmed in
 * ProductDetail-uh71XAH8.js and its own stylesheet) — not a hook this file
 * invents, so it will not silently stop matching if a nearby class list
 * happens to change.
 *
 * ---------------------------------------------------------- THE SIZE GUIDE
 *
 * ?r=size_chart answers the S-5XL body chart for ANY slug (it is the chart
 * for the product's audience, not for the product), so drawing every row it
 * returns put a 400px table of chest and waist sizes on the phone strap and
 * gave the two-size jacket eight rows. The sizes a piece is made in come from
 * the SERVER — `size_options` on ?r=products, the field card-options.js reads
 * (the variant rows; a sold-out size is in the list, so it stays in the chart;
 * `ONE` is dropped, it has no measurements) — and never from the size
 * buttons' tooltips, which are owner-editable wording in Site wording. Only
 * the rows in that list are built. No rows left, no section: never an empty
 * table with column headings and nothing under them, which is what hiding the
 * rows produced on the live accessories that carry a single ONE row.
 * When the list cannot be known (the request failed, the product is not in
 * it, the field is absent) the full chart is drawn, as before.
 *
 * KEYED TO THE PRODUCT AND THE LANGUAGE. The guide carries the slug and the
 * language it was built for. The shop changes product without a reload (the
 * colour buttons, "Complete the look") and changes language without a reload,
 * and the first version kept whatever guide it had first drawn: a women's
 * chart with its hip column left on the unisex jacket, an English table on the
 * Arabic page. A guide built for anything else is removed and rebuilt from
 * the cached answers, and <html lang> is watched so the toggle alone redraws
 * it. Nothing is written while the guide is already right.
 *
 * THE EMPTY SIZE BLOCK. A product with no size rows at all (the sandbox's
 * accessories; a new product before stock is typed in) still renders the
 * size block as an empty `div.mt-6.space-y-3`, 0px tall with its 24px top
 * margin, so the price-to-buy gap was 48px against 24px everywhere else. It is
 * hidden while it is empty and given back the moment the bundle fills it. The
 * live accessories carry a ONE row, so their block is not empty and this does
 * nothing there.
 *
 * ----------------------------------------------------------------- SCOPE
 *
 * Product page only (`/product/`), mobile only (`max-width: 767px`, the
 * breakpoint the bundle's own `md:` classes already use throughout this
 * page). Nothing here runs on desktop or on any other route.
 */
;(function () {
  'use strict'

  var MOBILE_MQ = '(max-width: 767px)'
  var GUIDE_MARK = 'data-sporta-size-guide'   /* its value is the slug the guide was built for */
  var GUIDE_LANG = 'data-lang'                /* and this, the language */
  var ORDERED_MARK = 'data-sporta-mobile-ordered'
  var EMPTY_MARK = 'data-sporta-empty-size'   /* the empty size block this file hid */
  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')

  var LABELS = {
    heading: { en: 'Size guide', ar: 'دليل المقاسات' },
    chest: { en: 'Chest (cm)', ar: 'الصدر (سم)' },
    waist: { en: 'Waist (cm)', ar: 'الخصر (سم)' },
    hip: { en: 'Hip (cm)', ar: 'الورك (سم)' },
    size: { en: 'Size', ar: 'المقاس' },
  }

  function lang() {
    return document.documentElement.lang === 'ar' ? 'ar' : 'en'
  }

  function isProductPage() {
    return /^\/product\//.test(location.pathname)
  }

  function isMobile() {
    return window.matchMedia(MOBILE_MQ).matches
  }

  function slugFromPath() {
    var m = /^\/product\/([^/?#]+)/.exec(location.pathname)
    return m ? decodeURIComponent(m[1]) : null
  }

  function findTitle() {
    return document.querySelector('h1.product-title')
  }

  /* The text column: h1's grandparent (h1 -> title-row div -> column div). */
  function findColumn(h1) {
    var titleRow = h1.parentElement
    if (!titleRow) return null
    return titleRow.parentElement
  }

  function findChild(column, test) {
    for (var i = 0; i < column.children.length; i++) {
      if (test(column.children[i])) return column.children[i]
    }
    return null
  }

  function isTitleRow(el, h1) { return el.contains(h1) }
  function isDescription(el) { return el.tagName === 'P' && /\btext-slate-600\b/.test(el.className) && !/items-baseline/.test(el.className) }
  function isPrice(el) { return el.tagName === 'P' && /items-baseline/.test(el.className) }
  function isSizeFit(el) { return el.tagName === 'DIV' && /\bspace-y-3\b/.test(el.className) }
  function isDelivery(el) { return el.tagName === 'UL' }

  /* Order the existing children of the text column with CSS `order`, never
   * by moving them. Idempotent: safe to call on every mutation. */
  function orderColumn() {
    var h1 = findTitle()
    if (!h1) return
    var column = findColumn(h1)
    if (!column) return

    var titleRow = findChild(column, function (el) { return isTitleRow(el, h1) })
    var desc = findChild(column, isDescription)
    var price = findChild(column, isPrice)
    var sizeFit = findChild(column, isSizeFit)
    var delivery = findChild(column, isDelivery)

    if (!titleRow || !price || !sizeFit) return /* not the page we think it is */

    if (!isMobile()) {
      /* Desktop: undo any inline order this file set, change nothing else. */
      ;[titleRow, desc, price, sizeFit, delivery].concat(Array.prototype.filter.call(column.children, function (el) { return el.style.order !== '' })).forEach(function (el) {
        if (el) el.style.order = ''
      })
      column.style.display = ''
      column.style.flexDirection = ''
      column.removeAttribute(ORDERED_MARK)
      showSizeBlock(sizeFit)
      return
    }

    /* The empty size block (no size rows at all): hidden while empty, given
       back the moment the bundle puts anything in it. See the header. */
    if (sizeFit.children.length === 0 && !sizeFit.textContent.trim()) {
      if (!sizeFit.hasAttribute(EMPTY_MARK)) sizeFit.setAttribute(EMPTY_MARK, '1')
      if (sizeFit.style.display !== 'none') sizeFit.style.display = 'none'
    } else {
      showSizeBlock(sizeFit)
    }

    column.style.display = 'flex'
    column.style.flexDirection = 'column'
    /* WHOLE NUMBERS ONLY, AND SPACED BY TEN. `order` takes an <integer>: the
     * first version gave the buy row '3.5', which the browser REJECTS, so the
     * row fell back to order 0 and painted FIRST — above the product name, with
     * the wishlist heart wedged against it — on every phone, in both
     * languages. Nothing reported it (an invalid inline style is dropped
     * silently) and the section order the owner specified was wrong from the
     * day it shipped. Steps of ten leave room for anything inserted later. */
    titleRow.style.order = '10'   /* name (#2) */
    price.style.order = '20'      /* price (#3) */
    sizeFit.style.order = '30'    /* size selector (#6) */
    /* The in-page qty/Add/Buy row keeps the DOM position the bundle gives it
     * (after size/fit, before delivery) and now says so with a real number. */
    var ctaRow = findChild(column, function (el) {
      return el !== titleRow && el !== desc && el !== price && el !== sizeFit && el !== delivery &&
             el.tagName === 'DIV' && !el.hasAttribute(GUIDE_MARK)
    })
    if (ctaRow) ctaRow.style.order = '40'
    if (delivery) delivery.style.order = '50'  /* delivery info (#8) */
    if (desc) desc.style.order = '60'          /* description (#9), after delivery */
    column.setAttribute(ORDERED_MARK, '1')
  }

  /* Only ever undoes this file's own hiding: a block it did not hide is not touched. */
  function showSizeBlock(el) {
    if (!el || !el.hasAttribute(EMPTY_MARK)) return
    el.removeAttribute(EMPTY_MARK)
    el.style.display = ''
  }

  /* ---------------------------------------------------------------- size guide */

  /* Two answers decide the guide, and both are cached for the page's life.
     PENDING while a request is out; afterwards a value, or null for "none" /
     "not known". placeSizeGuide() builds only from the caches, so it is the
     same pure decision on every pass, and each answer arriving just asks for
     another pass. */
  var PENDING = {}
  var sizeChartCache = {} /* slug -> rows | null (no chart) | PENDING */
  var sizesBySlug = PENDING /* slug -> [sizes this piece is made in, ONE dropped] | null (not known) | PENDING */
  var sizesAsked = false

  function chartRows(slug) {
    if (Object.prototype.hasOwnProperty.call(sizeChartCache, slug)) return sizeChartCache[slug]
    sizeChartCache[slug] = PENDING
    fetch(api + '/api.php?r=size_chart&slug=' + encodeURIComponent(slug), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (data) { sizeChartCache[slug] = data && data.rows && data.rows.length ? data.rows : null })
      .catch(function () { sizeChartCache[slug] = null })
      .then(schedule)
    return PENDING
  }

  /* The sizes each piece is made in, from the same ?r=products answer the
     bundle and card-options.js read (api-dedupe.js shares one request among
     them). Returns PENDING, null when this product's list cannot be known —
     the full chart is drawn then, as before — or the list. */
  function productSizes(slug) {
    if (!sizesAsked) {
      sizesAsked = true
      fetch(api + '/api.php?r=products', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (j) {
          var a = j && (Array.isArray(j) ? j : j.products)
          if (!Array.isArray(a)) { sizesBySlug = null; return }
          var map = {}
          a.forEach(function (p) {
            if (!p || !p.slug || !Array.isArray(p.size_options)) return
            map[p.slug] = p.size_options
              .map(function (o) { return o && typeof o.size === 'string' ? o.size : null })
              .filter(function (s) { return s && s !== 'ONE' })
          })
          sizesBySlug = map
        })
        .catch(function () { sizesBySlug = null })
        .then(schedule)
    }
    if (sizesBySlug === PENDING) return PENDING
    if (!sizesBySlug || !Object.prototype.hasOwnProperty.call(sizesBySlug, slug)) return null
    return sizesBySlug[slug]
  }

  function buildSizeGuideSection(rows, slug) {
    var ar = lang() === 'ar'
    var t = LABELS
    var section = document.createElement('div')
    section.setAttribute(GUIDE_MARK, slug)
    section.setAttribute(GUIDE_LANG, ar ? 'ar' : 'en')
    section.className = 'mt-8 rounded-2xl bg-white p-5'
    section.style.order = '70' /* after description (60), before nothing else in this column */

    var h2 = document.createElement('h2')
    h2.className = 'mb-3 text-sm font-bold text-slate-900'
    h2.textContent = t.heading[ar ? 'ar' : 'en']
    section.appendChild(h2)

    var table = document.createElement('table')
    table.className = 'w-full text-left text-sm text-slate-600'
    if (ar) table.setAttribute('dir', 'rtl')

    var hasHip = rows.some(function (r) { return r.hip_min != null || r.hip_max != null })

    var thead = document.createElement('thead')
    var htr = document.createElement('tr')
    ;[t.size, t.chest, t.waist].concat(hasHip ? [t.hip] : []).forEach(function (label) {
      var th = document.createElement('th')
      th.className = 'border-b border-black/10 py-2 font-semibold text-slate-900'
      th.textContent = label[ar ? 'ar' : 'en']
      htr.appendChild(th)
    })
    thead.appendChild(htr)
    table.appendChild(thead)

    var tbody = document.createElement('tbody')
    rows.forEach(function (row) {
      var tr = document.createElement('tr')
      var cells = [
        row.size,
        row.chest_min != null && row.chest_max != null ? row.chest_min + '–' + row.chest_max : '—',
        row.waist_min != null && row.waist_max != null ? row.waist_min + '–' + row.waist_max : '—',
      ]
      if (hasHip) cells.push(row.hip_min != null && row.hip_max != null ? row.hip_min + '–' + row.hip_max : '—')
      cells.forEach(function (val) {
        var td = document.createElement('td')
        td.className = 'border-b border-black/5 py-2'
        td.textContent = val
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    section.appendChild(table)
    return section
  }

  function placeSizeGuide() {
    var h1 = findTitle()
    if (!h1) return
    var column = findColumn(h1)
    if (!column) return

    var guides = column.querySelectorAll('[' + GUIDE_MARK + ']')
    var slug = isMobile() ? slugFromPath() : null
    var rows = slug ? chartRows(slug) : null
    var sizes = slug ? productSizes(slug) : null
    var L = lang()
    var pending = rows === PENDING || sizes === PENDING

    /* Keep a guide only if it was built for THIS product in THIS language.
       Anything else describes a page that is no longer on screen, and goes —
       even while the new product's answers are still on their way. */
    var keep = null
    for (var i = 0; i < guides.length; i++) {
      var g = guides[i]
      if (!keep && slug && g.getAttribute(GUIDE_MARK) === slug && g.getAttribute(GUIDE_LANG) === L) keep = g
      else if (g.parentNode) g.parentNode.removeChild(g)
    }
    if (keep || !slug || pending || !rows) return

    /* Only the sizes this piece is made in; the full chart when that is not
       known. No rows left means no size to choose: nothing is drawn. */
    var shown = sizes ? rows.filter(function (r) { return sizes.indexOf(String(r.size)) !== -1 }) : rows
    if (!shown.length) return
    column.appendChild(buildSizeGuideSection(shown, slug))
  }

  /* ------------------------------------------------------------------- run */

  function run() {
    if (!isProductPage()) return
    orderColumn()
    placeSizeGuide()
  }

  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () {
      queued = false
      run()
    })
  }

  var observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  /* The language toggle re-renders the bundle's words in place — text, not
     child nodes — so the body observer above may never hear it. <html lang>
     is what changes; the guide is rebuilt in the new language from the cache. */
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })

  window.addEventListener('resize', schedule)
  if (window.matchMedia) {
    var mq = window.matchMedia(MOBILE_MQ)
    if (mq.addEventListener) mq.addEventListener('change', schedule)
    else if (mq.addListener) mq.addListener(schedule)
  }

  run()
})()
