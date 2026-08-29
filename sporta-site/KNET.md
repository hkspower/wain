# KNET — which integration this shop has, and what you must do on the server

**Sporta pays through the Tranportal values.** That is the owner's decision and
`knet/config.example.php` pins it — `'mode' => 'legacy'` — so nothing works it
out at runtime. The three credentials go in that file and `knet/` does the rest:
an AES-128-CBC `trandata` blob to `kpay.com.kw/kpg`, exactly as this dropin has
always been written to do.

There is a **second, working route** and it is kept tested rather than deleted,
because it costs one line to reach and it is the answer if the Tranportal
credentials ever turn out not to exist. KNET is also `tij_MerchPayType=1` on
the CBK hosted page — the same gateway, merchant account and credentials that
already take T-Pay. `pay/cbk.php`'s own first line says so: *"CBK Hosted **KNET
& T-Pay** — implements the auth-token, checkout URL and transaction-verify calls
from the CBK Integration & Reference Manual v2.93"*. So does
`pay/config.example.php`:

    // Payment mode: '' = let customer choose, '1' = KNET only, '2' = T-Pay QR only
    'pay_type' => '',

To switch, set `'mode' => 'official'` in `knet/config.php`. Nothing else — the
credentials are already in `pay/config.php` and `/knet/pay.php` hands the
shopper over.

## The two integrations

|  | Official CBK hosted page | Legacy Tranportal |
|---|---|---|
| Credentials | `client_id`, `client_secret`, `encrp_key` — CBK's activation email | Tranportal ID, Tranportal password, 16-byte Terminal Resource Key |
| Lives in | `pay/config.php` | `knet/config.php` |
| Gateway | `pg.cbk.com` | `kpay.com.kw/kpg` |
| Crypto | AccessToken + `encrp_key`, per the manual | AES-128-CBC `trandata`, fixed IV, hex |
| Settles at | `pay/callback.php` | `knet/callback.php` |
| Open questions | none | three — see below |
| **Sporta uses** | the fallback, one line away | **this one** |

Both are real, and the legacy one is not deprecated — plenty of Kuwaiti shops
run on it.

### The three questions the Tranportal path asks

They are written into `knet/config.example.php` as open items. None of them
stops you filling the file in today; each is something a failed transaction
would otherwise teach you slowly, so put all three in one email to the bank:

1. **Which credential is the "Tranportal ID"?** The nomination letter names a
   Merchant ID and a Terminal ID — Sporta's test pair, merchant `6261`,
   terminal `626101` — and calls neither of them Tranportal. **`626101` is what
   is set**, because the terminal-level number is what CBK usually means. If
   the bank says merchant-level, change it to `6261`.
2. **Is English `EN` or `USA`?** `langid` picks the face of the card page. Send
   the wrong one and the bank is entitled to refuse the transaction. Arabic is
   `AR` either way, so an Arabic-first shop keeps working while you wait.
3. **Which callback style does this Tranportal ID get?** The gateway either
   redirects the browser to `responseURL`, or calls it server-to-server and
   reads `REDIRECT=<url>` out of the reply. **Already answered safely:** the
   shipped `callback_response => 'both'` replies in both styles at once, so
   leave it alone unless the bank says otherwise.

### The two credentials this project has never had

`tranportal_password` and `resource_key` have never been written down anywhere
in this repo, and neither is guessable. **Until both are in `knet/config.php`
the dropin cannot complete a transaction** — `knet_assert_key()` throws on any
resource key that is not exactly 16 bytes, and the shopper sees *"Payment init
failed"*. A trailing space or newline from a copy/paste is the usual cause;
`knet/selftest.php` counts the bytes for you and is the fastest way to catch it.

## How the shop chooses

`/knet/pay.php` is the KNET door and stays the KNET door — the website's
compiled bundle builds that URL itself and this repo does not hold its source.
Behind it, `'mode' => 'legacy'` settles it for Sporta.

**Why pin it rather than let it be worked out.** With no `mode` set, a
Tranportal block that stops being usable — a mistyped password, a key that lost
a byte, a file half-edited in File Manager — would silently become a CBK hosted
page, and the shop would start taking money through a route nobody was
expecting. Pinned, a broken Tranportal block stays a broken Tranportal block and
says so. That is the right trade for a shop that has decided; the auto-detect
below is the right one for a shop that has not.

Left unset, `knet_mode()` decides:

* **legacy** whenever `knet/config.php` holds a Tranportal block that could
  actually take a payment — all three values present, not the example's
  placeholders, and a resource key of exactly 16 bytes (AES-128 accepts nothing
  else, so a key of the wrong length is an integration that answers every
  shopper *"Payment init failed"*).
* **official** otherwise — a `303` to `/pay/pay.php?trackid=…&lang=…&paytype=1`.

That default can only ever turn a dead card path into a live one, which is why
it is safe to ship — but Sporta overrides it, for the reason above.

`scripts/knet-test.mjs` (`npm run test:knet`) asserts the decision case by case,
guards the shipped `'legacy'` pin and the `626101` terminal id, and drives
**both** routes over HTTP.

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

1. **Copy `knet/config.example.php` to `knet/config.php`** and fill in
   `tranportal_password` and `resource_key` from the bank. `tranportal_id` is
   already `626101` and `'mode' => 'legacy'` is already set. The resource key
   must be **exactly 16 bytes** — paste it carefully.
2. **Leave the `mysql_*` keys empty.** The orders database is inherited from
   `api/config.php`, so it is named in one place and a password rotated in
   hPanel cannot kill the card path from a file nobody thought to open. Without
   a database there is no price authority at all and every payment is refused.
3. **`response_url` and `error_url`** must both be the public HTTPS address of
   `knet/callback.php`, and that URL has to be registered with the bank against
   this Tranportal ID. That callback is what marks an order paid.
4. **Set `env` to `production`** when the bank moves you off the test gateway.
   `test` is the only value that selects `test_url`; anything else, including
   nothing at all, is treated as live.
5. **Run `/knet/selftest.php`** and read the top line: it names the integration
   in force, then counts the resource key's bytes and checks the orders
   database. It only opens while `env` is `test`.
6. **Keep `config.php` out of the web root's reach.** `.htaccess` denies it and
   `.gitignore` keeps it out of the repository — it is a bearer credential.
7. **Delete `knet/selftest.php`** once everything reads OK. It reports
   configuration status without a password.

`pay/config.php` stays as it is — T-Pay still uses it, and it is what the
fallback route would need.

## If the Tranportal credentials turn out not to exist

If the bank comes back and says there is no Tranportal account on this merchant
— or simply cannot produce the password and resource key — the shop is not
stuck. Set

    'mode' => 'official',

in `knet/config.php` and `/knet/pay.php` hands every KNET shopper to the CBK
hosted page as `tij_MerchPayType=1`, using the credentials already in
`pay/config.php`. No other change, no redeploy, and all three questions above
stop mattering: language passes through as `ar`/`en`, the return is
`pay/config.php`'s `return_url`, and `pay/callback.php` settles KNET and T-Pay
alike. `npm run test:knet` drives that route on every run, so it is known to
work before you need it.

## What cannot be tested from here

Nothing in either path can be driven against the real bank from a sandbox, and
the rigs say so rather than pretending. The Tranportal route is asserted as far
as the redirect — the gateway URL, the uppercase-hex `trandata` blob, and that
no amount travels in the link — and `test:payments` forges callbacks against
`knet/callback.php` to prove the settling logic, including that a `trandata`
encrypted under the wrong key settles nothing. What no rig here can tell you is
whether the bank accepts the credentials; only a test transaction does that.
