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
// exact answer cannot drift, oscillate or need a tolerance. Taking the
// yaw out is not free: it is a property of the ORDER the shell's three
// rotations are applied in, and the two orders this module fixes are
// below, with the reason each was chosen.
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

/**
 * Euler order of the shell — the group createCar returns, which the
 * engine yaws, pitches and rolls on the same node.
 *
 * three.js's default is XYZ, which composes Rx(pitch)·Ry(yaw)·Rz(roll):
 * the yaw sits BETWEEN pitch and roll, so the pitch is applied about the
 * road's lateral axis rather than the car's own. That was invisible
 * while the shell had no yaw, and false as soon as it did: with the body
 * at the 0.38 rad heading clamp a full dive leaned the car a degree the
 * roll law never asked for, and in a spin (yaw −2.6 rad, pitch 0.044) the
 * closed form below put a rear hub 121 mm below the road — measured in
 * the running game, tests/suspension.mjs reproduces it to the millimetre.
 *
 * YXZ composes Ry(yaw)·Rx(pitch)·Rz(roll): yaw outermost, then pitch
 * about the yawed car's lateral axis, then roll about its longitudinal
 * one. The world-height row of Rx·Rz is then untouched by the yaw and
 * hubHeight is exact at every heading. Roll is the innermost rotation
 * in both orders, so nothing that reads rotation.z changes.
 */
export const BODY_EULER_ORDER = "YXZ" as const;

/**
 * Euler order of a wheel group: rotation.x is the spin, rotation.y the
 * steer, rotation.z the camber — three writers, one node.
 *
 * Under the default XYZ the spin is applied LAST, about the body's
 * lateral axis, after steer and camber have moved the axle off it: a
 * front wheel at full lock cones through 60 degrees every revolution
 * (at half a turn it reads as steered the other way), and a cambered
 * wheel wobbles by twice its camber. At 14 revolutions a second that is
 * a flicker; in a car park at lock it is a coin spinning down.
 *
 * YZX is the knuckle in the order the metal has it: steer about the
 * hub's vertical, camber about the steered longitudinal, spin about the
 * axle that results. Measured axle drift over a revolution at steer
 * 0.52 with camber −0.084: XYZ 60.3°, YXZ 9.6° (camber still wobbles),
 * YZX 0.000°. The slots the engine writes do not change.
 */
export const WHEEL_EULER_ORDER = "YZX" as const;

/** A hub, in the body's own frame. */
export interface WheelPose {
  /** Lateral offset, toward +x. Which side of the car that is does not
   *  matter here: the solve is symmetric in it. */
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
  /** True when the stroke ran out: the hub is held at the end of its
   *  travel and the contact patch is no longer on the road. On the droop
   *  side that is a wheel in the air; on the bump side it is the shell
   *  on its stop with the old welded-wheel penetration back, capped.
   *  Nothing in the engine reads this — no car in the fleet reaches it
   *  (tests/suspension.mjs asserts the working envelope fits inside the
   *  stroke) — so it is the solver's honesty flag for that test, not a
   *  behaviour. */
  lifted: boolean;
}

/**
 * Where a hub must sit for its contact patch to stay on a flat road.
 *
 * The shell carries its own yaw — the engine writes rotation.y on the
 * same node as the roll and the pitch — but its Euler order is
 * BODY_EULER_ORDER, which applies that yaw OUTSIDE the other two. A yaw
 * about the world's vertical does not change a point's world height, so
 * the row of the matrix that produces height is the one of Rx(p)·Rz(r)
 * alone:
 *
 *     worldY = cos(p)sin(r)·x + cos(p)cos(r)·y − sin(p)·z
 *
 * The same row is exact for an AI car whose yaw comes from lookAt and
 * whose pitch and roll are then composed with rotateX and rotateZ: that
 * is Ry·Rx·Rz again, written as a quaternion.
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

/**
 * Ackermann: where each front wheel points for the car to turn about
 * one centre. The inside wheel runs a tighter arc than the outside one,
 * so it must turn further — by an amount that comes from the car's own
 * wheelbase and track and from nothing else:
 *
 *     cot(outer) − cot(inner) = track / wheelbase
 *
 * `inner` is the signed angle of the inside wheel, the one nearer the
 * turning centre, and the sign says which side that is: a positive
 * rotation.y turns a wheel's forward toward +x, so the turning centre
 * is on the +x side and the +x wheel is inside. Both fronts used to get
 * the same angle — 0.52 rad on each — which on a 2.65 m wheelbase and a
 * 1.81 m track is the outer wheel 10 degrees too far round, visible in
 * any low-speed front-quarter view.
 */
export function steerAngles(inner: number, wheelbase: number, track: number): { minusX: number; plusX: number } {
  const a = Math.abs(inner);
  if (a < 1e-9 || !(wheelbase > 0) || !(track >= 0)) return { minusX: inner, plusX: inner };
  const outer = Math.atan(wheelbase / (wheelbase / Math.tan(a) + track));
  return inner > 0 ? { plusX: a, minusX: outer } : { plusX: -outer, minusX: -a };
}
