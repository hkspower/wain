// Side, rear and front elevations of one car, for looking at.
//
//   npm run dev
//   node tools/shots/car-views.mjs kaiju-r
//
// The 3/4 press shot in cars.mjs is a nice picture and a poor drawing: it
// foreshortens the whole flank and hides the tail completely, which is
// where most of a car's detail actually lives. Anything judged only from
// that angle gets judged on a third of the car.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const want = process.argv.slice(2);
const cars = await fetch("http://localhost:3000/api/grn/v1/cars")
  .then((r) => r.json())
  .catch(() => { console.error("start the dev server: npm run dev"); process.exit(2); });
const list = want.length ? cars.cars.filter((c) => want.includes(c.id)) : cars.cars;
if (!list.length) { console.error("no such car:", want.join(",")); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.setDefaultTimeout(180000);
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(3000);
await page.evaluate(() => { window.__grnEngine.setPaused(true); });
await page.evaluate((p) => { window.__grnViewParts = p; }, process.env.PARTS ?? "");

mkdirSync("press/views", { recursive: true });

const VIEWS = {
  side: [1, 0.16, 0],
  rear: [0.18, 0.22, -1],
  front: [0.18, 0.22, 1],
  top: [0.05, 1, 0.02],
  // Close in on the driver's window. The interior is the one part of a
  // car that no exterior elevation shows, and it is where the rig lives.
  cabin: [1, 0.34, 0.55, 0.42],
  // The rear quarter and the door, close enough to read a decal on.
  quarter: [1, 0.12, -0.5, 0.36],
  door: [1, 0.1, 0.16, 0.36],
  // Square on the front wheel: an alloy is a mirror, and how much of it
  // you can actually see is not a question a 3/4 press shot answers.
  wheel: [1, 0.06, 0.5, 0.22],
};

for (const c of list) {
  for (const [name, dir] of Object.entries(VIEWS)) {
    const b64 = await page.evaluate(
      async ([carId, dir, name]) => {
        const THREE = window.__grnThree;
        const e = window.__grnEngine;
        // PARTS=stickers,spoiler fits those before the render, so the
        // decals and aero can be looked at rather than assumed.
        const parts = (window.__grnViewParts || "").split(",").filter(Boolean);
        localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
          car: carId, cars: [carId], owned: parts, kd: 99999,
          equipped: { paint: "paint-white", glow: "glow-none" },
        }));
        e.applyGarage();
        await new Promise((r) => setTimeout(r, 200));
        const car = e.carBody;
        const W = 1000, H = 640;
        const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
        const cam = new THREE.PerspectiveCamera(26, W / H, 0.1, 200);
        const prevParent = car.parent;
        const prevMatrix = car.matrix.clone();
        const stage = new THREE.Scene();
        stage.background = new THREE.Color(0x1a1d22);
        stage.add(car);
        car.position.set(0, 0, 0);
        car.rotation.set(0, 0, 0);
        car.updateMatrixWorld(true);
        // After the car is on the stage, not before: measured while it is
        // still parented to the player it reports its position out on the
        // track, and the camera ends up aimed at empty road.
        const bb = new THREE.Box3().setFromObject(car);
        const size = bb.getSize(new THREE.Vector3());
        const centre = bb.getCenter(new THREE.Vector3());
        // A fourth number, when present, is how close to pull in — 1 is
        // the full-car framing, smaller crops to a detail.
        const R = Math.max(size.x, size.y, size.z) * 2.2 * (dir[3] ?? 1);
        const v = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize().multiplyScalar(R);
        const aim = centre.clone();
        if (dir[3]) aim.y += size.y * 0.22; // look at the glasshouse, not the sills
        if (name === "wheel") {
          // At the front wheel itself. Framed off the body's centre it
          // pointed at the door mirror, which is not the subject.
          const fw = (car.userData.wheels ?? []).reduce(
            (a, b) => (!a || b.position.z > a.position.z ? b : a),
            null
          );
          if (fw) aim.set(0, fw.position.y * car.scale.y, fw.position.z * car.scale.z);
        }
        cam.position.copy(aim).add(v);
        cam.lookAt(aim);
        // Enough light to read a shape by: a strong key, a weaker fill
        // opposite it, and a rim behind so the silhouette separates.
        // The environment matters more than any of them — these are
        // metals and clearcoat, and without an env map they render as
        // near-black whatever the lamps are doing.
        stage.environment = e.scene.environment;
        stage.add(new THREE.AmbientLight(0xffffff, 1.6));
        const key = new THREE.DirectionalLight(0xfff4e2, 4.5);
        key.position.set(4, 6, 5);
        stage.add(key);
        const fill = new THREE.DirectionalLight(0xcfe0ff, 1.8);
        fill.position.set(-5, 3, -2);
        stage.add(fill);
        const rim = new THREE.DirectionalLight(0xffffff, 2.6);
        rim.position.set(-2, 2, -6);
        stage.add(rim);
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
        // readRenderTargetPixels is bottom-up; flip into a canvas
        const cv = document.createElement("canvas");
        cv.width = W; cv.height = H;
        const ctx = cv.getContext("2d");
        const img = ctx.createImageData(W, H);
        for (let y = 0; y < H; y++) {
          const src = (H - 1 - y) * W * 4;
          img.data.set(buf.subarray(src, src + W * 4), y * W * 4);
        }
        ctx.putImageData(img, 0, 0);
        return cv.toDataURL("image/png").split(",")[1];
      },
      [c.id, dir, name]
    );
    const out = `press/views/${c.id}-${name}.png`;
    writeFileSync(out, Buffer.from(b64, "base64"));
    console.log(`  ${c.name.padEnd(20)} ${name.padEnd(6)} ${out}`);
  }
}
await browser.close();
