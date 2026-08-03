# CBK Hosted KNET & T-Pay — native PHP integration (Hostinger)

Built to the **CBK Integration & Reference Manual v2.93** (REST-JSON + NVP
hosted checkout). Handles KNET, Visa/Mastercard, and CBK T-Pay QR via CBK's
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
  `https://www.sporta.com.kw/pay/pay.php?amount=1.500&trackid=${order.track_id}`;
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
- `tij_MerchPayType` = '' → customer chooses KNET or T-Pay; '1' = KNET only;
  '2' = T-Pay QR only. Set via `pay_type` in config or `?paytype=` on the URL.

## Error codes (manual)
`TIJ0002/0003` invalid amount, `TIJ0004` invalid track id, `TIJ0009` invalid
auth key, `TIJ0020` KNET error, `TIJ0027` invalid return URL, etc. If a test
returns one, tell me the code and I'll pinpoint the field.

## Test → Live
Keep `env: 'test'` with CBK's test credentials until a real test order returns
`Status:1`. Then switch `env` to `production` and use production credentials.
