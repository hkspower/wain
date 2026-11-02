# Order → logistics company

Every order that gets written emails the warehouse a packing list, automatically.

```
customer pays
     │
     ▼
store_create_order()  ── writes orders + order_items
     │
     │  (same transaction, always — store_queue_fulfilment())
     ▼
fulfilment_outbox  ← the message, snapshotted
     │
     │  a cron job every 5 minutes drains it
     ▼
api/cron-fulfilment.php
     │
     ▼
warehouse_email    subject line says whether to ship
```

A second, one-line email follows when the payment outcome lands: **ship it** or
**do not ship**.

---

## Why an outbox and not just an HTTP call at checkout

> **Terminology, corrected.** This section described a *deferred constraint
> trigger* — a Postgres feature, from when the shop ran on Supabase. There are
> **no database triggers in the MySQL schema at all**; the outbox row is
> written by `store_queue_fulfilment()` in PHP, called inside the checkout
> transaction (and again by each gateway's callback). Every guarantee below
> still holds — it is the same transaction and the same all-or-nothing — but
> the mechanism is a function call, not a trigger, and looking for the trigger
> is a wasted afternoon.

Posting to the warehouse straight from the checkout has two failure modes and
both are bad.
Synchronous, and the warehouse's mail provider having a slow morning becomes a
checkout that times out — a customer who cannot pay. Fire-and-forget, and a
failed call is recorded nowhere and the order is simply never sent.

The second is the one that matters, because **this failure is silent**. No
customer complains that the warehouse did not get an email. It surfaces days
later as "where is my order".

So the row is written in the same transaction as the order. If the order
exists, its message exists. Sending is a separate job that drains the table and
marks rows sent; anything unsent is still sitting there, visible in the admin,
and can be retried.

**It is queued AFTER the items are inserted, not alongside the `orders` row.**
`order_items` are written after `orders`, so anything snapshotting the order
at insert time gets an empty item list — a picking list with nothing on it.
Calling `store_queue_fulfilment()` at the end of the transaction body is what
makes the items appear. (Under Postgres the same problem was solved with a
deferred constraint trigger; in PHP it is just where the call sits.)

---

## When it fires

**On INSERT.** This was chosen deliberately, with the consequence understood, so
nobody later reads it as an oversight:

> an order is INSERTed as `pending`, **before** the customer has paid.

So the warehouse will see orders abandoned at the bank page and never paid for.
Two things make that workable:

1. Every message states the payment state **in the subject line** — `PAID`,
   `AWAITING PAYMENT — hold`, or `COLLECT CASH`.
2. A follow-up email lands the moment the outcome is known.

**The warehouse's rule: do not ship a card order until the follow-up says paid.**
Cash on delivery needs no wait — there is no payment step to fail.

---

## What the email says

Written for a picker on a warehouse floor, on a phone, with a trolley:

- **The subject line carries the whole answer** — order number, ship-or-hold,
  item count, area. Often it is all that gets read.
- **COLLECT CASH is the loudest thing on the page**, with the amount next to it.
  Handing over goods and forgetting to take the money is a straight loss.
- **Size and cut are in their own column**, not appended to the product name.
  "Cloudsoft Jacket — Army Green L oversize" read at speed picks the wrong
  garment.
- **Arabic and English together**, and a plain-text part alongside the HTML —
  warehouse mail clients are not Gmail.

Customer free text (the delivery note) is HTML-escaped. It is the one field a
stranger controls that lands in your logistics company's inbox.

---

## Setting it up

**1. Import the SQL.** `api/schema.mysql.sql` creates `fulfilment_outbox`
along with everything else. Safe to re-run.

**2. Set two values in `api/config.php`** (on the server, never committed):

```php
'warehouse_email' => 'orders@your-logistics-company.com',
'cron_key'        => '<a long random string>',
```

`warehouse_email` takes a comma-separated list if more than one person there
wants a copy. The drain refuses to claim anything when it is unset, rather than
burning retry attempts while the real problem is one missing setting.

**3. Add the cron job.** hPanel → Advanced → Cron Jobs, every 5 minutes:

```
wget -qO- "https://www.sporta.com.kw/api/cron-fulfilment.php?key=YOUR_CRON_KEY"
```

The key is checked with `hash_equals` before anything else happens, so the
endpoint is inert to anyone who does not have it. Two overlapping runs are
safe: the claim uses `for update skip locked` inside a transaction, and a
message is retried at most 5 times.

**4. Set SPF, DKIM and DMARC.** See `DNS-EMAIL-RECORDS.txt`. Without them mail
from `@sporta.com.kw` lands in the logistics company's spam folder or is
rejected outright, and **you will not be told**. This is the most likely reason
for the whole flow to appear to work and deliver nothing.

Swapping email provider is one function — `sendEmail()` in `index.ts`. Nothing
else knows Resend exists.

---

## Checking on it

```sql
select * from admin_fulfilment_status();   -- admin only
```

Anything with `sent_at` null has not reached the warehouse. `attempts` reaching
5 means it stopped trying — a bad address or a dead provider, which a queue that
never empties would otherwise hide.

```bash
./scripts/db-rebuild.sh fresh && npm run test:fulfilment
```

23 checks against a real PostgreSQL: that an order queues exactly one message,
that the items are in it, that a re-written status does not spam the warehouse,
that a sent message is never claimed twice, that COD says collect cash with the
amount, and that a delivery note cannot inject markup into the email.

---

## Cancelled, reinstated and shipped orders (MySQL, `php-store`)

Every warehouse message is queued in the same transaction as the change it
reports, and the drain decides again, under the order's row lock, immediately
before it mails. The rules are in `store_outbox_closed_reason()` (store.php):

| The order is | Unsent `new` (picking list) | Unsent `reinstate` | Unsent `payment` | Unsent `cancel` |
|---|---|---|---|---|
| cancelled, warehouse heard nothing | closed | closed | closed | closed |
| cancelled, warehouse heard something | closed | closed | sent | sent |
| shipped or delivered | closed | sent | closed | sent |

A closed row is never mailed; its `last_error` says why (`order cancelled`,
`order reinstated`, `order shipped`).

- **Cancelling** is refused with 409 for an order that has left the shop
  (`order_already_shipped`) or is paid (`order_paid`). Both are settled through
  Returns and a refund, by hand.
- **A cash order past `cod_hold_hours`** cannot go back as `unfulfilled`
  (`cod_hold_expired`): the sweeper would cancel it again. Put it back as packed.
- **A cancelled card order** cannot be settled by hand (`order_cancelled`): put
  it back first. A bank capture that arrives after a cancel is held for review
  (`ORDER_CANCELLED`), not marked paid.
- **Five failed sends** of a cancel, payment or picking list write one
  `warehouse_mail_failed` row to the Activity page (actor `system`). The drain
  never retries a row past five, so this row is how the owner learns of it.

**Before deploying** on a database created before this change, import
`dropin/php-store/outbox-kinds.mysql.sql`. Until it is in, the outbox refuses
the `cancel` and `reinstate` kinds, and the cash sweeper cancels nothing.
