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
  steerSmoothRate: 7,
  casterRate: 2.4,
  headingClamp: 0.45,
  /** Metres: how close you must be to flash a challenge. */
  flashRangeM: 60,

  driftMinSpeed: 14,
  driftAngleBase: 0.38,
  driftAngleSpeedK: 0.28,
  driftEngageRate: 3.4,
  driftRecoverRate: 2.3,
  driftYawClamp: 0.75,
  driftLatScrub: 0.5,
  driftDriveLoss: 1.1,
} as const;

export type Handling = typeof HANDLING;
