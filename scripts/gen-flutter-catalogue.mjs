#!/usr/bin/env node
/**
 * Generates the Flutter app's copy of the catalogue.  npm run flutter:catalogue
 *
 * The Flutter app is a second, native codebase with no way to import a
 * TypeScript module, so this is the one place its data is allowed to be
 * written out by hand — as generated output, not typed twice. It bundles the
 * real `places.ts` and `place-kit.ts` with esbuild, the same trick
 * `audit-places.mjs` and the MCP server use, so a generated file can never
 * disagree with what the web site ships. Re-run after any catalogue edit;
 * nothing here should ever be hand-edited afterward.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "flutter_app", "lib", "data");

const tmp = mkdtempSync(join(tmpdir(), "wain-flutter-catalogue-"));
const bundle = join(tmp, "places.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(join(ROOT, "src/lib/places.ts"))} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const { places, categories } = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });

/** Dart string literal, single-quoted, matching the app's own lint style. */
function dq(s) {
  if (s == null) return "null";
  return "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\$/g, "\\$") + "'";
}
function dlist(arr) {
  if (!arr || arr.length === 0) return "const []";
  return `const [${arr.map(dq).join(", ")}]`;
}
function dnum(n) {
  return n == null ? "null" : String(n);
}
function dbool(b) {
  return b ? "true" : "false";
}

const placeEntries = places
  .map((p) => {
    return `  Place(
    slug: ${dq(p.slug)},
    name: ${dq(p.name)},
    nameAr: ${dq(p.nameAr)},
    category: ${dq(p.category)},
    area: ${dq(p.area)},
    areaAr: ${dq(p.areaAr)},
    lat: ${dnum(p.lat)},
    lng: ${dnum(p.lng)},
    rating: ${dnum(p.rating)},
    priceLevel: ${dnum(p.priceLevel)},
    emoji: ${dq(p.emoji)},
    taglineAr: ${dq(p.taglineAr)},
    descriptionAr: ${dq(p.descriptionAr)},
    highlightsAr: ${dlist(p.highlightsAr)},
    bestTimeAr: ${dq(p.bestTimeAr)},
    setting: ${dq(p.setting)},
    seasonAr: ${dq(p.seasonAr)},
    tagsAr: ${dlist(p.tagsAr)},
    featured: ${dbool(!!p.featured)},
    shisha: ${p.shisha === undefined ? "null" : dbool(p.shisha)},
    summerOk: ${p.summerOk === undefined ? "null" : dbool(p.summerOk)},
  )`;
  })
  .join(",\n");

const categoryEntries = categories
  .map(
    (c) => `  Category(
    id: ${dq(c.id)},
    ar: ${dq(c.ar)},
    en: ${dq(c.en)},
    icon: ${dq(c.icon)},
    blurbAr: ${dq(c.blurbAr)},
  )`
  )
  .join(",\n");

const header = `// GENERATED — do not edit by hand.
// Produced by scripts/gen-flutter-catalogue.mjs from src/lib/places.ts and
// src/lib/place-kit.ts. Re-run \`npm run flutter:catalogue\` after any
// catalogue edit; a hand edit here would silently drift from the web site,
// the one failure mode this generator exists to make impossible.

import 'models.dart';
`;

mkdirSync(OUT_DIR, { recursive: true });

writeFileSync(
  join(OUT_DIR, "places.g.dart"),
  `${header}
final List<Place> kPlaces = [
${placeEntries}
];
`
);

writeFileSync(
  join(OUT_DIR, "categories.g.dart"),
  `${header}
final List<Category> kCategories = [
${categoryEntries}
];
`
);

console.log(`wrote ${places.length} places, ${categories.length} categories → flutter_app/lib/data/`);
