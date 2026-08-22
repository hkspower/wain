// What the shadows are actually doing.
//
//   npm run dev
//   node tools/shots/shadows.mjs            # measure, and write press/shadow/
//   node tools/shots/shadows.mjs --hour 12.5
//
// Shadows are the easiest thing in a renderer to have an opinion about
// and the hardest to argue about, because every complaint — "too hard",
// "too dark", "floating", "crawling" — is a number nobody has measured.
// This measures them.
//
// The trick that makes it possible: render the same frame twice, once
// with the key light casting and once with it not, and subtract. The
// difference image IS the shadow, exactly, with no need to guess where
// in the picture it fell. Everything below is read off that difference:
//
//   cover     how much of the frame is in shadow at all
//   depth     how far down the shadow takes the pixels it covers
//   penumbra  the 10-90% transition width across a shadow edge, in
//             pixels — this is the number "hard vs soft" actually means
//   speckle   pixels darker than both horizontal neighbours by a margin.
//             Shadow acne is high-frequency and isolated; a real shadow
//             edge is neither, so this separates the two without having
//             to know where the real edges are.
//
// It also reports the frustum arithmetic, which is not a picture
// measurement but decides all of the above: metres per shadow texel, and
// how much of the depth buffer's range the scene actually occupies. A
// near/far pair ten times wider than the geometry throws away depth
// precision, and paying it back costs a larger bias, which is what
// detaches a shadow from the thing casting it.

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

const argHour = process.argv.indexOf("--hour");
const HOUR = argHour > 0 ? Number(process.argv[argHour + 1]) : 0.5;
const WRITE = !process.argv.includes("--no-shots");

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
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
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
await page.waitForTimeout(4000);

const out = await page.evaluate(async ([hour, write]) => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");
  e.timeHours = hour;
  e.world.setTimeOfDay(hour);
  e.applyDaylight();

  // A straight, open stretch, standing still, so the shot is repeatable
  // and the shadow is not being thrown by a car that is sliding.
  e.player.s = 587;
  e.player.lat = 0;
  e.player.speed = 0;
  for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length / 2);
  if (e.rival) e.rival.s = e.track.wrap(e.player.s + e.track.length / 2);
  for (let i = 0; i < 60; i++) e.update(1 / 60);

  // Look down at the car from behind and above: the ground plane fills
  // the lower frame, which is where a shadow lands.
  const cam = e.camera;
  const saved = {
    pos: cam.position.clone(), quat: cam.quaternion.clone(),
    up: cam.up.clone(), fov: cam.fov,
  };
  const p = new THREE.Vector3(), side = new THREE.Vector3();
  e.track.pose(e.player.s, 0, p, side);
  const tan = new THREE.Vector3();
  e.track.tangentAt(e.player.s, tan);

  // Two framings, because they answer different questions.
  //
  // chase() is what the player is looking at, and what "the shadows look
  // wrong" is a complaint about. But it is a bad place to ask whether a
  // shadow EXISTS: the camera sits behind the car, and a shadow thrown
  // forward hides behind the very thing that cast it. The first run of
  // this tool reported 10 pixels of car shadow for that reason and I
  // nearly went looking for a bug in the renderer.
  //
  // overhead() is where existence is decided. Nothing can occlude a
  // shadow from directly above it.
  const chase = () => {
    cam.up.set(0, 1, 0);
    cam.position.set(p.x - tan.x * 11 + side.x * 3, 5.2, p.z - tan.z * 11 + side.z * 3);
    cam.lookAt(p.x, 0.4, p.z);
    cam.fov = 50;
    cam.updateProjectionMatrix();
  };
  const overhead = () => {
    cam.up.set(-tan.x, 0, -tan.z);
    cam.position.set(p.x, 22, p.z);
    cam.lookAt(p.x, 0, p.z);
    cam.fov = 40;
    cam.updateProjectionMatrix();
  };
  chase();

  const grab = () => {
    // Freeze the eye. The auto-exposure meters the frame and adapts, so
    // hiding a car with its headlights and tail lamps in it moves the
    // exposure, and then EVERY pixel differs between the two frames for
    // a reason that has nothing to do with shadows. dt = 0 stops the
    // adaptation advancing, which is what "hold everything else still"
    // has to mean when one of the other things is a feedback loop.
    e.exposurePass.dt = 0;
    for (let i = 0; i < 6; i++) e.composer.render();
    const gl = e.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = gl.width; c.height = gl.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(gl, 0, 0);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    return { canvas: c, ctx, w: c.width, h: c.height, data: img.data };
  };

  const moon = e.world.moonLight;
  const head = e.headlight;

  // Bloom comes off for the measurement. It spreads every bright pixel
  // over a wide radius, so hiding the car to isolate its shadow changed
  // the picture across half the frame and the car "silhouette" came out
  // at 306,318 pixels on a 540,000 pixel frame. Bloom is a lens effect
  // applied after the light; nothing it does is evidence about shadows,
  // and everything it does contaminates the difference these frames are
  // taken for.
  const bloomWas = e.bloomPass.enabled;
  e.bloomPass.enabled = false;

  const shadows = (on) => {
    moon.castShadow = on;
    head.castShadow = on;
    e.renderer.shadowMap.needsUpdate = true;
  };

  // Four frames, because two only answer half the question.
  //
  // lit vs flat is every shadow in the picture. But the shadow that
  // matters most is the player's own car's, and to isolate it the car is
  // hidden and the pair taken again: the difference of the differences
  // is that car's shadow and nothing else. Taken from overhead, for the
  // reason given at the framings above.
  const wasMoon = moon.castShadow, wasHead = head.castShadow;
  shadows(true);
  const lit = grab();
  shadows(false);
  const flat = grab();

  const car = e.playerMesh;
  const carWasVisible = car.visible;
  overhead();
  shadows(true);
  const litOver = grab();
  shadows(false);
  const flatOver = grab();
  car.visible = false;
  const flatNoCar = grab();          // shadows off, no car: the silhouette pair
  shadows(true);
  const litNoCar = grab();           // shadows on, no car: everyone else's shadows
  car.visible = carWasVisible;

  // The same pair again with the painted-on contact blob hidden. Every
  // car in this game carries a 2.9 x 5.8 m black gradient decal under it
  // to fake being grounded, and the real shadow at this key height lands
  // inside that footprint — so the two are competing for the same patch
  // of road, and it matters which one the player is actually seeing.
  // How much of the light on the ground is the key's to take away.
  //
  // This is the ceiling on everything else here, and it is the one
  // number that explains a picture full of correct, invisible shadows. A
  // shadow can only remove what the key put there; if the lamps, the
  // fill, the ambient and the car's own headlights supply the rest, then
  // a perfectly computed shadow still removes almost nothing and the
  // scene reads as flat. Measured with the key switched off entirely
  // rather than merely un-shadowed, because that is the whole of its
  // contribution.
  shadows(true);
  const withKey = grab();
  const keyWas = moon.intensity;
  moon.intensity = 0;
  const withoutKey = grab();
  moon.intensity = keyWas;

  // The same question asked of the headlight, which is the OTHER light
  // in this scene with a shadow map. On a lamp-lit corniche the moon is
  // a rumour; the beam off your own bonnet is not. If the headlight owns
  // the light on the road ahead, then its shadows are the ones a player
  // will ever actually see, and the moon's are a detail.
  const headWas = head.intensity;
  head.intensity = 0;
  const withoutHead = grab();
  head.intensity = headWas;

  const blob = e.carBody?.userData?.contact;
  const blobWas = blob?.visible ?? false;
  let litNoBlob = null, flatNoBlob = null;
  if (blob) {
    blob.visible = false;
    litNoBlob = grab();
    shadows(false);
    flatNoBlob = grab();
    blob.visible = blobWas;
  }
  chase();
  moon.castShadow = wasMoon;
  head.castShadow = wasHead;
  e.bloomPass.enabled = bloomWas;
  e.renderer.shadowMap.needsUpdate = true;

  const W = lit.w, H = lit.h;
  const lum = (d, i) => (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722);
  // diff[i] > 0 means the pixel got darker when shadows were switched on,
  // which is the definition of "this pixel is in shadow".
  const diff = new Float32Array(W * H);
  let peak = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d = lum(flat.data, i) - lum(lit.data, i);
      diff[y * W + x] = d;
      if (d > peak) peak = d;
    }
  }

  // Cover and depth. The threshold is a fraction of the strongest
  // darkening in the frame rather than an absolute number, because how
  // dark a shadow gets is the thing being measured, not a constant.
  const onThreshold = Math.max(2, peak * 0.15);
  let covered = 0, depthSum = 0;
  for (let i = 0; i < diff.length; i++) {
    if (diff[i] > onThreshold) { covered++; depthSum += diff[i]; }
  }

  // The car's own shadow, on everything that is not the car.
  //
  // The silhouette mask comes from the pair that both have shadows OFF,
  // so the only thing that can differ between them is whether the car
  // was there — no shadow can contaminate the mask it is about to be
  // tested against.
  // The car's shadow is measured against a FIXED small threshold, not
  // the frame-relative one above. It is a difference of two differences,
  // so it carries twice the noise and none of the peak: judged against
  // 15% of the brightest shadow in the frame it read as 46 pixels, when
  // switching the car in and out actually moves three and a half
  // thousand. A threshold borrowed from a different measurement is how a
  // real signal gets rounded to nothing.
  const CAR_ON = 4;
  let carShadowPx = 0, carShadowSum = 0, carPx = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const isCar = Math.abs(lum(flatOver.data, i) - lum(flatNoCar.data, i)) > 6;
      if (isCar) { carPx++; continue; }
      const all = lum(flatOver.data, i) - lum(litOver.data, i);
      const others = lum(flatNoCar.data, i) - lum(litNoCar.data, i);
      const mine = all - others;
      if (mine > CAR_ON) { carShadowPx++; carShadowSum += mine; }
    }
  }

  // The key's share, over the ground in the middle of the overhead
  // frame — road, not sky, not car.
  let keyOn = 0, keyOff = 0, headOff = 0, keyN = 0;
  for (let y = Math.floor(H * 0.3); y < H * 0.7; y++) {
    for (let x = Math.floor(W * 0.3); x < W * 0.7; x++) {
      const i = (y * W + x) * 4;
      if (Math.abs(lum(flatOver.data, i) - lum(flatNoCar.data, i)) > 6) continue; // skip the car
      keyOn += lum(withKey.data, i);
      keyOff += lum(withoutKey.data, i);
      headOff += lum(withoutHead.data, i);
      keyN++;
    }
  }
  const keyShare = keyN && keyOn > 0 ? (1 - keyOff / keyOn) * 100 : 0;
  const headShare = keyN && keyOn > 0 ? (1 - headOff / keyOn) * 100 : 0;

  // And the same count with the blob out of the way.
  let bareShadowPx = 0, bareShadowSum = 0;
  if (litNoBlob) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (Math.abs(lum(flatOver.data, i) - lum(flatNoCar.data, i)) > 6) continue;
        const all = lum(flatNoBlob.data, i) - lum(litNoBlob.data, i);
        const others = lum(flatNoCar.data, i) - lum(litNoCar.data, i);
        const mine = all - others;
        if (mine > CAR_ON) { bareShadowPx++; bareShadowSum += mine; }
      }
    }
  }

  // Penumbra: walk each row, and for every crossing from "clearly out"
  // to "clearly in", count how many pixels the 10-90% ramp took. A hard
  // shadow crosses in one or two; a soft one takes a dozen.
  const lo = peak * 0.1, hi = peak * 0.9;
  const widths = [];
  for (let y = 0; y < H; y++) {
    let start = -1;
    for (let x = 1; x < W; x++) {
      const a = diff[y * W + x - 1], b = diff[y * W + x];
      if (a <= lo && b > lo) start = x;
      else if (start >= 0 && b >= hi) { widths.push(x - start); start = -1; }
      else if (start >= 0 && b <= lo) start = -1;
      else if (start >= 0 && x - start > 60) start = -1;
    }
  }
  widths.sort((a, b) => a - b);

  // Speckle: a pixel meaningfully darker than BOTH its neighbours is not
  // on a shadow edge — edges are monotone across, not spiky. That is
  // what acne looks like from here.
  let speckle = 0;
  const spike = Math.max(3, peak * 0.25);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const c0 = diff[y * W + x];
      if (c0 - diff[y * W + x - 1] > spike && c0 - diff[y * W + x + 1] > spike) speckle++;
    }
  }

  // The frustum arithmetic. Not measured off the picture, but it decides
  // everything that was.
  const sc = moon.shadow.camera;
  const orthoW = sc.right - sc.left;
  const mapSize = moon.shadow.mapSize.x;

  // How high the key rides, and therefore how far a car throws. This is
  // the number that decides whether there is anything to measure at all:
  // a key directly overhead puts a car's shadow under its own floor.
  const toLight = moon.position.clone().sub(moon.target.position);
  const elevDeg = (Math.asin(toLight.y / toLight.length()) * 180) / Math.PI;
  const CAR_H = 1.3;
  const throwM = CAR_H / Math.tan(Math.max(0.05, (elevDeg * Math.PI) / 180));

  // Who is allowed to take a shadow. A caster with nothing to land on
  // is a shadow that does not exist, and this is not visible in a
  // picture — it looks exactly like a light that is not casting.
  let recvGround = 0, recvGroundTotal = 0, recvCar = 0, recvCarTotal = 0;
  const gb = new THREE.Box3(), gs = new THREE.Vector3();
  e.scene.traverse((o) => {
    if ((!o.isMesh && !o.isInstancedMesh) || !o.visible) return;
    if (o.material?.isMeshBasicMaterial) return; // unlit: cannot show one
    try { gb.setFromObject(o); } catch { return; }
    gb.getSize(gs);
    if (gs.y < 3 && (gs.x > 20 || gs.z > 20) && gb.max.y < 4 && gb.max.y > -2) {
      recvGroundTotal++;
      if (o.receiveShadow) recvGround++;
    }
  });
  for (const car of [e.playerMesh, e.rival?.mesh, ...e.traffic.slice(0, 3).map((t) => t.mesh)]) {
    car?.traverse?.((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (o.material?.isMeshBasicMaterial) return;
      recvCarTotal++;
      if (o.receiveShadow) recvCar++;
    });
  }

  // How much of near..far the scene really occupies.
  //
  // This has to be done in the LIGHT'S OWN space, not with world-space
  // bounding spheres. A bounding sphere answers a different question:
  // the sea plane is 8 km across, so its sphere reaches 5.6 km either
  // side of the light axis and reports a depth span of eleven kilometres
  // for a thing that is, in the only sense that matters here, exactly one
  // plane at one depth. Ask in view space and the question becomes the
  // right one — where in x and y does this land, and over what z.
  //
  // Anything whose footprint dwarfs the ortho box (the sea, the desert)
  // is counted as present but left out of the span: it is flat, it is
  // under everything, and including it measures the mesh rather than the
  // scene.
  moon.updateMatrixWorld(true);
  moon.shadow.updateMatrices?.(moon);
  const toView = sc.matrixWorldInverse.clone();
  const half = orthoW / 2;
  let dMin = Infinity, dMax = -Infinity, casters = 0, clipped = 0, oversized = 0;
  const box = new THREE.Box3();
  const corner = new THREE.Vector3();
  e.scene.traverse((o) => {
    if (!o.castShadow || !o.visible) return;
    if (!o.isMesh && !o.isInstancedMesh) return;
    try { box.setFromObject(o); } catch { return; }
    if (box.isEmpty()) return;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x,
                 i & 2 ? box.max.y : box.min.y,
                 i & 4 ? box.max.z : box.min.z).applyMatrix4(toView);
      xMin = Math.min(xMin, corner.x); xMax = Math.max(xMax, corner.x);
      yMin = Math.min(yMin, corner.y); yMax = Math.max(yMax, corner.y);
      // The light looks down -z in view space, so depth is -z.
      zMin = Math.min(zMin, -corner.z); zMax = Math.max(zMax, -corner.z);
    }
    if (xMax < -half || xMin > half || yMax < -half || yMin > half) return;
    casters++;
    if (xMax - xMin > orthoW * 4 || yMax - yMin > orthoW * 4) { oversized++; return; }
    if (zMin < sc.near || zMax > sc.far) clipped++;
    dMin = Math.min(dMin, zMin);
    dMax = Math.max(dMax, zMax);
  });

  let png = null;
  if (write) {
    // The difference image, stretched, so a person can look at the same
    // thing the numbers were read off.
    const c = document.createElement("canvas");
    c.width = W; c.height = H * 2;
    const ctx = c.getContext("2d");
    ctx.drawImage(lit.canvas, 0, 0);
    const vis = ctx.createImageData(W, H);
    for (let i = 0; i < diff.length; i++) {
      const v = Math.max(0, Math.min(255, (diff[i] / Math.max(peak, 1)) * 255));
      vis.data[i * 4] = v; vis.data[i * 4 + 1] = v; vis.data[i * 4 + 2] = v;
      vis.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(vis, 0, H);
    png = c.toDataURL("image/png").split(",")[1];
  }

  cam.position.copy(saved.pos); cam.quaternion.copy(saved.quat);
  cam.up.copy(saved.up); cam.fov = saved.fov; cam.updateProjectionMatrix();

  return {
    filter: e.renderer.shadowMap.type,
    hour,
    peak: +peak.toFixed(1),
    cover: +((covered / diff.length) * 100).toFixed(2),
    depth: covered ? +(depthSum / covered).toFixed(1) : 0,
    carShadowPx,
    carPx,
    carShadowRatio: carPx ? +(carShadowPx / carPx).toFixed(2) : 0,
    carShadowDepth: carShadowPx ? +(carShadowSum / carShadowPx).toFixed(1) : 0,
    bareShadowPx,
    bareShadowDepth: bareShadowPx ? +(bareShadowSum / bareShadowPx).toFixed(1) : 0,
    keyShare: +keyShare.toFixed(1),
    headShare: +headShare.toFixed(1),
    penumbraMedian: widths.length ? widths[widths.length >> 1] : 0,
    penumbraP90: widths.length ? widths[Math.floor(widths.length * 0.9)] : 0,
    edges: widths.length,
    speckle,
    mapSize,
    orthoW,
    texelCm: +((orthoW / mapSize) * 100).toFixed(2),
    near: sc.near, far: sc.far,
    sceneNear: Number.isFinite(dMin) ? +dMin.toFixed(1) : null,
    sceneFar: Number.isFinite(dMax) ? +dMax.toFixed(1) : null,
    casters, clipped, oversized,
    elevDeg: +elevDeg.toFixed(1),
    throwM: +throwM.toFixed(2),
    recvGround, recvGroundTotal, recvCar, recvCarTotal,
    radius: moon.shadow.radius,
    bias: moon.shadow.bias,
    normalBias: moon.shadow.normalBias,
    png,
  };
}, [HOUR, WRITE]);

const png = out.png;
delete out.png;

const FILTER = { 0: "Basic", 1: "PCF", 2: "PCFSoft (unsupported in 0.184 -> Basic)", 3: "VSM" };
const depthUse = out.sceneNear != null
  ? ((out.sceneFar - out.sceneNear) / (out.far - out.near)) * 100
  : NaN;

console.log(`\n=== SHADOWS at ${out.hour}h ===`);
console.log(`  filter        ${FILTER[out.filter] ?? out.filter}`);
console.log(`  map           ${out.mapSize}px over ${out.orthoW}m  =  ${out.texelCm} cm per texel`);
console.log(`  depth range   near ${out.near} far ${out.far}; ${out.casters} casters in the box` +
  (out.oversized ? ` (${out.oversized} ground planes set aside)` : ""));
console.log(`                span ${out.sceneNear}..${out.sceneFar}  =  ${depthUse.toFixed(1)}% used, ${out.clipped} clipped`);
console.log(`  bias          ${out.bias}  normalBias ${out.normalBias}  radius ${out.radius}`);
console.log(`  key height    ${out.elevDeg}deg above the horizon; a 1.3 m car throws ${out.throwM} m`);
console.log(`  receivers     ground ${out.recvGround}/${out.recvGroundTotal}   car meshes ${out.recvCar}/${out.recvCarTotal}`);
console.log(`\n  key's share   ${out.keyShare}% of the light on the road is the key's to take away`);
console.log(`  headlight     ${out.headShare}% is the headlight's`);
console.log(`  cover         ${out.cover}% of the frame is darkened by the key light's shadow`);
console.log(`  depth         ${out.depth}/255 average, ${out.peak}/255 at its deepest`);
console.log(`  car's shadow  ${out.carShadowPx} px on the world beside a ${out.carPx} px car ` +
  `(${out.carShadowRatio}x), ${out.carShadowDepth}/255 deep`);
console.log(`  without blob  ${out.bareShadowPx} px, ${out.bareShadowDepth}/255 deep` +
  `   (the fake decal is hiding ${out.bareShadowPx ? Math.round((1 - out.carShadowPx / out.bareShadowPx) * 100) : 0}% of it)`);
console.log(`  penumbra      ${out.penumbraMedian} px median, ${out.penumbraP90} px at p90, over ${out.edges} edges`);
console.log(`  speckle       ${out.speckle} isolated dark pixels (acne)`);

if (png) {
  mkdirSync("press/shadow", { recursive: true });
  const f = `press/shadow/shadow-${String(out.hour).replace(".", "_")}h.png`;
  writeFileSync(f, Buffer.from(png, "base64"));
  console.log(`\n  ${f}  (frame on top, the shadow itself below)`);
}
await browser.close();
