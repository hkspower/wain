// The painter's is somewhere a car can drive into, stop, and pay.
//
//   npm run dev
//   node tests/paintshop.mjs
//
// Built the way tests/fuel.mjs checks the forecourt, because it is the
// same kind of place: a roadside site the ribbon has to open for, that
// nothing else may have been built on, that reports itself on the HUD
// once the car is standing in it — and a sale that moves real money
// through the same garage save the shop uses.
//
//   site      the road opens at the bay, the building stands there, no
//             city block was placed on its apron
//   prompt    in the bay and stopped -> ready; in the bay but rolling,
//             or in the through lanes -> not
//   sale      P opens the picker, a tap buys and equips, the wallet
//             falls by exactly that colour's price
//   owned     tapping a colour you already own costs nothing
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

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
  // A wallet that can afford a colour: the picker greys out what you
  // cannot pay for, and a fresh save starts on 10 KD.
  localStorage.setItem(
    "gulf-road-nights-garage",
    JSON.stringify({ kd: 5000, cars: ["wain-special"], car: "wain-special", builds: {} })
  );
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });
await page.waitForTimeout(3000);

// --- 1. The site --------------------------------------------------------
const site = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const out = [];
  for (const sh of window.__grnPaintShops) {
    const openAt = e.track.halfWidthAt(sh.s);
    const openBefore = e.track.halfWidthAt(sh.s - 90);
    const p = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    e.track.pose(sh.s, sh.lat, p, tmp);
    let found = null;
    e.scene.traverse((o) => {
      if (o.name && o.name.startsWith("paint-shop")) {
        const d = Math.hypot(o.position.x - p.x, o.position.z - p.z);
        if (!found || d < found.d) found = { d, name: o.name };
      }
    });
    const nearestStation = Math.min(
      ...window.__grnStations.map((st) => Math.abs(e.track.deltaAhead(st.s, sh.s)))
    );
    out.push({
      s: sh.s,
      lat: sh.lat,
      openAt: +openAt.toFixed(1),
      openBefore: +openBefore.toFixed(1),
      placedWithin: found ? +found.d.toFixed(1) : null,
      nearestStation: Math.round(nearestStation),
    });
  }
  return out;
});
for (const f of site) {
  console.log(
    `site      at ${f.s} m, bay ${f.lat} m out: road opens ${f.openBefore} -> ${f.openAt} m, ` +
      `structure ${f.placedWithin} m away, nearest station ${f.nearestStation} m`
  );
  check(f.openAt > f.openBefore + 5, `the road does not open at the ${f.s} m paint shop`);
  check(f.openAt >= 14, `the bay at ${f.s} m only opens the road to ${f.openAt} m`);
  check(f.placedWithin !== null && f.placedWithin < 2, `no paint shop stands at ${f.s} m`);
  check(f.nearestStation > 54, `the paint shop at ${f.s} m overlaps a forecourt (${f.nearestStation} m)`);
}

// Nothing built on the apron — measured in road space, as fuel.mjs does.
const clash = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  let blocks = null;
  e.scene.traverse((o) => { if (o.name === "cityBlocks") blocks = o; });
  if (!blocks) return { checked: 0, hits: [] };
  const N = 3000;
  const L = e.track.length;
  const pts = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    e.track.pointAt((i / N) * L, p);
    pts.push([p.x, p.z]);
  }
  const side = new THREE.Vector3();
  const roadSpace = (x, z) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const d = (pts[i][0] - x) ** 2 + (pts[i][1] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const s = (best / N) * L;
    e.track.pointAt(s, p);
    e.track.sideAt(s, side);
    return { s, lat: (x - p.x) * side.x + (z - p.z) * side.z };
  };
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const hits = [];
  for (let i = 0; i < blocks.count; i++) {
    blocks.getMatrixAt(i, m);
    m.decompose(pos, q, scale);
    const rs = scale.z / 2;
    const rl = scale.x / 2;
    const rp = roadSpace(pos.x, pos.z);
    for (const sh of window.__grnPaintShops) {
      const ds = Math.abs(e.track.deltaAhead(sh.s, rp.s));
      if (ds < 16 + rs && Math.abs(rp.lat - sh.lat) < 11 + rl) {
        hits.push({ s: Math.round(rp.s), lat: Math.round(rp.lat), w: Math.round(scale.z), d: Math.round(scale.x) });
      }
    }
  }
  return { checked: blocks.count, hits };
});
console.log(
  `clear     ${check(clash.hits.length === 0, `${clash.hits.length} buildings stand in the bay: ${JSON.stringify(clash.hits)}`)}` +
    `  ${clash.checked} buildings placed, ${clash.hits.length} in the bay`
);

// --- 2. The prompt -------------------------------------------------------
const prompt = await page.evaluate(() => {
  const e = window.__grnEngine;
  const sh = window.__grnPaintShops[0];
  const away = e.track.wrap(sh.s + e.track.length / 2);
  const clearRoad = () => {
    for (const t of e.traffic) t.s = away;
    if (e.rival) e.rival.s = away;
  };
  const park = (lat, speedKmh) => {
    e.setPaused(true);
    e.player.s = sh.s;
    e.player.lat = lat;
    e.player.speed = speedKmh / 3.6;
    e.heading = 0;
    e.driftYaw = 0;
    clearRoad();
    e.setTouchInput({ throttle: 0, brake: 0, steer: 0 });
  };
  const run = (frames) => {
    for (let i = 0; i < frames; i++) {
      e.player.s = sh.s;
      clearRoad();
      e.update(1 / 60);
    }
  };
  park(2, 0);
  run(10);
  const lanes = e.painterState;
  park(12, 40);
  run(10);
  const rolling = e.painterState;
  park(12, 0);
  run(10);
  const stopped = e.painterState;
  return { lanes, rolling, stopped };
});
console.log(
  `prompt    through lanes ${JSON.stringify(prompt.lanes)}, rolling in the bay ${JSON.stringify(prompt.rolling)}, ` +
    `stopped in the bay ${JSON.stringify(prompt.stopped)}`
);
check(prompt.lanes === null, "the painter's bay reports itself from the through lanes");
check(prompt.rolling !== null && prompt.rolling.ready === false, "a car still rolling through the bay is offered the picker");
check(prompt.stopped !== null && prompt.stopped.ready === true, "a car stopped in the bay is not offered the picker");

// --- 3. The sale ---------------------------------------------------------
// The car is stopped in the bay from the step above, so the prompt is
// up. P opens the picker; the first paid, unowned colour is bought.
const kd = () => page.evaluate(() => JSON.parse(localStorage.getItem("gulf-road-nights-garage")).kd);
const equippedPaint = () =>
  page.evaluate(() => {
    const g = JSON.parse(localStorage.getItem("gulf-road-nights-garage"));
    return g.builds?.[g.car]?.equipped?.paint ?? null;
  });
// Wait for the pill itself, not a fixed delay: the key listener is
// re-registered with the new prompt state in an effect after React
// commits, and on a slow renderer a keypress a few hundred ms after
// the state change can still land on the old listener.
await page.waitForSelector("button:has-text('PAINT SHOP')", { timeout: 20000 });
await page.waitForTimeout(800);
await page.keyboard.press("p");
await page.waitForSelector("[data-paint]", { timeout: 20000 });
const chips = await page.$$("[data-paint]:not([disabled])");
console.log(`picker    open with ${chips.length} colours you can afford`);
check(chips.length > 20, `the picker offers only ${chips.length} colours`);

const before = await kd();
const wasPaint = await equippedPaint();
// Skip the factory chip (index 0): it is free and already the finish.
const chip = chips[1];
const id = await chip.getAttribute("data-paint");
const priceText = await chip.evaluate((el) => el.textContent.trim());
const price = parseInt(priceText, 10);
await chip.click();
await page.waitForTimeout(600);
const after = await kd();
const nowPaint = await equippedPaint();
console.log(`sale      ${id} for ${price} KD: ${before} -> ${after} KD, paint ${wasPaint} -> ${nowPaint}`);
check(Number.isFinite(price) && price > 0, `could not read a price off the ${id} chip ("${priceText}")`);
check(Math.abs(before - after - price) < 0.001, `the wallet fell by ${before - after} KD for a ${price} KD colour`);
check(nowPaint === id, `${id} was bought but ${nowPaint} is equipped`);

// --- 4. Owned is free ----------------------------------------------------
// Tapping it again runs stock in that slot (the garage's own rule), and
// a third tap puts it back — neither costs anything.
await chip.click();
await page.waitForTimeout(400);
const afterUnequip = await kd();
await chip.click();
await page.waitForTimeout(400);
const afterReequip = await kd();
const finalPaint = await equippedPaint();
console.log(`owned     ${after} -> ${afterUnequip} -> ${afterReequip} KD, paint ${finalPaint}`);
check(afterUnequip === after && afterReequip === after, "re-tapping an owned colour cost money");
check(finalPaint === id, `after unequip + re-equip, ${finalPaint} is equipped, not ${id}`);

await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const stillOpen = await page.$$("[data-paint]");
check(stillOpen.length === 0, "Escape did not close the picker");

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe painter's is a place you can drive into, stop, and pay.");
await browser.close();
process.exit(fail.length ? 1 : 0);
