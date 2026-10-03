import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { bakeBendWeight } from "./plants";
import { makeRng, WORLD_SEED, type Rng } from "./rand";
import type { Track } from "./track";

// The roadside planting, as shapes and as a layout.
//
// The verge used to be built inline in world.ts from one icosahedron
// whose every vertex took its own rand(). IcosahedronGeometry is not
// indexed — 240 vertices for 42 corners at detail 1 — so the six copies
// of each corner moved independently and the surface tore apart:
// measured on a node replay, copies of one corner ended up as much as
// 0.249 object units apart, about 0.57 m at the widest instance. Behind
// the rail in the ik stills that read as broken green glass with the sky
// showing between the shards (16.5 to 31.2% of the pixels inside a
// shrub's silhouette were background). computeVertexNormals on the same
// unwelded mesh gave face normals, so all 300 of 300 triangles were
// flat-shaded; a Math.max(0, y) folded 36 of the 80 crown faces into a
// down-facing disc nobody could see; one colour per plant; and the
// layout was a 7 m grid with 28% knocked out, which reads as dots, not
// as beds.
//
// Everything here is pure — three, typed arrays and arithmetic, no DOM —
// so tests/shrubs.mjs builds every shape, the leaf texture and the whole
// layout over the real Track under node, the way tests/plants.mjs drives
// the spring field. world.ts owns the meshes, the material and the
// scene; nothing here knows there is a scene.
//
// NONE OF IT DRAWS FROM THE WORLD'S SHARED STREAM. The surface noise is
// a hash (vnoise3), the leaf tile and the layout have their own seeded
// generators, and the shared stream is advanced past the legacy block's
// consumption by burnLegacyVergeDraws — replayed, not counted by hand,
// because the count depends on the values drawn. See there.
//
// WHAT IT MEASURES NOW (tests/shrubs.mjs, three 0.184): four welded
// shapes of 96 to 224 triangles, none flat-shaded, none facing the soil,
// open only along a rim pinned to the ground; canopy luminance 0.037 to
// 0.048 against the old 0.0443, crown 2.3 to 2.9 times as bright as the
// foot. The layout puts 1,913 plants in 220 beds (median 24.9 m): 1,162
// hedge segments, 429 balls, 148 bougainvillea, 174 oleander.
//
// THE COST, AND WHAT IS NOT BUILT YET. That is 358k triangles resident
// against 134k before, and until the verge is chunked and culled — one
// mesh per kind per stretch of lap, culled by pixel size, which this
// change does not do — every one of them is drawn every frame: about
// +224k triangles, some 6% of the 3.7 M-triangle framecost frame. The
// vertex work goes the other way: indexed shapes shade about 200k
// vertices a frame where the unwelded ones shaded about 400k.

/** Linear-light RGB, the space vertex colours are read in. */
export type Rgb = readonly [number, number, number];

export type ShrubKind = "hedge" | "ball" | "mound" | "upright";

/** Build and mesh order. world.ts makes one InstancedMesh per entry. */
export const SHRUB_KINDS: readonly ShrubKind[] = ["hedge", "ball", "mound", "upright"];

interface KindSpec {
  /** Canopy albedo, linear. The bake scales every plant so its
   *  area-weighted canopy luminance equals this colour's. */
  albedo: Rgb;
  /** Flower colour, linear, or null for a plant that does not flower. */
  flower: Rgb | null;
  /** Lean at full spring strength, as a fraction of the plant's height.
   *  A clipped hedge is a dense block of wood and barely moves; a
   *  bougainvillea mound is a heap of whippy canes. */
  bendGain: number;
  /** Share of the beds planted with this kind. */
  weight: number;
}

interface MoundSpec extends KindSpec {
  /** Icosphere subdivision before welding: 2 is 92 corners / 180 faces,
   *  3 is 162 / 320. */
  detail: number;
  /** Radial noise: a broad lobe (frequency 2.2) and a fine one (6). */
  lobe: readonly [number, number];
  /** How far the lower half is squashed, so the plant sits rather than
   *  balances. */
  flat: number;
  /** Footprint diameter range, metres. */
  dia: readonly [number, number];
  /** Height as a multiple of the diameter. */
  hOverDia: number;
  /** Centre-to-centre spacing along a bed, metres. */
  pitch: readonly [number, number];
  /** Extra setback from the front line, metres, so a row of loose
   *  shrubs is not ruled straight the way a clipped row is. */
  jitter: number;
}

interface HedgeSpec extends KindSpec {
  /** One segment's length, and the spacing it is laid at: segments
   *  overlap by the difference, so a run reads as one hedge. */
  len: number;
  pitch: number;
  /** Per-run height and depth ranges, metres. */
  height: readonly [number, number];
  depth: readonly [number, number];
  /** Rounding radii of the clipped edges, object units (x, y, z). */
  round: readonly [number, number, number];
  /** How much wider at the foot than at the top (a hedge is clipped
   *  battered, so light reaches its base). */
  batter: number;
  /** Surface noise: broad and fine amplitude, object units. */
  noise: readonly [number, number];
}

/**
 * Every number the shapes and the layout are built from, in one table.
 *
 * Not in RIG.plant: tools/blender/profiles.json mirrors RIG
 * (scripts/export-car-profiles.mjs), so a constant added there has to be
 * regenerated into a file the shrubs have nothing to do with.
 *
 * THE COLOURS ARE HELD TO TODAY'S EXPOSURE. The old flat plant measured
 * a canopy luminance (linear Y) of 0.037..0.051, mean 0.0443, from
 * 0x3f5136 × the per-instance HSL. A first draft of this table took a
 * Conocarpus green from a photograph, (0.050, 0.100, 0.035): Y 0.085,
 * 1.9 times as bright, which would have moved the levels 'other' class
 * and the night black level along with the shrubs. These are 0.037 to
 * 0.048, and the bake normalises each shape to its own albedo's Y.
 */
export const SHRUB = {
  kinds: {
    /** Clipped Conocarpus — the hedge every Kuwaiti verge has. sRGB
     *  #34422d, saturation 0.32, hue 100°. */
    hedge: {
      albedo: [0.034, 0.054, 0.026],
      flower: null,
      bendGain: 0.35,
      weight: 0.5,
      len: 3.0,
      pitch: 2.7,
      height: [1.1, 1.4],
      depth: [0.8, 1.0],
      round: [0.04, 0.16, 0.16],
      batter: 0.12,
      noise: [0.03, 0.015],
    } as HedgeSpec,
    /** Clipped Ficus balls, in rows. The darkest green of the four. */
    ball: {
      albedo: [0.022, 0.044, 0.018],
      flower: null,
      bendGain: 0.6,
      weight: 0.25,
      detail: 2,
      lobe: [0.05, 0.03],
      flat: 0.4,
      dia: [1.05, 1.4],
      hOverDia: 0.9,
      pitch: [2.8, 3.4],
      jitter: 0,
    } as MoundSpec,
    /** Bougainvillea: a loose heap with magenta bracts on its upper half. */
    mound: {
      albedo: [0.03, 0.052, 0.02],
      flower: [0.3, 0.035, 0.12],
      bendGain: 1.0,
      weight: 0.15,
      detail: 3,
      lobe: [0.16, 0.06],
      flat: 0.25,
      dia: [1.3, 1.7],
      hOverDia: 0.75,
      pitch: [4.5, 6.5],
      jitter: 0.15,
    } as MoundSpec,
    /** Oleander: taller than it is wide, grey-green, pink flowers. */
    upright: {
      albedo: [0.032, 0.048, 0.028],
      flower: [0.36, 0.15, 0.2],
      bendGain: 1.0,
      weight: 0.1,
      detail: 3,
      lobe: [0.12, 0.05],
      flat: 0.35,
      dia: [1.1, 1.5],
      hOverDia: 1.1,
      pitch: [4.0, 5.5],
      jitter: 0.15,
    } as MoundSpec,
  },
  /**
   * The baked light. There is no AO pass in the post chain
   * (engine.ts), so the dark core and the lit crown a shrub has are
   * painted into the vertex colour: `interior` at the base of the mass
   * rising to 1 by `knee`, a yellower tip on the outermost growth, and
   * the bottom `contactY` of the plant (a fraction of its height)
   * pulled down to `contact` where it meets the soil — the contact
   * shadow it cannot cast, since the planting casts none.
   *
   * `height` is how much of the exposure comes from height rather than
   * from distance out from the middle. A first pass weighted it 0.6 with
   * the knee at 0.55, for a sphere that kept its underside; with the
   * underside cut away and the rim on the soil every remaining vertex
   * is already far out, the sides saturated to full brightness by mid
   * height, and the bougainvillea's crown measured only 1.70 times its
   * foot. At 0.7 / 0.7 it is 2.3 to 2.9 across the four shapes.
   */
  ao: { height: 0.7, interior: 0.42, knee: 0.7, tipTint: [1.1, 1.06, 0.86] as Rgb, contactY: 0.08, contact: 0.6 },
  /** Per-vertex leaf mottle, and a little red jitter so the greens are
   *  not one hue. */
  speckle: 0.18,
  redJitter: 0.05,
  /** Where a flowering kind flowers: patches on the upper part of the
   *  crown, where the noise clears `cut`. Tuned so about a fifth to a
   *  third of the upper canopy is in flower — bougainvillea in bloom,
   *  not a magenta ball. */
  flowers: { above: 0.45, freq: 4.5, cut: 0.15 },
  /** Normals bent toward the plant's centre: a shrub is lit as a soft
   *  mass, not as the facets of the mesh that stands for it. */
  spherize: 0.5,
  /** Height (of 1) the spherize centre sits at. */
  spherizeY: 0.4,
  hedgeSpherize: 0.35,
  hedgeSpherizeY: 0.45,
  /** Underside cut: faces whose centre direction on the sphere lies
   *  below this are dropped — they face the soil. */
  dropBelow: -0.15,
  /** The accepted range of area-weighted canopy luminance, for the test. */
  canopyY: [0.034, 0.054] as const,
  /** Triangle ceiling for any one shape. */
  maxTrisPerPlant: 320,
  /**
   * The bed, against the road's own width at the plant's own s.
   *
   * The front face stands at halfWidthAt + 2.10: the W-beam rail is
   * built at halfWidthAt + 0.6 and its section reaches + 0.683
   * (world.ts, the guardrail and W_BEAM), the lamp columns stand at
   * 8.6 and the signal and gantry posts at 8.2 where the road is 7 m —
   * so 2.10 is the first line clear of all of them. The back face stays
   * inside + 3.95; the city bands start at + 4.
   */
  bed: {
    front: 2.1,
    backMax: 3.95,
    /** A run of one planting, then sand. Metres. */
    run: [18, 60] as const,
    gap: [12, 48] as const,
    /** Where each verge's first run may start, metres from the line. */
    start: 20,
    /** Kept clear either side of a cross street's own half-width. */
    streetClear: 1.0,
    /** Kept clear around anything else standing on the verge. */
    avoidPad: 0.3,
    /** The tunnel and its walled approach. */
    tunnelPad: 20,
    /** The seaward verge stops this far short of both lap seams. */
    seam: 40,
    /** Tint per run: value and a warm/cool tilt. */
    tintV: [0.9, 1.1] as const,
  },
  /** Where in the instance a plant sits relative to the city floor:
   *  three centimetres down, so the base meets the ground in an
   *  intersection rather than in a coplanar seam (the same reasoning
   *  as BUILDING_FOOTING_M, at shrub scale). */
  sink: 0.03,
} as const;

// --------------------------------------------------------------- noise

/** Lattice hash → −1..1. Draws nothing from any generator. */
function lattice(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ Math.imul(seed, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x5bd1e995);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/**
 * Hash value noise in three dimensions, −1..1, smoothstep-trilinear.
 *
 * A pure function of position and seed, which is the property that
 * fixes the torn shrubs: every copy of a corner asks the same question
 * and gets the same answer, so a displaced surface cannot come apart.
 */
export function vnoise3(x: number, y: number, z: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const s = seed | 0;
  const c000 = lattice(ix, iy, iz, s), c100 = lattice(ix + 1, iy, iz, s);
  const c010 = lattice(ix, iy + 1, iz, s), c110 = lattice(ix + 1, iy + 1, iz, s);
  const c001 = lattice(ix, iy, iz + 1, s), c101 = lattice(ix + 1, iy, iz + 1, s);
  const c011 = lattice(ix, iy + 1, iz + 1, s), c111 = lattice(ix + 1, iy + 1, iz + 1, s);
  const x00 = c000 + (c100 - c000) * ux, x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux, x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy, y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Rec. 709 luminance of a linear colour. */
export const lumaY = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// --------------------------------------------------------------- shapes

/** Keep the faces `keep` accepts and drop every vertex no face uses. */
function keepFaces(g: THREE.BufferGeometry, keep: (a: number, b: number, c: number) => boolean): THREE.BufferGeometry {
  const idx = g.index!;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const remap = new Int32Array(pos.count).fill(-1);
  const faces: number[] = [];
  for (let f = 0; f < idx.count; f += 3) {
    const a = idx.getX(f), b = idx.getX(f + 1), c = idx.getX(f + 2);
    if (keep(a, b, c)) faces.push(a, b, c);
  }
  const xyz: number[] = [];
  let n = 0;
  for (let k = 0; k < faces.length; k++) {
    const v = faces[k];
    if (remap[v] < 0) {
      remap[v] = n++;
      xyz.push(pos.getX(v), pos.getY(v), pos.getZ(v));
    }
    faces[k] = remap[v];
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(xyz, 3));
  out.setIndex(faces);
  return out;
}

/** Vertices on an edge that only one face uses: the open rim. */
export function openEdgeVertices(g: THREE.BufferGeometry): Set<number> {
  const idx = g.index!;
  const uses = new Map<number, number>();
  const nV = g.getAttribute("position").count;
  const key = (a: number, b: number) => (a < b ? a * nV + b : b * nV + a);
  for (let f = 0; f < idx.count; f += 3) {
    for (let e = 0; e < 3; e++) {
      const k = key(idx.getX(f + e), idx.getX(f + ((e + 1) % 3)));
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  const out = new Set<number>();
  for (const [k, n] of uses) {
    if (n !== 1) continue;
    out.add(Math.floor(k / nV));
    out.add(k % nV);
  }
  return out;
}

/**
 * Scale to the unit frame every shape shares: the top at y = 1, the
 * footprint inside x, z ∈ [−0.5, 0.5]. An instance is then scaled in
 * METRES — (length, height, depth) — whichever shape it landed on,
 * which the old block had to correct for per shape with a topOf table.
 */
function toUnitFrame(g: THREE.BufferGeometry, round: boolean): void {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  let top = 0, rx = 0, rz = 0, rr = 0;
  for (let i = 0; i < pos.count; i++) {
    top = Math.max(top, pos.getY(i));
    rx = Math.max(rx, Math.abs(pos.getX(i)));
    rz = Math.max(rz, Math.abs(pos.getZ(i)));
    rr = Math.max(rr, Math.hypot(pos.getX(i), pos.getZ(i)));
  }
  // A round plant is held inside the unit CIRCLE, so a random yaw can
  // never swing a lobe past the footprint the layout reserved for it.
  const kx = round ? 0.5 / rr : 0.5 / rx;
  const kz = round ? 0.5 / rr : 0.5 / rz;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * kx, pos.getY(i) / top, pos.getZ(i) * kz);
  }
  pos.needsUpdate = true;
}

/** Bend every normal toward the direction out of a centre. */
function spherize(g: THREE.BufferGeometry, cy: number, amount: number): void {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  const n = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nor, i);
    d.set(pos.getX(i), pos.getY(i) - cy, pos.getZ(i)).normalize();
    n.lerp(d, amount).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  nor.needsUpdate = true;
}

/**
 * A loose plant: a welded icosphere, lobed by noise, squashed at the
 * foot, with the underside cut away and the rim pinned to the soil.
 */
function moundShape(spec: MoundSpec, seed: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.5, spec.detail);
  // Welded FIRST, before anything moves: mergeVertices compares
  // position, normal and uv, and the per-face normals and seam uvs an
  // icosphere carries would keep the copies apart.
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const dirY = new Float32Array(pos.count);
  const [l0, l1] = spec.lobe;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const len = Math.hypot(x, y, z);
    const dx = x / len, dy = y / len, dz = z / len;
    dirY[i] = dy;
    // A function of the corner's own direction and nothing else — so
    // the surface is crack-free by construction, not by care.
    const r =
      0.5 *
      (1 +
        l0 * vnoise3(2.2 * dx + 3, 2.2 * dy + 5, 2.2 * dz + 7, seed) +
        l1 * vnoise3(6 * dx, 6 * dy, 6 * dz, seed + 1));
    let py = dy * r;
    if (py < 0) py *= spec.flat;
    pos.setXYZ(i, dx * r, py + 0.5 * spec.flat, dz * r);
  }
  // The underside faces the soil: a third of the faces, and no camera
  // above the city floor can see one. Cut by where the face sits on the
  // sphere rather than by its displaced normal, so a lobe near the
  // equator can never punch a hole in the side.
  const cut = keepFaces(g, (a, b, c) => (dirY[a] + dirY[b] + dirY[c]) / 3 >= SHRUB.dropBelow);
  // And the rim it leaves goes DOWN TO THE SOIL. Left where the cut
  // falls it hangs 0.1-0.2 of the height above the ground, and a plant
  // with daylight under its skirt is the floating look the buildings
  // had before CITY_GROUND_Y. Pinned, the lowest ring of faces becomes
  // a near-vertical skirt, which is what a clipped shrub's foot is.
  const cp = cut.getAttribute("position") as THREE.BufferAttribute;
  for (const v of openEdgeVertices(cut)) cp.setY(v, 0);
  // A face with all three corners on the rim is now flat on the soil,
  // facing straight down: the underside again, one face at a time.
  const g2 = keepFaces(cut, (a, b, c) => !(cp.getY(a) === 0 && cp.getY(b) === 0 && cp.getY(c) === 0));
  toUnitFrame(g2, true);
  g2.computeVertexNormals();
  spherize(g2, SHRUB.spherizeY, SHRUB.spherize);
  return g2;
}

/** A clipped hedge segment: a rounded, battered box, lightly noised. */
function hedgeShape(spec: HedgeSpec, seed: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.BoxGeometry(1, 1, 1, 8, 4, 3);
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g = mergeVertices(g);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const [rx, ry, rz] = spec.round;
  const v = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Rounded-box projection. The top edges and the vertical ones are
    // clipped round; the foot is not — a hedge stands square on its bed.
    c.set(
      THREE.MathUtils.clamp(v.x, -(0.5 - rx), 0.5 - rx),
      THREE.MathUtils.clamp(v.y, -0.5, 0.5 - ry),
      THREE.MathUtils.clamp(v.z, -(0.5 - rz), 0.5 - rz)
    );
    d.subVectors(v, c);
    if (d.lengthSq() > 1e-12) {
      d.set(d.x / rx, d.y / ry, d.z / rz).normalize();
      v.set(c.x + d.x * rx, c.y + d.y * ry, c.z + d.z * rz);
    }
    v.y += 0.5;
    v.z *= 1 + spec.batter * (1 - v.y);
    // Noise along the direction out of the hedge's heart; none on the
    // foot ring, which stays on the bed.
    if (v.y > 0.02) {
      d.set(v.x, v.y - 0.4, v.z).normalize();
      const k =
        spec.noise[0] * vnoise3(3 * v.x, 3 * v.y, 3 * v.z, seed) +
        spec.noise[1] * vnoise3(9 * v.x, 9 * v.y, 9 * v.z, seed + 1);
      v.addScaledVector(d, k);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const p = pos;
  const cut = keepFaces(g, (a, b, c2) => !(p.getY(a) < 1e-6 && p.getY(b) < 1e-6 && p.getY(c2) < 1e-6));
  toUnitFrame(cut, false);
  cut.computeVertexNormals();
  spherize(cut, SHRUB.hedgeSpherizeY, SHRUB.hedgeSpherize);
  return cut;
}

/**
 * Bake the light and the species into vertex colour.
 *
 * `t` is how exposed a point of the mass is: high and far out is the
 * crown, low and in is the core. For a hedge "far out" is the depth
 * across the bed, not the distance from the middle — measured along
 * the hedge it would repeat a bright-ends, dark-middle band every 2.7 m
 * down the whole run.
 *
 * Then the whole shape is scaled so that its area-weighted canopy
 * luminance equals the albedo's: the plant gains a core and a crown
 * without the verge as a whole getting any brighter or darker.
 */
export function bakeShrubColors(g: THREE.BufferGeometry, kind: ShrubKind, seed: number, flowers = true): void {
  const spec = SHRUB.kinds[kind] as KindSpec;
  const A = SHRUB.ao;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const n = pos.count;
  g.computeBoundingBox();
  const top = g.boundingBox!.max.y;
  let rMax = 1e-6;
  const outward = (i: number) => (kind === "hedge" ? Math.abs(pos.getZ(i)) : Math.hypot(pos.getX(i), pos.getZ(i)));
  for (let i = 0; i < n; i++) rMax = Math.max(rMax, outward(i));
  const col = new Float32Array(n * 3);
  const flower = new Uint8Array(n);
  const [ar, ag, ab] = spec.albedo;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = A.height * (y / top) + (1 - A.height) * (outward(i) / rMax);
    const ao = A.interior + (1 - A.interior) * smoothstep(0, A.knee, t);
    const tip = smoothstep(0.7, 1, t);
    const yc = y / top;
    const contact = yc < A.contactY ? A.contact + (1 - A.contact) * (yc / A.contactY) : 1;
    const speck = 1 + SHRUB.speckle * vnoise3(14 * x, 14 * y, 14 * z, seed + 2);
    let r = ar * ao * (1 + (A.tipTint[0] - 1) * tip) * contact * speck;
    let gg = ag * ao * (1 + (A.tipTint[1] - 1) * tip) * contact * speck;
    let b = ab * ao * (1 + (A.tipTint[2] - 1) * tip) * contact * speck;
    r *= 1 + SHRUB.redJitter * vnoise3(5 * x + 17, 5 * y + 17, 5 * z + 17, seed + 3);
    const F = SHRUB.flowers;
    if (flowers && spec.flower && yc > F.above && vnoise3(F.freq * x, F.freq * y, F.freq * z, seed + 5) > F.cut) {
      flower[i] = 1;
      r = spec.flower[0] * speck * ao;
      gg = spec.flower[1] * speck * ao;
      b = spec.flower[2] * speck * ao;
    }
    col[i * 3] = r;
    col[i * 3 + 1] = gg;
    col[i * 3 + 2] = b;
  }
  // Exposure-neutral: the canopy (faces not turned to the soil) averages
  // to the albedo's luminance, weighted by area.
  const mean = canopyMeanY(g, col);
  const k = lumaY(ar, ag, ab) / mean;
  for (let i = 0; i < col.length; i++) col[i] *= k;
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.userData.flower = flower;
}

/**
 * Area-weighted mean luminance over the faces whose normal is not
 * turned down past n.y = −0.2 — the canopy a camera above the verge
 * can see. Exported for the test, which holds the result to a range.
 */
export function canopyMeanY(g: THREE.BufferGeometry, col?: Float32Array): number {
  const c = col ?? ((g.getAttribute("color") as THREE.BufferAttribute).array as Float32Array);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const idx = g.index!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  let sum = 0, area = 0;
  for (let f = 0; f < idx.count; f += 3) {
    const i0 = idx.getX(f), i1 = idx.getX(f + 1), i2 = idx.getX(f + 2);
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    d.fromBufferAttribute(pos, i2);
    e1.subVectors(b, a);
    e2.subVectors(d, a);
    e1.cross(e2);
    const ar = e1.length() / 2;
    if (ar < 1e-12 || e1.y / (2 * ar) < -0.2) continue;
    let y = 0;
    for (const i of [i0, i1, i2]) y += lumaY(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]);
    sum += (y / 3) * ar;
    area += ar;
  }
  return sum / area;
}

/**
 * One shape, indexed, smooth-shaded, with its bend weight and its baked
 * colour, in the unit frame (top y = 1, footprint within ±0.5).
 *
 * `seed` picks the noise; the same (kind, seed) always gives the same
 * bit-identical mesh.
 */
export function shrubGeometry(kind: ShrubKind, seed: number): THREE.BufferGeometry {
  const g =
    kind === "hedge"
      ? hedgeShape(SHRUB.kinds.hedge, seed)
      : moundShape(SHRUB.kinds[kind] as MoundSpec, seed);
  // The bend weight, by height, from plants.ts — the same bake the
  // spring test covers, where world.ts used to carry its own copy.
  bakeBendWeight(g, "height");
  bakeShrubColors(g, kind, seed);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------ leaf tile

/**
 * The leaf-scale detail: a 256² tileable multiplier, 0.6 m to the tile.
 *
 * Seven metres from the driver's camera a smooth one-to-two-metre mass
 * reads as moulded plastic topiary, whatever its outline; real verge
 * planting is 3-6 cm leaves with dark gaps between them. This is those
 * leaves: 1,100 overlapping ellipses on a dark gap, later ones lighter
 * (they sit on top), each a little warmer or cooler, with a darker tip.
 *
 * A DataTexture built from typed arrays rather than a canvas, so node
 * can build it and tests/shrubs.mjs can measure it. Normalised so every
 * channel averages exactly 1: the mip chain then averages to 1 as well,
 * and a canopy a kilometre away keeps the exposure the bake gave it.
 * Stored as value/2 (1.0 → 127.5 of 255); the shader multiplies by 2.
 */
export const LEAF_TILE = {
  px: 256,
  /** Metres per tile repeat: 2.3 mm a texel, leaves of 3-6 cm. */
  metres: 0.6,
  leaves: 1100,
  /** The gap between leaves, as a multiplier (it is the shadowed
   *  inside of the bush, not black). */
  gap: [0.42, 0.46, 0.4] as Rgb,
};

export function leafDetailData(): Uint8Array {
  const N = LEAF_TILE.px;
  const rng = makeRng((WORLD_SEED ^ 0x4c454146) >>> 0); // "LEAF"
  const ch = [new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N)];
  for (let c = 0; c < 3; c++) ch[c].fill(LEAF_TILE.gap[c]);
  const M = LEAF_TILE.leaves;
  for (let k = 0; k < M; k++) {
    const cx = rng() * N, cy = rng() * N;
    const a = 7 + rng() * 5, b = 2.5 + rng() * 2;
    const th = rng() * Math.PI;
    const bright = 0.62 + (0.55 * k) / M + (rng() - 0.5) * 0.2;
    const tilt = rng() * 2 - 1;
    const ct = Math.cos(th), st = Math.sin(th);
    const R = Math.ceil(a) + 1;
    const x0 = Math.floor(cx), y0 = Math.floor(cy);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const ox = x0 + dx + 0.5 - cx, oy = y0 + dy + 0.5 - cy;
        const u = (ox * ct + oy * st) / a;
        const v = (-ox * st + oy * ct) / b;
        const e2 = u * u + v * v;
        if (e2 > 1) continue;
        const shade = bright * (0.86 + 0.14 * (1 - Math.sqrt(e2))) * (1 - 0.12 * Math.max(0, u));
        // Wrapped, so the tile repeats without a seam.
        const px = (((x0 + dx) % N) + N) % N, py = (((y0 + dy) % N) + N) % N;
        const i = py * N + px;
        ch[0][i] = shade * (1 + 0.08 * tilt);
        ch[1][i] = shade;
        ch[2][i] = shade * (1 - 0.04 * tilt);
      }
    }
  }
  const out = new Uint8Array(N * N * 4);
  for (let c = 0; c < 3; c++) {
    let sum = 0;
    for (let i = 0; i < N * N; i++) sum += ch[c][i];
    const k = (N * N) / sum;
    for (let i = 0; i < N * N; i++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(ch[c][i] * k * 127.5)));
  }
  for (let i = 0; i < N * N; i++) out[i * 4 + 3] = 255;
  return out;
}

function replaceOnce(src: string, anchor: string, by: string): string {
  const at = src.indexOf(anchor);
  if (at < 0 || src.indexOf(anchor, at + anchor.length) >= 0) {
    throw new Error(`shrub leaf patch: anchor "${anchor}" is not in the shader exactly once`);
  }
  return src.slice(0, at) + by + src.slice(at + anchor.length);
}

/**
 * The leaf tile, as a vertex-shader patch: hand the fragment the
 * position in INSTANCE METRES and the object normal.
 *
 * Read off `position`, the attribute, so it is the pre-bend surface: a
 * leaf texture that slid across the plant as it leaned would read as
 * the texture moving, not the plant. Metres, from the instance's own
 * scale, so a 3 m hedge segment and a 1 m ball carry leaves of one size.
 *
 * A pure string transform, and it THROWS if an anchor is missing — a
 * three update that renames a chunk should fail the build, not ship
 * shrubs that silently lost their leaves.
 */
export function patchLeafVertex(vs: string): string {
  vs = replaceOnce(vs, "#include <common>", "#include <common>\nvarying vec3 vGrnLeafP;\nvarying vec3 vGrnLeafN;");
  return replaceOnce(
    vs,
    "#include <begin_vertex>",
    `#include <begin_vertex>
    vGrnLeafP = position;
    vGrnLeafN = normal;
    #ifdef USE_INSTANCING
      vGrnLeafP *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
    #endif`
  );
}

/**
 * And the fragment half: three taps of the tile, projected on whichever
 * axis the surface faces (triplanar, weights sharpened by a 4th power),
 * multiplied into the diffuse colour after the vertex colour.
 *
 * Unguarded, deliberately: three defines USE_INSTANCING for the VERTEX
 * stage only (WebGLProgram.js, the fragment prefix has no such line), so
 * a fragment block behind that #ifdef would compile and never run. This
 * material only ever draws the planting, and the vertex half writes the
 * varyings on both paths.
 */
export function patchLeafFragment(fs: string): string {
  fs = replaceOnce(
    fs,
    "#include <common>",
    "#include <common>\nuniform sampler2D grnLeafMap;\nvarying vec3 vGrnLeafP;\nvarying vec3 vGrnLeafN;"
  );
  return replaceOnce(
    fs,
    "#include <color_fragment>",
    `#include <color_fragment>
    {
      vec3 grnBw = pow(abs(normalize(vGrnLeafN)), vec3(4.0));
      grnBw /= grnBw.x + grnBw.y + grnBw.z;
      vec3 grnLp = vGrnLeafP * ${(1 / LEAF_TILE.metres).toFixed(4)};
      vec3 grnLeaf = texture2D(grnLeafMap, grnLp.zy).rgb * grnBw.x
                   + texture2D(grnLeafMap, grnLp.xz).rgb * grnBw.y
                   + texture2D(grnLeafMap, grnLp.xy).rgb * grnBw.z;
      diffuseColor.rgb *= grnLeaf * 2.0;
    }`
  );
}

// --------------------------------------------------------- shared stream

/**
 * Advance the world's shared stream exactly as far as the legacy verge
 * block did, and say how far that was.
 *
 * WHY. The stream's order IS the city (rand.ts): after the verge,
 * concreteTexture() and tunnelWallTexture() for the underpass, the side
 * every billboard stands on, and the flyover concrete all draw from it.
 * Move the verge off the stream without putting the draws back and every
 * one of those shifts, with no visible error — the billboards simply
 * stand on other sides of the road, and every ik still before the change
 * stops lining up with every still after it.
 *
 * WHY A REPLAY AND NOT A NUMBER. The legacy block took 1,440 draws for
 * its three shapes and then a placement loop whose LENGTH depends on the
 * values it drew: a slot is skipped when its first draw is under 0.28,
 * and a kept slot takes a second draw for its position and a third only
 * if that position clears the tunnel and the seam. Then eight per plant
 * (yaw, height, width, depth, three for the tint, and the phase). The
 * total was measured at 17,446 to 17,695 depending on the stream state
 * on entry — so a hard-coded count is right for exactly one upstream
 * city, and the first change upstream of here would break it silently.
 * Replaying the loop's own tests makes it right for every one.
 *
 * The constants below are the legacy block's, frozen: they describe
 * consumption that has to be reproduced, not planting that exists.
 * tests/shrubs.mjs holds this against a verbatim copy of the old loop.
 */
export function burnLegacyVergeDraws(
  draw: () => number,
  L: number,
  tunnel: { from: number; to: number },
  coastEnd: number
): number {
  let n = 0;
  const d = (): number => {
    n++;
    return draw();
  };
  // mound() × 3: IcosahedronGeometry(0.5, 1) is non-indexed, 80 faces ×
  // 3 = 240 vertices, and each took two draws (the xz and y factors).
  for (let i = 0; i < 3 * 240 * 2; i++) d();
  const SPACING = 7, SEAM = 40;
  let spots = 0;
  for (let step = 0; step < L; step += SPACING) {
    for (const side of [1, -1]) {
      if (d() < 0.28) continue;
      const at = step + d() * SPACING * 0.6;
      if (at > tunnel.from - 20 && at < tunnel.to + 20) continue;
      if (side < 0 && (at < coastEnd + SEAM || at > L - SEAM)) continue;
      d(); // the lateral
      spots++;
    }
  }
  // Per plant: yaw, height, width, depth, tint × 3, and then — in a
  // second pass, but the stream does not care — its phase.
  for (let i = 0; i < spots * 8; i++) d();
  return n;
}

// ---------------------------------------------------------------- layout

/** Something already standing on the verge: a beds keep `r` + a pad
 *  clear of it, along the road and across it. */
export interface VergeAvoid {
  s: number;
  lat: number;
  r: number;
}

export interface VergeOptions {
  track: Track;
  L: number;
  tunnel: { from: number; to: number };
  coastEnd: number;
  /** End of the coastal leg as a lap fraction (COAST_U.to): cross
   *  streets on the coast run inland only. */
  coastU: number;
  /** Spacing of the cross streets (an exact division of the lap). */
  blockLen: number;
  streetHalf: number;
  /** world.ts onForecourt, bound to the track: (s, half, lo, hi). */
  onForecourt: (s: number, half: number, lo: number, hi: number) => boolean;
  avoid: readonly VergeAvoid[];
  rng: Rng;
}

export interface ShrubPlacement {
  kind: ShrubKind;
  side: 1 | -1;
  /** Which bed it belongs to: a run of one kind, broken wherever
   *  something had to be stepped round. */
  bed: number;
  s: number;
  lat: number;
  x: number;
  z: number;
  yaw: number;
  /** Instance scale on the unit shape: length along its own x, height,
   *  depth along its own z — metres. */
  sx: number;
  sy: number;
  sz: number;
  /** Footprint along the road and across it, metres. */
  len: number;
  depth: number;
  tint: [number, number, number];
  phase: number;
  /** Lean at full strength, metres, and the per-axis factors that turn
   *  the solver's unit lean into it on this instance's own scale. */
  gain: number;
  gx: number;
  gz: number;
}

/**
 * Lay out both verges as beds: clipped hedges, rows of balls, loose
 * flowering mounds — runs of one planting with sand between them, the
 * way the irrigated verges on Gulf Road and the ring actually are.
 *
 * Its own generator ("SHRB"), so the layout can change without moving
 * a single building. Everything that stands on the verge is stepped
 * round — the tunnel, the seaward seams, the cross-street mouths, the
 * forecourts and whatever `avoid` lists — and a rejection closes the
 * bed: it resumes past the obstacle rather than shifting along it.
 */
export function layoutVerge(o: VergeOptions): ShrubPlacement[] {
  const { track, L, rng } = o;
  const B = SHRUB.bed;
  const U = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const p = new THREE.Vector3(), q = new THREE.Vector3(), tmp = new THREE.Vector3();
  const out: ShrubPlacement[] = [];

  const crossCount = Math.round(L / o.blockLen);
  const onCoast = (s: number) => {
    const u = track.wrap(s) / L;
    return u >= 0 && u <= o.coastU;
  };
  /** Is a span of half-length `half` at `s`, on `side`, clear of every
   *  rule? Tested at both ends and the middle for the windows. */
  const clear = (s: number, half: number, side: number, lat: number, halfDepth: number): boolean => {
    for (const t of [s - half, s, s + half]) {
      if (t > o.tunnel.from - B.tunnelPad && t < o.tunnel.to + B.tunnelPad) return false;
      if (side < 0 && (t < o.coastEnd + B.seam || t > L - B.seam)) return false;
    }
    // The cross-street mouths. Lines of constant s, so the mouth is
    // ±streetHalf along the road at any lateral.
    const k0 = Math.round(s / o.blockLen);
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const c = (((k % crossCount) + crossCount) % crossCount) * o.blockLen;
      if (side < 0 && onCoast(c)) continue; // no seaward street on the coast
      if (Math.abs(track.deltaAhead(c, s)) < o.streetHalf + B.streetClear + half) return false;
    }
    const a = Math.abs(lat);
    if (side > 0 && o.onForecourt(s, half, a - halfDepth, a + halfDepth)) return false;
    for (const v of o.avoid) {
      if (
        Math.abs(track.deltaAhead(v.s, s)) < half + v.r + B.avoidPad &&
        Math.abs(lat - v.lat) < halfDepth + v.r + B.avoidPad
      ) return false;
    }
    return true;
  };

  const kinds = SHRUB_KINDS;
  const pickKind = (): ShrubKind => {
    let x = rng();
    for (const k of kinds) {
      x -= SHRUB.kinds[k].weight;
      if (x < 0) return k;
    }
    return kinds[0];
  };

  let bed = 0;
  for (const side of [1, -1] as const) {
    let s = rng() * B.start;
    while (s < L) {
      const runEnd = s + U(B.run[0], B.run[1]);
      const kind = pickKind();
      const spec = SHRUB.kinds[kind];
      const tv = U(B.tintV[0], B.tintV[1]), tk = U(-1, 1);
      const tint: [number, number, number] = [tv * (1 + 0.04 * tk), tv, tv * (1 - 0.06 * tk)];
      const phase0 = rng() * Math.PI * 2;
      bed++;
      let open = false; // has this bed placed anything yet
      let index = 0;
      if (kind === "hedge") {
        const H = SHRUB.kinds.hedge;
        const height = U(H.height[0], H.height[1]);
        const D = U(H.depth[0], H.depth[1]);
        const off = B.front + D / 2;
        let c = s + H.len / 2;
        while (c + H.len / 2 <= runEnd && c + H.len / 2 < L) {
          const segH = height * U(0.99, 1.01);
          const hw = track.halfWidthAt(c);
          const lat = side * (hw + off);
          // Following the OFFSET CURVE, not the road: where the tarmac
          // swells for a forecourt or the plaza, the bed swings out with
          // it, up to 31.7° off the road heading on the steepest ramp.
          track.pose(c - 0.5, side * (track.halfWidthAt(c - 0.5) + off), p, tmp);
          track.pose(c + 0.5, side * (track.halfWidthAt(c + 0.5) + off), q, tmp);
          const dX = q.x - p.x, dZ = q.z - p.z;
          const stretch = Math.hypot(dX, dZ);
          if (clear(c, H.len / 2, side, lat, D / 2)) {
            if (!open) open = true;
            track.pose(c, lat, p, tmp);
            const gain = spec.bendGain * segH;
            out.push({
              kind, side, bed, s: c, lat, x: p.x, z: p.z,
              yaw: Math.atan2(-dZ, dX),
              sx: H.len, sy: segH, sz: D, len: H.len, depth: D,
              tint,
              // One phase marching down the run, so the wind's sway
              // travels along the hedge instead of tearing the 0.3 m
              // overlaps apart segment by segment.
              phase: phase0 + 0.35 * index,
              gain, gx: gain / H.len, gz: gain / D,
            });
          } else if (open) {
            bed++;
            open = false;
          }
          index++;
          // The pitch is measured ALONG THE OFFSET CURVE. In s it would
          // open the joints exactly where the hedge is longest: 2.7 m of
          // s on a forecourt ramp is 3.0 m of hedge line, and on the
          // outside of the Ras Al-Ard bend 2.85 m.
          c += H.pitch / stretch;
        }
      } else {
        const M = spec as MoundSpec;
        let c = s;
        let first = true;
        while (true) {
          const dia = U(M.dia[0], M.dia[1]);
          const pitch = U(M.pitch[0], M.pitch[1]);
          if (first) {
            c += dia / 2;
            first = false;
          }
          if (c + dia / 2 > runEnd || c + dia / 2 >= L) break;
          const h = M.hOverDia * dia;
          const jit = rng() * M.jitter;
          const oval = U(0.88, 1);
          const yaw = rng() * Math.PI * 2;
          const phase = rng() * Math.PI * 2;
          const hw = track.halfWidthAt(c);
          const lat = side * (hw + B.front + jit + dia / 2);
          if (clear(c, dia / 2, side, lat, dia / 2)) {
            if (!open) open = true;
            track.pose(c, lat, p, tmp);
            const gain = spec.bendGain * h;
            out.push({
              kind, side, bed, s: c, lat, x: p.x, z: p.z, yaw,
              sx: dia, sy: h, sz: dia * oval, len: dia, depth: dia,
              tint, phase, gain, gx: gain / dia, gz: gain / (dia * oval),
            });
          } else if (open) {
            bed++;
            open = false;
          }
          index++;
          c += pitch;
        }
      }
      s = runEnd + U(B.gap[0], B.gap[1]);
    }
  }
  return out;
}

/** Triangles in a shape, for the budgets. */
export const triCount = (g: THREE.BufferGeometry): number =>
  (g.index ? g.index.count : g.getAttribute("position").count) / 3;
