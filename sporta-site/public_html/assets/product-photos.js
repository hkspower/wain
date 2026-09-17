/**
 * Product photographs, a whole shoot at once — on the panel's Catalogue screen.
 *
 * WHY. `photos=0/46`: every product card on the live shop is blank, and that is
 * a bigger visible problem than anything in the CSS. The panel adds photographs
 * one garment at a time, which for forty-six garments with several shots each is
 * hundreds of round trips through a form.
 *
 * ---------------------------------------------------------------------------
 * IT IS NOT THE BRAND-LOGO SCREEN WITH DIFFERENT WORDS, and the difference is
 * deliberate:
 *
 *   MANY PHOTOGRAPHS PER GARMENT, so the queue is a list per product rather
 *   than a slot. `nike-tee-1.jpg`, `nike-tee-2.jpg` and `nike-tee-3.jpg` all
 *   fold to `nike-tee` and all land on it, in filename order.
 *
 *   NO "FILL THE TICKED ONES IN ORDER" FALLBACK. The logo screen has one
 *   because eight brands and eight files is an obvious pairing. Here it would
 *   scatter a shoot across the wrong garments, and undoing that is deleting
 *   photographs one at a time from products you have to find first. A file that
 *   matches nothing is LISTED, with a dropdown to place it by hand, and it is
 *   not uploaded until somebody does.
 *
 *   NOTHING IS REPLACED. product_image_add APPENDS — the server's own comment
 *   says an upload quietly becoming the front of the shoot is not what anybody
 *   means by "add a photo" — so running this twice adds the pictures twice
 *   rather than overwriting. The card says so, and shows how many each garment
 *   already has.
 *
 * THE CAP IS THE SERVER'S. STORE_PRODUCT_IMAGE_LIMIT is counted inside the
 * insert's own transaction, so this does not try to enforce it a second time
 * and get it wrong; it reports `too_many_images` in words instead.
 *
 * ONE CARD ADDED, nothing existing touched, and it does nothing at all outside
 * the Catalogue screen — the same shape as contact.js, footer.js, theme.js and
 * brand-logos.js over a bundle whose source is not in this repository.
 *
 * ---------------------------------------------------------------------------
 * THREE IMPROVEMENTS, asked for on 2026-09-17, added without touching any of
 * the above — every class name and message the upload flow already relied on
 * (product-photos-site-test.mjs) is untouched:
 *
 *   1. QUEUED FILES SHOW A THUMBNAIL, not just a filename. `URL.createObjectURL`
 *      on the raw File, before any server round trip — it costs nothing and it
 *      is the difference between "is this the right shot" and finding out after
 *      the upload lands. Revoked the moment an item leaves the queue (uploaded,
 *      removed, or cleared), or a hundred-photo shoot leaks a hundred blob URLs.
 *
 *   2. EXISTING PHOTOGRAPHS ARE MANAGEABLE HERE, not just counted. `counts()`
 *      was already fetching `product_images&slug=` for every garment and
 *      throwing the list away, keeping only `.length` — the images were already
 *      one request away. Now each garment with at least one photograph can be
 *      expanded into a thumbnail grid, delete an image (`product_image_delete`)
 *      or move it earlier/later in the shoot (`product_image_reorder`), both
 *      routes the server already carried and neither screen used before this.
 *      Collapsed by default: forty-six garments' worth of thumbnails rendered
 *      at once would be the wrong default for a screen whose whole point is
 *      photographs nobody has seen yet.
 *
 *   3. A REAL DROP ZONE, not a paragraph of instructions. The drag/drop handling
 *      was already global (see the bottom of this file, and its own comment on
 *      why) — this only makes the target visible: a dashed box with an icon,
 *      inside the card, that also opens the file picker on a click, so a mouse
 *      user gets the same one-step path a drag already had.
 */
(function () {
  'use strict'

  // The shared helpers. Absent means a half-published set: do nothing rather
  // than throw, so the panel stays usable and the card is merely missing.
  var U = window.sportaUpload
  if (!U) return

  var state = {
    products: [],       // {slug, name_en, photos, images}
    queue: [],          // {file, name, slug|null, how, error, previewUrl}
    expanded: {},        // slug -> bool, existing-photos grid open
    busy: false,
    note: '',
    loaded: false,
  }
  var card = null

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text !== undefined) n.textContent = text
    return n
  }

  function match(name) {
    var key = U.fold(name)
    if (!key) return null
    for (var i = 0; i < state.products.length; i++) {
      if (U.fold(state.products[i].slug) === key) return state.products[i]
    }
    for (var j = 0; j < state.products.length; j++) {
      if (U.fold(state.products[j].name_en) === key) return state.products[j]
    }
    // Longest slug first, so `nike-tee-black` wins over `nike-tee`. Without the
    // sort a shorter slug that happens to be a prefix takes every photograph of
    // the longer garment, which is a wrong answer that looks like a right one.
    var byLength = state.products.slice().sort(function (a, b) {
      return U.fold(b.slug).length - U.fold(a.slug).length
    })
    for (var k = 0; k < byLength.length; k++) {
      var s = U.fold(byLength[k].slug)
      if (s.length >= 4 && key.indexOf(s) !== -1) return byLength[k]
    }
    return null
  }

  // Every queued item that carries a blob URL must give it back — the browser
  // does not do this on its own until the page unloads.
  function revoke(item) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl)
      item.previewUrl = null
    }
  }

  function enqueue(files) {
    if (!files || !files.length) return
    // Filename order, so a shoot keeps the order it was shot in — the first
    // photograph of a garment becomes its main one, and that should be the
    // photographer's choice rather than whatever order the OS handed over.
    var sorted = Array.prototype.slice.call(files).sort(function (a, b) {
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    })
    for (var i = 0; i < sorted.length; i++) {
      var hit = match(sorted[i].name)
      state.queue.push({
        file: sorted[i],
        name: sorted[i].name,
        slug: hit ? hit.slug : null,
        how: hit ? 'matched by name' : 'no match — choose a garment',
        // Best-effort: an unreadable file still queues (the upload step is
        // what actually validates it), it simply shows no picture.
        previewUrl: (function () {
          try { return URL.createObjectURL(sorted[i]) } catch (e) { return null }
        })(),
      })
    }
    state.note = ''
    render()
  }

  function upload() {
    if (state.busy) return
    var ready = state.queue.filter(function (q) { return q.slug && !q.done })
    if (!ready.length) return
    state.busy = true
    render()

    var ok = 0
    var failed = []
    var chain = Promise.resolve()

    // ONE AT A TIME. Each one encodes an image and posts up to 900 kB; a
    // hundred at once is a hundred encodes competing for one main thread and a
    // hundred writes to one table. The count moving is also the only sign of
    // progress a person gets.
    ready.forEach(function (item) {
      chain = chain.then(function () {
        return U.shrink(item.file)
          .then(function (small) {
            return U.call('product_image_add', 'POST', {
              slug: item.slug,
              image: small.dataUri,
              width: small.width,
              height: small.height,
            })
          })
          .then(function (res) {
            ok++
            item.done = true
            var p = byslug(item.slug)
            if (p) {
              p.photos = (p.photos || 0) + 1
              if (p.images) {
                p.images.push({
                  id: res.id, sort: p.images.length,
                  url: res.url, width: null, height: null,
                })
              }
            }
          })
          .catch(function (e) {
            var msg = e && e.message ? e.message : String(e)
            if (msg === 'too_many_images') msg = 'that garment already holds the maximum number of photographs'
            if (msg === 'product_not_found') msg = 'no garment with that slug — reload the panel'
            item.error = msg
            failed.push(item.name + ': ' + msg)
          })
          .then(function () {
            state.note = 'Uploading ' + (ok + failed.length) + '/' + ready.length + '…'
            render()
          })
      })
    })

    chain.then(function () {
      state.busy = false
      // Keep only what failed or was never placed, so pressing Upload again
      // retries exactly those and does not add the successful ones a second
      // time — product_image_add appends, so a re-run would duplicate them.
      state.queue = state.queue.filter(function (q) {
        if (q.done) revoke(q)
        return !q.done
      })
      state.note = failed.length
        ? ok + ' uploaded. ' + failed.length + ' did not: ' + failed.join(' | ')
        : ok + ' photograph(s) uploaded.'
      render()
    })
  }

  function byslug(slug) {
    for (var i = 0; i < state.products.length; i++) {
      if (state.products[i].slug === slug) return state.products[i]
    }
    return null
  }

  function load() {
    return U.call('products_all')
      .then(function (rows) {
        var list = Array.isArray(rows) ? rows : (rows && rows.products) || []
        state.products = list.map(function (p) {
          return { slug: p.slug, name_en: p.name_en, photos: null, images: null }
        })
        state.loaded = true
        render()
      })
      .catch(function (e) {
        state.note = 'Could not read the catalogue: ' + e.message
        render()
      })
  }

  /** How many photographs each garment already holds, AND the list itself —
   *  asked for only when the card is opened, and only once. It is one request
   *  per garment, so it is not something to do on every render.
   *
   *  Keeping the full list, not just its length, is what makes the "manage
   *  existing photographs" grid free: the request was already being made and
   *  its body thrown away down to a number. */
  function counts() {
    var i = 0
    function next() {
      if (i >= state.products.length) { render(); return }
      var p = state.products[i++]
      return U.call('product_images&slug=' + encodeURIComponent(p.slug))
        .then(function (d) {
          p.images = (d && d.images) || []
          p.photos = p.images.length
        })
        .catch(function () { p.photos = null; p.images = null })
        .then(function () {
          if (i % 8 === 0) render()
          return next()
        })
    }
    return Promise.resolve().then(next)
  }

  function deletePhoto(slug, id) {
    return U.call('product_image_delete', 'POST', { id: id })
      .then(function () {
        var p = byslug(slug)
        if (p && p.images) {
          p.images = p.images.filter(function (im) { return im.id !== id })
          p.photos = p.images.length
        }
        render()
      })
      .catch(function (e) {
        state.note = 'Could not remove that photograph: ' + (e.message || e)
        render()
      })
  }

  /** dir is -1 (earlier in the shoot) or +1 (later). Sends the WHOLE new order
   *  for this garment — product_image_reorder takes the full list and assigns
   *  sort by position, so a partial list would silently drop every id left
   *  out of it. */
  function movePhoto(slug, id, dir) {
    var p = byslug(slug)
    if (!p || !p.images) return
    var idx = -1
    for (var i = 0; i < p.images.length; i++) if (p.images[i].id === id) { idx = i; break }
    var swap = idx + dir
    if (idx < 0 || swap < 0 || swap >= p.images.length) return
    var arr = p.images.slice()
    var t = arr[idx]; arr[idx] = arr[swap]; arr[swap] = t
    var ids = arr.map(function (im) { return im.id })
    return U.call('product_image_reorder', 'POST', { slug: slug, ids: ids })
      .then(function () {
        p.images = arr
        render()
      })
      .catch(function (e) {
        state.note = 'Could not reorder: ' + (e.message || e)
        render()
      })
  }

  function render() {
    if (!card) return
    card.innerHTML = ''

    var withPhotos = state.products.filter(function (p) { return p.photos > 0 }).length
    var counted = state.products.filter(function (p) { return p.photos !== null }).length

    var h = el('div', 'spp-head')
    h.appendChild(el('strong', null, 'Upload many photographs'))
    h.appendChild(el('span', 'spp-dim', !state.loaded
      ? 'reading the catalogue…'
      : counted < state.products.length
        ? 'counting photographs, ' + counted + '/' + state.products.length + '…'
        : withPhotos + ' of ' + state.products.length + ' garments have a photograph'))
    card.appendChild(h)

    var actions = el('div', 'spp-actions')
    var input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.className = 'spp-file'
    input.onchange = function () {
      enqueue(input.files)
      input.value = ''
    }

    // THE DROP ZONE ITSELF, not a paragraph explaining that one exists. The
    // actual drag handling lives on `document` at the bottom of this file —
    // this element is only ever the visible target and a second way to open
    // the same file picker as the "Choose photographs" chip.
    var drop = el('div', 'spp-drop')
    drop.appendChild(el('div', 'spp-drop-icon', '📷'))
    drop.appendChild(el('div', 'spp-drop-text', 'Drag a folder of photographs here, or click to choose'))
    drop.appendChild(el('div', 'spp-drop-sub',
      'A file named after a garment goes to that garment — nike-tee-1.jpg, '
      + 'nike-tee-2.jpg and nike-tee-3.jpg all land on nike-tee, in that order. '
      + 'Anything that matches nothing waits for you to pick a garment for it. '
      + 'Photographs are ADDED, never replaced.'))
    drop.onclick = function () { input.click() }
    card.appendChild(drop)

    var choose = el('button', 'spp-chip', 'Choose photographs')
    choose.type = 'button'
    choose.onclick = function () { input.click() }

    var ready = state.queue.filter(function (q) { return q.slug })
    var go = el('button', 'spp-go', state.busy ? 'Uploading…' : 'Upload ' + ready.length)
    go.type = 'button'
    go.disabled = state.busy || !ready.length
    go.onclick = upload

    var clear = el('button', 'spp-chip', 'Clear the list')
    clear.type = 'button'
    clear.disabled = state.busy || !state.queue.length
    clear.onclick = function () {
      state.queue.forEach(revoke)
      state.queue = []
      state.note = ''
      render()
    }

    actions.appendChild(choose)
    actions.appendChild(go)
    actions.appendChild(clear)
    actions.appendChild(input)
    card.appendChild(actions)

    if (state.queue.length) {
      var unplaced = state.queue.filter(function (q) { return !q.slug }).length
      if (unplaced) {
        card.appendChild(el('p', 'spp-warn',
          unplaced + ' file(s) matched no garment. Pick one for each, or they '
          + 'stay here — nothing is uploaded to a garment nobody chose.'))
      }

      var list = el('div', 'spp-list')
      state.queue.forEach(function (item, idx) {
        var row = el('div', 'spp-row' + (item.error ? ' is-bad' : ''))

        if (item.previewUrl) {
          var thumb = document.createElement('img')
          thumb.className = 'spp-thumb'
          thumb.src = item.previewUrl
          thumb.alt = ''
          row.appendChild(thumb)
        } else {
          row.appendChild(el('span', 'spp-thumb spp-thumb-none', '—'))
        }

        row.appendChild(el('span', 'spp-name', item.name))

        var sel = document.createElement('select')
        sel.className = 'spp-sel'
        var none = document.createElement('option')
        none.value = ''
        none.textContent = '— choose a garment —'
        sel.appendChild(none)
        state.products.forEach(function (p) {
          var o = document.createElement('option')
          o.value = p.slug
          o.textContent = p.name_en + (p.photos ? '  (' + p.photos + ')' : '')
          if (p.slug === item.slug) o.selected = true
          sel.appendChild(o)
        })
        sel.onchange = function () {
          state.queue[idx].slug = sel.value || null
          state.queue[idx].how = sel.value ? 'chosen by hand' : 'no match — choose a garment'
          state.queue[idx].error = null
          render()
        }
        row.appendChild(sel)
        row.appendChild(el('span', 'spp-dim', item.error || item.how))

        var x = el('button', 'spp-x', '✕')
        x.type = 'button'
        x.title = 'Take ' + item.name + ' off the list'
        x.onclick = function () {
          revoke(state.queue[idx])
          state.queue.splice(idx, 1)
          render()
        }
        row.appendChild(x)
        list.appendChild(row)
      })
      card.appendChild(list)
    }

    if (state.note) card.appendChild(el('p', 'spp-note', state.note))

    // ------------------------------------------------------ manage existing
    var withImages = state.products.filter(function (p) { return p.images && p.images.length })
    if (withImages.length) {
      var manage = el('div', 'spm')
      manage.appendChild(el('strong', 'spm-title', 'Existing photographs'))
      manage.appendChild(el('p', 'spp-dim',
        'Remove a photograph, or move it earlier or later in the shoot — the '
        + 'first one is what shows on the shop’s product cards.'))

      withImages.forEach(function (p) {
        var open = !!state.expanded[p.slug]
        var row = el('div', 'spm-row')
        var toggle = el('button', 'spm-toggle', (open ? '▾ ' : '▸ ') + p.name_en + '  (' + p.images.length + ')')
        toggle.type = 'button'
        toggle.onclick = function () {
          state.expanded[p.slug] = !open
          render()
        }
        row.appendChild(toggle)
        manage.appendChild(row)

        if (open) {
          var grid = el('div', 'spm-grid')
          p.images.forEach(function (im, i) {
            var cell = el('div', 'spm-thumb-wrap')
            var img = document.createElement('img')
            img.src = im.url
            img.alt = ''
            cell.appendChild(img)

            var actionsRow = el('div', 'spm-thumb-actions')
            var up = el('button', 'spm-thumb-btn', '↑')
            up.type = 'button'
            up.title = 'Move earlier'
            up.disabled = i === 0
            up.onclick = function () { movePhoto(p.slug, im.id, -1) }
            var down = el('button', 'spm-thumb-btn', '↓')
            down.type = 'button'
            down.title = 'Move later'
            down.disabled = i === p.images.length - 1
            down.onclick = function () { movePhoto(p.slug, im.id, 1) }
            var del = el('button', 'spm-thumb-btn spm-thumb-del', '✕')
            del.type = 'button'
            del.title = 'Remove this photograph'
            del.onclick = function () {
              if (window.confirm('Remove this photograph from ' + p.name_en + '?')) {
                deletePhoto(p.slug, im.id)
              }
            }
            actionsRow.appendChild(up)
            actionsRow.appendChild(down)
            actionsRow.appendChild(del)
            cell.appendChild(actionsRow)
            grid.appendChild(cell)
          })
          manage.appendChild(grid)
        }
      })

      card.appendChild(manage)
    }
  }

  var CSS =
    '.spp{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;'
    + 'background:rgba(255,255,255,.03)}'
    + '.spp-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px}'
    + '.spp-dim{opacity:.7;font-size:13px}'
    + '.spp-drop{border:2px dashed rgba(255,255,255,.25);border-radius:12px;padding:22px 16px;'
    + 'text-align:center;cursor:pointer;margin:10px 0;transition:border-color .15s,background .15s}'
    + '.spp-drop:hover{border-color:rgba(255,255,255,.45)}'
    + '.spp.is-over .spp-drop{border-color:var(--brand,#e0561c);background:rgba(224,86,28,.1)}'
    + '.spp-drop-icon{font-size:28px;line-height:1;margin-bottom:6px}'
    + '.spp-drop-text{font-size:14px}'
    + '.spp-drop-sub{font-size:12px;opacity:.65;margin-top:6px;max-width:520px;'
    + 'margin-left:auto;margin-right:auto}'
    + '.spp-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}'
    + '.spp-chip{min-height:36px;padding:0 12px;border-radius:999px;cursor:pointer;'
    + 'border:1px solid rgba(255,255,255,.2);background:transparent;color:inherit;font:inherit}'
    + '.spp-chip[disabled]{opacity:.45;cursor:default}'
    + '.spp-go{min-height:40px;padding:0 18px;border-radius:999px;cursor:pointer;border:0;'
    + 'background:var(--brand,#e0561c);color:#171a1e;font:inherit;font-weight:700}'
    + '.spp-go[disabled]{opacity:.45;cursor:default}'
    + '.spp-list{display:flex;flex-direction:column;gap:4px;max-height:340px;overflow:auto;margin-top:8px}'
    + '.spp-row{display:flex;gap:8px;align-items:center;min-height:40px;flex-wrap:wrap}'
    + '.spp-row.is-bad{outline:1px solid #ff8a80;outline-offset:2px;border-radius:8px}'
    + '.spp-thumb{width:32px;height:32px;border-radius:6px;object-fit:cover;flex:none;'
    + 'background:rgba(255,255,255,.08)}'
    + '.spp-thumb-none{display:flex;align-items:center;justify-content:center;opacity:.4;font-size:11px}'
    + '.spp-name{min-width:150px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.spp-sel{min-height:34px;border-radius:8px;background:transparent;color:inherit;font:inherit;'
    + 'border:1px solid rgba(255,255,255,.2);padding:0 6px;max-width:280px}'
    + '.spp-sel option{color:#111}'
    + '.spp-x{border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;'
    + 'min-width:32px;min-height:32px;margin-inline-start:auto}'
    + '.spp-warn{font-size:13px;color:#ffb08a;margin:6px 0 0}'
    + '.spp-note{font-size:13px;margin:8px 0 0;white-space:pre-wrap}'
    + '.spp-file{display:none}'
    + '.spp.is-over{outline:2px dashed var(--brand,#e0561c);outline-offset:4px}'
    + '.spm{border-top:1px solid rgba(255,255,255,.12);margin-top:14px;padding-top:12px}'
    + '.spm-title{display:block;margin-bottom:2px}'
    + '.spm-row{margin:4px 0}'
    + '.spm-toggle{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;'
    + 'min-height:32px;padding:0;text-align:start}'
    + '.spm-grid{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 12px}'
    + '.spm-thumb-wrap{width:88px;display:flex;flex-direction:column;gap:4px}'
    + '.spm-thumb-wrap img{width:88px;height:88px;object-fit:cover;border-radius:8px;'
    + 'border:1px solid rgba(255,255,255,.14)}'
    + '.spm-thumb-actions{display:flex;gap:4px;justify-content:center}'
    + '.spm-thumb-btn{min-width:26px;min-height:26px;border-radius:6px;border:1px solid rgba(255,255,255,.2);'
    + 'background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px}'
    + '.spm-thumb-btn[disabled]{opacity:.3;cursor:default}'
    + '.spm-thumb-del{border-color:rgba(255,138,128,.5);color:#ff8a80}'

  function style() {
    if (document.getElementById('spp-css')) return
    var s = document.createElement('style')
    s.id = 'spp-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  /** The Catalogue screen, and only it. The panel swaps its content in place,
   *  so this is answered again after every render rather than once at load. */
  function catalogueHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Catalogue') return hs[i]
    }
    return null
  }

  var placing = false
  function place() {
    if (placing) return
    var head = catalogueHeading()

    if (!head) {
      if (card && card.parentNode) {
        placing = true
        state.queue.forEach(revoke)
        card.parentNode.removeChild(card)
        card = null
        placing = false
      }
      return
    }
    if (card && card.parentNode) return

    placing = true
    style()
    card = el('div', 'spp')
    var anchor = head.parentNode
    anchor.parentNode.insertBefore(card, anchor.nextSibling)
    placing = false

    state.queue = []
    state.expanded = {}
    state.note = ''
    render()
    load().then(counts)
  }

  /* EVERY dragover is prevented, not only the ones over the card. The browser's
     default for a dropped file is to NAVIGATE TO IT — the panel is replaced by
     the photograph and the whole queue is gone. Preventing it only over the
     drop zone leaves the rest of the window armed with that. */
  document.addEventListener('dragover', function (e) {
    if (!e.dataTransfer) return
    e.preventDefault()
    e.dataTransfer.dropEffect = card ? 'copy' : 'none'
    if (card) card.classList.toggle('is-over', !!(e.target && card.contains(e.target)))
  })
  document.addEventListener('dragleave', function () {
    if (card) card.classList.remove('is-over')
  })
  document.addEventListener('drop', function (e) {
    e.preventDefault()
    if (card) card.classList.remove('is-over')
    if (!card || !e.dataTransfer) return
    // items, not files: a drag from another browser TAB carries no File at all,
    // and .files gives an empty list that looks exactly like a cancelled drag.
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
  new MutationObserver(function () {
    clearTimeout(timer)
    timer = setTimeout(place, 120)
  }).observe(document.body, { childList: true, subtree: true })
  place()
})()
