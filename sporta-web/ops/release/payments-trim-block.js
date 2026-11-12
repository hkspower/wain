/* ===== ADMIN PAYMENTS TRIM - begin =======================================
 * Payments > KNET editor: "remove any unneeded fields" (owner 2026-11-12). Folds into two read-only summaries, each with
 * one "Show fields" button:
 *
 *   KNET summary (right after the compiled editor's field grid)
 *     - the compiled address fields that can hold only ONE value the server accepts, when they hold it:
 *         Test gateway URL         https://kpaytest.com.kw/kpg/PaymentHTTP.htm   knet.php knet_assert_payment_config pins
 *         Production gateway URL   https://kpay.com.kw/kpg/PaymentHTTP.htm       host AND path; admin.php payment_config
 *                                                                                pins the host
 *         Response URL, Error URL  https://www.sporta.com.kw/knet/callback.php   (the one file that answers both)
 *         Customer result page     https://www.sporta.com.kw/payment/result      (the live value, read-only probe 2026-11-12)
 *     - the Merchant ID / Terminal ID card (block 2): records only, no payment request carries them; shown as saved
 *       values or "not set".
 *   CBK summary (inside the CBK connection card, after its fields)
 *     - Test API base URL (host pgtest.cbk.com), Production API base URL (host pg.cbk.com), Return URL
 *       (https://www.sporta.com.kw/pay/callback.php), Customer result page URL (https://www.sporta.com.kw/payment/result);
 *     - the Merchant Server IP 1 / 2 card (block 3): an allowlist record on CBK's side, never sent; saved values or "not set".
 *
 * SAVING IS UNTOUCHED. Everything is HIDDEN with inline display:none (a compiled <label>, the one-field wrapper around it,
 * or a whole add-on card), never removed, emptied or written to: the compiled editor keeps each field in its state and sends
 * it with every save as before; the CBK card reads its inputs at save time as before; the ID and IP cards keep their own
 * Save buttons and validation, which work as before once "Show fields" puts them back.
 * A WRONG value is never hidden: an address that is not the one the server accepts (empty, another host, another path, a
 * port, a query, spaces) stays a normal field and the summary names it with the expected value; a field once shown as wrong
 * stays shown for the visit, and a focused field is never hidden. An ID or IP card that could not load (its status shows
 * an error) or holds the focus stays on show. Idempotent: a pass that finds nothing to change writes nothing.
 * Self-contained on purpose (no variable of another block is used), so ops/release can splice this exact text into the
 * live file (scripts/make-trim-release.mjs). textContent only, inline styles and the compiled build's own classes.
 */
;(function () {   // leading ; - the block above ends in `)()` with no semicolon
  'use strict'
  if (location.pathname.indexOf('/backends') !== 0) return
  if (window.__sportaPayTrim) return   // double execution: a second copy of this file must not start a second set of observers
  try { Object.defineProperty(window, '__sportaPayTrim', { value: 1, enumerable: false, configurable: false }) } catch (e) { return }
  var CBK = 'data-sporta-cbk', IDS = 'data-sporta-knet-ids', IPS = 'data-sporta-tpay-ips'
  var TRIM = 'data-sporta-fixed'                 // the summary this block adds (value: the group name)
  var TRIM_HID = 'data-sporta-fixed-hidden'      // a field or card this block hid
  var TITLE = 'text-sm font-bold text-slate-900'
  var NOTE = 'mt-0.5 text-xs text-slate-500'
  var SPORTA_HOSTS = ['sporta.com.kw', 'www.sporta.com.kw']
  var KPG = '/kpg/PaymentHTTP.htm'
  var RESULT = '/payment/result'
  // [label text, allowed hosts, exact path or null, the value to show as expected]
  var FIXED = {
    knet: [
      ['Test gateway URL', ['kpaytest.com.kw'], KPG, 'https://kpaytest.com.kw' + KPG],
      ['Production gateway URL', ['kpay.com.kw'], KPG, 'https://kpay.com.kw' + KPG],
      ['Response URL', SPORTA_HOSTS, '/knet/callback.php', 'https://www.sporta.com.kw/knet/callback.php'],
      ['Error URL', SPORTA_HOSTS, '/knet/callback.php', 'https://www.sporta.com.kw/knet/callback.php'],
      ['Customer result page', SPORTA_HOSTS, RESULT, 'https://www.sporta.com.kw' + RESULT]
    ],
    cbk: [
      ['Test API base URL', ['pgtest.cbk.com'], null, 'https://pgtest.cbk.com'],
      ['Production API base URL', ['pg.cbk.com'], null, 'https://pg.cbk.com'],
      ['Return URL (on sporta.com.kw)', SPORTA_HOSTS, '/pay/callback.php', 'https://www.sporta.com.kw/pay/callback.php'],
      ['Customer result page URL', SPORTA_HOSTS, RESULT, 'https://www.sporta.com.kw' + RESULT]
    ]
  }
  var COPY = {
    knet: ['KNET addresses and IDs', 'The addresses have one correct value, set by the bank and by this shop; the Merchant ID and Terminal ID are kept for your records and are not used to take payment. None is shown as a field: use Show fields to change one. Everything is kept and sent unchanged with every save.'],
    cbk: ['CBK addresses and server IPs', 'The addresses have one correct value, set by CBK and by this shop; the server IPs are a record of what is registered with CBK and are not sent with payments. None is shown as a field: use Show fields to change one. Everything is kept and sent unchanged with every save.']
  }
  var open = { knet: false, cbk: false }          // "Show fields" pressed (this visit only)
  var shownBad = typeof WeakSet === 'function' ? new WeakSet() : null

  function cls(tag, className, text) {
    var n = document.createElement(tag)
    if (className) n.className = className
    if (text != null) n.textContent = text
    return n
  }
  function fixedOk(value, rule) {
    var v = String(value == null ? '' : value)
    if (!v || v !== v.trim() || /\s/.test(v)) return false
    var u
    try { u = new URL(v) } catch (e) { return false }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return false
    if (rule[1].indexOf(u.hostname.toLowerCase()) < 0) return false
    if (rule[2] !== null && u.pathname !== rule[2]) return false
    return true
  }
  // The address labels of a group, by their exact caption: the compiled KNET grid (outside every card an add-on adds) or the
  // CBK card's own grid.
  function fixedFields(scope, group) {
    var out = [], rules = FIXED[group]
    var labels = scope.querySelectorAll('label')
    for (var i = 0; i < labels.length; i++) {
      var lab = labels[i]
      if (group === 'cbk' ? !lab.closest('[' + CBK + ']') : lab.closest('[' + IDS + '],[' + IPS + '],[' + CBK + '],[' + TRIM + ']')) continue
      var span = lab.querySelector('span'), input = lab.querySelector('input')
      if (!span || !input) continue
      var caption = String(span.textContent || '').trim()
      for (var j = 0; j < rules.length; j++) if (rules[j][0] === caption) out.push({ rule: rules[j], label: lab, input: input })
    }
    return out
  }
  // What to hide: the label, or the wrapper the compiled grid puts around a one-field cell (div.md:col-span-2 > label).
  function fixedTarget(lab) {
    var p = lab.parentElement
    if (p && p.tagName === 'DIV' && p.children.length === 1 && !p.classList.contains('grid')) return p
    return lab
  }
  function setHidden(node, hide) {
    if (hide) {
      if (node.getAttribute(TRIM_HID) !== '1') node.setAttribute(TRIM_HID, '1')
      if (node.style.display !== 'none') node.style.display = 'none'
    } else if (node.getAttribute(TRIM_HID) === '1') {
      node.removeAttribute(TRIM_HID)
      node.style.display = ''
    }
  }
  // An ID or IP card: its fields as [caption, saved value], and whether it may be folded.
  function recordCard(card) {
    if (!card) return null
    var rows = []
    var labels = card.querySelectorAll('label')
    for (var i = 0; i < labels.length; i++) {
      var head = labels[i].querySelector('span'), input = labels[i].querySelector('input')
      if (!head || !input || input.type === 'checkbox') continue
      var t = head.firstChild && head.firstChild.nodeType === 3 ? head.firstChild.nodeValue : head.textContent   // the "Active" badge is a child span
      rows.push([String(t || '').trim(), String(input.value || '').trim()])
    }
    var status = card.querySelector(':scope > div > p')
    var st = status ? String(status.textContent || '').trim() : ''
    var err = !!status && /190, 18, 60|be123c/i.test(status.style.color || '') && st !== ''
    var loading = st === 'Loading…'
    var focused = card.contains(document.activeElement)
    return { card: card, rows: rows, err: err, loading: loading, foldable: !err && !focused }
  }
  function summary(group, parent, after, list, rec) {
    var box = parent.querySelector(':scope > [' + TRIM + '="' + group + '"]')
    if (!list.length && !rec) { if (box) box.remove(); return }
    var sig = (open[group] ? 'open|' : 'shut|') + list.map(function (f) { return (f.ok ? '1' : '0') + f.rule[0] + '=' + f.input.value }).join('|') +
      '#' + (rec ? (rec.err ? 'E' : rec.loading ? 'L' : '') + rec.rows.map(function (r) { return r[0] + '=' + r[1] }).join('|') : '')
    if (!box) {
      box = cls('div', 'mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3')
      box.setAttribute(TRIM, group)
    }
    if (box.parentNode !== parent || box.previousElementSibling !== after) parent.insertBefore(box, after.nextSibling)
    if (box.getAttribute('data-sig') === sig) return
    box.setAttribute('data-sig', sig)
    while (box.firstChild) box.removeChild(box.firstChild)
    var top = cls('div', '')
    top.style.cssText = 'display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:.5rem .75rem'
    var copy = cls('div', 'min-w-0')
    copy.style.flex = '1 1 14rem'
    copy.appendChild(cls('p', TITLE, COPY[group][0]))
    copy.appendChild(cls('p', NOTE, COPY[group][1]))
    top.appendChild(copy)
    var btn = cls('button', 'min-h-11 rounded-xl border border-indigo-200 bg-white px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50', open[group] ? 'Hide fields' : 'Show fields')
    btn.type = 'button'
    btn.setAttribute('aria-expanded', open[group] ? 'true' : 'false')
    btn.addEventListener('click', function () { open[group] = !open[group]; schedule() })
    top.appendChild(btn)
    box.appendChild(top)
    var rows = cls('div', '')
    rows.style.cssText = 'margin-top:.5rem;display:grid;gap:.35rem'
    function row(caption, value, muted) {
      var r = cls('div', '')
      r.style.cssText = 'display:flex;flex-wrap:wrap;gap:.1rem .75rem;min-width:0'
      r.appendChild(cls('span', 'text-xs font-bold text-slate-600', caption))
      var v = cls('span', muted ? 'text-xs text-slate-500' : 'font-mono text-xs text-slate-600', value)
      v.setAttribute('dir', 'ltr')
      v.style.overflowWrap = 'anywhere'
      v.style.minWidth = '0'
      r.appendChild(v)
      rows.appendChild(r)
    }
    list.forEach(function (f) { if (f.ok) row(f.rule[0], f.input.value, false) })
    if (rec) {
      if (rec.err) {
        var e = cls('div', 'text-xs font-bold', 'The ' + (group === 'knet' ? 'Merchant ID and Terminal ID' : 'Merchant Server IP') + ' panel could not load; it is shown below.')
        e.style.color = '#be123c'
        rows.appendChild(e)
      } else rec.rows.forEach(function (r) { row(r[0], rec.loading ? 'loading…' : (r[1] || 'not set'), rec.loading || !r[1]) })
    }
    list.forEach(function (f) {
      if (f.ok) return
      var p = cls('div', 'text-xs font-bold', f.rule[0] + ' is shown as a field above: it ' + (f.input.value.trim() ? 'is not' : 'is empty and should be') + ' ' + f.rule[3] + '.')
      p.style.color = '#be123c'
      rows.appendChild(p)
    })
    box.appendChild(rows)
  }
  function group(name, scope, parent, after, card) {
    var list = fixedFields(scope, name)
    list.forEach(function (f) {
      f.ok = fixedOk(f.input.value, f.rule)
      if (!f.ok && shownBad && f.input.value) shownBad.add(f.input)   // an EMPTY field is not pinned: the editor may fill it a moment later
      var keep = (shownBad && shownBad.has(f.input)) || document.activeElement === f.input
      setHidden(fixedTarget(f.label), f.ok && !keep && !open[name])
    })
    var rec = recordCard(card)
    if (rec) setHidden(rec.card, rec.foldable && !open[name])
    summary(name, parent, after, list, rec)
  }
  function scan() {
    var row = document.querySelector('form.payment-gateway-editor .payment-knet-toggle-row')
    var form = row && row.closest('form.payment-gateway-editor')
    if (!form) return
    var grid = form.querySelector(':scope > .grid')
    if (grid) group('knet', form, form, grid, form.querySelector('[' + IDS + ']'))
    var cbk = form.querySelector('[' + CBK + ']')
    var cbkGrid = cbk && cbk.querySelector(':scope > .grid')
    if (cbkGrid) group('cbk', cbk, cbk, cbkGrid, form.querySelector('[' + IPS + ']'))
  }

  var queued = false
  function schedule() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; try { scan() } catch (e) { /* a failed pass must not be a console error on every DOM change */ } }) }
  // attributes 'value' as well: React writes the value attribute of a controlled input when its state arrives or changes,
  // which is what this block reads (a property-only change is not a mutation). The add-on cards that set .value also
  // change their status line in the same step, which is a childList mutation.
  function start() { scan(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] }) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start()
})()
/* ===== ADMIN PAYMENTS TRIM - end ========================================= */
