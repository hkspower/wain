/**
 * Brand logos, many at once — added to the WEBSITE's /backends panel.
 *
 * WHAT THIS IS. The app has a screen for this (src/app/backends/brand-logos.tsx)
 * and the website has its own admin panel, built from a bundle with no source
 * in this repository. They are two different programs against one server, so a
 * screen in one is not a screen in the other. This is the same job done the
 * only way the website allows: DOM surgery over the panel that is there,
 * exactly as contact.js, footer.js and theme.js do over the storefront.
 *
 * IT ADDS, IT DOES NOT REPLACE. The panel's own Brands screen keeps working —
 * names, slugs, sort, the shown/hidden switch, and its one-at-a-time logo
 * upload. This appends one card above the list for the job that screen is bad
 * at: eight brands with no logo and a folder of pictures.
 *
 * ---------------------------------------------------------------------------
 * THE SAME RULES AS THE APP SCREEN, because they are the same job:
 *
 *   ONE LOGO PER BRAND, so the queue is a slot per brand rather than a list of
 *   files — otherwise two files queue for one brand and the server's last
 *   write silently drops one.
 *
 *   MATCHED BY FILENAME FIRST. A folder of logos is nearly always named after
 *   the brands. The name is folded to the shape a slug has and matched against
 *   the slug, the English name, the Arabic name, then a longest-first
 *   substring pass so `under-armour` beats a brand called `armour`.
 *
 *   ANYTHING UNMATCHED fills the next TICKED brand with no picture yet. That
 *   is what the tick boxes are for: "tick the brands, then drop the files"
 *   works for logos named 1.png and needs no typing.
 *
 *   ANYTHING STILL UNPLACED IS NAMED ON SCREEN. A file that quietly went
 *   nowhere is the failure this exists to avoid.
 *
 * NOTHING IS SENT UNTIL Upload IS PRESSED. A wrong logo shows on every product
 * card that brand sells, so every assignment is reversible until then.
 *
 * ---------------------------------------------------------------------------
 * THE REQUEST SHAPE IS THE PANEL'S OWN, read out of the bundle rather than
 * guessed: `/api/admin.php?r=<route>`, `X-Sporta-Admin: 1`,
 * `credentials: include`. The header is not optional — store_require_admin_header()
 * answers 400 without it — and the session cookie is `__Host-` + SameSite=Strict,
 * which works here only because this runs on the shop's own origin inside the
 * panel. That is also why this file can exist at all: it needs no credential of
 * its own and stores none.
 *
 * brand_save IS ONE ROUTE FOR CREATE AND RENAME, so every save must carry
 * name_en, name_ar, slug and sort as well as the logo. Sending only the logo
 * would blank the name — and the screen that did it would look like it had
 * merely uploaded a picture. Those four values come from ?r=brands, read back
 * a moment earlier; nothing here types a brand's name.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var MAX_BASE64 = 900000      // store.php, STORE_PRODUCT_IMAGE_MAX
  var LONGEST = 1400
  var QUALITIES = [0.82, 0.72, 0.62, 0.5, 0.4]

  function call(route, method, body) {
    return fetch(API + route, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (d) {
        if (!r.ok || (d && d.error)) throw new Error((d && d.error) || ('http ' + r.status))
        return d
      })
    })
  }

  /** Fold a filename or a name to the shape a slug has. Extension and the
   *  trailing words an export tool adds are dropped; they are not part of
   *  anyone's brand. */
  function fold(s) {
    return String(s || '')
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9؀-ۿ]+/g, '-')
      .replace(/-(logo|icon|mark|brand|final|copy|[0-9]{1,3})$/g, '')
      .replace(/^-+|-+$/g, '')
  }

  /** Re-encode to WebP under the server's cap. The same ladder the app uses:
   *  drop quality before dropping pixels, because a logo that has been scaled
   *  down cannot be scaled back up and a logo at 0.4 quality still reads. */
  function shrink(file) {
    return createImageBitmap(file).then(
      function (bm) {
        var scale = Math.min(1, LONGEST / Math.max(bm.width, bm.height))
        var w = Math.max(1, Math.round(bm.width * scale))
        var h = Math.max(1, Math.round(bm.height * scale))
        var c = document.createElement('canvas')
        c.width = w
        c.height = h
        // No fill: a logo is usually transparent, and painting white behind it
        // puts a white rectangle on every dark product card.
        c.getContext('2d').drawImage(bm, 0, 0, w, h)

        var i = 0
        function attempt() {
          var uri = c.toDataURL('image/webp', QUALITIES[i])
          if (uri.length <= MAX_BASE64 || i >= QUALITIES.length - 1) {
            if (uri.length > MAX_BASE64) {
              throw new Error('still ' + Math.round(uri.length / 1024) + ' kB at the lowest quality')
            }
            return uri
          }
          i++
          return attempt()
        }
        return attempt()
      },
      function () {
        var heic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)
        throw new Error(heic
          ? 'this browser cannot open HEIC photographs — on the iPhone, Settings, Camera, Formats, Most Compatible saves them as JPEG'
          : 'not a picture this browser can open')
      }
    )
  }

  // ---------------------------------------------------------------- the card
  var state = { brands: [], queue: {}, ticked: {}, orphans: [], busy: false, note: '' }
  var card = null

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined) n.textContent = text
    return n
  }

  function openSlots() {
    return state.brands.filter(function (b) { return state.ticked[b.id] && !state.queue[b.id] })
  }

  function enqueue(files) {
    if (!files || !files.length) return
    var replaced = 0
    for (var i = 0; i < files.length; i++) {
      var file = files[i]
      var key = fold(file.name)
      var hit = null
      var byLength = state.brands.slice().sort(function (a, b) {
        return fold(b.slug).length - fold(a.slug).length
      })
      for (var j = 0; j < state.brands.length && !hit; j++) {
        var b = state.brands[j]
        if (fold(b.slug) === key || fold(b.name_en) === key || fold(b.name_ar) === key) hit = b
      }
      for (var k = 0; k < byLength.length && !hit; k++) {
        var s = fold(byLength[k].slug)
        if (s.length >= 3 && key.indexOf(s) !== -1) hit = byLength[k]
      }
      if (hit) {
        if (state.queue[hit.id]) replaced++
        state.queue[hit.id] = { file: file, name: file.name, how: 'matched by name' }
        continue
      }
      var slot = openSlots()[0]
      if (slot) state.queue[slot.id] = { file: file, name: file.name, how: 'filled in order' }
      else state.orphans.push(file.name)
    }
    state.note = replaced
      ? replaced + ' brand(s) already had a picture waiting — the newer file replaced it.'
      : ''
    render()
  }

  function upload() {
    if (state.busy) return
    var ids = Object.keys(state.queue)
    if (!ids.length) return
    state.busy = true
    state.note = 'Uploading 0/' + ids.length + '…'
    render()

    var ok = 0
    var failed = []
    // ONE AT A TIME. Each save encodes an image and posts up to 900 kB; eight
    // at once is eight encodes competing for one main thread and eight writes
    // to one table. The count moving is also the only sign of progress.
    var chain = Promise.resolve()
    ids.forEach(function (id) {
      chain = chain.then(function () {
        var brand = state.brands.filter(function (b) { return String(b.id) === String(id) })[0]
        if (!brand) return
        return shrink(state.queue[id].file)
          .then(function (uri) {
            return call('brand_save', 'POST', {
              id: brand.id,
              name_en: brand.name_en,
              name_ar: brand.name_ar,
              slug: brand.slug,
              sort: brand.sort,
              logo: uri,
            })
          })
          .then(function () {
            ok++
            delete state.queue[id]
          })
          .catch(function (e) {
            failed.push(brand.name_en + ': ' + (e && e.message ? e.message : String(e)))
          })
          .then(function () {
            state.note = 'Uploading ' + (ok + failed.length) + '/' + ids.length + '…'
            render()
          })
      })
    })

    chain.then(function () {
      state.busy = false
      state.note = failed.length
        ? ok + ' uploaded. ' + failed.length + ' did not: ' + failed.join(' | ')
        : ok + ' logo(s) uploaded. Reload the page to see them on the list below.'
      return load()
    })
  }

  function load() {
    return call('brands')
      .then(function (rows) {
        state.brands = Array.isArray(rows) ? rows : (rows && rows.brands) || []
        render()
      })
      .catch(function (e) {
        state.note = 'Could not read the brands: ' + e.message
        render()
      })
  }

  function render() {
    if (!card) return
    card.innerHTML = ''

    var missing = state.brands.filter(function (b) { return !b.logo })
    var queued = Object.keys(state.queue)

    var h = el('div', 'sbl-head')
    h.appendChild(el('strong', null, 'Upload many logos'))
    h.appendChild(el('span', 'sbl-dim', state.brands.length
      ? (missing.length
          ? missing.length + ' of ' + state.brands.length + ' brands have no logo'
          : 'all ' + state.brands.length + ' brands have a logo')
      : 'reading the brands…'))
    card.appendChild(h)

    card.appendChild(el('p', 'sbl-dim',
      'Tick the brands, then choose the pictures — or drag them onto this box. '
      + 'A file named after a brand goes to that brand on its own; anything else '
      + 'fills the ticked brands in order.'))

    // The ticks.
    var ticks = el('div', 'sbl-ticks')
    ;[['All', function () { state.brands.forEach(function (b) { state.ticked[b.id] = true }) }],
      ['Only the ones without a logo', function () {
        state.brands.forEach(function (b) { state.ticked[b.id] = !b.logo })
      }],
      ['None', function () { state.ticked = {} }]].forEach(function (pair) {
      var btn = el('button', 'sbl-chip', pair[0])
      btn.type = 'button'
      btn.onclick = function () { pair[1](); render() }
      ticks.appendChild(btn)
    })
    card.appendChild(ticks)

    var list = el('div', 'sbl-list')
    state.brands.forEach(function (b) {
      var row = el('label', 'sbl-row')
      var box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = !!state.ticked[b.id]
      box.onchange = function () { state.ticked[b.id] = box.checked; render() }
      row.appendChild(box)
      row.appendChild(el('span', 'sbl-name', b.name_en))
      row.appendChild(el('span', 'sbl-dim', b.logo ? 'has a logo' : 'no logo'))
      var q = state.queue[b.id]
      if (q) {
        var tag = el('span', 'sbl-tag', q.name + ' — ' + q.how)
        var x = el('button', 'sbl-x', '✕')
        x.type = 'button'
        x.title = 'Take this picture off ' + b.name_en
        x.onclick = function (e) {
          e.preventDefault()
          delete state.queue[b.id]
          render()
        }
        tag.appendChild(x)
        row.appendChild(tag)
      }
      list.appendChild(row)
    })
    card.appendChild(list)

    if (state.orphans.length) {
      var o = el('p', 'sbl-warn',
        state.orphans.length + ' picture(s) had nowhere to go — nothing matched their '
        + 'names and every ticked brand already had one: ' + state.orphans.join(', '))
      var clear = el('button', 'sbl-chip', 'Clear')
      clear.type = 'button'
      clear.onclick = function () { state.orphans = []; render() }
      o.appendChild(clear)
      card.appendChild(o)
    }

    var actions = el('div', 'sbl-actions')
    var input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.className = 'sbl-file'
    input.onchange = function () {
      enqueue(Array.prototype.slice.call(input.files || []))
      input.value = ''
    }
    var choose = el('button', 'sbl-chip', 'Choose pictures')
    choose.type = 'button'
    choose.onclick = function () { input.click() }

    var go = el('button', 'sbl-go', state.busy ? 'Uploading…' : 'Upload ' + queued.length)
    go.type = 'button'
    go.disabled = state.busy || !queued.length
    go.onclick = upload

    actions.appendChild(choose)
    actions.appendChild(go)
    actions.appendChild(input)
    card.appendChild(actions)

    if (state.note) card.appendChild(el('p', 'sbl-note', state.note))
  }

  var CSS =
    '.sbl{border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px;margin:0 0 18px;'
    + 'background:rgba(255,255,255,.03)}'
    + '.sbl-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px}'
    + '.sbl-dim{opacity:.7;font-size:13px}'
    + '.sbl-ticks,.sbl-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}'
    + '.sbl-chip{min-height:36px;padding:0 12px;border-radius:999px;cursor:pointer;'
    + 'border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;font:inherit}'
    + '.sbl-go{min-height:40px;padding:0 18px;border-radius:999px;cursor:pointer;border:0;'
    + 'background:var(--brand,#e0561c);color:#171a1e;font:inherit;font-weight:700}'
    + '.sbl-go[disabled]{opacity:.45;cursor:default}'
    + '.sbl-list{display:flex;flex-direction:column;gap:2px;max-height:320px;overflow:auto}'
    + '.sbl-row{display:flex;gap:10px;align-items:center;min-height:40px;padding:0 4px;cursor:pointer}'
    + '.sbl-name{font-weight:600}'
    + '.sbl-tag{margin-inline-start:auto;font-size:12px;opacity:.85;display:flex;gap:6px;align-items:center}'
    + '.sbl-x{border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;min-width:28px;min-height:28px}'
    + '.sbl-warn{font-size:13px;color:#ffb08a}'
    + '.sbl-note{font-size:13px;margin:8px 0 0;white-space:pre-wrap}'
    + '.sbl-file{display:none}'
    + '.sbl.is-over{outline:2px dashed var(--brand,#e0561c);outline-offset:4px}'

  function style() {
    if (document.getElementById('sbl-css')) return
    var s = document.createElement('style')
    s.id = 'sbl-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  /** The Brands screen, and only it. The panel is a single page that swaps its
   *  content, so this has to be answered again after every render — hence the
   *  observer below rather than a check at load. */
  function brandsHeading() {
    var hs = document.querySelectorAll('.admin-content h2, .admin-content h1')
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
      // Left the screen: drop the card rather than leaving it on Orders.
      if (card && card.parentNode) {
        busy = true
        card.parentNode.removeChild(card)
        card = null
        busy = false
      }
      return
    }
    if (card && card.parentNode) return   // already there

    busy = true
    style()
    card = el('div', 'sbl')
    // After the heading's own block, so the panel's H2 still reads first.
    var anchor = head.parentNode
    anchor.parentNode.insertBefore(card, anchor.nextSibling)
    busy = false

    state.queue = {}
    state.orphans = []
    state.note = ''
    render()
    load()
  }

  /* EVERY dragover is prevented, not only the ones over the card. The
     browser's default for a dropped file is to NAVIGATE TO IT — the panel is
     replaced by the picture and anything queued is gone. Preventing it only
     over the drop zone leaves the rest of the window armed with that, which is
     worse than having no drag and drop at all. */
  document.addEventListener('dragover', function (e) {
    if (!e.dataTransfer) return
    e.preventDefault()
    var over = card && e.target && card.contains(e.target)
    e.dataTransfer.dropEffect = card ? 'copy' : 'none'
    if (card) card.classList.toggle('is-over', !!over)
  })
  document.addEventListener('dragleave', function () {
    if (card) card.classList.remove('is-over')
  })
  document.addEventListener('drop', function (e) {
    e.preventDefault()
    if (card) card.classList.remove('is-over')
    if (!card || !e.dataTransfer) return
    // items, not files: a drag from another browser TAB carries no File at
    // all, and .files gives an empty list that looks exactly like a cancelled
    // drag.
    var out = []
    var items = e.dataTransfer.items
    if (items) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          var f = items[i].getAsFile()
          if (f) out.push(f)
        }
      }
    } else {
      out = Array.prototype.slice.call(e.dataTransfer.files || [])
    }
    enqueue(out)
  })

  var timer = null
  var observer = new MutationObserver(function () {
    clearTimeout(timer)
    timer = setTimeout(place, 120)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  place()
})()
