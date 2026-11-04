# Performance — Sporta web

This describes **the live site**. `sporta-web` is what runs at
www.sporta.com.kw; there is no other project to apply these to. (An earlier
version of this file read as though this app were a demo and the real shop
lived somewhere else. It did not, and saying so sent people to the wrong
codebase.)

Numbers below are measured, not estimated. Re-measure rather than trust them if
the catalogue or the dependencies have moved.

## What the build does

### 1. Route-level code splitting (`src/App.jsx`)
Twelve routes are `React.lazy()` imports behind `<Suspense>` — Shop, product,
cart, checkout, payment result, about, contact, wishlist, track, invoice, 404
and the entire admin. A first-time visitor to the home page never downloads
checkout or admin code.

The admin is the one that matters: `AdminApp` is **101.8 kB raw / 21.9 kB
brotli** of screens no shopper ever opens. It is also excluded from route
prefetching on purpose (`src/lib/prefetchRoute.js`).

### 2. Vendor chunk isolation (`vite.config.js`)
React, React-DOM and React-Router go into a stable `react-vendor` chunk, so a
content deploy does not make returning visitors re-download the framework.

### 3. Modern build target
`target: 'es2022'` — no legacy transpilation for browsers that the payment
gateways already require anyway.

### 4. Compression + cache tiers (`public/.htaccess`)
Brotli and gzip on every text type including `application/json`; a year of
`immutable` on content-hashed assets; `no-cache` on the HTML so a deploy is
visible immediately; security headers. `npm run audit:storage` asserts the tiers
against a real Apache.

## Measured build output

| | raw | brotli |
|---|---|---|
| `react-vendor.js` | 208.3 kB | 62.3 kB |
| `index.js` (entry) | 129.9 kB | 37.7 kB |
| `AdminApp.js` (never on the shopper path) | 101.8 kB | 21.9 kB |
| `Checkout.js` | 21.8 kB | 6.1 kB |
| CSS | — | 13.6 kB |
| **all JS, 23 files** | **539.6 kB** | **157.2 kB** |

**First paint needs ~114 kB brotli**: entry + react-vendor + runtime + CSS.
Warm build takes ~1.2 s.

## The scaling limit, when it comes

Measured against a synthetic 3,726-product / 22,122-variant catalogue: query
time is not the problem (28 ms and 46 ms), the payload is. At ~4,000 distinct
products `?r=products` is roughly **150 kB brotli per request**, and
`api/.htaccess` sets `Cache-Control: no-store` across the whole directory — so
the catalogue is re-fetched on every page load and the browser is forbidden from
reusing it.

`no-store` is right for `status`, `invoice` and `order`. It is inherited by
`products`, `slides`, `brands` and `stock`, which are byte-identical for every
visitor. Splitting that is the highest-value change left, and it is not a
one-liner: `Header set` in `.htaccess` overrides whatever PHP sends.

Two things that look like fixes and are not, both measured:
- **An index on `products(active)`** — the optimiser ignores it (~85% of rows
  are active, so a scan wins). Timings were identical with and without.
- **Batching the per-line lookup in `store_price_lines`** — it costs 0.37 ms per
  cart line against a hard cap of 50, and it sits in the server-side price
  authority, which is the worst place in the shop to add complexity.

## Further wins (when there is real content)
- Real product photography in WebP/AVIF with width/height set.
- `loading="lazy"` on offscreen images.

---

## Core Web Vitals, measured on a phone

`npm run test:perf` ends with a section that emulates a mid-range Android on a
Kuwaiti mobile connection — 4× CPU throttle, 1.6 Mbps, 150 ms RTT — because a
fast desktop is the wrong instrument for the metrics Google ranks on. Two real
defects were found that way and both are now guarded:

| | before | after |
|---|---|---|
| First Contentful Paint | 3376 ms | ~430 ms |
| Cumulative Layout Shift | 0.0424 | 0.0001 |
| Largest Contentful Paint | 3452 ms | ~2000 ms |

**FCP.** The site is a single-page app: nothing appeared until 340 kB of
JavaScript had been fetched, parsed and executed, and the 77 kB stylesheet
blocked even a static shell from painting. `index.html` now carries a shell —
the header bar, the real logo, and a hero box at its real height — styled by a
handful of rules inlined in the `<head>`, and a Vite plugin turns the stylesheet
into a `preload` that promotes itself on arrival. There is no flash of unstyled
content to trade against: nothing but the shell renders before the app's
JavaScript, and the CSS is a quarter of its size.

**CLS.** The hero's height is an owner setting delivered by `/api?r=slides`,
which lands after the paint. Applying it on arrival grew the hero and pushed the
page down — one 0.042 jump at 3.3 s, the largest single shift on the site. The
boot script now reads the last known size from `localStorage` and writes
`--hero-h` before anything renders; a change takes effect on the next load.

**LCP** is bounded by when React mounts, so it is printed rather than enforced —
a timing assertion that flakes is one people learn to skip. Moving it further
would mean server-side rendering, which is a different architecture, not a
tuning change.

---

## Page weight lane, 2026-11-03 ("reduce sizes", images and files)

Everything below is measured, and says where the measurement ends. The live site could not be probed (the Hostinger
connector was signed out), so the numbers come from the captured live storefront (`index.html`, the compiled chunks and the
API answers of 2026-11-02), the repo's own add-ons and static files, a local mirror of that (text compressed like Apache:
Brotli q5 / gzip 6, wire bytes), and a real Apache 2.4 for the `.htaccess` rules. **The live product photographs are not in
the repo and were not measured**: where a photograph is needed, a stand-in made with ImageMagick is used and said so.

### Where the bytes are (first load of `/`, phone 390px DPR3, wire kB)

| | Arabic (the default) | English |
|---|---|---|
| HTML | 6.2 | 6.2 |
| app JavaScript (react-vendor 68.5, index 47.1, route chunks) | 117.5 | 117.5 |
| app CSS | 29.4 | 29.4 |
| **add-on JS** (23 fixed-name files, scripts) | **81.7** | 81.7 |
| **add-on CSS** | **51.9** | 51.9 |
| **fonts** (8 subset WOFF2: Alexandria variable + Plex 400/600/700, Arabic and Latin each) | **247.5** | 87.2 |
| images (hero, five category tiles, infobar, logo, favicon) | 170.9 | 173.8 |
| API (the products list, plus the hero slide served by `api.php`: 94 kB live, a 42 kB stand-in here) | 46.3 | 46.3 |
| **total** | **751** | **594** |

What stands out, largest first:

1. **Fonts: 247 kB in Arabic.** The Arabic page needs the Arabic *and* the Latin subset of every face (digits, "KWD", the brand
   name), so all eight files load; English loads the four Latin ones (87 kB, 130 kB from 768px). 187 kB of it is Plex in three
   weights (400/600/700). Cached 30 days and held by the service worker, so it is a first-visit cost.
2. **The add-ons are 134 kB Brotli (418.7 kB raw) in the repo today, against 48 kB (130 kB raw) live on 2026-11-02**, and two
   of them are admin-only code that the STOREFRONT page links and every shopper downloads: `sporta-admin-brands.js` 158.9 kB
   raw / 44.8 kB Brotli and `sporta-admin-knet.css` 60.8 kB raw / 16.0 kB Brotli (render-blocking). 60.8 kB of Brotli is 45% of
   all add-on bytes and 8% of the Arabic phone home page. Not changed: they are lane D's files, and splitting them needs a
   loader (below).
3. App JavaScript 117.5 kB: the compiled build, no source here.
4. Images 171 kB: the category tiles and heroes are already per-device WebP (`test:images` holds them under 175 kB on a phone).
   The largest are the hero slide (94 kB, one file for every device: `api.php?r=slide_image` has no width option), then
   `cats/mobile/art-outlet.webp` 31 kB, `art-accessories.webp` 29 kB, `infobar.webp` 29 kB.

Minifying the 23 add-ons would take them from 133.6 kB to 59.8 kB Brotli (418.7 kB -> 195.8 kB raw; lightningcss for CSS, rolldown's
minifier for JS, an estimate: nothing was changed). It is an owner decision because it makes the live bytes differ from the repo's
(`vps-deploy.mjs` verifies by md5) and the repo's comments are the documentation.

### What changed

**1. `public/.htaccess`: revalidating a compressed file now answers 304.** `mod_deflate` / `mod_brotli` give the compressed copy
an ETag ending `-gzip` / `-br`; a browser sends that back; Apache compared it with the plain ETag, so it never matched and every
conditional request answered a full 200. Every add-on carries `no-cache, must-revalidate`, so a returning visitor re-downloaded
**all 23 files on every page load**: 51.5 kB gzip for the copies live on 2026-11-02, **144.9 kB gzip for the copies in this repo** (re-measured 2026-11-04 on Apache 2.4.58: 148,407 B gzip, 140,049 B Brotli; the add-ons keep growing).
`RequestHeader edit If-None-Match "-(?:gzip|br)(\")" "$1"` strips the suffix before the conditional is evaluated. Measured on
Apache 2.4.58 with the real file: all 23 answer an empty 304 to their own gzip ETag and to their Brotli ETag, `no-cache` is kept
on the 304, a validator that is really stale still gets the new file (`test:htaccess-rules` section 5 and `test:sizes-weight` 3).
The live Apache version was not probed; on a version that already answers 304 the line is a no-op.

**2. `public/.htaccess`: the 404 shell is compressed.** `ErrorDocument 404 /index.html` hands every unknown URL 27,272 bytes of
HTML, and an internal redirect is a new request whose content type the type-based filters never see, so it went out plain. A
`<If "%{REQUEST_STATUS} == 404">` names the filters: **27,272 B -> 10,144 B (gzip)**, Brotli for a client that offers it, plain for
one that offers nothing. This is the cost of every crawler probe and of any file that is not there, a missing photograph copy
included. (Both 1 and 2 were found earlier as `htaccess-11` / the shell half of `htaccess-16` in `htaccess-rules-test.mjs` and
sat as expected failures; their markers are deleted and the suite now asserts them. An unapplied diff from the earlier .htaccess
lane touches the same two places: drop its `RequestHeader` and `<If>` hunks when applying it.)

**3. Small copies of the product photographs: `scripts/make-image-variants.mjs` + a block in `public/sporta-features.js`.**
The compiled storefront gives a `srcset` to exactly the ~33 photographs it was built with (a hard-coded list in its bundle) and
to nothing else. An uploaded photograph (lossless: 3000-4000 px, up to 10 MiB) goes full size to a 300px shop card, a 64px gallery
thumbnail, the 72px bag thumbnail, the 80px cart line and the 48px checkout row; and the three built-in photographs the build
excludes from its `srcset` (`cagliari-calcio-sweatshirt-navy`, `sgomma-t-shirt-navy`, `tekno-shorts-black`) go full size to the cards too.
The maker (dry run by default, ImageMagick with WebP, no dependency added) writes
`/images/products/responsive/<stem>-320.webp`, `-640.webp` BESIDE the originals and `variants.txt` listing what exists; the
add-on reads that list and puts a `srcset` on thumbnails and shop cards. Originals are never opened for writing (asserted by
sha-256), nothing is enlarged, a phone photograph stored sideways comes out upright, the colour profile is kept and EXIF/GPS is
left out of the copy. **Without the list the add-on changes nothing on the page** - but it is not free (review, 2026-11-04): the first version asked for
`variants.txt` on every full page load, and until the maker has run that URL answers 404 with the whole error shell (19 kB, about 6.3 kB Brotli on the live
shell; 27 kB / 10 kB gzip for the shell this repo builds), uncached, for every visitor. A miss is now remembered in `localStorage` for 6 hours (no request, no
hook, no observer); a first visit, or a miss older than that, asks again, so a list made by a later maker run reaches a browser that recorded a miss up to
6 hours late. A 5xx or 429 for the list (a restart) is neither a miss nor a reason to drop a remembered list. Asserted in `test:sizes-weight`, with a mutation check.
Fail-safe, each asserted in Chromium: a listed copy that is missing falls back to the original and the build's own `onError`
(which would show the "photo unavailable" placeholder) never runs; a missing list, a 404 shell, a 200 with HTML or a list without
its header line leave every `<img>` as it was and request no copy; React reusing an `<img>` for another piece cannot leave the old
piece's copy up; the gallery's main photograph (zoomed 2.5x) and the full-screen view keep the original; `/backends` is untouched.

Two things measured about *when* it can act, because they set what it is worth:

- React builds an `<img>` detached and sets `src` last; the browser asks for the file at that instant, long before an observer sees
  the element. So the add-on hooks `Element.prototype.setAttribute` for `src` on an `<img>` only (the srcset goes on first, in the same call):
  the first and only request is the copy. Without the hook a throttled run (120 ms, 12 Mbit/s) downloaded the four 120 kB originals in
  full and the copies after them.
- The add-on scripts are `defer` and `no-cache`, so on a direct page load the app can draw before they run. The list is therefore
  remembered in `localStorage`; the first, cold load of a page that already shows a bag falls back to the old behaviour (measured:
  +0.3% to +6% bytes, because the copies are fetched on top of originals already on their way), and every later screen is hooked.
  An eager `<img>` that is already loading is never switched; only `loading="lazy"` ones that have not been asked for yet are.

### Measured effect of 3 (mirror of the live storefront, 120 ms / 12 Mbit/s, bytes counted as sent, ar and en identical)

A session: `/about` (the list is learned), `/shop` scrolled to the end, four product pages with "add to bag", the drawer, `/cart`, `/checkout`.

*Built-in photographs* (stand-in originals: 1000x1250 JPEG, 120 kB), after the maker ran once with `--widths 320,640` on the live folder:

| window | before | after |
|---|---|---|
| 320 (DPR2) | 1113.7 kB | 309.8 kB |
| 360 / 390 (DPR3) | 1437.1 kB | 1143.7 - 1172.7 kB |
| 768 (DPR2) | 1546.5 kB | 781.1 kB |
| 1280 (DPR1) | 1113.7 kB | 309.8 kB |

Where it comes from: the shop grid (561 -> 229 kB at DPR 1-2, 965 -> 672 kB at DPR3: the three photographs the build leaves out of its
`srcset`), and the bag drawer / cart / checkout thumbnails reusing the copy the card already holds instead of fetching the original
(about 470 kB for four lines at DPR 1-2; at DPR3 the product page's own gallery has already pulled the original, so nothing is saved there).
Real originals may be smaller or larger than the stand-in, and the live copies for the three excluded photographs may not exist yet.

*Uploaded phone photographs* (stand-in: 3024x4032 JPEG, 1.8 MB, 24 products listed):

| window | before | after |
|---|---|---|
| shop grid, 24 cards | 42,878 kB (42.9 MB) at every width | 193 kB (DPR1-2), 574 kB (DPR3) |
| the session above | 42,878 kB | 7,334 kB (320, 1280), 7,723 - 7,747 kB (360, 390, 768) |

The 7.1 MB left is four product pages: the gallery's main photograph keeps the original on purpose (zoom, full-screen view,
lossless). A 1280px copy for it is an owner decision. The first-ever visit straight to `/checkout` with a bag: 7,141 -> 7,142 - 7,174 kB (no gain, 0.4% cost, once).

### Independent review and re-measure (2026-11-04)

Re-measured by a second pair of hands with its own scripts: the **real `.htaccess` of 776bea35 (before the lane) and of HEAD, each on a private
Apache 2.4.58**, the captured live `index.html` and compiled assets, the repo's add-ons and fonts, and stand-in photographs (the live ones
cannot be reached: the Hostinger connector is signed out), behind a TLS stand-in for Traefik; Chromium counted what arrived on the wire.
Header text is counted too (about 1.2 kB per response, mostly the security headers on every file): over HTTP/2, which Traefik speaks to
browsers, the repeated headers compress to a few bytes, so the 304 rows are the pessimistic ones. B = before the lane, A0 = after, maker
not run yet, A1 = after, maker run. kB, cold cache, a page scrolled to the end:

| first visit to `/shop`, built-in photographs (stand-ins) | B | A0 | A1 |
|---|---|---|---|
| 320 px (DPR2), Arabic / English | 1321.9 / 1156.7 | 1334.3 / 1169.1 | 944.3 / 779.1 (-28.6% / -32.6%) |
| 360 and 390 px (DPR3), Arabic / English | 1705.1 / 1539.8 | 1717.5 / 1552.2 | 1367.4 / 1202.1 (-19.8% / -21.9%) |
| 768 px (DPR2), Arabic / English | 1705.1 / 1584.3 | 1717.5 / 1596.7 | 1367.4 / 1246.6 (-19.8% / -21.3%) |
| 1280 px (DPR1), Arabic / English | 1321.9 / 1201.1 | 1334.3 / 1213.6 | 944.3 / 823.6 (-28.6% / -31.4%) |

| uploaded phone photographs (46 products, 3024x4032, 1.8 MB each) | B | A1 |
|---|---|---|
| `/shop`, 320 / 390 / 1280 px, Arabic | 105,636 / 105,742 / 105,636 kB | 1,316 / 2,024 / 1,178 kB (-98.1% to -98.9%) |
| `/shop`, English | 105,471 / 105,577 / 105,515 kB | 1,013 / 1,859 / 1,057 kB |
| a product page (gallery keeps the original), 390 / 1280 px | 14,539 / 14,526 kB | 5,441 / 5,351 kB (-62.6% / -63.2%) |
| a cold first visit straight to `/cart` with four uploaded lines in the bag | 9,761.8 kB | 9,807.0 kB (+45.2 kB, +0.46%: the list is not known yet, so the originals go out and the copies on top) |

| a RETURNING visit to `/shop` (second load, same browser) | B | A0 and A1 |
|---|---|---|
| everything on the wire | 210.3 kB | **68.7 kB** (-141.6 kB, -67%) |
| the 23 add-ons | 23 x 200, 162.1 kB | 23 x 304, 26.8 kB (all of it headers) |
| `index.html` | 200, 7.5 kB | 304, 1.2 kB |

What the numbers say, plainly:

- The `.htaccess` half is a clean win at every width and costs nothing: the same 23 add-ons, the HTML shell and the 404 shell (live capture:
  19,094 B plain -> 6,787 B gzip, 6,338 B Brotli) all behave as measured; it decodes once to the identical bytes.
- The photo-copy half is worth 20-33% of a built-in-photo shop visit and 98-99% of an uploaded-photo one, **but only after the maker has run**.
  Before that (A0) the block is not free: **+12.4 kB on every first visit** (5.0 kB for the code itself, 7.5 kB for the one 404 shell that the
  list's URL answers) and **+7.5 kB once per 6 hours for a returning visitor** (the miss is remembered that long). The cheapest way to avoid it
  is to run the maker the day this file is deployed.
- Layout does not move: the same pages at 320, 360, 390, 768 and 1280 px in both languages (`/shop`, `/cart`, a product page; built-in and
  uploaded photographs) were compared box by box between B and A1: 60 page/width/language cells, 1,310 `<img>` boxes (922 of them with a
  `srcset` of the responsive copies), **0 differences in any image box or in the page height, no horizontal overflow at any width**. The
  page-wide layout-shift totals of a scrolling load are dominated by the app itself (0.04-0.83 for B alone on a loaded machine) and could
  not be compared; the box comparison is the measure.

**What the review changed** (all in this lane's files; `test:sizes-weight` asserts each):

1. *The list's 404 was paid on every page load* (the first version asked for `variants.txt` every time and, until the maker has run, got the
   whole error shell): the miss is now remembered for 6 hours; a 5xx or 429 for the list is neither a miss nor a reason to forget a good list.
2. *The `setAttribute` hook removed a `srcset` that was not its own.* When an `<img>` the add-on had touched was re-pointed to another
   photograph after the app had put its own `srcset` on it (the order React uses when `srcSet` is listed ahead of `src`), the hook dropped the
   app's `srcset` and put the add-on's over it. It now removes only a `srcset` it wrote, and the error listener leaves a failure of the app's
   own `srcset` to the app's `onError`.
3. *The maker could quietly replace the storefront build's own copies.* A copy older than its original is remade; on the live folder the
   26 build copies of `-320/-640/-800` may well be older than the originals, and the tool would have replaced them at its default quality.
   The plan now prints a NOTE (before anything is written) when a remake of an existing copy is on the list, and `--keep-existing` leaves every
   existing copy exactly as it is.

**Not changed, on purpose:** the 7.5 kB miss could be 0.5 kB with a `HEAD` request first (or a one-line `ErrorDocument` inside a
`<Files "variants.txt">`), but it only exists in the window between shipping the code and running the maker, and that window is closed by running the maker; a CMYK
JPEG with an embedded colour profile was not tested (no ICC profile available here): phone and studio photographs are RGB.

### Not changed, and why

- `public/sporta-images.css`: CSS cannot make a file smaller; the gallery cap and the brand strip rules are unchanged.
- `Link: rel=preload` for fonts: the HTML is rendered by `api/seo-page.php`, which `.htaccess` headers do not reach, and which fonts load
  depends on the language `boot.js` picks after the fact (a wrong preload is wasted bytes). `boot.js` is outside this lane.
- Compression and cache tiers: already complete and asserted (Brotli/gzip on every text type, 30 days on images, `immutable` on hashed
  assets, 304s on images); the two defects above were the only ones.
- The hero slide (94 kB for every device) and the products list: API-side (`slide_image` has no width option).

### Owner steps and decisions

1. **Run the maker on the server once, then after every batch of uploads.** Dry run first (it writes nothing):
   `node scripts/make-image-variants.mjs --dir /docker/sporta/private/media/products`, then add `--write`. Needs Node 22+ and
   ImageMagick with WebP (`convert -list format | grep WEBP`); the header of the script has a one-shot `docker run` line.
   Copies are made at the encoder's own quality (about 75): this ImageMagick build ignores `-quality` for WebP, and the script says so
   instead of pretending (`--quality N` is refused on such a build).
   To SEE the effect at once on your own phone or computer, use a private window (or clear this site's data): a browser that asked for the list within the
   last 6 hours and was told there is none (the state before the first run) waits out those 6 hours before it asks again; a first-time visitor asks at once.
2. Split the admin add-ons off the shopper path (lane D): `sporta-admin-brands.js` and `sporta-admin-knet.css` become a ~1 kB loader that
   injects the real files only on `/backends` (a file the loader requests need not be linked by `index.html`): saves up to 60.8 kB Brotli
   on every shopper page.
3. Minify the add-ons at deploy time (133.6 -> 59.8 kB Brotli estimated), or accept the readable sources as they are.
4. Fonts: drop one of Plex 600/700 (about 63 kB of the 247 kB in Arabic) or ship Plex as a variable font; a design decision.
5. Replace `logo.png` (39.6 kB, drawn 28-36px high on the product page and the invoice): a 400px-wide copy is 20.9 kB as PNG; and `og-image.png`
   (65.9 kB; only crawlers and link previews fetch it): JPEG q82 is 32.8 kB. Both keep their names, so nothing else changes.
6. A 1280px copy for the gallery's main photograph (`--widths 320,640,1280` and a rule for `catalog-gallery-photo`).

## Lighter admin CSS (2026-11-04, "make backends lighter css")

**What.** `public/sporta-admin-knet.css` styles only `/backends`, but the live `index.html` links it as a render-blocking
`<link rel="stylesheet">`, so every shopper page load downloads it. It was 76,431 bytes, 52% of them comments (the thorough ones
CLAUDE.md asks for, which carry measured live facts). `scripts/build-addon-css.mjs` now builds the shipped file from a readable
source: comments and white space go, one header line stays, nothing else changes.

| | raw | gzip | Brotli (what the shopper downloads) |
|---|---:|---:|---:|
| commented source | 76,431 | 20,898 | 17,827 |
| generated file (minify only, what ships) | 32,506 | 4,622 | 4,175 |
| saved | -57.5% | -77.9% | **-13.65 kB (-76.6%)** on every shopper page |
| `--prune-dead` on top (not shipped) | 32,435 | 4,613 | 4,166 |

**Measured (2026-11-04, mirror of the live storefront served Brotli-compressed, phone 390px DPR3, Slow 4G 1.6 Mbit/s / 150 ms, CPU 4x, a fresh
context per run, runs interleaved and order-swapped, 20 per variant, on a 4-CPU machine at load average ~80: read the spread, not the
medians).**
- On the wire the stylesheet goes from 18,024 B to 4,371 B (Brotli, with headers). First Contentful Paint median **1,868 ms -> 1,720 ms**
  (inter-quartile 1,556-2,216 -> 1,472-2,080 ms; one 11-13 s outlier in each arm). The distributions overlap: at 1.6 Mbit/s the 13.65 kB
  is about 70 ms of transfer, which is all this change can be worth on that link and is inside the noise. Do not quote 150 ms.
- Parse and style cost (4x CPU, 15 interleaved reps): the sheet parses in 6.3 -> 5.1 ms (Orders screen, 487 elements) and 8.0 -> 5.1 ms
  (Catalogue form, 1,285 elements); parse + style + layout of the whole page is 65.6 -> 63.6 ms and 215 -> 242 ms (noise: selectors, not
  comments, set that cost). The gain is bytes on the wire, not CPU.

**Where the files are, how to edit** (the switch is `--apply`; see "Status"):

| | |
|---|---|
| `addons-src/sporta-admin-knet.css` | the readable source: edit this; thorough comments stay |
| `public/sporta-admin-knet.css` | GENERATED (first line says so), committed, what `vps-deploy.mjs` copies from the pushed sha |
| `npm run build:addon-css` | rewrite the generated file from the source |
| `node scripts/build-addon-css.mjs --check [--require]` | the drift guard: exit 1 if `public/` is not exactly what the source builds (`--require` also fails when the switch has not happened) |
| `node scripts/build-addon-css.mjs --stats [--all]` | raw / gzip / Brotli before and after (`--all`: every add-on stylesheet, nothing written) |
| `npm run test:addon-css-slim` | the proof (below) |

`addons-src/` is outside Vite's `publicDir`, so `dist/`, `make-package.mjs` and the deploy never carry it; the proof checks this on a
real `make-package.mjs` run of a switched scratch copy (`SLIM_BUILD=1`).

**Why the minifier is configured as it is (measured, 1.33.0).** Plain `lightningcss` with no browser targets is the smallest output and
is NOT safe for this file; Chromium 1243, where every test runs, cannot see why. With the shop's own targets (Vite's cssTarget for
`es2022`: Chrome/Edge 94, Firefox 93, Safari/iOS 16.4) it is safe except for one injection.

| setting | bytes (raw / br) | effect |
|---|---:|---|
| no targets | 32,198 / 4,105 | rewrites all 17 `@media (min-width: 768px)` to `(width >= 768px)` (Chrome 94-103 cannot parse it: the block silently stops applying) and merges a `:has()` rule into a list with a plain selector (Chrome < 105 and Firefox < 121 drop the whole list: `.m-row__title` would lose its style there) |
| shop targets | 32,474 / 4,129 | media queries kept, `:has()` rules kept apart; but injects `--lightningcss-light` / `--lightningcss-dark` (two new computed custom properties) next to every `color-scheme: light` (4 places) |
| shop targets, `Features.LightDark` off | 32,372 / 4,112 | as above without the injection; **but** a static `color-mix(in srgb, #e0561c 16%, transparent)` inside a custom property (`--admin-focus`) is folded to `#e0561c29`: alpha 0.16 becomes 0.1608 |
| + custom-property values kept verbatim (**shipped**) | 32,407 / 4,114 (+99 B header) | every custom property keeps its source text; computed style identical |

A plain property that holds a static `color-mix()` would still be folded; the builder warns when that happens.

**What the proof asserts (`npm run test:addon-css-slim`, rig-free).**
- STATIC: header, no other comment, no source map, fixed point; the same property names, the same 19 custom properties with the same
  values, the same 6 `@media` conditions, no `:has()`-plus-plain list; drift guard.
- RULES (Chromium's own CSSOM): every (media context, selector, property, value, importance) of the source is in the output, none
  added, the order of each property's declarations identical, 556 effective `!important` declarations on both sides. The minifier
  drops 3 textual `!important` declarations (204 -> 201): older `padding` rules of the boxes section that the SIZES section overrides
  with the identical selector and importance (dead code).
- COMPUTED STYLE: both sheets sit in the add-on's slot of the same page and are switched in place. For every element, every property a
  stylesheet can change, plus the box, plus `::before` / `::after` / `::placeholder` / `::selection` / `::marker`; forced `:hover`,
  `:focus` + `:focus-visible` + `:focus-within`, `:active` and all together (Chrome DevTools `CSS.forcePseudoState`), `:disabled`,
  `:checked`. Pages: the 17 sizes-admin screens x 4 views x light/dark (+ Arabic), the Payments fixture under five theme states
  (including the light-only case on a dark device), the markup of `test:admin-polish`, its boxes, and `test:admin-light`. All ~680
  computed properties on a sample. Full run (26 min on a loaded machine): 220 page renders, 100,757 element snapshots, 42,493,766 computed
  values compared (2,569,362 of them with every property), 462 forced-state passes: **0 differences**.
- MUTATION: a dropped declaration, a dropped `!important`, a deleted rule (with and without a fixture element that matches it), a
  swap of two adjacent rules whose order decides a winner, a swap that no fixture element sees (rules layer only), a dropped
  declaration of a `:hover` rule (invisible at rest, caught by the forced-state layer): each turns the test red.
- TOOL: `--apply` / `--check` / the refusals, in a scratch git repo. BOUNDARY: `addons-src/` is in no package.

**`--prune-dead` (off, never writes into `public/`).** Removes a rule only if every selector in it needs a class / id / attribute that
appears in none of: the 49 captured compiled admin chunks, the add-on scripts, `src/`, `dropin/php-store`. A name built from pieces
(`` `bg-${c}-500` ``, `"btn-" + kind`) keeps every rule that starts or ends like the constant piece. Result on the shipped source:
**0 rules removable**; 2 dead selectors inside live rules (`[class*="border-sky-"]`, `[class*="border-violet-"]`), which would save 71
bytes raw / 9 bytes Brotli. The file was written against the live DOM; pruning is not worth switching on. Evidence:
`--pruned-json <file>`.

**What the same tool could save on the other add-ons** (`--stats --all`, estimate; NOT applied, NOT proven: each file needs its own
run of the proof first):

CSS (`--stats --all`; as of this run, the other lanes keep editing these files):

| file | raw | gzip | Brotli |
|---|---:|---:|---:|
| backends-offline | 1,281 -> 1,139 | 616 -> 559 | 494 -> 445 |
| sporta-admin-knet | 76,431 -> 32,506 | 20,898 -> 4,622 | 17,827 -> 4,175 |
| sporta-bag-touch | 17,255 -> 5,065 | 6,312 -> 1,725 | 5,308 -> 1,443 |
| sporta-brand-theme | 4,845 -> 1,142 | 2,153 -> 533 | 1,799 -> 428 |
| sporta-cart-drawer | 13,675 -> 5,380 | 4,708 -> 1,480 | 4,000 -> 1,248 |
| sporta-cat-tiles | 8,191 -> 2,392 | 3,293 -> 853 | 2,738 -> 717 |
| sporta-checkout-a11y | 24,625 -> 8,611 | 8,460 -> 2,358 | 7,281 -> 2,033 |
| sporta-clock | 2,461 -> 905 | 1,077 -> 408 | 918 -> 372 |
| sporta-grid | 5,619 -> 875 | 2,386 -> 395 | 1,903 -> 301 |
| sporta-home-trim | 7,804 -> 2,294 | 3,236 -> 797 | 2,618 -> 670 |
| sporta-images | 3,616 -> 1,151 | 1,725 -> 533 | 1,424 -> 441 |
| sporta-product-fix | 11,671 -> 3,071 | 4,660 -> 852 | 3,897 -> 700 |
| sporta-returns-touch | 4,957 -> 1,291 | 2,036 -> 470 | 1,693 -> 370 |
| sporta-shadows | 8,533 -> 2,537 | 3,374 -> 856 | 2,832 -> 730 |
| sporta-ui-colours | 16,615 -> 5,441 | 6,090 -> 1,458 | 5,117 -> 1,258 |
| **total (14 live add-on stylesheets + backends-offline.css)** | 207,579 -> 73,800 | 71,024 -> 17,899 | 59,849 -> 15,331 |

JavaScript (`minifySync` of rolldown 1.1.5, already installed; a classic-script estimate, not built, not tested, names not mangled at top level):

| file | raw | gzip | Brotli |
|---|---:|---:|---:|
| boot.js | 14,394 -> 6,022 | 5,704 -> 2,699 | 4,708 -> 2,264 |
| config.js | 1,253 -> 64 | 626 -> 70 | 470 -> 62 |
| birthday.js | 12,172 -> 7,723 | 4,487 -> 3,208 | 3,762 -> 2,678 |
| sporta-features.js | 56,725 -> 25,428 | 19,594 -> 9,670 | 16,768 -> 8,332 |
| sporta-admin-brands.js | 162,729 -> 94,240 | 48,694 -> 30,871 | 40,878 -> 26,467 |
| sporta-footer-call.js | 11,841 -> 4,605 | 4,427 -> 1,934 | 3,711 -> 1,602 |
| sporta-gov-autopick.js | 26,942 -> 13,789 | 10,428 -> 6,115 | 8,758 -> 5,178 |
| sporta-clock.js | 2,138 -> 1,087 | 960 -> 570 | 792 -> 476 |
| sporta-checkout-a11y.js | 12,488 -> 5,354 | 4,670 -> 2,116 | 3,930 -> 1,827 |
| **total (9 add-on scripts)** | 300,682 -> 158,312 | 99,590 -> 57,253 | 83,777 -> 48,886 |

Applying the tool to the 13 other stylesheets would take the shopper's critical CSS from 59.8 kB to 15.3 kB Brotli (all 15 files). It
was NOT applied: their markup is the storefront's, their proof is not written, and `index.html` of the live site links them as they are.
The 9 scripts are an estimate only (no build, no test): `sporta-admin-brands.js` (40.9 kB Brotli, admin-only) is the large one.
Splitting both admin add-ons off the shopper path (owner step 2 above) remains the bigger win: the slim stylesheet still costs a shopper 4.2 kB.

**Status (2026-11-04): the tool, the proof and these notes are built; the switch has NOT been made.** Lane D (sizes) and the
CSS-update lane were editing the file, so `public/sporta-admin-knet.css` is still the commented file, nothing about the live site
changes, and `npm run build:addon-css` refuses to overwrite it (`--out <scratch file>` builds the same bytes `--apply` will write).

The switch, in order (rehearsed on a scratch git copy):
1. `git status --porcelain -- sporta-web/public/sporta-admin-knet.css` is empty (the tool refuses otherwise).
2. `cd sporta-web && node scripts/build-addon-css.mjs --apply`: `git mv` the commented file to `addons-src/`, generate `public/`, stage both.
3. Repoint the three suites that read COMMENTS out of the file (measured on the switched copy: `test:admin-light` 7 of 49 checks fail,
   `test:admin-polish` 11 of 681, `test:sizes-admin` 23 of 68 (45 pass), all because a section marker such as `Light only (owner decision`,
   `/backends boxes and tables` or `/* ==== SIZES:` is a comment). One path each: `scripts/admin-payments-light-test.mjs` (the `CSS`
   constant) and `scripts/admin-polish-test.mjs` (the `ADDON` constant) read `addons-src/sporta-admin-knet.css`;
   `scripts/lib/sizes-admin-page.mjs` `addonFiles()` reads it for `sporta-admin-knet.css` when it exists. Repointed: 49/49, 681/681, 76/76.
   Unchanged and green on the generated file: `test:admin-payments` 136, `test:addons-brands` 118, `test:photo-uploader` 261,
   `test:admin-save` 670.
4. `npm run test:addon-css-slim` (switched state: the subject is the shipped file and the drift guard is part of it).
5. Commit `addons-src/sporta-admin-knet.css`, `public/sporta-admin-knet.css` and the three repointed test files together.
6. Before any deploy of the file: `node scripts/build-addon-css.mjs --check --require` (a stale generated file would ship the old CSS);
   after it, the live file must start with the `/* generated from ...` line and be about 4.2 kB Brotli.

Two things the switch changes that no test of this lane covers: `scripts/file-audit.mjs` counts a file name mentioned in a comment as a
reference, so three LOW "never referenced" lines move (`boot.js` and `sporta-admin-brands.js` lose a mention, the stylesheet gains one
in its header; no HIGH or MEDIUM finding changes), and a person who greps `public/sporta-admin-knet.css` for an explanation now has to
look in `addons-src/`. `make-package.mjs` refuses to write the zip on the current tree for reasons outside this change
(`api/assistant.php` names `/pages/Privacy.jsx` and `/lib/cart.jsx`, `sporta-admin-brands.js` names `/i18n/translations.js`: the audit's
HIGH findings, identical with the commented or the generated stylesheet).

### Independent review of the lighter admin CSS (2026-11-04)

A second pair of hands rebuilt the file, re-measured it and re-proved it by methods the builder did not use. Nothing was switched,
deployed or pushed.

- **Re-measured** (own scratch copy of the current `public/sporta-admin-knet.css`, 76,431 B): 32,506 B raw, 4,622 gzip (`gzip -9` on the
  command line: 4,641), 4,175 Brotli q11 (from Python's `brotli`). Same as the builder, to the byte. The browser floor is Vite's own
  (`build.target: 'es2022'` -> Chrome/Edge 94, Firefox 93, Safari/iOS 16.4, Opera 80, read out of `vite/dist/.../node.js`), so the add-on
  is held to the floor the storefront bundle already has.
- **Proof 1, structure** (postcss for the structure, Chromium only to normalise one declaration at a time on a probe element, so a
  fixture that matches nothing cannot hide a change): every declaration of both files expanded to longhands; per
  (media, single selector, longhand, importance) the winning value is equal for all 764 pairs; the ordered sequence of declarations of all
  110 longhands is equal (this is the cascade: specificity ties are decided by it); 556 effective `!important` on both sides; the
  680-property computed signature of each of 382 winning declarations is equal. The 16 overridden longhand atoms of the source are the four
  `padding` rules of the boxes section (three dropped, the `@media` one kept). A canonical `lightningcss` print of both files differs in one
  line, the order of the members of one selector list.
- **Proof 2, rendering** (two pages driven in lock-step with real mouse and keyboard events, source against output; every element hashed
  over every computed property, plus its box, `::before`/`::after`/`::placeholder`/`::marker`/`::selection`, and a full-page PNG compared
  byte for byte; the PNG is a weak witness, because Chromium rasterises the tallest page (Catalogue form at 320 px) into two different
  PNGs from the SAME stylesheet on separate loads, so the per-element hashes are the evidence): 96 page pairs, about 54,000 elements, 970 real hover / mouse-down / Tab-focus / disabled / checked steps, **0
  differences**. Pages: the 17 admin screens at 320 / 1024 / 390 (light, dark, Arabic), the five busiest screens interactive at 1024 and
  390 in light and dark, the Payments screen with 200-character secrets in every field at 320 / 390 / 768 / 1024 / 1280 (light, dark, dark
  theme on a light device), the signed-out sign-in screen, and 768 touch / 768 mouse / a touch laptop / Arabic at 1280 / reduced motion.
- **Seven corruptions of the output** (a focus outline dropped, a hover declaration dropped, a hex digit changed, a `max()` floor changed,
  an `!important` dropped, two rules swapped, a rule dropped from an `@media`): proof 1 turns red for all seven, proof 2 for four (the other
  three are not decided on any fixture element), which is why there are two layers.
- **Found and fixed in the tool.** (1) The proof passes today's file, but the tool is re-run on whatever the file looks like later, and
  with the shop targets the minifier does things to CSS the file does not contain yet that are not "comments and white space":
  `.a:has(x), .b {..}` merged with a neighbour becomes `:is(.a:has(x), .b)` (the plain member takes the `:has()` member's specificity),
  `-webkit-user-select` is added, `-webkit-appearance` and `position:-webkit-sticky` are dropped, a `100vh`/`100dvh` pair can collapse, an
  escape in `content:"\201C"` becomes a raw character (the file stops being ASCII), `.1234567891rem` becomes `.123457rem`, range media
  queries are rewritten. The build now refuses each of them (`losslessProblems()`, run by `slim()`), says what moved, and the author writes
  the form the minifier would produce in the source; 11 tests. `--stats --all` shows that the guard would refuse 6 of the 13 other add-on
  stylesheets as written (longhands merged into `gap` / `grid-area`, escapes, a `:is()` rewrite, a vendor twin). (2) `--apply` moved the
  file with `git mv` and only then built, so a refusal left `public/` without its stylesheet and `addons-src/` staged: it now builds first
  and changes nothing on a refusal (tested). (3) `--prune-dead` removed `[data-foo-bar]` although the corpus has `el.dataset.fooBar`, and
  `[data-mode-flag]` although the corpus builds `data-${mode}-flag`: both stay now (tested); on the real file it still removes 0 rules.
- **Still true, and not covered.** Chromium 1243 is the only engine here (no Firefox or WebKit build), so the older-browser claims rest
  on the floor and on the guard, not on a run. `rgba(15,23,42,.06)` becomes `#0f172a0f` (alpha 15/255): Chromium computes the same
  string for both; another engine could differ by less than one alpha step. Custom-property values have their white space collapsed
  (the current 19 have none to collapse). `scripts/vps-deploy.mjs` does not run `build-addon-css.mjs --check --require`; until it does, a
  stale generated file is caught only by the test or by hand. After the switch the suites that only load this file as a stylesheet are
  unaffected (the builder ran four of them on a switched copy, green); the three that read its comments are named in step 3 above.
