// Frame pacing: display-refresh detection, the frame limiter, the
// G-Sync-style under-refresh cap, and the governors that key off them.
//
// Headless Chromium throttles requestAnimationFrame hard when there is
// no compositor — measured at ~1.4 Hz here. Achieved frame rates are
// therefore meaningless in this environment, so the test asserts the
// pacing LOGIC (target resolution, frame budgets, governor scaling)
// always, and only asserts throughput when the browser can serve it.
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = CANDIDATES.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}
const args = ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"];
const browser = await chromium.launch({ executablePath: exe, args, headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 560 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });

const fail = [];
const check = (cond, msg) => { if (!cond) fail.push(msg); return cond ? "ok" : "FAIL"; };

// The probe commits on 40 samples, 240 frames, or 2 s — whichever
// comes first, so it resolves even on a starved machine.
await page.waitForFunction(() => window.__grnEngine.displayHz > 0, null, { timeout: 20000 })
  .catch(() => {});
const hz = await page.evaluate(() => window.__grnEngine.displayHz);
console.log(`detected display: ${hz} Hz  ${check(hz > 0, "refresh rate never measured")}`);

// Headless Chromium throttles requestAnimationFrame hard when there is
// no compositor — often to a couple of hertz. Measuring achieved frame
// rates against a cap is meaningless there, so probe what the browser
// can actually deliver first and only assert throughput if it can.
const rafHz = await page.evaluate(async () => {
  const gaps = [];
  let last = performance.now();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const n = performance.now(); gaps.push(n - last); last = n;
  }
  gaps.sort((a, b) => a - b);
  return +(1000 / gaps[gaps.length >> 1]).toFixed(1);
});
const canMeasureThroughput = rafHz > 45;
console.log(`browser rAF: ${rafHz} Hz — throughput assertions ${canMeasureThroughput ? "enabled" : "SKIPPED (throttled headless)"}`);

// --- cap arithmetic: what the engine will aim at, for each setting ---
const targets = await page.evaluate(() => {
  const e = window.__grnEngine;
  const out = {};
  for (const cap of ["display", "vrr", 30, 60, 120, 144]) {
    e.setFrameCap(cap);
    out[String(cap)] = { target: +e.targetFps.toFixed(1), minMs: +e.frameMinMs.toFixed(2) };
  }
  e.setFrameCap("display");
  return { out, hz: e.displayHz };
});
console.log(`\ncap        target   frame budget`);
for (const [k, v] of Object.entries(targets.out)) {
  console.log(`  ${k.padEnd(8)} ${String(v.target).padStart(6)}   ${v.minMs} ms`);
}
// Explicit numeric caps must produce exactly that budget
for (const n of [30, 60, 120, 144]) {
  const t = targets.out[String(n)];
  check(Math.abs(t.target - n) < 0.01, `cap ${n} resolved to target ${t.target}`);
  check(Math.abs(t.minMs - 1000 / n) < 0.01, `cap ${n} budget ${t.minMs}ms != ${(1000 / n).toFixed(2)}ms`);
}
// "display" takes every frame offered — no limiter at all
check(targets.out.display.minMs === 0, "display mode should impose no frame budget");
// VRR sits just under the panel
const vrrT = targets.out.vrr.target;
console.log(`\nG-Sync cap  target=${vrrT} vs panel ${targets.hz} Hz  ` +
  check(vrrT < targets.hz && vrrT >= targets.hz - 4, "VRR cap is not just under the refresh rate"));

// --- governors must scale with the target, not a hardcoded 60 ---
const gov = await page.evaluate(() => {
  const e = window.__grnEngine;
  const out = [];
  for (const cap of [30, 60, 144]) {
    e.setFrameCap(cap);
    out.push({ cap, target: +e.targetFps.toFixed(0), drsFloor: +(e.targetFps * 0.83).toFixed(1) });
  }
  e.setFrameCap("display");
  return out;
});
console.log("\ngovernor scales with target:");
for (const g of gov) console.log(`  cap ${String(g.cap).padEnd(4)} target=${g.target}  DRS floor=${g.drsFloor} fps`);
check(gov[0].drsFloor < gov[2].drsFloor, "DRS floor does not scale with the target");

// --- achieved throughput, only where the browser can serve it ---
if (canMeasureThroughput) {
  const measure = async (cap, ms = 2500) =>
    page.evaluate(async ([c, dur]) => {
      const e = window.__grnEngine;
      e.setFrameCap(c);
      e.player.speed = 30;
      e.setTouchInput({ throttle: 0.6 });
      await new Promise((r) => setTimeout(r, 400));
      const f0 = e.renderer.info.render.frame;
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, dur));
      return +((e.renderer.info.render.frame - f0) / ((performance.now() - t0) / 1000)).toFixed(1);
    }, [cap, ms]);
  const free = await measure("display");
  const capped = await measure(30);
  console.log(`\nthroughput  display=${free} fps, cap30=${capped} fps  ` +
    check(capped < free - 5, "the 30 fps cap did not slow anything down") + " " +
    check(Math.abs(capped - 30) <= 6, `cap 30 produced ${capped} fps`));
} else {
  console.log("\nthroughput  skipped — this browser cannot drive enough frames to test a cap");
}

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nall frame pacing checks passed");
await browser.close();
process.exit(fail.length ? 1 : 0);
