# Page alignment audit, whole storefront - 2026-11-03

Read-only. Nothing was fixed, nothing was deployed. Every finding carries a ready fix; the fixes that fit the live add-on
files are one patch, `alignment-proposed.diff` (see section 4, "Proof of the patch"). Owner request: "check all page alignment".

What was audited: the live storefront **as captured** (compiled bundle, deployed add-on files, captured `/api` JSON) served by a
local mirror, because the Hostinger connector is signed out and the live site could not be probed. Tool:
`sporta-web/scripts/page-alignment-audit.mjs` (commit 8ec32896, GET only, one browser, two pages at a time; `npm run audit:align`).
Four analysts each took one lens, a second agent re-measured every finding on its own mirror, and this report merges them.

Where things are: this report; the patch `/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/audits/alignment-proposed.diff` (session scratchpad, not in the repo; the nine blocks are also in the proof scripts beside it); the tool commit 8ec32896; the npm line `audit:align` in `package.json` (already in HEAD, carried by the WIP snapshot 7cecbdbf).

In short: **no horizontal overflow anywhere** (0 of 720 crawl page-states, 0 of 544 in a second independent pass, at 320 to 1536 px in
Arabic and English), no element leaves the screen, text alignment mirrors correctly between the two languages except in one widget.
**29 findings after merging duplicates: 0 high, 16 medium, 13 low.** 24 are in the patch (live add-on files only); the rest
need the storefront rebuilt, an owner decision, or are already in HEAD. The medium ones are mostly small things a careful eye sees
(a hero arrow on the headline, the Sporta AI panel running left to right in Arabic, sold-out labels painted under the photo, a
delivery fee that reads as 10 KD in Arabic).

## 1. Coverage and what is right

### What was measured

| What | Count |
|---|---|
| Routes (34 in the tool catalogue) | `/`, `/shop`, `/shop?brand=ahed`, `?category=women`, `?category=accessories`, `?q=sculpt`, `?q=zzzzqq` (no results), `?sale=1`, product with 8 sizes and 6 fits, sold-out product, product with 1 size and 1 left, missing product, `/cart` (empty and 2 lines), `/checkout` (empty and 2 lines), `/payment/result` (with and without an order id), `/about`, `/contact`, `/wishlist` (empty and 6 saved), `/track` (and a lookup), `/review`, `/invoice/<id>`, `/returns`, `/exchange`, `/account`, `/support`, `/terms`, `/privacy`, the 404 page, `/backends` |
| States that change layout | base; bag drawer (empty, and with 2 lines on home, shop, product); Sporta AI panel (home, product, checkout); language toggle (ar to en and en to ar); size chip picked; top bar with a very long message and as a start-aligned link (both SYNTHETIC: fed through the GET of `r=slides`, the live bar is one short line). `menu-open` does not exist: the live header has no menu control (nav links are always shown in a second row), 16 page-states recorded as skipped |
| Languages | Arabic (bare URL, `dir=rtl`) and English (`?lang=en`, `dir=ltr`) on every page-state; rendered language equals the requested one on 720 of 720 |
| Widths | 320, 360, 390, 430, 768, 1024, 1280, 1536 |
| Crawl (the tool) | **720 page-states measured**, 16 skipped, 0 errored; 36,896 text containers, 76,303 blocks (18,940 primary) checked against the header gutter, 10,912 icon+label pairs, 3,224 button labels, 10,489 sibling rows, 656 form fields, 2,836 fixed or sticky entries, 134 intentional scrollers, 360 ar/en twin pairs (18,444 matched text rows). Read-only proof: 35 non-GET requests aborted, 0 submits needed cancelling |
| **Of those, 64 show the error screen** | `/account`, `/exchange`, `/returns`, `/backends` x 16: the three lazy stylesheets they preload (`Account-DqFbZs-H.css`, `Returns-DHmag5QD.css`, `AdminApp-Dw3t3z9Z.css`) are not in the capture, so the app shows "This page could not load". **656 page-states are real pages.** Those four routes are not audited by the crawl (section 5) |
| Second independent pass (lens 1) | 544 page-states (34 routes x 8 widths x ar/en), 109,242 elements walked, plus about 400 targeted loads (fixed bars, sticky boxes, cards, AI panel, drawer, hero, brand strip, top bar) |
| Lens 2 (Arabic/English, bidi) | 8 language-at-first-paint scenarios, 3 language-toggle runs frame by frame, 48 icon-direction loads (screen-matrix check of every arrow, chevron, heart, bag), digits and bidi on 25 routes x 2 languages, forms on 12 routes x 2 |
| Lens 3 (components) | about 650 loads: 248 covered-text scans (31 routes x 2 languages x 320/390/768/1280, 3 scroll positions), hero 15 widths x 5 slides x 2 languages, footer band, brand strip, nav, product title, end-of-page bars, pixel-ink centring of 136 controls; GET fixtures for a sale and a paid order (track, invoice, payment result) |
| Lens 4 (static CSS and admin) | live compiled sheet (185 KB, parsed), the 14 deployed add-on CSS, 9 add-on JS, 41 storefront and admin JS chunks, the repo `src/` (87 files); admin on fixtures: 17 screens x 390/768/1280 x light/dark x `dir=ltr`/`rtl` = 102 states, 204 renders, 43,026 element boxes |
| Verification | every finding re-measured by a second agent on its own mirror with fresh browser contexts, fonts loaded and animations finished (about 600 loads for lens 1, about 330 for lens 3; lens 2 and 4 re-measured each finding too); 6 findings were refuted or judged intended design (Appendix A), every "high" was lowered to medium, and at least 8 proposed fixes were corrected or replaced |
| Proof of the patch | this report, section 4 |

More than 3,000 page loads in total. The mirror serves the **captured** live add-on files, which are older than three deploys of
2026-11-03 (`sporta-home-trim.css` 194f739f, `sporta-cart-drawer.css` 718787f, `sporta-gov-autopick.js` 8bf6001). The crawl and
lens 1, 2 and 4 ran on the older copies (the home features band at 720-959 px therefore lacks the trim); lens 3, the verifiers of
lens 3 and the proof in section 4 overlay those three files (md5 checked against the deploy commits). Nothing in this report depends
on the difference apart from that band.

### What is right (checked, no finding)

- **Overflow: 0.** `scrollWidth` equals `clientWidth` on 720 of 720 crawl page-states and 544 of 544 in lens 1's pass, at all 8 widths in both languages. 0 elements leave the viewport (109,242 walked), 0 fixed boxes cut off, 0 overlaps between fixed boxes, 0 silent clips (every clipped box is a deliberate slider, strip or ellipsis). All 46 product pages x 2 languages at 320: 0 overflow.
- **Language and direction at first paint:** `html dir/lang` correct in 8 of 8 load scenarios (bare, `?lang=en`, `EN`, `en-US`, `fr`, `ar`, saved en, saved ar over `?lang=en`); the toggle flips direction and text in the same frame in 3 of 3 runs.
- **Gutters:** 16 px up to 639, 23 at 768, 30.7 at 1024, 38.4 at 1280, 130.5 at 1536 (container 1360 max). 18,940 primary blocks checked; every route matches the header edge at every width except the centred result and 404 cards (finding A-10, and Appendix A). Home, shop, product and wishlist align with the header edge at all widths.
- **Centring:** no section is off-centre by more than 1.5 px at 1280 and 1536; header logo centre 0 px from the viewport centre at all 8 widths x 2 languages; nav boxes 0 px off-centre with equal 40.7-42.5 px gaps; top bar text and dot centred (0 px).
- **Text alignment mirrors:** 0 of 18,444 matched rows differ in computed `text-align` class between ar and en. All 544 wrong-direction text blocks the crawl found are one widget (Sporta AI, A-03).
- **Component anatomy:** 672 product-card rows (home, shop, brand, women, accessories, search, sale, wishlist): media top and height, title top, last text and button top within 0.1 px between the cards of a row, in both languages. Icon+label pairs: 10,912 checked, only the product heart is off (A-17); icon-only buttons off-centre 0; button labels off-centre 0 of 3,224 (pixel-ink check of 136 controls: none beyond 2.5 px). Product-grid columns fill gutter to gutter at 7 widths in both languages (2, 2, 3, 3, 4, 4, 4 columns).
- **Product page, cart, forms:** size ladder chips equal 46 px with 8 px gaps, quantity stepper and buy row tops/heights equal, sticky buy-bar button centred; cart summary rows label-at-start and amount-at-end on one baseline; checkout/support/track/contact inputs 48-50 px with labels at the start edge, checkbox vs label centre 0.0 px (8 of 8), discount field and Apply equal height. Invoice table at 640 and up: amounts aligned to the same right edge in every row.
- **Mirroring in Arabic:** 15 of 15 right-pointing arrows flip, 8 of 8 category-tile arrows flip, the bag icon (64 of 64) and heart (54 of 54) correctly do not; hero scrim and copy side mirror at 1024/1280/1536; hero slider and product gallery advance the right way with arrows on the right sides; the closed bag drawer parks off-screen on its own end edge; cart and checkout total rows mirror; footer column order, social icons, filter chips and size/fit chips run right to left.
- **Static CSS:** the compiled sheet has 162 logical declarations (margin-inline 25, padding-inline 81, inset-inline 24, border-inline 9, text-align start/end 23) and 61 `[dir=rtl]` rules; physical margin/padding/border left/right 0, floats 0. The 14 deployed add-on CSS files have 0 unmirrored physical rules, the 9 add-on JS files write 0 physical inline sides, and the repo `src/` has 0 unmirrored (the repo storefront is not the live build).
- **Digits, prices, phones:** prices render digits then `د.ك.` correctly; `+965 2209 1914` reads left to right inside Arabic paragraphs; order ids are isolated; email and URL runs are isolated. Arabic letter-spacing: 1,876 Arabic text elements on 17 routes, only the transient checkout label deviates (A-28).
- **Admin on fixtures (the real compiled markup and rules, not the live admin):** re-rendering with `html dir=rtl` moved 0 of 43,026 boxes in 102 states, no element sits outside the `dir=ltr` admin root, modals centred (0.0 px) on every screen at 3 widths, no sideways overflow at 390 or 1280, light and dark alike.
- **Features band** (deployed trim overlaid): three cards equal height at every width, centred (0.0 px) from 720; footer columns equal tops at 768 and up; bag drawer filled (ar 390, en 1280) header, lines, subtotal and buttons aligned.

## 2. Findings, ranked

Severity is the verifier's. Where two verifiers differed the reason is given. "Merged" lists the lens ids folded into one finding.
Widths are CSS px. "Verified" means the proposed rule was injected on a mirror and re-measured by the verifier; section 4 repeats
that on the patch itself.

| # | Id | Sev | Page / lang | One line | Fix kind |
|---|---|---|---|---|---|
| 1 | A-01 | medium | every product page and /about, ar | The delivery fee "٢٤ ساعة · ١ د.ك" reads as 10 KD | addon-js |
| 2 | A-02 | medium | every product card, ar+en | Sold-out band, its fade and the Bestseller badge are painted under the photo | addon-css |
| 3 | A-03 | medium | Sporta AI panel, ar | The panel is left-to-right on an Arabic page; the full stop lands at the wrong end | addon-css |
| 4 | A-04 | medium | home hero, ar+en, 1024-1439 | The slider arrows sit on the first letters of the headline (36 px at 1024) | addon-css |
| 5 | A-05 | medium | /track with an order, ar | The progress line runs the wrong way, sticks out of the card and makes the page pan | addon-css |
| 6 | A-06 | medium | /cart, ar | The size label (2XL) hugs the opposite edge from its title | addon-css |
| 7 | A-07 | medium | every page, ar+en | The closed bag drawer leaks a grey shadow strip onto the page edge | addon-css |
| 8 | A-08 | medium | product (phones) and checkout (up to 1023), ar+en | The fixed bar covers the last footer lines at the end of the page | addon-css |
| 9 | A-09 | medium | home brand strip, en | Brand names break in the middle of a word ("EYESPORTW / EAR") | addon-css |
| 10 | A-10 | medium | /payment/result on phones, ar+en | The result card touches both screen edges (0 px gutter) | addon-css |
| 11 | A-11 | medium | every footer, 768 and up | The two join-band buttons are thrown 280-350 px apart | addon-css |
| 12 | A-12 | medium | /cart and /checkout, 1024 and up | The sticky order summary slides under the header (10 px cart, 27 px checkout) | addon-css |
| 13 | A-13 | medium | /checkout, ar+en | The mobile-number field is a box inside a box (72 px against 48) | addon-css |
| 14 | A-14 | medium | /contact, ar+en | Two cards touch (0 px gap) | addon-css |
| 15 | A-15 | medium | home, 1024 and up | A 19 px band between the sticky header and the sticky brand strip | addon-css |
| 16 | A-16 | medium | /invoice on phones, ar+en | Unit prices and totals are off-screen (table 544 px in a 254-364 px scroller) | addon-css (partial) |
| 17 | A-17 | low | product title row, ar+en | The wishlist heart hangs 5-9 px below the title line | addon-css |
| 18 | A-18 | low | home hero, 320 | The dot strip is 338 px wide on a 320 px screen | addon-css |
| 19 | A-19 | low | /shop, 640 and up | The result count hangs 15 px under the Sort control's centre line | addon-css |
| 20 | A-20 | low | /checkout | The Governorate select is 2-2.6 px taller than the Area input beside it | addon-css |
| 21 | A-21 | low | /cart, 1024-1199 | The item title column is 95 px wide at 1024 (titles wrap to 3-5 lines) | addon-css |
| 22 | A-22 | low | /track, ar | The Arabic placeholder in the LTR order-id field has its colon on the wrong side | addon-css |
| 23 | A-23 | low | bag drawer, ar, 768 and up | Opens on the far side from the bag button (optional, owner decision) | addon-css (optional) |
| 24 | A-24 | low | cards with an old price, phones | Current price lands on different lines in one row (latent: nothing is on sale) | addon-css (not in patch) |
| 25 | A-25 | low | Sporta AI input, ar+en | The placeholder is wider than its field | needs-storefront-rebuild |
| 26 | A-26 | low | Arabic site | Two numeral systems on one screen | needs-storefront-rebuild (owner picks) |
| 27 | A-27 | low | eyebrows, ar | "SPORTA /" on some pages, "سبورتا /" on others | owner-content |
| 28 | A-28 | low | checkout total, ar | Letter-spacing -0.025em on the Arabic "calculating total" words | addon-css |
| 29 | A-29 | low (unclear) | /backends at 768-1100 | Orders, Inventory, Catalogue overflow sideways (fixtures only) | none (already in HEAD) |

### Medium

**A-01 - the Arabic delivery fee reads as 10 KD.** Pages: every `/product/*` (delivery list) and `/about` (the "why" card heading); ar; checked at 390 and 1280. [merged: L2-03]
Evidence: the string is "التوصيل خلال ٢٤ ساعة · ١ د.ك" with U+00B7 directly before the Arabic-Indic digit one. In a right-to-left line the dot ends up at mid height beside the 1, and 2x and 4x crops read "٢٤ ساعة ١٠ د.ك": the 1 KWD fee reads as 10 KWD. The English twin ("24 hours · 1 KWD") reads correctly. The repo source has the same pattern (`src/i18n/translations.js` line 582).
Cause: content, in the compiled i18n bundle. Fix (addon-js, `sporta-features.js`, in the patch): a second IIFE writes "بـ" in place of the dot in the text node (`nodeValue` only, nothing added or removed, re-applied by a MutationObserver when React rewrites the node), giving "٢٤ ساعة بـ ١ د.ك", the wording the repo's own top-bar copy uses. Verified by the verifier at 390 and 1280 on product and About, no overflow, and in section 4 (also after four language toggles ar-en-ar-en-ar on both pages, where React rewrites the node). The same dot sits after "داخل الكويت" in the bundle's default top-bar line, which shows for a moment before the owner's message arrives; the regex covers it too. Permanent: change the string at the next rebuild.

**A-02 - sold-out band, white fade and Bestseller badge are painted under the photo.** Pages: `/shop`, home best-sellers, `/wishlist`, related products (every card); ar+en; 320, 390, 768, 1280. [merged: L3-02; same as F2-01 in the fonts audit]
Evidence: `img.catalog-card-photo` is `relative z-[1]`; the veil, the "Sold out" band and `.catalog-card-badge` are `position:absolute` with z-index auto. `elementFromPoint` at the centre of every band returns the `<img>` (2 of 2 sold-out cards in `/shop`, ar and en, 390 and 1280; the Bestseller badge 1 of 1 at 1280). The stock data has two sold-out backpacks, so this is visible today. The add button is hidden on those cards and the product page says sold out, so a shopper is not misled for long, but the card looks ordinary. Live products have `image=null` (the placeholder SVG, opaque `#f3f5f7`); a real opaque photo covers the overlays the same way.
Cause: compiled bundle. Fix (addon-css, `sporta-grid.css`, in the patch): `z-index:2` on `.catalog-card-image > a > span.absolute:not(.image-loading-skeleton)` and `.catalog-card-image .catalog-card-badge`. Verified: label and badge on top in every state; the wishlist heart (z 10) stays above. Severity: the lens said high, both verifiers medium. HEAD status: the repo's `sporta-ui-colours.css` (block C4, not live, unreviewed) already lifts the band and the fade (2 of 2 on top on the HEAD copies) but not the badge (0 of 1), so the badge half is still open there.

**A-03 - the Sporta AI panel is left-to-right on Arabic pages.** Pages: every page (the widget is in the header), panel open; ar; 320-1536. [merged: L1-05, L2-01, L4 ai-panel, V full-stop; same as F3-01]
Evidence: the dialog computes `direction:ltr` at all 8 widths. At 390: chips start at x=33 (left), close button at 328-357 and Send at 297-361 on the right, mic on the left (29-69), greeting bubble hugs the left (33-308), and the closing full stop of every Arabic sentence sits at the wrong end of the line (x=283, the right end). At 1280 the panel is at 859-1263 and the launcher at 136-235, about 620 px apart. The English panel is correct. The crawl flagged 544 wrong-direction blocks (328 launcher labels, 216 panel blocks): every one on the site.
Cause: compiled `.storefront-root .navbar-main{direction:ltr}`; the dialog is rendered inside it. Fix (addon-css, `sporta-product-fix.css`, in the patch): `html[dir="rtl"] .navbar-tools div[role="dialog"] > * {direction:rtl}` (children only, so the panel box does not move). Verified at 390: close 33-62, Send 29-93, first chip 279-357, mic on the right, panel box unchanged (16-374 and 859-1263). Not changed: the launcher label "سبورتا AI" (same Arabic string in both languages; flipping it would reverse the wordmark; owner decision) and the clipped placeholder (A-25). One analyst's rule also flipped the label and moved the panel to the left; the verifier rejected both.

**A-04 - hero slider arrows sit on the headline from 1024 to 1439.** Pages: home hero; ar+en; 1024-1439 (overlap 36 px at 1024, 34 at 1100, 31 at 1200, 29 at 1280, 21 at 1366, 4 at 1400; 0 at 1000 and below and from 1440). [merged: L1-03, L2-04, L3-01]
Evidence: the two 46 px arrows are always visible (opacity 1) at x 21-67 and vertically centred; the copy starts at the page gutter (31 px at 1024, 38 at 1280, 47 at 1366). English: 5 of 5 titled slides hit (36/19/19/36/19 px at 1024, 29 px on every slide at 1280). Arabic: slide 1 only (the other slides' copy sits on the physical left, away from the start arrow). A screenshot at en 1280 shows the arrow on the "L" of "LOOK BETTER.". The hero is a fixed 640 px, so viewport height makes no difference.
Cause: compiled bundle (arrows at `md:start-5`/`md:end-5`, copy at the gutter). Fix (addon-css, `sporta-home-trim.css`, in the patch): `padding-inline:5rem` on `.campaign-home .campaign-photo-hero .campaign-hero-content` for 1024-1439.98 px. Verified: 0 overlap on every slide at 1024, 1100, 1280, 1366 and 1439 in both languages, title heights and the 640 px hero unchanged. Both sides, because a start-only padding cleared English but pushed Arabic copy-end text 3-10 px onto the other arrow at 1100 and 1200. Rejected alternatives: moving the arrows to the top corners with `transform:none` (the arrows use `translate`, so one lands 2 px above the hero, under the header) and 4.5rem on `.campaign-hero-copy` (copy up to 170 px taller). Severity: the lens said high, the verifier medium.

**A-05 - the order-tracking progress line runs the wrong way in Arabic.** Page: `/track?trackid=<found order>`; ar; 320-1536 (tested with a GET fixture: paid, shipped). [merged: L3-03, L4 track-stepper, V track-page-sideways-scroll]
Evidence: at 390 the circles are at x=315/235/155/75 but the connectors are [159,235] orange, [79,155] orange, [-1,75] grey: no line between the first two circles, an orange line leading into "delivered" (not reached), and a grey stub that leaves the card (card 16-374) by 8 px at 320, 17 at 390, 52 at 768, 51 at 1280. The stub also makes the page pan sideways: `scrollWidth` 391 at 390, 436 at 430, 797 at 768 (scrollX -1, -6, -28). English is correct.
Cause: TrackOrder chunk, `-translate-x-1/2` with no `rtl:` twin. Fix (addon-css, `sporta-returns-touch.css`, in the patch): `:root[dir="rtl"] .track-progress > li > span.absolute {--tw-translate-x:50%}`. Verified: connectors [235,311], [155,231], [75,151] at 390 (the exact mirror of English), wrong connectors 3 to 0 and outside-card 1 to 0 at six widths and two statuses, `scrollWidth` back to the viewport. Severity: two lenses said high, both verifiers medium (circles, ticks, current-step label and dates are right; only the line is wrong).

**A-06 - the Arabic cart's size label hugs the wrong edge.** Page: `/cart` with items; ar; all widths (the label is 146 px from the title's edge at 320, 216 at 390, 258 at 768, 215 at 1280). [merged: L1-07, L2-02, L4 cart-label]
Evidence: the size paragraph is `dir="auto"` and holds only Latin letters, so it resolves to ltr and `text-align:start` is the physical left, while the Arabic name and the price are flush right. English is flush left. All sizes (S, M, L, XL, 2XL) are Latin, so every Arabic cart line is affected.
Cause: compiled bundle (Cart chunk). Fix (addon-css, `sporta-bag-touch.css`, in the patch): `html[dir="rtl"] .cart-line p[dir="auto"] {width:fit-content}`: a shrink-wrapped block is placed by the right-to-left column, so it sits on the right under the title (a verifier proved it: label right edge equals the title's at 8 widths). Two other proven variants were not used: `text-align:right` works, but the audit tool then flags the label as `align-opposes-direction` (a right-aligned left-to-right block; section 4 saw this on the first run of the patch), and `direction:rtl` reverses the trailing punctuation of a Latin product name.

**A-07 - the closed bag drawer's shadow bleeds onto the page edge.** Every page; ar+en; all widths. [merged: L3 M-01; same as F3-06]
Evidence: `aside.campaign-cart-drawer[aria-hidden=true]` is parked off-canvas but keeps `shadow-2xl` (`0 25px 50px -12px`): red channel 235, 236, 236, 237, 238, 239, 240, 241 from the page edge on a white page, over about 38 px (left edge in Arabic, right in English). A pale grey band in every full-page screenshot.
Cause: compiled bundle. Fix (addon-css, `sporta-cart-drawer.css`, in the patch): `box-shadow:none` for `[aria-hidden="true"]`; the open drawer keeps its shadow. Verified: edge column 255.

**A-08 - the fixed bottom bars cover the last lines of the footer.** Pages: `/product/*` (bar 73 px, below 768) and `/checkout` (pay bar 69-71 px, below 1024); ar+en. [merged: L1-01, L3-10; 42 crawl page-states]
Evidence: footer `padding-bottom` is 0 px. Scrolled to the end: product ar at 320 and 360, 25 of the 34.7 px legal paragraph hidden; ar at 390 and 430, the whole operator line (17.3 of 17.3 px) hidden and the copyright line loses 3.6 px; en at 320-430, 25 of 32 px. Checkout 20.7-21.4 px at 320-430 (ar 390 and 430: 17.3 of 17.3), 4.7-5 px at 768 and 1023.
Cause: compiled bundle (`.action-bar` and `.purchase-paybar` are `position:fixed; bottom:0`; the only footer rule is the safe-area inset). Fix (addon-css, `sporta-checkout-a11y.css`, in the patch): `padding-bottom:calc(3rem + var(--sa-bottom,0px))` on `.app-footer` when the page has an `.action-bar` (below 768) or a `.purchase-paybar` (below 1024). 3rem leaves 0 px hidden with 15-23 px to spare on the live footer. The verifier's 2.5rem also cleared the live footer, but it leaves 1-2 px of the last line under the bar on the repo's compacted footer (section 4); the analysts' 5-5.25rem over-pads by about 44 px. Note for the sizes lane: HEAD's footer compaction makes this finding worse (checkout at 768: 19 px of the line hidden against 5.6 px live).

**A-09 - English brand names break in the middle of a word.** Page: home brand strip; en (ar only wraps between words at 1024); 320-1536. [merged: L1-04, L3-04]
Evidence: "Eyesportwe|ar" at 320-768 (tile 132-134 px, room 112-114), "Eyesportw|ear" at 1280 (tile 127) and 1536 (tile 137); at 1024 (tile 94, room 73) "Gymsha|rk" and "Eyespo|rtwear". The font is the self-hosted Plex, so live widths match. (The Vanquish break at 1024 on the mirror is an artefact: live Vanquish has a logo.) The strip is data-dependent: a brand with an uploaded logo is an image tile.
Cause: add-on `sporta-images.css` (uppercase + `letter-spacing:.06em`) on top of the compiled `overflow-wrap:anywhere`; the fit guard in `sporta-features.js` (`fitStrip`) measures a Range that has already wrapped, so it never sees a too-wide name and never shrinks it. Fix (addon-css, `sporta-images.css`, in the patch): `white-space:nowrap; overflow-wrap:normal` on the English text tiles, so the guard measures the real width and shrinks the font, plus 4 px less side padding at 1024-1279. Verified: 0 mid-word breaks at 320, 360, 390, 430, 768, 1280, 1536. Residual: the guard takes "Eyesportwear" to 12 px (320-768), 10 px (1024-1100), 11 px (1280); at 1024-1100 it is 88 px in a 94-104 px tile (inside the border by about 3 px, at the guard's 10 px floor). A real logo for that brand removes the case. Raising the tile floor to 7.25rem does nothing (the grid column sets the width).

**A-10 - the payment result card touches both screen edges on phones.** Pages: `/payment/result` (and `?trackid=`); ar+en; 320-576 (also 5 px outside the gutter at 607-608). [merged: L1-02, L3-12]
Evidence: the bordered, rounded card spans [0,320], [0,360], [0,390], [0,430], [0,576] against a 16 px header gutter (17.3 at 576); at 768 it is centred at [90.6,677.4]. The crawl reported this as "gutter-diff 5 px" on the inner box and missed that the card itself is flush.
Cause: compiled bundle (`.purchase-result` has `margin-block` only and an inner `px-5`). Fix (addon-css, `sporta-checkout-a11y.css`, in the patch): `max-width:min(36rem, 100% - header gutters)` on `main .purchase-result`. Verified: [16,304], [16,344], [16,374], [16,414], [17.3,558.7] and [18.2,588.8] at 607; unchanged from 608. Severity: one verifier said medium, the other low (white card on a white page, hairline border and faint shadow); shown as medium because it is the page every buyer sees after paying.

**A-11 - the footer join band throws its two buttons apart.** Every page's footer; ar+en; 768 and up. [merged: L3-05]
Evidence: the gap between the WhatsApp and Call buttons is 82 / 142 / 197 / 314 / 347 px (ar) and 47 / 107 / 163 / 279 / 311 px (en) at 768 / 900 / 1024 / 1280 / 1536.
Cause: add-on `sporta-footer-call.js` inserts a third child into the compiled two-child `justify-content:space-between` row. Fix (addon-css, `sporta-home-trim.css`, in the patch): `justify-content:flex-start; gap:.75rem` and `margin-inline-end:auto` on the copy, from 768 up. Verified: 12-13 px between the buttons at every width in both languages, copy at the start edge.

**A-12 - the sticky order summaries slide under the header from 1024.** Pages: `/cart` (summary `top:8rem`) and `/checkout` (aside `lg:top-28`); ar+en; 1024, 1280, 1536. [merged: L1-08]
Evidence: the header ends at 142.8 / 145 / 146.5 px. The cart summary sticks at 132.5 / 134.6 / 136 (10.3-10.5 px of its top border and corners hidden); the checkout aside at 116 / 117.8 / 119 (26.8-27.5 px hidden: card top and padding gone, the "Order summary" heading about 8 px under the header).
Cause: compiled bundle (sticky tops smaller than the header). Fix (addon-css, `sporta-checkout-a11y.css`, in the patch): `top:9.5rem` for both from 1024. 9.5rem is the value HEAD's `sporta-checkout-a11y.css` already uses for the checkout aside (so that half is already in HEAD but not live; the cart half is new). Measured with this value (section 4): both boxes stick 14.8 px below the header at 1280 (the verifier had measured 9.75rem). Severity: cart half low, checkout half medium.

**A-13 - the checkout mobile-number field is a box inside a box.** Page: `/checkout`; ar+en; all widths. [merged: L3-08]
Evidence: the group is 70 px tall at 320 and 390, 71.2 at 768, 73.5 at 1280, against 48 / 48.9 / 50.5 for the Full name field. Its wrapper keeps the shared input padding and its own border, and the inner input keeps a second border and a 12 px radius (double border in screenshots).
Cause: compiled bundle (Checkout chunk): `px-3 py-2.5` from the shared input classes come after `p-0` and win. Fix (addon-css, `sporta-checkout-a11y.css`, in the patch): wrapper `padding:0`, inner input no border and radius, `min-height:calc(3rem - 2px)`. Verified: the group equals the Full name field at 320, 390, 768, 1280. The +965 chip staying on the left in Arabic is deliberate (number shown left to right).

**A-14 - two cards touch on /contact.** ar+en; all widths. [merged: L3-07]
Evidence: the "Track order" and "Support centre" cards are plain siblings with no margin: 0 px apart at 390, 768, 1280 (the two cards above sit in a grid with a 20 px gap).
Cause: compiled bundle. Fix (addon-css, `sporta-returns-touch.css`, in the patch): `div.support-card + div.support-card {margin-block-start:1.25rem}`. Verified: 20-21 px.

**A-15 - a 19 px band between the sticky header and the sticky brand strip.** Page: home; ar+en; 1024-1536. [merged: L3-06]
Evidence: the strip sticks at 9.75rem (156 px); the header ends at 142.8 / 145 / 146.5 px: a constant 18.7-19.3 px gap in which tiles and photos scroll through (5 of 5 sample points hit page content). The two stuck bars take 27-28% of the viewport height.
Cause: compiled bundle (sticky offset from a taller header). Fix (addon-css, `sporta-home-trim.css`, in the patch): `top:8.6rem` from 1024. Verified: gap -0.3 px at scroll 700, 900, 1100. Caveat: 8.6rem is as hard-coded as the original 9.75rem; the header has no height variable, so if the top bar is ever switched off (about 32 px less) a gap of about 34 px reopens.

**A-16 - the phone invoice hides its prices.** Page: `/invoice/<id>`; ar+en; 639 and below (tested with a GET fixture). [merged: L3-11]
Evidence: the table is `min-w-[34rem]` (544 px) inside an `overflow-x:auto` region of 254 / 324 / 364 px at 320 / 390 / 430. The unit prices (2 cells) and the line totals and all the totals rows (6 cells) are off-screen at the inline end, with nothing saying it scrolls. At 640 and up the columns are aligned. The sideways scroller is deliberate and accessible (`role=region`, `tabIndex=0`), so this is partly intended design; the first view is still weak.
Cause: compiled bundle (Invoice chunk). Fix (addon-css, `sporta-returns-touch.css`, in the patch): `min-width:0`, `table-layout:auto`, `.25rem` cell padding, wrapping text below 640. Verified at 390 and 430 (no scroll, both languages). **Not at 320:** the table still needs about 50 px more than the card has and keeps its scroll. Confidence medium.

### Low

**A-17 - the wishlist heart hangs below the one-line product title.** `/product/*`; ar+en; centre of the 46 px heart minus centre of the title's first line: +8.4 px at 320-430, +8.5 at 768, +8.7 at 1024, +5.3 at 1280, +1.5 at 1536. [merged: L1-10, L3-09] Cause: compiled `items-start` with a fixed `mt-0.5` and a fluid title size. Fix (addon-css, `sporta-product-fix.css`, in the patch): `margin-block-start:calc((1.3 * clamp(1.5rem,2.4vw,2.25rem) - 2.75rem) / 2)` on the heart; offset 0 at every width and the heart stays on the first line of a two-line title. (An `align-items:center` variant was rejected: it moves the heart to the middle of two-line titles.)

**A-18 - the hero dot strip is wider than a 320 px screen.** Home; ar+en; 320 only (fits from 340). The strip (7 dots x 40 px hit boxes + the 40 px pause button) is 338 px, x -9 to 329, so the outer dot and the pause button are cut by 9 px each side. [merged: L3-13] Fix (addon-css, `sporta-home-trim.css`, in the patch): `min-width:2.25rem` on the dot boxes below 340: strip 5-315. Not fixed: the dot hit boxes (top 618) overlap the CTA (bottom 622) by 4 px at 320-430. The pause button is only drawn without `prefers-reduced-motion`; with reduced motion the strip is 14-306 and looks clean, which is the trap that made this look unreproducible.

**A-19 - the result count hangs under the Sort control.** `/shop` (and brand, category, search views); ar+en; 640 and up. The count's centre is 14.3 px (ar) / 15.3 px (en) below the select's centre. [merged: L3-14] Cause: compiled `align-items:flex-end`. Fix (addon-css, `sporta-grid.css`, in the patch): `align-items:center` from 640. Verified: 0.0 px. Moot once the repo's shop-header trim ships: HEAD's `sporta-grid.css` hides the count, the intro and the category chips (`display:none`), so the count is not on the page there.

**A-20 - the Governorate select is taller than the Area input.** `/checkout`; ar+en. 50.4 vs 48 px at 320-430, 51.8 vs 48.9 at 768, 52.2 vs 49.7 at 1024, 52.6 vs 50.5 at 1280. [merged: L3-15] Fix (addon-css, `sporta-checkout-a11y.css`, in the patch): `select{height:3rem; min-height:3rem; box-sizing:border-box}`. Verified: equal at every width, the text still fits.

**A-21 - the cart's item column is squeezed at 1024-1199.** `/cart` with items; ar+en (worse in ar). The summary column takes 381 px of 932, so the title column is 95 px at 1024 (English titles wrap to 3-4 lines, Arabic to 3-5), 158 at 1100, 241 at 1199; from 1200 nothing changes. [missed by the lens, found by the verifier] Fix (addon-css, `sporta-bag-touch.css`, in the patch): `grid-template-columns:minmax(0,1fr) 19rem` for 1024-1199.98: 161 / 225 / 308 px, lines 2 and 2.

**A-22 - the /track order-number placeholder has its colon on the wrong side.** `/track`; ar; all widths. The input is `dir=ltr` (right for a Latin order id) but the placeholder is Arabic ("مثال: SP1A2B3C"), which reads as "SP1A2B3C :مثال". [merged: L2-07, L4 track-input, V placeholder-fix] Fix (addon-css, `sporta-returns-touch.css`, in the patch): `direction:rtl` while the placeholder shows, plus `text-align:right` once something is typed, so the typed id does not jump to the other edge on the first keystroke. The checkout phone field is not touched. Content alternative: a Latin-only example.

**A-23 - the bag drawer opens on the far side from the bag button in Arabic (OPTIONAL).** Any page, 768 and up (full width below), ar. The header grid is forced left-to-right on purpose, so the bag button is at the physical right in both languages (x 1195-1242 at 1280); the drawer follows the page direction and opens at the physical left in Arabic: [0,456] at 768, [0,471] at 1280, [0,476] at 1536 (English [809,1280]). [merged: L1-09, L2-06 drawer] Owner decision: the header itself (logo centred, clock and AI left, language and bag right, in both languages) is deliberate and is not a finding. If wanted, the patch's A-23 block (`left:auto; right:0` and `--tw-translate-x:100%` on the closed `rtl:-translate-x-full` class) opens it beside the bag: open [809,1280], closed [1280,1751] (off-screen), no overflow, text still right to left. A first version without the translate override left the closed drawer in view.

**A-24 - the current price lands on different lines on two-up phone cards (latent).** `/shop`, home, wishlist when a product has `list_price > price`; 320-430. Nothing is on sale today; with synthetic sale prices it showed in 1 of 24 width/language combinations (ar 390: the current price starts 18 px higher on the card whose old price wraps). [merged: L3-16] Fix: `flex-direction:column-reverse` below 768 on `.price-card`, verified, but it restyles the card, so it is **not in the patch**.

**A-25 - the Sporta AI input placeholder is wider than its field.** Every page, panel open; ar+en; all widths. The placeholder overflows by 120 px (ar) / 161 px (en) at 320, 50 / 91 at 390, 24 / 65 at 430, about 25 / 69 from 768; at 390 the Arabic one loses its first word with a stray joiner. [merged: L1-06] The lens's CSS fix (`text-overflow:ellipsis`) shows nothing while the input is focused, and the panel focuses it on open, so there is no add-on fix. Fix: a shorter placeholder string at the next rebuild. Severity lowered by the verifier (a cut hint, usable field).

**A-26 - two numeral systems in Arabic.** Prose from the translation file uses Arabic-Indic digits and the Arabic percent sign (top bar "٢٤ ساعة", "خصومات حتى ٦٠٪", result count "٤٦", "اعرض ١٢ منتجًا آخر", steps "١ ٢ ٣ ٤", hint "٨ أرقام"); prices, cart quantities, phone, year and the features band use Western digits ("8.000 د.ك.", "3 قطع", "100%"). Both appear on one view on `/`, `/shop`, `/product/*`, `/checkout`, `/about` (14 routes sampled). [merged: L2-05; same as F3-04 in the fonts audit] It is the collision of two documented choices (`format.js` keeps Latin digits in Arabic; `translations.js` writes Arabic-Indic), not a layout failure. Owner picks one system first; then one rule at the next rebuild (recommended: Western digits, as money, phone, ids and sizes already are), plus a `test:arabic` check that fails on any Arabic-Indic digit.

**A-27 - the Arabic eyebrow names the brand in Latin on some pages and in Arabic on others.** ar. "SPORTA / ..." on `/about`, `/contact`, `/privacy`, `/terms`, `/track`, `/wishlist` and the footer on every page; "سبورتا / ..." on `/shop*`, `/product/*`, `/support`. Bidi is correct either way. [merged: L2-09] Owner picks one spelling (the brand rule says Arabic-first, سبورتا); the strings change at the next rebuild.

**A-28 - letter-spacing on the Arabic "calculating total" words.** `/checkout`; ar; while the total is pending (the mirror stays in that state; live it is brief). -0.54 px at 390, -0.64 px at 1280 (-0.025em); removing it changes the phrase by 1.1 px of 180. [merged: L4 total-tracking; same as F2-17] Fix (addon-css, `sporta-checkout-a11y.css`, in the patch): `letter-spacing:0` for `[dir=rtl]` on the total.

**A-29 - the admin overflows sideways at tablet widths (fixtures only).** `/backends` Orders, Inventory, Catalogue at 768-1100 (Orders +316 px at 768, Inventory +263, Catalogue +69; under `html dir=rtl` the overflow cannot be scrolled to). Unclear: it was measured on fixtures with a stand-in for the admin stylesheet, which was never captured, so it is not confirmed on the live admin. [merged: L4 admin-768] Already in HEAD: `[sizes-admin-5]` in `sporta-admin-knet.css` carries the two rules that fix it (`min-width:0` on the content area and `position:relative` on the table frames) and is not live yet. No block in this patch. Re-measure on the live admin at 768 after that file ships.

## 3. Fixable through the live add-on files, needs the rebuild, owner content

### Fixable through the live add-on files (`alignment-proposed.diff`)

24 findings in 9 files, 276 added lines, all pure appends at the end of the file. **No `.htaccess` change is needed.**

| File (live add-on) | Findings | Added lines |
|---|---|---|
| `sporta-home-trim.css` | A-04, A-11, A-15, A-18 | 43 |
| `sporta-images.css` | A-09 | 16 |
| `sporta-grid.css` | A-02, A-19 | 18 |
| `sporta-cart-drawer.css` | A-07, A-23 (optional) | 21 |
| `sporta-checkout-a11y.css` | A-08, A-10, A-12, A-13, A-20, A-28 | 61 |
| `sporta-product-fix.css` | A-03, A-17 | 19 |
| `sporta-bag-touch.css` | A-06, A-21 | 18 |
| `sporta-returns-touch.css` | A-05, A-14, A-16, A-22 | 42 |
| `sporta-features.js` | A-01 | 38 |

Not in the patch: A-24 (latent, restyles the card), A-25, A-26, A-27 (rebuild or owner), A-29 (already in HEAD).
Four blocks are the same fixes as in `fonts-proposed.diff`: A-02 = F2-01, A-03 = F3-01, A-07 = F3-06, A-28 = F2-17. They append to the same files, so
if both patches are used ship each rule once (the second `git apply` will not match; paste the blocks by hand, or drop the duplicates).
**Deploy note:** the patch is written against git HEAD (`git apply --check` passes on 3776a4ae and 08e79b7a). The live add-on files are not HEAD's: HEAD carries
the sizes lanes' unreviewed work (the live `sporta-checkout-a11y.css` is 1.2 kB, HEAD's 24.6 kB). Do not ship HEAD's whole files; ship only the added blocks,
appended to the files as they are live today. The proof runs the same blocks on both. Deploy with the existing `vps-deploy.mjs` flow (add-on file names, plan first).
Nothing here touches the money path or the backend.

### Needs the storefront rebuilt

The live `index.html` and bundle are a different build whose source is missing from this repo, so these wait for the rebuilt storefront and
`vps-deploy.mjs --replace-storefront`, which the owner has to ask for: A-25 (shorter AI placeholder), A-26 (one numeral system), the permanent
wording for A-01 (change the string, then drop the add-on bridge), A-27 (one eyebrow spelling), a placeholder-without-colon for A-22, and the
`rtl:` twin of `-translate-x-1/2` in the TrackOrder chunk for A-05.

### Owner decision or content

- **A-23** drawer side in Arabic (optional block in the patch). The header is forced left-to-right on purpose; mirroring it is a brand decision.
- **A-26** which numeral system Arabic uses; **A-27** the Arabic eyebrow spelling.
- **Brand logos** for the English text tiles (A-09): uploading a logo for "Eyesportwear", "Gymshark" and the others turns the tile into an image and removes the break and the 10 px floor.
- **Top-bar message length:** the live message fits at every width (273 px of a 275 px slot at 320), but a message of about 100 characters is cut with an ellipsis on phones (the bar is a fixed 32 px line on purpose). Keep it to about 50 Arabic or 60 Latin characters.
- The launcher label "سبورتا AI" is the same Arabic string in both languages (documented brand decision), and it reads left to right in Arabic; flipping it is the owner's call.

## 4. Proof of the patch

**Method.** Nothing in the repo was touched. A scratch generator writes the patch with `git diff` from the HEAD blobs of the nine add-on files (appends only) and checks it with `git apply --check` against HEAD (temporary index, so the real index and working tree are not used): passes on 3776a4ae, the commit the proof trees were built from, and again on 08e79b7a when this report was committed. It then builds four scratch copies of the mirror:

| Tree | What it is |
|---|---|
| A-before | the captured live files, plus the three 2026-11-03 deploys (md5 checked against the deploy commits) |
| A-after | A-before + the patch's added lines. All 9 hunks are pure appends at the end of their file (asserted), so they sit after whatever the live copy has |
| B-before | the captured live storefront with the 22 add-ons its `index.html` links replaced by git HEAD's versions: what is served once the sizes and CSS lanes ship |
| B-after | B-before + the whole patch applied with `git apply` to those HEAD files |

Then: **22 probes** (one per finding; one probe covers A-13, A-20 and A-28), each a purpose-built page script that measures the exact property the finding names, GET only, with fixtures only for the order, invoice and bag, run on all four trees: **190 page loads per A tree** (ar and en, up to 9 widths for the width-sensitive findings, the rest of the 8 widths included) and **98 per B tree**; and **the audit tool** itself on A-before and A-after: 9 routes (home, shop, product, cart, checkout, payment result, contact, wishlist, track) x base / Sporta AI panel / size selected x 390 and 1280 x ar and en = **52 page-states each**, 0 errored. The machine was shared and heavily loaded (load average 40-90 on 4 CPUs), so no timing is claimed; two Arabic size-selected product states timed out on a click under that load and were re-run (the tool's `RESUME`).

**Per finding, before -> after** (live copies = A; the HEAD column says what the repo's own add-ons already do):

| Finding | Measure | Live copies: before | Live copies: after | HEAD copies (B) |
|---|---|---|---|---|
| A-01 | Arabic loads with the dot before the Arabic-Indic 1 (product and About, 390 and 1280) | 4 of 4 | 0 of 4: "٢٤ ساعة بـ ١ د.ك"; English unchanged; also correct after 4 language toggles ar-en-ar-en-ar on both pages | 2 of 2 -> 0 of 2 |
| A-02 | "Sold out" bands on top by hit test / Bestseller badges on top (320, 390, 1280, ar+en) | 0 of 12 / 0 of 3 | 12 of 12 / 3 of 3 | bands already 8 of 8 (`sporta-ui-colours.css` C4); badge 0 of 4 -> 4 of 4 |
| A-03 | Arabic AI panel at 390 / 1280 / 320 / 768: first chip's start edge, close button edge, full stop at the line's left end | chip x 33 / 877 / 33 / 378; close x 328 / 1214 / 258 / 704; stop at left: no | chip x 279 / 1163 / 209 / 655; close x 33 / 877 / 33 / 378; stop at left: yes. Panel box unchanged (16-374, 859-1263); English identical before and after | same as live, before and after |
| A-04 | worst overlap of an arrow with the headline, 7 slides stepped through, 1024 / 1100 / 1280 / 1366 / 1439 / 1440, ar+en | 35.5 px (up to 4 of 7 slides) | 0 px on every slide; copy height 251-316 px unchanged | 35.5 -> 0 |
| A-05 | Arabic `/track`, 320 / 390 / 768 / 1280: connectors on the wrong circles / connectors outside the card / page overflow | 12 / 4 / 29 px | 0 / 0 / 0 px; connectors at 390 [235,311], [155,231], [75,151] (the mirror of English) | 6 / 2 / 29 -> 0 / 0 / 0 |
| A-06 | Arabic cart size label, distance from its title's edge, 320-1280 | up to 258 px | 0 px at all four widths (English unchanged) | already 0 in HEAD (`sporta-bag-touch.css` [ux-cart-1]) |
| A-07 | red channel at the page edge (390 and 1280, ar+en); closed drawer shadow | 235; present | 255; none | already none in HEAD (`sporta-cart-drawer.css`) |
| A-08 | footer's last line under the fixed bar, worst / least clearance (22 bar states: product 320-430, checkout 320-1023) | 25.8 px under | 0 px under; 22.5 px clear at least; footer padding-bottom 0 -> 48-50 px | 41.1 px under (HEAD's compact footer is worse) -> 0 px under, 6.9 px clear |
| A-09 | English brand names broken mid-word (320, 390, 768, 1024, 1280, 1536) / tiles whose text overflows | 8 breaks (Eyesportwear x6, Gymshark, Vanquish at 1024) / 0 | 0 breaks / 1 (Eyesportwear at 1024: 88 px of text in the 94 px tile, at the guard's 10 px floor); font 14.5 -> 12 (320-768), 10 (1024), 11 (1280) px | same |
| A-10 | result card flush to a screen edge (320, 360, 390, 430, 576, 607, 608, 640, 768, ar+en) | 10 of 18 (all at 576 and below); inset 13.1-13.6 px against 18.2 at 607-608 | 0 of 18; insets equal the header gutter (16, 17.3, 18.2); 640 and 768 unchanged | same |
| A-11 | gap between the WhatsApp and Call buttons, 768 / 1024 / 1280 / 1536 | 48-347 px | 12-13 px | same |
| A-12 | part of the sticky summary hidden under the header (sticky `top` against header bottom), 1024 / 1280 / 1536 | cart 10.3-10.5 px; checkout 26.8-27.5 px | 0; both stick 14.6-15.0 px below the header | both already 0 in HEAD (9.5rem: `sporta-bag-touch.css` [ux-cart-7], `sporta-checkout-a11y.css`) |
| A-13 | phone group height minus Full name field (390, 1280) | +22-23 px | 0-0.4 px | same |
| A-14 | gap between the two contact cards (390, 768, 1280) | 0 px | 20-21 px | same |
| A-15 | gap between header and sticky brand strip, 1024 / 1280 / 1536; tile samples visible in it | 18.7-19.3 px; 30 samples | -0.3 px; 0 samples | same |
| A-16 | invoice money cells clipped / table against scroller (320, 390, 430) | 84 of 84 (14 per load); table 544 in 254-364 | 14 of 84: 0 at 390 and 430 (table = scroller); **320 still 7 of 14 per load** (table 314-319 in 254) | 390: 28 -> 0 |
| A-17 | heart centre minus title first-line centre (390-1536, ar+en) | 1.5 to 8.7 px | 0 px at all five widths, one- and two-line titles | same |
| A-18 | hero dot strip at 320 (left..right) | -9..329 (18 px cut) | 5..315 (0 cut); 340 unchanged | same |
| A-19 | result count centre minus Sort select centre (768, 1280) | 13.8-15.3 px | 0 px | count is `display:none` on HEAD (shop-header trim) |
| A-20 | Governorate select minus Area input (390, 1280) | +2.1-2.8 px | 0-0.4 px | same |
| A-21 | cart item title column at 1024 / 1100 / 1199 / 1200 | 95 / 158 / 241 / 242 px (Arabic lines at 1024: 3 and 5) | 161 / 225 / 308 / 242 px (lines 2 and 2) | same |
| A-22 | Arabic `/track` input: direction while the placeholder shows / text-align once typed | ltr / start | rtl / right; English unchanged | same |
| A-23 | (optional) Arabic bag drawer at 768 / 1280: open / closed | open [0,456] / [0,471]; closed [-456,0] / [-471,0] | open [312,768] / [809,1280]; closed [768,1224] / [1280,1751] (off-screen) | same (one HEAD sample was taken mid-transition on the loaded machine; a separate run showed [0,471] after 800 ms) |
| A-28 | Arabic checkout total letter-spacing (390, 1280) | -0.54 / -0.64 px | normal | same |

Horizontal overflow across all probe loads: **A-before 2 of 190 -> A-after 0 of 190** (the two Arabic `/track` loads of A-05); B-before 2 of 98 -> B-after 0 of 98. Language rendered equals the one requested in every load.

**The audit tool, A-before -> A-after** (52 page-states each, 1,457 primary blocks, 3,221 text containers):

| Counter | Before | After |
|---|---|---|
| horizontal overflow / boxes leaving the viewport / fixed boxes overlapping or cut off | 0 / 0 / 0 | 0 / 0 / 0 |
| gutter mismatches against the header edge | 1 (home, AI panel open, ar 1280) | 0 |
| wrong-direction text blocks | 80 in 32 page-states | 32 in 29 page-states, none on an Arabic panel: the launcher label "سبورتا AI" (26: 13 Arabic and 13 English pages at 1280) and the title of the English page's panel (6), the same Arabic brand string, left to right on purpose. On the Arabic pages: 61 -> 13 |
| form fields flagged | 8 (AI input x 6, `/track` order id x 2) | 0 |
| icon pairs off | 12 (the product heart) | 0 |
| fixed bar covering content at page end | 8 hits in 6 page-states (product, checkout, 390) | 0 |
| ar/en pairs: text not mirrored / icon side differs | 16 / 58 | 0 / 52 |
| sibling rows flagged | 12 | 12 (the product title/heart row: the tool judges a flex-start row by its tops, and the heart's centre delta went 5.3 -> 0 px while the top delta went 2.1 -> 3.2 px) |
| read-only proof | 10 non-GET aborted, 0 submits | 8 non-GET aborted, 0 submits |

**What the proof changed in the proposals.** (1) The analysts' hero-dot rule `.group\/dot` would also have resized the product gallery dots, and the scoped version `.campaign-photo-hero .group\/dot` matches nothing (the dots are siblings of the slides); the patch uses `main div.absolute.bottom-5 > button.group\/dot` (cut 18 -> 0). (2) A-08 started at the verifier's 2.5rem; on the HEAD copies it left 1-2 px of the last line under the bar, so the patch uses 3rem. (3) A-06 started as `text-align:right` and made the tool flag 4 new blocks (`align-opposes-direction`), so it is now `width:fit-content`. (4) A-01's regex also covers "الكويت" for the bundle's default top-bar line (checked on the strings; that line shows for a moment at load and was not caught on camera in the final run). (5) A-12 uses 9.5rem (HEAD's own value) instead of the verifier's 9.75rem.

**What the HEAD copies (B) show.** B-before and B-after were built from one commit (3776a4ae); the repo's add-ons keep moving (other lanes commit unreviewed work every few minutes), so this column is a snapshot. B-before equals A-before on 14 of the 22 probes. Where HEAD differs, the repo's own add-ons (none of it live) already carry a fix or change the page: A-02's band (`sporta-ui-colours.css` C4; the badge is not covered), A-06 (`sporta-bag-touch.css` [ux-cart-1], which uses `text-align:right`), A-07 (`sporta-cart-drawer.css`), A-12 (9.5rem in both files), A-19 (the count is hidden by the shop-header trim). **A-08 is worse in HEAD**: the compact footer leaves the fixed bar 41 px over the last line instead of 26 (checkout at 768: 19 px of the line hidden against 5.6 px live). A-04 hits a different number of slides (5 of 7 against 4) because the hero copy sits slightly differently. After the patch the HEAD copies land on the same values as the live copies on every probe, except A-19 (hidden) and A-08's clearance (6.9 px against 22.5 px), so shipping the repo's lanes first or second does not change what the blocks do; the duplicated rules (A-06, A-07, A-12, A-02 band) are harmless on HEAD.

**Not proven here.** A-16 at 320 (still scrolls; the patch is partial there) and A-09 at 1024-1100 (text at the 10 px floor, inside its tile by about 3 px); A-23 is optional and was proven only for open and closed position, not for the slide animation; the A-01 default-top-bar branch; every proof is Chromium on this mirror: not Safari, not a notched phone (`--sa-bottom` is 0), not the live server. No block was measured with real product photographs, brand logos or hero art.

Scratch data and scripts: `/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/audits/alignment-synth/` (`gen.py`, `blocks/`, `probes.cjs`, `proof-table.py`, `tool-compare.py`, `toggle-probe.cjs`, `out/`), the patch is `/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad/audits/alignment-proposed.diff` (not in the repo, like `fonts-proposed.diff`).


## 5. What could not be checked, and how to re-run it live

- **The live site itself** (the Hostinger connector is signed out). Everything above is the mirror: captured bundle, deployed add-ons (older than three 2026-11-03 deploys, see section 1), captured `/api` JSON, repo fonts, hero and category files. The mirror applies no `.htaccess`, so real HTTP status of unknown routes (the SPA fallback), security headers, caching and the real `/api` responses are unmeasured.
- **`/returns`, `/exchange`, `/account` and `/backends` were not audited.** Their lazy stylesheets are not in the capture, so they render the error screen: 64 of the 720 crawl page-states describe that screen, not the pages. With the three sheets stubbed empty, `/returns`, `/exchange` and `/account` render their markup (text direction and form fields are right: inputs are `dir=ltr` by design) but 10 of 48 states overflow at 320 and 360, which is expected without their CSS and is no evidence of a live defect. The `/backends` sign-in screen was never seen. The admin was measured only on fixtures with a stand-in sheet (A-29).
- **Photographs:** live products have `image=null` (the placeholder SVG, as live), category photos `/cats/mobile/*-v2*` are missing from the mirror, brand logos return 404 (the crawl fed synthetic grey PNGs, so every crawl page-state carries `synthetic=true`), and every hero slide is the mirror's stand-in `og-image.png`. Copy over photo contrast, photo crops and image aspect layout are unverified; geometry of text and controls is not affected.
- **Synthetic states:** the long top bar and the start-aligned link bar (the live bar is one short line); GET fixtures for a paid order (track, invoice, payment result) and for sale prices. Live has no sale and no public order data.
- **Not exercised (read-only rules):** any form submit, validation messages, sign-in, MFA, orders, the checkout "Share my location" result, `/review`, `/track` and `/invoice` with real data, the success and failure payment screens, the Sporta AI replies (a POST), the real checkout quote (a POST, so the total stays "Calculating total..." and the aligned-decimals check on the checkout summary was done on the cart summary and the invoice instead).
- **Adobe Fonts** (`use.typekit.net`, kits `qkv4ztg` and `xgg6rku`) are unreachable from the sandbox, so any family from those kits was measured in its fallback; line breaks in those families may differ slightly live. The fonts audit owns that question.
- **Not run:** dark mode, print, `prefers-reduced-motion` (other than the trap in A-18), zoom and large-text settings, landscape, device pixel ratios above 1, a real mobile browser (Chromium with touch emulation, `pointer: coarse` up to 768), safe-area insets (the mirror reports 0, so A-08's `--sa-bottom` term is untested on a notched phone), real keyboards and input-direction switching.
- **Heuristic limits of the tool:** the gutter classification cannot know design intent (end-aligned controls, narrow centred columns and list indents are classified separately); icon and baseline checks use canvas font metrics (about 0.5 px); lists are capped (edges 700, text 450, rows 260, physical 300 per page-state) and dropped counts are recorded in each JSON.
- **Method traps for the next person:** `reducedMotion:'reduce'` removes the hero pause button (A-18); the closed bag drawer is parked off-screen, so a probe that walks fixed ancestors reports false leaks unless it skips them; `slide_image` on the mirror returns one stand-in image for every slide.

### Re-run it live, read-only, on the VPS

The sandbox cannot reach the site, so use the Hostinger connector like the other probes (CLAUDE.md "Probing the live site"):

1. One scratch compose project on VM 2058651 using `mcr.microsoft.com/playwright:v1.49.0-noble`. In the job: `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright@1.49.0` in a work directory.
2. Put `sporta-web/scripts/page-alignment-audit.mjs` beside that `node_modules` (fetch it from `raw.githubusercontent.com/hkspower/wain/<pushed sha>/sporta-web/scripts/page-alignment-audit.mjs`; hand-copied base64 is unreliable). It imports `playwright` from its own directory.
3. `BASE=https://www.sporta.com.kw OUT=/work/out node page-alignment-audit.mjs`. With `BASE` set the tool sends GET only, aborts every non-GET, cancels submits, skips the order-lookup routes unless `LOOKUPS=1`, and adds no synthetic fixtures. Narrow it: `LANGS=ar,en WIDTHS=320,390,768,1280 ROUTES=home,shop,product,cart,checkout,payment-result,contact,track STATES=base,ai-panel,bag-drawer-filled`. Run the four routes the mirror could not render first: `ROUTES=returns,exchange,account,backends`. Pace is about 3.5 s per page-state with two pages at a time on a quiet 4-CPU machine (the full 736-state plan took 47 minutes); the VPS has other jobs, so do not run the full plan at once.
4. No `$` in the compose file, Arabic as `\uXXXX`, logs are capped at 300 entries (read `summary.txt` rather than the log), delete the scratch project afterwards.
5. Compare with this report: `summary.txt` gives the headline counters (overflow, leaks, gutter mismatches, wrong-direction text, fixed over content at page end, pairs). The numbers to expect on the current live site are in section 1 and the table in section 4.

Locally: `npm run audit:align` needs `BASE=<origin>` of a running copy, or `MIRROR=<path to a serve.mjs>`; the default mirror path is a session scratchpad path that is not in the repo. `SELFTEST=1 npm run audit:align` proves the tool on a deliberately broken and a clean fixture (98 checks).

## Appendix A - dropped or merged (not findings)

Dropped, with the verifier's reason:

| Id | What was found | Why it is not a finding |
|---|---|---|
| L1-11 | Per-page container widths differ from the header edge: cart and checkout 34.1 px (1280) / 68 (1536) inside it, about, contact, support 67.7 / 102, terms and privacy 172 / 204, track 236 / 272 | Per-page max-width columns, each symmetrically centred (0 blocks off-centre by more than 1.5 px); reading-width pages are deliberately narrower. Home, shop, product and wishlist match the header edge |
| L1-12 | Header (138 px with the top bar) plus the fixed bar take 37% of a 320x568 screen on product pages, 33% of 360x640, 25% of 390x844 | The compiled CSS neutralises hide-on-scroll on purpose; a choice, not a layout defect (option: let the tab row scroll away under 640 px) |
| L1-13 | Top-bar message cut with an ellipsis on phones | The bar is a one-line `truncate` of fixed height by design; the live message fits at every width; the long message was synthetic. Kept as an owner-content note in section 3 |
| L2-06 (header) | The header is not mirrored in Arabic (clock and AI at the left, language and bag at the right in both languages) | Two explicit authored rules force `direction:ltr` on `.navbar-main` and `.navbar-actions`; a logo-centred layout that is the owner's call. Its side effect on the drawer is A-23 |
| L2-08 | `?lang=en` is not carried through in-app navigation; a reload of `/shop` is Arabic | The documented language rule (saved tap, then `?lang=`, then Arabic; a detected or query language is never saved; nothing redirects). Reproduced exactly, not a fault |
| L2-10 | Email followed by a full stop at the end of an Arabic sentence; "وATE" | Refuted: the full stop sits at the left end, where an RTL sentence ends; the conjunction prefix is ordinary orthography |
| L2-11 | North-east arrow on `/contact` cards, truck and return icons not mirrored | The contact glyph is a decorative lead icon, not a pointer; the category-tile arrow, which means "go", flips on 4 of 4 tiles; truck and return are illustrations |
| L4 backends | The crawl's "sign-in screen only" for `/backends` | A tooling gap, not a site defect: the crawl measured the error screen (section 5) |
| crawl flags | 96 product-low spec-list tops 2 px apart; 8 cart-line control centres 17.8 px apart (360/en); 14 end-aligned cart price cells; 16 `/track` order-id fields left-aligned in Arabic; privacy bullet indent 23.8 px at 768; 2-30 px "gutter-diff" on the 404, empty bag, missing product and result content | In order: the icon centre is within 0.4 px of the text centre; the compiled 2-row layout under 380 px; `text-align:end` is correct; `dir=ltr` on a Latin id on purpose; a list indent; a centred shrink-to-fit column. The legal pages' 20 / 24 px side padding is the deliberate "one rhythm" of `sporta-returns-touch.css` |

Merged (same cause, one finding): A-01 = L2-03; A-02 = L3-02; A-03 = L1-05, L2-01, L4 ai-panel, V full-stop (and the 544 crawl flags); A-04 = L1-03, L2-04, L3-01;
A-05 = L3-03, L4 track-stepper, V sideways-scroll; A-06 = L1-07, L2-02, L4 cart-label; A-07 = L3 M-01; A-08 = L1-01, L3-10; A-09 = L1-04, L3-04; A-10 = L1-02, L3-12;
A-11 = L3-05; A-12 = L1-08; A-13 = L3-08; A-14 = L3-07; A-15 = L3-06; A-16 = L3-11; A-17 = L1-10, L3-09; A-18 = L3-13; A-19 = L3-14; A-20 = L3-15;
A-21 = V-L1-M1; A-22 = L2-07, L4 track-input, V placeholder-fix; A-23 = L1-09, L2-06 (drawer); A-24 = L3-16; A-25 = L1-06; A-26 = L2-05; A-27 = L2-09;
A-28 = L4 total-tracking; A-29 = L4 admin-768. L3 M-02 is a method trap (section 5), not a finding.

## Appendix B - lens and verifier map

| Lens | Reported | Kept | Verifier outcome |
|---|---|---|---|
| L1 overflow, gutters, containers | 13 (+1 missed) | 10 (+ the missed one as A-21) | 10 confirmed (L1-06 and the cart half of L1-08 lowered), 3 intended design (L1-11, L1-12, L1-13), 0 refuted |
| L2 Arabic/English, bidi | 11 | 8 | 7 confirmed (L2-05 lowered to low), L2-06 confirmed in part (drawer only), L2-08 and L2-11 intended design, L2-10 refuted |
| L3 component alignment | 16 (+2 missed) | 16 (+ M-01 as A-07; M-02 is a method note) | 16 of 16 confirmed, the 3 "high" lowered to medium and two more lowered, 14 of 16 proposed fixes worked as written |
| L4 static CSS and admin | 7 (+3 missed) | 6 | 5 confirmed (the stepper lowered from high to medium), 1 unclear (A-29), 1 tooling gap (not a defect) |
| Crawl (the tool) | 720 page-states, 8 headline counters | all counters explained | gutter 21 (1 real card, rest intended), wrong-direction 544 (all one widget), fixed over content 42 (A-08), heart 96 (A-17), 4 lazy routes not rendered |
