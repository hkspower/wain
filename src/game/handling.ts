// The handling model's tuning constants, in one place so the UE5 data
// API and the C++ header generator publish exactly what src/game/engine.ts
// runs. engine.ts keeps its own local copies for hot-path clarity; the
// contract test in scripts/check-unreal-sync.mjs proves they agree.

export const HANDLING = {
  /** Accel-curve ceiling in m/s before per-car bonuses. */
  ceiling: 115,
  /** thrust = thrustK * power * (1 - v/ceiling) */
  thrustK: 19,
  /** drag = dragA * v^2 + dragB, scaled 0.35 while on throttle. */
  dragA: 0.0012,
  dragB: 1.2,
  /**
   * How fast raw steering input becomes effective lock, 1/s.
   *
   * 7 gave 329 ms to reach 90% of an input — ln(10)/7 — and the input
   * itself is instant: a key press sets steer to +/-1 in one frame, so
   * every millisecond of the delay was this smoother. Past about 150 ms
   * the car stops feeling attached to the wheel, which is exactly what
   * "turn-in is slow and vague" describes. 13 lands at 177 ms.
   *
   * Not higher. This same value feeds latDemand and the drift solver's
   * feint detection, so a twitchy rack does not just sharpen turn-in, it
   * moves where the friction circle bites and how easily a flick reads
   * as a feint.
   */
  steerSmoothRate: 13,
  /** Extra centring, 1/s at casterRefSpeed, when the wheel is released.
   *  A caster grows with road speed — that is what makes the wheel feel
   *  loaded rather than loose — so it scales with v and is worth nothing
   *  at a standstill. Declared here for years and read by nothing; the
   *  web build had no caster at all while the Unity port was handed the
   *  number as though it did. */
  casterRate: 2.4,
  /** m/s at which casterRate is delivered in full. */
  casterRefSpeed: 40,
  headingClamp: 0.45,
  /** Metres: how close you must be to flash a challenge. */
  flashRangeM: 60,

  driftMinSpeed: 14,
  driftAngleBase: 0.38,
  driftAngleSpeedK: 0.28,
  driftEngageRate: 3.4,
  driftRecoverRate: 2.3,
  /** The old hard ceiling on drift angle.
   *
   *  Nothing clamps with it any more, in either build. driftSpinAngle
   *  below replaced it, so an angle you cannot hold ends in a spin
   *  instead of parking against an invisible wall.
   *
   *  This carried a note for a long time saying the UE5 pawn still
   *  clamped with it — "the ports carry the numbers but not yet
   *  src/game/drift.ts" — which was true and unactionable, because the
   *  contract test compared constants and constants were never the
   *  problem. The port runs drift.ts now, as GRNSim.h, and
   *  tests/parity.mjs drives both builds through eight thousand steps of
   *  the same scripted driving and compares fourteen state variables to
   *  five parts in a trillion.
   *
   *  Left published because the Unity port has not been through the same
   *  treatment: GRNData.cs still carries the numbers, and whatever reads
   *  them there is not covered by that test. */
  driftYawClamp: 0.75,
  driftLatScrub: 0.5,
  driftDriveLoss: 1.1,

  // Drift, the rest of it (src/game/drift.ts). A slide is a balance held
  // on opposite lock, not an angle that settles at a cap.
  /** Angle (rad) past which the car counts as sliding rather than turning. */
  driftEstablished: 0.12,
  /** Extra opposite lock speeds recovery by this much per unit of lock. */
  driftRecoverCounterK: 3.2,
  /** rad/s the angle grows under full lock-into-slide and full throttle. */
  driftOverRotate: 0.42,
  /** rad/s opposite lock takes the angle back. Bigger than overRotate:
   *  a slide must always be catchable by a driver who reacts. */
  driftCounterRate: 2.6,
  /** Beyond this angle (rad) the slide accelerates itself. */
  driftCriticalAngle: 0.72,
  /** How hard it runs away past critical, per rad of excess. */
  driftRunawayRate: 1.6,
  /** Past this angle (rad) it is a spin and no input will save it —
   *  provided the car is still being rotated further out. Angle alone is
   *  not enough: a spin ends with the body normalised to where it is
   *  actually pointing, which is often still well past this, and on that
   *  rule alone the car tripped straight into another spin and then
   *  another. What makes it a spin is that it is still going. */
  driftSpinAngle: 1.05,
  /** rad/s of yaw, in the direction the body is already out, under which
   *  a big angle is a car sitting sideways rather than one leaving. */
  driftSpinTripRate: 0.05,

  // A spin is momentum, not a timer.
  //
  // It used to be a fixed sweep on a clock: 2.4 rad/s to a 2.2 rad stop,
  // held 1.15 s, and measuring it showed the consequence — losing it at
  // 300 km/h and losing it at 40 produced the identical event, 64
  // degrees of rotation in 1.15 seconds costing the same fraction of
  // speed. The car never went round. What follows is the rotation
  // itself: how much of it the car leaves with, what the sliding tyres
  // take back out, and what it costs while it lasts.
  /** rad/s a spin leaves with before speed is counted. */
  driftSpinEntryRate: 2.6,
  /** ...plus up to this much more, reached at driftSpinEntryRef. */
  driftSpinEntrySpeedK: 5.0,
  /** m/s at which the speed term is fully paid — about 280 km/h. Set
   *  from the measured ladder: at 56 the top two thirds of the speed
   *  range all saturated it, so losing it at 220 and losing it at 300
   *  came out within a tenth of a rotation of each other. */
  driftSpinEntryRef: 78,
  /** rad/s² the sliding tyres take back out of the rotation. Coulomb,
   *  so it decays linearly and the spin has a definite end. */
  driftSpinFriction: 1.5,
  /** ...times up to this much more as the car comes to a stop: there is
   *  less and less energy left to keep it turning. */
  driftSpinSlowK: 2.2,
  /** Extra damping per rad/s of yaw, so a violent spin sheds its first
   *  turn faster than its last. */
  driftSpinDamp: 0.16,
  /** Below this yaw rate (rad/s) the car has stopped rotating. */
  driftSpinEndRate: 0.5,
  /** Fraction of speed a spin sheds per second: a base for being out of
   *  control at all, plus this much scaled by how sideways the body
   *  actually is. A car pointing backwards down the road has its tyres
   *  aligned with where it is going and scrubs far less than one at 90. */
  driftSpinDragBase: 0.18,
  driftSpinDragK: 1.35,
  /** A spin cannot run for ever, whatever the arithmetic says. */
  driftSpinMaxTime: 6,
  /** Sideways scrub: fraction of speed lost per second, plus per rad. */
  driftScrubBase: 0.05,
  driftScrubK: 0.24,

  // Entries beyond the handbrake and the throttle.
  /** Rotation authority (0..1) over which a trailed pedal starts a slide.
   *  Set from the measured curve: a trailed pedal clears it, a buried one
   *  and a coasting entry do not. */
  driftBrakeEntry: 0.12,
  /** Trail-brake entries reach this fraction of the handbrake's angle. */
  driftBrakeAngleK: 0.45,
  /** Feint: lock reversal rate (1/s) and the load that must be on first. */
  driftFeintRate: 4.2,
  driftFeintLoad: 0.3,
  driftFeintMinSpeed: 20,
  /** Seconds a flick keeps the rear light, and how far it sends it. */
  driftFeintWindow: 0.45,
  driftFeintAngleK: 0.55,

  // Scoring. Angle times speed, stepped by linking one slide to the next.
  driftScoreK: 3.2,
  driftScoreMinDeg: 8,
  driftScoreMinSpeed: 12,
  /** Seconds a run stays live through centre — the linking window. */
  driftLinkWindow: 0.9,
  driftChainMax: 5,

  // Brakes (src/game/brakes.ts).
  /** Demand over the tyre's ceiling at which the wheels stop rotating. */
  brakeLockMargin: 1.0,
  /** Sliding friction as a fraction of peak: a locked tyre stops WORSE. */
  brakeSlideFriction: 0.72,
  /** Steering authority left on locked front tyres. */
  brakeLockSteer: 0.25,
  /** How fast lock builds and releases (1/s). */
  brakeLockRate: 12,
  /** ABS holds this fraction of the ceiling, and pulses at this rate. */
  absHold: 0.97,
  absHz: 14,
  /** °C per unit of brake power, and how fast the discs give it back.
   *  Cooling is deliberately slow — a disc sheds heat over tens of
   *  seconds, not fractions of one. Set fast enough to look plausible in
   *  isolation, it held the discs at a steady 60 °C through ten flat-out
   *  stops and fade could never happen at all. */
  brakeHeatK: 0.105,
  brakeCoolBase: 0.008,
  brakeCoolK: 0.0016,
  /** Fade begins here (°C over ambient) and is total by fadeFull. */
  brakeFadeStart: 320,
  brakeFadeFull: 620,
  /** Most pad force fade can take away. */
  brakeFadeMax: 0.45,
  /** Trail braking: rad/s of yaw per unit of rotation authority, and the
   *  speed below which there is no weight worth transferring. */
  brakeRotateK: 0.85,
  brakeRotateMinSpeed: 12,
  /** Engine braking off-throttle, m/s². */
  engineBrakeK: 2.4,

  // Weight transfer (src/game/grip.ts). The car pitches, the load moves,
  // and the grip goes with it: dive under braking presses the front
  // tyres in and lifts the rear off, squat under power does the reverse.
  // This is the difference between a car and a point mass with a grip
  // number, and none of it was modelled.
  /** Centre of gravity height and wheelbase, metres. Their ratio is the
   *  fraction of the car's weight that moves per g. */
  cgHeightM: 0.52,
  wheelbaseM: 2.62,
  /** Static split: a front-engined rear-driver carries a little more on
   *  the nose standing still. */
  staticFrontLoad: 0.53,
  /** How fast load actually moves, 1/s. This is the suspension, not a
   *  smoothing convenience — it is why trail braking is a technique and
   *  not a switch. */
  loadLagRate: 6.5,
  /** Most of the car's weight one axle may be given. Past this a wheel
   *  is off the ground and this is the wrong model for what happens. */
  loadClamp: 0.82,
  /** Grip goes as load^exp, sub-linear: a tyre carrying twice as much
   *  does not hold twice as much. */
  tyreLoadExp: 0.85,
  steerLoadExp: 0.6,
  /** Bounds on what transfer may do. Deliberately tight: uncapped, squat
   *  feeds traction feeds acceleration feeds squat, and that loop
   *  settles at a 1.7 g launch on road tyres. Load transfer is meant to
   *  change the BALANCE of the car, not its performance. */
  steerScaleMin: 0.8,
  steerScaleMax: 1.22,
  driveScaleMin: 0.7,
  driveScaleMax: 1.12,

  // Which wheels are driven (src/game/grip.ts, src/game/drift.ts).
  //
  // The load model above already computed how much of the car's weight
  // sits on each axle, and then handed `driveScale` the REAR share and
  // nothing else. That is a rear-wheel-drive car, hard-coded, and it was
  // the only car this game could describe — one machine in the showroom
  // is sold as an "AWD monster" in its own catalogue text and drove
  // exactly like the rear-driver beside it.
  //
  // Nothing here manufactures grip. A drivetrain decides which axle's
  // load the engine is allowed to use, and everything else follows from
  // the load transfer that was already being solved:
  //
  //   RWD  squats onto the driven axle under power. Traction RISES as it
  //        accelerates, which is why it launches well and why the tail
  //        comes round when the fronts are pointed somewhere else.
  //   FWD  squats OFF the driven axle. Traction FALLS exactly when the
  //        throttle asks for it — the reason a fast front-driver spins a
  //        wheel off the line — and the same tyres are steering, so
  //        power costs cornering. That is understeer, and it is not a
  //        penalty bolted on, it is two demands on one contact patch.
  //   AWD  uses both, so its traction barely moves with pitch at all.
  //        It pays for that with the transfer case.
  /** What reaches the road through an all-wheel-drive system, against
   *  the same engine driving one axle. A transfer case and a second
   *  differential cost a few percent in real cars. */
  awdDriveLoss: 0.96,
  /** How much of the front tyres' grip full throttle spends on a
   *  front-driver, leaving that much less for steering. */
  fwdThrottleSteerLoss: 0.3,
  /** Torque steer: the tug a powerful front-driver puts through the
   *  wheel under load, in radians of steer at full throttle. Small, and
   *  it is meant to be felt rather than fought. */
  fwdTorqueSteer: 0.045,
  /** How readily each drivetrain will break the rear loose on power.
   *  A front-driver essentially will not — it drifts on the handbrake
   *  and on a lift, which the drift solver already models. */
  powerOverRwd: 1,
  powerOverAwd: 0.45,
  powerOverFwd: 0.1,

  // Aerodynamic downforce (src/game/grip.ts).
  /** The speed at which a part's quoted downforce figure is delivered,
   *  m/s — about 250 km/h. It scales with v² either side of that. */
  downforceRefSpeed: 70,
  /** Ceiling on the aero contribution, m/s². A design limit rather than
   *  an aerodynamic one: past here the car stops sliding at all. */
  downforceMax: 6,

  // The tow (src/game/slipstream.ts). The wake behind another car:
  // lower pressure, slower relative wind, and a third off your drag if
  // you can hold station in it.
  /** Past this many metres behind, the wake is not worth modelling. */
  towReach: 26,
  /** Fraction of the aerodynamic drag term the deepest tow removes. A
   *  third to a half is where real numbers for a saloon sit; deeper and
   *  the game stops being about the driver. */
  towMax: 0.42,
  /** Metres of gap over which the wake decays by 1/e. */
  towFalloff: 9,
  /** Fraction of front-axle grip the dirty air takes at full tow. Small
   *  on purpose: it has to read as the nose going light on turn-in, not
   *  as a punishment. It is the only thing stopping the tow from being a
   *  button that says "go faster". */
  towDirtyAir: 0.06,
  /** Below this speed, m/s, there is no tow at all — drag rises with the
   *  square of speed, so what the wake is a fraction OF is negligible in
   *  town, and pretending otherwise tows cars out of car parks. */
  towMinSpeed: 8,
  /** Speed, m/s, at which the tow reaches full strength. */
  towFullSpeed: 30,
  /** Half-width of an ordinary car, m — the default wake half-width. */
  towDefaultHalfWidth: 0.9,
  /** How far past the bodywork the edge vortices carry the wake, m. */
  towEdgeSpread: 0.9,

  /** Lift-off oversteer: rear unloading past this counts as an entry,
   *  and it reaches this fraction of the handbrake's angle. Smaller than
   *  a trail-braked entry, because closing the throttle transfers less
   *  than standing on the middle pedal. */
  driftLiftEntry: 0.18,
  driftLiftAngleK: 0.3,

  // Tire model: one grip budget shared by drive, brakes and steering.
  /** Fraction of gripAccel the driven axle transmits at rest… */
  tractionBase: 0.8,
  /** …ramping to full by this speed (m/s). Excess torque is wheelspin. */
  tractionRampSpeed: 22,
  /** Brake ceiling = gripAccel * brakeGripK + brakeForce * brakePadK. */
  brakeGripK: 1.05,
  brakePadK: 0.25,
  /** Friction circle: braking lost to steering demand (and vice versa). */
  trailBrakeK: 0.6,
  latDemandSpeed: 40,
  understeerK: 0.35,
  /** Front tires scrub speed when held near the cornering limit. */
  cornerScrubK: 0.3,
  cornerScrubSpeed: 40,

  // Power-over: wheelspin + steering hangs the tail out sans handbrake.
  powerOverSpin: 1.2,
  powerOverSteer: 0.5,
  powerOverMinSpeed: 18,
  powerOverThrottle: 0.85,
  powerOverAngleK: 0.6,

  // Crashes: severity is the speed component into the obstacle.
  /** Lateral m/s into a wall that counts as a full-severity crash. */
  crashLatFull: 12,
  /** Fraction of speed a full-severity wall hit sheds at impact. */
  crashSpeedLossK: 0.28,
  /** Rebound shove off the barrier at full severity (m/s). */
  crashReboundK: 5,
  /** Closing speed on traffic that counts as a full-severity wreck. */
  trafficClosingFull: 22,
} as const;

export type Handling = typeof HANDLING;
