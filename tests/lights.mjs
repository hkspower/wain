// Where the headlights actually point.
//
//   npm run dev
//   node tests/lights.mjs
//
// A headlight is the easiest thing in a driving game to get subtly and
// permanently wrong, because it looks fine in every screenshot taken
// while going straight. The failure only shows when the car is doing
// something: braking, cornering, sideways. In this game the lights, the
// beams and the pool all hung off the ROAD frame — the node that sits on
// the track and looks down the tangent — so the answer to "where do the
// headlights point" was "down the road", always, no matter what the car
// was doing. Forty degrees of drift and they still lit the lane ahead.
//
// So every claim here is a world-space measurement taken off the live
// scene graph with the car put into a state:
//
//   bolted on   the beam's world direction follows the BODY, and the
//               body's yaw includes how far the tail is out
//   dive        brake and the lit patch pulls in toward the bumper
//   swivel      steer and the aim leads into the corner
//   at the lamp the source sits where that car's lamps are, not at an
//               average guess a metre above them
//   flat        and the pool stays on the asphalt through all of it
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
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
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
await page.waitForTimeout(3500);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

/**
 * Put the car in a state, settle it, and read the lamps in world space.
 * `hold` is applied every frame — the sim decays drift and pitch, so a
 * value set once before the loop is gone by the time it is measured.
 */
const probe = (state) =>
  page.evaluate(async (st) => {
    const THREE = window.__grnThree;
    const e = window.__grnEngine;
    e.setPaused(true);
    e.timeHours = 22.5;
    e.world.setTimeOfDay(22.5);
    e.applyDaylight();
    const park = () => {
      const away = e.track.wrap(2400 + e.track.length / 2);
      for (const t of e.traffic) t.s = away;
      if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
      e.player.s = 2400;
      e.player.lat = 0;
    };
    for (let i = 0; i < 40; i++) {
      park();
      e.player.speed = st.speed;
      if (st.driftYaw !== undefined) e.driftYaw = st.driftYaw;
      if (st.heading !== undefined) e.heading = st.heading;
      e.setTouchInput({
        throttle: st.throttle ?? 0,
        brake: st.brake ?? 0,
        steer: st.steer ?? 0,
      });
      e.update(1 / 60);
      if (st.driftYaw !== undefined) e.driftYaw = st.driftYaw;
      if (st.heading !== undefined) e.heading = st.heading;
    }
    e.scene.updateMatrixWorld(true);

    const wp = (o) => o.getWorldPosition(new THREE.Vector3());
    const src = wp(e.headlight);
    const tgt = wp(e.headlight.target);
    const dir = tgt.clone().sub(src).normalize();
    // Where the beam axis meets the road.
    const t = dir.y < -1e-4 ? -src.y / dir.y : Infinity;
    const hit = Number.isFinite(t) ? src.clone().addScaledVector(dir, t) : null;

    const car = wp(e.playerMesh);
    // The road's own forward, for comparison.
    const tan = e.track.tangentAt(e.player.s, new THREE.Vector3());
    // The body's forward: down carBody's local -Z, which is how the
    // shell is modelled.
    const bodyFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
      e.carBody.getWorldQuaternion(new THREE.Quaternion())
    );

    // The pool's world normal — it has to still be pointing at the sky.
    // A PlaneGeometry lies in its own XY plane and faces local +Z, NOT
    // +Y. Reading +Y here reported the flat-on-the-road pool as ninety
    // degrees off flat, which is the instrument being wrong about a
    // convention rather than the pool being wrong about anything.
    const poolUp = new THREE.Vector3(0, 0, 1).applyQuaternion(
      e.pool.getWorldQuaternion(new THREE.Quaternion())
    );

    const flat = (v) => new THREE.Vector3(v.x, 0, v.z).normalize();
    const signedAngle = (a, b) => {
      const fa = flat(a), fb = flat(b);
      return Math.atan2(fa.x * fb.z - fa.z * fb.x, fa.dot(fb));
    };

    const lamps = (e.carBody.userData.lampPositions ?? []).map((p) => ({
      x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
    }));

    return {
      srcY: +src.y.toFixed(3),
      srcLocalY: +e.headlight.position.y.toFixed(3),
      srcLocalX: +e.headlight.position.x.toFixed(3),
      reach: hit ? +hit.clone().sub(car).length().toFixed(2) : null,
      // Aim against the road, and aim against the body. The first should
      // move with the car; the second should not.
      vsRoad: +(signedAngle(dir, tan) * (180 / Math.PI)).toFixed(2),
      vsBody: +(signedAngle(dir, bodyFwd) * (180 / Math.PI)).toFixed(2),
      poolTilt: +(Math.acos(Math.min(1, poolUp.y)) * (180 / Math.PI)).toFixed(2),
      poolZ: +e.pool.position.z.toFixed(2),
      lamps,
      pitch: +e.pitch.toFixed(4),
    };
  }, state);

// --- 1. Bolted to the body, not to the road -------------------------
const straight = await probe({ speed: 30 });
const sideways = await probe({ speed: 30, driftYaw: 0.5 });
console.log(
  `drift     ${check(
    Math.abs(sideways.vsRoad - straight.vsRoad) > 20,
    `the tail is 28.6 degrees out and the beam moved ${(sideways.vsRoad - straight.vsRoad).toFixed(1)} ` +
      `degrees against the road — the lamps are not on the car`
  )}  half a radian of drift swings the beam ` +
    `${(sideways.vsRoad - straight.vsRoad).toFixed(1)} deg against the road`
);
// And the other half of the same fact: against the BODY it has not moved.
console.log(
  `           ${check(
    Math.abs(sideways.vsBody - straight.vsBody) < 3,
    `the beam moved ${(sideways.vsBody - straight.vsBody).toFixed(1)} deg relative to the shell it is bolted to`
  )}  and ${Math.abs(sideways.vsBody - straight.vsBody).toFixed(1)} deg against the body`
);

// --- 2. Dive -------------------------------------------------------
const braking = await probe({ speed: 40, brake: 1 });
const power = await probe({ speed: 40, throttle: 1 });
console.log(
  `dive      ${check(
    braking.reach !== null && power.reach !== null && braking.reach < power.reach - 1.5,
    `the beam reaches ${braking.reach} m under braking and ${power.reach} m under power — the nose does not dive`
  )}  ${braking.reach} m braking vs ${power.reach} m on the throttle ` +
    `(pitch ${braking.pitch} vs ${power.pitch})`
);
console.log(
  `pool      ${check(
    braking.poolZ < power.poolZ - 0.5,
    `the lit patch sits at ${braking.poolZ} m braking and ${power.poolZ} m on power — it does not follow the aim`
  )}  patch pulls in to ${braking.poolZ} m under braking, out to ${power.poolZ} m on power`
);

// --- 3. Swivel ------------------------------------------------------
const left = await probe({ speed: 30, steer: -1 });
const right = await probe({ speed: 30, steer: 1 });
const swing = Math.abs(right.vsBody - left.vsBody);
console.log(
  `swivel    ${check(
    swing > 6 && swing < 40,
    swing <= 6
      ? `full lock either way swings the aim ${swing.toFixed(1)} deg — the lamps do not steer`
      : `the aim swings ${swing.toFixed(1)} deg lock to lock, which is a searchlight, not a headlamp`
  )}  ${swing.toFixed(1)} deg lock to lock, leading into the corner`
);

// --- 4. The source is at the lamp -----------------------------------
// Not an average guess. cars.ts records where it built this shell's
// lamps; the light has to be at one of them.
const lampsOnCar = straight.lamps;
const nearest = lampsOnCar.length
  ? Math.min(
      ...lampsOnCar.map((l) =>
        Math.hypot(l.x - straight.srcLocalX, l.y - straight.srcLocalY)
      )
    )
  : Infinity;
console.log(
  `at lamp   ${check(
    lampsOnCar.length > 0 && nearest < 0.12,
    lampsOnCar.length === 0
      ? "the car records no lamp positions at all"
      : `the source sits ${nearest.toFixed(2)} m from the nearest lamp on the shell`
  )}  source at (${straight.srcLocalX}, ${straight.srcLocalY}), ` +
    `${lampsOnCar.length} lamps recorded, nearest ${nearest.toFixed(3)} m`
);
console.log(
  `height    ${check(
    straight.srcY > 0.3 && straight.srcY < 0.95,
    `the beam starts ${straight.srcY} m above the road — that is not where a headlamp is`
  )}  ${straight.srcY} m above the asphalt`
);

// --- 5. And the pool is still on the asphalt ------------------------
// The pool follows the aim, which is the point. What it must NOT do is
// inherit the body's roll and pitch — a lit patch tilted into the road
// is a poster hanging off the bumper.
const worstTilt = Math.max(
  straight.poolTilt, sideways.poolTilt, braking.poolTilt, power.poolTilt,
  left.poolTilt, right.poolTilt
);
console.log(
  `flat      ${check(
    worstTilt < 1,
    `the lit patch tilts ${worstTilt} deg off the road — it has been parented to the car body`
  )}  never more than ${worstTilt} deg off flat, through drift, dive and lock`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe headlights are on the car.");
