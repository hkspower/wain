import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { pointGlowTexture, poolGlowTexture } from "./glow";
import {
  Track,
  ROAD_HALF_WIDTH,
  COAST_U,
  COAST_END_M,
  LAP_LENGTH,
  DRIFT_PLAZA,
  STATIONS,
  FORECOURT,
} from "./track";
import { applyTextureManifest } from "./assets";
import { upgradePalmCrowns } from "./models";
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
import { rand, resetWorldRng } from "./rand";

/** Drooping palm fronds merged into one geometry (crown sits at trunk top). */
function palmCrownGeometry(): THREE.BufferGeometry {
  const fronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const frond = new THREE.BoxGeometry(0.2, 0.035, 2.0);
    frond.translate(0, 0, 0.98);
    frond.applyMatrix4(new THREE.Matrix4().makeRotationX(0.32 + (i % 3) * 0.14));
    frond.applyMatrix4(
      new THREE.Matrix4().makeRotationY((i / 8) * Math.PI * 2 + (i % 2) * 0.22)
    );
    fronds.push(frond);
  }
  // A short upright tuft at the centre
  const tuft = new THREE.ConeGeometry(0.22, 0.7, 5);
  tuft.translate(0, 0.3, 0);
  fronds.push(tuft);
  const merged = mergeGeometries(fronds.map((f) => f.toNonIndexed()))!;
  merged.translate(0, 6.1, 0);
  merged.computeVertexNormals();
  return merged;
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
  /** Streets sit under the highway surface (0.02) so the junction reads
   *  as the highway crossing them, and cross streets sit a hair above
   *  the avenues so the two do not z-fight where they meet. */
  yAvenue: 0.014,
  yCross: 0.016,
};

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
  { name: "Ras Al-Ard", arabic: "رأس الأرض", to: 3423 },
  // --- Second Ring Road, in the order you pass them driving it back
  // toward Bneid Al-Gar ---
  { name: "Shuwaikh Residential", arabic: "الشويخ السكنية", to: 4209 },
  { name: "Shamiya", arabic: "الشامية", to: 5000 },
  { name: "Mansuriya", arabic: "المنصورية", to: 5789 },
  { name: "Da'iya", arabic: "الدعية", to: 6580 },
  { name: "Dasma", arabic: "الدسمة", to: 7369 },
  { name: "Kuwait City", arabic: "مدينة الكويت", to: Infinity },
];

/**
 * The roads themselves.
 *
 * The game is called Gulf Road Nights and, until now, never told you
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
export const LOVE_STREET = { from: 6180, to: 7000 };

export function areaAt(track: Track, s: number) {
  const m = track.wrap(s);
  for (const a of AREAS) if (m < a.to) return a;
  return AREAS[AREAS.length - 1];
}

/** Lateral offset: a constant, or a function of s for widths that follow
 *  the drivable road (the Sharq plaza swell). */
type LatOffset = number | ((s: number) => number);
const latAt = (o: LatOffset, s: number) => (typeof o === "number" ? o : o(s));

/** Flat ribbon following the track between lateral offsets a..b at height y,
 *  optionally only over the lap fraction u0..u1. */
function buildRibbon(
  track: Track,
  a: LatOffset,
  b: LatOffset,
  y: number,
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
  const side = new THREE.Vector3();

  for (let i = 0; i <= n; i++) {
    const s = u0 * track.length + (i / n) * span;
    track.pointAt(s, p);
    track.sideAt(s, side);
    const av = latAt(a, s);
    const bv = latAt(b, s);
    const o = i * 6;
    positions[o] = p.x + side.x * av;
    positions[o + 1] = y;
    positions[o + 2] = p.z + side.z * av;
    positions[o + 3] = p.x + side.x * bv;
    positions[o + 4] = y;
    positions[o + 5] = p.z + side.z * bv;
    const ou = i * 4;
    uvs[ou] = 0;
    uvs[ou + 1] = s / 14; // one texture tile per ~14 m of road
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

/** High-detail asphalt built in a typed array rather than with tens of
 *  thousands of canvas paths — same look, ~100 ms instead of ~30 s.
 *  Returns the colour map and a matching normal map generated from the
 *  identical height field, so lighting lines up with the aggregate.
 *  Tiles every ~14 m of road. */
function asphaltSurface(): {
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
    img.data[i * 4 + 2] = v + 5;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // --- structural detail (few ops, drawn over the grain) ---------------
  // Tyre-polished wear bands where the wheels track in each lane
  for (const u of [0.125, 0.375, 0.625, 0.875]) {
    for (const off of [-0.045, 0.045]) {
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

  // Crack networks with branches
  const crack = (x: number, y: number, len: number, angle: number, depth: number) => {
    ctx.strokeStyle = `rgba(${8 + depth * 5},${9 + depth * 5},${11 + depth * 5},${0.8 - depth * 0.2})`;
    ctx.lineWidth = Math.max(0.7, 2.6 - depth * 0.8);
    ctx.beginPath();
    ctx.moveTo(x, y);
    let cx = x;
    let cy = y;
    let a = angle;
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      a += (rand() - 0.5) * 0.6;
      cx += Math.cos(a) * (len / steps);
      cy += Math.sin(a) * (len / steps);
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    if (depth < 2 && rand() < 0.8) {
      crack(cx, cy, len * 0.55, a + (rand() < 0.5 ? 0.9 : -0.9), depth + 1);
    }
  };
  for (let i = 0; i < 10; i++) {
    crack(rand() * S, rand() * S, 110 + rand() * 240, rand() * 6.28, 0);
  }

  // Sealed tar seams
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = "rgba(6,6,8,0.8)";
    ctx.lineWidth = 4 + rand() * 4;
    ctx.beginPath();
    const y0 = rand() * S;
    ctx.moveTo(0, y0);
    for (let x = 0; x <= S; x += 48) ctx.lineTo(x, y0 + Math.sin(x * 0.02) * 6);
    ctx.stroke();
  }

  // Oil drips down the lane centres
  for (let i = 0; i < 20; i++) {
    const x = [0.25, 0.5, 0.75][i % 3] * S + (rand() - 0.5) * 60;
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
  const rimg = rctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    // dark = tyre-polished = smoother; light = coarse aggregate = rougher
    const t = Math.min(1, Math.max(0, (shade[i * 4 + 1] - 9) / 26));
    const v = (0.38 + t * 0.54) * 255;
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
    g.addColorStop(0, "rgba(255,225,170,0)");
    g.addColorStop(0.5, "rgba(255,235,190,0.9)");
    g.addColorStop(1, "rgba(255,225,170,0)");
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
  core.addColorStop(0, "rgba(255,245,220,1)");
  core.addColorStop(1, "rgba(255,225,170,0)");
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

function sandTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  // Darker, wet-packed sand toward the waterline (u=1 side)
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, "#7a6b4c");
  grad.addColorStop(0.7, "#6e6044");
  grad.addColorStop(1, "#4e452f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 6000; i++) {
    const g = 90 + rand() * 70;
    ctx.fillStyle = `rgba(${g},${g - 14},${g - 38},${0.15 + rand() * 0.3})`;
    ctx.fillRect(rand() * 256, rand() * 128, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
function windowTextures(): { facade: THREE.CanvasTexture; lit: THREE.CanvasTexture } {
  const S = 4; // texels per old pixel
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
      // Glass reads darker than concrete in daylight whether or not
      // anything is on behind it.
      fx.fillStyle = "#4a525e";
      fx.fillRect(x, y, ww, wh);
      // Mullion down the middle of the pane.
      fx.fillStyle = "#3d434d";
      fx.fillRect(x + ww / 2 - Math.max(1, S / 4), y, Math.max(1, S / 2), wh);
      if (rand() < litChance) {
        const col = warm || rand() < 0.6 ? "#ffd27f" : "#9ad1ff";
        lx.fillStyle = col;
        lx.globalAlpha = 0.45 + rand() * 0.55;
        lx.fillRect(x, y, ww, wh);
        // The mullion is opaque, so it stays dark in a lit window too —
        // a pane split in half reads as a window; a solid rectangle of
        // light reads as a lamp.
        lx.globalAlpha = 1;
        lx.fillStyle = "#000000";
        lx.fillRect(x + ww / 2 - Math.max(1, S / 4), y, Math.max(1, S / 2), wh);
        // Curtain-glow spill on bright windows
        if (rand() < 0.25) {
          lx.fillStyle = col;
          lx.globalAlpha = 0.12;
          lx.fillRect(x - S, y - S, ww + 2 * S, wh + 2 * S);
        }
        lx.globalAlpha = 1;
        // A lit pane is a little paler in daylight too
        fx.fillStyle = "#5d6674";
        fx.fillRect(x, y, ww, wh);
      }
    }
  }
  const wrap = (canvas: HTMLCanvasElement) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    return tex;
  };
  return { facade: wrap(fc), lit: wrap(lc) };
}

function signTexture(en: string, ar: string, sub?: string): THREE.CanvasTexture {
  // Gulf motorway convention: Arabic on top, Latin beneath it.
  return textTexture(512, 160, (ctx) => {
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
  ctx.fillText("دوار شرق", 128, 260);
  ctx.direction = "ltr";
  ctx.font = `600 26px ${latinDisplay()}`;
  ctx.fillText("SHARQ CIRCLE", 128, 302);
  });
}

/** White thermoplastic road text, transparent everywhere else. */
function roadTextTexture(text: string): THREE.CanvasTexture {
  return textTexture(512, 256, (ctx) => {
    ctx.fillStyle = "#f2f2ee";
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    // Thermoplastic road lettering is drawn tall and heavy so it still
    // reads when foreshortened to almost nothing at the far end
    ctx.font = `700 118px ${arabicSign()}`;
    ctx.fillText(text, 256, 170);
  });
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

type Skin = { facade: THREE.CanvasTexture; lit: THREE.CanvasTexture };

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
      #endif`
    );
  };
  // Without this the two compilations — instanced and not — share a
  // cache entry and whichever compiles first wins for both.
  mat.customProgramCacheKey = () => "grn-facade-uv";
}

function glazedMat(skin: Skin, color: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: skin.facade,
    emissiveMap: skin.lit,
    emissive: 0xffffff,
    emissiveIntensity: 1.15,
    color,
    roughness,
  });
}

function liberationTower(skin: Skin, lit: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
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
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4327, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x2c5e2e, roughness: 1 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = 25 + (i % 3) * 18;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 6, 6), trunkMat);
    trunk.position.set(Math.cos(a) * r, 4.4, Math.sin(a) * r);
    g.add(trunk);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.7, 7), crownMat);
    crown.position.set(Math.cos(a) * r, 7.8, Math.sin(a) * r);
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
function fuelStation(skin: Skin): THREE.Group {
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
  const apron = new THREE.Mesh(new THREE.BoxGeometry(22, 0.16, 40), concrete);
  apron.position.y = 0.08;
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

  // Kiosk at the back of the apron, glazed toward the pumps.
  const kiosk = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(5.4, 4.2, 14),
    new THREE.MeshStandardMaterial({ color: 0xe4e6ea, roughness: 0.8 })
  );
  shell.position.y = 2.1;
  shell.castShadow = true;
  kiosk.add(shell);
  const glassMat = new THREE.MeshStandardMaterial({
    map: skin.lit,
    color: 0xfff3d8,
    emissive: 0xffe7ae,
    emissiveIntensity: 1.5,
    roughness: 0.25,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.4), glassMat);
  glass.position.set(2.73, 2.2, 0);
  glass.rotation.y = Math.PI / 2;
  kiosk.add(glass);
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.7, 14.4), trim);
  parapet.position.y = 4.4;
  kiosk.add(parapet);
  kiosk.position.set(-8, 0.16, 0);
  g.add(kiosk);

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
 *  column is 8.4 m tall and a deck soffit is at 6.4 — a pole under a
 *  bridge goes through it. Real lighting stops short of a structure and
 *  the structure carries its own. */
const FLYOVER_CLEAR = 30;

/** True if `s` is close enough to a flyover that a street pole would
 *  foul the deck. */
function underFlyover(track: Track, s: number): boolean {
  for (const f of FLYOVERS) {
    if (Math.abs(track.deltaAhead(f.s, s)) < FLYOVER_CLEAR) return true;
  }
  return false;
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
  /** The moon — the engine drives its shadow frustum along with the player. */
  moonLight: THREE.DirectionalLight;
  /** The weaker, cooler light opposite the key. Casts nothing. */
  fillLight: THREE.DirectionalLight;
  /** Sky dome, stars and moon disc — re-centred on the camera each frame
   *  so they can sit inside a tight far plane without ever clipping. */
  skyFollowers: THREE.Object3D[];
}

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

// Underpass on the Second Ring, TXR-style. It sits under the Shamiya
// junction at 5000 m rather than anywhere convenient: the ring's
// junctions really are grade-separated, and the through lanes really do
// dive under the cross traffic. Metres in, fraction out — the fraction
// is what the ribbon and wall builders take, and it has to be recomputed
// from the lap rather than typed in, or the tunnel walks off its
// junction the next time the track changes length.
const TUNNEL_S = { from: 4855, to: 5145 };
const TUNNEL_U = { from: TUNNEL_S.from / LAP_LENGTH, to: TUNNEL_S.to / LAP_LENGTH };

// The key light's strength through the day, and what the fill runs at
// relative to it. A fill at a third of the key lifts the shadow side to
// about a stop and a half under — enough to read, far enough down that
// the key still does the modelling.
const KEY_NIGHT = 1.15;
const KEY_TWILIGHT = 1.5;
const KEY_DAY = 3.1;
const FILL_RATIO = 0.3;

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
const KEY_ELEV_DAY = 54;
/** How far out the key sits, horizontally, from what it is lighting. */
const KEY_RADIUS = 520;

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
  /** Advances the traffic signals; assigned in the signal block. */
  let signalTick: ((t: number) => void) | null = null;
  let shimmerLampMat: THREE.MeshStandardMaterial | null = null;
  // Handles the time-of-day switch repaints
  let skyMatRef: THREE.ShaderMaterial | null = null;
  // Everything whose windows come on after dark, so one place drives them.
  const litFacades: THREE.MeshStandardMaterial[] = [];
  let starsMatRef: THREE.PointsMaterial | null = null;
  let moonDiscMat: THREE.MeshBasicMaterial | null = null;
  let moonHaloMat: THREE.SpriteMaterial | null = null;
  // The celestial body: the moon after dark, the sun in daylight — one
  // disc that crosses the sky, because two would be a lie half the time.
  let bodyDisc: THREE.Mesh | null = null;
  let bodyHalo: THREE.Sprite | null = null;
  let lampPoolMat: THREE.MeshBasicMaterial | null = null;
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

  // Fog and light
  // Draw distance: at 0.0021 the world vanished by ~700 m, which hid the
  // far side of the bay. 0.0009 pushes usable visibility past 2 km so the
  // skyline, the towers and oncoming traffic read from a long way out.
  // Fog colour is the floor the whole scene fades to, so it has to be at
  // least as dark as the darkest object or distance reads as grey haze.
  scene.fog = new THREE.FogExp2(0x02030b, 0.0009);
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
        uTop: { value: new THREE.Color(0.004, 0.007, 0.026) },
        uHorizon: { value: new THREE.Color(0.05, 0.066, 0.125) },
        uGlow: { value: new THREE.Color(0.085, 0.046, 0.01) },
        /** How far the horizon band climbs — dawn light reaches higher. */
        uGlowHeight: { value: 0.16 },
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
        void main() {
          float h = clamp(vPos.y / 600.0, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, smoothstep(0.0, 0.6, h));
          // light hugging the skyline: sodium at night, sunrise at dawn
          col += uGlow * (1.0 - smoothstep(0.0, uGlowHeight, h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    skyMatRef = skyMat;
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1900, 24, 12), skyMat);
    // Named for the levels tool, which measures the delivered picture per
    // surface and otherwise has to guess which of the sky followers is
    // the dome rather than the moon, its halo or the stars.
    sky.name = "sky";
    sky.renderOrder = -2;
    scene.add(sky);
    skyFollowers.push(sky);

    // The moon over the Gulf, with a soft halo
    moonDiscMat = new THREE.MeshBasicMaterial({ color: 0xfdf3d3, fog: false, transparent: true });
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(70, 32), moonDiscMat);
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

  // Stars
  {
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const e = rand() * Math.PI * 0.45 + 0.08;
      const r = 1750;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r * 0.5;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starsMatRef = new THREE.PointsMaterial({
      color: 0xcdd8ff,
      size: 2.4,
      sizeAttenuation: false,
      fog: false,
      transparent: true,
    });
    const stars = new THREE.Points(geo, starsMatRef);
    scene.add(stars);
    skyFollowers.push(stars);
  }

  // City floor inland of the corniche
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshStandardMaterial({ color: 0x241d12, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(2700, -0.08, -1400);
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
  const paver = paverTexture();
  paver.repeat.set(2.5, 9);
  const walkway = new THREE.Mesh(
    buildRibbon(track, -(ROAD_HALF_WIDTH + 0.8), -(ROAD_HALF_WIDTH + 4.5), 0.06, 10, COAST_U.from, COAST_U.to),
    new THREE.MeshStandardMaterial({ map: paver, roughness: 0.95 })
  );
  scene.add(walkway);

  const sand = sandTexture();
  sand.repeat.set(1, 0.7);
  const beach = new THREE.Mesh(
    buildRibbon(track, -(ROAD_HALF_WIDTH + 4.5), -(ROAD_HALF_WIDTH + 48), 0.0, 10, COAST_U.from, COAST_U.to),
    new THREE.MeshStandardMaterial({ map: sand, roughness: 1 })
  );
  beach.receiveShadow = true;
  scene.add(beach);

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
  const road = new THREE.Mesh(
    buildRibbon(
      track,
      (s) => -track.halfWidthAt(s),
      (s) => track.halfWidthAt(s),
      0.02,
      3
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

    const crossCount = Math.round(L / STREETS.crossEvery);
    for (let i = 0; i < crossCount; i++) {
      // Spaced by an exact division of the lap so the last block closes
      // onto the first instead of leaving a short stub at the seam.
      const s = (i / crossCount) * L;
      const u = track.wrap(s) / L;
      const onCoast = u >= COAST_U.from && u <= COAST_U.to;
      // Start at the highway's own edge, which is wider at the plaza.
      const edge = track.halfWidthAt(s);
      parts.push(crossQuad(s, edge, outer + STREETS.half));
      if (!onCoast) parts.push(crossQuad(s, -(outer + STREETS.half), -edge));
    }

    // One mesh for the entire network: ~70 pieces would otherwise be ~70
    // draw calls for a few thousand triangles of flat ground.
    const streets = new THREE.Mesh(mergeGeometries(parts)!, streetMat);
    streets.name = "streets";
    streets.receiveShadow = true;
    scene.add(streets);
    for (const g of parts) g.dispose();

    // ----------------------------------------------- markings
    //
    // The grid was bare asphalt. The highway has had edge lines and lane
    // dashes since the beginning and the streets crossing it had nothing
    // at all, which is what made them read as grey ribbons laid over the
    // ground rather than as roads.
    //
    // Built in road space for the same reason the streets themselves
    // are: a dash placed at (s, lat) is on the street at (s, lat), so
    // the centre line follows every bend without anyone solving for it.
    //
    // Paint on a side street is worn and lit by nothing but a passing
    // headlight, so it is dimmer than the highway's — the route you are
    // racing stays the brightest line in the scene.
    const streetLineMat = new THREE.MeshStandardMaterial({
      color: 0xdedcd2,
      emissive: 0x6f6e68,
      emissiveIntensity: 0.35,
      roughness: 0.7,
    });
    const blockLen = L / Math.round(L / STREETS.crossEvery);
    /** How close to a junction paint stops. A centre line that runs
     *  straight through an intersection is the single thing that makes a
     *  grid look printed on rather than built. */
    const CLEAR = STREETS.half + 2.2;
    const nearCross = (s: number) => {
      const off = ((s % blockLen) + blockLen) % blockLen;
      return Math.min(off, blockLen - off) < CLEAR;
    };
    const nearAvenue = (lat: number) =>
      STREETS.avenues.some((d) => Math.abs(Math.abs(lat) - d) < CLEAR);

    const DASH = { len: 2.4, gap: 13 };
    const dashGeo = new THREE.PlaneGeometry(0.12, DASH.len);
    dashGeo.rotateX(-Math.PI / 2);
    // Sits above the street surface but below the highway's own paint,
    // so nothing z-fights where the grid passes the road.
    const paintY = STREETS.yCross + 0.006;

    const mats: THREE.Matrix4[] = [];
    const mp = new THREE.Vector3();
    const mside = new THREE.Vector3();
    const mtan = new THREE.Vector3();
    const mq = new THREE.Quaternion();
    const FWD = new THREE.Vector3(0, 0, 1);
    const one = new THREE.Vector3(1, 1, 1);
    const put = (pos: THREE.Vector3, along: THREE.Vector3) => {
      mq.setFromUnitVectors(FWD, along);
      mats.push(new THREE.Matrix4().compose(pos.clone().setY(paintY), mq, one));
    };

    // Centre line down every avenue, both sides of the highway. The
    // seaward half only exists past the coast, exactly where its asphalt
    // does — paint hanging over the Gulf would be worse than none.
    for (const d of STREETS.avenues) {
      for (const sign of [1, -1]) {
        for (let s = 0; s < L; s += DASH.gap) {
          if (nearCross(s)) continue;
          if (sign < 0) {
            const u = track.wrap(s) / L;
            if (u < COAST_U.to) continue;
          }
          track.pose(s, sign * d, mp, mside);
          track.tangentAt(s, mtan);
          put(mp, mtan);
        }
      }
    }

    // Centre line out along every cross street, from the highway's edge
    // to the far kerb of the outermost avenue.
    for (let i = 0; i < crossCount; i++) {
      const s = (i / crossCount) * L;
      const u = track.wrap(s) / L;
      const onCoast = u >= COAST_U.from && u <= COAST_U.to;
      const edge = track.halfWidthAt(s);
      track.sideAt(s, mside);
      for (const sign of [1, -1]) {
        if (sign < 0 && onCoast) continue;
        for (let lat = edge + CLEAR; lat < outer + STREETS.half; lat += DASH.gap) {
          if (nearAvenue(lat)) continue;
          track.pose(s, sign * lat, mp, mtan);
          put(mp, mside);
        }
      }
    }

    const dashes = new THREE.InstancedMesh(dashGeo, streetLineMat, mats.length);
    mats.forEach((m, i) => dashes.setMatrixAt(i, m));
    dashes.instanceMatrix.needsUpdate = true;
    dashes.name = "street-dash";
    dashes.receiveShadow = true;
    scene.add(dashes);

    // A stop bar where each cross street meets the highway — the one
    // junction the player drives past close enough to read.
    const barGeo = new THREE.PlaneGeometry(0.45, STREETS.half * 1.7);
    barGeo.rotateX(-Math.PI / 2);
    const bars: THREE.Matrix4[] = [];
    for (let i = 0; i < crossCount; i++) {
      const s = (i / crossCount) * L;
      const u = track.wrap(s) / L;
      const onCoast = u >= COAST_U.from && u <= COAST_U.to;
      const edge = track.halfWidthAt(s);
      track.tangentAt(s, mtan);
      for (const sign of [1, -1]) {
        if (sign < 0 && onCoast) continue;
        track.pose(s, sign * (edge + 2.6), mp, mside);
        mq.setFromUnitVectors(FWD, mtan);
        bars.push(new THREE.Matrix4().compose(mp.clone().setY(paintY), mq, one));
      }
    }
    const stopBars = new THREE.InstancedMesh(barGeo, streetLineMat, bars.length);
    bars.forEach((m, i) => stopBars.setMatrixAt(i, m));
    stopBars.instanceMatrix.needsUpdate = true;
    stopBars.name = "street-stop";
    stopBars.receiveShadow = true;
    scene.add(stopBars);
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

  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xf6f6f2,
    emissive: 0xa8a8a0,
    emissiveIntensity: 0.5,
    roughness: 0.5,
  });
  // The paint is named alongside the asphalt it sits on. It is the
  // brightest thing on the road surface, so a levels reading that leaves
  // it out understates the road's ceiling by most of what it has.
  for (const edge of [-1, 1]) {
    const line = new THREE.Mesh(
      buildRibbon(
        track,
        (s) => edge * (track.halfWidthAt(s) - (edge < 0 ? 0.35 : 0.15)),
        (s) => edge * (track.halfWidthAt(s) - (edge < 0 ? 0.15 : 0.35)),
        0.03,
        4
      ),
      lineMat
    );
    line.name = "road-line";
    // The markings receive too. They sit a centimetre proud of the
    // asphalt they are painted on, and a lane line that stays bright
    // inside a shadow crossing it is the loudest possible way to say
    // that the shadow is not really there.
    line.receiveShadow = true;
    scene.add(line);
  }

  {
    const dashGeo = new THREE.PlaneGeometry(0.14, 3);
    dashGeo.rotateX(-Math.PI / 2);
    const dashMat = new THREE.MeshStandardMaterial({
      color: 0xf2f2ee,
      emissive: 0x9a9a92,
      emissiveIntensity: 0.45,
      roughness: 0.55, // thermoplastic paint, slightly glossier than asphalt
    });
    const boundaries = [-3.5, 0, 3.5];
    const spacing = 14;
    const perLine = Math.floor(L / spacing);
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, perLine * boundaries.length);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const side = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const fwd = new THREE.Vector3(0, 0, 1);
    let idx = 0;
    for (const b of boundaries) {
      for (let i = 0; i < perLine; i++) {
        const s = i * spacing;
        track.pose(s, b, p, side);
        track.tangentAt(s, tan);
        q.setFromUnitVectors(fwd, tan);
        p.y = 0.03;
        m.compose(p, q, new THREE.Vector3(1, 1, 1));
        dashes.setMatrixAt(idx++, m);
      }
    }
    dashes.instanceMatrix.needsUpdate = true;
    dashes.name = "road-dash";
    dashes.receiveShadow = true;
    scene.add(dashes);
  }

  // Guardrails
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x9aa2ab,
    roughness: 0.4,
    metalness: 0.7,
    side: THREE.DoubleSide,
  });
  for (const edge of [-1, 1]) {
    const rail = new THREE.Mesh(
      buildWall(track, (s) => edge * (track.halfWidthAt(s) + 0.6), 0.3, 0.95),
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
  }

  // Streetlights: poles + sodium lamps, alternating sides
  {
    const spacing = 42;
    const count = Math.floor(L / spacing);
    const poleGeo = new THREE.CylinderGeometry(0.14, 0.2, 8.4, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.7 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, count);
    // A vertical post-top luminaire, not a cobra arm reaching out over
    // the carriageway. The LED is a standing blade at the head of the
    // pole with a dark shroud behind it, which is the shape the Gulf
    // Road's own columns were retrofitted to.
    const shroudGeo = new THREE.BoxGeometry(0.24, 1.72, 0.24);
    const shrouds = new THREE.InstancedMesh(shroudGeo, poleMat, count);
    const lampGeo = new THREE.BoxGeometry(0.2, 1.44, 0.2);
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
    // Warm pool of lamplight thrown onto the asphalt below each lamp
    const poolGeo = new THREE.CircleGeometry(10.5, 20);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({
      map: lightPoolTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, count);
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
      const u = s / L;
      // No street poles inside the tunnel — and none under a flyover
      // either. A column is 8.4 m tall and a deck soffit is at 6.4, so
      // an unfiltered pole grows straight through the bridge; real
      // lighting stops short of a structure and the structure carries
      // its own, which is what flyover() puts on the parapet.
      if (
        (u > TUNNEL_U.from - 0.004 && u < TUNNEL_U.to + 0.004) ||
        underFlyover(track, s)
      ) {
        poles.setMatrixAt(i, hidden);
        shrouds.setMatrixAt(i, hidden);
        lamps.setMatrixAt(i, hidden);
        pools.setMatrixAt(i, hidden);
        continue;
      }
      const sideSign = i % 2 === 0 ? 1 : -1;
      track.pose(s, sideSign * (ROAD_HALF_WIDTH + 1.6), p, tmp);
      m.makeTranslation(p.x, 4.2, p.z);
      poles.setMatrixAt(i, m);

      // The blade stands on the pole itself. Everything is square to the
      // road so the shroud hides the emitter from behind and the light
      // faces the carriageway.
      track.tangentAt(s, tanV);
      tanV.y = 0;
      tanV.normalize();
      // Unit vector for +lat is (-Tz, 0, Tx)
      sideV.set(tanV.z * sideSign, 0, -tanV.x * sideSign).normalize();
      armQ.setFromUnitVectors(xAxis, sideV);
      track.pose(s, sideSign * (ROAD_HALF_WIDTH + 1.6), p, tmp);
      const hx = p.x;
      const hz = p.z;
      armMid.set(hx, 9.15, hz);
      m.compose(armMid, armQ, unitV);
      shrouds.setMatrixAt(i, m);
      // The emitter sits proud of the shroud on the road side of it.
      armMid.set(hx + sideV.x * 0.09, 9.1, hz + sideV.z * 0.09);
      m.compose(armMid, armQ, unitV);
      lamps.setMatrixAt(i, m);
      lampPositions.push(new THREE.Vector3(armMid.x, 9.1, armMid.z));

      // The pool lands under the head and spills toward the road centre
      // (the head's optic faces down-and-in, not straight down)
      track.pose(s, sideSign * (ROAD_HALF_WIDTH - 2.4), p, tmp);
      m.makeTranslation(p.x, 0.045, p.z);
      pools.setMatrixAt(i, m);
    }
    shrouds.instanceMatrix.needsUpdate = true;
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
    const q = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    const scl = new THREE.Vector3(1, 1, 1);
    const tan = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const s2 = i * spacing;
      const u2 = s2 / L;
      if (u2 > TUNNEL_U.from - 0.004 && u2 < TUNNEL_U.to + 0.004) {
        streaks.setMatrixAt(i, hidden);
        continue;
      }
      const sideSign = i % 2 === 0 ? 1 : -1;
      // Inset from the kerb so a straight smear never crosses the rail
      // when the road bends underneath it.
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

    poles.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    pools.instanceMatrix.needsUpdate = true;
    poles.castShadow = true;
    scene.add(poles, shrouds, lamps, pools, streaks);
    // LED coronas around every blade
    // Tight. A 4.6 m round corona around a 0.15 m-wide blade is all you
    // see — the luminaire is vertical and reads as a blob anyway, which
    // defeats the point of standing it up.
    scene.add(coronaPoints(lampPositions, 0xdbe7ff, 2.8));
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
      scene.add(glints);
    }
    shimmerLampMat = lampMat;
    lampPoolMat = poolMat;
  }

  // ------------------------------------------------- traffic signals
  //
  // The junctions grew stop bars when the grid was painted and nothing
  // to obey. A signal head on a mast arm over the carriageway, at every
  // other cross street — signalising all seventy-two would put a gantry
  // every 118 m, which is denser than any real arterial and would make
  // the road read as a car park.
  //
  // The three aspects are one instanced mesh of lenses coloured per
  // instance. An emissive material cannot vary per instance in three,
  // so a shared one would light every red in the city at the same
  // moment; an unlit lens tinted through instanceColor can differ
  // junction by junction, and a lit lamp lens is close to unlit anyway.
  {
    const crossCount = Math.round(L / STREETS.crossEvery);
    const every = 2; // signalised junctions, in cross streets
    const sides = 2;
    const heads: number[] = []; // s values, one per signalised approach
    const junctions: Array<{ s: number; sideSign: number }> = [];
    for (let i = 0; i < crossCount; i += every) {
      const s2 = (i / crossCount) * L;
      const u2 = track.wrap(s2) / L;
      if (u2 > TUNNEL_U.from - 0.01 && u2 < TUNNEL_U.to + 0.01) continue;
      for (let k = 0; k < sides; k++) junctions.push({ s: s2, sideSign: k === 0 ? 1 : -1 });
      heads.push(s2);
    }
    const n = junctions.length;
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

    junctions.forEach(({ s: js, sideSign }, i) => {
      track.tangentAt(js, tan);
      tan.y = 0;
      tan.normalize();
      inward.set(tan.z * sideSign, 0, -tan.x * sideSign).normalize();
      q.setFromUnitVectors(xAxis, inward);

      // The pole stands back behind the kerb; the head hangs over the
      // inside lane, a little short of the stop bar so you can still see
      // it from behind the line.
      track.pose(js, sideSign * (ROAD_HALF_WIDTH + 1.2), p, tmp);
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
    const offsets = junctions.map((_, i) => ((i * 7.31) % CYCLE));
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

  // Cat-eye road studs along both edge lines — they sparkle into the
  // distance under the headlights
  {
    const spacing = 18;
    const count = Math.floor(L / spacing) * 2;
    const studGeo = new THREE.SphereGeometry(0.07, 6, 4);
    const studMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff2c0,
      emissiveIntensity: 1.6,
    });
    const studs = new THREE.InstancedMesh(studGeo, studMat, count);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    let idx = 0;
    for (let i = 0; i < count / 2; i++) {
      const s = i * spacing;
      for (const sideSign of [-1, 1]) {
        track.pose(s, sideSign * (ROAD_HALF_WIDTH - 0.25), p, tmp);
        m.makeTranslation(p.x, 0.06, p.z);
        studs.setMatrixAt(idx++, m);
      }
    }
    studs.instanceMatrix.needsUpdate = true;
    scene.add(studs);
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
      // Not on a forecourt. The station occupies the first band of the
      // block — the one between the shoulder and the first avenue — and
      // the block picker has no idea it is there, so a tower would go up
      // through the canopy about one time in twenty.
      if (
        STATIONS.some(
          (st) =>
            Math.abs(track.deltaAhead(st.s, s)) < FORECOURT.halfSpan + width / 2 + 6 &&
            lo < st.lat + 13 &&
            hi > st.lat - 13
        )
      ) {
        continue;
      }
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
      // Square to the street. Local +Z runs along the road, so the box's
      // Z extent is its frontage and its X extent is its depth.
      track.tangentAt(s, tmp);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tmp.x, tmp.z));
      // Taller skyline near the city at the top of the lap
      const cityBoost = u > 0.88 || u < 0.06 ? 2.1 : 1;
      const h = (10 + rand() * rand() * 55) * cityBoost;
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
        setback: h > 52 && rand() < 0.75,
        plant: rand() < 0.55,
        mast: h > 70 && rand() < 0.5,
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
      });
      const plantMat = new THREE.MeshStandardMaterial({
        color: 0x70747c,
        roughness: 0.95,
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
      const setbacks: typeof massing = [];
      const plants: typeof massing = [];
      const masts: typeof massing = [];
      massing.forEach((b, i) => {
        if (b.setback) { setbacks.push(b); setbackOf.push(i); }
        if (b.plant) { plants.push(b); plantOf.push(i); }
        if (b.mast) { masts.push(b); mastOf.push(i); }
      });

      const parapetMesh = new THREE.InstancedMesh(capGeo, concrete, massing.length);
      const setbackMesh = new THREE.InstancedMesh(capGeo, mat, Math.max(1, setbacks.length));
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

      for (const im of [parapetMesh, setbackMesh, plantMesh, mastMesh]) {
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
      // Named so the building tests can find them, and so the ID pass in
      // the sharpness tool counts a roof as part of its building.
      parapetMesh.name = "cityParapets";
      setbackMesh.name = "citySetbacks";
      plantMesh.name = "cityPlant";
      mastMesh.name = "cityMasts";
      // Instance i of each of these stands on instance ownerOf[i] of
      // cityBlocks. A parapet is one per shaft, so its map is the
      // identity.
      parapetMesh.userData.ownerOf = massing.map((_, i) => i);
      setbackMesh.userData.ownerOf = setbackOf;
      plantMesh.userData.ownerOf = plantOf;
      mastMesh.userData.ownerOf = mastOf;
      litFacades.push(concrete);
    }
    scene.add(blocks);
  }

  // Palm rows lining the corniche walkway, the whole length of the coast
  {
    const coastLen = (COAST_U.to - COAST_U.from) * L;
    const count = Math.floor(coastLen / 26);
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 6, 6);
    trunkGeo.translate(0, 3, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4327, roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    // Trunks cast too, or the frond shadows float detached from the trees
    trunks.castShadow = true;
    const crownGeo = palmCrownGeometry();
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2e5f30, roughness: 1 });
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
    crowns.castShadow = true;
    // One authored crown serves all ~130 instances
    upgradePalmCrowns(crowns);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const s = COAST_U.from * L + (i / count) * coastLen;
      // Sea-side walkway edge, with the occasional inland palm
      const lateral =
        i % 5 === 4
          ? ROAD_HALF_WIDTH + 3 + rand() * 4
          : -(ROAD_HALF_WIDTH + 2.6);
      track.pose(s + rand() * 6, lateral, p, tmp);
      m.makeTranslation(p.x, 0, p.z);
      trunks.setMatrixAt(i, m);
      // Random spin per crown so the frond pattern doesn't repeat
      m.makeRotationY(rand() * Math.PI * 2).setPosition(p.x, 0, p.z);
      crowns.setMatrixAt(i, m);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    scene.add(trunks, crowns);
  }

  // Hawally tunnel: concrete walls + ceiling, sodium strip lights inside
  {
    const concreteMap = concreteTexture();
    concreteMap.repeat.set(1, 2);
    const concrete = new THREE.MeshStandardMaterial({
      map: concreteMap,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    const wallL = new THREE.Mesh(
      buildWall(track, -(ROAD_HALF_WIDTH + 1.6), 0, 5.4, 6, TUNNEL_U.from, TUNNEL_U.to),
      concrete
    );
    const wallR = new THREE.Mesh(
      buildWall(track, ROAD_HALF_WIDTH + 1.6, 0, 5.4, 6, TUNNEL_U.from, TUNNEL_U.to),
      concrete
    );
    const ceiling = new THREE.Mesh(
      buildRibbon(track, -(ROAD_HALF_WIDTH + 1.6), ROAD_HALF_WIDTH + 1.6, 5.4, 6, TUNNEL_U.from, TUNNEL_U.to),
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
    scene.add(coronaPoints(stripPositions, 0xdbe7ff, 2.6));
  }

  // Illuminated billboards — the TXR night-expressway signature,
  // with distinctly Kuwaiti advertisers
  {
    const ads: Array<[string, string, string, string, string, number, number]> = [
      // line1, line2, bg, fg, accent, metres from the line, side offset
      ["وين؟ WAIN", "wain nrooh? — يلا", "#0f4f4a", "#eafff9", "#2e978e", 257, 24],
      ["بو مجبوس", "BU MACHBOOS · best machboos on the Gulf", "#7a2d08", "#ffe9d4", "#e8641b", 661, 26],
      ["SAQER ⚡ صقر", "ENERGY — hunt the night", "#1a0a0a", "#ffd2c2", "#c1121f", 1138, 24],
      ["AL-DABOOS", "كراج الدبوس · TUNING & DYNO", "#1c1c10", "#ffe9a3", "#f5c211", 1652, 26],
      ["بنك الديرة", "BANK AL-DEERA · drive now, pay later", "#0a2a52", "#dcebff", "#3b82d4", 2203, 25],
      ["ليالي السالمية", "SALMIYA NIGHTS — open till fajer", "#2a0a3a", "#f3dcff", "#b84dd6", 2643, 24],
      ["قهوة GAHWA", "first cup free for racers ☕", "#3a2510", "#ffeeda", "#c98a3d", 3157, 22],
      ["دروازة مول", "DARWAZA MALL · 200 shops", "#0d3a1e", "#dcffe9", "#16a34a", 4400, 28],
      ["GULF ROAD", "NIGHTS · ليالي شارع الخليج 🏁", "#101728", "#dceaff", "#38e8ff", 5500, 26],
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
    const station = fuelStation(windows);
    placeBeside(track, station, st.s, st.lat, `fuel-station-${i}`);
    const tan = new THREE.Vector3();
    track.tangentAt(st.s, tan);
    // Square to the road: local +Z runs along it, +X out to the kerb.
    station.rotation.y = Math.atan2(tan.x, tan.z);
    scene.add(station);
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

    placeBeside(track, mast("kw", 3, 14), 0, -(ROAD_HALF_WIDTH + 4));
    // The rest of the region, back down the corniche from the line, on
    // matched shorter masts. Kuwait is skipped here — it is already
    // flying, taller, at the line.
    const rest = FLAG_IDS.filter((id) => id !== "kw");
    for (let i = 0; i < rest.length; i++) {
      placeBeside(track, mast(rest[i], 2.1, 10), -26 - i * 13, -(ROAD_HALF_WIDTH + 4));
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
    const spots: Array<[number, number]> = [
      [-9, 2.6],
      [-4.5, 3.4],
      [3.5, 2.8],
      [8.5, 3.6],
    ];
    looks.forEach((look, i) => {
      const fig = kuwaitiRacer(look);
      const [ds, latPad] = spots[i];
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
    const s = i === 0 ? L - 60 : start + 25;
    const g = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6 });
    for (const sideSign of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 7.5, 8), postMat);
      post.position.set(sideSign * (ROAD_HALF_WIDTH + 1.2), 3.75, 0);
      g.add(post);
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry((ROAD_HALF_WIDTH + 1.5) * 2, 0.5, 0.5),
      postMat
    );
    beam.position.y = 7.3;
    g.add(beam);
    // Front face only — a DoubleSide plane shows mirrored text from behind
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 3.1),
      new THREE.MeshStandardMaterial({
        map: signTexture(area.name.toUpperCase(), area.arabic),
        emissive: 0x666666,
      })
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
      new THREE.MeshStandardMaterial({
        map: signTexture("LOVE STREET", "شارع الحب", "2ND RING RD"),
        emissive: 0x555555,
      })
    );
    board.position.y = 4.2;
    g.add(board);
    const p = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    track.pose(s, ROAD_HALF_WIDTH + 2.0, p, tmp2);
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
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4327, roughness: 1 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2c5e2e, roughness: 1 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const r = DRIFT_PLAZA.islandRadius - 1.7;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 4.2, 6), trunkMat);
      trunk.position.set(Math.cos(a) * r, 2.6, Math.sin(a) * r);
      island.add(trunk);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.2, 7), crownMat);
      crown.position.set(Math.cos(a) * r, 5.0, Math.sin(a) * r);
      island.add(crown);
    }
    island.position.copy(islandPos);
    scene.add(island);

    // Painted drift ring around the island, and the rubber laid into it
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(DRIFT_PLAZA.islandRadius + 3.0, DRIFT_PLAZA.islandRadius + 3.4, 48),
      new THREE.MeshStandardMaterial({
        color: 0xf2f2ee,
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
        new THREE.RingGeometry(DRIFT_PLAZA.islandRadius + 1.4, DRIFT_PLAZA.islandRadius + 2.6, 40, 1, a0, len),
        rubberMat
      );
      skid.rotation.x = -Math.PI / 2;
      skid.position.set(islandPos.x, 0.04, islandPos.z);
      scene.add(skid);
    }

    // Arabic paint on the approach asphalt: the circle's name, twice
    for (const back of [75, 130]) {
      const s = sPlaza - back;
      const paint = new THREE.Mesh(
        new THREE.PlaneGeometry(4.6, 2.3),
        new THREE.MeshStandardMaterial({
          map: roadTextTexture("دوار شرق"),
          transparent: true,
          roughness: 0.55,
          emissive: 0x9a9a92,
          emissiveIntensity: 0.35,
        })
      );
      const g = new THREE.Group();
      paint.rotation.x = -Math.PI / 2;
      paint.position.y = 0.05;
      g.add(paint);
      const p = new THREE.Vector3();
      track.pointAt(s, p);
      track.tangentAt(s, tmp);
      g.position.copy(p);
      // Lay the text so an oncoming driver reads it upright
      g.lookAt(p.clone().sub(tmp));
      scene.add(g);
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
        new THREE.MeshStandardMaterial({ map: roundaboutSignTexture(), emissive: 0x555555 })
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
    // halfWidthAt exactly, so the paint stays glued to the physics.
    {
      const kerbTex = stripeTexture("#c8342b", "#f2f2ee");
      kerbTex.wrapS = kerbTex.wrapT = THREE.RepeatWrapping;
      const kerbMat = new THREE.MeshStandardMaterial({
        map: kerbTex,
        roughness: 0.6,
        emissive: 0x3a2320,
        emissiveIntensity: 0.35,
      });
      const uSpan = (DRIFT_PLAZA.halfSpan + 14) / L;
      for (const sign of [-1, 1]) {
        const kerb = new THREE.Mesh(
          buildRibbon(
            track,
            (s) => sign * (track.halfWidthAt(s) + 0.05),
            (s) => sign * (track.halfWidthAt(s) + 0.45),
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
      for (const [ds, latPad] of [
        [-46, 2.4],
        [0, 3.0],
        [46, 2.4],
      ]) {
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
      const figures: Array<[THREE.Group, number, number]> = [
        [kuwaitiFigure("dishdasha", "check"), -24, 3.2],
        [kuwaitiFigure("dishdasha", "white"), -20.5, 4.1],
        [kuwaitiFigure("dishdasha", "check"), 21, 3.4],
        [kuwaitiFigure("abaya", "white"), 24.5, 3.9],
      ];
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
  // Chevron boards and braking rubber go where the road actually turns.
  // The geometry is measured, not guessed: the sharpest sweep is the
  // Ras Al-Ard point at radius ≈178 m, with lesser curves at the Kuwait
  // Towers hairpin and the city return — so the threshold sits at
  // R < 260 m and everything gentler stays clean.
  {
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

    const chevrons = new THREE.Group();
    chevrons.name = "bend-chevrons";
    const postGeo = new THREE.CylinderGeometry(0.07, 0.09, 1.7, 6);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6 });
    const boardGeo = new THREE.PlaneGeometry(1.6, 0.62);
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
      for (let s = c.from; s <= c.to + 1; s += 26) {
        const g = new THREE.Group();
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.y = 0.85;
        g.add(post);
        const board = new THREE.Mesh(boardGeo, c.right ? boardMats.right : boardMats.left);
        board.position.y = 1.55;
        g.add(board);
        track.pose(s, outside * (track.halfWidthAt(s) + 1.9), p, tmp);
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
        new THREE.MeshStandardMaterial({
          map:
            s < COAST_END_M
              ? waymarkTexture(Math.round(s / 100) / 10, ROADS[0].arabic, ROADS[0].name)
              : waymarkTexture(
                  Math.round((s - COAST_END_M) / 100) / 10,
                  ROADS[1].arabic,
                  ROADS[1].name
                ),
          emissive: 0x444444,
        })
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
    setSky(mode: SkyMode) {
      // The old two-state switch, expressed in the language of the
      // clock: these are the hours those looks actually are.
      this.setTimeOfDay(mode === "dawn" ? 5.6 : 22.5);
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
      const day = THREE.MathUtils.clamp(sunAlt * 3.2, 0, 1);
      const night = THREE.MathUtils.clamp(-sunAlt * 3.2, 0, 1);
      const twilight = 1 - day - night;

      const mix3 = (n: number[], t: number[], d: number[]) =>
        new THREE.Color(
          n[0] * night + t[0] * twilight + d[0] * day,
          n[1] * night + t[1] * twilight + d[1] * day,
          n[2] * night + t[2] * twilight + d[2] * day
        );

      // Sky gradient: deep bay blue → sunrise ember → daylight blue
      if (skyMatRef) {
        const u = skyMatRef.uniforms;
        // The night zenith is four times what it was. At the old value it
        // arrived at the grade as 0.017 and the black point subtracted it
        // to exactly zero: two thirds of every sky pixel was 0/255, the
        // gradient existed only in the horizon band, and the stars sat on
        // a dead field. A city this size throws enough light back at its
        // own sky that the top of it is a deep navy, not a hole.
        // The day palette is deliberately left alone. Dimming it to a
        // quarter less DOES unblow the noon sky — measured 17.4% of it at
        // 250/255 or above, down to 10.6% — but it also inverts the
        // bottom of the exposure ladder at noon, where the margin was
        // only 5.8% to begin with: a stop down came out BRIGHTER than a
        // stop at zero. Half a fix is not worth an exposure control that
        // runs backwards, and what still clips is the sun's own corner of
        // the sky. Noted in the levels tool's output instead.
        (u.uTop.value as THREE.Color).copy(
          mix3([0.016, 0.028, 0.104], [0.030, 0.048, 0.105], [0.16, 0.34, 0.72])
        );
        (u.uHorizon.value as THREE.Color).copy(
          mix3([0.05, 0.066, 0.125], [0.42, 0.24, 0.16], [0.62, 0.74, 0.92])
        );
        (u.uGlow.value as THREE.Color).copy(
          mix3([0.085, 0.046, 0.01], [0.55, 0.21, 0.07], [0.36, 0.30, 0.16])
        );
        u.uGlowHeight.value = 0.16 * night + 0.34 * twilight + 0.22 * day;
      }

      // Fog is the floor the scene fades to, so it has to move with the
      // sky or the horizon tears away from the world in front of it.
      const fog = scene.fog as THREE.FogExp2;
      fog.color.copy(mix3([0.008, 0.012, 0.043], [0.098, 0.102, 0.172], [0.62, 0.71, 0.85]));
      fog.density = 0.0009 * night + 0.00075 * twilight + 0.00045 * day;

      // The key light. It is the moon at night and the sun by day, so it
      // travels: low and raking in the dark, high and white at noon.
      //
      // The height is an ANGLE now, blended across the same three
      // keyframes as everything else here, and the position is derived
      // from it — see KEY_ELEV_* for why the old |sin| curve put the key
      // at the same 56 degrees at midnight as at noon and cost the game
      // every shadow it thought it was casting.
      const elevDeg =
        KEY_ELEV_NIGHT * night + KEY_ELEV_TWILIGHT * twilight + KEY_ELEV_DAY * day;
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
        mix3([0.75, 0.82, 1.0], [1.0, 0.78, 0.55], [1.0, 0.96, 0.88])
      );
      const key = KEY_NIGHT * night + KEY_TWILIGHT * twilight + KEY_DAY * day;
      moonLight.intensity = key;

      // The fill answers the key from the other side, tracking it so the
      // ratio holds at every hour instead of only at midnight. It is
      // cooler than the key at every hour too: warm key, cool fill is
      // what keeps a night scene from going monochrome blue and a day
      // scene from going flat.
      fillLight.position.set(
        -moonLight.position.x * 0.62,
        Math.max(120, moonLight.position.y * 0.42),
        -moonLight.position.z * 0.62
      );
      fillLight.color.copy(
        mix3([0.42, 0.55, 0.82], [0.5, 0.6, 0.86], [0.62, 0.72, 0.95])
      );
      fillLight.intensity = key * FILL_RATIO;

      // Ambient is now the third tier, not the fill: with a real fill
      // doing the shadow-side lifting, the hemisphere only has to keep
      // the very darkest crevices off absolute black.
      if (hemiRef) {
        hemiRef.color.copy(mix3([0.17, 0.22, 0.33], [0.35, 0.42, 0.59], [0.55, 0.68, 0.92]));
        hemiRef.groundColor.copy(mix3([0.07, 0.055, 0.03], [0.17, 0.13, 0.09], [0.42, 0.36, 0.28]));
        // Night ambient up from 0.2. It is the only thing lighting the
        // asphalt away from a lamp and the shadow side of a facade, and
        // at 0.2 both of those sat on the floor. A city at night throws
        // a lot of light back at itself.
        hemiRef.intensity = 0.3 * night + 0.3 * twilight + 0.5 * day;
      }

      // Office windows: full after dark, fading through twilight, out by
      // day. They are the only thing giving a building any top end at
      // night, and the only thing that reads as a city rather than as a
      // row of dark slabs.
      for (const m of litFacades) m.emissiveIntensity = 1.15 * night + 0.45 * twilight;

      // Stars burn out as the sky lifts; nothing kills a sunrise faster
      // than a starfield still hanging in it.
      if (starsMatRef) starsMatRef.opacity = Math.pow(night, 0.7);

      // The visible body rides the same arc as the key light: the moon
      // while the sun is down, the sun itself once it is up.
      if (bodyDisc && bodyHalo && moonDiscMat && moonHaloMat) {
        const sunUp = sunAlt > -0.05;
        const r = 1150;
        const y = 120 + Math.max(0.05, Math.abs(sunAlt)) * 900;
        bodyDisc.position.set(Math.cos(az) * -r, y, Math.sin(az) * -r * (sunUp ? 1 : -1));
        bodyDisc.lookAt(0, y * 0.2, 0);
        bodyHalo.position.copy(bodyDisc.position);
        // A sun is small, fierce and white; a moon is soft and pale
        bodyDisc.scale.setScalar(sunUp ? 0.55 : 1);
        moonDiscMat.color.setRGB(
          1,
          0.95 * night + 0.88 * twilight + 0.97 * day,
          0.83 * night + 0.62 * twilight + 0.86 * day
        );
        moonDiscMat.opacity = 0.35 + 0.65 * Math.max(night, day);
        bodyHalo.scale.setScalar(520 * (1 + day * 0.5 + twilight * 0.35));
        moonHaloMat.opacity = 0.5 * night + 0.75 * twilight + 0.6 * day;
      }

      // Streetlights are on a photocell, not a clock: they come on as
      // the light goes, hold through the night, and drop out at dawn.
      lampLevel = THREE.MathUtils.clamp(1 - day * 1.25, 0, 1);
      if (lampPoolMat) lampPoolMat.opacity = 0.42 * lampLevel;
      if (glintMat) glintMat.visible = lampLevel > 0.05;
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
