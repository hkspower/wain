import * as THREE from "three";

// One unit = one metre. The circuit traces the real Gulf Road (شارع
// الخليج العربي): southbound along the corniche from Kuwait Towers at
// Ras Ajouza past Salmiya to the Ras Al-Ard point, then back north on
// the inland expressway. The sea hugs the entire coastal leg.

export const ROAD_HALF_WIDTH = 7; // 4 lanes, 3.5 m each
export const LANES = [-5.25, -1.75, 1.75, 5.25];

/** Fraction of the lap that runs along the coast (sea on the left). */
export const COAST_U = { from: 0.0, to: 0.46 };

const CONTROL_POINTS: Array<[number, number, number]> = [
  // Coastal leg — southbound, sea to the left (lower x), bays and points
  [800, 0, 0], // start: Ras Ajouza, Kuwait Towers
  [770, 0, -350], // Dasman curve
  [820, 0, -700], // Bneid Al-Gar
  [760, 0, -1100],
  [830, 0, -1500], // Salmiya marina bay
  [760, 0, -1950],
  [800, 0, -2350], // Scientific Center
  [850, 0, -2700],
  // Ras Al-Ard point — sweep east, away from the water
  [1050, 0, -2950],
  [1400, 0, -2900],
  // Inland return leg, northbound
  [1650, 0, -2500],
  [1700, 0, -2000],
  [1620, 0, -1400],
  [1700, 0, -800],
  [1650, 0, -300],
  // Top curve through the city back to the towers
  [1400, 0, 150],
  [1050, 0, 200],
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
