// Vehicle physics — the tire model, measured, not assumed.
//
// Steps the engine by hand at a fixed 1/60 s (the same technique as
// motion.mjs) and meters what the model actually does: traction-limited
// launches with wheelspin, grip-limited braking in a realistic band,
// the friction circle (steering costs braking and braking costs
// turn-in), power-over drift without the handbrake, and crash severity
// scaling with the speed component into the obstacle.
//
//   npm run dev            # in another shell
//   npm run test:physics
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
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

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const stage = () => page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.player.s = e.track.length * 0.62; // straight, far from the plaza
  e.player.lat = 0;
  e.player.speed = 0;
  e.heading = 0; e.steerSmooth = 0; e.driftYaw = 0; e.slipVel = 0;
  e.shake = 0;
  // Park the traffic half a lap away: a bumper mid-measurement ruins the
  // reading (and found a real bug once — see the collision asymmetry).
  for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length / 2);
  e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
  e.touch.drift = false;
});

// --- 1. Launch: traction-limited, with wheelspin ---
await stage();
const launch = await page.evaluate(() => {
  const e = window.__grnEngine;
  let t100 = null, spinPeak = 0, accel0 = 0;
  let prev = 0;
  for (let i = 0; i < 60 * 12; i++) {
    e.setTouchInput({ throttle: 1 });
    e.update(1 / 60);
    spinPeak = Math.max(spinPeak, e.wheelspin);
    if (i === 3) accel0 = (e.player.speed - prev) * 60;
    prev = e.player.speed;
    if (t100 === null && e.player.speed * 3.6 >= 100) t100 = (i + 1) / 60;
  }
  return { t100, spinPeak: +spinPeak.toFixed(1), accel0: +accel0.toFixed(1), top: +(e.player.speed * 3.6).toFixed(0) };
});
console.log(`launch      0-100 in ${launch.t100}s  initial accel ${launch.accel0} m/s²  wheelspin peak ${launch.spinPeak} m/s²`);
check(launch.t100 > 2.0 && launch.t100 < 6.0, `0-100 of ${launch.t100}s is out of the realistic band`);
check(launch.accel0 < 14, `initial accel ${launch.accel0} m/s² is still teleport-grade`);
check(launch.spinPeak > 0.5, "full-throttle launch produces no wheelspin at all");

// --- 2. Braking: grip-limited, from 130 km/h ---
await stage();
const brake = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.player.speed = 36.1; // 130 km/h
  let dist = 0, frames = 0;
  while (e.player.speed > 0.4 && frames < 60 * 15) {
    e.setTouchInput({ brake: 1, throttle: 0 });
    e.update(1 / 60);
    dist += e.player.speed / 60;
    frames++;
  }
  return { dist: +dist.toFixed(1), secs: +(frames / 60).toFixed(2) };
});
const gAvg = (36.1 * 36.1) / (2 * brake.dist) / 9.81;
console.log(`braking     130-0 in ${brake.dist} m (${brake.secs}s, avg ${gAvg.toFixed(2)}g)`);
check(gAvg > 0.8 && gAvg < 2.4, `average braking ${gAvg.toFixed(2)}g out of band`);

// --- 3. Friction circle: braking while steering stops shorter than nothing, longer than straight ---
await stage();
const circle = await page.evaluate(() => {
  const e = window.__grnEngine;
  const run = (steer) => {
    e.player.speed = 36.1;
    e.heading = 0; e.steerSmooth = 0;
    let dist = 0, frames = 0;
    while (e.player.speed > 0.4 && frames < 60 * 15) {
      e.setTouchInput({ brake: 1, throttle: 0, steer });
      e.update(1 / 60);
      dist += e.player.speed / 60;
      frames++;
      e.player.lat = 0; // keep it off the wall; we only meter the speed
    }
    return dist;
  };
  return { straight: +run(0).toFixed(1), turning: +run(1).toFixed(1) };
});
console.log(`friction    130-0 straight ${circle.straight} m, at full lock ${circle.turning} m  ` +
  check(circle.turning > circle.straight + 1, "steering does not cost any braking distance"));

// --- 4. Understeer: heading builds slower under heavy braking ---
await stage();
const understeer = await page.evaluate(() => {
  const e = window.__grnEngine;
  const build = (brakeIn) => {
    e.player.speed = 30; e.heading = 0; e.steerSmooth = 0; e.player.lat = 0;
    for (let i = 0; i < 30; i++) {
      e.player.speed = 30;
      e.setTouchInput({ steer: 1, brake: brakeIn, throttle: 0 });
      e.update(1 / 60);
      e.player.lat = 0;
    }
    return Math.abs(e.heading);
  };
  return { free: +build(0).toFixed(4), braking: +build(1).toFixed(4) };
});
console.log(`understeer  heading after 0.5s: free ${understeer.free}, braking ${understeer.braking}  ` +
  check(understeer.braking < understeer.free * 0.85, "hard braking does not blunt turn-in"));

// --- 5. Power-over: full throttle + full lock hangs the tail out, no handbrake ---
await stage();
const power = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.player.speed = 24;
  let peak = 0;
  for (let i = 0; i < 90; i++) {
    e.player.speed = Math.max(e.player.speed, 20); // stay in the window
    e.setTouchInput({ throttle: 1, steer: 1 });
    e.update(1 / 60);
    peak = Math.max(peak, Math.abs(e.driftYaw));
    e.player.lat = 0;
  }
  return +peak.toFixed(3);
});
console.log(`power-over  driftYaw ${power} rad with no handbrake  ` +
  check(power > 0.1, "power-over never breaks the rear loose"));
// Handbrake still out-angles it
await stage();
await page.waitForTimeout(150);
const hb = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.player.speed = 40;
  let peak = 0;
  for (let i = 0; i < 90; i++) {
    e.player.speed = Math.max(e.player.speed, 30);
    e.setTouchInput({ throttle: 0.9, steer: 1 });
    e.touch.drift = true;
    e.update(1 / 60);
    peak = Math.max(peak, Math.abs(e.driftYaw));
    e.player.lat = 0;
  }
  e.touch.drift = false;
  return +peak.toFixed(3);
});
console.log(`handbrake   driftYaw ${hb} rad  ` +
  check(hb > power, "handbrake no longer out-angles power-over"));

// --- 6. Crash severity: glancing scrape vs steep plunge into the wall ---
await stage();
const crash = await page.evaluate(() => {
  const e = window.__grnEngine;
  const hit = (heading) => {
    e.player.s = e.track.length * 0.62;
    e.player.speed = 40;
    e.player.lat = 0;
    e.heading = heading; e.steerSmooth = 0; e.slipVel = 0; e.driftYaw = 0;
    e.shake = 0;
    e.scrapeCooldown = 0;
    for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length / 2);
    // Drive until the wall interrupts; pin the heading so caster
    // self-centering can't steer the test away from its own scenario
    let frames = 0;
    while (frames < 240) {
      e.setTouchInput({ throttle: 0.6, steer: 0 });
      e.heading = heading;
      e.update(1 / 60);
      frames++;
      if (e.shake > 0.05) break; // contact registered
    }
    const speedAfter = e.player.speed, shakePeak = e.shake;
    // Let the rebound act: release the pin and give it a third of a second
    for (let i = 0; i < 20; i++) { e.setTouchInput({ throttle: 0 }); e.update(1 / 60); }
    return { speedAfter: +speedAfter.toFixed(1), shake: +shakePeak.toFixed(2), lat: +e.player.lat.toFixed(2) };
  };
  const glance = hit(0.06);
  const plunge = hit(0.42);
  return { glance, plunge };
});
console.log(`crash       glancing: kept ${crash.glance.speedAfter} m/s, shake ${crash.glance.shake}`);
console.log(`            steep:    kept ${crash.plunge.speedAfter} m/s, shake ${crash.plunge.shake}`);
check(crash.plunge.speedAfter < crash.glance.speedAfter - 2, "a steep wall hit costs no more speed than a scrape");
check(crash.plunge.shake > crash.glance.shake + 0.2, "crash shake does not scale with severity");
check(Math.abs(crash.plunge.lat) < 5.7, "no rebound off the barrier");

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nall physics checks passed");
await browser.close();
process.exit(fail.length ? 1 : 0);
