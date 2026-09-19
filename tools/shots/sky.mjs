// The night sky, as delivered — two frames and the numbers behind them.
//
//   npm run dev
//   npm run shot:sky
//
// One spot on the open coast leg, at midnight. Two views: the chase
// camera as the player sees it, and the same camera pitched up until the
// frame is nearly all sky. Written to press/sky/.
//
// What it checks, because a starfield can be wrong in ways a screenshot
// flatters:
//
//   ladder    the stars are NOT all the same brightness. The old field
//             was 700 identical dots and every one of them clipped to
//             255; a real field is a few bright and many faint, so the
//             quartiles of the detected star pixels have to spread.
//   twinkle   stars move with time and ONLY with time. Two reads of the
//             same frame must agree to the level; two reads a third of a
//             second apart must not. The film grain is switched off for
//             this, because the grain's own frame-to-frame change reads
//             as twinkle — the first version of this measured a 94%
//             twinkle on a sky that had none.
//   strip     the chase camera's strip of sky still has stars in it.
//             Horizon extinction is real, but the player's sky is all
//             under 25°, and a haze that clears higher than that takes
//             every star a player can see.
//   galaxy    the Milky Way is a feature IN the sky, not a brighter sky:
//             the sky's median must not move, while its 95th percentile
//             must — that is the band.
//
// Stars are found as local maxima: a pixel brighter than all eight of its
// neighbours by a margin, in the sky part of the frame. Lit windows are
// maxima too, which is why the chase view only counts its top quarter.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
  // Pin the hour. The game ships on Kuwait time and would otherwise shoot
  // whatever sky the wall clock says.
  localStorage.setItem("gulf-road-nights-settings", JSON.stringify({ sky: "night" }));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.click("text=START ENGINE");
let up = false;
for (let i = 0; i < 600 && !up; i++) {
  up = await page.evaluate(() => !!window.__grnDebug);
  if (!up) await page.waitForTimeout(1000);
}
if (!up) { console.error("game never booted"); process.exit(2); }
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");
  const W = e.renderer.domElement.width, H = e.renderer.domElement.height;
  const read = () => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.drawImage(e.renderer.domElement, 0, 0);
    return { data: ctx.getImageData(0, 0, W, H).data, png: c.toDataURL("image/png") };
  };
  const stand = (s, lat) => {
    const away = e.track.wrap(s + e.track.length / 2);
    for (let i = 0; i < 160; i++) {
      e.player.s = s; e.player.lat = lat; e.player.speed = 20;
      for (const t of e.traffic) t.s = away;
      if (e.rival) e.rival.s = away;
      e.update(1 / 60);
    }
    e.exposurePass.dt = 1 / 30;
    for (let i = 0; i < 60; i++) { e.composer.render(); e.exposurePass.dt = 1 / 30; }
  };
  const render = () => { e.exposurePass.dt = 0; for (let i = 0; i < 3; i++) e.composer.render(); };
  const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const stars = (d, frac) => {
    const hits = [];
    const top = Math.floor(H * frac);
    for (let y = 1; y < top; y++) for (let x = 1; x < W - 1; x++) {
      const i = (y * W + x) * 4; const l = luma(d, i);
      if (l < 40) continue;
      let peak = true, ring = 0;
      for (let dy = -1; dy <= 1 && peak; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const j = ((y + dy) * W + x + dx) * 4; const m = luma(d, j);
        ring += m; if (m > l) { peak = false; break; }
      }
      if (peak && l - ring / 8 > 12) hits.push({ x, y, l: Math.round(l) });
    }
    return hits;
  };
  const skyStats = (d, fromY, toY) => {
    const v = [];
    for (let y = fromY; y < toY; y += 2) for (let x = 0; x < W; x += 2) v.push(luma(d, (y * W + x) * 4));
    v.sort((a, b) => a - b);
    const p = (q) => Math.round(v[Math.floor(v.length * q)]);
    return { p5: p(0.05), p50: p(0.5), p95: p(0.95) };
  };
  const quart = (hits) => {
    const ls = hits.map((h) => h.l).sort((a, b) => a - b);
    const q = (t) => ls[Math.min(ls.length - 1, Math.floor(ls.length * t))];
    return ls.length ? { min: ls[0], p25: q(0.25), p50: q(0.5), p75: q(0.75), max: ls[ls.length - 1] } : null;
  };

  // A boot cinematic pins the car and the camera; end it or the stand
  // below does nothing and the shot is wherever the film left off.
  e.skipCinematic?.();
  stand(4600, 0);
  const where = { s: Math.round(e.player.s), cine: !!e.cine };

  render();
  let r = read();
  const chaseHits = stars(r.data, 0.25);
  const chase = { png: r.png, sky: skyStats(r.data, 0, Math.floor(H * 0.35)), stars: chaseHits.length, luma: quart(chaseHits) };

  // Pitched up: keep the position, look 38° above the horizon. The sky
  // followers ride the camera's position, which has not moved, so a
  // direct composer render is enough.
  const cam = e.camera;
  const V = cam.position.constructor;
  const dir = new V();
  cam.getWorldDirection(dir);
  const yaw = Math.atan2(dir.x, dir.z);
  const pitch = 38 * Math.PI / 180;
  const tgt = cam.position.clone().add(new V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)));
  const shotUp = () => {
    cam.lookAt(tgt);
    cam.updateMatrixWorld();
    e.exposurePass.dt = 0; for (let i = 0; i < 3; i++) e.composer.render();
    return read();
  };
  r = shotUp();
  const upHits = stars(r.data, 0.9);
  const upShot = { png: r.png, sky: skyStats(r.data, 0, Math.floor(H * 0.9)), stars: upHits.length, luma: quart(upHits) };

  // Twinkle. Grain off — see the header.
  e.grainPass.enabled = false;
  const sample = () => { const d = shotUp().data; return upHits.slice(0, 400).map((h) => luma(d, (h.y * W + h.x) * 4)); };
  const a = sample();
  const a2 = sample();
  let still = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - a2[i]) <= 1) still++;
  for (let i = 0; i < 20; i++) e.update(1 / 60);
  const b = sample();
  let moved = 0, maxD = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > 6) moved++; maxD = Math.max(maxD, d); }
  const twinkle = { sampled: a.length, stillWhenNoTimePassed: still, movedWithTime: moved, maxDelta: Math.round(maxD) };
  e.grainPass.enabled = true;
  e.setPaused(false);
  return { where, chase, up: upShot, twinkle };
});

mkdirSync("press/sky", { recursive: true });
writeFileSync("press/sky/chase.png", Buffer.from(out.chase.png.split(",")[1], "base64"));
writeFileSync("press/sky/up.png", Buffer.from(out.up.png.split(",")[1], "base64"));

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const { where, chase, up: upv, twinkle } = out;
console.log(`where       s=${where.s} cine=${where.cine}`);
console.log(`chase       sky ${JSON.stringify(chase.sky)}  stars in the top quarter ${chase.stars}`);
console.log(`up          sky ${JSON.stringify(upv.sky)}  stars ${upv.stars}  luma ${JSON.stringify(upv.luma)}`);
console.log(`twinkle     ${JSON.stringify(twinkle)}`);
console.log(
  `ladder      ${check(upv.luma && upv.luma.p75 - upv.luma.p25 >= 20 && upv.luma.p50 <= 235, "the stars are all one brightness")}` +
  `  quartiles spread ${upv.luma ? upv.luma.p75 - upv.luma.p25 : "-"} levels, median ${upv.luma?.p50}`
);
console.log(
  `twinkle     ${check(twinkle.stillWhenNoTimePassed === twinkle.sampled, "stars change between two reads of the same frame")}` +
  ` still without time  ${check(twinkle.movedWithTime >= twinkle.sampled * 0.5, "stars do not twinkle")} move with it`
);
console.log(`strip       ${check(chase.stars >= 120, `only ${chase.stars} stars in the chase camera's sky`)}  ${chase.stars} in the strip`);
console.log(
  `galaxy      ${check(upv.sky.p50 >= 40 && upv.sky.p50 <= 56, `the sky's median moved to ${upv.sky.p50}`)}` +
  ` median held  ${check(upv.sky.p95 >= upv.sky.p50 + 12, "no band: the sky's 95th percentile sits on its median")} band present`
);
console.log(`stood       ${check(where.s === 4600 && !where.cine, "the car was not where the shot was set")}`);
console.log("wrote press/sky/chase.png, press/sky/up.png");
await browser.close();
if (fail.length) {
  console.log("\nFAILURES:");
  for (const f of fail) console.log(" - " + f);
  process.exit(1);
}
