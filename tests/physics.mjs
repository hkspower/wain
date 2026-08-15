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
  // The drift and brake solvers carry state between frames — a slide's
  // multiplier, a spin's clock, and disc temperature that survives long
  // after the stop that made it. Left alone it leaks into the next
  // section and the reading is of the previous test, not this one.
  e.ds.run = 0; e.ds.chain = 1; e.ds.spinT = 0;
  e.ds.sinceSlide = 99; e.ds.lastSide = 0; e.ds.lastSteer = 0; e.ds.feintT = 0;
  e.bs.lock = 0; e.bs.temp = 0; e.bs.pulse = 0;
  // Sections that switch the anti-lock off must not leave it off.
  if (e.__absStock === undefined) e.__absStock = e.tune.hasAbs;
  e.tune.hasAbs = e.__absStock;
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
  let spun = false;
  for (let i = 0; i < 90; i++) {
    e.player.speed = Math.max(e.player.speed, 30);
    // Driven, not pinned. Full lock into the slide with the throttle
    // buried is how you spin it (section 11); a held drift is lock eased
    // back as the angle arrives. Pinning it here measured the peak of a
    // spin and called it a drift angle.
    const hold = Math.max(-1, Math.min(1, 1 - e.driftYaw * 1.9));
    e.setTouchInput({ throttle: 0.9, steer: hold });
    e.touch.drift = true;
    e.update(1 / 60);
    if (e.ds.spinT > 0) spun = true;
    peak = Math.max(peak, Math.abs(e.driftYaw));
    e.player.lat = 0;
  }
  e.touch.drift = false;
  return { peak: +peak.toFixed(3), spun };
});
console.log(`handbrake   driftYaw ${hb.peak} rad held on the lock  ` +
  check(hb.peak > power, "handbrake no longer out-angles power-over"));
check(!hb.spun, "a handbrake slide driven on measured lock still spins — the drift cannot be held");

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

// --- 8. Lock-up: a sliding tire stops WORSE than one on the edge ---
// The whole reason threshold braking exists. If burying the pedal were
// also the fastest way to stop, the brake would have one useful position
// and no technique attached to it.
await stage();
const lockup = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const stop = (pedal, abs) => {
    e.tune.hasAbs = abs;
    e.bs.lock = 0; e.bs.temp = 0;
    e.player.speed = 36.1;
    e.heading = 0; e.steerSmooth = 0; e.driftYaw = 0;
    let dist = 0, frames = 0, peakLock = 0;
    while (e.player.speed > 0.4 && frames < 60 * 15) {
      e.setTouchInput({ brake: pedal, throttle: 0, steer: 0 });
      e.update(1 / 60);
      peakLock = Math.max(peakLock, e.bs.lock);
      dist += e.player.speed / 60;
      frames++;
      e.player.lat = 0;
    }
    return { dist: +dist.toFixed(1), lock: +peakLock.toFixed(2) };
  };
  // No anti-lock: threshold (just under the limit) against buried.
  const threshold = stop(0.62, false);
  const buried = stop(1, false);
  const withAbs = stop(1, true);
  e.tune.hasAbs = e.__absStock;
  return { threshold, buried, withAbs };
});
console.log(`lock-up     threshold ${lockup.threshold.dist} m (lock ${lockup.threshold.lock}), ` +
  `buried ${lockup.buried.dist} m (lock ${lockup.buried.lock}), ABS ${lockup.withAbs.dist} m`);
check(lockup.threshold.lock < 0.1, "threshold braking locks the wheels anyway");
check(lockup.buried.lock > 0.9, "burying the pedal never locks anything");
check(lockup.buried.dist > lockup.threshold.dist + 2,
  "locking the wheels costs no distance — there is no reason to modulate");
check(lockup.withAbs.dist < lockup.buried.dist - 2,
  "anti-lock buys back none of the distance a locked wheel throws away");
check(lockup.withAbs.lock < 0.1, "ABS lets the wheels lock");

// --- 9. Locked fronts do not steer ---
await stage();
const lockSteer = await page.evaluate(() => {
  const e = window.__grnEngine;
  const build = (abs) => {
    e.tune.hasAbs = abs;
    e.bs.lock = 0; e.bs.temp = 0;
    e.player.speed = 30; e.heading = 0; e.steerSmooth = 0; e.driftYaw = 0;
    e.ds.lastSteer = 0; e.ds.feintT = 0; // see the trail-brake note below
    for (let i = 0; i < 40; i++) {
      e.player.speed = 30;
      e.setTouchInput({ steer: 1, brake: 1, throttle: 0 });
      e.update(1 / 60);
      e.player.lat = 0;
    }
    return Math.abs(e.heading);
  };
  const locked = +build(false).toFixed(4);
  const abs = +build(true).toFixed(4);
  e.tune.hasAbs = e.__absStock;
  return { locked, abs };
});
console.log(`lock steer  heading under ABS ${lockSteer.abs}, on locked wheels ${lockSteer.locked}  ` +
  check(lockSteer.locked < lockSteer.abs * 0.6,
    "locked wheels steer as well as rolling ones — nothing is lost by standing on it"));

// --- 10. Fade: discs that have absorbed a night's braking stop giving ---
await stage();
const fade = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.tune.hasAbs = true;
  const cold = e.bs.temp;
  // Ten hard stops back to back, with no time at speed to cool off.
  for (let n = 0; n < 10; n++) {
    e.player.speed = 40;
    for (let i = 0; i < 90 && e.player.speed > 6; i++) {
      e.setTouchInput({ brake: 1, throttle: 0, steer: 0 });
      e.update(1 / 60);
      e.player.lat = 0;
    }
  }
  const hot = e.bs.temp;
  const hotFade = e.brakeOut.fade;
  // Now let it cool at speed with the pedal up.
  for (let i = 0; i < 60 * 12; i++) {
    e.player.speed = 60;
    e.setTouchInput({ brake: 0, throttle: 1, steer: 0 });
    e.update(1 / 60);
    e.player.lat = 0;
  }
  return {
    cold: Math.round(cold),
    hot: Math.round(hot),
    fade: +hotFade.toFixed(3),
    cooled: Math.round(e.bs.temp),
  };
});
console.log(`fade        discs ${fade.cold}°C -> ${fade.hot}°C after ten stops (${Math.round(fade.fade * 100)}% force lost), ` +
  `${fade.cooled}°C after a cooling lap`);
check(fade.hot > 200, "ten consecutive stops put almost no heat into the brakes");
check(fade.fade > 0.02, "brakes that hot lose no force at all");
check(fade.cooled < fade.hot * 0.5, "the discs never cool down, so fade is permanent");

// --- 11. Spin: an uncorrected slide runs away; counter-steer saves it ---
// The instability IS the drift. A slide that cannot be lost is not a
// technique, and one that cannot be caught is not fair.
await stage();
const spin = await page.evaluate(() => {
  const e = window.__grnEngine;
  // Get properly sideways first, the way a player would.
  const enter = () => {
    e.player.speed = 30; e.heading = 0; e.steerSmooth = 0; e.driftYaw = 0;
    e.ds.spinT = 0; e.ds.chain = 1; e.ds.run = 0;
    e.ds.lastSteer = 0; e.ds.feintT = 0;
    e.touch.drift = true;
    for (let i = 0; i < 45; i++) {
      e.player.speed = 30;
      e.setTouchInput({ steer: 1, throttle: 1, brake: 0 });
      e.update(1 / 60);
      e.player.lat = 0;
    }
    return e.driftYaw;
  };
  // Hold it wrong: lock still into the slide, throttle still buried.
  const entered = enter();
  let spun = false;
  for (let i = 0; i < 180 && !spun; i++) {
    e.player.speed = 30;
    e.setTouchInput({ steer: 1, throttle: 1, brake: 0 });
    e.update(1 / 60);
    e.player.lat = 0;
    if (e.ds.spinT > 0) spun = true;
  }
  const heldWrong = { spun, angle: +e.driftYaw.toFixed(3) };

  // Same entry, but caught the way a driver catches one: opposite lock
  // proportional to the angle, unwound as the car comes back. Pinning
  // full opposite lock and leaving it there is not catching a slide, it
  // is starting the next one — see the tank-slapper check below.
  e.ds.spinT = 0;
  enter();
  let caught = true;
  let minAngle = 9;
  for (let i = 0; i < 180; i++) {
    e.player.speed = 30;
    const correct = Math.max(-1, Math.min(1, -e.driftYaw * 2.4));
    e.setTouchInput({ steer: correct, throttle: 0.4, brake: 0 });
    e.update(1 / 60);
    e.player.lat = 0;
    if (e.ds.spinT > 0) caught = false;
    minAngle = Math.min(minAngle, Math.abs(e.driftYaw));
  }

  // And the over-correction: full opposite lock held past the catch
  // whips the car the other way and loses it there.
  e.ds.spinT = 0;
  enter();
  let slapper = false;
  for (let i = 0; i < 180 && !slapper; i++) {
    e.player.speed = 30;
    e.setTouchInput({ steer: -1, throttle: 0.4, brake: 0 });
    e.update(1 / 60);
    e.player.lat = 0;
    if (e.ds.spinT > 0) slapper = true;
  }
  e.touch.drift = false;
  return {
    entered: +entered.toFixed(3), heldWrong, caught,
    minAngle: +minAngle.toFixed(3), slapper,
  };
});
console.log(`spin        entered at ${spin.entered} rad; held wrong -> spun ${spin.heldWrong.spun}; ` +
  `caught on measured lock -> survived ${spin.caught} (down to ${spin.minAngle} rad); ` +
  `lock pinned -> over-corrected ${spin.slapper}`);
check(Math.abs(spin.entered) > 0.3, "the handbrake entry never got the car sideways to begin with");
check(spin.heldWrong.spun, "steering into a slide with the throttle buried never loses it");
check(spin.caught, "opposite lock cannot save a slide — the spin is unavoidable");
check(spin.minAngle < 0.15, "counter-steer never brings the angle back down");
check(spin.slapper, "full opposite lock pinned forever never over-corrects — there is no way to catch it wrong");

// --- 12. Chain: linking slides steps the multiplier, a spin takes it ---
await stage();
const chain = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.touch.drift = true;
  const hold = (steer, frames) => {
    for (let i = 0; i < frames; i++) {
      e.player.speed = 30;
      e.setTouchInput({ steer, throttle: 0.8, brake: 0 });
      e.update(1 / 60);
      e.player.lat = 0;
    }
  };
  e.player.speed = 30; e.heading = 0; e.steerSmooth = 0; e.driftYaw = 0;
  hold(1, 40);
  const first = e.ds.chain;
  hold(-1, 40);   // whip it the other way: that is a link
  const linked = e.ds.chain;
  hold(1, 40);    // and back again
  const twice = e.ds.chain;
  const scored = e.ds.run;
  // Now lose it, which should cost the multiplier and the run.
  e.ds.spinT = 0;
  e.driftYaw = 1.9;
  e.update(1 / 60);
  e.touch.drift = false;
  return {
    first, linked, twice,
    scored: Math.round(scored),
    afterSpin: e.ds.chain,
    runAfterSpin: Math.round(e.ds.run),
  };
});
console.log(`chain       ×${chain.first} -> ×${chain.linked} -> ×${chain.twice} over two transitions, ` +
  `${chain.scored} pts; after a spin ×${chain.afterSpin} and ${chain.runAfterSpin} pts`);
check(chain.linked > chain.first, "reversing a live slide does not link — there is no chain");
check(chain.twice > chain.linked, "the chain stops counting after one link");
check(chain.scored > 0, "a linked drift scores nothing");
check(chain.afterSpin === 1, "a spin does not reset the multiplier");
check(chain.runAfterSpin === 0, "a spin does not cost the unbanked points");

// --- 13. Trail-brake entry: a slide with no handbrake and no throttle ---
await stage();
const trail = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.touch.drift = false;
  const run = (pedal) => {
    e.player.speed = 32; e.heading = 0; e.steerSmooth = 0; e.driftYaw = 0;
    e.ds.spinT = 0; e.bs.lock = 0; e.bs.temp = 0;
    // steerSmooth is being forced back to zero here, and the feint
    // detector reads a rate of change. Without clearing its memory of
    // last frame's lock, the reset itself looks like a hard reversal and
    // every run after the first got a free flick entry — which is how
    // this test first reported that coasting drifts harder than braking.
    e.ds.lastSteer = 0; e.ds.feintT = 0;
    let peak = 0;
    for (let i = 0; i < 70; i++) {
      e.player.speed = 32;
      e.setTouchInput({ steer: 0.7, brake: pedal, throttle: 0 });
      e.update(1 / 60);
      e.player.lat = 0;
      peak = Math.max(peak, Math.abs(e.driftYaw));
    }
    return +peak.toFixed(3);
  };
  return { trailing: run(0.35), buried: run(1), coasting: run(0) };
});
console.log(`trail brake angle from a trailed pedal ${trail.trailing} rad, ` +
  `buried ${trail.buried} rad, coasting ${trail.coasting} rad`);
check(trail.trailing > 0.12, "trailing the brake into a corner rotates nothing");
check(trail.trailing > trail.buried + 0.05,
  "standing on the brakes rotates the car as well as trailing them — trail braking is not a technique");
check(trail.trailing > trail.coasting + 0.05, "the brake contributes nothing over just coasting in");

// --- 14. Feint: a flick away loads the car, the flick back sends it ---
await stage();
const feint = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.touch.drift = false;
  const run = (flick) => {
    e.player.speed = 32; e.heading = 0; e.steerSmooth = 0; e.driftYaw = 0;
    e.ds.spinT = 0; e.ds.lastSteer = 0; e.ds.feintT = 0;
    if (flick) {
      // Load it hard the wrong way...
      for (let i = 0; i < 18; i++) {
        e.player.speed = 32;
        e.setTouchInput({ steer: -1, throttle: 0.3, brake: 0 });
        e.update(1 / 60);
        e.player.lat = 0;
      }
    }
    // ...then snap back. Without the load this is just turning in.
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      e.player.speed = 32;
      e.setTouchInput({ steer: 1, throttle: 0.3, brake: 0 });
      e.update(1 / 60);
      e.player.lat = 0;
      peak = Math.max(peak, Math.abs(e.driftYaw));
    }
    return +peak.toFixed(3);
  };
  return { flicked: run(true), plain: run(false) };
});
console.log(`feint       angle after a flick ${feint.flicked} rad, from a plain turn-in ${feint.plain} rad  ` +
  check(feint.flicked > feint.plain + 0.08,
    "a flick sends the tail no further than simply turning in — the feint does nothing"));

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nall physics checks passed");
await browser.close();
process.exit(fail.length ? 1 : 0);
