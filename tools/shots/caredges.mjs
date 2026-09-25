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
//   flank%  area facing squarely out of the side, within 15 degrees —
//           the panel a livery lands on and a reflection runs along.
//           Reported rather than judged: measured across a two-thirds
//           cut in edge radius it barely moved, because what governs it
//           is crownShell tucking the whole flank, not the bevel
//           rolling its corner.
//   shell   PROCEDURAL or AUTHORED. This is the thing the tool got
//           wrong for its whole life and it changes every other number
//           in the row. __grnBuildCar returns the procedural shell and
//           the Blender one is swapped in later, asynchronously — so a
//           tool that builds a car and measures it immediately measures
//           the stand-in, not the car. Both are now reported, because
//           both are real: the procedural shell is what the game draws
//           until the download lands, and on this box that is tens of
//           seconds.
//   edge m  the roll at the shoulder, in metres: the MEDIAN of ten
//           stations along the bonnet, with the range beside it and how
//           many of the ten had a shoulder to measure at all. Measured
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
  e.timeReal = false; e.timeCycling = false; e.timeHours = 2.5; e.world.setTimeOfDay(2.5); e.applyDaylight(); e.setExposure(0, false);
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

// Build every car FIRST, so the nine Blender downloads run together
// rather than one after another, then measure each shell twice: as
// built, and again once the authored geometry has landed.
const built = await page.evaluate(() => {
  const STYLES = window.__grnStyles ?? ["sedan", "zx", "gtr", "rx7", "hatch", "pony"];
  window.__edgeCars = STYLES.map((style) => ({
    style, g: window.__grnBuildCar({ body: 0xffffff, style }),
  }));
  return STYLES;
});
const measure = await page.evaluate(() => {
  window.__edgeMeasure = () => {
  const THREE = window.__grnThree;
  const out = [];
  const AX = [
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
  ];
  // EVERY silhouette, from the game's own table rather than from a list
  // kept here. The list kept here went stale twice: the pony was left
  // off when this was written, and the pickup and the super were added
  // to the roster afterwards and so were never measured at all — two of
  // eight bodies whose edges nobody had ever looked at, in the tool
  // whose whole job is looking at edges.
  for (const { style, g } of window.__edgeCars) {
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

    // The roll at the shoulder, in metres.
    //
    // Measured over the BONNET, at ten stations, not at mid-door and not
    // at one.
    //
    // At the door station a car's body has no top face at all — the roof
    // there is the canopy, a separate shell, and the body's top edge is
    // the cut line under the glass. Two of the six bodies have no
    // horizontal surface at that station for a walk to start from.
    // Forward of the cowl every body has a bonnet, and the shoulder line
    // along it is the edge a headlight sweeps down and the one people
    // mean when they say a car looks sharp.
    //
    // One station on the bonnet is still not a measurement of the EDGE.
    // The span from the flat of the deck to the flank is the bevel plus
    // whatever the profile is doing there, and the profile is doing
    // something different at every station: measured at a single point
    // the same 26 mm bevel read 56 mm on the domed nose of the rx7 and
    // nothing at all on the hatch. The bevel is the one thing that is
    // constant along the shoulder, so the number that isolates it is the
    // TIGHTEST station — the profile can only ever soften the edge, so
    // where the body is doing least, what is left is the bevel.
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const probe = new THREE.Mesh(geo);
    probe.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.far = 60;
    const org = new THREE.Vector3(), dir = new THREE.Vector3(-1, 0, 0);
    const FLAT = 0.26; //  75 degrees off sideways: the deck
    const SIDE = 0.97; //  15 degrees off sideways: the flank
    const zMid = (bb.min.z + bb.max.z) / 2;
    const spans = [];
    let blank = 0;
    let hits = [];
    for (let s = 0; s < 10; s++) {
      const z = zMid + (0.3 + 0.06 * s) * (bb.max.z - zMid);
      const at = [];
      for (let i = 0; i <= 600; i++) {
        const y = bb.min.y + ((bb.max.y - bb.min.y) * i) / 600;
        org.set(30, y, z);
        ray.set(org, dir);
        const h = ray.intersectObject(probe, false);
        if (!h.length || !h[0].face) continue;
        at.push({ y, x: h[0].point.x, nx: Math.abs(h[0].face.normal.x) });
      }
      // Both ends are unambiguous from the top down. The top face of the
      // body points up; the flank points sideways; the shoulder is the
      // span between them. Measured from the deck rather than from a
      // maximum, there is no spike to land on — which is what the walk
      // this replaces did, reporting its own sampling step as a 1 to
      // 6 mm edge on every body in the fleet.
      let deck = -1;
      for (let i = at.length - 1; i >= 0; i--) if (at[i].nx <= FLAT) { deck = i; break; }
      let flankAt = -1;
      for (let i = deck; i >= 0; i--) if (at[i].nx >= SIDE) { flankAt = i; break; }
      // A span shorter than a few sampling steps is the deck and the
      // flank landing on adjacent samples, not an edge: nine facets
      // turning ninety degrees cannot do it in four millimetres at any
      // radius this shell is built with. Dropped rather than averaged
      // in, because five of them in ten drags a median to nothing.
      const step = (bb.max.y - bb.min.y) / 600;
      const span = deck > 0 && flankAt >= 0 ? at[deck].y - at[flankAt].y : -1;
      if (span > step * 3) {
        spans.push(span);
        if (!hits.length) hits = at;
      } else blank++;
    }
    // The MEDIAN of the ten, not the tightest.
    //
    // The tightest was the next version of the same mistake: at one
    // station in ten the deck and the flank land on adjacent samples and
    // the span comes back as the sampling step, so five of six bodies
    // reported a 1 to 3 mm edge again. A single sample cannot be
    // outvoted; a median can.
    spans.sort((a, b) => a - b);
    const edgeM = spans.length ? spans[Math.floor(spans.length / 2)] : 0;
    const edgeMin = spans.length ? spans[0] : 0;
    const edgeMax = spans.length ? spans[spans.length - 1] : 0;
    const silhouette = hits.filter((_, i) => i % 20 === 0).map((h) => [
      +h.y.toFixed(3), +h.x.toFixed(3), +h.nx.toFixed(2),
    ]);

    out.push({
      style, ok: true, tris: tri,
      shell: geo.userData?.authored ? "authored" : "procedural",
      roll: +((roll / area) * 100).toFixed(1),
      flank: +((flank / area) * 100).toFixed(1),
      edgeM: +edgeM.toFixed(3), edgeMin: +edgeMin.toFixed(3), edgeMax: +edgeMax.toFixed(3),
      stations: spans.length, blank, silhouette,
      width: +(bb.max.x * 2).toFixed(3),
    });
  }
  return out;
  };
  return true;
});
void measure;
const procedural = await page.evaluate(() => window.__edgeMeasure());
// Wait for the Blender shells, then measure the same cars again. They
// arrive per file and the loads were all started together above.
const arrived = await page.evaluate(async (quick) => {
  const deadline = performance.now() + (quick ? 0 : 240000);
  const authored = () =>
    window.__edgeCars.filter(({ g }) =>
      g.children.find((o) => o.userData?.shell === "body")?.geometry.userData?.authored).length;
  while (performance.now() < deadline && authored() < window.__edgeCars.length) {
    await new Promise((r) => setTimeout(r, 500));
  }
  return { got: authored(), of: window.__edgeCars.length };
}, process.env.EDGE_QUICK === "1");
const rows = await page.evaluate(() => window.__edgeMeasure());
await browser.close();
console.log(`shells       ${arrived.got} of ${arrived.of} authored shells arrived\n`);

const table = (label, list) => {
  console.log(
    `\n${label}`.padEnd(8) + "tris".padStart(8) + "shell".padStart(12) + "roll%".padStart(8) +
    "flank%".padStart(8) + "edge m".padStart(9) + "range".padStart(14) + "sta".padStart(5) + "width".padStart(8)
  );
  for (const r of list) {
    if (!r.ok) { console.log(`${r.style.padEnd(8)} no body shell`); continue; }
    console.log(
      r.style.padEnd(8) + String(r.tris).padStart(8) + r.shell.padStart(12) + (r.roll + "%").padStart(8) +
      (r.flank + "%").padStart(8) + String(r.edgeM).padStart(9) +
      `${r.edgeMin}-${r.edgeMax}`.padStart(14) + String(r.stations).padStart(5) + String(r.width).padStart(8)
    );
  }
};
table("as built", procedural);
table("shipped", rows);
const fail = [];

// --- Does the stand-in look like the car it stands in for? ------------
//
// The Blender shell is not instant. It arrives per file, asynchronously,
// and until it does the game draws the procedural one — on this box that
// is tens of seconds of every race, and if the download fails it is the
// whole race (models.ts: "404 / parse failure -> procedural stands").
// So a stand-in whose shoulder rolls over four times as far as the shell
// that replaces it is a car that changes shape mid-corner.
//
// Anything already under 50 mm passes outright whatever the ratio: a
// 40 mm shoulder is a car, and a ratio between two tight numbers is
// noise rather than a finding.
//
// DO NOT FIX THIS BY TURNING CrownSpec.smooth BACK OFF. It is the
// obvious move and it is wrong. Measured, with the body crown stepped
// as it was before it was smoothed:
//
//        stepped   smoothed        stepped   smoothed
//   sedan   21 mm     82 mm    gtr    40 mm     19 mm
//   zx      38 mm     88 mm    rx7    31 mm     21 mm
//   pony    30 mm    132 mm    hatch  23 mm     23 mm
//   pickup  45 mm    104 mm    super  44 mm     17 mm
//
// Four got softer and four got sharper — and the stepped numbers are
// flattered by the thing that was wrong with a stepped crown in the
// first place. This walk finds the deck by its NORMAL and then the
// flank by its normal; across a faceted surface the normal jumps, so
// the walk terminates early and reports a tight shoulder on a shell
// whose bonnet is a venetian blind. roll% says the same thing from the
// other side: it FELL on all eight when the crown was smoothed, which
// is less of each body given over to rolled-over edge.
//
// So the trade was a real one and it went the right way. What is left
// is to bring the smoothed stand-in's crown nearer the Blender shell's
// shape, per silhouette — not to put the corrugation back.
const STANDIN_RATIO = 2.5;
const STANDIN_FLOOR = 0.05;
const byStyle = new Map(procedural.map((r) => [r.style, r]));
console.log("\nstand-in vs shipped");
for (const r of rows) {
  if (!r.ok) continue;
  const p = byStyle.get(r.style);
  if (!p?.ok) continue;
  const ratio = r.edgeM > 0 ? p.edgeM / r.edgeM : 0;
  const bad = p.edgeM > STANDIN_FLOOR && ratio > STANDIN_RATIO;
  console.log(
    `${r.style.padEnd(8)} ${(p.edgeM * 1000).toFixed(0).padStart(4)} mm as built vs ` +
    `${(r.edgeM * 1000).toFixed(0).padStart(3)} mm shipped  (${ratio.toFixed(1)}x)  ${bad ? "FAIL" : "ok"}`
  );
  if (bad)
    fail.push(
      `${r.style}: the stand-in's shoulder rolls ${(p.edgeM * 1000).toFixed(0)} mm against the ` +
      `shipped shell's ${(r.edgeM * 1000).toFixed(0)} — the car changes shape when the download lands`
    );
}
console.log("");
for (const r of rows) {
  if (!r.ok) { fail.push(`${r.style}: no body shell`); continue; }
  if (process.env.EDGE_DEBUG === "1")
    console.log(`   ${r.style}: ${r.stations} stations measured, ${r.blank} with no shoulder\n   ` +
      r.silhouette.map(([y,x,nx])=>`y${y} x${x} nx${nx}`).join("\n   "));
  if (r.edgeM > 0.05) fail.push(`${r.style}: the shoulder rolls over ${(r.edgeM * 1000).toFixed(0)} mm — a car's panel edge is tens of millimetres, not that`);
  // flank% is REPORTED, not gated. It barely moved when the edge radius
  // was cut by two thirds, because what holds it down is crownShell's
  // tuck curving the whole flank rather than the bevel rolling its top
  // corner — so a gate on it would fail for a reason that has nothing to
  // do with edge sharpness, which is what this tool is for. A check that
  // fires on something other than its own subject is worse than none.
}
mkdirSync("press/edges", { recursive: true });
writeFileSync("press/edges/cars.json", JSON.stringify({ procedural, shipped: rows }, null, 2));
console.log("");
console.log(fail.length ? `FAILURES:\n - ${fail.join("\n - ")}` : "every body has panels that meet at edges");
process.exit(fail.length ? 1 : 0);
