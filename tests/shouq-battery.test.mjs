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
  ["شباب", ["coffee", "fastfood", "restaurants"], "a young crowd — tagged «ربع»"],
  ["ملابس", ["shopping"], "shopping FOR something — tagged «ماركات»"],
  ["كتب", ["shopping"], "secondhand books, which is سوق الجمعة and nowhere else"],
  ["بارد", ["shopping", "restaurants", "culture"], "somewhere air-conditioned in the heat"],
  ["عائلي", ["family", "restaurants", "outdoors"], "family-friendly, spelled the common way"],
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

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
