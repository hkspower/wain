// The rev counter, both faces, drawn by the game.
//
//   npm run dev
//   node tools/shots/tach.mjs
//
// The Saqr 4.0 FP is the first engine in this game whose dial is not the
// same dial as everything else: it spins to 9,000 and it wears a race
// cluster, which means the whole scale is red rather than the last
// segment of it. Both of those are easy to claim and easy to get wrong
// in ways a screenshot of one dial will not show — a red arc that did
// not grow, numerals that stop at 8, a limiter flash that has nowhere
// left to flash against.
//
// So this shoots the SAME instrument twice, once per engine, by fitting
// the engine the way the garage does and letting the HUD relay itself.
// Nothing here draws a dial: it asks the running game for one, for the
// same reason tools/shots/crests.mjs asks it for the crests.
import { chromium } from "playwright-core";
import { statSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => { try { return statSync(p).isFile(); } catch { return false; } });
if (!exe) { console.error("no chromium"); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--force-color-profile=srgb"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("text=START ENGINE", { timeout: 120000 });
await page.click("text=START ENGINE");
// The debug handles are set inside emitHud(), which only runs from
// update(), which the frame loop gates on !paused — so this is waiting
// for the game to be actually playing, not merely loaded. Two attempts:
// booting a WebGL scene on this software rasteriser is minutes of CPU
// and the deadline is missed often enough that one try is not a test of
// anything.
let live = false;
for (let attempt = 0; attempt < 2 && !live; attempt++) {
  try {
    await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });
    live = true;
  } catch {
    if (attempt === 0) { console.log("engine not up in two minutes, one more try"); continue; }
    console.error("the game never started — nothing shot");
    await browser.close();
    process.exit(2);
  }
}
await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
await page.waitForFunction(
  () => document.querySelector('svg[data-tach="dial"]') &&
    document.querySelector('[data-tach="ticks"]')?.childNodes.length > 0,
  null, { timeout: 120000 }
);
await page.evaluate(() => document.fonts.ready);

mkdirSync("press/tach", { recursive: true });
const fail = [];
for (const id of ["i4-16", "v8-40fp"]) {
  const info = await page.evaluate(async (id) => {
    const e = window.__grnEngine;
    const spec = window.__grnEngines.find((s) => s.id === id);
    e.tune.engine = spec;
    e.setPaused(true);
    // Hold it near the top of the band so the needle is somewhere worth
    // photographing and the red is doing its job.
    e.revFrac = 0.96;
    for (let i = 0; i < 30; i++) { e.update(1 / 60); e.revFrac = 0.96; }
    e.composer.render();
    await new Promise((r) => setTimeout(r, 260));
    const ticks = document.querySelector('[data-tach="ticks"]');
    const nums = [...ticks.querySelectorAll("text")].map((t) => t.textContent);
    const scale = document.querySelector('svg[data-tach="dial"] path[stroke]');
    return {
      id, redline: spec.redlineRpm, redCluster: spec.redCluster === true,
      numerals: nums.join(" "),
      // The red arc's sweep, as the fraction of the scale it covers.
      redLen: (() => {
        const paths = [...document.querySelectorAll('svg[data-tach="dial"] path')];
        const red = paths.find((p) => (p.getAttribute("stroke") || "").match(/^#(e01b0f|b81208)$/i));
        return red ? +(red.getTotalLength() / (scale ? scale.getTotalLength() : 1)).toFixed(3) : null;
      })(),
    };
  }, id);
  const el = await page.$('svg[data-tach="dial"]');
  const box = await el.boundingBox();
  const shot = await page.screenshot({
    clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 },
  });
  writeFileSync(`press/tach/${id}.png`, shot);
  const want = Math.floor(info.redline / 1000);
  const topNum = Math.max(...info.numerals.split(" ").map(Number).filter(Number.isFinite));
  if (topNum !== want) fail.push(`${id}: dial tops out at ${topNum}, engine redlines at ${info.redline}`);
  if (info.redCluster && !(info.redLen > 0.9))
    fail.push(`${id}: race cluster, but the red arc covers ${info.redLen} of the scale`);
  if (!info.redCluster && info.redLen > 0.5)
    fail.push(`${id}: road cluster, but the red arc covers ${info.redLen} of the scale`);
  console.log(
    `${id.padEnd(9)} redline ${String(info.redline).padStart(5)}  ` +
      `${info.redCluster ? "race cluster" : "road cluster"}  ` +
      `red arc ${String(info.redLen).padStart(5)} of the scale  numerals ${info.numerals}`
  );
}
await browser.close();
if (fail.length) {
  console.error(`\n${fail.length} problem(s):\n`);
  for (const f of fail) console.error(`  ${f}`);
  process.exit(1);
}
console.log("\nboth dials are the engine's own. press/tach/*.png");
