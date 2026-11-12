# Shadow, overlay and gloss audit: storefront and /backends (2026-11-12)

Owner request: "check css shadow and overlay and gloss". This was a read-only audit. No tracked file other than this report was changed, nothing was deployed and the shared sandbox was not started.

## How it was measured

- **Storefront.** The audit ran the real compiled client from the capture of the live site (`scan-words/live`: `index-CdcKvZhs.css`, `index-BtzlNXGI.js` and the live `/api` JSON), served by `scripts/lib/cart-ux-live.mjs` with this repo's 14 add-on stylesheets and its add-on scripts. Every request that left the machine was aborted, and nothing was posted. The pages were `/`, `/shop`, `/product/cloudsoft-jacket-coffee-brown`, `/cart`, `/checkout`, `/about`, `/contact` and `/account`. Each ran at 390x844 (touch) and 1280x900, in Arabic and English, with a stored light theme and a stored dark theme. That is 64 page states. Chromium 1243 ran headless at a device pixel ratio of 1.
- **Shadow visibility.** For every element with a box, drop or text shadow, the audit took a screenshot clip around the element. It then removed only that element's shadow with an inline `!important`, took the same clip again and recorded the largest per-channel pixel difference. This is the "Δ" column, in 0–255 units. Δ ≤ 3 means the shadow cannot be seen.
- **Text over photos.** The audit took a full-page screenshot with all text set to transparent. It then sampled every second pixel inside the text-line rectangles and computed the WCAG contrast of the text colour against each pixel. It reports the minimum, the 5th percentile (p5) and the worst 10%-wide strip across the tile.
- **Overlays.** The audit measured the following on the real app:
  - the bag drawer's stacking (`elementFromPoint`)
  - scroll lock (wheel at 1280px, and a CDP touch drag at 390px)
  - focus containment (14 Tabs)
  - closing by clicking the backdrop
  - frame intervals while the drawer slides in, with the CPU throttled 4x and the blur on or off
- **Focus.** The audit counted pixels of the focus-ring colour, first as the page is and then with every ancestor set to `overflow: visible`. It also ran a Tab walk on each page that checked whether a sticky or fixed bar covers the focused control.
- **/backends.** The audit used the committed fixtures of the live compiled admin (`lib/admin-css-full-page.mjs`: live markup, live rules, add-ons and, for dark pages, the live dark rules from `scripts/fixtures/admin-dark-rules.css`). It covered 12 screens and modals, at 390px and 1280px, in light and dark.
- **Static checks.** These covered all 15 `public/*.css` add-ons, the captured live `index-CdcKvZhs.css` and the fixtures' `live.css` dumps.

The probe scripts are in the session scratchpad (`sog/probe.mjs`, `overlay.mjs`, `probe3.mjs`, `tile.mjs`, `admin.mjs`, `sp.mjs`, `qty.mjs`). They are not committed.

## Ranked findings

| # | Sev | Area | Finding (measured) | Where |
|---|---|---|---|---|
| 1 | **High** | overlay / focus | On the product page on a phone, keyboard focus lands **completely under the fixed buy bar**. Every colour swatch tested was focused at y 798–844 of an 844px screen, and `elementFromPoint` at its centre returned `.action-bar` or the fixed Add button (ar and en). The Tab walk also put the related-card "+" and both footer-club buttons under the bar. The product page has no `scroll-padding`, unlike /cart and /checkout. | compiled `.action-bar` (fixtures `sizes-product/live.css:495`); fixed Add `public/sporta-product-fix.css:116-125`; compare `sporta-bag-touch.css:250-254`, `sporta-checkout-a11y.css:557-563` |
| 2 | **High** | overlay / focus | **Checkout: Tab lands on an invisible link.** `[op-steps]` hides the step indicator visually with a 1px clip, but its "Bag ✓" link stays in the tab order. When it is focused, the ring is **0 px** (ar and en, 390 and 1280; Tab stop 10). `elementFromPoint` returns the `<h1>` or the section. WCAG 2.4.7. | `public/sporta-checkout-a11y.css:501-512` |
| 3 | **High** | focus ring clipped | **The bag page's quantity buttons show 24% of their focus ring.** 82 ring pixels were visible against 344 unclipped (ar and en, 390). The compiled `.purchase-quantity` has `overflow: hidden` (for its rounded pill and inset highlight), and the 2px ring with a 3px offset is drawn outside the button. | compiled `.purchase-quantity` (`sizes-screen/live.css:31`) |
| 4 | **Med** | overlay cost | **The drawer backdrop's blur makes the slide-in janky.** The backdrop is `div.fixed.inset-0.z-40.bg-ink/60.backdrop-blur-sm` and covers the whole viewport. At 1280px with 4x CPU throttling, the median frame was **66.6 ms**, with 14 of 21 frames over 33 ms. With only that backdrop's blur removed, the median was **16.7 ms** (4 of 59 frames over). Under 60% ink the blur adds little you can see. | live markup of the drawer portal; `src/components/CartDrawer.jsx:44` mirrors it but is not live |
| 5 | **Med** | scrim / text over photo | **Category-tile copy on tablets fails AA in Arabic.** At 768px, the Women tile's brief has a minimum of **2.07:1**. Its worst strip, 20–30% from the left edge, has a p5 of **3.25:1** (4.5 needed). The Men brief's minimum is 5.15. The side scrim reaches 0 at 75% from the copy edge, but at 768px the copy box is 78% of a 351px tile. The line end therefore sits on the bright orange backlight and the athlete's leg (screenshot checked). At 390px: English Women brief worst strip p5 **4.46**, English Men 5.01. Arabic Outlet title minimum 3.58, which passes the 3:1 that large text needs. From 1024px to 1440px every tile line was ≥ 8.0 (p5). | `public/sporta-cat-tiles.css:12-17` (no tablet-specific scrim) |
| 6 | **Med** | shadow / gloss | **An orange glow on the selected payment method.** `0 5px 16px -12px rgba(184,67,15,.9)` is the strongest shadow on the storefront (Δ **36** at 1280 light, 16 at 390) and the only coloured one. In dark mode it stays (Δ 23) and glows orange on #1b2026. Every other storefront surface measured Δ 3–22. | `public/sporta-brand-theme.css:65-68` |
| 7 | **Med** | dark / admin | **The admin add-on cancels the admin's own dark-mode depth.** Line 358 forces the light shadow `0 1px 2px rgb(16 24 40/.06), 0 1px 3px rgb(16 24 40/.04) !important` on every card. That overrides the build's dark rule `box-shadow: 0 1px #ffffff08, 0 16px 38px #00000029`. Cards measured dark Δ **1–2** (invisible) on Overview, Orders, Catalogue, Brands, Settings and Inventory, against Δ 17–18 in light. Payments (light only, by owner decision) keeps Δ 17, which is correct. | `public/sporta-admin-knet.css:357-359` (generated from `addons-src/sporta-admin-knet.css`); build rule in `scripts/fixtures/admin-dark-rules.css` |
| 8 | **Med** | dark / admin overlay | **Admin modal scrims disappear in dark mode.** The scrims are `bg-black/40` (Catalogue, Brands editors, Order sheet) and `bg-slate-900/40` (Discounts, Slides). Over the dark admin they dim #151b21 to #0c1013, which is **1.10:1**. The modal surface #1b2026 against the dimmed page is **1.08–1.17:1**. In light mode the scrim is 2.55–2.85:1. The Catalogue and Brands editors compute `box-shadow: none`, so in dark mode the modal reads as the same plane as the page. | sizes-admin fixtures (`catalogue-form`, `brands-form`, `discounts-form`, `slides-form`, `orders-sheet`) |
| 9 | **Med** | overlay / focus | **Focus is hidden under the sticky header at ≥ 1024px.** `scroll-padding-top` is `auto` everywhere. In the Tab walk on /shop at 1280px, three wishlist hearts were focused at y=87, fully under the 145px header (ar and en). /cart 1280 "Remove" was at y=12, and a home slide dot at y −1 to 65. | compiled sticky `.app-header` (z 30); no `scroll-padding-block-start` in any add-on |
| 10 | Low | dark storefront shadows | The add-on shadows are charcoal `rgba(23,26,30,…)`, which is the dark canvas colour itself, so they vanish in dark mode: tiles Δ **1**, feature cards Δ **2**, brand strip Δ **1**. The compiled checkout and bag shadows (`purchase-steps`, `cart-line`, `purchase-panel`, `purchase-paybar`) also measure Δ 1 in dark. Only `.product-grid-card` has a dark recipe (Δ 4–5). Dark mode is reached only by an explicit stored choice (`public/boot.js:43-44`), so it has a small audience. | `public/sporta-shadows.css:6-30`; compiled purchase rules |
| 11 | Low | gloss in dark | **A bright line on the quantity stepper in dark mode.** The compiled inset highlight `inset 0 1px rgba(255,255,255,.55)` renders as rgb(155,158,161) on the #232830 stepper, about 5.5:1. That is brighter than the stepper's own border (rgb 61,66,73). In light mode it is the intended subtle bevel (251 on 246). | compiled `.purchase-quantity` (`sizes-screen/live.css:31`) |
| 12 | Low | blur with no visible effect | Several `backdrop-filter`s sit on **opaque** backgrounds, so they only cost a compositing layer: <br>• the header (`blur(8px)`, background computed solid rgb(23,26,30) by `live.css:824`; measured change on <0.1% of pixels) <br>• the brand strip (`blur(14px)` on `#171a1e`, Δ 0–1, and sticky from 1024px, `live.css:220,252`) <br>• the product-card "+" (`backdrop-blur` on a 95%-white or solid button; 10 layers on /shop at 390) <br>`[gs-8]` already removed the heart's blur but not the "+". The header blur is also what made it a containing block for fixed children, the "AI panel off-screen" bug patched at `sporta-ui-colours.css:183-196`. Frame cost while scrolling /shop at 390 was within noise (median 16.7 ms either way), so this is cleanup rather than a performance fix. | compiled; `public/sporta-grid.css:193-196` |
| 13 | Low | elevation scale | There is no scale. The storefront uses **16 distinct shadow recipes** in 5 base colours (`rgba(23,26,30)`, `#171a1e` hex, `rgba(0,0,0)`, Tailwind `#0000001a`, and terracotta or orange). Offsets run 1–14px and blurs 2–32px, and tight negative-spread styles are mixed with Tailwind's standard `shadow-sm`, `-md` and `-2xl`. The admin mixes `rgba(15,23,42,…)` and `rgba(16,24,40,…)`. Four declarations are invisible: `.product-grid-card` .02 (Δ 3), the hero-title `text-shadow` .12/20px (Δ 3–7), the header clock's `drop-shadow` (Δ 2) and `.product-purchase-row` `0 -1px` (Δ 0 at 1280). | `sporta-shadows.css:6-30`, `sporta-bag-touch.css:101,175`, `sporta-checkout-a11y.css:428`, `sporta-product-fix.css:47,402`, `backends-offline.css:4`, `sporta-admin-knet.css:20,134,358`; compiled |
| 14 | Info | gloss colours | The compiled bundle still carries terracotta in its gloss: `rgba(210,138,105,.26–.30)` radials on `.tile-men` and `.tile-women` (covered by the photo unless it fails to load), and the current-step ring `rgba(210,138,105,.12)` (~1.1:1, invisible). The two fixture captures carry inline theme variables `--brand: #c76a42` and `#e37740`, while the 2026-11-02 `theme.json` says `#e0561c`. Every `var(--brand)` halo follows whatever the live admin theme holds, so the live value needs a read-only check. | compiled; `scripts/fixtures/sizes-screen/*.html`, `grid/*.html` header comments |
| 15 | Info | z-index | The z-index values are ad hoc: 1, 2, 3, 5, 10, 20, 25, 30, 31, 40, 45, 50, plus 60 for the gallery lightbox in `src`. **No conflict was found** in the flows measured. In order: drawer 50, add-to-bag toast 45, drawer backdrop 40, Add button 31, header and buy bar 30. The backdrop covers the header (`elementFromPoint` at the header returns the backdrop). | add-ons and compiled |

### Checked and passing

- **Bag drawer.** It opens above the header (backdrop z 40 over header z 30, drawer z 50). The body is locked (`overflow: hidden`). The wheel does not scroll the page at 1280px, and a touch drag does not scroll it at 390px (Chromium). Focus moves into the drawer and stays there for 14 Tabs. A backdrop click closes it at 1280px. At 390px the drawer is full width, so there is no backdrop to click. The closed drawer's shadow no longer shows (`[ux-drawer-1]`).
- **Safari prefix.** All 6 compiled `backdrop-filter` rules carry `-webkit-backdrop-filter`, and the add-ons that set or reset blur write both (`sporta-bag-touch.css:173-174`, `sporta-grid.css:194-195`, `sporta-ui-colours.css:194-195`).
- **Hero copy over the photo.** It passes with three stand-in photos (`/hero/*/strength|arena|cardio.webp`; the real `slide_image` rows are not in the capture). At 390px the title minimum is 6.0 and the sub-line minimum 8.6. At 1280px everything is ≥ 12.7 (the C1 scrim in `sporta-ui-colours.css:94-106`).
- **Shop card badges** (17.5:1), the sold-out band and veil (`sporta-ui-colours.css:156-158`), and the photo-link focus ring moved to the card (`[gs-4]`, 100% visible) all pass.
- **Ring visibility.** The category tile ring is 100% visible, the wishlist heart ring 100%, and the brand-strip chip uses an inset ring (−3px) that stays visible inside its scroller.
- **Product cards in dark mode** have a dark shadow recipe (Δ 4–5), and the photo stage is forced white so the "+" and the heart keep their look.

## Proposed fixes, in priority order

These are proposals only. Nothing here has been built or tested. Each fix should get the usual fixture suite with a mutation check before it ships.

1. **#1 and #9: focus not obscured.** Add to `sporta-product-fix.css`, in the phone section:
   ```css
   @media (max-width: 767px) { html:has(.catalog-product-page .action-bar) { scroll-padding-block-end: calc(5.5rem + var(--sa-bottom, 0px)); } }
   ```
   Add the header offset site-wide (for example in `sporta-shadows.css`):
   ```css
   html:has(.app-header.sticky) { scroll-padding-block-start: calc(var(--sporta-header-h, 9.25rem) + .5rem); }
   ```
   On phones the header hides when scrolling down, so a value of about 5rem is enough there. Check with a Tab walk at 390/768/1280 in ar and en, and assert that no focus stop has its centre under a fixed or sticky bar.
2. **#2: hidden steps link.** Use the "visible on focus" pattern on the same selector:
   ```css
   .purchase-flow:has(.purchase-checkout-layout, .purchase-quick) > nav.purchase-steps:focus-within { position: static; width: auto; height: auto; margin: 0 0 .75rem; overflow: visible; clip-path: none; white-space: normal; }
   ```
   The alternative is to have the `[op-steps]` script set `tabindex="-1"` on the done-links, but the CSS route keeps "back to bag" reachable.
3. **#3: clipped stepper ring.** `.purchase-quantity button:focus-visible { outline-offset: -3px; }` gives an inset ring that `overflow: hidden` cannot clip. The other route is `.purchase-quantity:has(:focus-visible) { overflow: visible; }`. Check the drawer's own `.purchase-quantity` (`sporta-cart-drawer.css:171`) with the same pixel count.
4. **#4: drawer backdrop.** Add to `sporta-cart-drawer.css`:
   ```css
   body > div.fixed.inset-0.z-40:has(~ aside.campaign-cart-drawer) { -webkit-backdrop-filter: none; backdrop-filter: none; background-color: rgb(23 26 30 / .66); }
   ```
   The slightly darker ink replaces the dimming the blur gave. Re-measure the frames on a real phone or GPU, because headless software compositing exaggerates the absolute numbers. The relative 4x gap is what this audit claims.
5. **#5: tile scrim on tablets.** Add a 768–1023px band:
   ```css
   :root[dir="rtl"] .campaign-category .cat-scrim { background: linear-gradient(to left, rgba(17,17,19,.9) 0, rgba(17,17,19,.78) 50%, rgba(17,17,19,.4) 80%, rgba(17,17,19,0) 96%) !important; }
   ```
   Use the mirrored version for `ltr`. The alternative is to cap `.campaign-category__content` at about 62% in that band. The English 390px brief (4.46) needs the `[gs-t2]` bottom ramp raised slightly, for example `.5 → .58` at 30%. Re-run the per-strip measurement.
6. **#6: payment glow.** Replace it with a crisp selection edge plus a resting-level shadow:
   ```css
   box-shadow: 0 0 0 1px rgba(224,86,28,.55), 0 4px 12px -8px rgba(23,26,30,.25);
   ```
   In dark mode use only `0 0 0 1px var(--brand-bright)`.
7. **#7 and #8: admin dark mode.**
   - Scope line 357 to light mode with `html:not(.dark):not([data-theme="dark"])` (edit `addons-src/`, then regenerate), so the build's dark depth comes back.
   - Add a dark scrim: `:is(html.dark, html[data-theme="dark"]) .admin-shell .fixed.inset-0:is([class*="bg-black/40"], [class*="bg-slate-900/40"]) { background-color: rgb(0 0 0 / .62); }`
   - Add a dark modal edge: `:is(html.dark, html[data-theme="dark"]) .admin-shell :is(form.admin-editor-modal, .fixed.inset-0 > form, .fixed.inset-0 > aside) { box-shadow: 0 0 0 1px rgb(255 255 255 / .08), 0 24px 60px rgb(0 0 0 / .5); }`
   - Keep the Payments screen light (owner rule).
8. **#10 and #11: dark storefront.** One `html[data-theme="dark"]` block:
   - tiles, features and panels: `box-shadow: 0 0 0 1px rgb(255 255 255 / .06), 0 10px 24px -16px rgb(0 0 0 / .6)`
   - `.purchase-quantity`: `box-shadow: inset 0 1px rgb(255 255 255 / .06)`
9. **#12: blur cleanup.** Set `backdrop-filter: none` (both spellings) on `.app-header`, `.campaign-brand-bar` and `.catalog-card-add` (extend `[gs-8]`). Nothing changes visually, as measured above.
10. **#13: one elevation scale.** Use it for new and edited rules, with a 1px white/6% hairline added in dark mode:

    | Token | Value | Use |
    |---|---|---|
    | `--sh-1` | `0 1px 2px rgb(23 26 30/.06), 0 1px 3px rgb(23 26 30/.04)` | resting cards, fields |
    | `--sh-2` | `0 8px 20px -12px rgb(23 26 30/.32)` | tiles, floating buttons, raised hover |
    | `--sh-up` | `0 -6px 24px -14px rgb(23 26 30/.30)` | sticky bottom bars |
    | `--sh-4` | `0 18px 40px -12px rgb(0 0 0/.35)` | drawer, toast, modal |

    Drop the four invisible declarations.

## Not covered (stated plainly)

- **WebKit / iOS Safari was not run.** That covers touch scroll lock under `body { overflow: hidden }`, `-webkit-backdrop-filter` rendering, and the dvh bars. Real-GPU frame timing was not measured either.
- **The live site was not probed** (no VPS job ran). The storefront numbers come from the 2026-11-02 capture of the live client plus this repo's add-ons. Hero `slide_image` rows were stand-ins.
- **The admin's own stylesheet** (`AdminApp-*.css`: modal panel, borders) is a stand-in in the fixtures. The modal shadow and border in item 8 are what the compiled utilities plus add-ons give, not the full live sheet.
- **Overlays not opened:** the search overlay, size-guide modal, gallery lightbox and the assistant panel.
- **Gradient banding was not measured.** Every scrim ramp sits over photographic texture, and no screenshot showed visible bands.
