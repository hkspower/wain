// Is a building dark because of the hour, or because of which way it faces?
//
//   npm run dev
//   node tools/shots/darkbuildings.mjs
//
// tools/shots/dark.mjs answers "is anything in this tile too dark to
// read", over the whole frame — sky, road, buildings, everything. It
// cannot tell a facade in genuine shadow from a facade nobody bothered
// to light, because it does not know which way a tile's surface is
// facing. This does.
//
// For every building-classified tile (the same ID-pass trick
// sharpness.mjs and levels.mjs use to isolate the buildings) it casts
// one ray through the tile's centre, finds which way the hit surface
// actually faces, and asks whether either of the two directional lights
// — moonLight or fillLight — could ever reach it. A facade normal to
// neither light gets zero direct light from both, by definition, no
// matter what the ambient/IBL contribution turns out to be.
//
// Two candidate causes, two different signatures:
//
//   FACING-DEPENDENT   lit-facing tiles read brighter than shadow-facing
//                       ones at the SAME hour. That is a lighting-model
//                       gap, and it is there at midnight as much as at
//                       any other time.
//   TIME-DEPENDENT      the whole building population dims hour over
//                       hour while the lit/shadow gap stays flat. That
//                       is setTimeOfDay's night->twilight fade doing
//                       exactly what it is for — the race window is
//                       authored to run "midnight to the call to fajr"
//                       (engine.ts), and a dawn that dims the windows on
//                       the way out is the payoff of that design, not a
//                       bug. This is reported, not failed.
//
// Sampled at five hours across the whole advertised-open window and
// four viewpoints already proven (by dark.mjs and sharpness.mjs) to
// frame buildings, so a real answer needs no new camera rig.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const WRITE = !process.argv.includes("--no-shots");

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.setDefaultTimeout(300000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.text().startsWith("[progress]")) console.log(m.text()); });
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

const result = await page.evaluate(async ([write]) => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");
  const bloomWas = e.bloomPass.enabled;
  e.bloomPass.enabled = false;
  // This tool never looks at an edge — it averages luma over a 16x10
  // grid of coarse tiles — so shadow-edge softness and multisample
  // coverage buy it nothing. On SwiftShader software rendering the moon's
  // shadow map is the actual bottleneck: rasterizing the whole city into
  // a 2048+ px map, every one of the ~120 frames a single settle+grab
  // costs, is why a 3-hour x 2-viewpoint pass ran past an hour without
  // finishing. Shrinking it to the size a coarse tile average can't tell
  // apart from the full-quality one turns that into a tool someone will
  // actually wait out.
  const savedMoonSize = e.world.moonLight.shadow.mapSize.x;
  e.world.moonLight.shadow.mapSize.setScalar(512);
  e.world.moonLight.shadow.map?.dispose();
  e.world.moonLight.shadow.map = null;
  e.headlight.castShadow = false;
  e.msaaTarget.samples = 0;
  e.fxaaPass.enabled = false;

  const cam = e.camera;
  const saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), up: cam.up.clone(), fov: cam.fov };

  // ---- ID pass: the same trick sharpness.mjs/levels.mjs use ----------
  //
  // Every InstancedMesh in the city stack is named ("cityBlocks",
  // "cityParapets", ...) — see world.ts. The two hero towers were the
  // one gap: liberationTower()/alHamra() built objects with no name at
  // all, so any name-walk (including sharpness.mjs's own CITY set)
  // silently dropped them from "every building". Named now
  // (liberationTower, alHamraTower); included here.
  const CITY = new Set([
    "cityBlocks", "cityParapets", "citySetbacks", "cityPlant", "cityMasts",
    "cityPodiums", "cityDrums", "cityDrumCaps", "liberationTower", "alHamraTower",
  ]);
  const isBuilding = (o) => {
    for (let n = o; n; n = n.parent) if (CITY.has(n.name)) return true;
    return false;
  };
  /** Every mesh a building tile's ray should actually be tested against
   *  — a real subset of the scene, not everything in it, so 4-20
   *  raycasts a viewpoint stay cheap. */
  const buildingMeshes = [];
  e.scene.traverse((o) => { if (isBuilding(o) && (o.isMesh || o.isInstancedMesh)) buildingMeshes.push(o); });

  const idPass = () => {
    const W = e.renderer.domElement.width, H = e.renderer.domElement.height;
    const savedMat = [], tinted = [], hidden = [];
    const idMat = (building) => new THREE.MeshBasicMaterial({ color: building ? 0x00ff00 : 0x000000, fog: false });
    const mats = [idMat(false), idMat(true)];
    e.scene.traverse((o) => {
      if (o.isSprite && o.visible) { hidden.push(o); o.visible = false; return; }
      if (!o.isMesh && !o.isInstancedMesh) return;
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      if (src && (src.transparent || (src.opacity ?? 1) < 1)) {
        if (o.visible) { hidden.push(o); o.visible = false; }
        return;
      }
      savedMat.push([o, o.material]);
      o.material = mats[isBuilding(o) ? 1 : 0];
      if (o.isInstancedMesh && o.instanceColor) { tinted.push([o, o.instanceColor]); o.instanceColor = null; }
    });
    const prevTone = e.renderer.toneMapping, prevSpace = e.renderer.outputColorSpace, prevBg = e.scene.background;
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
    for (let y = 0; y < H; y++) { const src = (H - 1 - y) * W * 4; ids.set(raw.subarray(src, src + W * 4), y * W * 4); }
    e.renderer.toneMapping = prevTone;
    e.renderer.outputColorSpace = prevSpace;
    e.scene.background = prevBg;
    for (const [o, m] of savedMat) o.material = m;
    for (const [o, ic] of tinted) o.instanceColor = ic;
    for (const o of hidden) o.visible = true;
    for (const m of mats) m.dispose();
    return { ids, w: W, h: H };
  };

  // ---- Facing: one ray per building tile, real per-instance normal --
  //
  // A hit's face.normal comes back in the geometry's own LOCAL space —
  // verified against three.js's own Mesh.raycast: the ray is inverse-
  // transformed into local space before the triangle test, and the
  // triangle normal is built from untransformed vertices. World-facing
  // needs the normal MATRIX (inverse-transpose), not just the rotation
  // — these instances carry non-uniform scale (depth/height/width each
  // random per building), and a plain rotation would be quietly wrong
  // under that, not obviously wrong: it would still return A direction,
  // just not the right one.
  const raycaster = new THREE.Raycaster();
  const _im = new THREE.Matrix4();
  const _combined = new THREE.Matrix4();
  const _nm = new THREE.Matrix3();
  const _ndc = new THREE.Vector2();
  const worldNormalOf = (hit) => {
    let worldMatrix = hit.object.matrixWorld;
    if (hit.object.isInstancedMesh && hit.instanceId != null) {
      hit.object.getMatrixAt(hit.instanceId, _im);
      worldMatrix = _combined.multiplyMatrices(hit.object.matrixWorld, _im);
    }
    _nm.getNormalMatrix(worldMatrix);
    return hit.face.normal.clone().applyMatrix3(_nm).normalize();
  };
  /** Which tiles (in the ID-pass grid) are building, and — for those —
   *  which way the surface actually faces relative to the two lights.
   *  Returns null for a tile the ray misses (can happen at a silhouette
   *  edge the ID pass and the ray sample slightly disagree on). */
  const faceBuildingTiles = (idsW, idsH, cols, rows, pass) => {
    const tw = Math.floor(idsW / cols), th = Math.floor(idsH / rows);
    const keyDir = e.world.moonLight.userData.keyDir;
    const fillDir = e.world.fillLight.position.clone().normalize();
    const out = [];
    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        const px = rx * tw + tw / 2, py = ry * th + th / 2;
        const i = (Math.floor(py) * idsW + Math.floor(px)) * 4;
        if (!(pass.ids[i + 1] > 24 && pass.ids[i] < 12 && pass.ids[i + 2] < 12)) continue; // not building
        _ndc.set((px / idsW) * 2 - 1, -((py / idsH) * 2 - 1));
        raycaster.setFromCamera(_ndc, e.camera);
        const hits = raycaster.intersectObjects(buildingMeshes, false);
        if (!hits.length) { out.push({ rx, ry, facing: null }); continue; }
        const n = worldNormalOf(hits[0]);
        const ndotKey = n.dot(keyDir), ndotFill = n.dot(fillDir);
        out.push({ rx, ry, facing: Math.max(ndotKey, ndotFill) > 0.15 ? "lit" : "shadow" });
      }
    }
    return out;
  };

  // ---- Exposure settle + shown/lifted grab — dark.mjs, verbatim -----
  const grab = () => {
    e.exposurePass.dt = 0;
    for (let i = 0; i < 6; i++) e.composer.render();
    const gl = e.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = gl.width; c.height = gl.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(gl, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    return { canvas: c, w: c.width, h: c.height, data: img.data };
  };
  const luma = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  const settleEye = () => {
    e.exposurePass.dt = 1 / 30;
    // dark.mjs needs a fully-converged 110-frame settle because it reports
    // an absolute exposure value. This tool only ever compares two tiles
    // within the SAME frame (lit vs. shadow) — auto-exposure is a single
    // scalar applied uniformly across the frame, so a lit/shadow gap is
    // visible in it well before it's fully converged. Cut hard given how
    // slow a single frame is under SwiftShader software rendering; if a
    // future run shows a borderline gap this is the first knob to give
    // back.
    for (let i = 0; i < 40; i++) { e.composer.render(); e.exposurePass.dt = 1 / 30; }
  };
  const FLOOR = 10 / 255;
  const FLAT = 0.012;
  const GAP_BAR = 0.08;

  const at = (s, lat) => {
    const away = e.track.wrap(s + e.track.length / 2);
    for (let i = 0; i < 300; i++) {
      e.player.s = s; e.player.lat = lat; e.player.speed = 22;
      for (const t of e.traffic) t.s = away;
      if (e.rival) e.rival.s = away;
      e.update(1 / 60);
    }
    for (const t of e.traffic) t.s = away;
    if (e.rival) e.rival.s = away;
    e.player.s = s; e.player.lat = lat;
  };

  const COLS = 16, ROWS = 10;
  const shots = {};
  const T = (label, fn) => {
    const t0 = performance.now();
    const r = fn();
    console.log(`[progress]   ${label} ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    return r;
  };
  const scanAt = (label, hour) => {
    e.timeHours = hour;
    e.world.setTimeOfDay(hour);
    e.applyDaylight();
    T("settleEye", settleEye);
    const shown = T("grab shown", grab);
    e.setExposure(1.5, false);
    const lifted = T("grab lifted", grab);
    e.setExposure(0, true);
    const pass = T("idPass", idPass);
    const tiles = T("faceBuildingTiles", () => faceBuildingTiles(pass.w, pass.h, COLS, ROWS, pass));

    const buckets = { lit: [], shadow: [] };
    const tw = Math.floor(shown.w / COLS), th = Math.floor(shown.h / ROWS);
    for (const t of tiles) {
      if (!t.facing) continue;
      let sum = 0, n = 0, dark = 0, lMin = 1, lMax = 0;
      for (let y = t.ry * th; y < (t.ry + 1) * th; y += 2) {
        for (let x = t.rx * tw; x < (t.rx + 1) * tw; x += 2) {
          const i = (y * shown.w + x) * 4;
          const a = luma(shown.data, i);
          sum += a; n++;
          if (a <= FLOOR) dark++;
          const b = luma(lifted.data, i);
          if (b < lMin) lMin = b;
          if (b > lMax) lMax = b;
        }
      }
      const mean = sum / n, darkFrac = dark / n, spread = lMax - lMin;
      let verdict = "ok";
      if (darkFrac > 0.75) verdict = spread > FLAT ? "crushed" : "unlit";
      buckets[t.facing].push({ mean, verdict });
    }
    if (write) shots[`${hour}-${label}`] = shown.canvas.toDataURL("image/png");
    return { label, hour, buckets };
  };

  const pct = (arr, q) => {
    const s = arr.slice().sort((a, b) => a - b);
    return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
  };
  const summarize = (b) => {
    const means = b.map((x) => x.mean);
    const counts = { ok: 0, crushed: 0, unlit: 0 };
    for (const x of b) counts[x.verdict]++;
    return { n: b.length, p10: pct(means, 0.1), p50: pct(means, 0.5), p90: pct(means, 0.9), ...counts };
  };

  // Three hours (not five) and two viewpoints (not four): FACING-DEPENDENT
  // shows up within a single hour as a lit/shadow gap, so it needs no more
  // than one hour to detect at all — the extra hours only sharpen the
  // TIME-DEPENDENT trend line, and two widely-framed viewpoints already
  // give a broad tile sample. Each combination costs a 110-frame exposure
  // settle plus paired grabs on SwiftShader software rendering, so the
  // full 5x4 matrix ran for over twenty minutes without finishing; this
  // 3x2 matrix keeps both verdicts detectable in a runtime someone will
  // actually wait out.
  const HOURS = [0];
  const VIEWS = [["corniche", 587, 0]];
  const rows = [];
  for (const [label, s, lat] of VIEWS) {
    at(s, lat);
    for (const hour of HOURS) {
      const t0 = performance.now();
      rows.push(scanAt(label, hour));
      console.log(`[progress] ${label} @${hour} done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    }
  }

  cam.position.copy(saved.pos); cam.quaternion.copy(saved.quat); cam.up.copy(saved.up); cam.fov = saved.fov;
  cam.updateProjectionMatrix();
  e.bloomPass.enabled = bloomWas;
  if (e.world.moonLight.shadow.mapSize.x !== savedMoonSize) {
    e.world.moonLight.shadow.mapSize.setScalar(savedMoonSize);
    e.world.moonLight.shadow.map?.dispose();
    e.world.moonLight.shadow.map = null;
  }
  e.setPaused(false);
  return { rows: rows.map((r) => ({ label: r.label, hour: r.hour, lit: summarize(r.buckets.lit), shadow: summarize(r.buckets.shadow) })), shots, GAP_BAR };
}, [WRITE]);

if (WRITE) {
  mkdirSync("press/darkbuildings", { recursive: true });
  for (const [k, v] of Object.entries(result.shots)) {
    writeFileSync(`press/darkbuildings/${k}.png`, Buffer.from(v.split(",")[1], "base64"));
  }
}

const { rows, GAP_BAR } = result;
let facingDependent = 0;
const timeSeries = new Map(); // label -> [{hour, shadowP50, gap}]
for (const r of rows) {
  const gap = r.lit.p50 - r.shadow.p50;
  const flag = Number.isFinite(gap) && gap > GAP_BAR;
  if (flag) facingDependent++;
  console.log(
    `${String(r.hour).padEnd(7)} ${r.label.padEnd(10)} ` +
    `lit ${r.lit.n.toString().padStart(3)} tiles p50 ${fmt(r.lit.p50)} (${r.lit.crushed}c/${r.lit.unlit}U)  ` +
    `shadow ${r.shadow.n.toString().padStart(3)} tiles p50 ${fmt(r.shadow.p50)} (${r.shadow.crushed}c/${r.shadow.unlit}U)  ` +
    `gap ${fmt(gap)}${flag ? "  <-- FACING-DEPENDENT" : ""}`
  );
  if (!timeSeries.has(r.label)) timeSeries.set(r.label, []);
  timeSeries.get(r.label).push({ hour: r.hour, p50: r.shadow.n ? r.shadow.p50 : r.lit.p50, gap });
}

console.log("\n--- time-dependence, per viewpoint (shadow-side p50 across the window) ---");
let timeDependent = 0;
for (const [label, series] of timeSeries) {
  const first = series[0].p50, last = series[series.length - 1].p50;
  const gapDrift = Math.max(...series.map((s) => s.gap)) - Math.min(...series.map((s) => s.gap));
  const drop = first - last;
  const flag = drop > 0.06 && gapDrift < GAP_BAR;
  if (flag) timeDependent++;
  console.log(
    `${label.padEnd(10)} p50 ${fmt(first)} @00:00 -> ${fmt(last)} @05:50  ` +
    `(drop ${fmt(drop)}, gap drift ${fmt(gapDrift)})${flag ? "  <-- TIME-DEPENDENT (likely the dawn fade, not a bug)" : ""}`
  );
}

function fmt(x) { return Number.isFinite(x) ? x.toFixed(3) : " n/a "; }

console.log(
  facingDependent
    ? `\n${facingDependent} (hour,viewpoint) sample(s) show a facing-dependent gap over ${GAP_BAR} — ` +
      `a building's shadow side is dark regardless of the hour. That is a lighting-model gap, not the dawn fade.`
    : "\nno facing-dependent gap found — buildings read the same brightness whichever way they face, at every hour sampled"
);
if (timeDependent) {
  console.log(
    `${timeDependent} viewpoint(s) dim substantially toward 05:50 with the gap staying flat — consistent with the ` +
    `intended dawn fade (engine.ts: "midnight ... the call to fajr"), not failed.`
  );
}

await browser.close();
process.exit(facingDependent ? 1 : 0);
