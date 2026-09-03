import * as THREE from "three";
import type { DriverRig } from "./characters";
import { aimConstrained, solveTwoBone } from "./ik";
import { RIG } from "./rig";

// The driver, solved.
//
// This lived as a private method on the engine, which meant the only
// place in the game with a driver whose hands were on the wheel was the
// place with an engine running. Everywhere else — the menu's rolling
// intro, the showroom turntable, the car behind the garage — put a
// fully rigged driver in the seat and never asked it for a pose, so the
// arms hung at the shoulders' rest angles and the feet floated above
// the pedals. In a wide showroom shot that is the first thing you see.
//
// It is a free function because it needs nothing from the engine: two
// scratch vectors, the rig, and the numbers. Anything that can build a
// car can now pose the person in it.

/** Scratch. Module-local because this runs several times a frame and
 *  allocating a Vector3 per solve is a garbage collector's problem. */
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * One driver rig, fully solved: the wheel to the steer angle, both
 * hands IK'd onto the rim where they grip it, both feet on the pedals
 * riding the press, eyes on the look target. Shared by every car that
 * carries a driver — the player's, the rival's, the remote cruisers'
 * — because a cabin with a mannequin bolted in it reads as an empty
 * car the moment it pulls alongside.
 */
export function solveDriverRig(
  rig: DriverRig,
  steer: number,
  throttle: number,
  brake: number,
  look: THREE.Vector3,
  dt: number,
  /** What the car is pulling, m/s^2: sideways, and along. The driver
   *  is a mass in a seat and this is what moves them. */
  gLat = 0,
  gLong = 0,
  /** How hard the handbrake is being pulled, 0..1. The inboard hand
   *  leaves the rim for the lever while this is up — the one move in
   *  the cab where a hand goes somewhere other than the wheel, and the
   *  move this game is named for. */
  handbrake = 0
): void {
  // The body first, because everything else is solved onto targets and
  // will follow it. Lean away from the cornering force and fold
  // forward under braking — the two things a driver's body does that
  // a parented pose can never show.
  //
  // The limbs are the point. Hands are solved onto grips ON the wheel
  // and feet onto the pedal faces, both of which are bolted to the car
  // and do not move with the driver, so leaning the torso makes the
  // arms and legs re-solve to stay where they are gripping. That is
  // what IK is for, and until now nothing had asked it for anything
  // except steering.
  const D = RIG.driver;
  const wantLean = THREE.MathUtils.clamp(-gLat / 14, -1, 1) * D.leanPerG;
  const wantFold = THREE.MathUtils.clamp(-gLong / 10, -1, 1) * D.foldPerG;
  const k = Math.min(1, dt * D.leanRate);
  rig.lean.rotation.z += (wantLean - rig.lean.rotation.z) * k;
  rig.lean.rotation.x += (wantFold - rig.lean.rotation.x) * k;
  // Lock-to-lock is about a turn and a half each way in a road car;
  // steer is -1..1, so this is the visible wheel angle.
  const lock = steer * RIG.driver.steerLock;
  rig.wheel.rotation.z +=
    (-lock - rig.wheel.rotation.z) * Math.min(1, dt * RIG.driver.wheelRate);

  // Eyes first: `look` may live in a scratch vector this method is
  // about to reuse for grips and poles.
  aimConstrained(rig.head, look, {
    maxYaw: RIG.driver.neckYaw,
    maxPitch: RIG.driver.neckPitch,
    ease: Math.min(1, dt * RIG.driver.neckRate),
  });
  // The neck fights the lean. A driver's head stays closer to level
  // than their shoulders do, which is why a helmet cam is watchable —
  // so take a fraction of the body's roll back off the head. After the
  // aim, because the aim sets yaw and pitch and this is roll.
  rig.head.rotation.z = -rig.lean.rotation.z * D.headCounter;

  // Ten-to-two, carried round with the rim. The grips are points ON
  // the wheel — fixed in its LOCAL frame — so localToWorld carries
  // them round as it turns. Adding rotation.z to the local angle as
  // well counts the wheel twice: the hands then orbit at double the
  // spoke rate and cross over each other at full lock.
  // The lever first, because the hand is solved onto wherever it is.
  // Pulled, it rises through its throw; the blend eases the hand between
  // rim and grip, and lives on the rig because this solver is a free
  // function with no other memory.
  // Guarded: forty-six lean rigs pass handbrake 0 every solve, and on
  // a lean rig the lever is a parentless stub that was never added to
  // the scene — easing it and walking its (one-node) matrix chain is
  // work with no pixels. The guard also documents that fact. The player
  // path is untouched: a pull runs it, and a release keeps running it
  // until the blend has eased home past the residue threshold.
  if (handbrake > 0 || rig.hbBlend > 1e-4) {
    const hbWant = THREE.MathUtils.clamp(handbrake, 0, 1);
    rig.hbBlend += (hbWant - rig.hbBlend) * Math.min(1, dt * RIG.driver.handbrakeRate);
    const rest = (rig.handbrake.userData.restRotX as number) ?? RIG.driver.handbrakeTilt;
    rig.handbrake.rotation.x = rest - rig.hbBlend * RIG.driver.handbrakeThrow;
    rig.handbrake.updateWorldMatrix(true, false);
  }

  rig.wheel.updateWorldMatrix(true, false);
  for (const arm of rig.arms) {
    const grip = arm.side < 0 ? RIG.driver.gripLeft : RIG.driver.gripRight;
    // Carried round with the rim only so far. The grips live in the
    // wheel's local frame, so its transform carries them with the FULL
    // wheel angle — right at road angles, wrong at lock, where a hand
    // carried 2.4 rad ends up at the bottom of the rim with the arms
    // crossed. A driver lets the rim slide through their grip past a
    // comfortable arc, so past gripCarryMax the excess rotation is
    // subtracted back inside the wheel's own frame: the hand holds its
    // station in the cab while the wheel turns underneath it, still on
    // the rim at every angle. Only the ride stops, not the grip.
    const rot = rig.wheel.rotation.z;
    const carried = THREE.MathUtils.clamp(rot, -RIG.driver.gripCarryMax, RIG.driver.gripCarryMax);
    const slide = carried - rot;
    _v1.set(
      Math.cos(grip + slide) * rig.wheelRadius,
      Math.sin(grip + slide) * rig.wheelRadius,
      0
    );
    rig.wheel.localToWorld(_v1);

    // The inboard hand answers the handbrake. Inboard is read from the
    // lever's own bolted side rather than assumed, so a left-hand-drive
    // rebuild of this rig gets the correct hand for free. The target
    // eases along the line between rim grip and lever grip, and both
    // ends are solved fresh each frame, so the hand tracks a turning
    // wheel AND a rising lever mid-blend.
    const inboard = Math.sign(RIG.driver.handbrakeX) || -1;
    if (arm.side === inboard && rig.hbBlend > 0.001) {
      _v2.set(0, RIG.driver.handbrakeLen, 0);
      rig.handbrake.localToWorld(_v2);
      _v1.lerp(_v2, rig.hbBlend);
    }

    // Elbows break outward and down — the pole is what stops a solved
    // arm from bending like a flamingo's knee. Offset in the rig's
    // own frame, so the pose holds whichever way the car is heading.
    _v2.set(arm.side * RIG.driver.armPoleX, RIG.driver.armPoleY, RIG.driver.armPoleZ);
    rig.group.localToWorld(_v2);

    solveTwoBone({
      root: arm.shoulder,
      mid: arm.elbow,
      upper: arm.upper,
      lower: arm.lower,
      target: _v1,
      pole: _v2,
      weight: 1,
      minBend: (RIG.driver.elbowMinDeg * Math.PI) / 180,
      maxBend: (RIG.driver.elbowMaxDeg * Math.PI) / 180,
      softReach: RIG.driver.softReach,
    });
  }

  // Feet on the pedals — throttle under the outboard foot in a
  // right-hand-drive car. The pedal itself sinks with the press and
  // the foot is solved onto the moving face, so a stab of brake reads
  // all the way down the driver's leg.
  for (const leg of rig.legs) {
    const pedal = leg.side > 0 ? rig.pedals.throttle : rig.pedals.brake;
    const press = leg.side > 0 ? throttle : brake;
    pedal.position.z = (pedal.userData.restZ as number) + press * RIG.driver.pedalTravelZ;
    pedal.position.y = (pedal.userData.restY as number) - press * RIG.driver.pedalTravelY;
    pedal.updateWorldMatrix(true, false);
    _v1.setFromMatrixPosition(pedal.matrixWorld);
    // Knees break up and forward, not sideways into the tunnel
    _v2.set(leg.side * RIG.driver.legPoleX, RIG.driver.legPoleY, RIG.driver.legPoleZ);
    rig.group.localToWorld(_v2);
    solveTwoBone({
      root: leg.shoulder,
      mid: leg.elbow,
      upper: leg.upper,
      lower: leg.lower,
      target: _v1,
      pole: _v2,
      weight: 1,
      minBend: (RIG.driver.kneeMinDeg * Math.PI) / 180,
      maxBend: (RIG.driver.kneeMaxDeg * Math.PI) / 180,
      softReach: RIG.driver.softReach,
    });
  }
}
