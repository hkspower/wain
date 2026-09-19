/**
 * The shop's colours, from the WEBSITE's /backends panel.
 *
 * WHY THIS EXISTS AT ALL. The theme editor has only ever been in the APP's
 * panel — eight fields inside src/app/backends/settings.tsx — and the website's
 * /backends had no theme card of any kind. Measured 2026-09-19: the panel
 * bundle contains no reference to `accent_text_light`, `font_head` or any other
 * theme key. So "the colours are in /backends" was true of a panel the owner
 * does not open in a browser. CLAUDE.md records four features that began
 * app-only before this one; this is the same gap, found from the other side.
 *
 * FIVE COLOURS, NOT THE WHOLE THEME. The app's card keeps the fonts, the radius,
 * the spacing base and the custom CSS. This one is the colours of the buttons
 * and the bars, which is what was asked for — and it deliberately does NOT
 * duplicate the rest, because two editors for one value is how the two panels
 * start disagreeing.
 *
 * IT MUST SEND THE WHOLE ROW, AND THIS IS THE TRAP. admin.php's theme branch
 * rebuilds every one of its twelve fields from the request and stores the
 * result — so a save carrying only the five colours would blank the fonts, the
 * radius, the spacing and the owner's custom CSS. The row read at load is kept
 * and merged under every save. Same shape as brand_save, which CLAUDE.md
 * records having to resend a brand's name to avoid erasing it while uploading
 * a logo.
 *
 * THE INPUTS ARE THE STATE. The card is built once and never re-rendered; a
 * save updates the message and the contrast figures in place. That is on
 * purpose — the two cards in this directory that rebuild themselves from state
 * both had the same bug, where a refused save wiped everything the owner had
 * typed underneath the message explaining why. A form that is never rebuilt
 * cannot lose an edit.
 *
 * IT NEEDS NO CREDENTIAL OF ITS OWN: it runs on the shop's origin inside the
 * panel, so the session cookie is already there.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var card = null
  /* The whole theme row as last read. Every save is built on top of it. */
  var loaded = null
  var busySave = false

  var FIELDS = [
    {
      key: 'brand', label: 'Brand', shipped: '#e0561c', on: '#ffffff',
      hint: 'Every primary button, chip and badge. Forty-eight compiled rules follow it.',
      presets: ['#e0561c', '#b8430f', '#1f6feb', '#2f6f4e'],
    },
    {
      key: 'header_bg', label: 'Header bar', shipped: '#2b2b2b', on: '#ffffff',
      hint: 'The strip along the top of every page. White text sits on it.',
      presets: ['#2b2b2b', '#14161a', '#363d45', '#e0561c'],
    },
    {
      key: 'tabbar_bg', label: 'Tab bar', shipped: '#ffffff', onKey: 'tabbar_active',
      hint: 'The bar along the bottom on a phone. Its hairline and its inactive labels are worked out from this colour.',
      presets: ['#ffffff', '#f2f3f5', '#14161a', '#2b3138'],
    },
    {
      key: 'tabbar_active', label: 'Tab bar — current item', shipped: '#4f46e5', onKey: 'tabbar_bg',
      hint: 'Ships as #4f46e5 — Tailwind’s stock indigo, not a Sporta colour. This bar has never followed the brand.',
      presets: ['#e0561c', '#ff7b17', '#4f46e5', '#14161a'],
    },
    {
      key: 'secondary_bg', label: 'Secondary button', shipped: '#a6acb2', on: '#171a1e',
      hint: 'Badges, the active filter chip and the outlined buttons, on the dark theme. Ink is printed on it.',
      presets: ['#a6acb2', '#e0561c', '#ff7b17', '#eaecee'],
    },
  ]

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

  /* ------------------------------------------------------------- contrast */
  /* Relative luminance, per WCAG 2.1. Null for anything that is not a plain
     six-digit hex — the same strictness assets/theme.js and the server both
     apply, and for the same reason: a value nothing can interpret must not be
     scored, because a number printed beside a colour nobody will see is worse
     than no number at all. */
  function luminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
    if (!m) return null
    var n = parseInt(m[1], 16)
    var ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      var s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
  }

  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b)
    if (la === null || lb === null) return null
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }

  function hex6(v) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim())
    return m ? '#' + m[1].toLowerCase() : ''
  }

  /** What this field's colour is measured against: a fixed foreground, or the
   *  live value of its partner field. The tab bar and its current item are a
   *  PAIR — neither has a meaning without the other — so each reads the
   *  other's box rather than a constant, and both readouts move together. */
  function against(f) {
    if (f.on) return f.on
    var partner = card && card.querySelector('[data-hex="' + f.onKey + '"]')
    var v = partner ? hex6(partner.value) : ''
    if (v) return v
    for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].key === f.onKey) return FIELDS[i].shipped
    return '#ffffff'
  }

  /* Every readout, recomputed. Cheap, and it keeps the pair honest: changing
     the tab bar has to move the figure printed under its current item too. */
  function scoreAll() {
    if (!card) return
    FIELDS.forEach(function (f) {
      var out = card.querySelector('[data-ratio="' + f.key + '"]')
      var box = card.querySelector('[data-hex="' + f.key + '"]')
      if (!out || !box) return
      var value = hex6(box.value) || f.shipped
      var r = contrast(value, against(f))
      if (r === null) { out.textContent = ''; out.className = 'stc-ratio'; return }
      // 3:1 is WCAG 1.4.3's floor for large text, which a bar's own label and
      // a button's are. Below it nothing is arguable; between 3 and 4.5 it is
      // a judgement, so this says so rather than refusing.
      var band = r < 3 ? 'bad' : r < 4.5 ? 'ok' : 'good'
      out.className = 'stc-ratio stc-' + band
      out.textContent = r.toFixed(1) + ':1 — ' +
        (band === 'bad' ? 'under 3:1, not readable'
         : band === 'ok' ? 'large text only'
         : 'passes')
    })
  }

  function note(text, bad) {
    var n = card && card.querySelector('.stc-note')
    if (!n) return
    n.textContent = text || ''
    n.className = 'stc-note' + (bad ? ' stc-bad' : '')
  }

  /* ---------------------------------------------------------------- build */
  function row(f) {
    var wrap = el('div', 'stc-row')
    wrap.appendChild(el('div', 'stc-label', f.label))
    wrap.appendChild(el('p', 'stc-hint', f.hint))

    var controls = el('div', 'stc-controls')

    /* A REAL COLOUR PICKER. The app's panel cannot have one — React Native has
       no such control — so it offers swatches and a hex box. A browser has the
       genuine article and there is no reason not to use it here. */
    var pick = document.createElement('input')
    pick.type = 'color'
    pick.className = 'stc-pick'
    pick.setAttribute('aria-label', f.label + ' colour picker')
    controls.appendChild(pick)

    var hex = document.createElement('input')
    hex.type = 'text'
    hex.className = 'stc-hex'
    hex.dataset.hex = f.key
    hex.spellcheck = false
    hex.autocomplete = 'off'
    hex.maxLength = 7
    hex.placeholder = f.shipped
    hex.setAttribute('aria-label', f.label + ' hex value')
    controls.appendChild(hex)

    f.presets.forEach(function (p) {
      var b = el('button', 'stc-swatch')
      b.type = 'button'
      b.style.background = p
      b.title = p
      b.setAttribute('aria-label', 'Use ' + p + ' for ' + f.label)
      b.addEventListener('click', function () {
        hex.value = p
        pick.value = p
        scoreAll()
      })
      controls.appendChild(b)
    })

    var clear = el('button', 'stc-clear', 'Built-in')
    clear.type = 'button'
    clear.title = 'Clear, and use ' + f.shipped
    clear.setAttribute('aria-label', 'Clear ' + f.label + ', and use the built-in ' + f.shipped)
    clear.addEventListener('click', function () {
      hex.value = ''
      pick.value = f.shipped
      scoreAll()
    })
    controls.appendChild(clear)

    wrap.appendChild(controls)
    wrap.appendChild(el('p', 'stc-ratio', '')).dataset.ratio = f.key

    /* The two boxes are one value. Typing edits the swatch, the swatch edits
       the text — and the text is what is READ at save, so the picker must
       write into it rather than being read separately. */
    pick.addEventListener('input', function () { hex.value = pick.value; scoreAll() })
    hex.addEventListener('input', function () {
      var v = hex6(hex.value)
      if (v) pick.value = v
      scoreAll()
    })

    return wrap
  }

  function fill() {
    FIELDS.forEach(function (f) {
      var hex = card.querySelector('[data-hex="' + f.key + '"]')
      // previousElementSibling, not previousSibling: the latter would pick up
      // a text node the moment anything in row() is written with whitespace
      // between the two, and the failure is a silent null.
      var pick = hex.previousElementSibling
      var saved = hex6(loaded && loaded[f.key])
      hex.value = saved
      pick.value = saved || f.shipped
    })
    scoreAll()
  }

  function submit() {
    if (busySave || !loaded) return
    var save = card.querySelector('.stc-save')

    /* EVERY FIELD OF THE ROW, not just the five. admin.php rebuilds the whole
       theme from what arrives, so anything left out is stored as ''. Sending
       the row as read and overwriting only these keys is what keeps the fonts,
       the radius, the spacing and the custom CSS alive through a colour
       change. */
    var value = {}
    Object.keys(loaded).forEach(function (k) { value[k] = loaded[k] })
    var bad = null
    FIELDS.forEach(function (f) {
      var raw = String(card.querySelector('[data-hex="' + f.key + '"]').value || '').trim()
      if (raw === '') { value[f.key] = ''; return }
      var v = hex6(raw)
      if (!v) { bad = bad || f.label; return }
      value[f.key] = v
    })

    if (bad) {
      // Refused here rather than at the server, because the server's answer
      // names a key and this names the control the owner is looking at.
      note(bad + ' is not a six-digit colour like #e0561c. Clear it to use the built-in one.', true)
      return
    }

    busySave = true
    save.disabled = true
    save.textContent = 'Saving…'
    note('')

    ask('settings_save', { name: 'theme', value: value }).then(function (res) {
      busySave = false
      save.disabled = false
      save.textContent = 'Save colours'
      if (res && res.error) {
        // NOTHING IS REBUILT. The boxes keep what was typed, which is the
        // whole reason this card does not re-render — see the file header.
        note(explain(res.error), true)
        return
      }
      loaded = res
      note('Saved. Reload the shop to see it.')
    }).catch(function () {
      busySave = false
      save.disabled = false
      save.textContent = 'Save colours'
      note('The save did not reach the shop. Nothing was changed — press Save again.', true)
    })
  }

  function explain(err) {
    var s = String(err || '')
    if (s.indexOf('invalid_theme_') === 0) {
      var key = s.slice('invalid_theme_'.length)
      for (var i = 0; i < FIELDS.length; i++) {
        if (FIELDS[i].key === key) return FIELDS[i].label + ' was refused — it must be a colour like #e0561c.'
      }
      return 'The shop refused ' + key + '.'
    }
    if (s === 'not_signed_in') return 'Your session has ended. Sign in again.'
    return s
  }

  function build() {
    card.textContent = ''
    card.appendChild(el('h3', 'stc-h', 'Buttons and bars'))
    card.appendChild(el('p', 'stc-sub',
      'Leave a colour empty to keep what the shop was built with. Empty never blanks anything, and clearing is the way back from a change you did not like.'))

    FIELDS.forEach(function (f) { card.appendChild(row(f)) })

    var foot = el('div', 'stc-foot')
    var save = el('button', 'stc-save', 'Save colours')
    save.type = 'button'
    save.addEventListener('click', submit)
    foot.appendChild(save)
    card.appendChild(foot)
    card.appendChild(el('p', 'stc-note', ''))
  }

  function load() {
    /* The PUBLIC route, which is where the shop itself paints from. Reading
       the same place the storefront reads means the panel and the page cannot
       drift without somebody seeing it — the reason the app's card does the
       same. */
    fetch('/api/api.php?r=theme', { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (t) {
        loaded = (t && typeof t === 'object') ? t : {}
        fill()
      })
      .catch(function () {
        note('Could not read the shop’s current colours. Saving now would overwrite them, so the button is off.', true)
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
    + '.stc{border:1px solid var(--sp-pc-border,#494e54);border-radius:var(--sp-pc-radius,1rem);padding:var(--sp-pc-pad,1.5rem);margin:var(--sp-pc-gap,1.5rem) 0;'
    + 'background:var(--card,rgba(255,255,255,.03))}'
    + '.stc-h{margin:0 0 4px;font-size:16px}'
    + '.stc-sub{margin:0 0 18px;opacity:.7;font-size:13px;line-height:1.5}'
    + '.stc-row{padding:14px 0;border-top:1px solid var(--border,#2a2d31)}'
    + '.stc-label{font-size:14px;font-weight:600}'
    + '.stc-hint{margin:2px 0 10px;opacity:.7;font-size:12.5px;line-height:1.5}'
    + '.stc-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}'
    /* 44px everywhere a finger lands. The panel is used on a phone and this
       card is nothing but small controls. */
    + '.stc-pick{width:44px;height:44px;padding:0;border:1px solid var(--border,#2a2d31);'
    + 'border-radius:8px;background:transparent;cursor:pointer}'
    /* 16px, not smaller: under it mobile Safari zooms the whole page on focus,
       and a panel that jumps when you tap a box is a panel you fight. */
    + '.stc-hex{width:104px;min-height:44px;padding:8px 10px;border-radius:8px;font-size:16px;'
    + 'border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font-family:inherit}'
    + '.stc-swatch{width:44px;height:44px;border-radius:8px;cursor:pointer;'
    + 'border:1px solid var(--border,#2a2d31)}'
    + '.stc-clear{min-height:44px;padding:0 12px;border-radius:8px;cursor:pointer;font:inherit;font-size:13px;'
    + 'border:1px dashed var(--border,#2a2d31);background:transparent;color:inherit;opacity:.85}'
    + '.stc-ratio{margin:8px 0 0;font-size:12.5px;min-height:1em}'
    + '.stc-good{color:#5cc98d}.stc-ok{color:#ffb020}.stc-bad{color:#ff8a80}'
    + '.stc-foot{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}'
    + '.stc-save{min-height:44px;padding:9px 16px;border-radius:8px;border:0;cursor:pointer;'
    + 'background:var(--brand,#e0561c);color:#fff;font:inherit;font-weight:600}'
    + '.stc-save[disabled]{opacity:.5;cursor:default}'
    + '.stc-note{margin:12px 0 0;font-size:13px;line-height:1.5}'

  function style() {
    if (document.getElementById('stc-css')) return
    var s = document.createElement('style')
    s.id = 'stc-css'
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
    card = el('div', 'stc')
    var anchor = head.parentNode
    anchor.parentNode.insertBefore(card, anchor.nextSibling)
    placing = false

    loaded = null
    busySave = false
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
