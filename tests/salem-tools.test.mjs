#!/usr/bin/env node
/**
 * lib/salem-tools.ts in isolation, no browser, no socket, no React:
 *   node tests/salem-tools.test.mjs
 *
 * The pure half of شوق's `show_places`/`open_place` for /salem — see the
 * file's own header for why this split exists. Fixture places stand in for
 * `usePlaces()`'s live rows and a minimal hit list stands in for `search()`'s
 * real return, the same narrow shape `SalemSearchHit` names.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
const fails = [];
const ok = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); } };

const tmp = mkdtempSync(join(tmpdir(), "wain-salem-tools-"));
const entry = join(tmp, "entry.ts");
writeFileSync(entry, `export * from ${JSON.stringify(join(ROOT, "src/lib/salem-tools.ts"))};\n`);
const bundle = join(tmp, "entry.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(entry)} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const { formatShowPlaces, formatOpenPlace } = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });

const places = [
  { slug: "kuwait-towers", nameAr: "أبراج الكويت", category: "landmarks", areaAr: "الخليج العربي", taglineAr: "رمز الكويت الشهير" },
  { slug: "souq-al-mubarakiya", nameAr: "سوق المباركية", category: "shopping", areaAr: "مدينة الكويت", taglineAr: "سوق تراثي بقلب العاصمة" },
];
const hit = (slug, title, score = 1) => ({ doc: { kind: "place", id: `place:${slug}`, title }, score });

console.log("\n── formatShowPlaces: no matches ──");
{
  const r = formatShowPlaces("شي ما موجود", [], places);
  ok("no slugs", r.slugs.length === 0);
  ok("still names the query", r.spoken.includes("شي ما موجود"));
  ok("tells her not to go quiet", r.spoken.includes("لا تسكتين"));
}

console.log("\n── formatShowPlaces: one match ──");
{
  const r = formatShowPlaces("أبراج", [hit("kuwait-towers", "أبراج الكويت")], places);
  ok("one slug, matching the place", r.slugs.length === 1 && r.slugs[0] === "kuwait-towers");
  // The count agrees with its noun, the way the call says it (countAr with
  // MATCHING_PLACES) — and is never a raw digit in front of a phrase that
  // already carries one, which doubled it once.
  ok("one match reads «مكان واحد مطابق»", r.spoken.includes("مكان واحد مطابق") && !r.spoken.includes("أماكن مطابقة"), r.spoken);
  ok("with no Latin digit anywhere", !/[0-9]/.test(r.spoken), r.spoken);
}

console.log("\n── formatShowPlaces: two matches ──");
{
  const hits = [hit("kuwait-towers", "أبراج الكويت"), hit("souq-al-mubarakiya", "سوق المباركية")];
  const r = formatShowPlaces("الكويت", hits, places);
  ok("both slugs present, in match order", r.slugs.length === 2 && r.slugs[0] === "kuwait-towers" && r.slugs[1] === "souq-al-mubarakiya");
  // This pinned «أماكن مطابقة» for two, which is the wrong form: Arabic has
  // a dual, and the call already said «مكانين».
  ok("two matches take the dual, «مكانين مطابقين»", r.spoken.includes("مكانين مطابقين") && !r.spoken.includes("أماكن"), r.spoken);
  ok("and say both are on screen", r.spoken.includes("الحين قدام الزائر") && !r.spoken.includes(" منها"), r.spoken);
}

console.log("\n── formatShowPlaces: non-place hits do not become slugs ──");
{
  // search() can return "action" docs (e.g. "كلّم شوق") alongside places —
  // formatShowPlaces filters to `kind === "place"` first, so a result made
  // only of non-place hits reads exactly like no match at all, correctly:
  // there is nothing here for a card to link to.
  const r = formatShowPlaces("q", [{ doc: { kind: "action", id: "action:call", title: "كلّم شوق" }, score: 1 }], places);
  ok("an action hit does not become a slug", r.slugs.length === 0);
  ok("reads as no match, since nothing place-shaped was found", r.spoken.includes("ما لقيت ولا مكان"), r.spoken);
}

console.log("\n── formatShowPlaces: a hit not in the live rows is dropped ──");
{
  // A place approved since the last deploy is in `hits` (the index was built
  // from the live rows) but a stale one could not be — the defensive half of
  // the same "live rows, not the snapshot" rule WainAiCall.tsx documents.
  const r = formatShowPlaces("q", [hit("kuwait-towers", "أبراج الكويت"), hit("ghost-place", "شبح")], places);
  ok("only the real place's slug survives", r.slugs.length === 1 && r.slugs[0] === "kuwait-towers", JSON.stringify(r.slugs));
}

console.log("\n── formatShowPlaces: caps at 8 slugs ──");
{
  const many = Array.from({ length: 12 }, (_, i) => ({
    slug: `p${i}`, nameAr: `مكان ${i}`, category: "landmarks", areaAr: "", taglineAr: "",
  }));
  const hits = many.map((p) => hit(p.slug, p.nameAr));
  const r = formatShowPlaces("q", hits, many);
  ok("at most 8 slugs", r.slugs.length === 8, String(r.slugs.length));
  // She was told «12 أماكن مطابقة … الحين قدام الزائر» over eight cards.
  ok("twelve found reads «١٢ مكان مطابق», agreeing", r.spoken.includes("١٢ مكان مطابق"), r.spoken);
  ok("and says only the first eight are on screen", r.spoken.includes("أول ٨ أماكن منها"), r.spoken);
}

console.log("\n── formatShowPlaces: among equal matches, the better reviewed is named first ──");
{
  /* The figures are secondhand Google ratings (lib/place-reviews.ts): the zoo
     3.9 from 5,876 reviews, the science centre 4.4 from 5,186. They may decide
     between matches the search found equally good, and nothing else — so each
     case below is one of the things they must NOT do, beside the one they do. */
  const fam = [
    { slug: "kuwait-zoo", nameAr: "حديقة حيوان الكويت", category: "family", areaAr: "العمرية", taglineAr: "" },
    { slug: "kuwait-science-centre", nameAr: "المركز العلمي", category: "family", areaAr: "السالمية", taglineAr: "" },
    { slug: "the-avenues", nameAr: "الأفنيوز", category: "shopping", areaAr: "الري", taglineAr: "" },
  ];
  const near = formatShowPlaces("عيال", [hit("kuwait-zoo", "حديقة حيوان الكويت", 1), hit("kuwait-science-centre", "المركز العلمي", 0.95)], fam);
  ok("between two near-equal matches, the clearly better reviewed comes first",
    near.slugs[0] === "kuwait-science-centre", JSON.stringify(near.slugs));
  ok("and it is the first she is told to name",
    near.spoken.indexOf("المركز العلمي") > -1 && near.spoken.indexOf("المركز العلمي") < near.spoken.indexOf("حديقة حيوان الكويت"), near.spoken);
  ok("no rating, no count and no «Google» in what she is told",
    !/[0-9٠-٩][.٫][0-9٠-٩]|قوقل|جوجل|google|تقييم|مراجع/i.test(near.spoken), near.spoken);

  const far = formatShowPlaces("عيال", [hit("kuwait-zoo", "حديقة حيوان الكويت", 1), hit("kuwait-science-centre", "المركز العلمي", 0.6)], fam);
  ok("a clearly stronger match is never passed, however it is reviewed", far.slugs[0] === "kuwait-zoo", JSON.stringify(far.slugs));

  // The Avenues has no figure: it was not found, which says nothing about it.
  // The JACC is 4.7 from 4,550 — far enough above average that, were «no
  // figure» scored as average, it would pass; so this case can tell the two
  // rules apart, where the science centre (4.4, exactly average) could not.
  const unknown = formatShowPlaces("مكيف", [hit("the-avenues", "الأفنيوز", 1), hit("jacc", "مركز جابر الأحمد الثقافي", 0.99)], [
    ...fam,
    { slug: "jacc", nameAr: "مركز جابر الأحمد الثقافي", category: "culture", areaAr: "", taglineAr: "" },
  ]);
  ok("a place with no figure is not passed on a guess", unknown.slugs[0] === "the-avenues", JSON.stringify(unknown.slugs));

  // 4.5 from 18,656 against 4.4 from 26,500: under a tenth of a star apart.
  const noise = formatShowPlaces("الكويت", [hit("souq-al-mubarakiya", "سوق المباركية", 1), hit("kuwait-towers", "أبراج الكويت", 0.99)], places);
  ok("a difference under a tenth of a star changes nothing", noise.slugs[0] === "souq-al-mubarakiya", JSON.stringify(noise.slugs));
}

console.log("\n── formatOpenPlace: bad slug shape ──");
{
  const r = formatOpenPlace("../etc/passwd", places);
  ok("refused, not looked up", r.slug === null);
  ok("says nothing changed", r.spoken.includes("ما تغيّر شي"));
}

console.log("\n── formatOpenPlace: unknown slug ──");
{
  const r = formatOpenPlace("not-a-real-place", places);
  ok("no slug returned", r.slug === null);
  ok("names the slug that failed", r.spoken.includes("not-a-real-place"));
}

console.log("\n── formatOpenPlace: real slug ──");
{
  const r = formatOpenPlace("kuwait-towers", places);
  ok("slug returned as-is", r.slug === "kuwait-towers");
  ok("names the place in the spoken result", r.spoken.includes("أبراج الكويت"));
  ok("tells her not to go quiet", r.spoken.includes("لا تسكتين"));
}

console.log(fails.length ? `\n${fails.length} failed` : "\nكل شي تمام");
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
