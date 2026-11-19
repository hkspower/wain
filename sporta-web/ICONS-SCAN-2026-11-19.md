# Icons check, 2026-11-19 (storefront + admin)

Owner: "check all icons". A re-run of the 2026-11-18 scan (`ICONS-SCAN-2026-11-18.md`) on everything that was added since, plus every
icon suite. Read-only: nothing here changed an icon.

## Result: no defect found

**Storefront, 16 pages x 390 and 1280 px, English** (home, shop, a product, cart with a line, about, contact, account, returns, support,
track, checkout, brands, privacy, **catalogue, wishlist, terms** - the last three are new to the scan), the captured live client under
this repo's add-ons:

- 581 svgs drawn. **545 are set icons** (`sporta-icon`): one stroke width (1.75), outline only (`fill: none`), ink, white on dark grounds
  and orange buttons, the logo orange (Contact, the footer chip), the dark orange step (the product page's reassurance rows) and the cool grey of
  the camera on the "no photo" plate.
- Every icon inside a button or link has an accessible name (0 without); every icon-only control is at least 44 x 44 px (0 under).
- The 36 drawn things that are not set icons are all known and deliberate: the header logo (34 / 42 px, on every page), the carousel pause
  button (12 px, the bundle's own) and the checkout clear-field button (14 px, stroke 2). Two set icons look different on purpose: the
  wishlist's empty-state heart (36 px, stroke 1.25: a big mark takes a thinner line) and the AI launcher (20 px, stroke attribute 1.9: the
  1.75 tier drawn white on the dark button; `test:ai-icon` holds that mark).
- Text glyphs standing in for icons: only the checkout's finished-step tick and the multiplication sign (listed on 11-18), and the arrows inside
  the sort list's option labels ("Price: low -> high"), which a native `<option>` cannot draw any other way.
- New pages checked: `/catalogue` draws no icon of its own (header and footer only); `/wishlist` has the set's heart.

**Suites, all green:** `test:iconset` 7,683 · `test:admin-iconset` 7,113 · `test:icons-polish` 1,826 · `test:icons-1118` 10 · `test:ai-icon` ALL OK.

**Admin add-on blocks** (Site icon, CRM interests, Price tools, Invoices, Database center, hidden-products band, live-data chip): the blocks
that draw status marks use the text glyphs `✓ ✕ ▲ !` (about 25 places in `sporta-admin-brands.js`), not set icons; they are read as text by a screen
reader and carry their words beside them. The compiled admin's own icons are the set (`test:admin-iconset`).

## Harness note (not a site defect)

On the old capture of 2026-11-03 `/account` and `/returns` show "This page could not load": the capture has no `Account-*.css` / `Returns-*.css`
(those two CSS chunks were never saved), so the lazy page fails in the harness. With an empty stand-in served for those two files both pages
draw their icons like every other page (86 svgs, 0 unnamed, 0 under 44 px). The live site serves the real files.

## Not changed (owner's call), as on 11-18

- Sizes are not on one scale: 18 px (242), 15 (84), 22 (56), 20 (33), 14 (30), 13 (28), 16 (15). A 14 / 16 / 18 / 20 / 22 / 24 ladder would be
  tidier but moves text and spacing in about 20 places.
- The checkout's finished-step tick `✓` could be the set's check icon.
- The cool grey on the "no photo" camera goes away when the 14 photo-less products have photos (they are hidden from the shop since
  `deploy-20261119T000155Z-eb97a4b`, so shoppers no longer see that plate in the grid).
