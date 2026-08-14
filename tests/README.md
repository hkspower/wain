# Tests

Browser-driven tests that exercise the real game in headless Chromium —
no mocks, no stubs, reading live engine state.

```bash
npm run dev            # in one shell
npm run test:motion    # in another
```

## assets.mjs — the Blender build reaches the screen

Everything in `public/models` is optional by design: a missing file, a
renamed node or a swap that never fires all fall back to the procedural
build in silence. That is the right runtime behaviour and a terrible
testing story — every failure mode looks like success from the outside.

So this one asserts the authored geometry is *live*: the hero car's
Body/Canopy/Roof, all five parts of all four wheels (mirrored on the
left side), and the palm crowns shared across ~130 instances. It also
re-checks the envelopes the rest of the game is positioned against — a
0.36 m tire radius and 0.26 m section width — because a prettier tire
that is 5 mm larger would lift the car off its own shadow.

```bash
npm run test:assets
```

## physics.mjs — the tire model, measured

Launch, braking, cornering and crashing all draw on one grip budget now,
and this suite meters each of them with hand-stepped 1/60 s simulation:

- a full-throttle launch is **traction-limited** (~0-100 in 2.7 s stock,
  with measurable wheelspin) instead of the old 1.9 g teleport;
- braking is **grip-limited** — pads can out-torque a tire, the tire
  cannot out-grip the road — and lands in a plausible g band;
- the **friction circle** is real in both directions: full lock adds
  braking distance, hard braking blunts turn-in (understeer);
- **power-over** hangs the tail out with throttle alone, and the
  handbrake still out-angles it;
- **crash severity** follows the speed component into the wall: a
  glancing scrape and a steep plunge shed different speed, shake
  differently, and the steep one rebounds off the barrier.

It also parks the traffic before metering — a lesson, not a nicety: the
first run's readings were corrupted by a bumper, and untangling that
exposed a real collision-asymmetry bug where faster traffic slingshotted
the player to its own speed for free.

```bash
npm run test:physics
```

## fullrace.mjs — a complete race, played end to end

The integration test the others cannot be: boot a brand-new player,
drive a full 7.3 km lap of the Gulf Road under autopilot, hunt the rival
down, flash them with the real F key, accept the challenge card by
clicking the real button, survive the pre-race film, run the battle out,
and confirm the result is banked into the career and the garage.

Two techniques make a real-time game testable at speed:

1. A **virtual clock** replaces `performance.now()` before any page
   script runs and is advanced in lockstep with the simulation. Lap
   timing, the three-second flash window and the cinematic all read that
   clock, so they behave exactly as they would in real time — just
   faster. Without it a stepped lap records a nonsense time.
2. The sim is **stepped by hand** at a fixed 1/60 s, so a lap is
   deterministic instead of hostage to headless frame pacing (which
   throttles to a couple of hertz with no compositor).

Input still travels the real paths: the autopilot steers through
`setTouchInput` (the touch/gamepad API) and the challenge is triggered
by genuine keyboard events and a real button click.

Winning is *not* asserted — the autopilot is a lane-holder, not a
racing driver, and the rival rubber-bands, so either outcome is a pass.
What must hold is that the lap completes and records a plausible time,
the challenge becomes a battle, the battle resolves, the result is paid
out, the renderer still draws a populated scene, and the console stays
free of errors.

```bash
npm run test:race
```

## fonts.mjs — the Arabic actually is the Arabic

Arabic fails quietly. A font that never loads, a variable that resolves
to nothing, a stack that was tree-shaken out of the stylesheet — all of
them fall back to something that still *draws*, so the page looks fine
to anyone not reading it. Worse, the usual fallback has no Arabic
coverage, so the shaper resolves letters individually and the word comes
out unjoined: legible-ish, and wrong.

So this asserts the type is real rather than plausible:

- all three stacks (`--font-arabic`, `--font-arabic-display`,
  `--font-arabic-sign`) resolve to a named family, and those families
  report as loaded;
- canvas text measures **differently from a generic fallback** — the
  only way to know the in-world signage is really drawing in the
  webfont rather than silently substituting;
- `.grn-ar` cancels what the Latin styles impose: no letter-spacing
  (it prises cursive letters apart), no uppercase transform, no
  synthesised italic, and `direction: rtl`.

```bash
npm run test:fonts
```

## mods.mjs — every part changes the car

A mod that only appears in a shop list is a lie told to the player. Each
new part is fitted here and metered against the same car without it,
stepping the sim by hand:

| Part | What it must do |
| --- | --- |
| Limited-slip diff | less wheelspin off the line, quicker 0-100 |
| Coilovers | turn-in survives heavy braking |
| Quick steering rack | the wheel answers faster |
| Roll cage | contact costs less speed |
| Drift tires | bigger angle than slicks, the grip peak |
| Close-ratio box | quicker roll-on than the tall one |
| Tall final drive | higher terminal speed than the close one |

Writing it surfaced two things about the tire model worth knowing.
Below roughly 176 km/h a stock car is **traction-limited**, so engine
and gearing mods do nothing there until you also buy tires — the first
version of the gearbox test measured a launch and found both boxes
identical, correctly. And `topSpeedBonus` is added to a ceiling in m/s,
not km/h, so the original ±8/18 was a far bigger swing than the copy
implied and made the *tall* box out-accelerate the close one everywhere.

```bash
npm run test:mods
```

## topspeed.mjs — fourteen cars, fourteen governors

Every car is limited at its own number, 180 km/h for the starter through
400 for the flagship, and the number has to be *true*: the engine solves
each car's thrust curve so drag meets thrust exactly at its limiter,
then a hard governor cuts fuel there. So this drives all fourteen flat
out on a pinned-straight road and checks each settles within 2 km/h of
what its card claims — a limiter the car cannot reach would be a lie
printed on a spec sheet.

It also holds NOS and a full twin-turbo build against the governor: a
modded starter climbs to exactly its raised limit and no further.

```bash
npm run test:topspeed
```

## vfx.mjs — the effects are effects, not decoration

Particles are the easiest thing in a game to "improve" without changing
a pixel, so nothing here trusts that a pool exists. Each effect is
provoked and then measured:

- **smoke** — every puff must have its own age and size (the old
  `PointsMaterial` pool shared one clock and one opacity across all 110,
  which is why a drift read as a flickering sheet), and it must spread
  and rise;
- **sparks** — thrown from the flank that actually touched the barrier,
  not the car's centre, and they must *bounce* off the asphalt rather
  than sinking through it;
- **brake rotors** — cold before braking, glowing after a hard stop,
  and cool again down the following straight;
- **exhaust** — a backfire on the throttle's falling edge at speed.

That last one started life as a 75%-chance effect, which made the test
flaky by construction. A hard lift at revs now always pops; the
randomness moved into how big the flame is, which is where it belonged.

```bash
npm run test:vfx
```

## audio.mjs — the sound is doing something

Audio is the easiest system to "add" without adding anything: a node
that exists but never gains, a panner that never moves, a mood that
never changes. Nothing here is taken on trust — every layer is fed the
condition that should raise it and read back off live WebAudio state.

- **tire roll** and **wind** rise with speed; the kerb rumble only buzzes
  when the car is actually running wide;
- **ambience** cross-fades — surf louder on the corniche, city hum louder
  inland — and the surf sits at the sea's coordinates, not in the middle
  of your head;
- the **rival's engine** is a positioned source at their car's position,
  and goes quiet when there is no rival;
- the **listener** rides the camera;
- the **rev limiter** stutters the engine gain against the governor;
- a **graze and a full crash** voice differently;
- **music intensity** opens the filter as a battle turns desperate.

```bash
npm run test:audio
```

## daynight.mjs — the day actually turns

A day/night cycle is easy to fake with a variable nothing reads, so
every hour sampled here is checked against the world it should be
changing: the sky gradient's top colour, the key light's strength, star
opacity, the streetlights' pools, the headlight beams. Then cycle mode
is left running for forty seconds of play to confirm the clock advances
at the rate the 16-minute day implies.

Daylight surfaced something that had been invisible for the whole
project: the road paint, kerbs, sign faces and city windows are all
emissive, because the game was authored at night and they had to be
readable in the dark. At noon they blazed like neon. They are now
registered by a single rule at build time — a faint emissive is night
dressing the sun will light for real, a bright one is an actual lamp —
and dimmed with the photocell. The line sits above lit windows and
below street lamps, tunnel strips, floodlights and the aircraft
beacons, which stay on in daylight because they do in life.

```bash
npm run test:daynight
GRN_STILLS=1 npm run test:daynight   # also writes /tmp/smoke/tod-*.png
```

## framepacing.mjs — dynamic fps, v-sync, G-Sync

Panel-refresh detection, the frame limiter, the G-Sync-style
under-refresh cap, and the governors that key off them.

**Browsers lock rendering to v-sync and expose no way to switch it off,
and no web API reports or controls G-Sync/VRR.** So the web build's only
real lever is how often it accepts a frame — which it now does against a
*measured* panel rate rather than an assumed 60 Hz. The UE5 and Unity
ports drive v-sync and the cap directly, where the platform allows it.

The test asserts the pacing **logic** always — target resolution, frame
budgets, governor scaling — and only asserts achieved **throughput**
when the browser can actually deliver it. Headless Chromium throttles
requestAnimationFrame to about 1.4 Hz with no compositor, so measuring
frame rates against a cap there would be theatre.

## motion.mjs — game feel

Covers the two things that make a racing game feel like one, and that
nothing else in the pipeline checks:

**Motion** — FOV launch kick and speed stretch, camera speed rumble,
weight transfer under brake and throttle, body roll, camera roll under
lateral G, drift body yaw, and impact shake with its decay.

**Feedback** — brake lamps, speed streaks, haptics, and whether the
reduced-motion setting genuinely suppresses the pre-battle film rather
than merely claiming to.

### Two things this test does deliberately

**It steps the simulation by hand** at a fixed 1/60 s (`setPaused(true)`
then `update(1/60)`) rather than holding inputs across real frames.
Wall-clock holds were flaky for reasons that had nothing to do with the
code under test: frame timing varies, the car travels into different
track curvature mid-hold, and the lerped values — FOV, pitch, camera
roll — converge by a different amount every run. The same technique
keeps the drift physics test reproducible.

**It asserts mechanisms, not magnitudes,** where a magnitude would be
meaningless. Body roll is `heading * 0.06`, and heading is measured
against the *track*, so steering into an existing bend legitimately
builds almost none — the test checks that roll tracks heading exactly
(to 1e-4) instead of demanding a lean the formula cannot produce. Camera
roll is checked for responding and leaning *into* the turn, since at a
modest heading it is inherently a fraction of a degree.

An earlier version of this test reported four failures that were all
artifacts of sampling at instants rather than per frame. Brake lights,
for one, go 2 to 7 in a single frame and were being read on the wrong
side of it.
