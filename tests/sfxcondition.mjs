// The recorded effects are conditioned before they are played.
//
//   npm run test:sfxcondition      (no browser, no dev server)
//
// Measured on the shipped renders by decoding them in Chromium (there is
// no MP3 decoder on the build box), before this existed:
//
//   file            peak      first sample   loop seam
//   impact.mp3      +0.2 dB   0.31           -
//   scrape.mp3      +0.6 dB   0.26           -
//   blowoff.mp3     +0.2 dB   0.07           -
//   skid-loop.mp3   +0.1 dB   -              ends 2.3 dB louder than it starts,
//                                            88 samples flat-topped in the file
//
// This checks the law on signals built to have each fault, so it says
// what the loader does to ANY file, not just these six.
import {
  conditionSfx, PEAK_CEILING, CLICK_FLOOR, FADE_IN_S, LOOP_XFADE_S,
} from "../src/game/sfxcondition.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok  " : "FAIL"; };
const SR = 48000;
const tone = (n, f, amp, phase = 0) => {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin(phase + (2 * Math.PI * f * i) / SR);
  return a;
};
const peakOf = (cs) => Math.max(...cs.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
const maxStep = (c) => { let m = 0; for (let i = 1; i < c.length; i++) m = Math.max(m, Math.abs(c[i] - c[i - 1])); return m; };

// 1. Overs come down to the ceiling, and nothing else moves.
{
  const hot = [tone(SR, 220, 1.07), tone(SR, 220, 0.9)];
  const r = conditionSfx(hot, SR, false);
  const p = peakOf(r.channels);
  console.log(`${check(Math.abs(p - PEAK_CEILING) < 1e-3, `a +0.6 dBFS file came out at ${p}`)} overs      +0.6 dBFS -> ${(20 * Math.log10(p)).toFixed(2)} dBFS (gain ${r.report.gain.toFixed(3)})`);
  const quiet = [tone(SR, 220, 0.3)];
  const q = conditionSfx(quiet, SR, false);
  check(q.report.gain === 1, `a file with headroom was turned down by ${q.report.gain}`);
  check(hot[0][100] === tone(SR, 220, 1.07)[100], "the input was modified in place");
}

// 2. A one-shot cut mid-waveform starts from silence; one that already
//    does is left alone. A step from 0 to 0.31 in one sample is the click.
{
  const cut = [tone(SR / 2, 180, 0.8, Math.asin(0.31 / 0.8))];
  const r = conditionSfx(cut, SR, false);
  const c = r.channels[0];
  const fin = Math.round(FADE_IN_S * SR);
  // The worst step in the first millisecond, against the tone's own
  // steepest step: a fade leaves no step larger than the tone makes.
  let startStep = Math.abs(c[0]);
  for (let i = 1; i < 48; i++) startStep = Math.max(startStep, Math.abs(c[i] - c[i - 1]));
  const own = maxStep(tone(SR / 2, 180, 0.8));
  console.log(`${check(r.report.fadedIn && startStep <= own * 1.05, `the first step is still ${startStep.toFixed(3)} against the tone's own ${own.toFixed(3)}`)} click-in   first step 0.310 -> ${startStep.toFixed(4)} over a ${fin}-sample fade`);
  const clean = [tone(SR / 2, 180, 0.8)];
  const q = conditionSfx(clean, SR, false);
  check(!q.report.fadedIn && Math.abs(clean[0][0]) <= CLICK_FLOOR, "a clean start was faded anyway");
  console.log(`${check(Math.abs(r.channels[0][r.channels[0].length - 1]) < 1e-6, "the end was not guarded")} click-out  the last sample lands on zero`);
}

// 3. A loop whose ends do not match: a level step and a phase step at the
//    seam. After, the seam is two neighbours and the level walks across.
{
  const n = SR * 2;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lvl = 0.25 * Math.pow(10, (2.3 * i) / n / 20); // ends 2.3 dB louder
    a[i] = lvl * Math.sin((2 * Math.PI * 97.3 * i) / SR) + 0.02 * Math.sin((2 * Math.PI * 3311 * i) / SR);
  }
  const r = conditionSfx([a], SR, true);
  const o = r.channels[0];
  const seam = Math.abs(o[o.length - 1] - o[0]);
  const own = maxStep(a);
  const L = Math.round(LOOP_XFADE_S * SR);
  console.log(`${check(seam <= own * 1.05, `the loop seam still steps ${seam.toFixed(4)} (signal's own worst ${own.toFixed(4)})`)} seam       ${r.report.seamIn.toFixed(4)} -> ${seam.toFixed(4)} (a step the signal makes on its own is ${own.toFixed(4)})`);
  console.log(`${check(o.length === n - L, `the loop is ${o.length} long, expected ${n - L}`)} length     ${n} -> ${o.length} samples (the ${LOOP_XFADE_S * 1000} ms tail is folded in, not dropped)`);
  // No sample inside the crossfade jumps more than the signal does.
  let inside = 0;
  for (let i = 1; i < L + 10; i++) inside = Math.max(inside, Math.abs(o[i] - o[i - 1]));
  check(inside <= own * 1.1, `the crossfade itself steps ${inside.toFixed(4)}`);
}

// 4. Guards: silence and a one-sample file do not throw or divide by zero.
{
  const z = conditionSfx([new Float32Array(1000)], SR, false);
  const t = conditionSfx([new Float32Array(1)], SR, true);
  console.log(`${check(z.report.gain === 1 && t.channels[0].length >= 0, "silence or a single sample broke it")} guards     silence and a one-sample file pass through`);
}

console.log(fail.length ? `\nFAILURES:\n - ${fail.join("\n - ")}` : "\nevery recorded effect plays with headroom, without a click, and loops without a seam");
process.exit(fail.length ? 1 : 0);
