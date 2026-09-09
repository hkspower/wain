// What every car in the showroom actually does off the line.
//
//   npm run dev
//   npm run check:accel
//
// An instrument. It prints numbers and does not decide what they should
// be — but it is the first thing in this project to ask the question at
// all, and the answer is the point.
//
// WHY IT EXISTS
//
// Every other headline number a car has here is DATA the sim is solved
// to hit. `topSpeedKmh` is a real governor and the thrust curve is bent
// until the car reaches it. `lengthM` is a real length and the shell is
// scaled until it measures that. Acceleration is neither: it is
// `power`, a bare multiplier between 0.98 and 1.85 that appears on no
// card, means nothing on its own, and has never been measured across
// the fleet. A player comparing two cars in the showroom can read what
// each will do at the top end and how hard each stops, and about the
// one thing a drag race is decided by they get a number out of ten.
//
// So: 0-100, 0-200 and the 100-200 roll-on, for all seventeen, from a
// standing start at full throttle with the car as the showroom sells it.
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
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
// Small on purpose: nothing here looks at a picture, and a full-size
// canvas on a software renderer takes the main thread away from the
// thing that is actually being measured.
const page = await browser.newPage({ viewport: { width: 200, height: 150 } });
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
await page.waitForTimeout(1000);

// Every run in one call into the page: seventeen cars is seventeen round
// trips otherwise, and each one queues behind the renderer.
const rows = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const S = window.__grnShowroom;
  const out = [];
  for (const id of S.ids()) {
    const car = S.car(id);
    // The car as the SHOWROOM sells it: its factory build fitted and
    // nothing bought. A fleet comparison run off one save has the fourth
    // car carrying the third's turbo, which is a comparison of the
    // garage rather than of the cars.
    e.tune = S.tuneFor(id);

    const p = e.player;
    p.speed = 0;
    p.s = 0;
    p.lat = 0;
    e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
    // Park the traffic half a lap away.
    //
    // Without this the run is not a standing start, it is a standing
    // start into whatever is in lane. tests/physics.mjs has done this
    // since a bumper mid-measurement was found ruining a reading, and
    // leaving it out here produced two cars with a peak acceleration
    // over a THOUSAND metres per second squared — a hundred g, which is
    // a collision response and not a launch. It also made the Sharq
    // Hatch quicker to 100 than the Salmiya Turbo GT, which is the kind
    // of wrong that looks like a game-balance finding right up until
    // you notice the hundred g next to it.
    for (const t of e.traffic) t.s = e.track.wrap(p.s + e.track.length / 2);
    // Let the springs settle so the first frame is not launching off
    // the last car's load state, then take the speed back off: settling
    // at zero throttle still rolls the car a little.
    for (let i = 0; i < 30; i++) e.update(1 / 60);
    p.speed = 0;
    p.s = 0;
    p.lat = 0;
    for (const t of e.traffic) t.s = e.track.wrap(p.s + e.track.length / 2);

    let t100 = null, t200 = null, spin = 0, peakA = 0, prev = 0, bumped = false;
    const DT = 1 / 120; // finer than a frame: a 0-100 read at 60 Hz is
                        // quantised to 17 ms, and the fleet's spread is
                        // smaller than the errors that introduces
    for (let i = 0; i < 120 * 60; i++) {
      e.setTouchInput({ throttle: 1 });
      e.update(DT);
      const kmh = p.speed * 3.6;
      spin = Math.max(spin, e.wheelspin);
      const a = (p.speed - prev) / DT;
      // A frame that changes speed by more than 30 m/s² is not the
      // engine — nothing here makes three g — so it is a collision, a
      // respawn or a teleport, and the run is void rather than fast.
      if (Math.abs(a) > 30) { bumped = true; break; }
      peakA = Math.max(peakA, a);
      prev = p.speed;
      if (t100 === null && kmh >= 100) t100 = (i + 1) * DT;
      if (t200 === null && kmh >= 200) { t200 = (i + 1) * DT; break; }
      if (t100 !== null && i * DT > 45) break; // never reaching 200
    }
    out.push({
      id,
      name: car.name,
      cls: car.cls,
      power: car.power,
      top: car.topSpeedKmh,
      drive: car.drive ?? "rwd",
      engine: car.engine,
      t100: t100 === null ? null : +t100.toFixed(2),
      t200: t200 === null ? null : +t200.toFixed(2),
      roll: t100 !== null && t200 !== null ? +(t200 - t100).toFixed(2) : null,
      spin: +spin.toFixed(1),
      peakA: +peakA.toFixed(1),
      bumped,
    });
  }
  return out;
});
await browser.close();

const n = (v, w) => (v === null ? "—".padStart(w) : String(v).padStart(w));
console.log("what each car does from a standing start, as the showroom sells it\n");
console.log("  car                 cls        power   top   0-100   0-200  100-200  spin  peak m/s²");
for (const r of rows) {
  console.log(
    `  ${r.name.padEnd(20)}${r.cls.padEnd(10)}${String(r.power).padStart(5)}` +
      `${String(r.top).padStart(6)}${n(r.t100, 8)}${n(r.t200, 8)}${n(r.roll, 9)}` +
      `${String(r.spin).padStart(6)}${String(r.peakA).padStart(10)}` +
      (r.bumped ? "   HIT SOMETHING" : "")
  );
}

// The spread is the thing. A fleet where the slowest and the fastest
// reach 100 within half a second of each other has seventeen cars and
// one acceleration.
const t = rows.map((r) => r.t100).filter((v) => v !== null);
if (t.length) {
  const lo = Math.min(...t), hi = Math.max(...t);
  console.log(
    `\n0-100 spans ${lo.toFixed(2)}s to ${hi.toFixed(2)}s — a ${(hi / lo).toFixed(2)}x spread ` +
      `across a fleet whose power figures span ${(Math.max(...rows.map((r) => r.power)) / Math.min(...rows.map((r) => r.power))).toFixed(2)}x`
  );
}
const none = rows.filter((r) => r.t200 === null).map((r) => r.name);
if (none.length) console.log(`never reached 200 km/h: ${none.join(", ")}`);
