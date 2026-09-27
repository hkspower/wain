/**
 * Brand logos, picked from a folder — added to the WEBSITE's /backends panel.
 *
 * "make brands images selecter so just select the images from file manager
 * then assign their brand at backend", 2026-09-27. brand-logos.js already
 * covers the owner picking files off their OWN computer and matching them by
 * filename; this is the other half — pictures already sitting on the SERVER,
 * dropped into images/_uploads/ through Hostinger's File Manager in no
 * particular naming order, with no matching to guess at. Click a thumbnail,
 * click a brand, done.
 *
 * SAME OVERLAY PATTERN AS brand-logos.js, contact.js, footer.js: appears on
 * the Brands screen only, touches nothing that exists, talks to admin.php
 * with the session already there. Loaded after admin-upload.js, whose
 * `window.sportaUpload.call` this reuses; absent means do nothing rather than
 * throw, so a half-published set of assets still leaves the panel usable.
 *
 * THUMBNAILS ARE DATA: URIS THE SERVER ALREADY SENT, never a second request.
 * A candidate cannot be pointed at with a plain `<img src="admin.php?r=...">`
 * — every admin.php route needs the X-Sporta-Admin header and the session
 * cookie, and an <img> tag can send neither. ?r=brand_image_candidates
 * answers that by embedding each picture's own thumbnail in the JSON.
 *
 * ASSIGNING NEVER RESENDS name_en/name_ar/slug/sort. brand_save's own comment
 * warns that route blanks a brand's name if a caller sends only the logo;
 * this overlay calls brand_image_assign instead, which touches the logo
 * column alone and cannot make that mistake.
 */
(function () {
  'use strict'

  var U = window.sportaUpload
  if (!U) return
  var call = U.call

  var MARK = 'data-sporta-panel'
  var card = null
  var pickBox = null
  var note = null
  var state = { candidates: [], brands: [], picked: null, busy: false, note: '', noteGood: false }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined) n.textContent = text
    return n
  }

  // WRITES INTO STATE, NOT ONLY THE LIVE DOM NODE. render() rebuilds the
  // whole card from scratch on every call — including a fresh `note`
  // paragraph — so a message left only on the OLD node is gone the instant
  // anything re-renders. That is exactly what load() does one line after
  // assign()'s own success message: it sets `busy` and calls render() to show
  // a spinner, which would otherwise wipe "now uses that picture" before
  // anyone read it. state.note is what render() rebuilds the note FROM.
  function say(text, good) {
    state.note = text || ''
    state.noteGood = !!good
    if (note) {
      note.textContent = state.note
      note.className = 'sbi-note' + (state.note ? (good ? ' sbi-ok' : ' sbi-bad') : '')
    }
  }

  function load() {
    state.busy = true
    render()
    return Promise.all([call('brand_image_candidates'), call('brands')])
      .then(function (res) {
        state.candidates = Array.isArray(res[0]) ? res[0] : []
        state.brands = Array.isArray(res[1]) ? res[1] : (res[1] && res[1].brands) || []
        state.busy = false
        if (state.picked && !state.candidates.some(function (c) { return c.name === state.picked })) {
          state.picked = null
        }
        render()
      })
      .catch(function (e) {
        state.busy = false
        say('Could not read the folder: ' + (e && e.message ? e.message : String(e)), false)
        render()
      })
  }

  function assign(brandId) {
    if (state.busy || !state.picked) return
    var name = state.picked
    var brand = state.brands.filter(function (b) { return String(b.id) === String(brandId) })[0]
    state.busy = true
    say('Assigning…', true)
    render()
    call('brand_image_assign', 'POST', { name: name, brand_id: brandId })
      .then(function () {
        say((brand ? brand.name_en : 'The brand') + ' now uses that picture.', true)
        state.picked = null
        return load()
      })
      .catch(function (e) {
        state.busy = false
        say('Could not assign it: ' + (e && e.message ? e.message : String(e)), false)
        render()
      })
  }

  function render() {
    if (!card) return
    card.innerHTML = ''

    var h = el('div', 'sbi-head')
    h.appendChild(el('strong', null, 'Assign uploaded pictures'))
    h.appendChild(el('span', 'sbi-dim', state.busy
      ? 'working…'
      : (state.candidates.length
          ? state.candidates.length + ' picture(s) waiting in images/_uploads/'
          : 'no pictures waiting')))
    card.appendChild(h)

    card.appendChild(el('p', 'sbi-dim',
      'Drop any pictures into images/_uploads/ through Hostinger’s File Manager '
      + '— no renaming needed. Click one below, then click the brand it belongs to.'))

    var grid = el('div', 'sbi-grid')
    state.candidates.forEach(function (c) {
      var cell = el('button', 'sbi-cell' + (state.picked === c.name ? ' is-picked' : ''))
      cell.type = 'button'
      cell.title = c.name
      cell.disabled = state.busy
      var img = document.createElement('img')
      img.src = c.dataUri
      img.alt = c.name
      cell.appendChild(img)
      cell.addEventListener('click', function () {
        state.picked = state.picked === c.name ? null : c.name
        render()
      })
      grid.appendChild(cell)
    })
    if (!state.candidates.length && !state.busy) {
      grid.appendChild(el('p', 'sbi-dim', 'Nothing to show yet.'))
    }
    card.appendChild(grid)

    if (state.picked) {
      var picks = el('div', 'sbi-brands')
      picks.appendChild(el('p', 'sbi-dim', 'Assign "' + state.picked + '" to:'))
      var list = el('div', 'sbi-brandlist')
      state.brands.forEach(function (b) {
        var btn = el('button', 'sbi-chip', b.name_en + (b.logo ? ' (replaces current logo)' : ''))
        btn.type = 'button'
        btn.disabled = state.busy
        btn.addEventListener('click', function () { assign(b.id) })
        list.appendChild(btn)
      })
      picks.appendChild(list)
      card.appendChild(picks)
    }

    note = el('p', 'sbi-note' + (state.note ? (state.noteGood ? ' sbi-ok' : ' sbi-bad') : ''), state.note)
    note.setAttribute('role', 'status')
    card.appendChild(note)
  }

  var CSS = ''
    + '.sbi{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;background:var(--sp-pc-bg,#2d3034);color:var(--sp-pc-ink,#eaecee)}'
    + '.sbi-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:6px}'
    + '.sbi-dim{color:var(--sp-pc-muted,#a6adb5);font-size:13px}'
    + '.sbi-grid{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}'
    + '.sbi-cell{width:72px;height:72px;padding:0;border-radius:8px;border:2px solid transparent;background:#171a1e;cursor:pointer;overflow:hidden}'
    + '.sbi-cell img{width:100%;height:100%;object-fit:contain;display:block}'
    + '.sbi-cell.is-picked{border-color:#4f46e5}'
    + '.sbi-cell[disabled]{opacity:.5;cursor:default}'
    + '.sbi-brands{margin-top:8px;padding-top:12px;border-top:1px solid var(--sp-pc-border,#494e54)}'
    + '.sbi-brandlist{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}'
    + '.sbi-chip{padding:8px 12px;border-radius:8px;border:1px solid var(--sp-pc-border,#494e54);background:transparent;color:var(--sp-pc-ink,#eaecee);font:inherit;font-size:13px;cursor:pointer;min-height:36px}'
    + '.sbi-chip[disabled]{opacity:.5;cursor:default}'
    + '.sbi-note{margin:12px 0 0;font-size:13px;line-height:1.5}'
    + '.sbi-note.sbi-ok{color:#15803d;font-weight:600}'
    + '.sbi-note.sbi-bad{color:#b91c1c;font-weight:600}'

  function style() {
    if (document.getElementById('sbi-css')) return
    var s = document.createElement('style')
    s.id = 'sbi-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  function brandsHeading() {
    var hs = document.querySelectorAll('h1, h2')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Brands') return hs[i]
    }
    return null
  }

  var busy = false
  function place() {
    if (busy) return
    var head = brandsHeading()
    if (!head) {
      if (card && card.parentNode) {
        busy = true
        card.parentNode.removeChild(card)
        card = null
        note = null
        busy = false
      }
      return
    }
    if (card && card.parentNode) return

    busy = true
    style()
    card = el('div', 'sbi')
    card.setAttribute(MARK, 'brand-image-picker')
    // AFTER brand-logos.js's own card when it is there, so the two "add a
    // picture without typing" cards sit together, before the ordinary
    // one-brand-at-a-time list.
    var many = document.querySelector('.sbl')
    var anchor = many || head.parentNode
    anchor.parentNode.insertBefore(card, anchor.nextSibling)
    busy = false

    state.picked = null
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
