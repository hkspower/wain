# Classic KNET (KPG) — native PHP integration

The "KNET from KNET Co" model: AES-encrypted `trandata` posted to KNET's hosted
page (`kpay.com.kw`). Use this if your bank issued **Tranportal** credentials
(ID + password + resource key). If instead you got CBK's REST-JSON T-Pay API
(ClientId/ClientSecret/ENCRP_KEY), use `../php-cbk/` instead.

**You cannot get KNET credentials directly from KNET Co** — they're issued
through your acquiring bank (CBK). "KNET direct" = KNET via your bank.

## Files
- `config.example.php` → copy to `config.php`, fill Tranportal values
- `knet.php` → AES-128-CBC (IV `PGKEYENCDECIVSPC`) encrypt/decrypt + helpers,
  HTTPS guard, server-side amount lookup
- `pay.php` → builds encrypted request, redirects to KNET
- `callback.php` → decrypts result, verifies `CAPTURED` + amount, updates order
- `.htaccess` → force HTTPS, block config/lib

## Install (Hostinger)
1. Upload to `public_html/knet/`.
2. `cp config.example.php config.php`; fill `tranportal_id`, `tranportal_password`,
   `resource_key`; keep `env: 'test'` first.
3. Register `…/knet/callback.php` as your responseURL/errorURL with the bank.

## Checkout (React)
```js
window.location.href =
  `https://www.sporta.com.kw/knet/pay.php?trackid=${order.track_id}`;
```
(Amount comes from the server-stored order; the client can't set the price.)

## Test → Live
Start on `env: 'test'` (`kpaytest.com.kw`) with test Tranportal credentials.
When a real 0.100 KWD test returns `result=CAPTURED`, switch `env` to
`production` (`kpay.com.kw`) with production credentials.

## Spec reference
- AES-128-CBC, key = resource key, IV `PGKEYENCDECIVSPC`, hex trandata.
- Fields: id, password, action=1, langid, currencycode=414 (KWD), amt,
  responseURL, errorURL, trackid, udf1-5.
- Success: `result` = `CAPTURED` (or `APPROVED`).
