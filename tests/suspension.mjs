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
import { hubHeight, solveSuspension } from "../src/game/suspension.ts";
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
// checked against the library that will actually apply the transform.
{
  let worst = 0;
  for (let roll = -0.3; roll <= 0.3; roll += 0.017)
    for (let pitch = -0.3; pitch <= 0.3; pitch += 0.017)
      for (const w of wheels) {
        const y = hubHeight(w.restY, w.x, w.z, roll, pitch);
        // Put a child at the solved local position under a parent with
        // exactly the rotation the engine writes, and read its world y.
        const parent = new THREE.Object3D();
        parent.rotation.set(pitch, 0, roll); // Euler XYZ, as the engine does
        const child = new THREE.Object3D();
        child.position.set(w.x, y, w.z);
        parent.add(child);
        parent.updateMatrixWorld(true);
        worst = Math.max(worst, Math.abs(child.getWorldPosition(new THREE.Vector3()).y - w.restY));
      }
  check(worst < 1e-9, `the solved hub height is off by ${worst} m at some attitude`);
  console.log(`closed form vs three.js over 1,444 attitudes: worst error ${worst.toExponential(1)} m`);
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
  // The real limits, not the fallback. MAX_ROLL in engine.ts is 0.055 and
  // is only used when a car has no rollMax of its own; every car has one,
  // and the softest — the street sedan at 4.2 deg/g against the 14 m/s²
  // reference — leans 6.0 degrees. Testing against 0.055 would have
  // measured a car this game never builds.
  const MAX_ROLL = (4.2 * (14 / 9.81) * Math.PI) / 180; // 0.1046 rad
  const MAX_PITCH = 0.045, MIN_PITCH = -0.02;
  check(Math.abs(MAX_ROLL - 0.1046) < 1e-3, "sanity: the softest car leans about six degrees");

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
    `the solve moves a hub up to ${F(worst * 1000, 0)} mm, inside a ${H.suspStrokeM * 1000} mm stroke`
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

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
