# Icons scan, 2026-11-18 (storefront)

Owner: "scan all icons". Read-only scan of every drawn `<svg>`, small `<img>` and text glyph on 13 storefront pages (home, shop,
a product, cart with a line, about, contact, account, returns, support, track, checkout, brands, privacy), 390 and 1280 px, English,
on the captured live storefront (the real compiled client) under this repo's add-on files. Script: the session scratchpad
`icons/scan.mjs` (not shipped; it uses `scripts/lib/add-to-cart-ux-live.mjs`). The admin (/backends) is in
`BACKENDS-SCAN-2026-11-18.md`.

## Result

441 svgs drawn. **415 are set icons** (`sporta-icon`, the 2026-11-11 set): one stroke width (1.75), outline only (`fill: none`). Every icon inside a button or link has an accessible name, and every icon-only control is at least 44 x 44 px
(0 problems of either kind). Colours: near-black 223, white 136 (on dark grounds and the orange buttons), the logo orange 4 (Contact),
the dark orange step 28 (see below), the cool grey #596571 24 (the camera on the grey "no photo" plate).

## Fixed: ICONS-1118 in `sporta-shadows.css` (`npm run test:icons-1118`, 10 checks)

The icons that sit beside a text label and take the bundle's `.text-brand` (the three reassurance rows on a product page; the
footer's Cash on delivery chip; 28 drawn over the whole scan) were the **dark text step #B34D00**, which is for small TEXT on light grounds.
An icon is a graphic and takes the logo orange exactly (the Contact page's icons already did). On the dark footer chip the dark
step was 3.3:1; the logo orange is 6.73:1. The label beside each icon carries the meaning in words, so the logo orange's 2.59:1 on
white does not leave an icon as the only carrier. After the change: 0 icons in the dark step on any scanned page.

## Not fixed (listed for the owner)

- **Sizes are not on one scale.** 18px (212 icons), 15px (66), 22px (44), 20px (27), 14px (24), 13px (22), 16px (15), plus 26, 23.1
  and 12. 13/14/15/16 are four sizes within 3px of each other; a scale of 14, 16, 18, 20, 22, 24 would be tidier. Not done: it
  moves text and spacing in about 20 places.
- **Three drawn icons are not from the set:** the header clock (a custom widget, 34px, on purpose), the carousel pause button (12px,
  the bundle's own) and the clear-field button of the checkout fields (14px, stroke 2).
- **Two text glyphs stand in for icons on /checkout:** the "done" tick of a finished step (`✓`) and the multiplication sign in a
  summary row (`×`, that one is a sign, not an icon). The tick could be the set's check icon.
- **Cool grey #596571 on the "no photo" camera** (24 drawn over the scan) is the only off-palette colour left among the icons; it sits on a
  grey plate and goes when the products have photos (14 of 46 have none).
- The `<img>` icons: only the placeholder photo in the bag and the checkout summary (48-50px), not icons.
