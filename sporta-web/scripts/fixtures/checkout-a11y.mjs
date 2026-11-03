// The live checkout pieces this lane touches, as a fixture: the exact markup dumped from www.sporta.com.kw
// (Arabic, 2026-11-03, read-only probe with a throwaway bag and a saved-address localStorage seed; nothing was
// submitted) and every rule of the live /assets/index-CdcKvZhs.css that matches those elements. Used by
// checkout-a11y-test.mjs to prove public/sporta-checkout-a11y.css against the real markup.
//
//   state 'quick'  - the returning customer's one-screen checkout (form.purchase-quick): delivery card, bag card,
//                    payment fieldset, submit, assurance line
//   state 'guest'  - the first step of the guest flow: form.purchase-checkout-layout with the sticky summary aside,
//                    the "remember" row, the mobile pay bar
//   state 'drawer' - the bag drawer opened over the checkout
//
// What is NOT live: the fonts (no Arabic font here, so geometry is asserted relatively, never as text widths), the
// header (a plain 145px sticky bar - its measured live height), the left column of the guest form (blank panels of
// the live heights), and the English copy, which is the repo's wording from src/i18n/translations.js with the same
// markup. The brand tokens at the top of LIVE are what sporta-brand-theme.css sets on the live page.
const RAW = String.raw

export const LIVE = RAW`
*,::before,::after{box-sizing:border-box;border:0 solid;margin:0;padding:0}
button,input{font:inherit;color:inherit;background:transparent}
a{color:inherit;text-decoration:inherit}
ul{list-style:none}
body{font-family:'DejaVu Sans',sans-serif}
.purchase-flow, .campaign-cart-drawer, .purchase-result { --purchase-border: #171a1e24; --purchase-divider: #171a1e17; --purchase-control-border: #171a1e33; --purchase-focus: var(--brand-deep); --purchase-focus-ring: color-mix(in srgb, var(--brand) 18%, transparent); }
.purchase-flow { width: 100%; max-width: 72rem; color: var(--ink); margin-inline: auto; padding-inline-start: var(--shop-gutter-start,1rem); padding-inline-end: var(--shop-gutter-end,1rem); padding-block: clamp(1.25rem, 3vw, 2.5rem) !important; }
.purchase-flow > * { min-width: 0px; }
.purchase-panel, .purchase-flow .cart-line { background: var(--surface); border: 1px solid var(--purchase-border); border-radius: 1rem; min-width: 0px; box-shadow: rgba(23, 26, 30, 0.24) 0px 4px 24px -18px; }
.purchase-panel { padding: clamp(1rem, 1.7vw, 1.35rem); }
.purchase-panel > legend, .purchase-panel h2, .purchase-payment > legend { font-family: var(--sporta-font-display-en,"Sporta Alexandria Local"), "alexandria", system-ui, sans-serif; font-size: 0.9375rem; font-weight: 800; line-height: 1.6; }
[dir="rtl"] .purchase-panel > legend, [dir="rtl"] .purchase-panel h2, [dir="rtl"] .purchase-payment > legend { font-family: var(--sporta-font-display-ar,"Sporta Alexandria Local"), system-ui, sans-serif; }
.purchase-total { border-block-start-color: var(--purchase-divider); padding-block-start: 1rem; }
.purchase-total .text-accent { font-size: 1.3rem; font-weight: 800; }
.purchase-flow .cart-line__image, .campaign-cart-drawer .cart-drawer__line > img, .purchase-quick__bag img { background: var(--canvas-muted); object-fit: contain; border: 1px solid var(--purchase-divider); padding: 0.25rem; }
.purchase-flow :where(input:not([type="checkbox"]):not([type="radio"]), select, textarea) { box-sizing: border-box; text-align: start; vertical-align: middle; width: 100%; max-width: 100%; line-height: 1.45; }
.purchase-flow :where(input, select, textarea)::placeholder { text-align: start; color: var(--text-muted); opacity: 1; }
.purchase-flow :where(input[dir="ltr"], select[dir="ltr"]), .purchase-flow :where(input, textarea):focus { text-align: start; }
.purchase-checkout-summary > ul > li, .purchase-quick__bag > ul > li { border-color: var(--purchase-divider); }
.purchase-payment { min-width: 0px; }
.purchase-payment > legend { color: var(--text-primary); margin-block-end: 0.75rem; font-size: 0.95rem; font-weight: 800; line-height: 1.45; }
.purchase-payment > div { gap: 0.65rem; display: grid; }
.purchase-payment .payment-method { border-color: var(--purchase-control-border); background: var(--surface); text-align: start; border-radius: 0.875rem; grid-template-columns: 1.125rem minmax(0px, 1fr); align-items: flex-start; gap: 0.8rem; min-height: 4.9rem; padding: 0.9rem 1rem; transition: border-color 0.16s, background-color 0.16s, box-shadow 0.16s, transform 0.16s; display: grid; position: relative; }
.purchase-payment .payment-method:hover { border-color: color-mix(in srgb, var(--brand) 52%, var(--purchase-control-border)); background: color-mix(in srgb, var(--brand-bright) 3%, var(--surface)); }
.purchase-payment .payment-method--selected { border-color: var(--brand); background: rgba(210, 138, 105, 0.067); box-shadow: rgba(199, 106, 66, 0.9) 0px 5px 16px -12px; }
.purchase-payment .payment-method--selected:hover { background: rgba(210, 138, 105, 0.09); }
.purchase-payment .payment-method input { width: 1.125rem; height: 1.125rem; accent-color: var(--brand-bright); margin-block-start: 0.2rem; }
.purchase-payment .payment-method > span { width: 100%; min-width: 0px; }
.purchase-payment .payment-method > span > span:first-child { align-items: center; min-width: 0px; }
.purchase-payment .payment-method > span > span:first-child > span:first-child { overflow-wrap: anywhere; min-width: 0px; }
.purchase-payment .payment-method__badge { border: 1px solid var(--purchase-divider); background: var(--surface); min-width: 3.7rem; min-height: 1.625rem; color: var(--text-muted); font-size: var(--type-micro); border-radius: 0.375rem; flex-shrink: 0; justify-content: center; align-items: center; padding-inline: 0.55rem; font-weight: 800; line-height: 1.5; display: inline-flex; }
.purchase-payment .payment-method--selected .payment-method__badge { border-color: color-mix(in srgb, var(--brand) 58%, var(--purchase-divider)); color: hsl(var(--accent-text)); background: rgba(210, 138, 105, 0.09); }
.purchase-payment .payment-method input:focus-visible { outline: none; }
.purchase-quick { gap: 1.125rem; width: 100%; display: grid; }
.purchase-quick > :where(section, p, button), .purchase-quick__delivery > :where(div, p), .purchase-quick__bag > :where(h2, ul, .purchase-total), .purchase-quick__payment > :where(legend, div) { min-width: 0px; }
.purchase-quick__delivery > div:first-child, .purchase-quick__bag > h2 { align-items: center; }
.purchase-quick__bag li > :where(div, span) { min-width: 0px; }
.purchase-quick__bag li { min-height: 4.5rem; }
.purchase-quick__bag li img { border: 1px solid var(--purchase-divider); background: var(--canvas-muted); object-fit: contain; padding: 0.15rem; }
.purchase-quick__assurance { line-height: 1.5; }
.purchase-quick__submit { min-height: 3.25rem; }
.purchase-checkout-summary :where(h2, li, .purchase-total, .purchase-total > *) { min-width: 0px; }
.purchase-checkout-summary :where(li, .purchase-total), .purchase-quick__bag :where(li, .purchase-total) { align-items: baseline; }
.purchase-checkout-summary li > :last-child:not(:first-child), .purchase-checkout-summary .purchase-total > :last-child, .purchase-quick__bag .purchase-total > :last-child { text-align: end; white-space: nowrap; flex-shrink: 0; }
@media (min-width: 1024px){.purchase-quick { grid-template-columns: minmax(0px, 1fr) minmax(20rem, 0.9fr); align-items: start; gap: 1.5rem; }}
@media (min-width: 1024px){.purchase-quick__delivery, .purchase-quick__payment { grid-column: 1; }}
@media (min-width: 1024px){.purchase-quick__bag { grid-area: span 2 / 2; }}
@media (min-width: 1024px){.purchase-quick__submit, .purchase-quick__assurance { grid-column: 1 / -1; justify-self: end; width: 100%; max-width: 23rem; }}
@media (max-width: 767px){.purchase-panel { padding: 1rem; }}
@media (max-width: 767px){.purchase-payment .payment-method { min-height: 4.65rem; padding: 0.8rem 0.85rem; }}
@media (max-width: 767px){.purchase-quick__delivery, .purchase-quick__bag, .purchase-quick__payment { padding: 1rem; }}
@media (max-width: 767px){.purchase-quick__bag li { align-items: flex-start; }}
@media (max-width: 767px){.purchase-quick__bag li > img { margin-block-start: 0.125rem; }}
@media (max-width: 479px){.purchase-payment > div { gap: 0.625rem; }}
@media (max-width: 479px){.purchase-payment .payment-method { gap: 0.625rem; min-height: 4.5rem; padding: 0.75rem; }}
@media (max-width: 479px){.purchase-payment .payment-method > span > span:first-child { gap: 0.5rem; }}
@media (max-width: 479px){.purchase-payment .payment-method__badge { min-width: 3.25rem; padding-inline: 0.4rem; }}
:root, :host { --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; --color-red-600: #e40014; --color-orange-50: #fff7ed; --color-orange-100: #ffedd5; --color-orange-200: #ffd7a8; --color-orange-300: #ffb96d; --color-orange-400: #ff8b1a; --color-orange-500: #fe6e00; --color-orange-600: #f05100; --color-orange-700: #c53c00; --color-orange-800: #9f2d00; --color-orange-900: #7e2a0c; --color-orange-950: #441306; --color-amber-50: #fffbeb; --color-amber-100: #fef3c6; --color-amber-200: #fee685; --color-amber-300: #ffd236; --color-amber-500: #f99c00; --color-amber-600: #dd7400; --color-amber-700: #b75000; --color-amber-800: #953d00; --color-amber-900: #7b3306; --color-amber-950: #461901; --color-emerald-50: #ecfdf5; --color-emerald-100: #d0fae5; --color-emerald-200: #a4f4cf; --color-emerald-300: #5ee9b5; --color-emerald-400: #00d294; --color-emerald-500: #00bb7f; --color-emerald-600: #009767; --color-emerald-700: #007956; --color-emerald-800: #005f46; --color-emerald-900: #004e3b; --color-emerald-950: #002c22; --color-sky-50: #f0f9ff; --color-sky-100: #dff2fe; --color-sky-700: #0069a4; --color-sky-800: #005986; --color-blue-100: #dbeafe; --color-blue-700: #1447e6; --color-indigo-50: #eef2ff; --color-indigo-100: #e0e7ff; --color-indigo-200: #c7d2ff; --color-indigo-300: #a4b3ff; --color-indigo-400: #7d87ff; --color-indigo-500: #625fff; --color-indigo-600: #4f39f6; --color-indigo-700: #432dd7; --color-indigo-800: #372aac; --color-indigo-900: #312c85; --color-violet-100: #ede9fe; --color-violet-700: #7008e7; --color-rose-50: #fff1f2; --color-rose-100: #ffe4e6; --color-rose-200: #ffccd3; --color-rose-300: #ffa2ae; --color-rose-400: #ff667f; --color-rose-500: #ff2357; --color-rose-600: #e70044; --color-rose-700: #c20039; --color-rose-800: #a30037; --color-rose-900: #8b0836; --color-rose-950: #4d0218; --color-slate-50: #f8fafc; --color-slate-100: #f1f5f9; --color-slate-200: #e2e8f0; --color-slate-300: #cad5e2; --color-slate-400: #90a1b9; --color-slate-500: #62748e; --color-slate-600: #45556c; --color-slate-700: #314158; --color-slate-800: #1d293d; --color-slate-900: #0f172b; --color-slate-950: #020618; --color-black: #000; --color-white: #fff; --spacing: .25rem; --container-xs: 20rem; --container-sm: 24rem; --container-md: 28rem; --container-lg: 32rem; --container-xl: 36rem; --container-2xl: 42rem; --container-3xl: 48rem; --container-4xl: 56rem; --container-5xl: 64rem; --container-6xl: 72rem; --container-7xl: 80rem; --text-xs: .75rem; --text-xs--line-height: calc(1 / .75); --text-sm: .875rem; --text-sm--line-height: calc(1.25 / .875); --text-base: 1rem; --text-base--line-height: calc(1.5 / 1); --text-lg: 1.125rem; --text-lg--line-height: calc(1.75 / 1.125); --text-xl: 1.25rem; --text-xl--line-height: calc(1.75 / 1.25); --text-2xl: 1.5rem; --text-2xl--line-height: calc(2 / 1.5); --text-3xl: 1.875rem; --text-3xl--line-height: calc(2.25 / 1.875); --text-4xl: 2.25rem; --text-4xl--line-height: calc(2.5 / 2.25); --text-5xl: 3rem; --text-5xl--line-height: 1; --text-7xl: 4.5rem; --text-7xl--line-height: 1; --font-weight-normal: 400; --font-weight-medium: 500; --font-weight-semibold: 600; --font-weight-bold: 700; --font-weight-extrabold: 800; --font-weight-black: 900; --tracking-tight: -.025em; --tracking-wide: .025em; --tracking-wider: .05em; --tracking-widest: .1em; --leading-tight: 1.25; --leading-snug: 1.375; --leading-relaxed: 1.625; --radius-md: .375rem; --radius-lg: .5rem; --radius-xl: .75rem; --radius-2xl: 1rem; --radius-3xl: 1.5rem; --ease-in: cubic-bezier(.4, 0, 1, 1); --ease-out: cubic-bezier(0, 0, .2, 1); --ease-in-out: cubic-bezier(.4, 0, .2, 1); --animate-spin: spin 1s linear infinite; --animate-pulse: pulse 2s cubic-bezier(.4, 0, .6, 1) infinite; --blur-sm: 8px; --default-transition-duration: .15s; --default-transition-timing-function: cubic-bezier(.4, 0, .2, 1); --default-mono-font-family: var(--font-mono); }
*, ::after, ::before { box-sizing: border-box; border: 0px solid; margin: 0px; padding: 0px; }
html, :host { text-size-adjust: 100%; tab-size: 4; font-feature-settings: normal; font-variation-settings: normal; -webkit-tap-highlight-color: transparent; font-family: "Sporta Plex Arabic Local", "Plex Arabic Fallback", ibm-plex-arabic, system-ui, sans-serif; line-height: 1.5; }
h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; }
a { color: inherit; text-decoration: inherit; }
ol, ul, menu { list-style: none; }
img, svg, video, canvas, audio, iframe, embed, object { vertical-align: middle; display: block; }
img, video { max-width: 100%; height: auto; }
button, input, select, optgroup, textarea { font: inherit; letter-spacing: inherit; color: inherit; opacity: 1; background-color: rgba(0, 0, 0, 0); border-radius: 0px; }
button, input:where([type="button"], [type="reset"], [type="submit"]) { appearance: button; }
.btn { cursor: pointer; white-space: nowrap; border-radius: 9999px; justify-content: center; align-items: center; gap: 0.5rem; height: 3rem; padding: 0px 1.5rem; font-size: 0.95rem; font-weight: 700; line-height: 1; transition: transform 0.15s, background-color 0.2s, box-shadow 0.2s, color 0.2s; display: inline-flex; }
.btn:active { transform: translateY(1px) scale(0.99); }
.btn-primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); box-shadow: 0 8px 20px -8px hsl(var(--primary) / .6); font-weight: 800; }
.btn-primary:hover { background: var(--brand-deep); box-shadow: 0 12px 26px -8px hsl(var(--primary) / .7); }
.mx-auto { margin-inline: auto; }
.-my-2 { margin-block: calc(var(--spacing) * -2); }
.mt-0\.5 { margin-top: calc(var(--spacing) * .5); }
.mt-1 { margin-top: var(--spacing); }
.mt-2 { margin-top: calc(var(--spacing) * 2); }
.mt-3 { margin-top: calc(var(--spacing) * 3); }
.mt-4 { margin-top: calc(var(--spacing) * 4); }
.block { display: block; }
.flex { display: flex; }
.inline-block { display: inline-block; }
.h-5 { height: calc(var(--spacing) * 5); }
.h-12 { height: calc(var(--spacing) * 12); }
.min-h-screen { min-height: 100vh; }
.w-5 { width: calc(var(--spacing) * 5); }
.w-12 { width: calc(var(--spacing) * 12); }
.w-full { width: 100%; }
.max-w-5xl { max-width: var(--container-5xl); }
.max-w-6xl { max-width: var(--container-6xl); }
.min-w-0 { min-width: 0px; }
.flex-1 { flex: 1 1 0%; }
.flex-none { flex: 0 0 auto; }
.shrink-0 { flex-shrink: 0; }
.cursor-pointer { cursor: pointer; }
.flex-col { flex-direction: column; }
.items-baseline { align-items: baseline; }
.items-center { align-items: center; }
.items-start { align-items: flex-start; }
.justify-between { justify-content: space-between; }
.justify-center { justify-content: center; }
.gap-1\.5 { gap: calc(var(--spacing) * 1.5); }
.gap-2 { gap: calc(var(--spacing) * 2); }
.gap-3 { gap: calc(var(--spacing) * 3); }
.gap-4 { gap: calc(var(--spacing) * 4); }
:where(.space-y-1\.5 > :not(:last-child)) { --tw-space-y-reverse: 0; margin-block-start: calc(calc(var(--spacing) * 1.5) * var(--tw-space-y-reverse)); margin-block-end: calc(calc(var(--spacing) * 1.5) * calc(1 - var(--tw-space-y-reverse))); }
:where(.divide-y > :not(:last-child)) { --tw-divide-y-reverse: 0; border-bottom-style: var(--tw-border-style); border-top-style: var(--tw-border-style); border-top-width: calc(1px * var(--tw-divide-y-reverse)); border-bottom-width: calc(1px * calc(1 - var(--tw-divide-y-reverse))); }
:where(.divide-slate-100 > :not(:last-child)) { border-color: var(--color-slate-100); }
.rounded-2xl { border-radius: var(--radius-2xl); }
.rounded-lg { border-radius: var(--radius-lg); }
.rounded-xl { border-radius: var(--radius-xl); }
.border { border-style: var(--tw-border-style); border-width: 1px; }
.border-t { border-top-style: var(--tw-border-style); border-top-width: 1px; }
.border-brand, .border-brand\/40 { border-color: var(--brand); }
.border-slate-100 { border-color: var(--color-slate-100); }
.border-slate-200 { border-color: var(--color-slate-200); }
.border-slate-300 { border-color: var(--color-slate-300); }
.bg-brand\/5 { background-color: var(--brand); }
.bg-white { background-color: var(--color-white); }
.object-cover { object-fit: cover; }
.p-3 { padding: calc(var(--spacing) * 3); }
.p-5 { padding: calc(var(--spacing) * 5); }
.px-1 { padding-inline: var(--spacing); }
.px-3 { padding-inline: calc(var(--spacing) * 3); }
.px-4 { padding-inline: calc(var(--spacing) * 4); }
.py-2 { padding-block: calc(var(--spacing) * 2); }
.py-2\.5 { padding-block: calc(var(--spacing) * 2.5); }
.py-3 { padding-block: calc(var(--spacing) * 3); }
.py-8 { padding-block: calc(var(--spacing) * 8); }
.pt-3 { padding-top: calc(var(--spacing) * 3); }
.pt-4 { padding-top: calc(var(--spacing) * 4); }
.text-center { text-align: center; }
.align-middle { vertical-align: middle; }
.font-mono { font-family: var(--font-mono); }
.text-lg { font-size: var(--text-lg); line-height: var(--tw-leading,var(--text-lg--line-height)); }
.text-sm { font-size: var(--text-sm); line-height: var(--tw-leading,var(--text-sm--line-height)); }
.text-xs { font-size: var(--text-xs); line-height: var(--tw-leading,var(--text-xs--line-height)); }
.leading-snug { --tw-leading: var(--leading-snug); line-height: var(--leading-snug); }
.font-bold { --tw-font-weight: var(--font-weight-bold); font-weight: var(--font-weight-bold); }
.font-medium { --tw-font-weight: var(--font-weight-medium); font-weight: var(--font-weight-medium); }
.font-semibold { --tw-font-weight: var(--font-weight-semibold); font-weight: var(--font-weight-semibold); }
.break-words, .wrap-break-word { overflow-wrap: break-word; }
.text-brand { color: var(--brand); }
.text-slate-600 { color: var(--color-slate-600); }
.text-slate-700 { color: var(--color-slate-700); }
.text-slate-800 { color: var(--color-slate-800); }
.text-slate-900 { color: var(--color-slate-900); }
.uppercase { text-transform: uppercase; }
.tabular-nums { --tw-numeric-spacing: tabular-nums; font-variant-numeric: var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,); }
.underline { text-decoration-line: underline; }
.underline-offset-2 { text-underline-offset: 2px; }
.accent-brand { accent-color: var(--brand); }
.outline-none { --tw-outline-style: none; outline-style: none; }
.disabled\:opacity-40:disabled { opacity: 0.4; }
@media (min-width: 48rem){.md\:py-10 { padding-block: calc(var(--spacing) * 10); }}
:root { --brand: #c76a42; --brand-bright: #d28a69; --brand-deep: #99452b; --ink: #171a1e; --text-primary: #171a1e; --canvas: #fff; --canvas-muted: #f6f7f8; --surface: #fff; --surface-raised: #fff; --line-soft: #171a1e13; --line: #171a1e21; --line-strong: #7b8793; --text-muted: #596571; --primary: 18.9 53.8% 61.8%; --primary-foreground: 210 13% 10%; --accent: 14.2 56.1% 38.4%; --accent-foreground: 0 0% 100%; --accent-text-light: 14.2 56.1% 38.4%; --accent-text-dark: 18.9 53.8% 61.8%; --accent-text: var(--accent-text-light); --on-brand: 210 13% 10%; --type-micro: .6875rem; --type-caption: .75rem; --type-body: .9375rem; --type-lead: 1rem; }
[dir="rtl"] { --type-micro: .75rem; }
.text-accent { color: hsl(var(--accent-text)); }
:root { --html5-brand: var(--brand); --html5-brand-bright: var(--brand-bright); --html5-brand-dark: var(--brand-deep); --html5-ink: var(--ink); --html5-canvas: var(--canvas); --html5-surface: var(--surface); --html5-surface-muted: var(--canvas-muted); }
body { background-color: var(--html5-canvas); color: var(--html5-ink); -webkit-font-smoothing: antialiased; text-rendering: optimizelegibility; }
.storefront-root main#main > section.mx-auto:not(.invoice) { box-sizing: border-box; padding-inline-start: var(--shop-gutter-start,max(clamp(1rem, 3vw, 2.5rem), var(--sa-left,0px))); padding-inline-end: var(--shop-gutter-end,max(clamp(1rem, 3vw, 2.5rem), var(--sa-right,0px))); }
.btn, .tap, button, a { -webkit-tap-highlight-color: transparent; }
.btn:focus-visible, .tap:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--html5-brand-bright); outline-offset: 3px; }
.storefront-root { --shop-radius: .875rem; --shop-radius-lg: 1rem; --shop-radius-md: .75rem; --shop-border: var(--line); --shop-border-subtle: var(--line); }
.storefront-root { --shop-control-border: var(--line-strong); --shop-border-on-light: #171a1e1f; --shop-border-on-dark: #ffffff2e; --shop-divider-on-dark: #ffffff1f; --shop-shell-max: 80rem; --shop-shell-half: 40rem; --shop-gutter-start: max(clamp(1rem, 3vw, 2.5rem), var(--sa-left,0px)); --shop-gutter-end: max(clamp(1rem, 3vw, 2.5rem), var(--sa-right,0px)); --shop-section-space: clamp(1.125rem, 2.25vw, 2rem); --shop-grid-column-gap: clamp(.625rem, 1.5vw, 1.25rem); --shop-grid-row-gap: clamp(1.25rem, 2.4vw, 2rem); }
[dir="rtl"] .storefront-root { --shop-gutter-start: max(clamp(1rem, 3vw, 2.5rem), var(--sa-right,0px)); --shop-gutter-end: max(clamp(1rem, 3vw, 2.5rem), var(--sa-left,0px)); }
.storefront-root .btn, .campaign-cart-drawer .btn { box-shadow: none; border-radius: 0.75rem; font-size: 0.875rem; }
.storefront-root .btn-primary, .campaign-cart-drawer .btn-primary, .storefront-root .btn-primary:hover, .campaign-cart-drawer .btn-primary:hover { background: var(--brand-bright); color: rgb(23, 26, 30); }
:root:not([data-theme="dark"]) .storefront-root .text-brand, :root:not([data-theme="dark"]) .storefront-root .hover\:text-brand:hover { color: var(--brand-deep); }
.storefront-root :is(input[type="text"], input[type="email"], input[type="tel"], input[type="password"], input[type="number"], input[type="search"], input:not([type]), select, textarea) { border: 1px solid var(--shop-control-border); border-radius: var(--shop-radius-md); min-width: 0px; min-height: 3rem; color: inherit; background-color: var(--surface); font-style: inherit; font-variant: inherit; font-weight: inherit; font-stretch: inherit; font-family: inherit; font-optical-sizing: inherit; font-size-adjust: inherit; font-kerning: inherit; font-feature-settings: inherit; font-variation-settings: inherit; text-align: start; font-size: 1rem; line-height: 1.45; transition: border-color 0.18s, box-shadow 0.18s; }
.storefront-root :is(input[type="text"], input[type="email"], input[type="tel"], input[type="password"], input[type="number"], input[type="search"], input:not([type]), select) { padding-block: 0.7rem; padding-inline: 0.9rem; }
.storefront-root :is(input, select, textarea):focus-visible { border-color: var(--brand); box-shadow: rgba(210, 138, 105, 0.12) 0px 0px 0px 3px; }
.storefront-root .sporta-icon { vertical-align: -0.125em; color: currentcolor; flex: 0 0 auto; transition: color 0.18s, transform 0.18s, opacity 0.18s; display: inline-block; }
html { scroll-behavior: smooth; text-size-adjust: 100%; font-size: clamp(16px, 15.5px + 0.104vw, 17px); }
body { color: var(--ink); background-color: var(--canvas); -webkit-font-smoothing: antialiased; text-rendering: optimizelegibility; font-family: var(--sporta-font-body-en,"Sporta Plex Arabic Local"), "Plex Arabic Fallback", "ibm-plex-arabic", system-ui, sans-serif; font-optical-sizing: auto; line-height: 1.6; }
[dir="rtl"] body { font-family: var(--sporta-font-body-ar,"Sporta Plex Arabic Local"), "Plex Arabic Fallback", "ibm-plex-arabic", system-ui, sans-serif; }
:root:not([data-theme="dark"]) body { background-color: var(--canvas); }
h1, h2, h3, .font-display { font-family: var(--sporta-font-display-en,"Sporta Alexandria Local"), "Alexandria Fallback", "alexandria", "Sporta Plex Arabic Local", "Plex Arabic Fallback", "ibm-plex-arabic", system-ui, sans-serif; letter-spacing: -0.018em; font-feature-settings: "kern", "liga"; text-wrap: balance; line-height: 1.14; }
p, li, dd, figcaption { text-wrap: pretty; }
[dir="rtl"] h1, [dir="rtl"] h2, [dir="rtl"] h3, [dir="rtl"] .font-display { font-family: var(--sporta-font-display-ar,"Sporta Alexandria Local"), "Alexandria Fallback", "Sporta Plex Arabic Local", "Plex Arabic Fallback", "alexandria", "ibm-plex-arabic", system-ui, sans-serif; letter-spacing: 0px; line-height: 1.3; }
[dir="rtl"] body { line-height: 1.75; }
[dir="rtl"] .text-xs { font-size: 0.8125rem; }
[dir="rtl"] .tracking-wide, [dir="rtl"] .tracking-widest, [dir="rtl"] .uppercase { letter-spacing: 0px !important; }
.tabular-nums, .price { font-variant-numeric: tabular-nums; }
:root { --sa-top: env(safe-area-inset-top,0px); --sa-right: env(safe-area-inset-right,0px); --sa-bottom: env(safe-area-inset-bottom,0px); --sa-left: env(safe-area-inset-left,0px); }
@media (pointer: coarse){input:not([type="checkbox"]):not([type="radio"]), select, textarea { font-size: 16px !important; }}
@media (pointer: coarse){input:not([type="checkbox"]):not([type="radio"]), select, textarea, .btn, .tap { min-height: 44px; }}
@media (pointer: coarse){.tap-row { align-items: center; min-height: 44px; }}
:root { --sporta-accent-soft: #fff6f0; --sporta-accent-soft-strong: #f9e8de; --sporta-accent-border: #bd7c5b; --sporta-accent: var(--brand,#c76a42); --sporta-accent-deep: var(--brand-deep,#99452b); --sporta-accent-hover: #8f391b; }
.purchase-count { min-width: 1.75rem; min-height: 1.75rem; color: hsl(var(--accent-text)); white-space: nowrap; background: rgba(210, 138, 105, 0.11); border-radius: 0.5rem; justify-content: center; align-items: center; padding: 0.25rem 0.625rem; font-size: 0.75rem; font-weight: 700; display: inline-flex; }
.purchase-quantity { border-color: var(--purchase-control-border); background: var(--canvas-muted); border-radius: 0.625rem; flex-shrink: 0; overflow: hidden; box-shadow: rgba(255, 255, 255, 0.55) 0px 1px inset; }
.purchase-quantity button { place-items: center; min-width: 2.5rem; min-height: 2.5rem; display: grid; }
.purchase-quantity button:hover { background: rgba(210, 138, 105, 0.1); }
.purchase-quantity button:focus-visible { z-index: 1; position: relative; }
.purchase-checkout-summary { border-block-start-width: 2px; width: 100%; border-block-start-color: var(--brand) !important; }
.purchase-checkout-layout { align-items: start; width: 100%; }
.purchase-checkout-layout > div:first-child { align-content: start; gap: 1.25rem; display: grid; }
.purchase-checkout-layout fieldset.purchase-panel { border-radius: 1.25rem; padding: clamp(1rem, 1.6vw, 1.4rem); padding-block-start: clamp(1rem, 1.8vw, 1.35rem); transition: border-color 0.16s, box-shadow 0.16s; position: relative; }
.purchase-checkout-layout :where(input:not([type="checkbox"]):not([type="radio"]):not([aria-invalid="true"]), select:not([aria-invalid="true"]), textarea:not([aria-invalid="true"])) { border-color: var(--purchase-control-border); min-height: 2.875rem; }
.purchase-checkout-layout :where(input:not([type="checkbox"]):not([type="radio"]):not(.bg-transparent), select, textarea):focus-visible { border-color: var(--purchase-focus); outline-offset: 2px; box-shadow: 0 0 0 3px var(--purchase-focus-ring); outline: rgba(0, 0, 0, 0) solid 2px; }
.purchase-checkout-layout :where(input, select, textarea)[aria-invalid="true"] { border-color: rgb(225, 29, 72); }
.purchase-checkout-layout :where(input, select, textarea)[aria-invalid="true"]:focus-visible { border-color: rgb(190, 18, 60); box-shadow: rgba(225, 29, 72, 0.16) 0px 0px 0px 3px; }
.purchase-checkout-summary > h2 { border-block-end: 1px solid var(--purchase-divider); padding-block-end: 0.875rem; }
.purchase-checkout-summary > ul { margin-block-start: 0px; }
.purchase-checkout-summary li { padding-block: 0.875rem; }
.purchase-checkout-summary input + button { border-color: var(--purchase-control-border); }
.purchase-checkout-summary .purchase-total { align-items: baseline; padding-block: 1rem 0.25rem; }
.purchase-checkout-summary .purchase-total .text-accent { letter-spacing: -0.025em; font-size: clamp(1.35rem, 2vw, 1.6rem); }
.purchase-paybar { border-block-start-color: var(--purchase-divider); box-shadow: rgba(23, 26, 30, 0.35) 0px -6px 32px -20px; padding-block-start: 0.5rem !important; }
.purchase-paybar > button { max-width: 22rem; }
.purchase-checkout-summary li > span:first-child { text-align: start; }
.campaign-cart-drawer { background: var(--surface); color: var(--ink); }
.campaign-cart-drawer > header { min-height: 4.75rem; }
.campaign-cart-drawer > header h2 { text-overflow: ellipsis; white-space: nowrap; min-width: 0px; overflow: hidden; }
.campaign-cart-drawer > header, .campaign-cart-drawer > footer, .campaign-cart-drawer > ul > li { border-color: var(--purchase-divider); }
.campaign-cart-drawer > footer { background: var(--canvas-muted); }
.campaign-cart-drawer .cart-drawer__mark { background: color-mix(in srgb, var(--brand) 10%, transparent); width: 2.5rem; height: 2.5rem; color: hsl(var(--accent-text)); border-radius: 0.75rem; place-items: center; display: grid; }
.campaign-cart-drawer .cart-drawer__line { grid-template-columns: 4.5rem minmax(0px, 1fr); gap: 0.5rem 0.9rem; display: grid; }
.campaign-cart-drawer .cart-drawer__line > img { aspect-ratio: 1 / 1; }
.campaign-cart-drawer .cart-drawer__line-total { grid-column: 2; justify-self: end; font-size: 0.9375rem; }
.campaign-cart-drawer .cart-drawer__remove { border-radius: 0.65rem; flex-shrink: 0; place-items: center; width: 2.5rem; height: 2.5rem; display: grid; }
.campaign-cart-drawer .cart-drawer__remove:hover { background: rgba(244, 63, 94, 0.08); }
.campaign-cart-drawer .cart-drawer__line p { overflow-wrap: anywhere; }
.campaign-cart-drawer > ul { scrollbar-gutter: stable; }
@media (min-width: 1024px){.purchase-checkout-layout { grid-template-columns: minmax(0px, 1fr) minmax(20rem, 23rem); gap: clamp(1.75rem, 3vw, 2.5rem); }}
@media (max-width: 767px){.purchase-checkout-layout, .purchase-checkout-layout > div:first-child { gap: 1rem; }}
@media (max-width: 767px){.purchase-checkout-summary { order: 2; }}
@media (max-width: 767px){.purchase-checkout-layout fieldset.purchase-panel, .purchase-checkout-summary { border-radius: 1rem; padding: 1rem; }}
@media (max-width: 767px){.purchase-paybar { gap: 0.875rem; }}
@media (max-width: 767px){.purchase-paybar > button { min-width: 0px; min-height: 3rem; padding-inline: 1rem; }}
@media (max-width: 379px){.campaign-cart-drawer > header, .campaign-cart-drawer > ul, .campaign-cart-drawer > footer { padding-inline: 1rem; }}
:root, :host { --color-red-600: lab(48.4493% 77.4328 61.5452); --color-orange-50: lab(97.7008% 1.53735 5.90649); --color-orange-100: lab(94.7127% 3.58394 14.3151); --color-orange-200: lab(88.4871% 9.94918 28.8378); --color-orange-300: lab(80.8059% 21.7313 50.4455); --color-orange-400: lab(70.0429% 42.5156 75.8207); --color-orange-500: lab(64.272% 57.1788 90.3583); --color-orange-600: lab(57.1026% 64.2584 89.8886); --color-orange-700: lab(46.4615% 57.7275 70.8507); --color-orange-800: lab(37.1566% 46.6433 50.5562); --color-orange-900: lab(30.2951% 36.0434 37.671); --color-orange-950: lab(14.1747% 23.4515 19.4461); --color-amber-50: lab(98.6252% -.635922 8.42309); --color-amber-100: lab(95.916% -1.21653 23.111); --color-amber-200: lab(91.7203% -.505269 49.9084); --color-amber-300: lab(86.4156% 6.13147 78.3961); --color-amber-500: lab(72.7183% 31.8672 97.9407); --color-amber-600: lab(60.3514% 40.5624 87.1228); --color-amber-700: lab(47.2709% 42.9082 69.2966); --color-amber-800: lab(37.8822% 37.1699 52.2718); --color-amber-900: lab(31.2288% 30.2627 40.0378); --color-amber-950: lab(15.8111% 20.9107 23.3752); --color-emerald-50: lab(97.8462% -6.94966 1.85487); --color-emerald-100: lab(94.9004% -17.0769 5.63836); --color-emerald-200: lab(90.2247% -31.039 9.47084); --color-emerald-300: lab(83.9203% -48.7124 13.8849); --color-emerald-400: lab(75.0771% -60.7313 19.4147); --color-emerald-500: lab(66.9756% -58.27 19.5419); --color-emerald-600: lab(55.0481% -49.9246 15.93); --color-emerald-700: lab(44.4871% -41.0396 11.0361); --color-emerald-800: lab(35.3675% -33.1188 8.04002); --color-emerald-900: lab(28.8637% -26.9249 5.45986); --color-emerald-950: lab(15.0582% -17.9507 2.38369); --color-sky-50: lab(97.3623% -2.33802 -4.13098); --color-sky-100: lab(94.3709% -4.56053 -8.23453); --color-sky-700: lab(41.6013% -9.10804 -42.5647); --color-sky-800: lab(35.164% -9.57692 -34.4068); --color-blue-100: lab(92.0301% -2.24757 -11.6453); --color-blue-700: lab(36.9089% 35.0961 -85.6872); --color-indigo-50: lab(95.4818% .411302 -6.78529); --color-indigo-100: lab(91.6577% 1.04591 -12.7199); --color-indigo-200: lab(84.4329% 3.18977 -23.9688); --color-indigo-300: lab(74.0235% 8.54138 -41.6075); --color-indigo-400: lab(59.866% 22.4834 -64.4485); --color-indigo-500: lab(48.295% 38.3129 -81.9673); --color-indigo-600: lab(38.4009% 52.6132 -92.3857); --color-indigo-700: lab(32.4486% 49.2217 -84.6695); --color-indigo-800: lab(26.6645% 37.9804 -68.6402); --color-indigo-900: lab(23.3911% 24.6978 -50.4718); --color-violet-100: lab(93.0838% 4.35197 -9.88284); --color-violet-700: lab(35.2783% 67.9912 -88.793); --color-rose-50: lab(96.2369% 4.94155 1.28011); --color-rose-100: lab(92.8221% 9.86832 2.60075); --color-rose-200: lab(86.806% 19.1909 4.07754); --color-rose-300: lab(76.6339% 38.3549 9.68835); --color-rose-400: lab(64.4125% 63.0291 19.2068); --color-rose-500: lab(56.101% 79.4328 31.4532); --color-rose-600: lab(49.1882% 81.577 36.0311); --color-rose-700: lab(41.1651% 71.6251 30.3087); --color-rose-800: lab(34.6481% 60.802 20.1957); --color-rose-900: lab(29.7104% 51.514 12.6253); --color-rose-950: lab(14.2323% 34.0086 9.80922); --color-slate-50: lab(98.1434% -.369519 -1.05966); --color-slate-100: lab(96.286% -.852436 -2.46847); --color-slate-200: lab(91.7353% -.998765 -4.76968); --color-slate-300: lab(84.7652% -1.94535 -7.93337); --color-slate-400: lab(65.5349% -2.25151 -14.5072); --color-slate-500: lab(48.0876% -2.03595 -16.5814); --color-slate-600: lab(35.5623% -1.74978 -15.4316); --color-slate-700: lab(26.9569% -1.47016 -15.6993); --color-slate-800: lab(16.132% -.318035 -14.6672); --color-slate-900: lab(7.78673% 1.82345 -15.0537); --color-slate-950: lab(1.76974% 1.32743 -9.28855); }
.absolute { position: absolute; }
.fixed { position: fixed; }
.relative { position: relative; }
.sticky { position: sticky; }
.inset-y-0 { inset-block: 0px; }
.-end-1\.5 { inset-inline-end: calc(var(--spacing) * -1.5); }
.end-0 { inset-inline-end: calc(var(--spacing) * 0); }
.-top-1\.5 { top: calc(var(--spacing) * -1.5); }
.top-0 { top: 0px; }
.z-30 { z-index: 30; }
.z-50 { z-index: 50; }
.ms-2 { margin-inline-start: calc(var(--spacing) * 2); }
.mt-1\.5 { margin-top: calc(var(--spacing) * 1.5); }
.mt-5 { margin-top: calc(var(--spacing) * 5); }
.mt-8 { margin-top: calc(var(--spacing) * 8); }
.mt-16 { margin-top: calc(var(--spacing) * 16); }
.mb-3 { margin-bottom: calc(var(--spacing) * 3); }
.grid { display: grid; }
.hidden { display: none; }
.inline-flex { display: inline-flex; }
.h-4 { height: calc(var(--spacing) * 4); }
.h-8 { height: calc(var(--spacing) * 8); }
.h-10 { height: calc(var(--spacing) * 10); }
.h-11 { height: calc(var(--spacing) * 11); }
.h-18 { height: calc(var(--spacing) * 18); }
.min-h-6 { min-height: calc(var(--spacing) * 6); }
.min-h-11 { min-height: calc(var(--spacing) * 11); }
.w-7 { width: calc(var(--spacing) * 7); }
.w-10 { width: calc(var(--spacing) * 10); }
.w-11 { width: calc(var(--spacing) * 11); }
.w-18 { width: calc(var(--spacing) * 18); }
.w-auto { width: auto; }
.max-w-7xl { max-width: var(--container-7xl); }
.max-w-md { max-width: var(--container-md); }
.min-w-4 { min-width: calc(var(--spacing) * 4); }
.translate-x-0 { --tw-translate-x: 0px; translate: var(--tw-translate-x) var(--tw-translate-y); }
.grid-cols-2 { grid-template-columns: repeat(2, minmax(0px, 1fr)); }
.grid-cols-\[minmax\(0\,1fr\)_auto_minmax\(0\,1fr\)\] { grid-template-columns: minmax(0px, 1fr) auto minmax(0px, 1fr); }
.flex-wrap { flex-wrap: wrap; }
.gap-1 { gap: var(--spacing); }
.gap-2\.5 { gap: calc(var(--spacing) * 2.5); }
.gap-5 { gap: calc(var(--spacing) * 5); }
.gap-8 { gap: calc(var(--spacing) * 8); }
:where(.space-y-2 > :not(:last-child)) { --tw-space-y-reverse: 0; margin-block-start: calc(calc(var(--spacing) * 2) * var(--tw-space-y-reverse)); margin-block-end: calc(calc(var(--spacing) * 2) * calc(1 - var(--tw-space-y-reverse))); }
:where(.divide-black\/5 > :not(:last-child)) { border-color: rgba(0, 0, 0, 0.05); }
:where(.divide-black\/5 > :not(:last-child)) { border-color: color-mix(in oklab, var(--color-black) 5%, transparent); }
.truncate { text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }
.overflow-hidden { overflow: hidden; }
.overflow-y-auto { overflow-y: auto; }
.rounded-full { border-radius: 2.14748e+09px; }
.border-b { border-bottom-style: var(--tw-border-style); border-bottom-width: 1px; }
.border-black\/10 { border-color: rgba(0, 0, 0, 0.1); }
.border-black\/10 { border-color: color-mix(in oklab, var(--color-black) 10%, transparent); }
.border-black\/15 { border-color: rgba(0, 0, 0, 0.15); }
.border-black\/15 { border-color: color-mix(in oklab, var(--color-black) 15%, transparent); }
.border-white\/5 { border-color: rgba(255, 255, 255, 0.05); }
.border-white\/5 { border-color: color-mix(in oklab, var(--color-white) 5%, transparent); }
.border-white\/10 { border-color: rgba(255, 255, 255, 0.1); }
.border-white\/10 { border-color: color-mix(in oklab, var(--color-white) 10%, transparent); }
.border-white\/15 { border-color: rgba(255, 255, 255, 0.15); }
.border-white\/15 { border-color: color-mix(in oklab, var(--color-white) 15%, transparent); }
.bg-brand { background-color: var(--brand); }
.bg-ink { background-color: rgb(23, 26, 30); }
.bg-ink\/95 { background-color: lab(9.07333 -0.616573 -3.30487 / 0.95); }
.fill-brand-bright { fill: var(--brand-bright); }
.fill-ink { fill: rgb(23, 26, 30); }
.fill-white { fill: var(--color-white); }
.fill-white\/10 { fill: rgba(255, 255, 255, 0.1); }
.fill-white\/10 { fill: color-mix(in oklab, var(--color-white) 10%, transparent); }
.stroke-brand-bright { stroke: var(--brand-bright); }
.stroke-ink { stroke: rgb(23, 26, 30); }
.stroke-white { stroke: var(--color-white); }
.stroke-white\/10 { stroke: rgba(255, 255, 255, 0.1); }
.stroke-white\/10 { stroke: color-mix(in oklab, var(--color-white) 10%, transparent); }
.stroke-white\/25 { stroke: rgba(255, 255, 255, 0.25); }
.stroke-white\/25 { stroke: color-mix(in oklab, var(--color-white) 25%, transparent); }
.stroke-white\/50 { stroke: rgba(255, 255, 255, 0.5); }
.stroke-white\/50 { stroke: color-mix(in oklab, var(--color-white) 50%, transparent); }
.stroke-white\/80 { stroke: rgba(255, 255, 255, 0.8); }
.stroke-white\/80 { stroke: color-mix(in oklab, var(--color-white) 80%, transparent); }
.stroke-white\/85 { stroke: rgba(255, 255, 255, 0.85); }
.stroke-white\/85 { stroke: color-mix(in oklab, var(--color-white) 85%, transparent); }
.p-4 { padding: calc(var(--spacing) * 4); }
.px-2 { padding-inline: calc(var(--spacing) * 2); }
.px-2\.5 { padding-inline: calc(var(--spacing) * 2.5); }
.px-6 { padding-inline: calc(var(--spacing) * 6); }
.py-1 { padding-block: var(--spacing); }
.py-1\.5 { padding-block: calc(var(--spacing) * 1.5); }
.py-4 { padding-block: calc(var(--spacing) * 4); }
.py-5 { padding-block: calc(var(--spacing) * 5); }
.py-12 { padding-block: calc(var(--spacing) * 12); }
.pt-\[calc\(1\.25rem\+var\(--sa-top\)\)\] { padding-top: calc(1.25rem + var(--sa-top)); }
.pb-\[calc\(1rem\+var\(--sa-bottom\)\)\] { padding-bottom: calc(1rem + var(--sa-bottom)); }
.font-display { font-family: "Sporta Alexandria Local", "Alexandria Fallback", alexandria, "Sporta Plex Arabic Local", "Plex Arabic Fallback", ibm-plex-arabic, sans-serif; }
.text-2xl { font-size: var(--text-2xl); line-height: var(--tw-leading,var(--text-2xl--line-height)); }
.text-base { font-size: var(--text-base); line-height: var(--tw-leading,var(--text-base--line-height)); }
.text-xl { font-size: var(--text-xl); line-height: var(--tw-leading,var(--text-xl--line-height)); }
.text-\[\.7rem\] { font-size: 0.7rem; }
.leading-none { --tw-leading: 1; line-height: 1; }
.font-extrabold { --tw-font-weight: var(--font-weight-extrabold); font-weight: var(--font-weight-extrabold); }
.tracking-wide { --tw-tracking: var(--tracking-wide); letter-spacing: var(--tracking-wide); }
.text-ink { color: rgb(23, 26, 30); }
.text-slate-300 { color: var(--color-slate-300); }
.text-slate-400 { color: var(--color-slate-400); }
.text-slate-500 { color: var(--color-slate-500); }
.text-white { color: var(--color-white); }
.text-white\/80 { color: rgba(255, 255, 255, 0.8); }
.text-white\/80 { color: color-mix(in oklab, var(--color-white) 80%, transparent); }
.text-white\/85 { color: rgba(255, 255, 255, 0.85); }
.text-white\/85 { color: color-mix(in oklab, var(--color-white) 85%, transparent); }
.text-white\/90 { color: rgba(255, 255, 255, 0.9); }
.text-white\/90 { color: color-mix(in oklab, var(--color-white) 90%, transparent); }
.shadow-2xl { --tw-shadow: 0 25px 50px -12px var(--tw-shadow-color,#00000040); box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow); }
.backdrop-blur { --tw-backdrop-blur: blur(8px); backdrop-filter: var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,); }
.transition-transform { transition-property: transform, translate, scale, rotate; transition-timing-function: var(--tw-ease,var(--default-transition-timing-function)); transition-duration: var(--tw-duration,var(--default-transition-duration)); }
.duration-300 { --tw-duration: .3s; transition-duration: 0.3s; }
.ease-out { --tw-ease: var(--ease-out); transition-timing-function: var(--ease-out); }
@media (hover: hover){.hover\:border-brand:hover { border-color: var(--brand); }}
@media (hover: hover){.hover\:text-brand:hover { color: var(--brand); }}
@media (hover: hover){.hover\:text-brand-bright:hover { color: var(--brand-bright); }}
@media (hover: hover){.hover\:text-rose-600:hover { color: var(--color-rose-600); }}
@media (hover: hover){.hover\:text-slate-700:hover { color: var(--color-slate-700); }}
.disabled\:cursor-not-allowed:disabled { cursor: not-allowed; }
.disabled\:opacity-35:disabled { opacity: 0.35; }
@media (min-width: 40rem){.sm\:inline { display: inline; }}
@media (min-width: 40rem){.sm\:h-11 { height: calc(var(--spacing) * 11); }}
@media (min-width: 40rem){.sm\:w-11 { width: calc(var(--spacing) * 11); }}
@media (min-width: 40rem){.sm\:gap-3 { gap: calc(var(--spacing) * 3); }}
@media (min-width: 40rem){.sm\:gap-6 { gap: calc(var(--spacing) * 6); }}
@media (min-width: 40rem){.sm\:px-4 { padding-inline: calc(var(--spacing) * 4); }}
@media (min-width: 40rem){.sm\:py-3 { padding-block: calc(var(--spacing) * 3); }}
@media (min-width: 40rem){.sm\:text-xs { font-size: var(--text-xs); line-height: var(--tw-leading,var(--text-xs--line-height)); }}
@media (min-width: 48rem){.md\:h-9 { height: calc(var(--spacing) * 9); }}
@media (min-width: 48rem){.md\:p-5 { padding: calc(var(--spacing) * 5); }}
@media (min-width: 48rem){.md\:py-16 { padding-block: calc(var(--spacing) * 16); }}
@media (min-width: 48rem){.md\:text-3xl { font-size: var(--text-3xl); line-height: var(--tw-leading,var(--text-3xl--line-height)); }}
@media (min-width: 64rem){.lg\:sticky { position: sticky; }}
@media (min-width: 64rem){.lg\:top-28 { top: calc(var(--spacing) * 28); }}
@media (min-width: 64rem){.lg\:hidden { display: none; }}
@media (min-width: 64rem){.lg\:inline-flex { display: inline-flex; }}
@media (min-width: 64rem){.lg\:grid-cols-\[1fr_23rem\] { grid-template-columns: 1fr 23rem; }}
@media (min-width: 64rem){.lg\:self-start { align-self: flex-start; }}
.storefront-root { --shop-border-subtle: color-mix(in srgb, var(--line) 78%, transparent); }
.storefront-root .sporta-footer { background: rgb(23, 26, 30); margin-block-start: clamp(3rem, 6vw, 5rem); }
.storefront-root .footer-columns { grid-template-columns: minmax(0px, 1fr) minmax(0px, 1.2fr); gap: clamp(2rem, 6vw, 5rem); padding-block: 3rem; display: grid; }
.storefront-root .footer-links, .storefront-root .footer-links > div { min-width: 0px; }
.storefront-root .footer-links ul { justify-items: start; display: grid; }
.storefront-root .footer-links h2 { color: var(--brand-bright); font-size: 0.9375rem; line-height: 1.4; }
.storefront-root .footer-links a { color: rgb(182, 190, 200); min-height: 2rem; }
.storefront-root .footer-links a:hover { color: var(--brand-bright); }
@media (max-width: 767px){.storefront-root .footer-columns { grid-template-columns: 1fr; gap: 2.5rem; padding-block: 2.5rem; }}
@media (max-width: 767px){.storefront-root .footer-links ul { justify-items: center; }}
:focus-visible { outline: 2px solid hsl(var(--primary)); outline-offset: 2px; border-radius: 6px; }
.cart-drawer { overscroll-behavior: contain; height: 100dvh; }
.app-footer { padding-bottom: var(--sa-bottom); }
.safe-bottom { padding-bottom: calc(.75rem + var(--sa-bottom)); }
@media (pointer: coarse){.tap { min-width: 44px; }}
.action-bar { z-index: 30; backdrop-filter: blur(12px); inset-inline: 0px; background: rgba(255, 255, 255, 0.92); border-top: 1px solid rgba(0, 0, 0, 0.08); position: fixed; bottom: 0px; }
:root{--brand:#e0561c;--brand-bright:#ff7b17;--brand-deep:#b8430f}
.sticky{position:sticky}.top-0{top:0}.z-30{z-index:30}.z-50{z-index:50}.fixed{position:fixed}
`

const T_SUMMARY = RAW`<div class="purchase-panel purchase-checkout-summary rounded-2xl border border-slate-100 bg-white p-4 md:p-5"><h2 class="flex items-baseline justify-between font-bold text-slate-800">ملخص الطلب<span class="text-xs font-medium text-slate-600">قطعتان</span></h2><ul class="mt-3 divide-y divide-slate-100">{{LINES}}</ul><div class="mt-4"><div class="flex gap-2"><input placeholder="كود الخصم" aria-label="كود الخصم" autocomplete="off" spellcheck="false" class="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm uppercase outline-none focus:border-accent" value=""><button type="button" disabled="" class="flex-none rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-40">تطبيق</button></div></div><div class="mt-4 space-y-1.5 border-t border-slate-200 pt-4 text-sm"><div class="flex justify-between gap-3 text-slate-600"><span>المجموع الفرعي</span><span class="tabular-nums" dir="ltr">‏6.000&nbsp;د.ك.‏</span></div></div><div class="mt-3 flex justify-between text-sm text-slate-600"><span>التوصيل</span><span class="tabular-nums">‏1.000&nbsp;د.ك.‏</span></div><div class="purchase-total mt-4 flex justify-between border-t border-slate-200 pt-4 text-lg font-bold"><span>الإجمالي</span><span class="text-accent tabular-nums">‏7.000&nbsp;د.ك.‏</span></div><button type="submit" class="btn btn-primary mt-5 hidden w-full lg:inline-flex">المتابعة إلى الدفع</button></div>`
const T_SUMMARY_LI = RAW`<li class="flex justify-between gap-3 py-3 text-sm"><span class="min-w-0 break-words text-slate-600" dir="auto">{{NAME}}<span class="font-semibold text-slate-700"> (M)</span> × 1</span></li>`
const T_QUICK = RAW`<form aria-busy="false" class="purchase-quick mx-auto max-w-5xl"><section class="purchase-panel purchase-quick__delivery rounded-2xl border border-slate-100 bg-white p-5"><div class="flex items-start justify-between gap-4"><h2 class="flex items-center gap-2 text-sm font-bold text-slate-800"><svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle text-brand" shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke" aria-hidden="true" focusable="false"></svg>التوصيل إلى</h2><button type="button" class="text-accent -my-2 py-2 text-xs font-semibold underline underline-offset-2" aria-label="تغيير: التوصيل إلى">تغيير</button></div><p class="mt-3 font-bold text-slate-900" dir="auto">Test User</p><p class="text-sm font-semibold tabular-nums text-slate-700" dir="ltr">+965 50012345</p><p class="mt-1 text-sm text-slate-600" dir="auto">Kuwait City, العاصمة</p><p class="mt-1 text-sm text-slate-600" dir="auto">قطعة 1 · شارع 2 · منزل / بناية 3</p></section><section class="purchase-panel purchase-quick__bag rounded-2xl border border-slate-100 bg-white p-5"><h2 class="flex items-baseline justify-between text-sm font-bold text-slate-800">ملخص الطلب<a class="text-accent text-xs font-semibold underline underline-offset-2" href="/cart" data-discover="true">تعديل الحقيبة</a></h2><ul class="mt-3 divide-y divide-slate-100">{{LINES}}</ul><div class="mt-4"><div class="flex gap-2"><input placeholder="كود الخصم" aria-label="كود الخصم" autocomplete="off" spellcheck="false" class="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm uppercase outline-none focus:border-accent"><button type="button" disabled="" class="flex-none rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 disabled:opacity-40">تطبيق</button></div></div><div class="mt-4 space-y-1.5 border-t border-slate-200 pt-4 text-sm"><div class="flex justify-between gap-3 text-slate-600"><span>المجموع الفرعي</span><span class="tabular-nums" dir="ltr">‏6.000&nbsp;د.ك.‏</span></div><div class="flex justify-between gap-3 text-slate-600"><span>التوصيل</span><span class="tabular-nums" dir="ltr">‏1.000&nbsp;د.ك.‏</span></div></div><div class="purchase-total mt-3 flex justify-between border-t border-slate-200 pt-3 text-lg font-bold"><span>الإجمالي <span class="text-sm font-medium text-slate-600">قطعتان</span></span><span class="text-accent tabular-nums">‏7.000&nbsp;د.ك.‏</span></div></section><fieldset class="purchase-payment purchase-panel purchase-quick__payment rounded-2xl border border-slate-100 bg-white p-5"><legend class="px-1 text-sm font-bold text-slate-800">كيف تحب تدفع؟</legend><div class="mt-2" aria-live="polite"><label class="payment-method tap-row flex gap-3 rounded-xl border p-3 transition cursor-pointer payment-method--selected border-brand bg-brand/5"><input aria-describedby="_r_0_-cod-hint" class="mt-0.5 h-5 w-5 shrink-0 accent-brand" type="radio" checked="" name="paymethod"><span class="min-w-0 flex-1"><span class="flex items-center justify-between gap-3"><span class="block text-sm font-semibold text-slate-800">الدفع عند الاستلام</span><span class="payment-method__badge" aria-hidden="true">نقدًا</span></span><span id="_r_0_-cod-hint" class="mt-0.5 block text-xs leading-snug text-slate-600">ادفع للمندوب عند وصول طلبك.</span></span></label></div></fieldset><button type="submit" class="purchase-quick__submit btn btn-primary w-full">تأكيد الطلب — الدفع عند الاستلام</button><p class="purchase-quick__assurance flex items-center justify-center gap-1.5 text-center text-xs text-slate-600"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle text-brand" shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke" aria-hidden="true" focusable="false"></svg>يفضّل تجهيز المبلغ بالضبط، فالمندوب قد لا يحمل فكة.</p></form>`
const T_QUICK_LI = RAW`<li class="flex items-center gap-3 py-3"><img alt="" width="48" height="48" loading="lazy" decoding="async" class="h-12 w-12 shrink-0 rounded-lg object-cover" src="/product-photo-unavailable.svg"><div class="min-w-0 flex-1"><p class="break-words text-sm font-semibold text-slate-800" dir="auto">{{NAME}}</p><p class="text-xs text-slate-600">M</p></div></li>`
const T_DRAWER = RAW`<aside role="dialog" aria-modal="true" aria-label="حقيبتك" class="cart-drawer campaign-cart-drawer fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ease-out translate-x-0"><header class="flex items-center justify-between border-b border-black/10 px-6 py-5 pt-[calc(1.25rem+var(--sa-top))]"><div class="flex min-w-0 items-center gap-3"><span class="cart-drawer__mark"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle " shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke" aria-hidden="true" focusable="false"></svg></span><h2 class="text-xl font-extrabold text-slate-900">حقيبتك</h2><span class="purchase-count">2</span></div><button aria-label="إغلاق" class="tap flex items-center justify-center text-slate-400 hover:text-slate-700"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle " shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke" aria-hidden="true" focusable="false"></svg></button></header><ul class="flex-1 divide-y divide-black/5 overflow-y-auto px-6">{{LINES}}</ul><footer class="pb-[calc(1rem+var(--sa-bottom))] border-t border-black/10 px-6 py-5"><div class="flex items-center justify-between text-lg font-extrabold"><span>المجموع الفرعي</span><span class="text-accent tabular-nums">‏6.000&nbsp;د.ك.‏</span></div><p class="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle " shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke" aria-hidden="true" focusable="false"></svg> طرق الدفع المتاحة تظهر عند إتمام الشراء</p><a class="btn btn-primary mt-4 w-full" href="/checkout" data-discover="true">إتمام الشراء</a><a class="mt-2 block text-center text-sm font-semibold text-slate-500 hover:text-brand" href="/shop" data-discover="true">العودة للمتجر</a></footer></aside>`
const T_DRAWER_LI = RAW`<li class="cart-drawer__line flex gap-4 py-4"><img alt="شورت فلاش — أحمر" width="72" height="72" class="h-18 w-18 shrink-0 rounded-xl object-cover" src="/product-photo-unavailable.svg"><div class="min-w-0 flex-1"><p class="font-bold text-slate-900">شورت فلاش — أحمر</p><p class="mt-0.5 text-sm text-slate-500 tabular-nums">‏3.000&nbsp;د.ك.‏ · M</p><div class="mt-2 flex items-center gap-3"><div class="purchase-quantity flex items-center rounded-full border border-black/15 text-slate-900"><button class="px-3 py-1 text-base font-bold leading-none text-slate-700 hover:text-brand" aria-label="إنقاص الكمية"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle " shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke" aria-hidden="true" focusable="false"></svg></button><span class="w-7 text-center text-sm font-bold tabular-nums text-slate-900">1</span><button class="px-3 py-1 text-base font-bold leading-none text-slate-700 hover:text-brand disabled:cursor-not-allowed disabled:opacity-35" aria-label="زيادة الكمية"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle " shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke" aria-hidden="true" focusable="false"></svg></button></div><button aria-label="إزالة" class="cart-drawer__remove text-slate-400 hover:text-rose-600"><svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="sporta-icon inline-block shrink-0 align-middle " shape-rendering="geometricPrecision" vector-effect="non-scaling-stroke" aria-hidden="true" focusable="false"></svg></button></div></div><span class="cart-drawer__line-total text-accent font-extrabold tabular-nums">‏3.000&nbsp;د.ك.‏</span></li>`
const T_REMEMBER = RAW`<label class="tap-row mt-4 flex cursor-pointer gap-2.5 text-sm text-slate-600"><input class="h-5 w-5 shrink-0 accent-brand" type="checkbox" checked="">احفظ هذه البيانات على هذا الجهاز</label>`
const T_PAYBAR = RAW`<div class="purchase-paybar action-bar safe-bottom flex items-center justify-between gap-3 px-4 pt-3 lg:hidden"><div class="min-w-0"><p class="text-xs font-semibold uppercase tracking-wide text-slate-600">الإجمالي</p><p class="text-accent truncate text-lg font-extrabold tabular-nums">‏7.000&nbsp;د.ك.‏</p></div><button type="submit" class="btn btn-primary flex-1">المتابعة إلى الدفع</button></div>`
const T_FOOTER_LINKS = RAW`<div class="footer-links grid grid-cols-2 gap-8"><div><h2 class="mb-3 text-sm font-bold" dir="auto">معلومات</h2><ul class="space-y-2 text-sm"><li><a class="inline-flex min-h-6 items-center" href="/about" data-discover="true">من نحن</a></li><li><a class="inline-flex min-h-6 items-center" href="/about#why" data-discover="true">لماذا سبورتا؟</a></li><li><a class="inline-flex min-h-6 items-center" href="/terms" data-discover="true">الشروط</a></li><li><a class="inline-flex min-h-6 items-center" href="/privacy" data-discover="true">الخصوصية</a></li></ul></div><div><h2 class="mb-3 text-sm font-bold" dir="auto">التنقل</h2><ul class="space-y-2 text-sm"><li><a class="inline-flex min-h-6 items-center" href="/contact" data-discover="true">اتصل بنا</a></li><li><a class="inline-flex min-h-6 items-center" href="/terms#delivery" data-discover="true">الشحن</a></li><li><a class="inline-flex min-h-6 items-center" href="/returns" data-discover="true">الإرجاع</a></li><li><a class="inline-flex min-h-6 items-center" href="/track" data-discover="true">تتبع الطلب</a></li><li><a class="inline-flex min-h-6 items-center" href="/account" data-discover="true">حسابي</a></li></ul></div></div>`

// Arabic (live) -> English (repo wording). Longest first so a phrase is never half-replaced.
const EN = [
  ['تأكيد الطلب — الدفع عند الاستلام', 'Place order — pay on delivery'],
  ['يفضّل تجهيز المبلغ بالضبط، فالمندوب قد لا يحمل فكة.', 'Have the exact amount ready if you can — drivers do not always carry change.'],
  ['ادفع للمندوب عند وصول طلبك.', 'Pay the driver when your order arrives.'],
  ['احفظ هذه البيانات على هذا الجهاز', 'Remember these details on this device'],
  ['طرق الدفع المتاحة تظهر عند إتمام الشراء', 'Payment methods are shown at checkout'],
  ['تغيير: التوصيل إلى', 'Change: Deliver to'],
  ['كيف تحب تدفع؟', 'How would you like to pay?'],
  ['المتابعة إلى الدفع', 'Continue to payment'],
  ['الدفع عند الاستلام', 'Cash on delivery'],
  ['بنطال ستريت — كحلي', 'Street Pants — Navy'],
  ['شورت فلاش — أحمر', 'Flash Shorts — Red'],
  ['المجموع الفرعي', 'Subtotal'],
  ['تعديل الحقيبة', 'Edit bag'],
  ['زيادة الكمية', 'Increase quantity'],
  ['إنقاص الكمية', 'Decrease quantity'],
  ['العودة للمتجر', 'Back to shop'],
  ['إتمام الشراء', 'Checkout'],
  ['ملخص الطلب', 'Order summary'],
  ['التوصيل إلى', 'Deliver to'],
  ['كود الخصم', 'Discount code'],
  ['لماذا سبورتا؟', 'Why Sporta?'],
  ['تتبع الطلب', 'Track order'],
  ['الخصوصية', 'Privacy'],
  ['اتصل بنا', 'Contact us'],
  ['التنقل', 'Navigate'],
  ['معلومات', 'Information'],
  ['من نحن', 'About us'],
  ['الإجمالي', 'Total'],
  ['الإرجاع', 'Returns'],
  ['الشروط', 'Terms'],
  ['الشحن', 'Shipping'],
  ['حسابي', 'My account'],
  ['حقيبتك', 'Your bag'],
  ['إغلاق', 'Close'],
  ['التوصيل', 'Delivery'],
  ['قطعتان', '2 items'],
  ['تطبيق', 'Apply'],
  ['تغيير', 'Change'],
  ['إزالة', 'Remove'],
  ['نقدًا', 'CASH'],
  ['د.ك.', 'KWD'],
]
const loc = (lang, s) => (lang === 'en' ? EN.reduce((a, [ar, en]) => a.split(ar).join(en), s) : s)

const NAMES = {
  ar: ['شورت فلاش — أحمر', 'بنطال ستريت — كحلي', 'سترة كلاودسوفت الرياضية الخفيفة بقصة مريحة — أخضر زيتي', 'ليقنز سكلبت عالي الخصر بخامة مرنة سريعة الجفاف — أسود'],
  en: ['Flash Shorts — Red', 'Street Pants — Navy', 'Cloudsoft Lightweight Training Jacket with Relaxed Fit — Army Green', 'Sculpt High-Waist Quick-Dry Stretch Leggings — Onyx Black'],
}
const lines = (tpl, lang, n, longNames) => Array.from({ length: n }, (_, i) => {
  const set = NAMES[lang]
  const name = longNames ? set[i % 2 ? 3 : 2] : set[i % 2]
  return tpl.split('{{NAME}}').join(name)
}).join('')

// A field error. NOT dumped from the live DOM (an error appears only after a failed submit, which a read-only scan
// never makes): reconstructed from the live Checkout chunk, className `mt-1 text-xs font-semibold text-rose-600`,
// role alert, id e-<field>.
const FIELD_ERROR = {
  ar: '<p id="e-f-name" role="alert" class="mt-1 text-xs font-semibold text-rose-600">اكتب اسمك الكامل</p>',
  en: '<p id="e-f-name" role="alert" class="mt-1 text-xs font-semibold text-rose-600">Enter your full name</p>',
}
const H1 = { ar: 'إتمام الشراء', en: 'Checkout' }
const filler = (h) => `<div style="height:${h}px"></div>`

// opts: state 'quick' | 'guest' | 'drawer', n (lines in the bag), long (long product names), headerH (px)
export function page(lang, addon, opts = {}) {
  const { state = 'quick', n = 2, long = false } = opts
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const body = state === 'quick'
    ? loc(lang, T_QUICK.split('{{LINES}}').join(lines(T_QUICK_LI, lang, n, long)))
    : `<form class="purchase-checkout-layout grid gap-5 lg:grid-cols-[1fr_23rem]"><div class="min-w-0 space-y-6">
        <h2 class="purchase-stage-title text-xl font-extrabold text-slate-900">${loc(lang, 'التوصيل')}</h2>
        <fieldset class="purchase-panel rounded-2xl border border-slate-100 bg-white p-4">${FIELD_ERROR[lang]}${filler(560)}</fieldset>
        <fieldset class="purchase-panel rounded-2xl border border-slate-100 bg-white p-4">${filler(700)}${loc(lang, T_REMEMBER)}</fieldset></div>
        <aside class="min-w-0 lg:sticky lg:top-28 lg:self-start">${loc(lang, T_SUMMARY.split('{{LINES}}').join(lines(T_SUMMARY_LI, lang, n, long)))}</aside>
        ${loc(lang, T_PAYBAR)}<div class="h-[calc(5.25rem+var(--sa-bottom))] lg:hidden"></div></form>`
  const drawer = state === 'drawer'
    ? loc(lang, T_DRAWER.split('{{LINES}}').join(lines(T_DRAWER_LI, lang, Math.min(n, 3), long))) : ''
  const footer = `<footer class="app-footer sporta-footer mt-16 bg-ink text-slate-300"><div class="mx-auto max-w-7xl px-6 py-12 md:py-16"><div class="footer-columns"><div class="footer-brand"></div>${loc(lang, T_FOOTER_LINKS)}</div></div></footer>`
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${LIVE}</style><style>${addon}</style></head><body>
<div class="storefront-root"><header class="app-header sticky top-0 z-30" style="height:145px;background:#171a1e"></header>
<main id="main" class="flex-1"><section class="purchase-flow mx-auto max-w-6xl px-4">
<div style="height:71px"></div><h1 class="mt-5 mb-2 text-3xl font-extrabold">${H1[lang]}</h1><div style="height:150px"></div>${body}</section></main>${footer}</div>${drawer}</body></html>`
}
