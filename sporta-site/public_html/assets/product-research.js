/**
 * Sporta — "look it up" for a product's missing fields, on the Catalogue screen.
 *
 * WHAT IT IS. The owner asked for an assistant that finds product information
 * on the web and uses it for missing fields only. The server half is
 * api/research.php, which searches and PROPOSES; this is where the owner reads
 * the proposal, unticks anything they disagree with, and applies the rest.
 *
 * NOTHING REACHES A PRODUCT UNTIL THE OWNER PRESSES APPLY. That was chosen
 * over automatic filling, and it is why every field arrives with the sources
 * it came from beside it. A wrong description on a product page is a wrong
 * sale, and no rig anywhere would catch it.
 *
 * APPLY RESENDS THE WHOLE PRODUCT, and that is the one dangerous thing here.
 * `product_save` is a full upsert — it writes every column it is given — so a
 * request carrying only `desc_en` would blank the price, the sale window and
 * the brand. CLAUDE.md records exactly this trap on `brand_save`, where an
 * overlay that sent only the logo would have blanked the brand's name while
 * appearing to upload a picture. So the row is read back from `products_all`
 * IMMEDIATELY BEFORE the save and re-sent whole, with only the accepted fields
 * replaced — never from a copy this card has been holding while the owner read
 * a search result, which the panel may have changed underneath it.
 *
 * ONLY EMPTY FIELDS ARE EVER OFFERED. The server decides which those are and
 * refuses to answer about anything else; this card shows the same set so the
 * two cannot disagree about what "missing" means.
 *
 * IT DRAWS NOTHING WHEN THE SHOP HAS NO KEY. `ai_key` unset answers 503
 * `ai_not_configured`, and the card says so in one line instead of offering a
 * button that cannot work — the same shape as Google sign-in.
 */
(function () {
  'use strict'

  var MARK = 'data-sporta-research'
  var API = '/api/admin.php?r='
  var card = null
  var state = { rows: null, slug: '', busy: false, out: null, note: '', accept: {} }

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function call(route, method, body) {
    return fetch(API + route, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json',
                 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (j) {
        return { ok: r.ok, status: r.status, j: j }
      })
    })
  }

  /* The three the server will discuss, and the labels the owner reads. Kept in
     step with RESEARCH_FIELDS in research.php by the rig, not by memory. */
  var FIELDS = [
    ['desc_en', 'Description (English)'],
    ['desc_ar', 'Description (Arabic)'],
    ['category', 'Category']
  ]

  var missingOn = function (row) {
    var out = []
    FIELDS.forEach(function (f) {
      if (String(row[f[0]] == null ? '' : row[f[0]]).trim() === '') out.push(f[0])
    })
    return out
  }

  /* ------------------------------------------------------------------ view */

  function render() {
    if (!card) return
    card.textContent = ''
    card.appendChild(el('h3', 'spr-h', 'Fill in what is missing'))
    card.appendChild(el('p', 'spr-sub',
      'Looks a product up on the web and suggests only the fields that are empty. '
      + 'Nothing is saved until you press Apply.'))

    if (state.rows === null) { card.appendChild(el('p', 'spr-note', 'Loading the catalogue…')); return }

    var gaps = state.rows.filter(function (r) { return missingOn(r).length > 0 })
    if (!gaps.length) {
      card.appendChild(el('p', 'spr-note',
        'Every product has a description in both languages and a category. Nothing to fill in.'))
      return
    }

    var pickRow = el('div', 'spr-row')
    var sel = el('select', 'spr-input')
    sel.setAttribute('aria-label', 'Product')
    var blank = el('option', null, gaps.length + ' product(s) with gaps — choose one')
    blank.value = ''
    sel.appendChild(blank)
    gaps.forEach(function (r) {
      var o = el('option', null, (r.name_en || r.slug) + '  ·  missing ' + missingOn(r).join(', '))
      o.value = r.slug
      if (r.slug === state.slug) o.selected = true
      sel.appendChild(o)
    })
    sel.addEventListener('change', function () {
      state.slug = sel.value; state.out = null; state.note = ''; state.accept = {}
      render()
    })
    pickRow.appendChild(sel)

    var go = el('button', 'spr-go', state.busy ? 'Looking…' : 'Look it up')
    go.type = 'button'
    go.disabled = state.busy || !state.slug
    go.addEventListener('click', look)
    pickRow.appendChild(go)
    card.appendChild(pickRow)

    if (state.note) card.appendChild(el('p', 'spr-note', state.note))
    if (!state.out) return

    var out = state.out
    var got = Object.keys(out.fields || {})

    if (out.policy_warning) card.appendChild(el('p', 'spr-warn', out.policy_warning))
    if (out.notes) card.appendChild(el('p', 'spr-note', out.notes))

    /* A field that was ASKED about and not answered is the model declining to
       guess. Shown, because otherwise it reads as a field nobody wanted — and
       "it found nothing for the Arabic" is a useful thing to know. */
    var quiet = (out.missing || []).filter(function (f) { return got.indexOf(f) === -1 })
    if (quiet.length) {
      card.appendChild(el('p', 'spr-note',
        'Nothing well-sourced was found for: ' + quiet.join(', ') + '. Left empty.'))
    }
    if (!got.length) return

    FIELDS.forEach(function (f) {
      if (got.indexOf(f[0]) === -1) return
      var wrap = el('div', 'spr-field')
      var lab = el('label', 'spr-label')
      var box = el('input', null)
      box.type = 'checkbox'
      box.checked = state.accept[f[0]] !== false
      box.addEventListener('change', function () { state.accept[f[0]] = box.checked })
      lab.appendChild(box)
      lab.appendChild(document.createTextNode(' ' + f[1]))
      wrap.appendChild(lab)
      /* EDITABLE, not a preview. The owner's own wording beats the model's,
         and making them copy it into another screen to change one word is how
         a proposal gets accepted unread. */
      var ta = el('textarea', 'spr-input')
      ta.rows = f[0] === 'category' ? 1 : 4
      ta.value = out.fields[f[0]]
      ta.setAttribute('data-field', f[0])
      if (f[0] === 'desc_ar') ta.setAttribute('dir', 'rtl')
      wrap.appendChild(ta)
      card.appendChild(wrap)
    })

    if (out.sources && out.sources.length) {
      var s = el('div', 'spr-src')
      s.appendChild(el('span', null, 'Sources: '))
      out.sources.forEach(function (src, i) {
        var a = el('a', null, src.title || src.url)
        a.href = src.url
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        s.appendChild(a)
        if (i < out.sources.length - 1) s.appendChild(document.createTextNode(' · '))
      })
      card.appendChild(s)
    }

    var apply = el('button', 'spr-go', state.busy ? 'Saving…' : 'Apply to this product')
    apply.type = 'button'
    apply.disabled = state.busy
    apply.addEventListener('click', applyNow)
    card.appendChild(apply)
  }

  /* ----------------------------------------------------------------- doing */

  function look() {
    if (!state.slug || state.busy) return
    state.busy = true; state.note = ''; state.out = null; render()
    call('product_research', 'POST', { slug: state.slug }).then(function (r) {
      state.busy = false
      if (r.ok && r.j) { state.out = r.j; state.accept = {}; render(); return }
      var e = (r.j && r.j.error) || ''
      state.note =
        e === 'ai_not_configured' ? 'This shop has no AI key yet, so there is nothing to look anything up with.'
        : e === 'research_not_installed' ? 'The server does not have the research file yet.'
        : e === 'ai_no_answer' ? 'It searched and found nothing it could stand behind. Nothing was changed.'
        : e === 'ai_failed' ? 'The lookup failed: ' + ((r.j && r.j.detail) || r.status)
        : e === 'product_not_found' ? 'That product is no longer in the catalogue.'
        : 'That did not work (' + (e || r.status) + ').'
      render()
    })
  }

  function applyNow() {
    if (state.busy) return
    /* Read what is ON SCREEN, not what came back — the owner may have edited
       it, and applying the model's wording over their correction would be the
       silent opposite of asking them to check it. */
    var take = {}
    card.querySelectorAll('textarea[data-field]').forEach(function (ta) {
      var f = ta.getAttribute('data-field')
      if (state.accept[f] === false) return
      var v = ta.value.trim()
      if (v !== '') take[f] = v
    })
    if (!Object.keys(take).length) { state.note = 'Nothing is ticked.'; render(); return }

    state.busy = true; state.note = ''; render()
    var slug = state.slug

    /* RE-READ THE ROW FIRST. product_save writes every column it is given, so
       this has to carry the product as it is RIGHT NOW — not as it was when
       the search started, which may have been a minute and another screen ago. */
    call('products_all').then(function (r) {
      var rows = (r.j && (r.j.rows || r.j)) || []
      var row = null
      for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) row = rows[i]
      if (!row) { state.busy = false; state.note = 'That product is no longer in the catalogue.'; render(); return }

      /* REFUSE IF IT IS NO LONGER EMPTY. Somebody may have typed a description
         into the panel while this card was showing a proposal for it, and
         "missing fields only" has to still be true at the moment of writing,
         not only at the moment of asking. */
      var clash = Object.keys(take).filter(function (f) {
        return String(row[f] == null ? '' : row[f]).trim() !== ''
      })
      if (clash.length) {
        state.busy = false
        state.note = 'Someone filled in ' + clash.join(', ') + ' while this was open. '
          + 'Nothing was changed — look it up again.'
        state.out = null
        render()
        return
      }

      var body = {
        id: row.id, slug: row.slug,
        name_en: row.name_en, name_ar: row.name_ar,
        desc_en: row.desc_en, desc_ar: row.desc_ar,
        price: row.price, sale_price: row.sale_price,
        sale_starts_at: row.sale_starts_at, sale_ends_at: row.sale_ends_at,
        featured: row.featured, featured_sort: row.featured_sort,
        category: row.category, brand_slug: row.brand_slug,
        image: row.image, active: row.active
      }
      Object.keys(take).forEach(function (f) { body[f] = take[f] })

      call('product_save', 'POST', body).then(function (res) {
        state.busy = false
        if (res.ok) {
          state.note = 'Saved: ' + Object.keys(take).join(', ') + '.'
          state.out = null
          state.slug = ''
          load()
          return
        }
        state.note = 'Could not save: ' + ((res.j && res.j.error) || res.status)
        render()
      })
    })
  }

  function load() {
    call('products_all').then(function (r) {
      state.rows = (r.j && (r.j.rows || r.j)) || []
      render()
    })
  }

  /* --------------------------------------------------------- where it lives */

  function catalogueHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Catalogue') return hs[i]
    }
    return null
  }

  var CSS = ''
    + '.spr{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);'
    + 'padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;background:var(--card,rgba(255,255,255,.03))}'
    + '.spr-h{margin:0 0 4px;font-size:16px}'
    + '.spr-sub{margin:0 0 14px;opacity:.7;font-size:13px}'
    + '.spr-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}'
    + '.spr-input{padding:8px 10px;border-radius:8px;border:1px solid var(--border,#2a2d31);'
    + 'background:transparent;color:inherit;font:inherit;width:100%;box-sizing:border-box}'
    + '.spr-row .spr-input{flex:1 1 240px;width:auto}'
    + '.spr-go{padding:10px 16px;min-height:44px;border-radius:8px;border:0;cursor:pointer;'
    + 'background:var(--brand,#e0561c);color:#fff;font:inherit;font-weight:600}'
    + '.spr-go[disabled]{opacity:.5;cursor:default}'
    + '.spr-field{margin-top:14px}'
    + '.spr-label{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-bottom:6px}'
    + '.spr-note{margin:12px 0 0;font-size:13px;line-height:1.5;opacity:.85}'
    + '.spr-warn{margin:12px 0 0;font-size:13px;line-height:1.5;padding:10px 12px;border-radius:8px;'
    + 'background:#2a1f14;border:1px solid #5c4326;color:#ffd7a8}'
    + '.spr-src{margin:14px 0 0;font-size:12px;opacity:.8;line-height:1.6}'
    + '.spr-src a{color:var(--sp-ember,#ff7b17)}'

  function style() {
    if (document.getElementById('spr-css')) return
    var s = el('style')
    s.id = 'spr-css'
    s.textContent = CSS
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
        state = { rows: null, slug: '', busy: false, out: null, note: '', accept: {} }
        return
      }
      if (existing) { card = existing; return }
      style()
      card = el('div', 'spr')
      card.setAttribute(MARK, '1')
      var host = head.parentNode
      if (host && host.parentNode) host.parentNode.insertBefore(card, host.nextSibling)
      else document.body.appendChild(card)
      render()
      load()
    } finally {
      placing = false
    }
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
