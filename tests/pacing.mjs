// The pacing filter, driven with synthetic jitter.
//
//   npm run test:pacing:delta      (no browser, no dev server)
//
// tests/framepacing.mjs checks the limiter and the governors in a real
// browser, and cannot check this: headless Chromium serves about 1.4
// frames a second, so there is no jitter to remove and no grid to snap
// to. The filter is pure arithmetic, so it is tested as arithmetic —
// fed the delta sequences a real display produces and asked what it
// does with them.
//
// The two properties that matter pull against each other, which is why
// both are asserted:
//
//   IT MUST SMOOTH   A pinned 60 Hz panel whose timestamps wobble by a
//                    millisecond must come out as a constant.
//   IT MUST NOT LIE  Over any run, the total time handed to the
//                    simulation must equal the total time that really
//                    passed. A smoother that drifts makes the whole game
//                    run fast or slow, which is a far worse bug than the
//                    shimmer it was written to fix.

import {
  paceDelta, newPaceState, MAX_DT, SNAP_MS, refreshFromIntervals, REFRESH_PERCENTILE,
} from "../src/game/pacing.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

/** A deterministic wobble, so a failure is reproducible. */
function lcg(seed) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// --- 1. A pinned panel comes out pinned ------------------------------
for (const hz of [60, 120, 144]) {
  const period = 1 / hz;
  const rnd = lcg(7);
  const st = newPaceState();
  const out = [];
  let realTotal = 0;
  for (let i = 0; i < 600; i++) {
    // +/- 0.8 ms of scheduler noise, which is what rAF actually does.
    const raw = period + (rnd() - 0.5) * 0.0016;
    realTotal += raw;
    out.push(paceDelta(st, raw, hz));
  }
  const spread = Math.max(...out) - Math.min(...out);
  const paced = out.reduce((a, b) => a + b, 0);
  const drift = (paced - realTotal) / realTotal;
  console.log(
    `${String(hz).padStart(3)} Hz jittered  output spread ${(spread * 1000).toFixed(4)} ms, ` +
    `drift ${(drift * 100).toFixed(3)}% over 600 frames`
  );
  check(spread < 1e-9, `${hz} Hz: the output still wobbles by ${(spread * 1000).toFixed(3)} ms`);
  // Snapping is rounding to the nearest grid point, so the error per
  // frame is the noise and it cancels. A tenth of a percent over ten
  // seconds is inaudible and invisible; a percent is not.
  check(Math.abs(drift) < 0.001, `${hz} Hz: the paced clock drifts ${(drift * 100).toFixed(3)}%`);
}

// --- 2. A dropped frame is a dropped frame, not a smear --------------
//
// If the panel misses one, the true delta is exactly two periods. The
// filter must report two periods — not one, which would slow the world
// down, and not a median that hides it.
{
  const hz = 60, period = 1 / hz;
  const st = newPaceState();
  for (let i = 0; i < 10; i++) paceDelta(st, period, hz);
  const doubled = paceDelta(st, period * 2 + 0.0003, hz);
  console.log(
    `\ndropped frame  ${(period * 2 * 1000).toFixed(3)} ms expected, ` +
    `${(doubled * 1000).toFixed(3)} ms reported`
  );
  check(
    Math.abs(doubled - period * 2) < 1e-9,
    `a missed frame came back as ${(doubled * 1000).toFixed(2)} ms rather than two periods`
  );
}

// --- 3. One hitch does not propagate ---------------------------------
//
// A shader compile or a GC pause is a single long frame. The frames
// after it are normal, and must be reported as normal — a mean would
// carry the spike forward for as long as its window.
{
  const hz = 60, period = 1 / hz;
  const st = newPaceState();
  for (let i = 0; i < 10; i++) paceDelta(st, period, hz);
  const spike = paceDelta(st, 0.04, hz);       // 40 ms stall, off the grid
  const after = [];
  for (let i = 0; i < 3; i++) after.push(paceDelta(st, period, hz));
  console.log(
    `hitch          40 ms spike reported as ${(spike * 1000).toFixed(1)} ms, ` +
    `next three ${after.map((v) => (v * 1000).toFixed(2)).join(", ")} ms`
  );
  // The stall is reported as itself. An earlier version took the median
  // here and returned 16.7 ms, which does not remove the hitch — the
  // frame was still late and the picture still jumped — it just makes
  // the world advance 23 ms less than the wall clock did, every time the
  // machine struggles.
  check(
    Math.abs(spike - 0.04) < 1e-9,
    `a genuine 40 ms stall was reported as ${(spike * 1000).toFixed(1)} ms — the world loses that time`
  );
  check(
    after.every((v) => Math.abs(v - period) < 1e-9),
    `the frames after a hitch came back as ${after.map((v) => (v * 1000).toFixed(2)).join(", ")} ms`
  );
}

// --- 4. A real rate change is followed, not resisted ------------------
{
  const st = newPaceState();
  for (let i = 0; i < 10; i++) paceDelta(st, 1 / 60, 60);
  // The machine genuinely halves: every frame is now 1/30.
  const settle = [];
  for (let i = 0; i < 6; i++) settle.push(paceDelta(st, 1 / 30, 60));
  console.log(
    `rate change    60 -> 30 fps settles to ${(settle[settle.length - 1] * 1000).toFixed(2)} ms`
  );
  check(
    Math.abs(settle[settle.length - 1] - 1 / 30) < 1e-9,
    "a genuine drop to 30 fps is not followed"
  );
}

// --- 5. An unknown refresh rate still gets smoothed ------------------
//
// Variable-refresh panels and the moments before the detector has
// resolved. No grid to snap to, so the median has to carry it — and the
// total still has to come out right.
{
  const rnd = lcg(19);
  const st = newPaceState();
  let real = 0, paced = 0;
  const out = [];
  const rawSeq = [];
  for (let i = 0; i < 600; i++) {
    const raw = 1 / 90 + (rnd() - 0.5) * 0.002;
    rawSeq.push(raw);
    real += raw;
    const v = paceDelta(st, raw, 0);
    paced += v;
    out.push(v);
  }
  // Standard deviation, not spread. A median reduces VARIANCE; it does
  // not bound the range, and over six hundred samples an extreme median
  // still turns up now and then. Measuring the range and calling it
  // smoothing was the wrong statistic for the filter being tested — the
  // first version of this check failed the implementation for it.
  const sd = (xs) => {
    const mu = xs.reduce((a2, b2) => a2 + b2, 0) / xs.length;
    return Math.sqrt(xs.reduce((a2, b2) => a2 + (b2 - mu) ** 2, 0) / xs.length);
  };
  const outSd = sd(out);
  const inSd = sd(rawSeq);
  console.log(
    `\nno known rate  jitter sd ${(inSd * 1000).toFixed(4)} ms in, ${(outSd * 1000).toFixed(4)} ms out, ` +
    `drift ${(((paced - real) / real) * 100).toFixed(3)}%`
  );
  check(outSd < inSd * 0.75, `the median barely reduced the jitter (${(inSd * 1000).toFixed(3)} -> ${(outSd * 1000).toFixed(3)} ms)`);
  check(Math.abs((paced - real) / real) < 0.01, "the median-only path drifts");
}

// --- 6. The hard limits hold -----------------------------------------
{
  const st = newPaceState();
  const huge = paceDelta(st, 63, 60);          // a tab hidden for a minute
  const negative = paceDelta(newPaceState(), -1, 60);
  console.log(
    `\nclamps         a 63 s frame reports ${huge.toFixed(3)} s, a negative one reports ${negative.toFixed(3)} s`
  );
  check(huge <= MAX_DT + 1e-9, `a 63 second frame came through as ${huge}`);
  check(negative >= 0, `a negative delta came through as ${negative}`);
  check(SNAP_MS > 0 && SNAP_MS < 4, "the snap tolerance is not a plausible amount of scheduler noise");
}

// --- What the panel can do, on a panel that varies -------------------
//
// The refresh probe used to take the MEDIAN of the first forty frame
// intervals and latch it for the session. On a fixed-refresh panel that
// is correct — rAF fires on the panel's grid whatever the game manages.
//
// On G-Sync or FreeSync it is a feedback loop reading its own output:
// the panel presents when the frame is ready, so the measured "refresh"
// is the frame rate. And it is measured during the slowest two seconds
// of any session. A 144 Hz panel that struggles through startup got
// read as 48 Hz, capped at 45 for the rest of the night, and had the
// resolution governor raise resolution until the frame rate fell to
// meet it.
//
// The game can never present faster than the panel refreshes, so the
// FAST intervals are the hardware showing its hand and the slow ones are
// only the load. That is the whole of the fix, and it is arithmetic, so
// it is tested as arithmetic.
{
  const jitter = (ms, n, spread = 0.4) =>
    Array.from({ length: n }, () => ms + (Math.random() * 2 - 1) * spread);

  // A steady 60 Hz panel reads as 60.
  const steady = refreshFromIntervals(jitter(16.667, 120));
  console.log(`\nrefresh      a steady 60 Hz panel reads ${steady} Hz`);
  if (steady !== 60) fail.push(`a steady 60 Hz panel measured ${steady} Hz`);

  // A 144 Hz VRR panel running a game that mostly manages 50 fps, with
  // the occasional easy stretch at the panel's own rate. The median of
  // this is about 20 ms — 50 Hz — and that is what used to be latched.
  const vrr = [...jitter(20, 100), ...jitter(6.94, 20)];
  const sorted = [...vrr].sort((a, b) => a - b);
  const median = 1000 / sorted[sorted.length >> 1];
  const seen = refreshFromIntervals(vrr);
  console.log(
    `             a 144 Hz VRR panel under load: median says ${median.toFixed(0)} Hz, ` +
      `the ${(REFRESH_PERCENTILE * 100).toFixed(0)}th percentile says ${seen} Hz`
  );
  if (seen !== 144) fail.push(`a 144 Hz VRR panel under load measured ${seen} Hz`);
  if (median > 70) fail.push("the VRR fixture is not actually loaded — the median should be slow");

  // One anomalously short gap must not report a 500 Hz panel. This is why
  // it is a percentile and not the minimum.
  const spike = [...jitter(16.667, 120), 2.1];
  const withSpike = refreshFromIntervals(spike);
  console.log(`             one 2 ms coalesced callback among 120 good frames: ${withSpike} Hz`);
  if (withSpike !== 60) fail.push(`a single short gap moved the reading to ${withSpike} Hz`);

  // Too little to say is 0, not a guess.
  console.log(`             three samples read ${refreshFromIntervals([16.7, 16.6, 16.8])} Hz`);
  if (refreshFromIntervals([16.7, 16.6, 16.8]) !== 0) {
    fail.push("three samples were enough to claim a refresh rate");
  }
}

console.log(
  fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe clock is smooth and it does not lie"
);
process.exit(fail.length ? 1 : 0);
