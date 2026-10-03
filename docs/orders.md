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

## Without a database: the order is a WhatsApp message

Every build to date has no Supabase (see `docs/backend.md`), and until
3 October that meant the panel could only say «مو متاح حالياً». Now **one
channel per build** decides where an order goes — `orderChannel()` in
`src/lib/orders.ts`:

| Supabase configured | place has `orderWhatsApp` | channel |
|---|---|---|
| no | yes | **whatsapp** — the order opens as a message to the shop's number |
| no | no | no panel at all |
| yes | any | **db** — a row the shop reads on «الطلبات المسبقة» |

Never both. Two send buttons would be two orders, and a board that saw half
of them. **The day the database is switched on, every shop stops receiving
WhatsApp orders and has to watch the board instead** — tell them before you
flip it.

In WhatsApp mode:

- The panel asks for a name, a time and an optional note, and **no phone**:
  the shop answers in the thread the customer opens, from the number they are
  writing from.
- «أرسل عبر واتساب» opens `https://wa.me/965<number>?text=…` **inside the
  tap** (Safari and Chrome block a popup that follows an `await`). The order
  is remembered on the device *before* the window opens, so a tab that opens
  and is lost is still in «طلباتي». If the popup is blocked, the message is
  shown in a box with «انسخ» and a plain «افتح واتساب» link, which a tap can
  always open.
- The message, built by `buildOrderMessage` in `src/lib/order-kit.ts` and
  replayed byte for byte by the Flutter app:

  ```
  طلب مسبق من وين — رقم الطلب 3F2B1C
  مقاهي المباركية

  ٢× چاي كرك — ٠٫٥٠٠ د.ك
  ١× قهوة عربية — ٠٫٥٠٠ د.ك
  المجموع التقريبي: ١٫٠٠٠ د.ك

  الاستلام: الساعة ٦:٣٠ م
  الاسم: سالم
  ملاحظة: بدون سكر

  الدفع عند الاستلام 👍
  https://www.wainkw.com/places/mubarakiya-tea-houses/
  ```

- «طلباتي» shows a WhatsApp order as what it is: «أرسلته عبر واتساب», the
  lines and the note the device kept, no status steps (nothing here can read
  what the shop did), «افتح المحادثة», and «ألغِ عبر واتساب» — a link that
  puts «السلام عليكم، أبي ألغي الطلب رقم 3F2B1C إذا ما بدأتوا فيه. شكراً» into
  the same thread and marks the order «طلبت إلغاءه» on the device: a request,
  not a fact the shop confirmed.
- **The admin board never sees a WhatsApp order.** There is no row; the
  thread is the record.

### What a shop sends you to be switched on

One message per shop, in this shape:

```
المكان: mubarakiya-tea-houses      (the slug, or the Arabic name)
واتساب: 5XXXXXXX                   (8 digits — the number that answers orders)
التجهيز: 15                        (minutes, 5–240; default 30)
ملاحظة: الاستلام من الكاشير.       (optional, up to 300 characters)
القائمة:
چاي كرك | 0.250
قهوة عربية | 0.500
كيك اليوم | 1.750 خلص
```

Where it goes: the place's record in `src/lib/places.ts` — `acceptsOrders:
true`, `orderWhatsApp`, `orderPrepMinutes`, `orderNoteAr`, `menuAr` with ids
`m1…mN` that are **never renumbered once shipped** (an order on a device names
its lines by id). Then `npm run db:schema` (the seed carries the menu
columns), `npm run flutter:catalogue`, `npm run flutter:fixtures`, `npm run
ai:brief` (the brief flips from «nobody takes orders» to naming the place),
`npm run content`, `npm run scan` — `audit:places` refuses a place that
accepts orders without a menu or a number — screenshots, the owner's yes, and
a deploy, which is a separate decision.

## Turning it on for a business (with a database)

Two things are required, and a menu alone is not enough:

1. `menu_ar` — the priced items.
2. `accepts_orders` — the business's own switch. Publishing a menu is not
   consent to take orders, and turning ordering off must never delete the menu.

Plus `order_whatsapp` while there is no database (above). All are edited in
the admin place editor, or in `places.ts` for a shipped place. The menu is one
line per item:

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

## Calling it off

There was no way out at all: place an order, change your plans, and the shop
still made it. `cancel_order(p_id, p_token)` takes the same two values as
`order_status` and cancels — **but only while the order is still `placed`.**

That limit is a choice, not a technical one. Once the business marks the order
ready the food exists and somebody paid for the ingredients, so the honest
thing is to send the customer to the phone rather than let them wave it away
from a screen. The function returns the status it ended on, so «ألغيناه» and
«فات الأوان» are told apart without a second round trip, and the cancel button
only appears while it would actually work — a button that quietly fails is
worse than no button. Cancelling twice is not an error.

Verified against PostgreSQL 16: a wrong token cancels nothing and returns
nothing, another customer's id with this token cancels nothing, a `ready` order
comes back `ready`, and `cancelled_at` is stamped by the trigger rather than by
the caller.

## How long the business needs

`order_prep_minutes` on the place, 5 to 240, default 30. The first collection
slot starts after it.

A blanket half hour was wrong in both directions — too long for a karak
somebody wants on the way past, nowhere near enough for a mixed grill, and
offering a grill in thirty minutes only sets the customer up to stand around
waiting. The bounds are the same number in `clampPrepMinutes` and in the
column's CHECK, and a test asserts they still match, because a form that
accepts what the database refuses is a silent failure at save time.

## Being told an order arrived

The queue used to load once and sit there. An order placed while the tab was
open never appeared, and the first anybody knew of it was the customer turning
up to collect something nobody had made.

It now re-reads itself every 30 seconds, **and does not pause while the tab is
hidden** — unlike everything else that polls, because a shop keeps this open in
a background tab all day and that is exactly when the alert has to land. A new
order marks the row «وصل الحين», puts a count in the tab title, and plays a
two-note chime.

The chime is synthesised, not a downloaded file, and it is deliberately not a
browser notification: asking a shop for notification permission the moment they
open the queue is the behaviour browsers now penalise, and a sound reaches
somebody in a back room just as well without asking. It is on by default and
can be switched off — a shop that misses an order because nobody found the
sound switch has been let down by us.

Orders outstanding when the queue is first opened do not set off the alarm.
Only ids that appear afterwards count as new.

## شوق does not offer this yet

The agent brief is generated with the place data, and today it tells شوق
plainly that **no business accepts pre-orders** and that she must not offer
it. The moment one switches ordering on, `npm run ai:brief` flips that section
to name the place instead. Told merely that the list is empty, an agent will
still cheerfully suggest ordering ahead — so the brief forbids it rather than
describing it. Both branches are covered by `npm run test:shouq`.

## What still needs you

**Without a database**, ordering works the moment a shop's menu and number
land in `places.ts` (the intake shape above) and the site is deployed. Nothing
on the server changes.

**To switch the database on** — which moves every shop's orders from WhatsApp
to the board in one build:

1. Create the Supabase project and run the **regenerated** `supabase/schema.sql`
   (`npm run db:schema`; the committed file carries the seed with the menu
   columns). Insert the admin row, turn off sign-ups (`docs/admin-setup.md`).
2. Put `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` into
   **this environment's secrets** (and GitHub's variables for CI). Say so.
3. Rebuild (`npm run release`), confirm `build.json` says Supabase is on, run
   `PATH=/usr/lib/postgresql/16/bin:$PATH npm run test:db` and `npm run
   test:journey`, deploy.
4. The live proof is one order placed from a phone appearing on **الطلبات
   المسبقة** — the sandbox cannot reach a Supabase host.

## Testing

```
npm run test:orders
```

97 checks on the money, the order rules and the WhatsApp message (byte for
byte, with and without a note, the URL round trip, the cancel sentence); the
panel driven in a browser; 48 on «طلباتي», including a WhatsApp order beside a
database one; and **54 on the WhatsApp flow against a fixture build** — a
throwaway worktree (`tests/fixture-build.mjs`) with one place given a menu
and a number, built with no Supabase, `window.open` and the clipboard
replaced by spies. `npm run test:net` covers the rest — cancelling, and what
happens to an order on a bad network; `npm run test:journey` walks the
database path end to end, including a customer calling her own order off.

**The production-build panel layer skips, and will keep skipping until a
business turns ordering on.** No shipped place has a menu, because inventing a
price list for a real café and showing it to customers who will be charged at
that café's counter is not something wain should do; the fixture build exists
so the code is still exercised. When a real menu lands, that layer runs on the
production build too.

The tracking tests run against a static build with no Supabase, which is the
case worth testing hardest: with the network silent a database order must still
show the reference, the place and the time from what the device remembers, and
must say it could not confirm the status rather than inventing one — and a
WhatsApp order must say the status is not shown here at all.
