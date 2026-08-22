// Does a car read as a VOLUME, and do the colours in this game separate?
//
//   npm run dev
//   node tools/shots/volume.mjs
//
// Two complaints that sound like taste and are not:
//
// "no volume"  — a car at night is a dark shape on a dark road. What
//   makes it read as a solid object rather than a hole is the rim: the
//   band just inside the silhouette where the bodywork turns away from
//   the camera and catches the sky. Measured here as the luminance of
//   that band against the luminance of the middle of the same car. A
//   flat cut-out scores 1.0. Anything with form scores above it.
//
// "colours do not separate" — the picture can be perfectly exposed and
//   still be one colour. Measured as CHROMA (how far the average pixel
//   sits from grey) and as HUE SPREAD (how much of the colour wheel the
//   frame actually uses, weighted by how colourful each pixel is). A
//   monochrome night scene has high contrast and almost no spread.
//
// Both are reported for the same frame, because they trade against each
// other: crushing the picture to separate the colours takes the rim off
// the cars, and lifting the cars off the road can wash the colour out.

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
const VIB = process.argv.includes("--vib") ? Number(process.argv[process.argv.indexOf("--vib") + 1]) : -1;
await page.evaluate((v) => { window.__grnVib = v; }, VIB);

const out = await page.evaluate(async () => {
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

  const cam = e.camera;
  const p = new THREE.Vector3(), side = new THREE.Vector3(), tan = new THREE.Vector3();
  e.track.pose(e.player.s, 0, p, side);
  e.track.tangentAt(e.player.s, tan);
  // Three-quarter rear, close: the framing the chase camera actually
  // gives you, and the one where a flank turning away from the lens is
  // the whole read.
  cam.up.set(0, 1, 0);
  cam.position.set(p.x - tan.x * 7.5 + side.x * 3.6, 2.0, p.z - tan.z * 7.5 + side.z * 3.6);
  cam.lookAt(p.x, 0.65, p.z);
  cam.fov = 45;
  cam.updateProjectionMatrix();

  // Auto-exposure OFF for the whole measurement.
  //
  // It is a feedback loop and it was closing around the thing being
  // measured: a stronger sheen darkens the car, the meter sees a darker
  // frame, exposure rises, and the CORE brightens — so the rim/core
  // ratio moved with the exposure rather than with the paint. Core
  // luminance was jumping between 0.36 and 0.54 across otherwise
  // identical runs, which is a bigger swing than the effect under test.
  e.setExposure(0, false);
  const vib = Number(window.__grnVib ?? -1);
  if (vib >= 0) e.grainPass.material.uniforms.uVibrance.value = vib;
  for (let i = 0; i < 8; i++) e.update(1 / 60);

  const grab = () => {
    e.exposurePass.dt = 0;
    for (let i = 0; i < 6; i++) e.composer.render();
    const gl = e.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = gl.width; c.height = gl.height;
    const x = c.getContext("2d");
    x.drawImage(gl, 0, 0);
    return { c, d: x.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  };

  // The car's silhouette, taken the honest way: render once with it and
  // once without, and the pixels that changed ARE the car. No colour
  // keying, no guessing where it is on screen.
  const withCar = grab();
  const car = e.playerMesh;
  car.visible = false;
  const without = grab();
  car.visible = true;
  const after = grab();

  const W = withCar.w, H = withCar.h;
  const lum = (d, i) => (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;

  const isCar = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < after.d.length; i += 4, j++) {
    const dr = Math.abs(after.d[i] - without.d[i]);
    const dg = Math.abs(after.d[i + 1] - without.d[i + 1]);
    const db = Math.abs(after.d[i + 2] - without.d[i + 2]);
    if (dr + dg + db > 24) isCar[j] = 1;
  }

  // How much of the car IS reflection?
  //
  // Sweeping envMapIntensity from 2.4 to 1.0 moved the car's luminance
  // statistics by less than the run-to-run noise, which can only mean
  // the statistic was not measuring the paint. It was not: the car mask
  // contains the headlamp lenses, the tail lamps and the additive glare
  // sprites, and those are emissive — they do not care what the
  // environment map says. 5.5% of the car being "over 0.75" was 5.5% of
  // the car being LAMPS.
  //
  // So ask the question the way the shadow tool asks its question:
  // render once with the paint's environment contribution and once
  // without, and the difference IS the reflection. Nothing emissive
  // moves between those two frames, so nothing emissive can pollute it.
  const paintMat = e.carBody?.userData?.bodyMat;
  let refl = null;
  if (paintMat) {
    const envWas = paintMat.envMapIntensity;
    const ccWas = paintMat.clearcoat;
    paintMat.envMapIntensity = 0;
    paintMat.clearcoat = 0;
    paintMat.needsUpdate = true;
    const flat = grab();
    paintMat.envMapIntensity = envWas;
    paintMat.clearcoat = ccWas;
    paintMat.needsUpdate = true;
    let sum = 0, n2 = 0, over = 0, peak = 0;
    for (let j = 0; j < W * H; j++) {
      if (!isCar[j]) continue;
      const i = j * 4;
      const d = lum(after.d, i) - lum(flat.d, i);
      sum += d; n2++;
      if (d > 0.2) over++;
      if (d > peak) peak = d;
    }
    refl = {
      mean: +(sum / Math.max(1, n2)).toFixed(4),
      hotPct: +((over / Math.max(1, n2)) * 100).toFixed(2),
      peak: +peak.toFixed(4),
    };
  }


  // Erode to find the interior, and the band between the silhouette and
  // the eroded interior is the rim.
  const erode = (src, n) => {
    let cur = src;
    for (let pass = 0; pass < n; pass++) {
      const next = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const k = y * W + x;
          if (!cur[k]) continue;
          if (cur[k - 1] && cur[k + 1] && cur[k - W] && cur[k + W]) next[k] = 1;
        }
      }
      cur = next;
    }
    return cur;
  };
  // rim = the outer band; core = everything deeper. Eroding a further
  // sixteen pixels for the "core" emptied the mask entirely once the
  // exposure was pinned and the silhouette tightened — above the
  // shoulder a car is a roof, and a roof is not 32 pixels thick.
  const RIM = 4;
  const inner = erode(isCar, RIM);

  // Where the car is on screen, so the rim can be judged on the half of
  // the silhouette the complaint is actually about.
  let yMin = H, yMax = 0;
  for (let j = 0; j < W * H; j++) if (isCar[j]) {
    const y = (j / W) | 0;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  // The UPPER silhouette only.
  //
  // The first version of this averaged the whole 4-pixel band and got
  // 0.61 whatever the paint did — because that band is mostly sill,
  // underbody and tyre, and those are black for reasons no material can
  // fix. Volume is a claim about the roofline and the shoulder turning
  // against the sky, so that is the part that gets measured. Averaging
  // in the parts of a car that are SUPPOSED to be black is how an
  // instrument reports "no change" through a change.
  const shoulder = yMin + (yMax - yMin) * 0.55;

  let rimSum = 0, rimN = 0, coreSum = 0, coreN = 0, carN = 0;
  for (let j = 0; j < W * H; j++) {
    if (!isCar[j]) continue;
    carN++;
    const y = (j / W) | 0;
    if (y > shoulder) continue;
    const i = j * 4;
    if (!inner[j]) { rimSum += lum(after.d, i); rimN++; }
    else { coreSum += lum(after.d, i); coreN++; }
  }
  const rim = rimN ? rimSum / rimN : 0;
  const coreL = coreN ? coreSum / coreN : 0;

  // How SHINY the paint is, measured on the car's own pixels.
  //
  // A direct statistic rather than a ratio of two eroded regions: the
  // rim/core ratio proved unrepeatable, and the reason was that it
  // divided one derived quantity by another. The luminance distribution
  // over a fixed mask, with the exposure pinned, is the honest way to
  // ask "how much of this car is a highlight".
  const carLum = [];
  for (let j = 0; j < W * H; j++) {
    if (isCar[j]) carLum.push(lum(after.d, j * 4));
  }
  carLum.sort((a, b) => a - b);
  const pct = (q) => (carLum.length ? carLum[Math.floor((carLum.length - 1) * q)] : 0);
  const hot = carLum.filter((v) => v > 0.75).length / Math.max(1, carLum.length);
  const blown = carLum.filter((v) => v > 0.92).length / Math.max(1, carLum.length);

  // Colour: chroma and hue spread over the whole frame.
  let chromaSum = 0, n = 0;
  let sx = 0, sy = 0, wsum = 0;
  const hist = new Array(36).fill(0);
  for (let i = 0; i < after.d.length; i += 4) {
    const r = after.d[i] / 255, g = after.d[i + 1] / 255, b = after.d[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const chroma = mx - mn;
    chromaSum += chroma; n++;
    if (chroma < 0.06 || mx < 0.06) continue;
    let hDeg;
    if (mx === r) hDeg = 60 * (((g - b) / chroma) % 6);
    else if (mx === g) hDeg = 60 * ((b - r) / chroma + 2);
    else hDeg = 60 * ((r - g) / chroma + 4);
    if (hDeg < 0) hDeg += 360;
    const rad = (hDeg * Math.PI) / 180;
    sx += Math.cos(rad) * chroma; sy += Math.sin(rad) * chroma; wsum += chroma;
    hist[Math.min(35, Math.floor(hDeg / 10))] += chroma;
  }
  // Circular variance: 0 = every coloured pixel is the same hue, 1 =
  // spread right round the wheel. This is the number "the whole screen
  // is one colour" is a complaint about.
  const R = wsum ? Math.hypot(sx, sy) / wsum : 1;
  const total = hist.reduce((a, b) => a + b, 0);
  const bins = hist.filter((v) => v > total * 0.02).length;

  return {
    carPx: carN,
    rim: +rim.toFixed(4),
    core: +coreL.toFixed(4),
    volume: coreL > 0 ? +(rim / coreL).toFixed(3) : 0,
    pMean: +(carLum.reduce((a, b) => a + b, 0) / Math.max(1, carLum.length)).toFixed(4),
    p50: +pct(0.5).toFixed(4),
    p95: +pct(0.95).toFixed(4),
    p99: +pct(0.99).toFixed(4),
    hotPct: +(hot * 100).toFixed(2),
    blownPct: +(blown * 100).toFixed(2),
    refl,
    chroma: +(chromaSum / n).toFixed(4),
    hueSpread: +(1 - R).toFixed(4),
    hueBins: bins,
    png: after.c.toDataURL("image/png").split(",")[1],
  };
});

const png = out.png; delete out.png;
console.log("\n=== VOLUME & COLOUR ===");
console.log(`  car             ${out.carPx} px of silhouette`);
console.log(`  rim / core      ${out.rim} vs ${out.core}  ->  volume ${out.volume}   (upper silhouette only)`);
console.log(`                  (1.0 is a flat cut-out; above 1 the edges turn toward the light)`);
console.log(`  paint          mean ${out.pMean}  p50 ${out.p50}  p95 ${out.p95}  p99 ${out.p99}`);
console.log(`  highlights      ${out.hotPct}% of the car is over 0.75, ${out.blownPct}% over 0.92`);
if (out.refl) {
  console.log(`  reflection      adds ${out.refl.mean} mean luminance to the car, peak +${out.refl.peak}`);
  console.log(`                  ${out.refl.hotPct}% of the car is lifted more than 0.2 by reflection alone`);
}
console.log(`  chroma          ${out.chroma}  mean distance from grey, 0-1`);
console.log(`  hue spread      ${out.hueSpread}  circular variance, 0 = one colour`);
console.log(`  hues in use     ${out.hueBins} of 36 ten-degree bins carry real colour`);

mkdirSync("press/volume", { recursive: true });
writeFileSync("press/volume/frame.png", Buffer.from(png, "base64"));
console.log("\n  press/volume/frame.png");
await browser.close();
