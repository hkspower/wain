// The drifting system.
//
// The old model had two ways in (handbrake, power-over) and exactly one
// way out: let go and the angle decays. There was no way to get it
// wrong, which meant there was nothing to get right — the tail came out
// to a cap, sat there, and came back. A drift you cannot lose is a
// costume, not a technique.
//
// What a drift actually is: the rear tyres are past their limit and the
// car is rotating faster than the corner. Everything after the entry is
// a balance between the throttle and the yaw, held on opposite lock. Let
// the angle build with no correction and it runs away; catch it too hard
// and it snaps back the other way. That instability IS the skill, and
// this module is that instability made explicit.
//
//   ENTRIES     handbrake, power-over, trail-brake, and the feint — a
//               fast flick away from the corner that loads the outside
//               tyres so they let go when you flick back.
//   SUSTAIN     steering into an established slide with throttle keeps
//               adding angle; opposite lock takes it away. Past the
//               critical angle the slide runs away on its own and only
//               counter-steer will save it.
//   SPIN        past the spin angle it is gone: the car rotates, sheds
//               speed, and takes the score with it.
//   CHAIN       reversing an established slide through centre links the
//               runs and steps a multiplier. Crash or spin and it resets.
//
// Pure over a small state object so tests can drive it and the ports can
// mirror the constants out of handling.ts.

import { HANDLING as H } from "./handling";

export interface DriftInput {
  dt: number;
  /** m/s. */
  speed: number;
  /** Smoothed steering, -1..1. */
  steer: number;
  /** 0..1. */
  throttle: number;
  handbrake: boolean;
  /** m/s² of torque the driven axle could not transmit. */
  wheelspin: number;
  /**
   * Which wheels are driven. Only the POWER entry reads it, and that is
   * the point: a front-driver spinning its wheels does not swing its
   * tail, it ploughs straight on. The handbrake, the trail-brake and the
   * lift-off entries all work on any car — they unload or lock the rear
   * axle, and every car has one of those whether or not it is driven.
   * That is why a front-driver can still be got sideways, just never
   * with the throttle.
   */
  drive?: "fwd" | "rwd" | "awd";
  /** Yaw impulse handed over by the brake solver — the trail-brake entry. */
  brakeRotate: number;
  /** How much lighter than static the rear axle is, 0..1, from the load
   *  solver. A closed throttle mid-corner transfers weight forward and
   *  takes it off the rear tyres, and a rear that light lets go: this is
   *  lift-off oversteer, and it is the entry every driver has used by
   *  accident before they ever used it on purpose. */
  rearLight?: number;
  /** Scales every angle in the model: drift tyres let the tail further out. */
  driftAngleMult: number;
}

/** Carried between frames. The engine owns one of these. */
export interface DriftState {
  /** Body rotation relative to the direction of travel, in radians. */
  angle: number;
  /** Points banked in the slide currently running. */
  run: number;
  /** 1..driftChainMax — steps on every link, resets on spin or crash. */
  chain: number;
  /** Seconds this spin has been running, 0 when in control. It counts
   *  UP now: a spin ends when the car stops rotating, not when a clock
   *  runs out, so there is no "left" to count down. */
  spinT: number;
  /** Yaw rate (rad/s, signed) while the car is away. This is the spin —
   *  everything else about it follows from how fast it is turning and
   *  what the tyres do to that. */
  spinRate: number;
  /** Radians swept since this spin began, for the readout that tells you
   *  how far round you went. */
  spinSwept: number;
  /** Seconds since the angle last left the scoring band, for linking. */
  sinceSlide: number;
  /** Which way the last scoring slide pointed: -1, 0 or +1. */
  lastSide: number;
  /** Previous frame's steering, for spotting a flick. */
  lastSteer: number;
  /** Seconds left of the window a flick opens. */
  feintT: number;
}

export interface DriftResult {
  angle: number;
  /** True while the car is away and not coming back. */
  spinning: boolean;
  /** True on the frame a spin begins — one shake, one sound. */
  spun: boolean;
  /** Fraction of speed scrubbed per second by sideways tyres. */
  scrubRate: number;
  /** Points added this frame (already multiplied by the chain). */
  gained: number;
  chain: number;
  /** Non-zero on the frame a run ends cleanly: the total to bank. */
  banked: number;
  /** True on the frame a transition links two slides. */
  linked: boolean;
  /** Camera jolt: a big angle dropped without correction snaps back. */
  jolt: number;
  /** How fast the car is rotating while it is away, rad/s. 0 otherwise. */
  spinRate: number;
  /** Degrees swept so far in this spin — what "how far did I go round"
   *  means, and the difference between a half spin and a 540. */
  spinDeg: number;
  /** What is holding the slide up, for the HUD and the coach. */
  entry: "" | "handbrake" | "power" | "brake" | "feint" | "lift";
}

export function newDriftState(): DriftState {
  return {
    angle: 0,
    run: 0,
    chain: 1,
    spinT: 0,
    spinRate: 0,
    spinSwept: 0,
    sinceSlide: 99,
    lastSide: 0,
    lastSteer: 0,
    feintT: 0,
  };
}

/** Fold an angle into (-pi, pi]. Where the car is pointing, rather than
 *  how many times it went round to get there. */
function normaliseAngle(a: number): number {
  const TAU = Math.PI * 2;
  let x = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  // (-pi, pi] rather than [-pi, pi): exactly backwards is one answer.
  if (x === -Math.PI) x = Math.PI;
  return x;
}

/** Lose the run and the multiplier — a wall, a spin, a wreck. */
export function breakChain(s: DriftState): void {
  s.run = 0;
  s.chain = 1;
  s.lastSide = 0;
  s.sinceSlide = 99;
}

export function solveDrift(s: DriftState, i: DriftInput): DriftResult {
  const { dt } = i;
  const mult = i.driftAngleMult;
  const out: DriftResult = {
    angle: s.angle,
    spinning: false,
    spun: false,
    scrubRate: 0,
    gained: 0,
    chain: s.chain,
    banked: 0,
    linked: false,
    jolt: 0,
    spinRate: 0,
    spinDeg: 0,
    entry: "",
  };

  // --- The feint. A hard flick away from the corner throws the weight
  // onto the outside tyres; flicking back drops it off them and the rear
  // lets go with no handbrake and no throttle. It is detected as what it
  // physically is — a fast reversal of lock at speed — rather than as a
  // button, so it stays a thing you do with the wheel.
  const prevSteer = s.lastSteer;
  const steerRate = dt > 0 ? (i.steer - prevSteer) / dt : 0;
  s.lastSteer = i.steer;
  // A reversal, not merely a fast hand: the wheel must have been loaded
  // one way and be coming back the other. Turning in hard from straight
  // is not a feint, it is turning in hard.
  const reversed =
    Math.abs(steerRate) > H.driftFeintRate &&
    Math.abs(prevSteer) > H.driftFeintLoad &&
    Math.sign(steerRate) === -Math.sign(prevSteer) &&
    i.speed > H.driftFeintMinSpeed;
  if (reversed) s.feintT = H.driftFeintWindow;
  else s.feintT = Math.max(0, s.feintT - dt);

  // --- A spin is not a state you steer out of. It runs its course —
  // and the course is momentum against friction, not a clock.
  //
  // Once the rear has gone at an angle the fronts cannot answer, the car
  // is a mass with angular momentum and four tyres sliding underneath
  // it. It keeps turning until they have taken the rotation back out.
  // That is why a spin at 300 goes round twice and a spin at 40 is a
  // half turn and a stall: it is the same physics reading two very
  // different amounts of energy.
  if (s.spinT > 0) {
    s.spinT += dt;
    const dir = Math.sign(s.spinRate) || Math.sign(s.angle) || 1;
    // Coulomb friction from four sliding contact patches: near enough
    // constant torque, so the rate falls linearly and the spin has a
    // definite end rather than an asymptote. It bites harder as the car
    // slows, because there is less and less energy left to turn it.
    const slow = 1 + H.driftSpinSlowK * (1 - Math.min(1, i.speed / H.driftSpinEntryRef));
    const brakeRate = H.driftSpinFriction * slow + Math.abs(s.spinRate) * H.driftSpinDamp;
    s.spinRate -= dir * brakeRate * dt;
    // Overshoot means it has stopped, not that it has changed direction.
    if (Math.sign(s.spinRate) !== dir) s.spinRate = 0;
    const step = s.spinRate * dt;
    s.angle += step;
    s.spinSwept += Math.abs(step);

    out.angle = s.angle;
    out.spinning = true;
    out.spinRate = s.spinRate;
    out.spinDeg = (s.spinSwept * 180) / Math.PI;
    // What a spin costs. Sideways tyres scrub; a car that has come round
    // to face backwards has them pointing along its own travel again and
    // scrubs much less, which is why this is |sin| and not a constant.
    out.scrubRate =
      H.driftSpinDragBase + H.driftSpinDragK * Math.abs(Math.sin(s.angle));
    out.chain = s.chain;

    if (Math.abs(s.spinRate) < H.driftSpinEndRate || s.spinT > H.driftSpinMaxTime) {
      s.spinT = 0;
      s.spinRate = 0;
      // Where the car ended up, not how far it travelled to get there.
      // Carrying 7 radians out of the spin would have the recovery
      // unwind the whole rotation backwards; a car that has been round
      // once is facing forwards and a car that has been round one and a
      // half is facing backwards, and those are the two answers that
      // exist.
      s.angle = normaliseAngle(s.angle);
    }
    return out;
  }

  const side = Math.sign(s.angle);
  const established = Math.abs(s.angle) > H.driftEstablished;
  // Lock opposed to the slide is counter-steer; lock into it feeds it.
  const opposite = established && Math.sign(i.steer) === -side ? Math.abs(i.steer) : 0;
  const into = established && Math.sign(i.steer) === side ? Math.abs(i.steer) : 0;

  // --- Entries. Each is a different way of getting the rear past its
  // limit, and each has its own reach: the handbrake takes the biggest
  // bite, the throttle a smaller one, the brakes and the flick smaller
  // still — they start slides rather than hold them.
  // How readily this car will break the rear loose on power. A
  // front-driver's spinning wheels are at the other end of the car from
  // the axle that would step out, so the threshold it has to clear is
  // ten times what a rear-driver's is — which in practice means it
  // never does, without saying "never" in a way that would need a
  // special case downstream.
  const powerBias =
    i.drive === "fwd" ? H.powerOverFwd : i.drive === "awd" ? H.powerOverAwd : H.powerOverRwd;
  const powerOver =
    i.wheelspin * powerBias > H.powerOverSpin &&
    Math.abs(i.steer) > H.powerOverSteer &&
    i.speed > H.powerOverMinSpeed &&
    i.throttle > H.powerOverThrottle;
  const trail =
    Math.abs(i.brakeRotate) > H.driftBrakeEntry && i.speed > H.driftMinSpeed;
  const feint = s.feintT > 0 && i.speed > H.driftFeintMinSpeed;
  // Lift-off. Ranked BELOW the trail-brake entry rather than beside it,
  // and that ordering is the whole distinction: standing on the brakes
  // also unloads the rear, so without it every trail-braked corner
  // would report itself as a lift. What is left when the brake entry
  // has taken its share is the real thing — a closed throttle, no
  // pedal, and the tail coming round on its own.
  const lift =
    (i.rearLight ?? 0) > H.driftLiftEntry &&
    i.throttle < 0.1 &&
    Math.abs(i.steer) > 0.2 &&
    i.speed > H.driftMinSpeed;

  let entryScale = 0;
  if (i.handbrake) { entryScale = 1; out.entry = "handbrake"; }
  else if (powerOver) { entryScale = H.powerOverAngleK; out.entry = "power"; }
  else if (trail) { entryScale = H.driftBrakeAngleK; out.entry = "brake"; }
  else if (feint) { entryScale = H.driftFeintAngleK; out.entry = "feint"; }
  else if (lift) {
    // Scaled by how light the rear actually is, so a gentle lift is a
    // hint of rotation and a snapped throttle is a moment.
    entryScale = H.driftLiftAngleK * Math.min(1, (i.rearLight ?? 0) / 0.4);
    out.entry = "lift";
  }

  let rate = 0;
  if (entryScale > 0 && i.speed > H.driftMinSpeed) {
    // Which way the tail is being sent. With lock on, it follows the
    // lock; with none, an entry sustains whichever slide is already up.
    const dir =
      Math.abs(i.steer) > 0.12
        ? Math.sign(i.steer)
        : trail
          ? Math.sign(i.brakeRotate)
          : side;
    if (dir !== 0) {
      const cap =
        (H.driftAngleBase + H.driftAngleSpeedK * Math.min(1, i.speed / 55)) *
        entryScale *
        mult;
      const target = dir * cap * Math.min(1, Math.abs(i.steer) + 0.45);
      // One-sided on purpose. The entry DRAGS the tail out to its angle;
      // it does not haul the car back in once the driver has sent it
      // further than that. Modelled as a two-way spring it was a safety
      // net nobody asked for — the restoring pull was stiffer than any
      // amount of over-rotation, so the angle parked at the cap and the
      // spin below could not be reached from any input. Past the target
      // you are out there on the throttle and the lock, and only those
      // decide what happens next.
      const beyond =
        Math.sign(s.angle) === dir && Math.abs(s.angle) > Math.abs(target);
      if (!beyond) rate += (target - s.angle) * H.driftEngageRate;
    }
  } else if (s.angle !== 0) {
    // Grip returns. Counter-steering straightens it faster and smoother;
    // a big angle dropped with no correction snaps back with a jolt.
    const prev = s.angle;
    rate -= (s.angle * (H.driftRecoverRate + opposite * H.driftRecoverCounterK)) / mult;
    if (Math.abs(prev) > 0.3 && Math.abs(prev + rate * dt) <= 0.3 && opposite < 0.2) {
      out.jolt = 0.18;
    }
  }

  // --- Sustain. This is the part that was missing, and it is the whole
  // game: an established slide is not a value that settles, it is a
  // balance you hold. Lock into the slide with throttle keeps rotating
  // the car with nothing to stop it; opposite lock is what stops it.
  if (established) {
    rate += side * into * (0.35 + i.throttle * 0.65) * H.driftOverRotate;
    rate -= side * opposite * H.driftCounterRate;
    // Past the critical angle the rear has no lateral force left to give
    // and the slide accelerates itself. Only counter-steer beats it.
    const excess = Math.abs(s.angle) - H.driftCriticalAngle * mult;
    if (excess > 0) rate += side * excess * H.driftRunawayRate;
  }

  s.angle += rate * dt;
  if (Math.abs(s.angle) < 0.005 && entryScale === 0) s.angle = 0;

  // --- Gone. Past the spin angle there is no counter-steer left that
  // would help, which is exactly why it is a threshold and not a clamp.
  // Still leaving, not merely out there. `rate` is this frame's yaw, so
  // a body that is already coming back — under counter-steer, or under
  // grip after a spin has set it down facing the wrong way — is not
  // spinning however far round it happens to be pointing.
  const leaving =
    Math.sign(rate) === Math.sign(s.angle) && Math.abs(rate) > H.driftSpinTripRate;
  if (leaving && Math.abs(s.angle) > H.driftSpinAngle * mult) {
    const dir = Math.sign(s.angle) || 1;
    // What the car leaves with. Two things decide it, and both are
    // things the driver did: how fast the body was already rotating when
    // it went — a slide you provoked violently spins harder than one you
    // slid into — and how much speed there was to turn into rotation.
    s.spinRate =
      dir *
      (Math.abs(rate) +
        H.driftSpinEntryRate +
        H.driftSpinEntrySpeedK * Math.min(1, i.speed / H.driftSpinEntryRef));
    s.spinT = dt || 1e-3;
    s.spinSwept = 0;
    breakChain(s);
    out.spun = true;
    out.spinning = true;
    out.angle = s.angle;
    out.spinRate = s.spinRate;
    out.scrubRate =
      H.driftSpinDragBase + H.driftSpinDragK * Math.abs(Math.sin(s.angle));
    out.chain = 1;
    return out;
  }

  // --- Scrub. Sideways tyres cost speed; throttle feeds some of it back.
  // Gated on actually being sideways: the base term is what a slide costs
  // just for existing, and applying it to a car pointing straight down the
  // road is a permanent 2%-a-second headwind. It cost the fastest cars in
  // the game twenty-six km/h of their governed top speed before anything
  // said so, because nothing in the drift model was visibly involved.
  out.scrubRate =
    Math.abs(s.angle) > H.driftEstablished
      ? (H.driftScrubBase + Math.abs(s.angle) * H.driftScrubK) *
        (1 - i.throttle * 0.55)
      : 0;

  // --- Score. Angle times speed, stepped by the chain, and the chain
  // steps every time a live slide is reversed through centre.
  const deg = (Math.abs(s.angle) * 180) / Math.PI;
  const scoring = deg > H.driftScoreMinDeg && i.speed > H.driftScoreMinSpeed;
  if (scoring) {
    const nowSide = Math.sign(s.angle);
    if (s.lastSide !== 0 && nowSide !== s.lastSide && s.sinceSlide < H.driftLinkWindow) {
      s.chain = Math.min(H.driftChainMax, s.chain + 1);
      out.linked = true;
    }
    s.lastSide = nowSide;
    s.sinceSlide = 0;
    out.gained =
      deg * ((i.speed * 3.6) / 100) * H.driftScoreK * s.chain * dt;
    s.run += out.gained;
  } else {
    s.sinceSlide += dt;
    // The window closed with the car straight: bank what the run earned
    // and put the multiplier back to one.
    if (s.run > 0 && s.sinceSlide >= H.driftLinkWindow) {
      out.banked = s.run;
      s.run = 0;
      s.chain = 1;
      s.lastSide = 0;
    }
  }

  out.angle = s.angle;
  out.chain = s.chain;
  return out;
}
