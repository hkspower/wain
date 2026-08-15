# Where every file lives on the server, and why

The Hostinger account holds more than the website. This is the arrangement:
what belongs inside `public_html`, what must stay above it, what each folder is
allowed to be cached for, and how it is checked.

Two commands enforce most of it:

```
cd sporta-web
node scripts/storage-audit.mjs     # before deploying: is anything reachable that should not be?
./scan-server-response.sh          # after deploying: what does the live site actually return?
```

---

## The tree

```
/home/u130124229/                     ← the account root. NOT web-accessible.
├── knet-payments.log                 ← KNET payment audit trail (chmod 600, append-only)
├── cbk-payments.log                  ← T-Pay payment audit trail (chmod 600, append-only)
├── .cbk_token.json                   ← cached CBK AccessToken (chmod 600)
├── backups/                          ← anything you download before overwriting it
└── public_html/                      ← the web root. Everything here is public unless denied.
    ├── .htaccess                     ← HIDDEN. Routing, caching, and every deny rule.
    ├── index.html                    ← the app shell
    ├── config.js                     ← runtime endpoints. Edited in place, never overwritten.
    ├── assets/                        ← content-hashed JS/CSS. Cached for a year, immutable.
    ├── cats/
    │   ├── mobile/                    ← category art + your photos, phone-sized
    │   └── desktop/                   ← the same, desktop-sized
    ├── fonts/                         ← self-hosted woff2 subsets
    ├── knet/                          ← KNET (Tranportal) endpoints
    │   ├── config.php                 ← YOUR Tranportal credentials. Server-only. Denied.
    │   ├── pay.php  callback.php      ← the two entry points
    │   ├── knet.php                   ← library. Denied.
    │   └── api/index.php              ← JSON API for the mobile app
    ├── pay/                           ← CBK T-Pay endpoints
    │   ├── config.php                 ← YOUR ClientId/ClientSecret/ENCRP_KEY. Denied.
    │   ├── pay.php  callback.php      ← the two entry points
    │   └── cbk.php                    ← library. Denied.
    ├── favicon-32.png  favicon-192.png  favicon.png  apple-touch-icon.png
    ├── logo.png  logo-white.png  logo-white.webp  og-image.png
    ├── robots.txt  llms.txt  sitemap*.xml  site.webmanifest
    └── .well-known/                   ← must stay reachable: SSL renewal uses it
```

### Above the web root, on purpose

Two files hold live credentials or a customer-money trail, and neither is
defended by an Apache rule — they are simply not in a place Apache serves.

| File | Why it is up there |
|---|---|
| `cbk-payments.log` | The same for T-Pay, which had no trail at all until the two gateways were brought to parity. |
| `knet-payments.log` | Every payment attempt, with track IDs and amounts. A payment system with no trail cannot be reconciled or disputed, and a trail in the web root is a customer list waiting to be downloaded. |
| `.cbk_token.json` | A **bearer credential**: whoever holds it can call CBK as this merchant until it expires. Its old default was `public_html/pay/.cbk_token.json`, defended by three `.htaccess` rules. Rules are configuration, and configuration is the thing that breaks. |

Both are created by PHP on first use. If a path is not writable, set it in
`knet/config.php` / `pay/config.php` — `log_file` and `token_cache_file`.

### Never inside `public_html`

Not "should not" — these have each been found in a live web root on this
project, and `.htaccess` now denies the whole class so a stray one is inert:

- `.env`, `.git/`, `.DS_Store`, or anything else beginning with a dot
- `*.json` — the site ships **none** (the manifest is `.webmanifest`), so the
  class is denied wholesale. If you ever need to serve one, exempt that single
  filename; do not reopen the class.
- `*.sql`, `*.log`, `*.zip`, `*.tar`, `*.gz`, `*.bak`, `*.old`, `*.sh`,
  `*.mjs`, `*.ts`, `*.md`
- `index.php` — the previous site's front controller. It is still on the live
  server. `/index.php` used to answer **200 with the whole old site**; it now
  301s to `/` and the PHP is never executed. **Delete it anyway.**
- `sporta-deploy.php` — a deploy endpoint answering to the internet. Delete it.
  Publishing needs nothing on the server.

`npm run publish` lists every one of these it finds, on every run.

---

## Permissions

`644` on files, `755` on folders. `npm run publish` now applies these over FTPS
after it has verified the upload — the values were declared in
`deploy.config.json` from the beginning and nothing ever applied them, so files
landed with whatever the FTP account's umask happened to be.

This is not a rule of thumb. PHP runs as your own user, so nothing needs group
or world write; a folder needs `execute` to be traversable at all. **`777` is
never the answer** — on shared hosting it makes every file writable by anything
else running on the machine.

`config.js` and `knet/config.php` are never touched: not their contents, not
their modes. Set them to `600` in File Manager and they stay there.

If your FTP server refuses `SITE CHMOD`, publish says so in one line and
continues — a correct site is already on the server by that point.

---

## How long each folder may be cached

The rules live in `public/.htaccess`; `storage-audit.mjs` asserts each one
against a real Apache before you deploy.

| Path | `Cache-Control` | Why |
|---|---|---|
| `assets/*` | `max-age=31536000, immutable` | Content-hashed. The name changes when the bytes do, so it never needs revalidating. **Nothing else may claim this.** |
| `cats/**`, `fonts/*`, logos, icons | `max-age=2592000, stale-while-revalidate=604800` | Fixed names — a replaced logo must not be stuck for a year. After 30 days the old copy paints immediately while the new one loads. |
| `*.xml`, `*.txt`, `*.webmanifest` | `max-age=3600, stale-while-revalidate=86400` | Change only on deploy, and crawlers re-fetch them constantly. |
| `*.html` | `no-cache, stale-while-revalidate=60` | Revalidates on every visit, so a deploy is picked up next load — but paints from cache first. Safe because publish never deletes, so a 60-second-old shell's assets are still there. |
| `config.js` | `no-cache, must-revalidate` | You edit it in place. If it were cached, an edit would appear to do nothing. |
| `knet/*`, `pay/*` | `no-store, no-cache, must-revalidate, private` | Payment responses carry order state. Nothing caches them, anywhere. |

---

## There is no image upload, and that is deliberate

Nothing on this server accepts a file over HTTP. Product and category photos
are files the owner uploads in hPanel File Manager (`cats/*.jpg`); brand logos
are capped `data:` URIs stored **in the database row**, not on disk.

The ordinary path — an upload endpoint that writes into the web root — is the
same shape as `sporta-deploy.php`, which was found sitting in this
`public_html` answering to anyone on the internet. A directory that is both
writable by the application and served by Apache is the thing to avoid, not a
detail to configure carefully. So the web root is never written to at runtime,
by anything.

## Backups

There is no automatic backup of `public_html`, and `publish` never deletes, so
nothing is lost by deploying. What is worth keeping a copy of before you change
it, because it exists **only** on the server:

- `public_html/config.js`
- `public_html/knet/config.php`
- `public_html/pay/config.php`

Download those three into `backups/` (above the web root) and you can rebuild
the site from the repo at any time. Everything else in `public_html` comes from
`npm run publish` or `SPORTA-GO-LIVE.zip`.

Do not leave a `.zip` in `public_html`. `sporta-dist.zip` — the entire built
site — was sitting in the live web root, downloadable by anyone. The deny rules
cover the extension now, but the file should not be there at all.
