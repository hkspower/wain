# What is not finished

Everything below is measured, not remembered — the suite states are from
a full run, and each entry says what is actually wrong, what it costs,
and what I would do about it. Ordered by what I would fix first.

Last checked against commit `108e21c`.

> **Item 2 is done.** The world is seeded now (`src/game/rand.ts`), which
> also fixed the `test:streets` flake — three consecutive runs, 339
> blocks, none in a street. It is left below with its reasoning intact,
> because the argument for doing it is the argument for not undoing it.

## The suite, right now

Twenty-one suites and five static checks pass. `npx tsc --noEmit` is
clean. Three things are not green:

| | state |
|---|---|
| `test:assets`, `test:race` | **failing**, same single cause: `public/models/driver.glb` is missing |
| `test:streets` | **fixed** — was intermittent, the world is seeded now |
| `test:levels` | passes, but takes over ten minutes |

---

## 1. `public/models/driver.glb` — two suites red on one missing file

`build.json` and both suites expect an authored driver model. The file is
gitignored, it is not in the repo, and it cannot be regenerated here:
`tools/blender/build_assets.py` needs Blender, which this container does
not have. So `/models/driver.glb` 404s on every page load, `test:race`
reports two runtime errors, and `test:assets` reports five parts of the
driver "still procedural".

Nothing is broken for a player. The procedural driver builds, poses and
solves — `test:ik` passes on it.

**What I would do:** drop the expectation and let the procedural driver
be the shipped one. A gitignored asset that two suites require is a
permanent red that trains everyone to ignore a red suite, which is worth
more than the asset. If the authored model is genuinely wanted, it
belongs committed (or in LFS), not gitignored.

**This is your call, not mine** — it is a question about what the game
ships with. It has been flagged several times and never decided.

## 2. The world is generated with `Math.random()` — four flakes and counting

`world.ts` builds the city from an unseeded PRNG, so every load is a
different world. Across this session that has broken four separate
checks that were each, at the time, indistinguishable from a real bug:

- `test:streets` — "1 building standing in the middle of a street",
  about one run in three. Confirmed pre-existing: it fails at the same
  rate on the commit before any of this session's work.
- three earlier checks, each of which cost a round of investigation.

**What I would do:** seed it. One PRNG seeded from a constant, threaded
through world generation. Every visual check becomes reproducible and
this entire class of flake disappears. Roughly an hour, and it makes
every future visual measurement trustworthy.

**Done**, in commit `fdb3778`. `tests/world.mjs` pins it: two loads, one
city, compared on the instance matrices rather than on screenshots.

## 3. "Full open world" is not what the world is

The track is a single closed Catmull-Rom loop, and `(s, lat)` — distance
along that one curve, plus lateral offset — is the entire spatial model.
The physics, the AI, the traffic, the minimap, the world builder and
every landmark position are written against it. There are no junctions,
because there is nothing to turn between.

What exists is free roam on a loop of two real roads, with racing gated
to its own hours. That is genuinely open in the sense that nothing
forces you into a race. It is not a road network.

**What I would do:** treat it as its own project rather than an
increment. It means replacing the spatial basis with a graph of edges
and nodes and rewriting everything that reads `s`. I would want to scope
it properly before starting, and I would not start it inside another
change.

## 4. The Second Ring Road's geometry is reconstructed, not surveyed

Overpass, OpenStreetMap and Wikipedia are all blocked by this
environment's egress policy, so no real coordinates could be fetched.
The centreline is built from the road's published route and proportions
— its two junctions with Gulf Road, its 1.52 arc-to-chord ratio, its
district sequence, its 80 km/h limit. The shape and the order are right.
The individual control points are not survey data.

**What I would do:** nothing, unless real coordinates matter to you. If
they do, it needs either egress to a map API or an exported file dropped
into the repo.

## 5. The referral system is server-enforced; the wallet is not

Invites are the hub server's business — one claim per save, no
self-referral, persisted across restarts, and the client cannot mint its
own reward. That part is real.

The wallet it pays into is `localStorage`, like all KD in this game, so
a player who wants more money has always been able to type it in. A
determined player can also clear storage to look like a new save and
claim again.

**What I would do:** leave it, and say so plainly rather than implying a
security property the game does not have. Tightening the referral past
the wallet it pays into would be securing the front door of a tent. If
KD ever needs to be authoritative, that is an accounts-and-server
question, not a referral question.

## 6. A hydration warning on every load with a saved car

`carName()` in `RaceClient.tsx` reads the saved garage during render
rather than in an effect, so the server renders the default car's name
and the client renders the saved one. React logs a hydration mismatch
and re-renders that subtree. Harmless in effect, but it is a real
console error for every returning player.

**What I would do:** fix it — it is small. The name should come from the
state that is already loaded in an effect.

## 7. `tools/shots/grid.mjs` renders at night whatever hour it is asked for

Documented in the file. The same three calls in the same order give
`capture.mjs` a correct noon. The cause was never established, so the
note in the file is a note and not a fix. It does not affect what the
tool is for — road markings are legible either way — but no lighting
conclusion should be read off it.

## 8. `test:levels` takes over ten minutes

It renders several hours at two positions at high quality, twice each.
It is not broken, it is slow, and it is slow enough that it gets skipped.

**What I would do:** default it to one hour and take the full sweep on
request.

## 9. A hub restart still empties every crew's roster

A crew is now a local identity: it is built in the garage, saved beside
the save, and worn on the car whether or not anything is listening on a
socket. Going online republishes it, so your own crew survives a hub
restart. What does not survive is everyone ELSE in it — the server keeps
`teams` in a `Map` and nothing else, so a restart drops the membership
and each member only reappears as they reconnect and re-found their own
crew, which the server then refuses as a duplicate name.

**What I would do:** persist teams the way referrals already are (an
atomic tmp-and-rename ledger, `LEDGER_PATH` in `server/hub-server.mjs`),
and let `team-create` re-adopt an existing crew whose founder matches
instead of dropping it on the floor.

## 10. Asked for earlier and never done

- **"improve ik for mods page"** — the garage's car preview. Asked for
  some time ago, never picked up.

---

## What I would do next, in order

1. ~~Seed the world~~ — done.
2. **Decide the driver model** (item 1). One decision turns two suites
   green permanently, and it is yours to make rather than mine.
3. **The hydration warning** (item 6), because it is twenty minutes.
4. Then either the mods-page preview (item 10) or scope the road network
   (item 3) — but the road network deserves its own run at it.
