// The live storefront header and menu (announcement bar, brand row, menu tabs) as a fixture, for
// menu-layout-test.mjs, which proves the "header and menu layout" section of public/sporta-bag-touch.css.
//
// What is exact and what is not:
//   exact         the DOM of the live <header class="app-header"> (class lists, nesting, order, aria attributes),
//                 captured from https://www.sporta.com.kw on 2026-11-03 (Arabic, 390px); the English page is the
//                 same markup with the English copy of t.nav / t.topbar and dir=ltr on the announcement bar.
//                 Every rule of the live compiled stylesheet (index-CdcKvZhs.css) that matches an element of that
//                 header, as dumped from the page's CSSOM (selectors and declarations unchanged, media queries
//                 included, source order kept) - see LIVE_RULES. The Tailwind utilities the markup uses come from
//                 REAL Tailwind v4 (the test compiles them), the brand colours from the real add-on files
//                 (sporta-brand-theme.css, sporta-ui-colours.css, sporta-shadows.css, sporta-clock.css).
//   reconstructed the icons' paths (the capture has them empty: only their width/height attributes size them),
//                 the logo (the real public/logo-white.png, inlined), and the page under the header (a tall
//                 block, so the sticky header can be scrolled).
//   NOT recorded  the markup and CSS of the ACTIVE tab (the capture was taken on a page where no tab is
//                 current, so there is no aria-current / is-active example and no ::after rule). The fixture
//                 marks one tab with aria-current="page" and adds NO indicator of its own: the suite never
//                 asserts anything about the live underline, and the add-on never touches it.
//   Fonts         the real IBM Plex Arabic subsets the shop self-hosts (public/fonts), inlined by the test, so
//                 text widths (truncation, wrapping) are the live ones, not a fallback font's.

export const LIVE_RULES = `:root { --brand: #c76a42; --brand-bright: #d28a69; --brand-deep: #99452b; --ink: #171a1e; --text-primary: #171a1e; --canvas: #fff; --canvas-muted: #f6f7f8; --surface: #fff; --surface-raised: #fff; --line-soft: #171a1e13; --line: #171a1e21; --line-strong: #7b8793; --text-muted: #596571; --primary: 18.9 53.8% 61.8%; --primary-foreground: 210 13% 10%; --accent: 14.2 56.1% 38.4%; --accent-foreground: 0 0% 100%; --accent-text-light: 14.2 56.1% 38.4%; --accent-text-dark: 18.9 53.8% 61.8%; --accent-text: var(--accent-text-light); --on-brand: 210 13% 10%; --type-micro: .6875rem; --type-caption: .75rem; --type-body: .9375rem; --type-lead: 1rem; }
[dir="rtl"] { --type-micro: .75rem; }
:root { --html5-brand: var(--brand); --html5-brand-bright: var(--brand-bright); --html5-brand-dark: var(--brand-deep); --html5-ink: var(--ink); --html5-canvas: var(--canvas); --html5-surface: var(--surface); --html5-surface-muted: var(--canvas-muted); }
.storefront-root main#main > section.mx-auto:not(.invoice) { box-sizing: border-box; padding-inline-start: var(--shop-gutter-start,max(clamp(1rem, 3vw, 2.5rem), var(--sa-left,0px))); padding-inline-end: var(--shop-gutter-end,max(clamp(1rem, 3vw, 2.5rem), var(--sa-right,0px))); }
.storefront-root footer.app-footer > .mx-auto, .storefront-root .app-header .navbar-main { box-sizing: border-box; width: 100%; max-width: var(--shop-shell-max,80rem); margin-inline: auto; padding-inline-start: var(--shop-gutter-start,max(clamp(1rem, 3vw, 2.5rem), var(--sa-left,0px))); padding-inline-end: var(--shop-gutter-end,max(clamp(1rem, 3vw, 2.5rem), var(--sa-right,0px))); }
.btn, .tap, button, a { -webkit-tap-highlight-color: transparent; }
.btn:focus-visible, .tap:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--html5-brand-bright); outline-offset: 3px; }
.app-header .navbar-main { padding-inline-start: max(clamp(1rem, 3vw, 2.5rem), var(--sa-left,0px)); padding-inline-end: max(clamp(1rem, 3vw, 2.5rem), var(--sa-right,0px)); }
.app-header .navbar-main > :first-child, .app-header .navbar-main > :last-child { align-items: center; min-width: 2.75rem; display: flex; }
.storefront-root .navbar-tools, .storefront-root .navbar-actions { align-items: center; min-width: 0px; height: 2.75rem; min-height: 2.75rem; }
.storefront-root .navbar-tools { justify-self: start; gap: 0.5rem; }
.storefront-root .navbar-actions { justify-self: end; gap: 0.5rem; }
.app-header .navbar-main > :first-child { direction: ltr; flex-direction: row-reverse; align-items: center; min-width: 2.75rem; min-height: 2.75rem; display: flex; }
.storefront-root .navbar-tools { justify-self: start; }
.storefront-root .navbar-logo { justify-self: center; min-width: 0px; }
.storefront-root .navbar-actions { direction: ltr; justify-self: end; }
.app-header .navbar-main .tap { min-width: 2.75rem; height: 2.75rem; min-height: 2.75rem; line-height: 1; }
.app-header .navbar-main .navbar-ai, .app-header .navbar-main .navbar-cart, .app-header .navbar-main .navbar-language { box-sizing: border-box; flex: 0 0 auto; justify-content: center; align-items: center; height: 2.75rem; min-height: 2.75rem; }
.app-header .navbar-main .navbar-cart { width: 2.75rem; padding: 0px; }
.app-header .navbar-main .navbar-language { letter-spacing: 0.02em; min-width: 4.25rem; padding-block: 0px; padding-inline: 0.75rem; }
.app-header .navbar-main .clock { box-sizing: border-box; justify-content: center; align-items: center; gap: 0.125rem; width: auto; min-width: 2.75rem; height: 2.75rem; }
.app-header .navbar-main .clock svg { filter: drop-shadow(rgba(0, 0, 0, 0.28) 0px 2px 5px); flex: 0 0 auto; width: 2.5rem; height: 2.5rem; overflow: visible; }
.app-header .navbar-main .clock__face { transition: fill 0.18s, stroke 0.18s; }
.app-header .navbar-ai { box-sizing: border-box; white-space: nowrap; color: rgb(255, 255, 255); height: 2.75rem; min-height: 2.5rem; box-shadow: none; background: 0px 0px; }
.app-header .navbar-ai:hover { color: rgb(255, 255, 255); background: rgba(255, 255, 255, 0.08); box-shadow: rgba(0, 0, 0, 0.18) 0px 4px 12px; }
@media (max-width: 639px){.app-header .navbar-main { padding-inline: max(1rem, var(--sa-left,0px)) max(1rem, var(--sa-right,0px)); }}
@media (max-width: 639px){.app-header .navbar-main .tap { min-width: 2.75rem; height: 2.75rem; min-height: 2.75rem; }}
@media (max-width: 639px){.app-header .navbar-ai { width: 2.75rem; padding-inline: 0px; }}
@media (max-width: 639px){.storefront-root .navbar-tools, .storefront-root .navbar-actions { gap: 0.375rem; }}
@media (max-width: 639px){.app-header .navbar-main .navbar-language { min-width: 2.75rem; padding-inline: 0px; }}
@media (max-width: 639px){.app-header .navbar-ai-label { display: none; }}
@media (max-width: 639px){.app-header .navbar-main .clock { width: 2.75rem; }}
@media (max-width: 639px){.app-header .navbar-main .clock svg { width: 2.125rem; height: 2.125rem; }}
@media (hover: hover) and (pointer: fine){.app-header .navbar-main .clock:hover .clock__face { fill: rgba(255, 255, 255, 0.14); stroke: rgba(255, 255, 255, 0.38); }}
@media (hover: hover) and (pointer: fine){.app-header .navbar-cart, .app-header .navbar-language, .catalog-card-save, .catalog-card-add, .catalog-gallery-arrow, .catalog-gallery-zoom, .app-footer a[aria-label] { transition: transform 0.18s, color 0.18s, background-color 0.18s, border-color 0.18s, box-shadow 0.18s; }}
@media (hover: hover) and (pointer: fine){.app-header .navbar-cart:hover, .app-header .navbar-language:hover, .catalog-card-save:hover, .catalog-card-add:hover, .catalog-gallery-arrow:hover, .catalog-gallery-zoom:hover, .app-footer a[aria-label]:hover { transform: translateY(-1px); }}
@media (hover: hover) and (pointer: fine){.app-header .navbar-cart:hover svg, .app-header .navbar-language:hover svg, .catalog-card-save:hover svg, .catalog-card-add:hover svg, .catalog-gallery-arrow:hover svg, .catalog-gallery-zoom:hover svg, .app-footer a[aria-label]:hover svg, .storefront-root :where(.btn, .home-shop-link, .brand-bar__cta):hover > .sporta-icon, .storefront-root .home-feature-item:hover .sporta-icon { transform: scale(1.08); }}
@media (hover: hover) and (pointer: fine){.app-header .navbar-cart svg, .app-header .navbar-language svg, .catalog-card-save svg, .catalog-card-add svg, .catalog-gallery-arrow svg, .catalog-gallery-zoom svg, .app-footer a[aria-label] svg { transition: transform 0.18s; }}
@media (prefers-reduced-motion: reduce){.product-grid-card, .product-grid-card h3, .app-header .navbar-cart, .app-header .navbar-language, .catalog-card-save, .catalog-card-add, .catalog-gallery-arrow, .catalog-gallery-zoom, .app-footer a[aria-label], .app-header .navbar-cart svg, .app-header .navbar-language svg, .catalog-card-save svg, .catalog-card-add svg, .catalog-gallery-arrow svg, .catalog-gallery-zoom svg, .app-footer a[aria-label] svg, .storefront-root .sporta-icon { transition: none; }}
.topbar { isolation: isolate; background: var(--brand); color: rgb(23, 26, 30); letter-spacing: 0px; position: relative; }
.topbar--tone-brand { background: var(--brand); color: rgb(23, 26, 30); }
.topbar--align-center { text-align: center; justify-content: center; }
.topbar__dot { opacity: 0.72; background: currentcolor; border-radius: 999px; flex: 0 0 auto; width: 0.35rem; height: 0.35rem; }
@media (max-width: 639px){.topbar { font-size: var(--type-micro); padding-inline: 0.7rem; line-height: 1.25; }}
@media (max-width: 639px){.topbar__dot { width: 0.3rem; height: 0.3rem; }}
.storefront-root { --shop-radius: .875rem; --shop-radius-lg: 1rem; --shop-radius-md: .75rem; --shop-border: var(--line); --shop-border-subtle: var(--line); }
.storefront-root { --shop-border-subtle: color-mix(in srgb, var(--line) 78%, transparent); }
.storefront-root { --shop-control-border: var(--line-strong); --shop-border-on-light: #171a1e1f; --shop-border-on-dark: #ffffff2e; --shop-divider-on-dark: #ffffff1f; --shop-shell-max: 80rem; --shop-shell-half: 40rem; --shop-gutter-start: max(clamp(1rem, 3vw, 2.5rem), var(--sa-left,0px)); --shop-gutter-end: max(clamp(1rem, 3vw, 2.5rem), var(--sa-right,0px)); --shop-section-space: clamp(1.125rem, 2.25vw, 2rem); --shop-grid-column-gap: clamp(.625rem, 1.5vw, 1.25rem); --shop-grid-row-gap: clamp(1.25rem, 2.4vw, 2rem); }
[dir="rtl"] .storefront-root { --shop-gutter-start: max(clamp(1rem, 3vw, 2.5rem), var(--sa-right,0px)); --shop-gutter-end: max(clamp(1rem, 3vw, 2.5rem), var(--sa-left,0px)); }
.storefront-root .topbar { padding-inline-start: max(var(--shop-gutter-start), calc(50vw - var(--shop-shell-half) + var(--shop-gutter-start))); padding-inline-end: max(var(--shop-gutter-end), calc(50vw - var(--shop-shell-half) + var(--shop-gutter-end))); }
.storefront-root .btn, .campaign-cart-drawer .btn { box-shadow: none; border-radius: 0.75rem; font-size: 0.875rem; }
.storefront-root .btn-primary, .campaign-cart-drawer .btn-primary, .storefront-root .btn-primary:hover, .campaign-cart-drawer .btn-primary:hover { background: var(--brand-bright); color: rgb(23, 26, 30); }
:root:not([data-theme="dark"]) .storefront-root .text-brand, :root:not([data-theme="dark"]) .storefront-root .hover\\:text-brand:hover { color: var(--brand-deep); }
.storefront-root :is(input[type="text"], input[type="email"], input[type="tel"], input[type="password"], input[type="number"], input[type="search"], input:not([type]), select, textarea) { border: 1px solid var(--shop-control-border); border-radius: var(--shop-radius-md); min-width: 0px; min-height: 3rem; color: inherit; background-color: var(--surface); font-style: inherit; font-variant: inherit; font-weight: inherit; font-stretch: inherit; font-family: inherit; font-optical-sizing: inherit; font-size-adjust: inherit; font-kerning: inherit; font-feature-settings: inherit; font-variation-settings: inherit; text-align: start; font-size: 1rem; line-height: 1.45; transition: border-color 0.18s, box-shadow 0.18s; }
.storefront-root :is(input[type="text"], input[type="email"], input[type="tel"], input[type="password"], input[type="number"], input[type="search"], input:not([type]), select) { padding-block: 0.7rem; padding-inline: 0.9rem; }
.storefront-root :is(input, select, textarea):focus-visible { border-color: var(--brand); box-shadow: rgba(210, 138, 105, 0.12) 0px 0px 0px 3px; }
.storefront-root .app-header { border-color: var(--shop-divider-on-dark); background: rgb(23, 26, 30); }
.storefront-root .navbar-main { direction: ltr; grid-template-columns: minmax(0px, 1fr) auto minmax(0px, 1fr); align-items: center; gap: 0.5rem; min-height: 3.75rem; padding-block: 0.5rem; display: grid; }
.storefront-root .navbar-tools { gap: 0.5rem; }
.storefront-root .navbar-logo { justify-self: center; }
.storefront-root .navbar-actions { direction: ltr; justify-self: end; gap: 0.5rem; }
.storefront-root .navbar-ai, .storefront-root .navbar-language, .storefront-root .navbar-cart { min-height: 2.75rem; box-shadow: none; background: 0px 0px; border: 0px; border-radius: 0.75rem; }
.storefront-root .navbar-cart { min-width: 2.75rem; }
.storefront-root .navbar-cart .sporta-icon { stroke-width: 1.9px; }
.storefront-root .navbar-language .sporta-icon { opacity: 0.92; }
.storefront-root .sporta-icon { vertical-align: -0.125em; color: currentcolor; flex: 0 0 auto; transition: color 0.18s, transform 0.18s, opacity 0.18s; display: inline-block; }
.storefront-root :where(.btn, .tap, .navbar-link, .home-shop-link, .brand-bar__cta, .catalog-product-reassurance) > .sporta-icon { flex-shrink: 0; }
.storefront-root .navbar-cart:focus-visible, .storefront-root .navbar-language:focus-visible, .storefront-root .footer-socials a:focus-visible { outline: 2px solid var(--brand-bright); outline-offset: 3px; }
.storefront-root .navbar-secondary { border-color: var(--shop-divider-on-dark); background: rgba(255, 255, 255, 0.024); }
.storefront-root .navbar-secondary > ul { box-sizing: border-box; width: 100%; max-width: var(--shop-shell-max); margin-inline: auto; padding-inline-start: var(--shop-gutter-start); padding-inline-end: var(--shop-gutter-end); }
@media (max-width: 639px){.storefront-root .navbar-secondary ul { grid-template-columns: repeat(5, minmax(0px, 1fr)); gap: 0px; display: grid; }}
@media (max-width: 639px){.storefront-root .navbar-secondary li { min-width: 0px; }}
@media (max-width: 639px){.storefront-root .navbar-secondary .navbar-link { white-space: nowrap; justify-content: center; padding-inline: 0.25rem; font-size: clamp(0.75rem, 3vw, 0.8125rem); }}
.storefront-root .navbar-link { font-size: 0.8125rem; position: relative; }
.storefront-root .sporta-footer { background: rgb(23, 26, 30); margin-block-start: clamp(3rem, 6vw, 5rem); }
@media (hover: hover) and (pointer: fine){.storefront-root .navbar-cart:hover, .storefront-root .navbar-language:hover { box-shadow: none; background: rgba(210, 138, 105, 0.12); }}
.storefront-root :where(.btn, .tap, .navbar-link, .catalog-filter, .purchase-payment .payment-method) { text-align: center; }
@media (max-width: 639px){.storefront-root .app-header .navbar-main { gap: 0.25rem; padding-inline-start: var(--shop-gutter-start); padding-inline-end: var(--shop-gutter-end); }}
@media (max-width: 639px){.storefront-root .navbar-tools, .storefront-root .navbar-actions { gap: 0.25rem; }}
@media (max-width: 639px){.storefront-root .app-header .navbar-main .clock { width: 2.75rem; }}
@media (max-width: 639px){.storefront-root .app-header .navbar-main .clock svg { width: 2.125rem; height: 2.125rem; }}
@media (max-width: 639px){.storefront-root .navbar-logo img { height: 1.75rem; }}
@media (max-width: 639px){.storefront-root .app-header .navbar-main .navbar-language { padding-inline: 0.375rem; }}
html { scroll-behavior: smooth; text-size-adjust: 100%; font-size: clamp(16px, 15.5px + 0.104vw, 17px); }
body { color: var(--ink); background-color: var(--canvas); -webkit-font-smoothing: antialiased; text-rendering: optimizelegibility; font-family: var(--sporta-font-body-en,"Sporta Plex Arabic Local"), "Plex Arabic Fallback", "ibm-plex-arabic", system-ui, sans-serif; font-optical-sizing: auto; line-height: 1.6; }
[dir="rtl"] body { font-family: var(--sporta-font-body-ar,"Sporta Plex Arabic Local"), "Plex Arabic Fallback", "ibm-plex-arabic", system-ui, sans-serif; }
.tabular-nums, .price { font-variant-numeric: tabular-nums; }
:focus-visible { outline: 2px solid hsl(var(--primary)); outline-offset: 2px; border-radius: 6px; }
:root { --sa-top: env(safe-area-inset-top,0px); --sa-right: env(safe-area-inset-right,0px); --sa-bottom: env(safe-area-inset-bottom,0px); --sa-left: env(safe-area-inset-left,0px); }
.app-header { padding-top: var(--sa-top); }
.app-header > *, .app-footer > * { padding-inline: var(--sa-left) var(--sa-right); }
@media (max-width: 1023px){.app-header { will-change: transform; transition: transform 0.3s; }}
@media (prefers-reduced-motion: reduce){.app-header { transition: none !important; }}
[dir="rtl"] body { line-height: 1.75; }
[dir="rtl"] .text-xs { font-size: 0.8125rem; }`

// Tailwind compiled at test time from the class names in HEADER_AR, with these two theme colours added the
// way the live build has them (bg-ink is a flat charcoal, bg-brand / text-brand-bright follow the variables).
export const THEME = `@theme inline { --color-ink: rgb(23, 26, 30); --color-brand: var(--brand); --color-brand-bright: var(--brand-bright); }`

const ICON = (w, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle ${extra}" shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"/><path d="M8 12h8"/></svg>`
const CLOCK = `<svg width="40" height="40" viewBox="0 0 48 48" class="h-10 w-10 sm:h-11 sm:w-11" aria-hidden="true" focusable="false"><circle class="clock__face" cx="24" cy="24" r="21" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.3)" stroke-width="2"/><path d="M24 24V12M24 24l8 4" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`

const COPY = {
  ar: {
    dir: 'rtl', topbar: 'التوصيل خلال ٢٤ ساعة داخل الكويت · الدفع عند الاستلام', ai: 'سبورتا AI', aiLabel: 'افتح مساعد سبورتا',
    clock: 'توقيت الكويت 12:13', home: 'سبورتا — الرئيسية', lang: 'تغيير اللغة', langText: 'EN', bag: 'الحقيبة',
    tabs: ['الرئيسية', 'المتجر', 'من نحن', 'اتصل بنا', 'حسابي'],
  },
  en: {
    dir: 'ltr', topbar: 'Delivery within 24 hours inside Kuwait · Cash on delivery', ai: 'Sporta AI', aiLabel: 'Open the Sporta assistant',
    clock: 'Kuwait time 12:13', home: 'Sporta — Home', lang: 'Switch language', langText: 'AR', bag: 'Bag',
    tabs: ['Home', 'Shop', 'About', 'Contact', 'Account'],
  },
}
const HREFS = ['/', '/shop', '/about', '/contact', '/account']

export const headerHtml = (lang, logoSrc) => {
  const c = COPY[lang]
  const tab = (label, i) => `<li><a class="navbar-link flex min-h-11 items-center px-2 transition hover:text-brand-bright text-white/80" href="${HREFS[i]}" data-discover="true"${i === 1 ? ' aria-current="page"' : ''}>${label}</a></li>`
  return `<header class="app-header sticky top-0 z-30 border-b border-white/10 bg-ink/95 text-white backdrop-blur"><p class="topbar topbar--tone-brand topbar--align-center flex h-8 items-center gap-2 overflow-hidden px-4 text-[.7rem] font-bold leading-none sm:text-xs" dir="${c.dir}" role="status"><span class="topbar__dot" aria-hidden="true"></span><span class="min-w-0 truncate">${c.topbar}</span></p><nav class="navbar-main mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-3 py-2 sm:px-4 sm:py-3"><div class="navbar-tools flex items-center gap-2"><button aria-expanded="false" aria-label="${c.aiLabel}" class="assistant-launcher navbar-ai tap flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-bold text-white/90 hover:text-brand-bright print:hidden">${ICON(19)}<span class="navbar-ai-label">${c.ai}</span></button><span role="img" aria-label="${c.clock}" title="${c.clock}" dir="ltr" class="clock flex shrink-0 items-center is-sweeping">${CLOCK}<span class="ms-2 hidden text-xs font-semibold tabular-nums text-white/85 sm:inline">12:13</span></span></div><a aria-label="${c.home}" class="navbar-logo flex min-h-11 items-center" href="/" data-discover="true"><picture><img alt="Sporta Sports Wear" width="132" height="41" class="h-8 w-auto md:h-9" src="${logoSrc}"></picture></a><div class="navbar-actions flex items-center gap-1 sm:gap-3"><button aria-label="${c.lang}" class="navbar-language tap flex items-center justify-center gap-1 rounded-xl px-3 py-1 text-xs font-semibold text-white/90 hover:text-brand-bright">${ICON(14)} ${c.langText}</button><button class="navbar-cart tap relative flex items-center justify-center" aria-label="${c.bag}">${ICON(22)}<span class="absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-xs font-bold text-ink">2</span></button></div></nav><div class="navbar-secondary border-t border-white/5"><ul class="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 text-sm font-semibold sm:gap-6">${c.tabs.map(tab).join('')}</ul></div></header>`
}

// IBM Plex Arabic as the shop self-hosts it (family name as the live CSS calls it); ranges are Google Fonts'.
export const fontFaces = (b64) => [400, 600, 700].map((w) => `
@font-face{font-family:"Sporta Plex Arabic Local";font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64['plex-' + w + '-arabic']}) format("woff2");unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC}
@font-face{font-family:"Sporta Plex Arabic Local";font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64['plex-' + w + '-latin']}) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`).join('\n')
