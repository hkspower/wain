# Fonts audit, whole storefront - 2026-11-03

Read-only. Nothing was fixed, nothing was deployed. Every finding carries a ready fix; the fixes that fit the live
add-on files are one patch, `fonts-proposed.diff` (see "Proof of the patch"). Owner request: "check fonts all website".

What was audited: the live storefront **as captured** (compiled bundle, the 14 deployed add-on CSS and 9 JS files, the
captured `/api` JSON) served by a local mirror, because the Hostinger connector is signed out. Fonts come from the repo
`public/fonts`. Tool: `sporta-web/scripts/fonts-audit.mjs` (commit 3704a67f, GET only, one browser; `npm run audit:fonts`).

## 1. Result in five lines

- **The brand fonts are right.** 99.98% of all visible glyphs are drawn by Alexandria or IBM Plex Sans Arabic web fonts.
  Arabic and English use the same roles, forms inherit the page font, nothing is synthetic bold or italic, prices are tabular.
- **No high finding.** 32 findings after merging duplicates across the three lenses: 5 medium, 27 low. 10 further items were dropped as deliberate or not a defect (Appendix A).
- The 5 medium ones are all add-on CSS: sold-out band and badge hidden under the photo, Sporta AI panel left-to-right on
  Arabic pages, a grey strip from the closed bag drawer on every page, the promo bar cutting Arabic descenders from 640 px,
  and the Support page title at weight 400.
- First visit on a slow phone: the top bar, nav, buttons and prices change typeface 0.9-1.7 s after the first text
  (2 of 8 font files are preloaded). Clean swap, no layout jump. A small English-only fix is in the patch; Arabic needs the font files re-subset first.
- Needs the storefront rebuilt: symbols drawn by device fonts, two numeral systems in Arabic, AI input placeholder too long, and a few more (section 6).

## 2. Coverage

| What | Count |
|---|---|
| Routes and states in the tool catalogue | 35 measured + 2 stubs: `/`, `/shop`, `?brand=vanquish`, `?category=women`, product (plain, size chip picked, size guide open, sold-out), `/cart` (3 lines incl. KD 4.500, and empty), `/checkout` (full form; quick checkout with saved details), `/about` (and FAQ opened), `/contact`, `/wishlist` (3 saved, empty), `/track`, `/returns`, `/exchange`, `/terms`, `/privacy`, `/account`, `/support`, `/review`, `/payment/result`, `/invoice/SP000000`, 404, `/backends` sign-in, bag drawer open (with items, empty), Sporta AI panel open (`/`, product), language toggle (`/`, `/shop`), menu-open and search-open (stubs: the live build has neither control) |
| Languages | Arabic (bare URL, RTL) and English (`?lang=en`, LTR) on every state |
| Widths | tool: 390 and 1280. Other lenses: 320, 360, 430, 640, 768, 900, 1024, 1536 for the AI label, promo bar, nav, steps, drawer edge, placeholders (the 6 widths 320/360/430/768/1024/1536 were NOT run for the whole crawl) |
| Page-states in the tool crawl | **140** measured (35 x ar/en x 390/1280), 0 errored, + 8 stubs + 6 slow-network runs (1.6 Mbps, 150 ms, CPU 4x) |
| Text runs / glyphs | **9,813** runs (8,143 visible), 183,847 glyphs (171,678 visible), 2,054 controls on screen |
| Second census (rendered fonts) | 206 page-states (17 states x ar/en x 8 widths), 13,988 runs, 243,515 visible glyphs, + 60 special states (payment result paid/COD/failed, review, track results, quick checkout with an Arabic note, AI panel) |
| Third census (Arabic, admin, print, mail) | 66 states ar + 66 en, 3,958 Arabic elements; admin Overview/Orders/Catalogue (12 states, local fixture session); invoice screen and print, ar/en; 8 e-mail templates rendered |
| Loading lens | about 215 page loads, 42 of them throttled; fontTools on all 8 files; local Apache 2.4 with the repo `.htaccess` for headers |
| Verification | every finding was re-measured by a second agent on its own mirror (about 380 fresh page loads for the loading lens alone) |

### Fonts that drew glyphs (tool crawl, visible text)

| Font | Glyphs | Share |
|---|---|---|
| IBM Plex Sans Arabic Regular (web, brand) | 104,698 | 60.99% |
| IBM Plex Sans Arabic Bold (web, brand) | 33,846 | 19.72% |
| Alexandria, variable (web, brand) | 22,551 | 13.14% |
| IBM Plex Sans Arabic SemiBold (web, brand) | 10,547 | 6.14% |
| Inter Bold (system) | 16 | only the check mark U+2713, checkout step numbers |
| DejaVu Sans (system) | 12 | only the cross U+2715 (AI close button, payment-result icon) |
| Unifont Upper (system) | 8 | only the microphone U+1F399 in the AI panel |

Before the web fonts land, this machine draws Liberation Sans (Latin, digits) and DejaVu Sans (Arabic); a visitor's phone draws its own.
Adobe Fonts kits: blocked here, unmeasured (section 8).

### What is right (checked, no finding)

- **99.98%** of visible glyphs in brand web fonts; only **36 visible runs in 20 states** use anything else, all symbols (F1-04).
- **8 of 8** woff2 files valid (magic `wOF2`, tables intact); **10 of 10** `@font-face` rules present (8 brand + 2 metric fallbacks);
  **8 of 8** brand faces `font-display: swap`; the 2 fallback faces carry the exact numbers of the real fonts (Alexandria 96.8 / 25.1 / 0 %, Plex 108.5 / 41.5 / 0 %).
- **0 FOIT**: with every font request aborted, text stayed visible in 18 states. **0 layout shift from font swaps** in the 6 slow runs (CLS 0-0.0107, none attributed to fonts); document height delta 0 px on 6 of 6 states.
- **0 duplicate font fetches** and **0 console font/preload warnings** in 44 page-states (11 routes x ar/en x 390/1280, 404 included).
- **Roles identical in both languages**: 0 of 497 selectors at 390 and 0 of 527 at 1280 differ in family or weight. Alexandria = h1-h3, display, hero, product price, card names; Plex 400/600/700 = body, nav, buttons, badges, labels.
- **0 synthetic bold, 0 synthetic italic** in 12,864 Plex runs (one state aside, F2-02). The weights Plex lacks (500/750/800/850) all snap to a real face: 1,210 visible runs at 390/1280 in the tool crawl, **0 px** difference against forcing 700 (pixel test).
- **Forms**: 0 of 2,054 controls off the page font, 0 under 16 px (no iOS zoom on focus).
- **Prices**: 442 visible price runs, **0 non-tabular** (430 declare `tabular-nums`; the other 12 are Plex, whose digits are tabular by default). Alexandria's Western digits are proportional ("1" 12.0 vs "0" 22.6 units at 32 px), so the declaration is load-bearing.
- **Character coverage**: 0 uncovered letters, digits or punctuation in the bundle, add-ons, `index.html` and captured API JSON (94 / 58 / 38 / 40 distinct non-ASCII characters); every Arabic-script character the shop emits (67-75, depending on how ranges are counted) is in the shipped Arabic files, incl. tatweel, harakat, Arabic-Indic digits, `، ؛ ؟`.
- **Arabic joins intact**: of 3,391 visible Arabic runs, 0 justified, 0 hyphenated, 0 with word-spacing, 0 `break-all`, 0 per-letter spans. Arabic letter-spacing is reset by the RTL rules (28 runs non-zero, width change at most 1 px).
- **Headers** (local Apache, repo `.htaccess`): `font/woff2`, `Cache-Control: public, max-age=2592000, stale-while-revalidate=604800`, not re-compressed, `nosniff`, `CORP: same-origin`, `/fonts/` listing 403. No Google Fonts, no `@import`, no `data:` fonts.
- **Owner font setting is a closed set** (`plex`, `alexandria`, or a same-origin uploaded id), so no third-party font name can come from the admin.
- **No add-on overrides a font stack**: the 14 live CSS and 9 JS add-ons declare no `font-family` or `@font-face`.
- **Admin** (`/backends`): brand fonts load, controls inherit, money cells right-aligned with tabular figures. **Invoice print** embeds the fonts, prints dark ink on white at 9.2 pt or more. **E-mail** uses no web fonts (correct).
- English brand-strip fit guard (`sporta-features.js`): identical sizes with fonts late and early at 320, 360, 390, 430, 768, 1024 px (0 of 12 differ).

## 3. The font files

All eight are in `public/fonts/`, same origin, `font-display: swap`, 253,472 bytes in total. Families: `Sporta Alexandria Local` (variable) and `Sporta Plex Arabic Local` (static).
"Used" = page-states (of 70 per language in the tool crawl) that fetched the file. Preloaded = `boot.js` preloads it for the visitor's script before the CSS is parsed.

| File | Bytes | Weight | Script | Used ar | Used en | Preloaded |
|---|---|---|---|---|---|---|
| alexandria-var-arabic.woff2 | 31,348 | 100-900 (variable) | Arabic | 70 | 4 | ar yes |
| alexandria-var-latin.woff2 | 30,140 | 100-900 (variable) | Latin, digits, space | 70 | 70 | en yes |
| plex-400-arabic.woff2 | 42,848 | 400 | Arabic | 70 | 6 | ar yes |
| plex-400-latin.woff2 | 19,164 | 400 | Latin, digits, space | 70 | 70 | en yes |
| plex-600-arabic.woff2 | 45,688 | 600 | Arabic | 68 | 4 | no |
| plex-600-latin.woff2 | 20,500 | 600 | Latin, digits, space | 68 | 68 | no |
| plex-700-arabic.woff2 | 44,280 | 700 | Arabic | 68 | 38 | no |
| plex-700-latin.woff2 | 19,504 | 700 | Latin, digits, space | 70 | 70 | no |

- The Arabic default page fetches all 8 files (253,472 B); an English phone fetches 4 (89,308 B); English at 640 px or wider fetches 5 (133,588 B), the extra being `plex-700-arabic` for the Arabic AI label "سبورتا AI" (documented as deliberate, Appendix A).
- Arabic pages need the Latin files too: the Arabic subsets exclude U+0020, so every space, digit and full stop on an Arabic page comes from a Latin file.
- Latin range: U+0000-00FF and a few more (no U+2190/2192 arrows). Arabic range: U+0600-06FF, 0750-077F, 0870-08FF, FB50-FDFF, FE70-FEFC and the supplementary blocks.
- Metric fallbacks `Alexandria Fallback` / `Plex Arabic Fallback`: `local(Arial|Helvetica|Roboto|Liberation Sans|DejaVu Sans)` with ascent/descent/line-gap overrides.
- Adobe Fonts kits (`alexandria`, `ibm-plex-arabic`) sit after the local faces in every stack; nothing selects them (Appendix A).
- sha256 (first 16 hex), to compare against the live `/fonts` files: alexandria-var-arabic e8d8ca61d4da1a1a, alexandria-var-latin 98ccec0bc3c45633, plex-400-arabic 6010e7fd0dce5d52, plex-400-latin 9ed8dcb02e6c7246, plex-600-arabic 16734a5adb27b0f3, plex-600-latin 63f4757271e403f7, plex-700-arabic 04c730b4292731cc, plex-700-latin ae2d59f91ecf9f7e.

## 4. Findings, ranked

Severity is the verifier's. Where two lenses found the same cause, they are one finding (merged ids in brackets).
Confidence is high unless stated. Widths are CSS px. "Verified" = the proposed rule was injected on a mirror and re-measured.

| # | Id | Sev | Page / lang | One line | Fix kind |
|---|---|---|---|---|---|
| 1 | F2-01 | medium | every product card, ar+en | Sold-out band, its fade and the Bestseller badge are painted under the photo | addon-css |
| 2 | F3-01 | medium | Sporta AI panel, ar | Panel is left-to-right on an Arabic page; the full stop lands at the wrong end | addon-css |
| 3 | F3-06 | medium | every page, ar+en | Closed bag drawer leaks a grey shadow strip onto the page edge | addon-css |
| 4 | F3-02 [F2-15] | medium | promo bar, ar, 640 px and up | Overflow clips the Arabic descenders by 1.3-2.3 px | addon-css |
| 5 | F2-06 | medium | /support, ar+en | Page title is weight 400; every other page title is 800-900 | addon-css |
| 6 | F1-01 [F2-05] | low | every page, first visit | 2 of 8 font files preloaded; nav, buttons, prices swap typeface 0.9-1.7 s after first text | addon-js |
| 7 | M-F1-A | low | /about, ar, 320 | The late faces change the line count of the lead paragraph (one line, 30 px of page) | addon-css (untested) |
| 8 | F1-05 | low | every Arabic page | Arabic font files carry 77 kB nobody uses | owner-content |
| 9 | F1-04 [F2-08] | low | checkout steps, track, payment result, review, AI panel | ✓ ✕ ★ ⏱ 🎙 are drawn by the device's fonts | needs-storefront-rebuild |
| 10 | F1-06 | low | all, only if an uploaded font is chosen | An uploaded font lands after the headings and swaps twice (latent) | needs-storefront-rebuild |
| 11 | F1-07 | low | site-wide | No licence text shipped with the SIL OFL fonts | owner-content |
| 12 | F2-02 | low | quick checkout, saved note | Arabic note slanted by synthetic italic | addon-css |
| 13 | F2-03 | low | phone nav row, ar, 320-390 | Arabic nav is 12 px; Arabic gets 13 px elsewhere | addon-css |
| 14 | F2-04 | low | cart, checkout steps, ar, 320-379 | Step labels 11 px | addon-css |
| 15 | F2-07 | low | About FAQ, Terms, Privacy, Support at 1280 | 100-160 characters per line | addon-css (optional) |
| 16 | F2-14 [F3-10] | low | checkout notice, guest note, AI bubble, ar | Short Arabic paragraphs at line-height 1.38-1.43 | addon-css |
| 17 | F2-17 | low | checkout total, ar | Letter-spacing -0.025em on Arabic | addon-css |
| 18 | F2-18 | low | promo bar, en, 360-639 | English promo bar 11 px, Arabic 12 px | addon-css |
| 19 | F3-08 | low | checkout pay bar, ar, phones | Tashkeel cut 3.7 px in the "calculating total" text | addon-css |
| 20 | F3-09 | low | invoice with a discount, ar | Minus sign detached from the figure | addon-css |
| 21 | F3-13 | low | /backends order editor | `capitalize` on case-sensitive IDs | addon-css |
| 22 | F3-11 | low | /backends | English admin inherits Arabic RTL rules | needs-storefront-rebuild |
| 23 | F2-11 | low | all | 16-28 distinct font sizes per width | needs-storefront-rebuild |
| 24 | F3-04 [F2-16] | low | Arabic site | Two numeral systems on one screen | needs-storefront-rebuild |
| 25 | F3-07 [V-M1] | low | AI panel input, ar+en | Placeholder wider than its field | needs-storefront-rebuild |
| 26 | F3-15 | low | checkout address line, AI error text | ASCII comma; phone stored in visual order | needs-storefront-rebuild |
| 27 | F3-17 | low | headings, ar (latent) | Fallback face tried before Plex for Arabic | needs-storefront-rebuild |
| 28 | F3-03 | low | product names, ar+en | Em dash starts line 2 (54% of Arabic names at 390) | owner-content |
| 29 | F3-05 [F2V-M1] | low | every card while photos are null | Placeholder SVG text is 2-10 px and in Arial | owner-content |
| 30 | F3-14 [V-M2] | low | e-mail and CBK redirect page | Generic `sans-serif`, no `lang`, English-only reset mail, off-brand button | none (backend PHP release) |
| 31 | F3-16 | low | og-image | Text drawn in system fonts (unconfirmed live) | owner-content |
| 32 | F3-18 | low | manifest, offline page | English-only static files | owner-content |

### Medium

**F2-01 - sold-out band, fade and Bestseller badge are covered by the photo.** Pages: `/shop`, `/` best-sellers, `/wishlist`, "complete the look" (every card), ar+en, 320/390/1280 (same markup). 
Evidence: `img.catalog-card-photo` is `relative z-[1]`; the badge, band and fade are `position:absolute`, z-index auto. Pixel A/B: hiding the badge or the band changes **0 px**; hiding the photo changes 1,699-2,156 px. 14 of 2,552 text elements are covered (8 "Sold out", 6 "Bestseller"). The tool counted 28 "نفذت الكمية" and 27 "الأكثر مبيعًا" runs as visible; none is painted. 
Caveat: the 46 live products have `image=null`, so the cards show the placeholder SVG, which has an opaque `background:#f3f5f7!important` (sporta-cat-tiles.css) and covers the band. A real opaque 4:5 photo covers it the same way. 
Cause: compiled bundle. Fix (addon-css, `sporta-grid.css`, in the patch): `.catalog-card-image > a > span.absolute:not(.image-loading-skeleton){z-index:2}`; English badge `overflow:hidden;text-overflow:ellipsis;white-space:nowrap`; `padding-inline:.25rem` under 480 px. Verified (hit test at the centre of each element, 6 states): badge painted 0 -> 1 and sold-out band 0 -> 2 at 320, 390 and 1280 in ar and en, no horizontal scroll, hearts unchanged (22 of 24 hit-test on top, same before and after); screenshots show the dark badge pill at the top corner opposite the heart. The English badge still clips at 320 (needs 69 px, has 50). The first proposed badge rule (nowrap for both languages) truncated Arabic at 320 and is not used.

**F3-01 - Sporta AI panel is left-to-right on Arabic pages.** Pages: any page with the panel open (checked on `/` and a product), ar, 390/430/1024/1280. 
Evidence: `div[role=dialog]` computes `direction:ltr` on `html[dir=rtl]`; its ancestors `.navbar-tools` and `.navbar-main` set `direction:ltr`. The greeting bubble hugs the left edge (x 33-308 in a 16-374 panel at 390); the closing full stop of the Arabic reply sits right of its last word (x 283 vs 45 at 390; 1091 vs 890 at 1280), i.e. at the wrong end; the input is ltr; the header lock-up is reversed. Only the greeting renders without a POST, but every reply uses the same bubble. 
Cause: compiled CSS `.storefront-root .navbar-main{direction:ltr}`, panel rendered inside it. Fix (addon-css, `sporta-product-fix.css`, in the patch): `html[dir="rtl"] .navbar-tools div[role="dialog"] > *{direction:rtl}` (children only, so the panel box does not move). Verified at 390 and 1280 in the final proof, at 430 and 1024 by the verifier.

**F3-06 - the closed bag drawer's shadow bleeds onto the page edge, every page.** ar+en, 360/390/1280/1536. 
Evidence: `aside.campaign-cart-drawer[aria-hidden=true]` is parked off-canvas (x -W..0 in ar, W..2W in en) and keeps `shadow-2xl`. Red channel from the page edge on a white page, ar: 235, 238, 241, 246, 250, 253, 254, 255 over about 30 px (white = 255); mirrored on the right in English. 
Cause: compiled bundle. Fix (addon-css, `sporta-cart-drawer.css`, in the patch): `.campaign-cart-drawer[aria-hidden="true"]{box-shadow:none!important}`. Verified: edge columns become 255; the open drawer keeps its shadow. Found while screenshotting, not a font issue; likely also in the alignment audit.

**F3-02 [F2-15] - promo bar clips Arabic descenders from 640 px.** ar, 640-1536 (English about 0.7 px). 
Evidence: from 640 px the bar text has `line-height` 1.0 (12.1-12.75 px) and `overflow:hidden` (`truncate`). Pixel A/B at 3x: 5 rows (1.7 px) at 640, 6 (2.0 px) at 768, 4 (1.3 px) at 1024, 7 (2.3 px) at 1280; 0 under 640 px (line-height 1.25 there). The tails of ع ق ي و ص ل are flat-cut. One verifier rated it low (bottom 1-2 pixel rows); the other kept medium; shown as medium. 
Cause: compiled bundle (`topbar ... leading-none sm:text-xs` + `truncate`). Fix (addon-css, `sporta-brand-theme.css`, in the patch): `@media (min-width:640px){.topbar .truncate{line-height:1.5}}`. Verified: 0 differing rows at 768/1280/1536 in the final proof and at 640-1280 by the verifier; bar height unchanged (32.3-34 px).

**F2-06 - /support title is weight 400.** ar+en, 1280 (57.6 px) and 390 (30 px). 
Evidence: `h1.page-heading` with no `font-*` class falls to the body weight 400; About, Contact, Track, Terms, Privacy, Shop, Wishlist are 900; Cart and Checkout 800. Screenshot: thin headline next to bold ones. Cause: compiled bundle (Support chunk lacks `font-black`). Fix (addon-css, `sporta-brand-theme.css`, in the patch): `h1.page-heading:not([class*="font-"]){font-weight:900}` (scoped so Cart/Checkout keep 800). Verified: 400 -> 900, height unchanged (72 / 38 px).

### Low

**F1-01 [F2-05] - first visit over a slow link: top bar, nav, buttons, prices change typeface after the first text.** All pages, ar (worse) and en. 
Evidence: `boot.js` preloads `alexandria-var-S` and `plex-400-S` only. The first screen also needs Plex 600/700 (promo bar, nav, buttons, prices) and, on Arabic, the Latin files. Glyphs in a system font when only the preloaded files have landed (390): ar home 58%, shop 50%, product 76%; en 53 / 37.5 / 68% (tool slow pass: ar 201/284, 239/441, 221/276; en 222/352, 238/500, 243/315). At 1.6 Mbps / 150 ms / CPU 4x: Arabic 6 of 8 faces land after the first text, 1.6-1.8 s later; English 2 of 4, 0.76-1.1 s later. On a 12 Mbps profile the lag is 0.33-0.38 s (ar) and 0.16-0.20 s (en); with a warm cache about 30 ms. The swap is clean: 0 CLS from fonts, 0 px document height change, no FOIT. 
Cause: add-on `boot.js` (identical in repo and live). Fix (addon-js, in the patch, **English only**): low-priority preload of `plex-600-latin` and `plex-700-latin` (no extra bytes: the page fetches them anyway). **Arabic is deliberately not changed**: preloading the other six files delayed Arabic first text by +0.4 to +0.95 s at 1.6 Mbps (n = 12 interleaved pairs), and the "preload 600 and 700" variant by +0.5-0.8 s. Ship the Arabic version only together with F1-05 (then first text is 0.16 s earlier than live and 0 faces are late). Re-measure on the VPS before shipping; Chrome's throttle ignores `fetchpriority`. Confidence medium. 
Verifier note: the second lens (F2-05) judged this an intended trade-off of the "two files only" comment in `boot.js`; the cost is real but small and only on a first visit.

**M-F1-A - the swap is not always free: Arabic About at 320.** Two preloaded files vs all eight: page height 3,087 vs 3,057 px, the lead paragraph (inside the first screen) goes from 6 lines to 5, the promo bar from 4 to 3 line rects; at 390 one FAQ summary below the fold goes 2 -> 1 lines; no change at 360/430/768, and none on home, shop, product, cart. The test fallback (DejaVu Sans) is wider than most phones' Arabic fallback, so the size is probably exaggerated. Fix: F1-01 + F1-05 together so the faces land with the first text; or `size-adjust` on the two metric-fallback `@font-face` rules via an add-on `@font-face` (untested, not in the patch). Confidence low.

**F1-05 - Arabic font files are 77 kB heavier than the shop needs.** The Arabic Plex files carry 681 code points (all of U+0600-06FF, 196 + 140 presentation forms) that no shop text uses. Re-subset with the same layout features and hinting: plex-400-arabic 42,848 -> 19,420 B, plex-600 45,688 -> 20,508, plex-700 44,280 -> 19,984, alexandria-var-arabic 31,348 -> 27,132; **-77,120 B of 253,472 (30%)**; the Arabic preload pair 74,196 -> 46,552 B. Verified: all 67 Arabic-script characters the shop emits are in every subset; text-run geometry identical on 10 routes x 390/1280 (about 1,300 runs), 0 Arabic glyphs from a system font. Trade-off: Urdu, Pashto, Sindhi letters and presentation forms typed into owner content fall back to a system font. Fix (owner-content: binary files, not in the patch): `python -m fontTools.subset <file> --unicodes='U+0600-0605,U+060C,U+061B,U+061F,U+0620-0652,U+0653-065F,U+0660-066D,U+0670,U+0671,U+067E,U+0686,U+0698,U+06A4,U+06A9,U+06AF,U+06BE,U+06CC,U+06D2,U+06D5,U+06F0-06F9,U+200C-200F,U+FDFC,U+FEFB-FEFC' --layout-features='*' --flavor=woff2`, same file names, bump `VERSION` in `sw.js` (the service worker caches `/fonts/` cache-first), keep the 30-day HTTP cache in mind. Confidence medium.

**F1-04 [F2-08] - symbols drawn by the device.** U+2713 check, U+2715 cross, U+2605 star, U+23F1, U+25CF, U+25A0, U+2190/2192 and U+1F399/1F50A are in none of the 8 files. Checkout step numbers, track stepper, payment-result icon (48 px check), `/review` stars (36 px), AI panel buttons. Here: check = Inter Bold (16 glyphs), cross = DejaVu Sans (12), microphone = Unifont Upper (8), star = Inter, alarm clock = FreeSerif; 36 visible runs in 20 of 140 states. On phones the OS symbol or emoji font draws them, so size, weight and colour differ per device. Legible everywhere tested. Cause: literal characters used as icons in the bundle. Fix (needs-storefront-rebuild): inline SVG icons. Interim option (addon-css, new file, not in the patch): one `@font-face` per Plex weight 400/600/700 plus one for Alexandria with a `unicode-range` for these code points and a ~4 kB symbol subset the owner approves (mechanism proven with a test font; a single `font-weight:100 900` Plex face does not work). The clock and the two emoji need SVG.

**F1-06 - an uploaded font lands late and swaps twice (latent).** Today `theme.json` has defaults and `font_assets {}`, so live is unaffected. If the owner uploads a font in Theme > Fonts, the `--sporta-font-*` variable is written only after `/api?r=theme` returns, so headings paint in Alexandria, then change to the uploaded font about 0.6 s after first text on every load (simulated, 1.6 Mbps, n = 2; CLS stayed 0.011). The uploaded face has no metric fallback and no `unicode-range`, and the stack puts the Arial-based fallback before Plex for Arabic. Fix (needs-storefront-rebuild): cache the last theme fonts in `localStorage` and write the variables plus a preload in `boot.js` before first paint. Until then keep Plex/Alexandria. Not reached: the admin font upload routes (sign-in).

**F1-07 - no licence text with the fonts.** Both families are SIL OFL 1.1. nameID 0 (copyright) and nameID 14 (`http://scripts.sil.org/OFL`) are present in all 8 files; nameID 13 (licence text) is empty and no OFL text is shipped or linked. Fix (owner-content): add `public/fonts/OFL.txt` with the OFL 1.1 text and the two copyright lines ("The Alexandria Project Authors", "IBM Corp."); `.htaccess` does not block `.txt` there. Not in the patch (it needs the exact licence text from the font projects).

**F2-02 - synthetic italic on the saved order note.** Quick checkout (returning shopper, "Remember these details" on, a non-empty optional note), ar and en when the note is Arabic. `p.mt-2.text-sm.italic`: computed `font-style: italic`, `font-synthesis` allows style, no italic face declared, so Chrome slants the Arabic itself (screenshots before/after). It is the only `.italic` in 40 storefront chunks; the tool reported 0 because its seed note was empty. Fix (addon-css, `sporta-checkout-a11y.css`, in the patch): `.storefront-root .italic{font-style:normal}`. Verified in ar 390 and en 1280 in the final proof (en 360 by the verifier).

**F2-03 - Arabic phone nav is 12 px.** `a.navbar-link` in `.navbar-secondary`: 12.00 px at 320/360/390, 12.90 at 430, 13.68 from 640. Arabic gets a +1 step elsewhere, but the phone media rule has no RTL twin (85 runs per width set, Plex SemiBold). Fix (addon-css, `sporta-brand-theme.css`, in the patch): `@media(max-width:639px){:where([dir="rtl"]) .storefront-root .navbar-secondary .navbar-link{font-size:clamp(.8125rem,3.4vw,.875rem)}}` -> 13.00 / 13.00 / 13.26 / 14.00 px. Verified: one line per label, widest 42-46 px in 58-80 px boxes, header height unchanged (138 px). `:where()` is deliberate: the unreviewed sizes lane in HEAD (`sporta-bag-touch.css` [menu-4]) sets these tabs to 14 px at every width, and a plain `[dir="rtl"]` selector would have beaten it and cut Arabic back to 13 px; this form wins over the bundle by source order and loses to [menu-4]. If the sizes lane ships, F2-03 becomes redundant.

**F2-04 - step labels 11 px at 379 px and under, Arabic.** `.purchase-steps__body>span:last-child` on `/cart` and `/checkout` at 320-379: 11 px, 12 px from 380. Fix (addon-css, `sporta-checkout-a11y.css`, in the patch): `@media(max-width:379px){[dir="rtl"] .purchase-steps__body>span:last-child{font-size:.75rem}}`. Verified at 320/360/379: 12 px, one line each (26-40 px).

**F2-07 - lines of 100-160 characters (patch hunk is optional).** First full line at 16.8 px, 1280: About FAQ answer 160 ar / 136 en (column 1,068 px); Terms 103-138 ar / 94-108 en and Privacy 122-131 ar / 93-109 en (858 px); Support 104 / 98 (741 px); line-height 1.8-1.85. Mobile is fine (45-60). `/returns` was not measurable (route CSS missing from the capture). Fix (addon-css, `sporta-brand-theme.css`, in the patch, optional): `max-width:34rem` on the long-form paragraphs. Verified (572 px columns): About FAQ 86 ar / 67 en, Terms 75-92 / 55-71, Privacy 82-86 / 62-75, Support 84 / 75; the About lead paragraph (`.page-lead`, 121 / 100 characters) is not touched. Two costs, both measured: the section dividers keep their full width, so the text hugs the start edge of a wider rule, and **Terms is 343 px taller in Arabic (+10%) and 501 px in English (+14%) at 1280**. Skip it if the owner prefers the wide column. Confidence medium.

**F2-14 [F3-10] - short Arabic paragraphs at line-height 1.38-1.43.** `p.purchase-notice` 14 px / 1.43 (2 lines), `p.guest-note__body` 1.38 (3-4 lines), the AI chat bubble 1.43, the footer legal lines 13 px / 1.33. Body copy elsewhere is 1.75-1.85. Nothing collides or clips; Plex Arabic's content area is 1.5 em. Display headings and card names are deliberate and not touched. Fix (addon-css, in the patch): line-height 1.65 on the notice, guest note and AI bubble (`sporta-checkout-a11y.css`, `sporta-product-fix.css`). Page height +9 px on `/` and +14 px on `/checkout` at 390. The footer lines are left out; add `footer p.text-xs` to include them.

**F2-17 - negative letter-spacing on the Arabic checkout total.** `.purchase-checkout-summary .purchase-total .text-accent` has -0.025em (-0.54 px at 390, -0.64 px at 1280) with no RTL twin, also on the "جارٍ حساب الإجمالي…" text. Every other tracking class is reset for Arabic. Fix (addon-css, `sporta-checkout-a11y.css`, in the patch): `[dir="rtl"] .purchase-checkout-summary .purchase-total .text-accent{letter-spacing:0}`. Verified: normal at 390 and 1280.

**F2-18 - English promo bar is 11 px.** `--type-micro` is .6875rem in English, .75rem in Arabic: 11 px at 320-639 vs 12 px. Raising the variable globally breaks the English badge and truncates the bar at 320. Fix (addon-css, `sporta-brand-theme.css`, in the patch): `@media(min-width:360px) and (max-width:639px){html:lang(en) .topbar{font-size:.75rem}}`. Verified: 12 px at 360/375/390/430/600, not truncated, bar height 32 px; 320 untouched. HEAD's sizes lane ([menu-1]) sets the same 12 px at every phone width, so this becomes redundant if that ships.

**F3-08 - tashkeel cut in the pay bar "calculating total" text.** `/checkout`, ar, 360/390/430 (phone bar only). `.purchase-paybar p.truncate` is `overflow:hidden` in a 28 px line box: the kasratan under ر is cut by **3.7 px** (pixel proof at 3x). Transient: only while the quote request is pending or failing. Fix (addon-css, `sporta-checkout-a11y.css`, in the patch): `.purchase-paybar p.truncate{padding-block-end:.3em;margin-block-end:-.3em}`. Verified: 3 differing rows -> 0, bar height unchanged (69 px).

**F3-09 - invoice discount minus detached from the figure (Arabic).** The cell is `td[dir=ltr]` holding minus, RLM, number, NBSP, "د.ك.": visual order is minus, currency, figure (minus at x 118, figure 152-179 at 794 print). Only when an order has a discount. Fix (addon-css, `sporta-product-fix.css`, in the patch): `html[dir="rtl"] .invoice tfoot td[dir="ltr"]{direction:rtl}`. Verified: figure 49-77, currency 23-40, minus 85 (adjacent to the figure); English unchanged.

**F3-11 - the English admin inherits Arabic RTL rules.** `boot.js` applies the storefront language rule to `/backends`, so the root is `lang=ar dir=rtl` unless English was saved. Compiled `[dir=rtl]` rules then reach the English admin: h1 letter-spacing normal vs -0.341 px, line-height 24.6 vs 21.6 px (1280); small text 13.68 vs 12.62 px (reproduced on the mirror's `/backends` panel). Cosmetic. Fix: needs-storefront-rebuild (the admin should not take the storefront's language). **A boot.js-only fix was tried and does not hold, so it is not in the patch:** forcing `root.lang='en'; root.dir='ltr'` on `/backends` is applied at 122 ms and overwritten by the app at 580 ms (`ar/rtl` again). Also setting `window.__SPORTA_LANG='en'` keeps it, but that global seeds the app's language for the whole page session, so a later in-app click from the admin to the storefront would render English, against the Arabic-default rule.

**F3-13 - `capitalize` on case-sensitive IDs in the order editor.** The Field component puts `capitalize` on every value, including the mono bank payment ID and reference: "ab12cd" would show "Ab12cd" (numeric IDs are unaffected). Fix (addon-css, `sporta-admin-knet.css`, in the patch): `.admin-shell p.font-mono.capitalize{text-transform:none!important}`. Verified: none on all three fields.

**F2-11 - type scale.** 16-28 distinct font sizes per width (390: 22 ar / 23 en; 1280: 26 / 28); size+weight+family combinations 43-64. Near-duplicates at 390: 12 / 12.8 / 13 / 13.12 / 13.6; 14 / 14.4 / 15 / 15.2; 20 / 20.8 / 21.6 / 22; 26 / 26.4 / 28; 30 / 30.4 / 30.42 px (the root is fluid, 16-17 px). No visible defect. Fix (needs-storefront-rebuild): one scale (for example 12 / 13 / 14 / 15 / 16 / 18 / 20 / 24 / 30 / 38 / 48 / 58).

**F3-04 [F2-16] - two numeral systems in the Arabic UI.** 33 ar states: 102 distinct runs with Arabic-Indic digits, 135 with Western. One cart screen shows steps ١ ٢ ٣ ٤ next to "4 قطع" and "5.000 د.ك."; the delivery fee is "١ د.ك" (top bar, About, product) and "بـ 1 د.ك" (home features); the About FAQ mixes "١٤ يومًا" with "+965 2209 1914"; "٪" vs "%"; "د.ك" vs "د.ك." Partly by convention (`src/lib/format.js`: Latin digits so prices stay scannable; `test:arabic` checks mixing inside one sentence only). Arabic-Indic digits are proportional in both brand fonts, so `tabular-nums` cannot align them (none sits in a column today). Fix (needs-storefront-rebuild, owner picks first): Western digits everywhere (matches money, phones, dates, invoice): make the four converters return `String(n)`, replace Arabic-Indic digits and ٪ in the ar strings, extend `test:arabic` to fail on two systems in one page. Confidence medium.

**F3-07 [V-M1] - Sporta AI input placeholder is wider than its field.** ar "اسأل عن طلبك أو التوصيل أو الإرجاع…" is 231.7 px against a content width of 111 / 151 / 181 / 207 / 212 px at 320 / 360 / 390 / 430 / 768 (over by 120 / 80 / 50 / 24 / 24); English "Ask about an order, delivery, returns…" is 271.5 px (over by 161 / 121 / 91 / 65 / 67; cut mid-word at 390). `text-overflow:ellipsis` draws none on an input. A 22-character Arabic string (173.8 px) fits at 390 only. Fix (needs-storefront-rebuild): shorten both strings (for example "اسأل عن طلبك…", "Ask about your order…"); below 360 let the mic and send buttons wrap under the field.

**F3-15 - punctuation in compiled copy.** The address line is `[area, governorate].join(', ')` with an ASCII comma ("Sharq, العاصمة"; Arabic needs "، "), and the area is stored in whichever language the shopper saved. The AI failure text is stored in visual order, "اتصل بنا على 22091914 965+.": right only inside an RTL paragraph, and the panel is LTR today (the F3-01 fix corrects the display); copy or a screen reader gets the reversed number. Fix (needs-storefront-rebuild): join with "، " when ar, store the area by key, write the phone as in Contact (LRM + "+965 2209 1914").

**F3-17 - fallback face before Plex in Arabic heading stacks (latent).** Stack: Alexandria, Alexandria Fallback, Plex, Plex Arabic Fallback, alexandria, ibm-plex-arabic, system-ui; the two fallback faces have no `unicode-range`. On Windows, macOS and iOS, `local(Arial)` has Arabic, so a glyph the Alexandria subset lacks (U+FDFC, U+FDFA, U+06D5 and others) would be drawn in Arial before Plex. Every character the shop uses is already in the Alexandria Arabic subset, so nothing falls through today. Fix (needs-storefront-rebuild): give the two fallback faces `unicode-range:U+0000-024F,U+2000-206F`, or move Plex ahead of them. Not demonstrated on those devices. Confidence low.

**F3-03 - the em dash starts line 2 of product names.** 43 of 46 live names are "Model - Colour" with a plain space before the dash, in name_ar and name_en. A break before the dash is allowed, so it leads line 2: ar@390 62 of 115 occurrences (54%), en@390 31 of 47 (66%), ar@1280 16 of 115 (14%). Example: "Cloudsoft Jacket" / "- Army Green". Fix (owner-content): put a no-break space before the dash (U+00A0, dash, normal space) in the 43 names, in the Catalogue editor or one `REPLACE`. At 390 and wider the dash then leads 0 of 10 cards. **At 360 the three Cloudsoft Leggings cards go to three lines and the colour is cut by `line-clamp-2`**, so shorten those three names or accept it. No add-on can forbid a break before one character.

**F3-05 [F2V-M1] - the placeholder picture has 2-10 px Arial text.** All 46 live products have `image=null`, so every card, cart line and bag thumbnail shows `/product-photo-unavailable.svg`, whose three `<text>` lines are Arial in a 600 x 750 viewBox (SPORTA 24, Arabic 20, English 16 units). Rendered: shop grid 3.2-4.9 px at 320, 4.2-6.3 at 390, 7.1-10.6 at 1280; product page 4-12 px (up to 18 at 1280); cart and bag thumbnails 1.5-2.7 px. An SVG used as an `<img>` cannot load web fonts, so it is the device's Arial. The file on the mirror has the same hash as live. Fix (owner-content): real product photos remove it (the known launch gap). Until then replace the file at the same URL with a text-free version; `brand/icons-polish/product-photo-unavailable.svg` is a ready drop-in (camera badge and orange rule, no copy). The live copy is server-only, so it needs a deploy job. Not in the patch (not an add-on).

**F3-14 [V-M2] - e-mail and the CBK redirect page.** Backend PHP, not the add-on layer. `font-family:sans-serif` alone in the payment, cancel and picking-list mails (`cron-fulfilment.php` 320/336/377), `php-cbk/pay.php:153`, `setup-admin.php:55`; `Arial,sans-serif` in the customer reset (`customer.php:157`), admin code alert (`store.php:1832`), admin reset (`admin.php:259`), birthday (`cron-birthday.php:71`). Arabic blocks have `dir=rtl` but no `lang=ar`. The customer reset mail is English-only although Arabic is the default; its button is `#99452b` on white, not the brand (the birthday mail uses `#e0561c` with `#171a1e`); the birthday ISO date prints as `2026-11-17` in the English paragraph but `17-11-2026` in the Arabic one; `pay.php` is English-only with no `lang`/`dir`. No web fonts anywhere (correct for mail). Fix: one backend PHP release, behind the usual review gate: `Arial,Helvetica,sans-serif`, `lang="ar"` on every RTL block, an Arabic half in the reset mail, brand button colours, `<bdi dir="ltr">` around the date.

**F3-16 - og-image text is drawn in system fonts.** The Arabic tagline matches DejaVu Sans / a system sans (shape distance 0.21) far better than Plex Arabic (0.33) or Alexandria (0.38-0.40); the orange Latin line matches Arial Bold. English-only text shared by Arabic pages. **Unconfirmed live:** the capture has no og-image, so this is the repo file. Fix (owner-content): when the image is next regenerated, set the Arabic line in IBM Plex Sans Arabic or Alexandria and add the Arabic delivery line.

**F3-18 - static files outside the app.** Live `site.webmanifest`: `lang "en"`, `dir "auto"`, shortcuts "Shop" and "Track order" only, on an Arabic-default site. `backends-offline.html/css` (repo copy; the live files are server-only): system fonts only (correct for an offline shell), English only, the logo mark a text "S". Fix (owner-content): bilingual shortcut names ("Shop / المتجر", "Track order / تتبع الطلب"); optional favicon S mark in the offline page.

## 5. Fixable through the live add-on files / `.htaccess`

Everything here is in `fonts-proposed.diff`, apart from the items listed below the table as "not in the patch". **No `.htaccess` change is needed for fonts**: the font headers and cache tier are right.

| File (live add-on) | Findings | Added lines |
|---|---|---|
| `boot.js` | F1-01 (English only) | 19 |
| `sporta-brand-theme.css` | F2-06, F2-03, F2-07 (optional), F2-18, F3-02 | 43 |
| `sporta-grid.css` | F2-01 | 20 |
| `sporta-checkout-a11y.css` | F2-02, F2-04, F2-14, F2-17, F3-08 | 35 |
| `sporta-product-fix.css` | F3-01, F3-10 (AI bubble leading), F3-09 | 18 |
| `sporta-cart-drawer.css` | F3-06 | 7 |
| `sporta-admin-knet.css` | F3-13 | 6 |

Not in the patch: M-F1-A (size-adjust, untested), F1-04 interim symbol font (needs an owner-approved font file), F3-11 (a boot.js-only fix is overwritten by the app, see its entry). F2-07 is in the patch but optional (it makes Terms 10-14% taller at 1280).
All hunks are appends at the end of their file (the patch generator and the proof assert it), so they do not depend on what is above them.
**Deploy note:** the patch is written against git HEAD (proven on 64caea72; the seven patched files are byte-identical at a98dc9c9, where `git apply --check` also passes). The live add-on CSS is not HEAD's: all 14 differ, because the sizes lanes (unreviewed work, commit messages say "do not deploy") have edited the repo copies. So **do not ship HEAD's whole files for these seven names** until the sizes lanes are reviewed; ship only the added blocks, appended to the files as they are live today (that is what proof tree A does). `boot.js` is byte-identical in repo and live, so its hunks apply as they are. The proof runs the same blocks on both: on the live copies (what is served today) and on the HEAD copies (what will be served once the sizes lanes ship). Deploy with the existing `vps-deploy.mjs` flow (add-on file names, plan first). Nothing here touches the money path.

## 6. Needs the storefront rebuilt

F1-04 (symbols as SVG), F1-06 (cache the theme fonts before first paint), F3-11 (admin keeps its own language), F2-11 (one type scale), F3-04 (one numeral system, owner picks first), F3-07 (shorter AI placeholders), F3-15 (comma, stored phone order), F3-17 (fallback face `unicode-range`). The live `index.html` and bundle are a different build whose source is missing from this repo, so these wait for the rebuilt storefront and `vps-deploy.mjs --replace-storefront`, which the owner has to ask for.

## 7. Owner setting or content

- **F3-03** product names: NBSP before the em dash in 43 names (check the three Leggings at 360 px).
- **F3-05** real product photos, or the text-free placeholder SVG through a deploy job.
- **F1-05** re-subset the four Arabic font files (same names, bump `sw.js` VERSION); pair with the Arabic half of F1-01.
- **F1-07** add `public/fonts/OFL.txt`.
- **F3-16** og-image regenerated with brand fonts; **F3-18** manifest shortcut names.
- **F3-14** one backend PHP release for mail and the CBK page (review gate applies).
- Owner decisions, not defects: keep the Arabic AI name in English (Appendix A), keep or drop the Adobe Fonts kits (Appendix A), which numeral system Arabic uses (F3-04).

## 8. Proof of the patch

**Method.** Nothing in the repo was touched. `build-mirrors.py` made four scratch copies of the mirror:

| Tree | What it is |
|---|---|
| A-before | the captured live files, untouched |
| A-after | A-before + the patch's added lines. All 6 CSS hunks are pure appends at the end of their file (asserted); `boot.js` is byte-identical to HEAD's, so its hunk goes in with `git apply` |
| B-before | the captured live storefront with the 22 add-ons the live `index.html` links replaced by git HEAD 64caea72's versions (what is served once the sizes lanes ship) |
| B-after | B-before + the whole patch applied with `git apply` to those HEAD files |

`git apply --check` passes on HEAD; the file contents it produces are byte-identical to the generator's. Then `fonts-audit.mjs` was re-run over the affected pages and compared run by run (same selector and text): **106 states** on A (19 states x ar/en x 390/1280, and 5 states x ar/en x 320/360/768), **32 states** on B (8 states x ar/en x 390/1280), 0 errored, plus 12 pixel and DOM probes, 72 regression page loads, and the slow-network pass 6 states x 2 repetitions x before/after (24 runs).

**Tool, live-copy trees (A), 6,736 matched visible runs.** Visible runs 4,757 -> 4,757 and 2,030 -> 2,030. Flags before -> after: F-AR-LEADING 73 -> 66 (390/1280) and 71 -> 66 (320/360/768); F-AR-SPACING 2 -> 0 and 3 -> 0; F-SMALL 600 / 391, F-WEIGHT 690 / 385, F-NONBRAND 32 / 6, F-AR-UPPER 35 / 18, F-MIXED-DIGITS 2 are unchanged (the nav went 12 -> 13 px, still under the tool's 14 px phone line). Computed-style changes: 58 groups on 22 distinct selectors, **every one traced to a patched finding** and nothing else (property changes counted: nav links 530, promo bar 115, step labels 48, legal and FAQ paragraphs, `h1.page-heading` on Support 20, purchase notice 11, guest note 9, total 8, AI bubble 8). Document height changes (15, all explained): FAQ +136 / +164, Terms +343 / +501, Privacy +407 / +467 (F2-07), checkout +18 at 390, +19 at 320 and 360, +11 at 768, +8 at 1280, quick checkout +3 / +7, cart +1 at 320/360 (F2-14, F2-04).

**Tool, HEAD trees (B), 2,171 matched visible runs.** Same groups, nothing new: F2-03 leaves the tabs at HEAD's 14 px (14 -> 14, because of the `:where()` form), F2-18 is 12 -> 12 (HEAD already does it), F3-02 line-height 12.6 -> 18.9 px, F2-06 400 -> 900, F2-14 / F3-10 / F2-17 as on A. F-AR-LEADING 43 -> 39, F-AR-SPACING 2 -> 0, everything else equal.

**Per finding, before -> after** (probes on A; 6 widths-and-languages unless stated):

| Finding | Measure | Before | After |
|---|---|---|---|
| F2-01 | hit test at the centre: Bestseller badge painted / sold-out bands painted (320, 390, 1280, ar and en) | 0 / 0 in every state | 1 / 2 in every state; hearts unchanged (22 of 24 on top), no horizontal scroll |
| F3-01 | AI panel children direction; bubble gap left / right at 390; is the full stop the leftmost glyph of its line | ltr; 17 / 66 px; no | rtl; 66 / 17 px; yes. Panel box unchanged (16-374; 859-1263); English unchanged |
| F3-06 | red channel at the page edge, 7 columns (ar and en, 390 and 1280); open drawer | 235, 239, 243, 246, 248, 252, 254 | 255 in all 7; closed drawer `box-shadow: none`; the open drawer's shadow is the same string as before |
| F3-02 | rows of Arabic ink clipped at 768 / 1280 / 1536 (English 1280); bar height | 2 / 3 / 3 rows (52 / 57 / 59 px; English 1 row, 6 px); 32.6 / 33.7 / 34 | 0 rows in all; bar height 32.6 / 33.7 / 34 (unchanged); 390 was already 0 |
| F2-06 | h1 weight: Support / About, Contact, Terms, Track, Shop, Wishlist / Cart, Checkout | 400 / 900 / 800 | 900 / 900 / 800 (ar and en) |
| F2-03 | Arabic nav font at 320 / 360 / 390; label width; English | 12 / 12 / 12 px; 38 px; 12 | 13 / 13 / 13.26 px; 41-42 px; one line each; English still 12; on HEAD trees 14 -> 14 |
| F2-04 | Arabic step label at 320 / 360 | 11 px | 12 px, one line; English unchanged |
| F2-18 | English promo bar at 360 / 390 | 11 px (272 px wide at 390) | 12 px (297 px wide), one line; Arabic unchanged; HEAD trees 12 -> 12 |
| F2-17 | checkout total letter-spacing, ar 390 / 1280 | -0.54 / -0.64 px | normal; width +2 px at 320-390 |
| F2-14, F3-10 | line-height of notice / guest note / AI bubble, ar 390 | 20 / 19.25 / 20 px | 23.1 px each (1.65); heights +3 / +7 / +3 px; English bubble unchanged (20) |
| F2-02 | saved note `font-style` (ar 390, en 1280) | italic | normal |
| F3-08 | clipped rows of the pay-bar text at 360 / 390 / 430 | 4 rows (18 px) | 0 rows; bar 69 px |
| F3-09 | invoice, ar print: visual order of the discount cell | minus, currency, figure (minus on the far side) | currency, figure, minus (minus next to the figure); English unchanged |
| F2-07 | first-line characters, Terms ar / en (4 paragraphs) | 103-138 / 94-108 | 75-92 / 55-71 (column 858 -> 572 px). Privacy 122-131 / 93-109 -> 82-86 / 62-75; Support 104 / 98 -> 84 / 75; About FAQ answer 160 / 136 -> 86 / 67; the About lead paragraph is untouched |
| F1-01 | English preloads; first-screen glyphs in a fallback font at first text (home / product / shop); late faces | 2 files; 222/352, 243/315, 238/500; 2 | 4 files (+2 at `fetchpriority=low`); 0/343, 0/306, 0/491; 0. Arabic unchanged (201/284, 221/276, 239/441), because it is not changed |

**Slow network (1.6 Mbps, 150 ms, CPU 4x), English, 2 repetitions each.** First text before -> after: home 6,208 and 5,192 -> 6,299 and 5,585 ms; product 6,383 and 5,271 -> 5,502 and 5,539; shop 5,921 and 4,816 -> 6,201 and 6,096. Mean +238 ms over the 6 pairs (range -881 to +1,280 ms). That is inside the roughly 0.7 s run-to-run spread of this loaded machine, but it is not a clean zero: the verifier measured English neutral (5,654 vs 5,665 ms, n = 5), and Chrome's throttle shares bandwidth between requests, so `fetchpriority=low` cannot show its benefit here. Re-measure on the VPS before shipping. CLS from font swaps was 0 in all 24 slow runs, with and without the patch.

**Regression sweep** (12 pages x ar/en x 320/390/1280 = 72 loads): horizontal scroll 0 before, 0 after.

**Not proven here.** The HEAD trees (B) were measured with the tool only (32 states); the pixel and DOM probes ran on the live-copy trees (A). F3-13 (admin order editor) needs a signed-in session; its verifier proved it on a fixture order editor and it was not re-run. F1-01 and F2-05 timing is the only measurement that did not come out cleanly (above). F2-07 changes page proportions on desktop; the numbers are above, the taste call is the owner's.

**Noise the reader may meet in the raw data.** The shop loads 12 more cards when the tool's scroll pass reaches the grid's sentinel (`IntersectionObserver`, `rootMargin: 600px`), which it did in some runs and not in others, before and after alike (page height 2,600-2,963 px with 12 cards, 4,057-4,421 px with 24). The pairs above are like-for-like re-runs; the same applies to a footer payment chip on `/track` that had not rendered in one run. An earlier version of this patch also carried a `boot.js` hunk for F3-11; its measurement is why that hunk was dropped (see F3-11).

Scratch data and scripts: `/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/audits/fonts-synth/v2/` (`gen-patch.py`, `build-mirrors.py`, `run-all.sh`, `proof-extra.cjs`, `out/compare-A2.txt`, `out/compare-B.txt`, `out/extra-A-before.json`, `out/extra-A-after.json`).

## 9. What could not be checked, and how to re-run it live

- **The live site itself** (Hostinger connector signed out). Everything above is the mirror: captured bundle, deployed add-ons, captured `/api` JSON, repo fonts. The live `/fonts` files are not in the capture; if they differ from the repo copies, the sha256 list in section 3 shows it.
- **Adobe Fonts kits** (`use.typekit.net`, `qkv4ztg.css`, `xgg6rku.css`): blocked here. What the kits contain, whether they ever draw a glyph, their weights and `font-display` are unmeasured. Evidence that nothing draws from them: they sit after the local faces and the Arial-based fallbacks in every stack, no JS or add-on sets `.font-adobe-*`, and local faces cover every character used except the F1-04 symbols (whether the kits cover those is unknown).
- **Real HTTP headers**: the mirror sends none. Caching, CORS and compression for `/fonts` were read from the repo `.htaccess` and measured on a local Apache 2.4, not behind Traefik on the VPS. The live `sw.js` is not in the capture.
- **Lazy route stylesheets missing from the capture** (`Returns-DHmag5QD.css`, `Account-DqFbZs-H.css`, `AdminApp-Dw3t3z9Z.css`): `/returns`, `/exchange`, `/account` and `/backends` (16 states) were measured with an empty stub; their font families are right, their sizes, weights and spacing are not. `/backends` past its sign-in screen was not reached (no sign-in allowed); the admin Overview, Orders and Catalogue were seen only through a local fixture session.
- **Widths**: the crawl ran at 390 and 1280 only. 320, 360, 430, 768, 1024 and 1536 were measured for the specific findings, not for every page.
- **Devices**: the fallback fonts of visitors' phones (this machine drew Liberation Sans and DejaVu Sans), Outlook and other mail clients, F3-17 on Windows/macOS/iOS.
- **Not measurable by this method**: text from `::before`/`::after`, canvas, text baked into images, `<option>` lists, OS date pickers, hover/focus/active styles, print CSS other than the invoice, the sticky header while hidden, storefront dark mode, Sporta AI replies (they need a POST), the real discount and quote responses (POSTs were aborted, so "calculating total" stays on the checkout states).
- **Mirror artefacts, not live defects**: the hero image is the og-image (the mirror answers every slide request with it); the 46 products have `image=null`, as live does today; first-text times move with machine load (glyph counts and arrival lags were stable, absolute times were not).
- **Product page "Added" state**: the real "Added ✓" button text was not reproduced; the check mark was measured on synthetic spans in the real computed stacks.

### Re-run it live, read-only, on the VPS

The sandbox cannot reach the site, so use the Hostinger connector like the other probes (CLAUDE.md "Probing the live site"):

1. One scratch compose project on VM 2058651 using `mcr.microsoft.com/playwright:v1.49.0-noble`. In the job: `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright@1.49.0` in a work directory.
2. Put `sporta-web/scripts/fonts-audit.mjs` beside that `node_modules` (fetch it from `raw.githubusercontent.com/hkspower/wain/<pushed sha>/sporta-web/scripts/fonts-audit.mjs`; hand-copied base64 is unreliable). It imports `playwright` from its own directory.
3. `BASE=https://www.sporta.com.kw OUT=/work/out node fonts-audit.mjs`. With `BASE` set the tool sends GET only, lets the Adobe kits through (`EXTERNAL=allow`), does not stub CSS, and records real font response headers and the kit requests. Add `WIDTHS=320,360,390,430,768,1024,1536` for the widths not run, `ROUTES=` for a subset, `THROTTLE=1` for the slow pass.
4. No `$` in the compose file, Arabic as `\uXXXX`, logs are capped at 300 entries, and delete the scratch project afterwards. Read the tables back with `node scripts/fonts-audit.mjs --summarize /work/out`.
5. To compare the font files byte for byte, fetch the 8 `/fonts/*.woff2` in Node (`fetch`, no `curl`) and hash them against section 3.

Locally: `npm run audit:fonts` (starts the mirror, one browser, two pages at most), `node scripts/fonts-audit.mjs --list` for the catalogue, `--selftest` for the 58-check self-test on a deliberately broken fixture.

## Appendix A - dropped or merged (not findings)

Dropped, with the verifier's reason:

| Id | What was found | Why it is not a finding |
|---|---|---|
| F1-02 | English pages at 640 px and up fetch `plex-700-arabic` (44,280 B, 33% of English font bytes) for the four Arabic letters of "سبورتا AI" on the AI launcher | Documented brand decision (`src/i18n/translations.js`: the name stays Arabic in both languages). Measured cost: 133,588 vs 89,308 B, and the four letters sit in a system font until the file lands. If the owner ever wants English "Sporta AI": 44 kB less, label 8.5 px wider, header unchanged at 640-1024. [F2-19, same text] |
| F1-03 | Two Adobe Fonts kit stylesheets and two preconnects on every page, allowed by the CSP; nothing draws from them | Deliberate: `index.html` and the admin Theme editor call Adobe the licensed source. Residual: `/privacy` does not mention Adobe, though every visit contacts `use.typekit.net`. A one-line copy addition at the next rebuild. [F2-20, same cause] |
| F2-05 | Same evidence as F1-01 | Judged an intended trade-off of the "two files only" decision; merged into F1-01 |
| F2-09 | Order numbers and the reward code use `font-mono` (Liberation Mono here) | Deliberate "this is a code" look; helps tell O from 0 in the reward code |
| F2-10 | 1,687 runs ask for weights Plex lacks (800 / 850 / 750 / 500) | No visible effect: 0 px difference vs forcing 700. Untidy source only |
| F2-12 | Footer "Join the club" h2 (31.6 px) larger than the 404 / review h1 | A designed promotional block; the real weakness is the small 404 / review h1, a rebuild matter |
| F2-13 | Arabic display leading 1.25 / 1.28 / 1.3 / 1.4 | Tight but nothing touches; usual for Alexandria Black. The optional `line-height:1.4` pushes content down on 7 pages |
| F3-12 | Arabic `name_ar` second line is 13.7 px in the English admin | Deliberate (`sporta-admin-knet.css` sets it); the proposed rule is outranked |
| V-M3 | Hero shows the og-image on the mirror | Mirror artefact (the mirror answers every slide request with it); any hero-based measurement must be discarded |

Merged (same cause, one finding): F2-15 into F3-02; F2-16 into F3-04; F2V-M1 into F3-05; V-M1 into F3-07; F3-10 into F2-14; F2-08 into F1-04; V-M2 into F3-14; M-F1-B (the corrected Arabic recommendation) into F1-01.
Refuted: none. Retracted by their authors: two leads from the F2 verifier (bidi of "+965" which already carries an LRM; the home h1 which is sr-only).

## Appendix B - lens and verifier map

| Lens | Reported | Kept | Verifier outcome |
|---|---|---|---|
| F1 loading and inventory | 7 (+ 2 missed items) | 5 (+ M-F1-A) | 5 confirmed, 2 intended-design (F1-02, F1-03) |
| F2 rendered fonts | 20 | 10 (+4 merged into other findings) | 15 confirmed, 5 intended-design, 0 refuted |
| F3 Arabic, admin, print, mail | 18 | 16 (+1 merged) | 14 confirmed, 2 confirmed with caveats (F3-04, F3-17), 1 unclear (F3-16), 1 intended-design (F3-12) |
