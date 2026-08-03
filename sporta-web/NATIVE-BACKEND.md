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

`npm run test:native` (36 checks) and `npm run test:native-e2e` (20 browser
checks) prove the contract against a real MariaDB and a real browser.

## What ships where

| Server path | Source | What it is |
|---|---|---|
| `public_html/api/` | `dropin/php-store/` | the native API (bundled into `dist/api/` by the build) |
| `public_html/api/config.php` | **created by you on the server** | DB credentials + warehouse email + cron key — never committed, never in the zip, never overwritten by `npm run publish` |

`api/.htaccess` denies `store.php`, `config.php`, the `.sql` files and the
example config by name, so only `api.php`, `admin.php`, `cron-fulfilment.php`
and (until you delete it) `setup-admin.php` answer over HTTP.

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
discount in seconds. Thirty FAILED lookups from one address in ten minutes is
the wall. Only failures are counted, so a customer re-checking a basket with a
code that works is never affected. The counter lives in the `rate_limit` table,
keyed by a hash of the IP (this is abuse control, not a visitor log) and swept
opportunistically, so it needs no cron.

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
storefront shows them. There is no delete — a brand with orders behind it is
history, and hiding it is the reversible answer.

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

## Day to day

- **Admin:** `https://www.sporta.com.kw/backends` — email + password (session
  cookie, HttpOnly, SameSite=Strict; 5 wrong passwords lock the account for
  15 minutes). Orders, inventory, stats, COD settlement all read MySQL.
- **Stock:** edit in the admin's Inventory tab, or directly in phpMyAdmin
  (`product_variants.stock`).
- **New products:** edit the catalogue
  (`sporta-html5/assets/products.js`), re-run
  `node scripts/generate-mysql-seed.mjs`, re-import `seed.mysql.sql` in
  phpMyAdmin, and publish the site.

## What went with the old backend

- **Device passcode quick-unlock.** It was built on hosted RPCs. The admin
  login is email + password, with a five-failure fifteen-minute lock.
- **Image uploads.** Product images ship with the site in `dist/` and category
  photos are uploaded in File Manager; brand logos are `data:` URIs in the
  database row. Nothing writes to the web root at runtime, by design.

Both are noted in the admin's Settings tab.
