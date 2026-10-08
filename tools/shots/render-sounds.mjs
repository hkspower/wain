// Every synthesised sound in the game, rendered to a WAV.
//
//   npm run dev
//   node tools/shots/render-sounds.mjs                 # -> sound-export/synth/
//   OUT=/tmp/sfx node tools/shots/render-sounds.mjs
//   ONLY="bump hard,horn" node tools/shots/render-sounds.mjs
//
// The game ships six sampled effects (sound-export/sfx) and synthesises
// the other thirty-odd live, in Web Audio. This captures those: the real
// engine, the real graph, tapped after the limiter and the ceiling — what
// actually leaves the machine — through an AudioWorklet, so nothing is
// dropped when the main thread is busy drawing a game on a software
// renderer, which a ScriptProcessor does. The list is tools/shots/
// allsounds.mjs's, kept by hand for the same reason: a sound that quietly
// stopped existing must show up as a missing file, not vanish from a list
// built by reflection.
//
// One-shots are rendered with the engine's own bed turned off (the idle
// hum is the bed bus, the one-shots ride the sfx bus), so a file holds
// the effect and its room tail and not an engine under it. Held voices
// are rendered the other way round: the whole car at that state, which
// is what each of them is, for four seconds. 16-bit stereo at the
// context's own rate.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }
const OUT = process.env.OUT ?? "sound-export/synth";
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",").map((s) => s.trim())) : null;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
page.setDefaultTimeout(600000);
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
if ((await page.evaluate(() => window.__grnEngine.sound.ctx.state)) !== "running") {
  console.error("the audio context is not running; nothing here could be heard");
  process.exit(1);
}
await page.evaluate(() => {
  const s = window.__grnEngine.sound;
  window.__grnEngine.setPaused(true); // the world stops feeding frames...
  s.setPaused(false);                 // ...and the audio is opened again
  const m = window.__grnEngine.music;
  if (m?.enabled) m.toggle();
});
await page.setViewportSize({ width: 80, height: 60 });
await page.waitForTimeout(400);

const FRAME = {
  speedKmh: 0, throttle: 0, rpmFrac: 0, gear: 1, skid: 0,
  boost: 0, brake: 0, driftYaw: 0, spin: 0, limited: 0,
  liftRate: 0, rumble: 0, coast: 0, rain: 0, wet: 0, enclosure: 0,
  seaX: 0, seaZ: 400, rival: null, others: [],
  listener: { x: 0, y: 1, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 },
};
// [name, file, seconds to record, bed]. Tails are long on purpose: the
// room's reverb is part of what a sting is. `bed` marks the one-shots that
// ARE the engine — the rev on start is the bed bus swelling, not a sample
// on the sfx bus — and so render with the bed up, or they render as
// silence. (They did: the first full run's rev-start was a flat line.)
const ONESHOTS = [
  ["revStart", "rev-start", 3.0, true],
  ["shift", "shift", 1.5],
  ["backfire", "backfire", 1.5],
  ["blowOff", "turbo-blowoff", 2.0],
  ["nosKick", "nos-kick", 1.5],
  ["nosRelease", "nos-release", 2.0],
  ["bump light", "bump-light", 1.8],
  ["bump hard", "bump-hard", 2.2],
  ["scrape light", "scrape-light", 1.8],
  ["scrape hard", "scrape-hard", 2.2],
  ["flashClick", "flash-click", 1.2],
  ["driftLink 1", "drift-link-1", 1.5],
  ["driftLink 5", "drift-link-5", 1.5],
  ["battleSting", "battle-sting", 3.0],
  ["winSting", "win-sting", 3.0],
  ["loseSting", "lose-sting", 3.0],
  ["championFanfare", "champion-fanfare", 4.5],
  ["horn", "horn", 1.6],
];
const HELD = [
  ["engine on song", "engine-on-song", { speedKmh: 90, rpmFrac: 0.8, throttle: 1, gear: 3 }],
  ["on the limiter", "engine-limiter", { speedKmh: 120, rpmFrac: 1, throttle: 1, gear: 4, limited: 1 }],
  ["tyre roll at 120", "tyre-roll", { speedKmh: 120, rpmFrac: 0.5, throttle: 0.5, gear: 5 }],
  ["skid", "skid", { speedKmh: 80, rpmFrac: 0.7, throttle: 1, skid: 1, driftYaw: 0.6, gear: 2 }],
  ["brakes", "brakes", { speedKmh: 120, rpmFrac: 0.4, throttle: 0, brake: 1, gear: 4 }],
  ["coasting", "coasting", { speedKmh: 100, rpmFrac: 0.35, throttle: 0, gear: 5, coast: 1 }],
  ["wheelspin", "wheelspin", { speedKmh: 30, rpmFrac: 0.95, throttle: 1, gear: 1, spin: 1, skid: 0.8 }],
  ["boost", "turbo-boost", { speedKmh: 140, rpmFrac: 0.8, throttle: 1, gear: 4, boost: 1 }],
  ["nitrous", "nitrous", { speedKmh: 150, rpmFrac: 0.85, throttle: 1, gear: 5, nosOn: true }],
  ["rain", "rain", { speedKmh: 60, rpmFrac: 0.4, throttle: 0.4, gear: 3, rain: 1, wet: 1 }],
  ["tunnel", "tunnel", { speedKmh: 120, rpmFrac: 0.7, throttle: 1, gear: 4, enclosure: 1 }],
  ["rumble strip", "rumble-strip", { speedKmh: 90, rpmFrac: 0.6, throttle: 0.7, gear: 3, rumble: 1 }],
  ["rival alongside", "rival-alongside", { speedKmh: 120, rpmFrac: 0.7, throttle: 1, gear: 4,
    rival: { x: 3, y: 0, z: 0, speedKmh: 118, throttle: 1 } }],
  ["the sea", "sea", { speedKmh: 60, rpmFrac: 0.4, throttle: 0.4, gear: 3, seaX: 0, seaZ: 12 }],
];
const HELD_SECONDS = 4;

const jobsAll = [
  ...ONESHOTS.map(([name, file, secs, bed]) => ({ kind: "one-shot", name, file, secs, bed: !!bed })),
  ...HELD.map(([name, file, over]) => ({ kind: "held", name, file, secs: HELD_SECONDS, over })),
];
const jobs = jobsAll.filter((j) => !ONLY || ONLY.has(j.name) || ONLY.has(j.file));

// The capture, and the loop, live in the page: one round trip per sound
// is a game's worth of frame work each (see allsounds.mjs).
await page.evaluate(async () => {
  const s = window.__grnEngine.sound;
  const code = `class Cap extends AudioWorkletProcessor{process(i){const c=i[0];if(c&&c[0])this.port.postMessage([c[0].slice(),(c[1]||c[0]).slice(),currentFrame]);return true}}registerProcessor('grn-cap',Cap)`;
  await s.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
  const node = new AudioWorkletNode(s.ctx, "grn-cap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  const mute = s.ctx.createGain();
  mute.gain.value = 0;
  s.outputTap.connect(node);
  node.connect(mute).connect(s.ctx.destination);
  const cap = { rec: null };
  node.port.onmessage = (e) => { if (cap.rec) cap.rec.push(e.data); };
  window.__cap = cap;
});
const rate = await page.evaluate(() => window.__grnEngine.sound.ctx.sampleRate);

const wav = (l, r, sr) => {
  const n = l.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 4, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(n * 4, 40);
  const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  for (let i = 0; i < n; i++) { b.writeInt16LE(q(l[i]), 44 + i * 4); b.writeInt16LE(q(r[i]), 46 + i * 4); }
  return b;
};

const index = [];
for (const j of jobs) {
  const got = await page.evaluate(async ([job, FRAME_IN]) => {
    const s = window.__grnEngine.sound;
    const cap = window.__cap;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // A frame every 16 ms, the way the game feeds it: held voices answer
    // to the frames and die without them.
    let frame = FRAME_IN;
    const pump = setInterval(() => s.update(frame), 16);
    s.setNos(false);
    // Reset to a standing car and let the last sound's tail clear.
    s.setMixLevels(job.kind === "held" || job.bed ? 1 : 0, 1);
    frame = FRAME_IN;
    await wait(1400);
    // Every block is stamped with the audio clock's own frame count. The
    // page is busy and the worklet's messages reach the main thread late,
    // so a block that arrives after the capture "starts" can belong to the
    // second before it — the first version of this took the silence ahead
    // of each sound for the sound. The window is cut by frame number, not
    // by when the messages happened to turn up.
    cap.rec = [];
    const startFrame = Math.ceil(s.ctx.currentTime * s.ctx.sampleRate / 128) * 128;
    if (job.kind === "held") {
      const f = { ...FRAME_IN, ...job.over };
      if ("nosOn" in job.over) s.setNos(!!job.over.nosOn);
      frame = f;
    } else {
      const fire = {
        revStart: () => s.revStart(),
        shift: () => { frame = { ...FRAME_IN, speedKmh: 60, rpmFrac: 0.9, throttle: 1, gear: 3 }; },
        backfire: () => s.backfire(1),
        blowOff: () => s.blowOff(),
        nosKick: () => s.nosKick(),
        nosRelease: () => s.nosRelease(),
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
        horn: () => { s.hornOn(); setTimeout(() => s.hornOff(), 700); },
      }[job.name];
      fire();
    }
    // Wait until a block at or past the end of the window has arrived.
    const want = Math.round(job.secs * s.ctx.sampleRate);
    const endFrame = startFrame + want;
    while (!cap.rec.some((c) => c[2] >= endFrame)) await wait(20);
    const chunks = cap.rec.filter((c) => c[2] >= startFrame && c[2] < endFrame);
    cap.rec = null;
    clearInterval(pump);
    s.setNos(false);
    frame = FRAME_IN;
    // Back to a standing car for whatever comes next.
    for (let i = 0; i < 8; i++) s.update(FRAME_IN);
    chunks.sort((x, y) => x[2] - y[2]);
    let total = 0;
    for (const [l] of chunks) total += l.length;
    const n = Math.min(total, want);
    const L = new Float32Array(n), R = new Float32Array(n);
    let o = 0;
    for (const [l, r] of chunks) {
      const k = Math.min(l.length, n - o);
      if (k <= 0) break;
      L.set(l.subarray(0, k), o); R.set(r.subarray(0, k), o); o += k;
    }
    // Int16 to base64 here, in 32 kB slices: String.fromCharCode.apply has a limit.
    const enc = (a) => {
      const u = new Uint8Array(a.buffer);
      let out = "";
      for (let i = 0; i < u.length; i += 0x8000) out += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return btoa(out);
    };
    return { l: enc(L), r: enc(R), n };
  }, [j, FRAME]);
  const L = new Float32Array(Buffer.from(got.l, "base64").buffer.slice(0));
  const R = new Float32Array(Buffer.from(got.r, "base64").buffer.slice(0));
  let peak = 0, sum = 0;
  for (let i = 0; i < L.length; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); sum += L[i] * L[i] + R[i] * R[i]; }
  const rms = Math.sqrt(sum / Math.max(1, 2 * L.length));
  writeFileSync(join(OUT, `${j.file}.wav`), wav(L, R, rate));
  const row = { file: `${j.file}.wav`, name: j.name, kind: j.kind, seconds: +(L.length / rate).toFixed(2), peak: +peak.toFixed(4), rms: +rms.toFixed(4) };
  index.push(row);
  console.log(`${row.kind.padEnd(9)} ${j.name.padEnd(18)} ${String(row.seconds).padStart(5)} s  peak ${row.peak.toFixed(3)}  rms ${row.rms.toFixed(4)}${peak < 0.004 ? "   <- SILENT" : ""}`);
}
// A partial run (ONLY=...) replaces its own entries in the index and keeps
// the rest, so re-rendering one sound does not leave an index of one.
let files = index;
const indexPath = join(OUT, "index.json");
if (ONLY && existsSync(indexPath)) {
  const prev = JSON.parse(readFileSync(indexPath, "utf8")).files ?? [];
  const done = new Set(index.map((r) => r.file));
  files = [...prev.filter((r) => !done.has(r.file)), ...index];
  const order = new Map(jobsAll.map((j, i) => [`${j.file}.wav`, i]));
  files.sort((a, b) => (order.get(a.file) ?? 1e9) - (order.get(b.file) ?? 1e9));
}
writeFileSync(indexPath, JSON.stringify({ sampleRate: rate, files }, null, 2) + "\n");
await browser.close();
process.exit(index.some((r) => r.peak < 0.004) ? 1 : 0);
