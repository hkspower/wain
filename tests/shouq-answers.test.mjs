import { buildIndex, search } from "@/lib/search";
import { places } from "@/lib/places";
import { NON_STANDARD_ARABIC } from "@/lib/arabic";
import {
  answerParts,
  buildClipLines,
  isSummerMonth,
  isMorningPlace,
  placeTryLine,
  placeSuggestParts,
  forSpeech,
  GENERIC_LINES,
} from "@/lib/voice-lines";
import { answerOrder, defaultPicks } from "@/lib/answer-order";
import { formatShowPlaces } from "@/lib/salem-tools";

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
};

const index = buildIndex(places);
const bySlug = new Map(places.map((p) => [p.slug, p]));
/** January at two in the afternoon unless told otherwise: no season, daytime. */
const JAN = { month: 0, hour: 14 };
const AUG = { month: 7, hour: 14 };
const AUG_NIGHT = { month: 7, hour: 21 };
/**
 * A question, answered the way /search and /salem both answer it now: the
 * search, then `answerOrder` (season, price, reviews), then `answerParts`.
 */
const ask = (q, opts = {}) => {
  const clock = { month: opts.month ?? JAN.month, hour: opts.hour ?? JAN.hour };
  const { hits, fallback } = answerOrder(q, search(q, index, { limit: 40 }), index, places, clock);
  const hitPlaces = hits
    .filter((h) => h.doc.kind === "place")
    .map((h) => bySlug.get(h.doc.id.replace(/^place:/, "")))
    .filter(Boolean);
  return {
    hits, hitPlaces, fallback,
    parts: answerParts(hits, hitPlaces, { ...opts, ...clock }),
    say: (p) => p.map((x) => x.text).join(" "),
  };
};
/** Seconds out loud, at the ~7.5 characters a second the clips are read at. */
const seconds = (parts) => forSpeech(parts.filter((p) => !p.optional).map((p) => p.text).join(" ")).length / 7.5;

console.log("\n── answer shape: the place, where, and when — nothing else ──");
{
  const r = ask("قهوة هادية", { asked: "قهوة هادية" });
  const said = r.say(r.parts);
  const top = r.hitPlaces[0];
  ok("echoes the question she heard", said.startsWith("قهوة هادية؟"));
  ok("opens «جرّب <the place> ب<its area>»", said.includes(`جرّب ${top.nameAr} ب${top.areaAr}.`), said);
  ok("says when to go, as «روح …»", said.includes(`روح ${top.bestTimeAr}.`), said);
  // 3 October, the owner's choice: the tagline is on the card under the
  // answer and the second choice is the next card — neither is said.
  ok("does not read the tagline out", !said.includes(top.taglineAr), said);
  ok("does not offer a second place", r.parts.filter((p) => p.key?.startsWith("try-")).length === 1 &&
    !said.includes(r.hitPlaces[1].nameAr), said);
  ok("never reads a result count", !/نتيجة|نتائج/.test(said));
  ok("no part reads like a form — no colon anywhere", !r.parts.some((p) => p.text.includes(":")), said);
  ok("every part ends with punctuation the synthesiser can pause on",
    r.parts.every((p) => /[.؟!]$/.test(p.text.trim())));
  const s = seconds(r.parts);
  ok(`about nine seconds out loud, not twenty (${s.toFixed(1)}s)`, s <= 11, said);
  // The read-aloud bridge caches a sentence for good: a key whose text moved
  // with the question would be a new paid render on every question.
  const clips = buildClipLines("shouq", places);
  ok("each keyed part is one fixed sentence", r.parts.every((p) => !p.key || clips[p.key] === p.text));
}

console.log("\n── the echo is only for spoken questions ──");
{
  const typed = ask("قهوة هادية");
  ok("typed search does not echo", !typed.say(typed.parts).includes("قهوة هادية؟"));
  ok("typed search still recommends", typed.say(typed.parts).startsWith("جرّب "));
  const r = ask("قهوة هادية", { asked: "قهوة هادية" });
  ok("the echo is skipped on the recorded-clip path", r.parts.find((p) => p.text.includes("؟") && !p.key)?.optional === true);
}

console.log("\n── empty and partial results ──");
{
  const none = ask("زقزقة", { asked: "زقزقة" });
  ok("the query really has no match", none.hits.length === 0);
  ok("no results still echoes what was heard", none.say(none.parts).includes("زقزقة؟"));
  ok("no results gives an actionable line", none.say(none.parts).includes(GENERIC_LINES["search-empty"]));
  ok("no results never invents a place", !none.parts.some((p) => (p.key || "").startsWith("try-")));
}

console.log("\n── a question with no topic gets a pick for the hour ──");
{
  /* «وين أروح الحين» — the commonest question there is — searched «اروح» and
     «حين», found nothing, and she said «ما لقيت شي». */
  for (const q of ["وين أروح الحين", "وين نطلع", "زهقان", "ملل"]) {
    for (const [label, clock] of [["August afternoon", AUG], ["a January evening", { month: 0, hour: 20 }]]) {
      const r = ask(q, clock);
      ok(`«${q}», ${label}: she names a place`, r.fallback && r.parts.some((p) => p.key?.startsWith("try-")),
        r.say(r.parts));
    }
  }
  const summerDay = ask("وين أروح الحين", AUG).hitPlaces[0];
  ok(`at two in an August afternoon it is indoors (${summerDay?.slug})`, summerDay?.setting === "indoor");
  ok("and its best time is the afternoon, not «روح الصبح»", /العصر/.test(summerDay?.bestTimeAr ?? ""), summerDay?.bestTimeAr);
  const evening = ask("وين نطلع", { month: 0, hour: 20 }).hitPlaces[0];
  ok(`a January evening is the sea and a «سهرة» (${evening?.slug})`,
    evening?.tagsAr.includes("بحر") && evening?.tagsAr.includes("سهرة"));
  const morning = ask("زهقان", { month: 0, hour: 8 }).hitPlaces[0];
  ok(`a January morning is a walk outdoors (${morning?.slug})`,
    morning?.setting !== "indoor" && morning?.tagsAr.includes("مشي"));
  ok("the pick is the same pick every time for the same hour",
    JSON.stringify(defaultPicks(places, AUG).map((p) => p.slug)) === JSON.stringify(defaultPicks(places, AUG).map((p) => p.slug)));
  // «وين» alone is the site's own name; it still finds the page about it.
  ok("«وين» alone is not topicless — it is the site's name", !ask("وين").fallback);
  ok("a going-out word beside a real one searches the real one",
    !ask("زهقان أبي بحر").fallback && ask("زهقان أبي بحر").hitPlaces[0]?.tagsAr.includes("بحر"));
}

console.log("\n── the picks a review measured as wrong ──");
{
  /* Each measured on 3 October against the live answer, which was wrong:
     «ملاهي» fuzzed onto «مقاهي» and recommended a tea house; «بر» (the
     desert) prefix-matched «برد/برجر» and gave the Avenues; «مكان للبنات»
     fuzzed «للناس» onto a farm; «مطعم رخيص» led with the dearest grill;
     «سائح» found a cultural centre on «بالكويت»; «اسهر» fuzzed onto «اسهل»;
     «مطعن» found the towers' restaurant in prose. */
  const top = (q, clock = JAN) => ask(q, clock).hitPlaces[0]?.slug;
  const cases = [
    ["ملاهي", ["entertainment-city", "aqua-park"]],
    ["ملاهي للعيال", ["entertainment-city", "aqua-park"]],
    ["بر", ["wafra-farms", "sabah-al-ahmad-sea-city"]],
    ["مطعم رخيص", ["tunis-street"]],
    ["سائح أول مرة بالكويت", ["kuwait-towers"]],
  ];
  for (const [q, good] of cases) ok(`«${q}» → ${good.join(" or ")} (${top(q)})`, good.includes(top(q)));
  const girls = ask("مكان للبنات").hitPlaces[0];
  ok(`«مكان للبنات» is somewhere to sit with friends, not a farm (${girls?.slug})`,
    girls && girls.slug !== "wafra-farms" && girls.tagsAr.includes("ربع"));
  const nightOut = ask("وين اسهر").hitPlaces[0];
  ok(`«وين اسهر» is an evening out (${nightOut?.slug})`, nightOut?.tagsAr.includes("سهرة"));
  ok("and nothing it matched was «اسهل» or «اشهر»",
    !ask("وين اسهر").hits.some((h) => h.matched.some((m) => m === "اسهل" || m === "اشهر")));
  const typo = ask("مطعن").hitPlaces[0];
  ok(`«مطعن» is read as «مطعم» — a restaurant (${typo?.slug})`, typo?.category === "restaurants");
  ok("«جديد» no longer matches the rating word «جيد»", !search("مكان جديد", index, { limit: 40 }).some((h) => h.matched.includes("جيد")));
  // The summer: «قهوة» at two in an August afternoon led with a tea house in
  // an open courtyard, under a warning not to go before sunset.
  const coffee = ask("قهوة", AUG).hitPlaces[0];
  ok(`summer coffee is not outdoor-first (${coffee?.slug})`, coffee?.setting !== "outdoor");
  ok("the same coffee question in January may be the courtyard", ask("قهوة", JAN).hitPlaces[0]?.setting === "outdoor");
  ok("asking for the sea in August still gets the sea", ask("قهوة على البحر", AUG).hitPlaces[0]?.tagsAr.includes("بحر"));
  ok("at night in August nothing is pushed down for the heat",
    ask("قهوة", AUG_NIGHT).hitPlaces[0]?.slug === ask("قهوة", JAN).hitPlaces[0]?.slug);
  ok("«مو غالي» is a price, not the word «غالي»", (ask("مطعم مو غالي").hitPlaces[0]?.priceLevel ?? 9) <= 1);
  ok("«مطعم غالي فخم» is not turned cheap", (ask("مطعم غالي فخم").hitPlaces[0]?.priceLevel ?? 0) >= 2);
}

console.log("\n── Kuwait summer: one piece of advice, never two ──");
{
  ok("June–September are summer", [5, 6, 7, 8].every(isSummerMonth));
  ok("October–May are not", [9, 10, 11, 0, 1, 2, 3, 4].every((m) => !isSummerMonth(m)));

  const partsFor = (place, month, hour) =>
    answerParts([{ doc: { id: `place:${place.slug}`, kind: "place", title: place.nameAr, subtitle: "" } }], [place], { month, hour })
      .map((p) => p.text).join(" ");
  const out = GENERIC_LINES["summer-outdoor"];
  const mixedWarn = GENERIC_LINES["summer-mixed"];
  const early = GENERIC_LINES["summer-early"];
  const hot = places.filter((p) => p.setting !== "indoor" && !p.summerOk);
  const outdoor = hot.filter((p) => p.setting === "outdoor" && !isMorningPlace(p));
  const mixed = hot.filter((p) => p.setting === "mixed" && !isMorningPlace(p));
  const morning = hot.filter(isMorningPlace);
  const indoor = places.find((p) => p.setting === "indoor");
  ok(`the catalogue has all three kinds to get wrong (${outdoor.length}/${mixed.length}/${morning.length})`,
    outdoor.length > 0 && mixed.length > 0 && morning.length > 0);

  /* The contradiction this replaced: «أحلى وقت: العصر المتأخر. بس هذي أيام
     حر — لا تروح إلا بعد المغرب.» A sentence that says «not before sunset»
     must not stand beside one that names a daytime hour. */
  const DAY_WORDS = /(العصر|الصبح|الظهر|بدري)/;
  const contradicts = hot.filter((p) => {
    const said = partsFor(p, AUG.month, AUG.hour);
    return said.includes(out) && DAY_WORDS.test(said.replace(out, ""));
  });
  ok("no summer answer says «go by day» and «only after sunset» together", contradicts.length === 0,
    contradicts.map((p) => `${p.slug}: ${partsFor(p, 7, 14)}`).join("\n      "));
  ok("an outdoor place in August gets the heat line INSTEAD of its best time",
    outdoor.every((p) => partsFor(p, 7, 14).includes(out) && !partsFor(p, 7, 14).includes(`روح ${p.bestTimeAr}`)),
    outdoor.filter((p) => !partsFor(p, 7, 14).includes(out)).map((p) => p.slug).join(", "));
  ok("and in January its best time, with no heat line",
    outdoor.every((p) => partsFor(p, 0, 14).includes(`روح ${p.bestTimeAr}.`) && !partsFor(p, 0, 14).includes(out)));
  ok("no month given means no guess", !partsFor(outdoor[0], undefined, 14).includes(out));
  ok("an indoor place in August gets none of the three",
    ![out, mixedWarn, early].some((l) => partsFor(indoor, 7, 14).includes(l)));

  // The morning places — a market packed up by noon was told «لا تروح إلا
  // عقب المغرب».
  ok(`the morning places are the ones the owner named (${morning.map((p) => p.slug).join(", ")})`,
    ["friday-market", "wafra-farms", "fish-market", "souq-al-watiya"].every((s) => morning.some((p) => p.slug === s)));
  ok("a morning place in August is told to go early, never after sunset",
    morning.every((p) => partsFor(p, 7, 14).includes(early) && !partsFor(p, 7, 14).includes(out) && !partsFor(p, 7, 14).includes(mixedWarn)),
    morning.filter((p) => !partsFor(p, 7, 14).includes(early)).map((p) => p.slug).join(", "));

  ok("a mixed place in August keeps its best time, with the mixed line unless that time is the evening",
    mixed.every((p) => {
      const said = partsFor(p, 7, 14);
      const evening = /(المغرب|وقت الغروب|الليل|ليالي|العشا)/.test(p.bestTimeAr);
      return said.includes(`روح ${p.bestTimeAr}.`) && said.includes(mixedWarn) === !evening && !said.includes(out);
    }),
    mixed.map((p) => `${p.slug}: ${partsFor(p, 7, 14)}`).join("\n      "));
  // A mall's indoor half is usable at noon, so the advice must not be «stay away».
  ok("the mixed line names the air-conditioned half rather than refusing",
    mixedWarn.includes("المكيّف") && !mixedWarn.includes("لا تروح"), mixedWarn);

  /* At nine at night «لا تروح إلا عقب المغرب» has come true. */
  ok("at night in August no outdoor place is told to wait for sunset",
    outdoor.every((p) => !partsFor(p, 7, 21).includes(out)));
  ok("and no mixed place is given the daytime advice",
    mixed.every((p) => !partsFor(p, 7, 21).includes(mixedWarn)));
  ok("and an outdoor place whose best time includes the afternoon says nothing about when, rather than «روح العصر»",
    outdoor.every((p) => !DAY_WORDS.test(partsFor(p, 7, 21).replace(/^جرّب[^.]*\./, ""))),
    outdoor.filter((p) => DAY_WORDS.test(partsFor(p, 7, 21).replace(/^جرّب[^.]*\./, ""))).map((p) => partsFor(p, 7, 21)).join("\n      "));
  ok("the morning places still say «the morning» at night", morning.every((p) => partsFor(p, 7, 21).includes(`روح ${p.bestTimeAr}.`)));
  ok("no hour given means the daytime rule", partsFor(outdoor[0], 7, undefined).includes(out));
}

console.log("\n── /search and سالم name the same place ──");
{
  /* They used to order the same hits two ways: /search by the search's score,
     the chat through `reorderByReviews` first — so «مطعم كويتي» was فريج
     صويلح on the page (the stronger match) and ميس الغانم in the chat (the
     better reviewed of two near-equal ones). Both go through `answerOrder`
     now, reviews included, and the chat keeps the order it is given
     (salem-tools.test.mjs; the browser check is in salem.test.mjs). */
  const raw = search("مطعم كويتي", index, { limit: 40 }).filter((h) => h.doc.kind === "place");
  const r = ask("مطعم كويتي");
  ok(`the reviews now order /search too («مطعم كويتي»: ${raw[0]?.doc.id} by score, ${r.hitPlaces[0]?.slug} answered)`,
    raw[0]?.doc.id === "place:freej-swaileh" && r.hitPlaces[0]?.slug === "mais-alghanim");
  ok("and the chat's first card is that place", formatShowPlaces("مطعم كويتي", r.hits, places).slugs[0] === r.hitPlaces[0]?.slug);
}

console.log("\n── the place page says the same two lines ──");
{
  const p = places.find((x) => x.slug === "souq-al-mubarakiya");
  const parts = placeSuggestParts(p);
  ok("try, then when", parts.map((x) => x.key).join(",") === `try-${p.slug},best-${p.slug}`, JSON.stringify(parts));
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
    places.every((p) => `try-${p.slug}` in clips && `best-${p.slug}` in clips));
  ok("and records nothing the answer no longer says",
    !Object.keys(clips).some((k) => /^(place|name)-|^(suggest|related)-intro$/.test(k)));
}

console.log("\n── phrasing details ──");
{
  const selfNamed = places.find((p) => p.nameAr.includes(p.areaAr));
  ok(`a place named after its area does not stutter (${selfNamed?.nameAr})`,
    selfNamed ? placeTryLine(selfNamed) === `جرّب ${selfNamed.nameAr}.` : true);
  const other = places.find((p) => !p.nameAr.includes(p.areaAr));
  ok("other places still say where they are, «ب» joined to the area", placeTryLine(other).includes(` ب${other.areaAr}.`));
  // «روح الأشهر الباردة» and «روح مواعيد الجولات» read badly; the data was
  // reworded (places.ts and schema.sql), and «أحلى وقت: وقت الغروب» no longer
  // stutters because the line no longer starts «أحلى وقت».
  const best = places.map((p) => `روح ${p.bestTimeAr}.`);
  ok("no best time reads «روح الأشهر…», «روح الربيع…» or «روح مواعيد…»",
    !best.some((l) => /^روح (الأشهر|الربيع|مواعيد)/.test(l)), best.filter((l) => /^روح (الأشهر|الربيع|مواعيد)/.test(l)).join(" | "));
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
        { month, hour: 14 }
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

console.log("\n── nothing reaches a voice in a letter it cannot read ──");
/**
 * The catalogue is written the way a Kuwaiti writes: «چاي», «مچبوس», «سمچ»,
 * with چ (U+0686), which is not an Arabic letter. That is right on the page and
 * wrong in a speech engine — an Arabic voice is trained on the standard
 * alphabet and will drop the letter, spell it out, or say something else, and
 * report success either way.
 *
 * forSpeech folds them (see lib/arabic), so this asserts the fold covers
 * everything the catalogue actually contains — and keeps covering it. The
 * clip generator hashes forSpeech's output, so a letter that slips through is
 * not a rendering bug on someone's phone: it is baked into an mp3 that was
 * paid for.
 */
{
  const raw = [];
  const cooked = [];
  /* The recorded lines stopped carrying the tagline on 3 October, and with it
     every «چ» they had — so the corpus is the lines AND the prose the
     catalogue holds. A name or a best time spelt «چ» tomorrow would land in a
     clip; the fold is asserted over every string that could. */
  const corpus = [
    ...["shouq", "salem"].flatMap((persona) =>
      Object.entries(buildClipLines(persona, places)).map(([key, line]) => [`${persona}/${key}`, line])),
    ...places.flatMap((p) => [[`${p.slug}.tagline`, p.taglineAr], [`${p.slug}.description`, p.descriptionAr]]),
  ];
  for (const [key, line] of corpus) {
    if (NON_STANDARD_ARABIC.test(line)) raw.push(key);
    if (NON_STANDARD_ARABIC.test(forSpeech(line))) cooked.push(`${key}: ${forSpeech(line)}`);
  }
  // Stated first: if the catalogue ever stops containing one of these, the
  // assertion below would pass without testing the fold at all.
  ok(`the catalogue really does use them (${raw.length} line(s))`, raw.length > 0, raw.slice(0, 3).join(", "));
  ok("and not one survives into what a voice is handed", cooked.length === 0, cooked.slice(0, 3).join("\n      "));
  ok("«چاي» becomes something an Arabic engine can say", forSpeech("چاي كرك") === "تشاي كرك", forSpeech("چاي كرك"));
  ok("and the page itself is left alone",
    places.some((p) => /چ/.test(p.taglineAr + p.descriptionAr)));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED:", fails.join(" | ")); process.exit(1); }
