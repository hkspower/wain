// Shadows: are they thrown, are they landed on, and are they seen?
//
//   npm run dev
//   npm run test:shadows
//
// Three things all have to be true before a shadow exists on screen, and
// this game had two of them for a long time while failing the third in a
// way that looked exactly like a renderer bug:
//
//   1. something casts        — castShadow, and inside the frustum
//   2. something receives     — receiveShadow on what it lands on
//   3. the geometry puts it   — where the camera can see it
//      somewhere visible
//
// Point 3 is the one that bit. The key light's height came from the
// sun's own altitude as |sin|, which is the SAME at midnight and at
// noon, and put the key 56 degrees up at both of the hours this game is
// played. At 56 degrees a 1.3 m car throws 0.9 m of shadow and a car is
// 4.5 m long, so every shadow in the game landed under the floor of the
// thing casting it. Nothing was broken. Nothing was visible either.
//
// So this asserts geometry and wiring rather than pixels wherever it
// can — a pixel count on a software renderer is a noisy thing to hang a
// suite on — and keeps exactly one pixel measurement, the one that
// proves the car's shadow reaches the world at all.

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

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); return ok ? "ok" : "FAIL"; };

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
page.setDefaultTimeout(240000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
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

const r = await page.evaluate(async () => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");
  e.timeHours = 0.5;
  e.world.setTimeOfDay(0.5);
  e.applyDaylight();
  e.player.s = 587; e.player.lat = 0; e.player.speed = 0;
  for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length / 2);
  if (e.rival) e.rival.s = e.track.wrap(e.player.s + e.track.length / 2);
  for (let i = 0; i < 60; i++) e.update(1 / 60);

  const moon = e.world.moonLight;
  const out = {};

  // --- 1. the key rakes -----------------------------------------------
  const toLight = moon.position.clone().sub(moon.target.position);
  out.elevDeg = +((Math.asin(toLight.y / toLight.length()) * 180) / Math.PI).toFixed(1);
  out.throwM = +(1.3 / Math.tan((out.elevDeg * Math.PI) / 180)).toFixed(2);

  // --- 2. receivers ----------------------------------------------------
  let carCast = 0, carRecv = 0;
  for (const car of [e.playerMesh, e.rival?.mesh, e.traffic?.[0]?.mesh]) {
    car?.traverse?.((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (o.material?.isMeshBasicMaterial) return;
      if (o.castShadow) carCast++;
      if (o.receiveShadow) carRecv++;
    });
  }
  out.carCast = carCast; out.carRecv = carRecv;

  const named = {};
  e.scene.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    if (o.name) named[o.name] = { recv: !!o.receiveShadow, cast: !!o.castShadow };
  });
  out.road = named["road"];
  out.line = named["road-line"];
  out.dash = named["road-dash"];
  out.rail = named["guardrail"];

  // --- 3. the frustum --------------------------------------------------
  moon.updateMatrixWorld(true);
  moon.shadow.updateMatrices?.(moon);
  const sc = moon.shadow.camera;
  const orthoW = sc.right - sc.left;
  const half = orthoW / 2;
  const toView = sc.matrixWorldInverse.clone();
  const box = new THREE.Box3(), corner = new THREE.Vector3();
  let dMin = Infinity, dMax = -Infinity, clipped = 0;
  const worst = [];
  e.scene.traverse((o) => {
    if (!o.castShadow || !o.visible) return;
    if (!o.isMesh && !o.isInstancedMesh) return;
    try { box.setFromObject(o); } catch { return; }
    if (box.isEmpty()) return;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y,
                 i & 4 ? box.max.z : box.min.z).applyMatrix4(toView);
      xMin = Math.min(xMin, corner.x); xMax = Math.max(xMax, corner.x);
      yMin = Math.min(yMin, corner.y); yMax = Math.max(yMax, corner.y);
      zMin = Math.min(zMin, -corner.z); zMax = Math.max(zMax, -corner.z);
    }
    if (xMax < -half || xMin > half || yMax < -half || yMin > half) return;
    if (xMax - xMin > orthoW * 4 || yMax - yMin > orthoW * 4) return; // ground planes
    if (zMin < sc.near || zMax > sc.far) {
      clipped++;
      worst.push({ n: o.name || o.type, z: [+zMin.toFixed(0), +zMax.toFixed(0)],
                   xy: [+xMin.toFixed(0), +xMax.toFixed(0), +yMin.toFixed(0), +yMax.toFixed(0)] });
    }
    dMin = Math.min(dMin, zMin); dMax = Math.max(dMax, zMax);
  });
  out.clipped = clipped;
  out.worst = worst.slice(0, 6);
  out.nearFar = [sc.near, sc.far];
  out.depthUse = +(((dMax - dMin) / (sc.far - sc.near)) * 100).toFixed(1);
  out.texelCm = +((orthoW / moon.shadow.mapSize.x) * 100).toFixed(2);
  out.radius = moon.shadow.radius;

  // --- 4. the one pixel measurement ------------------------------------
  // Overhead, because from behind the car its own shadow hides behind
  // it; bloom off, because it smears a hidden car's absence across half
  // the frame; exposure frozen, because it is a feedback loop and would
  // otherwise re-level between the two frames being compared.
  const bloomWas = e.bloomPass.enabled;
  e.bloomPass.enabled = false;
  const cam = e.camera;
  const p = new THREE.Vector3(), side = new THREE.Vector3(), tan = new THREE.Vector3();
  e.track.pose(e.player.s, 0, p, side);
  e.track.tangentAt(e.player.s, tan);
  cam.up.set(-tan.x, 0, -tan.z);
  cam.position.set(p.x, 22, p.z);
  cam.lookAt(p.x, 0, p.z);
  cam.fov = 40;
  cam.updateProjectionMatrix();

  const grab = () => {
    e.exposurePass.dt = 0;
    for (let i = 0; i < 6; i++) e.composer.render();
    const gl = e.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = gl.width; c.height = gl.height;
    const x = c.getContext("2d");
    x.drawImage(gl, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  };
  const lum = (d, i) => d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722;
  const strength = () => {
    moon.castShadow = true; e.renderer.shadowMap.needsUpdate = true;
    const a = grab();
    moon.castShadow = false; e.renderer.shadowMap.needsUpdate = true;
    const b = grab();
    moon.castShadow = true; e.renderer.shadowMap.needsUpdate = true;
    let n = 0, peak = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = lum(b, i) - lum(a, i);
      if (d > 4) n++;
      if (d > peak) peak = d;
    }
    return { px: n, peak: +peak.toFixed(1) };
  };
  out.withCar = strength();
  const car = e.playerMesh;
  car.visible = false;
  out.withoutCar = strength();
  car.visible = true;
  e.bloomPass.enabled = bloomWas;

  // --- 5. the blob steps back ------------------------------------------
  const blob = e.carBody?.userData?.contact;
  out.blobHigh = +(blob?.material?.opacity ?? -1).toFixed(2);
  e.applyQualityTier("battery");
  out.blobBattery = +(blob?.material?.opacity ?? -1).toFixed(2);
  e.applyQualityTier("high");

  // --- 6. the hour reaches the light -----------------------------------
  // LAST, on purpose. Moving the clock changes the key's direction but
  // not the light's POSITION, which the frame loop owns and only rewrites
  // on the next update. Asking this question first left every earlier
  // measurement reading a shadow camera aimed one way and positioned
  // another: 154 casters "clipped", 9.8% of the depth range in use, and
  // zero shadow pixels in a scene that plainly had shadows in it. The
  // instrument was wrong before the renderer was.
  const nightDir = moon.userData.keyDir.clone();
  e.world.setTimeOfDay(12.5);
  const noonDir = moon.userData.keyDir.clone();
  out.noonElev = +((Math.asin(noonDir.y) * 180) / Math.PI).toFixed(1);
  out.dirMoved = +nightDir.angleTo(noonDir).toFixed(3);
  e.world.setTimeOfDay(0.5);
  e.applyDaylight();
  for (let i = 0; i < 4; i++) e.update(1 / 60);
  return out;
});

console.log("\n=== SHADOWS ===");
console.log(`  key height      ${r.elevDeg}deg at midnight, ${r.noonElev}deg at noon`);
console.log(`  raking          ${check(r.elevDeg < 40, `the key sits ${r.elevDeg}deg up at night, too high to throw a shadow clear of its caster`)}  ` +
  `a 1.3 m car throws ${r.throwM} m`);
console.log(`  clear of itself ${check(r.throwM > 1.3, `a car throws ${r.throwM} m, less than its own height — the shadow stays under the floor`)}`);
console.log(`  clock reaches   ${check(r.dirMoved > 0.05, "the key light points the same way at midnight and at noon — the hour is not reaching it")}  ` +
  `the key swings ${r.dirMoved} rad between midnight and noon`);

console.log(`\n  car meshes      ${r.carCast} cast, ${r.carRecv} receive`);
console.log(`  cars receive    ${check(r.carRecv > r.carCast * 0.9, `${r.carRecv} of ${r.carCast} lit car meshes receive a shadow — a car cannot be shaded by a flyover or the car beside it`)}`);
for (const [name, v] of [["road", r.road], ["road-line", r.line], ["road-dash", r.dash], ["guardrail", r.rail]]) {
  console.log(`  ${name.padEnd(15)} ${check(!!v?.recv, `${name} does not receive shadows — a shadow crossing it will not mark it`)}`);
}

console.log(`\n  frustum         ${r.texelCm} cm per texel, radius ${r.radius}, ${r.depthUse}% of near..far used`);
console.log(`  nothing clipped ${check(r.clipped === 0, `${r.clipped} casters fall outside the shadow camera's near/far and throw nothing`)}`);
console.log(`  depth not wasted ${check(r.depthUse > 15, `only ${r.depthUse}% of the shadow depth range is in use — precision thrown away, and the bias is paid out of it`)}`);
console.log(`  soft edges      ${check(r.radius > 1, `shadow radius is ${r.radius}: a single texel, which is a hard edge`)}`);

console.log(`\n  overhead        ${r.withCar.px} px in shadow with the car, ${r.withoutCar.px} without`);
console.log(`  the car throws  ${check(r.withCar.px > r.withoutCar.px * 1.15, `the car adds only ${r.withCar.px - r.withoutCar.px} shadow pixels — it is not casting onto the world`)}  ` +
  `+${r.withCar.px - r.withoutCar.px} px, peak ${r.withoutCar.peak} -> ${r.withCar.peak}`);

console.log(`\n  contact blob    ${r.blobHigh} with real shadows, ${r.blobBattery} without`);
console.log(`  blob steps back ${check(r.blobHigh < r.blobBattery, "the fake contact decal is at full strength alongside a real shadow, and hides it")}`);

if (r.worst?.length) console.log(`  clipped e.g.    ${JSON.stringify(r.worst)} against near/far ${JSON.stringify(r.nearFar)}`);
if (errors.length) console.log(`\n  page errors: ${errors.slice(0, 3).join(" | ")}`);
console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe shadows are thrown, landed on, and visible");
await browser.close();
process.exit(fail.length ? 1 : 0);
