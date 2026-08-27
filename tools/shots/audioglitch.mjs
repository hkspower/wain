// What the master bus actually puts out.
//
//   npm run dev
//   node tools/shots/audioglitch.mjs
//
// "Fix any glitch sound" is not answerable by reading the code. A
// zipper, a sample that clips, a moment of silence where a node was
// rebuilt, a bed that quietly plays the same second and a half forever —
// all of them look fine in the source and are plain in the waveform. So
// this taps the output and listens, in the only sense a script can: it
// records the real bus through an AudioWorklet and measures the samples.
//
//   --record-only  capture the bus and stop
//   --replay       judge the last capture again without a browser
//   --self-test    check the instruments and stop
//
// WHAT EACH NUMBER MEANS, and why it is the right one:
//
//   clip      |sample| >= 0.999. The chain ends in a WaveShaper ceiling,
//             so a single over means the ceiling is not doing its job.
//   pops      discontinuities BIGGER THAN THE SIGNAL AROUND THEM. See
//             findPops for why it is not the more obvious check: this
//             game's engine is built from band-limited sawtooth and
//             square oscillators, whose edges are full-amplitude
//             discontinuities arriving up to 147 times a second, and no
//             test on the samples can tell one of those from a click.
//             What it can tell is a jump into a passage that was quiet.
//   sharp     how sharp the scene's sharpest moment is, against the
//             local RMS. Reported rather than judged — it is the number
//             the pop bar is calibrated against, so it is worth seeing.
//   repeat    the strongest self-similarity in the buffer, and the
//             shortest lag that reaches it. A few milliseconds is a note.
//             A second and a half is a loop showing through, and that is
//             a defect however clean every other column reads.
//   dropout   a run of exact zeroes longer than a millisecond while the
//             scene is supposed to be making noise. Silence is not
//             quiet: it is the sound of a graph that came apart.
//   dc        the mean. A bus with a DC offset wastes headroom and pops
//             when anything downstream mutes it.
//
// Every one of those instruments is checked against a signal with a known
// answer before it is allowed to judge the game, because four of them
// were wrong the first time and two of them were wrong twice. The
// capture itself is checked too: the first version of this tool tapped
// the bus on the main thread, was starved by the WebGL render, and
// measured the same fifth of a second on a loop for eight seconds while
// reporting the loop seam as a click in every scene.
//
// It is deliberately NOT a spectral analysis. Whether the engine sounds
// good is a judgement; whether the bus is repeating itself is a
// measurement, and only the second one belongs in a script.

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
  // Pausing and muting cut the whole mix at once, which is the loudest
  // thing anything in this game ever does to the master bus. Both used to
  // be a bare assignment to master.gain.value — a step from half of full
  // scale to zero between one sample and the next.
  await scene("pausing", () => {
    e.setTouchInput({ throttle: 1, brake: 0, steer: 0 });
    e.player.speed = 45;
    let k = 0;
    const id = setInterval(() => {
      if (k === 0) snd.setPaused(true);
      else if (k === 1) snd.setPaused(false);
      else if (k === 2) snd.toggleMute();
      else { snd.toggleMute(); clearInterval(id); }
      k++;
    }, 420);
  }, 2200);

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
    // Base64 of the raw bytes, not an array of numbers. A minute of
    // audio is two and a half million samples, and handing those back as
    // JSON is about twenty bytes each — tens of megabytes to serialise,
    // ship over CDP and parse, which dwarfed the recording itself.
    const slice = stream.slice(from, to);
    const bytes = new Uint8Array(slice.buffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return { name: m.name, missing, b64: btoa(bin) };
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
const decoded = out.scenes.map((s) => {
  const raw = Buffer.from(s.b64, "base64");
  return { name: s.name, missing: s.missing, buf: new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2) };
});
const manifest = decoded.map((s, i) => {
  writeFileSync(`${CAPTURE}/${i}.f32`, Buffer.from(s.buf.buffer, s.buf.byteOffset, s.buf.byteLength));
  return { name: s.name, file: `${i}.f32`, n: s.buf.length, missing: s.missing };
});
writeFileSync(`${CAPTURE}/manifest.json`, JSON.stringify({ rate: out.rate, scenes: manifest }, null, 2));
return { rate: out.rate, scenes: decoded, holes: out.holes, base: out.base, blocks: out.blocks };
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
      return {
        name: s.name, missing: s.missing ?? 0,
        buf: new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength >> 2),
      };
    }),
  };
}

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };
/**
 * How far a discontinuity has to stand out from the signal AROUND it, and
 * the absolute floor below which nothing counts however lopsided the
 * ratio.
 *
 * 3 is not a guess. Measured across all five scenes, the sharpest single
 * moment in each sits between 0.69 and 1.46 times the local RMS — that is
 * what this game's own oscillators do at their sharpest. 3 is roughly
 * double the worst of them, and a pop of the kind that matters (a gain
 * cut applied as a step, a source stopped without a ramp) lands an order
 * of magnitude above it, because it happens where the signal is quiet.
 */
const POP_RATIO = 3;
const POP_FLOOR = 0.02;
const WIN = 1024;

/** The search starts at 2 ms so a held note answers with its own short
 *  period instead of hiding behind one of its multiples. A fundamental
 *  at or above a fifth of a second is too slow to be a note and is read
 *  as a loop. The bar is 0.35: the defect this found read 0.833 and
 *  0.408, and unrelated lags in the same recordings sat between -0.21
 *  and 0.35. */
const REPEAT_FUND_MIN = 0.002;
const REPEAT_MIN_LAG = 0.25;
const REPEAT_MAX_LAG = 6;
const REPEAT_BAR = 0.35;

/**
 * Discontinuities that are bigger than the signal they interrupt.
 *
 * The obvious check — flag curvature spikes that are outliers against a
 * rolling median of themselves — was tried, and it is wrong here. Two
 * versions of it failed before this one, and the reason is worth keeping.
 *
 * A first difference measures SLOPE, which just asks how loud the mix is:
 * at the measured peak a 5 kHz component steps 0.32 between samples all
 * on its own. Moving to CURVATURE — how far each sample sits off the line
 * joining its neighbours — fixes that, and is the right quantity. But
 * comparing curvature to its own local median still does not work,
 * because this game's engine is built from Web Audio's `sawtooth` and
 * `square` oscillators. Those are band-limited by specification, so their
 * edges are legitimate; they are also the sharpest thing a band-limited
 * signal can do. Measured, the engine's own firing produced curvature
 * spikes at 26x to 218x the local median, arriving on an exact grid at
 * 28 Hz at idle and 147 Hz under load — the firing rate. Any bar low
 * enough to catch a modest click flags every combustion event in the
 * game.
 *
 * And the samples cannot settle it either way: a band-limited signal of
 * peak P may reach a curvature of pi^2 * P, and the sharpest moment in
 * the whole capture used 4.4% of that. Nothing recorded here is
 * impossible for a legal signal, so "is this a click" is not a question
 * the sample values can answer. It is a question about whether there is
 * energy where none belongs, which is a judgement, and judgements do not
 * belong in a script.
 *
 * What IS decidable is narrower, and worth being exact about: a jump
 * LARGER THAN THE SIGNAL AROUND IT. A source stopped without a ramp, a
 * gain set as a step, a node rebuilt mid-phrase — these put a big
 * discontinuity into a passage that was quiet, and no oscillator can do
 * that, because an oscillator is loud exactly when it is sharp. So the
 * test is curvature against the local RMS, with an absolute floor so a
 * silent passage cannot manufacture outliers out of rounding.
 *
 * The limit of this, stated plainly rather than left for someone to
 * discover: a pop that happens INSIDE a loud passage is not detectable
 * here, and cannot be. A sawtooth edge is a full-amplitude discontinuity
 * arriving 28 to 147 times a second, so a mute applied without a ramp
 * while the engine is roaring has the same shape as the engine. This
 * catches the quiet ones. The loud ones need ears.
 */
function findPops(b) {
  const n = b.length;
  const r = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) r[i] = Math.abs(b[i] - (b[i - 1] + b[i + 1]) / 2);
  let count = 0;
  let worst = { ratio: 0, at: -1, size: 0 };
  for (let w = 0; w + WIN <= n; w += WIN) {
    let sq = 0;
    for (let i = w; i < w + WIN; i++) sq += b[i] * b[i];
    const rms = Math.sqrt(sq / WIN);
    const bar = Math.max(rms * POP_RATIO, POP_FLOOR);
    for (let i = w; i < w + WIN; i++) {
      if (r[i] > bar) {
        count++;
        const ratio = r[i] / (rms || 1e-9);
        if (ratio > worst.ratio) worst = { ratio, at: i, size: r[i] };
      }
    }
  }
  return { count, worst };
}

/** In-place iterative radix-2 FFT. Only here to make the autocorrelation
 *  below affordable: a direct search over 5 seconds of lags is 10^9
 *  multiplies and this is 10^7. */
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/**
 * The strongest self-similarity anywhere between `minLag` and `maxLag`.
 *
 * This is the check that found the real defect. A mix can be free of
 * clipping, clicks, dropouts and DC and still sound cheap, because the
 * thing wrong with it is that it REPEATS: a looping noise buffer replays
 * the same wind and tyre roar every time round, and the ear hears the
 * pattern long before it hears any single artefact. Normalised
 * autocorrelation puts a number on that — 1.0 is "these two seconds are
 * literally the same samples", and anything much above the background
 * says a loop is showing through.
 *
 * The subtlety, learned the hard way: it is not enough to skip short lags
 * and take the strongest peak above them. A periodic signal correlates
 * with itself at EVERY multiple of its period, and the engine's period is
 * about ten milliseconds — so multiples of it blanket every lag above a
 * fifth of a second, and the search finds one of them every time. That is
 * what this reported after the loop was fixed: peaks of 0.46 to 0.71 at
 * lags like 0.547 s, all of them the engine note, none of them a loop.
 * Probing the same recordings at round lags gave -0.31 to 0.34, because
 * the peaks are only a sample or two wide.
 *
 * So the search runs from a couple of milliseconds up, and reports the
 * FUNDAMENTAL — the shortest lag that already reaches the peak. A held
 * note answers with its own period, a few milliseconds, and is not a
 * loop. A bed replaying a buffer answers with the buffer length. The two
 * are then trivially told apart by how long the answer is.
 */
function repeatPeak(b, rate, minLag, maxLag) {
  const want = Math.min(b.length, Math.round(rate * (maxLag + 4)));
  let n = 1;
  while (n < want * 2) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < want; i++) mean += b[i];
  mean /= want || 1;
  for (let i = 0; i < want; i++) re[i] = b[i] - mean;
  fft(re, im, false);
  for (let i = 0; i < n; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    re[i] = p; im[i] = 0;
  }
  fft(re, im, true);
  const zero = re[0] || 1e-12;
  const lo = Math.round(minLag * rate), hi = Math.min(Math.round(maxLag * rate), want - 1);
  let peak = 0;
  for (let k = lo; k <= hi; k++) {
    // Normalise by the overlap, or long lags are flattered downward.
    const r = re[k] / (zero * (1 - k / want));
    if (r > peak) peak = r;
  }
  // Report the SMALLEST lag that reaches the peak, not the largest.
  // A signal that repeats every 0.7 s correlates just as perfectly at
  // 1.4 and 2.8, and which of them wins a strict maximum is decided by
  // floating-point noise — the self-test caught this reporting 2.800 s
  // for a block tiled six times. The fundamental is the one worth
  // printing, because it names what is repeating: a few milliseconds is
  // a note, a second and a half is a buffer.
  let at = hi;
  for (let k = lo; k <= hi; k++) {
    const r = re[k] / (zero * (1 - k / want));
    if (r >= peak * 0.9) { at = k; break; }
  }
  return { lag: at / rate, r: peak };
}

/** The sharpest moment in a buffer as a multiple of the signal around it
 *  — the headroom between what the game does and the bar. */
function sharpest(b) {
  const n = b.length;
  const r = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) r[i] = Math.abs(b[i] - (b[i - 1] + b[i + 1]) / 2);
  let worst = 0, size = 0;
  for (let w = 0; w + WIN <= n; w += WIN) {
    let sq = 0;
    for (let i = w; i < w + WIN; i++) sq += b[i] * b[i];
    const rms = Math.sqrt(sq / WIN) || 1e-9;
    for (let i = w; i < w + WIN; i++) {
      if (r[i] / rms > worst) { worst = r[i] / rms; size = r[i]; }
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
  // A sawtooth, deliberately: it is the harshest thing the game plays and
  // the shape that broke both earlier detectors. Summed as a band-limited
  // series so it is a legal signal by construction, not an idealised one.
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let h = 1; h * 110 < RATE_T / 2; h++) v += Math.sin((2 * Math.PI * h * 110 * i) / RATE_T) / h;
    bed[i] = v * 0.18;
  }
  const clean = findPops(bed);
  // ...and a discontinuity dropped into a QUIET passage — the shape of a
  // node rebuilt or a source stopped where nothing was playing — must be
  // caught. A single displaced sample, so it cannot pass by inflating the
  // very RMS it is being measured against.
  const quiet = Float64Array.from(bed, (v) => v * 0.04);
  quiet[20000] += 0.2;
  const planted = findPops(quiet);

  if (clean.count > 0) {
    console.error(
      `the pop detector fires on a band-limited sawtooth (${clean.count} hits, ` +
      `worst ${clean.worst.ratio.toFixed(2)}x local RMS) — it would report this ` +
      `game's own engine as a fault`
    );
    process.exit(2);
  }
  if (planted.count < 1) {
    console.error(
      `the pop detector missed a 0.2 discontinuity in a quiet passage — ` +
      `it is not measuring anything`
    );
    process.exit(2);
  }
  console.log(
    `pop check    silent on a band-limited sawtooth (sharpest ` +
    `${sharpest(bed).ratio.toFixed(2)}x local RMS); catches a discontinuity in a ` +
    `quiet passage at ${planted.worst.ratio.toFixed(0)}x (bar ${POP_RATIO}x)`
  );
  // The repeat check gets the same treatment: a signal built by tiling
  // one block must be found, at the right lag, and unrepeated noise must
  // not be.
  const RT = 44100;
  const period = Math.round(RT * 0.7);
  const block = new Float64Array(period);
  for (let i = 0; i < period; i++) block[i] = Math.random() * 2 - 1;
  const tiled = new Float64Array(RT * 6);
  for (let i = 0; i < tiled.length; i++) tiled[i] = block[i % period];
  const found = repeatPeak(tiled, RT, REPEAT_FUND_MIN, 3);
  if (Math.abs(found.lag - 0.7) > 0.005 || found.r < 0.8) {
    console.error(
      `the repeat check cannot find a signal that is literally one block ` +
      `tiled six times: it reports ${found.r.toFixed(2)} at ${found.lag.toFixed(3)} s, ` +
      `expected about 1.0 at 0.700 s`
    );
    process.exit(2);
  }
  const fresh = new Float64Array(RT * 6);
  for (let i = 0; i < fresh.length; i++) fresh[i] = Math.random() * 2 - 1;
  const none = repeatPeak(fresh, RT, REPEAT_FUND_MIN, 3);
  if (none.r > 0.2) {
    console.error(
      `the repeat check sees a pattern in unrepeated noise (${none.r.toFixed(2)}) — ` +
      `it would call any mix a loop`
    );
    process.exit(2);
  }
  // And the case that actually fooled it: a held note is periodic, so it
  // correlates with itself at every multiple of its period, including
  // lags that look like loop lengths. It must answer with its own short
  // period, not with one of those multiples.
  const held = new Float64Array(RT * 6);
  for (let i = 0; i < held.length; i++) {
    for (let h = 1; h * 110 < RT / 2; h++) held[i] += Math.sin((2 * Math.PI * h * 110 * i) / RT) / h;
  }
  const note = repeatPeak(held, RT, REPEAT_FUND_MIN, 3);
  if (note.lag >= REPEAT_MIN_LAG) {
    console.error(
      `the repeat check calls a sustained 110 Hz note a loop: it reports a period ` +
      `of ${note.lag.toFixed(3)} s (r=${note.r.toFixed(2)}) instead of the 0.009 s ` +
      `the note actually repeats at`
    );
    process.exit(2);
  }
  // The decisive one: the defect as it actually appeared — a looping
  // noise bed with an engine note over the top. Both are present, both
  // are periodic, and the check has to answer with the BED's period. If
  // it answers with the note's, it would have missed the real bug.
  const bedLoop = Math.round(RT * 1.5);
  const blk = new Float64Array(bedLoop);
  for (let i = 0; i < bedLoop; i++) blk[i] = Math.random() * 2 - 1;
  const both = new Float64Array(RT * 8);
  for (let i = 0; i < both.length; i++) {
    both[i] = blk[i % bedLoop] * 0.5 + Math.sin((2 * Math.PI * 110 * i) / RT) * 0.5;
  }
  const mixed = repeatPeak(both, RT, REPEAT_FUND_MIN, 3);
  if (Math.abs(mixed.lag - 1.5) > 0.01 || mixed.r < REPEAT_BAR) {
    console.error(
      `the repeat check cannot find a looping noise bed underneath a held note: ` +
      `it reports ${mixed.r.toFixed(2)} every ${mixed.lag.toFixed(3)} s, expected a ` +
      `strong 1.500 s. This is the shape of the bug it exists to catch`
    );
    process.exit(2);
  }
  console.log(
    `repeat check finds a tiled block at ${found.lag.toFixed(3)} s ` +
    `(r=${found.r.toFixed(2)}), reads ${none.r.toFixed(2)} on fresh noise, calls a ` +
    `held note ${note.lag.toFixed(4)} s, and still finds a 1.5 s bed under a note ` +
    `(${mixed.r.toFixed(2)} at ${mixed.lag.toFixed(3)} s)\n`
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
  "rms".padStart(8) + "clip".padStart(7) + "pops".padStart(6) +
  "sharp".padStart(7) + "repeat".padStart(8) + "at".padStart(8) +
  "dc".padStart(9) + "  drop"
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
  const pops = findPops(b);
  const rep = repeatPeak(b, RATE, REPEAT_FUND_MIN, REPEAT_MAX_LAG);
  report.push({
    name: s.name, peak, rms, clip, dc, dropMs, n: b.length,
    pops: pops.count, popRatio: +pops.worst.ratio.toFixed(1),
    popSize: +pops.worst.size.toFixed(4),
    popAtMs: pops.worst.at < 0 ? null : +((pops.worst.at / RATE) * 1000).toFixed(1),
    sharpest: +sharpest(b).ratio.toFixed(2),
    repeat: +rep.r.toFixed(3), repeatLag: +rep.lag.toFixed(3),
  });
  console.log(
    s.name.padEnd(16) + String(b.length).padStart(9) +
    peak.toFixed(3).padStart(8) + rms.toFixed(4).padStart(8) +
    String(clip).padStart(7) + String(pops.count).padStart(6) +
    (sharpest(b).ratio.toFixed(2) + "x").padStart(7) +
    rep.r.toFixed(3).padStart(8) + (rep.lag.toFixed(2) + "s").padStart(8) +
    dc.toFixed(5).padStart(9) + `  ${dropMs.toFixed(1)} ms`
  );
}

console.log("");
for (const r of report) {
  check(r.clip === 0, `${r.name}: ${r.clip} sample(s) at or past full scale — the ceiling is not holding`);
  check(
    r.pops === 0,
    `${r.name}: ${r.pops} discontinuit${r.pops === 1 ? "y" : "ies"} bigger than the ` +
    `signal around ${r.pops === 1 ? "it" : "them"} — worst is a ${r.popSize} step at ` +
    `${r.popRatio}x the local RMS, ${r.popAtMs} ms in`
  );
  check(Math.abs(r.dc) < 0.01, `${r.name}: DC offset ${r.dc.toFixed(4)} — headroom wasted and it will pop on mute`);
  // ...except in the scene whose whole point is going silent on purpose.
  check(
    r.name === "pausing" || r.dropMs < 1,
    `${r.name}: ${r.dropMs.toFixed(1)} ms of digital silence mid-scene — the graph came apart`
  );
  check(
    r.repeat < REPEAT_BAR || r.repeatLag < REPEAT_MIN_LAG,
    `${r.name}: the bus repeats itself — correlation ${r.repeat} with itself every ` +
    `${r.repeatLag} s, which is far too slow to be a note (bar ${REPEAT_BAR} above ` +
    `${REPEAT_MIN_LAG} s). A loop is showing through the mix`
  );
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
    : "no clipping, no pops, no dropouts, no DC, no loop showing through — " +
      "and it is making a noise"
);
process.exit(fail.length ? 1 : 0);
