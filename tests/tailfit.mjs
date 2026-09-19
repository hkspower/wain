// The tail lamps are fitted to the panel, not stuck on it.
//
//   npm run dev
//   node tests/tailfit.mjs
//
// One car per silhouette, measured from behind. Two things a rear lamp
// has to get right, and both were wrong on part of the fleet:
//
//   pad      a consistent lip of paint between the lamp and the rear
//            corner — the same on the left and the right, and about the
//            same on every car. The fastback's band used to run clean
//            past both corners; the saloon's housing finished on the
//            skin with no margin at all.
//   proud    the lens stands off the rear skin at ITS OWN x by a few
//            millimetres — not buried in the corner's bevel, not floating
//            behind the plate — and by the same amount on both sides.
//            Every lamp used to hang at the profile's anchor, which the
//            extrusion bevels in behind by more at the corners than on
//            the centreline.
//
// Measured with rays against the painted shell, in world units, off the
// built car — the same way cars.ts now places them, so this checks the
// placement and not the arithmetic that made it. Writes a rear elevation
// per silhouette to press/tails/ so the numbers can be looked at.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

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

/** One catalogue car per silhouette. The SUV has no card, so it is the
 *  one shape not measured here. */
const CARS = [
  ["sedan", "deera-sedan"],
  ["zx", "zeta-300"],
  ["rx7", "efreet-rx"],
  ["gtr", "kaiju-r"],
  ["hatch", "sharq-hatch"],
  ["pony", "anniversary-30"],
  ["pickup", "jahra-pickup"],
  ["super", "storm-s8"],
];

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
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
await page.waitForTimeout(2000);
await page.evaluate(() => { window.__grnEngine.setPaused(true); window.__grnEngine.skipCinematic?.(); });

mkdirSync("press/tails", { recursive: true });
const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

console.log("style    pad L    pad R    proud L  proud R   lamps  shell      (m, world)");
for (const [style, carId] of CARS) {
  const r = await page.evaluate(async ([carId]) => {
    const THREE = window.__grnThree;
    const e = window.__grnEngine;
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
      car: carId, cars: [carId], owned: [], kd: 99999, equipped: { paint: "paint-white", glow: "glow-none" },
    }));
    e.applyGarage();
    const car = e.carBody;
    // Wait for the authored shell to land, not for a fixed delay: the
    // GLB swap is asynchronous, and a fixed 200 ms measured the first
    // car on its authored body and every other on the procedural one.
    for (let i = 0; i < 100 && !car.userData.shellSwap?.body; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 100));
    // Stand the car at the origin, unrotated, so world = scaled local.
    const prevParent = car.parent;
    const prevMatrix = car.matrix.clone();
    const stage = new THREE.Scene();
    stage.add(car);
    car.position.set(0, 0, 0);
    car.rotation.set(0, 0, 0);
    car.updateMatrixWorld(true);

    const box = (o) => new THREE.Box3().setFromObject(o);
    const shell = [];
    const lenses = [];
    car.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      // The SHELL slots — body, canopy, roof — and nothing else. Not
      // "everything painted": the fuel filler door is painted too, and
      // it is on the right rear quarter only — the first run of this
      // read a 29 mm asymmetry off it on the saloon and reported lamps
      // placed to the millimetre as crooked. And not the body alone: a
      // fastback's band and a mid-engined tail sit against the CANOPY,
      // which is glass.
      if (o.userData.shell) shell.push(o);
      if (m?.name === "taillamp-lens") lenses.push(o);
    });
    // The tail lenses, less the third brake light: it is the narrow one
    // on the centreline, high up.
    const tails = lenses
      .map((o) => ({ o, b: box(o) }))
      .filter(({ b }) => !(b.max.x - b.min.x < 0.6 && Math.abs((b.max.x + b.min.x) / 2) < 0.1));
    if (!tails.length) return { error: "no tail lenses found" };
    const outerL = tails.reduce((a, t) => (t.b.min.x < a.b.min.x ? t : a));
    const outerR = tails.reduce((a, t) => (t.b.max.x > a.b.max.x ? t : a));
    const ray = new THREE.Raycaster();
    const hit = (from, dir) => {
      ray.set(new THREE.Vector3(...from), new THREE.Vector3(...dir).normalize());
      const h = ray.intersectObjects(shell, false)[0];
      return h ? h.point : null;
    };
    const side = (t, sign) => {
      const c = t.b.getCenter(new THREE.Vector3());
      // The flank just inboard of the tail, at lamp height.
      const zIn = t.b.max.z + 0.12;
      const flank = hit([sign * 6, c.y, zIn], [-sign, 0, 0]);
      // The rear skin at the lamp's own x and height.
      const skin = hit([c.x, c.y, -8], [0, 0, 1]);
      const edge = sign > 0 ? t.b.max.x : t.b.min.x;
      return {
        pad: flank ? +(Math.abs(flank.x) - Math.abs(edge)).toFixed(3) : null,
        proud: skin ? +(skin.z - t.b.min.z).toFixed(3) : null,
      };
    };
    const out = {
      L: side(outerL, -1), R: side(outerR, 1), lamps: tails.length,
      // Which shell was measured. A symmetric result on the procedural
      // fallback says nothing about the authored file.
      shell: car.userData.shellSwap?.body ?? "(no verdict)",
    };

    // A rear elevation, for looking at.
    const W = 1000, H = 640;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
    const cam = new THREE.PerspectiveCamera(22, W / H, 0.1, 200);
    const bb = box(car);
    const size = bb.getSize(new THREE.Vector3());
    const centre = bb.getCenter(new THREE.Vector3());
    const R = Math.max(size.x, size.y, size.z) * 2.4;
    cam.position.copy(centre).add(new THREE.Vector3(0.02, 0.16, -1).normalize().multiplyScalar(R));
    cam.lookAt(centre);
    stage.background = new THREE.Color(0x1a1d22);
    stage.environment = e.scene.environment;
    stage.add(new THREE.AmbientLight(0xffffff, 1.6));
    const key = new THREE.DirectionalLight(0xfff4e2, 4.5);
    key.position.set(4, 6, -5);
    stage.add(key);
    const fill = new THREE.DirectionalLight(0xcfe0ff, 1.8);
    fill.position.set(-5, 3, -2);
    stage.add(fill);
    const prevExposure = e.renderer.toneMappingExposure;
    e.renderer.toneMappingExposure = 1.35;
    e.renderer.setRenderTarget(rt);
    e.renderer.setClearColor(0x1a1d22, 1);
    e.renderer.clear();
    e.renderer.render(stage, cam);
    e.renderer.toneMappingExposure = prevExposure;
    const buf = new Uint8Array(W * H * 4);
    e.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    e.renderer.setRenderTarget(null);
    stage.remove(car);
    if (prevParent) prevParent.add(car);
    car.matrix.copy(prevMatrix);
    car.matrix.decompose(car.position, car.quaternion, car.scale);
    car.updateMatrixWorld(true);
    rt.dispose();
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      img.data.set(buf.subarray(src, src + W * 4), y * W * 4);
    }
    ctx.putImageData(img, 0, 0);
    out.png = cv.toDataURL("image/png").split(",")[1];
    return out;
  }, [carId]);
  if (r.error) { fail.push(`${style}: ${r.error}`); console.log(`${style.padEnd(8)} ${r.error}`); continue; }
  writeFileSync(`press/tails/${style}.png`, Buffer.from(r.png, "base64"));
  const { L, R } = r;
  const f = (v) => (v === null ? "  none " : v.toFixed(3).padStart(7));
  const padOk = L.pad !== null && R.pad !== null && L.pad > 0.03 && L.pad < 0.2 && R.pad > 0.03 && R.pad < 0.2;
  const symOk = L.pad !== null && R.pad !== null && Math.abs(L.pad - R.pad) < 0.012;
  const proudOk =
    L.proud !== null && R.proud !== null &&
    L.proud > 0.004 && L.proud < 0.14 && R.proud > 0.004 && R.proud < 0.14 &&
    Math.abs(L.proud - R.proud) < 0.008;
  console.log(
    `${style.padEnd(8)} ${f(L.pad)}  ${f(R.pad)}  ${f(L.proud)}  ${f(R.proud)}   ${String(r.lamps).padStart(2)}   ${String(r.shell).padEnd(9)} ` +
      `pad ${check(padOk, `${style}: the lamp is ${L.pad}/${R.pad} m from the corner — no lip, or too much`)} ` +
      `even ${check(symOk, `${style}: the pad is ${L.pad} on the left and ${R.pad} on the right`)} ` +
      `proud ${check(proudOk, `${style}: the lens stands ${L.proud}/${R.proud} m off the skin`)}`
  );
}
console.log("wrote press/tails/<style>.png");
await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const m of fail) console.log(`  - ${m}`);
  process.exit(1);
}
