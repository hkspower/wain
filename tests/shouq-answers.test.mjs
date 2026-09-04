import { buildIndex, search } from "@/lib/search";
import { places } from "@/lib/places";
import {
  answerParts,
  buildClipLines,
  isSummerMonth,
  placeNameLine,
  forSpeech,
  GENERIC_LINES,
} from "@/lib/voice-lines";

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
};

const index = buildIndex(places);
const bySlug = new Map(places.map((p) => [p.slug, p]));
const ask = (q, opts = {}) => {
  const hits = search(q, index, { limit: 40 });
  const hitPlaces = hits
    .filter((h) => h.doc.kind === "place")
    .map((h) => bySlug.get(h.doc.id.replace(/^place:/, "")))
    .filter(Boolean);
  return { hits, hitPlaces, parts: answerParts(hits, hitPlaces, opts), say: (p) => p.map((x) => x.text).join(" ") };
};

console.log("\n── answer shape ──");
{
  const r = ask("قهوة هادية", { asked: "قهوة هادية" });
  const said = r.say(r.parts);
  ok("echoes the question she heard", said.startsWith("قهوة هادية؟"));
  ok("names a real place", said.includes(r.hitPlaces[0].nameAr));
  ok("gives a reason (the place's own line)", said.includes(r.hitPlaces[0].taglineAr));
  ok("gives the best time", said.includes("أحلى وقت"));
  ok("offers exactly one alternative", (said.match(/وإذا تبي غيره/g) || []).length === 1);
  ok("never reads a result count", !/نتيجة|نتائج/.test(said));
  // A colon is correct for the two intro clauses — they lead into the line
  // that follows, and a full stop there would make her pause mid-thought.
  ok("every part ends with punctuation the synthesiser can pause on",
    r.parts.every((p) => /[.؟!:]$/.test(p.text.trim())));
  ok("the intros are the only parts ending in a colon",
    r.parts.filter((p) => p.text.trim().endsWith(":")).every((p) => p.key === "suggest-intro" || p.key === "related-intro"));
}

console.log("\n── the echo is only for spoken questions ──");
{
  const typed = ask("قهوة هادية");
  ok("typed search does not echo", !typed.say(typed.parts).includes("قهوة هادية؟"));
  ok("typed search still recommends", typed.say(typed.parts).includes("أقترح عليك"));
  const r = ask("قهوة هادية", { asked: "قهوة هادية" });
  ok("the echo is skipped on the recorded-clip path", r.parts.find((p) => p.text.includes("؟") && !p.key)?.optional === true);
}

console.log("\n── empty and partial results ──");
{
  const none = ask("زقزقة", { asked: "زقزقة" });
  ok("the query really has no match", none.hits.length === 0);
  ok("no results still echoes what was heard", none.say(none.parts).includes("زقزقة؟"));
  ok("no results gives an actionable line", none.say(none.parts).includes(GENERIC_LINES["search-empty"]));
  ok("no results never invents a place", !none.parts.some((p) => (p.key || "").startsWith("place-")));
}

console.log("\n── Kuwait summer ──");
{
  ok("June–September are summer", [5, 6, 7, 8].every(isSummerMonth));
  ok("October–May are not", [9, 10, 11, 0, 1, 2, 3, 4].every((m) => !isSummerMonth(m)));

  const outdoor = places.find((p) => p.setting === "outdoor");
  const indoor = places.find((p) => p.setting === "indoor");
  const warn = GENERIC_LINES["summer-outdoor"];
  const partsFor = (place, month) =>
    answerParts([{ doc: { id: `place:${place.slug}`, kind: "place", title: place.nameAr, subtitle: "" } }], [place], { month })
      .map((p) => p.text).join(" ");

  ok("outdoor place in August is warned about", partsFor(outdoor, 7).includes(warn));
  ok("outdoor place in January is not", !partsFor(outdoor, 0).includes(warn));
  ok("indoor place in August is not", !partsFor(indoor, 7).includes(warn));
  ok("no month given means no guess", !partsFor(outdoor, undefined).includes(warn));

  /**
   * The twelve places that used to fall between the two chairs.
   *
   * The warning fired on `setting: "outdoor"` alone, so every `mixed` place
   * — سوق المباركية, شارع تونس, مارينا كريسنت, سوق الوطية — was recommended
   * in August with nothing said about the heat. Half of them are open alleys
   * and pavements, which is the exact case the outdoor warning exists for.
   *
   * It cannot be the same sentence: «لا تروح إلا بعد المغرب» is wrong for a
   * mall whose air-conditioned half is open and fine at noon.
   */
  const mixedWarn = GENERIC_LINES["summer-mixed"];
  const mixed = places.filter((p) => p.setting === "mixed" && !p.summerOk);
  ok(`the catalogue still has mixed places to get this wrong (${mixed.length})`, mixed.length > 0);
  ok("every mixed place in August is warned",
    mixed.every((p) => partsFor(p, 7).includes(mixedWarn)),
    mixed.filter((p) => !partsFor(p, 7).includes(mixedWarn)).map((p) => p.slug).join(", "));
  ok("and none of them in January",
    mixed.every((p) => !partsFor(p, 0).includes(mixedWarn)));
  // The two warnings are mutually exclusive: one place, one piece of advice.
  ok("a mixed place never gets the outdoor «don't go» line",
    mixed.every((p) => !partsFor(p, 7).includes(warn)));
  ok("an outdoor place never gets the mixed line",
    !partsFor(outdoor, 7).includes(mixedWarn));
  ok("an indoor place gets neither",
    !partsFor(indoor, 7).includes(mixedWarn) && !partsFor(indoor, 7).includes(warn));
  // A mall's indoor half is usable at noon, so the advice must not be «stay away».
  ok("the mixed line names the air-conditioned half rather than refusing",
    mixedWarn.includes("المكيّف") && !mixedWarn.includes("لا تروح"), mixedWarn);
}

console.log("\n── the recorded clips and the spoken fallback agree ──");
{
  let drift = [];
  let missing = [];
  const clips = buildClipLines("shouq", places);
  for (const q of ["قهوة", "بحر", "متحف", "مطاعم", "عيال", "تسوّق", "برجر", "فطور"]) {
    for (const month of [0, 7]) {
      const r = ask(q, { month });
      for (const part of r.parts) {
        if (part.optional) continue;
        if (!part.key) { missing.push(`${q}: "${part.text}"`); continue; }
        if (!(part.key in clips)) { missing.push(`${q}: key ${part.key}`); continue; }
        if (clips[part.key] !== part.text) drift.push(`${part.key}\n        clip: ${clips[part.key]}\n        said: ${part.text}`);
      }
    }
  }
  ok("every spoken part has a recorded clip", missing.length === 0, missing.slice(0, 3).join("\n      "));
  ok("no clip says something different from the fallback", drift.length === 0, drift.slice(0, 2).join("\n      "));
  ok("both personas record the same set of keys",
    JSON.stringify(Object.keys(buildClipLines("shouq", places)).sort()) ===
    JSON.stringify(Object.keys(buildClipLines("salem", places)).sort()));
  ok(`clip library covers all ${places.length} places`,
    places.every((p) => `place-${p.slug}` in clips && `best-${p.slug}` in clips && `name-${p.slug}` in clips));
}

console.log("\n── phrasing details ──");
{
  const selfNamed = places.find((p) => p.nameAr.includes(p.areaAr));
  ok(`a place named after its area does not stutter (${selfNamed?.nameAr})`,
    selfNamed ? !placeNameLine(selfNamed).includes(`${selfNamed.areaAr} في ${selfNamed.areaAr}`) : true);
  const other = places.find((p) => !p.nameAr.includes(p.areaAr));
  ok("other places still say where they are", placeNameLine(other).includes(`في ${other.areaAr}`));
}

console.log("\n── no single sentence is too long to be spoken in one breath ──");
/**
 * The browser's voice gets one utterance per part (see speakFallback), which
 * is what keeps an answer under the ceiling Chrome puts on a single utterance —
 * around fifteen seconds, after which it simply stops. Whole answers used to
 * be handed over in one call: 170 characters on average across all 44 places
 * and 227 at the longest, which at the pace the recorded clips are spoken
 * (~7.5 characters a second) is 23 seconds, and the cut landed on «أحلى وقت»
 * or the summer warning — the half that answers the question.
 *
 * Splitting only holds while the parts themselves stay sentence-sized. The
 * longest today is 82 characters, about eleven seconds; a tagline or a
 * description edited to twice that would put the ceiling back with nothing to
 * notice it. 110 leaves real headroom and still fails long before the cut.
 */
{
  const CEILING = 110;
  const long = [];
  for (const p of places) {
    const other = places.find((x) => x.slug !== p.slug);
    for (const month of [0, 6]) {
      const parts = answerParts(
        [{ doc: { id: p.slug, kind: "place", title: p.nameAr, subtitle: "" } },
         { doc: { id: other.slug, kind: "place", title: other.nameAr, subtitle: "" } }],
        [p, other],
        { month }
      );
      for (const part of parts) {
        const said = forSpeech(part.text);
        if (said.length > CEILING) long.push(`${said.length} chars — ${said}`);
      }
    }
  }
  ok(`every spoken sentence is under ${CEILING} characters`, long.length === 0,
    long.slice(0, 3).join("\n      "));
}

console.log("\n── she answers every suggestion chip on the search page ──");
{
  const chips = ["قهوة هادية", "طلعة مع العيال", "بحر", "أكل كويتي", "متحف", "السالمية"];
  const bad = chips.filter((c) => {
    const r = ask(c, { asked: c, month: 0 });
    const said = r.say(r.parts);
    return said.includes(GENERIC_LINES["search-empty"]) || said.length < 40;
  });
  ok("no suggestion chip leaves her with nothing to say", bad.length === 0, bad.join(", "));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED:", fails.join(" | ")); process.exit(1); }
