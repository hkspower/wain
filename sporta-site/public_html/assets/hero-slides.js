/**
 * Sporta — a hero-slide editor on the website's Settings screen: "give the
 * owner a real screen for hero_slides".
 *
 * WHAT EXISTED BEFORE THIS. Nothing. Every hero slide ever published — the
 * runner, the brightened set, the mobile compositions — was inserted by a
 * one-off PHP script in scripts/publish/, run once and thrown away. There was
 * no panel screen anywhere that could list a slide, change its focal point or
 * take it offline. CLAUDE.md's own rule applies here as directly as it ever
 * has: a screen the owner cannot reach in a browser is a screen that does not
 * exist to them.
 *
 * WHY SETTINGS. There is no "Hero" entry in this panel's own navigation, and
 * the nav is the prebuilt bundle's — not something an overlay can add to
 * (checked: nav-menu.js only ever edits an existing <li>'s label and href, it
 * never inserts a new top-level item, because React owns the click handling
 * on the real ones and a plain <a> dropped into the nav would not open a
 * screen that does not exist). So this follows the pattern already used for
 * the shop's other front-page copy — rules.js, theme-colors.js,
 * site-text-editor.js and legal-editor.js all live on Settings for the same
 * reason: it is the one screen this panel already treats as "the shop's own
 * words and pictures", and Settings is where an owner already looks for that.
 *
 * WHAT THIS DOES NOT CONTROL, AND WHY. CLAUDE.md's hero-art work measured, on
 * 2026-09-19, that the desktop hero box is 100svh and the phone box is a fixed
 * 2.10:1 — the box's HEIGHT is decided by sporta-ui.css and the bundle's own
 * layout, not by anything a slide row carries. `object-fit: cover` crops the
 * SIDES when the box is narrower (proportionally) than the artwork's own
 * 2.52:1, and on a box that ratio locks vertically to 1:1 with no crop slack
 * at all — a vertical focal point would move nothing. So this editor offers
 * exactly the one control that has a real effect, focal_x, and shows
 * width/height/aspect-ratio as READ-ONLY facts about the uploaded file. It
 * does not offer a height, width or aspect-ratio INPUT, because there is
 * nothing in this shop such a control could actually change — that would be a
 * dial connected to nothing, which is worse than no dial.
 *
 * THE PREVIEW IS CALIBRATED AGAINST A REAL RENDER, NOT ONLY AGAINST THE CSS
 * COMMENT — and the two disagree on phone, which is worth stating plainly.
 * sporta-ui.css documents 100vw/2.10 (83% of the banner visible) for the
 * hero on phone, but that formula governs the FIVE DRAWN FALLBACK slides
 * (.hero-strength/.hero-cardio/.hero-arena), which render only when no
 * hero_slides row is active. Measured in a real browser against an ACTUAL
 * photo slide (scripts/hero-slides-panel-test.mjs's own cross-check), a real
 * slide's image sits in a container classed `aspect-[2.52/1] md:aspect-auto`
 * — on phone that ratio is EXACTLY the artwork's own 2.52:1, so a real photo
 * slide shows 100% of the banner's width on phone and crops nothing.
 * FOCAL_X THEREFORE HAS NO VISIBLE EFFECT ON PHONE for a real slide today —
 * only on desktop, where `md:aspect-auto` hands sizing to `--hero-h-md:
 * 100svh`, and the box is narrower (proportionally) than the artwork on
 * every ordinary desktop window, so `cover` crops the sides there:
 *
 *   desktop (>=768px): box height = 100svh, box width = 100vw, so
 *                       visible% = min(1, (vw/svh) / 2.52) * 100
 *   phone   (<768px):  visible% = 100 (no crop at the current box ratio)
 *
 * The desktop half matches sporta-ui.css's own documented formula; the phone
 * half is what the browser actually does today, not what an older fallback
 * comment says. If the phone box ratio is ever changed to something other
 * than the artwork's own, this constant is the one to revisit.
 *
 * UPLOAD VALIDATION IS store_data_image() ON THE SERVER, the same function
 * every other image route in this shop uses — never a second, weaker check
 * invented for this screen. The client resizes and re-encodes to WebP before
 * sending (mirroring product-photos.js/brand-logos.js's own pattern), which is
 * a courtesy for page weight, not the security boundary; a non-image sent
 * straight to slide_save is refused by admin.php exactly as it would be
 * anywhere else in this panel.
 *
 * DEACTIVATING, NOT DELETING, IS THE DEFAULT ACTION IN THIS UI. admin.php DOES
 * have a slide_delete route (checked — CLAUDE.md's own note that "a slide is
 * genuinely deletable, unlike products and brands: nothing points at one"),
 * and it is wired here as a confirmed, secondary action. But the safe default
 * this screen offers first is the active toggle, matching the pattern already
 * used everywhere else in this panel — active = 0 keeps the row, the image and
 * the history of what was on the home page, and it costs nothing to undo.
 *
 * WITH NO ACTIVE ROW the bundle falls back to five drawn slides (api.php's own
 * comment on ?r=slides says so), so a list with everything off is not an
 * error state here — it is a real, supported shape of the shop.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var card = null
  var state = { slides: null, note: '', busy: false, editing: null, upload: {} }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  /* Arabic (٠-٩) and Persian (۰-۹) digits to 0-9. The sort box was type=number,
     which drops a digit it does not know, and the save read the empty box as
     `|| 0` — so "١٢" typed on an Arabic number pad silently saved sort 0. */
  function west(s) {
    return String(s).replace(/[\u0660-\u0669\u06F0-\u06F9]/g, function (c) {
      var n = c.charCodeAt(0)
      return String(n >= 0x06F0 ? n - 0x06F0 : n - 0x0660)
    })
  }

  function ask(route, body) {
    return fetch(API + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return { error: 'bad_response' } })
    })
  }

  /* ----------------------------------------------------- crop calibration -- */

  var ARTWORK_RATIO = 2.52 // the banner's own ratio, per sporta-ui.css
  var PHONE_BREAK = 768

  // The percentage of the banner's WIDTH that survives cover-crop, at a given
  // viewport. Mirrors sporta-ui.css's --hero-h / --hero-h-md formula exactly —
  // see the file header for the derivation and the citation.
  // CORRECTED 2026-09-29 against the real rendered hero (the rig's browser
  // cross-check had been failing: real 33.3 vs 46.6 on a phone, 84.7 vs 100 on
  // a desktop): the photo box is the hero's WHOLE height. The caption band the
  // 2026-09-24 version subtracted is not taken out of it any more. Phone is 24svh
  // since 2026-09-29 (it was 40svh, 55svh before), desktop 45svh (was 75svh).
  function visiblePct(viewportW, viewportH) {
    var photoH = viewportW < PHONE_BREAK
      ? viewportH * 0.10   // 10svh hero
      : viewportH * 0.18   // 18svh hero
    return Math.min(1, (viewportW / photoH) / ARTWORK_RATIO) * 100
  }

  /* ------------------------------------------------------------- size guide -- */
  // The numbers the guide prints and judge() measures against. The stored copy
  // of a desktop image is capped at BEST_W wide (downscale(file, 1600) below) and a
  // phone image at BEST_MW (1200), so those are the useful upper limits.
  var BEST_W = 1600
  var BEST_H = Math.round(BEST_W / ARTWORK_RATIO)   // 635
  var MIN_W = 1200
  var BEST_MW = 1200
  var MIN_MW = 800

  function judge(w, h, kind) {
    var ratio = w / h
    var lines = []
    var ok = true
    if (kind === 'desktop') {
      if (Math.abs(ratio - ARTWORK_RATIO) >= 0.15) {
        ok = false
        lines.push('Shape ' + ratio.toFixed(2) + ':1 — the banner is ' + ARTWORK_RATIO + ':1. ' +
          (ratio < ARTWORK_RATIO ? 'This is taller, so the top and bottom will be cut off. Crop it to ' + BEST_W + '×' + BEST_H + ' first.'
                                 : 'This is wider, so the sides will be cut off. Crop it to ' + BEST_W + '×' + BEST_H + ' first.'))
      }
      if (w < MIN_W) { ok = false; lines.push('Only ' + w + ' px wide — it will look soft on a large screen. Use at least ' + MIN_W + ', best ' + BEST_W + '.') }
      else if (w > BEST_W) lines.push('Wider than ' + BEST_W + ' px, so it will be shrunk to ' + BEST_W + ' wide when saved. That is fine.')
      return { ok: ok, headline: w + '×' + h + ' px · ' + ratio.toFixed(2) + ':1 — ' + (ok ? 'fits the banner' : 'needs attention'), lines: lines }
    }
    if (w < MIN_MW) { ok = false; lines.push('Only ' + w + ' px wide — it will look soft on a phone. Use at least ' + MIN_MW + ', best ' + BEST_MW + '.') }
    else if (w > BEST_MW) lines.push('Wider than ' + BEST_MW + ' px, so it will be shrunk to ' + BEST_MW + ' wide when saved. That is fine.')
    lines.push('Shape ' + ratio.toFixed(2) + ':1 — it is cropped to the phone banner, so the middle is what shows.')
    return { ok: ok, headline: w + '×' + h + ' px — ' + (ok ? 'good for phones' : 'needs attention'), lines: lines }
  }

  /* --------------------------------------------------------------- upload -- */

  // Downscale to at most `maxW` wide and re-encode as WebP q0.85 — a courtesy
  // for page weight; store_data_image() on the server is what actually
  // decides whether the bytes are a real image.
  function downscale(file, maxW) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader()
      reader.onerror = reject
      reader.onload = function () {
        var img = new Image()
        img.onerror = reject
        img.onload = function () {
          var scale = Math.min(1, maxW / img.naturalWidth)
          var w = Math.max(1, Math.round(img.naturalWidth * scale))
          var h = Math.max(1, Math.round(img.naturalHeight * scale))
          var c = document.createElement('canvas')
          c.width = w
          c.height = h
          c.getContext('2d').drawImage(img, 0, 0, w, h)
          resolve({
            // Safari cannot encode WebP from a canvas and returns a PNG (several
            // times the slide cap); ask what came back and use JPEG in that case.
            dataUrl: (function () {
              var u = c.toDataURL('image/webp', 0.85)
              return u.indexOf('data:image/webp') === 0 ? u : c.toDataURL('image/jpeg', 0.85)
            })(),
            width: img.naturalWidth,
            height: img.naturalHeight,
          })
        }
        img.src = reader.result
      }
      reader.readAsDataURL(file)
    })
  }

  /* --------------------------------------------------------------- render -- */

  function aspectBadge(w, h) {
    if (!w || !h) return el('span', 'hsl-badge hsl-badge-warn', 'no dimensions on file')
    var ratio = w / h
    var close = Math.abs(ratio - ARTWORK_RATIO) < 0.05
    var label = ratio.toFixed(2) + ':1'
    if (close) return el('span', 'hsl-badge hsl-badge-ok', label + ' — matches the artwork ratio the hero expects')
    return el('span', 'hsl-badge hsl-badge-warn', label + ' — off the hero’s 2.52:1; sides will crop differently than designed')
  }

  function slideRow(s) {
    var row = el('div', 'hsl-row' + (s.active ? '' : ' hsl-row-off'))

    var thumb = el('div', 'hsl-thumb')
    if (s.image) {
      var img = document.createElement('img')
      img.src = '/api/' + s.image
      img.alt = ''
      thumb.appendChild(img)
    } else {
      thumb.appendChild(el('span', 'hsl-noimg', 'no image'))
    }
    row.appendChild(thumb)

    var meta = el('div', 'hsl-meta')
    meta.appendChild(el('div', 'hsl-title', s.title_en || s.title_ar || '(untitled slide #' + s.id + ')'))
    var facts = el('div', 'hsl-facts')
    facts.appendChild(el('span', null, (s.width && s.height) ? (s.width + '×' + s.height) : 'dimensions unknown'))
    facts.appendChild(aspectBadge(s.width, s.height))
    facts.appendChild(el('span', null, 'focal_x ' + s.focal_x))
    facts.appendChild(el('span', null, 'sort ' + s.sort))
    meta.appendChild(facts)
    row.appendChild(meta)

    var actions = el('div', 'hsl-actions')
    var toggle = el('button', 'hsl-btn', s.active ? 'Deactivate' : 'Activate')
    toggle.type = 'button'
    toggle.addEventListener('click', function () { setActive(s, !s.active) })
    actions.appendChild(toggle)

    var edit = el('button', 'hsl-btn', 'Edit')
    edit.type = 'button'
    edit.addEventListener('click', function () {
      state.editing = state.editing === s.id ? null : s.id
      render()
    })
    actions.appendChild(edit)

    var del = el('button', 'hsl-btn hsl-btn-danger', 'Delete')
    del.type = 'button'
    del.addEventListener('click', function () { confirmDelete(s) })
    actions.appendChild(del)

    row.appendChild(actions)

    if (state.editing === s.id) row.appendChild(editForm(s))
    return row
  }

  function editForm(s) {
    var box = el('div', 'hsl-edit')

    var focalWrap = el('div', 'hsl-focal')
    focalWrap.appendChild(el('label', 'hsl-label', 'Focal point (horizontal) — the only crop control with a real effect'))
    var slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '100'
    slider.value = String(s.focal_x)
    slider.className = 'hsl-slider'
    focalWrap.appendChild(slider)
    var val = el('span', 'hsl-focal-val', s.focal_x + '%')
    focalWrap.appendChild(val)
    box.appendChild(focalWrap)

    box.appendChild(el('p', 'hsl-hint',
      'The photo always fills the hero’s full height, so only the left–right position ' +
      'matters. On a wide desktop the whole banner shows and this has little effect. On a ' +
      'PHONE about half of the banner’s width shows, so set the focal point on the ' +
      'athlete. The preview below shows exactly what each screen keeps.'))

    // Live, calibrated crop preview — desktop and phone side by side.
    var previewWrap = el('div', 'hsl-preview-wrap')
    var arts = {}   // 'desktop' | 'phone' -> the preview's art node, so a picked file can show before it is saved
    ;[{ w: 1280, h: 800, label: 'Desktop (1280×800)' }, { w: 390, h: 844, label: 'Phone (390×844)' }].forEach(function (vp) {
      var pct = visiblePct(vp.w, vp.h)
      var col = el('div', 'hsl-preview-col')
      col.appendChild(el('div', 'hsl-preview-label', vp.label + ' — shows ' + pct.toFixed(1) + '% of the banner’s width'))
      var frame = el('div', 'hsl-preview-frame')
      var art = el('div', 'hsl-preview-art')
      if (s.image) art.style.backgroundImage = 'url(/api/' + s.image + ')'
      arts[vp.w > 800 ? 'desktop' : 'phone'] = art
      frame.appendChild(art)
      var win = el('div', 'hsl-preview-window')
      win.style.width = pct.toFixed(2) + '%'
      frame.appendChild(win)
      col.appendChild(frame)
      previewWrap.appendChild(col)

      function positionWindow(fx) {
        var winPct = pct
        var left = (fx / 100) * (100 - winPct)
        win.style.left = left.toFixed(2) + '%'
        art.style.objectPosition = fx + '% center'
      }
      positionWindow(s.focal_x)
      slider.addEventListener('input', function () {
        val.textContent = slider.value + '%'
        positionWindow(parseInt(slider.value, 10))
      })
    })
    box.appendChild(previewWrap)

    // Upload / replace.
    var uploadWrap = el('div', 'hsl-upload')
    var guide = el('div', 'hsl-guide')
    guide.appendChild(el('strong', null, 'Size guide — check before you upload'))
    ;[
      'Desktop image: ' + BEST_W + '×' + BEST_H + ' px (' + ARTWORK_RATIO + ':1, the wide banner). Anything from ' + MIN_W + ' px wide up works; wider than ' + BEST_W + ' px is shrunk to ' + BEST_W + '.',
      'Phone image (optional): ' + BEST_MW + ' px wide, tall or square is fine — it is cropped to the phone banner, so keep the subject in the middle.',
      'Any JPG, PNG or WebP. File size does not matter; the shop shrinks it. Text burnt into the picture should stay inside the middle 60%.',
    ].forEach(function (t) { guide.appendChild(el('div', null, '• ' + t)) })
    uploadWrap.appendChild(guide)
    uploadWrap.appendChild(el('label', 'hsl-label', 'Replace desktop image'))
    var fileIn = document.createElement('input')
    fileIn.type = 'file'
    fileIn.accept = 'image/*'
    uploadWrap.appendChild(fileIn)
    var deskVerdict = el('div', 'hsl-verdict')
    uploadWrap.appendChild(deskVerdict)
    var mobileLabel = el('label', 'hsl-label', 'Replace mobile image (optional)')
    mobileLabel.style.marginTop = '10px'
    uploadWrap.appendChild(mobileLabel)
    var mobileIn = document.createElement('input')
    mobileIn.type = 'file'
    mobileIn.accept = 'image/*'
    uploadWrap.appendChild(mobileIn)
    var mobVerdict = el('div', 'hsl-verdict')
    uploadWrap.appendChild(mobVerdict)
    box.appendChild(uploadWrap)

    // What a picked file will be, BEFORE anything is uploaded: its real size,
    // whether it fits the banner, and the preview above redrawn with it.
    function inspect(file, kind, verdictBox) {
      verdictBox.textContent = ''
      if (!file) return
      // A data: URL, not a blob: object URL: the live Content-Security-Policy
      // allows img-src data: but NOT blob:, so an object URL would look fine on
      // the sandbox (no policy) and be refused on the real shop.
      var reader = new FileReader()
      var bad = function () { verdictBox.appendChild(el('span', 'hsl-badge hsl-badge-warn', 'This file cannot be read as a picture.')) }
      reader.onerror = bad
      reader.onload = function () {
        var url = reader.result
        var im = new Image()
        im.onerror = bad
        im.onload = function () {
          var v = judge(im.naturalWidth, im.naturalHeight, kind)
          verdictBox.appendChild(el('span', 'hsl-badge ' + (v.ok ? 'hsl-badge-ok' : 'hsl-badge-warn'), v.headline))
          v.lines.forEach(function (l) { verdictBox.appendChild(el('div', 'hsl-hint', l)) })
          var showIn = kind === 'phone' ? ['phone'] : (mobileIn.files[0] ? ['desktop'] : ['desktop', 'phone'])
          showIn.forEach(function (k) { if (arts[k]) arts[k].style.backgroundImage = 'url("' + url + '")' })
        }
        im.src = url
      }
      reader.readAsDataURL(file)
    }
    fileIn.addEventListener('change', function () { inspect(fileIn.files[0], 'desktop', deskVerdict) })
    mobileIn.addEventListener('change', function () { inspect(mobileIn.files[0], 'phone', mobVerdict) })

    var sortWrap = el('label', 'hsl-field')
    sortWrap.appendChild(el('span', 'hsl-label', 'Sort order'))
    var sortIn = document.createElement('input')
    sortIn.type = 'text'
    sortIn.inputMode = 'numeric'
    sortIn.pattern = '-?[0-9]*'
    sortIn.dir = 'ltr'
    sortIn.value = String(s.sort)
    sortIn.className = 'hsl-input'
    sortWrap.appendChild(sortIn)
    box.appendChild(sortWrap)

    var save = el('button', 'hsl-save', state.busy ? 'Saving…' : 'Save slide')
    save.type = 'button'
    save.disabled = !!state.busy
    save.addEventListener('click', function () {
      // A box that is not a whole number is REFUSED, not saved as 0. The
      // message goes into this box rather than through render(), which would
      // rebuild the form and throw away the chosen pictures with it.
      var sortRaw = west(sortIn.value).trim()
      if (!/^-?\d+$/.test(sortRaw)) {   // a minus kept: an existing negative sort must still save
        var n = box.querySelector('.hsl-note') || box.appendChild(el('p', 'hsl-note'))
        n.textContent = 'Sort order must be a whole number, such as 10.'
        sortIn.focus()
        return
      }
      saveSlide(s, {
        focal_x: parseInt(slider.value, 10),
        sort: parseInt(sortRaw, 10),
        file: fileIn.files[0] || null,
        mobileFile: mobileIn.files[0] || null,
      })
    })
    box.appendChild(save)

    if (state.note) box.appendChild(el('p', 'hsl-note', state.note))
    return box
  }

  function render() {
    if (!card) return
    card.textContent = ''
    card.appendChild(el('h3', 'hsl-h', 'Hero slides'))
    card.appendChild(el('p', 'hsl-sub',
      'The home page banner.'))

    if (!state.slides) {
      card.appendChild(el('p', 'hsl-note', 'Loading…'))
      return
    }
    if (!state.slides.length) {
      card.appendChild(el('p', 'hsl-note', 'No slides yet.'))
    }
    state.slides.forEach(function (s) { card.appendChild(slideRow(s)) })

    var addBtn = el('button', 'hsl-btn hsl-add', 'Add a new slide')
    addBtn.type = 'button'
    addBtn.addEventListener('click', addSlide)
    card.appendChild(addBtn)
  }

  /* ---------------------------------------------------------------- saves -- */

  function setActive(s, active) {
    state.busy = true
    ask('slide_save', { id: s.id, active: active, focal_x: s.focal_x, sort: s.sort }).then(function () {
      state.busy = false
      load()
    })
  }

  function confirmDelete(s) {
    if (!window.confirm('Delete this slide permanently? Deactivating instead keeps the image and can be undone.')) return
    state.busy = true
    ask('slide_delete', { id: s.id }).then(function () {
      state.busy = false
      load()
    })
  }

  function addSlide() {
    state.editing = null
    // A blank row with no image yet — slide_save refuses to CREATE without
    // one (image_required), so this only opens an edit form once a real
    // image is picked; there is nothing to save until then.
    var s = { id: 0, active: false, sort: (state.slides || []).length, focal_x: 50, image: null, width: null, height: null, title_en: 'New slide' }
    state.slides = (state.slides || []).concat([s])
    state.editing = 0
    render()
  }

  function saveSlide(s, edits) {
    state.busy = true
    state.note = ''
    render()

    function withImages(image, imgW, imgH, imageMobile) {
      var body = {
        id: s.id || 0,
        active: s.active,
        focal_x: edits.focal_x,
        sort: edits.sort,
        title_en: s.title_en, title_ar: s.title_ar,
        subtitle_en: s.subtitle_en, subtitle_ar: s.subtitle_ar,
        cta_label_en: s.cta_label_en, cta_label_ar: s.cta_label_ar,
        cta_href: s.cta_href,
      }
      if (image) { body.image = image; body.width = imgW; body.height = imgH }
      if (imageMobile) { body.image_mobile = imageMobile }
      ask('slide_save', body).then(function (res) {
        state.busy = false
        if (res && res.error) {
          state.note = String(res.error)
          render()
        } else {
          state.editing = null
          load()
        }
      }).catch(function () {
        state.busy = false
        state.note = 'The save did not reach the shop. Check the connection and try again.'
        render()
      })
    }

    var p1 = edits.file ? downscale(edits.file, 1600) : Promise.resolve(null)
    var p2 = edits.mobileFile ? downscale(edits.mobileFile, 1200) : Promise.resolve(null)
    Promise.all([p1, p2]).then(function (results) {
      var d = results[0], m = results[1]
      withImages(d ? d.dataUrl : null, d ? d.width : null, d ? d.height : null, m ? m.dataUrl : null)
    }).catch(function () {
      state.busy = false
      state.note = 'That file could not be read as an image.'
      render()
    })
  }

  function load() {
    ask('slides').then(function (res) {
      if (!res || res.error) {
        state.note = String(res && res.error)
        render()
        return
      }
      state.slides = res.slides
      render()
    })
  }

  /* ---------------------------------------------------------------- chrome - */

  var CSS = ''
    + '.hsl{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;'
    + 'background:var(--card,rgba(255,255,255,.03))}'
    + '.hsl-h{margin:0 0 4px;font-size:16px}'
    + '.hsl-sub{margin:0 0 14px;opacity:.7;font-size:13px}'
    + '.hsl-row{display:flex;flex-wrap:wrap;gap:12px;padding:12px 0;border-top:1px solid var(--border,#2a2d31)}'
    + '.hsl-row-off{opacity:.55}'
    + '.hsl-thumb{width:120px;height:48px;flex:none;border-radius:6px;overflow:hidden;background:#111;display:flex;align-items:center;justify-content:center}'
    + '.hsl-thumb img{width:100%;height:100%;object-fit:cover}'
    + '.hsl-noimg{font-size:11px;opacity:.6}'
    + '.hsl-meta{flex:1;min-width:180px}'
    + '.hsl-title{font-weight:600;font-size:14px}'
    + '.hsl-facts{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;font-size:12px;opacity:.8}'
    + '.hsl-badge{border-radius:999px;padding:2px 8px;font-size:11px}'
    + '.hsl-badge-ok{background:rgba(60,180,90,.18)}'
    + '.hsl-badge-warn{background:rgba(220,140,40,.2)}'
    + '.hsl-actions{display:flex;gap:8px;align-items:flex-start}'
    + '.hsl-btn{padding:6px 12px;border-radius:8px;cursor:pointer;font:inherit;font-size:13px;'
    + 'border:1px solid var(--border,#2a2d31);background:transparent;color:inherit}'
    + '.hsl-btn-danger{border-color:#c0392b;color:#c0392b}'
    + '.hsl-add{margin-top:14px}'
    + '.hsl-edit{width:100%;margin-top:10px;padding:14px;border-radius:10px;background:rgba(255,255,255,.03)}'
    + '.hsl-label{font-size:13px;font-weight:600;display:block;margin-bottom:6px}'
    + '.hsl-focal{margin-bottom:10px}'
    + '.hsl-slider{width:100%;max-width:400px}'
    + '.hsl-focal-val{font-size:12px;opacity:.8;margin-left:8px}'
    + '.hsl-hint{font-size:12px;opacity:.7;line-height:1.5;max-width:640px}'
    + '.hsl-preview-wrap{display:flex;flex-wrap:wrap;gap:20px;margin:12px 0}'
    + '.hsl-preview-col{flex:none}'
    + '.hsl-preview-label{font-size:11px;opacity:.75;margin-bottom:4px}'
    + '.hsl-preview-frame{position:relative;width:220px;height:87px;background:#111;overflow:hidden;border-radius:6px}'
    + '.hsl-preview-art{position:absolute;inset:0;background-size:cover;background-position:center}'
    + '.hsl-preview-window{position:absolute;top:0;bottom:0;border:2px solid var(--brand,#e0561c);box-sizing:border-box;pointer-events:none}'
    + '.hsl-upload{margin:12px 0}'
    + '.hsl-guide{border:1px dashed var(--border,#2a2d31);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12px;line-height:1.55;max-width:640px}'
    + '.hsl-guide strong{display:block;font-size:13px;margin-bottom:4px}'
    + '.hsl-verdict{margin:6px 0 0}'
    + '.hsl-field{display:flex;flex-direction:column;gap:4px;max-width:160px;margin-bottom:12px}'
    + '.hsl-input{padding:8px 10px;border-radius:8px;border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font:inherit}'
    + '.hsl-save{padding:9px 16px;border-radius:8px;border:0;cursor:pointer;background:var(--brand,#e0561c);color:#fff;font:inherit;font-weight:600}'
    + '.hsl-save[disabled]{opacity:.5;cursor:default}'
    + '.hsl-note{margin:10px 0 0;font-size:13px;line-height:1.5}'

  function style() {
    if (document.getElementById('hsl-css')) return
    var s = document.createElement('style')
    s.id = 'hsl-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  function settingsHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Settings') return hs[i]
    }
    return null
  }

  var busy = false
  function place() {
    if (busy) return
    var head = settingsHeading()

    if (!head) {
      if (card && card.parentNode) {
        busy = true
        card.parentNode.removeChild(card)
        card = null
        busy = false
      }
      return
    }
    if (card && card.parentNode) return

    busy = true
    style()
    card = el('div', 'hsl')
    var anchor = head.parentNode
    anchor.parentNode.insertBefore(card, anchor.nextSibling)
    busy = false

    state.slides = null
    state.note = ''
    state.busy = false
    state.editing = null
    render()
    load()
  }

  var timer = null
  var observer = new MutationObserver(function () {
    clearTimeout(timer)
    timer = setTimeout(place, 120)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  place()
})()
