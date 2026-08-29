// How close is a car's paint to the colour that was chosen for it?
//
//   npm run dev
//   node tools/shots/paintaccuracy.mjs
//
// WHAT "ACCURATE" CAN AND CANNOT MEAN HERE
//
// Not "the pixel equals the hex". A car is lit, and a lit surface is the
// colour of the paint TIMES the colour of the light — under sodium at
// midnight nothing on this road is its own colour, and a game that made
// it so would look like a spreadsheet. Brightness is the light's to
// decide and this does not judge it.
//
// What the paint keeps is its HUE and its relative CHROMA. Falcon Red
// may come out dark, and it may come out dim; if it comes out orange it
// is not Falcon Red any more, and the player who paid 150 KD for red got
// something else. So this measures two things per colour:
//
//   HUE ERROR   the angle between the chosen hue and the rendered hue,
//               in degrees around the a*b* plane of CIELAB. This is the
//               one that matters: hue is what a colour IS.
//   CHROMA      how much of the colour's saturation survived, as a ratio
//               against the others. Absolute chroma falls under any
//               light; what would be wrong is one paint keeping its
//               colour while its neighbour turns grey.
//
// WHY THIS IS WORTH MEASURING AT ALL
//
// cars.ts records that every pale car in the fleet once rendered GOLD:
// paint is a metal here, a metal's colour is its reflection, and this
// environment has a sodium band in it. That was found by eye and it took
// a while. A number would have found it on the first run and named the
// eight cars it happened to.
//
// Sampled from the car's own pixels, not from a swatch: the swatch is
// the input, and what the player sees is the output.

import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium"].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium; set CHROME_PATH"); process.exit(2); }

// --- colour science, the same instrument tests/paints.mjs uses --------
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function lab(r8, g8, b8) {
  const r = srgbToLinear(r8 / 255), g = srgbToLinear(g8 / 255), b = srgbToLinear(b8 / 255);
  const X = (0.4124564*r + 0.3575761*g + 0.1804375*b) / 0.95047;
  const Y = 0.2126729*r + 0.7151522*g + 0.0721750*b;
  const Z = (0.0193339*r + 0.1191920*g + 0.9503041*b) / 1.08883;
  const f = (t) => (t > 216/24389 ? Math.cbrt(t) : (841/108)*t + 4/29);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116*fy - 16, 500*(fx - fy), 200*(fy - fz)];
}
const hueOf = ([, a, b]) => (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
const chromaOf = ([, a, b]) => Math.hypot(a, b);
const hueGap = (h1, h2) => { const d = Math.abs(h1 - h2) % 360; return d > 180 ? 360 - d : d; };

const paints = await fetch("http://localhost:3000/api/grn/v1/gamedata")
  .then((r) => r.json())
  .then((d) => d.palette.paints)
  .catch(() => { console.error("start the dev server: npm run dev"); process.exit(2); });

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 700, height: 460 } });
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

console.log("paint                 chosen  rendered   hue err   chroma");
const rows = [];
for (const p of paints) {
  const px = await page.evaluate(async (paintId) => {
    const e = window.__grnEngine;
    const g = JSON.parse(localStorage.getItem("gulf-road-nights-garage") || "{}");
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
      ...g, car: "deera-sedan", cars: ["deera-sedan"], kd: 999999,
      builds: { "deera-sedan": { owned: [paintId], equipped: { paint: paintId }, tint: 0 } },
    }));
    e.applyGarage();
    await new Promise((r) => setTimeout(r, 250));
    // Read the material the renderer is actually going to use, then
    // average the LIT pixels of the car's own painted panels.
    //
    // Averaging the whole frame would measure the road. Averaging every
    // car pixel would fold in glass, tyres and lamps. So: the paint
    // material's own colour, put through the same lighting the frame
    // uses, by rendering the car alone on the game's environment.
    const THREE = window.__grnThree;
    let paintMat = null;
    e.carBody.traverse((o) => {
      if (o.isMesh && o.material?.name === "paint" && !paintMat) paintMat = o.material;
    });
    if (!paintMat) return null;
    const W = 220, H = 160;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 0 });
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
    const stage = new THREE.Scene();
    let root = e.world.moonLight; while (root.parent) root = root.parent;
    stage.environment = root.environment;
    stage.environmentIntensity = 1.0;
    // THE GAME'S OWN RIG, not a studio one.
    //
    // The first version lit this with a white key and white ambient,
    // which measured paint under a stage nobody ever sees. The moon in
    // this game is 0xbfd0ff, the fill is 0x86a6d8 and the hemisphere is
    // 0x2b3853 — every light on the road is blue, and a colour probe
    // that quietly replaced them with white was answering a question
    // about a showroom. Cloned rather than reparented: moving the game's
    // lights into a stage would take them out of the scene they are
    // lighting.
    // Found by TYPE in the live scene, not by name on the world handle.
    //
    // The hemisphere is not on the world's public interface, so asking
    // for w.hemi returns undefined and the probe would have quietly
    // lit the paint with two lights out of three — understating exactly
    // the blue cast it exists to measure. Anything the scene is actually
    // lit by comes across; the car's own headlight does not, because a
    // car is not lit by its own beams.
    let lit = 0;
    root.traverse((o) => {
      if (o.isSpotLight || o.isPointLight) return;
      if (o.isHemisphereLight || o.isDirectionalLight || o.isAmbientLight) {
        const c = o.clone();
        c.castShadow = false;
        stage.add(c);
        lit++;
      }
    });
    if (lit === 0) return null;
    // A plain sphere in the car's paint: a shape with every surface
    // angle on it, so the reading is not one panel's happening to face
    // the one bright thing in the environment.
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), paintMat);
    stage.add(ball);
    cam.position.set(0, 0.5, 3.4);
    cam.lookAt(0, 0, 0);
    const prevRT = e.renderer.getRenderTarget();
    e.renderer.setRenderTarget(rt);
    e.renderer.render(stage, cam);
    const buf = new Uint8Array(W * H * 4);
    e.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    e.renderer.setRenderTarget(prevRT);
    rt.dispose(); ball.geometry.dispose();
    // Only pixels that are actually the ball, and only ones that are lit
    // enough to carry a hue: a pixel at luma 3 has no colour to measure
    // and a blown one has lost it.
    let r = 0, g2 = 0, b = 0, n = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const y = 0.2126*buf[i] + 0.7152*buf[i+1] + 0.0722*buf[i+2];
      if (y < 12 || y > 245) continue;
      r += buf[i]; g2 += buf[i+1]; b += buf[i+2]; n++;
    }
    return n > 200 ? [r/n, g2/n, b/n, n] : null;
  }, p.id);

  if (!px) { console.log(`${p.id.padEnd(20)}  could not read the paint`); continue; }
  const want = p.css;
  const wl = lab(parseInt(want.slice(1,3),16), parseInt(want.slice(3,5),16), parseInt(want.slice(5,7),16));
  const gl = lab(px[0], px[1], px[2]);
  const err = hueGap(hueOf(wl), hueOf(gl));
  // A RATIO IS THE WRONG STATISTIC FOR A NEAR-NEUTRAL.
  //
  // Corniche Silver is #b9bfc7 — chroma about 4, which is almost grey.
  // It rendered at chroma 11, and the first version of this printed
  // "267%" and put it at the top of the table as if it were the worst
  // colour in the game. Eleven units of chroma is a faintly cool grey;
  // the ratio is huge because the denominator is tiny, and the reading
  // that looked most alarming was the least meaningful one.
  //
  // So: a ratio where there is enough chroma for a ratio to mean
  // something, and the absolute shift where there is not. A hue angle
  // is meaningless on a near-neutral too, for the same reason.
  const c0 = chromaOf(wl), c1 = chromaOf(gl);
  const NEUTRAL = 8;
  const keep = c0 >= NEUTRAL ? c1 / c0 : null;
  const drift = c0 < NEUTRAL ? c1 - c0 : null;
  rows.push([p.id, err, keep, c0, drift]);
  const hex = "#" + [px[0],px[1],px[2]].map((v) => Math.round(v).toString(16).padStart(2,"0")).join("");
  console.log(
    `${p.id.padEnd(20)} ${want}  ${hex}  ` +
    (keep === null ? "      —" : err.toFixed(1).padStart(7) + "°") + "  " +
    (keep === null
      ? `near-grey, picked up ${drift.toFixed(1)} chroma`
      : (keep * 100).toFixed(0).padStart(6) + "% of its chroma")
  );
}
await browser.close();

const chromatic = rows.filter(([, , k]) => k !== null);
const neutrals = rows.filter(([, , k]) => k === null);
if (chromatic.length) {
  const worst = chromatic.slice().sort((a, b) => b[1] - a[1])[0];
  const mean = chromatic.reduce((a, r) => a + r[1], 0) / chromatic.length;
  const over = chromatic.filter(([, e2]) => e2 > 15);
  console.log(
    `\n${chromatic.length} chromatic paints: mean hue error ${mean.toFixed(1)}°, ` +
    `worst ${worst[0]} at ${worst[1].toFixed(1)}°`
  );
  console.log("under about 5 degrees nobody can see it; past 15 the colour has a different name.");
  if (over.length) {
    console.log(`past 15: ${over.map(([id, e2]) => `${id} ${e2.toFixed(0)}°`).join(", ")}`);
  } else {
    console.log("none past 15.");
  }
}
if (neutrals.length) {
  const worst = neutrals.slice().sort((a, b) => b[4] - a[4])[0];
  console.log(
    `${neutrals.length} near-greys: most coloured is ${worst[0]}, ` +
    `which picked up ${worst[4].toFixed(1)} chroma — a grey stops reading as one around 15.`
  );
}
