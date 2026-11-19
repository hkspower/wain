# Project instructions for Claude — Sporta

## Standing preferences (saved by user request — apply for all time)

1. **Claude does the full coding.**
   Write complete, production-ready code directly in this repo. Do NOT delegate
   implementation to another AI builder or hand off "paste this into <tool>"
   prompts as the deliverable. Deliver actual files that build and run.

2. **Nothing deploys from CI, and the owner never touches one.**
   Site updates go out by direct deploy to the VPS that serves the site —
   `scripts/vps-deploy.mjs`, a one-shot job a person starts through the
   Hostinger API (see item 4). There is no GitHub Actions workflow
   and there is not meant to be: the one that existed was deleted at the
   owner's request, along with every trace of the Lovable era it was written
   alongside. Do not reintroduce either.
   (Claude still commits and pushes to its working branch — that is a backup of
   the source, not a deploy route, and nothing on the server reads from it.)

3. **Keep replies brief.** Short answers, minimal preamble, no long recaps of
   what was just done. Lead with the result; give detail only when asked or
   when something genuinely needs a warning. Code comments stay thorough —
   this is about chat replies, not the codebase.

4. **Deployment target: the Hostinger VPS `187.7.78.123`** (saved by owner
   request 2026-11-01). `www.sporta.com.kw` resolves there: Traefik →
   `apache-sporta` (php:8.4-apache) → `/docker/sporta/site`, with every config
   in `/docker/sporta/private/` (see "Where every config lives"). Deploy with
   **`scripts/vps-deploy.mjs`** (GO-LIVE.md, "Deploying to the VPS"; the job
   is started through the `hostinger-vps` connector in `.mcp.json`): plan
   first, which is read-only; apply needs the commit SHA twice, backs up what
   it overwrites, refuses older-code-over-newer, and rolls itself back if a
   page that worked stops working. The old shared-hosting account
   (`46.202.158.211`, hPanel FTPS / File Manager) no longer serves the domain;
   `npm run publish` refuses while DNS says so (`--any-server` overrides). SSH
   on the shared account is off for good. Not SFTP.
   **The backend in this repo IS the live backend** (copied from the VPS
   2026-11-01, every file md5-verified against the server: `dropin/php-store`,
   `php-cbk`, the add-ons in `public/`). The live STOREFRONT is not: its
   `index.html` and bundle are a different build whose source is missing, so
   deploy with **`--only api,knet,pay`** until this repo has every screen it
   has. (The owner tried this repo's storefront live twice on 2026-11-02,
   03:22–03:35 and 03:40–03:44 UTC, and chose the old build both times.) It
   has what this repo has NO screen for — the backlog to rebuild —
   shoppers: customer accounts (`/account`,
   forgot password), support tickets (`/support`), return requests and
   exchange; admin: MFA code and forced-password-change sign-in steps, Google
   sign-in, CRM, Support, Return requests, Activity log, Profiles, inventory
   movements/finance, SEO, theme, top bar, fonts, payment/checkout settings,
   product photo upload, cache clear. In this repo's admin an account with MFA
   on, or one with a temporary password, cannot sign in at all. `vps-deploy.mjs`
   refuses to replace a live `index.html` without `<meta name="sporta-build"
   content="sporta-web">` (a foreign build) unless `--replace-storefront` — do
   not pass it unless the owner asks for this repo's storefront again. The live store
   claims stock inside the order (`out_of_stock_<slug>_<size>_<left>`), a
   declined card closes the order on both gateways, and an unsigned CBK error
   return is recorded but changes no status — the suites assert all three.
   **The live database must carry every repo migration.** On 2026-11-02 it
   lacked `inventory.mysql.sql`, and the live stock claim writes
   `inventory_version`: every order 500'd for 33 days (last order 2026-09-30)
   and the admin Stock screen with it. Applied that day (backup
   `backups/manual-20261102T1506Z-inventory-migration`); see
   `DATA-SCAN-2026-11-02.md`. Before deploying code that touches a new column,
   diff the live schema (read-only job) against the migrations.
5. **Live server facts and what is on it (measured 2026-11-03).**
   - **2026-11-12: Sporta AI release on top of the baseline.** Live `api/assistant.php`, `api/api.php`,
     `api/cron-voice.php` are commit `011ae562` (a snapshot whose `dropin/php-store` is `dcd2b28b` except those
     three; `deploy-20261112T033036Z-011ae56`, DEPLOY_OK; undo `compose --rollback` that name). Every other api file
     is still `dcd2b28b`. Independent review: SHIP. Live config (read-only probe `scripts/live-ai-probe.mjs`):
     `ai_key` EMPTY (fixed answers only, no model), `tts_key`/`tts_voice_id` EMPTY (no voice); owner decision pending.
     `vps-deploy.mjs --only` takes top-level names only, hence the snapshot commit for a file-level release.
   - **Deployed 2026-11-12 (owner: "deploy", scope A): `deploy-20261112T114307Z-f0ba902`** (undo `compose --rollback` that name),
     from the snapshot commit `f0ba9023` (reverted on the branch by the next commit): `sporta-admin-brands.full.js` = live
     `2b22a9a` + the PAYMENTS TRIM block only (`ops/release/sporta-admin-brands.trim-1112.js`; the loader name unchanged),
     `sporta-admin-knet.css` = live (`8be4143` source) + KNETCOMPACT-1112 only, `sporta-checkout-a11y.css/.js` = TRIM-1112 v2
     (floor + flat visible; delivery note + location behind one button) without the SOG-1112 block. So the live admin file is
     NOT the branch's `public/sporta-admin-brands.js` (that one also has Shipping / Database center / Social / Footer blocks
     that need the API release) and the live admin CSS lacks LOGINLIGHT, SOG-1112 and BUTTONS-1112. Live check:
     `scripts/live-trims-probe.mjs`.
   - **Baseline (moved 2026-11-10, second time):** the live `api/`, `knet/` and `pay/` are commit
     `dcd2b28b` (`deploy-20261110T094041Z-dcd2b28`, DEPLOY_OK; undo `compose --rollback` that name;
     owner: "make one time approve, full deploy now"). It added the admin-editable site content
     (`settings.site_content`, public `api.php?r=content`, admin `content` / `content_save`) and the
     returns policy (`settings.returns_policy`; `returns.php` window and switches), no migration, plus
     `sporta-features.js` (SITE CONTENT block) and the full `sporta-admin-brands.js` (22,960 -> 304,330
     bytes: photo uploader, save bar, site content editor, CBK fields inside the KNET editor with the
     T-Pay card hidden, abandoned orders block still hidden). The independent review finished after
     the copy and said SHIP for all three (native 542 ok, site-content 109, cbk-merge 30). Open from
     it: M1 turning returns or exchanges OFF leaves the compiled /exchange page offering it (400
     `action_disabled`) - keep both switches ON until features.js hides the option; L1/L2 the price
     guard misses "dinars/دينار/fils" and does not cover returns wording; L3 contact values not
     re-validated on read; L7 the CBK card's note keeps the old environment name after a refusal.
     Live check after the deploy (16 pages, ar+en, 390px): all 200, no overflow; every storefront page
     logs one 404, `/images/products/responsive/variants.txt` (the small-copy list features.js asks
     for; make it with `scripts/make-image-variants.mjs` or guard the request). `sporta-admin-knet.css`
     went out the same day (`deploy-20261110T093849Z-dcd2b28`). The baseline before this one was
     `8fb025a5` (`deploy-20261110T064353Z-8fb025a`). That release carried the admin passcode (migration
     `admin-passcode.mysql.sql` applied 2026-11-09, backup
     `backups/manual-20261109T2310Z-admin-passcode-migration`), the 30-day admin
     sign-in, the order cooldown, the assistant rewrite and the CBK hand-off page fix
     (own CSP in `pay/.htaccess`; the script's sha256 there must match `pay.php`).
     Before it, the baseline was
     commit `1eb487aa` (verified by read-only `vps-deploy.mjs` plans). What a
     backend release ships is `git diff dcd2b28b HEAD -- sporta-web/dropin`; move
     the baseline after every backend deploy. A whole-site plan also lists
     `index.html`, the hashed assets, `sw.js`, the sitemaps, `robots.txt` and the
     manifest as different — those belong to the foreign storefront and are never
     part of a deploy. Scope backend deploys with `--only api,knet,pay,.htaccess`
     plus the add-on file names.
   - **Host cron** (`/etc/cron.d/sporta-cron`, root; each job is a `docker exec -u
     www-data apache-sporta-1 php …`, output to `/var/log/sporta-cron.log`):
     `cron-stock.php --release` every 15 min, `cron-fulfilment.php --run` every
     5 min, `cron-voice.php prune` monthly (1st, 04:30), `cron-birthday.php --send`
     daily 06:07. The container has no cron daemon. So **new `cron-stock.php` code
     is live within 15 minutes of a file copy** — including the 24 h COD
     auto-cancel (`cod_hold_hours`, default 24). That is why a backend deploy waits
     for the independent review, the suites and the live schema diff, and why a
     commit whose message says "do not deploy" or "NOT READY" is never shipped.
   - **Container paths:** `/var/lib/sporta` is the host's
     `/docker/sporta/private/voice`, owned by uid 33 (www-data): payment logs and
     `tts-cache`; the admin-session directory (`admin-sessions`) belongs under it and
     does not exist yet because the 30-day sign-in change has not shipped.
     `/run/sporta-api-config.php` is the store config (root-owned, `0440`, group
     33), so every new key needs a safe default in code; the gateway configs are in
     `/run/sporta-config/`.
   - **`sporta-admin-brands.js` ships as a ~1 kB loader (2026-11-11).** `postbuild` runs
     `scripts/split-admin-addon.mjs`: the real code goes unchanged to
     `sporta-admin-brands.full.js`, and the linked name only adds it on `/backends` (a
     script that a script requests need not be linked; CSP is `script-src 'self'`). The
     readable source stays `public/sporta-admin-brands.js` (every suite loads it); deploy
     BOTH names (`--only sporta-admin-brands.js,sporta-admin-brands.full.js,.htaccess`);
     `npm run test:admin-loader`. Why: the shopper pages downloaded 159 kB of admin code
     (live perf probe 2026-11-11).
   - **Add-ons the live `index.html` links** (a file not in this list is never
     loaded): CSS `sporta-product-fix`, `sporta-brand-theme`, `sporta-home-trim`,
     `sporta-cart-drawer`, `sporta-grid`, `sporta-bag-touch`, `sporta-cat-tiles`,
     `sporta-admin-knet`, `sporta-returns-touch`, `sporta-clock`,
     `sporta-ui-colours`, `sporta-checkout-a11y`, `sporta-shadows`,
     `sporta-images`; JS `boot`, `config`, `birthday`, `sporta-features`,
     `sporta-admin-brands`, `sporta-footer-call`, `sporta-gov-autopick`,
     `sporta-clock`, `sporta-checkout-a11y`.
   - **Deployed 2026-11-03:** `sporta-admin-knet.css` (Payments layout) and
     `sporta-cart-drawer.css` (`deploy-20261103T070814Z-718787f`);
     `sporta-home-trim.css` (features band: stacked cards 720–959 px, centred row
     from 960 px; `deploy-20261103T080059Z-194f739`). `sporta-admin-brands.js` is
     NOT current live: the repo's calls `brand_products` (absent from the live
     admin.php) and says "30 days" (the 30-day session change ships with the API),
     so it goes out with the API release, not before.
   - **Deployed 2026-11-10 (owner: "full improve product page"):** `sporta-product-fix.css`, the
     LAYOUT section (`deploy-20261110T073306Z-b38e595`, then the breadcrumb fix
     `deploy-20261110T074552Z-1509630`; undo `compose --rollback` the second name). Two
     columns from 768px (the title was at y=922 on a 900px tablet screen, now 272), the
     phone's price above the fixed buy bar in both languages (ar 767, en 762; bar 771),
     related cards with a photo first. Measured on the live page before and after with
     `scripts/live-product-audit.mjs` (read-only; `SLUGS=` picks the products);
     `npm run test:product-layout`. Still open from that audit, not fixable in CSS: the
     authenticity plate downloads the 800px `logo.png` for a 91px box, and many products
     have no photo (the related row and the page show the grey plate).
   - **Deployed 2026-11-10 (owner: "scan www.sporta.com.kw then fix deploy"):** `sporta-shadows.css`,
     the SCAN-1110 section (`deploy-20261110T100722Z-03be5ff`; undo `compose --rollback` that name):
     `/account` footer under the fold from first paint (live CLS 0.44-0.56 phone / 0.19 desktop ->
     0.06 / 0), gallery dots 44px to the finger, contact phone and e-mail links 44px.
     `npm run test:scan-1110`; the scan is `scripts/live-site-scan.mjs` (read-only: 110 sitemap URLs
     all 200, 55 internal links ok, no JS errors, no sideways scroll, no broken images). Left open by
     that scan: `/about` desktop Arabic CLS 0.218 (the heading under the lead moves up 32px when late
     text lands; cause not traced), the 0.06 left on `/account` (birthday.js inserts its 111px field
     after paint), product meta descriptions of 18-25 characters (the products' own `desc_*` text is
     one short sentence: data), "no photo" plates on up to 9 of 14 first cards in a category, and the
     `variants.txt` 404 (see the baseline note).
   - **Deployed 2026-11-10 (owner: "full fix all images issues design"):** `sporta-images.css`, the
     FRAMES section (`deploy-20261110T093012Z-deec39f`; undo `compose --rollback` that name). The
     announcement bar holds one line (the build's default message wrapped to two lines on a phone, then
     the saved one arrived: header 134 -> 126px, CLS 0.169 on the phone home page, 0.056 elsewhere; live
     after: 126px throughout, `scripts/live-topbar-probe.mjs`), and a real product photo fills its card
     frame (no pad, no grey ring; the "no photo" plate keeps both). `npm run test:images-frames`. A long
     owner message now ends in an ellipsis on a phone instead of wrapping. Measured with
     `scripts/live-images-scan.mjs` and NOT fixable in add-on CSS: the product photos carry a grey-beige
     studio backdrop (about 195/192/184) on a white stage, so the main photo shows side bands; 9 of 36
     shop cards show the "no photo" plate; `cagliari-calcio-sweatshirt-navy.jpg` (800px, 126 kB) has no
     small variants; the phone hero downloads twice (`/hero/mobile/strength.webp`, then `slide_image`,
     which is upscaled 1.13x); the `vanquish` logo is 1400px for a 110px box; first-screen images are
     `loading=lazy`. The public products API returns `image: null` for all 46 (the storefront finds
     photos by slug).
     Also live the same day: `sporta-shadows.css` ACCOUNT section (`deploy-20261110T083342Z-582a658`;
     `npm run test:account-form`), and a test customer "Sporta QA Test" (qa-profile@sporta.com.kw, owner
     approved, no order; delete from the CRM when done).
   - **Deployed 2026-11-11 (add-ons only, each `deploy-<stamp>-<sha>`, undo `compose --rollback` that name):**
     `sporta-admin-knet.css` ADMINICONS/ADMINALIGN (`20261111T145133Z-224e8ed`); `sporta-admin-brands.js`
     (New product, SEO health blocks) + `sporta-checkout-a11y.css/.js` ONEPAGE (`20261111T191035Z-af02d71`);
     `sporta-footer-call.js` Support link in the footer (`20261111T194653Z-d14d134`); and
     `20261111T201854Z-2b22a9a`: `favicon.ico` (was 404), `sporta-shadows.css` CONTRAST-1111,
     `sporta-home-trim.css` 700 digit face, `.htaccess`, and the **admin add-on split**:
     `sporta-admin-brands.js` is now a 973 B loader and the real code is
     `sporta-admin-brands.full.js` (see above). Measured on the live site afterwards
     (`scripts/live-admin-loader-probe.mjs`, `scripts/live-perf-probe.mjs`, Arabic phone, 4x CPU, 1.6 Mbit/s):
     shopper pages no longer request the admin code (home 1232 -> 997 kB, /shop 809 -> 422 kB), home LCP
     4483 -> 3408 ms, /shop 3928 -> 3353 ms; `/backends` loads the full file once and still rewrites the
     sign-in line to 30 days. Still open from the perf test: the home LCP element is the hero
     (`/hero/mobile/strength.webp`, then `slide_image` twice: 143 + 2 x 92 kB), TBT 400-770 ms on a phone
     (compiled app), product/shop LCP is the grey "no photo" plate (data).
     Built, NOT deployed: TILES-1111 in `sporta-shadows.css` (home tiles equal on a phone, Men/Women athlete
     inside the tile at 768-1279 px; `npm run test:cat-tiles-crop`). `sporta-cat-tiles.css` holds unreviewed WIP
     (`[gs-t1]`, `[gs-t2]`, from the grid-style work): do not deploy that file without a review.
     Built, NOT deployed (2026-11-12, "improve images layout"): `sporta-images.css` IMAGES-1112 + the PHOTO BACKDROP
     block of `sporta-features.js` (reads a loaded photo's edges in a 40px copy and paints its own studio backdrop into
     the card / gallery bands; nothing cropped, no request, no re-encode; ships as BOTH files together);
     `npm run test:images-backdrop`. Needs a live check on the real photos (`live-images-scan.mjs`) after a deploy.
     **Deployed 2026-11-18 (owner: "deploy", scope: buy bar only): `deploy-20261118T092807Z-e80d18d`, DEPLOY_OK** (undo
     `compose --rollback` that name; `--only sporta-product-fix.css`, 1 file replaced, health unchanged). BUYBAR-1118 in
     `sporta-product-fix.css` [u3-1]: the phone buy bar is one full-width capsule (Add orange, price, Buy now near-black,
     no gaps, rounded-top sheet, same 73px). It also fixes a repo-only regression: `sporta-shadows.css` [m2-bar]
     (MOBILE-1112, not live) cancelled the room the bar makes for Add, so Buy now ran under Add and the price. It shipped as
     `sporta-product-fix.css` alone (it does not need MOBILE-1112: the safe-area variables fall back to 0). The live file was
     35759 bytes = the repo's PRICE-1 version (`f25e7a93`), so the release carried exactly the BUYBAR diff (35759 -> 41099).
     Live check (read-only fetch job): the served CSS holds BUYBAR-1118 and every `/shop` page links it; NOT yet seen in a
     real phone browser on a live product page (run `scripts/live-product-audit.mjs` with `SLUGS=`). Proof
     `npm run test:add-to-cart-ux` (mutation-checked; the bar section is 1 and 7).
     Built, NOT deployed (2026-11-18, owner: "make brand logo at product page"): BRANDMARK-1118 in the brands block of
     `sporta-features.js`: the maker's logo (or its name as a wordmark; the shop's own brand shows logo.png) as a white chip
     on the product photo, start-top corner, linking to the brand page; read from the plate, so a product with no brand tag
     gets none (40 of the 46 live products have no tag: tag them in /backends -> Brands). Absolute, no layout shift;
     `npm run test:addons-brands`. Ships with `sporta-features.js` whole.
     Built, NOT deployed (2026-11-18, owner: "make text style editor with fonts selecter"): TEXT STYLES. /backends ->
     Settings -> "Text styles" dialog (block ADMIN TEXT STYLES in `sporta-admin-brands.js`, both names): per language the
     heading font, body font (the theme's four `fonts`, via the same `settings_save` theme write the Theme screen makes),
     the text size (90-120%) and the heading weight, with a live sample. The sizes and weights are the new setting
     `settings.text_style` (no migration): API release (`store.php`, `api.php` public `?r=text_style`, `admin.php`
     `text_style_settings` + `settings_save`), then storefront `boot.js` (early apply from `localStorage.sporta_text_style`),
     `sporta-features.js` (TEXT STYLE block, one `?r=text_style` request per page load) and `sporta-brand-theme.css`
     (TEXTSTYLE-1118). A value equal to the design changes nothing. Proof: the TEXT STYLE section of
     `npm run test:admin-storefront` (real MariaDB), `npm run test:text-style`, `npm run test:admin-text-styles`. Measured on
     the captured live storefront at 120% text, ar and en, 320 and 390px: no sideways scroll on 9 pages (/, /shop, a product,
     /cart, /about, /contact, /account, /returns, /track); line breaks and the checkout steps were not inspected by eye.
     **Deployed 2026-11-18 (owner: "deploy with checker", after "make buy now button black with orange text ... remove price and choice
     size / remove red color and use orange color same logo exactly / scan cards then improve design / center all text / scan all
     icons"): `deploy-20261118T145743Z-21516fa`, DEPLOY_OK** (undo `compose --rollback` that name; `--only` the ten add-on files
     `sporta-product-fix.css, sporta-brand-theme.css, sporta-bag-touch.css, sporta-checkout-a11y.css, sporta-cart-drawer.css,
     sporta-grid.css, sporta-images.css, sporta-shadows.css, sporta-ui-colours.css, sporta-features.js`, 10 replaced, 0 added, health
     unchanged; the plan showed live bytes equal to the baseline commit's files, so the release carried exactly
     `git diff e7db9143 21516fa -- sporta-web/public`). **The live add-on files are now commit `21516fa6`'s.** Contents:
     - BUYBAR-1118b (`sporta-product-fix.css` [u3-1] phone block): the fixed bar is ONE Buy now pill, full width, near-black with the
       logo-orange text, label centred; no price, no Add / "Choose size" in the bar (Add is back in the page row: caption and
       stepper on one line, Add full width under them); dark theme: same pill with a 1.5px orange ring; sold out: the neutral pill.
     - COLOURS-1118 (`sporta-brand-theme.css`, the literals in the other add-ons): every orange fill is the logo's #FF7B17 exactly;
       the ONE darker step #B34D00 (same hue, 5.28:1 on white) for small text on light grounds and the hover fill; failures are
       orange too (the bundle's rose and red scales remapped for the shop, NOT while an admin screen or its sign-in is on the page);
       the bundle's hard-coded literals overridden. The admin's own colours (`#9A452C` buttons etc.) were not touched but the
       shared brand tokens (`--brand`, `--brand-deep`, `--primary`, `--accent`) are document-wide, so /backends shows the logo
       orange wherever it used the tokens. Focus rings on light grounds stay the dark step (3:1 floor).
     - CARDS-1118 (quick-add "+" without the grey rim, the why-card index as an orange disc; `CARDS-SCAN-2026-11-18.md`),
       ICON COLOUR 1118 (the footer chip icon, `ICONS-SCAN-2026-11-18.md`; the product reassurance icons stay the dark step because
       `test:icons-polish` holds 3:1 on their pale panel), CENTER-1118 (headings and short text centred in `.storefront-root main`,
       both languages). All in `sporta-shadows.css`, placed BEFORE the generated ICON SET section (`test:iconset` requires that
       one last; `test:icons-polish` counts the prefix "/* ==== ICONS", so no new section may start with it).
     - Proof before the deploy: `test:colours-1118` 15, `test:cards-1118` 18, `test:icons-1118` 10, `test:center-text` 133,
       `test:add-to-cart-ux` 192 + the four new mutants, cart-ux 342, checkout-a11y 602, checkout-ux 377, about-page 354,
       grid-style 284, price-style 91, words-colours 351, shape-1111 14,980, images-backdrop 337, icons-polish 1,826,
       iconset 7,683, admin-iconset 7,113, admin-polish 681, contrast-audit AA. FAILING BEFORE THIS RELEASE TOO (verified at the
       baseline or by reading the code, not caused by it): `test:storefront-polish` 8 ("a missing photo shows no alt text", the
       MONO-1112 ink rule outranks `color: transparent`), `test:mobile-1112` / `mobile-1112b` 1 each (the MOBILE-1112 block is no
       longer the last block of `sporta-features.js`: TEXT STYLE follows it), `test:sog-1112` crashes ("no SOG-1112 section" in
       `sporta-product-fix.css`, which never had one).
     - The live checker: `ops/live-release-check-1118.mjs` (read-only, run on the VPS in the Playwright image from the deployed
       commit's tarball; byte equality of the ten files, 7 pages x ar/en x 390/1280, no red drawn, the bar, headings, discs, /backends
       sign-in). Its own red detector is proven on real reds (`#e70044`, `#be123c`, `#e11d48` flagged, the oranges not).
     Left as they were: the salmon glows behind the hero and tile photographs (bundle literals), the admin's `#9A452C` buttons and
     rose errors (owner decision, see `BACKENDS-SCAN-2026-11-18.md`), the icon size scale (`ICONS-SCAN`).
     Built, NOT deployed (2026-11-18, owner: "improve sizes selecter at backends"): SIZES-1118 in the ADMIN NEW PRODUCT block of
     `sporta-admin-brands.js` (both names). The sizes picker gains quick sets (clothes S-XL / XS-3XL, shoes 38-46, kids 4-14),
     size-ordered rows, "S:4 M:6 L" in one box, one count for every row, a total, Enter to the next count and Arabic digits. The
     same picker serves a new "Add sizes" button (Catalogue header, and the Stock screen's header before the live status): a
     product that already exists gets sizes + opening stock through `variants_create` (all or nothing, never overwrites; existing
     sizes are shown and ticked off). Until the API release carries `variants_create` (it is NOT on the live server; the screen
     probes it and disables saving with a sentence) the picker's New product use is unchanged. Proof: `npm run
     test:admin-sizes-selector` (92, fake API, mutation-checked); `test:admin-product-new`, `test:admin-stock-tools`,
     `test:photo-uploader` (its one failing MUTATION check fails identically at the parent commit), `test:admin-buttons`.
     **Deployed 2026-11-18 (owner: "deploy"): `deploy-20261118T110234Z-6e7ed98`, DEPLOY_OK** (undo `compose --rollback` that name;
     `--only sporta-admin-brands.js,sporta-admin-brands.full.js`, one file replaced: `sporta-admin-brands.full.js` 911,990 -> 957,443
     bytes, the loader unchanged, health unchanged; live sha256 re-fetched and equal to the snapshot's `8a950d4c...`). **The live admin
     add-on is now the source of commit `19012c20` (2026-11-14, sha256 `466a89b7...`, 911,990 bytes: the plan's live size and a re-fetched
     hash matched it exactly) PLUS the ADMIN INVOICES block and nothing else. This SUPERSEDES the 2026-11-12 note above (2b22a9a + trim):
     the first snapshot was built on that old base (571,060 bytes) and the PLAN's "live bytes -> release bytes" line (911,990 -> 616,513)
     showed it would have removed ~295 kB of live screens; it was never applied. READ that line before every apply; the tool's 70% shrink
     guard covers PHP, HTML and .htaccess, not JS.** The release was cut with `npm run snapshot:admin-invoices`
     (`scripts/make-admin-snapshot.mjs --preset invoices`: the base is read with `git show 19012c20`, then the named block; the commit that
     holds it is deployed by SHA and reverted on the branch). Not live, still needing the API release: Shipping, Database center, Social,
     Footer, Stock tools, Text styles, Add sizes, CRM phones and the other blocks of the branch's full source.
     The Invoices screen: INVOICES, block ADMIN INVOICES in `sporta-admin-brands.js` (both
     names). An "Invoices" button in the /backends Orders header: a list of one invoice per order (number `INV-` + the order id in six
     digits, read not allocated, so a cancelled or failed order leaves a gap; Kuwait date = UTC+3; search, payment and month filters,
     Load more / Load all, a CSV for the accountant) and an A4 sheet in Arabic (default) or English with the phone and the whole
     address (the public invoice leaves both out), lines, subtotal / discount / delivery / total as the order row holds them, the bank's
     Payment ID and reference, printed through the browser ("Save as PDF", file named for the number). **NO new server route and NO
     migration: it reads the live `orders` and `items` admin routes**, so it needs no API release, but the branch's whole
     `sporta-admin-brands.js` also carries blocks whose routes are not live (Shipping, Database center, Social, Footer, Add sizes),
     so a file-level release needs a trimmed snapshot like the 2026-11-12 scope A, or the API release first. "Check" marks an order whose
     total is not subtotal - discount + delivery (an old order with no stored subtotal is never flagged). A gap-free sequence is an owner
     decision (a table and a rule for when a number is issued), not built. Proof: `npm run test:admin-invoices` (81, fake API,
     mutation-checked), `test:admin-js-audit` (48), `test:admin-loader`.
     **Deployed 2026-11-18 (owner: "fix all", then "yes" to the API release): `deploy-20261118T115230Z-c970fc4`, DEPLOY_OK** (undo
     `compose --rollback` that name; `--only api`, ONE file replaced: `api/xbrl.php` 7,189 -> 17,131 bytes, health unchanged). Gate: independent
     review (first pass NOT READY, two blockers fixed; second pass SHIP), `test:xbrl` 46 + `test:knet-refund` 114 + mutants, and the read-only live
     schema diff (`SCHEMA_DIFF_EXIT=1`, see below). Cut with a snapshot commit (`c970fc4d`, reverted on the branch): `dropin/php-store` = `f42ff575`'s tree +
     the new xbrl.php. **THE LIVE API BASELINE IS NOW `f42ff575`'s `dropin/php-store` (+ xbrl.php of `39269349`)**, not `011ae562`: the first plan
     showed live `store.php` is 197,963 bytes = the corrected picking-list release (`f42ff575`; `011ae562`'s is 197,097), i.e. that snapshot HAD
     been deployed and was not recorded here. Every other api file equals `011ae562`/`dcd2b28b` + the 2026-11-12 Sporta AI files. **Until the migrations of the next
     paragraph ran (2026-11-18 12:16 UTC), the live database did NOT carry `refunds.mysql.sql` or `customers.mysql.sql`** (schema diff: no `order_refunds`, `payment_alerts`, `orders.refunded_amount`,
     `orders.gateway_attempt_ref`, `customer_email_verifications`, `customer_accounts.apple_sub`, `email_verified_at`; the live `orders_payment_status_ck`
     refuses 'refunded'/'voided'). So the live shop books no refund yet: the refund routes, `payment-records.php`, Apple sign-in and e-mail
     verification must wait for those two migrations (own owner-approved step with a backup, then re-run `ops/db/schema-diff.compose.json`; if the
     Hostinger API will not take that 66 kB file inline, a ~1 kB compose that fetches `scripts/db-schema-live-diff.mjs` and `ops/db/expected-schema.json`
     from raw.githubusercontent.com at the pushed commit and runs `--live --config /run/sporta-api-config.php --expected-file /tmp/e.json --markdown
     --exit-line` did the same job in one read). On the live shop this release changes the period cut, the stock date, the fils sums and adds the
     reconciliation line; it reads no refunds (`RefundsRead: false`). Review notes left open: `xbrl_fils` overflows a float of ~9e15 (hand-edited rows only);
     returned goods of a shipped order that come back as a stock `return` adjustment are counted twice; costs are the variant's CURRENT cost;
     a one-day period is refused (`from` < `to`, unchanged).
     **FULL BACKEND RELEASE DEPLOYED 2026-11-18 13:05 UTC (owner: "deploy" / "make publish live", scope "everything pending, behind the gate"):
     `deploy-20261118T130519Z-e7db914`, DEPLOY_OK** (undo `compose --rollback` that name; backup archive `/docker/sporta/backups/deploy-20261118T130519Z-e7db914.tar.gz`).
     `--only .htaccess,api,boot.js,knet,pay,sporta-admin-brands.full.js,sporta-admin-knet.css,sporta-brand-theme.css,sporta-checkout-a11y.css,sporta-features.js,sporta-grid.css,sporta-images.css,sporta-shadows.css --allow-shrink`:
     38 replaced, 7 added, health unchanged before and after. **THE LIVE BASELINE IS NOW COMMIT `e7db9143`** (`git diff e7db9143 HEAD -- sporta-web/dropin` is
     what the next backend release ships; `api/`, `knet/` and `pay/` equal that commit, no snapshot was needed). Gate: three independent reviewers (card
     payment path, store API + cron + customer routes, admin + `.htaccess` + add-ons) all SHIP, no blocker, then 20 suites green on a quiet rig (native 672,
     knet 174, tpay 88, assistant 2,301, assistant-admin 98, install-sql 11, arabic 67, seo 33, contrast 4, areas 18, native-e2e 26, config 32, admin-polish 681,
     addons-brands 141, knet-refund 114, payment-receipt 126, xbrl 46, htaccess-rules 912 checks 0 FAIL, race-money 87, order-cooldown 19; native fails on
     DIFFERENT rate-limit tests when another process shares the rig's 127.0.0.1 counters: run it alone) and the live schema diff `SCHEMA_DIFF_EXIT=0`.
     Facts measured live that day (read-only probes `ops/live-predeploy-probe.mjs`, `live-admin-payload-probe.mjs`, `live-postdeploy-probe.mjs`,
     `live-checkout-probe.mjs`): both gateway configs match the store's database host, name and user (so `store_gateway_db_matches` keeps them);
     14 of 46 active products have no photo file, so **the new no-photo hide rule is OFF by default** (config key `hide_products_without_photo`, exactly
     `true` turns it on; owner chose to keep all 46 listed) and the sandbox config turns it on for the suites; shortest live order number is 15
     characters (the new 10-character rule is safe); the live compiled /backends sends explicit booleans for `active` and `paid` on the toggles, and a
     form save (slide, discount) with no `active` key stays OFF as before. **Card payments are NOT offered on the live checkout and were not before the
     release**: the owner's saved `settings.checkout` has `knet:false, tpay:false, cod:true`, and the gateway readiness check fails identically with the
     old and the new library (KNET `resource_key` is 26 bytes where AES-128 needs exactly 16; T-Pay `client_id` is not set), so `checkout_config` answers
     `["cod"]`. Turning KNET on is an owner step (fix the key, switch it on in /backends -> Payments), not a deploy. `knet_via_cbk` stays off; the
     KNET inquiry in `cron-stock.php` is OFF and must stay off until the owner sets `inquiry_enabled`. Live now that were not: refund and void recording
     (admin routes + `payment-records.php`), second-capture alerts, the KNET receipt fields, Sign in with Apple (OFF until the owner sets the Apple keys),
     customer e-mail verification (birthday gifts go only to verified addresses: every existing account is unverified until it opens a link), the
     Database center, Shipping, text styles, CRM phones, Add sizes, the new order route (guest order numbers of 10+ characters, one order a minute per
     client and phone), the new `cron-stock.php` (live within 15 minutes: check `/var/log/sporta-cron.log`), the invoice now `limited` for the compiled
     storefront (the compiled page sends only the order number), Sporta AI fixes F3/F4/F7/F10 (`SPORTA-AI-SCAN-2026-11-18.md`). Left out on purpose: seven root
     brand files (`logo.png`, `logo-white.webp`, `apple-touch-icon.png`, two maskable favicons, `llms.txt`, `backends-offline.css`). Open from the
     reviews: admin-only 500s on a NUL byte in a date (`knet_reconcile_export`, `xbrl_export`) and on a brand slug over 80 characters; `knet.php`
     residual race on a Payment ID claimed by two orders in the same instant (bank-impossible, caught by the daily KPay check); no T-Pay receipt key;
     the store's gateway-database rule compares host, name AND user, so the `DATABASE-SECURITY.md` step that moves `knet-config` to its own database user
     would hide KNET from checkout: change the rule to host and name only before that step.
     **Migrations applied 2026-11-18 12:16 UTC (owner: "apply the two migrations"): `customers.mysql.sql` then `refunds.mysql.sql`, `MIGRATIONS_OK`.**
     One-shot job `scripts/db-apply-migrations.mjs` (the ONLY write path for those two files: an allow-list of 19 statements, a pre-flight on the
     foreign-key id types, `orders` and `customer_accounts` copied whole and READ BACK before the first write, already-applied statements skipped,
     every object and both row counts verified; `npm run test:db-apply-migrations`, 57 checks on a private MariaDB built from `dcd2b28b`'s install file,
     17 of 18 mutants killed, the survivor equivalent). It ran from commit `f46a9dfd` via a ~1 kB compose that downloads the repo tarball (project
     `sporta-migrate`, deleted after). 11 statements applied, 2 skipped (a re-stated CHECK already final), 6 were already there. Backup:
     `/docker/sporta/backups/manual-20261118T1216Z-refunds-customers-migrations/` (`orders.json` 120 rows, `customer_accounts.json` 1 row, `schema.txt`
     with the old CREATE TABLEs and CHECK, `MANIFEST.txt`; 0600 in a 0700 directory, contains e-mail addresses and password hashes). Added: `order_refunds`,
     `payment_alerts`, `customer_email_verifications`, `orders.refunded_amount`, `orders.gateway_attempt_ref`, `customer_accounts.email_verified_at`,
     `customer_accounts.apple_sub` + `uq_customer_apple_sub`, `customer_email_verifications` index; `orders_payment_status_ck` widened to 'refunded' and
     'voided'. Verified: 120 orders / 1 account before and after; the live schema diff re-run reads `SCHEMA_DIFF_EXIT=0` ("Nothing the code needs is missing",
     customers 37/37, refunds 51/51, one older warning left: `whatsapp_outbox.wa_kind_ck` is wider live than in the repo). The live PHP does not read any of
     it yet: nothing changes for shoppers until the API release that carries `payment-records.php`, the refund routes, Apple sign-in and e-mail
     verification (it also needs the review gate; the `dropin/php-store` of the branch is far ahead of the live baseline, see the git diff of `dcd2b28b`).
     Undo (only if ever needed; the comment at the top of the tool lists it): drop the three new tables, drop the two `orders` columns and the two
     `customer_accounts` columns and index, put the old four-value CHECK back (only while no order is 'refunded' or 'voided').
     Built earlier the same day: `dropin/php-store/xbrl.php` ACCOUNTING-1118. Periods are cut at the
     SHOP's midnight (Asia/Kuwait, UTC+3; the database is UTC) not UTC midnight; revenue and delivery are the orders paid in the period
     (paid, refunded, voided) in full minus the refunds RECORDED in the period (`order_refunds.created_at`), so a closed month does not
     change when a later refund lands; an order that ended refunded or voided has its cost reversed on the closing refund's day;
     Inventories is stock NOW and says so (`InventoriesAsOf`, and the XML instant is that day, not the period end); money is summed in whole
     fils; the export carries `AmountReceived`, `RefundsRecorded`, `CostReversed` and `ReconciliationDifference` (non-zero = an order whose
     total is not subtotal - discount + delivery). Not fixable in code: dated expenses (A5) and the registration number (A8). API release,
     review gate; `npm run test:xbrl` (46), `test:knet-refund` (114), `test:knet-mutants -- P2-M12`. See `ACCOUNTING-SCAN-2026-11-18.md`.
     **Deployed 2026-11-18 16:41 UTC (owner: "make deploy"): `deploy-20261118T164133Z-3aa05cc`, DEPLOY_OK** (undo `compose --rollback` that
     name; `--only sporta-features.js,sporta-shadows.css,sporta-product-fix.css,sporta-ui-colours.css,sporta-admin-brands.js,
     sporta-admin-brands.full.js`, 5 replaced, 0 added, health unchanged; the plan's live -> release bytes showed no shrink: full.js
     1,097,630 -> 1,212,632). **The live add-on files are now commit `3aa05cc2`'s** (the loader `sporta-admin-brands.js` was already equal).
     Read-only live check after the apply (fetch job on the VPS): the five served files equal the release byte for byte (sizes) and carry
     their markers; `/shop` links all four storefront add-ons; the loader names the full file. Contents: PRICES-1118 (percent-off badge,
     "You save" line, bag line total and original price, Original total / You save rows), LIVE STOCK-1118 (a size sold out since the page loaded
     is struck and cannot be added: one `?r=stock` read on a size tap, Add and tab return), BAG-LINK-1118 (a product already in the bag gets
     "View bag", and a disabled Buy now is hidden), PRODUCT BRAND-1118 (the plate's real brand replaces the shop's own "SPORTA / MADE FOR YOUR NEXT
     MOVE" line and the Sporta logo; no brand tag = no brand line; JSON-LD `brand` is the real brand or dropped), the "Sold out" band words white
     (MONO-1112 list gained `[class*="bg-ink"]`), and the admin blocks ADMIN PRICE TOOLS (Catalogue -> Prices: sale percent, raise/lower by an
     amount, undo, CSV; "% off" box in the product editor and the New product form) and ADMIN GOOGLE SETUP (Settings -> Google setup: read-only
     index and Business Profile guide). Prices use the existing `products_all` and `product_save` routes: no API release, no migration. Gate: 31
     suites green on the rig (add-to-cart-ux 194, addons-brands 141, words-colours 355, product-layout 98, bag-link 17, live-stock 18,
     product-brand 24, prices 65, admin-price-tools 120, admin-google-setup 62, admin-product-new 198, admin-sizes-selector 92, admin-invoices 87,
     admin-suggested-prices 39, admin-stock-tools 85, admin-js-audit 48, admin-loader, and the lanes A-E). `admin-invoices` failed one
     check ("nothing matches") twice: a test race (the block hides the hint while the search is read), fixed in the test only (`8d8030c9`).
     NOT yet seen in a real phone browser on a live product page: run `scripts/live-add-to-cart-probe.mjs` and `scripts/live-product-audit.mjs`.
     Scans written the same day, findings NOT fixed (owner decides): `BRAND-LAYOUT-SCAN` (BL-01 brand banner text 1.00:1 on light theme),
     `PRODUCT-VALUES-SCAN` (14 products carry placeholder stock 10 x 8 sizes; 28 products priced differently by colour), `INVOICE-DESIGN-SCAN`,
     `PRODUCTS-GRID-SCAN`, `XSS-SCAN`, `FRONTEND-SECRETS-SCAN`.
     **Built 2026-11-18, DEPLOYED 2026-11-19 (see "Deployed 2026-11-19" below; owner: "make dynamic catalogue for all current products ... pdf file with downloadable link at
     backends ... and make page called catalogue at main menu with link updated live"; the owner chose a PUBLIC page and a PDF built IN THE
     BROWSER): CATALOGUE-1118.** (1) `public/sporta-catalogue.js` (NEW, not linked by the live index.html: a script a script adds is allowed by
     CSP `script-src 'self'`, like `sporta-admin-brands.full.js`): the engine. It reads only the shop's PUBLIC routes (`r=products`, `r=stock`,
     `r=brands`; sizes by `in_stock`, never a quantity, SKU or cost), orders the products (men, women, hoodies and jackets, accessories, any other
     category; featured first), resolves photos (`images[0]`/`image` of the API, else `<slug>.jpg|png|webp|jpeg` under `/images/products/`, the
     640px WebP when `variants.txt` lists one), draws every A4 page on a canvas with the shop's own fonts (`/fonts/`: Alexandria, IBM Plex Arabic) so
     Arabic is shaped by the browser, and writes a PDF 1.4 itself (no library): one JPEG per page, one link per product to its page on
     www.sporta.com.kw (`?lang=en` in English), cover with contents, nine products a page per category, about 2-4 MB. Text is part of the picture
     (not selectable: the trade-off of the owner's choice). Photos are fetched, drawn and released nine at a time. It also draws the page and the
     `/catalogue?pdf=ar|en` live link (builds and downloads by itself). (2) `sporta-features.js` block CATALOGUE-1118: a sixth tab "Catalogue /
     الكتالوج" after Shop (inserted in the MutationObserver callback, no layout shift; `sporta-bag-touch.css` [menu-3] lays the phone row out as five
     columns, so the block adds a six-column rule; measured one row at 360-390 px, scrolling inside the row at 320), and on `/catalogue` it hides the
     app's "Page not found" section (a marker on `<main>` + one CSS rule: nothing of the app's tree is edited), adds `<div id="sporta-catalogue">`,
     loads the engine on demand and sets title, description, robots index, canonical, alternates; leaving the path removes all of it. (3)
     `sporta-admin-brands.js` block ADMIN CATALOGUE PDF: a "Catalogue PDF" button in the Catalogue screen header, a dialog (live count, on sale, sold
     out; language; Download with progress; "Download again"; the page address and the two live PDF links with Copy). Read only. (4) ROUTE: `.htaccess`
     lists `catalogue` in both fixed-route rules and `sporta-catalogue.js` in the no-cache add-on list (without it the engine would be cached a year);
     `dropin/php-store/seo-page.php` gets `/catalogue` in its page table (title, description, canonical, alternates, indexable for a crawler before
     any script runs). **`.htaccess` and `seo-page.php` MUST SHIP TOGETHER: the `.htaccess` sends `/catalogue` to seo-page.php, and the OLD one answers
     an unknown path with a 404 status.** The API tree has no other change since the live baseline `e7db9143`, so the API part is that one file. No
     migration, no new server route. Release scope: `--only .htaccess,api,sporta-catalogue.js,sporta-features.js,sporta-admin-brands.js,
     sporta-admin-brands.full.js` (the plan's live -> release line must show no shrink). Not done: `/catalogue` is not in the sitemaps (they belong to
     the foreign storefront build and are not part of a deploy); 14 of 46 products have no photo file so their cards (and PDF cards) show "photo
     coming soon"; the 5 heavy PNG originals are fetched in full for the PDF until `make-image-variants.mjs` has made the 640px copies. Proof:
     `npm run test:catalogue-pdf` (85: data, PDF structure with poppler, pixels of the cards, RTL, 8 mutants), `test:catalogue-page` (188: the real
     compiled storefront, 5 widths x 2 languages, live updates, filters, downloads, leaving, 4 mutants), `test:admin-catalogue-pdf` (36, 4 mutants),
     `test:catalogue-seo` (32), `test:htaccess-rules` (917, 0 FAIL), `test:file-names` and `test:unknown-files` (the same failures as before the
     change, none new), `test:admin-js-audit` 48, `test:admin-loader`.
     **Built 2026-11-18, DEPLOYED 2026-11-19 (see "Deployed 2026-11-19" below; owner: "use ajax for all backends"): ADMIN LIVE DATA** (last block of `sporta-admin-brands.js`, both names;
     NO API change, NO migration). Measured on the compiled admin: a screen reads ONCE (the first time it opens) and stays mounted hidden, so coming
     back shows old data; only a Refresh button (Orders, Inventory, Activity, CRM, Returns) or a reload updates it; every sidebar button puts its screen
     in the address (`/backends?tab=orders`), so a reload reopens the same screen. The block wraps `fetch` (records each admin GET per screen with a
     signature, volatile keys like `now` left out), polls the CURRENT screen's reads every 30 s with the original fetch (GET only, at most four, never
     session / payment / gateway / export / assistant / image / stock routes), and on a change presses the screen's own Refresh button or reloads the page
     in place (at most twice in ten minutes). By itself ONLY on list screens (Overview, Orders, Abandoned orders, Returns, CRM, Support, Activity,
     Catalogue) and only when nothing is being edited: no focused field, no dialog, fewer than three typed boxes (dates, drop-downs and search boxes are
     filters, not edits; Orders' KNET export has two dates and two selects), nothing touched for 15 s. Editor screens get a "New data" chip with a button.
     A chip at the bottom corner (Live / Paused / offline, Pause kept in `localStorage.sporta_admin_live`). Bugs the suite found and fixed: a waiting
     change counted as churn on every poll (the read was then given up as "volatile"), and the post-Refresh adoption swallowed a change that landed in its
     window (it now adopts the value the poll had found). Proof: `npm run test:admin-live-data` (56, the real compiled admin, 6 mutants each green on
     the real file and red with the rule cut), `test:admin-js-audit` (49, nine timers now: the live tick sleeps hidden/paused/busy).
     **Built 2026-11-18, DEPLOYED 2026-11-19 (see "Deployed 2026-11-19" below; owner: "make auto hide any products without price 0 and sku and name and image"): AUTO-HIDE.**
     `dropin/php-store/product-listable.php`: a product is LISTED only with a name (en or ar), a price above zero, at least one size row with a SKU
     (`product_variants`) and a photo (image / images column or a file named after the slug). Name and price have no switch; the SKU and photo rules are
     **ON unless the config says exactly `false`** for `hide_products_without_sku` / `hide_products_without_photo` (a typo, "false", 0 or a missing key
     keeps them ON). **THIS REVERSES the morning's decision (photo rule OFF by default, owner kept all 46 listed): at the next API release the 14 live
     products with no photo file leave the shop (list, brand tiles, public stock, assistant, product page 404, sitemap) unless
     `'hide_products_without_photo' => false` is put in the live `api/config.php` first. Tell the owner before the release.** The live catalogue gives
     every accessory a size ONE, so the SKU rule hides nothing there today (scan 2026-11-18). One call for every reader: `store_filter_listable()` /
     `store_listable_slugs()` (api.php products, brands count, stock; assistant.php; seo-page.php product head; sitemap-products.php). The order path
     refuses a nameless or price-0 product named by hand (`unavailable_<slug>`); a missing photo or SKU hides the card only. `admin.php?r=products_all`
     rows carry `hidden_reasons` and `listed`; the /backends Catalogue screen shows a band "N active products are hidden from the shop because
     something is missing" with a "See which" list (block ADMIN HIDDEN PRODUCTS: it only LISTENS to the screen's own products_all read, one fallback read
     4 s in if it was missed; needs the API release to show anything). The rig's config sets the SKU switch to false (the seed's sizeless accessories) and
     the photo switch to true (`scripts/sandbox.sh`). Proof: `npm run test:product-listing` (50, SQLite), `test:admin-hidden-products` (34, 4 mutants),
     `test:native` (the defaults block + an end-to-end SKU proof). Not an owner decision yet: dated cleanup of the 14 photo-less products.
     **Built 2026-11-18, DEPLOYED 2026-11-19 except robots.txt (see "Deployed 2026-11-19" below; owner: "fix sitemap robot"): SITEMAP-1118.** First a read-only live check from the VPS
     (`scripts/sitemap-check.mjs`, `scripts/robots-check.mjs`, 200 + 27 requests): the live sitemaps and robots.txt were HEALTHY (index 200 with two children,
     110 URLs all 200 with canonical + hreflang, no URL blocked by robots.txt; live robots.txt equals the repo's rules, only its comments differ). What was
     wrong is in the PHP and in two small corners. API release (`sitemap-products.php`, `sitemap-index.php`, `seo-runtime.php`; no migration), one file
     group, with the listing release above: (1) only slugs the page router can answer (`[A-Za-z0-9][A-Za-z0-9_-]{0,79}`) are listed (a listed 404 is a
     broken promise); (2) `/catalogue` + `/catalogue?lang=en` are listed first, dated by the newest product (so the page needs no static-file change; the static
     `sitemap-pages.xml` is the foreign build's and still lacks `/support`, which the live file has: never ship the repo's over the live one); (3) no `<lastmod>`
     later than today, in the products file and in the index; (4) ETag + 304 on both PHP sitemaps (mod_deflate `-gzip` / `W/` stripped, the same rule as
     seo-page.php); (5) photos named by `products.image` / `products.images` are listed first (only a same-origin picture path whose file exists), then the
     files named after the slug; (6) nothing to list is a 503 + `Retry-After` + no-store with no body, never a 200 with an empty `<urlset>`. `public/robots.txt`
     gains a group for `AdsBot-Google` and `AdsBot-Google-Mobile` (they ignore the `*` group; they were told nothing about `/backends`, `/knet/`, `/pay/`,
     `/api/`). robots.txt is a static file of the foreign build: it changes the live site only if shipped file-level (`--only robots.txt`, the owner's yes).
     Left as they were (GAPs of the suite, by design or irrelevant at 46 products): no chunking above 25,000 products; the shipped static file answers 200
     when the database is down; `/support` and `/catalogue` have no `<Route>` in this repo's own storefront. Proof: `npm run test:sitemap-check` 121 ok / 0
     FAIL / 4 GAP (was 10 GAP; five mutation checks, each red with its rule cut). `test:links` already fails at HEAD (a `<picture>` assertion, not this).
     **Built 2026-11-18, DEPLOYED 2026-11-19 (see "Deployed 2026-11-19" below; owner: "make fav icon chenger atteched to seo and database"): SITE ICON.** /backends -> SEO has a card under its header:
     the owner picks a square picture, the browser draws three PNGs (32 tab, 180 apple-touch on white, 192 large), shows them, and POST `site_icon_save` stores
     them in FOUR `settings` rows (`site_icon` meta written last + `site_icon_32/180/192`; NO migration; `dropin/php-store/site-icon.php`, required by `store.php`;
     each row at most 60,000 base64 characters because `settings.value` is TEXT; PNG only, the header must say that exact size, IEND present). Public picture
     `api.php?r=site_icon&s=32|180|192&v=<12 hex>` (one-year immutable cache; **`dropin/php-store/.htaccess` lists `site_icon` beside `slide_image|brand_logo` or
     the cache header is overwritten with no-store: it ships with the API**; a stale `v`, another size or no custom icon is a 404 no-store). `seo-page.php` swaps the
     shell's `<link rel="icon">` x2 and `apple-touch-icon` for them on every page it renders (the head crawlers read); `?r=content` carries `site_icon: {v, urls}`
     and the SITE CONTENT block of `sporta-features.js` (`applyIcon`) points the links of the pages the renderer does not serve (cart, checkout, account) at it from
     the kept copy at once and from the fresh answer, puts the shell's links back when the owner resets, makes links the shell lacks and removes them again.
     `site_icon_save` / `site_icon_reset` are admin-only, JSON-only, in the activity log. Admin card = block ADMIN SITE ICON in `sporta-admin-brands.js` (both names; one
     more 500 ms entry check: `test:admin-js-audit` now expects ten timers / seven entry checks; `site_icon` is in the LIVE DATA deny list so a save does not raise
     its own "new data" chip). Not touched: `favicon.ico`, `site.webmanifest` and the maskable PNGs are static files of the foreign build and keep the shop's icon.
     Release: API (`site-icon.php`, `store.php`, `admin.php`, `api.php`, `seo-page.php`, `.htaccess` of api) + `sporta-features.js` + both brands names. Proof:
     `npm run test:site-icon` (69, real PHP + MariaDB, pages through the real seo-page.php), `test:admin-site-icon` (59, mutation-checked),
     `test:site-icon-storefront` (27, mutation-checked). `test:site-content` already fails at HEAD (90 ok, 1 FAIL "page.click" timeout: not this).
     **Built 2026-11-18, DEPLOYED 2026-11-19 (see "Deployed 2026-11-19" below; owner: "improve crm about interset" - read as "interests"): CRM INTERESTS.** What each CRM contact is interested in is worked out
     from what they ordered: `crm.php` `crm_interests_map` (one query over orders -> order_items -> products, folded onto the same contact keys; units, not orders;
     NOT cancelled-by-the-shop, failed or voided orders; a refunded one and an unpaid cash order DO count), NO table, NO column, nothing stored, nothing written by
     reading. `crm_list` rows carry `interest_labels` (top two categories + top two brands), the search box now matches interest words in English AND Arabic
     (category Arabic names are a small map in crm.php, brands use their own `name_ar`), `summary.top_interests` counts contacts per category/brand over the contacts that
     match the filters; `crm_detail` carries `contact.interests` (categories with share, brands, sizes, price min/max/avg, first/last order) and
     `suggested_tags` (valid under the tag rule, not already on the contact; NEVER saved by this: the tag buttons only fill the compiled Tags box and the screen's own
     "Save contact" saves). Admin = block ADMIN CRM INTERESTS in `sporta-admin-brands.js` (both names): it LISTENS to the compiled screen's own `crm_list` / `crm_detail`
     reads (no request of its own, no timer, no observer) and adds chips under each contact (table: buttons that fill the search box; phone card: plain labels), a
     "What your customers want" band under the stat tiles (click = search that word, click again = clear) and an Interests card in the contact page. A row is matched
     to its contact by name AND phone/e-mail as shown; ambiguous or unmatched rows stay plain. Proven on the REAL compiled CRM chunk of the live capture (the capture
     lacks `CRM-jXkTnqHo.css`; an empty stand-in is served). Proof: `npm run test:crm-interests` (33, real PHP + MariaDB), `test:admin-crm-interests` (57,
     mutation-checked). Release: API (`crm.php`) + both brands names.
     **Deployed 2026-11-19 00:01 UTC (owner: "deploy"): `deploy-20261119T000155Z-eb97a4b`, DEPLOY_OK** (undo `compose --rollback` that
     name; backup `/docker/sporta/backups/deploy-20261119T000155Z-eb97a4b` holds the 15 replaced files; `--only .htaccess,api,
     sporta-catalogue.js,sporta-features.js,sporta-admin-brands.js,sporta-admin-brands.full.js`, 15 replaced + 2 added (`api/site-icon.php`,
     `sporta-catalogue.js`), no file shrank, health unchanged). **THE LIVE API BASELINE IS NOW COMMIT `eb97a4bd`'s `dropin/php-store`** (the
     previous one was `e7db9143`) and **the live add-on files `sporta-features.js`, `sporta-catalogue.js`, `sporta-admin-brands.full.js` (the
     loader was unchanged) are `eb97a4bd`'s**. Gate: live schema diff `SCHEMA_DIFF_EXIT=0` (no migration in this release), 13 suites green on the
     rig at the parent commit, independent review VERDICT SHIP (no blocker); its two minors were fixed in `eb97a4bd` (the LIVE DATA auto-refresh now
     also waits while a photo-uploader row is not `done`; a site icon whose JSON-escaped stored form is over the 64 KB column is refused
     `site_icon_too_large`: `test:site-icon` 71, `test:admin-live-data` 83, each mutation-checked). Contents: CATALOGUE-1118, ADMIN LIVE DATA,
     AUTO-HIDE, SITEMAP-1118 (PHP part), SITE ICON, CRM INTERESTS, as described above. Read-only live probe afterwards (a fetch job on the VPS,
     deleted): `/catalogue` 200 in both languages (title, `index, follow`, canonical `https://www.sporta.com.kw/catalogue`), `/catalogue?pdf=ar`
     200; `sitemap-products.xml` 200 with `/catalogue` and `/catalogue?lang=en` first, 66 locations (32 products x 2 languages + 2) and 70 image
     entries, ETag + 304 on a repeat; `?r=site_icon` with no custom icon 404 `no-store`; `?r=content` carries `site_icon: null`; the rendered head
     keeps the shell's three icon links; the served add-on files carry the release's byte sizes (features 242,290; full.js 1,317,018) and their
     markers; admin routes answer 401 with no session; `/`, `/shop`, `/cart`, `/checkout`, `/about`, `/backends`, `/robots.txt` 200.
     **AUTO-HIDE IS LIVE AND TOOK EFFECT AT ONCE: the products API went 46 -> 32.** The 14 products with no photo file left the shop (list,
     brand tiles, public stock, assistant, product page, sitemap); the deploy tool's own "products 46" in its after-health line was read inside
     the first seconds and is not the settled number. To list them again put `'hide_products_without_photo' => false` in the live `api/config.php`
     (the store config on the VPS is `/docker/sporta/private/api-config.php`), or give them a photo in /backends -> Catalogue (the Catalogue
     screen's band lists them with "See which"). Not shipped: `public/robots.txt` (static file of the foreign build; the AdsBot group needs
     `--only robots.txt` and the owner's yes). Left open: `api/site-icon.php` and `api/product-listable.php` answer 200 with an empty body when
     requested directly (they only define functions; add both names to the `FilesMatch` deny list of `dropin/php-store/.htaccess` at the next
     API release); `/catalogue` is in the products sitemap but not in the static `sitemap-pages.xml`; real-phone-browser look at `/catalogue`
     and the new admin screens not yet done (run `scripts/live-add-to-cart-probe.mjs` style probes).
     **Built 2026-11-19, DEPLOYED 2026-11-19 (see "Deployed 2026-11-19 05:33" below; owner: "check all icons / improve cards style at products grids"):** (1) ICONS CHECK
     (`ICONS-SCAN-2026-11-19.md`): 581 svgs on 16 storefront pages x 390 / 1280 px, 545 set icons, every icon-only control named and 44 px, no
     defect; `test:iconset` 7,683, `test:admin-iconset` 7,113, `test:icons-polish` 1,826, `test:icons-1118` 10, `test:ai-icon` all green. Harness
     note: the old 2026-11-03 capture lacks `Account-*.css` / `Returns-*.css`, so those two pages read "could not load" in it unless an empty
     stand-in is served (not a site defect). (2) PRODUCT CARDS 1119: `sporta-shadows.css` section `PRODUCT CARDS 1119` (`[pc-1]`..`[pc-7]`, placed
     after CARDS-1118 and before ICON COLOUR 1118) + `sporta-features.js` PRICES-1118: the "-N%" sale tag of a grid card moves from the price
     row to the photo frame's bottom-start corner (an absolute child of `.catalog-card-image`; `direction: ltr` with the corner chosen by
     `:root[dir]`, because a logical inset follows the element's own direction; none on a sold-out card; the product page and the bag keep it
     beside the price), a phone's prices start at one height per row, the Save heart is visible at rest, a sold-out price is grey, the struck
     price is 13 px / 1 px line, the Bestseller pill clips at 320 px, dark-theme prices. Fixes PRODUCTS-GRID-SCAN G-04, G-07, G-09, G-10, G-12,
     G-16 (see its "Status, 2026-11-19"). Proof: `npm run test:cards-1119` (109, real compiled storefront, mutation-checked);
     `test:price-style` now picks an in-stock card (a sold-out card's price is grey on purpose). Ships with `sporta-shadows.css` +
     `sporta-features.js` (no API, no migration).
     **Built 2026-11-19, DEPLOYED 2026-11-19 (see "Deployed 2026-11-19 05:33" below; owner: "make products page only one shape and center name / make magic zoom / improve slider change feel / fix
     sporta ai / scan cart"):** all add-on files, no API, no migration. (1) PRODUCT SHAPE 1119 (`sporta-product-fix.css`, `[ps-1..4]` + the pill
     and sheet radii edited in place): the product page is ONE silhouette, the rounded rectangle of the shop (16px card or sheet, 12px control, 8px chip, 4px
     small dot, 2px bar): the pill Buy now / view-bag link, the colour swatches, the wishlist heart and the lightbox close are 12px, the dots 8 / 4px, the
     "!" mark 6px, the sheet 16px, the "-N%" tag everywhere is the 8px chip; the title is centred on the COLUMN (the heart is out of the flow at the end
     corner, the title keeps equal padding): `npm run test:product-shape-1119` (48); `test:add-to-cart-ux` now asserts the control corners, not a pill.
     (2) MAGIC ZOOM-1119 (`sporta-features.js` last-but-two block + `sporta-product-fix.css` MAGIC ZOOM 1119): a mouse gets a high-resolution lens in
     the photo stage (the photo's original file at 2.5x, glides to the pointer over ~80 ms, fades, the build's blurry 2.5x scale switched off while it is drawn,
     original fetched after 140 ms of rest, none on touch / the plate / `/backends`, reduced motion = instant); touch keeps the existing VIEWER-1112 lightbox:
     `npm run test:magic-zoom` (49, real pixels read from screenshots). (3) HERO FEEL 1119 (`sporta-home-trim.css` `[hf-1..4]` + `sporta-features.js`
     HERO FEEL-1119): the slider moves 800 ms in-out (was ease-out 700), the arriving slide's copy rises after the photo lands, the photo settles from 1.06x
     (a `data-sporta-arrive` mark, never at page load), dots 500 ms; the track FOLLOWS a finger (resistance 0.35 past the ends, the build still decides the
     slide with its own 48px rule) and a jump of 2+ slides (a far dot, last to first) is a 480 ms dissolve instead of flying across the slides in between:
     `npm run test:hero-feel` (62). (4) AI PANEL 1119 (`sporta-ui-colours.css`, `[ai-1..2]`): **a defect that is live today**: the Sporta AI panel is drawn
     inside `header.app-header`, MONO-1112 rule 2 painted all its text white, so the greeting, the four question chips, the microphone and the typed text
     were white on the panel's white body (1.0:1: empty bubble and empty ovals); the body is ink again, the close button and microphone are 44px line icons
     (masks) instead of text glyphs (`✕`, an emoji): `npm run test:ai-panel` (36, the real panel, ar + en, 390 / 1280). The scan's other open AI findings
     (F1, F2, F6 model-on; F5 fixed answers ignoring the owner's returns days and contacts; F8, F9 voice) are unchanged. (5) CART SCAN
     (`CART-SCAN-2026-11-19.md`): two defects of PRICES-1118, **live today**: the bag page's "Original total" / "You save" were DOUBLED whenever a line was on
     sale (the closed drawer's copy of every line was counted too), and a line of 2+ pieces showed its total twice and pushed the remove button to its own
     row; both fixed in `sporta-features.js` (`test:prices-1118` 71, with a real-compiled-page check). Because the AI panel and the bag summary are wrong on
     the live site, a release of `sporta-ui-colours.css` + `sporta-features.js` is worth doing soon (add-on files only; the rest of this paragraph and the
     two before it ride with them: `sporta-shadows.css`, `sporta-product-fix.css`, `sporta-home-trim.css`). Pre-existing, not from these changes:
     `test:grid` (3 fails), `test:storefront-polish` (8), `test:mobile-1112*` (block order).
     **Deployed 2026-11-19 05:33 UTC (owner: "deploy"): `deploy-20261119T053329Z-bfa628e`, DEPLOY_OK** (undo `compose --rollback` that name; `--only
     sporta-features.js,sporta-shadows.css,sporta-product-fix.css,sporta-ui-colours.css,sporta-home-trim.css`, 5 replaced, 0 added, health identical before and
     after: `/` `/shop` `/checkout` `/backends` 200, products API 32). **The live add-on files are now commit `bfa628e1`'s** (the five above; every other add-on is
     `3aa05cc2`'s / `eb97a4bd`'s as before; the API baseline stays `eb97a4bd`). The plan's live -> release bytes showed no shrink (features 242,290 -> 259,787,
     home-trim 8,267 -> 11,273, product-fix 42,749 -> 46,949, shadows 124,526 -> 128,928, ui-colours 22,380 -> 25,430) and the live bytes were exactly the baseline
     commit's, so the release carried exactly `git diff eb97a4bd bfa628e1 -- sporta-web/public`. Contents: PRODUCT CARDS 1119 (sale tag on the photo corner, prices
     level, heart visible at rest, grey sold-out price), PRODUCT SHAPE 1119 (one silhouette, centred title), MAGIC ZOOM 1119 (mouse lens), HERO FEEL 1119 (slider
     motion, finger follow, far-dot dissolve), AI PANEL 1119 (**fixes the live white-on-white Sporta AI panel**, 44 px close and mic icons) and the CART fixes (**the
     bag page's doubled "Original total / You save" and the duplicate line total**). Gate: the suites of those sections green on the rig (cards-1119 109,
     product-shape-1119 48, magic-zoom 49, hero-feel 62, ai-panel 36, prices-1118 71, price-style 91, add-to-cart-ux 194, words-colours 355, colours-1118 15,
     center-text 133, home-features 242, images-backdrop 337, shape-1111 14,944, product-brand 24, images-viewer 669) and the 13-suite check-in (4,258 ok, 0 FAIL,
     twice); the known pre-existing failures are unchanged (`test:mobile-1112*` block order, `test:grid`, `test:storefront-polish`). **The Hostinger connector
     `hostinger-vps` timed out at session start (the script itself starts fine by hand), so this deploy went through the session's `rosa` Hostinger connector: the
     same API and the same VM 2058651 (checked with a read-only `vps_docker_list` first), the same `vps-deploy.mjs` job, plan then apply.** Read-only live check
     afterwards (a fetch job, deleted): all five served files equal the release by size and sha256 and carry their section markers, `/`, `/shop`, `/shop?lang=en`
     and `/cart` link all five, `Cache-Control: no-cache, must-revalidate`, products API 32. NOT yet seen in a real phone browser on the live site (run
     `scripts/live-add-to-cart-probe.mjs`, `scripts/live-product-audit.mjs`; the AI panel and the bag summary are the two to look at).
     **Scanned 2026-11-19, read-only, nothing changed live (owner: "scan all invetory table / scan images uouder"):** `INVENTORY-SCAN-2026-11-19.md` and
     `IMAGES-UPLOADER-SCAN-2026-11-19.md` (live jobs `scripts/inventory-live-scan.mjs` 26 SELECTs, `images-live-scan.mjs`, `photo-uploader-live-check.mjs`;
     each is a one-shot compose that downloads the repo tarball at a pushed commit, media mounted `:ro`, DB session READ ONLY; the projects are deleted).
     Facts to keep: the inventory structure is clean (172 variants, 2 ledger rows, no duplicate/orphan/negative), but **1,120 of 1,237 units are 14 products
     at exactly 10 per size (4 of them on sale: cagliari-calcio-sweatshirt-navy, sgomma-t-shirt-navy, tekno-shorts-black, vanquish-tank-navy)**, 128 of 172
     sizes have no cost, the ledger has no count/receive row, and 119 of 120 orders have no line rows. **Defect found, not fixed: `variants_create` and the sizes
     selector accept XS / numeric sizes but the order path accepts only the nine in `STORE_SIZES` (proved on the rig: `invalid_size`)**; no live row is outside the
     nine yet. Photos: 36 files, no GPS, none over 1 MB, 138 macOS `._*` stubs (harmless, 403 and skipped by the variants tool), 14 active products with no photo
     file (hidden). Upload route measured on a copy: all limits hold, **but a 900-megapixel PNG (109 kB) is accepted (no pixel cap)**, and an upload gets no
     small copies (full size on every card until `make-image-variants.mjs` runs). The route has never been used live (no file with its random suffix). Tool fixes:
     the images scan knows `-800.webp`; `photo-uploader-live-check.mjs` follows chunk names to the end (it stopped one hop short and falsely reported the
     Catalogue headers absent; live: 49 of 49 chunks, the panel can find the screen). Check-in the same day: native failed one rate-limit check in a
     batch run beside other suites and passed 682/0 alone (as noted: run it alone).
     **Deployed 2026-11-19, owner: "update live" then "fix them" (three small releases, each plan -> apply -> read-only check, undo = `compose --rollback` the name):**
     (1) `deploy-20261119T055353Z-ab82418`: `robots.txt` alone (2,841 -> 3,514 bytes: the AdsBot-Google / AdsBot-Google-Mobile group, which ignore the `*` group).
     (2) `deploy-20261119T055838Z-de5c7f1`: `llms.txt` alone (9,423 -> 9,429): the live file had the careful wording ("payment methods are shown at checkout",
     "within 24 hours · KWD 1 delivery", "returns within 14 days subject to the published policy") but `scripts/generate-seo.mjs` still wrote "checkout is via KNET",
     "same-day delivery" and "free exchange/return", so shipping the generated file would have made it worse; the generator now says what the live file says and
     carries the owner's brand list (ATE out, AHED and NBA in). The catalogue part still lists all 46 products (14 of them are hidden from the shop: dead links for
     an AI crawler; the generator does not know about photos). (3) `deploy-20261119T060144Z-269a373` (API release, gate: independent review SHIP, sizes-selector 102,
     variants-create 34, product-new 199, stock-tools 85, js-audit 50, inventory-price 26, save-smoke 6, loader, photo-uploader, native 682/0, live sizes re-read
     first): `api/admin.php` 189,060 -> 189,845 and `sporta-admin-brands.full.js` 1,317,018 -> 1,317,854. **`variants_create` only takes the nine sizes
     S M L XL 2XL 3XL 4XL 5XL ONE (INVENTORY-SCAN INV-02: XS and numeric sizes were created and then refused at checkout); the sizes picker offers only those (quick sets:
     Clothes S-2XL, Clothes S-5XL, One size) and folds xxl/xxxl.** The live API baseline for `api/` is now commit `269a3737` (only `admin.php` differs from
     `eb97a4bd`), the live add-on `sporta-admin-brands.full.js` is `269a3737`'s. Review notes left: ONE can be mixed with other sizes on one product (not a regression;
     the storefront's ladder behaviour is not checked); a "No sizes" product and a ONE-row product both exist.
     **Held back on purpose, owner decision needed:** the seven root brand files (ee733597, "smaller logos"): `logo.png` is halved to 400 px wide and `logo-white.webp`
     cut to 450 px (a measured RMSE of 4.9% / 3.4% against the live ones, so a softer logo on a high-DPI phone: the owner asked for the max-resolution pass in July),
     `apple-touch-icon.png` is a different opaque design (RMSE 83% on white), `backends-offline.css` is a "WIP do not deploy" snapshot. The 14 products with no photo
     file: no photo for them was found in Dropbox by name (the old-shop folders are named by product code); each needs a real photo or the owner's confirmation of a match.
     The hostinger-vps connector timed out at session start on 2026-11-19 (it starts fine by hand); these deploys went through the session's `rosa` Hostinger
     connector, the same API and VM 2058651 (a read-only `vps_docker_list` first).
     **Built 2026-11-19, NOT deployed (owner: "remove zoon icon at images"): NO ZOOM BADGE 1119** in `sporta-product-fix.css` (own section, after MAGIC ZOOM 1119).
     The compiled build draws a 40px white tile with a magnifier (`span.catalog-gallery-zoom`, aria-hidden, no pointer event) in the end-bottom corner of the
     product photo; it is now `display: none !important` (nothing painted, no box, nothing to tab to). The photo is still the control: cursor zoom-in, a tap or
     click opens the full-screen viewer, the mouse lens still follows the pointer; the viewer's own -, level, + bar is a working control and is untouched. The repo
     storefront's `src/components/ProductGallery.jsx` lost its "⤢" glyph the same way. Ships with `sporta-product-fix.css` alone (one-file add-on release, no API,
     no migration; the live file is the repo's `bfa628e1` version, so the plan's bytes should differ by this section only). Proof: `npm run test:no-zoom-badge`
     (30, the real compiled product page, ar + en, 390 / 1280 px, two mutants red); `test:images-viewer` 669, `test:magic-zoom` 49, `test:product-shape-1119` 48
     green; the other neighbouring suites are listed in the commit that follows if they were run. Not yet seen on the live site.
     **Built 2026-11-19, NOT deployed (owner: "make zoom full image view pro"): VIEWER PRO / PRO-1119.** The full-screen product photo viewer
     (the IMAGE VIEWER block of `sporta-features.js` + the new section VIEWER PRO 1119 of `sporta-shadows.css`, right after VIEWER-1112; ships as
     BOTH files, no API, no migration) already had zoom, pinch, wheel, pan, swipe, previous / next and the zoom bar; it now has: (1) a FILMSTRIP of the
     product's photos along the bottom (several photos only): clones of the page's own small thumbnails (no src written, no new file), 3.5rem (44px
     floor), current one ringed in the logo orange #FF7B17 + `aria-current`, a tap goes there through the PAGE's own thumbnail button (so React keeps the
     index; the lightbox shows the same one), fades away and leaves the tab order while zoomed; the photo is given room above and below it (SYMMETRIC, so
     the block's zoom maths still centres on the box) and the counter moves up beside the buttons; a short screen (max-height 559px) gives no room and
     the thumbnails are 2.75rem. (2) A STAND-IN: while the full-size original downloads, the small copy the page's stage already shows (only one that
     has finished loading, same origin) is painted behind the spinner as a CSS variable background; the original replaces it in place. (3) A FLING: a
     pan released with speed glides on (325 ms time constant), stops at the edge, is caught by a touch / click, none with reduced motion. (4) KEYS:
     zoomed, the arrow keys move the photo (Shift: 240px) so a keyboard user can reach all of it (the other photos: Home / End, the buttons, the strip,
     or 0 then an arrow); Home / End go to the first / last photo; a trackpad pinch (ctrl + wheel) zooms in fine steps and a line-mode wheel is scaled.
     (5) A 160-200 ms fade-in when it opens (the `scale` property, so the zoom's own transform is untouched; none with reduced motion). Not done: an
     EXIT animation (React unmounts the lightbox at once), preloading the neighbours' originals (bytes), a 1:1 pixel mode. The page's root font size
     scales with the viewport (3.5rem = 58.9px at 1280), so every size check is in rem. Proof: `npm run test:viewer-pro` (216, the live gallery
     harness: four photos, one, nine, a phone on its side, ar + en, 390 / 1280, reduced motion, six mutants red) and `test:images-viewer` (669; its
     control count is now 11 = 7 + the four thumbnails). Not yet seen on the live site or with real photos. Regression sweep on the changed files,
     all green: no-zoom-badge 30, magic-zoom 49, images-backdrop 337, home-features 242, addons-brands 141, prices-1118 71, hero-feel 62, icons-polish 1,758,
     icons-1118 10, colours-1118 15, center-text 133, cards-1119 109, price-style 91, product-layout 98, product-shape-1119 48, words-colours 355,
     add-to-cart-ux 194, images-frames 48, shape-1111 14,908, and `test:iconset` 7,627 after one fix: its inventory expected the "zoom" magnifier to be found
     on a page, and the badge that carried it is hidden (NO ZOOM BADGE 1119), so that check is now a guard that the glyph is on NO page.
     **Scanned 2026-11-19, read-only (owner: "scan brands layout at main page"): `HOME-BRANDS-SCAN-2026-11-19.md`.** Live facts: the brands API holds 2 brands
     (Vanquish with a 1400 x 342 / 49.6 KB transparent PNG logo, NBA without one); with two brands each tile is 477-512 px wide at 1280-1536 (HB-01); from 1024 px
     the strip docks under the header at `top: 9.75rem` (compiled build) while the header is 8.6rem, leaving a 19 px see-through slit and 250 px of fixed chrome
     at 1280 x 900 (HB-02); the heading is centred over a start-aligned call to action (HB-03) which is 33-34 px tall at >= 1024 (HB-04). Nothing fixed, nothing
     deployed; the probe is `scripts/live-home-brands-probe.mjs` (the scratch project `sporta-brandscan` was deleted).
     **Built 2026-11-19, NOT deployed (owner: "fix it"): BRANDS-1119** in `sporta-images.css` + BRAND STRIP DOCK in `sporta-features.js` (both files, no API, no
     migration): tiles at most 16rem with four brands or fewer (the live two were 477 px bars), the docked strip at the header's real height via
     `--sporta-dock-top` (a ResizeObserver on the header's border box; fallback 8.6rem; no more 19 px slit), the link centred under the centred heading and a 44 px
     box from 1024 px. Proof: `npm run test:home-brands` (144, mutants red). HB-05 / HB-06 (a 400 px Vanquish logo, an NBA logo) are owner uploads, not code.
     **Built 2026-11-19 (owner: "make product name style improve"): NAMES-1119** (`sporta-features.js` NAMES-1119 block + `sporta-shadows.css` NAMES-1119 `[nm-1]`): a
     product name that carries " — " / " – " / " - " (colour after the dash) keeps the dash with the word before it (a non-breaking space written into the text
     node's `nodeValue` only, idempotent, observer with `characterData`), so a wrapped name never starts a line with a dash; the bag and drawer line names balance
     (`text-wrap: balance`) and, in English, capitalise. `overflow-wrap: anywhere` was tried and DROPPED (a 14 px drawer column broke letter by letter in a fixture).
     Applies to card names, the product title, the bag's `h3` and the drawer's line name. Proof: `npm run test:product-names` (126).
     **Scans written 2026-11-19, read-only, nothing changed live:** `CONFIG-SCAN-2026-11-19.md` (live config files by verdict only, no value printed: CF-01 KNET
     credentials are the shipped placeholders, CF-02 two stray config copies in `private/`, CF-03 T-Pay has only test credentials with `knet_via_cbk` true; all three
     are owner steps and card payments stay off until they are done), `HTTPS-SCAN-2026-11-19.md` (`SCAN_DONE bad=0 warn=0`, certificate 66 days left, HSTS without
     `preload` = owner decision), `JS-SCAN-2026-11-19.md` (`scripts/js-scan.mjs`: 0 uncaught errors on 28 loads, no eval / document.write / innerHTML / console; JS-01:
     59 of 84 top-level blocks do not end in a `catch` and 5 have no `try` at all, a mechanical wrap Claude can do when the owner says "fix"; JS-02: `window.open`
     without `noopener` in `sporta-catalogue.js:495`).
     **Gate for the 2026-11-19 release (zoom badge + VIEWER PRO + BRANDS-1119 + NAMES-1119), 2026-11-19:** viewer-pro 216, images-viewer 669, no-zoom-badge 30,
     magic-zoom 49, home-brands 144, product-names 126, addons-brands 141, home-features 242, brand-cls 120, brand-plate-layout 43, about-page 354, images-backdrop 337,
     images-frames 48, prices-1118 71, hero-feel 62 (59/3 once under load, 62/0 alone), iconset 7,627, icons-polish 1,758, icons-1118 10, colours-1118 15, center-text 133,
     cards-1119 109, price-style 91, product-layout 98, product-shape-1119 48, words-colours 355, add-to-cart-ux 194, cart-ux 342, shape-1111 14,908, product-brand-1118 24,
     shop-header 1,000, cat-tiles-crop, `test:brand` (rig) all green; `test:storefront-polish` 8 failures = the same 8 as at the baseline ("a missing photo shows no
     alt text"); `test:grid` (rig) 3 failures = the baseline 3 ("a product added in /backends is reachable"). Not part of this release and failing before it:
     `test:mobile-1112*` (block order), `test:sog-1112`.
     **Deployed 2026-11-19 09:21 UTC (owner: "deploy"): `deploy-20261119T092115Z-88bccf5`, DEPLOY_OK** (undo `compose --rollback` that name; backup
     `/docker/sporta/backups/deploy-20261119T092115Z-88bccf5`; `--only sporta-features.js,sporta-images.css,sporta-product-fix.css,sporta-shadows.css`, 4 replaced,
     0 added, health identical before and after: `/` `/shop` `/checkout` `/backends` 200, products API 32). The plan's live bytes were exactly the baseline commit
     `bfa628e1`'s (259,787 / 11,234 / 46,949 / 128,928) and went to 273,027 / 13,694 / 48,084 / 136,099, no shrink, so the release carried exactly
     `git diff bfa628e1 88bccf54 -- sporta-web/public` for those four files. **The live add-on files `sporta-features.js`, `sporta-images.css`,
     `sporta-product-fix.css`, `sporta-shadows.css` are now commit `88bccf54`'s** (every other add-on is as listed above; the API baseline stays `269a3737`).
     Live now: NO ZOOM BADGE 1119, VIEWER PRO 1119 (filmstrip, stand-in photo, fling, keys), BRANDS-1119 + BRAND STRIP DOCK (tiles at most 16rem, the strip docked at
     the header's real height), NAMES-1119. Read-only live check afterwards (a fetch job on the VPS, deleted): the four served files equal the release by size and
     sha256 (`1b46b51e3f38e4c1`, `ea100676edfd39bb`, `45a57ade2068a7f2`, `492d0cfe5ec416d8`) and carry their section markers, `Cache-Control: no-cache,
     must-revalidate`, `/` `/shop` `/shop?lang=en` `/cart` `/about` `/contact` link all four. NOT yet seen in a real phone browser on the live site: run
     `scripts/live-home-brands-probe.mjs` (brands strip: the live strip had two 477-512 px tiles and a 19 px slit before), `scripts/live-product-audit.mjs` and
     `scripts/live-add-to-cart-probe.mjs`. The items marked "Built ... NOT deployed" for NO ZOOM BADGE, VIEWER PRO, BRANDS-1119 and NAMES-1119 above are now live.
   - **Deployed 2026-11-03 (owner: "deploy the location now"):** the optional
     checkout "Share my location" control (`sporta-gov-autopick.js`, second IIFE)
     and `.htaccess` `Permissions-Policy` `geolocation=()` → `geolocation=(self)`
     (`deploy-20261103T104853Z-8bf6001`; undo `compose --rollback` that name). The
     control writes ONE line `Location: https://www.google.com/maps?q=LAT,LNG` (or
     `الموقع:`) into the optional order note, joined by a single space (the server
     deletes control characters, so a newline would glue the words); the note limit
     is counted in characters (`mb_strlen`, 280). Live-checked read-only on the
     checkout in ar and en (never submitted). The `.htaccess` that went out also
     carries the build-filled CSP script hashes (live had `script-src 'self'` only;
     harmless, the live index.html has no inline script). **Known and still open:**
     "Remember these details" (ON by default) stores the note, location line
     included, in `localStorage` (`sporta.delivery`), so a later quick checkout can
     send a stale pin; the fix (strip the line on write and on load) follows as its
     own `sporta-gov-autopick.js` deploy. Stage 2 (structured lat/lng columns,
     admin display, a real link in the warehouse HTML mail) ships with the API.

## Brand identity (saved by user request — apply always)

- **Official logo:** orange "S" swoosh + "SPORTA / SPORTS WEAR" wordmark.
  Files: `sporta-web/public/logo.png` (black text, light backgrounds),
  `logo-white.png` (white text, dark backgrounds), `favicon.png` (the S mark).
- **Color theme: ONE ORANGE + BLACK** (owner, 2026-11-18: "remove red color and use orange color same logo exactly" — this
  REPLACES the two-tone system that was here: burnt orange #E0561C for surfaces, hover #B8430F, bright #FF7B17 for accents).
  Every orange fill of the shop (buttons, badges, borders, the top bar, the quick-add button) is the logo's **#FF7B17**
  exactly (`--brand`, `--brand-bright`; hsl 25.9 100% 54.5%). The ONE darker step is #B34D00 (same 26 degree hue, 5.28:1 on
  white), used only for SMALL TEXT on a light ground and the hover fill (the logo orange on white is 2.59:1). Failures are
  orange too: the bundle's rose and red scales are remapped for the shop in `sporta-brand-theme.css` (the admin keeps its own
  colours). Focus rings on light grounds use the dark step (3:1 floor). Charcoal black #171a1e, warm beige #E2DBCE canvas.
  Buttons: near-black text on orange (6.73:1); Buy now is near-black with the logo-orange text. Proven by `npm run
  test:colours-1118`. Not yet live (see "Built, NOT deployed 2026-11-18, COLOURS-1118").
- Voice: premium sportswear, Arabic-first bilingual (سبورتا).

## Project facts

- **Toolchain:** Node **24 LTS (Krypton)** — pinned in `sporta-web/.nvmrc`
  and `engines` (>=22.12). Vite 8 will not run on older Node.
- **Frontend:** React 18 + Vite + Tailwind, react-router.
- **Backend: ONE** (saved by user request — apply always). MySQL on the same
  Hostinger plan + PHP at `/api` (source `sporta-web/dropin/php-store/`, docs
  `sporta-web/NATIVE-BACKEND.md`). **Supabase is gone** — removed at the
  owner's request, along with the `backend` flag in `config.js` that used to
  switch between the two. Do not reintroduce a second backend: every rule
  existed twice while there were two, and a fix applied to one was a bug
  waiting in the other (the KNET dropin was hardened against a browser-supplied
  price and T-Pay was not, and it stayed that way until a test went looking).
  Proven by `npm run test:native` (195 checks) and `test:native-e2e` (26 browser
  checks). `api/config.php` lives ONLY on the server, same rule as
  `knet/config.php`. Any change to one backend's contract must be mirrored in
  the other and covered in native-backend-test.mjs.
- **Where every config lives is ONE rule: `api/config-path.php`** (source
  `dropin/php-store/config-path.php`), read by the store, KNET and T-Pay alike.
  Shared hosting: each `config.php` sits next to its code. The VPS keeps none
  in the web root — `SPORTA_API_CONFIG_FILE` names the store's config and
  `SPORTA_PRIVATE_CONFIG_DIR` holds `knet-config.php` / `pay-config.php`,
  read-only mounts from `/docker/sporta/private/`. It FAILS CLOSED: the
  directory set without the file is refused, never a fallback to a web-root
  `config.php`. The store and T-Pay used to `require` their own `config.php`
  unconditionally, so a release onto the VPS would have killed the API and
  T-Pay; KNET alone had the resolver. A gateway config with no `mysql_*` block
  borrows the store's `db_*` (both gateways; explicit values win). Proven by
  `npm run test:config` (32 checks: both layouts and the half-configured one).
- **Payments — two products from the SAME bank (CBK), two separate setups**
  (saved by user request — apply always):

  **2026-11-03 owner decision, NOT shipped yet (queued behind the release gate):
  "integrate the T-Pay fields with the KNET setup, then remove T-Pay".** Until it
  ships, the table below is what is live. The agreed shape: KNET becomes ONE setup
  with two connections (Direct Tranportal, or through the CBK hosted gateway — the
  existing `knet_via_cbk` switch), and the CBK fields (Merchant API ID/ClientId,
  Password/ClientSecret, ENCRP_KEY, Test and Production API base, return URL,
  customer result page, Merchant Server IP 1 and 2) are edited inside the KNET
  editor, saved through the existing `payment_config` (gateway `tpay`) and
  `payment_server_ips` routes, with one Test/Production switch for both. T-Pay stops
  being a customer payment method: new orders are `knet` or `cod` only;
  `orders.payment_method = 'tpay'` stays valid for history, in-flight payments and
  callbacks; `checkout.tpay` is forced false (otherwise filling in the CBK
  credentials would make T-Pay "ready" and offer it beside KNET); `pay/` stays as the
  CBK transport. The live /backends is a compiled build that reads
  `payment_config.tpay` and `payment_status.tpay`, so those keys stay in the
  responses and its T-Pay card and editor are hidden with add-on CSS while the
  merged panel is built by `sporta-admin-brands.js`. Direct KNET stays unless the
  owner asks for CBK-only. Same review gate as any money-path change.

  | | **KNET** | **T-Pay** |
  |---|---|---|
  | What it is | payment page at checkout — the customer pays with a **Kuwaiti debit card** | an **online payment link** |
  | Ships to | `public_html/knet/` | `public_html/pay/` |
  | Source | `sporta-web/dropin/php-knet/` | `sporta-web/dropin/php-cbk/` |
  | Credentials | Tranportal ID + password + 16-byte resource key (AES `trandata`) | `ClientId` + `ClientSecret` + `ENCRP_KEY` (CBK issues `AccessToken`; **no client-side AES**) |
  | Config file | `knet/config.php` | `pay/config.php` |

  **Both dropins need the orders database configured or they refuse every
  payment** — the four `mysql_*` values, naming the same database as
  `api/config.php` (which spells them `db_*`). Every secret the money path
  needs, and what breaks without each, is mapped in
  `sporta-web/CHECKOUT-SECRETS.md`.

  Same bank, different activation, different credentials, different endpoints.
  **Neither set of credentials works for the other**, and T-Pay cannot be served
  through `/knet`. On the native backend `knet/config.php` MUST carry the
  four `mysql_*` values or the card path is dead (400 Invalid amount) —
  `npm run test:knet` (40 checks, real MariaDB + a fake gateway speaking the
  real Tranportal protocol) is what keeps it alive. T-Pay has the same block
  and its own suite, `npm run test:tpay` (44 checks, fake CBK API) — it was
  written because T-Pay had NO coverage while KNET had 39, and it found a
  live price-authority hole on its first run. Both are selectable at checkout; `orders.payment_method` records
  which was used (`knet` / `tpay` / `cod`).

  **One-setup option (`knet_via_cbk`, default OFF):** KNET can instead be
  taken through the CBK hosted gateway with the T-Pay credentials —
  `tij_MerchPayType = 1`, switched in /backends → Payments → T-Pay card
  (refused until ClientId/Secret/ENCRP_KEY are real). When on, `/knet/pay.php`
  302s to `/pay/pay.php`; the order stays `payment_method='knet'`. Proven by
  `npm run test:knet-via-cbk`. The CBK Authenticate key is cached ≤100 min
  (CBK manual v2.93: a key expires 2 h after issue) and bound to gateway+ClientId, so a Test→Production switch
  never reuses a test key. Register the VPS IP `187.7.78.123` as CBK Merchant
  Server IP 1. Admin UI for the live (compiled) admin is added as blocks in
  `public/sporta-admin-brands.js`; admin styling overrides in
  `public/sporta-admin-knet.css` — a NEW add-on file would not be loaded by the
  live `index.html`.

  CBK's manual describes the T-Pay selector as `tij_MerchPayType = 2`; the owner
  describes the product as an online payment link. Customer-facing copy therefore
  says "pay online with T-Pay" and does NOT promise a QR code — see the note in
  `src/i18n/translations.js`.
- **Home slides, promotions and discounts** are admin-managed (`hero_slides`,
  `settings`, `discounts`, plus `products.sale_price`/`featured` — all in
  `schema.mysql.sql` and in the additive `dropin/php-store/promo.mysql.sql`).
  Three rules hold this together and none is optional:
  1. **The server decides every number.** A sale price, an automatic rule and a
     coupon are three more figures the browser would like to name, and
     `orders.amount` is what `/knet/pay.php` hands the bank. `store_price_lines()`
     and `store_discounts_for()` are the only implementations; the checkout's
     coupon preview calls the same code, so what is quoted and what is charged
     cannot drift. A browser-supplied `amount`/`discount_amount` is ignored.
  2. **Discounts stack in a fixed order** — every qualifying automatic rule,
     best first, then at most one typed code — and the total is capped at
     **60%** of the order (`STORE_DISCOUNT_MAX_PCT`), with 90% the per-rule
     ceiling. Single-use codes are claimed with a guarded `UPDATE` inside the
     order's transaction; proven by racing eight concurrent checkouts.
  3. **A slide photograph is a row, not a file** — same rule as brand logos.
     But it is served by `api.php?r=slide_image` with a content hash and a
     one-year immutable cache, never inlined into JSON: a hero is ~200 kB and
     `/api` is `no-store`. The admin downscales to 1600px WebP in the browser.
  Slider speed/shuffle/size and the promo bar live in `settings` as JSON,
  whitelisted field by field on save. Hero buttons and the promo bar accept
  **same-origin paths only** (`store_internal_href`).
- **Brands** are admin-managed (`brands` table; `schema.mysql.sql` plus the
  additive `dropin/php-store/brands.mysql.sql`). The logo is a capped
  `data:image/(png|jpeg|webp);base64,…` string **in the row, never a file** —
  an upload endpoint would write into the web root, which this project
  forbids. SVG is refused (it can carry script), and the bytes are checked
  against the format's magic number, not just the label.
- **The admin is at `/backends`** (saved by user request — apply always). It
  was `/admin`; the owner renamed it. There is deliberately NO redirect from
  the old path, the route is listed in `public/.htaccess` (or it 404s in
  production), and `public/robots.txt` disallows it. Sign-in is a PHP session:
  HttpOnly + SameSite=Strict cookie plus an `X-Sporta-Admin: 1` header for
  CSRF, with a five-failure fifteen-minute lock. **A browser stays signed in
  one year, 90 days unused signs it out** (owner, 2026-11-02 asked for 30 days;
  again 2026-11-16 for longer) — persistent
  cookie, session files in their own directory above the web root
  (`/var/lib/sporta/admin-sessions` on the VPS) because PHP's default 24-minute
  sweep was signing idle admins out; `npm run test:admin-session`. **Every
  failed admin sign-in is written to `admin_activity_log` and mailed to
  `admin_alert_email` (default cs@sporta.com.kw), at most once per five minutes;
  a correct password from a browser that has never signed in is mailed too**
  (owner, 2026-11-16; `npm run test:admin-login-alert`). Orders: **one
  a minute per client and per phone** (`order_cooldown_seconds`, 429
  `previous_order_pending`); `npm run test:order-cooldown`. The device-passcode
  quick-unlock went with Supabase. Owner decision 2026-11-05: a device passcode is back for the admin sign-in
  (admin.php passcode_*; works only from a browser that holds the admin device cookie; five wrong tries lock it 15 min;
  a password change clears it; `npm run test:admin-passcode` and `test:admin-passcode-ui`).
- **Language:** site is bilingual Arabic/English (RTL/LTR). **ARABIC IS THE
  DEFAULT** (saved by user request — apply always). The rule is short on
  purpose: an explicit saved choice → `?lang=` → **Arabic**. The device's
  language list and its time zone used to sit in between; both were removed.
  **`www.sporta.com.kw/` IS the Arabic page** and is canonical to itself;
  English lives at `?lang=en`. The bare path is the strongest address the shop
  has and Kuwait's market searches for sportswear in Arabic, so it carries the
  language those searches are in.
  The rule cannot be conditional on the device without lying: a page that
  renders English at a URL whose canonical claims Arabic contradicts itself, and
  Googlebot — which reports en-US — is exactly the visitor that would see the
  contradiction. Serving Arabic to the crawler and English to a visitor at the
  same address is cloaking and risks the domain; it is not an option.
  **The cost is real and accepted:** roughly 70% of Kuwait is expatriate, and an
  English phone now lands on Arabic. One tap on the toggle fixes it for good — a
  tap is stored and outranks everything — and English has its own address for a
  link or a search result to point at. A DETECTED language is still never saved;
  `localStorage.lang` means "the visitor tapped the toggle".
  The rule lives in `src/i18n/detectLang.js` and is *also inlined in
  `index.html`*, because it must run before any module loads — it sets
  `<html dir>` and picks which fonts to preload. `npm run test:arabic` asserts
  the two copies agree; keep them in step. Nothing redirects and no URL changes,
  so hreflang stays honest.
- **Arabic SEO is checked by `npm run test:seo`** (27 checks, crawling as
  Googlebot from en-US/UTC). It holds the three places the URL model is written
  — `index.html`, `usePageMeta` and the sitemap — in agreement, because three
  sources saying three things is how an hreflang cluster gets thrown away.
  `hreflang`: **ar → the bare path, en → `?lang=en`, x-default → the bare
  path**. Titles and descriptions come from `t.seo.*` in the language of the
  page; they were a single English constant, so Arabic pages described
  themselves in English to anyone searching in Arabic — which is the likeliest
  single reason a bilingual shop ranks in one language only.
- **The first paint does not wait for JavaScript.** `index.html` carries a
  no-JS shell (header bar, logo, hero box) styled by ~15 inlined rules, and the
  app stylesheet is promoted from `preload` to `stylesheet` on arrival by a
  Vite plugin so it cannot block that paint. Measured on a throttled phone
  (4× CPU, 1.6 Mbps): **FCP 3376ms → ~430ms**. The shell has NO TEXT on
  purpose — copy there would be a second, untranslated copy of the i18n
  strings. `npm run test:perf` now asserts FCP and CLS against Google's "good"
  thresholds and prints LCP (bounded by React mounting; not enforced because a
  timing assertion that flakes is one people ignore).
- **The hero's height is decided BEFORE the first paint**, from
  `localStorage.sporta_hero_size` written by the boot script into `--hero-h`.
  The owner's size setting arrives with `/api?r=slides`, i.e. after the paint,
  and applying it on arrival measured **CLS 0.042 in one jump**. A change now
  takes effect on the visitor's NEXT load rather than by moving the page under
  them. Same trick as the theme, two lines above it.
- **Route chunks are warmed on intent** — hover, touch or keyboard focus on an
  internal link (`src/lib/prefetchRoute.js`). Never on a metered or 2G
  connection, never with Save-Data, and never `/backends` (103 kB of admin no
  shopper opens).
- **Both languages are indexable.** `?lang=ar` is a real URL — the boot script
  reads it before the first paint — so canonical is **self-referencing per
  language** and every page carries `en` / `ar` / `x-default` alternates. The
  sitemap emits both URLs with reciprocal hreflang; pointing the Arabic page at
  the English canonical is what gets a bilingual shop indexed in one language
  only. `og:locale` follows what is actually rendered.
- **`Product` structured data tells the truth about stock.** `availability` was
  hard-coded `InStock`; it now reads the same per-size data the size ladder
  does, and omits the claim when the shop does not know. Also carries `sku`,
  `priceValidUntil`, `hasMerchantReturnPolicy` (14 days — must match `/returns`)
  and free same-day `shippingDetails`.
- **Arabic copy has a test:** `npm run test:arabic` (48 checks) covers missing
  keys, English left untranslated, `{placeholder}` survival, tanwin written
  `ـًا` not `ـاً`, Latin `,?;` stranded between Arabic words, mixed
  Arabic-Indic/Western digits, and Arabic's **five** counting cases (1, 2 dual,
  3–10 plural, 11+ back to singular, restarting each hundred) via
  `arabicCount()`. Two branches is an English rule, and it shipped "٢ قطع".
- **Configuration:** the site reads its endpoints at runtime from
  `public/config.js` (`window.SPORTA_CONFIG`), falling back to build-time
  `VITE_*` in `.env`. Three keys remain — `payBaseUrl`, `cbkBaseUrl`,
  `phpApiUrl` — and all three have working defaults, so an empty
  `window.SPORTA_CONFIG={}` is a correct production config. It stays because it
  is what lets the store be repointed by editing a file in Hostinger File
  Manager, with no Node and no rebuild — the server account has no shell
  (`/sbin/nologin`). `config.js` is in the deploy keep-list, so a deploy never
  overwrites the live values.
- **Packaging:** `node sporta-web/scripts/make-package.mjs` (or `npm run
  package`) regenerates `SPORTA-GO-LIVE.zip`. Never hand-assemble it — the
  previous hand-made zip went stale and carried the payment-losing callback bug
  for weeks. It now runs `scripts/file-audit.mjs` over the staged tree and
  **refuses to write the zip** if anything fails, so the artifact cannot ship
  with a case-mismatched asset reference, a BOM before `<?php`, a stray
  `config.php`/`.env`, or a missing required file.
- **Brand masters live in `/brand/`, never in `sporta-web/public/`.** Anything
  in `public/` ships. `logo-original.png` sat there unreferenced for weeks and
  was 522 kB — a third of the entire uploadable package.

## Going live (saved by user request — apply always)

- **The live website is `https://www.sporta.com.kw`** — canonical host is
  **`www`** over **HTTPS**. Every URL the codebases emit (canonical tags,
  hreflang, sitemaps, JSON-LD, `llms.txt`) uses exactly that origin, and both
  `.htaccess` files 301 any other spelling (bare domain, server IP, plain
  HTTP) to it in a **single hop**. Never introduce a second spelling.
- **What goes live:** `sporta-web` (React/Vite). Its `dist/` is the site root
  (`/public_html`), and `npm run release` also bundles the KNET PHP endpoints
  into `dist/knet/`. `sporta-html5` is a no-build fallback, not the live site.
- **The live server is the VPS; deploy with `scripts/vps-deploy.mjs`** (item 4
  above). The two routes below reach only the old shared-hosting account and
  are kept for the day it serves the site again:
- **Two publish routes**, both documented in `GO-LIVE.md`:
  1. `cd sporta-web && npm run publish` — SEO regen → build → file audit →
     **FTPS** upload → byte-for-byte verify. Works with SSH off, which is the
     permanent state. Config in `deploy.config.json`; credentials in
     `.env.deploy` (git-ignored, never commit).
  2. `SPORTA-GO-LIVE.zip` — drag `public_html/` into Hostinger File Manager.
  (There is no third route. `npm run deploy`, the old SFTP one, was deleted:
  it rode on SSH, so it had not been runnable since SSH was turned off, and a
  command that cannot work is worse than no command. `git log` has it.)
- **`.htaccess` is hidden** — it is the single most common thing to miss on a
  manual upload. Without it: no HTTPS redirect, no security headers, and deep
  routes like `/shop` 404. Always call this out when telling the user to
  upload.
- **`knet/config.php` lives ONLY on the server** (real Tranportal
  credentials). It is never committed, never in the zip, never uploaded, and
  is protected from deletion by `upload.keep` + the mirror keep-list. Deploy
  `mirror` stays **false** unless there is a reason to change it.
- **After any deploy:** run `./scan-server-response.sh` (HTTPS, single-hop
  redirects, security headers, cookies, cache tiers, real 404s, directory
  listings, exposed files). Before a deploy, `npm run audit:storage` asks the
  same questions of `dist/` against a real Apache with the production
  `.htaccess`.
- **`SERVER-LAYOUT.md` is the storage map** (saved by user request — apply
  always): what belongs in `public_html`, what must stay ABOVE it, the cache
  tier per folder, and permissions. Two things live above the web root because
  they are credentials, not configuration: `knet-payments.log` and
  `.cbk_token.json` (a CBK bearer token — its old default was inside
  `public_html/pay/`). Files are `644`, folders `755`; `npm run publish` applies
  them over FTPS. Never `777`.
- **A `<FilesMatch>` in `public/.htaccess` is inherited by subdirectories; a
  `RewriteRule` is NOT** — measured under Apache: a dotfile in a folder whose
  own `.htaccess` says `RewriteEngine On` was served 200 while the same file at
  the root was 403. Deny by NAME for anything that must hold everywhere.
- **Image upload: ONE route exists, and no other is to be built.** (Corrected
  2026-11-03: this bullet used to say there was none, which was no longer true.)
  `admin.php?r=product_image_upload` is the live backend's own: admin-only
  (session + `X-Sporta-Admin`), PNG/JPEG/WebP only (SVG refused), magic-number
  checked, 10 MiB cap, written unchanged into the media mount
  `/docker/sporta/private/media/products` (served as `/images/products/`, with a
  `.htaccess` that denies PHP there), answering `{path, width, height, bytes,
  mime}`; the product row keeps `image` / `images` through `product_save`. Every
  OTHER image is either a file the owner puts on the server by hand (category
  photos, `/cats/*.jpg`) or a `data:` URI stored in the database row (brand
  logos, hero slides). A second upload endpoint would be another way to write
  into the web root, and the live server already had one such endpoint once —
  see "Never build a PHP deploy endpoint" below. Tools that upload (the bulk
  photo uploader in `sporta-admin-brands.js`) call this route and nothing else.
  **Owner decision 2026-11-03 (saved by user request — apply always): uploaded
  product photos are LOSSLESS.** The browser sends the file's own bytes: no
  canvas, no resize, no re-encode, no format conversion (a JPEG stays a JPEG, a
  PNG a PNG, a WebP a WebP), no quality slider, no metadata stripping, and the
  route writes them unchanged. A file over the route's 10 MiB cap is refused with
  a clear message and is never shrunk. The tests assert it: the request body
  decodes to bytes identical to the file. Two consequences to keep in view: the
  EXIF the camera wrote (including location, if it was on) stays in the file, and
  the small responsive WebP variants the shop cards use
  (`/images/products/responsive/<slug>-320.webp`, `-640.webp`) are made offline,
  not by the route, so an uploaded original is served at full size on grid cards
  until its variants exist (a server-side job, not a browser step).
- Outstanding before/after launch: real product photos (biggest gap), and the
  SPF/DKIM/DMARC records in `DNS-EMAIL-RECORDS.txt`.

## Working notes

- **The owner works in Hostinger hPanel, and SSH is disabled — permanently,
  by choice** (after 24 brute-force attempts were logged against it, and the
  account's shell was `/sbin/nologin` anyway, so it bought nothing). Treat SSH
  as unavailable. **Never propose an SSH- or SFTP-based step** unless the owner
  explicitly says they have re-enabled it. There is no longer one to propose:
  the SFTP `npm run deploy` has been deleted along with its `ssh2-sftp-client`
  dependency.

- **The standing bridge is FTPS: `npm run publish`** (`scripts/publish-ftps.mjs`).
  FTP is a separate Hostinger service from SSH, so it keeps working with SSH
  off. Credentials come from hPanel → Files → FTP Accounts and live in
  `sporta-web/.env.deploy` (git-ignored): `FTP_HOST`, `FTP_USER`,
  `FTP_PASSWORD`. It builds, runs `file-audit.mjs` and refuses to upload if the
  audit fails, uploads over explicit TLS, then re-downloads `.htaccess`,
  `knet/.htaccess` and `index.html` and compares them byte for byte.
  `npm run publish:dry` shows what would change without writing, and
  `npm run ftp:doctor` finds the right FTP host (DNS → TCP → TLS → LOGIN → DIR,
  so the failing stage names the fix). **Never guess the FTP host** —
  `ftp.sporta.com.kw` has no DNS record; shipping it as a default cost a round
  trip. `publish` builds with the `VITE_` variables emptied, so nothing from a
  local `.env` is baked in and the output matches the audited zip; it sends
  `index.html` last so a half-finished run is not a white screen; it does not
  re-upload `go-live.html`/`selftest.php`/`setup-config.php` (the owner is told
  to delete those) unless `--setup-tools` is passed; and it reports leftover
  files from the old site, since it never deletes anything.
  `config.js` and `knet/config.php` are in a hard-coded never-touch list — not
  configuration — so a publish can never overwrite the live database or
  Tranportal credentials. Verified against a real FTPS server, including that
  both files survive untouched and that a wrong password or a failing audit
  stops the run before anything is written.

- **`npm run ftp` is the file manager**, and it is a CLIENT on the owner's Mac
  (`scripts/ftp-manager.mjs`): `ls · cat · get · put · mkdir · mv · rm · rmdir
  · chmod · du · find`, over the same FTPS as `publish`, same `.env.deploy`.
  `api/config.php`, `knet/config.php`, `pay/config.php` and `config.js` cannot
  be overwritten or deleted through it — `get` is allowed, because taking a
  backup is the point. Proven by `npm run test:ftp` (28 checks, real pyftpdlib
  over TLS, results verified on the server's own disk).

- **Never build a PHP deploy endpoint.** The live server had one —
  `sporta-deploy.php` in the web root, answering to anyone on the internet.
  That is a way in, not a bridge. FTPS adds no attack surface: Hostinger
  already runs and authenticates it, and the credentials are revocable in
  hPanel.

- hPanel **File Manager + `SPORTA-GO-LIVE.zip`** remains the no-tools fallback
  for when the owner is not at a machine with the repo and Node.

- Claude's environment cannot reach the user's FTP/SFTP, the live site, or
  databases directly — SSH, FTPS and `https://www.sporta.com.kw` are all
  outside the sandbox's network policy. It reaches the VPS ONLY through the
  Hostinger API connector: one-shot Docker Compose projects on VM `2058651`
  (read-only containers for scans, the `sporta-deploy` job for deploys). HTTP
  checks of the site therefore run ON the VPS, in Node — the API refuses a
  compose file containing `curl`, `wget` or `require('fs')` (each measured: 403). A deploy
  has happened only when the job's log says `DEPLOY_OK`; say so plainly.
- **Probing the live site from a session (measured rules).** Browser probes run in
  `mcr.microsoft.com/playwright:v1.49.0-noble` (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i
  playwright@1.49.0` inside the job), fetch-only ones in `node:24-alpine`. The script is
  written with a heredoc in the compose `command`, or fetched from
  `raw.githubusercontent.com/hkspower/wain/<pushed sha>/…` (hand-copied base64 is
  unreliable). Never put a `$` in a compose file (compose interpolates it); write Arabic
  as `\uXXXX`; the first `vps_docker_create` often leaves the project "not found" — create
  again with the same name; logs show service output only once the container has
  progressed, are capped at 300 entries, and screenshots cannot be viewed from the VPS, so
  measure the DOM. Delete every scratch project (`vps_docker_delete`). Probes are
  read-only: no order, no form, no sign-in, no POST. Add-on CSS for the compiled
  storefront is proven with a fixture of the exact live markup plus the live rules
  (`scripts/fixtures/*.mjs`; `test:home-features`, `test:admin-payments`) and a mutation
  check that the suite fails without the CSS. This machine has 4 CPUs, so a Workflow runs
  two agents at a time and a long review takes hours.
- Adding a route to `sporta-web/src/App.jsx` also requires adding it to the
  known-route list in `sporta-web/public/.htaccess`, or it will 404 in
  production.
- Keep the indigo accent for admin UI.
- **The /backends Payments (KNET) screen has NO dark mode** (owner, 2026-11-03,
  "no dark mode for knet"; saved by user request — apply always). The compiled
  admin's dark theme is NOT keyed on the device alone (measured 2026-11-03): it is
  `html[data-theme=dark]` / `html.dark`, set by `/boot.js` before first paint from
  the stored `sporta_theme` choice, else from the device's `prefers-color-scheme`
  on `/backends` (the stored choice outranks the device; the app re-evaluates it
  on route change, not on a device change). Every other screen keeps following
  that; the Payments screen must show its light appearance in every dark state,
  never a dark or half-dark mix. Implemented in `public/sporta-admin-knet.css`
  (Section 9, "Light only", commit 5037bb57) as rules that open with
  `:is(html.dark, html[data-theme="dark"])` and are scoped to `.payment-settings`
  and the content area that holds it (`.admin-content:has(.payment-settings)`);
  guarded by `npm run test:admin-light` against a verbatim copy of the live
  build's dark rules (`scripts/fixtures/admin-dark-rules.css`, from
  `/assets/index-CdcKvZhs.css` and `AdminApp-Dw3t3z9Z.css`; re-fetch it if the
  build's asset hashes change). The earlier dark layer and `prefers-color-scheme`
  twins (commits 4da598d1–0e3184d6) were keyed on the wrong thing, were never
  deployed, and are gone. NOT yet measured on the live page (needs the Hostinger
  connector): the light look of the info and ok admin notices (stand-in values in
  the add-on) and `text-indigo-600/900`; run `admin-payments-scan.mjs` with
  `SCHEME=dark` and `CSS_URL` before deploying.

- **Every order emails the logistics company** — see `sporta-web/FULFILMENT.md`.
  `store_queue_fulfilment()` writes `fulfilment_outbox` in the same
  transaction as the order (so a message cannot go missing) — in PHP, not a
  trigger; the MySQL schema has none, and the docs said otherwise until a
  schema check counted zero. The
  `notify-warehouse` Edge Function drains it. Fires **on INSERT**, i.e. BEFORE
  payment — the owner chose that knowing it, so every message states the payment
  state in its subject and a follow-up says ship / do not ship. Needs
  `WAREHOUSE_EMAIL` set, and needs SPF/DKIM/DMARC from `DNS-EMAIL-RECORDS.txt`
  or the mail silently goes to spam.

- **Database security (2026-11-04, owner: "secure database") — built, NOT applied
  live.** The pack is `sporta-web/ops/db/` (not shipped in the web package); the
  runbook, control table, ordered apply plan, open findings and owner decisions are
  `sporta-web/DATABASE-SECURITY.md`. Nothing touches the live database or host
  until the owner confirms each step: every live step is a one-shot job through the
  Hostinger connector (never SSH, a PHP endpoint or CI), and anything that changes
  accounts, host cron or server settings, or deletes/anonymises data needs an
  explicit yes. Order: read-only audits first (`scripts/db-security-audit.mjs` and
  the host audit job), then the encrypted backup (the off-server copy is still an
  open owner decision), then accounts (`grants.sql`; re-apply a live account only
  with `render-grants.mjs --additive`), then server settings, then the PHP patches
  with the release gate. A backend change that touches SQL must regenerate
  `grants.sql` (`node ops/db/make-grants.mjs --check`). Suites, each on its own
  private MariaDB, never the shared rig: `test:db-least-privilege`, `test:db-audit`,
  `test:db-backup`, `test:db-privacy`, `test:db-connect`.

- **Database center (2026-11-11, owner: "make backends center database") — built, NOT deployed.** Read-only
  `/backends` -> Settings -> "Database center" (block `ADMIN DATABASE CENTER` in `sporta-admin-brands.js`; tabs Overview,
  Tables, Schema, Health, Integrity). Server side: `dropin/php-store/dbcenter.php` plus the generated
  `dbcenter-manifest.php` (`node scripts/make-dbcenter-manifest.mjs`, `--check`, from `ops/db/expected-schema.json`),
  routes `db_center` and `db_integrity` in `admin.php` (below the admin gate, GET only, throttled, one config key handed
  over, no secret/host/db name/path/SQL/driver message in any answer, no write of any kind; the SET SESSION time limit
  is the only non-SELECT/SHOW). It needs NO new grant (`make-grants.mjs --check` is current); `information_schema` shows
  the shop account only the tables it may touch, and without PROCESS the lock graph says "unknown". **Backup line:** the
  app cannot see `/docker/sporta/private/backups` (root 0700, by design), so it reads one small file,
  `/var/lib/sporta/backup-status` (config `db_backup_status_file`): the `last-status` and `last-success` lines the
  backup job already writes. Until a host job copies them there (an owner step, not done) it says "not reported".
  Suites: `test:db-center` (110, private MariaDB + php -S, mutants), `test:admin-db-center` (182, browser). Shipping it
  is an API release (`--only api,...`, file names `dbcenter.php`, `dbcenter-manifest.php`, `admin.php`) plus both
  `sporta-admin-brands*.js` names; pre-existing failures that are NOT from it: `test:db-columns` (install.mysql.sql
  lacks the passcode columns; products.category uncapped), `test:db-least-privilege` and `test:config-rules` (abandoned
  wiring, T-Pay flow, unmanifested assistant keys).
- **Admin JS audit (2026-11-11, "check javascripts backends") — `npm run test:admin-js-audit` (48 checks).** Findings:
  no innerHTML/eval/console in any of `sporta-admin-brands.js`, `boot.js`, `config.js`; no data reaches an `href` except
  through a checked helper; storage is always in try/catch. Fixed: five early blocks (Brands tab, KNET ids, T-Pay IPs,
  the sign-in session line, the CBK card) had no `window.__sporta...` guard, so a second copy of the file started a
  second set of observers (proved, with a mutant); two `requestAnimationFrame` scans ran without try/catch (a console
  error on every DOM change if one threw); the five 500 ms entry checks now sleep while the tab is hidden. Left as is:
  13 whole-body MutationObservers (each debounced to one frame, idle page = 0 mutations measured) and the same-origin
  iframes the Footer/Site content editors use to read the storefront.

- **ElevenLabs MCP** — `.mcp.json` at the repo root, pinned to
  `elevenlabs-mcp==0.11.0` and run through `uvx`. 27 tools: text-to-speech,
  voice cloning, sound effects, agents, outbound calls.

  Two things it needs, and it is silent about neither:

  1. **`ELEVENLABS_API_KEY` in the environment.** `.mcp.json` reads
     `${ELEVENLABS_API_KEY}` and the key itself is **never** in the file —
     `.mcp.json` is committed, and a key in a committed file is a key on
     GitHub. Set it in the Claude Code environment settings.
  2. **`api.elevenlabs.io` on the network allowlist.** Without it the server
     starts, answers the MCP handshake, lists all 27 tools, and then fails
     every single call at CONNECT — which reads like a broken integration
     rather than a firewall. Measured: the sandbox proxy answers 403 to
     CONNECT for anything outside the package registries.

  This is the SELF-HOSTED server, not the claude.ai ElevenLabs connector. The
  connector is a separate thing, authenticates by OAuth, has nowhere to put an
  API key, and is enabled per chat in the connector menu — none of which can be
  done from inside a session.

  `make_outbound_call` places real telephone calls and `voice_clone` spends
  credits. Both are one tool call away once this is on.

  To bump: change the pin in `.mcp.json`, nothing else.
