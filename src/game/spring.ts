// A damped spring, stepped.
//
// The car's attitude has been one of these since the roll came from
// cornering force (attitude.ts): a mass on a spring overshoots, and the
// overshoot is what the eye reads as weight. Everything sitting IN the
// car was a first-order lerp — the driver's torso, the head on it — and
// so was everything beside the road. A lerp arrives at its target and
// stops; nothing with mass does that. This is the law attitude.ts uses,
// pulled out so the driver and the verge can share it.
//
// Semi-implicit Euler, substepped. Stable while k·h² stays small: at
// the stiffest spring in the game (k ≈ 360) and MAX_STEP that product is
// 0.4, well inside the limit. The substep is a LOOP rather than a clamp
// because some callers hand in a quarter of a second of accumulated
// time — the traffic rigs solve on a rota — and a clamp would silently
// drop seven-eighths of it, leaving a civilian out of the rota leaning
// eight times slower than one in it.

/** Longest single integration step, seconds. */
export const MAX_STEP = 1 / 30;

/** Position and velocity, mutated in place. */
export interface SpringState {
  x: number;
  v: number;
}

/**
 * Advance one spring toward `target` over `dt`. Returns the state for
 * chaining. `dt >= 1` snaps: a rig being settled once at build time
 * (cars.ts hands the solver a whole second for exactly that) wants the
 * rest pose, not one second of ringing.
 */
export function stepSpring(s: SpringState, target: number, k: number, c: number, dt: number): SpringState {
  if (dt >= 1) {
    s.x = target;
    s.v = 0;
    return s;
  }
  const n = Math.max(1, Math.ceil(dt / MAX_STEP));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += ((target - s.x) * k - s.v * c) * h;
    s.x += s.v * h;
  }
  return s;
}

/**
 * The blend factor for a first-order lag of rate `rate` over `dt`.
 *
 * Everything in the rig that is not a spring is an exponential chase
 * toward a target, and every one of them was written as the linearised
 * `Math.min(1, dt * rate)`. That is the first term of the real answer,
 * and it is only close while `rate * dt` is small. It is not small: at
 * 30 fps the gear lever's rate of 22 gives 0.733 per frame against a
 * true 0.520, so a thirty-hertz player's hand moved to the knob half
 * again as fast as a sixty-hertz player's, and the clamp at 1 meant
 * every rate above 1/dt arrived INSTANTLY however slow it was meant to
 * be. The exponential is the closed form of the same differential
 * equation, integrated exactly, so the pose after a second of easing is
 * the same pose whatever the frame rate delivered it in.
 *
 * `dt >= 1` still snaps, for the same reason stepSpring does: cars.ts
 * settles a fresh rig by handing the solver a whole second and wants
 * the rest pose out of it, not a second of easing toward one.
 */
export function lagK(rate: number, dt: number): number {
  if (dt >= 1) return 1;
  return 1 - Math.exp(-rate * dt);
}

/**
 * The peak a step input reaches on an underdamped spring, as a multiple
 * of the target: 1 + exp(−πζ/√(1−ζ²)). The same figure attitude.ts
 * derives for the suspension stroke; here so a test can size what a
 * lean is allowed to overshoot by from the constants rather than from a
 * number somebody typed.
 */
export function stepOvershoot(k: number, c: number): number {
  const zeta = c / (2 * Math.sqrt(k));
  if (zeta >= 1) return 1;
  return 1 + Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
}

/** Natural frequency in Hz, for the comments and the tests. */
export function springHz(k: number): number {
  return Math.sqrt(k) / (2 * Math.PI);
}
