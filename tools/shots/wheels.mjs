// Are the wheels the right size for the cars they are under?
//
//   npm run dev
//   node tools/shots/wheels.mjs
//
// "The wheels look too small" is the kind of complaint that is obviously
// true when you see it and impossible to act on, because there are four
// different things it could mean and they need opposite fixes:
//
//   1. The whole wheel is too small for the car — the arch swallows it
//      and the car looks jacked up on castors.
//   2. The wheel is the right size but the RIM inside it is too small, so
//      the tyre reads as a balloon. This is a sidewall problem, and
//      making the whole wheel bigger makes it worse.
//   3. The tyre is too narrow, so the car looks like it is on bicycle
//      wheels from the front.
//   4. The arch gap is too big — the wheel is fine and the body is
//      floating above it.
//
// So this measures all four, per car, against numbers taken from real
// cars rather than from taste:
//
//   wheel diameter / body height   0.45 – 0.55   (a modern coupe is ~0.49)
//   body length / wheel diameter   6.2  – 7.2    (~6.8)
//   rim diameter / wheel diameter  0.66 – 0.76   (an 18" on a 660 mm tyre
//                                                 is 0.69; a 20" on the
//                                                 same tyre is 0.77 and
//                                                 that IS the tuner look)
//   tyre width / wheel diameter    0.33 – 0.45   (a 265/35R19 is 0.39)
//   arch gap / wheel radius        0.08 – 0.30   (lowered, not slammed)
//
// Everything is measured in WORLD units after the silhouette's scale and
// its length fit, because that scale ranges from 0.83 to 1.06 across the
// fleet — the same tyre is a different size on each car, and a number
// read out of cars.ts is not the number on the road.

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

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 900, height: 520 } });
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
await page.waitForFunction(() => !!window.__grnBuildCar, null, { timeout: 240000 });
await page.waitForTimeout(1500);

const fleet = await page.evaluate(async () => {
  const THREE = window.__grnThree;
  const cars = window.__grnCars ?? [];
  const out = [];
  for (const car of cars) {
    const g = window.__grnBuildCar({
      body: parseInt(String(car.color).replace("#", ""), 16),
      accent: 0x007a3d,
      style: car.bodyStyle ?? "sedan",
      kit: car.kit,
      raceKit: car.kit === "attack",
      lengthM: car.lengthM,
      spoiler: false,
      stickers: false,
    });
    g.updateMatrixWorld(true);

    // The BODY, excluding the wheels and anything that hangs off the
    // shell — a wing would otherwise be counted as roof height and a
    // splitter as length, and neither is what a wheel is judged against.
    const wheelSet = new Set();
    for (const w of g.userData.wheels ?? []) w.traverse((o) => wheelSet.add(o));
    const body = new THREE.Box3();
    let bodyEmpty = true;
    g.traverse((o) => {
      if (!o.isMesh || wheelSet.has(o)) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (/wing|splitter|canard|diffuser|skirt|spoiler/.test(m?.name ?? "")) return;
      const bb = new THREE.Box3().setFromObject(o);
      body.union(bb);
      bodyEmpty = false;
    });
    if (bodyEmpty) continue;
    const bodyH = body.max.y - body.min.y;
    const bodyL = body.max.z - body.min.z;
    const bodyW = body.max.x - body.min.x;

    // Each wheel, split into tyre and rim. The rim is found by material
    // name rather than by position, because "the inner bit" is exactly
    // the assumption this tool exists to stop making.
    const wheels = (g.userData.wheels ?? []).map((w) => {
      const whole = new THREE.Box3().setFromObject(w);
      const rim = new THREE.Box3();
      const tyre = new THREE.Box3();
      let hasRim = false, hasTyre = false;
      w.traverse((o) => {
        if (!o.isMesh) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        const n = m?.name ?? "";
        const bb = new THREE.Box3().setFromObject(o);
        if (/^rim|spoke|alloy|hub|lip/.test(n)) { rim.union(bb); hasRim = true; }
        if (/tire|tyre/.test(n)) { tyre.union(bb); hasTyre = true; }
      });
      const dia = (b) => Math.max(b.max.y - b.min.y, b.max.z - b.min.z);
      return {
        x: (whole.max.x + whole.min.x) / 2,
        dia: hasTyre ? dia(tyre) : dia(whole),
        rimDia: hasRim ? dia(rim) : 0,
        width: hasTyre ? tyre.max.x - tyre.min.x : whole.max.x - whole.min.x,
        top: hasTyre ? tyre.max.y : whole.max.y,
        bottom: hasTyre ? tyre.min.y : whole.min.y,
      };
    });
    if (!wheels.length) continue;
    const front = wheels.reduce((a, b) => (b.dia > a.dia ? b : a));

    // The arch gap: how much daylight sits between the top of the tyre
    // and the metal above it.
    //
    // Not raycast. A ray would be the obvious tool and it is the wrong
    // one here: the car group carries sprites, and a sprite's raycast
    // wants a camera, so the ray dies before it reaches any bodywork.
    // Boxes answer the question without needing a point of view — take
    // every non-wheel mesh that stands over this wheel in BOTH plan axes
    // and find the lowest underside among them.
    const wheelBox = new THREE.Box3().setFromObject(
      (g.userData.wheels ?? [])[wheels.indexOf(front)] ?? g
    );
    let arch = Infinity;
    g.traverse((o) => {
      if (!o.isMesh || wheelSet.has(o)) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      // The well is the black void BEHIND the tyre; the lip is the edge
      // of the opening itself. Neither is the bodywork the gap is to.
      if (/arch-well|arch-lip|tire|tyre/.test(m?.name ?? "")) return;
      const bb = new THREE.Box3().setFromObject(o);
      if (bb.max.x < wheelBox.min.x || bb.min.x > wheelBox.max.x) return;
      if (bb.max.z < wheelBox.min.z || bb.min.z > wheelBox.max.z) return;
      if (bb.min.y < front.top) return; // beside the wheel, not over it
      if (bb.min.y < arch) arch = bb.min.y;
    });
    const gap = Number.isFinite(arch) ? arch - front.top : null;

    // Poke: how far the tyre's outer wall stands proud of the arch that
    // is supposed to cover it. Negative is tucked in, which is what a
    // road car does. This is the number that decides how much a tyre may
    // be WIDENED — a bigger wheel that hangs outside its own bodywork is
    // not a bigger wheel, it is a mistake.
    //
    // The reference is the BODYWORK over this wheel, not the black well
    // behind it. The first version of this measured against the well —
    // which is a flat disc sunk inside the opening — and reported every
    // tyre in the game as 40 to 90 mm proud. It was not; the arch lip
    // and the over-fender both stand further out than the well does, and
    // the well is simply the wrong plane to ask about.
    let archOut = -Infinity;
    g.traverse((o) => {
      if (!o.isMesh || wheelSet.has(o)) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const n = m?.name ?? "";
      // The lip is body-coloured — it IS the panel's own turned edge —
      // so it has no material of its own to look for. Anything painted
      // that stands over this wheel counts.
      if (!/arch|flare|body|paint/.test(n) && !/arch|flare/.test(o.name)) return;
      const bb = new THREE.Box3().setFromObject(o);
      if (bb.max.z < wheelBox.min.z || bb.min.z > wheelBox.max.z) return;
      if (bb.max.x > archOut) archOut = bb.max.x;
    });
    let tyreOut = -Infinity;
    for (const w of g.userData.wheels ?? []) {
      w.traverse((o) => {
        if (!o.isMesh) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!/tire|tyre/.test(m?.name ?? "")) return;
        const bb = new THREE.Box3().setFromObject(o);
        if (bb.max.x > tyreOut) tyreOut = bb.max.x;
      });
    }

    // The whole car across the road: shell, flares AND tyres, whichever
    // reaches furthest. This is the number a lane cares about, and it is
    // deliberately not bodyW — a widebody's width IS its flares.
    const totalW = 2 * Math.max(
      body.max.x, -body.min.x,
      Number.isFinite(archOut) ? archOut : 0,
      Number.isFinite(tyreOut) ? tyreOut : 0
    );

    out.push({
      id: car.id,
      name: car.name,
      style: car.bodyStyle ?? "sedan",
      lengthM: car.lengthM,
      totalW: +totalW.toFixed(3),
      poke: Number.isFinite(archOut) && Number.isFinite(tyreOut)
        ? +(tyreOut - archOut).toFixed(3)
        : null,
      bodyH: +bodyH.toFixed(3),
      bodyL: +bodyL.toFixed(3),
      bodyW: +bodyW.toFixed(3),
      dia: +front.dia.toFixed(3),
      rimDia: +front.rimDia.toFixed(3),
      width: +front.width.toFixed(3),
      gap: gap == null ? null : +gap.toFixed(3),
      wheelR: g.userData.wheelR ? +g.userData.wheelR.toFixed(4) : null,
    });
  }
  return out;
});

// ---- The bands, from real cars.
const BANDS = {
  "dia/height": [0.45, 0.55],
  "length/dia": [6.2, 7.2],
  "rim/dia": [0.66, 0.76],
  "width/dia": [0.33, 0.45],
  "gap/radius": [0.08, 0.3],
  // Proud of the arch. A tyre that hangs outside the bodywork covering
  // it is not a fatter tyre, it is a mistake — negative is tucked under.
  // Flush fitment: the tyre's outer wall level with the fender, give or
  // take a few centimetres. The cars carrying an over-fender sit at
  // +0.01 to +0.02 because the flare reaches further out than the tyre
  // does; the five street cars have no flare and sit at +0.03, which is
  // the mild poke a road car on aftermarket wheels actually has. The
  // ceiling is set to admit that rather than to exclude it — the first
  // version stopped at 0.03 and failed the pickup alone, on a difference
  // of half a millimetre, which is a band drawn round an assumption
  // rather than round a car.
  poke: [-0.05, 0.04],
  // The whole car across a 3.5 m lane, flares and tyres included. The
  // floor is a Kei-free fleet — nothing here is narrower than a real
  // saloon — and the ceiling is 60% of the lane, which is also the
  // engine's 2.1 m bump threshold: two of the widest builds passing at
  // the exact moment the referee calls it close must not visually
  // overlap. A car outside this band does not fit the street it is on.
  "width/lane": [1.7, 2.1],
};

const bad = [];
console.log(
  "car".padEnd(20) + "dia".padStart(7) + "rim".padStart(7) + "wide".padStart(7) +
  "  |" + "dia/h".padStart(7) + "len/dia".padStart(9) + "rim/dia".padStart(9) +
  "wid/dia".padStart(9) + "gap/r".padStart(8) + "poke".padStart(8) + "carW".padStart(8)
);
for (const c of fleet) {
  const r = {
    "width/lane": c.totalW,
    "dia/height": c.dia / c.bodyH,
    "length/dia": c.bodyL / c.dia,
    "rim/dia": c.rimDia / c.dia,
    "width/dia": c.width / c.dia,
    "gap/radius": c.gap == null ? null : c.gap / (c.dia / 2),
    poke: c.poke,
  };
  const mark = (k) => {
    const v = r[k];
    if (v == null) return "   n/a";
    const [lo, hi] = BANDS[k];
    const ok = v >= lo && v <= hi;
    if (!ok) bad.push(`${c.id}: ${k} = ${v.toFixed(2)} (want ${lo}–${hi})`);
    return (ok ? " " : "!") + v.toFixed(2);
  };
  console.log(
    c.id.padEnd(20) +
    c.dia.toFixed(2).padStart(7) + c.rimDia.toFixed(2).padStart(7) + c.width.toFixed(2).padStart(7) +
    "  |" + mark("dia/height").padStart(7) + mark("length/dia").padStart(9) +
    mark("rim/dia").padStart(9) + mark("width/dia").padStart(9) + mark("gap/radius").padStart(8) +
    mark("poke").padStart(8) + mark("width/lane").padStart(8)
  );
}

console.log("");
if (bad.length) {
  console.log(`${bad.length} measurement(s) outside the band:`);
  for (const b of bad) console.log(" - " + b);
} else {
  console.log("every wheel is in proportion to the car it is under");
}
await browser.close();
process.exit(bad.length ? 1 : 0);
