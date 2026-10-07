/* Sporta — /card, the loyalty balance and the Wallet download.
 *
 * A separate file rather than an inline <script>, and that is a CSP decision,
 * not a style one: .htaccess sets one Content-Security-Policy for the whole
 * docroot whose script-src carries a sha256 per inline script in index.html.
 * An inline script here would need its own hash added there, and would stop
 * running the moment somebody edited this file without re-hashing it — a
 * failure that shows up as a dead button and nothing in the log. `script-src
 * 'self'` already covers this file, unchanged, forever.
 *
 * No framework, no build step. The whole page is two fetches.
 */
(function () {
  'use strict'

  var $ = function (id) { return document.getElementById(id) }
  var ask = $('ask'), result = $('result'), form = $('form')
  var errorBox = $('error')

  /* WHICH LANGUAGE — the shop's own rule, copied from index.html's boot script (as
     returns-request.js does) rather than invented: the saved CHOICE first, the query
     parameter second, Arabic if neither. Not written back. The HTML ships Arabic so a
     visitor with no JavaScript still gets a real page; translate() below is the swap. */
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

  /* ARABIC-INDIC DIGITS on the Arabic page, because the rest of the shop uses them and a
     balance rendered in Latin numerals beside prices in ٠١٢٣ reads as a different site —
     and Latin digits on the English page, for the same reason in reverse. toLocaleString
     does this correctly for ar-EG, including grouping. */
  var digits = function (n) {
    try { return Number(n).toLocaleString(AR ? 'ar-EG' : 'en-US') } catch (e) { return String(n) }
  }

  /* Every word on the page. The Arabic is the copy that was always here, unchanged; the
     English is its translation. Every refusal the server can give is here too: a JSON error
     code shown to a customer is a customer who telephones. The default is deliberately vague
     rather than echoing an unknown code — if this page has not been taught about a failure,
     it should not pretend to explain it. */
  var T = {
    ar: {
      pageTitle: 'بطاقة الولاء — سبورتا', brand: 'سبورتا', back: 'العودة إلى المتجر',
      title: 'بطاقة الولاء',
      lede: 'نقطة واحدة لكل ١٠٠ فلس تنفقها في سبورتا. أدخل رقمك ورقم أي طلب سابق لعرض رصيدك.',
      phone: 'رقم الهاتف', phonePh: '٥٥٥١٢٣٤٥', track: 'رقم أي طلب سابق',
      hint: 'نطلبه مرة واحدة فقط، للتأكد أن الرقم رقمك. تجده في رسالة تأكيد الطلب أو على الفاتورة.',
      go: 'عرض رصيدي', checking: 'جارٍ التحقق…', points: 'نقطة',
      add: 'إضافة إلى Apple Wallet', again: 'رقم آخر',
      tiers: { base: 'أساسي', silver: 'فضي', gold: 'ذهبي' },
      invalid_phone: 'رقم الهاتف غير صحيح. أدخله بالأرقام فقط، مثل ٥٥٥١٢٣٤٥.',
      order_not_found_for_phone: 'لم نجد طلبًا بهذا الرقم لهذا الهاتف. تأكد من الرقمين — رقم الطلب يبدأ بحرفي SP.',
      too_many_attempts: 'محاولات كثيرة خلال وقت قصير. انتظر دقيقة ثم أعد المحاولة.',
      wallet_not_configured: 'البطاقة غير جاهزة بعد. رصيدك محفوظ ويظهر أعلاه.',
      fallback: 'تعذّر عرض الرصيد الآن. حاول مرة أخرى بعد قليل.',
      hello: function (n) { return 'أهلًا، ' + n }, welcome: 'أهلًا بك',
      oneOrder: 'طلب واحد مدفوع', orders: function (n) { return n + ' طلبات مدفوعة' },
      tier: function (x) { return 'المستوى: ' + x },
      next: function (n) { return 'باقي ' + n + ' نقطة للمستوى التالي.' },
      soon: 'بطاقة Apple Wallet قادمة قريبًا. رصيدك محفوظ ويُحدَّث مع كل طلب.',
      iphone: 'بطاقة Apple Wallet متاحة على iPhone. افتح هذه الصفحة من هاتفك لإضافتها.',
      have: 'بطاقتك موجودة. أضِفها مرة أخرى لتحديث الرصيد.',
      addCard: 'أضِف البطاقة لعرض رصيدك من شاشة القفل.'
    },
    en: {
      pageTitle: 'Loyalty card — Sporta', brand: 'Sporta', back: 'Back to the shop',
      title: 'Loyalty card',
      lede: 'One point for every 100 fils you spend at Sporta. Enter your number and any previous order number to see your balance.',
      phone: 'Phone number', phonePh: '55512345', track: 'Any previous order number',
      hint: 'We ask once, to make sure the number is yours. You will find it in your order confirmation message or on the invoice.',
      go: 'Show my balance', checking: 'Checking…', points: 'points',
      add: 'Add to Apple Wallet', again: 'Another number',
      tiers: { base: 'Basic', silver: 'Silver', gold: 'Gold' },
      invalid_phone: 'That phone number is not valid. Enter digits only, for example 55512345.',
      order_not_found_for_phone: 'We could not find an order with this number for this phone. Check both numbers — the order number starts with the letters SP.',
      too_many_attempts: 'Too many attempts in a short time. Wait a minute and try again.',
      wallet_not_configured: 'The card is not ready yet. Your balance is saved and shown above.',
      fallback: 'We could not show your balance right now. Please try again shortly.',
      hello: function (n) { return 'Hello, ' + n }, welcome: 'Welcome',
      oneOrder: '1 paid order', orders: function (n) { return n + ' paid orders' },
      tier: function (x) { return 'Level: ' + x },
      next: function (n) { return n + ' points to the next level.' },
      soon: 'The Apple Wallet card is coming soon. Your balance is saved and updates with every order.',
      iphone: 'The Apple Wallet card is available on iPhone. Open this page on your phone to add it.',
      have: 'You already have the card. Add it again to refresh the balance.',
      addCard: 'Add the card to see your balance from the lock screen.'
    }
  }
  var t = T[LANG]

  function translate() {
    document.documentElement.lang = LANG
    document.documentElement.dir = AR ? 'rtl' : 'ltr'
    document.title = t.pageTitle
    var n = document.querySelectorAll('[data-i18n]'), i
    for (i = 0; i < n.length; i++) { var v = t[n[i].getAttribute('data-i18n')]; if (typeof v === 'string') n[i].textContent = v }
    n = document.querySelectorAll('[data-i18n-ph]')
    for (i = 0; i < n.length; i++) { var p = t[n[i].getAttribute('data-i18n-ph')]; if (typeof p === 'string') n[i].setAttribute('placeholder', p) }
    var img = document.querySelector('img.brand')
    if (img) img.alt = t.brand
  }
  translate()

  var fail = function (code) {
    errorBox.textContent = (typeof t[code] === 'string' && /^(invalid_phone|order_not_found_for_phone|too_many_attempts|wallet_not_configured)$/.test(code) ? t[code] : t.fallback)
    errorBox.hidden = false
    // Move focus so a screen reader lands on the reason rather than staying
    // on a submit button that appears to have done nothing.
    errorBox.setAttribute('tabindex', '-1')
    errorBox.focus()
  }

  /* The two inputs, as the server wants them.
     The phone is stripped to digits HERE only to remove spaces and dashes a
     customer types; every real decision about what a Kuwaiti number is stays
     in store_phone() on the server, which is the one place that knows what the
     orders table holds. Normalising properly in two places is how the first
     version of ?r=loyalty returned 403 to a customer who plainly existed.
     Arabic (٠-٩) and Persian (۰-۹) digits become 0-9 FIRST: `\d` is ASCII-only,
     so the number pad of an Arabic phone — this page's own placeholder, ٥٥٥١٢٣٤٥
     — was stripped to nothing and refused as invalid_phone. */
  var west = function (s) {
    return String(s).replace(/[\u0660-\u0669\u06F0-\u06F9]/g, function (c) {
      var n = c.charCodeAt(0)
      return String(n >= 0x06F0 ? n - 0x06F0 : n - 0x0660)
    })
  }
  var clean = function () {
    return {
      phone: west($('phone').value).replace(/[^\d]/g, ''),
      track: $('track').value.trim().toUpperCase()
    }
  }

  var show = function (data, sent) {
    $('who').textContent = data.name ? t.hello(data.name) : t.welcome
    $('orders').textContent = data.paid_orders === 1
      ? t.oneOrder
      : t.orders(digits(data.paid_orders))
    $('points').textContent = digits(data.points)
    $('tier').textContent = t.tier(t.tiers[data.tier] || data.tier)

    if (data.next_tier_at) {
      $('progress').hidden = false
      var pct = Math.max(0, Math.min(100, (data.points / data.next_tier_at) * 100))
      $('bar').style.width = pct.toFixed(1) + '%'
      $('next').textContent = t.next(digits(data.next_tier_at - data.points))
    } else {
      $('progress').hidden = true
    }

    /* THE DOWNLOAD BUTTON IS CONDITIONAL ON TWO THINGS, and both matter.
     *
     * card_ready — the server says whether it can actually sign a pass. It
     * cannot until the shop's Apple certificate is installed, and offering a
     * button that answers 503 would read to a customer as a broken shop rather
     * than a feature that has not launched.
     *
     * iOS — a .pkpass is an iPhone file. Most of Kuwait is not on one, and
     * handing an Android customer a download they cannot open is worse than
     * telling them their balance and stopping there. Apple Wallet exists on
     * iPhone and on Mac; iPad has no Wallet app, so it is not included. */
    var isApple = /iPhone|iPod/.test(navigator.userAgent) ||
                  (/Macintosh/.test(navigator.userAgent) && !('ontouchend' in document))
    var add = $('add')
    if (!data.card_ready) {
      add.hidden = true
      $('addnote').textContent = t.soon
    } else if (!isApple) {
      add.hidden = true
      $('addnote').textContent = t.iphone
    } else {
      add.hidden = false
      $('addnote').textContent = data.has_card
        ? t.have
        : t.addCard
      add.onclick = function () {
        /* A NAVIGATION, not fetch + blob. iOS installs a .pkpass from a real
           navigation with the right content type; a Blob URL opens a file the
           customer then has to find and tap again, if Safari does not simply
           refuse it. The server sends Content-Disposition, so this does not
           leave the page. */
        window.location.href = '/api/wallet.php?r=loyalty&phone=' +
          encodeURIComponent(sent.phone) + '&track=' + encodeURIComponent(sent.track)
      }
    }

    ask.hidden = true
    result.hidden = false
    result.scrollIntoView({ block: 'start' })
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault()
    var sent = clean()
    errorBox.hidden = true
    if (!sent.phone) { fail('invalid_phone'); return }
    if (!sent.track) { fail('order_not_found_for_phone'); return }

    var go = $('go')
    go.disabled = true
    go.textContent = t.checking

    fetch('/api/wallet.php?r=balance&phone=' + encodeURIComponent(sent.phone) +
          '&track=' + encodeURIComponent(sent.track), { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d } }) })
      .then(function (res) {
        if (!res.ok || !res.d || res.d.error) { fail(res.d && res.d.error); return }
        show(res.d, sent)
      })
      .catch(function () { fail() })
      .finally(function () {
        go.disabled = false
        go.textContent = t.go
      })
  })

  $('again').addEventListener('click', function () {
    result.hidden = true
    ask.hidden = false
    errorBox.hidden = true
    $('phone').value = ''
    $('track').value = ''
    $('phone').focus()
  })
})()
