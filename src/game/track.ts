import * as THREE from "three";

// One unit = one metre. The circuit is a closed night-highway loop
// (Gulf Road flavour): a long seaside straight on the east, sweepers
// inland through the city, and a fast desert kink in the north-west.

export const ROAD_HALF_WIDTH = 7; // 4 lanes, 3.5 m each
export const LANES = [-5.25, -1.75, 1.75, 5.25];

const CONTROL_POINTS: Array<[number, number, number]> = [
  [0, 0, 0],
  [320, 0, -40],
  [640, 0, -30],
  [950, 0, -140],
  [1180, 0, -380],
  [1260, 0, -700],
  [1180, 0, -1000],
  [920, 0, -1180],
  [580, 0, -1230],
  [240, 0, -1140],
  [-20, 0, -960],
  [-180, 0, -660],
  [-160, 0, -320],
  [-80, 0, -110],
];

const UP = new THREE.Vector3(0, 1, 0);

export class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;

  constructor() {
    this.curve = new THREE.CatmullRomCurve3(
      CONTROL_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      true,
      "centripetal"
    );
    this.curve.arcLengthDivisions = 3000;
    this.length = this.curve.getLength();
  }

  /** Wrap a distance-along-track into [0, length). */
  wrap(s: number): number {
    s %= this.length;
    return s < 0 ? s + this.length : s;
  }

  /** Signed shortest distance from `from` to `to` along the loop, in (-L/2, L/2]. */
  deltaAhead(from: number, to: number): number {
    let d = this.wrap(to) - this.wrap(from);
    if (d > this.length / 2) d -= this.length;
    if (d < -this.length / 2) d += this.length;
    return d;
  }

  pointAt(s: number, target: THREE.Vector3): THREE.Vector3 {
    return this.curve.getPointAt(this.wrap(s) / this.length, target);
  }

  tangentAt(s: number, target: THREE.Vector3): THREE.Vector3 {
    return this.curve
      .getTangentAt(this.wrap(s) / this.length, target)
      .setY(0)
      .normalize();
  }

  /** Unit vector pointing to the right of the direction of travel. */
  sideAt(s: number, target: THREE.Vector3): THREE.Vector3 {
    this.tangentAt(s, target);
    return target.cross(UP).normalize();
  }

  /** World position at distance `s`, offset `lateral` metres to the right. */
  pose(s: number, lateral: number, outPos: THREE.Vector3, tmp: THREE.Vector3): THREE.Vector3 {
    this.pointAt(s, outPos);
    this.sideAt(s, tmp);
    return outPos.addScaledVector(tmp, lateral);
  }
}
