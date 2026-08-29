// How much of the frame is crushed to black, in one number.
//
//   npm run dev
//   node tools/shots/blacks.mjs
//
// tools/shots/dark.mjs is the diagnosis: it tiles the frame, renders a
// lifted copy, and says of each dark tile whether the detail is there
// and being thrown away (CRUSHED), whether nothing is lit it (UNLIT), or
// whether nothing is there at all (EMPTY). It takes twenty minutes.
//
// This is the thermometer, not the diagnosis. One frame per viewpoint,
// no lifted copy, no tiling — just the shadow end of the histogram, so a
// change to the grade or the lighting can be measured in a minute
// instead of half an hour. It answers exactly one question: how much of
// the picture is sitting at or near zero, where no display and no eye
// can get anything back out of it.
//
// WHY THE FLOOR IS 2/255 AND NOT 0
//
// A pixel at 0 is black. A pixel at 1 or 2 is also black to every panel
// this will ever run on, and the difference between them is not
// something a player can see — so counting only exact zeros would report
// a picture as healthy while it is entirely made of 2s. The bands below
// are cumulative for the same reason: what matters is not the mode of
// the histogram but how much of the frame is below the point where
// detail stops existing.
//
// A NIGHT GAME IS SUPPOSED TO BE DARK. This prints numbers; it does not
// have an opinion about them. The sky at midnight belongs down there and
// so does the sea. Read it as a before-and-after against the same
// viewpoints, which is what it is for.

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium; set CHROME_PATH"); process.exit(2); }

const b = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await b.newPage({ viewport: { width: 960, height: 600 } });
page.setDefaultTimeout(180000);
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(4000);

// Fixed places along the road, so two runs compare the same picture.
// Chosen to include the parts of the night that are legitimately dark
// (the open corniche) and the parts that should not be (under the
// flyover, beside a lit building).
const STOPS = [
  ["open corniche", 400],
  ["under the flyover", 2100],
  ["city block", 3400],
  ["the roundabout", 5200],
];

console.log("        pixels at or below, as a share of the frame");
console.log("stop                      2/255    8/255   16/255   median");

const rows = [];
for (const [label, s] of STOPS) {
  // Posed the way dark.mjs poses a viewpoint, and for its reasons.
  //
  // There is no warpTo on the debug surface — an earlier version of this
  // called one and it would have measured the same opening frame four
  // times and printed four numbers that looked like four viewpoints.
  // Traffic and the rival go to the far side of the lap because they
  // carry headlights, and where they happen to be wandering is not
  // repeatable: dark.mjs records five dark tiles on one run and forty on
  // the next from that alone.
  await page.evaluate((z) => {
    const e = window.__grnEngine;
    e.setPaused(false);
    const away = e.track.wrap(z + e.track.length / 2);
    for (let i = 0; i < 300; i++) {
      e.player.s = z;
      e.player.lat = 0;
      e.player.speed = 22;
      for (const t of e.traffic) t.s = away;
      if (e.rival) e.rival.s = away;
      e.update(1 / 60);
    }
    for (const t of e.traffic) t.s = away;
    if (e.rival) e.rival.s = away;
    e.player.s = z;
    e.setPaused(true);
  }, s);
  await page.waitForTimeout(900);
  const shot = await page.screenshot({ type: "png" });
  const stats = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      // Rec.709 luma on the DISPLAYED pixels: this is about what reaches
      // the eye, not about scene-referred light.
      const y = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      hist[y]++; n++;
    }
    const under = (t) => { let s2 = 0; for (let v = 0; v <= t; v++) s2 += hist[v]; return s2 / n; };
    let acc = 0, med = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) { med = v; break; } }
    return { p2: under(2), p8: under(8), p16: under(16), med };
  }, shot.toString("base64"));
  rows.push([label, stats]);
  console.log(
    `${label.padEnd(22)} ${(stats.p2 * 100).toFixed(1).padStart(6)}% ` +
    `${(stats.p8 * 100).toFixed(1).padStart(7)}% ${(stats.p16 * 100).toFixed(1).padStart(7)}% ` +
    `${String(stats.med).padStart(8)}`
  );
}
const mean = (k) => rows.reduce((a, [, s]) => a + s[k], 0) / rows.length;
console.log(
  `\nacross ${rows.length} stops: ${(mean("p2") * 100).toFixed(1)}% of the picture is at or below 2/255, ` +
  `${(mean("p8") * 100).toFixed(1)}% at or below 8/255`
);
await b.close();
