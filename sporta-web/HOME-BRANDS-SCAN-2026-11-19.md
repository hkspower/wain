# Home page brands strip scan, 2026-11-19 (read-only)

Owner: "scan brands layout at main page". Scope: the "Brands we trust" / "Explore brands" strip on `www.sporta.com.kw/` (the `section.brand-bar.campaign-brand-bar`
of the compiled build plus the add-ons). Nothing in the repo's application code, on the VPS or on the live site was changed; the only new file besides this
report is the probe `scripts/live-home-brands-probe.mjs`.

**Method.** (1) A read-only probe on the VPS (Playwright image, GET only, every other method aborted), commit `9596f2b0`: the home page in Arabic and English at
320 / 360 / 390 / 768 / 1024 / 1280 / 1536 px (light) and 390 / 1280 px (dark), the box, text, logo and colour of every tile, the heading and the call to action,
layout shifts that touched the strip, the public brands API against the tiles, and the real logo file. (2) Local screenshots of the same page with the repo's
add-ons and the live brand list (the logo is a stand-in drawn at the measured size: the real file was measured, not downloaded). The scratch VPS project was
deleted afterwards. Screenshots are in the session scratchpad (`brand-shots/`), not in the repo.

## What is live today

- **The brands API holds 2 brands:** Vanquish (with a logo) and NBA (no logo). The strip shows exactly those two, in both languages; no hard-coded name is left over.
- **The Vanquish logo:** `api.php?r=brand_logo&slug=vanquish&v=24f9e5f69b4b`, a PNG **1400 x 342, 49,632 bytes**, 67.6% transparent, corners fully transparent, black ink
  (so the strip's `grayscale brightness(0) invert` filter paints a clean white wordmark), `Cache-Control: public, max-age=31536000, immutable`, loaded `lazy`.
- The strip is inside the first screen on a phone (top at y 666 of 844) and on a 1280 x 900 desktop (top at y 785 of 900, then it docks, see HB-02).

## Findings

| # | Severity | What | Where | Who decides |
|---|---|---|---|---|
| HB-01 | **Medium** | **With 2 brands the tiles are huge, empty bars on a desktop.** Each tile is 477 px wide at 1280 and 512 px at 1536 (354-359 px at 768-1024) and 63 px tall; the wordmark or name sits in the middle of it (the logo is drawn 151 x 40, 32% of the tile). The grid is `repeat(n, 1fr)`, so a short list stretches. On a phone it is fine (173 x 68 each, two across). Same as scan item BL-17 ("one or two brands"), now measured on the real data. | >= 768 px | Add-on CSS (`sporta-images.css`): cap the column (about 16rem) and keep the group at the start edge, or centre it; the owner can also add brands. |
| HB-02 | **Medium** | **The strip docks under the header from 1024 px with a see-through gap of about 19 px.** The compiled build says `position: sticky; top: 9.75rem` (>= 1024 px) but the header is 145 px (8.6rem) tall at 1280, so the strip sits at y 164-250 under a header that ends at 145: the page content scrolls through the slit between them (visible in `docked-en-1280.png`: the tile photograph shows above the strip). Measured at scroll 700, 1200, 1800 and 2200: always 164-250. While it is docked the fixed chrome is 250 px of a 900 px window (28%) on the home page, to show two names. | 1024-1536 px | Add-on CSS: set the offset to the header's real height (it scales with the root font size, 8.6rem at 1280; best read from the header), or drop the docking when there are only a few brands. Owner: keep the docking or not. |
| HB-03 | Low | **The heading is centred in its column while "Explore brands" is start-aligned** (CENTER-1118 side effect; scan item BL-10). At 1280 the heading box is x 38-257 with the text centred in it, the call to action starts at x 38; the first letters differ by about 44 px. At 390-768 the heading box is as wide as its text, so there it is aligned. | >= 1024 px | Add-on CSS: `text-align: start` on `.campaign-brand-bar__heading h2`. |
| HB-04 | Low | **"Explore brands" is 33-34 px tall at 1024-1536 px** (44 px on phones and at 768). Below the 44 px tap size. Scan item BL-13. | >= 1024 px | Add-on CSS: `min-height: 44px`. |
| HB-05 | Low | **The Vanquish logo file is 14x the size it is drawn at**: 1400 x 342 and 49.6 KB for a box of 144 x 46 (phone) or 151 x 40 (desktop). It decodes at full size on every home view. A 400 px copy would be about 8 KB. | all | Owner: upload a 400 px-wide logo in /backends -> Brands (the admin says it resizes to 320 px, but this file is 1400 px: it was either uploaded before that rule or by another route). |
| HB-06 | Low | **A logo tile and a text tile side by side look unequal**: Vanquish is a 151 x 40 white wordmark, NBA is a 15.8 px bold word. Not a defect, a consequence of NBA having no logo. | all | Owner: upload an NBA logo. |
| HB-07 | Info | **Layout shift from the strip while it loads, English phone: 0.0226** (Arabic 0.0005); at 1280 0.0155; the whole home page is 0.0012-0.0238, well under the 0.1 "good" line. The strip is the largest single source on the English phone page (the bundle starts from its own list and swaps in the API's). Scan item BL-03/BL-20. | en phones | None needed. |
| HB-08 | Info | The light and dark themes are identical for the strip (charcoal `#171a1e`, scan item BL-21): measured the same in both at 390 and 1280. | all | None. |

## Status, 2026-11-19 (owner: "fix it")

HB-01 to HB-04 are fixed in the repo as add-ons, NOT deployed: BRANDS-1119 in `sporta-images.css` and BRAND STRIP DOCK in `sporta-features.js` (ship as both files, no
API, no migration). Proof: `npm run test:home-brands` (144 checks on the real compiled home page, ar + en, 390-1536 px, 1 / 2 / 4 / 5 / 7 brands, two mutants red).

- **HB-01 fixed:** with four brands or fewer a tile is at most 16rem (two brands: 269 px at 1280, was 477) and the group sits at the start edge; five or more fill the track
  as before; a phone's two-across row is unchanged.
- **HB-02 fixed:** the docked strip sits exactly under the header (strip top 145 = header bottom 145 at scroll 700-2200, was 164) and follows a header that changes
  height (a `ResizeObserver` on the header's border box writes `--sporta-dock-top`; the fallback is 8.6rem). Fixed chrome at 1280 x 900: 231 px (was 250).
- **HB-03 fixed:** from 1024 px the link is centred under the centred heading (the owner's 2026-11-18 "centre all text" is kept); below 1024 px the row is unchanged.
- **HB-04 fixed:** the link's box is 44 px from 1024 px, negative margins keep its footprint, the strip is no taller.
- **Not code:** HB-05 (re-upload the Vanquish logo at about 400 px wide), HB-06 (upload an NBA logo).

## What measured right

- **No sideways scroll** on any of the 18 page loads; **tile heights are equal** (68 / 69.3 / 62.1 / 63.1 / 63.8 px by width); no clipped or wrapped text with the two live names.
- **Contrast** of the heading, the call to action and the tile text is 17.46:1 (white on `#171a1e`) in both languages and themes.
- **Tap size:** tiles 62-69 px high, the call to action 44 px on phones and tablets.
- **Logo polarity:** the live logo is a transparent PNG, so the white-silhouette filter is correct for it (the risk in scan item BL-02 is an opaque logo; this one is not).
- **Caching:** one logo request (49,632 B, immutable) and one brands request (154 B) per page.
- **The strip matches the API** in both languages (names in the language of the page).
- No JavaScript error on any page load.

## Not measured

Hover and focus states (scan BL-12 and the focus ring were measured on 2026-11-18), touch and screen-reader behaviour, the real logo's pixels (its size, transparency and ink were read, the image was not downloaded), the strip while the API is slow
(scan item BL-03, mocked on 2026-11-18). `use.typekit.net` and the live font files were not part of this probe.

## Evidence

`scripts/live-home-brands-probe.mjs` (read-only, any `BASE=`); the live run was a one-shot compose on VM 2058651 (project `sporta-brandscan`, deleted after). Screenshots (scratchpad):
`live2-strip-en-1280.png`, `live2-strip-ar-390.png`, `live2-first-ar-390.png`, `docked-en-1280.png`.
Two projects from earlier probes are still on the VM, stopped: `sporta-buybar-probe` and `sporta-cat-probe` (7 days old); they can be deleted.
