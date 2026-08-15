import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Track, ROAD_HALF_WIDTH, COAST_U, DRIFT_PLAZA } from "./track";
import { applyTextureManifest } from "./assets";
import { upgradePalmCrowns } from "./models";
import { textTexture, arabicSign, latinDisplay } from "./text";
import {
  flagTexture,
  kuwaitiFigure,
  kuwaitiRacer,
  type ArmChain,
  type RacerLook,
} from "./characters";
import { aimConstrained, solveTwoBone } from "./ik";
import { RIG } from "./rig";
import { RIVALS } from "./rivals";

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

// Districts in lap order: down the coast, around the point, back inland.
export const AREAS = [
  { name: "Sharq", arabic: "شرق" },
  { name: "Bneid Al-Gar", arabic: "بنيد القار" },
  { name: "Salmiya", arabic: "السالمية" },
  { name: "Ras Al-Ard", arabic: "رأس الأرض" },
  { name: "Hawally", arabic: "حولي" },
  { name: "Kuwait City", arabic: "مدينة الكويت" },
];

export function areaAt(track: Track, s: number) {
  const u = track.wrap(s) / track.length;
  return AREAS[Math.min(AREAS.length - 1, Math.floor(u * AREAS.length))];
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
    // dark binder with lighter stones poking through
    const stone = Math.max(0, h - 0.52) * 2.1;
    const v = 22 + h * 26 + stone * 74;
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
    const w = 90 + Math.random() * 240;
    const hgt = 80 + Math.random() * 200;
    const x = Math.random() * (S - w);
    const y = Math.random() * (S - hgt);
    ctx.fillStyle = "rgba(14,15,19,0.7)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k <= 12; k++) ctx.lineTo(x + (w * k) / 12, y + (Math.random() - 0.5) * 9);
    for (let k = 0; k <= 12; k++) ctx.lineTo(x + w + (Math.random() - 0.5) * 9, y + (hgt * k) / 12);
    for (let k = 12; k >= 0; k--) ctx.lineTo(x + (w * k) / 12, y + hgt + (Math.random() - 0.5) * 9);
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
      a += (Math.random() - 0.5) * 0.6;
      cx += Math.cos(a) * (len / steps);
      cy += Math.sin(a) * (len / steps);
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    if (depth < 2 && Math.random() < 0.8) {
      crack(cx, cy, len * 0.55, a + (Math.random() < 0.5 ? 0.9 : -0.9), depth + 1);
    }
  };
  for (let i = 0; i < 10; i++) {
    crack(Math.random() * S, Math.random() * S, 110 + Math.random() * 240, Math.random() * 6.28, 0);
  }

  // Sealed tar seams
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = "rgba(6,6,8,0.8)";
    ctx.lineWidth = 4 + Math.random() * 4;
    ctx.beginPath();
    const y0 = Math.random() * S;
    ctx.moveTo(0, y0);
    for (let x = 0; x <= S; x += 48) ctx.lineTo(x, y0 + Math.sin(x * 0.02) * 6);
    ctx.stroke();
  }

  // Oil drips down the lane centres
  for (let i = 0; i < 20; i++) {
    const x = [0.25, 0.5, 0.75][i % 3] * S + (Math.random() - 0.5) * 60;
    const y = Math.random() * S;
    const r = 6 + Math.random() * 22;
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
    const a = 0.04 + Math.random() * 0.12;
    ctx.strokeStyle = `rgba(${140 + Math.random() * 60},${190 + Math.random() * 40},${
      215 + Math.random() * 40
    },${a})`;
    ctx.lineWidth = 0.8 + Math.random() * 1.4;
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 14, y + (Math.random() - 0.5) * 5, x + 22 + Math.random() * 22, y);
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
  g.addColorStop(0, "rgba(255,190,110,0.62)");
  g.addColorStop(0.5, "rgba(255,165,80,0.24)");
  g.addColorStop(1, "rgba(255,150,60,0)");
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
  along.addColorStop(0, "rgba(255,205,130,0.85)");
  along.addColorStop(0.35, "rgba(255,175,90,0.35)");
  along.addColorStop(1, "rgba(255,150,60,0)");
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

function glowTexture(r: number, g: number, b: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.85)`);
  grad.addColorStop(0.35, `rgba(${r},${g},${b},0.25)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function concreteTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#73767c";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const g = 96 + Math.random() * 50;
    ctx.fillStyle = `rgba(${g},${g + 2},${g + 6},${0.2 + Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  // Streaky weathering
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = `rgba(40,42,46,${0.05 + Math.random() * 0.1})`;
    const x = Math.random() * 256;
    ctx.fillRect(x, 0, 2 + Math.random() * 7, 256);
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
    const g = 70 + Math.random() * 40;
    ctx.fillStyle = `rgba(${g},${g - 6},${g - 14},0.35)`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
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
    const g = 90 + Math.random() * 70;
    ctx.fillStyle = `rgba(${g},${g - 14},${g - 38},${0.15 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 128, 1, 1);
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
      map: glowTexture(255, 255, 255),
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

function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0a0d13";
  ctx.fillRect(0, 0, 128, 256);
  // Per-floor life: dark floors, sleepy floors, the odd lit-up office
  for (let y = 6; y < 250; y += 10) {
    const floorVibe = Math.random();
    const litChance = floorVibe < 0.18 ? 0.85 : floorVibe < 0.5 ? 0.12 : 0.38;
    const warm = Math.random() < 0.7;
    for (let x = 5; x < 122; x += 9) {
      if (Math.random() < litChance) {
        ctx.fillStyle = warm || Math.random() < 0.6 ? "#ffd27f" : "#9ad1ff";
        ctx.globalAlpha = 0.45 + Math.random() * 0.55;
        ctx.fillRect(x, y, 6, 5);
        // Curtain-glow spill on bright windows
        if (Math.random() < 0.25) {
          ctx.globalAlpha = 0.12;
          ctx.fillRect(x - 1, y - 1, 8, 7);
        }
      }
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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
 *  over the road's Arabic name. */
function waymarkTexture(km: number): THREE.CanvasTexture {
  return textTexture(256, 320, (ctx) => {
    ctx.fillStyle = "#0a4da3";
    ctx.fillRect(0, 0, 256, 320);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, 236, 300);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    const ar = arabicSign();
    ctx.font = `700 30px ${ar}`;
    ctx.fillText("طريق الخليج العربي", 128, 62);
    ctx.font = `700 112px ${ar}`;
    ctx.fillText(arabicNumber(km), 128, 208);
    ctx.font = `700 44px ${ar}`;
    ctx.fillText("كم", 128, 278);
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

function kuwaitTowers(): THREE.Group {
  const g = new THREE.Group();
  const spireMat = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.5 });
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0x2e8f96,
    roughness: 0.35,
    metalness: 0.3,
    emissive: 0x0e4a50,
    emissiveIntensity: 0.7,
  });

  const main = new THREE.Group();
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 3.2, 113, 10), spireMat);
  spire.position.y = 56.5;
  main.add(spire);
  const bigBall = new THREE.Mesh(new THREE.SphereGeometry(11, 18, 14), ballMat);
  bigBall.position.y = 58;
  main.add(bigBall);
  const smallBall = new THREE.Mesh(new THREE.SphereGeometry(6.5, 16, 12), ballMat);
  smallBall.position.y = 88;
  main.add(smallBall);
  g.add(main);

  const second = new THREE.Group();
  const spire2 = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.6, 92, 10), spireMat);
  spire2.position.y = 46;
  second.add(spire2);
  const ball2 = new THREE.Mesh(new THREE.SphereGeometry(8.5, 16, 12), ballMat);
  ball2.position.y = 62;
  second.add(ball2);
  second.position.set(-34, 0, 14);
  g.add(second);

  const third = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 2.2, 76, 10), spireMat);
  third.position.set(-62, 38, 30);
  g.add(third);

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

function liberationTower(windows: THREE.CanvasTexture): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb9bfc7, roughness: 0.6 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7, 95, 12), mat);
  shaft.position.y = 47.5;
  g.add(shaft);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(12, 12, 7, 14),
    new THREE.MeshStandardMaterial({ map: windows, color: 0xffffff, roughness: 0.5 })
  );
  disc.position.y = 72;
  g.add(disc);
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.8, 38, 6), mat);
  antenna.position.y = 114;
  g.add(antenna);
  return g;
}

function alHamra(windows: THREE.CanvasTexture): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    map: windows,
    color: 0xdddddd,
    roughness: 0.4,
  });
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
function placeBeside(track: Track, obj: THREE.Object3D, s: number, offset: number) {
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();
  track.pointAt(s, p);
  track.sideAt(s, side);
  obj.position.set(p.x + side.x * offset, 0, p.z + side.z * offset);
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

// Hawally tunnel on the inland leg — TXR-style underpass
const TUNNEL_U = { from: 0.615, to: 0.655 };

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
  // Handles for the night-shimmer tick (assigned in the streetlight block)
  let glintMat: THREE.PointsMaterial | null = null;
  let shimmerLampMat: THREE.MeshStandardMaterial | null = null;
  // Handles the time-of-day switch repaints
  let skyMatRef: THREE.ShaderMaterial | null = null;
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
  const moonLight = new THREE.DirectionalLight(0xbfd0ff, 0.8);
  moonLight.position.set(-300, 500, 200);
  scene.add(moonLight);

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
      map: glowTexture(225, 220, 195),
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
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI * 0.45 + 0.08;
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
  scene.add(road);

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
  scene.add(new THREE.Mesh(
    buildRibbon(track, (s) => -(track.halfWidthAt(s) - 0.35), (s) => -(track.halfWidthAt(s) - 0.15), 0.03, 4),
    lineMat
  ));
  scene.add(new THREE.Mesh(
    buildRibbon(track, (s) => track.halfWidthAt(s) - 0.35, (s) => track.halfWidthAt(s) - 0.15, 0.03, 4),
    lineMat
  ));

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
    scene.add(dashes);
  }

  // Guardrails
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x9aa2ab,
    roughness: 0.4,
    metalness: 0.7,
    side: THREE.DoubleSide,
  });
  scene.add(new THREE.Mesh(buildWall(track, (s) => -(track.halfWidthAt(s) + 0.6), 0.3, 0.95), railMat));
  scene.add(new THREE.Mesh(buildWall(track, (s) => track.halfWidthAt(s) + 0.6, 0.3, 0.95), railMat));

  // Streetlights: poles + sodium lamps, alternating sides
  {
    const spacing = 42;
    const count = Math.floor(L / spacing);
    const poleGeo = new THREE.CylinderGeometry(0.14, 0.2, 8.4, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.7 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, count);
    // Cobra arm reaching from the pole top out over the carriageway —
    // real street lamps hang their heads over the road, not the kerb
    const armGeo = new THREE.CylinderGeometry(0.055, 0.075, 3.0, 6);
    armGeo.rotateZ(Math.PI / 2); // along X, oriented per instance
    const arms = new THREE.InstancedMesh(armGeo, poleMat, count);
    const headGeo = new THREE.BoxGeometry(0.55, 0.12, 0.3);
    const heads = new THREE.InstancedMesh(headGeo, poleMat, count);
    const lampGeo = new THREE.SphereGeometry(0.34, 8, 6);
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xffc873,
      emissive: 0xffaa40,
      emissiveIntensity: 3.2,
      fog: false,
    });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, count);
    // Warm pool of lamplight thrown onto the asphalt below each lamp
    const poolGeo = new THREE.CircleGeometry(8.5, 20);
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
      if (u > TUNNEL_U.from - 0.004 && u < TUNNEL_U.to + 0.004) {
        // No street poles inside the tunnel
        poles.setMatrixAt(i, hidden);
        arms.setMatrixAt(i, hidden);
        heads.setMatrixAt(i, hidden);
        lamps.setMatrixAt(i, hidden);
        pools.setMatrixAt(i, hidden);
        continue;
      }
      const sideSign = i % 2 === 0 ? 1 : -1;
      track.pose(s, sideSign * (ROAD_HALF_WIDTH + 1.6), p, tmp);
      m.makeTranslation(p.x, 4.2, p.z);
      poles.setMatrixAt(i, m);

      // Head hangs over the road edge; the arm bridges pole top → head
      track.pose(s, sideSign * (ROAD_HALF_WIDTH - 1.2), p, tmp);
      const hx = p.x;
      const hz = p.z;
      track.tangentAt(s, tanV);
      tanV.y = 0;
      tanV.normalize();
      // Unit vector for +lat is (-Tz, 0, Tx); the arm points inward
      sideV.set(tanV.z * sideSign, 0, -tanV.x * sideSign).normalize();
      armQ.setFromUnitVectors(xAxis, sideV);
      track.pose(s, sideSign * (ROAD_HALF_WIDTH + 0.4), p, tmp);
      armMid.set((p.x + hx) / 2, 8.42, (p.z + hz) / 2);
      m.compose(armMid, armQ, unitV);
      arms.setMatrixAt(i, m);
      armMid.set(hx, 8.45, hz);
      m.compose(armMid, armQ, unitV);
      heads.setMatrixAt(i, m);
      m.makeTranslation(hx, 8.32, hz);
      lamps.setMatrixAt(i, m);
      lampPositions.push(new THREE.Vector3(hx, 8.32, hz));

      // The pool lands under the head and spills toward the road centre
      // (the head's optic faces down-and-in, not straight down)
      track.pose(s, sideSign * (ROAD_HALF_WIDTH - 2.4), p, tmp);
      m.makeTranslation(p.x, 0.045, p.z);
      pools.setMatrixAt(i, m);
    }
    arms.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
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
    scene.add(poles, arms, heads, lamps, pools, streaks);
    // Sodium coronas around every lamp head
    scene.add(coronaPoints(lampPositions, 0xffb15c, 5.5));
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
        color: 0xffd9a0,
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
  const windows = windowTexture();
  {
    const count = 340; // more blocks now that they are visible much further
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ map: windows, color: 0xffffff, roughness: 0.8 });
    const blocks = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const tint = new THREE.Color();
    // Facade variety: concrete grey to warm beige to blue glass
    const palette = [0x8a8f99, 0x9c937e, 0x7c828e, 0x6e7686, 0xa39a85];
    for (let i = 0; i < count; i++) {
      const s = Math.random() * L;
      const u = track.wrap(s) / L;
      // Never on the sea side of the corniche; both sides inland.
      const onCoast = u >= COAST_U.from && u <= COAST_U.to;
      const sideSign = onCoast ? 1 : Math.random() < 0.5 ? 1 : -1;
      const dist = 32 + Math.random() * 230; // deeper skyline for the longer view
      track.pose(s, sideSign * dist, p, tmp);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
      // Taller skyline near the city at the top of the lap
      const cityBoost = u > 0.88 || u < 0.06 ? 2.1 : 1;
      const h = (10 + Math.random() * Math.random() * 55) * cityBoost;
      scale.set(12 + Math.random() * 20, h, 12 + Math.random() * 20);
      m.compose(p, q, scale);
      blocks.setMatrixAt(i, m);
      tint.setHex(palette[i % palette.length]).multiplyScalar(0.85 + Math.random() * 0.3);
      blocks.setColorAt(i, tint);
    }
    blocks.instanceMatrix.needsUpdate = true;
    if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
    blocks.castShadow = true;
    blocks.receiveShadow = true;
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
          ? ROAD_HALF_WIDTH + 3 + Math.random() * 4
          : -(ROAD_HALF_WIDTH + 2.6);
      track.pose(s + Math.random() * 6, lateral, p, tmp);
      m.makeTranslation(p.x, 0, p.z);
      trunks.setMatrixAt(i, m);
      // Random spin per crown so the frond pattern doesn't repeat
      m.makeRotationY(Math.random() * Math.PI * 2).setPosition(p.x, 0, p.z);
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
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0xfff1cf,
      emissive: 0xffd9a0,
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
    scene.add(coronaPoints(stripPositions, 0xffdba6, 2.6));
  }

  // Illuminated billboards — the TXR night-expressway signature,
  // with distinctly Kuwaiti advertisers
  {
    const ads: Array<[string, string, string, string, string, number, number]> = [
      // line1, line2, bg, fg, accent, u, side offset
      ["وين؟ WAIN", "wain nrooh? — يلا", "#0f4f4a", "#eafff9", "#2e978e", 0.035, 24],
      ["بو مجبوس", "BU MACHBOOS · best machboos on the Gulf", "#7a2d08", "#ffe9d4", "#e8641b", 0.09, 26],
      ["SAQER ⚡ صقر", "ENERGY — hunt the night", "#1a0a0a", "#ffd2c2", "#c1121f", 0.155, 24],
      ["AL-DABOOS", "كراج الدبوس · TUNING & DYNO", "#1c1c10", "#ffe9a3", "#f5c211", 0.225, 26],
      ["بنك الديرة", "BANK AL-DEERA · drive now, pay later", "#0a2a52", "#dcebff", "#3b82d4", 0.3, 25],
      ["ليالي السالمية", "SALMIYA NIGHTS — open till fajer", "#2a0a3a", "#f3dcff", "#b84dd6", 0.36, 24],
      ["قهوة GAHWA", "first cup free for racers ☕", "#3a2510", "#ffeeda", "#c98a3d", 0.43, 22],
      ["دروازة مول", "DARWAZA MALL · 200 shops", "#0d3a1e", "#dcffe9", "#16a34a", 0.56, 28],
      ["GULF ROAD", "NIGHTS · ليالي شارع الخليج 🏁", "#101728", "#dceaff", "#38e8ff", 0.7, 26],
      ["حولي موترز", "HAWALLY MOTORS · JDM imports", "#252525", "#f2f2f2", "#888888", 0.78, 25],
    ];
    for (const [l1, l2, bg, fg, accent, u, off] of ads) {
      const sideSign = u < 0.46 ? 1 : Math.random() < 0.5 ? 1 : -1; // never in the sea
      scene.add(billboard(track, u * L, sideSign * off, adTexture(l1, l2, bg, fg, accent)));
    }
  }

  // Landmarks, in real Gulf Road order heading south down the coast
  const towers = kuwaitTowers();
  placeBeside(track, towers, L * 0.016, -52); // Ras Ajouza promontory, ahead of the spawn
  const towersBeacon = makeBeacon(beacons);
  towersBeacon.position.y = 114;
  towers.add(towersBeacon);
  scene.add(towers);
  const towersPad = new THREE.Mesh(
    new THREE.CylinderGeometry(70, 75, 0.8, 20),
    new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 1 })
  );
  towersPad.position.copy(towers.position).setY(0.1);
  scene.add(towersPad);

  const grandMosque = mosque();
  placeBeside(track, grandMosque, L * 0.02, 55); // opposite Souq Sharq
  grandMosque.rotation.y = Math.PI / 5;
  scene.add(grandMosque);

  const island = greenIsland();
  placeBeside(track, island, L * 0.1, -200); // Green Island, out in the water
  scene.add(island);

  const marina = marinaBoats();
  placeBeside(track, marina, L * 0.27, -38); // Salmiya marina bay
  scene.add(marina);

  const sciCenter = scientificCenter();
  placeBeside(track, sciCenter, L * 0.385, -48); // the sail on the waterfront
  scene.add(sciCenter);

  const rasLight = lighthouse();
  placeBeside(track, rasLight, L * 0.465, -28); // Ras Al-Ard point
  scene.add(rasLight);

  const wt = waterTowers(stripeTexture("#7ec8e3", "#ffffff"));
  placeBeside(track, wt, L * 0.62, 65); // inland leg, Hawally side
  scene.add(wt);

  const m2 = mosque();
  placeBeside(track, m2, L * 0.75, -60);
  m2.rotation.y = Math.PI / 3;
  scene.add(m2);

  const lib = liberationTower(windows);
  placeBeside(track, lib, L * 0.9, 130); // city centre, inland of the top curve
  const libBeacon = makeBeacon(beacons);
  libBeacon.position.y = 134;
  lib.add(libBeacon);
  scene.add(lib);

  const hamra = alHamra(windows);
  placeBeside(track, hamra, L * 0.96, 80); // Sharq skyline by the start
  const hamraBeacon = makeBeacon(beacons);
  hamraBeacon.position.y = 60; // local to the 118 m box, centred at 59
  hamra.add(hamraBeacon);
  scene.add(hamra);

  // Kuwait flag at the start line
  {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 14, 6),
      new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.4, metalness: 0.6 })
    );
    pole.position.y = 7;
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 3),
      new THREE.MeshStandardMaterial({
        map: flagTexture(),
        side: THREE.DoubleSide,
        emissive: 0x444444,
      })
    );
    flag.position.set(3.1, 12.2, 0);
    const g = new THREE.Group();
    g.add(pole, flag);
    placeBeside(track, g, 0, -(ROAD_HALF_WIDTH + 4));
    scene.add(g);
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

  // Area gantry signs at each district boundary
  AREAS.forEach((area, i) => {
    const s = (i / AREAS.length) * L;
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

  // ------------------------------------------------- the Sharq drift circle
  // The corniche swells into a round plaza (the physics follows
  // track.halfWidthAt), with a kerbed island to slide around, a painted
  // drift ring, and Arabic wayfinding leading in.
  {
    const sPlaza = DRIFT_PLAZA.u * L;
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
            DRIFT_PLAZA.u - uSpan,
            DRIFT_PLAZA.u + uSpan
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
    const COUNT = 12;
    for (let i = 1; i <= COUNT; i++) {
      const s = (i / COUNT) * L;
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
          map: waymarkTexture(Math.round((s / L) * 7.3 * 10) / 10),
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
        (u.uTop.value as THREE.Color).copy(
          mix3([0.004, 0.007, 0.026], [0.030, 0.048, 0.105], [0.16, 0.34, 0.72])
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
      // travels: low and warm at the horizon, high and white at noon.
      const elev = Math.max(0.08, Math.abs(sunAlt));
      moonLight.position.set(
        Math.cos(az) * 520,
        160 + elev * 620,
        Math.sin(az) * 520 * (sunAlt >= 0 ? 1 : -1)
      );
      moonLight.color.copy(
        mix3([0.75, 0.82, 1.0], [1.0, 0.78, 0.55], [1.0, 0.96, 0.88])
      );
      moonLight.intensity = 0.8 * night + 1.05 * twilight + 2.35 * day;

      if (hemiRef) {
        hemiRef.color.copy(mix3([0.17, 0.22, 0.33], [0.35, 0.42, 0.59], [0.55, 0.68, 0.92]));
        hemiRef.groundColor.copy(mix3([0.07, 0.055, 0.03], [0.17, 0.13, 0.09], [0.42, 0.36, 0.28]));
        hemiRef.intensity = 0.36 * night + 0.52 * twilight + 0.85 * day;
      }

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
      // Sodium lamps hum: a barely-there shimmer on every head + glint —
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
