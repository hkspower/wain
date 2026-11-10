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
   - **Baseline (moved 2026-11-10):** the live `api/`, `knet/` and `pay/` are commit
     `8fb025a5` (`deploy-20261110T064353Z-8fb025a`, DEPLOY_OK; undo `compose --rollback`
     that name). That release carried the admin passcode (migration
     `admin-passcode.mysql.sql` applied 2026-11-09, backup
     `backups/manual-20261109T2310Z-admin-passcode-migration`), the 30-day admin
     sign-in, the order cooldown, the assistant rewrite and the CBK hand-off page fix
     (own CSP in `pay/.htaccess`; the script's sha256 there must match `pay.php`).
     Before it, the baseline was
     commit `1eb487aa` (verified by read-only `vps-deploy.mjs` plans). What a
     backend release ships is `git diff 8fb025a5 HEAD -- sporta-web/dropin`; move
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
- **Color theme: ORANGE + BLACK — two-tone orange system (matches
  www.sporta.com.kw):** UI surfaces/buttons use burnt orange **#E0561C**
  (hover #B8430F) as on the live site; the logo's bright orange **#FF7B17**
  is `brand.bright` for the mark, gradients and accents. Charcoal black
  #171A1E, warm beige #E2DBCE canvas. Buttons: near-black text on orange
  (white on these oranges fails WCAG AA at button sizes).
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
  (CBK allows 6 h) and bound to gateway+ClientId, so a Test→Production switch
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
  30 days, 7 days unused signs it out** (owner, 2026-11-02) — persistent
  cookie, session files in their own directory above the web root
  (`/var/lib/sporta/admin-sessions` on the VPS) because PHP's default 24-minute
  sweep was signing idle admins out; `npm run test:admin-session`. Orders: **one
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
