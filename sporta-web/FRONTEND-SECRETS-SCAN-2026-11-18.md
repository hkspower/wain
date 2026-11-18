# Front-end secrets scan — 2026-11-18

Owner request: "scan frontends secret". READ-ONLY: no source file changed, nothing committed or pushed, the live site and
the VPS were not touched, no server was started, 127.0.0.1 was not contacted. The only file written inside the repo is this one (a few
helper scripts and result files went to the session scratchpad, outside the repo). Real secret values are never copied here: none were found,
and where an identifier is shown it is cut to its first 4 characters plus its length.

## Result in one paragraph

**No real secret is exposed to a browser.** No API key, token, JWT, private key, password, `ENCRP_KEY`, `ClientSecret`,
Tranportal field, `Authorization:` literal, source map or credential-bearing URL exists in `public/`, `src/`, `dist/`,
`index.html`, the captured live storefront, or (for eight key families) any of the 4,049 commits on any branch. The
public API answers I read carry no cost, supplier, admin e-mail, gateway mode, config key or order-holder contact data.
What the scan did find: one public route that over-shares stock (live), one secret (`cron_key`) doing five jobs, three
holes in the "can a credential file end up in the web root or the repo" guards, and a set of low-grade information
disclosures (server paths, deploy tooling, a design-tool link, customer details kept in the browser).

| Severity | Count | IDs |
|---|---|---|
| High | 0 | none |
| Medium | 3 | FS-01 stock counts, FS-02 `cron_key` reuse, FS-03 ignore/package-guard gaps |
| Low | 11 | FS-04 … FS-14 |
| Info | 9 | I-1 … I-9 (intended-public identifiers, false positives, recon surface) |

## What was scanned (coverage)

| Target | Files | Bytes | Text scanned | Notes |
|---|---|---|---|---|
| `sporta-web/public/` | 96 | 3,811,513 | 37 text files, 1,909,389 chars | every `sporta-*.js/.css`, `boot.js`, `birthday.js`, `config.js`, `sw.js`, `.htaccess`, `robots.txt`, `llms.txt`, sitemaps, manifests, `go-live.html`; 51 images checked for EXIF/GPS/XMP/IPTC |
| `sporta-web/dist/` (existing, no build run) | 138 | 4,695,409 | 79 text files, 2,764,955 chars | 49 JS, 17 CSS, 0 `.map`; 51 images checked. It is a plain `vite build` output: no `api/`, `knet/`, `pay/`, and the admin add-on is not yet split into loader + `.full.js` |
| `sporta-web/src/` | 97 | 971,027 | all, 941,647 chars | `import.meta.env` uses: 3 (`VITE_PAY_BASE_URL`, `VITE_CBK_BASE_URL`, `VITE_PHP_API_URL`, all public URLs) |
| `sporta-web/index.html` | 1 | 27,167 | all | |
| Live capture `…/scratchpad/scan-words/live` | 85 | 1,303,455 | 1,275,305 chars | present. 49 JS + 1 CSS in `assets/`, 9 add-on JS, 14 add-on CSS, 9 `api/*.json` responses. **Captured 2026-11-02 17:26-17:32**, i.e. before the add-on deploys of 11-03 … 11-18; so it proves the compiled bundle and the API shapes, not today's add-on text |
| PHP backend `dropin/` | 51 php, 32 sql, 3 .htaccess, 1 json | 1,834,178 (incl. 47 sample jpg) | `api.php` read in full (1,217 lines); `store.php`, `assistant.php`, `customer.php`, `admin.php`, `setup-admin.php`, `cron-*.php`, `.htaccess` x3 read where they touch a public answer | `git diff e7db9143 HEAD -- sporta-web/dropin` is empty, so what I read is what CLAUDE.md says is live |
| Git | 1,130 tracked files; 4,049 commits (all branches) | | file names by the owner's regex; history by pickaxe for 8 key families | see below |
| Package path | `make-package.mjs`, `bundle-php.mjs`, `file-audit.mjs`, `publish-ftps.mjs`, `vps-deploy.mjs`, `.gitignore` x2 | | read; the skip filter was run in a throw-away node one-liner on sample names (no file written) | |

Working-tree note: `public/sporta-admin-brands.js` has uncommitted changes (+818 lines) and `PRODUCT-VALUES-SCAN-2026-11-18.md`
is untracked; neither is mine. The working-tree copy was scanned (added lines checked for keys, e-mails, numbers, URLs: clean).

### Regexes used (rg / git grep, with line numbers)

- Key shapes: `AIza[0-9A-Za-z_-]{35}`, `GOCSPX-`, `[0-9]{8,}-[0-9a-z]{20,}\.apps\.googleusercontent\.com`, `-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)`,
  `sk_(live|test)_`, `(pk|rk)_(live|test)_`, `sk-(proj-|ant-)?[A-Za-z0-9_-]{20,}`, `AKIA[0-9A-Z]{16}`, `gh[pousr]_[A-Za-z0-9]{30,}`, `github_pat_`,
  `xox[baprs]-`, Sentry DSN, Mapbox `pk.eyJ`, reCAPTCHA `6L[cde]…`, JWT `eyJ….eyJ….x`, ElevenLabs `sk_[0-9a-f]{32,}` / `xi-api-key`.
- Words: `ENCRP|resource.?key|client.?secret|tranportal|trandata|api.?key|secret|private.?key|passphrase|authorization|bearer`, and
  `(password|secret|token|api_?key|…)\s*[:=]\s*['"`][A-Za-z0-9+/_=.-]{8,}['"`]`.
- Places: `187.7.78.123`, `46.202.x.x`, RFC1918 ranges, `/docker/`, `/run/sporta`, `/var/lib/sporta`, `/home/`, `public_html`, `hstgr`, DB names, `mysql_*`, `db_pass`.
- People: any e-mail, any phone (`+965…`, `wa.me/…`, 8-digit), QA customer, `TODO|FIXME|XXX`.
- Blobs: base64-like runs of 80+ characters, `base64,`, `atob(`; `*.map`, `sourceMappingURL`, `sourcemap` in `vite.config.js`.
- URLs with `user:pass@`; every external host in each tree.

## Findings

### Medium

**FS-01 — `GET /api/api.php?r=stock` publishes the exact number of units and the internal SKU of every size.** Medium. LIVE: yes.
- Code: `dropin/php-store/api.php:466-488` (`select v.slug, v.size, v.sku, v.stock, (v.stock > 0) as in_stock`, `stock` cast to int). No
  login, 120 requests a minute per client, `no-store`. Same file as the live baseline (`e7db9143`, empty diff).
- Evidence: live capture `api/stock.json` (2026-11-02): 167 rows, **1,230 units in total, largest 10, 118 of 167 rows above the
  storefront's own "low stock" line**; every row has a 28-character `sku` (the AHED rows carry the supplier's own codes, e.g. `A-…`).
- Why it matters: anyone (a competitor, a scraper) can read the shop's whole inventory and its sell-through between two
  requests, and the supplier's SKU scheme. Nothing in the storefront needs it: `src/lib/stock.js:110` sets `LOW_STOCK_AT = 3` and
  `src/pages/ProductDetail.jsx:183-184` shows a number only when it is 3 or less; elsewhere only `in_stock` is read.
- Fix: in `api.php` answer `stock => min(stock, LOW_STOCK_AT + 1)` (or a `low` boolean) and keep `in_stock`; drop `sku` from this
  route unless a page needs it (the compiled storefront reads `sku` from the same row at `src/lib/stock.js:53`, check before removing).
  API release, review gate.

**FS-02 — one secret, `cron_key`, signs five different public-facing things and is guessable online.** Medium (conditional on the live key's strength, which this scan cannot read).
- It keys: the review link `store_review_sig` (`store.php:4126-4136`), the invoice key `?k=` (`store.php:4186-4200`, 7-day, put in a URL and mail),
  the spoken-answer tag `assistant_speech_sig` (`assistant.php:5069-5074`, in the audio URL `?r=say&v=`), the admin bootstrap key of
  `setup-admin.php:37`, and the HTTP cron `?key=` (`cron-auth.php:15-18`).
- Three of those values are handed to strangers (every customer holds one invoice key and one review link). An HMAC-SHA256 tag with
  a known message is an offline guessing target for the key; if `cron_key` is short or human-chosen, one invoice link recovers it, and
  with it forged full invoices (name + address of any order), review codes, voice tags, and the admin-creation key.
- No length is enforced anywhere (`config.example.php:74` says "any long random string", default `''`); `cron-*.php` over HTTP
  has no throttle on a wrong `?key=` (`cron-stock.php:59`, `cron-fulfilment.php:30`, `cron-birthday.php:14`), and `cron-*.php` is not
  denied by `api/.htaccess`, although the VPS cron jobs run through `docker exec … php` (CLI) and need no web route.
- Fix: derive one sub-key per purpose (`hash_hmac('sha256','invoice',cron_key)` as the key, or HKDF) so a tag never exposes the master;
  refuse (fail closed) a `cron_key` under 32 random bytes; add `cron-*.php` to the deny list in `dropin/php-store/.htaccess` (CLI is
  unaffected) and throttle a wrong key; rotate `cron_key` once the above ships. Owner step: confirm the live value is >= 32 random characters.

**FS-03 — the guards that keep a credential file out of the web root and the repo only know the old file names.** Medium (latent: no such file is tracked today).
- `.gitignore` (root and `sporta-web/`) ignores `dropin/php-store|php-knet|php-cbk/config.php`, `.env.deploy`, `*.local`, `*.php.bak` etc. Measured with
  `git check-ignore -v`: **NOT ignored** — `.env`, `.env.production`, `knet-config.php`, `api-config.php`, `pay-config.php` (the names the VPS
  really uses, `CLAUDE.md` "Where every config lives"), `.cbk_token.json`, `*.log` (`knet-payments.log`), `*.sql.gz`/`dump.sql`, `.my.cnf`, `*.env` files under `ops/`.
- `scripts/bundle-php.mjs:20-26` drops `config.php`, backups and names that START with `config.`. Running that filter on sample names:
  `knet-config.php`, `api-config.php`, `pay-config.php`, `.env`, `.env.production`, `cron.log`, `knet-payments.log`, `backup.sql.gz`, `dump.sql`,
  `secret.key`, `id_rsa`, `db.cnf`, `credentials.json` are all **SHIPPED** into `dist/api|knet|pay/`.
- `scripts/file-audit.mjs:316-319` refuses only seven fixed paths (`/knet/config.php`, `/pay/config.php`, `/pay/.cbk_token.json`, `/api/config.php`, `/.env`,
  `/.env.deploy`); it never reads file contents. `vps-deploy.mjs:127-130` (`neverTouch`) protects `config.php`, `.cbk_token.json` and `*.log` on the server side, not a copy named `*-config.php`.
- Web-server layer: root `.htaccess:522` denies `knet-config.php` by name but not `api-config.php`/`pay-config.php`; `api/.htaccess:8` lists only `config.php`;
  a `.php` copy would normally execute (empty), which is safe only while PHP is healthy.
- Fix: add `.env`, `.env.*` (with `!.env.example`, `!.env.deploy.example`), `*-config.php`, `.cbk_token.json`, `*.log`, `*.sql.gz`, `*.dump`, `*.cnf`, `id_rsa*`
  to `.gitignore`; make `skipName` in `bundle-php.mjs` drop `/(^|[-.])config\.php$/`, dotfiles, `*.log`, `*.gz`, `*.pem|key|p12|p8`; extend `FORBIDDEN` in
  `file-audit.mjs` with the same classes and add a content scan (the key regexes above) over the staged tree; deny the same classes in `.htaccess`.

### Low

**FS-04 — a shopper's name, phone and full address stay in the browser by default.** LIVE: yes.
`src/lib/delivery.js:12,18,22`: `sporta.delivery` holds name, phone, governorate, area, block, street, building, floor, flat and the note; the
"Remember these details" box is ON unless `sporta.delivery.remember` is `'0'`. The live compiled bundle has the same key (`assets/index-BtzlNXGI.js`),
plus the cart (`sporta_cart`). On a shared phone or an internet-cafe PC the next person reads them. The location line is already stripped
(`sporta-gov-autopick.js:68-73`, `delivery.js:62-88`). Fix: default OFF (opt-in), clear after a paid order, or keep only the governorate/area; add a "forget my details" link.

**FS-05 — the admin chunk of this repo's build names server paths and the admin-creation page.** LIVE: not from this build; the live compiled admin chunk has a milder version (`GO-LIVE.md walks through all of this in order.`, `api/config.php`, `api/install.mysql.sql`, phpMyAdmin/hPanel steps).
`src/admin/AdminApp.jsx:86-87,105-106,128-134,171-172,184-185` bakes `/docker/sporta/private/api-config.php`, `/docker/sporta/private/config/knet-config.php`,
`pay-config.php`, "the VPS" into `dist/assets/AdminApp-C2jSAJ91.js`, a lazy chunk anybody can fetch; `:101-102` names `scripts/vps-deploy.mjs` and `GO-LIVE.md`;
`:147-148` `api/install.mysql.sql`; `:198-207` and `src/admin/Settings.jsx:210-229` give `https://www.sporta.com.kw/api/setup-admin.php`. No secret, but it hands an attacker the
file layout and the URL of the account-creation tool. `setup-admin.php` only works on an empty `admin_users` table and needs `cron_key` (see FS-02), is denied by `api/.htaccess:8`, and is in `SETUP_TOOLS` (`vps-deploy.mjs:125`, never deployed).
Fix: show these steps only after a sign-in (or drop the paths from the strings); keep the setup guide in `GO-LIVE.md`.

**FS-06 — `index.html` keeps an HTML comment about the deploy tool and a past incident.** LIVE: no (the live page is the other build; this repo's page was live only 2026-11-02).
`index.html:24-28` (and `dist/index.html:24-28`): "scripts/vps-deploy.mjs refuses a whole-site apply … replacing it removed those features for 13 minutes on 2026-11-02". Vite keeps it
(22 lines with HTML comments survive in `dist/index.html`). Fix: shorten to the meta tag, or strip comments in the Vite HTML step.

**FS-07 — a design-tool link is shipped in a public stylesheet.** LIVE: yes.
`public/sporta-cat-tiles.css:2` and the live capture's copy: `Design: https://claude.ai/artifact/7Wp… (len 22 id)`. Private by default, but it names the vendor tool and an internal artifact id. Fix: delete the line (the file is already flagged "unreviewed WIP" in `CLAUDE.md`).

**FS-08 — unauthenticated JSON tells a stranger which config value is wrong while the database is down.** LIVE: only during an outage.
`dropin/php-store/store.php:39-40` (`not_configured` + `hint: copy config.example.php…`) and `:80-88` (`db_unreachable` + `cause: "db_user or db_pass" | "db_name" | "db_host"`), `:119` (`no_table` 503). Any public route returns them. The admin screen uses `cause`
(`AdminApp.jsx:158-163`). Fix: send `cause`/`hint` only when an admin session or `X-Sporta-Admin` is present; public callers get `{"error":"unavailable"}` 503.

**FS-09 — real shared-hosting identifiers are tracked and one copy ships.** LIVE: no (old account does not serve the domain; `config.example.php` is denied by name).
`dropin/php-store/config.example.php:15-16`, `php-knet/config.example.php:86-87`, `php-cbk/config.example.php:73-74` hold the old account's database name and user
(`u130…`, len 20 and 22; the account prefix also appears in `deploy.config.json:17-20` with the old SSH host `46.202.x.x`, port and user, and 7 tracked files name that IP). No password.
They are copied to `api/`, `knet/`, `pay/` by `bundle-php.mjs`. Fix: placeholders (`YOUR_DB_NAME`); delete the unused `ssh` block of `deploy.config.json`.

**FS-10 — a generated build artifact is tracked.** `SPORTA-BACKEND.zip` (715,797 bytes, 2026-11-04, last touched by commit `5ae2ecfb`) is in `git ls-files` although `.gitignore` lists it and `CLAUDE.md` says "never read it out of git".
Contents listed (no extraction): an old `api/` (admin.php 40 kB, store.php 60 kB), `api/seed.mysql.sql` (supplier cost column), `api/config.example.php`; no `config.php`. Old PHP is a stale copy of code with since-fixed findings. Fix: `git rm --cached SPORTA-BACKEND.zip`.

**FS-11 — supplier cost lives in files that sit in the web root and are protected only by `.htaccess`.**
`dropin/php-store/seed.mysql.sql:63-107` (`cost_aed` per variant), `schema.mysql.sql:98`, `install.mysql.sql:133`; `ahed-cost.php:1-8` (AHED wholesale cost per SKU in dirhams plus the dirham rate; guarded only at run time by `defined('SPORTA_ADMIN_AHED_COST')`, and **not** in the name list of `dropin/php-store/.htaccess:8`).
SQL is denied twice (`api/.htaccess:8` `.*\.sql`, root `public/.htaccess:522` `.sql`), and `file-audit.mjs:302-303` REQUIRES the SQL files in the package. Nothing is exposed today; one `AllowOverride None` or a copy to another folder away from it.
Also `public/.htaccess:522` denies `bak|old|orig|save|swp|sql|log|json|jsonl|sh|env|zip|tar|gz|mjs|ts|md` but not `.map`, `.pem`, `.key`, `.crt`, `.p12`, `.pfx`, `.yml/.yaml`, `.ini`, `.cnf`, `.conf`, `.csv`, `.tgz`, `.dump`. Fix: do not ship `seed/install/schema.mysql.sql` to `/docker/sporta/site/api/` (keep them in the repo and the zip's `database-sql/`), add `ahed-cost.php` to the deny list, extend the extension list.

**FS-12 — setup and diagnostic tools are in `public/`, `dist/` and the zip.**
`public/go-live.html` (probes `/.env`, `/.git/config`, `/knet/config.php`, `/knet/pay.php?trackid=GOLIVECHECK000`; `go-live.html:164-172,194`), `dropin/php-knet/selftest.php`
(unauthenticated; prints key length and DB reachability in test mode, switches itself off in production, `selftest.php:50`), `setup-config.php` (CLI only, `PHP_SAPI` guard), `api/setup-admin.php`, `api/preflight.php`.
They are denied by name (`public/.htaccess:533`, `php-knet/.htaccess` FilesMatch, `api/.htaccess:8`) and listed in `SETUP_TOOLS` so `vps-deploy.mjs` never sends them; `dist/go-live.html` exists and `make-package.mjs` puts the PHP ones in the zip. LIVE: not served. Fix: exclude them from `dist/` and from `bundle-php.mjs`, ship them only with `--setup-tools`.

**FS-13 — uploaded product photos keep their EXIF/GPS (owner decision, unmeasured).**
`CLAUDE.md` (lossless uploads) and `PHP-SCAN-2026-11-03.md:660`. The 51 images in `public/` and 47 sample photos in `dropin/images/` carry no EXIF, GPS, XMP or IPTC, but the real product folder is not in the repo or the capture, so the 46 live photos are unmeasured. Fix: a read-only VPS job that lists any `/images/products/*` with a GPS IFD; if some do, strip on upload or by a one-off script (this changes bytes, so it needs the owner's yes against the lossless rule).

**FS-14 — the admin's sign-in e-mail is kept in the browser.** `src/admin/AdminApp.jsx:451-455`: `localStorage['sporta.admin.email']` (address only, never the password). Convenience for the passcode step; on a shared device it names the admin. Fix: `sessionStorage`, or clear on sign-out.

### Info

- **I-1 Public by design (not findings):** `cs@sporta.com.kw` (37 hits in public, src, index.html and the live capture), `+965 2209 1914` / `wa.me/96522091914`, commercial licence `30199/2023` (`public/llms.txt:22`), Instagram/TikTok handles, JSON-LD (`index.html:102-140`), the shop address and social links from `?r=content`, the bank hosts in the CSP (`kpay.com.kw`, `kpaytest.com.kw`, `pg.cbk.com`, `pgtest.cbk.com`), `use.typekit.net`. No Google OAuth client id, reCAPTCHA site key, analytics or pixel id exists anywhere (the string searches for googleusercontent, gtag, GTM, fbq, recaptcha, sentry, mapbox, firebase, stripe, openai, anthropic returned only `robots.txt` bot names).
- **I-2 The admin URL is advertised:** `/backends` in `public/robots.txt:16,26,…` (18 mentions, one Disallow per crawler group), `public/backends.webmanifest:8-10`, `boot.js:9,50`, `backends-offline.html`; known and authenticated (HttpOnly, SameSite=Strict, `X-Sporta-Admin`), so recon only.
- **I-3 Admin route map in public JS:** `public/sporta-admin-brands.js` (every visitor can fetch it; live as loader + `.full.js` 957 kB) names about 42 admin routes and field names (`payment_config`, `payment_knet_via_cbk`, `knet_refund_record`, `assistant_settings_save`, `db_center`, `db_integrity`, `product_image_upload`, `variants_create`…) and `X-Sporta-Admin: 1`. Secret fields are write-only in the answers I read (`has_client_secret`, `has_encrp_key`, `has_resource_key`, `ai_key_set` booleans: `admin.php:766-804`, `assistant.php:4710-4713`). The cookie names (`__Host-sporta_admin`, `sporta_dev`, …) are in PHP only: no front-end file mentions them or `document.cookie` (except a comment in `.htaccess:419` and `Privacy.jsx:62`).
- **I-4 Supplier data in the bundle:** `src/lib/ahed.js` (live: `assets/index-BtzlNXGI.js`) ships AHED supplier SKUs, HS codes, gram weights, colours and fabric. No cost, no price (`ahed.js:5-6` states it; `grep cost|aed|wholesale|price` finds nothing). The wholesale cost table is admin-only (`admin.php:2489` `ahed_cost`).
- **I-5 False positives:** `credentials: 'same-origin'` (dozens of hits), error `token:` names, i18n labels containing "password"/"secret"/"ENCRP_KEY"/"Tranportal" (`api-BR6g486R.js`, `Payments-BBVqJIPC.js` in the capture: field labels and empty-string initial state), the `YOUR-PROJECT` / `your-anon-public-key` placeholders left from the Supabase era (`src/lib/runtimeConfig.js:22`), the doc-comment phone examples `96555501003` and `96598765432` (`sporta-admin-brands.js:5476,15857`), checkout placeholders `99887766`. Test fixtures with fake keys: `scripts/assistant-admin-test.mjs:55-57` (`sk-ant-…` x3), `assistant-admin-ui-test.mjs:42`, `native-backend-test.mjs:4129`, `unknown-files-test.mjs:68,233,626` (AWS's own example key and a made-up PEM). The pickaxe over history found exactly one commit (`306dd5e6`) and it is the `unknown-files-test.mjs` fixture.
- **I-6 Public answer details worth knowing:** `?r=invoice` with only the order number returns the first letter of the name, governorate, area, lines, totals and `discount_code`/`discount_label` (`api.php:722-759`); `?r=order` returns the sequential `order_id` to the buyer (`api.php:1196`), which tells any buyer the shop's order count; `?r=status` hides `id`/dates (`api.php:499`). The order number itself is made in the browser (`src/lib/attempt.js:18-21`, `SP` + two 32-bit values in base 36, about 64 bits, server accepts 10-30 alphanumerics: `api.php:800`).
- **I-7 Static header values are public:** `X-Sporta-Admin: 1`, `X-Sporta-Customer: 1` are CSRF markers, not secrets (cross-site `fetch` cannot add them without a preflight, and the API sends no CORS headers: `store.php:143-146`).
- **I-8 QA customer:** `qa-p…` (company domain, owner-approved) appears only in `CLAUDE.md` and the tracked fixtures `scripts/fixtures/account/account-in-{ar,en}.html`; not in `public/`, `src/`, `dist/` or the capture. No tokens or session ids in those fixtures. Keep the repo private; it also names the VPS IP (29 tracked files), the Hostinger VM id (18 files), and a plus-addressed test mailbox in `PHP-SCAN-2026-11-03.md:1020`.
- **I-9 Sandbox configs:** `dropin/php-store/config.php`, `php-knet/config.php`, `php-cbk/config.php` exist in the working tree (550-byte test rig values: `db_host` `loca…`, `db_pass` `tes…`, `cron_key` `san…`, order cooldown 0). Gitignored, untracked, test-only; `bundle-php.mjs` drops them. Do not run `npm run package`/`publish` from a tree where one of them holds real values under a name the filter does not know (FS-03).

## Public API response review (read from the PHP, plus the 2026-11-02 live captures)

| Route | Who can call | Fields returned | Verdict |
|---|---|---|---|
| `products` GET | anyone | slug, names, desc, price, list_price, on_sale, featured, featured_sort, category, image, images, no_exchange, brand slug/names/logo flag+hash | OK. No cost, supplier, stock, `active`, sale window (resolved server-side, `api.php:176-188`). Capture: 46 products, same keys |
| `slides`, `slide_image`, `brand_logo`, `brands` | anyone | listed columns only; promo-bar schedule removed; brands with no listed product left out | OK |
| `theme`, `text_style`, `content`, `shipping`, `checkout_config` | anyone | display settings; `content` = owner wording + contact block (public by definition); `checkout_config` = `delivery_fee`, `methods` (customer methods only), `default_method`, notices | OK. No gateway name/mode, no `knet_via_cbk`, no config key. Capture: `methods:["cod"]` |
| `stock` GET | anyone | slug, size, **sku, exact stock**, in_stock | **FS-01** |
| `status?id=` | order number | payment/fulfilment state, method, amount, events; receipt only with `?k=`, checkout phone or owner session | OK (number is ~64 bit, throttled 60/min) |
| `invoice?id=` | order number | limited view; full (name, address) with `?k=` (7 days), `X-Sporta-Phone` header, or the owner's session; phone never returned | OK, see I-6 |
| `return_lookup/submit`, `support_*` | order + checkout phone / ticket + e-mail | verified before details; same 404 for unknown and mismatch; cross-site refused | OK |
| `review_invite`, `review` | signed link | track id, full customer name, reward code | OK if `cron_key` is strong (FS-02) |
| `assistant` POST, `say` GET | anyone / signed text | answer text; order lookups give stage + amount only; `say` needs the HMAC | OK (FS-02 for the key) |
| `order` POST | anyone (throttled, cool-down) | `order_id`, `track_id`, `invoice_key`, amounts, method | OK, I-6 |
| `customer.php` | session | uniform answers for new/existing/unknown e-mail (`customer.php:79-128`) | OK |
| any route on a broken DB/config | anyone | error tokens, `cause`, `hint` | **FS-08** |

Never reaching a public route in the code I read (grep of `api.php`): `admin_alert_email`, `knet_via_cbk`, `n8n_secret`, `ai_key`, `tts_key`, `whatsapp_token`, `cost_aed`, `unit_cost_kwd`; `cron_key` appears only in comments (`api.php:584,1195`). Admin routes answer secrets as booleans only.

## `git ls-files | grep -iE '\.env|config\.php|secret|\.pem|\.key|dump|backup'` (run in `sporta-web`, same 9 hits repo-wide)

| Tracked file | What it is | Verdict |
|---|---|---|
| `.env.example`, `.env.deploy.example` | templates; every value empty or a public URL | intended |
| `CHECKOUT-SECRETS.md` | map of which secret feeds what; no values (key regexes find nothing) | false positive |
| `dropin/php-knet/setup-config.php` | CLI-only writer of `config.php` (0600) | tool, FS-12 |
| `dropin/php-store/seo-config.php` | SEO settings code | false positive |
| `ops/db/BACKUP.md`, `backup-install.mjs`, `db-backup.sh`, `scripts/db-backup-test.mjs` | backup tooling; login by stdin, key file mode 0400, no dump data | false positive |

Also tracked and worth a decision: `SPORTA-BACKEND.zip` (FS-10), `docs/live-schema-structure.sql` (structure only, 0 INSERT), `docs/archive-2026-08-11/{callback.php.txt,htaccess.txt}` (no secrets), `.mcp.json` (reads `${ELEVENLABS_API_KEY}`, no value), `.claude/settings.json` (permission list only), `mcp/hostinger-mcp.mjs` (token injected by the proxy, `proxy-injected` placeholder), `deploy.config.json` (FS-09). No `config.php`, `.env`, `.pem`, `.key`, `.p12`, dump or backup data is tracked.

## What could not be checked

- The live value and length of `cron_key`, any server file outside the repo, the live `/images/products/` bytes (EXIF), and today's live add-on bytes: only the 2026-11-02 capture and CLAUDE.md's deploy log exist here. A read-only VPS job (`scripts/live-files-scan.mjs`, `unknown-files-scan.mjs`) would answer those; I did not start one.
- Git history was searched for eight key families (Google API key and client secret, Stripe live key, PEM private key block with body, AWS access key, GitHub token, Slack token, Anthropic key, 60+ char). A weak password in a PHP array would not match them; `git grep` of the current tree for password literals found only `YOUR…` placeholders.
- Four Bash calls were refused by the `cc-plugin-privacy` hook (message about an e-mail address; none of those commands sent anything anywhere). The same local reads were redone with the Grep/Read/Glob tools or a rephrased command; no result depends on them.

## Fix order I would take

1. FS-01 (clamp `stock`) and FS-02 (`cron_key` sub-keys, length floor, deny `cron-*.php` on the web) in one reviewed API release; rotate `cron_key` afterwards.
2. FS-03 (ignore list, `skipName`, `FORBIDDEN`, content scan) — a repo-only change, no deploy needed; do it before anyone drops `api-config.php` next to the code.
3. FS-04, FS-05, FS-06, FS-07, FS-14 are text/behaviour edits in `src/` or `public/` (storefront or add-on deploy).
4. FS-08 to FS-12 as hardening in the next backend/package pass; FS-13 after one read-only look at the live photos.
