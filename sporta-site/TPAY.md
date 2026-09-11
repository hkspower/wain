# CBK T-Pay — what is wired, and what you must do on the server

T-Pay is the card and QR half of the Commercial Bank of Kuwait's gateway. It
shares a hosted page, a merchant account and a set of credentials with the KNET
half; `pay/` speaks to it and `knet/` speaks to KNET, both against the CBK
Integration & Reference Manual v2.93.

## What changed

The dropin already existed. What did not exist was any way for the **app** to
reach it — and one thing in the app that could never have worked at all.

* `api.php?r=order` now answers with a `pay_url`. It always could have; it
  never did, and the app had been asking for that exact field since it was
  written. A card order in the app created a pending row, took no money, and
  showed the customer a tick.
* The app sent `payment_method: "card"`. The shop accepts `knet`, `tpay` and
  `cod`, so **every card checkout from the app was rejected outright** with
  `invalid_payment_method`. It is `tpay` now.
* The order screen asks the shop whether the money arrived instead of assuming
  it from the customer coming back. The browser sheet closes identically
  whether they paid, cancelled, or gave up.
* A missing `pay/config.php` used to be an uncaught fatal — a blank 500 on the
  payment page with the server's filesystem path in the body. It is a 503 and
  one sentence now.

## The link

    tpay  ->  /pay/pay.php?trackid=<track>&lang=<ar|en>&paytype=2
    knet  ->  /knet/pay.php?trackid=<track>&lang=<ar|en>
    cod   ->  null

Only the track id travels. Both dropins look the amount up in `orders`
themselves and refuse anything the database cannot confirm, so a link that
leaks, is shared, or is edited by hand still cannot change what is charged —
`?amount=0.100` on a real order is ignored, which `scripts/tpay-test.mjs`
asserts on every run.

`paytype=2` pins the hosted page to T-Pay rather than leaving CBK's chooser up:
the customer already chose, in the app, one screen earlier.

## What you have to do on the server

1. Copy `pay/config.example.php` to `pay/config.php` and fill in the three
   values CBK sends on activation: `client_id`, `client_secret`, `encrp_key`.
   Leave the `mysql_*` keys out and the dropin inherits the orders database
   from `api/config.php` — one set of credentials, not two that can drift.
2. Set `env` to `production` when CBK moves you off the test gateway, and
   confirm `production_base` against your activation email.
3. `return_url` must be the public HTTPS address of `pay/callback.php`. CBK
   calls it out of band; that call, not the customer's return, is what marks an
   order paid.
4. Keep `config.php` out of the web root's reach. `.htaccess` denies it and
   `.gitignore` keeps it out of the repository — it is a bearer credential.

Nothing here can be tested against the real bank from a sandbox, and the rig
says so rather than pretending: with no route to `pg.cbk.com` the dropin gets
as far as the token call and reports it, which `tpay-test.mjs` prints as a skip
rather than a pass.
