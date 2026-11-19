# Colour scan, 2026-11-19 (read-only, nothing changed)

Owner request: "scan all css and ux ui colors". Scope: every `public/*.css` and the colour literals in `public/*.js`,
the theme defaults in the PHP, and the customer e-mail templates. Brand rule in CLAUDE.md: one orange (#FF7B17 for fills),
one dark step (#B34D00 for small text on light grounds, hover fills and focus rings on light grounds), charcoal #171A1E,
beige #E2DBCE; no red or rose on the shop.

## What already passes (measured)

- `npm run test:contrast` (browser, every shop route, light and dark, ar and en): AA in both themes, both languages.
- `test:colours-1118` 15/0, `test:words-colours` 355/0, `test:icons-1118` 10/0, `test:cards-1118` 18/0.

## Findings

### Storefront add-on CSS and JS (shop pages)

| Value | Where | What it is | Verdict |
|---|---|---|---|
| `#ff8f3d` | `sporta-product-fix.css:512` | hover fill of the toast button | off-brand fill: should be `#ff7b17` |
| `#ff8f3d` | `sporta-ui-colours.css:143` | focus ring of the features button (`#main .sf__btn`) | off-brand; the band is dark, so `#ff7b17` |
| `#ff8f3d` | `sporta-features.js:72, 80, 3359` | features band eyebrow text, focus outline, dark-mode accent | off-brand; same band is dark, so `#ff7b17` |
| `#ff8f3d` | `sporta-cat-tiles.css:9, 36` | focus outline and kicker on the category tiles | off-brand; the tiles sit on the light home canvas, so a focus ring should be `#b34d00` |
| `#ffb374` | `sporta-product-fix.css:417-427` | dark-mode size alert (border, text, dot) | dark theme only, legible; not a fill. Keep, or move to `#ff7b17` |
| `#ffb374` | `sporta-checkout-a11y.css:461` | dark-mode phone warning text | dark theme only. Keep |
| `#ffd0a8`, `#8f3f00`, `#ffb374` | `sporta-brand-theme.css:43-84` | support-page tints and hover, token `--color-rose-*` | the names say rose but the values are orange; the hover `#8f3f00` is a brown outside the palette |
| `#fbbf24` | `sporta-shadows.css:376` | dark-mode amber text | a warning colour; contrast-driven, keep |

Nothing red or rose is drawn on the shop itself. The bundle's red and rose scales are remapped in `sporta-brand-theme.css`,
and `test:colours-1118` holds that.

### Customer e-mail templates

- `dropin/php-store/cron-birthday.php:76, 79`: the gift box and the "Shop now" button use `#e0561c` (the retired burnt orange)
  and `#fff1e8`. The button should be `#ff7b17` with `#171a1e` text, the box tint should follow the palette. This is the one
  finding that reaches customers outside the site.

### Theme defaults (PHP)

- `dropin/php-store/store.php:2229`: the store's default theme is `brand #c76a42`, `accent #99452b` (terracotta, not the brand).
  The shop overrides it in CSS, but the default still reaches the page as the `--brand` inline style before the CSS loads.
  Fix: default to `#ff7b17` / `#b34d00`. Needs a check that the admin Theme screen still reads the same.

### Admin (kept on purpose, owner decision)

- The admin uses its own colours: `#9a452c` buttons (40 uses), `#be123c` errors, `#047857` / `#b45309` / `#b91c1c` status
  text in `sporta-admin-brands.js` and `sporta-admin-knet.css`. The owner decided to keep them (see CLAUDE.md, the
  KNET screen). Listed for the record; no change proposed.

## Not changed

No CSS or PHP was edited in this scan. Each shop change above is a visual change and needs the live capture
(`serveLive` against the captured site) before it ships. The e-mail and the theme default change the same way: they need a
test each and the owner's yes.

## Proposed next step (needs the owner's yes)

1. Replace the four off-brand `#ff8f3d` fills and rings with `#ff7b17` (dark bands) or `#b34d00` (light grounds), add
   one suite that fails on any `#ff8f3d` in a shop add-on.
2. Move the birthday e-mail to `#ff7b17` / `#171a1e` and add it to the e-mail tests.
3. Change the theme default to `#ff7b17` / `#b34d00` after checking the admin Theme screen.
