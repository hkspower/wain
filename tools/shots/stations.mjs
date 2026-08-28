// What the four stations actually sound like.
//
//   npm run dev
//   node tools/shots/stations.mjs
//
// tests/radio.mjs checks the station TABLE: four different scales, four
// different tempos, two different drum feels. That is the design, and a
// table agreeing with itself is not evidence that any of it reaches the
// speakers — the synth could ignore the channel entirely and every one
// of those checks would still pass.
//
// So this listens. An analyser on the mix bus, three seconds per
// station, and two numbers out of each:
//
//   centroid  the spectral centre of mass, in Hz — where the weight of
//             the sound sits. A half-time bed with a low pad and a
//             sparse arp is a different number from a 132 bpm one with
//             a bright lead, and no amount of renaming moves it.
//   rms       how loud it is, which separates a station that is playing
//             from one that is silent — the failure this whole feature
//             exists to fix.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("No Chromium found."); process.exit(2); }
const b = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--autoplay-policy=no-user-gesture-required"],
  headless: true,
});
const page = await b.newPage({ viewport: { width: 1000, height: 640 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => { localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3"); });
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(1500);

const rows = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const chans = window.__grnChannels ?? [];
  const bus = e.sound?.mixBus;
  const ctx = e.sound?.audioContext;
  if (!bus || !ctx) return null;
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  bus.connect(an);
  const bins = new Float32Array(an.frequencyBinCount);
  const wave = new Float32Array(an.fftSize);
  const out = [];
  for (const c of chans) {
    e.music?.setChannel(c.id);
    if (!e.music?.enabled) e.music?.toggle();
    await new Promise((r) => setTimeout(r, 700)); // let the bed change over
    let cSum = 0, cW = 0, rms = 0, n = 0;
    const until = performance.now() + 3000;
    while (performance.now() < until) {
      await new Promise((r) => setTimeout(r, 60));
      an.getFloatFrequencyData(bins);
      an.getFloatTimeDomainData(wave);
      let num = 0, den = 0;
      for (let i = 1; i < bins.length; i++) {
        const mag = Math.pow(10, bins[i] / 20);
        const hz = (i * ctx.sampleRate) / an.fftSize;
        num += hz * mag; den += mag;
      }
      if (den > 0) { cSum += num / den; cW++; }
      let s = 0;
      for (let i = 0; i < wave.length; i++) s += wave[i] * wave[i];
      rms += Math.sqrt(s / wave.length); n++;
    }
    const playing = e.music?.nowPlaying?.();
    out.push({
      id: c.id, name: c.name,
      centroid: cW ? Math.round(cSum / cW) : 0,
      rms: n ? +(rms / n).toFixed(5) : 0,
      track: playing ? `${playing.track.name}` : "?",
    });
  }
  return out;
});
await b.close();

if (!rows) { console.log("no mix bus to listen on"); process.exit(1); }
console.log("\nstation                 centroid    rms   playing");
for (const r of rows)
  console.log(`  ${r.id.padEnd(18)} ${String(r.centroid).padStart(7)} Hz ${String(r.rms).padStart(8)}   ${r.track}`);

const fail = [];
for (const r of rows) if (r.rms < 1e-4) fail.push(`${r.id} put nothing on the bus (rms ${r.rms})`);
// Different stations have to land in different places. Compared on the
// spread rather than pairwise: four beds within a few Hz of each other
// would be four names on one sound.
const cs = rows.map((r) => r.centroid);
const spread = Math.max(...cs) - Math.min(...cs);
console.log(`\ncentroid spread ${spread} Hz across ${rows.length} stations`);
if (spread < 150) fail.push(`the stations are ${spread} Hz apart at the centroid — they are one bed with four names`);
console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe dial changes what comes out of the speakers");
