# Products grid scan, 2026-11-18

Owner: "scan products grid". Read-only design and behaviour scan of the storefront product grid. Nothing in the repo, on the VPS
or on the live site was changed; no commit. It extends `CARDS-SCAN-2026-11-18.md` (that scan settled the card's radius, border,
shadow, the quick-add "+" rim and the why-card index; none of it is repeated here).

## Result in one screen

21 findings: **1 High, 7 Medium, 13 Low**. 10 of the 21 can be fixed in add-on CSS; the rest need the API, a server job, add-on
JavaScript or the compiled bundle (marked per finding).

| | |
|---|---|
| High | G-01 the "Sold out" label on a sold-out card is ink on ink (contrast 1.18:1), unreadable at every width in both languages |
| Medium | G-02 the live shop opens on two sold-out "no photo" plates; G-03 the default sort called "Newest" is A-Z by English name; G-04 the Save heart is invisible on touch screens 1024 px and wider; G-05 the empty state is a dead end and the home "Up to 60% off" tile leads to it; G-06 three full-size photos are 89% of the shop's image bytes; G-07 on a phone, prices do not line up across a row when a sale price wraps; G-08 "sold out" is not announced to screen readers |
| Holds | columns, gaps and outer padding match the intent in `sporta-grid.css` at every tested width (0 mismatches in 140 page loads), no sideways scroll anywhere, equal card heights in every row of the live data, 44 px+ touch targets, one consistent focus ring, no layout shift from the grid |

How a card shows price, sale price and original price today, and which file computes the percent, is in "For the owner's next
task" below.

## Method and what to trust

- **Real page.** The captured live storefront (the compiled React bundle, capture of 2026-11-03) served by
  `scripts/lib/add-to-cart-ux-live.mjs` `serveLive`, under this repo's add-on files. `git diff 21516fa HEAD -- sporta-web/public` is
  empty, so the add-ons measured are the ones deployed in `deploy-20261118T145743Z-21516fa` (the ten files, which include
  `sporta-grid.css`, `sporta-images.css`, `sporta-shadows.css`, `sporta-ui-colours.css`, `sporta-features.js`).
- **Pages x widths x languages.** `/shop` (46 cards after "Show more"), a category page (`/shop?category=women`, 19 cards), the home
  "Shop the essentials" row (4), a brand page (`/shop?brand=vanquish`, 4) and the related row of a product page (4); 320, 360, 390,
  768, 1024, 1280, 1536 px; Arabic (RTL) and English. Two data sets, 70 loads each:
  - **live** = the capture's real 46 products, real stock (4 sold out), no product on sale (0 of 46 had `on_sale` on 2026-11-03).
  - **mix** = the same 46, re-ordered so a test set leads the list: sale prices of 20%, 67%, 50%, 6%, 38%, 42% and a 0.1% cut,
    wide figures (100.500 -> 49.995), an 85-character English and 80-character Arabic name, a 55-character unbroken code name, a sold-out
    sale card, plus defensive inputs (price 0, `on_sale` without `list_price`, list below price, list equal to price), 4 `featured`
    products, and brands with 1, 2 and 7 products.
  - Extra widths 640, 700, 767, 899, 1023 on `/shop`, a brand page and home; touch tablets 768, 1024, 1180, 1366; dark theme; text at
    125% and 150%; loading, error and empty states; keyboard, hover, CLS, LCP and image requests.
- **Photos.** The bundle itself names 32 slugs that have a photo (the other 14 show the grey "no photo" plate; CLAUDE.md confirms 14 of 46
  on 2026-11-18). Those 32 were served from the supplier-library files in the scratchpad (`images/fill/products` and
  `images/fill/responsive`; `cagliari-calcio-sweatshirt-navy.jpg` is byte-identical in size to the live file, 128,940 B). **Image bytes and
  the white-band numbers are therefore indicative, not live**; `scripts/live-images-scan.mjs` on the VPS gives the live ones.
- **Fonts.** `use.typekit.net` is blocked in this sandbox, so Latin text wraps may differ a little from live.
- **Not measured:** the live site itself (no VPS contact), a real phone, a screen reader (roles and names read from the DOM).
- **Harness** (not shipped, in the session scratchpad): `grid-scan/` next to the screenshots. `run-matrix.mjs live|mix`,
  `analyse.mjs <live|mix> cols,rows,gaps,names,photo,touch,over,price`, and one `probe-*.mjs` per section below; `verify-fixes*.mjs`
  injects each "smallest fix" as CSS into the running page to prove it (the source files were not edited).
- Screenshots: `/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/grid-scan/<name>.png`
  (the directory is called `grid-scan/` below).

## What already holds (no change needed)

| Check | Measured |
|---|---|
| Columns vs the intent in `sporta-grid.css` | 2 below 640 px; 3 from 640 (12 cards; `[gs-1]`) with a 4-card grid staying 2 x 2 to 767; 3 at 768 with a 4-card grid 4 across (`[gs-2]`, home, brand, related); 4 from 1024. Seen: 138 / 158 / 173 px cards at 320 / 360 / 390, 230 at 768, 226 at 1024, 286 at 1280, 304 at 1536; at 899 and 1023 a 4-card row is 199 and 228 px. 0 of 140 loads differ |
| Gaps | Computed and measured agree: column 12 / 16 / 20 px, row 24 / 28 / 32 px (below 640 / 640-1023 / 1024 and up) |
| Outer padding | 16 px to 639, then 23 (768), 30.7 (1024), 38.4 (1280), 130.5 (1536; the grid is 1275 px wide there); equal left and right, identical on all five pages, and the sort row has the same edges as the grid |
| Equal heights in a row | Live data: 0 ragged rows in 70 loads; card height is one value per width (259 / 284 / 303 at 320 / 360 / 390, 381 at 768, 377 at 1024, 454 at 1280, 477 at 1536). The 85-character and 55-character names are clamped at two lines and the card does not grow |
| Photo frame | Exactly 4:5 (0.800) at every width; `object-fit: contain`; `width=600 height=750` on every `<img>`; one `<img>` per card; every photo and every plate has `alt` = the product name; frame radius and padding follow `SHAPE-1111` |
| Touch targets | Heart and "+" 44 px (320-390), 45 (768), 46 (1024-1280), 47 (1366); name link 120 x 58 px at 320; whole frame is a link; sort select 47.6 px; "Show more" at least 44 px |
| Keyboard focus | 2 px solid #B34D00, offset 3 px, on the photo link (plus a 2 px card ring from `[gs-4]`), the heart, the "+" and the name link, both languages |
| Hover (1280, mouse) | card lifts 2 px, border turns brand orange (42%), shadow `0 8px 20px`, photo scale 1.03, heart fades in |
| Headings | one `h1` (visually hidden), one `h2` ("All products", hidden), one `h3` per card name; the full name is in `title` on the `h3` (`NAMES-1111`) |
| Sideways scroll | none in 140 loads, nor in dark, at 125% / 150% text, nor on the empty and error states; no card or name leaves its grid edge |
| Layout shift from the grid | CLS 0.0003-0.0067 on every grid page (390 at DPR 3, 768 at DPR 2, 1280) with the API delayed 300 ms and photos 120 ms. The one larger figure, 0.0365 on the related row at 768, is the product page's panels moving, not the grid |
| JavaScript errors | 0. Console noise is only the `variants.txt` 404 (G-06) and the blocked Typekit stylesheet of this sandbox |

## Findings

Order: severity, then page weight. "CSS" = fixable in an add-on stylesheet; "not CSS" says what is needed instead.

### High

**G-01. The "Sold out" label is ink on ink: contrast 1.18:1.**
- Seen: every sold-out card, 320 / 390 / 768 / 1024 / 1280 / 1536, Arabic and English. Label colour `rgb(23, 26, 30)` on the band `ink` at 85%
  (computed contrast 1.18:1; the white veil and the dark band remain, the words do not).
- Cause: `sporta-ui-colours.css` MONO-1112, rule "1. Everything black ..." (line 287) paints every storefront text `#171a1e !important`; rule
  "2. ... except on a dark surface or over a photograph: white" (line 293) lists `.bg-ink`, but the band's class is the opacity form
  `bg-ink/85`, which `.bg-ink` does not match. `test:words-colours` C4 checks that the band is painted dark, not what colour its text is.
  `sporta-grid.css` `[gs-7]` claims "about 11:1"; that was measured without MONO-1112.
- Screenshots: `soldout-ar-320.png`, `shop-mix-en-1280.png`, `shop-mix-ar-1536.png`, `touch-1024-shop.png`, `state-loading-ar-390.png`; the fix applied:
  `fix-soldout-en-390.png`.
- Smallest fix (CSS): in `public/sporta-ui-colours.css`, MONO-1112 rule 2 (lines 293-306), add `[class*="bg-ink"]` next to `.bg-ink` in both selector
  lists. Verified by injection: label becomes `rgb(255, 255, 255)`. Add a text-colour assertion to `test:words-colours` C4.

### Medium

**G-02. The shop opens on sold-out "no photo" plates.**
- Seen (live data): the first row at 390 is 2 plates, both sold out; at 768 the first row is 2 of 3 plates, at 1280 3 of 4. The first 12
  cards hold 3 plates and 2 sold-out cards; across the 46, 14 are plates (30%) and 4 sold out (3 are both). The category page "women" has 2 plates in
  19. A brand page (`vanquish`) shows 3 plates in its 4 cards; the home row "Shop the essentials" is 3 Cloudsoft jackets and a Bestseller (no
  product is `featured`).
- Cause: the list is `order by p.name_en` (`dropin/php-store/api.php` line 162); the grid shows it as it comes. Photos and stock are data.
- Screenshots: `state-loading-ar-390.png` (the live data's first screen), `touch-1024-shop.png`, `brand-live-ar-768.png`, `home-live-en-768.png`.
- Smallest fix: **not CSS.** `api.php` `r=products`: order in-stock products with a photo first, then the rest (the photo test is in
  `product-listable.php`). A visual-only stopgap in CSS, the same as `[lay-3]` for the related row
  (`.catalog-page .product-grid > :has(img[src*="product-photo-unavailable"]) { order: 1 }`), moves plates to the end of what is loaded but
  the "Show more" steps of 12 would leave a plate cluster in the middle, and tab order would no longer match.

**G-03. "Newest" is not newest.**
- Seen: the sort option is "Newest" / "الأحدث" and is the default; it is the API order, which is A-Z by English name (the live order: Cagliari,
  Cheetahs, Cloudsoft, ...). In Arabic the list is therefore in English alphabetical order.
- Smallest fix: **not CSS.** `api.php` line 162 (`order by p.id desc` or a created date), or relabel the option in the bundle.

**G-04. The Save heart is invisible on touch screens 1024 px and wider, and on a mouse until hover.**
- Measured: heart opacity 0 and "+" opacity 1 at rest at 1024 / 1180 / 1366 touch (`hover: none`, `pointer: coarse`) and at 1280 mouse; 1 at 768 touch
  and on every phone. The bundle has `lg:opacity-0 lg:group-hover:opacity-100` for the heart; the "+" is saved by `.catalog-card-add { opacity: 1 }`.
  An iPad in landscape never shows a heart, and a tap on its invisible area toggles the wishlist. `sporta-grid.css` `[gs-6]` says no
  `lg:opacity-0` rule exists in the bundle; the captured stylesheet has it.
- Screenshots: `touch-1024-shop.png`, `shop-mix-en-1280.png`.
- Smallest fix (CSS): `sporta-grid.css` after `[gs-6]`:
  `@media (hover: none) { .storefront-root .product-grid-card .catalog-card-save { opacity: 1 !important } }`. Verified by injection (0 -> 1 at 1024 touch).
  Owner choice: show it at rest for mouse users too (matches the "+").

**G-05. The empty state is a dead end, and the home "Up to 60% off" tile leads to it.**
- Seen: with no product on sale, the home tile "خصومات حتى ٦٠٪ / Up to 60% off, Sporta Outlet" (copy fixed in the bundle) links to `/shop?sale=1`, which
  shows "No matching products. Try another category or clear the search" with **no button, no chips and no search box** (the category chips and
  the count are hidden by `sporta-grid.css` on the owner's request of 2026-11-03). The bundle shows "View all products" only when a category is set,
  so `?sale=1` and `?q=` have nothing to press (a brand page keeps its banner's "All brands" button). The text also tells the shopper to pick a category that the page no longer offers.
- Screenshots: `page-sale-live-empty-ar-390.png`, `page-sale-live-empty-en-1280.png`, `state-empty-q-ar-390.png`, `state-empty-q-en-1280.png`,
  `state-empty-combo-ar-390.png` (this one has the button).
- Smallest fix: **not CSS** (bundle copy). Add-on JS in `sporta-features.js`: when `.catalog-empty` shows without a button, append a link to `/shop`; and
  hide the home Outlet tile (`a[href="/shop?sale=1"]`) while the products JSON has no `on_sale` item. Re-check against the live API first: the capture is from
  2026-11-03.

**G-06. Three full-size photos are 89% of the shop's image bytes; the small-copy list is a 404 on every load.**
- Measured (sandbox photos, see Method): whole `/shop`, 46 cards, 32 photo requests, 1,477 KB: the 29 photos that have a `srcset` are 168 KB
  (320 px WebP at 1x), the three without one are 1,309 KB (`sgomma-t-shirt-navy.jpg` 848 KB for 4200 x 5422 px, `tekno-shorts-black.jpg` 335 KB,
  `cagliari-calcio-sweatshirt-navy.jpg` 126 KB), each shown in a 159-267 px frame. The first screen (12 cards) is 26 requests and 427 KB at 390 / DPR 3
  (the sweatshirt alone is 126 KB of it), 273 KB at 1280. `GET /images/products/responsive/variants.txt` is 404 once per page load
  (CLAUDE.md, known): the bundle gives those three photos no `srcset` and `sporta-features.js` would add one from that list.
- Also seen: when one `srcset` candidate is missing (here `cloudsoft-top-navy-640.webp`) the bundle's `onError` swaps the photo for the "no photo"
  plate instead of falling back to `src`. A card turns into a plate after a missing copy.
- Smallest fix: **not CSS, no code.** Run `scripts/make-image-variants.mjs` on the server (writes the copies and `variants.txt`); the add-on then does the rest.
  Check live with `scripts/live-images-scan.mjs`.

**G-07. On a phone, prices do not line up across a row when a sale price wraps.**
- Measured (mix, 320 / 360 / 390, ar and en): a sale price pair ("8.000 د.ك." + struck "10.000 د.ك.") fits one line only when both amounts are short; with a
  two-digit amount (the block is 120 px at 320, 155 at 390) the struck price drops to a second line. The current price then sits 17-20 px higher than the
  neighbour's non-sale price (3 of 6 rows in the first 12 at 390, 3 of 6 at 320; category 1-2 rows; home 1), and that row is 18 px taller (259 -> 277 at 320,
  303 -> 321 at 390 Arabic, 303 -> 319 English). From 768 up the pair is on one line (one exception: English at 1024, 19 px). Equal heights inside the
  row still hold; rows differ from each other.
- Screenshots: `shop-mix-ar-320-a.png`, `shop-mix-en-320-a.png`, `shop-mix-ar-390-a.png`, `page-sale-ar-390.png`.
- Smallest fix (CSS), proven by injection on the mix at 390 ar: (B) `@media (max-width:639px){ .storefront-root .product-grid-card .price-card { margin-block-start: 0 !important; align-content: flex-start } }`
  puts the price right under the name on every card: spread 0 in every row, row heights unchanged. (C) the same plus `min-height: 2.6rem` also makes every row
  the same height (321-323 px) at the cost of 18 px on rows without a sale. Section: `PRICE-1112` in `sporta-shadows.css` (line 823) or `[gs-3]` in `sporta-grid.css`.

**G-08. "Sold out" is not announced to screen readers.**
- Read from the DOM: the photo link has `aria-label` = the product name, which replaces its content, so the band text "Sold out" inside it is not part of the link's
  name; the second link (the name) has no state; the sold-out "+" is `display: none` (its label "Sold out - name" is therefore never exposed). Nothing on a
  sold-out card says so to assistive technology. Related to G-01 for sighted users.
- Smallest fix: **not CSS.** `sporta-features.js`: for a card whose frame holds the band, append the band text to the photo link's `aria-label`.

### Low

**G-09. A sold-out card keeps a full-strength price; the `[gs-7]` grey rule is dead.**
- Measured: sold-out price `rgb(23, 26, 30)` (ink); the sold-out sale card (mix) keeps `rgb(179, 77, 0)`, the sale orange. `sporta-grid.css` `[gs-7]` sets the muted grey
  but loses to `!important` rules (MONO-1112 for plain, PRICE-1112 for sale).
- Fix (CSS): `.storefront-root .product-grid-card:has(.catalog-card-image a > span[class*="bg-ink"]) .catalog-card-info .price-card { color: #596571 !important }`
  after PRICE-1112 (verified by injection: all three sold-out cards go to `rgb(89, 101, 113)`).

**G-10. The "Bestseller" badge overflows its pill at 320 px in English and is two lines tall in Arabic.**
- Measured: English at 320: pill 58 px (bundle `max-width: calc(100% - 64px)` of a 124 px frame), text 75 px, `overflow: visible`, so "BESTSELL" is in the pill and "ER" is white on the
  photo under the heart; fits from 360 (81 px at 390). Arabic at 320: wraps to 2 lines, 58 x 47 px, 6 px from the heart. The badge is not admin data: it is a field of
  the bundle's built-in list, set on 2 products (Cagliari sweatshirt, Flash shorts red). The percent-off badge the repo source has (G-20) would need the same room.
- Screenshots: `badge-en-320.png`, `badge-ar-320.png`.
- Fix (CSS): under 360 px `.catalog-card-badge { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: 0 }`; `sporta-grid.css`.

**G-11. At 320 px, 5 (Arabic) and 6 (English) of the 46 real names are cut at two lines.**
- Measured: natural 3-4 lines, shown 2 with an ellipsis ("Cagliari Calcio Sweatshirt - Navy", "Cloudsoft Leggings - Army Green", "Cloudsoft Leggings - Cherry Red");
  0 at 360 and wider. The `title` tooltip does not exist on touch. This is the owner's two-line rule (`[grid-4]`, `[names-1]`); the bundle's 3-line band at under 360 px
  was removed on purpose.
- Fix: owner's call. CSS if wanted: restore the third line under 360 px (`[grid-4]` in `sporta-shadows.css`, band 4.25rem). Screenshot: `shop-mix-ar-320-a.png`.

**G-12. The struck original price is small.**
- Measured: 12 px (English) / 13 px (Arabic) at 320-1024, 12.6-13.8 px above; colour #64748B (4.76:1), weight 600, a 1.5 px line through the digits. Legible on a
  phone held close, tiring at 12 px with the line through "KWD 100.500".
- Fix (CSS): `PRICE-1112`, `.price-card > s`: 13-14 px minimum and `text-decoration-thickness: 1px`. Screenshots: `shop-mix-en-320-a.png`, `shop-mix-ar-1536.png`.

**G-13. Every first-screen photo is `loading="lazy"`; the shop's LCP element is a lazy plate.**
- Measured: 6 of 6 first-screen photos at 390 and 8 of 8 at 1280 are lazy, none has `fetchpriority`; LCP on `/shop` is the "no photo" plate (692 ms at 390, 636 ms at
  1280 in the harness), on a category page the first photo (lazy), on home the hero (eager). Small in the harness; it grows on a slow phone.
- Fix: **not CSS.** `sporta-features.js`: set `loading="eager"` and `fetchpriority="high"` on the first 4 `.catalog-card-photo` (a card's first photo), or the bundle.

**G-14. Three of the 32 photos show white bands; the backdrop painter reaches 2 of 32.**
- Measured (sandbox photos): `vanquish-tank-navy` square, 20% of the frame uncovered (33 px white above and below at 1280); `sculpt-jacket-grey` and `cloudsoft-top-navy`
  299 x 449, 16.8% (22 px at each side); the rest 0.1-3.9% (6.6 px). `data-sporta-bg` is set on 2 of 32 (`cagliari-calcio-sweatshirt-navy`, `denver-nuggets-cap-navy`); the other
  edges are not plain backdrop, so IMAGES-1112 leaves them. Mean uncovered 6.3%.
- Screenshot: `shop-mix-en-1280.png` (Vanquish Tank, top and bottom).
- Fix: data (re-crop to 4:5) or an owner decision to cover near-4:5 photos; the photo files are not CSS. Re-measure on live (G-06 caveat).

**G-15. There is no loading or error state; the shop starts as the bundle's built-in list.**
- Seen: `/shop` renders the 46 products baked into the bundle (names, prices, categories, photos) and replaces them when `/api/api.php?r=products` answers. With the API held
  for 3.5 s, or answering 500, the built-in list stays: no skeleton, no message, no sale price, no sold-out, no brand data (`state-loading-*`, `state-error-*`). Today the built-in
  prices and categories are identical to the live API's (46 of 46 compared), so it is harmless now; after a price change, a deactivation or a new sale, a slow or failed call shows
  the old price and phantom cards (the server still charges its own price).
- Screenshots: `state-loading-ar-390.png`, `state-loading-en-1280.png`, `state-error-ar-390.png`, `state-error-en-1280.png`. Fix: **not CSS** (bundle).

**G-16. Dark theme (reachable only from a browser that saved the admin's dark choice): the sale price and the heart are weak.**
- Measured (390 ar, 1280 en): sale price `#B34D00 !important` on the dark card 3.11:1 (16-18 px, fails 4.5:1), struck price 3.44:1, heart icon 2.55:1 on its white button; name 13.6:1,
  plain price 6.32-7.73:1; no sideways scroll; the photo frame stays white (`rgb(255, 255, 255)`). The storefront has no theme toggle, so the dark shop is seen only by an
  admin's own browser (`boot.js`: stored `sporta_theme` = dark and the device not dark).
- Screenshots: `dark-shop-ar-390.png`, `dark-shop2-ar-390.png`, `dark-shop-en-1280.png`, `dark-shop2-en-1280.png`.
- Fix (CSS): dark variants of PRICE-1112 (`#ff8f3d`-ish sale price, `#a8b3c0` struck) and the heart colour in `sporta-shadows.css`.

**G-17. At 150% text on a 320 px screen the buttons cover the photo.**
- Measured (root 24 px): heart and "+" are 66 px (rem sized) in a 110 px frame; names cut at two lines on 12 of 12 cards; the price text fills the card (12 of 12 flagged as touching or past its box, none visibly clipped); no sideways scroll
  at any size tested (125% / 150%, 320 / 390 / 1024). At 125% 2 of 12 names are cut at 390.
- Screenshots: `zoom150-ar-320.png`, `zoom150-ar-390.png`. Fix (CSS, optional): cap the two buttons at `min(2.75rem, 44px)`.

**G-18. Four tab stops per card, two of them to the same page; unlabelled hearts; the "+" never adds.**
- Measured: tab order per card is photo link, heart, "+", name link (46 cards = 184 stops after 11 in the header); photo link and name link share one URL. All 46 hearts are named
  "Save to wishlist" / "أضف إلى المفضلة" with no product name (the "+" has one: "Choose size - name"). Every one of the 46 products has a stock row (the 4 one-size accessories included),
  so the "+" always navigates to the product page; none adds to the bag. It is a link that looks like an add button.
- Fix: **not CSS.** `sporta-features.js`: `tabindex="-1"` on the photo link, product name in the heart's `aria-label`.

**G-19. A screen reader reads a sale price three times.**
- Read from the DOM: the `price-card` holds the current price (text), the struck price (`<s>`, not hidden) and an `sr-only` "old -> new", so the figures come out as "8.000, 10.000, 10.000 -> 8.000".
- Fix: **not CSS.** Hide the `<s>` from assistive technology (add-on JS) or drop the `sr-only` copy (bundle).

**G-20. Sort, filter and count (observations).**
- The sort (3 options; price orders by the effective, i.e. sale, price: asc 0, 2.4, 3, 3 ...; desc 49.995, 12.3, 10 ...) is component state: the URL stays `?lang=en`, a reload or Back loses
  it, and a change resets the visible count to 12. The category chips and the result count are hidden on purpose (the owner's request of 2026-11-03), so the only way to a category is
  the home tiles or an address; "Showing 12 of 46" at the foot is 12 px text. In Arabic that line uses Arabic-Indic digits ("المعروض ١٢ من ٤٦") while prices use Latin digits.

**G-21. Card width saw-tooth at 1023 -> 1024 (observation).**
- Measured: 12-card shop at 1023 px: 3 columns, 310 px cards; at 1024: 4 columns, 226 px (-27%). At 639 -> 640: 2 columns (~300 px) -> 3 (190 px), by design (`[gs-1]`). 767 -> 768 is continuous (230 px).
  Last rows are shorter after "Show more" (46 cards: 1 of 3 at 768, 2 of 4 from 1024); normal.
- Optional fix (CSS): `sporta-grid.css`, a 4-column rule from 900 px for listings.

### Defensive inputs the compiled card draws (mix data; not reachable from the live API)

`api.php` sends `on_sale` only when `0 < sale < list` (`store_effective_price`, store.php ~3118) and, since `e7db914`, does not list a product whose price is not above zero
(`product-listable.php`). These are the pictures if either rule ever failed; screenshots `shop-mix-ar-320-a.png`, `shop-mix-en-320-a.png`:

| Input | Card shows |
|---|---|
| price 0 | "0.000 د.ك." / "KWD 0.000" as a normal price |
| `on_sale` true, `list_price` missing | current 6.000, struck "0.000" |
| list 9, price 12.3, on sale | current 12.300, struck 9.000 (a "cut" that is a rise) |
| list 7, price 7, on sale | current 7.000 in the sale orange, struck 7.000 |
| list 10, price 9.99 | struck price shown; the repo's percent rule gives no badge (0.1% rounds to 0) |
| 49.995 and 100.500 | fits at 320 px (pair stacks); 3 decimals kept |

## For the owner's next task: how a card shows price today, and where the percent is computed

**Live compiled card** (`/assets/index-BtzlNXGI.js`, the product card component; the file computes no percent):

```
<span class="price-card flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-semibold tabular-nums">
  {R(price)}                                       // a bare text node: what the server charges
  {on_sale && <s class="text-xs font-semibold text-slate-400">{R(list_price)}</s>
              <span class="sr-only">{R(list_price)} -> {R(price)}</span>}
</span>
```

- **Format.** `R(n, lang)` = `Intl.NumberFormat('ar-KW' | 'en-KW', { style: 'currency', currency: 'KWD', minimumFractionDigits: 3, maximumFractionDigits: 3, numberingSystem: 'latn' })`:
  Arabic "8.000 د.ك." (number first, unit after, Latin digits, RLM marks), English "KWD 8.000". 3 decimals on every amount, both languages.
- **Normal price.** One centred line (`price-card` is centred by the bundle), 16 px / weight 850 at 320-1023 and 18.3-19.1 px from 768 (root size is fluid, 16-17 px), ink `#171a1e`.
- **Sale.** The server (`api.php` `r=products`, lines 172-182; `store.php` `store_effective_price()` ~3118-3128) puts the sale price in `price`, the regular price in `list_price`,
  and `on_sale: true` only while the window is open and `0 < sale < list`. The card then shows the current price first (inline-start: right in Arabic, left in English) in
  **#B34D00** (`PRICE-1112`, `sporta-shadows.css` line 823, `!important`), then the old price struck through, #64748B, 12 px (English) / 13 px (Arabic) at 320-1023, 12.6-13.8 px above,
  line-through 1.5 px. One line when both amounts fit (always from 768; on a phone only with short amounts), otherwise the old price wraps under the current one (G-07).
- **No percent and no sale badge** on the live card. The only badge, `.catalog-card-badge` (top-start, ink pill, white text), is the bundle's built-in `badge` field, set on 2 products ("Bestseller"),
  not a function of price and not editable in /backends. No price range or "from" line exists; every product has one price.
- **Sold out:** the price is unchanged (G-09).
- **Where a percent is computed:** nowhere in the live bundle. In the repo's own storefront source (**not** the build that is live): `src/lib/discount.js` `discountPercent(list, price)` =
  `Math.round((list - price) / list * 100)`, returned only for 1-99 and only when `price < list` and both are above zero, otherwise `null`; used by `src/components/ProductCard.jsx` line 50
  (`product.on_sale ? discountPercent(product.list_price, product.price) : null`, drawn as `-N%` in an ink pill at the photo's bottom-start, `aria-hidden`) and `src/pages/ProductDetail.jsx`
  (~line 363). Proof: `npm run test:discount-badge`. The server sends no percent.
- **The formula agrees with the numbers** on the mix data: 10 -> 8 is 20, 12 -> 4 is 67 (66.67), 100.5 -> 49.995 is 50 (50.25), 3 -> 2.4 is 20, 8 -> 7.5 is 6, 8 -> 5 is 38 (37.5), 6 -> 3.5 is 42, 10 -> 9.99 is none
  (0.1%), 7 -> 7 and 9 -> 12.3 are none. (There is no badge on the live card to compare against.)
- **To put the percent on the live build** it has to come from add-on JavaScript: `sporta-features.js` reads the products JSON the page already fetches (`price`, `list_price`, `on_sale` by slug,
  from the card's product link) and appends the pill, as BRANDMARK-1118 does for the maker's logo; CSS cannot, the number is not in the DOM. Room for it: the frame's bottom-start is free on a
  card with a "+" at bottom-end, but the sold-out band sits there (the band is at the foot, G-01), and at 320 px a badge plus the heart plus the "Bestseller" pill is tight (G-10).

## Not fixable in add-on CSS

G-02 (list order, `api.php`), G-03 (label / order, `api.php` or bundle), G-05 (bundle copy; add-on JS), G-06 (server job `make-image-variants.mjs`), G-08, G-13, G-18, G-19 (add-on JS or bundle),
G-14 (photo data), G-15 (bundle), and the percent badge (add-on JS).
CSS-fixable: G-01, G-04, G-07, G-09, G-10, G-11, G-12, G-16, G-17, G-21.

## Screenshot index (all in `grid-scan/`)

| File | What it shows |
|---|---|
| `shop-mix-ar-320-a.png`, `shop-mix-ar-320-b.png`, `shop-mix-en-320-a.png` | /shop mix at 320: sale pairs, badge, long names, sold-out, price 0 |
| `shop-mix-ar-390-a.png`, `shop-mix-en-390-a.png` | /shop mix at 390 |
| `shop-mix-ar-768.png`, `shop-mix-en-1024.png`, `shop-mix-en-1280.png`, `shop-mix-ar-1536.png` | /shop mix at 768 / 1024 / 1280 / 1536 (hearts invisible at 1280; white bands; sold-out label) |
| `shop-live-en-360.png`, `category-live-ar-390.png`, `category-live-en-1024.png` | live data, /shop and a category |
| `home-live-ar-390.png`, `home-live-en-768.png`, `home-live-en-1280.png`, `home-mix-ar-390.png` | home essentials row |
| `brand-live-ar-768.png`, `brand-live-en-1280.png`, `page-brand-nba-1-ar-390.png`, `page-brand-ahed-2-ar-390.png`, `page-brand-rheo-7-ar-1280.png` | brand pages with 4, 1, 2, 7 cards |
| `related-live-ar-390.png`, `related-live-en-1280.png`, `related-mix-en-768.png` | related row |
| `page-sale-ar-390.png`, `page-sale-ar-1280.png`, `page-sale-live-empty-ar-390.png`, `page-sale-live-empty-en-1280.png` | sale page (mix) and the live empty sale page |
| `state-loading-ar-390.png`, `state-loading-en-1280.png`, `state-error-ar-390.png`, `state-error-en-1280.png`, `state-empty-q-ar-390.png`, `state-empty-q-en-1280.png`, `state-empty-combo-ar-390.png`, `state-empty-combo-en-1280.png` | loading, error, empty |
| `sort-desc-ar-390.png`, `sort-desc-en-1280.png` | price high to low |
| `focus-en-1280-card2.png`, `focus-ar-390-card2.png`, `focus-en-1280-photolink.png`, `focus-ar-390-photolink.png`, `hover-en-1280.png`, `touch-1024-shop.png` | focus, hover, touch tablet |
| `badge-en-320.png`, `badge-ar-320.png`, `soldout-ar-320.png`, `fix-soldout-en-390.png` | badge and sold-out label, and the label with the G-01 fix |
| `dark-shop-ar-390.png`, `dark-shop2-ar-390.png`, `dark-shop-en-1280.png`, `dark-shop2-en-1280.png`, `zoom150-ar-320.png`, `zoom150-ar-390.png` | dark theme, 150% text |

## Reproduce

In the session scratchpad: `node grid-scan/run-matrix.mjs live` then `mix` (about 14 minutes each, one browser), `node grid-scan/analyse.mjs <live|mix> cols,rows,gaps,names,photo,touch,over,price`,
`probe-interact.mjs`, `probe-states.mjs`, `probe-perf.mjs`, `probe-dark-zoom.mjs`, `probe-touch.mjs`, `probe-sold.mjs`, `probe-sale-live.mjs`, `verify-fixes.mjs`, `verify-fixes2.mjs`, `screens.mjs`.
The raw data is `matrix-live.json`, `matrix-mix.json` and `probe-*.json` beside them. None of it is in the repo; say if any of it should be promoted to `scripts/`.
