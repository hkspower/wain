// The audio pass, measured. Sound is the easiest system to "add" without
// adding anything — a node that exists but never gains, a panner that
// never moves, a mood that never changes. So every claim here is checked
// against live WebAudio state: gains under the conditions that should
// raise them, panner coordinates that track the world, and impacts whose
// voicing follows severity.
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
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--autoplay-policy=no-user-gesture-required"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });
await page.evaluate(() => window.__grnEngine.sound?.resume());
await page.waitForTimeout(600);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const ctxState = await page.evaluate(() => window.__grnEngine.sound.ctx.state);
console.log(`audio context: ${ctxState}  ${check(ctxState === "running", "audio context never started")}`);

// Drive the sound engine directly with frames, letting the automation
// settle between reads (setTargetAtTime approaches exponentially).
const feed = (frame, settleMs = 300) =>
  page.evaluate(async ([f, ms]) => {
    const e = window.__grnEngine;
    e.setPaused(true);
    const s = e.sound;
    for (let i = 0; i < 12; i++) s.update(f);
    await new Promise((r) => setTimeout(r, ms));
    const g = (n) => +n.gain.value.toFixed(4);
    const pan = (name) => {
      const p = s.panners.get(name);
      if (!p) return null;
      return { x: +p.panner.positionX.value.toFixed(1), z: +p.panner.positionZ.value.toFixed(1) };
    };
    return {
      roll: g(s.rollGain),
      rumble: s.rumbleGain.gain.value,
      wind: g(s.windGain),
      sea: s.seaGain ? g(s.seaGain) : null,
      city: s.cityGain ? g(s.cityGain) : null,
      rival: s.rivalGain ? g(s.rivalGain) : null,
      seaPan: pan("sea"),
      rivalPan: pan("rival"),
      listener: {
        x: +s.ctx.listener.positionX.value.toFixed(1),
        z: +s.ctx.listener.positionZ.value.toFixed(1),
      },
    };
  }, [frame, settleMs]);

const base = {
  speedKmh: 0, throttle: 0, rpmFrac: 0.1, gear: 0, skid: 0,
  listener: { x: 0, y: 2, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 },
};

// --- 1. Tire roll and wind rise with speed ---
const still = await feed({ ...base, speedKmh: 0 });
const fast = await feed({ ...base, speedKmh: 180, throttle: 1, rpmFrac: 0.8, gear: 4 });
console.log(`tire roll    ${still.roll} at rest -> ${fast.roll} at 180 km/h  ` +
  check(fast.roll > still.roll + 0.02, "tire roll does not rise with speed"));
console.log(`wind         ${still.wind} -> ${fast.wind}  ` +
  check(fast.wind > still.wind + 0.02, "wind does not rise with speed"));

// --- 2. Kerb rumble only when running wide ---
const online = await feed({ ...base, speedKmh: 120, rumble: 0 });
const wide = await feed({ ...base, speedKmh: 120, rumble: 1 });
console.log(`kerb rumble  on line ${online.rumble.toFixed(3)} -> over the strip ${wide.rumble.toFixed(3)}  ` +
  check(wide.rumble > online.rumble, "the kerb strip is silent"));

// --- 3. Ambience: sea on the corniche, city inland ---
const coastal = await feed({ ...base, speedKmh: 60, coast: 1, seaX: -55, seaZ: 10 }, 1000);
const inland = await feed({ ...base, speedKmh: 60, coast: 0, seaX: -55, seaZ: 10 }, 1000);
console.log(`ambience     sea ${coastal.sea} coastal vs ${inland.sea} inland; city ${coastal.city} vs ${inland.city}`);
check(coastal.sea > inland.sea + 0.02, "the sea is not louder on the coastal leg");
check(inland.city > coastal.city + 0.01, "the city hum is not louder inland");
check(coastal.seaPan && Math.abs(coastal.seaPan.x + 55) < 8, `the surf is not placed to seaward (${JSON.stringify(coastal.seaPan)})`);

// --- 4. The rival is a positioned source that tracks their car ---
const near = await feed({ ...base, speedKmh: 100,
  rival: { x: 12, y: 0.5, z: -30, speedKmh: 180, throttle: 1 } }, 500);
const gone = await feed({ ...base, speedKmh: 100, rival: null }, 600);
console.log(`rival        gain ${near.rival} at ${JSON.stringify(near.rivalPan)}, ${gone.rival} once they are gone`);
check(near.rival > 0.05, "the rival's engine is silent");
check(near.rivalPan && Math.abs(near.rivalPan.x - 12) < 4 && Math.abs(near.rivalPan.z + 30) < 6,
  `the rival's engine does not sit where their car is (${JSON.stringify(near.rivalPan)})`);
check(gone.rival < near.rival, "the rival is still audible after they are gone");
console.log(`listener     at ${JSON.stringify(near.listener)}  ` +
  check(Math.abs(near.listener.x) < 2 && Math.abs(near.listener.z) < 2, "the listener never moved"));

// --- 5. Rev limiter stutters the engine against the governor ---
const limiter = await page.evaluate(async () => {
  const s = window.__grnEngine.sound;
  const f = { speedKmh: 300, throttle: 1, rpmFrac: 1, gear: 6, skid: 0, limited: 1 };
  const samples = [];
  for (let i = 0; i < 40; i++) {
    s.update(f);
    await new Promise((r) => setTimeout(r, 16));
    samples.push(s.engGain.gain.value);
  }
  const lo = Math.min(...samples), hi = Math.max(...samples);
  return { lo: +lo.toFixed(4), hi: +hi.toFixed(4), swing: +(hi - lo).toFixed(4) };
});
console.log(`rev limiter  engine gain swings ${limiter.lo} - ${limiter.hi}  ` +
  check(limiter.swing > 0.005, "the limiter does not stutter the engine"));

// --- 6. Impacts scale with severity ---
const impacts = await page.evaluate(async () => {
  const s = window.__grnEngine.sound;
  let n = 0;
  const real = s.ctx.createBufferSource.bind(s.ctx);
  s.ctx.createBufferSource = () => { n++; return real(); };
  s.scrape(0.1);
  await new Promise((r) => setTimeout(r, 60));
  const graze = n;
  n = 0;
  s.scrape(1);
  await new Promise((r) => setTimeout(r, 60));
  const crash = n;
  s.ctx.createBufferSource = real;
  return { graze, crash };
});
console.log(`impacts      graze uses ${impacts.graze} noise voices, full hit ${impacts.crash}  ` +
  check(impacts.crash > impacts.graze, "a graze and a full crash sound identical"));

// --- 7. Music intensity is continuous, not just two moods ---
const music = await page.evaluate(async () => {
  const m = window.__grnEngine.music;
  if (!m || !m.synth) return null;
  m.setMood("battle");
  m.setIntensity(0);
  await new Promise((r) => setTimeout(r, 600));
  const calm = m.synth.filter.frequency.value;
  m.setIntensity(1);
  await new Promise((r) => setTimeout(r, 900));
  return { calm: +calm.toFixed(0), hot: +m.synth.filter.frequency.value.toFixed(0) };
});
if (music) {
  console.log(`music        filter ${music.calm} Hz calm -> ${music.hot} Hz desperate  ` +
    check(music.hot > music.calm + 200, "music intensity does not open the mix"));
} else {
  console.log("music        (no synth score active in this run)");
}

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nall audio checks passed");
await browser.close();
process.exit(fail.length ? 1 : 0);
