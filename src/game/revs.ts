// How fast the engine spins up and down under the driver's foot.
//
// The clutch hold in engine.ts — a standing launch reads the engine near
// its torque peak, not at the gearbox's 12% — was scaled by the raw
// throttle, and on a keyboard the throttle is 0 or 1. So the needle, the
// engine note and the high-rev shake all jumped from idle to the torque
// peak in ONE FRAME when the key went down, and fell back in one frame
// when it came up: measured on the starter car, 0.12 -> 0.88 of the dial
// between two frames, at 30, 60 and 144 Hz alike. Nothing with a
// flywheel does that.
//
// What is stepped here is that hold, not the revs. The gearbox side of
// the revs — rising through a gear, falling across a shift — is already
// a smooth function of speed and of the shift's own smoothstep, and a
// lag on the whole needle would leave it trailing a pull through first
// by a tenth of the dial and changing up before it got there.
//
// Critically damped, so the needle leaves the stop gently and arrives
// without bouncing, and solved in closed form over each frame, so a
// blip looks the same at every frame rate. The engine spins UP faster
// than it spins down: throttle is combustion pushing the crank, lift is
// only pumping losses and friction slowing it.
//
// The torque does NOT read this. The launch thrust of every car is
// solved (accel.ts) against the instant hold, and a 0-100 time is a
// number the garage prints; the inertia is in what the driver sees,
// hears and feels.

/** Spin-up and spin-down rates, 1/s. A step settles to 90% in 3.89/ω:
 *  0.28 s up, 0.43 s down — a free-revving engine, not a diesel. */
export const SPIN_UP = 14;
export const SPIN_DOWN = 9;

export interface Spin {
  /** How much of the clutch hold the engine has reached, 0..1. */
  x: number;
  /** And how fast it is getting there, per second. */
  v: number;
}

export function newSpin(x = 0): Spin {
  return { x, v: 0 };
}

/**
 * One frame of spin toward `target` (the throttle, 0..1), exact for a
 * target held across the frame: with e = x − target, the critically
 * damped e'' + 2ω e' + ω² e = 0 is (e0 + (e0' + ω e0) t) e^(−ωt).
 *
 * The rate is picked by where the target is, so a blip spins up at
 * SPIN_UP and a lift down at SPIN_DOWN; x and v carry across the switch,
 * so the needle never kinks. Clamped to 0..1 — reversing mid-sweep can
 * carry a little velocity past the target, and a hold past 1 would read
 * revs the engine does not have.
 */
export function stepSpin(s: Spin, target: number, dt: number): Spin {
  if (!(dt > 0) || !Number.isFinite(target)) return s;
  const w = target >= s.x ? SPIN_UP : SPIN_DOWN;
  const e0 = s.x - target;
  const b = s.v + w * e0;
  const k = Math.exp(-w * dt);
  s.x = target + (e0 + b * dt) * k;
  s.v = (s.v - w * b * dt) * k;
  if (s.x <= 0) { s.x = 0; if (s.v < 0) s.v = 0; }
  else if (s.x >= 1) { s.x = 1; if (s.v > 0) s.v = 0; }
  return s;
}

/**
 * The fastest the revs move on their own, in dial per second. The
 * quickest real sweep in the game is a shift's smoothstep, whose peak is
 * 1.5·drop/shiftTime — 4.8/s for the starter car's 0.7 drop into third
 * — and those frames are exempt anyway; a pull through first is under
 * 0.5/s and the spin-up above peaks under 4. Anything faster was put
 * there by something that is not the engine.
 */
export const REV_SLEW = 6;
/** How fast a jolt settles back out, 1/s — 90% gone in 0.28 s. */
export const JOLT_SETTLE = 14;

export interface Jolt {
  /** What the dial shows minus what the engine says, settling to 0. */
  off: number;
  v: number;
  /** The engine's revs last frame; NaN until the first one. */
  prev: number;
  /** How fast they were moving on their own, per second. */
  rate: number;
}

export function newJolt(): Jolt {
  return { off: 0, v: 0, prev: NaN, rate: 0 };
}

/**
 * The revs as shown, given the revs as solved.
 *
 * The gearbox revs are a pure function of road speed, and road speed
 * can change in one frame: a traffic shunt, measured putting 3.7 m/s on
 * the car between two frames and 0.33 of the dial on the needle with
 * it. A jump faster than REV_SLEW is carried as an offset — the whole
 * jump, not the part over the limit, so the response is the same at
 * every frame rate, less what the revs were already doing that frame,
 * so a shunt mid-pull does not freeze the pull — and the offset settles
 * out critically damped, so the needle swings to the new revs instead
 * of teleporting there.
 *
 * `shifting` exempts the frame: a shift is already a timed sweep.
 */
export function stepJolt(j: Jolt, revs: number, dt: number, shifting: boolean): number {
  if (!Number.isFinite(revs)) return revs;
  if (!(dt > 0)) return revs + j.off;
  if (Number.isFinite(j.prev) && !shifting) {
    const d = revs - j.prev;
    if (Math.abs(d) > REV_SLEW * dt) j.off -= d - j.rate * dt;
    else j.rate = d / dt;
  } else if (shifting) {
    j.rate = 0;
  }
  j.prev = revs;
  const w = JOLT_SETTLE;
  const b = j.v + w * j.off;
  const k = Math.exp(-w * dt);
  j.off = (j.off + b * dt) * k;
  j.v = (j.v - w * b * dt) * k;
  return revs + j.off;
}
