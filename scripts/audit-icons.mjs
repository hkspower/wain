#!/usr/bin/env node
/**
 * Measure the icon set:  npm run audit:icons
 *
 * Renders every icon in a browser and reports what cannot be seen by reading
 * the file — where each shape actually sits on the 24-unit grid, how big it is
 * optically, and how many nodes it costs. Writes a contact sheet to
 * docs/icons.png so the set can also just be looked at.
 *
 * The optical-size check is the point. Icons are used in rows and beside text,
 * and one glyph drawn noticeably larger or smaller than its neighbours makes
 * the whole set look unconsidered, however careful each one is on its own.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROMIUM = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";

const run = (cmd, args) =>
  new Promise((res) => {
    const c = spawn(cmd, args, { cwd: ROOT, stdio: "inherit" });
    c.on("close", (code) => res(code ?? 1));
  });

const dir = mkdtempSync(join(tmpdir(), "wain-icons-"));
const code = await run("npx", [
  "-y", "esbuild", "tests/harness/icons-harness.tsx",
  "--bundle", "--format=iife", "--jsx=automatic",
  `--alias:@=${join(ROOT, "src")}`,
  '--define:process.env.NODE_ENV="production"',
  `--outfile=${join(dir, "icons.js")}`, "--log-level=error",
]);
if (code !== 0) { console.error("could not bundle the icon harness"); process.exit(1); }

writeFileSync(join(dir, "index.html"), `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; padding:24px; background:#fff; color:#1b1917;
         font:14px/1.4 system-ui, sans-serif; }
  .row { display:grid; grid-template-columns:repeat(8, 1fr); gap:18px 8px; }
  figure { margin:0; text-align:center; }
  /* A ruled box at exactly the nominal size: any glyph that overflows it or
     rattles around inside it is visible immediately. */
  figure :is(svg) { display:block; margin:0 auto 6px; outline:1px solid #e8e4de; }
  .ic { width:40px; height:40px; }
  .ic-sm { width:18px; height:18px; vertical-align:-3px; }
  figcaption { font-size:10px; color:#8a8078; }
  .inline-run { margin-top:28px; border-top:1px solid #e8e4de; padding-top:18px; }
  .inline-run span { margin-inline-end:10px; }
</style><div id="root"></div><script src="./icons.js"></script>`);

const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 3 });
await page.goto("file://" + join(dir, "index.html"), { waitUntil: "load" });
await page.waitForFunction(() => typeof window.measure === "function" && document.querySelectorAll("svg").length > 10);

const rows = await page.evaluate(() => window.measure());

mkdirSync(join(ROOT, "docs"), { recursive: true });
await page.locator("#root").screenshot({ path: join(ROOT, "docs", "icons.png") });
await browser.close();
rmSync(dir, { recursive: true, force: true });

/**
 * Marks that are meant to be short, and why.
 *
 * A horizontal arrow drawn to the full 17 units would tower over the label it
 * sits beside; a tick and a cross are read as gestures, not as objects, and
 * both are conventionally smaller than a pictorial glyph. Flagging these as
 * outliers taught the tool to cry wolf, which is how a real outlier gets
 * scrolled past.
 */
const LINEAR = {
  Go: "horizontal arrow — height is not its business",
  Back: "horizontal arrow — height is not its business",
  Check: "a gesture, conventionally smaller than a pictorial glyph",
  Close: "a gesture, conventionally smaller than a pictorial glyph",
  Star: "a star's bounding box is not its optical centre",
};

// ---- report ---------------------------------------------------------------
/**
 * Size is judged on area, not height.
 *
 * Height was the obvious measure and it was wrong: a car and a speaker are
 * wider than they are tall, and forcing either to the height of a clock face
 * turns the car into a van. What actually makes one icon look a different size
 * from its neighbours is how much ink it puts on the page, so that is what is
 * measured. It is a generous band — this is catching the glaring, not tuning.
 */
const pictorial = rows.filter((r) => !LINEAR[r.name.replace("Icon", "")]);
const mid = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const median = mid(pictorial.map((r) => r.h));
const medianArea = mid(pictorial.map((r) => r.area));
const pad = (s, n) => String(s).padEnd(n);

console.log(`\n${rows.length} icons. Median drawn height ${median} of 24 units, median area ${medianArea}.\n`);
console.log(pad("icon", 14) + pad("x", 7) + pad("y", 7) + pad("w", 7) + pad("h", 7) + pad("area", 8) + pad("nodes", 7) + "note");

let problems = 0;
for (const r of rows) {
  const notes = [];
  const short = LINEAR[r.name.replace("Icon", "")];
  if (short) {
    notes.push(`by design: ${short}`);
  } else {
    const off = (r.area - medianArea) / medianArea;
    if (Math.abs(off) > 0.3) { notes.push(`${off > 0 ? "HEAVIER" : "LIGHTER"} than the set by ${Math.round(Math.abs(off) * 100)}%`); problems++; }
    // Off-centre on the grid: the margins above and below should match.
    const vCentre = r.y + r.h / 2;
    if (Math.abs(vCentre - 12) > 0.9) { notes.push(`off-centre vertically (${vCentre.toFixed(1)} vs 12)`); problems++; }
  }
  // Horizontal centring applies to everything, arrows included.
  const hCentre = r.x + r.w / 2;
  if (Math.abs(hCentre - 12) > 0.9) { notes.push(`off-centre horizontally (${hCentre.toFixed(1)} vs 12)`); problems++; }
  console.log(
    pad(r.name.replace("Icon", ""), 14) + pad(r.x, 7) + pad(r.y, 7) +
    pad(r.w, 7) + pad(r.h, 7) + pad(r.area, 8) + pad(r.nodes, 7) + notes.join("; ")
  );
}

const totalNodes = rows.reduce((n, r) => n + r.nodes, 0);
console.log(`\n${totalNodes} SVG nodes across the set.`);
console.log(problems ? `\n${problems} thing(s) to look at. Contact sheet: docs/icons.png` : "\nNothing out of line. Contact sheet: docs/icons.png");
