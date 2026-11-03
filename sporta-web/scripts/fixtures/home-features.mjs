// The live home "features" band (Easy returns / Fast delivery / Cash on delivery), as a fixture: the exact
// markup dumped from www.sporta.com.kw on 2026-11-03 and the stylesheet rules that name it, copied from the
// live /assets/index-CdcKvZhs.css and /sporta-shadows.css. Used by home-features-test.mjs to prove the rules
// in public/sporta-home-trim.css against the real markup. The live site's English copy is not known, so the
// English strings are the repo's wording; only geometry is asserted, never words.
//
// The root font size is the live one (about 16px at 390px, 16.5px at 1000px, 16.8px at 1280px).
const ICONS = {
  ret: '<path d="M8 3 4 7 8 11M4 7H14a6 6 0 0 1 0 12H7"></path>',
  del: '<path d="M2 18V5H14V18M2 18H5M9 18H15M19 18H22V14L18 9H14"></path><circle cx="17" cy="18" r="2"></circle><circle cx="7" cy="18" r="2"></circle>',
  cod: '<rect x="2" y="5" width="20" height="14" rx="2"></rect><circle cx="12" cy="12" r="3"></circle><path d="M5.5 11V13M18.5 11V13"></path>',
}
const svg = (p) => `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle " shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke" aria-hidden="true" focusable="false">${p}</svg>`
const item = (k, t, s) => `<div class="sporta-features__item home-feature-item"><span class="home-feature-icon">${svg(ICONS[k])}</span><div><p class="home-feature-title">${t}</p><p class="home-feature-sub">${s}</p></div></div>`
export const COPY = {
  ar: [['ret', 'إرجاع سهل', 'إرجاع خلال ١٤ يومًا'], ['del', 'توصيل سريع', 'خلال ٢٤ ساعة'], ['cod', 'الدفع عند الاستلام', 'متاح عند إتمام الطلب']],
  en: [['ret', 'Easy returns', 'Return within 14 days'], ['del', 'Fast delivery', 'Within 24 hours'], ['cod', 'Cash on delivery', 'Available at checkout']],
}
export const strip = (lang) => `<div class="campaign-home"><section class="home-section home-features-wrap"><div class="sporta-features home-features relative isolate overflow-hidden"><div class="sporta-features__content home-features__content"><div class="sporta-features__track">${COPY[lang].map((c) => item(...c)).join('')}</div></div></div></section></div>`
// Rules copied from the live /assets/index-CdcKvZhs.css and /sporta-shadows.css (the ones that name the band).
export const LIVE = `
:root{--shop-border:rgba(23,26,30,.13);--line:rgba(23,26,30,.13);--canvas-muted:#f6f7f8;--surface:#fff;--brand-bright:#ff7b17;--brand:#e0561c;--brand-deep:#b8430f;--ink:#171a1e;--text-muted:#596571}
*,::before,::after{box-sizing:border-box}
html{font-size:calc(15.5px + .1vw)}
body{margin:0;background:#fff;font-family:'DejaVu Sans',sans-serif}
.home-section{padding:clamp(18px,2.25vw,22.5px) clamp(16px,3vw,30px);max-width:1323px;margin-inline:auto;box-sizing:border-box}
.relative{position:relative}.isolate{isolation:isolate}.overflow-hidden{overflow:hidden}
.inline-block{display:inline-block}.shrink-0{flex-shrink:0}.align-middle{vertical-align:middle}
.campaign-home .home-features{border:1px solid var(--shop-border,var(--line));background:var(--canvas-muted);border-radius:1.125rem;width:100%;overflow:hidden}
.home-features__content{width:100%;min-width:0;padding:clamp(.875rem,2vw,1.375rem)}
.campaign-home .sporta-features__track{grid-template-columns:minmax(0,1fr);align-items:stretch;gap:.75rem;margin-block-start:0;display:grid;overflow:visible}
.home-feature-item{border:1px solid var(--shop-border,var(--line));background:var(--surface);text-align:start;border-radius:.875rem;align-items:center;gap:.75rem;min-width:0;min-height:4.5rem;padding:.75rem 1rem;transition:border-color .18s,box-shadow .18s,transform .18s;display:flex;box-shadow:0 6px 18px -18px #171a1e8c}
.home-feature-item>div{min-width:0}
.home-feature-icon{background:color-mix(in srgb, var(--brand-bright) 14%, var(--surface));width:2.625rem;height:2.625rem;color:var(--brand-deep);border-radius:.75rem;flex-shrink:0;place-items:center;display:grid}
.home-feature-title{color:var(--ink);font-size:.9375rem;font-weight:750;line-height:1.45;margin:0}
.home-feature-sub{color:var(--text-muted);margin:.125rem 0 0;font-size:.8125rem;line-height:1.5}
@media (hover:hover){.home-feature-item:hover{border-color:color-mix(in srgb, var(--brand) 55%, var(--line));transform:translateY(-1px);box-shadow:0 10px 24px -18px #171a1e8c}}
@media (min-width:720px){.campaign-home .sporta-features__track{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (min-width:1024px){.home-feature-item{justify-content:center}}
.home-feature-item{box-shadow:0 6px 16px -16px rgba(23,26,30,.3)!important}
`
export const page = (lang, extraCss = '') => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${LIVE}</style><style>${extraCss}</style></head><body>${strip(lang)}</body></html>`
