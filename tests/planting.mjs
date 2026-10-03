// The roadside planting, held to the one law that matters.
//
//   npm run dev            # in another shell
//   npm run test:planting
//
// A shrub bed is decoration and almost nothing about it can be got
// wrong in a way that matters — except where it stands. This file
// already carries the scar: a city band drawn at ROAD_HALF_WIDTH + 4,
// a constant, put a tower block on the Sharq drift plaza, measured at
// lat 18.02 against the road's own half-width of 18.00 at that point.
// The road swells from 7 m to 19 m there and by 10 m at each petrol
// forecourt, so anything positioned from the constant is correct for
// most of the lap and inside the carriageway for the rest of it.
//
// That bug took a seeded world to become reproducible at all. A bed
// planted on the racing line is the same bug with leaves on, and it
// would be invisible in a screenshot of any other kilometre.
//
// So: THE LAW IS THAT NO PLANT STANDS ON THE ROAD. Not "the lateral
// constant is 2.3" — that is the engine's arithmetic, and a test that
// restates it passes whatever the arithmetic does. The road's own
// halfWidthAt is the authority, and every plant is measured against the
// width at ITS OWN point on the lap.
//
// AND THAT IT CAN BE SEEN. The first build placed 1,315 plants
// correctly, passed every rule above, and was invisible: they were 0.19
// to 0.77 m tall and the guardrail they stand behind crests at 0.776 m,
// so the chase camera saw a barrier and nothing else. That is 105,000
// triangles of scenery nobody can look at. The rail's height is read
// off the rail in the scene rather than copied from the constant that
// built it, so the two cannot drift apart.
//
// The centreline is inverted by brute force — sample the track, take
// the nearest sample to each plant — because Track has no inverse
// projection and a test is not the place to invent one.
//
// AND THAT WHAT STANDS THERE IS A PLANT, NOT A PILE OF SHARDS. The same
// build that passed every rule above rendered as torn green glass: the
// shapes were unwelded icosahedra whose corners came apart, and nothing
// here looked at a shape. The shapes are measured properly under node
// (npm run test:shrubs); this checks that what the scene actually holds
// is welded and coloured, that the whole verge fits its triangle
// budget, and that every FOOTPRINT — not just every centre — is behind
// the rail, out of the street mouths, and off the furniture that shares
// the verge with it, read off that furniture where it stands.

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium; set CHROME_PATH"); process.exit(2); }

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); return ok ? "ok" : "FAIL"; };

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 700, height: 460 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });

const r = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  e.setPaused(true);
  const track = e.track;
  const L = track.length;

  // Sample the centreline once. 2 m is finer than the planting spacing,
  // so the nearest sample is never a lap away from the true foot of the
  // perpendicular.
  const STEP = 2;
  const N = Math.floor(L / STEP);
  const cx = new Float64Array(N), cz = new Float64Array(N), cs = new Float64Array(N);
  const p = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const s = i * STEP;
    track.pose(s, 0, p, tmp);
    cx[i] = p.x; cz[i] = p.z; cs[i] = s;
  }

  const TUN = window.__grnLap.tunnel;
  const meshes = [];
  let railTop = -Infinity;
  let streets = null;
  // The verge's furniture, read where it stands: (x, z, r) per item, with
  // r the same radius world.ts vergeFurniture steps round.
  const furniture = [];
  const wp = new THREE.Vector3();
  const addAt = (o, name, r) => { o.getWorldPosition(wp); furniture.push({ name, x: wp.x, z: wp.z, r }); };
  let palmTrunks = null;
  e.scene.updateMatrixWorld(true);
  e.scene.traverse((o) => {
    if (o.isInstancedMesh && o.name === "planting") meshes.push(o);
    // How high the barrier actually stands, measured on the barrier.
    if (o.isMesh && o.name === "guardrail") {
      o.geometry.computeBoundingBox();
      railTop = Math.max(railTop, o.geometry.boundingBox.max.y);
    }
    if (o.isMesh && o.name === "streets") streets = o;
    if (o.name === "racers" || o.name === "spectators") for (const c of o.children) addAt(c, o.name, 0.6);
    if (o.name === "love-street-sign") addAt(o, o.name, 0.14);
    if (o.name === "plaza-floodlight") addAt(o, o.name, 0.4);
    if (o.name === "flag-mast") {
      const pole = o.children.find((c) => c.geometry?.parameters?.radiusBottom);
      addAt(o, o.name, pole ? pole.geometry.parameters.radiusBottom : 0.18);
    }
    // The chevron boards, not the braking rubber that shares their group.
    if (o.name === "bend-chevrons") for (const c of o.children) if (c.isGroup) addAt(c, "chevron", 0.8);
    // The palm change set names the trunks; until it lands there is no
    // name to find them by, and the check says so rather than passing.
    if (o.isInstancedMesh && o.name === "palm-trunks") palmTrunks = o;
  });
  if (palmTrunks) {
    const pm = new THREE.Matrix4();
    for (let i = 0; i < palmTrunks.count; i++) {
      palmTrunks.getMatrixAt(i, pm);
      wp.setFromMatrixPosition(pm);
      furniture.push({ name: "palm-trunks", x: wp.x, z: wp.z, r: 0.36 });
    }
  }

  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const out = {
    meshes: meshes.length,
    total: 0,
    onRoad: [],          // plants standing inside the carriageway
    inTunnel: 0,
    seaSide: 0,
    seaWhere: [],
    minClear: Infinity,  // smallest gap between a plant and the tarmac edge
    bothSidesPastCoast: { left: 0, right: 0 },
    tris: 0,
    lapLength: L,
    railTop: railTop === -Infinity ? null : +railTop.toFixed(3),
    heights: [],
    // The shapes, the budget, the footprints.
    unwelded: [],        // planting geometries that are not indexed or carry no colour
    minCorner: Infinity, // smallest gap between a footprint corner and the tarmac edge
    cornerBad: [], cornerBadN: 0,
    onStreet: [],        // instances whose foot is on the street network
    streetsFound: !!streets,
    furnitureN: furniture.length,
    furnitureBy: {},
    nearFurniture: [], nearFurnitureN: 0, // footprints within r + 0.25 of something standing on the verge
    palmTrunksNamed: !!palmTrunks,
  };
  for (const f of furniture) out.furnitureBy[f.name] = (out.furnitureBy[f.name] ?? 0) + 1;
  if (!meshes.length) return out;

  const scl = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const loc = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  ray.far = 6;
  const downDir = new THREE.Vector3(0, -1, 0);
  const rayFrom = new THREE.Vector3();
  const hits = [];
  for (const im of meshes) {
    const g = im.geometry;
    g.computeBoundingBox();
    const gb = g.boundingBox;
    const gTop = gb.max.y;
    if (!g.index || !g.getAttribute("color")) out.unwelded.push({ verts: g.attributes.position.count, indexed: !!g.index, colour: !!g.getAttribute("color") });
    out.tris += ((g.index?.count ?? g.attributes.position.count) / 3) * im.count;
    // The footprint in the shape's own frame: a disc for the round
    // plantings (shrubs.ts holds them inside one, so a random yaw cannot
    // swing a lobe out of it), the box for a hedge.
    const gp = g.attributes.position;
    let rFoot = 0;
    for (let k = 0; k < gp.count; k++) rFoot = Math.max(rFoot, Math.hypot(gp.getX(k), gp.getZ(k)));
    const round = rFoot <= 0.5 + 1e-3;
    const gcx = (gb.min.x + gb.max.x) / 2, gcz = (gb.min.z + gb.max.z) / 2;
    const ghx = (gb.max.x - gb.min.x) / 2, ghz = (gb.max.z - gb.min.z) / 2;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);
      scl.setFromMatrixScale(m);
      // The ABSOLUTE top. The plants stand on the city floor now, a few
      // centimetres below CITY_GROUND_Y rather than on the road's plane
      // at y = 0 (where they floated 80 mm over the ground), so their
      // own height overstates how far they reach above the rail.
      out.heights.push(v.y + gTop * scl.y);
      out.total++;
      // Nearest centreline sample.
      let best = -1, bd = Infinity;
      for (let k = 0; k < N; k++) {
        const dx = cx[k] - v.x, dz = cz[k] - v.z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = k; }
      }
      const s = cs[best];
      const dist = Math.sqrt(bd);
      const half = track.halfWidthAt(s);
      const clear = dist - half;
      if (clear < out.minClear) out.minClear = clear;
      if (clear < 0) out.onRoad.push({ s: +s.toFixed(0), dist: +dist.toFixed(2), half: +half.toFixed(2) });

      // Which side: sign of the lateral against the track's own side
      // vector, so "left" means what the track means by it.
      track.pose(s, 0, p, tmp);
      track.sideAt(s, tmp);
      const lat = (v.x - p.x) * tmp.x + (v.z - p.z) * tmp.z;
      if (s < window.__grnCoastEndM && lat < 0) {
        out.seaSide++;
        // Say WHERE. A count tells you a rule is broken; the metre mark
        // tells you which rule, and the lap is a loop with two seams.
        if (out.seaWhere.length < 5) out.seaWhere.push({ s: +s.toFixed(0), lat: +lat.toFixed(2) });
      }
      if (s >= window.__grnCoastEndM) {
        if (lat < 0) out.bothSidesPastCoast.left++;
        else out.bothSidesPastCoast.right++;
      }
      // The road's own tunnel span, not a copy of its metre marks.
      if (s > TUN.from && s < TUN.to) out.inTunnel++;

      // THE FOOTPRINT, corner by corner, against the width at each
      // corner's own s. A centre 2.5 m out says nothing about the end of
      // a 3 m hedge segment on a widening ramp.
      const sideSign = lat < 0 ? -1 : 1;
      for (const lx of [gb.min.x, gb.max.x]) {
        for (const lz of [gb.min.z, gb.max.z]) {
          corner.set(lx, 0, lz).applyMatrix4(m);
          let cb = best, cd = Infinity;
          for (let k = Math.max(0, best - 4); k <= Math.min(N - 1, best + 4); k++) {
            const dx = cx[k] - corner.x, dz = cz[k] - corner.z;
            const d = dx * dx + dz * dz;
            if (d < cd) { cd = d; cb = k; }
          }
          // Refine off the nearest sample along the tangent: 2 m samples
          // are too coarse to read a half-width on a forecourt ramp.
          track.tangentAt(cs[cb], tmp);
          const sc = cs[cb] + (corner.x - cx[cb]) * tmp.x + (corner.z - cz[cb]) * tmp.z;
          track.pose(sc, 0, p, tmp);
          track.sideAt(sc, tmp);
          const latC = (corner.x - p.x) * tmp.x + (corner.z - p.z) * tmp.z;
          const clearC = sideSign * latC - track.halfWidthAt(sc);
          if (clearC < out.minCorner) out.minCorner = clearC;
          if (clearC < 1.2 && out.cornerBadN++ < 5) out.cornerBad.push({ s: +sc.toFixed(1), clear: +clearC.toFixed(2) });
        }
      }

      // Not on the street network: a ray down through the plant's foot
      // must not land on the merged 'streets' mesh. The old layout put
      // 109-126 plants on cross-street pavement.
      if (streets) {
        rayFrom.set(v.x, 3, v.z);
        ray.set(rayFrom, downDir);
        hits.length = 0;
        streets.raycast(ray, hits);
        if (hits.length && out.onStreet.length < 5) out.onStreet.push({ s: +s.toFixed(1), lat: +lat.toFixed(2) });
        else if (hits.length) out.onStreet.push(null);
      }

      // Off the furniture: the distance from each item's foot to the
      // plant's footprint, at least the item's radius plus 0.25 (the beds
      // keep r + 0.3; the slack is for road space against world space).
      // A round plant's footprint lies inside a circle of rFoot × its
      // larger scale; a hedge's is its box, measured in its own frame.
      let invReady = false;
      for (const f of furniture) {
        const dx = f.x - v.x, dz = f.z - v.z;
        if (dx * dx + dz * dz > 36) continue;
        let gap;
        if (round) {
          gap = Math.max(0, Math.hypot(dx, dz) - rFoot * Math.max(scl.x, scl.z));
        } else {
          if (!invReady) { inv.copy(m).invert(); invReady = true; }
          loc.set(f.x, v.y, f.z).applyMatrix4(inv);
          const ex = Math.max(0, Math.abs(loc.x - gcx) - ghx) * scl.x;
          const ez = Math.max(0, Math.abs(loc.z - gcz) - ghz) * scl.z;
          gap = Math.hypot(ex, ez);
        }
        if (gap < f.r + 0.25 && out.nearFurnitureN++ < 8) {
          out.nearFurniture.push({ what: f.name, s: +s.toFixed(1), lat: +lat.toFixed(2), gap: +gap.toFixed(2) });
        }
      }
    }
  }
  out.onStreetN = out.onStreet.length;
  out.onStreet = out.onStreet.filter(Boolean);
  out.minCorner = +out.minCorner.toFixed(2);
  out.minClear = +out.minClear.toFixed(2);
  out.heights.sort((a, b) => a - b);
  const q = (f) => +out.heights[Math.floor(f * (out.heights.length - 1))].toFixed(2);
  out.h = { p05: q(0.05), p50: q(0.5), p95: q(0.95) };
  out.belowRail = out.railTop === null ? null
    : out.heights.filter((x) => x < out.railTop).length;
  delete out.heights;
  return out;
});
await browser.close();

console.log("\n=== ROADSIDE PLANTING ===");
console.log(`  ${r.total} plants in ${r.meshes} instanced meshes, ${Math.round(r.tris)} triangles`);
console.log(`  planted      ${check(r.total > 200, `only ${r.total} plants on an 8 km lap — the verge is still bare`)}`);
console.log(`  silhouettes  ${check(r.meshes >= 2, `${r.meshes} shape(s): one repeated geometry reads as wallpaper down a straight`)}`);
// THE ONE THAT MATTERS.
console.log(`  off the road ${check(r.onRoad.length === 0,
  `${r.onRoad.length} plant(s) stand inside the carriageway, e.g. ` +
  (r.onRoad[0] ? `s=${r.onRoad[0].s} at ${r.onRoad[0].dist} m from the centre where the road is ${r.onRoad[0].half} m wide` : ""))}`);
// The bar stays at 1.6 m for a plant's CENTRE. The rail itself stands at
// halfWidthAt + 0.6 to + 0.683 (world.ts, the guardrail and W_BEAM);
// this message used to say 1.2 to 1.6, which is where it stood before
// it was moved, and the footprint check below holds the plants' actual
// edges to + 1.2.
console.log(`  clearance    nearest plant sits ${r.minClear} m outside the tarmac  ` +
  check(r.minClear >= 1.6, `a plant's centre is ${r.minClear} m from the edge — its foliage reaches the rail, which stands at halfWidthAt + 0.6 to + 0.683`));
console.log(`  not in the tunnel ${check(r.inTunnel === 0, `${r.inTunnel} plant(s) growing inside the Hawally tunnel`)}`);
console.log(`  not in the sea    ${check(r.seaSide === 0, `${r.seaSide} plant(s) on the seaward side of the corniche` + (r.seaWhere?.length ? ` — at ${r.seaWhere.map((w) => `s=${w.s} lat=${w.lat}`).join(", ")} (lap is ${Math.round(r.lapLength)} m)` : ""))}`);
console.log(`  both verges past the coast: ${r.bothSidesPastCoast.left} left, ${r.bothSidesPastCoast.right} right  ` +
  check(r.bothSidesPastCoast.left > 20 && r.bothSidesPastCoast.right > 20,
    "the ring is planted on one side only"));

console.log(`  barrier crests at ${r.railTop} m; plant tops at ${r.h.p05} / ${r.h.p50} / ${r.h.p95} m (p5/p50/p95, absolute)`);
console.log(`  visible over the rail ${check(r.belowRail === 0,
  `${r.belowRail} of ${r.total} plants top out below the ${r.railTop} m barrier they stand behind — ` +
  `placed correctly and invisible from the road`)}`);

// --- The shapes, the budget, the footprints.
console.log(`  welded and coloured ${check(r.unwelded.length === 0,
  `${r.unwelded.length} planting geometr${r.unwelded.length === 1 ? "y is" : "ies are"} not indexed or carry no colour — ` +
  `the torn-shard build: ${JSON.stringify(r.unwelded)}`)}`);
// The design's culling pass (one mesh per kind per lap chunk, culled by
// pixel size) is not built yet; until it is, every planting mesh's
// bounding sphere is the whole lap and these are the resident numbers.
console.log(`  budget       ${Math.round(r.tris)} triangles in ${r.meshes} meshes  ` +
  check(r.tris <= 520000 && r.meshes <= 48, `planting over budget: ${Math.round(r.tris)} triangles (max 520k) in ${r.meshes} meshes (max 48)`));
console.log(`  footprints   every corner at least ${r.minCorner} m outside the tarmac  ` +
  check(r.cornerBadN === 0, `${r.cornerBadN} footprint corner(s) inside halfWidthAt + 1.2, e.g. ` +
    r.cornerBad.map((c) => `s=${c.s} at ${c.clear} m`).join(", ")));
console.log(`  street mouths ${r.streetsFound ? check(r.onStreetN === 0,
  `${r.onStreetN} plant(s) stand on the street network, e.g. ${r.onStreet.map((w) => `s=${w.s} lat=${w.lat}`).join(", ")}`)
  : check(false, "no mesh named 'streets' — the street-mouth check is measuring nothing")}`);
console.log(`  furniture    ${r.furnitureN} items (${Object.entries(r.furnitureBy).map(([k, n]) => `${n} ${k}`).join(", ")})  ` +
  check(r.nearFurnitureN === 0, `${r.nearFurnitureN} plant footprint(s) on the verge's furniture, e.g. ` +
    r.nearFurniture.map((f) => `${f.what} at s=${f.s} lat=${f.lat} (${f.gap} m)`).join(", ")));
if (!r.palmTrunksNamed) {
  console.log("  palm trunks  not checked: no InstancedMesh named 'palm-trunks' (the palm change set names it)");
}

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length > 1 ? "s" : ""}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nevery plant is off the road, clear of the barrier, out of the tunnel and the street mouths, and off the furniture.");
