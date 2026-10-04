/* Sporta — a three-icon trust strip on the home page, directly under the hero.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * Asked for after reviewing a competitor's theme for ideas: a shopper lands on
 * the hero and has to scroll and dig before finding out the shop delivers
 * across Kuwait or exchanges free within its own return window — both true,
 * both already policy, neither visible above the fold. This surfaces them
 * once, with zero new backend cost, the same trade brand-strip.js already made
 * for "which brands does this shop carry".
 *
 * THE RETURN WINDOW IS READ, NEVER TYPED IN. CLAUDE.md records, at length, a
 * shop that told a customer "free exchange within 14 days" in fixed copy while
 * the owner had changed the real window to 3 in the database — the storefront
 * bundle does not read the rules it advertises. Typing "14" here would be the
 * same mistake in a new file. ?r=slides already carries `rules.return_days`
 * (store_rules_public() marks it public, alongside delivery_fee_fils and
 * governorates), and every page that needs anything from that response is
 * already making it — this adds no new request the shop was not already
 * paying for elsewhere on this page.
 *
 * THE OTHER TWO ARE DELIBERATELY GENERIC. Delivery coverage ("across Kuwait")
 * needs no number to be true regardless of the fee or the free-delivery
 * threshold, which can change without this claim going stale. "100% authentic
 * products" is a marketing claim with no rules field behind it — carried over
 * from the reference theme's own copy, not verified against anything this
 * script can read, and worth the owner confirming it is one they want to make
 * before treating it as settled. REMOVED 2026-10-02 ("remove any value you put randomly").
 *
 * ------------------------------------------------------------ WHERE IT GOES
 *
 * Same anchor as brand-strip.js and the same reasoning: `main section[aria-
 * roledescription]` is the hero carousel, a stable selector across both
 * languages because the ATTRIBUTE VALUE is a fixed ARIA vocabulary term rather
 * than translated text. Inserted as a sibling immediately after it — brand-
 * strip.js also inserts there, so if both are present this one goes second
 * (checked by re-running place() after brand-strip.js's own insertion; order
 * follows whichever script's mutation observer fires last on a given paint,
 * which is not guaranteed — see the note above build() for how that is made
 * deterministic instead of left to chance).
 *
 * ------------------------------------------------------------------- MARKUP
 *
 * No icon library ships with this bundle and none is added for three glyphs —
 * three inline SVGs, minimal, single-colour, sized like the rest of this
 * page's icon-and-text rows. No image asset is copied from the reference
 * theme: those files belong to a commercial theme package, and reusing them
 * here would be exactly the licensing mistake this project already made once
 * with a bank manual — see CLAUDE.md, "the manuals were briefly committed".
 *
 * ------------------------------------------------------------------- FRAGILITY
 *
 * DOM surgery on a page with no source here, same class of thing as
 * contact.js, tile-art.js and brand-strip.js. If the hero section cannot be
 * found, nothing is inserted — this can only ever ADD a section, never touch
 * an existing one. If ?r=slides is unreachable, return_days falls back to a
 * dash rather than a number, so a network hiccup shows "free exchange within
 * — days" rather than a wrong one.
 */
;(function () {
  'use strict'

  var MARK = 'data-sporta-trust-strip'

  var COPY = {
    ar: {
      title: 'مميزات سبورتا',
      returns: function (n) { return 'استبدال مجاني خلال ' + (n ? String(n).replace(/[0-9]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[+d] }) : '—') + ' يومًا' },
      // FIXED "1 KWD", chosen by the owner 2026-10-02 over following the delivery fee in
      // /backends. The space before د.ك is U+00A0 on purpose: rules-live.js rewrites the
      // ordinary-space form to the fee rule, and this line must not follow it.
      delivery: 'التوصيل ١\u00a0د.ك لجميع مناطق الكويت',
    },
    en: {
      title: 'Sporta features',
      returns: function (n) { return 'Free exchange within ' + (n || '—') + ' days' },
      delivery: 'Delivery 1\u00a0KWD to all Kuwait',
    },
  }

  function lang() {
    return document.documentElement.lang === 'ar' ? 'ar' : 'en'
  }

  function isHome() {
    return location.pathname === '/'
  }

  function findHero() {
    var main = document.querySelector('main')
    if (!main) return null
    return main.querySelector('section[aria-roledescription]')
  }

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')
  var returnDays = null   /* null = not fetched yet */
  var fetching = false
  /* THE OWNER'S ROWS (2026-10-04, home_layout.features from /backends -> Home slides -> Menu &
     sections): title, rows (icon + text per language) and whether the band picture is drawn. Empty =
     the built-in COPY below. Kept beside the day count because both come from the same request. */
  var layout = null

  function loadReturnDays(cb) {
    if (returnDays !== null) { cb(returnDays); return }
    if (fetching) return
    fetching = true
    fetch(api + '/api.php?r=slides', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (data) {
        var n = data && data.rules && data.rules.return_days
        returnDays = (typeof n === 'number' && n > 0) ? n : 0
        var f = data && data.layout && data.layout.features
        layout = (f && typeof f === 'object' && ((f.rows && f.rows.length) || f.title_en || f.title_ar || f.picture === false)) ? f : null
        cb(returnDays)
      })
      .catch(function () { returnDays = 0; cb(returnDays) })
  }
  function layoutKey() { return layout ? JSON.stringify(layout) : '' }

  /* Three minimal, single-colour glyphs — drawn here rather than borrowed from
   * any icon set, so nothing is pulled in for three shapes. Each branch below
   * is a single literal string, `name` never reaches the markup itself — a
   * lookup table indexed by `name` would read the same on screen and would
   * not: it is one more place a future edit could put something other than a
   * fixed literal behind the same call. */
  function icon(name) {
    var span = document.createElement('span')
    span.className = 'sts-icon'
    switch (name) {
      case 'returns':
        span.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
          '<path d="M4 4v6h6M20 20v-6h-6" /><path d="M20 10a8 8 0 0 0-14.9-4M4 14a8 8 0 0 0 14.9 4" />' +
          '</svg>'
        break
      case 'delivery':
        span.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
          '<rect x="2" y="7" width="13" height="10" rx="1.5" /><path d="M15 10h4l3 3v4h-7z" />' +
          '<circle cx="7" cy="19" r="1.7" /><circle cx="18" cy="19" r="1.7" />' +
          '</svg>'
        break
      case 'payment':
        span.innerHTML = SVG + '<rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></svg>'
        break
      case 'shield':
        span.innerHTML = SVG + '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>'
        break
      case 'star':
        span.innerHTML = SVG + '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" /></svg>'
        break
      case 'truck':
        span.innerHTML = SVG + '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.7" /><circle cx="18" cy="18" r="1.7" /></svg>'
        break
      case 'chat':
        span.innerHTML = SVG + '<path d="M4 5h16v10H9l-5 4z" /></svg>'
        break
      case 'gift':
        span.innerHTML = SVG + '<rect x="3" y="9" width="18" height="12" rx="1.5" /><path d="M3 13h18M12 9v12M12 9c-2-4-6-4-6-1.5S10 9 12 9zm0 0c2-4 6-4 6-1.5S14 9 12 9z" /></svg>'
        break
    }
    return span
  }
  var SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'

  function build(days) {
    var c = COPY[lang()]
    var section = document.createElement('section')
    section.setAttribute(MARK, '1')
    section.className = 'sts-wrap'

    var L = lang(), own = layout
    var title = document.createElement('h2')
    title.className = 'sts-title'
    title.textContent = (own && (own['title_' + L] || own['title_' + (L === 'ar' ? 'en' : 'ar')])) || c.title
    section.appendChild(title)
    if (own && own.picture === false) section.className += ' sts-nopic'

    // THE ROWS SIT INSIDE THE PICTURE (owner, 2026-10-03): no models, the orange band as the
    // panel's background, white text on it. The band is central and the panel is `cover`, so
    // the text always lands on orange (see make-features-image.py).
    var body = document.createElement('div')
    body.className = 'sts-body sts-panel'
    var row = document.createElement('div')
    row.className = 'sts'
    body.appendChild(row)
    section.appendChild(body)

    var items = [
      ['returns', c.returns(days)],
      ['delivery', c.delivery],
    ]
    if (own && own.rows && own.rows.length) {
      items = []
      for (var r = 0; r < own.rows.length; r++) {
        var t = own.rows[r]['text_' + L] || own.rows[r]['text_' + (L === 'ar' ? 'en' : 'ar')]
        if (t) items.push([own.rows[r].icon || 'star', t])
      }
    }

    for (var i = 0; i < items.length; i++) {
      var item = document.createElement('div')
      item.className = 'sts-item'
      item.appendChild(icon(items[i][0]))
      var p = document.createElement('p')
      p.className = 'sts-text'
      p.textContent = items[i][1]
      item.appendChild(p)
      row.appendChild(item)
    }

    return section
  }

  function place() {
    if (!isHome()) {
      var stray = document.querySelector('[' + MARK + ']')
      if (stray && stray.parentNode) stray.parentNode.removeChild(stray)
      return
    }

    var hero = findHero()
    if (!hero || !hero.parentNode) return

    loadReturnDays(function (days) {
      if (!isHome()) return               /* navigated away while fetching */
      var hero2 = findHero()
      if (!hero2 || !hero2.parentNode) return

      var current = document.querySelector('[' + MARK + ']')
      if (current) {
        /* Already placed for this render — only the language or the fetched
         * day count can go stale between renders. */
        // Rebuilt ONLY when one of those two changed. It used to replace itself on every
        // observer tick, which is itself a DOM change — so it re-triggered the observer for ever
        // and re-created the picture each time.
        var key = lang() + '|' + days + '|' + layoutKey()
        if (current.getAttribute('data-key') === key) return
        var fresh = build(days)
        fresh.setAttribute('data-key', key)
        current.replaceWith(fresh)
        return
      }

      // AFTER THE HERO, AND AFTER BRAND-STRIP.JS IF IT IS ALSO PRESENT — a
      // fixed insertion point (immediately after the hero) rather than
      // "wherever this script happens to run" means the two overlays cannot
      // race into either order depending on which mutation observer fires
      // first on a given paint.
      var brandStrip = document.querySelector('[data-sporta-brand-strip]')
      var anchor = brandStrip && brandStrip.parentNode ? brandStrip : hero2
      var section = build(days)
      section.setAttribute('data-key', lang() + '|' + days + '|' + layoutKey())
      anchor.parentNode.insertBefore(section, anchor.nextSibling)
    })
  }

  var CSS =
    '.sts-wrap{margin:0 auto;max-width:1280px;padding:16px 16px 8px;}' +
    // Colours are the page's TOKENS, not literals: this section sits in <main>, whose white body
    // redefines them (65-white-body.css); a literal #fff title was white on white.
    '.sts-title{position:relative;margin:0 0 14px;padding:0;text-align:center;font-family:Alexandria,\'IBM Plex Sans Arabic\',system-ui,sans-serif;' +
    'font-size:21px;font-weight:700;line-height:1.3;color:var(--sp-text,#171a1e);}' +
    '.sts-panel{display:flex;align-items:center;justify-content:center;min-height:200px;padding:28px 20px;border-radius:16px;' +
    'background:var(--brand,#e0561c) url(/assets/features.webp) center/cover no-repeat;}' +
    '.sts-nopic .sts-panel{background-image:none;}' +
    '.sts{display:flex;flex-direction:column;gap:14px;margin:0;padding:0;width:100%;max-width:300px;}' +
    // White on the brand orange is 3.7:1, so the text is LARGE bold (>=18.66px, 700): AA for large text.
    '.sts-item{display:flex;align-items:center;gap:14px;padding:0;border:0;background:none;color:#fff;}' +
    '.sts-icon{flex:none;width:30px;height:30px;color:#fff;}' +
    '.sts-icon svg{width:100%;height:100%;}' +
    '.sts-text{margin:0;font-size:19px;font-weight:700;line-height:1.35;color:#fff;}' +
    '@media(min-width:768px){.sts-wrap{padding:24px 24px 12px;}.sts-title{font-size:26px;}' +
    '.sts-panel{min-height:260px;padding:40px 32px;}.sts{max-width:460px;gap:18px;}.sts-text{font-size:20px;}}'

  function style() {
    if (document.getElementById('sts-css')) return
    var s = document.createElement('style')
    s.id = 'sts-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }
  style()

  var queued = false
  var observer = new MutationObserver(function () {
    if (queued) return
    queued = true
    requestAnimationFrame(function () {
      queued = false
      place()
    })
  })
  observer.observe(document.body, { childList: true, subtree: true })
  place()
})()
