#!/usr/bin/env node
/**
 * The Google figures may order and may not speak.   npm run audit:reviews
 *
 * `src/lib/place-reviews.ts` holds ratings gathered secondhand — a search
 * engine's summary of a page quoting Google, on no known date. The owner's
 * decision (1 October) was that such a number may decide which of two equally
 * good matches سالم names first, and may not be said, shown or quoted until
 * somebody has opened that place on Google Maps and checked it. Nothing in
 * the type system stops a component importing the table and printing a star
 * rating from it, so this does:
 *
 *  - only the code that orders an answer may import it (and tests and
 *    scripts) — `answer-order.ts` since 3 October, when /search and سالم
 *    were made to order the same question the same way; before that it was
 *    `salem-tools.ts`, which is why only the chat used to apply it;
 *  - it imports nothing itself — it is reached from the /salem chat, and the
 *    catalogue must not follow it into that bundle;
 *  - every slug is a place that exists, so a renamed place does not silently
 *    lose its figure and a deleted one does not keep a ghost;
 *  - every figure is a plausible one, and none claims to be checked without
 *    saying when.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = "src/lib/place-reviews.ts";
/** Who may read the figures: the code that orders an answer. */
const ALLOWED = new Set(["src/lib/answer-order.ts"]);

const tmp = mkdtempSync(join(tmpdir(), "wain-reviews-"));
const entry = join(tmp, "entry.ts");
writeFileSync(
  entry,
  `export * from ${JSON.stringify(join(ROOT, MODULE))};\n` +
    `export { places } from ${JSON.stringify(join(ROOT, "src/lib/places.ts"))};\n`
);
const bundle = join(tmp, "entry.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(entry)} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const { GOOGLE_FIGURES, places } = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });

const errors = [];
const slugs = new Set(places.map((p) => p.slug));
const figures = Object.entries(GOOGLE_FIGURES);

for (const [slug, f] of figures) {
  if (!slugs.has(slug)) errors.push(`«${slug}» has a figure and is not a place in the catalogue`);
  if (!(f.rating >= 1 && f.rating <= 5) || Math.round(f.rating * 10) !== f.rating * 10) {
    errors.push(`«${slug}»: rating ${f.rating} is not a one-decimal number from 1 to 5`);
  }
  if (f.count !== null && !(Number.isInteger(f.count) && f.count > 0)) errors.push(`«${slug}»: count ${f.count}`);
  if (f.verified !== false && !/^\d{4}-\d{2}-\d{2}$/.test(String(f.checkedOn ?? ""))) {
    errors.push(`«${slug}» says it was checked and does not say when`);
  }
}

const own = readFileSync(join(ROOT, MODULE), "utf8");
if (/^\s*import\s/m.test(own)) errors.push(`${MODULE} imports something; it must stand alone`);

const importers = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|mjs|js)$/.test(name) && p !== join(ROOT, MODULE)) {
      if (/["']@\/lib\/place-reviews["']|place-reviews(\.ts)?["']/.test(readFileSync(p, "utf8"))) {
        importers.push(relative(ROOT, p));
      }
    }
  }
};
walk(join(ROOT, "src"));
for (const f of importers) {
  if (!ALLOWED.has(f)) errors.push(`${f} reads the Google figures; only ${[...ALLOWED].join(", ")} may`);
}

const withCount = figures.filter(([, f]) => f.count !== null).length;
console.log(`audit-reviews: ${figures.length} of ${places.length} places have a figure, ${withCount} with a count`);
console.log(`  checked on Google Maps: ${figures.filter(([, f]) => f.verified !== false).length}`);
console.log(`  read by: ${importers.join(", ") || "nothing"}`);
for (const e of errors) console.log(`  ✗ ${e}`);
console.log(`\n${errors.length} error${errors.length === 1 ? "" : "s"}`);
process.exit(errors.length ? 1 : 0);
