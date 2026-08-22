// What is actually on every car, and what is missing from one of them.
//
//   npm run dev
//   node tools/shots/fleet.mjs
//
// A design miss is invisible on the car that has it. Nothing errors, the
// car still drives, and the only way to notice that one silhouette never
// got its side markers is to look at all five and count — which nobody
// does, because looking at a car tells you what IS there and says
// nothing at all about what is not.
//
// So this counts. Every car in the showroom is built and its meshes are
// grouped by the material they wear, which is how this build already
// distinguishes a lamp lens from a panel gap. Then the fleet is compared
// against itself: a part class that fourteen cars carry and one does not
// is a design miss, and a part class NO car carries is a note about the
// build rather than about a car.
//
// It also checks the things that are wrong on a car rather than absent
// from it: parts hanging in space off their panel, parts buried inside
// one, and anything solid sitting where a wheel has to turn.

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
if (!exe) { console.error("no chromium"); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
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
await page.waitForFunction(() => !!window.__grnBuildCar, null, { timeout: 240000 });
await page.waitForTimeout(1500);

const fleet = await page.evaluate(async () => {
  const THREE = window.__grnThree;
  const res = await fetch("/api/grn/v1/cars").then((r) => r.json()).catch(() => null);
  const list = res?.cars ?? res ?? [];
  const out = [];
  for (const car of list) {
    const g = window.__grnBuildCar({
      body: parseInt(String(car.color).replace("#", ""), 16),
      accent: 0x007a3d,
      style: car.bodyStyle ?? "sedan",
      raceKit: car.kit === "attack",
      // The kit, not just "is it the top kit". Passing only raceKit
      // built every sport-band car as a street one, so this audit spent
      // its time counting the parts of a car the game does not contain:
      // four machines came back with 143 meshes where the road gives
      // them a wing, a splitter, skirts and twenty-eight rivets.
      kit: car.kit,
      lengthM: car.lengthM,
      spoiler: false,
      // Not bought — but the sport and attack kits come wearing a livery
      // of their own, which is the state the showroom sells them in.
      stickers: false,
    });
    g.updateMatrixWorld(true);

    /** Meshes grouped by the material they wear. */
    const parts = {};
    const boxes = [];
    g.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const key = m?.name || `unnamed:${m?.type ?? "?"}`;
      parts[key] = (parts[key] ?? 0) + 1;
      if (o.userData.noShadow) return;
      const bb = new THREE.Box3().setFromObject(o);
      boxes.push({ key, name: o.name || "", bb, o });
    });

    // The wheels, as the volume each one sweeps: a cylinder about the
    // axle. Anything solid inside it is something the wheel turns through.
    const wheels = (g.userData.wheels ?? []).map((w) => {
      const bb = new THREE.Box3().setFromObject(w);
      return {
        c: bb.getCenter(new THREE.Vector3()),
        r: Math.max(bb.max.y - bb.min.y, bb.max.z - bb.min.z) / 2,
        halfX: (bb.max.x - bb.min.x) / 2,
      };
    });
    let inWheel = 0;
    const inWheelWhat = new Set();
    for (const b of boxes) {
      // The wheel's own parts, the arch it turns inside, and the
      // suspension are all supposed to be there.
      if (/rim|disc|caliper|tire|arch-well|unnamed/.test(b.key)) continue;
      // The arch parts wrap the wheel by design, and this test judges a
      // part by its bounding-box CENTRE — so an arc that hoops over a
      // tyre has its centroid near the axle whatever it is doing. The
      // lip and the well were already exempt for that reason; the flare
      // is the same shape doing the same job and was only passing before
      // because the arch sat 165 mm too high, which put its centroid
      // outside the disc by accident.
      if (b.o.userData.archLip || b.o.userData.archWell || b.o.userData.archFlare) continue;
      const c = b.bb.getCenter(new THREE.Vector3());
      for (const w of wheels) {
        const dy = c.y - w.c.y;
        const dz = c.z - w.c.z;
        const dx = Math.abs(c.x - w.c.x);
        // Inside the disc the wheel sweeps, and across its tread.
        if (Math.hypot(dy, dz) < w.r * 0.75 && dx < w.halfX * 0.8) {
          inWheel++;
          inWheelWhat.add(b.key);
        }
      }
    }

    // The car's own extent, measured the way the length fit measures it:
    // solid shadow-casting bodywork only. setFromObject on the group
    // includes the headlight halo sprites — which are camera-facing
    // billboards a metre and a half across — and the contact shadow,
    // which is a transparent plane wider than the car. With those in, a
    // 4.53 m car reports 5.02 and the column is worse than useless.
    const box = new THREE.Box3();
    for (const b of boxes) {
      const m = Array.isArray(b.o.material) ? b.o.material[0] : b.o.material;
      if (m && (m.transparent || (m.opacity ?? 1) < 1)) continue;
      box.union(b.bb);
    }
    out.push({
      id: car.id,
      name: car.name,
      style: car.bodyStyle ?? "sedan",
      kit: car.kit,
      parts,
      style: car.bodyStyle ?? "sedan",
      kit: car.kit,
      color: String(car.color).toLowerCase(),
      finish: car.finish ?? "gloss",
      meshes: boxes.length,
      wheels: wheels.length,
      exhaustTips: (g.userData.exhaustTips ?? []).length,
      tailGlows: (g.userData.tailGlowMats ?? []).length,
      headGlows: (g.userData.headGlowMats ?? []).length,
      lampPositions: (g.userData.lampPositions ?? []).length,
      driver: !!g.userData.driver,
      driverParts: g.userData.driver
        ? ["head", "arms", "legs", "wheel", "pedals"].filter((k) => !!g.userData.driver[k]).length
        : 0,
      archWells: boxes.filter((b) => b.o.userData.archWell).length,
      archLips: boxes.filter((b) => b.o.userData.archLip).length,
      inWheel,
      inWheelWhat: [...inWheelWhat],
      size: [
        +(box.max.x - box.min.x).toFixed(2),
        +(box.max.y - box.min.y).toFixed(2),
        +(box.max.z - box.min.z).toFixed(2),
      ],
      // Anything sitting below the road or above a sensible roof line is
      // wrong wherever it is. The floor is -0.25 rather than 0: a wheel
      // arch is a hole in the bodywork and its inner face continues
      // below the contact patch on any real car, so a little under the
      // ground plane is modelling and not a fault. A quarter of a metre
      // under is something falling through the world.
      belowRoad: boxes
        .filter((b) => b.bb.min.y < -0.25)
        .map((b) => `${b.key} at ${b.bb.min.y.toFixed(2)}`),
      tooHigh: boxes.filter((b) => b.bb.min.y > 2.2).map((b) => b.key),
    });
    g.traverse((o) => o.geometry && o.geometry.dispose?.());
  }
  return out;
});

// --- What every car carries, and what one of them does not -------------
const classes = new Map();
for (const c of fleet) {
  for (const k of Object.keys(c.parts)) {
    if (!classes.has(k)) classes.set(k, new Map());
    classes.get(k).set(c.id, c.parts[k]);
  }
}
const total = fleet.length;
const missing = [];
const counts = [];
for (const [k, per] of [...classes].sort()) {
  const have = per.size;
  const vals = [...per.values()];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  counts.push({ k, have, lo, hi });
  if (have < total) {
    missing.push({
      k,
      have,
      without: fleet.filter((c) => !per.has(c.id)).map((c) => `${c.name} (${c.style})`),
    });
  }
}

console.log(`${total} cars built, ${classes.size} distinct part classes\n`);
console.log("part class            on   count");
for (const c of counts) {
  console.log(
    `  ${c.k.padEnd(20)} ${String(c.have).padStart(2)}/${total}  ` +
      `${c.lo === c.hi ? String(c.lo) : `${c.lo}–${c.hi}`}`
  );
}

console.log("\n--- part classes not on every car ---");
if (!missing.length) console.log("  none: every car carries every class.");
for (const m of missing) {
  console.log(`  ${m.k}: on ${m.have}/${total}`);
  for (const w of m.without) console.log(`      missing from ${w}`);
}

// Where a class VARIES is where design lives and where misses hide: a
// silhouette with four round lamps and one with a light bar are both
// right, and a car with one brake caliper is not.
const varies = counts.filter((c) => c.lo !== c.hi || c.have !== total);
console.log("\n--- classes that are not the same on every car ---");
console.log(`  ${"class".padEnd(18)} ${fleet.map((c) => c.name.slice(0, 6).padStart(7)).join("")}`);
for (const v of varies) {
  console.log(
    `  ${v.k.padEnd(18)} ` +
      fleet.map((c) => String(c.parts[v.k] ?? "·").padStart(7)).join("")
  );
}

console.log("\ncar                  meshes  wheels  arches  tips  lamps  glows  driver  size (m)");
for (const c of fleet) {
  console.log(
    `  ${c.name.padEnd(20)} ${String(c.meshes).padStart(5)}  ${String(c.wheels).padStart(6)}  ` +
      `${String(c.archWells).padStart(2)}/${String(c.archLips).padStart(2)}  ` +
      `${String(c.exhaustTips).padStart(4)}  ${String(c.lampPositions).padStart(5)}  ` +
      `${String(c.headGlows).padStart(2)}/${String(c.tailGlows).padStart(2)}  ` +
      `${String(c.driverParts).padStart(6)}  ${c.size.join(" × ")}`
  );
}

const problems = [];
for (const c of fleet) {
  if (c.wheels !== 4) problems.push(`${c.name}: ${c.wheels} wheels`);
  if (c.archWells !== 4 || c.archLips !== 4)
    problems.push(`${c.name}: ${c.archWells} arch wells and ${c.archLips} lips, expected 4 and 4`);
  if (!c.driver || c.driverParts < 5)
    problems.push(`${c.name}: driver has ${c.driverParts} of 5 rigged parts`);
  if (c.exhaustTips < 1) problems.push(`${c.name}: no exhaust tips`);
  if (c.lampPositions < 2) problems.push(`${c.name}: ${c.lampPositions} headlamp positions`);
  if (c.tailGlows < 2) problems.push(`${c.name}: ${c.tailGlows} tail glows`);
  if (c.inWheel) problems.push(`${c.name}: ${c.inWheel} part(s) inside a wheel — ${c.inWheelWhat.join(", ")}`);
  if (c.belowRoad.length) problems.push(`${c.name}: below the road — ${[...new Set(c.belowRoad)].join(", ")}`);
  if (c.tooHigh.length) problems.push(`${c.name}: floating high — ${[...new Set(c.tooHigh)].join(", ")}`);
}
// --- Does every car look like ITSELF?
//
// Sixteen cars share six silhouettes, so the shell alone cannot tell
// them apart — what does is the combination a car leaves the factory
// with: its shape, how far it is built, its colour and its finish. Two
// cars matching on all four are one car sold twice, and the showroom
// ladder stops meaning anything.
//
// A data check rather than a rendered one, deliberately: this is a
// question about what the roster SAYS, and a pixel comparison would
// answer it slower and with more ways to be wrong.
{
  const seen = new Map();
  for (const c of fleet) {
    const key = [c.style ?? "sedan", c.kit ?? "street", c.color, c.finish ?? "gloss"].join("|");
    if (seen.has(key)) {
      problems.push(
        `${c.name} and ${seen.get(key)} are the same car: same silhouette, same kit, ` +
          `same colour, same finish`
      );
    } else {
      seen.set(key, c.name);
    }
  }
  console.log(`\nidentity   ${seen.size} distinct factory builds across ${fleet.length} cars`);
}

console.log(`\n--- ${problems.length} problem${problems.length === 1 ? "" : "s"} ---`);
for (const p of problems) console.log(`  ${p}`);

await browser.close();
