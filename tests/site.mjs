// The website, checked against the game it describes.
//
//   npm run test:site       (no browser, no dev server)
//
// A bilingual marketing page fails in two ways that nobody notices for
// months. The first is a half-translated string — an `ar` that is
// actually English, or empty, or the same words as the `en` beside it —
// which renders perfectly and is only wrong to a reader of the other
// language. The second is drift: the page says fifteen cars and the
// showroom ships sixteen, or a district gets renamed in world.ts and the
// site keeps the old name. Both are checked here.
//
// The cars, rivals and race lengths are not checked for drift at all,
// because they cannot drift: src/app/game/page.tsx imports the game's
// own arrays. What IS checked is everything the page had to copy.

import { readFileSync, existsSync } from "node:fs";
import {
  CTA, DISTRICTS, FAQ, FLEET, GALLERY, HOWTO, INTRO, LABELS, LENGTHS,
  NAME, PILLARS, RIVALS_SECTION, ROAD, ROAD_NAMES, TAGLINE,
} from "../src/lib/gameSite.ts";
import { CARS } from "../src/game/mods.ts";
import { RIVALS } from "../src/game/rivals.ts";
import { RACE_DISTANCES } from "../src/game/distances.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c; };
// A section's verdict is about THAT section. Printing `fail.length ?
// "FAIL" : "ok"` reads the running total, so the first failure anywhere
// stamps FAIL on every heading after it — including the checks that
// passed. Ask what this section added.
let mark = 0;
const verdict = () => {
  const added = fail.length - mark;
  mark = fail.length;
  return added ? `FAIL (${added})` : "ok";
};
const AR = /[؀-ۿ]/;
const LAT = /[A-Za-z]/;

// --- 1. Every pair says something, in both languages ------------------
//
// Walks the whole content module rather than a hand-written list of the
// exports, so a section added later is covered without anyone
// remembering to add it here.
const pairs = [];
const walk = (v, path) => {
  if (!v || typeof v !== "object") return;
  if (typeof v.en === "string" && typeof v.ar === "string") {
    pairs.push({ path, ...v });
    return;
  }
  for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
};
for (const [name, mod] of Object.entries({
  NAME, TAGLINE, INTRO, GALLERY, PILLARS, ROAD, DISTRICTS, ROAD_NAMES,
  FLEET, RIVALS_SECTION, LENGTHS, HOWTO, FAQ, CTA, LABELS,
})) walk(mod, name);

check(pairs.length > 60, `only ${pairs.length} bilingual pairs found — the walk is not reaching the content`);
for (const p of pairs) {
  if (!check(p.en.trim().length > 0, `${p.path}: the English half is empty`)) continue;
  if (!check(p.ar.trim().length > 0, `${p.path}: the Arabic half is empty`)) continue;
  // The Arabic half must be Arabic. An untranslated string is the most
  // common way a bilingual page rots, and it looks completely fine.
  check(AR.test(p.ar), `${p.path}: the Arabic half has no Arabic in it — "${p.ar.slice(0, 40)}"`);
  check(p.en !== p.ar, `${p.path}: both halves are the same string`);
  // The English half must not be Arabic — the pair being the wrong way
  // round renders as a page in one language with a switch that does
  // nothing.
  check(!AR.test(p.en) || LAT.test(p.en), `${p.path}: the English half is Arabic`);
}
console.log(`${pairs.length} bilingual pairs, all present  ${verdict()}`);

// --- 2. Every image the page names is on disk -------------------------
//
// Both widths, because the srcset names both and a missing 800 is
// invisible on a desktop and the only file a phone asks for.
let shots = 0;
for (const g of GALLERY) {
  const wide = `public/game/${g.src}`;
  const narrow = `public/game/${g.src.replace(".webp", "@800.webp")}`;
  check(existsSync(wide), `missing gallery image ${wide} — run: npm run shots && npm run site:images`);
  check(existsSync(narrow), `missing narrow variant ${narrow} — run: npm run site:images`);
  shots++;
}
for (const c of CARS) {
  check(existsSync(`public/cars/${c.id}.webp`), `missing car image public/cars/${c.id}.webp`);
}
console.log(`${shots} gallery shots x2 widths, ${CARS.length} car portraits  ${verdict()}`);

// --- 3. The gallery and the image builder name the same shots ---------
{
  const build = readFileSync("scripts/build-site-images.mjs", "utf8");
  const m = build.match(/const SHOTS = \[([\s\S]*?)\];/);
  if (check(!!m, "could not read SHOTS from scripts/build-site-images.mjs")) {
    const built = new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    for (const g of GALLERY) {
      const name = g.src.replace(".webp", "");
      check(built.has(name), `the page shows ${name} but the image builder never makes it`);
    }
    for (const name of built) {
      check(GALLERY.some((g) => g.src === `${name}.webp`), `the builder makes ${name} and nothing shows it`);
    }
  }
}

// --- 4. The districts and roads still match the world -----------------
//
// These two lists are the only game data the page copies — world.ts
// cannot be imported here, because it pulls in three.js to build the
// world and a node test has no business loading a renderer. So the
// source is read and the literal is extracted. If that extraction ever
// comes back empty the test FAILS rather than passing vacuously, which
// is the failure mode a regex check like this actually has.
const world = readFileSync("src/game/world.ts", "utf8");
const rows = (name) => {
  const i = world.indexOf(`export const ${name} = [`);
  if (i < 0) return null;
  const j = world.indexOf("\n];", i);
  if (j < 0) return null;
  return [...world.slice(i, j).matchAll(/name:\s*"([^"]+)",\s*arabic:\s*"([^"]+)"/g)]
    .map((m) => ({ en: m[1], ar: m[2] }));
};
for (const [name, mine] of [["AREAS", DISTRICTS], ["ROADS", ROAD_NAMES]]) {
  const theirs = rows(name);
  if (!check(theirs && theirs.length > 0, `could not read ${name} out of src/game/world.ts`)) continue;
  check(
    theirs.length === mine.length,
    `${name}: the world has ${theirs.length} and the site lists ${mine.length}`
  );
  for (let i = 0; i < Math.min(theirs.length, mine.length); i++) {
    check(
      theirs[i].en === mine[i].en && theirs[i].ar === mine[i].ar,
      `${name}[${i}]: the world says "${theirs[i].en}" / "${theirs[i].ar}", the site says "${mine[i].en}" / "${mine[i].ar}"`
    );
  }
  console.log(`${name}: ${theirs?.length ?? 0} entries match the world  ${verdict()}`);
}

// --- 5. Every race length is explained in both languages --------------
for (const d of RACE_DISTANCES) {
  check(!!d.blurbAr && AR.test(d.blurbAr), `race distance "${d.id}" has no Arabic explanation`);
  check(d.blurb !== d.blurbAr, `race distance "${d.id}": both explanations are the same string`);
}
console.log(`${RACE_DISTANCES.length} race lengths explained in both  ${verdict()}`);

// --- 6. The page's own claims about the game --------------------------
//
// Numbers stated in prose are the ones that go stale fastest, because
// nothing links them to the thing they count.
check(
  INTRO.en.includes("8.5") && INTRO.ar.includes("٨٫٥"),
  "the intro quotes a lap length in only one of the two number systems"
);
// The one count the prose still states out loud. Every other figure on
// the page is read from the game at render time; this one is a word in
// two languages, so it needs a guard. The fleet used to state a count
// too — it said fifteen, the showroom held sixteen, and the number came
// from a regex that had folded two cars into one.
check(
  RIVALS.length === 8,
  `the roster copy says "Eight names" and there are ${RIVALS.length} rivals`
);
check(FLEET.classes.supercar && FLEET.classes.sport && FLEET.classes.normal,
  "a car class on the showroom has no label");
for (const c of CARS) {
  check(!!FLEET.classes[c.cls], `car ${c.id} is class "${c.cls}" and the site has no label for it`);
}

console.log(
  fail.length
    ? `\nFAILURES:\n - ${fail.join("\n - ")}`
    : "\n=== THE SITE AGREES WITH THE GAME ==="
);
process.exit(fail.length ? 1 : 0);
