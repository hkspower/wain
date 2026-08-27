// Does the full-length graphic actually run the full length, and stay on
// the car while it does?
//
//   npm run dev
//   node tools/shots/stripe.mjs
//
// The decal is not a plane, so a bounding box is not enough to trust: a
// ribbon built through raycast hits could be the right size and still be
// buried in the doors or floating off the bumpers. So this reads the
// ribbon's own vertices back and compares each one against the body it
// is supposed to be lying on, at that vertex's own height and station.
//
//   reach     how much of the body the graphic covers, measured against
//             the run that can actually carry a band of its height —
//             both edges on paint, which is the condition the ribbon
//             builder itself works to. Not the bounding box: a car is
//             shorter near the sill than at the beltline, and scoring a
//             low stripe against the overall length marks it down for
//             the car's own taper. "of car" is that cruder number, kept
//             alongside because it is the one an eye compares against.
//   standoff  every vertex's distance outside the body surface under it.
//             Negative means buried in the paint, large means floating.
//             Both are the failure a flat plane would have had.
//   clear     it must not land in the rally pack's lane. The two are
//             sold separately and can be worn together.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(2500);

const rows = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const out = [];
  for (const style of ["sedan", "zx", "gtr", "rx7", "hatch"]) {
    const g = window.__grnBuildCar({
      body: 0x1b2a4a, style, fullStripe: true, stickers: true, name: "Test",
    });
    g.updateMatrixWorld(true);

    const shell = g.children.find((o) => o.userData?.shell === "body");
    const strips = [];
    const others = [];
    g.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData?.decal === "full-stripe") { strips.push(o); return; }
      const img = o.material?.map?.image;
      if (img && img.width && o.material.transparent && o.position.x > 0) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrix);
        others.push({ tag: `${img.width}x${img.height}`, y0: b.min.y, y1: b.max.y, z0: b.min.z, z1: b.max.z });
      }
    });
    if (!shell || strips.length !== 2) {
      out.push({ style, ok: false, why: `shell=${!!shell} strips=${strips.length}` });
      continue;
    }

    shell.geometry.computeBoundingBox();
    const sb = shell.geometry.boundingBox;
    const shellLen = sb.max.z - sb.min.z;

    // The right-hand ribbon, vertex by vertex, against the body under it.
    const right = strips.find((s) => {
      const p = s.geometry.getAttribute("position");
      return p.getX(0) > 0;
    }) || strips[0];
    const pos = right.geometry.getAttribute("position");
    // Raycast against a probe with an IDENTITY matrix, not against the
    // shell in the scene.
    //
    // buildCar scales the whole group to the car's real length, so once
    // updateMatrixWorld has run the shell sits in a scaled space while
    // the ribbon's vertices are still the group-local numbers they were
    // authored in. Comparing the two reported every vertex as floating
    // up to 250 mm proud of the body and a tenth of them as having no
    // body under them at all — none of which was true of the car, only
    // of the comparison.
    const probe = new THREE.Mesh(shell.geometry);
    probe.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.far = 60;
    const org = new THREE.Vector3();
    const dir = new THREE.Vector3(-1, 0, 0);
    let zMin = Infinity, zMax = -Infinity;
    let offMin = Infinity, offMax = -Infinity, misses = 0;
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
      yMin = Math.min(yMin, y); yMax = Math.max(yMax, y);
      org.set(30, y, z);
      ray.set(org, dir);
      const hit = ray.intersectObject(probe, false);
      if (!hit.length) { misses++; continue; }
      const off = x - hit[0].point.x;
      offMin = Math.min(offMin, off);
      offMax = Math.max(offMax, off);
    }
    // How much body there IS at the height the graphic sits at.
    //
    // This, not the overall length, is the denominator. A car is shorter
    // near the sill than at the beltline — the bodywork tapers into both
    // bumpers — so scoring a low stripe against the bounding box marks it
    // down for the car's own shape and calls 85% a failure when there was
    // never any more paint to cover. What "full length" claims is that
    // the graphic runs as far as the body goes AT ITS OWN HEIGHT.
    // Both edges, because that is the condition the builder works to: a
    // column only makes it into the ribbon if the body is there at the
    // TOP and the BOTTOM of the band. Probing the midline alone measures
    // a run the graphic was never entitled to and marks it down for the
    // difference — the same apples-to-oranges error as the scaled shell,
    // one level further in.
    let availA = Infinity, availB = -Infinity;
    for (let i = 0; i <= 800; i++) {
      const z = sb.min.z - 0.3 + ((sb.max.z - sb.min.z + 0.6) * i) / 800;
      let both = true;
      for (const y of [yMin, yMax]) {
        org.set(30, y, z);
        ray.set(org, dir);
        if (!ray.intersectObject(probe, false).length) { both = false; break; }
      }
      if (!both) continue;
      availA = Math.min(availA, z);
      availB = Math.max(availB, z);
    }
    const avail = availB - availA;

    const clash = others.filter(
      (b) => b.y0 < yMax + 0.015 && b.y1 > yMin - 0.015 && b.z0 < zMax && b.z1 > zMin
    );
    out.push({
      style, ok: true,
      shellLen: +shellLen.toFixed(2),
      run: +(zMax - zMin).toFixed(2),
      avail: +avail.toFixed(2),
      reach: +(((zMax - zMin) / avail) * 100).toFixed(1),
      ofShell: +(((zMax - zMin) / shellLen) * 100).toFixed(1),
      offMin: +offMin.toFixed(4),
      offMax: +offMax.toFixed(4),
      misses,
      verts: pos.count,
      y: `${yMin.toFixed(2)}..${yMax.toFixed(2)}`,
      clash: clash.map((c) => c.tag).join(", "),
    });
    g.traverse((o) => o.geometry && o.geometry.dispose?.());
  }
  return out;
});
await browser.close();

const fail = [];
console.log(
  "\nbody".padEnd(8) + "shell".padStart(7) + "at y".padStart(7) + "run".padStart(7) +
  "reach".padStart(8) + "of car".padStart(8) +
  "standoff min..max".padStart(20) + "off".padStart(5) + "height".padStart(14) + "  clash"
);
for (const r of rows) {
  if (!r.ok) { console.log(`${r.style.padEnd(8)} could not measure — ${r.why}`); fail.push(`${r.style}: ${r.why}`); continue; }
  console.log(
    r.style.padEnd(8) + String(r.shellLen).padStart(7) + String(r.avail).padStart(7) +
    String(r.run).padStart(7) + (r.reach + "%").padStart(8) + (r.ofShell + "%").padStart(8) +
    `${r.offMin.toFixed(3)}..${r.offMax.toFixed(3)}`.padStart(20) +
    String(r.misses).padStart(5) + r.y.padStart(14) + "  " + (r.clash || "none")
  );
  if (r.reach < 96) fail.push(`${r.style}: the graphic covers ${r.reach}% of the ${r.avail} m of body at its own height — that is a stripe, not a full-length one`);
  if (r.offMin < 0.002) fail.push(`${r.style}: a vertex sits ${r.offMin.toFixed(4)} m off the body — it is buried in the paint`);
  if (r.offMax > 0.05) fail.push(`${r.style}: a vertex stands ${r.offMax.toFixed(3)} m proud — it is floating off the body`);
  if (r.misses) fail.push(`${r.style}: ${r.misses} of ${r.verts} vertices have no body under them at all`);
  if (r.clash) fail.push(`${r.style}: it lands in the rally pack's lane, under ${r.clash}`);
}
console.log("");
console.log(fail.length
  ? `FAILURES:\n - ${fail.join("\n - ")}`
  : "the graphic runs the length of every body in the fleet, lies on the paint, and clears the rally pack");
process.exit(fail.length ? 1 : 0);
