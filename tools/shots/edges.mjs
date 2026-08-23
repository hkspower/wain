// How good are the edges?
//
//   npm run dev
//   node tools/shots/edges.mjs
//
// "Improve the edges" is a complaint about aliasing, and aliasing is
// one of the few picture problems that is genuinely easy to measure and
// almost impossible to judge from a screenshot on a different monitor.
// So this measures it three ways, because the three fail differently:
//
//   TRANSITION WIDTH  Across a hard edge, how many pixels does the
//                     luminance take to go from 10% to 90% of the step?
//                     A perfectly aliased edge does it in one: there is
//                     no partially-covered pixel because coverage was
//                     never computed. Antialiasing puts one or two
//                     intermediate values in, so the width rises toward
//                     two. This is the direct measurement.
//
//   STAIRCASE         On a near-vertical silhouette, where is the edge
//                     in each row? Aliased, it sits at integer pixels
//                     and jumps a whole pixel at a time — the staircase
//                     you actually see. Antialiased, the sub-pixel
//                     position moves smoothly, so the row-to-row
//                     variation is a fraction of a pixel.
//
//   WHAT AA IS DOING  The difference of two frames, one with the FXAA
//                     pass on and one with it off. This is the only one
//                     that says whether the pass in the chain is EARNING
//                     its place: a misconfigured FXAA — wrong resolution
//                     uniform, wrong position in the chain, disabled by
//                     a quality tier — still exists, still costs a draw,
//                     and changes almost nothing.
//
// The edges are found rather than assumed. A night frame's strongest,
// longest, straightest contrast boundary is a building against the sky,
// so the scan looks in the upper half of the frame for horizontal
// luminance steps above a threshold and measures those.

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

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
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
await page.waitForTimeout(2500);

const out = await page.evaluate(async ([wantShots]) => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");

  // Stand somewhere with a skyline in the upper frame and hold still,
  // with traffic pushed away so nothing wanders through the shot.
  const away = e.track.wrap(4200 + e.track.length / 2);
  for (let i = 0; i < 200; i++) {
    e.player.s = 4200;
    e.player.lat = -3;
    e.player.speed = 18;
    for (const t of e.traffic) t.s = away;
    if (e.rival) e.rival.s = away;
    e.update(1 / 60);
  }
  e.exposurePass.dt = 1 / 30;
  for (let i = 0; i < 90; i++) { e.composer.render(); e.exposurePass.dt = 1 / 30; }

  const grab = () => {
    e.exposurePass.dt = 0;
    for (let i = 0; i < 4; i++) e.composer.render();
    const gl = e.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = gl.width; c.height = gl.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(gl, 0, 0);
    return { canvas: c, d: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  };

  const lum = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;

  /**
   * Edge quality over one frame.
   *
   * Scans rows in the upper half — where the skyline is — for a
   * horizontal step bigger than STEP. For each one it walks out to the
   * plateaus on both sides and asks how many pixels the crossing took
   * from 10% to 90% of the step height.
   */
  //
  // Only LONG edges count, and that correction matters more than any
  // number below it. The first version scanned the upper half of the
  // frame for hard luminance steps and called them aliased edges. The
  // upper half of a night frame in this city is lit windows and stars:
  // hundreds of small bright rectangles on dark facades, and single-pixel
  // points on a dark sky. Those ARE hard steps, they are supposed to be,
  // and FXAA deliberately leaves thin features alone rather than smearing
  // them. So the measurement said half the edges were unresolved, the AA
  // pass looked broken, and it was the scan that was wrong.
  //
  // A geometry silhouette is long. A window is eight to fourteen pixels
  // tall and a star is one; a building against the sky, a gantry leg or a
  // guardrail runs for scores of rows. Requiring a step to belong to a
  // vertical run of at least MIN_RUN rows keeps the silhouettes and drops
  // the texture.
  const measure = (f) => {
    const STEP = 0.12;
    const MIN_RUN = 18;
    // First pass: mark every strong horizontal step.
    const isEdge = new Uint8Array(f.w * f.h);
    for (let y = 1; y < f.h - 1; y++) {
      for (let x = 3; x < f.w - 4; x++) {
        const i = (y * f.w + x) * 4;
        if (Math.abs(lum(f.d, i + 4) - lum(f.d, i - 4)) >= STEP) isEdge[y * f.w + x] = 1;
      }
    }
    // Second: keep only those in a tall run, allowing one pixel of lean
    // per row so a slightly slanted silhouette still counts.
    const keep = new Uint8Array(f.w * f.h);
    for (let y = 0; y < f.h; y++) {
      for (let x = 3; x < f.w - 4; x++) {
        if (!isEdge[y * f.w + x] || keep[y * f.w + x]) continue;
        const run = [[x, y]];
        let cx = x;
        for (let cy = y + 1; cy < f.h; cy++) {
          let next = -1;
          for (const dx of [0, -1, 1]) {
            if (isEdge[cy * f.w + cx + dx]) { next = cx + dx; break; }
          }
          if (next < 0) break;
          cx = next;
          run.push([cx, cy]);
        }
        if (run.length >= MIN_RUN) for (const [rx, ry] of run) keep[ry * f.w + rx] = 1;
      }
    }
    const widths = [];
    for (let y = 2; y < f.h - 2; y++) {
      for (let x = 3; x < f.w - 4; x++) {
        if (!keep[y * f.w + x]) continue;
        const i = (y * f.w + x) * 4;
        const a = lum(f.d, i - 4);
        const b = lum(f.d, i + 4);
        // Plateaus either side, three pixels out, so a soft edge is not
        // mistaken for a shallow gradient.
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const span = hi - lo;
        const t10 = lo + span * 0.1;
        const t90 = lo + span * 0.9;
        // Walk the crossing.
        let first = -1, last = -1;
        for (let k = -3; k <= 3; k++) {
          const v = lum(f.d, ((y * f.w) + x + k) * 4);
          const inside = v > t10 && v < t90;
          if (inside) {
            if (first < 0) first = k;
            last = k;
          }
        }
        // No pixel strictly between the plateaus at all is a one-step
        // edge: hard aliasing, width 1 by definition.
        const width = first < 0 ? 1 : last - first + 2;
        widths.push(width);
        x += 3; // do not re-measure the same edge
      }
    }
    widths.sort((p, q) => p - q);
    const mean = widths.reduce((s2, v) => s2 + v, 0) / Math.max(1, widths.length);
    const hard = widths.filter((v) => v <= 1).length / Math.max(1, widths.length);
    return {
      count: widths.length,
      mean: +mean.toFixed(3),
      median: widths[Math.floor(widths.length / 2)] ?? 0,
      hardFrac: +hard.toFixed(3),
    };
  };

  /**
   * Staircase: how far the sub-pixel edge position moves row to row on
   * a near-vertical silhouette. Estimated by linear interpolation across
   * the crossing, which is exactly the sub-pixel coverage antialiasing
   * would have produced if it had been computed.
   */
  const staircase = (f) => {
    const STEP = 0.16;
    const cols = new Map();
    for (let y = Math.floor(f.h * 0.1); y < Math.floor(f.h * 0.5); y++) {
      for (let x = 2; x < f.w - 3; x++) {
        const a = lum(f.d, (y * f.w + x) * 4);
        const b = lum(f.d, (y * f.w + x + 1) * 4);
        if (Math.abs(b - a) < STEP) continue;
        // Where between x and x+1 the halfway point falls.
        const mid = (a + b) / 2;
        const t = Math.abs(b - a) < 1e-6 ? 0.5 : (mid - a) / (b - a);
        const key = Math.round(x / 6); // group into vertical bands
        if (!cols.has(key)) cols.set(key, []);
        cols.get(key).push(x + t);
        x += 3;
      }
    }
    // For each band with a decent run of rows, how much does the
    // estimated edge position jump from one row to the next?
    const jumps = [];
    for (const [, xs] of cols) {
      if (xs.length < 12) continue;
      for (let i = 1; i < xs.length; i++) {
        const d = Math.abs(xs[i] - xs[i - 1]);
        if (d < 3) jumps.push(d); // ignore band-hopping
      }
    }
    jumps.sort((p, q) => p - q);
    return {
      samples: jumps.length,
      median: +(jumps[Math.floor(jumps.length / 2)] ?? 0).toFixed(3),
    };
  };

  // As shipped, against nothing at all. The first version toggled only
  // the FXAA pass, which stopped being the whole story the moment the
  // scene buffer became multisampled: at the tiers that can pay for
  // samples, FXAA is deliberately OFF, so "FXAA on" was measuring a
  // configuration the game never ships.
  const fxaaWas = e.fxaaPass.enabled;
  const samplesWas = e.msaaTarget.samples;

  const on = grab();
  e.msaaTarget.samples = 0;
  e.fxaaPass.enabled = false;
  const off = grab();
  e.msaaTarget.samples = samplesWas;
  e.fxaaPass.enabled = fxaaWas;

  // What the AA pass actually changed.
  let moved = 0, movedSum = 0;
  for (let i = 0; i < on.d.length; i += 4) {
    const d = Math.abs(on.d[i] - off.d[i]) + Math.abs(on.d[i + 1] - off.d[i + 1]) +
              Math.abs(on.d[i + 2] - off.d[i + 2]);
    if (d > 6) { moved++; movedSum += d; }
  }

  const res = {
    px: { w: on.w, h: on.h },
    ratio: e.renderer.getPixelRatio(),
    fxaaEnabled: fxaaWas,
    samples: samplesWas,
    on: measure(on),
    off: measure(off),
    stairOn: staircase(on),
    stairOff: staircase(off),
    aaMovedPixels: moved,
    aaMovedFrac: +(moved / (on.w * on.h)).toFixed(4),
    aaMeanDelta: +(movedSum / Math.max(1, moved)).toFixed(1),
  };
  if (wantShots) res.shot = on.canvas.toDataURL("image/png");
  e.setPaused(false);
  return res;
}, [WRITE]);

if (WRITE && out.shot) {
  mkdirSync("press/edges", { recursive: true });
  writeFileSync("press/edges/frame.png", Buffer.from(out.shot.split(",")[1], "base64"));
}

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

console.log(`buffer       ${out.px.w}x${out.px.h} at pixel ratio ${out.ratio}`);
console.log(`antialiasing ${out.samples}x MSAA on the scene buffer, FXAA ${out.fxaaEnabled ? "on" : "off"} at this tier`);
console.log("");
console.log(`edges found  ${out.on.count} hard steps in the skyline half of the frame`);
console.log(
  `transition   ${out.on.mean} px mean with AA, ${out.off.mean} px without ` +
  `(1.0 is a step with no partial coverage at all)`
);
console.log(
  `one-step     ${(out.on.hardFrac * 100).toFixed(1)}% of edges as shipped, ` +
  `${(out.off.hardFrac * 100).toFixed(1)}% with none`
);
console.log(
  `staircase    ${out.stairOn.median} px median row-to-row jump with AA, ` +
  `${out.stairOff.median} without (${out.stairOn.samples} samples)`
);
console.log(
  `aa is doing  ${out.aaMovedPixels} px (${(out.aaMovedFrac * 100).toFixed(2)}% of frame) ` +
  `moved by ${out.aaMeanDelta}/765 on average`
);
console.log("");

// The AA pass has to be earning its place.
console.log(`  ${check(out.aaMovedFrac > 0.01, `the AA pass changes only ${(out.aaMovedFrac * 100).toFixed(2)}% of the frame — it is not working`)}  the AA pass changes the picture`);
// ...and the result has to be soft edges rather than steps.
console.log(`  ${check(out.on.mean > 1.35, `edges cross in ${out.on.mean} px — they are still steps`)}  edges have partial coverage`);
console.log(`  ${check(out.on.hardFrac < 0.45, `${(out.on.hardFrac * 100).toFixed(1)}% of long silhouettes are a single hard step`)}  most edges are not one-step`);
console.log(`  ${check(out.on.mean > out.off.mean, `antialiasing makes edges harder than none at all (${out.on.mean} vs ${out.off.mean})`)}  AA is softer than no AA`);

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe edges are resolved");
await browser.close();
process.exit(fail.length ? 1 : 0);
