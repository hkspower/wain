// The live /payment/result page (www.sporta.com.kw), as the compiled build renders it: assets/PaymentResult-BnIJyJit.js of the
// live build (read from the downloaded build, 2026-11-12; the source of that build is not in this repo). Used by
// scripts/payment-receipt-test.mjs to prove the PAYMENT RECEIPT block of public/sporta-features.js on the page it will run on.
//
// What is copied VERBATIM from that chunk and the build's translations (index-BtzlNXGI.js, `result:{...}` and `invoice.view`):
//   * the container and its children, tag for tag and class for class:
//       div.purchase-result > div.purchase-result__icon[aria-hidden] , div[role=status] > h1 + p ,
//       p[dir=ltr] (the order number, wrapped in U+2066/U+2069 by the build's bidi helper) , a[href=/invoice/<id>] ,
//       div.mt-7 > a[/track?trackid=] + a[/] + a[/cart]
//   * the state logic: E = verifying while the status call is out; then paid -> success, review -> review, failed/cancelled ->
//     itself, a pending COD -> cod, ANY other answer with an order number (null = unknown order, pending KNET, a failed call)
//     -> review ("Payment received - being confirmed ... Do not pay again"); no order number -> error. Retry is shown for
//     failed/cancelled and for error without an order number; the invoice link for success and cod;
//   * the status call: GET /api/api.php?r=status&id=<order>, credentials 'omit', the JSON when the answer is OK, else null;
//   * every word, in Arabic and English.
// What is a stand-in: the shop's header and footer around it (plain boxes of about the live heights, so a layout shift below
// the result would be measured), and React itself: the shim renders with innerHTML and re-renders the whole container on a
// language switch (window.__render), the hardest case for an add-on (its node is thrown away with React's).
export const WORDS = {
  en: {
    home: 'Back to home', retry: 'Try again', track: 'Track order', invoice: 'View invoice',
    verifying: ['Checking your payment', 'We are confirming the order with the payment provider. Please wait.'],
    success: ['Payment successful', 'Your order is confirmed. Thank you!'],
    cod: ['Order confirmed', 'Pay the driver in cash when your order arrives. We will send delivery updates on WhatsApp.'],
    failed: ['Payment failed', 'You have not been charged. Please try again.'],
    cancelled: ['Payment cancelled', 'The payment was cancelled or expired.'],
    error: ['Something went wrong', 'If you were charged, contact support.'],
    review: ['Payment received — being confirmed', 'We could not confirm your order automatically. Do not pay again — our team is checking it and will contact you on WhatsApp shortly.'],
  },
  ar: {
    home: 'العودة للرئيسية', retry: 'حاول مجددًا', track: 'تتبّع الطلب', invoice: 'عرض الفاتورة',
    verifying: ['جارٍ التحقق من الدفع', 'نتحقق من حالة الطلب مع مزود الدفع. يرجى الانتظار.'],
    success: ['تم الدفع بنجاح', 'تم تأكيد طلبك. شكرًا لك!'],
    cod: ['تم تأكيد الطلب', 'ادفع للمندوب نقدًا عند وصول طلبك، وستصلك تحديثات التوصيل عبر واتساب.'],
    failed: ['فشل الدفع', 'لم يتم خصم أي مبلغ. حاول مرة أخرى.'],
    cancelled: ['تم إلغاء الدفع', 'تم إلغاء العملية أو انتهت صلاحيتها.'],
    error: ['حدث خطأ ما', 'إذا تم خصم مبلغ، تواصل مع الدعم.'],
    review: ['تم استلام الدفع — قيد التأكيد', 'لم نتمكن من تأكيد طلبك تلقائيًا. لا تدفع مرة أخرى — فريقنا يراجع العملية وسيتواصل معك عبر واتساب قريبًا.'],
  },
}

// The compiled component, as a plain script. `__render(lang)` is React rendering the route; the status answer is kept, as the
// component keeps it in state, so a language switch re-renders without a second call.
export const SHIM_JS = `
(function () {
  var W = ${JSON.stringify(WORDS)}
  var q = new URLSearchParams(location.search)
  var id = q.get('trackid') || ''
  var st = { v: null, b: null, loading: true, w: null }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') }
  function bidi(s) { return s ? '\\u2066' + s + '\\u2069' : '' }
  function state() {
    if (id && (st.loading || st.w !== id)) return 'verifying'
    var v = st.v, b = st.b
    return v === 'paid' ? 'success' : v === 'review' ? 'review' : v === 'failed' || v === 'cancelled' ? v
      : v === 'pending' && b === 'cod' ? 'cod' : id ? 'review' : 'error'
  }
  window.__render = function (lang) {
    if (lang) { document.documentElement.lang = lang; document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl' }
    var L = W[document.documentElement.lang === 'en' ? 'en' : 'ar']
    var E = state(), D = L[E] || L.verifying
    var O = E !== 'verifying', k = E === 'success' || E === 'cod'
    var A = st.v === 'failed' || st.v === 'cancelled' || (E === 'error' && !id)
    var icon = k ? '\\u2713' : E === 'review' ? '!' : E === 'verifying' ? '\\u2026' : E === 'cancelled' ? '\\u23f1' : '\\u2715'
    var tone = k ? 'text-orange-700' : (E === 'review' || E === 'verifying') ? 'text-amber-600' : 'text-rose-600'
    var h = '<div class="purchase-result mx-auto flex max-w-xl flex-col items-center px-5 py-16 text-center">' +
      '<div aria-hidden="true" class="purchase-result__icon mb-5 text-5xl ' + tone + '">' + icon + '</div>' +
      '<div role="status" aria-live="polite"><h1 class="text-2xl font-extrabold text-slate-800">' + esc(D[0]) + '</h1>' +
      '<p class="mt-2 text-slate-600">' + esc(D[1]) + '</p></div>' +
      (id ? '<p dir="ltr" class="mt-3 text-xs font-semibold tabular-nums text-slate-600">' + esc(bidi(id)) + '</p>' : '') +
      (id && k ? '<a href="/invoice/' + encodeURIComponent(id) + '" class="text-accent mt-4 text-sm font-semibold underline underline-offset-2">' + esc(L.invoice) + '</a>' : '') +
      (O ? '<div class="mt-7 flex flex-wrap justify-center gap-3">' +
        (id ? '<a href="/track?trackid=' + encodeURIComponent(id) + '" class="btn btn-primary">' + esc(L.track) + '</a>' : '') +
        '<a href="/" class="btn ' + (id ? 'border border-slate-200 text-accent' : 'btn-primary') + '">' + esc(L.home) + '</a>' +
        (A ? '<a href="/cart" class="btn border border-slate-200 text-accent">' + esc(L.retry) + '</a>' : '') +
        '</div>' : '') +
      '</div>'
    document.getElementById('route').innerHTML = h
  }
  window.__render()
  if (!id) { st.loading = false; st.w = ''; window.__render(); return }
  fetch('/api/api.php?r=status&id=' + encodeURIComponent(id), { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (t) { st.v = t && t.payment_status || null; st.b = t && t.payment_method || null })
    .catch(function () {})
    .then(function () { st.w = id; st.loading = false; window.__render() })
})()
`

// A minimal storefront frame around the route: header (64px), the route, a footer of the live height (about 420px).
export const page = (lang = 'ar') => '<!doctype html><html lang="' + lang + '" dir="' + (lang === 'en' ? 'ltr' : 'rtl') + '"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment result</title>' +
  // the live add-on stylesheet the page links in <head> (it reserves the result's height; see RECEIPT-1112 in it)
  '<link rel="stylesheet" href="/sporta-shadows.css">' +
  '<style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,Arial,sans-serif;background:#fff;color:#171A1E}' +
  'header{height:64px;background:#171A1E}footer{height:420px;background:#171A1E}' +
  '.mx-auto{margin-left:auto;margin-right:auto}.flex{display:flex}.max-w-xl{max-width:36rem}.flex-col{flex-direction:column}' +
  '.items-center{align-items:center}.px-5{padding-left:1.25rem;padding-right:1.25rem}.py-16{padding-top:4rem;padding-bottom:4rem}' +
  '.text-center{text-align:center}.mb-5{margin-bottom:1.25rem}.text-5xl{font-size:3rem;line-height:1}.text-2xl{font-size:1.5rem;line-height:2rem}' +
  '.font-extrabold{font-weight:800}.mt-2{margin-top:.5rem}.mt-3{margin-top:.75rem}.mt-4{margin-top:1rem}.mt-7{margin-top:1.75rem}' +
  '.text-xs{font-size:.75rem}.flex-wrap{flex-wrap:wrap}.justify-center{justify-content:center}.gap-3{gap:.75rem}' +
  '.btn{display:inline-flex;min-height:44px;padding:10px 18px;border-radius:10px;align-items:center}.btn-primary{background:#E0561C;color:#171A1E}' +
  '</style></head><body><div id="root"><header></header><main id="route"></main><footer></footer></div>' +
  '<script src="/payment-result-fixture.js"></script><script src="/sporta-features.js" defer></script></body></html>'
