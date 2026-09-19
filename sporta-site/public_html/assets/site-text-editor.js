/**
 * Every word the shop can say, editable — the panel half.
 *
 * WHAT IT EDITS. The storefront's vocabulary is one object compiled into the
 * bundle: ~420 strings per language, 40 groups, every heading, button, empty
 * state and error message on the site. It is module-local and unreachable at
 * runtime, so scripts/extract-site-strings.mjs reads it out of the bundle file
 * statically and writes assets/site-strings.json. That catalogue is what this
 * card offers; assets/site-text.js is what applies the result.
 *
 * SEARCH FIRST, AND NOTHING LISTED UNTIL YOU ASK. Four hundred rows is not a
 * list anybody reads, and panel-cards-test.mjs caps the prose on this screen
 * for exactly that kind of reason — it has been trimmed twice already. So the
 * card is a search box until it is used, and a handful of rows after that.
 *
 * IT SENDS THE WHOLE ROW. admin.php rebuilds `site_text` from what arrives, so
 * a save carrying only what is on screen would erase every override not
 * currently matching the search — and the search is how you get anything on
 * screen. What was saved before is merged under what has been typed since.
 *
 * TYPED VALUES SURVIVE A SEARCH. The rows are re-rendered on every keystroke
 * in the search box, so anything typed into them has to live somewhere other
 * than the DOM or it would vanish the moment the list changed. `drafts` is
 * that place. Two cards in this directory shipped the DOM-is-the-state version
 * of this mistake and lost the owner's work on a refusal; here the list
 * changes far more often than a refusal ever would.
 *
 * BOTH LANGUAGES ARE ALWAYS SHOWN. The shop switches language without
 * reloading and re-renders from its own dictionary, so an override recorded
 * for one language alone applies half the time — which looks, to whoever made
 * it, exactly like it worked.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var card = null
  var catalogue = null      /* {key: {en, ar, fixed?}} — every string the site can say */
  var saved = {}            /* {key: {en:[from,to], ar:[from,to]}} — what is live */
  var drafts = {}           /* {key: {en, ar}} — what has been typed since loading */
  var query = ''
  var note = ''
  var busy = false

  var MAX_ROWS = 30

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function ask(route, body) {
    return fetch(API + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Sporta-Admin': '1', 'Content-Type': 'application/json' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return { error: 'bad_response' } })
    })
  }

  /** What this box should show: what has been typed, else what is saved, else
   *  what the site says today. */
  function current(key, lang) {
    if (drafts[key] && typeof drafts[key][lang] === 'string') return drafts[key][lang]
    var s = saved[key] && saved[key][lang]
    if (s && s.length === 2) return s[1]
    return (catalogue[key] && catalogue[key][lang]) || ''
  }

  function matches(key) {
    if (!query) return false
    var s = catalogue[key]
    var hay = (key + ' ' + (s.en || '') + ' ' + (s.ar || '')).toLowerCase()
    // Every word has to appear somewhere, in any order: "delivery fast" finds
    // the same line as "fast delivery".
    var words = query.toLowerCase().split(/\s+/).filter(Boolean)
    for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false
    return true
  }

  function changedCount() {
    var n = 0
    for (var k in catalogue) {
      if (!Object.prototype.hasOwnProperty.call(catalogue, k)) continue
      if (catalogue[k].fixed) continue
      for (var i = 0; i < 2; i++) {
        var lang = i === 0 ? 'en' : 'ar'
        if (current(k, lang) !== catalogue[k][lang]) n++
      }
    }
    return n
  }

  function say(text, bad) {
    note = text
    var n = card && card.querySelector('.stx-note')
    if (n) { n.textContent = text; n.className = 'stx-note' + (bad ? ' stx-bad' : '') }
  }

  function row(key) {
    var s = catalogue[key]
    var wrap = el('div', 'stx-row')
    wrap.appendChild(el('div', 'stx-key', key))

    if (s.fixed) {
      // LISTED, NOT HIDDEN. Someone searching for text they can see on the
      // screen should be told why it is not editable rather than left to
      // decide the editor is missing things.
      wrap.appendChild(el('div', 'stx-fixed', (s.en || '(worked out on the page)') + ' — ' + s.fixed))
      return wrap
    }

    ;['en', 'ar'].forEach(function (lang) {
      var line = el('div', 'stx-line')
      line.appendChild(el('span', 'stx-lang', lang.toUpperCase()))

      var i = document.createElement('input')
      i.type = 'text'
      i.className = 'stx-in'
      i.value = current(key, lang)
      i.dir = lang === 'ar' ? 'rtl' : 'ltr'
      i.spellcheck = false
      i.setAttribute('aria-label', key + ' in ' + (lang === 'ar' ? 'Arabic' : 'English'))
      i.oninput = function () {
        if (!drafts[key]) drafts[key] = {}
        drafts[key][lang] = i.value
        var badge = wrap.querySelector('.stx-changed')
        if (badge) badge.hidden = i.value === s[lang]
        say('')
      }
      line.appendChild(i)

      var undo = el('button', 'stx-undo', 'original')
      undo.type = 'button'
      undo.title = s[lang]
      undo.setAttribute('aria-label', 'Put back the original ' + lang.toUpperCase() + ' wording for ' + key)
      undo.onclick = function () {
        if (!drafts[key]) drafts[key] = {}
        drafts[key][lang] = s[lang]
        i.value = s[lang]
        say('')
      }
      line.appendChild(undo)

      wrap.appendChild(line)
    })

    var changed = el('span', 'stx-changed', 'changed')
    changed.hidden = current(key, 'en') === s.en && current(key, 'ar') === s.ar
    wrap.appendChild(changed)
    return wrap
  }

  function renderRows() {
    var host = card.querySelector('.stx-rows')
    if (!host) return
    host.textContent = ''

    if (!query) {
      host.appendChild(el('p', 'stx-hint',
        'Type a word above to find the line you want — in English or Arabic.'))
      return
    }

    var keys = []
    for (var k in catalogue) {
      if (Object.prototype.hasOwnProperty.call(catalogue, k) && matches(k)) keys.push(k)
    }
    keys.sort()

    if (!keys.length) {
      host.appendChild(el('p', 'stx-hint', 'Nothing on the shop says that.'))
      return
    }

    keys.slice(0, MAX_ROWS).forEach(function (key) { host.appendChild(row(key)) })
    if (keys.length > MAX_ROWS) {
      host.appendChild(el('p', 'stx-hint',
        keys.length + ' lines match — showing the first ' + MAX_ROWS + '. Add another word to narrow it.'))
    }
  }

  function submit() {
    if (busy || !catalogue) return
    var save = card.querySelector('.stx-save')

    /* EVERYTHING, not just what is on screen. The row is replaced wholesale by
       the server, and the search means most overrides are not rendered at any
       given moment. Start from what is saved, lay the drafts over it, and drop
       anything that has come back to what the site already says. */
    var out = {}
    for (var k in catalogue) {
      if (!Object.prototype.hasOwnProperty.call(catalogue, k)) continue
      var s = catalogue[k]
      if (s.fixed) continue
      var entry = {}
      for (var i = 0; i < 2; i++) {
        var lang = i === 0 ? 'en' : 'ar'
        var now = current(k, lang)
        if (now && now !== s[lang]) entry[lang] = [s[lang], now]
      }
      if (entry.en || entry.ar) out[k] = entry
    }

    busy = true
    save.disabled = true
    save.textContent = 'Saving…'
    say('')

    ask('settings_save', { name: 'site_text', value: out }).then(function (res) {
      busy = false
      save.disabled = false
      save.textContent = 'Save wording'
      if (res && res.error) {
        // Nothing is re-rendered: the boxes keep what was typed.
        say(explain(res.error), true)
        return
      }
      saved = res && typeof res === 'object' && !Array.isArray(res) ? res : {}
      drafts = {}
      var n = 0
      for (var k2 in saved) if (Object.prototype.hasOwnProperty.call(saved, k2)) n++
      say(n === 0
        ? 'Saved. The shop is back to its own wording.'
        : 'Saved. ' + n + (n === 1 ? ' line is' : ' lines are') + ' now yours — reload the shop to see it.')
      renderRows()
      count()
    }).catch(function () {
      busy = false
      save.disabled = false
      save.textContent = 'Save wording'
      say('The save did not reach the shop. Nothing was changed — press Save again.', true)
    })
  }

  function explain(err) {
    var s = String(err || '')
    if (s === 'not_signed_in') return 'Your session has ended. Sign in again.'
    if (s === 'invalid_site_text_too_large') return 'That is more rewritten text than the shop will store. Put some lines back to their original.'
    if (s === 'invalid_site_text_too_many') return 'Too many lines have been changed at once.'
    if (s.indexOf('_too_long') > 0) return 'One of those lines is longer than the shop will store — keep it under 600 characters.'
    if (s.indexOf('_has_markup') > 0) return 'One of those lines contains "</", which the shop will not store.'
    return s
  }

  function count() {
    var c = card && card.querySelector('.stx-count')
    if (!c || !catalogue) return
    var n = changedCount()
    c.textContent = n === 0
      ? 'Nothing changed yet.'
      : n + (n === 1 ? ' line differs' : ' lines differ') + ' from the shop’s own wording.'
  }

  function build() {
    card.textContent = ''
    card.appendChild(el('h3', 'stx-h', 'Site wording'))
    card.appendChild(el('p', 'stx-sub', 'Search the shop’s own words and rewrite any of them.'))

    var box = document.createElement('input')
    box.type = 'search'
    box.className = 'stx-search'
    box.placeholder = 'delivery, returns, bag…'
    box.setAttribute('aria-label', 'Search the shop’s wording')
    box.oninput = function () { query = box.value.trim(); renderRows() }
    card.appendChild(box)

    card.appendChild(el('p', 'stx-count', ''))
    card.appendChild(el('div', 'stx-rows'))

    var foot = el('div', 'stx-foot')
    var save = el('button', 'stx-save', 'Save wording')
    save.type = 'button'
    save.addEventListener('click', submit)
    foot.appendChild(save)
    card.appendChild(foot)
    card.appendChild(el('p', 'stx-note', ''))
  }

  function load() {
    /* The catalogue is a static file beside the bundle it was read from, so it
       caches like one and costs nothing after the first visit. It is fetched
       ONLY here — the storefront never sees it. */
    Promise.all([
      fetch('/assets/site-strings.json', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null }),
      fetch('/api/api.php?r=site_text', { credentials: 'omit' })
        .then(function (r) { return r.ok ? r.json() : null }),
    ]).then(function (both) {
      var cat = both[0]
      if (!cat || !cat.strings) {
        say('Could not read the list of the shop’s words. Saving is off so nothing is overwritten.', true)
        var s = card.querySelector('.stx-save')
        if (s) s.disabled = true
        return
      }
      catalogue = cat.strings
      saved = both[1] && typeof both[1] === 'object' && !Array.isArray(both[1]) ? both[1] : {}
      count()
      renderRows()
    }).catch(function () {
      say('Could not read the shop’s words. Saving is off so nothing is overwritten.', true)
      var s = card.querySelector('.stx-save')
      if (s) s.disabled = true
    })
  }

  function settingsHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Settings') return hs[i]
    }
    return null
  }

  var CSS = ''
    + '.stx{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;'
    + 'background:var(--card,rgba(255,255,255,.03))}'
    + '.stx-h{margin:0 0 4px;font-size:16px}'
    + '.stx-sub{margin:0 0 12px;opacity:.7;font-size:13px}'
    /* 16px, or mobile Safari zooms the page when it takes focus. */
    + '.stx-search{width:100%;max-width:340px;min-height:44px;padding:8px 12px;border-radius:8px;font-size:16px;'
    + 'border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font-family:inherit}'
    + '.stx-count{margin:10px 0 0;font-size:12.5px;opacity:.7}'
    + '.stx-rows{margin-top:10px}'
    + '.stx-hint{margin:10px 0;font-size:13px;opacity:.7}'
    + '.stx-row{position:relative;padding:10px 0;border-top:1px solid var(--border,#2a2d31)}'
    + '.stx-key{font-family:ui-monospace,monospace;font-size:11.5px;opacity:.6;margin-bottom:6px}'
    + '.stx-line{display:flex;gap:8px;align-items:center;margin-bottom:6px}'
    + '.stx-lang{width:22px;flex:none;font-size:11px;font-weight:700;opacity:.6}'
    + '.stx-in{flex:1 1 auto;min-width:0;min-height:44px;padding:8px 10px;border-radius:8px;font-size:16px;'
    + 'border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font-family:inherit}'
    + '.stx-undo{flex:none;min-height:44px;padding:0 10px;border-radius:8px;cursor:pointer;font:inherit;font-size:12px;'
    + 'border:1px dashed var(--border,#2a2d31);background:transparent;color:inherit;opacity:.8}'
    + '.stx-fixed{font-size:12.5px;opacity:.65;line-height:1.5}'
    + '.stx-changed{position:absolute;top:10px;inset-inline-end:0;font-size:11px;opacity:.8;'
    + 'border:1px solid var(--brand,#e0561c);border-radius:999px;padding:1px 8px}'
    + '.stx-foot{display:flex;gap:10px;margin-top:16px}'
    + '.stx-save{min-height:44px;padding:9px 16px;border-radius:8px;border:0;cursor:pointer;'
    + 'background:var(--brand,#e0561c);color:#fff;font:inherit;font-weight:600}'
    + '.stx-save[disabled]{opacity:.5;cursor:default}'
    + '.stx-note{margin:12px 0 0;font-size:13px;line-height:1.5}'
    + '.stx-bad{color:#ff8a80}'

  function style() {
    if (document.getElementById('stx-css')) return
    var s = document.createElement('style')
    s.id = 'stx-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  var placing = false
  function place() {
    if (placing) return
    var head = settingsHeading()

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
    card = el('div', 'stx')
    var anchor = head.parentNode
    anchor.parentNode.insertBefore(card, anchor.nextSibling)
    placing = false

    catalogue = null
    saved = {}
    drafts = {}
    query = ''
    note = ''
    busy = false
    build()
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
