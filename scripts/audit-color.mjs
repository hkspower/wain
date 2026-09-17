#!/usr/bin/env node
/**
 * Measure the colour actually on screen:  npm run audit:color
 *
 * Three questions, and only the first can be answered by reading the CSS.
 *
 *   1. How many colours does the palette declare?
 *   2. How many actually render, and is every one of them from the palette?
 *      A hex typed at a call site is how a palette stops being a palette.
 *   3. Does every piece of text have enough contrast against what is behind
 *      it? This is the one that matters to a person. Kuwait is bright, phones
 *      are held outdoors at midday, and grey-on-grey that reads fine on a
 *      desk monitor is unreadable in a car park.
 *
 * Contrast is computed the way WCAG defines it — relative luminance, sRGB
 * linearised — against the nearest ancestor that actually paints a background,
 * because that is what the eye compares against.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4205;

if (!existsSync(join(OUT, "index.html"))) {
  console.error("out/ is missing — run npm run build first.");
  process.exit(1);
}

// ---- 1. what the palette declares -----------------------------------------
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const declared = new Map(); // hex -> [token names]
for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8});/g)) {
  const hex = m[2].toLowerCase();
  if (!declared.has(hex)) declared.set(hex, []);
  declared.get(hex).push(m[1]);
}
console.log(`\nPalette: ${declared.size} distinct colours across ${[...declared.values()].flat().length} tokens.`);
const shared = [...declared].filter(([, names]) => names.length > 1);
if (shared.length) {
  console.log("  Tokens that are the same colour (deliberate aliases, or a duplicate):");
  for (const [hex, names] of shared) console.log(`    ${hex}  ${names.join(", ")}`);
}

// ---- serve -----------------------------------------------------------------
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".xml": "application/xml" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  let f = join(OUT, p);
  if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
  if (!existsSync(f) || !f.startsWith(OUT)) { res.writeHead(404); return res.end("nope"); }
  res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));

function routes(dir = OUT, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) routes(full, acc);
    else if (name === "index.html") {
      const r = "/" + relative(OUT, dirname(full)).replace(/\\/g, "/");
      acc.push(r === "/." ? "/" : r + "/");
    }
  }
  return acc;
}
const PAGES = routes().sort().filter((r) => !r.startsWith("/places/") || r === "/places/kuwait-towers/");

const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: CHROMIUM });

const rendered = new Map();  // hex -> count
const failures = new Map();  // key -> sample
let sampled = 0;
let unmeasured = 0;          // text over a photograph — CSS cannot say

for (const vp of [
  { name: "phone", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "desktop", width: 1280, height: 900 },
]) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile, hasTouch: vp.hasTouch, locale: "ar-KW",
  });
  const page = await ctx.newPage();
  for (const url of PAGES) {
    await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const found = await page.evaluate(() => {
      // Colours are read by painting them, not by parsing them. Tailwind v4
      // compiles an opacity modifier like bg-white/95 to color-mix(), which
      // Chromium reports as `oklab(0.99 0.00004 0.00002 / 0.95)` — a regex for
      // rgba() skips it silently, and the walker below then reports the colour
      // *behind* a translucent surface as if nothing were in front of it. That
      // is how this file first claimed the palette had white text on white.
      // Painting the string onto a canvas over white and again over black
      // recovers the exact sRGB the compositor uses, whatever the syntax:
      // the difference between the two gives alpha, and the black pass divided
      // by alpha gives the colour. Both passes are opaque, so nothing is lost
      // to premultiplication.
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      const cache = new Map();
      const paint = (base, s) => {
        cx.clearRect(0, 0, 1, 1);
        cx.fillStyle = base;
        cx.fillRect(0, 0, 1, 1);
        cx.fillStyle = s;
        cx.fillRect(0, 0, 1, 1);
        return cx.getImageData(0, 0, 1, 1).data;
      };
      const toRgb = (s) => {
        if (!s || s === "none" || s === "transparent") return null;
        if (cache.has(s)) return cache.get(s);
        let out = null;
        try {
          const W = paint("#ffffff", s);
          const B = paint("#000000", s);
          const a = 1 - (W[0] - B[0] + (W[1] - B[1]) + (W[2] - B[2])) / 765;
          out = a <= 0.004
            ? null
            : { r: Math.min(255, B[0] / a), g: Math.min(255, B[1] / a), b: Math.min(255, B[2] / a), a };
        } catch { out = null; }
        cache.set(s, out);
        return out;
      };
      const hex = (c) => "#" + [c.r, c.g, c.b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
      /** Composite a translucent colour over what is behind it. */
      const over = (fg, bg) => ({
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
      });
      const lum = (c) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const WHITE = { r: 255, g: 255, b: 255, a: 1 };
      /** Composite `back` behind an already-accumulated front colour. */
      const under = (front, back) => {
        const a = front.a + back.a * (1 - front.a);
        if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
        const ch = (f, b) => (f * front.a + b * back.a * (1 - front.a)) / a;
        return { r: ch(front.r, back.r), g: ch(front.g, back.g), b: ch(front.b, back.b), a };
      };

      /**
       * The paint layers of one element, front to back. A gradient is returned
       * as several colours rather than one, because it does not have one: the
       * hero runs sea-800 to sea-600, and the only honest verdict is the worst
       * point along it.
       */
      const layersOf = (cs) => {
        const layers = [];
        const img = cs.backgroundImage;
        if (img && img !== "none") {
          // A photograph's colour cannot be known from the CSS. Say so rather
          // than guess, and never fail text on a guess.
          if (/(^|[\s,])(url|image-set|-webkit-image-set)\(/.test(img)) return { unknown: true, layers };
          const stops = [];
          for (const m of img.matchAll(/\b(?:rgba?|hsla?|oklab|oklch|lab|lch|color)\([^()]*\)/g)) {
            const c = toRgb(m[0]);
            if (c) stops.push(c);
          }
          if (stops.length) layers.push(stops);
        }
        const bg = toRgb(cs.backgroundColor);
        if (bg) layers.push([bg]);
        return { unknown: false, layers };
      };

      /** Keep the extremes: worst case for contrast is always one of them. */
      const prune = (list) => {
        if (list.length < 3) return list;
        const sorted = [...list].sort((p, q) => lum(p) - lum(q));
        return [sorted[0], sorted[sorted.length - 1]];
      };

      /** Everything the text could be sitting on. */
      const backdrop = (el) => {
        let cands = [{ r: 0, g: 0, b: 0, a: 0 }];
        for (let n = el; n; n = n.parentElement) {
          const { unknown, layers } = layersOf(getComputedStyle(n));
          if (unknown) return { colours: [], unknown: true };
          for (const layer of layers) {
            const next = [];
            for (const acc of cands) for (const c of layer) next.push(under(acc, c));
            cands = prune(next);
          }
          if (cands.every((c) => c.a >= 0.999)) return { colours: cands, unknown: false };
        }
        return { colours: cands.map((c) => over(c, WHITE)), unknown: false };
      };

      const out = { colours: [], text: [], unknown: 0 };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent.trim();
        if (!t) continue;
        const el = n.parentElement;
        if (!el) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
        if (!el.offsetParent && cs.position !== "fixed") continue;
        const fgRaw = toRgb(cs.color);
        if (!fgRaw) continue;
        const { colours, unknown } = backdrop(el);
        // Text over a photograph: not measurable from CSS, counted and
        // reported, never failed on a guess.
        if (unknown || !colours.length) { out.unknown++; continue; }
        const size = parseFloat(cs.fontSize);
        const weight = parseInt(cs.fontWeight, 10) || 400;
        // WCAG "large text": 18.66px bold, or 24px.
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        let worst = null;
        for (const bg of colours) {
          const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;
          const r = ratio(fg, bg);
          out.colours.push(hex(fg), hex(bg));
          if (!worst || r < worst.r) worst = { r, fg, bg };
        }
        out.text.push({
          ratio: +worst.r.toFixed(2),
          need: large ? 3 : 4.5,
          fg: hex(worst.fg), bg: hex(worst.bg), size, weight, large,
          text: t.slice(0, 42),
        });
      }
      // Painted surfaces, not just text, so the palette count is honest.
      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        for (const prop of ["backgroundColor", "borderTopColor"]) {
          const c = toRgb(cs[prop]);
          if (c && c.a > 0.02) out.colours.push(hex(c.a < 1 ? over(c, { r: 255, g: 255, b: 255, a: 1 }) : c));
        }
      }
      return out;
    });

    for (const c of found.colours) rendered.set(c, (rendered.get(c) ?? 0) + 1);
    unmeasured += found.unknown;
    for (const t of found.text) {
      sampled++;
      if (t.ratio < t.need) {
        const key = `${t.fg}|${t.bg}|${t.large}`;
        if (!failures.has(key)) failures.set(key, { ...t, where: `${url} [${vp.name}]`, n: 0 });
        failures.get(key).n++;
      }
    }
  }
  await ctx.close();
}
await browser.close();
server.close();

// ---- 2. the volume ---------------------------------------------------------
console.log(`\n── how much colour is actually on screen ──`);
console.log(`  ${rendered.size} distinct colours render across ${PAGES.length} pages, two viewports.`);
const strangers = [...rendered]
  .filter(([hex]) => !declared.has(hex) && hex !== "#000000" && hex !== "#ffffff")
  .sort((a, b) => b[1] - a[1]);
if (strangers.length) {
  console.log(`\n  ${strangers.length} rendered colour(s) are not named by a token. These are`);
  console.log("  composites and gradient stops — a token at 12% opacity over sand is a");
  console.log("  real, intended colour that nothing names, and so is every point along");
  console.log("  a gradient. Listed by how much they are used, for interest only; the");
  console.log("  question of whether a colour was invented is answered below, from the");
  console.log("  source, where it can be answered definitively.");
  for (const [hex, n] of strangers.slice(0, 12)) console.log(`    ${hex}  ×${n}`);
}

// ---- 2b. colours typed into the source -------------------------------------
// A palette stops being a palette one hardcoded hex at a time, and a rendered
// colour cannot tell you which ones those were — sea-700 at 40% over sand looks
// exactly like sea-700 at 40% over sand whether it came from a token or not.
// So read the source.
//
// The illustrations are exempt, and only they. KuwaitSkyline, CategoryArt and
// the rest are drawings — a dhow sail, a mosque dome, the flag — whose colours
// are picked for the picture, not applied to an interface. Forcing them onto a
// nine-step UI ramp would flatten them, and none of them ever sits behind text.
const ART = new Set([
  "src/components/KuwaitSkyline.tsx",
  "src/components/CategoryArt.tsx",
  "src/components/WainLogo.tsx",
  "src/components/PlaceArt.tsx",
]);
// The PWA manifest and the browser theme colour are read by the operating
// system before any stylesheet exists, so they cannot reference a token.
const OS_CHROME = new Set(["src/app/layout.tsx", "src/app/manifest.ts"]);

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}
const invented = [];
for (const file of sources(join(ROOT, "src"))) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (ART.has(rel) || OS_CHROME.has(rel)) continue;
  const src = readFileSync(file, "utf8");
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const hex = m[0].toLowerCase();
      // #fff and #000 are the two colours a palette never needs to name.
      if (/^#(fff{1,2}|ffffff|000|000000|fff0|ffffff00)$/.test(hex)) continue;
      invented.push({ where: `${rel}:${i + 1}`, hex, line: line.trim().slice(0, 70) });
    }
  });
}
console.log(`\n── colours typed into the source rather than taken from the palette ──`);
if (!invented.length) {
  console.log("  None. Every colour outside the illustrations comes from a token.");
} else {
  for (const v of invented) console.log(`  ✗ ${v.hex}  ${v.where}\n      ${v.line}`);
}

// ---- 3. contrast -----------------------------------------------------------
console.log(`\n── contrast (WCAG AA: 4.5 normal, 3.0 large) ──`);
console.log(`  ${sampled} text nodes measured against the surface behind them.`);
if (unmeasured) {
  console.log(`  ${unmeasured} more sit on a photograph, whose colour no stylesheet knows;`);
  console.log(`  those rely on a scrim in the markup and are a judgement call, not a number.`);
}
if (!failures.size) {
  console.log("  Every one passes.");
} else {
  const list = [...failures.values()].sort((a, b) => a.ratio - b.ratio);
  console.log(`  ${list.length} failing combination(s):\n`);
  for (const f of list) {
    console.log(`    ${f.ratio.toFixed(2)}:1  needs ${f.need}  ${f.fg} on ${f.bg}` +
      `  ${Math.round(f.size)}px/${f.weight}${f.large ? " (large)" : ""}  ×${f.n}`);
    console.log(`        «${f.text}»  first seen ${f.where}`);
  }
}
/* ── the ramps' own levels ────────────────────────────────────────────────
 *
 * Everything above asks what colour reaches the screen and whether it can be
 * read. This asks a different question: are the RAMPS well formed — does each
 * step actually differ from its neighbour, and does a ramp stay one colour
 * family from end to end.
 *
 * Nothing measured it before, and the palette is where a design system rots
 * quietly: a ramp step that is invisibly close to its neighbour is not a bug
 * any page can show you. It is two tokens doing one job, and every later
 * choice between them is a guess.
 *
 * Lightness is OKLCH L, not the sRGB channels — perceptual spacing is the
 * whole point, and #808080 is not half of #ffffff in any way an eye agrees
 * with. audit:type already refuses two type steps closer than 1.5px for
 * exactly this reason; this is that rule for colour.
 */
const srgbLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function oklch(hex) {
  const r = srgbLin(parseInt(hex.slice(1, 3), 16));
  const g = srgbLin(parseInt(hex.slice(3, 5), 16));
  const b = srgbLin(parseInt(hex.slice(5, 7), 16));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s) * 100;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(A, B) };
}

/** Below this two adjacent steps are one colour wearing two names. */
const MIN_DELTA_L = 4;
/**
 * …except at the near-white end, where every ramp legitimately compresses:
 * a 50 step sits a whisker off paper by design, and there is nowhere for it to
 * go without becoming visibly grey. The first draft of this check had no such
 * floor and flagged sand, sea, sun and coral's 50→100 pairs — four "defects"
 * that are the same structural fact about how a tint ramp starts. A rule that
 * fires on every ramp is measuring the rule, not the palette.
 */
const NEAR_WHITE_L = 95;
/**
 * A family break is crossing from NEUTRAL to CHROMATIC in one step, which is
 * what sand does. Deliberately not a chroma RATIO: against a pure-white 50
 * step a ratio is division by almost zero and reports ×76902, a number that
 * says nothing about anything. Absolute bands do say something.
 */
const NEUTRAL_C = 0.02;
const CHROMATIC_C = 0.05;

/**
 * Known and kept, with the reason — an exception list that does not say why is
 * how a real defect gets added to it later.
 */
const LEVEL_EXCEPTIONS = new Map([
  ["ink-500→ink-600", "3.1 ΔL, and both are heavily used (114 and 77 places, " +
    "mostly text-sm on both sides) — so this is two tokens doing one job at a " +
    "distance no reader can see. Kept rather than merged because merging is " +
    "191 edits and a redesign; recorded so the next person choosing between " +
    "them knows there is no difference to choose."],
  ["sand-300→sand-400", "chroma 0.009 → 0.082, a 9× jump: sand-50..300 are " +
    "near-neutral paper and sand-400..900 are gold. One name over two ramps, " +
    "so «one step darker than sand-300» silently hands you a gold. The site " +
    "uses the two halves for different things and never walks across the " +
    "seam; renaming would touch every surface in the app."],
]);

const RAMPS = {};
for (const [hex, names] of declared) {
  for (const n of names) {
    const m = /^([a-z]+)-(\d+)$/.exec(n);
    if (!m) continue;
    (RAMPS[m[1]] ??= []).push({ step: Number(m[2]), hex, ...oklch(hex) });
  }
}

console.log("\n── ramp levels: does each step differ from the one beside it? ──");
const levelProblems = [];
let pairs = 0;
for (const [name, steps] of Object.entries(RAMPS)) {
  if (steps.length < 3) continue; // a pair or a single is not a ramp
  steps.sort((a, b) => a.step - b.step);
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1], b = steps[i];
    const key = `${name}-${a.step}→${name}-${b.step}`;
    pairs++;
    const dL = a.L - b.L;
    const why = [];
    if (dL <= 0) why.push(`step ${b.step} is not darker than ${a.step} (ΔL ${dL.toFixed(1)})`);
    else if (dL < MIN_DELTA_L && a.L < NEAR_WHITE_L) why.push(`ΔL ${dL.toFixed(1)}, under ${MIN_DELTA_L}`);
    if (a.C < NEUTRAL_C && b.C > CHROMATIC_C) {
      why.push(`neutral (C ${a.C.toFixed(3)}) → chromatic (C ${b.C.toFixed(3)}) — a family break`);
    }
    if (!why.length) continue;
    const excuse = LEVEL_EXCEPTIONS.get(key);
    if (excuse) console.log(`  · ${key}: ${why.join("; ")}\n      known: ${excuse}`);
    else levelProblems.push(`${key}: ${why.join("; ")}`);
  }
}
console.log(`  ${pairs} adjacent pairs across ${Object.keys(RAMPS).length} ramps, ` +
  `${LEVEL_EXCEPTIONS.size} known exception(s).`);
if (levelProblems.length) {
  console.log(`\n  ${levelProblems.length} unexplained:`);
  for (const p of levelProblems) console.log(`  ✗ ${p}`);
} else {
  console.log("  No unexplained pair — every other step is a step.");
}

process.exit(failures.size || invented.length || levelProblems.length ? 1 : 0);
