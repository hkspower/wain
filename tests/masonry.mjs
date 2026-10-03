// The city's walls, measured without a browser.
//
//   npm run test:masonry          (no browser, no dev server)
//
// masonry.ts builds four layers of one 1.8 m tile — buff brick, ochre
// limestone, white render, formed concrete — as plain typed arrays, and
// facadeSkin.ts splices them into the city's facade material. Both are
// pure enough to run here, so this measures what a screenshot can only
// suggest: where every joint is, how wide, how bright each layer is, that
// the tile repeats without a seam, which way the normals lean, and that
// building any of it took nothing from the world's shared random stream.
//
//   module     brick courses every 16 texels (75 mm), joints 2.13 wide
//              (10 mm), head joints every 48 (225 mm), alternate courses
//              half a brick over, faces 215 x 65 mm, mortar 17.2%
//   albedo     each layer's linear mean on its target; render > stone >
//              brick ~ formwork
//   tiling     the wrap seam is no rougher than the inside of the tile
//   normals    real relief where there is relief, flat where there is
//              not, unit length, leaning the right way off a joint
//   moire      no beat left in a box-down
//   roughness  brick face 0xda, mortar matte
//   stream     same bytes twice; the world's draw count does not move
//   choice     who wears what, by weight, stable per building
//   shader     every splice anchor is in three.js's own shader, every
//              uniform the GLSL declares is supplied, the textures are
//              filtered the way the header says
//   coverage   the old wall comes out of a mip-averaged texel by
//              coverage: any mix of window-map texels gives back its
//              glass, field and shaded trim shares, as the shader reads
//              them, where the old lerp left the old wall in
import { createHash } from "node:crypto";
import * as THREE from "three";
import {
  buildMasonry,
  moduleCell,
  masonryFamily,
  FAMILIES,
  FAMILY,
  MODULES_PER_TILE,
  MASONRY_N,
  MASONRY_TEXEL_MM,
  MASONRY_TILE_M,
  MASONRY_WEIGHTS,
  MASONRY_TALL_M,
  OCT_PERIMETER,
  FACADE_WALL_HEX,
  FACADE_WALL_LUMA,
  FACADE_SHADE_MAX,
  shadeOpaqueCoverage,
  srgbToLinear,
  luminance,
} from "../src/game/masonry.ts";
import {
  FACADE_ANCHORS,
  facadeSkinUniforms,
  masonryTextures,
  patchFacadeShaders,
} from "../src/game/facadeSkin.ts";
import { rand, resetWorldRng, worldDraws } from "../src/game/rand.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const N = MASONRY_N, NN = N * N, T = MASONRY_TEXEL_MM;
const fx = (v, d = 3) => v.toFixed(d);

// --- build, with the world's stream mid-flight -------------------------
resetWorldRng();
for (let i = 0; i < 1234; i++) rand();
const drawsBefore = worldDraws();
const c0 = process.cpuUsage();
const t0 = performance.now();
const M = buildMasonry({ debug: true });
const buildMs = performance.now() - t0;
const cpu = process.cpuUsage(c0);
const M2 = buildMasonry();
const picks = [];
for (let i = 0; i < 10000; i++) picks.push(masonryFamily(i, 20));
console.log(
  `build     ${M.n}x${M.n}x${M.layers}, ${fx(buildMs, 0)} ms cold (${fx((cpu.user + cpu.system) / 1000, 0)} ms cpu)`
);

// --- 1. the brick module, from the joint coverage ----------------------
//
// Joints are found as runs of joint coverage along a line of texels; a
// run's WIDTH is its summed coverage (the analytic joint is 10/4.6875 =
// 2.133 texels) and its CENTRE the coverage-weighted mean.
const joints = (get) => {
  // Start from a texel with no joint in it, so no run straddles the wrap.
  let s = 0;
  while (s < N && get(s) > 0) s++;
  const runs = [];
  let w = 0, m = 0;
  for (let k = 1; k <= N; k++) {
    const i = s + k, c = get(i % N);
    if (c > 0) { w += c; m += c * (i + 0.5); }
    else if (w > 0) { runs.push({ width: w, centre: m / w }); w = 0; m = 0; }
  }
  return runs;
};
const period = (runs) => (runs[runs.length - 1].centre - runs[0].centre) / (runs.length - 1);
{
  const mo = M.mortar[FAMILY.brick];
  const at = (x, y) => mo[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
  const bed = joints((y) => at(12, y));
  const bedW = bed.map((r) => r.width);
  console.log(
    `courses   ${check(bed.length === 24 && Math.abs(period(bed) - 16) < 0.01, `bed joints along x=12: ${bed.length} at a period of ${fx(period(bed))} texels, want 24 at 16.0`)} ` +
      `${check(bedW.every((w) => Math.abs(w - 10 / T) < 0.15), `bed joints ${fx(Math.min(...bedW))}-${fx(Math.max(...bedW))} texels wide, want ${fx(10 / T)} (10 mm)`)}  ` +
      `${bed.length} bed joints every ${fx(period(bed), 2)} texels (75 mm), ${fx(bedW[0], 2)} wide (10 mm)`
  );
  const head8 = joints((x) => at(x, 8)), head24 = joints((x) => at(x, 24));
  const off = (((head24[0].centre - head8[0].centre) % 48) + 48) % 48;
  console.log(
    `bond      ${check(head8.length === 8 && Math.abs(period(head8) - 48) < 0.01, `head joints along y=8: ${head8.length} at ${fx(period(head8))} texels, want 8 at 48 (225 mm)`)} ` +
      `${check(Math.abs(off - 24) < 0.01, `the next course is offset ${fx(off)} texels, want 24 (half a brick)`)}  ` +
      `head joints every ${fx(period(head8), 1)} texels, next course ${fx(off, 1)} over`
  );
  // Faces: the summed NON-joint coverage between neighbouring joints.
  const faceRun = (runs, get) => {
    const out = [];
    for (let k = 0; k + 1 < runs.length; k++) {
      let s = 0;
      for (let i = Math.ceil(runs[k].centre); i < Math.floor(runs[k + 1].centre); i++) s += 1 - get(i % N);
      // The two half texels the integer walk skipped hold joint only.
      out.push(s);
    }
    return out;
  };
  const fw = faceRun(head8, (x) => at(x, 8)), fh = faceRun(bed, (y) => at(12, y));
  const meanW = fw.reduce((a, b) => a + b, 0) / fw.length, meanH = fh.reduce((a, b) => a + b, 0) / fh.length;
  console.log(
    `faces     ${check(Math.abs(meanW - 215 / T) < 1 && Math.abs(meanH - 65 / T) < 1, `brick faces ${fx(meanW, 1)} x ${fx(meanH, 1)} texels, want ${fx(215 / T, 1)} x ${fx(65 / T, 1)} (215 x 65 mm)`)}  ` +
      `${fx(meanW, 2)} x ${fx(meanH, 2)} texels = ${fx(meanW * T, 1)} x ${fx(meanH * T, 1)} mm`
  );
  let mfrac = 0;
  for (let i = 0; i < NN; i++) mfrac += mo[i];
  mfrac /= NN;
  console.log(
    `mortar    ${check(Math.abs(mfrac - 0.172) < 0.01, `mortar fraction ${fx(mfrac, 4)}, want 0.172`)}  ` +
      `${fx(mfrac * 100, 2)}% of the wall (analytic ${fx((1 - (215 * 65) / (225 * 75)) * 100, 2)}%)`
  );
}
// Every joint texel of every module family sits on a module boundary, as
// moduleCell — and therefore the shader's grnCell — draws them.
for (const f of [FAMILY.brick, FAMILY.stone, FAMILY.formwork]) {
  const J = FAMILIES[f].module.joint, mo = M.mortar[f], e = 1e-6;
  let stray = 0, n = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (mo[y * N + x] <= 1e-4) continue;
      n++;
      const xs = [x * T - J / 2 + e, (x + 1) * T + J / 2 - e], ys = [y * T - J / 2 + e, (y + 1) * T + J / 2 - e];
      const cells = new Set();
      for (const px of xs) for (const py of ys) cells.add(moduleCell(px, py, f).join(","));
      if (cells.size === 1) stray++;
    }
  }
  console.log(
    `on-grid   ${check(stray === 0 && n > 0, `${FAMILIES[f].name}: ${stray} of ${n} joint texels are nowhere near a module boundary`)}  ` +
      `${FAMILIES[f].name}: all ${n} joint texels on a moduleCell boundary`
  );
}

// --- 2. albedo -----------------------------------------------------------
const meanLin = [];
for (let f = 0; f < 4; f++) {
  const b = f * NN * 4, s = [0, 0, 0];
  for (let i = 0; i < NN; i++) for (let c = 0; c < 3; c++) s[c] += srgbToLinear(M.albedo[b + i * 4 + c]);
  const mean = s.map((v) => v / NN), want = FAMILIES[f].mean.map(srgbToLinear);
  const worst = Math.max(...mean.map((v, c) => Math.abs(v / want[c] - 1)));
  meanLin.push(mean);
  console.log(
    `albedo    ${check(worst < 0.03, `${FAMILIES[f].name}: linear mean off its target by ${fx(worst * 100, 1)}%`)}  ` +
      `${FAMILIES[f].name.padEnd(16)} mean ${mean.map((v) => fx(v)).join(" ")} (luminance ${fx(luminance(mean))}), within ${fx(worst * 100, 2)}%`
  );
}
{
  const L = meanLin.map(luminance);
  const [br, st, re, fo] = L;
  console.log(
    `order     ${check(re > st && st > Math.max(br, fo) && Math.abs(br - fo) / br < 0.15, `luminance order wrong: brick ${fx(br)}, stone ${fx(st)}, render ${fx(re)}, formwork ${fx(fo)}`)}  ` +
      `render ${fx(re)} > stone ${fx(st)} > brick ${fx(br)} ~ formwork ${fx(fo)}`
  );
}

// --- 3. tiling -------------------------------------------------------------
//
// The wrap seam against the inside of the tile — at the SAME phase of the
// module. The joints are centred on the tile's edges on purpose, so the
// seam's pair of texels always straddles a joint centre, where a normal
// flips from leaning one way to the other. Against the tile's average
// pair (mostly flat brick face) that read as a 4.6x "seam" on a tile that
// has none; against the pairs that straddle the other joint centres, an
// unwrapped feature — a hole cut off at the edge, a field that does not
// repeat — still stands out.
for (const [which, data] of [["albedo", M.albedo], ["normal", M.normal]]) {
  for (let f = 0; f < 4; f++) {
    const b = f * NN * 4;
    const m = FAMILIES[f].module;
    const [PX, PY] = m ? [Math.round(m.w / T), Math.round(m.h / T)] : [1, 1];
    const d = (i, j) => {
      let s = 0;
      for (let c = 0; c < 4; c++) s += Math.abs(data[b + i * 4 + c] - data[b + j * 4 + c]);
      return s;
    };
    let seamX = 0, seamY = 0, inX = 0, inY = 0, nX = 0, nY = 0;
    for (let k = 0; k < N; k++) {
      seamX += d(k * N + N - 1, k * N);
      seamY += d((N - 1) * N + k, k);
      for (let x = PX; x < N; x += PX) { inX += d(k * N + x - 1, k * N + x); nX++; }
      for (let y = PY; y < N; y += PY) { inY += d((y - 1) * N + k, y * N + k); nY++; }
    }
    const rx = seamX / N / (inX / nX), ry = seamY / N / (inY / nY);
    check(rx <= 1.25 && ry <= 1.25, `${FAMILIES[f].name} ${which}: the wrap seam is ${fx(Math.max(rx, ry), 2)}x the same joint inside the tile`);
    console.log(
      `tiling    ${rx <= 1.25 && ry <= 1.25 ? "ok" : "FAIL"}  ${FAMILIES[f].name.padEnd(16)} ${which}: ` +
        `seam / same phase inside ${fx(rx, 2)} across, ${fx(ry, 2)} up`
    );
  }
}

// --- 4. normals --------------------------------------------------------------
const nrm = (f, i) => {
  const b = f * NN * 4 + i * 4;
  return [M.normal[b] / 127.5 - 1, M.normal[b + 1] / 127.5 - 1, M.normal[b + 2] / 127.5 - 1];
};
{
  const want = [
    // [min tilted fraction, mean nz range]
    { tilted: 0.15, nz: [0.9, 0.99] },
    { tilted: 0.03 },
    { flatStd: [0.01, 0.1] },
    { tilted: 0.01 },
  ];
  for (let f = 0; f < 4; f++) {
    let tilted = 0, nz = 0, bad = 0, sxy = 0, sxy2 = 0;
    for (let i = 0; i < NN; i++) {
      const [x, y, z] = nrm(f, i);
      const l = Math.hypot(x, y, z), xy = Math.hypot(x, y);
      if (Math.abs(l - 1) > 0.03) bad++;
      if (xy > 0.2) tilted++;
      nz += z; sxy += xy; sxy2 += xy * xy;
    }
    const tf = tilted / NN, mz = nz / NN, std = Math.sqrt(sxy2 / NN - (sxy / NN) ** 2);
    const w = want[f];
    let ok = bad === 0;
    let why = `${bad} texels decode to |n| off 1 by more than 0.03`;
    if (ok && w.tilted !== undefined && tf < w.tilted) { ok = false; why = `only ${fx(tf * 100, 1)}% of texels tilt past 0.2, want ${w.tilted * 100}%`; }
    if (ok && w.nz && (mz < w.nz[0] || mz > w.nz[1])) { ok = false; why = `mean n.z ${fx(mz)}, want ${w.nz[0]}-${w.nz[1]}`; }
    if (ok && w.flatStd && (std < w.flatStd[0] || std > w.flatStd[1])) { ok = false; why = `std |n.xy| ${fx(std, 4)}, want ${w.flatStd[0]}-${w.flatStd[1]}`; }
    console.log(
      `normals   ${check(ok, `${FAMILIES[f].name}: ${why}`)}  ${FAMILIES[f].name.padEnd(16)} ` +
        `${fx(tf * 100, 1)}% tilted past 0.2, mean n.z ${fx(mz)}, std |n.xy| ${fx(std, 4)}`
    );
  }
  // Off a bed joint: the brick ABOVE rolls down into it (its normal
  // leans down, -y) and the one BELOW rolls up out of it (+y). Rows 16k-1
  // and 16k are the joint; 16k+1 and 16k-2 are the faces either side.
  let up = 0, dn = 0, n = 0;
  for (let k = 0; k < 24; k++) {
    for (let x = 0; x < N; x++) {
      up += nrm(0, ((16 * k + 1) % N) * N + x)[1];
      dn += nrm(0, ((16 * k - 2 + N) % N) * N + x)[1];
      n++;
    }
  }
  up /= n; dn /= n;
  console.log(
    `lean      ${check(up < -0.2 && dn > 0.2, `off a bed joint the normals lean ${fx(up)} above and ${fx(dn)} below, want < -0.2 and > +0.2 (+Y up)`)}  ` +
      `mean n.y ${fx(up)} on the course above a bed joint, ${fx(dn)} on the one below`
  );
}

// --- 5. no moire source ------------------------------------------------------
//
// 24 x 24 texel boxes: half a brick across and a course and a half up,
// so every box holds exactly the same share of bed and head joint (the
// half bond puts a head joint's half in every 24-texel span). What is
// left is the brick-to-brick tone the texture bakes — small on purpose,
// because the shader adds the big per-brick jitter per building.
{
  const B = 24, K = N / B, v = [];
  for (let by = 0; by < K; by++) {
    for (let bx = 0; bx < K; bx++) {
      let s = 0;
      for (let y = by * B; y < (by + 1) * B; y++) {
        for (let x = bx * B; x < (bx + 1) * B; x++) {
          const i = (y * N + x) * 4;
          s += luminance([srgbToLinear(M.albedo[i]), srgbToLinear(M.albedo[i + 1]), srgbToLinear(M.albedo[i + 2])]);
        }
      }
      v.push(s / (B * B));
    }
  }
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const cv = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) / mean;
  console.log(
    `moire     ${check(cv < 0.04, `brick box-down varies ${fx(cv * 100, 1)}%, want under 4%`)}  ` +
      `brick in 24-texel boxes varies ${fx(cv * 100, 2)}%`
  );
}

// --- 6. roughness ---------------------------------------------------------------
{
  const mo = M.mortar[FAMILY.brick];
  let faceN = 0, faceBad = 0, jointN = 0, jointMin = 255;
  for (let i = 0; i < NN; i++) {
    const r = M.normal[i * 4 + 3];
    if (mo[i] < 0.01) { faceN++; if (Math.abs(r - 0xda) > 8) faceBad++; }
    else if (mo[i] > 0.99) { jointN++; jointMin = Math.min(jointMin, r); }
  }
  console.log(
    `rough     ${check(faceBad === 0 && jointMin >= 0xe8, faceBad ? `${faceBad} brick-face texels stray past 0xda +/- 8` : `mortar roughness down to ${jointMin}, want >= 0xe8`)}  ` +
      `${faceN} face texels at 0xda +/- 8, ${jointN} mortar texels at >= ${jointMin}`
  );
}

// --- 7. determinism and the shared stream ---------------------------------------
{
  const h = (m) => createHash("sha256").update(m.albedo).update(m.normal).digest("hex").slice(0, 16);
  console.log(`repeat    ${check(h(M) === h(M2), `two builds differ: ${h(M)} vs ${h(M2)}`)}  two builds, one hash ${h(M)}`);
  const after = worldDraws();
  console.log(
    `stream    ${check(after === drawsBefore, `the world's stream moved by ${after - drawsBefore} draws`)}  ` +
      `world draws ${drawsBefore} before two builds and 10,000 picks, ${after} after`
  );
}

// --- 8. who wears what -------------------------------------------------------------
{
  const freq = (list) => {
    const c = [0, 0, 0, 0];
    for (const p of list) c[p.family]++;
    return c.map((v) => v / list.length);
  };
  const tall = [], drum = [];
  for (let i = 0; i < 10000; i++) { tall.push(masonryFamily(i, 60)); drum.push(masonryFamily(0x10000 + i, 40, true)); }
  for (const [name, list, w] of [["low", picks, MASONRY_WEIGHTS.low], ["tall", tall, MASONRY_WEIGHTS.tall], ["drum", drum, MASONRY_WEIGHTS.drum]]) {
    const f = freq(list);
    const worst = Math.max(...f.map((v, k) => Math.abs(v - w[k])));
    console.log(
      `choice    ${check(worst <= 0.02, `${name}: frequencies ${f.map((v) => fx(v, 3)).join("/")} off the weights ${w.join("/")} by ${fx(worst, 3)}`)}  ` +
        `${name.padEnd(5)} brick/stone/render/formwork ${f.map((v) => fx(v, 3)).join(" / ")} (want ${w.join(" / ")})`
    );
  }
  const drumBad = drum.filter((p) => p.family === FAMILY.brick || p.family === FAMILY.formwork).length;
  check(drumBad === 0, `${drumBad} drums came out brick or formwork`);
  let unstable = 0, badSeed = 0;
  for (let i = 0; i < 10000; i++) {
    const a = masonryFamily(i, 20), b = masonryFamily(i, 20);
    if (a.family !== b.family || a.seed !== b.seed) unstable++;
    if (!(a.seed >= 0 && a.seed < 1) || a.seed * 4096 !== Math.floor(a.seed * 4096)) badSeed++;
  }
  // The threshold is the building's height, not its draw: 39.9 m and
  // 40 m pick from different tables.
  const split = masonryFamily(7, MASONRY_TALL_M - 0.1).family !== undefined && masonryFamily(7, MASONRY_TALL_M).family !== undefined;
  console.log(
    `stable    ${check(unstable === 0 && badSeed === 0 && drumBad === 0 && split, `${unstable} owners changed family between calls, ${badSeed} seeds off the 1/4096 grid`)}  ` +
      `same owner, same answer; seeds on a 1/4096 grid; no brick or formwork drums`
  );
}

// --- 9. the contracts the shader and the city lean on ---------------------------------
{
  const pxPerM = 1080 / Math.tan((26 * Math.PI) / 180) / 12;
  const tpm = N / MASONRY_TILE_M;
  console.log(
    `density   ${check(tpm >= pxPerM, `${fx(tpm, 1)} texels/m under the ${fx(pxPerM, 1)} px/m a 4K chase frame puts on a wall 12 m off`)}  ` +
      `${fx(tpm, 1)} texels/m >= ${fx(pxPerM, 1)} px/m (4K, fov 52, 12 m)`
  );
  let bad = [];
  FAMILIES.forEach((s, f) => {
    const [cols, rows, bond] = MODULES_PER_TILE[f];
    const tile = MASONRY_TILE_M * 1000;
    if (!s.module) { if (cols !== 1 || rows !== 1 || bond !== 0) bad.push(`${s.name}: no module but ${cols}x${rows}`); return; }
    if (Math.abs(cols * s.module.w - tile) > 1e-6 || Math.abs(rows * s.module.h - tile) > 1e-6) bad.push(`${s.name}: ${cols}x${rows} modules do not fill the tile`);
    if (bond !== s.module.bond) bad.push(`${s.name}: bond ${bond} vs ${s.module.bond}`);
    if (bond && rows % 2) bad.push(`${s.name}: half bond over an odd ${rows} courses would seam`);
    for (const d of [s.module.w, s.module.h]) if (Math.abs(d / T - Math.round(d / T)) > 1e-9) bad.push(`${s.name}: ${d} mm is not whole texels`);
  });
  if (Math.abs(75 / T - 16) > 1e-12) bad.push(`a brick course is ${75 / T} texels, not 16`);
  console.log(`modules   ${check(bad.length === 0, bad.join("; "))}  every module a whole number of texels; a brick course exactly 16`);
  console.log(
    `drums     ${check(Math.abs(OCT_PERIMETER - 3.0615) < 0.001, `octagon perimeter/diameter ${OCT_PERIMETER}`)}  ` +
      `octagon perimeter is ${fx(OCT_PERIMETER, 4)} diameters`
  );
  console.log(
    `wall      ${check(Math.abs(FACADE_WALL_LUMA - 0.126) < 0.001, `the old wall's luminance is ${FACADE_WALL_LUMA}`)}  ` +
      `#5f646b luminance ${fx(FACADE_WALL_LUMA, 4)}`
  );
}

// --- 10. the shader splice -------------------------------------------------------------
{
  const vs = THREE.ShaderLib.standard.vertexShader, fs = THREE.ShaderLib.standard.fragmentShader;
  const count = (s, a) => s.split(a).length - 1;
  const anchorsBad = [
    ...FACADE_ANCHORS.vertex.filter((a) => count(vs, a) !== 1).map((a) => `vertex ${a} x${count(vs, a)}`),
    ...FACADE_ANCHORS.fragment.filter((a) => count(fs, a) !== 1).map((a) => `fragment ${a} x${count(fs, a)}`),
  ];
  const p = patchFacadeShaders(vs, fs, { tileX: 39, tileY: 85, cityGroundY: -0.08 });
  console.log(
    `anchors   ${check(anchorsBad.length === 0 && p.ok, `three.js ${THREE.REVISION}: ${anchorsBad.join(", ") || "patch not ok"}`)}  ` +
      `all ${FACADE_ANCHORS.vertex.length + FACADE_ANCHORS.fragment.length} splice points present once in three.js r${THREE.REVISION}`
  );
  // In order: masonry after the instance colour, roughness after three's,
  // the normal after the normal maps and before the lights read it.
  const at = (a) => p.fragmentShader.indexOf(a);
  const order = [
    "#include <color_fragment>", "float grnShade = 0.0;", "#include <roughnessmap_fragment>",
    "roughnessFactor += roughness * grnFieldCov", "#include <normal_fragment_maps>", "grnTangentFrame(-vViewPosition",
    "#include <lights_fragment_begin>", "#include <dithering_fragment>", "if (grnDebug > 0.5)",
  ].map(at);
  console.log(
    `splice    ${check(order.every((v, k) => v >= 0 && (k === 0 || v > order[k - 1])), `fragment splices out of order: ${order.join(", ")}`)}  ` +
      `colour, roughness, normal, debug land in three's order`
  );
  // Every uniform the GLSL declares is supplied, with four entries where
  // it is an array — an unsupplied uniform is silently zero.
  const declared = new Map();
  for (const src of [p.vertexShader, p.fragmentShader]) {
    for (const m of src.matchAll(/uniform\s+\w+\s+(grn\w+)(?:\[(\d+)\])?\s*;/g)) declared.set(m[1], m[2] ? +m[2] : 0);
  }
  const tex = masonryTextures(M2);
  const u = facadeSkinUniforms(tex);
  const missing = [...declared].filter(([k, n]) => !(k in u) || (n && (!Array.isArray(u[k].value) || u[k].value.length !== n))).map(([k]) => k);
  const extra = Object.keys(u).filter((k) => !declared.has(k));
  console.log(
    `uniforms  ${check(missing.length === 0 && extra.length === 0 && declared.size > 10, `uniforms declared but not supplied: ${missing.join(", ") || "-"}; supplied but not declared: ${extra.join(", ") || "-"}`)}  ` +
      `${declared.size} grn uniforms declared, all supplied`
  );
  // The attribute and the varyings are declared on both sides they cross.
  const vary = ["vGrnMuv", "vGrnY", "vGrnFam", "vGrnSeed"];
  const both = vary.every((n) => p.vertexShader.includes(` ${n};`) && p.fragmentShader.includes(` ${n};`));
  console.log(
    `varyings  ${check(both && p.vertexShader.includes("attribute vec2 grnMasonry;"), `a varying or the grnMasonry attribute is missing from one stage`)}  ` +
      `${vary.join(", ")} cross both stages; grnMasonry is an instanced attribute`
  );
  // The textures, as the header says: arrays of four, sRGB colour and raw
  // data, Linear magnification so anisotropy applies, trilinear mips.
  const t = [
    ["albedo", tex.albedo, THREE.SRGBColorSpace],
    ["normal", tex.normal, THREE.NoColorSpace],
  ].map(([name, x, cs]) => {
    const why = [];
    if (!x.isDataArrayTexture) why.push("not a DataArrayTexture");
    if (x.image.depth !== 4 || x.image.width !== N || x.image.height !== N) why.push(`${x.image.width}x${x.image.height}x${x.image.depth}`);
    if (x.colorSpace !== cs) why.push(`colour space ${x.colorSpace}`);
    if (x.magFilter !== THREE.LinearFilter) why.push("magFilter not Linear (anisotropy would never apply)");
    if (x.minFilter !== THREE.LinearMipmapLinearFilter || !x.generateMipmaps) why.push("not trilinear with mips");
    if (x.anisotropy < 8) why.push(`anisotropy ${x.anisotropy}`);
    if (x.wrapS !== THREE.RepeatWrapping || x.wrapT !== THREE.RepeatWrapping) why.push("not repeating");
    return why.length ? `${name}: ${why.join(", ")}` : null;
  }).filter(Boolean);
  console.log(
    `textures  ${check(t.length === 0, t.join("; "))}  two 384x384x4 RGBA8 arrays, sRGB + data, Linear/trilinear, anisotropy 16`
  );
  // Without the anchors the facade must fall back to the UV scaling alone,
  // not to half a splice.
  const broken = patchFacadeShaders(vs, fs.replace("#include <color_fragment>", "#include <color_fragment_x>"), { tileX: 39, tileY: 85, cityGroundY: -0.08 });
  console.log(
    `fallback  ${check(!broken.ok && broken.fragmentShader === fs.replace("#include <color_fragment>", "#include <color_fragment_x>") && broken.vertexShader.includes("vMapUv *= grnTile") && !broken.vertexShader.includes("grnMasonry"), "a missing anchor did not fall back to the UV scaling alone")}  ` +
      `a missing anchor leaves the window-map UV scaling and no masonry`
  );
}

// --- 11. the old wall comes out by coverage -------------------------------------------
//
// A far facade is a mip: each texel the average of window-map texels that
// were glass, field or trim up close. The shader swaps the masonry in
// with sums only — t(C - K W0) + R field + (K - R) trim — so any average
// should give back exactly its glass colour, its field share and its
// shaded trim share. Checked here on one texel of each kind windowTextures
// paints (byte for byte, the band and its shadow line composited the way
// a canvas does), over every mix of them a mip could make.
{
  const lin3 = (c) => c.map(srgbToLinear);
  const W0 = [(FACADE_WALL_HEX >> 16) & 255, (FACADE_WALL_HEX >> 8) & 255, FACADE_WALL_HEX & 255];
  const band = W0.map((v) => Math.round(v * 0.9));
  const shadow = band.map((v) => Math.round(v * 0.78));
  const kinds = [
    { name: "wall", c: W0, r: 255, g: 218, b: 255 },
    { name: "band", c: band, r: 0, g: 218, b: 255 },
    { name: "shadow", c: shadow, r: 0, g: 218, b: 255 },
    { name: "surround", c: [0x6f, 0x74, 0x7d], r: 0, g: 218, b: 255 },
    { name: "sky pane", c: [0x5a, 0x6b, 0x7e], r: 0, g: 31, b: 0 },
    { name: "dark pane", c: [0x34, 0x3b, 0x46], r: 0, g: 31, b: 0 },
    { name: "bar", c: [0x3d, 0x43, 0x4d], r: 0, g: 138, b: 0 },
  ];
  const n = kinds.length;
  const fb = new Uint8Array(n * 4), rb = new Uint8Array(n * 4);
  kinds.forEach((k, i) => { fb.set([...k.c, 255], i * 4); rb.set([k.r, k.g, k.b, 255], i * 4); });
  const st = shadeOpaqueCoverage(fb, rb);
  const byte = (name) => rb[kinds.findIndex((k) => k.name === name) * 4 + 2];
  const gSame = kinds.every((k, i) => rb[i * 4 + 1] === k.g && rb[i * 4] === k.r);
  console.log(
    `shade     ${check(byte("wall") === Math.round(255 / FACADE_SHADE_MAX) && st.opaque === 4 && st.partial === 0 && st.clamped === 0 && gSame && byte("sky pane") === 0, `B bytes ${kinds.map((k) => `${k.name} ${byte(k.name)}`).join(", ")}; ${st.clamped} clamped; R/G moved: ${!gSame}`)}  ` +
      `B = ${kinds.slice(0, 4).map((k) => `${k.name} ${byte(k.name)}`).join(", ")} (x${FACADE_SHADE_MAX}/255 walls); glass 0; R, G untouched`
  );
  const Wl = lin3(W0), Na = 0xc4 / 255, rough = 0.8 / (0xda / 255);
  const kOf = (c) => luminance(lin3(c)) / FACADE_WALL_LUMA;
  let glassErr = 0, trimErr = 0, roughErr = 0, lerpLeft = 0, mixes = 0;
  for (let mask = 1; mask < 1 << n; mask++) {
    const ids = kinds.map((_, i) => i).filter((i) => mask & (1 << i));
    const m = ids.length;
    const avg = (f) => ids.reduce((s, i) => s + f(i), 0) / m;
    // what the GPU's mips hold: linear colour, raw bytes
    const C = [0, 1, 2].map((ch) => avg((i) => lin3(kinds[i].c)[ch]));
    const R = avg((i) => rb[i * 4] / 255), G = avg((i) => rb[i * 4 + 1] / 255);
    const K = avg((i) => rb[i * 4 + 2] / 255) * FACADE_SHADE_MAX;
    // what the texels under it say each share is
    const isGlass = (i) => kinds[i].b === 0, isField = (i) => kinds[i].r === 255;
    const glass = [0, 1, 2].map((ch) => avg((i) => (isGlass(i) ? lin3(kinds[i].c)[ch] : 0)));
    const trim = avg((i) => (!isGlass(i) && !isField(i) ? kOf(kinds[i].c) : 0));
    const roughTrue = rough * avg((i) => (isField(i) ? Na : rb[i * 4 + 1] / 255));
    // the shader's reading of the mix
    glassErr = Math.max(glassErr, ...C.map((v, ch) => Math.abs(v - Wl[ch] * K - glass[ch]) / Wl[ch]));
    trimErr = Math.max(trimErr, Math.abs(Math.max(K - R, 0) - trim));
    roughErr = Math.max(roughErr, Math.abs(rough * (G + R * (Na - 0xda / 255)) - roughTrue));
    // the lerp it replaced: mix(t C, wall, B) keeps (1 - B) of C, opaque share and all
    const B = avg((i) => (isGlass(i) ? 0 : 1));
    if (B > 0 && B < 1) {
      const opaqueL = luminance([0, 1, 2].map((ch) => C[ch] - glass[ch]));
      lerpLeft = Math.max(lerpLeft, ((1 - B) * opaqueL) / FACADE_WALL_LUMA);
    }
    mixes++;
  }
  console.log(
    `coverage  ${check(glassErr < 0.025 && trimErr < 0.01 && roughErr < 1e-9, `over ${mixes} mixes: glass off by ${fx(glassErr, 4)} of the wall, shaded trim by ${fx(trimErr, 4)} walls, roughness by ${roughErr}`)}  ` +
      `${mixes} mixes of ${n} texels: glass back within ${fx(glassErr * 100, 2)}% of the wall, trim within ${fx(trimErr, 4)} walls, roughness exact; ` +
      `the lerp left up to ${fx(lerpLeft, 3)} walls of the old one in`
  );
}

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe walls are built of something.");
