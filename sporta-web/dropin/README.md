# `dropin/` — the PHP that runs on the server

Everything here is copied into `dist/` by `npm run bundle:php` (part of
`npm run release`) and ends up in `public_html/`. None of it is bundled by
Vite; it is plain PHP 8 running on the Hostinger plan.

| Folder | Ships to | What it is |
|---|---|---|
| `php-store` | `public_html/api/` | **The backend.** MySQL on the same plan: catalogue, stock, orders, invoices, the admin API and its session auth. |
| `php-knet` | `public_html/knet/` | **KNET** — the checkout page where the customer pays with a Kuwaiti debit card (Tranportal ID + password + 16-byte AES resource key). |
| `php-cbk` | `public_html/pay/` | **T-Pay** — CBK's online payment link (ClientId + ClientSecret + ENCRP_KEY). |
| `scripts` | — | Not deployed. Old SFTP deploy helper; `npm run publish` (FTPS) is the live route. |

There is **one backend**. The shop, the admin and both gateways read and write
the same MySQL database, so `api/config.php`, `knet/config.php` and
`pay/config.php` all carry the same four `mysql_*` values.

## config.php never leaves the server

Each folder has a `config.example.php` and a real `config.php` that holds live
bank and database credentials. The real files are **never committed, never in
`SPORTA-GO-LIVE.zip`, and never uploaded** — `scripts/file-audit.mjs` fails the
build if one appears, and `npm run publish` will not overwrite the ones already
on the server. Create them once in hPanel File Manager and leave them there.

## Setting up

* `php-store/schema.mysql.sql` + `seed.mysql.sql` + `brands.mysql.sql` — run in
  hPanel → Databases → phpMyAdmin, in that order.
* `php-store/setup-admin.php` — creates the first admin sign-in.
* `php-knet/selftest.php` — visit it after uploading; it checks the AES key
  length, HTTPS, and that the orders database actually answers. **Delete it
  once every line reads OK**, along with `setup-config.php`; both report on
  configuration and neither belongs on a live site.

`sporta-web/NATIVE-BACKEND.md` is the full walkthrough, and
`sporta-web/CHECKOUT-SECRETS.md` maps every secret the money path needs to
what breaks without it.
