/**
 * The shop's numbers, edited from the WEBSITE's /backends panel.
 *
 * WHAT THIS IS. Delivery, returns, the COD limit, the review reward, the
 * discount cap, the governorates served and which sizes and fits are offered
 * used to be PHP constants — changing one meant a code edit and a publish.
 * They are now a `rules` settings row. This is the card that edits them.
 *
 * WHY AN OVERLAY. The website's /backends is a prebuilt bundle with no source
 * in this repository, and it is a DIFFERENT PROGRAM from the app's /backends.
 * CLAUDE.md records the trap directly: the KNET editor, the footer editor, the
 * theme editor and the brand-logo uploader all began app-only, and "it is in
 * /backends" was true of a panel the owner does not open in a browser. So this
 * follows the pattern the storefront already uses — add a card, touch nothing
 * that exists, and do nothing outside the screen it belongs to.
 *
 * IT NEEDS NO CREDENTIAL OF ITS OWN. It runs on the shop's origin inside the
 * panel, so the session cookie is already there. The request shape was read out
 * of the bundle rather than guessed: /api/admin.php?r=, X-Sporta-Admin: 1,
 * credentials: include.
 *
 * THE LISTS ARE A SUBSET, AND THE SERVER DECIDES WHAT OF. ?r=rules returns
 * `allowed`, and every checkbox here is drawn FROM that — never from a list
 * written in this file. order_items carries check(size in (...)) and
 * check(fit in (...)), so a picker offering a size MySQL will refuse is a
 * checkout that dies on its last step. A second copy of those lists here would
 * be a third home for them and would go stale on the day someone migrates the
 * schema.
 *
 * MONEY IS SHOWN IN KWD AND SENT IN FILS. The server's unit is integer fils —
 * every price in this shop is — and a decimal field that quietly rounds is how
 * a 1.500 fee becomes 1.000. The conversion is done once, on the way out, with
 * Math.round, and the field is validated before it is attempted.
 *
 * A REFUSAL IS SHOWN AS A SENTENCE. admin.php answers rule_size_in_use:XL(7),
 * rule_out_of_range:delivery_fee_fils and so on — each names the field and,
 * where it can, the reason. Printing the token would make a careful error
 * message look like a crash, so each is translated here. An unrecognised one is
 * shown verbatim rather than swallowed: a message nobody wrote is still better
 * than silence, which is what "save failed" means.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var card = null
  var state = { rules: null, defaults: null, allowed: null, note: '', busy: false }

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

  /* ------------------------------------------------------------- wording --- */

  var FIELD_NAMES = {
    delivery_fee_fils: 'the delivery fee',
    free_delivery_fils: 'the free-delivery threshold',
    return_days: 'the returns window',
    cod_open_max: 'the cash-on-delivery limit',
    review_reward_pct: 'the review reward',
    discount_max_pct: 'the discount cap',
    governorates: 'the delivery areas',
    sizes: 'the sizes',
    fits: 'the fits',
  }

  function explain(err) {
    var s = String(err || '')
    var head = s.split(':')[0]
    var rest = s.slice(head.length + 1)
    var field = FIELD_NAMES[rest.split(':')[0]] || rest.split(':')[0]

    if (head === 'rule_size_in_use') {
      // The one refusal that is genuinely useful, so it keeps its detail: the
      // sizes and how many stock rows each holds. "You cannot remove XL" is not
      // actionable; "XL has 7 stock rows" is.
      return 'Those sizes still have stock rows, so removing them would leave '
           + 'garments showing a size nobody can buy: ' + rest + '. '
           + 'Clear the stock in Stock first.'
    }
    if (head === 'rule_unknown_value') {
      return 'That is not one of the values this shop can store — ' + rest + '. '
           + 'Adding a genuinely new size or fit is a database change, not a setting.'
    }
    if (head === 'rule_empty_list') return 'You cannot leave ' + field + ' empty.'
    if (head === 'rule_out_of_range') return 'That value for ' + field + ' is outside what the shop accepts.'
    if (head === 'rule_not_a_number') return field.charAt(0).toUpperCase() + field.slice(1) + ' has to be a number.'
    if (head === 'rule_not_a_list') return field.charAt(0).toUpperCase() + field.slice(1) + ' has to be a list.'
    if (head === 'rule_reward_above_cap') {
      return 'The review reward is higher than the discount cap, so a customer '
           + 'would be promised more than the checkout will ever give them.'
    }
    if (head === 'not_signed_in') return 'Your session has ended. Sign in again.'
    return s
  }

  /* --------------------------------------------------------------- fields -- */

  var MONEY = [
    ['delivery_fee_fils', 'Delivery fee', 'What delivery costs. 0 means delivery is free for everyone.'],
    ['free_delivery_fils', 'Free delivery over', 'Orders at or above this pay no delivery. 0 turns it off.'],
  ]
  var COUNTS = [
    ['return_days', 'Returns window', 'days', 'Counted from delivery, not from the order. WARNING: the shop’s pages say “14 days” in fixed text, so changing this changes what is enforced but not what customers are told.'],
    ['cod_open_max', 'Unpaid cash orders', 'per customer', 'How many cash-on-delivery orders one phone number may have open at once.'],
    ['review_reward_pct', 'Review reward', '%', 'The discount a customer gets for reviewing something they bought.'],
    ['discount_max_pct', 'Discount cap', '%', 'The most any combination of discounts may take off one order.'],
  ]
  var LISTS = [
    ['governorates', 'Delivery areas', 'A customer outside these cannot check out. WARNING: the checkout still lists all six areas in fixed text, so removing one does not hide it — the customer fills the whole form and is refused at the last step.'],
    ['sizes', 'Sizes', 'Which of the sizes this shop offers, in the order they appear.'],
    ['fits', 'Fits', 'Which fits a customer may choose from.'],
  ]

  // fils -> a KWD string with three decimals, which is how this shop writes
  // money everywhere else. Not toFixed on a float division alone: 1500/1000 is
  // 1.5 and the shop writes 1.500.
  function kwd(fils) { return (Number(fils || 0) / 1000).toFixed(3) }

  function render() {
    if (!card) return
    card.textContent = ''

    var h = el('h3', 'srl-h', 'Shop rules')
    card.appendChild(h)
    card.appendChild(el('p', 'srl-sub',
      'The numbers the shop runs on. They take effect on the next order — '
      + 'nothing needs publishing.'))

    if (!state.rules) {
      card.appendChild(el('p', 'srl-note', 'Loading…'))
      return
    }

    var form = el('div', 'srl-grid')

    MONEY.forEach(function (f) {
      var wrap = el('label', 'srl-field')
      wrap.appendChild(el('span', 'srl-label', f[1]))
      var row = el('span', 'srl-money')
      var i = el('input')
      i.type = 'text'
      i.inputMode = 'decimal'
      i.value = kwd(state.rules[f[0]])
      i.dataset.rule = f[0]
      i.className = 'srl-input srl-num'
      row.appendChild(i)
      row.appendChild(el('span', 'srl-unit', 'KWD'))
      wrap.appendChild(row)
      wrap.appendChild(el('span', 'srl-hint', f[2]))
      form.appendChild(wrap)
    })

    COUNTS.forEach(function (f) {
      var wrap = el('label', 'srl-field')
      wrap.appendChild(el('span', 'srl-label', f[1]))
      var row = el('span', 'srl-money')
      var i = el('input')
      i.type = 'text'
      i.inputMode = 'numeric'
      i.value = String(state.rules[f[0]])
      i.dataset.rule = f[0]
      i.className = 'srl-input srl-num'
      row.appendChild(i)
      row.appendChild(el('span', 'srl-unit', f[2]))
      wrap.appendChild(row)
      wrap.appendChild(el('span', 'srl-hint', f[3]))
      form.appendChild(wrap)
    })

    card.appendChild(form)

    LISTS.forEach(function (f) {
      var key = f[0]
      var block = el('div', 'srl-list')
      block.appendChild(el('span', 'srl-label', f[1]))
      block.appendChild(el('span', 'srl-hint', f[2]))
      var box = el('div', 'srl-chips')
      // FROM THE SERVER'S `allowed`, never from a list in this file.
      ;(state.allowed[key] || []).forEach(function (value) {
        var on = state.rules[key].indexOf(value) >= 0
        var lab = el('label', 'srl-chip' + (on ? ' is-on' : ''))
        var cb = el('input')
        cb.type = 'checkbox'
        cb.checked = on
        cb.dataset.list = key
        cb.dataset.value = value
        lab.appendChild(cb)
        lab.appendChild(el('span', null, value))
        box.appendChild(lab)
      })
      block.appendChild(box)
      card.appendChild(block)
    })

    var foot = el('div', 'srl-foot')
    var save = el('button', 'srl-save', state.busy ? 'Saving…' : 'Save rules')
    save.type = 'button'
    save.disabled = !!state.busy
    save.addEventListener('click', submit)
    foot.appendChild(save)

    var reset = el('button', 'srl-reset', 'Back to the shipped defaults')
    reset.type = 'button'
    reset.disabled = !!state.busy
    reset.addEventListener('click', function () {
      state.rules = JSON.parse(JSON.stringify(state.defaults))
      state.note = 'Defaults filled in — nothing is saved until you press Save.'
      render()
    })
    foot.appendChild(reset)
    card.appendChild(foot)

    if (state.note) card.appendChild(el('p', 'srl-note', state.note))
  }

  /* --------------------------------------------------------------- saving -- */

  function collect() {
    var out = {}
    var bad = null

    card.querySelectorAll('input[data-rule]').forEach(function (i) {
      var key = i.dataset.rule
      var raw = String(i.value).trim()
      if (key.slice(-5) === '_fils') {
        // A comma decimal is what an Arabic keyboard offers and what half of
        // Kuwait types; refusing it would look like the field is broken.
        raw = raw.replace(',', '.')
        if (!/^\d+(\.\d{1,3})?$/.test(raw)) { bad = bad || FIELD_NAMES[key]; return }
        out[key] = Math.round(parseFloat(raw) * 1000)
      } else {
        if (!/^\d+$/.test(raw)) { bad = bad || FIELD_NAMES[key]; return }
        out[key] = parseInt(raw, 10)
      }
    })
    if (bad) return { error: bad }

    LISTS.forEach(function (f) { out[f[0]] = [] })
    card.querySelectorAll('input[data-list]').forEach(function (cb) {
      if (cb.checked) out[cb.dataset.list].push(cb.dataset.value)
    })
    return { value: out }
  }

  function submit() {
    if (state.busy) return
    var got = collect()
    if (got.error) {
      state.note = 'Check ' + got.error + ' — it has to be a number.'
      render()
      return
    }
    state.busy = true
    state.note = ''
    render()
    ask('settings_save', { name: 'rules', value: got.value }).then(function (res) {
      state.busy = false
      if (res && res.error) {
        state.note = explain(res.error)
        // KEEP WHAT THE OWNER TYPED. render() rebuilds every field from
        // state.rules, so leaving state alone here re-ticks the box they just
        // unticked and re-fills the number they just changed — the edit is
        // gone, under a message explaining why it was refused, and they have to
        // do it again from memory. So the REJECTED values are put back into
        // state: the form shows their work, the note says it was not accepted,
        // and the shop itself is unchanged because the server wrote nothing.
        // (An earlier version of this file claimed in a comment that the form
        // kept the edit. It did not; the panel rig caught it.)
        state.rules = got.value
      } else {
        state.rules = res
        state.note = 'Saved. The next order uses these.'
      }
      render()
    }).catch(function () {
      state.busy = false
      state.note = 'The save did not reach the shop. Check the connection and try again.'
      render()
    })
  }

  function load() {
    ask('rules').then(function (res) {
      if (!res || res.error) {
        state.note = explain(res && res.error)
        render()
        return
      }
      state.rules = res.rules
      state.defaults = res.defaults
      state.allowed = res.allowed
      render()
    })
  }

  /* ---------------------------------------------------------------- chrome - */

  var CSS = ''
    + '.srl{border:1px solid var(--border,#2a2d31);border-radius:12px;padding:16px;margin:20px 0;'
    + 'background:var(--card,rgba(255,255,255,.03))}'
    + '.srl-h{margin:0 0 4px;font-size:16px}'
    + '.srl-sub{margin:0 0 14px;opacity:.7;font-size:13px}'
    + '.srl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}'
    + '.srl-field{display:flex;flex-direction:column;gap:4px}'
    + '.srl-label{font-size:13px;font-weight:600}'
    + '.srl-hint{font-size:12px;opacity:.65;line-height:1.4}'
    + '.srl-money{display:flex;align-items:center;gap:6px}'
    + '.srl-input{flex:1;min-width:0;padding:8px 10px;border-radius:8px;'
    + 'border:1px solid var(--border,#2a2d31);background:transparent;color:inherit;font:inherit}'
    + '.srl-unit{font-size:12px;opacity:.7;white-space:nowrap}'
    + '.srl-list{margin-top:16px;display:flex;flex-direction:column;gap:4px}'
    + '.srl-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}'
    + '.srl-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;'
    + 'border:1px solid var(--border,#2a2d31);border-radius:999px;font-size:13px;cursor:pointer}'
    + '.srl-chip.is-on{border-color:var(--brand,#e0561c)}'
    + '.srl-foot{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}'
    + '.srl-save{padding:9px 16px;border-radius:8px;border:0;cursor:pointer;'
    + 'background:var(--brand,#e0561c);color:#fff;font:inherit;font-weight:600}'
    + '.srl-reset{padding:9px 16px;border-radius:8px;cursor:pointer;font:inherit;'
    + 'border:1px solid var(--border,#2a2d31);background:transparent;color:inherit}'
    + '.srl-save[disabled],.srl-reset[disabled]{opacity:.5;cursor:default}'
    + '.srl-note{margin:12px 0 0;font-size:13px;line-height:1.5}'

  function style() {
    if (document.getElementById('srl-css')) return
    var s = document.createElement('style')
    s.id = 'srl-css'
    s.textContent = CSS
    document.head.appendChild(s)
  }

  /** The Settings screen, and only it. The panel swaps its content in place, so
   *  this has to be answered again after every render — hence the observer. */
  function settingsHeading() {
    var hs = document.querySelectorAll('.admin-content h1, .admin-content h2')
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].textContent.trim() === 'Settings') return hs[i]
    }
    return null
  }

  var busy = false
  function place() {
    if (busy) return
    var head = settingsHeading()

    if (!head) {
      // Left the screen: drop the card rather than leaving it on Orders.
      if (card && card.parentNode) {
        busy = true
        card.parentNode.removeChild(card)
        card = null
        busy = false
      }
      return
    }
    if (card && card.parentNode) return

    busy = true
    style()
    card = el('div', 'srl')
    var anchor = head.parentNode
    anchor.parentNode.insertBefore(card, anchor.nextSibling)
    busy = false

    state.rules = null
    state.note = ''
    state.busy = false
    render()
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
