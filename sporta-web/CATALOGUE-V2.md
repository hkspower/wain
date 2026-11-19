# Catalogue V2: fully dynamic (design contract, 2026-11-19)

Owner: "full improve cataloge full dynamic". CATALOGUE-1118 (CLAUDE.md, deployed 2026-11-19) made a public `/catalogue` page and an in-browser PDF from the live shop. V2 makes every part of it
live and owner-controlled, without a migration and without breaking an older API (everything degrades to today's behaviour when the new route is absent).

## What "dynamic" means here

1. **One live data route** (`api.php?r=catalogue`) with a revision and ETag: the server decides what is listed, in what order, with which photo, and tells the page when anything changed.
2. **Owner-editable** copy and rules (title, intro, note, what to show, category order and visibility, products hidden from or pinned in the catalogue) in /backends, stored as ONE `settings` row (`catalogue`): no table, no column.
3. **Live on the page**: the page notices a change by itself (cheap `If-None-Match` poll while the tab is visible) and updates the grid in place; filters, sort and search are in the address, so every view is a shareable link.
4. **A PDF of the view the visitor is looking at**, with options (prices, sold-out items, language), and, when the spike proves it, a real text layer so the PDF is searchable and its text can be copied.
5. **Crawler-readable without JavaScript**: `seo-page.php` adds `CollectionPage` + `ItemList` JSON-LD for `/catalogue` to the head, from the same live listable products.

## Data route (server, slice A)

`GET /api/api.php?r=catalogue`, public. Rate limit like `content` ([120, 60]). `Cache-Control: no-cache`, `ETag: "<revision>"`; `If-None-Match` equal to it answers 304 with no body (compare with the `-gzip` / `W/`
suffixes Apache's mod_deflate adds, the way `seo-page.php` and the sitemaps already do; the api `.htaccess` blanket `no-store` needs an exception for this route like `site_icon` has, and ONLY for a 200/304 answer).
Built by the same code path that decides the shop's listing: `store_filter_listable()` (AUTO-HIDE: a name, a price above zero, a SKU row, a photo), minus the slugs the owner hid. Never a quantity, SKU, cost or customer field.

```json
{ "revision": "a1b2c3d4e5f6", "generated_at": "2026-11-19T12:00:00Z", "count": 32,
  "settings": { "title_ar": "", "title_en": "", "intro_ar": "", "intro_en": "", "note_ar": "", "note_en": "",
                "show_prices": true, "show_sold_out": true, "show_sizes": true, "show_brand": true, "cover": true, "per_page": 9 },
  "categories": [ { "slug": "men", "name_ar": "رجال", "name_en": "Men", "count": 12 } ],
  "brands":     [ { "slug": "vanquish", "name_ar": "", "name_en": "Vanquish", "logo": "/api/api.php?r=brand_logo&slug=vanquish&v=...", "count": 5 } ],
  "products":   [ { "slug": "…", "name_ar": "", "name_en": "", "category": "men", "brand": "vanquish", "price": 12.5, "list_price": 15, "pct_off": 17, "on_sale": true,
                    "featured": false, "pinned": false, "in_stock": true, "sizes": [ { "size": "M", "in_stock": true } ],
                    "image": "/images/products/x.jpg", "image_small": "/images/products/responsive/x-640.webp", "images": [ "/images/products/x.jpg" ] } ] }
```

* `revision` = first 12 hex of sha256 over the canonical JSON of everything above except `generated_at`: it changes if, and only if, something a visitor can see changes (price, stock state of a size, photo, name, order, a setting).
* Order: pinned first, then featured, then the owner's category order, then name. `categories` follows the owner's order, hidden ones left out. `show_sold_out: false` removes sold-out products from the payload.
* The photo is the first file that EXISTS on disk (server-verified), so the client never probes file names; `image_small` only when the responsive copy exists.
* Settings are the PUBLIC subset only (the admin list of hidden/pinned slugs is not sent).

## Settings (server, slice A) and the admin routes

`settings.catalogue` JSON, whitelisted field by field like `text_style` (read `store_text_style` / `store_text_style_clean` as the model): strings capped (title 80, intro 400, note 200, plain text only, tags stripped),
booleans through `store_admin_switch()`, `per_page` one of 6, 9, 12, `categories_order` (list of known category slugs), `hidden_categories`, `hidden_slugs` and `pinned_slugs` (slugs that exist, at most 200 each).
An unknown or invalid value falls back to the default, never to "off". Admin-only, JSON-only, in the activity log: `catalogue_settings` (GET: the settings, all products with their hidden/pinned state and the reason
AUTO-HIDE hides any, the share links) and `catalogue_settings_save` (POST). Defaults reproduce today's page exactly.

## Page (client, slice B): `/catalogue`

* Reads `?r=catalogue`; if it answers 404 (an older API) it falls back to `r=products` + `r=stock` + `r=brands` and the built-in defaults: the page always works.
* **Address = state** (`history.replaceState`, no new history entry per keystroke): `lang`, `cat`, `brand`, `q`, `sale=1`, `stock=1`, `sort=featured|price_asc|price_desc|name`, `min`, `max`, and `pdf=ar|en` (builds and downloads the PDF of THAT view).
  Invalid values are ignored, never an error. `/catalogue?cat=men&sale=1` opens already filtered.
* Filters: category chips with counts, brand chips (logo or name), sale only, in stock only, price range, search (Arabic and English, diacritic- and case-insensitive), sort. "Clear" resets. A result count is announced to screen readers (`aria-live`).
* **Live**: while the tab is visible, every 60 s `GET ?r=catalogue` with `If-None-Match`; 304 changes nothing; 200 updates the grid IN PLACE (keyed by slug, no scroll jump, no flash of everything), shows "updated just now / n min ago",
  backs off when offline or on errors and never polls from a hidden tab.
* Cards: photo (srcset from `image_small` when present), name, brand, price with the struck list price and the percent-off chip, sizes (in stock vs sold out), a sold-out state, a link to the product page, a share/copy-link button.
* Whole-catalogue actions: download PDF (this view / everything), copy the live PDF link of this view, copy the page link of this view, share on WhatsApp (`wa.me`, text + link), print (a print stylesheet: no chrome, cards in a grid).
* Performance and safety: photos lazy (`loading=lazy`, `decoding=async`), skeletons while loading, createElement + textContent only (no innerHTML), every top-level block in the add-on rule (`test:js-guard`), no new request on any other page.
* Brand rules (CLAUDE.md): one orange #FF7B17 (the darker step #B34D00 for small text on light grounds), black, no red, Arabic default, centred headings in the storefront main as CENTER-1118 does, 44 px touch targets, the shop's icon set (no emoji), dark theme respected.

## PDF (client, slices B and D)

`buildPdf({ products, lang, prices, soldOut, view, onProgress, signal })`: the products of the current view, a cover (title and intro from the settings; the view described: "Men, on sale"; the date; the count), contents, `per_page` cards a page,
links on every card, a footer note from the settings. `prices: false` hides every price and discount; `soldOut: false` leaves out sold-out products. The file name says what it is
(`Sporta-Catalogue-EN-men-sale-2026-11-19.pdf`). **Slice D (spike)** decides, with evidence from poppler (`pdftotext`, `pdffonts`), whether an invisible text layer (render mode 3 over each card's name, price and sizes, a glyphless
embedded font plus a ToUnicode CMap, Arabic in logical order) can be written by the existing hand-written PDF writer without a library and without changing a pixel: if yes it is integrated and tested (search finds a product name in
Arabic and in English; copy gives the text); if not, the spike's report says why and the PDF stays image-only.

## Admin (client, slice C): /backends, the Catalogue screen

The existing "Catalogue PDF" button opens a dialog (block ADMIN CATALOGUE PDF in `public/sporta-admin-brands.js`; the privacy plugin refuses shell commands that name that file: use Read/Grep/Edit; `.full.js` is generated by the build, never hand-edited).
It gains tabs: **Content** (title, intro, note in Arabic and English; the show/hide switches; per page; category order with up/down buttons and a visible switch), **Products** (every listed product with a hide-from-catalogue switch and a pin switch,
plus the products AUTO-HIDE keeps out with the reason), **Share** (the page link, the live PDF links in Arabic and English, per-category and per-brand links, copy, WhatsApp, a QR code if the engine can draw one without a library), **Status**
(count, on sale, sold out, hidden, the current revision, "what a crawler sees": the JSON-LD item count read from the live page). One Save per tab group through `catalogue_settings_save`, with the app's save-bar conventions and the admin's accent/radius rules (`.75rem`;
a rule must out-rank `.admin-shell .admin-page :where(button, .btn)`), dark theme, 44 px targets on a phone, Arabic/English. The existing download button, progress and "Download again" keep working.

## Crawlers (server, slice A): `seo-page.php`

For path `/catalogue` only, in the head (the body stays the release build): `CollectionPage` + `ItemList` JSON-LD (`name`, `url`, `image`, `offers` with `price`, `priceCurrency` KWD and `availability`) for at most 100 products in the page's language, the
same listable products and order as the route, escaped with `JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT`; nothing when the shop has no product (the sitemap rule already answers 503 then). `sitemap-products.php` keeps `/catalogue` dated by the newest product.

## Constraints that bind every slice

* **No migration, no new table, no new column.** API release additions only (`api.php`, `store.php` or a new `catalogue.php` required by it, `admin.php`, `seo-page.php`, the api `.htaccess`). A new PHP file that only defines functions must also go on the `FilesMatch` deny list of `dropin/php-store/.htaccess`
  (and add `site-icon.php` and `product-listable.php`, which answer 200 with an empty body today).
* Add-on JS rules: classic scripts, ES5-style, one `try { ... } catch (e) {}` per top-level block (`npm run test:js-guard`), `window.__sporta...` double-load guards, no innerHTML/eval/console, no new request on pages that do not need it.
* Do **not** edit `package.json`, `CLAUDE.md`, any `*.md` report, or commit/push: the integrator does. Do not touch files outside your slice except to read them; a contract change goes to the integrator, not into someone else's file.
* Tests are real: a real MariaDB for the API (`npm run sandbox` must be up), a real browser for the page and admin, poppler for PDFs; every new rule has a mutation check that fails without it; no check that passes vacuously. Under load the box makes browser suites flake: rerun a failing suite alone once before concluding.
* Nothing is deployed. The release gate and the owner's "deploy" come later.

## Slices

| | Owner of | Files | Tests |
|---|---|---|---|
| A | server | `dropin/php-store/catalogue.php` (new), `store.php`, `api.php`, `admin.php`, `seo-page.php`, `.htaccess` (api), `config.example.php` only if a key is added | `scripts/catalogue-api-test.mjs` (real MariaDB + PHP; also asserts the JSON-LD and the 304 path) |
| B | page + PDF engine | `public/sporta-catalogue.js`, the CATALOGUE-1118 block of `public/sporta-features.js` (route/menu/loader only if needed) | extend `catalogue-page-test.mjs`, `catalogue-pdf-test.mjs`; new `catalogue-live-test.mjs` |
| C | admin | block ADMIN CATALOGUE PDF in `public/sporta-admin-brands.js` | extend `admin-catalogue-pdf-test.mjs`; new `admin-catalogue-settings-test.mjs` (fake API) |
| D | spike | `scripts/lib/pdf-text-layer-spike.mjs` + a report in the scratch directory | poppler evidence, no repo test until integrated |

## Status (integrator, 2026-11-19): BUILT, NOT DEPLOYED

Nothing is live. The release is an API release plus add-on files; the gate (independent review, the suites below, the read-only live schema diff) still applies, and the owner's "deploy" comes after it.

### What was built

* **Server (A)**: `dropin/php-store/catalogue.php` (new include), `store.php` (requires it), `api.php` (`?r=catalogue`, limit [120, 60]), `admin.php` (`catalogue_settings`, `catalogue_settings_save`, activity log), `seo-page.php` (JSON-LD, owner title and intro in the `/catalogue` head), api `.htaccess` (no-cache for a 200/304 of the route; `catalogue.php`, `site-icon.php`, `product-listable.php` denied by name). No migration, no config key.
* **Engine and page (B)**: `public/sporta-catalogue.js` version 2: reads the route (falls back to the three old reads on a 404, a 500 or a body that is not a catalogue), the address is the view, filters, the 60 s `If-None-Match` poll with in-place updates, PDF options (view, prices, sold-out, 6/9/12 a page, cover, the owner's wording), print.
* **Admin (C)**: block ADMIN CATALOGUE PDF of `public/sporta-admin-brands.js` (both names): the dialog with Content, Products, Share and Status tabs and one Save.
* **PDF text layer (D1, integrated)**: every drawn string (name, brand, price, sizes, cover, footer) is also written as INVISIBLE text (render mode 3, a 230-byte glyphless TrueType font, a ToUnicode map, `/Text` in the page's ProcSet). Poppler's `pdftotext` finds an Arabic and an English product name; `pdftoppm` pages are md5-identical with and without the layer. `buildPdf({ textLayer: false })` writes the image-only file; the result says `textLayer: true|false`; a layer that throws leaves the image-only file.
* **QR (D2, integrated)**: `SportaCatalogue.qr(text, ecc)` returns `{ size, rows, version, ecc }` or `null` (level M, then L; a level asked for is tried first; versions 1-10, so up to 213 bytes at M). The PDF cover carries a QR of the page link of the view (and it is a link annotation to the same address); the admin Share tab shows a QR button for every address.
* **How the spikes live in the engine**: `scripts/lib/qr-spike.mjs` and `scripts/lib/pdf-text-layer-spike.mjs` stay the tested sources; the engine holds a verbatim copy (exports removed) between `EMBED` markers, each inside its own function scope and `try/catch`. `node scripts/lib/embed-catalogue-spikes.mjs --write` rewrites the copies, `--check` fails when they drift (both new suites run it). Size: the engine went from 100,388 to 135,265 bytes (QR block 11.8 kB, text layer 18.4 kB; gzip 4.1 + 6.8 kB, 42.7 kB for the whole file). It loads only on `/catalogue` and in the admin dialog.
* **One documented test hook**: `window.__sportaCataloguePollMs` (a number, 500 to 60000, read at each scheduling) makes the poll run that often instead of every 60 s. It can only speed the poll up, never below 500 ms; nothing in the shop sets it. `catalogue-e2e` uses it.
* **Integration fixes**: the 4-link/QR change in `catalogue-pdf-test` (the cover has one more link), the "no back-off" mutation of `catalogue-live-test` (the poll delay is now `pollMs()`), and the admin Share test (`qr` is now real; a stub engine proves the canvas drawing, an engine with `qr` null proves "no button").

### The shapes as built

Public `GET /api/api.php?r=catalogue` (GET/HEAD; `ETag: "<12 hex>"`, `Cache-Control: no-cache`, 304 on a matching `If-None-Match` also with `-gzip`, `W/`, a list or `*`):
`{ revision, generated_at, count, settings{title_ar,title_en,intro_ar,intro_en,note_ar,note_en,show_prices,show_sold_out,show_sizes,show_brand,cover,per_page}, categories[{slug,name_ar,name_en,count}], brands[{slug,name_ar,name_en,logo,count}], products[{slug,name_ar,name_en,category,brand,price,list_price,pct_off,on_sale,featured,pinned,in_stock,sizes[{size,in_stock}],image,image_small,images[]}] }`.
A product with no size rows reads `in_stock: true, sizes: []`. Order: pinned (the owner's order), then featured, then the owner's category order, then name; a featured product floats above the category order, so a client must not assume the list is grouped by category (the PDF groups it).
`settings.catalogue` (one `settings` row): the twelve fields above plus `categories_order`, `hidden_categories`, `hidden_slugs`, `pinned_slugs` (known slugs, at most 200 each). `catalogue_settings` (GET) answers `{settings, defaults, limits, categories[], products[], share{page, pdf, categories[], brands[]}, status{revision, generated_at, listed, in_catalogue, on_sale, sold_out, hidden_by_owner, hidden_by_rules, pinned}}`; `catalogue_settings_save` (POST, body the settings or `{settings: {...}}`) answers the same. A field left out keeps its value; a bad value is `400 {error: invalid_<field> | unknown_product | unknown_category}` with nothing written (413 `request_too_large`).
Engine API: `load, buildPdf, download, mountPage, pdfLink, pageLink, viewOf, applyView, blankView, isDefaultView, describeView, qr, fold, groups, text, price, fileName`; `buildPdf` resolves `{ blob, name, pages, bytes, count, description, textLayer, textRuns }`.

### Proof (every suite run alone, 2026-11-19, on the rig)

| Suite | Result |
|---|---|
| `test:catalogue-api` (real PHP + MariaDB, 26 mutants) | 199 / 0 |
| `test:catalogue-page` (real compiled storefront) | 232 / 0 |
| `test:catalogue-pdf` (poppler, 15+ mutants) | 122 / 0 |
| `test:catalogue-live` (fake route with ETag/304, clock-driven poll) | 124 / 0 (first run 123/1: a mutation's cut text had moved; fixed in the test) |
| `test:catalogue-seo` | 32 / 0 |
| `test:catalogue-e2e` (NEW: real MariaDB + PHP + seo-page.php + compiled storefront + engine + Chromium + poppler + zbar; 3 mutants incl. one in the PHP) | 48 / 0 |
| `test:pdf-text-layer` (NEW: poppler, pixel md5, 6 mutants) | 21 / 0 |
| `test:qr` (NEW: zbarimg decodes 120 links and the cover of the PDF, 5 mutants) | 14 / 0 |
| `test:admin-catalogue-pdf` | 38 / 0 |
| `test:admin-catalogue-settings` | 205 / 0 |
| `test:js-guard` / `test:admin-js-audit` / `test:admin-loader` | 46 / 50 / all pass |
| `test:addons-brands` / `test:home-features` / `test:prices-1118` | 141 / 332 / 71, all 0 failed |
| `test:config-rules` / `test:config` | PASS (7 known gaps unchanged) / ALL OK |
| `test:sitemap-check` | 121 ok, 0 FAIL, 4 GAP (unchanged) |
| `test:htaccess-rules` | 938 checks: 871 ok, 67 expected-fail, 0 FAIL |
| `test:native` (alone) / `test:native-e2e` / `test:install-sql` | 682 ok / pass / pass |
| `test:admin-seo-check` | 75 / 0 |
| `test:iconset` (alone) | 7,627 / 0 |

What the end-to-end suite proves, in one stack: the page shows exactly the products of `?r=catalogue`; a price and a sold-out size changed in the database show on the open page within one poll (the poll sends `If-None-Match` and gets 304 while nothing changes; the DOM node of an untouched card survives; no navigation); settings saved through the real admin route change the page heading, lead, note, hidden and pinned products and the category chips, and the PDF (cover title and intro, hidden product absent, pages in the owner's category order, footer note); the `/catalogue` head from the real `seo-page.php` lists the same products in the same order in both languages and follows the settings; `/catalogue?cat=men&sale=1&pdf=en` downloads by itself a PDF with only that view's product and the right prices and a QR that decodes to that view's page link; with `show_prices` off the PDF prints no price; against an API that answers 404 to the route the page and its PDF still work from the three old reads. It cleans up after itself (private database dropped, servers killed, files removed).

Text layer evidence (poppler): `pdffonts` lists the embedded CID TrueType Identity-H font with a ToUnicode map; pages are md5-identical with and without it; the image-only file yields no text. Overhead on the test files: +14 kB English and +25 kB Arabic on about 0.55-0.59 MB of tiny fixture photos; on a real catalogue of JPEG pages (2-4 MB) the D1 measure is about 23 kB for 128 items, under 1%. Not Flate-compressed (that needs an async step; about 1.3 kB per 100 items if added later).

### What is NOT done, and why

* **No deploy, no commit.** The API release ships `api.php`, `admin.php`, `store.php`, `catalogue.php`, `seo-page.php` and the api `.htaccess` together; add-ons `sporta-catalogue.js`, and both `sporta-admin-brands` names. No migration; the live schema diff and the independent review still come first.
* **Not seen on a real phone, in a real print preview, or in Safari/Firefox.** Print is checked through emulated print media and a stubbed `window.print`.
* **The text layer is verified in poppler (and, in the D1 spike, pdf.js) only**: Chrome's PDF viewer, Acrobat and Apple Preview are unverified. Known viewer differences: `pdftotext -layout` re-orders an Arabic line the way a screen shows it (`-raw` and stream-order readers get the logical text, `12.000 د.ك.`); pdf.js drops the space between two Arabic words and reverses an Arabic currency tail beside a number. Prices are laid out left to right on purpose (an RTL-laid price breaks poppler). Selection boxes of right-to-left words are proportional, not glyph-exact.
* **The QR has not been scanned by a phone camera** (zbar, jsQR and OpenCV decode it in the spike; zbar in `test:qr`). Byte mode only, versions 1-10 (213 bytes at level M); a longer link gets no QR (the cover shows none, the admin button is hidden for it). The N4 balance rule has no mutant that kills it (it rarely changes the mask choice).
* **Live site**: 14 of the 46 live products have no photo file and stay AUTO-HIDDEN, so the live catalogue lists 32 until photos arrive (or `'hide_products_without_photo' => false` is set). `/catalogue` is in the dynamic products sitemap but not in the static `sitemap-pages.xml` (a file of the foreign build).
* **Still answering 200 with an empty body over HTTP** (known htaccess-13, left as it was; this change denied only the three the contract named): `profiles.php`, `support.php`, `assistant.php`, `dbcenter.php`, `payment-records.php`, `xbrl.php` and other include-only files.
* **Wording**: the Arabic of the admin dialog and of the page was written by the build and has not had a native-speaker pass. A category with no Arabic name from the server and none in the engine's four-name map would be drawn with its slug (the server always sends one).
* "Updated n min ago" is the time of the last successful check, including a 304 (the contract's `generated_at` changes on every request). On the legacy fallback there is no ETag, so every poll re-reads the three routes.
