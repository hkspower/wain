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

## What still needs you

Nothing in this feature works until `supabase/schema.sql` has been run — the
order form says so plainly rather than pretending to send. Once it is:

1. Set `accepts_orders` and a menu on a place in the admin editor.
2. Watch the **الطلبات المسبقة** tab. New orders show a count on it.

## Testing

```
npm run test:orders
```

58 checks on the money and the order rules, plus the panel driven in a browser.
The browser layer needs a place with a menu; with none it skips rather than
reporting a false pass.
