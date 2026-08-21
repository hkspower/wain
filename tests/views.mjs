// Where the camera is looking from.
//
//   npm run dev
//   node tests/views.mjs
//
// There was one camera and it never changed. It is a good one — anchored
// to the ROAD rather than to the car, so when the tail steps out the shot
// stays behind the trajectory and you watch the car rotate inside the
// frame, which is the whole reason a drift reads at all — but it is one
// shot, and the difference between a chase camera and an in-car camera is
// not where it is, it is what it is bolted to.
//
// That is the thing worth measuring, because it is the thing that is easy
// to get wrong and impossible to see in a still:
//
//   placed    each view sits where its name says: behind and high, tucked
//             in, on the wing, at the nose, behind the screen
//   bolted    an in-car view yaws with the BODY. Put the car sideways and
//             the bonnet cam looks where the car points; the chase cam
//             keeps looking down the road
//   level     ...and the chase cam keeps the horizon level while the
//             in-car ones lean with the shell
//   ring      C walks the ring and comes back round
//   head      the cockpit hides the driver's head, and putting it back is
//             not something the next view has to remember to do
//   still     changing the shot never moves the car
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
await page.waitForTimeout(2000);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// Every view, measured in the CAR'S own frame: how far behind or ahead of
// the car's centre the camera sits, how high, and which way it faces
// relative to the body.
const shots = await page.evaluate(() => {
  const e = window.__grnEngine;
  const THREE = window.__grnThree;
  const out = [];
  const pos = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const carFwd = new THREE.Vector3();
  const roadFwd = new THREE.Vector3();
  for (const yaw of [0, 0.9]) {
    for (const v of ["chase", "close", "bonnet", "bumper", "cockpit"]) {
      e.setPaused(true);
      e.setView(v);
      e.player.s = 2400;
      e.player.lat = 0;
      e.player.speed = 100 / 3.6;
      e.heading = 0;
      e.steerSmooth = 0;
      e.slipVel = 0;
      Object.assign(e.ds, window.__grnDriftModel.newDriftState());
      // A big body angle, held: this is the frame where a bolted-on
      // camera and a road-mounted one disagree, and nothing else is.
      for (let i = 0; i < 25; i++) {
        e.ds.angle = yaw;
        e.setTouchInput({ steer: 0, throttle: 0.5, brake: 0 });
        e.update(1 / 60);
        e.player.lat = 0;
        e.player.speed = 100 / 3.6;
      }
      e.ds.angle = yaw;
      e.update(1 / 60);
      e.carBody.updateMatrixWorld(true);
      // The camera, in the car's own axes.
      pos.copy(e.camera.position);
      e.playerMesh.worldToLocal(pos);
      fwd.set(0, 0, -1).applyQuaternion(e.camera.quaternion);
      right.set(1, 0, 0).applyQuaternion(e.camera.quaternion);
      carFwd.set(0, 0, 1).applyQuaternion(e.carBody.getWorldQuaternion(new THREE.Quaternion()));
      e.track.tangentAt(e.player.s, roadFwd);
      out.push({
        yaw,
        view: v,
        // Behind the car is negative z in the car's own frame.
        z: +pos.z.toFixed(2),
        y: +pos.y.toFixed(2),
        // How closely the shot is aimed along the BODY versus along the
        // ROAD. One of these is 1 and the other is cos(yaw).
        alongCar: +fwd.dot(carFwd).toFixed(3),
        alongRoad: +fwd.dot(roadFwd).toFixed(3),
        // Horizon tilt, straight off the camera.
        rollDeg: +((Math.asin(Math.max(-1, Math.min(1, right.y))) * 180) / Math.PI).toFixed(1),
        headVisible: !!e.carBody.userData.driver?.head?.visible,
        carS: +e.player.s.toFixed(2),
        carLat: +e.player.lat.toFixed(3),
      });
    }
  }
  e.setView("chase");
  return out;
});

const straight = shots.filter((s) => s.yaw === 0);
const sideways = shots.filter((s) => s.yaw !== 0);
console.log("view      behind/ahead   height   along car   along road   horizon");
for (const s of sideways) {
  console.log(
    `  ${s.view.padEnd(8)} ${String(s.z).padStart(7)} m ${String(s.y).padStart(7)} m   ` +
      `${String(s.alongCar).padStart(6)}      ${String(s.alongRoad).padStart(6)}     ${s.rollDeg}°`
  );
}

const at = (v, list = straight) => list.find((s) => s.view === v);
// Behind and high, tucked in, on the wing, at the nose, behind the screen.
const placed =
  at("chase").z < -6 &&
  at("close").z > at("chase").z &&
  at("close").z < -3 &&
  at("close").y < at("chase").y &&
  at("bonnet").z > 0.5 &&
  at("bumper").z > at("bonnet").z &&
  at("bumper").y < at("bonnet").y &&
  at("cockpit").z < at("bonnet").z &&
  at("cockpit").y > at("bonnet").y;
console.log(
  `placed    ${check(
    placed,
    `the views are not where their names say: ` +
      straight.map((s) => `${s.view} ${s.z}m/${s.y}m`).join(", ")
  )}  chase ${at("chase").z} m back, bumper ${at("bumper").z} m forward, ` +
    `cockpit ${at("cockpit").y} m up`
);

// The one that matters. With the body 0.9 rad past the direction of
// travel, an in-car camera looks along the CAR and a chase camera looks
// along the ROAD, and cos(0.9) is 0.62 — so the two answers are miles
// apart and cannot be confused for one another.
const mounted = ["bonnet", "bumper", "cockpit"];
const road = ["chase", "close"];
console.log(
  `bolted    ${check(
    mounted.every((v) => at(v, sideways).alongCar > 0.93) &&
      road.every((v) => at(v, sideways).alongRoad > 0.93) &&
      mounted.every((v) => at(v, sideways).alongRoad < 0.85),
    mounted.some((v) => at(v, sideways).alongCar <= 0.93)
      ? `an in-car view is not following the body: ` +
        mounted.map((v) => `${v} ${at(v, sideways).alongCar}`).join(", ")
      : `a chase view is following the body instead of the road: ` +
        road.map((v) => `${v} ${at(v, sideways).alongRoad}`).join(", ")
  )}  sideways at 0.9 rad: in-car ${at("bumper", sideways).alongCar} along the car, ` +
    `chase ${at("chase", sideways).alongRoad} along the road`
);
// And the horizon: a chase camera leans a few degrees into a slide; an
// in-car one leans with the shell, and must not be given the chase
// camera's lean on top of the shell's own.
console.log(
  `level     ${check(
    Math.abs(at("chase", sideways).rollDeg) < 12 &&
      mounted.every((v) => Math.abs(at(v, sideways).rollDeg) < 12),
    `the horizon goes over: ` +
      sideways.map((s) => `${s.view} ${s.rollDeg}°`).join(", ")
  )}  never past ${Math.max(...sideways.map((s) => Math.abs(s.rollDeg))).toFixed(1)}° of lean`
);
// The cockpit is behind the driver's eyes, so the head has to go — and
// come back.
console.log(
  `head      ${check(
    at("cockpit").headVisible === false &&
      ["chase", "close", "bonnet", "bumper"].every((v) => at(v).headVisible === true),
    at("cockpit").headVisible
      ? "the driver's own head is in front of the cockpit camera"
      : "the head stays hidden after leaving the cockpit"
  )}  hidden in the cockpit, back everywhere else`
);
// Changing the shot is a camera move, not a car move. Measured across
// the switch ITSELF — the car is doing 100 km/h and covers eleven metres
// in the twenty-five frames between samples, so comparing two samples
// measures the road, not the switch.
const still = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.player.s = 2400;
  e.player.lat = 1.4;
  e.player.speed = 100 / 3.6;
  let worst = 0;
  for (const v of ["close", "bonnet", "bumper", "cockpit", "chase"]) {
    const s0 = e.player.s;
    const l0 = e.player.lat;
    const sp0 = e.player.speed;
    e.setView(v);
    worst = Math.max(
      worst,
      Math.abs(e.player.s - s0),
      Math.abs(e.player.lat - l0),
      Math.abs(e.player.speed - sp0)
    );
  }
  e.setView("chase");
  return worst;
});
console.log(
  `still     ${check(still < 1e-6, `the car moved ${still.toFixed(4)} when the shot changed`)}  ` +
    `five switches, not a millimetre of car`
);

// --- The ring ---------------------------------------------------------
const ring = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setView("chase");
  const seen = [];
  for (let i = 0; i < 6; i++) seen.push(e.setView());
  return seen;
});
console.log(
  `ring      ${check(
    ring.length === 6 && ring[5] === ring[0] && new Set(ring).size === 5,
    `C walks ${ring.join(" → ")}, which is not a ring of five`
  )}  ${ring.slice(0, 5).join(" → ")} → back`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nfive shots, and each one is bolted to the right thing.");
