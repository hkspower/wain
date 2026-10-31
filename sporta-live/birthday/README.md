# Birthday picker + birthday gift — live add-on

Live on www.sporta.com.kw since 2026-10-31 (VPS `srv2058651`, container `apache-sporta-1`).
The storefront there is a compiled bundle whose source is not in this repo, so this ships
as an add-on and is kept here as the source of truth.

| File | Live path | What it does |
|---|---|---|
| `birthday.js` | `site/birthday.js` (loaded `defer` from `index.html`) | Adds Day / Month / Year lists to the sign-up form (`#customer-name`) and a "Your birthday" panel to My account (`#customer-profile-name`). Arabic/English, follows the language toggle, re-mounts after React re-renders. |
| `birthday.php` | `site/api/birthday.php` | `GET ?r=get`, `POST ?r=set` for the signed-in customer. Same guards as `customer.php` (X-Sporta-Customer header, JSON, no cross-site). |
| `birthday-lib.php` | `site/api/birthday-lib.php` (403 from the web) | Rules: date validation, 29 Feb → 28 Feb in common years, 30-day settle, settings. |
| `cron-birthday.php` | `site/api/cron-birthday.php` | Daily: mints one single-use `BDAY…` percent code per due customer (row-locked, one per year), emails it in Arabic + English; a failed email deletes the code and keeps the year open. |
| `birthday.mysql.sql` | applied to `customer_accounts` | `birthday`, `birthday_set_at`, `birthday_sent_year`. |

Schedule: `/etc/cron.d/sporta-cron` → `7 6 * * *` (06:07 UTC = 09:07 Kuwait):
`docker exec -u www-data apache-sporta-1 php /var/www/html/api/cron-birthday.php --send`.
`--dry` lists who is due without sending.

Settings (`settings` row `birthday`, JSON; defaults if absent): `enabled` true, `percent` 10
(1–50), `days` 14 (1–60).

Rules: a date must be on file 30 days before it earns a gift (so typing "today" mints
nothing); changing the date restarts that clock; one gift per calendar year.

Tests: `node test/browser-test.cjs` (21 checks, mock of the live form markup);
live end-to-end run 2026-10-31: register → set → get → bad date 400 → no-header 403 →
not due when fresh → due after 40 days → code accepted by `store_discounts_for`
(10% of 20 KWD = 2 KWD), all inside a rolled-back transaction / deleted test account.
