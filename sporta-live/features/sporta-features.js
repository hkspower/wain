/* Sporta — "مميزات سبورتا" features band on the home page.
 *
 * Why an add-on and not a React change: the live storefront is a compiled
 * bundle whose source is not in the repo (see VPS-SCAN-2026-10-31.md). This
 * script waits for the home hero slider (the <section> holding
 * .campaign-photo-hero) and inserts its own section directly after it. A
 * MutationObserver puts it back if React re-renders the page, and it is
 * removed again when the visitor navigates away from "/". External file on
 * purpose: the CSP forbids inline script (style-src allows inline styles).
 *
 * Design: the Sporta design system, campaign (dark) theme —
 *   surface #111113, raised #1e1f23, ink #f2f2f0, muted #9b9ca1,
 *   brand fill #ff7b17 with BLACK text (never white on orange),
 *   orange text #ff8f3d, hairline #3a3b40, radius 8px.
 * Only real service promises (README of the design system + live settings):
 * 24-hour delivery for 1 KWD, free 14-day returns, 100% authentic, WhatsApp
 * support on 22091914.
 */
(function () {
  'use strict'
  var ID = 'sporta-features'

  var T = {
    ar: {
      title: 'مميزات سبورتا',
      sub: 'ليش الكويت تتسوق ملابسها الرياضية من عندنا',
      shop: 'تسوّق الآن',
      wa: 'واتساب 22091914',
      items: [
        ['truck', 'توصيل خلال 24 ساعة', 'بـ 1 د.ك فقط — لجميع مناطق الكويت'],
        ['return', 'إرجاع واستبدال مجاني', 'خلال 14 يوم داخل الكويت'],
        ['shield', 'منتجات أصلية 100%', 'من الماركات مباشرة — بدون تقليد'],
        ['chat', 'دعم مباشر على واتساب', 'نرد عليك على 22091914']
      ]
    },
    en: {
      title: 'Sporta features',
      sub: 'Why Kuwait shops its sportswear with us',
      shop: 'Shop now',
      wa: 'WhatsApp 22091914',
      items: [
        ['truck', '24-hour delivery', 'Only 1 KWD — to every area of Kuwait'],
        ['return', 'Free returns & exchange', 'Within 14 days inside Kuwait'],
        ['shield', '100% authentic', 'Straight from the brands — no copies'],
        ['chat', 'WhatsApp support', 'Real people on 22091914']
      ]
    }
  }

  var ICON = {
    truck: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    'return': '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    chat: '<path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4.5"/>'
  }
  var WA_MARK = '<path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 13.9c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9 0-1.4.7-2 1-2.3.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.2.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.8-.1 1.4z"/>'

  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'en' ? 'en' : 'ar' }
  function isHome() { return location.pathname === '/' || location.pathname === '/index.html' }

  function css() {
    if (document.getElementById(ID + '-css')) return
    var s = document.createElement('style')
    s.id = ID + '-css'
    s.textContent =
      '.sf{background:#111113;color:#f2f2f0;padding:56px 16px}' +
      '.sf *{box-sizing:border-box}' +
      '.sf__in{max-width:1248px;margin:0 auto;display:flex;flex-direction:column;gap:32px}' +
      '.sf__head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:24px}' +
      '.sf__titles{display:flex;flex-direction:column;gap:12px;align-items:flex-start}' +
      '.sf__eyebrow{font-size:12px;line-height:16px;font-weight:500;letter-spacing:.2em;color:#ff8f3d}' +
      '.sf__rule{display:block;width:80px;height:2px;background:#ff7b17}' +
      '.sf__title{margin:0;font-weight:800;font-size:clamp(32px,4.2vw,56px);line-height:1.15;color:#f2f2f0}' +
      '.sf__sub{margin:0;font-size:16px;line-height:26px;color:#9b9ca1}' +
      '.sf__cta{display:flex;flex-wrap:wrap;gap:12px}' +
      '.sf__btn{min-height:48px;padding:12px 24px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;gap:10px;font-size:16px;font-weight:700;text-decoration:none;transition:background-color .15s,border-color .15s}' +
      '.sf__btn--shop{background:#ff7b17;color:#000}.sf__btn--shop:hover{background:#ff9545;color:#000}' +
      '.sf__btn--wa{border:1px solid #3a3b40;color:#f2f2f0;font-weight:600}.sf__btn--wa:hover{border-color:#9b9ca1;color:#fff}' +
      '.sf__btn:focus-visible{outline:2px solid #ff8f3d;outline-offset:2px}' +
      '.sf__grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}' +
      '.sf__card{background:#1e1f23;border-radius:8px;padding:24px;display:flex;flex-direction:column;gap:12px;min-height:180px}' +
      '.sf__icon{width:52px;height:52px;border-radius:8px;background:#ff7b17;display:inline-flex;align-items:center;justify-content:center;flex:none}' +
      '.sf__card h3{margin:0;font-size:20px;line-height:28px;font-weight:700;color:#f2f2f0}' +
      '.sf__card p{margin:0;font-size:15px;line-height:24px;color:#9b9ca1}' +
      '@media (max-width:1023px){.sf__grid{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
      '@media (max-width:639px){.sf{padding:40px 16px}.sf__head{flex-direction:column;align-items:stretch}.sf__titles{align-items:center;text-align:center}' +
      '.sf__cta{flex-direction:column}.sf__btn{width:100%}.sf__grid{gap:12px}.sf__card{padding:18px 14px;min-height:0}' +
      '.sf__icon{width:44px;height:44px}.sf__card h3{font-size:17px;line-height:25px}.sf__card p{font-size:13px;line-height:21px}}' +
      '@media (prefers-reduced-motion:reduce){.sf__btn{transition:none}}'
    document.head.appendChild(s)
  }

  function svg(paths, size, stroke) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none"' +
      (stroke ? ' stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' : '') +
      ' aria-hidden="true" focusable="false">' + paths + '</svg>'
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }

  function build() {
    var L = lang(), t = T[L], ar = L === 'ar'
    var sec = document.createElement('section')
    sec.id = ID
    sec.className = 'sf'
    sec.setAttribute('dir', ar ? 'rtl' : 'ltr')
    sec.setAttribute('lang', L)
    sec.setAttribute('data-lang', L)
    sec.setAttribute('aria-labelledby', ID + '-title')
    var arrow = ar ? '<path d="M15 6l-6 6 6 6"/>' : '<path d="M9 6l6 6-6 6"/>'
    var cards = t.items.map(function (it) {
      return '<li class="sf__card"><span class="sf__icon">' + svg(ICON[it[0]], 26, true) + '</span>' +
        '<h3>' + esc(it[1]) + '</h3><p>' + esc(it[2]) + '</p></li>'
    }).join('')
    sec.innerHTML =
      '<div class="sf__in">' +
        '<div class="sf__head">' +
          '<div class="sf__titles">' +
            '<span class="sf__eyebrow" dir="ltr">WHY SPORTA</span>' +
            '<span class="sf__rule" aria-hidden="true"></span>' +
            '<h2 class="sf__title" id="' + ID + '-title">' + esc(t.title) + '</h2>' +
            '<span class="sf__rule" aria-hidden="true"></span>' +
            '<p class="sf__sub">' + esc(t.sub) + '</p>' +
          '</div>' +
          '<div class="sf__cta">' +
            '<a class="sf__btn sf__btn--shop" href="/shop' + (ar ? '' : '?lang=en') + '">' + esc(t.shop) + svg(arrow, 18, true) + '</a>' +
            '<a class="sf__btn sf__btn--wa" href="https://wa.me/96522091914" target="_blank" rel="noopener">' + svg(WA_MARK, 20, false) + esc(t.wa) + '</a>' +
          '</div>' +
        '</div>' +
        '<ul class="sf__grid">' + cards + '</ul>' +
      '</div>'
    return sec
  }

  /** The home slider: the <section> that holds the campaign photo hero. */
  function heroSection() {
    var slide = document.querySelector('.campaign-photo-hero')
    return slide ? slide.closest('section') : null
  }

  function mount() {
    var existing = document.getElementById(ID)
    if (!isHome()) { if (existing) existing.remove(); return }
    var hero = heroSection()
    if (!hero || !hero.parentNode) return
    if (existing && existing.getAttribute('data-lang') === lang() && existing.previousElementSibling === hero) return
    if (existing) existing.remove()
    css()
    hero.parentNode.insertBefore(build(), hero.nextSibling)
  }

  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; mount() })
  }
  function start() {
    mount()
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    window.addEventListener('popstate', schedule)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()
