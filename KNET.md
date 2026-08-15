# KNET payments — full structure and plan

Everything about how Sporta takes money, in one place: what each piece does,
what the money path actually is, where the money-safety guarantees come from,
what is verified, and what is left to do.

Sporta uses **classic KNET (KPG)** — the AES-`trandata` model, native PHP on
Hostinger. Credentials come from the acquiring bank (CBK) as a **Tranportal**
set, not from KNET Co directly. The alternative CBK REST-JSON T-Pay model lives
in `sporta-web/dropin/php-cbk/` and is **not** what is deployed.

---

## 1. Structure

### 1.1 Where the code lives

| Path | Ships to | Role |
|---|---|---|
| `sporta-web/dropin/php-knet/knet.php` | `public_html/knet/` | Crypto + helpers. AES-128-CBC, HTTPS guard, order lookup, audit log. Never served (denied in `.htaccess`). |
| `sporta-web/dropin/php-knet/pay.php` | `public_html/knet/` | Starts a payment. Prices the order server-side, builds encrypted `trandata`, redirects to KNET. |
| `sporta-web/dropin/php-knet/callback.php` | `public_html/knet/` | Receives KNET's result. Decrypts, verifies, writes the order, redirects the customer. |
| `sporta-web/dropin/php-knet/config.example.php` | — | Template. |
| ~~`php-knet/api/index.php`~~ | — | **Does not exist.** This table listed a JSON API for the Flutter app; there is no such file and no `api/` directory under `php-knet/`. The Flutter skeleton in `sporta-app/` is unbuilt. Removed rather than left as a path someone goes looking for. |
| `config.php` | **server only** | Real credentials. Never committed, never in the zip, never uploaded, protected by the deploy keep-list. |
| `sporta-web/dropin/php-knet/setup-config.php` | `public_html/knet/` | CLI-only generator for `config.php`. **Delete after install.** |
| `sporta-web/dropin/php-knet/selftest.php` | `public_html/knet/` | Readiness check. **Delete after install.** |
| `sporta-web/dropin/php-knet/.htaccess` | `public_html/knet/` | HTTPS + canonical host, `no-store`, `noindex`, denies `config.php`/`knet.php`/`setup-config.php`/`*.log`. |
| `sporta-web/src/lib/checkout.js` | `dist/` | Browser side: calls `create_order`, then sends the customer to `pay.php`. |
| `sporta-web/src/pages/PaymentResult.jsx` | `dist/` | The page KNET's callback finally lands the customer on. |
| `sporta-web/dropin/php-store/*.sql` | `public_html/api/` | Order tables, the server-side pricing trigger, the catalogue seed and the brands. Import order in §3. |
| `sporta-web/dropin/php-store/store.php` | `public_html/api/` | `store_create_order()` — the shared checkout core both the shop and the gateways price from. |

`npm run release` bundles `dropin/php-knet/` into `dist/knet/`, excluding
`config.php`, so one deploy ships the site and the endpoints together.

### 1.2 The money path

```mermaid
sequenceDiagram
    participant B as Browser
    participant DB as MySQL (via /api)
    participant P as knet/pay.php
    participant K as KNET (kpay.com.kw)
    participant C as knet/callback.php

    B->>DB: POST /api/api.php?r=order (track_id, items[slug,qty], customer)
    Note over DB: validates address, resolves slugs,<br/>store_price_lines() computes the amount
    DB-->>B: {order_id, track_id, amount}
    B->>P: GET pay.php?trackid=…   (no amount)
    P->>DB: look up order by track_id
    DB-->>P: amount, payment_status
    Note over P: FAIL CLOSED<br/>404 unknown · 503 unreachable<br/>409 already paid · 400 zero
    P->>P: AES-128-CBC encrypt trandata
    P-->>B: 302 to KNET hosted page
    B->>K: card entry (never touches Sporta)
    K->>C: POST trandata (encrypted result)
    C->>C: decrypt = proof of authenticity
    C->>DB: look up expected amount
    Note over C: FAIL CLOSED<br/>mismatch → failed<br/>unverifiable → review
    C->>DB: PATCH order (paid/failed/review + cbk_*)
    C-->>B: 302 /payment/result?status=…
    B->>DB: get_order_status(track_id)
```

### 1.3 Price authority — the core guarantee

**The browser never states a price, at any point.**

1. `create_order` takes only slugs, sizes and quantities — never a price.
   `store_price_lines()` reads each price from the `products` table and
   `store_discounts_for()` decides the discount; `api.php` then writes
   `orders.amount` from those figures inside the checkout transaction.

   > Earlier versions of this document said the amount was computed by
   > database triggers named `trg_set_item_price` and `trg_recompute_amount`.
   > **There are no triggers in this schema** — `information_schema.triggers`
   > returns zero rows after importing all four SQL files. The guarantee is
   > unchanged and just as strong, because the browser still never names a
   > price and the code that decides is on the server; but anyone auditing the
   > money path was being sent to look for something that is not there.
2. `pay.php` is called with **no `amount` parameter**. It reads the figure from
   the order it looks up.
3. `callback.php` re-reads the stored amount and compares it to what KNET says
   was captured.

Proven by decrypting real `trandata`: a browser asking for 0.100 produced a
KNET request for 24.000.

### 1.4 Fail-closed rules

| Where | Condition | Outcome |
|---|---|---|
| `pay.php` | order not found | **404**, no payment started |
| `pay.php` | database unreachable | **503** |
| `pay.php` | already paid | **409** (blocks double payment) |
| `pay.php` | amount ≤ 0 | **400** |
| `callback.php` | `trandata` missing / undecryptable | `?status=error`, nothing written |
| `callback.php` | captured amount ≠ stored amount | `failed` + `AMOUNT_MISMATCH` |
| `callback.php` | amount unverifiable (DB down, order gone, no `amt`) | **`review`** — never silently paid |
| `callback.php` | DB write fails after 1 retry | logged as `callback.db_write_failed` |
| `create_order` | unknown/inactive slug | `unavailable_<slug>` |

The `neq.paid` guard on the failure path means a replayed or late failure
callback can never un-pay a captured order.

### 1.5 Authenticity

Classic KPG has no HMAC header. Authenticity comes from the fact that
`trandata` is AES-128-CBC encrypted with the **Terminal Resource Key**, which
only the bank and the server hold. A payload that decrypts to well-formed
fields could only have been produced by someone holding that key. A callback
forged with any other key fails `knet_decrypt` and is rejected before anything
is read — verified in the test suite.

### 1.6 Order states

| `payment_status` | Set by | Meaning |
|---|---|---|
| `pending` | `create_order` | Created, not paid. Normal at redirect time. |
| `paid` | `callback.php` | Captured **and** amount verified. Only state that ships. |
| `failed` | `callback.php` | Declined, cancelled, or amount mismatch. |
| `review` | `callback.php` | Bank may have captured; the server could not verify. **Needs a human.** |

`fulfilment_status` (`unfulfilled → packed → shipped → delivered / cancelled`)
is separate and admin-driven.

### 1.7 Crypto specifics

- AES-128-CBC, PKCS7, key = Terminal Resource Key (**exactly 16 bytes** —
  `knet_assert_key` refuses anything else, because PHP would otherwise pad
  silently and KNET would reject every transaction with no useful error).
- Fixed IV `PGKEYENCDECIVSPC`.
- `trandata` hex-encoded, uppercase.
- Fields: `id`, `password`, `action=1`, `langid`, `currencycode=414` (KWD),
  `amt`, `responseURL`, `errorURL`, `trackid`, `udf1..5`.
- Success = `result` is `CAPTURED` or `APPROVED`.
- Test `kpaytest.com.kw` → production `kpay.com.kw`, `/kpg/PaymentHTTP.htm`.

### 1.8 Audit log

`knet_log()` writes append-only JSONL, `chmod 600` on creation, **outside**
`public_html`. Events: `pay.init`, `pay.reject`, `pay.error`,
`callback.received`, `callback.unverified`, `callback.amount_mismatch`,
`callback.db_write_failed`. No secrets, no card data.

---

## 2. What is verified

| Suite | Covers |
|---|---|
| `npm run test:native` (36/36) | The `/api` contract itself: validation tokens, price authority, stock, invoices, brands, admin auth and its five-failure lock. |
| `npm run test:native-e2e` (20/20) | The built site in a real browser against real MariaDB — product page to order to invoice to the admin, every admin tab walked. |
| `npm run test:knet` (39/39) | The whole card path on the NATIVE backend against real MariaDB and a fake gateway that speaks the real Tranportal protocol (`scripts/fake-knet-bank.php`): the trandata this code encrypts is decrypted by an INDEPENDENT AES implementation in Node, the amount charged comes from the database and an `?amount=` in the URL is ignored, the callback answers `REDIRECT=` so a server-to-server gateway can bring the customer home, replays change nothing, underpayment/cancel/garbage all fail closed, and a captured card whose callback never arrived can be settled by an operator only with the bank's payment id. |
| `php -l` | All endpoints parse. |

Run them against a database built by importing `dropin/php-store/schema.mysql.sql`,
`seed.mysql.sql` and `brands.mysql.sql` in that order — the same order §3
documents, so the documented order is the one the tests actually exercise.

---

## 2a. The nomination letter — what the bank has actually issued

KNET Administration's "New Merchant Nomination" reply for
**AL MUHALLAB CO FOR DESIGNING AND PROGRAMMING SPECIAL SOFTWARE**,
CBK, **T-6261**, request ref. **6223**.

| | |
|---|---|
| Website registered | `https://www.sporta.com.kw` |
| Test Merchant ID | `6261` |
| Test Terminal ID | `626101` |
| Production Merchant ID | **not yet issued** |
| Production Terminal ID | **not yet issued** |
| Nominated features | Manual Refund, Batch Refund, Refund API, KFAST, ApplePay — Debit |

The registered website is exactly the canonical origin this codebase emits —
`www`, over HTTPS, one spelling. That is worth stating rather than assuming:
KNET validates the merchant site against what was nominated, and a bare-domain
or plain-HTTP spelling reaching the gateway is a rejected transaction rather
than a warning. Every `.htaccess` here already 301s the alternatives in a
single hop.

**Those two numbers are TEST-tier identifiers, not credentials.** The secrets —
the Tranportal password and the terminal resource key — are not in the letter
and are not in this repository; they come off the merchant portal and go only
into `knet/config.php` on the server. The production pair, when issued, is
subject to the same rule.

### The four things the letter says to do, and what each is for

1. **Tell KNET you are using the RAW toolkit.** The letter: *"If you are
   planning to use the RAW toolkits, then please inform us of the same so we
   can provide you with the RAW details."* This is the item to act on first,
   and it is the easiest one in the letter to read past.

   This shop does not use KNET's downloadable plugin. `knet.php` builds and
   AES-128-CBC-encrypts `trandata` itself against the raw KPG endpoint — that
   IS the raw integration, and it is why the card path is 39 tested checks of
   our own code rather than a vendor jar. So the RAW details have to be
   requested explicitly. Without them, the key and endpoint parameters handed
   over are the plugin's, and the plugin is not what is deployed.

2. **Resource file / keystore download** (Merchant Process → Resource File
   Download, both links). This is where the AES **resource key** comes from —
   `config.php`'s `resource_key`, the 16-byte secret the entire `trandata`
   model rests on.

3. **Alias name** (Merchant Process → View Terminal → View → Plugin tab). The
   alias names a key inside the plugin's Java keystore. A RAW integration has
   no keystore, so this is a *plugin* value with no slot in `config.php` —
   note it down, but do not go hunting for where to paste it.

4. **Certification test before production.** The production IDs are blank in
   the letter because they are issued after certification, not before. So P0
   step 6 — "switch `env` to `production`" — cannot happen yet, however ready
   everything else is. The test path (`kpaytest.com.kw`, Merchant 6261 /
   Terminal 626101) is the only one that exists today.

### Which number is the Tranportal ID — confirm, do not assume

`config.php` wants `tranportal_id` + `tranportal_password`. The letter gives a
Merchant ID and a Terminal ID, and neither is labelled "Tranportal". In CBK's
usual arrangement the Tranportal ID is the **terminal**-level credential —
`626101` — with `6261` identifying the merchant above it. That is the likely
mapping and it is still a guess, so put the question in the same email as the
RAW request rather than discovering the answer as a failed test transaction.

### Nominated ≠ built

Four of the five nominated features have no implementation here, and switching
them on at the bank does not create one:

- **Manual Refund / Batch Refund / Refund API** — already logged as P2 item 7.
  `action=2` and void are unbuilt, so a refund today is a bank-side operation
  that leaves no row in `orders`. The Refund API being nominated is what turns
  this from a nicety into something worth building.
- **KFAST** — KNET's saved-card flow. It adds fields to `trandata` and a token
  to store against the customer. Nothing here does that, and it should not be
  bolted on casually: a stored payment token is the one piece of this system
  whose loss costs a customer money rather than an order.
- **ApplePay — Debit** — needs an Apple merchant identity and a domain
  association file served from `/.well-known/`. That path is already exempt
  from the dotfile deny rule in `public/.htaccess` (the exemption exists for
  ACME renewal), so the file would be reachable; everything else is unbuilt.

None of this blocks going live with the card path. All four are things the
bank now believes this merchant can do.

---

## 3. Plan

### P0 — before any live payment

0. **Email KNET: RAW toolkit, and which number is the Tranportal ID.** See
   §2a. Everything below assumes credentials issued for a raw integration; the
   plugin's are not interchangeable, and the letter only hands over the RAW
   details on request. This step gates steps 3 and 5.
1. **Import the SQL** — one file: phpMyAdmin → Import → `api/install.mysql.sql`.
   It is the four part files concatenated in dependency order by
   `scripts/make-install-sql.mjs`, so there is no order to get wrong. Verified
   against a fresh database: importing it once produces a schema
   byte-identical to running the four by hand, and importing it twice changes
   nothing. The parts still ship for re-running one on its own.
2. **Confirm the catalogue loaded.** `seed.mysql.sql` does it; Backends →
   Catalogue → Push products is the browser equivalent. Orders price from that
   table, and empty means every checkout is refused.
3. **Create `config.php`** in hPanel File Manager from `config.example.php`
   (SSH is off, so `setup-config.php` is not available to this host).
4. **Register `https://www.sporta.com.kw/knet/callback.php`** with the bank as
   both `responseURL` and `errorURL`.
5. **Test transaction** on `env: 'test'` against `kpaytest.com.kw` — a real
   0.100 KWD payment returning `CAPTURED`. Confirm the order flips to `paid`
   in the admin, not just that the browser showed a tick.
6. **Switch `env` to `production`** with production credentials, repeat once.
   Blocked until KNET's certification test is passed — the production Merchant
   and Terminal IDs do not exist before it (§2a).
7. **Delete `setup-config.php` and `selftest.php`** from the server.

**One page answers "is step N done?"** — `https://www.sporta.com.kw/api/preflight.php`,
unlocked with the `cron_key` from `api/config.php`. It shows the lowest
unfinished step and nothing else, and for KNET it now goes past "are the keys
filled in":

- opens the orders database with **`knet/config.php`'s own** `mysql_*` values
  and reads the `orders` table — four non-empty keys that do not actually work
  is the documented way to get "Invalid amount" on every card;
- checks that database is the **same one** `api/config.php` names, because two
  valid databases means the gateway looks for an order the shop wrote
  elsewhere;
- **encrypts and decrypts a probe with the real `resource_key`** through
  `knet.php` itself — 16 bytes of the wrong thing is still 16 bytes;
- flags **invisible characters** (leading/trailing space, NBSP, zero-width
  space, BOM) in any credential, which File Manager renders as nothing at all;
- refuses a `test_url` pointing at the production host while `env` is `test`,
  which is a rehearsal run with real cards;
- reads `knet/.htaccess` and confirms it actually **denies** `config.php` and
  `knet.php`, rather than merely existing.

`npm run test:preflight` breaks the install in each of those ways and asserts
the page names it, and that no secret is ever printed.

> Item 5 is the one that matters. A green result page proves the redirect
> worked; only the admin row proves the money was recorded. That distinction is
> exactly what the column-name bug hid.

### P1 — the remaining money-safety gap

**Abandoned callbacks.** Classic KPG is redirect-only: there is no
server-to-server webhook. If the customer closes the browser after the bank
captures but before the redirect fires, `callback.php` never runs, and the
order stays `pending` while the money is gone. Nothing in the current design
detects this.

Recommended, in order:

1. **Stale-pending alert in the admin** — surface orders `pending` for more
   than ~30 minutes. Cheap, and it turns a silent loss into a visible queue.
2. **Daily reconciliation** — compare the KNET settlement report against
   `orders`, flagging captured-but-not-`paid` and `paid`-but-not-settled.
3. **Payment inquiry** — if the bank enables KPG's inquiry endpoint, a small
   job can resolve stale `pending` orders automatically.

Also P1:

4. **Alert on `callback.db_write_failed`.** Today it only reaches a log file
   nobody watches; it means money was taken and not recorded.
5. **Work the `review` queue.** The status exists and the admin counts it;
   there is no defined procedure for clearing one.

### P2 — completeness

6. **Order confirmation** to the customer on `paid` (email/WhatsApp). Nothing
   is sent today. Needs the SPF/DKIM/DMARC records in `DNS-EMAIL-RECORDS.txt`
   first, or it lands in spam.
7. **Refunds / voids.** Not implemented at all — `action=2` (refund) and void
   are unbuilt. Refunds are currently a manual bank-side operation with no
   record in `orders`.
8. **Log rotation** for the JSONL audit file.
9. **Receipt** — `cbk_receipt` and `cbk_paytype` are now captured but unused.

### Explicitly not planned

- **Storing card data.** Card entry stays on the bank's hosted page. This is
  what keeps Sporta out of PCI-DSS scope. Do not add an on-site card form.
- **`php-cbk/` (T-Pay REST-JSON).** A second, unused integration path. Keep it
  dormant unless the bank migrates the account.

---

## 3a. Pointing the card path at the orders database

`knet/config.php` has to be TOLD which database holds the orders — it is a
separate file from `api/config.php` and shares nothing with it automatically:

```php
'mysql_host' => 'localhost',
'mysql_name' => '...',   // the same database as api/config.php,
'mysql_user' => '...',   // where these four keys are spelled db_*
'mysql_pass' => '...',
```

Leave them blank and `pay.php` has no amount to charge: every card is refused
with `400 Invalid amount` and every captured payment goes unrecorded. That is
not hypothetical — it is what happened, and `npm run test:knet` exists because
of it.

Without it the whole card path is dead, and silently: `knet_db_configured()`
answered "no database", so `pay.php` refused every payment with **400 Invalid
amount** (the storefront sends no amount, by design — the price must come from
the server) and `callback.php` skipped the write entirely, leaving the MySQL
branch inside it unreachable and every captured payment unrecorded. Both are
fixed and both are now covered by `npm run test:knet`; `knet/selftest.php`
reports the database it will use, and says so loudly when there is none.

## 3b. How the customer gets home — confirm this with the bank

KPG has two deployment styles and the merchant cannot tell which one an
account has been given:

* the gateway **redirects the browser** to `responseURL`; or
* the gateway calls `responseURL` **server to server** and reads the token
  `REDIRECT=<url>` out of the reply, then sends the browser there itself.

A plain HTTP 302 is correct for the first and useless for the second — the
shopper is left on a blank bank page with the money taken. `callback.php`
therefore answers BOTH at once by default (`'callback_response' => 'both'`):
HTTP 200, `REDIRECT=<url>` on the first line, then a meta refresh and a link.
Set it to `'redirect'` only if the bank confirms the browser-redirect style.

**This is the one thing to ask CBK when the account goes live.**

## 3c. When the bank took the money and never told us

KPG reports through the customer's browser, so a closed tab loses the message:
the money is captured and the order sits at `pending` (or `review`, where the
callback parks anything it could not verify). This cannot be designed away — it
is inherent to a browser-delivered result.

The admin's order drawer therefore has a settle control for card orders, and it
demands the **KNET payment id** typed in from the KNET portal. That is the
forcing function: it cannot be filled in without having looked the transaction
up. The order is recorded as `MANUAL_BANK_CONFIRMED`, never as a bank callback,
so a manual settlement is always distinguishable when the books are read. Cash
orders keep their own control and cards still cannot be settled on a hunch.

---

## 4. Failure runbook

| Symptom | Cause | Action |
|---|---|---|
| `404 Unknown order` at Pay | `schema.mysql.sql` not imported, or the order was never created | Import the SQL |
| `Order has no payable amount` | `products` table empty | Admin → Catalogue → Push products |
| KNET rejects every transaction | `resource_key` not exactly 16 bytes | `knet/selftest.php` names it |
| Every card refused with `400 Invalid amount` | no `mysql_*` values in `knet/config.php` | Fill them in — see §3a |
| Customer sees success, order stays `pending` | `callback.db_write_failed` in the log | Check the log; fixed for the column-mismatch cause |
| Order stuck at `review` | Amount could not be verified | Compare against the bank statement by `cbk_paymentid`, then set manually |
| `503` at Pay | the orders database is unreachable | Correct — no payment starts. Check the `mysql_*` values and that MySQL is up |
