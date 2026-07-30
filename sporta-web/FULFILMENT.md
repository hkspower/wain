# Order → logistics company

Every order that gets written emails the warehouse a packing list, automatically.

```
customer pays
     │
     ▼
create_order()  ──── writes orders + order_items
     │
     │  (same transaction — a deferred constraint trigger)
     ▼
fulfilment_outbox  ← the message, snapshotted
     │
     │  Database Webhook fires immediately · a schedule sweeps up anything it missed
     ▼
notify-warehouse   (Supabase Edge Function)
     │
     ▼
WAREHOUSE_EMAIL    subject line says whether to ship
```

A second, one-line email follows when the payment outcome lands: **ship it** or
**do not ship**.

---

## Why an outbox and not just an HTTP call from the trigger

A trigger that POSTs to a function has two failure modes and both are bad.
Synchronous, and the warehouse's mail provider having a slow morning becomes a
checkout that times out — a customer who cannot pay. Fire-and-forget, and a
failed call is recorded nowhere and the order is simply never sent.

The second is the one that matters, because **this failure is silent**. No
customer complains that the warehouse did not get an email. It surfaces days
later as "where is my order".

So the trigger writes a row in the same transaction as the order. If the order
exists, its message exists. Sending is a separate job that drains the table and
marks rows sent; anything unsent is still sitting there, visible in the admin,
and can be retried.

**The trigger is a deferred constraint trigger, not a plain `AFTER INSERT`.**
`order_items` are inserted *after* the `orders` row, so a row-level trigger
snapshots an order with an empty item list — a picking list with nothing on it.
Deferring to the end of the transaction is what makes the items appear.

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

**1. Run the SQL.** `supabase/SETUP-ALL.sql`, which now includes
`fulfilment-migration.sql`. Safe to re-run.

**2. Deploy the function.**

```bash
supabase functions deploy notify-warehouse
supabase secrets set \
  WAREHOUSE_EMAIL=orders@your-logistics-company.com \
  MAIL_FROM=orders@sporta.com.kw \
  RESEND_API_KEY=re_...
```

`WAREHOUSE_EMAIL` takes a comma-separated list if more than one person there
wants a copy. The function refuses to claim anything when it is unset, rather
than burning retry attempts while the real problem is one missing setting.

**3. Trigger it — both ways.**

- **Database Webhook** on INSERT into `fulfilment_outbox`
  (Supabase → Database → Webhooks). This is what makes it immediate.
- **A schedule** every few minutes. This is the safety net and it is *not*
  optional: a webhook that fails to fire leaves an order unsent forever.

Both firing at once is safe — `claim_fulfilment` uses `for update skip locked`.

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
