/**
 * The website panel's FOOTER card (2026-10-02): the footer's texts and its link columns in one
 * place. An overlay on Settings, like social-setup.js and rules.js — /backends is a prebuilt
 * bundle with no source here, and the session cookie is already present on this origin.
 *
 * Two settings rows, saved by ONE button: `footer` (the ten texts, whole row, so every field is
 * resent) and `footer_links` (the columns). Both are read back from the public routes after a
 * save, so the card shows what the shop kept. Empty everything = the footer's built-in text and
 * columns. The social icons already have their own card; a button here jumps to it.
 */
(function () {
  'use strict'
  var MARK = 'data-sporta-panel'
  var API = '/api/api.php?r=', ADMIN = '/api/admin.php?r='
  var TEXTS = [
    ['tagline', 'Strapline', 300, true], ['club_title', 'Club title', 80, false],
    ['club_text', 'Club text', 200, true], ['rights', 'Rights line', 120, false],
    ['managed', 'Operating company line', 200, true],
  ]
  var card = null, note = null, texts = {}, cols = [], colsBox = null, loadedTexts = null, loadedCols = null

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n }
  function post(route, body) {
    return fetch(ADMIN + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include', body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return { error: 'bad_response' } }) })
  }
  function get(route) { return fetch(API + route, { headers: { Accept: 'application/json' }, credentials: 'include', cache: 'no-store' }).then(function (r) { return r.json() }) }

  function explain(err) {
    var s = String(err || ''), m
    if ((m = /^footer_link_label_(\d+)_(\d+)$/.exec(s))) return 'Column ' + m[1] + ', link ' + m[2] + ' needs a label in English or Arabic.'
    if ((m = /^footer_link_target_(\d+)_(\d+)$/.exec(s))) return 'Column ' + m[1] + ', link ' + m[2] + ' needs an address.'
    if ((m = /^footer_column_title_(\d+)$/.exec(s))) return 'Column ' + m[1] + ' needs a title in English or Arabic.'
    if ((m = /^footer_column_empty_(\d+)$/.exec(s))) return 'Column ' + m[1] + ' has a title but no links. Add a link or remove the column.'
    if (s === 'invalid_footer_link') return 'A link address must be a page on this shop (like /returns or /terms#delivery) or an https:// address.'
    if (s === 'not_signed_in') return 'Your session has ended. Sign in again.'
    return s
  }
  function say(t, good) { if (!note) return; note.textContent = t || ''; note.style.color = t ? (good ? '#15803d' : '#b91c1c') : '' }

  function input(value, ph, dir, max) {
    var i = el('input', 'fed-input'); i.type = 'text'; i.value = value || ''; i.placeholder = ph || ''; i.autocomplete = 'off'
    if (dir) i.setAttribute('dir', dir); if (max) i.maxLength = max
    return i
  }

  function fillTexts(f) {
    TEXTS.forEach(function (t) { ['ar', 'en'].forEach(function (l) { var k = t[0] + '_' + l; if (texts[k]) texts[k].value = f && f[k] ? String(f[k]) : '' }) })
  }
  function textValues() {
    var o = {}
    TEXTS.forEach(function (t) { ['ar', 'en'].forEach(function (l) { var k = t[0] + '_' + l; o[k] = texts[k] ? texts[k].value.trim() : '' }) })
    return o
  }

  function renderCols() {
    colsBox.textContent = ''
    cols.forEach(function (c, ci) {
      var box = el('div', 'fed-col')
      var head = el('div', 'fed-col-head')
      var te = input(c.title_en, 'Column title (English)', 'ltr', 40), ta = input(c.title_ar, 'عنوان العمود (عربي)', 'rtl', 40)
      te.addEventListener('input', function () { c.title_en = te.value }); ta.addEventListener('input', function () { c.title_ar = ta.value })
      head.appendChild(te); head.appendChild(ta)
      box.appendChild(head)
      c.links.forEach(function (l, li) {
        var row = el('div', 'fed-link')
        var le = input(l.label_en, 'Label (English)', 'ltr', 40), la = input(l.label_ar, 'النص (عربي)', 'rtl', 40), hr = input(l.href, '/returns or https://…', 'ltr', 200)
        le.addEventListener('input', function () { l.label_en = le.value }); la.addEventListener('input', function () { l.label_ar = la.value }); hr.addEventListener('input', function () { l.href = hr.value })
        var up = btn('↑', 'Move link up', function () { if (li > 0) { c.links.splice(li - 1, 0, c.links.splice(li, 1)[0]); renderCols() } })
        var dn = btn('↓', 'Move link down', function () { if (li < c.links.length - 1) { c.links.splice(li + 1, 0, c.links.splice(li, 1)[0]); renderCols() } })
        var rm = btn('✕', 'Remove link', function () { c.links.splice(li, 1); renderCols() })
        row.appendChild(le); row.appendChild(la); row.appendChild(hr); row.appendChild(up); row.appendChild(dn); row.appendChild(rm)
        box.appendChild(row)
      })
      var tools = el('div', 'fed-tools')
      if (c.links.length < 8) tools.appendChild(btn('Add link', null, function () { c.links.push({ label_en: '', label_ar: '', href: '' }); renderCols() }, true))
      tools.appendChild(btn('Column up', null, function () { if (ci > 0) { cols.splice(ci - 1, 0, cols.splice(ci, 1)[0]); renderCols() } }, true))
      tools.appendChild(btn('Column down', null, function () { if (ci < cols.length - 1) { cols.splice(ci + 1, 0, cols.splice(ci, 1)[0]); renderCols() } }, true))
      tools.appendChild(btn('Remove column', null, function () { cols.splice(ci, 1); renderCols() }, true))
      box.appendChild(tools)
      colsBox.appendChild(box)
    })
    if (!cols.length) colsBox.appendChild(el('p', 'fed-hint', 'No custom columns: the shop shows its built-in Information and Navigate columns.'))
  }
  function btn(label, aria, fn, wide) {
    var b = el('button', wide ? 'fed-btn' : 'fed-mini', label); b.type = 'button'; if (aria) b.setAttribute('aria-label', aria)
    b.addEventListener('click', fn); return b
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)) }

  function load(quiet) {
    Promise.all([get('footer'), get('footer_links')]).then(function (r) {
      loadedTexts = r[0] || {}; loadedCols = (r[1] && r[1].columns) || []
      fillTexts(loadedTexts); cols = clone(loadedCols); renderCols()
      if (!quiet) say('', true)
    }).catch(function () { if (!quiet) say('Could not read the current footer.', false) })
  }

  function save(b) {
    say('Saving…', true); b.disabled = true
    post('settings_save', { name: 'footer', value: textValues() }).then(function (res) {
      if (res && res.error) throw res
      return post('settings_save', { name: 'footer_links', value: { columns: cols } })
    }).then(function (res) {
      b.disabled = false
      if (res && res.error) { say(explain(res.error), false); return }
      load(true); say('Saved. The footer updates on the next page load.', true)
    }).catch(function (e) { b.disabled = false; say(e && e.error ? explain(e.error) : 'The save did not reach the shop. Check the connection and try again.', false) })
  }

  var CSS = ''
    + '.fed{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;background:var(--sp-pc-bg,#2d3034);color:var(--sp-pc-ink,#eaecee)}'
    + '.fed-sum{cursor:pointer;min-height:44px;display:flex;align-items:center;font-size:16px;font-weight:700}.fed[open] .fed-sum{margin-bottom:6px}.fed-h3{margin:18px 0 8px;font-size:14px;font-weight:700}'
    + '.fed-sub,.fed-hint{margin:0 0 12px;color:var(--sp-pc-muted,#a6adb5);font-size:13px;line-height:1.5}'
    + '.fed-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-bottom:10px}'
    + '.fed-label{font-size:13px;font-weight:600;margin-bottom:4px;display:block}'
    + '.fed-input{width:100%;box-sizing:border-box;padding:8px 10px;min-height:40px;border-radius:8px;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee);font:inherit}'
    + '.fed-col{border:1px solid var(--sp-pc-border,#494e54);border-radius:10px;padding:12px;margin-bottom:12px}'
    + '.fed-col-head,.fed-link{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr)) auto auto auto;gap:8px;margin-bottom:8px;align-items:center}'
    + '.fed-col-head{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}'
    + '.fed-tools,.fed-foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.fed-foot{margin-top:18px}'
    + '.fed-btn,.fed-mini{min-height:44px;padding:8px 14px;border-radius:8px;cursor:pointer;font:inherit;border:1px solid var(--sp-pc-field-border,#565c63);background:var(--sp-pc-field-bg,#24272a);color:var(--sp-pc-ink,#eaecee)}'
    + '.fed-mini{min-width:44px;padding:8px}.fed-save{min-height:44px;padding:9px 16px;border-radius:8px;border:0;cursor:pointer;background:#4f46e5;color:#fff;font:inherit;font-weight:700}'
    + '.fed-save[disabled]{opacity:.5;cursor:default}.fed-note{margin:0;font-size:13px;line-height:1.5}'
  function style() { if (document.getElementById('fed-css')) return; var s = el('style'); s.id = 'fed-css'; s.textContent = CSS; document.head.appendChild(s) }

  function build() {
    var c = el('details', 'fed'); c.setAttribute(MARK, 'footer')
    // Collapsed: Settings is held to a word cap (test:panel-cards) and a closed <details> is not
    // rendered text, so the card costs one word until the owner opens it.
    var sum = el('summary', 'fed-sum', 'Footer'); c.appendChild(sum)
    c.appendChild(el('p', 'fed-sub', 'The footer texts and link columns. Leave everything empty to keep the built-in footer.'))
    texts = {}
    TEXTS.forEach(function (t) {
      var row = el('div', 'fed-row')
      ;[['ar', 'Arabic', 'rtl'], ['en', 'English', 'ltr']].forEach(function (l) {
        var w = el('div'); var id = 'fed-' + t[0] + '-' + l[0]
        var lab = el('label', 'fed-label', t[1] + ' — ' + l[1]); lab.htmlFor = id
        var i = input('', '', l[2], t[2]); i.id = id; texts[t[0] + '_' + l[0]] = i
        w.appendChild(lab); w.appendChild(i); row.appendChild(w)
      })
      c.appendChild(row)
    })
    c.appendChild(el('p', 'fed-h3', 'Link columns'))
    c.appendChild(el('p', 'fed-sub', 'Up to 4 columns of 8 links. A link goes to a page on this shop (/returns, /terms#delivery) or an https:// address.'))
    colsBox = el('div'); c.appendChild(colsBox)
    var add = btn('Add column', null, function () { if (cols.length < 4) { cols.push({ title_en: '', title_ar: '', links: [{ label_en: '', label_ar: '', href: '' }] }); renderCols() } }, true)
    c.appendChild(add)
    var foot = el('div', 'fed-foot')
    var save1 = el('button', 'fed-save', 'Save footer'); save1.type = 'button'; save1.addEventListener('click', function () { save(save1) })
    var undo = btn('Undo my edits', null, function () { if (loadedTexts) { fillTexts(loadedTexts); cols = clone(loadedCols); renderCols(); say('Back to what is saved.', true) } }, true)
    var soc = btn('Social icons ↓', null, function () { var s = document.querySelector('[' + MARK + '="social"]'); if (s) s.scrollIntoView({ block: 'start' }) }, true)
    note = el('p', 'fed-note'); foot.appendChild(save1); foot.appendChild(undo); foot.appendChild(soc); foot.appendChild(note)
    c.appendChild(foot)
    return c
  }

  function settingsHeading() { var hs = document.querySelectorAll('h1, h2'); for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim() === 'Settings') return hs[i]; return null }
  var busy = false
  function place() {
    if (busy || !/^\/backends(\/|$)/.test(location.pathname)) return
    var head = settingsHeading()
    if (!head) { if (card && card.parentNode) { busy = true; card.parentNode.removeChild(card); card = null; busy = false } return }
    busy = true
    if (!card || !card.parentNode) {
      style(); card = build()
      var anchor = document.querySelector('[' + MARK + '="social"]') || head.parentNode
      anchor.parentNode.insertBefore(card, anchor.nextSibling)
      load(false)
    }
    busy = false
  }
  var timer = null
  new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(place, 120) }).observe(document.body, { childList: true, subtree: true })
  place()
})()
