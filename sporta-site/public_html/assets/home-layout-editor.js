/**
 * "Menu & sections" — the home page's shape, edited from the panel (2026-10-04, "make all website
 * full dynamic to edit at backend"). A card on the Home slides screen, above the product banner
 * editor (the page's own order: menu, hero, banner, categories, features, best sellers).
 *
 * Three parts, ONE Save, one settings row (`home_layout`, validated by store_home_layout_validate):
 *   Menu bar      up to 8 links: label in each language + a page on this shop (a picker of the
 *                 known pages, or a typed /path). Empty list = the built-in five.
 *   Sections      the five home sections in order, each with an on/off switch, Move up / down.
 *   Features      the title, up to 6 rows (icon + text per language), and whether the band picture
 *                 is drawn. Empty rows = the built-in two.
 *
 * It sends the WHOLE row on every save (the brand_save rule). A refusal names its row by number and
 * leaves what was typed on screen. Reset = save three empty lists.
 */
(function () {
  'use strict'
  if (!/^\/backends(\/|$)/.test(location.pathname)) return

  var ADMIN = '/api/admin.php?r=', MARK = 'data-sporta-home-layout'
  var card = null, state = null, note = null
  var PAGES = [['/', 'Home'], ['/shop', 'All products'], ['/men', 'Men'], ['/women', 'Women'], ['/accessories', 'Accessories'], ['/outlet', 'Outlet'],
    ['/about', 'About'], ['/contact', 'Contact'], ['/returns', 'Returns'], ['/track', 'Track order'], ['/card', 'Loyalty card']]
  var SECTIONS = { hero: 'Hero slides', banner: 'Product banner', categories: 'Shop by category', features: 'Sporta features', bestsellers: 'Best sellers' }
  var ICONS = ['returns', 'delivery', 'payment', 'shield', 'star', 'truck', 'chat', 'gift']
  var WHY = {
    menu_label: 'Menu link #N needs a label in at least one language.', menu_target: 'Menu link #N needs a page on this shop (a path starting with /).',
    unknown_section: 'Unknown section.', feature_icon: 'Feature row #N: pick an icon from the list.',
    not_signed_in: 'Your session has ended. Sign in again.', network: 'The save did not reach the shop.',
  }
  function why(e) { e = String(e || ''); var m = e.match(/^(menu_label|menu_target|feature_icon)_(\d+)$/); if (m) return WHY[m[1]].replace('#N', '#' + m[2]); return WHY[e] || e }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function call(route, body) {
    return fetch(ADMIN + route, { method: body ? 'POST' : 'GET', headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' }, credentials: 'include', body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return null }) }).catch(function () { return { error: 'network' } })
  }
  function say(t, good) { if (note) { note.textContent = t || ''; note.style.color = t ? (good ? '#16a34a' : '#dc2626') : '' } }

  var CSS = ''
    + '.hle{border:1px solid var(--sp-pc-border,#494e54);border-radius:1rem;padding:1.25rem;margin:1rem 0;background:var(--sp-pc-bg,transparent)}'
    + '.hle h2{margin:0 0 4px;font-size:16px;font-weight:700}.hle h3{margin:14px 0 6px;font-size:14px;font-weight:700}'
    + '.hle-sub{margin:0 0 10px;font-size:13px;opacity:.8;line-height:1.5}'
    + '.hle-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 0;border-top:1px solid rgba(128,128,128,.2)}'
    + '.hle-in,.hle-sel{min-height:40px;padding:6px 10px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font:inherit;flex:1 1 140px;min-width:0}'
    + '.hle-sel{flex:0 1 170px}.hle-n{flex:0 0 22px;font-size:12px;opacity:.7}'
    + '.hle-btn{min-height:44px;padding:8px 14px;border-radius:8px;border:0;cursor:pointer;background:#4f46e5;color:#fff;font:inherit;font-weight:700}'
    + '.hle-btn2{min-height:40px;min-width:40px;padding:6px 10px;border-radius:8px;cursor:pointer;font:inherit;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee)}'
    + '.hle-btn[disabled]{opacity:.5}.hle-chk{display:flex;align-items:center;gap:8px;min-height:40px;font-size:14px}.hle-chk input{width:20px;height:20px}'
    + '.hle-foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:14px}.hle-note{margin:0;font-size:13px}'
  function style() { if (document.getElementById('hle-css')) return; var s = el('style'); s.id = 'hle-css'; s.textContent = CSS; document.head.appendChild(s) }

  function fresh() { return { menu: [], sections: [], features: { title_en: '', title_ar: '', rows: [], picture: true } } }
  function normalise(v) {
    var s = fresh()
    if (v && Array.isArray(v.menu)) s.menu = v.menu.map(function (m) { return { label_en: m.label_en || '', label_ar: m.label_ar || '', href: m.href || '' } })
    if (v && Array.isArray(v.sections) && v.sections.length) s.sections = v.sections.map(function (x) { return { key: x.key, on: x.on !== false } })
    else s.sections = Object.keys(SECTIONS).map(function (k) { return { key: k, on: true } })
    if (v && v.features && typeof v.features === 'object') {
      s.features.title_en = v.features.title_en || ''; s.features.title_ar = v.features.title_ar || ''
      s.features.picture = v.features.picture !== false
      s.features.rows = Array.isArray(v.features.rows) ? v.features.rows.map(function (r) { return { icon: r.icon || 'star', text_en: r.text_en || '', text_ar: r.text_ar || '' } }) : []
    }
    return s
  }
  function input(parent, value, ph, dir, onchange) { var i = el('input', 'hle-in'); i.type = 'text'; i.value = value || ''; i.placeholder = ph; if (dir) i.dir = dir; i.addEventListener('input', function () { onchange(i.value) }); parent.appendChild(i); return i }
  function btn2(parent, text, label, fn) { var b = el('button', 'hle-btn2', text); b.type = 'button'; b.setAttribute('aria-label', label); b.addEventListener('click', fn); parent.appendChild(b); return b }

  function render() {
    card.textContent = ''
    card.appendChild(el('h2', null, 'Menu & sections'))
    card.appendChild(el('p', 'hle-sub', 'The menu bar links, the order of the home page, and the Sporta features rows. Leave a list empty to keep the built-in one.'))
    // ---- menu
    card.appendChild(el('h3', null, 'Menu bar'))
    var menuBox = el('div'); menuBox.setAttribute('data-hle-menu', '1'); card.appendChild(menuBox)
    state.menu.forEach(function (m, i) {
      var row = el('div', 'hle-row'); row.appendChild(el('span', 'hle-n', String(i + 1)))
      input(row, m.label_en, 'Label (English)', 'ltr', function (v) { m.label_en = v })
      input(row, m.label_ar, 'التسمية (عربي)', 'rtl', function (v) { m.label_ar = v })
      var sel = el('select', 'hle-sel'); var custom = true
      PAGES.forEach(function (p) { var o = el('option', null, p[1] + ' (' + p[0] + ')'); o.value = p[0]; if (p[0] === m.href) { o.selected = true; custom = false } sel.appendChild(o) })
      var oc = el('option', null, 'Other path…'); oc.value = '__other'; if (custom) oc.selected = true; sel.appendChild(oc)
      var path = input(row, custom ? m.href : '', '/path on this shop', 'ltr', function (v) { m.href = v })
      path.style.display = custom ? '' : 'none'
      sel.addEventListener('change', function () { if (sel.value === '__other') { path.style.display = ''; m.href = path.value } else { path.style.display = 'none'; m.href = sel.value } })
      row.appendChild(sel); row.appendChild(path)
      btn2(row, '↑', 'Move link ' + (i + 1) + ' up', function () { if (i > 0) { state.menu.splice(i - 1, 2, state.menu[i], state.menu[i - 1]); render() } })
      btn2(row, '↓', 'Move link ' + (i + 1) + ' down', function () { if (i < state.menu.length - 1) { state.menu.splice(i, 2, state.menu[i + 1], state.menu[i]); render() } })
      btn2(row, '✕', 'Remove link ' + (i + 1), function () { state.menu.splice(i, 1); render() })
      menuBox.appendChild(row)
    })
    var addM = el('button', 'hle-btn2', state.menu.length ? '+ Add link' : '+ Replace the built-in menu'); addM.type = 'button'
    addM.disabled = state.menu.length >= 8
    addM.addEventListener('click', function () { state.menu.push({ label_en: '', label_ar: '', href: '/shop' }); render() })
    card.appendChild(addM)
    // ---- sections
    card.appendChild(el('h3', null, 'Home page sections (top to bottom)'))
    var secBox = el('div'); secBox.setAttribute('data-hle-sections', '1'); card.appendChild(secBox)
    state.sections.forEach(function (s, i) {
      var row = el('div', 'hle-row'); row.setAttribute('data-key', s.key); row.appendChild(el('span', 'hle-n', String(i + 1)))
      var lab = el('label', 'hle-chk'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = s.on; cb.addEventListener('change', function () { s.on = cb.checked })
      lab.appendChild(cb); lab.appendChild(el('span', null, SECTIONS[s.key] || s.key)); lab.style.flex = '1 1 200px'; row.appendChild(lab)
      btn2(row, '↑', 'Move ' + SECTIONS[s.key] + ' up', function () { if (i > 0) { state.sections.splice(i - 1, 2, state.sections[i], state.sections[i - 1]); render() } })
      btn2(row, '↓', 'Move ' + SECTIONS[s.key] + ' down', function () { if (i < state.sections.length - 1) { state.sections.splice(i, 2, state.sections[i + 1], state.sections[i]); render() } })
      secBox.appendChild(row)
    })
    // ---- features
    card.appendChild(el('h3', null, 'Sporta features'))
    var tRow = el('div', 'hle-row')
    input(tRow, state.features.title_en, 'Title (English) — empty = "Sporta features"', 'ltr', function (v) { state.features.title_en = v })
    input(tRow, state.features.title_ar, 'العنوان (عربي)', 'rtl', function (v) { state.features.title_ar = v })
    card.appendChild(tRow)
    var pic = el('label', 'hle-chk'); var pcb = el('input'); pcb.type = 'checkbox'; pcb.checked = state.features.picture; pcb.setAttribute('data-hle-picture', '1')
    pcb.addEventListener('change', function () { state.features.picture = pcb.checked }); pic.appendChild(pcb); pic.appendChild(el('span', null, 'Show the band picture behind the rows')); card.appendChild(pic)
    var fBox = el('div'); fBox.setAttribute('data-hle-features', '1'); card.appendChild(fBox)
    state.features.rows.forEach(function (r, i) {
      var row = el('div', 'hle-row'); row.appendChild(el('span', 'hle-n', String(i + 1)))
      var sel = el('select', 'hle-sel'); ICONS.forEach(function (ic) { var o = el('option', null, ic); o.value = ic; if (ic === r.icon) o.selected = true; sel.appendChild(o) })
      sel.addEventListener('change', function () { r.icon = sel.value }); row.appendChild(sel)
      input(row, r.text_en, 'Text (English)', 'ltr', function (v) { r.text_en = v })
      input(row, r.text_ar, 'النص (عربي)', 'rtl', function (v) { r.text_ar = v })
      btn2(row, '✕', 'Remove feature row ' + (i + 1), function () { state.features.rows.splice(i, 1); render() })
      fBox.appendChild(row)
    })
    var addF = el('button', 'hle-btn2', state.features.rows.length ? '+ Add row' : '+ Replace the built-in rows'); addF.type = 'button'; addF.disabled = state.features.rows.length >= 6
    addF.addEventListener('click', function () { state.features.rows.push({ icon: 'star', text_en: '', text_ar: '' }); render() })
    card.appendChild(addF)
    // ---- foot
    var foot = el('div', 'hle-foot')
    var save = el('button', 'hle-btn', 'Save menu & sections'); save.type = 'button'
    save.addEventListener('click', function () {
      save.disabled = true; say('Saving…', true)
      call('settings_save', { name: 'home_layout', value: { menu: state.menu, sections: state.sections, features: state.features } }).then(function (r) {
        save.disabled = false
        if (!r || r.error) { say(why(r && r.error), false); return }
        state = normalise(r); render(); say('Saved. The shop shows it on its next load.', true)
      })
    })
    var reset = el('button', 'hle-btn2', 'Back to the built-in layout'); reset.type = 'button'
    reset.addEventListener('click', function () {
      call('settings_save', { name: 'home_layout', value: { menu: [], sections: [], features: {} } }).then(function (r) {
        if (!r || r.error) { say(why(r && r.error), false); return }
        state = normalise(r); render(); say('The built-in menu, order and rows are back.', true)
      })
    })
    foot.appendChild(save); foot.appendChild(reset); note = el('p', 'hle-note'); foot.appendChild(note); card.appendChild(foot)
  }

  function load() {
    // The row is public (?r=slides carries it for the storefront), so the card reads it there;
    // writing goes through the gate (settings_save). Read fresh, never from a cache.
    fetch('/api/api.php?r=slides', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (d) { state = normalise(d && d.layout ? d.layout : null); render() })
      .catch(function () { state = normalise(null); render() })
  }

  // ---- mounting, like home-banner-editor.js: on the Home slides screen, above the banner editor
  function slidesHeading() { var hs = document.querySelectorAll('.admin-content h1'); for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim() === 'Home slides') return hs[i]; return null }
  function screenOf(head) { var host = document.querySelector('.admin-content'); var n = head; while (n && n.parentNode !== host) n = n.parentNode; return n }
  var mounting = false
  function place() {
    if (mounting) return
    var head = slidesHeading()
    if (!head) { if (card && card.parentNode) { mounting = true; card.parentNode.removeChild(card); card = null; mounting = false } return }
    var screen = screenOf(head); if (!screen) return
    var next = screen.querySelector('[data-sporta-home-banner-editor], [data-sporta-category-art]')
    if (card && card.parentNode === screen) { if (next && card.nextElementSibling !== next && next !== card) { mounting = true; screen.insertBefore(card, next); mounting = false } return }
    mounting = true; style()
    card = el('section', 'hle'); card.setAttribute(MARK, '1')
    if (next) screen.insertBefore(card, next); else screen.appendChild(card)
    mounting = false
    state = fresh(); render(); load()
  }
  var timer = null
  new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(place, 150) }).observe(document.body, { childList: true, subtree: true })
  place()
})()
