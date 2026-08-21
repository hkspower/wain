// How big the cars actually are.
//
//   npm run dev
//   node tests/size.mjs
//
// The fleet measured 2.25 to 2.44 m wide. Real cars are 1.75 to 1.95,
// and the widest thing on a European road that is not a truck is 2.55 m
// including its mirrors. On a 3.5 m lane that put a saloon across 70% of
// its own lane, which is what "the cars are wide" looks like from the
// driver's seat.
//
// Sizing has now drifted twice, both times invisibly, because nothing
// asserted on it — the last pass left a comment claiming every car was
// "within ~5% on all three axes" while the fleet sat 11 to 14% over on
// width. So this measures the built shells against the real machines
// they evoke, which are the same numbers the silhouettes were authored
// from:
//
//   body     the painted bodyside, which is a car's real width
//   mirrors  over-mirror width, the number that decides whether you fit
//   ratio    length over body width. This is the one the eye reads. A
//            uniform scale cannot fix it — it is a property of the
//            authored profile — so it is the check most likely to catch
//            a fix that only looks like one.
//
// PRESENCE is not a fudge factor here. It is a deliberate 1.12 up-size
// applied to the whole fleet so a spec-sheet car does not read small
// from the chase camera, and the targets below include it.
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

/** The real machines each silhouette evokes: length, width, height, in
 *  metres, before the presence factor. */
const REAL = {
  sedan: { name: "a saloon", l: 4.7, w: 1.8, h: 1.47 },
  zx: { name: "a Z32 300ZX", l: 4.31, w: 1.8, h: 1.26 },
  gtr: { name: "an R34 Skyline", l: 4.6, w: 1.79, h: 1.36 },
  rx7: { name: "an FD RX-7", l: 4.3, w: 1.76, h: 1.23 },
  hatch: { name: "a hot hatch", l: 4.28, w: 1.79, h: 1.47 },
};
const PRESENCE = 1.12;

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 800, height: 460 } });
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
await page.waitForTimeout(3000);

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const cars = await page.evaluate(() => {
  const THREE = window.__grnThree;
  const out = [];
  const seen = new Set();
  for (const car of window.__grnCars) {
    const style = car.style ?? "sedan";
    if (seen.has(style)) continue;
    seen.add(style);
    const g = window.__grnBuildCar({ body: car.color, style, kit: car.kit === "attack" });
    g.updateMatrixWorld(true);
    const paint = g.userData.bodyMat;
    let bodyHalf = 0;
    let bodySpan = 0;
    let flareHalf = 0;
    let mirrorHalf = 0;
    let wheelHalf = 0;
    let lenMin = Infinity;
    let lenMax = -Infinity;
    let topY = 0;
    g.traverse((o) => {
      if (!o.isMesh) return;
      // The contact shadow is a transparent plane wider than the car and
      // is not part of it. Anything that does not cast a shadow is
      // decoration by this build's own convention.
      if (o.userData.noShadow) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && (m.transparent || (m.opacity ?? 1) < 1)) return;
      const bb = new THREE.Box3().setFromObject(o);
      const half = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x));
      lenMin = Math.min(lenMin, bb.min.z);
      lenMax = Math.max(lenMax, bb.max.z);
      topY = Math.max(topY, bb.max.y);
      // The bodyside is the LONGEST painted panel — the door skin, which
      // is what a car's width means. Anything painted that is wider but
      // shorter is a flare or a mirror, and both are reported on their
      // own: the gtr wears boxed arches over all four wheels, which are
      // that silhouette's whole calling card and 4% wider than its own
      // doors. Folding those into "body width" made the R34 look like a
      // sizing error instead of a design.
      const spansZ = bb.max.z - bb.min.z;
      if (m === paint) {
        if (spansZ < 0.6) mirrorHalf = Math.max(mirrorHalf, half);
        else if (spansZ > bodySpan) { bodySpan = spansZ; bodyHalf = half; }
        else flareHalf = Math.max(flareHalf, half);
      } else if (bb.min.y < 0.6 && /Torus|Cylinder/.test(o.geometry.type)) {
        wheelHalf = Math.max(wheelHalf, half);
      }
    });
    out.push({
      style,
      scale: +g.scale.x.toFixed(4),
      length: +(lenMax - lenMin).toFixed(3),
      body: +(bodyHalf * 2).toFixed(3),
      flares: +(Math.max(flareHalf, bodyHalf) * 2).toFixed(3),
      mirrors: +(Math.max(mirrorHalf, flareHalf, bodyHalf) * 2).toFixed(3),
      wheels: +(wheelHalf * 2).toFixed(3),
      height: +topY.toFixed(3),
    });
    g.traverse((o) => o.geometry && o.geometry.dispose?.());
  }
  return out;
});

console.log("silhouette   length   doors  metal  mirrors  height |  target  ratio  (real)");
for (const c of cars) {
  const real = REAL[c.style];
  if (!real) {
    check(false, `no real-world reference for the "${c.style}" silhouette`);
    continue;
  }
  // A car's quoted width is over its widest BODYWORK, not over its door
  // skin — which matters here because one silhouette is deliberately a
  // widebody. The gtr's boxed arches are its whole calling card and they
  // are what you would measure with a tape.
  const wantBody = real.w * PRESENCE;
  const wantRatio = real.l / real.w;
  const ratio = c.length / c.flares;
  const bodyErr = (c.flares / wantBody - 1) * 100;
  const ratioErr = (ratio / wantRatio - 1) * 100;
  console.log(
    `  ${c.style.padEnd(9)} ${String(c.length).padStart(6)} ${String(c.body).padStart(6)} ` +
      `${String(c.flares).padStart(6)} ${String(c.mirrors).padStart(8)} ${String(c.height).padStart(7)} |  ` +
      `${wantBody.toFixed(2)} ${bodyErr >= 0 ? "+" : ""}${bodyErr.toFixed(1)}%   ` +
      `${ratio.toFixed(2)} vs ${wantRatio.toFixed(2)} ${ratioErr >= 0 ? "+" : ""}${ratioErr.toFixed(1)}%  ${real.name}`
  );

  check(
    Math.abs(bodyErr) <= 6,
    `${c.style} is ${c.flares} m over its widest metal against ${wantBody.toFixed(2)} ` +
      `for ${real.name} (${bodyErr >= 0 ? "+" : ""}${bodyErr.toFixed(1)}%)`
  );
  // The proportion the eye reads, and the one a uniform scale cannot fix.
  check(
    Math.abs(ratioErr) <= 10,
    `${c.style} is ${ratio.toFixed(2)} long for its width against ${wantRatio.toFixed(2)} ` +
      `for ${real.name} — it reads ${ratioErr < 0 ? "squat and wide" : "stretched"}`
  );
  // A flare is allowed to be wider than the door it sits over, but only
  // by the amount an arch actually flares.
  check(
    c.flares - c.body <= 0.2,
    `${c.style} arches stand ${((c.flares - c.body) / 2).toFixed(3)} m proud of the doors per ` +
      `side — that is a body kit, not an arch`
  );
  // Mirrors stick out; they do not double the car.
  const stalk = c.mirrors - c.flares;
  check(
    stalk >= 0 && stalk <= 0.28,
    `${c.style} mirrors add ${stalk.toFixed(3)} m over the widest metal — a real pair adds about 0.2`
  );
  // And nothing on a road car is wider than a truck.
  check(
    c.mirrors <= 2.3,
    `${c.style} measures ${c.mirrors} m over its mirrors, which is wider than a delivery van`
  );
  // Tyres sit inside the arches, or close to it.
  check(
    c.wheels <= c.flares + 0.12,
    `${c.style} tyres stand ${((c.wheels - c.flares) / 2).toFixed(3)} m proud of the arches per side`
  );
}

console.log(
  `\nfleet     ${check(cars.length === 5, `${cars.length} silhouettes built, expected 5`)}  ` +
    `${cars.length} silhouettes, widest ${Math.max(...cars.map((c) => c.mirrors)).toFixed(2)} m over mirrors`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe cars are the size of cars.");
