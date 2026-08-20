// Look straight down at the street grid.
//
//   npm run dev
//   node tools/shots/grid.mjs           # from 220 m up
//   node tools/shots/grid.mjs 60 0.30   # 60 m up, at this point on the lap
//
// It renders at night regardless of the hour it is told — see the note
// in the body. The markings read either way, which is what it is for.
//
// Every other shot in this project is taken from the road, which is the
// one place the grid cannot be seen: from a car you get a metre of a
// cross street as it goes by. Markings that break at junctions either
// form a grid from above or they do not, and that is not a question the
// chase camera can answer.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const height = Number(process.argv[2] ?? 220);
const u = Number(process.argv[3] ?? 0.08);

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
page.setDefaultTimeout(180000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "networkidle" });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 180000 });
await page.waitForTimeout(3500);

mkdirSync("press/grid", { recursive: true });
const b64 = await page.evaluate(async ([height, u]) => {
  const THREE = window.__grnThree;
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");
  // KNOWN LIMITATION: this shot comes out at night whatever hour is
  // asked for. The same three calls in the same order give capture.mjs a
  // correct noon, and setting them before the settle, after it, and on
  // every frame of it all still render midnight here. The cause is not
  // established, so this is a note rather than a fix. It does not affect
  // what the shot is for — the markings are legible either way — but do
  // not read a lighting conclusion off this file.
  e.timeHours = 12.5;
  e.world.setTimeOfDay(12.5);
  e.applyDaylight();
  e.player.s = e.track.length * u;
  e.player.lat = 0;
  e.player.speed = 0;
  for (const t of e.traffic) t.s = e.track.wrap(e.player.s + e.track.length / 2);
  if (e.rival) e.rival.s = e.track.wrap(e.player.s + e.track.length / 2);
  for (let i = 0; i < 40; i++) e.update(1 / 60);

  // Drive the engine's OWN camera and render through the composer.
  // A direct renderer.render() of a private camera skips the exposure
  // pass and the grade, which is most of the picture: the first version
  // of this shot came out four stops down and unreadable.
  const cam = e.camera;
  const saved = {
    pos: cam.position.clone(),
    quat: cam.quaternion.clone(),
    up: cam.up.clone(),
    fov: cam.fov,
  };
  const p = new THREE.Vector3();
  const side = new THREE.Vector3();
  e.track.pose(e.player.s, 60, p, side);
  cam.up.set(0, 0, -1); // the lap runs up the frame
  cam.position.set(p.x, height, p.z);
  cam.lookAt(p.x, 0, p.z);
  cam.fov = 45;
  cam.updateProjectionMatrix();
  // The sky dome and its followers ride the camera; from up here they
  // would otherwise sit between the lens and the ground.
  const hidden = [];
  for (const o of e.world.skyFollowers) if (o.visible) { hidden.push(o); o.visible = false; }
  for (let i = 0; i < 6; i++) e.composer.render();
  const gl = e.renderer.domElement;
  const c = document.createElement("canvas");
  c.width = gl.width; c.height = gl.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(gl, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  ctx.putImageData(img, 0, 0);
  for (const o of hidden) o.visible = true;
  cam.position.copy(saved.pos);
  cam.quaternion.copy(saved.quat);
  cam.up.copy(saved.up);
  cam.fov = saved.fov;
  cam.updateProjectionMatrix();
  return c.toDataURL("image/png").split(",")[1];
}, [height, u]);

const { writeFileSync } = await import("node:fs");
const out = `press/grid/grid-${height}m-u${String(u).replace(".", "_")}.png`;
writeFileSync(out, Buffer.from(b64, "base64"));
console.log(`  ${out}`);
await browser.close();
