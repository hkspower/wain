// The wheels are not part of the body.
//
// This game has a suspension model in the physics — load moves across a
// pitching body, the springs have a time constant, the shell settles
// rather than arrives — and none of it reached the geometry. The wheels
// are children of the same group the engine rotates:
//
//     this.carBody.rotation.z = this.roll;
//     this.carBody.rotation.x = this.pitch;
//
// so rolling the body rolls the wheels with it. There is no suspension
// in the picture at all: the car is one rigid object that leans, and the
// contact patches lean with it. At full roll the outer wheel is driven
// down through the tarmac and the inner one is lifted clear of it, by
// the half-track times the sine of the roll angle — centimetres, on a
// wheel whose whole radius is about a third of a metre.
//
// What a suspension does is exactly the opposite of that. The SPRUNG
// mass — the shell, the glass, the interior, the lamps — rolls and
// dives. The UNSPRUNG mass — the hubs and the wheels — stays with the
// road, and the spring between them takes up the difference. That is an
// inverse-kinematics problem and it is the same shape as the driver's
// arms in ik.ts: a world-space constraint (the contact patch is on the
// road) solved backwards into a local transform (where the hub sits in
// the body's frame).
//
// Solved in closed form rather than iteratively, because with the body's
// yaw taken out it is a two-angle problem with an exact answer, and an
// exact answer cannot drift, oscillate or need a tolerance.
//
// WHY ONLY ROLL PRODUCES CAMBER
//
// Pitch rotates the body about its lateral axis — which is the axis the
// wheels spin on. Rotating a wheel about its own spin axis moves nothing
// a viewer can see: it is a circle, and it is already turning. So pitch
// changes where a hub SITS and not how a wheel LEANS, and only roll
// needs a camber correction. That is a real simplification rather than
// an approximation, and it is asserted in tests/suspension.mjs.

import { HANDLING as H } from "./handling";

/** A hub, in the body's own frame. */
export interface WheelPose {
  /** Lateral offset. Positive is the right-hand side of the car. */
  x: number;
  /** Longitudinal offset. Positive is forward. */
  z: number;
  /** Height of the hub above the road with the car level — the rolling
   *  radius of the tyre fitted to it. */
  restY: number;
}

export interface SuspensionInput {
  /** Body roll, radians, as written to the shell's rotation.z. */
  roll: number;
  /** Body pitch, radians, as written to the shell's rotation.x. */
  pitch: number;
  wheels: WheelPose[];
  /** Travel available each way, metres. Past it the wheel really does
   *  leave the road — a car at the limit lifts a wheel, and pretending
   *  otherwise would be a different lie from the one this replaces. */
  stroke?: number;
  /** How much of the body's lean the wheel is allowed to keep, 0..1.
   *  Zero stands every wheel bolt upright, which is as wrong in the
   *  other direction: real suspension gains a little negative camber as
   *  it compresses, and a car with none looks like it is on casters. */
  camberGain?: number;
}

export interface WheelSolve {
  /** Where the hub goes in the body's frame, so the contact patch stays
   *  on the road. */
  y: number;
  /** Lean to apply to the wheel itself, radians, about the car's
   *  longitudinal axis. */
  camber: number;
  /** Signed travel from rest, metres. Negative is compression. */
  travel: number;
  /** True when the stroke ran out and the wheel is genuinely off the
   *  road, rather than being held there by arithmetic. */
  lifted: boolean;
}

/**
 * Where a hub must sit for its contact patch to stay on a flat road.
 *
 * The shell's rotation is Euler XYZ with no yaw of its own — the yaw
 * lives on the node above it — so with three.js's own XYZ convention the
 * row of the matrix that produces world height is
 *
 *     worldY = cos(p)sin(r)·x + cos(p)cos(r)·y − sin(p)·z
 *
 * Setting worldY to the hub's rest height and solving for y is one line,
 * exact at any angle, and reduces to y = restY when the car is level —
 * which is the property that matters most, because it means a car
 * standing still is untouched by all of this.
 *
 * That row was written out by hand first and was wrong: the x term had
 * no cos(pitch) on it and the z term carried a cos(roll) that does not
 * belong, which put a hub 30 mm out at a combined attitude. Deriving a
 * rotation matrix from memory is exactly the kind of thing that looks
 * right on the page, so tests/suspension.mjs does not check this against
 * the same algebra written twice — it builds the parent and the child in
 * three.js, applies the rotation the engine actually writes, and reads
 * the world position back.
 */
export function hubHeight(restY: number, x: number, z: number, roll: number, pitch: number): number {
  const cr = Math.cos(roll);
  const cp = Math.cos(pitch);
  const denom = cr * cp;
  // cos(roll)·cos(pitch) only reaches zero if the car is on its side or
  // stood on its nose, neither of which this model produces; guarding it
  // costs nothing and turns a NaN that would silently delete the wheels
  // into a wheel that simply does not move.
  if (Math.abs(denom) < 1e-6) return restY;
  return (restY - cp * Math.sin(roll) * x + Math.sin(pitch) * z) / denom;
}

export function solveSuspension(i: SuspensionInput): WheelSolve[] {
  const stroke = i.stroke ?? H.suspStrokeM;
  const gain = i.camberGain ?? H.suspCamberGain;
  return i.wheels.map((w) => {
    const want = hubHeight(w.restY, w.x, w.z, i.roll, i.pitch);
    const travel = want - w.restY;
    const capped = Math.max(-stroke, Math.min(stroke, travel));
    return {
      y: w.restY + capped,
      // Cancel the body's roll, less whatever camber the geometry gains.
      // Pitch is deliberately absent: see the note at the top.
      camber: -i.roll * (1 - gain),
      travel: capped,
      lifted: Math.abs(travel) > stroke + 1e-9,
    };
  });
}
