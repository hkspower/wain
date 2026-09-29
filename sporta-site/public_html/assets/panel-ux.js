/**
 * /backends usability — 2026-09-29, "improve backend ux". Measured first, then
 * the owner chose all of these out of the four offered:
 *
 *   Inventory   26,234px tall on a phone (about 31 screenfuls), 8,569px on a
 *               desktop: one row per SIZE, 162 of them for 46 products.
 *   Settings    10,793px on a phone.   Orders   9,912px on a phone.
 *   Catalogue   46 runs of text under 12px on a phone; Inventory 331 controls
 *               under 40px tall on a desktop.
 *
 * 1. INVENTORY, ONE LINE PER PRODUCT. Every product shows its FIRST size row
 *    with a "+ n more sizes · stock" toggle; the other rows are hidden until
 *    it is pressed. Nothing is removed or rebuilt: the bundle's own rows, with
 *    their own stock inputs and remove buttons, are only shown or hidden, so
 *    editing a stock count works exactly as it did. Grouping is by the product
 *    name the row prints, on consecutive rows, which is how the bundle orders
 *    them. A product with a sold-out size says so on the toggle, so collapsing
 *    never hides the one thing the owner has to act on.
 *
 * 2. A JUMP-TO BAR on long screens (more than 2.5 windows tall): one button per
 *    section heading on the screen, sticky at the top, so a section is one tap
 *    away rather than a scroll. Built from the headings actually on screen, not
 *    from a list, so a card added later is in it the day it appears.
 *
 * 3. TOUCH TARGETS AND TEXT, on a touch screen only (pointer: coarse): buttons,
 *    fields and selects at least 44px tall, and no text under 12px. A mouse is
 *    precise and the desktop layout is left as designed.
 *
 * Signed-in screens only: everything hangs off .admin-content, which does not
 * exist on the sign-in screen. The panel re-renders in place, so all of it is
 * re-applied from a MutationObserver, and re-applying is idempotent.
 */
(function () {
  'use strict'

  var MARK = 'data-spux'
  var open = {}                         // product name -> expanded

  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  var CSS = ''
    + '.spux-hide{display:none!important}'
    + '.spux-toggle{display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:6px 10px;'
    + 'min-height:32px;border-radius:999px;border:1px solid var(--sp-pc-border,#494e54);'
    + 'background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:700;cursor:pointer}'
    + '.spux-toggle[aria-expanded=true]{border-color:var(--brand,#e0561c)}'
    + '.spux-toggle .spux-out{color:#f87171}'
    + '.spux-jump{position:sticky;top:0;z-index:30;display:flex;gap:8px;overflow-x:auto;'
    + 'padding:10px 0;margin:0 0 12px;background:var(--sp-pc-bg,#1b1d20);'
    + 'border-bottom:1px solid var(--sp-pc-border,#494e54);scrollbar-width:thin}'
    + '.spux-jump b{flex:none;align-self:center;font-size:12px;opacity:.75}'
    + '.spux-jump button{flex:none;padding:8px 12px;min-height:36px;border-radius:999px;'
    + 'border:1px solid var(--sp-pc-border,#494e54);background:transparent;color:inherit;'
    + 'font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}'
    + '.spux-jump button:hover{border-color:var(--brand,#e0561c)}'
    + '@media (pointer: coarse){'
    +   '.admin-content button,.admin-content select,'
    +   '.admin-content input:not([type=checkbox]):not([type=radio]):not([type=hidden]),'
    +   '.admin-content textarea{min-height:44px}'
    +   '.admin-content input[type=checkbox],.admin-content input[type=radio]{width:22px;height:22px}'
    +   '.admin-content [class*="text-[10px]"],.admin-content [class*="text-[11px]"],'
    +   '.admin-content [class*="text-[9px]"],'
    +   '.admin-content .m-row__badge,.admin-content .hsl-badge{font-size:12px!important}'
    +   '.spux-toggle{min-height:44px}'
    +   '.spux-jump button{min-height:44px}'
    + '}'

  function style() {
    if (document.getElementById('spux-css')) return
    var s = el('style')
    s.id = 'spux-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  /* ------------------------------------------------------ 1. inventory */

  function isInventory(host) {
    var h = host.querySelector('h1')
    return !!h && h.textContent.trim() === 'Inventory'
  }

  function nameOfRow(tr) {
    var td = tr.children[0]
    if (!td) return ''
    // The first cell is "<name><span>…</span>"; the name is its first text node.
    for (var i = 0; i < td.childNodes.length; i++) {
      var n = td.childNodes[i]
      if (n.nodeType === 3 && n.textContent.trim()) return n.textContent.trim()
    }
    return td.textContent.trim()
  }

  function stockOf(node) {
    var inp = node.querySelector('input[inputmode="numeric"]')
    var v = inp ? parseInt(inp.value, 10) : NaN
    return isNaN(v) ? 0 : v
  }

  /** Group consecutive items by name. $items: array of nodes, $nameOf: fn. */
  function groups(items, nameOf) {
    var out = []
    for (var i = 0; i < items.length; i++) {
      var name = nameOf(items[i])
      var last = out[out.length - 1]
      if (last && last.name === name) last.items.push(items[i])
      else out.push({ name: name, items: [items[i]] })
    }
    return out
  }

  function toggleFor(g, holder) {
    var t = holder.querySelector('.spux-toggle')
    if (!t) {
      t = el('button', 'spux-toggle')
      t.type = 'button'
      t.setAttribute(MARK, 'toggle')
      t.addEventListener('click', function (e) {
        e.preventDefault()
        e.stopPropagation()
        var n = t.getAttribute('data-name')
        open[n] = !open[n]
        apply()
      })
      holder.appendChild(t)
    }
    var total = 0, out = 0
    for (var i = 0; i < g.items.length; i++) {
      var s = stockOf(g.items[i])
      total += s
      if (s === 0) out++
    }
    var more = g.items.length - 1
    var isOpen = !!open[g.name]
    t.setAttribute('data-name', g.name)
    t.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
    t.textContent = (isOpen ? '− Hide ' : '+ ') + more + ' more size' + (more === 1 ? '' : 's')
      + ' · ' + total + ' in stock'
    if (out) {
      var o = el('span', 'spux-out', ' · ' + out + ' sold out')
      t.appendChild(o)
    }
    for (var j = 1; j < g.items.length; j++) g.items[j].classList.toggle('spux-hide', !isOpen)
  }

  function inventory(host) {
    // Desktop table
    var table = host.querySelector('table.admin-table')
    if (table) {
      var rows = [].slice.call(table.querySelectorAll('tbody > tr'))
      groups(rows, nameOfRow).forEach(function (g) {
        if (g.items.length < 2) return
        toggleFor(g, g.items[0].children[0])
      })
    }
    // Phone list
    var list = host.querySelector('.m-list')
    if (list) {
      var cards = [].slice.call(list.querySelectorAll(':scope > .m-row'))
      groups(cards, function (c) {
        var t = c.querySelector('.m-row__title')
        return t ? t.textContent.trim() : ''
      }).forEach(function (g) {
        if (g.items.length < 2) return
        toggleFor(g, g.items[0])
      })
    }
  }

  /* -------------------------------------------------------- 2. jump-to */

  function jump(host) {
    var bar = host.querySelector('.spux-jump')
    var tall = document.documentElement.scrollHeight > window.innerHeight * 2.5
    var heads = [].slice.call(host.querySelectorAll('h2, h3')).filter(function (h) {
      return h.offsetParent !== null && h.textContent.trim() && !h.closest('.spux-jump')
        && !h.closest('[role=dialog], .fixed')
    })
    // A screen's main list has no heading of its own (Inventory's stock table,
    // the Orders table), and it is the thing most worth jumping back to. It is
    // named after the screen and placed in page order with the headings.
    var h1 = host.querySelector('h1')
    var list = host.querySelector('table.admin-table')
    if (list && list.offsetParent === null) list = host.querySelector('.m-list')
    if (list && list.offsetParent !== null && h1) {
      var fake = { textContent: h1.textContent.trim() + ' list', el: list }
      heads.push(fake)
      heads.sort(function (a, b) {
        var x = a.el || a, y = b.el || b
        return x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      })
    }
    if (!tall || heads.length < 2) {
      if (bar) bar.parentNode.removeChild(bar)
      return
    }
    var key = heads.map(function (h) { return String(h.textContent).trim() }).join('|')
    if (bar && bar.getAttribute('data-key') === key) return
    if (!bar) {
      bar = el('nav', 'spux-jump')
      bar.setAttribute(MARK, 'jump')
      bar.setAttribute('aria-label', 'Jump to a section')
      host.insertBefore(bar, host.firstChild)
    }
    bar.setAttribute('data-key', key)
    bar.textContent = ''
    bar.appendChild(el('b', null, 'Jump to'))
    heads.forEach(function (h) {
      var b = el('button', null, h.textContent.trim())
      b.type = 'button'
      b.addEventListener('click', function () {
        var y = (h.el || h).getBoundingClientRect().top + window.scrollY - bar.offsetHeight - 12
        window.scrollTo({ top: y, behavior: 'smooth' })
      })
      bar.appendChild(b)
    })
  }

  /* ------------------------------------------------------------ apply */

  var applying = false
  function apply() {
    if (applying) return
    applying = true
    try {
      var host = document.querySelector('.admin-content')
      if (!host) return
      style()
      if (isInventory(host)) inventory(host)
      jump(host)
    } finally {
      applying = false
    }
  }

  var timer = null
  function schedule() { clearTimeout(timer); timer = setTimeout(apply, 150) }

  function start() {
    apply()
    new MutationObserver(function (list) {
      // Our own writes must not re-trigger us for ever.
      for (var i = 0; i < list.length; i++) {
        var t = list[i].target
        if (!(t.closest && t.closest('[' + MARK + ']'))) { schedule(); return }
      }
    }).observe(document.body, { childList: true, subtree: true })
    // A stock count typed into a row changes the toggle's total.
    document.addEventListener('input', function (e) {
      if (e.target && e.target.matches && e.target.matches('input[inputmode="numeric"]')) schedule()
    }, true)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
