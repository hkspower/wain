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
    `export { buildIndex, search, isTopicless } from ${at("search.ts")};\n` +
    `export { answerOrder } from ${at("answer-order.ts")};\n`
);
const bundle = join(tmp, "entry.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(entry)} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const {
  readFollowUp, nextPlaces, followUpChips, withinAnswer, areaIndex, places, buildIndex, search, answerOrder,
  elsewhereNamed, isTopicless,
} = await import(
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
// 8 October: searched, a bare «غيره» answered with whatever the word matched —
// the closed amusement park. With nothing to follow it asks what about.
ok("«غيره» with no last answer asks what about", readFollowUp("غيره", null).kind === "ask");

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


console.log("\n── a message that is not about places is not searched (8 October) ──");
{
  // Read off the live chat while the agent was out of credits: every one of
  // these went to the search and came back as a place or as «ما لقيت شي».
  const SOCIAL = [
    ["هلا", "greet"], ["هلا والله", "greet"], ["مرحبا", "greet"], ["hi", "greet"], ["يا سالم", "greet"],
    ["السلام عليكم", "salam"], ["صباح الخير", "morning"], ["مساء الخير", "evening"],
    ["شلونك", "how"], ["شكراً", "thanks"], ["مشكور", "thanks"], ["thanks", "thanks"], ["يعطيك العافية", "afia"],
    ["مين أنت؟", "who"], ["منو انت", "who"], ["شنو اسمك", "who"], ["انت شوق؟", "notShouq"],
    ["شنو تقدر تسوي؟", "help"], ["ساعدني", "help"], ["مع السلامة", "bye"], ["باي", "bye"],
    ["اوكي", "ok"], ["تمام", "ok"], ["طيب", "ok"], ["لا", "no"],
  ];
  for (const [msg, act] of SOCIAL) {
    const a = readFollowUp(msg, null);
    const b = readFollowUp(msg, coffee);
    ok(`«${msg}» is «${act}», with or without a last answer`, a.kind === "social" && a.act === act && b.kind === "social" && b.act === act,
      `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  }
  const how = readFollowUp("هلا شلونك", null);
  ok("«هلا شلونك» is «how», answered after the greeting", how.kind === "social" && how.act === "how" && how.opener === "greet", JSON.stringify(how));
}

console.log("\n── a greeting in front of a question is answered, then the question ──");
{
  const salam = readFollowUp("السلام عليكم، أبي قهوة", null);
  ok("«السلام عليكم، أبي قهوة» asks «أبي قهوة», opened with the salam",
    salam.kind === "new" && salam.query === "أبي قهوة" && salam.opener === "salam", JSON.stringify(salam));
  const hala = readFollowUp("هلا والله أبي قهوة", coffee);
  ok("«هلا والله أبي قهوة» asks «أبي قهوة»", hala.kind === "new" && hala.query === "أبي قهوة" && hala.opener === "greet", JSON.stringify(hala));
  const wallah = readFollowUp("والله زهقان", null);
  ok("«والله زهقان» asks «زهقان», with nothing to answer first", wallah.kind === "new" && wallah.query === "زهقان" && !wallah.opener, JSON.stringify(wallah));
  const thanksMore = readFollowUp("شكراً، غيره؟", coffee);
  ok("«شكراً، غيره؟» is «غيره»", thanksMore.kind === "more", JSON.stringify(thanksMore));
  const no = readFollowUp("لا أبي شي مو غالي", coffee);
  ok("«لا أبي شي مو غالي» is not a «no» — it is read whole", no.kind !== "social", JSON.stringify(no));
}

console.log("\n── follow-ups said the way people say them ──");
{
  const at = (msg, active) => readFollowUp(msg, coffee, active);
  const where2 = at("وين الثاني؟");
  ok("«وين الثاني؟» is where the second one is", where2.kind === "where" && where2.slug === coffee.shown[1], JSON.stringify(where2));
  const where2b = at("الثاني وينه؟");
  ok("and so is «الثاني وينه؟»", where2b.kind === "where" && where2b.slug === coffee.shown[1], JSON.stringify(where2b));
  const whereLast = at("وين الأخير");
  ok("«وين الأخير» is where the last one is", whereLast.kind === "where" && whereLast.slug === coffee.shown.at(-1), JSON.stringify(whereLast));
  const best = at("أحسن واحد");
  ok("«أحسن واحد» is the first place — the answer's own best guess", best.kind === "pick" && best.slug === coffee.shown[0], JSON.stringify(best));
  const price = at("كم سعر الأول؟");
  ok("«كم سعر الأول؟» is the first place", price.kind === "pick" && price.slug === coffee.shown[0], JSON.stringify(price));
  const priceActive = at("كم سعره؟", coffee.shown[2]);
  ok("«كم سعره؟» is the place being pointed at", priceActive.kind === "pick" && priceActive.slug === coffee.shown[2], JSON.stringify(priceActive));
  const moreCheaper = at("غيره أرخص");
  ok("«غيره أرخص» narrows, and does not search the word «غيره»",
    moreCheaper.kind === "refine" && !moreCheaper.query.includes("غيره"), JSON.stringify(moreCheaper));
  for (const msg of ["قريب مني", "وين أقرب واحد", "شي قريب"]) {
    const a = readFollowUp(msg, coffee);
    const b = readFollowUp(msg, null);
    ok(`«${msg}» asks for the area — the page does not know where anyone is`,
      a.kind === "ask" && a.what === "area" && b.kind === "ask" && b.what === "area", `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  }
}

console.log("\n── a follow-up with nothing to follow asks, rather than searching its words ──");
for (const msg of ["غيره", "وين بالضبط؟", "الثاني", "أحسن واحد", "رقم ٣"]) {
  const r = readFollowUp(msg, null);
  ok(`«${msg}» with nothing remembered asks what about`, r.kind === "ask" && r.what === "subject", JSON.stringify(r));
}
ok("«وين» alone is still a question — it finds the page about وين", readFollowUp("وين", null).kind === "new");
ok("and «وين نروح» is the commonest question there is", readFollowUp("يلا وين نروح", null).kind === "new");

console.log("\n── an area narrows the last answer to that area ──");
{
  const areas = areaIndex(places.map((p) => p.areaAr));
  for (const [msg, area] of [["السالمية", "السالمية"], ["بالسالمية", "السالمية"], ["في حولي", "حولي"], ["مدينة الكويت", "مدينة الكويت"]]) {
    const r = readFollowUp(msg, coffee, null, areas);
    ok(`«${msg}» after an answer is that answer in ${area}`, r.kind === "refine" && r.area === area, JSON.stringify(r));
  }
  const fresh = readFollowUp("السالمية", null, null, areas);
  ok("with nothing remembered it is a question about the area", fresh.kind === "new", JSON.stringify(fresh));
  ok("a part of Kuwait the catalogue does not have is no area of it", readFollowUp("الجهراء", coffee, null, areas).kind === "new");
}

console.log("\n── narrowing stays inside the answer it narrows ──");
{
  const cafes = context("قهوة", JANUARY_EVENING);
  const cheaper = withinAnswer(ask("قهوة أرخص"), cafes);
  ok("«قهوة» then «أرخص» is cafés only", cheaper.length > 0 && cheaper.every((s) => cafes.ranked.includes(s)), cheaper.join(" "));
  ok("and the zoo is not one of them", !cheaper.includes("kuwait-zoo") && ask("قهوة أرخص").includes("kuwait-zoo"),
    "the unnarrowed search should have reached the zoo, or this proves nothing");
  const dinner = context("عشا", JANUARY_EVENING);
  const kids = withinAnswer(ask("عشا للعيال"), dinner);
  ok("«عشا» then «للعيال» does not lead with the zoo «روح الصبح»", kids.length > 0 && kids[0] !== "kuwait-zoo" && kids.every((s) => dinner.ranked.includes(s)), kids.slice(0, 3).join(" "));
}

console.log("\n── the hour a question names (8 October) ──");
{
  const best = (s) => bySlug.get(s).bestTimeAr;
  for (const clock of [{ month: 0, hour: 9 }, { month: 0, hour: 21 }]) {
    const breakfast = ask("فطور", clock);
    ok(`«فطور» at ${clock.hour}:00 is not answered with a place for the night`, !/الليل|العشا|المغرب/.test(best(breakfast[0])) || /الصبح|بدري/.test(best(breakfast[0])),
      `${breakfast[0]}: ${best(breakfast[0])}`);
    const lunch = ask("وين أتغدى", clock);
    ok(`«وين أتغدى» at ${clock.hour}:00 leads with a place for lunch`, /الغدا|الظهر/.test(best(lunch[0])), `${lunch[0]}: ${best(lunch[0])}`);
    const dinner = ask("وين أتعشى", clock);
    ok(`«وين أتعشى» at ${clock.hour}:00 still leads with a place for dinner`, /العشا|الليل|المغرب/.test(best(dinner[0])), `${dinner[0]}: ${best(dinner[0])}`);
  }
}

console.log("\n── the words said around a question ──");
{
  ok("«والله زهقان» is a wish to go out", isTopicless("والله زهقان"));
  ok("so is «يلا وين نروح»", isTopicless("يلا وين نروح"));
  ok("«أبي قهوة لو سمحت» brings no بيت لوذان in with the cafés", !ask("أبي قهوة لو سمحت").includes("bait-lothan"),
    ask("أبي قهوة لو سمحت").slice(0, 6).join(" "));
  ok("«مع ربعي» finds the places for a group of friends", ask("مع ربعي").length > 0);
  ok("«kahwa» finds the cafés", ask("kahwa")[0] === ask("قهوة")[0], `${ask("kahwa")[0]} vs ${ask("قهوة")[0]}`);
  ok("«ba7ar» finds the sea", ask("ba7ar")[0] === ask("بحر")[0], `${ask("ba7ar")[0]} vs ${ask("بحر")[0]}`);
}

console.log("\n── a part of Kuwait with nothing in it is named back ──");
{
  const idx = index;
  for (const [q, named] of [["الجهراء", "الجهراء"], ["مطعم بالجهراء", "الجهراء"], ["كافيه بسلوى", "سلوى"], ["صباح السالم", "صباح السالم"]]) {
    ok(`«${q}» names «${named}»`, elsewhereNamed(q, idx) === named, String(elsewhereNamed(q, idx)));
  }
  for (const q of ["قهوة", "السالمية", "مطعم بالسالمية", "صباح الأحمد"]) {
    ok(`«${q}» names nowhere`, elsewhereNamed(q, idx) === null, String(elsewhereNamed(q, idx)));
  }
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
