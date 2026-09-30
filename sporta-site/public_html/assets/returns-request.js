/* Sporta — /returns/request: the return and exchange form.
 *
 * A separate file rather than an inline <script>, and that is a CSP decision:
 * .htaccess sets one Content-Security-Policy for the whole docroot whose
 * script-src carries a sha256 per inline script in index.html. An inline
 * script here would need its own hash added there and would stop running the
 * moment somebody edited this file without re-hashing it. `script-src 'self'`
 * covers this file unchanged, forever.
 *
 * No framework, no build step. Three fetches at most, and the middle screen is
 * built from what the SERVER says is on the order — never from anything the
 * customer typed about it.
 */
(function () {
  'use strict'

  var $ = function (id) { return document.getElementById(id) }
  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')

  /* WHICH LANGUAGE — the shop's own rule, copied from index.html's boot script
     rather than invented here, because a page that picks its language by a
     different rule than the shop is a page the shop's own toggle cannot reach:
     the saved CHOICE first, the query parameter second, Arabic if neither.
     Not written back, for the reason index.html gives — detection is not a
     choice, and persisting it would freeze a traveller into whichever language
     they first arrived in. */
  var LANG = (function () {
    var saved = null
    try { saved = localStorage.getItem('lang') } catch (e) { /* private mode */ }
    if (saved === 'ar' || saved === 'en') return saved
    var q = /[?&]lang=([A-Za-z-]{2,10})/.exec(location.search)
    if (q) {
      var tag = q[1].toLowerCase().split('-')[0]
      if (tag === 'ar' || tag === 'en') return tag
    }
    return 'ar'
  })()
  var AR = LANG === 'ar'

  /* ARABIC-INDIC DIGITS ON THE ARABIC PAGE, because the rest of the shop uses
     them and a size or a price in Latin numerals beside ٠١٢٣ reads as a
     different site — and Latin digits on the English one, for the same
     reason in reverse. */
  var digits = function (n) {
    try { return Number(n).toLocaleString(AR ? 'ar-EG' : 'en-US') } catch (e) { return String(n) }
  }
  var money = function (kwd) {
    try {
      return Number(kwd).toLocaleString(AR ? 'ar-EG' : 'en-US', { minimumFractionDigits: 3 }) +
             (AR ? ' د.ك' : ' KWD')
    } catch (e) { return kwd + ' KWD' }
  }

  /* The sizes the shop sells, in the order it sells them. Hard-coded here and
     nowhere else on this page: this is a fallback list for an exchange, and
     the server refuses anything outside STORE_SIZES regardless of what the
     select offers, so the worst a stale entry here can do is offer a choice
     that is then refused by name. */
  var SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE']

  /* Every refusal the two routes can give, in both languages. A JSON error
     token shown to a customer is a customer who telephones. The default is
     deliberately vague rather than echoing an unknown code — a page that has
     not been taught about a failure should not pretend to explain it.

     TWO OF THESE USED TO STATE A POLICY, and both were wrong to.

     `return_window_closed` said "the fourteen days are over". Fourteen is the
     SHIPPED default of `return_days`, which has been the owner's to edit in
     /backends since the rules row was built — and CLAUDE.md names the returns
     window as one of exactly two rules still stated in fixed copy. The server
     has always been right here: store_return_lookup() computes the window from
     store_rule($db, 'return_days'). So the number is taken from the window the
     server sends, and when there is no window to read the sentence simply does
     not name a number. A page that promises fourteen days while the shop
     enforces seven is worse than a page that promises nothing.

     `return_no_exchange` said "women's clothing cannot be exchanged". That is
     the rule TODAY, it is enforced per-line by the server, and CLAUDE.md says
     in as many words that it is the owner's and may change. The page is told
     which LINES are barred; it was never told why, and it should not guess. */
  var MESSAGES = {
    ar: {
      invalid_phone:        'رقم الهاتف غير صحيح. أدخله بالأرقام فقط، مثل ٥٥٥١٢٣٤٥.',
      return_not_found:     'لم نجد طلبًا بهذا الرقم لهذا الهاتف. تأكد من الرقمين — رقم الطلب يبدأ بحرفي SP.',
      return_not_paid:      'هذا الطلب غير مدفوع، فلا يوجد ما يُرجَع منه. إن كنت قد دفعت، تواصل معنا.',
      return_cancelled:     'هذا الطلب ملغى.',
      return_window_closed: 'انتهت مدة الإرجاع لهذا الطلب. تواصل معنا وسننظر في الأمر.',
      return_no_items:      'اختر قطعة واحدة على الأقل.',
      return_qty:           'العدد المطلوب أكبر من المتاح. حدِّث الصفحة وحاول مرة أخرى.',
      return_size:          'المقاس المطلوب غير متاح.',
      return_no_exchange:   'هذه القطعة غير قابلة للاستبدال. يمكنك طلب إرجاعها بدلًا من ذلك.',
      return_line_unknown:  'حدث خطأ في اختيار القطع. حدِّث الصفحة وحاول مرة أخرى.',
      return_kind:          'اختر إرجاعًا أو استبدالًا.',
      too_many_attempts:    'محاولات كثيرة خلال وقت قصير. انتظر دقيقة ثم أعد المحاولة.',
      _default:             'تعذّر إتمام الطلب الآن. حاول مرة أخرى بعد قليل.'
    },
    en: {
      invalid_phone:        'That phone number is not right. Type the digits only, like 55512345.',
      return_not_found:     'We could not find an order with that number for that phone. Check both — an order number starts with SP.',
      return_not_paid:      'This order has not been paid for, so there is nothing to return. If you have paid, get in touch.',
      return_cancelled:     'This order was cancelled.',
      return_window_closed: 'The return window for this order has closed. Get in touch and we will take a look.',
      return_no_items:      'Choose at least one item.',
      return_qty:           'That is more than you have left to ask about. Refresh the page and try again.',
      return_size:          'That size is not one the shop offers.',
      return_no_exchange:   'This item cannot be exchanged. You can ask to return it instead.',
      return_line_unknown:  'Something went wrong choosing the items. Refresh the page and try again.',
      return_kind:          'Choose a return or an exchange.',
      too_many_attempts:    'Too many tries in a short time. Wait a minute and try again.',
      _default:             'We could not complete that just now. Try again shortly.'
    }
  }

  /* Every word on the page, keyed by the data-i18n attributes in the HTML.
     Arabic is the copy WRITTEN in the file, so this half only has to exist for
     the swap — but it is listed rather than read back out of the DOM, because
     a page that rebuilds its Arabic from whatever happens to be on screen
     cannot be switched back after an English render. */
  var T = {
    ar: {
      title: 'طلب إرجاع أو استبدال — سبورتا',
      h1: 'طلب إرجاع أو استبدال',
      lede: 'أدخل رقم طلبك ورقم هاتفك، وسنعرض لك القطع التي اشتريتها لتختار منها. الاستلام من عندك.',
      orderNo: 'رقم الطلب', phoneNo: 'رقم الهاتف', phonePh: '٥٥٥١٢٣٤٥',
      hint: 'نفس الرقم الذي طلبت به. تجد رقم الطلب في رسالة التأكيد أو على الفاتورة.',
      find: 'عرض قطع الطلب', finding: 'جارٍ البحث…',
      h1pick: 'اختر القطع', kindGroup: 'نوع الطلب',
      exchange: 'استبدال', exchangeSub: 'مقاس آخر',
      'return': 'إرجاع', returnSub: 'استرجاع المبلغ',
      items: 'القطع', reason: 'السبب',
      reasonPh: 'المقاس غير مناسب / القطعة تالفة / الجودة غير متوقعة',
      send: 'إرسال الطلب', sending: 'جارٍ الإرسال…', another: 'طلب آخر',
      h1done: 'وصلنا طلبك',
      keepRef: 'رقم الطلب — احتفظ به، وسيسألك عنه المندوب.',
      condition: 'القطع يجب أن تكون غير ملبوسة وغير مغسولة مع البطاقات الأصلية.',
      wa: 'متابعة عبر واتساب',
      policy: 'سياسة الإرجاع والاستبدال', backToShop: 'العودة إلى المتجر',
      sizeLabel: 'المقاس المطلوب', sameSize: 'نفس المقاس', sizeIs: 'المقاس ',
      qtyLabel: 'العدد', qtyIs: 'العدد ',
      alreadyAsked: 'مطلوبة بالفعل في طلب سابق.',
      cannotExchange: 'هذه القطعة غير قابلة للاستبدال — يمكنك إرجاعها.',
      orderIs: 'الطلب ',
      daysLeftOne: 'باقي يوم واحد على انتهاء مدة الإرجاع.',
      daysLeft: function (n) { return 'باقي ' + digits(n) + ' يومًا على انتهاء مدة الإرجاع.' },
      windowShut: 'انتهت مدة الإرجاع لهذا الطلب.',
      windowShutDays: function (n) { return 'انتهت مدة الـ' + digits(n) + ' يومًا لهذا الطلب.' },
      earlier: function (refs) { return ' لديك طلب سابق على هذه الفاتورة: ' + refs + '.' },
      summary: function (kind, n, track) {
        return (kind === 'return' ? 'إرجاع ' : 'استبدال ') +
               (n === 1 ? 'قطعة واحدة' : digits(n) + ' قطع') + ' من الطلب ' + track + '.'
      },
      next: function (phone) { return 'سنتصل بك على ' + phone + ' لتحديد موعد الاستلام.' },
      waText: function (kind, ref, track) {
        return 'طلب ' + (kind === 'return' ? 'إرجاع' : 'استبدال') + ' رقم ' + ref + ' — الطلب ' + track + '.'
      }
    },
    en: {
      title: 'Return or exchange — Sporta',
      h1: 'Return or exchange',
      lede: 'Enter your order number and phone number and we will show you what you bought, so you can pick from it. We collect from you.',
      orderNo: 'Order number', phoneNo: 'Phone number', phonePh: '55512345',
      hint: 'The same number you ordered with. Your order number is in the confirmation message and on the invoice.',
      find: 'Show the items', finding: 'Looking…',
      h1pick: 'Choose the items', kindGroup: 'Return or exchange',
      exchange: 'Exchange', exchangeSub: 'a different size',
      'return': 'Return', returnSub: 'money back',
      items: 'Items', reason: 'Reason',
      reasonPh: 'Wrong size / arrived damaged / not what I expected',
      send: 'Send the request', sending: 'Sending…', another: 'Another request',
      h1done: 'We have your request',
      keepRef: 'Your reference — keep it, the driver will ask for it.',
      condition: 'Items must be unworn, unwashed and still have their original tags.',
      wa: 'Continue on WhatsApp',
      policy: 'Returns and exchanges policy', backToShop: 'Back to the shop',
      sizeLabel: 'Size wanted', sameSize: 'Same size', sizeIs: 'Size ',
      qtyLabel: 'How many', qtyIs: 'Qty ',
      alreadyAsked: 'Already asked for in an earlier request.',
      cannotExchange: 'This item cannot be exchanged — you can return it.',
      orderIs: 'Order ',
      daysLeftOne: 'One day left to ask for a return.',
      daysLeft: function (n) { return digits(n) + ' days left to ask for a return.' },
      windowShut: 'The return window for this order has closed.',
      windowShutDays: function (n) { return 'The ' + digits(n) + '-day return window for this order has closed.' },
      earlier: function (refs) { return ' You already have a request on this order: ' + refs + '.' },
      summary: function (kind, n, track) {
        return (kind === 'return' ? 'Return of ' : 'Exchange of ') +
               (n === 1 ? '1 item' : digits(n) + ' items') + ' from order ' + track + '.'
      },
      next: function (phone) { return 'We will call you on ' + phone + ' to arrange collection.' },
      waText: function (kind, ref, track) {
        return (kind === 'return' ? 'Return' : 'Exchange') + ' request ' + ref + ' — order ' + track + '.'
      }
    }
  }
  var t = T[LANG]

  /* Paint the page in the chosen language. Runs once, before anything is
     shown: the HTML ships Arabic so a visitor with no JavaScript still gets a
     real page, and this is the swap. */
  function translate() {
    document.documentElement.lang = LANG
    document.documentElement.dir = AR ? 'rtl' : 'ltr'
    var n = document.querySelectorAll('[data-i18n]')
    for (var i = 0; i < n.length; i++) {
      var v = t[n[i].getAttribute('data-i18n')]
      if (typeof v === 'string') n[i].textContent = v
    }
    n = document.querySelectorAll('[data-i18n-ph]')
    for (i = 0; i < n.length; i++) {
      var p = t[n[i].getAttribute('data-i18n-ph')]
      if (typeof p === 'string') n[i].setAttribute('placeholder', p)
    }
    n = document.querySelectorAll('[data-i18n-aria]')
    for (i = 0; i < n.length; i++) {
      var a = t[n[i].getAttribute('data-i18n-aria')]
      if (typeof a === 'string') n[i].setAttribute('aria-label', a)
    }
    var img = document.querySelector('img.brand')
    if (img) img.alt = AR ? 'سبورتا' : 'Sporta'
  }
  translate()

  var fail = function (box, code) {
    box.textContent = MESSAGES[LANG][code] || MESSAGES[LANG]._default
    box.hidden = false
    /* Move focus so a screen reader lands on the reason rather than staying on
       a submit button that appears to have done nothing. */
    box.setAttribute('tabindex', '-1')
    box.focus()
  }

  /* What was looked up, and what came back. Held so the submit step sends the
     same reference and phone the lookup succeeded with, rather than re-reading
     inputs the customer may have edited in between. */
  var found = null
  var sent = { track: '', phone: '' }

  /* The phone is stripped to digits HERE only to remove the spaces and dashes
     a customer types. Every real decision about what a Kuwaiti number is stays
     in store_phone() on the server, which is the one place that knows what the
     orders table holds — normalising properly in two places is how the first
     version of ?r=loyalty returned 403 to a customer who plainly existed. */
  var clean = function () {
    return {
      track: $('track').value.trim().toUpperCase(),
      phone: $('phone').value.replace(/[^\d]/g, '')
    }
  }

  var kind = function () {
    var el = document.querySelector('input[name=kind]:checked')
    return el ? el.value : 'exchange'
  }

  /* HOW LONG THE WINDOW IS, from the window itself.
     `from` is when it opened and `deadline` when it closes, both sent by
     store_return_window(), which computes them from the owner's `return_days`.
     So the difference IS that number, however it has been edited, and this
     page never has to hold a copy of it. Returns null rather than a guess when
     either timestamp is missing or unparseable — a sentence with no number is
     honest, and one with the wrong number is the fault being fixed. */
  var windowDays = function (w) {
    if (!w || !w.from || !w.deadline) return null
    var a = Date.parse(String(w.from).replace(' ', 'T'))
    var b = Date.parse(String(w.deadline).replace(' ', 'T'))
    if (!isFinite(a) || !isFinite(b) || b <= a) return null
    return Math.round((b - a) / 86400000)
  }

  /* The items actually asked for, on the confirmation screen.
     Every word of this comes from the ORDER as the server described it and
     from what the customer ticked — nothing about timing, refunds or carriers,
     because this page does not know those and must not invent them. */
  var listChosen = function (items) {
    var ul = $('chose')
    if (!ul) return
    ul.textContent = ''
    var byId = {}
    if (found && found.items) {
      found.items.forEach(function (i) { byId[i.id] = i })
    }
    items.forEach(function (row) {
      var it = byId[row.id]
      if (!it) return
      var bits = [AR ? (it.name_ar || it.name_en) : (it.name_en || it.name_ar)]
      if (it.size && row.want_size) bits.push(t.sizeIs + it.size + ' \u2192 ' + row.want_size)
      else if (it.size) bits.push(t.sizeIs + it.size)
      if (row.qty > 1) bits.push(t.qtyIs + digits(row.qty))
      var li = document.createElement('li')
      li.textContent = bits.join(' · ')
      ul.appendChild(li)
    })
  }

  /* ---------------------------------------------------------------- step 2 */

  var drawLines = function () {
    var wrap = $('lines')
    wrap.textContent = ''
    var wanting = kind()

    found.items.forEach(function (item, i) {
      var row = document.createElement('div')
      row.className = 'line'

      /* A line is unavailable for two different reasons, and the customer is
         told which. Both grey the row; only one of them changes when the
         return/exchange choice changes, which is why this is redrawn. */
      var spent = item.available < 1
      var barred = wanting === 'exchange' && item.no_exchange
      var off = spent || barred

      var box = document.createElement('input')
      box.type = 'checkbox'
      box.id = 'line-' + item.id
      box.setAttribute('data-line', String(item.id))
      box.disabled = off

      var body = document.createElement('div')
      body.className = 'body'

      var name = document.createElement('label')
      name.className = 'name'
      name.htmlFor = box.id
      name.textContent = (AR ? (item.name_ar || item.name_en) : (item.name_en || item.name_ar))
      body.appendChild(name)

      var meta = document.createElement('div')
      meta.className = 'meta'
      meta.textContent = [
        item.size ? t.sizeIs + item.size : null,
        t.qtyIs + digits(item.qty),
        money(item.unit_price)
      ].filter(Boolean).join(' · ')
      body.appendChild(meta)

      if (off) {
        var why = document.createElement('div')
        why.className = 'why'
        why.textContent = barred ? t.cannotExchange : t.alreadyAsked
        body.appendChild(why)
      } else {
        var opts = document.createElement('div')
        opts.className = 'opts'

        /* The quantity picker only appears when there is a choice to make. A
           select offering "١" and nothing else is a control that cannot be
           used, and every line on a normal order is quantity one. */
        if (item.available > 1) {
          var qty = document.createElement('select')
          qty.setAttribute('data-qty', String(item.id))
          qty.setAttribute('aria-label', t.qtyLabel)
          for (var n = 1; n <= item.available; n++) {
            var o = document.createElement('option')
            o.value = String(n)
            o.textContent = t.qtyIs + digits(n)
            qty.appendChild(o)
          }
          opts.appendChild(qty)
        }

        if (wanting === 'exchange') {
          var size = document.createElement('select')
          size.setAttribute('data-size', String(item.id))
          size.setAttribute('aria-label', t.sizeLabel)
          var none = document.createElement('option')
          none.value = ''
          none.textContent = t.sameSize
          size.appendChild(none)
          SIZES.forEach(function (s) {
            if (s === item.size) return          /* swapping for what they have */
            var o = document.createElement('option')
            o.value = s
            o.textContent = t.sizeIs + s
            size.appendChild(o)
          })
          opts.appendChild(size)
        }

        if (opts.children.length) body.appendChild(opts)
      }

      if (off) row.className = 'line off'
      row.appendChild(box)
      row.appendChild(body)
      wrap.appendChild(row)
    })
  }

  var showOrder = function (data) {
    found = data
    $('who').textContent = (data.customer_name ? data.customer_name + ' — ' : '') +
      t.orderIs + data.track_id

    var w = data.window
    /* THE LENGTH OF THE WINDOW IS DERIVED, not named. The server sends when it
       opened and when it closes, and the difference between those two is the
       owner's `return_days` whatever they have set it to — so this needs no
       extra request and cannot drift from the rule the server enforces. If
       either timestamp is missing the sentence is written without a number
       rather than with a guessed one. */
    var span = windowDays(w)
    $('window').textContent = w.open
      ? (w.days_left === 1 ? t.daysLeftOne : t.daysLeft(w.days_left))
      : (span ? t.windowShutDays(span) : t.windowShut)

    /* The window is the server's decision, not this page's — but a form that
       cannot succeed should not be offered. */
    $('send').disabled = !w.open

    if (data.existing && data.existing.length) {
      $('window').textContent += t.earlier(
        data.existing.map(function (e) { return e.ref }).join(AR ? '، ' : ', '))
    }

    drawLines()
    $('ask').hidden = true
    $('pick').hidden = false
    $('pick').scrollIntoView({ block: 'start' })
  }

  /* Read the ticked lines out of the DOM. */
  var chosen = function () {
    var out = []
    var boxes = $('lines').querySelectorAll('input[type=checkbox]')
    Array.prototype.forEach.call(boxes, function (box) {
      if (!box.checked || box.disabled) return
      var id = box.getAttribute('data-line')
      var qty = $('lines').querySelector('[data-qty="' + id + '"]')
      var size = $('lines').querySelector('[data-size="' + id + '"]')
      var row = { id: Number(id), qty: qty ? Number(qty.value) : 1 }
      if (size && size.value) row.want_size = size.value
      out.push(row)
    })
    return out
  }

  /* ---------------------------------------------------------------- wiring */

  $('lookup').addEventListener('submit', function (e) {
    e.preventDefault()
    $('error').hidden = true
    sent = clean()
    if (!sent.track) { fail($('error'), 'return_not_found'); return }
    if (!sent.phone) { fail($('error'), 'invalid_phone'); return }

    var go = $('find')
    go.disabled = true
    go.textContent = t.finding

    fetch(api + '/api.php?r=return_items&ref=' + encodeURIComponent(sent.track) +
          '&phone=' + encodeURIComponent(sent.phone), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d } }) })
      .then(function (res) {
        if (!res.ok || !res.d || res.d.error) { fail($('error'), res.d && res.d.error); return }
        showOrder(res.d)
      })
      .catch(function () { fail($('error')) })
      .finally(function () {
        go.disabled = false
        go.textContent = t.find
      })
  })

  /* Redraw when the customer changes their mind about return vs exchange: the
     size pickers appear or vanish, and women's lines become available or not. */
  Array.prototype.forEach.call(document.querySelectorAll('input[name=kind]'), function (el) {
    el.addEventListener('change', drawLines)
  })

  $('request').addEventListener('submit', function (e) {
    e.preventDefault()
    $('error2').hidden = true
    var items = chosen()
    if (!items.length) { fail($('error2'), 'return_no_items'); return }

    var go = $('send')
    go.disabled = true
    go.textContent = t.sending

    fetch(api + '/api.php?r=return_request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        ref: sent.track, phone: sent.phone, kind: kind(),
        lang: LANG, reason: $('reason').value.trim(), items: items
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d } }) })
      .then(function (res) {
        if (!res.ok || !res.d || res.d.error) { fail($('error2'), res.d && res.d.error); return }
        $('ref').textContent = res.d.ref
        $('summary').textContent = t.summary(res.d.kind, res.d.items, sent.track)
        /* WHAT HAPPENS NEXT, and on which number. The confirmation used to end
           at the reference and a one-line count, which tells a customer their
           request exists and nothing about what to expect. The phone is the
           one they typed and the one the shop will ring — it is their own
           fact, not a promise this page invented, and seeing it is how a
           mistyped digit gets caught while they are still on the page. */
        $('next').textContent = t.next(sent.phone)
        listChosen(items)
        $('wa').onclick = function () { whatsapp(res.d) }
        $('pick').hidden = true
        $('done').hidden = false
        $('done').scrollIntoView({ block: 'start' })
      })
      .catch(function () { fail($('error2')) })
      .finally(function () {
        go.disabled = false
        go.textContent = t.send
      })
  })

  /* WhatsApp is the SECOND button now, not the only one. The old /returns page
     handed the whole request to it and kept nothing; this opens the same
     conversation, but about a request that already exists and has a number.
     The shop's number comes from ?r=contact — the same setting the rest of the
     site reads, so changing it in the panel changes it here too. */
  var whatsapp = function (made) {
    var text = t.waText(made.kind, made.ref, sent.track)
    fetch(api + '/api.php?r=contact', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json() })
      .then(function (c) {
        var n = (c && c.whatsapp) ? String(c.whatsapp).replace(/[^\d]/g, '') : ''
        /* No number configured is not a reason to open wa.me/ and land the
           customer on WhatsApp's own error page. */
        if (!n) { fail($('error2')); return }
        window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(text), '_blank', 'noopener')
      })
      .catch(function () { fail($('error2')) })
  }

  var restart = function () {
    found = null
    $('done').hidden = true
    $('pick').hidden = true
    $('ask').hidden = false
    $('error').hidden = true
    $('error2').hidden = true
    $('reason').value = ''
    $('ask').scrollIntoView({ block: 'start' })
  }
  $('back').addEventListener('click', restart)
  $('again').addEventListener('click', restart)

  /* Arriving from the order page or a confirmation message, with the order
     number already known: /returns/request?o=SP1A2B3C fills it in so the
     customer only has to prove the phone. Nothing is looked up automatically —
     the phone is still the gate. */
  var qs = new URLSearchParams(window.location.search)
  if (qs.get('o')) {
    $('track').value = qs.get('o').trim().toUpperCase()
    $('phone').focus()
  }
})()
