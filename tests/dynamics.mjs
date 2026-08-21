// The car pitches, and the grip goes with it.
//
//   npm run dev
//   node tests/dynamics.mjs
//
// Two dynamics were missing from a model that already had a friction
// circle, brake lock, fade and a drift solver, and both are things a
// driver feels every corner rather than things a stopwatch sees:
//
//   LOAD TRANSFER   brake and the nose dives, which presses the front
//                   tyres down and lifts the rear. So the same car turns
//                   in harder on the brakes, pushes wide on the
//                   throttle, and steps its tail out if you lift in the
//                   middle of a corner. Before this, the pedals only
//                   changed how fast the car was going.
//   DOWNFORCE       the GT wing added a flat +0.5 m/s² of grip: the same
//                   +0.5 parked in the garage as at 300 km/h. A wing
//                   works on air and there is four times as much of it
//                   at twice the speed.
//
// Most of this is asked of the MODEL rather than of a lap. Driving the
// whole engine to find out what a stop on the brakes does to the front
// axle measures the game — the heading scrub, the centrifugal push, the
// traction solver, the AI alongside — and not the thing under test. The
// last section drives it anyway, because a model nothing calls is a
// model that does nothing.

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
if (!exe) { console.error("no chromium"); process.exit(2); }

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnGrip, null, { timeout: 240000 });

// --- 1. The load actually moves, and it moves the right way -----------
const transfer = await page.evaluate(() => {
  const { newLoadState, solveLoad, HANDLING } = window.__grnGrip;
  // Hold a steady longitudinal g for long enough that the springs have
  // finished compressing, then read where the weight ended up.
  const settle = (g) => {
    const s = newLoadState();
    let r = null;
    for (let i = 0; i < 400; i++) r = solveLoad(s, { dt: 1 / 60, aLong: g * 9.81 });
    return r;
  };
  return {
    hardBrake: settle(-1),
    lift: settle(-0.25),
    coast: settle(0),
    power: settle(0.5),
    staticFront: HANDLING.staticFrontLoad,
  };
});
const t = transfer;
console.log("axle load, settled:");
for (const [name, r] of [
  ["1 g braking", t.hardBrake],
  ["a lift (-0.25 g)", t.lift],
  ["coasting", t.coast],
  ["0.5 g on power", t.power],
]) {
  console.log(
    `  ${name.padEnd(18)} front ${(r.front * 100).toFixed(1)}%  rear ${(r.rear * 100).toFixed(1)}%  ` +
      `steer x${r.steerScale.toFixed(3)}  drive x${r.driveScale.toFixed(3)}  ` +
      `rear light ${(r.rearLight * 100).toFixed(1)}%`
  );
}
console.log(
  `\nstatic     ${check(Math.abs(t.coast.front - t.staticFront) < 1e-6,
    `coasting sits at ${(t.coast.front * 100).toFixed(1)}% front, not the static ${(t.staticFront * 100).toFixed(1)}%`)}  ` +
    `coasting is the static split, ${(t.staticFront * 100).toFixed(0)}% front`
);
console.log(
  `dives      ${check(t.hardBrake.front > t.coast.front + 0.1,
    `braking moved only ${((t.hardBrake.front - t.coast.front) * 100).toFixed(1)} points forward`)}  ` +
    `1 g of brakes moves ${((t.hardBrake.front - t.coast.front) * 100).toFixed(1)} points onto the nose`
);
console.log(
  `squats     ${check(t.power.rear > t.coast.rear + 0.04,
    `power moved only ${((t.power.rear - t.coast.rear) * 100).toFixed(1)} points rearward`)}  ` +
    `0.5 g of throttle moves ${((t.power.rear - t.coast.rear) * 100).toFixed(1)} points onto the rear`
);

// --- 2. ...and the grip follows it ------------------------------------
// The point of the whole thing. Turn-in on the brakes, push on the
// power: the SAME car, two different cars to drive.
console.log(
  `turns in   ${check(t.hardBrake.steerScale > 1.08,
    `braking gave only x${t.hardBrake.steerScale.toFixed(3)} of steering`)}  ` +
    `x${t.hardBrake.steerScale.toFixed(3)} steering on the brakes`
);
console.log(
  `pushes     ${check(t.power.steerScale < 0.95,
    `power left steering at x${t.power.steerScale.toFixed(3)}`)}  ` +
    `x${t.power.steerScale.toFixed(3)} steering on the throttle — power understeer`
);
console.log(
  `hooks up   ${check(t.power.driveScale > 1.02 && t.hardBrake.driveScale < 0.95,
    `traction scaled x${t.power.driveScale.toFixed(3)} on power and x${t.hardBrake.driveScale.toFixed(3)} on the brakes`)}  ` +
    `x${t.power.driveScale.toFixed(3)} traction squatting, x${t.hardBrake.driveScale.toFixed(3)} diving`
);

// --- 3. Bounded, because the loop feeds itself -------------------------
// Squat gives traction gives acceleration gives squat. The exponent
// makes that convergent and the clamps make it sane; without the clamps
// it settles at a 1.7 g launch on a road tyre.
const bounds = await page.evaluate(() => {
  const { newLoadState, solveLoad, HANDLING } = window.__grnGrip;
  let maxDrive = 0, maxSteer = 0, minSteer = 9, minDrive = 9;
  for (let g = -3; g <= 3; g += 0.02) {
    const s = newLoadState();
    let r = null;
    for (let i = 0; i < 400; i++) r = solveLoad(s, { dt: 1 / 60, aLong: g * 9.81 });
    maxDrive = Math.max(maxDrive, r.driveScale); minDrive = Math.min(minDrive, r.driveScale);
    maxSteer = Math.max(maxSteer, r.steerScale); minSteer = Math.min(minSteer, r.steerScale);
  }
  return { maxDrive, minDrive, maxSteer, minSteer, H: {
    dMax: HANDLING.driveScaleMax, dMin: HANDLING.driveScaleMin,
    sMax: HANDLING.steerScaleMax, sMin: HANDLING.steerScaleMin } };
});
console.log(
  `bounded    ${check(
    bounds.maxDrive <= bounds.H.dMax + 1e-9 && bounds.minDrive >= bounds.H.dMin - 1e-9 &&
    bounds.maxSteer <= bounds.H.sMax + 1e-9 && bounds.minSteer >= bounds.H.sMin - 1e-9,
    `scales reached drive [${bounds.minDrive.toFixed(3)}, ${bounds.maxDrive.toFixed(3)}] ` +
      `steer [${bounds.minSteer.toFixed(3)}, ${bounds.maxSteer.toFixed(3)}]`
  )}  from -3 g to +3 g, drive stays in [${bounds.minDrive.toFixed(2)}, ${bounds.maxDrive.toFixed(2)}]`
);

// --- 4. The springs take time ------------------------------------------
// Not a smoothing convenience: this delay is why trail braking is a
// technique. Solved instantaneously the car flips its balance on a
// one-frame brake tap.
const lag = await page.evaluate(() => {
  const { newLoadState, solveLoad } = window.__grnGrip;
  const s = newLoadState();
  const out = [];
  for (let i = 0; i < 60; i++) {
    const r = solveLoad(s, { dt: 1 / 60, aLong: -9.81 });
    out.push(+r.front.toFixed(4));
  }
  return out;
});
// Time to reach 63% of the way (one time constant).
const settled = lag[lag.length - 1];
const start = 0.53;
const target = start + (settled - start) * 0.63;
const tau = lag.findIndex((v) => v >= target) / 60;
console.log(
  `springs    ${check(tau > 0.08 && tau < 0.35,
    `load moves with a time constant of ${tau.toFixed(3)} s`)}  ` +
    `one time constant is ${(tau * 1000).toFixed(0)} ms — a suspension, not a switch`
);

// --- 5. The wing works on air ------------------------------------------
const aero = await page.evaluate(() => {
  const { gripAtSpeed, HANDLING } = window.__grnGrip;
  const base = 12;
  const wing = 0.8; // the GT wing
  const kit = 1.8;  // the attack car, wing plus splitter
  const at = (d, kmh) => +gripAtSpeed(base, d, kmh / 3.6).toFixed(3);
  return {
    ref: HANDLING.downforceRefSpeed,
    none: [at(0, 0), at(0, 100), at(0, 250)],
    wing: [at(wing, 0), at(wing, 100), at(wing, 200), at(wing, 300)],
    kit: [at(kit, 0), at(kit, 300)],
    cap: at(40, 400),
    max: HANDLING.downforceMax,
    baseGrip: base,
  };
});
console.log(
  `\naero       parked / 100 / 200 / 300 km/h with the GT wing: ${aero.wing.join(" / ")} m/s²`
);
console.log(
  `parked     ${check(Math.abs(aero.wing[0] - aero.baseGrip) < 1e-6,
    `a parked car with a wing has ${aero.wing[0]} m/s² against a bare ${aero.baseGrip}`)}  ` +
    `standing still, the wing is worth nothing — which is what a wing is worth standing still`
);
console.log(
  `square law ${check(
    Math.abs((aero.wing[3] - aero.baseGrip) / (aero.wing[2] - aero.baseGrip) - 2.25) < 0.02,
    `300 km/h gives ${((aero.wing[3] - aero.baseGrip) / (aero.wing[2] - aero.baseGrip)).toFixed(2)}x what 200 does, not 2.25x`
  )}  300 km/h is worth ${((aero.wing[3] - aero.baseGrip) / (aero.wing[2] - aero.baseGrip)).toFixed(2)}x what 200 is — v², to the decimal`
);
console.log(
  `no aero    ${check(aero.none[0] === aero.none[2],
    "a car with no aero changed grip with speed")}  a car without a wing grips the same at any speed`
);
console.log(
  `capped     ${check(aero.cap <= aero.baseGrip + aero.max + 1e-6,
    `an absurd wing reached ${aero.cap} m/s²`)}  the aero term stops at +${aero.max} m/s²`
);

// --- 6. And the engine is actually using it ----------------------------
// A model nothing calls is a model that does nothing. Drive the real car
// and watch the balance move under the pedals.
const live = await page.evaluate(() => {
  const e = window.__grnEngine;
  // The engine drives on the clock it is given, and the test owns the
  // clock: rAF on a software rasteriser runs at a frame or two a second
  // and forty seconds of wall time would buy four seconds of driving.
  e.skipCinematic?.();
  e.setPaused(true);
  const read = () => ({
    front: +window.__grnDebug.loadFront.toFixed(4),
    steer: +window.__grnDebug.steerScale.toFixed(4),
    grip: +window.__grnDebug.gripNow.toFixed(3),
    speed: +e.player.speed.toFixed(1),
  });
  const drive = (n, input) => {
    for (let i = 0; i < n; i++) {
      e.setTouchInput(input);
      e.update(1 / 60);
      if (window.__vclock) window.__vclock.t += (1 / 60) * 1000;
    }
  };
  // Up to speed on the throttle, straight...
  drive(600, { throttle: 1, brake: 0, steer: 0 });
  const onPower = read();
  // ...then hard on the brakes. Long enough for the springs to finish
  // moving (133 ms) and short enough that the car is still travelling.
  drive(40, { throttle: 0, brake: 1, steer: 0 });
  const onBrakes = read();
  return { onPower, onBrakes, static: window.__grnDebug.gripStatic };
});
console.log(
  `\nlive       on power ${(live.onPower.front * 100).toFixed(1)}% front at ${live.onPower.speed} m/s, ` +
    `on the brakes ${(live.onBrakes.front * 100).toFixed(1)}%`
);
console.log(
  `engine uses ${check(live.onBrakes.front > live.onPower.front + 0.04,
    `the real car moved ${((live.onBrakes.front - live.onPower.front) * 100).toFixed(1)} points of load between power and brakes`)}  ` +
    `${((live.onBrakes.front - live.onPower.front) * 100).toFixed(1)} points of load move between the pedals`
);
console.log(
  `           ${check(live.onBrakes.steer > live.onPower.steer + 0.03,
    `steering authority went from x${live.onPower.steer} to x${live.onBrakes.steer}`)}  ` +
    `steering authority x${live.onPower.steer} on power -> x${live.onBrakes.steer} on the brakes`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} FAILED`);
  for (const f of fail) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nthe weight moves, and the grip goes with it");
