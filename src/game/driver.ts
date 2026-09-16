import * as THREE from "three";
import type { DriverRig } from "./characters";
import { aimConstrained, solveTwoBone } from "./ik";
import { RIG } from "./rig";
import { stepSpring } from "./spring";

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
  handbrake = 0,
  /**
   * A gearchange in progress, signed: +1 is the peak of an upshift, -1
   * a downshift, 0 no shift. The caller shapes it as a PULSE that leaves
   * zero when the change begins and returns to it when the change ends
   * — the engine uses sin(pi * progress) over its own shift window — so
   * the hand flicks to the knob and back inside the time the revs take
   * to fall. Default 0: every caller that does not shift is untouched.
   */
  shift = 0
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
  //
  // As a SPRING, not a lerp. The car's own attitude is a mass on a
  // spring and overshoots; the body in it was a lerp and did not, so the
  // person always read stiffer than the car — backwards. Now the torso
  // is a damped pendulum on the hips and the belt (torsoK/C), and a
  // step of load is answered with one visible overshoot and a settle.
  // The fold is allowed past its braking figure by foldSpikeK for a
  // spike — a wall, not a pedal — and stopped there: the belt.
  const D = RIG.driver;
  const wantLean = THREE.MathUtils.clamp(-gLat / D.leanRefAccel, -1, 1) * D.leanPerG;
  const wantFold = THREE.MathUtils.clamp(-gLong / D.foldRefAccel, -1, D.foldSpikeK) * D.foldPerG;
  stepSpring(rig.leanS, wantLean, D.torsoK, D.torsoC, dt);
  stepSpring(rig.foldS, wantFold, D.torsoK, D.torsoC, dt);
  const foldMax = D.foldPerG * D.foldSpikeK;
  if (rig.foldS.x > foldMax) {
    rig.foldS.x = foldMax;
    rig.foldS.v = Math.min(0, rig.foldS.v);
  }
  rig.lean.rotation.z = rig.leanS.x;
  rig.lean.rotation.x = rig.foldS.x;
  // The shoulders turn into the corner a little ahead of the wheel.
  rig.lean.rotation.y = -steer * D.shoulderYawPerLock;
  // And breathe. The body group sits at the rig origin, so this is the
  // whole of its rest offset.
  rig.t += dt;
  rig.lean.position.y = D.breathAmp * Math.sin(2 * Math.PI * D.breathHz * rig.t);
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
  // so a fraction of the body's roll is taken back off the head, and of
  // its fold. Through a second spring (neckK/C), faster and less damped
  // than the torso's: the head arrives AFTER the shoulders, and on a
  // hit it whips. Written onto the crown, the head's own node under the
  // aimed neck, as plain angles — never onto the aimed quaternion.
  stepSpring(rig.headRollS, -rig.leanS.x * D.headCounter, D.neckK, D.neckC, dt);
  stepSpring(rig.headPitchS, -rig.foldS.x * D.headCounter, D.neckK, D.neckC, dt);
  rig.crown.rotation.set(rig.headPitchS.x, 0, rig.headRollS.x);

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

  // The gear lever. Guarded like the handbrake: lean rigs have a stub
  // that was never added to the scene, and a blend that is home and
  // being asked for nothing is work with no pixels. The direction is
  // latched while a shift is live so the lever does not flip as the
  // pulse passes back through zero.
  if (shift !== 0 || rig.shiftBlend > 1e-4) {
    if (shift !== 0) rig.shiftDir = Math.sign(shift);
    const want = Math.min(1, Math.abs(shift));
    rig.shiftBlend += (want - rig.shiftBlend) * Math.min(1, dt * RIG.driver.shiftRate);
    const rest = (rig.gear.userData.restRotX as number) ?? RIG.driver.gearTilt;
    rig.gear.rotation.x = rest + rig.shiftDir * RIG.driver.gearThrow * rig.shiftBlend;
    rig.gear.updateWorldMatrix(true, false);
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
    } else if (arm.side === inboard && rig.shiftBlend > 0.001) {
      // Same hand, second lever. The handbrake branch above wins when
      // both are live: a drift is deliberate and a gearchange is not,
      // and a hand torn between two grips ends up on neither. Only a
      // fraction of the way — see shiftReach — because a shift is a
      // flick, and a hand planted on the knob reads as a stall.
      _v2.set(0, RIG.driver.gearLen, 0);
      rig.gear.localToWorld(_v2);
      _v1.lerp(_v2, rig.shiftBlend * RIG.driver.shiftReach);
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

  // Feet on the pedals. The pedals sink with their press and the feet
  // are solved onto the moving faces, so a stab of brake reads all the
  // way down the driver's leg.
  //
  // ONE FOOT WORKS THROTTLE AND BRAKE. The right leg (side −1: side +1
  // puts the hip at local +x, the car's left) had the throttle and the
  // left leg the brake, permanently — every driver a left-foot braker
  // whose feet never met, in a cab with a floor shifter and therefore a
  // clutch. Now the right foot moves between the two faces, rolling
  // toward the throttle for a heel-and-toe downshift, and the left foot
  // rests on the dead pedal until a shift sends it to the clutch.
  if (rig.legs.length) {
    const P = rig.pedals;
    const press = (pedal: THREE.Object3D, amount: number) => {
      pedal.position.z = (pedal.userData.restZ as number) + amount * D.pedalTravelZ;
      pedal.position.y = (pedal.userData.restY as number) - amount * D.pedalTravelY;
      pedal.updateWorldMatrix(true, false);
    };
    // Heel-and-toe: a downshift under braking. The blip is the throttle
    // pedal dipping with the pulse while the foot stays on the brake.
    const shifting = rig.shiftBlend > 0.001;
    const wantHeelToe = shifting && rig.shiftDir < 0 && brake > D.heelToeBrake ? rig.shiftBlend : 0;
    rig.heelToe += (wantHeelToe - rig.heelToe) * Math.min(1, dt * D.clutchRate);
    press(P.throttle, Math.max(throttle, rig.heelToe * 0.6));
    press(P.brake, brake);
    press(P.clutch, shifting ? rig.shiftBlend : 0);
    press(P.rest, 0);
    rig.footBlend += ((brake > throttle ? 1 : 0) - rig.footBlend) * Math.min(1, dt * D.footSwapRate);
    rig.clutchBlend += ((shifting ? 1 : 0) - rig.clutchBlend) * Math.min(1, dt * D.clutchRate);
  }
  for (const leg of rig.legs) {
    const rightLeg = leg.side < 0;
    if (rightLeg) {
      _v1.setFromMatrixPosition(rig.pedals.throttle.matrixWorld);
      _v2.setFromMatrixPosition(rig.pedals.brake.matrixWorld);
      // Throttle to brake by the swap; then, from wherever that is, part
      // of the way back to the throttle for the blip.
      _v1.lerp(_v2, rig.footBlend);
      if (rig.heelToe > 0.001) {
        _v2.setFromMatrixPosition(rig.pedals.throttle.matrixWorld);
        _v1.lerp(_v2, rig.heelToe * D.heelToeReach);
      }
    } else {
      _v1.setFromMatrixPosition(rig.pedals.rest.matrixWorld);
      _v2.setFromMatrixPosition(rig.pedals.clutch.matrixWorld);
      _v1.lerp(_v2, rig.clutchBlend);
    }
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
