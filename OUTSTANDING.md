# What is not finished

Everything below is measured, not remembered — the suite states are from
a full run, and each entry says what is actually wrong, what it costs,
and what I would do about it. Ordered by what I would fix first.

Last full run was against commit `a174850`. Everything under
"Since the last full run" below was measured against `ac87a6d` — a
PARTIAL re-check, and it says which scripts it actually ran, because a
file that claims a full run it did not do is worse than one that admits
to a partial.

> **Nine of the eleven items this file used to list are done.** They are
> kept below, struck through, with their reasoning intact: the argument
> for doing a thing is usually also the argument for not undoing it, and
> the two that are left are the two that were always going to need their
> own run at them.

## Since the last full run

The roster is **seventeen cars over eight silhouettes** — it was fifteen
over six when the numbers further down this file were taken, so read any
count below as of that date.

Re-checked at `ac87a6d`, and green: `npx tsc --noEmit`, `check:unity`,
`check:unreal` (both at 17 cars and 8 silhouettes), `check:structure`,
`check:arabic`, `check:arabic:grammar`, `test:carsedit`, `test:names`,
`test:demon` and `test:faces`. Not re-run: the rest.

Two new scripts:

- **`npm run check:sounds`** fires every sound the engine can make and
  measures it at the OUTPUT — after the limiter and the ceiling — rather
  than reading gain nodes, because a voice whose gain is 0.8 and whose
  oscillator was never started looks identical from the node graph and
  different from one metre away. **All thirty-six are audible**: sixteen
  one-shots, fourteen held voices and six sampled effects on disk.
- **`npm run test:faces`** checks that all seventeen cars state their own
  front face and that no two are identical. `--records` runs the
  arithmetic half without a browser.


### The traction system was inert, and two features on top of it were unreachable

Found while adding the differential ladder, by measuring rather than
reading. The longitudinal traction cap used the car's whole grip figure
with no account of **which** wheels drive or how much of the car sits on
them. Measured over a full-throttle run through the gears, with boost,
on all seventeen cars:

| build | peak thrust ÷ traction cap | cars that broke traction |
| --- | --- | --- |
| standard | 0.47 – 0.96 | **0 of 17** |
| engine bought | 0.63 – 1.24 | 6 of 17, for 0.3–1.8 s |
| fully built | 0.47 – 0.96 | **0 of 17** |

The third row is the sharp one: tyres and coilovers raise the cap by
more than the engine raises thrust, so the *endgame* car was the one
car that could not light a tyre up, and a player chasing power watched
their wheelspin vanish as they got faster.

`wheelspin` was therefore zero almost always, and both features written
on top of it were unreachable code: the power-over drift entry in
`drift.ts` (needs `wheelspin > H.powerOverSpin`) and the burnout in
`engine.ts` (needs `> 3`). So was every traction part in the shop —
raising a cap nothing reaches buys nothing, which is why the 1300 KD
Limited-Slip Diff did nothing measurable on fifteen of the seventeen.

`DRIVE_SHARE` in `grip.ts` is the missing term (awd 0.92, rwd 0.72, fwd
0.62). No card in the showroom moved by more than 0.004 s — the launch
solver simply asks for more thrust and the car spends the excess as
smoke on its way to the same 100 km/h. `npm run test:traction` is the
guard, and it is red against the old numbers.

### Power-over drift works now, and my arithmetic said it could not

Worth keeping as a caution about probes. `DRIVE_SHARE` woke wheelspin up
at the launch, which is what made the diff ladder worth buying. I then
predicted, from a node probe, that it could NOT wake power-over: at
24 m/s the probe had every car's thrust well under its traction cap —
Sahara V12 7.6 against 13.5, Black Demon 9.6 against 21.3 — and I was
ready to write the feature off as structurally unreachable and move on.

Driven in the actual engine it produces **3.42 m/s² of wheelspin and
0.18 rad of yaw**, and the check passes.

The probe was wrong about the GEAR. It derived one by walking
`upshiftAt` from the speed; the engine holds `gearHeld` and only changes
up on crossing a point from the gear it is in, so a car placed at 24 m/s
from a standing stage is still in first, deep into the launch torque
blend, with far more thrust than the probe allowed. A pure-arithmetic
model of a stateful system is right only where the state agrees with it.

**Left thin on purpose.** With the split in place `test:physics` is
green end to end, but power-over passes at **0.101 rad against a bar of
0.1** — one per cent of margin, which is a red waiting to happen. The
tyres are not the marginal part (wheelspin 3.41 against a gate of 1.2);
what is thin is how much angle the drift solver makes of that at 24 m/s.
Buying margin by retuning the solver would be changing the game to make
a test comfortable, so the threshold is printed beside the reading and
left alone. If it starts flaking, the fix is the ratio-based gate
described above, not a looser bar.

### Three tests were reporting failures that were their own

Worth recording as a pattern, since it is now the third time this
session:

- **`test:drivetrain`** reported that *all seventeen cars fail to say
  which wheels they drive*, that the showroom sold only one layout, and
  that the GTR was not all-wheel drive. All three were false and all
  three had one cause: the roster was read with a regex requiring
  `drive:` on the line **immediately** after `id:`, and cars had since
  gained `zeroTo100s` and `face` in between. Every car had always been
  right. Now parsed as per-car blocks.
- **`test:accel`**'s solver check hand-builds a `LaunchCar` literal. When
  `LaunchCar` gained `driveShare`, the absent field became `undefined`,
  `undefined` in the traction cap became `NaN`, every comparison in the
  bisection then went the same way, and it reported a tidy
  "Infinity% off" as though the arithmetic were at fault. It now names a
  non-finite time as its own kind of failure.
- **`test:physics`** cleared `localStorage` and then measured whatever
  car a fresh save holds — the Wain Special, the free hatchback, 11.5 s
  to 100 — while three of its checks describe a car launching hard
  (0-100 inside six seconds, wheelspin off the line, the tail coming
  round on throttle alone). Those passed only because acceleration used
  to be broken in a way that flattered everything: thrust came out at
  `19 * power`, the traction cap always bound, and the free car posted
  2.9 s while smoking its tyres. `accel.ts` made acceleration a solved
  number, the free car went back to being a free car, and these checks
  have been measuring the wrong subject since. Each section now names the
  car its claim is about: the launch and power-over checks stage a
  rear-drive V12, everything else keeps the hatchback, because braking
  distance, handbrake angle, lock-up and disc temperature were all
  calibrated against it — staging the V12 for the whole file fixed three
  checks and quietly restated four others.
- The measurement probes for this work had the same `LaunchCar` hole and
  reported peak thrust ratios of 34–113× before it was caught.

A pattern worth naming: **six** of the failures investigated this
session were in the measuring apparatus, not the game — and one more (the
power-over prediction above) would have been a wrong conclusion drawn
from a correct-looking probe. The instrument is wrong before the product
is, more often than not.

## The suite, right now

Fifty-seven scripts: forty-odd behavioural suites, the static checks,
the three port-sync checks and the audit tools. `npx tsc --noEmit` is
clean. **Fifty-five pass.**

| | state |
|---|---|
| `test:parity` | 16 000 steps of UE5 against TypeScript, worst disagreement 5e-12, all twelve solver branches covered |
| `check:unreal`, `check:unity` | the ports agree with the live API |
| `check:gutters` | 0 problems across six window sizes and four screens — see the timeout note below |
| `check:fleet` | fifteen cars, no part class missing from one of them |
| `audio:check` | **red for an environment reason** — see below |

`audio:check` is the one red that is not a code failure. Generating the
voices and SFX needs `api.elevenlabs.io`, which this environment's
egress policy does not allow. It clears by allowlisting that host, or by
running the generators somewhere with direct internet and committing
`public/sfx/`, `public/voices/` and `public/music/`.

Four suites have failed on a full run at some point and **every one of
them turned out to be the test rather than the game.** That is worth
keeping written down, because it is the same failure four times: an
assertion that encoded an assumption instead of measuring the thing.

- **`test:grade`** asserted that a stop down darkens a NOON frame. It
  does not — the black-point rescale gives the exposure back and then
  stretches it, measured as the bright fraction going from 0.098 to
  0.27. The assertion was riding on a 1–3% drop that the toe was
  already cancelling, so a loaded box tipped it. The downward half is
  measured at night now, pixel against matching pixel, where it moves
  6,373 pixels down and 1,414 up.
- **`test:race`** clicked SEND CHALLENGE with an eight-second budget and
  `.catch(() => {})`. On a box rendering 1.5 M triangles in software the
  click ran out of budget in its hit-target check, the failure was
  discarded, and the suite reported "the challenge never became a
  battle" forty seconds later — a symptom two steps downstream of a
  cause it had thrown away. The click is checked now, and given sixty
  seconds.
- **`test:motion`** asserted the wheels turn at `v / 0.36`, where 0.36
  is `TIRE_RADIUS` as authored in `cars.ts`. Every car is scaled to its
  real length in metres and its wheels scale with it, so 0.36 is the
  radius of a car nobody drives — the current one is 0.318. It reads
  the radius off the car now, and checks separately that the radius is
  a real road tyre, because reading it off the car is otherwise
  self-fulfilling.
- **`test:roadname`** is the exception that proves the point: it caught
  a real bug, and only because it reads the plate's rows out of the DOM
  instead of asking the engine what road it thinks you are on. The rev
  counter rework had taken the road-name writer out with it. The markup
  was still there and still empty, so nothing looked broken — the road
  the game is named after had simply stopped being named, and the
  engine knew the right answer the whole time.

One thing to know before running it: **`check:gutters` takes well over
fifteen minutes** on a software renderer, most of it in the race HUD,
which has to load the game and wait out the cinematic at every window
size. A fifteen-minute timeout kills it partway through the ultrawide
shapes and looks exactly like a hang.

---

## 1. ~~`public/models/driver.glb` — two suites red on one missing file~~

**Done**, in `aa24a1d`.

The file was gitignored, absent, and unbuildable in this container, so
two suites were permanently red over something nobody could produce.
That is the worst kind of red: it cannot be cleared by fixing the code,
so it teaches everyone to skim past a failing suite.

`build.json` records what the Blender build shipped, which makes it the
manifest — so `models.ts` reads it as one and never requests a file that
is not in it, and `tests/assets.mjs` asserts *authored* for what the
manifest names and *present* for what it does not. Ship a driver and
both flip back on their own. `driver.glb` is whitelisted in
`public/models/.gitignore` now, because an asset the game expects has to
be in the repo or it is not an asset the game has.

## 2. ~~The world is generated with `Math.random()`~~

**Done**, in `fdb3778`. One seeded PRNG threaded through world
generation. `tests/world.mjs` pins it: two loads, one city, compared on
the instance matrices rather than on screenshots.

## 3. "Full open world" is not what the world is

**Still open, and still its own project.**

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

**Still open, and blocked on something outside the repo.**

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

**Open by decision, not by omission.**

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

## 6. ~~A hydration warning on every load with a saved car~~

**Done**, in `aa24a1d`.

`carName()` read the saved garage during render, so the server rendered
the default and the browser rendered the save on its very first pass.
It now takes the name from the state that is loaded in an effect, and
shows nothing until that arrives — which is exactly what the server
said.

The reason this survived so long is worth keeping: it only happens to
people who have PLAYED. Every check anyone ran began by clearing local
storage, and on a clear save the two sides agree. `tests/hydration.mjs`
plants a save first, and fails on the old code.

## 7. `tools/shots/grid.mjs` renders at night whatever hour it is asked for

**Still open.** Documented in the file. The same three calls in the same
order give `capture.mjs` a correct noon. The cause was never
established, so the note in the file is a note and not a fix. It does
not affect what the tool is for — road markings are legible either way —
but no lighting conclusion should be read off it.

## 8. ~~`test:levels` takes over ten minutes~~

**Done**, in `aa24a1d`. It measures the hour the game is played (night)
by default, which is two renders instead of eight; `--sweep`, or
`npm run test:levels:all`, still takes dawn, noon and dusk. Ten minutes
was long enough that it got skipped, and a check nobody runs protects
nothing.

## 9. ~~A hub restart still empties every crew's roster~~

**Done**, in `aa24a1d`. Crews go in the ledger beside the referrals —
names only, because a player id is per-connection and writing one down
would persist a lie about who is online. `team-create` re-adopts the
crew you are already in instead of answering an existing member with
silence, and refuses a name that is somebody else's rather than quietly
founding a twin. That last part matters more than it did: a twin used to
last until the next restart, and now it would last forever.

`tests/crews.mjs` starts a real hub, founds a crew, kills the process,
starts it again on the same ledger and asks whether the crew is there.

## 10. ~~The menu intro is a loop, not a place~~

**Done**, in `aa24a1d`.

It is still a loop — the cars stand still and the world scrolls past,
which is what keeps it at a fraction of a frame — but it is the corniche
now. The Gulf on the seaward side with the moon broken across it, the
city painted on a backdrop hung past the fog (Kuwait Towers, the
Liberation Tower, the Sharq waterfront), palms down the promenade, and
traffic coming the other way at twice the closing speed. Every period in
it still divides the twelve seconds, so there is still no seam.

The backdrop is painted rather than built for a reason: the menu's road
is 300 m of strip and the fog closes it at 186, so a skyline a mile out
would be either inside the fog or outside the far plane. Everything on
it is sized by the angle it subtends from where the camera actually
stands, which is the only way to keep a backdrop from reading as a
cutout twenty metres up the road.

## 11. ~~Asked for earlier and never done: "improve ik for mods page"~~

**Done**, in `aa24a1d`.

The cause turned out to be structural rather than a missing feature.
`solveDriverRig` was a private method on the race engine, so the only
cars in the game with hands on the wheel were the ones with an engine
running — the menu and the showroom seated a fully rigged driver and
never asked it for a pose. It is `src/game/driver.ts` now, a free
function that needs nothing but the rig and the numbers, and the menu
solves both of its drivers every frame with the lane wander as the
steering input.

---

## 12. ~~`check:sounds` has never finished its second half~~

**Done.** It completes, and everything in it is audible: sixteen
one-shots 0.19 to 0.75 over the idle floor, fourteen held voices 0.25
to 0.87 peak, and all six sampled effects on disk. Thirty-six sounds,
none silent.

Three causes, and the first two were wrong guesses that cost two
rewrites. It polled the analyser on `requestAnimationFrame`, so it
waited for the renderer — moved to a timer, barely helped. It made one
`page.evaluate` per sound, each queueing behind frame work — moved to a
single call into the page, barely helped.

What it actually was: the tool ran the game at 900 x 520 on a software
renderer, and every frame cost the main thread hundreds of milliseconds.
The analyser loop shares that thread. **Nothing in this tool looks at a
picture**, so the window is now 80 x 60 and the whole sweep finishes in
under a minute.

Worth keeping written down because it is the same mistake twice over:
two rounds of optimising the measurement when the measurement was never
the slow part.

## 13. Four of the fleet's eight silhouettes have no authored shell

The hatch and the pony are built procedurally, and the pickup and the
mid-engined `super` added since join them — `sync:models` exports four
styles, not eight. The
car asset manager reports this as a gap on every affected car, which is
right: it is a real state the game ships in rather than damage. Worth
knowing before reading the manager's warnings as faults.

## What I would do next, in order

1. **Scope the road network** (item 3). It is the only thing left that
   changes what the game IS rather than how well it does what it does,
   and it deserves a run at it on its own.
2. **`grid.mjs`'s hour** (item 7), if anyone wants a lighting
   measurement out of that tool. Small, and currently a footnote.
3. Nothing else is outstanding. Items 4, 5 and 13 are open by decision:
   one needs egress this environment does not have, and the other is
   a claim I would rather not make than half-make.
