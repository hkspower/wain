// The live product page (/product/<slug>) as a fixture: the exact markup dumped from www.sporta.com.kw on
// 2026-11-03 (`.catalog-product-page`, Arabic, product "cagliari-calcio-backpack"; images replaced by a 1px
// gif, svg icon bodies emptied, the size buttons the live scripts hide un-hidden) and every rule of the live
// /assets/index-CdcKvZhs.css that matches an element in it, with its @layer / @media context (Tailwind's
// utilities are in @layer utilities, so the unlayered add-on files beat them whatever the specificity). Used
// by product-desc-test.mjs to prove the rules in public/sporta-product-fix.css against the real markup.
// Dump caveats: rules whose selector the dump cut inside :where(...) are dropped (none of them touches the
// elements under test), and the theme/lab and print rules are left out. The live English copy was not dumped;
// the English strings are the repo's wording and only geometry is asserted, never words.
//
// The fonts differ from live (the Arabic font is not available here), so the test asserts relative geometry.
export const LIVE = String.raw`
@layer properties, theme, base, components, utilities;
p,ul{min-width: 0px;}
li{min-width: 0px;}
.catalog-product-page{box-sizing: border-box; width: 100%; max-width: var(--shop-shell-max,80rem); color: var(--text-primary); margin-inline: auto;}
.catalog-eyebrow{color: hsl(var(--accent-text)); margin-block-end: 0.75rem; font-size: 0.75rem; font-weight: 800; line-height: 1.5;}
.storefront-root .product-grid-card{border: 1px solid var(--shop-border); border-radius: var(--shop-radius-lg); background: var(--surface); flex-direction: column; min-width: 0px; height: 100%; padding: 0.5rem; display: flex; overflow: hidden; box-shadow: rgba(23, 26, 30, 0.02) 0px 2px 4px;}
.storefront-root .product-grid-card .catalog-card-image{flex: 0 0 auto;}
.storefront-root .product-grid-card .catalog-card-info{text-align: center; flex-direction: column; flex: 1 1 auto; align-items: stretch; min-width: 0px; min-height: 5.75rem; display: flex;}
.storefront-root .product-grid-card .catalog-card-name{-webkit-line-clamp: 2; text-wrap: balance; text-align: center; -webkit-box-orient: vertical; display: -webkit-box; overflow: hidden;}
.storefront-root .product-grid-card .price-card{text-align: center; justify-content: center; align-items: baseline; min-height: 1.5rem; margin-block-start: auto;}
@media (max-width: 359px){.storefront-root .product-grid-card .catalog-card-info{min-height: 6.25rem;}}
@media (max-width: 359px){.storefront-root .product-grid-card .catalog-card-name{-webkit-line-clamp: 3; min-height: 4.25rem;}}
.storefront-root .catalog-card-image{aspect-ratio: 4 / 5; border: 1px solid var(--shop-border-subtle); border-radius: var(--shop-radius-md); isolation: isolate; background: rgb(255, 255, 255); place-items: center; display: grid;}
.storefront-root .catalog-card-image > a{min-width: 0px; min-height: 0px;}
.catalog-card-photo{object-fit: contain; object-position: center center; backface-visibility: hidden; image-rendering: auto; max-width: 100%; padding: clamp(0.5rem, 1vw, 0.875rem); display: block;}
.image-loading-skeleton{background: var(--canvas-muted); border-radius: 0.75rem; transition: opacity 0.2s; overflow: hidden;}
.image-loading-skeleton.is-hidden{opacity: 0;}
.catalog-card-info{flex: 1 1 auto; align-items: center; min-height: 5rem; padding: 0.875rem 0.375rem 0.5rem;}
.catalog-card-info > a{width: 100%; min-width: 0px;}
.catalog-card-name{overflow-wrap: anywhere; width: 100%; min-height: 2.9rem; font-size: 0.9375rem; font-weight: 650; line-height: 1.45;}
.catalog-card-info .price-card{font-variant-numeric: tabular-nums; text-align: center; justify-content: center; align-items: baseline; width: 100%; min-height: 2rem; font-size: 1.125rem; font-weight: 850; line-height: 1.25;}
.catalog-card-badge{color: rgb(255, 255, 255); max-width: calc(100% - 4rem); font-size: var(--type-micro); letter-spacing: 0.025em; background: rgb(23, 26, 30); border-radius: 0.375rem; line-height: 1.5;}
[dir="rtl"] .catalog-card-badge{letter-spacing: 0px;}
.catalog-card-save,.catalog-card-add{border: 1px solid var(--shop-border-on-light,#171a1e1f); border-radius: 0.625rem;}
.storefront-root .product-grid-card .catalog-card-save{color: rgb(89, 99, 112); background: rgba(255, 255, 255, 0.96);}
.catalog-card-add{background: var(--brand-bright); color: rgb(23, 26, 30); opacity: 1; border-color: var(--shop-border-on-light,#171a1e1f); transition: transform 0.16s, background-color 0.16s, color 0.16s, box-shadow 0.16s, opacity 0.16s; transform: none; box-shadow: rgba(23, 26, 30, 0.38) 0px 6px 14px -6px;}
.catalog-card-add:disabled{display: none;}
.catalog-breadcrumb{color: var(--text-muted); border-block-end: 1px solid var(--line); padding-block: 0.125rem 0.75rem;}
.catalog-breadcrumb ol{min-width: 0px;}
.catalog-breadcrumb-current{color: var(--text-primary); min-width: 0px; max-width: min(60vw, 32rem);}
.catalog-product-layout{align-items: start; gap: clamp(1.5rem, 4vw, 4rem);}
.catalog-product-visual,.catalog-gallery{width: 100%;min-width: 0px;}
.catalog-product-summary{text-align: start; min-width: 0px;}
.catalog-product-title{overflow-wrap: anywhere; font-size: clamp(1.5rem, 2.4vw, 2.25rem); line-height: 1.3;}
.catalog-product-description{font-size: var(--type-body); color: var(--text-muted);}
.catalog-product-price{border-block-end: 1px solid var(--line); text-align: start; flex-wrap: wrap; justify-content: flex-start; align-items: baseline; gap: 0.25rem 0.75rem; padding-block-end: 1.25rem; font-size: clamp(1.9rem, 3vw, 2.35rem); font-weight: 850;}
.catalog-product-options > div{border: 1px solid var(--shop-border,var(--line)); border-radius: var(--shop-radius-lg,1rem); width: 100%; min-width: 0px;}
.catalog-product-quantity{border: 1px solid var(--shop-border,var(--line)); min-height: 3rem;}
.product-purchase-row{grid-template-columns: auto minmax(0px, 1fr); align-items: stretch; gap: 0.75rem; min-width: 0px; display: grid;}
.product-purchase-row .catalog-product-quantity{justify-self: start;}
.product-purchase-row > .btn{white-space: normal; width: 100%; min-width: 0px; height: auto; min-height: 3rem; padding-inline: 0.75rem; line-height: 1.3;}
.product-buy-now-inline{display: none;}
.catalog-product-reassurance{border: 1px solid var(--shop-border,var(--line)); border-radius: var(--shop-radius-lg,1rem); background: var(--canvas-muted);}
.catalog-product-reassurance li{align-items: flex-start; line-height: 1.65;}
.catalog-product-reassurance svg{flex-shrink: 0; margin-block-start: 0.125rem;}
.catalog-product-page .campaign-brand-plate{justify-content: flex-start; gap: 0.625rem 0.875rem; min-width: 0px; padding: 0.875rem 1rem;}
.catalog-product-page .campaign-brand-plate__owner{flex: 0 0 auto; align-items: center; min-width: 0px; display: inline-flex;}
.catalog-product-page .campaign-brand-plate__owner img{object-fit: contain; width: auto; max-width: 100%;height: 1.75rem; display: block;}
.catalog-product-page .campaign-brand-plate__authentic{border-block-start: 1px solid var(--shop-border-subtle,var(--line)); text-align: start; width: 100%; min-width: 0px; margin: 0px; padding-block-start: 0.625rem;}
.catalog-related{border-block-start: 1px solid var(--line); padding-block-start: 2rem;}
.catalog-gallery-stage{border: 1px solid var(--shop-border,var(--line)); border-radius: var(--shop-radius-lg,1rem); isolation: isolate; background: rgb(255, 255, 255); place-items: center; display: grid;}
.catalog-gallery-track{position: absolute; inset: 0px;}
.catalog-gallery-photo{object-fit: contain; object-position: center center; backface-visibility: hidden; image-rendering: auto; will-change: transform; width: 100%; max-width: 100%; height: 100%; padding: clamp(0.75rem, 2vw, 1.5rem); transition: transform 0.18s ease-out; display: block;}
.catalog-gallery-zoom{border: 1px solid var(--shop-border-on-light,#171a1e1f);}
@media (min-width: 768px){.product-purchase-row{grid-template-columns: auto minmax(0px, 1fr) minmax(0px, 1fr);}}
@media (min-width: 768px){.product-buy-now-inline{display: inline-flex;}}
@media (min-width: 1024px){.catalog-product-visual{top: 10rem;}}
@media (min-width: 640px) and (max-width: 1023px){.catalog-product-page .catalog-breadcrumb,.catalog-product-layout{width: min(100%, 38rem); margin-inline: auto;}}
@media (max-width: 639px){.catalog-product-page .catalog-breadcrumb-current{max-width: min(52vw, 20rem);}}
@media (max-width: 479px){.storefront-root .product-grid-card,.catalog-card-photo{padding: 0.375rem;}}
@media (max-width: 479px){.storefront-root .product-grid-card .catalog-card-info{min-height: 5.5rem; padding: 0.625rem 0.125rem 0.375rem;}}
@media (max-width: 479px){.catalog-card-name{font-size: 0.875rem; line-height: 1.4;}}
@media (max-width: 479px){.catalog-card-info .price-card{font-size: 1rem;}}
@media (max-width: 479px){.catalog-card-badge{inset-inline-start: 0.375rem; font-size: var(--type-micro); padding: 0.25rem 0.375rem; top: 0.375rem;}}
@media (prefers-reduced-motion: reduce){.storefront-root .product-grid-card,.catalog-card-photo,.catalog-card-save,.catalog-card-add,.catalog-gallery-photo,.catalog-card-add{transition: none;}}
.campaign-brand-plate{border: 1px solid var(--shop-border,var(--line)); background: var(--surface); color: var(--ink); border-radius: 0.875rem; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.875rem; padding: 1rem; display: flex;}
.campaign-brand-plate .text-slate-600{color: var(--text-muted);}
@layer theme{:root{--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; --color-red-600: #e40014; --color-orange-50: #fff7ed; --color-orange-100: #ffedd5; --color-orange-200: #ffd7a8; --color-orange-300: #ffb96d; --color-orange-400: #ff8b1a; --color-orange-500: #fe6e00; --color-orange-600: #f05100; --color-orange-700: #c53c00; --color-orange-800: #9f2d00; --color-orange-900: #7e2a0c; --color-orange-950: #441306; --color-amber-50: #fffbeb; --color-amber-100: #fef3c6; --color-amber-200: #fee685; --color-amber-300: #ffd236; --color-amber-500: #f99c00; --color-amber-600: #dd7400; --color-amber-700: #b75000; --color-amber-800: #953d00; --color-amber-900: #7b3306; --color-amber-950: #461901; --color-emerald-50: #ecfdf5; --color-emerald-100: #d0fae5; --color-emerald-200: #a4f4cf; --color-emerald-300: #5ee9b5; --color-emerald-400: #00d294; --color-emerald-500: #00bb7f; --color-emerald-600: #009767; --color-emerald-700: #007956; --color-emerald-800: #005f46; --color-emerald-900: #004e3b; --color-emerald-950: #002c22; --color-sky-50: #f0f9ff; --color-sky-100: #dff2fe; --color-sky-700: #0069a4; --color-sky-800: #005986; --color-blue-100: #dbeafe; --color-blue-700: #1447e6; --color-indigo-50: #eef2ff; --color-indigo-100: #e0e7ff; --color-indigo-200: #c7d2ff; --color-indigo-300: #a4b3ff; --color-indigo-400: #7d87ff; --color-indigo-500: #625fff; --color-indigo-600: #4f39f6; --color-indigo-700: #432dd7; --color-indigo-800: #372aac; --color-indigo-900: #312c85; --color-violet-100: #ede9fe; --color-violet-700: #7008e7; --color-rose-50: #fff1f2; --color-rose-100: #ffe4e6; --color-rose-200: #ffccd3; --color-rose-300: #ffa2ae; --color-rose-400: #ff667f; --color-rose-500: #ff2357; --color-rose-600: #e70044; --color-rose-700: #c20039; --color-rose-800: #a30037; --color-rose-900: #8b0836; --color-rose-950: #4d0218; --color-slate-50: #f8fafc; --color-slate-100: #f1f5f9; --color-slate-200: #e2e8f0; --color-slate-300: #cad5e2; --color-slate-400: #90a1b9; --color-slate-500: #62748e; --color-slate-600: #45556c; --color-slate-700: #314158; --color-slate-800: #1d293d; --color-slate-900: #0f172b; --color-slate-950: #020618; --color-black: #000; --color-white: #fff; --spacing: .25rem; --container-xs: 20rem; --container-sm: 24rem; --container-md: 28rem; --container-lg: 32rem; --container-xl: 36rem; --container-2xl: 42rem; --container-3xl: 48rem; --container-4xl: 56rem; --container-5xl: 64rem; --container-6xl: 72rem; --container-7xl: 80rem; --text-xs: .75rem; --text-xs--line-height: calc(1 / .75); --text-sm: .875rem; --text-sm--line-height: calc(1.25 / .875); --text-base: 1rem; --text-base--line-height: calc(1.5 / 1); --text-lg: 1.125rem; --text-lg--line-height: calc(1.75 / 1.125); --text-xl: 1.25rem; --text-xl--line-height: calc(1.75 / 1.25); --text-2xl: 1.5rem; --text-2xl--line-height: calc(2 / 1.5); --text-3xl: 1.875rem; --text-3xl--line-height: calc(2.25 / 1.875); --text-4xl: 2.25rem; --text-4xl--line-height: calc(2.5 / 2.25); --text-5xl: 3rem; --text-5xl--line-height: 1; --text-7xl: 4.5rem; --text-7xl--line-height: 1; --font-weight-normal: 400; --font-weight-medium: 500; --font-weight-semibold: 600; --font-weight-bold: 700; --font-weight-extrabold:800; --font-weight-black: 900; --tracking-tight: -.025em; --tracking-wide: .025em; --tracking-wider: .05em; --tracking-widest: .1em; --leading-tight: 1.25; --leading-snug: 1.375; --leading-relaxed: 1.625; --radius-md: .375rem; --radius-lg: .5rem; --radius-xl: .75rem; --radius-2xl: 1rem; --radius-3xl: 1.5rem; --ease-in: cubic-bezier(.4, 0, 1, 1); --ease-out: cubic-bezier(0, 0, .2, 1); --ease-in-out: cubic-bezier(.4, 0, .2, 1); --animate-spin: spin 1s linear infinite; --animate-pulse: pulse 2s cubic-bezier(.4, 0, .6, 1) infinite; --blur-sm: 8px; --default-transition-duration: .15s; --default-transition-timing-function: cubic-bezier(.4, 0, .2, 1); --default-mono-font-family: var(--font-mono);}}
@layer base{*{box-sizing: border-box; border: 0px solid; margin: 0px; padding: 0px;}}
@layer base{html{text-size-adjust: 100%; tab-size: 4; font-feature-settings: normal; font-variation-settings: normal; -webkit-tap-highlight-color: transparent; font-family: "Sporta Plex Arabic Local", "Plex Arabic Fallback", ibm-plex-arabic, system-ui, sans-serif; line-height: 1.5;}}
@layer base{h1,h2,h3{font-size: inherit; font-weight: inherit;}}
@layer base{a{color: inherit; text-decoration: inherit;}}
@layer base{ol,ul{list-style: none;}}
@layer base{img,svg{vertical-align: middle; display: block;}}
@layer base{img{max-width: 100%; height: auto;}}
@layer base{button{font: inherit; letter-spacing: inherit; color: inherit; opacity: 1; background-color: rgba(0, 0, 0, 0); border-radius: 0px;}}
@layer base{button{appearance: button;}}
@layer components{.btn{cursor: pointer; white-space: nowrap; border-radius: 9999px; justify-content: center; align-items: center; gap: 0.5rem; height: 3rem; padding: 0px 1.5rem; font-size: 0.95rem; font-weight: 700; line-height: 1; transition: transform 0.15s, background-color 0.2s, box-shadow 0.2s, color 0.2s; display: inline-flex;}}
@layer components{.btn-primary{background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); box-shadow: 0 8px 20px -8px hsl(var(--primary) / .6); font-weight: 800;}}
@layer components{.btn-ghost{background: 0px 0px; border: 1.5px solid;}}
@layer utilities{.pointer-events-none{pointer-events: none;}}
@layer utilities{.absolute{position: absolute;}}
@layer utilities{.relative{position: relative;}}
@layer utilities{.inset-0{inset: 0px;}}
@layer utilities{.inset-x-0{inset-inline: 0px;}}
@layer utilities{.start-2\.5{inset-inline-start: calc(var(--spacing) * 2.5);}}
@layer utilities{.end-2{inset-inline-end: calc(var(--spacing) * 2);}}
@layer utilities{.end-3{inset-inline-end: calc(var(--spacing) * 3);}}
@layer utilities{.top-1\/2{top: 50%;}}
@layer utilities{.top-2{top: calc(var(--spacing) * 2);}}
@layer utilities{.top-2\.5{top: calc(var(--spacing) * 2.5);}}
@layer utilities{.bottom-2{bottom: calc(var(--spacing) * 2);}}
@layer utilities{.bottom-3{bottom: calc(var(--spacing) * 3);}}
@layer utilities{.z-0{z-index: 0;}}
@layer utilities{.z-10{z-index: 10;}}
@layer utilities{.z-\[1\]{z-index: 1;}}
@layer utilities{.mx-auto{margin-inline: auto;}}
@layer utilities{.-my-1\.5{margin-block: calc(var(--spacing) * -1.5);}}
@layer utilities{.-my-2\.5{margin-block: calc(var(--spacing) * -2.5);}}
@layer utilities{.-my-3{margin-block: calc(var(--spacing) * -3);}}
@layer utilities{.mt-0\.5{margin-top: calc(var(--spacing) * .5);}}
@layer utilities{.mt-2{margin-top: calc(var(--spacing) * 2);}}
@layer utilities{.mt-2\.5{margin-top: calc(var(--spacing) * 2.5);}}
@layer utilities{.mt-3{margin-top: calc(var(--spacing) * 3);}}
@layer utilities{.mt-4{margin-top: calc(var(--spacing) * 4);}}
@layer utilities{.mt-6{margin-top: calc(var(--spacing) * 6);}}
@layer utilities{.mt-8{margin-top: calc(var(--spacing) * 8);}}
@layer utilities{.mt-16{margin-top: calc(var(--spacing) * 16);}}
@layer utilities{.mb-3{margin-bottom: calc(var(--spacing) * 3);}}
@layer utilities{.mb-6{margin-bottom: calc(var(--spacing) * 6);}}
@layer utilities{.line-clamp-2{-webkit-line-clamp: 2; -webkit-box-orient: vertical; display: -webkit-box; overflow: hidden;}}
@layer utilities{.block{display: block;}}
@layer utilities{.flex{display: flex;}}
@layer utilities{.grid{display: grid;}}
@layer utilities{.hidden{display: none;}}
@layer utilities{.inline-block{display: inline-block;}}
@layer utilities{.inline-flex{display: inline-flex;}}
@layer utilities{.aspect-\[4\/5\]{aspect-ratio: 4 / 5;}}
@layer utilities{.aspect-square{aspect-ratio: 1 / 1;}}
@layer utilities{.h-7{height: calc(var(--spacing) * 7);}}
@layer utilities{.h-10{height: calc(var(--spacing) * 10);}}
@layer utilities{.h-11{height: calc(var(--spacing) * 11);}}
@layer utilities{.h-\[calc\(4\.75rem\+var\(--sa-bottom\)\)\]{height: calc(4.75rem + var(--sa-bottom));}}
@layer utilities{.h-full{height: 100%;}}
@layer utilities{.min-h-10{min-height: calc(var(--spacing) * 10);}}
@layer utilities{.min-h-11{min-height: calc(var(--spacing) * 11);}}
@layer utilities{.min-h-screen{min-height: 100vh;}}
@layer utilities{.w-10{width: calc(var(--spacing) * 10);}}
@layer utilities{.w-11{width: calc(var(--spacing) * 11);}}
@layer utilities{.w-auto{width: auto;}}
@layer utilities{.w-full{width: 100%;}}
@layer utilities{.max-w-7xl{max-width: var(--container-7xl);}}
@layer utilities{.min-w-0{min-width: 0px;}}
@layer utilities{.min-w-11{min-width: calc(var(--spacing) * 11);}}
@layer utilities{.flex-1{flex: 1 1 0%;}}
@layer utilities{.shrink-0{flex-shrink: 0;}}
@layer utilities{.-translate-y-1\/2{--tw-translate-y: calc(calc(1 / 2 * 100%) * -1); translate: var(--tw-translate-x) var(--tw-translate-y);}}
@layer utilities{.cursor-not-allowed{cursor: not-allowed;}}
@layer utilities{.cursor-zoom-in{cursor: zoom-in;}}
@layer utilities{.touch-pan-y{--tw-pan-y: pan-y; touch-action: var(--tw-pan-x,) var(--tw-pan-y,) var(--tw-pinch-zoom,);}}
@layer utilities{.flex-col{flex-direction: column;}}
@layer utilities{.flex-wrap{flex-wrap: wrap;}}
@layer utilities{.place-items-center{place-items: center;}}
@layer utilities{.items-baseline{align-items: baseline;}}
@layer utilities{.items-center{align-items: center;}}
@layer utilities{.items-start{align-items: flex-start;}}
@layer utilities{.justify-between{justify-content: space-between;}}
@layer utilities{.justify-center{justify-content: center;}}
@layer utilities{.gap-1{gap: var(--spacing);}}
@layer utilities{.gap-1\.5{gap: calc(var(--spacing) * 1.5);}}
@layer utilities{.gap-2{gap: calc(var(--spacing) * 2);}}
@layer utilities{.gap-3{gap: calc(var(--spacing) * 3);}}
@layer utilities{.gap-4{gap: calc(var(--spacing) * 4);}}
@layer utilities{.gap-8{gap: calc(var(--spacing) * 8);}}
@layer utilities{:where(.space-y-2 > :not(:last-child)){--tw-space-y-reverse: 0; margin-block-start: calc(calc(var(--spacing) * 2) * var(--tw-space-y-reverse)); margin-block-end: calc(calc(var(--spacing) * 2) * calc(1 - var(--tw-space-y-reverse)));}}
@layer utilities{.gap-x-2{column-gap: calc(var(--spacing) * 2);}}
@layer utilities{.gap-y-1{row-gap: var(--spacing);}}
@layer utilities{.truncate{text-overflow: ellipsis; white-space: nowrap; overflow: hidden;}}
@layer utilities{.overflow-hidden{overflow: hidden;}}
@layer utilities{.rounded-2xl{border-radius: var(--radius-2xl);}}
@layer utilities{.rounded-full{border-radius: 2.14748e+09px;}}
@layer utilities{.rounded-lg{border-radius: var(--radius-lg);}}
@layer utilities{.rounded-xl{border-radius: var(--radius-xl);}}
@layer utilities{.border{border-style: var(--tw-border-style); border-width: 1px;}}
@layer utilities{.border-black\/10{border-color: rgba(0, 0, 0, 0.1);}}
@layer utilities{.border-slate-300{border-color: var(--color-slate-300);}}
@layer utilities{.bg-brand{background-color: var(--brand);}}
@layer utilities{.bg-ink\/85{background-color: lab(9.07333 -0.616573 -3.30487 / 0.85);}}
@layer utilities{.bg-slate-100{background-color: var(--color-slate-100);}}
@layer utilities{.bg-white{background-color: var(--color-white);}}
@layer utilities{.bg-white\/55{background-color: rgba(255, 255, 255, 0.55);}}
@layer utilities{.bg-white\/95{background-color: rgba(255, 255, 255, 0.95);}}
@layer utilities{.object-contain{object-fit: contain;}}
@layer utilities{.p-4{padding: calc(var(--spacing) * 4);}}
@layer utilities{.p-5{padding: calc(var(--spacing) * 5);}}
@layer utilities{.px-2{padding-inline: calc(var(--spacing) * 2);}}
@layer utilities{.px-3\.5{padding-inline: calc(var(--spacing) * 3.5);}}
@layer utilities{.px-4{padding-inline: calc(var(--spacing) * 4);}}
@layer utilities{.py-1{padding-block: var(--spacing);}}
@layer utilities{.py-1\.5{padding-block: calc(var(--spacing) * 1.5);}}
@layer utilities{.py-2\.5{padding-block: calc(var(--spacing) * 2.5);}}
@layer utilities{.py-3{padding-block: calc(var(--spacing) * 3);}}
@layer utilities{.py-6{padding-block: calc(var(--spacing) * 6);}}
@layer utilities{.pt-3{padding-top: calc(var(--spacing) * 3);}}
@layer utilities{.text-center{text-align: center;}}
@layer utilities{.text-start{text-align: start;}}
@layer utilities{.align-middle{vertical-align: middle;}}
@layer utilities{.font-display{font-family: "Sporta Alexandria Local", "Alexandria Fallback", alexandria, "Sporta Plex Arabic Local", "Plex Arabic Fallback", ibm-plex-arabic, sans-serif;}}
@layer utilities{.text-2xl{font-size: var(--text-2xl); line-height: var(--tw-leading,var(--text-2xl--line-height));}}
@layer utilities{.text-3xl{font-size: var(--text-3xl); line-height: var(--tw-leading,var(--text-3xl--line-height));}}
@layer utilities{.text-lg{font-size: var(--text-lg); line-height: var(--tw-leading,var(--text-lg--line-height));}}
@layer utilities{.text-sm{font-size: var(--text-sm); line-height: var(--tw-leading,var(--text-sm--line-height));}}
@layer utilities{.text-xs{font-size: var(--text-xs); line-height: var(--tw-leading,var(--text-xs--line-height));}}
@layer utilities{.text-\[1\.75rem\]{font-size: 1.75rem;}}
@layer utilities{.leading-relaxed{--tw-leading: var(--leading-relaxed); line-height: var(--leading-relaxed);}}
@layer utilities{.font-bold{--tw-font-weight: var(--font-weight-bold); font-weight: var(--font-weight-bold);}}
@layer utilities{.font-extrabold{--tw-font-weight: var(--font-weight-extrabold); font-weight: var(--font-weight-extrabold);}}
@layer utilities{.font-medium{--tw-font-weight: var(--font-weight-medium); font-weight: var(--font-weight-medium);}}
@layer utilities{.font-semibold{--tw-font-weight: var(--font-weight-semibold); font-weight: var(--font-weight-semibold);}}
@layer utilities{.tracking-wide{--tw-tracking: var(--tracking-wide); letter-spacing: var(--tracking-wide);}}
@layer utilities{.tracking-widest{--tw-tracking: var(--tracking-widest); letter-spacing: var(--tracking-widest);}}
@layer utilities{.text-brand{color: var(--brand);}}
@layer utilities{.text-ink{color: rgb(23, 26, 30);}}
@layer utilities{.text-slate-300{color: var(--color-slate-300);}}
@layer utilities{.text-slate-600{color: var(--color-slate-600);}}
@layer utilities{.text-slate-700{color: var(--color-slate-700);}}
@layer utilities{.text-slate-900{color: var(--color-slate-900);}}
@layer utilities{.text-white{color: var(--color-white);}}
@layer utilities{.uppercase{text-transform: uppercase;}}
@layer utilities{.tabular-nums{--tw-numeric-spacing: tabular-nums; font-variant-numeric: var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,);}}
@layer utilities{.line-through{text-decoration-line: line-through;}}
@layer utilities{.underline{text-decoration-line: underline;}}
@layer utilities{.decoration-slate-500\/70{text-decoration-color: rgba(98, 116, 142, 0.7);}}
@layer utilities{.underline-offset-2{text-underline-offset: 2px;}}
@layer utilities{.shadow-md{--tw-shadow: 0 4px 6px -1px var(--tw-shadow-color,#0000001a), 0 2px 4px -2px var(--tw-shadow-color,#0000001a); box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);}}
@layer utilities{.shadow-sm{--tw-shadow: 0 1px 3px 0 var(--tw-shadow-color,#0000001a), 0 1px 2px -1px var(--tw-shadow-color,#0000001a); box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);}}
@layer utilities{.backdrop-blur{--tw-backdrop-blur: blur(8px); backdrop-filter: var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,);}}
@layer utilities{.transition{transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to, opacity, box-shadow, transform, translate, scale, rotate, filter, -webkit-backdrop-filter, backdrop-filter, display, content-visibility, overlay, pointer-events; transition-timing-function: var(--tw-ease,var(--default-transition-timing-function)); transition-duration: var(--tw-duration,var(--default-transition-duration));}}
@layer utilities{.transition-transform{transition-property: transform, translate, scale, rotate; transition-timing-function: var(--tw-ease,var(--default-transition-timing-function)); transition-duration: var(--tw-duration,var(--default-transition-duration));}}
@layer utilities{.duration-700{--tw-duration: .7s; transition-duration: 0.7s;}}
@layer utilities{.ease-out{--tw-ease: var(--ease-out); transition-timing-function: var(--ease-out);}}
@layer utilities{.disabled\:cursor-not-allowed:disabled{cursor: not-allowed;}}
@layer utilities{.disabled\:opacity-35:disabled{opacity: 0.35;}}
@layer utilities{.disabled\:opacity-50:disabled{opacity: 0.5;}}
@layer utilities{@media (min-width: 48rem){.md\:hidden{display: none;}}}
@layer utilities{@media (min-width: 48rem){.md\:px-6{padding-inline: calc(var(--spacing) * 6);}}}
@layer utilities{@media (min-width: 48rem){.md\:py-10{padding-block: calc(var(--spacing) * 10);}}}
@layer utilities{@media (min-width: 64rem){.lg\:sticky{position: sticky;}}}
@layer utilities{@media (min-width: 64rem){.lg\:top-24{top: calc(var(--spacing) * 24);}}}
@layer utilities{@media (min-width: 64rem){.lg\:translate-y-1{--tw-translate-y: var(--spacing); translate: var(--tw-translate-x) var(--tw-translate-y);}}}
@layer utilities{@media (min-width: 64rem){.lg\:grid-cols-2{grid-template-columns: repeat(2, minmax(0px, 1fr));}}}
@layer utilities{@media (min-width: 64rem){.lg\:self-start{align-self: flex-start;}}}
@layer utilities{@media (min-width: 64rem){.lg\:opacity-0{opacity: 0;}}}
@layer utilities{:lang(ar),[dir="rtl"]{--tw-translate-x: -100%; translate: var(--tw-translate-x) var(--tw-translate-y);}}
@layer utilities{:lang(ar),[dir="rtl"]{--tw-translate-x: calc(1 / 2 * 100%); translate: var(--tw-translate-x) var(--tw-translate-y);}}
@layer utilities{:lang(ar),[dir="rtl"]{--tw-scale-x: calc(100% * -1); scale: var(--tw-scale-x) var(--tw-scale-y);}}
@layer utilities{:lang(ar),[dir="rtl"]{rotate: 0deg;}}
@layer utilities{:lang(ar),[dir="rtl"]{rotate: 180deg;}}
@layer utilities{:lang(ar),[dir="rtl"]{--tw-gradient-position: to left in oklab; background-image: linear-gradient(var(--tw-gradient-stops));}}
:root{--brand: #c76a42; --brand-bright: #d28a69; --brand-deep: #99452b; --ink: #171a1e; --text-primary: #171a1e; --canvas: #fff; --canvas-muted: #f6f7f8; --surface: #fff; --surface-raised: #fff; --line-soft: #171a1e13; --line: #171a1e21; --line-strong: #7b8793; --text-muted: #596571; --primary: 18.9 53.8% 61.8%; --primary-foreground: 210 13% 10%; --accent: 14.2 56.1% 38.4%; --accent-foreground: 0 0% 100%; --accent-text-light: 14.2 56.1% 38.4%; --accent-text-dark: 18.9 53.8% 61.8%; --accent-text: var(--accent-text-light); --on-brand: 210 13% 10%; --type-micro: .6875rem; --type-caption: .75rem; --type-body: .9375rem; --type-lead: 1rem;}
[dir="rtl"]{--type-micro: .75rem;}
.text-accent{color: hsl(var(--accent-text));}
:root{--html5-brand: var(--brand); --html5-brand-bright: var(--brand-bright); --html5-brand-dark: var(--brand-deep); --html5-ink: var(--ink); --html5-canvas: var(--canvas); --html5-surface: var(--surface); --html5-surface-muted: var(--canvas-muted);}
body{background-color: var(--html5-canvas); color: var(--html5-ink); -webkit-font-smoothing: antialiased; text-rendering: optimizelegibility;}
.product-grid-card{transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;}
.product-grid-card h3{transition: color 0.18s;}
.storefront-root main#main > section.mx-auto:not(.invoice){box-sizing: border-box; padding-inline-start: var(--shop-gutter-start,max(clamp(1rem, 3vw, 2.5rem), var(--sa-left,0px))); padding-inline-end: var(--shop-gutter-end,max(clamp(1rem, 3vw, 2.5rem), var(--sa-right,0px)));}
.storefront-root .product-grid{align-items: stretch; column-gap: var(--shop-grid-column-gap,clamp(.625rem, 1.5vw, 1.25rem)); row-gap: var(--shop-grid-row-gap,clamp(1.25rem, 2.4vw, 2rem)); grid-template-columns: repeat(2, minmax(0px, 1fr)); min-width: 0px;}
.storefront-root .product-grid > *{min-width: 0px;}
@media (min-width: 768px){.storefront-root .product-grid{grid-template-columns: repeat(3, minmax(0px, 1fr));}}
@media (min-width: 1024px){.storefront-root .product-grid{grid-template-columns: repeat(4, minmax(0px, 1fr));}}
.btn,.tap,button,a{-webkit-tap-highlight-color: transparent;}
@media (hover: hover) and (pointer: fine){.catalog-card-save,.catalog-card-add,.catalog-gallery-zoom{transition: transform 0.18s, color 0.18s, background-color 0.18s, border-color 0.18s, box-shadow 0.18s;}}
@media (hover: hover) and (pointer: fine){.catalog-card-save svg,.catalog-card-add svg,.catalog-gallery-zoom svg{transition: transform 0.18s;}}
@media (prefers-reduced-motion: reduce){.product-grid-card,.product-grid-card h3,.catalog-card-save,.catalog-card-add,.catalog-gallery-zoom,.catalog-card-save svg,.catalog-card-add svg,.catalog-gallery-zoom svg,.storefront-root .sporta-icon{transition: none;}}
.storefront-root{--shop-radius: .875rem; --shop-radius-lg: 1rem; --shop-radius-md: .75rem; --shop-border: var(--line); --shop-border-subtle: var(--line);}
.storefront-root{--shop-control-border: var(--line-strong); --shop-border-on-light: #171a1e1f; --shop-border-on-dark: #ffffff2e; --shop-divider-on-dark: #ffffff1f; --shop-shell-max: 80rem; --shop-shell-half: 40rem; --shop-gutter-start: max(clamp(1rem, 3vw, 2.5rem), var(--sa-left,0px)); --shop-gutter-end: max(clamp(1rem, 3vw, 2.5rem), var(--sa-right,0px)); --shop-section-space: clamp(1.125rem, 2.25vw, 2rem); --shop-grid-column-gap: clamp(.625rem, 1.5vw, 1.25rem); --shop-grid-row-gap: clamp(1.25rem, 2.4vw, 2rem);}
[dir="rtl"] .storefront-root{--shop-gutter-start: max(clamp(1rem, 3vw, 2.5rem), var(--sa-right,0px)); --shop-gutter-end: max(clamp(1rem, 3vw, 2.5rem), var(--sa-left,0px));}
.storefront-root .btn{box-shadow: none; border-radius: 0.75rem; font-size: 0.875rem;}
.storefront-root .btn-primary{background: var(--brand-bright); color: rgb(23, 26, 30);}
.storefront-root .btn-ghost{border: 1px solid var(--line);}
:root:not([data-theme="dark"]) .storefront-root .text-brand{color: var(--brand-deep);}
.storefront-root .sporta-icon{vertical-align: -0.125em; color: currentcolor; flex: 0 0 auto; transition: color 0.18s, transform 0.18s, opacity 0.18s; display: inline-block;}
.catalog-product-summary{text-align: start;}
html{scroll-behavior: smooth; text-size-adjust: 100%; font-size: clamp(16px, 15.5px + 0.104vw, 17px);}
body{color: var(--ink); background-color: var(--canvas); -webkit-font-smoothing: antialiased; text-rendering: optimizelegibility; font-family: var(--sporta-font-body-en,"Sporta Plex Arabic Local"), "Plex Arabic Fallback", "ibm-plex-arabic", system-ui, sans-serif; font-optical-sizing: auto; line-height: 1.6;}
[dir="rtl"] body{font-family: var(--sporta-font-body-ar,"Sporta Plex Arabic Local"), "Plex Arabic Fallback", "ibm-plex-arabic", system-ui, sans-serif;}
:root:not([data-theme="dark"]) body{background-color: var(--canvas);}
h1,h2,h3,.font-display{font-family: var(--sporta-font-display-en,"Sporta Alexandria Local"), "Alexandria Fallback", "alexandria", "Sporta Plex Arabic Local", "Plex Arabic Fallback", "ibm-plex-arabic", system-ui, sans-serif; letter-spacing: -0.018em; font-feature-settings: "kern", "liga"; text-wrap: balance; line-height: 1.14;}
p,li{text-wrap: pretty;}
[dir="rtl"] h1,[dir="rtl"] h2,[dir="rtl"] h3,[dir="rtl"] .font-display{font-family: var(--sporta-font-display-ar,"Sporta Alexandria Local"), "Alexandria Fallback", "Sporta Plex Arabic Local", "Plex Arabic Fallback", "alexandria", "ibm-plex-arabic", system-ui, sans-serif; letter-spacing: 0px; line-height: 1.3;}
[dir="rtl"] body{line-height: 1.75;}
[dir="rtl"] .text-xs{font-size: 0.8125rem;}
[dir="rtl"] .tracking-wide,[dir="rtl"] .tracking-widest,[dir="rtl"] .uppercase{letter-spacing: 0px !important;}
.tabular-nums{font-variant-numeric: tabular-nums;}
@media (prefers-reduced-motion: reduce){*{scroll-behavior: auto !important; transition-duration: 0.01ms !important; animation-duration: 0.01ms !important;}}
.price-card{color: hsl(var(--accent-text));}
:root{--sa-top: env(safe-area-inset-top,0px); --sa-right: env(safe-area-inset-right,0px); --sa-bottom: env(safe-area-inset-bottom,0px); --sa-left: env(safe-area-inset-left,0px);}
.safe-bottom{padding-bottom: calc(.75rem + var(--sa-bottom));}
@media (pointer: coarse){.btn,.tap{min-height: 44px;}}
@media (pointer: coarse){.tap{min-width: 44px;}}
.action-bar{z-index: 30; backdrop-filter: blur(12px); inset-inline: 0px; background: rgba(255, 255, 255, 0.92); border-top: 1px solid rgba(0, 0, 0, 0.08); position: fixed; bottom: 0px;}
:root{--sporta-accent-soft: #fff6f0; --sporta-accent-soft-strong: #f9e8de; --sporta-accent-border: #bd7c5b; --sporta-accent: var(--brand,#c76a42); --sporta-accent-deep: var(--brand-deep,#99452b); --sporta-accent-hover: #8f391b;}
`

const SECTION_AR = "<section class=\"catalog-product-page mx-auto max-w-7xl px-4 py-6 text-start md:px-6 md:py-10\"><nav aria-label=\"مسار التنقل\" class=\"catalog-breadcrumb mb-6 text-sm text-slate-600\"><ol class=\"flex flex-wrap items-center gap-1.5\"><li><a class=\"-my-2.5 inline-block py-2.5 hover:text-accent\" href=\"/\" data-discover=\"true\">الرئيسية</a></li><li aria-hidden=\"true\" class=\"text-slate-300\">/</li><li><a class=\"-my-2.5 inline-block py-2.5 hover:text-accent\" href=\"/shop\" data-discover=\"true\">المتجر</a></li><li aria-hidden=\"true\" class=\"text-slate-300\">/</li><li aria-current=\"page\" class=\"catalog-breadcrumb-current truncate font-semibold text-slate-700\">حقيبة ظهر كالياري كالتشو</li></ol></nav><div class=\"catalog-product-layout grid gap-8 lg:grid-cols-2\"><div class=\"catalog-product-visual min-w-0 lg:sticky lg:top-24 lg:self-start\"><div class=\"catalog-gallery\"><div class=\"relative\"><div role=\"button\" tabindex=\"0\" aria-label=\"حقيبة ظهر كالياري كالتشو — صورة 1 من 1\" class=\"catalog-gallery-stage group relative aspect-square cursor-zoom-in touch-pan-y overflow-hidden rounded-2xl\"><div class=\"catalog-gallery-track flex h-full w-full\" style=\"transform: translateX(0%); transition: transform 380ms cubic-bezier(0.22, 0.61, 0.36, 1);\"><img alt=\"حقيبة ظهر كالياري كالتشو\" width=\"600\" height=\"600\" fetchpriority=\"high\" loading=\"eager\" decoding=\"async\" draggable=\"false\" class=\"catalog-gallery-photo h-full w-full shrink-0 object-contain\" src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" style=\"transform: scale(1); transform-origin: center center;\"></div><span aria-hidden=\"true\" class=\"catalog-gallery-zoom pointer-events-none absolute bottom-3 end-3 grid h-10 w-10 place-items-center rounded-xl bg-white/95 text-lg font-semibold text-ink shadow-sm\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg></span></div></div></div></div><div class=\"catalog-product-summary min-w-0\"><p class=\"catalog-eyebrow\">سبورتا / جاهز لتمرينك</p><div class=\"flex items-start justify-between gap-4\"><h1 class=\"catalog-product-title min-w-0 flex-1 text-start text-3xl font-extrabold text-slate-900\">حقيبة ظهر كالياري كالتشو</h1><button type=\"button\" aria-pressed=\"false\" aria-label=\"أضف إلى المفضلة\" title=\"أضف إلى المفضلة\" class=\"tap mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition border-slate-300 text-slate-600 hover:border-brand hover:text-brand\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg></button></div><p class=\"catalog-product-description mt-3 text-lg leading-relaxed text-slate-600\">حقيبة ظهر كالياري كالتشو.</p><p class=\"catalog-product-price text-accent mt-6 flex items-baseline gap-3 font-display text-[1.75rem] font-bold tabular-nums\">‏4.000&nbsp;د.ك.‏</p><div class=\"campaign-brand-plate mt-4\"><div class=\"campaign-brand-plate__owner\"><img alt=\"Sporta Sports Wear\" width=\"132\" height=\"41\" class=\"h-7 w-auto\" src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\"></div><span class=\"campaign-brand-plate__authentic text-xs font-semibold text-slate-600\">أصلي · بيع سبورتا</span></div><div class=\"catalog-product-options mt-6 space-y-3\"><div id=\"product-size-options\" class=\"rounded-2xl border border-black/10 bg-white p-4\"><div class=\"mb-3 flex items-center justify-between gap-3\"><span class=\"text-sm font-bold text-slate-900\">المقاس</span><button type=\"button\" class=\"text-accent -my-3 inline-flex items-center gap-1.5 py-3 text-xs font-semibold underline underline-offset-2\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg>دليل المقاسات</button></div><div class=\"flex flex-wrap gap-2\" role=\"group\" aria-label=\"المقاس\"><button type=\"button\" aria-pressed=\"false\" disabled=\"\" title=\"المقاسات المشطوبة غير متوفرة في هذه القطعة.\" class=\"relative flex h-11 min-w-11 items-center justify-center rounded-xl border px-3.5 text-sm font-bold transition cursor-not-allowed border-black/10 bg-slate-100 text-slate-600\" data-sporta-nosize=\"\"><span class=\"line-through decoration-slate-500/70\">S</span></button><button type=\"button\" aria-pressed=\"false\" disabled=\"\" title=\"المقاسات المشطوبة غير متوفرة في هذه القطعة.\" class=\"relative flex h-11 min-w-11 items-center justify-center rounded-xl border px-3.5 text-sm font-bold transition cursor-not-allowed border-black/10 bg-slate-100 text-slate-600\" data-sporta-nosize=\"\"><span class=\"line-through decoration-slate-500/70\">M</span></button><button type=\"button\" aria-pressed=\"false\" disabled=\"\" title=\"المقاسات المشطوبة غير متوفرة في هذه القطعة.\" class=\"relative flex h-11 min-w-11 items-center justify-center rounded-xl border px-3.5 text-sm font-bold transition cursor-not-allowed border-black/10 bg-slate-100 text-slate-600\" data-sporta-nosize=\"\"><span class=\"line-through decoration-slate-500/70\">L</span></button><button type=\"button\" aria-pressed=\"false\" disabled=\"\" title=\"المقاسات المشطوبة غير متوفرة في هذه القطعة.\" class=\"relative flex h-11 min-w-11 items-center justify-center rounded-xl border px-3.5 text-sm font-bold transition cursor-not-allowed border-black/10 bg-slate-100 text-slate-600\" data-sporta-nosize=\"\"><span class=\"line-through decoration-slate-500/70\">XL</span></button><button type=\"button\" aria-pressed=\"false\" disabled=\"\" title=\"المقاسات المشطوبة غير متوفرة في هذه القطعة.\" class=\"relative flex h-11 min-w-11 items-center justify-center rounded-xl border px-3.5 text-sm font-bold transition cursor-not-allowed border-black/10 bg-slate-100 text-slate-600\" data-sporta-nosize=\"\"><span class=\"line-through decoration-slate-500/70\">2XL</span></button><button type=\"button\" aria-pressed=\"false\" disabled=\"\" title=\"المقاسات المشطوبة غير متوفرة في هذه القطعة.\" class=\"relative flex h-11 min-w-11 items-center justify-center rounded-xl border px-3.5 text-sm font-bold transition cursor-not-allowed border-black/10 bg-slate-100 text-slate-600\" data-sporta-nosize=\"\"><span class=\"line-through decoration-slate-500/70\">3XL</span></button><button type=\"button\" aria-pressed=\"false\" disabled=\"\" title=\"المقاسات المشطوبة غير متوفرة في هذه القطعة.\" class=\"relative flex h-11 min-w-11 items-center justify-center rounded-xl border px-3.5 text-sm font-bold transition cursor-not-allowed border-black/10 bg-slate-100 text-slate-600\" data-sporta-nosize=\"\"><span class=\"line-through decoration-slate-500/70\">4XL</span></button><button type=\"button\" aria-pressed=\"false\" disabled=\"\" title=\"المقاسات المشطوبة غير متوفرة في هذه القطعة.\" class=\"relative flex h-11 min-w-11 items-center justify-center rounded-xl border px-3.5 text-sm font-bold transition cursor-not-allowed border-black/10 bg-slate-100 text-slate-600\" data-sporta-nosize=\"\"><span class=\"line-through decoration-slate-500/70\">5XL</span></button><button type=\"button\" aria-pressed=\"false\" disabled=\"\" title=\"نفذت الكمية\" class=\"relative flex h-11 min-w-11 items-center justify-center rounded-xl border px-3.5 text-sm font-bold transition cursor-not-allowed border-black/10 bg-slate-100 text-slate-600\" data-sporta-one=\"\"><span class=\"line-through decoration-slate-500/70\">ONE</span></button></div><div class=\"mt-2 min-h-10\"></div><p class=\"mt-2.5 text-xs text-slate-600\">المقاسات المشطوبة غير متوفرة في هذه القطعة.</p></div></div><div class=\"product-purchase-row mt-6 flex flex-wrap items-center gap-3\"><div class=\"catalog-product-quantity flex items-center rounded-xl border border-slate-300 bg-white\"><button disabled=\"\" class=\"tap flex items-center justify-center px-4 text-slate-700 hover:text-brand disabled:cursor-not-allowed disabled:opacity-35\" aria-label=\"إنقاص الكمية\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg></button><span class=\"w-10 text-center font-semibold\" aria-live=\"polite\">1</span><button class=\"tap flex items-center justify-center px-4 text-slate-700 hover:text-brand disabled:cursor-not-allowed disabled:opacity-35\" aria-label=\"زيادة الكمية\" disabled=\"\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg></button></div><button class=\"btn btn-primary inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50\" disabled=\"\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg>نفذت الكمية</button><button class=\"product-buy-now-inline btn btn-ghost text-accentdisabled:cursor-not-allowed disabled:opacity-50\" disabled=\"\">اشترِ الآن</button></div><ul class=\"catalog-product-reassurance mt-8 space-y-2 rounded-2xl bg-white p-5 text-sm text-slate-600\"><li class=\"flex items-center gap-3\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle text-brand\" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg> التوصيل خلال ٢٤ ساعة · ١ د.ك</li><li class=\"flex items-center gap-3\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle text-brand\" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg> طرق الدفع المتاحة تظهر عند إتمام الشراء</li><li class=\"flex items-center gap-3\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle text-brand\" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg> طلب إرجاع خلال ١٤ يومًا</li></ul></div></div><div class=\"catalog-related mt-16\"><h2 class=\"mb-6 text-2xl font-extrabold text-slate-900\">أكمل إطلالتك</h2><div class=\"product-grid grid\"><article class=\"product-grid-card group flex min-w-0 flex-col\"><div class=\"catalog-card-image relative block aspect-[4/5] overflow-hidden\"><a class=\"absolute inset-0 block\" aria-label=\"حقيبة ظهر كالياري كالتشو — كحلي\" href=\"/product/cagliari-calcio-backpack-navy\" data-discover=\"true\"><span aria-hidden=\"true\" class=\"image-loading-skeleton absolute inset-0 z-0 \"></span><img alt=\"حقيبة ظهر كالياري كالتشو — كحلي\" loading=\"lazy\" decoding=\"async\" width=\"600\" height=\"750\" class=\"catalog-card-photo relative z-[1] h-full w-full object-contain transition-transform duration-700 ease-out group-hover:scale-[1.03]\" src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\"><span class=\"absolute inset-0 bg-white/55\" aria-hidden=\"true\"></span><span class=\"absolute inset-x-0 top-1/2 -translate-y-1/2 bg-ink/85 py-1.5 text-center text-xs font-bold uppercase tracking-widest text-white\">نفذت الكمية</span></a><button type=\"button\" aria-label=\"أضف إلى المفضلة\" aria-pressed=\"false\" class=\"catalog-card-save absolute end-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow-sm backdrop-blur transition hover:text-brand focus-visible:opacity-100 text-slate-600 lg:opacity-0 lg:group-hover:opacity-100\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"17\" height=\"17\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg></button><button type=\"button\" aria-label=\"نفذت الكمية — حقيبة ظهر كالياري كالتشو — كحلي\" class=\"catalog-card-add absolute bottom-2 end-2 z-10 flex h-11 w-11 items-center justify-center rounded-full shadow-md transition focus-visible:opacity-100 hidden\" disabled=\"\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg></button></div><div class=\"catalog-card-info flex flex-col gap-1 pt-3\"><a class=\"-my-1.5 block w-full py-1.5 transition group-hover:text-accent\" href=\"/product/cagliari-calcio-backpack-navy\" data-discover=\"true\"><h3 dir=\"auto\" class=\"catalog-card-name line-clamp-2 min-h-11 text-center text-sm font-medium text-slate-900\">حقيبة ظهر كالياري كالتشو — كحلي</h3></a><span class=\"price-card flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold tabular-nums\">‏9.000&nbsp;د.ك.‏</span></div></article><article class=\"product-grid-card group flex min-w-0 flex-col\"><div class=\"catalog-card-image relative block aspect-[4/5] overflow-hidden\"><a class=\"absolute inset-0 block\" aria-label=\"سويت شيرت كالياري كالتشو — كحلي\" href=\"/product/cagliari-calcio-sweatshirt-navy\" data-discover=\"true\"><span aria-hidden=\"true\" class=\"image-loading-skeleton absolute inset-0 z-0 is-hidden\"></span><img alt=\"سويت شيرت كالياري كالتشو — كحلي\" loading=\"lazy\" decoding=\"async\" width=\"600\" height=\"750\" class=\"catalog-card-photo relative z-[1] h-full w-full object-contain transition-transform duration-700 ease-out group-hover:scale-[1.03]\" src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\"><span class=\"catalog-card-badge absolute start-2.5 top-2.5 rounded-lg bg-brand px-2 py-1 text-xs font-bold uppercase tracking-wide text-ink\">الأكثر مبيعًا</span></a><button type=\"button\" aria-label=\"أضف إلى المفضلة\" aria-pressed=\"false\" class=\"catalog-card-save absolute end-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow-sm backdrop-blur transition hover:text-brand focus-visible:opacity-100 text-slate-600 lg:opacity-0 lg:group-hover:opacity-100\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"17\" height=\"17\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg></button><button type=\"button\" aria-label=\"اختر المقاس — سويت شيرت كالياري كالتشو — كحلي\" class=\"catalog-card-add absolute bottom-2 end-2 z-10 flex h-11 w-11 items-center justify-center rounded-full shadow-md transition focus-visible:opacity-100 bg-white/95 text-ink backdrop-blur hover:bg-brand hover:text-ink lg:translate-y-1 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg></button></div><div class=\"catalog-card-info flex flex-col gap-1 pt-3\"><a class=\"-my-1.5 block w-full py-1.5 transition group-hover:text-accent\" href=\"/product/cagliari-calcio-sweatshirt-navy\" data-discover=\"true\"><h3 dir=\"auto\" class=\"catalog-card-name line-clamp-2 min-h-11 text-center text-sm font-medium text-slate-900\">سويت شيرت كالياري كالتشو — كحلي</h3></a><span class=\"price-card flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold tabular-nums\">‏10.000&nbsp;د.ك.‏</span></div></article><article class=\"product-grid-card group flex min-w-0 flex-col\"><div class=\"catalog-card-image relative block aspect-[4/5] overflow-hidden\"><a class=\"absolute inset-0 block\" aria-label=\"تيشيرت تشيتاز رَغبي\" href=\"/product/cheetahs-rugby-t-shirt\" data-discover=\"true\"><span aria-hidden=\"true\" class=\"image-loading-skeleton absolute inset-0 z-0 \"></span><img alt=\"تيشيرت تشيتاز رَغبي\" loading=\"lazy\" decoding=\"async\" width=\"600\" height=\"750\" class=\"catalog-card-photo relative z-[1] h-full w-full object-contain transition-transform duration-700 ease-out group-hover:scale-[1.03]\" src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\"></a><button type=\"button\" aria-label=\"أضف إلى المفضلة\" aria-pressed=\"false\" class=\"catalog-card-save absolute end-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow-sm backdrop-blur transition hover:text-brand focus-visible:opacity-100 text-slate-600 lg:opacity-0 lg:group-hover:opacity-100\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"17\" height=\"17\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg></button><button type=\"button\" aria-label=\"اختر المقاس — تيشيرت تشيتاز رَغبي\" class=\"catalog-card-add absolute bottom-2 end-2 z-10 flex h-11 w-11 items-center justify-center rounded-full shadow-md transition focus-visible:opacity-100 bg-white/95 text-ink backdrop-blur hover:bg-brand hover:text-ink lg:translate-y-1 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg></button></div><div class=\"catalog-card-info flex flex-col gap-1 pt-3\"><a class=\"-my-1.5 block w-full py-1.5 transition group-hover:text-accent\" href=\"/product/cheetahs-rugby-t-shirt\" data-discover=\"true\"><h3 dir=\"auto\" class=\"catalog-card-name line-clamp-2 min-h-11 text-center text-sm font-medium text-slate-900\">تيشيرت تشيتاز رَغبي</h3></a><span class=\"price-card flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold tabular-nums\">‏8.000&nbsp;د.ك.‏</span></div></article><article class=\"product-grid-card group flex min-w-0 flex-col\"><div class=\"catalog-card-image relative block aspect-[4/5] overflow-hidden\"><a class=\"absolute inset-0 block\" aria-label=\"جاكيت كلاودسوفت — أخضر عسكري\" href=\"/product/cloudsoft-jacket-army-green\" data-discover=\"true\"><span aria-hidden=\"true\" class=\"image-loading-skeleton absolute inset-0 z-0 is-hidden\"></span><img alt=\"جاكيت كلاودسوفت — أخضر عسكري\" loading=\"lazy\" decoding=\"async\" width=\"600\" height=\"750\" class=\"catalog-card-photo relative z-[1] h-full w-full object-contain transition-transform duration-700 ease-out group-hover:scale-[1.03]\" src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\"></a><button type=\"button\" aria-label=\"أضف إلى المفضلة\" aria-pressed=\"false\" class=\"catalog-card-save absolute end-2 top-2 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow-sm backdrop-blur transition hover:text-brand focus-visible:opacity-100 text-slate-600 lg:opacity-0 lg:group-hover:opacity-100\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"17\" height=\"17\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg></button><button type=\"button\" aria-label=\"اختر المقاس — جاكيت كلاودسوفت — أخضر عسكري\" class=\"catalog-card-add absolute bottom-2 end-2 z-10 flex h-11 w-11 items-center justify-center rounded-full shadow-md transition focus-visible:opacity-100 bg-white/95 text-ink backdrop-blur hover:bg-brand hover:text-ink lg:translate-y-1 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.75\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"sporta-icon inline-block shrink-0 align-middle \" shape-rendering=\"geometricPrecision\" vector-effect=\"non-scaling-stroke\" aria-hidden=\"true\" focusable=\"false\"></svg></button></div><div class=\"catalog-card-info flex flex-col gap-1 pt-3\"><a class=\"-my-1.5 block w-full py-1.5 transition group-hover:text-accent\" href=\"/product/cloudsoft-jacket-army-green\" data-discover=\"true\"><h3 dir=\"auto\" class=\"catalog-card-name line-clamp-2 min-h-11 text-center text-sm font-medium text-slate-900\">جاكيت كلاودسوفت — أخضر عسكري</h3></a><span class=\"price-card flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold tabular-nums\">‏10.000&nbsp;د.ك.‏</span></div></article></div></div><div class=\"action-bar safe-bottom flex items-center justify-between gap-3 px-4 pt-3 md:hidden\"><span class=\"text-accent text-lg font-extrabold tabular-nums\">‏4.000&nbsp;د.ك.‏</span><button class=\"btn btn-primary flex-1 disabled:cursor-not-allowed disabled:opacity-50\" disabled=\"\">نفذت الكمية</button></div><div class=\"h-[calc(4.75rem+var(--sa-bottom))] md:hidden\" aria-hidden=\"true\"></div></section>"

const EN = [
  ['مسار التنقل', 'Breadcrumb'], ['الرئيسية', 'Home'], ['المتجر', 'Shop'],
  ['حقيبة ظهر كالياري كالتشو', 'Cagliari Calcio Backpack'], ['سبورتا / جاهز لتمرينك', 'Sporta / Ready to train'],
  ['دليل المقاسات', 'Size guide'], ['أصلي · بيع سبورتا', 'Authentic · sold by Sporta'],
  ['المقاسات المشطوبة غير متوفرة في هذه القطعة.', 'Struck-through sizes are not available.'],
  ['المقاس', 'Size'], ['نفذت الكمية', 'Sold out'], ['اشترِ الآن', 'Buy now'],
  ['أضف إلى المفضلة', 'Add to favourites'], ['أكمل إطلالتك', 'Complete the look'],
]
export const section = (lang, desc) => {
  let h = SECTION_AR
  if (lang === 'en') for (const [a, b] of EN) h = h.split(a).join(b)
  // the description is the one element the owner writes: swap it, escaped, keeping the live element
  return h.replace(/(<p class="catalog-product-description[^>]*>)[^<]*(<\/p>)/, (m, a, b) => a + String(desc).replace(/&/g, '&amp;').replace(/</g, '&lt;') + b)
}

// header / footer stand-ins: the live header is 96px tall at these widths and the footer is long; both only
// give the page the scroll range it has live.
export const page = (lang, desc, extraCss = '') => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" data-theme="light" style="color-scheme:light;--canvas:#ffffff;--brand:#c76a42;--brand-bright:#d28a69;--brand-deep:#99452b;--accent:14.2 56.1% 38.4%;--accent-text-light:14.2 56.1% 38.4%"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${LIVE}</style><style>${extraCss}</style></head><body><div class="storefront-root flex min-h-screen flex-col"><div style="height:96px"></div><main class="flex-1">${section(lang, desc)}</main><div style="height:320px"></div></div></body></html>`
export const DESC = {
  ar: 'حقيبة ظهر كالياري كالتشو.',
  en: 'Cagliari Calcio backpack.',
}
