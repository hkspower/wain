# CBK Hosted KNET & T-Pay — native PHP integration (Hostinger)

Built to the **CBK Integration & Reference Manual v2.93** (REST-JSON + NVP
hosted checkout). Handles KNET and CBK T-Pay via CBK's
hosted page. No OpenCart.

**Important:** CBK does the encryption. You do **not** AES-encrypt anything —
`ENCRP_KEY` and the `AccessToken` are already-encrypted tokens from the bank
that you pass through as-is.

## Files
- `config.example.php` → copy to `config.php`, fill with CBK values
- `cbk.php` → auth-token (cached 2h), checkout, verify helpers
- `pay.php` → gets a token, auto-submits the `tij_*` form to CBK
- `callback.php` → CBK returns here with `?encrp=…`; verifies, records, redirects
- `.htaccess` → blocks direct access to config/lib/token

## Flow (from the manual)
1. **Authenticate** — POST `{ClientId, ClientSecret, ENCRP_KEY}` to
   `…/ePay/api/cbk/online/pg/merchant/Authenticate` → `AccessToken` (valid 2h).
2. **Checkout** — browser POSTs `tij_*` fields to `…/ePay/pg/epay?_v={AccessToken}`.
3. **Result** — CBK redirects to your `tij_MerchReturnUrl` with `?encrp=…`.
4. **Verify** — GET `…/GetTransactions/{encrp}/{AccessToken}` → `Status`:
   `1`=Success/Captured, `2`=Failed, `3`=Expired/Cancelled, `0/-1`=Invalid.

## Install on Hostinger
1. Upload this folder to `public_html/pay/`:
   - `https://www.sporta.com.kw/pay/pay.php`
   - `https://www.sporta.com.kw/pay/callback.php`
2. Copy `config.example.php` → `config.php`, fill in:
   - `test_base` / `production_base` — already filled in as
     `https://pgtest.cbk.com` and `https://pg.cbk.com`. The manual prints
     these only as `{TestPG}` / `{ProductionPG}` placeholders; the real hosts
     come off CBK's own integration screen. Check them against your
     activation email before you go live.
   - `client_id`, `client_secret`, `encrp_key`
   - `env` = `test` first, then `production`
3. Make sure `pay/` is writable (for the `.cbk_token.json` cache).
4. Register your **return URL** (`…/pay/callback.php`) with CBK, and give them
   your **server static IP** if they use IP filtering (max 2 IPs).

## Checkout from your React app
```js
// create the order with a UNIQUE track_id first, then:
window.location.href =
  `https://www.sporta.com.kw/pay/pay.php?trackid=${order.track_id}`;
// The amount is NOT in the URL: pay.php reads it from the order in the database
// (a browser-supplied amount is ignored). lang=en|ar is optional.
```
After payment the customer lands on `result_page_url`
(`/payment/result?status=success|failed|cancelled&trackid=…&payid=…&ref=…`).

## Order update
`callback.php` updates the MySQL `orders` row (matched by `track_id`) using the
`mysql_*` values in `config.php` — the same database `api/config.php` and
`knet/config.php` name. Columns used: `payment_status`, `cbk_status`,
`cbk_message`, `cbk_paymentid`, `cbk_transaction`, `cbk_authcode`,
`cbk_reference`, `cbk_receipt`, `cbk_paytype`, `paid_at`. The manual REQUIRES
saving the returned values.

The write is idempotent and never downgrades a paid order, and the warehouse
follow-up is queued in the same transaction as the status it reports.

## Payment mode
- `tij_MerchPayType` is decided by the ORDER, not by the URL or the config:
  a KNET order (`payment_method = 'knet'`, with `knet_via_cbk` on) is sent as
  '1' (KNET); a T-Pay order as '2' (T-Pay QR). `cbk_pay_type()` in cbk.php does
  this. The URL's `paytype` and `amount` parameters are ignored. An empty value
  (customer chooses) is not used.

## Error codes (manual)
`TIJ0002/0003` invalid amount, `TIJ0004` invalid track id, `TIJ0009` invalid
auth key, `TIJ0020` KNET error, `TIJ0027` invalid return URL, etc. If a test
returns one, tell me the code and I'll pinpoint the field.

## Test → Live
Keep `env: 'test'` with CBK's test credentials until a real test order returns
`Status:1`. Then switch `env` to `production` and use production credentials.

---

## Checked against CBK's own sample code

The bank ships `PGPaymentRequestHosted.php`, `PGPaymentResultHosted.php` and a
three-line `Test_Integration_Steps.txt`. This dropin was read line by line
against them.

**Settled by the sample** — things the manual leaves ambiguous and the code
does not:

| | |
|---|---|
| Test host | `https://pgtest.cbk.com`, hard-coded in both sample files |
| Basic auth | genuinely `base64_encode(ClientId . ':' . ClientSecret)`. The manual's own example prints it unencoded, so this was worth confirming; our fake gateway enforces it. |
| Authenticate | POST JSON `{ClientId, ClientSecret, ENCRP_KEY}` **and** the Basic header — both, not either |
| Checkout | `{base}/ePay/pg/epay?_v={AccessToken}`, NVP form POST |
| Currency | the sample omits `tij_MerchantPaymentCurrency` entirely. We send `KWD`; the manual says optional, default KWD. Harmless either way. |

**Where this dropin deliberately differs, and why**

1. **TLS verification stays ON.** The sample sets `CURLOPT_SSL_VERIFYHOST => 0`
   and `CURLOPT_SSL_VERIFYPEER => 0` on the Authenticate call — the request
   carrying the ClientSecret and the ENCRP_KEY. With both off, curl hands
   those to whatever answers on the address. `scripts/tls-probe.php` and a
   check in `test:tpay` prove we refuse a certificate we cannot verify, so
   that this cannot be quietly "fixed" to match the vendor.

2. **Status 0 and -1 are handled.** The sample means to reject them:

   ```php
   if ($paymentDetails->Status != "0" or $paymentDetails->Status != "-1")
   ```

   That condition is always true — a value cannot be equal to both, so `or`
   makes it a tautology and the guard never fires. The intent is right and the
   code does nothing. Our callback re-authenticates once and, failing that,
   leaves the order alone rather than marking a payment of unknown state
   failed.

3. **Form values are escaped.** The sample interpolates straight into
   `value='$v'`; a value containing a quote would break out of the attribute.

**Per-attempt references: implemented, with two limits.**

Attempt 1 sends the order's track id; attempt n sends `<track>A<n>`
(`cbk_attempt_ref`, cbk.php), so a retry after a declined card is not refused as
a duplicate (manual p.10). Two limits remain:

- A customer may choose an order id that ends in `A<n>`, so it can equal another
  order's attempt reference. Settlement resolves the order named in the udf5 hint
  first (`cbk_resolve_track`), so the payment still reaches the right order.
- Uniqueness across the merchant is therefore by convention, not by a database
  rule. A per-attempt column (one row per attempt) removes both limits and needs
  a migration, so it is a decision for the release gate.

A result from an attempt the order has moved past (a decline for attempt 1 after
attempt 2 started) is recorded in the log and changes nothing: the order stays
pending for the open attempt (`callback.superseded_attempt`). A capture is always
recorded, whichever attempt it came from.
