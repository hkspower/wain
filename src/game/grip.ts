import { HANDLING as H } from "./handling";

// Where the grip is, and how much of it there is.
//
// The model this joins already had a friction circle, a brake solver
// with lock, ABS and fade, and a full drift solver. What it did not have
// was the two things that make a car feel like a car rather than like a
// point mass with a grip number:
//
//   LOAD TRANSFER   The car pitches. Brake and the nose dives, which
//                   presses the front tyres into the road and lifts the
//                   rear off it; get on the power and it squats and does
//                   the reverse. Grip follows the load, so the SAME car
//                   turns in sharply on the brakes, pushes wide on the
//                   throttle, and steps its tail out if you lift in the
//                   middle of a corner. None of that was modelled: the
//                   car had one grip number and the pedals only changed
//                   how fast it was going.
//
//   DOWNFORCE       A wing works on air, and there is four times as much
//                   of it at twice the speed. The GT wing in the
//                   catalogue added a flat +0.5 m/s² of grip — the same
//                   +0.5 sitting in the garage as at 300 km/h — which is
//                   not a wing, it is stickier tyres with a spoiler
//                   drawn on. Here it is a v² term, so it does nothing
//                   at walking pace, something in third, and a great
//                   deal on the long coastal sweepers.
//
// Both are deliberately BALANCE changes rather than performance ones.
// Load transfer moves grip between the axles; it does not manufacture
// it, and the scales below are clamped tight enough that a launch is
// still a launch and a top speed is still a top speed. What changes is
// what the car does with the pedals mid-corner, which is the part a
// driver actually feels.

/** Free fall, for turning m/s² into g. */
const G = 9.81;

/** Carried between frames — one per car. */
export interface LoadState {
  /** Longitudinal acceleration in g, LAGGED. Positive under power,
   *  negative under braking. */
  pitchG: number;
}

export interface LoadInput {
  dt: number;
  /** This frame's longitudinal acceleration, m/s². Signed: drive minus
   *  brakes minus drag. */
  aLong: number;
}

export interface LoadResult {
  /** Fraction of the car's weight on each axle. They sum to 1. */
  front: number;
  rear: number;
  /** How much lighter than static the rear axle is, 0..1. This is what
   *  a lift-off entry is made of. */
  rearLight: number;
  /** Multiplier on steering authority — the front tyres' share. */
  steerScale: number;
  /** Multiplier on what the driven axle can put down. */
  driveScale: number;
  /** The lagged longitudinal g itself, for the body to dive and squat
   *  on. Reading the pitch off the same number that moved the grip is
   *  what keeps the picture and the physics telling one story. */
  pitchG: number;
}

export function newLoadState(): LoadState {
  return { pitchG: 0 };
}

/**
 * Solve one frame of weight transfer.
 *
 * The lag is not a smoothing convenience, it is the suspension. Load
 * takes a couple of tenths to move — springs compress, the body rotates
 * about its pitch axis — and that delay is precisely why trail braking
 * is a technique and not a switch: you release the brake gradually so
 * the front keeps its load while the corner loads it laterally instead.
 * Solved instantaneously the car would flip its balance on a one-frame
 * brake tap, which is twitchy in a way no car is.
 *
 * Using the PREVIOUS frame's transfer to scale this frame's grip is not
 * an approximation either. Load genuinely lags the input, so the causal
 * order is the physical one, and it removes what would otherwise be an
 * algebraic loop: traction depends on load, load depends on the
 * acceleration traction allowed.
 */
export function solveLoad(s: LoadState, i: LoadInput): LoadResult {
  const target = i.aLong / G;
  s.pitchG += (target - s.pitchG) * Math.min(1, i.dt * H.loadLagRate);

  // ΔW/W = a·h / (g·L). Under braking (negative g) the shift is forward.
  const shift = -s.pitchG * (H.cgHeightM / H.wheelbaseM);
  const cap = H.loadClamp;
  const front = Math.min(cap, Math.max(1 - cap, H.staticFrontLoad + shift));
  const rear = 1 - front;
  const staticRear = 1 - H.staticFrontLoad;

  // Tyre grip is sub-linear in load: doubling what a tyre carries does
  // not double what it will hold. That exponent is the whole reason a
  // car with all its weight on one axle grips less in total than one
  // that shares it, and it keeps the feedback loop below convergent.
  const clampScale = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const steerScale = clampScale(
    Math.pow(front / H.staticFrontLoad, H.steerLoadExp),
    H.steerScaleMin,
    H.steerScaleMax
  );
  // Clamped harder than the arithmetic asks for, on purpose. Uncapped,
  // squat feeds traction feeds acceleration feeds squat, and the fixed
  // point of that loop is a 1.7 g launch off a road tyre — convergent,
  // because of the exponent, and nonsense. Bounded here it is a nuance
  // in a straight line and a real effect in a corner, which is where it
  // belongs.
  const driveScale = clampScale(
    Math.pow(rear / staticRear, H.tyreLoadExp),
    H.driveScaleMin,
    H.driveScaleMax
  );

  return {
    front,
    rear,
    rearLight: Math.max(0, 1 - rear / staticRear),
    steerScale,
    driveScale,
    pitchG: s.pitchG,
  };
}

/**
 * Lateral grip at a given speed: the tyres, plus whatever the bodywork
 * is pressing them into the road with.
 *
 * `downforce` is quoted as the m/s² of extra grip the aero makes at
 * `downforceRefSpeed`, so a number in the catalogue means something you
 * can check against a lap rather than being an opaque coefficient. It
 * scales with v², which is what air does.
 *
 * The cap is not aerodynamic, it is a design limit: past a certain
 * point more downforce stops being interesting because the car simply
 * does not slide any more, and this is a street racing game.
 */
export function gripAtSpeed(gripAccel: number, downforce: number, speed: number): number {
  if (!(downforce > 0)) return gripAccel;
  const v = speed / H.downforceRefSpeed;
  return gripAccel + Math.min(H.downforceMax, downforce * v * v);
}

/** What the aero alone is contributing right now, for a readout. */
export function downforceGrip(downforce: number, speed: number): number {
  if (!(downforce > 0)) return 0;
  const v = speed / H.downforceRefSpeed;
  return Math.min(H.downforceMax, downforce * v * v);
}
