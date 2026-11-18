# Brand layout scan, 2026-11-18 (read-only)

Owner: "scan brand layout". 22 findings: 2 High, 7 Medium, 8 Low, 5 Info. Nothing in the repo, on the VPS or on the live site was touched by the scan.
589 page loads: 8 brand cases x the 7 widths x ar/en x light/dark (dark at 390 and 1280 only for the banner, chip and About; also 320 and 768 for the
home strip), in a private Chromium against the captured storefront with a mock API. Evidence (259 PNGs plus `*-results.jsonl`):
`/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/brand-scan/` (a scratch folder, not kept in the repo).

**State measured:** repo HEAD `5335757c`. The brand-relevant add-ons (`sporta-ui-colours.css`, `sporta-images.css` and the others) are byte-identical to the
deployed commit `21516fa6`. `sporta-features.js` and `sporta-shadows.css` differed only in non-brand price-line code. The 3 live brands (Vanquish with logo,
Gymshark, NBA) were mocked with the live catalogue's 6 tagged products. Fonts are the captured local faces.

## Places

| Place | Exists? |
|---|---|
| Home "Brands we trust" strip | Yes (compiled bundle plus add-ons) |
| A Brands page | **No.** `/brands` and `/brand/<slug>` render "Page not found" (a real 404 on the server). "Explore brands" and "All brands" both go to `/shop`. |
| Brand page = `/shop?brand=<slug>` plus the banner `#sporta-brand-banner` | Yes |
| Logo chip on the product photo (BRANDMARK-1118) and the plate under the price | Yes |
| About card, lead and FAQ | Yes, names only |
| Footer | **Lists no brands** |
| Structured data | Yes (Product, ItemList, OnlineStore, FAQPage) |

## Findings

"Add-on" means it can be fixed in add-on CSS/JS.

**BL-01 · High · Brand-page banner · 320-1536, ar+en, light theme**
- Eyebrow, brand name and count all compute to `#171a1e` on the `#171a1e` banner (1.00:1) in 78 of 78 light measurements. In the 18 dark measurements
  they are correct (6.73 / 17.46 / 12.68:1).
- Cause: `sporta-ui-colours.css` MONO-1112 forces every shop text to `#171a1e !important`. Its dark-surface list names `.sporta-features__banner`, not
  `#sporta-brand-banner`, and `test:addons-brands` loads no `ui-colours.css`, so no test saw it. A white-on-transparent logo leaves a blank white box beside the CTA.
- Screenshots: `banner-live3-vanquish-390-ar-light.png`, `banner-live3-vanquish-390-en-light.png`, `banner-live3-gymshark-768-en-light.png`,
  `banner-long-longname-320-en-light.png`, `banner-eight-white-390-en-light.png`. Fixed: `fix-banner-ar-light-after.png`.
- Fix, add-on, `sporta-images.css` banner block (verified by injecting into the running page):
  `#sporta-brand-banner :is(h2, h2 *) {color:#fff !important}`; `#sporta-brand-banner :is([data-sporta-brand-count], [data-sporta-brand-count] *) {color:#e2dbce !important}`;
  `#sporta-brand-banner > div:nth-child(2) > p:first-child {color:#ff7b17 !important}`. After the fix: 6.73 / 17.46 / 12.68:1 in ar and en; the dark theme
  and the CTA (6.73:1) are unchanged. Adding the banner to MONO-1112 rule 2 would instead turn the wordmark white on its white box.

**BL-02 · High · Home strip logos · all widths, ar+en, both themes**
- The bundle's `filter: grayscale() brightness(0) invert()` makes every logo a white silhouette. Of 242 logo images measured none was distorted (max aspect
  deviation 0.28%, `object-fit: contain`). An opaque-background logo (any JPEG, or a PNG/WebP with a solid background) becomes a solid white rectangle; a logo
  with white detail inside a dark shape becomes a plain disc; a coloured logo becomes white.
- Screenshots: `home-eight-1280-en-light.png`, `home-eight-390-en-light.png`. The trigger depends on the artwork; the admin accepts JPEG and gives no hint
  ("PNG, JPEG or WebP. Resized to 320px"). The real Vanquish logo's alpha could not be checked (live site off limits).
- Fix: not CSS alone (alpha is unknown to CSS). Add-on JS in `sporta-features.js` block 3: read the loaded logo in a 40px canvas (as the PHOTO BACKDROP block
  does), set `data-sporta-opaque` when the corners are opaque, and let CSS use `filter:none` on a white tile. Also a hint in the Brands editor in
  `sporta-admin-brands.js`. Not tried.

**BL-03 · Medium · Home strip data · all**
- The bundle starts the strip with a hard-coded list: SPORTA, RHEO, Vanquish, ATE, Gymshark, Eyesportwear, NBA. `r=brands` answering `[]` or failing leaves all
  seven in both languages for good, linking to `/shop?brand=ate` and similar pages that show "No matching products". With the 3 live brands and the API
  delayed 1.5 s, shoppers first see seven tiles, then three; CLS 0.009-0.014 (home), bar height unchanged. Screenshot: `home-zero-390-en-light.png`.
- Fix, add-on: in `sporta-features.js` block 3, mark the bar "pending" until `rows` arrives and hide the track with `visibility:hidden` (height kept); when `rows`
  is `[]` set `display:none` on the bar. The real fix is the bundle's initial list (source missing). Not tried.

**BL-04 · Medium · Long names (admin allows 80 characters) · home strip and banner**
- Strip tile (68px tall): an 80-character name takes 7 lines (ar) or 11 lines (en) at 320-390, 3 or 6 at 768-1024, 2 or 4 at 1280; the lines spill past the tile
  and break mid-word ("PROFESSION / AL / SPORTSWEA"), no ellipsis. Banner at 320-390: the h2 is 5-8 lines and the banner 313-371px tall; the wordmark in the logo box
  is truncated. Screenshots: `home-long-390-ar-light.png`, `home-long-390-en-light.png`, `banner-long-longname-320-en-light.png`.
- Fix, add-on, `sporta-images.css` (verified in `fix-tile-en-after.png`, `fix-tile-ar-after.png`): `.brand-bar__item > span {display:-webkit-box;
  -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; overflow-wrap:break-word; line-height:1.25}`. The link's `aria-label` already holds the full
  name. For the banner h2 clamp at 3 lines (not tried).

**BL-05 · Medium · "Eyesportwear" breaks mid-word · English strip, 320-768 and 1280-1536**
- A 12-letter real name renders as "EYESPORTWE / AR" at 14.5px; at 1024 with 8 brands (88px tiles) it takes 3 lines and is clipped. Cause: the bundle's
  `overflow-wrap:anywhere` makes the text wrap, so `fitStrip` never sees an overflow to shrink. The `addons-brands` fixture lacks that rule.
  Screenshot: `fix-eyesportwear-390-en-before.png`.
- Fix, add-on, `sporta-images.css`, next to the capitals rule (verified in `fix2-eyesportwear-390-en-after.png`): `html:lang(en) .brand-bar__item > span
  {overflow-wrap:normal; word-break:normal}`. The guard then sets 12px on one line at 390 and its 10px floor at 1024; at 88px tiles it still overflows.

**BL-06 · Medium · Logo polarity · banner logo box and product chip, all widths**
- Both sit on white. A white or light logo (natural for the dark strip) disappears; the chip is then a tappable blank 116x44 white pill with a correct aria-label.
  Screenshots: `banner-eight-white-390-en-light.png`, `product-eight-white-390-ar-light.png`.
- Fix: add-on JS in `buildBanner` / `buildMark` (read the logo's luminance, use `#171a1e` as the ground when it is light), plus the admin hint. Not tried.

**BL-07 · Medium · Structured data**
- Compiled `Ln()` sets `Product.brand` (and the `ItemList` items' `brand`) by matching the product name against `RHEO, Vanquish, ATE, Gymshark, Eyesportwear, NBA`,
  else "SPORTA". All 46 products: 41 SPORTA, 4 Vanquish, 1 Gymshark; the Denver Nuggets Cap tagged NBA gets "SPORTA"; any brand outside the list gets "SPORTA";
  "ATE" is a 3-letter substring match ("Slate Grey" would be labelled ATE). The static `OnlineStore.brand` in `index.html` lists 7 names, and `llms.txt` names the
  same, against 3 public brands.
- Fix: not CSS. Add-on JS can rewrite the ld+json from the plate's brand. **Done 2026-11-18 for product pages** (PRODUCT BRAND-1118, commit `3aa05cc2`: the real
  brand replaces SPORTA, or the claim is dropped). The ItemList on list pages drops the SPORTA brand through the same rule; `index.html` and `llms.txt` are build inputs.

**BL-08 · Medium · Banner copy alignment (CENTER-1118 side effect) · 96 of 96 measurements**
- The brand name is `text-align:center` while the eyebrow and count stay start-aligned; at 1280 the name floats mid-bar (visible in dark); after BL-01 is fixed it is
  also visible at 390 in the light theme. Screenshot: `banner-live3-vanquish-1280-ar-dark.png`.
- Fix, add-on, `sporta-images.css`: `#sporta-brand-banner h2 {text-align:start}`, or centre the whole copy block if the owner wants all text centred. Not tried.

**BL-09 · Medium · Hidden brand, product plate · 390 and 1280, ar+en**
- A product still tagged with a brand the owner set to Hidden shows the raw web name ("tek") as the maker in the plate: the API blanks the names for an inactive
  brand but keeps `brand_slug`. No chip appears (correct).
- Fix: `dropin/php-store/api.php` `r=products` should return `case when b.slug is null then null else p.brand_slug end` (API release, behind the review gate). Not CSS.

**BL-10 · Low · Strip heading column · 1024-1536 (en and ar)**
- CENTER-1118 centres the h2 in its 13rem column while "Explore brands" is start-aligned: 25-34px off the CTA's edge and the page gutter. Screenshots:
  `strip-heading-1280-en.png`, `home-one-1280-en-light.png`. Fix, add-on, `sporta-shadows.css`: exempt `.campaign-brand-bar__heading h2` from CENTER-1118 (`text-align:start`).

**BL-11 · Low · Logo size and aspect**
- A tiny source logo (64x24, which the admin does not upscale) is stretched 1.25-1.72x in CSS px (about 3x on a 2x phone) and looks soft; a tall 90x320 logo is
  12-13px wide in the strip and banner and 8px in the chip; a wide 320x80 logo is only 25-27px tall in the 68px tile. Screenshots: `banner-eight-tiny-390-en-light.png`,
  `banner-eight-tall-390-en-light.png`, `home-eight-1280-en-light.png`. Fix: a hint in `sporta-admin-brands.js` ("at least 300px wide, not tall and narrow").

**BL-12 · Low · No hover feedback · desktop.** The banner CTA's computed style is identical on hover (5 of 5 desktop measurements): the rule in `sporta-images.css`
sets the colour it already has; the chip has no hover state. Fix, add-on: `filter:brightness(1.08)` on the CTA, a small shadow or lift on the chip.

**BL-13 · Low · "Explore brands" is 33-34px tall at 1024-1536** (44px below 1024). Fix, add-on: `min-height:44px` at >=1024 (the bundle sets 2rem).

**BL-14 · Low · Name language differs by surface.** The banner's wordmark always uses `name_en` ("GYMSHARK" on the Arabic page next to an Arabic title); the chip and
strip follow the page language; the plate uses mixed case (13px "Gymshark"), the other three uppercase tracked wordmarks. Fix: `wordmark(b)` in `sporta-features.js`
should call `nameOf(b, L)`.

**BL-15 · Low · Banner height jumps with width.** 227px at 320, 159px at 360-390, 103px at 768 and up (`flex:1 1 160px` wraps to three rows at 320). Fix, add-on:
lower the copy's flex-basis.

**BL-16 · Low · Count disagrees with the grid only with extra URL filters.** The banner says 4 over a grid of 0 for `&category=women` or `&sale=1`. Plain brand pages
agree in every case measured (1 to 4 products); Arabic grammar is right; the bundle's own "1 products" is hidden by `sporta-grid.css`.

**BL-17 · Low · One or two brands.** The tiles stretch to fill the row (no half-empty row), but one brand is a 288-1037px wide outlined bar with a 110-150px logo.
Screenshot: `home-one-1280-en-light.png`. Fix, add-on, `sporta-images.css`: cap the column at about 16rem and centre it.

**BL-18 · Info · No brands page; SEO.** The admin shows `/brand/<slug>`, which is a 404 (the admin add-on already adds a "View on site" link). Brand pages are
canonical to `/shop` (`/shop?lang=en` in English), so each brand page counts as `/shop`, and the sitemaps list none.

**BL-19 · Info · About names.** With the list empty or down, the page keeps the static names (RHEO, ATE, Eyesportwear and "our own SPORTA label"); the live list swaps in
correctly; no overflow with 80-character names (lead is 7 lines at 390 en).

**BL-20 · Info · CLS when the list arrives late (1.5 s).** Home <=0.014; banner 0.0008 (the reserve box works); About <=0.030 (8 brands, 1280 ar); a link to a brand
that does not exist shifts once: 0.069-0.075 on a phone, 0.029 on desktop (a known BRAND-CLS-1112 trade-off).

**BL-21 · Info · Dark theme.** The banner and strip are `#171a1e` on a `#171a1e` canvas (1.0:1), so only the content defines them.

**BL-22 · Info · Footer.** It lists links, payment marks and the club and call buttons, but no brands.

## What looked right

- **Strip tiles:** heights equal in all 198 measurements (68 / 69.3 / 62.1 / 63.1 / 63.8px), no sideways scroll on any page; the smallest tile is 88x62, well above the
  44px tap target; logos and short names centred (offset <=1px); focus ring 2px `#ff7b17` on charcoal (6.73:1); hover changes background and border; logo and name
  fallbacks (including a 404 logo) work on the strip, banner, chip and plate with no shift.
- **Logo request caching:** one hashed URL, `r=brand_logo&slug=...&v=<12 hex>`, shared by the strip, banner, chip and plate; after the first request, 4 further page
  loads made 0 server hits; the header is `public, max-age=31536000, immutable` (200 only, 404 stays no-store; `dropin/php-store/.htaccess` line 44).
- **Banner placement:** edges line up with the sort row and grid at every width, 16px gap above and below; the CTA is 44px tall with a white 2px focus ring; the heading
  font matches the page's h1.
- **Product chip (100 measurements):** always 44px tall, 12px from the start-top corner (the right in Arabic), no collision with gallery controls; language-aware name,
  a long name ends in an ellipsis and the aria-label keeps the full name; the link keeps `?lang=en`; focus ring 2px `#b34d00` (5.28:1 on white).
  (The shop's own label showed `logo.png`; that was removed on 2026-11-18, PRODUCT BRAND-1118: the shop is not a product's maker.)
- **Unknown or hidden slug:** no banner, no stuck reserve, the page title is restored.
- **Colour:** a red scan of 48 surface loads (848 elements) found no red anywhere: `#ff7b17`, charcoal, white or the `#e2dbce` count text only.

## Limits

The mock logos are drawn, not the real uploads. Not measured: touch or screen-reader behaviour, 120% text style, print, real photos behind the chip, shop cards (they
carry no brand). `use.typekit.net` was refused by the sandbox proxy (the capture's `index.html` requests it); pages used the local font faces. `sporta-cat-tiles.css` is
not deployed (it only changes the strip's phone padding).
