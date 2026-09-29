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
const hit = (slug, title) => ({ doc: { kind: "place", id: `place:${slug}`, title } });

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
  // The bug this test exists to pin: the count must appear exactly once,
  // agreeing with the noun — not a raw digit doubled in front of a second,
  // already-complete count phrase (the mistake caught before this ever ran).
  ok("the count appears exactly once", (r.spoken.match(/1/g) ?? []).length === 1, r.spoken);
  ok("singular noun form for one match", r.spoken.includes("مكان مطابق") && !r.spoken.includes("أماكن مطابقة"), r.spoken);
}

console.log("\n── formatShowPlaces: two matches ──");
{
  const hits = [hit("kuwait-towers", "أبراج الكويت"), hit("souq-al-mubarakiya", "سوق المباركية")];
  const r = formatShowPlaces("الكويت", hits, places);
  ok("both slugs present, in match order", r.slugs.length === 2 && r.slugs[0] === "kuwait-towers" && r.slugs[1] === "souq-al-mubarakiya");
  ok("plural noun form for more than one", r.spoken.includes("أماكن مطابقة"), r.spoken);
  ok("count appears exactly once", (r.spoken.match(/2/g) ?? []).length === 1, r.spoken);
}

console.log("\n── formatShowPlaces: non-place hits do not become slugs ──");
{
  // search() can return "action" docs (e.g. "كلّم شوق") alongside places —
  // formatShowPlaces filters to `kind === "place"` first, so a result made
  // only of non-place hits reads exactly like no match at all, correctly:
  // there is nothing here for a card to link to.
  const r = formatShowPlaces("q", [{ doc: { kind: "action", id: "action:call", title: "كلّم شوق" } }], places);
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
