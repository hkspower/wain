import * as THREE from "three";
import { chaseDolly, fromTan, MAX_HFOV, tanHalf, verticalFov } from "./aspect";
import { lagK } from "./spring";

// The camera's motion, as laws.
//
// This used to live inside the engine as four linearised lags, an
// explicit-Euler shake, a film lens eased by a fixed tenth PER FRAME with
// no dt at all, and a settle shot that still carried the chase arm from
// before the chase camera was brought in. None of it could be tested
// without a browser, and none of it was: the only suite that read camera
// state stepped at exactly 1/60, so every frame-rate dependence in here
// was invisible to it.
//
// So the laws are here, pure, the way the pursuit's are in police.ts and
// the rig's lags are in spring.ts, and a node test can drive them. The
// engine keeps what only it can do — ask the track where the car is,
// write the THREE camera, read the clock — and asks this module what
// the camera does about it.

/**
 * How far behind its target the chase camera rides, in SECONDS of the
 * target's own travel.
 *
 * THE FOLLOW WAS THE BIGGEST SPEED TERM IN THE SHOT, AND IT DEPENDED ON
 * THE FRAME RATE. The old follow was camBase.lerp(target, min(1, dt*5.5))
 * — a first-order lag chasing a point that moves at the car's speed. A
 * first-order lag of a moving point trails it by speed x its time
 * constant, so at 100 km/h the camera sat 4.6 m further back than the arm
 * said: eight times the arm's own speed term (0.02 m per m/s). And because
 * the step was the linearised min(1, dt*k), that trailing distance was
 * 4.12 m at 30 Hz and 4.84 m at 144 Hz. The shot a player saw depended on
 * their monitor.
 *
 * lagK would NOT have fixed it. The exponential is exact for a target
 * that holds still; this one moves between frames, and a lag that only
 * sees where it was at the frame boundaries still trails by a
 * frame-rate-dependent amount (0.35 m of spread at 100 km/h).
 *
 * So the follow is a critically damped second-order system — Unity's
 * SmoothDamp, with omega = 2 / FOLLOW_LAG — solved in CLOSED FORM over a
 * target moving in a straight line through the frame. That is exact for
 * constant velocity at any frame rate, it never overshoots, and unlike a
 * first-order lag it is continuous in VELOCITY, so a car that brakes or
 * gets shunted does not put a kink in the camera's motion.
 *
 * "Exact" is for a target moving at constant velocity through a frame,
 * which is what the chase target does on the cruise. Under acceleration
 * the frame's straight-line hold is an approximation of order a·dt², and
 * the answer differs between frame rates by that much: measured, 2.4 mm
 * between 30 and 144 Hz through a stop at 2.8 g, against 732 mm for the
 * old law on the same drive.
 *
 * The time constant is chosen to change nothing a 60 Hz player has ever
 * seen: 1/5.5 − 1/60 is exactly the trailing the old law settled to at
 * 60 Hz, and the steady trailing of this law is FOLLOW_LAG x speed. Under
 * acceleration it trails 0.25·τ²·a more than a first-order lag would —
 * about 5 cm on a hard launch, which is under the resolution of the eye
 * and stated here so nobody has to rediscover it.
 */
export const FOLLOW_LAG = 1 / 5.5 - 1 / 60;
const OMEGA = 2 / FOLLOW_LAG;

/** A target that moves further than this in one frame has been put
 *  somewhere, not driven there: a respawn, a teleport, a test staging a
 *  car. The follow re-seeds rather than chasing it across the map. */
export const CUT_JUMP = 20;
/**
 * Motion beyond what the target's own velocity accounts for, by more
 * than this in one frame, is a SHOVE — a wall pushing the car back onto
 * the road, a traffic shunt. It is carried as a translation of the whole
 * follow, not fed in as velocity: fed in as velocity, a 3 m push-out in
 * one frame reads as 180 m/s of target speed, and the response to it
 * depends on the frame rate that delivered it.
 */
export const SHOVE_M = 1.5;

/** The chase rate constants. The same numbers the old laws used, now
 *  applied as exact exponentials through lagK. */
export const RACE_FRAME_RATE = 2.5;
export const ROLL_RATE = 4;
export const FOV_RATE = 3;
/** Impact jolt energy decays at this rate, per second. */
export const SHAKE_DECAY = 3.5;
/** How fast the lens follows the picture's shape across a letterbox edge
 *  — the same rate as the race dolly, so the two walk in together. */
export const ASPECT_RATE = 2.5;

/** Where a cut can come from, and what it has to re-seed. */
export type Cut = "cut" | "handoff";

export interface Follow {
  /** Where the camera is. */
  x: THREE.Vector3;
  /** How fast it is moving. */
  v: THREE.Vector3;
  /** Where the target was last frame, and how fast it was going. */
  prev: THREE.Vector3;
  r: THREE.Vector3;
}

export function newFollow(): Follow {
  return { x: new THREE.Vector3(), v: new THREE.Vector3(), prev: new THREE.Vector3(), r: new THREE.Vector3() };
}

/** The steady-state position behind a target moving at velocity r. */
export function trailing(target: THREE.Vector3, r: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(target).addScaledVector(r, -FOLLOW_LAG);
}

/** Put the follow exactly where it would be if it had been following a
 *  target at velocity r forever: no slide after a cut. */
export function seedFollow(f: Follow, target: THREE.Vector3, r: THREE.Vector3): void {
  trailing(target, r, f.x);
  f.v.copy(r);
  f.prev.copy(target);
  f.r.copy(r);
}

const _e = new THREE.Vector3();
const _u = new THREE.Vector3();
const _du = new THREE.Vector3();
const _b = new THREE.Vector3();
const _step = new THREE.Vector3();
const _excess = new THREE.Vector3();

/**
 * One frame of the follow, solved exactly.
 *
 * With e = x − T and the target moving at r, the critically damped law
 * e'' + 2ω e' + ω² e = −2ω r has the particular solution −2r/ω and the
 * homogeneous one (a + b t) e^(−ωt). Everything below is that, per axis.
 *
 * Returns false when the step was refused — dt ≥ 1 or a target that
 * jumped past CUT_JUMP — and the caller must cut instead.
 */
export function stepFollow(
  f: Follow,
  target: THREE.Vector3,
  dt: number,
  /**
   * How fast the target SHOULD be moving right now, from the car's own
   * speed — the engine passes the rig's velocity at the current speed.
   *
   * A shove is motion the car's own speed does not explain, so it has to
   * be measured against the car's CURRENT speed. Measured against last
   * frame's estimate (the fallback, when this is omitted), a real one-frame
   * speed change — a rear-end that takes the car from 90 to 30 m/s — looks
   * like a shove at 30 Hz and below; the shove branch then hands back the
   * OLD velocity, fires again next frame against the same stale estimate,
   * and the camera trails a slowed car at the old speed's lag for as long
   * as it stays slow. Measured before this was fixed: 14.86 m behind at
   * 30 Hz where 60 Hz sat at 4.95.
   */
  expected?: THREE.Vector3
): boolean {
  if (!(dt > 0)) return true;
  if (dt >= 1) return false;
  _step.copy(target).sub(f.prev);
  if (_step.length() > CUT_JUMP) return false;
  // Anything the car's own velocity does not explain, past SHOVE_M, is a
  // translation of the whole shot.
  _excess.copy(_step).addScaledVector(expected ?? f.r, -dt);
  if (_excess.length() > SHOVE_M) {
    // Move the WHOLE follow — where the camera is and where it thinks the
    // target was — so the shove is invisible to the dynamics. Moving only
    // the camera leaves it the shove's distance from the target it is
    // chasing, and it then chases that error across the next half-second.
    f.x.add(_excess);
    f.prev.add(_excess);
    _step.sub(_excess);
  }
  const r = _step.divideScalar(dt); // velocity through this frame
  // u = e − e_p, with e_p = −2r/ω.
  _e.copy(f.x).sub(f.prev);
  _u.copy(_e).addScaledVector(r, 2 / OMEGA);
  _du.copy(f.v).sub(r); // e' = x' − r
  _b.copy(_du).addScaledVector(_u, OMEGA);
  const k = Math.exp(-OMEGA * dt);
  // u(dt) = (u0 + b dt) k ;  u'(dt) = (u0' − ω b dt) k
  const uX = _u.clone().addScaledVector(_b, dt).multiplyScalar(k);
  const uV = _du.clone().addScaledVector(_b, -OMEGA * dt).multiplyScalar(k);
  f.x.copy(target).add(uX).addScaledVector(r, -2 / OMEGA);
  f.v.copy(r).add(uV);
  f.prev.copy(target);
  f.r.copy(r);
  return true;
}

/** Exponential ease of a scalar toward a target, exact at any frame rate. */
export function lagTo(value: number, target: number, rate: number, dt: number): number {
  return value + (target - value) * lagK(rate, dt);
}

/** Impact jolt energy after dt. Exact: the old explicit-Euler step went
 *  negative past dt = 1/3.5 and was only saved by a clamp. */
export function decay(shake: number, dt: number): number {
  return shake * Math.exp(-SHAKE_DECAY * Math.max(0, dt));
}

/**
 * The chase arm, in metres back along the road and up from it.
 *
 * One function, used by the live chase camera AND the film's settle shot.
 * The settle used to carry its own copy — 9.5 m back and 3.4 m up, the
 * arm from before the chase camera was brought in — so the camera jumped
 * 3.23 m forward and 0.60 m down at the start of every battle. A second
 * copy of a number is a second number.
 */
export function chaseArm(
  speed: number,
  closeView: boolean,
  designFov: number,
  lensAspect: number,
  raceFrame: number,
  raceDolly: number
): { back: number; up: number } {
  const reach = closeView ? 0.78 : 1;
  const raceTight = 1 + (raceDolly - 1) * raceFrame;
  return {
    back: (6.3 + speed * 0.02) * reach * chaseDolly(designFov, lensAspect) * raceTight,
    up: (2.8 + speed * 0.007) * (closeView ? 0.8 : 1),
  };
}

/** The lens the chase is asking for: speed stretch and launch kick. */
export function fovTarget(base: number, speed: number, topSpeed: number, throttle: number): number {
  const launchKick = throttle * THREE.MathUtils.clamp(1 - speed / 40, 0, 1) * 5;
  return base + (speed / topSpeed) * 18 + launchKick;
}

/**
 * The vertical field to hand three.js, for a designed lens, the shape the
 * lens is currently framed for, and the shape of the picture right now.
 *
 * `lensAspect` is where the framing IS; `aspect` is the canvas. They are
 * the same thing except while a letterbox edge is being eased across, and
 * then the backstop against the REAL aspect still holds, so the shot is
 * never wider than MAX_HFOV on screen even mid-transition. Settled, this
 * is verticalFov(design, aspect) bit for bit.
 */
export function lensFov(design: number, lensAspect: number, aspect: number): number {
  const v = verticalFov(design, lensAspect);
  if (!(aspect > 0) || !Number.isFinite(aspect)) return v;
  const maxTv = tanHalf(MAX_HFOV) / aspect;
  return tanHalf(v) > maxTv ? fromTan(maxTv) : v;
}

/** Ease the framed aspect toward the real one, in log space so a change
 *  from 21:9 to 16:9 and back takes the same time. */
export function easeAspect(lensAspect: number, aspect: number, dt: number): number {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return lensAspect;
  if (!(lensAspect > 0) || !Number.isFinite(lensAspect)) return aspect;
  return Math.exp(lagTo(Math.log(lensAspect), Math.log(aspect), ASPECT_RATE, dt));
}

/** The chase roll for a given moment of the car. */
export function rollTarget(heading: number, speed: number, topSpeed: number, slipVel: number, driftYaw: number): number {
  return (
    THREE.MathUtils.clamp(heading * (speed / topSpeed), -0.5, 0.5) * 0.14 +
    THREE.MathUtils.clamp(slipVel * 0.012, -0.03, 0.03) +
    THREE.MathUtils.clamp(driftYaw * 0.1, -0.13, 0.13)
  );
}

// ------------------------------------------------------------ the film

/** The film's resting lens. */
export const FILM_FOV = 58;
/** The world's speed during the film, as a fraction of real time. */
export const FILM_SLOWMO = 0.22;
/**
 * How close to the end of the film a skip has to come for the camera to
 * be HANDED to the chase rather than cut to it.
 *
 * A hand-off is only continuous if the settle shot has nearly finished
 * settling. Skipped early — two seconds out — the film camera is still
 * off to one side of the car, looking at a point beside it, and handing
 * over from there moves the position smoothly while the AIM whips round
 * by up to 36 degrees in one frame. A whip with a continuous position
 * reads as a glitch; a clean cut reads as an edit. So anything before
 * this is an edit.
 */
export const HANDOFF_WINDOW = 0.6;

/** The settle shot's ease: quadratic out, zero slope at the end so the
 *  pose arrives moving with the car rather than stopping on it. */
export function filmEase(k: number): number {
  const x = THREE.MathUtils.clamp(k, 0, 1);
  return 1 - (1 - x) * (1 - x);
}

/**
 * How fast the world runs at this point in the film.
 *
 * Slow motion through the shots, ramping back to real time across the
 * settle, instead of the old single-frame switch at the green flag: the
 * frame the film ended, the car's per-frame travel jumped 4.5x, and a
 * camera handed over perfectly in position still showed the road
 * suddenly lurch forward under it.
 */
export function filmTimeScale(filmT: number, settleFrom: number, filmLen: number): number {
  if (filmT <= settleFrom) return FILM_SLOWMO;
  const k = filmEase((filmT - settleFrom) / (filmLen - settleFrom));
  return THREE.MathUtils.lerp(FILM_SLOWMO, 1, k);
}

/** Whether leaving the film at this moment hands the camera over or
 *  cuts it. */
export function filmExit(filmT: number, filmLen: number): Cut {
  return filmT >= filmLen - HANDOFF_WINDOW ? "handoff" : "cut";
}

/** The film's lens at this moment: resting through the shots, walking to
 *  the chase's own lens across the settle so the hand-off is continuous
 *  in the lens as well as in the position. A function of film time, not
 *  a per-frame ease — the old blend moved a tenth of the way PER FRAME,
 *  so it converged 2.4x faster at 144 Hz than at 60. */
export function filmFov(filmT: number, settleFrom: number, filmLen: number, chaseFov: number): number {
  if (filmT <= settleFrom) return FILM_FOV;
  return THREE.MathUtils.lerp(FILM_FOV, chaseFov, filmEase((filmT - settleFrom) / (filmLen - settleFrom)));
}
