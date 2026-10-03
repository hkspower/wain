/**
 * Sporta — size, fit and colour as fixed pick-lists, on the Catalogue screen.
 *
 * "make selectable and static size and shape and color at backend" — the owner,
 * 2026-09-29. Colour is one product per colour in this shop (the product name
 * carries it), and the owner chose to keep it that way, so colour here is a
 * TAG on a product: a key from the server's fixed list, drawn as a swatch.
 *
 * NOTHING IS TYPED. Every option comes from `admin.php?r=product_attrs`, which
 * answers with the colours, the shop's sizes and its fits — the last two from
 * the `rules` row, so a size the owner switched off in Settings is not offered
 * here either. A list typed into this file would be a second home for it.
 *
 * ONE WRITE, `product_attrs_save`, which touches only product_attrs and the
 * product's size rows. It is not `product_save` on purpose: that route is a
 * full upsert, and CLAUDE.md records what an overlay that resends part of a
 * product does to the rest of it.
 *
 * A SIZE WITH STOCK CANNOT BE UNTICKED. The box is disabled and says how many
 * are in stock; the server refuses the same thing by name, so the two agree.
 *
 * FIT IS NOT YET USED BY THE STOREFRONT. The bundle has no source here and
 * picks each order line's fit from its own per-garment default ('slim' for
 * leggings and tops, 'normal' for the rest, none for accessories — the card's
 * quick-add follows the same rule, see quick-add-size.js), so the fits chosen
 * here are recorded and shown in this panel, not yet offered to shoppers.
 */
(function () {
  'use strict'

  var MARK = 'data-sporta-attrs'
  var API = '/api/admin.php?r='
  var card = null
  var state = { rows: null, attrs: null, slug: '', pick: null, busy: false, note: '', bad: false }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function call(route, method, body) {
    return fetch(API + route, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) {
        return { ok: r.ok, status: r.status, j: j }
      })
    })
  }

  function refusal(j) {
    var e = j && (j.error || j.message) ? String(j.error || j.message) : ''
    var m = /^size_has_stock:([^:]+):(\d+)$/.exec(e)
    if (m) return m[1] + ' has ' + m[2] + ' in stock — set its stock to 0 first, then remove it.'
    var map = {
      at_least_one_size: 'A product needs at least one size.',
      invalid_colour: 'That colour is not in the list.',
      invalid_fit: 'That fit is not offered by this shop.',
      invalid_size: 'That size is not offered by this shop.',
      product_not_found: 'That product no longer exists.',
      product_attrs_not_ready: 'This shop has not been set up for this yet (the product_attrs table is missing).'
    }
    return map[e] || (e ? 'Refused: ' + e : 'Could not save.')
  }

  function current() {
    var a = state.attrs, slug = state.slug
    var row = (a.rows && a.rows[slug]) || {}
    var vs = (a.variants && a.variants[slug]) || []
    return {
      colour: row.colour || '',
      fits: row.fits || a.fits.slice(),          // NULL in the table means every fit
      sizes: vs.map(function (v) { return v.size }),
      stock: vs.reduce(function (m, v) { m[v.size] = v.stock; return m }, {})
    }
  }

  function render() {
    if (!card) return
    card.textContent = ''
    card.appendChild(el('h3', 'spa-h', 'Size, fit and colour'))
    card.appendChild(el('p', 'spa-sub', 'Pick from the fixed lists for a product. Nothing here is typed, and only the product’s colour, fits and size rows change — never its price, photos or stock counts.'))
    if (!state.attrs || !state.rows) { card.appendChild(el('p', 'spa-note', 'Loading…')); return }
    if (state.attrs.ready === false) {
      card.appendChild(el('p', 'spa-warn', 'This shop has not been set up for this yet — the product_attrs table has not been created.'))
      return
    }

    var sel = el('select', 'spa-input')
    sel.setAttribute('aria-label', 'Product')
    sel.appendChild(el('option', '', 'Choose a product…')).value = ''
    state.rows.slice().sort(function (a, b) { return String(a.name_en).localeCompare(String(b.name_en)) })
      .forEach(function (r) {
        var o = el('option', '', r.name_en + (r.active ? '' : ' (hidden)'))
        o.value = r.slug
        if (r.slug === state.slug) o.selected = true
        sel.appendChild(o)
      })
    sel.addEventListener('change', function () {
      state.slug = sel.value; state.note = ''; state.bad = false
      state.pick = state.slug ? current() : null
      render()
    })
    card.appendChild(sel)
    if (!state.slug || !state.pick) return
    var p = state.pick, a = state.attrs

    // colour
    var f1 = el('div', 'spa-field')
    f1.appendChild(el('div', 'spa-label', 'Colour'))
    var sw = el('div', 'spa-swatches')
    var none = el('button', 'spa-sw' + (p.colour === '' ? ' on' : ''), 'None')
    none.type = 'button'; none.setAttribute('aria-pressed', String(p.colour === ''))
    none.addEventListener('click', function () { p.colour = ''; render() })
    sw.appendChild(none)
    a.colours.forEach(function (c) {
      var b = el('button', 'spa-sw' + (p.colour === c.key ? ' on' : ''))
      b.type = 'button'; b.setAttribute('aria-pressed', String(p.colour === c.key)); b.setAttribute('data-colour', c.key)
      var dot = el('span', 'spa-dot'); dot.style.background = c.hex
      b.appendChild(dot); b.appendChild(document.createTextNode(c.en))
      b.addEventListener('click', function () { p.colour = c.key; render() })
      sw.appendChild(b)
    })
    f1.appendChild(sw)
    card.appendChild(f1)

    // fit
    var f2 = el('div', 'spa-field')
    f2.appendChild(el('div', 'spa-label', 'Fit (shape)'))
    var r2 = el('div', 'spa-row')
    a.fits.forEach(function (fit) {
      var l = el('label', 'spa-chk')
      var c = el('input'); c.type = 'checkbox'; c.value = fit; c.checked = p.fits.indexOf(fit) !== -1
      c.setAttribute('data-fit', fit)
      c.addEventListener('change', function () {
        p.fits = a.fits.filter(function (x) { return x === fit ? c.checked : p.fits.indexOf(x) !== -1 })
      })
      l.appendChild(c); l.appendChild(document.createTextNode(' ' + fit))
      r2.appendChild(l)
    })
    f2.appendChild(r2)
    card.appendChild(f2)

    // sizes
    var f3 = el('div', 'spa-field')
    f3.appendChild(el('div', 'spa-label', 'Sizes'))
    var r3 = el('div', 'spa-row')
    a.sizes.forEach(function (sz) {
      var stock = p.stock[sz] || 0
      var l = el('label', 'spa-chk')
      var c = el('input'); c.type = 'checkbox'; c.value = sz; c.checked = p.sizes.indexOf(sz) !== -1
      c.setAttribute('data-size', sz)
      if (c.checked && stock > 0) { c.disabled = true; l.title = stock + ' in stock — set to 0 to remove' }
      c.addEventListener('change', function () {
        p.sizes = a.sizes.filter(function (x) { return x === sz ? c.checked : p.sizes.indexOf(x) !== -1 })
      })
      l.appendChild(c)
      l.appendChild(document.createTextNode(' ' + sz + (c.checked && p.stock[sz] != null ? ' · ' + stock : '')))
      r3.appendChild(l)
    })
    f3.appendChild(r3)
    card.appendChild(f3)

    var go = el('button', 'spa-go', state.busy ? 'Saving…' : 'Save size, fit and colour')
    go.type = 'button'; go.disabled = state.busy
    go.addEventListener('click', save)
    var row = el('div', 'spa-field'); row.appendChild(go)
    card.appendChild(row)
    if (state.note) card.appendChild(el('p', state.bad ? 'spa-warn' : 'spa-note', state.note))
  }

  function save() {
    var p = state.pick
    if (!p || state.busy) return
    state.busy = true; state.note = ''; render()
    call('product_attrs_save', 'POST', { slug: state.slug, colour: p.colour, fits: p.fits, sizes: p.sizes })
      .then(function (r) {
        state.busy = false
        if (!r.ok) { state.bad = true; state.note = refusal(r.j); render(); return }
        state.bad = false; state.note = 'Saved.'
        return call('product_attrs').then(function (x) {
          if (x.ok) { state.attrs = x.j; state.pick = current() }
          render()
        })
      })
  }

  function load() {
    call('products_all').then(function (r) {
      state.rows = (r.j && (r.j.rows || r.j)) || []
      return call('product_attrs')
    }).then(function (x) {
      state.attrs = x.ok ? x.j : { ready: false }
      if (state.slug) state.pick = current()
      render()
    })
  }

  function catalogueHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim() === 'Catalogue') return hs[i]
    return null
  }

  var CSS = ''
    + '.spa{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);'
    + 'padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;background:var(--card,rgba(255,255,255,.03))}'
    + '.spa-h{margin:0 0 4px;font-size:16px}'
    + '.spa-sub{margin:0 0 14px;opacity:.7;font-size:13px}'
    + '.spa-input{padding:8px 10px;border-radius:8px;border:1px solid var(--border,#2a2d31);'
    + 'background:transparent;color:inherit;font:inherit;width:100%;box-sizing:border-box}'
    + '.spa-field{margin-top:14px}'
    + '.spa-label{font-size:13px;font-weight:600;margin-bottom:6px}'
    + '.spa-row{display:flex;flex-wrap:wrap;gap:8px}'
    + '.spa-chk{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;min-height:44px;box-sizing:border-box;'
    + 'border:1px solid var(--border,#2a2d31);border-radius:8px;font-size:13px;cursor:pointer}'
    + '.spa-swatches{display:flex;flex-wrap:wrap;gap:8px}'
    + '.spa-sw{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;min-height:44px;box-sizing:border-box;'
    + 'border:1px solid var(--border,#2a2d31);border-radius:999px;background:transparent;color:inherit;font:inherit;'
    + 'font-size:13px;cursor:pointer}'
    + '.spa-sw.on{border-color:var(--brand,#e0561c);box-shadow:0 0 0 2px var(--brand,#e0561c) inset}'
    + '.spa-dot{width:16px;height:16px;border-radius:50%;border:1px solid rgba(255,255,255,.35);display:inline-block}'
    + '.spa-go{padding:10px 16px;min-height:44px;border-radius:8px;border:0;cursor:pointer;'
    + 'background:var(--brand,#e0561c);color:#fff;font:inherit;font-weight:600}'
    + '.spa-go[disabled]{opacity:.5;cursor:default}'
    + '.spa-note{margin:12px 0 0;font-size:13px;line-height:1.5;opacity:.85}'
    + '.spa-warn{margin:12px 0 0;font-size:13px;line-height:1.5;padding:10px 12px;border-radius:8px;'
    + 'background:#2a1f14;border:1px solid #5c4326;color:#ffd7a8}'

  function style() {
    if (document.getElementById('spa-css')) return
    var s = el('style'); s.id = 'spa-css'; s.textContent = CSS
    document.head.appendChild(s)
  }

  var placing = false
  function place() {
    if (placing) return
    placing = true
    try {
      var head = catalogueHeading()
      var existing = document.querySelector('[' + MARK + ']')
      if (!head) {
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
        card = null
        state = { rows: null, attrs: null, slug: '', pick: null, busy: false, note: '', bad: false }
        return
      }
      if (existing) { card = existing; return }
      style()
      card = el('div', 'spa')
      card.setAttribute(MARK, '1')
      var host = head.parentNode
      if (host && host.parentNode) host.parentNode.insertBefore(card, host.nextSibling)
      else document.body.appendChild(card)
      render()
      load()
    } finally { placing = false }
  }

  var timer = null
  function schedule() { clearTimeout(timer); timer = setTimeout(place, 150) }
  function start() {
    place()
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
