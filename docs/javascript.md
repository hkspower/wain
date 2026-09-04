# The JavaScript

```
npm run lint
```

## There was no linter

`npm run lint` ran `next lint`, which offers to *set one up* and then waits for
an answer — so in any non-interactive shell it hung, and in practice nothing
was ever linted. Nothing was checking for a stale hook dependency, a dead
import, or an `any` that quietly switches off type-checking for everything
downstream of it.

It is now ESLint 9 flat config with `next/core-web-vitals` and
typescript-eslint, over three surfaces that are genuinely different programs:

| Surface | Rules |
|---|---|
| `src/**` | React in a browser. No console, no `any` without argument, exhaustive hook deps. |
| `scripts/**`, `tests/**` | Node. These exist to print, so `no-console` is off. |
| `tests/harness/**` | Deliberately reaches for window globals and replaces browser APIs. That is the job, not a smell. |

The first run reported 18 problems. All 18 are fixed; the linter is clean.

## What it found

**Seven dead imports.** `readFileSync` in the place audit, `writeFileSync` in
the preview generator, `orderTotal` in the place form, `SALON_LABEL` in the
admin queue, `spawnSync` and `pathToFileURL` in the order runner, and an unused
callback argument in the brief generator.

**Two hook problems, both real:**

- `CoordinatePicker` built `point` fresh on every render and its marker memo
  worked around that by depending on `point.lat` and `point.lng` rather than
  `point`. Correct — but only while nothing else in the object ever matters,
  and not something a compiler can check. `point` is memoised now and the
  dependency is the object itself.
- `OrderPanel` did `place.menuAr ?? []`, handing out a fresh empty array every
  render, which would defeat the `lines` memo entirely for a place with no
  menu. One shared constant instead.

**Seven regexes with runs of literal spaces**, now `{2}` and `{4}`. Identical
behaviour, and you can count them.

## The dependency that was never declared

Installing ESLint pruned `playwright` from `node_modules`, and every browser
test in the repo failed at once. It had never been in `package.json` — it was
present only because the container image happened to ship it.

**`npm ci` on any other machine would have failed exactly the same way**, and
the whole test suite with it. `playwright` and `esbuild` are declared now, and
the scripts use the local `esbuild` rather than `npx -y esbuild`, which was
downloading it afresh on every run.

## Known advisories

`npm audit` reports three high-severity issues, all in Next's own bundled
`postcss` and `sharp`, all pre-existing. They are **build-time only**: postcss
processes CSS this repo wrote, sharp processes images this repo ships, and the
output is a static export with no server. Nothing untrusted reaches either.
The fix `npm audit fix --force` offers is Next 16 — a major upgrade, and not
something to do quietly under the heading of linting.

---

# What actually reaches a phone

```
npm run audit:js
```

`npm run lint` checks the source. This checks the build, which is a different
question and the one a visitor on a mobile connection pays for. Everything
below is gzipped and measured from the chunks each page's HTML really
references — not from what is on disk, because the two are not close.

## The numbers

| route | JS, gzipped |
| --- | ---: |
| `/admin/` | 152.5K |
| `/search/` | 148.7K |
| `/add/` | 143.6K |
| `/orders/` | 139.5K |
| `/explore/` | 138.6K |
| `/places/<slug>/` | 138.2K |
| `/queue/` | 136.7K |
| `/` | 133.4K |
| `/about/`, `/privacy/` | **131.1K** |

**130.9K of that is shared by all 46 pages.** The spread between the heaviest
route and the lightest is 21K; the floor is the whole story.

Confirmed in a real browser as well as on disk — 139–165K over the wire per
route, the difference being chunks hydration pulls in afterwards.

## What is already right

**Code splitting works.** `@supabase/supabase-js` is 177KB raw and sits in its
own chunk that **no page loads statically** — not even `/admin/`. It arrives
only when something actually talks to the database.

**No source maps.** None shipped, and no chunk carries a `sourceMappingURL`.
The TypeScript, comments included, stays out of the browser.

**No orphans.** Every chunk in the deploy is reachable from something.

**The polyfills are free.** `polyfills-*.js` is 110KB on disk and the single
largest file in the build, and a modern browser downloads **none** of it: the
tag carries `nomodule`. Verified by watching the network in Chromium rather
than by reading the tag, because that is the sort of thing that is true until
it silently isn't. The audit excludes `nomodule` scripts from its totals for
the same reason — counting them would overstate every route by ~38K and hide
real regressions underneath.

## What the scan found — and what the first diagnosis got wrong

**The privacy page shipped all 36 places.** Fixed; the account below is kept
because the wrong answer was the instructive part.

`/privacy/` and `/about/` have no map, no list and no search. They carry the
entire place catalogue anyway — 36 of 36 records — along with شوق's call UI,
the ElevenLabs integration and the speech-recognition path.

I blamed `WainAi`, because it is a static import in the root layout and it
answers questions about places. **That was wrong — `WainAi` imports no places
at all.** Tracing the real value-import graph gave a four-edge path through a
module nobody would think to look at:

```
layout → Footer / AppTabBar → OrdersLink → orders.ts / queue.ts
(the footer has since been removed; OrdersLink now hangs off the Navbar, and
the same edge would put the catalogue on every page from there instead)
       → supabase.ts → places.ts
```

`supabase.ts` imported `clampPrepMinutes` and `clampServiceMinutes` from the
catalogue's module. Two small functions, one edge, and all 36 records landed on
all 46 pages — because `places.ts` held both the catalogue and the small
vocabulary everything else needs.

**The fix** is `src/lib/place-kit.ts`: the category list, the clamps, the
Arabic-Indic numerals and the counting forms, with a rule that nothing in it
may import the catalogue. `places.ts` re-exports it, so every existing import
keeps working, and the four consumers that only ever wanted the vocabulary —
`Footer`, `OrdersLink`, `orders.ts`, `queue.ts` and `supabase.ts` — point at
the light module instead.

| | before | after |
| --- | ---: | ---: |
| shared by all 46 pages | 130.9K | **122.5K** |
| `/privacy/`, `/about/` | 131.1K | **122.7K** |
| place records on a static page | 36/36 | **0/36** |

A type-only import is erased at compile time and costs nothing, so
`import type { Place }` still names the catalogue's module — it is which
module the VALUES come from that matters.

**The fix is small but it is a visible one**, which is why it is written down
here rather than applied:

```tsx
const WainAi = dynamic(() => import("@/components/WainAi"), { ssr: false });
```

That moves roughly 20K gzipped off the floor of every page. The cost is that
the شوق launcher appears after hydration instead of in the first paint — a
floating button popping in a fraction of a second late. Whether that trade is
worth it is a judgement about شوق, not about bytes. A middle path exists:
keep a static, styled button and lazily load only the panel and the call logic
behind it, so nothing pops in and the weight still goes.

## The budget

`audit:js` fails the build over **175K gzipped** on any route. That is a
ratchet rather than a target: it sits just above where the site is today, so a
regression is loud and an improvement is free. The heaviest route has 22K of
headroom.

## npm audit

Three high-severity advisories, all the same root: `sharp` below 0.35, pulling
inherited `libvips` CVEs. `sharp` is a build-time dependency — it renders the
OG cards in `scripts/gen-og.mjs` — and **is never shipped to a browser**. The
only fix npm offers is `next@16`, a major upgrade. Left alone deliberately;
the exposure is a build box, not a visitor.
