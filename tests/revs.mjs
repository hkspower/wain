// The revs spin up and down; they do not step. Checked without a browser.
//
//   npm run test:revs
//
// WHAT WAS WRONG, measured on the real engine before this change (a
// browser capture, not a transcription): pressing the throttle at a
// standstill took the needle from 0.12 to 0.88 of the dial between two
// frames, and releasing it put it back in one — 0.76 of the dial per
// frame at 30, 60 and 144 Hz alike, because the clutch hold read the raw
// key. The engine note and the high-rev shake read the same number.
//
// The browser half (tests/tach.mjs) checks that the dial and the note
// are driven through this law; this checks the law.
import { readFileSync } from "node:fs";
import { newSpin, stepSpin, SPIN_UP, SPIN_DOWN, newJolt, stepJolt, REV_SLEW, JOLT_SETTLE } from "../src/game/revs.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok  " : "FAIL"; };

// A keyboard blip: 0.5 s on, 0.5 s off, sampled at whole-frame times.
const blip = (hz) => {
  const s = newSpin();
  const out = [];
  let worst = 0, prev = 0;
  for (let i = 1; i <= hz; i++) {
    stepSpin(s, i <= hz / 2 ? 1 : 0, 1 / hz);
    worst = Math.max(worst, Math.abs(s.x - prev));
    prev = s.x;
    out.push(s.x);
  }
  return { out, worst };
};
const at = (b, hz, t) => b.out[Math.round(t * hz) - 1];
const r30 = blip(30), r60 = blip(60), r150 = blip(150);

// 1. The same blip at every frame rate.
let spread = 0;
for (const t of [0.1, 0.2, 0.3, 0.5, 0.6, 0.8, 1.0]) {
  const v = [at(r30, 30, t), at(r60, 60, t), at(r150, 150, t)];
  spread = Math.max(spread, Math.max(...v) - Math.min(...v));
}
console.log(`${check(spread < 1e-9, `the blip differs by ${spread} between 30 and 150 Hz`)} frame rate   a blip lands the same at 30 / 60 / 150 Hz (spread ${spread.toExponential(1)})`);

// 2. It moves: a tenth of a second of throttle is a real part of the way,
//    and it gets there.
const tenth = at(r60, 60, 0.1), half = at(r60, 60, 0.5), gone = at(r60, 60, 1.0);
console.log(`${check(tenth > 0.3 && tenth < 0.7, `0.1 s of throttle spun the hold to ${tenth.toFixed(3)}`)} spin-up      ${tenth.toFixed(3)} of the hold after 0.1 s, ${half.toFixed(3)} after 0.5 s`);
check(half > 0.98, `after half a second of throttle the hold is only ${half.toFixed(3)}`);
console.log(`${check(gone < 0.08, `half a second after the lift the hold is still ${gone.toFixed(3)}`)} spin-down    ${gone.toFixed(3)} left half a second after the lift`);

// 3. Nothing steps. The old law moved the whole 0.76 in one frame; the
//    most a critically damped step can move per second is ω/e of it.
const bound = SPIN_UP / Math.E / 60 + 1e-9;
console.log(`${check(r60.worst <= bound, `a 60 Hz frame moved the hold ${r60.worst.toFixed(3)}, over ${bound.toFixed(3)}`)} no steps     worst frame at 60 Hz ${r60.worst.toFixed(3)} of the hold (was 1.0)`);

// 4. Up is faster than down, and neither bounces.
let over = 0, under = 0;
for (const x of r150.out.slice(0, 75)) over = Math.max(over, x - 1);
for (const x of r150.out.slice(75)) under = Math.min(under, x);
check(SPIN_UP > SPIN_DOWN, "the engine spins down as fast as it spins up");
console.log(`${check(over <= 0 && under >= 0, `the hold bounced: ${over} over, ${under} under`)} no bounce    held to 0..1 through a full blip`);

// 5. Reversing mid-sweep never kinks the needle: the velocity carries.
{
  const s = newSpin();
  for (let i = 0; i < 6; i++) stepSpin(s, 1, 1 / 60);
  const v0 = s.v, x0 = s.x;
  stepSpin(s, 0, 1 / 60);
  const ok = s.x > x0 - 0.05 && v0 > 0;
  console.log(`${check(ok, `a lift mid-sweep moved the hold from ${x0.toFixed(3)} to ${s.x.toFixed(3)} in one frame`)} reversal     a lift mid-sweep turns the needle round rather than dropping it`);
}

// 6. Nonsense in, state out: a paused frame, a NaN.
{
  const s = newSpin(0.5);
  stepSpin(s, 1, 0); stepSpin(s, NaN, 1 / 60); stepSpin(s, 1, NaN);
  console.log(`${check(s.x === 0.5 && s.v === 0, `a zero/NaN step moved the hold to ${s.x}`)} guards       dt 0, dt NaN and a NaN target leave it alone`);
  stepSpin(s, 1, 5);
  check(Math.abs(s.x - 1) < 1e-6, `a five-second frame left the hold at ${s.x}`);
}

// 7. A shunt. The gearbox revs are a function of road speed, and a
//    traffic hit changed road speed by 3.7 m/s in one frame — measured
//    moving the needle 0.33 of the dial between two frames. The jump is
//    carried and settled out, the same at every frame rate.
{
  const run = (hz) => {
    const j = newJolt();
    const shown = [];
    let worst = 0, prev = null;
    for (let i = 1; i <= hz; i++) {
      const t = i / hz;
      // A pull at 0.4/s, and a 0.33 jump arriving at t = 0.5 s.
      const revs = 0.4 + 0.4 * t + (t > 0.5 + 1e-9 ? 0.33 : 0);
      const v = stepJolt(j, revs, 1 / hz, false);
      if (prev !== null) worst = Math.max(worst, Math.abs(v - prev) * hz);
      prev = v; shown.push([t, v, revs]);
    }
    return { shown, worst };
  };
  const a = run(30), b = run(60), c = run(150);
  const pick = (r, hz, t) => r.shown[Math.round(t * hz) - 1];
  let spread = 0;
  for (const t of [0.6, 0.7, 0.8, 1.0]) {
    const v = [pick(a, 30, t)[1], pick(b, 60, t)[1], pick(c, 150, t)[1]];
    spread = Math.max(spread, Math.max(...v) - Math.min(...v));
  }
  const pre = pick(b, 60, 0.5), after = pick(b, 60, 0.8);
  const untouched = Math.abs(pre[1] - pre[2]) < 1e-12;
  const settled = Math.abs(after[1] - after[2]) / 0.33;
  const rate = b.worst;
  console.log(`${check(untouched, `a plain 0.4/s pull was bent by ${pre[1] - pre[2]}`)} pull         a pull slower than REV_SLEW (${REV_SLEW}/s) passes through untouched`);
  console.log(`${check(rate < 0.33 * 60 * 0.5, `the needle crossed the jolt at ${rate.toFixed(2)}/s`)} shunt        the 0.33 jump swings in at no more than ${rate.toFixed(2)} dial/s (was ${(0.33 * 60).toFixed(1)}/s at 60 Hz)`);
  console.log(`${check(settled < 0.1, `0.3 s after the shunt ${(settled * 100).toFixed(0)}% of it is still unsettled`)} settles      ${(settled * 100).toFixed(1)}% of the jump left 0.3 s after it (JOLT_SETTLE ${JOLT_SETTLE}/s)`);
  console.log(`${check(spread < 1e-9, `the shunt reads ${spread} differently between 30 and 150 Hz`)} frame rate   the shunt settles the same at 30 / 60 / 150 Hz (spread ${spread.toExponential(1)})`);
  const s = newJolt();
  stepJolt(s, 0.9, 1 / 60, false);
  const v = stepJolt(s, 0.2, 1 / 60, true);
  console.log(`${check(v === 0.2 && s.off === 0, `a shift frame was carried as a jolt: shown ${v}`)} shifting     a shift's own sweep is not a jolt`);
}

// 8. The engine uses it: the dial, the note and the shake read the spun
//    revs, and the torque does not.
{
  const src = readFileSync(new URL("../src/game/engine.ts", import.meta.url), "utf8");
  const wired =
    /stepSpin\(this\.spin, this\.throttle, dt\)/.test(src) &&
    /stepJolt\(\s*this\.jolt,/.test(src) &&
    /const rpmFrac = this\.revShown;/.test(src) &&
    /Math\.max\(0, this\.revShown\)\)/.test(src) &&
    /smoothstep\(this\.revShown, HIGH_REV_FROM/.test(src) &&
    /torqueShape\(this\.tune\.engine, this\.revFrac\)/.test(src);
  console.log(`${check(wired, "engine.ts no longer drives the dial, note and shake through revShown, or the torque moved off revFrac")} wiring       dial, note and shake read revShown; torque reads revFrac`);
}

console.log(fail.length ? `\nFAILURES:\n - ${fail.join("\n - ")}` : "\nthe revs spin; they do not step");
process.exit(fail.length ? 1 : 0);
