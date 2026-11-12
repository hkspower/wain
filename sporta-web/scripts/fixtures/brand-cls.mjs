// /shop?brand=<slug> as it LOADS on the live site, for scripts/brand-cls-test.mjs (BRAND-CLS-1112 in
// public/sporta-features.js).
//
// What is exact and what is not:
//   exact         the section.catalog-page markup, captured read-only on www.sporta.com.kw 2026-11-12 with
//                 scripts/live-brand-cls-probe.mjs (/shop?brand=vanquish, ar, 390): .catalog-heading, .catalog-toolbar,
//                 .catalog-filters, the sr-only h2, the compiled app's .catalog-empty box (shown while the products
//                 load: the probe caught it moving 210 -> 384 when the banner arrived) and the hidden .product-grid;
//                 the live component CSS (fixtures/shop-header.mjs LIVE, dumped from index-CdcKvZhs.css) plus the real
//                 public/sporta-grid.css and sporta-images.css the live index.html links; the header height (126px,
//                 the section starts at y 126 live); the order of events: first paint with the empty box, then the
//                 brand list, then the products replace the empty box; and the other order the live timeline showed
//                 (list at +2583 ms, first commit +2935 ms, banner +2960 ms: one frame late), via sd= and raf=1.
//   reconstructed the English copy (from fixtures/shop-header.mjs), the product cards (a fixed-height box), the
//                 footer, and the timings, which the test sets per run.
//
// fixture.js plays the compiled React app: it renders the page shell at once, then on `pm` ms swaps the empty
// box for the grid, the way the live page does. It is a separate file because the live CSP (script-src 'self')
// refuses inline script, and the test serves the page under that CSP.
import { LIVE } from './shop-header.mjs'

export const T = {
  ar: {
    eyebrow: 'سبورتا / المجموعة',
    h1: 'تسوق الملابس الرياضية في الكويت',
    intro: 'ملابس رياضية نسائية ورجالية وهوديز وإكسسوارات جيم — توصيل خلال ٢٤ ساعة داخل الكويت، والأسعار بالدينار الكويتي وطرق الدفع تظهر عند إتمام الشراء.',
    count: '٤', unit: 'منتج', sort: 'ترتيب', sortOpts: ['الأحدث', 'السعر: من الأقل إلى الأعلى', 'السعر: من الأعلى إلى الأقل'],
    cats: ['الكل', 'نساء', 'رجال', 'هوديز وجواكيت', 'إكسسوارات'], catsLabel: 'فئات المنتجات', all: 'جميع المنتجات',
    emptyTitle: 'لم نجد منتجات مطابقة', emptyBody: 'جرّب فئة أخرى أو امسح عبارة البحث لعرض جميع المنتجات.',
  },
  en: {
    eyebrow: 'SPORTA / THE COLLECTION',
    h1: 'Shop sportswear in Kuwait',
    intro: 'Women’s and men’s sportswear, hoodies and gym accessories — delivery within 24 hours inside Kuwait, prices in Kuwaiti dinar and payment options shown at checkout.',
    count: '4', unit: 'products', sort: 'Sort', sortOpts: ['Newest', 'Price: low to high', 'Price: high to low'],
    cats: ['All', 'Women', 'Men', 'Hoodies & jackets', 'Accessories'], catsLabel: 'Product categories', all: 'All products',
    emptyTitle: 'No matching products', emptyBody: 'Try another category or clear the search to see the full collection.',
  },
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/** The page as the server sends it: an empty <main>; fixture.js renders the shop into it and the footer after it. */
export function page(lang = 'ar') {
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>shop</title>` +
    `<style>${LIVE}:root{--hdr:126px}</style><link rel="stylesheet" href="/sporta-grid.css"><link rel="stylesheet" href="/sporta-images.css"></head>` +
    `<body><div class="storefront-root flex min-h-screen flex-col"><header class="app-header"></header><main id="main" class="flex-1"></main></div><script src="/sporta-features.js"></script><script src="/fixture.js"></script></body></html>`
}

/** The section.catalog-page markup, live, in the "products still loading" state. Built here, injected by fixture.js. */
export function shell(lang = 'ar') {
  const t = T[lang]
  return `<section class="catalog-page mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">` +
    `<div class="catalog-heading"><p class="catalog-eyebrow">${esc(t.eyebrow)}</p><div class="catalog-heading-copy"><h1 class="text-3xl font-extrabold text-slate-900">${esc(t.h1)}</h1><p class="max-w-2xl text-slate-600">${esc(t.intro)}</p></div></div>` +
    `<div class="catalog-toolbar"><p class="catalog-result-count" role="status"><span>${t.count}</span> ${esc(t.unit)}</p><label class="catalog-sort flex items-center gap-2 text-sm font-semibold text-slate-600">${esc(t.sort)}<select class="catalog-sort-select min-h-11 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand">` +
    t.sortOpts.map((o, i) => `<option value="${['newest', 'priceAsc', 'priceDesc'][i]}">${esc(o)}</option>`).join('') + `</select></label></div>` +
    `<div class="catalog-filters" role="group" aria-label="${esc(t.catsLabel)}">` +
    t.cats.map((c, i) => `<button aria-pressed="${i === 0}" class="catalog-filter flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold transition ${i === 0 ? 'is-active' : 'text-slate-600'}">${esc(c)}</button>`).join('') + `</div>` +
    `<h2 class="sr-only">${esc(t.all)}</h2>` +
    `<div class="catalog-empty rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center shadow-sm"><p class="text-lg font-bold text-slate-900">${esc(t.emptyTitle)}</p><p class="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">${esc(t.emptyBody)}</p></div>` +
    `<div class="product-grid grid hidden"></div></section>`
}

/** fixture.js: the stand-in for the compiled app. Fetches the shell from /shell.html (served by the test), commits it, then the grid. */
export const FIXTURE_JS = `(function () {
  var q = new URLSearchParams(location.search)
  var pm = Number(q.get('pm') || 1300)
  var sd = Number(q.get('sd') || 0)          // the route chunk loading: the first commit comes this late
  var inFrame = q.get('raf') === '1'         // commit from inside a frame callback (live: painted before the add-on's rAF)
  var main = document.getElementById('main')
  var later = function (fn) { return function (v) { setTimeout(function () { if (inFrame) requestAnimationFrame(function () { fn(v) }); else fn(v) }, sd) } }
  fetch('/shell.html?lang=' + document.documentElement.lang).then(function (r) { return r.text() }).then(later(function (html) {
    // React's first commit: the whole section in one go.
    var t = document.createElement('div')
    t.innerHTML = html
    main.appendChild(t.firstChild)
    // ...and the footer in the same commit (the app renders header, page and footer together).
    var ft = document.createElement('footer')
    ft.className = 'app-footer mt-16'
    main.parentNode.appendChild(ft)
    window.__shellAt = performance.now()
    setTimeout(function () {
      // The products arrive: React removes the empty box and shows the grid.
      var e = document.querySelector('.catalog-empty')
      if (e) e.parentNode.removeChild(e)
      var g = document.querySelector('.product-grid')
      g.className = 'product-grid grid'
      for (var i = 0; i < 4; i++) { var a = document.createElement('a'); a.className = 'catalog-card'; g.appendChild(a) }
      window.__gridAt = performance.now()
    }, pm)
  }))
})()`
