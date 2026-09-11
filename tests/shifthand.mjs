// The hand leaves the wheel for the gear lever, and comes back.
//
//   npm run test:shifthand
//
// Headless: the driver rig and its solver are pure three.js objects
// with no DOM in them, so this builds one and drives it for a second at
// sixty hertz rather than booting the game. tests/ik.mjs covers the same
// rig through the running car; this covers the one motion it could not
// see, because the engine only produces it for the two tenths of a
// second a shift lasts.
import * as THREE from "three";
import { kuwaitiDriver } from "../src/game/characters.ts";
import { solveDriverRig } from "../src/game/driver.ts";
import { RIG } from "../src/game/rig.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const rig = kuwaitiDriver();
const look = new THREE.Vector3(0, RIG.driver.lookHeight, RIG.driver.lookAheadM);
const inboardSign = Math.sign(RIG.driver.handbrakeX) || -1;
const arm = rig.arms.find((a) => a.side === inboardSign);
const hand = () => { const v = new THREE.Vector3(); arm.elbow.updateWorldMatrix(true, true);
  // the end of the forearm: elbow + lower along its local -Y
  v.set(0, -arm.lower, 0); arm.elbow.localToWorld(v); return v; };
const knob = () => { const v = new THREE.Vector3(0, RIG.driver.gearLen, 0); rig.gear.updateWorldMatrix(true, false); rig.gear.localToWorld(v); return v; };
const rimDist = (p) => { const c = new THREE.Vector3(); rig.wheel.updateWorldMatrix(true, false); rig.wheel.getWorldPosition(c); return Math.abs(p.distanceTo(c) - rig.wheelRadius); };
const run = (n, shift, hb = 0) => { for (let i = 0; i < n; i++) solveDriverRig(rig, 0, 0.3, 0, look, 1 / 60, 0, 0, hb, shift); };

run(60, 0);
const rest = hand(); const restRim = rimDist(rest); const restKnob = rest.distanceTo(knob());
console.log(`at rest      hand ${restRim.toFixed(3)} m off the rim, ${restKnob.toFixed(3)} m from the knob  ` +
  check(restRim < 0.03, `the inboard hand is ${restRim.toFixed(3)} m off the rim before any shift`));

run(30, 1);
const up = hand(); const upKnob = up.distanceTo(knob()); const upRim = rimDist(up);
console.log(`upshift peak hand ${upRim.toFixed(3)} m off the rim, ${upKnob.toFixed(3)} m from the knob  ` +
  check(upKnob < restKnob * 0.5, `the hand did not go for the lever (${upKnob.toFixed(3)} vs ${restKnob.toFixed(3)} at rest)`) + " " +
  check(rig.gear.rotation.x > RIG.driver.gearTilt + 0.1, "the lever did not rock forward on an upshift"));

run(30, -1);
console.log(`downshift    lever at ${rig.gear.rotation.x.toFixed(2)} rad  ` +
  check(rig.gear.rotation.x < RIG.driver.gearTilt - 0.1, "the lever did not rock back on a downshift"));

run(90, 0);
const back = hand(); const backRim = rimDist(back);
console.log(`released     hand ${backRim.toFixed(3)} m off the rim  ` +
  check(backRim < 0.03, `the hand did not come back to the rim after the shift (${backRim.toFixed(3)} m)`) + " " +
  check(Math.abs(rig.gear.rotation.x - RIG.driver.gearTilt) < 0.02, "the lever did not return to rest"));

run(30, 1, 1);
const both = hand(); const hbKnob = new THREE.Vector3(0, RIG.driver.handbrakeLen, 0); rig.handbrake.updateWorldMatrix(true, false); rig.handbrake.localToWorld(hbKnob);
console.log(`shift + handbrake  hand ${both.distanceTo(hbKnob).toFixed(3)} m from the handbrake, ${both.distanceTo(knob()).toFixed(3)} m from the knob  ` +
  check(both.distanceTo(hbKnob) < both.distanceTo(knob()), "with both live, the hand went to the gear lever instead of the handbrake"));

// Every other caller passes no shift and must be exactly as it was.
const lean = kuwaitiDriver(undefined, undefined, true);
let threw = null; try { for (let i = 0; i < 10; i++) solveDriverRig(lean, 0.2, 0.5, 0, look, 1 / 60); } catch (e) { threw = e; }
console.log(`lean rig, no shift  ` + check(!threw, `a lean rig threw: ${threw}`));

if (fail.length) { console.error(`\n${fail.length} failed:\n  ${fail.join("\n  ")}`); process.exit(1); }
console.log("\nthe hand leaves the wheel for the lever and comes back.");
