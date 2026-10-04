/**
 * "Pictures" — the shop logo and the features band, replaced from the panel (2026-10-04, "make all
 * website full dynamic"). A card on the Home slides screen, under the category pictures.
 *
 * Three pictures, each with Choose and "Use the shipped picture":
 *   Logo (dark)        /logo.png + /logo.webp — the mark on light grounds (share cards, invoices)
 *   Logo (white)       /logo-white.png + /logo-white.webp — the header's mark on the dark bar
 *   Features band      /assets/features.webp — the orange band behind the Sporta features rows
 *
 * The picture is read as a data: URL (the live CSP has no blob:), drawn to a canvas and encoded in
 * every format the server serves for that name (PNG keeps transparency; webp from the same canvas),
 * and sent in one request; admin.php measures each again. A row wins over the shipped file
 * (store_site_image_serve) and "Use the shipped picture" deletes the row. Served no-cache + ETag, so
 * a new picture shows on the next load.
 */
(function () {
  'use strict'
  if (!/^\/backends(\/|$)/.test(location.pathname)) return

  var ADMIN = '/api/admin.php?r=', MARK = 'data-sporta-site-images'
  var card = null, state = null
  var NAMES = [
    ['logo', 'Logo (dark, on light grounds)', 'Used on share cards and invoices. PNG with transparency is best.', '/logo.png', '#fff'],
    ['logo-white', 'Logo (white, the header)', 'The mark on the dark header bar. White or light, transparent background.', '/logo-white.webp', '#2d3034'],
    ['features', 'Features band picture', 'Behind the Sporta features rows. Wide and orange reads best; about 1600 × 600.', '/assets/features.webp', '#e0561c'],
  ]
  var WHY = { site_image_bad_format: 'Choose a PNG or WebP picture.', site_image_not_an_image: 'That file is not a picture.', site_image_too_large: 'That picture is too large (600 kB max after encoding). Try a smaller one.',
    site_image_too_big: 'That picture has too many pixels for this spot.', site_image_not_ready: 'The shop is not set up for this yet (run the migration).', not_signed_in: 'Your session has ended. Sign in again.', network: 'The save did not reach the shop.' }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function call(route, body) {
    return fetch(ADMIN + route, { method: body ? 'POST' : 'GET', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, credentials: 'include', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return null }) }).catch(function () { return { error: 'network' } })
  }
  var CSS = ''
    + '.simg{border:1px solid var(--sp-pc-border,#494e54);border-radius:1rem;padding:1.25rem;margin:1rem 0;background:var(--sp-pc-bg,transparent)}'
    + '.simg h2{margin:0 0 4px;font-size:16px;font-weight:700}.simg-sub{margin:0 0 10px;font-size:13px;opacity:.8;line-height:1.5}'
    + '.simg-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:10px 0;border-top:1px solid rgba(128,128,128,.2)}'
    + '.simg-pv{width:160px;height:72px;object-fit:contain;border-radius:8px;border:1px solid var(--sp-pc-border,#494e54);padding:6px;box-sizing:border-box}'
    + '.simg-body{flex:1 1 220px;min-width:0}.simg-l{font-size:14px;font-weight:600}.simg-c{font-size:12px;opacity:.75;line-height:1.5}.simg-tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(79,70,229,.2);margin-inline-start:6px}'
    + '.simg-btn{min-height:44px;padding:8px 14px;border-radius:8px;border:0;cursor:pointer;background:#4f46e5;color:#fff;font:inherit;font-weight:700}'
    + '.simg-btn2{min-height:44px;padding:8px 12px;border-radius:8px;cursor:pointer;font:inherit;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee)}'
    + '.simg-note{margin:4px 0 0;font-size:13px;flex:1 1 100%}'
  function style() { if (document.getElementById('simg-css')) return; var s = el('style'); s.id = 'simg-css'; s.textContent = CSS; document.head.appendChild(s) }

  function encode(file, fmts, cb, fail) {
    var rd = new FileReader()
    rd.onload = function () {
      var img = new Image()
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
        c.getContext('2d').drawImage(img, 0, 0)
        var out = {}
        for (var i = 0; i < fmts.length; i++) {
          var u = c.toDataURL(fmts[i] === 'png' ? 'image/png' : 'image/webp', 0.9)
          if (u.indexOf('data:image/' + fmts[i]) !== 0) { fail('site_image_bad_format'); return }
          out[fmts[i]] = u
        }
        cb(out)
      }
      img.onerror = function () { fail('site_image_not_an_image') }
      img.src = rd.result
    }
    rd.onerror = function () { fail('site_image_not_an_image') }
    rd.readAsDataURL(file)
  }

  function render() {
    card.textContent = ''
    card.appendChild(el('h2', null, 'Pictures'))
    card.appendChild(el('p', 'simg-sub', state && state.ready === false ? 'The shop is not set up for this yet (the site_images table is missing); the shipped pictures are showing.' : 'The shop logo and the features band. A replaced picture shows on the next load; "Use the shipped picture" puts the original back.'))
    NAMES.forEach(function (n) {
      var name = n[0], info = state && state.images && state.images[name]
      var replaced = info && info.replaced && Object.keys(info.replaced).length > 0
      var row = el('div', 'simg-row'); row.setAttribute('data-simg', name)
      var pv = el('img', 'simg-pv'); pv.alt = n[1]; pv.src = n[3] + '?v=' + Date.now(); pv.style.background = n[4]; row.appendChild(pv)
      var body = el('div', 'simg-body'); var l = el('div', 'simg-l', n[1]); if (replaced) l.appendChild(el('span', 'simg-tag', 'replaced')); body.appendChild(l); body.appendChild(el('div', 'simg-c', n[2])); row.appendChild(body)
      var file = el('input'); file.type = 'file'; file.accept = 'image/png,image/webp,image/jpeg'; file.style.display = 'none'; row.appendChild(file)
      var note = el('p', 'simg-note')
      var say = function (t, good) { note.textContent = t || ''; note.style.color = t ? (good ? '#16a34a' : '#dc2626') : '' }
      var choose = el('button', 'simg-btn', 'Choose picture'); choose.type = 'button'; choose.disabled = !!(state && state.ready === false)
      choose.addEventListener('click', function () { file.click() }); row.appendChild(choose)
      var reset = el('button', 'simg-btn2', 'Use the shipped picture'); reset.type = 'button'; reset.disabled = !replaced
      reset.addEventListener('click', function () { reset.disabled = true; call('site_image_reset', { name: name }).then(function (r) { if (!r || r.error) { say(WHY[r && r.error] || (r && r.error) || 'Failed.', false); reset.disabled = false; return } load(function () { say('The shipped picture is back.', true) }) }) })
      row.appendChild(reset)
      file.addEventListener('change', function () {
        var f = file.files && file.files[0]; if (!f) return
        say('Preparing…', true); choose.disabled = true
        encode(f, (info && info.fmts) || ['png', 'webp'], function (images) {
          call('site_image_save', { name: name, images: images }).then(function (r) {
            choose.disabled = false
            if (!r || r.error) { say(WHY[r && r.error] || (r && r.error) || 'Failed.', false); return }
            load(function () { say('Saved.', true) })
          })
        }, function (err) { choose.disabled = false; say(WHY[err] || err, false) })
      })
      row.appendChild(note); card.appendChild(row)
    })
  }
  function load(after) { call('site_images').then(function (r) { state = r && !r.error ? r : { ready: false, images: {} }; render(); if (after) after() }) }

  function slidesHeading() { var hs = document.querySelectorAll('.admin-content h1'); for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim() === 'Home slides') return hs[i]; return null }
  function screenOf(head) { var host = document.querySelector('.admin-content'); var n = head; while (n && n.parentNode !== host) n = n.parentNode; return n }
  var mounting = false
  function place() {
    if (mounting) return
    var head = slidesHeading()
    if (!head) { if (card && card.parentNode) { mounting = true; card.parentNode.removeChild(card); card = null; mounting = false } return }
    var screen = screenOf(head); if (!screen) return
    if (card && card.parentNode === screen) return
    mounting = true; style()
    card = el('section', 'simg'); card.setAttribute(MARK, '1')
    screen.appendChild(card)   // last: under the category pictures
    mounting = false
    render(); load()
  }
  var timer = null
  new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(place, 150) }).observe(document.body, { childList: true, subtree: true })
  place()
})()
