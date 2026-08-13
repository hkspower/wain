# Tests

Browser-driven tests that exercise the real game in headless Chromium —
no mocks, no stubs, reading live engine state.

```bash
npm run dev            # in one shell
npm run test:motion    # in another
```

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
