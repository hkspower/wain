// What the master bus actually puts out.
//
//   npm run dev
//   node tools/shots/audioglitch.mjs
//
// "Fix any glitch sound" is not answerable by reading the code. A
// zipper, a click at a note boundary, a sample that clips, a moment of
// silence where a node was rebuilt — all of them look fine in the
// source and are obvious in the waveform. So this taps the output and
// listens, in the only sense a script can: it records the real bus
// through a ScriptProcessor and measures the samples.
//
// WHAT EACH NUMBER MEANS, and why it is the right one:
//
//   clip      |sample| >= 0.999. The chain ends in a WaveShaper ceiling,
//             so a single over means the ceiling is not doing its job.
//   click     a sample-to-sample jump that is an OUTLIER against the
//             local signal, not against a fixed number.
//
//             The first version used a fixed threshold — 0.25 between
//             adjacent samples — reasoning that a sine cannot move far
//             in 23 microseconds. True, and useless here: at the
//             measured peak of 0.44 a 5.1 kHz component produces
//             exactly a 0.32 step, and this mix is built out of
//             FILTERED NOISE — wind, tyre roll, skid, scrape — which
//             has energy all the way to Nyquist by definition. The tool
//             duly reported four clicks per run, every one of them the
//             sound of a tyre on tarmac. A single-sample delta cannot
//             tell broadband noise from a discontinuity, and a check
//             that calls the game's own hiss a defect is worse than no
//             check.
//
//             What separates a click from noise is not size, it is
//             ANOMALY: a click is a step orders of magnitude above what
//             the signal was doing a millisecond either side of it. So
//             the difference signal is compared to a rolling median of
//             itself — a median, not a mean, because one click must not
//             raise the bar that catches it. Eight times the local
//             median, with an absolute floor so a silent passage cannot
//             manufacture outliers out of rounding.
//   dropout   a run of exact zeroes longer than a millisecond while the
//             scene is supposed to be making noise. Silence is not
//             quiet: it is the sound of a graph that came apart.
//   dc        the mean. A bus with a DC offset wastes headroom and pops
//             when anything downstream mutes it.
//
// It is deliberately NOT a spectral analysis. Whether the engine sounds
// good is a judgement; whether the bus is clicking is a measurement,
// and only the second one belongs in a script.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";

// Recording the bus costs a browser, a boot and eight seconds of real
// time; tuning a detector costs a second. Keeping the two apart means the
// detector can be argued with against the SAME audio, over and over,
// instead of against a fresh recording that moved underneath it.
const CAPTURE = process.env.GRN_AUDIO_CAPTURE || "press/audio/capture";
const replay = process.argv.includes("--replay");

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
async function record() {
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: [
    "--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
    // A real audio device, not the silent stub: without this the graph
    // runs but every buffer comes back as zeroes and the tool reports a
    // perfectly clean mix that was never rendered.
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.click("text=START ENGINE");
let up = false;
for (let i = 0; i < 600 && !up; i++) {
  up = await page.evaluate(() => !!window.__grnDebug);
  if (!up) await page.waitForTimeout(1000);
}
if (!up) { console.error("game never booted"); process.exit(2); }
await page.waitForTimeout(1500);
await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
await page.waitForTimeout(600);

const out = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const snd = e.sound;
  if (!snd) return { error: "no sound engine" };
  const ctx = snd.audioContext;
  if (ctx.state !== "running") await ctx.resume().catch(() => {});
  if (ctx.state !== "running") return { error: `audio context is ${ctx.state}` };

  // Tap the very end of the chain, after the ceiling.
  //
  // This MUST be an AudioWorklet, not a ScriptProcessor. The first
  // version used createScriptProcessor, which runs its callback on the
  // MAIN thread — the same thread rendering a WebGL night scene at full
  // tilt. It was starved, and Chrome answered by handing the same input
  // buffer back over and over: 97% of the captured blocks came back
  // byte-identical to the block two before them. The "recording" was a
  // fifth of a second of audio on a loop, and the tool dutifully reported
  // the loop seam as a click in every scene. A worklet renders on the
  // audio thread, which cannot be starved by the main one.
  //
  // It also records ONE continuous stream and stamps every block with the
  // audio-thread frame index it began at, rather than starting and
  // stopping per scene. Start/stop was its own trap: the main thread runs
  // far behind the audio thread here, so blocks posted during one scene
  // were still in flight when the next scene cleared the array — audio
  // landing under the wrong label, and worse, a gap in the middle of a
  // buffer that concatenates into a seam the detector would have called a
  // click. With frame stamps the stream can be reassembled in order and
  // any missing block is visible as a hole instead of a fake glitch.
  const src = `
    class Tap extends AudioWorkletProcessor {
      constructor() {
        super();
        this.buf = new Float32Array(4096);
        this.n = 0;
        this.start = 0;
      }
      process(inputs) {
        // When the upstream graph is producing nothing, Chrome hands this
        // an EMPTY input array rather than a quantum of zeroes. Skipping
        // those frames leaves the frame counter marching on without
        // samples behind it, which reassembles into a 6.85-second "hole"
        // that looks exactly like a dropped capture. Silence is a value:
        // record it.
        const ch = inputs[0] && inputs[0][0];
        const len = ch ? ch.length : 128;
        for (let i = 0; i < len; i++) {
          if (this.n === 0) this.start = currentFrame + i;
          this.buf[this.n++] = ch ? ch[i] : 0;
          if (this.n === this.buf.length) {
            this.port.postMessage({ start: this.start, data: this.buf.slice(0) });
            this.n = 0;
          }
        }
        return true;
      }
    }
    registerProcessor("grn-tap", Tap);
  `;
  const url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  const tap = snd.outputTap;
  const proc = new AudioWorkletNode(ctx, "grn-tap", {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
  });
  const blocks = [];
  proc.port.onmessage = (ev) => blocks.push(ev.data);
  // A node is only pulled if it reaches a destination; a muted gain keeps
  // it rendering without doubling the mix into the speakers.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  tap.connect(proc);
  proc.connect(mute).connect(ctx.destination);

  /** Hold a driving state for `ms` of wall time, noting the audio-thread
   *  span it occupied. The samples themselves are sliced out afterwards. */
  const marks = [];
  const scene = async (name, setup, ms) => {
    setup();
    const from = ctx.currentTime;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await new Promise((r) => setTimeout(r, 20));
    }
    marks.push({ name, from, to: ctx.currentTime });
  };

  e.setPaused(false);

  // The audio thread drops its first several seconds while the page
  // settles, and a scene marked before it steadies keeps a piece of that
  // gap. Wait for a contiguous run to arrive before marking anything, so
  // the settling lands outside every span that gets judged.
  {
    const t0 = performance.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 50));
      const tail = blocks.slice(-12);
      const solid = tail.length === 12 && tail.every(
        (b, i) => i === 0 || b.start === tail[i - 1].start + tail[i - 1].data.length
      );
      if (solid || performance.now() - t0 > 40000) break;
    }
  }

  await scene("idle", () => {
    e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
    e.player.speed = 0;
  }, 1600);
  await scene("full throttle", () => {
    e.setTouchInput({ throttle: 1, brake: 0, steer: 0 });
    e.player.speed = 45;
  }, 1600);
  await scene("on the limiter", () => {
    e.setTouchInput({ throttle: 1 });
    e.player.speed = e.tune.topSpeedKmh / 3.6;
  }, 1600);
  await scene("drifting", () => {
    e.setTouchInput({ throttle: 0.9, steer: 0.8 });
    e.player.speed = 38;
    e.touchDrift(true);
  }, 1600);
  await scene("collisions", () => {
    e.touchDrift(false);
    e.setTouchInput({ throttle: 0.6, steer: 0 });
    e.player.speed = 30;
    // Bumps and scrapes in quick succession — the one-shots most likely
    // to stack, and the ones that fire when the mix is already loud.
    let k = 0;
    const id = setInterval(() => {
      snd.bump(0.6 + (k % 3) * 0.2);
      snd.scrape(0.5 + (k % 4) * 0.15);
      if (++k > 12) clearInterval(id);
    }, 110);
  }, 1800);

  // Let the last blocks cross from the audio thread before unhooking.
  await new Promise((r) => setTimeout(r, 400));
  proc.disconnect();
  mute.disconnect();
  try { tap.disconnect(proc); } catch {}

  // Reassemble the stream in audio-thread order. Blocks arrive on the
  // main thread whenever it gets a turn, so the array is not sorted and
  // may have holes; both are recoverable here and neither may be papered
  // over, because a hole spliced shut is exactly what a click looks like.
  blocks.sort((a, b) => a.start - b.start);
  const holes = [];
  for (let i = 1; i < blocks.length; i++) {
    const want = blocks[i - 1].start + blocks[i - 1].data.length;
    if (blocks[i].start !== want) holes.push({ at: want, missing: blocks[i].start - want });
  }
  const base = blocks.length ? blocks[0].start : 0;
  const total = blocks.length
    ? blocks[blocks.length - 1].start + blocks[blocks.length - 1].data.length - base
    : 0;
  const stream = new Float32Array(total);
  for (const b of blocks) stream.set(b.data, b.start - base);

  // A hole matters only if it falls inside a span being measured. The
  // audio thread takes several seconds to settle after the page loads and
  // reliably drops the first stretch; that is outside every scene and of
  // no interest. A hole INSIDE a scene is fatal to that scene, because the
  // zeroes standing in for it are indistinguishable from the graph
  // falling apart.
  const rate = ctx.sampleRate;
  const scenes = marks.map((m) => {
    const fromAbs = Math.round(m.from * rate);
    const toAbs = Math.round(m.to * rate);
    const missing = holes.reduce(
      (a, h) => a + Math.max(0, Math.min(toAbs, h.at + h.missing) - Math.max(fromAbs, h.at)), 0
    );
    const from = Math.max(0, fromAbs - base);
    const to = Math.min(total, toAbs - base);
    return { name: m.name, missing, buf: Array.from(stream.subarray(from, to)) };
  });
  return { rate, scenes, holes, base, blocks: blocks.length };
});

if (out.error) { console.error(out.error); await browser.close(); process.exit(2); }
await browser.close();

const holed = out.scenes.filter((s) => s.missing > 0);
if (holed.length) {
  console.error(
    `the tap dropped audio inside ${holed.length} scene(s), so any discontinuity ` +
    `found there could be the hole rather than the game:\n` +
    holed.map((s) => `  ${s.name}: ${s.missing} samples missing`).join("\n")
  );
  process.exit(2);
}
const settling = out.holes.reduce((a, h) => a + h.missing, 0);
console.log(
  `captured     ${out.blocks} blocks, no holes inside any scene` +
  (settling ? ` (${(settling / out.rate).toFixed(1)} s dropped while the audio thread settled, before the first scene)` : "")
);

mkdirSync(CAPTURE, { recursive: true });
const manifest = out.scenes.map((s, i) => {
  const f32 = Float32Array.from(s.buf);
  writeFileSync(`${CAPTURE}/${i}.f32`, Buffer.from(f32.buffer));
  return { name: s.name, file: `${i}.f32`, n: f32.length };
});
writeFileSync(`${CAPTURE}/manifest.json`, JSON.stringify({ rate: out.rate, scenes: manifest }, null, 2));
return { rate: out.rate, scenes: out.scenes.map((s) => ({ name: s.name, buf: Float32Array.from(s.buf) })) };
}

/** The last take, straight off disk — same samples, no browser. */
function load() {
  if (!existsSync(`${CAPTURE}/manifest.json`)) {
    console.error(`no capture in ${CAPTURE} — run once without --replay first`);
    process.exit(2);
  }
  const m = JSON.parse(readFileSync(`${CAPTURE}/manifest.json`, "utf8"));
  return {
    rate: m.rate,
    scenes: m.scenes.map((s) => {
      const raw = readFileSync(`${CAPTURE}/${s.file}`);
      return { name: s.name, buf: new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2) };
    }),
  };
}

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };
/** How many times its LOCAL median a curvature spike must be to count as
 *  a discontinuity, and the absolute floor below which nothing counts
 *  however lopsided the ratio. */
const CLICK_RATIO = 25;
const CLICK_FLOOR = 0.02;
const WIN = 1024;

/**
 * Clicks in a buffer.
 *
 * Not the first difference. A first difference measures SLOPE, and slope
 * is a terrible discriminator here: a loud low note and a click can move
 * the same distance in one sample, so the check ends up asking how loud
 * the mix is rather than whether it is broken.
 *
 * What a click actually violates is smoothness. Anything band-limited —
 * which every sound in this game is, having come out of an oscillator or
 * a filter — passes almost exactly through the midpoint of its own
 * neighbours from one sample to the next. So the measurement is the
 * CURVATURE residual: how far each sample sits off the straight line
 * joining the two beside it. A steep ramp has huge slope and near-zero
 * curvature; a displaced sample or a buffer seam has a curvature spike
 * nothing band-limited can produce.
 *
 * That residual is then compared to a rolling median of itself — a
 * median, not a mean, so a click cannot raise the bar that catches it.
 */
function findClicks(b) {
  const n = b.length;
  const r = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) r[i] = Math.abs(b[i] - (b[i - 1] + b[i + 1]) / 2);
  let count = 0;
  let worst = { ratio: 0, at: -1, size: 0 };
  const scratch = new Float64Array(WIN);
  for (let w = 0; w + WIN <= n; w += WIN) {
    scratch.set(r.subarray(w, w + WIN));
    const sorted = Array.from(scratch).sort((x, y) => x - y);
    const med = sorted[WIN >> 1] || 1e-9;
    const bar = Math.max(med * CLICK_RATIO, CLICK_FLOOR);
    for (let i = w; i < w + WIN; i++) {
      if (r[i] > bar) {
        count++;
        const ratio = r[i] / med;
        if (ratio > worst.ratio) worst = { ratio, at: i, size: r[i] };
      }
    }
  }
  return { count, worst };
}

/** The largest curvature spike anywhere, as a multiple of its own local
 *  median — the headroom between this signal and the bar. */
function worstRatio(b) {
  const n = b.length;
  const r = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) r[i] = Math.abs(b[i] - (b[i - 1] + b[i + 1]) / 2);
  let worst = 0, size = 0;
  const scratch = new Float64Array(WIN);
  for (let w = 0; w + WIN <= n; w += WIN) {
    scratch.set(r.subarray(w, w + WIN));
    const sorted = Array.from(scratch).sort((x, y) => x - y);
    const med = sorted[WIN >> 1] || 1e-9;
    for (let i = w; i < w + WIN; i++) {
      if (r[i] / med > worst) { worst = r[i] / med; size = r[i]; }
    }
  }
  return { ratio: worst, size };
}

// A detector that has never seen a click is a detector nobody has
// tested. Two synthetic buffers prove it both ways before any real
// audio is judged by it: filtered noise at the level this mix actually
// runs at must come back clean, and the same noise with one sample
// displaced must be caught.
// --record-only captures the bus and stops, without asking the detector
// anything. That is not a hole in the gate: it is the only way to obtain
// the real signal the detector has to be calibrated against, and it
// judges nothing.
if (!process.argv.includes("--record-only")) {
  // The first fixture here was a one-pole filtered noise I made up, and
  // it was nonsense: its own median step was 0.196, twenty to sixty times
  // larger than the real mix's, so the bar landed at 1.57 and the planted
  // 0.6 click sailed underneath it. Inventing a signal to test a detector
  // only tests the invention.
  //
  // So the fixture is now one I can argue about on paper. A sum of sines
  // is band-limited BY CONSTRUCTION: no term climbs above 8 kHz, so its
  // curvature is bounded by (2*pi*f/fs)^2 per unit amplitude and the
  // detector must never fire on it. That is the whole claim the detector
  // makes, stated as a signal.
  const RATE_T = 44100;
  const n = RATE_T;
  const bed = new Float64Array(n);
  const parts = [[73, 0.18], [220, 0.12], [512, 0.09], [1900, 0.05], [4300, 0.03], [8000, 0.02]];
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const [f, a] of parts) v += a * Math.sin((2 * Math.PI * f * i) / RATE_T + f);
    bed[i] = v;
  }
  const clean = findClicks(bed);
  // ...and one displaced sample, at a size that is plainly audible
  // against a bed this loud, must be caught.
  const dirty = Float64Array.from(bed);
  dirty[20000] += 0.05;
  const planted = findClicks(dirty);

  if (clean.count > 0) {
    const w = worstRatio(bed);
    console.error(
      `the click detector fires on a provably band-limited signal ` +
      `(${clean.count} hits, worst ${w.ratio.toFixed(0)}x local median) — ` +
      `it would report this game's own tones as a fault`
    );
    process.exit(2);
  }
  if (planted.count < 1) {
    const w = worstRatio(dirty);
    console.error(
      `the click detector missed a planted 0.05 click — it is not measuring ` +
      `anything (the plant reached only ${w.ratio.toFixed(1)}x its local median, ` +
      `bar is ${CLICK_RATIO}x)`
    );
    process.exit(2);
  }
  const head = worstRatio(bed);
  console.log(
    `detector     silent on a band-limited bed (worst ${head.ratio.toFixed(1)}x local ` +
    `median, bar ${CLICK_RATIO}x); catches a planted 0.05 click at ` +
    `${planted.worst.ratio.toFixed(0)}x\n`
  );
  if (process.argv.includes("--self-test")) process.exit(0);
}

// Only now, with a detector that has been shown to work, is it worth
// spending a browser and eight seconds of real time on a recording.
const out = replay ? load() : await record();
const RATE = out.rate;
if (process.argv.includes("--record-only")) {
  console.log(`captured ${out.scenes.length} scenes at ${RATE} Hz into ${CAPTURE}`);
  process.exit(0);
}

// The instrument has to prove it recorded something, too. The first
// version of this tool tapped the bus with a ScriptProcessor on the main
// thread, was starved by the WebGL render, and got the same two buffers
// handed back for eight seconds straight — 97% of blocks byte-identical
// to the block two before. Every statistic it printed described a fifth
// of a second on a loop. A recording that repeats itself is not a
// recording, so nothing gets judged until this passes.
for (const s of out.scenes) {
  const b = s.buf, B = 4096;
  let dup = 0, blocks = 0;
  for (let k = 2; (k + 1) * B <= b.length; k++) {
    blocks++;
    for (let back = 1; back <= 2; back++) {
      let same = true;
      for (let j = 0; j < B; j++) if (b[k * B + j] !== b[(k - back) * B + j]) { same = false; break; }
      if (same) { dup++; break; }
    }
  }
  if (dup > 0) {
    console.error(
      `${s.name}: ${dup} of ${blocks} recorded blocks are byte-identical to an ` +
      `earlier block — the tap is being starved and re-serving stale buffers, ` +
      `so there is nothing here to measure`
    );
    process.exit(2);
  }
}

console.log(`sample rate  ${RATE} Hz\n`);
console.log(
  "scene".padEnd(16) + "samples".padStart(9) + "peak".padStart(8) +
  "rms".padStart(8) + "clip".padStart(7) + "clicks".padStart(8) +
  "worst".padStart(8) + "dc".padStart(9) + "  drop"
);

const report = [];
for (const s of out.scenes) {
  const b = s.buf;
  if (!b.length) { fail.push(`${s.name}: nothing was recorded`); continue; }
  let peak = 0, sum = 0, sq = 0, clip = 0, zeroRun = 0, worstZero = 0;
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 0.999) clip++;
    sum += v;
    sq += v * v;
    if (v === 0) { zeroRun++; if (zeroRun > worstZero) worstZero = zeroRun; }
    else zeroRun = 0;
  }
  const rms = Math.sqrt(sq / b.length);
  const dc = sum / b.length;
  const dropMs = (worstZero / RATE) * 1000;
  const clicks = findClicks(b);
  report.push({
    name: s.name, peak, rms, clip, dc, dropMs, n: b.length,
    clicks: clicks.count, worstRatio: +clicks.worst.ratio.toFixed(1),
    worstSize: +clicks.worst.size.toFixed(4),
    headroom: +worstRatio(b).ratio.toFixed(1),
    worstAtMs: clicks.worst.at < 0 ? null : +((clicks.worst.at / RATE) * 1000).toFixed(1),
  });
  console.log(
    s.name.padEnd(16) + String(b.length).padStart(9) +
    peak.toFixed(3).padStart(8) + rms.toFixed(4).padStart(8) +
    String(clip).padStart(7) + String(clicks.count).padStart(8) +
    (report[report.length - 1].headroom.toFixed(1) + "x").padStart(8) +
    dc.toFixed(5).padStart(9) + `  ${dropMs.toFixed(1)} ms`
  );
}

console.log("");
for (const r of report) {
  check(r.clip === 0, `${r.name}: ${r.clip} sample(s) at or past full scale — the ceiling is not holding`);
  check(
    r.clicks === 0,
    `${r.name}: ${r.clicks} discontinuit${r.clicks === 1 ? "y" : "ies"} — ` +
    `worst is a ${r.worstSize} curvature spike at ${r.worstRatio}x the local median, ` +
    `${r.worstAtMs} ms in`
  );
  check(Math.abs(r.dc) < 0.01, `${r.name}: DC offset ${r.dc.toFixed(4)} — headroom wasted and it will pop on mute`);
  check(r.dropMs < 1, `${r.name}: ${r.dropMs.toFixed(1)} ms of digital silence mid-scene — the graph came apart`);
}
// ...and it has to be making a noise at all, or every check above passes
// by describing silence.
const loud = report.find((r) => r.name === "full throttle");
check(loud && loud.rms > 0.005, `full throttle reads ${loud?.rms.toFixed(4)} RMS — the bus is effectively silent`);

mkdirSync("press/audio", { recursive: true });
writeFileSync("press/audio/glitch.json", JSON.stringify(report, null, 2));

console.log(
  fail.length
    ? `FAILURES:\n - ${fail.join("\n - ")}`
    : "no clipping, no discontinuities, no dropouts, no DC — and it is making a noise"
);
process.exit(fail.length ? 1 : 0);
