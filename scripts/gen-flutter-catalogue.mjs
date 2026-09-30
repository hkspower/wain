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
 *
 * `--check` renders and diffs without writing (run by audit:flutter).
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
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

/** A TypeScript value as a Dart literal, for the optional business fields. */
function opt(name, v, kind) {
  if (v === undefined || v === null) return "";
  switch (kind) {
    case "str": return `\n    ${name}: ${dq(v)},`;
    case "num": return `\n    ${name}: ${dnum(v)},`;
    case "bool": return `\n    ${name}: ${dbool(v)},`;
    case "list": return v.length ? `\n    ${name}: ${dlist(v)},` : "";
    default: throw new Error(`opt: unknown kind ${kind}`);
  }
}
function menu(items) {
  if (!items || !items.length) return "";
  const rows = items.map(
    (m) => `MenuItem(id: ${dq(m.id)}, nameAr: ${dq(m.nameAr)}, priceFils: ${m.priceFils}` +
      `${m.noteAr ? `, noteAr: ${dq(m.noteAr)}` : ""}${m.soldOut ? ", soldOut: true" : ""})`
  );
  return `\n    menuAr: const [${rows.join(", ")}],`;
}

// Every field of the TypeScript `Place` is named here. If places.ts grows one
// that this list does not know, the run stops instead of quietly shipping a
// native app that cannot see it.
const KNOWN = new Set([
  "slug","name","nameAr","category","area","areaAr","lat","lng","coordsUnverified","rating","priceLevel",
  "emoji","taglineAr","descriptionAr","highlightsAr","bestTimeAr","setting","seasonAr","summerOk","shisha",
  "tagsAr","featured","logoUrl","bioAr","imageUrls","phone","instagram","website","productsAr","menuAr",
  "acceptsOrders","orderNoteAr","orderPrepMinutes","salonKind","takesQueue","queueServiceMinutes",
]);
for (const p of places)
  for (const k of Object.keys(p))
    if (!KNOWN.has(k)) throw new Error(`places.ts: ${p.slug} has field «${k}» that gen-flutter-catalogue.mjs does not know — add it to models.dart and here`);

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
    summerOk: ${p.summerOk === undefined ? "null" : dbool(p.summerOk)},${
      p.coordsUnverified ? "\n    coordsUnverified: true," : ""
    }${opt("logoUrl", p.logoUrl, "str")}${opt("bioAr", p.bioAr, "str")}${opt("imageUrls", p.imageUrls, "list")}${opt("phone", p.phone, "str")}${opt("instagram", p.instagram, "str")}${opt("website", p.website, "str")}${opt("productsAr", p.productsAr, "list")}${menu(p.menuAr)}${opt("acceptsOrdersFlag", p.acceptsOrders, "bool")}${opt("orderNoteAr", p.orderNoteAr, "str")}${opt("orderPrepMinutes", p.orderPrepMinutes, "num")}${opt("salonKind", p.salonKind, "str")}${opt("takesQueueFlag", p.takesQueue, "bool")}${opt("queueServiceMinutes", p.queueServiceMinutes, "num")}
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

const outputs = [
  ["places.g.dart", `${header}
final List<Place> kPlaces = [
${placeEntries}
];
`],
  ["categories.g.dart", `${header}
final List<Category> kCategories = [
${categoryEntries}
];
`],
];

if (process.argv.includes("--check")) {
  const stale = outputs.filter(([name, text]) => {
    const p = join(OUT_DIR, name);
    return !existsSync(p) || readFileSync(p, "utf8") !== text;
  });
  if (stale.length) {
    console.error(`flutter catalogue is stale (${stale.map(([n]) => n).join(", ")}) — run \`npm run flutter:catalogue\``);
    process.exit(1);
  }
  console.log(`flutter catalogue current (${places.length} places, ${categories.length} categories)`);
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, text] of outputs) writeFileSync(join(OUT_DIR, name), text);
  console.log(`wrote ${places.length} places, ${categories.length} categories → flutter_app/lib/data/`);
}
