// The live storefront ICONS, as a fixture for icons-polish-test.mjs (which proves the "Icons" sections of
// public/sporta-shadows.css, sporta-clock.css and sporta-cat-tiles.css).
//
// What is exact and what is not:
//   exact         the DOM of the live header, footer club + socials + payments, bag drawer header / line / quantity /
//                 remove / note, and the product-page reassurance list, size-guide button and quantity buttons:
//                 class lists, nesting, and the <svg> attributes (width, height, stroke-width, class,
//                 vector-effect on the <svg>), captured from https://www.sporta.com.kw on 2026-11-03 (Arabic).
//                 The product card (heart 17, add 18) is the markup of scripts/fixtures/product-desc.mjs.
//                 The home features band is scripts/fixtures/home-features.mjs, untouched (it has the real paths).
//   recorded      LIVE_ICON_RULES: every rule of the live /assets/index-CdcKvZhs.css that names one of these
//                 elements or .sporta-icon, in source order, media queries kept (G.rules of the 2026-11-03 capture).
//   reconstructed the glyph PATHS (the capture has every <svg> empty except the three features-band icons, which
//                 are exact): the shapes here are the repo's own icon set (src/components/icons.jsx), the same
//                 24x24 outline family. Nothing in the suite depends on what a glyph looks like, only on the
//                 <svg> box, its stroke and where the box sits, EXCEPT the return arrow of the features band
//                 (exact path) and the Instagram dot (a zero-length round-capped stroke, checked by a screenshot).
//   ASSUMED       the product gallery arrow / zoom button and the category-tile arrow: the live class names are
//                 known (.catalog-gallery-arrow, .catalog-gallery-zoom, .campaign-category__arrow) but not their
//                 icon size or whether the compiled build mirrors them in RTL. They are marked data-assumed and
//                 only the generic rules (box scale, stroke) are asserted on them.
//   Fonts         IBM Plex Arabic as the shop self-hosts it (public/fonts), inlined by the test, so label widths
//                 and the Arabic ascent are the live ones.
//
// The root font size is the live one; the brand tokens are the bundle's (the add-on sporta-brand-theme.css moves
// them to the Sporta orange, and the test loads that file, in the order the live index.html links the add-ons).

export const TOKENS = `:root{--brand:#c76a42;--brand-bright:#d28a69;--brand-deep:#99452b;--ink:#171a1e;--text-primary:#171a1e;--canvas:#fff;--canvas-muted:#f6f7f8;--surface:#fff;--surface-raised:#fff;--line-soft:#171a1e13;--line:#171a1e21;--line-strong:#7b8793;--text-muted:#596571;--primary:18.9 53.8% 61.8%;--primary-foreground:210 13% 10%;--accent:14.2 56.1% 38.4%;--accent-foreground:0 0% 100%;--accent-text:14.2 56.1% 38.4%;--type-micro:.6875rem;--type-caption:.75rem;--type-body:.9375rem;--sa-top:0px;--sa-right:0px;--sa-bottom:0px;--sa-left:0px;--shop-border-on-dark:rgba(255,255,255,.14);--shop-divider-on-dark:rgba(255,255,255,.1);--shop-border-on-light:#171a1e1f;--shop-border-subtle:#171a1e17;--shop-border:rgba(23,26,30,.13);--shop-radius-md:.75rem;--purchase-control-border:#171a1e33;--purchase-divider:#171a1e17;--html5-brand-bright:#d28a69;--shop-gutter-start:1rem;--shop-gutter-end:1rem;--shop-shell-max:80rem}
html{font-size:calc(15.5px + .1vw);font-family:"Sporta Plex Arabic Local",system-ui,sans-serif;line-height:1.5}
body{margin:0;background:var(--canvas);color:var(--ink)}`
export const THEME = `@theme inline { --color-ink: rgb(23, 26, 30); --color-brand: var(--brand); --color-brand-bright: var(--brand-bright); --color-accent: hsl(var(--accent)); }`

// Rules recorded from the live compiled stylesheet (see above).
export const LIVE_ICON_RULES = String.raw`
.purchase-quantity { border-color: var(--purchase-control-border); background: var(--canvas-muted); border-radius: 0.625rem; flex-shrink: 0; overflow: hidden; box-shadow: rgba(255, 255, 255, 0.55) 0px 1px inset; }
.purchase-quantity button { place-items: center; min-width: 2.5rem; min-height: 2.5rem; display: grid; }
.purchase-quantity button:hover { background: rgba(210, 138, 105, 0.1); }
.purchase-quantity button:focus-visible { z-index: 1; position: relative; }
.campaign-cart-drawer .cart-drawer__mark { background: color-mix(in srgb, var(--brand) 10%, transparent); width: 2.5rem; height: 2.5rem; color: hsl(var(--accent-text)); border-radius: 0.75rem; place-items: center; display: grid; }
.campaign-cart-drawer .cart-drawer__remove { border-radius: 0.65rem; flex-shrink: 0; place-items: center; width: 2.5rem; height: 2.5rem; display: grid; }
.campaign-cart-drawer .cart-drawer__remove:hover { background: rgba(244, 63, 94, 0.08); }
.catalog-product-summary :where(h1, p, .catalog-product-options, .catalog-product-reassurance) { text-align: start; }
.btn { cursor: pointer; white-space: nowrap; border-radius: 9999px; justify-content: center; align-items: center; gap: 0.5rem; height: 3rem; padding: 0px 1.5rem; font-size: 0.95rem; font-weight: 700; line-height: 1; transition: transform 0.15s, background-color 0.2s, box-shadow 0.2s, color 0.2s; display: inline-flex; }
.btn:active { transform: translateY(1px) scale(0.99); }
.btn-primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); box-shadow: 0 8px 20px -8px hsl(var(--primary) / .6); font-weight: 800; }
.btn-primary:hover { background: var(--brand-deep); box-shadow: 0 12px 26px -8px hsl(var(--primary) / .7); }
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
.storefront-root .topbar { padding-inline-start: max(var(--shop-gutter-start), calc(50vw - var(--shop-shell-half) + var(--shop-gutter-start))); padding-inline-end: max(var(--shop-gutter-end), calc(50vw - var(--shop-shell-half) + var(--shop-gutter-end))); }
.storefront-root .btn, .campaign-cart-drawer .btn { box-shadow: none; border-radius: 0.75rem; font-size: 0.875rem; }
.storefront-root .btn-primary, .campaign-cart-drawer .btn-primary, .storefront-root .btn-primary:hover, .campaign-cart-drawer .btn-primary:hover { background: var(--brand-bright); color: rgb(23, 26, 30); }
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
.storefront-root .footer-club { text-align: center; border-bottom: 1px solid var(--shop-divider-on-dark); flex-direction: column; justify-content: center; align-items: center; gap: 1.5rem; padding-block-end: 2.5rem; padding-inline: 0px; display: flex; }
.storefront-root .footer-club > div { justify-items: center; width: 100%; display: grid; }
.storefront-root .footer-club .btn { margin-inline: auto; }
.storefront-root .footer-socials a { border-color: var(--shop-border-on-dark); background: rgba(255, 255, 255, 0.024); border-radius: 0.75rem; box-shadow: rgba(255, 255, 255, 0.07) 0px 1px inset; }
@media (hover: hover) and (pointer: fine){.storefront-root .navbar-cart:hover, .storefront-root .navbar-language:hover { box-shadow: none; background: rgba(210, 138, 105, 0.12); }}
@media (hover: hover) and (pointer: fine){.storefront-root .footer-socials a:hover { color: var(--brand-bright); background: rgba(210, 138, 105, 0.11); box-shadow: rgba(0, 0, 0, 0.18) 0px 6px 16px, rgba(255, 255, 255, 0.08) 0px 1px inset; }}
.storefront-root .footer-payments { border-top: 1px solid var(--shop-divider-on-dark); justify-content: flex-start; margin-block-start: 0px; padding-block: 1.25rem; display: flex; }
.storefront-root .footer-payments > span { border-color: var(--shop-border-on-dark); }
.storefront-root :where(.btn, .tap, .navbar-link, .catalog-filter, .purchase-payment .payment-method) { text-align: center; }
.storefront-root :where(.footer-links ul, .footer-payments, .footer-socials) { margin-inline: 0px; padding-inline: 0px; }
@media (max-width: 767px){.storefront-root .footer-club { align-items: center; padding-inline-end: 0px; }}
@media (max-width: 767px){.storefront-root .footer-brand, .storefront-root .footer-links, .storefront-root .footer-payments { justify-self: stretch; }}
@media (max-width: 767px){.storefront-root .footer-payments { justify-content: center; }}
@media (max-width: 479px){.storefront-root .footer-payments { grid-template-columns: repeat(2, minmax(0px, 1fr)); align-items: stretch; gap: 0.5rem; padding-block: 1rem; display: grid; }}
@media (max-width: 479px){.storefront-root .footer-payment { text-align: center; justify-content: center; min-width: 0px; min-height: 2.75rem; padding: 0.55rem 0.6rem; line-height: 1.3; }}
@media (max-width: 479px){.storefront-root .footer-payment--cod { grid-column: 1 / -1; }}
@media (min-width: 768px){.storefront-root .footer-club { text-align: start; flex-direction: row; justify-content: space-between; align-items: center; }}
@media (min-width: 768px){.storefront-root .footer-club > div { justify-items: start; width: auto; }}
@media (min-width: 768px){.storefront-root .footer-club .btn { margin-inline: 0px; }}
@media (max-width: 1023px){.storefront-root:has(.action-bar) .assistant-launcher { bottom: calc(6rem + var(--sa-bottom,0px)); }}
@media (max-width: 639px){.storefront-root .app-header .navbar-main { gap: 0.25rem; padding-inline-start: var(--shop-gutter-start); padding-inline-end: var(--shop-gutter-end); }}
@media (max-width: 639px){.storefront-root .navbar-tools, .storefront-root .navbar-actions { gap: 0.25rem; }}
@media (max-width: 639px){.storefront-root .app-header .navbar-main .clock { width: 2.75rem; }}
@media (max-width: 639px){.storefront-root .app-header .navbar-main .clock svg { width: 2.125rem; height: 2.125rem; }}
@media (max-width: 639px){.storefront-root .navbar-logo img { height: 1.75rem; }}
@media (max-width: 639px){.storefront-root .app-header .navbar-main .navbar-language { padding-inline: 0.375rem; }}
.app-header { padding-top: var(--sa-top); }
.app-header > *, .app-footer > * { padding-inline: var(--sa-left) var(--sa-right); }
.app-footer { padding-bottom: var(--sa-bottom); }
@media (pointer: coarse){input:not([type="checkbox"]):not([type="radio"]), select, textarea, .btn, .tap { min-height: 44px; }}
@media (pointer: coarse){.tap { min-width: 44px; }}
@media (pointer: coarse){.tap-row { align-items: center; min-height: 44px; }}
@media (max-width: 1023px){.app-header { will-change: transform; transition: transform 0.3s; }}
@media (prefers-reduced-motion: reduce){.app-header { transition: none !important; }}`
// A few card / gallery rules from the live stylesheet (scripts/fixtures/product-desc.mjs carries the rest).
export const LIVE_CARD_RULES = String.raw`
.storefront-root .catalog-card-image{aspect-ratio:4/5;border:1px solid var(--shop-border-subtle);border-radius:var(--shop-radius-md);isolation:isolate;background:#fff;place-items:center;display:grid}
.catalog-card-photo{object-fit:contain;object-position:center center;max-width:100%;padding:clamp(.5rem,1vw,.875rem);display:block}
.catalog-card-save,.catalog-card-add{border:1px solid var(--shop-border-on-light,#171a1e1f);border-radius:.625rem}
.storefront-root .product-grid-card .catalog-card-save{color:rgb(89,99,112);background:rgba(255,255,255,.96)}
.catalog-card-add{background:var(--brand-bright);color:rgb(23,26,30);opacity:1;border-color:var(--shop-border-on-light,#171a1e1f);box-shadow:rgba(23,26,30,.38) 0 6px 14px -6px}
.catalog-card-add:disabled{display:none}
.catalog-gallery-stage{border:1px solid var(--shop-border);border-radius:1rem;isolation:isolate;background:#fff;place-items:center;display:grid}
.catalog-gallery-zoom{border:1px solid var(--shop-border-on-light,#171a1e1f)}
.catalog-product-reassurance{border:1px solid var(--shop-border);border-radius:1rem;background:var(--canvas-muted)}
.catalog-product-reassurance li{align-items:flex-start;line-height:1.65}
.catalog-product-reassurance svg{flex-shrink:0;margin-block-start:.125rem}
.campaign-category{position:relative;display:block;border-radius:1rem;overflow:hidden;background:#171a1e;min-height:11rem}
.campaign-category__arrow{position:absolute;bottom:1.25rem;inset-inline-end:1.25rem;display:flex;align-items:center;justify-content:center;border-radius:9999px;background:var(--brand);color:#fff}
.purchase-count{min-width:1.75rem;min-height:1.75rem;color:hsl(var(--accent-text));white-space:nowrap;background:rgba(210,138,105,.11);border-radius:.5rem;justify-content:center;align-items:center;padding:.25rem .625rem;font-size:.75rem;font-weight:700;display:inline-flex}
`

// ---- glyphs (reconstructed: the repo's own 24x24 outline set) -------------------------------------------------
export const G = {
  ai: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 17v4M17 19h4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  insta: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  tiktok: '<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/>',
  whatsapp: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M5.5 11V13M18.5 11V13"/>',
  truck: '<path d="M2 18V5H14V18M2 18H5M9 18H15M19 18H22V14L18 9H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  ret: '<path d="M8 3 4 7 8 11M4 7H14a6 6 0 0 1 0 12H7"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21Z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  upright: '<path d="M7 17 17 7M7 7h10v10"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 8h.01M11 12h1v4h1"/>',
  bagfill: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M16 10a4 4 0 0 1-8 0"/>',
}
// A live icon: the <svg> exactly as the compiled build writes it (note vector-effect sits on the <svg>, not on the paths).
export const svg = (name, w, sw = 1.75, extra = '', id = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle ${extra}" shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke" aria-hidden="true" focusable="false"${id ? ` data-ic="${id}"` : ''}>${G[name]}</svg>`
const CLOCK = `<svg width="40" height="40" viewBox="0 0 48 48" class="h-10 w-10 sm:h-11 sm:w-11" aria-hidden="true" focusable="false"><circle class="clock__face" cx="24" cy="24" r="21" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.3)" stroke-width="2"/><path data-hand="hour" d="M24 24V14" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path data-hand="minute" d="M24 24l8 4" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`

export const COPY = {
  ar: {
    dir: 'rtl', topbar: 'التوصيل خلال ٢٤ ساعة داخل الكويت · الدفع عند الاستلام', ai: 'سبورتا AI', aiLabel: 'افتح مساعد سبورتا', clock: 'توقيت الكويت 12:13',
    lang: 'تغيير اللغة', langText: 'EN', bag: 'الحقيبة', close: 'إغلاق', minus: 'إنقاص الكمية', plus: 'زيادة الكمية', remove: 'إزالة',
    club: 'راسلنا', insta: 'إنستغرام', tiktok: 'تيك توك', wa: 'واتساب', cod: 'الدفع عند الاستلام', bagTitle: 'حقيبتك',
    line: 'شورت فلاش — أحمر', note: 'طرق الدفع المتاحة تظهر عند إتمام الشراء', save: 'أضف إلى المفضلة', add: 'اختر المقاس — تيشيرت تشيتاز رَغبي',
    sizeGuide: 'دليل المقاسات', r1: 'التوصيل خلال ٢٤ ساعة · ١ د.ك', r2: 'طرق الدفع المتاحة تظهر عند إتمام الشراء', r3: 'إرجاع خلال ١٤ يومًا', oos: 'نفذت الكمية', name: 'تيشيرت تشيتاز رَغبي',
  },
  en: {
    dir: 'ltr', topbar: 'Delivery within 24 hours inside Kuwait · Cash on delivery', ai: 'Sporta AI', aiLabel: 'Open the Sporta assistant', clock: 'Kuwait time 12:13',
    lang: 'Switch language', langText: 'AR', bag: 'Bag', close: 'Close', minus: 'Decrease quantity', plus: 'Increase quantity', remove: 'Remove',
    club: 'Message us', insta: 'Instagram', tiktok: 'TikTok', wa: 'WhatsApp', cod: 'Cash on delivery', bagTitle: 'Your bag',
    line: 'Flash Shorts - Red', note: 'Available payment methods appear at checkout', save: 'Add to wishlist', add: 'Choose size - Cheetahs Rugby T-shirt',
    sizeGuide: 'Size guide', r1: 'Delivery within 24 hours - 1 KD', r2: 'Available payment methods appear at checkout', r3: '14-day returns', oos: 'Sold out', name: 'Cheetahs Rugby T-shirt',
  },
}

// ---- the pieces (kinds) --------------------------------------------------------------------------------------
const header = (c) => `<header class="app-header sticky top-0 z-30 border-b border-white/10 bg-ink/95 text-white backdrop-blur"><p class="topbar topbar--tone-brand topbar--align-center flex h-8 items-center gap-2 overflow-hidden px-4 text-[.7rem] font-bold leading-none sm:text-xs" dir="${c.dir}" role="status"><span class="topbar__dot" aria-hidden="true" data-ic="header.dot"></span><span class="min-w-0 truncate">${c.topbar}</span></p><nav class="navbar-main mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-3 py-2 sm:px-4 sm:py-3"><div class="navbar-tools flex items-center gap-2"><button aria-expanded="false" aria-label="${c.aiLabel}" class="assistant-launcher navbar-ai tap flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-bold text-white/90 hover:text-brand-bright print:hidden">${svg('ai', 19, 1.9, '', 'header.ai')}<span class="navbar-ai-label">${c.ai}</span></button><span role="img" aria-label="${c.clock}" title="${c.clock}" dir="ltr" class="clock flex shrink-0 items-center" data-ic="header.clock">${CLOCK}<span class="ms-2 hidden text-xs font-semibold tabular-nums text-white/85 sm:inline">12:13</span></span></div><a aria-label="${c.bag}" class="navbar-logo flex min-h-11 items-center" href="/"><span class="inline-block h-8 w-28 rounded bg-white/20"></span></a><div class="navbar-actions flex items-center gap-1 sm:gap-3"><button aria-label="${c.lang}" class="navbar-language tap flex items-center justify-center gap-1 rounded-xl px-3 py-1 text-xs font-semibold text-white/90 hover:text-brand-bright">${svg('globe', 14, 1.75, '', 'header.globe')} ${c.langText}</button><button class="navbar-cart tap relative flex items-center justify-center" aria-label="${c.bag}">${svg('bag', 22, 1.75, '', 'header.bag')}<span class="absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-xs font-bold text-ink">2</span></button></div></nav></header>`

const footer = (c) => `<footer class="app-footer sporta-footer mt-16 bg-ink text-slate-300"><div class="mx-auto max-w-7xl px-6 py-12 md:py-16"><div class="footer-club"><a href="https://wa.me/x" class="btn btn-primary footer-club__action">${c.club} ${svg('whatsapp', 18, 1.75, '', 'footer.club')}</a></div><div class="footer-brand flex flex-col gap-5"><div class="footer-socials flex items-center gap-3"><a href="#" aria-label="${c.insta}" class="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 transition hover:border-brand">${svg('insta', 18, 1.75, '', 'footer.insta')}</a><a href="#" aria-label="${c.tiktok}" class="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 transition hover:border-brand">${svg('tiktok', 18, 1.75, '', 'footer.tiktok')}</a><a href="#" aria-label="${c.wa}" class="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 transition hover:border-brand">${svg('whatsapp', 18, 1.75, '', 'footer.wa')}</a></div></div><div class="footer-payments mt-8 flex flex-wrap items-center gap-2"><span class="footer-payment footer-payment--cod inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-slate-300" dir="auto">${svg('card', 17, 1.75, 'text-brand', 'footer.cod')}<span data-label>${c.cod}</span></span></div></div></footer>`

const qtyBtn = (c, k, id) => `<button class="px-3 py-1 text-base font-bold leading-none text-slate-700 hover:text-brand" aria-label="${c[k]}">${svg(k, 15, 1.75, '', id)}</button>`
const drawer = (c) => `<aside role="dialog" aria-modal="true" aria-label="${c.bagTitle}" class="cart-drawer campaign-cart-drawer flex w-full max-w-md flex-col bg-white"><header class="flex items-center justify-between border-b border-black/10 px-6 py-5"><div class="flex min-w-0 items-center gap-3"><span class="cart-drawer__mark">${svg('bagfill', 20, 1.75, '', 'drawer.mark')}</span><h2 class="text-xl font-extrabold text-slate-900">${c.bagTitle}</h2><span class="purchase-count">2</span></div><button aria-label="${c.close}" class="tap flex items-center justify-center text-slate-400 hover:text-slate-700">${svg('close', 22, 1.75, '', 'drawer.close')}</button></header><ul class="flex-1 divide-y divide-black/5 px-6"><li class="cart-drawer__line flex gap-4 py-4"><img alt="${c.line}" width="72" height="72" class="h-18 w-18 shrink-0 rounded-xl object-cover" src="/product-photo-unavailable.svg" data-ic="drawer.thumb"><div class="min-w-0 flex-1"><p class="font-bold text-slate-900">${c.line}</p><div class="mt-2 flex items-center gap-3"><div class="purchase-quantity flex items-center rounded-full border border-black/15 text-slate-900">${qtyBtn(c, 'minus', 'drawer.minus')}<span class="w-7 text-center text-sm font-bold tabular-nums text-slate-900">1</span>${qtyBtn(c, 'plus', 'drawer.plus')}</div><button aria-label="${c.remove}" class="cart-drawer__remove text-slate-400 hover:text-rose-600">${svg('trash', 15, 1.75, '', 'drawer.remove')}</button></div></div></li></ul><footer class="px-6 py-5"><p class="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500" data-note>${svg('info', 13, 1.75, '', 'drawer.note')} <span data-label>${c.note}</span></p></footer></aside>`

const product = (c) => `<main id="main" class="mx-auto max-w-5xl p-4"><div class="grid grid-cols-2 gap-4"><article class="product-grid-card group flex min-w-0 flex-col"><div class="catalog-card-image relative block aspect-[4/5] overflow-hidden"><a class="absolute inset-0 block" aria-label="${c.name}" href="#"><img alt="${c.name}" width="600" height="750" class="catalog-card-photo relative z-[1] h-full w-full object-contain" src="/product-photo-unavailable.svg" data-ic="card.placeholder"></a><button type="button" aria-label="${c.save}" aria-pressed="false" class="catalog-card-save absolute end-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow-sm backdrop-blur transition hover:text-brand focus-visible:opacity-100 text-slate-600">${svg('heart', 17, 1.75, '', 'card.heart')}</button><button type="button" aria-label="${c.add}" class="catalog-card-add absolute bottom-2 end-2 z-10 flex h-11 w-11 items-center justify-center rounded-full shadow-md transition focus-visible:opacity-100 bg-white/95 text-ink backdrop-blur hover:bg-brand hover:text-ink">${svg('bag', 18, 1.75, '', 'card.add')}</button></div></article>
<div class="catalog-gallery"><div class="catalog-gallery-stage relative aspect-square" style="width:100%"><button type="button" aria-label="zoom" class="catalog-gallery-zoom absolute end-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-white" data-assumed>${svg('info', 20, 1.75, '', 'gallery.zoom')}</button><button type="button" aria-label="prev" class="catalog-gallery-arrow absolute start-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white" data-assumed>${svg('chev', 20, 1.75, '', 'gallery.arrow')}</button></div></div></div>
<div class="mt-6"><div class="mb-3 flex items-center justify-between"><button type="button" class="text-accent -my-3 inline-flex items-center gap-1.5 py-3 text-xs font-semibold underline underline-offset-2" data-sizeguide>${svg('ruler', 16, 1.75, '', 'product.sizeguide')}<span data-label>${c.sizeGuide}</span></button></div><div class="catalog-product-quantity inline-flex items-center rounded-xl border"><button class="tap flex items-center justify-center px-4 text-slate-700 hover:text-brand" aria-label="${c.minus}">${svg('minus', 16, 1.75, '', 'product.minus')}</button><span class="w-10 text-center font-semibold">1</span><button class="tap flex items-center justify-center px-4 text-slate-700 hover:text-brand" aria-label="${c.plus}">${svg('plus', 16, 1.75, '', 'product.plus')}</button></div>
<ul class="catalog-product-reassurance mt-8 space-y-2 rounded-2xl bg-white p-5 text-sm text-slate-600"><li class="flex items-center gap-3">${svg('truck', 18, 1.75, 'text-brand', 'product.r1')}<span data-label>${c.r1}</span></li><li class="flex items-center gap-3">${svg('lock', 18, 1.75, 'text-brand', 'product.r2')}<span data-label>${c.r2}</span></li><li class="flex items-center gap-3">${svg('ret', 18, 1.75, 'text-brand', 'product.r3')}<span data-label>${c.r3}</span></li></ul>
<button class="btn btn-ghost mt-4" disabled>${svg('bag', 18, 1.75, '', 'product.oos')}${c.oos}</button></div></main>`

const tile = (c) => `<a href="#" class="campaign-category"><span class="campaign-category__arrow" data-assumed>${svg('upright', 18, 1.75, '', 'tile.arrow')}</span></a>`

export const KINDS = ['header', 'footer', 'drawer', 'product', 'home']
export const body = (kind, lang) => {
  const c = COPY[lang]
  const inner = { header: header(c), footer: footer(c), drawer: drawer(c), product: product(c), home: home(lang) }[kind]
  return `<div class="storefront-root">${inner}</div>`
}
// every class the markup uses, for the Tailwind compile
export const classesOf = () => [...new Set(KINDS.flatMap((k) => ['ar', 'en'].map((l) => body(k, l))).join(' ').matchAll(/class="([^"]*)"/g).map((m) => m[1].split(/\s+/)).toArray().flat().filter(Boolean))]


// Home: the features band (exact live markup and paths, scripts/fixtures/home-features.mjs) and the category tile arrow (ASSUMED).
import { strip, LIVE as HOME_LIVE } from './home-features.mjs'
export const HOME_CSS = HOME_LIVE
const home = (lang) => { let n = 0; return strip(lang).replace(/<span class="home-feature-icon">(<svg [^>]*?)>/g, (m, a) => m.replace(a, a + ` data-ic="home.feature${n++}"`)) + tile(COPY[lang]) }
