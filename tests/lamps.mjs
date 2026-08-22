// The shape of a headlamp, on every car in the showroom.
//
//   npm run dev
//   node tests/lamps.mjs
//
// A headlamp used to be one emissive box at intensity 2.6. It clipped to
// flat white, bloomed, and arrived as a featureless glowing slab stuck
// to the nose — no bezel, no lens, no focal point. Four silhouettes,
// four different slabs, all identical once lit, which is a strange thing
// for the part of a car you see first.
//
// The rear lamps had been rebuilt as three-layer assemblies long before
// this and the front ones had not, so the two ends of every car were
// built to different standards. This checks the front now matches:
//
//   assembly  every car has a housing, a lens and a core up front
//   stacking  each piece sits FURTHER OUT than the one around it, or the
//             inner one is swallowed whole and invisible
//   nesting   and each is SMALLER, or it is not inside anything
//   burn      the lens is dimmer than the core. Exactly one part of a
//             lamp is allowed to blow out, and it is the small one.
//   fitted    nothing hangs in front of the bumper
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

// Build every car's shell and measure its lamps. Built directly through
// the same factory the game uses, rather than by driving fourteen garage
// purchases.
const cars = await page.evaluate(async () => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  const out = [];
  for (const car of window.__grnCars) {
    const group = window.__grnBuildCar({
      body: car.color,
      style: car.style ?? "sedan",
      kit: car.kit,
    });
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const parts = { "lamp-housing": [], "lamp-lens": [], "lamp-core": [] };
    group.traverse((o) => {
      if (!o.isMesh || !parts[o.name]) return;
      const b = new THREE.Box3().setFromObject(o);
      const size = new THREE.Vector3();
      const c = new THREE.Vector3();
      b.getSize(size);
      b.getCenter(c);
      // Front lamps only: the tail assemblies use their own names, but
      // a silhouette could hang something at the back with these.
      if (c.z < 0) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      parts[o.name].push({
        x: +c.x.toFixed(3),
        z: +b.max.z.toFixed(4),
        w: +size.x.toFixed(3),
        h: +size.y.toFixed(3),
        area: +(size.x * size.y).toFixed(4),
        emissive: +(mat?.emissiveIntensity ?? 0).toFixed(2),
      });
    });
    out.push({
      id: car.id,
      style: car.style ?? "sedan",
      noseZ: +box.max.z.toFixed(3),
      parts,
    });
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
    });
  }
  return out;
});

console.log(`car                  style    housing  lens  core   lens/core burn`);
let worstStack = null;
let worstNest = null;
for (const c of cars) {
  const H = c.parts["lamp-housing"];
  const L = c.parts["lamp-lens"];
  const K = c.parts["lamp-core"];
  const lensBurn = L.length ? Math.max(...L.map((p) => p.emissive)) : 0;
  const coreBurn = K.length ? Math.max(...K.map((p) => p.emissive)) : 0;
  console.log(
    `  ${c.id.padEnd(18)} ${c.style.padEnd(7)} ${String(H.length).padStart(6)} ` +
      `${String(L.length).padStart(5)} ${String(K.length).padStart(5)}   ` +
      `${lensBurn.toFixed(1)} / ${coreBurn.toFixed(1)}`
  );

  check(H.length > 0, `${c.id} has no headlamp housing — the lamp is stuck on the paint`);
  check(L.length > 0, `${c.id} has no headlamp lens`);
  check(K.length > 0, `${c.id} has no projector inside its headlamp`);
  check(
    lensBurn > 0 && coreBurn > lensBurn,
    `${c.id}: lens burns at ${lensBurn} and core at ${coreBurn} — the whole lamp blows out together`
  );

  // For each core, the nearest lens and the nearest housing have to be
  // behind it and bigger than it.
  for (const k of K) {
    const near = (list) =>
      list.length
        ? list.reduce((a, b) => (Math.abs(b.x - k.x) < Math.abs(a.x - k.x) ? b : a))
        : null;
    const lens = near(L);
    const house = near(H);
    if (lens) {
      const gap = k.z - lens.z;
      if (gap <= 0 && (worstStack === null || gap < worstStack.gap)) {
        worstStack = { car: c.id, gap: +gap.toFixed(4), what: "core behind its lens" };
      }
      if (k.area >= lens.area && (worstNest === null || k.area / lens.area > worstNest.ratio)) {
        worstNest = { car: c.id, ratio: +(k.area / lens.area).toFixed(2), what: "core bigger than its lens" };
      }
    }
    if (lens && house) {
      const gap = lens.z - house.z;
      if (gap <= 0 && (worstStack === null || gap < worstStack.gap)) {
        worstStack = { car: c.id, gap: +gap.toFixed(4), what: "lens behind its housing" };
      }
    }
  }
  // Nothing may hang out past the bodywork.
  const proud = [...H, ...L, ...K].filter((p) => p.z > c.noseZ + 0.005);
  check(
    proud.length === 0,
    `${c.id}: ${proud.length} lamp piece(s) stick out past the nose by up to ` +
      `${Math.max(0, ...proud.map((p) => p.z - c.noseZ)).toFixed(3)} m`
  );
}

console.log(
  `\nstacking  ${check(
    worstStack === null,
    worstStack
      ? `${worstStack.car}: ${worstStack.what}, by ${Math.abs(worstStack.gap)} m — it is inside the piece around it and invisible`
      : ""
  )}  every core stands proud of its lens, every lens proud of its housing`
);
console.log(
  `nesting   ${check(
    worstNest === null,
    worstNest ? `${worstNest.car}: ${worstNest.what} (${worstNest.ratio}x the area)` : ""
  )}  and every core is smaller than the lens around it`
);
console.log(
  `fleet     ${check(cars.length >= 14, `only ${cars.length} cars built`)}  ${cars.length} cars, ` +
    `${new Set(cars.map((c) => c.style)).size} silhouettes`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nevery car has headlamps with a shape.");
