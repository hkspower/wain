# KNET — which integration this shop has, and what you must do on the server

Sporta's KNET is **`tij_MerchPayType=1` on the CBK hosted page** — the same
gateway, the same merchant account and the same credentials that already take
T-Pay. There is no second bank relationship to set up and no third credential
to chase.

`pay/cbk.php`'s own first line has said so since it was written: *"CBK Hosted
**KNET & T-Pay** — implements the auth-token, checkout URL and transaction-verify
calls from the CBK Integration & Reference Manual v2.93"*. So does
`pay/config.example.php`:

    // Payment mode: '' = let customer choose, '1' = KNET only, '2' = T-Pay QR only
    'pay_type' => '',

KNET was never missing from this shop. It was one parameter away, behind
`pay/`, while `knet/` waited on credentials nobody was going to issue.

## The two integrations

|  | Official CBK hosted page | Legacy Tranportal |
|---|---|---|
| Credentials | `client_id`, `client_secret`, `encrp_key` — CBK's activation email | Tranportal ID, Tranportal password, 16-byte Terminal Resource Key |
| Lives in | `pay/config.php` | `knet/config.php` |
| Gateway | `pg.cbk.com` | `kpay.com.kw/kpg` |
| Crypto | AccessToken + `encrp_key`, per the manual | AES-128-CBC `trandata`, fixed IV, hex |
| Settles at | `pay/callback.php` | `knet/callback.php` |
| Open questions | none | three — see below |
| **Sporta uses** | **this one** | only if the bank issued the three values |

Both are real. The legacy one is not deprecated and plenty of Kuwaiti shops run
on it; it is simply not what this merchant was activated for.

### The three questions that only the legacy path asks

They were written into `knet/config.example.php` as open items, and every one of
them is a question to a bank that has to be answered before a single legacy
transaction can be trusted:

1. **Which credential is the "Tranportal ID"?** The nomination letter names a
   Merchant ID and a Terminal ID (Sporta's test pair: merchant `6261`, terminal
   `626101`) and calls neither of them Tranportal.
2. **Is English `EN` or `USA`?** `langid` picks the face of the card page. Send
   the wrong one and the bank is entitled to refuse the transaction.
3. **Which callback style does this Tranportal ID get?** The gateway either
   redirects the browser to `responseURL`, or calls it server-to-server and
   reads `REDIRECT=<url>` out of the reply. The wrong guess strands a customer
   on a blank bank page with their money taken.

On the official path all three disappear: language passes straight through as
`ar`/`en`, the return is `pay/config.php`'s `return_url`, and the credentials
are the ones already working for T-Pay.

## How the shop chooses

`/knet/pay.php` is the KNET door and stays the KNET door — the website's
compiled bundle builds that URL itself and this repo does not hold its source.
Behind it, `knet_mode()` decides:

* **legacy** whenever `knet/config.php` holds a Tranportal block that could
  actually take a payment — all three values present, not the example's
  placeholders, and a resource key of exactly 16 bytes (AES-128 accepts nothing
  else, so a key of the wrong length is an integration that answers every
  shopper *"Payment init failed"*).
* **official** otherwise — a `303` to `/pay/pay.php?trackid=…&lang=…&paytype=1`.

The default can only ever turn a dead card path into a live one. A shop holding
Tranportal credentials keeps the integration it is running; a shop that never
finished that setup gets the one its credentials do open. To stop deciding, pin
it — which is what to do the day the bank puts an answer in writing:

    'mode' => 'official',   // or 'legacy'

`scripts/knet-test.mjs` (`npm run test:knet`) asserts the decision case by case
and drives **both** routes over HTTP.

### Why a redirect rather than the form served from `/knet/`

`pay/pay.php` carries the `encrp_key` and a live AccessToken in hidden inputs
and submits itself. The two things that make that safe and possible both live
in `pay/.htaccess` — the `no-store` headers that keep a bearer credential off
proxy disks, and the CSP hash authorising the one-line submit script. Neither
reaches `knet/`, whose own `.htaccess` sets `script-src 'none'` and
`form-action 'none'`. A copy of that form served from this directory would be a
page holding a merchant credential that cannot submit itself and cannot be
submitted by hand. One page renders it, under the rules written for it.

Nothing is checked twice, either: the redirect happens before the throttle, the
amount lookup and the attempt counter, because `pay/pay.php` does all three
itself against the same orders table. Running them on both sides would count
each attempt twice in `orders.pay_attempt` — the counter that decides whether a
reference gets a retry suffix — and a shopper's *first* attempt would reach the
bank as `…A2`.

## What you have to do on the server

1. **Nothing in `knet/config.php` for the credentials.** Leave the Tranportal
   block empty. Leave the `mysql_*` keys empty too and the orders database is
   inherited from `api/config.php` — one place, so a password rotated in hPanel
   cannot kill the card path from a file nobody thought to open.
2. **Fill in `pay/config.php`** if it is not already: `client_id`,
   `client_secret`, `encrp_key` from CBK's activation email. This is the file
   KNET now depends on. See `TPAY.md`.
3. **`return_url`** in `pay/config.php` must be the public HTTPS address of
   `pay/callback.php`. CBK calls it out of band, and that call — not the
   customer coming back — is what marks an order paid. It settles KNET and
   T-Pay alike; `pay/callback.php` records the type and branches on nothing.
4. **Set `env` to `production`** when CBK moves you off the test gateway, and
   confirm `production_base` against your activation email.
5. **Keep both `config.php` files out of the web root's reach.** `.htaccess`
   denies them and `.gitignore` keeps them out of the repository — they are
   bearer credentials.
6. **Delete `knet/selftest.php` and `pay/selftest.php`** once everything reads
   OK. They report configuration status without a password.

## If the bank tells you otherwise

If CBK confirms Sporta *does* hold a Tranportal account, fill the three values
into `knet/config.php` and the dropin in this directory takes over on its own —
no code change. Answer the three questions above first, in the same email, and
set `lang_en` to whatever the bank says English is.

## What cannot be tested from here

Nothing in either path can be driven against the real bank from a sandbox, and
the rigs say so rather than pretending. With no route to `pg.cbk.com` the
official path gets as far as the token call and reports it; `test:knet` asserts
the handoff, the KNET face, the track id and the price authority up to that
point, and `test:tpay` prints the token call as a skip rather than a pass.
