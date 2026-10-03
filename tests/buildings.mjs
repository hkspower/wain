// How the buildings are put together.
//
//   npm run dev
//   node tests/buildings.mjs
//
// A city block was one BoxGeometry scaled per instance: a featureless
// extrusion with a dead flat top. Three hundred of those is not a
// skyline, it is a bar chart — and the giveaway is that the top edge of
// the city is a row of horizontal lines at different heights with
// nothing on any of them.
//
// A building is a stack: a shaft, a parapet capping it, plant on the
// roof, and a setback where it gets tall. This checks the stack is
// actually there and actually sits where it should, because every part
// of it is instanced and an instanced mesh with a wrong matrix does not
// error — it just puts a shed through a roof, or two metres above one,
// and keeps going.
//
//   present   every shaft has a parapet; the tall ones step in
//   seated    nothing floats above its roof or sinks through it
//   inside    a setback is narrower than the shaft under it, and plant
//             is inside the parapet rather than hanging off the edge
//   variety   the skyline is not one repeated shape
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 800, height: 460 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
// A facade shader that fails to compile does not throw: three.js logs it
// and draws nothing. Kept for the masonry section at the end.
const shaderErrors = [];
page.on("console", (m) => {
  // Not every "THREE.WebGLProgram" line: a driver's info-log warning on
  // some other material is not this check's business.
  if (/Shader Error|facadeSkin/.test(m.text())) shaderErrors.push(m.text().slice(0, 400));
});
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });
await page.waitForTimeout(4000);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const city = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const find = (name) => {
    let hit = null;
    e.scene.traverse((o) => {
      if (o.name === name) hit = o;
    });
    return hit;
  };
  /** Every instance of a mesh, as a world-space box. */
  const boxes = (mesh) => {
    if (!mesh) return [];
    const out = [];
    const m = new THREE.Matrix4();
    const unit = new THREE.Box3(
      new THREE.Vector3(-0.5, 0, -0.5),
      new THREE.Vector3(0.5, 1, 0.5)
    );
    // The geometry is translated so its origin is the base; a cylinder
    // mast is centred, so read the geometry's own bounds instead of
    // assuming.
    mesh.geometry.computeBoundingBox();
    const gb = mesh.geometry.boundingBox;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const b = new THREE.Box3(gb.min.clone(), gb.max.clone()).applyMatrix4(m);
      out.push({
        cx: +((b.min.x + b.max.x) / 2).toFixed(3),
        cz: +((b.min.z + b.max.z) / 2).toFixed(3),
        minY: +b.min.y.toFixed(3),
        maxY: +b.max.y.toFixed(3),
        w: +(b.max.x - b.min.x).toFixed(3),
        d: +(b.max.z - b.min.z).toFixed(3),
      });
    }
    void unit;
    return out;
  };
  const withOwners = (name) => {
    const mesh = find(name);
    const list = boxes(mesh);
    const map = mesh?.userData.ownerOf;
    if (map) list.forEach((b, i) => (b.owner = map[i]));
    return list;
  };
  return {
    shafts: boxes(find("cityBlocks")),
    parapets: withOwners("cityParapets"),
    setbacks: withOwners("citySetbacks"),
    plant: withOwners("cityPlant"),
    masts: withOwners("cityMasts"),
  };
});

console.log(
  `pieces    ${city.shafts.length} shafts, ${city.parapets.length} parapets, ` +
    `${city.setbacks.length} setbacks, ${city.plant.length} plant rooms, ${city.masts.length} masts`
);

check(city.shafts.length > 200, `only ${city.shafts.length} buildings in the city`);
check(
  city.parapets.length === city.shafts.length,
  `${city.parapets.length} parapets for ${city.shafts.length} shafts — some roofs just stop`
);
check(
  city.setbacks.length > 10,
  `only ${city.setbacks.length} buildings step in as they rise — the skyline is a bar chart`
);
check(city.plant.length > 40, `only ${city.plant.length} roofs carry any plant`);
// Without the map every check below silently measures nothing.
check(
  city.parapets.every((p) => p.owner !== undefined),
  "the roof pieces carry no owner map — nothing below is actually being checked"
);

// Which shaft a roof piece belongs to.
//
// Read from the builder, not guessed from geometry. Buildings overlap
// each other's footprints, so both obvious guesses are wrong often
// enough to matter: "nearest centre" reported a plant room hanging off a
// roof it was sitting in the middle of, and "whose bounds contain it"
// reported a parapet floating 0.286 m above its own roof because a
// slightly taller neighbour also contained it. The builder knows, so it
// publishes ownerOf and this reads it.
const nearest = (piece, list) => (piece.owner === undefined ? null : { s: list[piece.owner] });

let worstGap = 0;
let worstGapWhat = "";
let hanging = 0;
for (const p of city.parapets) {
  const n = nearest(p, city.shafts);
  if (!n) continue;
  // A parapet sits ON the roof: its base is the shaft's top.
  const gap = Math.abs(p.minY - n.s.maxY);
  if (gap > worstGap) { worstGap = gap; worstGapWhat = "parapet"; }
}
for (const s of city.setbacks) {
  const n = nearest(s, city.shafts);
  if (!n) continue;
  const gap = Math.abs(s.minY - (n.s.maxY + 0.9));
  if (gap > worstGap) { worstGap = gap; worstGapWhat = "setback"; }
  // And it has to be narrower than what holds it up.
  if (s.w >= n.s.w || s.d >= n.s.d) hanging++;
}
console.log(
  `seated    ${check(
    worstGap < 0.05,
    `a ${worstGapWhat} sits ${worstGap.toFixed(3)} m off its roof — it floats or it sinks`
  )}  worst join ${worstGap.toFixed(3)} m`
);
console.log(
  `inside    ${check(
    hanging === 0,
    `${hanging} setback(s) are wider than the shaft under them — they overhang into thin air`
  )}  every setback narrower than its shaft`
);

// Plant belongs on a roof, within the parapet, not off the side.
let offRoof = 0;
for (const p of city.plant) {
  const n = nearest(p, city.shafts);
  if (!n) continue;
  const s = n.s;
  const dx = Math.abs(p.cx - s.cx) + p.w / 2;
  const dz = Math.abs(p.cz - s.cz) + p.d / 2;
  if (dx > s.w / 2 + 0.4 || dz > s.d / 2 + 0.4) offRoof++;
}
console.log(
  `plant     ${check(
    offRoof === 0,
    `${offRoof} plant room(s) hang off the edge of their roof`
  )}  all ${city.plant.length} within their own footprint`
);

// The skyline has to have a range of heights AND a range of shapes.
const tops = city.shafts.map((s) => s.maxY);
const spread = Math.max(...tops) - Math.min(...tops);
const withRoof = new Set();
for (const list of [city.setbacks, city.plant, city.masts]) {
  for (const p of list) {
    const n = nearest(p, city.shafts);
    if (n) withRoof.add(`${n.s.cx},${n.s.cz}`);
  }
}
const dressed = (withRoof.size / city.shafts.length) * 100;
console.log(
  `variety   ${check(
    spread > 60 && dressed > 45,
    spread <= 60
      ? `the tallest is only ${spread.toFixed(0)} m over the shortest`
      : `only ${dressed.toFixed(0)}% of roofs carry anything at all`
  )}  ${Math.min(...tops).toFixed(0)}-${Math.max(...tops).toFixed(0)} m tall, ` +
    `${dressed.toFixed(0)}% of roofs dressed`
);

// --- glass --------------------------------------------------------------
//
// The glazed facades carry a painted roughness map: concrete #dadada,
// frame #8a8a8a, pane #1f1f1f. Two things have to be true for those
// grey levels to be the roughness they are painted as:
//
//   data      the map is read raw (NoColorSpace). Tagged sRGB like the
//             facade it was gamma-decoded first, and the 0.12 pane
//             rendered at about 0.014 — a mirror.
//   own       each building's concrete lands on its own value:
//             roughness x 0xda/255 = 0.8 for the city blocks, 0.5 for the
//             Liberation disc, 0.4 for Al Hamra. glazedMat took those
//             values for months and ignored them.
const glass = await page.evaluate(() => {
  const e = window.__grnEngine;
  let root = e.world.moonLight;
  while (root.parent) root = root.parent;
  const out = [];
  const seen = new Set();
  root.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m) || !m.roughnessMap || !m.emissiveMap) continue;
      seen.add(m);
      let q = o, who = "blocks";
      while (q) {
        if (q.name === "liberationTower") who = "liberation";
        if (q.name === "alHamraTower") who = "alHamra";
        q = q.parent;
      }
      out.push({
        who,
        rough: m.roughnessMap.colorSpace,
        facade: m.map?.colorSpace,
        concrete: +(m.roughness * (0xda / 255)).toFixed(3),
      });
    }
  });
  return out;
});
const WANT = { blocks: 0.8, liberation: 0.5, alHamra: 0.4 };
for (const g of glass) {
  console.log(
    `glass     ${check(g.rough !== "srgb", `${g.who}: the roughness map is decoded as ${g.rough}, not read as data`)} ` +
      `${check(g.facade === "srgb", `${g.who}: the facade colour is ${g.facade}, want srgb`)} ` +
      `${check(Math.abs(g.concrete - WANT[g.who]) < 0.005, `${g.who}: concrete roughness ${g.concrete}, want ${WANT[g.who]}`)}  ` +
      `${g.who.padEnd(10)} map ${g.rough || "raw"}, concrete ${g.concrete}`
  );
}
check(
  ["blocks", "liberation", "alHamra"].every((w) => glass.some((g) => g.who === w)),
  `glazed materials found for ${[...new Set(glass.map((g) => g.who))].join(", ")} — expected blocks, liberation and alHamra`
);

// --- masonry --------------------------------------------------------------
//
// The wall between the windows is one of four masonry layers — buff
// brick, ochre limestone, white render, formed concrete — chosen per
// building (masonry.ts, facadeSkin.ts). tests/masonry.mjs measures the
// textures and the splice in Node; this checks the live city wears them:
//
//   maps      two 384x384x4 array textures, sRGB colour and raw data,
//             Linear magnification (so anisotropy applies) and trilinear
//   wearing   blocks, setbacks, podiums and drums share one material and
//             each carries a per-instance grnMasonry (family, seed)
//   variety   at least three families on the blocks, none over 60%
//   one       a setback and a podium wear their own shaft's masonry
//   drums     the drum's side u spans its perimeter (3.06 diameters),
//             so its windows are no longer stretched 3x sideways
//   compiled  the facade program built, and nothing logged a shader error
const maso = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const find = (name) => {
    let hit = null;
    e.scene.traverse((o) => {
      if (o.name === name) hit = o;
    });
    return hit;
  };
  const names = ["cityBlocks", "citySetbacks", "cityPodiums", "cityDrums"];
  const meshes = names.map(find);
  const mat0 = meshes[0]?.material;
  const out = { meshes: [], maps: null, drumU: null, programs: [], broken: [] };
  meshes.forEach((m, k) => {
    const a = m?.geometry.getAttribute("grnMasonry");
    const fam = [];
    if (a) for (let i = 0; i < m.count; i++) fam.push([a.getX(i), a.getY(i)]);
    out.meshes.push({
      name: names[k],
      found: !!m,
      count: m?.count ?? 0,
      attr: a ? a.count : 0,
      instanced: !!a?.isInstancedBufferAttribute,
      sameMat: !!m && m.material === mat0,
      fam,
      owner: m?.userData.ownerOf ?? null,
    });
  });
  const u = mat0?.userData.grnMasonry;
  if (u) {
    const tex = (t) => ({
      isArray: !!t.isDataArrayTexture,
      w: t.image.width, h: t.image.height, d: t.image.depth,
      cs: t.colorSpace,
      linearMag: t.magFilter === THREE.LinearFilter,
      trilinear: t.minFilter === THREE.LinearMipmapLinearFilter && t.generateMipmaps,
      aniso: t.anisotropy,
    });
    out.maps = { albedo: tex(u.albedo), normal: tex(u.normal), gain: u.uniforms.grnGain.value };
  }
  const drums = meshes[3];
  if (drums) {
    const uv = drums.geometry.getAttribute("uv"), n = drums.geometry.getAttribute("normal");
    let max = 0;
    for (let i = 0; i < uv.count; i++) if (Math.abs(n.getY(i)) < 0.5) max = Math.max(max, uv.getX(i));
    out.drumU = max;
  }
  for (const p of e.renderer.info.programs ?? []) {
    if (!String(p.cacheKey).includes("grn-facade-masonry")) continue;
    out.programs.push(p.name);
    if (p.diagnostics && p.diagnostics.runnable === false) out.broken.push(p.name);
  }
  return out;
});

{
  const m = maso.maps;
  const bad = [];
  if (!m) bad.push("the city material carries no userData.grnMasonry");
  else {
    for (const [k, t, cs] of [["albedo", m.albedo, "srgb"], ["normal", m.normal, ""]]) {
      if (!t.isArray || t.d !== 4 || t.w !== 384 || t.h !== 384) bad.push(`${k} is not a 384x384x4 array texture`);
      if (t.cs !== cs) bad.push(`${k} colour space ${t.cs || "none"}, want ${cs || "none"}`);
      if (!t.linearMag) bad.push(`${k} magFilter is not Linear — anisotropy would never apply`);
      if (!t.trilinear) bad.push(`${k} is not trilinear with mips`);
      if (t.aniso < 8) bad.push(`${k} anisotropy ${t.aniso}`);
    }
  }
  console.log(
    `maps      ${check(bad.length === 0, bad.join("; "))}  two 384x384x4 masonry arrays, sRGB + data, Linear/trilinear` +
      (m ? `, gain ${m.gain}` : "")
  );
}
{
  const bad = maso.meshes
    .filter((x) => !x.found || !x.instanced || x.attr < x.count || !x.sameMat)
    .map((x) => `${x.name}${!x.found ? " missing" : !x.instanced ? " has no instanced grnMasonry" : x.attr < x.count ? ` has ${x.attr} masonry entries for ${x.count} instances` : " wears a different material"}`);
  console.log(
    `wearing   ${check(bad.length === 0, bad.join("; "))}  ` +
      maso.meshes.map((x) => `${x.name} ${x.count}`).join(", ") + " — one material, per-instance masonry"
  );
}
{
  const blocks = maso.meshes[0];
  const counts = [0, 0, 0, 0];
  for (const [f] of blocks.fam) counts[Math.round(f)]++;
  const share = counts.map((c) => c / Math.max(1, blocks.fam.length));
  const used = share.filter((s) => s > 0).length;
  console.log(
    `variety   ${check(used >= 3 && Math.max(...share) <= 0.6, `blocks wear ${used} families, the commonest on ${(Math.max(...share) * 100).toFixed(0)}%`)}  ` +
      `brick/stone/render/formwork on ${share.map((s) => (s * 100).toFixed(0) + "%").join(" / ")} of ${blocks.fam.length} blocks`
  );
  let mismatched = 0, n = 0;
  for (const piece of [maso.meshes[1], maso.meshes[2]]) {
    if (!piece.owner) { mismatched++; continue; }
    piece.fam.forEach(([f, s], i) => {
      n++;
      const o = blocks.fam[piece.owner[i]];
      if (!o || o[0] !== f || o[1] !== s) mismatched++;
    });
  }
  console.log(
    `one       ${check(mismatched === 0 && n > 0, `${mismatched} setback/podium instance(s) wear a different masonry from their shaft`)}  ` +
      `all ${n} setbacks and podiums wear their own shaft's masonry`
  );
}
console.log(
  `drums     ${check(maso.drumU !== null && Math.abs(maso.drumU - 3.0615) < 0.01, `drum side u spans ${maso.drumU}, want 3.06 (8 sin(pi/8))`)}  ` +
    `drum side u spans ${maso.drumU?.toFixed(4)} diameters`
);
console.log(
  `compiled  ${check(maso.programs.length > 0 && maso.broken.length === 0 && shaderErrors.length === 0,
    maso.programs.length === 0
      ? "no compiled program carries the grn-facade-masonry cache key"
      : `facade program broken (${maso.broken.join(", ")}) or shader errors logged: ${shaderErrors.join(" | ")}`)}  ` +
    `${maso.programs.length} facade program(s) compiled clean`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe buildings are built like buildings.");
