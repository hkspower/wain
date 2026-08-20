import * as THREE from "three";

// One unit = one metre. The circuit is two real Kuwaiti roads joined
// end to end.
//
// OUT — Gulf Road, شارع الخليج العربي: southbound along the corniche
// from Kuwait Towers at Ras Ajouza past Salmiya to the Ras Al-Ard
// point. The sea hugs the whole leg.
//
// BACK — the Second Ring Road, الدائري الثاني, officially Khalid
// Yousef Al-Marzouq Street: a 7 km, 80 km/h arc that leaves Gulf Road,
// swings inland around the city through Shuwaikh Residential, Shamiya,
// Mansuriya, Da'iya and Dasma, and returns to Gulf Road. The stretch
// between Da'iya and Dasma is شارع الحب, Love Street.
//
// The return leg used to be an invented expressway. What makes this one
// the real road rather than a differently-shaped invention:
//
//   * Both its ends land on Gulf Road. That is the defining fact about
//     the Second Ring and it is why it fits a lap at all.
//   * Its proportion. The real road runs 7 km across a coastal chord of
//     roughly 4.6 km — an arc-to-chord ratio near 1.52, which is within
//     a couple of degrees of a semicircle, and is how Kuwait's ring
//     roads were laid out: concentric arcs struck from the old town out
//     to the seafront. The leg below is a 174° arc at exactly that
//     ratio, so it is the same ROAD at this map's scale rather than the
//     same number of metres. (The corniche is compressed too: 8-ish
//     real kilometres of Gulf Road are 3.4 km here.)
//   * Its districts, in the order you actually pass them.
//
// Note on provenance, because it changes how much to trust the numbers:
// this centreline is reconstructed from the road's published route and
// proportions, not traced from survey data. Overpass, OpenStreetMap and
// Wikipedia are all blocked by this environment's egress policy, so no
// real coordinates could be fetched. The shape, the sequence and the
// junctions are right; the individual control points are not surveyed.

export const ROAD_HALF_WIDTH = 7; // 4 lanes, 3.5 m each
export const LANES = [-5.25, -1.75, 1.75, 5.25];

/** The Sharq drift circle: the corniche swells into a round plaza with
 *  a kerbed island to slide around, seaward of the through lanes. */
export const DRIFT_PLAZA = {
  /** Centre of the plaza, metres from the start line — inside Sharq.
   *  Metres and not a lap fraction: everything on the coastal leg has a
   *  fixed distance from the start and a lap fraction that moves the
   *  moment anything is done to the OTHER leg. Rebuilding the return
   *  leg as the Second Ring lengthened the lap from 7.34 km to 8.49 km,
   *  which as fractions would have slid this plaza, Kuwait Towers,
   *  Green Island, the Scientific Center and the Ras Al-Ard lighthouse
   *  several hundred metres down the coast from the places they are
   *  named after. */
  s: 551,
  /** Road half-width grows over this many metres either side of centre. */
  halfSpan: 62,
  /** Peak extra half-width: 7 m becomes 19 m at the middle. */
  extraWidth: 12,
  /** The island sits seaward, clear of all four traffic lanes. */
  islandLat: 11.5,
  islandRadius: 4.6,
};

/** Exported for the UE5 data API and the header generator. */
export const CONTROL_POINTS: Array<[number, number, number]> = [
  // --- Gulf Road, شارع الخليج العربي ---
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

  // --- Second Ring Road, الدائري الثاني ---
  // A 174° arc of radius 1562 m struck from (1144, -1359), which puts
  // its centre where the old town would be and its apex 1.48 km inland.
  // Six stations, one per district boundary, and a Catmull-Rom through
  // them rather than a traced circle: the curve it draws runs a little
  // flatter between stations and a little tighter at them, which is what
  // a ring road built as straight runs between interchanges does.
  [1400, 0, -2900], // junction with Gulf Road (the Shuwaikh end)
  [2115, 0, -2583], // Shuwaikh Residential
  [2586, 0, -1958], // Shamiya
  [2696, 0, -1184], // Mansuriya — the apex, furthest point inland
  [2416, 0, -453], // Da'iya
  [1818, 0, 50], // Dasma — Love Street runs the stretch behind this
  [1050, 0, 200], // junction with Gulf Road (the Bneid Al-Gar end)
];

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Petrol stations, as metres from the start line.
 *
 * Both are on the Second Ring, and that is a decision rather than an
 * accident. Widening the road makes the barrier open on BOTH sides —
 * halfWidthAt is one number, not one per side — which on the ring means
 * a bit more tarmac in a city block and on the corniche would mean a
 * gap in the sea wall and a lane of asphalt over the beach. A forecourt
 * on Gulf Road needs a side-aware road width first; until then they go
 * where the geometry is honest.
 *
 * `lat` is the apron's centre, out on the inland side.
 */
export const STATIONS: Array<{ s: number; lat: number }> = [
  { s: 3900, lat: 19 }, // Shuwaikh Residential, just off the junction
  { s: 6900, lat: 19 }, // Dasma, at the far end of Love Street
];

/** How far a forecourt reaches along the road, and how wide it opens
 *  the carriageway. 7 m becomes 17 m: two through lanes plus room to
 *  pull off them and stop. */
export const FORECOURT = { halfSpan: 30, extraWidth: 10 };

/** Everywhere the road is wider than four lanes, in one list, so
 *  halfWidthAt has a single rule to follow. */
const SWELLS: Array<{ s: number; halfSpan: number; extraWidth: number }> = [];

/** Where Gulf Road hands over to the Second Ring: metres from the start
 *  line, at the junction control point [1400, 0, -2900]. Everything
 *  before this has the sea on its left. */
export const COAST_END_M = 3423;

/**
 * One lap, in metres, measured once from the control points above.
 *
 * This exists so that nothing else in the game has to hard-code a lap
 * fraction. A fraction is a fine way to ASK a question ("am I on the
 * coast?") and a terrible way to STORE an answer, because the
 * denominator moves whenever the track does — and the whole return leg
 * has just been replaced.
 */
export const LAP_LENGTH = (() => {
  const c = new THREE.CatmullRomCurve3(
    CONTROL_POINTS.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    true,
    "centripetal"
  );
  c.arcLengthDivisions = 3000;
  return c.getLength();
})();

/** Fraction of the lap that runs along the coast (sea on the left).
 *  Derived, never typed in — see LAP_LENGTH. */
export const COAST_U = { from: 0.0, to: COAST_END_M / LAP_LENGTH };

SWELLS.push({
  s: DRIFT_PLAZA.s,
  halfSpan: DRIFT_PLAZA.halfSpan,
  extraWidth: DRIFT_PLAZA.extraWidth,
});
for (const st of STATIONS) {
  SWELLS.push({ s: st.s, halfSpan: FORECOURT.halfSpan, extraWidth: FORECOURT.extraWidth });
}

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

  /**
   * Drivable half-width at `s`: the constant four-lane road, plus
   * anywhere the tarmac widens out of it.
   *
   * Two things widen it, and they are the same shape. The Sharq plaza
   * swells the corniche into a circle to slide around; a forecourt
   * widens the ring road so a car can actually pull off the through
   * lanes and up to a pump. Both are smoothstepped in and out, because
   * a step change in drivable width is a wall that appears in front of
   * a car at road speed.
   *
   * The widest wins where two overlap, rather than the sum: two swells
   * that happened to meet would otherwise open a hole in the barrier
   * twice as wide as either of them asked for.
   */
  halfWidthAt(s: number): number {
    let w = ROAD_HALF_WIDTH;
    for (const swell of SWELLS) {
      const d = Math.abs(this.deltaAhead(swell.s, s));
      if (d >= swell.halfSpan) continue;
      const t = 1 - d / swell.halfSpan;
      w = Math.max(w, ROAD_HALF_WIDTH + swell.extraWidth * t * t * (3 - 2 * t));
    }
    return w;
  }
}
