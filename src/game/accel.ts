// How hard a car pulls away, solved from the number on its card.
//
// THE PROBLEM THIS EXISTS TO FIX
//
// Every other headline figure a car has here is DATA the simulation is
// bent to hit. `topSpeedKmh` is a real governor and the thrust curve is
// solved so the car runs out of road exactly there. `lengthM` is a real
// length and the shell is scaled until it measures it. Acceleration was
// neither. It was `power`, a bare multiplier from 0.98 to 1.85 that
// appeared on no card, and the sim did not use it for what the name
// says: thrust came out at `19 * power`, which is 19 to 35 m/s², while
// the traction cap sits at 12 to 18. The cap was ALWAYS the lower of
// the two.
//
// So every car in the game launched at its own grip figure and `power`
// never bound on anything. tools/shots/accel.mjs measured the fleet and
// the consequences were exactly what that implies:
//
//   * The Black Demon reached 100 km/h in 1.16 s — 2.44 g, more than a
//     drag slick on prepared tarmac can transmit, and quicker than any
//     car that has ever been built.
//   * The Wain Special, the free car nobody chooses, pulled 1.04 g.
//     The whole fleet lived between 0.79 and 2.44 g where real road
//     cars span about 0.30 to 1.3.
//   * The order broke in FOUR places. The Jahra Pickup, a 195 km/h
//     truck, reached 100 quicker than eight cars above it including
//     every sport car below the Efreet, because the ordering you were
//     seeing was the ordering of `grip`, not of power.
//
// THE FIX, WHICH IS THE ONE THIS CODEBASE ALREADY MADE TWICE
//
// A car states its 0-100 and the thrust is solved so it gets there.
// Below is a forward integration of exactly the longitudinal model
// engine.ts runs at full throttle, and a bisection for the launch
// thrust that lands on the stated time. Kept as its own module and
// free of THREE so it can be checked in node against arithmetic rather
// than against a browser.

import { HANDLING as H } from "./handling";
import { gripAtSpeed } from "./grip";
import { GEARS, revFractionIn, upshiftAt } from "./gears";
import { torqueShape, type EngineSpec } from "./engines";

/** 100 km/h, in metres per second — the number every card is quoted to. */
export const HUNDRED_MS = 100 / 3.6;

/**
 * The car, as the launch model needs to know it.
 *
 * Deliberately small: the four things that decide a standing start and
 * nothing else. Anything that is not in here does not change a 0-100,
 * and a solver that took the whole tune would invite the belief that it
 * did.
 */
export interface LaunchCar {
  /** Where the thrust curve asymptotes — solved from the governor in
   *  engine.ts and passed in, because it is the same number. */
  ceiling: number;
  /** Static grip, m/s², and the wing that adds to it with speed. */
  gripAccel: number;
  downforce: number;
  /** What the driven axle can put down, as a fraction of grip. */
  tractionMult: number;
  /** What fraction of that grip the driven axle can deliver — see
   *  DRIVE_SHARE. The solver has to carry it or it would solve a launch
   *  against a cap the game does not use, and every card would be a
   *  promise the car misses the moment it breaks traction. */
  driveShare: number;
  /** The block. Its torque curve is most of why two cars with the same
   *  thrust figure do not do the same time. */
  engine: EngineSpec;
  /** Extra thrust at full boost, 0 for anything atmospheric. */
  boostMult: number;
  /** How fast the turbo spools: a twin fills in half the time. */
  twinTurbo: boolean;
}

/**
 * What the engine is giving at a road speed — the same pure chain
 * engine.ts walks every frame, and the reason the first cut of this
 * solver missed.
 *
 * That cut solved thrust as if torque were 1 throughout, and it was
 * not: the cars came out spread either side of their cards by up to
 * 23%, and the misses grouped by ENGINE. A 1.6 that makes its power at
 * 7,000 rpm is not making it at 2,000, and a standing start spends most
 * of its first gear at 2,000. Nothing about that is a fudge factor —
 * gearAt, revFractionIn and torqueShape are pure functions the game
 * already exports, so the solver can walk them rather than approximate
 * them.
 *
 * The launch blend is engine.ts's own: below 24 km/h the revs are
 * dragged toward the torque peak, because a car pulling away is
 * slipping a clutch rather than lugging from idle.
 */
export function torqueAtSpeed(engine: EngineSpec, kmh: number, gear: number): number {
  const gearRev = revFractionIn(gear, kmh);
  const launch = Math.max(0, 1 - kmh / 24);
  return torqueShape(engine, gearRev + (engine.peakAt - gearRev) * launch);
}

/**
 * The traction ceiling at a speed — engine.ts's own expression, with
 * the squat term at its nominal 1.
 *
 * driveScale is a live number: the springs compress under power and
 * press the driven axle down, and it settles somewhere between 1.0 and
 * about 1.2. Solving against 1.0 means a car makes its card WITHOUT the
 * help of its own squat, and beats it slightly with — which is the
 * right way round for a figure a showroom prints.
 */
function tractionAt(car: LaunchCar, v: number): number {
  return (
    gripAtSpeed(car.gripAccel, car.downforce, v) *
    (0.8 + 0.2 * Math.min(1, v / 22)) *
    car.tractionMult *
    car.driveShare
  );
}

/**
 * Time to 100 km/h for a given launch thrust, by forward integration of
 * the model engine.ts runs.
 *
 * The drag term carries the same 0.35 the engine applies on throttle:
 * an open throttle is not fighting the full coast-down figure, and a
 * solver that used the full one would over-thrust every car to
 * compensate for a force the game never applies.
 */
export function timeTo100(thrust: number, car: LaunchCar): number {
  const DT = 1 / 240;
  let v = 0;
  let boost = 0;
  // How long is left of the current upshift, and which gear we were in
  // when we last looked. A change costs torque for shiftUpTime, and two
  // of them happen below 100 km/h on every car in the fleet — the box
  // changes up at 55 and 95. Left out, the solver hands every car back
  // about a tenth of a second it does not have.
  let shiftLeft = 0;
  // The gear is HELD, and it only ever goes up.
  //
  // The first cut looked the gear up from the speed every step, and a
  // full-throttle launch got stuck at exactly 95 km/h forever: crossing
  // the shift point cut the torque, the cut dropped the car back below
  // the point, the lookup put it back in the lower gear, and the next
  // step shifted again. The car sat there oscillating between 0.47 and
  // 1.02 m/s² of thrust against 0.71 of drag until the solver gave up
  // and called the time infinite — which is what made the bisection
  // return nonsense for every car slow enough to be near a shift point
  // at 100 km/h.
  //
  // A gearbox does not do that, and engine.ts does not either: it holds
  // gearHeld and changes up when the speed passes the point for the
  // gear it is IN. upshiftAt is that rule, and it takes the engine's
  // own shiftAt, which is what makes a screamer hold a gear longer than
  // a torquey V8.
  let gear = 0;
  const spool = car.twinTurbo ? 2.6 : 1.5;
  for (let t = 0; t < 120; t += DT) {
    const kmh = v * 3.6;
    // The hysteresis is part of the shift point, not a detail of it.
    //
    // engine.ts changes up at upshiftAt() PLUS shiftHysteresisKmh —
    // the margin that stops a car sitting on a boundary from flipping
    // gear every frame. Leaving it out of the model shifted every car
    // a few km/h early, which costs nothing on a torquey V8 and a lot
    // on a peaky 1.6 that makes its power at the top of each gear: the
    // two cars in the fleet running the 1.6 came out 12 and 14 per cent
    // QUICKER than the solver had promised, and they were the only two
    // that missed.
    if (
      gear < GEARS.length - 2 &&
      kmh >= upshiftAt(gear, car.engine.shiftAt) + H.shiftHysteresisKmh
    ) {
      gear++;
      shiftLeft = H.shiftUpTime;
    }
    const shiftCut =
      shiftLeft > 0 ? 1 - (1 - H.shiftTorqueCut) * (shiftLeft / H.shiftUpTime) : 1;
    shiftLeft = Math.max(0, shiftLeft - DT);
    if (car.boostMult > 0) {
      const target = v > 4 ? 1 : 0;
      boost += (target - boost) * Math.min(1, DT * spool);
    }
    const push = Math.max(
      0,
      thrust *
        torqueAtSpeed(car.engine, kmh, gear) *
        shiftCut *
        (1 + boost * car.boostMult) *
        (1 - v / car.ceiling)
    );
    const drag = (0.0012 * v * v + 1.2) * 0.35;
    v = Math.max(0, v + (Math.min(push, tractionAt(car, v)) - drag) * DT);
    if (v >= HUNDRED_MS) return t + DT;
  }
  return Infinity;
}

/** The launch thrust the bisection is allowed to consider. The top is
 *  far above anything a car uses; it is there so a target nothing can
 *  reach fails as a clamp rather than as a hang. */
const THRUST_MIN = 0.5;
const THRUST_MAX = 400;

/**
 * The launch thrust that makes this car reach 100 km/h in `seconds`.
 *
 * Bisection rather than algebra because the model has a traction cap in
 * it, and a cap makes the thrust-to-time relation piecewise: below the
 * cap more thrust buys time linearly, above it more thrust buys nothing
 * at all until the car is quick enough to leave the cap behind. There
 * is no closed form worth trusting through that corner, and forty
 * halvings of a bracket cost nothing at tune time.
 *
 * A car whose target is quicker than its own tyres can deliver comes
 * back at THRUST_MAX and simply misses its card — which is the honest
 * outcome, and the same one topSpeedKmh has when a build lacks the
 * power to hold its governor.
 */
export function launchThrustFor(seconds: number, car: LaunchCar): number {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return 19;
  let lo = THRUST_MIN;
  let hi = THRUST_MAX;
  for (let i = 0; i < 44; i++) {
    const mid = (lo + hi) / 2;
    // More thrust is never slower, so the bracket is monotone.
    if (timeTo100(mid, car) > seconds) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * What a BUILD does to a hundred — the card is the stock car, and the
 * point of a garage is that the number moves.
 *
 * Takes the solved stock thrust and scales it by what parts have added,
 * which is the same arithmetic engine.ts does per frame. Cheap enough
 * to call from a React render: one forward integration at 240 Hz over
 * about ten seconds of simulated time.
 */
export function zeroTo100For(tune: {
  launchThrust: number;
  accelMult: number;
  stockAccelMult: number;
  topSpeedKmh: number;
  gripAccel: number;
  downforce: number;
  tractionMult: number;
  /** What fraction of that grip the driven axle can deliver — see
   *  DRIVE_SHARE. The solver has to carry it or it would solve a launch
   *  against a cap the game does not use, and every card would be a
   *  promise the car misses the moment it breaks traction. */
  driveShare: number;
  boostMult: number;
  aspiration: string;
  engine: EngineSpec;
}): number {
  const partsGain = tune.stockAccelMult > 0 ? tune.accelMult / tune.stockAccelMult : 1;
  const limitMs = tune.topSpeedKmh / 3.6;
  const thrust = tune.launchThrust * partsGain;
  const dragAtLimit = (0.0012 * limitMs * limitMs + 1.2) * 0.35;
  const headroom = 1 - dragAtLimit / thrust;
  return timeTo100(thrust, {
    ceiling: Math.max(115, headroom > 0.08 ? limitMs / headroom : limitMs * 12),
    gripAccel: tune.gripAccel,
    downforce: tune.downforce,
    tractionMult: tune.tractionMult,
    driveShare: tune.driveShare,
    engine: tune.engine,
    boostMult: tune.boostMult,
    twinTurbo: tune.aspiration === "twin",
  });
}

/**
 * Mean acceleration to 100 km/h, in g. What the number on the card
 * MEANS, for anything that wants to sanity-check a roster: a road car
 * lives between about 0.30 g (a supermini) and 1.3 g (a hypercar with
 * all four wheels driven and a launch mode).
 */
export function launchG(seconds: number): number {
  return HUNDRED_MS / seconds / 9.81;
}

/** Kept beside the model it belongs to so a port has one import for the
 *  whole of a standing start. */
export const LAUNCH_REF = {
  /**
   * The band a real road car's 0-100 falls in, in g. Used by the tests
   * to catch a roster that has drifted into fantasy.
   *
   * The floor is 0.20 rather than 0.25 because slow cars are slower
   * than people remember: a one-litre supermini takes about fourteen
   * seconds to 100, which is 0.20 g. Set at 0.25 it failed the free
   * starter car, which is not a car that should be failing a REALISM
   * check — it is the one car in the roster whose whole job is to be
   * slow.
   */
  minG: 0.2,
  maxG: 1.35,
  downforceRefSpeed: H.downforceRefSpeed,
} as const;
