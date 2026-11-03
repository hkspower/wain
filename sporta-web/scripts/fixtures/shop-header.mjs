// The live Shop page (section.catalog-page) as a fixture, for shop-header-test.mjs, which proves the
// "remove the title block, the count and the category chips" section of public/sporta-grid.css.
//
// What is exact and what is not:
//   exact         the DOM of Shop-hSBJtlix.js (class lists, nesting, order, role/aria attributes) and every
//                 rule of the live index-CdcKvZhs.css that names .catalog-page / .catalog-heading /
//                 .catalog-eyebrow / .catalog-heading-copy / .catalog-toolbar / .catalog-result-count /
//                 .catalog-sort* / .catalog-filters / .catalog-filter / .product-grid (dumped 2026-11-03,
//                 selectors and declarations unchanged, media queries included); the root font size
//                 (calc(15.5px + .1vw)); the Tailwind utilities the section uses; the brand banner's
//                 inline style, copied from public/sporta-features.js buildBanner(), and its position
//                 (inserted immediately BEFORE .catalog-filters, i.e. AFTER the toolbar).
//   reconstructed the header and footer (heights only: 96px/145px and 715px, as measured), the card height,
//                 and the colour variables. Text is real Arabic/English copy; the test measures geometry
//                 relative to the page, never absolute text widths.
//   the Wishlist page is included because it reuses .catalog-heading and .catalog-eyebrow under
//   .catalog-wishlist; the section must not touch it.

export const LIVE = `
:root{--line:rgba(23,26,30,.13);--shop-border:rgba(23,26,30,.13);--text-primary:#171a1e;--text-muted:#5b6470;--surface:#fff;--brand:#e0561c;--brand-bright:#ff7b17;--accent-text:20 80% 40%}
*,::before,::after{box-sizing:border-box}
/* Tailwind utilities the markup uses */
.mx-auto{margin-inline:auto}.max-w-7xl{max-width:80rem}.px-4{padding-inline:1rem}.py-6{padding-block:1.5rem}.py-12{padding-block:3rem}
.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1 1 0%}.items-center{align-items:center}.grid{display:grid}.hidden{display:none}
.gap-2{gap:.5rem}.min-h-11{min-height:2.75rem}.min-h-screen{min-height:100vh}.mt-16{margin-top:4rem}.mt-2{margin-top:.5rem}.mt-10{margin-top:2.5rem}.mt-5{margin-top:1.25rem}
.rounded-xl{border-radius:.75rem}.rounded-2xl{border-radius:1rem}.border{border-width:1px;border-style:solid}.border-black\\/10{border-color:#0000001a}.bg-white{background:#fff}
.px-3{padding-inline:.75rem}.py-2{padding-block:.5rem}.px-4{padding-inline:1rem}.px-5{padding-inline:1.25rem}.py-12{padding-block:3rem}.text-center{text-align:center}
.text-sm{font-size:.875rem;line-height:1.25rem}.text-lg{font-size:1.125rem;line-height:1.75rem}.text-3xl{font-size:1.875rem;line-height:2.25rem}.font-semibold{font-weight:600}.font-bold{font-weight:700}.font-extrabold{font-weight:800}
.max-w-2xl{max-width:42rem}.max-w-md{max-width:28rem}.text-slate-600{color:#475569}.text-slate-900{color:#0f172a}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}
@media (min-width:768px){.md\\:px-6{padding-inline:1.5rem}.md\\:py-10{padding-block:2.5rem}}
html{font-size:calc(15.5px + .1vw)}
body{margin:0;background:#fff;font-family:'DejaVu Sans',sans-serif;color:var(--text-primary)}
p,h1,h2{margin:0}
/* the live component rules, verbatim */
.catalog-page,.catalog-product-page,.catalog-wishlist{box-sizing:border-box;width:100%;max-width:var(--shop-shell-max,80rem);color:var(--text-primary);margin-inline:auto}
.catalog-eyebrow{color:hsl(var(--accent-text));margin-block-end:.75rem;font-size:.75rem;font-weight:800;line-height:1.5}
.catalog-heading{border-block-end:1px solid var(--line);margin-block-end:1.25rem;padding-block:.25rem 1.25rem}
.catalog-heading h1{color:var(--text-primary);letter-spacing:-.025em;margin:0;font-size:clamp(1.875rem,3.7vw,3.25rem);font-weight:900}
[dir=rtl] .catalog-heading h1{letter-spacing:0}
.catalog-heading-copy{gap:.75rem 3rem;display:grid}
.catalog-heading-copy>p{color:var(--text-muted);align-self:end;font-size:.9375rem;line-height:1.8}
.catalog-toolbar{flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:.75rem 1.5rem;margin-block-end:1rem;display:flex}
.catalog-result-count{color:var(--text-muted);font-size:.8125rem}
.catalog-result-count>span{color:#171a1e;font-weight:800}
.catalog-sort-select{max-width:12rem}
.catalog-filters{scroll-padding-inline:var(--shop-gutter-start,1rem);scrollbar-width:thin;gap:.5rem;margin-block-end:1.25rem;padding-block:.25rem .75rem;padding-inline:0;display:flex;overflow-x:auto}
.catalog-filter{border:1px solid var(--shop-border,var(--line));background:var(--surface);color:var(--text-muted);flex-shrink:0}
.catalog-filter.is-active{color:#fff;box-shadow:inset 0 -3px var(--brand-bright);background:#171a1e;border-color:#171a1e}
.catalog-empty{border:1px solid var(--shop-border,var(--line));background:var(--surface);border-radius:1rem;padding-inline:1.25rem}
.storefront-root .product-grid{align-items:stretch;column-gap:var(--shop-grid-column-gap,clamp(.625rem, 1.5vw, 1.25rem));row-gap:var(--shop-grid-row-gap,clamp(1.25rem, 2.4vw, 2rem));grid-template-columns:repeat(2,minmax(0,1fr));min-width:0}
.storefront-root .product-grid>*{min-width:0}
@media (min-width:768px){.storefront-root .product-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (min-width:1024px){.storefront-root .product-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (min-width:1024px){.catalog-heading-copy{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:end}}
@media (min-width:1024px){.catalog-heading-copy>p{border-inline-start:2px solid var(--brand-bright);padding-inline-start:1rem}}
@media (max-width:479px){.catalog-toolbar{align-items:stretch}}
@media (max-width:479px){.catalog-sort{justify-content:space-between;width:100%;min-width:0;font-size:.8125rem}}
@media (max-width:479px){.catalog-sort-select{flex:auto;width:auto;max-width:11rem}}
.storefront-root :where(.page-heading,.catalog-heading h1,.catalog-product-summary,.editorial-page,.legal-page,.tracking-panel){text-align:start}
.storefront-root :where(.home-section-heading,.campaign-brand-bar__heading,.catalog-toolbar,.purchase-heading)>*{min-width:0}
.storefront-root :where(.btn,.tap,.navbar-link,.catalog-filter,.purchase-payment .payment-method){text-align:center}
/* reconstructed: heights only */
.app-header{height:var(--hdr,145px);background:#171a1e}
.app-footer{height:715px;background:#171a1e}
.catalog-card{display:block;height:380px;background:#eee;border-radius:8px}
`

// The grid-less "first paint" is the compiled app's empty state with the grid still hidden.
const T = {
  ar: {
    eyebrow: 'سبورتا / المجموعة',
    h1: 'تسوق الملابس الرياضية في الكويت',
    intro: 'ملابس رياضية نسائية ورجالية وهوديز وإكسسوارات جيم — توصيل خلال ٢٤ ساعة داخل الكويت، والأسعار بالدينار الكويتي وطرق الدفع تظهر عند إتمام الشراء.',
    count: '٤', unit: 'منتج', sort: 'ترتيب', sortOpts: ['الأحدث', 'السعر: من الأقل', 'السعر: من الأعلى'],
    cats: ['الكل', 'نساء', 'رجال', 'هوديز وجواكيت', 'إكسسوارات'], catsLabel: 'فئات المنتجات',
    emptyTitle: 'لم نجد منتجات مطابقة', emptyBody: 'جرّب فئة أخرى أو امسح عبارة البحث لعرض جميع المنتجات.',
    bannerEyebrow: 'علامة تجارية', bannerName: 'فانكويش', bannerCount: '٤ منتجات', bannerLink: 'عرض كل المنتجات',
  },
  en: {
    eyebrow: 'SPORTA / THE COLLECTION',
    h1: 'Shop sportswear in Kuwait',
    intro: 'Women’s and men’s sportswear, hoodies and gym accessories — delivery within 24 hours inside Kuwait, prices in Kuwaiti dinar and payment options shown at checkout.',
    count: '4', unit: 'products', sort: 'Sort', sortOpts: ['Newest', 'Price: low to high', 'Price: high to low'],
    cats: ['All', 'Women', 'Men', 'Hoodies & jackets', 'Accessories'], catsLabel: 'Product categories',
    emptyTitle: 'No matching products', emptyBody: 'Try another category or clear the search to see the full collection.',
    bannerEyebrow: 'Brand', bannerName: 'Vanquish', bannerCount: '4 products', bannerLink: 'View all products',
  },
}

// Copied from sporta-features.js buildBanner(): the inline style of the banner section.
const BANNER_STYLE = 'box-sizing:border-box;width:100%;flex:1 1 100%;grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px;margin:16px 0;padding:16px;border-radius:16px;background:#171a1e;color:#fff'
const banner = (t) => `<section id="sporta-brand-banner" style="${BANNER_STYLE}" aria-labelledby="sporta-brand-banner-title"><div style="flex:none;box-sizing:border-box;height:56px;border-radius:12px;background:#fff;min-width:112px;padding:6px 14px" aria-hidden="true"></div><div style="flex:1 1 160px;min-width:0"><p style="margin:0 0 2px;font-size:12px;line-height:16px;font-weight:700;color:#ff7b17">${t.bannerEyebrow}</p><h2 id="sporta-brand-banner-title" style="margin:0;font-size:22px;line-height:1.3;font-weight:800;color:#fff"><bdi>${t.bannerName}</bdi></h2><p style="margin:4px 0 0;font-size:14px;line-height:20px;color:#e2dbce">${t.bannerCount}</p></div><a href="/shop" style="flex:none;margin-inline-start:auto;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 20px;border-radius:999px;background:#e0561c;color:#171a1e">${t.bannerLink}</a></section>`

const cards = (n) => '<a class="catalog-card"></a>'.repeat(n)

// variant: 'shop' | 'brand' | 'category' | 'search'; state: 'shell' (grid empty, first paint) | 'loaded' | 'noresults'
export function shop(extraCss = '', { lang = 'ar', variant = 'shop', state = 'loaded', n = 4, hdr = 145 } = {}) {
  const t = T[lang]
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const filters = `<div class="catalog-filters" role="group" aria-label="${t.catsLabel}">` +
    t.cats.map((c, i) => `<button aria-pressed="${variant === 'category' ? i === 1 : i === 0}" class="catalog-filter flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold transition ${(variant === 'category' ? i === 1 : i === 0) ? 'is-active' : 'text-slate-600'}">${c}</button>`).join('') + '</div>'
  const empty = `<div class="catalog-empty rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center shadow-sm"><p class="text-lg font-bold text-slate-900">${t.emptyTitle}</p><p class="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">${t.emptyBody}</p></div>`
  const none = state !== 'loaded'
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>shop</title><style>${LIVE}:root{--hdr:${hdr}px}</style><style>${extraCss}</style></head>` +
    `<body><div class="storefront-root flex min-h-screen flex-col"><header class="app-header"></header><main class="flex-1">` +
    `<section class="catalog-page mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">` +
    `<div class="catalog-heading"><p class="catalog-eyebrow">${t.eyebrow}</p><div class="catalog-heading-copy"><h1 class="text-3xl font-extrabold text-slate-900">${t.h1}</h1><p class="max-w-2xl text-slate-600">${t.intro}</p></div></div>` +
    `<div class="catalog-toolbar"><p class="catalog-result-count" role="status"><span>${t.count}</span> ${t.unit}</p>` +
    `<label class="catalog-sort flex items-center gap-2 text-sm font-semibold text-slate-600">${t.sort}<select class="catalog-sort-select min-h-11 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-brand">${t.sortOpts.map((o) => `<option>${o}</option>`).join('')}</select></label></div>` +
    (variant === 'brand' ? banner(t) : '') + filters +
    `<h2 class="sr-only">${lang === 'ar' ? 'المنتجات' : 'Products'}</h2>` +
    (none ? empty : '') +
    `<div class="product-grid grid ${none ? 'hidden' : ''}">${none ? '' : cards(n)}</div>` +
    `</section></main><footer class="app-footer mt-16"></footer></div></body></html>`
}

// The wishlist reuses the heading classes under .catalog-wishlist (Wishlist-gDqV38CF.js).
export function wishlist(extraCss = '', { lang = 'ar' } = {}) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${LIVE}</style><style>${extraCss}</style></head>` +
    `<body><div class="storefront-root"><header class="app-header"></header><section class="catalog-wishlist mx-auto max-w-7xl px-4 py-12 md:px-6">` +
    `<div class="catalog-heading"><p class="catalog-eyebrow">SPORTA</p><div class="catalog-heading-copy"><h1 class="text-3xl font-extrabold text-slate-900">${lang === 'ar' ? 'المفضلة' : 'Wishlist'}</h1><p class="max-w-2xl text-slate-600">${lang === 'ar' ? 'قطعك المحفوظة.' : 'Your saved pieces.'}</p></div></div>` +
    `</section></div></body></html>`
}
