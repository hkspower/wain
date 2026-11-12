# Classic KNET (KPG) — native PHP integration

> **Full architecture, money path, guarantees and roadmap: [`/KNET.md`](../../../KNET.md).**
> This file is the short install note; that one is the reference.

The "KNET from KNET Co" model: AES-encrypted `trandata`, handed to KNET's hosted
page (`kpay.com.kw`) by redirecting the shopper's browser there (a 302, i.e. a GET;
nothing is POSTed server-to-server at init, the same hand-off as KNET's own
iPayPipe plug-in, `iPayPipe.java:133-158`). Use this if your bank issued **Tranportal** credentials
(ID + password + resource key). If instead you got CBK's REST-JSON T-Pay API
(ClientId/ClientSecret/ENCRP_KEY), use `../php-cbk/` instead.

**You cannot get KNET credentials directly from KNET Co** — they're issued
through your acquiring bank (CBK). "KNET direct" = KNET via your bank.

## Files
- `config.example.php` → copy to `config.php`, fill Tranportal values
- `knet.php` → AES-128-CBC encrypt/decrypt (the 16-byte resource key is both the
  key and the IV), the raw trandata builder, HTTPS guard, server-side amount
  lookup, the settlement shared by the callback and the inquiry, and the
  optional server-to-server inquiry (OFF by default)
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
Checked against KNET's official iPayPipe 1.0 plug-in (decompiled read-only;
`sporta-web/KNET-IPAYPIPE-CHECK.md`):
- AES-128-CBC, PKCS5/7, uppercase hex trandata. The **key AND the IV are both the
  16-byte resource key** (`AESAlgorithm.java:22, 44`). There is no fixed IV:
  `PGKEYENCDECIVSPC`, which an older version of this note named, appears nowhere
  in the plug-in, and with it the bank cannot decrypt the first block.
- The plaintext is `key=value&` for every non-empty field, values **raw**, no URL
  encoding, in the plug-in's order: amt, action=1, responseURL, errorURL,
  trackid, udf5 (the order id), currencycode=414 (KWD), langid (AR or USA),
  id, password. Empty fields (udf1-udf4) are not sent. A value containing
  `&`, `=`, `?`, `#` or a control character cannot travel raw and is refused,
  on save in /backends and again before anything is sent.
- Gateway: `https://kpaytest.com.kw/kpg/PaymentHTTP.htm` or the `www.` form (test),
  `https://kpay.com.kw/kpg/PaymentHTTP.htm` or the `www.` form (production);
  nothing else.
- Success: `result` = `CAPTURED` and **only** `CAPTURED` (the plug-in judges
  nothing; `APPROVED` is not a purchase result and is refused).
- `langid` AR / USA: Sporta's values, not confirmed by the plug-in. Check the
  bank page comes up in Arabic on the first Arabic TEST payment.

## Lost callbacks: the inquiry (OFF by default)
`'inquiry_enabled' => true` in `config.php` makes the stock sweeper
(`api/cron-stock.php`) ask the bank about a pending KNET order before it gives
the order's stock back: an XML POST to `.../kpg/tranPipe.htm?param=tranInit`,
the plug-in's `performTransaction`. A `CAPTURED` answer settles the order through
the callback's own code. It refuses to run until `inquiry_action` is set to the
code KNET gives for an inquiry (there is no default). Questions for KNET before
switching it on: `/KNET.md`, "Inquiry".
