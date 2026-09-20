#!/usr/bin/env node
/**
 * Holds `areas.ts` and `places.ts` together.  npm run audit:areas
 *
 * The two are joined by a STRING — `Area.ar` against `Place.areaAr` — and a
 * string join between two hand-edited files is the exact shape every drift
 * this repository has been bitten by took: the n8n voice table, the widget
 * version, `contain-intrinsic-size`, `PlaceArt`'s safe box. Nothing breaks
 * loudly when it goes wrong. An area whose name no place carries renders a
 * card that opens onto an empty list; a place whose area has no entry is
 * simply unreachable from /areas, and no page anywhere says so.
 *
 * So this loads BOTH real modules — bundled, never parsed, so it cannot
 * disagree with what the app ships — and fails on any name that is in one and
 * not the other.
 *
 * It also checks the two claims `areas.ts` makes in prose, because a comment
 * that is not checked is a comment that will be wrong:
 *   - every `hero` is a real place AND is in the area that names it, which is
 *     what stops an area wearing another area's drawing;
 *   - `AREAS` is ordered by how much of the catalogue each area holds, which
 *     is the file's stated substitute for «famous».
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const tmp = mkdtempSync(join(tmpdir(), "wain-areas-"));
const load = async (rel, out) => {
  const bundle = join(tmp, out);
  execSync(
    `npx -y esbuild ${JSON.stringify(join(ROOT, rel))} --bundle --format=esm ` +
      `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
    { cwd: ROOT, stdio: "pipe" }
  );
  return import(pathToFileURL(bundle).href);
};
const { AREAS } = await load("src/lib/areas.ts", "areas.mjs");
const { places } = await load("src/lib/places.ts", "places.mjs");
rmSync(tmp, { recursive: true, force: true });

const errors = [];
const err = (m) => errors.push(m);

// ---- the join, both directions ---------------------------------------------
const counts = new Map();
for (const p of places) counts.set(p.areaAr, (counts.get(p.areaAr) ?? 0) + 1);

for (const [areaAr, n] of counts) {
  if (!AREAS.some((a) => a.ar === areaAr)) {
    err(`places.ts has «${areaAr}» (${n} place${n === 1 ? "" : "s"}) and areas.ts has no entry for it — those places are unreachable from /areas`);
  }
}
for (const a of AREAS) {
  const n = counts.get(a.ar) ?? 0;
  if (n === 0) {
    err(`areas.ts has «${a.ar}» (${a.id}) and no place carries that areaAr — the card would open onto an empty list`);
  }
}

// ---- ids --------------------------------------------------------------------
const seen = new Set();
for (const a of AREAS) {
  if (seen.has(a.id)) err(`two areas share the id «${a.id}»`);
  seen.add(a.id);
  // It goes in `?area=`, so it has to survive a URL and the WAF's own
  // character class — see CLAUDE.md on `places/[slug]/` and brackets.
  if (!/^[a-z0-9-]+$/.test(a.id)) err(`area id «${a.id}» is not URL-safe [a-z0-9-]`);
  if (!a.ar.trim()) err(`area «${a.id}» has no Arabic name`);
  if (!a.en.trim()) err(`area «${a.id}» has no English name`);
  if (!a.blurbAr.trim()) err(`area «${a.id}» has no blurb`);
}

// ---- the hero is IN the area ------------------------------------------------
for (const a of AREAS) {
  const hero = places.find((p) => p.slug === a.hero);
  if (!hero) {
    err(`area «${a.id}» names hero «${a.hero}», which is not a place`);
    continue;
  }
  if (hero.areaAr !== a.ar) {
    err(`area «${a.id}» (${a.ar}) wears «${a.hero}»'s drawing, but that place is in ${hero.areaAr} — a card must not show another area's picture`);
  }
}

// ---- the order areas.ts claims ---------------------------------------------
const order = AREAS.map((a) => counts.get(a.ar) ?? 0);
for (let i = 1; i < order.length; i++) {
  if (order[i] > order[i - 1]) {
    err(`AREAS is not ordered by share of the catalogue: «${AREAS[i].ar}» holds ${order[i]} and sits after «${AREAS[i - 1].ar}», which holds ${order[i - 1]}`);
  }
}

// ---- say what was checked ---------------------------------------------------
const covered = AREAS.reduce((n, a) => n + (counts.get(a.ar) ?? 0), 0);
console.log(`audit-areas: ${AREAS.length} areas, ${covered} of ${places.length} places placed`);
for (const e of errors) console.log(`  ✗ ${e}`);
console.log(`\n${errors.length} errors`);
process.exit(errors.length ? 1 : 0);
