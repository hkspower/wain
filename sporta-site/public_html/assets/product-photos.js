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
 */
(function () {
  'use strict'

  // The shared helpers. Absent means a half-published set: do nothing rather
  // than throw, so the panel stays usable and the card is merely missing.
  var U = window.sportaUpload
  if (!U) return

  var state = {
    products: [],       // {slug, name_en, photos}
    queue: [],          // {file, name, slug|null, how, error}
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
          .then(function () {
            ok++
            item.done = true
            var p = byslug(item.slug)
            if (p) p.photos++
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
      state.queue = state.queue.filter(function (q) { return !q.done })
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
          return { slug: p.slug, name_en: p.name_en, photos: null }
        })
        state.loaded = true
        render()
      })
      .catch(function (e) {
        state.note = 'Could not read the catalogue: ' + e.message
        render()
      })
  }

  /** How many photographs each garment already holds. Asked for only when the
   *  card is opened, and only once — it is one request per garment, so it is
   *  not something to do on every render. */
  function counts() {
    var i = 0
    function next() {
      if (i >= state.products.length) { render(); return }
      var p = state.products[i++]
      return U.call('product_images&slug=' + encodeURIComponent(p.slug))
        .then(function (d) { p.photos = ((d && d.images) || []).length })
        .catch(function () { p.photos = null })
        .then(function () {
          if (i % 8 === 0) render()
          return next()
        })
    }
    return Promise.resolve().then(next)
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

    card.appendChild(el('p', 'spp-dim',
      'Drag a folder of photographs here, or choose them. A file named after a '
      + 'garment goes to that garment — nike-tee-1.jpg, nike-tee-2.jpg and '
      + 'nike-tee-3.jpg all land on nike-tee, in that order. Anything that '
      + 'matches nothing waits for you to pick a garment for it. '
      + 'Photographs are ADDED, never replaced, so uploading the same folder '
      + 'twice gives every garment two copies.'))

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
    clear.onclick = function () { state.queue = []; state.note = ''; render() }

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
          state.queue.splice(idx, 1)
          render()
        }
        row.appendChild(x)
        list.appendChild(row)
      })
      card.appendChild(list)
    }

    if (state.note) card.appendChild(el('p', 'spp-note', state.note))
  }

  var CSS =
    '.spp{border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px;margin:0 0 18px;'
    + 'background:rgba(255,255,255,.03)}'
    + '.spp-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:6px}'
    + '.spp-dim{opacity:.7;font-size:13px}'
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
