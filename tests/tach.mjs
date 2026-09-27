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
// One major per thousand and three minors between each of them (250,
// 500, 750), so the count is four per numbered mark less the three that
// fall past the last numeral. The minors are what the eye reads the
// needle's position against between the numbers, and a dial without
// them is a diagram of an instrument rather than one.
const minors = dial.ticks - dial.labels.length;
console.log(
  `ticks      ${check(dial.ticks > dial.labels.length * 3 && minors > 0,
    `${dial.ticks} ticks against ${dial.labels.length} numerals — where are the minor marks?`)}  ` +
    `${dial.labels.length} numbered marks and ${minors} minor ones between them`
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

// --- 2b. The lit sweep, the shift lights, the size ---------------------
//
// The sweep arc and the lamp strip are the same number as the needle,
// drawn twice more: the arc's dash offset must be 1 - frac, and the lamps
// must fill from 0.70 of the band to all nine exactly at the shift point
// (0.93, the engine's own tach.shift) — the strip and the ring round the
// dial may never disagree. And the cluster is the size the CSS says.
const lamps = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  const out = [];
  // The engine sets its own revs from road speed and gear every frame,
  // so the band is walked by speed, flat out, and every check is against
  // where the needle actually IS rather than where it was asked to be.
  for (const v of [6, 14, 22, 30, 38, 46, 54, 62, 70, 78]) {
    for (let i = 0; i < 12; i++) {
      e.player.speed = v;
      e.setTouchInput({ throttle: 1, brake: 0, steer: 0 });
      e.update(1 / 60);
    }
    const g = document.querySelector('[data-tach="needle"]');
    const m = /rotate\(([-\d.]+)deg\)/.exec(g?.style.transform ?? "");
    const drawn = m ? (+m[1] - 234) / 252 : NaN;
    const off = parseFloat(document.querySelector('[data-tach="sweep"]')?.style.strokeDashoffset ?? "NaN");
    const lit = document.querySelectorAll('[data-tach="leds"] .tach-led.on').length;
    const ring = document.querySelector('svg[data-tach="dial"] circle[r="47.4"]')?.style.opacity;
    out.push({ drawn, off, lit, shift: ring === "0.9" });
  }
  // Layout width, not the painted box: the HUD root is CSS-zoomed with
  // the window, and that is not this rule's business. The dial is the
  // cluster's --tach-dial (224 px, up from the fixed 200 it was), the box
  // 1.14 of it for the lamps and arcs outside the bezel.
  const cl = document.querySelector(".tach-cluster");
  const dial = parseFloat(getComputedStyle(cl).getPropertyValue("--tach-dial"));
  const size = document.querySelector('[data-tach="cluster"]').offsetWidth;
  const want = dial * 1.14;
  return { out, size, want };
});
const ledsFor = (f) => (f < 0.7 ? 0 : Math.min(9, 1 + Math.floor((f - 0.7) / ((0.93 - 0.7) / 8) + 1e-6)));
for (const l of lamps.out) {
  console.log(
    `lamps      ${check(Math.abs(1 - l.off - l.drawn) < 0.01,
      `the sweep arc is at ${(1 - l.off).toFixed(3)} where the needle is at ${l.drawn.toFixed(3)}`)} ` +
      `${check(l.lit === ledsFor(l.drawn), `${l.lit} lamps lit at ${l.drawn.toFixed(3)} of the band, want ${ledsFor(l.drawn)}`)} ` +
      `${check((l.lit === 9) === l.shift || Math.abs(l.drawn - 0.93) < 0.005,
        `${l.lit} lamps lit but the shift ring says ${l.shift ? "shift" : "not yet"}`)}  ` +
      `frac ${l.drawn.toFixed(3)}: sweep ${(1 - l.off).toFixed(3)}, ${l.lit}/9 lamps, ring ${l.shift ? "on" : "off"}`
  );
}
// The walk has to have reached the strip at all, or the checks above
// passed on nothing but unlit lamps.
const counts = new Set(lamps.out.map((l) => l.lit));
console.log(
  `coverage   ${check([...counts].some((n) => n > 0 && n < 9),
    `no sample landed inside the strip's band (lamp counts ${[...counts].join(", ")})`)}  ` +
    `lamp counts seen: ${[...counts].sort((a, b) => a - b).join(", ")}`
);
console.log(
  `size       ${check(Math.abs(lamps.size - lamps.want) <= 1,
    `the cluster is ${lamps.size.toFixed(1)} px, the CSS asks for ${lamps.want.toFixed(1)}`)} ` +
    `${check(lamps.want >= 200 * 1.14, `the dial is ${(lamps.want / 1.14).toFixed(0)} px, smaller than the 200 it grew from`)}  ` +
    `${lamps.size.toFixed(1)} px box (want ${lamps.want.toFixed(1)})`
);

// --- 3. The needle sweeps; it does not step -------------------------
//
// Before revs.ts, a key press at a standstill moved the drawn needle
// from 12% to 88% of the dial between two frames — about 190 degrees —
// and the release put it back in one. Read the DOM every frame through
// a blip: the most the needle may move in one 60 Hz frame is a critically
// damped spin-up's peak rate (SPIN_UP/e of the hold per second) across
// this car's hold, plus a margin for the gearbox creeping underneath.
const sweep = await page.evaluate(() => {
  const e = window.__grnEngine;
  const angle = () => {
    const g = document.querySelector('[data-tach="needle"]');
    const m = /rotate\(([-\d.]+)deg\)/.exec(g?.style.transform ?? "");
    return m ? +m[1] : NaN;
  };
  const drive = (n, input) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      e.player.speed = 0;
      e.setTouchInput(input);
      e.update(1 / 60);
      out.push(angle());
    }
    return out;
  };
  drive(40, { throttle: 0, brake: 1, steer: 0 });
  const trace = [
    ...drive(30, { throttle: 1, brake: 0, steer: 0 }),
    ...drive(40, { throttle: 0, brake: 1, steer: 0 }),
  ];
  let worst = 0;
  for (let i = 1; i < trace.length; i++) worst = Math.max(worst, Math.abs(trace[i] - trace[i - 1]));
  return {
    worst, first: trace.slice(0, 6).map((a) => +a.toFixed(1)),
    top: Math.max(...trace), low: Math.min(...trace),
    hold: e.tune.engine.peakAt - 0.12,
  };
});
const allowed = 252 * sweep.hold * (14 / Math.E) / 60 + 1.5;
console.log(
  `\nsweep      ${check(sweep.worst <= allowed && sweep.top - sweep.low > 60,
    `a throttle blip moved the drawn needle ${sweep.worst.toFixed(1)} deg in one frame (allowed ${allowed.toFixed(1)}), ` +
    `swinging ${(sweep.top - sweep.low).toFixed(0)} deg in all`)}  ` +
    `blip from rest: worst frame ${sweep.worst.toFixed(1)} deg of a ${(sweep.top - sweep.low).toFixed(0)}-deg swing ` +
    `(was ~${(252 * sweep.hold).toFixed(0)} in one); first frames ${sweep.first.join(" ")}`
);

// --- 4. Theme and units, through the settings screen ---------------
//
// Both are player settings, so they are driven the way a player drives
// them: pause, SETTINGS, the buttons, DONE. What is asserted is what
// lands on the dial.
//
// Theme: on a road engine the sweep takes the theme's lamp; on the race
// cluster (the Saqr's v8-40fp) it stays red under every theme, because
// that red face is information. Units: in mph the readout is the car's
// speed times 0.621371 and the label under it says so.
await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
const LAMPS = { sodium: "rgb(245, 165, 36)", ice: "rgb(92, 200, 255)", neon: "rgb(61, 255, 158)" };
const lampOf = () =>
  page.evaluate(() => getComputedStyle(document.querySelector('[data-tach="sweep"]')).stroke);
const fit = (id) =>
  page.evaluate((id) => {
    const e = window.__grnEngine;
    const spec = window.__grnEngines.find((s) => s.id === id);
    e.tune.engine = spec;
    for (let i = 0; i < 3; i++) e.update(1 / 60);
  }, id);
const roadId = await page.evaluate(() =>
  window.__grnEngines.find((s) => !s.redCluster)?.id ?? window.__grnEngine.tune.engine.id
);
for (const theme of Object.keys(LAMPS)) {
  await page.click(`[data-cluster-theme-option="${theme}"]`);
  await fit(roadId);
  const road = await lampOf();
  await fit("v8-40fp");
  const race = await lampOf();
  console.log(
    `theme      ${check(road === LAMPS[theme], `${theme}: the road dial's sweep is ${road}, want ${LAMPS[theme]}`)} ` +
      `${check(race === "rgb(255, 42, 24)", `${theme}: the race cluster's sweep is ${race}, it must stay red`)}  ` +
      `${theme.padEnd(6)} road ${road}  race ${race}`
  );
}
await page.click('[data-cluster-theme-option="sodium"]');
await fit(roadId);
// The unit takes effect on the click; the screen is left open rather
// than closed with DONE, which on the software rasteriser can sit in
// Playwright's scroll-into-view long enough to time out.
await page.click('[data-speed-unit-option="mph"]');
const mph = await page.evaluate(async () => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.player.speed = 30;
  e.update(1 / 60);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const dial = document.querySelector('[data-tach="cluster"]');
  const spans = [...dial.querySelectorAll("span")];
  return {
    shown: +spans.find((x) => /^\d+$/.test(x.textContent.trim()))?.textContent,
    label: spans.map((x) => x.textContent.trim()).find((t) => /^(mph|km\/h)$/i.test(t)),
    kmh: e.player.speed * 3.6,
  };
});
const wantMph = Math.round(mph.kmh * 0.621371);
console.log(
  `units      ${check(Math.abs(mph.shown - wantMph) <= 1 && mph.label === "mph",
    `in mph the dial reads ${mph.shown} "${mph.label}" at ${mph.kmh.toFixed(1)} km/h, want ${wantMph} mph`)}  ` +
    `${mph.kmh.toFixed(1)} km/h reads ${mph.shown} ${mph.label}`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} FAILED`);
  for (const f of fail) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nthe needle is the engine's");
