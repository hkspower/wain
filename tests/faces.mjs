// Seventeen cars, seventeen faces.
//
//   npm run dev
//   npm run test:faces
//
// Six silhouettes carry seventeen machines, so up to four cars are the
// same shape in a different colour. Before this, they were also the same
// FACE: one 1050 x 170 dark rectangle sunk into every nose in the game,
// with a chrome strip over it. The front of a car is what a rival shows
// you for a whole race and what the shop card leads with, and it was the
// part of the car that said least about which car it was.
//
// So the claims here are about DISTINCTNESS as much as correctness:
//
//   own      every car states its own face, and no two are identical —
//            which is the whole point, and the thing that quietly stops
//            being true the day somebody copies a line to add a car
//   built    the parts a spec asks for are on the car: an aperture, a
//            mesh behind it, a surround around it, ducts and a lower
//            mouth where the record says so
//   on it    the face sits ON the nose, not in front of it or inside it
//   cheap    a mesh is one merged geometry, not forty
//   seen     from ahead, at least 90% of each grille's aperture and mesh
//            is what a ray meets first. Every check above passed while
//            the face was sunk behind the skin of a shell with no hole in
//            it, and 13 of the 17 cars showed 0% of their grille.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { CARS } from "../src/game/mods.ts";
import { FACE_FALLBACK } from "../src/game/cars.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// ---- 1. Every car has its own, and no two are the same --------------
{
  const missing = CARS.filter((c) => !c.face).map((c) => c.id);
  console.log(`stated    ${CARS.length - missing.length}/${CARS.length} cars state their own face  ` +
    check(missing.length === 0, `no face on: ${missing.join(", ")}`));

  const seen = new Map();
  const clones = [];
  for (const c of CARS) {
    if (!c.face) continue;
    // Compared on the whole spec, key order normalised, because two
    // faces that differ only in the order somebody typed the fields are
    // the same face.
    const key = JSON.stringify(Object.entries(c.face).sort());
    if (seen.has(key)) clones.push(`${c.id} = ${seen.get(key)}`);
    else seen.set(key, c.id);
  }
  console.log(`distinct  ${seen.size} different faces across ${CARS.length} cars  ` +
    check(clones.length === 0, `same face twice: ${clones.join("; ")}`));

  // And they are not all the same shape with a different number on it:
  // a fleet where every aperture is a slat is a fleet with one face.
  const patterns = new Set(CARS.map((c) => c.face?.pattern).filter(Boolean));
  console.log(`patterns  ${[...patterns].sort().join(", ")}  ` +
    check(patterns.size >= 3, `only ${patterns.size} pattern(s) across the whole roster`));

  // Sanity on the numbers, because a face wider than the car is a face
  // that will hang off both sides of the nose.
  for (const c of CARS) {
    const f = c.face;
    if (!f) continue;
    check(f.w > 0.5 && f.w < 1.7, `${c.id}: aperture ${f.w} m wide`);
    check(f.h > 0.04 && f.h < 0.4, `${c.id}: aperture ${f.h} m tall`);
    check(f.pitch > 0.015 && f.pitch < 0.2, `${c.id}: ${f.pitch} m pitch`);
  }
  // Every silhouette keeps a fallback, for traffic and for any caller
  // that predates cars stating their own.
  const styles = new Set(CARS.map((c) => c.style ?? "sedan"));
  const noFallback = [...styles].filter((s) => !FACE_FALLBACK[s]);
  console.log(`fallback  ${Object.keys(FACE_FALLBACK).length} silhouettes have one  ` +
    check(noFallback.length === 0, `no fallback face for: ${noFallback.join(", ")}`));
}

// ---- 2. What the record asks for is what gets built ------------------
//
// The half above is arithmetic on the roster and needs nothing running;
// this half builds every car and needs a dev server. --records runs the
// first half alone, which is what a pre-commit check wants and what a
// machine with no browser can still answer.
if (process.argv.includes("--records")) {
  if (fail.length) {
    console.log(`\nFAILURES:\n${fail.map((f) => ` - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`\nthe ${CARS.length} records are sound; run without --records to build them`);
  process.exit(0);
}

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
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnBuildCar, null, { timeout: 180000 });
await page.waitForTimeout(1200);

const built = await page.evaluate(async (ids) => {
  const THREE = window.__grnThree;
  const out = {};
  const cars = ids.map((id) => {
    const car = window.__grnShowroom.car(id);
    return [id, window.__grnBuildCar({
      body: car.color, style: car.style, kit: car.kit, raceKit: car.kit === "attack",
      lengthM: car.lengthM, face: car.face,
    })];
  });
  // The hero cars swap in their authored shells asynchronously and the
  // face is refitted to them (cars.ts, refitShell). Measure what a
  // player actually sees, which is the refitted face.
  await new Promise((r) => setTimeout(r, 4000));
  for (const [id, g] of cars) {
    g.updateMatrixWorld(true);
    const parts = {};
    let meshDraws = 0;
    let noseZ = -Infinity;
    let shell = null;
    g.traverse((o) => {
      if (o.userData?.shell === "body") shell = o;
      const f = o.userData?.face;
      if (!f) return;
      parts[f] = (parts[f] ?? 0) + 1;
      if (f === "mesh") meshDraws++;
    });
    // The nose, and where the face sits relative to it.
    const box = new THREE.Box3().setFromObject(shell);
    noseZ = box.max.z;
    const gaps = {};
    g.traverse((o) => {
      const f = o.userData?.face;
      if (!f) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      gaps[f] = Math.min(gaps[f] ?? Infinity, +(noseZ - b.max.z).toFixed(4));
    });
    // SEEN: fire rays straight at each part from ahead of the car and ask
    // what they meet first. The face used to be sunk behind the skin of a
    // shell with no hole in it; every check above passed and 13 of 17
    // cars showed 0% of their grille. A number plate in front of the
    // grille is how cars are built, so a ray that meets one is not counted.
    const meshes = [];
    g.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
    const rc = new THREE.Raycaster();
    const seen = {};
    for (const part of ["aperture", "mesh", "surround", "duct", "lower", "badge"]) {
      const objs = meshes.filter((m) => m.userData.face === part);
      if (!objs.length) continue;
      let hit = 0, n = 0;
      for (const o of objs) {
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        for (let i = 1; i < 8; i++) for (let j = 1; j < 4; j++) {
          rc.set(new THREE.Vector3(bb.min.x + ((bb.max.x - bb.min.x) * i) / 8,
            bb.min.y + ((bb.max.y - bb.min.y) * j) / 4, bb.max.z + 5), new THREE.Vector3(0, 0, -1));
          const first = rc.intersectObjects(meshes, false)[0];
          if (!first || first.object.material?.name === "plate") continue;
          n++;
          if (first.object.userData.face) hit++;
        }
      }
      if (n) seen[part] = Math.round((hit / n) * 100);
    }
    out[id] = {
      parts, meshDraws, gaps, noseZ: +noseZ.toFixed(3), seen,
      omitted: g.userData.faceOmitted ?? [], fit: g.userData.faceFit ?? null,
    };
  }
  return out;
}, CARS.map((c) => c.id));

console.log("");
let wrong = 0;
for (const c of CARS) {
  const b = built[c.id];
  const f = c.face ?? {};
  const want = [];
  if (f.pattern !== "open") want.push("aperture", "mesh");
  if (f.surround !== "none") want.push("surround");
  if (f.ducts) want.push("duct", "duct-mesh");
  if (f.lower) want.push("lower", "lower-mesh");
  if (f.badge) want.push("badge");
  // A part the car records as having no room for, with the reason, is
  // not missing: the face is fitted to the nose it is on (cars.ts).
  const excused = new Set(b.omitted.map((o) => o.split(":")[0]));
  const missing = want.filter((w) => !b.parts[w] && !excused.has(w.replace("-mesh", "")));
  // Every part of the face has to be at or behind the nose. A grille in
  // front of the bumper is the failure the old code had by construction:
  // it pinned to `d.nose`, the body's furthest point, which on a bowed
  // nose is not where the grille's own height is.
  const proud = Object.entries(b.gaps).filter(([, gap]) => gap < -0.005).map(([k, v]) => `${k} ${(v * 1000).toFixed(0)}mm`);
  const ok = !missing.length && !proud.length;
  if (!ok) wrong++;
  console.log(
    `  ${c.id.padEnd(16)} ${(f.pattern ?? "-").padEnd(9)} ${Object.keys(b.parts).length} parts, ` +
      `${b.meshDraws} mesh draw${b.meshDraws === 1 ? "" : "s"}  ` +
      check(ok, missing.length
        ? `${c.id} is missing ${missing.join(", ")} from its face`
        : `${c.id} has face parts standing proud of the nose: ${proud.join(", ")}`)
  );
  // One merged geometry per aperture, not one per bar.
  check(b.meshDraws <= 1, `${c.id} draws its grille mesh in ${b.meshDraws} pieces`);
}

// ---- 3. The grille can be SEEN ---------------------------------------
console.log("\nseen from ahead (% of each part a ray meets first; plates excluded)");
for (const c of CARS) {
  const b = built[c.id];
  const v = b.seen;
  const cells = Object.entries(v).map(([k, p]) => `${k} ${p}%`).join("  ");
  const note = [b.fit && `fitted: ${b.fit}`, ...b.omitted].filter(Boolean).join("; ");
  const ok = (v.aperture ?? 100) >= 90 && (v.mesh ?? 100) >= 90;
  console.log(`  ${c.id.padEnd(16)} ${check(ok, `${c.id}: the grille is hidden — ${cells}`)}  ${cells}${note ? `   (${note})` : ""}`);
}

await browser.close();
if (fail.length) {
  console.log(`\nFAILURES:\n${fail.map((f) => ` - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`\nevery one of the ${CARS.length} cars has its own face, and it is on the nose`);
