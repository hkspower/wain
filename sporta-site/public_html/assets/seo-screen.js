/**
 * An "SEO" screen in the website panel (2026-10-02, "add seo setup and sitemap builder and robots txt
 * builder at backend"). Same overlay as payments-screen.js: one button in the sidebar and the phone tab
 * bar, a screen drawn inside `.admin-content` while it is open, the bundle's own screen given back the
 * moment any other button is pressed. Nothing the bundle owns is changed.
 *
 * Four cards, each saved on its own:
 *   Search appearance   home title/description per language + Google's verification tag   (settings `seo`)
 *   Share picture       the default og:image                                              (seo_image_save)
 *   Sitemap & robots    sections, extra links, AI crawlers, extra rules, products kept out (settings `crawl`)
 *   Product SEO         a search title/description per product                            (seo_product_save)
 *
 * The server checks everything again and refuses by name; a refusal leaves what was typed on screen.
 * The protective robots rules are shown, never editable.
 */
(function () {
  'use strict'

  var ADMIN = '/api/admin.php?r='
  var MARK = 'data-spseo'
  var open = false, screen = null, saved = [], state = null

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function call(route, body) {
    return fetch(ADMIN + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' },
      credentials: 'include', body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().catch(function () { return null }) })
      .catch(function () { return { error: 'network' } })
  }

  var WHY = {
    invalid_google_verification: 'That is not a Google verification code. In Search Console choose "HTML tag" and paste the whole tag or just the code inside content="…".',
    invalid_robots_rule: 'A robots rule must be a path starting with / (letters, numbers, / - _ . * $ ? = & %).',
    robots_rule_blocks_key_page: 'That rule would hide a page the shop needs in Google: ',
    robots_unknown_bot: 'That crawler cannot be switched here.',
    invalid_sitemap_link: 'A sitemap link must be a page on this shop, like /shop or https://www.sporta.com.kw/about.',
    sitemap_link_private: 'Private pages cannot be listed in the sitemap: ',
    sitemap_empty: 'Keep at least one sitemap section switched on, or add a link.',
    seo_image_bad_format: 'Choose a JPG, PNG or WebP picture.', seo_image_not_an_image: 'That file is not a picture.',
    seo_image_too_large: 'That picture is too large. Try a smaller one.', seo_image_wrong_size: 'The picture must be at least 600 × 315 pixels.',
    seo_not_ready: 'The shop is not set up for this yet (the SEO tables are missing).',
    seo_unknown_product: 'That product no longer exists.', not_signed_in: 'Your session has ended. Sign in again.',
    network: 'The save did not reach the shop. Check the connection and try again.',
  }
  function why(e) { e = String(e || ''); var k = e.split(':')[0]; return (WHY[k] || e) + (e.indexOf(':') > 0 && WHY[k] && /: $/.test(WHY[k]) ? e.slice(k.length + 1) : '') }
  function say(note, t, good) { note.textContent = t || ''; note.style.color = t ? (good ? '#16a34a' : '#dc2626') : '' }

  var CSS = ''
    + '.admin-content.spseo-on>:not([' + MARK + ']){display:none!important}'
    + '.spseo-sec{border:1px solid var(--sp-pc-border,#494e54);border-radius:1rem;padding:1.25rem;margin:1rem 0;background:var(--sp-pc-bg,transparent)}'
    + '.spseo-h{margin:0 0 4px;font-size:16px;font-weight:700}.spseo-h1{margin:0 0 6px;font-size:22px;font-weight:800}'
    + '.spseo-sub{margin:0 0 12px;font-size:13px;opacity:.8;line-height:1.5}'
    + '.spseo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}'
    + '.spseo-f{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}'
    + '.spseo-l{font-size:13px;font-weight:600}.spseo-c{font-size:12px;opacity:.7}'
    + '.spseo-in,.spseo-ta{width:100%;box-sizing:border-box;padding:8px 10px;min-height:40px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font:inherit}'
    + '.spseo-ta{min-height:84px;resize:vertical}'
    + '.spseo-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}'
    + '.spseo-btn{min-height:44px;padding:9px 16px;border-radius:8px;border:0;cursor:pointer;background:#4f46e5;color:#fff;font:inherit;font-weight:700}'
    + '.spseo-btn2{min-height:44px;padding:9px 14px;border-radius:8px;cursor:pointer;font:inherit;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee)}'
    + '.spseo-btn[disabled],.spseo-btn2[disabled]{opacity:.5;cursor:default}'
    + '.spseo-note{margin:0;font-size:13px;line-height:1.5}'
    + '.spseo-chk{display:flex;align-items:center;gap:8px;min-height:44px;font-size:14px}.spseo-chk input{width:20px;height:20px}'
    + '.spseo-bots{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:0 12px}'
    + '.spseo-lock{font:12px/1.6 ui-monospace,monospace;opacity:.8;background:rgba(128,128,128,.12);border-radius:8px;padding:8px 10px;white-space:pre-wrap;margin:0 0 10px}'
    + '.spseo-img{display:block;max-width:100%;width:360px;aspect-ratio:1.91;object-fit:cover;border-radius:8px;border:1px solid var(--sp-pc-border,#494e54);background:#111}'
    // No padding on a closed row (2026-10-08, "fix large boxes"): the summary is the tap target and
    // already 44px, so the 8px above and below it was dead space on every device — a one-line row
    // 61px tall, 46 of them 2,806px. 45px now, and an opened row keeps 12px under its Save button.
    + '.spseo-prod{border-top:1px solid rgba(128,128,128,.25);padding:0}.spseo-prod[open]{padding-bottom:12px}'
    + '.spseo-prod summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}'
    + '.spseo-tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(79,70,229,.2)}'
    + '.spseo-a{color:inherit;text-decoration:underline}'
  function style() { if (document.getElementById('spseo-css')) return; var s = el('style'); s.id = 'spseo-css'; s.textContent = CSS; document.head.appendChild(s) }

  function field(parent, label, max, value, dir, area) {
    var w = el('div', 'spseo-f'); var l = el('label', 'spseo-l', label); var i = el(area ? 'textarea' : 'input', area ? 'spseo-ta' : 'spseo-in')
    var id = 'spseo-' + Math.random().toString(36).slice(2); i.id = id; l.htmlFor = id
    if (!area) i.type = 'text'; if (max) i.maxLength = max; if (dir) i.setAttribute('dir', dir); i.value = value || ''
    w.appendChild(l); w.appendChild(i)
    if (max) { var c = el('span', 'spseo-c'); var upd = function () { c.textContent = i.value.length + ' / ' + max }; i.addEventListener('input', upd); upd(); w.appendChild(c) }
    parent.appendChild(w); return i
  }
  function btn(text, primary, fn) { var b = el('button', primary ? 'spseo-btn' : 'spseo-btn2', text); b.type = 'button'; b.addEventListener('click', function () { fn(b) }); return b }
  function lines(t) { return t.split(/\r?\n/).map(function (x) { return x.trim() }).filter(Boolean) }

  /* ----------------------------------------------------------- the cards */
  function searchCard(root) {
    var s = state.seo, sec = el('section', 'spseo-sec'); root.appendChild(sec)
    sec.appendChild(el('h2', 'spseo-h', 'Search appearance'))
    sec.appendChild(el('p', 'spseo-sub', 'The home page in Google results. Empty = the built-in text.'))
    var g = el('div', 'spseo-grid'); sec.appendChild(g)
    var tAr = field(g, 'Title — Arabic', 70, s.title_ar, 'rtl'), tEn = field(g, 'Title — English', 70, s.title_en, 'ltr')
    var g2 = el('div', 'spseo-grid'); sec.appendChild(g2)
    var dAr = field(g2, 'Description — Arabic', 200, s.desc_ar, 'rtl', true), dEn = field(g2, 'Description — English', 200, s.desc_en, 'ltr', true)
    var gv = field(sec, 'Google verification (Search Console → HTML tag)', 300, s.google_verification, 'ltr')
    var note = el('p', 'spseo-note'), row = el('div', 'spseo-row')
    row.appendChild(btn('Save search appearance', true, function (b) {
      b.disabled = true; say(note, 'Saving…', true)
      call('settings_save', { name: 'seo', value: { title_ar: tAr.value, title_en: tEn.value, desc_ar: dAr.value, desc_en: dEn.value, google_verification: gv.value } }).then(function (r) {
        b.disabled = false
        if (!r || r.error) { say(note, why(r && r.error), false); return }
        state.seo = r; gv.value = r.google_verification || ''; say(note, 'Saved.', true)
      })
    }))
    row.appendChild(note); sec.appendChild(row)
  }

  function imageCard(root) {
    var sec = el('section', 'spseo-sec'); root.appendChild(sec)
    sec.appendChild(el('h2', 'spseo-h', 'Share picture'))
    sec.appendChild(el('p', 'spseo-sub', 'Shown when a page is shared on WhatsApp, X or Facebook. Product pages with a photo use their own. Best at 1200 × 630.'))
    var img = el('img', 'spseo-img'); img.alt = 'Current share picture'
    var paint = function () { img.src = state.image ? state.image.replace(/^https:\/\/www\.sporta\.com\.kw/, '') : '/og-image.png' }
    paint(); sec.appendChild(img)
    var file = el('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.style.display = 'none'; sec.appendChild(file)
    var note = el('p', 'spseo-note'), row = el('div', 'spseo-row')
    row.appendChild(btn('Choose picture', true, function () { file.click() }))
    var rm = btn('Use the built-in picture', false, function (b) {
      b.disabled = true
      call('seo_image_save', { remove: true }).then(function (r) { b.disabled = false; if (!r || r.error) { say(note, why(r && r.error), false); return } state.image = null; paint(); say(note, 'The built-in picture is back.', true) })
    })
    row.appendChild(rm); row.appendChild(note); sec.appendChild(row)
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return
      say(note, 'Preparing…', true)
      // Read as a data: URL, never a blob: — the live CSP has no blob: in img-src (category-art.js).
      var rd = new FileReader()
      rd.onload = function () {
        var pic = new Image()
        pic.onload = function () {
          var W = 1200, H = 630, c = document.createElement('canvas'); c.width = W; c.height = H
          var k = Math.max(W / pic.naturalWidth, H / pic.naturalHeight), w = pic.naturalWidth * k, h = pic.naturalHeight * k
          var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(pic, (W - w) / 2, (H - h) / 2, w, h)
          say(note, 'Saving…', true)
          call('seo_image_save', { image: c.toDataURL('image/jpeg', 0.86) }).then(function (r) {
            file.value = ''
            if (!r || r.error) { say(note, why(r && r.error), false); return }
            state.image = r.image; paint(); say(note, 'Saved. Shared links pick it up as the apps refresh their previews.', true)
          })
        }
        pic.onerror = function () { say(note, why('seo_image_not_an_image'), false) }
        pic.src = rd.result
      }
      rd.readAsDataURL(f)
    })
  }

  var crawlNote = null, excludeSet = {}
  function crawlCard(root) {
    var c = state.crawl, sec = el('section', 'spseo-sec'); root.appendChild(sec)
    excludeSet = {}; c.exclude.forEach(function (s) { excludeSet[s] = true })
    sec.appendChild(el('h2', 'spseo-h', 'Sitemap'))
    sec.appendChild(el('p', 'spseo-sub', 'What /sitemap.xml offers to Google. Products can be kept out below, under Product SEO.'))
    var boxes = {}
    ;[['pages', 'Pages (about, contact, policies…)'], ['categories', 'Category pages (men, women, accessories, outlet)'], ['products', 'Products']].forEach(function (s) {
      var l = el('label', 'spseo-chk'), i = el('input'); i.type = 'checkbox'; i.checked = !!c.sections[s[0]]; boxes[s[0]] = i
      l.appendChild(i); l.appendChild(document.createTextNode(s[1])); sec.appendChild(l)
    })
    var custom = field(sec, 'Extra links, one per line (pages on this shop)', 0, c.custom.join('\n'), 'ltr', true)
    var a = el('a', 'spseo-a', 'Open /sitemap.xml'); a.href = '/sitemap.xml'; a.target = '_blank'; a.rel = 'noopener'; sec.appendChild(a)

    sec.appendChild(el('h2', 'spseo-h', 'robots.txt'))
    sec.appendChild(el('p', 'spseo-sub', 'Google and Bing are always allowed. These rules are fixed and protect the panel and payments:'))
    sec.appendChild(el('pre', 'spseo-lock', 'Disallow: /backends\nDisallow: /admin\nDisallow: /api/\nDisallow: /knet/\nDisallow: /pay/'))
    sec.appendChild(el('p', 'spseo-l', 'Block these AI crawlers'))
    var bots = {}, bw = el('div', 'spseo-bots'); sec.appendChild(bw)
    state.bots.forEach(function (b) {
      var l = el('label', 'spseo-chk'), i = el('input'); i.type = 'checkbox'; i.checked = c.block.indexOf(b) !== -1; bots[b] = i
      l.appendChild(i); l.appendChild(document.createTextNode(b)); bw.appendChild(l)
    })
    var dis = field(sec, 'Extra paths to keep out, one per line (e.g. /old-campaign)', 0, c.disallow.join('\n'), 'ltr', true)
    var a2 = el('a', 'spseo-a', 'Open /robots.txt'); a2.href = '/robots.txt'; a2.target = '_blank'; a2.rel = 'noopener'; sec.appendChild(a2)

    crawlNote = el('p', 'spseo-note'); var row = el('div', 'spseo-row')
    row.appendChild(btn('Save sitemap & robots', true, function (b) {
      b.disabled = true; say(crawlNote, 'Saving…', true)
      var value = {
        sections: { pages: boxes.pages.checked, categories: boxes.categories.checked, products: boxes.products.checked },
        custom: lines(custom.value), disallow: lines(dis.value),
        block: state.bots.filter(function (x) { return bots[x].checked }),
        exclude: Object.keys(excludeSet).filter(function (k) { return excludeSet[k] }),
      }
      call('settings_save', { name: 'crawl', value: value }).then(function (r) {
        b.disabled = false
        if (!r || r.error) { say(crawlNote, why(r && r.error), false); return }
        state.crawl = r; custom.value = r.custom.join('\n'); dis.value = r.disallow.join('\n'); say(crawlNote, 'Saved.', true)
      })
    }))
    row.appendChild(crawlNote); sec.appendChild(row)
  }

  function productsCard(root) {
    var sec = el('section', 'spseo-sec'); root.appendChild(sec)
    sec.appendChild(el('h2', 'spseo-h', 'Product SEO'))
    sec.appendChild(el('p', 'spseo-sub', 'A search title and description per product. Empty = the product\'s own name and description. "In sitemap" is saved with Save sitemap & robots.'))
    if (!state.ready) sec.appendChild(el('p', 'spseo-note', why('seo_not_ready')))
    var q = field(sec, 'Find a product', 60, '', null)
    var list = el('div'); sec.appendChild(list)
    var draw = function () {
      list.textContent = ''
      var term = q.value.trim().toLowerCase(), shown = 0
      state.products.forEach(function (p) {
        if (term && (p.name_en + ' ' + p.name_ar + ' ' + p.slug).toLowerCase().indexOf(term) === -1) return
        if (++shown > 60) return
        var d = el('details', 'spseo-prod'); d.setAttribute('data-slug', p.slug)
        var s = el('summary'); s.appendChild(el('span', null, p.name_en || p.name_ar))
        if (p.seo_title_en || p.seo_title_ar || p.seo_desc_en || p.seo_desc_ar) s.appendChild(el('span', 'spseo-tag', 'Custom'))
        var l = el('label', 'spseo-chk'), i = el('input'); i.type = 'checkbox'; i.checked = !excludeSet[p.slug]
        i.addEventListener('click', function (e) { e.stopPropagation() })
        i.addEventListener('change', function () { excludeSet[p.slug] = !i.checked; if (crawlNote) say(crawlNote, 'Unsaved: press Save sitemap & robots.', true) })
        l.appendChild(i); l.appendChild(document.createTextNode('In sitemap')); s.appendChild(l)
        d.appendChild(s)
        d.addEventListener('toggle', function () {
          if (!d.open || d.querySelector('.spseo-f')) return
          var g = el('div', 'spseo-grid'); d.appendChild(g)
          var tAr = field(g, 'Search title — Arabic', 70, p.seo_title_ar, 'rtl'), tEn = field(g, 'Search title — English', 70, p.seo_title_en, 'ltr')
          var g2 = el('div', 'spseo-grid'); d.appendChild(g2)
          var dAr = field(g2, 'Search description — Arabic', 200, p.seo_desc_ar, 'rtl', true), dEn = field(g2, 'Search description — English', 200, p.seo_desc_en, 'ltr', true)
          var note = el('p', 'spseo-note'), row = el('div', 'spseo-row')
          row.appendChild(btn('Save product SEO', true, function (b) {
            b.disabled = true; say(note, 'Saving…', true)
            call('seo_product_save', { slug: p.slug, title_ar: tAr.value, title_en: tEn.value, desc_ar: dAr.value, desc_en: dEn.value }).then(function (r) {
              b.disabled = false
              if (!r || r.error) { say(note, why(r && r.error), false); return }
              p.seo_title_ar = r.title_ar; p.seo_title_en = r.title_en; p.seo_desc_ar = r.desc_ar; p.seo_desc_en = r.desc_en
              say(note, 'Saved.', true)
            })
          }))
          row.appendChild(note); d.appendChild(row)
        })
        list.appendChild(d)
      })
      if (shown > 60) list.appendChild(el('p', 'spseo-sub', (shown - 60) + ' more — type to narrow the list.'))
      if (!shown) list.appendChild(el('p', 'spseo-sub', 'No product matches.'))
    }
    q.addEventListener('input', draw); draw()
  }

  function build() {
    var root = el('div'); root.setAttribute(MARK, '1')
    root.appendChild(el('h1', 'spseo-h1', 'SEO'))
    var body = el('div'); root.appendChild(body)
    body.appendChild(el('p', 'spseo-sub', 'Loading…'))
    return root
  }
  function load() {
    call('seo_state').then(function (r) {
      var body = screen && screen.lastChild; if (!body) return
      body.textContent = ''
      if (!r || r.error) { body.appendChild(el('p', 'spseo-note', why(r && r.error) || 'Could not read the SEO settings.')); return }
      state = r
      searchCard(body); imageCard(body); crawlCard(body); productsCard(body)
    })
  }

  /* -------------------------------------------------- nav + open (payments-screen.js's pattern) */
  function setCurrent(mine) {
    var all = document.querySelectorAll('.admin-sidebar button, .m-tabbar__item')
    if (mine) {
      saved = []
      all.forEach(function (b) {
        if (b.hasAttribute('data-spseo-nav')) return
        saved.push([b, b.getAttribute('aria-current'), b.className])
        if (b.classList.contains('m-tabbar__item')) b.setAttribute('aria-current', 'false')
        else b.className = b.className.replace('bg-indigo-50 text-indigo-600', 'text-slate-600 hover:bg-slate-50')
      })
    } else {
      saved.forEach(function (x) { if (x[0].isConnected) { if (x[1] === null) x[0].removeAttribute('aria-current'); else x[0].setAttribute('aria-current', x[1]); x[0].className = x[2] } })
      saved = []
    }
    document.querySelectorAll('[data-spseo-nav]').forEach(function (b) {
      if (b.classList.contains('m-tabbar__item')) b.setAttribute('aria-current', mine ? 'true' : 'false')
      else { b.classList.toggle('bg-indigo-50', mine); b.classList.toggle('text-indigo-600', mine); b.classList.toggle('text-slate-600', !mine) }
    })
  }
  function openScreen() {
    var host = document.querySelector('.admin-content'); if (!host) return
    style()
    if (screen && screen.parentNode) screen.parentNode.removeChild(screen)
    screen = build()
    host.insertBefore(screen, host.firstChild)
    host.classList.add('spseo-on'); open = true
    setCurrent(true); load()
    try { window.scrollTo({ top: 0, behavior: 'instant' }) } catch (e) { window.scrollTo(0, 0) }
  }
  function closeScreen() {
    if (!open) return
    open = false
    var host = document.querySelector('.admin-content'); if (host) host.classList.remove('spseo-on')
    if (screen && screen.parentNode) screen.parentNode.removeChild(screen)
    setCurrent(false)
  }
  function addNav() {
    if (!document.querySelector('.admin-content')) { open = false; return }
    var side = document.querySelector('.admin-sidebar')
    if (side && !side.querySelector('[data-spseo-nav]')) {
      var ref = null
      side.querySelectorAll('button').forEach(function (b) { if (/^\s*Settings\s*$/.test(b.textContent)) ref = b })
      if (ref) {
        var b = ref.cloneNode(true); b.setAttribute('data-spseo-nav', '1')
        b.removeAttribute('data-spps-nav')
        b.className = ref.className.replace('bg-indigo-50 text-indigo-600', 'text-slate-600 hover:bg-slate-50')
        b.querySelectorAll('*').forEach(function (n) { n.childNodes.forEach(function (c) { if (c.nodeType === 3 && /Settings/.test(c.textContent)) c.textContent = 'SEO' }) })
        var after = side.querySelector('[data-spps-nav]') || ref
        after.parentNode.insertBefore(b, after.nextSibling)
      }
    }
    var bar = document.querySelector('.m-tabbar')
    if (bar && !bar.querySelector('[data-spseo-nav]')) {
      var tref = null
      bar.querySelectorAll('.m-tabbar__item').forEach(function (b) { if (/Settings/.test(b.textContent) && !b.hasAttribute('data-spps-nav')) tref = b })
      if (tref) {
        var t = tref.cloneNode(true); t.setAttribute('data-spseo-nav', '1'); t.setAttribute('aria-current', 'false')
        t.childNodes.forEach(function (c) { if (c.nodeType === 3) c.textContent = 'SEO' })
        var tafter = bar.querySelector('[data-spps-nav]') || tref
        tafter.parentNode.insertBefore(t, tafter.nextSibling)
      }
    }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button')
    if (!b) return
    if (b.hasAttribute('data-spseo-nav')) { e.preventDefault(); e.stopPropagation(); openScreen(); return }
    if (open && (b.closest('.admin-sidebar') || b.classList.contains('m-tabbar__item'))) closeScreen()
  }, true)
  var t = null
  new MutationObserver(function () {
    clearTimeout(t)
    t = setTimeout(function () {
      if (!/^\/backends(\/|$)/.test(location.pathname)) return
      addNav()
      if (open && screen && !screen.isConnected) { var h = document.querySelector('.admin-content'); if (h) h.insertBefore(screen, h.firstChild) }
    }, 150)
  }).observe(document.body, { childList: true, subtree: true })
})()
