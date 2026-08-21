// How much detail the buildings actually deliver.
//
//   npm run dev
//   node tools/shots/sharpness.mjs
//
// "Blurry" is a claim about high-frequency energy, and the whole-frame
// version of that number cannot answer it: a night frame is four fifths
// sky and asphalt, both of which are SUPPOSED to be smooth, and they
// drown whatever the facades are doing. So the buildings are segmented
// out with an ID pass — the same trick levels.mjs uses — and measured on
// their own.
//
// What is reported, over building pixels only:
//
//   edge     mean absolute luma gradient, 0-255 per pixel. Detail.
//   strong   fraction of those pixels sitting on a step of 12 or more.
//            A facade is a grid of hard-edged windows; if almost none of
//            its pixels are on an edge, the grid has been smeared into a
//            gradient.
//   flat     fraction on a step under 2 — pixels carrying no information
//            at all.
//
// Two distances, because the two failure modes are different: up close a
// magnified texture goes soft between texels, and far away the mip chain
// and the lack of anisotropy eat the grid at a grazing angle.

import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) { console.error("no chromium"); process.exit(2); }

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--force-color-profile=srgb"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
await page.waitForTimeout(4500);
if (process.env.NO_FXAA) {
  await page.evaluate(() => { window.__noFxaa = true; });
  console.log("(FXAA off)");
}
if (process.env.BLOOM_T) {
  const t = Number(process.env.BLOOM_T);
  await page.evaluate((v) => { window.__bloomThreshold = v; }, t);
  console.log(`(bloom threshold ${t})`);
}
if (process.env.BLOOM_R) {
  const r = Number(process.env.BLOOM_R);
  await page.evaluate((v) => { window.__bloomRadius = v; }, r);
  console.log(`(bloom radius ${r})`);
}

mkdirSync("press/sharp", { recursive: true });

// Two places in the city, both with facades filling a good part of the
// frame: one with the blocks close on the right, one further back.
const SPOTS = [["near", 587], ["far", 5400]];
for (const [where, m] of SPOTS) {
  const r = await page.evaluate(async ([m]) => {
    const THREE = window.__grnThree;
    const e = window.__grnEngine;
    e.setPaused(true);
    e.applyQualityTier("high");   // pin the resolution: dynamic scaling is its own blur
    if (window.__noFxaa) e.fxaaPass.enabled = false;
    if (window.__bloomThreshold !== undefined) {
      e.bloomPass.threshold = window.__bloomThreshold;
    }
    if (window.__bloomRadius !== undefined) e.bloomPass.radius = window.__bloomRadius;
    e.timeHours = 2.5;
    e.world.setTimeOfDay(2.5);
    e.applyDaylight();
    e.setExposure(0, false);
    const park = () => {
      const away = e.track.wrap(m + e.track.length / 2);
      for (const t of e.traffic) t.s = away;
      if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
      e.player.s = m;
      e.player.lat = 0;
      e.player.speed = 0;
    };
    park();
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 30; i++) { e.update(1 / 60); park(); }
      for (let i = 0; i < 4; i++) e.composer.render();
    }

    // Full canvas resolution. Reading back at half size put a two-times
    // box filter between the frame and the measurement — measuring blur
    // on an image the instrument had just blurred itself.
    const W = e.renderer.domElement.clientWidth || 1280;
    const H = e.renderer.domElement.clientHeight || 720;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");

    // Beauty frame.
    ctx.drawImage(e.renderer.domElement, 0, 0, W, H);
    const beauty = ctx.getImageData(0, 0, W, H).data;

    // ID pass: every mesh flat black, the city blocks flat green.
    const saved = [];
    const hidden = [];
    const tinted = [];
    const idMat = (isBuilding) =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(isBuilding ? 0x00ff00 : 0x000000),
        fog: false,
      });
    const mats = [idMat(false), idMat(true)];
    // A building is a stack now — shaft, parapet, setback, plant, mast —
    // and every piece of it is a separate InstancedMesh. Counting only
    // the shaft would leave the roof out of the mask and measure the
    // sharpness of a building with its top cropped off.
    const CITY = new Set([
      "cityBlocks",
      "cityParapets",
      "citySetbacks",
      "cityPlant",
      "cityMasts",
    ]);
    const isBuilding = (o) => {
      for (let n = o; n; n = n.parent) if (CITY.has(n.name)) return true;
      return false;
    };
    e.scene.traverse((o) => {
      if (o.isSprite && o.visible) { hidden.push(o); o.visible = false; return; }
      if (!o.isMesh && !o.isInstancedMesh) return;
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      // Transparent overlays become opaque flat quads once their material
      // is swapped, and paint over whatever is behind them.
      if (src && (src.transparent || (src.opacity ?? 1) < 1)) {
        if (o.visible) { hidden.push(o); o.visible = false; }
        return;
      }
      saved.push([o, o.material]);
      o.material = mats[isBuilding(o) ? 1 : 0];
      // An InstancedMesh MULTIPLIES the material colour by each
      // instance's own colour, and the city blocks carry a palette of
      // concrete greys. So a flat 0,255,0 id came out as anything from
      // 0,48,0 to 0,93,0 — pure green, but nowhere near the brightness
      // any sane threshold would look for. Set aside for the pass so the
      // mask is exactly the colour it was asked to be.
      if (o.isInstancedMesh && o.instanceColor) {
        tinted.push([o, o.instanceColor]);
        o.instanceColor = null;
      }
    });
    const prevTone = e.renderer.toneMapping;
    const prevSpace = e.renderer.outputColorSpace;
    const prevBg = e.scene.background;
    e.renderer.toneMapping = THREE.NoToneMapping;
    e.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    e.scene.background = new THREE.Color(0x000000);

    // Read the ID pass out of a render target, not off the canvas.
    //
    // The drawing buffer is not preserved, so drawImage() after a raw
    // renderer.render() can hand back the PREVIOUS frame — and it does.
    // The first version of this read what it thought was an ID pass,
    // got the beauty frame, and reported zero building pixels at both
    // distances: a facade lit by warm windows has more red than green,
    // so the green test rejected every pixel and the tool said the
    // buildings did not exist.
    const rt = new THREE.WebGLRenderTarget(W, H);
    e.renderer.setRenderTarget(rt);
    e.renderer.render(e.scene, e.camera);
    const raw = new Uint8Array(W * H * 4);
    e.renderer.readRenderTargetPixels(rt, 0, 0, W, H, raw);
    e.renderer.setRenderTarget(null);
    rt.dispose();
    // readRenderTargetPixels has its origin at the BOTTOM left; the
    // canvas the beauty frame came from has it at the top. Flip, or the
    // mask is the right shape upside down and lines up with nothing.
    const ids = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      ids.set(raw.subarray(src, src + W * 4), y * W * 4);
    }

    e.renderer.toneMapping = prevTone;
    e.renderer.outputColorSpace = prevSpace;
    e.scene.background = prevBg;
    for (const [o, mm] of saved) o.material = mm;
    for (const [o, ic] of tinted) o.instanceColor = ic;
    for (const o of hidden) o.visible = true;
    for (const mm of mats) mm.dispose();

    // Gradient energy over building pixels.
    const lum = new Float32Array(W * H);
    for (let i = 0, p = 0; i < beauty.length; i += 4, p++) {
      lum[p] = 0.2126 * beauty[i] + 0.7152 * beauty[i + 1] + 0.0722 * beauty[i + 2];
    }
    let n = 0, sum = 0, strong = 0, flat = 0;
    // Edge WIDTH, which is the actual sharpness question and the one the
    // averages above cannot answer. Walk each row; wherever the gradient
    // rises above the threshold, measure how many pixels it stays there.
    // A hard edge is one or two pixels wide however many of them there
    // are; a smeared one is four or five. This exists because the
    // averages went DOWN on a change that visibly sharpened the image —
    // scaling the facade UVs per building traded three hundred tiny
    // blurred windows for fifty crisp ones, and "mean gradient" reads
    // that as a loss.
    let runs = 0, runPx = 0;
    for (let y = 1; y < H - 1; y++) {
      let run = 0;
      for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        const i = p * 4;
        const inMask = ids[i + 1] > 24 && ids[i] < 12 && ids[i + 2] < 12;
        const g = inMask ? Math.abs(lum[p + 1] - lum[p - 1]) : 0;
        if (inMask && g >= 12) run++;
        else if (run) { runs++; runPx += run; run = 0; }
      }
      if (run) { runs++; runPx += run; }
    }
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const p = y * W + x;
        const i = p * 4;
        // Green dominant AND actually bright: an unlit building edge
        // pixel is a coverage question, and a half-covered pixel is not
        // a building pixel.
        // Green and ONLY green. Written this way rather than as a
        // brightness threshold because the id colour is at the mercy of
        // whatever multiplies it on the way out; what cannot change is
        // that nothing else in the pass writes to the red or blue
        // channels at all.
        if (!(ids[i + 1] > 24 && ids[i] < 12 && ids[i + 2] < 12)) continue;
        const gx = Math.abs(lum[p + 1] - lum[p - 1]);
        const gy = Math.abs(lum[p + W] - lum[p - W]);
        const g = (gx + gy) / 2;
        sum += g; n++;
        if (g >= 12) strong++;
        if (g < 2) flat++;
      }
    }
    // Put the beauty frame back on the canvas for the saved image.
    for (let i = 0; i < 4; i++) e.composer.render();
    ctx.drawImage(e.renderer.domElement, 0, 0, W, H);

    // Save the ID frame itself. Looking at the mask is faster than
    // reasoning about why it is empty.
    const idc = document.createElement("canvas");
    idc.width = W; idc.height = H;
    const idx = idc.getContext("2d");
    const img = idx.createImageData(W, H);
    img.data.set(ids);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    idx.putImageData(img, 0, 0);
    const idPng = idc.toDataURL("image/png").split(",")[1];

    // Diagnostic: what the ID pass actually painted.
    let maxG = 0, anyG = 0, named = 0;
    const samples = [];
    for (let i = 0; i < ids.length; i += 4) {
      if (ids[i + 1] > maxG) maxG = ids[i + 1];
      if (ids[i + 1] > 40) {
        anyG++;
        if (samples.length < 8 && anyG % 977 === 0) {
          samples.push(`${ids[i]},${ids[i + 1]},${ids[i + 2]}`);
        }
      }
    }
    e.scene.traverse((o) => { if (o.name === "cityBlocks") named++; });

    return {
      px: n,
      maxG, anyG, named, swapped: saved.length, samples,
      edge: n ? +(sum / n).toFixed(2) : 0,
      width: runs ? +(runPx / runs).toFixed(2) : 0,
      strong: n ? +((strong / n) * 100).toFixed(1) : 0,
      flat: n ? +((flat / n) * 100).toFixed(1) : 0,
      png: c.toDataURL("image/png").split(",")[1],
      idPng,
    };
  }, [m]);
  writeFileSync(`press/sharp/${where}.png`, Buffer.from(r.png, "base64"));
  writeFileSync(`press/sharp/${where}-id.png`, Buffer.from(r.idPng, "base64"));
  console.log(
    `   [ids maxGreen=${r.maxG} greenPx=${r.anyG} named=${r.named} swapped=${r.swapped} samples ${r.samples.join(" | ")}]`
  );
  console.log(
    `${where.padEnd(5)} ${String(r.px).padStart(6)} building px   ` +
      `edge width ${String(r.width).padStart(5)} px   ` +
      `detail ${String(r.edge).padStart(6)}   on an edge ${String(r.strong).padStart(5)}%`
  );
}
await browser.close();
console.log("\npress/sharp/*.png");
