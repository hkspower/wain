// The road runs under something, five times a lap.
//
//   npm run dev
//   node tests/bridges.mjs
//
// A flyover is the one structure in this world a driver passes THROUGH
// rather than beside, and that makes it the one that can actually be in
// the way. Three things have to be true of every one of them, and all
// three are the sort that look fine in a screenshot taken from the one
// angle somebody happened to check:
//
//   clearance   nothing over the carriageway is low enough to hit. The
//               deck soffit is at 6.4 m and the tallest thing that gets
//               under it is a car with a wing on it.
//   piers       no pier is inside the drivable width. The physics holds
//               the car inside halfWidthAt() and there is no collider on
//               scenery, so a pier the car could reach would be a pier
//               the car drives through.
//   lighting    no street column grows through a deck. A pole is 8.4 m
//               and the soffit is at 6.4, so an unfiltered pole comes up
//               through the bridge — which is exactly what happened
//               before flyover placement started suppressing them.

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

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
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
await page.waitForFunction(() => !!window.__grnThree, null, { timeout: 240000 });
await page.waitForTimeout(2500);

const bridges = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const track = e.track;
  let root = e.world.moonLight;
  while (root.parent) root = root.parent;

  const found = [];
  root.traverse((o) => { if (o.name === "flyover") found.push(o); });
  root.updateMatrixWorld(true);

  /** Where a world point sits on the road: distance along, and how far
   *  off the centre line. Recovered by searching near the flyover's own
   *  station rather than over the whole lap — the loop comes back on
   *  itself and a global search finds the wrong side of it. */
  const near = (p, guess) => {
    let best = null;
    const q = new THREE.Vector3();
    const side = new THREE.Vector3();
    for (let d = -60; d <= 60; d += 0.5) {
      const s = track.wrap(guess + d);
      track.pointAt(s, q);
      const dist = q.distanceTo(new THREE.Vector3(p.x, q.y, p.z));
      if (!best || dist < best.dist) {
        track.sideAt(s, side);
        const off = (p.x - q.x) * side.x + (p.z - q.z) * side.z;
        best = { s, dist, lat: off };
      }
    }
    return best;
  };

  const out = [];
  for (const f of found) {
    // Which station this one is at: the group's own origin is on the
    // centre line, so the nearest point on the track to it is its s.
    const origin = new THREE.Vector3();
    f.getWorldPosition(origin);
    let sBest = 0;
    let dBest = Infinity;
    const q = new THREE.Vector3();
    for (let s = 0; s < track.length; s += 4) {
      track.pointAt(s, q);
      const d = Math.hypot(q.x - origin.x, q.z - origin.z);
      if (d < dBest) { dBest = d; sBest = s; }
    }
    const hw = track.halfWidthAt(sBest);

    // The lowest thing anywhere over the carriageway, and the closest
    // any solid part comes to the centre line at road height.
    let lowestOverRoad = Infinity;
    let nearestPierLat = Infinity;
    let parts = 0;
    const box = new THREE.Box3();
    const c = new THREE.Vector3();
    f.traverse((o) => {
      if (!o.isMesh) return;
      parts++;
      box.setFromObject(o);
      box.getCenter(c);
      const at = near(c, sBest);
      if (!at) return;
      // Over the carriageway?
      if (Math.abs(at.lat) < hw) {
        lowestOverRoad = Math.min(lowestOverRoad, box.min.y);
      }
      // A solid at road height (under 3 m) is something the car could
      // meet. How far off the centre line is it?
      if (box.min.y < 3) {
        nearestPierLat = Math.min(nearestPierLat, Math.abs(at.lat) - (box.max.x - box.min.x) / 2);
      }
    });
    out.push({
      s: Math.round(sBest),
      halfWidth: +hw.toFixed(2),
      parts,
      lowestOverRoad: +lowestOverRoad.toFixed(2),
      nearestPierLat: +nearestPierLat.toFixed(2),
    });
  }

  // And the street lighting: any lamp column whose top would be inside a
  // deck. The poles are instanced, so this reads the matrices.
  const poleTops = [];
  root.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const g = o.geometry;
    const h = (g.parameters?.height ?? 0);
    if (h < 8 || h > 9) return; // the 8.4 m street column, and only it
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      // Hidden instances are scaled to zero.
      if (Math.abs(m.elements[0]) + Math.abs(m.elements[5]) < 1e-4) continue;
      p.setFromMatrixPosition(m);
      poleTops.push({ x: +p.x.toFixed(1), y: +(p.y + h / 2).toFixed(1), z: +p.z.toFixed(1) });
    }
  });
  // Which of those sit under a deck.
  let fouling = 0;
  for (const f of found) {
    const bb = new THREE.Box3().setFromObject(f);
    for (const t of poleTops) {
      if (t.x > bb.min.x && t.x < bb.max.x && t.z > bb.min.z && t.z < bb.max.z && t.y > 5.5) {
        fouling++;
      }
    }
  }
  return { bridges: out, poles: poleTops.length, fouling };
});

console.log("flyover     at s   road half-width   lowest over the road   nearest pier");
for (const b of bridges.bridges) {
  console.log(
    `  ${String(b.s).padStart(6)} m      ${String(b.halfWidth).padStart(5)} m` +
      `            ${String(b.lowestOverRoad).padStart(5)} m` +
      `             ${String(b.nearestPierLat).padStart(6)} m   (${b.parts} parts)`
  );
}

console.log(
  `\ncount      ${check(bridges.bridges.length === 5,
    `${bridges.bridges.length} flyovers on the lap`)}  ${bridges.bridges.length} crossings a lap`
);
const lowest = Math.min(...bridges.bridges.map((b) => b.lowestOverRoad));
console.log(
  `clearance  ${check(lowest > 5.0,
    `something over the carriageway hangs at ${lowest} m`)}  ` +
    `the lowest thing over any carriageway is at ${lowest} m`
);
const closest = Math.min(...bridges.bridges.map((b) => b.nearestPierLat));
console.log(
  `piers      ${check(closest > bridges.bridges[0].halfWidth,
    `a pier reaches to ${closest} m off the centre line, inside the ${bridges.bridges[0].halfWidth} m the car can drive`)}  ` +
    `nearest solid at road height is ${closest} m out, against a ${bridges.bridges[0].halfWidth} m drivable half-width`
);
console.log(
  `lighting   ${check(bridges.fouling === 0,
    `${bridges.fouling} street column(s) grow through a deck`)}  ` +
    `${bridges.poles} lit columns on the lap, none of them inside a bridge`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} FAILED`);
  for (const f of fail) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nfive times a lap, the world closes over you");
