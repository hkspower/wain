// How big the cars actually are.
//
//   npm run dev
//   node tests/size.mjs
//
// Sizing drifted twice, both times invisibly, because nothing asserted
// on it — one pass left a comment claiming every car was "within ~5% on
// all three axes" while the fleet sat 11 to 14% over on width. And on
// top of whatever the profiles measured there was a flat 1.12 "presence"
// multiplier over the entire fleet, so every machine in the game was
// 12% longer than the one it evokes and the only way to find out how
// long a car was was to measure it.
//
// Length is DATA now. Every car in the showroom publishes a length in
// metres and the shell is scaled until it measures that, which makes the
// length exact by construction rather than exact until somebody edits a
// profile. What is left to check is that the fit really happened, and
// that everything the fit carries along with it — width, height, tyres,
// mirrors — landed somewhere a car lands:
//
//   fitted   the built shell measures the length on its own card
//   ratio    length over body width, which is the proportion the eye
//            reads and the one a uniform scale cannot fix: it is a
//            property of the authored profile
//   width    what that ratio implies, against the real machine
//   mirrors  over-mirror width, the number that decides whether you fit
//   spread   and the fleet covers the range it claims to, from a
//            supermini to a pickup
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

/** The real machines each silhouette evokes. Only the PROPORTION is used
 *  now — length over width — because each car carries its own length and
 *  the width follows it through a uniform scale. The heights are here to
 *  say where the proportions came from. */
const REAL = {
  sedan: { name: "a saloon", l: 4.7, w: 1.8, h: 1.47 },
  zx: { name: "a Z32 300ZX", l: 4.31, w: 1.8, h: 1.26 },
  gtr: { name: "an R34 Skyline", l: 4.6, w: 1.79, h: 1.36 },
  rx7: { name: "an FD RX-7", l: 4.3, w: 1.76, h: 1.23 },
  hatch: { name: "a hot hatch", l: 4.28, w: 1.79, h: 1.47 },
  // A fourth-generation American pony coupe: very long, very low, and
  // wide at the hips. The ratio is what matters here — 3.7 long for its
  // width, where nothing else in this table passes 2.6.
  pony: { name: "a 90s pony coupe", l: 4.9, w: 1.88, h: 1.32 },
};

// How many cars the showroom holds, read from the API rather than typed
// in here — see the spread check below.
let EXPECTED_CARS = 0;

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

EXPECTED_CARS = await page.evaluate(async () =>
  (await fetch("/api/grn/v1/cars").then((r) => r.json()).catch(() => null))?.cars?.length ?? 0
);

const cars = await page.evaluate(async () => {
  const THREE = window.__grnThree;
  const res = await fetch("/api/grn/v1/cars").then((r) => r.json()).catch(() => null);
  const list = res?.cars ?? res ?? [];
  const out = [];
  for (const car of list) {
    const style = car.bodyStyle ?? "sedan";
    const g = window.__grnBuildCar({
      body: parseInt(String(car.color).replace("#", ""), 16),
      style,
      // The kit itself, not a yes/no about the top one. This read
      // `car.kit === "attack"` — a boolean — which was harmless while
      // CarColors had no `kit` field and became a crash the moment it
      // did, because WIDE[false] is undefined.
      kit: car.kit,
      raceKit: car.kit === "attack",
      lengthM: car.lengthM,
    });
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
      id: car.id,
      name: car.name,
      style,
      want: car.lengthM,
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

console.log(
  "car                     card    built   doors  metal  mirrors  height |  ratio  (profile)"
);
let offFit = 0;
for (const c of cars) {
  const real = REAL[c.style];
  if (!real) {
    check(false, `no real-world reference for the "${c.style}" silhouette`);
    continue;
  }
  const wantRatio = real.l / real.w;
  const ratio = c.length / c.flares;
  const ratioErr = (ratio / wantRatio - 1) * 100;
  const fitErr = (c.length / c.want - 1) * 100;
  if (Math.abs(fitErr) > 1) offFit++;
  console.log(
    `  ${c.name.padEnd(20)} ${c.want.toFixed(2)}   ${String(c.length).padStart(6)} ` +
      `${String(c.body).padStart(6)} ${String(c.flares).padStart(6)} ` +
      `${String(c.mirrors).padStart(8)} ${String(c.height).padStart(7)} |  ` +
      `${ratio.toFixed(2)} vs ${wantRatio.toFixed(2)} ${ratioErr >= 0 ? "+" : ""}${ratioErr.toFixed(1)}%  ${real.name}`
  );

  // The one that matters most, and the one that is now exact by
  // construction rather than by a hand-tuned table.
  check(
    Math.abs(fitErr) <= 1,
    `${c.name} is built ${c.length} m long against the ${c.want} m on its own card ` +
      `(${fitErr >= 0 ? "+" : ""}${fitErr.toFixed(1)}%)`
  );
  // WIDTH, in metres, against the machine this silhouette evokes.
  //
  // This used to be a ratio — length over the widest metal, against the
  // real car's length over its width — and it could not decide anything.
  // The numerator is the card length, which another check already proves
  // exact, and the denominator is the WIDEBODY metal, so a car wearing
  // an attack arch was being compared against a stock machine and read
  // 5 to 9% "squat and wide" for having the flares it is supposed to
  // have. Every car in the fleet failed it in the same direction, by
  // roughly the size of its own arches, which is a check measuring
  // something other than its subject.
  //
  // Width is now fitted rather than inherited from the length scale, so
  // the claim can be the plain one: the door skin lands on the width of
  // the machine it evokes. Judged on the DOORS, because that is what a
  // car's width means and what the flare is bolted to — the arch gets
  // its own check below.
  //
  // It would have caught the thing it exists for: before the fit, the
  // Sharq Hatch measured 1.56 m across the doors against 1.79 for its
  // reference, 12.7% narrow, and the Wain Special 9.6%.
  const widthErr = (c.body / real.w - 1) * 100;
  check(
    Math.abs(widthErr) <= 6,
    `${c.name} is ${c.body} m across the doors against ${real.w} for ${real.name} ` +
      `(${widthErr >= 0 ? "+" : ""}${widthErr.toFixed(1)}%)`
  );
  // A flare is allowed to be wider than the door it sits over, but only
  // by the amount an arch actually flares.
  check(
    c.flares - c.body <= 0.2,
    `${c.name} arches stand ${((c.flares - c.body) / 2).toFixed(3)} m proud of the doors per ` +
      `side — that is a body kit, not an arch`
  );
  // Mirrors stick out; they do not double the car.
  const stalk = c.mirrors - c.flares;
  check(
    stalk >= 0 && stalk <= 0.28,
    `${c.name} mirrors add ${stalk.toFixed(3)} m over the widest metal — a real pair adds about 0.2`
  );
  // And nothing on a road car is wider than a truck.
  check(
    c.mirrors <= 2.3,
    `${c.name} measures ${c.mirrors} m over its mirrors, which is wider than a delivery van`
  );
  // Tyres sit inside the arches, or close to it.
  check(
    c.wheels <= c.flares + 0.12,
    `${c.name} tyres stand ${((c.wheels - c.flares) / 2).toFixed(3)} m proud of the arches per side`
  );
}

console.log(
  `\nfitted    ${check(offFit === 0, `${offFit} car(s) are not the length their card claims`)}  ` +
    `${cars.length} cars, every one built to the metre on its own card`
);

// Cars in the same class are the same width, near enough.
//
// The check above compares each car against its reference; this one
// compares them against EACH OTHER, which is the form the defect
// actually took. Width used to come out of the length scale, so a
// silhouette's widest and narrowest car differed by however much their
// cards differed: the saloons ran 1.63 m to 1.89 m, 16% apart, for
// bodies that in the real world are within a hand's breadth. It does not
// restate how the width is arrived at — only that a class holds
// together, which is true of every fleet on every road.
{
  const byStyle = new Map();
  for (const c of cars) {
    if (!byStyle.has(c.style)) byStyle.set(c.style, []);
    byStyle.get(c.style).push(c);
  }
  const rows = [];
  for (const [style, group] of byStyle) {
    const lo = group.reduce((a, b) => (a.body < b.body ? a : b));
    const hi = group.reduce((a, b) => (a.body > b.body ? a : b));
    const spread = (hi.body / lo.body - 1) * 100;
    rows.push(
      `  ${style.padEnd(7)} ${group.length} car(s)  ${lo.body} to ${hi.body} m across the doors  ` +
        `${spread.toFixed(1)}% apart  ` +
        check(
          spread <= 8,
          `the ${style} cars run ${lo.body} m (${lo.name}) to ${hi.body} m (${hi.name}) across ` +
            `the doors — ${spread.toFixed(1)}% apart for one class of car`
        )
    );
  }
  console.log("\nwidth by class");
  for (const r of rows) console.log(r);
}
const shortest = cars.reduce((a, b) => (a.length < b.length ? a : b));
const longest = cars.reduce((a, b) => (a.length > b.length ? a : b));
console.log(
  `spread    ${check(
    // Counted from the roster rather than from a literal. A hardcoded 15
    // fails the moment a car is added, which is a test complaining that
    // the game grew.
    cars.length === EXPECTED_CARS && longest.length - shortest.length > 1.2,
    cars.length !== EXPECTED_CARS
      ? `${cars.length} cars measured, expected ${EXPECTED_CARS}`
      : `the whole fleet is within ${(longest.length - shortest.length).toFixed(2)} m of itself — ` +
        `a supermini and a pickup should not be the same car`
  )}  ${shortest.name} ${shortest.length} m to ${longest.name} ${longest.length} m, ` +
    `widest ${Math.max(...cars.map((c) => c.mirrors)).toFixed(2)} m over mirrors`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nthe cars are the size of the cars on their cards.");
