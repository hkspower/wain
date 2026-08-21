#!/usr/bin/env node
/**
 * Checks the place catalogue against itself.  npm run audit:places
 *
 * No geocoder is reachable from a build box, so none of this proves a place is
 * where the data says it is. What it does prove is that the data does not
 * contradict itself — and that is where the errors actually were. Two places
 * sharing an area sat 5.8km apart, which meant the coordinate or the area
 * label was wrong on at least one of them; nothing in the app would ever have
 * said so.
 *
 * Errors fail the run. Warnings are printed and do not, because they are
 * judgement calls about the shape of the catalogue rather than defects.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Load the real module rather than parsing it, so this can never disagree
 *  with what the app actually ships. */
const tmp = mkdtempSync(join(tmpdir(), "wain-audit-"));
const bundle = join(tmp, "places.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(join(ROOT, "src/lib/places.ts"))} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const { places, categories } = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const R = 6371;
const km = (a, b) => {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/* ── identity ─────────────────────────────────────────────────────────── */
const slugs = new Set();
for (const p of places) {
  if (!/^[a-z0-9-]+$/.test(p.slug)) err(`slug is not URL-safe: ${p.slug}`);
  if (slugs.has(p.slug)) err(`duplicate slug: ${p.slug}`);
  slugs.add(p.slug);
}
const arNames = new Map();
for (const p of places) arNames.set(p.nameAr, [...(arNames.get(p.nameAr) ?? []), p.slug]);
for (const [n, s] of arNames) if (s.length > 1) err(`two places share the Arabic name «${n}»: ${s.join(", ")}`);

/* ── geography, checked against itself ───────────────────────────────── */
const KUWAIT = { south: 28.5, north: 30.2, west: 46.5, east: 48.6 };
for (const p of places) {
  if (p.lat < KUWAIT.south || p.lat > KUWAIT.north || p.lng < KUWAIT.west || p.lng > KUWAIT.east)
    err(`${p.nameAr} is outside Kuwait: ${p.lat},${p.lng}`);
  const decimals = Math.max(
    (String(p.lat).split(".")[1] ?? "").length,
    (String(p.lng).split(".")[1] ?? "").length
  );
  if (decimals < 4) warn(`${p.nameAr} has only ${decimals} decimal places (~±${decimals <= 2 ? "1km" : "100m"})`);
}

// An area is a neighbourhood, not a governorate. Places sharing one should be
// within a few kilometres; further apart means the coordinate or the label is
// wrong on at least one of them.
// 5km, because حولي at 5.8km was the case this check exists for and a 6km
// threshold quietly let it through. An area here is a neighbourhood, not a
// governorate: Hawally district is about 3km across, so two places 5.8km apart
// cannot both sit in it.
const AREA_SPREAD_KM = 5;
const byArea = new Map();
for (const p of places) byArea.set(p.areaAr, [...(byArea.get(p.areaAr) ?? []), p]);
for (const [area, list] of byArea) {
  if (list.length < 2) continue;
  let worst = null;
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const d = km(list[i], list[j]);
      if (!worst || d > worst.d) worst = { d, a: list[i], b: list[j] };
    }
  if (worst.d > AREA_SPREAD_KM)
    err(
      `«${area}» spans ${worst.d.toFixed(1)}km — ${worst.a.nameAr} and ${worst.b.nameAr} ` +
        `cannot both be in it as placed`
    );
}

// Two places at the same spot are almost always a copy-paste.
for (let i = 0; i < places.length; i++)
  for (let j = i + 1; j < places.length; j++) {
    const d = km(places[i], places[j]) * 1000;
    if (d < 60) err(`${places[i].nameAr} and ${places[j].nameAr} are ${Math.round(d)}m apart — likely copied`);
  }

/* ── the fields that drive search and شوق ────────────────────────────── */
for (const p of places) {
  if (!["indoor", "outdoor", "mixed"].includes(p.setting)) err(`${p.nameAr}: bad setting "${p.setting}"`);
  if (!p.seasonAr?.trim()) err(`${p.nameAr}: no seasonAr — شوق cannot say when to go`);
  if (!p.bestTimeAr?.trim()) err(`${p.nameAr}: no bestTimeAr`);
  if (!p.taglineAr?.trim()) err(`${p.nameAr}: no taglineAr — شوق uses it as the reason`);
  if (p.highlightsAr.length < 3) err(`${p.nameAr}: only ${p.highlightsAr.length} highlights`);
  if (p.tagsAr.length < 4) err(`${p.nameAr}: only ${p.tagsAr.length} tags — too thin to be found by anything but its name`);
  if (p.rating < 0 || p.rating > 5) err(`${p.nameAr}: rating out of range`);
  if (![1, 2, 3].includes(p.priceLevel)) err(`${p.nameAr}: bad priceLevel`);
  // The season text and the setting must not contradict each other.
  if (p.setting === "indoor" && /^من (أكتوبر|نوفمبر)/.test(p.seasonAr))
    warn(`${p.nameAr} is indoor but its season reads like an outdoor one: "${p.seasonAr}"`);
}

/* ── tag vocabulary ──────────────────────────────────────────────────── */
const norm = (s) => s.replace(/[ً-ْ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
const tagUse = new Map();
for (const p of places) {
  const seen = new Set();
  for (const t of p.tagsAr) {
    if (seen.has(t)) err(`${p.nameAr}: duplicate tag «${t}»`);
    seen.add(t);
    if (t !== t.trim()) err(`${p.nameAr}: tag «${t}» has stray whitespace`);
    tagUse.set(t, (tagUse.get(t) ?? 0) + 1);
  }
}
const collide = new Map();
for (const t of tagUse.keys()) collide.set(norm(t), [...(collide.get(norm(t)) ?? []), t]);
for (const [, forms] of collide)
  if (forms.length > 1) err(`tags differ only by spelling and will not match each other: ${forms.join(" / ")}`);

/* ── the shape of the catalogue ──────────────────────────────────────── */
for (const c of categories) {
  const n = places.filter((p) => p.category === c.id).length;
  if (n === 0) err(`category «${c.ar}» has no places but is offered as a filter`);
  else if (n < 3) warn(`category «${c.ar}» has only ${n} place${n === 1 ? "" : "s"}`);
}
const featured = places.filter((p) => p.featured).length;
if (featured < 3) err(`only ${featured} featured places — the home page and the offline shell both need them`);

/* ── report ──────────────────────────────────────────────────────────── */
console.log(`audit-places: ${places.length} places, ${tagUse.size} distinct tags\n`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);
if (!errors.length && !warnings.length) console.log("  no problems found");
console.log(
  `\n${errors.length} error${errors.length === 1 ? "" : "s"}, ` +
    `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
);
process.exit(errors.length ? 1 : 0);
