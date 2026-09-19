// What a shower of sparks actually does to the picture.
//
//   npm run dev
//   node tools/shots/sparks.mjs
//
// A spark is described in engine.ts as "the brightest thing in a night
// frame", and the numbers behind that claim — how much of the frame they
// cover, how close they come to clipping — were measured once by
// something nobody kept. Every other bright thing in this game has an
// instrument: paint.mjs for the clearcoat, glare.mjs for the headlamps,
// dark.mjs for the floor. This is the one for sparks.
//
// It renders one full-severity scrape twice from a fixed camera on a
// pinned exposure — once with the shower drawn, once with it hidden —
// and reports the difference in three parts:
//
//   shower   the sparks themselves: how many pixels they light, how
//            bright they get, how much of them is pinned at 255.
//   spill    what the sparks add to everything ELSE in the frame. A real
//            shower throws a flickering amber light onto the asphalt it
//            skitters across, the barrier it came off and the flank of
//            the car that made it. Additive sprites cannot: they paint
//            their own pixels and light nothing. This number is that
//            claim, measured — the pixels that brighten while NO spark
//            is drawn on them.
//   streak   how long a spark reads. A real one at these speeds is a
//            line; a round point sprite is a dot. Measured as the aspect
//            ratio of the lit pixels in each isolated spark blob.
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
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
  // Pinned, for the same reason paint.mjs pins it: the world boots at the
  // real hour in Kuwait and glides toward whatever hour is asked for, so
  // an unpinned first reading is taken in a half-lit sky.
  localStorage.setItem("gulf-road-nights-settings", JSON.stringify({ sky: "night" }));
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(3500);

const SEV = Number(process.env.SEV ?? 1);
const AGE = Number(process.env.AGE ?? 0.18); // seconds after the hit

const r = await page.evaluate(async ([SEV, AGE]) => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");
  e.timeHours = 2.5;
  e.world.setTimeOfDay(2.5);
  e.applyDaylight();
  e.setExposure(0, false);

  // Park on an open stretch, clear of the traffic and the rival, and let
  // the world settle before anything is measured.
  const m = 587;
  const park = () => {
    const away = e.track.wrap(m + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
    e.player.s = m; e.player.lat = 0; e.player.speed = 0;
  };
  park();
  for (let i = 0; i < 40; i++) { e.update(1 / 60); park(); }
  for (let i = 0; i < 4; i++) e.composer.render();

  const W = e.renderer.domElement.clientWidth;
  const H = e.renderer.domElement.clientHeight;
  const cvs = document.createElement("canvas");
  cvs.width = W; cvs.height = H;
  const ctx = cvs.getContext("2d");
  const grab = () => {
    ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
    return ctx.getImageData(0, 0, W, H).data;
  };
  const luma = (d) => {
    const out = new Float32Array(W * H);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      out[p] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    }
    return out;
  };

  // The frame with no shower in it: the same scrape, the same instant,
  // the sparks simply not drawn. Everything else — shake, the car's
  // attitude, the sound — is identical, so the difference between the
  // two frames is the sparks and nothing else.
  const shot = async (drawSparks) => {
    park();
    // Same seed for both passes, so the two showers are the same shower.
    let s = 12345;
    const rnd = Math.random;
    Math.random = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    e.spawnSparks(1, SEV);
    Math.random = rnd;
    e.sparkFx.update(AGE, { gravity: 17, drag: 0.7, bounce: 0.42, groundY: 0.03 });
    e.sparkFx.points.visible = drawSparks && e.sparkFx.alive > 0;
    for (let i = 0; i < 3; i++) e.composer.render();
    const px = grab();
    const alive = e.sparkFx.alive;
    // Clear the pool before the next pass.
    e.sparkFx.update(9, { gravity: 17, drag: 0.7, bounce: 0.42, groundY: 0.03 });
    return { px, alive };
  };

  const on = await shot(true);
  const off = await shot(false);
  const A = luma(on.px), B = luma(off.px);

  // A pixel "is spark" when the shower painted it: additive blending only
  // ever adds, so anything the sparks drew on is brighter in A than in B
  // by more than the renderer's own frame-to-frame noise.
  const NOISE = 2;
  let sparkPx = 0, sparkSum = 0, sparkPeak = 0, clipped = 0;
  let spillPx = 0, spillSum = 0, spillPeak = 0;
  const isSpark = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const d = A[p] - B[p];
    if (d <= NOISE) continue;
    // The sprite's own footprint versus light cast beyond it cannot be
    // told apart by brightness alone — but they can by where they are.
    // Everything additive is the sprite. There is no other channel by
    // which a spark could brighten a pixel, which is the finding.
    isSpark[p] = 1;
    sparkPx++; sparkSum += d;
    if (d > sparkPeak) sparkPeak = d;
    if (A[p] >= 254) clipped++;
  }
  // Spill: the frame outside the shower's footprint, dilated by 6 px so
  // a sprite's own soft edge cannot be counted as light it cast.
  const R = 6;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (isSpark[p]) continue;
      let near = false;
      for (let dy = -R; dy <= R && !near; dy += 2) {
        for (let dx = -R; dx <= R; dx += 2) {
          const q = (y + dy) * W + (x + dx);
          if (q >= 0 && q < W * H && isSpark[q]) { near = true; break; }
        }
      }
      if (near) continue;
      const d = A[p] - B[p];
      if (d > NOISE) { spillPx++; spillSum += d; if (d > spillPeak) spillPeak = d; }
    }
  }

  // Streak: flood the spark mask into blobs and report each blob's
  // aspect ratio. A round sprite is ~1.0 however fast the spark is
  // travelling; a motion-stretched one is not.
  const seen = new Uint8Array(W * H);
  const aspects = [];
  const stack = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!isSpark[p0] || seen[p0]) continue;
    let minX = W, maxX = 0, minY = H, maxY = 0, n = 0;
    stack.push(p0); seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % W, y = (p / W) | 0;
      n++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q >= 0 && q < W * H && isSpark[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (n >= 6) {
      const w = maxX - minX + 1, h = maxY - minY + 1;
      aspects.push(+(Math.max(w, h) / Math.min(w, h)).toFixed(2));
    }
  }
  aspects.sort((a, b) => a - b);

  // And what the scene carries in the way of light sources, so "nothing
  // lights the shower back" is a count rather than an impression.
  let lights = 0;
  const kinds = {};
  e.scene.traverse((o) => {
    if (o.isLight) { lights++; kinds[o.type] = (kinds[o.type] ?? 0) + 1; }
  });

  ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
  return {
    W, H, alive: on.alive,
    sparkPx, sparkPct: +((sparkPx / (W * H)) * 100).toFixed(3),
    sparkMean: sparkPx ? +(sparkSum / sparkPx).toFixed(1) : 0,
    sparkPeak: +sparkPeak.toFixed(1),
    clipped,
    spillPx, spillMean: spillPx ? +(spillSum / spillPx).toFixed(2) : 0,
    spillPeak: +spillPeak.toFixed(1),
    blobs: aspects.length,
    aspectMedian: aspects.length ? aspects[aspects.length >> 1] : 0,
    aspectMax: aspects.length ? aspects[aspects.length - 1] : 0,
    lights, kinds,
    png: cvs.toDataURL("image/png").split(",")[1],
  };
}, [SEV, AGE]);

mkdirSync("press/sparks", { recursive: true });
writeFileSync(`press/sparks/scrape.png`, Buffer.from(r.png, "base64"));

console.log(`frame      ${r.W}x${r.H}, ${r.alive} sparks alive ${AGE}s after a severity-${SEV} scrape\n`);
console.log(`shower     ${r.sparkPx} px (${r.sparkPct}% of the frame), mean +${r.sparkMean}, peak +${r.sparkPeak}, ${r.clipped} px pinned at 255`);
console.log(`spill      ${r.spillPx} px outside the shower brightened at all, mean +${r.spillMean}, peak +${r.spillPeak}`);
console.log(`           ^ this is the light the sparks cast on the world. 0 means they cast none.`);
console.log(`streak     ${r.blobs} separate sparks, median aspect ${r.aspectMedian}:1, longest ${r.aspectMax}:1`);
console.log(`           ^ 1.0 is a round dot. A spark at 5-17 m/s should read as a line.`);
console.log(`scene      ${r.lights} lights total: ${JSON.stringify(r.kinds)}`);
console.log(`\npress/sparks/scrape.png`);
await browser.close();
