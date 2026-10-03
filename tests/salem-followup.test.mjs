#!/usr/bin/env node
/**
 * lib/salem-followup.ts against the real catalogue and the real search:
 *   node tests/salem-followup.test.mjs
 *
 * What a short reply to سالم means. The reading is checked on its own (which
 * kind of follow-up), and then end to end the way SalemChat runs it: search,
 * answerOrder, and the narrowed question asked again — so «أرخص» is proved to
 * change the answer, not merely to be recognised.
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

const tmp = mkdtempSync(join(tmpdir(), "wain-salem-followup-"));
const entry = join(tmp, "entry.ts");
const at = (f) => JSON.stringify(join(ROOT, "src/lib", f));
writeFileSync(
  entry,
  `export * from ${at("salem-followup.ts")};\n` +
    `export { places } from ${at("places.ts")};\n` +
    `export { buildIndex, search } from ${at("search.ts")};\n` +
    `export { answerOrder } from ${at("answer-order.ts")};\n`
);
const bundle = join(tmp, "entry.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(entry)} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const { readFollowUp, nextPlaces, followUpChips, places, buildIndex, search, answerOrder } = await import(
  pathToFileURL(bundle).href
);
rmSync(tmp, { recursive: true, force: true });

const index = buildIndex(places);
const bySlug = new Map(places.map((p) => [p.slug, p]));
const AUGUST_NOON = { month: 7, hour: 13 };
const JANUARY_EVENING = { month: 0, hour: 20 };

/** What SalemChat does for a question: the ordered places, as slugs. */
function ask(q, clock = JANUARY_EVENING) {
  const { hits } = answerOrder(q, search(q, index, { limit: 40 }), index, places, clock);
  return hits.filter((h) => h.doc.kind === "place").map((h) => h.doc.id.replace(/^place:/, ""));
}
function context(q, clock) {
  const ranked = ask(q, clock);
  const shown = ranked.slice(0, 8);
  return { query: q, ranked, seen: shown, shown };
}

console.log("\n── nothing remembered: everything is a new question ──");
ok("«أرخص» with no last answer is asked as it is", readFollowUp("أرخص", null).kind === "new");
ok("«غيره» with no last answer is asked as it is", readFollowUp("غيره", null).kind === "new");

const coffee = context("مطعم", JANUARY_EVENING);
ok("«مطعم» finds more than eight places, so «غيره» has something to show", coffee.ranked.length > 8, `${coffee.ranked.length}`);

console.log("\n── a short reply is read against the last answer ──");
const cases = [
  ["أرخص", "refine"],
  ["وأرخص", "refine"],
  ["بس داخلي", "refine"],
  ["للعيال", "refine"],
  ["مو غالي", "refine"],
  ["على البحر", "refine"],
  ["غيره", "more"],
  ["عطني غيرها", "more"],
  ["شي ثاني", "more"],
  ["الثاني", "pick"],
  ["رقم ٣", "pick"],
  ["الأخير", "pick"],
  ["وين بالضبط؟", "where"],
  ["وينه", "where"],
  ["الموقع", "where"],
  // A real question is a new question, even with a follow-up word in it.
  ["وين أتعشى", "new"],
  ["أبي مطعم بحري بالسالمية الليلة", "new"],
  ["سوق المباركية", "new"],
];
for (const [msg, kind] of cases) {
  const r = readFollowUp(msg, coffee);
  ok(`«${msg}» → ${kind}`, r.kind === kind, `got ${r.kind}`);
}

console.log("\n── what each one points at ──");
ok("«الثاني» is the second card on screen", readFollowUp("الثاني", coffee).slug === coffee.shown[1]);
ok("«رقم ٣» is the third", readFollowUp("رقم ٣", coffee).slug === coffee.shown[2]);
ok("«الأخير» is the last one on screen", readFollowUp("الأخير", coffee).slug === coffee.shown.at(-1));
ok("«وين بالضبط؟» is the first place when nothing is pointed at", readFollowUp("وين بالضبط؟", coffee).slug === coffee.shown[0]);
ok(
  "and the place being pointed at when one is",
  readFollowUp("وين بالضبط؟", coffee, coffee.shown[3]).slug === coffee.shown[3]
);
ok(
  "a pointer at a place no longer on screen is ignored",
  readFollowUp("وين بالضبط؟", coffee, "not-a-place").slug === coffee.shown[0]
);
const refined = readFollowUp("أرخص", coffee);
ok("«أرخص» narrows the last question rather than replacing it", refined.query === "مطعم أرخص", refined.query);

console.log("\n── «غيره» never repeats ──");
const more = nextPlaces(coffee);
ok("the next places are new ones", more.length > 0 && more.every((s) => !coffee.seen.includes(s)));
ok("in the answer's own order", more[0] === coffee.ranked[8]);
const all = { ...coffee, seen: coffee.ranked };
ok("and there are none once every place has been shown", nextPlaces(all).length === 0);

console.log("\n── narrowing changes the answer ──");
const cheaper = ask(refined.query);
const price = (s) => bySlug.get(s).priceLevel;
ok(
  "«مطعم» then «أرخص» leads with a place in the cheapest band",
  price(cheaper[0]) === Math.min(...cheaper.map(price)),
  `${cheaper[0]} at ${price(cheaper[0])}`
);
// «قهوة» alone finds four places, none of them indoor — so «داخلي» has to
// keep the open courtyard off the top, in any month.
for (const [label, clock] of [["a January evening", JANUARY_EVENING], ["noon in August", AUGUST_NOON]]) {
  const before = ask("قهوة", clock);
  const inside = ask("قهوة داخلي", clock);
  ok(
    `«قهوة» then «داخلي» on ${label} does not lead with an open-air place`,
    bySlug.get(inside[0]).setting !== "outdoor",
    `${inside[0]} is ${bySlug.get(inside[0]).setting} (before: ${before[0]})`
  );
}


console.log("\n── the chips under an answer ──");
const shown = coffee.shown.map((s) => bySlug.get(s));
const chips = followUpChips(coffee, shown, AUGUST_NOON);
ok("at most four", chips.length <= 4, chips.join(" | "));
ok("«وين بالضبط؟» is always offered", chips.includes("وين بالضبط؟"));
ok("«غيره» is offered while there are more", chips.includes("غيره"));
ok("«غيره» is not offered once there are none", !followUpChips(all, shown, AUGUST_NOON).includes("غيره"));
ok("«داخلي» is offered at noon in August", chips.includes("داخلي"));
ok("and not on a January evening", !followUpChips(coffee, shown, JANUARY_EVENING).includes("داخلي"));
const cheapCtx = context("مطعم رخيص");
ok(
  "«أرخص» is not offered for a question that already asked for cheap",
  !followUpChips(cheapCtx, cheapCtx.shown.map((s) => bySlug.get(s)), JANUARY_EVENING).includes("أرخص")
);
const allCheap = shown.map((p) => ({ ...p, priceLevel: 1 }));
ok("nor when every place on screen is already in the cheapest band", !followUpChips(coffee, allCheap, JANUARY_EVENING).includes("أرخص"));
ok(
  "every chip is read back as a follow-up, never as a new question",
  chips.every((c) => readFollowUp(c, coffee).kind !== "new"),
  chips.map((c) => `${c}:${readFollowUp(c, coffee).kind}`).join(" ")
);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
