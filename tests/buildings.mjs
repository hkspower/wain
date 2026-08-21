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

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe buildings are built like buildings.");
