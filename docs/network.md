# The network layer

Everything the browser sends lives behind `src/lib/net.ts`, installed once as
the Supabase client's `global.fetch` — so it covers queries, RPC, auth token
refreshes and storage uploads together, rather than only the calls somebody
remembered to wrap.

## The problem it was written for

`fetch` has no timeout. Before this existed, **no request in wain could fail
from taking too long.** A phone that walks out of Wi-Fi mid-request leaves the
socket open and the promise pending, and the app waits for it forever: the
admin list, «أرسل الطلب» and «طلباتي» would all sit there spinning, with no
error and no way out. That is the worst of both worlds — it has failed, and it
will not say so.

## What it does

- **A deadline on every request.** 15s for ordinary queries; 3 minutes for
  uploads, because a photo of a shop is several megabytes over a phone
  connection and killing it at 15s would kill every real photo.
- **Offline is answered immediately.** `navigator.onLine === false` means the
  browser is certain nothing can be sent, so the failure is reported at once
  instead of after 15 seconds of silence. (`true` is not treated as proof of
  anything — it only means an interface is up.)
- **Failures are classified** — offline, timeout, or the connection dropping —
  so `describeNetError` can give one Arabic sentence per case instead of a
  single "something went wrong".

## Who retries what

**Exactly one layer retries any given request.** This matters more than it
sounds: nested retry loops multiply rather than add.

| Request | Retried by | Why |
|---|---|---|
| `GET` / `HEAD` (every `.select()`) | **postgrest-js**, on its own | It already does: 3 further attempts on a transport failure or 503/520, backing off 1s, 2s, 4s. |
| `order_status` RPC | **us**, in `fetchOrderState` | PostgREST calls functions over `POST`, so postgrest-js will not touch it. The function is `stable` and reads one row, so asking twice changes nothing. |
| The order insert | **us**, in `submitOrder` | It carries its own primary key, so a repeat collides with itself instead of duplicating. |
| Everything else | **nobody** | Replaying a write that may already have been applied is how one order becomes two. |

The first draft of this file had `deadlineFetch` retrying GETs as well. Stacked
with postgrest-js's own retry and a `retry()` at the call site, reading one list
would have been up to **36 requests**. It does not retry anything now.

## Placing an order twice

`OrderAttempt` — an id and a token — is minted when the order panel opens and
reused for every press of «أرسل الطلب» while the basket is unchanged.

Without it, the id was minted inside `submitOrder`, so this happened: the row
is written, the reply is lost on a bad connection, the customer sees «ما وصل
الطلب» next to a button, presses it again — and the shop makes two coffees for
one person. With a stable id the second press is the *same row*: PostgreSQL
refuses the duplicate primary key with `23505`, and a refused duplicate is
proof the first attempt worked, so it is reported as success.

The signature is the lines plus the collection time. Change what you are
ordering and you get a new id, because that is a different order. Correcting a
typo in your own phone number does not.

## Polling

`src/lib/usePoll.ts`. A `setInterval` around a fetch is the easy version and it
is wrong in four ways, all of which «طلباتي» had:

- it polls a tab nobody is looking at — a phone in a pocket waking the radio
  every 45 seconds to re-read an order that was collected at lunchtime;
- it keeps polling after the answer can no longer change;
- it does **not** poll at the one moment the answer is wanted, so coming back
  to the tab to check shows up to 45 seconds of stale data;
- it keeps hammering a network that is plainly down, at full rate.

So: the timer runs only while the document is visible, a refresh fires the
instant the tab is looked at again or the connection returns, `isFinal` stops
it for good, and repeated failures back off up to 8× before recovering to full
rate on the first success. Overlap is impossible by construction — a new
request aborts the one in flight, so an older answer can never overwrite a
newer one.

## Stale answers

`src/lib/useLatest.ts`. The admin screens reload a list after every action, and
each reload races whatever is still in flight. Mark an order ready and a list
reload from a moment earlier can land afterwards, painting it as new again —
nothing is wrong in the database, the screen is just showing an older truth
than the one it already had. `useLatestRequest` aborts the previous request and
drops any answer from a superseded call, which removes the "setState after
unmount" class of bug in the same stroke.

## Testing

```
npm run test:net
```

39 checks. The real `net.ts`, `orders.ts` and `usePoll.ts` are bundled onto two
blank pages and Playwright plays the server, so the test decides whether a
request fails in transit, stalls forever, returns 503, or comes back with a
duplicate-key error. No Supabase and no Next build are involved.

That is the only honest way to check most of this: "does not replay a POST",
"a stalled request eventually gives up" and "a duplicate key means the order is
already there" are all statements about a bad network, and a good network never
demonstrates any of them. The stalled-request check really does wait out the
15-second deadline.
