// How a shell moves on its springs. One law, every car.
//
// The player's body has leaned out of corners and dived under braking
// since the roll came off cornering force (tests/body.mjs); the rival
// and the forty-six civilians never did. Their shells were oriented by
// lookAt alone, so a rival through the tightest bend on the lap sat
// dead flat while your own car leaned two degrees beside it, and its
// wheels — welded to that flat shell — never met a suspension either.
// The law lived inline in the engine's player update, bound to engine
// fields, and the only way to give it to another car was to copy it.
//
// This is that law, lifted out unchanged: the targets, the springs, the
// clamps. It writes into whatever Attitude it is handed, so the player's
// own fields and a rival's record go through the same arithmetic. The
// numbers were tuned against the player and are asserted in
// tests/body.mjs; the AI cars inherit them rather than being tuned
// twice.

export interface Attitude {
  /** Body roll, radians, as written to the shell's rotation.z. Leans OUT
   *  of the corner: the sign is asserted in tests/body.mjs. */
  roll: number;
  /** Body pitch, radians, as written to the shell's rotation.x. Positive
   *  is the nose down. */
  pitch: number;
  rollVel: number;
  pitchVel: number;
}

/**
 * The constants, named once. The pitch clamps and the roll reference
 * were literals in the engine, and the test that guards the suspension
 * stroke had to restate them to build its envelope — which meant it
 * stayed green whatever they became.
 */
export const ATTITUDE = {
  /** Lateral acceleration, m/s², at which the roll target saturates at
   *  the car's rollMax. 1.43 g — deliberately larger than life, because
   *  the lean is the thing a chase camera reads. mods.ts expresses each
   *  car's roll gradient against this same number. */
  rollRefAccel: 14,
  /** Radians of pitch per m/s² of longitudinal acceleration. */
  pitchPerAccel: 0.0039,
  /** The nose-down clamp: braking. */
  pitchDiveMax: 0.045,
  /** The nose-up clamp: launching. Less, because squat is stiffer than
   *  dive on any car with an engine over the driven axle. */
  pitchSquatMax: -0.02,
  /** Spring and damper on each axis. Slightly underdamped (ζ 0.69 roll,
   *  0.73 pitch) so a quick flick leaves the shell rocking for a beat
   *  the way a real one does. */
  rollK: 95,
  rollC: 13.5,
  pitchK: 120,
  pitchC: 16,
  /** The integrator's step is clamped so a dropped frame cannot make
   *  the springs explode. */
  maxStep: 1 / 30,
} as const;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/**
 * Lateral acceleration from what a car is doing: the rate at which its
 * direction of TRAVEL turns, times its speed. The road's curvature and
 * the change in slip angle are the two halves, and both are bookkeeping
 * a car already has rather than a new force.
 */
export function lateralAccel(curvature: number, speed: number, betaRate: number): number {
  return (curvature * speed + betaRate) * speed;
}

/** One frame of the springs. */
export function stepAttitude(a: Attitude, latAccel: number, longAccel: number, rollMax: number, dt: number): void {
  const A = ATTITUDE;
  const rollTarget = clamp(-latAccel / A.rollRefAccel, -1, 1) * rollMax;
  const pitchTarget = clamp(-longAccel * A.pitchPerAccel, A.pitchSquatMax, A.pitchDiveMax);
  const dts = Math.min(dt, A.maxStep);
  a.rollVel += ((rollTarget - a.roll) * A.rollK - a.rollVel * A.rollC) * dts;
  a.roll += a.rollVel * dts;
  a.pitchVel += ((pitchTarget - a.pitch) * A.pitchK - a.pitchVel * A.pitchC) * dts;
  a.pitch += a.pitchVel * dts;
}

/**
 * The peak a step input reaches on an underdamped spring, as a multiple
 * of the target: 1 + exp(−πζ/√(1−ζ²)). The suspension stroke has to
 * cover the overshoot, not just the clamp, so the test derives it here
 * rather than assuming the clamp is the peak.
 */
export function stepOvershoot(k: number, c: number): number {
  const zeta = c / (2 * Math.sqrt(k));
  if (zeta >= 1) return 1;
  return 1 + Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
}
