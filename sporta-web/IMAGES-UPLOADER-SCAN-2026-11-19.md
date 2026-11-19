# Images and uploader scan, 2026-11-19

Owner: "scan images uouder" (the photo uploader). Three parts: the photos on the server, the upload route (`admin.php?r=product_image_upload`), and the
Photos panel on /backends -> Catalogue (block ADMIN PHOTO UPLOADER, `public/sporta-admin-brands.js`, both names).

**Method.** (1) Read-only one-shot VPS jobs, media folder mounted read-only: `scripts/images-live-scan.mjs` (commit `e8510fc0`) and
`scripts/photo-uploader-live-check.mjs` (commit `1967e0d7`); projects deleted after. (2) The real PHP route, copied to a temp folder and run at PHP's
out-of-the-box limits (memory 128M, post_max_size 8M), probed with 14 requests; the probe script is not shipped. (3) `npm run test:photo-uploader`:
**263 passed, 0 failed** (the real add-on file and the compiled admin's real light and dark rules, fake API; panel placement, file name -> product,
lossless bytes, one request at a time, 429 and 401 handling, 320 / 390 / 1280 px, Arabic RTL, contrast, focus, mutation check). Nothing was written to the
live server and nothing deployed.

## Result

**The live photos are clean; the route is sound except for one missing limit; the panel has never been used on the live site.**

## The photos on the server (live, measured)

- 36 files (29 JPEG, 7 PNG, 9.24 MB), all mode 644, every extension matches the bytes, no identical pair, the folder's `.htaccess` that denies PHP is present.
  Largest file 0.69 MB; none over 1 MB.
- **No location data.** 20 of 29 JPEGs carry a camera (EXIF) block; none carries a GPS position (PNGs are not parsed; they hold none by format here).
- Small copies: 35 of 36 photos have both `-320.webp` and `-640.webp`, 33 also `-800.webp`; `variants.txt` is present. The one missing is `tekno-shorts-black`.
- 14 of 46 active products have no photo file, so the shop has hidden them since the 2026-11-19 deploy: `cagliari-calcio-backpack`, `cagliari-calcio-backpack-navy`,
  `cheetahs-rugby-t-shirt`, `energy-t-shirt-red-white`, `flash-shorts-green`, `flash-shorts-red`, `gymshark-phone-strap`, `naples-leggings-black`,
  `naples-sports-bra-pink`, `street-pants-navy`, `tekno-shorts-royal`, `vanquish-stringer-vest-white`, `vanquish-t-shirt-navy-blue`, `vanquish-t-shirt-white`.
  Ten of them are also the placeholder-stock products of INVENTORY-SCAN INV-01. No product row names a file that is missing.
- 32 active products have an empty `image` column and are shown only because a file carries their slug.
- One spare photo no row names: `vanquish-tank-navy-alternate.jpg` (its product shows its slug photo; this one is never shown).
- Sizes and shape: one photo is under 800 px on its short side, `tekno-shorts-black.jpg` 600 x 834 (soft on a retina phone and under the 2.5x zoom; no small copies);
  9 are under 1200 px on the long side. 27 are 1000 x 1200 (5:6, ratio 0.83), 7 are square, 2 are 0.77 and 0.72: the shop frames 4:5 (0.80), so 35 of 36 sit
  a little off the frame (the PHOTO BACKDROP block paints the bands).
- 138 macOS leftovers (`._name` AppleDouble stubs, 163 bytes each): 39 in the folder, 99 in `responsive/`, one is `._.htaccess`. Harmless: the root `.htaccess`
  answers 403 to any dotfile and `make-image-variants.mjs` skips names that start with a dot. Clutter from a Mac copy.
- **Tool fix found by this scan:** the first run reported "33 small copies whose original is gone". That was the scan's own mistake (it did not know `-800.webp`);
  fixed, `test:images-live-scan` 18, and the second live run reports 0.

## The upload route (measured on the real code)

| Request | Answer |
|---|---|
| PNG 1600 x 1600 (180 kB), name `Cloudsoft Jacket - Army Green (1).PNG` | 200, `/images/products/cloudsoft-jacket-army-green-1-bbcc6e9384.png` (name lower-cased, symbols to dashes, a random 10-hex suffix) |
| JPEG of exactly 10 MiB | 200 |
| JPEG of 10 MiB + 1 byte | 413 `image_too_large` |
| JPEG of 12 MiB (base64 over 16 MiB) | 413 `request_too_large` |
| declared PNG, bytes are JPEG | 400 `image_not_an_image` |
| SVG / GIF / empty / not JSON | 400 `image_bad_format` |
| name `../../etc/x.png` | 200, `x-1a07c81061.png` inside the folder; nothing written outside it |
| a valid PNG followed by PHP source | 200, stored as `.png` (the folder denies PHP by extension and by `.htaccess`; it is served as an image) |
| **30000 x 30000 px PNG (900 megapixels, 109 kB)** | **200, accepted** |

Files are written 0644, never overwritten (a random suffix), and an upload is logged to the activity log (`product_image_upload` is in `$activityActions`).
A JSON body is not bound by `post_max_size` (measured on PHP's built-in server, not on the live Apache: a 5 MB body arrived whole with `post_max_size=1M`), and
`LimitRequestBody` is not set in the repo.

## Findings

| # | Severity | What | Who decides |
|---|---|---|---|
| UP-01 | Medium | **No pixel limit.** The route checks bytes, type and the 10 MiB cap, but not the picture's size: a 109 kB file that is 900 megapixels was accepted and would be published as a product photo that no browser can decode (and the admin's own thumbnail step would try). Admin-only, so a slip rather than an attack. The panel warns under 1200 px but has no upper limit either. | A cap (for example 12,000 px a side and 60 MP) in the panel is an add-on change; the same cap in the route is an API release behind the review gate. Not built. |
| UP-02 | Medium | **A new upload is served at full size to every card.** The route keeps the original (owner decision: lossless, up to 10 MiB, camera size) and makes no small copies; the storefront only uses `-320/-640/-800` copies for names listed in `variants.txt`, which `make-image-variants.mjs` writes offline. So the first real upload shows a shop card downloading a multi-megabyte file for a 300 px slot; a /shop page of twelve such cards is tens of megabytes. Zero impact today: the folder holds no file the route wrote. | Owner: a host job that runs the variants tool after uploads (like the four host cron jobs), or the route making the copies with PHP's image library. Needs a decision; not built. |
| UP-03 | Medium (to verify) | **A photo uploaded for a slug-matched product may replace what the shop shows without the panel's warning.** The panel says "a main photo the product already has moves to second place" by reading the `image` column. For the 32 products whose `image` is empty (the photo is found by slug), the panel sees "no main photo" and sets the new file as `image`; the slug photo stays on disk but the shop would prefer the new one. Read from the code and the live data, not seen in a browser. | Check with one product when the first real upload is done. |
| UP-04 | Info | **The route has never been used live**: no file in the folder carries its `-<10 hex>` suffix. A real photo through the full path (browser, Traefik, Apache, PHP) is unproven; the live PHP's own limits cannot be read from here. | Owner: one real photo through Catalogue -> Photos (it writes a file and edits one product, so it needs your yes). |
| UP-05 | Info | **The panel can find the live Catalogue screen.** After fixing the check (it stopped one hop short and falsely reported the headers absent), it reads 49 of 49 chunks of the live build: "Every product in the database", "Web name", "On sale", "Price" are in `Catalog-KfIYI9_5.js`, and the three routes are in `api-BR6g486R.js`. Not seen in a signed-in browser (a session may not sign in to the live admin). | Owner: open /backends -> Catalogue once and confirm the Photos panel sits above the product list. |
| UP-06 | Low | Orphans are possible by design: a file uploaded and then refused by `product_save` stays on disk (the panel retries without uploading again, and never deletes). No tool lists them except this scan (`files that no product row names`). | Information. |

## What changed in the repo

`scripts/images-live-scan.mjs` (knows `-800.webp`, lists stray files in `responsive/`), its test (18 checks), `scripts/photo-uploader-live-check.mjs`
(follows chunk names to the end), `scripts/inventory-live-scan.mjs`. No application code, no migration, no deploy.
