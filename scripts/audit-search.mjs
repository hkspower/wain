#!/usr/bin/env node
/**
 * How good is the search?   npm run audit:search
 *
 * `tests/shouq-battery.test.mjs` asks 24 questions in the Kuwaiti a person
 * would actually use and checks the category that comes back. That is the
 * right test and it catches the thing that matters most — a lost synonym or a
 * changed weight turning شوق from useful into confidently wrong.
 *
 * What it cannot show is coverage: 24 questions over 36 places says nothing
 * about the other several hundred ways in. This measures those, exhaustively,
 * over every place and every word written about it.
 *
 * The distinction it exists to draw is **the engine failing** versus **the
 * catalogue being empty**. A query for «صيدلية» returns nothing, and that is
 * correct: there is no pharmacy in the catalogue, and no amount of tuning
 * invents one. Reporting that as a search defect would send someone to fix
 * the wrong thing.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const tmp = mkdtempSync(join(tmpdir(), "wain-search-"));
const entry = join(tmp, "entry.ts");
writeFileSync(
  entry,
  `export * from ${JSON.stringify(join(ROOT, "src/lib/search.ts"))};\n` +
    `export { places } from ${JSON.stringify(join(ROOT, "src/lib/places.ts"))};\n`
);
const bundle = join(tmp, "entry.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(entry)} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const { buildIndex, search, places } = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });

const errors = [];
const notes = [];
const index = buildIndex(places);
const rank = (q, slug, limit = 40) => {
  const hits = search(q, index, { limit });
  const i = hits.findIndex((h) => h.doc.id === `place:${slug}`);
  return i < 0 ? null : i + 1;
};
const pc = (n, d) => (d === 0 ? 100 : (n / d) * 100);
const line = (label, n, d, floor) => {
  const p = pc(n, d);
  const bad = p < floor;
  if (bad) errors.push(`${label}: ${p.toFixed(0)}% (${n}/${d}), below the ${floor}% floor`);
  console.log(`  ${bad ? "✗" : "✓"} ${label.padEnd(46)} ${n}/${d}  ${p.toFixed(0)}%`);
  return p;
};

console.log(`audit-search: ${places.length} places\n`);

console.log("── a place, searched by its own name ──");
{
  let found = 0, first = 0;
  const lost = [];
  for (const p of places) {
    const r = rank(p.nameAr, p.slug);
    if (r === null) lost.push(p.nameAr);
    else { found++; if (r === 1) first++; }
  }
  line("found at all", found, places.length, 100);
  // Ranked first is the one that decides what شوق says out loud: she reads the
  // top hit, so second place is a wrong answer delivered confidently.
  line("ranked first", first, places.length, 100);
  if (lost.length) notes.push(`not found by name: ${lost.join(", ")}`);
}

console.log("\n── one letter dropped from inside a word ──");
{
  // Inside a WORD, never the space. An earlier version of this cut at the
  // midpoint of the whole name, which for «سوق شرق» deletes the space and
  // asks for «سوقشرق» — not a typo, a different word. It reported 78% and the
  // real figure was 100%; the checker was broken, not the search.
  let ok = 0;
  const lost = [];
  for (const p of places) {
    const words = p.nameAr.split(" ");
    const wi = words.findIndex((w) => w.length >= 4);
    if (wi < 0) { ok++; continue; }
    const w = words[wi];
    const q = [...words.slice(0, wi), w.slice(0, 2) + w.slice(3), ...words.slice(wi + 1)].join(" ");
    if (rank(q, p.slug) !== null) ok++;
    else lost.push(`${p.nameAr} → ${q}`);
  }
  line("still found after a typo", ok, places.length, 90);
  for (const l of lost.slice(0, 5)) notes.push(`typo lost it: ${l}`);
}

console.log("\n── everything written about a place can find that place ──");
{
  let tagOk = 0, tagTot = 0, hiOk = 0, hiTot = 0, areaOk = 0, areaTot = 0;
  const unreachable = [];
  for (const p of places) {
    for (const t of p.tagsAr) {
      tagTot++;
      if (rank(t, p.slug) !== null) tagOk++;
      else unreachable.push(`${p.nameAr} ← «${t}»`);
    }
    for (const h of p.highlightsAr) {
      hiTot++;
      if (rank(h, p.slug) !== null) hiOk++;
    }
    areaTot++;
    if (rank(p.areaAr, p.slug) !== null) areaOk++;
  }
  line("its tags reach it", tagOk, tagTot, 100);
  line("its highlights reach it", hiOk, hiTot, 95);
  line("its area reaches it", areaOk, areaTot, 100);
  for (const u of unreachable.slice(0, 6)) notes.push(`unreachable: ${u}`);
}

console.log("\n── speed ──");
{
  const qs = places.map((p) => p.nameAr).concat(["قهوة", "بحر", "مطعم عايلة", "وين أطلع", "متحف قديم"]);
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) for (const q of qs) search(q, index, { limit: 20 });
  const per = (performance.now() - t0) / (10 * qs.length);
  const t1 = performance.now();
  buildIndex(places);
  const build = performance.now() - t1;
  console.log(`  ${per.toFixed(3)} ms per query, ${build.toFixed(1)} ms to build the index`);
  // The index is built on the client, on every page that searches, so the
  // build cost is paid before the first keystroke.
  if (per > 5) errors.push(`a query takes ${per.toFixed(1)}ms`);
  if (build > 250) errors.push(`the index takes ${build.toFixed(0)}ms to build`);
}

console.log("\n── what the catalogue does not cover ──");
{
  // Everyday things a Kuwaiti visitor might plausibly type. An empty result
  // here is a CONTENT gap, not a search one — which is exactly why it is
  // reported separately and never fails the run.
  const PLAUSIBLE = ["شاورما","بيتزا","سينما","مقهى","جيم","صيدلية","مستشفى","بنك","حلويات",
    "ايس كريم","سوشي","برجر","دجاج","عصير","فطور","سهرة","رومانسي","هدوء","واي فاي","مواقف",
    "عوائل","شباب","رخيص","فخم","بحر","صحراء","تخييم","مشي","رياضة","أطفال","كتب","ملابس",
    "عطور","ذهب","موبايل"];
  const empty = PLAUSIBLE.filter((q) => search(q, index, { limit: 5 }).length === 0);
  console.log(`  ${PLAUSIBLE.length - empty.length}/${PLAUSIBLE.length} answered`);
  if (empty.length) {
    console.log(`  nothing in the catalogue for: ${empty.join(" · ")}`);
    console.log(`  (a content gap — the engine cannot invent a place that is not there)`);
  }
}

console.log("");
for (const n of notes.slice(0, 10)) console.log(`  ⚠ ${n}`);
for (const e of errors) console.log(`  ✗ ${e}`);
console.log(`\n${errors.length} error${errors.length === 1 ? "" : "s"}, ${notes.length} note${notes.length === 1 ? "" : "s"}`);
process.exit(errors.length ? 1 : 0);
