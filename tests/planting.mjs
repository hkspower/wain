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

  const meshes = [];
  let railTop = -Infinity;
  e.scene.traverse((o) => {
    if (o.isInstancedMesh && o.name === "planting") meshes.push(o);
    // How high the barrier actually stands, measured on the barrier.
    if (o.isMesh && o.name === "guardrail") {
      o.geometry.computeBoundingBox();
      railTop = Math.max(railTop, o.geometry.boundingBox.max.y);
    }
  });

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
  };
  if (!meshes.length) return out;

  const scl = new THREE.Vector3();
  for (const im of meshes) {
    const g = im.geometry;
    g.computeBoundingBox();
    const gTop = g.boundingBox.max.y;
    out.tris += ((g.index?.count ?? g.attributes.position.count) / 3) * im.count;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      v.setFromMatrixPosition(m);
      scl.setFromMatrixScale(m);
      out.heights.push(gTop * scl.y);
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
      if (s > 4855 && s < 5145) out.inTunnel++;
    }
  }
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
console.log(`  clearance    nearest plant sits ${r.minClear} m outside the tarmac  ` +
  check(r.minClear >= 1.6, `a plant is ${r.minClear} m from the edge — inside the barrier line, which stands at 1.2 to 1.6 m`));
console.log(`  not in the tunnel ${check(r.inTunnel === 0, `${r.inTunnel} plant(s) growing inside the Hawally tunnel`)}`);
console.log(`  not in the sea    ${check(r.seaSide === 0, `${r.seaSide} plant(s) on the seaward side of the corniche` + (r.seaWhere?.length ? ` — at ${r.seaWhere.map((w) => `s=${w.s} lat=${w.lat}`).join(", ")} (lap is ${Math.round(r.lapLength)} m)` : ""))}`);
console.log(`  both verges past the coast: ${r.bothSidesPastCoast.left} left, ${r.bothSidesPastCoast.right} right  ` +
  check(r.bothSidesPastCoast.left > 20 && r.bothSidesPastCoast.right > 20,
    "the ring is planted on one side only"));

console.log(`  barrier crests at ${r.railTop} m; plants stand ${r.h.p05} / ${r.h.p50} / ${r.h.p95} m (p5/p50/p95)`);
console.log(`  visible over the rail ${check(r.belowRail === 0,
  `${r.belowRail} of ${r.total} plants are shorter than the ${r.railTop} m barrier they stand behind — ` +
  `placed correctly and invisible from the road`)}`);

if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length > 1 ? "s" : ""}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nevery plant is off the road, clear of the barrier, and out of the tunnel.");
