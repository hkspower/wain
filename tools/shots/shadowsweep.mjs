// How dark is a shadow allowed to be? A sweep, not an opinion.
//
//   npm run dev
//   node tools/shots/shadowsweep.mjs
//
// tools/shots/lightab.mjs settled ONE question — whether lifting the
// moon's shadow beats raising the ambient — and it answered it by
// comparing a single candidate against a full-strength shadow. That
// tool has two limits this one removes.
//
// FIRST: it only ever touched the moon. This game casts shadows from
// three things. The moon carries a fill; the player's own headlight,
// which throws a hard moving shadow off every car and rail it passes, is
// still a full hole at 1.0; and the painted contact blob under every car
// is a third shadow on the same asphalt that no light controls at all.
// Softening one of three and calling the picture fixed is how a frame
// ends up with some shadows that read and some that swallow.
//
// SECOND: one candidate is not a curve. A sweep says where the knee is:
// how much of the shadow band comes back per step, and — the number
// that actually decides it — at what point the BLACK END starts rising
// with it, which is when the fill has stopped rescuing the picture and
// started flattening it.
//
// EXPOSURE IS PINNED. Auto-exposure is a feedback loop that closes
// around this exact lever: lift the shadows, the meter sees a brighter
// frame and stops down, and the measurement comes back saying the
// change did nothing. What the loop gives back is real and it is worth
// knowing separately; it is not what this is measuring.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium; set CHROME_PATH"); process.exit(2); }
const b = await chromium.launch({ executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"], headless: true });
const page = await b.newPage({ viewport: { width: 960, height: 600 } });
page.setDefaultTimeout(240000);
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

// Read the state, do not set it: setQuality reinitialises the renderer
// and navigates the page out from under the tool.
const casting = await page.evaluate(() => {
  const e = window.__grnEngine;
  const car = e.carBody?.userData?.contact;
  return {
    moon: e.world.moonLight.castShadow,
    moonFill: e.world.moonLight.shadow.intensity,
    head: e.headlight?.castShadow ?? null,
    headFill: e.headlight?.shadow?.intensity ?? null,
    contact: car ? car.material.opacity : null,
  };
});
console.log(
  `as shipped: key casts=${casting.moon} fill=${casting.moonFill}  ` +
  `headlight casts=${casting.head} fill=${casting.headFill}  contact blob=${casting.contact}`
);
if (!casting.moon) { console.log("the key casts no shadow here — nothing to measure"); await b.close(); process.exit(2); }

// Three stops, not four. This box renders the game at about two frames
// a second and every stop costs 300 physics updates plus a screenshot,
// so the fourth viewpoint buys a third of a percentage point of
// precision for a quarter of the runtime. The three kept are the ones
// that differ in KIND: nothing overhead, something overhead, and a
// street with walls close on both sides.
const STOPS = [["open corniche", 400], ["under the flyover", 2100], ["city block", 3400]];
const pose = (z) => page.evaluate((s) => {
  const e = window.__grnEngine;
  e.setPaused(false);
  const away = e.track.wrap(s + e.track.length / 2);
  for (let i = 0; i < 300; i++) {
    e.player.s = s; e.player.lat = 0; e.player.speed = 22;
    for (const t of e.traffic) t.s = away;
    if (e.rival) e.rival.s = away;
    e.update(1 / 60);
  }
  for (const t of e.traffic) t.s = away;
  if (e.rival) e.rival.s = away;
  e.player.s = s;
  e.setPaused(true);
  e.setExposure(0, false);
}, z);

const stats = async () => {
  const shot = await page.screenshot({ type: "png" });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const hist = new Uint32Array(256); let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      hist[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++; n++;
    }
    const under = (t) => { let s = 0; for (let v = 0; v <= t; v++) s += hist[v]; return s / n; };
    let acc = 0, med = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) { med = v; break; } }
    return { p2: under(2), p8: under(8), p32: under(32), med };
  }, shot.toString("base64"));
};

// Each row names BOTH numbers it sets, rather than deriving the blob
// from the fill. A tool that computes what the engine is supposed to
// compute stops being able to disagree with it.
const RUNS = [
  ["no fill at all",   1.00, 0.50],
  ["as shipped",       0.62, 0.50],
  ["fill 0.45",        0.45, 0.38],
  ["fill 0.30",        0.30, 0.26],
];

// Warm up on the first stop and throw it away: the meter is still
// walking down from the menu, and a contaminated first row has faked a
// headline in this repo before.
await pose(STOPS[0][1]);
await page.waitForTimeout(4000);
await stats();

const out = [];
for (const [label, fill, blob] of RUNS) {
  await page.evaluate(([f, o]) => {
    const e = window.__grnEngine;
    e.world.moonLight.shadow.intensity = f;
    if (e.headlight) e.headlight.shadow.intensity = f;
    const c = e.carBody?.userData?.contact;
    if (c) c.material.opacity = o;
  }, [fill, blob]);
  const row = [];
  for (const [name, z] of STOPS) {
    await pose(z);
    await page.waitForTimeout(700);
    row.push([name, await stats()]);
  }
  out.push([label, row]);
}
await b.close();

const mean = (row, k) => row.reduce((a, [, s]) => a + s[k], 0) / row.length;
console.log("\nmeans over four viewpoints, exposure pinned");
console.log("setting            black end   <=8/255   shadow band   median");
for (const [label, row] of out) {
  console.log(
    `${label.padEnd(18)} ${(mean(row, "p2") * 100).toFixed(2).padStart(8)}% ` +
    `${(mean(row, "p8") * 100).toFixed(2).padStart(8)}% ` +
    `${(mean(row, "p32") * 100).toFixed(1).padStart(12)}% ` +
    `${mean(row, "med").toFixed(1).padStart(8)}`
  );
}
console.log("\nthe black end is the one that decides it: a fill that rescues the");
console.log("picture pulls the shadow band down and leaves the true blacks alone.");
