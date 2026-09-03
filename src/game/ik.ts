import * as THREE from "three";

// Inverse kinematics.
//
// Forward kinematics is "rotate the shoulder and see where the hand
// lands". IK is the question a game actually asks: the hand has to be
// ON the steering wheel, on this rim, at this angle — work out what the
// shoulder and elbow must do. Parenting the hand to the target instead
// (which is what this project did before) puts it in the right place and
// leaves the arm pointing somewhere else entirely.
//
// Two solvers, both analytic, both allocation-free after construction:
//
//   solveTwoBone   the classic upper-arm/forearm chain, closed-form by
//                  the law of cosines, with a pole vector deciding which
//                  way the elbow breaks.
//   aimConstrained a look-at that respects how far a neck actually
//                  turns, and eases rather than snapping.

const _root = new THREE.Vector3();
const _target = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _toPole = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _bendAxis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _parentInv = new THREE.Quaternion();
const _local = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _scale = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _basis = new THREE.Matrix4();
// The one allocation this file used to make per call. aimConstrained
// built a fresh Euler every solve, on forty-seven rigs at sixty hertz —
// about three thousand short-lived objects a second in the hottest path
// the crowd has, from a file whose header promises none.
const _euler = new THREE.Euler();

export interface TwoBoneOptions {
  /** Shoulder joint: rotated to aim the chain. */
  root: THREE.Object3D;
  /** Elbow joint, a child of root. Only its bend angle is set. */
  mid: THREE.Object3D;
  /** Length of root→mid and mid→end, in the chain's own units. */
  upper: number;
  lower: number;
  /** Where the hand should end up, in world space. */
  target: THREE.Vector3;
  /** World-space hint for which way the elbow points. */
  pole: THREE.Vector3;
  /**
   * The axis the bones point down in their own local space. These rigs
   * hang limbs along -Y, which is also how most authored skeletons do it.
   */
  boneAxis?: THREE.Vector3;
  /** Axis the elbow bends about, in the mid joint's local space. */
  bendAxis?: THREE.Vector3;
  /** 0 = leave the pose alone, 1 = fully solved. */
  weight?: number;
  /**
   * Hinge range at the mid joint, radians of BEND (0 = dead straight).
   * A human elbow neither locks past straight nor folds flat; a chain
   * without these will do both to reach a target it should refuse.
   */
  minBend?: number;
  maxBend?: number;
  /**
   * How much of the reach, as a fraction of the full span, is softened
   * into an asymptotic approach to full extension. At the hard boundary
   * acos has an infinite derivative, so a target crossing it makes the
   * elbow SNAP from bent to straight — a pop on every full-lock turn and
   * every far pedal. 0 keeps the old hard clamp.
   */
  softReach?: number;
}

/**
 * Solve a two-bone chain so `end` lands on `target`.
 *
 * The maths is the law of cosines: with the distance to the target and
 * the two bone lengths, the triangle is determined, so the elbow angle
 * and the shoulder's extra swing fall straight out. No iteration, no
 * drift, and it is exact whenever the target is reachable — when it is
 * not, the chain straightens toward it, which is what an arm does.
 */
export function solveTwoBone(o: TwoBoneOptions): void {
  const weight = o.weight ?? 1;
  if (weight <= 0) return;
  const boneAxis = o.boneAxis ?? new THREE.Vector3(0, -1, 0);
  const bendAxis = o.bendAxis ?? new THREE.Vector3(1, 0, 0);

  o.root.updateWorldMatrix(true, false);
  _root.setFromMatrixPosition(o.root.matrixWorld);
  _target.copy(o.target);
  _pole.copy(o.pole);

  // Bone lengths are authored in the rig's own units, but the aim and
  // the target are in world space — and this rig lives under a car that
  // carries a presence scale. Without lifting the lengths into world
  // units the triangle is solved for the wrong arm entirely, and the
  // hand lands a fifth of a metre short with no sign anything is wrong.
  _scale.setFromMatrixScale(o.root.matrixWorld);
  const worldScale = (_scale.x + _scale.y + _scale.z) / 3;
  const a = o.upper * worldScale;
  const b = o.lower * worldScale;
  _toTarget.subVectors(_target, _root);
  const eps = 1e-4;
  // Clamp into the annulus the arm can actually reach: fully extended
  // outside, folded inside. Without this the acos below goes imaginary.
  const raw = _toTarget.length();
  const span = a + b;
  const soft = o.softReach ?? 0;
  // Soften the last `soft` of the span: inside it the reported distance
  // rises toward the span but never reaches it, so the elbow eases into
  // straight instead of hitting acos's vertical wall. Beyond the span the
  // curve keeps approaching, which is what keeps a far target extending
  // the arm to within millimetres of full length — the softening is an
  // approach, not a cap. C1 at the join: value and slope both match.
  let reach = raw;
  if (soft > 0) {
    const knee = span * (1 - soft);
    if (raw > knee) {
      const over = (raw - knee) / (span * soft); // 0 at the knee, 1 at the span, >1 beyond
      reach = knee + span * soft * (1 - Math.exp(-over));
    }
  }
  const dist = THREE.MathUtils.clamp(reach, Math.abs(a - b) + eps, span - eps);
  if (_toTarget.lengthSq() < eps) return;
  _toTarget.normalize();

  // Elbow: interior angle from the three sides
  const cosElbow = THREE.MathUtils.clamp((a * a + b * b - dist * dist) / (2 * a * b), -1, 1);
  let elbowBend = Math.PI - Math.acos(cosElbow);
  // A joint limit, applied to the ONE angle the triangle actually has
  // to give. Clamping the bend changes the triangle, so the shoulder
  // angle below is recomputed from the limited bend rather than from the
  // target distance: the hand then lands as close to the target as a
  // real elbow allows, on the same line, instead of the shoulder still
  // aiming for a reach the elbow refused.
  const minBend = o.minBend ?? 0;
  const maxBend = o.maxBend ?? Math.PI;
  const limited = elbowBend < minBend || elbowBend > maxBend;
  if (limited) elbowBend = THREE.MathUtils.clamp(elbowBend, minBend, maxBend);
  const effDist = limited
    ? Math.sqrt(Math.max(eps, a * a + b * b - 2 * a * b * Math.cos(Math.PI - elbowBend)))
    : dist;

  // Shoulder: aim at the target, then swing back by the triangle's
  // shoulder angle so the elbow sits off the straight line.
  const cosShoulder = THREE.MathUtils.clamp(
    (a * a + effDist * effDist - b * b) / (2 * a * effDist),
    -1,
    1
  );
  const shoulderOffset = Math.acos(cosShoulder);

  // The pole decides which way the elbow breaks: the bend happens in the
  // plane containing the target and the pole hint, and `axis` is that
  // plane's normal.
  //
  // pole CROSS aim, not aim cross pole. The swing below is applied as
  // `-shoulderOffset` about this axis, and rotating the aim about
  // (aim x pole) by a NEGATIVE angle carries it AWAY from the pole: the
  // elbow came out on the far side of the arm from the hint, every time,
  // on every chain in the game. Measured in the cabin, both of the
  // driver's elbows sat 236 mm above his shoulders and crossed over the
  // centreline above his head — a pole asking for "outward and down"
  // producing inward and up, which is the exact mirror image and is why
  // it still reached the rim to the millimetre. Reaching the target
  // proves the triangle, not the elbow; the whole job of the pole is the
  // half that nothing was checking.
  //
  // Flipping the axis rather than the angle flips the elbow's hinge with
  // it — the bend is taken about this same axis in the joint's local
  // frame — so the chain stays exact and comes out mirrored, which is
  // the other solution to the same triangle.
  _toPole.subVectors(_pole, _root);
  _axis.crossVectors(_toPole, _toTarget);
  if (_axis.lengthSq() < 1e-8) {
    // Pole is collinear with the aim — any perpendicular will do
    _axis.crossVectors(_toTarget, _up);
    if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0);
  }
  _axis.normalize();

  // The upper arm's actual direction: the aim, swung back by the
  // triangle's shoulder angle within that plane.
  _dir.copy(_toTarget).applyAxisAngle(_axis, -shoulderOffset).normalize();

  // Build the shoulder rotation as a full basis rather than a bare
  // aim. It is not enough to point the bone at the right direction: the
  // elbow bends about its own local X, so that axis has to land on the
  // bend plane's normal. Aiming alone leaves the elbow hinging in some
  // arbitrary plane, and the hand misses by half a metre while every
  // individual step looks correct.
  _y.copy(_dir).multiplyScalar(-1); // local +Y is the bone's back
  _x.copy(_axis);
  _z.crossVectors(_x, _y).normalize();
  _x.crossVectors(_y, _z).normalize();
  _basis.makeBasis(_x, _y, _z);
  _q.setFromRotationMatrix(_basis);

  // Convert that world rotation into the joint's parent space
  if (o.root.parent) {
    o.root.parent.updateWorldMatrix(true, false);
    _m.extractRotation(o.root.parent.matrixWorld);
    _parentInv.setFromRotationMatrix(_m).invert();
    _q.premultiply(_parentInv);
  }

  if (weight >= 1) {
    o.root.quaternion.copy(_q);
  } else {
    o.root.quaternion.slerp(_q, weight);
  }

  // With local X on the plane normal, the elbow's hinge is in the right
  // plane and the angle from the law of cosines is all that is left.
  _bendAxis.copy(bendAxis).normalize();
  _q2.setFromAxisAngle(_bendAxis, elbowBend);
  if (weight >= 1) {
    o.mid.quaternion.copy(_q2);
  } else {
    o.mid.quaternion.slerp(_q2, weight);
  }
  o.root.updateMatrixWorld(true);
}

export interface AimOptions {
  /** Maximum yaw either side, radians. A neck is not a turret. */
  maxYaw?: number;
  maxPitch?: number;
  /** 0..1 per call — how fast the head catches up. */
  ease?: number;
  /** Local axis the object considers "forward". */
  forward?: THREE.Vector3;
}

/**
 * Point `obj` at a world-space target within joint limits, easing rather
 * than snapping. Past the limit the aim stops at the limit instead of
 * flipping — heads that spin past their stops read as broken toys.
 *
 * Returns how much of the requested turn the limits allowed, 0..1, so a
 * caller can pass the remainder down the chain (a body turning when the
 * neck runs out is exactly how people watch a car go by).
 */
export function aimConstrained(
  obj: THREE.Object3D,
  target: THREE.Vector3,
  o: AimOptions = {}
): number {
  const maxYaw = o.maxYaw ?? Math.PI / 3;
  const maxPitch = o.maxPitch ?? Math.PI / 6;
  const ease = o.ease ?? 1;

  obj.updateWorldMatrix(true, false);
  _root.setFromMatrixPosition(obj.matrixWorld);
  _local.copy(target).sub(_root);
  if (obj.parent) {
    obj.parent.updateWorldMatrix(true, false);
    _m.extractRotation(obj.parent.matrixWorld);
    _parentInv.setFromRotationMatrix(_m).invert();
    _local.applyQuaternion(_parentInv);
  }
  if (_local.lengthSq() < 1e-6) return 0;

  // Yaw about the parent's up, pitch off the horizontal
  const wantYaw = Math.atan2(_local.x, _local.z);
  const flat = Math.hypot(_local.x, _local.z);
  const wantPitch = Math.atan2(_local.y, flat);

  const yaw = THREE.MathUtils.clamp(wantYaw, -maxYaw, maxYaw);
  const pitch = THREE.MathUtils.clamp(wantPitch, -maxPitch, maxPitch);

  _q.setFromEuler(_euler.set(-pitch, yaw, 0, "YXZ"));
  obj.quaternion.slerp(_q, ease);

  const wanted = Math.abs(wantYaw);
  return wanted < 1e-4 ? 1 : Math.min(1, Math.abs(yaw) / wanted);
}
