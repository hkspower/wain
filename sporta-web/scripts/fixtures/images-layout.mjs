// The two live pages the images/grid add-on rules act on, as fixtures: the markup dumped from
// www.sporta.com.kw on 2026-11-03 (read-only probe: outerHTML of the gallery and of the brand page) and the
// stylesheet rules that name those classes, copied from the live /assets/index-CdcKvZhs.css. Used by
// images-layout-test.mjs to prove public/sporta-images.css (gallery cap) and public/sporta-grid.css
// (.catalog-page min-height) against the real markup.
//
// What is exact and what is not:
//   exact        the class lists and nesting of the page shell, the gallery and the brand banner; every
//                bundle rule that names .catalog-page / .catalog-filters / .catalog-empty / .catalog-gallery*
//                / .catalog-product-visual (dumped, not paraphrased); the root font size
//                (calc(15.5px + .1vw), 16.8px at 1280px); the Tailwind utilities the markup uses.
//   reconstructed the header (145px tall, as measured), the footer (715px, as measured), the heading, toolbar
//                and card heights, and the gap between the two product columns (4.63rem: the live columns
//                measured 576px at 1280px). They only decide how tall the page is, so the test
//                asserts geometry relative to the window, never absolute text widths (no Arabic font here).

// --- rules copied from the live bundle -------------------------------------------------------------
export const LIVE = `
:root{--shop-border:rgba(23,26,30,.13);--line:rgba(23,26,30,.13);--canvas-muted:#f6f7f8;--surface:#fff;--brand-bright:#ff7b17;--brand:#e0561c;--text-primary:#171a1e;--shop-radius-lg:1rem;--accent-text:20 80% 40%}
*,::before,::after{box-sizing:border-box}
/* Tailwind utilities the markup uses: they come BEFORE the component rules in the bundle, so .catalog-product-visual{top:10rem} beats lg:top-24 (live top measured 168.3px) */
.relative{position:relative}.absolute{position:absolute}.flex{display:flex}.grid{display:grid}.min-w-0{min-width:0}
.aspect-square{aspect-ratio:1/1}.overflow-hidden{overflow:hidden}.rounded-2xl{border-radius:1rem}
.h-full{height:100%}.w-full{width:100%}.shrink-0{flex-shrink:0}.object-contain{object-fit:contain}
.mx-auto{margin-inline:auto}.max-w-7xl{max-width:80rem}.px-4{padding-inline:1rem}.py-6{padding-block:1.5rem}
.gap-8{gap:2rem}.flex-1{flex:1 1 0%}.flex-col{flex-direction:column}.min-h-screen{min-height:100vh}.mt-16{margin-top:4rem}
@media (min-width:768px){.md\\:px-6{padding-inline:1.5rem}.md\\:py-10{padding-block:2.5rem}}
@media (min-width:1024px){.lg\\:sticky{position:sticky}.lg\\:top-24{top:6rem}.lg\\:self-start{align-self:flex-start}.lg\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}}
html{font-size:calc(15.5px + .1vw)}
body{margin:0;background:#fff;font-family:'DejaVu Sans',sans-serif}
.catalog-page,.catalog-product-page,.catalog-wishlist{box-sizing:border-box;width:100%;max-width:var(--shop-shell-max,80rem);color:var(--text-primary);margin-inline:auto}
.catalog-filters{scroll-padding-inline:var(--shop-gutter-start,1rem);scrollbar-width:thin;gap:.5rem;margin-block-end:1.25rem;padding-block:.25rem .75rem;padding-inline:0;display:flex;overflow-x:auto}
.catalog-empty{border:1px solid var(--shop-border,var(--line));background:var(--surface);border-radius:var(--shop-radius-lg,1rem);padding-inline:1.25rem}
.catalog-empty-icon{width:5rem;height:5rem;color:hsl(var(--accent-text));background:#c76a4214;border-radius:1.25rem;place-items:center;display:grid}
.catalog-product-visual,.catalog-gallery{width:100%;min-width:0}
.catalog-gallery-stage{border:1px solid var(--shop-border,var(--line));border-radius:var(--shop-radius-lg,1rem);isolation:isolate;background:#fff;place-items:center;display:grid}
.catalog-gallery-track{position:absolute;inset:0}
.catalog-gallery-photo{object-fit:contain;object-position:center;backface-visibility:hidden;image-rendering:auto;will-change:transform;width:100%;max-width:100%;height:100%;padding:clamp(.75rem,2vw,1.5rem);transition:transform .18s ease-out;display:block}
@media (min-width:1024px){.catalog-product-visual{top:10rem}}
`

// --- reconstructed pieces (heights only) -------------------------------------------------------------
export const SHELL = `
.app-header{height:var(--hdr,145px);background:#171a1e}
.app-footer{height:715px;background:#171a1e}
.catalog-heading{height:150px}
.catalog-toolbar{height:60px}
#sporta-brand-banner{min-height:88px}
.catalog-card{height:380px;background:#eee;border-radius:8px}
.product-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 12px}
@media (min-width:768px){.product-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (min-width:1024px){.product-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.catalog-product-layout{column-gap:4.63rem}
.catalog-product-info{height:1500px;background:#f6f7f8}
`

const filters = '<div class="catalog-filters"><button>الكل</button><button>رجالي</button><button>نسائي</button></div>'
const emptyState = '<div class="catalog-empty py-12 text-center"><span class="catalog-empty-icon"></span><p style="height:120px;margin:0">لا توجد نتائج</p></div>'
const cards = (n) => '<div class="product-grid">' + '<a class="catalog-card"></a>'.repeat(n) + '</div>'

// Brand page /shop?brand=<slug>. state 'shell': the compiled app's first paint (heading, toolbar, filters
// and the brief empty state); state 'loaded': the products have arrived (4 cards, as for vanquish) or
// `many` cards (a long shop page).
export const shop = (extraCss = '', { state = 'shell', n = 4, hdr = 145 } = {}) =>
  `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${LIVE}${SHELL}:root{--hdr:${hdr}px}</style><style>${extraCss}</style></head>` +
  `<body><div class="storefront-root flex min-h-screen flex-col"><header class="app-header"></header>` +
  `<main class="flex-1"><section class="catalog-page mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10"><div class="catalog-heading"></div><div class="catalog-toolbar"></div>` +
  `${filters}${state === 'shell' ? emptyState : cards(n)}</section></main>` +
  `<footer class="app-footer sporta-footer mt-16 bg-ink text-slate-300"></footer></div></body></html>`

// Product page: the exact gallery markup of /product/<slug> (single photograph).
export const gallery = '<div class="catalog-product-visual min-w-0 lg:sticky lg:top-24 lg:self-start"><div class="catalog-gallery"><div class="relative"><div role="button" tabindex="0" class="catalog-gallery-stage group relative aspect-square cursor-zoom-in touch-pan-y overflow-hidden rounded-2xl"><div class="catalog-gallery-track flex h-full w-full" style="transform: translateX(0%);"><img alt="" width="600" height="600" class="catalog-gallery-photo h-full w-full shrink-0 object-contain" src="data:image/svg+xml;utf8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27600%27 height=%27600%27%3E%3Crect width=%27600%27 height=%27600%27 fill=%27%23ddd%27/%3E%3C/svg%3E" style="transform: scale(1); transform-origin: center center;"></div></div></div></div></div>'

export const product = (extraCss = '') =>
  `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${LIVE}${SHELL}</style><style>${extraCss}</style></head>` +
  `<body><div class="storefront-root flex min-h-screen flex-col"><header class="app-header"></header>` +
  `<main class="flex-1"><section class="catalog-product-page mx-auto max-w-7xl px-4 py-6 text-start md:px-6 md:py-10"><div class="catalog-product-layout grid gap-8 lg:grid-cols-2">${gallery}<div class="catalog-product-info"></div></div></section></main>` +
  `<footer class="app-footer mt-16"></footer></div></body></html>`
