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
