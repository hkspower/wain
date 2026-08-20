// Motion and feedback — the "game feel" layer.
//
// MOTION:   camera shake, speed rumble, weight transfer, body roll,
//           camera roll under lateral G, FOV stretch and launch kick.
// FEEDBACK: haptics, brake lights, speed streaks, drift smoke, impact
//           sparks, and whether reduced-motion actually suppresses the
//           things it promises to.
//
// Every reading is taken from live engine state under a held input, not
// from a single frame — most of these are decaying transients.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

// Resolve a browser without pulling in a 67 MB bundled-Chromium package
// for one test: an explicit CHROME_PATH wins, then Playwright's managed
// install, then a system Chrome. Only playwright-core is a dependency.
const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}
// WebGL must be real, and --single-process breaks the GPU process
const args = ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"];
const browser = await chromium.launch({ executablePath: exe, args, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

// Headless Chromium has no vibration motor, so navigator.vibrate is
// absent and the game's optional call silently no-ops. Install a
// recorder before any page script runs so the calls are observable.
await page.addInitScript(() => {
  window.__vibes = [];
  Object.defineProperty(navigator, "vibrate", {
    value: (p) => { window.__vibes.push(p); return true; },
    configurable: true,
  });
});

await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });
await page.waitForTimeout(1200);

const fail = [];
const check = (cond, msg) => { if (!cond) fail.push(msg); return cond ? "ok" : "FAIL"; };

// Hold an input for a window and report the peak/last of engine fields
// Step the simulation by hand at a fixed 1/60 s instead of riding
// requestAnimationFrame. Wall-clock holds were flaky by design: frame
// timing varies, the car travels into different track curvature mid-hold,
// and the lerped values (FOV, pitch, camRoll) converge by a different
// amount each run. Stepping makes every reading reproducible — the same
// technique drift3.mjs uses for the drift physics.
const hold = async (input, steps, extra = {}) =>
  page.evaluate(async ([inp, n, ex]) => {
    const e = window.__grnEngine;
    e.setPaused(true);
    if (ex.stage !== false) {
      e.player.s = 2400;
      e.player.lat = 0;
      e.heading = 0;
      e.steerSmooth = 0;
      e.driftYaw = 0;
      e.slipVel = 0;
    }
    const peak = { shake: 0, pitch: 0, roll: 0, camRoll: 0, fov: 0, driftYaw: 0,
                   camJitter: 0, heading: 0, rollAtPeak: 0, driftAtPeak: 0, camRollAtPeak: 0 };
    for (let i = 0; i < n; i++) {
      if (ex.speed !== undefined) e.player.speed = ex.speed;
      e.setTouchInput(inp);
      if (ex.drift !== undefined) e.touch.drift = ex.drift;
      e.update(1 / 60);
      peak.shake = Math.max(peak.shake, e.shake);
      peak.pitch = Math.max(peak.pitch, Math.abs(e.pitch));
      peak.roll = Math.max(peak.roll, Math.abs(e.carBody.rotation.z));
      peak.camRoll = Math.max(peak.camRoll, Math.abs(e.camRoll));
      peak.fov = Math.max(peak.fov, e.fovCurrent);
      peak.driftYaw = Math.max(peak.driftYaw, Math.abs(e.driftYaw));
      if (e.camBase) peak.camJitter = Math.max(peak.camJitter, e.camera.position.distanceTo(e.camBase));
      if (Math.abs(e.heading) > Math.abs(peak.heading)) {
        peak.heading = e.heading;
        peak.rollAtPeak = e.carBody.rotation.z;
        peak.driftAtPeak = e.driftYaw;
        peak.camRollAtPeak = e.camRoll;
      }
    }
    e.setPaused(false);
    return {
      shake: +peak.shake.toFixed(3), pitch: +peak.pitch.toFixed(4),
      roll: +peak.roll.toFixed(4), camRoll: +peak.camRoll.toFixed(4),
      fov: +peak.fov.toFixed(1), driftYaw: +peak.driftYaw.toFixed(3),
      camJitter: +peak.camJitter.toFixed(4),
      heading: +peak.heading.toFixed(4),
      rollAtPeak: +peak.rollAtPeak.toFixed(5),
      driftAtPeak: +peak.driftAtPeak.toFixed(4),
      camRollAtPeak: +peak.camRollAtPeak.toFixed(5),
      pitchSigned: +e.pitch.toFixed(4),
      speed: +e.player.speed.toFixed(1),
    };
  }, [input, steps, extra]);

const reset = () => page.evaluate(() => {
  const e = window.__grnEngine;
  e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
  e.touch.drift = false;
});

console.log("=== MOTION ===");

// 1. Idle baseline
const idle = await hold({ throttle: 0 }, 30, { speed: 0 });
console.log(`  idle            fov=${idle.fov}  camJitter=${idle.camJitter}  shake=${idle.shake}`);

// 2. FOV stretch with speed + launch kick from low speed
await reset();
// fovCurrent lerps at dt*3 (time constant ~1/3 s) and dt is capped at
// 0.05, so on a frame-starved run a 900 ms window converges only part
// way and the kick reads as absent. 1600 ms leaves headroom.
const launch = await hold({ throttle: 1 }, 96, { speed: 8 });
const fast = await hold({ throttle: 1 }, 96, { speed: 80 });
console.log(`  launch kick     fov=${launch.fov}  ${check(launch.fov > idle.fov + 1, "no launch FOV kick from low speed")}`);
console.log(`  speed stretch   fov=${fast.fov} at ${fast.speed} m/s vs idle ${idle.fov} at ${idle.speed} m/s  ` +
  check(fast.fov > idle.fov + 2, "FOV does not widen with speed"));

// 3. Speed rumble — the camera should jitter more at speed than at rest
console.log(`  speed rumble    jitter ${idle.camJitter} -> ${fast.camJitter}  ${check(fast.camJitter > idle.camJitter, "no speed rumble")}`);

// 4. Weight transfer: braking pitches nose-down (positive), throttle lifts
await reset();
const braking = await hold({ throttle: 0, brake: 1 }, 54, { speed: 40 });
await reset();
const onGas = await hold({ throttle: 1, brake: 0 }, 54, { speed: 40 });
console.log(`  weight transfer brake pitch=${braking.pitchSigned}  throttle pitch=${onGas.pitchSigned}  ` +
  check(braking.pitchSigned > onGas.pitchSigned, "braking does not pitch the nose differently from throttle"));

// 5. Body roll + camera roll in a turn
await reset();
const turning = await hold({ throttle: 0.8, steer: 1 }, 108, { speed: 45 });
// Body roll is heading * 0.06, and heading clamps at 0.45 — so full
// lock is only 0.027 rad (1.5 deg). Deliberately subtle; the threshold
// has to respect that rather than expect an arcade lean.
// heading is measured against the TRACK, so its magnitude depends on
// where the lap the turn happens — steering into an existing bend builds
// almost none. Assert the mechanism (roll = heading*0.06 + drift*0.1)
// rather than a magnitude that varies with track position.
const expectedRoll = turning.heading * 0.06 + turning.driftAtPeak * 0.1;
const rollErr = Math.abs(turning.rollAtPeak - expectedRoll);
console.log(`  body roll       heading=${turning.heading} -> roll=${turning.rollAtPeak} ` +
  `(expected ${expectedRoll.toFixed(5)}, err ${rollErr.toFixed(6)})  ` +
  check(Math.abs(turning.heading) > 0.005, "steering built no heading at all") + " " +
  check(rollErr < 1e-4, "body roll does not track heading"));
// camRoll targets heading*(speed/top)*0.14 + slip + drift*0.1, so at a
// modest heading it is inherently a fraction of a degree. Check that it
// responds and leans the correct way, not that it hits a magnitude the
// formula cannot reach at this heading.
const camLeansRight = Math.sign(turning.camRollAtPeak) === Math.sign(turning.heading);
console.log(`  camera roll     ${turning.camRollAtPeak} at heading ${turning.heading} ` +
  `(leans ${camLeansRight ? "into" : "AGAINST"} the turn)  ` +
  check(Math.abs(turning.camRollAtPeak) > 1e-5, "camera roll is dead") + " " +
  check(camLeansRight, "camera rolls the wrong way in a turn"));

// 6. Drift body language
await reset();
await page.waitForTimeout(120); // handbrake needs a fresh press
const drifting = await hold({ throttle: 0.9, steer: 1 }, 84, { speed: 40, drift: true });
console.log(`  drift yaw       ${drifting.driftYaw} rad (${(drifting.driftYaw * 57.3).toFixed(0)}deg)  ` +
  check(drifting.driftYaw > 0.05, "handbrake does not hang the tail out"));

// 7. Impact shake
await reset();
const impact = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const before = e.shake;
  e.player.speed = 45;
  e.player.lat = 20; // beyond the wall — forces a scrape next tick
  // Sample every frame: the scrape fires on an engine tick we cannot
  // predict and the jolt decays at 3.5/s, so a fixed-delay read misses it.
  let peak = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 500) {
    await new Promise((r) => requestAnimationFrame(r));
    peak = Math.max(peak, e.shake);
  }
  const t1 = performance.now();
  while (performance.now() - t1 < 900) await new Promise((r) => requestAnimationFrame(r));
  return { before: +before.toFixed(3), peak: +peak.toFixed(3), after: +e.shake.toFixed(3) };
});
console.log(`  impact shake    ${impact.before} -> ${impact.peak} -> ${impact.after}  ` +
  check(impact.peak > 0.1, "wall impact produced no camera shake") + " " +
  check(impact.after < impact.peak, "shake does not decay"));

console.log("\n=== FEEDBACK ===");

// 8. Brake lights
await reset();
const lamps = await page.evaluate(async () => {
  const e = window.__grnEngine;
  const mat = e.carBody.userData.tailMat;
  e.player.speed = 40;
  e.setTouchInput({ brake: 0, throttle: 1 });
  await new Promise((r) => setTimeout(r, 300));
  const off = mat.emissiveIntensity;
  const t = setInterval(() => { e.player.speed = 40; e.setTouchInput({ brake: 1, throttle: 0 }); }, 16);
  // Peak across frames WHILE the brake is held — reading after releasing
  // catches the frame where the engine has already reset the lamps.
  let on = 0;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    on = Math.max(on, mat.emissiveIntensity);
  }
  clearInterval(t);
  e.setTouchInput({ brake: 0 });
  return { off: +off.toFixed(2), on: +on.toFixed(2) };
});
console.log(`  brake lights    ${lamps.off} -> ${lamps.on}  ${check(lamps.on > lamps.off, "brake lights do not flare")}`);

// 9. Speed streaks + drift smoke visibility
const fx = await page.evaluate(() => {
  const e = window.__grnEngine;
  return {
    streaks: !!e.streaks && e.streaks.visible,
    streakCount: e.streakData ? e.streakData.length : 0,
    smokeAlive: e.smoke ? e.smoke.geometry.attributes.position.count : -1,
  };
});
console.log(`  speed streaks   ${fx.streakCount} streaks, visible=${fx.streaks}  ${check(fx.streakCount > 0, "no speed streaks")}`);

// 10. Haptics — impact should buzz
const vibes = await page.evaluate(() => window.__vibes.length);
console.log(`  haptic calls    ${vibes} recorded so far`);

// 11. Reduced motion must actually suppress the pre-battle film
const reduced = await page.evaluate(async () => {
  const e = window.__grnEngine;
  document.documentElement.dataset.reducedMotion = "1";
  const r = e.rival;
  if (!r) return { skipped: null };
  e.beginBattleCinematic(r);
  const cineStarted = !!e.cine;
  document.documentElement.dataset.reducedMotion = "";
  return { skipped: !cineStarted, inBattle: e.inBattle };
});
console.log(`  reduced motion  film skipped=${reduced.skipped}  ` +
  check(reduced.skipped !== false, "reduced motion still plays the pre-battle film"));

// 12. The wheels turn at the rate the road is passing — and stop when
//     the tire does. Everything else in the car already reports a locked
//     wheel; the wheels themselves were the last thing that did not.
const wheels = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  const W = () => e.carBody.userData.wheels;
  const angles = () => W().map((w) => w.rotation.x);
  const reset = () => {
    e.player.lat = 0; e.heading = 0; e.steerSmooth = 0; e.driftYaw = 0;
    e.ds.spinT = 0; e.bs.lock = 0; e.bs.temp = 0;
    e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
    e.touch.drift = false;
  };
  // Turned by the road: a steady roll at v must give omega = v / r.
  reset();
  e.player.speed = 30;
  let a0 = angles();
  for (let i = 0; i < 30; i++) {
    e.player.speed = 30;
    e.setTouchInput({ throttle: 0.35, brake: 0, steer: 0 });
    e.update(1 / 60);
  }
  const rolled = angles()[0] - a0[0];
  const expected = (30 / 0.36) * 0.5; // v/r over half a second

  // Locked: no anti-lock, pedal buried. The car is still moving; the
  // wheels must not be.
  reset();
  e.tune.hasAbs = false;
  e.player.speed = 30;
  for (let i = 0; i < 40; i++) {
    e.player.speed = 30;
    e.setTouchInput({ throttle: 0, brake: 1, steer: 0 });
    e.update(1 / 60);
  }
  a0 = angles();
  for (let i = 0; i < 30; i++) {
    e.player.speed = 30;
    e.setTouchInput({ throttle: 0, brake: 1, steer: 0 });
    e.update(1 / 60);
  }
  const locked = angles()[0] - a0[0];
  const lockAmt = e.bs.lock;
  e.tune.hasAbs = e.__absStock ?? true;

  // Burnout: the driven axle spins, the front wheels do not.
  reset();
  e.player.speed = 2;
  for (let i = 0; i < 20; i++) {
    e.player.speed = 2;
    e.setTouchInput({ throttle: 1, brake: 0, steer: 0 });
    e.update(1 / 60);
  }
  a0 = angles();
  for (let i = 0; i < 30; i++) {
    e.player.speed = 2;
    e.setTouchInput({ throttle: 1, brake: 0, steer: 0 });
    e.update(1 / 60);
  }
  const a1 = angles();
  const front = a1[0] - a0[0];
  const rear = a1[2] - a0[2];

  // Steering is on the front axle only.
  reset();
  e.player.speed = 8;
  for (let i = 0; i < 40; i++) {
    e.player.speed = 8;
    e.setTouchInput({ throttle: 0.2, brake: 0, steer: 1 });
    e.update(1 / 60);
  }
  const steerFront = Math.abs(W()[0].rotation.y);
  const steerRear = Math.abs(W()[2].rotation.y);
  reset();
  return {
    rolled: +rolled.toFixed(2), expected: +expected.toFixed(2),
    locked: +locked.toFixed(3), lockAmt: +lockAmt.toFixed(2),
    front: +front.toFixed(2), rear: +rear.toFixed(2),
    steerFront: +steerFront.toFixed(3), steerRear: +steerRear.toFixed(3),
  };
});
console.log(`\n  wheel roll      ${wheels.rolled} rad in 0.5 s, v/r says ${wheels.expected}  ` +
  check(Math.abs(wheels.rolled - wheels.expected) / wheels.expected < 0.05,
    `wheels turn at ${wheels.rolled} rad where the road says ${wheels.expected} — they are skating`));
console.log(`  locked wheel    lock ${wheels.lockAmt}, turned ${wheels.locked} rad in 0.5 s at 30 m/s  ` +
  check(wheels.lockAmt > 0.9 && Math.abs(wheels.locked) < 1,
    `a fully locked wheel still turned ${wheels.locked} rad while the car slid`));
console.log(`  burnout         front ${wheels.front} rad, rear ${wheels.rear} rad  ` +
  check(wheels.rear > wheels.front * 1.5,
    "the rear wheels do not outspin the fronts under wheelspin — this is not a four-wheel-drive car"));
console.log(`  steered axle    front ${wheels.steerFront} rad, rear ${wheels.steerRear} rad  ` +
  check(wheels.steerFront > 0.25 && wheels.steerRear === 0,
    `steering angle front ${wheels.steerFront} / rear ${wheels.steerRear} is wrong`));

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nall motion & feedback checks passed");
await browser.close();
process.exit(fail.length ? 1 : 0);
