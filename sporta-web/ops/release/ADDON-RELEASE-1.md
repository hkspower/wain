# Add-on release 1 — manifest and runbook

Written 2026-11-04 (lane D1 of "improve deploying progress"). Nothing has reached the
live shop since `deploy-20261103T104853Z-8bf6001`; the reviewed add-on work sits in
the branch. This file says exactly what goes out in the first release, what waits, why,
what proves each file, how big it is, and the one command per step. The runner is
`ops/release/release-addons-1.mjs` (`npm run release:addons-1`); its manifest is the
source of the lists below (`npm run release:addons-1 -- --manifest` prints it).

Nothing in this lane touched the VPS. Every "live" fact below comes from the captures
named in "Live state used" or from CLAUDE.md item 5; the read-only `vps-deploy.mjs`
plan the next session runs is the final word on what differs.

## 1. The rule this release is decided by

A file is IN when HEAD's copy works against the backend that is live (`1eb487aa`, the
commit the live `api/`, `knet/` and `pay/` PHP was byte-identical to) and the live
database, i.e. every route it calls, every PHP file it names and every answer key it
reads exists there today. CSS has no backend; the fixtures the suites use are copies of
the live markup, which is the dependency CSS has. A file is OUT when it needs a route,
file, column or wording that only the backend release brings, or when it is the
foreign storefront's own (never part of a deploy), or when HEAD equals live.

Checked by hand against `git show 1eb487aa:sporta-web/dropin/php-store/*.php` and the
live JSON answers captured on 2026-11-02 (`api/brands.json`, `api/stock.json`,
`api/products.json`); re-checked by the runner on every run (step 2).

| script | what it calls | in the live backend? | answer keys it reads | in the live answer? |
|---|---|---|---|---|
| `sporta-features.js` | `api.php?r=stock`, `?r=brands`, `?r=brand_logo&slug=` | yes, yes, yes (`$r === 'stock'` …) | stock: `slug`, `size`, `in_stock`; brands: `slug`, `name_en`, `name_ar`, `has_logo`, `logo_v`, `products` | yes; `products` is optional ("null when the server did not say: nothing is claimed") |
| `birthday.js` | `/api/birthday.php?r=get`, `?r=set` | yes (`in_array($route, ['get','set'])`) | `{ok, status, data}` of its own request wrapper | unchanged since live |
| `sporta-footer-call.js`, `sporta-gov-autopick.js`, `sporta-checkout-a11y.js` | nothing | — | DOM and `localStorage` only | — |
| `sporta-admin-brands.js` (OUT) | `admin.php?r=brand_products`, `abandoned.php?r=abandoned_orders` … | **no** (`brand_products` absent from the live `admin.php`; no `abandoned.php` at `1eb487aa`) | — | — |

No IN file reads a database column directly; the three routes they call are the ones
the live site already answers (captured answers above).

## 2. IN — deployable now

Live bytes are from the captures in "Live state used"; HEAD bytes are the files in
`sporta-web/public/` at `7bec997c`. gz = gzip level 6, br = Brotli q5 (what travels on
the wire; the live `.htaccess` serves Brotli to a browser that offers it, else gzip).
"Live = commit" is the commit whose blob is byte-identical to the captured live file,
and "reviewed commits since" are the non-snapshot commits that touched the file after it.

| file | live → HEAD (raw) | live → HEAD (br) | live = commit → reviewed commits since | proven by |
|---|---|---|---|---|
| `sporta-product-fix.css` | 578 → 29,347 | 340 → 9,326 | `cee27193` → 776bea35, a41e0b1e (+U3 via 35f5f996's review, code in snapshot fb7a191e) | sizes-product, add-to-cart-ux, product-desc, icons-polish |
| `sporta-brand-theme.css` | 1,585 → 4,845 | 786 → 2,010 | `cee27193` → CSS-update lane (snapshots a00cdfaa, c97621f5) | words-colours, icons-polish |
| `sporta-home-trim.css` | 3,475 → 7,804 | 1,449 → 2,993 | `194f739f` (deployed 11-03) → 4a406005 About numbers | home-features, about-page, icons-polish |
| `sporta-cart-drawer.css` | 2,443 → 13,788 | 936 → 4,505 | `fb4e884d` → 9ac31d4b (sizes B), U2 (a85d3982 review) | cart-ux, sizes-screen |
| `sporta-grid.css` | 615 → 5,619 | 288 → 2,182 | `cee27193` → 7fa4c07c, 711736fa, 83f82022 header/menu | shop-header, images-layout, icons-polish |
| `sporta-bag-touch.css` | 623 → 19,870 | 333 → 6,971 | `cee27193` → 83f82022, dc741450, a85d3982 (U2) | cart-ux, menu-layout, icons-polish |
| `sporta-cat-tiles.css` | 3,493 → 8,191 | 1,338 → 3,065 | `c67d35ca` → 9ac31d4b (sizes B) | sizes-screen |
| `sporta-admin-knet.css` | 48,958 → 76,431 | 12,696 → 20,037 | `718787f3` (deployed 11-03) → df898da8, 546ce6ca, 73e57f49, 3b663bbd, 5037bb57 (light-only), 6a9d4efe, 059d8725 (sizes D); shipped as the commented source — the slim build is NOT switched in | admin-light, admin-payments, admin-polish, sizes-admin, icons-polish |
| `sporta-returns-touch.css` | 2,555 → 4,957 | 954 → 1,900 | `cee27193` → 9ac31d4b (sizes B) | sizes-screen |
| `sporta-clock.css` | 1,458 → 2,461 | 621 → 1,013 | `cee27193` → 393e6013 (icons polish) | icons-polish |
| `sporta-ui-colours.css` | 7,591 → 16,615 | 2,770 → 5,778 | `ab21d797` (deployed 11-02) → words-and-colours fix round 1 (snapshots a00cdfaa, c97621f5) | words-colours, icons-polish |
| `sporta-checkout-a11y.css` | 1,201 → 26,279 | 560 → 8,665 | `cee27193` → 8b0f07f6 (cash-04..13), 9ac31d4b (sizes B), a1059af7 (U1 review) | checkout-ux, checkout-a11y, sizes-screen |
| `sporta-shadows.css` | 1,094 → 8,533 | 443 → 3,177 | `cee27193` → 393e6013 (icons polish) | icons-polish |
| `sporta-images.css` | 2,379 → 3,616 | 1,057 → 1,583 | `54daaf0e` (deployed 11-02) → 0bfbaf52, 5ac044bd, 711736fa | images-layout, icons-polish |
| `sporta-features.js` | 29,918 → 70,928 | 9,944 → 22,776 | `54daaf0e` (deployed 11-02) → 4a406005 (About brands), bda5264e (stock loader), page-weight variants block (fe8ff368, reviewed 1736ca18, sizes lane A), U3 add-to-bag (35f5f996 review; code in snapshot fb7a191e), K3 `n0 < reported` guard | add-to-cart-ux, sizes-product, race-client, shop-header, about-page, sizes-weight |
| `sporta-footer-call.js` | 2,320 → 11,841 | 987 → 4,119 | `cee27193` → U2 second block (a85d3982 review; code in snapshot 7cecbdbf) | cart-ux |
| `sporta-gov-autopick.js` | 20,368 → 27,906 | 7,642 → 10,294 | `8bf60016` (deployed 11-03) → stale-pin fix (snapshots 85f19c7b, 4cd70d73; checkout-location suite + K3 review f4982db7 section E) | checkout-location, race-client |
| `sporta-checkout-a11y.js` | 1,378 → 12,488 | 612 → 4,365 | `cee27193` → U1 script half (a1059af7 review; code in snapshots 85b31949, 00db8bd9) | checkout-ux, checkout-a11y |
| `birthday.js` | 12,172 → 22,538 | 4,184 → 7,901 | `cee27193` → K3 guards (f4982db7 review; code in snapshot 0e037ea2) | race-client, sizes-weight |
| `fonts/` (8 files) | not captured → 221,968 raw (was 253,472 in the repo; the live bytes are what the plan shows) | — | `2d297cd8` → 5b02151d, c56c90cf (W1 review: re-slim byte-identical 8/8, 140 page states pixel-identical) | fonts-used, admin-polish |

Totals for the 19 text files: 144,204 → 374,057 raw; 51,128 → 129,354 gzip;
47,940 → 122,660 Brotli. The live `index.html` links every add-on on every page, so a
first visit downloads about 120 kB Brotli of add-ons after this release against about
47 kB today (section 5 has what that means for returning visitors).

Unchanged, so not in the `--only` list: `boot.js` and `sporta-clock.js` are
byte-identical to live; `config.js` is live-only and the deploy tool never touches it.

### The `--only` list

```
sporta-product-fix.css,sporta-brand-theme.css,sporta-home-trim.css,sporta-cart-drawer.css,sporta-grid.css,sporta-bag-touch.css,sporta-cat-tiles.css,sporta-admin-knet.css,sporta-returns-touch.css,sporta-clock.css,sporta-ui-colours.css,sporta-checkout-a11y.css,sporta-shadows.css,sporta-images.css,sporta-features.js,sporta-footer-call.js,sporta-gov-autopick.js,sporta-checkout-a11y.js,birthday.js,fonts
```

`vps-deploy.mjs --only` takes top-level names: a root file is in scope when it IS a
listed name, a folder (`fonts`) when its first segment is. Nothing else is compared, so
the foreign `index.html` is not even looked at and the storefront guard cannot fire.
`.htaccess` is a guarded file (shrink rule) but it is not in this list by default; see
section 5.

## 3. OUT — waits, with the reason

| file | why it waits |
|---|---|
| `sporta-admin-brands.js` | calls `admin.php?r=brand_products` (absent from the live `admin.php`) and `abandoned.php` (file absent at `1eb487aa`), and says "30 days" on the sign-in screen while the live session still lasts 24 minutes idle. Goes out with the backend release (CLAUDE.md item 5). The runner re-checks both absences on every run. |
| `.htaccess` | HANDOFF.md release 2. HEAD's copy is the one deployed on 2026-11-03 plus two proven blocks (the 304 answer to a compressed ETag; the compressed 404 shell). The `/pay` CSP change is an unapplied patch, not in HEAD. `--with-htaccess` adds it to this release; section 5 has the trade-off. |
| `backends-offline.css` | not linked by the live `index.html`; a file it does not link is never loaded (CLAUDE.md item 5). |
| `boot.js`, `sporta-clock.js` | byte-identical to live; nothing to deploy. |
| `config.js` | live-only configuration; on vps-deploy's never-touch list. |
| `index.html`, `assets/`, `sw.js`, the sitemaps, `robots.txt`, `site.webmanifest` | the foreign storefront build; never part of a deploy. A whole-site plan lists them as "changed" — that is expected and they stay out of `--only`. |
| `dropin/**` (`api/`, `knet/`, `pay/`) | the backend release, behind the release gate (NOT READY on 2026-11-04: 5 store + 17 assistant findings open) and the live requirements in HANDOFF.md. |
| `images/products/responsive/*` | made ON the server by `scripts/make-image-variants.mjs` (HANDOFF release 3), never deployed from the repo. |

## 4. Live state used

| capture | taken | what it is |
|---|---|---|
| `scratchpad/audits/L4-static-css-and-admin/truelive/` | 2026-11-03 17:01 UTC | the 20 `sporta-*.css/.js` add-ons, fetched after all three 2026-11-03 deploys: `sporta-admin-knet.css` = blob of 718787f3, `sporta-cart-drawer.css` = 718787f3, `sporta-home-trim.css` = 194f739f, `sporta-gov-autopick.js` = 8bf60016 (md5-matched), `sporta-features.js` = f05d65fb (the 2026-11-02 deploy). |
| `scratchpad/scan-words/live/` | 2026-11-02 17:26–17:32 UTC | `index.html` (the add-on `<link>`/`<script>` list with `?v=` queries, no service-worker registration), `boot.js`, `birthday.js`, `config.js`, the live `/api` JSON answers. Predates the 2026-11-03 deploys, which touched none of those three scripts. |
| `git show 8bf6001:sporta-web/public/.htaccess` | deployed 2026-11-03 10:48 UTC | the live `.htaccess`: line 307 serves every add-on `Cache-Control: no-cache, must-revalidate`. |

Not captured: the live `fonts/*.woff2` bytes (the live compiled CSS references
`/fonts/<same eight names>`, so the slimmed files are a drop-in; the plan's
"changed (live bytes -> release bytes)" lines will show the before). The next session
should re-capture everything after the deploy (section 7, step 2).

## 5. What to know before saying yes

1. **Page weight.** Add-ons on the wire go from about 47 kB to about 120 kB Brotli per
   first visit (every add-on is linked on every page, admin stylesheet included). That is
   the reviewed work's size; the slim admin CSS build (76 kB → 32.5 kB, 0 computed-style
   differences) exists but is not switched in, and splitting the admin-only add-ons off
   the shopper path is an open owner decision (HANDOFF.md).
2. **Returning visitors and the `.htaccess` 304 line.** The live rule is
   `no-cache, must-revalidate`, so a returning browser re-checks each add-on on every
   page load. Measured against this `.htaccess` on a real Apache 2.4.58 (comment in
   `public/.htaccess`, "Revalidation of a COMPRESSED text file answers 304"): the
   compressed copy's ETag (`…-gzip` / `…-br`) never matches, so the re-check is answered
   with the whole file again — about 48 kB Brotli per page load today, about 123 kB after
   this release. HEAD's `.htaccess` carries the one-line fix (`RequestHeader edit
   If-None-Match`) and the compressed 404 shell, proven by `test:htaccess-rules`
   (895 checks: 819 ok, 76 expected-fail known defects, 0 FAIL, on this box's Apache) and
   `test:sizes-weight`. Not confirmed on the live server yet (one conditional GET from
   the VPS tells). Shipping it with release 1 is `--with-htaccess` on the runner, which
   adds `.htaccess` to `--only` and `htaccess-rules` to the suites. The owner (or the
   session) decides; HANDOFF.md's order says release 2.
3. **`variants.txt` until the photo copies exist.** The page-weight block in
   `sporta-features.js` asks once for `/images/products/responsive/variants.txt`. Until
   `scripts/make-image-variants.mjs` has run on the server (HANDOFF release 3, dry run
   first), that answers 404 with the error shell (19 kB; 6.3 kB Brotli on the live shell).
   The block remembers a miss for 6 hours per browser, so the cost is one such answer
   per browser per 6 hours, and it never requests a copy the list does not name. Running
   the maker first removes the cost entirely; shipping `sporta-features.js` first costs
   that until the maker runs. Both orders are safe; the HANDOFF order (maker first) is
   cheaper.
4. **Cache and `?v=`.** The live `index.html` links each add-on with `?v=1` (`?v=2`,
   `?v=3` for two of them). Those URLs do not change — `index.html` is not deployed —
   and they do not need to: `no-cache, must-revalidate` makes the browser re-check, and
   the new ETag makes the server send the new file. No service worker is registered by
   the live page (checked in the capture), so nothing else caches the old copy. Fonts
   carry `max-age=2592000`: a returning browser keeps the old (unslimmed) fonts for up to
   30 days, which looks identical.
5. **Fonts shrink; the shrink guard does not apply to them.** vps-deploy's shrink rule
   guards PHP, HTML and `.htaccess` only.

## 6. Blockers — what must happen before ANY deploy

1. **`scripts/file-audit.mjs` fails on three comments.** The VPS job runs the audit
   over the whole release build before it compares a single file, so even this
   add-on-only release is blocked. Reproduced here on a staged release tree
   (`vite build --outDir <scratch>` + the three `dropin/` folders), `3 high, 0 medium,
   19 low`:
   - `dropin/php-store/assistant.php:1212` — "… and src/pages/Privacy.jsx tells them …"
   - `public/birthday.js:235` — "… (src/lib/cart.jsx) and says so …"
   - `public/sporta-admin-brands.js:1761` — "… src/i18n/translations.js …"

   The audit's reference regex reads `src/…` as a `src=` attribute and reports
   `/pages/Privacy.jsx` etc. as missing files. Reword the three comments (say
   "the Privacy page component" or quote the path without the `src` prefix) — or teach
   the audit the difference — and re-run `npm run release:addons-1`. The 19 LOW lines
   ("never referenced by anything shipped: /sporta-…") are expected: this repo's
   `index.html` does not link the add-ons, the live one does; LOW does not fail the audit.
   `birthday.js` is IN this release, so its comment fix belongs in the release commit;
   `assistant.php` and `sporta-admin-brands.js` are other lanes' files but block the
   same audit.
2. **A clean HEAD.** `vps-deploy.mjs` deploys a named commit; the runner refuses a HEAD
   whose message says "do not deploy", "NOT READY" or "WIP snapshot" (HEAD `7bec997c`
   says "not ready" in its hand-over subject). `RELEASE-1-COMMIT.txt` is the message for
   the clean commit the orchestrator cuts after the gate: an empty commit on top of HEAD
   if no file changes are needed, otherwise the commit that carries the comment rewording
   above. Then push: the VPS downloads the tarball from GitHub by SHA.
3. **The Hostinger connector**, signed in, in the session that runs the plan and the
   apply. It is a tool call (`vps_docker_create`), which is why the runner prints the
   commands rather than running them.

## 7. The exact commands

All from `sporta-web/`. `<sha>` is the full 40-character SHA of the clean release
commit, pushed.

```
# 0. prove everything that can be proven here (builds dist/ with npm run release, audits
#    it, runs the suites, writes plan.compose.json). Exit 0 = PASS.
npm run release:addons-1
npm run release:addons-1 -- --apply <sha> <sha>        # also writes apply.compose.json

# 1. PLAN (read-only: /docker/sporta is mounted read-only in the job)
node scripts/vps-deploy.mjs compose --ref <sha> --only <the list in section 2> > plan.compose.json
#    -> vps_docker_create on VM 2058651, project "sporta-deploy", with that JSON; read the log:
#       "release: 27 deployable files", "-- changed (live bytes -> release bytes)" lists ONLY
#       the 19 text files and the 8 fonts (same names, smaller), "== HEALTH live now" all 200,
#       "PLAN_OK nothing was changed". Anything else in "changed" means live moved: stop and look.

# 2. APPLY (the SHA twice; backs up what it replaces; index.html last; re-probes; rolls back on a break)
node scripts/vps-deploy.mjs compose --apply --ref <sha> --confirm <sha> --only <the same list> > apply.compose.json
#    -> vps_docker_create; the log must end with
#       "DEPLOY_OK deploy-<YYYYMMDD>T<HHMMSS>Z-<sha7> — 0 added, 27 replaced. Undo: compose --rollback deploy-…"
#       (fewer than 27 replaced only if a font turns out byte-identical to live; "added" must be 0: every
#        file in this release already exists on the server)
#       Anything else — DEPLOY_FAIL, "rolling back", a log that stops — is not a deploy; say so plainly.
#    backup:  /docker/sporta/backups/deploy-<stamp>-<sha7>.tar.gz + .json

# 3. UNDO, if a read-only check after the deploy says so
node scripts/vps-deploy.mjs compose --rollback deploy-<stamp>-<sha7>
#    -> vps_docker_create; the log says "ROLLED_BACK deploy-…: 27 restored, 0 added files removed"
```

Never pass `--replace-storefront` (the storefront guard is for the foreign
`index.html`, which is not in scope here anyway) and never `--allow-shrink` (nothing
guarded shrinks in this release; if the plan says SHRINKS, something is wrong).

### After the deploy, read-only, in this order

1. `node scripts/vps-deploy.mjs compose --scan` → `vps_docker_create`: `live-scan.mjs`
   on the VPS, the `scan-server-response.sh` checks (TLS, single-hop redirects, headers,
   cache tiers, cookies, 404s, exposed files) plus the web root on disk.
2. Re-capture the live add-ons and pages: the 27 files of the plan's "changed" list, the
   storefront pages and the three route stylesheets never captured (Returns, Account,
   AdminApp), then `SIZES_LIVE_DIR=<capture> node scripts/make-sizes-fixtures.mjs` and
   `make-sizes-admin-fixtures.mjs` so the fixtures match what is live.
3. The Payments screen in dark mode: `MODE=colors SCHEME=dark node
   scripts/admin-payments-scan.mjs` in the Playwright image on the VPS (every admin call
   is answered with made-up data; no sign-in, nothing saved). The screen must read light.
   Before the deploy the same scan takes
   `CSS_URL=https://raw.githubusercontent.com/hkspower/wain/<sha>/sporta-web/public/sporta-admin-knet.css`
   to measure the file on top of the live page first (CLAUDE.md, "NOT yet measured on
   the live page").
4. A read-only look at `/checkout` in `ar` and `en` (never submitted), `/shop?brand=<slug>`,
   a product page's size ladder, `/cart` and the bag drawer: measure the DOM, screenshots
   cannot be viewed from the VPS.
5. One conditional GET of an add-on with its compressed ETag, to settle section 5.2 on
   the live server.
6. `vps_docker_delete` every scratch project. Then update CLAUDE.md item 5 (what is live,
   the backup name) and HANDOFF.md's release order.

## 8. The proving suites

All rig-free (Chromium from `/opt/pw-browsers` against fixtures of the live markup or
the repo's own throwaway build; no MariaDB, no shared port, no `dist/`), run one at a
time on this box (4 CPUs, Node v22.23.4 — the pinned toolchain is Node 24; the suites
do not depend on the difference). Counts from the run of 2026-11-04 recorded in
`RELEASE-1-COMMIT.txt`; the runner prints the same table every time.

| suite | script | proves | checks (passed / failed) |
|---|---|---|---|
| checkout-ux | `test:checkout-ux` | checkout-a11y.css/.js (U1) | 369 / 0 |
| cart-ux | `test:cart-ux` | cart-drawer.css, bag-touch.css, footer-call.js (U2) | 342 / 0 |
| add-to-cart-ux | `test:add-to-cart-ux` | features.js, product-fix.css (U3) | SUITE_ADD_TO_CART |
| race-client | `test:race-client` | birthday.js guards, gov-autopick.js, features.js J (K3) | SUITE_RACE_CLIENT |
| checkout-location | `test:checkout-location` | gov-autopick.js (stale pin) | SUITE_CHECKOUT_LOCATION |
| checkout-a11y | `test:checkout-a11y` | checkout-a11y.css/.js (cash-04..13) | SUITE_CHECKOUT_A11Y |
| sizes-screen | `test:sizes-screen` | cart-drawer, cat-tiles, returns-touch, checkout-a11y css (sizes B) | SUITE_SIZES_SCREEN |
| sizes-product | `test:sizes-product` | product-fix.css, features.js (sizes C) | SUITE_SIZES_PRODUCT |
| sizes-admin | `test:sizes-admin` | admin-knet.css (sizes D) | SUITE_SIZES_ADMIN |
| sizes-weight | `test:sizes-weight` | the variants block of features.js, page weight (sizes A) | SUITE_SIZES_WEIGHT |
| admin-polish | `test:admin-polish` | admin-knet.css polish, fonts | SUITE_ADMIN_POLISH |
| admin-light | `test:admin-light` | admin-knet.css light-only (no dark mode for KNET) | SUITE_ADMIN_LIGHT |
| admin-payments | `test:admin-payments` | admin-knet.css Payments layout | SUITE_ADMIN_PAYMENTS |
| fonts-used | `test:fonts-used` | fonts/ (only the weights used) | SUITE_FONTS_USED |
| home-features | `test:home-features` | home-trim.css features band | SUITE_HOME_FEATURES |
| icons-polish | `test:icons-polish` | clock.css, shadows.css and the icon rules in the other add-ons | SUITE_ICONS_POLISH |
| menu-layout | `test:menu-layout` | bag-touch.css header and menu | SUITE_MENU_LAYOUT |
| shop-header | `test:shop-header` | grid.css, features.js shop header | SUITE_SHOP_HEADER |
| words-colours | `test:words-colours` | ui-colours.css, brand-theme.css | SUITE_WORDS_COLOURS |
| images-layout | `test:images-layout` | images.css, grid.css | SUITE_IMAGES_LAYOUT |
| about-page | `test:about-page` | home-trim.css, features.js About | SUITE_ABOUT_PAGE |
| product-desc | `test:product-desc` | product-fix.css description rules | SUITE_PRODUCT_DESC |
| htaccess-rules (`--with-htaccess` only) | `test:htaccess-rules` | `.htaccess` on a real Apache 2.4 | 819 / 0 (76 expected-fail, known defects) |

Not run, and why: `test:contrast` (vite preview on port 4173, the shared rig),
`test:vps-deploy` (76 checks; builds `dist/`), `test:addons-brands` (118; the OUT
file), `test:addon-css-slim` (the slim build is not switched in).

## 9. What changes on the site, in plain words (for the owner)

- **Checkout:** on a phone the first field is above the pay bar and the delivery page is
  about 480 px shorter; the discount code and the note sit behind links; a
  "Delivery – Free" row a screen reader reads in order; the pay button is greyed (not
  see-through) while it cannot be pressed and sticks to the bottom with the total for a
  returning shopper; the phone number is checked when the shopper leaves the field;
  bigger touch targets, the selected payment radio and focus ring in the dark orange.
- **Bag page and drawer:** a sticky checkout bar whose total never hides under the
  button at 130% text; minus at quantity 1 no longer deletes silently; focus stays on
  the row; the drawer's shadow strip is gone; Arabic size labels sit beside the name.
- **Add to bag:** Add sits beside Buy now in the phone bar; "Added" is answered and
  announced; "Choose a size" when none is chosen; sold-out is readable; "In your bag"
  for the last unit; a double tap adds once. Buy now still also adds to the bag (owner
  decision: Add then Buy now orders two pieces).
- **Product page:** tighter size ladder, option cards and buy row; the description keeps
  its line breaks; the page never scrolls a field under the stuck buy row; the gallery
  fits a short laptop window.
- **Shop, brand and category pages:** shorter phone header, 14 px menu tabs, a 3 px focus
  ring, the footer stays below the fold while the grid loads; the brand banner, the
  maker-mark link and the About page's brand names come from the live brands list.
- **Home and editorial pages:** smaller tiles, brand strip and editorial type (sizes
  lane B); the About page's numbers on one scale; readable hero text and slide arrows on
  photo slides.
- **Colours and icons:** buttons, hover and keyboard focus in the brand orange; the
  leftover terracotta and slate tints gone; one icon stroke scale, Arabic ink alignment,
  the header clock face redrawn.
- **Reliability in the browser:** the bag is merged between tabs instead of one tab
  overwriting another; Enter in the discount box cannot fire three requests; coming back
  from the bank with the Back button no longer leaves a dead pay button; a failed stock
  answer no longer makes the product page ask again on every render; the remembered
  delivery details never carry a stale map pin.
- **/backends:** the Payments (KNET) screen stays light in every dark state; compact
  tables; the polish of cards, notices and fields. The "30 days" sign-in text, the Photos
  panel, brand products and the abandoned-orders list are NOT in this release (they need
  the backend release).
- **Fonts:** the same eight files carry only the weights the site uses (about 31 kB less
  in total); nothing looks different.
- **Photographs:** small copies on cards and thumbnails start being used only once the
  copies exist on the server (release 3); until then the page looks exactly as today.

## 10. What only the connector session can confirm

- The plan's "changed" list equals the 27 files above and nothing else (live may have
  moved since the captures; the fonts' live bytes were never captured).
- `DEPLOY_OK` in the apply log, and the backup name.
- The 304 behaviour of the live Apache behind Traefik (section 5.2).
- The Payments screen's light look in dark mode on the live page (section 7.3).
- Whether `/images/products/responsive/variants.txt` exists live (section 5.3).
- That `/payment/knet-official.png` exists live (the KNET logo the checkout a11y rules
  reference was not in the capture; HANDOFF.md).
