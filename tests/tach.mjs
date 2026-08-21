// The rev counter reads the engine, not the speedometer.
//
//   npm run dev
//   node tests/tach.mjs
//
// The tach used to be a gradient bar whose length the HUD worked out
// for itself with `revFraction(speed)` — the pure gearbox function,
// which knows the ratios and nothing else. It has no clutch in it, so
// at a standing launch it read zero while the engine was pinned at its
// torque peak, and it showed the same sweep for a 1.6 that spins to
// 8,400 as for a 5.7 that stops at 6,200.
//
// Now it is a dial fed by the same needle the torque curve integrates,
// scaled to the car's own idle and redline. Three things have to hold:
// the numbers are the engine's, the needle is the engine's, and the two
// agree with each other.

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
if (!exe) { console.error("no chromium"); process.exit(2); }

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
// The HUD is held at opacity 0 behind the challenger's film; wait for
// the gauges rather than for a guessed delay.
await page.waitForFunction(
  () => [...document.querySelectorAll("span,div")].some(
    (e) => e.textContent === "km/h" && e.checkVisibility({ opacityProperty: true })
  ),
  null,
  { timeout: 60000 }
);

// --- 1. The dial is drawn, and it is the engine's dial -----------------
const dial = await page.evaluate(() => {
  const svg = document.querySelector('[data-tach="dial"]');
  const g = svg?.querySelector('[data-tach="ticks"]');
  const labels = [...(g?.querySelectorAll("text") ?? [])].map((t) => +t.textContent);
  const eng = window.__grnEngine.tune.engine;
  return {
    labels,
    idle: eng.idleRpm,
    redline: eng.redlineRpm,
    engineId: eng.id,
    ticks: g?.querySelectorAll("line").length ?? 0,
  };
});
console.log(
  `engine     ${dial.engineId}: ${dial.idle}-${dial.redline} rpm; dial reads ${dial.labels.join(" ")}`
);
console.log(
  `scale      ${check(
    dial.labels.length > 3 &&
      Math.max(...dial.labels) * 1000 <= dial.redline &&
      Math.max(...dial.labels) * 1000 > dial.redline - 1000,
    `the dial's top mark is ${Math.max(...dial.labels)}k against a ${dial.redline} rpm redline`
  )}  the numbers stop where this engine stops`
);
console.log(
  `ticks      ${check(dial.ticks === dial.labels.length,
    `${dial.ticks} ticks against ${dial.labels.length} labels`)}  one tick per thousand, ${dial.ticks} of them`
);

// --- 2. The needle is the engine's needle, not the gearbox's -----------
//
// The discriminating case is a standing launch: the gearbox function
// says zero because the car is not moving, and the engine says most of
// the way to the torque peak because the clutch is slipping. If those
// two ever agree at a standstill, the dial has gone back to reading the
// speedometer.
// Read off the DOM rather than off the engine. What is under test is
// what the PLAYER sees: the engine having the right number is no use if
// the dial is still drawing a different one.
const needle = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.player.speed = 0;
  const rpmText = () => {
    const t = document.querySelector('[data-tach="rpm"]')?.textContent ?? "";
    return parseFloat(t) * 1000;
  };
  const angle = () => {
    const g = document.querySelector('[data-tach="needle"]');
    const m = /rotate\(([-\d.]+)deg\)/.exec(g?.style.transform ?? "");
    return m ? +m[1] : null;
  };
  const drive = (n, input) => {
    for (let i = 0; i < n; i++) {
      e.setTouchInput(input);
      e.update(1 / 60);
      if (window.__vclock) window.__vclock.t += (1000 / 60);
    }
  };
  // Idling, stopped.
  drive(30, { throttle: 0, brake: 1, steer: 0 });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const idle = { rpm: rpmText(), angle: angle(), speed: e.player.speed };
  // Flat out from rest — five frames, so the car has barely moved.
  e.player.speed = 0;
  drive(6, { throttle: 1, brake: 0, steer: 0 });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const launched = { rpm: rpmText(), angle: angle(), speed: e.player.speed };
  // ...and at speed.
  drive(600, { throttle: 1, brake: 0, steer: 0 });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const fast = { rpm: rpmText(), angle: angle(), speed: e.player.speed };
  return { idle, launched, fast };
});
console.log(
  `\nneedle     idle ${needle.idle.rpm} rpm at ${needle.idle.angle} deg (${needle.idle.speed.toFixed(1)} m/s)`
);
console.log(
  `           launch ${needle.launched.rpm} rpm at ${needle.launched.angle} deg (${needle.launched.speed.toFixed(1)} m/s)`
);
console.log(
  `           at speed ${needle.fast.rpm} rpm at ${needle.fast.angle} deg (${needle.fast.speed.toFixed(1)} m/s)`
);
console.log(
  `clutch     ${check(
    needle.launched.rpm > needle.idle.rpm + 800 && needle.launched.speed < 4,
    `flooring it from rest took the needle from ${needle.idle.rpm} to ${needle.launched.rpm} rpm ` +
      `at ${needle.launched.speed.toFixed(1)} m/s`
  )}  flat out from rest: ${needle.idle.rpm} -> ${needle.launched.rpm} rpm with the car ` +
    `barely moving — the gearbox function would say idle`
);
console.log(
  `sweeps     ${check(
    needle.launched.angle > needle.idle.angle + 10,
    `the needle went from ${needle.idle.angle} to ${needle.launched.angle} degrees`
  )}  ${needle.idle.angle} -> ${needle.launched.angle} degrees of dial`
);
// And the needle agrees with the number beside it: angle should be the
// start plus the sweep times the rev fraction.
const agree = await page.evaluate(() => {
  const e = window.__grnEngine;
  const eng = e.tune.engine;
  const g = document.querySelector('[data-tach="needle"]');
  const m = /rotate\(([-\d.]+)deg\)/.exec(g?.style.transform ?? "");
  const angle = m ? +m[1] : null;
  const rpm = parseFloat(document.querySelector('[data-tach="rpm"]')?.textContent ?? "") * 1000;
  const frac = (rpm - eng.idleRpm) / (eng.redlineRpm - eng.idleRpm);
  return { angle, rpm, frac, want: 234 + 252 * Math.min(1, Math.max(0, frac)) };
});
console.log(
  `agrees     ${check(Math.abs(agree.angle - agree.want) < 3,
    `the needle is at ${agree.angle} deg where ${agree.rpm} rpm should put it at ${agree.want.toFixed(1)}`)}  ` +
    `${agree.rpm} rpm -> ${agree.angle} deg, arithmetic says ${agree.want.toFixed(1)}`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} FAILED`);
  for (const f of fail) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nthe needle is the engine's");
