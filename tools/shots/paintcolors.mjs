// What each paint in the booth actually looks like on a car.
//
//   npm run dev
//   node tools/shots/paintcolors.mjs
//
//   PAINTS=black,white   only these (black is then measured first and
//                        last: the spread is the run's noise floor)
//   FINISH=satin         fit a finish through the garage first
//   EXPOSURE=metered     at what the game's meter settles to; or a
//   EXPOSURE=0.55        fixed number. Default: the manual 1.15.
//   PAINT_SIZE=550x320   a quarter of the pixels, same framing
//   BODY_HEX= METAL= IOR= PROBE_FAR=
//                        levers, set on the live material or probe;
//                        written to colors-lever.json, not colors.json
//   HOUR=12.5            at that hour rather than 2:30
//   TIMING=1             where each colour's minutes went
//
// WHAT PLAYERS SEE is the metered exposure: auto exposure is the
// default setting, and this tool measured at the manual 1.15 for its
// whole life. Where the meter actually settles at 2:30 has to be read
// with the clock stopped (see the colour loop) — the survey that said
// "0.55 at 11 of 12 places" ran with the real Kuwait clock driving the
// sky, at what was dusk there.
//
// paint.mjs asks whether the paint MATERIAL is working — gloss, flake,
// orange peel — on whatever colour the car happens to be wearing. This
// asks a different question: whether each COLOUR you can buy survives
// being put on a car at night. They are not the same question, because
// the material's response depends on the colour through paintMetalness,
// and a setting that flatters a mid-tone can destroy an extreme.
//
// Every colour is applied through the game's own garage — written to the
// save, then refreshGarage() — so what is measured is a real car really
// painted, not a material poked in place. Nothing here reimplements the
// paint law; if it did, this would agree with a bug rather than find one.
//
// WHAT EACH NUMBER MEANS:
//
//   dead   fraction of body pixels at 8/255 or below. Panels with
//          nothing on them. On a black car some of this is honest — it
//          IS a dark colour — but a car is not a hole, and past about a
//          third of the bodywork there is no shape left to read.
//   body   the median: what the colour reads as.
//   spec   the 99th percentile: the highlight.
//   form   p90 minus p10. THE number this tool exists for. It is the
//          range of tones across the bodywork, which is what tells an
//          eye that a car is a curved solid object rather than a
//          silhouette cut out of the night. A colour can have a fine
//          highlight and still be formless if everything between the
//          highlights is one flat value.
//   p10    the 10th percentile: the dark side of the car. On a black
//          car this, not the median, is where the panels go dead.
//   exp    the exposure the frame was graded at. `manual` pins the
//          1.15 the slider's zero means; `metered` lets the game's own
//          meter settle, which is what a player actually sees — and
//          exposure is exactly what hides or exposes a dark car's dead
//          panels, so a baseline without it is not comparable to one
//          with it.
//   hue    the median hue over the whole body, and the median
//          saturation. (It used to be the hue of the one pixel nearest
//          the median luminance — a sample of one.)
//          A "yellow" that measures 45 degrees is amber; one that
//          measures 55 with low saturation is olive. Under sodium lamps
//          this is worth checking rather than assuming, because the
//          lighting has a hue of its own and pushes everything toward
//          it.

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

const ONLY = (process.env.PAINTS || "").split(",").map((s) => s.trim()).filter(Boolean);
// CARS=efreet-rx-kai,hawally-2t measures those cars in the colour they
// left the factory in instead of sweeping the paint booth. The two
// yellow cars in the fleet are factory colours, not purchasable paints,
// so without this there is no way to measure the yellow anybody actually
// sees.
const CARS = (process.env.CARS || "").split(",").map((s) => s.trim()).filter(Boolean);
const SHOTS = process.env.PAINT_SHOTS === "1";
// FINISH=gloss|satin|matte fits that finish through the garage, the same
// way the player buys one. Unset keeps whatever the car wears.
const FINISH = (process.env.FINISH || "").trim();
// EXPOSURE=metered measures at whatever the game's meter settles to on
// the frame; default is the manual 1.15 this tool always measured at.
const METERED = process.env.EXPOSURE === "metered";
// EXPOSURE=0.55 measures at that fixed exposure. Exposure is one
// multiplier before tone mapping, so a fixed value equal to where the
// meter settles IS the metered picture, without the minutes each
// metered row costs on a software renderer.
// HOUR=12.5 measures at that hour instead of 2:30.
const HOUR = process.env.HOUR ? +process.env.HOUR : 2.5;
const FIXED = /^[0-9.]+$/.test(process.env.EXPOSURE || "") ? +process.env.EXPOSURE : null;
// Levers for A/B, applied to the live material after the garage has
// painted it: BODY_HEX=1a1b1f (the albedo, as the garage would set it),
// METAL=0.1 and IOR=1.5. Nothing is saved; the next colour repaints.
const OVERRIDE = {
  hex: process.env.BODY_HEX ? parseInt(process.env.BODY_HEX.replace(/^#|^0x/, ""), 16) : null,
  metal: process.env.METAL !== undefined && process.env.METAL !== "" ? +process.env.METAL : null,
  ior: process.env.IOR !== undefined && process.env.IOR !== "" ? +process.env.IOR : null,
  // PROBE_FAR=2100 lets the reflection probe see the sky: the dome is a
  // 1900 m sphere (world.ts) and the probe's cameras stop at 420 m, so a
  // panel at a grazing angle — which mirrors the sky above anything —
  // mirrors nothing at all.
  probeFar: process.env.PROBE_FAR ? +process.env.PROBE_FAR : null,
  // NO_DOME=1 withholds the sky from the probe: the probe as it was
  // before 5ba70bd6, on the code as it is.
  noDome: process.env.NO_DOME === "1" ? true : null,
  // RIM=dfeaff (and RIM_K=1.4) recolours / rescales the player car's rim
  // light — the one car-only light in the night rig (engine.ts), and the
  // cheapest lever on how a paint reads under a blue moon.
  rim: process.env.RIM ? parseInt(process.env.RIM.replace(/^#|^0x/, ""), 16) : null,
  rimK: process.env.RIM_K ? +process.env.RIM_K : null,
};
if (FINISH && !["gloss", "satin", "matte"].includes(FINISH)) {
  console.error(`FINISH=${FINISH}: gloss, satin or matte`);
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--force-color-profile=srgb"],
});
// PAINT_SIZE=550x320 measures at a quarter of the pixels, same aspect
// and so the same framing: on a software renderer the booth is
// fill-bound, and every row it takes is minutes at full size.
const [VW, VH] = (process.env.PAINT_SIZE || "1100x640").split("x").map(Number);
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
const boot = async () => {
  await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("gulf-road-nights-onboarded", "2");
    localStorage.setItem("gulf-road-nights-coach", "3");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.click("text=START ENGINE");
  await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
  // The game starts on its auto-exposure meter, which on a software
  // renderer turns every frame of the page's own loop into seconds of
  // work between the measurements. Pin the manual exposure straight away;
  // each colour sets what it measures at for itself.
  await page.evaluate(() => window.__grnEngine.setExposure(0, false));
  await page.waitForTimeout(4500);
};
await boot();
// The dev server compiles routes on first request, and a compile can
// make the page do a full reload — which destroys whatever evaluate was
// in flight. That killed two long sweeps partway through. A colour whose
// page went away is measured again on a fresh page, once.
const withRetry = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (!/Execution context was destroyed|Target page|navigation/i.test(String(err))) throw err;
    console.log("  (the page reloaded under the measurement; starting it again)");
    await boot();
    return await fn();
  }
};

mkdirSync("press/paint", { recursive: true });

// The booth, from the shipped catalogue rather than a copy kept here: a
// colour someone adds shows up in this measurement without anybody
// remembering to update a list, and a colour renamed cannot leave this
// tool quietly measuring nothing.
const list = await page.evaluate(async () => {
  const res = await fetch("/api/grn/v1/gamedata");
  const j = await res.json();
  return (j.parts || []).filter((p) => p.cat === "paint").map((p) => p.id);
});
if (!list.length) { console.error("the catalogue returned no paints"); await browser.close(); process.exit(2); }

// ONE evaluate per colour, not one for the whole sweep.
//
// The first version measured all thirteen inside a single evaluate and
// was killed at the timeout with nothing to show for eleven minutes of
// rendering. A sweep that can only succeed in full has no partial
// result to look at and no way to see where it slowed down; per colour,
// a failure costs one colour and the numbers arrive as they are taken.
const ids = CARS.length
  ? CARS
  : (ONLY.length ? ONLY.map((s) => (s.startsWith("paint-") ? s : `paint-${s}`)) : list);
// Black twice, first and last: the spread between the two is the
// run's own noise floor, and a difference between two settings smaller
// than it is not a difference.
if (!CARS.length && ids.includes("paint-black")) {
  ids.splice(ids.indexOf("paint-black"), 1);
  ids.unshift("paint-black");
  ids.push("paint-black");
}
console.log(
  `finish ${FINISH || "as worn"}, exposure ${METERED ? "metered" : FIXED !== null ? `fixed ${FIXED}` : "manual 1.15"}` +
  (OVERRIDE.hex !== null ? `, body #${OVERRIDE.hex.toString(16).padStart(6, "0")}` : "") +
  (OVERRIDE.metal !== null ? `, metalness ${OVERRIDE.metal}` : "") +
  (OVERRIDE.ior !== null ? `, ior ${OVERRIDE.ior}` : "") +
  (OVERRIDE.probeFar !== null ? `, probe far ${OVERRIDE.probeFar} m` : "") +
  (OVERRIDE.rim !== null ? `, rim #${OVERRIDE.rim.toString(16).padStart(6, "0")}` : "") +
  (OVERRIDE.rimK !== null ? ` x${OVERRIDE.rimK}` : "")
);

console.log(
  "\npaint".padEnd(17) + "metal".padStart(7) + "dead".padStart(8) + "p10".padStart(7) + "body".padStart(7) +
  "spec".padStart(7) + "form".padStart(7) + "hue".padStart(6) + "sat".padStart(6) + "exp".padStart(7)
);

const rows = [];
for (const only1 of ids) {
 const r1 = await withRetry(() => page.evaluate(async ([shots, cars, id, finish, metered, ov, fixed, hour]) => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const out = [];
  const T = [], tick = (k) => T.push([k, Math.round(performance.now())]);
  tick("start");

  {
    // Paint it through the garage the player uses — the game's own
    // reader and writer, so every migration runs and this measures a
    // save the game made rather than JSON this tool invented — then have
    // the engine re-read it exactly as it does when the garage closes.
    const g = window.__grnLoadGarage();
    if (cars.length) {
      // A car in the colour it left the factory in. Leaving the paint
      // slot empty is what gives that: the build reads the car's own
      // colour whenever nothing has been bought over the top of it.
      if (!g.cars.includes(id)) g.cars.push(id);
      g.car = id;
      g.builds[id] = g.builds[id] || { owned: ["intake-basic"], equipped: { intake: "intake-basic" } };
      delete g.builds[id].equipped.paint;
    } else {
      const build = g.builds[g.car];
      build.owned = Array.from(new Set([...(build.owned || []), id]));
      build.equipped = { ...(build.equipped || {}), paint: id };
    }
    if (finish) {
      const build = g.builds[g.car];
      build.owned = Array.from(new Set([...(build.owned || []), `finish-${finish}`]));
      build.equipped = { ...(build.equipped || {}), finish: `finish-${finish}` };
    }
    window.__grnSaveGarage(g);
    e.refreshGarage();
    tick("garage");

    e.setPaused(true);
    e.applyQualityTier("high");
    // Stop the clock first. The default sky setting is "kuwait" — the real
    // time in Kuwait — and update() rewrites the hour from the wall clock
    // on every frame, re-lighting the sky four times a second. Setting the
    // hour without this measured whatever time it really was in Kuwait:
    // a two-hour sweep watched the sky change under it (black went from
    // 35.5% dead to 60.3% between its first and last reading), and a run
    // asked for noon at eleven at night got night.
    e.timeReal = false;
    e.timeCycling = false;
    e.timeHours = hour;
    e.world.setTimeOfDay(hour);
    e.applyDaylight();
    tick("daylight");
    e.setExposure(0, false);
    const m = 587; // under the lamps, where a clearcoat has something to do
    const park = () => {
      const away = e.track.wrap(m + e.track.length / 2);
      for (const t of e.traffic) t.s = away;
      if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
      e.player.s = m;
      e.player.lat = 0;
      e.player.speed = 0;
    };
    park();
    const paintMat = e.carBody.userData.bodyMat;
    if (ov.hex !== null) paintMat.color.setHex(ov.hex);
    if (ov.metal !== null) paintMat.metalness = ov.metal;
    if (ov.ior !== null) { paintMat.ior = ov.ior; paintMat.needsUpdate = true; }
    if (ov.noDome) e.probeDome = null;
    if (ov.rim !== null || ov.rimK !== null) {
      e.playerMesh.traverse((o) => {
        if (!o.isPointLight || o.userData.rimBase === undefined && o.color.getHex() !== 0x86a9ff) return;
        o.userData.rimBase ??= o.intensity;
        if (ov.rim !== null) o.color.setHex(ov.rim);
        if (ov.rimK !== null) o.intensity = o.userData.rimBase * ov.rimK;
      });
    }
    if (ov.probeFar !== null) {
      for (const cam of e.cubeCam.children) { cam.far = ov.probeFar; cam.updateProjectionMatrix(); }
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 30; i++) { e.update(1 / 60); park(); }
      for (let i = 0; i < 4; i++) e.composer.render();
    }
    // The game only renders its reflection probe from the frame loop,
    // and only when NOT paused — so a paused measurement read a cube
    // left over from wherever the car was before it was parked here.
    // Run the sweep round to face 0, then one whole sweep from there:
    // the PMREM re-convolves when a sweep completes, so this is the
    // fewest faces that guarantee a cube made entirely at this spot.
    tick("settle");
    while (e.probeFace !== 0) e.renderProbe();
    for (let i = 0; i < 6; i++) e.renderProbe();
    e.composer.render();
    tick("probe");
    // METERED: what the game's own meter asks for on THIS frame, then
    // the frame measured at exactly that exposure.
    //
    // Exposure is one multiplier on the HDR frame before tone mapping
    // (grade.ts, ExposureShader), so a frame drawn at the meter's settled
    // value through the MANUAL path is the frame the meter would show
    // once it had settled. That matters here because the metered path is
    // unusable on a software renderer: measured at 550x320, a manual
    // render took 0.1 s, a metered one 9 s, and one async exposure
    // readback 54 s. The meter still has to settle, and it opens up at
    // 0.7/s with each render's step capped at 0.25 s — so its rates are
    // raised for the few renders it needs (where it settles does not
    // depend on how fast it gets there) and put back after, and the
    // value is read back synchronously.
    let exposure = fixed ?? 1.15, settled = !metered;
    if (fixed !== null) e.autoExp.exposureMat.uniforms.uManual.value = fixed;
    if (metered) {
      const ax = e.autoExp;
      const rates = ax.adaptMat.uniforms.uRates.value;
      const keep = rates.clone();
      rates.set(40, 40);
      e.setExposure(0, true);
      const read = () => {
        const buf = new Uint16Array(4);
        e.renderer.readRenderTargetPixels(ax.expTargets[ax.ping], 0, 0, 1, 1, buf);
        return THREE.DataUtils.fromHalfFloat(buf[0]);
      };
      let last = -1;
      for (let i = 0; i < 6; i++) {
        e.composer.render();
        const x = read();
        exposure = x;
        if (Math.abs(x - last) < 0.004 * x) { settled = true; break; }
        last = x;
      }
      rates.copy(keep);
      e.setExposure(0, false);
      ax.exposureMat.uniforms.uManual.value = exposure;
    }
    // And render the frame that gets measured HERE, with nothing awaited
    // between it and the copy below: the canvas does not preserve its
    // drawing buffer, so once the page has yielded the frame has been
    // presented and cleared, and the copy reads a black rectangle.
    e.composer.render();

    tick("meter+frame");
    const W = e.renderer.domElement.clientWidth || 1100;
    const H = e.renderer.domElement.clientHeight || 640;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
    const beauty = ctx.getImageData(0, 0, W, H).data;

    // ID pass by MATERIAL: whatever wears the paint is bodywork, which
    // no naming convention can get wrong.
    const paint = e.carBody.userData.bodyMat;
    const saved = [], hidden = [], tinted = [];
    const mats = [
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x000000), fog: false }),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x00ff00), fog: false }),
    ];
    e.scene.traverse((o) => {
      if (o.isSprite && o.visible) { hidden.push(o); o.visible = false; return; }
      if (!o.isMesh && !o.isInstancedMesh) return;
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      if (src && (src.transparent || (src.opacity ?? 1) < 1)) {
        if (o.visible) { hidden.push(o); o.visible = false; }
        return;
      }
      saved.push([o, o.material]);
      o.material = mats[src === paint ? 1 : 0];
      if (o.isInstancedMesh && o.instanceColor) { tinted.push([o, o.instanceColor]); o.instanceColor = null; }
    });
    const prevTone = e.renderer.toneMapping;
    const prevSpace = e.renderer.outputColorSpace;
    const prevBg = e.scene.background;
    e.renderer.toneMapping = THREE.NoToneMapping;
    e.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    e.scene.background = new THREE.Color(0x000000);
    const rt = new THREE.WebGLRenderTarget(W, H);
    e.renderer.setRenderTarget(rt);
    e.renderer.render(e.scene, e.camera);
    const rawpx = new Uint8Array(W * H * 4);
    e.renderer.readRenderTargetPixels(rt, 0, 0, W, H, rawpx);
    e.renderer.setRenderTarget(null);
    rt.dispose();
    const idsPx = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      idsPx.set(rawpx.subarray(src, src + W * 4), y * W * 4);
    }
    e.renderer.toneMapping = prevTone;
    e.renderer.outputColorSpace = prevSpace;
    e.scene.background = prevBg;
    for (const [o, mm] of saved) o.material = mm;
    for (const [o, ic] of tinted) o.instanceColor = ic;
    for (const o of hidden) o.visible = true;
    for (const mm of mats) mm.dispose();

    tick("idpass");
    const isBody = (p) => {
      const i = p * 4;
      return idsPx[i + 1] > 24 && idsPx[i] < 12 && idsPx[i + 2] < 12;
    };
    const lum = [], px = [];
    for (let p = 0; p < W * H; p++) {
      if (!isBody(p)) continue;
      const i = p * 4;
      lum.push(0.2126 * beauty[i] + 0.7152 * beauty[i + 1] + 0.0722 * beauty[i + 2]);
      px.push(i);
    }
    lum.sort((a, b) => a - b);
    const at = (q) => (lum.length ? lum[Math.min(lum.length - 1, Math.floor(q * lum.length))] : 0);

    // Hue and saturation over the WHOLE body, so "is that yellow or
    // olive" stops being an argument — and so it is not decided by the
    // one pixel that happened to sit nearest the median. Hue is circular:
    // the median is taken around the saturation-weighted mean direction,
    // and only over pixels with enough colour to have a hue at all.
    let hue = 0, sat = 0;
    if (px.length) {
      const hs = [], ss = [];
      let cx = 0, cy = 0;
      for (const i of px) {
        const r = beauty[i] / 255, g2 = beauty[i + 1] / 255, b = beauty[i + 2] / 255;
        const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b), d = mx - mn;
        const s1 = mx ? d / mx : 0;
        ss.push(s1);
        if (d < 4 / 255) continue;
        let h;
        if (mx === r) h = 60 * (((g2 - b) / d) % 6);
        else if (mx === g2) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g2) / d + 4);
        if (h < 0) h += 360;
        hs.push(h);
        cx += s1 * Math.cos((h * Math.PI) / 180);
        cy += s1 * Math.sin((h * Math.PI) / 180);
      }
      ss.sort((a, b) => a - b);
      sat = ss[Math.floor(ss.length / 2)];
      if (hs.length) {
        const mean = (Math.atan2(cy, cx) * 180) / Math.PI;
        const rel = hs.map((h) => ((h - mean + 540) % 360) - 180).sort((a, b) => a - b);
        hue = (mean + rel[Math.floor(rel.length / 2)] + 360) % 360;
      }
    }

    let png = null;
    if (shots) {
      for (let i = 0; i < 4; i++) e.composer.render();
      ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
      png = c.toDataURL("image/jpeg", 0.8).split(",")[1];
    }
    out.push({
      id,
      metal: +paint.metalness.toFixed(3),
      px: lum.length,
      dead: lum.length ? +((lum.filter((v) => v <= 8).length / lum.length) * 100).toFixed(1) : 0,
      p10: +at(0.1).toFixed(1),
      // The weather advances with every update, paused or not, and a wet
      // road and falling rain change what a car reflects.
      hour: +e.timeHours.toFixed(2),
      wet: +(e.wx?.wetness ?? 0).toFixed(3),
      rain: +(e.wx?.fall ?? 0).toFixed(3),
      exp: +exposure.toFixed(3),
      settled,
      finish: finish || null,
      body: +at(0.5).toFixed(1),
      spec: +at(0.99).toFixed(1),
      form: +(at(0.9) - at(0.1)).toFixed(1),
      hue: Math.round(hue),
      sat: +sat.toFixed(2),
      png,
      timing: T.map(([k, t], i) => `${k} ${i ? t - T[i - 1][1] : 0}`).join(", "),
    });
  }
  return out;
 }, [SHOTS, CARS, only1, FINISH, METERED, OVERRIDE, FIXED, HOUR]));
 for (const r of r1) {
  rows.push(r);
  if (r.err) { console.log(`${r.id.padEnd(16)} ${r.err}`); continue; }
  if (process.env.TIMING === "1") console.log(`  ${r.timing}`);
  if (r.png) writeFileSync(`press/paint/${r.id}.jpg`, Buffer.from(r.png, "base64"));
  console.log(
    r.id.padEnd(16) + String(r.metal).padStart(7) + (r.dead + "%").padStart(8) + String(r.p10).padStart(7) +
    String(r.body).padStart(7) + String(r.spec).padStart(7) + String(r.form).padStart(7) +
    (r.hue + "°").padStart(6) + String(r.sat).padStart(6) +
    (String(r.exp) + (r.settled ? "" : "?")).padStart(7) +
    `  ${r.hour}h` + (r.wet || r.rain ? `  wet ${r.wet} rain ${r.rain}` : "")
  );
 }
}

await browser.close();
// A lever run is an experiment, not the booth: it goes to its own file
// so it cannot overwrite the baseline it is being compared against.
const lever = Object.values(OVERRIDE).some((v) => v !== null);
const out = process.env.PAINT_OUT ||
  (lever ? "press/paint/colors-lever.json" : "press/paint/colors.json");
writeFileSync(out, JSON.stringify(rows.map(({ png, timing, ...r }) => r), null, 2));
console.log(`\n${out}`);
