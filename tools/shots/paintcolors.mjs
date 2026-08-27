// What each paint in the booth actually looks like on a car.
//
//   npm run dev
//   node tools/shots/paintcolors.mjs
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
//   hue    the median body pixel's hue in degrees, and its saturation.
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

console.log(
  "\npaint".padEnd(17) + "metal".padStart(7) + "dead".padStart(8) + "body".padStart(7) +
  "spec".padStart(7) + "form".padStart(7) + "hue".padStart(6) + "sat".padStart(6)
);

const rows = [];
for (const only1 of ids) {
 const r1 = await page.evaluate(async ([shots, cars, id]) => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const out = [];

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
    window.__grnSaveGarage(g);
    e.refreshGarage();

    e.setPaused(true);
    e.applyQualityTier("high");
    e.timeHours = 2.5;
    e.world.setTimeOfDay(2.5);
    e.applyDaylight();
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

    // Hue of the median-luminance body pixel, so "is that yellow or
    // olive" stops being an argument.
    let hue = 0, sat = 0;
    if (px.length) {
      const target = at(0.5);
      let bestI = px[0], bestD = Infinity;
      for (const i of px) {
        const l = 0.2126 * beauty[i] + 0.7152 * beauty[i + 1] + 0.0722 * beauty[i + 2];
        const d = Math.abs(l - target);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      const r = beauty[bestI] / 255, g2 = beauty[bestI + 1] / 255, b = beauty[bestI + 2] / 255;
      const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b), d = mx - mn;
      sat = mx ? d / mx : 0;
      if (d > 1e-6) {
        if (mx === r) hue = 60 * (((g2 - b) / d) % 6);
        else if (mx === g2) hue = 60 * ((b - r) / d + 2);
        else hue = 60 * ((r - g2) / d + 4);
        if (hue < 0) hue += 360;
      }
    }

    for (let i = 0; i < 4; i++) e.composer.render();
    let png = null;
    if (shots) {
      ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
      png = c.toDataURL("image/jpeg", 0.8).split(",")[1];
    }
    out.push({
      id,
      metal: +paint.metalness.toFixed(2),
      px: lum.length,
      dead: lum.length ? +((lum.filter((v) => v <= 8).length / lum.length) * 100).toFixed(1) : 0,
      body: +at(0.5).toFixed(1),
      spec: +at(0.99).toFixed(1),
      form: +(at(0.9) - at(0.1)).toFixed(1),
      hue: Math.round(hue),
      sat: +sat.toFixed(2),
      png,
    });
  }
  return out;
 }, [SHOTS, CARS, only1]);
 for (const r of r1) {
  rows.push(r);
  if (r.err) { console.log(`${r.id.padEnd(16)} ${r.err}`); continue; }
  if (r.png) writeFileSync(`press/paint/${r.id}.jpg`, Buffer.from(r.png, "base64"));
  console.log(
    r.id.padEnd(16) + String(r.metal).padStart(7) + (r.dead + "%").padStart(8) +
    String(r.body).padStart(7) + String(r.spec).padStart(7) + String(r.form).padStart(7) +
    (r.hue + "°").padStart(6) + String(r.sat).padStart(6)
  );
 }
}

await browser.close();
writeFileSync("press/paint/colors.json", JSON.stringify(rows.map(({ png, ...r }) => r), null, 2));
console.log("\npress/paint/colors.json");
