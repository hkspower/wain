#!/usr/bin/env node
/**
 * The place hero keeps its shape:  npm run audit:hero   (needs npm run build)
 *
 * PlaceArt and CategoryArt are a 400×160 viewBox drawn with
 * `preserveAspectRatio="xMidYMid slice"`, which crops to FILL. One line
 * governs the whole thing:
 *
 *     a W×H band shows 400·H/W units of the drawing's height
 *
 * The band's aspect ratio is the only input. Nothing inside the drawings can
 * widen that window, so a change to the hero's width or height silently
 * decides how much of every place illustration a visitor ever sees.
 *
 * THIS EXISTS BECAUSE IT ALREADY HAPPENED. The hero was `h-28 sm:h-40` at full
 * content width. The compact-scale pass shrank it from 256px and nobody
 * re-measured: at 864×160 the window collapsed to 74 units, and the drawings
 * need about 103. `BASE` — the ground line placed at y 134 *specifically* to
 * survive this crop — fell outside it, along with both `SEA` lines and the
 * feet of every building. Every desktop hero was decapitated and standing on
 * nothing, for weeks, and `PlaceArt.tsx` carried a comment confidently
 * describing a safe box that no longer existed.
 *
 * Nothing caught it. `audit:mobile` renders 390 and 320, where the ratio is
 * benign; `audit:padding` checks the gutter, not the band. A defect that only
 * exists above 640px had no reader.
 *
 * So this measures the rendered band at a ladder of widths — including the
 * awkward ones either side of a breakpoint, which is where the second version
 * of this fix broke — and fails with the number rather than a shrug.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = 4231;

/**
 * The drawings' own vertical extent, measured with getBBox across all 52
 * heroes and excluding the full-bleed backgrounds, which are *meant* to be
 * cropped. Tops run to y 35.8 (a mast), bottoms to y 138.8 (the lower SEA
 * line); BASE with its 4.5 stroke ends at 136.3. Round up: 103 units.
 */
const UNITS_NEEDED = 103;
const VIEWBOX_WIDTH = 400;

if (!existsSync(join(OUT, "index.html"))) {
  console.error("out/ is missing — run npm run build first.");
  process.exit(1);
}

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

/** One place with its own PlaceArt, one falling back to CategoryArt. */
const slugs = readdirSync(join(OUT, "places"));
const SAMPLE = ["grand-mosque", "kuwait-towers"].filter((s) => slugs.includes(s));
if (SAMPLE.length === 0) SAMPLE.push(slugs[0]);

/**
 * 320 and 390 are the phone floors audit:mobile already uses. 596 and 639 are
 * the pair that caught the breakpoint cliff — the band reaches its max width
 * before a height breakpoint fires, so anything keyed on `sm:` has a hole
 * there. 1920 is the monitor the original bug lived on.
 */
const WIDTHS = [320, 390, 430, 596, 639, 640, 768, 1024, 1280, 1920];

const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: CHROMIUM });

let worst = Infinity;
let problems = 0;
const rows = [];

for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: "ar-KW" });
  const page = await ctx.newPage();
  for (const slug of SAMPLE) {
    await page.goto(`http://localhost:${PORT}/places/${slug}/`, { waitUntil: "domcontentloaded" });
    const band = await page.evaluate(() => {
      const el = [...document.querySelectorAll("div")].find(
        (d) => d.className.includes("overflow-hidden") && d.querySelector("svg"),
      );
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { w: b.width, h: b.height };
    });
    if (!band || band.w === 0 || band.h === 0) {
      console.log(`  ✗ ${width}px ${slug}: no hero band found`);
      problems++;
      continue;
    }
    const units = (VIEWBOX_WIDTH * band.h) / band.w;
    if (units < worst) worst = units;
    const ok = units >= UNITS_NEEDED;
    if (!ok) problems++;
    rows.push({ width, slug, w: Math.round(band.w), h: Math.round(band.h), units, ok });
  }
  await ctx.close();
}

await browser.close();
server.close();

console.log("\n── how much of the 400×160 drawing the hero shows ──");
for (const r of rows) {
  const flag = r.ok ? " " : "✗";
  console.log(
    `  ${flag} ${String(r.width).padStart(4)}px  band ${String(r.w).padStart(3)}×${String(r.h).padStart(3)}` +
    `  ratio ${(r.w / r.h).toFixed(2)}  shows ${r.units.toFixed(0)} units` +
    (r.ok ? "" : `  — needs ${UNITS_NEEDED}`),
  );
}

console.log(
  `\n  Tightest: ${worst.toFixed(1)} units against ${UNITS_NEEDED} needed. ` +
  `The band may not exceed ${(VIEWBOX_WIDTH / UNITS_NEEDED).toFixed(2)}:1.`,
);

if (problems) {
  console.error(
    `\n${problems} error(s). The hero's ASPECT RATIO decides this, not its height — ` +
    `see the comment in PlaceView.tsx before changing either.`,
  );
  process.exit(1);
}
console.log("\n0 errors — every hero shows its drawing whole.");
