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

// Shrink the window to a postage stamp before measuring anything.
//
// Nothing here looks at a picture, and the picture is what was eating
// the clock: this page is a game on a software renderer, every frame
// costs the main thread hundreds of milliseconds, and the analyser loop
// runs on that same thread. Two rewrites of the polling made almost no
// difference for exactly that reason — the tool was never the slow part,
// the 900 x 520 canvas behind it was. At 80 x 60 a frame is most of a
// thousand times cheaper and the loop gets the thread back.
//
// The audio graph does not care what size the window is.
await page.setViewportSize({ width: 80, height: 60 });
await page.waitForTimeout(400);

// Before trusting a single zero below, prove the tap can hear anything
// at all. A muted game and a broken analyser are indistinguishable from
// "every sound is silent", and the difference is the whole report — the
// first cut of this tool paused the engine, which drops the master to
// zero, and then reported with perfect consistency that nothing in the
// game made a sound.
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
console.log(`the tap hears a 440 Hz tone put through the mix bus at ${proof}\n`);
if (proof < 0.02) {
  console.log("...which is silence, so every measurement below would be zero for that reason alone");
  await browser.close();
  process.exit(1);
}

// The frame the engine actually takes (SoundFrame, sound.ts). Written
// out in full rather than half-filled: the fields are optional in the
// type but not in the arithmetic, and a frame missing rpmFrac put a NaN
// through setTargetAtTime and took the whole tool down on its first
// call. A partial frame is not a smaller frame, it is a broken one.
const FRAME = {
  speedKmh: 0, throttle: 0, rpmFrac: 0, gear: 1, skid: 0,
  boost: 0, nosActive: false, brake: 0, driftYaw: 0, spin: 0, limited: 0,
  liftRate: 0, rumble: 0, coast: 0, rain: 0, wet: 0, enclosure: 0,
  seaX: 0, seaZ: 400, rival: null, others: [],
  listener: { x: 0, y: 1, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 },
};

// Every sound the engine can make, in the order a player meets them,
// with the window each is measured over.
//
// Written out by hand ON PURPOSE: a list built by reflection off the
// class would grow an entry the day somebody adds a method and would
// never notice one that was deleted, which is the direction that
// matters — a sound that quietly stopped existing.
const SOUNDS = [
  ["revStart", 520],
  ["shift", 320],
  ["backfire", 420],
  ["blowOff", 360],
  ["bump light", 360],
  ["bump hard", 460],
  ["scrape light", 360],
  ["scrape hard", 420],
  ["flashClick", 300],
  ["driftLink 1", 320],
  ["driftLink 5", 320],
  ["battleSting", 520],
  ["winSting", 520],
  ["loseSting", 520],
  ["championFanfare", 760],
  ["horn", 420],
];

// The continuous voices: each raised on its own from a standing car, so
// a layer that is wired but never sounds shows as a flat line rather
// than as a plausible gain value.
const HELD = [
  ["engine on song", { speedKmh: 90, rpmFrac: 0.8, throttle: 1, gear: 3 }],
  ["on the limiter", { speedKmh: 120, rpmFrac: 1, throttle: 1, gear: 4, limited: 1 }],
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

// ONE call into the page for the whole sweep.
//
// This was thirty-odd separate page.evaluate round trips and each one
// cost about twenty-five seconds: the page is running a game, so every
// call queues behind the renderer's frame work, and a tool that fires
// one sound per trip spends its whole budget waiting for a compositor
// it does not need. Sixteen sounds took ten minutes and the run died on
// its own timeout twice, half way through the held voices.
//
// So the loop lives IN the page. One trip out, one back, and the whole
// measurement runs on the page's own clock.
const swept = await page.evaluate(async ([ONESHOTS, HELD_IN, FRAME_IN]) => {
  const s = window.__grnEngine.sound;
  const { a, buf } = window.__tap;
  const idle = () => { for (let i = 0; i < 8; i++) s.update(FRAME_IN); };
  const hold = (over) => {
    const f = { ...FRAME_IN, ...over };
    for (let i = 0; i < 30; i++) s.update(f);
  };
  const peakOver = async (ms) => {
    let peak = 0, rms = 0, n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      a.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        if (v > peak) peak = v;
        sum += buf[i] * buf[i];
      }
      rms += Math.sqrt(sum / buf.length);
      n++;
      await new Promise((r) => setTimeout(r, 4));
    }
    return { peak: +peak.toFixed(4), rms: +(rms / Math.max(1, n)).toFixed(4) };
  };
  const fire = {
    revStart: () => s.revStart(),
    shift: () => s.update({ ...FRAME_IN, speedKmh: 60, rpmFrac: 0.9, throttle: 1, gear: 3 }),
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
  };
  idle();
  const floor = await peakOver(320);
  const shots = [];
  for (const [name, ms] of ONESHOTS) {
    idle();
    fire[name]?.();
    shots.push([name, await peakOver(ms)]);
  }
  const held = [];
  for (const [name, over] of HELD_IN) {
    hold(over);
    await new Promise((r) => setTimeout(r, 220));
    held.push([name, await peakOver(260)]);
  }
  // And the files, which fail differently: a manifest entry whose mp3 is
  // missing plays nothing and logs nothing.
  const man = await (await fetch("/sfx/manifest.json")).json();
  const files = [];
  for (const [id, e] of Object.entries(man)) {
    const r = await fetch(`/sfx/${e.file}`, { method: "HEAD" });
    files.push({ id, file: e.file, ok: r.ok, kb: +(+(r.headers.get("content-length") ?? 0) / 1024).toFixed(1) });
  }
  return { floor, shots, held, files };
}, [SOUNDS, HELD, FRAME]);

const silent = [];
console.log("one-shots, peak amplitude at the output (idle floor subtracted)\n");
console.log(`  ${"idle floor".padEnd(18)} peak ${swept.floor.peak.toFixed(4)}  rms ${swept.floor.rms.toFixed(4)}`);
for (const [name, m] of swept.shots) {
  const over = +(m.peak - swept.floor.peak).toFixed(4);
  const heard = over > 0.002;
  if (!heard) silent.push(name);
  console.log(
    `  ${name.padEnd(18)} peak ${m.peak.toFixed(4)}  +${over.toFixed(4)} over idle  ` +
      (heard ? "" : "  <- SILENT")
  );
}
console.log("\nheld voices, peak at the output\n");
for (const [name, m] of swept.held) {
  const heard = m.peak > 0.004;
  if (!heard) silent.push(name);
  console.log(`  ${name.padEnd(18)} peak ${m.peak.toFixed(4)}  rms ${m.rms.toFixed(4)}` +
    (heard ? "" : "  <- SILENT"));
}
console.log("\nsampled effects on disk\n");
for (const f of swept.files) {
  if (!f.ok) silent.push(`${f.id} (${f.file})`);
  console.log(`  ${f.id.padEnd(18)} ${f.file.padEnd(16)} ${f.ok ? `${f.kb} kB` : "MISSING"}`);
}
const total = swept.shots.length + swept.held.length + swept.files.length;

console.log(
  silent.length
    ? `\n${silent.length} of ${total} made no sound: ${silent.join(", ")}`
    : `\nall ${total} sounds were heard at the output`
);
await browser.close();
process.exit(silent.length ? 1 : 0);
