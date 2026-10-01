/* Sporta — Quick Add for SIZED products, on the grid.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * The bundle already has a quick-add "+" button on the image's bottom-end
 * corner — but only for a product whose only variant is `ONE`. Checked
 * directly: a card for a garment with real sizes (S–5XL, the overwhelming
 * majority of the catalogue) renders NO such button at all, because the
 * bundle has nowhere to ask "which size" without leaving the grid. Asked to
 * add one, out of two offered: a small size popover on the card, over
 * leaving it as it is.
 *
 * NEVER TOUCHES A CARD THE BUNDLE ALREADY HANDLES. This only adds a button
 * where `button[aria-label^="Add"]` / `button[aria-label^="أضف"]` is ABSENT
 * — a one-size product keeps the bundle's own real button, untouched, and
 * this script never sees it.
 *
 * ------------------------------------------------------ HOW ADDING ACTUALLY WORKS
 *
 * The cart is `localStorage.sporta_cart`, a plain JSON array the bundle
 * reads on load — confirmed by watching a real add before writing a line of
 * this: `[{key,slug,size,fit,name:{en,ar},price,image,qty}]`, `key` is
 * `` `${slug}__${size}__${fit}` ``, and `fit` is always `'normal'` — checked
 * against the schema: `product_variants` has no fit column at all, and
 * neither does `products`. The bundle's own size/fit picker still writes
 * `'normal'` for every product, so that is not a choice this popover needs
 * to offer; there is only ever one fit to write.
 *
 * WRITING THE ARRAY IS NOT ENOUGH ON ITS OWN. Measured: a plain
 * `localStorage.setItem` with the page already open does NOT move the
 * bundle's own in-memory cart — the drawer and the header controls go on
 * reading their own React state, which only re-syncs from storage on a
 * `storage` EVENT. So every write here is followed by dispatching a real
 * `StorageEvent('storage', …)` with the old and new values, the same shape
 * a second browser tab writing the same key would produce. Verified before
 * shipping: the bundle picks it up, re-serialises the array in its OWN key
 * order (proof it actually parsed and re-owns it, not merely echoed what was
 * written), and a page reload afterward shows the same qty with no
 * duplicate row.
 *
 * IT DOES NOT OPEN THE DRAWER. Measured the same way: the real quick-add
 * button opens the drawer because ITS click handler does, not because
 * adding an item does — a `storage` sync alone leaves the drawer exactly
 * where it was (off-canvas), so a background sync would never surprise
 * someone who is not looking at the cart. This script gives its own
 * feedback instead — a brief checkmark in the same panel — rather than
 * assuming a drawer will appear.
 *
 * ------------------------------------------------------------ WHERE THE SIZES COME FROM
 *
 * `?r=stock` — the same route the size adviser and the product page read —
 * for which sizes of which slug have stock > 0, and `?r=slides` for
 * `rules.sizes`, the shop's OWN ordered size list (S, M, L, XL, …, ONE) so
 * the popover offers them in the order the owner set in /backends rather
 * than an order typed into this file. `?r=products` supplies the price and
 * both-language name for the cart row — the DOM only ever carries the
 * CURRENT language's name, and writing only that would leave the other
 * language blank in the cart forever, not just until the next fetch.
 *
 * A SLUG WITH NO SIZE IN STOCK GETS NO BUTTON EITHER. Same reasoning as the
 * bundle's own: a button that opens to an empty panel is worse than none.
 *
 * ------------------------------------------------------------------- FRAGILITY
 *
 * DOM overlay on a page with no source here, same class of thing as
 * card-badges.js and brand-badge.js. It can only ever ADD a button to a card
 * that has none — it never removes or replaces anything the bundle draws.
 */
;(function () {
  'use strict'

  var MARK = 'data-sporta-quickadd-sized'
  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')

  var LABEL = {
    add: { en: 'Add to cart', ar: 'أضف إلى السلة' },
    choose: { en: 'Choose a size', ar: 'اختر مقاسًا' },
    added: { en: 'Added ✓', ar: 'أُضيف ✓' },
    close: { en: 'Close', ar: 'إغلاق' },
  }

  function ar() {
    return (document.documentElement.lang || 'ar').slice(0, 2) === 'ar'
  }

  function t(key) {
    return ar() ? LABEL[key].ar : LABEL[key].en
  }

  /* slug -> [sizes in stock, in the shop's own order] */
  var sizesBySlug = null
  /* slug -> { price, name: {en, ar} } */
  var infoBySlug = null
  var loading = false
  var waiters = []

  function ready(cb) {
    if (sizesBySlug && infoBySlug) { cb(); return }
    waiters.push(cb)
    if (loading) return
    loading = true

    Promise.all([
      fetch(api + '/api.php?r=stock', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : [] }).catch(function () { return [] }),
      fetch(api + '/api.php?r=slides', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null }).catch(function () { return null }),
      fetch(api + '/api.php?r=products', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : [] }).catch(function () { return [] }),
    ]).then(function (res) {
      var stock = res[0] || []
      var slidesData = res[1]
      var products = res[2] || []

      // THE SHOP'S OWN ORDER, read from the rules it already publishes,
      // never a list re-typed here — falls back to a sane default only if
      // that response is unreachable, so a network hiccup still draws
      // something rather than nothing.
      var order = (slidesData && slidesData.rules && Array.isArray(slidesData.rules.sizes) && slidesData.rules.sizes.length)
        ? slidesData.rules.sizes
        : ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE']
      var rank = {}
      for (var i = 0; i < order.length; i++) rank[order[i]] = i

      var bySlug = {}
      for (var s = 0; s < stock.length; s++) {
        var row = stock[s]
        if (!row || !row.slug || !row.in_stock) continue
        if (!bySlug[row.slug]) bySlug[row.slug] = []
        bySlug[row.slug].push(row.size)
      }
      for (var slug in bySlug) {
        bySlug[slug].sort(function (a, b) {
          var ra = rank[a] === undefined ? 999 : rank[a]
          var rb = rank[b] === undefined ? 999 : rank[b]
          return ra - rb
        })
      }
      sizesBySlug = bySlug

      var pBySlug = {}
      for (var p = 0; p < products.length; p++) {
        var row2 = products[p]
        if (!row2 || !row2.slug) continue
        pBySlug[row2.slug] = {
          price: Number(row2.price) || 0,
          name: { en: String(row2.name_en || ''), ar: String(row2.name_ar || '') },
        }
      }
      infoBySlug = pBySlug

      loading = false
      var pending = waiters
      waiters = []
      for (var w = 0; w < pending.length; w++) pending[w]()
    })
  }

  /* Merge one size into the bundle's own cart shape and tell it to re-sync. */
  /* THE CATEGORY PAGES ARE NOT THE APP. category.php is server-drawn and loads no bundle, so there is
     no cart state to sync and no reason to reload: the cart lives in localStorage and the next page
     that IS the app reads it fresh. Its bag badge is refreshed after an add (below). */
  function isStaticPage() { return !document.querySelector('script[src*="/assets/index-"]') }

  function savedCount() {
    try {
      var c = JSON.parse(localStorage.getItem('sporta_cart') || '[]'), n = 0
      for (var i = 0; i < c.length; i++) n += Number(c[i] && c[i].qty) || 0
      return n
    } catch (e) { return 0 }
  }

  /* The page already draws a count ([data-cart-badge], filled by category-topbar.js) but only ONCE,
     when it loads — so after an add it would go on showing the old number. Refreshed here. */
  function paintStaticBag() {
    if (!isStaticPage()) return
    var badge = document.querySelector('[data-cart-badge]')
    if (!badge) return
    var n = savedCount()
    badge.textContent = n > 99 ? '99+' : n ? String(n) : ''
    badge.style.display = n ? 'flex' : 'none'
  }

  /* THE BUNDLE'S OWN ADD, WHEN IT CAN BE REACHED. The cart is React state in a provider whose
     value is { items, add, setQty, remove, clear, count, total } (read out of the bundle). Calling
     its `add` is exactly what the bundle's own "+" does: the bag count, the drawer and the saved
     cart all update at once, with no reload and nothing written behind its back. It is found by
     walking up from a React-drawn element to the provider; if that walk finds nothing (a different
     bundle build, a React that stores its tree differently) this returns null and the caller falls
     back to the reload path below, which is slower and always right. */
  function bundleCart() {
    try {
      var picks = [document.querySelector('header'), document.querySelector('main'), document.getElementById('root'), document.body.firstElementChild]
      for (var i = 0; i < picks.length; i++) {
        var el = picks[i]
        if (!el) continue
        var key = null
        for (var k in el) { if (k.indexOf('__reactFiber$') === 0) { key = k; break } }
        if (!key) continue
        for (var f = el[key], n = 0; f && n < 200; f = f.return, n++) {
          var v = f.memoizedProps && f.memoizedProps.value
          if (v && typeof v.add === 'function' && typeof v.setQty === 'function' && Array.isArray(v.items)) return v
        }
      }
    } catch (e) {}
    return null
  }

  function addToCart(slug, size, img) {
    var info = infoBySlug[slug]
    if (!info) return false
    var key = slug + '__' + size + '__normal'
    var raw = null
    try { raw = localStorage.getItem('sporta_cart') } catch (e) { return false }
    var cart = []
    try { cart = raw ? JSON.parse(raw) : [] } catch (e) { cart = [] }
    if (!Array.isArray(cart)) cart = []

    var found = false
    for (var i = 0; i < cart.length; i++) {
      if (cart[i] && cart[i].key === key) {
        cart[i].qty = (Number(cart[i].qty) || 0) + 1
        found = true
        break
      }
    }
    if (!found) {
      cart.push({
        key: key, slug: slug, size: size, fit: 'normal',
        name: info.name, price: info.price, image: img || '', qty: 1,
      })
    }

    var next = JSON.stringify(cart)
    try {
      localStorage.setItem('sporta_cart', next)
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'sporta_cart', oldValue: raw, newValue: next,
        storageArea: localStorage, url: location.href,
      }))
    } catch (e) { return false }
    return true
  }

  function closePanel(anchor) {
    var panel = anchor.querySelector('.qas-panel')
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel)
    anchor.removeAttribute('data-qas-open')
  }

  function openPanel(anchor, slug) {
    closePanel(anchor)
    var sizes = sizesBySlug[slug] || []
    if (!sizes.length) return

    var img = anchor.querySelector('img')
    var imgSrc = img ? img.currentSrc || img.src : ''

    var panel = document.createElement('div')
    panel.className = 'qas-panel'
    panel.setAttribute('role', 'dialog')

    var head = document.createElement('div')
    head.className = 'qas-head'
    head.textContent = t('choose')
    panel.appendChild(head)

    var closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'qas-close'
    closeBtn.setAttribute('aria-label', t('close'))
    closeBtn.textContent = '×'
    closeBtn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); closePanel(anchor) }
    panel.appendChild(closeBtn)

    var row = document.createElement('div')
    row.className = 'qas-row'
    sizes.forEach(function (size) {
      var pill = document.createElement('button')
      pill.type = 'button'
      pill.className = 'qas-pill'
      pill.textContent = size
      pill.onclick = function (e) {
        e.preventDefault()
        e.stopPropagation()
        var info = infoBySlug[slug]
        var cart = bundleCart()
        if (cart && info) {
          cart.add({ slug: slug, name: info.name, price: info.price, image: imgSrc }, 1, size, 'normal')
          row.style.display = 'none'
          head.textContent = t('added')
          setTimeout(function () { closePanel(anchor) }, 1100)
          return
        }
        var ok = addToCart(slug, size, imgSrc)
        row.style.display = 'none'
        head.textContent = ok ? t('added') : ''
        if (ok && isStaticPage()) {
          paintStaticBag()
          setTimeout(function () { closePanel(anchor) }, 1100)
          return
        }
        if (ok) {
          // A REAL RELOAD, not a hope. The cart provider reads
          // `localStorage.sporta_cart` exactly once, in its own useState
          // initialiser — grepped the bundle before settling on this: there
          // is a `storage` event listener near the wishlist's array state,
          // and none anywhere near the cart's. A `StorageEvent` was tried
          // first and DID get parsed and re-persisted by SOMETHING (proof
          // the bundle even has that code path) — but the header's own "Bag,
          // N item" label and the drawer opened afterward still read "empty"
          // in the same tab, which is the one failure this file exists to
          // avoid: told "Added", then shown an empty bag. Reloading is the
          // only path that is actually true.
          try { sessionStorage.setItem('qas-scroll-y', String(window.scrollY)) } catch (e2) {}
          setTimeout(function () { location.reload() }, 650)
        } else {
          setTimeout(function () { closePanel(anchor) }, 900)
        }
      }
      row.appendChild(pill)
    })
    panel.appendChild(row)

    panel.onclick = function (e) { e.stopPropagation() }
    anchor.setAttribute('data-qas-open', '1')
    anchor.appendChild(panel)
  }

  function apply() {
    ready(function () {
      var links = document.querySelectorAll('a[href*="/product/"]')
      for (var i = 0; i < links.length; i++) {
        var a = links[i]
        if (a.getAttribute(MARK)) continue
        /* WHERE THE BUTTON GOES. On the bundle's own cards the photo is a direct child of the link
           and the button goes on the link. The shop's other two grids — the home page's Best
           sellers (home-products.js) and the category pages (category.php) — draw their photo
           inside a frame and had NO add button at all ("add add to cart button", 2026-10-01), so
           the button goes on that frame, which is positioned, and the size panel opens over it. */
        var host = null
        var own = false
        if (a.querySelector(':scope > img')) host = a
        /* no photo needed: a garment still waiting for its picture can be bought all the same */
        else if (a.matches('.sporta-home-products__card, a.card')) {
          host = a.querySelector('[class*="frame"]') || a
          own = true
        }
        if (!host) continue                                     /* a text link, not a card */
        /* A button is already there — but never count the wishlist heart: in Arabic its label is
           "أضف إلى المفضلة", which starts with the same word as "أضف — <name>", and on the cards
           this script draws for (home, category pages) that made every Arabic card look done. */
        if (a.querySelector('button:not([aria-pressed])[aria-label^="Add"], button:not([aria-pressed])[aria-label^="أضف"]')) continue

        var m = /\/product\/([^/?#]+)/.exec(a.getAttribute('href') || '')
        var slug = m ? decodeURIComponent(m[1]) : null
        if (!slug || !infoBySlug[slug]) continue
        var sizes = sizesBySlug[slug]
        if (!sizes || !sizes.length) continue

        a.setAttribute(MARK, '1')

        var btn = document.createElement('button')
        btn.type = 'button'
        btn.setAttribute('aria-label', t('add') + ' — ' + infoBySlug[slug].name[ar() ? 'ar' : 'en'])
        btn.className = own
          ? 'qas-btn qas-btn--own'     /* no Tailwind on these grids: styled below, always visible */
          : 'absolute bottom-2 end-2 flex h-11 w-11 items-center justify-center '
          + 'rounded-full shadow-md transition focus-visible:opacity-100 bg-white/95 text-ink '
          + 'backdrop-blur hover:bg-brand hover:text-ink lg:translate-y-1 lg:opacity-0 '
          + 'lg:group-hover:translate-y-0 lg:group-hover:opacity-100 qas-btn'
        btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" '
          + 'fill="none" stroke="currentColor" stroke-width="2.33" stroke-linecap="round" '
          + 'stroke-linejoin="round" aria-hidden="true" focusable="false">'
          + '<path d="M12 5v14M5 12h14"></path></svg>'
        btn.onclick = function (slugForClick, hostEl) {
          return function (e) {
            e.preventDefault()
            e.stopPropagation()
            var open = hostEl.querySelector('.qas-panel')
            if (open) { closePanel(hostEl); return }
            openPanel(hostEl, slugForClick)
          }
        }(slug, host)
        host.appendChild(btn)
      }
    })
  }

  var CSS =
    '.qas-panel{position:absolute;inset-inline:0;bottom:0;z-index:20;padding:10px;'
    + 'background:rgba(23,26,30,.92);backdrop-filter:blur(2px);border-radius:0 0 10px 10px}'
    + '.qas-head{font-size:11px;font-weight:700;color:#fff;margin-bottom:10px;padding-inline-end:30px}'
    /* 32x32, not the usual 44 — measured against this panel's own height:
     * a 44px-tall close button anchored to the top corner would reach down
     * into the size-pill row directly beneath it on the smallest cards, the
     * same "widening causes a worse problem than the one it fixes" trade
     * this project already made for the hero carousel's dots. 32px is a
     * real improvement over the 22px this shipped with (an AA-legal 24px
     * hit area, comfortably cleared) without that overlap. */
    + '.qas-close{position:absolute;top:2px;inset-inline-end:2px;display:flex;'
    + 'align-items:center;justify-content:center;border:0;background:transparent;'
    + 'color:#fff;font-size:16px;line-height:1;cursor:pointer;min-width:32px;min-height:32px}'
    + '.qas-row{display:flex;flex-wrap:wrap;gap:5px}'
    + '.qas-pill{min-width:30px;height:28px;padding:0 8px;border-radius:7px;border:0;'
    + 'background:#fff;color:#171a1e;font-size:11px;font-weight:700;cursor:pointer}'
    + '.qas-pill:hover{background:var(--brand,#e0561c);color:#171a1e}'
    + '.qas-btn{z-index:21}'
    /* the button on the home and category grids: the shop's orange disc with a white plus, 44px */
    + '.qas-btn--own{position:absolute;bottom:8px;inset-inline-end:8px;display:flex;align-items:center;'
    + 'justify-content:center;width:44px;height:44px;padding:0;border:0;border-radius:50%;cursor:pointer;'
    /* the fill follows the owner's brand colour (theme.js sets --sp-cta); the literal is the shipped orange */
    + 'background:var(--sp-cta,#f56315);color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.35)}'
    + '.qas-btn--own:hover{background:var(--brand-bright,#ff7b17)}'
    /* the size chooser covers the bottom of the photo; the + would sit on top of its pills */
    /* WHILE THE CHOOSER IS OPEN THE + STEPS ASIDE, on every card (2026-10-01). Since the + sits
       beside the price (the /shop card everywhere) the chooser opens over it, and in Arabic the
       first size lands exactly under it: the + (z-index 21) took the tap and that size could not
       be chosen. The chooser has its own close button, so nothing is lost. */
    + '[data-qas-open]>.qas-btn{visibility:hidden}'
    + '.qas-btn--own:focus-visible{outline:2px solid #fff;outline-offset:2px}'
    /* THE BUNDLE NOW DRAWS ITS OWN "Choose size" BUTTON on these cards, in the
       same bottom-end corner. The header above predates it. The button above
       covers it completely, so a pointer could never reach it, while a
       keyboard or a screen reader met two stacked controls for one card.
       It is hidden only on cards this script has taken over. */
    + '[' + MARK + '] button[aria-label^="Choose size"]:not(.qas-btn),'
    + '[' + MARK + '] button[aria-label^="اختر المقاس"]:not(.qas-btn){display:none!important}'

  function style() {
    if (document.getElementById('qas-css')) return
    var s = document.createElement('style')
    s.id = 'qas-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }
  style()

  document.addEventListener('click', function () {
    var open = document.querySelectorAll('.qas-panel')
    for (var i = 0; i < open.length; i++) {
      var anchor = open[i].parentElement
      if (anchor) closePanel(anchor)
    }
  })

  apply()

  var queued = false, ours = false
  new MutationObserver(function () {
    if (ours || queued) return
    queued = true
    requestAnimationFrame(function () {
      queued = false
      ours = true
      try { apply() } finally { ours = false }
    })
  }).observe(document.body, { childList: true, subtree: true })

  /* THE OTHER HALF OF THE RELOAD ABOVE. Measured before relying on it: a
   * plain `location.reload()` on this SPA resets scroll to 0 — the browser's
   * own scroll restoration does not survive whatever this bundle does on
   * mount. So the Y position is saved just before reloading and restored
   * here, once the grid has actually painted enough to have that much
   * height — restoring against a half-loaded page would scroll to the wrong
   * place and then get quietly overridden as more cards arrive. Capped
   * attempts rather than an unbounded poll, so a page this never applies to
   * (the value survives navigation to a different route) does not loop
   * forever. */
  var savedY = null
  try { savedY = sessionStorage.getItem('qas-scroll-y') } catch (e3) {}
  if (savedY !== null) {
    try { sessionStorage.removeItem('qas-scroll-y') } catch (e4) {}
    var target = parseInt(savedY, 10) || 0
    var tries = 0
    var restore = function () {
      tries++
      if (document.documentElement.scrollHeight >= target + window.innerHeight || tries > 40) {
        window.scrollTo(0, target)
        if (tries <= 40) return
      }
      if (tries <= 40) setTimeout(restore, 100)
    }
    restore()
  }
})()
