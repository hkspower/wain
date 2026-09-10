// How sharp the HUD actually is, measured on the HUD's own pixels.
//
//   npm run dev
//   node tools/shots/hudsharp.mjs
//
// "The HUD looks soft" is a claim about EDGES, and there are only two
// ways an overlay drawn in DOM over a WebGL canvas can lose them:
//
//   1. It is drawn with a halo. Twenty-five text-shadows sit on this HUD
//      and the widest are 26, 28 and 34 px of coloured glow on type that
//      is 14 to 25 px tall. A glow wider than the glyph is a second,
//      blurred copy of the text sitting under the first one — the letter
//      is still crisp and the thing around it is not, and the eye reads
//      the pair as soft.
//
//   2. It is scaled by a fraction. The HUD root carries CSS zoom, set to
//      min(w/1500, h/850) clamped to 0.8..2.5 — 1.0588 at 1600x900. Every
//      hairline border in the HUD is authored at 1px and lands on 1.0588
//      device pixels, which cannot be drawn: it comes out as two rows of
//      grey instead of one row of white. Type is re-laid-out by zoom
//      rather than resampled, so the GLYPHS survive it; the rules,
//      borders and 1px dividers do not.
//
// Both are measured here, on HUD pixels only, segmented by rendering the
// frame twice — once as it ships and once with the HUD hidden — and
// taking the pixels that changed. The scene behind is identical in both,
// so the difference is the overlay and nothing else.
//
// WHAT IS REPORTED, over HUD pixels
//
//   acuity  mean |luma gradient| over the HUD's pixels. Kept because it
//           is what answers the glow question, and the answer turned out
//           to be "nothing": switching all twenty-five text-shadows off
//           moves it 0.4%. The halo is not what softens this HUD, and
//           anybody reaching for the glows to sharpen it is about to
//           spend an afternoon on a 0.4% change.
//
//   contrast  THE ONE THAT MATTERS, and the one nothing was measuring.
//           check:type reads every run of text in the game and reports
//           its contrast — but it computes that against a declared CSS
//           colour, walking up the ancestors until it finds something
//           opaque. Over the race canvas there is nothing opaque up
//           there: the HUD floats on translucent plates over a lit
//           street, and the thing actually behind the type is a sodium
//           lamp, a white car or the black sea depending on where the
//           player is. So the HUD is the one screen in the game whose
//           legibility that tool cannot see, and it has been reporting
//           it green by measuring a colour that is not behind anything.
//
//           This measures the frame. For every run of HUD text it takes
//           the pixels inside the run's own box, splits them into ink
//           and ground by luma, and computes the real WCAG ratio between
//           them. Two places: parked under the lamps, and out on the
//           dark coast.
//
// A NOTE ON WHAT CANNOT BE COMPARED HERE
//
//   An earlier version of this tool also measured the HUD at zoom 1 to
//   see whether the fractional zoom was costing sharpness. Those numbers
//   were meaningless and the rows are gone: the mask is taken once from
//   the shipping frame, and changing the zoom MOVES the HUD, so the mask
//   no longer covers it and the reading falls for a reason that has
//   nothing to do with acuity. A treatment that changes the geometry
//   cannot be scored against a fixed mask. Switching the glows off does
//   not move anything, which is why that row is trustworthy.

import { chromium } from "playwright-core";
import { existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium", "/usr/bin/google-chrome",
].filter(Boolean);
// isFile, not exists: PLAYWRIGHT_BROWSERS_PATH/chromium is a directory on
// some images and a binary on this one, and existsSync says yes to both.
const exe = C.find((p) => { try { return statSync(p).isFile(); } catch { return false; } });
if (!exe) { console.error("no chromium"); process.exit(2); }

const W = Number(process.env.W || 1600);
const H = Number(process.env.H || 900);

const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage",
         "--force-color-profile=srgb"],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(240000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:3000/race", { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("gulf-road-nights-onboarded", "2");
  localStorage.setItem("gulf-road-nights-coach", "3");
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("text=START ENGINE", { timeout: 120000 });
await page.click("text=START ENGINE");
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 240000 });
await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
// Two attempts. Booting a WebGL scene on the software rasteriser this
// runs on is minutes of solid CPU, and a machine that is also building
// the dev server can miss the deadline — the first run of this tool
// reached the HUD in under a minute and the second timed out at four,
// from identical code.
let up = false;
for (let attempt = 0; attempt < 2 && !up; attempt++) {
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll("span,div")].some(
        (e) => e.textContent === "km/h" &&
          e.checkVisibility({ opacityProperty: true, visibilityProperty: true })),
      null, { timeout: 120000 }
    );
    up = true;
  } catch {
    if (attempt === 0) {
      console.log("HUD did not come up in two minutes, giving it one more");
      await page.evaluate(() => window.__grnEngine?.skipCinematic?.());
      continue;
    }
    console.error("the HUD never came up — nothing measured");
    await browser.close();
    process.exit(2);
  }
}
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);

// Park the car so every treatment sees the same scene and the same
// readouts. A HUD measured at speed shows a different number of digits
// from one shot to the next, and the digits are the subject.
await page.evaluate(() => {
  const e = window.__grnEngine;
  e.setPaused(true);
  e.applyQualityTier("high");
  e.timeReal = false; e.timeCycling = false;
  e.timeHours = 1.5; e.world.setTimeOfDay(1.5); e.applyDaylight();
  const park = () => {
    const away = e.track.wrap(2203 + e.track.length / 2);
    for (const t of e.traffic) t.s = away;
    if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
    e.player.s = 2203; e.player.lat = 0; e.player.speed = 0;
  };
  park();
  for (let i = 0; i < 40; i++) { e.update(1 / 60); park(); }
  e.composer.render();
});

const hudRoot = () =>
  document.querySelector('[style*="zoom"]')?.closest("div");

/** Grab the composited page as raw RGBA, through a canvas so the WebGL
 *  layer and the DOM over it are flattened the way the eye sees them. */
const shoot = async (setup) => {
  await page.evaluate((s) => {
    const root = [...document.querySelectorAll("div")].find(
      (d) => d.style && d.style.zoom && d.className.includes("pointer-events-none")
    );
    window.__hudRoot = root ?? null;
    if (!root) return;
    root.style.visibility = s.hide ? "hidden" : "";
    // The glow treatment: kill every text-shadow inside the HUD without
    // touching anything else about it.
    const all = root.querySelectorAll("*");
    for (const el of all) {
      if (s.noGlow) {
        if (el.dataset.shadowWas === undefined)
          el.dataset.shadowWas = el.style.textShadow || "";
        el.style.textShadow = "none";
      } else if (el.dataset.shadowWas !== undefined) {
        el.style.textShadow = el.dataset.shadowWas;
        delete el.dataset.shadowWas;
      }
    }
    if (s.zoom !== undefined) root.style.zoom = String(s.zoom);
    window.__grnEngine.composer.render();
  }, setup);
  await page.waitForTimeout(160);
  const buf = await page.screenshot({ type: "png" });
  return buf;
};

mkdirSync("press/hud", { recursive: true });

// PNG decoding, in the page — no image library in the repo, and the
// browser already has one.
const analyse = async (shots) => {
  return page.evaluate(async (shots) => {
    const load = (b64) => new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        res({ w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data });
      };
      img.src = "data:image/png;base64," + b64;
    });
    const luma = (o) => {
      const f = new Float32Array(o.w * o.h);
      for (let i = 0, p = 0; i < o.d.length; i += 4, p++)
        f[p] = 0.2126 * o.d[i] + 0.7152 * o.d[i + 1] + 0.0722 * o.d[i + 2];
      return f;
    };
    const base = await load(shots.base);
    const bare = await load(shots.bare);
    const bl = luma(base), rl = luma(bare);
    const w = base.w, h = base.h;
    // The mask: pixels the HUD changed, taken once from the shipping
    // frame. 6 levels of luma is comfortably above the compositor's own
    // noise and well below the faintest glow.
    const mask = new Uint8Array(w * h);
    let n = 0;
    for (let p = 0; p < w * h; p++) if (Math.abs(bl[p] - rl[p]) > 6) { mask[p] = 1; n++; }
    const out = { maskPx: n, frac: +((n / (w * h)) * 100).toFixed(2), rows: [] };
    for (const [name, b64] of Object.entries(shots.treatments)) {
      const o = await load(b64);
      const L = luma(o);
      // The HUD's own bright end, so a dim treatment is not judged
      // against the bright one's scale.
      const lit = [];
      for (let p = 0; p < w * h; p++) if (mask[p]) lit.push(L[p]);
      lit.sort((a, b) => a - b);
      const top = lit[Math.floor(0.995 * lit.length)] || 1;
      let gSum = 0, gN = 0, skirt = 0;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          if (!mask[p]) continue;
          gSum += (Math.abs(L[p + 1] - L[p - 1]) + Math.abs(L[p + w] - L[p - w])) / 2;
          gN++;
          const r = L[p] / top;
          if (r > 0.15 && r < 0.55) skirt++;
        }
      }
      out.rows.push({
        name,
        acuity: +(gSum / (gN || 1)).toFixed(2),
        skirt: +((skirt / (gN || 1)) * 100).toFixed(1),
        top: +top.toFixed(1),
      });
    }
    return out;
  }, shots);
};

const b64 = (b) => b.toString("base64");

/** Every visible run of HUD text, with its box and its ink colour. */
const RUNS = `(() => {
  const root = [...document.querySelectorAll("div")].find(
    (d) => d.style && d.style.zoom && d.className.includes("pointer-events-none")
  );
  if (!root) return [];
  const out = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    const raw = t.nodeValue;
    if (!raw || !raw.trim()) continue;
    const el = t.parentElement;
    if (!el || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const rg = document.createRange();
    rg.selectNodeContents(t);
    const r = rg.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) continue;
    const cs = getComputedStyle(el);
    out.push({
      text: raw.trim().slice(0, 22),
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      px: +parseFloat(cs.fontSize).toFixed(2),
      weight: +cs.fontWeight || 400,
    });
  }
  return out;
})()`;

/** Park the car at a named spot and shoot the composited frame. */
const at = async (metre) => {
  await page.evaluate((m) => {
    const e = window.__grnEngine;
    const park = () => {
      const away = e.track.wrap(m + e.track.length / 2);
      for (const t of e.traffic) t.s = away;
      if (e.rival) { e.rival.s = away; e.rival.speed = 0; }
      e.player.s = m; e.player.lat = 0; e.player.speed = 0;
    };
    park();
    for (let i = 0; i < 30; i++) { e.update(1 / 60); park(); }
    for (let i = 0; i < 3; i++) e.composer.render();
  }, metre);
  await page.waitForTimeout(200);
  return page.screenshot({ type: "png" });
};

/** The real ratio between a run's ink and the frame behind it. */
const contrastPass = (shotB64, runs) =>
  page.evaluate(async ([b64, runs]) => {
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.src = "data:image/png;base64," + b64; });
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    // WCAG relative luminance, not the luma proxy: this number is being
    // compared against 4.5 and 3, which are defined against this curve.
    const chan = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const out = [];
    for (const r of runs) {
      const vals = [];
      for (let y = r.y; y < r.y + r.h && y < img.height; y++) {
        for (let x = r.x; x < r.x + r.w && x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          vals.push(0.2126 * chan(d[i]) + 0.7152 * chan(d[i + 1]) + 0.0722 * chan(d[i + 2]));
        }
      }
      if (vals.length < 12) continue;
      vals.sort((a, b) => a - b);
      // INK AT THE 98th, NOT THE 90th.
      //
      // A run's box is mostly not ink. Four letters of 11px type in a
      // 26x13 box cover something like a fifth of it, so the 90th
      // percentile of that box can still be background — and a first
      // version of this scored "Fuel" at 1.58:1 partly by comparing the
      // plate behind the word against the plate behind the word. The
      // 98th sits inside the stems; the 25th is comfortably in the
      // ground on both a lit and an unlit frame.
      //
      // `cover` is printed with the ratio so this can never quietly
      // happen again: a run whose ink covers almost none of its box is
      // one whose ratio should not be believed.
      const ink = vals[Math.min(vals.length - 1, Math.floor(0.98 * vals.length))];
      const ground = vals[Math.floor(0.25 * vals.length)];
      const hi = Math.max(ink, ground), lo = Math.min(ink, ground);
      // How much of the box is within a fifth of the ink's brightness —
      // the glyph coverage, near enough.
      const cover = vals.filter((v) => v >= ink * 0.8).length / vals.length;
      out.push({
        ...r,
        ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2),
        cover: +(cover * 100).toFixed(1),
      });
    }
    return out;
  }, [shotB64, runs]);

mkdirSync("press/hud", { recursive: true });

// ---- 1. the glow question, answered once ---------------------------
const base = await shoot({ hide: false });
const bare = await shoot({ hide: true });
const noGlow = await shoot({ hide: false, noGlow: true });
await shoot({ hide: false, noGlow: false });
writeFileSync("press/hud/hud.png", base);

const acu = await analyse({
  base: b64(base), bare: b64(bare),
  treatments: { "as it ships": b64(base), "glow off": b64(noGlow) },
});
console.log(`\nHUD is ${acu.maskPx} px, ${acu.frac}% of a ${W}x${H} frame\n`);
console.log("                 acuity   skirt");
for (const row of acu.rows)
  console.log(`  ${row.name.padEnd(13)} ${String(row.acuity).padStart(6)}  ${String(row.skirt).padStart(5)}%`);

// ---- 2. the contrast the frame actually delivers --------------------
const SPOTS = [["under the lamps", 587], ["the dark coast", 1300]];
const fail = [];
for (const [where, m] of SPOTS) {
  const shot = await at(m);
  writeFileSync(`press/hud/hud-${where.split(" ").pop()}.png`, shot);
  const runs = await page.evaluate(RUNS);
  const rows = await contrastPass(b64(shot), runs);
  rows.sort((a, b) => a.ratio - b.ratio);
  // WCAG's own definition of large text, same as check:type uses.
  const floorOf = (r) => (r.px >= 24 || (r.px >= 18.66 && r.weight >= 700) ? 3 : 4.5);
  const under = rows.filter((r) => r.ratio < floorOf(r));
  console.log(`\n${where}: ${rows.length} runs of HUD text on the frame itself`);
  for (const r of rows.slice(0, 6))
    console.log(
      `   ${String(r.ratio).padStart(6)}:1 (needs ${floorOf(r)}) ${String(r.px).padStart(5)}px  ink ${String(r.cover).padStart(4)}%  ${JSON.stringify(r.text)}`
    );
  if (under.length) fail.push(`${under.length} run(s) under the floor ${where}: ` +
    under.map((r) => `${JSON.stringify(r.text)} ${r.ratio}:1`).join(", "));
}
await browser.close();

console.log("");
if (fail.length) {
  console.error(`FAILURES:\n - ${fail.join("\n - ")}`);
  console.log("\npress/hud/*.png");
  process.exit(1);
}
console.log("every run of HUD text clears its floor against the frame behind it.");
console.log("\npress/hud/*.png");
