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

  /* ARABIC-INDIC DIGITS, because the rest of the shop uses them and a size or
     a price in Latin numerals beside ٠١٢٣ reads as a different site. */
  var digits = function (n) {
    try { return Number(n).toLocaleString('ar-EG') } catch (e) { return String(n) }
  }
  var money = function (kwd) {
    try { return Number(kwd).toLocaleString('ar-EG', { minimumFractionDigits: 3 }) + ' د.ك' }
    catch (e) { return kwd + ' KWD' }
  }

  /* The sizes the shop sells, in the order it sells them. Hard-coded here and
     nowhere else on this page: this is a fallback list for an exchange, and
     the server refuses anything outside STORE_SIZES regardless of what the
     select offers, so the worst a stale entry here can do is offer a choice
     that is then refused by name. */
  var SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE']

  /* Every refusal the two routes can give, in Arabic. A JSON error token shown
     to a customer is a customer who telephones. The default is deliberately
     vague rather than echoing an unknown code — a page that has not been
     taught about a failure should not pretend to explain it. */
  var MESSAGES = {
    invalid_phone:        'رقم الهاتف غير صحيح. أدخله بالأرقام فقط، مثل ٥٥٥١٢٣٤٥.',
    return_not_found:     'لم نجد طلبًا بهذا الرقم لهذا الهاتف. تأكد من الرقمين — رقم الطلب يبدأ بحرفي SP.',
    return_not_paid:      'هذا الطلب غير مدفوع، فلا يوجد ما يُرجَع منه. إن كنت قد دفعت، تواصل معنا.',
    return_cancelled:     'هذا الطلب ملغى.',
    return_window_closed: 'انتهت مدة الأربعة عشر يومًا لهذا الطلب. تواصل معنا وسننظر في الأمر.',
    return_no_items:      'اختر قطعة واحدة على الأقل.',
    return_qty:           'العدد المطلوب أكبر من المتاح. حدِّث الصفحة وحاول مرة أخرى.',
    return_size:          'المقاس المطلوب غير متاح.',
    return_no_exchange:   'الملابس النسائية غير قابلة للاستبدال. يمكنك طلب الإرجاع بدلًا من ذلك.',
    return_line_unknown:  'حدث خطأ في اختيار القطع. حدِّث الصفحة وحاول مرة أخرى.',
    return_kind:          'اختر إرجاعًا أو استبدالًا.',
    too_many_attempts:    'محاولات كثيرة خلال وقت قصير. انتظر دقيقة ثم أعد المحاولة.'
  }

  var fail = function (box, code) {
    box.textContent = MESSAGES[code] || 'تعذّر إتمام الطلب الآن. حاول مرة أخرى بعد قليل.'
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
      name.textContent = item.name_ar || item.name_en
      body.appendChild(name)

      var meta = document.createElement('div')
      meta.className = 'meta'
      meta.textContent = [
        item.size ? 'المقاس ' + item.size : null,
        'العدد ' + digits(item.qty),
        money(item.unit_price)
      ].filter(Boolean).join(' · ')
      body.appendChild(meta)

      if (off) {
        var why = document.createElement('div')
        why.className = 'why'
        why.textContent = barred
          ? 'الملابس النسائية غير قابلة للاستبدال — يمكنك إرجاعها.'
          : 'مطلوبة بالفعل في طلب سابق.'
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
          qty.setAttribute('aria-label', 'العدد')
          for (var n = 1; n <= item.available; n++) {
            var o = document.createElement('option')
            o.value = String(n)
            o.textContent = 'العدد ' + digits(n)
            qty.appendChild(o)
          }
          opts.appendChild(qty)
        }

        if (wanting === 'exchange') {
          var size = document.createElement('select')
          size.setAttribute('data-size', String(item.id))
          size.setAttribute('aria-label', 'المقاس المطلوب')
          var none = document.createElement('option')
          none.value = ''
          none.textContent = 'نفس المقاس'
          size.appendChild(none)
          SIZES.forEach(function (s) {
            if (s === item.size) return          /* swapping for what they have */
            var o = document.createElement('option')
            o.value = s
            o.textContent = 'المقاس ' + s
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
      'الطلب ' + data.track_id

    var w = data.window
    $('window').textContent = w.open
      ? (w.days_left === 1
          ? 'باقي يوم واحد على انتهاء مدة الإرجاع.'
          : 'باقي ' + digits(w.days_left) + ' يومًا على انتهاء مدة الإرجاع.')
      : 'انتهت مدة الأربعة عشر يومًا لهذا الطلب.'

    /* The window is the server's decision, not this page's — but a form that
       cannot succeed should not be offered. */
    $('send').disabled = !w.open

    if (data.existing && data.existing.length) {
      $('window').textContent += ' لديك طلب سابق على هذه الفاتورة: ' +
        data.existing.map(function (e) { return e.ref }).join('، ') + '.'
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
    go.textContent = 'جارٍ البحث…'

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
        go.textContent = 'عرض قطع الطلب'
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
    go.textContent = 'جارٍ الإرسال…'

    fetch(api + '/api.php?r=return_request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        ref: sent.track, phone: sent.phone, kind: kind(),
        lang: 'ar', reason: $('reason').value.trim(), items: items
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d } }) })
      .then(function (res) {
        if (!res.ok || !res.d || res.d.error) { fail($('error2'), res.d && res.d.error); return }
        $('ref').textContent = res.d.ref
        $('summary').textContent =
          (res.d.kind === 'return' ? 'إرجاع ' : 'استبدال ') +
          (res.d.items === 1 ? 'قطعة واحدة' : digits(res.d.items) + ' قطع') +
          ' من الطلب ' + sent.track + '.'
        $('wa').onclick = function () { whatsapp(res.d) }
        $('pick').hidden = true
        $('done').hidden = false
        $('done').scrollIntoView({ block: 'start' })
      })
      .catch(function () { fail($('error2')) })
      .finally(function () {
        go.disabled = false
        go.textContent = 'إرسال الطلب'
      })
  })

  /* WhatsApp is the SECOND button now, not the only one. The old /returns page
     handed the whole request to it and kept nothing; this opens the same
     conversation, but about a request that already exists and has a number.
     The shop's number comes from ?r=contact — the same setting the rest of the
     site reads, so changing it in the panel changes it here too. */
  var whatsapp = function (made) {
    var text = 'طلب ' + (made.kind === 'return' ? 'إرجاع' : 'استبدال') +
               ' رقم ' + made.ref + ' — الطلب ' + sent.track + '.'
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
