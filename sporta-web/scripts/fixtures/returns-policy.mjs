// The live /returns and /exchange page (www.sporta.com.kw; one compiled page for both addresses), as far as a read-only probe
// could see it on 2026-11-10 (390 px, Arabic and English, no lookup submitted): the wrapper and section CLASS NAMES, the three
// headings, the five fixed policy points and the two links are the live ones, word for word. Used by site-content-test.mjs.
//
// WHAT IS NOT KNOWN, and why there are two variants. The probe returned innerText, not markup, so the TAGS that hold the five
// points are not known (and points 4 and 5 may be one element). The storefront script must therefore not depend on them:
//   'list'   the points as <ul><li>, one element each;
//   'paras'  the points as <p> directly inside the section, points 4 and 5 in ONE paragraph.
// The form fields, the intro paragraph's wording and the post-lookup screen were not captured: the intro sentence and the form
// below are stand-ins (marked), and nothing in the suite depends on what the page shows after a lookup.
export const POINTS = {
  en: [
    'Contact us within 14 days of delivery. We review every request under the applicable policy and consumer rules.',
    'Keep items unworn and unwashed, with original tags and packaging where possible. Hygiene-sensitive items may need special review.',
    'Free collection is arranged for eligible requests after our team confirms the request.',
    'For KNET or card orders, approved refunds are arranged to the original payment method.',
    'Cash-order refund arrangements are confirmed with you after review.',
  ],
  ar: [
    'تواصل معنا خلال ١٤ يومًا من التسليم. نراجع كل طلب وفق السياسة المعمول بها وقواعد حماية المستهلك.',
    'احتفظ بالمنتج دون ارتداء أو غسل، مع بطاقاته وتغليفه الأصلي قدر الإمكان. قد تتطلب المنتجات الحساسة صحيًا مراجعة خاصة.',
    'نرتب الاستلام مجانًا للطلبات المؤهلة بعد تأكيد فريقنا.',
    'لطلبات كي نت أو البطاقة، نرتب رد المبلغ المعتمد إلى وسيلة الدفع الأصلية.',
    'أما طلبات الدفع النقدي فنؤكد ترتيبات رد المبلغ بعد المراجعة.',
  ],
}
export const HEAD = {
  en: { h1: 'Returns & exchange', find: 'Find your order', policy: 'Policy at a glance', intro: 'Start a return or an exchange with your order number and the phone used at checkout.', go: 'Find order', terms: 'Read the full returns terms', wa: 'Need help? Contact Sporta on WhatsApp' },
  ar: { h1: 'الإرجاع والاستبدال', find: 'ابحث عن طلبك', policy: 'ملخص السياسة', intro: 'ابدأ طلب إرجاع أو استبدال برقم الطلب ورقم الهاتف المستخدم عند الشراء.', go: 'ابحث عن الطلب', terms: 'اقرأ شروط الإرجاع كاملة', wa: 'تحتاج مساعدة؟ تواصل مع سبورتا على واتساب' },
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
export const markup = (lang, variant) => {
  const h = HEAD[lang], p = POINTS[lang]
  const points = variant === 'paras'
    ? p.slice(0, 3).map((t) => `<p class="returns-system__point">${esc(t)}</p>`).join('') + `<p class="returns-system__point">${esc(p[3])} ${esc(p[4])}</p>`
    : `<ul class="returns-system__points">${p.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
  return `<section class="returns-system">` +
    `<div class="returns-system__intro"><h1>${esc(h.h1)}</h1><p>${esc(h.intro)}</p></div>` +   // the sentence is a stand-in
    `<div class="returns-system__lookup"><h2>${esc(h.find)}</h2><form class="returns-system__lookup-grid"><input name="track" type="text"><input name="phone" type="tel"><button type="button" class="returns-system__primary">${esc(h.go)}</button></form></div>` +   // fields are stand-ins
    `<div class="returns-system__policy"><h2>${esc(h.policy)}</h2>${points}` +
    `<div class="returns-system__policy-links"><a href="/terms#returns">${esc(h.terms)}</a><a href="https://wa.me/96522091914" target="_blank" rel="noopener">${esc(h.wa)}</a></div></div>` +
    `</section>`
}
// What React does to that markup, as far as this suite needs it: it renders into #root, re-renders by REPLACING the section with
// new nodes (a remount, the hardest case for an add-on), and switches language by rendering the other language's words.
export const SHIM_JS = (variant) => `
(function () {
  var M = ${JSON.stringify({ ar: markup('ar', variant), en: markup('en', variant) })}
  window.__render = function (lang) {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl'
    document.getElementById('root').innerHTML = '<main>' + M[lang] + '</main>'
  }
  var q = /[?&]lang=(en|ar)/.exec(location.search)
  window.__render(q ? q[1] : 'ar')
})()
`
export const page = () => '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Returns</title>' +
  '<link rel="stylesheet" href="/sporta-returns-touch.css"></head><body><div id="root"></div>' +
  '<script src="/returns-fixture.js"></script><script src="/sporta-features.js" defer></script></body></html>'
