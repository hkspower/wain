import { buildIndex, search } from "@/lib/search";
import { places } from "@/lib/places";
import { answerParts } from "@/lib/voice-lines";

/**
 * Is the answer actually right?
 *
 * The other answer suite checks the *shape* — that she echoes the question,
 * names a place, gives a reason and a time. Every one of those passes just as
 * well when she recommends a museum for «قهوة»: it asserts she names whatever
 * came first, never that the first is any good.
 *
 * So this asks real questions, in the Kuwaiti a person would actually say
 * them, and checks the category that comes back. It is the layer that catches
 * a search regression — a changed weight, a lost synonym — turning her from
 * useful into confidently wrong, which is the worst thing an assistant can be
 * and the thing a shape test cannot see.
 *
 * Each case names the categories that would be a *good* answer. Where more
 * than one is listed the question is genuinely open: «وين أتغدى» is fairly
 * answered by a restaurant or by fast food.
 */

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ ${name}${detail ? "\n      " + detail : ""}`); }
};

const index = buildIndex(places);
const bySlug = new Map(places.map((p) => [p.slug, p]));

function ask(q) {
  const hits = search(q, index, { limit: 40 });
  const hitPlaces = hits
    .filter((h) => h.doc.kind === "place")
    .map((h) => bySlug.get(h.doc.id.replace(/^place:/, "")))
    .filter(Boolean);
  return { hits, hitPlaces, said: answerParts(hits, hitPlaces, { asked: q }).map((p) => p.text).join(" ") };
}

/** [question, acceptable categories, note] */
const BATTERY = [
  // --- the everyday ones, in the words people use -------------------------
  ["أبي قهوة", ["coffee"], "the plainest request there is"],
  ["وين أشرب كرك؟", ["coffee"], "karak is the local word, not 'tea'"],
  ["قهوة هادية", ["coffee"], "quiet coffee — the phrase on the search chips"],
  ["أبي أتغدى", ["restaurants", "fastfood"], "lunch"],
  ["مطعم سمك", ["restaurants"], "fish"],
  ["أبي برجر", ["fastfood", "restaurants"], "burger"],
  ["وين أتعشى مع العايلة؟", ["restaurants", "fastfood", "family"], "dinner with the family"],

  // --- outdoors and the sea ----------------------------------------------
  ["أبي أروح البحر", ["outdoors"], "the sea"],
  ["شاطئ", ["outdoors"], "beach, bare noun"],
  ["حديقة أمشي فيها", ["outdoors"], "a park to walk in"],

  // --- with children -------------------------------------------------------
  // culture belongs here: the Cultural Centre is tagged «عيال، عوائل» and is
  // a science museum a child would enjoy. Excluding it was my expectation
  // being narrow, not the ranking being wrong.
  ["مكان يناسب العيال", ["family", "outdoors", "culture"], "somewhere for the kids"],
  ["وين أطلع بالعيال؟", ["family", "outdoors", "culture"], "an outing with the kids"],
  ["ألعاب", ["family"], "rides"],

  // --- culture and landmarks ----------------------------------------------
  ["متحف", ["culture"], "museum"],
  ["أبي أشوف معلم في الكويت", ["landmarks", "culture"], "a landmark"],
  ["أبراج الكويت", ["landmarks"], "by name"],
  ["مسجد", ["culture"], "mosque"],

  // --- shopping ------------------------------------------------------------
  ["أبي أتسوق", ["shopping"], "shopping"],
  ["سوق قديم", ["shopping", "culture"], "an old souq"],
  ["مول", ["shopping"], "mall"],

  // --- how people actually type: typos, dialect, mixed script -------------
  ["قهوه", ["coffee"], "قهوة spelled with ه, which is how it is typed"],
  ["مطاعم", ["restaurants", "fastfood"], "the plural"],
  ["coffee", ["coffee"], "typed in English"],
  ["beach", ["outdoors"], "English, on an Arabic site"],

  // --- the intention, not the listing --------------------------------------
  //
  // Every place is described in the vocabulary of a LISTING — «موعد», «ربع»,
  // «ماركات» — and people type the vocabulary of an INTENTION. Same idea,
  // different register, and before the synonym entries these four returned
  // nothing at all. Each is checked for the category it should land in, not
  // merely for being non-empty: a synonym that answers with the wrong place
  // is worse than one that answers with none.
  ["رومانسي", ["coffee", "restaurants"], "a date — the catalogue tags this «موعد»"],
  // culture is here because بيت لوذان genuinely belongs: an arts house
  // running workshops for young local artists is a fair answer to «شباب»,
  // and it became the top hit the moment the place was added. Widening the
  // case beats narrowing the search.
  ["شباب", ["coffee", "fastfood", "restaurants", "culture"], "a young crowd — tagged «ربع»"],
  ["ملابس", ["shopping"], "shopping FOR something — tagged «ماركات»"],
  ["كتب", ["shopping"], "secondhand books, which is سوق الجمعة and nowhere else"],
  ["بارد", ["shopping", "restaurants", "culture"], "somewhere air-conditioned in the heat"],
  ["عائلي", ["family", "restaurants", "outdoors"], "family-friendly, spelled the common way"],

  // --- the Kuwaiti a person says, not the Arabic the catalogue writes -------
  //
  // Forty-five everyday Kuwaiti words were run through the index; fifteen
  // returned nothing. These are the ones where the concept WAS in the
  // catalogue under a different word — a register gap, not a content gap.
  // Each is here so the synonym that closed it cannot quietly go away.
  ["ريوق", ["restaurants", "fastfood", "shopping"], "breakfast in Kuwaiti; the catalogue says «فطور»"],
  ["نتريق", ["restaurants", "fastfood", "shopping"], "and the verb, which is how it gets asked"],
  ["چالت", ["outdoors"], "chalet in the Kuwaiti spelling — چ folds to تش, so it missed «شاليه» entirely"],
  ["عزيمة", ["restaurants"], "the singular; every tag in the catalogue is the plural «عزايم»"],
  ["مكان العيال يلعبون فيه", ["family", "culture"], "a parent says «يلعبون», the catalogue says «ألعاب»"],
  ["كشتة", ["outdoors"], "winter desert camping → «صحراء». No campsite exists; the desert does"],
  ["هيل", ["coffee"], "sits inside the highlight «قهوة عربية وهيل», glued to the و and unreachable"],
  // A mall is a fair answer here and not an obvious one: الكوت مول is tagged
  // «سهرة», and somewhere open late is what a غبقة actually needs.
  ["وين الغبقة", ["shopping", "restaurants", "fastfood", "coffee"], "the late Ramadan sitting → «سهرة»"],
];

console.log("\n── she answers the question that was asked ──");
for (const [q, wanted, note] of BATTERY) {
  const r = ask(q);
  const top = r.hitPlaces[0];
  ok(
    `«${q}» → ${wanted.join("/")}  (${note})`,
    !!top && wanted.includes(top.category),
    top ? `got ${top.category}: ${top.nameAr}` : "no result at all"
  );
}

console.log("\n── and the answer she speaks contains that place ──");
{
  // A right search result that never reaches the sentence helps nobody.
  let mismatches = 0;
  for (const [q] of BATTERY) {
    const r = ask(q);
    if (r.hitPlaces[0] && !r.said.includes(r.hitPlaces[0].nameAr)) mismatches++;
  }
  ok("every top result is named in what she says", mismatches === 0, `${mismatches} not spoken`);
}

console.log("\n── «شي في مكان»: both halves of the question count ──");
/**
 * People do not ask for a category and an area separately, they ask for
 * «قهوة في السالمية» in one breath. Before these cases the area half won
 * outright, because an area name is rare and therefore scores enormously
 * while the noun is spread thin across every place of that kind:
 *
 *   شاطئ في الفحيحيل  →  الكوت مول      a shopping centre, for «beach»
 *   كافيه بالسالمية   →  مجمع الفنار، then شاطئ المارينا — a BEACH, for «café»
 *
 * The noun is WHAT is wanted and the area is WHERE. A result matching only
 * the where has agreed about the map without answering the question, so it is
 * damped below anything matching the thing itself, and a place that genuinely
 * IS of the asked-for category is lifted over one that merely mentions the
 * word in its prose.
 */
{
  const inArea = (q, wanted, note) => {
    const top = ask(q).hitPlaces[0];
    ok(`«${q}» → ${wanted}  (${note})`, !!top && top.category === wanted,
      top ? `got ${top.category}: ${top.nameAr}` : "no result at all");
  };
  inArea("قهوة في السالمية", "coffee", "area present and stocked");
  inArea("كافيه بالسالمية", "coffee", "«كافيه» must reach the category, not a beach's prose");
  inArea("مطعم في حولي", "restaurants", "restaurant in Hawalli");
  // Nothing in the catalogue is a beach in Fahaheel. Answering with beaches
  // elsewhere is right; answering with a mall that happens to be in Fahaheel
  // is not, because the one thing she asked for is the one thing it is not.
  inArea("شاطئ في الفحيحيل", "outdoors", "no beach there — give beaches, not a local mall");
}

console.log("\n── the plural finds what the singular finds ──");
/**
 * Arabic does not form most plurals with a suffix, so no stemming gets from
 * «أسواق» to «سوق» — they share three letters in a different order. Measured
 * across fifteen pairs, six answered materially differently, and the plural
 * was the loser every time: «سوق» found fourteen places, «أسواق» found one.
 *
 * Asserted as a ratio rather than an exact count, so adding places to the
 * catalogue does not break the test while the property still holds.
 */
{
  const n = (q) => ask(q).hitPlaces.length;
  for (const [singular, plural] of [
    ["سوق", "أسواق"], ["مول", "مولات"], ["متحف", "متاحف"],
    ["جزيرة", "جزر"], ["بيت", "بيوت"], ["شارع", "شوارع"],
  ]) {
    const s = n(singular), p = n(plural);
    ok(`«${plural}» reaches most of what «${singular}» does`, p > 0 && p >= s / 2,
      `${singular}=${s}  ${plural}=${p}`);
  }
}

console.log("\n── a Latin keyboard is a supported way in ──");
/**
 * The index carries every place's English name, which covers «restaurant»,
 * «museum» and «mall» by accident — those words ARE in the names. The words
 * that are nobody's name returned nothing, and they are the ordinary ones: a
 * parent types «kids», not «Sheikh Abdullah Al Salem Cultural Centre».
 *
 * «cafe» failed for a different reason worth keeping a test on. The catalogue
 * says «Gulf Road Cafés», so the index held `cafés` with the accent and there
 * was no `cafe` term at all — not even for the fuzzy pass to reach. normalise()
 * folded Arabic thoroughly and left Latin alone.
 */
{
  const cat = (q) => ask(q).hitPlaces[0]?.category ?? "—";
  ok("«cafe» reaches a coffee place despite «Cafés» in the data", cat("cafe") === "coffee", cat("cafe"));
  ok("and so does «best cafe»", cat("best cafe") === "coffee", cat("best cafe"));
  ok("«kids» finds somewhere for children", ["family", "culture", "outdoors"].includes(cat("kids")), cat("kids"));
  ok("«seafood» finds the fish market", ask("seafood").hitPlaces[0]?.nameAr === "سوق السمك",
    ask("seafood").hitPlaces[0]?.nameAr ?? "لا شي");
  ok("«cheap» finds something rather than nothing", ask("cheap").hitPlaces.length > 0);
  // The accent must not come back: it is one term today, and the fold is what
  // stops the next French- or Spanish-derived name doing the same thing.
  ok("no index term mixes Latin letters with a diacritic",
    ![...index.postings.keys()].some((t) => /[a-z]/i.test(t) && /\P{ASCII}/u.test(t)),
    [...index.postings.keys()].filter((t) => /[a-z]/i.test(t) && /\P{ASCII}/u.test(t)).join(", "));
}

console.log("\n── a place we have nothing in is not the place next to it ──");
/**
 * الجهراء is a Kuwaiti governorate of half a million people and this
 * catalogue has nothing in it. One edit away is الزهراء — also real, and
 * about twenty kilometres away — so the fuzzy pass used to answer «أماكن في
 * الجهراء» with a mall in the wrong town, silently. The visitor is standing
 * in the place they just named, which makes it the worst possible substitution
 * to make without saying so.
 */
{
  const jahra = ask("أماكن في الجهراء");
  ok("«الجهراء» never resolves to «الزهراء»",
    !jahra.hitPlaces.some((p) => p.areaAr === "الزهراء"),
    jahra.hitPlaces.slice(0, 3).map((p) => `${p.nameAr}/${p.areaAr}`).join(", ") || "لا شي");
  ok("«الجهراء» on its own finds nothing rather than reaching",
    ask("الجهراء").hits.length === 0,
    `${ask("الجهراء").hits.length} hits`);

  /* The ban is narrow on purpose. Blocking every area name from fuzzy
     matching also killed «اليران» → «الخيران», an ordinary typo, and an
     earlier draft that split multi-word names into tokens put «سالم» and
     «كبير» on the list — words that name real places here. Both are guarded. */
  ok("an ordinary typo of an area still lands",
    ask("اليران").hitPlaces.some((p) => p.areaAr === "الخيران"),
    ask("اليران").hitPlaces.slice(0, 2).map((p) => p.nameAr).join(", ") || "لا شي");
  for (const [typo, want] of [["شاع سالم المبارك", "شارع سالم المبارك"], ["السجد الكبير", "المسجد الكبير"]]) {
    ok(`«${typo}» still reaches ${want}`, ask(typo).hitPlaces[0]?.nameAr === want,
      ask(typo).hitPlaces[0]?.nameAr ?? "لا شي");
  }
}

console.log("\n── she does not invent an answer she does not have ──");
{
  const nonsense = ["زقزقة", "بلبل الطنطل", "qwertyuiop"];
  for (const q of nonsense) {
    const r = ask(q);
    ok(`«${q}» finds nothing rather than reaching`, r.hits.length === 0,
      r.hitPlaces[0] ? `got ${r.hitPlaces[0].nameAr}` : `${r.hits.length} hits`);
    ok(`«${q}» is answered honestly`, /ما لقيت|ما عندي|جرّب/.test(r.said), r.said.slice(0, 90));
  }
}

console.log("\n── the summer rule survives a real question ──");
{
  // Kuwait hits the high forties. Recommending an unshaded beach at midday in
  // August is not a ranking quirk, it is advice that hurts someone.
  const r = ask("أبي أطلع");
  const august = answerParts(r.hits, r.hitPlaces, { asked: "أبي أطلع", month: 7 })
    .map((p) => p.text).join(" ");
  const outdoor = r.hitPlaces.find((p) => p.setting === "outdoor");
  if (outdoor && august.includes(outdoor.nameAr)) {
    ok("an outdoor place suggested in August comes with a warning",
      /المغرب|الليل|الحر|بعد العصر/.test(august), august.slice(0, 160));
  } else {
    ok("no unqualified outdoor suggestion in August", true);
  }
}

console.log("\n── the same Kuwaiti word, however it is spelled ──");
/**
 * Kuwaiti spellings borrow letters the rest of the stack does not know, and
 * the failure is invisible from both ends: the visitor types a word they have
 * spelled correctly and gets nothing, and the index never sees a query it can
 * report as a miss.
 *
 * Measured before lib/arabic existed:
 *
 *   چاي → مقاهي المباركية       تشاي → ما لقينا شي
 *   سمچ → سوق السمك             سمتش → ما لقينا شي
 *   چای → ما لقينا شي            کرک  → ما لقينا شي
 *
 * The last two are written with the Persian yeh (ی) and kaf (ک), which are the
 * SAME GLYPH as ي and ك. And they are the likely case, not the exotic one: the
 * default Arabic keyboards on iOS and Android have no چ key, so anyone typing
 * «چاي» has a Farsi or Urdu keyboard — the one that hands them ی and ک too.
 */
{
  const same = (a, b) => {
    const x = ask(a).hitPlaces.map((p) => p.slug);
    const y = ask(b).hitPlaces.map((p) => p.slug);
    return { x, y, same: x.length > 0 && x[0] === y[0] };
  };
  for (const [a, b] of [
    ["چاي", "تشاي"],          // چ written out, as a keyboard without the key must
    ["سمچ", "سمتش"],
    ["چاي", "چای"],           // Persian yeh — the same glyph as ي
    ["كرك", "کرک"],           // Persian kaf — the same glyph as ك
  ]) {
    const r = same(a, b);
    ok(`«${a}» and «${b}» find the same place`, r.same,
      `${a} → ${r.x.slice(0, 2).join(", ") || "لا شي"}   ${b} → ${r.y.slice(0, 2).join(", ") || "لا شي"}`);
  }

  /* The national dish, and the four ways it gets written. «مجبوس» and «مكبوس»
     used to reach «مچبوس» by accident — one edit apart in the fuzzy fallback.
     Folding چ to تش made it «متشبوس», two edits away, and both spellings
     started finding nothing. That regression is why they are synonyms now, and
     why this asserts on all four rather than on the Kuwaiti spelling alone. */
  const dish = ask("مچبوس").hitPlaces[0]?.slug;
  ok("the catalogue has the dish under its Kuwaiti spelling", !!dish, String(dish));
  for (const q of ["مجبوس", "مكبوس", "كبسة"]) {
    const got = ask(q).hitPlaces.map((p) => p.slug);
    ok(`«${q}» reaches it too`, got.includes(dish), got.slice(0, 3).join(", ") || "لا شي");
  }
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
