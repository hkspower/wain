/**
 * Scan a label to find a size — on the panel's Inventory screen (2026-10-04, "improve inventory" →
 * barcode & labels). A "Scan" button in the Inventory tools card.
 *
 * The barcode IS the SKU (api/labels.php prints Code 128 of it). With the browser's BarcodeDetector
 * (Chrome on Android and desktop, Safari 17+) the phone camera reads it live; where it is missing the
 * same box takes the code typed or pasted (a USB scanner types its code and presses Enter — that works
 * too). A code that matches a size selects its product in the tools grid and focuses that size's box,
 * where −/+ or a typed number and Enter save it. Nothing is written by the scan itself.
 *
 * The camera stream is stopped the moment a code is read, the sheet is closed, or the screen changes.
 */
(function () {
  'use strict'
  if (!/^\/backends(\/|$)/.test(location.pathname)) return

  var MARK = 'data-sporta-scan'
  var sheet = null, stream = null, raf = 0
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }

  function stop() {
    if (raf) cancelAnimationFrame(raf); raf = 0
    if (stream) { stream.getTracks().forEach(function (t) { t.stop() }); stream = null }
  }
  function close() { stop(); if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet); sheet = null }

  function found(code, note) {
    code = String(code || '').trim()
    if (!code) return
    var inv = window.sportaInventory
    var rec = inv && inv.bySku(code)
    if (!rec) { note.textContent = 'No size has the code ' + code + '.'; note.className = 'spsc-note spsc-bad'; return }
    close()
    inv.select(rec.slug, rec.sku)
  }
  function open() {
    if (sheet) return
    sheet = el('div', 'spsc'); sheet.setAttribute(MARK, '1'); sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Scan a label')
    var box = el('div', 'spsc-box')
    box.appendChild(el('h3', 'spsc-h', 'Scan a label'))
    var note = el('p', 'spsc-note', '')
    var video = el('video', 'spsc-video'); video.setAttribute('playsinline', ''); video.muted = true
    var row = el('div', 'spsc-row')
    var inp = el('input', 'spsc-in'); inp.type = 'text'; inp.placeholder = 'or type / paste the item code'; inp.setAttribute('aria-label', 'Item code'); inp.autocomplete = 'off'
    var go = el('button', 'spsc-btn', 'Find'); go.type = 'button'; go.addEventListener('click', function () { found(inp.value, note) })
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); found(inp.value, note) } })
    var cl = el('button', 'spsc-btn', 'Close'); cl.type = 'button'; cl.addEventListener('click', close)
    row.appendChild(inp); row.appendChild(go); row.appendChild(cl)
    box.appendChild(video); box.appendChild(row); box.appendChild(note); sheet.appendChild(box)
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close() })
    document.body.appendChild(sheet)
    inp.focus()
    var Det = window.BarcodeDetector
    if (!Det || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      video.remove(); note.textContent = 'This browser has no camera barcode reader. Type the code, or use a USB scanner.'; return
    }
    var det
    try { det = new Det({ formats: ['code_128', 'ean_13', 'qr_code'] }) } catch (e) { video.remove(); note.textContent = 'This browser has no camera barcode reader. Type the code.'; return }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (s) {
      stream = s; video.srcObject = s; video.play().catch(function () {})
      note.textContent = 'Point the camera at the label.'
      var tick = function () {
        if (!stream) return
        det.detect(video).then(function (codes) {
          if (codes && codes.length) { found(codes[0].rawValue, note); return }
          raf = requestAnimationFrame(tick)
        }).catch(function () { raf = requestAnimationFrame(tick) })
      }
      raf = requestAnimationFrame(tick)
    }).catch(function () { video.remove(); note.textContent = 'Camera not available. Type the code.' })
  }

  var CSS = ''
    + '.spsc{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:60;display:flex;align-items:center;justify-content:center;padding:16px}'
    + '.spsc-box{background:var(--sp-pc-bg,#1b1e22);color:var(--sp-pc-ink,#eaecee);border:1px solid var(--sp-pc-border,#494e54);border-radius:14px;padding:16px;width:min(100%,460px)}'
    + '.spsc-h{margin:0 0 10px;font-size:16px}.spsc-video{width:100%;max-height:50vh;border-radius:10px;background:#000;display:block}'
    + '.spsc-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.spsc-in{flex:1 1 180px;min-height:44px;padding:8px 10px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:inherit;font:inherit}'
    + '.spsc-btn{min-height:44px;padding:8px 14px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:inherit;font:inherit;cursor:pointer}'
    + '.spsc-note{margin:10px 0 0;font-size:13px;opacity:.85}.spsc-bad{color:#ff9a90;opacity:1}'
    + '.spsc-open{margin-inline-start:6px}'
  function style() { if (document.getElementById('spsc-css')) return; var s = el('style'); s.id = 'spsc-css'; s.textContent = CSS; document.head.appendChild(s) }

  // The button lives in the Inventory tools card's first row (the chips), re-added whenever that card re-renders.
  function place() {
    var tools = document.querySelector('[data-sporta-inventory]')
    if (!tools) { if (sheet) close(); return }
    if (tools.querySelector('[data-spsc-open]')) return
    var row = tools.querySelector('.spinv-row')
    if (!row) return
    style()
    var b = el('button', 'spinv-btn spsc-open', 'Scan a label'); b.type = 'button'; b.setAttribute('data-spsc-open', '1')
    b.addEventListener('click', open)
    row.appendChild(b)
  }
  var timer = null
  new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(place, 150) }).observe(document.body, { childList: true, subtree: true })
  place()
})()
