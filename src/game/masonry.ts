/**
 * Masonry for the city's walls: buff brick, ochre limestone, white render
 * and formed concrete, as one tiling albedo and one normal map per kind.
 *
 * WHY THIS EXISTS
 *
 * Until this, a city wall was a flat fill. windowTextures() paints the
 * facade's wall as one colour, #5f646b, with a darker band per floor;
 * there is no material in it at all. Measured on the ik stills at 4K:
 *
 *   driver.png (16 h, blocks ~155 m off)   wall patches luma 64-78, std
 *       1.2-1.7, mean |Laplacian| 3.9 — the SAME as the sky's, so the
 *       only "detail" on a wall was post-process grain. Blue/red 1.45-
 *       1.64: slate blue under a Kuwaiti 4 pm sun.
 *   brake.png (night, drum ~140 m off)     walls luma 37-39 against a sky
 *       of 41: the silhouette margin is already only 2-4 levels.
 *
 * The effective wall albedo was about 0.033 linear (#5f646b's 0.126
 * luminance times the facade palette's 0.259): fresh asphalt. Buff
 * brick is about 0.33, limestone 0.48, white render 0.68. A Gulf city is
 * those four materials — the concrete frame, the brick or stone infill,
 * the rendered villa — and it read as one dark grey.
 *
 * WHAT IT IS
 *
 * Four layers of one 384 x 384 tile, 1.8 m on a side, built here as
 * plain typed arrays so a test can measure every joint without a browser
 * (tests/masonry.mjs). world.ts uploads them as two DataArrayTextures and
 * the facade shader (facadeSkin.ts) picks a layer per building.
 *
 *   albedo  sRGB colour; A = the trim's own detail (floor bands and
 *           window surrounds, the concrete frame), mean 0.5.
 *   normal  tangent space, +Y up the wall (three.js's convention);
 *           A = roughness in roughness-map units (0xda = the old wall).
 *
 * THE TEXEL IS CHOSEN SO THE MIPS ARE EXACT
 *
 * 75/16 mm a texel: a brick course (65 mm brick + 10 mm bed joint) is
 * exactly 16 texels and a brick module (215 + 10 mm) exactly 48. The GPU
 * builds mips by 2x2 box averages, so at mip 4 one texel is one whole
 * course and every bed joint averages away exactly — nothing left over to
 * alias into a beat. The first cut was 512 texels over the same 1.8 m:
 * 21.33 texels a course, and about 30% of the joint pattern survived
 * aliased into mip 4 (sinc(16/21.33) = 0.30). Every module of every
 * family is a whole number of texels: stone 192 x 96, formwork 192 x 128.
 *
 * Density: 384 / 1.8 = 213 texels a metre. A block may stand 12 m off
 * the carriageway, where a 4K frame at the chase camera's 52 degree fov
 * spends 1080 / tan(26) / 12 = 184 px a metre: 1.16 texels a pixel. The
 * window maps manage 26 a metre there — every facade texel a 7 px
 * square. A joint is 2.13 texels, coverage-antialiased.
 *
 * ITS OWN RANDOM STREAM
 *
 * The world's shared stream (rand.ts) IS the city: one draw added
 * anywhere moves every building placed after it, and tests/world.mjs
 * holds the count to 258,930. Nothing here draws from it. The generator
 * runs its own mulberry32 seeded from WORLD_SEED ^ "MASO", the same
 * pattern sandSurface uses ("SAND"), and the per-building choice below
 * is a hash of the building's index, not a draw.
 *
 * Pure: typed arrays only. No DOM, no three.js, no `enum` (Node's
 * strip-types cannot run one), so the test imports it as it ships.
 */
import { makeRng, WORLD_SEED, type Rng } from "./rand";

/** Texels on a side of one tile. */
export const MASONRY_N = 384;
/** Millimetres a texel: a brick course is exactly 16 of them. */
export const MASONRY_TEXEL_MM = 75 / 16;
/** One tile, metres: 1.8. */
export const MASONRY_TILE_M = (MASONRY_N * MASONRY_TEXEL_MM) / 1000;
/** Layers in each array texture, one per family. */
export const MASONRY_LAYERS = 4;

/** The four wall families. A plain object, not an enum: see the header. */
export const FAMILY = { brick: 0, stone: 1, render: 2, formwork: 3 } as const;
export type Family = (typeof FAMILY)[keyof typeof FAMILY];

type RGB = readonly [number, number, number];

export interface ModuleSpec {
  /** Module (unit plus one joint) width and height, mm. */
  w: number;
  h: number;
  /** Joint width, mm. */
  joint: number;
  /** How far the joint sits behind the face, mm. Negative stands proud:
   *  formwork's panel joint is a fin, not a groove. */
  recess: number;
  /** Fraction of a module that alternate courses are shifted by. */
  bond: 0 | 0.5;
}

export interface FamilySpec {
  name: string;
  module: null | ModuleSpec;
  /** The layer's mean colour, sRGB 0-255. The generated albedo is
   *  normalised so its LINEAR mean is exactly this. */
  mean: RGB;
  /** The joint's colour, sRGB 0-255, where there are joints. */
  joint?: RGB;
  /** The trim — floor bands and window surrounds — on a building of this
   *  family, sRGB 0-255. */
  trim: RGB;
  /** Per-building tint range, linear multipliers mixed by the building's
   *  seed. Each pair averages to about 1, so the mean albedo holds. */
  tintA: RGB;
  tintB: RGB;
  /** Roughness in roughness-map units (0xda = the old wall's 0.8). */
  rough: { face: number; joint: number };
  /** Per-module tone jitter the SHADER adds, +/- this fraction, hashed
   *  from the building's seed so two buildings never share a pattern. */
  jitter: number;
  /** Multiplier on the normal map's xy in the shader. The map is authored
   *  in true millimetres, so 1 is the real relief. */
  normalScale: number;
}

/**
 * The families.
 *
 * Module sizes are the real ones: a UK/Gulf metric brick is 215 x 102.5
 * x 65 mm on a 10 mm joint; a sawn limestone ashlar block on the Gulf's
 * villa bases runs 900 x 450 on a 6 mm joint; formwork ply is cut to
 * 900 x 600 panels. Each divides the 1.8 m tile a whole number of times,
 * and the half-bond families have an EVEN number of courses per tile, so
 * the alternating offset carries across the tile's repeat without a seam.
 */
export const FAMILIES: readonly FamilySpec[] = [
  {
    name: "buff brick",
    module: { w: 225, h: 75, joint: 10, recess: 5, bond: 0.5 },
    mean: [182, 150, 110],
    joint: [196, 188, 172],
    // The frame of a Kuwaiti brick-infill block is in-situ concrete.
    trim: [178, 172, 160],
    tintA: [1.1, 1.02, 0.92],
    tintB: [0.92, 0.98, 1.06],
    rough: { face: 0xda, joint: 0xf2 },
    jitter: 0.07,
    normalScale: 1,
  },
  {
    name: "ochre limestone",
    module: { w: 900, h: 450, joint: 6, recess: 3, bond: 0.5 },
    mean: [206, 184, 144],
    joint: [192, 184, 168],
    trim: [190, 168, 130],
    tintA: [1.06, 1.01, 0.92],
    tintB: [0.95, 0.99, 1.06],
    rough: { face: 0xc4, joint: 0xe6 },
    jitter: 0.05,
    normalScale: 1,
  },
  {
    name: "white render",
    module: null,
    mean: [222, 216, 202],
    trim: [222, 216, 202],
    tintA: [1.02, 1.0, 0.95],
    tintB: [0.97, 0.99, 1.04],
    rough: { face: 0xe6, joint: 0xe6 },
    jitter: 0,
    normalScale: 1,
  },
  {
    name: "formed concrete",
    // The "joint" is the fin of cement paste squeezed out between two
    // panels: 2 mm wide, standing 0.6 mm proud.
    module: { w: 900, h: 600, joint: 2, recess: -0.6, bond: 0 },
    mean: [152, 149, 141],
    joint: [140, 137, 130],
    trim: [162, 159, 151],
    tintA: [1.05, 1.04, 1.0],
    tintB: [0.94, 0.95, 0.98],
    rough: { face: 0xd8, joint: 0xd8 },
    jitter: 0.06,
    normalScale: 1,
  },
];

/**
 * Modules across and up one tile, and the bond, per family. The shader
 * reads the same table (grnModule) to find which module a pixel is in, so
 * its per-module tone jitter lands on whole bricks. Render has no module;
 * one cell per tile and no jitter.
 */
export const MODULES_PER_TILE = [
  [8, 24, 0.5],
  [2, 4, 0.5],
  [1, 1, 0],
  [2, 3, 0],
] as const;

/**
 * How bright a wall is drawn, as a fraction of its real albedo.
 *
 * The families above are real materials at real albedos, and the city is
 * not exposed for real albedos: its walls were 0.033, set that dark on
 * purpose so the skyline stays a silhouette against the night sky (the
 * rule recorded in windowTextures: buildings median 21/255, sky 37, road
 * 12). 0.10 puts the mean masonry wall at about 0.045 luminance — a
 * touch above where the city was, not three times it. It is a uniform
 * (grnGain), so tools/shots/levels.mjs --facade-gain sweeps it without a
 * recompile; the shipped value is the largest that keeps the 22.5 h
 * silhouette and the building crush bar.
 */
export const FACADE_ALBEDO_GAIN = 0.1;

/** The old wall fill. windowTextures paints it, and the shader divides by
 *  its luminance to recover the floor-band shadow and the lighter window
 *  surrounds as a ratio. */
export const FACADE_WALL_HEX = 0x5f646b;

/** Below this height a rendered building stands on the limestone layer:
 *  the stone plinth every rendered villa and shop in Kuwait has. Snapped
 *  in the shader to the stone course line nearest it. */
export const GROUND_STOREY_M = 3.4;

/** Course height of the stone layer, metres (the plinth snaps to it). */
export const STONE_COURSE_M = MASONRY_TILE_M / MODULES_PER_TILE[FAMILY.stone][1];

/**
 * Perimeter of a regular octagon over its circumscribed diameter.
 *
 * The drums are CylinderGeometry(0.5, 0.5, 1, 8): side u runs 0..1 round
 * the whole perimeter, and the facade shader scales u by the instance's
 * DIAMETER. The perimeter is 8 sin(pi/8) = 3.06 diameters, so every drum
 * wore its facade stretched 3.06x sideways: lit windows measured 128 x 40
 * px (3.2:1) on brake.png, painted at 1.83 x 1.66 m (1.1:1), and a texel
 * 11.7 cm wide. Multiplying the side u by this makes u metres-per-
 * diameter like every other face.
 */
export const OCT_PERIMETER = 8 * Math.sin(Math.PI / 8);

/** At or above this architectural height a block counts as tall. */
export const MASONRY_TALL_M = 40;

/**
 * Who wears what, as weights in FAMILY order [brick, stone, render,
 * formwork].
 *
 * Low-rise Kuwait is brick infill and rendered villas; the towers are
 * stone-clad or fair-faced concrete; the drums (Salmiya's round-cornered
 * residential slabs) are rendered or stone, never brick — a coursed
 * brick drum at this module would be a tell nobody builds.
 */
export const MASONRY_WEIGHTS = {
  low: [0.4, 0.15, 0.3, 0.15],
  tall: [0.1, 0.4, 0.3, 0.2],
  drum: [0, 0.45, 0.55, 0],
} as const;

// ------------------------------------------------------------- colour

/** sRGB 0-255 to linear 0-1. */
export function srgbToLinear(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** A 0xRRGGBB colour as linear [r, g, b]. */
export function hexToLinear(hex: number): [number, number, number] {
  return [srgbToLinear((hex >> 16) & 255), srgbToLinear((hex >> 8) & 255), srgbToLinear(hex & 255)];
}

/** Rec. 709 luminance of a linear colour. */
export function luminance(c: readonly [number, number, number]): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** The old wall's luminance, linear: 0.126. */
export const FACADE_WALL_LUMA = luminance(hexToLinear(FACADE_WALL_HEX));

/** Linear 0-1 to 8-bit sRGB, through a 4096-entry table: a pow per texel
 *  per channel is most of a generator's time otherwise. */
let LUT: Uint8Array | null = null;
function encodeSrgb(v: number): number {
  if (!LUT) {
    LUT = new Uint8Array(4096);
    for (let i = 0; i < 4096; i++) {
      const l = i / 4095;
      const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
      LUT[i] = Math.round(s * 255);
    }
  }
  return LUT[Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 4095)];
}

// ---------------------------------------------------------- selection

/** lowbias32: a 32-bit integer hash with no visible structure. */
function lowbias32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** A hash of an index into [0, 1). Salted, so the family and the seed of
 *  one building are independent; keyed on WORLD_SEED, so a different
 *  world is a differently dressed one. */
export function masonryHash(i: number, salt: number): number {
  return lowbias32(lowbias32((i ^ WORLD_SEED) >>> 0) ^ salt) / 4294967296;
}

const SALT_FAMILY = 0x46414d49; // "FAMI"
const SALT_SEED = 0x53454544; // "SEED"

/**
 * Which family a building wears, and its seed.
 *
 * `owner` is the building's identity: cityBlocks' instance index for a
 * block (setbacks and podiums pass their shaft's, so a building is one
 * material top to bottom), 0x10000 + the drum's index for a drum. A hash,
 * never a draw — see the header.
 *
 * The seed is quantised to 1/4096 because the shader hashes
 * floor(seed * 4096) into each module's tone, and a seed that is not
 * exactly representable at that step could land either side of it.
 */
export function masonryFamily(owner: number, heightM: number, drum = false): { family: Family; seed: number } {
  const w = drum ? MASONRY_WEIGHTS.drum : heightM >= MASONRY_TALL_M ? MASONRY_WEIGHTS.tall : MASONRY_WEIGHTS.low;
  const u = masonryHash(owner, SALT_FAMILY);
  let f = 0;
  let acc = w[0];
  while (u >= acc && f < 3) acc += w[++f];
  // A zero-weight family can only be reached by rounding at the top.
  while (w[f] === 0 && f > 0) f--;
  return { family: f as Family, seed: Math.floor(masonryHash(owner, SALT_SEED) * 4096) / 4096 };
}

/**
 * The module a point is in, [col, row], in the tile's own millimetres.
 *
 * col = floor(x / MW + bond * (row & 1)): odd courses are shifted LEFT
 * by half a module. The shader mirrors this exactly (grnCell, using
 * GLSL's mod(row, 2.0), which agrees with JS's `& 1` for negative rows
 * too), so a pixel's jitter belongs to the same brick the texture drew.
 */
export function moduleCell(xMm: number, yMm: number, f: number): [col: number, row: number] {
  const [cols, rows, bond] = MODULES_PER_TILE[f];
  const tile = MASONRY_TILE_M * 1000;
  const row = Math.floor(yMm / (tile / rows));
  return [Math.floor(xMm / (tile / cols) + bond * (row & 1)), row];
}

// -------------------------------------------------------- the generator

export interface MasonryMaps {
  n: number;
  layers: 4;
  /** RGBA8, layer-major: layer f starts at f * n * n * 4. Row 0 is the
   *  BOTTOM of the tile (a DataArrayTexture is not flipped). */
  albedo: Uint8Array;
  normal: Uint8Array;
  /** debug only: each layer's joint coverage, 0-1 per texel. */
  mortar?: Float32Array[];
}

interface Layer {
  /** Linear colour, three per texel. */
  rgb: Float32Array;
  /** Height, mm (0 = the face plane). */
  h: Float32Array;
  /** Joint coverage. */
  joint: Float32Array;
  /** Roughness, map units. */
  rough: Float32Array;
  /** The trim's detail, 0-1, mean 0.5. */
  trim: Float32Array;
}

/**
 * What a face does inside one family, beyond its module. Widths are full
 * spans: a tone of 0.04 is +/-2%.
 */
interface FaceParams {
  /** Width of the rounded arris at a face edge, mm. */
  arris: number;
  /** Baked per-module tone spread. Small on purpose: the shader adds the
   *  big per-module jitter, hashed per BUILDING, so the 1.8 m tile's own
   *  tone pattern is not what the eye finds repeating. */
  tone: number;
  /** Per-module red/blue shift. */
  warm: number;
  /** Fraction of modules fired darker ("flashed"), and how much darker. */
  flash: readonly [number, number];
  /** Per-module tilt across the face and plane offset, mm. */
  tilt: number;
  plane: number;
  /** Per-texel grain, albedo fraction and height mm, on face and joint. */
  grainA: number;
  grainH: number;
  jointGrainA: number;
  jointGrainH: number;
}

const FACE: readonly FaceParams[] = [
  // brick: crisp arrises, a little tilt, sandy mortar.
  { arris: 1.5, tone: 0.04, warm: 0.04, flash: [0.03, 0.9], tilt: 0.6, plane: 0.2, grainA: 0.12, grainH: 0.3, jointGrainA: 0.18, jointGrainH: 0.8 },
  // stone: blocks set by hand, so a millimetre of lipping between them.
  { arris: 1.0, tone: 0.08, warm: 0.05, flash: [0, 1], tilt: 1.4, plane: 0.8, grainA: 0.07, grainH: 0.25, jointGrainA: 0.14, jointGrainH: 0.5 },
  // render: a sand-float finish, ~0.8 mm of aggregate texture.
  { arris: 0, tone: 0, warm: 0, flash: [0, 1], tilt: 0, plane: 0, grainA: 0.05, grainH: 0.8, jointGrainA: 0, jointGrainH: 0 },
  // formwork: each ply panel its own pour face, a little out of plane.
  { arris: 0, tone: 0.06, warm: 0.03, flash: [0, 1], tilt: 0.8, plane: 0.6, grainA: 0.06, grainH: 0.12, jointGrainA: 0.1, jointGrainH: 0.2 },
];

/**
 * A tileable field: a sum of sine waves at random WHOLE-NUMBER wave
 * vectors, so it repeats with the tile and has no lattice for the eye to
 * find. Lifted from sandSurface in world.ts, with the wave vector's two
 * components ranged separately so a field can be streaky (stone bedding,
 * ply grain) as well as round. Each wave is split into a column table and
 * a row table — sin(a + b) = sin a cos b + cos a sin b — so a texel costs
 * multiply-adds and no sin. Returns ~[0, 1], mean 0.5.
 */
function waves(r: Rng, N: number, count: number, kx: readonly [number, number], ky: readonly [number, number]): Float32Array {
  const cs: Float32Array[] = [], cc: Float32Array[] = [], rs: Float32Array[] = [], rc: Float32Array[] = [];
  let norm = 0;
  for (let i = 0; i < count; i++) {
    let a = 0, b = 0;
    while (a === 0 && b === 0) {
      a = Math.round(kx[0] + r() * (kx[1] - kx[0]));
      b = Math.round(ky[0] + r() * (ky[1] - ky[0]));
    }
    const ph = r() * Math.PI * 2;
    const amp = 0.6 + r() * 0.4;
    norm += amp;
    const colS = new Float32Array(N), colC = new Float32Array(N);
    const rowS = new Float32Array(N), rowC = new Float32Array(N);
    for (let j = 0; j < N; j++) {
      const ax = (a * j * Math.PI * 2) / N;
      const ay = (b * j * Math.PI * 2) / N + ph;
      colS[j] = Math.sin(ax) * amp;
      colC[j] = Math.cos(ax) * amp;
      rowS[j] = Math.sin(ay);
      rowC[j] = Math.cos(ay);
    }
    cs.push(colS); cc.push(colC); rs.push(rowS); rc.push(rowC);
  }
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const o = y * N;
    for (let w = 0; w < count; w++) {
      const cy = rc[w][y], sy = rs[w][y], a = cs[w], b = cc[w];
      for (let x = 0; x < N; x++) out[o + x] += a[x] * cy + b[x] * sy;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = 0.5 + (0.5 * out[i]) / norm;
  return out;
}

/** Wrap a texel coordinate into the tile. */
const wrapN = (v: number, N: number) => ((v % N) + N) % N;

/**
 * Visit every texel a disc touches, with the tile's wrap, handing over the
 * disc's profile averaged over 4 x 4 points inside the texel — a box
 * filter, so a 2 mm bug hole is a 2 mm hole and not a texel-sized one.
 */
function stampDisc(N: number, T: number, cx: number, cy: number, rad: number, profile: (d: number) => number, apply: (i: number, v: number) => void): void {
  const tx0 = Math.floor((cx - rad) / T), tx1 = Math.floor((cx + rad) / T);
  const ty0 = Math.floor((cy - rad) / T), ty1 = Math.floor((cy + rad) / T);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      let s = 0;
      for (let sy = 0; sy < 4; sy++) {
        const py = (ty + (sy + 0.5) / 4) * T - cy;
        for (let sx = 0; sx < 4; sx++) {
          const px = (tx + (sx + 0.5) / 4) * T - cx;
          const d = Math.sqrt(px * px + py * py);
          if (d < rad) s += profile(d / rad);
        }
      }
      if (s > 0) apply(wrapN(ty, N) * N + wrapN(tx, N), s / 16);
    }
  }
}

/** The same for a straight segment of width `w`: coverage of the texel by
 *  the stroke, from 4 x 4 points. */
function stampSegment(N: number, T: number, ax: number, ay: number, bx: number, by: number, w: number, apply: (i: number, v: number) => void): void {
  const pad = w / 2 + T;
  const tx0 = Math.floor((Math.min(ax, bx) - pad) / T), tx1 = Math.floor((Math.max(ax, bx) + pad) / T);
  const ty0 = Math.floor((Math.min(ay, by) - pad) / T), ty1 = Math.floor((Math.max(ay, by) + pad) / T);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      let s = 0;
      for (let sy = 0; sy < 4; sy++) {
        const py = (ty + (sy + 0.5) / 4) * T;
        for (let sx = 0; sx < 4; sx++) {
          const px = (tx + (sx + 0.5) / 4) * T;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
          const ex = px - (ax + t * dx), ey = py - (ay + t * dy);
          if (ex * ex + ey * ey < (w / 2) * (w / 2)) s++;
        }
      }
      if (s > 0) apply(wrapN(ty, N) * N + wrapN(tx, N), s / 16);
    }
  }
}

/**
 * One family's layer.
 *
 * A module family is built ANALYTICALLY rather than supersampled: a face
 * is an axis-aligned rectangle, so the share of a texel it covers is the
 * product of two interval overlaps, exactly. That is what makes the
 * joint 2.13 texels wide rather than the 2 or 2.5 a 2 x 2 supersample
 * would round it to, and the brick's mortar fraction the analytic 0.1719.
 * Colour and height are box filtered the same way: each face that
 * overlaps a texel contributes its own colour and its own height at the
 * centre of the overlap, weighted by the overlap's area.
 *
 * Features too small or round for that — chipped arrises, fossil pits,
 * tie holes, bug holes, cracks — are stamped afterwards, 4 x 4 sampled.
 */
function buildLayer(f: Family, r: Rng): Layer {
  const N = MASONRY_N, T = MASONRY_TEXEL_MM, NN = N * N;
  const spec = FAMILIES[f];
  const P = FACE[f];
  const L: Layer = {
    rgb: new Float32Array(NN * 3),
    h: new Float32Array(NN),
    joint: new Float32Array(NN),
    rough: new Float32Array(NN),
    trim: new Float32Array(NN),
  };

  // The face's base colour, chosen so the layer's mean lands near its
  // target BEFORE normalisation with the joint at its own colour — the
  // normalisation then only trims, and the mortar stays the mortar.
  const target = spec.mean.map(srgbToLinear);
  const jointLin = (spec.joint ?? spec.mean).map(srgbToLinear);
  const m = spec.module;
  const jf = m ? 1 - ((m.w - m.joint) * (m.h - m.joint)) / (m.w * m.h) : 0;
  const face = target.map((t, c) => Math.max(0.001, (t - jf * jointLin[c]) / (1 - jf)));

  // Broad, tileable fields shared by every family.
  const mottle = waves(r, N, 6, [-4, 4], [-4, 4]);
  const trimField = waves(r, N, 5, [-5, 5], [-5, 5]);
  const roughFace = spec.rough.face, roughJoint = spec.rough.joint;

  /** Roughness and the trim's detail for texel i, from one byte of noise
   *  each. The trim's broad mottle is held to about +/-6% of its tone
   *  (the shader reads 0.8 + 0.4 A): at +/-14% a floor band repeating
   *  every 1.8 m read as the same stain stamped along it. */
  const finish = (i: number, jc: number, rn: number, tn: number) => {
    L.rough[i] = roughFace * (1 - jc) + roughJoint * jc + rn * 8;
    const t = 0.5 + (trimField[i] - 0.5) * 0.3 + tn * 0.12;
    L.trim[i] = t < 0 ? 0 : t > 1 ? 1 : t;
  };

  if (m) {
    const [cols, rows, bond] = MODULES_PER_TILE[f];
    const cells = cols * rows;
    const MW = m.w, MH = m.h, J = m.joint, FW = MW - J, FH = MH - J;
    // Per module: colour multipliers, tilt, plane offset, and for
    // formwork a shift into the ply-grain field (each panel its own ply).
    const tone = new Float32Array(cells * 3);
    const tiltX = new Float32Array(cells), tiltY = new Float32Array(cells), plane = new Float32Array(cells);
    const shift = new Int32Array(cells);
    for (let k = 0; k < cells; k++) {
      const t = 1 + (r() - 0.5) * P.tone;
      const w = (r() - 0.5) * P.warm;
      const fl = r() < P.flash[0] ? P.flash[1] : 1;
      tone[k * 3] = t * fl * (1 + w);
      tone[k * 3 + 1] = t * fl;
      tone[k * 3 + 2] = t * fl * (1 - w);
      tiltX[k] = (r() - 0.5) * P.tilt;
      tiltY[k] = (r() - 0.5) * P.tilt;
      plane[k] = (r() - 0.5) * P.plane;
      shift[k] = Math.floor(r() * N);
    }
    // Streaks: limestone bedding and the ply's face grain, both running
    // along the course. Whole-number wave vectors, so they tile.
    const streak = f === FAMILY.stone ? waves(r, N, 8, [-1, 1], [6, 26]) : f === FAMILY.formwork ? waves(r, N, 10, [-2, 2], [24, 90]) : null;
    const streakA2 = (f === FAMILY.stone ? 0.06 : 0.05) * 2;
    const streakH2 = (f === FAMILY.stone ? 0.15 : 0.1) * 2;
    const shiftOn = f === FAMILY.formwork;

    // The coverage is separable. A texel row meets at most two courses
    // and a texel column at most two modules of a course, and which ones,
    // by how much, and where in the face, depends only on the row — or
    // on the column and the course's parity. So both are tabulated once
    // and the texel loop is lookups and multiply-adds. Searched per texel
    // instead, the same arithmetic cost ~0.75 s cold in Node, which is
    // what a page load pays: the loop runs once, mostly before the JIT
    // has optimised it.
    //   v*: per texel row, two slots: course, overlap mm, face-local y
    //   h*: per parity and texel column, two slots: module, overlap, x
    const vRow = new Int32Array(N * 2), vO = new Float32Array(N * 2), vL = new Float32Array(N * 2);
    for (let y = 0; y < N; y++) {
      const y0 = y * T, y1 = y0 + T;
      let e = 0;
      for (let row = Math.floor(y0 / MH); row <= Math.floor((y1 - 1e-6) / MH); row++) {
        const fy0 = row * MH + J / 2, fy1 = fy0 + FH;
        const o = Math.min(y1, fy1) - Math.max(y0, fy0);
        if (o <= 0) continue;
        vRow[y * 2 + e] = row;
        vO[y * 2 + e] = o;
        vL[y * 2 + e] = (Math.max(y0, fy0) + Math.min(y1, fy1)) / 2 - fy0;
        e++;
      }
    }
    const hCol = new Int32Array(4 * N), hO = new Float32Array(4 * N), hL = new Float32Array(4 * N);
    for (let p = 0; p < 2; p++) {
      const b = bond * p;
      for (let x = 0; x < N; x++) {
        const x0 = x * T, x1 = x0 + T;
        let e = 0;
        for (let col = Math.floor(x0 / MW + b); col <= Math.floor((x1 - 1e-6) / MW + b); col++) {
          const fx0 = (col - b) * MW + J / 2, fx1 = fx0 + FW;
          const o = Math.min(x1, fx1) - Math.max(x0, fx0);
          if (o <= 0) continue;
          const j = (p * N + x) * 2 + e;
          hCol[j] = wrapN(col, cols);
          hO[j] = o;
          hL[j] = (Math.max(x0, fx0) + Math.min(x1, fx1)) / 2 - fx0;
          e++;
        }
      }
    }

    const aCov = new Float32Array(N), aH = new Float32Array(N);
    const aR = new Float32Array(N), aG = new Float32Array(N), aB = new Float32Array(N);
    const arris = P.arris, rollOff = Math.abs(m.recess) * 0.5, TT = T * T;
    for (let y = 0; y < N; y++) {
      aCov.fill(0); aH.fill(0); aR.fill(0); aG.fill(0); aB.fill(0);
      for (let ve = 0; ve < 2; ve++) {
        const oy = vO[y * 2 + ve];
        if (oy <= 0) continue;
        const row = vRow[y * 2 + ve], ly = vL[y * 2 + ve];
        const hp = (row & 1) * N;
        const rowK = wrapN(row, rows) * cols;
        const eyFace = Math.min(ly, FH - ly);
        const tyArg = ly / FH - 0.5;
        for (let x = 0; x < N; x++) {
          for (let he = 0; he < 2; he++) {
            const j = (hp + x) * 2 + he;
            const ox = hO[j];
            if (ox <= 0) continue;
            const k = rowK + hCol[j];
            const lx = hL[j];
            const a = ox * oy;
            let h = plane[k] + tiltX[k] * (lx / FW - 0.5) + tiltY[k] * tyArg;
            if (arris > 0) {
              // The arris: the face rolls off over its last millimetre
              // and a half, halfway down to the joint.
              const e = Math.min(Math.min(lx, FW - lx), eyFace);
              if (e < arris) h -= rollOff * (1 - e / arris);
            }
            let s = 1;
            if (streak) {
              const sv = streak[((y + (shiftOn ? shift[k] : 0)) % N) * N + x] - 0.5;
              s += sv * streakA2;
              h += sv * streakH2;
            }
            aCov[x] += a;
            aH[x] += a * h;
            aR[x] += a * tone[k * 3] * s;
            aG[x] += a * tone[k * 3 + 1] * s;
            aB[x] += a * tone[k * 3 + 2] * s;
          }
        }
      }
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const cov = aCov[x] / TT, hf = aH[x], cr = aR[x], cg = aG[x], cb = aB[x];
        const jc = 1 - cov;
        // Per-texel grain: two draws a texel, each cut into bytes. Seven
        // whole draws a texel was ~70 ms of RNG alone on a loaded box,
        // and grain does not need more than 8 bits.
        const u1 = (r() * 4294967296) >>> 0, u2 = (r() * 4294967296) >>> 0;
        const gA = (u1 & 255) / 255 - 0.5, gH = ((u1 >>> 8) & 255) / 255 - 0.5;
        const jA = ((u1 >>> 16) & 255) / 255 - 0.5, jH = (u1 >>> 24) / 255 - 0.5;
        // Buff brick's iron spots: dark specks of the clay's own iron,
        // 12 texels in 1024.
        const spot = f === FAMILY.brick && (u2 & 1023) < 12 ? 0.72 : 1;
        finish(i, jc, ((u2 >>> 10) & 255) / 255 - 0.5, ((u2 >>> 18) & 255) / 255 - 0.5);
        const mo = 1 + (mottle[i] - 0.5) * 0.06;
        const fa = ((1 + gA * P.grainA) * spot * mo) / TT;
        const ja = (1 + jA * P.jointGrainA) * jc;
        L.rgb[i * 3] = face[0] * cr * fa + jointLin[0] * ja;
        L.rgb[i * 3 + 1] = face[1] * cg * fa + jointLin[1] * ja;
        L.rgb[i * 3 + 2] = face[2] * cb * fa + jointLin[2] * ja;
        L.h[i] = hf / TT + gH * P.grainH * cov + (-m.recess + jH * P.jointGrainH) * jc;
        L.joint[i] = jc;
      }
    }

    if (f === FAMILY.brick) {
      // Chipped arrises: most bricks lose a flake or two off an edge in
      // the handling. A shallow cone, only where there is face to chip.
      for (let row = 0; row < rows; row++) {
        const b = bond * (row & 1);
        for (let col = 0; col < cols; col++) {
          const n = r() < 0.6 ? 1 + Math.floor(r() * 2) : 0;
          for (let c = 0; c < n; c++) {
            const fx0 = (col - b) * MW + J / 2, fy0 = row * MH + J / 2;
            const u = r() * FW, top = r() < 0.5;
            const rad = 3 + r() * 5, depth = 1 + r() * 1.5;
            stampDisc(N, T, fx0 + u, fy0 + (top ? FH : 0), rad, (d) => 1 - d, (i, v) => {
              L.h[i] -= depth * v * (1 - L.joint[i]);
            });
          }
        }
      }
    } else if (f === FAMILY.stone) {
      // Fossil pits: a shelly Gulf limestone is full of small voids.
      for (let k = 0; k < 350; k++) {
        const cx = r() * N * T, cy = r() * N * T, rad = 0.6 + r() * 1.6, depth = 0.4 + r();
        stampDisc(N, T, cx, cy, rad, (d) => Math.sqrt(1 - d * d), (i, v) => {
          const w = v * (1 - L.joint[i]);
          L.h[i] -= depth * w;
          const k3 = i * 3, dk = 1 - 0.22 * w;
          L.rgb[k3] *= dk; L.rgb[k3 + 1] *= dk; L.rgb[k3 + 2] *= dk;
        });
      }
    } else if (f === FAMILY.formwork) {
      // Tie holes: the cones the form ties leave, four to a panel at its
      // quarter points, 25 mm across and plugged 12 mm deep with a
      // darker mortar. Then bug holes — the air the vibrator did not get
      // out — which are most of what makes cast concrete read as cast.
      const TIE_R = 12.5, TIE_FLAT = 4 / 12.5, TIE_D = 12;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          for (const [px, py] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
            stampDisc(N, T, col * MW + px * MW, row * MH + py * MH, TIE_R, (d) => (d < TIE_FLAT ? 1 : (1 - d) / (1 - TIE_FLAT)), (i, v) => {
              L.h[i] -= TIE_D * v;
              const k3 = i * 3, dk = 1 - 0.25 * Math.min(1, v * 2);
              L.rgb[k3] *= dk; L.rgb[k3 + 1] *= dk; L.rgb[k3 + 2] *= dk;
            });
          }
        }
      }
      for (let k = 0; k < 1100; k++) {
        const cx = r() * N * T, cy = r() * N * T;
        const rad = 1 + Math.pow(r(), 2) * 3.5, depth = rad * 0.9;
        stampDisc(N, T, cx, cy, rad, (d) => Math.sqrt(1 - d * d), (i, v) => {
          L.h[i] -= depth * v;
          const k3 = i * 3, dk = 1 - 0.3 * v;
          L.rgb[k3] *= dk; L.rgb[k3 + 1] *= dk; L.rgb[k3 + 2] *= dk;
        });
      }
    }
  } else {
    // Render: no module. A trowelled wall is not flat — a few tenths of a
    // millimetre of undulation over half a metre — and a sand-float
    // finish carries about a millimetre of aggregate texture.
    const und = waves(r, N, 6, [-3, 3], [-3, 3]);
    for (let i = 0; i < NN; i++) {
      const u1 = (r() * 4294967296) >>> 0;
      const gA = (u1 & 255) / 255 - 0.5, gH = ((u1 >>> 8) & 255) / 255 - 0.5;
      finish(i, 0, ((u1 >>> 16) & 255) / 255 - 0.5, (u1 >>> 24) / 255 - 0.5);
      const a = (1 + gA * P.grainA) * (1 + (mottle[i] - 0.5) * 0.05);
      L.rgb[i * 3] = face[0] * a;
      L.rgb[i * 3 + 1] = face[1] * a;
      L.rgb[i * 3 + 2] = face[2] * a;
      L.h[i] = (und[i] - 0.5) * 0.6 * 2 + gH * P.grainH;
    }
    // Hairline cracks: render shrinks and the wall moves, so a rendered
    // wall in the Gulf sun crazes. Wandering polylines, 0.4 mm wide and
    // 0.3 mm deep, a little darker — dirt lives in a crack.
    for (let c = 0; c < 7; c++) {
      let x = r() * N * T, y = r() * N * T, dir = r() * Math.PI * 2;
      const steps = 12 + Math.floor(r() * 40);
      for (let s = 0; s < steps; s++) {
        dir += (r() - 0.5) * 0.9;
        const nx = x + Math.cos(dir) * 15, ny = y + Math.sin(dir) * 15;
        stampSegment(N, T, x, y, nx, ny, 0.4 + r() * 0.3, (i, v) => {
          L.h[i] -= 0.3 * v;
          const k3 = i * 3, dk = 1 - 0.6 * v;
          L.rgb[k3] *= dk; L.rgb[k3 + 1] *= dk; L.rgb[k3 + 2] *= dk;
        });
        x = nx; y = ny;
      }
    }
  }

  // Normalise the LINEAR mean to the target exactly, channel by channel.
  const sum = [0, 0, 0];
  for (let i = 0; i < NN; i++) for (let c = 0; c < 3; c++) sum[c] += L.rgb[i * 3 + c];
  const k = sum.map((s, c) => (target[c] * NN) / s);
  for (let i = 0; i < NN; i++) for (let c = 0; c < 3; c++) L.rgb[i * 3 + c] *= k[c];
  return L;
}

/**
 * Build all four layers.
 *
 * Measured in Node 22 on the 4-core build box while other jobs held its
 * load average at 7-10: ~215 ms warm and 600-830 ms on the FIRST call,
 * which is the one a page load pays, since each family's loop runs once
 * and mostly before the JIT has optimised it. The sand (1024 square, in
 * world.ts) is the same order of work. If a slow browser makes it a
 * stall, it moves to a Worker unchanged — it touches nothing but typed
 * arrays — or behind the first frame.
 */
export function buildMasonry(o: { debug?: boolean } = {}): MasonryMaps {
  const N = MASONRY_N, T = MASONRY_TEXEL_MM, NN = N * N;
  const r = makeRng((WORLD_SEED ^ 0x4d41534f) >>> 0); // "MASO"
  const albedo = new Uint8Array(NN * 4 * MASONRY_LAYERS);
  const normal = new Uint8Array(NN * 4 * MASONRY_LAYERS);
  const mortar: Float32Array[] = [];
  for (let fi = 0; fi < MASONRY_LAYERS; fi++) {
    const f = fi as Family;
    const L = buildLayer(f, r);
    const base = f * NN * 4;
    for (let i = 0; i < NN; i++) {
      const o4 = base + i * 4;
      albedo[o4] = encodeSrgb(L.rgb[i * 3]);
      albedo[o4 + 1] = encodeSrgb(L.rgb[i * 3 + 1]);
      albedo[o4 + 2] = encodeSrgb(L.rgb[i * 3 + 2]);
      albedo[o4 + 3] = Math.round(L.trim[i] * 255);
    }
    // Normals from height by central differences across the tile's wrap,
    // in true millimetres: a 5 mm recess over one 4.7 mm texel is a 45
    // degree slope, which is what a struck joint is.
    for (let y = 0; y < N; y++) {
      const yp = ((y + 1) % N) * N, ym = ((y - 1 + N) % N) * N, yc = y * N;
      for (let x = 0; x < N; x++) {
        const xp = (x + 1) % N, xm = (x - 1 + N) % N;
        const dx = (L.h[yc + xp] - L.h[yc + xm]) / (2 * T);
        const dy = (L.h[yp + x] - L.h[ym + x]) / (2 * T);
        const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
        const o4 = base + (yc + x) * 4;
        normal[o4] = Math.round((-dx * il * 0.5 + 0.5) * 255);
        normal[o4 + 1] = Math.round((-dy * il * 0.5 + 0.5) * 255);
        normal[o4 + 2] = Math.round((il * 0.5 + 0.5) * 255);
        normal[o4 + 3] = Math.max(0, Math.min(255, Math.round(L.rough[yc + x])));
      }
    }
    if (o.debug) mortar.push(L.joint);
  }
  return o.debug ? { n: N, layers: 4, albedo, normal, mortar } : { n: N, layers: 4, albedo, normal };
}
