#!/usr/bin/env node
/**
 * The place icons, measured and drawn.   npm run audit:place-icons
 *
 * scripts/audit-icons.mjs does this for the 24-grid UI set. The 48-grid place
 * set — one bespoke mark per place, so a search result shows WHICH place
 * rather than which category — had nothing.
 *
 * It is the set where the failure is likelier, for two reasons. Forty-eight
 * units of room invites detail, and detail is the first thing to die at the
 * 16px a result row gives it. And a place with no mark of its own silently
 * falls back to its category icon, so every restaurant renders identically and
 * nothing anywhere says so — which is exactly the state this found: 17 of 36
 * drawn, 19 falling back.
 *
 * Writes a contact sheet to docs/place-icons.png.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

const dir = mkdtempSync(join(tmpdir(), "wain-place-icons-"));
const code = await run("npx", [
  "esbuild", "tests/harness/place-icons-harness.tsx",
  "--bundle", "--format=iife", "--jsx=automatic",
  `--alias:@=${join(ROOT, "src")}`,
  '--define:process.env.NODE_ENV="production"',
  `--outfile=${join(dir, "sheet.js")}`, "--log-level=error",
]);
if (code !== 0) { console.error("could not bundle the place-icon harness"); process.exit(1); }

writeFileSync(join(dir, "index.html"), `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; padding:24px; background:#fff; color:#1b1917;
         font:13px/1.4 system-ui, sans-serif; }
  .grid { display:grid; grid-template-columns:repeat(6, 1fr); gap:20px 10px; }
  figure { margin:0; text-align:center; }
  figure svg { display:block; margin:0 auto 6px; outline:1px solid #e8e4de; }
  .size-20 { width:80px; height:80px; }
  .size-9  { width:36px; height:36px; }
  .size-6  { width:24px; height:24px; }
  figcaption b { display:block; font-size:11px; }
  figcaption .slug { font-size:9px; color:#8a8078; }
  .small-run { margin-top:30px; border-top:1px solid #e8e4de; padding-top:16px; }
  .small-run h2 { font-size:11px; color:#8a8078; font-weight:600; margin:14px 0 8px; }
  .run { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
  .run svg { outline:1px solid #f0ece6; }
</style><div id="root"></div><script src="./sheet.js"></script>`);

const { chromium } = await import("playwright");
const browser = await chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 3 });
await page.goto("file://" + join(dir, "index.html"), { waitUntil: "load" });
await page.waitForFunction(() => typeof window.measure === "function" && document.querySelectorAll("svg").length > 20);

const rows = await page.evaluate(() => window.measure());
mkdirSync(join(ROOT, "docs"), { recursive: true });
await page.locator("#root").screenshot({ path: join(ROOT, "docs", "place-icons.png") });
await browser.close();
rmSync(dir, { recursive: true, force: true });

const problems = [];
const bespoke = rows.filter((r) => r.bespoke);
const fallback = rows.filter((r) => !r.bespoke);

console.log(`audit-place-icons: ${rows.length} places — ${bespoke.length} with their own mark, ${fallback.length} falling back\n`);

if (fallback.length) {
  console.log("── falling back to the category icon ──");
  console.log("   These places are indistinguishable from every other place in");
  console.log("   their category, wherever an icon is shown.");
  for (const r of fallback) console.log(`   · ${r.slug.padEnd(34)} ${r.category.padEnd(12)} ${r.nameAr}`);
  console.log("");
}

console.log("── the marks that exist ──");
console.log("slug                                nodes  tint   box (x,y,w,h)");
for (const r of bespoke) {
  const flags = [];
  // The frame is a 4px margin — PlaceIcon.tsx's own words — so 4..44 on both
  // axes. Not 6..42: that is where GROUND runs (M6 40h36), which is the width
  // of the baseline, not the width of the drawing. Checking against 6 flagged
  // five perfectly good marks, including kuwait-towers.
  if (r.x < 3.5 || r.y < 3.5 || r.x + r.w > 44.5 || r.y + r.h > 44.5)
    flags.push(`outside the 4–44 frame (${r.x},${r.y} → ${(r.x + r.w).toFixed(1)},${(r.y + r.h).toFixed(1)})`);
  // Past about nine elements a 48-grid mark stops resolving at 16px.
  if (r.nodes > 14) flags.push(`${r.nodes} nodes — likely a blob at 16px`);
  if (r.nodes < 3) flags.push(`only ${r.nodes} nodes — thinner than the family`);
  // A mark with no tint reads as a wireframe beside its neighbours.
  if (r.tinted === 0) flags.push("no volume tint");
  if (flags.length) problems.push(`${r.slug}: ${flags.join("; ")}`);
  console.log(
    `${r.slug.padEnd(34)} ${String(r.nodes).padStart(4)}  ${String(r.tinted).padStart(4)}   ` +
      `${r.x},${r.y} ${r.w}×${r.h}${flags.length ? "   ← " + flags.join("; ") : ""}`
  );
}

console.log("");
for (const p of problems) console.log(`  ⚠ ${p}`);
console.log(
  problems.length
    ? `\n${problems.length} thing(s) to look at. Contact sheet: docs/place-icons.png`
    : "\nEvery drawn mark sits in the frame and carries a tint. Contact sheet: docs/place-icons.png"
);
// Falling back is a coverage gap, not a defect — it is reported, never fatal.
process.exit(0);
