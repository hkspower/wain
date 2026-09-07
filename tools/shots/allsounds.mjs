// Every sound the game can make, fired one at a time and measured at the
// output.
//
//   npm run dev
//   npm run check:sounds
//
// An instrument, not a test: it prints a number per sound and does not
// decide what the number should be. What it decides is whether a sound
// EXISTS — because the failure this catches is not "the crash is too
// quiet", it is "the crash makes no sound at all", and that one hides
// perfectly behind a suite that checks gain nodes.
//
// WHY IT TAPS THE OUTPUT
//
// tests/audio.mjs reads gain values, which answers "is the node set up
// to be heard". This answers "was anything heard". A voice whose gain
// is 0.8 and whose oscillator was never started reads identically to a
// working one from the node graph, and differently from one metre away.
// So an analyser sits on outputTap — after the limiter and the ceiling,
// which is what actually leaves the machine — and every sound is fired
// into silence with the others quiet, and the peak is read.
//
// The engine hum is the exception and it is why the frames matter: the
// engine is always making sound, so each one-shot is measured as what
// it ADDS over the idle floor rather than as an absolute.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: [
    "--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
    // Audio has to actually run: without this the context stays
    // suspended in headless and every sound measures as silence, which
    // is the one result this tool must never produce by accident.
    "--autoplay-policy=no-user-gesture-required",
  ],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.evaluate(() => window.__grnEngine.sound?.resume());
await page.waitForTimeout(800);

const state = await page.evaluate(() => window.__grnEngine.sound.ctx.state);
if (state !== "running") {
  console.log(`the audio context is ${state}, so nothing below could have been heard`);
  await browser.close();
  process.exit(1);
}

// The tap, and a quiet car to fire into.
//
// The sim is frozen and the AUDIO is then re-opened, in that order and
// as two calls, because they are two things behind one name.
// engine.setPaused(true) stops the world feeding frames — which is what
// this needs — and also drops the sound engine's master to zero, which
// is the opposite of what this needs. The first version of this tool
// muted the game and then reported, with perfect consistency, that
// every sound in it was silent.
await page.evaluate(() => {
  const s = window.__grnEngine.sound;
  window.__grnEngine.setPaused(true);
  s.setPaused(false);
  const a = s.ctx.createAnalyser();
  a.fftSize = 2048;
  s.outputTap.connect(a);
  window.__tap = { a, buf: new Float32Array(a.fftSize) };
});

/** Peak amplitude over `ms`, sampled as fast as the page will run. */
const peakOver = (ms) =>
  page.evaluate(async (dur) => {
    const { a, buf } = window.__tap;
    let peak = 0, rms = 0, n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < dur) {
      a.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        if (v > peak) peak = v;
        sum += buf[i] * buf[i];
      }
      rms += Math.sqrt(sum / buf.length);
      n++;
      // setTimeout, not requestAnimationFrame. rAF is tied to the
      // compositor, and this page is running a game: a measurement
      // window that waits for frames waits for the renderer, and the
      // first version of this tool spent ten minutes on sixteen sounds
      // and then died on its own timeout half way through the held
      // voices. Nothing here needs a frame — the analyser is fed by the
      // audio thread.
      await new Promise((r) => setTimeout(r, 4));
    }
    return { peak: +peak.toFixed(4), rms: +(rms / Math.max(1, n)).toFixed(4) };
  }, ms);

// The frame the engine actually takes (SoundFrame, sound.ts). Written
// out in full here rather than half-filled: the fields are optional in
// the type but not in the arithmetic, and a frame missing rpmFrac put a
// NaN through setTargetAtTime and took the whole tool down on its first
// call. A partial frame is not a smaller frame, it is a broken one.
const FRAME = {
  speedKmh: 0, throttle: 0, rpmFrac: 0, gear: 1, skid: 0,
  boost: 0, nosActive: false, brake: 0, driftYaw: 0, spin: 0, limited: 0,
  liftRate: 0, rumble: 0, coast: 0, rain: 0, wet: 0, enclosure: 0,
  seaX: 0, seaZ: 400, rival: null, others: [],
  listener: { x: 0, y: 1, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 },
};

/** Hold the car still and silent so a one-shot is measured on its own. */
const idle = () =>
  page.evaluate((f) => {
    const s = window.__grnEngine.sound;
    for (let i = 0; i < 8; i++) s.update(f);
  }, FRAME);

// Every sound the engine can make, in the order a player meets them.
// Written out by hand ON PURPOSE: a list built by reflection off the
// class would grow a new entry the day somebody adds a method and would
// never notice one that was deleted, which is the direction that
// matters — a sound that quietly stopped existing.
const SOUNDS = [
  ["revStart", (s) => s.revStart(), 520],
  ["shift", (s) => s.update({ ...s.__f, gear: 2 }) ?? null, 320],
  ["backfire", (s) => s.backfire(1), 420],
  ["blowOff", (s) => s.blowOff(), 360],
  ["bump light", (s) => s.bump(0.25), 360],
  ["bump hard", (s) => s.bump(1), 460],
  ["scrape light", (s) => s.scrape(0.3), 360],
  ["scrape hard", (s) => s.scrape(1), 420],
  ["flashClick", (s) => s.flashClick(), 300],
  ["driftLink 1", (s) => s.driftLink(1), 320],
  ["driftLink 5", (s) => s.driftLink(5), 320],
  ["battleSting", (s) => s.battleSting(), 520],
  ["winSting", (s) => s.winSting(), 520],
  ["loseSting", (s) => s.loseSting(), 520],
  ["championFanfare", (s) => s.championFanfare(), 1320],
  ["horn", (s) => { s.hornOn(); setTimeout(() => s.hornOff(), 250); }, 420],
];

// Before trusting a single zero below, prove the tap can see sound at
// all. A muted game and a broken analyser are indistinguishable from
// "every sound is silent", and the difference is the whole report.
const proof = await page.evaluate(async () => {
  const s = window.__grnEngine.sound;
  const o = s.ctx.createOscillator();
  const g = s.ctx.createGain();
  g.gain.value = 0.3;
  o.frequency.value = 440;
  o.connect(g).connect(s.mixBus);
  o.start();
  const { a, buf } = window.__tap;
  let peak = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 260) {
    a.getFloatTimeDomainData(buf);
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    await new Promise((r) => setTimeout(r, 4));
  }
  o.stop();
  o.disconnect();
  return +peak.toFixed(4);
});
console.log(`the tap hears a 440 Hz tone put through the mix bus at ${proof}`);
if (proof < 0.02) {
  console.log("...which is silence, so the measurements below would all be zero for that reason alone");
  await browser.close();
  process.exit(1);
}

console.log("\none-shots, peak amplitude at the output (idle floor subtracted)\n");
await idle();
const floor = await peakOver(320);
console.log(`  ${"idle floor".padEnd(18)} peak ${floor.peak.toFixed(4)}  rms ${floor.rms.toFixed(4)}`);

const silent = [];
for (const [name, , ms] of SOUNDS) {
  await idle();
  await page.evaluate(([n, F]) => {
    const s = window.__grnEngine.sound;
    window.__F = F;
    const fire = {
      revStart: () => s.revStart(),
      shift: () => s.update({ ...window.__F, speedKmh: 60, rpmFrac: 0.9, throttle: 1, gear: 3 }),
      backfire: () => s.backfire(1),
      blowOff: () => s.blowOff(),
      "bump light": () => s.bump(0.25),
      "bump hard": () => s.bump(1),
      "scrape light": () => s.scrape(0.3),
      "scrape hard": () => s.scrape(1),
      flashClick: () => s.flashClick(),
      "driftLink 1": () => s.driftLink(1),
      "driftLink 5": () => s.driftLink(5),
      battleSting: () => s.battleSting(),
      winSting: () => s.winSting(),
      loseSting: () => s.loseSting(),
      championFanfare: () => s.championFanfare(),
      horn: () => { s.hornOn(); setTimeout(() => s.hornOff(), 250); },
    }[n];
    fire?.();
  }, [name, FRAME]);
  const m = await peakOver(ms);
  const over = +(m.peak - floor.peak).toFixed(4);
  const heard = over > 0.002;
  if (!heard) silent.push(name);
  console.log(
    `  ${name.padEnd(18)} peak ${m.peak.toFixed(4)}  +${over.toFixed(4)} over idle  ` +
      (heard ? "" : "  <- SILENT")
  );
}

// The continuous voices: each is raised on its own from a standing car
// and the output is read, so a layer that is wired but never sounds is
// visible as a flat line rather than as a plausible gain value.
const HELD = [
  ["engine on song", { speedKmh: 90, rpmFrac: 0.8, throttle: 1, gear: 3 }],
  ["engine on the limiter", { speedKmh: 120, rpmFrac: 1, throttle: 1, gear: 4, limited: 1 }],
  ["tyre roll at 120", { speedKmh: 120, rpmFrac: 0.5, throttle: 0.5, gear: 5 }],
  ["skid", { speedKmh: 80, rpmFrac: 0.7, throttle: 1, skid: 1, driftYaw: 0.6, gear: 2 }],
  ["brakes", { speedKmh: 120, rpmFrac: 0.4, throttle: 0, brake: 1, gear: 4 }],
  ["coasting", { speedKmh: 100, rpmFrac: 0.35, throttle: 0, gear: 5, coast: 1 }],
  ["wheelspin", { speedKmh: 30, rpmFrac: 0.95, throttle: 1, gear: 1, spin: 1, skid: 0.8 }],
  ["boost", { speedKmh: 140, rpmFrac: 0.8, throttle: 1, gear: 4, boost: 1 }],
  ["nitrous", { speedKmh: 150, rpmFrac: 0.85, throttle: 1, gear: 5, nosActive: true }],
  ["rain", { speedKmh: 60, rpmFrac: 0.4, throttle: 0.4, gear: 3, rain: 1, wet: 1 }],
  ["tunnel", { speedKmh: 120, rpmFrac: 0.7, throttle: 1, gear: 4, enclosure: 1 }],
  ["rumble strip", { speedKmh: 90, rpmFrac: 0.6, throttle: 0.7, gear: 3, rumble: 1 }],
  ["rival alongside", { speedKmh: 120, rpmFrac: 0.7, throttle: 1, gear: 4,
    rival: { x: 3, y: 0, z: 0, speedKmh: 118, throttle: 1 } }],
  ["the sea", { speedKmh: 60, rpmFrac: 0.4, throttle: 0.4, gear: 3, seaX: 0, seaZ: 12 }],
];
console.log("\nheld voices, peak at the output\n");
for (const [name, over] of HELD) {
  await page.evaluate(([base, o]) => {
    const s = window.__grnEngine.sound;
    const f = { ...base, ...o };
    for (let i = 0; i < 30; i++) s.update(f);
  }, [FRAME, over]);
  await page.waitForTimeout(220);
  const m = await peakOver(260);
  const heard = m.peak > 0.004;
  if (!heard) silent.push(name);
  console.log(`  ${name.padEnd(18)} peak ${m.peak.toFixed(4)}  rms ${m.rms.toFixed(4)}` +
    (heard ? "" : "  <- SILENT"));
}

// And the files, which are a different failure: a manifest entry whose
// mp3 is missing plays nothing and logs nothing.
const files = await page.evaluate(async () => {
  const man = await (await fetch("/sfx/manifest.json")).json();
  const out = [];
  for (const [id, e] of Object.entries(man)) {
    const r = await fetch(`/sfx/${e.file}`, { method: "HEAD" });
    out.push({ id, file: e.file, ok: r.ok, kb: +(+(r.headers.get("content-length") ?? 0) / 1024).toFixed(1) });
  }
  return out;
});
console.log("\nsampled effects on disk\n");
for (const f of files) {
  if (!f.ok) silent.push(`${f.id} (${f.file})`);
  console.log(`  ${f.id.padEnd(18)} ${f.file.padEnd(16)} ${f.ok ? `${f.kb} kB` : "MISSING"}`);
}

console.log(
  silent.length
    ? `\n${silent.length} of ${SOUNDS.length + HELD.length + files.length} made no sound: ${silent.join(", ")}`
    : `\nall ${SOUNDS.length + HELD.length + files.length} sounds were heard at the output`
);
await browser.close();
process.exit(silent.length ? 1 : 0);
