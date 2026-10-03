// The date palms are date palms, and they stand where nothing else does.
//
//   npm run test:palms          (no browser, no dev server)
//
// The corniche crowns read as dracaena, yucca or agave: 26 opaque green
// straps in a flat disc (aspect 0.31), sky through two-thirds of the head
// (coverage 0.34 inside the hull in the lock still), emerald where a date
// palm is grey-green (HSV saturation 0.52-0.81 in every still), a spear
// standing 0.63 m clear of every frond, a chocolate tapered pole for a
// trunk — and about one palm in nine had a lamp column, a signal arm, a
// gantry or the flag mast through its crown, with three more standing on
// the Sharq plaza's asphalt. Nothing asserted any of it: tests/assets.mjs
// only checked that the crown was "authored".
//
// This builds exactly what the game draws — src/game/palm.ts's crowns,
// atlas, shader patch, trunk, bark and placement, against the real Track
// and world.ts's own fixture list — and measures it. It holds the BUILT
// data, never a re-typed copy of the spec.
//
//   1. crown shape        5. trunk and bark
//   2. colour             6. placement (50 streams) and the shared draw count
//   3. leaflet atlas      7. the manifest: no palm.glb
//   4. leaf shader
//
// Each line prints what it measured; the run exits 1 on any failure.

import * as THREE from "three";
import { MARKINGS } from "../src/game/markings.ts";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildPalmCrown,
  leafletAtlas,
  patchPalmLeafFragment,
  palmTrunkGeometry,
  barkMaps,
  placePalms,
  palmSlots,
  srgb8ToLinear,
  PALM,
  PALM_KINDS,
  PALM_LEAF,
  PALM_PLACE,
  TRUNK_REF_H,
  TRUNK_BOOT,
  BARK_LIP_UV,
  LEAF_ATLAS,
} from "../src/game/palm.ts";
import { palmFixtures, LAMP_COLUMNS, SIGNALS } from "../src/game/world.ts";
import { Track, COAST_U } from "../src/game/track.ts";
import { makeRng, WORLD_SEED } from "../src/game/rand.ts";
import { newPlantField, solvePlantField } from "../src/game/plants.ts";
import { RIG } from "../src/game/rig.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const f2 = (x) => x.toFixed(2);
const f3 = (x) => x.toFixed(3);

/** Linear rgb to the sRGB-encoded HSV a still is measured in. */
const toSrgb = (x) => {
  const c = Math.max(0, Math.min(1, x));
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
};
const hsv = (lin) => {
  const [r, g, b] = lin.map(toSrgb);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: mx > 0 ? d / mx : 0, v: mx };
};
const lumY = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const crowns = Object.fromEntries(PALM_KINDS.map((k) => [k, buildPalmCrown(k)]));

/** Every vertex of a crown, with which frond it is on (or -1 for the
 *  spear) and its card coordinates. */
const vertsOf = (geo) => {
  const info = geo.userData.palm;
  const pos = geo.getAttribute("position"), nor = geo.getAttribute("normal");
  const uv = geo.getAttribute("uv"), col = geo.getAttribute("color"), w = geo.getAttribute("grnWeight");
  const out = [];
  for (let i = 0; i < pos.count; i++) {
    const frond = i < info.spearStart ? Math.floor(i / info.perFrond) : -1;
    out.push({
      i, frond,
      q: frond >= 0 && info.fronds > 1 ? frond / (info.fronds - 1) : 0,
      p: new THREE.Vector3().fromBufferAttribute(pos, i),
      n: new THREE.Vector3().fromBufferAttribute(nor, i),
      u: uv.getX(i), t: uv.getY(i),
      c: [col.getX(i), col.getY(i), col.getZ(i)],
      w: w.getX(i),
    });
  }
  return out;
};

// --- 1. Crown shape, per kind ----------------------------------------
console.log("1. crown shape");
for (const kind of PALM_KINDS) {
  const geo = crowns[kind];
  const info = geo.userData.palm;
  const V = vertsOf(geo);
  const tris = geo.index ? geo.index.count / 3 : 0;
  const uvOk = V.every((v) => v.u >= 0 && v.u <= 1 && v.t >= 0 && v.t <= 1);
  let unit = true, dotSum = 0;
  const centre = new THREE.Vector3(0, PALM.normalCentreY, 0);
  for (const v of V) {
    if (Math.abs(v.n.length() - 1) > 1e-4) unit = false;
    dotSum += v.n.dot(v.p.clone().sub(centre).normalize());
  }
  const meanDot = dotSum / V.length;
  // Extent, from the vertices.
  let reach = 0, top = -Infinity, bottom = Infinity, spearTop = -Infinity, youngTop = -Infinity;
  for (const v of V) {
    reach = Math.max(reach, Math.hypot(v.p.x, v.p.z));
    top = Math.max(top, v.p.y);
    bottom = Math.min(bottom, v.p.y);
    if (v.frond < 0) spearTop = Math.max(spearTop, v.p.y);
    if (v.frond === 0) youngTop = Math.max(youngTop, v.p.y);
  }
  const span = 2 * reach, aspect = (top - bottom) / span;
  const minFronds = { kept: 60, full: 68, young: 48 }[kind];
  console.log(`  ${kind.padEnd(5)}  ${info.fronds} fronds, ${tris} tris, ${V.length} verts; span ${f2(span)} m, y ${f2(bottom)}..${f2(top)}, aspect ${f3(aspect)}; spear top ${f2(spearTop)} vs youngest frond ${f2(youngTop)}; mean normal.radial ${f3(meanDot)}`);
  check(info.fronds >= minFronds, `${kind}: ${info.fronds} fronds, want >= ${minFronds}`);
  check(!!geo.index, `${kind}: geometry is not indexed`);
  check(tris <= 3000, `${kind}: ${tris} triangles, want <= 3000`);
  check(uvOk, `${kind}: uv outside [0,1]`);
  check(unit, `${kind}: a normal is not unit length`);
  check(meanDot >= 0.4, `${kind}: mean normal . radial ${f3(meanDot)}, want >= 0.4 (the head should shade as a volume)`);
  if (kind === "young") check(aspect >= 0.4, `young: aspect ${f3(aspect)}, want >= 0.40`);
  else {
    check(span >= 7.0 && span <= 8.6, `${kind}: span ${f2(span)} m, want 7.0-8.6 (a date palm's crown is 6-10 m)`);
    check(aspect >= 0.5 && aspect <= 0.8, `${kind}: aspect ${f3(aspect)}, want 0.50-0.80 (the old disc was 0.31)`);
  }
  check(spearTop <= youngTop - 0.8, `${kind}: spear top ${f2(spearTop)} not 0.8 m under the youngest frond's ${f2(youngTop)} — the horn`);

  // Per frond: half-width row by row (rachis vertex to edge vertex), the
  // petiole, the leaflet envelope, the tip, the bend weight.
  let petioleMax = 0, peak = 0, peakT = 0, tipMax = 0, wOk = true, w0 = 0, w1 = 1;
  for (let f = 0; f < info.fronds; f++) {
    for (let half = 0; half < 2; half++) {
      const base = f * info.perFrond + half * info.rows * 2;
      let prevW = -1;
      for (let r = 0; r < info.rows; r++) {
        const a = V[base + r * 2], b = V[base + r * 2 + 1];
        if (a.u !== 0 || b.u !== 1 || a.t !== b.t) { wOk = false; continue; }
        const hw = a.p.distanceTo(b.p);
        if (a.t < info.petiole) petioleMax = Math.max(petioleMax, hw);
        if (f === Math.floor(info.fronds / 2) && hw > peak) { peak = hw; peakT = a.t; }
        if (a.t === 1) tipMax = Math.max(tipMax, hw);
        if (a.w < prevW - 1e-9 || b.w !== a.w) wOk = false;
        prevW = a.w;
        if (a.t === 0) w0 = Math.max(w0, a.w);
        if (a.t === 1) w1 = Math.min(w1, a.w);
      }
    }
  }
  console.log(`         petiole ${info.petiole} of the frond, half-width there <= ${f3(petioleMax)} m; leaflets peak ${f3(peak)} m at t ${f2(peakT)}; tip ${f3(tipMax)} m; bend weight ${f2(w0)} at the heart, ${f2(w1)} at the tip`);
  check(info.petiole >= 0.15 && info.petiole <= 0.22, `${kind}: petiole fraction ${info.petiole}, want 0.15-0.22`);
  check(petioleMax <= 0.08, `${kind}: the petiole is ${f3(petioleMax)} m half-wide — leaflets at the heart`);
  check(peak >= 0.32 && peak <= 0.45 && peakT >= 0.4 && peakT <= 0.6, `${kind}: leaflet half-span peaks ${f3(peak)} m at t ${f2(peakT)}, want 0.32-0.45 at 0.40-0.60`);
  check(tipMax <= 0.02, `${kind}: tip half-width ${f3(tipMax)} m — a blunt strap end, want <= 0.02`);
  check(wOk && w0 === 0 && w1 >= 0.95, `${kind}: bend weight must run 0 at the heart to >= 0.95 at the tip, non-decreasing (got ${f2(w0)}..${f2(w1)}${wOk ? "" : ", out of order"})`);
}

// --- 2. Colour ---------------------------------------------------------
console.log("2. colour");
const atlas = leafletAtlas();
{
  // The tint the placement actually produces, over 50 streams.
  const track = new Track();
  const L = track.length;
  const tints = [];
  for (let seed = 1; seed <= 50; seed++) {
    const pl = placePalms(track, makeRng(seed), makeRng(seed + 1000), makeRng(seed + 2000), [], { from: 0, len: (COAST_U.to - COAST_U.from) * L });
    for (const p of pl) tints.push(p.tint);
  }
  const meanTint = [0, 1, 2].map((c) => tints.reduce((a, t) => a + t[c], 0) / tints.length);
  let lo = Infinity, hi = -Infinity, rb = 0;
  for (const t of tints) {
    lo = Math.min(lo, ...t);
    hi = Math.max(hi, ...t);
    rb = Math.max(rb, Math.abs(t[0] / t[2] - 1));
  }
  console.log(`  tint over ${tints.length} palms: channels ${f3(lo)}..${f3(hi)}, |R/B - 1| <= ${f3(rb)}, mean (${meanTint.map(f3).join(", ")})`);
  check(lo >= 0.84 && hi <= 1.17, `tint channel ${f3(lo)}..${f3(hi)}, want 0.84-1.17 (the old tint multiplied G by 1.31)`);
  check(rb <= 0.12, `tint |R/B - 1| ${f3(rb)}, want <= 0.12`);

  // Effective linear albedo: vertex colour x the atlas's mean grey over
  // its opaque texels x the mean tint.
  const eff = (c) => c.map((x, k) => x * atlas.meanOpaque * meanTint[k]);
  let mature = { n: 0, s: 0, h: 0, Y: 0, sMax: 0, hMin: 360, hMax: 0, yMin: 1, yMax: 0 };
  let tips = { n: 0, hMin: 360, hMax: 0 };
  let gr = 0, gb = 0;
  for (const kind of PALM_KINDS) {
    const info = crowns[kind].userData.palm;
    const deadFrom = info.fronds - PALM.kinds[kind].dead;
    for (const v of vertsOf(crowns[kind])) {
      const e = eff(v.c);
      gr = Math.max(gr, v.c[1] / v.c[0]);
      gb = Math.max(gb, v.c[1] / v.c[2]);
      if (v.frond < 0) continue;
      const c = hsv(e);
      if (v.q >= 0.2 && v.q <= 0.6 && v.t >= 0.3 && v.t <= 0.7 && v.u === 1) {
        const Y = lumY(e);
        mature.n++; mature.s += c.s; mature.h += c.h; mature.Y += Y;
        mature.sMax = Math.max(mature.sMax, c.s);
        mature.hMin = Math.min(mature.hMin, c.h); mature.hMax = Math.max(mature.hMax, c.h);
        mature.yMin = Math.min(mature.yMin, Y); mature.yMax = Math.max(mature.yMax, Y);
      }
      if (v.q > 0.7 && v.t > 0.9 && v.frond < deadFrom) {
        tips.n++;
        tips.hMin = Math.min(tips.hMin, c.h); tips.hMax = Math.max(tips.hMax, c.h);
      }
    }
  }
  const m = { s: mature.s / mature.n, h: mature.h / mature.n, Y: mature.Y / mature.n };
  const ex = hsv(eff(PALM_LEAF.mature));
  console.log(`  atlas mean grey over opaque texels ${f3(atlas.meanOpaque)}; mature albedo sRGB (${eff(PALM_LEAF.mature).map((x) => Math.round(255 * toSrgb(x))).join(",")}) h${ex.h.toFixed(0)} s${f2(ex.s)}`);
  console.log(`  mature mid-frond (${mature.n} verts): s ${f2(m.s)} (max ${f2(mature.sMax)}), hue ${mature.hMin.toFixed(0)}-${mature.hMax.toFixed(0)}, Y ${f3(mature.yMin)}..${f3(mature.yMax)} — was s 0.65, hue 109, Y 0.150`);
  console.log(`  old-frond tips (${tips.n} verts): hue ${tips.hMin.toFixed(0)}-${tips.hMax.toFixed(0)} — the old "straw" tips were hue 99-104`);
  console.log(`  emerald guard: G/R <= ${f2(gr)}, G/B <= ${f2(gb)}`);
  check(mature.n > 100, `only ${mature.n} mature mid-frond vertices to measure`);
  check(mature.sMax <= 0.32, `mature mid-frond saturation up to ${f2(mature.sMax)}, want <= 0.32`);
  check(mature.hMin >= 70 && mature.hMax <= 100, `mature mid-frond hue ${mature.hMin.toFixed(0)}-${mature.hMax.toFixed(0)}, want 70-100`);
  check(mature.yMin >= 0.07 && mature.yMax <= 0.12, `mature mid-frond Y ${f3(mature.yMin)}..${f3(mature.yMax)}, want 0.07-0.12`);
  check(tips.n > 50 && tips.hMin >= 35 && tips.hMax <= 65, `old-frond tips hue ${tips.hMin.toFixed(0)}-${tips.hMax.toFixed(0)} over ${tips.n} verts, want 35-65 (straw)`);
  check(gr <= 1.5 && gb <= 2.2, `emerald: G/R ${f2(gr)} (<= 1.5), G/B ${f2(gb)} (<= 2.2)`);
}

// --- 3. The leaflet atlas -------------------------------------------------
console.log("3. leaflet atlas");
{
  const a = atlas;
  const chain = a.mips.map((m) => `${m.width}x${m.height}`).join(" ");
  const last = a.mips[a.mips.length - 1];
  console.log(`  ${a.width}x${a.height}, ${a.mips.length} levels: ${chain}`);
  console.log(`  leaflet-zone coverage (alpha >= 0.5) per level: ${a.coverage.slice(0, 6).map(f3).join(" ")}; unscaled box mips would be ${a.rawCoverage.slice(0, 6).map(f3).join(" ")}`);
  console.log(`  petiole zone ${f3(a.petioleCoverage)}`);
  check(a.width === 128 && a.height === 512, `atlas ${a.width}x${a.height}, want 128x512`);
  check(last.width === 1 && last.height === 1 && a.mips.length === 10, `mip chain ends at ${last.width}x${last.height} after ${a.mips.length} levels`);
  check(a.mips.every((m) => m.data.length === m.width * m.height * 4), "a mip level's data is the wrong size");
  check(a.coverage[0] >= 0.45 && a.coverage[0] <= 0.62, `mip 0 leaflet coverage ${f3(a.coverage[0])}, want 0.45-0.62`);
  check(a.petioleCoverage <= 0.15, `petiole coverage ${f3(a.petioleCoverage)}, want <= 0.15 — the petiole is bare`);
  for (let l = 1; l <= 5; l++) {
    check(Math.abs(a.coverage[l] - a.coverage[0]) <= 0.04,
      `mip ${l} coverage ${f3(a.coverage[l])} drifts from mip 0's ${f3(a.coverage[0])} — a distant crown goes solid`);
  }
  // The stored alpha is what the GPU sees: re-measure level 3 from bytes.
  const m3 = a.mips[3];
  let n = 0, hit = 0;
  for (let y = 0; y < m3.height; y++) {
    if ((y + 0.5) / m3.height < PALM.frond.petiole) continue;
    for (let x = 0; x < m3.width; x++) { n++; if (m3.data[(y * m3.width + x) * 4 + 3] >= 128) hit++; }
  }
  check(Math.abs(hit / n - a.coverage[0]) <= 0.05, `mip 3 bytes give coverage ${f3(hit / n)}, the chain says ${f3(a.coverage[3])}`);
  check(LEAF_ATLAS.leaflets >= 60, `${LEAF_ATLAS.leaflets} leaflets per side`);
}

// --- 4. The leaf shader ---------------------------------------------------
console.log("4. leaf shader");
{
  const fs = THREE.ShaderLib.standard.fragmentShader;
  let patched = "";
  let threw = null;
  try { patched = patchPalmLeafFragment(fs); } catch (e) { threw = e.message; }
  check(!threw, `patchPalmLeafFragment threw on three's own shader: ${threw}`);
  const flipGone = !patched.includes("normal *= faceDirection;");
  const tbnKept = patched.includes("tbn[0] *= faceDirection;");
  const trans = patched.includes("GRN_LEAF_TRANS");
  let missing = null, missingLights = null;
  try { patchPalmLeafFragment(fs.replace("#include <normal_fragment_begin>", "")); } catch (e) { missing = e.message; }
  try { patchPalmLeafFragment(fs.replace("#include <lights_physical_pars_fragment>", "")); } catch (e) { missingLights = e.message; }
  console.log(`  three r${THREE.REVISION}: back-face flip removed ${flipGone}, tangent flip kept ${tbnKept}, transmission term ${trans}; a shader without its anchors throws: ${!!missing && !!missingLights}`);
  check(flipGone, "the patched shader still flips the normal on back faces — the tube shading");
  check(tbnKept, "the tangent frame's own flip went with it");
  check(trans, "no GRN_LEAF_TRANS transmission term");
  check(!!missing && !!missingLights, "a shader missing an anchor must throw, not pass through unpatched");

  const world = readFileSync("src/game/world.ts", "utf8");
  const fn = world.match(/function palmLeafMaterial\(\)[\s\S]*?\n}\n/);
  const body = fn ? fn[0] : "";
  const want = {
    "alphaTest 0.5": /alphaTest:\s*0\.5\b/,
    "alphaToCoverage": /alphaToCoverage:\s*true/,
    "DoubleSide": /side:\s*THREE\.DoubleSide/,
    "white base colour": /color:\s*0xffffff/,
    "own program key": /customProgramCacheKey\s*=\s*\(\)\s*=>\s*"grn-palm-leaf"/,
    "fragment patch": /patchPalmLeafFragment\(/,
    "plant bend": /plantBend\(mat\)/,
  };
  const got = Object.entries(want).map(([k, re]) => [k, re.test(body)]);
  console.log(`  world.ts palmLeafMaterial: ${got.map(([k, v]) => `${k} ${v ? "yes" : "NO"}`).join(", ")}`);
  for (const [k, v] of got) check(v, `palmLeafMaterial: ${k} missing`);
}

// --- 5. Trunk and bark ----------------------------------------------------
console.log("5. trunk and bark");
{
  const geo = palmTrunkGeometry();
  const T = geo.userData.trunk;
  const pos = geo.getAttribute("position");
  const tris = geo.index.count / 3;
  // Ring radii, from the shaft vertices (13 per ring).
  const rings = new Map();
  for (let i = 0; i < T.bootStart; i++) {
    const y = +pos.getY(i).toFixed(5);
    rings.set(y, Math.max(rings.get(y) ?? 0, Math.hypot(pos.getX(i), pos.getZ(i))));
  }
  const ys = [...rings.keys()].sort((a, b) => a - b);
  const rAt = (y) => {
    for (let k = 1; k < ys.length; k++) {
      if (ys[k] >= y) {
        const t = (y - ys[k - 1]) / (ys[k] - ys[k - 1]);
        return rings.get(ys[k - 1]) + (rings.get(ys[k]) - rings.get(ys[k - 1])) * t;
      }
    }
    return rings.get(ys[ys.length - 1]);
  };
  const H = TRUNK_REF_H;
  const top = rAt(H), r06 = rAt(0.6), foot = rAt(0), mid = rAt(H / 2);
  // Boot wedges: 20 vertices each, after the shaft.
  const per = 20;
  const wedges = (pos.count - T.bootStart) / per;
  let bootLo = Infinity, bootHi = -Infinity, wedgesIn = 0;
  for (let w = 0; w < wedges; w++) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < per; k++) { const y = pos.getY(T.bootStart + w * per + k); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    bootLo = Math.min(bootLo, lo); bootHi = Math.max(bootHi, hi);
    if (lo >= H - 0.9 && hi <= H + 0.1) wedgesIn++;
  }
  console.log(`  radius top ${f3(top)}, at 0.6 m ${f3(r06)} (ratio ${f2(top / r06)}), mid ${f3(mid)}, foot ${f3(foot)} (flare ${f2(foot / mid)}x); ${tris} tris; ${wedges} boot wedges at y ${f2(bootLo - H)}..${f2(bootHi - H)} from the top`);
  check(top / r06 >= 0.85, `trunk top/0.6 m radius ${f2(top / r06)}, want >= 0.85 (the old cone was 0.60)`);
  check(foot / mid >= 1.25, `foot flare ${f2(foot / mid)}x, want >= 1.25`);
  check(tris <= 600, `trunk ${tris} triangles, want <= 600`);
  check(wedges === TRUNK_BOOT.rings.length * TRUNK_BOOT.perRing && wedges === 21 && wedgesIn === 21,
    `boot: ${wedges} wedges, ${wedgesIn} inside H-0.9..H+0.1, want 21`);

  const b = barkMaps(128);
  const Y = lumY(b.mean);
  const c = hsv(b.mean);
  let nn = 0;
  for (let i = 0; i < b.normal.length; i += 4) nn += Math.abs(b.normal[i] / 127.5 - 1) + Math.abs(b.normal[i + 1] / 127.5 - 1);
  nn /= b.normal.length / 4;
  // The boot's uv lands on the lip: sample the albedo there.
  const uv = geo.getAttribute("uv");
  let lipLum = 0;
  {
    const u = ((uv.getX(T.bootStart) * 2) % 1 + 1) % 1, v = ((uv.getY(T.bootStart) * 6.35) % 1 + 1) % 1;
    const i = (Math.floor(v * 128) * 128 + Math.floor(u * 128)) * 4;
    lipLum = srgb8ToLinear(b.albedo[i + 1]);
  }
  console.log(`  bark mean linear (${b.mean.map(f3).join(", ")}) Y ${f3(Y)}, h${c.h.toFixed(0)} s${f2(c.s)}; normal mean |nx|+|ny| ${f3(nn)}; boot samples the lip at G ${f3(lipLum)} (lip uv ${BARK_LIP_UV.map(f3).join(",")})`);
  check(Y >= 0.085 && Y <= 0.115, `bark mean Y ${f3(Y)}, want 0.085-0.115`);
  check(c.s >= 0.15 && c.s <= 0.3, `bark saturation ${f2(c.s)}, want 0.15-0.30 (the old bark was 0.57)`);
  check(c.h >= 28 && c.h <= 45, `bark hue ${c.h.toFixed(0)}, want 28-45`);
  check(nn >= 0.08, `bark normal map is flat: mean |nx|+|ny| ${f3(nn)}`);
  check(lipLum > 0.14, `the boot's uv lands at G ${f3(lipLum)}, not on the lip`);
}

// --- 6. Placement -----------------------------------------------------------
console.log("6. placement");
{
  const track = new Track();
  const L = track.length;
  const fx = palmFixtures(track);
  const coast = { from: COAST_U.from * L, len: (COAST_U.to - COAST_U.from) * L };
  const want = Math.floor(coast.len / PALM_PLACE.pitch);
  const kinds = {};
  for (const f of fx) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  console.log(`  L ${L.toFixed(3)} m, coast ${coast.len.toFixed(1)} m, fixtures ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")}`);
  const cross = Math.round(L / 118);
  const crown = PALM_KINDS.map((k) => crowns[k]);
  // Headroom reads EVERY crown vertex. It used to read every fifth, and
  // a frond is 44 vertices, so most frond tips — the lowest points of a
  // crown — were never looked at: it printed 3.66 m where the crowns
  // really came down to 3.49.
  const crownPos = crown.map((g) => g.getAttribute("position").array);
  const crownW = crown.map((g) => g.getAttribute("grnWeight").array);

  // And it reads them bent, because the crowns are not still. The bend
  // is plantBend's, in the crown's own frame before the instance matrix:
  // xz moves by s = lean x weight along the lean, y drops by s^2 x
  // arcDrop. The lean is the most the real spring field gives a palm:
  // ten minutes of wind, several turns of its direction, and two cars
  // abreast at full wake strength coming both ways, the near one on the
  // asphalt edge itself — 2.6 m from a sea palm's trunk, closer than the
  // wall lets a car get. Every crown is then bent that far straight at
  // the road, which is the worst way for the headroom to go.
  //
  // What the bend costs is mostly not the arc drop — 2 cm at a 0.2 lean.
  // It is the sideways swing: a frond tip hanging just outside the
  // asphalt edge moves 0.2 m in and is over the road, lower than any
  // still vertex there. With fullMinH at 6.3 that took the untrimmed
  // crown's skirt from 3.49 m still to 3.24 m bent.
  const leanPeak = (() => {
    const P = RIG.plant, LAP = 4000, DT = 1 / 60, v = 80;
    const seeds = [];
    for (let k = 0; k < 40; k++) seeds.push({ s: 200 + k * 90, x: -2.6, z: 200 + k * 90, yaw: k, phase: k * 0.7, kind: 1 });
    const field = newPlantField(seeds);
    let peak = 0;
    const out = (i, dx, dz, str) => { if (str > peak) peak = str; };
    // Ten minutes. The wind's direction turns once in 126 s, the gust
    // swells every 17 s and the pair laps every 50 s, and the worst of
    // all three does not line up inside one turn: 131 s finds 0.161,
    // 300 s and anything longer 0.197. A second of run time, about.
    const T = 600;
    for (let i = 0; i < T * 60; i++) {
      const t = i * DT, s = (t * v) % LAP;
      const wakes = [0, 3].flatMap((x) => [
        { s, x, z: s, dirX: 0, dirZ: 1, speed: v, len: 4.6 },
        { s: LAP - s, x, z: LAP - s, dirX: 0, dirZ: -1, speed: v, len: 4.6 },
      ]);
      solvePlantField(field, t, DT, wakes, LAP, out);
    }
    return peak;
  })();
  const arcDrop = RIG.plant.arcDrop;

  let drawsOk = true, roleOk = true, leanOk = true, formOk = true;
  let worstClear = Infinity, worstStreet = Infinity, worstFly = Infinity, worstLat = Infinity, worstHead = Infinity, worstBent = Infinity;
  const headBy = [Infinity, Infinity, Infinity], bentBy = [Infinity, Infinity, Infinity];
  let maxShift = 0, minGap = Infinity, plazaOk = true, spanOk = true, slotOk = true;
  const share = [0, 0, 0];
  for (let seed = 1; seed <= 50; seed++) {
    // The shared stream, recorded, and a replay of the OLD loop's use of it.
    const base = makeRng((seed * 0x9e3779b1) >>> 0);
    const tape = [];
    const draw = () => { const x = base(); tape.push(x); return x; };
    let nLean = 0, nForm = 0;
    const leanBase = makeRng(((WORLD_SEED ^ 0x50414c4d) >>> 0) ^ seed);
    const leanTape = [];
    const lean = () => { nLean++; const x = leanBase(); leanTape.push(x); return x; };
    const formBase = makeRng(((WORLD_SEED ^ 0x504c4d32) >>> 0) ^ seed);
    const form = () => { nForm++; return formBase(); };
    const pl = placePalms(track, draw, lean, form, fx, coast);
    if (pl.length !== want) drawsOk = false;
    if (tape.length !== want * 4 + Math.floor((want + 1) / 5)) drawsOk = false;
    if (tape.length !== 550) drawsOk = false;
    if (nLean !== want * 4) leanOk = false;
    if (nForm !== want * 3) formOk = false;
    // Old loop: [lateral if i%5==4], at, grow, yaw, phase.
    let k = 0, kl = 0;
    for (const p of pl) {
      const lateral = p.i % 5 === 4 ? tape[k++] : null;
      const at0 = coast.from + (p.i / want) * coast.len + tape[k++] * 6;
      const grow = tape[k++];
      const yaw = tape[k++] * Math.PI * 2;
      const phase = tape[k++] * Math.PI * 2;
      kl += 2; // tilt, toward
      const hue = leanTape[kl++], v = leanTape[kl++];
      const kk = 2 * hue - 1, vv = 0.9 + 0.2 * v;
      if (Math.abs(p.at - p.shift - at0) > 1e-9) roleOk = false;
      if (Math.abs(p.h - (PALM_PLACE.trunkMin + PALM_PLACE.trunkSpan * grow)) > 1e-9) roleOk = false;
      if (p.yaw !== yaw || p.phase !== phase) roleOk = false;
      if (lateral !== null && Math.abs(p.lat - (track.halfWidthAt(p.at) + PALM_PLACE.inlandPad + PALM_PLACE.inlandSpread * lateral)) > 1e-9) roleOk = false;
      if (Math.abs(p.tint[0] - vv * (1 + 0.04 * kk)) > 1e-12 || Math.abs(p.tint[2] - vv * (1 - 0.06 * kk)) > 1e-12) roleOk = false;
    }

    const rp = new THREE.Vector3(), side = new THREE.Vector3(), v = new THREE.Vector3();
    for (const p of pl) {
      share[p.variant]++;
      maxShift = Math.max(maxShift, Math.abs(p.shift));
      const hw = track.halfWidthAt(p.at);
      worstLat = Math.min(worstLat, Math.abs(p.lat) - (hw + 1.5));
      for (const f of fx) {
        const ds = Math.abs(track.deltaAhead(p.at, f.s));
        if (f.kind === "street") { if (!p.sea) worstStreet = Math.min(worstStreet, ds - PALM_PLACE.streetClear); continue; }
        if (f.half !== undefined) { worstFly = Math.min(worstFly, ds - f.half); continue; }
        const dl = Math.abs(p.lat - f.lat);
        if (dl < 5) worstClear = Math.min(worstClear, ds - Math.sqrt(25 - dl * dl));
      }
      // Headroom over the carriageway, every crown vertex: still, and bent
      // leanPeak straight at the road.
      track.pointAt(p.at, rp);
      track.sideAt(p.at, side);
      const pos = crownPos[p.variant], wgt = crownW[p.variant];
      const e = p.crown.elements;
      // Toward the centre line in the ground plane, turned back by the
      // yaw into the crown's own frame, as plants.ts does for the shader.
      v.set(rp.x - p.x, 0, rp.z - p.z).normalize();
      const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
      const ox = v.x * cy - v.z * sy, oz = v.x * sy + v.z * cy;
      const vr = p.variant;
      for (let i = 0, n = wgt.length; i < n; i++) {
        let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        for (let pass = 0; pass < 2; pass++) {
          if (pass === 1) {
            const s = leanPeak * wgt[i];
            x += ox * s; z += oz * s; y -= s * s * arcDrop;
          }
          const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
          const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
          const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
          const lat = (wx - rp.x) * side.x + (wz - rp.z) * side.z;
          if (Math.abs(lat) >= hw) continue;
          if (pass === 0) { if (wy < headBy[vr]) headBy[vr] = wy; }
          else if (wy < bentBy[vr]) bentBy[vr] = wy;
        }
      }
      if (p.sea && p.s >= 489 && p.s <= 613 && p.lat > -(hw + 2.5)) plazaOk = false;
    }
    for (const sea of [true, false]) {
      const row = pl.filter((p) => p.sea === sea).sort((a, b) => a.at - b.at);
      for (let i = 1; i < row.length; i++) minGap = Math.min(minGap, row[i].at - row[i - 1].at);
    }
    for (let vr = 0; vr < 3; vr++) {
      const ss = pl.filter((p) => p.variant === vr).map((p) => p.s);
      if (!ss.length || Math.max(...ss) - Math.min(...ss) < 1500) spanOk = false;
    }
    // The spring field's map: every palm to exactly one (mesh, slot).
    const { slot, counts } = palmSlots(pl.map((p) => p.variant));
    const seen = new Set();
    pl.forEach((p, j) => {
      const key = `${p.variant}:${slot[j]}`;
      if (seen.has(key) || slot[j] >= counts[p.variant]) slotOk = false;
      seen.add(key);
    });
    if (counts[0] + counts[1] + counts[2] !== pl.length) slotOk = false;
  }
  const n = 50 * want;
  worstHead = Math.min(...headBy);
  worstBent = Math.min(...bentBy);
  const byKind = (a) => PALM_KINDS.map((k, i) => `${k} ${f3(a[i])}`).join(", ");
  console.log(`  ${want} palms per build; shared draws per build 550 ${drawsOk ? "every time" : "NOT every time"}, in the old roles (jitter, size, yaw, phase, inland lateral) ${roleOk}; lean stream 4/palm ${leanOk}, form stream 3/palm ${formOk}`);
  console.log(`  clearance: point fixtures ${f3(worstClear)} m spare at worst, cross streets ${f3(worstStreet)}, flyovers ${f3(worstFly)}; trunk ${f3(worstLat)} m outside hw + 1.5 at worst; largest move ${f2(maxShift)} m; closest same-side neighbours ${f2(minGap)} m`);
  console.log(`  headroom, every vertex over the carriageway: still ${f3(worstHead)} m (${byKind(headBy)}); bent ${f3(leanPeak)} at the road (the field's peak palm lean) ${f3(worstBent)} m (${byKind(bentBy)})`);
  console.log(`  crowns kept/full/young ${share.map((s) => (s / n).toFixed(2)).join("/")} (${share.map((s) => (s / 50).toFixed(1)).join("/")} a build); full only on trunks >= ${PALM_PLACE.fullMinH} m`);
  check(drawsOk, `the shared stream was not drawn exactly 550 times (131 x 4 + 26) — every building, lamp and billboard after the palms would move`);
  check(roleOk, "a shared draw changed role or order — the same 550 numbers must mean what they meant");
  check(leanOk, "the lean/tint stream is not 4 draws per palm");
  check(formOk, "the form stream is not 3 draws per palm");
  check(want === 131, `${want} palms, want 131 (floor(coastLen / 26))`);
  check(worstClear >= -1e-6, `a trunk is ${f3(-worstClear)} m inside a fixture's clearance`);
  check(worstStreet >= -1e-6, `an inland palm is ${f3(-worstStreet)} m into a cross street's clearance`);
  check(worstFly >= -1e-6, `a palm is ${f3(-worstFly)} m under a flyover's clearance`);
  check(worstLat >= -1e-6, `a trunk stands ${f3(-worstLat)} m inside hw + 1.5 — on the asphalt`);
  check(worstHead >= 3.4, `a crown hangs to ${f3(worstHead)} m over the carriageway, want >= 3.4`);
  check(worstBent >= 3.4, `bent ${f3(leanPeak)} toward the road, a crown hangs to ${f3(worstBent)} m over the carriageway, want >= 3.4`);
  // The lean is measured, not assumed: if the field ever stops leaning a
  // palm at all, the bent check above is a still check under another name.
  check(leanPeak > 0.1 && leanPeak < RIG.plant.maxLean, `the field's peak palm lean is ${f3(leanPeak)}, want 0.1..${RIG.plant.maxLean}`);
  check(plazaOk, "a sea palm at the Sharq plaza is inside -(hw + 2.5)");
  check(spanOk, "a crown variant is missing or spans under 1,500 m of coast — its InstancedMesh would fall inside shadows.mjs's ground-plane skip");
  check(share.every((s) => s > 0), `crown variants ${share.join("/")}: all three must appear`);
  check(slotOk, "the spring field's (mesh, slot) map is not one-to-one");
  check(minGap >= 6, `two same-side palms ${f2(minGap)} m apart after the moves`);

  // world.ts wiring, by source.
  const world = readFileSync("src/game/world.ts", "utf8");
  const grep = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return grep(p);
    return /\.(ts|tsx)$/.test(f) && readFileSync(p, "utf8").includes("upgradePalmCrowns") ? [p] : [];
  });
  const stale = grep("src");
  const lampReads = /const spacing = LAMP_COLUMNS\.spacing;/.test(world) && /const POLE_LAT = LAMP_COLUMNS\.lat;/.test(world);
  // The signal block and palmFixtures both iterate the junction model
  // (markings.ts junctions(): the one list the stop lines are laid from)
  // and stand the pole at SIGNALS.poleLat, so the palms keep clear of the
  // masts the world actually builds. SIGNALS.every states the model's
  // cadence for anyone reading world.ts; it must agree with it.
  const sigBlock = world.slice(world.indexOf("const approaches"), world.indexOf("const approaches") + 4000);
  const fixBlock = world.slice(world.indexOf("export function palmFixtures"), world.indexOf("export function palmFixtures") + 3000);
  const signalReads =
    /junctions\(track, STREETS\)/.test(sigBlock) && /signalHeadS\(j\)/.test(sigBlock) && /SIGNALS\.poleLat/.test(sigBlock) &&
    /junctions\(track, STREETS\)/.test(fixBlock) && /signalHeadS\(j\)/.test(fixBlock) &&
    SIGNALS.every === MARKINGS.junction.signalEvery;
  const named = /"palm-trunks"/.test(world) && /`palm-crowns-\$\{kind\}`/.test(world);
  console.log(`  wiring: upgradePalmCrowns in ${stale.length ? stale.join(", ") : "nothing"}; lamp loop reads LAMP_COLUMNS (${LAMP_COLUMNS.spacing} m, lat ${LAMP_COLUMNS.lat}) ${lampReads}; signals read SIGNALS (every ${SIGNALS.every}, lat ${SIGNALS.poleLat}) ${signalReads}; meshes named ${named}; ${cross} cross streets`);
  check(stale.length === 0, `upgradePalmCrowns is still referenced in ${stale.join(", ")}`);
  check(lampReads, "the lamp loop no longer reads LAMP_COLUMNS — the palms' clearance and the columns could drift apart");
  check(signalReads, "the signal block and palmFixtures must both iterate junctions() with SIGNALS.poleLat, and SIGNALS.every must equal MARKINGS.junction.signalEvery");
  check(named, "palm meshes must be named palm-trunks / palm-crowns-<kind>, or tests/world.mjs cannot fingerprint them");
}

// --- 7. The manifest ------------------------------------------------------
console.log("7. manifest");
{
  const manifest = JSON.parse(readFileSync("public/models/build.json", "utf8"));
  const listed = !!manifest.assets?.palm;
  const glb = existsSync("public/models/palm.glb");
  console.log(`  build.json lists palm: ${listed}; public/models/palm.glb present: ${glb}`);
  check(!listed, "build.json still lists palm — models.ts would fetch a crown nothing swaps in");
  check(!glb, "public/models/palm.glb is back — the crown is built in src/game/palm.ts");
}

console.log(fail.length ? `\nFAILURES:\n - ${fail.join("\n - ")}` : "\ndate palms, standing clear");
process.exit(fail.length ? 1 : 0);
