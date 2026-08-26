// Frames of the changed things: near facades, lamp pools and cones, and
// a wide-kit car. Run alone — headless browsers starve each other here.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle","--enable-webgl","--no-sandbox","--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem("gulf-road-nights-onboarded","2"); localStorage.setItem("gulf-road-nights-coach","3"); });
await page.reload({ waitUntil: "domcontentloaded" });
await page.click("text=START ENGINE");
let up = false;
for (let i = 0; i < 600 && !up; i++) {
  up = await page.evaluate(() => !!window.__grnDebug);
  if (!up) await page.waitForTimeout(1000);
}
if (!up) { console.error("game never booted"); process.exit(2); }
await page.waitForTimeout(1500);

const out = await page.evaluate(async (spots) => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");
  const shots = [];
  const grab = (name) => {
    e.exposurePass.dt = 0;
    for (let i = 0; i < 3; i++) e.composer.render();
    const gl = e.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = gl.width; c.height = gl.height;
    c.getContext("2d").drawImage(gl, 0, 0);
    shots.push({ name, png: c.toDataURL("image/png") });
  };
  const stand = (s, lat) => {
    const away = e.track.wrap(s + e.track.length / 2);
    for (let i = 0; i < 160; i++) {
      e.player.s = s; e.player.lat = lat; e.player.speed = 20;
      for (const t of e.traffic) t.s = away;
      if (e.rival) e.rival.s = away;
      e.update(1 / 60);
    }
    e.exposurePass.dt = 1 / 30;
    for (let i = 0; i < 60; i++) { e.composer.render(); e.exposurePass.dt = 1 / 30; }
  };
  for (const sp of spots) { stand(sp.s, sp.lat); grab(sp.name); }
  e.setPaused(false);
  return shots;
}, [
  { name: "towers-close", s: 900, lat: 6 },
  { name: "lamps-run", s: 4600, lat: 0 },
]);
mkdirSync("press/blur", { recursive: true });
for (const s of out) writeFileSync(`press/blur/${s.name}.png`, Buffer.from(s.png.split(",")[1], "base64"));
console.log("wrote", out.map((s) => s.name).join(", "));
await browser.close();
