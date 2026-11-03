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
**all 23 files on every page load**: 51.5 kB gzip for the copies live on 2026-11-02, **144.9 kB gzip for the copies in this repo**.
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
left out of the copy. **Without the list the add-on does nothing**, so shipping the code before anybody runs the maker changes nothing.
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
2. Split the admin add-ons off the shopper path (lane D): `sporta-admin-brands.js` and `sporta-admin-knet.css` become a ~1 kB loader that
   injects the real files only on `/backends` (a file the loader requests need not be linked by `index.html`): saves up to 60.8 kB Brotli
   on every shopper page.
3. Minify the add-ons at deploy time (133.6 -> 59.8 kB Brotli estimated), or accept the readable sources as they are.
4. Fonts: drop one of Plex 600/700 (about 63 kB of the 247 kB in Arabic) or ship Plex as a variable font; a design decision.
5. Replace `logo.png` (39.6 kB, drawn 28-36px high on the product page and the invoice): a 400px-wide copy is 20.9 kB as PNG; and `og-image.png`
   (65.9 kB; only crawlers and link previews fetch it): JPEG q82 is 32.8 kB. Both keep their names, so nothing else changes.
6. A 1280px copy for the gallery's main photograph (`--widths 320,640,1280` and a rule for `catalog-gallery-photo`).
