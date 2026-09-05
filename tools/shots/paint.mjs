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
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(4500);
if (process.env.MAP_SCALE) {
  const v = Number(process.env.MAP_SCALE);
  await page.evaluate((x) => { window.__mapScale = x; }, v);
  console.log(`(normal scale forced to ${v})`);
}
if (process.env.REPEAT) {
  const v = Number(process.env.REPEAT);
  await page.evaluate((x) => { window.__repeat = x; }, v);
  console.log(`(flake repeat forced to ${v})`);
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
if (process.env.PAINT_NOMAPS) {
  await page.evaluate(() => { window.__noMaps = true; });
  console.log("(flake and orange peel off)");
}

mkdirSync("press/paint", { recursive: true });

// Under the lamps in the city, where a clearcoat has something to
// reflect, and out on the dark coast where it has almost nothing. The
// two say different things: the first is about highlights, the second
// about whether a panel dies when nothing is shining on it.
const SPOTS = [["lamps", 587], ["dark", 1300]];
// A scan, when asked for one: PAINT="rough,metal,ccRough; ..." puts each
// setting on the live material and measures it in the same session, so
// the comparison is against the same frame rather than against another
// run of the game.
const SCAN = (process.env.PAINT || "").split(";").map((t) => t.trim()).filter(Boolean);
const SETTINGS = SCAN.length ? SCAN.map((t) => t.split(",").map(Number)) : [null];
for (const [where, m] of SPOTS) {
 for (const set of SETTINGS) {
  const r = await page.evaluate(async ([m, set]) => {
    const THREE = window.__grnThree;
    const e = window.__grnEngine;
    e.setPaused(true);
    if (window.__finish) {
      // The same arithmetic cars.ts does, against the same table, so
      // this measures the finish the game would build rather than an
      // approximation of it.
      const bm = e.carBody.userData.bodyMat;
      const F = window.__grnFinishes[window.__finish];
      bm.color.set(window.__body);
      bm.roughness = 0.18 + F.roughnessAdd;
      bm.metalness = window.__grnPaintMetalness(window.__body) * F.metalScale;
      bm.clearcoat = F.clearcoat;
      bm.clearcoatRoughness = F.clearcoatRoughness;
      bm.envMapIntensity = 1.5 * F.envScale;
      bm.needsUpdate = true;
    }
    if (set) {
      const bm = e.carBody.userData.bodyMat;
      bm.roughness = set[0];
      bm.metalness = set[1];
      bm.clearcoatRoughness = set[2];
      bm.needsUpdate = true;
    }
    if (window.__mapScale !== undefined) {
      const bm = e.carBody.userData.bodyMat;
      bm.normalScale.set(window.__mapScale, window.__mapScale);
      bm.clearcoatNormalScale.set(window.__mapScale, window.__mapScale);
      bm.needsUpdate = true;
    }
    if (window.__repeat !== undefined) {
      const bm = e.carBody.userData.bodyMat;
      if (bm.normalMap) bm.normalMap.repeat.set(window.__repeat, window.__repeat);
      bm.needsUpdate = true;
    }
    if (window.__probeRed) {
      const bm = e.carBody.userData.bodyMat;
      bm.color.setHex(0xff0000);
      bm.needsUpdate = true;
    }
    if (window.__noMaps) {
      const bm = e.carBody.userData.bodyMat;
      bm.normalMap = null;
      bm.clearcoatNormalMap = null;
      bm.needsUpdate = true;
    }
    e.applyQualityTier("high");
    e.timeHours = 2.5;
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
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        if (!isBody(p) || !isBody(p - 1) || !isBody(p + 1) || !isBody(p - W) || !isBody(p + W)) continue;
        gSum += (Math.abs(full[p + 1] - full[p - 1]) + Math.abs(full[p + W] - full[p - W])) / 2;
        gN++;
      }
    }
    for (let p = 0; p < W * H; p++) if (isBody(p)) lum.push(full[p]);
    lum.sort((a, b) => a - b);
    const at = (q) => (lum.length ? lum[Math.min(lum.length - 1, Math.floor(q * lum.length))] : 0);
    const spec = at(0.99);
    const dead = lum.filter((v) => v <= 8).length;
    const tight = lum.filter((v) => v >= spec * 0.5).length;

    for (let i = 0; i < 4; i++) e.composer.render();
    ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
    // SAY WHAT WAS MEASURED.
    //
    // Without this line the "current" row is uninterpretable, and it
    // misled the author of this comment for a whole sweep. The car the
    // tool loads is whatever the default save has on it — which is
    // paint-white in a SATIN finish, the least glossy combination in
    // the game: metalness 0.14 because pale paint is pigment rather
    // than flake, roughness 0.34 because satin adds 0.16, and a
    // clearcoat at 0.42. A gloss change to the gloss finish barely
    // moves that row, and the row looks like the change did nothing.
    const bm2 = e.carBody.userData.bodyMat;
    const mat = {
      colour: "#" + bm2.color.getHexString(),
      metalness: +bm2.metalness.toFixed(3),
      roughness: +bm2.roughness.toFixed(3),
      ccRough: +bm2.clearcoatRoughness.toFixed(3),
      clearcoat: +bm2.clearcoat.toFixed(2),
      env: +bm2.envMapIntensity.toFixed(2),
    };
    return {
      mat,
      px: lum.length,
      dead: lum.length ? +((dead / lum.length) * 100).toFixed(1) : 0,
      body: +at(0.5).toFixed(1),
      spec: +spec.toFixed(1),
      tight: lum.length ? +((tight / lum.length) * 100).toFixed(1) : 0,
      grain: gN ? +(gSum / gN).toFixed(2) : 0,
      png: c.toDataURL("image/png").split(",")[1],
    };
  }, [m, set]);
  if (!set) writeFileSync(`press/paint/${where}.png`, Buffer.from(r.png, "base64"));
  const ratio = r.body > 0 ? (r.spec / r.body).toFixed(1) : "inf";
  console.log(
    `${where.padEnd(6)} ${set ? `r${set[0]} m${set[1]} cc${set[2]}` : "current".padEnd(18)}` +
      `  dead ${String(r.dead).padStart(5)}%   ` +
      `body ${String(r.body).padStart(5)}   spec ${String(r.spec).padStart(5)}   ` +
      `ratio ${String(ratio).padStart(6)}   highlight ${String(r.tight).padStart(5)}%   ` +
      `grain ${String(r.grain).padStart(5)}`
  );
  if (!set) {
    console.log(
      `       on ${r.mat.colour} rough ${r.mat.roughness} metal ${r.mat.metalness} ` +
        `clearcoat ${r.mat.clearcoat}/${r.mat.ccRough} env ${r.mat.env}` +
        `${r.mat.clearcoat < 0.9 ? "  <- NOT the gloss finish" : ""}`
    );
  }
 }
}
await browser.close();
console.log("\npress/paint/*.png");
