# CBK T-Pay — native PHP integration for Sporta (Hostinger)

Native PHP (no OpenCart). Files:

- `config.example.php` → copy to `config.php`, fill with CBK's values
- `knet.php` → AES encrypt/decrypt + trandata helpers
- `pay.php` → starts a payment, redirects to the CBK hosted page
- `callback.php` → receives CBK's result, verifies, updates order, redirects
- `.htaccess` → blocks direct access to config/lib

## ⚠️ Needs your CBK T-Pay document
The real **gateway URL** and exact **field names** come from CBK after
activation. Put them in `config.php`. If CBK's API is REST/JSON (not the classic
KNET trandata model), send me the PDF and I'll adapt `pay.php` / `callback.php`.

## Install on Hostinger
1. Upload this folder to `public_html/pay/` so you get:
   - `https://www.sporta.com.kw/pay/pay.php`
   - `https://www.sporta.com.kw/pay/callback.php`
2. Copy `config.example.php` → `config.php`, fill in CBK values.
3. Register `…/pay/callback.php` with CBK as your **responseURL** and **errorURL**.

## Checkout from your React app
```js
// create the order (unique track_id) first, then:
window.location.href =
  `https://www.sporta.com.kw/pay/pay.php?amount=12.500&trackid=${order.track_id}`;
```
After payment the customer lands on `return_url` (your `/payment/result` page)
with `?status=success|failed&trackid=...&ref=...`.

## Order update
`callback.php` can PATCH your Supabase `orders` row (match `track_id`) if you set
`supabase_url` + `supabase_service_key` in config. Otherwise handle it yourself.

## Test → Live
Start with CBK's **sandbox** gateway URL + test credentials. Do a real 0.100 KWD
test. When it succeeds, switch `gateway_url` + credentials to **production**.

## Cards / Apple Pay
KNET, Visa, Mastercard are handled by the same hosted page (the customer picks on
CBK's side). Apple Pay appears only if enabled on your CBK merchant account.
