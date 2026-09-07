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
the whole test suite with it. `playwright` and `esbuild` are declared now, so
the download that used to happen on every run does not.

This paragraph used to claim the scripts had been changed to call the local
`esbuild` binary instead of `npx -y esbuild`. **They had not**, and nine call
sites still go through `npx` — `gen-voice`, `gen-photos`, `gen-voice-fixture`,
`audit-search`, `audit-places`, `audit-photos`, `map-frame`, `hangout` and the
شوق runner. The declaration is what fixed the problem, not the call sites:
with `esbuild` in `package.json`, `npx` resolves it from `node_modules` in
0.36s and fetches nothing. So the outcome the old sentence claimed is real and
its mechanism was not, which is the worse of the two ways to be wrong — anyone
grepping for a local-binary call would have found nothing and had to work out
why the claim did not match the code.

Left as `npx` deliberately: it resolves locally, and rewriting nine call sites
to save a third of a second each is not worth the churn. What matters is that
`esbuild` stays declared — remove it and every one of those nine starts
downloading again.

## Known advisories

Re-measured 7 September: **2 advisories, 1 moderate and 1 high**, and both are
`postcss`. Counted, not remembered — this section previously said three highs
rooted in `sharp`, and every part of that is now out of date.

**`sharp` is no longer in the set at all.** The tree carries 0.35.4, and the
inherited `libvips` CVEs applied below 0.35. It came up with a Next patch
release rather than by anyone deciding to fix it, which is exactly why the
number is worth re-reading rather than quoting from the last time.

**Only one copy of postcss is actually vulnerable, and it is not ours.** The
advisory range is `<=8.5.22` and there are two copies in the tree:

| copy | version | affected |
| --- | --- | --- |
| `@tailwindcss/postcss` → `postcss` | 8.5.28 | no — already patched |
| `next` → `postcss` | 8.4.31 | yes |

So the exposure is the postcss Next pins internally for its own build
pipeline, which is why the only fix npm offers is `next@16` and why upgrading
Tailwind would not move it.

**Build-time only, and the specific CVEs say so more clearly than "build-time
only" does.** Three of the four are `sourceMappingURL` path traversal and
arbitrary `.map` disclosure; the fourth is XSS via an unescaped `</style>` in
stringify output. Every one needs *attacker-controlled CSS* as input. The only
CSS that reaches postcss here is `globals.css` and what Tailwind generates from
this repo's own class names, at build time, on a machine that is already
trusted with the deploy credentials. There is no path by which a visitor's
input becomes CSS, and the output is a static export with no server.

Left alone deliberately, and `npm audit fix --force` is still Next 16 — a
major upgrade with its own section below, not something to do quietly under
the heading of linting.

### The Next 16 upgrade, attempted and reverted

Tried on 6 September, on the current tree, and backed out. `next@16` and
`eslint-config-next@16` install cleanly and take `npm audit` to **zero
vulnerabilities**, the export keeps its shape — 63 pages, `places/<slug>/`
directories, all 52 OG cards — and the build passes. Two things stop it, and
both are worth knowing before anyone tries again.

**The lint config breaks, and that part is easy.** From 16, eslint-config-next
ships flat config; before that it was eslintrc-style and had to come through
`FlatCompat`. Handed a flat config, the compat wrapper walks it as eslintrc and
dies on the circular reference inside `configs` — «Converting circular
structure to JSON», with no mention of Next in the message. The fix is two
lines: import `eslint-config-next/core-web-vitals` directly and spread it,
dropping FlatCompat.

**The rules behind it are the real cost.** With linting running again, 16
brings the React-Compiler-era hook rules and the tree fails 32 of them:
20 `react-hooks/set-state-in-effect`, 8 `react-hooks/refs`,
3 `react-hooks/immutability`, 1 `react-hooks/purity`. They are not confined to
the test harness — they land on `usePoll`, `useFrameWidth`, `useListboxKeys`,
`OrderPanel` and the admin submissions table, which is to say on the polling,
the keyboard navigation and the measurement code: the parts where a subtle
behavioural change is hardest to see and most expensive to ship.

Several of them also flag patterns this repo chose on purpose and documented.
`setNow(new Date())` inside an effect is exactly `set-state-in-effect`, and it
is there because the clock is not knowable while a page is prerendered — the
export is one HTML file served to everybody, so a value baked in at build time
is wrong for every visitor after the one whose build it was.

So the honest options are to do the migration properly — rewrite those sites,
one hook at a time, with the suites run between each — or to switch the four
rules off, which trades a real new signal on exactly the code that most needs
it for an advisory that cannot reach a visitor. Neither belongs inside a
routine dependency update, and the second is a decision for the owner rather
than a default.

Meanwhile every in-range update **is** applied: the tree tracks the latest
patch and minor of everything it depends on. What is pinned back is four
majors — `next` and `eslint-config-next` (above), `eslint` 10, `@types/node`
26 and `typescript` 7 — each a migration in its own right.

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

Two advisories, one moderate and one high, both `postcss`, and the vulnerable
copy is the one Next bundles rather than the one Tailwind pulls. The full
reading — which copy, which CVEs, and why none of them can be reached by a
visitor — is under **Known advisories** above, kept in one place so the two
sections cannot drift apart again.

They already had. This one said three highs rooted in `sharp` below 0.35;
`sharp` is 0.35.4 and has not been in the advisory set for some time. Nothing
was done to fix it — a Next patch release carried it — which is the whole
argument for re-running `npm audit` on an update pass instead of repeating
what the file last said.
