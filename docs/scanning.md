# Scanning for broken code

```
npm run scan
```

Runs the linter and five audits in one go: schema use, runtime, place data,
icons, type. All clean.

## What the scan is for

The type-checker and the linter both pass on code that is thoroughly broken.
They cannot read a string, they cannot open a page, and they cannot tell you
that a function exists but nothing calls it. These are the checks for the
things they cannot see.

### `audit:schema` — does the client ask for things the database has?

This was the blind spot. `.from("orders")`, `.rpc("cancel_order", { p_id })`,
`.select("id,status,…")` — every one of those is a string. TypeScript cannot
check it, the linter cannot, and no test suite does either, because they all
run without Supabase or against a fake that answers whatever it is asked. A
table renamed on one side only, a column dropped from a select list, an RPC
whose argument names drifted: each is a runtime failure that first appears
once the site is connected, in front of a customer, looking like "ordering is
broken".

So it reads `schema.sql` and `src/` and compares: 5 tables, 9 functions, every
RPC argument name, every explicit select list, and every column named in a
filter, insert or update. 34 column references checked, all present.

It was wrong twice before it was right, both worth recording:

- The filter section originally matched a lazy window to the next blank line,
  which matched nothing, so it reported success without looking at a single
  filter. **A check that silently does nothing is worse than no check.**
- Fixing that with a flat 900-character window made it read past the end of
  the query: the window after `.from("places")` swallowed the
  `.from("submissions").update()` below it and reported four submissions
  columns as missing from places. Each chain is now bounded at the next
  `.from(`.

It is proved by breaking it on purpose — renaming `published` to `publishedd`
makes it fail, and restoring makes it pass.

### `audit:runtime` — open every page and listen

Every route the build produced, on a phone and on a desktop, watching for
uncaught exceptions, console errors, failed requests and 404s. The suites
drive the paths somebody thought to test; this opens everything.

Third-party hosts are listed separately rather than counted as failures. A
sandbox with no route to openstreetmap.org would otherwise report two failures
on every run until people stopped reading the output.

## What this scan found

**Nothing broken.** Which is worth stating precisely, because several things
were checked and specifically found to be fine:

- Internal links all resolve. `trailingSlash: true` is a real hazard here —
  the source writes `href="/orders"` — but Next normalises it in both the
  server-rendered HTML and the client-rendered DOM. Checked, not assumed.
- All 27 service-worker precache entries exist. One missing entry would make
  `install` reject, so the worker would never activate and offline support
  would silently not exist. The worker registers and reaches `active`.
- Every manifest icon resolves.
- Every localStorage key is both written and read by the same module.
- The map iframe has a real fallback — a pin placeholder behind it, and the
  iframe only renders when online. Its failure in a sandbox is the environment,
  not the code.

Two small things worth knowing rather than fixing:

- `haptics.isSupported()` and `haptics.setEnabled()` are unused. The comment on
  the first says it "lets UI hide a toggle that would lie" — but there is no
  haptics settings screen, so the `wain:haptics` preference can only be set
  from devtools. The library is correct; the screen it was written for was
  never built.
- `form-classes.errorClass` is unused; error text is styled at each call site.
- The voice preferences use `wain-voice-enabled` while everything else uses
  `wain:` with colons. Renaming would orphan the setting on devices that
  already have it, so it stays.
