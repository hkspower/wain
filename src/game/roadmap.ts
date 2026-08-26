// The road, as a map.
//
// The HUD has always had a minimap: a hundred-and-twenty-point outline
// of the lap in a corner box, with a green dot for you and a red one for
// the rival. It answers exactly one question — is the rival ahead or
// behind — and it answers it badly, because a closed loop with two dots
// on it cannot tell you WHERE you are. Every part of this world that has
// been given a name over the last while is invisible on it: ten
// districts, two roads with real signage names, two petrol stations, a
// drift plaza, seven landmarks. The game knows all of it and the map
// showed none of it.
//
// So this is the model behind a real one. It is deliberately separate
// from anything that draws, for two reasons: a projection is arithmetic
// and arithmetic can be tested without a browser, and the same model has
// to feed both the corner minimap and the full-screen map or the two
// will disagree about where things are — which is worse than having only
// one of them.
//
// THE PROJECTION IS ASPECT-CORRECT, and that is a change rather than a
// detail. The old one normalised x and z independently, stretching each
// to fill its box, so the lap's shape on screen depended on the shape of
// the box it was drawn in and matched the real road in neither. A map
// whose proportions are a function of the widget it sits in is a
// decoration. This one fits the lap into a square with its aspect ratio
// intact and centres it, so the corniche curves the way the corniche
// curves, and a renderer with a wider box draws the same square in the
// middle of it.
//
// NORTH IS NOT UP, and there is no way to make it so: the world's axes
// are the world's, and z runs the way three.js runs it. What the map
// promises is that its shape matches the road's shape and that a metre
// is the same length everywhere on it. Both of those are testable and
// both are tested.

import * as THREE from "three";
import type { Track } from "./track";
import { STATIONS, DRIFT_PLAZA, COAST_END_M } from "./track";
import { AREAS, ROADS, LANDMARKS, LANDMARK_S } from "./world";

/** A point on the map, in 0..1 of a square box. */
export interface RoadMapPoint {
  x: number;
  y: number;
}

export type MarkerKind = "start" | "district" | "station" | "plaza" | "landmark";

export interface RoadMapMarker extends RoadMapPoint {
  kind: MarkerKind;
  /** Metres from the start line. */
  s: number;
  name: string;
  arabic: string;
}

/** One of the two roads a lap is made of, as a run of path indices. */
export interface RoadMapLeg {
  name: string;
  arabic: string;
  /** Inclusive index range into `path`. */
  from: number;
  to: number;
}

export interface RoadMap {
  /** The centreline, closed. */
  path: RoadMapPoint[];
  /** Metres from the start line for each path point, so a position can
   *  be found without re-projecting. */
  pathS: number[];
  legs: RoadMapLeg[];
  markers: RoadMapMarker[];
  lapLength: number;
  /** Box units per metre. One number, not two — see the header. */
  unitsPerMetre: number;
  /** Where a point in the world lands on the map. */
  project(x: number, z: number): RoadMapPoint;
  /** Where a distance along the road lands on the map. */
  at(s: number): RoadMapPoint;
}

/** How many samples the centreline is drawn with.
 *
 *  480 rather than the minimap's 120. At 120 the Ras Al-Ard point came
 *  out as three straight lines, which on a corner widget nobody noticed
 *  and on a full-screen map is the first thing you see. */
const SAMPLES = 480;

/** Fraction of the box left empty around the road, so a marker sitting
 *  on the outside of a bend has somewhere to put its label. */
const PAD = 0.07;

/**
 * Build the map.
 *
 * Everything here comes from the same tables the world is built from —
 * AREAS, ROADS, STATIONS, DRIFT_PLAZA, LANDMARKS — so a district that
 * moves in the world moves on the map without anyone remembering to
 * update it. That is the whole reason this is generated rather than
 * drawn: the previous minimap was a projection of the curve and nothing
 * else, and it stayed correct precisely because it said nothing.
 */
export function buildRoadMap(track: Track): RoadMap {
  const L = track.length;
  const p = new THREE.Vector3();

  // --- Sample the centreline, and find its extent in the world.
  const world: Array<[number, number]> = [];
  const pathS: number[] = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const s = (i / SAMPLES) * L;
    track.pointAt(track.wrap(s), p);
    world.push([p.x, p.z]);
    pathS.push(s);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }

  // --- One scale for both axes.
  //
  // The whole point. The road is fitted by whichever axis is tighter and
  // centred on the other, so a metre north is the same length on screen
  // as a metre east and the lap keeps its real proportions.
  const spanX = Math.max(1e-6, maxX - minX);
  const spanZ = Math.max(1e-6, maxZ - minZ);
  const usable = 1 - PAD * 2;
  const unitsPerMetre = usable / Math.max(spanX, spanZ);
  const offX = 0.5 - ((minX + maxX) / 2) * unitsPerMetre;
  const offY = 0.5 - ((minZ + maxZ) / 2) * unitsPerMetre;

  const project = (x: number, z: number): RoadMapPoint => ({
    x: x * unitsPerMetre + offX,
    y: z * unitsPerMetre + offY,
  });

  const path = world.map(([x, z]) => project(x, z));

  /** A distance along the road, on the map. */
  const at = (s: number): RoadMapPoint => {
    track.pointAt(track.wrap(s), p);
    return project(p.x, p.z);
  };

  // --- The two roads, as runs of the path.
  //
  // ROADS is a list of `to` distances, so a leg runs from the previous
  // boundary to its own. Drawn as separate strokes rather than one, so
  // the corniche and the ring can be told apart at a glance — which is
  // the single most useful thing a map of a two-road lap can do.
  const legs: RoadMapLeg[] = [];
  {
    let from = 0;
    for (const road of ROADS) {
      const to = Math.min(road.to, L);
      const iFrom = Math.max(0, Math.round((from / L) * SAMPLES));
      const iTo = Math.min(SAMPLES, Math.round((to / L) * SAMPLES));
      if (iTo > iFrom) {
        legs.push({ name: road.name, arabic: road.arabic, from: iFrom, to: iTo });
      }
      from = to;
      if (from >= L) break;
    }
  }

  // --- Everything worth a mark.
  const markers: RoadMapMarker[] = [];
  const add = (kind: MarkerKind, s: number, name: string, arabic: string) => {
    const m = at(s);
    markers.push({ kind, s: track.wrap(s), name, arabic, x: m.x, y: m.y });
  };

  add("start", 0, "Start", "خط البداية");

  // District boundaries rather than district centres. A boundary is a
  // place on the road; a centre is an average, and averaging the middle
  // of Kuwait City with the middle of Sharq puts a label in the sea.
  // The label sits at the middle of the district's own span, which for a
  // district that runs along a bend is on the bend rather than at
  // either end of it.
  {
    let from = 0;
    for (let i = 0; i < AREAS.length; i++) {
      const a = AREAS[i];
      const to = Math.min(a.to, L);
      add("district", (from + to) / 2, a.name, a.arabic);
      from = to;
      if (from >= L) break;
    }
  }

  for (let i = 0; i < STATIONS.length; i++) {
    add("station", STATIONS[i].s, "Petrol", "محطة بنزين");
  }
  add("plaza", DRIFT_PLAZA.s, "Drift circle", "دوّار الدرِفت");

  // Landmarks are registered by buildWorld as it places them, so this
  // list is empty until the world exists. That is deliberate rather than
  // unfortunate: a landmark's position on the map should be the position
  // it was actually built at, not a second copy of the number that can
  // drift away from the first.
  for (const lm of LANDMARKS) {
    const s = LANDMARK_S[lm.id];
    if (s === undefined) continue;
    add("landmark", s, lm.name, lm.arabic);
  }

  return { path, pathS, legs, markers, lapLength: L, unitsPerMetre, project, at };
}

/**
 * The next petrol station up the road, and how far it is.
 *
 * On the map because it is the one piece of routing this game actually
 * needs: the tank is a mechanic with a fail state, and "which way is the
 * nearest pump" is a question a driver asks with about a litre left.
 * Wraps, because the lap does.
 */
export function nextStation(lapLength: number, s: number): { s: number; metres: number } {
  let best = { s: STATIONS[0]?.s ?? 0, metres: Infinity };
  for (const st of STATIONS) {
    let d = st.s - s;
    while (d < 0) d += lapLength;
    if (d < best.metres) best = { s: st.s, metres: d };
  }
  return best;
}

/** Which road a distance is on. Mirrors world.roadAt without needing a
 *  Track, for anything that has the lap length and a number. */
export function legAt(s: number): { name: string; arabic: string } {
  return s < COAST_END_M ? ROADS[0] : ROADS[1];
}
