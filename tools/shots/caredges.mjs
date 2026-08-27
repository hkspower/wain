// How much of a car is edge, and how much of it is roll?
//
//   npm run dev
//   node tools/shots/caredges.mjs
//
// edges.mjs asks whether the PICTURE resolves an edge — aliasing, FXAA,
// transition width. This asks a different question that no amount of
// antialiasing can answer: whether the car HAS edges. A shell extruded
// with a 170 mm bevel has no sharp edge anywhere on it to resolve. It is
// a bar of soap, and it will still be a bar of soap at 4K with 8x MSAA.
//
// So this measures the geometry rather than the render.
//
//   roll%   share of the body's surface AREA whose normal points
//           somewhere between the flank, the top and the ends — neither
//           one face nor the other, which is what a rounded-over edge
//           is. A car built from panels meeting at edges spends most of
//           its area on the panels. A car built from one rolled
//           extrusion spends it on the roll.
//   flank%  area facing squarely out of the side, within 15 degrees.
//           This is the panel a livery lands on and a reflection runs
//           along, and a fat bevel eats it.
//   edge m  the width of the roll at the shoulder, in metres, measured
//           by walking the silhouette at the widest station and finding
//           how far the surface travels while its normal turns from
//           facing sideways to facing up. This is the number a person
//           means by "how sharp is that edge".
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

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

// The rendered silhouette, which is what "border" actually means.
//
// The geometry numbers below say what shape the car IS; this says how
// the picture resolves its outline, measured exactly the way edges.mjs
// measures the world's edges so the two are comparable. If a car's
// border is softer than a building's in the same frame, something in
// the chain is doing it to the car specifically.
const shot = await page.evaluate(async () => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");
  e.timeHours = 2.5; e.world.setTimeOfDay(2.5); e.applyDaylight(); e.setExposure(0, false);
  const m = 587;
  const park = () => {
    const away = e.track.wrap(m + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
    e.player.s = m; e.player.lat = 0; e.player.speed = 0;
  };
  park();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 30; i++) { e.update(1 / 60); park(); }
    for (let i = 0; i < 4; i++) e.composer.render();
  }
  const car = e.carBody;
  car.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(car);
  const c = box.getCenter(new THREE.Vector3());
  const cam = e.camera;
  cam.position.set(c.x + 6.4, c.y + 0.35, c.z);
  cam.fov = 32; cam.updateProjectionMatrix();
  cam.lookAt(c.x, c.y - 0.05, c.z);
  cam.updateMatrixWorld(true);
  for (let i = 0; i < 4; i++) e.composer.render();

  const W = e.renderer.domElement.clientWidth, H = e.renderer.domElement.clientHeight;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
  const beauty = ctx.getImageData(0, 0, W, H).data;

  // ID pass: everything under the player's car white, the rest black.
  const saved = [];
  const hidden = [];
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const black = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  const inCar = new Set();
  car.traverse((o) => inCar.add(o));
  e.scene.traverse((o) => {
    if (o.isSprite && o.visible) { hidden.push(o); o.visible = false; return; }
    if (!o.isMesh && !o.isInstancedMesh) return;
    saved.push([o, o.material]);
    o.material = inCar.has(o) ? white : black;
  });
  const pt = e.renderer.toneMapping, ps = e.renderer.outputColorSpace, pb = e.scene.background;
  e.renderer.toneMapping = THREE.NoToneMapping;
  e.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  e.scene.background = new THREE.Color(0x000000);
  const rt = new THREE.WebGLRenderTarget(W, H);
  e.renderer.setRenderTarget(rt);
  e.renderer.render(e.scene, e.camera);
  const raw = new Uint8Array(W * H * 4);
  e.renderer.readRenderTargetPixels(rt, 0, 0, W, H, raw);
  e.renderer.setRenderTarget(null);
  rt.dispose();
  const ids = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const src = (H - 1 - y) * W * 4;
    ids.set(raw.subarray(src, src + W * 4), y * W * 4);
  }
  e.renderer.toneMapping = pt; e.renderer.outputColorSpace = ps; e.scene.background = pb;
  for (const [o, mm] of saved) o.material = mm;
  for (const o of hidden) o.visible = true;
  white.dispose(); black.dispose();

  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; i < beauty.length; i += 4, p++) {
    lum[p] = 0.2126 * beauty[i] + 0.7152 * beauty[i + 1] + 0.0722 * beauty[i + 2];
  }
  const isCar = (p) => ids[p * 4] > 128;

  // 10-90% transition width across the left and right silhouette of the
  // car, row by row, the same measurement edges.mjs makes on the world.
  const widths = [];
  for (let y = 2; y < H - 2; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < W; x++) { if (isCar(y * W + x)) { if (first < 0) first = x; last = x; } }
    if (first < 0 || last - first < 8) continue;
    for (const [ex, out] of [[first, -1], [last, 1]]) {
      const inx = ex + (out === -1 ? 3 : -3), outx = ex + out * 4;
      if (outx < 0 || outx >= W) continue;
      const a = lum[y * W + outx], b = lum[y * W + inx];
      const step = Math.abs(b - a);
      if (step < 24) continue;
      const lo = Math.min(a, b) + step * 0.1, hi = Math.min(a, b) + step * 0.9;
      let n = 0;
      for (let d = -4; d <= 4; d++) {
        const x = ex + d;
        if (x < 0 || x >= W) continue;
        const v = lum[y * W + x];
        if (v > lo && v < hi) n++;
      }
      widths.push(n + 1);
    }
  }
  widths.sort((x, z) => x - z);
  return {
    W, H,
    edges: widths.length,
    median: widths.length ? widths[widths.length >> 1] : null,
    mean: widths.length ? +(widths.reduce((s, v) => s + v, 0) / widths.length).toFixed(3) : null,
  };
});
console.log(`\nframe        ${shot.W}x${shot.H}`);
console.log(`car border   ${shot.edges} silhouette samples, ${shot.mean} px mean 10-90% transition (median ${shot.median})`);
console.log("             edges.mjs measures 2.125 px on the world's edges in the same renderer\n");

const rows = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const out = [];
  const AX = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
  ];
  for (const style of ["sedan", "zx", "gtr", "rx7", "hatch"]) {
    const g = window.__grnBuildCar({ body: 0xffffff, style });
    const shell = g.children.find((o) => o.userData?.shell === "body");
    if (!shell) { out.push({ style, ok: false }); continue; }
    const geo = shell.geometry;
    const pos = geo.getAttribute("position");
    const idx = geo.getIndex();
    const tri = idx ? idx.count / 3 : pos.count / 3;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), nrm = new THREE.Vector3();
    let area = 0, roll = 0, flank = 0;
    for (let t = 0; t < tri; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      ab.subVectors(b, a); ac.subVectors(c, a);
      nrm.crossVectors(ab, ac);
      const ar = nrm.length() / 2;
      if (!(ar > 1e-12)) continue;
      nrm.normalize();
      area += ar;
      // angle to the nearest cardinal face direction
      let best = Infinity;
      for (const ax of AX) best = Math.min(best, Math.acos(Math.min(1, Math.max(-1, nrm.dot(ax)))));
      const deg = (best * 180) / Math.PI;
      if (deg > 15 && deg < 75) roll += ar;
      const side = Math.abs(nrm.x);
      if (side > Math.cos((15 * Math.PI) / 180)) flank += ar;
    }

    // The roll at the shoulder, in metres. Walk up the silhouette at the
    // widest station and find the span over which the surface normal
    // turns from sideways to upward.
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const zMid = (bb.min.z + bb.max.z) / 2;
    const probe = new THREE.Mesh(geo);
    probe.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.far = 60;
    const org = new THREE.Vector3(), dir = new THREE.Vector3(-1, 0, 0);
    const hits = [];
    for (let i = 0; i <= 600; i++) {
      const y = bb.min.y + ((bb.max.y - bb.min.y) * i) / 600;
      org.set(30, y, zMid);
      ray.set(org, dir);
      const h = ray.intersectObject(probe, false);
      if (!h.length || !h[0].face) continue;
      hits.push({ y, x: h[0].point.x, nx: Math.abs(h[0].face.normal.x) });
    }
    // widest point, then upward until the face is no longer sideways
    let wi = 0;
    for (let i = 1; i < hits.length; i++) if (hits[i].x > hits[wi].x) wi = i;
    let top = wi;
    while (top < hits.length - 1 && hits[top].nx > 0.35) top++;
    const edgeM = top > wi ? hits[top].y - hits[wi].y : 0;

    out.push({
      style, ok: true, tris: tri,
      roll: +((roll / area) * 100).toFixed(1),
      flank: +((flank / area) * 100).toFixed(1),
      edgeM: +edgeM.toFixed(3),
      width: +(bb.max.x * 2).toFixed(3),
    });
    g.traverse((o) => o.geometry && o.geometry.dispose?.());
  }
  return out;
});
await browser.close();

console.log(
  "\nbody".padEnd(8) + "tris".padStart(8) + "roll%".padStart(8) + "flank%".padStart(8) +
  "edge m".padStart(9) + "width".padStart(8)
);
const fail = [];
for (const r of rows) {
  if (!r.ok) { console.log(`${r.style.padEnd(8)} no body shell`); fail.push(`${r.style}: no body shell`); continue; }
  console.log(
    r.style.padEnd(8) + String(r.tris).padStart(8) + (r.roll + "%").padStart(8) +
    (r.flank + "%").padStart(8) + String(r.edgeM).padStart(9) + String(r.width).padStart(8)
  );
  if (r.edgeM > 0.07) fail.push(`${r.style}: the shoulder rolls over ${(r.edgeM * 1000).toFixed(0)} mm — a car's panel edge is tens of millimetres, not that`);
  if (r.flank < 20) fail.push(`${r.style}: only ${r.flank}% of the body faces squarely out of the side — the roll has eaten the panel`);
}
mkdirSync("press/edges", { recursive: true });
writeFileSync("press/edges/cars.json", JSON.stringify(rows, null, 2));
console.log("");
console.log(fail.length ? `FAILURES:\n - ${fail.join("\n - ")}` : "every body has panels that meet at edges");
process.exit(fail.length ? 1 : 0);
