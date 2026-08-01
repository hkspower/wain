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
