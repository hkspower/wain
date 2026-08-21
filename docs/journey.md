# The whole journey

```
npm run test:journey
```

Thirty-six checks that walk one customer from her first tap to a collected
order: home → search palette → results → the place → the order panel → the
basket → validation → send → confirmation → «طلباتي» → ready → collected.

Every other suite tests a layer. This is the only one that can catch a break
*between* two layers that are each fine on their own.

## One rule: never navigate by URL

Every step has to be reachable by tapping what is on the screen. A page that
works perfectly when you type its address and is unreachable from the page
before it is broken, and nothing but a journey notices.

That rule earned its keep immediately. The first draft clicked what looked
like a search link and asserted the URL had changed — it had not, because the
navbar's search button opens the **palette**, an overlay whose dialog is loaded
on demand. Stepping around it by visiting `/search/` would have skipped the
code path a thumb actually takes.

## It needs its own build, in a worktree

Two things are missing from the shipping build, both deliberately:

- **No place has a menu.** Inventing a price list for a real café and showing
  it to customers who will be charged at that café's counter is not something
  wain should do — so until a business opts in, the order panel has never
  rendered in a test and the browser order suite has always skipped.
- **No Supabase.** Ordering cannot complete without a database.

So the runner creates a **git worktree** — a clean checkout of HEAD, plus any
uncommitted files carried across — gives one place a three-item menu there, and
builds pointing at a Supabase URL on the test's own origin. The working tree is
never touched. A test that patches `places.ts` in place leaves it patched the
first time somebody kills the run, and that is a bad afternoon.

Playwright plays the shop: it holds one order in memory, and the test moves it
to `ready` and then `collected` the way the admin queue would, so the
customer's screen is reacting to a real state change rather than to something
the test told it directly.

## What it covers that no unit test can

- **The palette's dialog really arrives** when the button is tapped — it is
  code-split, so "it works" and "it downloads" are different claims.
- **A dropped request does not become two orders.** The first POST is aborted
  mid-journey; the retry carries the same id, and the test asserts every POST
  that reached the server had one id between them.
- **The confirmation links onward to «طلباتي»**, and that link works.
- **The tracker catches up when she looks back at her phone** — the status is
  flipped while the tab is hidden, and the screen is correct within a moment of
  it becoming visible, not a poll interval later.
- **Cancelling disappears once the food exists.** It is offered while the order
  is `placed` and gone once it is `ready`.
- **Polling stops after collection** — and the check first asserts polling was
  happening, or it would pass on a tracker that never polled at all.
- **«مدفوع» appears at no point in the entire journey.** wain never took the
  money, so nothing may ever say it did.
