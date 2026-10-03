import * as THREE from "three";
import { makeRng, type Rng } from "./rand";
import type { Track } from "./track";

// The date palm, as one pure module.
//
// The corniche palms read as dracaena, yucca or agave rather than as
// Phoenix dactylifera, and every still showed why: 26 opaque green
// straps fanned into a flat disc (frond layer -1.23..+0.72 m on a 6.2 m
// span, an aspect of 0.31), no leaflets, sky through two-thirds of the
// head (coverage inside the hull 0.34 in the lock still), emerald where
// a date palm is glaucous grey-green (HSV saturation 0.52-0.81 in every
// still, G p99 206 under a lamp), a 1.35 m spear standing 0.63 m clear
// of every frond like a horn, and a chocolate tapered pole for a trunk.
//
// It was also two crowns, and they were not the same tree. The corniche
// started on a 20-box stand-in and swapped to palm.glb when that file
// landed, seconds into play; Green Island and the plaza kept the stand-in
// for ever; and anything done to the stand-in vanished from the corniche
// the moment the download finished. palm.glb has no UV layer either
// (mesh_from_quads never wrote one), so it could not carry a leaflet
// texture at all.
//
// So the crown, its leaflet texture, the trunk, the bark and where the
// trees stand are all built HERE, from one spec, in plain three with no
// DOM and no world.ts import — the same deal plants.ts has, and for the
// same reason: tests/palms.mjs builds exactly what the game draws and
// measures it in node, without a browser. There is no palm.glb any more.
//
// WHAT A DATE PALM CROWN IS, AND HOW IT IS BUILT
//
// Sixty to eighty live fronds on a kept corniche palm, each a rachis 3 to
// 4 m long with a bare spiny petiole for its first fifth and about a
// hundred and fifty leaflets after that, folded into a V. The young ones
// stand at 60-80 degrees round the spear; the old ones go over and hang.
// Modelling the leaflets is 9.6k triangles a crown and 1.26M for the
// avenue; two alpha-tested cards per frond (the V-fold), carrying a
// leaflet texture, give the same silhouette at 2.6k.
//
// Measured on what this file builds (tests/palms.mjs prints all of it):
//
//                   fronds  tris   span    y range        aspect
//   kept            64      2,576  8.21 m  -1.98..+2.62   0.56
//   full            72      2,896  8.20 m  -2.98..+2.60   0.68
//   young           52      2,096  7.97 m  -0.78..+2.64   0.43
//   palm.glb (old)  26      3,004  6.2 m   -1.24..+0.95   0.31
//
// The spear tops out at 1.15 m, 1.4 m under the youngest frond's 2.61.
// Leaflet half-span peaks at 0.40 m at t 0.54 and ends in a 1 cm tip;
// the petiole is 0.06 m. The mature leaf lands at sRGB (80,88,70), h89
// s0.20, linear Y 0.09 (was (57,122,43), h109 s0.65, Y 0.150); the old
// fronds' tips at hue 42-54 (were 99-104).
//
// THE SHARED STREAM
//
// placePalms draws from the world's shared stream exactly as the old
// loop in world.ts did — the inland lateral (every fifth palm), the
// along-road jitter, the size, the yaw and the wind phase, in that
// order, 131 x 4 + 26 = 550 draws — because one draw added or dropped
// there moves every building, lamp and billboard placed after the palms.
// Everything new (crown size, girth, which of three crowns) comes from
// a stream of its own. tests/palms.mjs counts the draws.

// -------------------------------------------------------------- spec

export type PalmKind = "kept" | "full" | "young";
/** Index order of the three crowns: the variant byte in a placement and
 *  the order of the three InstancedMeshes in world.ts. */
export const PALM_KINDS: readonly PalmKind[] = ["kept", "full", "young"];

/**
 * The one spec the builder and the test both read.
 *
 * A frond of age `a` (0 = the youngest, by the spear; `ageMax` = the
 * oldest still green) leaves the heart lower and further out the older
 * it is, starts at 75 degrees and loses 125 degrees per unit of age, and
 * bends further over along its length the older it is — so the head has
 * young fronds standing up round the spear and old ones hanging, which
 * is the depth a flat disc of straps never had.
 */
export const PALM = {
  frond: {
    /** Successive fronds on the golden angle, so no two neighbours
     *  share a gap. */
    goldenDeg: 137.508,
    /** The bare petiole: the first 18% of a frond carries spines, not
     *  leaflets (real fronds: 15-25%). */
    petiole: 0.18,
    /** Each half of the frond rises this far above the rachis plane:
     *  the V-fold, seen end-on. */
    vFoldDeg: 35,
    /** Rows along each half-card, petiole row included. */
    segments: 10,
    /** The rachis twists by this much from base to tip, in a direction
     *  picked per frond, so the cards do not all face the sky. */
    rollDeg: 40,
    /** Per-frond scatter, so the golden angle does not read as a
     *  machined rosette. Plus or minus. */
    jitter: { azDeg: 6, elevDeg: 6, len: 0.06 },
  },
  kinds: {
    /** A corniche palm the municipality keeps trimmed. */
    kept: { fronds: 64, ageMax: 0.62, dead: 0, scale: 1 },
    /** An untrimmed one: more fronds, older ones still on, and the four
     *  oldest gone to straw-brown and hanging. */
    full: { fronds: 72, ageMax: 0.74, dead: 4, scale: 1 },
    /** A younger tree: fewer, younger fronds, and placed 15% smaller. */
    young: { fronds: 52, ageMax: 0.5, dead: 0, scale: 0.85 },
  },
  /** The unopened frond at the heart: two crossed narrow cards. Its top
   *  must stay under the youngest fronds' tips — the old 1.35 m spear
   *  stood 0.63 m clear of every frond and read as a horn. */
  spear: { y0: 0.3, h: 0.85, halfWidth: 0.03, segments: 4 },
  /** Where a frond leaves the heart, by age: radius r0 -> r1 and height
   *  y0 -> y1 above the trunk top, from the youngest to age 1. */
  base: { r0: 0.16, r1: 0.26, y0: 0.25, y1: -0.6 },
  /** Normals: each card's own normal, bent this far toward the crown's
   *  centre-out direction (from y = normalCentreY), so the head shades as
   *  one volume rather than as 128 separate planks. */
  normalBlend: 0.6,
  normalCentreY: 0.5,
} as const;

/**
 * Leaf albedo, LINEAR. The vertex colours carry the whole palette (the
 * material colour is white and the leaflet texture is near-white), so a
 * crown's colour lives here and nowhere else.
 *
 * The old crown stacked three greens: a 0x3a6b35 material (linear G/R
 * 3.5), an instance tint that multiplied G by 1.31 and B by 0.69, and
 * radial vertex multipliers on top — mid-frond sRGB about (57,122,43),
 * saturation 0.65, hue 109, and "straw" tips that came out hue 99-104,
 * saturation 0.72: still green. A date palm's leaf is a waxy glaucous
 * grey-green, and these are measured in the sRGB HSV they land at:
 *
 *   young   #576145  h81  s0.29   the fresh fronds round the spear
 *   mature  #525b49  h90  s0.20   the body of the head
 *   old     #655f48  h48  s0.29   the lowest green fronds, yellowing
 *   straw   #7c6f52  h41  s0.34   sun-dried leaflet tips
 *   dead    #61523e  h34          the hanging skirt on an untrimmed palm
 *   rachis  #736c55  h46  s0.26   the midrib, paler than the leaflets
 *
 * Author greyer than the target: the grade's vibrance 0.8 adds chroma to
 * low-saturation midtones, so the bar on screen is s <= 0.40, not 0.20.
 */
export const PALM_LEAF = {
  young: [0.095, 0.12, 0.06],
  mature: [0.085, 0.105, 0.066],
  old: [0.13, 0.115, 0.065],
  straw: [0.2, 0.16, 0.085],
  dead: [0.12, 0.085, 0.048],
  rachis: [0.17, 0.15, 0.09],
} as const;

type RGB = readonly [number, number, number] | readonly number[];

const DEG = Math.PI / 180;
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix3 = (a: RGB, b: RGB, k: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

/** Leaflet half-span of a frond at arc parameter t, metres. 0.06 on the
 *  petiole (the spines' reach), then a lanceolate envelope that peaks at
 *  0.40 m a little past mid-frond and closes to a 1 cm terminal leaflet.
 *  The old strap was widest at the HEART (0.44 m at t = 0) and blunt at
 *  the tip (0.12-0.17 m), which is the wrong way round on both ends. */
export function frondHalfSpan(t: number): number {
  if (t <= PALM.frond.petiole) return 0.06;
  const x = Math.min(1, (t - PALM.frond.petiole) / (1 - PALM.frond.petiole));
  return Math.max(0.01, 0.55 * Math.max(0, Math.sin(Math.PI * x)) ** 0.6 * (1 - 0.5 * t));
}

/** The arc-parameter rows of one half-card: the heart, the end of the
 *  petiole, and evenly through the leaflets to the tip. The petiole's
 *  end is a row of its own so the bare stretch ends exactly where the
 *  texture's leaflets begin. */
function frondRows(): number[] {
  const { petiole, segments } = PALM.frond;
  const rows = [0, petiole];
  for (let j = 1; j < segments; j++) rows.push(petiole + ((1 - petiole) * j) / (segments - 1));
  return rows;
}

// -------------------------------------------------------------- crown

/** What buildPalmCrown measured on what it built, for the world and the
 *  test to read rather than re-derive. */
export interface PalmCrownInfo {
  kind: PalmKind;
  fronds: number;
  tris: number;
  petiole: number;
  /** Vertices per frond (two half-cards), and where the spear's start.
   *  Frond f owns vertices [f * perFrond, (f + 1) * perFrond). */
  perFrond: number;
  rows: number;
  spearStart: number;
  spearTop: number;
  /** Highest point of the youngest frond. */
  youngTop: number;
  /** Twice the widest horizontal reach, and the crown's extent in y,
   *  all about the trunk top. */
  span: number;
  top: number;
  bottom: number;
}

/**
 * Build one date palm crown. The origin is the TRUNK TOP (y = 0) — the
 * old crowns carried a 6.1 m offset baked in, so every placement had to
 * know the stand-in's trunk height. Indexed, with position, normal, uv
 * (u across the half-card, 0 at the rachis; v along the frond), colour
 * and the bend weight.
 *
 * The bend weight is t^2 along each frond. The old one was radial —
 * (r / rMax)^3 from the crown's axis (plants.ts bakeBendWeight) — which
 * gives a young frond standing at 70 degrees beside the spear a weight
 * of about zero, so the fronds that most visibly sway on a real palm
 * were the ones pinned still.
 */
export function buildPalmCrown(kind: PalmKind = "kept", seed = 0x50414c4d): THREE.BufferGeometry {
  const K = PALM.kinds[kind];
  const F = PALM.frond;
  const B = PALM.base;
  const rng = makeRng((seed ^ (PALM_KINDS.indexOf(kind) + 1) * 0x9e3779b1) >>> 0);
  const rows = frondRows();
  const R = rows.length;
  const perFrond = 2 * R * 2;
  const spearVerts = 2 * (PALM.spear.segments + 1) * 2;
  const nV = K.fronds * perFrond + spearVerts;
  const pos = new Float32Array(nV * 3);
  const nor = new Float32Array(nV * 3);
  const uv = new Float32Array(nV * 2);
  const col = new Float32Array(nV * 3);
  const wgt = new Float32Array(nV);
  const idx: number[] = [];
  let v = 0;

  const centre = new THREE.Vector3(0, PALM.normalCentreY, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const d = new THREE.Vector3();
  const lat = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const Br = new THREE.Vector3();
  const Nr = new THREE.Vector3();
  const E = new THREE.Vector3();
  const n = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const cosV = Math.cos(F.vFoldDeg * DEG);
  const sinV = Math.sin(F.vFoldDeg * DEG);

  const put = (P: THREE.Vector3, Nn: THREE.Vector3, u: number, t: number, c: RGB, w: number): number => {
    // Every normal is the card's, bent toward the crown's centre-out
    // direction and renormalised.
    radial.copy(P).sub(centre);
    if (radial.lengthSq() < 1e-8) radial.set(0, 1, 0);
    radial.normalize();
    n.copy(Nn).multiplyScalar(1 - PALM.normalBlend).addScaledVector(radial, PALM.normalBlend);
    if (n.lengthSq() < 1e-8) n.copy(radial);
    n.normalize();
    pos.set([P.x, P.y, P.z], v * 3);
    nor.set([n.x, n.y, n.z], v * 3);
    uv.set([u, t], v * 2);
    col.set([c[0], c[1], c[2]], v * 3);
    wgt[v] = w;
    return v++;
  };

  let youngTop = -Infinity;
  for (let i = 0; i < K.fronds; i++) {
    const qa = K.fronds > 1 ? i / (K.fronds - 1) : 0; // 0 youngest .. 1 oldest
    const a = K.ageMax * qa;
    const az = (i * F.goldenDeg + (2 * rng() - 1) * F.jitter.azDeg) * DEG;
    const elev0 = (75 - 125 * a + (2 * rng() - 1) * F.jitter.elevDeg) * DEG;
    const len = (2.6 + 1.5 * smoothstep(0, 0.35, a) - 0.6 * a) * (1 + (2 * rng() - 1) * F.jitter.len);
    const roll = (rng() < 0.5 ? -1 : 1) * F.rollDeg * DEG;
    const droop = 0.45 + 1.1 * a;
    const dead = i >= K.fronds - K.dead;
    const rb = B.r0 + (B.r1 - B.r0) * a;
    const yb = B.y0 + (B.y1 - B.y0) * a;
    d.set(Math.cos(az), 0, Math.sin(az));
    // The lateral is horizontal and square to the frond's azimuth, which
    // keeps it square to the tangent at every elevation — including past
    // vertical, where cross(up, T) would flip sign on the oldest fronds.
    lat.crossVectors(up, d).normalize();

    // The spine: integrate (cos theta, sin theta) * len along t on a
    // fine grid (midpoint rule), and read it off at the card rows.
    const SUB = 96;
    const theta = (t: number) => elev0 - droop * t ** 1.6;
    const hs = new Float64Array(SUB + 1), ys = new Float64Array(SUB + 1);
    for (let s = 0; s < SUB; s++) {
      const th = theta((s + 0.5) / SUB);
      hs[s + 1] = hs[s] + (Math.cos(th) * len) / SUB;
      ys[s + 1] = ys[s] + (Math.sin(th) * len) / SUB;
    }
    const spine = rows.map((t) => {
      const f = t * SUB;
      const j = Math.min(SUB - 1, Math.floor(f));
      const fr = f - j;
      const hh = hs[j] + (hs[j + 1] - hs[j]) * fr;
      const yy = ys[j] + (ys[j + 1] - ys[j]) * fr;
      return new THREE.Vector3(d.x * (rb + hh), yb + yy, d.z * (rb + hh));
    });

    // Base colour by age; the leaflet tips dry toward straw, more on
    // the older fronds; the inner edge (the rachis) is paler; and the
    // heart is shaded by everything above it.
    const base: [number, number, number] = dead
      ? [...PALM_LEAF.dead] as [number, number, number]
      : qa < 0.7
        ? mix3(PALM_LEAF.young, PALM_LEAF.mature, Math.min(1, qa / 0.15))
        : mix3(PALM_LEAF.mature, PALM_LEAF.old, (qa - 0.7) / 0.3);

    for (const side of [1, -1]) {
      const first = v;
      for (let r = 0; r < R; r++) {
        const t = rows[r];
        const th = theta(t);
        T.copy(d).multiplyScalar(Math.cos(th)).addScaledVector(up, Math.sin(th)).normalize();
        N.crossVectors(T, lat);
        const psi = roll * t;
        Br.copy(lat).multiplyScalar(Math.cos(psi)).addScaledVector(N, Math.sin(psi));
        Nr.crossVectors(T, Br);
        // The half-card runs out along E = +-B cos(fold) + N sin(fold);
        // its upper face's normal is N cos(fold) -+ B sin(fold).
        E.copy(Br).multiplyScalar(side * cosV).addScaledVector(Nr, sinV);
        const Nc = q.copy(Nr).multiplyScalar(cosV).addScaledVector(Br, -side * sinV);
        const w = frondHalfSpan(t);
        let c = base;
        if (!dead) c = mix3(c, PALM_LEAF.straw, smoothstep(0.8, 1, t) * (0.25 + 0.75 * qa));
        const ao = 0.55 + 0.45 * smoothstep(0, 0.45, t);
        const tip: [number, number, number] = [c[0] * ao, c[1] * ao, c[2] * ao];
        const rach = mix3(c, PALM_LEAF.rachis, 0.6).map((x) => x * ao);
        const wt = t * t;
        put(spine[r], Nc, 0, t, rach, wt);
        p.copy(spine[r]).addScaledVector(E, w);
        put(p, Nc, 1, t, tip, wt);
      }
      for (let r = 0; r < R - 1; r++) {
        const a0 = first + r * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
        idx.push(a0, a1, b0, b0, a1, b1);
      }
    }
    if (i === 0) {
      for (let j = i * perFrond; j < v; j++) youngTop = Math.max(youngTop, pos[j * 3 + 1]);
    }
  }

  // The spear: two crossed cards on the rachis strip of the texture
  // (u < 0.05 is opaque), tapering to a point.
  const spearStart = v;
  const S = PALM.spear;
  const spearCol = PALM_LEAF.young.map((x) => x * 1.1);
  for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
    const first = v;
    const cardN = new THREE.Vector3().crossVectors(axis, up).normalize();
    for (let r = 0; r <= S.segments; r++) {
      const t = r / S.segments;
      const w = S.halfWidth * (1 - 0.85 * t);
      for (const sgn of [-1, 1]) {
        p.set(axis.x * w * sgn, S.y0 + S.h * t, axis.z * w * sgn);
        put(p, cardN, sgn < 0 ? 0 : 0.04, 0.5 + 0.4 * t, spearCol, 0.1 * t);
      }
    }
    for (let r = 0; r < S.segments; r++) {
      const a0 = first + r * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
      idx.push(a0, a1, b0, b0, a1, b1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("grnWeight", new THREE.BufferAttribute(wgt, 1));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  let reach = 0;
  for (let j = 0; j < nV; j++) reach = Math.max(reach, Math.hypot(pos[j * 3], pos[j * 3 + 2]));
  const bb = geo.boundingBox!;
  const info: PalmCrownInfo = {
    kind,
    fronds: K.fronds,
    tris: idx.length / 3,
    petiole: PALM.frond.petiole,
    perFrond,
    rows: R,
    spearStart,
    spearTop: S.y0 + S.h,
    youngTop,
    span: 2 * reach,
    top: bb.max.y,
    bottom: bb.min.y,
  };
  geo.userData.palm = info;
  return geo;
}

// ------------------------------------------------------- leaflet atlas

/**
 * The leaflet texture: one half of a frond, rachis on the left (u = 0),
 * heart at the bottom (v = 0), drawn in pure arithmetic so node can
 * measure it.
 *
 *   u < 0.05            the rachis: opaque, white
 *   v < 0.18            the petiole: eight spines, thin triangles 0.35 W
 *                       long, angled 40 degrees toward the tip
 *   the rest            70 lanceolate leaflets, from the rachis out to
 *                       0.92-0.98 W, slanting toward the tip, each a
 *                       slightly different grey (0.82-1.0) with a pale
 *                       midrib, antialiased at the edge
 *
 * Grey, not green: the vertex colours carry the palette.
 *
 * THE MIPS ARE THE POINT. A box-filtered alpha mip chain thickens: the
 * fraction of texels at alpha >= 0.5 — what an alpha test or A2C keeps —
 * drifts up level by level, and a distant crown goes SOLID, the very
 * strap it was built to stop being. So each level's alpha is scaled by
 * a factor found by bisection that puts its leaflet-zone coverage back
 * on mip 0's (the coverage-preserving mip of Castaño's alpha-tested
 * foliage). Measured: mip 0 covers 0.503 of the leaflet zone (petiole
 * zone 0.075); plain box mips drift to 0.510, 0.553, 0.602, 0.649 and
 * 0.712 over levels 1-5, and the scaled chain holds 0.500-0.505. The
 * mean grey under opaque texels is 0.934 (linear), which is what the
 * vertex colours are multiplied by.
 */
export const LEAF_ATLAS = {
  width: 128,
  height: 512,
  leaflets: 70,
  /** Rachis strip, as a fraction of the width. */
  rachis: 0.05,
  /** Leaflets start here across the card, and end in this range. */
  uFrom: 0.03,
  uTo: [0.92, 0.98],
  /** How far toward the tip a leaflet's end sits, as a fraction of the
   *  card's length per unit of its own reach. */
  slant: 0.11,
  /** Peak half-width of a leaflet, texels. */
  halfWidthPx: 1.9,
  /** Linear grey per leaflet, and the midrib's lift. */
  lum: [0.82, 1.0],
  midrib: 0.08,
  /** Linear grey under the transparent texels, so filtering never pulls
   *  a dark fringe into an edge. */
  ground: 0.9,
  spines: 8,
  spineLen: 0.35,
  spineDeg: 40,
  spineHalfPx: 1.2,
  seed: 0x4c454146, // "LEAF"
} as const;

export interface LeafAtlas {
  width: number;
  height: number;
  /** RGBA8, rgb sRGB-encoded, the full chain to 1x1. */
  mips: { data: Uint8Array; width: number; height: number }[];
  /** Per level: the fraction of leaflet-zone texels with alpha >= 0.5. */
  coverage: number[];
  /** Per level: the same, before the coverage scale was applied. */
  rawCoverage: number[];
  /** Mip 0: the petiole zone's coverage, and the mean LINEAR grey over
   *  opaque texels — what the vertex colour is multiplied by. */
  petioleCoverage: number;
  meanOpaque: number;
}

const toSrgb8 = (x: number): number => {
  const c = Math.max(0, Math.min(1, x));
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
};
/** sRGB byte to linear. Exported for the test's colour arithmetic. */
export const srgb8ToLinear = (b: number): number => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Fraction of the rows at or past the petiole (v >= 0.18) whose alpha
 *  clears 0.5 after scaling by `s`. */
function zoneCoverage(alpha: Float32Array, w: number, h: number, s: number, from: number, to: number): number {
  let n = 0, hit = 0;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    if (v < from || v >= to) continue;
    for (let x = 0; x < w; x++) {
      n++;
      if (alpha[y * w + x] * s >= 0.5) hit++;
    }
  }
  return n ? hit / n : 0;
}

let atlasCache: LeafAtlas | null = null;
export function leafletAtlas(): LeafAtlas {
  if (atlasCache) return atlasCache;
  const A = LEAF_ATLAS;
  const W: number = A.width, H: number = A.height;
  const PET = PALM.frond.petiole;
  const lum = new Float32Array(W * H).fill(A.ground);
  const alpha = new Float32Array(W * H);
  const rng = makeRng(A.seed);

  // One stroke: a segment from P0 along D, half-width hw(tau) texels.
  const stroke = (x0: number, y0: number, dx: number, dy: number, hw: (tau: number) => number, grey: number, rib: number) => {
    const L2 = dx * dx + dy * dy;
    const pad = 3;
    const xa = Math.max(0, Math.floor(Math.min(x0, x0 + dx) - pad));
    const xb = Math.min(W - 1, Math.ceil(Math.max(x0, x0 + dx) + pad));
    const ya = Math.max(0, Math.floor(Math.min(y0, y0 + dy) - pad));
    const yb = Math.min(H - 1, Math.ceil(Math.max(y0, y0 + dy) + pad));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const cx = x + 0.5 - x0, cy = y + 0.5 - y0;
        const tau = (cx * dx + cy * dy) / L2;
        if (tau < 0 || tau > 1) continue;
        const ex = cx - tau * dx, ey = cy - tau * dy;
        const dist = Math.hypot(ex, ey);
        const a = Math.max(0, Math.min(1, hw(tau) - dist + 0.5));
        const i = y * W + x;
        if (a > alpha[i]) {
          alpha[i] = a;
          lum[i] = grey + rib * Math.max(0, 1 - dist / 0.8);
        }
      }
    }
  };

  // Leaflets, evenly pitched from the end of the petiole to the tip.
  const pitch = (1 - PET) / A.leaflets;
  for (let k = 0; k < A.leaflets; k++) {
    const vk = PET + (k + 0.5 + 0.3 * (rng() - 0.5)) * pitch;
    const reach = A.uTo[0] + (A.uTo[1] - A.uTo[0]) * rng();
    const grey = A.lum[0] + (A.lum[1] - A.lum[0]) * rng();
    stroke(
      A.uFrom * W, vk * H,
      (reach - A.uFrom) * W, A.slant * reach * H,
      (tau) => A.halfWidthPx * Math.sqrt(Math.max(0, Math.sin(Math.PI * tau))),
      grey, A.midrib,
    );
  }
  // Spines on the petiole: thin, tapering, angled toward the tip.
  for (let j = 0; j < A.spines; j++) {
    const vj = ((j + 0.5) / A.spines) * PET;
    const len = A.spineLen * W;
    stroke(
      A.uFrom * W, vj * H,
      len * Math.cos(A.spineDeg * DEG), len * Math.sin(A.spineDeg * DEG),
      (tau) => A.spineHalfPx * (1 - tau),
      0.9, 0,
    );
  }
  // The rachis strip, last, so it wins: opaque and white, its edge
  // antialiased like everything else.
  const rx = A.rachis * W;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = Math.max(0, Math.min(1, rx - x));
      const i = y * W + x;
      if (a > 0) {
        lum[i] = (lum[i] * alpha[i] * (1 - a) + 1 * a) / Math.max(1e-6, alpha[i] * (1 - a) + a);
        alpha[i] = Math.max(alpha[i], a);
      }
    }
  }

  // The chain. Box-filter the UNSCALED level (linear grey, straight
  // alpha), then scale a copy so its leaflet-zone coverage equals mip 0's.
  const target = zoneCoverage(alpha, W, H, 1, PET, 1);
  const mips: LeafAtlas["mips"] = [];
  const coverage: number[] = [];
  const rawCoverage: number[] = [];
  let lw = W, lh = H, L = lum, Al = alpha;
  for (;;) {
    let s = 1;
    if (mips.length > 0) {
      // Coverage rises with s; find the s whose coverage lands nearest
      // the target.
      let lo = 0.25, hi = 8;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        if (zoneCoverage(Al, lw, lh, mid, PET, 1) < target) lo = mid;
        else hi = mid;
      }
      const cLo = zoneCoverage(Al, lw, lh, lo, PET, 1);
      const cHi = zoneCoverage(Al, lw, lh, hi, PET, 1);
      s = Math.abs(cLo - target) < Math.abs(cHi - target) ? lo : hi;
    }
    rawCoverage.push(zoneCoverage(Al, lw, lh, 1, PET, 1));
    coverage.push(zoneCoverage(Al, lw, lh, s, PET, 1));
    const data = new Uint8Array(lw * lh * 4);
    for (let i = 0; i < lw * lh; i++) {
      const g = toSrgb8(L[i]);
      data[i * 4] = g;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = g;
      data[i * 4 + 3] = Math.round(255 * Math.min(1, Al[i] * s));
    }
    mips.push({ data, width: lw, height: lh });
    if (lw === 1 && lh === 1) break;
    const nw = Math.max(1, lw >> 1), nh = Math.max(1, lh >> 1);
    const nL = new Float32Array(nw * nh), nA = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sl = 0, sa = 0, cnt = 0;
        for (let yy = 0; yy < 2; yy++) {
          for (let xx = 0; xx < 2; xx++) {
            const sx = Math.min(lw - 1, x * 2 + xx), sy = Math.min(lh - 1, y * 2 + yy);
            sl += L[sy * lw + sx];
            sa += Al[sy * lw + sx];
            cnt++;
          }
        }
        nL[y * nw + x] = sl / cnt;
        nA[y * nw + x] = sa / cnt;
      }
    }
    lw = nw; lh = nh; L = nL; Al = nA;
  }

  let sum = 0, n = 0;
  for (let i = 0; i < W * H; i++) {
    if (alpha[i] >= 0.5) { sum += srgb8ToLinear(toSrgb8(lum[i])); n++; }
  }
  atlasCache = {
    width: W,
    height: H,
    mips,
    coverage,
    rawCoverage,
    petioleCoverage: zoneCoverage(alpha, W, H, 1, 0, PET),
    meanOpaque: n ? sum / n : 0,
  };
  return atlasCache;
}

let leafTex: THREE.DataTexture | null = null;
/** The atlas as a texture, once per session: the chain uploaded as it
 *  is (no generated mips — those are the ones that go solid), trilinear,
 *  clamped, sRGB, anisotropic so a frond seen edge-on along the avenue
 *  keeps its leaflets. */
export function palmLeafTexture(): THREE.DataTexture {
  if (leafTex) return leafTex;
  const a = leafletAtlas();
  const t = new THREE.DataTexture(a.mips[0].data, a.width, a.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.mipmaps = a.mips.map((m) => ({ data: m.data, width: m.width, height: m.height }));
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  leafTex = t;
  return t;
}

// ------------------------------------------------------- leaf shader

const ANCHOR_NORMAL = "#include <normal_fragment_begin>";
const ANCHOR_LIGHTS = "#include <lights_physical_pars_fragment>";
const FACE_FLIP = "normal *= faceDirection;";
const IRRADIANCE = "vec3 irradiance = dotNL * directLight.color;";

const occurrences = (s: string, needle: string): number => s.split(needle).length - 1;

/**
 * Two changes to a MeshStandardMaterial's fragment shader, for the leaf
 * cards only. A pure string transform that THROWS if three ever moves an
 * anchor: a silent no-op here would put the old shading back with no
 * error anywhere, and tests/palms.mjs runs this against three's own
 * ShaderLib so an upgrade fails there first.
 *
 * (a) No back-face flip. A DoubleSide material turns the normal round
 *     on the back face, which on a card is right and on a crown is what
 *     made every frond shade as a tube: lit on top, near black under
 *     (sweep p5 (2,8,0) in the core of the head). With the flip gone both
 *     faces shade with the authored normal — the card's, bent 60% toward
 *     centre-out — so the head reads as one volume. The tangent frame's
 *     own flip (tbn[0], tbn[1]) is left alone.
 *
 * (b) Thin-leaf transmission. A leaf passes light: a frond back-lit by
 *     a lamp below it glows. One diffuse term per direct light, on the
 *     side facing AWAY from the light, scaled by GRN_LEAF_TRANS — diffuse
 *     only, so the specular never sees the back light. Rejected: wrap
 *     lighting on the whole BRDF, which also brightens the front faces
 *     and the specular.
 */
export function patchPalmLeafFragment(fs: string): string {
  if (!fs.includes(ANCHOR_NORMAL)) throw new Error(`patchPalmLeafFragment: no "${ANCHOR_NORMAL}" in the fragment shader`);
  if (!fs.includes(ANCHOR_LIGHTS)) throw new Error(`patchPalmLeafFragment: no "${ANCHOR_LIGHTS}" in the fragment shader`);
  const nfb = THREE.ShaderChunk.normal_fragment_begin;
  const lpp = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (occurrences(nfb, FACE_FLIP) !== 1) throw new Error(`patchPalmLeafFragment: "${FACE_FLIP}" is not in normal_fragment_begin exactly once`);
  if (occurrences(lpp, IRRADIANCE) !== 1) throw new Error(`patchPalmLeafFragment: "${IRRADIANCE}" is not in lights_physical_pars_fragment exactly once`);
  const normalBegin = nfb.replace(FACE_FLIP, () => "// leaf card: both faces keep the authored normal");
  const lights = lpp.replace(IRRADIANCE, () =>
    `${IRRADIANCE}
	#ifdef GRN_LEAF_TRANS
		reflectedLight.directDiffuse += GRN_LEAF_TRANS * saturate( - dot( geometryNormal, directLight.direction ) ) * directLight.color * BRDF_Lambert( material.diffuseContribution );
	#endif`);
  return fs.replace(ANCHOR_NORMAL, () => normalBegin).replace(ANCHOR_LIGHTS, () => lights);
}

// -------------------------------------------------------------- trunk

/** The trunk is built this tall; an instance scales it in y by h / 6.6. */
export const TRUNK_REF_H = 6.6;
/** Radius up the trunk: near-columnar (top 0.235 m, 0.273 at 0.6 m) with
 *  a flare into the ground (0.37 at the foot). The old cylinder went
 *  0.30 -> 0.18, a 0.60 taper, which is a pole, not a date palm. */
export function trunkRadius(y: number): number {
  return 0.235 + 0.035 * (1 - y / TRUNK_REF_H) + 0.1 * Math.exp(-y / 0.22);
}
/** The bark tiles twice round and 6.35 times up the 6.6 m trunk: sixteen
 *  leaf bases round, rows every 0.13 m. */
export const BARK_REPEAT = [2, 6.35] as const;
/** The boot: cut petiole bases in three rings under the crown. */
export const TRUNK_BOOT = { rings: [0.15, 0.4, 0.65], perRing: 7, len: 0.3, upDeg: 40, base: [0.11, 0.05], end: [0.06, 0.03] } as const;
/** How far the trunk goes into the ground below y = 0. The corniche
 *  walkway is at +0.06 and the city floor at -0.08: a trunk that stopped
 *  at 0 would float 80 mm over the city floor, the same bug the
 *  buildings had (BUILDING_FOOTING_M). */
export const TRUNK_FOOTING = 0.25;

/**
 * The trunk: 12 sides x 12 rings (denser at the foot, where the flare
 * is), uv (round / 2pi, y / H), plus the boot — 21 cut petiole bases
 * under the crown, each a 4-sided prism 0.30 m long angled 40 degrees
 * up, in the bark material, where the old crown wore a ring of green
 * stubs. The boot's uv lands on the bark's light lip band.
 */
export function palmTrunkGeometry(): THREE.BufferGeometry {
  const H = TRUNK_REF_H;
  const SIDES = 12, RINGS = 12;
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], idx: number[] = [];
  const ringY = [-TRUNK_FOOTING];
  for (let k = 0; k <= RINGS; k++) ringY.push(H * (k / RINGS) ** 1.4);
  for (const y of ringY) {
    const yc = Math.max(0, y);
    const r = trunkRadius(yc);
    const dr = -0.035 / H - (0.1 / 0.22) * Math.exp(-yc / 0.22);
    for (let j = 0; j <= SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(c * r, y, s * r);
      const nl = Math.hypot(1, dr);
      nor.push(c / nl, -dr / nl, s / nl);
      uvs.push(j / SIDES, y / H);
    }
  }
  for (let k = 0; k < ringY.length - 1; k++) {
    for (let j = 0; j < SIDES; j++) {
      const a0 = k * (SIDES + 1) + j, a1 = a0 + 1, b0 = a0 + SIDES + 1, b1 = b0 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }

  const B = TRUNK_BOOT;
  const lip = BARK_LIP_UV;
  const D = new THREE.Vector3(), Tg = new THREE.Vector3(), Nn = new THREE.Vector3();
  const c0 = new THREE.Vector3(), c1 = new THREE.Vector3();
  const corner = (c: THREE.Vector3, w: number, th: number, su: number, sv: number) =>
    new THREE.Vector3().copy(c).addScaledVector(Tg, su * w / 2).addScaledVector(Nn, sv * th / 2);
  B.rings.forEach((drop, ring) => {
    const y = H - drop;
    for (let j = 0; j < B.perRing; j++) {
      const az = ((j + 0.5 * (ring % 2)) / B.perRing) * Math.PI * 2 + 0.2 * ring;
      const ca = Math.cos(az), sa = Math.sin(az);
      D.set(ca * Math.cos(B.upDeg * DEG), Math.sin(B.upDeg * DEG), sa * Math.cos(B.upDeg * DEG));
      Tg.set(-sa, 0, ca);
      Nn.crossVectors(D, Tg).normalize();
      c0.set(ca * trunkRadius(y) * 0.85, y, sa * trunkRadius(y) * 0.85);
      c1.copy(c0).addScaledVector(D, B.len);
      const ring0 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => corner(c0, B.base[0], B.base[1], u, v));
      const ring1 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => corner(c1, B.end[0], B.end[1], u, v));
      // Four sides and the cut end, each flat-shaded with its own verts.
      const quads: THREE.Vector3[][] = [];
      for (let e = 0; e < 4; e++) quads.push([ring0[e], ring0[(e + 1) % 4], ring1[(e + 1) % 4], ring1[e]]);
      quads.push([ring1[0], ring1[1], ring1[2], ring1[3]]);
      for (const qd of quads) {
        const n = new THREE.Vector3().subVectors(qd[1], qd[0]).cross(new THREE.Vector3().subVectors(qd[3], qd[0])).normalize();
        // Outward: away from the stub's own axis.
        const mid = qd.reduce((m, p) => m.add(p), new THREE.Vector3()).multiplyScalar(0.25);
        const axisPt = c0.clone().addScaledVector(D, Math.max(0, Math.min(B.len, mid.clone().sub(c0).dot(D))));
        const outward = mid.clone().sub(axisPt);
        if (outward.lengthSq() < 1e-10) outward.copy(D);
        const flip = n.dot(outward) < 0;
        if (flip) n.negate();
        const base = pos.length / 3;
        qd.forEach((p, k) => {
          pos.push(p.x, p.y, p.z);
          nor.push(n.x, n.y, n.z);
          // On the lip band, a few texels either way.
          uvs.push((lip[0] + ((k === 1 || k === 2) ? 0.006 : -0.006)) / BARK_REPEAT[0], (lip[1] + (k >= 2 ? 0.004 : -0.004)) / BARK_REPEAT[1]);
        });
        if (flip) idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.trunk = {
    tris: idx.length / 3,
    shaftTris: (ringY.length - 1) * SIDES * 2,
    bootWedges: B.rings.length * B.perRing,
    bootStart: (ringY.length) * (SIDES + 1),
    height: H,
  };
  return geo;
}

// --------------------------------------------------------------- bark

/**
 * The bark of a date palm: the stubs of every frond it has dropped,
 * stacked in a helical diamond lattice. The old one was a 64 px canvas
 * of small triangles in rows (#5a4327, saturation 0.57 — chocolate, and
 * on screen (58,35,20) at 0.66), used as its own bump map, which is
 * colour, not relief.
 *
 * Diamonds half a cell wide and a row high, every row staggered half a
 * cell and the whole lattice sheared one cell per tile, so the rows wind
 * up the trunk the way the leaf bases do (and the tile still wraps).
 * Each diamond: a pale lip along its upper edge (the cut end catching
 * the light), a body, and a dark fibrous scar where it meets its
 * neighbours, with +-6% vertical fibre noise over all of it.
 */
export const BARK = {
  cells: 8,
  /** LINEAR albedo. Mean lands at Y about 0.10, h37 s0.20: grey-brown. */
  body: [0.11, 0.094, 0.068],
  lip: [0.205, 0.175, 0.128],
  scar: [0.034, 0.027, 0.021],
  /** Diamond distance (0 centre, 1 edge) where the lip starts and the
   *  scar starts. */
  lipFrom: 0.5,
  scarFrom: 0.86,
  fibre: 0.06,
  /** Relief: lip 1.0, body 0.6, scar 0.1, as 2.5 cm over a 0.13 m row. */
  height: { lip: 1.0, body: 0.6, scar: 0.1 },
  reliefM: 0.025,
  rowM: 0.13,
} as const;

/** A texel-centre uv (in ONE tile) on the lip of the first diamond: where
 *  the boot's cut bases take their colour from. */
export const BARK_LIP_UV = (() => {
  // Straight above the centre of diamond (0, 0), 0.68 of the way to its
  // edge: inside the lip band (0.5-0.86). Undo the shear for u.
  const Y = 0.5 + 0.68;
  return [(0.5 - Y / BARK.cells) / BARK.cells, Y / BARK.cells] as const;
})();

/** Distance into the diamond lattice at tile uv (u, v): 0 at a diamond's
 *  centre, 1 on its edge, and whether the point is in its upper half. */
function barkDiamond(u: number, v: number): { dd: number; upper: boolean } {
  const C = BARK.cells;
  const X = (u + v / C) * C; // sheared one cell per tile
  const Y = v * C;
  let best = Infinity, upper = false;
  const r0 = Math.floor(Y);
  for (let rr = r0 - 1; rr <= r0 + 1; rr++) {
    const cy = rr + 0.5;
    const off = 0.5 * (((rr % 2) + 2) % 2);
    const k0 = Math.floor(X - off);
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const cx = k + off + 0.5;
      const dd = Math.abs(X - cx) / 0.5 + Math.abs(Y - cy) / 1.0;
      if (dd < best) { best = dd; upper = Y > cy; }
    }
  }
  return { dd: Math.min(1, best), upper };
}

export function barkMaps(size = 128): { albedo: Uint8Array; normal: Uint8Array; mean: [number, number, number]; height: Float32Array } {
  const N = size;
  const hgt = new Float32Array(N * N);
  const lin = new Float32Array(N * N * 3);
  const fibreRng = makeRng(0x4241524b); // "BARK"
  const colPhase = new Float32Array(N), colAmp = new Float32Array(N);
  for (let x = 0; x < N; x++) { colAmp[x] = 2 * fibreRng() - 1; colPhase[x] = fibreRng(); }
  const mean: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, v = (y + 0.5) / N;
      const { dd, upper } = barkDiamond(u, v);
      // Weights for the three bands, softened over a texel or so.
      const scar = smoothstep(BARK.scarFrom - 0.09, BARK.scarFrom + 0.09, dd);
      const lip = upper ? smoothstep(BARK.lipFrom - 0.12, BARK.lipFrom + 0.12, dd) * (1 - scar) : 0;
      const body = 1 - scar - lip;
      // Fibres: vertical streaks, constant per column, rippling up it.
      const f = 1 + BARK.fibre * colAmp[x] * (0.7 + 0.3 * Math.sin(2 * Math.PI * (4 * v + colPhase[x])));
      const i = y * N + x;
      for (let c = 0; c < 3; c++) {
        const val = (BARK.body[c] * body + BARK.lip[c] * lip + BARK.scar[c] * scar) * f;
        lin[i * 3 + c] = val;
        mean[c] += val;
      }
      hgt[i] = BARK.height.body * body + BARK.height.lip * lip + BARK.height.scar * scar;
    }
  }
  for (let c = 0; c < 3; c++) mean[c] /= N * N;
  const albedo = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    albedo[i * 4] = toSrgb8(lin[i * 3]);
    albedo[i * 4 + 1] = toSrgb8(lin[i * 3 + 1]);
    albedo[i * 4 + 2] = toSrgb8(lin[i * 3 + 2]);
    albedo[i * 4 + 3] = 255;
  }
  // Normal by Sobel, wrapping, so the tile's edge is not a crease. Height
  // 0..1 is BARK.reliefM of relief; a texel is rowM / (N / cells) metres.
  const k = BARK.reliefM / (BARK.rowM / (N / BARK.cells)) / 8;
  const at = (x: number, y: number) => hgt[((y + N) % N) * N + ((x + N) % N)];
  const normal = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      let nx = -gx * k, ny = -gy * k, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * N + x) * 4;
      normal[i] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[i + 3] = 255;
    }
  }
  return { albedo, normal, mean, height: hgt };
}

let barkTex: { map: THREE.DataTexture; normalMap: THREE.DataTexture } | null = null;
/** The bark as two textures, once per session: albedo in sRGB, normal
 *  in linear, both repeating BARK_REPEAT, mipmapped and anisotropic. */
export function palmBarkTextures(): { map: THREE.DataTexture; normalMap: THREE.DataTexture } {
  if (barkTex) return barkTex;
  const size = 128;
  const b = barkMaps(size);
  const make = (data: Uint8Array, colorSpace: string) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(BARK_REPEAT[0], BARK_REPEAT[1]);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.colorSpace = colorSpace;
    t.needsUpdate = true;
    return t;
  };
  barkTex = { map: make(b.albedo, THREE.SRGBColorSpace), normalMap: make(b.normal, THREE.NoColorSpace) };
  return barkTex;
}

// ---------------------------------------------------------- placement

/** Something on the verge a palm must keep its crown clear of. */
export interface PalmFixture {
  s: number;
  lat: number;
  kind: "column" | "signal" | "gantry" | "mast" | "floodlight" | "street" | "flyover";
  /** Flyovers: a half-length along the road that holds at every palm
   *  lateral (a deck crosses the whole verge). Absent for point
   *  fixtures, which use PALM_PLACE.clear. */
  half?: number;
}

/** The row's own numbers. */
export const PALM_PLACE = {
  /** One palm per this many metres of coast. */
  pitch: 26,
  /** Along-road jitter, metres (one shared draw). */
  jitter: 6,
  /** Every this-many-th palm stands inland. */
  inlandEvery: 5,
  /** Sea palms this far outside the tarmac edge; inland ones this far
   *  plus up to `inlandSpread`. */
  seaPad: 2.6,
  inlandPad: 3,
  inlandSpread: 4,
  /** A point fixture within this distance (in the ground plane) of a
   *  palm's trunk moves the palm: a crown reaches 3.6-4.2 m. */
  clear: 5,
  /** Inland palms keep this far along the road from a cross street's
   *  centre line: the street's 5 m half-width plus a trunk and a bit. */
  streetClear: 6.3,
  /** A crown's reach from its trunk at the largest scale (the kept
   *  crown's 8.2 m span x 1.08, halved, and a little), and the farthest
   *  a coastal palm stands from the centre line off the swells (hw 7 +
   *  3 + 4): what a flyover's clearance is sized from. */
  crownReach: 4.5,
  latMax: 15,
  /** Trunk-top height h = trunkMin + trunkSpan * u, from the old size
   *  draw — trunk length carries the variety now, and the crown stays
   *  near one size (a mature date palm's head is size-stable; its height
   *  comes from age). The old draw scaled trunk AND crown by 0.82-1.18
   *  together, so a tall palm was a short palm enlarged.
   *
   *  5.8 m at the bottom. Over 50 streams, on EVERY crown vertex, the
   *  trimmed crown's lowest point over the carriageway is 3.76 m still
   *  and 3.66 m bent roadward at the most the wind and a pair of passing
   *  cars ever lean a palm (tests/palms.mjs) — an inland palm on a
   *  5.86 m trunk. A 5.6 m bottom (span 2.4) would measure 3.60 / 3.46.
   *  This comment used to say 3.66 m at 5.8 and 3.401 m at 5.6, and both
   *  came from a check that read only every fifth vertex, which skips
   *  most frond tips, and the tips are the lowest points of a crown. The
   *  3.401 does not come back on this crown at either span. The headroom
   *  the row was really short of was the untrimmed crown's: see fullMinH.
   *  The top, 8.0 m plus a 2.6 m crown, stays more than a metre under the
   *  12 m lanterns, and no crown is within 5 m of a column anyway. */
  trunkMin: 5.8,
  trunkSpan: 2.2,
  crownMin: 0.92,
  crownSpan: 0.16,
  girthMin: 0.9,
  girthSpan: 0.2,
  /** The untrimmed crown hangs to -2.98 m, so it only goes on a trunk at
   *  least this tall, which keeps it over the carriageway's headroom.
   *
   *  6.6, not 6.3. At 6.3 the lowest vertex over the carriageway in 50
   *  streams was the dead skirt of a full crown on a 6.35 m sea-side
   *  trunk: 3.49 m standing still, and 3.24 m once the wind leaned it.
   *  The bend costs 0.25 m there, and almost none of it is the 0.5 s^2
   *  arc drop (2 cm at the 0.2 lean the field reaches). Nearly all of it
   *  is sideways: the skirt hangs just outside the asphalt edge, and a
   *  lean of 0.2 swings each frond tip 0.21 m toward the road and over
   *  it. At 6.6 the full crown's worst is 3.73 m still and 3.63 m with
   *  every crown bent straight at the road, the worst way. The cost
   *  is about five untrimmed palms a build (25.9 -> 21.0 of 131) on the
   *  6.3-6.6 m trunks, which take the trimmed crown. Only which crown a
   *  palm wears changes: the form stream draws the same three numbers. */
  fullMinH: 6.6,
  /** Variant split on the form stream: below the first, kept; below the
   *  second, full (where tall enough); above, young. */
  split: [0.6, 0.85],
  /** Lean: up to this many radians, mostly seaward. */
  tiltMax: 0.1,
} as const;

export interface PalmPlacement {
  i: number;
  /** Wrapped arc length and the unwrapped `at` the trunk stands at. */
  s: number;
  at: number;
  /** How far the clearance rule moved it, metres. */
  shift: number;
  lat: number;
  sea: boolean;
  /** Trunk-top height, crown scale, trunk girth. */
  h: number;
  c: number;
  g: number;
  variant: 0 | 1 | 2;
  yaw: number;
  phase: number;
  /** The foot, in world xz. */
  x: number;
  z: number;
  trunk: THREE.Matrix4;
  crown: THREE.Matrix4;
  tint: [number, number, number];
}

/**
 * Where `at` has to move so the trunk at lateral `lat` is clear of every
 * fixture: the union of the forbidden intervals around it, and the
 * nearer edge of the one it is in. Unwrapped, relative to `at`.
 */
function clearOf(track: Track, at: number, lat: number, sea: boolean, fixtures: readonly PalmFixture[]): number {
  const P = PALM_PLACE;
  const iv: [number, number][] = [];
  for (const f of fixtures) {
    const ds = track.deltaAhead(at, f.s);
    if (Math.abs(ds) > 60) continue;
    const fs = at + ds;
    if (f.kind === "street") {
      if (!sea) iv.push([fs - P.streetClear, fs + P.streetClear]);
    } else if (f.half !== undefined) {
      iv.push([fs - f.half, fs + f.half]);
    } else {
      const dl = lat - f.lat;
      if (Math.abs(dl) < P.clear) {
        const half = Math.sqrt(P.clear * P.clear - dl * dl);
        iv.push([fs - half, fs + half]);
      }
    }
  }
  if (!iv.length) return at;
  iv.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of iv) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  for (const [lo, hi] of merged) {
    if (at > lo && at < hi) return at - lo <= hi - at ? lo - 1e-3 : hi + 1e-3;
  }
  return at;
}

/**
 * Every corniche palm: where it stands, how tall, which crown, and its
 * two instance matrices.
 *
 * `draw` is the world's shared stream and is called EXACTLY as the old
 * loop called rand() — the inland lateral (i % 5 == 4 only), the jitter,
 * the size, the yaw, the phase, per palm, in that order: 131 x 4 + 26 =
 * 550. `leanRng` is the old "PALM" stream, four per palm as before (tilt,
 * direction, and the two tint numbers). `formRng` is new, three per palm:
 * crown scale, girth, variant.
 *
 * Then the clearance rule, which the old loop never had: a trunk within
 * PALM_PLACE.clear of a lamp column, a signal pole, a gantry, a flag mast
 * or a plaza floodlight, or (inland) on a cross street, or under a
 * flyover deck, slides along the road to the nearer edge of the clear
 * ground. The lateral follows halfWidthAt rather than the constant, so the
 * three palms that stood on the Sharq plaza's asphalt (4.0-9.4 m inside
 * the tarmac edge) now stand on the beach behind it.
 */
export function placePalms(
  track: Track,
  draw: Rng,
  leanRng: Rng,
  formRng: Rng,
  fixtures: readonly PalmFixture[],
  coast: { from: number; len: number },
): PalmPlacement[] {
  const P = PALM_PLACE;
  const count = Math.floor(coast.len / P.pitch);
  const out: PalmPlacement[] = [];
  const p = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const lean = new THREE.Matrix4();
  const leanAxis = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const s = coast.from + (i / count) * coast.len;
    const sea = i % P.inlandEvery !== P.inlandEvery - 1;
    // The shared stream, in the old order.
    const jLat = sea ? 0 : draw();
    const at0 = s + draw() * P.jitter;
    const u = draw();
    const tilt = (0.25 + 0.75 * leanRng()) * P.tiltMax;
    const toward = (leanRng() - 0.5) * 1.6; // radians off the seaward line
    const yaw = draw() * Math.PI * 2;
    const hueDraw = leanRng();
    const vDraw = leanRng();
    const phase = draw() * Math.PI * 2;
    // The form stream.
    let c = P.crownMin + P.crownSpan * formRng();
    const g = P.girthMin + P.girthSpan * formRng();
    const vr = formRng();

    const latAt = (a: number) =>
      sea ? -(track.halfWidthAt(a) + P.seaPad) : track.halfWidthAt(a) + P.inlandPad + P.inlandSpread * jLat;
    let at = at0;
    for (let pass = 0; pass < 6; pass++) {
      const next = clearOf(track, at, latAt(at), sea, fixtures);
      if (next === at) break;
      at = next;
    }
    const lat = latAt(at);

    const h = P.trunkMin + P.trunkSpan * u;
    let variant: 0 | 1 | 2 = 0;
    if (vr >= P.split[1]) { variant = 2; c *= PALM.kinds.young.scale; }
    else if (vr >= P.split[0] && h >= P.fullMinH) variant = 1;

    track.pose(at, lat, p, tmp);
    const x = p.x, z = p.z;
    track.sideAt(at, tmp);
    const seaX = -tmp.x, seaZ = -tmp.z;
    const dx = seaX * Math.cos(toward) - seaZ * Math.sin(toward);
    const dz = seaX * Math.sin(toward) + seaZ * Math.cos(toward);
    leanAxis.set(dz, 0, -dx).normalize();
    lean.makeRotationAxis(leanAxis, tilt);
    const foot = new THREE.Matrix4().makeTranslation(x, 0, z);
    const trunk = new THREE.Matrix4()
      .makeScale(g, h / TRUNK_REF_H, g)
      .premultiply(lean)
      .premultiply(foot);
    const crown = new THREE.Matrix4()
      .makeRotationY(yaw)
      .scale(new THREE.Vector3(c, c, c))
      .premultiply(new THREE.Matrix4().makeTranslation(0, h, 0))
      .premultiply(lean)
      .premultiply(foot);
    // Near-neutral, per tree: a little warmer or cooler and a little
    // lighter or darker. The old tint was a green HSL lerped 35% toward
    // 2x, which multiplied G by 1.31 and B by 0.69 — a tint that made
    // every crown greener and could not make one browner. v is held to
    // 0.90-1.10 so no channel leaves 0.84-1.17 at k = +-1.
    const k = 2 * hueDraw - 1;
    const v = 0.9 + 0.2 * vDraw;
    out.push({
      i,
      s: track.wrap(at),
      at,
      shift: at - at0,
      lat,
      sea,
      h,
      c,
      g,
      variant,
      yaw,
      phase,
      x,
      z,
      trunk,
      crown,
      tint: [v * (1 + 0.04 * k), v, v * (1 - 0.06 * k)],
    });
  }
  return out;
}

/** Each palm's slot in its variant's InstancedMesh, in placement order,
 *  and how many each mesh holds — the map the spring field writes
 *  through (palm j -> meshes[variant[j]], instance slot[j]). */
export function palmSlots(variants: ArrayLike<number>): { slot: Uint16Array; counts: [number, number, number] } {
  const counts: [number, number, number] = [0, 0, 0];
  const slot = new Uint16Array(variants.length);
  for (let j = 0; j < variants.length; j++) slot[j] = counts[variants[j]]++;
  return { slot, counts };
}
