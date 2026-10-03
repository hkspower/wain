// What the paint is actually doing, measured on the body panels alone.
//
//   npm run dev
//   node tools/shots/paint.mjs
//
// "Glossy" is not one number. A surface can have a searing highlight and
// still look like plastic, which is exactly what was wrong here: the
// specular streak along the shoulder line was bright enough to read as a
// neon tube while every flat panel between the highlights sat at almost
// pure black. Two separate faults that a single "is it shiny" reading
// would average into looking fine.
//
// So the body panels are segmented out with an ID pass and reported as a
// distribution:
//
//   dead     fraction of body pixels at 8/255 or below. Panels with
//            nothing on them at all. This is the "flat" complaint.
//   body     the median — what the colour of the car actually reads as.
//   spec     the 99th percentile — the highlight.
//   ratio    spec / body. Gloss is CONTRAST between the two, but a huge
//            ratio with a dead median is not gloss, it is a light in a
//            black room.
//   tight    fraction above half the highlight. A glossy surface puts
//            its highlight in a small area; a matte one smears it.
//   clip     fraction of body pixels at 250 or above — what a hotter
//            lacquer spends of tests/grade.mjs's 1.4% clipping guard.
//   grain    mean luma gradient inside the panels (the "detail" the 4K
//            panel stats report). Whether the reflection has an image
//            in it or is a smooth smear.
//   crisp    the same gradient over the brightest 5% of panel pixels:
//            how sharp the reflection is where there is one.
//   hue      circular mean hue of the body, its error against the
//            paint's own hue, and the median saturation. A red that
//            mirrors a blue sky through a near-pure metal basecoat comes
//            back purple; this is the number that says so.
//
// LEVERS (env):
//
//   FINISH=gloss|satin|matte|as-is   BODY=#c1272d
//   TIER=high      the quality tier; balanced or battery measure the
//                  BAKED reflection path (no live probe), which is what
//                  most of those players and the menu draw
//   VIEW=chase     the game's own camera; VIEW=flank stands 4 m off the
//                  shell's +x side, 1 m up, where the flank mirrors the
//                  lamps and the city rather than sky (flank2: -x side)
//   SPOT=lamps|dark   PAINT="r,m,cc; ..."   PROBE="256;512"

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
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--force-color-profile=srgb"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 640 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
  // PIN THE SKY. The game ships with sky "kuwait" — the world boots at
  // the real hour in Kuwait — and the lighting GLIDES to a new hour
  // rather than snapping, so the 02:30 this tool asks for below is a
  // target the world is still on its way to when the first reading is
  // taken. Run in a Kuwaiti morning, the first row of every session was
  // a half-daylight frame: body 96-103 against 64 for every row after
  // it, on the same paint and the same probe, and the press frame it
  // wrote had a blue sky in it. "night" is the fixed hour the settings
  // screen offers for exactly this, and fullrace.mjs and daynight.mjs
  // already pin it.
  localStorage.setItem("gulf-road-nights-settings", JSON.stringify({ sky: "night" }));
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(4500);
// MAP_SCALE, REPEAT, PAINT_NOMAPS and PEEL are gone. Each poked a normal
// map on the paint — the flake's, or the clearcoat's orange peel — and
// both maps were removed from cars.ts (see the note above chromeMat), so
// every one of those levers had been setting properties on nothing and
// printing the result as a measurement.
for (const dead of ["MAP_SCALE", "REPEAT", "PAINT_NOMAPS", "PEEL"]) {
  if (process.env[dead]) { console.error(`${dead}: the paint has no normal maps any more — nothing to set`); process.exit(2); }
}
if (process.env.PROBE_RED) {
  await page.evaluate(() => { window.__probeRed = true; });
  console.log("(body forced red — validating that the override path works at all)");
}

// MEASURE THE FINISH THIS TOOL IS NAMED FOR.
//
// Everything below reads the car the player is actually driving, and a
// fresh save drives the Wain Special: satin, in #f2f4f7. So the gloss
// check has been measuring a near-white SATIN car — it printed
// "<- NOT the gloss finish" under every reading it ever took, and the
// warning went unanswered. Two things were wrong with that subject at
// once. The finish is the obvious one. The colour is the quieter one: a
// body already sitting at 180 of 255 cannot show a spec/body ratio
// above about 1.4 whatever the lacquer does, so the headline number was
// pinned by the paint rather than by the gloss.
//
// The default is now the gloss finish on a mid-dark red — a colour with
// somewhere to go — and the shipped car is still measurable with
// FINISH=as-is.
const FINISH = process.env.FINISH ?? "gloss";
const BODY = process.env.BODY ?? "#c1272d";
if (FINISH !== "as-is") {
  await page.evaluate(([f, hex]) => { window.__finish = f; window.__body = hex; }, [FINISH, BODY]);
  console.log(`(measuring the ${FINISH} finish on ${BODY} — FINISH=as-is for the car as it ships)`);
}
// The tier. High has always been the default and stays it; anything below
// High has no live probe, so TIER=balanced is how the baked path — and
// with it the gains three used to drop there — gets measured at all.
const TIER = process.env.TIER ?? "high";
if (!["ultra", "high", "balanced", "battery"].includes(TIER)) {
  console.error(`TIER=${TIER}: ultra, high, balanced or battery`);
  process.exit(2);
}
// Where the camera stands. The chase camera sees the rear deck and the
// roof, which face the sky, so it measures a paint mirroring a smooth
// dome: doubling the lamps inside the probe moved nothing from there. A
// flank stood off broadside mirrors the lamps and the city, which is
// where a highlight's shape and a reflected image actually live.
const VIEW = process.env.VIEW ?? "chase";
if (!["chase", "flank", "flank2"].includes(VIEW)) {
  console.error(`VIEW=${VIEW}: chase, flank or flank2`);
  process.exit(2);
}
console.log(`(tier ${TIER}, ${VIEW} view)`);

mkdirSync("press/paint", { recursive: true });

// Under the lamps in the city, where a clearcoat has something to
// reflect, and out on the dark coast where it has almost nothing. The
// two say different things: the first is about highlights, the second
// about whether a panel dies when nothing is shining on it.
const ALL_SPOTS = [["lamps", 587], ["dark", 1300]];
// One spot, when a sweep only needs one. Each measurement drives the
// engine for two settle passes and renders an extra ID frame on a
// software rasteriser, so a five-way sweep across both spots does not
// finish inside a sensible timeout — and a sweep that gets killed
// reports nothing at all.
const SPOTS = process.env.SPOT
  ? ALL_SPOTS.filter(([n]) => n === process.env.SPOT)
  : ALL_SPOTS;
if (!SPOTS.length) { console.error(`no spot named ${process.env.SPOT}`); process.exit(2); }
// A scan, when asked for one: PAINT="rough,metal,ccRough; ..." puts each
// setting on the live material and measures it in the same session, so
// the comparison is against the same frame rather than against another
// run of the game.
const SCAN = (process.env.PAINT || "").split(";").map((t) => t.trim()).filter(Boolean);
const SETTINGS = SCAN.length ? SCAN.map((t) => t.split(",").map(Number)) : [null];
// (The PEEL lever that lived here swept the clearcoat normal map's repeat
// and scale. The map is gone — see the note above chromeMat in cars.ts —
// and the lever had been measuring nothing since. One lesson from it
// still stands for any surface texture: read it on the segmented body
// pixels, never full frame, where road and sky drown it.)
// The reflection probe's face size, on the same axis. What the clearcoat
// reflects is a cube rendered from the car, and the size of that cube is
// a ceiling on how sharp the reflection can be whatever the lacquer's
// roughness says: a lamp twenty metres off is one texel wide at 128.
//
//   PROBE="128;256;512" node tools/shots/paint.mjs
//
// Sizes, or nothing for whatever the tier the tool runs on would build.
const PROBES = (process.env.PROBE || "").split(";").map((t) => t.trim()).filter(Boolean).map(Number);
const PROBESET = PROBES.length ? PROBES : [null];
for (const [where, m] of SPOTS) {
 for (const set of SETTINGS) {
  for (const probe of PROBESET) {
  const r = await page.evaluate(async ([m, set, probe, tier, view]) => {
    const THREE = window.__grnThree;
    const e = window.__grnEngine;
    e.setPaused(true);
    if (window.__finish) {
      // The game's own numbers, from the function createCar builds with
      // (cars.ts paintParams), so this measures the finish the game
      // would build rather than an approximation of it.
      //
      // It used to do the arithmetic itself. The basecoat roughness was a
      // typed copy of 0.18, which the move to 0.24 would have left behind.
      // And the metalness was __grnPaintMetalness(window.__body) — the CSS
      // string "#c1272d", which the curve's bit maths read as luminance 0
      // and answered 0.18 for, where the game built 0xc1272d at 0.95
      // (0.75 now: cars.ts PAINT_METAL_TOP). So from a17dec76
      // (Sep 5) until this, every "gloss #c1272d" figure — the peel
      // table, the 128/256/512 probe table, the lamp-gain note — was
      // taken on a paint at metalness 0.18 that no car wears. The hooks
      // now throw on anything but a number.
      const bm = e.carBody.userData.bodyMat;
      const F = window.__grnFinishes[window.__finish];
      const hex = parseInt(window.__body.replace("#", ""), 16);
      const P = window.__grnPaintParams(hex, window.__finish);
      bm.color.setHex(hex);
      bm.roughness = P.roughness;
      bm.metalness = P.metalness;
      bm.clearcoat = P.clearcoat;
      bm.clearcoatRoughness = P.clearcoatRoughness;
      bm.envMapIntensity = P.envMapIntensity;
      // And the scale the ENGINE reads. dressReflections sets the paint's
      // gain from the car's own userData.envScale whenever it re-dresses
      // the car — which applyQualityTier below does — so a finish poked
      // onto the material alone was re-dressed as whatever the car really
      // wears: FINISH=matte on the satin Wain Special read env 1.3, the
      // satin number, and called itself matte.
      e.carBody.userData.envScale = F.envScale;
      bm.needsUpdate = true;
    }
    if (set) {
      const bm = e.carBody.userData.bodyMat;
      bm.roughness = set[0];
      bm.metalness = set[1];
      bm.clearcoatRoughness = set[2];
      bm.needsUpdate = true;
    }
    if (window.__probeRed) {
      const bm = e.carBody.userData.bodyMat;
      bm.color.setHex(0xff0000);
      bm.needsUpdate = true;
    }
    e.applyQualityTier(tier);
    if (probe) e.setProbeResolution(probe);
    e.timeReal = false; e.timeCycling = false; e.timeHours = 2.5;
    e.world.setTimeOfDay(2.5);
    e.applyDaylight();
    e.setExposure(0, false);
    const park = () => {
      const away = e.track.wrap(m + e.track.length / 2);
      for (const t of e.traffic) t.s = away;
      if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
      e.player.s = m;
      e.player.lat = 0;
      e.player.speed = 0;
    };
    park();
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 30; i++) { e.update(1 / 60); park(); }
      for (let i = 0; i < 4; i++) e.composer.render();
    }
    // VIEW=flank: 4 m off the shell's side, 1 m up, looking at the door.
    // Placed after the last update, which is what sets the chase camera,
    // and put back below; the shell's own axes, so it never has to know
    // which way the road runs at this spot (as tools/shots/ik4k.mjs).
    const cam = e.camera;
    const fovWas = cam.fov;
    if (view !== "chase") {
      const body = e.carBody;
      body.updateWorldMatrix(true, true);
      const pos = new THREE.Vector3().setFromMatrixPosition(body.matrixWorld);
      const side = new THREE.Vector3().setFromMatrixColumn(body.matrixWorld, 0).setY(0).normalize();
      if (view === "flank2") side.negate();
      cam.position.copy(pos).addScaledVector(side, 4);
      cam.position.y = pos.y + 1.0;
      cam.lookAt(pos.x, pos.y + 0.55, pos.z);
      // 46 degrees vertical is about 72 across at 1100x640: the whole
      // shell, nose to tail, from 4 m.
      cam.fov = 46;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      // The lamp shafts and pool fade by where they are seen from.
      e.updateBeamVisibility?.();
    }
    // FILL THE PROBE. The paint reflects a cube rendered from the car,
    // and that cube is only ever rendered by the live frame loop — which
    // this tool pauses before it does anything. Worse, applyQualityTier
    // above rebuilds the target at the tier's size, and a rebuilt target
    // is empty. So every reading this tool had ever taken was of a
    // clearcoat mirroring a black cube: the highlight it reported was
    // the direct lamps alone, and the "env" it printed was a gain on
    // nothing. Six faces, one per call, exactly as the loop does it, from
    // where the car is now parked; the PMREM convolution the sixth face
    // requests is consumed by the renders that follow. From face 0, so
    // the whole cube is from this spot. Not at all below High: there is
    // no live probe there, and the paint reads the baked environment.
    if (e.liveReflections) {
      while (e.probeFace !== 0) e.renderProbe();
      for (let i = 0; i < 6; i++) e.renderProbe();
    }
    for (let i = 0; i < 4; i++) e.composer.render();

    const W = e.renderer.domElement.clientWidth || 1100;
    const H = e.renderer.domElement.clientHeight || 640;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
    const beauty = ctx.getImageData(0, 0, W, H).data;

    // ID pass: the player's painted panels green, everything else black.
    // Identified by MATERIAL rather than by name — the paint is one
    // cloned material per car and every panel wearing it is bodywork by
    // definition, which no naming convention can get wrong.
    const paint = e.carBody.userData.bodyMat;
    const saved = [];
    const hidden = [];
    const tinted = [];
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
      if (o.isInstancedMesh && o.instanceColor) {
        tinted.push([o, o.instanceColor]);
        o.instanceColor = null;
      }
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
    const raw = new Uint8Array(W * H * 4);
    e.renderer.readRenderTargetPixels(rt, 0, 0, W, H, raw);
    e.renderer.setRenderTarget(null);
    rt.dispose();
    const ids = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      ids.set(raw.subarray(src, src + W * 4), y * W * 4);
    }
    e.renderer.toneMapping = prevTone;
    e.renderer.outputColorSpace = prevSpace;
    e.scene.background = prevBg;
    for (const [o, mm] of saved) o.material = mm;
    for (const [o, ic] of tinted) o.instanceColor = ic;
    for (const o of hidden) o.visible = true;
    for (const mm of mats) mm.dispose();

    const lum = [];
    // Full-frame luma, so a gradient can be taken with neighbours.
    const full = new Float32Array(W * H);
    for (let i = 0, p = 0; i < beauty.length; i += 4, p++) {
      full[p] = 0.2126 * beauty[i] + 0.7152 * beauty[i + 1] + 0.0722 * beauty[i + 2];
    }
    const isBody = (p) => {
      const i = p * 4;
      return ids[i + 1] > 24 && ids[i] < 12 && ids[i + 2] < 12;
    };
    // Grain: mean local gradient INSIDE the panels, taken only where all
    // four neighbours are also panel, so a panel edge against the night
    // cannot be mistaken for surface texture. Flake and orange peel are
    // exactly this — high-frequency variation across a surface that
    // would otherwise be a smooth ramp — so this is the number that says
    // whether they are doing anything at all.
    let gN = 0, gSum = 0;
    // Kept per pixel for `crisp` below.
    const grad = new Float32Array(W * H).fill(-1);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        if (!isBody(p) || !isBody(p - 1) || !isBody(p + 1) || !isBody(p - W) || !isBody(p + W)) continue;
        const g = (Math.abs(full[p + 1] - full[p - 1]) + Math.abs(full[p + W] - full[p - W])) / 2;
        grad[p] = g;
        gSum += g;
        gN++;
      }
    }
    // Hue and saturation over the whole body. The hue is a CIRCULAR mean
    // — a red sits across 0/360, where a median or a plain average lands
    // on cyan — over every pixel with any chroma at all; the same
    // definition the scratch sweep behind the 0.95 -> 0.75 change used,
    // so its 316 and 333 are comparable with what this prints.
    let hx = 0, hy = 0;
    const sats = [];
    for (let p = 0; p < W * H; p++) {
      if (!isBody(p)) continue;
      lum.push(full[p]);
      const i = p * 4;
      const rr = beauty[i], gg = beauty[i + 1], bb = beauty[i + 2];
      const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb), d = mx - mn;
      sats.push(mx ? d / mx : 0);
      if (d > 0) {
        let h = mx === rr ? ((gg - bb) / d) % 6 : mx === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
        h *= Math.PI / 3;
        hx += Math.cos(h);
        hy += Math.sin(h);
      }
    }
    lum.sort((a, b) => a - b);
    sats.sort((a, b) => a - b);
    const at = (q) => (lum.length ? lum[Math.min(lum.length - 1, Math.floor(q * lum.length))] : 0);
    const spec = at(0.99);
    const dead = lum.filter((v) => v <= 8).length;
    const tight = lum.filter((v) => v >= spec * 0.5).length;
    const clip = lum.filter((v) => v >= 250).length;
    // Crisp: the panel gradient over the brightest 5% of the body — the
    // highlight's own edge, where grain averages it in with every smooth
    // panel between. Neither is a sharpness meter for the REFLECTED
    // IMAGE: the sweep that took gloss to 0.045 on a 512 probe saw the
    // buildings' windows on the roof resolve from one blob into windows
    // (+19% gradient on that patch) while grain went 7.10 -> 6.99 and
    // crisp 29.3 -> 28.6. Look at the frame, and at VIEW=flank, for that.
    const cut = at(0.95);
    let cN = 0, cSum = 0;
    for (let p = 0; p < W * H; p++) {
      if (grad[p] >= 0 && full[p] >= cut) { cSum += grad[p]; cN++; }
    }
    const hueOf = (hex) => {
      const rr = (hex >> 16) & 255, gg = (hex >> 8) & 255, bb = hex & 255;
      const mx = Math.max(rr, gg, bb), d = mx - Math.min(rr, gg, bb);
      if (!d) return null;
      const h = (mx === rr ? ((gg - bb) / d) % 6 : mx === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4) * 60;
      return (h + 360) % 360;
    };
    const hue = hx || hy ? ((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360 : null;
    const own = hueOf(e.carBody.userData.bodyMat.color.getHex());
    const hueErr = hue === null || own === null ? null : Math.abs(((hue - own + 540) % 360) - 180);

    for (let i = 0; i < 4; i++) e.composer.render();
    ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
    cam.fov = fovWas;
    cam.updateProjectionMatrix();
    // SAY WHAT WAS MEASURED.
    //
    // Without this line the "current" row is uninterpretable, and it
    // misled the author of this comment for a whole sweep. The car the
    // tool loads is whatever the default save has on it — which is
    // paint-white in a SATIN finish, the least glossy combination in
    // the game: metalness 0 because white is a declared solid, roughness
    // 0.34 because satin adds 0.10 to the 0.24 basecoat, and a
    // clearcoat at 0.42. A gloss change to the gloss finish barely
    // moves that row, and the row looks like the change did nothing.
    //
    // And what the lacquer RENDERED at, which is not the material's
    // number: the shader floors clearcoatRoughness at the shared uniform
    // (cars.ts PAINT_UNIFORMS), and the source is the live probe or the
    // bake depending on the tier.
    const bm2 = e.carBody.userData.bodyMat;
    const floor = window.__grnPaintUniforms?.uCcFloor.value ?? 0.0525;
    const mat = {
      colour: "#" + bm2.color.getHexString(),
      metalness: +bm2.metalness.toFixed(3),
      roughness: +bm2.roughness.toFixed(3),
      ccRough: +bm2.clearcoatRoughness.toFixed(3),
      ccDrawn: +Math.max(bm2.clearcoatRoughness, floor).toFixed(4),
      clearcoat: +bm2.clearcoat.toFixed(2),
      env: +bm2.envMapIntensity.toFixed(2),
      source: !bm2.envMap
        ? "NONE"
        : bm2.envMap === e.cubeRT?.texture
          ? `probe ${e.cubeRT.width}`
          : "baked",
    };
    return {
      mat,
      px: lum.length,
      dead: lum.length ? +((dead / lum.length) * 100).toFixed(1) : 0,
      body: +at(0.5).toFixed(1),
      spec: +spec.toFixed(1),
      tight: lum.length ? +((tight / lum.length) * 100).toFixed(1) : 0,
      clip: lum.length ? +((clip / lum.length) * 100).toFixed(2) : 0,
      grain: gN ? +(gSum / gN).toFixed(2) : 0,
      crisp: cN ? +(cSum / cN).toFixed(2) : 0,
      hue: hue === null ? null : Math.round(hue),
      hueErr: hueErr === null ? null : Math.round(hueErr),
      sat: sats.length ? +sats[Math.floor(sats.length / 2)].toFixed(2) : 0,
      png: c.toDataURL("image/png").split(",")[1],
    };
  }, [m, set, probe, TIER, VIEW]);
  // The press frame is the chase view at High, as it always was; any
  // other tier or view writes beside it rather than over it.
  const suffix = `${TIER === "high" ? "" : `-${TIER}`}${VIEW === "chase" ? "" : `-${VIEW}`}`;
  if (!set && !probe) writeFileSync(`press/paint/${where}${suffix}.png`, Buffer.from(r.png, "base64"));
  const ratio = r.body > 0 ? (r.spec / r.body).toFixed(1) : "inf";
  const tag = probe ? `probe ${probe}` : null;
  console.log(
    `${where.padEnd(6)} ${(set ? `r${set[0]} m${set[1]} cc${set[2]}` : tag ?? "current").padEnd(18)}` +
      `  dead ${String(r.dead).padStart(5)}%   ` +
      `body ${String(r.body).padStart(5)}   spec ${String(r.spec).padStart(5)}   ` +
      `ratio ${String(ratio).padStart(6)}   highlight ${String(r.tight).padStart(5)}%   ` +
      `clip ${String(r.clip).padStart(5)}%   grain ${String(r.grain).padStart(5)}   ` +
      `crisp ${String(r.crisp).padStart(5)}   hue ${String(r.hue).padStart(3)} ` +
      `(err ${String(r.hueErr).padStart(3)})   sat ${r.sat}`
  );
  if (!set && !probe) {
    console.log(
      `       on ${r.mat.colour} rough ${r.mat.roughness} metal ${r.mat.metalness} ` +
        `clearcoat ${r.mat.clearcoat}/${r.mat.ccRough} (drawn at ${r.mat.ccDrawn}) ` +
        `env ${r.mat.env} from ${r.mat.source}` +
        `${r.mat.clearcoat < 0.9 ? "  <- NOT the gloss finish" : ""}` +
        `${r.mat.source === "NONE" ? "  <- envMap null: three draws it at the scene's intensity" : ""}`
    );
  }
  }
 }
}
await browser.close();
console.log("\npress/paint/*.png");
