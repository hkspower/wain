// The wheels are not part of the body.
//
//   npm run test:suspension      (no browser, no dev server)
//
// The engine writes the body's roll and pitch onto the group the wheels
// are children of, so rolling the shell rolled the contact patches with
// it — the outer wheel driven down through the tarmac and the inner one
// lifted clear, by the half-track times the sine of the roll angle. The
// physics has modelled a suspension for a long time; the picture had
// none at all.
//
// The solve is closed-form, so these are exact rather than approximate,
// and the first section checks the arithmetic against three.js itself
// rather than against my own algebra written out twice.

import * as THREE from "three";
import { HANDLING as H } from "../src/game/handling.ts";
import {
  BODY_EULER_ORDER, WHEEL_EULER_ORDER, hubHeight, solveSuspension, steerAngles,
} from "../src/game/suspension.ts";
import { rollMaxFor, computeEffects, CARS } from "../src/game/mods.ts";
import { ATTITUDE, stepAttitude, stepOvershoot } from "../src/game/attitude.ts";
import { CITY_GROUND_Y, BUILDING_FOOTING_M } from "../src/game/track.ts";
import { readFileSync } from "node:fs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };
const F = (n, d = 1) => Number(n).toFixed(d);

// A real car's numbers: half-track and wheelbase from cars.ts, tyre
// radius from the rolling radius the engine uses.
const HX = 0.86, ZF = 1.45, ZR = -1.45, R = 0.33;
const wheels = [
  { x: -HX, z: ZF, restY: R }, { x: HX, z: ZF, restY: R },
  { x: -HX, z: ZR, restY: R }, { x: HX, z: ZR, restY: R },
];

// --- 1. The closed form agrees with three.js -------------------------
// The solve inverts the shell's own rotation matrix. If my algebra is
// wrong, everything below is confidently wrong together — so it is
// checked against the library that will actually apply the transform,
// with the rotation the engine ACTUALLY writes: yaw as well as roll and
// pitch, on the one node, in the order createCar gives it. The first
// version of this sweep built the parent with yaw 0 and so asserted the
// solver's premise instead of the engine's write; the engine had been
// yawing that node all along, and under three.js's default order the
// hubs were 121 mm off the road in a spin.
const YAWS = [0, -0.383, 0.383, -1.05, -2.58, Math.PI];
const hubErrorWith = (order) => {
  let worst = 0;
  for (let roll = -0.3; roll <= 0.3; roll += 0.017)
    for (let pitch = -0.3; pitch <= 0.3; pitch += 0.017)
      for (const yaw of YAWS)
        for (const w of wheels) {
          const y = hubHeight(w.restY, w.x, w.z, roll, pitch);
          const parent = new THREE.Object3D();
          parent.rotation.order = order;
          parent.rotation.set(pitch, yaw, roll);
          const child = new THREE.Object3D();
          child.position.set(w.x, y, w.z);
          parent.add(child);
          parent.updateMatrixWorld(true);
          worst = Math.max(worst, Math.abs(child.getWorldPosition(new THREE.Vector3()).y - w.restY));
        }
  return worst;
};
{
  const worst = hubErrorWith(BODY_EULER_ORDER);
  check(worst < 1e-9, `the solved hub height is off by ${worst} m at some attitude under ${BODY_EULER_ORDER}`);
  // ...and the sweep has teeth: under the default order it is wrong by
  // centimetres, so a shell that loses its order goes red here.
  const naive = hubErrorWith("XYZ");
  check(naive > 0.05, `the yaw sweep must catch the default order (worst ${F(naive * 1000, 0)} mm)`);
  console.log(
    `closed form vs three.js over ${1444 * YAWS.length} attitudes at six yaws: worst error ${worst.toExponential(1)} m ` +
    `under ${BODY_EULER_ORDER} (the default XYZ order is ${F(naive * 1000, 0)} mm out)`
  );
  // An AI car composes the same attitude as a quaternion: lookAt for the
  // yaw, then rotateX and rotateZ. That has to land the hubs in the same
  // place, or rivals would need a second solver.
  let worstQ = 0;
  for (const yaw of YAWS)
    for (const [roll, pitch] of [[0.1, 0.045], [-0.1, -0.02], [0.05, 0.03]])
      for (const w of wheels) {
        const parent = new THREE.Object3D();
        parent.lookAt(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)));
        parent.rotateX(pitch);
        parent.rotateZ(roll);
        const child = new THREE.Object3D();
        child.position.set(w.x, hubHeight(w.restY, w.x, w.z, roll, pitch), w.z);
        parent.add(child);
        parent.updateMatrixWorld(true);
        worstQ = Math.max(worstQ, Math.abs(child.getWorldPosition(new THREE.Vector3()).y - w.restY));
      }
  check(worstQ < 1e-9, `lookAt·rotateX·rotateZ puts a hub ${worstQ} m off the road`);
  console.log(`lookAt then rotateX, rotateZ (the AI cars) lands the same hubs: worst ${worstQ.toExponential(1)} m`);
}

// --- 1b. A wheel spins about its own axle ----------------------------
// Spin, steer and camber are three writes on one node. Whether the spin
// stays on the axle after the wheel is steered and cambered is purely a
// matter of the node's Euler order — and the default order does not.
{
  const axleDrift = (order, steer, camber) => {
    let worst = 0;
    const at0 = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, steer, camber, order));
    for (let spin = 0; spin <= Math.PI * 2; spin += Math.PI / 36) {
      const a = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(spin, steer, camber, order));
      worst = Math.max(worst, a.angleTo(at0));
    }
    return worst;
  };
  const camber = -rollMaxFor("sedan", "street") * (1 - H.suspCamberGain);
  const good = axleDrift(WHEEL_EULER_ORDER, H.roadWheelLock, camber);
  const bad = axleDrift("XYZ", H.roadWheelLock, camber);
  check(good < 1e-6, `under ${WHEEL_EULER_ORDER} the axle still wanders ${good} rad over a revolution`);
  check(bad > 0.5, `the default order should cone the axle by a large angle, got ${bad}`);
  // Spin still turns the wheel the right way: +z (the top of the tyre)
  // rolls forward onto −y... a quarter turn about +x takes +z to −y.
  const top = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(Math.PI / 2, 0, 0, WHEEL_EULER_ORDER));
  check(Math.abs(top.y + 1) < 1e-12, "a quarter turn of spin must take +z to −y under the wheel order too");
  console.log(
    `wheel order ${WHEEL_EULER_ORDER}: axle drift over a revolution at lock with camber ${F(good, 3)} rad ` +
    `(the default XYZ cones ${F((bad * 180) / Math.PI, 1)} deg)`
  );
}

// --- 1c. Ackermann ----------------------------------------------------
// The two fronts do not turn the same amount. The law is fixed by the
// wheelbase and the track and by nothing else, so that is what is
// asserted — on the geometry the sweep above uses.
{
  const L = ZF - ZR, T = 2 * HX;
  for (const inner of [H.roadWheelLock, -H.roadWheelLock, 0.1, -0.3]) {
    const a = steerAngles(inner, L, T);
    const [inn, out] = inner > 0 ? [a.plusX, a.minusX] : [a.minusX, a.plusX];
    check(Math.abs(inn - inner) < 1e-12, `the inside wheel must take the commanded angle, got ${inn} for ${inner}`);
    check(Math.sign(out) === Math.sign(inner) && Math.abs(out) < Math.abs(inner), `the outside wheel must turn less, the same way (${out} vs ${inner})`);
    const cot = (x) => 1 / Math.tan(Math.abs(x));
    check(Math.abs(cot(out) - cot(inn) - T / L) < 1e-9, `cot(outer) − cot(inner) must equal track/wheelbase, off by ${cot(out) - cot(inn) - T / L}`);
  }
  const straight = steerAngles(0, L, T);
  check(straight.minusX === 0 && straight.plusX === 0, "straight ahead must leave both fronts at zero");
  const noGeom = steerAngles(0.3, 0, 0);
  check(noGeom.minusX === 0.3 && noGeom.plusX === 0.3, "with no geometry both fronts fall back to the one angle");
  const a = steerAngles(H.roadWheelLock, L, T);
  console.log(
    `ackermann at lock on L ${F(L, 2)} m, T ${F(T, 2)} m: inside ${F((a.plusX * 180) / Math.PI, 1)} deg, ` +
    `outside ${F((a.minusX * 180) / Math.PI, 1)} deg (both were ${F((H.roadWheelLock * 180) / Math.PI, 1)})`
  );
}

// --- 2. A level car is untouched -------------------------------------
// The property that matters most: a car standing still must not be moved
// by any of this.
{
  const s = solveSuspension({ roll: 0, pitch: 0, wheels });
  for (const w of s) {
    check(w.y === R, `a level car moved a hub to ${w.y}`);
    check(w.camber === 0, `a level car cambered a wheel by ${w.camber}`);
    check(w.travel === 0 && !w.lifted, "a level car used suspension travel");
  }
  console.log("a level car is untouched: no travel, no camber, no lift");
}

// --- 3. What it was doing before, measured ---------------------------
// Welded to the shell, a wheel's contact patch moves by the half-track
// times sin(roll) plus the half-wheelbase times sin(pitch). This is the
// defect, in millimetres, on the numbers the game actually runs.
{
  // The real limits, read from the law rather than copied out of it:
  // the softest car the game builds is the street sedan with nothing
  // bolted on, and it leans 6.0 degrees. The fleet's worst gradient is
  // taken over every silhouette at street kit, because a kit only ever
  // stiffens. The pitch clamps come from attitude.ts, and both are
  // scaled by the springs' own overshoot: an underdamped shell peaks
  // PAST its target on a step, and the stroke has to cover the peak.
  const styles = ["sedan", "zx", "gtr", "rx7", "hatch", "pony"];
  const rollOver = stepOvershoot(ATTITUDE.rollK, ATTITUDE.rollC);
  const pitchOver = stepOvershoot(ATTITUDE.pitchK, ATTITUDE.pitchC);
  check(rollOver > 1.02 && rollOver < 1.1 && pitchOver > 1.02 && pitchOver < 1.1,
    `the springs should overshoot a few percent, got roll ${rollOver} pitch ${pitchOver}`);
  const MAX_ROLL = Math.max(...styles.map((st) => rollMaxFor(st, "street"))) * rollOver;
  const MAX_PITCH = ATTITUDE.pitchDiveMax * pitchOver, MIN_PITCH = ATTITUDE.pitchSquatMax * pitchOver;
  check(Math.abs(MAX_ROLL / rollOver - 0.1046) < 1e-3, "sanity: the softest car leans about six degrees");
  // ...and the analytic overshoot is what the integrator actually does:
  // step the real law to a roll and take its peak.
  {
    const a = { roll: 0, pitch: 0, rollVel: 0, pitchVel: 0 };
    let peak = 0;
    for (let i = 0; i < 240; i++) { stepAttitude(a, -1e9, 1e9, 0.1, 1 / 60); peak = Math.max(peak, a.roll); }
    // The integrator steps at 1/60 and lands a little under the
    // continuous peak; the envelope uses the analytic figure, which is
    // the conservative one.
    check(peak / 0.1 > 1.02 && peak / 0.1 <= rollOver + 1e-9 && rollOver - peak / 0.1 < 0.03,
      `integrated roll overshoot ${peak / 0.1} should sit just under the analytic ${rollOver}`);
    check(Math.abs(a.pitch - ATTITUDE.pitchSquatMax) < 1e-3, `a launch must settle at the squat clamp, got ${a.pitch}`);
  }
  // The same law the player's tune goes through: a fresh garage on a
  // race-kitted coupe must agree with rollMaxFor, and coilovers must
  // lower it — pinning that computeEffects and the AI cars read one law.
  const gtr = CARS.find((c) => c.id === "zeta-300-gtr");
  const fresh = { kd: 0, cars: [gtr.id], car: gtr.id, builds: { [gtr.id]: { owned: [], equipped: {} } } };
  const tuned = computeEffects(fresh, gtr.id);
  check(Math.abs(tuned.rollMax - rollMaxFor(gtr.style, gtr.kit)) < 1e-12,
    `computeEffects rollMax ${tuned.rollMax} disagrees with rollMaxFor ${rollMaxFor(gtr.style, gtr.kit)}`);
  check(rollMaxFor(gtr.style, gtr.kit, true) < rollMaxFor(gtr.style, gtr.kit), "coilovers must lower the lean");
  check(rollMaxFor("zx", "attack") < rollMaxFor("zx", "street"), "a kit must stiffen, never soften");

  const weldedRoll = HX * Math.sin(MAX_ROLL);
  const weldedPitch = Math.abs(ZR) * Math.sin(MAX_PITCH);
  check(weldedRoll > 0.04, "sanity: roll should move a contact patch by centimetres");

  // Every corner of the working envelope, not just one of them: roll and
  // pitch partially cancel on two wheels and add on the other two, and
  // the stroke has to cover the pair that add.
  let worst = 0;
  for (const roll of [-MAX_ROLL, MAX_ROLL])
    for (const pitch of [MIN_PITCH, MAX_PITCH])
      for (const w of solveSuspension({ roll, pitch, wheels })) {
        check(!w.lifted, "the working range must fit inside the stroke");
        worst = Math.max(worst, Math.abs(w.travel));
      }
  check(worst < H.suspStrokeM, `worst working travel ${F(worst * 1000, 0)} mm needs more than the ${H.suspStrokeM * 1000} mm stroke`);
  console.log(
    `welded: roll alone buried a patch ${F(weldedRoll * 1000, 0)} mm, pitch ${F(weldedPitch * 1000, 0)} mm; ` +
    `the solve moves a hub up to ${F(worst * 1000, 0)} mm at the springs' peak (${F((rollOver - 1) * 100, 1)}% roll, ` +
    `${F((pitchOver - 1) * 100, 1)}% pitch overshoot), inside a ${H.suspStrokeM * 1000} mm stroke`
  );
}

// --- 4. Only roll leans a wheel --------------------------------------
// Pitch turns the body about the axis the wheels spin on, so it moves
// nothing a viewer can see. This is a simplification the model is
// allowed to make, not one it gets away with, so it is asserted.
{
  const pitched = solveSuspension({ roll: 0, pitch: 0.2, wheels });
  for (const w of pitched) check(w.camber === 0, "pitch must not camber a wheel");
  const rolled = solveSuspension({ roll: 0.1, pitch: 0, wheels });
  for (const w of rolled)
    check(Math.abs(w.camber - -0.1 * (1 - H.suspCamberGain)) < 1e-12,
      `roll must lean the wheel back by all but the camber gain, got ${w.camber}`);
  console.log(`roll leans a wheel, pitch does not; ${H.suspCamberGain * 100}% of the lean is kept as camber`);
}

// --- 5. Camber gain is real, and bounded ------------------------------
{
  check(H.suspCamberGain > 0, "zero camber gain puts the car on casters");
  check(H.suspCamberGain < 1, "full camber gain is the welded wheel this replaces");
  const upright = solveSuspension({ roll: 0.1, pitch: 0, wheels, camberGain: 0 });
  check(Math.abs(upright[0].camber + 0.1) < 1e-12, "camberGain 0 must stand the wheel fully upright");
  const welded = solveSuspension({ roll: 0.1, pitch: 0, wheels, camberGain: 1 });
  check(welded[0].camber === 0, "camberGain 1 must reproduce the old welded wheel exactly");
  console.log("camber gain spans the two extremes: 0 stands it up, 1 is the old behaviour");
}

// --- 6. The stroke runs out, and says so ------------------------------
// A car at the limit lifts a wheel. Clamping silently would replace one
// lie with another, so the solve reports when it has run out of travel.
{
  const huge = solveSuspension({ roll: 0.6, pitch: 0, wheels });
  check(huge.some((w) => w.lifted), "an extreme attitude must report a lifted wheel");
  for (const w of huge)
    check(Math.abs(w.travel) <= H.suspStrokeM + 1e-9,
      `travel ${w.travel} exceeded the stroke ${H.suspStrokeM}`);
  const inner = huge.find((w) => w.travel > 0), outer = huge.find((w) => w.travel < 0);
  check(inner && outer, "one side must extend while the other compresses");
  console.log(`stroke ${H.suspStrokeM * 1000} mm: at 34 deg of roll the wheels hit their stops and report it`);
}

// --- 7. Nothing produces a NaN ----------------------------------------
// A NaN here does not throw, it deletes the wheels from the picture.
{
  let bad = 0;
  for (let roll = -1.5; roll <= 1.5; roll += 0.05)
    for (let pitch = -1.5; pitch <= 1.5; pitch += 0.05)
      for (const w of solveSuspension({ roll, pitch, wheels }))
        if (!Number.isFinite(w.y) || !Number.isFinite(w.camber) || !Number.isFinite(w.travel)) bad++;
  check(bad === 0, `${bad} non-finite results — a NaN here deletes the wheels rather than throwing`);
  // Straight up on its nose: cos(roll)cos(pitch) is zero and the divide
  // is guarded rather than allowed to produce Infinity.
  check(Number.isFinite(hubHeight(R, HX, ZF, 0, Math.PI / 2)), "a vertical car must not divide by zero");
  console.log("3,721 attitudes from -86 to +86 degrees, no NaN, and the degenerate divide is guarded");
}

// --- 8. Buildings stand on the ground, not above it -------------------
// The other half of the same problem. Every one of the 339 city blocks
// is placed by track.pose(), which returns the ROAD's height — and the
// city floor is not the road. It sits 80 mm below it so the two do not
// z-fight along the whole lap, so every building in the game had its
// base at y = 0 and floated 80 mm above the ground it stood on, with the
// dark floor visible underneath the entire skyline.
{
  const src = readFileSync("src/game/world.ts", "utf8");
  check(/p\.y = CITY_GROUND_Y - BUILDING_FOOTING_M/.test(src),
    "the building base must be set from the ground height, not left at the road's");
  check(!/ground\.position\.set\(2700, -0\.08,/.test(src),
    "the ground mesh must use the named constant, not the literal it was assumed away from");
  check(/ground\.position\.set\(2700, CITY_GROUND_Y,/.test(src),
    "the ground and the buildings must read the same number");

  const base = CITY_GROUND_Y - BUILDING_FOOTING_M;
  check(base < CITY_GROUND_Y, "the base must go below the floor, not rest on it");
  check(BUILDING_FOOTING_M > 0.05,
    "a base coplanar with the ground trades a visible gap for a z-fighting seam, which moves");
  // The roofline must not have moved: the parapet, plant and mast are all
  // placed at p.y + h, so sinking the base without growing the shaft would
  // drop the whole skyline by the footing depth.
  const hArch = 40;
  const hDrawn = hArch - base;
  check(Math.abs(base + hDrawn - hArch) < 1e-12,
    "sinking the base must leave the roofline exactly where it was");
  check(/const h = hArch - p\.y;/.test(src), "the drawn height must grow by exactly the sink");
  // ...and the stack thresholds must still see the architectural height.
  for (const t of ["podium: hArch > 42", "setback: hArch > 40", "mast: hArch > 70"])
    check(src.includes(t), `${t} must be decided on the real height, not the drawn one`);
  console.log(
    `buildings: base ${F(base * 1000, 0)} mm (was 0, floating ${F(-CITY_GROUND_Y * 1000, 0)} mm above a floor at ${F(CITY_GROUND_Y * 1000, 0)} mm); roofline unmoved`
  );
}

// --- 9. The orders are set where the nodes are built -----------------
// Everything above is a property of two constants; these make sure the
// game actually applies them to the nodes it rotates, and that the road
// wheels read the one lock.
{
  const cars = readFileSync("src/game/cars.ts", "utf8");
  const engine = readFileSync("src/game/engine.ts", "utf8");
  check(/w\.rotation\.order = WHEEL_EULER_ORDER;/.test(cars), "buildWheel must set the wheel group's Euler order from the constant");
  check(/group\.rotation\.order = BODY_EULER_ORDER;/.test(cars), "createCar must set the shell's Euler order from the constant");
  check(!/rotation\.order = "(XYZ|YXZ|YZX|ZXY|ZYX|XZY)"/.test(cars), "no wheel or shell order may be a string literal in cars.ts");
  check(/steerAngles\(steer, L, T\)/.test(engine), "spinWheels must split the steer by Ackermann");
  check(!/steerSmooth \* 0\.52/.test(engine), "the road-wheel lock must come from HANDLING, not a literal");
  check(/HANDLING\.roadWheelLock/.test(engine), "the player must steer the road wheels against HANDLING.roadWheelLock");
  check(!/MAX_ROLL/.test(engine), "the fleet-wide MAX_ROLL fallback is dead and must stay deleted");
  check(!/rollVel \+= \(\(rollTarget/.test(engine) && /stepAttitude\(this, latAccel, longAccel, this\.tune\.rollMax, dt\)/.test(engine),
    "the player must go through stepAttitude, not an inline copy of the springs");
  check((engine.match(/this\.poseAiBody\(/g) ?? []).length >= 4, "rival, cine rival, traffic and remotes must all pose through poseAiBody");
  check(!/\(dHead \/ 30\)/.test(engine) && !/asin\(THREE\.MathUtils\.clamp\(crossY[^]*asin\(THREE\.MathUtils\.clamp\(crossY/.test(engine),
    "one curvature law: curvatureAt, no second two-tangent formula");
  check(/steerSmooth \* HANDLING\.roadWheelLock/.test(engine) && (engine.match(/steerVis \* HANDLING\.roadWheelLock/g) ?? []).length >= 4,
    "player and every AI path must steer the road wheels against the one lock");
  check(!/\?\? TIRE_RADIUS/.test(engine), "spinWheels must not fall back to a constant radius");
  console.log("orders set in buildWheel and createCar; lock and Ackermann wired in spinWheels");
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
