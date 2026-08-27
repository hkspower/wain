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

  /* ARABIC-INDIC DIGITS, because the rest of the shop uses them and a balance
     rendered in Latin numerals beside prices in ٠١٢٣ reads as a different
     site. toLocaleString does this correctly for ar-EG, including grouping. */
  var digits = function (n) {
    try { return Number(n).toLocaleString('ar-EG') } catch (e) { return String(n) }
  }

  var TIERS = { base: 'أساسي', silver: 'فضي', gold: 'ذهبي' }

  /* Every refusal the server can give, in Arabic. A JSON error code shown to a
     customer is a customer who telephones. The default is deliberately vague
     rather than echoing an unknown code — if this page has not been taught
     about a failure, it should not pretend to explain it. */
  var MESSAGES = {
    invalid_phone: 'رقم الهاتف غير صحيح. أدخله بالأرقام فقط، مثل ٥٥٥١٢٣٤٥.',
    order_not_found_for_phone: 'لم نجد طلبًا بهذا الرقم لهذا الهاتف. تأكد من الرقمين — رقم الطلب يبدأ بحرفي SP.',
    too_many_attempts: 'محاولات كثيرة خلال وقت قصير. انتظر دقيقة ثم أعد المحاولة.',
    wallet_not_configured: 'البطاقة غير جاهزة بعد. رصيدك محفوظ ويظهر أعلاه.'
  }

  var fail = function (code) {
    errorBox.textContent = MESSAGES[code] || 'تعذّر عرض الرصيد الآن. حاول مرة أخرى بعد قليل.'
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
     version of ?r=loyalty returned 403 to a customer who plainly existed. */
  var clean = function () {
    return {
      phone: $('phone').value.replace(/[^\d]/g, ''),
      track: $('track').value.trim().toUpperCase()
    }
  }

  var show = function (data, sent) {
    $('who').textContent = data.name ? ('أهلًا، ' + data.name) : 'أهلًا بك'
    $('orders').textContent = data.paid_orders === 1
      ? 'طلب واحد مدفوع'
      : digits(data.paid_orders) + ' طلبات مدفوعة'
    $('points').textContent = digits(data.points)
    $('tier').textContent = 'المستوى: ' + (TIERS[data.tier] || data.tier)

    if (data.next_tier_at) {
      $('progress').hidden = false
      var pct = Math.max(0, Math.min(100, (data.points / data.next_tier_at) * 100))
      $('bar').style.width = pct.toFixed(1) + '%'
      $('next').textContent = 'باقي ' + digits(data.next_tier_at - data.points) +
        ' نقطة للمستوى التالي.'
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
      $('addnote').textContent = 'بطاقة Apple Wallet قادمة قريبًا. رصيدك محفوظ ويُحدَّث مع كل طلب.'
    } else if (!isApple) {
      add.hidden = true
      $('addnote').textContent = 'بطاقة Apple Wallet متاحة على iPhone. افتح هذه الصفحة من هاتفك لإضافتها.'
    } else {
      add.hidden = false
      $('addnote').textContent = data.has_card
        ? 'بطاقتك موجودة. أضِفها مرة أخرى لتحديث الرصيد.'
        : 'أضِف البطاقة لعرض رصيدك من شاشة القفل.'
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
    go.textContent = 'جارٍ التحقق…'

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
        go.textContent = 'عرض رصيدي'
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
