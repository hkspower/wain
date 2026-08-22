// How big is the car in the shot?
//
//   npm run dev
//   node tools/shots/framing.mjs
//
// "The cars look too small" and "zoom in" are the same complaint from
// two directions, and neither of them is answerable by looking at a
// screenshot — how big a car reads depends on the lens, on where the
// camera sits, on the car's own length, and on the shape of the window,
// and those four pull against each other. So this measures it.
//
// The car's silhouette is found the way the shadow tool finds a shadow:
// render the frame, hide the car, render again, and the pixels that
// changed ARE the car. No bounding boxes — a box round a car includes
// the sky in its corners, and the number that matters is how much of
// the screen the car actually covers.
//
// Two numbers per view, because they answer different questions:
//
//   AREA    what fraction of the frame is car. This is "presence" —
//           how much of the screen your machine owns.
//   WIDTH   how much of the frame's WIDTH the car spans. This is what
//           people mean by "small": a car can hold its area while
//           shrinking across a wider window, and the eye reads width.
//
// The reference numbers are taken from the genre rather than invented.
// In a chase camera a driving game puts the player's car at roughly a
// quarter to a third of frame width; below about a fifth the car stops
// being the subject of the shot and becomes a detail in a landscape.
//
// Measured at three window shapes, because the aspect curve in
// aspect.ts deliberately changes the lens with the window, and a fix
// that works at 16:9 can undo itself on an ultrawide.

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
if (!exe) { console.error("no chromium"); process.exit(2); }

const WRITE = !process.argv.includes("--no-shots");

// 16:9 is the reference the game is framed at; the other two are the
// shapes that stress the aspect curve in both directions.
const SHAPES = [
  { name: "16:9", w: 960, h: 540 },
  { name: "21:9", w: 1120, h: 480 },
  { name: "4:3", w: 800, h: 600 },
];

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});

const rows = [];
const shots = {};

for (const shape of SHAPES) {
  const page = await browser.newPage({ viewport: { width: shape.w, height: shape.h } });
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
  await page.waitForTimeout(3000);

  const out = await page.evaluate(async ([wantShots]) => {
    const e = window.__grnEngine;
    e.setPaused(true);
    e.applyQualityTier("high");
    // Bloom smears the car's own lamps across the frame, and a
    // difference taken through it counts glow as bodywork.
    const bloomWas = e.bloomPass.enabled;
    e.bloomPass.enabled = false;

    const away = e.track.wrap(587 + e.track.length / 2);
    const hold = () => {
      // 90 frames, not 240. The position is pinned, so nothing here is
      // waiting for the car to arrive — only for the camera rig to settle
      // onto it, and that is quick. At 240 a single window shape took
      // over five minutes and the tool was slower than the question.
      for (let i = 0; i < 90; i++) {
        e.player.s = 587;
        e.player.lat = 0;
        e.player.speed = 22;
        for (const t of e.traffic) t.s = away;
        if (e.rival) e.rival.s = away;
        e.update(1 / 60);
      }
    };

    const grab = () => {
      e.exposurePass.dt = 0;
      for (let i = 0; i < 5; i++) e.composer.render();
      const gl = e.renderer.domElement;
      const c = document.createElement("canvas");
      c.width = gl.width; c.height = gl.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(gl, 0, 0);
      return { canvas: c, img: ctx.getImageData(0, 0, c.width, c.height), w: c.width, h: c.height };
    };

    const res = [];
    const pics = {};
    for (const view of ["chase", "close", "bonnet", "bumper", "cockpit"]) {
      e.setView?.(view);
      hold();
      // Let the eye settle by RENDERING — update() does not render, so
      // an exposure pinned during capture never adapts otherwise.
      e.exposurePass.dt = 1 / 30;
      for (let i = 0; i < 40; i++) { e.composer.render(); e.exposurePass.dt = 1 / 30; }

      const withCar = grab();
      const carWas = e.playerMesh.visible;
      e.playerMesh.visible = false;
      const without = grab();
      e.playerMesh.visible = carWas;

      // The difference IS the car.
      const a = withCar.img.data, b = without.img.data;
      let n = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
      const W = withCar.w, H = withCar.h;
      // Every second pixel in both axes. A car is tens of thousands of
      // pixels; a quarter of them is still tens of thousands, and every
      // number reported here is a ratio rather than a count.
      let sampled = 0;
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          sampled++;
          const i = (y * W + x) * 4;
          const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          // 12 of 765: above the dither and the grain, below any real
          // difference between bodywork and the road behind it.
          if (d <= 12) continue;
          n++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (wantShots && view === "chase") pics.chase = withCar.canvas.toDataURL("image/png");
      res.push({
        view,
        area: n / sampled,
        width: maxX < 0 ? 0 : (maxX - minX + 1) / W,
        height: maxY < 0 ? 0 : (maxY - minY + 1) / H,
        fovV: e.camera.fov,
        px: n,
      });
    }
    e.bloomPass.enabled = bloomWas;
    e.setPaused(false);
    return { res, pics };
  }, [WRITE]);

  for (const r of out.res) rows.push({ shape: shape.name, ...r });
  // Progress as it goes. The first version printed nothing until every
  // shape was done, which through a pipe looks identical to a hang —
  // and it was mistaken for one.
  console.error(`  measured ${shape.name}`);
  if (out.pics.chase) shots[`chase-${shape.name.replace(":", "x")}`] = out.pics.chase;
  await page.close();
}

if (WRITE && Object.keys(shots).length) {
  mkdirSync("press/framing", { recursive: true });
  for (const [k, v] of Object.entries(shots)) {
    writeFileSync(`press/framing/${k}.png`, Buffer.from(v.split(",")[1], "base64"));
  }
}

// The band a driving game keeps its own car in, in chase. Below the
// floor the car stops being the subject of the shot.
const CHASE_WIDTH = [0.24, 0.36];

console.log(
  "shape".padEnd(7) + "view".padEnd(9) + "fov".padStart(6) +
  "width".padStart(8) + "height".padStart(8) + "area".padStart(8)
);
const bad = [];
for (const r of rows) {
  const flag =
    r.view === "chase" && (r.width < CHASE_WIDTH[0] || r.width > CHASE_WIDTH[1]) ? " !" : "";
  if (flag) {
    bad.push(
      `${r.shape} chase: the car spans ${(r.width * 100).toFixed(0)}% of frame width ` +
      `(want ${CHASE_WIDTH[0] * 100}-${CHASE_WIDTH[1] * 100}%)`
    );
  }
  console.log(
    r.shape.padEnd(7) + r.view.padEnd(9) + r.fovV.toFixed(1).padStart(6) +
    `${(r.width * 100).toFixed(1)}%`.padStart(8) +
    `${(r.height * 100).toFixed(1)}%`.padStart(8) +
    `${(r.area * 100).toFixed(2)}%`.padStart(8) + flag
  );
}

console.log("");
if (bad.length) {
  for (const b of bad) console.log(" - " + b);
} else {
  console.log("the car is the subject of its own shot at every window shape");
}
await browser.close();
process.exit(bad.length ? 1 : 0);
