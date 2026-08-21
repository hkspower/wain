// Losing it.
//
//   npm run dev
//   node tests/spin.mjs
//
// A spin used to be an animation. Measured, it was the identical event
// at every speed: 64 degrees of rotation from the threshold to a 126
// degree stop, held for exactly 1.15 seconds, costing the same fraction
// of whatever you had. Lose it at 40 and lose it at 300 and the game
// played you the same clip. The car never went round.
//
// It is momentum now — a yaw rate the car leaves with, Coulomb friction
// from four sliding tyres taking it back out, and an end that arrives
// when the rotation dies rather than when a clock does. So this measures
// the rotation:
//
//   scales     more speed means further round, longer, and more of it
//              gone by the end — monotonically, not roughly
//   round      losing it at speed goes PAST a full rotation, which the
//              old model could not do at any speed
//   momentum   the yaw rate only ever falls, and it is what ends the
//              spin: two entries at different rates last different
//              lengths of time
//   settled    it ends pointing somewhere real, and does not trip
//              straight into another spin — which is what the first
//              working version did, three times in a row
//   wheels     the tyres roll at the car's own axis, so they stop at
//              ninety degrees and turn backwards past it
//   catchable  a big angle that is already coming back is not a spin,
//              however far round the body happens to be pointing
//   bounded    and none of it can run for ever
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
await page.waitForFunction(() => !!window.__grnDriftModel, null, { timeout: 180000 });
await page.waitForTimeout(1500);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// --- The model on its own -------------------------------------------
//
// Driven directly rather than through the engine. The engine's other
// forces — the heading scrub, the centrifugal push, the wall, the
// traction solver — all move the speed at the same time, and mixing them
// in measures the game rather than the thing being changed.
const runs = await page.evaluate(() => {
  const { solveDrift, newDriftState } = window.__grnDriftModel;
  const dt = 1 / 60;
  const out = [];
  for (const kmh of [80, 140, 220, 300]) {
    const s = newDriftState();
    let speed = kmh / 3.6;
    const step = (inp) => {
      const r = solveDrift(s, {
        dt, speed, steer: 0, throttle: 0, handbrake: false,
        wheelspin: 0, brakeRotate: 0, driftAngleMult: 1, ...inp,
      });
      speed *= 1 - r.scrubRate * dt;
      return r;
    };
    // Lose it the way a player does: lock still into the slide, throttle
    // still buried, nothing caught. The speed is held through the entry
    // so each case reaches the spin at the speed it is labelled with.
    let entered = false;
    for (let i = 0; i < 60 * 6 && !entered; i++) {
      speed = kmh / 3.6;
      entered = step({ steer: 1, throttle: 1, handbrake: true }).spinning;
    }
    if (!entered) { out.push({ kmh, entered: false }); continue; }
    // Hands off. Whatever happens now is the spin.
    const rates = [];
    let secs = 0;
    let deg = 0;
    let reSpun = 0;
    let endAngle = 0;
    for (let i = 0; i < 60 * 12; i++) {
      const r = step({});
      if (r.spinning) {
        secs += dt;
        deg = r.spinDeg;
        rates.push(Math.abs(r.spinRate));
      } else {
        endAngle = r.angle;
        // Twenty more frames of nothing: a spin that ends with the body
        // still well out must not read as the start of the next one.
        for (let k = 0; k < 20; k++) if (step({}).spinning) reSpun++;
        break;
      }
    }
    out.push({
      kmh,
      entered: true,
      endKmh: +(speed * 3.6).toFixed(1),
      kept: +((speed * 3.6) / kmh).toFixed(3),
      deg: Math.round(deg),
      secs: +secs.toFixed(2),
      peakRate: +Math.max(...rates).toFixed(2),
      endRate: +rates[rates.length - 1].toFixed(2),
      // A yaw rate that ever rises is not friction taking rotation out.
      rose: rates.some((r, i) => i > 0 && r > rates[i - 1] + 1e-9),
      endAngle: +endAngle.toFixed(3),
      reSpun,
    });
  }
  return out;
});

console.log("entry     rotation   time   speed kept   yaw rate");
for (const r of runs) {
  if (!r.entered) { check(false, `a car held wrong at ${r.kmh} km/h never spun at all`); continue; }
  console.log(
    `  ${String(r.kmh).padStart(3)} km/h  ${String(r.deg).padStart(4)}°  ` +
      `${(r.deg / 360).toFixed(2)} turns  ${r.secs.toFixed(2)}s  ` +
      `${(r.kept * 100).toFixed(0)}%  (${r.endKmh} km/h)   ${r.peakRate} → ${r.endRate} rad/s`
  );
}
const ok = runs.filter((r) => r.entered);
const rising = (key) => ok.every((r, i) => i === 0 || r[key] > ok[i - 1][key]);
const falling = (key) => ok.every((r, i) => i === 0 || r[key] < ok[i - 1][key]);
console.log(
  `scales    ${check(
    ok.length === 4 && rising("deg") && rising("secs") && falling("kept"),
    !rising("deg")
      ? `the rotation does not grow with speed: ${ok.map((r) => `${r.kmh}→${r.deg}°`).join(", ")}`
      : !rising("secs")
        ? `the spin does not last longer at speed: ${ok.map((r) => `${r.kmh}→${r.secs}s`).join(", ")}`
        : `a fast spin does not cost more speed: ${ok.map((r) => `${r.kmh}→${(r.kept * 100) | 0}%`).join(", ")}`
  )}  further, longer and dearer at every step up`
);
// The old model's ceiling was 126 degrees at every speed. Anything past
// a full turn is something it could not do at all.
const fastest = ok[ok.length - 1];
console.log(
  `round     ${check(
    fastest.deg > 360 && ok[0].deg < 270,
    fastest.deg <= 360
      ? `losing it at ${fastest.kmh} only goes ${fastest.deg}° — the car still never goes round`
      : `losing it at ${ok[0].kmh} goes ${ok[0].deg}°, which is a spin where there should be a slide`
  )}  ${ok[0].deg}° at ${ok[0].kmh}, ${fastest.deg}° at ${fastest.kmh}`
);
console.log(
  `momentum  ${check(
    ok.every((r) => !r.rose) && ok.every((r) => r.endRate < r.peakRate),
    ok.find((r) => r.rose)
      ? "the yaw rate rises during a spin — that is not friction, it is a driven rotation"
      : "the spin ends at the rate it started, so it is still a clock and not a rotation"
  )}  every spin decays from its entry rate to nothing`
);
console.log(
  `settled   ${check(
    ok.every((r) => Math.abs(r.endAngle) <= Math.PI + 1e-6) && ok.every((r) => r.reSpun === 0),
    ok.find((r) => Math.abs(r.endAngle) > Math.PI)
      ? `a spin ended holding ${ok.find((r) => Math.abs(r.endAngle) > Math.PI).endAngle} rad — ` +
        `the recovery would unwind the whole rotation backwards`
      : "the car tripped straight into another spin the moment the first one ended"
  )}  ends inside ±180°, and stays ended`
);

// --- Bounded ---------------------------------------------------------
const bounded = await page.evaluate(() => {
  const { solveDrift, newDriftState, HANDLING } = window.__grnDriftModel;
  const dt = 1 / 60;
  const s = newDriftState();
  // An absurd entry: far more rotation than anything in the game can
  // produce, to prove the cap is a cap and not a comment.
  s.angle = 1.2;
  s.spinT = dt;
  s.spinRate = 40;
  let secs = 0;
  for (let i = 0; i < 60 * 30; i++) {
    const r = solveDrift(s, {
      dt, speed: 90, steer: 0, throttle: 0, handbrake: false,
      wheelspin: 0, brakeRotate: 0, driftAngleMult: 1,
    });
    if (!r.spinning) break;
    secs += dt;
  }
  return { secs: +secs.toFixed(2), cap: HANDLING.driftSpinMaxTime };
});
console.log(
  `bounded   ${check(
    bounded.secs <= bounded.cap + 0.05,
    `a 40 rad/s spin ran for ${bounded.secs}s against a ${bounded.cap}s cap`
  )}  a 40 rad/s spin still stops, at ${bounded.secs}s of a ${bounded.cap}s cap`
);

// --- A big angle already coming back is not a spin -------------------
const caught = await page.evaluate(() => {
  const { solveDrift, newDriftState, HANDLING } = window.__grnDriftModel;
  const dt = 1 / 60;
  const s = newDriftState();
  // Well past the spin threshold, but under grip with no entry holding
  // it there: the body is on its way back and nothing should trip.
  s.angle = HANDLING.driftSpinAngle * 1.6;
  let spun = false;
  let frames = 0;
  for (let i = 0; i < 60 * 4; i++) {
    const r = solveDrift(s, {
      dt, speed: 40, steer: 0, throttle: 0, handbrake: false,
      wheelspin: 0, brakeRotate: 0, driftAngleMult: 1,
    });
    if (r.spinning) spun = true;
    frames++;
    if (Math.abs(s.angle) < 0.05) break;
  }
  return { spun, secs: +(frames / 60).toFixed(2), angle: +s.angle.toFixed(3) };
});
console.log(
  `catchable ${check(
    !caught.spun,
    "a body sitting past the spin angle with no rotation left in it still counts as a spin"
  )}  a body 60% past the spin angle, coming back under grip: down to ` +
    `${((Math.abs(caught.angle) * 180) / Math.PI).toFixed(0)}° in ${caught.secs}s without tripping`
);

// --- The wheels, on the real car -------------------------------------
//
// The one part that cannot be measured on the model: the tyres roll at
// the component of travel along the car's own axis, so as a spin sweeps
// through ninety degrees they stop, and past it they turn backwards.
const wheels = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.player.s = 2400; e.player.lat = 0; e.player.speed = 240 / 3.6;
  e.heading = 0; e.steerSmooth = 0; e.slipVel = 0;
  Object.assign(e.ds, window.__grnDriftModel.newDriftState());
  e.touch.drift = true;
  const THREE = window.__grnThree;
  const w = e.carBody.userData.wheels[0];
  const samples = [];
  let prev = w.rotation.x;
  let roll = 0;
  const right = new THREE.Vector3();
  for (let i = 0; i < 60 * 6; i++) {
    e.player.speed = Math.max(8, e.player.speed);
    e.setTouchInput({ steer: 1, throttle: 1, brake: 0 });
    e.update(1 / 60);
    e.player.lat = 0;
    const d = w.rotation.x - prev;
    prev = w.rotation.x;
    if (e.ds.spinT > 0) {
      samples.push({ a: e.ds.angle, d });
      // How far off level the horizon is, straight off the camera: the
      // world-space rise of its own right vector.
      right.set(1, 0, 0).applyQuaternion(e.camera.quaternion);
      roll = Math.max(roll, Math.abs(Math.asin(Math.max(-1, Math.min(1, right.y)))));
    }
  }
  e.touch.drift = false;
  // Only the frames where the answer is unambiguous: within a few
  // degrees of ninety the cosine is nearly zero and so is the rolling,
  // and the sign of nothing is not a fact.
  const clear = samples.filter((x) => Math.abs(Math.cos(x.a)) > 0.12);
  const wrong = clear.filter((x) => Math.sign(x.d) !== Math.sign(Math.cos(x.a)));
  const reversed = clear.filter((x) => Math.cos(x.a) < 0);
  return {
    frames: samples.length,
    clear: clear.length,
    wrong: wrong.length,
    reversed: reversed.length,
    maxAngleDeg: Math.round((Math.max(...samples.map((x) => Math.abs(x.a))) * 180) / Math.PI),
    rollDeg: +((roll * 180) / Math.PI).toFixed(1),
  };
});
console.log(
  `wheels    ${check(
    wheels.frames > 20 && wheels.reversed > 5 && wheels.wrong === 0,
    wheels.frames <= 20
      ? "the car never spun on the real engine, so the wheels prove nothing"
      : wheels.reversed <= 5
        ? `the spin only reached ${wheels.maxAngleDeg}°, so the wheels never went past ninety`
        : `${wheels.wrong} of ${wheels.clear} frames turn the wheels the wrong way for the angle`
  )}  ${wheels.clear} clear frames over a ${wheels.maxAngleDeg}° spin, ` +
    `${wheels.reversed} of them rolling backwards, none the wrong way`
);

// The camera leans into a slide by a few degrees. It must not follow a
// spin round: the roll term was written against an angle that could not
// exceed 1.3 rad, and left alone it put the horizon fifty degrees over
// once the body could reach nine.
console.log(
  `horizon   ${check(
    wheels.rollDeg < 12,
    `the camera rolls ${wheels.rollDeg}° during a spin — the horizon goes over with the car`
  )}  ${wheels.rollDeg}° of lean at the worst of it`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\na spin is a spin.");
