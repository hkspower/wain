import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { pointGlowTexture, poolGlowTexture } from "./glow";
import {
  Track,
  ROAD_HALF_WIDTH,
  COAST_U,
  COAST_END_M,
  DRIFT_PLAZA,
  STATIONS,
  PAINT_SHOPS,
  LAP,
  spanU,
  TUNNEL_BOX,
  CITY_GROUND_Y,
  BUILDING_FOOTING_M,
} from "./track";
import { applyTextureManifest } from "./assets";
import { PARTS } from "./mods";
import { newPlantField, solvePlantField, type PlantField, type PlantSeed, type Wake } from "./plants";
import {
  buildPalmCrown,
  palmBarkTextures,
  palmLeafTexture,
  palmSlots,
  palmTrunkGeometry,
  patchPalmLeafFragment,
  placePalms,
  PALM_KINDS,
  PALM_PLACE,
  TRUNK_REF_H,
  type PalmFixture,
} from "./palm";
import {
  SHRUB,
  SHRUB_KINDS,
  LEAF_TILE,
  shrubGeometry,
  leafDetailData,
  patchLeafVertex,
  patchLeafFragment,
  layoutVerge,
  burnLegacyVergeDraws,
  type VergeAvoid,
} from "./shrubs";
import { textTexture, arabicSign, latinDisplay } from "./text";
import {
  kuwaitiFigure,
  kuwaitiRacer,
  type ArmChain,
  type RacerLook,
} from "./characters";
import { FLAGS, FLAG_IDS, flagPlane, flagTexture, type FlagId } from "./flags";
import { aimConstrained, solveTwoBone } from "./ik";
import { RIG } from "./rig";
import { RIVALS } from "./rivals";
import { makeRng, rand, resetWorldRng, WORLD_SEED } from "./rand";
import { buildRibbon, latAt, type LatOffset } from "./ribbon";
import {
  ASPHALT,
  MARKINGS,
  buildRoadMarkings,
  junctions,
  legendLayout,
  onForecourt,
  signalHeadS,
} from "./markings";

/**
 * The palms' two materials. Everything they are made of — the crown, the
 * leaflet texture and its mips, the trunk, the bark — is built in
 * palm.ts, where tests/palms.mjs measures it without a browser; these
 * only dress it.
 *
 * The bark: albedo and a real normal map, both drawn from the same
 * height field. The old trunk used its own sRGB colour texture as a bump
 * map at bumpScale 1.4, which is colour, not relief, on a chocolate
 * #5a4327 (saturation 0.57; (58,35,20) at 0.66 in the lock still). Now
 * grey-brown, mean linear Y about 0.10 at saturation 0.21, and the leaf
 * bases stand 2.5 cm proud of their scars.
 */
function palmTrunkMaterial(): THREE.MeshStandardMaterial {
  const bark = palmBarkTextures();
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: bark.map,
    normalMap: bark.normalMap,
    normalScale: new THREE.Vector2(1, 1),
    roughness: 0.92,
  });
}

/**
 * The leaf cards: a white material over the leaflet atlas, the palette in
 * the vertex colours (PALM_LEAF), cut out by alpha.
 *
 * alphaTest 0.5 with alphaToCoverage: on the MSAA tiers (4 samples on
 * high and ultra, 2 on balanced) A2C turns the leaflet edge into
 * coverage instead of a stair; on the tiers with no samples r184's
 * ALPHA_TO_COVERAGE branch still discards below 0.5, a hard cut-out,
 * which is what the atlas's coverage-preserving mips are built for. The
 * shadow map's depth variant picks up the map and the 0.5 cut on its own,
 * double-sided, so the crown's shadow has leaflets in it too.
 *
 * Its OWN program key. plantBend tags every material it patches
 * "grn-plant-bend", and the crown and the shrubs both wore that key while
 * compiling to different shaders; the crown's fragment patch
 * (patchPalmLeafFragment: no back-face flip, thin-leaf transmission)
 * makes the collision a wrong program rather than a wasted one.
 */
function palmLeafMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: palmLeafTexture(),
    vertexColors: true,
    roughness: 0.62,
    alphaTest: 0.5,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
  });
  // A third of the direct light that lands on a frond's far side comes
  // through it: a lamp under the crown lights the undersides you see from
  // the road, where the old crown's core was near black (sweep p5 2,8,0).
  mat.defines = { ...mat.defines, GRN_LEAF_TRANS: "0.35" };
  plantBend(mat);
  const bend = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    bend.call(mat, shader, renderer);
    shader.fragmentShader = patchPalmLeafFragment(shader.fragmentShader);
  };
  mat.customProgramCacheKey = () => "grn-palm-leaf";
  return mat;
}

// Night-time Gulf Road: the corniche leg runs right along the water —
// beach, palms, Green Island, the Salmiya marina, the Scientific Center
// and the Ras Al-Ard light — with the city skyline and water towers on
// the inland return leg.

/**
 * The city's street grid.
 *
 * The whole network is laid out in ROAD SPACE — `s` along the lap, `lat`
 * across it — and mapped into the world through `track.pose()`. That is
 * what makes it a network rather than a set of separate roads: an avenue
 * is a line of constant `lat`, a cross street is a line of constant `s`,
 * so the two meet at every crossing BY CONSTRUCTION instead of being
 * placed near each other and hoping. It also means the grid follows the
 * corniche around every bend for nothing, the way a real coastal city's
 * blocks do — the blocks nearest the water are the ones that bend.
 */
export const STREETS = {
  /** Half-width of a side street. Two lanes and a bit of shoulder. */
  half: 5,
  /** Avenues parallel to the highway, at these distances from its
   *  centreline. The first clears the shoulder, the lamps and the
   *  guardrail; the spacing after that is a city block deep. */
  avenues: [30, 74, 126, 188],
  /** A cross street every this many metres of lap — one city block long. */
  crossEvery: 118,
  /**
   * The grid has no names, and that is recorded rather than pending.
   *
   * Four avenues and 72 cross streets, and not one of them is called
   * anything. The obvious move is to generate addresses — Kuwait
   * addresses by area, block and street, منطقة / قطعة / شارع — and every
   * one of those three is a municipal fact about a real place rather
   * than something a lap fraction can derive. A قطعة covers an area in
   * two dimensions; an avenue here is a line of constant `lat` and runs
   * through all ten districts at once. Street numbers restart per block,
   * not per district. And Sharq, Kuwait City and Salmiya use named
   * streets, not numbered ones.
   *
   * Generating them anyway would be the mistake the AREAS table above
   * already records fixing, one level down: those were equal sixths of
   * the lap, which put Salmiya on the Kuwait City waterfront. A wrong
   * block number is worse than no block number, because a Kuwaiti reads
   * it as a claim about their own city — and it would not stay here
   * either, it would go out through the game data API into the UE5 and
   * Unity ports as though it had been surveyed.
   *
   * The real numbers could not be looked up: Overpass, OpenStreetMap and
   * Wikipedia are all blocked by this environment's egress policy, which
   * track.ts records for the control points. STREET_NAMES below is the
   * hook for them and it ships empty on purpose.
   */
  /** Streets sit under the highway surface (0.02) so the junction reads
   *  as the highway crossing them, and cross streets sit a hair above
   *  the avenues so the two do not z-fight where they meet. */
  yAvenue: 0.014,
  yCross: 0.016,
};

/**
 * Real names for the grid, when someone can survey them.
 *
 * Keyed by the street's own identity — `avenue:<index>` for the four
 * parallel avenues, `cross:<index>` for the 72 cross streets — so a name
 * added here lands on one street and not on a lap fraction that moves
 * the next time the track changes length.
 *
 * EMPTY BY DESIGN. See the note on STREETS above: the naming here is a
 * municipal fact, and this game does not have access to it. An empty
 * table that says so is the honest state; a generated one would be a
 * confident wrong answer wearing the same shape.
 */
export const STREET_NAMES: Record<string, { name: string; arabic: string }> = {};

// Districts in lap order: down Gulf Road, around the Ras Al-Ard point,
// then back through the Second Ring Road's own districts.
//
// `to` is metres from the start line, and every boundary is a real one:
// the coastal four are where the corniche actually passes out of one
// district into the next, and the ring's five are its control points,
// which were placed AT the district boundaries for exactly this reason.
// These were equal sixths of the lap before, which put "Salmiya" on the
// Kuwait City waterfront and moved every boundary whenever the track
// changed length.
export const AREAS = [
  { name: "Sharq", arabic: "شرق", to: 709 },
  { name: "Bneid Al-Gar", arabic: "بنيد القار", to: 1522 },
  { name: "Salmiya", arabic: "السالمية", to: 2736 },
  { name: "Ras Al-Ard", arabic: "رأس الأرض", to: COAST_END_M },  // the same boundary as the road: see LAP
  // --- Second Ring Road, in the order you pass them driving it back
  // toward Bneid Al-Gar ---
  { name: "Shuwaikh Residential", arabic: "الشويخ السكنية", to: 4209 },
  { name: "Shamiya", arabic: "الشامية", to: 5000 },
  { name: "Mansuriya", arabic: "المنصورية", to: 5789 },
  { name: "Da'iya", arabic: "الدعية", to: 6580 },
  { name: "Dasma", arabic: "الدسمة", to: 7369 },
  { name: "City Centre", arabic: "وسط المدينة", to: Infinity },
];

/**
 * The roads themselves.
 *
 * The game is called Night Racer and, until now, never told you
 * which road you were on. The HUD names the DISTRICT — Sharq, Shuwaikh
 * Residential — and the road's name existed in exactly one place in the
 * whole world: a 1.05 m kilometre marker on the verge, Arabic-only,
 * passed at fifty-odd metres a second.
 *
 * A lap is two roads. The coastal leg is Arabian Gulf Street, which is
 * what the signs say and what "Gulf Road" is short for; the way back is
 * the Second Ring. Both names are the ones on the real signage rather
 * than the colloquial ones, for the same reason every district boundary
 * here is a real boundary.
 */
export const ROADS = [
  { to: COAST_END_M, name: "Arabian Gulf Street", arabic: "شارع الخليج العربي" },
  { to: Infinity, name: "Second Ring Road", arabic: "الدائري الثاني" },
];

/**
 * The district you are about to enter, and how far it is.
 *
 * The difference between a label and a guide. areaAt names where you
 * already are, and a driver can see that out of the window; what a sign
 * at the roadside is FOR is the next place and the distance to it.
 *
 * Wraps, because the lap does: past the last boundary the next district
 * is the first one, and the distance runs to the line rather than to the
 * Infinity that terminates the table.
 */
export function nextAreaAt(
  track: Track,
  s: number
): { area: (typeof AREAS)[number]; metres: number } {
  const m = track.wrap(s);
  for (let i = 0; i < AREAS.length; i++) {
    if (m < AREAS[i].to) {
      const next = AREAS[(i + 1) % AREAS.length];
      const edge = Number.isFinite(AREAS[i].to) ? AREAS[i].to : track.length;
      return { area: next, metres: Math.max(0, edge - m) };
    }
  }
  return { area: AREAS[0], metres: Math.max(0, track.length - m) };
}

/** The road at `s`, and the nickname for this stretch of it if it has
 *  one. `nick` is null nearly everywhere: a nickname is a nickname
 *  precisely because it is not the road's name. */
export function roadAt(track: Track, s: number) {
  const m = track.wrap(s);
  const road = ROADS.find((r) => m < r.to) ?? ROADS[ROADS.length - 1];
  const onLove = m >= LOVE_STREET.from && m < LOVE_STREET.to;
  return {
    name: road.name,
    arabic: road.arabic,
    nick: onLove ? "Love Street" : null,
    nickArabic: onLove ? "شارع الحب" : null,
  };
}

/** شارع الحب — what the stretch of the Second Ring between Da'iya and
 *  Dasma is called by everyone who drives it. Straddles the boundary at
 *  6580 m, because that is where the name comes from. */
/** Re-exported so the table in track.ts stays the only copy. */
export const LOVE_STREET = LAP.love;

export function areaAt(track: Track, s: number) {
  const m = track.wrap(s);
  for (const a of AREAS) if (m < a.to) return a;
  return AREAS[AREAS.length - 1];
}

// buildRibbon, LatOffset and latAt live in ribbon.ts now, so the marking
// builder (markings.ts) can lay paint with the same function the road is
// laid with, and a node test can call both. Re-exported here because
// tests/markings.mjs and anything else that learned to find them in this
// file keep finding them.
export { buildRibbon };
export type { LatOffset };

/** Vertical band (guardrail/tunnel wall) following the track at lateral offset. */
function buildWall(
  track: Track,
  lateral: LatOffset,
  y0: number,
  y1: number,
  step = 8,
  u0 = 0,
  u1 = 1
): THREE.BufferGeometry {
  const span = (u1 - u0) * track.length;
  const n = Math.ceil(span / step);
  const positions = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  for (let i = 0; i <= n; i++) {
    const s = u0 * track.length + (i / n) * span;
    track.pose(s, latAt(lateral, s), p, tmp);
    const o = i * 6;
    positions[o] = p.x;
    positions[o + 1] = y0;
    positions[o + 2] = p.z;
    positions[o + 3] = p.x;
    positions[o + 4] = y1;
    positions[o + 5] = p.z;
    const ou = i * 4;
    uvs[ou] = 0;
    uvs[ou + 1] = s / 14;
    uvs[ou + 2] = 1;
    uvs[ou + 3] = s / 14;
    if (i < n) {
      const v = i * 2;
      indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A profiled rail following the track — a cross-section extruded along
 * the road rather than a flat band standing beside it.
 *
 * buildWall above makes a two-vertex ribbon, which is the right shape
 * for a tunnel wall and the wrong one for a guardrail. A guardrail is
 * not a plank: it is a corrugated W-beam, and the corrugation is the
 * whole reason it reads at night. A flat band takes one flat shade
 * across its whole height, so a headlight sweeping past it produces no
 * event at all; a W catches the beam on its two crests and holds a dark
 * line in its valley, and that moving highlight is most of what tells
 * you how fast you are going along a wall.
 *
 * `profile` is a list of [out, up] pairs in metres, where `out` is
 * measured along the track's own side vector — positive being away from
 * the road — so the same profile serves both edges once the sign is
 * flipped. The section is traced in order, so the points describe the
 * face from bottom lip to top lip.
 */
function buildProfiled(
  track: Track,
  lateral: LatOffset,
  profile: ReadonlyArray<[number, number]>,
  facing: number,
  step = 4,
  u0 = 0,
  u1 = 1
): THREE.BufferGeometry {
  const span = (u1 - u0) * track.length;
  const n = Math.ceil(span / step);
  const m = profile.length;
  const positions = new Float32Array((n + 1) * m * 3);
  const uvs = new Float32Array((n + 1) * m * 2);
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();

  // v runs along the section so a texture would band correctly across
  // the beam; u runs down the road at the same 14 m tile as everything
  // else on this surface.
  for (let i = 0; i <= n; i++) {
    const s = u0 * track.length + (i / n) * span;
    track.pose(s, latAt(lateral, s), p, side);
    for (let k = 0; k < m; k++) {
      const [out, up] = profile[k];
      const o = (i * m + k) * 3;
      positions[o] = p.x + side.x * out * facing;
      positions[o + 1] = up;
      positions[o + 2] = p.z + side.z * out * facing;
      const ou = (i * m + k) * 2;
      uvs[ou] = k / (m - 1);
      uvs[ou + 1] = s / 14;
    }
    if (i < n) {
      for (let k = 0; k < m - 1; k++) {
        const a = i * m + k;
        const b = a + m;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * The W-beam's section, in metres, bottom lip to top lip.
 *
 * These are a real guardrail's numbers rather than a shape that looks
 * about right: an AASHTO W-beam is 312 mm deep with the two crests
 * standing 83 mm proud of the bolt line, which is the dimension that
 * decides how wide the highlight is when a headlight crosses it.
 */
const W_BEAM: ReadonlyArray<[number, number]> = [
  [0.0, -0.156],
  [0.055, -0.120],
  [0.083, -0.052],
  [0.030, 0.0], // the valley, where it bolts through to the post
  [0.083, 0.052],
  [0.055, 0.120],
  [0.0, 0.156],
];

/** High-detail asphalt built in a typed array rather than with tens of
 *  thousands of canvas paths — same look, ~100 ms instead of ~30 s.
 *  Returns the colour map and a matching normal map generated from the
 *  identical height field, so lighting lines up with the aggregate.
 *  Tiles every 14 m of road, along and across (ASPHALT.tileM).
 *
 *  Exported for tests/asphalt.mjs, which runs it against a stub canvas
 *  to prove it takes the same numbers from the world's stream, in the
 *  same order, as it always has: it is called partway through
 *  buildWorld, so one draw more or less here would move every building,
 *  billboard and lamp placed after it. */
export function asphaltSurface(): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const S = 1024;

  // --- cheap tileable value noise -------------------------------------
  const hash = (x: number, y: number) => {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >> 13), 1274126177); // imul: plain * loses low bits
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const valueNoise = (x: number, y: number, period: number) => {
    const fx = x / period;
    const fy = y / period;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const w = Math.max(1, Math.round(S / period)); // wrap for seamless tiling
    const a = hash((x0 % w + w) % w, (y0 % w + w) % w);
    const b = hash(((x0 + 1) % w + w) % w, (y0 % w + w) % w);
    const c = hash((x0 % w + w) % w, ((y0 + 1) % w + w) % w);
    const d = hash(((x0 + 1) % w + w) % w, ((y0 + 1) % w + w) % w);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };

  // --- height field: coarse swells + three aggregate grades ------------
  // Each octave is rendered into its own row-cached pass so the inner
  // loop stays a handful of arithmetic ops per pixel.
  const height = new Float32Array(S * S);
  const octaves: Array<[number, number]> = [
    [128, 0.34],
    [32, 0.26],
    [8, 0.24],
    [3, 0.16],
  ];
  for (const [period, amp] of octaves) {
    for (let y = 0; y < S; y++) {
      const row = y * S;
      for (let x = 0; x < S; x++) {
        height[row + x] += valueNoise(x, y, period) * amp;
      }
    }
  }

  // --- colour map from the same field ---------------------------------
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const h = height[i];
    // Dark binder with lighter stones poking through.
    //
    // The binder was 22/255, an albedo of 0.086 — fresh-laid asphalt,
    // and darker than any road anybody drives on. It mattered because of
    // what happened when the city went dark: measured on the corniche at
    // 22:30, unlit buildings deliver a median of 11 and the road
    // delivered 12, so on the coastal leg — where there are far fewer
    // lamps than in Sharq — the road and the towers behind it were the
    // same tone and the horizon had no floor. Aged asphalt is 0.12 to
    // 0.18; this is the bottom of that, which puts the road clear of the
    // city's silhouette without touching the stones that catch a
    // headlight.
    const stone = Math.max(0, h - 0.52) * 2.1;
    const v = 34 + h * 30 + stone * 74;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v + 1;
    img.data[i * 4 + 2] = v + 2;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // --- structural detail (few ops, drawn over the grain) ---------------
  // Tyre-polished wear bands where the wheels track in each lane: the
  // lane centre ± 0.78 m, a 1.55-1.6 m vehicle track and the same offset
  // as the brake-rubber streaks on every bend approach. They were ± 0.045
  // of the tile, 0.63 m: a 1.26 m track, narrower than any car's.
  const wheelPathU = ASPHALT.wheelPathM / ASPHALT.tileM;
  for (const u of ASPHALT.oilU) {
    for (const off of [-wheelPathU, wheelPathU]) {
      const x = (u + off) * S;
      const g = ctx.createLinearGradient(x - 24, 0, x + 24, 0);
      g.addColorStop(0, "rgba(10,11,14,0)");
      g.addColorStop(0.5, "rgba(10,11,14,0.45)");
      g.addColorStop(1, "rgba(10,11,14,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - 24, 0, 48, S);
    }
  }

  // Patched repairs with ragged edges
  for (let i = 0; i < 4; i++) {
    const w = 90 + rand() * 240;
    const hgt = 80 + rand() * 200;
    const x = rand() * (S - w);
    const y = rand() * (S - hgt);
    ctx.fillStyle = "rgba(14,15,19,0.7)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k <= 12; k++) ctx.lineTo(x + (w * k) / 12, y + (rand() - 0.5) * 9);
    for (let k = 0; k <= 12; k++) ctx.lineTo(x + w + (rand() - 0.5) * 9, y + (hgt * k) / 12);
    for (let k = 12; k >= 0; k--) ctx.lineTo(x + (w * k) / 12, y + hgt + (rand() - 0.5) * 9);
    ctx.closePath();
    ctx.fill();
  }

  /*
   * Crack sealant, and why it has a mask of its own.
   *
   * Every crack and seam is a dark stroke, and the roughness map below
   * reads dark as tyre-polished: smooth. So the sealant came out at about
   * 0.50 roughness against 0.92 for the open asphalt — the glossiest
   * thing on the road — and at night each stroke mirrored the IBL's lamp
   * ring. Measured on the 4K brake still, one seam read 61-92 luma
   * against the asphalt around it, +31: a pale transverse line across all
   * four lanes, every 4.7 m, which is a painted marking or a concrete
   * slab joint, and asphalt has neither. Real crack sealant is black and
   * dull. Each stroke is now a Path2D, stroked into the colour map as
   * before and into this mask at the same width, and the roughness pass
   * holds anything under the mask at ASPHALT.sealantRoughness or above.
   *
   * The world's stream: the strokes take exactly the rand() calls they
   * always took, in the same order (tests/asphalt.mjs replays the old
   * code against this one). This function runs partway through
   * buildWorld, so a draw added or dropped here would move the city.
   */
  const mc = document.createElement("canvas");
  mc.width = mc.height = S;
  const mctx = mc.getContext("2d")!;
  mctx.strokeStyle = "#fff";
  const seal = (path: Path2D, width: number) => {
    ctx.stroke(path);
    mctx.lineWidth = width;
    mctx.stroke(path);
  };

  // Crack networks with branches
  const crack = (x: number, y: number, len: number, angle: number, depth: number) => {
    ctx.strokeStyle = `rgba(${8 + depth * 5},${9 + depth * 5},${11 + depth * 5},${0.8 - depth * 0.2})`;
    ctx.lineWidth = Math.max(0.7, 2.6 - depth * 0.8);
    const path = new Path2D();
    path.moveTo(x, y);
    let cx = x;
    let cy = y;
    let a = angle;
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      a += (rand() - 0.5) * 0.6;
      cx += Math.cos(a) * (len / steps);
      cy += Math.sin(a) * (len / steps);
      path.lineTo(cx, cy);
    }
    seal(path, ctx.lineWidth);
    if (depth < 2 && rand() < 0.8) {
      crack(cx, cy, len * 0.55, a + (rand() < 0.5 ? 0.9 : -0.9), depth + 1);
    }
  };
  for (let i = 0; i < 10; i++) {
    crack(rand() * S, rand() * S, 110 + rand() * 240, rand() * 6.28, 0);
  }

  // Sealed tar seams. Three per tile, all of them full width, were a
  // jointed-slab rhythm: a transverse line across every lane every 4.7 m.
  // One full-width joint per 14 m tile stays — a paving run's day joint
  // — and the other two are patch edges across a single lane, the lane
  // taken from the seam's own y so the stream is not asked for anything
  // new. Both draws per seam are still taken, in the old order.
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = "rgba(6,6,8,0.8)";
    const width = 4 + rand() * 4;
    ctx.lineWidth = width;
    const y0 = rand() * S;
    const x0 = i === 0 ? 0 : 0.25 * (Math.floor(y0) % 4) * S;
    const x1 = i === 0 ? S : x0 + 0.25 * S;
    const path = new Path2D();
    path.moveTo(x0, y0 + Math.sin(x0 * 0.02) * 6);
    for (let x = x0 + 48; x < x1; x += 48) path.lineTo(x, y0 + Math.sin(x * 0.02) * 6);
    path.lineTo(x1, y0 + Math.sin(x1 * 0.02) * 6);
    seal(path, width);
  }

  // Oil drips down the lane centres — the centres, u = LANES / 14 + 0.5.
  // They were at u 0.25 / 0.5 / 0.75, which is lat -3.5 / 0 / +3.5: on
  // the lane lines, where no car's sump ever is. Same three draws each.
  for (let i = 0; i < 20; i++) {
    const x = ASPHALT.oilU[i % ASPHALT.oilU.length] * S + (rand() - 0.5) * 60;
    const y = rand() * S;
    const r = 6 + rand() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(4,4,6,0.5)");
    g.addColorStop(1, "rgba(4,4,6,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 16;

  // Roughness needs its OWN linear texture. Aliasing `map` into
  // roughnessMap carried colorSpace = SRGBColorSpace with it, so the
  // sampler applied the sRGB EOTF to the roughness fetch too and the road
  // came out at ~0.01 roughness — a black mirror. Roughness is data.
  const rc = document.createElement("canvas");
  rc.width = rc.height = S;
  const rctx = rc.getContext("2d")!;
  const shade = ctx.getImageData(0, 0, S, S).data;
  const sealant = mctx.getImageData(0, 0, S, S).data;
  const sealantV = ASPHALT.sealantRoughness * 255;
  const rimg = rctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    // dark = tyre-polished = smoother; light = coarse aggregate = rougher
    const t = Math.min(1, Math.max(0, (shade[i * 4 + 1] - 9) / 26));
    let v = (0.38 + t * 0.54) * 255;
    // ...except sealant, which is dark and dull (see the mask above).
    if (sealant[i * 4 + 3] > 0) v = Math.max(v, sealantV);
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = v;
    rimg.data[i * 4 + 3] = 255;
  }
  rctx.putImageData(rimg, 0, 0);
  const roughnessMap = new THREE.CanvasTexture(rc);
  // Data, not colour. This is the default, but it is the default that a
  // shared texture once silently overrode — the road came out at 0.01
  // roughness, a black mirror — so it is stated rather than assumed.
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = 16;
  // no colorSpace assignment on purpose — this is linear data

  // --- normal map straight from the height field (single fast pass) ----
  const nc = document.createElement("canvas");
  nc.width = nc.height = S;
  const nctx = nc.getContext("2d")!;
  const nimg = nctx.createImageData(S, S);
  const strength = 2.6;
  for (let y = 0; y < S; y++) {
    const yp = ((y + 1) % S) * S;
    const ym = ((y - 1 + S) % S) * S;
    const yc = y * S;
    for (let x = 0; x < S; x++) {
      const xp = (x + 1) % S;
      const xm = (x - 1 + S) % S;
      const dx = (height[yc + xp] - height[yc + xm]) * strength;
      const dy = (height[yp + x] - height[ym + x]) * strength;
      const len = Math.hypot(dx, dy, 1);
      const o = (yc + x) * 4;
      nimg.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      nimg.data[o + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      nimg.data[o + 2] = (1 / len) * 0.5 * 255 + 127;
      nimg.data[o + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.colorSpace = THREE.NoColorSpace; // vectors, not colour
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = 16;

  return { map, normalMap, roughnessMap };
}

function seaTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0a2236";
  ctx.fillRect(0, 0, 256, 256);
  // Wave crests catching the moon
  for (let i = 0; i < 420; i++) {
    const a = 0.04 + rand() * 0.12;
    ctx.strokeStyle = `rgba(${140 + rand() * 60},${190 + rand() * 40},${
      215 + rand() * 40
    },${a})`;
    ctx.lineWidth = 0.8 + rand() * 1.4;
    const x = rand() * 256;
    const y = rand() * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 14, y + (rand() - 0.5) * 5, x + 22 + rand() * 22, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function lightPoolTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  // LED white, faintly cool. The sodium orange these used to be is what
  // made the whole night frame amber; the lamps are white now and the
  // only warm light left on the road comes from windows and tail lamps,
  // which is what a Gulf Road retrofit actually looks like.
  // Brighter than the sodium it replaced, which is the actual reason a
  // city pays to retrofit: measured at the old alpha the coast lost its
  // fill entirely — 46% of the ground at 0/255 against 24% before — and
  // a verge with no detail in it is not what a new lamp buys you.
  g.addColorStop(0, "rgba(232,240,255,0.74)");
  g.addColorStop(0.34, "rgba(216,229,250,0.4)");
  g.addColorStop(0.62, "rgba(206,220,246,0.15)");
  g.addColorStop(1, "rgba(198,214,242,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Long soft smear for the wet-asphalt reflection of a lamp head. */
function lightStreakTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  // Hot near the lamp, trailing off along the road; soft lateral falloff.
  // Canvas-bottom is the +Z (lamp-side) end of the rotated plane.
  const along = ctx.createLinearGradient(0, 128, 0, 0);
  along.addColorStop(0, "rgba(236,243,255,0.8)");
  along.addColorStop(0.35, "rgba(206,220,246,0.32)");
  along.addColorStop(1, "rgba(192,208,238,0)");
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, 32, 128);
  const across = ctx.createLinearGradient(0, 0, 32, 0);
  across.addColorStop(0, "rgba(0,0,0,1)");
  across.addColorStop(0.5, "rgba(0,0,0,0)");
  across.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 32, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Four-point star glint — the sparkle a bright point source throws. */
function glintTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const arm = (w: number, h: number) => {
    const g = ctx.createLinearGradient(32 - w, 32, 32 + w, 32);
    // White, so the material colour decides the tint: the one material
    // that wears this is the cool 0xe6eeff of the LED lanterns, and a
    // warm halogen star on a blue-white lens read as two different lamps.
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(32 - w, 32 - h, w * 2, h * 2);
  };
  arm(30, 1.4); // horizontal
  ctx.save();
  ctx.translate(32, 32);
  ctx.rotate(Math.PI / 2);
  ctx.translate(-32, -32);
  arm(30, 1.4); // vertical
  ctx.restore();
  const core = ctx.createRadialGradient(32, 32, 1, 32, 32, 7);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Point-source coronas come from glow.ts now — see the note there on
// why a lamp needs a different falloff from a pool of light on tarmac.

function concreteTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#73767c";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const g = 96 + rand() * 50;
    ctx.fillStyle = `rgba(${g},${g + 2},${g + 6},${0.2 + rand() * 0.4})`;
    ctx.fillRect(rand() * 256, rand() * 256, 1.5, 1.5);
  }
  // Streaky weathering
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = `rgba(40,42,46,${0.05 + rand() * 0.1})`;
    const x = rand() * 256;
    ctx.fillRect(x, 0, 2 + rand() * 7, 256);
  }
  // Panel seams
  ctx.strokeStyle = "rgba(30,32,36,0.7)";
  ctx.lineWidth = 2;
  for (const x of [0, 128]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The underpass wall — and it is authored SIDEWAYS on purpose.
 *
 * buildWall lays its UVs out as u = height (0 at the road, 1 at the
 * soffit) and v = distance along the tunnel over 14 m. So on this canvas
 * the X axis is HEIGHT and the Y axis is LENGTH, which is the opposite
 * of how anybody draws a wall and the reason this is its own function
 * rather than a few extra strokes on concreteTexture(): every band here
 * is a vertical stripe standing for a horizontal course.
 *
 * What is drawn is what a road tunnel actually has, bottom to top:
 *
 *   a plinth, dark and wet — the bit that gets hit by spray and never
 *   dries. This is most of why the old flat grey read as a corridor
 *   rather than a road: there was nothing to say which end was the
 *   ground.
 *
 *   a tiled dado to about 2.5 m, in a pale ceramic. Tunnels are tiled to
 *   head height for a reason a night racing game should care about — it
 *   is there to bounce headlights back onto the carriageway — so it is
 *   the lightest thing in here and it carries its own grout.
 *
 *   bare concrete above that, dirtier as it climbs, because nothing
 *   washes it.
 *
 * Plus an expansion joint once per tile: a real tunnel is cast in bays
 * and the seam between them is the thing that tells you how fast you are
 * going when everything else is a smooth grey wall.
 */
function tunnelWallTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  // X in pixels for a height in metres, against TUNNEL_BOX.height.
  const atM = (m: number) => (m / TUNNEL_BOX.height) * S;
  // Y in pixels for a distance in metres. The map is repeated twice over
  // buildWall's 14 m of v, so one tile is seven metres of tunnel.
  const TILE_M = 7;
  const atL = (m: number) => (m / TILE_M) * S;

  // Bare concrete everywhere first; the courses go on top.
  ctx.fillStyle = "#787b81";
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 4200; i++) {
    const g = 100 + rand() * 46;
    ctx.fillStyle = `rgba(${g},${g + 2},${g + 6},${0.18 + rand() * 0.36})`;
    ctx.fillRect(rand() * S, rand() * S, 1.5, 1.5);
  }

  // ---- the tiled dado, 0.35 m to 2.5 m ----
  const dadoLo = atM(0.35), dadoHi = atM(2.5);
  ctx.fillStyle = "#cfd3d0";
  ctx.fillRect(dadoLo, 0, dadoHi - dadoLo, S);
  // Ceramic is not one colour: vary it per tile so the courses read.
  const TILE = 0.25; // metres, both ways
  for (let m = 0.35; m < 2.5; m += TILE) {
    for (let n = 0; n < TILE_M; n += TILE) {
      const v = 198 + rand() * 26;
      ctx.fillStyle = `rgba(${v},${v + 3},${v},0.55)`;
      ctx.fillRect(atM(m), atL(n), atM(TILE) - 1, atL(TILE) - 1);
    }
  }
  // Grout, both ways.
  ctx.strokeStyle = "rgba(120,124,124,0.75)";
  ctx.lineWidth = 1;
  for (let m = 0.35; m <= 2.5 + 1e-6; m += TILE) {
    ctx.beginPath(); ctx.moveTo(atM(m), 0); ctx.lineTo(atM(m), S); ctx.stroke();
  }
  for (let n = 0; n <= TILE_M + 1e-6; n += TILE) {
    ctx.beginPath(); ctx.moveTo(dadoLo, atL(n)); ctx.lineTo(dadoHi, atL(n)); ctx.stroke();
  }

  // ---- the plinth, road level to 0.35 m ----
  const plinth = ctx.createLinearGradient(0, 0, atM(0.55), 0);
  plinth.addColorStop(0, "rgba(24,25,28,0.96)");
  plinth.addColorStop(0.62, "rgba(38,40,44,0.85)");
  plinth.addColorStop(1, "rgba(60,62,66,0)");
  ctx.fillStyle = plinth;
  ctx.fillRect(0, 0, atM(0.55), S);

  // ---- grime: heavy at the bottom of the tile, thinning upward ----
  const grime = ctx.createLinearGradient(atM(0.35), 0, atM(1.5), 0);
  grime.addColorStop(0, "rgba(46,44,38,0.5)");
  grime.addColorStop(1, "rgba(46,44,38,0)");
  ctx.fillStyle = grime;
  ctx.fillRect(atM(0.35), 0, atM(1.5) - atM(0.35), S);
  // And soot high up, where the exhaust collects against the soffit.
  const soot = ctx.createLinearGradient(atM(3.4), 0, S, 0);
  soot.addColorStop(0, "rgba(30,30,32,0)");
  soot.addColorStop(1, "rgba(30,30,32,0.22)");
  ctx.fillStyle = soot;
  ctx.fillRect(atM(3.4), 0, S - atM(3.4), S);

  // Run-off streaks down the bare concrete — vertical on the wall, which
  // is horizontal here.
  for (let i = 0; i < 16; i++) {
    const at = atL(rand() * TILE_M);
    ctx.fillStyle = `rgba(38,40,42,${0.05 + rand() * 0.12})`;
    ctx.fillRect(atM(2.5), at, S - atM(2.5), 1.5 + rand() * 5);
  }

  // ---- the expansion joint, once per bay ----
  ctx.fillStyle = "rgba(22,23,26,0.85)";
  ctx.fillRect(0, 0, S, 2.5);
  ctx.fillStyle = "rgba(150,153,155,0.25)";
  ctx.fillRect(0, 2.5, S, 1);

  const tex = new THREE.CanvasTexture(c);
  // Length repeats; height must NOT — the courses are absolute
  // positions up the wall, and tiling them would put a second plinth in
  // the ceiling.
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function paverTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#5a544a";
  ctx.fillRect(0, 0, 128, 128);
  // Offset brick courses
  ctx.strokeStyle = "rgba(20,18,15,0.8)";
  ctx.lineWidth = 2;
  for (let row = 0; row < 4; row++) {
    const y = row * 32;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(128, y);
    ctx.stroke();
    const off = row % 2 === 0 ? 0 : 32;
    for (let x = off; x <= 128; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 32);
      ctx.stroke();
    }
  }
  for (let i = 0; i < 900; i++) {
    const g = 70 + rand() * 40;
    ctx.fillStyle = `rgba(${g},${g - 6},${g - 14},0.35)`;
    ctx.fillRect(rand() * 128, rand() * 128, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The sand's tile, in metres: one 1024 px image covers SAND_TILE_M
 *  square of beach, so a grain is about 6 mm and a ripple is 15 cm. */
const SAND_TILE_M = 6;

/**
 * Beach sand: a tiling albedo and a normal map from one height field.
 *
 * It was a 256 x 128 gradient with 6,000 one-pixel specks, stretched
 * 43 m across the beach and 20 m along it — about 16 cm a texel. Close
 * up the specks magnified into soft blotches, and with no relief the
 * sun lit the whole beach as one flat tan sheet. Its "wet sand toward
 * the waterline" darkened toward u = 1, which is the PROMENADE edge of
 * the ribbon: the seaward edge is u = 0. The wet band now lives on the
 * mesh (vertex colour, on the sea side) and this image is only sand.
 *
 * What makes sand read as sand at driving distance is wind ripple: low
 * parallel ridges, gentle on the windward face and steep on the lee,
 * wandering and fading in patches. They are built with a whole number
 * of periods across the tile in each axis, so the tile repeats with no
 * seam, and bent by a tileable noise so they are not ruled lines. The
 * normal map carries them to the light; the albedo carries them only a
 * little (crests a touch paler, as dry sand on a crest is), plus grain
 * and a sprinkle of darker shell grit. Its mean sits where the old
 * texture's did, so the exposure does not move.
 *
 * Built on its own seeded generator. The world's shared sequence is
 * advanced by exactly the draws the old texture made (4 x 6,000), so
 * every building, palm and lamp placed after this lands where it did.
 */
function sandSurface(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  for (let i = 0; i < 24000; i++) rand();
  const r = makeRng((WORLD_SEED ^ 0x53414e44) >>> 0); // "SAND"
  const N = 1024;
  // Every broad field here — the bend in the ripples, where they fade,
  // the tone of the sand in patches — is a sum of sine waves at random
  // whole-number wave vectors: seamless across the tile, and with no
  // grid for the eye to find (a smoothstepped lattice at this scale read
  // from above as a chequerboard of soft squares). Each wave is split
  // into a column table and a row table, sin(a+b) = sin a cos b +
  // cos a sin b, so a pixel costs a few multiply-adds and no sin: the
  // naive field was 0.75 s of load on a slow machine.
  const waves = (count: number, kmax: number) => {
    const cs: Float32Array[] = [], cc: Float32Array[] = [], rs: Float32Array[] = [], rc: Float32Array[] = [];
    let norm = 0;
    for (let i = 0; i < count; i++) {
      let kx = 0, ky = 0;
      while (kx === 0 && ky === 0) {
        kx = Math.round((r() * 2 - 1) * kmax);
        ky = Math.round((r() * 2 - 1) * kmax);
      }
      const ph = r() * Math.PI * 2;
      const amp = 0.6 + r() * 0.4;
      norm += amp;
      const colS = new Float32Array(N), colC = new Float32Array(N);
      const rowS = new Float32Array(N), rowC = new Float32Array(N);
      for (let j = 0; j < N; j++) {
        const ax = (kx * j * Math.PI * 2) / N, ay = (ky * j * Math.PI * 2) / N + ph;
        colS[j] = Math.sin(ax) * amp;
        colC[j] = Math.cos(ax) * amp;
        rowS[j] = Math.sin(ay);
        rowC[j] = Math.cos(ay);
      }
      cs.push(colS); cc.push(colC); rs.push(rowS); rc.push(rowC);
    }
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let w = 0; w < count; w++) {
        const cy = rc[w][y], sy = rs[w][y], a = cs[w], b = cc[w];
        const o = y * N;
        for (let x = 0; x < N; x++) out[o + x] += a[x] * cy + b[x] * sy;
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = 0.5 + (0.5 * out[i]) / norm;
    return out;
  };
  const bendA = waves(6, 3), bendB = waves(5, 6), patch = waves(7, 3), tone = waves(9, 5);
  // 37 periods across and 11 along: ridges about 15 cm apart, running
  // obliquely to the shore the way an onshore breeze lays them.
  const KX = 37, KY = 11;
  const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const bend = (bendA[y * N + x] - 0.5) * 2.6 + (bendB[y * N + x] - 0.5) * 1.1;
      const ph = (KX * x) / N + (KY * y) / N + bend;
      const f = ph - Math.floor(ph);
      // Gentle stoss (70% of the period), steep lee.
      const ridge = f < 0.7 ? f / 0.7 : (1 - f) / 0.3;
      const amp = 0.25 + 0.75 * Math.min(1, Math.max(0, (patch[y * N + x] - 0.3) * 1.8));
      H[y * N + x] = (ridge - 0.5) * amp + (r() - 0.5) * 0.12;
    }
  }
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = N;
    c.height = N;
    const ctx = c.getContext("2d")!;
    return { c, ctx, img: ctx.createImageData(N, N) };
  };
  const alb = mk(), nrm = mk();
  // The old texture's mean, near enough: #72644a.
  const BR = 0x78, BG = 0x69, BB = 0x4c;
  const at = (x: number, y: number) => H[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const h = H[y * N + x];
      let k = 0.97 + h * 0.1 + (tone[y * N + x] - 0.5) * 0.12 + (r() - 0.5) * 0.14;
      const grit = r();
      if (grit < 0.004) k *= 0.62;
      else if (grit > 0.997) k *= 1.22;
      alb.img.data[i] = Math.min(255, BR * k);
      alb.img.data[i + 1] = Math.min(255, BG * k);
      alb.img.data[i + 2] = Math.min(255, BB * (k * 0.98));
      alb.img.data[i + 3] = 255;
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const S = 2.2;
      let nx = -dx * S, ny = -dy * S;
      const len = Math.sqrt(nx * nx + ny * ny + 1); // not Math.hypot: a million calls
      nx /= len;
      ny /= len;
      nrm.img.data[i] = (nx * 0.5 + 0.5) * 255;
      nrm.img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      nrm.img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nrm.img.data[i + 3] = 255;
    }
  }
  alb.ctx.putImageData(alb.img, 0, 0);
  nrm.ctx.putImageData(nrm.img, 0, 0);
  const tex = (c: HTMLCanvasElement, cs: THREE.ColorSpace) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = cs;
    t.anisotropy = 8;
    return t;
  };
  // The normal map is data: read raw, never gamma-decoded.
  return { map: tex(alb.c, THREE.SRGBColorSpace), normalMap: tex(nrm.c, THREE.NoColorSpace) };
}

function adTexture(line1: string, line2: string, bg: string, fg: string, accent: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 224;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 224);
  // diagonal accent slash, TXR-billboard style
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(380, 0);
  ctx.lineTo(512, 0);
  ctx.lineTo(512, 224);
  ctx.lineTo(440, 224);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = fg;
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 212);
  ctx.fillStyle = fg;
  ctx.textAlign = "left";
  ctx.font = `700 64px ${latinDisplay()}`;
  ctx.fillText(line1, 28, 100);
  ctx.font = `600 34px ${latinDisplay()}`;
  ctx.globalAlpha = 0.9;
  ctx.fillText(line2, 28, 165);
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Illuminated roadside billboard on twin posts, facing oncoming traffic. */
function billboard(track: Track, s: number, offset: number, tex: THREE.CanvasTexture): THREE.Group {
  const g = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.7 });
  for (const px of [-4, 4]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 7, 8), postMat);
    post.position.set(px, 3.5, 0);
    g.add(post);
  }
  // Front face only — the back gets a plain panel instead of mirrored text
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 5.6),
    new THREE.MeshStandardMaterial({
      map: tex,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.85,
      roughness: 0.6,
    })
  );
  board.position.y = 9.4;
  g.add(board);
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 5.6),
    new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.9 })
  );
  back.rotation.y = Math.PI;
  back.position.set(0, 9.4, -0.04);
  g.add(back);
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();
  track.pointAt(s, p);
  track.sideAt(s, side);
  g.position.set(p.x + side.x * offset, 0, p.z + side.z * offset);
  g.lookAt(p.x, 9.4, p.z);
  return g;
}

/** Soft additive glow billboards around point light sources (lamp coronas). */
function coronaPoints(positions: THREE.Vector3[], color: number, size: number): THREE.Points {
  const geo = new THREE.BufferGeometry();
  const arr = new Float32Array(positions.length * 3);
  positions.forEach((p, i) => {
    arr[i * 3] = p.x;
    arr[i * 3 + 1] = p.y;
    arr[i * 3 + 2] = p.z;
  });
  geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      map: pointGlowTexture(),
      color,
      size,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
  );
  pts.frustumCulled = false;
  return pts;
}

/**
 * A tower's skin, as two maps drawn from one pass of the same dice.
 *
 * There used to be one texture doing both jobs, and its background was
 * #0a0d13 — so the FACADE was painted near-black and every building in
 * the city was a black slab at every hour of the day, tint or no tint.
 * Measured at noon: half the building pixels at 0/255 and a ceiling of
 * 211. A lit window was a pale patch in the albedo, which at night is a
 * pale patch standing in shadow rather than a light.
 *
 *   facade   concrete, banded by floor, with the glass a shade darker.
 *            This is what the sun lights and what the palette tints.
 *   lit      black except for the windows that are on. This drives
 *            emission, so those windows are sources after dark.
 */
/**
 * The facade skin: concrete with a window grid, and the same grid again
 * as an emissive map so lit windows are light sources rather than pale
 * paint.
 *
 * WHY IT IS THIS SIZE AND FILTERED THIS WAY
 *
 * This was 128x256, stretched over an entire building with no repeat and
 * magnified with the default linear filter. On a twenty-metre facade
 * that is about four screen pixels per texel, so every one of a window's
 * six-pixel edges was interpolated across four pixels of screen — and a
 * window with a four-pixel gradient on each side is not a window, it is
 * a glowing smudge. That is what "the buildings are blurry" was: not
 * fog, not depth of field, not the post chain. A small texture,
 * magnified, smoothly.
 *
 * Three things fix it, and all three are needed:
 *
 *   size      four times the resolution in each axis, so the grid has
 *             room for a frame and a mullion instead of being six pixels
 *             of flat colour.
 *   magFilter NEAREST. A window is a hard-edged rectangle and should
 *             arrive as one. This is the single biggest change; linear
 *             magnification is what was doing the smearing.
 *   aniso     16, up from 4. A facade is almost always seen at a
 *             grazing angle from a car, which is precisely the case
 *             anisotropic filtering exists for.
 *
 * minFilter stays trilinear: NEAREST minification on a window grid
 * crawls horribly as the camera moves, and a distant tower should go
 * smooth rather than sparkle.
 */
/**
 * Length-wise gradient for the visible shaft under a street lamp.
 *
 * The same reasoning as the headlight cone in engine.ts: the cone is
 * additive and double-sided, the eye sums both walls, and the walls
 * converge at the head — so the shaft fades to nothing at BOTH ends,
 * out at the head to stop a bright knot sitting on the luminaire, and
 * out at the road so the light dissolves into the pool instead of
 * ending in a rim. Cool white, because these are the LED lanterns the
 * corniche carries, not the car's warm halogens.
 */
function lampConeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  // A soft peak two thirds of the way up rather than a flat plateau: a
  // plateau is a band of constant brightness, and with the walls fading
  // at their silhouettes (lampShaftMaterial) a constant band still reads
  // as a sheet. Air lit by a lantern is brightest near the lantern.
  g.addColorStop(0.0, "rgba(220,231,255,0)");
  g.addColorStop(0.2, "rgba(222,232,255,0.10)");
  g.addColorStop(0.45, "rgba(224,234,255,0.36)");
  g.addColorStop(0.67, "rgba(228,238,255,0.58)");
  g.addColorStop(0.85, "rgba(229,239,255,0.30)");
  g.addColorStop(1.0, "rgba(230,240,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The street lamp's visible shaft, drawn as lit air rather than as a
 * lampshade.
 *
 * It was a MeshBasicMaterial on an open, double-sided cone, and that
 * drew it as two flat sheets: inside the silhouette the eye summed the
 * near and far walls at full strength, and at the silhouette it stopped
 * dead. From the low cameras the ik stills use, a column 6 m off the
 * lens put a hard grey triangle across a quarter of the sky (68 against
 * a clear sky of 34, with a 3 px edge), and down the road a dozen of
 * them stacked into a pyramid at the vanishing point.
 *
 * Real light in haze has no edge: the path a ray takes through a cone of
 * lit air shrinks to nothing at the cone's silhouette. |N.V| is that
 * path length's shape, near enough, so the wall fades toward the
 * silhouette and is strongest where you look through it face-on. The
 * shaft also fades in from 10 to 30 m — a cone you are standing in is
 * only ever its own walls, filling the frame — and out from 90 to
 * 180 m, where a dozen faint shafts otherwise sum into one bright one.
 */
function lampShaftMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: lampConeTexture() },
      uColor: { value: new THREE.Color(0xdfeaff) },
      uOpacity: { value: 0.05 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING
          mat4 inst = instanceMatrix;
        #else
          mat4 inst = mat4(1.0);
        #endif
        vec4 wp = modelMatrix * inst * vec4(position, 1.0);
        vWorld = wp.xyz;
        // The instance carries a non-uniform scale (the shaft's foot is
        // stretched along the road), so the normal goes through the
        // inverse-transpose: divide by the squared axis lengths.
        mat3 m = mat3(inst);
        vec3 n = normal / vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2]));
        vN = normalize(mat3(modelMatrix) * (m * n));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vN;
      void main() {
        vec3 v = cameraPosition - vWorld;
        float d = length(v);
        float facing = abs(dot(normalize(vN), v / d));
        float a = texture2D(map, vUv).a * uOpacity * facing * facing
          * smoothstep(10.0, 30.0, d) * (1.0 - smoothstep(90.0, 180.0, d));
        if (a < 1e-4) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function windowTextures(): Skin {
  // Texels per original pixel. 4 fixed the mid-distance city and left
  // the NEAR facades soft: the texture tiles every 39x85 m, so at S=4 a
  // facade carries 13 texels per metre — and a block is allowed to stand
  // ~12 m off the carriageway, where the screen spends ~50 px per metre.
  // One texel across four pixels, on the biggest surfaces in the frame:
  // the close-range frames show window panes as big soft rectangles with
  // the frame-and-mullion detail dissolved entirely. Framed that way the
  // fix is arithmetic: 8 puts a window pane at 48 texels across instead
  // of 24. Costs ~22 MB across the two 1024x2048 maps with mips, the
  // same order as the destination signs.
  const S = 8;
  const W = 128 * S;
  const H = 256 * S;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return [c, c.getContext("2d")!] as const;
  };
  const [fc, fx] = mk();
  const [lc, lx] = mk();
  // The roughness map. Painted alongside the other two so the three can
  // never disagree about where a pane is. Grey levels ARE the surface:
  // concrete near-matte, glass polished, the frame in between.
  const [rc, rx] = mk();
  // Concrete, with a faint band per floor so a facade has some tone of
  // its own before anything lights it.
  // Concrete, and a darker concrete than it was.
  //
  // Measured through the per-surface levels tool on the corniche at
  // 22:30: buildings delivered a median of 21/255, the sky 37 and the
  // road 12. Three surfaces inside twenty-five 8-bit steps of each other
  // is three surfaces that merge — the skyline had an edge only where a
  // window happened to be lit, and the city read as one grey mass
  // between a grey sky and a grey road.
  //
  // A night skyline is a BLACK silhouette against a glowing sky, and
  // that is the separation this buys: the city goes to the bottom of the
  // range, the sky keeps the middle, the lit road takes the top. It is
  // the opposite of the fix this file used to carry — the background was
  // once #0a0d13, near-black, which made every building a black slab at
  // NOON as well and put half the building pixels at 0/255 in daylight.
  // This is a real concrete grey, a third down from where it was, so it
  // still has somewhere to go when the sun is on it.
  fx.fillStyle = "#5f646b";
  fx.fillRect(0, 0, W, H);
  lx.fillStyle = "#000000";
  lx.fillRect(0, 0, W, H);
  rx.fillStyle = "#dadada"; // concrete: matte (CONCRETE_MAP_ROUGH)
  rx.fillRect(0, 0, W, H);
  for (let y = 6 * S; y < 250 * S; y += 10 * S) {
    fx.fillStyle = "rgba(0,0,0,0.10)";
    fx.fillRect(0, y + 6 * S, W, 3 * S); // spandrel between floors
    // A hard shadow line under each spandrel. At the old resolution
    // there was nowhere to put one; it is most of what tells the eye
    // this is a stack of floors rather than a pattern.
    fx.fillStyle = "rgba(0,0,0,0.22)";
    fx.fillRect(0, y + 6 * S, W, Math.max(1, S / 2));
    const floorVibe = rand();
    const litChance = floorVibe < 0.18 ? 0.85 : floorVibe < 0.5 ? 0.12 : 0.38;
    const warm = rand() < 0.7;
    for (let x = 5 * S; x < 122 * S; x += 9 * S) {
      const ww = 6 * S;
      const wh = 5 * S;
      // The reveal: a window is set INTO a facade, so it carries a dark
      // frame. Two rectangles instead of one, which is only affordable
      // now there are twenty-four texels across a pane instead of six.
      fx.fillStyle = "#6f747d";
      fx.fillRect(x - S / 2, y - S / 2, ww + S, wh + S);
      // The glass. A real pane is not one colour: it holds the sky at
      // the top and the room's darkness at the bottom, because it is a
      // mirror at a grazing angle and a hole at a straight one. A
      // vertical gradient per pane is the cheapest possible statement
      // of that, and it is most of what makes a facade of them read as
      // glazing rather than as painted-on rectangles.
      {
        const g = fx.createLinearGradient(0, y, 0, y + wh);
        g.addColorStop(0, "#5a6b7e");
        g.addColorStop(0.45, "#46505e");
        g.addColorStop(1, "#343b46");
        fx.fillStyle = g;
        fx.fillRect(x, y, ww, wh);
      }
      // A thin bright catch along the top edge — the frame's return
      // picking up the sky — and the occasional diagonal sheen, which
      // is a reflection of nothing in particular and reads as one.
      fx.fillStyle = "rgba(190,205,222,0.55)";
      fx.fillRect(x, y, ww, Math.max(1, S / 3));
      if (rand() < 0.22) {
        fx.save();
        fx.beginPath();
        fx.rect(x, y, ww, wh);
        fx.clip();
        fx.strokeStyle = "rgba(210,222,238,0.20)";
        fx.lineWidth = 1.6 * S;
        fx.beginPath();
        fx.moveTo(x - 2 * S, y + wh + S);
        fx.lineTo(x + ww * 0.7, y - S);
        fx.stroke();
        fx.restore();
      }
      // Mullion down the middle, and a transom two fifths up — window
      // furniture the old six-texel pane had no room to carry.
      const bar = Math.max(1, S / 2);
      fx.fillStyle = "#3d434d";
      fx.fillRect(x + ww / 2 - bar / 2, y, bar, wh);
      fx.fillRect(x, y + wh * 0.38, ww, Math.max(1, S / 3));
      // The pane is polished, the bars are not.
      rx.fillStyle = "#1f1f1f";
      rx.fillRect(x, y, ww, wh);
      rx.fillStyle = "#8a8a8a";
      rx.fillRect(x + ww / 2 - bar / 2, y, bar, wh);
      rx.fillRect(x, y + wh * 0.38, ww, Math.max(1, S / 3));
      if (rand() < litChance) {
        const col = warm || rand() < 0.6 ? "#ffd27f" : "#9ad1ff";
        // A room, not a lamp: about a quarter of lit windows glow only
        // below the transom — a curtain half-drawn, a light on a desk —
        // which is the single strongest tell that there is a room in
        // there rather than a backlit sticker.
        const curtained = rand() < 0.28;
        const gy = curtained ? y + wh * 0.38 : y;
        const gh = curtained ? wh * 0.62 : wh;
        lx.fillStyle = col;
        lx.globalAlpha = 0.45 + rand() * 0.55;
        lx.fillRect(x, gy, ww, gh);
        // The mullion and transom are opaque, so they stay dark in a
        // lit window too — a pane split into quarters reads as a
        // window; a solid rectangle of light reads as a lamp.
        lx.globalAlpha = 1;
        lx.fillStyle = "#000000";
        lx.fillRect(x + ww / 2 - bar / 2, y, bar, wh);
        lx.fillRect(x, y + wh * 0.38, ww, Math.max(1, S / 3));
        // Curtain-glow spill on bright windows
        if (rand() < 0.25) {
          lx.fillStyle = col;
          lx.globalAlpha = 0.12;
          lx.fillRect(x - S, y - S, ww + 2 * S, wh + 2 * S);
        }
        lx.globalAlpha = 1;
        // A lit pane is a little paler in daylight too
        fx.fillStyle = "#5d6674";
        fx.globalAlpha = 0.35;
        fx.fillRect(x, gy, ww, gh);
        fx.globalAlpha = 1;
      }
    }
  }
  const wrap = (canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = colorSpace;
    tex.anisotropy = 16;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    return tex;
  };
  // The roughness map is DATA, not a colour. Tagged sRGB like the other
  // two, the GPU gamma-decoded it before the shader read it, so the pane
  // painted at 0.12 rendered at about 0.014 — a mirror — the 0.54 frame
  // at 0.25 and the 0.855 concrete at 0.70. Read raw, the grey levels
  // are the roughness they say they are.
  return { facade: wrap(fc), lit: wrap(lc), rough: wrap(rc, THREE.NoColorSpace) };
}

function signTexture(en: string, ar: string, sub?: string): THREE.CanvasTexture {
  // Gulf motorway convention: Arabic on top, Latin beneath it.
  //
  // Drawn at twice the size it used to be, and the reason is measured
  // rather than felt. tools/shots/texels.mjs asks how many texels of a
  // texture land on each screen pixel, and at the underpass this one
  // came back at 0.28 — one texel every three and a half pixels, across
  // a third of the frame. That is the biggest sign in the game, it is
  // ten metres of lettering you drive straight at, and reading it is the
  // whole reason it exists. Everything else the survey found was either
  // comfortably sharp or a false alarm; this was the pixelated area.
  //
  // The context is scaled instead of the coordinates, so every number
  // below still means what it said when the canvas was 512 wide. Thirteen
  // of these exist — one per district plus Love Street — so the change
  // costs about 17 MB of texture, which is the same order as the two
  // 1024-square road maps this world already carries.
  const SS = 2;
  return textTexture(512 * SS, 160 * SS, (ctx) => {
    ctx.scale(SS, SS);
    ctx.fillStyle = "#0a4da3";
    ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 496, 144);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    ctx.font = `700 54px ${arabicSign()}`;
    ctx.fillText(ar, 256, 66);
    ctx.direction = "ltr";
    ctx.font = `600 40px ${latinDisplay()}`;
    ctx.fillText(en, 256, 116);
    if (sub) {
      ctx.font = `500 24px ${latinDisplay()}`;
      ctx.fillText(sub, 256, 146);
    }
  });
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const arabicNumber = (n: number) =>
  String(n)
    .split("")
    .map((d) => (d === "." ? "٫" : ARABIC_DIGITS[+d] ?? d))
    .join("");

/** Kuwait-style kilometre way-marker: distance in Arabic-Indic numerals
 *  over the road's Arabic name. A reassurance marker names the road you
 *  are on and counts from THAT road's start, so the lap carries two
 *  independent runs of them — one down Gulf Road, one round the ring. */
function waymarkTexture(km: number, road: string, roadEn: string): THREE.CanvasTexture {
  return textTexture(256, 320, (ctx) => {
    ctx.fillStyle = "#0a4da3";
    ctx.fillRect(0, 0, 256, 320);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, 236, 300);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    const ar = arabicSign();
    // Arabic above, English below — the order on every road sign in the
    // country, and the reason it is that order is that both are needed:
    // a marker that names the road in one script names it for half the
    // people who read it.
    ctx.direction = "rtl";
    ctx.font = `700 30px ${ar}`;
    ctx.fillText(road, 128, 56);
    ctx.direction = "ltr";
    // Condensed to fit: "Arabian Gulf Street" is nineteen characters
    // across a board 236 px wide, and a name that overflows its own
    // sign is worse than no name.
    ctx.font = `700 19px ${latinDisplay()}`;
    ctx.fillText(roadEn, 128, 80);
    ctx.direction = "rtl";
    ctx.font = `700 104px ${ar}`;
    ctx.fillText(arabicNumber(km), 128, 208);
    ctx.font = `700 38px ${ar}`;
    ctx.fillText("كم", 88, 268);
    ctx.direction = "ltr";
    ctx.font = `700 30px ${latinDisplay()}`;
    ctx.fillText("KM", 170, 268);
  });
}

/** Blue roundabout sign: the three-arrow circle with the plaza's name. */
function roundaboutSignTexture(): THREE.CanvasTexture {
  return textTexture(256, 340, (ctx) => {
  ctx.fillStyle = "#0a4da3";
  ctx.fillRect(0, 0, 256, 340);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 236, 320);
  // The glyph: three arrows chasing each other around a circle
  ctx.save();
  ctx.translate(128, 128);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const a0 = (i / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(0, 0, 58, a0 + 0.35, a0 + 1.75);
    ctx.stroke();
    // Arrowhead at the leading end of each arc
    const at = a0 + 1.75;
    const hx = Math.cos(at) * 58;
    const hy = Math.sin(at) * 58;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(at + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.lineTo(-13, -6);
    ctx.lineTo(13, -6);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.direction = "rtl";
  ctx.font = `700 48px ${arabicSign()}`;
  ctx.fillText(DRIFT_PLAZA.arabic, 128, 260);
  ctx.direction = "ltr";
  ctx.font = `600 26px ${latinDisplay()}`;
  ctx.fillText(DRIFT_PLAZA.name.toUpperCase(), 128, 302);
  });
}

/** White thermoplastic road text, transparent everywhere else. The same
 *  white as the lines (MARKINGS.paint.white, linear 0.73): it was
 *  0xf2f2ee, 0.89, brighter than any paint laid on a road. */
function roadTextTexture(text: string): THREE.CanvasTexture {
  return textTexture(512, 256, (ctx) => {
    ctx.fillStyle = `#${MARKINGS.paint.white.toString(16).padStart(6, "0")}`;
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    // Thermoplastic road lettering is drawn tall and heavy so it still
    // reads when foreshortened to almost nothing at the far end
    ctx.font = `700 118px ${arabicSign()}`;
    ctx.fillText(text, 256, 170);
  });
}

/**
 * A sign board's face: it glows through its OWN texture, so the white
 * legend is the bright thing and the blue field stays blue. The boards
 * used a flat grey emissive (0x444444-0x666666) that lit legend and
 * field alike: unlit, the white words came out about 62 of 255 and the
 * blue went grey behind them. Night-gated with every other emissive
 * under 2.0 (nightGlow).
 */
function signFaceMat(map: THREE.Texture, glow = 0.45): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: glow });
}

function stripeTexture(colorA: string, colorB: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? colorA : colorB;
    ctx.fillRect(0, i * 8, 8, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Gulf-standard bend board: black chevrons on a yellow panel, pointing
 *  into the turn. Drawn double-wide so three arrows read at speed. */
function chevronTexture(pointRight: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f2c400";
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 250, 90);
  ctx.fillStyle = "#111111";
  for (let i = 0; i < 3; i++) {
    const x0 = 34 + i * 72;
    ctx.beginPath();
    if (pointRight) {
      ctx.moveTo(x0, 16);
      ctx.lineTo(x0 + 34, 48);
      ctx.lineTo(x0, 80);
      ctx.lineTo(x0 + 16, 80);
      ctx.lineTo(x0 + 50, 48);
      ctx.lineTo(x0 + 16, 16);
    } else {
      ctx.moveTo(x0 + 50, 16);
      ctx.lineTo(x0 + 16, 48);
      ctx.lineTo(x0 + 50, 80);
      ctx.lineTo(x0 + 34, 80);
      ctx.lineTo(x0, 48);
      ctx.lineTo(x0 + 34, 16);
    }
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The enamelled steel discs that clad the spheres.
 *
 * This is the thing that makes Kuwait Towers recognisable, and it is not
 * a colour: it is roughly forty-one thousand small enamelled steel discs
 * in eight shades of blue, green and grey, set in offset rows so the
 * surface shifts as you drive past. A plain teal ball reads as a water
 * tank, which is what these were before.
 *
 * One patch of the grid is drawn and then tiled rather than painting a
 * whole sphere, so a few thousand discs cost a quarter-megabyte image.
 */
function discCladdingTexture(): THREE.CanvasTexture {
  // Eight shades, which is what the real cladding uses: blues through
  // greens to grey rather than eight steps of one teal, or the whole
  // sphere reads as painted metal instead of a mosaic.
  const SHADES = [
    "#2b6f8f", "#3f8fa8", "#57a49c", "#74b7a4",
    "#93c4b6", "#aec6c4", "#6e8ea3", "#c6d1d2",
  ];
  const N = 16;
  const CELL = 32;
  const c = document.createElement("canvas");
  c.width = c.height = N * CELL;
  const ctx = c.getContext("2d")!;
  // The mounting behind the discs. It shows as a grid between them and,
  // at a distance, it is most of what you see — a near-black ground and
  // a small disc turned the spheres into disco balls, so the ground is a
  // mid slate and the discs nearly touch.
  ctx.fillStyle = "#41535c";
  ctx.fillRect(0, 0, c.width, c.height);
  // A fixed shuffle rather than Math.random: the pattern is then the
  // same on every run, so two screenshots of this tower can be compared.
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const r = CELL * 0.48;
  // Drawn at the wrap as well as in place. Offset rows put half a disc
  // over the right edge, and without its other half at the left edge the
  // tiling shows a seam straight down the sphere.
  const disc = (cx: number, cy: number, shade: string) => {
    for (const x of [cx - c.width, cx, cx + c.width]) {
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(x, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // Enamel is glossy. A small off-centre highlight sells that from
      // the road far better than a specular map would.
      ctx.fillStyle = "rgba(255,255,255,0.26)";
      ctx.beginPath();
      ctx.arc(x - r * 0.3, cy - r * 0.32, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      disc(
        (col + (row % 2 ? 0.5 : 0)) * CELL + CELL / 2,
        row * CELL + CELL / 2,
        SHADES[Math.floor(rnd() * SHADES.length)]
      );
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Kuwait Towers, on the Ras Ajouza promontory off Arabian Gulf Street.
 *
 * Three towers, not three aerials: 187 m with two spheres, 147 m with
 * one, and 113 m with none — the short one is a lighting mast that
 * floodlights the other two, which is why it has no sphere and why it
 * reads as a mistake if you give it one. On the main tower the lower
 * sphere sits at 82 m (a restaurant over a water tank) and the smaller
 * upper one at 123 m (the revolving viewing sphere). Those ratios are
 * the whole silhouette, so they are held to one scale factor here and
 * the main tower keeps the height it already had in this skyline.
 */
function kuwaitTowers(): THREE.Group {
  const g = new THREE.Group();
  const S = 113 / 187; // main tower unchanged against the rest of the skyline
  const H1 = 187 * S;
  const H2 = 147 * S;
  const H3 = 113 * S;

  // Pale board-marked concrete, warmed a little because at night these
  // are lit from below by the third tower and never read as cold white.
  const shaftMat = new THREE.MeshStandardMaterial({
    color: 0xd3d8dc,
    roughness: 0.72,
    emissive: 0x2a2115,
    emissiveIntensity: 0.35,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0d1a22,
    roughness: 0.15,
    metalness: 0.6,
    emissive: 0xffcc88,
    emissiveIntensity: 0.55,
  });
  const cladding = discCladdingTexture();

  // One disc is about 0.9 m across whatever sphere it is on, so the
  // texture repeat comes from the radius. The horizontal repeat has to
  // be a whole number or the tiling does not close where u wraps.
  const DISC = 0.9;
  const sphere = (radius: number): THREE.Mesh => {
    const map = cladding.clone();
    map.needsUpdate = true;
    const ru = Math.max(3, Math.round((2 * Math.PI * radius) / (16 * DISC)));
    map.repeat.set(ru, ru / 2);
    return new THREE.Mesh(
      new THREE.SphereGeometry(radius, 36, 24),
      new THREE.MeshStandardMaterial({
        map,
        // The same discs drive the glow, so each one lights in its own
        // colour rather than the whole ball washing to one tint.
        emissiveMap: map,
        emissive: 0xffffff,
        emissiveIntensity: 0.4,
        // Enamel over steel, not bare steel: mostly diffuse with a sheen.
        // At 0.45 metalness they went black in daylight, because there is
        // nothing in the sky for a metal to reflect.
        roughness: 0.45,
        metalness: 0.2,
      })
    );
  };
  /** The glazed gallery band around a sphere. One storey of windows, so
   *  it has to stay thin — at 3.4 m on a 10 m sphere it read as a stripe
   *  painted round the middle rather than as a floor with a view out. */
  const gallery = (radius: number, height: number): THREE.Mesh =>
    new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.008, radius * 1.008, height, 36, 1, true), glassMat);

  // --- Main tower: 187 m, two spheres
  const main = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 3.4, H1, 14), shaftMat);
  shaft.position.y = H1 / 2;
  main.add(shaft);

  const rLow = 10.4;
  const lower = sphere(rLow);
  lower.position.y = 82 * S;
  main.add(lower);
  const lowerGlass = gallery(rLow, 2.0);
  lowerGlass.position.y = 82 * S + rLow * 0.3;
  main.add(lowerGlass);

  const rUp = 5.7;
  const upper = sphere(rUp);
  upper.position.y = 123 * S;
  main.add(upper);
  const upperGlass = gallery(rUp, 1.6);
  upperGlass.position.y = 123 * S;
  main.add(upperGlass);
  g.add(main);

  // --- Second tower: 147 m, one sphere, all of it water storage
  const second = new THREE.Group();
  const shaft2 = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.8, H2, 12), shaftMat);
  shaft2.position.y = H2 / 2;
  second.add(shaft2);
  const rMid = 9.2;
  const ball2 = sphere(rMid);
  ball2.position.y = H2 * 0.6;
  second.add(ball2);
  second.position.set(5, 0, -33);
  g.add(second);

  // --- Third tower: 113 m, no sphere. It is a lighting mast, so it gets
  // the floodlights instead — a ring of them near the top, aimed back at
  // the other two.
  const third = new THREE.Group();
  const shaft3 = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 2.2, H3, 12), shaftMat);
  shaft3.position.y = H3 / 2;
  third.add(shaft3);
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a18,
    emissive: 0xfff0cc,
    emissiveIntensity: 2.2,
    roughness: 0.4,
  });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 8), lampMat);
    lamp.rotation.z = Math.PI / 2;
    lamp.rotation.y = -a;
    lamp.position.set(Math.cos(a) * 1.5, H3 - 5, Math.sin(a) * 1.5);
    third.add(lamp);
  }
  third.position.set(11, 0, -62);
  g.add(third);

  // --- The base. The towers stand on a stepped plinth with a low
  // entrance podium under the main one; without it they look pushed into
  // the ground like posts.
  const plinthMat = new THREE.MeshStandardMaterial({ color: 0xbfae8a, roughness: 0.9 });
  for (const [x, z, r] of [
    [0, 0, 11],
    [5, -33, 9],
    [11, -62, 7],
  ]) {
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 1.6, 2.2, 16), plinthMat);
    plinth.position.set(x, 1.1, z);
    g.add(plinth);
  }
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(19, 21, 5.5, 20), plinthMat);
  podium.position.set(-3, 2.75, 8);
  g.add(podium);

  // Ras Ajouza itself. The headland belongs to the group rather than to
  // the caller: laid out separately it was a 72 m disc dropped 52 m off
  // the road, which reached twenty metres PAST the centreline and put
  // sand over the carriageway. Built here it turns with the towers and
  // its size can be checked against the layout it actually has to cover.
  const sandMat = new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 1 });
  const land = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.06, 2.6, 32), sandMat);
  land.scale.set(38, 1, 62);
  land.position.set(4, 1.3, -30);
  g.add(land);
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1.2, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x6f6a5e, roughness: 0.95 })
  );
  wall.scale.set(38.4, 1, 62.4);
  wall.position.set(4, 2.6, -30);
  g.add(wall);

  return g;
}

function waterTowers(stripes: THREE.CanvasTexture): THREE.Group {
  const g = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.6 });
  const capMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.5 });
  for (let i = 0; i < 5; i++) {
    const t = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 19, 8), stemMat);
    stem.position.y = 9.5;
    t.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(6, 14, 10), capMat);
    cap.scale.y = 0.8;
    cap.position.y = 20;
    t.add(cap);
    t.position.set((i % 3) * 22 - 22, 0, Math.floor(i / 3) * 20 - 10);
    g.add(t);
  }
  return g;
}

type Skin = { facade: THREE.CanvasTexture; lit: THREE.CanvasTexture; rough: THREE.CanvasTexture };

/** A glazed tower's material: concrete by day, lit windows after dark.
 *  The caller keeps the material so the hour can drive its emission. */

/**
 * One tile of facade, in metres: thirteen window bays across and
 * twenty-five floors up, at three metres a bay and three-point-four a
 * floor. Real dimensions, so a building's UVs can be worked out from
 * its size instead of the texture being stretched to fit whatever it
 * happens to be.
 */
const FACADE_TILE_M = { x: 39, y: 85 };

/**
 * Scale a facade's UVs by the size of the instance wearing them.
 *
 * The blocks are one InstancedMesh with one material, so every building
 * had the same UVs — 0 to 1 across whatever it was — and two things
 * followed from that, both visible.
 *
 * The blur: a typical block is about 22 m wide and 24 m tall, and the
 * texture is 512 x 1024, so it delivered 23 texels per metre across and
 * 43 up. Nearly twice as coarse horizontally as vertically, which is
 * exactly what the smearing was — window rows melting into horizontal
 * bands while the floors above and below them stayed separate.
 *
 * The other thing: every building had twenty-five floors. A ten-metre
 * shop and a hundred-and-thirty-metre tower, both twenty-five floors,
 * one with floors forty centimetres high and the other with floors five
 * metres high.
 *
 * Both go away if the UVs are scaled by the instance's own size, which
 * is sitting right there in instanceMatrix. Guarded on USE_INSTANCING so
 * the same material still compiles for the handful of non-instanced
 * meshes that wear it.
 */

/**
 * Bend an instanced plant along a per-instance lean.
 *
 * `grnBend` is (dirX, dirZ, strength) per instance in the plant's own
 * frame; `grnWeight` is the per-vertex weight, 0 at the root and 1 at
 * the tip. The displacement is strength x weight along the
 * lean, and the top sinks a little as it leans (a stem arcs, it does
 * not shear), which is the second term. The normal is rotated toward
 * the lean by the same amount so the lit side follows the surface.
 *
 * `key` is the program cache key. A material that chains a further
 * patch after this one (the shrubs' leaf tile) passes its own: two
 * materials with the same key and the same parameters are handed the
 * same compiled program, whichever patch built it.
 */
function plantBend(mat: THREE.MeshStandardMaterial, key = "grn-plant-bend"): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        #ifdef USE_INSTANCING
          attribute vec3 grnBend;
          attribute float grnWeight;
        #endif`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float grnW = grnWeight;
          float grnS = grnBend.z * grnW;
          vec2 grnD = grnBend.xy;
          transformed.xz += grnD * grnS;
          // An arc, not a shear: the tip drops as it leans.
          transformed.y -= grnS * grnS * ${RIG.plant.arcDrop.toFixed(3)};
        #endif`
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        #ifdef USE_INSTANCING
          objectNormal.xz += grnBend.xy * grnBend.z * grnWeight * ${RIG.plant.normalGain.toFixed(3)};
          objectNormal = normalize(objectNormal);
        #endif`
      );
  };
  mat.customProgramCacheKey = () => key;
}

/** The verge, kept for the frame loop: the spring field, and how to
 *  write each plant's answer into its mesh. */
let plantsRef: {
  field: PlantField;
  lapLen: number;
  meshes: THREE.InstancedMesh[];
  write: (i: number, dx: number, dz: number, str: number) => void;
} | null = null;
let plantClock = 0;

/**
 * One frame of the verge: every plant's spring stepped toward the wind
 * plus the wake of every car, and the result written into the bend
 * attributes. The arithmetic lives in plants.ts, where a test can run
 * it without a browser; this is the part that knows about meshes.
 */
function solvePlants(dt: number, wakes: readonly Wake[]): void {
  const P = plantsRef;
  if (!P) return;
  plantClock += dt;
  solvePlantField(P.field, plantClock, dt, wakes, P.lapLen, P.write);
  for (const im of P.meshes) (im.userData.bend as THREE.InstancedBufferAttribute).needsUpdate = true;
}

function facadeUvScaling(mat: THREE.MeshStandardMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec3 grnScale = vec3(
          length(instanceMatrix[0].xyz),
          length(instanceMatrix[1].xyz),
          length(instanceMatrix[2].xyz));
        vec3 grnN = abs(normal);
        // Which two of the box's three extents this face actually spans.
        vec2 grnSpan;
        if (grnN.y > 0.5) grnSpan = vec2(grnScale.x, grnScale.z);
        else if (grnN.x > 0.5) grnSpan = vec2(grnScale.z, grnScale.y);
        else grnSpan = vec2(grnScale.x, grnScale.y);
        vec2 grnTile = grnSpan / vec2(${FACADE_TILE_M.x.toFixed(1)}, ${FACADE_TILE_M.y.toFixed(1)});
        #ifdef USE_MAP
          vMapUv *= grnTile;
        #endif
        #ifdef USE_EMISSIVEMAP
          vEmissiveMapUv *= grnTile;
        #endif
        // The roughness map rides its own UV in this three.js — left
        // untiled it would put the polished patches off their own panes.
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv *= grnTile;
        #endif
      #endif`
    );
  };
  // Without this the two compilations — instanced and not — share a
  // cache entry and whichever compiles first wins for both.
  mat.customProgramCacheKey = () => "grn-facade-uv";
}

/** The concrete grey painted into the roughness map (#dadada), read raw.
 *  glazedMat divides a building's own concrete roughness by it, so the
 *  map's concrete lands on exactly that value and the frames and panes
 *  keep their proportion to it. */
const CONCRETE_MAP_ROUGH = 0xda / 255;

function glazedMat(skin: Skin, color: number, concreteRoughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: skin.facade,
    emissiveMap: skin.lit,
    emissive: 0xffffff,
    emissiveIntensity: 1.15,
    color,
    // What makes the glass GLASS. Painting a pane a bluer grey makes a
    // decal; what a window does that concrete cannot is answer the
    // light — the scene carries an environment map, and a surface only
    // asks it when it is smooth. The roughness map paints concrete matte
    // and panes at 0.12 of it, and this material scales the map so the
    // concrete is the building's own value — 0.8 for the city blocks,
    // glossier on the two hero towers (Liberation 0.5, Al Hamra 0.4),
    // whose panes therefore polish further too — so
    // every window picks up the sky and the city as a sheen while the
    // wall around it stays dead flat. The albedo gradient in the pane
    // is the base tone; this is the part that moves with the camera.
    roughness: concreteRoughness / CONCRETE_MAP_ROUGH,
    roughnessMap: skin.rough,
    // roadMat is the one surface in this scene whose IBL response was
    // ever actually measured — 1.15 dry, up to 2.5 wet — and every
    // building material sat at three.js's unmeasured default of 1
    // while doing it. tools/shots/darkbuildings.mjs confirmed the gap
    // directly: at midnight, before any dawn fade, a facade turned away
    // from both moonLight and fillLight read 0.253 median luma against
    // 0.451 for one that faces them — a facing-dependent hole, not the
    // intended night-to-dawn fade.
    //
    // 1.5 is roadMat's dry floor with headroom, not a value this scene's
    // auto-exposure let itself be swept to cleanly: re-running the same
    // scan at 1.0 (baseline, gap 0.198), 1.5 (gap 0.176) and 2.5 (gap
    // 0.197 — back near baseline) showed no clean, monotonic response,
    // because raising envMapIntensity also brightens the glazing's glass
    // panes (roughness 0.12, far more IBL-responsive than this matte
    // wall texture) enough to pull the whole frame's average up, and the
    // scene's own auto-exposure pulls back down to compensate — eating
    // most of the gain this fix is actually after. This is a real,
    // previously-missing property matched to roadMat's own precedent,
    // not a knob this diagnostic tool could tune to a clean pass; a
    // structural fix (an envMapIntensity that applies to the concrete
    // texels without also feeding the exposure-compensation loop through
    // the glass) is future work, not this one.
    envMapIntensity: 1.5,
  });
}

function liberationTower(skin: Skin, lit: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  // Named for the same reason every InstancedMesh in the city is: a
  // brightness/sharpness tool that segments buildings by an ID-pass
  // name walk (tools/shots/sharpness.mjs, tools/shots/darkbuildings.mjs)
  // has to find this one too, or "every building" quietly means "every
  // building except the two hero towers".
  g.name = "liberationTower";
  const mat = new THREE.MeshStandardMaterial({ color: 0xb9bfc7, roughness: 0.6 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7, 95, 12), mat);
  shaft.position.y = 47.5;
  g.add(shaft);
  const discMat = glazedMat(skin, 0xffffff, 0.5);
  lit.push(discMat);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 7, 14), discMat);
  disc.position.y = 72;
  g.add(disc);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.8, 38, 6), mat);
  antenna.position.y = 114;
  g.add(antenna);
  return g;
}

function alHamra(skin: Skin, lit: THREE.MeshStandardMaterial[]): THREE.Mesh {
  const mat = glazedMat(skin, 0xdddddd, 0.4);
  lit.push(mat);
  const tower = new THREE.Mesh(new THREE.BoxGeometry(26, 118, 24), mat);
  tower.position.y = 59;
  tower.name = "alHamraTower"; // see the comment on liberationTower's name
  return tower;
}

function mosque(): THREE.Group {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xd9cba8,
    roughness: 0.8,
    emissive: 0x4a3c1e,
    emissiveIntensity: 0.25,
  });
  const domeMat = new THREE.MeshStandardMaterial({
    color: 0x2e8f96,
    roughness: 0.4,
    emissive: 0x0e4a50,
    emissiveIntensity: 0.5,
  });
  const hall = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 22), wallMat);
  hall.position.y = 4.5;
  g.add(hall);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(8, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.y = 9;
  g.add(dome);
  const minaret = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.7, 27, 8), wallMat);
  minaret.position.set(17, 13.5, 8);
  g.add(minaret);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(1.8, 4, 8), domeMat);
  tip.position.set(17, 29, 8);
  g.add(tip);
  return g;
}

function greenIsland(): THREE.Group {
  const g = new THREE.Group();
  const sand = new THREE.Mesh(
    new THREE.CylinderGeometry(95, 100, 1.2, 24),
    new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 1 })
  );
  sand.position.y = 0.3;
  g.add(sand);
  const lawn = new THREE.Mesh(
    new THREE.CylinderGeometry(78, 82, 1.4, 24),
    new THREE.MeshStandardMaterial({ color: 0x1e4d22, roughness: 1 })
  );
  lawn.position.y = 0.7;
  g.add(lawn);
  // The island's palms were green cones — the "party hat" the corniche
  // palms were rebuilt to get away from — and then, for as long as the
  // corniche swapped to palm.glb, a different crown from the corniche's.
  // The same crown, trunk and bark as the avenue now (palm.ts), with no
  // swap to fall out of step with.
  const trunkMat = palmTrunkMaterial();
  const crownMat = palmLeafMaterial();
  const islandCrown = buildPalmCrown("kept");
  const islandTrunk = palmTrunkGeometry();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = 25 + (i % 3) * 18;
    // A 6 m trunk standing on the lawn at 1.4 m: the reference trunk
    // squeezed to 6 m, so its top — the crown's origin — is at 7.4.
    const trunk = new THREE.Mesh(islandTrunk, trunkMat);
    trunk.position.set(Math.cos(a) * r, 1.4, Math.sin(a) * r);
    trunk.scale.set(1, 6 / TRUNK_REF_H, 1);
    g.add(trunk);
    const crown = new THREE.Mesh(islandCrown, crownMat);
    crown.position.set(Math.cos(a) * r, 7.4, Math.sin(a) * r);
    crown.rotation.y = a * 2.3;
    g.add(crown);
  }
  // Observation tower at the centre
  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 2.2, 16, 8),
    new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.8, emissive: 0x3a2e16, emissiveIntensity: 0.4 })
  );
  tower.position.y = 8.7;
  g.add(tower);
  return g;
}

function marinaBoats(): THREE.Group {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.5 });
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x9fb4c8, roughness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 7 + (i % 3) * 2), hullMat);
    hull.position.y = 0.55;
    boat.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 2.4), cabinMat);
    cabin.position.set(0, 1.5, -0.8);
    boat.add(cabin);
    boat.position.set((i % 2) * 9 - 4, 0, Math.floor(i / 2) * 12 - 12);
    boat.rotation.y = (i * 0.9) % (Math.PI * 2);
    g.add(boat);
  }
  return g;
}

function scientificCenter(): THREE.Group {
  // The sail-shaped aquarium on the Salmiya waterfront, stylized as a
  // glassy pyramid wedge.
  const g = new THREE.Group();
  const sailMat = new THREE.MeshStandardMaterial({
    color: 0x9fc4d8,
    roughness: 0.25,
    metalness: 0.5,
    emissive: 0x14323f,
    emissiveIntensity: 0.6,
  });
  const sail = new THREE.Mesh(new THREE.CylinderGeometry(0, 24, 34, 4), sailMat);
  sail.position.y = 17;
  sail.rotation.y = Math.PI / 4;
  sail.scale.z = 0.45;
  g.add(sail);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(50, 7, 26),
    new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.8, emissive: 0x3a2e16, emissiveIntensity: 0.3 })
  );
  base.position.y = 3.5;
  g.add(base);
  return g;
}

/**
 * The price board every Kuwaiti forecourt has by the road: the grade in
 * Arabic-Indic numerals over what it costs, in fils per litre.
 *
 * 91 and 95 are the two grades that matter — عادي and ممتاز, the ones
 * every pump on the corniche offers — and 85 and 105 fils are what they
 * cost. Real numbers rather than invented ones, because the whole point
 * of the board is that a Kuwaiti player has read it a thousand times
 * and knows at a glance what it should say.
 */
function pumpPriceTexture(): THREE.CanvasTexture {
  return textTexture(256, 512, (ctx) => {
    ctx.fillStyle = "#07321f";
    ctx.fillRect(0, 0, 256, 512);
    ctx.strokeStyle = "#e8f6ee";
    ctx.lineWidth = 7;
    ctx.strokeRect(9, 9, 238, 494);
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    const ar = arabicSign();
    ctx.fillStyle = "#e8f6ee";
    ctx.font = `700 34px ${ar}`;
    ctx.fillText("محطة وقود", 128, 58);
    ctx.strokeStyle = "rgba(232,246,238,0.45)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(24, 76);
    ctx.lineTo(232, 76);
    ctx.stroke();
    const row = (y: number, grade: string, fils: number, tint: string) => {
      ctx.fillStyle = tint;
      ctx.font = `700 76px ${ar}`;
      ctx.fillText(arabicNumber(+grade), 76, y);
      ctx.fillStyle = "#fff6cf";
      ctx.font = `700 84px ${ar}`;
      ctx.fillText(arabicNumber(fils), 176, y);
    };
    row(180, "91", 85, "#8fe3b0");
    row(300, "95", 105, "#ffd27a");
    ctx.fillStyle = "rgba(232,246,238,0.8)";
    ctx.font = `600 30px ${ar}`;
    ctx.fillText("فلس / لتر", 128, 372);
    ctx.direction = "ltr";
    ctx.fillStyle = "rgba(232,246,238,0.55)";
    ctx.font = `600 26px ${latinDisplay()}`;
    ctx.fillText("FILS PER LITRE", 128, 412);
    ctx.fillText("24 HOURS", 128, 456);
  });
}

/**
 * A petrol station.
 *
 * Built the way the ones on the ring roads are: a wide concrete apron
 * set back off the carriageway, a flat canopy on four columns with its
 * whole underside lit, two pump islands beneath it, a kiosk at the back,
 * and the price board out at the kerb where you can read it in time to
 * decide.
 *
 * The lit soffit is the part that matters at night. A forecourt is the
 * brightest thing on a dark road by a wide margin — that is what makes
 * one visible from far enough away to be a decision rather than a
 * surprise — so the canopy underside is emissive rather than lit, and it
 * throws a pool onto the apron.
 *
 * None of these materials is registered anywhere by hand. buildWorld
 * already walks the scene and sorts emissive materials into two buckets
 * by intensity: at or below 2.0 is a lamp that follows the sun, above it
 * is something lit around the clock. The soffit sits at 2.2 because a
 * Kuwaiti forecourt canopy genuinely is lit at noon, and the pumps, the
 * price board and the kiosk window sit below the line because they are
 * not. Pushing them into the window-lighting list as well — which is
 * what the first version did — hands the soffit to a second controller
 * that pins it to 1.15 after dark, and the brightest thing on the road
 * quietly stops being bright.
 *
 * Laid out with +Z along the road and +X out toward the kerb — which is
 * to say the pumps sit at positive X and the kiosk behind them at
 * negative X, furthest from the traffic.
 *
 * That sign is worth stating because it is not the obvious one. Rotating
 * a group by atan2(tangent.x, tangent.z) maps its local +X onto the
 * LEFT of travel, not the right: `sideAt` is tangent x up, and the
 * rotation sends (1,0,0) to the negative of it. Built the intuitive way
 * round, the station comes out mirrored — the kiosk between the road and
 * the pumps, and the price board hidden behind the canopy where nobody
 * can read it. Which is exactly how it first came out.
 */
/**
 * The mini-market's fascia sign, Arabic over Latin.
 *
 * Drawn rather than typed into geometry because it is a lit box on a
 * green band, and the one thing that has to be right is that the Arabic
 * is set as Arabic — the same rule the rest of this game's signage
 * follows. `arabicSign()` is the stack the road signs already use, so
 * the shop matches the world it stands in rather than looking like a
 * different game.
 */
let storeSignTex: THREE.CanvasTexture | null = null;
function storeSignTexture(): THREE.CanvasTexture {
  if (storeSignTex) return storeSignTex;
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 80;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 40px ${arabicSign()}`;
  ctx.fillText("بقالة المحطة", c.width * 0.31, c.height * 0.5);
  ctx.font = `700 34px ${latinDisplay()}`;
  ctx.letterSpacing = "6px";
  ctx.fillText("MINI MARKET", c.width * 0.71, c.height * 0.52);
  storeSignTex = new THREE.CanvasTexture(c);
  storeSignTex.colorSpace = THREE.SRGBColorSpace;
  storeSignTex.anisotropy = 8;
  return storeSignTex;
}

function fuelStation(): THREE.Group {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({
    map: concreteTexture(),
    color: 0x9a9a94,
    roughness: 0.92,
  });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.45, metalness: 0.35 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x0f6b3f, roughness: 0.5 });

  // Apron. Sits a hair above the ground plane so it reads as poured
  // concrete rather than z-fighting with the sand.
  // 30 m rather than 22, and pushed back away from the road: the site
  // now carries a shop and a row of parked cars behind the pumps, and
  // the old apron ended eleven metres out, which is where the shop's
  // back wall would have stood in the sand.
  const apron = new THREE.Mesh(new THREE.BoxGeometry(30, 0.16, 40), concrete);
  apron.position.set(-4, 0.08, 0);
  apron.receiveShadow = true;
  g.add(apron);

  // Canopy: roof slab, fascia band, and a soffit that is the light.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(16, 0.7, 24), steel);
  roof.position.set(2.5, 6.6, 0);
  g.add(roof);
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(16.4, 1.1, 24.4), trim);
  fascia.position.set(2.5, 5.95, 0);
  g.add(fascia);
  const soffitMat = new THREE.MeshStandardMaterial({
    color: 0xf6f9ff,
    emissive: 0xdfeaff,
    emissiveIntensity: 2.2,
    roughness: 0.9,
  });
  const soffit = new THREE.Mesh(new THREE.PlaneGeometry(15.4, 23.4), soffitMat);
  soffit.rotation.x = Math.PI / 2;
  soffit.position.set(2.5, 6.2, 0);
  g.add(soffit);
  // The pool the canopy throws down. Additive, so it brightens the
  // concrete instead of painting a grey disc onto it.
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 25),
    new THREE.MeshBasicMaterial({
      map: poolGlowTexture(),
      color: 0xdfeaff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(2.5, 0.2, 0);
  g.add(pool);
  for (const [cx, cz] of [
    [9.4, -9.8],
    [9.4, 9.8],
    [-4.4, -9.8],
    [-4.4, 9.8],
  ]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.85, 6, 0.85), steel);
    col.position.set(cx, 3, cz);
    col.castShadow = true;
    g.add(col);
  }

  // Two pump islands, three pumps a side.
  const pumpBody = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.55 });
  const pumpFace = new THREE.MeshStandardMaterial({
    color: 0x123a2a,
    emissive: 0x1d6a48,
    emissiveIntensity: 0.9,
    roughness: 0.4,
  });
  for (const ix of [7, 1.5]) {
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.28, 15), concrete);
    kerb.position.set(ix, 0.3, 0);
    g.add(kerb);
    for (const pz of [-5.4, 0, 5.4]) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 1.5), pumpBody);
      body.position.set(ix, 1.39, pz);
      body.castShadow = true;
      g.add(body);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.62), pumpFace);
      face.position.set(ix + 0.56, 1.72, pz);
      face.rotation.y = Math.PI / 2;
      g.add(face);
      const back = face.clone();
      back.position.x = ix - 0.56;
      back.rotation.y = -Math.PI / 2;
      g.add(back);
    }
  }

  // ------------------------------------------------- the mini-market
  //
  // This was a kiosk: a 5.4 m box with an emissive rectangle stuck on the
  // front standing in for a window. It read as a shed with a light in it,
  // because that is what it was — the "glass" was opaque, so there was
  // nothing behind it to see and nothing the light was coming from.
  //
  // A petrol station on this road has a supermarket in it, and the shop
  // is the only part of the site a player can look INTO. So it is built
  // as a room rather than as a facade: walls, a floor, a ceiling that is
  // the light, shelves with stock on them, and a counter by the door —
  // then real transparent glass across the front. The interior is what
  // makes it a shop; the glass only lets you see it.
  //
  // Everything here is laid out from the front face at x = -9, which is
  // the one line the parking, the footway and the bollards all measure
  // from. Local +X is toward the road, so the shop faces the pumps.
  {
    const FRONT = -9;      // the glazed face
    const DEPTH = 8;       // back wall at -17
    const WIDTH = 15;      // along the road
    const HEIGHT = 4.6;
    const MID = FRONT - DEPTH / 2;
    const FLOOR = 0.16;

    const store = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe4e6ea, roughness: 0.8 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xd8dcE2, roughness: 0.35 });

    // The room. Built as separate walls rather than one box, because a
    // box has a front face and the whole point is that there is not one.
    const floor = new THREE.Mesh(new THREE.BoxGeometry(DEPTH, 0.12, WIDTH), floorMat);
    floor.position.set(MID, FLOOR + 0.06, 0);
    store.add(floor);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.3, HEIGHT, WIDTH), wallMat);
    back.position.set(FRONT - DEPTH, FLOOR + HEIGHT / 2, 0);
    back.castShadow = true;
    store.add(back);
    for (const sz of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(DEPTH, HEIGHT, 0.3), wallMat);
      side.position.set(MID, FLOOR + HEIGHT / 2, (sz * WIDTH) / 2);
      side.castShadow = true;
      store.add(side);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(DEPTH + 0.6, 0.4, WIDTH + 0.6), wallMat);
    roof.position.set(MID, FLOOR + HEIGHT + 0.2, 0);
    roof.castShadow = true;
    store.add(roof);
    // The fascia band, in the brand's green, with the sign on its face.
    const fascia = new THREE.Mesh(
      new THREE.BoxGeometry(DEPTH + 0.8, 1.05, WIDTH + 0.8),
      trim
    );
    fascia.position.set(MID, FLOOR + HEIGHT + 0.85, 0);
    store.add(fascia);
    const signMat = new THREE.MeshStandardMaterial({
      map: storeSignTexture(),
      transparent: true,
      emissive: 0xffffff,
      emissiveMap: storeSignTexture(),
      emissiveIntensity: 1.35,
      roughness: 0.5,
      fog: false,
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.86), signMat);
    sign.position.set(FRONT + 0.42, FLOOR + HEIGHT + 0.85, 0);
    sign.rotation.y = Math.PI / 2;
    store.add(sign);

    // The ceiling IS the light. A shop at night is lit by a grid of
    // fluorescents and reads from outside as an even white glow with
    // shelves silhouetted against it, so this is a bright emissive plane
    // rather than a point light: it costs nothing per material, and a
    // real light inside a closed room lights nothing else anyway.
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(DEPTH - 0.4, WIDTH - 0.4),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xf4f8ff,
        emissiveIntensity: 2.4,
        roughness: 1,
        fog: false,
        side: THREE.DoubleSide,
      })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(MID, FLOOR + HEIGHT - 0.12, 0);
    store.add(ceiling);

    // Gondolas, running back from the door so the aisles read as aisles.
    // The stock is a band of colour along the top of each run: at this
    // distance a shelf of goods is a stripe, and modelling tins would be
    // a lot of triangles nobody can resolve through a window.
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.7 });
    const stockMat = new THREE.MeshStandardMaterial({
      color: 0xc8452f,
      emissive: 0x5a1c12,
      emissiveIntensity: 0.5,
      roughness: 0.75,
    });
    const stockAlt = new THREE.MeshStandardMaterial({
      color: 0x2f6fc8,
      emissive: 0x12305a,
      emissiveIntensity: 0.5,
      roughness: 0.75,
    });
    for (const [i, gz] of [-4.6, 0, 4.6].entries()) {
      const run = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.75, 0.95), shelfMat);
      run.position.set(MID - 0.4, FLOOR + 0.12 + 0.875, gz);
      store.add(run);
      for (const [j, sy] of [0.55, 1.05, 1.55].entries()) {
        const band = new THREE.Mesh(
          new THREE.BoxGeometry(5.0, 0.28, 1.0),
          (i + j) % 2 ? stockMat : stockAlt
        );
        band.position.set(MID - 0.4, FLOOR + 0.12 + sy, gz);
        store.add(band);
      }
    }
    // Chiller cabinets along the back wall — the lit glass doors are the
    // brightest thing in a shop like this and read straight through the
    // front window.
    const chiller = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 2.1, 11),
      new THREE.MeshStandardMaterial({
        color: 0xdfeaff,
        emissive: 0xbcd8ff,
        emissiveIntensity: 1.5,
        roughness: 0.35,
      })
    );
    chiller.position.set(FRONT - DEPTH + 0.6, FLOOR + 0.12 + 1.05, 0);
    store.add(chiller);
    // The counter, beside the door where a till actually stands.
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.05, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x1f6b45, roughness: 0.55 })
    );
    counter.position.set(FRONT - 2.1, FLOOR + 0.12 + 0.525, 3.1);
    store.add(counter);

    // The shopfront. Real glass, real transparency — this is the whole
    // reason the room above exists.
    const shopGlass = new THREE.MeshPhysicalMaterial({
      color: 0xdfe9f5,
      metalness: 0,
      roughness: 0.06,
      transmission: 0.82,
      thickness: 0.02,
      transparent: true,
      opacity: 0.42,
      envMapIntensity: 1.1,
    });
    const DOOR = 2.4;
    const GLASS_Y0 = FLOOR + 0.36;
    const GLASS_Y1 = FLOOR + 3.5;
    const GH = GLASS_Y1 - GLASS_Y0;
    // Two runs of glazing, left and right of the entrance.
    for (const sz of [-1, 1]) {
      const w = WIDTH / 2 - DOOR / 2;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, GH), shopGlass);
      pane.position.set(FRONT + 0.02, (GLASS_Y0 + GLASS_Y1) / 2, sz * (DOOR / 2 + w / 2));
      pane.rotation.y = Math.PI / 2;
      store.add(pane);
    }
    // Stall riser under the glass, and the mullions that divide it.
    const riser = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, WIDTH), trim);
    riser.position.set(FRONT, FLOOR + 0.18, 0);
    store.add(riser);
    const mullionMat = new THREE.MeshStandardMaterial({
      color: 0xb9bfc6,
      roughness: 0.4,
      metalness: 0.55,
    });
    for (const mz of [-7.4, -5.2, -3.0, -1.2, 1.2, 3.0, 5.2, 7.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, GH, 0.14), mullionMat);
      post.position.set(FRONT + 0.03, (GLASS_Y0 + GLASS_Y1) / 2, mz);
      store.add(post);
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, WIDTH), mullionMat);
    head.position.set(FRONT + 0.03, GLASS_Y1, 0);
    store.add(head);
    // The doorway itself: a frame with the shop's light spilling out of
    // it onto the footway, which is what an open door looks like at 2am.
    const doorGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(DOOR - 0.2, GH - 0.1),
      new THREE.MeshStandardMaterial({
        color: 0xfff6e2,
        emissive: 0xffeec4,
        emissiveIntensity: 1.15,
        transparent: true,
        opacity: 0.5,
        roughness: 0.4,
        fog: false,
      })
    );
    doorGlow.position.set(FRONT + 0.04, (GLASS_Y0 + GLASS_Y1) / 2, 0);
    doorGlow.rotation.y = Math.PI / 2;
    store.add(doorGlow);

    // Bollards. Every forecourt shop has them and they are there for a
    // reason: the thing parked nose-on to the window is a car.
    const bollardMat = new THREE.MeshStandardMaterial({ color: 0xf5b301, roughness: 0.6 });
    for (const bz of [-6.2, -3.4, 3.4, 6.2]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.95, 8), bollardMat);
      b.position.set(FRONT + 0.85, FLOOR + 0.47, bz);
      b.castShadow = true;
      store.add(b);
    }
    // Gas cylinders in a cage at the end of the frontage, which is where
    // they live on every station in the country.
    const cage = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.9, 2.6),
      new THREE.MeshStandardMaterial({
        color: 0x6f767e,
        roughness: 0.7,
        metalness: 0.4,
        wireframe: true,
      })
    );
    cage.position.set(FRONT + 0.9, FLOOR + 0.95, -8.9);
    store.add(cage);
    for (const cz of [-9.5, -8.9, -8.3]) {
      const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.17, 1.2, 8),
        new THREE.MeshStandardMaterial({ color: 0xc8452f, roughness: 0.6 })
      );
      bottle.position.set(FRONT + 0.9, FLOOR + 0.6, cz);
      store.add(bottle);
    }

    store.position.y = 0;
    g.add(store);

    // ------------------------------------------------------- parking
    //
    // Six bays between the shop and the pumps, nose-in to the window.
    // A forecourt without them is a place you can only refuel, and the
    // point of putting a supermarket on it is that people stop and go
    // inside — so there has to be somewhere to leave the car that is not
    // the pump island.
    const BAY_W = 2.6;          // across, along the road
    const BAY_D = 4.8;          // deep, away from the shop
    const BAY_X0 = FRONT + 1.2; // a footway's width off the glass
    const BAYS = 6;
    const paintMat = new THREE.MeshStandardMaterial({
      // Road paint's white, not a brighter one of its own (MARKINGS.paint).
      color: MARKINGS.paint.white,
      emissive: 0x8f8f88,
      emissiveIntensity: 0.35,
      roughness: 0.6,
    });
    const span = BAYS * BAY_W;
    for (let i = 0; i <= BAYS; i++) {
      const lz = -span / 2 + i * BAY_W;
      const lineGeo = new THREE.BoxGeometry(BAY_D, 0.02, 0.12);
      const line = new THREE.Mesh(lineGeo, paintMat);
      line.position.set(BAY_X0 + BAY_D / 2, 0.17, lz);
      g.add(line);
    }
    // Wheel stops at the head of each bay, and one bay marked out for a
    // driver who needs the door width — nearest the door, as it should be.
    const stopMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.9 });
    const blueMat = new THREE.MeshStandardMaterial({
      color: 0x1f5fbf,
      emissive: 0x0d2a55,
      emissiveIntensity: 0.4,
      roughness: 0.7,
    });
    for (let i = 0; i < BAYS; i++) {
      const cz = -span / 2 + BAY_W * (i + 0.5);
      const stop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 1.7), stopMat);
      stop.position.set(BAY_X0 + 0.4, 0.22, cz);
      g.add(stop);
      if (i === 2) {
        const pad = new THREE.Mesh(
          new THREE.PlaneGeometry(BAY_D - 0.3, BAY_W - 0.2),
          blueMat
        );
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(BAY_X0 + BAY_D / 2, 0.175, cz);
        g.add(pad);
      }
    }
  }

  // Price board at the kerb, facing oncoming traffic on both sides.
  const board = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4.4, 8), steel);
  post.position.y = 2.2;
  board.add(post);
  const priceMat = new THREE.MeshStandardMaterial({
    map: pumpPriceTexture(),
    emissive: 0x8a8a8a,
    roughness: 0.6,
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.6), priceMat);
  plate.position.y = 6.1;
  board.add(plate);
  const plateBack = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.6), priceMat);
  plateBack.position.y = 6.1;
  plateBack.rotation.y = Math.PI;
  board.add(plateBack);
  board.position.set(10.2, 0.16, -13);
  board.rotation.y = Math.PI / 2;
  g.add(board);

  g.name = "fuel-station";
  return g;
}

/** The painter's fascia sign, Arabic over Latin — the same rule as the
 *  mini-market's: the Arabic is set as Arabic. */
let paintSignTex: THREE.CanvasTexture | null = null;
function paintSignTexture(): THREE.CanvasTexture {
  if (paintSignTex) return paintSignTex;
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 80;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 40px ${arabicSign()}`;
  ctx.fillText("صبغ سيارات", c.width * 0.31, c.height * 0.5);
  ctx.font = `700 34px ${latinDisplay()}`;
  ctx.letterSpacing = "6px";
  ctx.fillText("PAINT SHOP", c.width * 0.71, c.height * 0.52);
  paintSignTex = new THREE.CanvasTexture(c);
  paintSignTex.colorSpace = THREE.SRGBColorSpace;
  paintSignTex.anisotropy = 8;
  return paintSignTex;
}

/**
 * The painter's price board: what a respray costs, from the plainest
 * colour to the dearest. Read off the catalogue rather than typed here,
 * so the board and the picker can never disagree.
 */
function paintPriceTexture(minKd: number, maxKd: number): THREE.CanvasTexture {
  return textTexture(256, 512, (ctx) => {
    ctx.fillStyle = "#12264a";
    ctx.fillRect(0, 0, 256, 512);
    ctx.strokeStyle = "#eef2fb";
    ctx.lineWidth = 7;
    ctx.strokeRect(9, 9, 238, 494);
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    const ar = arabicSign();
    ctx.fillStyle = "#eef2fb";
    ctx.font = `700 34px ${ar}`;
    ctx.fillText("صبغ سيارات", 128, 58);
    ctx.strokeStyle = "rgba(238,242,251,0.45)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(24, 76);
    ctx.lineTo(232, 76);
    ctx.stroke();
    const row = (y: number, word: string, kd: number, tint: string) => {
      ctx.fillStyle = "rgba(238,242,251,0.8)";
      ctx.font = `600 30px ${ar}`;
      ctx.fillText(word, 52, y);
      ctx.fillStyle = tint;
      ctx.font = `700 76px ${ar}`;
      ctx.fillText(arabicNumber(kd), 160, y);
    };
    row(180, "من", minKd, "#9fd3ff");
    row(300, "إلى", maxKd, "#ffd27a");
    ctx.fillStyle = "rgba(238,242,251,0.8)";
    ctx.font = `600 30px ${ar}`;
    ctx.fillText("دينار", 128, 372);
    ctx.direction = "ltr";
    ctx.fillStyle = "rgba(238,242,251,0.55)";
    ctx.font = `600 26px ${latinDisplay()}`;
    ctx.fillText("KD PER RESPRAY", 128, 412);
    ctx.fillText("24 HOURS", 128, 456);
  });
}

// onForecourt lives in markings.ts now: the buildings ask it whether a
// block would stand on a forecourt, the street paint asks whether a
// centre line would be buried under one, and the verge asks whether a
// bed would stand on one (shrubs.ts layoutVerge, bound to the track) —
// one rule. Re-exported here for tests/shrubs.mjs.
export { onForecourt };

// ------------------------------------------------- what stands on the verge
//
// The band the shrub beds are planted in — halfWidthAt + 2.1 to + 3.95
// — is not empty, and the old planting never asked what else was in it.
// Measured on the real Track it put 109-126 plants on cross-street
// pavement, 9-11 on the station and paint-shop aprons, and plants in
// among the inland palms, the start-line crew, the plaza floodlights and
// spectators and the Love Street sign posts. The streets and aprons are
// rules layoutVerge applies itself; the things below are points, and
// the tables are hoisted out of the blocks that build them so that the
// block and the beds read the SAME numbers rather than two copies.

/** The start-line crew: (s, metres beyond ROAD_HALF_WIDTH), along the
 *  shoulder opposite the flag. */
const START_CREW_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-9, 2.6],
  [-4.5, 3.4],
  [3.5, 2.8],
  [8.5, 3.6],
];

// The plaza's floodlight masts are PLAZA_FLOODLIGHTS, exported below
// with the other fixtures the palms keep clear of.

/** The plaza crowd, in the same terms. */
const PLAZA_SPECTATORS: ReadonlyArray<readonly [number, number]> = [
  [-24, 3.2],
  [-20.5, 4.1],
  [21, 3.4],
  [24.5, 3.9],
];

/** The Love Street boards' posts stand this far off the centreline. */
const LOVE_SIGN_LAT = ROAD_HALF_WIDTH + 2.0;

/** Bend chevrons: one board every `every` metres through a bend, its
 *  post `lat` beyond halfWidthAt on the outside, the board `boardHalf`
 *  either side of the post — ACROSS the verge, since it faces the
 *  oncoming traffic. */
const CHEVRON = { every: 26, lat: 1.9, boardHalf: 0.8 };

/**
 * Where the road actually turns, as clusters of sharp curvature.
 *
 * The geometry is measured, not guessed: the sharpest sweep is the
 * Ras Al-Ard point at radius ≈178 m, with lesser curves at the Kuwait
 * Towers hairpin and the city return — so the threshold sits at
 * R < 260 m and everything gentler stays clean. The chevrons and the
 * braking rubber are built on these, and the verge steps round the
 * boards.
 */
function bendClusters(track: Track, L: number): Array<{ from: number; to: number; right: boolean }> {
  const t0 = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const kappaAt = (s: number) => {
    track.tangentAt(s - 14, t0);
    track.tangentAt(s + 14, t1);
    return { k: t0.angleTo(t1) / 28, right: t0.x * t1.z - t0.z * t1.x > 0 };
  };
  const THRESH = 1 / 260;
  type Cluster = { from: number; to: number; right: boolean };
  const clusters: Cluster[] = [];
  let cur: Cluster | null = null;
  for (let s = 0; s < L; s += 10) {
    const { k, right } = kappaAt(s);
    if (k <= THRESH) continue;
    if (cur && s - cur.to <= 40 && cur.right === right) cur.to = s;
    else clusters.push((cur = { from: s, to: s, right }));
  }
  // A bend straddling the lap seam shows up as two clusters — rejoin it
  if (clusters.length > 1) {
    const first = clusters[0];
    const last = clusters[clusters.length - 1];
    if (first.from <= 40 && L - last.to <= 40 && first.right === last.right) {
      first.from = last.from - L;
      clusters.pop();
    }
  }
  return clusters;
}

/**
 * A palm trunk's footprint radius, for the verge, metres. 0.3 at the
 * foot × 1.18, the tallest grow, is 0.36 today; 0.45 leaves room for a
 * flared foot without the beds having to be told.
 */
const PALM_FOOT_R = 0.45;

/**
 * Everything already standing in the verge band, as (s, lat, r), for
 * layoutVerge to step round.
 *
 * THE PALMS COME FROM THE SEEDS. palmSeeds is what the palm block hands
 * the spring field — one entry per corniche palm, at its trunk's foot —
 * and that is the contract read here: wherever and however the palms
 * are placed, a seed has to stand where its trunk stands, or the wake
 * would sway a crown from a metre beside its own tree. Reading it back
 * rather than re-deriving it from the palm loop's draws means the palms
 * can be re-placed without this function knowing. The lateral is
 * measured against the track at the seed's own s.
 *
 * The flag masts are the one entry written out rather than shared: the
 * flag block's rule (Kuwait at s = 0, the rest at −26 − 13i, all at
 * −(ROAD_HALF_WIDTH + 4), pole radius 0.0129 × its height at the foot).
 * tests/planting.mjs measures every bed against the 'flag-mast' groups
 * actually standing in the scene, so the two cannot drift apart quietly.
 *
 * Exported for tests/shrubs.mjs, which lays the real verge out against
 * it under node.
 */
export function vergeFurniture(track: Track, palms: readonly PlantSeed[]): VergeAvoid[] {
  const L = track.length;
  const out: VergeAvoid[] = [];
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (const seed of palms) {
    track.pointAt(seed.s, p);
    track.sideAt(seed.s, side);
    out.push({ s: seed.s, lat: (seed.x - p.x) * side.x + (seed.z - p.z) * side.z, r: PALM_FOOT_R });
  }
  for (const s of [LOVE_STREET.from, LOVE_STREET.to]) out.push({ s, lat: LOVE_SIGN_LAT, r: 0.14 });
  for (const [ds, latPad] of START_CREW_SPOTS) {
    out.push({ s: track.wrap(ds), lat: ROAD_HALF_WIDTH + latPad, r: 0.6 });
  }
  for (const [ds, latPad] of PLAZA_FLOODLIGHTS) {
    const s = DRIFT_PLAZA.s + ds;
    out.push({ s, lat: track.halfWidthAt(s) + latPad, r: 0.4 });
  }
  for (const [ds, latPad] of PLAZA_SPECTATORS) {
    const s = DRIFT_PLAZA.s + ds;
    out.push({ s, lat: track.halfWidthAt(s) + latPad, r: 0.6 });
  }
  for (const c of bendClusters(track, L)) {
    const outside = c.right ? -1 : 1;
    for (let s = c.from; s <= c.to + 1; s += CHEVRON.every) {
      out.push({ s: track.wrap(s), lat: outside * (track.halfWidthAt(s) + CHEVRON.lat), r: CHEVRON.boardHalf });
    }
  }
  out.push({ s: 0, lat: -(ROAD_HALF_WIDTH + 4), r: 14 * 0.0129 });
  for (let i = 0; i < FLAG_IDS.length - 1; i++) {
    out.push({ s: track.wrap(-26 - i * 13), lat: -(ROAD_HALF_WIDTH + 4), r: 10 * 0.0129 });
  }
  return out;
}

/**
 * The painter's.
 *
 * A gate you drive through, an open-fronted bay you stop in, and a
 * board at the kerb that says what a respray costs. Built in the same
 * frame as the petrol station — +Z along the road, +X toward it — for
 * the same reason its doc block spells out: the placement rotation maps
 * local +X onto the LEFT of travel, so anything authored the intuitive
 * way round comes out mirrored.
 *
 * Nothing solid sits closer to the road than x 10.5 (lat 8.5): the
 * through lanes end at lat 7, and the road only opens past them here.
 * The car's lane through the gate runs x 2..10.5, centred on lat 12.75,
 * and the wing walls stop at lat 17 so it is open at both ends — the bay
 * is somewhere you pull through, not somewhere you reverse out of.
 *
 * The soffit sits at 2.2 for the reason the canopy's does: above the
 * 2.0 line it is lit around the clock instead of following the sun, and
 * a painter's bay with its lights on is what makes the gate readable at
 * night from far enough away to slow down for it.
 */
function paintShop(): THREE.Group {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({
    map: concreteTexture(),
    color: 0x9a9a94,
    roughness: 0.92,
  });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.45, metalness: 0.35 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1f3f7a, roughness: 0.5 });
  const booth = new THREE.MeshStandardMaterial({ color: 0xc3c9d2, roughness: 0.85 });

  const apron = new THREE.Mesh(new THREE.BoxGeometry(24, 0.16, 48), concrete);
  apron.position.set(-1.5, 0.08, 0);
  apron.receiveShadow = true;
  g.add(apron);

  // The gate: two columns and a lintel at the entrance, sign on the face
  // the traffic sees.
  for (const cx of [2, 10.5]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6, 0.9), trim);
    col.position.set(cx, 3, -16);
    col.castShadow = true;
    g.add(col);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(9.5, 1.2, 1.2), trim);
  lintel.position.set(6.25, 6.3, -16);
  g.add(lintel);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 0.7),
    new THREE.MeshStandardMaterial({
      map: paintSignTexture(),
      emissive: 0xffffff,
      emissiveMap: paintSignTexture(),
      emissiveIntensity: 1.6,
      transparent: true,
      roughness: 0.6,
    })
  );
  sign.position.set(6.25, 6.3, -16.62);
  sign.rotation.y = Math.PI;
  g.add(sign);

  // The bay: a back wall, two wing walls, a roof, and the soffit that is
  // the light.
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 18), booth);
  back.position.set(-1.5, 2.5, 0);
  g.add(back);
  for (const wz of [-9, 9]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(3.5, 5, 0.3), booth);
    wing.position.set(0.25, 2.5, wz);
    g.add(wing);
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5, 0.6), steel);
    col.position.set(10.5, 2.5, wz);
    col.castShadow = true;
    g.add(col);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(12, 0.6, 18), steel);
  roof.position.set(4.5, 5.3, 0);
  g.add(roof);
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.9, 18.4), trim);
  fascia.position.set(4.5, 4.75, 0);
  g.add(fascia);
  const soffitMat = new THREE.MeshStandardMaterial({
    color: 0xf6f9ff,
    emissive: 0xe4ecff,
    emissiveIntensity: 2.2,
    roughness: 0.9,
  });
  const soffit = new THREE.Mesh(new THREE.PlaneGeometry(11.4, 17.4), soffitMat);
  soffit.rotation.x = Math.PI / 2;
  soffit.position.set(4.5, 4.28, 0);
  g.add(soffit);
  // Spray lamps: four tubes under the soffit, brighter than it.
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xf4f7ff,
    emissiveIntensity: 2.3,
    roughness: 0.4,
  });
  for (const lx of [3, 8.5]) {
    for (const lz of [-4, 4]) {
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 6), lampMat);
      tube.position.set(lx, 4.2, lz);
      g.add(tube);
    }
  }
  // The pool the bay throws down. Additive, like the canopy's.
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 18),
    new THREE.MeshBasicMaterial({
      map: poolGlowTexture(),
      color: 0xe4ecff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(4.5, 0.2, 0);
  g.add(pool);

  // The bay marked on the floor: where the picker is offered is where
  // the lines say to stop. Road paint's white (MARKINGS.paint).
  const lineMat = new THREE.MeshStandardMaterial({
    color: MARKINGS.paint.white,
    emissive: 0x8f8f88,
    emissiveIntensity: 0.35,
    roughness: 0.6,
  });
  for (const lx of [3, 9.5]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 6), lineMat);
    line.position.set(lx, 0.17, 0);
    g.add(line);
  }
  for (const lz of [-3, 3]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.02, 0.12), lineMat);
    line.position.set(6.25, 0.17, lz);
    g.add(line);
  }

  // Price board at the kerb, ahead of the gate, facing both ways.
  const prices = PARTS.filter((p) => p.cat === "paint" && p.price > 0).map((p) => p.price);
  const board = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4.4, 8), steel);
  post.position.y = 2.2;
  board.add(post);
  const priceMat = new THREE.MeshStandardMaterial({
    map: paintPriceTexture(Math.min(...prices), Math.max(...prices)),
    emissive: 0x8a8a8a,
    roughness: 0.6,
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.6), priceMat);
  plate.position.y = 6.1;
  board.add(plate);
  const plateBack = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.6), priceMat);
  plateBack.position.y = 6.1;
  plateBack.rotation.y = Math.PI;
  board.add(plateBack);
  board.position.set(10.2, 0.16, -24);
  board.rotation.y = Math.PI / 2;
  g.add(board);

  g.name = "paint-shop";
  return g;
}

function lighthouse(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 2.1, 17, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.6 })
  );
  body.position.y = 8.5;
  g.add(body);
  const lamp = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 2.2, 8),
    new THREE.MeshStandardMaterial({ color: 0xff5544, emissive: 0xff3322, emissiveIntensity: 2.5, fog: false })
  );
  lamp.position.y = 18.1;
  g.add(lamp);
  return g;
}

/** Place an object beside the track: distance s along, `offset` metres right (+) or left (-). */
/**
 * Where each named landmark was placed, in metres from the start line.
 *
 * Recorded at build time rather than worked out afterwards from the
 * mesh: a landmark sits perpendicular to the road at an offset, so
 * recovering its `s` from its world position is a search that answers to
 * within a few metres and gets worse the further out the object is.
 * Green Island is 200 m offshore. Tests need the number that was USED.
 */
export const LANDMARK_S: Record<string, number> = {};

/**
 * What the landmarks are called.
 *
 * LANDMARK_S has only ever held ids and distances, because until now the
 * only thing that read it was a test checking a tower had been placed
 * where it was supposed to be. A map has to print them, and "al-hamra"
 * is not a name — so the ids get a table, in the order you pass them
 * driving a lap.
 *
 * Separate from LANDMARK_S rather than merged into it because the two
 * are known at different times: this is static, and the distances are
 * whatever buildWorld actually used, recorded as it places each one.
 */
export const LANDMARKS: Array<{ id: string; name: string; arabic: string }> = [
  { id: "green-island", name: "Green Island", arabic: "الجزيرة الخضراء" },
  { id: "kuwait-towers", name: "The Towers", arabic: "الأبراج" },
  { id: "salmiya-marina", name: "Salmiya Marina", arabic: "مارينا السالمية" },
  { id: "scientific-center", name: "Scientific Center", arabic: "المركز العلمي" },
  { id: "ras-al-ard-light", name: "Ras Al-Ard Light", arabic: "منارة رأس الأرض" },
  { id: "liberation-tower", name: "Liberation Tower", arabic: "برج التحرير" },
  { id: "al-hamra", name: "Al Hamra Tower", arabic: "برج الحمراء" },
];

/**
 * FLYOVERS — the road running under something.
 *
 * A Kuwaiti dual carriageway is not a ribbon between landmarks. The
 * Ring Roads cross each other and cross Gulf Road on bridges, and the
 * experience of driving one at night is punctuated by them: the world
 * closes over you for a second and a half, the lamps stop, the sound
 * changes, and then it opens again. The game had none — the road ran
 * from one landmark to the next with nothing above it at all — and
 * flat-out down a straight the absence reads as a road with no depth.
 *
 * Everything here is built for the ONE angle a driver ever sees it
 * from: the approach and the pass underneath. Nobody in this game will
 * ever look at a flyover from above, so the deck's top is a suggestion
 * and the SOFFIT — the underside, with its girder lines and its
 * expansion joint — is where the detail goes, because that is the face
 * that sweeps over the windscreen.
 *
 * The deck is skewed across the road rather than square to it, because
 * a grade separation almost never crosses at ninety degrees, and a
 * square one reads as a garden gate.
 */
const FLYOVERS: ReadonlyArray<{
  /** Metres along the lap. */
  s: number;
  /** Crossing angle, radians off perpendicular. */
  skew: number;
  /** How wide the crossing road's deck is, in metres. */
  deck: number;
  /**
   * A deeper structure: thicker deck, deeper girders, a warning beacon.
   *
   * This started life as `centrePier`, on the reasoning that a wide
   * crossing needs its span broken — which is true, and which put a
   * two-metre concrete column in the middle of a fourteen-metre
   * carriageway, because this road has no central reserve to put one
   * in. The car cannot hit it (the physics holds inside halfWidthAt and
   * scenery has no collider), so it would simply have driven through a
   * bridge pier at 200 km/h, five times a lap, for ever.
   *
   * A single span over a road this wide is carried on depth instead.
   */
  deep: boolean;
}> = [
  // Sharq, where the ring road drops onto the corniche.
  { s: 640, skew: 0.32, deck: 13, deep: false },
  // Salmiya, approaching the marina.
  { s: 2180, skew: -0.24, deck: 11, deep: false },
  // Shuwaikh, the industrial crossing — the widest of them.
  { s: 4180, skew: 0.18, deck: 19, deep: true },
  // Jahra Road, inland.
  { s: 6250, skew: -0.36, deck: 15, deep: true },
  // ...and one on the run back down to the line.
  { s: 7720, skew: 0.27, deck: 12, deep: false },
];

/** How far either side of a flyover the street lighting stops. A lamp
 *  column is 11.85 m tall (its lantern to 12.2 m, reaching 3.3 m toward
 *  the road) and a deck soffit is at 6.4 — a column under a bridge goes
 *  through it. Real lighting stops short of a structure and the
 *  structure carries its own.
 *
 *  30 m still covers the arm. A deck 15 m wide at a skew of 0.36 rad —
 *  Jahra Road, the worst of them — reaches 7.5 / cos 0.36 + y tan 0.36
 *  along the road from its centre at y metres off the centre line: 10.2 m
 *  under the lens at 5.8 m, 11.3 m at the column's foot at 8.6. Both a
 *  third of this. */
const FLYOVER_CLEAR = 30;

/** True if `s` is close enough to a flyover that a street pole would
 *  foul the deck. */
function underFlyover(track: Track, s: number): boolean {
  for (const f of FLYOVERS) {
    if (Math.abs(track.deltaAhead(f.s, s)) < FLYOVER_CLEAR) return true;
  }
  return false;
}

/**
 * The roadside fixtures' stations, named, because the palms now have to
 * agree with them.
 *
 * These were literals in the loops that build them — 42 m and lat 8.6
 * for the columns, every second cross street at 8.2 for the signals, 25 m
 * into a district and 8.5 either side for a gantry, -11 for the flag
 * masts — and the palm row was laid out without reference to any of
 * them. Its pitch (26.13 m) times nine is 235.2 m, which is the signal
 * pitch (235.9 m) to within a metre, so a palm stood 0-6 m from nearly
 * every one of the fifteen coastal signals, the 6.3 m arm running through
 * its crown; about fifteen of 131 crowns had a column, a signal, a gantry
 * or the flag mast inside them (palm.ts placePalms has the rule that
 * moves them). The loops read these now, so a fixture that moves takes
 * the palms' clearance with it.
 */
export const LAMP_COLUMNS = { spacing: 42, lat: ROAD_HALF_WIDTH + 1.6 } as const;
export const SIGNALS = { every: 2, poleLat: ROAD_HALF_WIDTH + 1.2 } as const;
export const GANTRY = {
  /** Metres into a district its sign hangs; the first district's hangs
   *  this far before the line instead. */
  lead: 25,
  finish: 60,
  postLat: ROAD_HALF_WIDTH + 1.2,
  beamHalf: ROAD_HALF_WIDTH + 1.5,
} as const;
/** Kuwait's flag at the line, the region's masts back down the corniche
 *  from it, all on the sea side. */
export const FLAG_MASTS = { lat: -(ROAD_HALF_WIDTH + 4), restFrom: -26, restEvery: 13 } as const;
/** The Sharq plaza's three floodlight masts: metres from the plaza centre
 *  along the road, and metres outside the tarmac edge. */
export const PLAZA_FLOODLIGHTS: ReadonlyArray<readonly [number, number]> = [
  [-46, 2.4],
  [0, 3.0],
  [46, 2.4],
];

/** Whether a street column stands at `s`: none in the tunnel, none under
 *  a flyover (see FLYOVER_CLEAR). */
function lampColumnStands(track: Track, s: number): boolean {
  const u = s / track.length;
  return !((u > TUNNEL_U.from - 0.004 && u < TUNNEL_U.to + 0.004) || underFlyover(track, s));
}

/**
 * Everything on the corniche's verges a palm crown must clear, for
 * placePalms: every standing lamp column, every signal pole, both posts
 * of every gantry, every flag mast, the plaza's floodlights, every cross
 * street (inland palms only — the sea side has none), and every flyover.
 *
 * The flyovers are the one addition to the brief, and not a small one:
 * two of the five cross the corniche (Sharq at 640 m, Salmiya at 2180),
 * their decks reach (hw + 13) / cos(skew) either side of the centre line
 * with the soffit at 6.4 m, and a crown sits 5.6-7.8 m up. The old row
 * put the inland palm at 627-633 m and the sea palm at 2169-2175 m under
 * a deck. A flyover keeps palms out of half its deck width along the
 * road, plus the deck's skew across the widest palm lateral, plus a
 * crown's reach.
 */
export function palmFixtures(track: Track): PalmFixture[] {
  const L = track.length;
  const out: PalmFixture[] = [];
  const columns = Math.floor(L / LAMP_COLUMNS.spacing);
  for (let i = 0; i < columns; i++) {
    const s = i * LAMP_COLUMNS.spacing;
    if (!lampColumnStands(track, s)) continue;
    out.push({ s, lat: (i % 2 === 0 ? 1 : -1) * LAMP_COLUMNS.lat, kind: "column" });
  }
  // The signals the world actually builds: the junction model's list
  // (markings.ts), which also skips the junctions inside a swell.
  for (const j of junctions(track, STREETS)) {
    if (!j.signalised) continue;
    const s = signalHeadS(j);
    out.push({ s, lat: SIGNALS.poleLat, kind: "signal" }, { s, lat: -SIGNALS.poleLat, kind: "signal" });
  }
  AREAS.forEach((_, i) => {
    const s = i === 0 ? L - GANTRY.finish : AREAS[i - 1].to + GANTRY.lead;
    out.push({ s, lat: GANTRY.beamHalf, kind: "gantry" }, { s, lat: -GANTRY.beamHalf, kind: "gantry" });
  });
  out.push({ s: 0, lat: FLAG_MASTS.lat, kind: "mast" });
  FLAG_IDS.filter((id) => id !== "kw").forEach((_, i) =>
    out.push({ s: track.wrap(FLAG_MASTS.restFrom - i * FLAG_MASTS.restEvery), lat: FLAG_MASTS.lat, kind: "mast" }));
  for (const [ds, pad] of PLAZA_FLOODLIGHTS) {
    const s = DRIFT_PLAZA.s + ds;
    out.push({ s, lat: track.halfWidthAt(s) + pad, kind: "floodlight" });
  }
  const crossCount = Math.round(L / STREETS.crossEvery);
  for (let i = 0; i < crossCount; i++) {
    const s = (i / crossCount) * L;
    out.push({ s, lat: track.halfWidthAt(s), kind: "street" });
  }
  for (const f of FLYOVERS) {
    const half =
      f.deck / 2 / Math.cos(f.skew) + PALM_PLACE.latMax * Math.tan(Math.abs(f.skew)) + PALM_PLACE.crownReach;
    out.push({ s: f.s, lat: 0, kind: "flyover", half });
  }
  return out;
}

function flyover(
  track: Track,
  spec: (typeof FLYOVERS)[number],
  concrete: THREE.CanvasTexture,
  beacons: THREE.MeshStandardMaterial[]
): THREE.Group {
  const g = new THREE.Group();
  const hw = track.halfWidthAt(spec.s);

  // Clearance to the soffit. 6.4 m: above every legal load and well
  // above the tallest thing in this game that can get under it, and low
  // enough that it fills the windscreen on the approach — which is the
  // whole effect.
  const SOFFIT = 6.4;
  // A longer clear span needs a deeper section to carry it, and depth is
  // the only lever left once a pier in the road is off the table.
  const THICK = spec.deep ? 1.7 : 1.15;

  // The deck has to clear the carriageway plus the verges plus the
  // piers, measured ALONG the skewed axis — a crossing at 20 degrees is
  // 6% longer than the road is wide, and cutting it to the road's width
  // leaves the deck ending in mid-air over the hard shoulder.
  const reach = (hw + 13) / Math.cos(spec.skew);

  const deckMat = new THREE.MeshStandardMaterial({
    map: concrete,
    color: 0x8a8f96,
    roughness: 0.92,
    metalness: 0.02,
  });
  // The underside is its own material and darker, because it is: a
  // soffit is in permanent shade and stained by fifty years of exhaust,
  // and giving it the deck's own concrete makes the bridge read like a
  // white plank floating over the road.
  const soffitMat = new THREE.MeshStandardMaterial({
    map: concrete,
    color: 0x4c5158,
    roughness: 1,
    metalness: 0,
  });
  const pierMat = new THREE.MeshStandardMaterial({
    map: concrete,
    color: 0x70757c,
    roughness: 0.95,
  });

  const cross = new THREE.Group();
  cross.rotation.y = spec.skew;
  g.add(cross);

  // --- The deck, and the soffit under it -------------------------------
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(reach * 2, THICK, spec.deck),
    deckMat
  );
  deck.position.y = SOFFIT + THICK / 2;
  deck.castShadow = true;
  deck.receiveShadow = true;
  cross.add(deck);

  // Girder lines: what you actually look at going under. Ribs running
  // the length of the span, spaced across the deck — more of them and
  // deeper on the wide crossings, which is how a single span over a
  // fourteen-metre carriageway is actually carried.
  const ribs = spec.deep ? 6 : 4;
  const ribDepth = spec.deep ? 0.95 : 0.62;
  for (let i = 0; i < ribs; i++) {
    const t = (i + 0.5) / ribs - 0.5;
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(reach * 2, ribDepth, spec.deck * (spec.deep ? 0.1 : 0.13)),
      soffitMat
    );
    rib.position.set(0, SOFFIT - ribDepth / 2, t * spec.deck * 0.84);
    cross.add(rib);
  }
  // The expansion joint: one dark line straight down the middle of the
  // soffit, and the single detail that makes a bridge read as two spans
  // meeting rather than as one slab.
  const joint = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.1, spec.deck),
    new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 1 })
  );
  joint.position.set(0, SOFFIT - 0.04, 0);
  cross.add(joint);

  // --- Under-deck lighting ---------------------------------------------
  //
  // FLYOVER_CLEAR stops the street columns 30 m either side of a deck,
  // because an 11.85 m column under a 6.4 m soffit grows through the bridge.
  // The comment there says "the structure carries its own". It did not,
  // and the result was the darkest place on the lap:
  //
  //   tools/shots/dark.mjs, standing under the Sharq crossing —
  //   36 of 160 tiles below the readable floor, median tile 0.073
  //   against 0.18 on open road, and the soffit itself an unbroken
  //   black band across the top third of the frame. The ribs and the
  //   expansion joint above are modelled in detail that nobody has
  //   ever seen, because nothing in this world lit them.
  //
  // A real underpass carries luminaires on the soffit, and they run
  // around the clock — an underpass is dark at noon. So this is a real
  // light rather than an emissive dressed up as one: emissive fixtures
  // would have put four bright rectangles on a black ceiling and left
  // the concrete, the piers and the road under them exactly as dark.
  //
  // One light per crossing. Five in the world, no shadows, static: the
  // shader cost of a light is paid by every material in the scene, and
  // a second one per bridge bought nothing the first had not.
  {
    const lampY = SOFFIT - ribDepth - 0.22;
    const fixtureMat = new THREE.MeshStandardMaterial({
      color: 0xf4f8ff,
      emissive: 0xdfeaff,
      emissiveIntensity: 1.5,
      fog: false,
    });
    // Four fixtures in a line ACROSS the road under the deck, which is
    // where you look when you are under one.
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4 - 0.5;
      const fix = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.13, 0.3), fixtureMat);
      fix.position.set(t * reach * 1.5, lampY, 0);
      cross.add(fix);
    }
    // Kept SHORT. At 130 over 42 m the first version reached 53 m up the
    // road to the previous viewpoint, and the auto-exposure — which
    // meters the whole frame — stopped down for it: the corniche
    // approach went from zero dark tiles to thirty-five, with nothing
    // about the corniche changed. An underpass light that is visible
    // from outside the underpass is not lighting the underpass, it is
    // moving the eye.
    const under = new THREE.PointLight(0xdce6ff, 62, 26, 1.7);
    under.position.set(0, lampY - 0.3, 0);
    g.add(under);
    // No painted pool on the asphalt under it, and that is a decision
    // rather than an omission. The street columns use one because their
    // light is faked — there is no point light on a lamp post in this
    // world, only a billboard. Here there IS a real light, and adding
    // the billboard on top of it laid a flat pale wash across the whole
    // lower frame that swallowed the lane markings and read as fog on
    // the road. Two overlapping additive circles cannot do falloff; the
    // light already does.
  }

  // --- Parapets, and the crossing road's own lighting -------------------
  for (const side of [-1, 1]) {
    const parapet = new THREE.Mesh(
      new THREE.BoxGeometry(reach * 2, 1.05, 0.42),
      deckMat
    );
    parapet.position.set(0, SOFFIT + THICK + 0.52, (side * spec.deck) / 2 - side * 0.21);
    cross.add(parapet);
  }
  // Columns along the deck, seen edge-on from below as a row of lights
  // crossing the sky. Sparse: five over the whole span.
  {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.7 });
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xf4f8ff,
      emissive: 0xdfeaff,
      emissiveIntensity: 2.6,
      fog: false,
    });
    for (let i = 0; i < 5; i++) {
      const x = (i / 4 - 0.5) * reach * 1.7;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 6, 6), poleMat);
      pole.position.set(x, SOFFIT + THICK + 3, spec.deck / 2 - 0.5);
      cross.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.18), headMat);
      head.position.set(x, SOFFIT + THICK + 6.3, spec.deck / 2 - 0.5);
      cross.add(head);
    }
  }

  // --- Piers -----------------------------------------------------------
  //
  // Outside the drivable width by a clear margin, because the physics
  // holds the car inside `halfWidthAt` and anything beyond it is scenery
  // the car can never reach. A pier the player could hit would need a
  // collider, and a bridge is not worth a new collision case.
  const pierX = (hw + 5.5) / Math.cos(spec.skew);
  const makePier = (x: number) => {
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.15, SOFFIT - 0.55, 12),
      pierMat
    );
    column.position.set(x, (SOFFIT - 0.55) / 2, 0);
    column.castShadow = true;
    cross.add(column);
    // The cap the deck sits on, wider than the column and slightly
    // proud of the deck edge.
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.55, spec.deck + 0.8),
      pierMat
    );
    cap.position.set(x, SOFFIT - 0.28, 0);
    cross.add(cap);
    // A plinth, so the column meets the ground on something rather than
    // growing out of the sand.
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 3.2), pierMat);
    plinth.position.set(x, 0.25, 0);
    cross.add(plinth);
  };
  makePier(-pierX);
  makePier(pierX);

  // --- What a driver actually sees on the approach ----------------------
  //
  // Hazard chevrons on the pier faces turned toward oncoming traffic,
  // and a height gauge on the leading edge of the deck. Both are the
  // things that catch a headlight from three hundred metres out, and
  // both are on real bridges for exactly that reason.
  {
    const chev = (pointRight: boolean) =>
      new THREE.MeshStandardMaterial({
        map: chevronTexture(pointRight),
        emissive: 0x555555,
        roughness: 0.7,
      });
    for (const side of [-1, 1]) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.5), chev(side > 0));
      // On the pier, on the face the driver is coming AT. The group is
      // turned so +z is the direction of travel, which puts the
      // approach side at -z — the first version hung both boards on the
      // back of the piers, where they were visible to nobody but the
      // rival's mirrors.
      board.position.set(side * pierX * Math.cos(spec.skew), 2.3, -(spec.deck / 2 + 1.4));
      board.rotation.y = Math.PI;
      g.add(board);
    }
    // The deck's leading edge, painted. A black-and-yellow band on the
    // beam is the last thing in frame before you are under it.
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(reach * 2, 0.34, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xf5b301, emissive: 0x3a2a00, roughness: 0.6 })
    );
    band.position.set(0, SOFFIT + 0.18, -(spec.deck / 2 + 0.06));
    cross.add(band);
  }

  // An aircraft-warning beacon on the tallest crossings, which is what
  // a lighting column on a bridge over a road near an airport carries.
  if (spec.deep) {
    const b = makeBeacon(beacons);
    b.position.set(0, SOFFIT + THICK + 7.2, spec.deck / 2 - 0.5);
    cross.add(b);
  }

  g.name = "flyover";
  return g;
}

function placeBeside(
  track: Track,
  obj: THREE.Object3D,
  s: number,
  offset: number,
  name?: string
) {
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();
  track.pointAt(s, p);
  track.sideAt(s, side);
  obj.position.set(p.x + side.x * offset, 0, p.z + side.z * offset);
  if (name) LANDMARK_S[name] = s;
}

export type SkyMode = "night" | "dawn";

export interface WorldHandle {
  /** Advance animated scenery (sea shimmer, tower beacons). */
  tick(dt: number): void;
  /** Repaint the world for midnight or the first light of dawn. */
  setSky(mode: SkyMode): void;
  /** Continuous time of day in hours, 0..24. Drives everything. */
  setTimeOfDay(hours: number): void;
  /** Turn the roadside crowd to watch the car at this world position. */
  setCrowdFocus(x: number, y: number, z: number, dt: number): void;
  /** How wet the road LOOKS, 0..1. Separate from how much rain is
   *  falling, because a road stays wet after the sky clears — which is
   *  the whole point of weather.ts holding wetness as a state. */
  setWetness(w: number): void;
  /** Rain on the screen, 0..1. */
  setRain(fall: number): void;
  /** Device pixels per CSS pixel — the stars are sized in the latter,
   *  and the engine is the only thing that knows the former. */
  setPixelRatio(ratio: number): void;
  /** Lean every roadside plant for this frame: wind, plus the wake of
   *  every car on the road. */
  solvePlants(dt: number, wakes: readonly Wake[]): void;
  /** The moon — the engine drives its shadow frustum along with the player. */
  moonLight: THREE.DirectionalLight;
  /** The weaker, cooler light opposite the key. Casts nothing. */
  fillLight: THREE.DirectionalLight;
  /** Sky dome, stars and moon disc — re-centred on the camera each frame
   *  so they can sit inside a tight far plane without ever clipping. */
  skyFollowers: THREE.Object3D[];
  /**
   * What the paint's reflection probe should see differently from the
   * camera (engine.renderProbeFace): the street-lamp lens material, which
   * the probe draws brighter, and the lamp coronas and glints, which it
   * does not draw at all. A point sprite is sized for the MAIN buffer's
   * height, so inside a cube face it comes out about four times too big
   * and smears every lamp across the paint.
   */
  probe: { readonly lampMat: THREE.MeshStandardMaterial | null; hide: THREE.Object3D[] };
  /** The ambient third tier, which setTimeOfDay recolours every hour. */
  hemiLight: THREE.HemisphereLight;
  /**
   * Where every lit street lantern's light comes from: the centre of each
   * lens's underside, 12.0 m up and 5.8 m off the centre line, one per
   * column that stands (none in the tunnel, none near a flyover).
   *
   * The road lighting is painted — additive pools and cones, not lights —
   * so nothing in the scene can be lit BY a lamp. The tyre smoke needs to
   * be, and this is how it knows where they are. Read-only: the lamps do
   * not move.
   */
  streetLamps: readonly THREE.Vector3[];
  /**
   * Where each lantern's light lands: the centre of its painted pool, on
   * the road, index for index with streetLamps. The engine aims a real
   * light from the one at the other, so the light on a car agrees with
   * the pool painted under it.
   */
  streetLampPools: readonly THREE.Vector3[];
  /** The photocell: 0 at noon, 1 after dark. */
  lampLevel(): number;
}

/** The night-sky dome's radius, m. The engine's reflection probe draws
 *  the same dome shrunk to fit its own far plane, so it needs this. */
export const SKY_DOME_RADIUS = 1900;

/** Pulsing red aircraft-warning beacon for tower tops. */
function makeBeacon(beacons: THREE.MeshStandardMaterial[]): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x330000,
    emissive: 0xff1a1a,
    emissiveIntensity: 2.5,
    fog: false,
  });
  beacons.push(mat);
  return new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), mat);
}

// Underpass on the Second Ring, TXR-style. It runs under the junction at
// 5000 m — which is the Shamiya/Mansuriya boundary, so it belongs to
// neither and is named after neither — rather than sitting anywhere
// convenient: the ring's
// junctions really are grade-separated, and the through lanes really do
// dive under the cross traffic. Metres in, fraction out — the fraction
// is what the ribbon and wall builders take, and it has to be recomputed
// from the lap rather than typed in, or the tunnel walks off its
// junction the next time the track changes length.
const TUNNEL_S = LAP.tunnel;
const TUNNEL_U = spanU(TUNNEL_S);

// The key light's strength through the day, and what the fill runs at
// relative to it. A fill at a third of the key lifts the shadow side to
// about a stop and a half under — enough to read, far enough down that
// the key still does the modelling.
const KEY_NIGHT = 1.15;

/**
 * How much of its blue each NIGHT light keeps: 1 is the colours as they
 * were graded, 0 is grey. Applied at constant luminance (nightLight), so
 * the night is exactly as bright as before — test:levels' crush and clip
 * are luminance — and only its colour cast moves.
 *
 * Every light that reaches a car at night was blue: the moon key
 * [0.75, 0.82, 1.0], the fill [0.42, 0.55, 0.82], the sky ambient
 * [0.17, 0.22, 0.33], and the sky itself in the reflections. Measured at
 * 2:30 at the exposure players get, every paint in the booth read blue —
 * a brown at 262 deg, a beige at 195 deg against its 54, silver at
 * saturation 0.60 against 0.07 on its swatch — and the car's own warm
 * rim (engine.ts) could only take back what one light can.
 *
 * Measured at 0.5, same conditions, against the colours as graded:
 *
 *   sand hue (swatch 54)      107 -> 69     mudbrick hue (30)   331 -> 349
 *   white blue cast           0.31 -> 0.28   silver             ~0.5 -> 0.46
 *   maroon / navy dead        56 / 53% -> 55 / 55%   (their problem is how
 *                             much light arrives, which this does not change)
 *
 * and test:levels at 22:30 does not move: road median 90 -> 89 on the
 * coast and 129 -> 129 in the city, buildings and sky identical, no crush
 * anywhere.
 */
const NIGHT_LIGHT_SAT = 0.5;
function nightLight(c: [number, number, number]): [number, number, number] {
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map((v) => y + (v - y) * NIGHT_LIGHT_SAT) as [number, number, number];
}
const KEY_TWILIGHT = 1.5;
/** Mid-afternoon: still full daylight, but off a sun that has come down
 *  far enough to rake. */
const KEY_GOLD = 2.75;
const KEY_DAY = 3.1;
const FILL_RATIO = 0.3;
/**
 * How much of the key still reaches a surface in its own shadow.
 *
 * Stands in for the bounce and skylight this renderer does not compute.
 * At 1 a shadow is a hole; at 0 there is no shadow at all. 0.62 was
 * measured rather than picked — see the note on moonLight below.
 */
const SHADOW_FILL = 0.62;

// How high the key light rides, in degrees above the horizon.
//
// This used to be the sun's own altitude, |sin|, which put the key at
// 56 degrees at BOTH the hours this game is played — midnight and noon
// are the same height on that curve, one above and one below. A key at
// 56 degrees throws a 1.3 m car a 0.9 m shadow, and a car is 4.5 m
// long, so every shadow in the game landed underneath the thing casting
// it and was never seen. The engine's own comment promised "long moon
// shadows across the asphalt"; the geometry had been quietly refusing
// for as long as the comment had been there.
//
// So the key rides a band chosen for what it does to the ground rather
// than for where the moon really is. At 26 degrees a car lays out 2.7 m
// of shadow — most of its own length again — and a lamp post lays out
// fifteen. Nobody in a car at night can tell you where the moon is; they
// can tell you instantly whether the road looks lit.
//
// Daylight keeps a high sun, because that IS legible: short shadows and
// a hot road read as noon and nothing else.
const KEY_ELEV_NIGHT = 26;
const KEY_ELEV_TWILIGHT = 12;
/**
 * And the afternoon, which the day used to have no room for.
 *
 * `day` saturates at a sun altitude of 0.31, which the clock reaches at
 * ten to eight in the morning and does not leave until ten past four —
 * so for eight and a half hours every palette in here was pinned to the
 * same values and the key light sat at the same 54 degrees. Half past
 * eight, noon and half past three were the same picture with the sun
 * pointing a different way. The test that covers this cycle sampled
 * hour 8 and hour 12.5 and printed the same sky for both without
 * anybody noticing, and sampled nothing at all between half past twelve
 * and quarter past six.
 *
 * A low sun is the thing daylight actually varies by: long shadows down
 * the road, a warm key, and the haze the Gulf carries all year standing
 * up in the horizon band.
 *
 * 22 rather than the 14 this was first written at, and the reason is
 * the keyframe below it. Twilight sits at 12, so an afternoon at 14 is
 * only two degrees above dusk — and blended, the two came out level: the
 * key measured the same height at ten past five as at ten past six, and
 * the sun stopped falling for the last hour of the day. An afternoon has
 * to be as far above dusk as it is below noon.
 */
const KEY_ELEV_GOLD = 22;
const KEY_ELEV_DAY = 54;
/** How far out the key sits, horizontally, from what it is lighting. */
const KEY_RADIUS = 520;

/**
 * How far away the sun or the moon is drawn.
 *
 * Any distance does, because a body this far off is a direction and not
 * a place — it rides the camera (skyFollowers) so it never gets nearer.
 * What matters is that it sits INSIDE the star sphere at 1750 and
 * outside everything else in the world.
 */
const SKY_BODY_DIST = 1400;

/**
 * How wide the sun and the moon are drawn, in degrees of arc.
 *
 * The real ones are both 0.53 degrees, and they are the SAME width to
 * within a couple of percent — which is the only reason a total eclipse
 * is possible at all. This game drew them 4.15 to 20.78 degrees wide,
 * changing by a factor of 2.75 as they crossed the sky, and drew the sun
 * at 0.55 times the moon: smaller than the moon, which is backwards.
 *
 * A DESIGN VALUE, and it has to be, because 0.53 degrees at this game's
 * 62-degree field of view is nine pixels tall on a 1080p screen — a dot,
 * with no visible edge and nothing to light. 2.0 degrees is 35 pixels,
 * which is where a disc starts reading as a disc: round, with a limb you
 * can see. Just under four times life size, applied to BOTH bodies so
 * they stay the same size as each other the way the real pair are.
 */
// (Life size is 0.53 degrees for both; 2.0 is the exaggeration, on purpose.)
const SKY_BODY_DEG = 2.0;

/**
 * How hard the moon's face is driven into the exposure.
 *
 * Measured, on the rendered pixels, along the path the shot tool takes:
 * this game tone-maps with ACES, whose curve is nearly flat at the top,
 * so a disc driven near white comes back as a disc with no inside. At
 * 1.0 the centre and a point halfway to the limb read 229 and 222 — a
 * seven-level difference, which is a white circle. At 0.55, 209 and 198.
 * At 0.20 the same two points read 180 and 150, and thirty levels is
 * where the maria stop being a rumour.
 *
 * That is the whole argument for holding it down here: everyone has seen
 * the moon, and what they have seen is a disc with markings on it. A
 * featureless white circle is not a brighter moon, it is a lamp. The sun
 * gets the opposite treatment and is driven past the ceiling on purpose,
 * because nobody has ever looked at the sun and seen anything but a hole
 * in the sky.
 */
const MOON_FACE_BRIGHT = 0.2;

/**
 * How hard the sun's face is driven, by hour.
 *
 * Noon has to saturate the LIMB, not just the centre, or the limb
 * darkening below draws a dark ring and the sun reads as an eclipse.
 * The limb keeps 1 − uLimb = 0.4 of the centre, and the centre saturates
 * at about 1.6 on this exposure (measured), so the noon drive is
 * 1.6 / 0.4 = 4.0, taken to 4.5 for margin.
 *
 * The other two are lower on purpose and it is not a look: a low sun is
 * seen through many times the depth of air a high one is, which is the
 * same extinction that reddens it, and it takes enough out that a
 * setting sun is something you can actually look at — soft-edged, with
 * its limb visible. That is the one hour of the day the darkening is
 * real to the eye, so it is the one hour the render lets it show.
 */
const SUN_FACE_NOON = 4.5;
const SUN_FACE_GOLD = 2.4;
const SUN_FACE_TWILIGHT = 1.1;

/**
 * The starfield.
 *
 * STAR_COUNT is about what a dark-adapted eye gets from a suburban sky
 * over the whole hemisphere; the city takes the low ones back through
 * extinction. The magnitude law is the real one — counts grow by
 * STAR_MAG_STEP for every magnitude fainter — over STAR_MAG_RANGE
 * magnitudes, which spans naked-eye from "the bright one" to "barely".
 * A screen cannot show a hundred-fold brightness range in a two-pixel
 * dot, so the linear brightness is compressed by STAR_GAMMA and floored
 * at STAR_FLOOR: the faintest still register, the brightest stay short
 * of reading as a lamp. Sizes in CSS pixels.
 */
const STAR_COUNT = 2400;
const STAR_MAG_STEP = 3.0;
const STAR_MAG_RANGE = 4.5;
const STAR_GAMMA = 0.45;
const STAR_FLOOR = 0.42;
const STAR_PX_MIN = 2.4;
const STAR_PX_MAX = 5.4;
/** Share of the field pulled toward the Milky Way's centre line: the
 *  band IS stars, mostly — the glow is the ones too faint to resolve. */
const STAR_BAND_BIAS = 0.7;
/** Lowest sine-of-elevation a star is placed at. */
const STAR_MIN_SIN = 0.04;
/** Extinction into the horizon haze, in sine of elevation: fully gone
 *  below the first, fully clear above the second (~2° and ~9°). Kept
 *  low: the chase camera's whole strip of sky is under 25°, and a haze
 *  that cleared at 17° took most of the stars a player can see. */
const STAR_EXT_LO = 0.04;
const STAR_EXT_HI = 0.16;
/** Scintillation depth overhead and at the horizon: how much of a star's
 *  light the twinkle can take away. */
const STAR_TWINKLE_HI = 0.22;
const STAR_TWINKLE_LO = 0.5;

/**
 * The Milky Way, as GLSL literals baked into the dome shader.
 *
 * The pole is the axis the band wraps around, tilted 62° from the
 * zenith so the band climbs from one horizon over the top third of the
 * sky. The width is the sine-distance from the band's centre line at
 * which it has fallen to 1/e — about 9° — and the colour is a faint
 * cool cream.
 *
 * Its strength is set against the zenith it sits on, so it moves when the
 * zenith does. It was vec3(0.017, 0.019, 0.026) over a zenith of linear
 * Y 0.031; the night zenith is 0.011 now (setTimeOfDay), and the tone
 * mapper's toe stretches contrast harder the deeper the sky, so unscaled
 * the band would have gone from 1.5x the sky's luma to 3.3x in the stills
 * (modelled through the shipped chain) — a galaxy you could read by, in a
 * city under a full moon. x0.41 holds it at about 2x, and in play its
 * lift over the sky goes from 15.6 levels to about 8: still there, still
 * faint. The usable range is x0.35 (1.9x, 7 levels) to x0.5 (2.2x, 10).
 */
const MILKY_POLE_V = new THREE.Vector3(0.62, 0.47, -0.63).normalize();
const MILKY_WIDTH = 0.12;
const MILKY_COLOR = "vec3(0.0070, 0.0078, 0.0105)";
/** The baked map stores 0..MILKY_MAP_RANGE in a byte; the shader
 *  multiplies back. Above 1 because the mottling peaks over the band's
 *  own mean. */
const MILKY_MAP_RANGE = 1.6;

/** The band's cross-section: 1 on its centre line, 1/e at MILKY_WIDTH
 *  (in sine-distance from the line), widened by `k`. */
function milkyBand(along: number, k = 1): number {
  return Math.exp(-(along * along) / (MILKY_WIDTH * MILKY_WIDTH * k));
}

/**
 * The Milky Way, baked once into an equirectangular map the dome looks
 * up by direction.
 *
 * It started as three octaves of value noise evaluated in the fragment
 * shader — for every sky pixel, every frame, for a thing that never
 * moves. On a software renderer that alone took the game's boot past
 * ten minutes; on a phone it would have been the most expensive pixels
 * on the screen and the least worth it. Baked, it is one texture fetch
 * and the noise can be as rich as it likes.
 *
 * A great circle of faint light around MILKY_POLE_V, tilted so the band
 * rises from one horizon and crosses well up the sky — where the
 * summer Milky Way sits over the Gulf after midnight, through Scorpius
 * and Sagittarius in the south. Three octaves of mottling, so it is
 * clouds of stars and not a smooth beam (a smooth band of light in the
 * sky is a searchlight, whatever colour it is painted), and a dark dust
 * lane close to the centre line. The map wraps in longitude; latitude
 * clamps.
 */
function makeMilkyTexture(): THREE.DataTexture {
  const W = 512, H = 256;
  const data = new Uint8Array(W * H * 4);
  // Integer hash → [0, 1). Fixed, so the map is the same on every boot.
  const hash = (x: number, y: number): number => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  // Value noise on a grid `p` cells around the map and `p / 2` tall,
  // wrapping in x so the seam at the back of the sky is invisible.
  const noise = (u: number, v: number, p: number, salt: number): number => {
    const x = u * p, y = v * (p / 2);
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = smooth(x - xi), fy = smooth(y - yi);
    const wx = (i: number) => ((i % p) + p) % p;
    const a = hash(wx(xi) + salt, yi), b = hash(wx(xi + 1) + salt, yi);
    const c = hash(wx(xi) + salt, yi + 1), d = hash(wx(xi + 1) + salt, yi + 1);
    const top = a + (b - a) * fx, bot = c + (d - c) * fx;
    return top + (bot - top) * fy;
  };
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    const lat = (v - 0.5) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const lon = (u - 0.5) * Math.PI * 2;
      // Direction for this texel, in the frame the shader's lookup uses:
      // u from atan(z, x), v from asin(y).
      const nx = cl * Math.cos(lon), ny = sl, nz = cl * Math.sin(lon);
      const along0 = nx * MILKY_POLE_V.x + ny * MILKY_POLE_V.y + nz * MILKY_POLE_V.z;
      // The centre line wanders and the width breathes, both by noise,
      // so no two edges of the band run parallel — parallel edges are
      // what made the first version read as a pair of searchlights.
      const wander = (noise(u, v, 6, 71) - 0.5) * 0.09;
      const along = along0 + wander;
      const breathe = 0.6 + 0.9 * noise(u, v, 9, 89);
      const band = milkyBand(along, breathe);
      // Mottling with real contrast: clouds of stars, and gaps.
      const cloud = 0.05 + 1.0 * noise(u, v, 12, 11) + 0.6 * noise(u, v, 28, 23) + 0.35 * noise(u, v, 64, 37);
      const lane = noise(u, v, 20, 53);
      // The dust sits NEAR the centre line and wanders off it, so it
      // reads as a rift and not as a stripe.
      const dust = THREE.MathUtils.smoothstep(lane, 0.45, 0.8) * milkyBand(along + 0.025 * (noise(u, v, 7, 97) - 0.5) * 4, 0.3);
      const milky = band * cloud * (1 - 0.75 * dust);
      const o = (y * W + x) * 4;
      const b = Math.round(THREE.MathUtils.clamp(milky / MILKY_MAP_RANGE, 0, 1) * 255);
      data[o] = b; data[o + 1] = b; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Scratch for aiming the sun/moon disc back at the camera. */
const _bodyNormal = new THREE.Vector3();
/** A PlaneGeometry faces +z; this is that, named. */
const _bodyPlaneNormal = new THREE.Vector3(0, 0, 1);

const _focus = new THREE.Vector3();
const _rest = new THREE.Quaternion();
// Scratch for the crowd's wave solves — world-space shoulder, direction
// out to the car, the hand target and the elbow pole, plus a clock so
// the wag keeps its rhythm across frames.
const _sw = new THREE.Vector3();
const _out = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _restDir = new THREE.Vector3();
const _upDir = new THREE.Vector3();
const _dir = new THREE.Vector3();
let _waveT = 0;

export function buildWorld(scene: THREE.Scene, track: Track): WorldHandle {
  // Same seed, same Kuwait. Every scatter below this line — building
  // heights, which windows are lit, where the palms stand, which side a
  // billboard faces — comes from one stream started here, so a
  // screenshot taken today is comparable with one taken before a change
  // rather than being a picture of a different city. See rand.ts.
  resetWorldRng();

  // Handles for the night-shimmer tick (assigned in the streetlight block)
  let glintMat: THREE.PointsMaterial | null = null;
  /** The lamps' wet-road smears and coronas, which go out with them. */
  let lampStreaks: THREE.InstancedMesh | null = null;
  let lampCoronaPts: THREE.Points | null = null;
  /** Advances the traffic signals; assigned in the signal block. */
  let signalTick: ((t: number) => void) | null = null;
  let shimmerLampMat: THREE.MeshStandardMaterial | null = null;
  // Handles the time-of-day switch repaints
  let skyMatRef: THREE.ShaderMaterial | null = null;
  // Everything whose windows come on after dark, so one place drives them.
  const litFacades: THREE.MeshStandardMaterial[] = [];
  let starsMatRef: THREE.ShaderMaterial | null = null;
  let moonDiscMat: THREE.ShaderMaterial | null = null;
  let moonHaloMat: THREE.SpriteMaterial | null = null;
  // The celestial body: the moon after dark, the sun in daylight — one
  // disc that crosses the sky, because two would be a lie half the time.
  let bodyDisc: THREE.Mesh | null = null;
  let bodyHalo: THREE.Sprite | null = null;
  let lampPoolMat: THREE.MeshBasicMaterial | null = null;
  let lampConeMat: THREE.ShaderMaterial | null = null;
  /** 0 at noon, 1 after dark — scales everything the streetlights do. */
  let lampLevel = 1;
  /** Everyone standing at the roadside who turns to watch a car go past:
   *  the figure (whose body takes over when the neck runs out) and its
   *  head joint, with the heading each was placed at — plus their arm
   *  chains and the as-built rest pose, so a raised hand can settle back
   *  exactly where it was authored. */
  interface Watcher {
    body: THREE.Object3D;
    head: THREE.Object3D;
    baseYaw: number;
    arms?: ArmChain[];
    /** Shoulder/elbow rest quaternions, two per arm, in arm order. */
    armRest?: THREE.Quaternion[];
    /** Which hand goes up for a passing car; 0 for one who never waves. */
    waveSide: number;
    phase: number;
    lift: number;
  }
  const watchers: Watcher[] = [];

  /** Arm registration for a watcher. A third of them never wave — a
   *  crowd in lockstep reads as a stadium routine, not a roadside. */
  const watcherArms = (
    fig: THREE.Object3D,
    side: number,
    i: number
  ): Pick<Watcher, "arms" | "armRest" | "waveSide" | "phase" | "lift"> => {
    const arms = fig.userData.arms as ArmChain[] | undefined;
    if (!arms) return { waveSide: 0, phase: 0, lift: 0 };
    const armRest: THREE.Quaternion[] = [];
    for (const a of arms) armRest.push(a.shoulder.quaternion.clone(), a.elbow.quaternion.clone());
    const still = i % RIG.crowd.stillEvery === RIG.crowd.stillEvery - 1;
    return { arms, armRest, waveSide: still ? 0 : side, phase: i * 1.9, lift: 0 };
  };

  /** Ease a watcher's arms back to the pose they were built in. */
  const settleArms = (w: Watcher, dt: number): void => {
    if (!w.arms || !w.armRest) return;
    w.lift = Math.max(0, w.lift - dt * RIG.crowd.liftDownRate);
    const k = Math.min(1, dt * RIG.crowd.restRate);
    w.arms.forEach((a, i) => {
      a.shoulder.quaternion.slerp(w.armRest![i * 2], k);
      a.elbow.quaternion.slerp(w.armRest![i * 2 + 1], k);
    });
  };
  /**
   * Materials that glow only because the world was authored at night:
   * lane paint, kerbs, sign faces, lit windows. Sunlight lights them for
   * real, so their emissive has to come off with the dark or noon looks
   * like a neon rave. Registered with their night value and scaled.
   */
  const nightGlow: Array<{ mat: THREE.MeshStandardMaterial; base: number }> = [];
  let hemiRef: THREE.HemisphereLight | null = null;

  const L = track.length;
  const beacons: THREE.MeshStandardMaterial[] = [];
  const skyFollowers: THREE.Object3D[] = [];
  const probeHide: THREE.Object3D[] = [];
  /** The street lanterns' lenses, filled by the street-light block. */
  const streetLamps: THREE.Vector3[] = [];
  const streetLampPools: THREE.Vector3[] = [];

  // Fog and light
  // Draw distance: at 0.0021 the world vanished by ~700 m, which hid the
  // far side of the bay. 0.0009 pushes usable visibility past 2 km so the
  // skyline, the towers and oncoming traffic read from a long way out.
  // Fog colour is the floor the whole scene fades to, so it has to be at
  // least as dark as the darkest object or distance reads as grey haze.
  //
  // This colour is frame 0 only: setTimeOfDay overwrites it on its first
  // call, from its own keyframes. It said 0x02030b, which no frame after
  // the first ever showed — the night actually ran on a navy keyframe
  // whose far field models at 4,8,41 on screen. So it is the night
  // keyframe now, written in sRGB (the hex is read as sRGB and
  // linearised): see the fog in setTimeOfDay for why that is nearly
  // neutral.
  scene.fog = new THREE.FogExp2(0x14161d, 0.0009);
  // Ambient fill is the other black-level lift: at 0.65 nothing in the
  // scene could reach zero. 0.3 keeps shape in the shadows without
  // flooding them.
  hemiRef = new THREE.HemisphereLight(0x2b3853, 0x120e08, 0.36);
  scene.add(hemiRef);

  // Key and fill, the way a set is lit rather than the way a scene
  // graph accumulates lights.
  //
  // The KEY is the one light that models the subject: it is the moon at
  // night and the sun by day, it throws the shadows, and it is
  // deliberately the strongest thing in the rig so surfaces turn
  // through a real range from lit to unlit.
  //
  // The FILL sits roughly opposite and well below it in strength — the
  // classic ratio is somewhere around three or four to one — and it is
  // cooler than the key. Its whole job is to keep the shadow side
  // readable without flattening the form, so it casts nothing: a fill
  // that throws its own shadows produces a second set of them and the
  // image reads as two suns.
  const moonLight = new THREE.DirectionalLight(0xbfd0ff, KEY_NIGHT);
  moonLight.position.set(-300, 500, 200);
  // A shadow is not the absence of light.
  //
  // A surface the key cannot reach is still lit by the sky above it and
  // by everything the light bounced off on the way. This renderer has no
  // bounce, and the hemisphere light standing in for the sky is a
  // fraction of the key — so a shadowed pixel here was losing about
  // sixty per cent of its whole light budget, and the picture had holes
  // in it wherever anything cast one.
  //
  // Partial shadow is the standard way to pay for the bounce a real-time
  // renderer does not compute. It is a cheat and it is the right cheat:
  // it lifts ONLY what the key cannot reach. Raising the ambient instead
  // would have lifted the midnight sky and the sea with it, which is how
  // a night game stops being one.
  //
  // Measured, A/B over four viewpoints in one session (tools/shots/
  // lightab.mjs), because the two levers are only distinguishable by
  // what they DO NOT touch:
  //
  //   shadow band (<=32/255)   50.9%  ->  47.9%
  //   median luma               32.3  ->   37.8
  //   the black end (<=2/255)   0.47% ->   0.38%   — did not rise
  //
  // That last line is the whole argument. Under the flyover the median
  // went 35 -> 49 and on the open corniche the sub-16/255 share halved,
  // while the pixels that are supposed to be black stayed black. The sky
  // is not shadow-mapped, so it cannot move, and it did not.
  moonLight.shadow.intensity = SHADOW_FILL;
  scene.add(moonLight);
  const fillLight = new THREE.DirectionalLight(0x86a6d8, KEY_NIGHT * FILL_RATIO);
  fillLight.position.set(300, 220, -200);
  fillLight.castShadow = false;
  scene.add(fillLight);

  // Gradient night-sky dome with city glow at the horizon
  {
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      // Palette lives in uniforms so setSky can turn midnight into dawn
      // without rebuilding the dome.
      uniforms: {
        // The night keyframes of setTimeOfDay, which overwrites these on
        // its first call; matching them keeps frame 0 the same sky.
        uTop: { value: new THREE.Color(0.009, 0.011, 0.022) },
        uHorizon: { value: new THREE.Color(0.056, 0.064, 0.085) },
        uGlow: { value: new THREE.Color(0.085, 0.046, 0.01) },
        /** How far the horizon band climbs — dawn light reaches higher. */
        uGlowHeight: { value: 0.16 },
        /** The Milky Way's strength, 0..1 — night only, see setTimeOfDay. */
        uMilky: { value: 1 },
        /** The band itself, baked — see makeMilkyTexture. */
        uMilkyMap: { value: makeMilkyTexture() },
        // Daytime detail — see the DAY SKY note in the fragment shader.
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color(1, 0.9, 0.75) },
        /** 0 at night, 1 in full daylight: how much of the day detail shows. */
        uDay: { value: 0 },
        /** The golden hours' share of it: warmer halo, lit cloud edges. */
        uGold: { value: 0 },
        /** Drives the cloud drift; the game hour, so it moves with the clock. */
        uCloudT: { value: 0 },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vPos;
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uGlow;
        uniform float uGlowHeight;
        uniform float uMilky;
        uniform sampler2D uMilkyMap;
        uniform vec3 uSunDir;
        uniform vec3 uSunCol;
        uniform float uDay;
        uniform float uGold;
        uniform float uCloudT;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int k = 0; k < 5; k++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
          return v;
        }

        void main() {
          float h = clamp(vPos.y / 600.0, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.6, h));
          // light hugging the skyline: sodium at night, sunrise at dawn
          col += uGlow * (1.0 - smoothstep(0.0, uGlowHeight, h));

          // The Milky Way, looked up by direction from the baked map —
          // one fetch, and nothing here is computed that never changes.
          // It is held faint on purpose: this is a city sky under a
          // full moon, and a galaxy you could read by would be a lie in
          // it. Dies into the horizon haze the way the stars do.
          vec3 n = normalize(vPos);
          vec2 muv = vec2(atan(n.z, n.x) / 6.2831853 + 0.5, asin(clamp(n.y, -1.0, 1.0)) / 3.14159265 + 0.5);
          float milky = texture2D(uMilkyMap, muv).r * ${MILKY_MAP_RANGE.toFixed(2)} * smoothstep(0.06, 0.32, n.y);
          col += ${MILKY_COLOR} * (milky * uMilky);

          // THE DAY SKY. It was a vertical gradient and nothing else, so
          // an afternoon looked the same in every direction — the one
          // thing a low sun never does. Three additions, all gated on
          // uDay so the night is untouched:
          //
          //   the sun side  the sky brightens and warms toward the sun
          //                 (forward scattering) with a tight aureole
          //                 round the disc, and deepens a little opposite
          //   cirrus        thin high streaks, stretched along one
          //                 axis, drifting with the game clock
          //   fair-weather  a scatter of low puffs sitting in the haze
          //   puffs         band, the dust-softened cumulus of a Gulf
          //                 afternoon
          //
          // Cloud brightness is tied to the horizon colour rather than to
          // white, so a cloud never outshines the sky it sits in — the
          // noon sky already clips around the sun and this must not add
          // to it.
          if (uDay > 0.001) {
            float mu = max(dot(n, uSunDir), 0.0);
            float anti = max(dot(n, -uSunDir), 0.0);
            vec3 sunTint = mix(uSunCol, vec3(1.0, 0.72, 0.42), uGold);
            // Narrow on purpose: measured at 17:00 a cubic lobe spread
            // the glow across half the sky and blew it to white. The
            // wide term is now a sixth power and half as strong, the
            // aureole tighter, and neither is added where the horizon
            // band is already carrying the light.
            float lift = smoothstep(0.02, 0.25, h);
            col += sunTint * uDay * (0.05 * pow(mu, 6.0) * lift + 0.14 * pow(mu, 96.0)) * (1.0 + 0.5 * uGold);
            col *= 1.0 - 0.10 * uDay * anti * smoothstep(0.1, 0.6, h);

            float up = n.y;
            if (up > 0.015) {
              vec2 sky = n.xz / (up + 0.12);
              // Cirrus: long, thin, high.
              vec2 cp = vec2(sky.x * 0.55 + sky.y * 0.2, sky.y * 2.4 - sky.x * 0.3) * 1.6 + vec2(uCloudT * 0.035, uCloudT * 0.01);
              float ci = fbm(cp);
              float cirrus = smoothstep(0.56, 0.82, ci) * smoothstep(0.03, 0.22, up) * (1.0 - 0.5 * smoothstep(0.6, 1.0, up));
              // Puffs: rounder, low in the sky, only near the horizon.
              vec2 pp = sky * 3.2 + vec2(uCloudT * 0.06, -uCloudT * 0.02);
              float pu = fbm(pp) * 0.75 + fbm(pp * 2.7) * 0.25;
              float puff = smoothstep(0.62, 0.78, pu) * smoothstep(0.015, 0.05, up) * (1.0 - smoothstep(0.08, 0.2, up));
              vec3 cloudBase = mix(uHorizon, vec3(0.95, 0.94, 0.92), 0.35);
              vec3 lit = cloudBase * (0.92 + 0.28 * pow(mu, 2.0)) + sunTint * uGold * 0.18 * pow(mu, 1.5);
              // Never more than a touch brighter than the sky behind it.
              // The noon sky already sits at a median of 234/255 and a
              // quarter of it clips; a cloud whiter than that is only more
              // white. Measured uncapped: coast clip 24.6% -> 26.8%. Capped,
              // a cloud reads by its texture and its shaded underside.
              lit = min(lit, col * 1.05 + vec3(0.02));
              // Shaded undersides on the puffs, so they have a volume.
              vec3 puffCol = mix(lit * 0.78, lit, smoothstep(0.62, 0.9, pu));
              col = mix(col, lit, cirrus * 0.42 * uDay);
              col = mix(col, puffCol, puff * 0.7 * uDay);
            }
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    skyMatRef = skyMat;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_DOME_RADIUS, 24, 12), skyMat);
    // Named for the levels tool, which measures the delivered picture per
    // surface and otherwise has to guess which of the sky followers is
    // the dome rather than the moon, its halo or the stars.
    sky.name = "sky";
    sky.renderOrder = -2;
    scene.add(sky);
    skyFollowers.push(sky);

    // The moon over the Gulf, with a soft halo.
    //
    // A quad with the disc cut out of it in the shader rather than a
    // CircleGeometry, for two reasons. It is perfectly round at any size
    // — the 32-segment circle this replaces showed its corners once it
    // was more than a few degrees wide, and it was up to 20 degrees wide
    // — and the same fragment shader that decides which pixels are
    // inside the limb can decide how bright each of them is, which is
    // the whole difference between a disc and a sticker of a disc.
    //
    // WHAT THE TWO BODIES ACTUALLY LOOK LIKE, and they are not the same:
    //
    //   The SUN is a ball of gas seen through its own atmosphere, so it
    //   is limb-DARKENED: the edge is dimmer than the middle, because a
    //   sightline near the edge stops in a higher, cooler layer than one
    //   through the centre. The standard visible-light figure is a 60%
    //   fall from centre to limb, which is uLimb below.
    //
    //   The MOON is rock, and it does the opposite of what a lit sphere
    //   should: it stays bright right out to the edge and reads FLAT.
    //   That is the opposition surge — the regolith is a retroreflector,
    //   so it throws light straight back where it came from rather than
    //   scattering it like a matte ball. It is why a full moon looks
    //   like a coin and not a sphere, and why the naive fix (shade it
    //   like a sphere) makes it look wrong.
    //
    // The maria are the dark patches, and they are why a moon at this
    // size stops looking like a lamp: 12% of the disc's brightness,
    // which is roughly their real contrast against the highlands.
    //
    // The moon is FULL, always, and that is not laziness — it follows.
    // This game draws one body on the key light's own direction, so the
    // face turned toward the camera is the face being lit, and a body
    // lit from the direction you are looking at it from is by definition
    // full. A crescent would mean the light was coming from somewhere
    // the body is not, which is the bug this whole block exists to fix.
    moonDiscMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color(0xf6f3ee) },
        uOpacity: { value: 1 },
        /** 0 = the moon, 1 = the sun. */
        uSun: { value: 0 },
        /**
         * How hard the body is driven into the exposure.
         *
         * The two bodies want opposite answers and the reason is what a
         * person can actually see. Nobody has ever looked at the sun: it
         * is far past what an eye or a sensor can hold, it blows out to a
         * white hole with a bloom around it, and its limb darkening is
         * invisible in practice. Everybody has looked at the moon, and
         * what they see is a disc WITH MARKINGS — the maria are the
         * whole reason it reads as a world and not a lamp.
         *
         * So the sun is driven over the ceiling deliberately and the
         * moon is held just under it. Measured on the rendered pixels:
         * before this, 81% of the moon's face was clipped to pure white
         * and neither the maria nor the limb survived at all.
         */
        uBright: { value: 1 },
        /** How much dimmer the sun's limb is than its centre. */
        uLimb: { value: 0.6 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uSun;
        uniform float uLimb;
        uniform float uBright;

        // Cheap value noise, for the maria. Fixed in the disc's own frame
        // so the markings do not crawl as it crosses the sky.
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                     mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }

        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          // The limb, antialiased against however many pixels wide this
          // disc happens to be — so it is a clean edge at two degrees and
          // still a clean edge if somebody makes it ten.
          float aa = fwidth(r) * 1.5;
          float inside = 1.0 - smoothstep(1.0 - aa, 1.0, r);
          if (inside <= 0.0) discard;

          // cos of the angle between the sightline and the surface
          // normal, which is what limb darkening is a function of.
          float mu = sqrt(max(0.0, 1.0 - r * r));
          float sunFace = 1.0 - uLimb * (1.0 - mu);
          // The moon does not darken toward its limb — see above — but a
          // completely flat disc has no edge at all, so it keeps a
          // fraction of the fall to sit the rim against the sky.
          float moonFace = 1.0 - 0.12 * (1.0 - mu);
          // The maria, at their real contrast against the highlands —
          // they are about a fifth darker, which is a big difference on
          // a disc and reads from across a room.
          float maria = smoothstep(0.35, 0.75, noise(p * 1.9 + 3.7));
          moonFace *= 1.0 - 0.20 * maria;

          float face = mix(moonFace, sunFace, uSun);
          gl_FragColor = vec4(uColor * face * uBright, uOpacity * inside);
        }
      `,
    });
    // A unit quad: the scale carries the real size, set per frame from
    // SKY_BODY_DEG so it never depends on where the body is.
    const moonDisc = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), moonDiscMat);
    bodyDisc = moonDisc;
    moonDisc.position.set(-980, 640, -200);
    moonDisc.lookAt(0, 0, 0);
    moonDisc.renderOrder = -1;
    scene.add(moonDisc);
    skyFollowers.push(moonDisc);
    moonHaloMat = new THREE.SpriteMaterial({
      map: pointGlowTexture(225, 220, 195),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0.5,
    });
    const halo = new THREE.Sprite(moonHaloMat);
    halo.scale.set(520, 520, 1);
    halo.position.copy(moonDisc.position);
    bodyHalo = halo;
    scene.add(halo);
    skyFollowers.push(halo);
  }

  // Stars.
  //
  // These were 700 identical dots: one colour, one size, one brightness,
  // stuck still, spread uniformly in ELEVATION — which on a sphere piles
  // them up at the zenith, and then squashed to half height so that
  // enough of them fell into the chase camera's strip of sky. Every one
  // of those is a thing the real sky does not do, and the eye knows a
  // starfield it has never seen.
  //
  // What a night sky actually has, and what each attribute here is for:
  //
  //   MAGNITUDE. Star counts run about three-fold per magnitude — for
  //   every star like Vega there are a few dozen you would call bright
  //   and a few hundred you would call faint. So brightness is drawn
  //   from that law (STAR_MAG_STEP), and the handful of bright ones are
  //   what give the field a shape; a sky of equal dots is wallpaper.
  //   Size rides with it: a bright star is not a bigger disc, it is a
  //   disc that bleeds further into the neighbouring pixels.
  //
  //   COLOUR. Most stars are white to blue-white, a fifth or so are
  //   warm, and a few are frankly orange (Betelgeuse, Aldebaran, Antares
  //   over the Gulf in summer). Each star carries its own tint, drawn
  //   from those proportions. The old single 0xcdd8ff made the whole
  //   sky one temperature, and one temperature reads as a texture.
  //
  //   SCINTILLATION. Stars twinkle because the air between you and
  //   them is turbulent, and there is more air the lower you look, so a
  //   star near the horizon shimmers hard while one overhead barely
  //   moves. The shader sums two incommensurate sines per star, with a
  //   depth that grows toward the horizon. Planets do not twinkle — a
  //   disc averages the turbulence out — but this game draws none.
  //
  //   EXTINCTION. Kuwait City is a Bortle-8 sky: the lowest fifteen
  //   degrees or so are sodium haze and nothing shows through it. The
  //   stars die into the horizon band rather than sitting on top of it,
  //   and the count fades in from about ten degrees up.
  //
  // Distributed uniformly on the SPHERE this time (sin of elevation is
  // uniform), so the density per square degree is the same overhead as
  // it is low down, and there are more of them because a real sky has
  // more of them — one draw call either way. The sphere is round again:
  // the chase camera gets its share of stars from the count, not from a
  // flattened dome that put the same stars at the wrong elevation.
  {
    // The stars draw from their OWN stream, not the world's. The world
    // stream is consumed in build order, so every draw here would shift
    // every building height, lit window and palm placed after it — and
    // this block now draws a variable number of times (see the rejection
    // loop). The old field took exactly two draws for each of its 700
    // stars; those are still taken, and thrown away, so the city built
    // after this line is the same city it was before the stars changed
    // and every kept screenshot stays comparable with its history.
    for (let i = 0; i < 700 * 2; i++) rand();
    const srand = makeRng((WORLD_SEED ^ 0x5354_4152) >>> 0);
    const n = STAR_COUNT;
    const pos = new Float32Array(n * 3);
    const tint = new Float32Array(n * 3);
    // x: brightness 0..1, y: point size (px), z: twinkle phase, w: rate
    const star = new Float32Array(n * 4);
    const r = 1750;
    for (let i = 0; i < n; i++) {
      // Uniform on the sphere above a floor — nothing is placed in the
      // lowest few degrees, where extinction would hide it anyway — then
      // thinned away from the Milky Way by rejection, so the band is
      // made of stars the way the real one is and the dome's glow only
      // stands in for the ones too faint to draw.
      let x = 0, y = 0, z = 0;
      for (;;) {
        const a = srand() * Math.PI * 2;
        const sinE = STAR_MIN_SIN + srand() * (1 - STAR_MIN_SIN);
        const cosE = Math.sqrt(1 - sinE * sinE);
        x = Math.cos(a) * cosE; y = sinE; z = Math.sin(a) * cosE;
        const inBand = milkyBand(x * MILKY_POLE_V.x + y * MILKY_POLE_V.y + z * MILKY_POLE_V.z, 1.8);
        if (srand() < 1 - STAR_BAND_BIAS + STAR_BAND_BIAS * inBand) break;
      }
      pos[i * 3] = x * r;
      pos[i * 3 + 1] = y * r;
      pos[i * 3 + 2] = z * r;

      // Magnitude from the three-fold-per-magnitude law over STAR_MAG_RANGE
      // magnitudes, then to a linear brightness (2.512 per magnitude).
      const u = srand();
      const mag = Math.log(1 + u * (Math.pow(STAR_MAG_STEP, STAR_MAG_RANGE) - 1)) / Math.log(STAR_MAG_STEP);
      const lin = Math.pow(10, -0.4 * mag);
      // A screen cannot hold five magnitudes, so the display range is
      // compressed: the faintest still register as a point, the
      // brightest are held short of a lamp.
      const bright = STAR_FLOOR + (1 - STAR_FLOOR) * Math.pow(lin, STAR_GAMMA);
      star[i * 4] = bright;
      star[i * 4 + 1] = STAR_PX_MIN + (STAR_PX_MAX - STAR_PX_MIN) * Math.pow(lin, 0.45);
      star[i * 4 + 2] = srand() * Math.PI * 2;
      star[i * 4 + 3] = 5 + srand() * 9;

      // Colour class by proportion. Bright stars lean a touch more
      // saturated: the eye sees colour in a star only once it is bright
      // enough, and a faint one is grey whatever its temperature is.
      const c = srand();
      let rr = 0.95, gg = 0.97, bb = 1.0; // white
      if (c < 0.22) { rr = 0.78; gg = 0.86; bb = 1.0; } // blue-white
      else if (c > 0.76 && c <= 0.93) { rr = 1.0; gg = 0.94; bb = 0.82; } // yellow-white
      else if (c > 0.93) { rr = 1.0; gg = 0.78; bb = 0.58; } // orange
      const sat = 0.35 + 0.65 * bright;
      tint[i * 3] = 1 + (rr - 1) * sat;
      tint[i * 3 + 1] = 1 + (gg - 1) * sat;
      tint[i * 3 + 2] = 1 + (bb - 1) * sat;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aTint", new THREE.BufferAttribute(tint, 3));
    geo.setAttribute("aStar", new THREE.BufferAttribute(star, 4));
    starsMatRef = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        /** 1 after dark, 0 by day — set with the hour. */
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        /** Device pixels per CSS pixel; the engine keeps this current. */
        uPixelRatio: { value: 1 },
      },
      vertexShader: `
        attribute vec3 aTint;
        attribute vec4 aStar;
        uniform float uTime;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vEdge;
        void main() {
          // Elevation, as the sine: position is the offset from the
          // camera, which is what the sky followers ride.
          float elev = normalize(position).y;
          // The haze at the bottom of the sky takes the low stars.
          float ext = smoothstep(${STAR_EXT_LO.toFixed(3)}, ${STAR_EXT_HI.toFixed(3)}, elev);
          // Scintillation: two sines that never line up, deeper low down.
          float depth = mix(${STAR_TWINKLE_HI.toFixed(3)}, ${STAR_TWINKLE_LO.toFixed(3)}, 1.0 - elev);
          float s1 = 0.5 + 0.5 * sin(uTime * aStar.w + aStar.z);
          float s2 = 0.5 + 0.5 * sin(uTime * aStar.w * 2.71 + aStar.z * 1.7);
          float tw = 1.0 - depth * (0.65 * s1 + 0.35 * s2);
          float b = aStar.x * ext * tw;
          vColor = aTint * b;
          // A shimmering star also changes apparent size a little; the
          // brightest keep a soft skirt beyond the core.
          vEdge = mix(0.8, 0.42, aStar.x);
          gl_PointSize = aStar.y * uPixelRatio * (0.85 + 0.15 * tw) * (0.3 + 0.7 * ext);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vEdge;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p, p);
          if (r2 > 1.0) discard;
          // A soft-edged core with a faint skirt, so a star is a point of
          // light and not a square of one.
          float core = exp(-r2 / vEdge);
          gl_FragColor = vec4(vColor * core, uOpacity * core);
        }`,
    });
    const stars = new THREE.Points(geo, starsMatRef);
    // Named for the tools that measure the sky, the same as the dome.
    stars.name = "stars";
    stars.frustumCulled = false;
    scene.add(stars);
    skyFollowers.push(stars);
  }

  // Rain.
  //
  // Drawn as line segments rather than sprites because that is what rain
  // seen from a moving car IS — the drop travels far enough during the
  // exposure to become a streak, and the faster you go the more it leans.
  // The wind streaks at 220 km/h already use this, so it is one more
  // LineSegments and one draw call rather than a particle system.
  //
  // It rides skyFollowers, which the engine re-centres on the camera
  // every frame. That is the whole trick: a box of rain 60 m across
  // travels with the driver, so the world never has to hold 8.5 km of
  // weather, and the drops that fall out of the bottom are recycled to
  // the top. Nobody can see the edge of a box they are standing in the
  // middle of.
  const RAIN_N = 900;
  const RAIN_BOX = 34; // half-width of the box the drops live in, m
  const RAIN_TOP = 18;
  const rainPos = new Float32Array(RAIN_N * 2 * 3);
  // Fall speed per drop, so the curtain has depth instead of moving as
  // one sheet.
  const rainVel = new Float32Array(RAIN_N);
  for (let i = 0; i < RAIN_N; i++) {
    const x = (rand() * 2 - 1) * RAIN_BOX;
    const z = (rand() * 2 - 1) * RAIN_BOX;
    const y = rand() * RAIN_TOP;
    const len = 0.7 + rand() * 0.9;
    const o = i * 6;
    rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z;
    rainPos[o + 3] = x; rainPos[o + 4] = y - len; rainPos[o + 5] = z;
    rainVel[i] = 22 + rand() * 12;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({
    color: 0xbcd4e6,
    transparent: true,
    opacity: 0,
    // Additive would make rain glow against the night sky; it is water,
    // and at midnight it is only visible where a lamp or a headlight is
    // already lighting it.
    depthWrite: false,
  });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.name = "rain";
  rain.frustumCulled = false;
  rain.visible = false;
  let rainFall = 0;
  scene.add(rain);
  skyFollowers.push(rain);

  // City floor inland of the corniche
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshStandardMaterial({ color: 0x241d12, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(2700, CITY_GROUND_Y, -1400);
  ground.receiveShadow = true;
  scene.add(ground);

  // The Gulf — runs along the whole coastal leg (road x ≈ 760–850,
  // water everywhere west of it down to the horizon)
  const seaMap = seaTexture();
  seaMap.repeat.set(36, 64);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(3300, 5800),
    new THREE.MeshStandardMaterial({
      map: seaMap,
      color: 0xb8c4cc,
      roughness: 0.18,
      metalness: 0.55,
      emissive: 0x06283f,
      emissiveIntensity: 0.5,
    })
  );
  sea.rotation.x = -Math.PI / 2;
  // Eastern edge at x ≈ 770 so the water always reaches under the beach
  sea.position.set(-880, -0.04, -1400);
  scene.add(sea);

  // Corniche: paved walkway then beach sand between the road and the water
  //
  // Both are pinned to the CONSTANT road half-width rather than to
  // halfWidthAt(s), and that only became a problem when the ribbon
  // winding was fixed and they were drawn for the first time. The Sharq
  // plaza swells the tarmac from 7 m to 19 m over s 489-613, so a walkway
  // at a fixed 7.8 m out would have been laid 3.7 m deep across the
  // widened road — paving over the drift circle and the seaward edge line
  // with it.
  //
  // Split around the swell rather than tracked to it. Tracking is the
  // right long answer but not a change to make here: the beach would
  // bulge 12 m into the Gulf for 124 m. A gap is also the true thing —
  // the plaza IS where the corniche opens out — and it costs one extra
  // draw call per surface instead of a reshuffle of everything pinned to
  // that constant. Moving the whole coastal-furniture family onto
  // halfWidthAt is its own job. The palm row has made that move already
  // (palm.ts placePalms): the three sea palms that stood 4.0-9.4 m
  // inside the plaza's tarmac edge now stand 2.6 m outside it.
  const PLAZA_GAP = {
    from: (DRIFT_PLAZA.s - DRIFT_PLAZA.halfSpan) / track.length,
    to: (DRIFT_PLAZA.s + DRIFT_PLAZA.halfSpan) / track.length,
  };
  const coastalSpans: Array<[number, number]> = [
    [COAST_U.from, PLAZA_GAP.from],
    [PLAZA_GAP.to, COAST_U.to],
  ];

  const paver = paverTexture();
  paver.repeat.set(2.5, 9);
  const paverMat = new THREE.MeshStandardMaterial({ map: paver, roughness: 0.95 });
  for (const [u0, u1] of coastalSpans) {
    const walkway = new THREE.Mesh(
      buildRibbon(track, -(ROAD_HALF_WIDTH + 4.5), -(ROAD_HALF_WIDTH + 0.8), 0.06, 10, u0, u1),
      paverMat
    );
    walkway.name = "corniche-walkway";
    scene.add(walkway);
  }

  // The beach: dry sand from the walkway out, and the last WET_M before
  // the water darkened on the mesh — the sea edge of each ribbon is its
  // first vertex, lateral -(ROAD_HALF_WIDTH + 48). UVs are re-laid in
  // metres so both strips sample the same tile at the same scale.
  const sandTex = sandSurface();
  const sandMat = new THREE.MeshStandardMaterial({
    map: sandTex.map,
    normalMap: sandTex.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 1,
    vertexColors: true,
  });
  const WET_M = 9;
  const SEA_EDGE = ROAD_HALF_WIDTH + 48;
  const strip = (outer: number, inner: number, u0: number, u1: number, wetOuter: number) => {
    const g = buildRibbon(track, -outer, -inner, 0.0, 10, u0, u1);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const n = uv.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const sea = i % 2 === 0; // the ribbon's a-edge: the outer (seaward) offset
      uv.setXY(i, (sea ? -outer : -inner) / SAND_TILE_M, (uv.getY(i) * 14) / SAND_TILE_M);
      const k = sea ? wetOuter : 1;
      col[i * 3] = k;
      col[i * 3 + 1] = k;
      col[i * 3 + 2] = k * 1.02; // wet sand is a shade cooler
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  };
  for (const [u0, u1] of coastalSpans) {
    const beach = new THREE.Mesh(
      mergeGeometries([
        strip(SEA_EDGE - WET_M, ROAD_HALF_WIDTH + 4.5, u0, u1, 1),
        strip(SEA_EDGE, SEA_EDGE - WET_M, u0, u1, 0.45),
      ])!,
      sandMat
    );
    beach.name = "beach";
    beach.receiveShadow = true;
    scene.add(beach);
  }

  // Road surface — textured asphalt with a faintly damp sheen so the
  // streetlights and skyline catch on it; darker (tire-polished) areas
  // read as smoother via the roughness map
  const { map: asphalt, normalMap: asphaltNormals, roughnessMap: asphaltRough } =
    asphaltSurface();
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphalt,
    roughnessMap: asphaltRough,
    normalMap: asphaltNormals,
    normalScale: new THREE.Vector2(0.55, 0.55),
    color: 0xffffff,
    roughness: 1.0, // the map supplies the real 0.38-0.92 range
    metalness: 0.0, // asphalt is a dielectric
    envMapIntensity: 1.15,
  });
  // Out to the rail lip, not to halfWidthAt: the 0.60 m marginal strip
  // (MARKINGS.strip) is paved, so the edge line sits on asphalt with
  // asphalt outboard of it instead of on the last 150 mm before the
  // verge. Nothing that reads halfWidthAt moves — not the car's clamp,
  // not LANES, not the rail.
  //
  // And the texture is laid in metres across (uMetres = ASPHALT.tileM)
  // rather than stretched edge to edge. At hw 7 that is the old mapping
  // exactly; at the plaza's 19 it is what keeps the wheel paths in the
  // lanes — stretched, they slid out across the ±3.5 lane lines once
  // the road passed 14 m of half-width.
  const road = new THREE.Mesh(
    buildRibbon(
      track,
      (s) => -(track.halfWidthAt(s) + MARKINGS.strip.width),
      (s) => track.halfWidthAt(s) + MARKINGS.strip.width,
      0.02,
      3,
      0,
      1,
      ASPHALT.tileM
    ),
    roadMat
  );
  road.receiveShadow = true;
  // Named so the street-network test can ask what a downward ray landed
  // on: pavement you can trace from the highway to any block, or a gap.
  road.name = "road";
  scene.add(road);

  // ------------------------------------------------- the street network
  //
  // Avenues running with the highway, cross streets running out from it,
  // joined at every intersection. See STREETS at the top of this file for
  // why building it in road space is what makes it connect.
  //
  // Which side of the highway has city on it changes around the lap: the
  // Gulf is on the left of the whole coastal leg, so out there the grid
  // is one-sided and the seaward blocks are water. Everywhere else the
  // city is on both sides.
  {
    const streetMat = roadMat.clone();
    // The same asphalt, read a step down from the highway so the route
    // you are actually racing stays the brightest line in the scene.
    streetMat.color = new THREE.Color(0xb4b4b4);
    const parts: THREE.BufferGeometry[] = [];
    const outer = STREETS.avenues[STREETS.avenues.length - 1];

    // Avenues. The inland side runs the whole lap; the seaward side only
    // exists once the coast is behind us.
    for (const d of STREETS.avenues) {
      parts.push(
        buildRibbon(track, d - STREETS.half, d + STREETS.half, STREETS.yAvenue, 10)
      );
      parts.push(
        buildRibbon(
          track,
          -(d + STREETS.half),
          -(d - STREETS.half),
          STREETS.yAvenue,
          10,
          COAST_U.to,
          1
        )
      );
    }

    // Cross streets: a straight run from the highway's edge out past the
    // last avenue, perpendicular to the road at that point. Because the
    // avenue's centre at this same `s` is exactly `pose(s, d)`, and this
    // strip passes through every `lat` on its way out, it crosses each
    // avenue precisely on the avenue.
    const cp = new THREE.Vector3();
    const cside = new THREE.Vector3();
    const ctan = new THREE.Vector3();
    const crossQuad = (s: number, latA: number, latB: number) => {
      track.pointAt(s, cp);
      track.sideAt(s, cside);
      track.tangentAt(s, ctan);
      const pos = new Float32Array(12);
      const uv = new Float32Array(8);
      let i = 0;
      for (const lat of [latA, latB]) {
        for (const along of [-STREETS.half, STREETS.half]) {
          pos[i * 3] = cp.x + cside.x * lat + ctan.x * along;
          pos[i * 3 + 1] = STREETS.yCross;
          pos[i * 3 + 2] = cp.z + cside.z * lat + ctan.z * along;
          uv[i * 2] = along > 0 ? 1 : 0;
          uv[i * 2 + 1] = lat / 14;
          i++;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      // Wound to face UP. The obvious vertex order here produces a
      // downward normal — `side` is tangent x UP, which makes (lat,
      // along) a left-handed pair — and a ground quad facing down is
      // backface-culled: the cross streets were not merely untested,
      // they were not being drawn at all.
      g.setIndex([0, 2, 1, 1, 2, 3]);
      g.computeVertexNormals();
      return g;
    };

    // One street per junction record (markings.ts), the same list the
    // paint and the signals iterate — they used to be three loops that
    // disagreed about which junctions existed.
    for (const j of junctions(track, STREETS)) {
      // Start where the highway's pavement ends: its own edge, which is
      // wider at the plaza, plus the paved strip. Starting at the edge
      // laid the street (y 0.016) under the strip (y 0.02) for 0.6 m,
      // 4 mm apart, which z-fights at any distance.
      const edge = track.halfWidthAt(j.s) + MARKINGS.strip.width;
      parts.push(crossQuad(j.s, edge, outer + STREETS.half));
      if (j.minus) parts.push(crossQuad(j.s, -(outer + STREETS.half), -edge));
    }

    // One mesh for the entire network: ~70 pieces would otherwise be ~70
    // draw calls for a few thousand triangles of flat ground.
    const streets = new THREE.Mesh(mergeGeometries(parts)!, streetMat);
    streets.name = "streets";
    streets.receiveShadow = true;
    scene.add(streets);
    for (const g of parts) g.dispose();
  }

  // The Sharq plaza island's mosaic face — declared here beside the road
  // material because both register with the texture manifest below, and
  // the manifest is the drop-in point for authored artwork: name a file
  // under "plaza" and it becomes the roundabout's mosaic, no code needed.
  const plazaMosaicMat = new THREE.MeshStandardMaterial({
    color: 0xc9b48a,
    roughness: 0.9,
  });

  // Authored artwork wins over the procedural maps when it is present.
  // Nothing ships in public/textures/, so by default this is one 404 and
  // the road and mosaic above stand unchanged.
  void applyTextureManifest({ road: roadMat, plaza: plazaMosaicMat });

  /**
   * The white, and why it is not white.
   *
   * This was 0xf6f6f2 — 246 of 255, a reflectance of about 0.96, which
   * is not road paint. It is closer to fresh snow, and it is above what
   * any diffuse surface outdoors returns. Thermoplastic line paint is
   * 0.75 to 0.85 when it is laid and falls from there with traffic; the
   * reason a marking is the brightest thing on a night road is that it
   * is retroreflective back at your headlights, not that its albedo is
   * near one.
   *
   * Measured from the gameplay camera at 01:30, over the lower half of
   * the frame, sweeping this value:
   *
   *   0xf6f6f2   paint 244.9   2.03% of the street at 255
   *   0xdeded6         235.8   1.31%
   *   0xc9c9c2         231.8   0.82%
   *   0xb0b0a8         224.8   0.44%
   *
   * At 0.96 a fiftieth of the street is pinned at pure white, and a
   * pinned pixel has no tone left in it: it cannot take a shadow, it
   * cannot show wear, and it cannot get brighter under a lamp because it
   * is already at the ceiling. Dropping to 0xc9c9c2 halves that, leaves
   * the paint 231.8 against the road's 78 — still three times the
   * asphalt and still plainly the brightest thing out there — and moves
   * the street's own median by 2.7 of 255, which is nothing.
   */
  // Lifted one step inside the envelope measured above: 0xdeded6 measured
  // 1.31% of the lower frame pinned (the guard in tests/grade.mjs is 1.4),
  // and is linear 0.73, the low end of real thermoplastic (0xc9c9c2 is
  // 0.79 only as a byte; as light it is 0.58). The distance visibility
  // comes from the emissive floor rather than the albedo, so the near,
  // headlit paint does not clip: at 0xa8a8a0 x 0.5 an unlit line was
  // about 84 of 255 at the night exposure, a grey stripe.
  const lineMat = new THREE.MeshStandardMaterial({
    color: MARKINGS.paint.edge,
    emissive: 0xdcdcd4,
    emissiveIntensity: 0.6,
    roughness: 0.5,
  });
  const dashMat = new THREE.MeshStandardMaterial({
    // A touch duller than the edge line, as it was — a lane divide
    // takes more tyre than the edge does. See lineMat for why neither
    // of them is 0.96 white any more.
    color: MARKINGS.paint.lane,
    emissive: 0xd2d2ca,
    emissiveIntensity: 0.5,
    roughness: 0.55, // thermoplastic paint, slightly glossier than asphalt
  });
  // Paint on a side street is worn and lit by nothing but a passing
  // headlight, so it is dimmer than the highway's — the route you are
  // racing stays the brightest line in the scene.
  const streetLineMat = new THREE.MeshStandardMaterial({
    color: MARKINGS.paint.street,
    emissive: 0x6f6e68,
    emissiveIntensity: 0.35,
    roughness: 0.7,
  });
  // The raised studs on the edge lines. Emissive rather than
  // retroreflective, the same cheat the rail reflectors make and for the
  // same reason (see them below); 2.0 is the top of the band the
  // nightGlow rule dims by day, so a stud is a piece of plastic at noon.
  const studMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff2c0,
    emissiveIntensity: MARKINGS.stud.emissive,
  });

  // Every marking on the highway and the street grid, laid from one spec
  // table and one junction model (markings.ts): the edge lines with
  // their inner edge on the tarmac edge, the lane lines at the midpoints
  // of LANES and hidden through every signalised junction, the stop
  // lines, the solid approaches and the lane arrows, the studs, and the
  // street centre lines. The names are the ones the rest of the game
  // already finds them by — 'road-line', 'road-dash', 'street-dash' — and
  // the studs are 'road-stud' now, so the levels tool counts them as the
  // road they are rather than as "other". The paint is named alongside
  // the asphalt it sits on: it is the brightest thing on the road
  // surface, and a levels reading that leaves it out understates the
  // road's ceiling by most of what it has.
  //
  // No rand() in any of it. The world's stream is consumed in build
  // order (rand.ts), and paint that drew a number would move every
  // building placed after it.
  for (const o of buildRoadMarkings(track, STREETS, {
    line: lineMat,
    dash: dashMat,
    street: streetLineMat,
    stud: studMat,
  })) {
    scene.add(o);
  }

  // ------------------------------------------------------- the border
  //
  // The edge of the road, which is the thing a driver actually looks at
  // all night. It was one flat double-sided band 650 mm tall — a plank
  // on edge, no posts, no section, no reflectors — and a plank takes one
  // flat shade across its whole height, so a headlight sweeping along it
  // produced no event at all. A real barrier is three things, and each
  // of them does a different job in the dark:
  //
  //   the BEAM     corrugated, so the light catches two crests and holds
  //                a dark valley between them. That travelling highlight
  //                is most of what tells you how fast you are moving
  //                along a wall.
  //   the POSTS    a rhythm. Evenly spaced verticals are the only thing
  //                at the roadside that ticks past at a rate you can
  //                read, and a rail without them floats.
  //   the REFLECTORS  the one part of the border that is BRIGHT at
  //                night, and the reason you can see where a curve goes
  //                before your headlights reach it.
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x9aa2ab,
    roughness: 0.4,
    metalness: 0.7,
    side: THREE.DoubleSide,
  });
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x6b7178,
    roughness: 0.62,
    metalness: 0.55,
  });
  // Rail centre height. A W-beam's top edge sits between 700 and 810 mm
  // on a road like this, and the section is 312 mm deep, so a centre at
  // 620 puts the top at 776 — inside the real range, and close enough to
  // the old band's 950 mm top that nothing behind it is newly exposed.
  const RAIL_Y = 0.62;
  const POST_EVERY = 4;
  // Every fourth post, so 16 m — the spacing delineators actually run at,
  // and far enough apart that they read as a dotted line running ahead
  // into the dark rather than as a continuous glowing strip.
  const REFLECTOR_EVERY = 4;
  for (const edge of [-1, 1]) {
    const lateral: LatOffset = (s: number) => edge * (track.halfWidthAt(s) + 0.6);
    const rail = new THREE.Mesh(
      buildProfiled(
        track,
        lateral,
        // Lifted onto the rail's own height here rather than baking the
        // height into W_BEAM, so the section stays a section and can be
        // hung at whatever height a given barrier needs.
        W_BEAM.map(([out, up]) => [out, up + RAIL_Y] as [number, number]),
        edge,
        4
      ),
      railMat
    );
    // A rail casts AND receives: it is the nearest tall thing to the
    // road, so it takes the shadow of every pole and every car that
    // passes it, and it is where a shadow is read at eye height rather
    // than underfoot.
    rail.castShadow = true;
    rail.receiveShadow = true;
    rail.name = "guardrail";
    scene.add(rail);

    // Posts. A real one is a C-section channel; at the distance this is
    // ever seen from, a slim box with the right rhythm is the same
    // object, and it instances into a single draw.
    const postCount = Math.floor(L / POST_EVERY);
    const postGeo = new THREE.BoxGeometry(0.14, RAIL_Y + 0.16, 0.09);
    const posts = new THREE.InstancedMesh(postGeo, postMat, postCount);
    posts.castShadow = true;
    posts.receiveShadow = true;
    posts.name = "guardrail-post";

    // Reflectors. Emissive rather than physically retroreflective —
    // three.js has no retroreflection, and a material that is bright
    // only when the player's own beam hits it would need a shader of its
    // own. Emissive is the same cheat the cat's eyes on the edge lines
    // already make, and it reads correctly for the same reason: at night
    // the only light near them IS a headlight.
    //
    // Amber outbound, red on the seaward side, which is how a Gulf
    // carriageway is delineated — the colour tells you which edge you
    // are looking at when the road curves away.
    const reflectorCount = Math.floor(postCount / REFLECTOR_EVERY);
    // A tab standing above the rail, not a plate bolted to its face.
    //
    // The first version sat 85 mm out from the bolt line, which put it
    // 2 mm proud of a beam crest that stands at 83 — so every reflector
    // in the game was buried inside its own guardrail, and the frames
    // came back with a perfectly good barrier carrying no delineators at
    // all. Standing it above the beam's top edge means nothing can
    // occlude it from any angle, and it is also where half the real ones
    // are fitted: a small tab on a bracket, clear of the rail.
    //
    // Sized from a measurement, not from taste. With the tab standing
    // clear of the beam, a sweep of emissive intensity from 1.9 to 14 —
    // a seven-fold range — moved the pixels these own in the frame from
    // 33 to 40. Intensity was not the lever at all: at 30 x 140 mm they
    // were about five pixels each at 19 m, which is a faint dot rather
    // than the cue that shows you where a curve goes.
    //
    // 60 x 250 mm is a real roadside delineator panel — Gulf columns
    // carry them at that size and larger — and doubling the linear
    // dimension is four times the pixels.
    const refGeo = new THREE.BoxGeometry(0.03, 0.25, 0.06);
    const refMat = new THREE.MeshStandardMaterial({
      color: edge < 0 ? 0xff3a2a : 0xffb02a,
      emissive: edge < 0 ? 0xd42618 : 0xe08a10,
      emissiveIntensity: 1.9,
      roughness: 0.35,
      fog: false,
    });
    const reflectors = new THREE.InstancedMesh(refGeo, refMat, reflectorCount);
    reflectors.name = "guardrail-reflector";
    // ...and they stop glowing when the sun is up. A retroreflector in
    // daylight is a piece of coloured plastic, not a lamp. The studs on
    // the edge lines go the same way: their emissive is 2.0, inside the
    // band the nightGlow rule at the end of buildWorld dims by day.
    nightGlow.push({ mat: refMat, base: refMat.emissiveIntensity });

    const mp = new THREE.Vector3();
    const mside = new THREE.Vector3();
    const mtan = new THREE.Vector3();
    const mq = new THREE.Quaternion();
    const mm = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    const fwd = new THREE.Vector3(0, 0, 1);
    let ri = 0;
    for (let i = 0; i < postCount; i++) {
      const s = i * POST_EVERY;
      track.pose(s, latAt(lateral, s), mp, mside);
      track.tangentAt(s, mtan);
      mq.setFromUnitVectors(fwd, mtan);
      // Behind the beam: the post carries the rail, it does not stand in
      // front of it. Half the beam's own depth plus the post's.
      mp.x += mside.x * edge * 0.1;
      mp.z += mside.z * edge * 0.1;
      mp.y = (RAIL_Y + 0.16) / 2;
      mm.compose(mp, mq, one);
      posts.setMatrixAt(i, mm);

      if (i % REFLECTOR_EVERY === 0 && ri < reflectorCount) {
        // Clear of the beam's 776 mm top edge, on the bolt line.
        track.pose(s, latAt(lateral, s), mp, mside);
        mp.x -= mside.x * edge * 0.02;
        mp.z -= mside.z * edge * 0.02;
        mp.y = RAIL_Y + 0.23;
        mm.compose(mp, mq, one);
        reflectors.setMatrixAt(ri++, mm);
      }
    }
    posts.instanceMatrix.needsUpdate = true;
    reflectors.instanceMatrix.needsUpdate = true;
    scene.add(posts, reflectors);
  }

  // Streetlights: single-arm LED road lanterns on galvanised columns,
  // alternating sides
  {
    const spacing = LAMP_COLUMNS.spacing;
    const count = Math.floor(L / spacing);
    // Where each part of a column sits, in metres off the centre line and
    // up from the road. Named because four things below — the column, the
    // lens, the pool and the cone joining them — have to agree on them,
    // and a number written out four times is four places to change three.
    //
    // The column's own station: 1.6 m behind the kerb, clear of the rail.
    // 8.6 m, where it has always stood.
    const POLE_LAT = LAMP_COLUMNS.lat;
    // The centre of the pool on the asphalt: 4.6 m, over the outer lane,
    // 2.4 m inside the kerb. Also unchanged.
    const POOL_LAT = ROAD_HALF_WIDTH - 2.4;
    // How far the arm carries the lens toward the road from the column's
    // axis. 2.8 m puts the lens at 5.8 m off centre — 1.2 m inside the
    // kerb, over the outer lane — which is exactly where the wet-road
    // streaks further down already lie (ROAD_HALF_WIDTH - 1.2), and where
    // the Unreal port hangs its head (GRNWorldBuilder.cpp, the same
    // GRNRoadHalfWidth - 1.2).
    const LENS_OUT = 2.8;
    // The underside of the lens: the mounting height, in a lighting
    // engineer's terms, and the point the light comes from. 42 m spacing
    // over 12 m is a spacing-to-height ratio of 3.5, the bottom of the
    // 3.5-3.7 uniform-coverage band e1465eb3 raised the old heads into;
    // the blade, centred at 11.375 m, sat at 3.69.
    const LENS_LOW = 12.0;
    // The shaft alone. The arm springs from 9 cm below its top (11.76 m)
    // and rises to the lantern, so the shaft is 15 cm shorter than the
    // mounting height it carries.
    const SHAFT_H = 11.85;
    // An arm reaching out over the carriageway with a flat lens facing
    // down: the ordinary single-arm road lantern. This reverses f0e6cadc,
    // which stood the head up as a post-top blade on the ground that the
    // Gulf Road's own columns had been retrofitted that way — a claim
    // nothing here could check (track.ts records that no map or web data
    // was reachable from this environment), and one the rest of the
    // lighting was never built for. The pool on the asphalt sits 4 m
    // inboard of the column with nothing above it, which a blade standing
    // on top of the column cannot explain; the wet-road streaks were laid
    // 5.8 m out, for a head on an arm. The arm-hung lens is at 5.8 m:
    // straight over the streaks, and 1.2 m outboard of the pool's centre,
    // which is where an optic aimed down-and-in would land it.
    //
    // One merged mesh per column — shaft, base section, arm, housing and
    // lid — in a local frame with +x toward the road and the foot at y=0.
    // They share a material and never move apart, so merging them turns
    // what was three opaque draws (pole, shroud, hood) into one, and the
    // shadow pass still has exactly one caster for the whole lap.
    const columnGeo = mergeGeometries([
      // The shaft: an eight-sided taper, 0.34 m across at the foot and
      // 0.18 m at the top. Octagonal because that is what a folded-steel
      // lighting column is, and because eight facets throw a passing
      // headlight back as a thin travelling highlight, where the old
      // six-sided dark pole read as a painted stick.
      new THREE.CylinderGeometry(0.09, 0.17, SHAFT_H, 8).translate(0, SHAFT_H / 2, 0),
      // The base section: 0.8 m of wider sleeve at the foot (0.48 m
      // across at the ground), where a real column carries its access
      // door and cable joint. It is what makes the column stand ON the
      // verge rather than come up out of it.
      new THREE.CylinderGeometry(0.21, 0.24, 0.8, 8).translate(0, 0.4, 0),
      // The arm: a round tube raked 8.3° up toward the road, 0.10 m thick
      // at the column and 0.09 m at the lantern. rotateZ(-1.42598) lays
      // the cylinder's +y axis over by 81.7°, to 8.3° above horizontal on
      // the +x side, so its thin end points at the road. 2.4254 m is the
      // length that makes the axis run from (0, 11.76) — 9 cm down inside
      // the shaft top, so the joint shows no gap from any side — to
      // (2.40, 12.11), inside the housing: 2.40 m across and 0.35 m up,
      // and hypot(2.40, 0.35) = 2.4254. (1.2, 11.935) is its midpoint.
      new THREE.CylinderGeometry(0.045, 0.05, 2.4254, 6)
        .rotateZ(-1.42598)
        .translate(1.2, 11.935, 0),
      // The lantern housing: a flat box 0.92 m along the arm by 0.36 m
      // along the road and 0.13 m deep, spanning 2.34 to 3.26 m out and
      // 12.05 to 12.18 m up. Flat and level, because a full-cutoff
      // lantern sends nothing above the horizontal: the optic faces the
      // road and the housing over it is what keeps it off the sky. Its
      // road-side end, 3.26 m out, is the column's whole reach: 5.34 m off
      // the centre line, 1.66 m in over the outer lane and 1.84 m short of
      // the lane line at 3.5 m.
      new THREE.BoxGeometry(0.92, 0.13, 0.36).translate(LENS_OUT, 12.115, 0),
      // The lid: a thinner panel stepped in on top, 12.18 to 12.215 m, so
      // the fixture's top is 12.215 m. That step is what makes the head
      // read as a lantern at driving distance, instead of a box on the
      // end of a stick — the job the hood did for the old blade.
      new THREE.BoxGeometry(0.74, 0.035, 0.28).translate(LENS_OUT, 12.1975, 0),
    ]);
    // mergeGeometries returns null rather than throwing when the parts do
    // not share the same attributes. Box and cylinder are both indexed,
    // with position, normal and uv, so it cannot today; the throw is so
    // that if it ever does, it fails here, by name, rather than as a lap
    // of lamps floating on nothing that somebody has to notice.
    if (!columnGeo) throw new Error("street column merge failed");
    // Galvanised steel, weathered: a mid grey with some metal in it, not
    // the dark painted 0x3c4148 the post-tops wore. A hot-dip galvanised
    // column is pale by day and picks up the lamps and headlights at
    // night. Metalness 0.4 and no higher: a 9 cm arm and 18 cm shaft top
    // are a pixel or two wide at 40 m, and it is specular, not
    // geometry, that makes thin things crawl at speed — if the arm
    // shimmers, this is the number to lower (0.25).
    const columnMat = new THREE.MeshStandardMaterial({
      color: 0x7d838a,
      roughness: 0.55,
      metalness: 0.4,
    });
    const columns = new THREE.InstancedMesh(columnGeo, columnMat, count);
    // Named, because tests/bridges.mjs finds the columns by name. It used
    // to find them by their cylinder's height, and a merged geometry has
    // no `.parameters` — that test would have found none and passed.
    columns.name = "street-columns";
    // The lens: a flat panel facing straight down, 0.76 m along the arm by
    // 0.30 m along the road, set into the underside of the housing — 1 cm
    // up inside it and 5 cm proud below — so from the road it reads as a
    // bright slot under a dark lid. It spans 2.42 to 3.18 m out, 8 cm in
    // from each end of the housing and 3 cm in from its sides, and its
    // underside is LENS_LOW.
    // 0.06 m deep rather than thinner: worked out (not measured) at
    // 1080p, it is about 21 x 3 px at 40 m and 8 x 1 at 100 m, where a
    // 0.02 m lens falls under a pixel beyond about 50 m. Deeper, and it
    // hangs off the housing as a glowing slab.
    const lampGeo = new THREE.BoxGeometry(0.76, 0.06, 0.3).translate(LENS_OUT, LENS_LOW + 0.03, 0);
    const lampMat = new THREE.MeshStandardMaterial({
      // Cool white LED. Not paper white — a real 5000 K head still reads
      // faintly blue against a warm window, and that contrast is the
      // whole point of the change.
      color: 0xf4f8ff,
      emissive: 0xdfeaff,
      emissiveIntensity: 3.0,
      fog: false,
    });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, count);
    // The pool of lamplight thrown onto the asphalt below each lamp.
    //
    // 10.5 m was too small to be road lighting. Columns stand every 42 m
    // on ALTERNATING sides, so a 10.5 m pool leaves most of the
    // carriageway between two columns lit by nothing at all — and
    // tools/shots/dark.mjs found exactly that: the near-field asphalt
    // beside the car metering 4 of 255, with doubling the pool opacity
    // changing it by nothing, because the car was not standing in a pool
    // to begin with.
    //
    // Real road lighting is designed to a UNIFORMITY ratio rather than
    // to a peak: the point of the spacing is that adjacent pools overlap
    // and the driver never crosses a dark patch. 17 m does that here —
    // two columns 42 m apart on opposite verges throw overlapping 34 m
    // circles. The texture is a radial falloff, so widening it spreads
    // the skirt without making the centre any brighter.
    //
    // Not spacing/2, which is where the geometry says continuous cover
    // starts and which was tried. It is the wrong rule for a SOFT pool:
    // this texture is already down to 15% alpha at 62% of its radius, so
    // r = 21 does not light the last gap, it just pours another 23% onto
    // the middle of the road. Measured, that took the inland frame's
    // median tile from 0.184 to 0.227 — the night going milky — and
    // made things WORSE two viewpoints away, because auto-exposure is a
    // loop: light the road harder and the eye stops down, and whatever
    // was genuinely dark goes darker. 17 m cleared four fifths of the
    // dark tiles and left the median where it was.
    const poolGeo = new THREE.CircleGeometry(17, 26);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({
      map: lightPoolTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, count);
    // The visible shaft of lamplight: an open cone from the head to the
    // pool, wearing the same length-wise gradient the headlight beams
    // wear so it dissolves at both ends instead of ending in a rim.
    //
    // Exactly as long as the line from the lens's underside to the pool's
    // centre, so it starts on the one and ends on the other. The old cone
    // was 11.375 m long, centred on a line 11.98 m long, which left 0.3 m
    // of nothing at each end. This line runs 1.2 m in (lens at 5.8 m off
    // centre, pool at 4.6) and 11.955 m down (12.0 to the pool's 0.045),
    // so it is hypot(1.2, 11.955) = 12.015 m long and leans 5.73° off
    // vertical toward the road centre.
    const CONE_LEN = Math.hypot(POLE_LAT - LENS_OUT - POOL_LAT, LENS_LOW - 0.045);
    // 0.25 m at the head rather than 0.55: the source is a 0.76 x 0.30 m
    // lens now, not a 1.8 m blade standing up off the pole, and the gradient
    // spends the top quarter of the cone (3 m) fading in from nothing, so
    // the head end never shows as a rim. 5.2 m at the road, stretched by
    // coneScl below to sit on the pool.
    const coneGeo = new THREE.CylinderGeometry(0.25, 5.2, CONE_LEN, 12, 1, true);
    // Not a MeshBasicMaterial: see lampShaftMaterial for the hard sheets
    // that drew.
    const coneMat = lampShaftMaterial();
    const cones = new THREE.InstancedMesh(coneGeo, coneMat, count);
    const poolQ = new THREE.Quaternion();
    const poolScl = new THREE.Vector3(1, 1, 1);
    const zAxis2 = new THREE.Vector3(0, 0, 1);
    const coneP = new THREE.Vector3();
    const coneMid = new THREE.Vector3();
    const coneDir = new THREE.Vector3();
    const coneQ = new THREE.Quaternion();
    const yDown = new THREE.Vector3(0, -1, 0);
    // The cone's foot stretched to the pool's bright core rather than left
    // a 5.2 m circle. The pool texture is at 40% alpha at 0.34 of its
    // 17 m radius, 5.78 m, and the pool is scaled 0.85 across and 1.55
    // along the road, so that contour is an ellipse 4.91 m across by
    // 8.96 m along (half-axes). 0.95 and 1.75 put the cone's 5.2 m foot at
    // 4.94 by 9.10: on it. Along the road is also along the chase
    // camera's line of sight, so the extra length is mostly seen end-on
    // and adds little to the lit area the exposure meters.
    // 1.3 along rather than 1.75: the long foot is seen end-on from the
    // chase camera, and end-on is where the shafts down the road stacked.
    const coneScl = new THREE.Vector3(0.95, 1, 1.3);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const tanV = new THREE.Vector3();
    const sideV = new THREE.Vector3();
    const armMid = new THREE.Vector3();
    const armQ = new THREE.Quaternion();
    const xAxis = new THREE.Vector3(1, 0, 0);
    const unitV = new THREE.Vector3(1, 1, 1);
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const lampPositions: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const s = i * spacing;
      // No street columns inside the tunnel — and none under a flyover
      // either. A column is 11.85 m (12.2 m to the top of the lantern,
      // which reaches 3.3 m toward the road) and a deck soffit is at 6.4,
      // so an unfiltered column grows straight through the bridge; real
      // lighting stops short of a structure and the structure carries its
      // own, which is what flyover() puts on the parapet.
      if (!lampColumnStands(track, s)) {
        columns.setMatrixAt(i, hidden);
        lamps.setMatrixAt(i, hidden);
        pools.setMatrixAt(i, hidden);
        cones.setMatrixAt(i, hidden);
        continue;
      }
      const sideSign = i % 2 === 0 ? 1 : -1;
      track.pose(s, sideSign * POLE_LAT, p, tmp);

      // One yaw per column, and nothing else: the column, its arm and its
      // lens are all built into their geometry in a frame whose +x points
      // at the road, so a single rotation about the vertical turns the
      // whole fixture to face the carriageway and keeps the lens level —
      // the lantern and the lens share this one matrix.
      track.tangentAt(s, tanV);
      tanV.y = 0;
      tanV.normalize();
      // Unit vector for +lat is (-Tz, 0, Tx); sideV is its opposite times
      // sideSign, i.e. from the column toward the centre line on either
      // verge.
      sideV.set(tanV.z * sideSign, 0, -tanV.x * sideSign).normalize();
      armQ.setFromUnitVectors(xAxis, sideV);
      // The foot on the ground: the geometry rises from y = 0.
      armMid.set(p.x, 0, p.z);
      m.compose(armMid, armQ, unitV);
      columns.setMatrixAt(i, m);
      lamps.setMatrixAt(i, m);
      // Where the lens is in the world, taken now, before the pool's pose
      // below overwrites p: LENS_OUT along sideV from the column's foot,
      // 5.8 m off the centre line.
      const lx = p.x + sideV.x * LENS_OUT;
      const lz = p.z + sideV.z * LENS_OUT;
      // The corona and glint sit 1.5 cm under the lens's underside, at
      // 11.985 m: close enough to read as the lens glowing, low enough
      // that the housing above clips the top of the glow.
      lampPositions.push(new THREE.Vector3(lx, LENS_LOW - 0.015, lz));
      // And the lens itself, for what the lamps light that is not drawn
      // here (the engine's tyre smoke): the underside, where the light
      // leaves the fixture.
      streetLamps.push(new THREE.Vector3(lx, LENS_LOW, lz));

      // The pool lands under the head and spills toward the road centre
      // (the head's optic faces down-and-in, not straight down): its
      // centre is POOL_LAT, 1.2 m inboard of the lens above it.
      //
      // An ELLIPSE down the road, not a circle. A road lantern's optic
      // is designed to throw along the carriageway — that is the whole
      // trade of the cutoff shroud — and the dark patches this lighting
      // has are BETWEEN columns, along the road, by construction of the
      // 42 m spacing. Stretching the same texture 1.55x along the
      // tangent and pulling it 0.85x across puts the extra light
      // exactly on the inter-column gap, while the across-the-road
      // spill — the direction where more light just pours onto the
      // middle and turns the night milky, which is the mistake this
      // block's history warns about twice — actually shrinks.
      track.pose(s, sideSign * POOL_LAT, p, tmp);
      poolQ.setFromUnitVectors(zAxis2, tanV);
      poolScl.set(0.85, 1, 1.55);
      p.y = 0.045;
      streetLampPools.push(new THREE.Vector3(p.x, 0, p.z));
      m.compose(p, poolQ, poolScl);
      pools.setMatrixAt(i, m);

      // The light itself, faintly visible in the air. Kuwait's summer
      // haze is dust, and dusty air is what a beam cone reads as — the
      // same trick the headlights use, an additive gradient that fades
      // to nothing at both ends. Kept very quiet: the cone is scenery,
      // and at additive opacity this low the exposure loop does not
      // move for it.
      //
      // Hung from the lens's underside to the pool's centre, and centred
      // halfway between them (6.0225 m up), so both ends land exactly.
      coneP.set(lx, LENS_LOW, lz);
      coneMid.addVectors(coneP, p).multiplyScalar(0.5);
      coneDir.subVectors(p, coneP).normalize();
      // The yaw first — poolQ, the same turn that lays the pool's long axis
      // down the road — so coneScl's 1.75 stretch lies along the tangent;
      // then the tilt that swings the cone's axis from straight down onto
      // the lens-to-pool line. That line is in the vertical plane across
      // the road, so the tilt is a 5.73° turn about the tangent itself and
      // leaves the stretch where the yaw put it. (q.multiply(r) applies r
      // first.)
      coneQ.setFromUnitVectors(yDown, coneDir).multiply(poolQ);
      m.compose(coneMid, coneQ, coneScl);
      cones.setMatrixAt(i, m);
    }
    columns.instanceMatrix.needsUpdate = true;
    // Wet-look smears: each lamp drags a long reflection down the road
    // surface — the single cheapest thing that sells night asphalt.
    const streakGeo = new THREE.PlaneGeometry(1.4, 12);
    streakGeo.rotateX(-Math.PI / 2); // lie on the road, length along Z
    const streakMat = new THREE.MeshBasicMaterial({
      map: lightStreakTexture(),
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const streaks = new THREE.InstancedMesh(streakGeo, streakMat, count);
    lampStreaks = streaks;
    const q = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    const scl = new THREE.Vector3(1, 1, 1);
    const tan = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const s2 = i * spacing;
      const u2 = s2 / L;
      // The same stations the columns skip, flyovers included. With the
      // tunnel alone, six smears a lap lay on the road near a flyover
      // with no lamp standing over them to cast them — a reflection of
      // nothing.
      if ((u2 > TUNNEL_U.from - 0.004 && u2 < TUNNEL_U.to + 0.004) || underFlyover(track, s2)) {
        streaks.setMatrixAt(i, hidden);
        continue;
      }
      const sideSign = i % 2 === 0 ? 1 : -1;
      // Inset from the kerb so a straight smear never crosses the rail
      // when the road bends underneath it. 5.8 m off centre, which is
      // also POLE_LAT - LENS_OUT: each smear lies straight under its lens.
      track.pose(s2, sideSign * (ROAD_HALF_WIDTH - 1.2), p, tmp);
      track.tangentAt(s2, tan);
      tan.y = 0;
      tan.normalize();
      q.setFromUnitVectors(zAxis, tan);
      // The smear starts under the lamp and trails backwards down the road
      p.y = 0.05;
      p.addScaledVector(tan, -5);
      m.compose(p, q, scl);
      streaks.setMatrixAt(i, m);
    }
    streaks.instanceMatrix.needsUpdate = true;

    lamps.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;
    cones.instanceMatrix.needsUpdate = true;
    // Sorted with the other transparencies, drawn after the road it
    // stands on; never a shadow caster — it IS light.
    cones.renderOrder = 2;
    // The column, arm and lantern cast as one; still the lap's only
    // street-lighting shadow caster, as the bare pole was.
    columns.castShadow = true;
    // In this order on purpose: the pools must stay the first additive,
    // textured InstancedMesh in the scene, which is how tests/daynight.mjs
    // finds the lamp pool to read its opacity.
    scene.add(columns, lamps, pools, cones, streaks);
    // The paint's probe sits inside the shaft it is passing under, where
    // a cone is nothing but its own near walls.
    probeHide.push(cones);
    // LED coronas under every lens
    // Tight: 2.8 m. A 4.6 m round corona was all you saw of a head up
    // close. The points sit 1.5 cm below the lens, and a point sprite is
    // depth-tested at its centre's depth, so the near half of the housing
    // — up to 18 cm closer to the camera than the point, from any side —
    // draws over the top of the glow as a dark bar: a bright underside
    // with a hard edge above it, which is what reads as a cutoff lantern
    // rather than a bulb. The arm and lid carry the fixture's shape at
    // distance, where the corona alone used to be the whole silhouette.
    const lampCoronas = coronaPoints(lampPositions, 0xdbe7ff, 2.8);
    lampCoronaPts = lampCoronas;
    probeHide.push(lampCoronas);
    scene.add(lampCoronas);
    // Star glints: the sparkle each bright source throws at the lens
    {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(lampPositions.length * 3);
      lampPositions.forEach((lp, i) => {
        pos[i * 3] = lp.x;
        pos[i * 3 + 1] = lp.y;
        pos[i * 3 + 2] = lp.z;
      });
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      glintMat = new THREE.PointsMaterial({
        map: glintTexture(),
        color: 0xe6eeff,
        size: 2.6,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const glints = new THREE.Points(geo, glintMat);
      glints.frustumCulled = false;
      probeHide.push(glints);
      scene.add(glints);
    }
    shimmerLampMat = lampMat;
    lampPoolMat = poolMat;
    lampConeMat = coneMat;
  }

  // ------------------------------------------------- traffic signals
  //
  // The junctions were painted before there was anything to obey. A
  // signal head on a mast arm over the carriageway, at every
  // other cross street — signalising all seventy-two would put a gantry
  // every 118 m, which is denser than any real arterial and would make
  // the road read as a car park.
  //
  // The three aspects are one instanced mesh of lenses coloured per
  // instance. An emissive material cannot vary per instance in three,
  // so a shared one would light every red in the city at the same
  // moment; an unlit lens tinted through instanceColor can differ
  // junction by junction, and a lit lamp lens is close to unlit anyway.
  //
  // Which junctions are signalised is the junction model's answer
  // (markings.ts), the same list that lays their stop lines: every other
  // cross street, clear of the tunnel and of every swell. This loop used
  // to make its own, from the constant half-width, and so put a pair of
  // masts on the paint shop's 16.6 m forecourt at junction 50 — 33
  // junctions and 66 heads now, against 34 and 68.
  {
    const approaches: Array<{ s: number; sideSign: number }> = [];
    for (const j of junctions(track, STREETS)) {
      if (!j.signalised) continue;
      for (const sideSign of [1, -1]) approaches.push({ s: signalHeadS(j), sideSign });
    }
    const n = approaches.length;
    const steel = new THREE.MeshStandardMaterial({ color: 0x2f343a, roughness: 0.65 });

    const poleGeo = new THREE.CylinderGeometry(0.11, 0.17, 6.4, 8);
    const armGeo = new THREE.CylinderGeometry(0.085, 0.105, 4.6, 6);
    armGeo.rotateZ(Math.PI / 2); // lies along local X
    const boxGeo = new THREE.BoxGeometry(0.42, 1.22, 0.3);
    const visorGeo = new THREE.BoxGeometry(0.5, 1.3, 0.05);
    const poles = new THREE.InstancedMesh(poleGeo, steel, n);
    const arms = new THREE.InstancedMesh(armGeo, steel, n);
    const boxes = new THREE.InstancedMesh(boxGeo, steel, n);
    // A backboard behind the head, which is what makes a signal legible
    // against a lit city — the reason real ones have them.
    const visors = new THREE.InstancedMesh(visorGeo, steel, n);

    const lensGeo = new THREE.SphereGeometry(0.17, 10, 8);
    const lensMat = new THREE.MeshBasicMaterial({ fog: false, toneMapped: false });
    const lenses = new THREE.InstancedMesh(lensGeo, lensMat, n * 3);
    // A halo on the lit aspect, facing the traffic it is stopping. A
    // 0.17 m lens on a dark housing against a dark sky is six pixels at
    // forty metres — the head was in exactly the right place and could
    // not be seen, which is not much of a traffic light.
    const haloGeo = new THREE.PlaneGeometry(0.95, 0.95);
    const haloMat = new THREE.MeshBasicMaterial({
      map: pointGlowTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const halos = new THREE.InstancedMesh(haloGeo, haloMat, n * 3);

    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const inward = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const xAxis = new THREE.Vector3(1, 0, 0);
    const zAxis = new THREE.Vector3(0, 0, 1);
    const faceQ = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const headPos: THREE.Vector3[] = [];

    approaches.forEach(({ s: js, sideSign }, i) => {
      track.tangentAt(js, tan);
      tan.y = 0;
      tan.normalize();
      inward.set(tan.z * sideSign, 0, -tan.x * sideSign).normalize();
      q.setFromUnitVectors(xAxis, inward);

      // The pole stands back behind the kerb; the head hangs over the
      // inside lane, over the cross street's centreline. The stop line is
      // 13 m upstream (MARKINGS.stop), so a driver stopped at it has the
      // head 12.85 m ahead — inside MUTCD's 12.2-55 m, and above the
      // windscreen header rather than behind it. The constant half-width
      // is honest here: no signalised junction has a swell within 45 m
      // before it or 10 m after (junctions()). SIGNALS.poleLat is the
      // same ROAD_HALF_WIDTH + 1.2, shared with palmFixtures.
      track.pose(js, sideSign * SIGNALS.poleLat, p, tmp);
      m.makeTranslation(p.x, 3.2, p.z);
      poles.setMatrixAt(i, m);

      track.pose(js, sideSign * (ROAD_HALF_WIDTH - 2.4), p, tmp);
      const hx = p.x, hz = p.z;
      track.pose(js, sideSign * (ROAD_HALF_WIDTH - 0.6), p, tmp);
      p.set((p.x + hx) / 2, 6.3, (p.z + hz) / 2);
      m.compose(p, q, one);
      arms.setMatrixAt(i, m);

      p.set(hx, 5.45, hz);
      m.compose(p, q, one);
      boxes.setMatrixAt(i, m);
      // Backboard a hair behind the head, on the away side
      p.set(hx + inward.x * 0.17, 5.45, hz + inward.z * 0.17);
      m.compose(p, q, one);
      visors.setMatrixAt(i, m);

      // Red on top, amber, green — the order everywhere in the world.
      // The halo squares up to the traffic rather than to the head, so
      // it reads as a light coming at you down the road.
      faceQ.setFromUnitVectors(zAxis, tmp.copy(tan).multiplyScalar(-1));
      for (let a = 0; a < 3; a++) {
        p.set(hx - inward.x * 0.17, 5.45 + 0.4 - a * 0.4, hz - inward.z * 0.17);
        m.compose(p, q, one);
        lenses.setMatrixAt(i * 3 + a, m);
        p.addScaledVector(tan, -0.12);
        m.compose(p, faceQ, one);
        halos.setMatrixAt(i * 3 + a, m);
      }
      headPos.push(new THREE.Vector3(hx, 5.45, hz));
    });
    for (const im of [poles, arms, boxes, visors, lenses, halos]) im.instanceMatrix.needsUpdate = true;
    poles.castShadow = true;
    scene.add(poles, arms, boxes, visors, lenses, halos);

    // Each junction runs its own clock. Coordinating them would be a
    // green wave, which is a nicer thing and a much bigger one; running
    // them in lockstep would be worse than either, because a whole city
    // changing colour at once is the one arrangement that never happens.
    const CYCLE = 19;
    const offsets = approaches.map((_, i) => ((i * 7.31) % CYCLE));
    const DARK = new THREE.Color(0x14161a);
    const BLACK = new THREE.Color(0x000000);
    const LIT = [new THREE.Color(0xff2a1e), new THREE.Color(0xffab12), new THREE.Color(0x2be561)];
    const col = new THREE.Color();
    signalTick = (t: number) => {
      for (let i = 0; i < n; i++) {
        const phase = (t + offsets[i]) % CYCLE;
        // green 8, amber 2, red 9 — and the red is longest because it
        // has to cover the cross street's green plus both clearances.
        const on = phase < 8 ? 2 : phase < 10 ? 1 : 0;
        for (let a = 0; a < 3; a++) {
          const lit = a === on;
          col.copy(lit ? LIT[a] : DARK);
          lenses.setColorAt(i * 3 + a, col);
          // The halo is only there for the aspect that is showing; the
          // other two have to be fully off, not merely dim, or every
          // head wears three ghosts.
          col.copy(lit ? LIT[a] : BLACK);
          halos.setColorAt(i * 3 + a, col);
        }
      }
      if (lenses.instanceColor) lenses.instanceColor.needsUpdate = true;
      if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
    };
    signalTick(0);
  }

  // City blocks with lit windows
  const windows = windowTextures();
  {
    const count = 340; // more blocks now that they are visible much further
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    // The lit windows were painted into the ALBEDO and nothing else, so
    // after dark a "lit" window was a pale diffuse patch standing in
    // shadow: buildings measured 85% of their pixels at 0/255 with a
    // ceiling of 194, which is a black cut-out with a moonlit edge. The
    // same texture drives emission, so the windows are light sources.
    // Intensity rides the hour — see setTimeOfDay — because a window
    // that glows at noon reads as a mistake.
    const mat = glazedMat(windows, 0xffffff, 0.8);
    facadeUvScaling(mat);
    litFacades.push(mat);
    const blocks = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const tint = new THREE.Color();
    /** Instances actually written — see the skip below. */
    let placed = 0;
    /**
     * Every placed building's footprint, kept so the roof can be built
     * after the fact.
     *
     * A block was one BoxGeometry scaled per instance: a featureless
     * extrusion with a dead flat top, and a skyline made of them is a row
     * of rectangles cut out of the sky. Real buildings are a stack — a
     * shaft, a parapet capping it, plant on the roof, and a setback where
     * they get tall — and it is the stack that makes a silhouette.
     *
     * Recorded rather than recomputed because the placement loop skips
     * blocks that would land on a forecourt or in too thin a band, so the
     * instance index and the loop index are not the same number, and the
     * seeded stream cannot be replayed to find out where they went.
     */
    const massing: Array<{
      p: THREE.Vector3;
      q: THREE.Quaternion;
      depth: number;
      width: number;
      h: number;
      setback: boolean;
      podium: boolean;
      plant: boolean;
      mast: boolean;
      tint: THREE.Color;
      r: number[];
    }> = [];
    // Facade variety: concrete grey to warm beige to blue glass
    const palette = [0x8a8f99, 0x9c937e, 0x7c828e, 0x6e7686, 0xa39a85];
    // The blocks the street grid cuts the city into.
    //
    // Each entry is the band of `lat` between one street's far kerb and
    // the next street's near kerb — the buildable depth of a block. The
    // last one is the deep skyline beyond the outermost avenue, which is
    // scenery rather than street frontage.
    const rings: Array<[number, number]> = [];
    {
      let prev = ROAD_HALF_WIDTH + 4; // clear of the shoulder and the lamps
      for (const d of STREETS.avenues) {
        rings.push([prev, d - STREETS.half]);
        prev = d + STREETS.half;
      }
      rings.push([prev, prev + 130]);
    }
    const crossCount = Math.round(L / STREETS.crossEvery);
    const blockLen = L / crossCount;

    for (let i = 0; i < count; i++) {
      // Pick a block: which segment between cross streets, and which
      // band between avenues. Buildings used to be dropped at a random
      // distance out and spun to a random angle, which is why the city
      // read as scattered boxes — several of them standing inside each
      // other, none of them facing anything.
      const blockIndex = Math.floor(rand() * crossCount);
      const [lo, hi] = rings[Math.floor(rand() * rings.length)];
      const depth = Math.min(hi - lo - 5, 12 + rand() * 20);
      const width = 12 + rand() * 20;
      // Along the block, clear of the cross street at either end.
      const room = blockLen - 2 * STREETS.half - width;
      // A band too thin to build in, or a footprint too long for the
      // block. Skipping has to advance a WRITE cursor rather than the
      // loop counter: an instance whose matrix is never set keeps the
      // identity, which is a 1 m cube sitting at the world origin.
      if (depth < 6 || room < 2) continue;
      const s =
        blockIndex * blockLen + STREETS.half + width / 2 + rand() * room;
      // Not on a forecourt, or in the painter's bay. The station occupies
      // the first band of the block — the one between the shoulder and
      // the first avenue — and the block picker has no idea it is there,
      // so a tower would go up through the canopy about one time in
      // twenty.
      if (onForecourt(track, s, width / 2, lo, hi)) continue;
      const u = track.wrap(s) / L;
      // Never on the sea side of the corniche; both sides inland.
      const onCoast = u >= COAST_U.from && u <= COAST_U.to;
      const sideSign = onCoast ? 1 : rand() < 0.5 ? 1 : -1;
      // Set against the near kerb, so the block has a street frontage
      // and a soft interior rather than one row of floating towers.
      const inset = 2 + rand() * Math.max(0, hi - lo - depth - 4);
      const lat = lo + inset + depth / 2;
      // How wide the road is HERE, not how wide it usually is.
      //
      // The bands above start at ROAD_HALF_WIDTH + 4, a constant — and
      // the road is not a constant width. It swells from 7 m to 19 m at
      // the Sharq drift plaza, so a band that clears the highway
      // everywhere else runs straight across the plaza, and a building
      // landed on it: measured at s=540, lat 18.02, with the road's own
      // half-width 18.00 at that point.
      //
      // It only showed up when the seeding made the city repeatable and
      // this change shifted which blocks got placed. Before that it was
      // a coin flip nobody could reproduce.
      if (lat - depth / 2 < track.halfWidthAt(s) + 4) continue;
      track.pose(s, sideSign * lat, p, tmp);
      // pose() returns the ROAD's height, and the city floor is not the
      // road: it sits CITY_GROUND_Y below it so the two do not z-fight.
      // Placed at the road's y, every one of these floated 80 mm above
      // the ground with the dark floor visible underneath. The base goes
      // below the floor and the shaft grows by the same amount, so the
      // roofline — and the parapet, plant and mast stacked on it, which
      // are all positioned as p.y + h — do not move at all.
      p.y = CITY_GROUND_Y - BUILDING_FOOTING_M;
      // Square to the street. Local +Z runs along the road, so the box's
      // Z extent is its frontage and its X extent is its depth.
      track.tangentAt(s, tmp);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tmp.x, tmp.z));
      // Taller skyline near the city at the top of the lap
      const cityBoost = u > 0.88 || u < 0.06 ? 2.1 : 1;
      // Two heights, deliberately. `hArch` is how tall the building is —
      // what the podium, setback and mast thresholds below are written
      // against, and inflating it would quietly change which blocks get
      // which stack. `h` is how tall the box has to be DRAWN now that its
      // base starts below the floor, so the roofline lands in exactly the
      // same place it did before.
      const hArch = (10 + rand() * rand() * 55) * cityBoost;
      const h = hArch - p.y;
      scale.set(depth, h, width);
      m.compose(p, q, scale);
      blocks.setMatrixAt(placed, m);
      tint.setHex(palette[i % palette.length]).multiplyScalar(0.85 + rand() * 0.3);
      blocks.setColorAt(placed, tint);
      // What the roof needs, worked out here where the footprint and the
      // orientation are still in hand. A building is a stack, not a box —
      // see the massing block below.
      massing.push({
        p: p.clone(),
        q: q.clone(),
        depth,
        width,
        h,
        // A podium: the wide low base a Gulf tower actually rises from
        // — retail at the street, the shaft set back on top of it. It
        // is the piece of real massing the driver is closest to, and
        // the piece a bare extrusion most obviously lacks. Only where
        // there is room: the base grows 5 m each way, and growing over
        // the kerb line would put a shopfront in the traffic.
        podium: hArch > 42 && rand() < 0.5 && lat - depth / 2 - 5 > track.halfWidthAt(s) + 4,
        // From 52 down to 40: at 52 only the top decile stepped and the
        // skyline was one register of extruded rectangles — "boxy" is
        // exactly the complaint a skyline with one register earns.
        setback: hArch > 40 && rand() < 0.8,
        plant: rand() < 0.55,
        mast: hArch > 70 && rand() < 0.5,
        tint: tint.clone(),
        r: [rand(), rand(), rand(), rand()],
      });
      placed++;
    }
    // Draw only what was written; the tail of the buffer is untouched.
    blocks.count = placed;
    blocks.instanceMatrix.needsUpdate = true;
    if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
    blocks.castShadow = true;
    blocks.receiveShadow = true;
    // Named for the street test, which otherwise has to guess which
    // instanced box mesh in the scene is the city — and guessed wrong.
    blocks.name = "cityBlocks";

    // ------------------------------------------------------- the massing
    //
    // Four instanced meshes, built from the footprints recorded above, so
    // a building stops being an extrusion and becomes a building:
    //
    //   parapet  the lip every flat roof has, standing proud of the
    //            facade. It is the single cheapest thing that stops a
    //            block reading as a cut-out — a roof edge catches light
    //            from a different angle than the wall under it, and
    //            without one a facade simply ends.
    //   setback  tall blocks step in as they rise, which is what makes a
    //            skyline a skyline rather than a bar chart. Wearing the
    //            same lit-window facade as the shaft, so the upper floors
    //            are lit too.
    //   plant    the lift motor room, the tanks, the ducting. Every flat
    //            roof in the world has a shed on it and almost no
    //            rendered one does.
    //   mast     an aerial on the tallest, which is what actually breaks
    //            the horizontal on a distant skyline.
    //
    // All four instanced, so the whole thing costs four draw calls for
    // three hundred and thirty-nine buildings.
    {
      const capGeo = new THREE.BoxGeometry(1, 1, 1);
      capGeo.translate(0, 0.5, 0);
      const concrete = new THREE.MeshStandardMaterial({
        color: 0x8d9199,
        roughness: 0.92,
        // See the note on glazedMat's envMapIntensity: darkbuildings.mjs
        // confirmed a facing-dependent gap at midnight, and this and
        // plantMat are the massing's own unmeasured-default surfaces.
        envMapIntensity: 1.5,
      });
      const plantMat = new THREE.MeshStandardMaterial({
        color: 0x70747c,
        roughness: 0.95,
        envMapIntensity: 1.5,
      });
      const mastMat = new THREE.MeshStandardMaterial({
        color: 0x4a4f57,
        roughness: 0.7,
        metalness: 0.5,
      });

      // Which shaft each piece belongs to, published rather than left to
      // be guessed from geometry later.
      //
      // Buildings are allowed to overlap each other's footprints, so
      // "the shaft nearest this roof piece" and "the shaft whose bounds
      // contain it" are both wrong often enough to matter — a test that
      // guessed reported a parapet floating 0.286 m above its roof and a
      // plant room hanging off a roof it was sitting in the middle of.
      // The builder knows the answer exactly, so it says so.
      const setbackOf: number[] = [];
      const plantOf: number[] = [];
      const mastOf: number[] = [];
      const podiumOf: number[] = [];
      const setbacks: typeof massing = [];
      const plants: typeof massing = [];
      const masts: typeof massing = [];
      const podiums: typeof massing = [];
      massing.forEach((b, i) => {
        if (b.setback) { setbacks.push(b); setbackOf.push(i); }
        if (b.plant) { plants.push(b); plantOf.push(i); }
        if (b.mast) { masts.push(b); mastOf.push(i); }
        if (b.podium) { podiums.push(b); podiumOf.push(i); }
      });

      const parapetMesh = new THREE.InstancedMesh(capGeo, concrete, massing.length);
      const setbackMesh = new THREE.InstancedMesh(capGeo, mat, Math.max(1, setbacks.length));
      // The podium wears the same glazed skin as the shaft: at street
      // level the lit ground floors ARE the shopfronts.
      const podiumMesh = new THREE.InstancedMesh(capGeo, mat, Math.max(1, podiums.length));
      const plantMesh = new THREE.InstancedMesh(capGeo, plantMat, Math.max(1, plants.length));
      const mastMesh = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.18, 0.3, 1, 6),
        mastMat,
        Math.max(1, masts.length)
      );

      const mm = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const sc = new THREE.Vector3();
      /** A point on the roof, in the building's own frame. */
      const onRoof = (b: (typeof massing)[number], dx: number, dz: number, y: number) => {
        pos.set(dx, 0, dz).applyQuaternion(b.q).add(b.p);
        pos.y = b.p.y + y;
        return pos;
      };

      massing.forEach((b, i) => {
        // Parapet: 30 cm proud of the facade all round, 90 cm tall,
        // sitting ON the roof rather than replacing its top.
        sc.set(b.depth + 0.6, 0.9, b.width + 0.6);
        mm.compose(onRoof(b, 0, 0, b.h), b.q, sc);
        parapetMesh.setMatrixAt(i, mm);
        parapetMesh.setColorAt(i, b.tint);
      });

      setbacks.forEach((b, i) => {
        // The upper block steps in on all four sides and takes a third
        // of the height with it.
        const inset = 0.22 + b.r[0] * 0.16;
        const up = b.h * (0.24 + b.r[1] * 0.2);
        sc.set(b.depth * (1 - inset), up, b.width * (1 - inset));
        mm.compose(onRoof(b, 0, 0, b.h + 0.9), b.q, sc);
        setbackMesh.setMatrixAt(i, mm);
        setbackMesh.setColorAt(i, b.tint);
      });

      podiums.forEach((b, i) => {
        // Wide, low, and square to the same street the shaft is: 5 m of
        // apron each way and two storeys and a bit of height, with its
        // own parapet line implied by the shaft rising out of it.
        const ph = 6.5 + b.r[3] * 3.5;
        sc.set(b.depth + 10, ph, b.width + 10);
        mm.compose(onRoof(b, 0, 0, 0), b.q, sc);
        podiumMesh.setMatrixAt(i, mm);
        podiumMesh.setColorAt(i, b.tint);
      });

      plants.forEach((b, i) => {
        // Off-centre, because a plant room is where the lift shaft is and
        // a lift shaft is never in the middle.
        const pw = b.depth * (0.2 + b.r[2] * 0.22);
        const pd = b.width * (0.2 + b.r[3] * 0.22);
        const ph = 2.2 + b.r[0] * 2.6;
        const dx = (b.r[1] - 0.5) * (b.depth - pw) * 0.7;
        const dz = (b.r[2] - 0.5) * (b.width - pd) * 0.7;
        // On top of the setback if there is one, or on the main roof.
        const base = b.setback ? b.h + 0.9 + b.h * (0.24 + b.r[1] * 0.2) : b.h + 0.9;
        sc.set(pw, ph, pd);
        mm.compose(onRoof(b, dx, dz, base), b.q, sc);
        plantMesh.setMatrixAt(i, mm);
      });

      masts.forEach((b, i) => {
        const mh = 6 + b.r[3] * 12;
        const base = b.setback ? b.h + 0.9 + b.h * (0.24 + b.r[1] * 0.2) : b.h + 0.9;
        sc.set(1, mh, 1);
        mm.compose(onRoof(b, 0, 0, base + mh / 2), b.q, sc);
        mastMesh.setMatrixAt(i, mm);
      });

      for (const im of [parapetMesh, setbackMesh, plantMesh, mastMesh, podiumMesh]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = true;
        im.receiveShadow = true;
        scene.add(im);
      }
      parapetMesh.count = massing.length;
      setbackMesh.count = setbacks.length;
      plantMesh.count = plants.length;
      mastMesh.count = masts.length;
      podiumMesh.count = podiums.length;
      // Named so the building tests can find them, and so the ID pass in
      // the sharpness tool counts a roof as part of its building.
      parapetMesh.name = "cityParapets";
      setbackMesh.name = "citySetbacks";
      plantMesh.name = "cityPlant";
      mastMesh.name = "cityMasts";
      podiumMesh.name = "cityPodiums";
      // Instance i of each of these stands on instance ownerOf[i] of
      // cityBlocks. A parapet is one per shaft, so its map is the
      // identity.
      parapetMesh.userData.ownerOf = massing.map((_, i) => i);
      setbackMesh.userData.ownerOf = setbackOf;
      plantMesh.userData.ownerOf = plantOf;
      mastMesh.userData.ownerOf = mastOf;
      podiumMesh.userData.ownerOf = podiumOf;
      litFacades.push(concrete);
    }
    scene.add(blocks);

    // ------------------------------------------- the octagonal towers
    //
    // Every shaft so far is a rectangle, and a skyline of rectangles at
    // one register is the definition of boxy. Real Gulf skylines carry a
    // second vocabulary — drums, chamfered towers, the round-cornered
    // residential slabs of Salmiya — so about two dozen towers go up as
    // eight-sided prisms instead. Placed by the same block rules as the
    // rectangles (same rings, same forecourt avoidance, same kerb
    // check), wearing the same glazed skin, so they are of the same
    // city rather than dropped into it.
    {
      const octGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
      octGeo.translate(0, 0.5, 0);
      const octs = new THREE.InstancedMesh(octGeo, mat, 26);
      // Same concrete as the roof furniture — its sibling material is
      // scoped inside the massing block above, so this is its twin.
      const octConcrete = new THREE.MeshStandardMaterial({
        color: 0x8d9199,
        roughness: 0.92,
        envMapIntensity: 1.5,
      });
      litFacades.push(octConcrete);
      const octCaps = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
        octConcrete,
        26
      );
      octCaps.geometry.translate(0, 0.5, 0);
      let oPlaced = 0;
      for (let i = 0; i < 90 && oPlaced < 26; i++) {
        const blockIndex = Math.floor(rand() * crossCount);
        const [lo, hi] = rings[Math.floor(rand() * rings.length)];
        const dia = Math.min(hi - lo - 5, 14 + rand() * 10);
        const room = blockLen - 2 * STREETS.half - dia;
        if (dia < 9 || room < 2) continue;
        const s2 =
          blockIndex * blockLen + STREETS.half + dia / 2 + rand() * room;
        if (onForecourt(track, s2, dia / 2, lo, hi)) continue;
        const u2 = track.wrap(s2) / L;
        const onCoast2 = u2 >= COAST_U.from && u2 <= COAST_U.to;
        const sideSign2 = onCoast2 ? 1 : rand() < 0.5 ? 1 : -1;
        const inset2 = 2 + rand() * Math.max(0, hi - lo - dia - 4);
        const lat2 = lo + inset2 + dia / 2;
        if (lat2 - dia / 2 < track.halfWidthAt(s2) + 4) continue;
        track.pose(s2, sideSign2 * lat2, p, tmp);
        track.tangentAt(s2, tmp);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tmp.x, tmp.z));
        const cityBoost2 = u2 > 0.88 || u2 < 0.06 ? 2.1 : 1;
        // Taller bias than the slabs: a drum earns its shape by rising
        // over the rectangles around it.
        const h2 = (24 + rand() * rand() * 50) * cityBoost2;
        scale.set(dia, h2, dia);
        m.compose(p, q, scale);
        octs.setMatrixAt(oPlaced, m);
        tint.setHex(palette[i % palette.length]).multiplyScalar(0.85 + rand() * 0.3);
        octs.setColorAt(oPlaced, tint);
        // Its own eight-sided parapet — a square cap on a drum is the
        // one join that gives the trick away.
        scale.set(dia + 0.6, 0.9, dia + 0.6);
        p.y += h2;
        m.compose(p, q, scale);
        octCaps.setMatrixAt(oPlaced, m);
        octCaps.setColorAt(oPlaced, tint);
        oPlaced++;
      }
      octs.count = oPlaced;
      octCaps.count = oPlaced;
      octs.instanceMatrix.needsUpdate = true;
      octCaps.instanceMatrix.needsUpdate = true;
      if (octs.instanceColor) octs.instanceColor.needsUpdate = true;
      if (octCaps.instanceColor) octCaps.instanceColor.needsUpdate = true;
      octs.castShadow = true;
      octs.receiveShadow = true;
      octCaps.castShadow = true;
      octs.name = "cityDrums";
      octCaps.name = "cityDrumCaps";
      scene.add(octs, octCaps);
    }
  }

  // Palm rows lining the corniche walkway, the whole length of the coast
  //
  // The crowns join the verge's spring field (plants.ts): the fronds
  // flutter in the wind and lean, slowly, in a passing car's wake. The
  // trunks stay rigid — a palm bends at the fronds, not the trunk — and
  // the shadow the crown casts stays still, because the depth pass does
  // not run the bend; at night, under sodium, nobody has ever seen a
  // palm's shadow move.
  //
  // Where each tree stands, how tall, which crown and its two matrices
  // all come from placePalms (palm.ts), which tests/palms.mjs runs in node
  // against this same track and these same fixtures. It draws from the
  // shared stream exactly as this loop used to — 550 numbers, in the old
  // order — so nothing placed after the palms moves.
  //
  // Three crowns, three InstancedMeshes: a trimmed one, an untrimmed one
  // with its dead skirt, a young one. About 130 stamped clones of one
  // head was the other thing (with the colour) that made the avenue read
  // as a planted prop. Each mesh spans the whole coast, so each one's
  // box stays a "ground plane" to tests/shadows.mjs (wider than 4 x
  // orthoW) rather than a caster it must fit, as the single mesh's did.
  const palmSeeds: PlantSeed[] = [];
  let palmRig: { meshes: THREE.InstancedMesh[]; slot: Uint16Array; variant: Uint8Array } | null = null;
  {
    const coastLen = (COAST_U.to - COAST_U.from) * L;
    // Lean and tint are drawn from their own generator, as before; size,
    // girth and crown from a second one. The world's shared sequence
    // places every building and lamp after this, and a single extra draw
    // from it would move all of them.
    const palmRng = makeRng((WORLD_SEED ^ 0x50414c4d) >>> 0); // "PALM"
    const formRng = makeRng((WORLD_SEED ^ 0x504c4d32) >>> 0); // "PLM2"
    const placed = placePalms(track, rand, palmRng, formRng, palmFixtures(track), {
      from: COAST_U.from * L,
      len: coastLen,
    });
    const count = placed.length;
    const variant = Uint8Array.from(placed, (pl) => pl.variant);
    const { slot, counts } = palmSlots(variant);

    const trunks = new THREE.InstancedMesh(palmTrunkGeometry(), palmTrunkMaterial(), count);
    trunks.name = "palm-trunks";
    // Trunks cast too, or the frond shadows float detached from the trees
    trunks.castShadow = true;
    trunks.receiveShadow = true;
    const leaf = palmLeafMaterial();
    const meshes = PALM_KINDS.map((kind, v) => {
      const geo = buildPalmCrown(kind);
      const im = new THREE.InstancedMesh(geo, leaf, counts[v]);
      im.name = `palm-crowns-${kind}`;
      im.castShadow = true;
      // The crown shades itself: the lower fronds sit under the upper ones.
      im.receiveShadow = true;
      // The bend lives on the geometry, one per mesh, so each crown has
      // its own (dirX, dirZ, strength) per instance.
      const bend = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, counts[v]) * 3), 3);
      bend.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("grnBend", bend);
      im.userData.bend = bend;
      return im;
    });
    const tint = new THREE.Color();
    placed.forEach((pl, j) => {
      trunks.setMatrixAt(j, pl.trunk);
      const im = meshes[pl.variant];
      im.setMatrixAt(slot[j], pl.crown);
      im.setColorAt(slot[j], tint.setRGB(pl.tint[0], pl.tint[1], pl.tint[2]));
      palmSeeds.push({ s: pl.s, x: pl.x, z: pl.z, yaw: pl.yaw, phase: pl.phase, kind: 1 });
    });
    trunks.instanceMatrix.needsUpdate = true;
    scene.add(trunks);
    for (const im of meshes) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      scene.add(im);
    }
    palmRig = { meshes, slot, variant };
  }

  // Roadside planting — the shrub beds along both verges.
  //
  // Gulf Road and the ring are planted the whole way: irrigated beds of
  // clipped Conocarpus hedge, rows of clipped Ficus balls, loose heaps of
  // bougainvillea and oleander, with sand between the beds, kept low
  // enough that nothing hides a sign. This game had date palms on the
  // corniche and bare ground everywhere else, so every verge that was
  // not the corniche read as a hard shoulder rather than as a street
  // somebody waters twice a week.
  //
  // THE SHAPES AND THE LAYOUT LIVE IN shrubs.ts, pure, where
  // tests/shrubs.mjs builds and measures them without a browser. The
  // first version of this block built its plants here, from one
  // icosahedron whose every vertex took its own rand(): unwelded, so the
  // copies of each corner moved apart and the plants rendered as torn
  // green shards with the sky between them, every face flat-shaded, one
  // colour per plant, dotted along a 7 m grid. See shrubs.ts for what
  // replaced each of those and what each one measured.
  //
  // THE LATERAL COMES FROM halfWidthAt, NOT FROM THE CONSTANT, and this
  // file already records what the constant costs. The road is not a
  // constant width — it swells from 7 m to 19 m at the Sharq drift
  // plaza and by 10 m at each petrol forecourt — and a band drawn at
  // ROAD_HALF_WIDTH + 4 once put a tower block on the plaza, measured at
  // lat 18.02 against the road's own half-width of 18.00, a bug that
  // only became reproducible when the world was seeded. A bed planted
  // on the racing line would be that same bug with leaves on. Every bed
  // reads the width at its own s, and a hedge follows the widening line
  // round a swell rather than the road's heading.
  //
  // WHICH SIDE. On the coastal leg the negative side is the SEA — the
  // same rule the billboards follow — so the coast is planted inland
  // only, and its sea side stays the palm walkway it already is. Past
  // the coast, both verges.
  //
  // NO SHADOWS CAST. About 1,900 plants, every one about chest high; the
  // shadow budget belongs to the cars and the lamp posts. They RECEIVE,
  // so the moon shadow and a passing headlight still cross them, and the
  // contact shadow they cannot cast is baked into the foot of each shape.
  {
    // THE SHARED STREAM FIRST. The old block took its shapes and its
    // layout from the world's shared rand(), and the underpass textures,
    // the billboards' sides and the flyover concrete are all drawn from
    // the same stream after it (concreteTexture, tunnelWallTexture, the
    // billboard block). The beds below take nothing from it, so the
    // stream is advanced here by exactly what the old block took: a
    // replay of its loop, because how much it took depended on what it
    // drew: 17,408 in the recorded city, which reaches this line at draw
    // 43,825, and more or fewer for any other. tests/world.mjs holds
    // the total (258,930) and every other instanced group to the
    // recorded city; tests/shrubs.mjs holds the replay to a verbatim
    // copy of the old block in source order (the loop, THEN the shapes),
    // and that copy to the old planting's recorded hashes.
    burnLegacyVergeDraws(rand, L, TUNNEL_S, COAST_END_M);

    // Four plantings, four shapes, one InstancedMesh each. Built once,
    // in the unit frame, so an instance is scaled in metres.
    const geos = SHRUB_KINDS.map((k, i) => shrubGeometry(k, i + 1));

    // The leaf tile (shrubs.ts leafDetailData): 256² of leaves and gaps,
    // tiled every 0.6 m in instance metres. NoColorSpace — it is a
    // multiplier, not a colour, and an sRGB decode would darken it.
    const leafTex = new THREE.DataTexture(leafDetailData(), LEAF_TILE.px, LEAF_TILE.px, THREE.RGBAFormat);
    leafTex.wrapS = leafTex.wrapT = THREE.RepeatWrapping;
    leafTex.generateMipmaps = true;
    leafTex.minFilter = THREE.LinearMipmapLinearFilter;
    leafTex.magFilter = THREE.LinearFilter;
    leafTex.anisotropy = 4;
    leafTex.colorSpace = THREE.NoColorSpace;
    leafTex.needsUpdate = true;

    // The colour is in the mesh now: albedo, the dark core and lit crown,
    // the tips, the speckle and the flowers are baked per vertex, and the
    // instance colour is a near-neutral tint per bed. White here so the
    // material does not multiply a second green over the first.
    // Roughness 0.9 rather than 1: a leaf is faintly waxy, and a little
    // sheen under the white LED street lamps is what separates foliage
    // from felt.
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
    });
    // THE BEND. A solved lean per instance, done where two thousand
    // instances can afford it: in the vertex shader, from one attribute
    // per plant. The CPU decides how far each plant leans and which way
    // — wind everywhere, plus the wake of every car as it passes — and
    // writes it into `grnBend`; the shader displaces by it times the
    // baked grnWeight (0 root, 1 tip). Then the leaf tile, chained after
    // it with its own program key: the palm crowns also bend and also
    // carry vertex and instance colour, and a shared key would let three
    // hand one material the other's program.
    plantBend(leafMat, "grn-plant-bend-leaf");
    const bendOnly = leafMat.onBeforeCompile;
    leafMat.onBeforeCompile = (shader, renderer) => {
      bendOnly.call(leafMat, shader, renderer);
      shader.uniforms.grnLeafMap = { value: leafTex };
      shader.vertexShader = patchLeafVertex(shader.vertexShader);
      shader.fragmentShader = patchLeafFragment(shader.fragmentShader);
    };

    // Lay the beds out, clear of everything else on the verge.
    const beds = layoutVerge({
      track,
      L,
      tunnel: TUNNEL_S,
      coastEnd: COAST_END_M,
      coastU: COAST_U.to,
      blockLen: L / Math.round(L / STREETS.crossEvery),
      streetHalf: STREETS.half,
      onForecourt: (s, half, lo, hi) => onForecourt(track, s, half, lo, hi),
      avoid: vergeFurniture(track, palmSeeds),
      rng: makeRng((WORLD_SEED ^ 0x53485242) >>> 0), // "SHRB"
    });

    const meshes: THREE.InstancedMesh[] = [];
    const bends: THREE.InstancedBufferAttribute[] = [];
    for (const [k, kind] of SHRUB_KINDS.entries()) {
      const n = beds.filter((b) => b.kind === kind).length;
      const g = geos[k];
      const im = new THREE.InstancedMesh(g, leafMat, Math.max(1, n));
      // Per-plant lean: x, z of the direction, and how far. Dynamic, the
      // wake rewrites the ones near each car every frame.
      const bend = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
      bend.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("grnBend", bend);
      im.userData.bend = bend;
      im.castShadow = false;
      im.receiveShadow = true;
      im.name = "planting";
      im.count = 0; // raised as instances are filled in
      meshes.push(im);
      bends.push(bend);
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    const nShrub = beds.length;
    // Where each plant's lean goes: which mesh, which slot, and the two
    // factors that turn the solver's unit lean into METRES on this
    // instance. The shader bends in object units before the instance
    // scale; without these a 3 m hedge segment leaned three times as far
    // along the road as across it, and the same gust moved a wide plant
    // up to 2.9 times as far as a narrow one.
    const meshOf = new Uint8Array(nShrub);
    const slotOf = new Uint32Array(nShrub);
    const gx = new Float32Array(nShrub);
    const gz = new Float32Array(nShrub);
    const shrubSeeds: PlantSeed[] = [];
    for (const [i, b] of beds.entries()) {
      const k = SHRUB_KINDS.indexOf(b.kind);
      const im = meshes[k];
      // ON THE CITY FLOOR, NOT ON THE ROAD'S PLANE. The verge is the
      // city floor, CITY_GROUND_Y below the road, and a plant stood at
      // y = 0 floated 80 mm over it — the gap track.ts records the whole
      // skyline once had. A few centimetres below it, so the foot meets
      // the ground in an intersection rather than a coplanar seam.
      pos.set(b.x, CITY_GROUND_Y - SHRUB.sink, b.z);
      q.setFromAxisAngle(up, b.yaw);
      // HEIGHT IS SET AGAINST THE BARRIER. The W-beam's top lip stands
      // at 0.776 m, and the first build's plants were 0.19 to 0.77 m
      // tall: placed correctly, tested correctly, and invisible from the
      // road behind the rail. Every planting's height range in shrubs.ts
      // clears the lip by at least 5 cm after the sink, and stays well
      // under the sign gantries at 3.75 m.
      scl.set(b.sx, b.sy, b.sz);
      m.compose(pos, q, scl);
      meshOf[i] = k;
      slotOf[i] = im.count;
      gx[i] = b.gx;
      gz[i] = b.gz;
      im.setMatrixAt(im.count, m);
      tint.setRGB(b.tint[0], b.tint[1], b.tint[2]);
      im.setColorAt(im.count, tint);
      im.count++;
      shrubSeeds.push({ s: track.wrap(b.s), x: b.x, z: b.z, yaw: b.yaw, phase: b.phase, kind: 0 });
    }
    for (const im of meshes) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = true;
      scene.add(im);
    }
    // Hand the verge to the frame loop: the shrubs and, after them, the
    // palm crowns, as one spring field.
    const field = newPlantField([...shrubSeeds, ...palmSeeds]);
    const palms = palmRig;
    plantsRef = {
      field,
      lapLen: L,
      meshes: palms ? [...meshes, ...palms.meshes] : meshes,
      write: (i, dx, dz, str) => {
        if (i < nShrub) {
          bends[meshOf[i]].setXYZ(slotOf[i], dx * gx[i], dz * gz[i], str);
        } else if (palms) {
          // Palm j lives in the mesh of its crown, at its slot there.
          const j = i - nShrub;
          (palms.meshes[palms.variant[j]].userData.bend as THREE.InstancedBufferAttribute).setXYZ(palms.slot[j], dx, dz, str);
        }
      },
    };
  }

  // The underpass: concrete walls + ceiling, sodium strip lights inside
  {
    // The soffit keeps the plain cast concrete — a ceiling has no
    // courses on it, and the tiled wall would put a dado overhead.
    const concreteMap = concreteTexture();
    concreteMap.repeat.set(1, 2);
    const concrete = new THREE.MeshStandardMaterial({
      map: concreteMap,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    // The walls get their own face: plinth, tiled dado, dirty concrete
    // above. See tunnelWallTexture — it is drawn sideways because
    // buildWall's u is height, not length.
    const wallMap = tunnelWallTexture();
    wallMap.repeat.set(1, 2);
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallMap,
      // Less rough than the soffit: glazed tile is most of what the eye
      // sees down here, and it is the surface that throws headlights
      // back onto the road.
      roughness: 0.72,
      side: THREE.DoubleSide,
    });
    // The box's dimensions live in track.ts beside the span they apply
    // to, because sound.ts derives the underpass's acoustics from the
    // same two numbers — a tunnel widened here and not there would be
    // two different tunnels, one seen and one heard.
    const { halfWidth: tw, height: th } = TUNNEL_BOX;
    const wallL = new THREE.Mesh(
      buildWall(track, -tw, 0, th, 6, TUNNEL_U.from, TUNNEL_U.to),
      wallMat
    );
    const wallR = new THREE.Mesh(
      buildWall(track, tw, 0, th, 6, TUNNEL_U.from, TUNNEL_U.to),
      wallMat
    );
    const ceiling = new THREE.Mesh(
      buildRibbon(track, -tw, tw, th, 6, TUNNEL_U.from, TUNNEL_U.to),
      concrete
    );
    wallL.receiveShadow = wallR.receiveShadow = ceiling.receiveShadow = true;
    scene.add(wallL, wallR, ceiling);

    // Portal frames at each mouth
    const portalMat = new THREE.MeshStandardMaterial({ color: 0x55585e, roughness: 0.9 });
    for (const u of [TUNNEL_U.from, TUNNEL_U.to]) {
      const frame = new THREE.Group();
      const top = new THREE.Mesh(new THREE.BoxGeometry((ROAD_HALF_WIDTH + 2.6) * 2, 1.6, 1.2), portalMat);
      top.position.y = 6.0;
      frame.add(top);
      for (const sideSign of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6.2, 1.2), portalMat);
        leg.position.set(sideSign * (ROAD_HALF_WIDTH + 2.0), 3.1, 0);
        frame.add(leg);
      }
      const p = new THREE.Vector3();
      const tan = new THREE.Vector3();
      track.pointAt(u * L, p);
      track.tangentAt(u * L, tan);
      frame.position.copy(p);
      frame.lookAt(p.clone().add(tan));
      scene.add(frame);
    }

    // Ceiling strip lights + their glow on the road
    const stripCount = Math.floor(((TUNNEL_U.to - TUNNEL_U.from) * L) / 12);
    const stripGeo = new THREE.BoxGeometry(0.5, 0.12, 2.6);
    // White too. These share lightPoolTexture with the street columns, so
    // leaving them sodium would put warm strips over cool pools — the one
    // combination that reads as a bug rather than as a choice.
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0xf4f8ff,
      emissive: 0xdfeaff,
      emissiveIntensity: 3.0,
      fog: false,
    });
    const strips = new THREE.InstancedMesh(stripGeo, stripMat, stripCount * 2);
    const poolGeo = new THREE.CircleGeometry(7, 16);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({
      map: lightPoolTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0.8,
    });
    const tpools = new THREE.InstancedMesh(poolGeo, poolMat, stripCount * 2);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const stripPositions: THREE.Vector3[] = [];
    let idx = 0;
    for (let i = 0; i < stripCount; i++) {
      const s = (TUNNEL_U.from + 0.002) * L + i * 12;
      for (const lat of [-3.5, 3.5]) {
        track.pose(s, lat, p, tmp);
        m.makeTranslation(p.x, 5.32, p.z);
        strips.setMatrixAt(idx, m);
        stripPositions.push(new THREE.Vector3(p.x, 5.25, p.z));
        m.makeTranslation(p.x, 0.05, p.z);
        tpools.setMatrixAt(idx, m);
        idx++;
      }
    }
    strips.instanceMatrix.needsUpdate = true;
    tpools.instanceMatrix.needsUpdate = true;
    scene.add(strips, tpools);
    const stripCoronas = coronaPoints(stripPositions, 0xdbe7ff, 2.6);
    probeHide.push(stripCoronas);
    scene.add(stripCoronas);

    /* THE SERVICE RUN, AND THE STUDS.
     *
     * Two things a tunnel has that a corridor does not, and between them
     * they are what stops a smooth grey wall from being a smooth grey
     * wall at 200 km/h.
     *
     * The tray is the cable duct every tunnel carries at high level —
     * power for the lights overhead, and the one horizontal line in here
     * that runs unbroken from portal to portal. It is what gives the
     * wall a vanishing point of its own instead of leaving that job to
     * the ceiling strips.
     *
     * The studs are the reason this is worth doing at all. A tiled wall
     * is lit by whatever the ceiling gives it; a reflective delineator
     * is lit by YOUR headlights, so it arrives out of the dark, brightens
     * as you close on it and goes past — and a row of them at a fixed
     * spacing is the strongest speed cue in the whole tunnel. Every 18 m,
     * because that is close enough to read as a stream at speed and far
     * enough not to become a solid line.
     */
    const runM = (TUNNEL_U.to - TUNNEL_U.from) * L;
    const trayN = Math.floor(runM / 4);
    // Galvanised, not black. At 0x2f3237 against a pale tiled wall this
    // was the highest-contrast thing in the tunnel — a row of dark slabs
    // that read as structural beams somebody had left in the way, and
    // the first thing the eye went to in every shot. A cable duct is
    // dull grey steel and it is supposed to be furniture.
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x8d9198, roughness: 0.62, metalness: 0.5 });
    // Slightly longer than the spacing so consecutive segments overlap
    // through the corners: a tray with gaps in it on every bend is a
    // dashed line, and a dashed line is not a duct.
    const tray = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.16, 4.6), trayMat, trayN * 2);
    // Amber one side, white the other, which is the convention and also
    // the only way to know which wall you are looking at when the tunnel
    // is symmetrical and you are sideways.
    const studGeo = new THREE.BoxGeometry(0.1, 0.12, 0.3);
    const studMats = [
      new THREE.MeshStandardMaterial({ color: 0xfff3d8, emissive: 0xffcf82, emissiveIntensity: 0.85, roughness: 0.35, fog: false }),
      new THREE.MeshStandardMaterial({ color: 0xf2f6ff, emissive: 0xdbe7ff, emissiveIntensity: 0.85, roughness: 0.35, fog: false }),
    ];
    const studN = Math.floor(runM / 18);
    const studs = [
      new THREE.InstancedMesh(studGeo, studMats[0], studN),
      new THREE.InstancedMesh(studGeo, studMats[1], studN),
    ];
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    // Both of these sit ON the wall, so they have to be turned to follow
    // it. The strips above get away with a bare translation because they
    // are square in plan; a 4.5 m duct laid across the tunnel would be a
    // girder.
    const place = (sAt: number, lat: number, y: number, mesh: THREE.InstancedMesh, at: number) => {
      track.pose(sAt, lat, p, tmp);
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmp.clone().setY(0).normalize());
      m.compose(new THREE.Vector3(p.x, y, p.z), q, one);
      mesh.setMatrixAt(at, m);
    };
    for (let i = 0; i < trayN; i++) {
      const sAt = (TUNNEL_U.from + 0.001) * L + i * 4;
      // 4.95 m, up out of the eye line and tight under the soffit, which
      // is where a duct is actually clipped.
      place(sAt, -(tw - 0.14), 4.95, tray, i * 2);
      place(sAt, tw - 0.14, 4.95, tray, i * 2 + 1);
    }
    tray.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < studN; i++) {
      const sAt = (TUNNEL_U.from + 0.004) * L + i * 18;
      // 0.95 m: headlight height, which is the whole point of a stud.
      place(sAt, -(tw - 0.12), 0.95, studs[0], i);
      place(sAt, tw - 0.12, 0.95, studs[1], i);
    }
    for (const st of studs) st.instanceMatrix.needsUpdate = true;
    scene.add(tray, studs[0], studs[1]);
  }

  // Illuminated billboards — the TXR night-expressway signature,
  // with distinctly Kuwaiti advertisers
  {
    const ads: Array<[string, string, string, string, string, number, number]> = [
      // line1, line2, bg, fg, accent, metres from the line, side offset
      ["وين؟ WAIN", "wain nrooh? — يلا", "#0f4f4a", "#eafff9", "#2e978e", 257, 24],
      ["بو مجبوس", "BU MACHBOOS · best machboos on the Gulf", "#7a2d08", "#ffe9d4", "#e8641b", 661, 26],
      ["SAQER · صقر", "ENERGY — hunt the night", "#1a0a0a", "#ffd2c2", "#c1121f", 1138, 24],
      ["AL-DABOOS", "كراج الدبوس · TUNING & DYNO", "#1c1c10", "#ffe9a3", "#f5c211", 1652, 26],
      ["بنك الديرة", "BANK AL-DEERA · drive now, pay later", "#0a2a52", "#dcebff", "#3b82d4", 2203, 25],
      ["ليالي السالمية", "SALMIYA NIGHTS — open until fajer", "#2a0a3a", "#f3dcff", "#b84dd6", 2643, 24],
      ["قهوة GAHWA", "first cup free for racers", "#3a2510", "#ffeeda", "#c98a3d", 3157, 22],
      ["دروازة مول", "DARWAZA MALL · 200 shops", "#0d3a1e", "#dcffe9", "#16a34a", 4400, 28],
      ["NIGHT RACER", "متسابق الليل · from midnight", "#101728", "#dceaff", "#38e8ff", 5500, 26],
      ["حولي موترز", "HAWALLY MOTORS · JDM imports", "#252525", "#f2f2f2", "#888888", 6900, 25],
    ];
    for (const [l1, l2, bg, fg, accent, s, off] of ads) {
      const sideSign = s < COAST_END_M ? 1 : rand() < 0.5 ? 1 : -1; // never in the sea
      scene.add(billboard(track, s, sideSign * off, adTexture(l1, l2, bg, fg, accent)));
    }
  }

  // Landmarks, in real Gulf Road order heading south down the coast
  // Kuwait Towers on the Ras Ajouza headland, seaward of the corniche and
  // ahead of the spawn. Far enough out that the headland clears the beach
  // ribbon (which runs to 55 m) and turned to the road, so the three
  // towers line up along the coast the way they do from Arabian Gulf
  // Street rather than at whatever angle the world axes happen to give.
  {
    const towers = kuwaitTowers();
    const s = 117; // metres from the line, not a lap fraction — see AREAS
    placeBeside(track, towers, s, -95, "kuwait-towers");
    const tan = new THREE.Vector3();
    track.tangentAt(s, tan);
    towers.rotation.y = Math.atan2(tan.x, tan.z);
    const towersBeacon = makeBeacon(beacons);
    towersBeacon.position.y = 114;
    towers.add(towersBeacon);
    scene.add(towers);
  }

  // The flyovers. Placed with the landmarks because that is what they
  // are: the five points on a lap where the road runs under something,
  // and the only structures in this world a driver passes THROUGH
  // rather than beside.
  for (const spec of FLYOVERS) {
    const f = flyover(track, spec, concreteTexture(), beacons);
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    track.pointAt(spec.s, p);
    track.tangentAt(spec.s, tan);
    f.position.copy(p);
    // Square to the road first; the deck's own skew is inside the group.
    f.rotation.y = Math.atan2(tan.x, tan.z);
    scene.add(f);
  }

  const grandMosque = mosque();
  placeBeside(track, grandMosque, 147, 55); // opposite Souq Sharq
  grandMosque.rotation.y = Math.PI / 5;
  scene.add(grandMosque);

  const island = greenIsland();
  placeBeside(track, island, 734, -200, "green-island"); // out in the water
  scene.add(island);

  const marina = marinaBoats();
  placeBeside(track, marina, 1982, -38, "salmiya-marina");
  scene.add(marina);

  const sciCenter = scientificCenter();
  placeBeside(track, sciCenter, 2827, -48, "scientific-center"); // the sail
  scene.add(sciCenter);

  const rasLight = lighthouse();
  placeBeside(track, rasLight, 3414, -28, "ras-al-ard-light");
  scene.add(rasLight);

  const wt = waterTowers(stripeTexture("#7ec8e3", "#ffffff"));
  placeBeside(track, wt, 4600, 65); // Shamiya, outside the ring

  // Petrol stations. The forecourt is the brightest thing on the road at
  // night, which is what makes one a decision you can see coming rather
  // than a turning you have already missed.
  STATIONS.forEach((st, i) => {
    const station = fuelStation();
    placeBeside(track, station, st.s, st.lat, `fuel-station-${i}`);
    const tan = new THREE.Vector3();
    track.tangentAt(st.s, tan);
    // Square to the road: local +Z runs along it, +X out to the kerb.
    station.rotation.y = Math.atan2(tan.x, tan.z);
    scene.add(station);
  });
  // The painter's: a gate you drive through and a lit bay you stop in.
  // Placed like a station and named like one, so the map and the tests
  // find it the same way.
  PAINT_SHOPS.forEach((sh, i) => {
    const shop = paintShop();
    placeBeside(track, shop, sh.s, sh.lat, `paint-shop-${i}`);
    const tan = new THREE.Vector3();
    track.tangentAt(sh.s, tan);
    shop.rotation.y = Math.atan2(tan.x, tan.z);
    scene.add(shop);
  });
  scene.add(wt);

  const m2 = mosque();
  placeBeside(track, m2, 5400, -60); // Mansuriya, inside the ring
  m2.rotation.y = Math.PI / 3;
  scene.add(m2);

  const lib = liberationTower(windows, litFacades);
  // Liberation Tower stands in Mirqab, which is INSIDE the ring — so it
  // sits on the left of the road here, the side the arc curves toward.
  placeBeside(track, lib, 7000, -150, "liberation-tower");
  const libBeacon = makeBeacon(beacons);
  libBeacon.position.y = 134;
  lib.add(libBeacon);
  scene.add(lib);

  const hamra = alHamra(windows, litFacades);
  placeBeside(track, hamra, L - 294, 80, "al-hamra"); // Sharq skyline, before the line
  const hamraBeacon = makeBeacon(beacons);
  hamraBeacon.position.y = 60; // local to the 118 m box, centred at 59
  hamra.add(hamraBeacon);
  scene.add(hamra);

  // The flags at the start line.
  //
  // Kuwait on the tallest mast at the line itself, because it is Kuwait's
  // road — then the rest of the region on a row of shorter masts running
  // back from it, which is what a Gulf corniche actually does on a
  // national day and what these masts were always half-suggesting with
  // one lonely pole.
  //
  // Each flag flies at ITS OWN proportions. They are not a set of
  // interchangeable rectangles: Qatar is 28:11 and Israel is 11:8, and
  // hanging both on a 2:1 plane would make two different countries'
  // flags into two colourways of one object. flagPlane takes the height
  // and gets the width from the specification.
  {
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0xcfd6dd,
      roughness: 0.4,
      metalness: 0.6,
    });
    const mast = (id: FlagId, height: number, poleH: number): THREE.Group => {
      const g = new THREE.Group();
      // Named so tests/planting.mjs can hold the verge's beds clear of
      // the masts actually standing here (see vergeFurniture).
      g.name = "flag-mast";
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(poleH * 0.0086, poleH * 0.0129, poleH, 6),
        poleMat
      );
      pole.position.y = poleH / 2;
      pole.castShadow = true;
      const flag = new THREE.Mesh(
        flagPlane(id, height),
        new THREE.MeshStandardMaterial({
          map: flagTexture(id),
          side: THREE.DoubleSide,
          emissive: 0x444444,
        })
      );
      // Hung from the top of the mast, offset by half its own width so
      // the hoist edge is AT the pole rather than through it.
      flag.position.set((height * FLAGS[id].ratio) / 2 + 0.1, poleH - height * 0.62, 0);
      g.add(pole, flag);
      return g;
    };

    placeBeside(track, mast("kw", 3, 14), 0, FLAG_MASTS.lat);
    // The rest of the region, back down the corniche from the line, on
    // matched shorter masts. Kuwait is skipped here — it is already
    // flying, taller, at the line.
    const rest = FLAG_IDS.filter((id) => id !== "kw");
    for (let i = 0; i < rest.length; i++) {
      placeBeside(track, mast(rest[i], 2.1, 10), FLAG_MASTS.restFrom - i * FLAG_MASTS.restEvery, FLAG_MASTS.lat);
    }
  }

  // The grid crew waiting under that flag: four racers in crew colours,
  // three men and one woman. Their suits are taken from the roster they
  // belong to, so recolouring a rival recolours the driver standing at
  // the line — with fixed fallbacks if the roster ever runs short, since
  // a silently empty grid would be worse than an off-colour one.
  {
    const kuwaitis = RIVALS.filter((r) => r.country === "Kuwait");
    const women = kuwaitis.filter((r) => r.voice.female);
    const men = kuwaitis.filter((r) => !r.voice.female);
    const FALLBACK = [
      { suitColor: 0xd23a35, accentColor: 0xf2f2ee },
      { suitColor: 0x1f6f4a, accentColor: 0xffd54a },
      { suitColor: 0x2456a8, accentColor: 0xf2f2ee },
      { suitColor: 0xb84dd6, accentColor: 0xffffff },
    ];
    const colorOf = (r: (typeof kuwaitis)[number] | undefined, i: number) =>
      r ? { suitColor: r.bodyColor, accentColor: r.accentColor } : FALLBACK[i];

    const looks: RacerLook[] = [
      { ...colorOf(men[0], 0), helmet: "carried", headdress: "check" },
      { ...colorOf(men[1], 1), helmet: "worn" },
      { ...colorOf(men[2], 2), helmet: "carried", headdress: "white" },
      { ...colorOf(women[0], 3), helmet: "carried", woman: true },
    ];

    const crew = new THREE.Group();
    crew.name = "racers";
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    // Spread along the shoulder opposite the flag, turned to watch the
    // road rather than each other.
    // START_CREW_SPOTS — hoisted so the verge can keep its beds off them.
    looks.forEach((look, i) => {
      const fig = kuwaitiRacer(look);
      const [ds, latPad] = START_CREW_SPOTS[i];
      track.pose(ds, ROAD_HALF_WIDTH + latPad, p, tmp);
      fig.position.copy(p);
      track.pointAt(ds, tmp);
      fig.lookAt(tmp.x, 0, tmp.z);
      fig.rotateY((i % 2 === 0 ? 1 : -1) * 0.25);
      crew.add(fig);
      if (fig.userData.head) {
        // The racer's own free hand — the other keeps hold of the helmet
        watchers.push({
          body: fig,
          head: fig.userData.head as THREE.Object3D,
          baseYaw: fig.rotation.y,
          ...watcherArms(fig, (fig.userData.waveSide as number) ?? 1, i),
        });
      }
    });
    scene.add(crew);
  }

  // Area gantry signs at each district boundary. The sign for a district
  // goes just INSIDE its start — where the previous one ends — so it
  // reads as "you are now entering", which is what a real boundary sign
  // does. Sharq's start is the finish line, so its sign hangs at the end
  // of the lap rather than in the first metre of it.
  AREAS.forEach((area, i) => {
    const start = i === 0 ? 0 : AREAS[i - 1].to;
    const s = i === 0 ? L - GANTRY.finish : start + GANTRY.lead;
    const g = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6 });
    for (const sideSign of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 7.5, 8), postMat);
      post.position.set(sideSign * GANTRY.postLat, 3.75, 0);
      g.add(post);
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(GANTRY.beamHalf * 2, 0.5, 0.5),
      postMat
    );
    beam.position.y = 7.3;
    g.add(beam);
    // Front face only — a DoubleSide plane shows mirrored text from behind
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 3.1),
      signFaceMat(signTexture(area.name.toUpperCase(), area.arabic), 0.5)
    );
    board.position.y = 5.4;
    g.add(board);
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 3.1),
      new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.85 })
    );
    back.rotation.y = Math.PI;
    back.position.set(0, 5.4, -0.03);
    g.add(back);

    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    track.pointAt(s, p);
    track.tangentAt(s, tan);
    g.position.copy(p);
    // Face the board toward oncoming traffic.
    g.lookAt(p.clone().sub(tan));
    scene.add(g);
  });

  // شارع الحب — Love Street. Not an official name and not on any map:
  // it is what the Da'iya-to-Dasma stretch of the Second Ring has been
  // called for decades, by the people who cruise it at night. A game
  // about cruising a Kuwaiti road at night can hardly leave it out. One
  // board at each end of the stretch, facing the traffic that is about
  // to drive it.
  for (const s of [LOVE_STREET.from, LOVE_STREET.to]) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.14, 4.0, 8),
      new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6 })
    );
    post.position.y = 2.0;
    g.add(post);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(5.0, 1.56),
      signFaceMat(signTexture("LOVE STREET", "شارع الحب", "2ND RING RD"))
    );
    board.position.y = 4.2;
    g.add(board);
    const p = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    track.pose(s, LOVE_SIGN_LAT, p, tmp2);
    track.tangentAt(s, tmp2);
    g.position.copy(p);
    g.lookAt(p.clone().sub(tmp2));
    g.name = "love-street-sign";
    scene.add(g);
  }

  // ------------------------------------------------- the Sharq drift circle
  // The corniche swells into a round plaza (the physics follows
  // track.halfWidthAt), with a kerbed island to slide around, a painted
  // drift ring, and Arabic wayfinding leading in.
  {
    const sPlaza = DRIFT_PLAZA.s;
    const islandPos = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    track.pose(sPlaza, DRIFT_PLAZA.islandLat, islandPos, tmp);

    const island = new THREE.Group();
    const kerb = new THREE.Mesh(
      new THREE.CylinderGeometry(DRIFT_PLAZA.islandRadius, DRIFT_PLAZA.islandRadius + 0.25, 0.5, 32),
      new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.7 })
    );
    kerb.position.y = 0.25;
    island.add(kerb);
    // The island's face is a mosaic disc, registered with the texture
    // manifest as "plaza" — authored artwork drops onto it with no code.
    const mosaic = new THREE.Mesh(
      new THREE.CircleGeometry(DRIFT_PLAZA.islandRadius - 0.3, 32),
      plazaMosaicMat
    );
    mosaic.rotation.x = -Math.PI / 2;
    mosaic.position.y = 0.51;
    island.add(mosaic);
    // A ring of date palms around a central roundabout sign
    // The avenue's crown, trunk and bark (palm.ts) — see the Green Island
    // note — scaled to the plaza's shorter 4.2 m trunks.
    const trunkMat = palmTrunkMaterial();
    const crownMat = palmLeafMaterial();
    const plazaCrown = buildPalmCrown("kept");
    const plazaTrunk = palmTrunkGeometry();
    const PLAZA_K = 0.7;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const r = DRIFT_PLAZA.islandRadius - 1.7;
      // Foot on the island at 0.5, 4.2 m tall and slimmer than the
      // avenue's: the top, and the crown's origin, at 4.7.
      const trunk = new THREE.Mesh(plazaTrunk, trunkMat);
      trunk.position.set(Math.cos(a) * r, 0.5, Math.sin(a) * r);
      trunk.scale.set(0.8, 4.2 / TRUNK_REF_H, 0.8);
      island.add(trunk);
      const crown = new THREE.Mesh(plazaCrown, crownMat);
      crown.scale.setScalar(PLAZA_K);
      crown.position.set(Math.cos(a) * r, 4.7, Math.sin(a) * r);
      crown.rotation.y = i * 2.1;
      island.add(crown);
    }
    island.position.copy(islandPos);
    scene.add(island);

    // Painted drift ring around the island, and the rubber laid into it
    const ring = new THREE.Mesh(
      // 6.8 to 7.2 m from the island centre — a 400 mm ring, as before,
      // pulled in by 800 mm. At +3.0/+3.4 it reached 8.0 m from an island
      // sitting 11.5 m off the centreline, so its outer edge landed at
      // lat 19.5 against a plaza half-width of 19.00: measured 500 mm of
      // paint hanging past the tarmac onto bare ground, straight
      // outboard. Swept over every angle it now clears by 300 mm.
      new THREE.RingGeometry(DRIFT_PLAZA.islandRadius + 2.2, DRIFT_PLAZA.islandRadius + 2.6, 48),
      new THREE.MeshStandardMaterial({
        // Road paint's white (MARKINGS.paint), not 0xf2f2ee — linear 0.89,
        // above any thermoplastic, and the brightest paint on the plaza
        // beside lines at 0.73.
        color: MARKINGS.paint.white,
        emissive: 0x9a9a92,
        emissiveIntensity: 0.4,
        roughness: 0.55,
        transparent: true,
        opacity: 0.9,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(islandPos.x, 0.045, islandPos.z);
    scene.add(ring);
    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x0b0b0d,
      roughness: 1,
      transparent: true,
      opacity: 0.45,
    });
    for (const [a0, len] of [
      [0.3, 1.9],
      [2.5, 1.4],
      [4.4, 2.2],
    ]) {
      const skid = new THREE.Mesh(
        // Pulled in with the ring above so the arcs stay INSIDE it,
        // which is what their comment has always claimed. At +1.4/+2.6
        // they ran to 7.2 m and the ring now starts at 6.8, so they would
        // have straddled its inner edge.
        new THREE.RingGeometry(DRIFT_PLAZA.islandRadius + 0.8, DRIFT_PLAZA.islandRadius + 1.8, 40, 1, a0, len),
        rubberMat
      );
      skid.rotation.x = -Math.PI / 2;
      skid.position.set(islandPos.x, 0.04, islandPos.z);
      scene.add(skid);
    }

    // Arabic paint on the approach asphalt: the circle's name, in the two
    // right-hand lanes (the island's side), at two distances.
    //
    // It was one 4.6 m by 2.3 m plate on lat 0 — across the lane line,
    // half in each of two lanes — and its 118 px glyphs on a 256 px canvas
    // came out 1.06 m along travel, which at a driver's 1.1 m eye height
    // and 40 m out foreshortens to almost nothing. A road legend sits
    // inside one lane and is drawn long: 2.4 m across, the plate 6.0 m
    // along, so the glyphs are 2.77 m, the UK TSM's elongated height for
    // roads above 40 mph. One texture and one material for all four.
    // Both pairs sit before junction 4's approach (MARKINGS.legend.back):
    // the near pair used to land inside that junction, past its stop line.
    {
      const spec = MARKINGS.legend;
      const legendMat = new THREE.MeshStandardMaterial({
        map: roadTextTexture(DRIFT_PLAZA.arabic),
        transparent: true,
        roughness: 0.55,
        emissive: 0x9a9a92,
        emissiveIntensity: 0.35,
      });
      const legendGeo = new THREE.PlaneGeometry(spec.width, spec.length);
      for (const mk of legendLayout()) {
        const paint = new THREE.Mesh(legendGeo, legendMat);
        paint.name = "road-legend";
        const g = new THREE.Group();
        paint.rotation.x = -Math.PI / 2;
        paint.position.y = mk.y;
        g.add(paint);
        const p = new THREE.Vector3();
        track.pose(mk.s, mk.lat, p, tmp);
        track.tangentAt(mk.s, tmp);
        g.position.copy(p);
        // Lay the text so an oncoming driver reads it upright
        g.lookAt(p.clone().sub(tmp));
        scene.add(g);
      }
    }

    // Advance sign on the right shoulder before the swell begins
    {
      const g = new THREE.Group();
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.11, 3.6, 8),
        new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6 })
      );
      post.position.y = 1.8;
      g.add(post);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(1.9, 2.5),
        signFaceMat(roundaboutSignTexture())
      );
      board.position.y = 3.2;
      g.add(board);
      const s = sPlaza - 170;
      const p = new THREE.Vector3();
      track.pose(s, ROAD_HALF_WIDTH + 1.8, p, tmp);
      track.tangentAt(s, tmp);
      g.position.copy(p);
      g.lookAt(p.clone().sub(tmp));
      scene.add(g);
    }

    // Red-and-white kerbing rides the swell on both edges — it follows
    // halfWidthAt exactly, so the paint stays glued to the physics. On
    // the paved strip, outboard of the edge line's outer edge and inside
    // the rail lip (MARKINGS.kerb): at hw+0.05..0.45 it was laid straight
    // over the line it borders once the line moved out onto the tarmac
    // edge.
    {
      const kerbTex = stripeTexture("#c8342b", "#f2f2ee");
      kerbTex.wrapS = kerbTex.wrapT = THREE.RepeatWrapping;
      // Read at a glancing angle, always: without anisotropy the stripes
      // averaged to pink a few metres out.
      kerbTex.anisotropy = 8;
      const kerbMat = new THREE.MeshStandardMaterial({
        map: kerbTex,
        roughness: 0.6,
        // Through its own stripes, so the white blocks glow white and the
        // red ones red (a flat red-brown floor left the whites unlit).
        emissive: 0xffffff,
        emissiveMap: kerbTex,
        emissiveIntensity: 0.12,
      });
      const uSpan = (DRIFT_PLAZA.halfSpan + 14) / L;
      for (const sign of [-1, 1]) {
        const kerb = new THREE.Mesh(
          buildRibbon(
            track,
            (s) => sign * (track.halfWidthAt(s) + MARKINGS.kerb.inner),
            (s) => sign * (track.halfWidthAt(s) + MARKINGS.kerb.outer),
            0.06,
            2,
            DRIFT_PLAZA.s / L - uSpan,
            DRIFT_PLAZA.s / L + uSpan
          ),
          kerbMat
        );
        kerb.name = "plaza-kerb";
        kerb.receiveShadow = true;
        scene.add(kerb);
      }
    }

    // Floodlight masts ring the circle so the drift arena reads brighter
    // than the sodium road it interrupts
    {
      const mastMat = new THREE.MeshStandardMaterial({ color: 0x343a42, roughness: 0.65 });
      const headMat = new THREE.MeshStandardMaterial({
        color: 0xeef2ff,
        emissive: 0xcfe0ff,
        emissiveIntensity: 3.4,
        fog: false,
      });
      const poolTex = lightPoolTexture();
      const poolMat = new THREE.MeshBasicMaterial({
        map: poolTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        color: 0x9fb6e8,
        opacity: 0.5,
      });
      const poolGeo = new THREE.CircleGeometry(11, 20);
      poolGeo.rotateX(-Math.PI / 2);
      for (const [ds, latPad] of PLAZA_FLOODLIGHTS) {
        const s = sPlaza + ds;
        const g = new THREE.Group();
        g.name = "plaza-floodlight";
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.19, 11.5, 8), mastMat);
        mast.position.y = 5.75;
        g.add(mast);
        for (const dx of [-0.45, 0, 0.45]) {
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 0.26), headMat);
          head.position.set(dx, 11.35, 0.1);
          head.rotation.x = 0.5;
          g.add(head);
        }
        const pool = new THREE.Mesh(poolGeo, poolMat);
        pool.position.y = 0.055;
        g.add(pool);
        const p = new THREE.Vector3();
        track.pose(s, track.halfWidthAt(s) + latPad, p, tmp);
        g.position.copy(p);
        g.lookAt(islandPos.x, 0, islandPos.z);
        scene.add(g);
      }
    }

    // Spectators on the seaward promenade: three men in dishdasha and
    // ghutra, one woman in an abaya — a Kuwaiti crowd for the circle
    {
      const crowd = new THREE.Group();
      crowd.name = "spectators";
      // Where they stand is PLAZA_SPECTATORS, hoisted so the verge can
      // keep its beds off them; who they are stays here.
      const who = [
        kuwaitiFigure("dishdasha", "check"),
        kuwaitiFigure("dishdasha", "white"),
        kuwaitiFigure("dishdasha", "check"),
        kuwaitiFigure("abaya", "white"),
      ];
      const figures: Array<[THREE.Group, number, number]> = PLAZA_SPECTATORS.map(
        ([ds, latPad], i) => [who[i], ds, latPad]
      );
      let seed = 0;
      for (const [fig, ds, latPad] of figures) {
        const s = sPlaza + ds;
        const p = new THREE.Vector3();
        track.pose(s, track.halfWidthAt(s) + latPad, p, tmp);
        fig.position.copy(p);
        fig.scale.setScalar(0.96 + 0.03 * seed);
        fig.lookAt(islandPos.x, 0, islandPos.z);
        crowd.add(fig);
        if (fig.userData.head) {
          watchers.push({
            body: fig,
            head: fig.userData.head as THREE.Object3D,
            baseYaw: fig.rotation.y,
            ...watcherArms(fig, seed % 2 === 0 ? 1 : -1, seed),
          });
        }
        seed++;
      }
      scene.add(crowd);
    }
  }

  // --------------------------------------------------- bend furniture
  // Chevron boards and braking rubber go where the road actually turns
  // (bendClusters, which the verge's beds also read to keep clear of
  // the boards).
  {
    const clusters = bendClusters(track, L);

    const chevrons = new THREE.Group();
    chevrons.name = "bend-chevrons";
    const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.7, 6);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6 });
    const boardGeo = new THREE.PlaneGeometry(CHEVRON.boardHalf * 2, 0.62);
    const boardMats = {
      right: new THREE.MeshStandardMaterial({
        map: chevronTexture(true),
        emissive: 0x7a6200,
        emissiveIntensity: 0.55,
        side: THREE.DoubleSide,
      }),
      left: new THREE.MeshStandardMaterial({
        map: chevronTexture(false),
        emissive: 0x7a6200,
        emissiveIntensity: 0.55,
        side: THREE.DoubleSide,
      }),
    };
    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0c,
      roughness: 1,
      transparent: true,
      opacity: 0.38,
    });
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    for (const c of clusters) {
      // Boards through the arc, on the outside of the bend, facing
      // oncoming traffic; the arrows point into the turn.
      const outside = c.right ? -1 : 1;
      for (let s = c.from; s <= c.to + 1; s += CHEVRON.every) {
        const g = new THREE.Group();
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.y = 0.85;
        g.add(post);
        const board = new THREE.Mesh(boardGeo, c.right ? boardMats.right : boardMats.left);
        board.position.y = 1.55;
        g.add(board);
        track.pose(s, outside * (track.halfWidthAt(s) + CHEVRON.lat), p, tmp);
        track.tangentAt(s, tmp);
        g.position.copy(p);
        g.lookAt(p.x - tmp.x, p.y, p.z - tmp.z);
        chevrons.add(g);
      }
      // Braking rubber in the two middle lanes on the approach: pairs of
      // tyre-width streaks that darken toward the turn-in point.
      for (const lane of [-1.75, 1.75]) {
        for (const off of [-0.78, 0.78]) {
          const u0 = (c.from - 68) / L;
          const u1 = (c.from - 6) / L;
          const streak = new THREE.Mesh(
            buildRibbon(track, lane + off - 0.14, lane + off + 0.14, 0.035, 4, u0, u1),
            rubberMat
          );
          streak.name = "brake-rubber";
          chevrons.add(streak);
        }
      }
    }
    scene.add(chevrons);
  }

  // Kilometre way-markers down the whole road, numbered in Arabic-Indic
  // numerals like the real Gulf Road reassurance signs
  {
    const marks: number[] = [];
    for (let m = 1000; m < COAST_END_M; m += 1000) marks.push(m);
    for (let m = COAST_END_M + 1000; m < L; m += 1000) marks.push(m);
    for (const s of marks) {
      const g = new THREE.Group();
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.09, 2.6, 8),
        new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6 })
      );
      post.position.y = 1.3;
      g.add(post);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(1.05, 1.3),
        signFaceMat(
          s < COAST_END_M
            ? waymarkTexture(Math.round(s / 100) / 10, ROADS[0].arabic, ROADS[0].name)
            : waymarkTexture(
                Math.round((s - COAST_END_M) / 100) / 10,
                ROADS[1].arabic,
                ROADS[1].name
              ),
          0.35
        )
      );
      board.position.y = 2.2;
      g.add(board);
      const p = new THREE.Vector3();
      const tmp2 = new THREE.Vector3();
      track.pose(s, ROAD_HALF_WIDTH + 1.6, p, tmp2);
      track.tangentAt(s, tmp2);
      g.position.copy(p);
      g.lookAt(p.clone().sub(tmp2));
      scene.add(g);
    }
  }

  // Remember where each backdrop piece was authored, so the per-frame
  // re-centring preserves its offset rather than collapsing it to zero.
  for (const o of skyFollowers) {
    o.userData.skyOffset = o.position.clone();
  }

  let time = 0;
  // Collect the night dressing in a single pass with one rule: a faint
  // emissive is paint or a sign face that was made readable in the dark,
  // and sunlight will light it for real; a bright one is an actual lamp
  // and stays lit. Doing it by rule rather than by hand means a material
  // added later is covered without anyone remembering to register it.
  {
    const seen = new Set<THREE.Material>();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const std = m as THREE.MeshStandardMaterial;
        if (!std?.isMeshStandardMaterial || seen.has(std)) continue;
        seen.add(std);
        const lit = std.emissive && (std.emissive.r + std.emissive.g + std.emissive.b) > 0.01;
        // The line sits above lit windows (1.6) and below street lamps
        // (3.2), tunnel strips (3.0), floodlights (3.4) and the aircraft
        // beacons (2.5) — all of which are on in daylight too.
        if (lit && std.emissiveIntensity > 0 && std.emissiveIntensity <= 2.0) {
          nightGlow.push({ mat: std, base: std.emissiveIntensity });
        }
      }
    });
  }

  return {
    moonLight,
    fillLight,
    skyFollowers,
    probe: {
      get lampMat() {
        return shimmerLampMat;
      },
      hide: probeHide,
    },
    hemiLight: hemiRef!,
    streetLamps,
    streetLampPools,
    lampLevel: () => lampLevel,
    solvePlants(dt: number, wakes: readonly Wake[]) {
      solvePlants(dt, wakes);
    },
    setSky(mode: SkyMode) {
      // The old two-state switch, expressed in the language of the
      // clock: these are the hours those looks actually are.
      this.setTimeOfDay(mode === "dawn" ? 5.6 : 22.5);
    },

    /**
     * How wet the road looks, 0..1.
     *
     * Water fills the asphalt's pores and lays a mirror over the top of
     * it, so the two things that change are roughness and how much of
     * the world the surface returns. The map already supplies a
     * 0.38-0.92 roughness range and the material multiplies it; dropping
     * the multiplier is what turns matt asphalt into something the
     * streetlights streak across.
     *
     * The road material is the ONLY thing driven from here. The paint,
     * the kerbs and the street grid stay as they are, because a wet road
     * at night reads through the reflections it throws rather than
     * through everything on it turning shiny at once — and the markings
     * are the one surface a driver needs to keep seeing.
     */
    setWetness(w: number) {
      const wet = THREE.MathUtils.clamp(w, 0, 1);
      // 1.0 dry down to 0.35 soaked. Not to zero: standing water is a
      // mirror, wet asphalt is not, and a road at roughness 0 stops
      // reading as a road at all.
      roadMat.roughness = 1 - 0.65 * wet;
      // ...and it returns more of the sky and the lamps as it does.
      roadMat.envMapIntensity = 1.15 + 1.35 * wet;
    },

    /** Rain on the screen, 0..1 — the particle density, separate from
     *  wetness because the road stays wet after the sky clears. */
    setRain(fall: number) {
      rainFall = THREE.MathUtils.clamp(fall, 0, 1);
      rainMat.opacity = 0.5 * rainFall;
      rain.visible = rainFall > 0.01;
    },

    setPixelRatio(ratio: number) {
      // The stars are sized in CSS pixels; three's own PointsMaterial
      // does this multiply for you, a ShaderMaterial does not.
      if (starsMatRef) starsMatRef.uniforms.uPixelRatio.value = ratio;
    },

    /**
     * The whole sky, as a function of one number: the hour.
     *
     * Everything that reads as "time of day" is driven from the sun's
     * altitude — sky gradient, fog, the key light's direction, colour
     * and strength, the stars, the visible body, and whether the
     * streetlights are on. Palettes are keyframed at night, twilight
     * and noon and interpolated, because the interesting minutes are
     * the ones between them.
     */
    setTimeOfDay(hours: number) {
      const h = ((hours % 24) + 24) % 24;
      // Sun altitude, -1 at midnight through +1 at noon
      const sunAlt = Math.sin(((h - 6) / 24) * Math.PI * 2);
      // Where it is on the horizon: swings across the bay through the day
      const az = ((h - 6) / 24) * Math.PI * 2;

      // Blend weights. Twilight is the narrow band around the horizon,
      // and it is what makes a cycle worth having.
      //
      // SMOOTHSTEP, NOT A LINEAR CLAMP — because the corner is visible.
      //
      // These were `clamp(sunAlt * 3.2, 0, 1)`: a straight ramp that
      // stops dead at each end. Every lighting property in this function
      // is a blend of four keyframes through these weights, so a corner
      // in a weight is a corner in the key's height, its colour, its
      // strength, the fog, the sky gradient and the fill, all at once —
      // the light does not change value at that instant, it changes RATE,
      // which is the thing an eye is actually good at catching.
      //
      // Differentiated across the day, the key's intensity curve was
      // exactly straight everywhere and spiked at four hours: 06:00 and
      // 18:00, where lit and night swap, and 07:13 and 16:47, where the
      // ramps hit their stops. Worst second difference 1.51e-2 against a
      // median of zero. Under smoothstep the worst is 2.03e-3 — seven
      // times smaller — and it is spread across its neighbours instead of
      // standing alone in a flat field, which is what a continuous curve
      // looks like when you difference it.
      //
      // A day turns in CYCLE_MINUTES, which is sixteen, so a game hour is
      // forty seconds and those two dawn corners are forty-nine seconds
      // apart. That is well inside the range where a change of rate reads
      // as the sky changing gear.
      //
      // Nothing at the ends moves. smoothstep and the clamp agree exactly
      // at 0, at the midpoint and at 1, so full night is the same full
      // night, noon is the same noon, and twilight still peaks at exactly
      // 1 when the sun is on the horizon. Only the quarters in between
      // are redrawn, and only to remove the corner. The four still sum to
      // one — asserted in tests/grade.mjs, along with twilight never
      // going negative, which is the way this partition would break.
      const lit = THREE.MathUtils.smoothstep(sunAlt * 3.2, 0, 1);
      const night = THREE.MathUtils.smoothstep(-sunAlt * 3.2, 0, 1);
      const twilight = 1 - lit - night;
      // The golden band takes its share OUT of the daylight weight, so
      // the four still sum to one and noon is left exactly as it was.
      // It rides the sun's altitude rather than the hour, which means
      // the morning gets it too — and mornings are golden.
      // Eased for the same reason, and over the same domain: this one's
      // stop at sunAlt 0.88 is the corner at mid-morning and mid-
      // afternoon, where the golden weight finishes handing over to flat
      // daylight.
      const gold = lit * THREE.MathUtils.smoothstep((0.88 - sunAlt) / 0.7, 0, 1);
      const day = lit - gold;

      const mix4 = (n: number[], t: number[], g: number[], d: number[]) =>
        new THREE.Color(
          n[0] * night + t[0] * twilight + g[0] * gold + d[0] * day,
          n[1] * night + t[1] * twilight + g[1] * gold + d[1] * day,
          n[2] * night + t[2] * twilight + g[2] * gold + d[2] * day
        );

      // Sky gradient: deep bay blue → sunrise ember → daylight blue
      if (skyMatRef) {
        const u = skyMatRef.uniforms;
        // The night zenith: a deep, nearly neutral navy-black, over a warm
        // skyline glow.
        //
        // It was raised fourfold, to [0.016, 0.028, 0.104], when the black
        // point was a HARD 0.02 clip: the sky arrived at the grade at
        // 0.017 and was subtracted to exactly zero, two thirds of every
        // sky pixel at 0/255 and the stars on a dead field. That reason
        // has gone. The black point is a 0.006 soft knee now (grade.ts),
        // which keeps a deep zenith graded with no terrace in it, and the
        // raise had left a royal-blue sky behind: B/R 6.5 in linear light,
        // which the tone mapper's toe stretches further, so the 4K stills'
        // zenith measured 22,45,114 (B - R 92, tools/shots/stillblacks.mjs).
        // A city this size does throw light back at its own sky, but it
        // is the colour of the city, which is why the glow at the skyline
        // stays warm and the blue is taken out up here.
        //
        // [0.009, 0.011, 0.022]: linear Y 0.0309 -> 0.0114, B/R 6.5 ->
        // 2.4. Modelled through the shipped chain, the stills' zenith goes
        // to about 9,11,22. In play it moves less: the old zenith's Y of
        // 0.0309 was exactly the meter's key at its 0.55 floor
        // (0.017 / 0.55, grade.ts), so a frame that is mostly sky re-meters
        // upward and looking straight up barely darkens; a chase frame,
        // whose meter stays on the floor, comes to about 6,8,14 (from
        // 7,26,83). Bluer candidates at linear B/R 3.0 and 3.4 were
        // modelled too, and the toe stretches them straight back into a
        // blue sky: [0.010, 0.013, 0.034] plays at 8,10,24.
        // The day palette is deliberately left alone. Dimming it to a
        // quarter less DOES unblow the noon sky — measured 17.4% of it at
        // 250/255 or above, down to 10.6% — but it also inverts the
        // bottom of the exposure ladder at noon, where the margin was
        // only 5.8% to begin with: a stop down came out BRIGHTER than a
        // stop at zero. Half a fix is not worth an exposure control that
        // runs backwards, and what still clips is the sun's own corner of
        // the sky. Noted in the levels tool's output instead.
        (u.uTop.value as THREE.Color).copy(
          mix4(
            [0.009, 0.011, 0.022],
            [0.030, 0.048, 0.105],
            // The zenith deepens as the sun drops — the blue goes richer
            // and loses a little of its green, which is the whole reason
            // an afternoon sky photographs better than a noon one.
            [0.13, 0.26, 0.60],
            // Bluer at the same brightness. The noon zenith was a pale
            // blue that the grade's highlight desaturation finished off:
            // the ik driver still read a flat 141,141,141 sky. More blue
            // and less red at equal luminance (0.329 -> 0.326) puts the
            // colour back without moving the noon exposure ladder, which
            // is the trap the note above records.
            [0.10, 0.33, 0.95]
          )
        );
        (u.uHorizon.value as THREE.Color).copy(
          mix4(
            // Mauve until now (the stills' skyline read 142,123,144): a
            // blue band under the warm glow. Equal luminance near enough
            // (Y 0.0669 -> 0.0638, so the skyline and the paint probe's
            // flank reflections hold) at B/R 1.52 instead of 2.5, and with
            // uGlow left warm the skyline reads as city light. Modelled
            // through the chain, no elevation of the night gradient is
            // saturated blue any more: 54,64,89 at 3°, 19,25,45 at 8°.
            [0.056, 0.064, 0.085],
            [0.42, 0.24, 0.16],
            // And the horizon band goes to warm haze rather than the pale
            // blue of midday. This is the band the city sits in.
            [0.80, 0.70, 0.55],
            // Equal luminance again (0.727 -> 0.705): a horizon haze that
            // is still blue rather than white.
            [0.52, 0.73, 1.0]
          )
        );
        (u.uGlow.value as THREE.Color).copy(
          mix4([0.085, 0.046, 0.01], [0.55, 0.21, 0.07], [0.58, 0.35, 0.13], [0.36, 0.30, 0.16])
        );
        u.uGlowHeight.value = 0.16 * night + 0.34 * twilight + 0.3 * gold + 0.22 * day;
        // The galaxy goes with the stars, on the same curve.
        u.uMilky.value = Math.pow(night, 0.7);
      }

      // Fog is the floor the scene fades to, so it has to move with the
      // sky or the horizon tears away from the world in front of it.
      const fog = scene.fog as THREE.FogExp2;
      fog.color.copy(
        mix4(
          // A dark, nearly neutral floor rather than navy. At
          // [0.008, 0.012, 0.043] (B/R 5.4) everything far away — the
          // distant facades, the far end of the road — faded into blue,
          // modelled at 4,8,41 on screen in play. This is Y 0.0081 at B/R
          // 1.7, about 4,5,6 in play and 6,6,10 in the stills: still a
          // fade to dark, no longer a fade to a colour. Fogged pixels were
          // already under dark.mjs's floor of 10/255, so no tile changes
          // class. A darker, bluer [0.005, 0.0065, 0.013] was modelled
          // and only brought the far field nearer crush.
          [0.007, 0.008, 0.012],
          [0.098, 0.102, 0.172],
          [0.70, 0.62, 0.52],
          // The noon fog follows the horizon it fades into (luminance
          // 0.701 -> 0.684).
          [0.55, 0.70, 0.92]
        )
      );
      // Thicker in the afternoon than at noon: the heat has been in the
      // air all day by then and the far end of the corniche softens.
      fog.density =
        0.0009 * night + 0.00075 * twilight + 0.00058 * gold + 0.00045 * day;

      // The key light. It is the moon at night and the sun by day, so it
      // travels: low and raking in the dark, high and white at noon.
      //
      // The height is an ANGLE now, blended across the same three
      // keyframes as everything else here, and the position is derived
      // from it — see KEY_ELEV_* for why the old |sin| curve put the key
      // at the same 56 degrees at midnight as at noon and cost the game
      // every shadow it thought it was casting.
      const elevDeg =
        KEY_ELEV_NIGHT * night +
        KEY_ELEV_TWILIGHT * twilight +
        KEY_ELEV_GOLD * gold +
        KEY_ELEV_DAY * day;
      moonLight.position.set(
        Math.cos(az) * KEY_RADIUS,
        KEY_RADIUS * Math.tan(THREE.MathUtils.degToRad(elevDeg)),
        Math.sin(az) * KEY_RADIUS * (sunAlt >= 0 ? 1 : -1)
      );
      // The direction the key comes FROM, as a unit vector, published for
      // anyone who needs to aim something at it. The engine moves this
      // light every frame to keep its shadow frustum on the player, which
      // destroys the position set above — so the hour has to travel by a
      // channel that survives being moved. Without this the shadow
      // direction was a constant in engine.ts and the clock never reached
      // it at all.
      moonLight.userData.keyDir = moonLight.position.clone().normalize();
      moonLight.color.copy(
        mix4(nightLight([0.75, 0.82, 1.0]), [1.0, 0.78, 0.55], [1.0, 0.87, 0.70], [1.0, 0.96, 0.88])
      );
      const key =
        KEY_NIGHT * night + KEY_TWILIGHT * twilight + KEY_GOLD * gold + KEY_DAY * day;
      moonLight.intensity = key;

      // The fill answers the key from the other side, tracking it so the
      // ratio holds at every hour instead of only at midnight. Warm key,
      // cool fill is what keeps a day scene from going flat, and it holds
      // for the twilight, gold and day keyframes.
      //
      // Not at night, where the key is itself cool: the moon, B/R 1.16
      // after nightLight. A fill bluer than that (it was
      // nightLight([0.42, 0.55, 0.82]), B/R 1.42) does not separate warm
      // from cool, it just paints the whole shadow side blue — and the
      // shadow side is most of a night. With the hemisphere sky below and
      // the asphalt's own albedo, which carried five extra levels of blue
      // (asphaltSurface; two now), the unlit road in the 4K stills read
      // 54,60,78 in lock and 49,56,75 in brake, B/R 1.44 and 1.53. So the
      // night fill MATCHES the key: B/R 1.15 at the same luminance (Y
      // 0.542 -> 0.543 after nightLight, which preserves luma), which
      // leaves the luma guards — tests/grade.mjs's paint-to-road ratio
      // among them — nothing to move. The night's cool note is the moon
      // and the zenith now, not every shadow in it. A paler
      // nightLight([0.62, 0.68, 0.82]) has the same hue and 25% more
      // light, which would have brightened every night shadow.
      fillLight.position.set(
        -moonLight.position.x * 0.62,
        // Never above the key. The floor is there so the fill does not
        // sink to ground level when the key is high, but the key rides a
        // real arc now and comes down past it: at half past six in the
        // morning the sun sat at 118 and the fill's floor of 120 put the
        // shadow-side light ABOVE the thing casting the shadows.
        Math.min(moonLight.position.y * 0.9, Math.max(120, moonLight.position.y * 0.42)),
        -moonLight.position.z * 0.62
      );
      fillLight.color.copy(
        mix4(nightLight([0.50, 0.545, 0.655]), [0.5, 0.6, 0.86], [0.55, 0.66, 0.92], [0.62, 0.72, 0.95])
      );
      fillLight.intensity = key * FILL_RATIO;

      // Ambient is now the third tier, not the fill: with a real fill
      // doing the shadow-side lifting, the hemisphere only has to keep
      // the very darkest crevices off absolute black.
      if (hemiRef) {
        // The night sky term follows the fill: nightLight([0.17, 0.22,
        // 0.33]) was B/R 1.41, and this is 1.18 at the same luminance
        // (Y 0.2173 -> 0.2183).
        hemiRef.color.copy(
          mix4(nightLight([0.195, 0.22, 0.27]), [0.35, 0.42, 0.59], [0.52, 0.6, 0.8], [0.55, 0.68, 0.92])
        );
        // The night ground term was brown, [0.07, 0.055, 0.03] at B/R
        // 0.43 — the one night light colour that never went through
        // nightLight — and it is what lights anything facing down: a
        // car's undertray, the underside of a sill, a tyre's lower half.
        // Hemisphere irradiance comes in a factor of pi under the IBL's,
        // so on a vertical it is a fifth of the probe; facing down the two
        // are comparable, which is why the probe's own ground (env.ts)
        // was neutralised with it — either one alone left the undersides
        // warm. Same luminance (Y 0.0564 -> 0.0561), B/R 0.90. The traffic
        // still's tyres had measured B/R 0.45 and drift's 0.31.
        hemiRef.groundColor.copy(
          mix4([0.058, 0.056, 0.052], [0.17, 0.13, 0.09], [0.46, 0.36, 0.24], [0.42, 0.36, 0.28])
        );
        // Night ambient, up from 0.2 and then from 0.3.
        //
        // The comment here used to claim this was "the only thing
        // lighting the asphalt away from a lamp". It is not, and that
        // mattered: measured, doubling this moved the darkest road pixel
        // by 1%, while trebling the scene's environment probe moved it
        // by 270%. The road away from a beam is lit by the IBL probe,
        // and this term was a rounding error next to it — which is why
        // raising it from 0.2 to 0.3 last time did not fix the asphalt
        // it was raised to fix.
        //
        // 0.55 is a real contribution rather than a gesture. It is still
        // the THIRD tier behind key and fill, and it is deliberately not
        // pushed further: this term lights the shadow side of every
        // facade in the city as well as the road, and a night sky that
        // fills its own shadows is a night that has stopped reading as
        // one. The rest of the fix is in the lamp pools, which is where
        // road light actually comes from.
        hemiRef.intensity = 0.55 * night + 0.45 * twilight + 0.5 * gold + 0.5 * day;
      }

      // Office windows: full after dark, fading through twilight, out by
      // day. They are the only thing giving a building any top end at
      // night, and the only thing that reads as a city rather than as a
      // row of dark slabs.
      for (const m of litFacades) m.emissiveIntensity = 1.15 * night + 0.45 * twilight;

      // Stars burn out as the sky lifts; nothing kills a sunrise faster
      // than a starfield still hanging in it.
      if (starsMatRef) starsMatRef.uniforms.uOpacity.value = Math.pow(night, 0.7);

      // The visible body rides the key light's OWN direction.
      //
      // It used to ride a second arc of its own — a different radius, a
      // different height law, and a sign flip that put it on the far side
      // of the sky. Measured across ten hours, the body and the light it
      // is supposed to be were between 49 and 113 degrees apart: at half
      // past five the sunrise came from 111 degrees away from where the
      // sun was drawn, so every shadow in the game pointed somewhere the
      // sun was not. Two arcs cannot be kept in step by hand; there is
      // one arc now, and the body is placed on it, so the light comes
      // from the thing you can see by construction rather than by
      // maintenance.
      // The day sky's sun, from the key light's own direction — the same
      // single arc the visible body rides — and its daylight weights.
      if (skyMatRef) {
        const u = skyMatRef.uniforms;
        if (sunAlt > 0) (u.uSunDir.value as THREE.Vector3).copy(moonLight.userData.keyDir as THREE.Vector3);
        u.uDay.value = lit;
        u.uGold.value = lit > 0 ? gold / lit : 0;
        u.uCloudT.value = h;
      }
      if (bodyDisc && bodyHalo && moonDiscMat && moonHaloMat) {
        const sunUp = sunAlt > -0.05;
        const dir = moonLight.userData.keyDir as THREE.Vector3;
        // Written as the SKY OFFSET, not as a position.
        //
        // These ride the camera: engine.ts re-centres every sky follower
        // on it each frame, taking x and z from the offset the piece was
        // authored with and leaving y alone. So a position written here
        // survived in y and was overwritten in x and z on the very next
        // frame — which is why, for as long as this has existed, the sun
        // and the moon have never moved ACROSS the sky at all. They sat
        // at one fixed compass bearing from the camera and bobbed up and
        // down with the hour. The azimuth in this function was computed,
        // multiplied out, assigned, and thrown away sixteen milliseconds
        // later. Write the offset and the two owners agree.
        const off = bodyDisc.userData.skyOffset as THREE.Vector3;
        off.set(dir.x * SKY_BODY_DIST, 0, dir.z * SKY_BODY_DIST);
        bodyDisc.position.y = dir.y * SKY_BODY_DIST;
        // Face the camera without asking where it is: the body sits at
        // camera + dir x distance, so the way back to the camera is
        // always -dir, whatever the camera does next.
        _bodyNormal.copy(dir).negate();
        bodyDisc.quaternion.setFromUnitVectors(_bodyPlaneNormal, _bodyNormal);
        (bodyHalo.userData.skyOffset as THREE.Vector3).copy(off);
        bodyHalo.position.y = bodyDisc.position.y;

        // One size, for both bodies, at every hour. The disc's half-width
        // in world units is the distance times the tangent of half the
        // angle it must subtend — so the angle is what is fixed, and it
        // stays fixed however far away the body is drawn.
        const half = SKY_BODY_DIST * Math.tan(THREE.MathUtils.degToRad(SKY_BODY_DEG) / 2);
        bodyDisc.scale.setScalar(half);
        moonDiscMat.uniforms.uSun.value = sunUp ? 1 : 0;
        // The sun is pushed past the ceiling on purpose; the moon is held
        // under it so its markings survive. See uBright.
        // A sun you cannot look at, and one you can.
        //
        // Limb darkening is real and it is 60% at the very edge, but at
        // noon nobody has ever seen it: the whole disc is so far past
        // what an eye or a sensor holds that it saturates to a flat white
        // hole, limb included. Drive it only to where the CENTRE clips
        // and the rim comes back — the first version of this did exactly
        // that and put a dark ring round the sun, a doughnut in the sky.
        // The rim has to be driven past the ceiling too, which needs
        // 1/(1 - uLimb) times as much: hence SUN_FACE_NOON.
        //
        // A setting sun is the opposite and it is why this rides the
        // hour rather than being one number. You CAN look at one: the
        // air has taken most of it out, which is the same extinction
        // that reddens it, and a low sun genuinely shows a soft edge.
        moonDiscMat.uniforms.uBright.value = sunUp
          ? SUN_FACE_TWILIGHT * twilight + SUN_FACE_GOLD * gold + SUN_FACE_NOON * day
          : MOON_FACE_BRIGHT;

        // Colour. The moon is very nearly neutral — its rock is about as
        // reflective as worn asphalt and it reflects sunlight, so what
        // reaches the eye is white with the faintest warm cast. It was
        // drawn amber, [1, 0.95, 0.83], while the light it threw was blue
        // — the object and its own shadows disagreeing about what colour
        // it was.
        //
        // The SUN reddens as it sets, and that one is real optics rather
        // than a look: a low sun is seen through many times the depth of
        // atmosphere a high one is, and the short wavelengths scatter out
        // of the beam along the way. So the warmth rides twilight and the
        // golden band, and noon is white.
        const c = moonDiscMat.uniforms.uColor.value as THREE.Color;
        if (sunUp) {
          c.setRGB(
            1,
            0.62 * twilight + 0.80 * gold + 0.97 * day,
            0.38 * twilight + 0.62 * gold + 0.93 * day
          );
        } else {
          c.setRGB(0.97, 0.96, 0.94);
        }
        // `lit`, not `day`: the golden band is daylight with a share
        // taken out of it, and anything that means "is the sun up" has to
        // ask for the whole of it or the sun fades out of its own
        // afternoon.
        moonDiscMat.uniforms.uOpacity.value = 0.35 + 0.65 * Math.max(night, lit);

        // The halo, sized against the body rather than against nothing.
        //
        // It was a flat 520 units at a distance that changed, so it
        // measured between 27 and 92 degrees across — at its worst a
        // quarter of the whole sky was halo. What it stands for is the
        // aureole: the bright ring immediately around a body, thrown by
        // scattering in the air close to the line of sight, which falls
        // away within a few degrees. Six body-widths across is 12
        // degrees, which is inside the 22-degree ice-crystal halo a real
        // moon sometimes wears and well outside the disc itself.
        const haloWidths = 6 * (1 + day * 0.35 + gold * 0.5 + twilight * 0.25);
        bodyHalo.scale.setScalar(half * 2 * haloWidths);
        moonHaloMat.opacity = 0.5 * night + 0.75 * twilight + 0.7 * gold + 0.6 * day;
        // The aureole takes the body's own colour, because that is what
        // an aureole is: the body's own light scattered forward by the
        // air in the few degrees around it. It was a fixed warm cream at
        // every hour, so the moon's glow was amber while the moon was
        // not, and the noon sun's glow was amber against a blue sky.
        //
        // Measured, so the comment does not claim more than it did: this
        // did NOT remove the faint dull ring that sits just outside the
        // noon sun (216 against 234 a little further out, on a sky that
        // bright). That ring is in the sky dome's own gradient rather
        // than in the halo, it is about 8%, and it is older than this
        // work — the halo used to be four to fifteen times wider and had
        // the same edge. Left as found, and written down rather than
        // quietly attributed to something this change fixed.
        moonHaloMat.color.copy(c);
      }

      // Streetlights are on a photocell, not a clock: they come on as
      // the light goes, hold through the night, and drop out at dawn.
      lampLevel = THREE.MathUtils.clamp(1 - lit * 1.25, 0, 1);
      if (lampPoolMat) lampPoolMat.opacity = 0.42 * lampLevel;
      // The visible shafts die with the lamps: a beam of light in
      // daylight air is a projector effect, not a streetscape.
      // 0.05, not the 0.08 it was tuned at under the meter's 0.55 floor:
      // the walls no longer hide their strength in a hard edge.
      if (lampConeMat) lampConeMat.uniforms.uOpacity.value = 0.05 * lampLevel;
      if (glintMat) glintMat.visible = lampLevel > 0.05;
      // The smears and coronas are pictures of a lit lamp too. They were
      // left on at full strength by day: pale 12 m smears down a sunlit
      // road and a glow on every unlit lantern in the noon driver still.
      if (lampStreaks) {
        (lampStreaks.material as THREE.MeshBasicMaterial).opacity = 0.42 * lampLevel;
        lampStreaks.visible = lampLevel > 0.02;
      }
      if (lampCoronaPts) {
        (lampCoronaPts.material as THREE.PointsMaterial).opacity = 0.85 * lampLevel;
        lampCoronaPts.visible = lampLevel > 0.02;
      }
      // Paint and sign faces stop glowing once the sun is lighting them
      for (const g of nightGlow) g.mat.emissiveIntensity = g.base * lampLevel;
    },

    setCrowdFocus(x: number, y: number, z: number, dt: number) {
      _focus.set(x, y, z);
      _waveT += dt;
      for (const w of watchers) {
        // Nobody cranes at a car three streets away
        const dx = w.body.position.x - x;
        const dz = w.body.position.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RIG.crowd.watchRangeM * RIG.crowd.watchRangeM) {
          // Ease back to the way they were standing
          w.head.quaternion.slerp(_rest, Math.min(1, dt * RIG.crowd.restRate));
          settleArms(w, dt);
          continue;
        }
        // The neck goes first, and reports how much of the turn it could
        // take; the body supplies whatever it could not.
        const got = aimConstrained(w.head, _focus, {
          maxYaw: RIG.crowd.neckYaw,
          maxPitch: RIG.crowd.neckPitch,
          ease: Math.min(1, dt * RIG.crowd.neckRate),
        });
        if (got < 0.999) {
          // Shoulders follow — this is the difference between a crowd
          // watching and a row of heads on swivels.
          const want = Math.atan2(x - w.body.position.x, z - w.body.position.z);
          let delta = want - w.body.rotation.y;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          w.body.rotation.y += delta * Math.min(1, dt * RIG.crowd.bodyRate) * (1 - got);
        }

        // Inside 45 m a hand goes up: a wave solved onto a moving
        // target rather than a canned clip, so it tracks wherever the
        // car actually is and settles home when it has gone.
        const arm = w.waveSide && w.arms ? w.arms.find((a) => a.side === w.waveSide) : undefined;
        if (!arm) {
          settleArms(w, dt);
          continue;
        }
        const inWave = d2 < RIG.crowd.waveRangeM * RIG.crowd.waveRangeM;
        w.lift = THREE.MathUtils.clamp(
          w.lift + (inWave ? dt * RIG.crowd.liftUpRate : -dt * RIG.crowd.liftDownRate),
          0,
          1
        );
        if (w.lift <= 0.01) {
          settleArms(w, dt);
          continue;
        }
        arm.shoulder.updateWorldMatrix(true, false);
        _sw.setFromMatrixPosition(arm.shoulder.matrixWorld);
        // Flattened direction out to the car, for the reach and the wag
        _out.set(x - _sw.x, 0, z - _sw.z);
        const len = Math.hypot(_out.x, _out.z) || 1;
        _out.multiplyScalar(1 / len);
        const span = (arm.upper + arm.lower) * w.body.scale.x;

        // Swing the arm along an ARC, by blending the direction it
        // points and holding the hand a fixed reach out along it.
        // Blending the hand's position instead draws a straight line
        // from hanging to raised that passes within a hand's width of
        // the shoulder — the solver answers that by folding the arm
        // into the armpit, so every wave began and ended with a
        // chicken-wing. Down here the arm stays extended throughout.
        const abduct = w.waveSide * RIG.spectator.armAbduction;
        _restDir.set(Math.sin(abduct), -Math.cos(abduct), 0).applyQuaternion(w.body.quaternion);
        // Raised: up and out toward the car, the wag swinging across
        // the line out to it.
        const wag = Math.sin(_waveT * RIG.crowd.wagHz + w.phase) * RIG.crowd.wagAmp * w.lift;
        const outK = RIG.crowd.raiseOut;
        _upDir
          .set(_out.x * outK - _out.z * wag, RIG.crowd.raiseUp, _out.z * outK + _out.x * wag)
          .normalize();
        _dir.copy(_restDir).lerp(_upDir, w.lift).normalize();
        _hand.copy(_sw).addScaledVector(_dir, span * RIG.crowd.reach);
        // Elbow breaks outboard and a little down, in the body's frame
        _pole
          .set(w.waveSide * RIG.crowd.poleX, RIG.crowd.poleY, RIG.crowd.poleZ)
          .applyQuaternion(w.body.quaternion)
          .add(_sw);
        solveTwoBone({
          root: arm.shoulder,
          mid: arm.elbow,
          upper: arm.upper,
          lower: arm.lower,
          target: _hand,
          pole: _pole,
          weight: 1,
        });
      }
    },
    tick(dt: number) {
      time += dt;
      // The stars' clock. Only the twinkle reads it, and only at night,
      // but a uniform write is cheaper than the branch to skip it.
      if (starsMatRef) starsMatRef.uniforms.uTime.value = time;
      // Rain falls. Only while there is any — a thousand vertices moved
      // every frame on a dry night is a thousand vertices wasted.
      if (rainFall > 0.01) {
        const pos = rainGeo.getAttribute("position") as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        for (let i = 0; i < RAIN_N; i++) {
          const o = i * 6;
          const drop = rainVel[i] * dt;
          arr[o + 1] -= drop;
          arr[o + 4] -= drop;
          // Recycled from the bottom of the box to the top, keeping its
          // own length, so the curtain never thins out.
          if (arr[o + 4] < -2) {
            const len = arr[o + 1] - arr[o + 4];
            arr[o + 1] = RAIN_TOP;
            arr[o + 4] = RAIN_TOP - len;
          }
        }
        pos.needsUpdate = true;
      }
      // Slow drift of the wave crests across the bay
      seaMap.offset.x += dt * 0.008;
      seaMap.offset.y -= dt * 0.013;
      // Aircraft-warning beacons pulse out of phase
      beacons.forEach((b, i) => {
        b.emissiveIntensity = 0.25 + 2.75 * Math.max(0, Math.sin(time * 1.8 + i * 2.1));
      });
      signalTick?.(time);
      // Lamps hum: a barely-there shimmer on every head + glint —
      // two incommensurate sines so it never reads as a loop
      if (shimmerLampMat) {
        shimmerLampMat.emissiveIntensity =
          (3.2 + Math.sin(time * 7.3) * 0.14 + Math.sin(time * 13.7) * 0.07) * lampLevel;
      }
      if (glintMat) {
        glintMat.opacity =
          (0.55 + Math.sin(time * 9.1) * 0.06 + Math.sin(time * 15.9) * 0.04) * lampLevel;
      }
    },
  };
}
