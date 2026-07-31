# The native backend — Sporta with no Supabase

The shop can run entirely on the Hostinger plan: MySQL for the data, PHP at
`/api` for the storefront and the admin, the same model the old OpenCart site
used. It is a **switch, not a migration** — one line in `public_html/config.js`
chooses the backend, the Supabase code paths are untouched, and flipping the
line back restores them.

```js
// public_html/config.js  (edit in hPanel File Manager — no rebuild needed)
window.SPORTA_CONFIG = {
  backend: 'php',        // ← 'php' = native MySQL backend. Remove (or '') = Supabase.
  // ...the Supabase keys can stay; they are ignored while backend is 'php'.
}
```

Both backends enforce the same contract — same validation tokens, same
response shapes — so every screen (product page, checkout, invoice, tracking,
the whole admin) works identically on either. `npm run test:native` (36 checks)
and `npm run test:native-e2e` (14 browser checks) prove it against a real
MariaDB and a real browser.

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

6. **Flip the switch.** Edit `public_html/config.js`: add `backend: 'php'`.
   The change is live on the next page load — no build, no deploy.

7. **The warehouse emails.** hPanel → Advanced → Cron Jobs, every 5 minutes:

   ```
   wget -qO- "https://www.sporta.com.kw/api/cron-fulfilment.php?key=YOUR_CRON_KEY"
   ```

   Same outbox model as the Supabase path: the message is written in the same
   transaction as the order, the cron drains it, up to 5 attempts. The mail
   still needs the SPF/DKIM/DMARC records from `DNS-EMAIL-RECORDS.txt` or it
   goes to spam.

8. **KNET — REQUIRED if you take cards.** In `knet/config.php` on the server,
   add the MySQL block:

   ```php
   'store'      => 'mysql',
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

   Visit `knet/selftest.php` afterwards: it names the database it will use and
   says so loudly if there is none. Delete that file when you are done.

## Day to day

- **Admin:** `https://www.sporta.com.kw/admin` — email + password (session
  cookie, HttpOnly, SameSite=Strict; 5 wrong passwords lock the account for
  15 minutes). Orders, inventory, stats, COD settlement all read MySQL.
- **Stock:** edit in the admin's Inventory tab, or directly in phpMyAdmin
  (`product_variants.stock`).
- **New products:** edit the catalogue
  (`sporta-html5/assets/products.js`), re-run
  `node scripts/generate-mysql-seed.mjs`, re-import `seed.mysql.sql` in
  phpMyAdmin, and publish the site.

## What the native mode does not have

- **Device passcode quick-unlock** (a Supabase RPC feature) — the admin login
  is email + password.
- **Supabase Storage image uploads** — product images ship with the site in
  `dist/`, which is how the shop works today anyway.

Both are noted inside the admin's Settings/Images tabs when native mode is on.

## Switching back

Remove `backend: 'php'` from `config.js`. Supabase resumes exactly where it
was. Orders taken while on MySQL stay in MySQL — the two databases are
separate; run one backend at a time and treat the other as the fallback.
