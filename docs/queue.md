# الطابور — take your turn at the salon

## What it is

A customer opens a salon's page, sees how many people are waiting, and takes a
number without standing in the shop. They watch their position from wherever
they are and walk over when it is nearly their turn.

**A ticket is a place in a line, not a booking.** There are no time slots and
no chosen barber: one queue per salon, next available. That is what the word
«دور» means to the person using it, and it is the version where the number on
the screen cannot disagree with the room.

## Men's and women's

A salon is **either** men's **or** women's, never both — they are separate
premises with separate staff, so `salon_kind` is one value per business and the
customer is shown «صالون رجالي» or «صالون نسائي» before they join anything.

Two things are required before a salon can take turns, and being a salon is not
enough on its own:

1. `salon_kind` — which kind it is.
2. `takes_queue` — the business's own switch, the same bargain as `accepts_orders`.

## Walk-ins are the whole point

Most barbershop customers still walk in. A queue that counted only the people
who used the app would tell everybody a position the room disagrees with — and
a wrong position is worse than none, because somebody plans around it.

So the counter has **«أضف زبون جا للمحل»**, and it goes through the same
numbering function the app does, into the same line. Walk-ins are marked «جا
للمحل» in the admin list so the salon can see where its custom comes from,
but the queue does not treat them differently in any way that matters.

## The number

**Assigned by the database, never by the device.** Two people tapping at the
same moment would pick the same one, and two customers who are both «رقم ٧» is
worse than no queue at all.

`join_queue()` takes a transaction-scoped advisory lock keyed on the salon and
the day, reads the highest number so far, and inserts. The lock is per salon,
so two salons never wait on each other, and it is held only for the length of
the statement. A unique index on `(place_slug, day, number)` sits behind it:
if two callers ever did race past the lock, the second insert fails rather than
handing two people the same ticket.

Verified with **forty simultaneous joins: forty distinct numbers, one to
forty, no gaps and no collisions.**

Numbers restart each day, on **Kuwait's** day (UTC+3, no daylight saving) —
`current_date` would have restarted the numbering at 3am local, in the middle
of a late shift, with two customers holding «رقم ١».

## One live ticket per phone

A unique partial index on `(place_slug, day, customer_phone)` where the status
is still `waiting` or `called`. Without it, a customer who taps twice is two
people in the line and everybody behind them waits for a chair nobody sits in.

## The wait estimate is deliberately vague

Position × the salon's average, rounded to five minutes, and always prefixed
«تقريباً». It is an average a salon typed into a form once, so «١٧ دقيقة» would
imply a precision that does not exist — and people hold you to a number like
that. A test asserts every estimate is hedged and none of them names a clock
time.

The busy-ness is shown **before** the join button, not after. A queue app that
makes you commit before telling you the wait has taken something from you
rather than given you something: the whole point is deciding whether to go now,
later, or somewhere else.

## What the database enforces

`public.queue_tickets`, with RLS doing the work:

- **anon reads nothing.** Not the table, not another customer's ticket, not a
  name or a phone number. Verified: an anonymous session gets `permission
  denied` on the table itself.
- **anon does not insert directly either.** `join_queue()` is the only way in,
  because the number has to come from the database.
- **A walk-in can only be added by staff.** `join_queue` checks the `admins`
  table before accepting `source = 'walk_in'` — an anonymous caller claiming to
  be a walk-in would be inserting a customer who is not in the room.
- **A closed queue refuses.** The function checks `published` and `takes_queue`
  rather than trusting the page that called it.
- Status times are stamped by a trigger, so nobody can claim they were called
  an hour ago.

`queue_status(p_id, p_token)` is the customer's window: the id and the token
together are the whole authorisation, and it returns **no name and no phone**,
so a leaked token discloses only what its holder already knew. `queue_size()`
exposes a count and nothing else — how busy a salon is, with nothing about the
people in it.

`leave_queue(p_id, p_token)` works while `waiting` **and** while `called` —
somebody who has been called and cannot make it should be able to say so, which
is better for the salon than a no-show.

Verified against PostgreSQL 16: a wrong token reads nothing and cancels
nothing; another customer's id with this token reads nothing; a served ticket
cannot be walked back by its holder; leaving twice is not an error.

## Being told somebody arrived

The **الطابور** tab polls every 20 seconds and, like the orders queue, **does
not pause while the tab is hidden** — a salon keeps this open in a background
tab all day, and that is exactly when a new arrival has to be noticed. A new
ticket marks the row «وصل الحين» and plays the same chime.

«نادِ التالي» is at the top, because calling the next person is the one action
a counter repeats all day.

## What still needs you

1. Run `supabase/schema.sql` — it now carries the queue.
2. In the place editor, set the salon's kind, switch **يستقبل أدوار** on, and
   set how long one customer takes.

No shipped place is a salon, so nothing has a queue yet. That is data a
business provides, not something wain should invent about a real shop.

## Testing

```
npm run test:orders     # includes the queue's rules and the دوري screen
npm run test:net        # joining, leaving, and reading a position on a bad network
```

43 checks on the rules, 22 on the screen, 20 on the network behaviour. The
screen is tested against a build with **no** database, which is the case worth
testing hardest: with nothing to ask, it must show the number the device holds
and admit it cannot confirm the position rather than inventing one. A queue
screen that guesses is worse than one that says it does not know — somebody
misses their turn on it.
