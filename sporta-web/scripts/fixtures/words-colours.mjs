// Words-and-colours fixture: the live storefront pieces that sporta-ui-colours.css and sporta-brand-theme.css
// touch, rebuilt from what a read-only probe of www.sporta.com.kw returned on 2026-11-03.
//
//   MARKUP   copied from the rendered live DOM (hero section and its controls, a sold-out product card,
//            the shop filter chips, the product-page breadcrumb / wishlist / size chip, the bag drawer with
//            one line, the checkout stepper / guest note / coupon row). The payment-method list and the
//            purchase-notice are NOT copied: they appear on checkout stage 3, which needs the delivery form
//            submitted, so they are built from the live class names the live rules name.
//   LIVE     every rule of the live /assets/index-*.css (plus the already-linked add-ons) that names those
//            elements, dumped through the CSSOM. Rules are verbatim apart from Tailwind utilities that are
//            reduced to the declaration they carry (e.g. .z-\[1\]{z-index:1}) and the hero photo, which is a
//            plain light-grey SVG standing in for the slide image (the worst-case "bright photo" the scan hit:
//            the brightest decile of the live slides is about #ececec).
//
// Not reproduced: fonts (the sandbox has no Arabic face), so tests assert colours, ring colours and stacking,
// never text widths.
const SVG = (p, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle ${extra}" aria-hidden="true" focusable="false">${p}</svg>`
const HEART = '<path d="M12 20.5 4 12.5a5 5 0 0 1 8-6.5 5 5 0 0 1 8 6.5Z"></path>'
const X = '<path d="M6 6 18 18M18 6 6 18"></path>'
const TRASH = '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"></path>'
const ARROW = '<path d="M5 12h14M12 5l7 7-7 7"></path>'
const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="952"><rect width="2400" height="952" fill="#ececec"/></svg>')}`
const WHITE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="750"><rect width="600" height="750" fill="#fff"/></svg>')}`

export const COPY = {
  ar: {
    title1: 'تدرّب بجد. اظهر بمظهر أفضل.', sub1: 'ملابس رياضية فاخرة، توصيل إلى جميع محافظات الكويت', cta: 'تسوّق الآن',
    title2: 'مميزات سبورتا', sub2: 'توصيل سريع، إرجاع سهل، منتجات أصلية 100%',
    home: 'الرئيسية', shop: 'المتجر', all: 'الكل', women: 'نساء', men: 'رجال', sold: 'نفذت الكمية', name1: 'حقيبة ظهر كالياري كالتشو', name2: 'سويت شيرت كالياري كالتشو',
    bag: 'حقيبتك', close: 'إغلاق', remove: 'إزالة', dec: 'إنقاص الكمية', inc: 'زيادة الكمية', checkout: 'إتمام الشراء', back: 'العودة للمتجر',
    steps: ['الحقيبة', 'التوصيل', 'الدفع'], track: 'تتبع طلب', quick: 'إنشاء حساب سريع — اختياري', note: 'لا حاجة لإنشاء حساب', apply: 'تطبيق', code: 'كود الخصم',
    size: 'دليل المقاسات', wish: 'أضف إلى المفضلة', pay1: 'الدفع عند الاستلام', pay2: 'بطاقة كي نت', noticeText: 'سيتصل بك المندوب قبل الوصول',
    prev: 'الشريحة السابقة', next: 'الشريحة التالية', ret: 'اقرأ شروط الإرجاع كاملة', findOrder: 'عرض الطلب', ph: 'عنوان الصفحة',
  },
  en: {
    title1: 'Train hard. Look better.', sub1: 'Premium sportswear delivered across Kuwait', cta: 'Shop now',
    title2: 'Why Sporta', sub2: 'Fast delivery, easy returns, 100% authentic products',
    home: 'Home', shop: 'Shop', all: 'All', women: 'Women', men: 'Men', sold: 'Sold out', name1: 'Cagliari Calcio backpack', name2: 'Cagliari Calcio sweatshirt',
    bag: 'Your bag', close: 'Close', remove: 'Remove', dec: 'Decrease quantity', inc: 'Increase quantity', checkout: 'Checkout', back: 'Back to shop',
    steps: ['Bag', 'Delivery', 'Payment'], track: 'Track an order', quick: 'Quick registration (optional)', note: 'No account needed', apply: 'Apply', code: 'Discount code',
    size: 'Size guide', wish: 'Add to wishlist', pay1: 'Cash on delivery', pay2: 'KNET card', noticeText: 'The courier calls before arrival',
    prev: 'Previous slide', next: 'Next slide', ret: 'Read the full returns terms', findOrder: 'Find order', ph: 'Page title',
  },
}

const slide = (t, i, end) => `<div role="group" aria-roledescription="slide" aria-label="${i} / 2" class="campaign-photo-hero relative w-full shrink-0 bg-ink ${end ? 'campaign-photo-hero--copy-end' : ''}"><div aria-hidden="true" class="absolute inset-0 overflow-hidden"><img alt="" width="2400" height="952" class="absolute inset-0 h-full w-full select-none object-cover" src="${PHOTO}"><span class="campaign-photo-hero-scrim absolute inset-0"></span></div><div class="campaign-hero-content campaign-photo-hero-content relative mx-auto flex max-w-7xl items-end py-14 lg:items-center lg:py-16"><div class="campaign-hero-copy w-full max-w-xl text-start lg:max-w-[45%]"><h2 class="campaign-hero-title font-display font-black">${i === 1 ? t.title1 : t.title2}</h2><p class="campaign-hero-sub">${i === 1 ? t.sub1 : t.sub2}</p><a class="campaign-hero-cta" href="#shop">${t.cta}<span aria-hidden="true" class="campaign-hero-cta-icon">${SVG(ARROW, 'rtl:rotate-180')}</span></a></div></div></div>`

const hero = (t) => `<section aria-roledescription="carousel" aria-label="hero" class="group relative isolate overflow-hidden bg-ink text-white"><h1 class="sr-only">Sporta</h1><div aria-live="polite" class="flex">${slide(t, 1, false)}${slide(t, 2, true)}</div><button aria-label="${t.prev}" class="absolute start-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-white">${SVG(ARROW)}</button><button aria-label="${t.next}" class="absolute end-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-white">${SVG(ARROW)}</button></section>`

const brandBar = (t) => `<div class="campaign-brand-bar"><div class="campaign-brand-bar__heading"><h2>${t.shop}</h2><a class="brand-bar__cta" href="#brands">${t.all}</a></div><ul class="brand-bar__track"><li><a class="brand-bar__item" href="#b1"><span>FILA</span></a></li><li><a class="brand-bar__item" href="#b2"><span>RIO</span></a></li></ul></div>`

const card = (t, sold, name) => `<article class="product-grid-card group flex min-w-0 flex-col"><div class="catalog-card-image relative block aspect-[4/5] overflow-hidden"><a class="absolute inset-0 block" aria-label="${name}" href="#p-${sold ? 'sold' : 'ok'}"><span aria-hidden="true" class="image-loading-skeleton absolute inset-0 z-0 "></span><img alt="${name}" width="600" height="750" class="catalog-card-photo relative z-[1] h-full w-full object-contain" src="${WHITE}">${sold ? `<span class="absolute inset-0 bg-white/55" aria-hidden="true"></span><span class="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-ink/85 py-1.5 text-center text-xs font-bold uppercase tracking-widest text-white">${t.sold}</span>` : ''}</a><button type="button" aria-label="${t.wish}" aria-pressed="false" class="catalog-card-save absolute end-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-slate-600">${SVG(HEART)}</button></div><div class="catalog-card-info flex flex-col gap-1 pt-3"><a class="-my-1.5 block w-full py-1.5 transition" href="#p"><h3 dir="auto" class="catalog-card-name line-clamp-2 min-h-11 text-center text-sm font-medium text-slate-900">${name}</h3></a><span class="price-card">4.000 KWD</span></div></article>`

const shop = (t) => `<div class="catalog-filters" role="group"><button aria-pressed="true" class="catalog-filter flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold transition is-active">${t.all}</button><button aria-pressed="false" class="catalog-filter flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold transition text-slate-600">${t.women}</button><button aria-pressed="false" class="catalog-filter flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold transition text-slate-600">${t.men}</button></div><div class="shop-grid">${card(t, true, t.name1)}${card(t, false, t.name2)}</div>`

const product = (t) => `<section class="catalog-product-page mx-auto max-w-7xl px-4 py-6 text-start"><nav class="catalog-breadcrumb mb-6 text-sm text-slate-600"><ol class="flex flex-wrap items-center gap-1.5"><li><a class="-my-2.5 inline-block py-2.5 hover:text-accent" href="#home">${t.home}</a></li><li aria-hidden="true" class="text-slate-300">/</li><li><a class="-my-2.5 inline-block py-2.5 hover:text-accent" href="#shop">${t.shop}</a></li></ol></nav><div class="flex items-start justify-between gap-4"><h1 class="catalog-product-title min-w-0 flex-1 text-start text-3xl font-extrabold text-slate-900">${t.name1}</h1><button type="button" aria-pressed="false" aria-label="${t.wish}" class="tap mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition border-slate-300 text-slate-600 hover:border-brand hover:text-brand">${SVG(HEART)}</button></div><div id="product-size-options" class="rounded-2xl border border-black/10 bg-white p-4"><button type="button" class="text-accent -my-3 inline-flex items-center gap-1.5 py-3 text-xs font-semibold underline underline-offset-2">${t.size}</button><div class="flex flex-wrap gap-2" role="group"><button type="button" aria-pressed="false" class="relative flex h-11 min-w-11 items-center justify-center rounded-xl border px-3.5 text-sm font-bold transition border-black/10 bg-white text-slate-900">S</button></div></div><div class="qty"><button class="tap flex items-center justify-center px-4 text-slate-700 hover:text-brand disabled:cursor-not-allowed disabled:opacity-35" aria-label="${t.dec}" disabled>${SVG('<path d="M5 12h14"></path>')}</button><span>1</span><button class="tap flex items-center justify-center px-4 text-slate-700 hover:text-brand" aria-label="${t.inc}">${SVG('<path d="M12 5v14M5 12h14"></path>')}</button></div><button class="btn btn-primary" type="button">${t.cta}</button></section>`

const drawer = (t) => `<aside role="dialog" aria-modal="true" aria-label="${t.bag}" class="cart-drawer campaign-cart-drawer fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl"><header class="flex items-center justify-between border-b border-black/10 px-6 py-5"><div class="flex min-w-0 items-center gap-3"><h2 class="text-xl font-extrabold text-slate-900">${t.bag}</h2><span class="purchase-count">1</span></div><button aria-label="${t.close}" class="tap flex items-center justify-center text-slate-400 hover:text-slate-700">${SVG(X)}</button></header><ul class="flex-1 divide-y divide-black/5 overflow-y-auto px-6"><li class="cart-drawer__line flex gap-4 py-4"><div class="min-w-0 flex-1"><p class="font-bold text-slate-900">${t.name2}</p><div class="mt-2 flex items-center gap-3"><div class="purchase-quantity flex items-center rounded-full border border-black/15 text-slate-900"><button class="px-3 py-1 text-base font-bold leading-none text-slate-700 hover:text-brand" aria-label="${t.dec}">${SVG('<path d="M5 12h14"></path>')}</button><span class="w-7 text-center text-sm font-bold">1</span><button class="px-3 py-1 text-base font-bold leading-none text-slate-700 hover:text-brand disabled:cursor-not-allowed disabled:opacity-35" aria-label="${t.inc}">${SVG('<path d="M12 5v14M5 12h14"></path>')}</button></div><button aria-label="${t.remove}" class="cart-drawer__remove text-slate-400 hover:text-rose-600">${SVG(TRASH)}</button></div></div></li></ul><footer class="border-t border-black/10 px-6 py-5"><a class="btn btn-primary mt-4 w-full" href="#checkout">${t.checkout}</a><a class="mt-2 block text-center text-sm font-semibold text-slate-500 hover:text-brand" href="#shop">${t.back}</a></footer></aside>`

const checkout = (t) => `<section class="purchase-flow mx-auto max-w-6xl px-4 py-8"><nav class="purchase-steps"><ol class="flex items-center gap-2 text-sm"><li data-state="done" class="flex min-w-0 items-center gap-2"><a class="tap-row rounded-lg hover:underline" href="#cart"><span class="purchase-steps__body flex items-center gap-2"><span aria-hidden="true" class="purchase-steps__number grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold bg-brand text-ink">✓</span><span class="whitespace-nowrap font-semibold text-slate-600">${t.steps[0]}</span></span></a></li><li data-state="current"><span class="purchase-steps__number grid h-6 w-6 place-items-center rounded-full text-xs font-bold bg-brand-dark text-white">2</span> <span class="font-semibold text-accent">${t.steps[1]}</span></li></ol></nav><div class="guest-note mb-8 rounded-2xl border border-orange-200 bg-orange-50/70 px-4 py-3"><p class="guest-note__title text-sm font-bold text-orange-900">${t.note}</p><p class="guest-note__body mt-1 text-sm leading-snug text-orange-800"><a class="whitespace-nowrap font-semibold text-orange-900 underline underline-offset-2" href="#track">${t.track}</a></p><a class="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-orange-900 underline underline-offset-2" href="#account">${t.quick}</a></div><form novalidate class="purchase-checkout-layout"><div class="purchase-field"><label for="f-name">name</label><input id="f-name" aria-invalid="false" class="w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition focus:ring-2 border-slate-200 focus:border-brand focus:ring-brand/15"></div><div class="purchase-field"><label for="f-bad">bad</label><input id="f-bad" aria-invalid="true" class="w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none transition border-slate-200"></div><div class="purchase-panel purchase-checkout-summary"><div class="mt-4"><div class="flex gap-2"><input placeholder="${t.code}" aria-label="${t.code}" class="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm uppercase outline-none focus:border-accent" value=""><button type="button" disabled class="flex-none rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-40">${t.apply}</button></div></div><button type="submit" class="btn btn-primary mt-5 w-full" id="go">${t.checkout}</button><button type="submit" class="btn btn-primary mt-5 w-full" id="go-off" disabled>${t.checkout}</button></div><div class="purchase-payment"><label class="payment-method payment-method--selected"><input type="radio" name="pm" checked><span><span class="flex"><span>${t.pay1}</span><span class="payment-method__badge">COD</span></span></span></label><label class="payment-method"><input type="radio" name="pm"><span><span class="flex"><span>${t.pay2}</span></span></span></label></div><p class="purchase-notice rounded-xl border px-3 py-2 text-sm">${t.noticeText}</p></form></section>`

const legal = (t) => `<div class="legal-page" style="color:#18202b"><h1 class="page-heading">${t.ph}</h1><nav class="legal-page__contents"><a href="#terms">${t.ret}</a></nav><p>text <a class="underline" href="#inline">${t.ret}</a> text</p></div>`

const header = (t) => `<header class="app-header"><a class="navbar-link" href="#home">${t.home}</a><button class="navbar-cart" type="button">0</button></header>`
const footer = (t) => `<footer class="app-footer"><a class="footer-link" href="#f1">${t.back}</a></footer>`

// kind: hero | shop | product | drawer | checkout | legal | all (everything below the header, one page)
export const body = (kind, lang) => {
  const t = COPY[lang]
  const parts = {
    hero: hero(t) + brandBar(t),
    shop: shop(t), product: product(t), drawer: drawer(t), checkout: checkout(t), legal: legal(t),
  }
  const main = kind === 'all' ? Object.values(parts).join('') : parts[kind]
  return `<div class="storefront-root campaign-home">${header(t)}<main id="main" tabindex="-1" class="flex-1">${main}</main>${footer(t)}${kind === 'all' || kind === 'drawer' ? '' : drawer(t).replace('class="cart-drawer', 'style="display:none" class="cart-drawer')}</div>`
}

// Live rules. Source: CSSOM dump of the production stylesheets, 2026-11-03.
export const LIVE = `
:root{--brand:#e0561c;--brand-bright:#ff7b17;--brand-deep:#b8430f;--html5-brand-bright:#ff7b17;--primary:17.8 77.8% 49.4%;--accent-text:18.5 84.9% 39%;--ink:#171a1e;--surface:#fff;--canvas-muted:#f6f7f8;--text-muted:#596571;--line:rgba(23,26,30,.13);--shop-border:rgba(23,26,30,.13);--shop-divider-on-dark:#ffffff1f;--shop-border-on-dark:#ffffff2e;--shop-gutter-start:1rem;--shop-gutter-end:1rem;--shop-shell-half:40rem;--shop-radius-md:.75rem;--shop-border-subtle:rgba(23,26,30,.08)}
*,::before,::after{box-sizing:border-box}
html{font-size:16px}
body{margin:0;background:#fff;color:#171a1e;font-family:'DejaVu Sans',sans-serif}
a{color:inherit}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
/* Tailwind utilities the markup uses, reduced to what they carry */
.absolute{position:absolute}.relative{position:relative}.fixed{position:fixed}.isolate{isolation:isolate}.overflow-hidden{overflow:hidden}
.inset-0{inset:0}.inset-x-0{inset-inline:0}.inset-y-0{inset-block:0}.end-0{inset-inline-end:0}.start-3{inset-inline-start:.75rem}.end-3{inset-inline-end:.75rem}.end-2{inset-inline-end:.5rem}.top-2{top:.5rem}.top-1\\/2{top:50%}
.-translate-y-1\\/2{transform:translateY(-50%)}
.z-0{z-index:0}.z-\\[1\\]{z-index:1}.z-10{z-index:10}.z-50{z-index:50}
.flex{display:flex}.grid{display:grid}.block{display:block}.hidden{display:none}.inline-block{display:inline-block}.inline-flex{display:inline-flex}.shrink-0{flex-shrink:0}.flex-1{flex:1 1 0%}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}
.items-center{align-items:center}.items-end{align-items:flex-end}.justify-center{justify-content:center}.justify-between{justify-content:space-between}.place-items-center{place-items:center}
.w-full{width:100%}.h-full{height:100%}.h-11{height:2.75rem}.w-11{width:2.75rem}.min-w-11{min-width:2.75rem}.min-h-11{min-height:2.75rem}.max-w-xl{max-width:36rem}.max-w-7xl{max-width:80rem}.max-w-md{max-width:28rem}.max-w-6xl{max-width:72rem}.mx-auto{margin-inline:auto}
.rounded-full{border-radius:9999px}.rounded-xl{border-radius:.75rem}.rounded-2xl{border-radius:1rem}.rounded-lg{border-radius:.5rem}
.border{border:1px solid}.bg-white{background-color:#fff}.bg-white\\/55{background-color:rgba(255,255,255,.55)}.bg-white\\/95{background-color:rgba(255,255,255,.95)}.bg-ink{background-color:rgb(23,26,30)}.bg-ink\\/85{background-color:rgba(23,26,30,.85)}.bg-black\\/30{background-color:rgba(0,0,0,.3)}
.bg-orange-50\\/70{background-color:rgba(255,247,237,.7)}.border-orange-200{border-color:#ffd6a8}.border-slate-200{border-color:#e2e8f0}.border-slate-300{border-color:#cad5e2}.border-black\\/10{border-color:rgba(0,0,0,.1)}.border-black\\/15{border-color:rgba(0,0,0,.15)}.border-b{border-bottom:1px solid}.border-t{border-top:1px solid}
.bg-brand{background-color:var(--brand)}.bg-brand-dark{background-color:#99452b}
.text-white{color:#fff}.text-ink{color:#171a1e}.text-slate-300{color:#cad5e2}.text-slate-400{color:#90a1b9}.text-slate-500{color:#62748e}.text-slate-600{color:#45556c}.text-slate-700{color:#314158}.text-slate-900{color:#0f172b}.text-orange-800{color:#9f2d00}.text-orange-900{color:#7e2a0c}.text-accent{color:hsl(var(--accent-text))}
.text-sm{font-size:.875rem}.text-xs{font-size:.75rem}.text-xl{font-size:1.25rem}.text-3xl{font-size:1.875rem}.font-bold{font-weight:700}.font-semibold{font-weight:600}.font-extrabold{font-weight:800}.font-black{font-weight:900}.uppercase{text-transform:uppercase}.text-center{text-align:center}.text-start{text-align:start}.underline{text-decoration:underline}
.px-3{padding-inline:.75rem}.px-4{padding-inline:1rem}.py-1{padding-block:.25rem}.py-5{padding-block:1.25rem}.py-1\\.5{padding-block:.375rem}.py-14{padding-block:3.5rem}.px-3\\.5{padding-inline:.875rem}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.gap-4{gap:1rem}.gap-1{gap:.25rem}
.mt-2{margin-top:.5rem}.mt-4{margin-top:1rem}.mt-5{margin-top:1.25rem}.mb-8{margin-bottom:2rem}.mb-6{margin-bottom:1.5rem}
.transition{transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}
.disabled\\:opacity-35:disabled{opacity:.35}.disabled\\:opacity-40:disabled{opacity:.4}.disabled\\:cursor-not-allowed:disabled{cursor:not-allowed}
.object-cover{object-fit:cover}.object-contain{object-fit:contain}.aspect-\\[4\\/5\\]{aspect-ratio:4/5}.select-none{user-select:none}
@media (min-width:1024px){.lg\\:items-center{align-items:center}.lg\\:max-w-\\[45\\%\\]{max-width:45%}.lg\\:py-16{padding-block:4rem}}
@media (hover:hover){.hover\\:text-rose-600:hover{color:#e11d48}.hover\\:text-brand:hover{color:var(--brand)}.hover\\:text-slate-700:hover{color:#314158}.hover\\:text-accent:hover{color:hsl(var(--accent-text))}}

/* --- live bundle rules --- */
.btn{cursor:pointer;white-space:nowrap;border-radius:9999px;justify-content:center;align-items:center;gap:.5rem;height:3rem;padding:0 1.5rem;font-size:.95rem;font-weight:700;line-height:1;transition:transform .15s,background-color .2s,box-shadow .2s,color .2s;display:inline-flex;border:0;text-decoration:none}
.btn-primary{background:hsl(var(--primary));color:#fff;font-weight:800}
.btn-primary:hover{background:var(--brand-deep)}
.storefront-root .btn-primary,.campaign-cart-drawer .btn-primary,.storefront-root .btn-primary:hover,.campaign-cart-drawer .btn-primary:hover{background:var(--brand-bright);color:#171a1e}
.btn-ghost{background:0 0;border:1.5px solid}
.btn:focus-visible,.tap:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--html5-brand-bright);outline-offset:3px}
:focus-visible{outline:2px solid hsl(var(--primary));outline-offset:2px;border-radius:6px}
:focus:not(:focus-visible){outline:none}
.storefront-root :is(input,select,textarea):focus-visible{border-color:var(--brand);box-shadow:rgba(210,138,105,.12) 0 0 0 3px}
.campaign-hero-cta:focus-visible{outline-offset:4px;outline:2px solid #fff}
.campaign-brand-bar .brand-bar__item:focus-visible{outline-offset:-3px}
.catalog-filters{scroll-padding-inline:var(--shop-gutter-start);gap:.5rem;margin-block-end:1.25rem;padding-block:.25rem .75rem;display:flex;overflow-x:auto}
.catalog-filter{border:1px solid var(--shop-border,var(--line));background:var(--surface);color:var(--text-muted);flex-shrink:0}
.catalog-filter.is-active{color:#fff;box-shadow:inset 0 -3px var(--brand-bright);background:#171a1e;border-color:#171a1e}
.shop-grid{display:grid;grid-template-columns:repeat(2,minmax(0,12rem));gap:1rem}
.storefront-root .product-grid-card .catalog-card-image{flex:0 0 auto}
.storefront-root .catalog-card-image{aspect-ratio:4/5;border:1px solid var(--shop-border-subtle);border-radius:var(--shop-radius-md);isolation:isolate;background:#fff;place-items:center;display:grid}
.storefront-root .catalog-card-image>a{min-width:0;min-height:0}
.catalog-card-photo{object-fit:contain;object-position:center;max-width:100%;padding:.5rem;display:block}
.image-loading-skeleton{background:var(--canvas-muted);border-radius:.75rem;overflow:hidden}
.catalog-card-name{overflow-wrap:anywhere;width:100%;min-height:2.9rem;font-size:.9375rem;font-weight:650;line-height:1.45}
.catalog-card-save{border:1px solid #171a1e1f;border-radius:.625rem}
.catalog-product-title{overflow-wrap:anywhere;font-size:clamp(1.5rem,2.4vw,2.25rem);line-height:1.3}
.storefront-root .page-heading{color:inherit;font-size:clamp(1.875rem,4.5vw,3.5rem);line-height:1.25}
.storefront-root :where(.btn,.tap,.navbar-link,.catalog-filter,.purchase-payment .payment-method){text-align:center}
.campaign-hero-copy{color:#fff}
.campaign-hero-title{text-wrap:balance;text-shadow:rgba(0,0,0,.12) 0 2px 20px;margin-block:.75rem 0;font-size:clamp(1.875rem,7.8vw,2.5rem);line-height:1.15}
[dir=rtl] .campaign-hero-title{letter-spacing:0;line-height:1.28}
.campaign-hero-sub{border-inline-start:2px solid var(--brand-bright);color:rgba(255,255,255,.82);max-width:27rem;margin-block-start:.75rem;padding-inline-start:.875rem;font-size:.875rem;line-height:1.75}
.campaign-hero-cta{background:var(--brand-bright);color:#171a1e;border:1px solid transparent;border-radius:.75rem;justify-content:center;align-items:center;gap:1rem;min-height:3rem;margin-block-start:1.125rem;padding:.625rem .75rem .625rem 1.125rem;padding-inline:1.125rem .75rem;font-size:.875rem;font-weight:800;text-decoration:none;transition:background-color .18s,transform .18s,box-shadow .18s;display:inline-flex}
.campaign-hero-cta-icon{background:rgba(23,26,30,.09);border-radius:.5rem;place-items:center;width:1.875rem;height:1.875rem;display:grid}
@media (hover:hover){.campaign-hero-cta:hover{background:var(--brand-bright);transform:translateY(-2px);box-shadow:rgba(210,138,105,.17) 0 5px 20px}}
.campaign-photo-hero-scrim{background:linear-gradient(rgba(0,0,0,0) 12%,rgba(15,18,23,.08) 28%,rgba(15,18,23,.62) 60%,rgba(15,18,23,.9) 100%)}
.campaign-photo-hero-content{min-height:540px}
@media (min-width:1024px){.campaign-hero-title{margin-block-start:1.125rem;font-size:clamp(2.5rem,4.6vw,4.5rem)}.campaign-hero-sub{margin-block-start:1rem;font-size:1rem}.campaign-hero-cta{margin-block-start:1.5rem}}
@media (min-width:1024px){.campaign-photo-hero-scrim{background:linear-gradient(90deg,rgba(15,18,23,.7),rgba(15,18,23,.16) 54%,rgba(0,0,0,0) 82%)}[dir=rtl] .campaign-photo-hero-scrim{background:linear-gradient(270deg,rgba(15,18,23,.7),rgba(15,18,23,.16) 54%,rgba(0,0,0,0) 82%)}.campaign-photo-hero--copy-end .campaign-photo-hero-content{justify-content:flex-end}[dir=ltr] .campaign-photo-hero--copy-end .campaign-photo-hero-scrim{background:linear-gradient(270deg,rgba(15,18,23,.7),rgba(15,18,23,.16) 54%,rgba(0,0,0,0) 82%)}[dir=rtl] .campaign-photo-hero--copy-end .campaign-photo-hero-scrim{background:linear-gradient(90deg,rgba(15,18,23,.7),rgba(15,18,23,.16) 54%,rgba(0,0,0,0) 82%)}}
@media (min-width:1440px){.campaign-hero-copy{max-width:56%!important}}
.campaign-brand-bar{z-index:20;color:#fff;background:#171a1e;padding-block:.75rem;position:relative;box-sizing:border-box;width:100%;padding-inline:1rem}
.campaign-brand-bar .brand-bar__cta{min-height:2.75rem;color:var(--brand-bright);align-items:center;display:inline-flex}
.campaign-brand-bar .brand-bar__track{display:grid;grid-auto-flow:column;gap:.75rem;margin:0;padding:0;list-style:none}
.campaign-brand-bar .brand-bar__item{border:1px solid var(--shop-border-on-dark);color:#fff;border-radius:.875rem;justify-content:center;align-items:center;height:4.25rem;padding:.625rem;display:flex;text-decoration:none}
.app-header,.app-footer{background:#171a1e;color:#fff;padding:.75rem 1rem}
.app-header a,.app-footer a{color:#fff}
/* purchase flow */
.purchase-flow,.campaign-cart-drawer,.purchase-result{--purchase-border:#171a1e24;--purchase-divider:#171a1e17;--purchase-control-border:#171a1e33;--purchase-focus:var(--brand-deep);--purchase-focus-ring:color-mix(in srgb,var(--brand) 18%,transparent)}
.purchase-count{min-width:1.75rem;min-height:1.75rem;color:hsl(var(--accent-text));white-space:nowrap;background:rgba(210,138,105,.11);border-radius:.5rem;justify-content:center;align-items:center;padding:.25rem .625rem;font-size:.75rem;font-weight:700;display:inline-flex}
.campaign-cart-drawer>header .purchase-count{display:inline-flex;align-items:center;justify-content:center;min-width:1.75rem;height:1.75rem;padding:0 .5rem;border-radius:9999px;background:rgb(246,231,222);color:rgb(184,67,15);font-size:.875rem;font-weight:800;line-height:1}
.purchase-quantity{border-color:var(--purchase-control-border);background:var(--canvas-muted);border-radius:.625rem;flex-shrink:0;overflow:hidden}
.purchase-quantity button{place-items:center;min-width:2.5rem;min-height:2.5rem;display:grid}
.purchase-quantity button:hover{background:rgba(210,138,105,.1)}
.purchase-quantity button:focus-visible{z-index:1;position:relative}
.purchase-steps{border:1px solid var(--purchase-border);background:var(--canvas-muted);border-radius:1rem;align-items:center;max-width:100%;min-height:3.25rem;padding:.75rem 1rem;display:inline-flex}
.purchase-notice{color:hsl(var(--accent-text));background:rgba(210,138,105,.067);border-color:rgba(210,138,105,.25)}
.purchase-checkout-layout :where(input:not([type=checkbox]):not([type=radio]):not([aria-invalid=true]),select:not([aria-invalid=true]),textarea:not([aria-invalid=true])){border-color:var(--purchase-control-border);min-height:2.875rem}
.purchase-checkout-layout :where(input:not([type=checkbox]):not([type=radio]):not(.bg-transparent),select,textarea):focus-visible{border-color:var(--purchase-focus);outline-offset:2px;box-shadow:0 0 0 3px var(--purchase-focus-ring);outline:rgba(0,0,0,0) solid 2px}
.purchase-checkout-layout :where(input,select,textarea)[aria-invalid=true]:focus-visible{border-color:rgb(190,18,60);box-shadow:rgba(225,29,72,.16) 0 0 0 3px}
.purchase-checkout-summary input+button{border-color:var(--purchase-control-border)}
.purchase-payment .payment-method{border:1px solid var(--purchase-control-border);background:var(--surface);text-align:start;border-radius:.875rem;grid-template-columns:1.125rem minmax(0,1fr);align-items:flex-start;gap:.8rem;min-height:4.9rem;padding:.9rem 1rem;display:grid;position:relative;margin-block-end:.5rem}
.purchase-payment .payment-method:hover{border-color:color-mix(in srgb,var(--brand) 52%,var(--purchase-control-border));background:color-mix(in srgb,var(--brand-bright) 3%,var(--surface))}
.purchase-payment .payment-method--selected{border-color:var(--brand);background:rgba(210,138,105,.067);box-shadow:rgba(199,106,66,.9) 0 5px 16px -12px}
.purchase-payment .payment-method--selected:hover{background:rgba(210,138,105,.09)}
.purchase-payment .payment-method__badge{border:1px solid var(--purchase-divider);background:var(--surface);min-width:3.7rem;color:var(--text-muted);font-size:.75rem;border-radius:.375rem}
.purchase-payment .payment-method--selected .payment-method__badge{border-color:color-mix(in srgb,var(--brand) 58%,var(--purchase-divider));color:hsl(var(--accent-text));background:rgba(210,138,105,.09)}
.purchase-payment .payment-method:focus-within{outline:2px solid var(--purchase-focus);outline-offset:2px}
.purchase-payment .payment-method input:focus-visible{outline:none}
.campaign-cart-drawer .cart-drawer__remove{border-radius:.65rem;flex-shrink:0;place-items:center;width:2.5rem;height:2.5rem;display:grid}
.campaign-cart-drawer .cart-drawer__remove:hover{background:rgba(244,63,94,.08)}
.legal-page__contents a{display:inline-block;margin:.25rem}
`

// Add-ons that are already linked by the live index.html and that the rules above sit beside. Only the
// parts that name the same elements; the file under test is passed separately.
export const LINKED_ADDONS = `
.cart-drawer header button.text-slate-400{color:#171a1e!important}
.cart-drawer header button.text-slate-400:hover{color:#b8430f!important}
button[aria-label="إنقاص الكمية"],button[aria-label="زيادة الكمية"],button[aria-label="Decrease quantity"],button[aria-label="Increase quantity"]{color:#171a1e!important}
.campaign-category:focus-visible{outline:rgb(255,143,61) solid 2px;outline-offset:3px}
.sf__btn:focus-visible{outline:rgb(255,143,61) solid 2px;outline-offset:2px}
`

// The order the live index.html links them in: bundle first, then the add-ons. The brand-theme file carries the
// rule `.btn-primary:hover,.btn-primary:focus-visible{color:#fff}` in production; tests pass the real file.
export const page = (kind, lang, ...addons) => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" data-theme="light"><head><meta charset="utf-8"><style>${LIVE}</style><style>${LINKED_ADDONS}</style>${addons.map((a) => `<style>${a}</style>`).join('')}</head><body>${body(kind, lang)}</body></html>`
