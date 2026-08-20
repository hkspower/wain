// The nitrous gauge, measured off the live DOM.
//
//   npm run dev
//   node tests/nos.mjs
//
// A bar is the easiest HUD element in the world to write and the easiest
// to get subtly wrong, because it looks plausible at every level. The
// three things a player actually needs from it are:
//
//   how much is left        -> the fill has to TRACK the bottle, and the
//                              segment rule has to stay put while it does
//   is it firing right now  -> a state you can see without reading
//   can I fire at all       -> a partly-full bar that cannot fire has to
//                              look different from one that can
//
// So each is provoked on the real engine and read back out of the real
// element. Nothing here trusts that a class was applied.
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
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

// Read the gauge after driving the engine to a chosen bottle state.
// `hold` presses N with throttle on, which is the only way the engine
// will call the nitrous active.
const sample = (charge, hold) =>
  page.evaluate(
    ([charge, hold]) => {
      const e = window.__grnEngine;
      e.setPaused(true);
      e.tune.hasNos = true;              // the mod, without the shop trip
      e.nosCharge = charge;
      e.player.speed = 30;
      if (hold) {
        e.keys.add("n");
        e.setTouchInput({ throttle: 1 });
      } else {
        e.keys.delete("n");
        e.setTouchInput({ throttle: 0 });
      }
      e.update(1 / 60);

      const track = document.querySelector(".nos-meter");
      if (!track) return { missing: true };
      const fill = track.querySelector(".nos-fill");
      const wrap = track.parentElement;
      const pct = wrap.querySelector("span:last-child");
      const rule = getComputedStyle(track, "::after").backgroundImage;
      return {
        wrapDisplay: getComputedStyle(wrap).display,
        state: track.dataset.state,
        trackW: track.offsetWidth,
        // clientWidth, not offsetWidth: the track carries a 1px border on
        // each side and the fill is a percentage of the box INSIDE it, so
        // comparing against the outer width says a full bottle is 3px short.
        innerW: track.clientWidth,
        fillW: fill.offsetWidth,
        trackH: track.offsetHeight,
        readout: pct.textContent.trim(),
        fillBg: getComputedStyle(fill).backgroundImage,
        ruleSegments: (rule.match(/repeating-linear-gradient/g) || []).length,
        charge: e.nosCharge,
      };
    },
    [charge, hold]
  );

// --- 1. Full bottle ---
const full = await sample(1, false);
if (full.missing) {
  console.error("FAIL  no .nos-meter in the DOM");
  await browser.close();
  process.exit(1);
}
console.log(
  `full     ${check(full.wrapDisplay !== "none", "gauge hidden with the mod fitted")}  ` +
    `display=${full.wrapDisplay} state=${full.state} fill=${full.fillW}/${full.trackW}px ` +
    `h=${full.trackH}px readout=${full.readout}`
);
check(full.state === "charged", `full bottle read state="${full.state}", want "charged"`);
check(
  Math.abs(full.fillW - full.innerW) <= 2,
  `full bottle fills ${full.fillW}px of a ${full.innerW}px track`
);
check(full.readout === "100%", `full bottle reads "${full.readout}", want "100%"`);
// The gauge it replaced was 6px tall and identical to the boost bar next
// to it. Height is the one property that made them tell apart at speed.
check(full.trackH >= 9, `gauge is ${full.trackH}px tall — too thin to read at speed`);
check(full.ruleSegments >= 1, "segment rule missing from the track");

// --- 2. Part-full: the fill has to move, the rule must not ---
const half = await sample(0.5, false);
const quarter = await sample(0.25, false);
console.log(
  `drains   ${check(
    half.fillW < full.fillW - 30 && quarter.fillW < half.fillW - 15,
    `fill does not track the bottle: 100%=${full.fillW}px 50%=${half.fillW}px 25%=${quarter.fillW}px`
  )}  ` + `100%=${full.fillW}px 50%=${half.fillW}px 25%=${quarter.fillW}px`
);
check(
  Math.abs(half.fillW - full.innerW / 2) <= 3,
  `half a bottle draws ${half.fillW}px on a ${full.innerW}px track`
);
// A rule drawn on the FILL rescales as the fill shrinks, so twelve
// segments stay twelve segments at every level and the count is a lie.
// Drawn on the track it cannot: the track never changes width. Both
// halves have to be asserted — an absent rule passes "it didn't move".
const ruleOnTrack =
  full.ruleSegments >= 1 && !full.fillBg.includes("repeating-linear-gradient");
console.log(
  `rule     ${check(
    ruleOnTrack && half.trackW === full.trackW,
    full.ruleSegments < 1
      ? "no segment rule on the track"
      : "segment rule rides the fill — it rescales with the level"
  )}  fixed at ${full.trackW}px, ${full.ruleSegments} gradient on the track`
);
check(half.readout === "50%", `half bottle reads "${half.readout}", want "50%"`);

// --- 3. Firing ---
const firing = await sample(0.8, true);
console.log(
  `firing   ${check(firing.state === "firing", `held N and the gauge read "${firing.state}"`)}  ` +
    `state=${firing.state} charge ${firing.charge.toFixed(3)} (from 0.800)`
);
check(firing.charge < 0.8, "held N and the bottle did not drain");
check(
  firing.fillBg !== full.fillBg,
  "firing looks exactly like idle — the state has no colour behind it"
);

// --- 4. Empty: partly full, and still unusable ---
const empty = await sample(0.004, false);
console.log(
  `empty    ${check(empty.state === "spent", `dry bottle read state="${empty.state}"`)}  ` +
    `state=${empty.state} readout=${empty.readout}`
);
check(empty.readout === "EMPTY", `dry bottle reads "${empty.readout}", want "EMPTY"`);
check(
  empty.fillBg !== full.fillBg,
  "a bottle too empty to fire is painted the same as a full one"
);
// Three states, three looks — if any two collapse the gauge is back to
// being a plain bar with extra CSS.
check(
  new Set([full.fillBg, firing.fillBg, empty.fillBg]).size === 3,
  "charged / firing / spent do not all look different"
);

// --- 5. Without the mod the gauge is gone, not empty ---
const noMod = await page.evaluate(() => {
  const e = window.__grnEngine;
  e.tune.hasNos = false;
  e.update(1 / 60);
  const wrap = document.querySelector(".nos-meter").parentElement;
  return getComputedStyle(wrap).display;
});
console.log(`unfitted ${check(noMod === "none", `no NOS mod but the gauge shows (${noMod})`)}  display=${noMod}`);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nNOS gauge ok.");
