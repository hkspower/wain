// The attack kit's wing moves.
//
//   npm run test:aero      (no browser, no dev server)
//
// aero.ts is a pure solver; these pin what it promises: an airbrake
// that deploys under braking and comes back, a trim that flattens with
// speed, an actuator with a real rate, and a brake that wins at any
// speed. The in-car half — that the engine actually calls it, on the
// player and on the rival — lives in tests/ik.mjs.

import { HANDLING as H } from "../src/game/handling.ts";
import { solveWing, wingTarget } from "../src/game/aero.ts";
import { readFileSync } from "node:fs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };
const F = (n, d = 3) => Number(n).toFixed(d);
const DT = 1 / 60;

// --- 1. Brake: up, held, and back down --------------------------------
{
  // At 20 m/s the trim takes a hair off the full airbrake; the law's
  // own target is what the actuator must reach, and it is nearly all of
  // the airbrake angle.
  const want = wingTarget(1, 20);
  check(want > H.wingAirbrakeRad * 0.95, `at town speed a full brake should ask for nearly the whole airbrake, got ${want}`);
  let a = 0, frames = 0, worstStep = 0;
  while (a < want - 1e-9 && frames < 600) {
    const n = solveWing({ angle: a, brake: 1, speed: 20, dt: DT });
    worstStep = Math.max(worstStep, Math.abs(n - a));
    a = n; frames++;
  }
  const rise = frames * DT;
  check(Math.abs(a - want) < 1e-9, `full brake settles at ${a}, not the law's ${want}`);
  check(rise > 0.15 && rise < 0.6, `the airbrake took ${F(rise, 2)} s to deploy — a flip is 0.2-0.5 s`);
  check(worstStep <= H.wingRate * DT + 1e-12, `a frame moved the wing ${worstStep} rad, past the actuator's ${H.wingRate * DT}`);
  for (let i = 0; i < 120; i++) a = solveWing({ angle: a, brake: 1, speed: 20, dt: DT });
  check(Math.abs(a - want) < 1e-9, "holding the brake must hold the airbrake, not overshoot it");
  let back = 0;
  while (Math.abs(a - wingTarget(0, 20)) > 1e-3 && back < 600) { a = solveWing({ angle: a, brake: 0, speed: 20, dt: DT }); back++; }
  check(back * DT < 0.6, `the wing took ${F(back * DT, 2)} s to stow`);
  console.log(`airbrake     0 -> ${F(H.wingAirbrakeRad)} rad in ${F(rise, 2)} s (${F(H.wingRate)} rad/s), held, stowed in ${F(back * DT, 2)} s`);
}

// --- 2. Speed: trims flatter, on the downforce curve ------------------
{
  const at = (v) => wingTarget(0, v);
  check(at(0) === 0, `at rest the wing must sit at its rest incidence, got ${at(0)}`);
  check(Math.abs(at(H.downforceRefSpeed) + H.wingTrimRad) < 1e-12, `at the reference speed the trim must be the full ${H.wingTrimRad}`);
  check(Math.abs(at(H.downforceRefSpeed / 2) + H.wingTrimRad / 4) < 1e-12, "the trim must go as v squared, like the downforce it stands for");
  check(at(H.downforceRefSpeed * 2) === at(H.downforceRefSpeed), "the trim must not keep growing past the reference speed");
  let prev = 0;
  for (let v = 0; v <= 100; v += 5) { check(at(v) <= prev + 1e-12, `the trim went back up at ${v} m/s`); prev = at(v); }
  console.log(`trim         0 at rest, ${F(at(H.downforceRefSpeed / 2))} at ${H.downforceRefSpeed / 2} m/s, ${F(at(H.downforceRefSpeed))} at ${H.downforceRefSpeed} m/s (the downforce reference), flat after`);
}

// --- 3. The brake wins at any speed -----------------------------------
{
  let worst = Infinity;
  for (let v = 0; v <= 120; v += 4) worst = Math.min(worst, wingTarget(1, v));
  check(worst > 0.3, `at some speed a full brake only lifted the wing ${worst} rad — the trim is fighting the airbrake`);
  check(H.wingAirbrakeRad > H.wingTrimRad * 3, "the airbrake must dominate the trim by a wide margin");
  console.log(`brake wins   full brake lifts the wing at least ${F(worst)} rad at every speed to 120 m/s`);
}

// --- 4. It is wired: pivot tagged, engine driving it, tools skipping it --
{
  const cars = readFileSync("src/game/cars.ts", "utf8");
  const engine = readFileSync("src/game/engine.ts", "utf8");
  const wheels = readFileSync("tools/shots/wheels.mjs", "utf8");
  check(/wing\.userData\.wing = true;/.test(cars) && /group\.userData\.wing = wing;/.test(cars), "createCar must hang the attack wing under a tagged pivot");
  check(/wing\.add\(plane\);/.test(cars) && /wing\.add\(gurney\);/.test(cars) && /wing\.add\(strip\);/.test(cars) && /wing\.add\(endplate\);/.test(cars),
    "plane, gurney, brake strip and endplates must all hang from the pivot, or the airbrake tears the wing apart");
  check((engine.match(/poseWing\(/g) ?? []).length >= 4, "the engine must pose the wing for the player and the rival (both paths)");
  check(/poseWing\(this\.carBody, Math\.max\(this\.brake, this\.handbrake \? 1 : 0\)/.test(engine), "the player's wing must read the same brake fact the tail lamps do");
  check(/poseWing\(r\.mesh, r\.brakeVis, r\.speed, dt\)/.test(engine), "the rival's wing must read the rival's own brake pressure");
  check(/o\.userData\.wing \|\| o\.parent\?\.userData\.wing/.test(wheels), "tools/shots/wheels.mjs must skip the wing by its tag, not by a material name that never matched");
  console.log("wired        pivot tagged in createCar, driven by the engine on player and rival, skipped by the wheels tool");
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nthe wing moves");
process.exit(fail.length ? 1 : 0);
