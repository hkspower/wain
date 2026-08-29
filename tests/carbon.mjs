// Carbon and the engine cover, measured on the built car.
//
//   npm run dev            (in another terminal)
//   npm run test:carbon
//
// WHY MEASURED AND NOT LOOKED AT
//
// Both of these are near-black parts on a car photographed at night.
// Two renders of the same car with and without the carbon package
// differ by a few hundred bytes of PNG and by nothing a person can see,
// and I spent a while comparing them and learning nothing. Worse, I
// nearly "fixed" a stepped shape on the rear quarter that turned out to
// be part of the car and nothing to do with this work at all — the
// control render is what settled it.
//
// The questions are geometric, so they are answered geometrically:
//
//   IS IT THERE           A panel that is not built is a part the shop
//                         charges for and does not deliver.
//   IS THE UPGRADE ONE    Full Dry Carbon must add something the cheaper
//                         package does not. It did not: the roof span
//                         was read off d.roof, which is [z, y] — an
//                         anchor point, not a z range — so the roof was
//                         sampled out over the windscreen, came back
//                         null, and was silently skipped. 3,200 KD for
//                         the same four pieces, and nothing looked wrong.
//   IS IT INSIDE THE CAR  The cam cover's crown must sit BELOW the
//                         bonnet skin. The first version had it three
//                         centimetres above: an engine growing out
//                         through a shut bonnet, invisible in every
//                         render of a dark car.

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium; set CHROME_PATH"); process.exit(2); }

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

const b = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
page.setDefaultTimeout(180000);
try {
  await page.goto("http://localhost:3000/race", { waitUntil: "networkidle", timeout: 60000 });
} catch {
  console.error("start the dev server: npm run dev");
  process.exit(2);
}
/**
 * Get from a cold page to a paused car on the road.
 *
 * Run once per CAR, not once per session. Switching the saved car id and
 * calling applyGarage navigates the page — the second car killed the
 * first version of this test with "Execution context was destroyed",
 * which is the page doing exactly what it should and the test assuming
 * it would not.
 */
async function boot(carId) {
  await page.evaluate((id) => {
    localStorage.clear();
    localStorage.setItem("gulf-road-nights-onboarded", "2");
    localStorage.setItem("gulf-road-nights-coach", "3");
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
      car: id, cars: [id], owned: [], kd: 999999,
      equipped: { paint: "paint-white", glow: "glow-none" },
    }));
  }, carId);
  await page.reload({ waitUntil: "networkidle" });
  await page.click("text=START ENGINE");
  await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__grnEngine.setPaused(true); });
}

const measure = (carId, equip) => page.evaluate(async ([carId, equip]) => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const wanted = equip.split(",").filter(Boolean);
  const eqMap = { paint: "paint-white", glow: "glow-none" };
  for (const id of wanted) eqMap[id.split("-")[0]] = id;
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car: carId, cars: [carId], owned: wanted, kd: 999999, equipped: eqMap,
  }));
  e.applyGarage();
  await new Promise((r) => setTimeout(r, 250));
  const car = e.carBody;
  car.updateMatrixWorld(true);
  const out = { carbon: [], cover: [], vent: [], paintTopAt: {} };
  const paintBoxes = [];
  car.traverse((o) => {
    if (!o.isMesh) return;
    const box = new THREE.Box3().setFromObject(o);
    const rec = { x: [box.min.x, box.max.x], y: [box.min.y, box.max.y], z: [box.min.z, box.max.z] };
    if (o.userData.trim === "carbon") out.carbon.push(rec);
    else if (o.userData.trim === "engine-cover") out.cover.push(rec);
    else if (o.userData.trim === "hood-vent") out.vent.push(rec);
    else if (o.material?.name === "paint") paintBoxes.push(box);
  });
  // How high the painted bodywork reaches across the z band each cover
  // sits in. A cover whose crown is above this is outside the car.
  for (const c of out.cover) {
    let top = -Infinity;
    for (const pb of paintBoxes) {
      if (pb.max.z < c.z[0] || pb.min.z > c.z[1]) continue;
      if (pb.max.x < c.x[0] || pb.min.x > c.x[1]) continue;
      top = Math.max(top, pb.max.y);
    }
    out.paintTopAt[c.z[0].toFixed(3)] = top;
  }
  return out;
}, [carId, equip]);

// One car per silhouette, because the roof and the boot are the two
// panels whose existence depends on the shape, and a saloon proves
// nothing about a fastback.
const CARS = ["deera-sedan", "kaiju-r", "efreet-rx", "sharq-hatch"];

for (const carId of CARS) {
  await boot(carId);
  const none = await measure(carId, "");
  const panels = await measure(carId, "carbon-panels");
  const full = await measure(carId, "carbon-full,cover-red");

  console.log(
    `\n${carId.padEnd(14)} none ${none.carbon.length} panels, ` +
    `package ${panels.carbon.length}, full ${full.carbon.length}, ` +
    `cover ${full.cover.length} in ${full.vent.length} vents`
  );

  check(none.carbon.length === 0, `${carId}: carbon panels appear with no package fitted`);
  check(none.cover.length === 0, `${carId}: an engine cover appears with none fitted`);

  // The package delivers: a bonnet and two mirror caps at the very least.
  check(panels.carbon.length >= 3, `${carId}: the carbon package built only ${panels.carbon.length} pieces`);

  // The one that matters. An upgrade that adds nothing is money taken.
  check(
    full.carbon.length > panels.carbon.length,
    `${carId}: Full Dry Carbon builds ${full.carbon.length} pieces and the cheaper package builds ` +
    `${panels.carbon.length} — the upgrade adds nothing and costs 1,400 KD more`
  );

  // Nothing lives outside the car.
  check(full.cover.length === 2, `${carId}: ${full.cover.length} engine covers, expected 2`);
  check(full.vent.length === 2, `${carId}: ${full.vent.length} bonnet vents, expected 2`);
  for (const c of full.cover) {
    const skin = full.paintTopAt[c.z[0].toFixed(3)];
    if (!Number.isFinite(skin)) {
      fail.push(`${carId}: could not find painted bodywork over the engine cover to compare against`);
      continue;
    }
    const under = skin - c.y[1];
    console.log(`               cover crown sits ${(under * 1000).toFixed(0)} mm under the paint`);
    check(
      under > 0.005,
      `${carId}: the cam cover's crown is ${(under * 1000).toFixed(0)} mm under the paint — ` +
      `an engine growing through a shut bonnet`
    );
  }
  // ...and the cover is in its hole rather than beside it.
  for (const c of full.cover) {
    const inVent = full.vent.some(
      (v) => c.x[0] >= v.x[0] - 0.02 && c.x[1] <= v.x[1] + 0.02 &&
             c.z[0] >= v.z[0] - 0.02 && c.z[1] <= v.z[1] + 0.02
    );
    check(inVent, `${carId}: an engine cover sits outside the vent that is supposed to show it`);
  }
}

await b.close();
console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\ncarbon is built, the upgrade upgrades, and the engine stays under the bonnet"
);
process.exit(fail.length ? 1 : 0);
