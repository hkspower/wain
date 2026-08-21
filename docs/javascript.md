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
