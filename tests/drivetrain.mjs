// Front, rear and all-wheel drive are three different cars.
//
//   npm run test:drivetrain      (no browser, no dev server)
//
// The risk with a feature like this is that it plumbs through cleanly,
// every constant exports, every port agrees — and all three drivetrains
// still drive identically, because the number reached a field nobody
// multiplied by. So nothing here inspects a config. Each check drives
// the actual solvers and compares what the CAR did.
//
// What is asserted is the behaviour each layout is known for, and the
// reason it happens, rather than the values that happen to fall out:
//
//   a rear-driver finds traction as it squats and loses the tail
//   a front-driver loses traction as it squats and pushes wide instead
//   an all-wheel-drive car barely notices pitch and pays a transfer case

import { solveLoad, newLoadState } from "../src/game/grip.ts";
import { solveDrift, newDriftState } from "../src/game/drift.ts";
import { HANDLING as H } from "../src/game/handling.ts";
import { readFileSync } from "node:fs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const DT = 1 / 120;

/** Hold a steady longitudinal g until the springs have settled. */
function settle(drive, aLong, throttle) {
  const st = newLoadState();
  let r = null;
  for (let i = 0; i < 400; i++) {
    r = solveLoad(st, { dt: DT, aLong, drive, throttle });
  }
  return r;
}

// --- 1. Traction under power moves in opposite directions ------------
//
// The single fact the whole model turns on. Under acceleration the car
// squats: weight leaves the front axle and arrives at the rear. Whether
// that HELPS depends entirely on which axle the engine is using.
console.log("under power (0.45 g of squat, full throttle)");
const power = {};
for (const d of ["fwd", "rwd", "awd"]) {
  const rest = settle(d, 0, 0);
  const on = settle(d, 4.4, 1);
  power[d] = { rest: rest.driveScale, on: on.driveScale, steer: on.steerScale };
  console.log(
    `  ${d.padEnd(4)} traction ${rest.driveScale.toFixed(4)} at rest -> ` +
    `${on.driveScale.toFixed(4)} on the throttle, steering ${on.steerScale.toFixed(4)}`
  );
}
check(
  power.rwd.on > power.rwd.rest,
  `a rear-driver should find traction as it squats (${power.rwd.rest} -> ${power.rwd.on})`
);
check(
  power.fwd.on < power.fwd.rest,
  `a front-driver should lose traction as it squats (${power.fwd.rest} -> ${power.fwd.on})`
);
// AWD uses both axles, and front + rear is 1 at every instant, so pitch
// cannot move its traction at all. That is not a tuned number, it is
// what the arithmetic has to say.
check(
  Math.abs(power.awd.on - power.awd.rest) < 1e-9,
  `all-wheel drive should be indifferent to pitch (${power.awd.rest} -> ${power.awd.on})`
);
check(
  power.awd.on < 1,
  `all-wheel drive should pay for its transfer case (${power.awd.on})`
);
check(
  power.awd.on > power.fwd.on,
  "all-wheel drive should put down more than a front-driver under power"
);

// --- 2. On a front-driver, power costs steering ----------------------
//
// The driven tyres are the steering tyres and a contact patch spends its
// grip once. This is understeer arrived at rather than bolted on, so the
// test is that it appears ONLY on the front-driver.
console.log("\nsteering authority, throttle shut vs pinned");
for (const d of ["fwd", "rwd", "awd"]) {
  const shut = settle(d, 4.4, 0);
  const pinned = settle(d, 4.4, 1);
  const lost = 1 - pinned.steerScale / shut.steerScale;
  console.log(`  ${d.padEnd(4)} loses ${(lost * 100).toFixed(1)}% of its steering to the throttle`);
  if (d === "fwd") {
    check(lost > 0.15, `a front-driver should push wide on the power (lost ${(lost * 100).toFixed(1)}%)`);
  } else {
    check(
      Math.abs(lost) < 1e-9,
      `${d} should not lose steering to the throttle at all (lost ${(lost * 100).toFixed(1)}%)`
    );
  }
}

// --- 3. Torque steer, and only where it belongs ----------------------
const ts = ["fwd", "rwd", "awd"].map((d) => [d, settle(d, 4.4, 1).torqueSteer]);
console.log(`\ntorque steer  ${ts.map(([d, v]) => `${d} ${v.toFixed(4)}`).join(", ")}`);
check(ts[0][1] > 0, "a powerful front-driver should tug at the wheel");
check(ts[1][1] === 0 && ts[2][1] === 0, "only a front-driver should have torque steer");

// --- 4. Only a rear-driver goes sideways on the throttle -------------
//
// Driven through the real drift solver rather than by reading the
// threshold back: a car held at big wheelspin and big lock, at speed,
// with the throttle buried — the textbook power-over.
console.log("\npower-over entry, held at full lock and full wheelspin");
const entries = {};
for (const d of ["fwd", "rwd", "awd"]) {
  const st = newDriftState();
  let got = "";
  for (let i = 0; i < 240; i++) {
    const r = solveDrift(st, {
      dt: DT,
      speed: 30,
      steer: 0.9,
      throttle: 1,
      handbrake: false,
      wheelspin: H.powerOverSpin * 1.6,
      brakeRotate: 0,
      rearLight: 0,
      drive: d,
      driftAngleMult: 1,
    });
    if (r.entry) got = r.entry;
  }
  entries[d] = got;
  console.log(`  ${d.padEnd(4)} ${got || "stays straight"}`);
}
check(entries.rwd === "power", `a rear-driver should power-over (got "${entries.rwd}")`);
check(entries.fwd !== "power", `a front-driver should not power-over (got "${entries.fwd}")`);

// --- 5. Every car in the showroom has one, and the fleet is mixed ----
//
// The roster is read out of mods.ts as text rather than imported. That
// is not laziness: mods.ts re-exports a type through a value import,
// which node's type stripping cannot resolve at runtime, and it is also
// exactly how scripts/export-unreal-data.mjs reads the same table. One
// way of reading the roster outside the browser, not two.
const modsSrc = readFileSync("src/game/mods.ts", "utf8");
const carsBlock = modsSrc.match(/export const CARS[^=]*=\s*\[(.*?)\n\];/s)[1];
const ids = [...carsBlock.matchAll(/^\s{4}id: "([a-z0-9-]+)",\n\s{4}drive: "(fwd|rwd|awd)",/gm)];
const byDrive = {};
for (const [, , d] of ids) byDrive[d] = (byDrive[d] ?? 0) + 1;
const total = [...carsBlock.matchAll(/^\s{4}id: "[a-z0-9-]+",/gm)].length;
console.log(
  `\nshowroom     ${Object.entries(byDrive).map(([d, n]) => `${n} ${d}`).join(", ")} across ${total} cars`
);
check(
  ids.length === total,
  `${total - ids.length} car(s) in the showroom do not say which wheels they drive`
);
check(Object.keys(byDrive).length === 3, "the showroom does not sell all three layouts");
// The car whose own catalogue text called it an AWD monster while
// driving like the rear-driver beside it. That is what started this.
const gtr = ids.find(([, id]) => id === "zeta-300-gtr");
check(gtr?.[2] === "awd", "the car sold as an AWD monster is still not all-wheel drive");

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nthree drivetrains, three cars"
);
process.exit(fail.length ? 1 : 0);
