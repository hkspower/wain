import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Track, LANES, LAP, ROAD_HALF_WIDTH, spanU } from "./track";
import { buildProfiled, buildRibbon, latAt, type LatOffset } from "./ribbon";
import { junctions, onForecourt, type Junction, type StreetGrid } from "./markings";
import { makeRng, WORLD_SEED } from "./rand";

// The street at ground level: what a road has at its edge besides paint
// and a rail.
//
// Until this, the Gulf Road was one asphalt ribbon, the markings, a
// W-beam that never broke for the 72 cross streets, and the furniture
// that stands tall — columns, signals, gantries. Nothing a kerb-height
// camera sees existed: no kerb, no footway inland (the verge was a bare
// dark plane), no gullies or manholes, no crossing, nowhere to wait for
// a bus. This module is that layer, as numbers (STREET_DETAIL), a pure
// layout (streetDetailLayout, railGaps) and a builder that takes its
// materials from the caller — the same contract markings.ts keeps, so
// tests/street.mjs can lay it out under node and the browser test can
// read the meshes back by name.
//
// It is PURE on purpose. Nothing here draws from the shared rand()
// stream: tests/world.mjs hashes that stream's length and every
// InstancedMesh placed from it, and one extra draw moves every building
// after it. Where a number needs to vary — a manhole's jitter, a drift
// of sand — it comes from makeRng seeded with WORLD_SEED and a tag, the
// way the sand, the palms and the shrubs already do.
//
// The frame, which every offset below is written in: +lat is the RIGHT
// of travel (sideAt = tangent x UP), the coast is on the left, so the
// inland verge — the one with a footway, the shelters, the cabinets —
// is +lat. In an instance's own frame, +z is the tangent and +x is the
// LEFT of travel (markings.ts arrowGeometry explains why), so "toward
// the road" from an inland prop is +x.

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

export const STREET_DETAIL = deepFreeze({
  /**
   * The kerb: a precast concrete unit 300 mm wide standing 130 mm above
   * the strip's asphalt (BS 7263 / the GCC precast norm: 125-150 mm
   * upstand). Its inner face at hw + 0.80 is behind the rail's post line
   * (posts stand at hw + 0.70 ± 0.045) and in front of the signal and
   * gantry posts at hw + 1.20, so nothing that stood before stands in
   * it. The profile is (out, up) from the inner face: a 20 mm foot on the
   * asphalt, a chamfered top edge, the 300 mm top, and a back face that
   * drops to 100 mm where the footway slab meets it.
   */
  kerb: {
    inner: 0.8,
    outer: 1.1,
    top: 0.15,
    foot: 0.02,
    profile: [
      [0.0, 0.02],
      [0.03, 0.14],
      [0.05, 0.15],
      [0.3, 0.15],
      [0.3, 0.1],
    ] as ReadonlyArray<readonly [number, number]>,
    /** Black-and-yellow kerb paint for this far either side of every
     *  open mouth: the junction radius, which a Gulf city paints. */
    paintM: 8,
    /** The joint between kerb units, in metres, which the texture draws
     *  once per tile; buildProfiled lays v = s / 14, so one tile is 14 m
     *  and 14 joints is a unit every metre. */
    unitM: 1,
  },
  /**
   * The footway slab, flush with the kerb top, from the kerb's back to
   * 50 mm short of the shrub bed's front (SHRUB.bed.front = hw + 2.10).
   * 0.95 m is narrower than a real 1.5 m pavement; widening it means
   * moving the beds, which re-lays every one of them — a follow-up.
   * Inland only: the coast has the corniche walkway, lifted to the same
   * height so the kerb is flush with it there too.
   */
  footway: { inner: 1.1, outer: 2.05, y: 0.15, walkwayY: 0.15 },
  /** A dropped kerb at a junction radius: 1.2 m from the full upstand
   *  down to the foot. */
  drop: { length: 1.2 },
  /**
   * Kerb gullies: a 450 mm grate (BS EN 124 D400 kerb inlet) set in the
   * strip against the kerb foot, every 24 m at s = 24k + 2. 24 is six
   * post pitches, so a grate is always 2 m from the nearest post and
   * never under one; 20-30 m is the spacing a road like this drains at.
   */
  gully: { size: 0.45, thick: 0.02, y: 0.035, lat: 0.575, every: 24, phase: 2 },
  /**
   * Manhole covers: 600 mm clear-opening covers on the inner lanes'
   * centres (the sewers run under the inner lanes; 1.75 - 0.30 keeps
   * 1.45 m of clear asphalt to the lane lines), every 50 m ± 8 m,
   * alternating lanes, 4 mm proud of the asphalt; two on every cross
   * street's centreline at 12 and 22 m out. None within `clearJunction`
   * of a junction centre, which is wider than any stop line, arrow or
   * solid approach lies from it, so a cover never sits on paint.
   */
  manhole: {
    d: 0.6,
    y: 0.024,
    streetY: 0.02,
    every: 50,
    jitter: 8,
    streetLats: [12, 22],
    /** On a cross street the cover sits a wheel path off the centre
     *  line, where the dashes are. */
    streetOff: 1.2,
    /** Clear of a plain mouth, and of a signalised one's paint: the
     *  arrows end 25 m before it and the mouth 6 m after. */
    clearJunction: 8,
    clearSignalised: [-28, 8] as readonly [number, number],
  },
  /**
   * Bus shelters, inland, every 400 m (urban stop spacing), the first at
   * 240 so one stands at s 3040 — inside the frames tools/shots/ik4k.mjs
   * shoots at 3040-3060. Centred at hw + 2.35 so the kerb-side column
   * line stays clear and the shelter's back sits in the bed, which steps
   * round it (vergeFurniture). A stop is nudged forward in `nudge` steps
   * until it is clear of the lamp columns and of any junction mouth.
   */
  shelter: {
    every: 400,
    phase: 240,
    lat: 2.35,
    length: 4.0,
    depth: 1.5,
    height: 2.5,
    nudge: 4,
    columnClear: 2.5,
    junctionClear: 8,
    avoidR: 1.3,
  },
  /** A telecom/power cabinet on the footway's back edge, mid-block,
   *  every second block. */
  cabinet: { everyBlocks: 2, lat: 1.85, w: 0.9, d: 0.4, h: 1.3, avoidR: 0.6 },
  /** Litter bins: one past each shelter, one at each signalised
   *  junction's inland downstream corner. */
  bin: { d: 0.5, h: 1.0, lat: 1.75, pastShelter: 2.8, pastMouth: 1.5, avoidR: 0.4 },
  /** Bollards at the dropped kerbs, both corners of every open mouth,
   *  the station's own yellow bollard. */
  bollard: { lat: 1.35, pastMouth: 0.3, rTop: 0.11, rBase: 0.13, h: 0.95 },
  /** A 100 km/h repeater 30 m after each signalised junction, inland, on
   *  the column line; 600 mm roundel, centre 2.2 m up. */
  sign: { lat: 1.6, after: 30, d: 0.6, centre: 2.2, post: 0.06, columnClear: 2.5, nudge: 4, avoidR: 0.3 },
  /**
   * The rail opens for 6 m either side of a cross street's centreline
   * (the street's half plus the mouth), and each span ends in a
   * terminal that flares 0.3 m outward over its last 2 m, which is what
   * a cut rail is finished with and what stops a gap reading as a hole.
   */
  railGap: { half: 6, flare: 0.3, flareM: 2 },
  /** Nothing of this stands in the tunnel (it has walls) or on swollen
   *  tarmac (a forecourt, the plaza), which have their own dressing. */
  tunnelMarginU: 0.004,
  swellTol: 0.05,
});

export interface RailGap {
  edge: 1 | -1;
  from: number;
  to: number;
  j: number;
}

/** A rail or kerb span, in lap fractions, and whether each end is a cut
 *  (a terminal, a dropped kerb) or the lap's own seam. */
export interface Span {
  edge: 1 | -1;
  u0: number;
  u1: number;
  cutStart: boolean;
  cutEnd: boolean;
}

export interface Prop {
  s: number;
  lat: number;
  /** Height of the prop's origin; 0, the ground, unless it sits on the
   *  asphalt (a gully, a cover). */
  y?: number;
  /** Yaw about the vertical, radians, on top of the tangent frame. */
  yaw?: number;
  j?: number;
  hidden?: boolean;
}

export interface StreetLayout {
  gaps: RailGap[];
  railSpans: Span[];
  kerbSpans: Span[];
  footwaySpans: Span[];
  kerbPaint: Span[];
  drops: Prop[];
  gullies: Prop[];
  manholes: Prop[];
  shelters: Prop[];
  cabinets: Prop[];
  bins: Prop[];
  bollards: Prop[];
  signs: Prop[];
}

/** Is `s` within the tunnel plus the margin, as a lap fraction? */
export function inTunnelU(track: Track, s: number): boolean {
  const tu = spanU(LAP.tunnel);
  const u = track.wrap(s) / track.length;
  const m = STREET_DETAIL.tunnelMarginU;
  return u > tu.from - m && u < tu.to + m;
}

/** Which junctions the rail opens at: every one whose street reaches the
 *  highway on that edge, outside the tunnel and off swollen tarmac. */
export function railGaps(track: Track, streets: StreetGrid, J: Junction[] = junctions(track, streets)): RailGap[] {
  const out: RailGap[] = [];
  const half = STREET_DETAIL.railGap.half;
  for (const j of J) {
    if (!j.open) continue;
    for (const edge of [1, -1] as const) {
      if (edge > 0 ? !j.plus : !j.minus) continue;
      out.push({ edge, from: j.s - half, to: j.s + half, j: j.i });
    }
  }
  return out;
}

/**
 * The complement of the gaps on one edge, as spans round the lap. The
 * span across the seam is split at u = 0 and 1 so a builder never sees
 * u1 > 1; those two ends are the seam, not cuts.
 */
export function spansBetween(track: Track, edge: 1 | -1, gaps: RailGap[], also: Array<[number, number]> = []): Span[] {
  const L = track.length;
  // A hole across the seam (junction 0 sits at s = 0, so its gap runs
  // from -6 to +6) is two holes, one at each end of the lap.
  const holes: Array<[number, number]> = [];
  const add = (from: number, to: number) => {
    const a = track.wrap(from);
    const b = track.wrap(to);
    if (a <= b) holes.push([a, b]);
    else holes.push([a, L], [0, b]);
  };
  for (const g of gaps) if (g.edge === edge) add(g.from, g.to);
  for (const [a, b] of also) add(a, b);
  holes.sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  if (!holes.length) return [{ edge, u0: 0, u1: 1, cutStart: false, cutEnd: false }];
  let cursor = 0;
  let cutStart = false;
  for (const [from, to] of holes) {
    if (from > cursor + 1e-6) out.push({ edge, u0: cursor / L, u1: from / L, cutStart, cutEnd: true });
    cursor = Math.max(cursor, to);
    cutStart = true;
  }
  if (cursor < L - 1e-6) out.push({ edge, u0: cursor / L, u1: 1, cutStart, cutEnd: false });
  return out;
}

/** Inside any gap on this edge, with `pad` metres of grace. */
export function inGap(track: Track, gaps: RailGap[], edge: number, s: number, pad = 0): boolean {
  return gaps.some((g) => g.edge === edge && track.deltaAhead(g.from, s) > -pad && track.deltaAhead(g.to, s) < pad);
}

export interface LayoutOptions {
  /** Can a standing prop (a shelter, a cabinet, a sign) stand at s? The
   *  world passes lampColumnStands: no tunnel, nothing under a flyover. */
  standing: (s: number) => boolean;
  /** Does a lamp column stand at s on the inland side? */
  columnAt: (s: number) => boolean;
}

export function streetDetailLayout(track: Track, streets: StreetGrid, opts: LayoutOptions): StreetLayout {
  const L = track.length;
  const D = STREET_DETAIL;
  const J = junctions(track, streets);
  const gaps = railGaps(track, streets, J);
  const rng = makeRng((WORLD_SEED ^ 0x53545244) >>> 0); // "STRD"
  const tu = spanU(LAP.tunnel);
  const tunnelHole: [number, number] = [(tu.from - D.tunnelMarginU) * L, (tu.to + D.tunnelMarginU) * L];
  const swollen = (s: number) => track.halfWidthAt(s) > ROAD_HALF_WIDTH + D.swellTol;
  const nearJunction = (s: number, m: number) => J.some((j) => Math.abs(track.deltaAhead(j.s, s)) < m);

  const railSpans = ([1, -1] as const).flatMap((e) => spansBetween(track, e, gaps));
  // The kerb and the footway stop at the tunnel as well as at the
  // mouths: the tunnel has its own walls and plinth.
  const kerbSpans = ([1, -1] as const).flatMap((e) => spansBetween(track, e, gaps, [tunnelHole]));
  const footwaySpans = kerbSpans.filter((sp) => sp.edge > 0);

  // Kerb paint and dropped kerbs: at every cut end.
  const kerbPaint: Span[] = [];
  const drops: Prop[] = [];
  for (const sp of kerbSpans) {
    const s0 = sp.u0 * L;
    const s1 = sp.u1 * L;
    const lat = (s: number) => sp.edge * (track.halfWidthAt(s) + (D.kerb.inner + D.kerb.outer) / 2);
    if (sp.cutStart) {
      kerbPaint.push({ ...sp, u1: Math.min(sp.u1, (s0 + D.kerb.paintM) / L) });
      // The low end points back into the mouth: -tangent.
      drops.push({ s: track.wrap(s0 + D.drop.length / 2), lat: lat(s0), yaw: Math.PI });
    }
    if (sp.cutEnd) {
      kerbPaint.push({ ...sp, u0: Math.max(sp.u0, (s1 - D.kerb.paintM) / L) });
      drops.push({ s: track.wrap(s1 - D.drop.length / 2), lat: lat(s1), yaw: 0 });
    }
  }

  // Gullies, both edges, hidden where there is no kerb to drain to.
  const gullies: Prop[] = [];
  const gullyN = Math.floor(L / D.gully.every);
  for (let i = 0; i < gullyN; i++) {
    const s = i * D.gully.every + D.gully.phase;
    for (const edge of [1, -1] as const) {
      const hidden = inGap(track, gaps, edge, s, D.gully.size) || inTunnelU(track, s) || swollen(s);
      gullies.push({ s, lat: edge * (track.halfWidthAt(s) + D.gully.lat), hidden });
    }
  }

  // Manholes: the highway's, jittered, on alternating inner lanes; then
  // two per cross street.
  const manholes: Prop[] = [];
  const mhN = Math.floor(L / D.manhole.every);
  for (let i = 0; i < mhN; i++) {
    const s = track.wrap(i * D.manhole.every + (rng() * 2 - 1) * D.manhole.jitter);
    const lat = i % 2 === 0 ? LANES[1] : LANES[2];
    const r = D.manhole.d / 2;
    const onPaint = J.some((j) => {
      const d = track.deltaAhead(j.s, s);
      return j.signalised
        ? d > D.manhole.clearSignalised[0] - r && d < D.manhole.clearSignalised[1] + r
        : Math.abs(d) < D.manhole.clearJunction + r;
    });
    const hidden = onPaint || inTunnelU(track, s) || swollen(s) || onForecourt(track, s, r, lat - r, lat + r);
    manholes.push({ s, lat, y: D.manhole.y, hidden });
  }
  for (const j of J) {
    if (!j.open) continue;
    for (const sign of [1, -1] as const) {
      if (sign > 0 ? !j.plus : !j.minus) continue;
      D.manhole.streetLats.forEach((d, k) => {
        const lat = sign * (track.halfWidthAt(j.s) + d);
        const r = D.manhole.d / 2;
        const s = track.wrap(j.s + (k % 2 === 0 ? 1 : -1) * D.manhole.streetOff);
        manholes.push({ s, lat, j: j.i, y: D.manhole.streetY, hidden: onForecourt(track, s, r, lat - r, lat + r) });
      });
    }
  }

  // Standing props, inland. A slot that cannot stand is kept hidden so
  // the counts are the layout's and a later change moves nothing else.
  const clearOfColumns = (s: number, m: number) => {
    for (let k = -1; k <= 1; k++) {
      const c = Math.round(s / 42) * 42 + k * 42;
      if (opts.columnAt(c) && Math.abs(track.deltaAhead(c, s)) < m) return false;
    }
    return true;
  };
  const shelters: Prop[] = [];
  const bins: Prop[] = [];
  const shelterN = Math.floor((L - D.shelter.phase) / D.shelter.every) + 1;
  for (let i = 0; i < shelterN; i++) {
    let s = D.shelter.phase + i * D.shelter.every;
    let ok = false;
    for (let tries = 0; tries < 6; tries++) {
      ok =
        opts.standing(s) &&
        !swollen(s) &&
        !nearJunction(s, D.shelter.junctionClear + D.shelter.length / 2) &&
        clearOfColumns(s, D.shelter.columnClear + D.shelter.length / 2) &&
        !onForecourt(track, s, D.shelter.length / 2, track.halfWidthAt(s) + 1, track.halfWidthAt(s) + 4);
      if (ok) break;
      s += D.shelter.nudge;
    }
    s = track.wrap(s);
    shelters.push({ s, lat: track.halfWidthAt(s) + D.shelter.lat, hidden: !ok });
    const bs = track.wrap(s + D.shelter.length / 2 + D.bin.pastShelter);
    bins.push({ s: bs, lat: track.halfWidthAt(bs) + D.bin.lat, hidden: !ok });
  }
  for (const j of J) {
    if (!j.signalised || !j.open) continue;
    const s = track.wrap(j.s + D.railGap.half + D.bin.pastMouth);
    bins.push({ s, lat: track.halfWidthAt(s) + D.bin.lat, j: j.i, hidden: !opts.standing(s) || swollen(s) });
  }

  const cabinets: Prop[] = [];
  const blocks = Math.round(L / streets.crossEvery);
  for (let i = 0; i < blocks; i += D.cabinet.everyBlocks) {
    const s = track.wrap(((i + 0.5) / blocks) * L);
    const hidden = !opts.standing(s) || swollen(s) || !clearOfColumns(s, 1.5) ||
      shelters.some((sh) => !sh.hidden && Math.abs(track.deltaAhead(sh.s, s)) < D.shelter.length / 2 + 2);
    cabinets.push({ s, lat: track.halfWidthAt(s) + D.cabinet.lat, hidden });
  }

  const bollards: Prop[] = [];
  for (const g of gaps) {
    for (const [s, yaw] of [[g.from - D.bollard.pastMouth, 0], [g.to + D.bollard.pastMouth, 0]] as const) {
      const ws = track.wrap(s);
      bollards.push({ s: ws, lat: g.edge * (track.halfWidthAt(ws) + D.bollard.lat), j: g.j, yaw });
    }
  }

  const signs: Prop[] = [];
  for (const j of J) {
    if (!j.signalised || !j.open) continue;
    let s = j.s + D.sign.after;
    let ok = false;
    for (let tries = 0; tries < 4; tries++) {
      ok = opts.standing(s) && !swollen(s) && clearOfColumns(s, D.sign.columnClear) &&
        !shelters.some((sh) => !sh.hidden && Math.abs(track.deltaAhead(sh.s, s)) < D.shelter.length / 2 + 1);
      if (ok) break;
      s += D.sign.nudge;
    }
    s = track.wrap(s);
    signs.push({ s, lat: track.halfWidthAt(s) + D.sign.lat, j: j.i, hidden: !ok });
  }

  return { gaps, railSpans, kerbSpans, footwaySpans, kerbPaint, drops, gullies, manholes, shelters, cabinets, bins, bollards, signs };
}

/** What the verge must keep clear of: every standing prop, as circles. */
export function streetAvoid(layout: StreetLayout): Array<{ s: number; lat: number; r: number }> {
  const D = STREET_DETAIL;
  const out: Array<{ s: number; lat: number; r: number }> = [];
  for (const p of layout.shelters) {
    if (p.hidden) continue;
    for (const ds of [-1.4, 0, 1.4]) out.push({ s: p.s + ds, lat: p.lat, r: D.shelter.avoidR });
  }
  for (const p of layout.cabinets) if (!p.hidden) out.push({ s: p.s, lat: p.lat, r: D.cabinet.avoidR });
  for (const p of layout.bins) if (!p.hidden) out.push({ s: p.s, lat: p.lat, r: D.bin.avoidR });
  for (const p of layout.signs) if (!p.hidden) out.push({ s: p.s, lat: p.lat, r: D.sign.avoidR });
  return out;
}

// ----------------------------------------------------------- geometry

/** The rail's lateral on a span: the beam line, flared outward over the
 *  last `flareM` of every cut end. */
export function flaredLateral(track: Track, sp: Span, base: LatOffset): LatOffset {
  const L = track.length;
  const { flare, flareM } = STREET_DETAIL.railGap;
  const s0 = sp.u0 * L;
  const s1 = sp.u1 * L;
  const smooth = (t: number) => {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
  };
  return (s: number) => {
    let f = 0;
    if (sp.cutStart) f = Math.max(f, 1 - smooth((s - s0) / flareM));
    if (sp.cutEnd) f = Math.max(f, 1 - smooth((s1 - s) / flareM));
    return latAt(base, s) + sp.edge * flare * f;
  };
}

/**
 * A swept section faces one way: buildProfiled winds its quads for the
 * -lat edge (where the rail was first built, double-sided, so nobody
 * noticed), and on the +lat edge the same order faces the ground — a
 * kerb that is back-face culled from above, invisible to the camera and
 * to a ray. Flip the winding there.
 */
function faceOut(g: THREE.BufferGeometry, edge: number): THREE.BufferGeometry {
  if (edge > 0) {
    const idx = g.getIndex();
    if (idx) {
      const a = idx.array as Uint16Array | Uint32Array;
      for (let i = 0; i < a.length; i += 3) {
        const t = a[i + 1];
        a[i + 1] = a[i + 2];
        a[i + 2] = t;
      }
      idx.needsUpdate = true;
    }
    g.computeVertexNormals();
  }
  return g;
}

function kerbGeometry(track: Track, sp: Span): THREE.BufferGeometry {
  const K = STREET_DETAIL.kerb;
  return faceOut(
    buildProfiled(
      track,
      (s) => sp.edge * (track.halfWidthAt(s) + K.inner),
      K.profile.map(([o, u]) => [o, u] as [number, number]),
      sp.edge,
      2,
      sp.u0,
      sp.u1
    ),
    sp.edge
  );
}

/** A dropped kerb: the kerb's section sliding from full height at -z to
 *  the foot at +z, 0.3 m wide, in the instance frame. */
function dropGeometry(): THREE.BufferGeometry {
  const K = STREET_DETAIL.kerb;
  const len = STREET_DETAIL.drop.length;
  const w = K.outer - K.inner;
  const g = new THREE.BoxGeometry(w, K.top, len, 1, 1, 1);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const y = pos.getY(i);
    // Top vertices at +z come down to the foot; the bottom stays put.
    if (y > 0) {
      const t = (z + len / 2) / len;
      pos.setY(i, -K.top / 2 + K.foot + (K.top - K.foot) * (1 - t));
    } else {
      pos.setY(i, -K.top / 2);
    }
  }
  g.translate(0, K.top / 2, 0);
  g.computeVertexNormals();
  return g;
}

function gullyGeometry(): THREE.BufferGeometry {
  const G = STREET_DETAIL.gully;
  const g = new THREE.BoxGeometry(G.size, G.thick, G.size);
  g.translate(0, G.thick / 2, 0);
  return g;
}

function manholeGeometry(): THREE.BufferGeometry {
  const M = STREET_DETAIL.manhole;
  const g = new THREE.CylinderGeometry(M.d / 2, M.d / 2, 0.004, 28);
  g.translate(0, 0.002, 0);
  return g;
}

function shelterGeometry(): { frame: THREE.BufferGeometry; glass: THREE.BufferGeometry; sign: THREE.BufferGeometry } {
  const S = STREET_DETAIL.shelter;
  const at = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => geo.translate(x, y, z);
  const parts: THREE.BufferGeometry[] = [];
  // The slab it stands on, its roof, four posts and a bench. The open
  // side faces the road: +x in this frame.
  // The plinth stands 20 mm proud of the footway it sits on, so the two
  // slabs do not fight for the same pixels.
  parts.push(at(new THREE.BoxGeometry(S.depth + 0.4, 0.17, S.length + 0.4), 0, 0.085, 0));
  parts.push(at(new THREE.BoxGeometry(S.depth + 0.2, 0.08, S.length + 0.2), 0, S.height - 0.04, 0));
  for (const z of [-S.length / 2 + 0.1, S.length / 2 - 0.1]) {
    for (const x of [-S.depth / 2 + 0.06, S.depth / 2 - 0.06]) {
      parts.push(at(new THREE.BoxGeometry(0.08, S.height - 0.15, 0.08), x, 0.15 + (S.height - 0.15) / 2, z));
    }
  }
  parts.push(at(new THREE.BoxGeometry(0.4, 0.06, S.length - 0.8), -S.depth / 2 + 0.45, 0.15 + 0.45, 0));
  for (const z of [-S.length / 2 + 0.5, S.length / 2 - 0.5]) {
    parts.push(at(new THREE.BoxGeometry(0.36, 0.45, 0.06), -S.depth / 2 + 0.45, 0.15 + 0.225, z));
  }
  const frame = mergeGeometries(parts);
  if (!frame) throw new Error("bus shelter: nothing merged");
  // The back and the two ends, glazed.
  const glazing: THREE.BufferGeometry[] = [
    at(new THREE.BoxGeometry(0.03, S.height - 0.4, S.length - 0.3), -S.depth / 2 + 0.03, 0.15 + (S.height - 0.4) / 2 + 0.05, 0),
  ];
  for (const z of [-S.length / 2 + 0.11, S.length / 2 - 0.11]) {
    glazing.push(at(new THREE.BoxGeometry(S.depth - 0.3, S.height - 0.4, 0.03), 0, 0.15 + (S.height - 0.4) / 2 + 0.05, z));
  }
  const glass = mergeGeometries(glazing);
  if (!glass) throw new Error("bus shelter: no glazing");
  // The stop's own lit panel, on the roof's road edge.
  const sign = at(new THREE.BoxGeometry(0.06, 0.3, 0.9), S.depth / 2 + 0.07, S.height - 0.25, 0);
  return { frame, glass, sign };
}

function cabinetGeometry(): THREE.BufferGeometry {
  const C = STREET_DETAIL.cabinet;
  const body = new THREE.BoxGeometry(C.d, C.h, C.w);
  body.translate(0, 0.1 + C.h / 2, 0);
  const plinth = new THREE.BoxGeometry(C.d + 0.06, 0.1, C.w + 0.06);
  plinth.translate(0, 0.05, 0);
  const g = mergeGeometries([body, plinth]);
  if (!g) throw new Error("cabinet: nothing merged");
  return g;
}

function binGeometry(): THREE.BufferGeometry {
  const B = STREET_DETAIL.bin;
  const body = new THREE.CylinderGeometry(B.d / 2, B.d / 2 - 0.02, B.h - 0.08, 12);
  body.translate(0, (B.h - 0.08) / 2, 0);
  const lid = new THREE.CylinderGeometry(B.d / 2 + 0.02, B.d / 2, 0.08, 12);
  lid.translate(0, B.h - 0.04, 0);
  const g = mergeGeometries([body, lid]);
  if (!g) throw new Error("bin: nothing merged");
  return g;
}

function bollardGeometry(): THREE.BufferGeometry {
  const B = STREET_DETAIL.bollard;
  const g = new THREE.CylinderGeometry(B.rTop, B.rBase, B.h, 8);
  g.translate(0, B.h / 2, 0);
  return g;
}

function signPostGeometry(): THREE.BufferGeometry {
  const S = STREET_DETAIL.sign;
  const g = new THREE.CylinderGeometry(S.post / 2, S.post / 2, S.centre + S.d / 2, 8);
  g.translate(0, (S.centre + S.d / 2) / 2, 0);
  return g;
}

function signFaceGeometry(): THREE.BufferGeometry {
  const S = STREET_DETAIL.sign;
  // Faces -z: toward the traffic coming up the road.
  const g = new THREE.CircleGeometry(S.d / 2, 24);
  g.rotateY(Math.PI);
  g.translate(-0.04, S.centre, 0);
  return g;
}

export interface StreetMaterials {
  kerb: THREE.Material;
  kerbPaint: THREE.Material;
  footway: THREE.Material;
  gully: THREE.Material;
  manhole: THREE.Material;
  frame: THREE.Material;
  glass: THREE.Material;
  shelterSign: THREE.Material;
  cabinet: THREE.Material;
  bin: THREE.Material;
  bollard: THREE.Material;
  post: THREE.Material;
  signFace: THREE.Material;
}

/** Lay props as one InstancedMesh: tangent frame at pose(s, lat), the
 *  prop's own yaw on top, hidden slots at zero scale. */
export function instancedProps(
  track: Track,
  name: string,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  props: Prop[]
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, props.length);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const yawQ = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3(0, 0, 1);
  const one = new THREE.Vector3(1, 1, 1);
  const none = new THREE.Vector3(0, 0, 0);
  props.forEach((pr, i) => {
    track.pose(pr.s, pr.lat, p, tmp);
    track.tangentAt(pr.s, tan);
    q.setFromUnitVectors(fwd, tan);
    if (pr.yaw) {
      yawQ.setFromAxisAngle(up, pr.yaw);
      q.multiply(yawQ);
    }
    p.y = pr.y ?? 0;
    m.compose(p, q, pr.hidden ? none : one);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Everything the layout describes, as meshes named the way the game
 * finds them: 'kerb' (one per edge), 'kerb-paint', 'footway', 'kerb-drop',
 * 'kerb-gully', 'road-manhole', 'bus-shelter', 'bus-shelter-glass',
 * 'bus-shelter-sign', 'utility-cabinet', 'street-bin', 'street-bollard',
 * 'speed-sign', 'speed-sign-face'.
 */
export function buildStreetDetail(track: Track, mats: StreetMaterials, layout: StreetLayout): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const D = STREET_DETAIL;

  for (const edge of [1, -1] as const) {
    const parts = layout.kerbSpans.filter((sp) => sp.edge === edge).map((sp) => kerbGeometry(track, sp));
    if (!parts.length) continue;
    const geo = mergeGeometries(parts);
    if (!geo) throw new Error("kerb: nothing merged");
    for (const g of parts) g.dispose();
    const kerb = new THREE.Mesh(geo, mats.kerb);
    kerb.name = "kerb";
    kerb.receiveShadow = true;
    out.push(kerb);
  }
  if (layout.kerbPaint.length) {
    const parts = layout.kerbPaint.map((sp) =>
      // A hair proud of the kerb's own faces, so the paint is on it.
      faceOut(
        buildProfiled(
          track,
          (s) => sp.edge * (track.halfWidthAt(s) + D.kerb.inner - 0.004),
          D.kerb.profile.map(([o, u]) => [o + 0.004 * (o > 0.1 ? 1 : 0), u + 0.004] as [number, number]),
          sp.edge,
          1,
          sp.u0,
          sp.u1
        ),
        sp.edge
      )
    );
    const geo = mergeGeometries(parts);
    if (!geo) throw new Error("kerb paint: nothing merged");
    for (const g of parts) g.dispose();
    const paint = new THREE.Mesh(geo, mats.kerbPaint);
    paint.name = "kerb-paint";
    out.push(paint);
  }
  if (layout.footwaySpans.length) {
    const parts = layout.footwaySpans.map((sp) =>
      buildRibbon(
        track,
        (s) => sp.edge * (track.halfWidthAt(s) + D.footway.inner),
        (s) => sp.edge * (track.halfWidthAt(s) + D.footway.outer),
        D.footway.y,
        4,
        sp.u0,
        sp.u1
      )
    );
    const geo = mergeGeometries(parts);
    if (!geo) throw new Error("footway: nothing merged");
    for (const g of parts) g.dispose();
    const fw = new THREE.Mesh(geo, mats.footway);
    fw.name = "footway";
    fw.receiveShadow = true;
    out.push(fw);
  }

  out.push(instancedProps(track, "kerb-drop", dropGeometry(), mats.kerb, layout.drops));
  const gullies = instancedProps(track, "kerb-gully", gullyGeometry(), mats.gully,
    layout.gullies.map((g) => ({ ...g, y: D.gully.y - D.gully.thick })));
  out.push(gullies);
  const manholes = instancedProps(track, "road-manhole", manholeGeometry(), mats.manhole, layout.manholes);
  out.push(manholes);

  const sh = shelterGeometry();
  out.push(instancedProps(track, "bus-shelter", sh.frame, mats.frame, layout.shelters));
  out.push(instancedProps(track, "bus-shelter-glass", sh.glass, mats.glass, layout.shelters));
  out.push(instancedProps(track, "bus-shelter-sign", sh.sign, mats.shelterSign, layout.shelters));
  out.push(instancedProps(track, "utility-cabinet", cabinetGeometry(), mats.cabinet, layout.cabinets));
  out.push(instancedProps(track, "street-bin", binGeometry(), mats.bin, layout.bins));
  out.push(instancedProps(track, "street-bollard", bollardGeometry(), mats.bollard, layout.bollards));
  out.push(instancedProps(track, "speed-sign", signPostGeometry(), mats.post, layout.signs));
  out.push(instancedProps(track, "speed-sign-face", signFaceGeometry(), mats.signFace, layout.signs));
  return out;
}
