// A/B one lighting change, over the same four viewpoints, in one run.
//
//   npm run dev
//   node tools/shots/lightab.mjs 0.62
//
// blacks.mjs says how dark the picture is. This says whether a proposed
// change makes it better, which is a different question and needs both
// states measured against the same frames in the same session — two
// separate runs of a thermometer will differ by where the traffic
// happened to be and by whatever the exposure meter was doing.
//
// WHAT IT WAS BUILT TO SETTLE
//
// The thermometer found the picture is not clipped: 1.5% at or below
// 2/255, so the blacks are fine and it is the SHADOW RANGE that is
// compressed. Two levers open that band and they are not equivalent:
//
//   ambient            lifts every pixel, the midnight sky and sea
//                      included, which is how a night game stops being
//                      one.
//   shadow.intensity   lifts only surfaces the key light cannot reach.
//                      The sky is not shadow-mapped, so it cannot move.
//
// That difference is measurable, so it gets measured rather than
// argued. If the shadow band opens and the black end stays where it is,
// the lever is the right one.
//
// It checks the key is actually casting before it measures. On the
// battery preset it is not, and this would otherwise print two identical
// columns and call that "no effect".
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
const C=[process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH&&`${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium"].filter(Boolean);
const b = await chromium.launch({ executablePath: C.find((p)=>existsSync(p)),
  args:["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"], headless: true });
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
// Shadows must actually be on, or this measures nothing.
const casting = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setQuality?.("high");
  return { moon: e.world.moonLight.castShadow, head: e.headlight?.castShadow ?? null };
});
console.log(`shadows casting: key=${casting.moon} headlight=${casting.head}`);
if (!casting.moon) console.log("WARNING: the key casts no shadow — this A/B measures nothing");

const STOPS = [["open corniche",400],["under the flyover",2100],["city block",3400],["the roundabout",5200]];
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
      hist[Math.round(0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2])]++; n++;
    }
    const under = (t) => { let s = 0; for (let v = 0; v <= t; v++) s += hist[v]; return s / n; };
    let acc = 0, med = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n/2) { med = v; break; } }
    return { p2: under(2), p8: under(8), p16: under(16), p32: under(32), med };
  }, shot.toString("base64"));
};

const INTENSITY = Number(process.argv[2] ?? 0.62);
const runs = [];
for (const mode of ["as shipped", `shadow.intensity ${INTENSITY}`]) {
  await page.evaluate(([i, on]) => {
    window.__grnEngine.world.moonLight.shadow.intensity = on ? i : 1;
  }, [INTENSITY, mode !== "as shipped"]);
  const row = [];
  for (const [label, z] of STOPS) {
    await pose(z);
    await page.waitForTimeout(900);
    row.push([label, await stats()]);
  }
  runs.push([mode, row]);
}

for (const [mode, row] of runs) {
  console.log(`\n${mode}`);
  console.log("stop                      2/255    8/255   16/255   32/255   median");
  for (const [label, s] of row) {
    console.log(
      `${label.padEnd(22)} ${(s.p2*100).toFixed(1).padStart(6)}% ${(s.p8*100).toFixed(1).padStart(7)}% ` +
      `${(s.p16*100).toFixed(1).padStart(7)}% ${(s.p32*100).toFixed(1).padStart(7)}% ${String(s.med).padStart(8)}`
    );
  }
}
const mean = (row, k) => row.reduce((a, [, s]) => a + s[k], 0) / row.length;
const [, a] = runs[0], [, c2] = runs[1];
console.log(
  `\nCHANGE  black end (<=2/255) ${(mean(a,"p2")*100).toFixed(2)}% -> ${(mean(c2,"p2")*100).toFixed(2)}%` +
  `   shadow band (<=32/255) ${(mean(a,"p32")*100).toFixed(1)}% -> ${(mean(c2,"p32")*100).toFixed(1)}%` +
  `   median ${(mean(a,"med")).toFixed(1)} -> ${(mean(c2,"med")).toFixed(1)}`
);
await b.close();
