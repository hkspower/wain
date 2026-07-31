# Checkout secrets — every value the money path needs

Everything a customer's payment touches, in the order it touches it, with the
one question that matters against each: **what breaks if this is missing?**

Nothing in this file is a secret. It is the *map* of the secrets: where each
one comes from, which file it goes in on the server, and how to prove it
landed. The values themselves live only on the server and in the account they
were issued from — never in the repo, never in the zip, never in chat.

**Ground rule.** Four files hold everything, and none of them is ever
committed, packaged, or overwritten by a deploy:

| File | Holds |
|---|---|
| `public_html/config.js` | which backend, where the gateways are (public values) |
| `public_html/api/config.php` | MySQL password, warehouse email, cron key |
| `public_html/knet/config.php` | Tranportal ID, password, 16-byte resource key |
| `public_html/pay/config.php` | CBK ClientId, ClientSecret, ENCRP_KEY |

`npm run publish` has all four in a hard-coded never-touch list, and
`npm run package` refuses to build a zip that contains any of them.

---

## Step 0 — decide the backend first

Everything else follows from this one line, because the payment endpoints have
to read orders out of the *same* database the storefront wrote them to.

```js
// public_html/config.js
window.SPORTA_CONFIG = { backend: 'php', /* … */ }
```

* `backend: 'php'` → **native**: MySQL on this Hostinger plan. Fill in the
  `store => mysql` blocks below.
* anything else → **Supabase**. Fill in the `supabase_*` blocks below.

Mixing them is the failure that hides longest: the shop writes orders to one
database and the gateway looks for them in another, so every payment is
refused for an order that plainly exists.

---

## Step 1 — the orders database (`api/config.php`)

Copy `api/config.example.php` → `api/config.php`.

| Key | Where it comes from | Missing → |
|---|---|---|
| `db_host` | `localhost` on Hostinger | — |
| `db_name` `db_user` `db_pass` | hPanel → Databases → MySQL Databases | **the whole shop is down**: no catalogue, no orders, no admin |
| `warehouse_email` | your logistics company | orders are taken and **nobody is told to ship them** |
| `mail_from` | an address on `sporta.com.kw` | mail is sent as the server's default and lands in spam |
| `mail_reply_to` | `cs@sporta.com.kw` | the warehouse cannot reply to a human |
| `cron_key` | invent one — 32+ random characters | the fulfilment cron is either open to the internet or refuses to run |

**Verify:** `https://www.sporta.com.kw/admin` signs in and Orders loads.

*Supabase instead?* Then this file is not used; the equivalents are the
project URL and **service_role** key in `config.js` + the payment configs.

---

## Step 2 — KNET, the debit-card page (`knet/config.php`)

Copy `knet/config.example.php` → `knet/config.php`. Credentials come from
**CBK's KNET/Tranportal activation** — a different activation from T-Pay.

| Key | Where it comes from | Missing → |
|---|---|---|
| `tranportal_id` | CBK KNET activation letter | every payment rejected by the gateway |
| `tranportal_password` | same letter | same |
| `resource_key` | same letter — **exactly 16 characters** | KNET rejects every transaction **with no useful error**. A trailing space from a copy/paste is the usual cause; `selftest.php` counts the bytes for you |
| `env` | `'test'` until CBK confirms live, then `'production'` | you test against the live gateway, or take real money on the test one |
| `response_url` `error_url` | `https://www.sporta.com.kw/knet/callback.php` | the bank has nowhere to report the result |
| `result_page_url` | `https://www.sporta.com.kw/payment/result` | the customer is left on a blank page after paying |
| **`store` + `mysql_*`** (native only) | same values as `api/config.php` | **every card payment fails with "400 Invalid amount"** and nothing is ever recorded |
| `callback_response` | leave `'both'` | see the question for CBK below |
| `log_file` | leave as-is (above `public_html`) | no audit trail — disputes cannot be settled |

**Register with CBK:** the response and error URLs above must be the ones on
file at the bank, or the result never comes back.

**Verify:** `https://www.sporta.com.kw/knet/selftest.php` — every line OK,
including `mysql : connected`. **Then delete that file.**

---

## Step 3 — T-Pay, the online payment link (`pay/config.php`)

Copy `pay/config.example.php` → `pay/config.php`. **Different product, different
activation, different credentials** — from the same bank. KNET credentials do
not work here and T-Pay credentials do not work in `/knet`.

| Key | Where it comes from | Missing → |
|---|---|---|
| `client_id` | CBK T-Pay activation | no access token; every payment refused |
| `client_secret` | same | same |
| `encrp_key` | same | CBK cannot identify the merchant account |
| `test_base` / `production_base` | CBK gives both URLs | requests go nowhere |
| `env` | `'test'` → `'production'` | as above |
| `return_url` | `https://www.sporta.com.kw/pay/callback.php` | no result comes back |
| `result_page_url` | `https://www.sporta.com.kw/payment/result` | customer stranded |
| **`store` + `mysql_*`** (native only) | same values as `api/config.php` | **every T-Pay payment refused** and nothing recorded |
| `token_cache_file` | leave as-is — **above** `public_html` | a live bearer token becomes fetchable over HTTP |

**Verify:** place a 0.100 KWD test order, choose T-Pay, and confirm the order
turns `paid` in the admin.

---

## Step 4 — cash on delivery

No secrets. It needs Step 1 only. Worth stating because it is the one payment
method that can go live before the bank finishes anything.

---

## Step 5 — the warehouse email actually arriving

Orders are queued the moment they are placed; a cron drains the queue.

1. **The cron** — hPanel → Advanced → Cron Jobs, every 5 minutes:
   ```
   wget -qO- "https://www.sporta.com.kw/api/cron-fulfilment.php?key=YOUR_CRON_KEY"
   ```
   Missing → the queue fills up and the warehouse hears nothing.

2. **DNS: SPF, DKIM, DMARC** — the records in `DNS-EMAIL-RECORDS.txt`, added at
   the domain's DNS. Missing → the mail is sent and **silently spam-filtered**,
   which looks exactly like everything working.

*Supabase instead?* The `WAREHOUSE_EMAIL` secret on the `notify-warehouse` Edge
Function, plus the same DNS records.

---

## The one question only CBK can answer

> After a payment, does KNET **redirect the customer's browser** to our
> responseURL, or does it call that URL **server-to-server** and read a
> `REDIRECT=` line out of the reply?

The code answers both ways by default, so you are covered either way — but the
answer is worth having on file. Only if they say "browser redirect" may you set
`'callback_response' => 'redirect'`.

---

## Order of operations

1. Backend chosen in `config.js` · 2. `api/config.php` · 3. admin signs in ·
4. cash order end-to-end · 5. `knet/config.php` in **test** · 6. 0.100 KWD real
card · 7. `pay/config.php` in test · 8. T-Pay test · 9. DNS records · 10. flip
both to `production` · 11. **delete `selftest.php` and `setup-admin.php`**.

Cash can go live at step 4. Nothing else should.

---

## Checklist

```
[ ] config.js — backend decided
[ ] api/config.php — db_name / db_user / db_pass
[ ] api/config.php — warehouse_email, mail_from, mail_reply_to
[ ] api/config.php — cron_key (32+ random chars)
[ ] knet/config.php — tranportal_id / password / resource_key (16 chars!)
[ ] knet/config.php — store + mysql_* (native backend only)
[ ] knet callback URL registered with CBK
[ ] pay/config.php — client_id / client_secret / encrp_key
[ ] pay/config.php — store + mysql_* (native backend only)
[ ] cron job for cron-fulfilment.php
[ ] SPF + DKIM + DMARC records
[ ] env flipped to 'production' in BOTH knet and pay
[ ] selftest.php and setup-admin.php deleted from the server
```

---

## If a value leaks

Rotate it, do not just remove it. Tranportal password and resource key: CBK
reissues. T-Pay ClientSecret: CBK reissues. MySQL password: hPanel → Databases
(then update `api/config.php`, `knet/config.php` and `pay/config.php` together
— all three hold it). Supabase service key: dashboard → API → rotate. Cron key:
change it in `api/config.php` and in the cron line at the same moment.
