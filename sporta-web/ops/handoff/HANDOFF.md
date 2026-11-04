# Hand-over note, 2026-11-04

Written because the owner is about to start a NEW session with the Hostinger connector ("ppok") connected.
Connectors are only read when a session starts, so the session that wrote this note never had them.
Everything below is the state at the time of writing. `git log` on branch `claude/sporta-integration-tveo8b` is the truth.

## First 10 minutes of the new session
1. Confirm the connector tools exist (a ToolSearch for `ppok` finds `execute`, `multi-execute`, `search`). If not, stop and tell the owner.
2. Read CLAUDE.md (deploy rules: `scripts/vps-deploy.mjs`, plan first, apply needs the commit SHA twice, never `--replace-storefront`, live probes are read-only).
3. Run READ-ONLY jobs first, in this order, and keep the output for the deploy plan:
   - `vps-deploy.mjs compose` plan against the commit you intend to ship (shows what differs from live).
   - Live schema diff (`scripts/db-schema-diff.mjs`, job spec `ops/db/schema-diff.compose.json`, procedure `ops/db/SCHEMA-AUDIT.md`) if it has been committed.
   - Live files scan (`scripts/unknown-files-scan.mjs`, `ops/live-files-scan.compose.json`, `ops/FILES-SCAN.md`) if committed.
   - Database audit (`scripts/db-security-audit.mjs`, `ops/db/db-audit.compose.json`, `ops/db/HOST-CHECKLIST.md`).
   - Re-capture the live storefront pages and the three route stylesheets that were never captured (Returns, Account, AdminApp) so fixtures can be regenerated (`SIZES_LIVE_DIR=<capture> node scripts/make-sizes-fixtures.mjs`, `scripts/make-sizes-admin-fixtures.mjs`).
4. Delete every scratch compose project you create (`vps_docker_delete`).

## Release order (nothing has been deployed since `deploy-20261103T104853Z-8bf6001`)
Never ship a commit whose message says "do not deploy" or "NOT READY". Most recent commits are automatic "WIP snapshot" commits with that text: cut a clean commit first.

1. **Add-on release 1 (CSS/JS only, `--only <file names>`):** the reviewed sizes work (`sporta-product-fix.css`, `sporta-cat-tiles.css`, `sporta-grid.css`, `sporta-home-trim.css`, `sporta-cart-drawer.css`, `sporta-bag-touch.css`, `sporta-checkout-a11y.css`, `sporta-images.css`, `sporta-admin-knet.css`), the CSS-update fixes (`sporta-ui-colours.css`, `sporta-brand-theme.css`, focus rings and dark-theme guards), `sporta-gov-autopick.js` (stale-pin fix) and the `sporta-features.js` stock-loader fix. The suites that prove them: `test:sizes-screen`, `test:sizes-product`, `test:sizes-admin`, `test:sizes-weight`, `test:admin-light`, `test:admin-polish`, `test:checkout-a11y`, `test:checkout-location`, `test:contrast`.
   Caution: `sporta-admin-brands.js` is NOT part of this release; it goes with the API release (it calls routes the live backend lacks).
2. **`.htaccess` release:** 304 revalidation for the 23 add-ons and the compressed 404 shell (sizes lane A), plus the CSP fix for `/pay/pay.php` (`patches/htaccess__xss-csp-pay-proposed.diff`: read the live pay-config hosts first). The `/pay` hand-off must ship in the same release as anything that turns on `knet_via_cbk`.
3. **Photo copies:** run `scripts/make-image-variants.mjs` on the server (dry run first, read the NOTE, use `--keep-existing` if the existing -320/-640/-800 files are the build's own), THEN ship the guarded block in `sporta-features.js`. Until the maker has run, every first visit costs about 12 kB more.
4. **Backend release (api, knet, pay, add-ons that call new routes, `sporta-admin-brands.js`):** only after the release gate is READY, the full suite gate is green, and the live schema diff shows nothing the code needs is missing. Move the baseline after the deploy (`git diff 1eb487aa HEAD -- sporta-web/dropin` is the old baseline; update CLAUDE.md item 5).

## Unapplied patches (in `ops/handoff/patches/`)
They were each proven on a scratch copy of the tree AT THE TIME against a moving HEAD. Re-apply with `git apply --check`, resolve by hand if needed, then rerun the lane's suite. The release gate (store.php, admin.php, api.php, assistant.php, cron-*.php, customer*.php, crm.php) was still rewriting the backend when this was written.
| file | what | target |
|---|---|---|
| addons__alignment-proposed.diff | alignment fixes found by the page-alignment audit (AI panel direction in Arabic, drawer shadow strip, promo bar descender clipping, etc.) | add-on CSS |
| addons__fonts-proposed.diff | fonts audit fixes (badges painted under the photo, support title weight, preload of the late faces, etc.) | add-on CSS + boot.js |
| addons__description-proposed.diff | optional description measure rule (reviewer advises skipping) | `sporta-product-fix.css` |
| htaccess__security-proposed.diff | security hardening from the apex/live scans | `.htaccess` |
| htaccess__xss-csp-pay-proposed.diff | per-file CSP so `/pay/pay.php` can auto-submit; form-action for the CBK hosts | `.htaccess`, php-cbk |
| backend__races-K1-*.patch, backend__races-K2-*.patch | race-condition fixes (stock lock order, callbacks, counters, single-use secrets, files) | backend PHP |
| backend__q1-columns-only-needed.patch | select only the needed columns (response diffs byte-identical) | backend PHP |
| backend__dbsec-*.patch | least-privilege DB roles, connect helper, retention | backend PHP |
| backend__pooling*.patch | opt-in persistent PDO connections (default OFF; reviewed: CPU per request unchanged, recommend leaving off) | backend PHP |
| addons__mobile-proposed.diff | mobile check fixes (checkout area list picks on touch-start, invoice totals hidden under 640 px, AI panel scroll jump, owner order sheet) | add-on CSS/JS |
| addons__api-check*.patch, backend__api-check*.patch | API-call check fixes (stock-loader request storm, POST deadlines, CBK settlement lost on a failed bank lookup, log clipping, DB read timeout) | add-ons, backend PHP |
| backend__dataflow.patch, addons__dataflow-htaccess.patch | data-flow fixes (card masking to the AI vendor, settlement-write failure, log/PII handling); Mermaid maps in `dataflow/` | backend PHP, `.htaccess` |
| backend__abandoned-orders-registration.patch | registers the abandoned-orders routes in `admin.php`; the new files `abandoned.php` and `abandoned.mysql.sql` are already in the tree; contract in `abandoned-orders-CONTRACT.md` | backend PHP |

## Work that was running when this was written (re-launch if it is not in `git log`)
- Release gate (backend review/fix/re-review, suites) , sizes (done, reviewed), UX checkout/cart/add-to-cart (add-on files), race-condition hunt (K1/K2/K3), code splitting for checkout + admin Profiles + connection pooling, re-renders/columns/font weights (W1 slim fonts), lighter admin CSS (`scripts/build-addon-css.mjs`, `--apply` is the final switch and must be run after the sizes work: it moves the commented source to `addons-src/`), abandoned orders list (new `abandoned.php`, migration, admin panel block), full database columns check + schema diff tool, data-flow check, unknown-files scan, database security pack (`ops/db/`), alignment/mobile/API-calls/N+1-deps-timeouts audits.
- Queued, not started: **abandoned CART capture** (capture only after the shopper has typed a phone or email at checkout, visible disclosure line, 30-day deletion cron, a Carts tab beside the abandoned orders list, WhatsApp link, optional restore link; privacy wording needs the owner's approval), and the **master review + fix wave** that merges every report and patch.

## Last test state
**Check-in 2026-11-04 10:17 UTC (machine quiet, load ~22): 13/13 suites, 3815 ok, 0 fail** (native 438, knet 77, tpay 83, assistant 2227, install-sql 11, arabic 67, seo 33, contrast 4, areas 18, native-e2e 26, config 32, admin-polish 681, addons-brands 118). The 08:17 run had native 46 / 19 / 7 FAIL at load 50-80, all rate-limit window counters; they went away at lower load, so they were load, not a code bug. Do not run suites while other lanes use the shared rig.

Older state follows.
Check-in 2026-11-04 06:17 UTC: 3470 ok, 6 fail in the first pass; rerun alone: `test:native` 431/0, `test:seo` 33/0, `test:native-e2e` 25/1 ("the product page shows the sale price", suspected timing under load average ~80). The machine was badly overloaded by too many parallel workflows: run fewer at a time.

## Done since the first version of this note
Reports with proposed fixes exist for alignment, fonts, mobile, API calls, data flow, unknown files, database security, code splitting and pooling. The slim admin CSS build (76 kB to 32.5 kB, 0 computed-style differences over 42 M values) is built but NOT switched in. Abandoned-orders backend is built (239 checks); its /backends panel ships with the next API release. Abandoned CART capture has not been started.

Also done: re-render audit (8 patches `storefront__rerenders-*.patch` for THIS repo's storefront and admin only: the live storefront is a compiled build, so they matter only if it is ever rebuilt from this source; report in `rerenders-report.md`). Columns check: `backend__q1-columns-only-needed.patch` (DB CPU per products request 85 to 25 ms at 4,000 products, responses byte-identical). Fonts: Alexandria's weight axis cut to 400-900 and glyph names dropped from all 8 files, 253,472 to 221,968 bytes, pixel-identical on 140 page states; committed (`c56c90cf`, files in `public/fonts`); the live site serves the same file names, so shipping them is a plain file copy in a deploy, after a read-only plan.

## Release blockers found on the way
- `file-audit.mjs` fails on three comments that mention `src/...jsx` paths (`assistant.php`, `birthday.js`, `sporta-admin-brands.js`), so `vps-deploy.mjs` aborts at its audit step. Reword the comments or relax the audit.
- Check in n8n that the four workflows described in `N8N-SECURITY.md` are archived and the FTP password was rotated (owner action; cannot be seen from the repo).
- Do NOT run the git-history purge as proposed: the "dead" paths are the current content of 13 other remote branches.

## Owner decisions still open
- Remove the scan reports from the PUBLIC branch? (`PHP-SCAN`, `LIVE-SECURITY-SCAN`, `REPO-SCAN`, `APEX-AUDIT`, `FONTS-AUDIT`, `ALIGNMENT-AUDIT`.)
- Hero banner height (a `/backends` setting; "short" saves ~140 px on a phone), footer buttons side by side or stacked, admin tables as a card list below 1024 px, fonts (drop a Plex weight, ~63 kB Arabic first visit), split the admin-only add-ons off the shopper path (~60.8 kB Brotli) or ship the lighter CSS/JS build, run the photo-copy maker on the server.
- Database: retention periods, backup key custody and where the off-server copy goes, whether to apply the least-privilege accounts, admin accent colour (indigo in CLAUDE.md vs the live admin's #9a452c).
- KNET-with-CBK merge: CBK-only or keep direct KNET; Arabic copy on the `/pay` hand-off page.
- Product descriptions: the 46 live descriptions only repeat the title; the admin silently cuts at 280 characters.
- History purge for any real secret found by the unknown-files scan (destructive, public repo).
