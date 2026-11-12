# Icon files, corrected (partly applied 2026-11-12)

**2026-11-12 (owner: "fix the asset findings", AUDIT-ASSETS-2026-11-12.md):** three files were copied to
`sporta-web/public/` because they fix defects without changing how the brand looks: `apple-touch-icon.png` (opaque
charcoal, iOS no longer paints the transparency black), `favicon-maskable-192.png` and `favicon-maskable-512.png`, and the
maskable entries of `site.webmanifest` and `backends.webmanifest` now name them instead of `favicon.png`. The "any" icons
(`favicon.png`, `favicon-192.png`, `favicon-32.png`) and `product-photo-unavailable.svg` change the visible mark and stay the
owner's call; nothing is deployed.

Status before that: **generated, not applied.** Nothing in `sporta-web/public/` was changed. Masters live here, never in `public/`
(anything there ships). The owner decides what to copy. The live storefront is a compiled build whose `index.html`,
`site.webmanifest` and icons belong to it (CLAUDE.md, items 4 and 5), so none of this can go out in a backend deploy; it is
for the day this repo's storefront is live again, or for whoever owns the live build's `public/`.

Made by `node sporta-web/scripts/make-icons-polish.mjs` (`--preview` also writes `preview.png`) from the 7131 x 2193 master
`brand/logo-original.png`: the whole S is cut out of it and area-averaged down, so no pixel is enlarged.
`npm run test:icons-polish` checks that every file here is byte-identical to what the script makes.

## What was wrong in `public/` (measured, `npm run test:icons-polish`)

| Measured on | Finding |
|---|---|
| `favicon.png` 512 (and the 192, 180 and 32 cut from it) | the S's right bowl is **cut flat**: a 58px vertical edge at 512 where the logo has a rounded point (the master S is 1470px wide, the icon's is 333px at 512 = 1426px: about 3% lost) |
| same | the S **touches the top and bottom** of the canvas: padding 0.0% above and below, 17.4% left and right |
| `site.webmanifest`, `backends.webmanifest` | `favicon.png` is declared as **both "any" and "maskable"**. A maskable icon must keep its ink inside the central 80% circle (radius 40% of the width); this one's ink reaches **58.8%**, so Android's circle or squircle mask cuts the S's two tips off, and the transparent corners are filled with the launcher's default colour |
| `apple-touch-icon.png` 180 | **87% transparent**: iOS fills transparency with black, so the home-screen tile is an orange S on black by accident, not by design, and with the same cut S |
| `product-photo-unavailable.svg` | at the sizes the shop shows it the camera is a smudge: 14px wide in a 72px bag thumbnail (a 0.4px line), 32px in a 169px phone card; its three lines of copy are 4 to 6px tall there (illegible noise); the orange rule is the retired clay `#d28a69` |

Fine as they are (measured): `og-image.png` 1200 x 630 RGB, 1.91:1, as the og tags declare; `logo.png` 800px and
`logo-white.png` 600px (396px is needed on a 3x phone at the header's 132px); every manifest and `index.html` size matches its file.

## What to copy

| File here | Copy to | Replaces | Size | Notes |
|---|---|---|---|---|
| `favicon-32.png` | `public/favicon-32.png` | the current one | 32 x 32, transparent | tab icon; S 88% of the height |
| `favicon-192.png` | `public/favicon-192.png` | the current one | 192 x 192, transparent | manifest "any" 192 |
| `favicon.png` | `public/favicon.png` | the current one | 512 x 512, transparent | manifest "any" 512; S 84% of the height, whole |
| `favicon-maskable-512.png` | `public/favicon-maskable-512.png` | **new file** | 512 x 512, opaque charcoal `#171A1E` | manifest "maskable" 512; S inside the 38% circle |
| `favicon-maskable-192.png` | `public/favicon-maskable-192.png` | **new file** | 192 x 192, opaque charcoal | manifest "maskable" 192 |
| `apple-touch-icon.png` | `public/apple-touch-icon.png` | the current one | 180 x 180, opaque charcoal | iOS rounds the corners itself |
| `product-photo-unavailable.svg` | `public/product-photo-unavailable.svg` | the current one | 600 x 750 viewBox, same file name | one file that adapts (below) |

Manifest change (`site.webmanifest`, and the same four lines in `backends.webmanifest`): point the maskable entries at the
new files instead of `favicon.png`:

```json
{ "src": "/favicon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
{ "src": "/favicon.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
{ "src": "/favicon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
{ "src": "/favicon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
{ "src": "/apple-touch-icon.png", "sizes": "180x180", "type": "image/png" }
```

`index.html` needs no change (it already links `favicon-32.png`, `favicon-192.png` and `apple-touch-icon.png` with the
right sizes). The service worker, if it precaches icons, needs the two new file names added. `preview.png` shows the
before and after (any on white and charcoal, the maskable circle, the iOS tile, and the 32 / 16px tab sizes).

## The "photo coming soon" tile

`product-photo-unavailable.svg` keeps the 600 x 750 canvas and the file name. Media queries inside an SVG used as an `<img>`
are evaluated against the image's own rendered width, so one file serves every size: **301px and wider** it is the full tile
(badge, camera, orange rule, "SPORTA", the Arabic and English lines, the lines larger than before); **300px and under** (grid
cards on a phone, bag drawer and checkout thumbnails) it drops the copy and draws the badge larger with a thicker line.
Measured (rendered, `npm run test:icons-polish`): camera glyph 14px -> 33px at 72px wide, 32px -> 79px at 169px, 56px -> 84px at 301px. The rule is `#E0561C` and the glow `#FF7B17` (brand tokens) instead of the clay.
No CSS change is needed: the existing `img[src$="/product-photo-unavailable.svg"]` rule in `sporta-cat-tiles.css` still fits it.
(`object-view-box` was tried as a CSS-only crop: it does not clip, and Safari support is not certain; the asset is the fix.)

## Not decided here

Which Sporta AI icon concept to use is the owner's choice and nothing in `brand/sporta-ai/` was changed or wired in; the test
only reports that all seven SVGs are valid and how each draws at 16, 24 and 32px on white, beige and charcoal.
