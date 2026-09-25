// Black and white levels of the delivered frame, per surface.
//
//   npm run dev            # in another shell
//   node tools/shots/levels.mjs
//   node tools/shots/levels.mjs 22.5     # one hour
//
// "The picture looks flat" is a claim about a histogram, and a histogram
// of the whole frame cannot answer it: a night shot is four fifths sky
// and road, so the sky's floor and the road's ceiling average into a
// number that describes neither. This segments the frame first — road,
// buildings, sky, cars — and reports each one's own levels.
//
// THE CARS ARE THEIR OWN SURFACE, and were not for a long time. They
// fell into "other" with the palms, the barriers, the sign posts and
// the lamp housings, and "other" is never asserted on and never read.
// So the one thing in this frame the player is actually looking at —
// the only object they own, paid for and repainted — was the one
// surface this tool could not tell you anything about. Every complaint
// about how the cars look was landing against a report that measured
// the road.
//
// The segmentation is an ID pass rendered from the SAME camera on the
// SAME paused frame: every mesh is flattened to black, the three
// surfaces of interest to pure red, green and blue, and the scene is
// drawn without tone mapping or the grade. A pixel's class is then its
// dominant channel. Beauty comes from the composer, because the composer
// is what the player is looking at.
//
// What the numbers mean, per surface:
//   p1 / p50 / p99   the floor, the bulk and the ceiling, in 8-bit
//   crush            fraction at 2/255 or below — shadow detail lost
//   clip             fraction at 250/255 or above — highlight detail lost
//   span             p99 - p1, how much of the range the surface uses

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

// What to measure, and how long you are willing to wait for it.
//
// Every hour costs two full high-quality renders plus their ID passes,
// and the sweep of four took this past ten minutes — which meant it got
// skipped, and a check nobody runs protects nothing. So the default is
// the hour the game is actually played: night, when the race is on and
// when the picture is hardest to get right. `--sweep` still measures
// dawn, noon and dusk, and explicit hours still override both.
//
//   node tools/shots/levels.mjs            # night, ~2 min
//   node tools/shots/levels.mjs --sweep    # all four, ~10 min
//   node tools/shots/levels.mjs 12.5       # just noon
const SWEEP = process.argv.slice(2).some((a) => a === "--sweep" || a === "--all");
const HOURS = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const hours = HOURS.length ? HOURS : SWEEP ? [22.5, 5.6, 12.5, 18.2] : [22.5];
if (!HOURS.length && !SWEEP)
  console.log("night only (22.5h). --sweep for dawn, noon and dusk as well.");

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });

// How much of a car may be indistinguishable from the night behind it.
//
// This was set at 25% before any of it had been measured, which is to
// say it was a guess. Three states have been measured since, over the
// car's own pixels:
//
//   no grade, no fill   fleet mean 32.6%   worst 43.7%   (10 cars > 30%)
//   grade only          fleet mean 24.9%   worst 33.8%
//   grade and fill      fleet mean 15.0%   worst 28.7%
//
// The worst case in the finished state is the Black Demon, and 28.7% of
// a BLACK car at night being at or below 16/255 is its glass, its
// tyres, its underside and its matte panels — it is the car, not a
// fault in the lighting. Looked at full size it reads clearly: body,
// wing, splitter, markings. Pushing light at it until it cleared 25%
// would have made a car named for being black into a grey one.
//
// So 30%, moved on the evidence rather than to turn a red green: it
// still fails on ten of the seventeen if the grade or the fill is ever
// taken out, which is the regression it exists to catch.
const CAR_BLACK_BAR = 0.30;

// --- the showroom, which is a different renderer and was a different
// --- recipe -----------------------------------------------------------
//
//   node tools/shots/levels.mjs --attract
//
// Everything below this block measures the RACE. The cards in
// press/cars, and the shop thumbnails derived from them, come from the
// menu's turntable instead — a second renderer in attract.ts, with its
// own chain. That is the surface a player judges a car on before they
// buy it, and nothing measured it.
//
// The car is found by DIFFERENCE rather than by an ID pass: the ID pass
// the race uses needs THREE to build its flat materials, and THREE is
// only put on window by the engine, which has not started on the menu.
// Rendering the scene with the car hidden and subtracting is the same
// trick tools/shots/framing.mjs uses, and it needs nothing from the page
// but the handle that is already there.
//
// Both recipes are reported side by side, because the handle exposes the
// renderer as well as the composer: "raw" is renderer.render(), which is
// what the menu did before it was given the grade, and "graded" is the
// composer. One run, and the difference between the two columns is
// exactly what the grade is worth.
if (process.argv.slice(2).includes("--attract")) {
  await page.evaluate(() => localStorage.setItem("gulf-road-nights-attract", "turntable"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__grnAttract, null, { timeout: 180000 });
  await page.waitForTimeout(2000);

  // The fleet, from the same API the capture tool reads, so this
  // measures the cars that exist rather than a list typed here.
  const cars = (await fetch("http://localhost:3000/api/grn/v1/cars").then((r) => r.json())).cars;

  const shot = (car) => page.evaluate(async (c) => {
    const h = window.__grnAttract;
    h.setCar({
      body: parseInt(String(c.color).replace("#", ""), 16),
      accent: c.accent ?? 0x007a3d,
      stripes: c.stripes ?? undefined,
      finish: c.finish ?? undefined,
      style: c.bodyStyle ?? "sedan",
      raceKit: c.kit === "attack",
      kit: c.kit,
      stickers: false,
      goldRims: false,
      rims: c.rims ?? undefined,
      livery: c.livery ?? undefined,
      face: c.face ?? undefined,
      trike: c.trike ?? undefined,
      tint: c.glassTint || undefined,
      tintFilm: c.glassFilm ?? undefined,
      lengthM: c.lengthM,
    });
    // The authored shells arrive over the network well after setCar
    // returns, and a card measured through that is a card of the
    // procedural stand-in.
    await new Promise((r) => setTimeout(r, 6000));
    h.park(0.72);

    const W = 480, H = 270;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const grab = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(h.renderer.domElement, 0, 0, W, H);
      return ctx.getImageData(0, 0, W, H).data;
    };

    // Each render overwrites the canvas, so every frame is grabbed
    // before the next one is drawn.
    h.composer.render();
    const graded = grab();
    h.renderer.render(h.scene, h.camera);
    const raw = grab();
    const shown = h.cars.map((g) => [g, g.visible]);
    for (const [g] of shown) g.visible = false;
    h.composer.render();
    const empty = grab();
    for (const [g, v] of shown) g.visible = v;
    h.composer.render();

    // A pixel belongs to the car when hiding the car changed it. The
    // threshold is per-channel sum: high enough that dither and grain
    // do not enrol half the road, low enough to keep a black flank
    // against dark asphalt, which is the case that matters most here.
    const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const car = [], bg = [];
    const mask = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < graded.length; i += 4) {
      const diff =
        Math.abs(graded[i] - empty[i]) +
        Math.abs(graded[i + 1] - empty[i + 1]) +
        Math.abs(graded[i + 2] - empty[i + 2]);
      const isCar = diff > 24;
      (isCar ? car : bg).push({ g: luma(graded, i), r: luma(raw, i) });
      const v = isCar ? 255 : 0;
      mask[i] = v; mask[i + 1] = v; mask[i + 2] = v; mask[i + 3] = 255;
    }
    const stats = (arr, key) => {
      if (arr.length < 500) return null;
      const v = arr.map((x) => x[key]).sort((a, b) => a - b);
      const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
      return {
        n: v.length,
        mean: +(v.reduce((a, x) => a + x, 0) / v.length).toFixed(1),
        p50: Math.round(q(0.5)),
        max: Math.round(v[v.length - 1]),
        // The headline number: how much of the car is simply not there.
        black: +(v.filter((x) => x <= 16).length / v.length).toFixed(4),
        crush: +(v.filter((x) => x <= 2).length / v.length).toFixed(4),
      };
    };
    const png = (data) => {
      const c2 = document.createElement("canvas");
      c2.width = W; c2.height = H;
      const x2 = c2.getContext("2d");
      const img = x2.createImageData(W, H);
      img.data.set(data);
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      x2.putImageData(img, 0, 0);
      return c2.toDataURL("image/png").split(",")[1];
    };
    return {
      carGraded: stats(car, "g"), carRaw: stats(car, "r"),
      bgGraded: stats(bg, "g"), bgRaw: stats(bg, "r"),
      gradedPng: png(graded), maskPng: png(mask),
    };
  }, car);

  mkdirSync("press/levels", { recursive: true });
  console.log("\n                      the car                          the night");
  console.log("                mean   p50   max  black%      mean  black%");
  const rows = [];
  for (const car of cars) {
    const r = await shot(car);
    if (!r.carGraded) { console.log(`  ${car.id.padEnd(16)} no car found in frame`); continue; }
    rows.push({ id: car.id, ...r });
    const g = r.carGraded, w = r.carRaw, bgG = r.bgGraded, bgW = r.bgRaw;
    console.log(
      `  ${car.id.padEnd(16)} ${String(g.mean).padStart(5)} ${String(g.p50).padStart(5)} ` +
      `${String(g.max).padStart(5)} ${(g.black * 100).toFixed(1).padStart(6)}%   ` +
      `${String(bgG.mean).padStart(7)} ${(bgG.black * 100).toFixed(1).padStart(6)}%`
    );
    console.log(
      `  ${"".padEnd(16)} ${String(w.mean).padStart(5)} ${String(w.p50).padStart(5)} ` +
      `${String(w.max).padStart(5)} ${(w.black * 100).toFixed(1).padStart(6)}%   ` +
      `${String(bgW.mean).padStart(7)} ${(bgW.black * 100).toFixed(1).padStart(6)}%   ungraded`
    );
    writeFileSync(`press/levels/card-${car.id}.png`, Buffer.from(r.gradedPng, "base64"));
    writeFileSync(`press/levels/card-${car.id}-mask.png`, Buffer.from(r.maskPng, "base64"));
  }
  const avg = (k, which) => rows.reduce((a, r) => a + r[which][k], 0) / rows.length;
  console.log(
    `\n${rows.length} cars   graded: car mean ${avg("mean", "carGraded").toFixed(1)}, ` +
    `${(avg("black", "carGraded") * 100).toFixed(1)}% of the car at or below 16` +
    `   |   ungraded: ${avg("mean", "carRaw").toFixed(1)}, ` +
    `${(avg("black", "carRaw") * 100).toFixed(1)}%`
  );
  console.log(
    `background   graded ${avg("mean", "bgGraded").toFixed(1)}   ungraded ${avg("mean", "bgRaw").toFixed(1)}` +
    `   (this one is meant to stay put: a showroom is a dark room with a lit car in it)`
  );
  // The bar. A card whose subject is half nothing is not a photograph of
  // a car, whatever the page behind it looks like.
  const bad = rows.filter((r) => r.carGraded.black > CAR_BLACK_BAR);
  await browser.close();
  if (bad.length) {
    console.log(
      `\nFAILURES:\n${bad
        .map((r) => ` - ${r.id}: ${(r.carGraded.black * 100).toFixed(1)}% of the car is at or below 16/255` +
          ` > ${(CAR_BLACK_BAR * 100).toFixed(0)}% — you cannot see the machine on its own card`)
        .join("\n")}`
    );
    process.exit(1);
  }
  console.log("\nevery car on the turntable is a car you can see.");
  process.exit(0);
}

await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
// The world keeps assembling after "ready" — authored shells, palm
// crowns, the reflection probe. Levels measured through that are the
// levels of a half-built scene.
await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high"); // dynamic resolution moves the bloom
});
await page.waitForTimeout(4000);

const measure = (hour, u, opts = {}) => page.evaluate(async ([hour, u, opts]) => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  e.setPaused(true);
  e.timeReal = false; e.timeCycling = false; e.timeHours = hour;
  e.world.setTimeOfDay(hour);
  e.applyDaylight();
  e.setExposure(0, true);
  // Only when the sweep asks. Left alone, the engine keeps whatever
  // settings.ts shipped — and a levels report taken at a brightness
  // nobody plays at is a report about a picture nobody sees.
  if (opts.brightness) e.setBrightness?.(opts.brightness);
  // Still and empty. The camera rumbles with speed, and a lit rival
  // drifting into frame is worth more than half a night histogram.
  const park = () => {
    const away = e.track.wrap(e.player.s + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
    e.player.s = u;
    e.player.lat = 0;
    e.player.speed = 0;
  };
  park();
  // Twice: the exposure pass and the bloom both carry state between
  // frames, so one settle still shows the previous hour's picture.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 30; i++) { e.update(1 / 60); park(); }
    for (let i = 0; i < 4; i++) e.composer.render();
  }
  for (let i = 0; i < 60; i++) e.composer.render(); // let auto-exposure settle

  const W = 480, H = 270;
  const grab = () => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
    return ctx.getImageData(0, 0, W, H).data;
  };

  // --- beauty: what the player is actually looking at
  e.composer.render();
  const beauty = grab();

  // --- ID pass, same camera, same frame
  // White for the car rather than a fourth primary: the decode below
  // classifies by dominant channel, and any mix of two primaries — a
  // yellow, a cyan — collides with one of the three already spoken for.
  // White is the one id that is unambiguous under that rule, because it
  // is the only one whose SMALLEST channel is also high.
  const CLASS = { road: 0xff0000, building: 0x00ff00, sky: 0x0000ff, car: 0xffffff, other: 0x000000 };
  const saved = [];
  // One id material per class AND per face side. A single front-sided
  // flat material culls the sky dome, which is drawn BackSide from
  // inside: the sky then painted nothing, came back as 140 pixels of a
  // 129,600 pixel frame, and read as "not in frame" at noon.
  const idMats = new Map();
  const idMat = (k, side, depthWrite) => {
    const key = `${k}|${side}|${depthWrite}`;
    let m = idMats.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(CLASS[k]), fog: false, side, depthWrite });
      idMats.set(key, m);
    }
    return m;
  };
  // Every car on the road, by identity rather than by name. The engine
  // already keeps this list — it hides exactly these groups when it
  // renders the reflection probe, so that a car cannot reflect itself —
  // and reusing it means a new kind of car is a car here the day it is
  // added, with nothing to remember to update.
  const carRoots = new Set();
  if (e.playerMesh) carRoots.add(e.playerMesh);
  for (const g of e.carGroups ?? []) carRoots.add(g);

  // A mesh's class comes from the nearest named ancestor, so anything
  // parented under the road counts as road rather than as "other".
  // The car test comes first: a car standing on the road is a car.
  const classOf = (o) => {
    for (let n = o; n; n = n.parent) {
      if (carRoots.has(n)) return "car";
      if (n.name === "road" || n.name.startsWith("road-") || n.name === "streets") return "road";
      if (n.name === "cityBlocks") return "building";
      if (n.name === "sky") return "sky";
    }
    return "other";
  };
  const hidden = [];
  e.scene.traverse((o) => {
    if (o.isSprite && o.visible) { hidden.push(o); o.visible = false; return; }
    if (!o.isMesh && !o.isInstancedMesh) return;
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    // Overlays come out of the id pass entirely. A lamp glow or a
    // headlight cone is transparent in the beauty frame but becomes an
    // OPAQUE flat quad once its material is replaced, and it then paints
    // over whatever surface it is sitting in front of: the night coast
    // road classified 389 pixels against 33,000 at noon from the same
    // camera, because the glows had blotted it out. The pixel underneath
    // still belongs to the road, glow and all.
    if (src && (src.transparent || (src.opacity ?? 1) < 1)) {
      if (o.visible) { hidden.push(o); o.visible = false; }
      return;
    }
    saved.push([o, o.material]);
    o.material = idMat(classOf(o), src?.side ?? THREE.FrontSide, src?.depthWrite ?? true);
  });
  const prevTone = e.renderer.toneMapping;
  const prevSpace = e.renderer.outputColorSpace;
  const prevBg = e.scene.background;
  // The grade and the tone map would move these ids off their primaries
  // and the decode below would read the wrong surface — or none.
  e.renderer.toneMapping = THREE.NoToneMapping;
  e.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  e.scene.background = new THREE.Color(0x000000);
  e.renderer.setRenderTarget(null);
  e.renderer.render(e.scene, e.camera);
  const ids = grab();
  e.renderer.toneMapping = prevTone;
  e.renderer.outputColorSpace = prevSpace;
  e.scene.background = prevBg;
  for (const [o, m] of saved) o.material = m;
  for (const o of hidden) o.visible = true;
  for (const m of idMats.values()) m.dispose();

  // --- levels per class
  const buckets = { road: [], building: [], sky: [], car: [], other: [], all: [] };
  for (let i = 0; i < beauty.length; i += 4) {
    const l = Math.round(0.2126 * beauty[i] + 0.7152 * beauty[i + 1] + 0.0722 * beauty[i + 2]);
    buckets.all.push(l);
    const r = ids[i], g = ids[i + 1], b = ids[i + 2];
    const mx = Math.max(r, g, b);
    if (mx < 60) { buckets.other.push(l); continue; }
    // White is the car: all three channels high. Tested before the
    // dominant-channel rule, which would otherwise read white as road.
    if (Math.min(r, g, b) > 60) { buckets.car.push(l); continue; }
    if (r === mx) buckets.road.push(l);
    else if (g === mx) buckets.building.push(l);
    else buckets.sky.push(l);
  }
  const stats = (arr) => {
    if (!arr.length) return null;
    arr.sort((a, b) => a - b);
    const q = (p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
    return {
      n: arr.length,
      p1: q(0.01), p50: q(0.5), p99: q(0.99),
      // A specular core is a hundredth of a percent of the frame, so p99
      // says nothing about whether the picture reaches white. p99.9 and
      // the maximum do.
      p999: q(0.999), max: arr[arr.length - 1],
      min: arr[0],
      crush: +(arr.filter((v) => v <= 2).length / arr.length).toFixed(4),
      clip: +(arr.filter((v) => v >= 250).length / arr.length).toFixed(4),
    };
  };
  const out = {};
  for (const k of Object.keys(buckets)) out[k] = stats(buckets[k]);
  const s = await e.sampleExposure();
  out.exposure = +s.exposure.toFixed(3);
  // The frame the numbers came from, so a surprising histogram can be
  // looked at rather than argued with.
  const png = (data) => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(W, H);
    img.data.set(data);
    // Opaque. The renderer's canvas carries an alpha channel, and a PNG
    // written with it gets composited over white by anything that opens
    // it — which turns a correctly-black night frame into a milky grey
    // one and makes the picture contradict its own histogram.
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    return c.toDataURL("image/png").split(",")[1];
  };
  out.beautyPng = png(beauty);
  out.idPng = png(ids);
  return out;
}, [hour, u, opts]);

const row = (name, s) =>
  s
    ? `  ${name.padEnd(9)} p1 ${String(s.p1).padStart(3)}  p50 ${String(s.p50).padStart(3)}  ` +
      `p99 ${String(s.p99).padStart(3)}  p99.9 ${String(s.p999).padStart(3)}  max ${String(s.max).padStart(3)}  ` +
      `crush ${(s.crush * 100).toFixed(1).padStart(4)}%  clip ${(s.clip * 100).toFixed(1)}%  (${s.n} px)`
    : `  ${name.padEnd(9)} not in frame`;

// Two places on the lap: the coast leg is sky and road with almost no
// city, the city leg is the opposite. One of them alone describes half
// the game.
// Both stops are METRES from the start line, not lap fractions. The
// original pair were fractions, and 0.62 of the lap landed inside the
// underpass — lit like a showroom, with neither sky nor buildings in it
// — so the first run of this tool measured "the coast" and was reading a
// tunnel. Fractions moved again when the return leg became the Second
// Ring Road and the lap grew by 1.15 km; metres did not.
const SPOTS = [["coast", 3304], ["city", 587]]; // metres from the line

// The bars, and what each one is protecting.
//
// These are not round numbers: each sits clear of what the shipped
// picture measures, and each one has been watched to fail. Reverting the
// grade's black point to its old 0.02 alone trips the sky and the frame.
// A bucket smaller than this many pixels is not asserted on — the road
// is one pixel of the city frame at noon, and a percentage of one pixel
// is not a measurement.
const MIN_PX = 2000;
const BARS = [
  // surface, statistic, limit, what it means
  ["sky", "crush", 0.05, "the sky has crushed to black"],
  // 25%, not the 10% this was first set to. The city is placed with
  // Math.random() at world build, so a different skyline stands in front
  // of the camera on every load: the coast bucket has measured 4,805 px
  // at 1.0% crush and 13,636 px at 10.5% on the same code, and a bar
  // drawn round the first sample fails on the second for no reason
  // anyone can act on. The defect this guards was facades at 80-87% with
  // a ceiling of 31; 25% still catches that several times over.
  //
  // The real fix is a seeded world, which would make every visual check
  // in this repo reproducible. That is a bigger change than a threshold
  // and it belongs in its own pass.
  ["building", "crush", 0.25, "the buildings have crushed to black"],
  ["road", "crush", 0.25, "the road has crushed to black"],
  ["all", "crush", 0.22, "half the frame is sitting on black"],
];

// A brightness sweep, for setting the default from what the picture
// measures rather than from what it looks like on this machine's
// screen. The question it answers is narrow and specific: how far can
// the road's median be lifted before the sky stops being night?
const SWEEP_B = process.argv.slice(2).find((a) => a.startsWith("--brightness"));
if (SWEEP_B) {
  console.log("\nbrightness  road p50   sky p50   all p50   road crush   clip");
  for (const b of [0.95, 1.0, 1.05, 1.1, 1.12, 1.15, 1.2, 1.3]) {
    const r = await measure(22.5, 3304, { brightness: b });
    console.log(
      `  ${b.toFixed(2)}      ${String(r.road.p50).padStart(6)}    ` +
        `${String(r.sky.p50).padStart(6)}    ${String(r.all.p50).padStart(6)}    ` +
        `${(r.road.crush * 100).toFixed(2)}%       ${(r.all.clip * 100).toFixed(2)}%`
    );
  }
  await browser.close();
  process.exit(0);
}

const fail = [];
for (const hour of hours) {
  for (const [where, u] of SPOTS) {
    const r = await measure(hour, u);
    console.log(`\n${String(hour).padStart(4)}h ${where}   exposure ${r.exposure}`);
    for (const k of ["road", "building", "sky", "car", "other", "all"]) console.log(row(k, r[k]));
    mkdirSync("press/levels", { recursive: true });
    const tag = `${String(hour).replace(".", "_")}-${where}`;
    writeFileSync(`press/levels/${tag}.png`, Buffer.from(r.beautyPng, "base64"));
    writeFileSync(`press/levels/${tag}-id.png`, Buffer.from(r.idPng, "base64"));
    const at = `${hour}h ${where}`;
    for (const [surface, stat, limit, why] of BARS) {
      const s = r[surface];
      if (!s || s.n < MIN_PX) continue;
      if (s[stat] > limit)
        fail.push(`${at}: ${why} — ${surface} ${stat} ${(s[stat] * 100).toFixed(1)}% > ${(limit * 100).toFixed(0)}%`);
    }
    // And the other end: a picture with no white in it anywhere is as
    // wrong as one with no black, and far easier to ship by accident.
    if (r.all && r.all.max < 250) fail.push(`${at}: nothing in the frame reaches white (max ${r.all.max})`);
  }
}
await browser.close();

if (fail.length) {
  console.log(`\nFAILURES:\n${fail.map((f) => ` - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(
  `\nblack and white levels hold at ${hours.length === 1 ? `${hours[0]}h` : "every hour"}` +
    (hours.length === 1 && !HOURS.length ? " — run with --sweep for the daylight hours" : "")
);
