# Asset audit, live site and repo (2026-11-12)

Owner: "check assets", then "fix the asset findings". Read-only on the live site: five one-shot jobs on VM 2058651
(node:24-alpine and the Playwright image, `/docker/sporta` mounted read-only, GET requests only, every scratch project
deleted). Nothing was deployed. Repo fixes are on branch `audit/assets-1112` (rebased onto `claude/sporta-integration-tveo8b`).

Tools: the new `scripts/live-assets-probe.mjs` (`MODE=disk|http|extra|browser`: tree, reachability, raw/gzip/Brotli sizes,
duplicates, strays, fonts, image headers, media mounts, response headers per tier, and per-page fonts, images and coverage
in Chromium), plus the existing `scripts/old-files-inventory.mjs` (orphan chunks, cross-check) and a local Apache 2.4.58
repro of the compression chain.

## Findings, ranked

| # | Sev | Where | Measured | Fix | Kind |
|---|---|---|---|---|---|
| 1 | **High** | every text response (`.htaccess` compression block) | Brotli is **never** served for a 200. A browser that offers `br, gzip` gets gzip for every JS, CSS, HTML, JSON, SVG, XML and manifest. Only the 404 shell is Brotli. Cause, proved: the VPS image runs `a2enmod brotli` (Dockerfile, read) **and** Debian's default `deflate.conf`, which adds DEFLATE by type at server level, so it runs before the `.htaccess` Brotli line and Brotli then sees a body that is already encoded. Reproduced on a local Apache with the same `deflate.conf`: `br, gzip` gives gzip with the old block and br with the new one. | **Fixed in repo:** `public/.htaccess` now uses one chain, `FilterChain !` then `AddOutputFilterByType BROTLI_COMPRESS;DEFLATE`. A br client gets br, a gzip-only client gets gzip and identity stays plain. Shared hosting without mod_brotli keeps the plain DEFLATE line. `htaccess-rules-test` now loads Debian's `deflate.conf` like the VPS and requires br; 11 checks failed before the fix. | safe asset work; ships with `.htaccess` |
| 2 | High | `/assets/` | **25 orphan chunks, 663,409 B**, all from the 2026-10-31 builds. Nothing reaches them (the old-files walk and this probe agree). They are public at their URLs for a year (`immutable`), and 2 of them (`index-BpLmiM9Q.js`, `AdminApp-CDOspmkB.js`) carry the **`cost_table` marker**: a retired cost table is still downloadable. 25 chunk names exist in 2 hashes. | cleanup job below: move them, never delete | server, **needs owner yes** |
| 3 | Med | `sporta-admin-knet.css` on every shopper page | 63.9 kB raw / 8.9 kB gzip, render-blocking, **0% of its rules used** on the Arabic phone home page (CSS coverage) | the same loader split as the admin JS (inject it only on `/backends`). The admin would get a flash of unstyled screen unless the loader is synchronous, so this was not done. | add-on work, owner decision |
| 4 | Med | add-on minification | Shopper add-ons cost about 151 kB gzip on the wire today. Minified (lightningcss / rolldown `minifySync`, measured on the repo copies, nothing changed) they would be about 48 kB Brotli. Totals for all 22 add-ons: 287.8 kB to 168.8 kB br (q11), 380.0 kB to 220.8 kB gzip. | **Not done:** already an owner decision in PERFORMANCE.md. `vps-deploy.mjs` verifies by md5, `live-files-scan` recognises a live file by its committed bytes, and the lossless guard in `build-addon-css.mjs` refuses 6 of 13 add-on stylesheets as written. | owner decision |
| 5 | Med | `/api/api.php?r=slide_image` | the hero slide is **2400 x 952, 92 kB**, sent to a 390 px phone (it needs about 780 px) | a `w=` option on the route plus `srcset` in the build. The build is foreign, so only the API side can be done here. | backend + data |
| 6 | Med | product photos on the home page | `cagliari-calcio-sweatshirt-navy.jpg` **original, 800 px, 126 kB**, drawn in a 157 px (phone) / 265 px (desktop) box. Shop cards use `-320.webp`. Either `sporta-features.js` `kind()` does not know that card's class, or this is its documented cold-first-render limit. | probe the home card's class, then extend `kind()` | safe add-on work (next) |
| 7 | Med | `backends.webmanifest` | `start_url` is `/backends/`, which `.htaccess` answers with **404 on purpose**, so an installed admin app opens a 404 | **Fixed in repo:** `start_url: "/backends"` (`id` unchanged, so installs keep their identity) | needs `--only backends.webmanifest` |
| 8 | Med | app icons | `site.webmanifest` and `backends.webmanifest` declare `favicon.png` as **maskable**, but its ink reaches 58.8% from the centre (the limit is 40%), so Android cuts the S. `apple-touch-icon.png` is 87% transparent, so iOS paints it black. | **Fixed in repo:** copied `apple-touch-icon.png` (opaque charcoal), `favicon-maskable-192.png` and `favicon-maskable-512.png` from `brand/icons-polish/`, and both manifests point their maskable entries at them. The "any" icons and the placeholder SVG change the visible mark, so they stay the owner's call (README updated). | `site.webmanifest` belongs to the foreign build (CLAUDE.md item 5): shipping it needs an owner yes |
| 9 | Low | `logo-white.webp` (preloaded, `fetchpriority=high`, every page) | 600 x 184, **14.4 kB**, drawn 91–165 CSS px wide (52 sightings) | **Fixed in repo:** 450 x 138 (same 75:23 ratio as the `width/height` the build declares), **9.6 kB** (-33%), from `brand/logo/logo-white-1600.png` | asset; same name |
| 10 | Low | `logo.png` (product-page plate, JSON-LD) | 800 x 246, **39.6 kB**, drawn 91–96 px wide | **Fixed in repo:** 400 x 123 (exact ratio), **29.2 kB** (-26%), from `brand/logo/logo-1600.png`. Still at least 396 px, the `icons-polish` floor; the share-card drawer uses at most 326 px. | asset; same name |
| 11 | Low | Adobe Fonts kits in the live `index.html` | 2 Typekit stylesheets plus 2 preconnects on every page. **No Typekit face was used** in 28 page loads (every face that loaded is a local `/fonts/` face). | remove the 4 tags from the live `index.html` by hand (it is foreign and has no source here) | owner decision |
| 12 | Low | fonts (`/fonts`, 8 woff2, 216.8 kB) | All 8 are referenced (foreign `index-CdcKvZhs.css`, `unicode-range` split), with `font-display: swap`. An Arabic page fetches all 8 (218 kB on a phone, first visit). English fetches the 4 Latin files (78 kB), but **English at 1280 px also fetches `plex-700-arabic.woff2` (39 kB)**, probably for an Arabic label in the header. Plex 600 and 700 are both used. The browser synthesises weights 500/750/800/850/900 from the nearest file. No font preloads in the live index (none needed). Unused faces: none. | the font set and its CSS belong to the foreign build; PERFORMANCE.md step 4 (drop one Plex weight or go variable) stays a design decision | foreign / owner |
| 13 | Low | `/docker/sporta/private/media` | **193 AppleDouble `._*` files** (31 kB) in cats/, hero/, products/ and products/responsive/. The web gets 403 (dotfile rule), but they double every naive count of the media folder. | cleanup job below | server, needs owner yes |
| 14 | Low | `/docker/sporta/site/{images/products,cats,hero}` | **188 files, 15.1 MB** on the host that nobody can see: the media mounts in the `sporta` service cover these three folders. They are stale copies, and they look like served files to anyone who reads the web root. | cleanup job below. Move the **contents** only: the three folders are mount points of the running container. | server, needs owner yes |
| 15 | Low | brand logos in rows (`api.php?r=brand_logo`) | `vanquish`: **1400 x 342** for a 110–151 px box, `loading=lazy` while above the fold (2 sightings) | re-upload at 600 px or less | owner data |
| 16 | Low | product originals | 36 originals (lossless by owner rule). 9 are over 300 kB (PNG 1000 x 1200 up to 703 kB). Variants: 320 px x36, 640 px x35, 800 px x33, `variants.txt` is 200 with 37 lines. The only "missing" copy, `tekno-shorts-black` 640, is correct: its source is 600 px. **The `variants.txt` 404 in CLAUDE.md is resolved** (no 4xx on any of 28 page loads), so `sporta-features.js` needs no guard. | none (PERFORMANCE.md step 6, a 1280 px gallery copy, stays open) | — |
| 17 | Low | `favicon.ico` | holds PNG bytes (32 x 32), not an ICO container. Every current browser accepts it. | none needed | — |
| 18 | Info | `og-image.png` | 1200 x 630, 65.9 kB, matches its og tags. JPEG would be 32.8 kB, but the name is fixed by the foreign `index.html`. | leave | — |
| 19 | Info | `api/*.mysql.sql` (31 files in the web root) | part of the backend bundle; the `.htaccess` `FilesMatch` denies `.sql` | leave | — |

## Clean (measured, nothing to do)

- **Cache tiers.** Hashed `/assets/*`: `public, max-age=31536000, immutable`. Add-ons, `boot.js`, `config.js`, `sw.js`: `no-cache, must-revalidate` with ETag and Last-Modified. Fonts and fixed-name images: 30 days plus `stale-while-revalidate` (not immutable, correct for fixed names). `/cats`, `/hero` and product photos: 1 day plus SWR 30 days. xml/txt/manifest: 1 hour. HTML: `no-cache, swr=60`. `/api`: `no-store`. `slide_image`: immutable year (content-hashed). `Vary: Accept-Encoding` is on every compressed type and on no image or font.
- **Compression scope.** Text types only. Images and fonts are never recompressed. The 404 shell is compressed.
- **Strays.** No `.map` file or `sourceMappingURL`. No backups, setup tools, old HTML pages or symlinks in the web root. No PHP outside `api/knet/pay`. No `._*` in the web root. No case-mismatched reference. No duplicate bytes under two names. `/.htaccess`, `/.DS_Store` and `/cats/desktop/` give 403. `/index.html` 301s to `/`.
- **Manifests.** Every icon exists at its declared size. `og:image` matches its declared 1200 x 630.
- **Product image variants.** Shop cards get `-320.webp` through `srcset` (the probe's "upscaled 195w" lines are a density artefact of `sizes`, not real upscaling).

## Numbers behind #1 (what Brotli buys)

On disk (q11, offline), reachable JS 1646.5 kB raw is 516.1 kB gzip and 419.4 kB br. CSS 541.8 kB raw is 130.3 kB gzip
and 109.0 kB br. Apache compresses on the fly at its default `BrotliCompressionQuality 5`. Measured on Apache 2.4.58 with
the fixed block: `sporta-features.js` goes from 35,291 B gzip to 33,653 B br (-4.6%), and `sporta-shadows.css` from
19,588 B to 18,489 B (-5.6%). That is about **-16 kB on the first Arabic phone home page** (319 kB of JS+CSS on the wire
today). The rest of the q11 gap (-15 to -19%) needs `BrotliCompressionQuality` in the server config (not allowed in
`.htaccess`) or precompressed `.br` files. That is an infra step for the owner.

## Repo changes (this branch)

| File | Change | Proof |
|---|---|---|
| `public/.htaccess` | one compression chain (finding #1) | `test:htaccess-rules` 898 checks: 828 ok, 70 known, 0 FAIL. Before the fix, with the new harness: 11 FAIL ("gzip" for a br client). |
| `scripts/htaccess-rules-test.mjs` | harness loads Debian `deflate.conf` (as php:8.4-apache does); br is required when offered; the audited IfModule list gains `!mod_brotli.c`, `!mod_deflate.c`, `mod_filter.c` | same |
| `public/logo-white.webp`, `public/logo.png` | downsized from the 1600 px masters, same names, exact aspect ratios (#9, #10) | `test:icons-polish` logo-width checks ok |
| `public/apple-touch-icon.png`, `public/favicon-maskable-{192,512}.png`, both manifests | #7, #8 | `test:icons-polish` 1825 ok: maskable is its own file, apple icon opaque, sizes match. 1 FAIL that was already there: "Icons section is the last section of sporta-shadows.css" (file not touched here). |
| `ops/known-files.json` | the two new icon names in R-PUBLIC-BRAND | — |
| `brand/icons-polish/README.md` | says what was applied | — |
| `scripts/live-assets-probe.mjs` | the read-only probe | — |

Other suites: `test:file-audit` ok, `test:admin-loader` all passed, `test:images-frames` 48/48. `test:file-names` has 15
FAILs, and none of them involves a file changed here: `profiles-screen-test.mjs` imports, `sw-precache.mjs`, the
`pool-probe.php` fixture, 3 example paths in add-on comments, and an empty `.lock`. `test:images` and `test:perf` need a
built storefront on :4173 (`vite build` and `preview`) and were not run. The repo's storefront is not the live one, and
nothing in those suites' scope changed except two logo files, which got smaller.

## Deploy when approved (not done)

`.htaccess` (finding #1) is the one change with a site-wide effect: `--only .htaccess` after the release gate. The
icons, logos and manifests would go `--only logo.png,logo-white.webp,apple-touch-icon.png,favicon-maskable-192.png,favicon-maskable-512.png,backends.webmanifest`,
plus `site.webmanifest` only if the owner agrees to touch a foreign-build file. Live check afterwards:
`MODE=http` of `live-assets-probe.mjs`, which must show `br:br` on every text row.

## Server cleanup awaiting the owner's yes (nothing was moved)

Everything is **moved** to `/docker/sporta/backups/assets-cleanup-20261112/`, outside the web root. Nothing is deleted
except the AppleDouble originals, after `cp -a` has copied them. The job **aborts** if the live `index.html` or `sw.js`
changed since this audit (sha256 prefixes `76a8b944d38d` and `0e91d3528a36`), because then the orphan list would be stale.
The mount-point folders `site/images/products`, `site/cats` and `site/hero` are **not** moved: renaming a folder that is
a mount point of a running container detaches the mount there and would take the live photos down. Only their contents move.

Exact list:

- **site/assets, 25 orphan chunks (663,409 B):** `About-D7ZCeOoz.js`, `AdminApp-CDOspmkB.js`, `AssistantPanel-DjqVja05.js`,
  `bidi-aEAFfM9w.js`, `Cart-BLnHVEcS.js`, `Checkout-11I7lE3k.js`, `checkout-BoiqMkmD.js`, `CheckoutSteps-BABdRF-i.js`,
  `Contact-BxuY28eG.js`, `index-BpLmiM9Q.js`, `index-Btd5LtPi.css`, `Invoice-DTZ1zRYy.js`, `LegalPage-_CHHeL79.js`,
  `NotFound-wMSwVkVv.js`, `PaymentResult-DRNyzEox.js`, `Privacy-BK7xCL_U.js`, `ProductDetail-CzZ_Pvnj.js`,
  `react-vendor-CMgvnOJB.js`, `Returns-DrMRxpsJ.js`, `Review-s7uRBuon.js`, `rolldown-runtime-QTnfLwEv.js`,
  `Shop-CUyd8KOm.js`, `Terms-Cj7TWOu1.js`, `TrackOrder-D_QTXVog.js`, `Wishlist-C9LCVkKL.js`.
  Risk: a tab left open on the 2026-10-31 build would 404 on its next lazy chunk; that build is 12 days old.
- **Shadowed host copies (188 files, 15.1 MB):** everything inside `site/images/products/` (136), `site/cats/` (40) and
  `site/hero/` (12).
- **AppleDouble in media (193 files, 31,459 B):** every `._*` under `private/media/` (cats, hero, products,
  products/responsive). The full list is in the `MODE=extra` output and is regenerated by the job's `find`.
- Not included (owner ops files, not assets): `/docker/sporta/Dockerfile.xss-stage-20261027T132052Z` and
  `/docker/sporta/apache-service.override.yml.bak-health-20261030T194445Z`.

Proposed one-shot job (Hostinger `vps_docker_create`, project `sporta-assets-cleanup`). It has no `$`, no curl or wget,
and uses debian coreutils for `cp --parents` and `mv -t`. Delete the project after reading its log, which must end with
`CLEANUP_OK`:

```yaml
services:
  cleanup:
    image: debian:12-slim
    restart: "no"
    network_mode: none
    volumes:
      - /docker/sporta:/sporta
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        set -eu
        sha256sum /sporta/site/index.html | grep -q '^76a8b944d38d' || { echo 'CLEANUP_ABORT index.html changed since the audit'; exit 1; }
        sha256sum /sporta/site/sw.js | grep -q '^0e91d3528a36' || { echo 'CLEANUP_ABORT sw.js changed since the audit'; exit 1; }
        mkdir -p /sporta/backups/assets-cleanup-20261112/site/assets /sporta/backups/assets-cleanup-20261112/shadowed/images-products /sporta/backups/assets-cleanup-20261112/shadowed/cats /sporta/backups/assets-cleanup-20261112/shadowed/hero /sporta/backups/assets-cleanup-20261112/media-appledouble
        cd /sporta/site/assets
        mv -t /sporta/backups/assets-cleanup-20261112/site/assets About-D7ZCeOoz.js AdminApp-CDOspmkB.js AssistantPanel-DjqVja05.js bidi-aEAFfM9w.js Cart-BLnHVEcS.js Checkout-11I7lE3k.js checkout-BoiqMkmD.js CheckoutSteps-BABdRF-i.js Contact-BxuY28eG.js index-BpLmiM9Q.js index-Btd5LtPi.css Invoice-DTZ1zRYy.js LegalPage-_CHHeL79.js NotFound-wMSwVkVv.js PaymentResult-DRNyzEox.js Privacy-BK7xCL_U.js ProductDetail-CzZ_Pvnj.js react-vendor-CMgvnOJB.js Returns-DrMRxpsJ.js Review-s7uRBuon.js rolldown-runtime-QTnfLwEv.js Shop-CUyd8KOm.js Terms-Cj7TWOu1.js TrackOrder-D_QTXVog.js Wishlist-C9LCVkKL.js
        echo "CLEANUP assets moved: 25"
        find /sporta/site/images/products -mindepth 1 -maxdepth 1 -exec mv -t /sporta/backups/assets-cleanup-20261112/shadowed/images-products {} +
        find /sporta/site/cats -mindepth 1 -maxdepth 1 -exec mv -t /sporta/backups/assets-cleanup-20261112/shadowed/cats {} +
        find /sporta/site/hero -mindepth 1 -maxdepth 1 -exec mv -t /sporta/backups/assets-cleanup-20261112/shadowed/hero {} +
        echo "CLEANUP shadowed moved: images/products cats hero (folders kept: they are mount points)"
        cd /sporta/private/media
        find . -name '._*' -type f -exec cp -a --parents {} /sporta/backups/assets-cleanup-20261112/media-appledouble/ \;
        find /sporta/backups/assets-cleanup-20261112/media-appledouble -type f | wc -l
        find . -name '._*' -type f -delete
        echo "CLEANUP appledouble left in media:"
        find . -name '._*' | wc -l
        chmod 700 /sporta/backups/assets-cleanup-20261112
        echo CLEANUP_OK
```

Undo: move the files back from the backup folder (same relative paths).

Afterwards: re-run `old-files-inventory.mjs` (expect `orphans=0`) and `MODE=http` of the probe (expect `/` 200 and photos
200), and spot-check `/images/products/responsive/variants.txt` (200).

## What add-ons cannot fix (foreign `index.html` / bundle)

The Typekit tags, the font set and its `unicode-range` split, the `modulepreload` list, `loading=lazy` on first-screen
category tiles, the hero `<img>` choosing `slide_image` at 2400 px, and the og/manifest names are all compiled into the
live build, whose source is not in this repo. They can change only by hand-editing the live `index.html` (as was done for
the add-on links) or by shipping this repo's storefront, which the owner declined twice on 2026-11-02.
