# The backend

The shop runs entirely on the Hostinger plan: MySQL for the data, PHP at `/api`
for the storefront and the admin, the same model the old OpenCart site used.
Everything the site needs is on one server, under one set of credentials.

This used to be one of two backends, chosen at runtime by a `backend` line in
`config.js`, with a hosted Postgres service as the other. **That is gone.** Two
backends meant every rule existed twice — validation tokens, price authority,
the fulfilment outbox, the shapes the admin screens read — and a fix applied to
one was a bug waiting in the other. Not a theory: the KNET dropin was hardened
against a browser-supplied price and the T-Pay dropin was not, and it stayed
that way until a test went looking for it. There is one of everything now.

`config.js` still exists and is still edited in File Manager without a rebuild,
but it now holds only endpoints, all of which have working defaults:

```js
// public_html/config.js  (edit in hPanel File Manager — no rebuild needed)
window.SPORTA_CONFIG = {}   // correct as-is: /api, /knet and /pay are the defaults
```

`npm run test:native` (412 checks) and `npm run test:native-e2e` (26 browser
checks) prove the contract against a real MariaDB and a real browser.

## What ships where

| Server path | Source | What it is |
|---|---|---|
| `public_html/api/` | `dropin/php-store/` | the native API (bundled into `dist/api/` by the build) |
| `public_html/api/config.php` | **created by you on the server** | DB credentials + warehouse email + cron key — never committed, never in the zip, never overwritten by `npm run publish` |

`api/.htaccess` denies `store.php`, `config.php`, the `.sql` files and the
example config by name, so only `api.php`, `admin.php`, `cron-fulfilment.php`,
`cron-voice.php` and (until you delete it) `setup-admin.php` answer over HTTP.

## Setup — once, in hPanel (~15 minutes)

1. **Create the database.** hPanel → Databases → MySQL Databases → create a
   database + user (Hostinger names them like `u130124229_sporta`). Note all
   three values.

2. **Import the schema, then the seed.** hPanel → Databases → phpMyAdmin →
   select the new database → Import:
   0. `dropin/php-store/install.mysql.sql` — **all of the below in one import.**
      Use this unless you need a single part re-run.
   1. `dropin/php-store/schema.mysql.sql` (tables)
   2. `dropin/php-store/seed.mysql.sql` (46 products, 42 stock rows)

   The seed is safe to re-run later — it updates prices/names in place and
   **never overwrites stock**. It is regenerated from the catalogue by
   `node scripts/generate-mysql-seed.mjs`; do not hand-edit it.

3. **Upload the site** as usual (`npm run publish`, or the zip into File
   Manager). The build already contains `api/`.

4. **Create `api/config.php`.** In File Manager, copy
   `api/config.example.php` → `api/config.php` and fill in the DB values,
   `warehouse_email`, and a long random `cron_key`.

5. **Create your admin login.** Visit
   `https://www.sporta.com.kw/api/setup-admin.php?key=YOUR_CRON_KEY`,
   set your email + password (12 characters minimum), then **delete
   `setup-admin.php` from the server**. It only works while the admin table is
   empty and only with the cron key, but a setup tool has no business staying
   on a live server. (`npm run publish` never re-uploads it.)

6. **The warehouse emails.** hPanel → Advanced → Cron Jobs, every 5 minutes:

   ```
   wget -qO- "https://www.sporta.com.kw/api/cron-fulfilment.php?key=YOUR_CRON_KEY"
   ```

   A transactional outbox: the message is written in the same transaction as
   the order, so it cannot go missing, and the cron drains it with up to 5
   attempts. The mail still needs the SPF/DKIM/DMARC records from
   `DNS-EMAIL-RECORDS.txt` or it goes to spam.

7. **KNET and T-Pay — REQUIRED if you take cards.** In `knet/config.php` and
   `pay/config.php` on the server, fill in the MySQL block:

   ```php
   'mysql_host' => 'localhost',
   'mysql_name' => '...',   // same values as api/config.php
   'mysql_user' => '...',
   'mysql_pass' => '...',
   ```

   **The card path does not work without this**, and it fails bluntly: every
   payment is refused with "400 Invalid amount", because the price must come
   from the database and there is no database to read it from. With the block
   in place, `pay.php` charges the stored order total, and the bank's callback
   settles the order in MySQL (never downgrading a paid one) and queues the
   "payment received / collect cash" follow-up in the same transaction.

   Visit `knet/selftest.php` afterwards: it connects to that database and says
   so loudly if it cannot. Delete that file when you are done.

   Note the key names differ by file and that is not a mistake to "fix":
   `api/config.php` spells them `db_host`/`db_name`/`db_user`/`db_pass`, the
   two gateway configs spell them `mysql_*`. Same four values, same database.

## Home slides, promotions and discounts

Four admin screens, one migration (`api/promo.mysql.sql` — already inside
`schema.mysql.sql` on a fresh install, and safe to run twice).

**Slides** is the home hero. Upload a photograph and it is downscaled to 1600px
WebP *in your browser* before it is sent, so a picture straight off a phone is
fine. It is stored in the database row, not as a file — the same rule the brand
logos follow, because an endpoint that writes into the web root is a way in.
The bytes are then served by `api/api.php?r=slide_image` with a content hash in
the URL and a one-year cache, so the page pays exactly what it would have paid
for a file.

Per slide: a headline, a line under it and a button in both languages, plus a
**focal point**. That last one matters — the slide crops to fill and crops
differently on a phone than on a desktop, so the focal point marks the part
that must survive, usually the athlete's face. Above the list: **speed**
(2–30 seconds), **shuffle**, **advance on its own**, and **size** (short, tall,
full height). Pausing on hover, on keyboard focus and for reduced-motion is not
a setting; it is a requirement and it always applies.

With no slides, the home page shows the drawn artwork it ships with.

**Promotions** covers the three surfaces a promotion actually uses:

* a **sale price** on a product — "was 12.000, now 9.000", optionally dated.
  It is stored alongside the list price, so ending a sale is one click and
  nobody has to remember the original. **Checkout charges it**, computed
  server-side from the same row the shop displays.
* the **featured** row the home page leads with, and its order;
* the **promo bar** across the top of every page, in both languages.

**Discounts** are codes the customer types and rules that apply themselves.
Percent or fixed, an optional minimum, an optional category, optional start and
end dates (in UTC — Kuwait is UTC+3, and the screen says so), and an optional
usage limit.

They stack in a fixed order: every qualifying automatic rule, best first, then
at most one typed code. The total is capped at **60% of the order** — the
backstop against two reasonable discounts adding up to a free one — with 90%
the ceiling on any single rule. A single-use code is claimed inside the order's
own transaction, so eight simultaneous checkouts cannot all take the last one.

An unusable code always says **why** — expired, below the minimum, already used
up — because "invalid code" for a code that is real sends the customer hunting
for a typo that is not there.

There is no free-delivery discount type: delivery is already free, so it would
be a discount off nothing.

### Two things that protect it

**The discount endpoint is throttled.** `?r=discount` answers "is this code
real?" to anyone, which makes it an oracle — and an unthrottled oracle is a
code generator: a script walks SAVE10, SAVE15, SAVE20 and finds every live
discount in seconds. Thirty FAILED lookups from one client in ten minutes is
the wall, and the order route shares the same budget when a code is typed.
Only failures are counted, so a customer re-checking a basket with a code that
works costs nothing — but once a client is at the wall, EVERY lookup from it is
refused, right codes included, because a 429 that only wrong codes get would
itself say "wrong". The counter lives in the `rate_limit` table, keyed by an
HMAC of the client (this is abuse control, not a visitor log) and swept
opportunistically, so it needs no cron. See "Rate limits" below for the rest.

**A cancelled order gives its discount uses back.** A limited code is claimed
inside the order's transaction; an order that never happens (declined,
abandoned at the bank, an expired cash order, cancelled) now returns its uses
when `cron-stock.php --release` sweeps it, once, guarded by
`orders.discount_released`. Paid orders keep theirs. Needs
`api/discount-release.mysql.sql` imported (already in `schema.mysql.sql` and
`install.mysql.sql`); until it is, nothing is recorded and nothing is given
back.

**The admin session cookie is Secure behind the proxy.** Hostinger terminates
TLS at a proxy, so PHP sees plain HTTP on a request the browser made over
https://. Reading `$_SERVER['HTTPS']` alone left the cookie without the Secure
flag on the live site; `store_is_https()` checks the same three signals the
payment endpoints have always checked.

### The rule underneath all of it

The browser may name a **code**. It may never name an **amount**. `pay.php`
charges `orders.amount`, so anything able to move that figure is able to move
what the bank collects. The checkout's coupon preview and the order itself call
the same two functions in `store.php`, which is why the number quoted and the
number charged cannot disagree.

## Brands

The admin's **Brands** tab manages the brands the shop carries: English and
Arabic name, a logo, the order they appear in, and a switch for whether the
storefront shows them. Hiding is the reversible answer; removing for good
(`brand_delete`) is refused with 409 `brand_in_use` while any product, shown or
hidden, still carries the brand.

**Which products a brand has** travels with the brand, because a brand with
nothing behind it sends a shopper to an empty `/shop?brand=<slug>`:

| Route | Adds / does |
|---|---|
| `api.php?r=brands` (public) | Active brands **with at least one listed product** only — an empty brand stays off the storefront until a product is tagged ("hide it until tagged", owner, 2026-11-02). `products` — integer count (≥ 1) of **active** products tagged with the brand. Still no `logo` (that is `?r=brand_logo`). |
| `admin.php?r=brands` | `products` (every tagged product, shown or hidden — what `brand_in_use` counts) and `products_active` (the public figure). |
| `admin.php?r=brand_products` | `[{slug, name_en, name_ar, brand_slug, active, category}]` for every product, ordered by `name_en`. No prices, costs or images. |
| `POST admin.php?r=brand_assign` | Body `{brand_slug: "<slug>" \| null, products: ["<slug>", …]}` → `{updated, skipped}`. Tags (or, with `null` or exactly `""`, untags) up to 200 products in one `UPDATE`. The brand may be hidden but must exist (`unknown_brand` — whitespace alone is one, never a clear); the `brand_slug` key must be present and `products` must be a 1–200 array of strings (`bad_request`); unknown product slugs are skipped and counted — "unknown" as the database compares slugs (case and trailing spaces ignored), so a known product in another spelling is tagged, not skipped. `updated` counts rows whose brand actually changed. A slug over 64 characters — the width of `products.brand_slug` — is `brand_slug_too_long`. Logged in the activity log. |

Both counts are one grouped pass over `products` (indexed on `brand_slug`), not
a query per brand. Proven in `npm run test:native` ("brands: counts and bulk
tagging").

**If your shop was set up before this feature**, import
`api/brands.mysql.sql` once in phpMyAdmin. Fresh installs already have the
table from `schema.mysql.sql`.

The logo is stored **in the database**, as a capped `data:` URL, not as a file.
That is deliberate: uploading would mean a PHP endpoint that writes into the
web root, which this project forbids outright — the live server already had one
such endpoint, `sporta-deploy.php`, answering to anyone on the internet. The admin
downscales the image to 320px in the browser before sending it, so a photo
straight off a phone is fine. PNG, JPEG and WebP only — never SVG, which is a
document that can carry script and would be served from our own origin.

## Rate limits

Every counter is a row in `rate_limit`, keyed by an HMAC (`rate_limit_secret`,
or a key derived from the DB credentials when it is unset), in a fixed window.
**Per client** means the address `trusted_proxy_ips` lets the server see — an
IPv4 address as it is, an IPv6 client by its **/64** (a phone can use any
address in its /64; an IPv4-mapped address counts as the IPv4 it carries).
**Per account** means the normalised email or the account id, from any
address — the limits that used to say "per email" were really per (email,
address), and rotating addresses walked straight past them. One
implementation, in `api/config-path.php`, shared by the store, KNET and T-Pay.

| Where | Limit | Over it |
|---|---|---|
| `api.php` every route | per route (`$STORE_LIMITS`); unlisted routes 60/min | 429 `too_many_attempts` |
| `api.php?r=order` | 20 / 10 min per client; **20 units per order, 10 per size**, every payment method | 400 `order_too_large` |
| `api.php?r=order`, the next order | **one order a minute** (`order_cooldown_seconds`, default 60, 0 = off): after an ACCEPTED order, the same client and the same phone get no NEW order for 60 s, sliding from the order's own second. A retry of the same attempt (same `track_id`) still gets its order back; an order the bank declined or the shop cancelled holds nothing. Proven by `npm run test:order-cooldown` | 429 `previous_order_pending` + `retry_after` (the live checkout words it "an earlier attempt may already have created an order") |
| `api.php?r=discount`, and `?r=order` with a code | 30 FAILED codes / 10 min per client, one budget for both; once full, every lookup is refused | 429 |
| cash on delivery | 3 open orders per phone; an order still pending + unfulfilled after `cod_hold_hours` (default 24, 0 = off) is cancelled and its stock put back | 409 `too_many_open_cod` |
| admin sign-in, password | 20 / 15 min per client; 5 / 15 min per account — or, on a browser that has signed in before (`sporta_dev` cookie, 180 days), 5 / 15 min for that browser. A wrong password locks no account. A reset empties the account window. | 429 `too_many_attempts` |
| admin sign-in, phone code | 10 / 5 min per client; 5 wrong codes lock the account 15 min; at most 20 code checks per account per day (recovery codes exempt); the account is emailed once per lock and once per day | 429 `locked` |
| admin `forgot_password` | 8 / 15 min per client; 3 mails / 30 min per address; answered before any lookup, so timing says nothing | 429 (client) / silent (address) |
| customer `login` | 20 / 15 min per client; 10 / 15 min per account; a reset empties the account window | 429 |
| customer `forgot_password` | 10 / 15 min per client; 3 mails an hour and 10 a day per address | silent: `{ok:true}` either way |
| customer `change_password` | 10 / 15 min per client; 5 / 15 min per account, then the session is ended | 401 `not_authenticated` |
| `/pay/pay.php` (T-Pay) | 10 starts / min per client; 10 attempts per order (`CBK_MAX_ATTEMPTS`), refused before any call to CBK | 429 text |
| `/pay/callback.php` (T-Pay) | 30 / min per client; a bad `encrp` (Status −1) is never retried; a stale key (Status 0) earns one fresh key per 10 minutes | 429 text |

**Behind a proxy, `trusted_proxy_ips` must name it** (on the VPS, Traefik's
network). With it empty every shopper is one client, and every per-client
limit above is shared by the whole shop. KNET and T-Pay read it from the
store's config. Reset rows (`request_ip`) and the payment logs record the
client the same way.

## Day to day

- **Admin:** `https://www.sporta.com.kw/backends` — email + password (session
  cookie, HttpOnly, SameSite=Strict; password attempts are limited per
  account and per browser — see "Rate limits"; five wrong phone codes lock the
  account for 15 minutes). **A browser stays signed in 30 days; 7 days without
  use signs it out** (`STORE_ADMIN_ABSOLUTE_SECONDS` / `_IDLE_SECONDS`);
  sign-out, a password reset or a change to the authenticator ends every
  session at once. The cookie is persistent, and the session files live in a
  directory of their own above the web root (`admin_session_dir`, else
  `/var/lib/sporta/admin-sessions` on the VPS, else the account home, else the
  temp dir) with PHP's sweep set to the same 30 days: PHP's default sweep
  (24 minutes, in a path every session shares) used to sign an idle admin out
  long before the coded expiry. A request that carries NO session cookie
  (`?r=me` from a visitor, a scanner, any unknown `?r=`) makes no session: no
  file, no `Set-Cookie`. Files in that directory live 30 days, so one per
  anonymous request would have been ~345,000 inodes a day from a single address
  at the 240/minute limit. Sessions are created only where they must be (a
  granted sign-in, the pending phone-code and password-change steps), and a
  cookie that names no stored session is ended on the spot
  (`store_session_resume()`). The Google sign-in flow session lives in PHP's
  default path, never in the admin directory. Proven by
  `npm run test:admin-session`.
  Orders, inventory, stats, COD settlement all read MySQL.
- **Stock:** edit in the admin's Inventory tab, or directly in phpMyAdmin
  (`product_variants.stock`).
- **New products:** edit the catalogue
  (`sporta-html5/assets/products.js`), re-run
  `node scripts/generate-mysql-seed.mjs`, re-import `seed.mysql.sql` in
  phpMyAdmin, and publish the site.

### Warehouse mail, settling a card by hand, abandoned card orders

Each rule below is held by a check that was proven to FAIL with the rule taken
out (2026-11-03, release-gate store lane, round 1): the shipped/delivered
`reinstate` close, the reinstate of a picking list closed as `order cancelled`,
the mail sent without the order lock, `card_settled` claiming stock again, the
abandoned no-stock card order, the cookieless admin request, the Google link
flow and the per-/64 assistant handoff ration each failed their suite
(`test:native`, `test:admin-session`, `test:assistant`) when reverted, and
pass with the code as it is.

- **The drain never holds an order's row lock while it mails**
  (`cron-fulfilment.php`): it decides under the lock and marks the row in flight,
  mails with no lock held, then records the result under the lock again. A
  stalled relay can no longer make a bank callback fail with a lock timeout.
  An in-flight row reads as sent (`sent_at` set, `last_error = 'sending'`); a run
  that dies mid-send is repaired by the next one.
- **A message that fails is retried, not abandoned.** Five attempts on
  consecutive runs; then, in the first `warehouse_retry_window_minutes` of each
  hour (config key, default 10, `0` = off), up to 24 in all. The fifth failure
  and the last each write one Activity row naming the kind and the order:
  `warehouse_mail_failed_<kind>_<track>`, `warehouse_mail_gave_up_<kind>_<track>`.
- **`card_settled` claims the garments again** when the sweeper had released the
  order's hold (`stock_released = 1` on an order that was never cancelled), and
  is refused with the checkout's own `out_of_stock_<slug>_<size>_<left>` (409)
  when that size has sold since; discount uses are claimed again too
  (`discount_used_up`, 409).
- **`cron-stock.php` finds an abandoned card order that claimed no stock** (an
  accessories-only KNET / T-Pay order whose hold has passed), cancels it and
  gives its discount uses back.
- **`store_stock_release()` and `cron-stock.php` release a cancelled order that
  is under review** (`payment_status = 'review'`, `fulfilment_status =
  'cancelled'`): its garments go back on the shelf and its discount uses back to
  the code. Before, every release path excluded `review`, so an owner who
  refunded a mismatched capture and cancelled the order left the shelf short for
  ever. A review order that is not cancelled, and a paid one, still hold
  everything. No schema change: the existing `stock_released` /
  `discount_released` flags stop a second release.

## What went with the old backend

- **Device passcode quick-unlock.** It was built on hosted RPCs. The admin
  login is email + password (plus a phone code where MFA is on), limited as
  described under "Rate limits".
- **Image uploads.** Product images ship with the site in `dist/` and category
  photos are uploaded in File Manager; brand logos are `data:` URIs in the
  database row. Nothing writes to the web root at runtime, by design.

Both are noted in the admin's Settings tab.
