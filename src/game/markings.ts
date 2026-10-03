import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  Track,
  ROAD_HALF_WIDTH,
  LANES,
  COAST_U,
  LAP,
  spanU,
  STATIONS,
  FORECOURT,
  PAINT_SHOPS,
  PAINT_BAY,
  TUNNEL_BOX,
  DRIFT_PLAZA,
} from "./track";
import { buildRibbon } from "./ribbon";

/**
 * Every painted marking on the road, and the one model of the junctions
 * they belong to.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * The paint used to be three blocks inside buildWorld with their numbers
 * typed inline, and three separate loops over the cross streets that did
 * not agree about which junctions existed: the streets were laid at all
 * 72, the stop bars at 114 approaches, the signals at every other street
 * minus a tunnel test of their own. Junction 50 sits on the paint shop's
 * forecourt, where the road is 16.6 m wide, and the signal loop planted
 * a mast there because it measured from the CONSTANT half-width. And the
 * one node test of the paint checked a 14 m lane cadence the world had
 * stopped building, because the 12 it did build was a local inside a
 * block no test could import.
 *
 * So: one table of numbers (MARKINGS), one junction model (junctions()),
 * pure layout functions that say where every mark goes, and one builder
 * that turns the layout into meshes. world.ts calls the builder; the
 * test calls the same builder and reads the meshes back. Nothing here
 * touches the DOM and nothing here draws from rand(): the world's stream
 * is consumed in build order (rand.ts), and paint that took a number
 * would move every building placed after it.
 *
 * Imports three, track.ts and ribbon.ts and nothing else. In particular
 * NOT world.ts, which imports this — STREETS is passed in.
 *
 * WHAT THE NUMBERS ARE HELD TO
 *
 * No Kuwait MPW or GCC marking manual is reachable from this
 * environment (the same egress policy track.ts records for the control
 * points). The values are recalled from MUTCD 2009 and the UK TSRGD /
 * Traffic Signs Manual chapter 5, and tests/markings.mjs holds each one
 * inside an independent STANDARD band written in the test, with its
 * citation, so a value can move only inside the standard. Where a value
 * is a choice inside a band rather than a figure from one, it says so.
 */

/** Freeze a table and every table inside it, so a builder that tries to
 *  "just nudge" a dimension at run time throws instead of drifting. */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

export type MarkingConvention = "white" | "mutcd-gcc";

/**
 * The marking spec, in metres. Every value the builder lays is read from
 * here; the bands they are checked against live in the test.
 */
export const MARKINGS = deepFreeze({
  /**
   * Which colour rule the edges follow. 'white' until somebody can check
   * Kuwait's: 'mutcd-gcc' (yellow left edge, amber left studs, red right
   * studs) is MUTCD §3B.06 and observed practice on some GCC divided
   * roads, while UK practice mirrored for right-hand traffic would put
   * red on the right and contradicts the rail reflectors' own comment.
   * Neither is citable for Kuwait, so the colour stays white and only
   * this field names the choice. VERIFY before anything reads it.
   */
  convention: "white" as MarkingConvention,
  /**
   * Paint colours, as sRGB bytes. Every one of them is linear albedo
   * 0.65-0.85, the thermoplastic band world.ts's lineMat note quotes:
   * 0xdeded6 is 0.73, 0xd8d8d0 is 0.69. The four whites that were
   * 0xf2f2ee (0.89, above anything laid on a road) — the drift ring,
   * the plaza legend, the forecourt bays and the paint-shop box — read
   * `white` now.
   */
  paint: { edge: 0xdeded6, lane: 0xd8d8d0, street: 0xdedcd2, white: 0xdeded6 },
  /**
   * The highway lane line: 150 mm, 3 m on a 12 m cycle — 3 and 9, a 1:3
   * mark to gap, which is MUTCD's 10 ft / 30 ft and the widely used Gulf
   * figure (not a citation: no Kuwaiti manual is in reach). The cycle
   * was 14 once, on the argument that the lap divides into it; it
   * divides into any nominal cycle, round(L / 12) = 708 slots of 11.994 m
   * with a gap of 8.994, so the mark after the start line is the same
   * distance from it as every other. 150 mm is the top of MUTCD's 4-6 in
   * normal line; it was 140 mm. Lats are the midpoints of LANES.
   */
  lane: { width: 0.15, mark: 3.0, cycle: 12, y: 0.03 },
  /**
   * The edge line: 200 mm (UK TSM, high-speed roads), continuous, with
   * its INNER edge on the tarmac edge halfWidthAt(s). It was 150-350 mm
   * inboard of that edge, inside the outer lane, which made the outer
   * lanes 3.25 m centre to paint against 3.50 for the inner two and put
   * LANES[3] (5.25) 0.14 m outboard of its painted lane's centre.
   */
  edge: { width: 0.2, inner: 0, y: 0.03 },
  /**
   * The paved marginal strip: asphalt from the tarmac edge out to the
   * rail lip at halfWidthAt + 0.60. The road ribbon covers it, so the
   * edge line sits on pavement with 0.40 m of asphalt outboard of it.
   * Built OUTSIDE halfWidthAt on purpose: physics, LANES, the rail and
   * every piece of furniture key off halfWidthAt and none of it moves.
   */
  strip: { width: 0.6 },
  /** The plaza's red-and-white kerb, outboard of the edge line's outer
   *  edge (0.20) and inside the rail lip (0.60). It was 0.05-0.45, laid
   *  straight over the line it borders. */
  kerb: { inner: 0.25, outer: 0.55 },
  /**
   * Raised studs on the edge line's centre, every 18 m (UK spacing,
   * recalled). Real units are about 100 mm across and stand no more than
   * 20-25 mm proud (BS EN 1463 / MUTCD raised pavement markers): the
   * previous 140 mm spheres stood 0.11 m above the asphalt. Emissive 2.0
   * is the top of the nightGlow band (world.ts), so they are dimmed by
   * day like every other retroreflector.
   */
  stud: { footprint: 0.1, proud: 0.025, spacing: 18, emissive: 2.0 },
  /**
   * The stop line at a signalised junction: 300 mm (UK dia 1001 above
   * 40 mph; MUTCD 12-24 in) across all four lanes, centred 13.0 m before
   * the cross street's centreline. Its downstream face at js - 12.85 is
   * 12.85 m short of the signal head (MUTCD §4D.14: 12.2-55 m) and 7.85 m
   * before the near kerb at js - 5 (MUTCD: within 9 m).
   */
  stop: { width: 0.3, halfSpan: 7.0, setback: 13.0, y: 0.031 },
  /** Solid lane lines for this far upstream of the stop line: lane
   *  changes are discouraged on a signal approach (MUTCD §3B.04). The
   *  30 m is an ASSUMPTION; no manual in reach gives a figure. */
  approach: { length: 30.0 },
  /** Lane lines are not carried through the junction (MUTCD §3B.08):
   *  every dash slot overlapping (js - 43.15, js + 6.5] is hidden — at
   *  zero scale, so the cadence and the lap closure stay intact. */
  box: { after: 6.5 },
  /**
   * Lane arrows, one per lane per signalised approach: 6.0 m overall
   * (UK dia 1038/1039 run 4/6/9 m by speed; 6 m for a 60-80 km/h urban
   * arterial is an ASSUMPTION), shaft 0.25, head 1.80 long by 0.90
   * wide, the tip 6.0 m before the stop line. A turn branch leaves 2.0 m
   * behind the head base at 45 degrees and reaches no more than 1.25 m
   * from the lane centre, which keeps it 0.5 m clear of the lane lines.
   */
  arrow: {
    length: 6.0,
    shaft: 0.25,
    headLength: 1.8,
    headWidth: 0.9,
    branchBack: 2.0,
    branchReach: 1.25,
    tipToStop: 6.0,
    y: 0.031,
  },
  /** Where the signal head stands relative to the junction centre. 0:
   *  over the cross street's centreline, as built. */
  signal: { headAfter: 0 },
  /**
   * Street centre lines: 100 mm, 3 m mark, exactly 9 m gap (MUTCD
   * §3A.06; 4 in on local streets), the run centred in each segment.
   * A segment runs between junction mouths — the crossing street's half
   * plus `mouth` — so no line crosses a junction. Cross streets start
   * `crossStart` beyond the marginal strip (or `tunnelClear` beyond the
   * tunnel wall where the street passes over the underpass). Avenue
   * segments where the offset curve is squeezed below `minStretch` of
   * the highway's length are not painted at all: at the R 166 Ras Al-Ard
   * bend the +188 avenue folds back on itself (1 - d·κ < 0). White, not
   * yellow: yellow centre lines are US practice, not UK or GCC.
   */
  street: {
    width: 0.1,
    mark: 3.0,
    gap: 9.0,
    mouth: 1.0,
    crossStart: 3.0,
    tunnelClear: 3.0,
    minStretch: 0.3,
    rise: 0.006,
  },
  /**
   * The plaza legend: elongated so it reads at a glancing angle. The
   * 512 x 256 canvas carries 118 px glyphs, so a 6.0 m plane lays them
   * 2.77 m along travel — inside the UK TSM 2.8 m elongated legend for
   * roads above 40 mph — and 2.4 m across keeps it inside one lane.
   */
  legend: { width: 2.4, length: 6.0, glyphPx: 118, canvasPx: 256, back: [75, 130], lanes: [2, 3], y: 0.05 },
  /** The junction model's tolerances. */
  junction: { swellBack: 45, swellAhead: 10, swellTol: 0.05, signalEvery: 2, tunnelMarginU: 0.01 },
});

/**
 * The asphalt texture's own geometry, read by asphaltSurface in world.ts.
 *
 * One tile is 14 m across (the road ribbon maps u = lat / 14 + 0.5), so a
 * lane centre is at u = LANES / 14 + 0.5. Oil drips there, not on the
 * lane lines where they were (u 0.25 / 0.5 / 0.75 is lat -3.5 / 0 / 3.5).
 * Wheel paths 0.78 m either side of the lane centre: a 1.55-1.6 m
 * vehicle track, and the same offset as the brake-rubber streaks laid
 * on the approach to every bend. Crack sealant is dull — roughness 0.72
 * against 0.92 for the open asphalt — not the road's glossiest surface.
 */
export const ASPHALT = deepFreeze({
  tileM: 14,
  wheelPathM: 0.78,
  oilU: LANES.map((l) => l / 14 + 0.5),
  sealantRoughness: 0.72,
});

/** The street grid's numbers the paint needs. world.ts's STREETS is one;
 *  passed in, never imported, because world.ts imports this module. */
export interface StreetGrid {
  half: number;
  avenues: number[];
  crossEvery: number;
  yAvenue: number;
  yCross: number;
}

// ---------------------------------------------------------------- lanes

/**
 * The three lane lines: the midpoints of LANES, -3.5 / 0 / +3.5. Derived,
 * not typed: they were a literal [-3.5, 0, 3.5] beside a LANES table
 * they had to agree with and nothing checked that they did.
 *
 * Nothing marks the middle one out, and that is correct rather than an
 * omission: all four lanes run the same way — the AI spawns round-robin
 * across LANES, there is a guardrail on both edges and no median object
 * anywhere — so lat 0 is an ordinary lane divide, and painting it as a
 * centre line would tell the driver about oncoming traffic that does not
 * exist. tests/road.mjs holds that (zero median objects).
 */
export function laneLineLats(): number[] {
  const out: number[] = [];
  for (let k = 0; k + 1 < LANES.length; k++) out.push((LANES[k] + LANES[k + 1]) / 2);
  return out;
}

/** The edge line's band at `s` on `side` (±1), as signed lats, inner
 *  edge first. */
export function edgeBand(track: Track, s: number, side: number): [number, number] {
  const hw = track.halfWidthAt(s);
  return [side * (hw + MARKINGS.edge.inner), side * (hw + MARKINGS.edge.inner + MARKINGS.edge.width)];
}

/** A stud's lat: the edge line's centre. The line is drawn at
 *  halfWidthAt(s), not at the constant, and so are its studs: reading
 *  the constant once marched a row of reflectors 11.58 m out across the
 *  open drift plaza at s = 558. */
export function studLat(track: Track, s: number, side: number): number {
  return side * (track.halfWidthAt(s) + MARKINGS.edge.inner + MARKINGS.edge.width / 2);
}

// ------------------------------------------------------------ junctions

/**
 * Would a block or a tower of this half-width, on this band of the
 * ring, stand on a forecourt or in the painter's bay? Both the
 * rectangles and the drums ask, and they used to each carry their own
 * copy of the station test — which is how the painter's would have
 * been left out of one of them. The street paint asks now too: a
 * centre line under a forecourt apron is paint buried under concrete.
 */
export function onForecourt(track: Track, s: number, half: number, lo: number, hi: number): boolean {
  const hit = (site: { s: number; lat: number }, span: number) =>
    Math.abs(track.deltaAhead(site.s, s)) < span + half + 6 && lo < site.lat + 13 && hi > site.lat - 13;
  return (
    STATIONS.some((st) => hit(st, FORECOURT.halfSpan)) ||
    PAINT_SHOPS.some((sh) => hit(sh, PAINT_BAY.halfSpan))
  );
}

export interface Junction {
  /** Cross street index, 0..71. */
  i: number;
  /** Highway s of the cross street's centreline. */
  s: number;
  /** A cross street on the +lat side. Always. */
  plus: boolean;
  /** A cross street on the -lat side: not on the coast, where that side
   *  is the sea. */
  minus: boolean;
  /** Within the tunnel span plus 1% of the lap either side — the rule
   *  the signals have always used to keep a gantry off the portals. */
  inTunnel: boolean;
  /** The cross street passes over the underpass itself (s inside it). */
  overTunnel: boolean;
  /** The road is wider than four lanes anywhere over [s-45, s+10]: the
   *  approach a stop line and its solid lines would need. */
  inSwell: boolean;
  /** The junction mouth itself (s ± street half + 1) is on swollen
   *  tarmac — a forecourt or the plaza — so the street is not painted:
   *  5 (the plaza), 33 (the Shuwaikh station) and 50 (the paint shop).
   *  Not inSwell, which also catches 59, whose 45 m approach window
   *  reaches back into the Dasma station's swell while its own street is
   *  29 m clear of it. */
  mouthInSwell: boolean;
  /** Every other street, clear of the tunnel and of every swell. */
  signalised: boolean;
  /** The rail is open across the mouth. False everywhere until the rail
   *  gaps are built; turn arrows and street stop lines wait for it. */
  open: boolean;
}

/**
 * One record per cross street, in lap order — the single answer to
 * "which junctions exist and what are they". The streets, the paint and
 * the signals all iterate this.
 *
 * Signalised today: 33. The 36 even streets, less 42 and 44 at the
 * tunnel, less 50, which is on the paint shop's forecourt (hw 16.6).
 */
export function junctions(track: Track, streets: StreetGrid): Junction[] {
  const L = track.length;
  const n = Math.round(L / streets.crossEvery);
  const tu = spanU(LAP.tunnel);
  const J = MARKINGS.junction;
  const out: Junction[] = [];
  const wide = (from: number, to: number) => {
    for (let x = from; x <= to + 1e-9; x += 0.5) {
      if (track.halfWidthAt(x) > ROAD_HALF_WIDTH + J.swellTol) return true;
    }
    return false;
  };
  for (let i = 0; i < n; i++) {
    // Spaced by an exact division of the lap so the last block closes
    // onto the first instead of leaving a short stub at the seam.
    const s = (i / n) * L;
    const u = track.wrap(s) / L;
    const onCoast = u >= COAST_U.from && u <= COAST_U.to;
    const inTunnel = u > tu.from - J.tunnelMarginU && u < tu.to + J.tunnelMarginU;
    const overTunnel = s > LAP.tunnel.from && s < LAP.tunnel.to;
    const inSwell = wide(s - J.swellBack, s + J.swellAhead);
    const mouth = streets.half + MARKINGS.street.mouth;
    const mouthInSwell = wide(s - mouth, s + mouth);
    out.push({
      i,
      s,
      plus: true,
      minus: !onCoast,
      inTunnel,
      overTunnel,
      inSwell,
      mouthInSwell,
      signalised: i % J.signalEvery === 0 && !inTunnel && !inSwell,
      open: false,
    });
  }
  return out;
}

/** The signal head's s for a junction. */
export function signalHeadS(j: Junction): number {
  return j.s + MARKINGS.signal.headAfter;
}

/** The stop line's centre, and its two faces, for a junction. */
export function stopLineS(j: Junction): { centre: number; downstream: number; upstream: number } {
  const c = j.s - MARKINGS.stop.setback;
  return { centre: c, downstream: c + MARKINGS.stop.width / 2, upstream: c - MARKINGS.stop.width / 2 };
}

/** The stretch of each lane line that is solid on the approach. */
export function approachSpan(j: Junction): [number, number] {
  const up = stopLineS(j).upstream;
  return [up - MARKINGS.approach.length, up];
}

/** Lane lines are hidden over (from, to] of every signalised junction. */
export function boxSpan(j: Junction): [number, number] {
  return [approachSpan(j)[0], j.s + MARKINGS.box.after];
}

// ------------------------------------------------------------- arrows

export type ArrowKind = "ahead" | "left" | "right";

/**
 * A lane arrow's outline, in metres: [across, along], across positive to
 * the RIGHT of travel and along positive FORWARD, the arrow centred on
 * (0, 0) so it runs along -length/2 .. +length/2 with the tip at the top.
 * A simple polygon, wound however the points fall — ShapeGeometry
 * decides the facing itself.
 */
export function arrowOutline(kind: ArrowKind): Array<[number, number]> {
  const A = MARKINGS.arrow;
  const tail = -A.length / 2;
  const tip = A.length / 2;
  const base = tip - A.headLength;
  const sh = A.shaft / 2;
  const hh = A.headWidth / 2;
  if (kind === "ahead") {
    return [
      [-sh, tail],
      [sh, tail],
      [sh, base],
      [hh, base],
      [0, tip],
      [-hh, base],
      [-sh, base],
    ];
  }
  // The turn branch, built for the right and mirrored for the left. It
  // leaves the shaft's centreline `branchBack` behind the head base at
  // 45 degrees, with a head of its own sized so neither its tip nor its
  // outer corner passes `branchReach` from the lane centre.
  const r = Math.SQRT1_2;
  const root: [number, number] = [0, base - A.branchBack];
  const d: [number, number] = [r, r];
  const nrm: [number, number] = [r, -r]; // right-and-back, across the branch
  const bHead = 0.9;
  const bHalf = 0.35;
  // Longest shaft that keeps the tip inside the reach.
  const bShaft = A.branchReach / r - bHead - 0.05;
  const at = (t: number, o: number): [number, number] => [
    root[0] + d[0] * t + nrm[0] * o,
    root[1] + d[1] * t + nrm[1] * o,
  ];
  // Where the branch's two edges leave the shaft's right edge (x = sh).
  const tLow = (sh - nrm[0] * sh) / d[0];
  const tHigh = (sh + nrm[0] * sh) / d[0];
  const right: Array<[number, number]> = [
    [-sh, tail],
    [sh, tail],
    at(tLow, sh),
    at(bShaft, sh),
    at(bShaft, bHalf),
    at(bShaft + bHead, 0),
    at(bShaft, -bHalf),
    at(bShaft, -sh),
    at(tHigh, -sh),
    [sh, base],
    [hh, base],
    [0, tip],
    [-hh, base],
    [-sh, base],
  ];
  return kind === "right" ? right : right.map(([x, y]) => [-x, y] as [number, number]).reverse();
}

// -------------------------------------------------------------- layout

/** One mark: where its centre is, which way its long axis runs, its
 *  footprint. `hidden` slots are laid at zero scale. */
export interface Mark {
  kind: string;
  s: number;
  lat: number;
  /** Across the mark's own axis. */
  w: number;
  /** Along the mark's own axis. */
  l: number;
  y: number;
  /** The mark's long axis: down the highway ('tangent') or out along a
   *  cross street ('side'). */
  axis: "tangent" | "side";
  hidden?: boolean;
  /** Junction index, where the mark belongs to one. */
  j?: number;
  /** For street centre lines: the segment and the mark's index in it. */
  seg?: string;
  k?: number;
  /** Position along the street in its own metres (lat on a cross street,
   *  arc length on an avenue). */
  a?: number;
}

/** A street centre-line segment: between two mouths, in the street's
 *  own metres. `skipped` says why it carries no paint. */
export interface StreetSegment {
  key: string;
  street: "avenue" | "cross";
  sign: number;
  /** Avenue offset, or the junction for a cross street. */
  d?: number;
  j?: number;
  a0: number;
  a1: number;
  n: number;
  skipped?: string;
  /** The smallest 1 - sign·d·κ over an avenue segment. */
  minStretch?: number;
}

export interface MarkingsLayout {
  junctions: Junction[];
  laneDash: Mark[];
  stop: Mark[];
  approach: Array<{ j: number; lat: number; from: number; to: number }>;
  arrows: Record<ArrowKind, Mark[]>;
  studs: Mark[];
  streetDash: Mark[];
  streetSegments: StreetSegment[];
  streetStop: Mark[];
  legend: Mark[];
}

/** Lay a run of marks inside [a0, a1]: n = floor((len + gap) / cycle),
 *  exactly `gap` between them, the run centred so both ends have the
 *  same clearance, which is then in [0, cycle / 2). */
function centredRun(a0: number, a1: number, mark: number, gap: number): number[] {
  const len = a1 - a0;
  const n = Math.floor((len + gap) / (mark + gap) + 1e-9);
  if (n <= 0) return [];
  const run = n * (mark + gap) - gap;
  const start = a0 + (len - run) / 2;
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(start + k * (mark + gap) + mark / 2);
  return out;
}

/**
 * Street centre lines, by segment. Cross streets measure in lat; avenues
 * in their own arc length, from a table sampled every 0.5 m of highway s
 * and inverted, because the highway's s is not the avenue's: on the
 * inside of the R 166 bend 126 m of lat squeezes the avenue to a quarter
 * of the highway's length, and laying marks at even highway s bunched
 * them to 1.4 m gaps there (+126) and ran them backwards (+188).
 */
export function streetCentreLine(
  track: Track,
  streets: StreetGrid,
  J: Junction[]
): { marks: Mark[]; segments: StreetSegment[] } {
  const S = MARKINGS.street;
  const L = track.length;
  const marks: Mark[] = [];
  const segments: StreetSegment[] = [];
  const mouth = streets.half + S.mouth;
  const outer = streets.avenues[streets.avenues.length - 1];
  const push = (m: Omit<Mark, "kind" | "w" | "l" | "y">) =>
    marks.push({ kind: "street-dash", w: S.width, l: S.mark, y: streets.yCross + S.rise, ...m });

  // Cross streets: from the highway out to the last avenue's mouth.
  for (const j of J) {
    for (const sign of [1, -1]) {
      if (sign > 0 ? !j.plus : !j.minus) continue;
      const hw = track.halfWidthAt(j.s);
      let start = hw + MARKINGS.strip.width + S.crossStart;
      if (j.overTunnel) start = Math.max(start, TUNNEL_BOX.halfWidth + S.tunnelClear);
      const bounds: Array<[number, number]> = [];
      let from = start;
      for (const d of streets.avenues) {
        bounds.push([from, d - mouth]);
        from = d + mouth;
      }
      bounds.push([from, outer + streets.half - S.mouth]);
      bounds.forEach(([a0, a1], b) => {
        const key = `cross:${j.i}:${sign > 0 ? "+" : "-"}:${b}`;
        if (a1 - a0 <= 0) return;
        const seg: StreetSegment = { key, street: "cross", sign, j: j.i, a0, a1, n: 0 };
        segments.push(seg);
        if (j.mouthInSwell) {
          seg.skipped = "swell";
          return;
        }
        const run = centredRun(a0, a1, S.mark, S.gap);
        seg.n = run.length;
        run.forEach((c, k) => {
          const lat = sign * c;
          if (onForecourt(track, j.s, S.width / 2, lat - S.mark / 2, lat + S.mark / 2)) return;
          push({ s: j.s, lat, axis: "side", j: j.i, seg: key, k, a: c });
        });
      });
    }
  }

  // Avenues: between consecutive cross-street mouths on that side.
  //
  // The centreline is sampled once per segment and shared by all eight
  // carriageways (four avenues, both sides): an avenue's point is
  // pointAt(s) + lat·sideAt(s), the same arithmetic track.pose does, so
  // the table is exact and costs one pass of the lap rather than eight —
  // measured 0.75 s against about 0.1 s, at world build, on every load.
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();
  type Samples = { s: Float64Array; px: Float64Array; pz: Float64Array; sx: Float64Array; sz: Float64Array };
  const cache = new Map<string, Samples>();
  const sample = (sa: number, sb: number): Samples => {
    const key = `${sa}:${sb}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const steps = Math.max(1, Math.ceil((sb - sa) / 0.5));
    const out: Samples = {
      s: new Float64Array(steps + 1),
      px: new Float64Array(steps + 1),
      pz: new Float64Array(steps + 1),
      sx: new Float64Array(steps + 1),
      sz: new Float64Array(steps + 1),
    };
    for (let k = 0; k <= steps; k++) {
      const s = sa + ((sb - sa) * k) / steps;
      track.pointAt(s, p);
      track.sideAt(s, side);
      out.s[k] = s;
      out.px[k] = p.x;
      out.pz[k] = p.z;
      out.sx[k] = side.x;
      out.sz[k] = side.z;
    }
    cache.set(key, out);
    return out;
  };
  const coastEnd = COAST_U.to * L;
  for (const d of streets.avenues) {
    for (const sign of [1, -1]) {
      const lat = sign * d;
      // The avenue's extent and the streets that cut it.
      const from = sign > 0 ? 0 : coastEnd;
      const to = L;
      const cuts = J.filter((j) => (sign > 0 ? j.plus : j.minus) && j.s >= from - 1e-9 && j.s < to).map((j) => j.s);
      // Segment ends: a cut is a mouth; the avenue's own end is not.
      const ends: Array<{ s: number; mouth: boolean }> = [];
      if (sign > 0) {
        for (const c of cuts) ends.push({ s: c, mouth: true });
        ends.push({ s: cuts[0] + L, mouth: true }); // the loop closes
      } else {
        ends.push({ s: from, mouth: false });
        for (const c of cuts) ends.push({ s: c, mouth: true });
        ends.push({ s: to, mouth: false });
      }
      for (let e = 0; e + 1 < ends.length; e++) {
        const sa = ends[e].s;
        const sb = ends[e + 1].s;
        const key = `avenue:${sign > 0 ? "+" : "-"}${d}:${e}`;
        // The arc table, every 0.5 m of highway s.
        const T = sample(sa, sb);
        const ss = T.s;
        const steps = ss.length - 1;
        const aa = new Float64Array(steps + 1);
        let minF = Infinity;
        for (let k = 1; k <= steps; k++) {
          const ds = ss[k] - ss[k - 1];
          const dx = T.px[k] + lat * T.sx[k] - (T.px[k - 1] + lat * T.sx[k - 1]);
          const dz = T.pz[k] + lat * T.sz[k] - (T.pz[k - 1] + lat * T.sz[k - 1]);
          aa[k] = aa[k - 1] + Math.hypot(dx, dz);
          // The highway's own direction over the step, from the two side
          // vectors (side = tangent x UP, so tangent = (side.z, -side.x)).
          const tx = T.sz[k - 1] + T.sz[k];
          const tz = -(T.sx[k - 1] + T.sx[k]);
          // Signed stretch: negative where the offset curve has folded
          // back on itself and the avenue runs against the highway.
          minF = Math.min(minF, (dx * tx + dz * tz) / Math.hypot(tx, tz) / ds);
        }
        const A = aa[steps];
        const a0 = ends[e].mouth ? mouth : 0;
        const a1 = ends[e + 1].mouth ? A - mouth : A;
        const seg: StreetSegment = { key, street: "avenue", sign, d, a0, a1, n: 0, minStretch: minF };
        segments.push(seg);
        if (minF < S.minStretch) {
          seg.skipped = "fold";
          continue;
        }
        const run = centredRun(a0, a1, S.mark, S.gap);
        seg.n = run.length;
        let k0 = 0;
        run.forEach((c, k) => {
          while (k0 + 1 < steps && aa[k0 + 1] < c) k0++;
          const t = (c - aa[k0]) / Math.max(1e-9, aa[k0 + 1] - aa[k0]);
          const s = track.wrap(ss[k0] + (ss[k0 + 1] - ss[k0]) * t);
          if (onForecourt(track, s, S.mark / 2, lat - S.width / 2, lat + S.width / 2)) return;
          push({ s, lat, axis: "tangent", seg: key, k, a: c });
        });
      }
    }
  }
  return { marks, segments };
}

/**
 * The plaza legend: one in each of the two lanes nearest the plaza's
 * side, at both approach distances. It was one 4.6 m plate on lat 0,
 * straddling the lane line between two lanes. world.ts builds these
 * (the texture is a canvas, which this module does not touch).
 */
export function legendLayout(): Mark[] {
  const out: Mark[] = [];
  for (const back of MARKINGS.legend.back) {
    for (const k of MARKINGS.legend.lanes) {
      out.push({
        kind: "legend",
        s: DRIFT_PLAZA.s - back,
        lat: LANES[k],
        w: MARKINGS.legend.width,
        l: MARKINGS.legend.length,
        y: MARKINGS.legend.y,
        axis: "tangent",
      });
    }
  }
  return out;
}

/**
 * Where every mark goes. Pure: the builder below lays exactly these, and
 * the test reads them back against the meshes.
 */
export function markingsLayout(track: Track, streets: StreetGrid): MarkingsLayout {
  const L = track.length;
  const Jall = junctions(track, streets);
  const sig = Jall.filter((j) => j.signalised);

  // Lane lines: every slot of the 12 m cycle, hidden through the boxes.
  const laneDash: Mark[] = [];
  const slots = Math.round(L / MARKINGS.lane.cycle);
  const spacing = L / slots;
  const half = MARKINGS.lane.mark / 2;
  const boxes = sig.map(boxSpan);
  for (const lat of laneLineLats()) {
    for (let i = 0; i < slots; i++) {
      const s = i * spacing;
      // The mark [s - 1.5, s + 1.5] against each box, across the seam.
      const hidden = sig.some((j, b) => {
        const d = track.deltaAhead(j.s, s);
        return d + half > boxes[b][0] - j.s && d - half < boxes[b][1] - j.s;
      });
      laneDash.push({
        kind: "lane-dash",
        s,
        lat,
        w: MARKINGS.lane.width,
        l: MARKINGS.lane.mark,
        y: MARKINGS.lane.y,
        axis: "tangent",
        hidden,
      });
    }
  }

  const stop: Mark[] = sig.map((j) => ({
    kind: "stop",
    s: track.wrap(stopLineS(j).centre),
    lat: 0,
    w: MARKINGS.stop.halfSpan * 2,
    l: MARKINGS.stop.width,
    y: MARKINGS.stop.y,
    axis: "tangent",
    j: j.i,
  }));

  const approach: MarkingsLayout["approach"] = [];
  for (const j of sig) {
    const [from, to] = approachSpan(j);
    for (const lat of laneLineLats()) approach.push({ j: j.i, lat, from, to });
  }

  const arrows: Record<ArrowKind, Mark[]> = { ahead: [], left: [], right: [] };
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  for (const j of sig) {
    const tip = stopLineS(j).upstream - MARKINGS.arrow.tipToStop;
    LANES.forEach((lat, k) => {
      // The arrow is straight and its lane is not: an outer lane runs
      // (1 - lat·κ) of the highway's s, so half an arrow back from the
      // tip in HIGHWAY s put the tip of a 6 m arrow 0.09 m off on the
      // R 166 Ras Al-Ard bend (junction 26). The centre is found where
      // the chord to the tip, along this lane, is half the arrow.
      const halfLen = MARKINGS.arrow.length / 2;
      let centre = tip - halfLen;
      track.pose(tip, lat, pb, tmp);
      for (let it = 0; it < 3; it++) {
        track.pose(centre, lat, pa, tmp);
        centre = tip - ((tip - centre) * halfLen) / pa.distanceTo(pb);
      }
      const kind: ArrowKind =
        k === 0 && j.minus && j.open ? "left" : k === LANES.length - 1 && j.open ? "right" : "ahead";
      arrows[kind].push({
        kind: `arrow-${kind}`,
        s: track.wrap(centre),
        lat,
        w: MARKINGS.arrow.headWidth,
        l: MARKINGS.arrow.length,
        y: MARKINGS.arrow.y,
        axis: "tangent",
        j: j.i,
      });
    });
  }

  const studs: Mark[] = [];
  const studN = Math.floor(L / MARKINGS.stud.spacing);
  for (let i = 0; i < studN; i++) {
    const s = i * MARKINGS.stud.spacing;
    for (const side of [-1, 1]) {
      studs.push({
        kind: "stud",
        s,
        lat: studLat(track, s, side),
        w: MARKINGS.stud.footprint,
        l: MARKINGS.stud.footprint,
        y: MARKINGS.edge.y,
        axis: "tangent",
      });
    }
  }

  const street = streetCentreLine(track, streets, Jall);
  const legend = legendLayout();

  return {
    junctions: Jall,
    laneDash,
    stop,
    approach,
    arrows,
    studs,
    streetDash: street.marks,
    streetSegments: street.segments,
    // No stop line faces an unbroken rail. These come back with the rail
    // gaps, on the approach half only, at the open junctions.
    streetStop: [],
    legend,
  };
}

// ------------------------------------------------------------- builder

export interface MarkingMaterials {
  /** Edge lines. */
  line: THREE.Material;
  /** Lane lines, stop lines, solid approaches, arrows. */
  dash: THREE.Material;
  /** Street centre lines. */
  street: THREE.Material;
  /** Raised studs. */
  stud: THREE.Material;
}

/** Lay `marks` as one InstancedMesh of `geo`: centre at pose(s, lat),
 *  long axis down the road or out along the street, hidden slots at
 *  zero scale (kept, so the instance order and count are the layout's). */
function instanced(
  track: Track,
  name: string,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  marks: Mark[]
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, marks.length);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const fwd = new THREE.Vector3(0, 0, 1);
  const one = new THREE.Vector3(1, 1, 1);
  const none = new THREE.Vector3(0, 0, 0);
  marks.forEach((mk, i) => {
    track.pose(mk.s, mk.lat, p, tmp);
    if (mk.axis === "side") track.sideAt(mk.s, dir);
    else track.tangentAt(mk.s, dir);
    q.setFromUnitVectors(fwd, dir);
    p.y = mk.y;
    m.compose(p, q, mk.hidden ? none : one);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = name;
  return mesh;
}

/** A flat rectangle w across by l along, lying face up. */
function flatPlane(w: number, l: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, l);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A lane arrow as flat geometry in the instance frame: +z forward,
 *  -x to the right (setFromUnitVectors((0,0,1), tangent) carries +x to
 *  the LEFT of travel, since sideAt is tangent x UP). */
export function arrowGeometry(kind: ArrowKind): THREE.BufferGeometry {
  const shape = new THREE.Shape(arrowOutline(kind).map(([x, y]) => new THREE.Vector2(-x, -y)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A raised stud: a 100 mm dome 25 mm proud, base at its origin. */
export function studGeometry(): THREE.BufferGeometry {
  const r = MARKINGS.stud.footprint / 2;
  const g = new THREE.SphereGeometry(r, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, MARKINGS.stud.proud / r, 1);
  return g;
}

/**
 * Every highway and street marking as meshes, named the way the rest of
 * the game finds them: 'road-line' (one per edge), 'road-dash',
 * 'road-stop', 'road-approach', 'road-arrow-<kind>', 'road-stud',
 * 'street-dash'. world.ts adds them; tests/markings.mjs builds the same
 * list with stub materials and reads it back.
 */
export function buildRoadMarkings(
  track: Track,
  streets: StreetGrid,
  mats: MarkingMaterials,
  layout: MarkingsLayout = markingsLayout(track, streets)
): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const paint = (o: THREE.Mesh) => {
    // The markings receive too. They sit a centimetre proud of the
    // asphalt they are painted on, and a lane line that stays bright
    // inside a shadow crossing it is the loudest possible way to say
    // that the shadow is not really there.
    o.receiveShadow = true;
    out.push(o);
  };

  // Edge lines: continuous, inner edge on the tarmac edge.
  for (const side of [-1, 1]) {
    const line = new THREE.Mesh(
      buildRibbon(
        track,
        (s) => edgeBand(track, s, side)[0],
        (s) => edgeBand(track, s, side)[1],
        MARKINGS.edge.y,
        4
      ),
      mats.line
    );
    line.name = "road-line";
    paint(line);
  }

  paint(instanced(track, "road-dash", flatPlane(MARKINGS.lane.width, MARKINGS.lane.mark), mats.dash, layout.laneDash));
  paint(
    instanced(track, "road-stop", flatPlane(MARKINGS.stop.halfSpan * 2, MARKINGS.stop.width), mats.dash, layout.stop)
  );

  if (layout.approach.length) {
    const L = track.length;
    const parts = layout.approach.map((a) =>
      buildRibbon(
        track,
        a.lat - MARKINGS.lane.width / 2,
        a.lat + MARKINGS.lane.width / 2,
        MARKINGS.lane.y,
        3,
        a.from / L,
        a.to / L
      )
    );
    const approach = new THREE.Mesh(mergeGeometries(parts)!, mats.dash);
    for (const g of parts) g.dispose();
    approach.name = "road-approach";
    paint(approach);
  }

  // Only the kinds that have an instance: before the rail opens, every
  // arrow is 'ahead', and an empty mesh is a draw call for nothing.
  for (const kind of ["ahead", "left", "right"] as ArrowKind[]) {
    if (!layout.arrows[kind].length) continue;
    paint(instanced(track, `road-arrow-${kind}`, arrowGeometry(kind), mats.dash, layout.arrows[kind]));
  }

  const studs = instanced(track, "road-stud", studGeometry(), mats.stud, layout.studs);
  out.push(studs);

  paint(
    instanced(
      track,
      "street-dash",
      flatPlane(MARKINGS.street.width, MARKINGS.street.mark),
      mats.street,
      layout.streetDash
    )
  );
  if (layout.streetStop.length) {
    paint(instanced(track, "street-stop", flatPlane(4.85, 0.3), mats.street, layout.streetStop));
  }
  return out;
}
