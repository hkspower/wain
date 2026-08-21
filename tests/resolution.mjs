// Does the game render at the resolution it says it does?
//
//   npm run dev
//   node tests/resolution.mjs
//
// Resolution used to be one number with no setting attached — the
// renderer's pixel ratio, fixed at min(devicePixelRatio, 2) — so the
// render was always the size of the window and never a choice. A 1280x720
// window could not render 4K however much GPU was sitting idle, a 4K
// panel could not drop to 1080p to buy frames without also losing bloom
// and shadows through the quality tier, and there was nowhere on screen
// that said what any of it came out at.
//
// A resolution setting that cannot be checked is a resolution setting
// that can be wrong for a year, so this measures the drawing buffer
// rather than reading the setting back:
//
//   exact      4K is 2160 lines and Full HD is 1080, to the pixel, on
//              every window shape — not "about right"
//   aspect     the width follows the window, so 2160p on a 21:9 screen
//              is 5040x2160 rather than a stretched or cropped 3840
//   native     one buffer pixel per display pixel, which is what the
//              default has always meant and must keep meaning
//   live       changing it takes effect without a reload
//   held       and it survives a window resize, which is the case the
//              old three-places-assign-the-ratio arrangement got wrong
//   ceiling    never bigger than the GL stack will allocate, because
//              past that the picture goes black and says nothing
//   pinned     the frame-rate governor does not quietly walk it down
//   menu       the intro behind the settings screen agrees with the
//              race in front of it
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// A small window on purpose. Every rung of the ladder is exercised
// against every window shape through the arithmetic itself, which is the
// real code and costs nothing; the end-to-end pass then proves the
// wiring on one live renderer. Booting the city twenty-five times at 4K
// on a software rasteriser would measure the test box for an hour and
// tell us less.
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
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
await page.waitForTimeout(2500);

// --- The arithmetic, over every shape of window on every rung --------
const WINDOWS = [
  { name: "720p window", w: 1280, h: 720, dpr: 1 },
  { name: "1080p panel", w: 1920, h: 1080, dpr: 1 },
  { name: "4K panel", w: 3840, h: 2160, dpr: 1 },
  { name: "4K laptop", w: 1920, h: 1080, dpr: 2 },
  { name: "21:9 ultrawide", w: 2560, h: 1080, dpr: 1 },
  { name: "phone", w: 412, h: 915, dpr: 3 },
];
const LADDER = [2160, 1440, 1080, 720];

const grid = await page.evaluate(
  ([wins, ladder]) => {
    const { pixelRatioFor, bufferFor } = window.__grnRender;
    // A generous ceiling for the arithmetic pass: this is about the
    // ladder, not about one machine's limits, which get their own check.
    const MAX = 16384;
    const out = [];
    for (const w of wins) {
      for (const res of ["native", ...ladder]) {
        const r = pixelRatioFor(res, w.w, w.h, w.dpr, MAX);
        const [bw, bh] = bufferFor(r, w.w, w.h);
        out.push({ win: w.name, w: w.w, h: w.h, dpr: w.dpr, res, ratio: r, bw, bh });
      }
    }
    return out;
  },
  [WINDOWS, LADDER]
);

console.log("window            mode      buffer          ratio");
let exact = 0;
let aspect = 0;
let native = 0;
for (const g of grid) {
  const want =
    g.res === "native" ? Math.floor(g.h * Math.min(g.dpr, 2)) : g.res;
  if (g.bh !== want) {
    exact++;
    fail.push(
      `${g.win} at ${g.res}: ${g.bh} lines, not ${want} — ${g.res === "native" ? "native is not native" : `${g.res}p is not ${g.res}p`}`
    );
  }
  // The width has to follow the window, or the picture is stretched.
  const wantW = Math.floor((g.w / g.h) * g.bh);
  if (Math.abs(g.bw - wantW) > 1) {
    aspect++;
    fail.push(
      `${g.win} at ${g.res}: ${g.bw}x${g.bh} is not the ${(g.w / g.h).toFixed(2)}:1 shape of the window`
    );
  }
  if (g.res === "native" && Math.abs(g.ratio - Math.min(g.dpr, 2)) > 1e-6) native++;
  if (g.res === "native" || g.res === 2160 || g.res === 1080) {
    console.log(
      `  ${g.win.padEnd(16)} ${String(g.res).padEnd(9)} ${String(g.bw).padStart(5)}x${String(g.bh).padStart(4)}  ${g.ratio.toFixed(3).padStart(7)}`
    );
  }
}
console.log(
  `exact     ${check(exact === 0, `${exact} of ${grid.length} combinations land on the wrong line count`)}  ` +
    `${grid.length} combinations, every one on the line count it names`
);
console.log(
  `aspect    ${check(aspect === 0, `${aspect} combinations do not match their window's shape`)}  ` +
    `2160p on 21:9 is ${grid.find((g) => g.win === "21:9 ultrawide" && g.res === 2160).bw}x2160`
);
console.log(
  `native    ${check(native === 0, `${native} native cases are not one buffer pixel per display pixel`)}  ` +
    `one buffer pixel per display pixel, capped at 2x for high-density phones`
);

// --- The ceiling ------------------------------------------------------
const ceiling = await page.evaluate(() => {
  const { pixelRatioFor, bufferFor } = window.__grnRender;
  // A 32:9 superwide at 2160 lines wants 7680 across. On a stack that
  // stops at 4096 the composer's targets fail to allocate and the screen
  // goes black — a failure that reports itself as nothing at all.
  const r = pixelRatioFor(2160, 5120, 1440, 1, 4096);
  const [w, h] = bufferFor(r, 5120, 1440);
  const live = window.__grnEngine.renderInfo();
  return { w, h, max: live.maxBuffer, liveW: live.buffer[0], liveH: live.buffer[1] };
});
console.log(
  `ceiling   ${check(
    ceiling.w <= 4096 && ceiling.h <= 4096 && ceiling.w > 1000,
    `a 5120x1440 window asking for 2160 lines on a 4096 stack got ${ceiling.w}x${ceiling.h}`
  )}  clamped to ${ceiling.w}x${ceiling.h} on a 4096-max stack (this one allows ${ceiling.max})`
);

// --- End to end: the setting reaches the renderer, live ---------------
const live = [];
for (const res of ["native", 2160, 1440, 1080, 720, "native"]) {
  const info = await page.evaluate((r) => {
    window.__grnEngine.setResolution(r);
    return window.__grnEngine.renderInfo();
  }, res);
  live.push({ res, ...info });
}
console.log("\nlive on one renderer, 1024x640 window:");
for (const l of live) {
  console.log(
    `  ${String(l.res).padEnd(8)} ${String(l.buffer[0]).padStart(5)}x${String(l.buffer[1]).padStart(4)}  ratio ${l.ratio.toFixed(3)}  ${l.pinned ? "pinned" : "native"}`
  );
}
const wrong = live.filter((l) => (l.res === "native" ? l.buffer[1] !== 640 : l.buffer[1] !== l.res));
console.log(
  `live      ${check(
    wrong.length === 0,
    `changing the setting did not change the buffer: ${wrong
      .map((l) => `${l.res}→${l.buffer[1]}`)
      .join(", ")}`
  )}  six changes, no reload, every one landed`
);
// 4K out of a 1024x640 window is the whole point of the ladder: the
// window is not the ceiling any more.
const uhd = live.find((l) => l.res === 2160);
console.log(
  `above     ${check(
    uhd.buffer[1] === 2160 && uhd.buffer[0] >= 3456,
    `a 1024x640 window asked for 4K and got ${uhd.buffer[0]}x${uhd.buffer[1]}`
  )}  ${uhd.buffer[0]}x${uhd.buffer[1]} out of a 1024x640 window — 3.4x the window's own pixels`
);
// And back the other way: the last "native" must return to the window.
console.log(
  `back      ${check(
    live[live.length - 1].buffer[1] === 640 && !live[live.length - 1].pinned,
    `leaving the ladder left the picture at ${live[live.length - 1].buffer[1]} lines instead of the window's 640`
  )}  native is native again after the tour`
);

// --- A pin has to survive the window changing ------------------------
await page.evaluate(() => window.__grnEngine.setResolution(1080));
await page.waitForTimeout(400);
const before = await page.evaluate(() => window.__grnEngine.renderInfo());
await page.setViewportSize({ width: 1400, height: 900 });
await page.waitForTimeout(900);
const after = await page.evaluate(() => window.__grnEngine.renderInfo());
console.log(
  `held      ${check(
    after.buffer[1] === 1080 && after.buffer[0] !== before.buffer[0],
    after.buffer[1] !== 1080
      ? `the window changed and Full HD became ${after.buffer[0]}x${after.buffer[1]}`
      : "the window resize never reached the renderer, so this proves nothing"
  )}  ${before.buffer[0]}x${before.buffer[1]} → ${after.buffer[0]}x${after.buffer[1]} across a resize`
);

// --- The governor does not move a pin --------------------------------
const governed = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setResolution(1080);
  const before = e.renderInfo().buffer[1];
  // Tell the governor the machine is on its knees and let it act. On a
  // software rasteriser at 4K it does not need to be told, but this must
  // hold on a fast machine too.
  e.fpsEma = 4;
  e.startedAt = performance.now() - 60000;
  e.drsAt = 0;
  await new Promise((r) => setTimeout(r, 2500));
  return { before, after: e.renderInfo().buffer[1], scale: window.__grnDebug.renderScale };
});
console.log(
  `pinned    ${check(
    governed.after === 1080,
    `the frame-rate governor walked a pinned Full HD down to ${governed.after} lines`
  )}  ${governed.before} → ${governed.after} lines with the governor told the machine is dying`
);

// --- The menu agrees with the race -----------------------------------
await page.evaluate(() => {
  localStorage.setItem(
    "gulf-road-nights-settings",
    JSON.stringify({ ...JSON.parse(localStorage.getItem("gulf-road-nights-settings") ?? "{}"), resolution: 1080 })
  );
});
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.__grnAttract, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const menu = await page.evaluate(() => {
  const c = window.__grnAttract.scene ? document.querySelector("canvas.attract-canvas") : null;
  return c ? { w: c.width, h: c.height, css: [c.clientWidth, c.clientHeight] } : null;
});
console.log(
  `menu      ${check(
    menu && menu.h === 1080,
    menu
      ? `the settings screen says Full HD and the intro behind it is rendering ${menu.w}x${menu.h}`
      : "could not find the intro canvas"
  )}  the intro renders ${menu?.w}x${menu?.h} on a ${menu?.css[0]}x${menu?.css[1]} canvas`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail.slice(0, 12)) console.log(`  - ${f}`);
  if (fail.length > 12) console.log(`  … and ${fail.length - 12} more`);
  process.exit(1);
}
console.log("\n4K is 4K and Full HD is Full HD.");
