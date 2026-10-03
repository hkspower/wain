// What a date palm looks like on screen, at noon, in the afternoon and at
// night.
//
//   npm run dev
//   node tools/shots/palms.mjs            # writes press/palms/*.png too
//   node tools/shots/palms.mjs --no-shots
//
// tests/palms.mjs holds the crown, the colour, the atlas, the trunk and
// the placement to their numbers in node, which is exact and fast and
// says nothing about the PICTURE: the grade, the tone map, the night
// IBL, a sodium lamp twelve metres up and the vibrance of 0.8 all sit
// between a vertex colour and the pixel. This is the other half. It
// poses one corniche palm against the sky, renders it three ways — all,
// crowns hidden, trunks hidden — and measures the difference.
//
// THE POSE. The sea-side palm nearest s = 2404 (the stretch the lock,
// brake and drift stills look down), seen from the outer lane 18 m
// before it, 1.2 m up — a driver's eye — looking at the crown's centre,
// so the crown stands against sky. 1280x720, tier "high", bloom off (it
// smears a hidden mesh's absence across the frame), exposure settled
// and then frozen (it is a feedback loop and would re-level between the
// three frames), and the palms' own shadows off for all three frames,
// so the masks are the meshes and not their shadows on the road. The
// player's car is parked at the camera so the engine's nearest-four
// street lamps are the ones a driver there would have; the report says
// how far the nearest column is, because a lamp-lit crown and an unlit
// one are different pictures.
//
// THE MASKS. A pixel is crown if it moves more than 6 levels when the
// crowns are hidden, trunk likewise. Per hour it reports, over the
// crown: mean sRGB, median HSV saturation and hue, G p99, coverage (crown
// pixels over the area of their convex hull — sky through the head
// lowers it) and the luma contrast against what is behind the crown
// (the same pixels in the crowns-hidden frame); over the trunk: mean
// sRGB, median saturation and hue.
//
// THE BARS, from the palms design:
//   day and afternoon crown   s <= 0.40, hue 60-105
//   night crown               s <= 0.45
//   any hour                  crown G p99 <= 185, coverage 0.50-0.85,
//                             |Y crown - Y behind| / Y behind >= 0.15
//   trunk                     s <= 0.40, hue 20-50
//
// BASELINES. Before the palm.ts crown (palm.glb, 0x3a6b35, the green
// HSL tint), measured off the 4K ik stills rather than by this tool:
// crown saturation 0.52-0.81 in every still (lock 0.59, sweep 0.81,
// brake 0.71, traffic lamp-lit 0.52 with G p99 206), coverage 0.34 inside
// the hull in lock, trunk (58,35,20) at s 0.66. On that tree this tool
// finds the crowns by their old signature (unnamed instanced meshes
// carrying grnBend) and must FAIL the colour and coverage bars — which
// is the proof it can see the fault. The new crown's numbers are to be
// recorded here on its first run; nothing in this environment can
// render a frame.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

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

const WRITE = !process.argv.includes("--no-shots");
const S_TARGET = 2404;
const HOURS = [
  { hour: 12.0, name: "noon", night: false },
  { hour: 16.0, name: "afternoon", night: false },
  { hour: 22.5, name: "night", night: true },
];

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
await page.waitForTimeout(4000);

const measure = (h) => page.evaluate(async ([h, S, write]) => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");
  e.timeReal = false; e.timeCycling = false; e.timeHours = h.hour;
  e.world.setTimeOfDay(h.hour);
  e.applyDaylight();

  // The palms, by name — or, on a tree from before palm.ts, by the old
  // crown's signature: unnamed, instanced, carrying the bend attribute.
  const crowns = [], trunks = [];
  e.scene.traverse((o) => {
    if (!o.isInstancedMesh) return;
    if (/^palm-crowns/.test(o.name)) crowns.push(o);
    else if (o.name === "palm-trunks") trunks.push(o);
  });
  let legacy = false;
  if (!crowns.length) {
    legacy = true;
    e.scene.traverse((o) => {
      if (o.isInstancedMesh && !o.name && o.geometry.getAttribute("grnBend")) crowns.push(o);
    });
    e.scene.traverse((o) => {
      if (o.isInstancedMesh && !o.name && crowns.length && o.count === crowns[0].count && o !== crowns[0]
          && o.geometry.type === "CylinderGeometry") trunks.push(o);
    });
  }
  if (!crowns.length) return { error: "no palm crowns found" };

  // The sea-side palm nearest S.
  const want = new THREE.Vector3(), tmp = new THREE.Vector3();
  e.track.pose(S, -(e.track.halfWidthAt(S) + 2.6), want, tmp);
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), scl = new THREE.Vector3();
  let best = null;
  for (const im of crowns) {
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      m.decompose(pos, q, scl);
      const d = Math.hypot(pos.x - want.x, pos.z - want.z);
      if (!best || d < best.d) best = { d, im, i, matrix: m.clone(), pos: pos.clone(), scale: scl.x };
    }
  }
  // The palm's own s, by search near S.
  let sPalm = S, dBest = Infinity;
  for (let s = S - 20; s <= S + 20; s += 0.25) {
    e.track.pointAt(s, tmp);
    const side = new THREE.Vector3();
    e.track.sideAt(s, side);
    const lat = (best.pos.x - tmp.x) * side.x + (best.pos.z - tmp.z) * side.z;
    tmp.addScaledVector(side, lat);
    const d = Math.hypot(best.pos.x - tmp.x, best.pos.z - tmp.z);
    if (d < dBest) { dBest = d; sPalm = s; }
  }
  const geo = best.im.geometry;
  geo.computeBoundingBox();
  const centre = geo.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(best.matrix);

  // Nearest street column, for "lamp-lit or not".
  let lampDist = Infinity;
  e.scene.traverse((o) => {
    if (!o.isInstancedMesh || o.name !== "street-columns") return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      m.decompose(pos, q, scl);
      if (scl.x === 0) continue;
      lampDist = Math.min(lampDist, Math.hypot(pos.x - best.pos.x, pos.z - best.pos.z));
    }
  });

  // Park everything: traffic and the rival across the lap, the player at
  // the camera (so the engine's lamp pick is a driver's there), hidden.
  const camS = sPalm - 18;
  const park = () => {
    const away = e.track.wrap(camS + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
    e.player.s = camS; e.player.lat = 1.75; e.player.speed = 0;
  };
  park();
  for (let i = 0; i < 60; i++) { e.update(1 / 60); park(); }
  const playerVis = e.playerMesh ? e.playerMesh.visible : true;
  if (e.playerMesh) e.playerMesh.visible = false;

  const cam = e.camera;
  const saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), up: cam.up.clone(), fov: cam.fov };
  e.track.pose(camS, 1.75, tmp, new THREE.Vector3());
  cam.up.set(0, 1, 0);
  cam.position.set(tmp.x, 1.2, tmp.z);
  cam.lookAt(centre);
  cam.fov = 50;
  cam.updateProjectionMatrix();

  const bloomWas = e.bloomPass.enabled;
  e.bloomPass.enabled = false;
  const cast = [...crowns, ...trunks].map((o) => [o, o.castShadow]);
  for (const [o] of cast) o.castShadow = false;
  e.renderer.shadowMap.needsUpdate = true;
  for (let i = 0; i < 60; i++) e.composer.render(); // exposure settles
  e.exposurePass.dt = 0; // ...and is held

  const gl = e.renderer.domElement;
  const W = gl.width, H = gl.height;
  const grab = () => {
    for (let i = 0; i < 3; i++) e.composer.render();
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    x.drawImage(gl, 0, 0);
    return { data: x.getImageData(0, 0, W, H).data, url: write ? c.toDataURL("image/png") : null };
  };
  const all = grab();
  for (const o of crowns) o.visible = false;
  const noCrown = grab();
  for (const o of crowns) o.visible = true;
  for (const o of trunks) o.visible = false;
  const noTrunk = grab();
  for (const o of trunks) o.visible = true;

  // Restore.
  for (const [o, c] of cast) o.castShadow = c;
  e.renderer.shadowMap.needsUpdate = true;
  e.bloomPass.enabled = bloomWas;
  if (e.playerMesh) e.playerMesh.visible = playerVis;
  cam.position.copy(saved.pos); cam.quaternion.copy(saved.quat); cam.up.copy(saved.up); cam.fov = saved.fov;
  cam.updateProjectionMatrix();

  const Y = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const hsvOf = (r, g, b) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hue = 0;
    if (d > 0) {
      if (mx === r) hue = 60 * (((g - b) / d) % 6);
      else if (mx === g) hue = 60 * ((b - r) / d + 2);
      else hue = 60 * ((r - g) / d + 4);
    }
    if (hue < 0) hue += 360;
    return { s: mx > 0 ? d / mx : 0, h: hue };
  };
  const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const stats = (a, b) => {
    const px = [], sats = [], hues = [], gs = [];
    let r = 0, g = 0, bl = 0, yIn = 0, yBehind = 0;
    for (let i = 0, k = 0; i < a.data.length; i += 4, k++) {
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d <= 6) continue;
      px.push([k % W, Math.floor(k / W)]);
      r += a.data[i]; g += a.data[i + 1]; bl += a.data[i + 2];
      const c = hsvOf(a.data[i], a.data[i + 1], a.data[i + 2]);
      sats.push(c.s); hues.push(c.h); gs.push(a.data[i + 1]);
      yIn += Y(a.data, i); yBehind += Y(b.data, i);
    }
    const n = px.length;
    if (!n) return { px: 0 };
    // Convex hull (monotone chain) and its area.
    px.sort((p1, p2) => p1[0] - p2[0] || p1[1] - p2[1]);
    const cross = (o, p1, p2) => (p1[0] - o[0]) * (p2[1] - o[1]) - (p1[1] - o[1]) * (p2[0] - o[0]);
    const lower = [], upper = [];
    for (const p of px) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = px.length - 1; i >= 0; i--) { const p = px[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    let area = 0;
    for (let i = 0; i < hull.length; i++) { const p = hull[i], q2 = hull[(i + 1) % hull.length]; area += p[0] * q2[1] - q2[0] * p[1]; }
    area = Math.abs(area) / 2;
    return {
      px: n,
      mean: [r / n, g / n, bl / n].map((x) => +x.toFixed(1)),
      sMed: +median(sats).toFixed(3),
      hueMed: +median(hues).toFixed(1),
      gP99: pct(gs, 0.99),
      coverage: +(area > 0 ? n / area : 0).toFixed(3),
      contrast: +(Math.abs(yIn - yBehind) / Math.max(1e-6, yBehind)).toFixed(3),
    };
  };
  return {
    legacy,
    palm: { s: +sPalm.toFixed(1), scale: +best.scale.toFixed(3), mesh: best.im.name || "(unnamed)", lampDist: +lampDist.toFixed(1) },
    crown: stats(all, noCrown),
    trunk: stats(all, noTrunk),
    shots: write ? { all: all.url } : null,
  };
}, [h, S_TARGET, WRITE]);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
if (WRITE) mkdirSync("press/palms", { recursive: true });
for (const h of HOURS) {
  const r = await measure(h);
  if (r.error) { console.log(`${h.name}: ${r.error}`); fail.push(`${h.name}: ${r.error}`); continue; }
  const c = r.crown, t = r.trunk;
  console.log(`\n${h.name} (${h.hour} h)${r.legacy ? "  [legacy crowns]" : ""}: palm at s ${r.palm.s} in ${r.palm.mesh}, scale ${r.palm.scale}; nearest street column ${r.palm.lampDist} m`);
  if (!c.px) { fail.push(`${h.name}: no crown pixels — the pose missed the palm`); continue; }
  console.log(`  crown  ${c.px} px  mean sRGB (${c.mean.join(",")})  s ${c.sMed}  hue ${c.hueMed}  G p99 ${c.gP99}  coverage ${c.coverage}  contrast ${c.contrast}`);
  const sBar = h.night ? 0.45 : 0.4;
  console.log(`    saturation ${check(c.sMed <= sBar, `${h.name}: crown saturation ${c.sMed} > ${sBar}`)}` +
    (h.night ? "" : `  hue ${check(c.hueMed >= 60 && c.hueMed <= 105, `${h.name}: crown hue ${c.hueMed} outside 60-105`)}`) +
    `  G p99 ${check(c.gP99 <= 185, `${h.name}: crown G p99 ${c.gP99} > 185 (neon under a lamp)`)}` +
    `  coverage ${check(c.coverage >= 0.5 && c.coverage <= 0.85, `${h.name}: crown coverage ${c.coverage} outside 0.50-0.85`)}` +
    `  contrast ${check(c.contrast >= 0.15, `${h.name}: crown/sky contrast ${c.contrast} < 0.15`)}`);
  if (t.px) {
    console.log(`  trunk  ${t.px} px  mean sRGB (${t.mean.join(",")})  s ${t.sMed}  hue ${t.hueMed}`);
    console.log(`    saturation ${check(t.sMed <= 0.4, `${h.name}: trunk saturation ${t.sMed} > 0.40`)}` +
      `  hue ${check(t.hueMed >= 20 && t.hueMed <= 50, `${h.name}: trunk hue ${t.hueMed} outside 20-50`)}`);
  } else {
    console.log("  trunk  not in frame");
  }
  if (WRITE && r.shots?.all) {
    writeFileSync(`press/palms/${h.name}.png`, Buffer.from(r.shots.all.split(",")[1], "base64"));
  }
}
await browser.close();
console.log(fail.length ? `\nFAILURES:\n - ${fail.join("\n - ")}` : "\ndate palms read as date palms, day and night");
process.exit(fail.length ? 1 : 0);
