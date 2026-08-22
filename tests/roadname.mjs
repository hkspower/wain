// The game is named after a road. It should say which one you are on.
//
//   npm run dev
//   node tests/roadname.mjs
//
// The HUD named the DISTRICT — Sharq, Shuwaikh Residential — and the
// road's own name lived in exactly one place in the whole world: a
// 1.05 m kilometre marker on the verge, Arabic-only, passed at fifty
// metres a second. A player could drive the entire lap of Gulf Road
// Nights without the game ever telling them the name of the road.
//
// A lap is two roads, and one stretch of the second one has a name
// nobody signed.

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
await page.waitForFunction(
  () => [...document.querySelectorAll("span,div")].some(
    (e) => e.textContent === "km/h" && e.checkVisibility({ opacityProperty: true })
  ),
  null,
  { timeout: 60000 }
);

// --- The plate says the road, at the places the road changes ----------
//
// Read off the DOM, at real positions on the lap, because a road name
// the engine knows and the HUD does not draw is a road name the player
// does not have.
const at = async (s) =>
  page.evaluate(async (s) => {
    const e = window.__grnEngine;
    e.setPaused(true);
    e.player.s = s;
    e.player.lat = 0;
    e.player.speed = 20;
    for (let i = 0; i < 4; i++) {
      e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
      e.update(1 / 60);
      e.player.s = s;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // The plate: the road line sits above the district line.
    const plate = document.querySelector(".grn-plate");
    const rows = [...(plate?.children ?? [])].map((c) => c.textContent.trim());
    return { rows, engine: { name: window.__grnDebug?.roadName } };
  }, s);

const STOPS = [
  ["the corniche", 900, "Arabian Gulf Street", "شارع الخليج"],
  ["Salmiya", 2400, "Arabian Gulf Street", "شارع الخليج"],
  ["the ring road", 4300, "Second Ring Road", "الدائري"],
  ["Love Street", 6600, "Love Street", "شارع الحب"],
  ["back on the ring", 7400, "Second Ring Road", "الدائري"],
];

console.log("where                at s   the plate reads");
for (const [label, s, wantEn, wantAr] of STOPS) {
  const r = await at(s);
  const road = r.rows[0] ?? "";
  console.log(`  ${label.padEnd(18)} ${String(s).padStart(5)}   ${JSON.stringify(road)}`);
  check(
    road.includes(wantEn) && road.includes(wantAr),
    `at ${s} m the plate reads ${JSON.stringify(road)}, not ${wantEn} / ${wantAr}`
  );
}
console.log(`\nnamed      ${fail.length === 0 ? "ok" : "FAIL"}  the road is on the plate everywhere on the lap`);

// The district is still there, and still below it — the road is the
// coarser fact and goes on top, the way a navigation display orders it.
const plate = await at(900);
console.log(
  `district   ${check(/Sharq|Bneid/.test(plate.rows[1] ?? ""),
    `the second line of the plate reads ${JSON.stringify(plate.rows[1])}`)}  ` +
    `the district is still under it: ${JSON.stringify(plate.rows[1])}`
);

// --- And the way-markers name it in both scripts ----------------------
//
// Every road sign in Kuwait is bilingual and these were Arabic-only, so
// they named the road for half the people who could read them.
const marks = await page.evaluate(() => {
  const e = window.__grnEngine;
  let root = e.world.moonLight;
  while (root.parent) root = root.parent;
  // The way-marker boards. Matched on the SIZE OF THE CANVAS, not on
  // the size of the plane: 1.05 x 1.3 m is a common enough board that
  // filtering on it counted a hundred and twenty of them on a lap that
  // has eight. The 256 x 320 texture is waymarkTexture's and nothing
  // else's.
  const found = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const img = o.material?.map?.image;
    if (!img?.toDataURL || img.width !== 256 || img.height !== 320) return;
    found.push(img.toDataURL());
  });
  return { count: found.length, sample: found[0] ?? null };
});
console.log(`\nmarkers    ${marks.count} kilometre boards on the lap`);
// Read the pixels: the English line sits in a band the Arabic one does
// not, so the presence of ink there IS the presence of the second
// language. Asserting on the source string would only prove the string
// was passed, not that it was drawn on a board 236 px wide.
const inked = await page.evaluate((url) => {
  if (!url) return null;
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = im.width; c.height = im.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(im, 0, 0);
      const band = (y0, y1) => {
        const d = ctx.getImageData(0, y0, im.width, y1 - y0).data;
        let light = 0;
        for (let i = 0; i < d.length; i += 4) {
          // White ink on the blue board.
          if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) light++;
        }
        return light;
      };
      res({
        arabicBand: band(36, 66),   // the Arabic name
        latinBand: band(68, 90),    // the English name under it
        numberBand: band(120, 220), // the big kilometre figure
        w: im.width, h: im.height,
      });
    };
    im.src = url;
  });
}, marks.sample);
console.log(
  `           ink: arabic ${inked?.arabicBand} px, english ${inked?.latinBand} px, ` +
    `number ${inked?.numberBand} px`
);
console.log(
  `bilingual  ${check(!!inked && inked.arabicBand > 100 && inked.latinBand > 100,
    `the board has ${inked?.arabicBand ?? 0} px of Arabic and ${inked?.latinBand ?? 0} px of English on it`)}  ` +
    `both scripts are actually painted on the board`
);
console.log(
  `count      ${check(marks.count > 6, `${marks.count} kilometre markers on an 8.5 km lap`)}  ` +
    `${marks.count} of them, one a kilometre down each road`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} FAILED`);
  for (const f of fail) console.log(`  ${f}`);
  process.exit(1);
}
console.log("\nthe game says which road you are on");
