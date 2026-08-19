// A design audit of every car in the showroom.
//
//   npm run dev            # in another shell
//   node tools/shots/audit-cars.mjs
//
// The wheel arch was drawn inside the bodywork for the life of this
// project — two meshes on four corners of every car, never once visible.
// Nothing caught it because nothing was looking: the geometry existed,
// the numbers were plausible, and it simply rendered behind a panel.
//
// So this looks. Every mesh on the car is given a unique flat colour and
// the car is rendered from sixteen angles — both sides high and low, both
// ends, the roof and the floor; a mesh that never paints a single pixel
// from any of them is not on the car in any sense that matters. One
// render per angle rather than one per mesh, which is what makes an audit
// of fourteen cars cheap enough to run.
//
// It also meters the things a car can be wrong about numerically: track
// against body width and ride height.
//
// Three of its own bugs are worth knowing about, because each one made it
// lie confidently: tone mapping shifted the id colours (705 phantom
// findings), opaque stand-in glass hid the whole interior, and a single
// low camera on the right made every left-side detail "invisible". If a
// result here looks extreme, suspect this file first.

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const cars = await fetch("http://localhost:3000/api/grn/v1/cars")
  .then((r) => r.json())
  .catch(() => { console.error("start the dev server: npm run dev"); process.exit(2); });

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
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
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(3000);
await page.evaluate(() => { window.__grnEngine.setPaused(true); });

const auditOne = (carId) =>
  page.evaluate(async (carId) => {
    const THREE = window.__grnThree;
    const e = window.__grnEngine;
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
      car: carId, cars: [carId], owned: [], kd: 99999,
      equipped: { paint: "paint-white", glow: "glow-none" },
    }));
    e.applyGarage();
    await new Promise((r) => setTimeout(r, 150));
    const car = e.carBody;

    // --- geometry, in the car's own frame, through each mesh's matrix
    // chain. A world AABB transformed back to local is inflated by the
    // car's heading and reports a 0.92 m flank as 2.89.
    const local = (o) => {
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone();
      const m = new THREE.Matrix4().identity();
      for (let n = o; n && n !== car; n = n.parent) { n.updateMatrix(); m.premultiply(n.matrix); }
      return bb.applyMatrix4(m);
    };

    const meshes = [];
    car.traverse((o) => { if (o.isMesh && o.geometry) meshes.push(o); });
    const wheelSet = new Set();
    for (const w of car.userData.wheels ?? []) w.traverse((o) => wheelSet.add(o));

    const info = meshes.map((o, i) => {
      const bb = local(o);
      return {
        i,
        // Geometry that is meant to be enclosed — a skull inside a
        // helmet — is tagged at build time. Everything else that never
        // paints a pixel is a bug.
        exempt: wheelSet.has(o) || !!o.userData.hiddenBy,
        x: [+bb.min.x.toFixed(3), +bb.max.x.toFixed(3)],
        y: [+bb.min.y.toFixed(3), +bb.max.y.toFixed(3)],
        z: [+bb.min.z.toFixed(3), +bb.max.z.toFixed(3)],
        tris: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3,
        type: o.geometry.type,
      };
    });

    // --- visibility: one flat colour per mesh, six angles, count pixels
    const saved = meshes.map((o) => o.material);
    const idMat = meshes.map((_, i) => new THREE.MeshBasicMaterial({
      color: new THREE.Color((((i + 1) * 2654435761) >>> 8) & 0xffffff),
      fog: false,
    }));
    // A distinct colour per mesh, spread so quantisation cannot collide
    const key = new Map();
    meshes.forEach((o, i) => {
      const c = new THREE.Color();
      // 6 bits per channel keeps every id far apart after 8-bit readback
      const r = ((i % 4) * 64 + 32) / 255;
      const g = ((Math.floor(i / 4) % 4) * 64 + 32) / 255;
      const b = ((Math.floor(i / 16) % 4) * 64 + 32) / 255;
      const band = Math.floor(i / 64); // more than 64 meshes: run in bands
      c.setRGB(r, g, b);
      idMat[i].color = c;
      key.set(i, { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), band });
    });

    const bbAll = new THREE.Box3();
    for (const o of meshes) bbAll.union(local(o));
    const size = bbAll.getSize(new THREE.Vector3());
    const centre = bbAll.getCenter(new THREE.Vector3());
    const R = Math.max(size.x, size.y, size.z) * 1.6;

    const cam = new THREE.PerspectiveCamera(40, 900 / 620, 0.1, 200);
    // Both sides, high and low, plus the ends, the roof and the floor.
    // The first version had a single low side elevation and it was on the
    // right, so every door handle and side skirt on the left came back
    // "never visible" — an artifact of where the cameras were, not of
    // where the geometry was. Symmetry in the angle set is the fix.
    const angles = [
      [1, 0.45, 1.2], [-1, 0.45, 1.2], [1, 0.45, -1.2], [-1, 0.45, -1.2],
      [0.9, 0.1, 1.1], [-0.9, 0.1, 1.1], [0.9, 0.1, -1.1], [-0.9, 0.1, -1.1],
      [1.4, 0.12, 0], [-1.4, 0.12, 0], [1.2, 0.9, 0], [-1.2, 0.9, 0],
      [0, 0.25, 1.5], [0, 0.25, -1.5], [0, 1.4, 0.3], [0, -1, 0.4],
    ];
    // A shut line is 16 mm of geometry on a 4.8 m car. At 300 px across
    // that is a third of a pixel, and whether it registers comes down to
    // where the sample grid happens to land — which is why door handles
    // and skirts kept coming back invisible on one side only.
    const W = 720, H = 496;
    const rt = new THREE.WebGLRenderTarget(W, H);
    const buf = new Uint8Array(W * H * 4);
    const seen = new Set();
    const bands = Math.ceil(meshes.length / 64);

    // The renderer tone-maps and converts to sRGB on the way out, which
    // shifts every ID colour and makes the decode below read the wrong
    // mesh — or none. The first run of this audit reported 705 invisible
    // meshes across the fleet on exactly that mistake.
    const prevTone = e.renderer.toneMapping;
    const prevSpace = e.renderer.outputColorSpace;
    e.renderer.toneMapping = THREE.NoToneMapping;
    e.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    const prevParent = car.parent;
    const prevMatrix = car.matrix.clone();
    const stage = new THREE.Scene();
    stage.add(car);
    car.position.set(0, 0, 0);
    car.rotation.set(0, 0, 0);
    car.updateMatrixWorld(true);

    // Occluders write depth but no colour, so they hide what is behind
    // them without painting an id of their own. One shared material
    // rather than one per mesh per band, which the first version leaked.
    const occluder = new THREE.MeshBasicMaterial({ colorWrite: false });
    // Glass must not occlude: replacing it with something opaque hides
    // the entire interior and reports every seat, the dash and the driver
    // as geometry that is never visible. That alone was most of the 705.
    const seeThrough = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const clear = meshes.map((o, i) => {
      const m = saved[i];
      return !!(m && (m.transparent || (m.opacity ?? 1) < 1 || m.transmission > 0));
    });
    for (let band = 0; band < bands; band++) {
      meshes.forEach((o, i) => {
        if (Math.floor(i / 64) === band) { o.material = idMat[i]; return; }
        o.material = clear[i] ? seeThrough : occluder;
      });
      // A mesh being tested must not be hidden by its own glass either.
      meshes.forEach((o, i) => {
        if (Math.floor(i / 64) === band && clear[i]) idMat[i].depthWrite = false;
      });
      for (const [ax, ay, az] of angles) {
        cam.position.set(centre.x + ax * R, centre.y + ay * R, centre.z + az * R);
        cam.lookAt(centre);
        e.renderer.setRenderTarget(rt);
        e.renderer.setClearColor(0x000000, 1);
        e.renderer.clear();
        e.renderer.render(stage, cam);
        e.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        for (let p = 0; p < buf.length; p += 4) {
          const r = buf[p], g = buf[p + 1], b = buf[p + 2];
          if (r < 16 && g < 16 && b < 16) continue;
          const ri = Math.round((r - 32) / 64), gi = Math.round((g - 32) / 64), bi = Math.round((b - 32) / 64);
          if (ri < 0 || gi < 0 || bi < 0 || ri > 3 || gi > 3 || bi > 3) continue;
          seen.add(band * 64 + ri + gi * 4 + bi * 16);
        }
      }
    }
    e.renderer.setRenderTarget(null);
    e.renderer.toneMapping = prevTone;
    e.renderer.outputColorSpace = prevSpace;
    meshes.forEach((o, i) => { o.material = saved[i]; });
    for (const m of idMat) m.dispose();
    occluder.dispose();
    seeThrough.dispose();
    rt.dispose();
    stage.remove(car);
    if (prevParent) prevParent.add(car);
    car.matrix.copy(prevMatrix);
    car.matrix.decompose(car.position, car.quaternion, car.scale);
    car.updateMatrixWorld(true);

    const invisible = info.filter((m) => !seen.has(m.i) && !m.exempt);
    // --- numbers a car can be wrong about
    const body = info.filter((m) => !m.exempt);
    // The body shell is tagged at build time. Picking "the mesh with the
    // most triangles" instead found the glasshouse on some silhouettes
    // and an authored sub-assembly on others, so the flank measured off
    // it came back as zero on half the fleet.
    const shellIdx = meshes.findIndex((o) => o.userData.shell === "body");
    const shell = shellIdx >= 0 ? info[shellIdx] : body.reduce((a, m) => (m.tris > a.tris ? m : a), body[0]);
    // A wheel is a Group; union its meshes rather than asking a node
    // with no geometry for a bounding box.
    const localGroup = (g) => {
      const bb = new THREE.Box3();
      g.traverse((o) => { if (o.isMesh && o.geometry) bb.union(local(o)); });
      return bb;
    };
    const wheels = (car.userData.wheels ?? []).map((w) => localGroup(w));
    const trackOuter = Math.max(...wheels.map((b) => Math.max(Math.abs(b.min.x), Math.abs(b.max.x))));
    // The flank at the front wheel's z, sampled off the shell's own
    // vertices. Comparing the track against the widest thing on the car
    // compares it against the door mirrors, which every car then "fails".
    const shellMesh = meshes[shellIdx >= 0 ? shellIdx : info.indexOf(shell)];
    let flank = 0;
    let dbg = null;
    {
      // Through the shell's own matrix chain, and with the height window
      // taken from the shell rather than pinned to constants. Reading raw
      // vertices against a fixed 0.25..0.95 band reported a flank of 0 on
      // six of the fourteen cars — the lowered ones, whose shell sits
      // somewhere else entirely.
      const m = new THREE.Matrix4().identity();
      for (let n = shellMesh; n && n !== car; n = n.parent) { n.updateMatrix(); m.premultiply(n.matrix); }
      // No height window at all. Any band pinned by hand misses: the
      // shell is arched out over the front wheel, so at the wheel's own z
      // it has no vertices below y 0.8 and a 0.25..0.95 filter returns
      // nothing. The widest point of the flank beside the front wheel is
      // exactly the number wanted, so take it.
      const front = wheels.reduce((a, b) => (b.max.z > a.max.z ? b : a), wheels[0]);
      const wz = front ? (front.min.z + front.max.z) / 2 : 1.4;
      const pos = shellMesh.geometry.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        if (Math.abs(v.z - wz) > 0.35) continue;
        flank = Math.max(flank, Math.abs(v.x));
      }
      dbg = { verts: pos.count, wz: +wz.toFixed(3), type: shellMesh.geometry.type, tris: shell.tris };
    }
    const bodyHalf = +flank.toFixed(3);
    const floor = Math.min(...body.filter((m) => m.tris > 40).map((m) => m.y[0]));
    const wheelBottom = Math.min(...wheels.map((b) => b.min.y));

    return {
      carId,
      meshes: meshes.length,
      invisible: invisible.map((m) => ({ type: m.type, tris: m.tris, x: m.x, y: m.y, z: m.z })),
      shellHalf: +Math.max(Math.abs(shell.x[0]), Math.abs(shell.x[1])).toFixed(3),
      bodyHalf,
      trackOuter: +trackOuter.toFixed(3),
      dbg,
      floorY: +floor.toFixed(3),
      wheelBottomY: +wheelBottom.toFixed(3),
    };
  }, carId);

console.log("Auditing every car for geometry that never paints a pixel.\n");
const results = [];
const only = process.env.ONLY ? Number(process.env.ONLY) : 0;
for (const c of only ? cars.cars.slice(0, only) : cars.cars) {
  const r = await auditOne(c.id);
  results.push({ ...r, name: c.name, style: c.bodyStyle });
  const inv = r.invisible.reduce((a, m) => a + m.tris, 0);
  console.log(
    `${c.name.padEnd(20)} ${String(r.meshes).padStart(3)} meshes  ` +
      `${String(r.invisible.length).padStart(2)} never visible (${inv} tris)  ` +
      `track ${r.trackOuter} vs body ${r.bodyHalf}  ride ${(r.floorY - r.wheelBottomY).toFixed(3)}`
  );
  if (process.env.DBG) console.log("      dbg", JSON.stringify(r.dbg));
  // Every one of them. Printing the first four hid two thirds of the
  // fleet's buried geometry behind a tidy-looking list.
  for (const m of r.invisible) {
    console.log(`    · ${m.type.padEnd(16)} ${m.tris} tris  x ${m.x[0]}..${m.x[1]}  y ${m.y[0]}..${m.y[1]}  z ${m.z[0]}..${m.z[1]}`);
  }
}

const totalInv = results.reduce((a, r) => a + r.invisible.length, 0);
console.log(`\n${totalInv} invisible meshes across ${results.length} cars`);
const narrow = results.filter((r) => r.trackOuter < r.bodyHalf);
if (narrow.length) {
  console.log(`\nwheels inside the bodywork (no track): ${narrow.map((r) => r.name).join(", ")}`);
}
await browser.close();
