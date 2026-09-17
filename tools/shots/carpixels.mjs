// Where does the CAR pixelate, at the cameras that actually look at it?
//
//   npm run dev
//   node tools/shots/carpixels.mjs            # the player's car, five views
//   node tools/shots/carpixels.mjs --fleet    # every car in the showroom
//
// tools/shots/texels.mjs already answers "where is the picture
// pixelated". This exists because of two things it deliberately does,
// both right for the question it asks and both wrong for this one.
//
// It measures from the CHASE camera, at four stations on the road. Three
// of the game's five views (views.ts) do not sit there: bonnet, bumper
// and cockpit mount the camera ON the car. The bumper view is "a hand
// off the asphalt" at the nose, which puts the number plate and the
// grille closer to the lens than anything in the game ever gets to
// anything. A texture is magnified by how few texels land per pixel, so
// moving the eye from eight metres back to forty centimetres away is the
// single biggest change you can make to the answer.
//
// And it ranks by share of the FRAME, then drops anything under a tenth
// of a percent. That floor is what makes its report short enough to act
// on — its own header says so, and names the case: "a number plate two
// hundred metres away is magnified and nobody has ever noticed". From
// the chase camera a car's plate, roundel and sidewall lettering are all
// under that floor. They are the whole subject here, so the floor comes
// off and the survey is restricted to the car instead: everything under
// e.carBody, and nothing else in the scene.
//
// Same maths as texels.mjs, deliberately — the per-axis Jacobian of the
// screen-to-texel map, and the same sampled detail test that asks each
// texture which of its axes carry a picture at all. Two tools that
// disagreed about what "pixelated" means would be worse than one.
//
//   texels/px   how many texels of that axis a screen pixel steps
//               across. Above 1 there are texels to spare. At 1 it is a
//               pixel-for-pixel match. Below 1 the texture is being
//               enlarged, and 0.5 means each texel is two pixels wide.
//
// Enlarged below 1.0, PIXELATED below 0.5, and the exit code follows the
// second — the same two lines texels.mjs draws.
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium-1194/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const FLEET = process.argv.includes("--fleet");
/** Below this many texels per pixel the texture is being enlarged. */
const MAGNIFIED = 1.0;
/** ...and below this it is visibly blocky. Same line texels.mjs draws. */
const PIXELATED = 0.5;

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => {
  const t = m.text();
  if (t.startsWith("car ")) console.error(`  ${t} ...`);
});

await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
  // Start from a known save. Without one the menu takes a different
  // route into the race and the engine can be a long time appearing —
  // this tool sat on its 240 s wait twice before the save went in.
  localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
    car: "salmiya-turbo", cars: ["salmiya-turbo"], owned: [], kd: 99999,
    equipped: { paint: "paint-white", glow: "glow-none" },
  }));
});
await page.reload({ waitUntil: "domcontentloaded" });
// The engine comes up behind the menu but carBody is not built until
// the race starts, so the menu has to be driven. texels.mjs gets away
// without this because it only ever reads the world.
// Start the race, and be willing to try again.
//
// One press of START ENGINE does not always take on a software-GL box
// under load: the menu is up, the click lands, and the engine never
// arrives. Waiting longer does not help — the run is simply lost — so
// this reloads and presses again rather than spending four minutes
// finding out. It took three hand re-runs to notice that is what was
// happening.
let started = false;
for (let attempt = 1; attempt <= 4 && !started; attempt++) {
  try {
    await page.waitForSelector("text=START ENGINE", { timeout: 60000 });
    await page.click("text=START ENGINE");
    await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 60000 });
    started = true;
  } catch {
    console.error(`  the engine did not come up on attempt ${attempt}; reloading`);
    await page.reload({ waitUntil: "domcontentloaded" });
  }
}
if (!started) { console.error("the race never started"); await browser.close(); process.exit(2); }
await page.waitForTimeout(2500);

const cars = await page.evaluate(() => fetch("/api/grn/v1/cars").then((r) => r.json()));
// One car per silhouette is the default, because the decals and the
// plate are the same geometry on every car that shares a shell — and
// --fleet is there for when that assumption is the thing in doubt.
const bySil = new Map();
for (const c of cars.cars) if (!bySil.has(c.bodyStyle)) bySil.set(c.bodyStyle, c);
const LIST = FLEET ? cars.cars : [...bySil.values()];

const out = await page.evaluate(async ({ list, MAGNIFIED }) => {
  const e = window.__grnEngine;
  const cam = e.camera;
  const W = window.innerWidth, H = window.innerHeight;
  e.setPaused(true);
  e.applyQualityTier("high");

  /**
   * Does this texture carry detail along each axis?
   *
   * Lifted from texels.mjs, and for its reason: an axis a texture is
   * constant along cannot pixelate, because there is no boundary
   * between one texel and the next to see. Without this the tyre
   * sticker — a band that repeats around the wheel — reads as magnified
   * along the axis it does not vary in.
   */
  const detailCache = new Map();
  const detailOf = (map, img) => {
    if (detailCache.has(map.uuid)) return detailCache.get(map.uuid);
    let d = { u: true, v: true, du: 99, dv: 99 };
    try {
      const n = 64;
      const cv = document.createElement("canvas");
      cv.width = Math.min(n, img.width || n);
      cv.height = Math.min(n, img.height || n);
      const cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      const px = cx.getImageData(0, 0, cv.width, cv.height).data;
      const lum = (x, y) => {
        const i = (y * cv.width + x) * 4;
        return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      };
      let du = 0, dv = 0;
      for (let y = 0; y < cv.height; y++)
        for (let x = 1; x < cv.width; x++) du += Math.abs(lum(x, y) - lum(x - 1, y));
      for (let y = 1; y < cv.height; y++)
        for (let x = 0; x < cv.width; x++) dv += Math.abs(lum(x, y) - lum(x, y - 1));
      du /= Math.max(1, (cv.width - 1) * cv.height);
      dv /= Math.max(1, cv.width * (cv.height - 1));
      d = { u: du > 1.5, v: dv > 1.5, du: +du.toFixed(2), dv: +dv.toFixed(2) };
    } catch { /* a texture that will not draw to a 2D context */ }
    detailCache.set(map.uuid, d);
    return d;
  };

  /** Every textured surface under the car, and its worst axis. */
  const surveyCar = () => {
    const vp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
    const rows = [];
    e.carBody.updateWorldMatrix(true, true);
    e.carBody.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const g = o.geometry;
      const pos = g?.attributes?.position, uv = g?.attributes?.uv;
      if (!pos || !uv) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const map = mats[0]?.map;
      const img = map?.image;
      const tw = img?.width || 0, th = img?.height || 0;
      if (!tw || !th) return;                       // no texture: cannot pixelate
      const rx = (map.repeat?.x ?? 1) * tw;
      const ry = (map.repeat?.y ?? 1) * th;

      const idx = g.index;
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      if (triCount < 1) return;
      const stride = Math.max(1, Math.floor(triCount / 240));
      const m = o.matrixWorld.elements, v = vp.elements;
      const near = cam.near;
      const sx = [0, 0, 0], sy = [0, 0, 0], ux = [0, 0, 0], uy = [0, 0, 0];
      let screenSum = 0, uSum = 0, vSum = 0;

      for (let t = 0; t < triCount; t += stride) {
        let ok = true;
        for (let k = 0; k < 3; k++) {
          const a = idx ? idx.getX(t * 3 + k) : t * 3 + k;
          const px = pos.getX(a), py = pos.getY(a), pz = pos.getZ(a);
          const wx = m[0] * px + m[4] * py + m[8] * pz + m[12];
          const wy = m[1] * px + m[5] * py + m[9] * pz + m[13];
          const wz = m[2] * px + m[6] * py + m[10] * pz + m[14];
          const cx2 = v[0] * wx + v[4] * wy + v[8] * wz + v[12];
          const cy2 = v[1] * wx + v[5] * wy + v[9] * wz + v[13];
          const cw = v[3] * wx + v[7] * wy + v[11] * wz + v[15];
          // Not just "behind the eye" — in FRONT of the near plane.
          //
          // cw is the view-space depth, so this is the clip the GPU
          // itself does. A triangle straddling the near plane projects
          // to enormous screen coordinates and its Jacobian collapses;
          // that is where "0.02 texels per pixel on 98% of the frame"
          // came from at the bumper camera, which sits ten centimetres
          // off the number plate. The GPU never draws those vertices
          // either, so neither should this measure them.
          if (cw <= near) { ok = false; break; }
          sx[k] = (cx2 / cw) * 0.5 * W;
          sy[k] = (cy2 / cw) * 0.5 * H;
          ux[k] = uv.getX(a) * rx;
          uy[k] = uv.getY(a) * ry;
        }
        if (!ok) continue;
        if (Math.min(sx[0], sx[1], sx[2]) > W / 2 || Math.max(sx[0], sx[1], sx[2]) < -W / 2) continue;
        if (Math.min(sy[0], sy[1], sy[2]) > H / 2 || Math.max(sy[0], sy[1], sy[2]) < -H / 2) continue;
        let sa = Math.abs((sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0])) / 2;
        if (sa < 4) continue;                       // too small to see squares in
        // Only the part of the triangle that is ON SCREEN.
        //
        // texels.mjs carries this and says why: without it a surface
        // running off both sides of the frame counts its whole area and
        // the report claims it covers 122% of the picture. Leaving it
        // out here was far worse, because these cameras are mounted ON
        // the car. From the bumper view the number plate spans the lens,
        // and the first run of this tool reported it at 132244% of the
        // frame and 0.00 texels per pixel — a triangle projected so far
        // past the edges that the Jacobian is measuring its own
        // precision. Those were artifacts of the missing clamp, not
        // findings about the car.
        {
          const bw = Math.max(sx[0], sx[1], sx[2]) - Math.min(sx[0], sx[1], sx[2]);
          const bh = Math.max(sy[0], sy[1], sy[2]) - Math.min(sy[0], sy[1], sy[2]);
          const inX = Math.max(0, Math.min(Math.max(sx[0], sx[1], sx[2]), W / 2) - Math.max(Math.min(sx[0], sx[1], sx[2]), -W / 2));
          const inY = Math.max(0, Math.min(Math.max(sy[0], sy[1], sy[2]), H / 2) - Math.max(Math.min(sy[0], sy[1], sy[2]), -H / 2));
          if (inX <= 0 || inY <= 0) continue;
          const onScreen = (bw > 0 ? inX / bw : 1) * (bh > 0 ? inY / bh : 1);
          sa *= Math.min(1, onScreen);
          if (sa < 4) continue;
        }
        const e1x = sx[1] - sx[0], e1y = sy[1] - sy[0];
        const e2x = sx[2] - sx[0], e2y = sy[2] - sy[0];
        const det = e1x * e2y - e2x * e1y;
        if (Math.abs(det) < 1e-9) continue;
        const g1x = ux[1] - ux[0], g1y = uy[1] - uy[0];
        const g2x = ux[2] - ux[0], g2y = uy[2] - uy[0];
        const j00 = (g1x * e2y - g2x * e1y) / det, j01 = (-g1x * e2x + g2x * e1x) / det;
        const j10 = (g1y * e2y - g2y * e1y) / det, j11 = (-g1y * e2x + g2y * e1x) / det;
        uSum += Math.hypot(j00, j01) * sa;
        vSum += Math.hypot(j10, j11) * sa;
        screenSum += sa;
      }
      if (screenSum < 16) return;                   // not on screen to speak of
      // A surface cannot cover more of the frame than the frame.
      //
      // The on-screen clamp above is a bounding-box approximation, and
      // it is a good one until a triangle straddles the near plane —
      // which is exactly what the bumper camera does to the number
      // plate it is sitting ten centimetres from. Those rows came back
      // at 98% to 197% of the frame and 0.02 texels per pixel: the
      // projection is degenerate there, and the Jacobian is measuring
      // its own arithmetic rather than the car.
      //
      // So the tool drops them instead of reporting them. A measurement
      // that announces an impossible number has told you it is not a
      // measurement, and a checker that passes those on is one whose
      // failures nobody trusts.
      if (screenSum > W * H) return;
      const d = detailOf(map, img);
      const uT = uSum / screenSum, vT = vSum / screenSum;
      // Only an axis that carries a picture can pixelate.
      const axes = [];
      if (d.u) axes.push({ axis: "u", tex: uT });
      if (d.v) axes.push({ axis: "v", tex: vT });
      if (!axes.length) return;
      const worst = axes.reduce((a, b) => (a.tex <= b.tex ? a : b));
      // An unnamed mesh is useless in a report — "a 512x128 texture is
      // blocky" does not say WHICH. The decals are added as bare meshes,
      // so fall back through the tags the game does set, then the
      // material, then the nearest named ancestor.
      let label = o.name || o.userData.decal || o.userData.shell ||
        o.userData.wheelPart || mats[0]?.name || "";
      if (!label) {
        for (let p = o.parent; p && !label; p = p.parent) if (p.name) label = `in ${p.name}`;
      }
      rows.push({
        name: label || `${tw}x${th} untagged`,
        size: `${tw}x${th}`,
        axis: worst.axis,
        tex: +worst.tex.toFixed(2),
        px: Math.round(screenSum),
        frac: +((screenSum / (W * H)) * 100).toFixed(2),
      });
    });
    return rows;
  };

  const VIEWS = ["chase", "close", "bonnet", "bumper", "cockpit"];
  const results = [];
  let measured = 0, best = Infinity;
  for (const c of list) {
    console.log(`car ${c.name}`);
    localStorage.setItem("gulf-road-nights-garage", JSON.stringify({
      car: c.id, cars: [c.id], owned: [], kd: 99999,
      equipped: { paint: "paint-white", glow: "glow-none" },
    }));
    e.applyGarage();
    // The decals and the plate are drawn into canvases and swapped in
    // asynchronously; surveying before they land measures the material
    // that has no map yet and reports nothing at all.
    await new Promise((r) => setTimeout(r, 1400));
    for (const v of VIEWS) {
      e.setView(v);
      // The camera rig is stepped by the frame loop, which is paused, so
      // it has to be stepped here — and stepped ENOUGH. It is sprung:
      // one frame after a view change leaves the eye somewhere between
      // the old view and the new one, and the distance from the lens to
      // the bonnet is the single number this whole tool depends on.
      // tests/views.mjs settles it over 25 frames for the same reason;
      // the car is held still across them so the measurement is of the
      // camera and not of the drive.
      for (let i = 0; i < 25; i++) {
        e.player.s = 2400;
        e.player.lat = 0;
        e.player.speed = 100 / 3.6;
        e.heading = 0;
        e.steerSmooth = 0;
        e.setTouchInput({ steer: 0, throttle: 0.5, brake: 0 });
        e.update(1 / 60);
      }
      cam.updateMatrixWorld(true);
      const all = surveyCar();
      // Count what was MEASURED, not only what failed. A survey that
      // silently measured nothing prints the same "all clear" as one
      // that measured everything and found it healthy, and the two are
      // not the same result — over-tight clipping would turn the second
      // into the first without a word.
      measured += all.length;
      for (const r of all) if (r.tex < best) best = r.tex;
      const rows = all.filter((r) => r.tex < MAGNIFIED).sort((a, b) => a.tex - b.tex);
      if (rows.length) results.push({ car: c.name, style: c.bodyStyle, view: v, rows });
    }
  }
  e.setPaused(false);
  return { W, H, results, measured, best: best === Infinity ? null : +best.toFixed(2) };
}, { list: LIST.map((c) => ({ id: c.id, name: c.name, bodyStyle: c.bodyStyle })), MAGNIFIED });

await browser.close();

console.log(`\n${out.W}x${out.H}, ${LIST.length} car${LIST.length === 1 ? "" : "s"} across 5 views`);
console.log(`${out.measured} textured surfaces measured, worst ${out.best ?? "n/a"} texels/px`);
console.log("enlarged below 1.00 texels/px, pixelated below 0.50\n");
if (!out.measured) {
  console.error("measured nothing — the survey is not reaching the car, so this");
  console.error("is not a pass. Check the clipping and that carBody is built.");
  process.exit(2);
}

// Its own directory, the way texels.mjs keeps press/texels — press/shots
// is the committed press set and nothing generated belongs in it.
mkdirSync("press/carpixels", { recursive: true });
writeFileSync("press/carpixels/report.json", JSON.stringify(out, null, 2));

if (!out.results.length) {
  console.log("nothing on any car is enlarged at any view: every textured");
  console.log("surface has at least one texel per pixel along the axis that");
  console.log("carries its picture.");
  process.exit(0);
}

const worst = [];
for (const r of out.results) {
  console.log(`${r.car} · ${r.view}`);
  for (const s of r.rows) {
    const flag = s.tex < PIXELATED ? "PIXELATED" : "enlarged ";
    console.log(`  ${flag} ${String(s.tex).padStart(5)} texels/px  ${s.name.padEnd(14)} ${s.size.padEnd(10)} ${s.axis}  ${s.px} px (${s.frac}% of frame)`);
    if (s.tex < PIXELATED) worst.push({ ...s, car: r.car, view: r.view });
  }
}

if (worst.length) {
  console.error(`\n${worst.length} surface${worst.length === 1 ? "" : "s"} below ${PIXELATED} texels/px — visibly blocky:\n`);
  for (const w of worst)
    console.error(`  ${w.car} · ${w.view}: ${w.name} at ${w.tex} texels/px along ${w.axis}, from a ${w.size} texture`);
  console.error("\nRaise the texture, or shrink the surface it is stretched across.");
  process.exit(1);
}
console.log("\nnothing on a car is below half a texel per pixel: some surfaces");
console.log("are enlarged, none is blocky.");
