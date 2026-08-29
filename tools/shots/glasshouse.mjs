// What a car's greenhouse is actually made of.
//
//   npm run dev
//   node tools/shots/glasshouse.mjs deera-sedan kaiju-r efreet-rx sharq-hatch
//
// A cabin is three shells that have to meet: the body, the glass canopy
// on top of it, and the painted roof cap on top of that. Whether they
// meet is a question about numbers, and a night render of a dark car is
// the wrong place to ask it — a gap between the roof and the glass and a
// shadow under a roofline look identical at 2 fps in a black scene.
//
// So this prints, per silhouette: how tall each shell is and what share
// of the car it takes, and then EVERYTHING ELSE that reaches the glass's
// height band with its material and its trim tag. That last list is the
// point. A mystery object over the cabin has to name itself here, which
// is how a stepped shape on the rear quarter — the one I nearly
// "fixed" as a carbon panel I had not in fact broken — gets attributed
// to whatever really draws it.
//
// MEASURED IN THE CAR'S OWN FRAME, not the world's. The car sits on a
// track with a heading, and the world-space bounding box of a rotated
// car describes a box the car is inside rather than the car. That trap
// has already cost this project two wrong readings — see tests/ik.mjs
// and the bumper probe — so the inverse of the car's world matrix is
// applied before anything is measured.

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const C=[process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium"].filter(Boolean);
const b = await chromium.launch({ executablePath: C.find((p)=>existsSync(p)), args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"], headless: true });
const page = await b.newPage({ viewport: { width: 900, height: 600 } });
page.setDefaultTimeout(180000);
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(2500);
await page.evaluate(() => { window.__grnEngine.setPaused(true); });

for (const carId of process.argv.slice(2)) {
  const r = await page.evaluate(async (carId) => {
    const THREE = window.__grnThree;
    const e = window.__grnEngine;
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
      car: carId, cars: [carId], owned: [], kd: 999999,
      equipped: { paint: "paint-white", glow: "glow-none" },
    }));
    e.applyGarage();
    await new Promise((r2) => setTimeout(r2, 300));
    const car = e.carBody;
    car.updateMatrixWorld(true);
    // Measure in the car's OWN frame: it sits on a track with a heading,
    // and a world-space box of a rotated car is not the car.
    const inv = new THREE.Matrix4().copy(car.matrixWorld).invert();
    const local = (o) => {
      const g = o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      g.computeBoundingBox();
      const bb = g.boundingBox;
      g.dispose();
      return bb;
    };
    const out = { shells: {}, near: [], carY: [Infinity, -Infinity] };
    car.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const bb = local(o);
      out.carY[0] = Math.min(out.carY[0], bb.min.y);
      out.carY[1] = Math.max(out.carY[1], bb.max.y);
      const shell = o.userData.shell;
      const name = o.material?.name ?? "?";
      if (shell === "canopy") {
        // The canopy's widest point is at the SHOULDER, not at the top:
        // a greenhouse tumbles home as it rises. So the number the roof
        // cap has to match is not the canopy's max half-width — it is
        // the half-width in the band the roof actually occupies, and
        // that has to be read off the vertices rather than off a box.
        const pos = o.geometry.attributes.position;
        const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        const v = new THREE.Vector3();
        out.canopyVerts = [];
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          out.canopyVerts.push([+v.x.toFixed(4), +v.y.toFixed(4)]);
        }
      }
      if (shell) {
        out.shells[shell] = {
          mat: name,
          y: [+bb.min.y.toFixed(3), +bb.max.y.toFixed(3)],
          z: [+bb.min.z.toFixed(3), +bb.max.z.toFixed(3)],
          x: [+bb.min.x.toFixed(3), +bb.max.x.toFixed(3)],
        };
      }
    });
    // Everything that lives in the greenhouse's y band, so a mystery
    // object over the glass has to name itself.
    const canopy = out.shells.canopy;
    if (canopy) {
      car.traverse((o) => {
        if (!o.isMesh || !o.geometry || o.userData.shell) return;
        const bb = local(o);
        if (bb.max.y < canopy.y[0] - 0.02) return;
        out.near.push({
          mat: o.material?.name ?? "?",
          trim: o.userData.trim ?? "",
          y: [+bb.min.y.toFixed(3), +bb.max.y.toFixed(3)],
          z: [+bb.min.z.toFixed(3), +bb.max.z.toFixed(3)],
          x: [+bb.min.x.toFixed(3), +bb.max.x.toFixed(3)],
        });
      });
    }
    return out;
  }, carId);

  // The canopy's half-width where the roof sits, which is what the roof
  // cap has to match.
  if (r.canopyVerts && r.shells.roof) {
    const [ry0, ry1] = r.shells.roof.y;
    const band = r.canopyVerts.filter(([, y]) => y >= ry0 - 0.02 && y <= ry1 + 0.02);
    const wide = band.length ? Math.max(...band.map(([x]) => Math.abs(x))) : null;
    r.canopyAtRoof = wide;
    delete r.canopyVerts;
  }
  const h = r.carY[1] - r.carY[0];
  console.log(`\n=== ${carId}   car is ${h.toFixed(3)} tall (local units)`);
  for (const [k, v] of Object.entries(r.shells)) {
    const th = v.y[1] - v.y[0];
    console.log(`  ${k.padEnd(7)} [${v.mat}] y ${v.y[0]}..${v.y[1]} (${th.toFixed(3)}, ${((th / h) * 100).toFixed(0)}% of the car)  z ${v.z[0]}..${v.z[1]}  halfwidth ${v.x[1].toFixed(3)}`);
  }
  if (r.canopyAtRoof !== null && r.canopyAtRoof !== undefined && r.shells.roof) {
    const gap = r.canopyAtRoof - r.shells.roof.x[1];
    console.log(
      `  ROOF FIT  glass is ${r.canopyAtRoof.toFixed(3)} wide where the roof sits, ` +
      `roof is ${r.shells.roof.x[1].toFixed(3)} — ${(gap * 1000).toFixed(0)} mm of glass ` +
      `showing down each side of the roof`
    );
  }
  const counts = {};
  for (const n of r.near) {
    const k = `${n.mat}|${n.trim}`;
    (counts[k] ??= []).push(n);
  }
  console.log(`  ${r.near.length} object(s) at or above the glass:`);
  for (const [k, list] of Object.entries(counts)) {
    const ys = list.flatMap((n) => n.y);
    console.log(`     ${list.length.toString().padStart(2)}x ${k.padEnd(24)} y ${Math.min(...ys).toFixed(3)}..${Math.max(...ys).toFixed(3)}`);
  }
}
await b.close();
