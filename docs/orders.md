# طلب مسبق — order ahead, pay on collection

## What it is, and what it deliberately is not

A customer opens a place, picks items from its menu, chooses a collection
time, and sends the order. The business gets a message saying "have this ready
at this time". **The money changes hands at the counter, exactly as it would
have anyway.**

wain never takes a card, never holds anyone's money, and never sits between a
customer and a business. That is a design decision, not a limitation, and it
buys a great deal:

- No payment gateway, no merchant account, no PCI surface.
- No settlement, no reconciliation, no refunds to get wrong.
- No licence needed to hold other people's money in Kuwait.
- A tampered total costs nobody anything — the business charges from its own
  menu, and can see every line the customer was shown.

**The word «مدفوع» appears nowhere in this feature.** Telling somebody their
order is paid when they have not paid is the one thing it must never do. The
customer-facing total is labelled «المجموع التقريبي» — approximate, because the
business's till is the authority on the price and this is a message, not a
receipt.

## Turning it on for a business

Two things are required, and a menu alone is not enough:

1. `menu_ar` — the priced items.
2. `accepts_orders` — the business's own switch. Publishing a menu is not
   consent to take orders, and turning ordering off must never delete the menu.

Both are edited in the admin place editor. The menu is one line per item:

```
چاي كرك | 0.250
قهوة عربية | 0.500
كيك اليوم | 1.750 خلص
```

`خلص` marks something unavailable today without deleting it. A line whose price
will not parse is **dropped, not saved as zero** — a silent free item is worse
than a missing one — and the preview under the box shows the count so a dropped
line is visible immediately.

## Money

Kuwait's dinar has **three** decimal places: 1.250 KWD is one dinar and 250
fils. Every price in this feature is an integer number of fils and never a
float, because `0.1 + 0.2 !== 0.3` in binary floating point and money that is
out by a thousandth is money that is wrong. Formatting to `٢٫٧٥٠ د.ك` happens
once, at the edge.

The ceiling is 50 KWD per order — generous for something collected by hand, and
low enough that a mistake is obvious.

## What the database enforces

`public.orders`, with row-level security doing the work:

- **anon may insert and nothing else.** A customer can place an order and
  cannot read one back — not their own, and certainly not anybody else's phone
  number. Verified against PostgreSQL 16: an anonymous session that has just
  inserted a row reads `0` rows from the table.
- **A new order is `placed` and nothing else.** Without that clause in the
  policy, an anonymous caller could insert a row already marked collected.
- Admins read and update; the status moves `placed → ready → collected`, or
  `cancelled`.
- Phone numbers must be Kuwaiti mobiles: eight digits starting 5, 6 or 9. A
  landline is rejected at the database as well as in the form.

## Tracking an order without an account

The customer never signs up, so there is no login to hang an order off. Instead
the device holds two things it generated itself: the order's `id` and a random
32-character `track_token`. Together they are the only key to that order, and
`/orders/` — «طلباتي» — is where they are spent.

Reading is done by `public.order_status(p_id, p_token)`, a `security definer`
function with a pinned `search_path`. It reaches past the deny-all SELECT
policy, but only for a caller holding both values, and **it returns no customer
name and no phone number** — so even a leaked token discloses only what its
holder already knew. Verified against PostgreSQL 16: the right pair returns the
order; a wrong token returns nothing; another customer's id with this token
returns nothing; and `anon` still cannot read `public.orders` at all.

The status timestamps are stamped by a trigger, not by whoever sent the update.
`ready_at`, `collected_at` and `cancelled_at` follow from the status changing,
so the queue cannot post-date a collection and the customer's screen cannot be
told an order was ready before it was.

Losing the device's storage loses the list. That is the honest cost of not
asking anyone to sign up, so the reference is shown large enough to read out
and the business can always find the order by it.

### Sending twice

A stable `OrderAttempt` id means pressing «أرسل الطلب» again after a lost reply
collides with the row already written rather than adding a second one. See
[network.md](network.md) — the reasoning is the same for every write.

### A bug this fixed

The first version of `submitOrder` did `.insert(...).select("id").single()`.
PostgreSQL applies the **SELECT** policy to rows returned by `RETURNING`, and
`anon` has no SELECT policy, so the whole statement rolled back and no order
was ever placed. The id and token are now generated on the device and nothing
is asked for back. Related: `public.orders` had no explicit `GRANT` at all and
relied on Supabase's default privileges being untouched — the grants are now
written out in `schema.sql`.

## What still needs you

Nothing in this feature works until `supabase/schema.sql` has been run — the
order form says so plainly rather than pretending to send. Once it is:

1. Set `accepts_orders` and a menu on a place in the admin editor.
2. Watch the **الطلبات المسبقة** tab. New orders show a count on it.

## Testing

```
npm run test:orders
```

58 checks on the money and the order rules, the panel driven in a browser, and
22 more on «طلباتي». The panel layer needs a place with a menu; with none it
skips rather than reporting a false pass.

The tracking tests run against a static build with no Supabase, which is the
case worth testing hardest: with the network silent the screen must still show
the reference, the place and the time from what the device remembers, and must
say it could not confirm the status rather than inventing one.
